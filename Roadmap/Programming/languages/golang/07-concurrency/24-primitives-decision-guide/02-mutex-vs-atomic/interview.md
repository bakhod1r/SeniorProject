---
layout: default
title: Mutex vs Atomic — Interview
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/interview/
---

# Mutex vs Atomic — Interview

[← Back](../)

Thirty-plus questions to drill the decision. Answers are short on purpose: if you cannot explain it in a paragraph you do not understand it.

---

## Section A — Fundamentals

**1. What is an atomic operation, in one sentence?**

A single read-modify-write or read or write of one machine word that is indivisible from the perspective of every other goroutine — no other goroutine can observe a partially completed state.

**2. When is `sync/atomic` correct and `sync.Mutex` wrong, and vice versa?**

Atomic is correct when the invariant fits in one machine word and one operation. Mutex is correct when the invariant spans multiple fields or multiple steps. A counter? Atomic. A balance and a transaction log? Mutex.

**3. Name the five operations `sync/atomic` exposes for each integer type.**

`Load`, `Store`, `Add`, `Swap`, `CompareAndSwap`.

**4. What does CAS do?**

`CompareAndSwap(addr, old, new)` atomically does: if `*addr == old`, write `new` and return true; otherwise leave `*addr` alone and return false.

**5. Why is `Add` not just `Load` + `+` + `Store`?**

Because two goroutines doing load-add-store interleave and lose updates. `Add` is a single instruction (`LOCK XADD` on amd64) that no other CPU can interleave.

**6. What is the cost of an uncontended `sync.Mutex.Lock`?**

One atomic CAS. The fast path of `Mutex.Lock` is `atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked)`.

**7. What is the cost of an uncontended atomic operation on amd64?**

One `LOCK`-prefixed instruction (~20-30 cycles). A `LOCK XADD` for `Add`, `LOCK CMPXCHG` for `CAS`, `MOV` for `Load` (already SC on x86), `XCHG` for `Store` (`XCHG` is implicitly locked).

**8. What is the cost of a contended `sync.Mutex.Lock`?**

A futex syscall to park the goroutine, plus the cost of scheduling. Roughly 1-3 microseconds in the median.

**9. What does the Go memory model say about atomic ordering?**

All atomic operations in a program behave as though executed in some sequentially consistent order. There is no relaxed mode.

**10. Why is sequential consistency expensive on ARM64?**

Every atomic store needs a `DMB ISH` (data memory barrier, inner shareable). Every atomic load needs an acquire variant (`LDAR`). On amd64 it is free for loads.

---

## Section B — Typed atomics (Go 1.19+)

**11. What problem do `atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]` solve over the function-based API?**

They make the field's atomic nature visible in the type, prevent accidental non-atomic access (you cannot write `x.v` directly because `v` is unexported), and the `align64` member fixes the 32-bit alignment trap automatically.

**12. What does `atomic.Pointer[T]` give you that `unsafe.Pointer` did not?**

Type safety. You write `p.Store(t)` where `t *T`, no `unsafe.Pointer` cast. The generic parameter is enforced by the compiler.

**13. Why is `atomic.Value` different from `atomic.Pointer[T]`?**

`atomic.Value` stores `interface{}`, requires every `Store` to use the same dynamic type, and copies the value on each load. `atomic.Pointer[T]` stores only a pointer, no type check at runtime, no copy.

**14. When would you choose `atomic.Value` over `atomic.Pointer[T]`?**

Almost never in new code. `atomic.Value` predates generics and exists for compatibility. Use `atomic.Pointer[T]` for typed pointer publish.

**15. Why does `atomic.Int64` have an unexported `align64` field?**

To force 8-byte alignment on 32-bit platforms (386, ARMv7, MIPS32). Without it, an `int64` field at offset 4 inside a struct would crash on 32-bit ARM when the runtime attempted `LDREXD`.

---

## Section C — Alignment and 32-bit

**16. Describe the 32-bit ARM alignment trap.**

Before Go 1.19, a 64-bit atomic operation on an `int64` field not 8-byte aligned would panic at runtime on 32-bit ARM (and 386, MIPS32). The fix was to put 64-bit fields first in the struct, or to use the `atomic.Int64` type which carries the alignment internally.

**17. Why does this not affect amd64 or ARM64?**

Both have native 64-bit atomic instructions that accept any 8-byte-aligned address, and the compilers already align `int64` to 8 bytes by default. The 32-bit ARM problem is that `LDREXD`/`STREXD` (the only way to do a 64-bit atomic on ARMv7) require 8-byte alignment but the calling convention only aligns to 4.

**18. Is `atomic.Int32` affected by alignment problems?**

No. 4-byte alignment is the default for `int32` everywhere, and 32-bit atomics work on any 4-byte-aligned address on all platforms.

**19. What does the runtime do if you call `atomic.LoadInt64` on an unaligned address (pre-1.19, without `atomic.Int64`)?**

On 32-bit ARM: SIGBUS or SIGSEGV. The Go runtime catches this and panics with `unaligned 64-bit atomic operation`. Discovered at runtime, not compile time.

**20. Why is the rule "the first word in a variable or allocated struct can be relied upon to be 64-bit aligned"?**

The Go heap allocator aligns all allocations to at least 8 bytes (the size of a pointer on 64-bit; on 32-bit it still aligns to 8 for atomicity reasons). The stack allocator aligns goroutine frames to 8. So a top-level `var x int64` or `&Struct{}.first_field` is safe.

---

## Section D — CAS, ABA, and loops

**21. What is the ABA problem?**

A CAS loop reads value A, computes a new value, calls CAS with old=A. Between the read and the CAS, another goroutine changed the value to B then back to A. The CAS succeeds but the new value is computed against stale assumptions. Most common in lock-free linked lists where freed nodes are reused.

**22. Why is ABA not a problem for a counter?**

A counter only cares about the value, not the history. If the value is A again, the counter is correctly A. The problem only arises when the value is a reference to something with state.

**23. How do production lock-free stacks defeat ABA?**

Tagged pointers: each pointer carries a generation counter that increments on every push. CAS compares (pointer, generation) as a 128-bit double-word. The same memory address with a new generation does not match the old (pointer, generation), so the CAS fails. Hazard pointers and epoch-based reclamation are the other approaches.

**24. Does Go have 128-bit CAS?**

Not in `sync/atomic`. `runtime/internal/atomic` has `Cas64` and the runtime uses double-word CAS internally for some structures, but it is not exported.

**25. Write a correct CAS loop for `atomic.Int64.Add` (without using `.Add`).**

```go
for {
    old := x.Load()
    if x.CompareAndSwap(old, old+1) {
        return
    }
    // Lost the race; try again.
}
```

**26. Why is the explicit CAS loop slower than `Add`?**

`Add` is one `LOCK XADD` instruction. The CAS loop is `LOAD` + `LOCK CMPXCHG`, which is at least 2x the instructions and retries on contention. Use `Add` whenever the operation is fixed.

**27. When does `Add` not work, forcing a CAS loop?**

When the new value depends on the old in a non-additive way. Example: `max(current, candidate)` cannot be expressed as Add; you must CAS-loop.

---

## Section E — Mixed access and the race detector

**28. What does "mixed atomic and non-atomic access" mean?**

Reading a word with `atomic.LoadInt32` and writing it with a plain `=`, or vice versa, anywhere in the program. Even one mixed access poisons the contract.

**29. Will the race detector catch mixed access?**

Yes, since Go 1.19. The race detector tracks each word's access mode and reports if the same word is accessed both atomically and non-atomically by any goroutine. Run `go test -race`.

**30. Is reading a field with `=` while another goroutine writes it with `atomic.StoreInt32` undefined?**

Yes. The Go memory model explicitly does not define the result. It may tear, return stale data, or appear to work for years and then break on a compiler upgrade.

**31. Is reading and writing the same `bool` from multiple goroutines safe?**

No. Use `atomic.Bool` or guard with a mutex. A plain `bool` is a single byte, but the compiler is free to read it twice, optimise it into a register, or hoist it out of a loop. Without atomic, the race detector flags it and the behaviour is undefined.

---

## Section F — Performance

**32. Why is `atomic.Int64.Add(1)` 20x faster than `mu.Lock(); n++; mu.Unlock()` under contention?**

Under contention, the mutex parks the goroutine via futex, costing microseconds and a context switch. The atomic spins for one instruction and retries on CAS failure (or just succeeds for `Add`), staying in user-space.

**33. Why is `atomic.Int64.Add(1)` only ~2x faster than the mutex under no contention?**

Uncontended mutex Lock is a single CAS plus an `Unlock` atomic store. Atomic `Add` is one instruction. So roughly 3 instructions vs 1 — about 2-3x.

**34. What is false sharing?**

Two atomics on the same cache line (typically 64 bytes on amd64). When goroutine A writes its atomic, the cache line is invalidated on goroutine B's CPU, forcing B to refetch. Even though B's atomic is logically independent, performance collapses.

**35. How do you fix false sharing?**

Pad each hot atomic to its own cache line:

```go
type padded struct {
    v atomic.Int64
    _ [56]byte // 64 - 8 = 56 bytes of padding
}
```

**36. Why pad to 64 bytes and not 128 bytes?**

amd64 cache lines are 64 bytes. Some Intel CPUs prefetch in 128-byte pairs ("adjacent cache line prefetch"), so high-end performance code pads to 128. The Go runtime uses 64 in `runtime/internal/cpu`.

---

## Section G — Decision questions

**37. You see `mu.Lock(); n++; mu.Unlock()` in a hot loop. Replace it?**

Yes — replace with `atomic.Int64.Add(1)`. The invariant is one word, one operation. The mutex buys nothing.

**38. You see `mu.Lock(); cfg = newCfg; mu.Unlock()` paired with `mu.Lock(); c := cfg; mu.Unlock()` everywhere. Replace?**

Yes — use `atomic.Pointer[Config]`. One-word publish, lock-free reads.

**39. You see `mu.Lock(); balance -= amt; tx = append(tx, t); mu.Unlock()`. Replace?**

No. Two fields, one logical operation. Keep the mutex.

**40. You have a route table: read-mostly, occasional update. Map under mutex or atomic.Pointer[map[...]]?**

`atomic.Pointer[map[string]Route]`. On update, build a new map, swap the pointer. Readers do zero locking. (RCU-style. Memory is the price.)

**41. Counter with frequent reads, infrequent writes. Atomic or RWMutex?**

Atomic. `RWMutex` is heavier than a plain mutex when there is no contention, and an atomic counter has zero locking. For a single-word counter the atomic always wins.

**42. Should you ever use `atomic.Value` in new code?**

Rarely. It costs an `interface{}` allocation per `Store` and a type check. `atomic.Pointer[T]` is faster and type-safe. The one case for `atomic.Value` is publishing a struct value (not pointer) where you really need value semantics — and even then it is questionable.

---

## Section H — Memory model deep dives

**43. What does "sequentially consistent" mean for atomic operations?**

All atomic operations in the program appear to happen in a single total order, and that order is consistent with each goroutine's program order. There is no observable reordering, even on weakly ordered architectures (ARM64, RISC-V).

**44. Why does Go enforce SC instead of allowing relaxed atomics?**

Simplicity. Relaxed atomics are dramatically harder to reason about (proposal #41980 was rejected for this reason). The performance cost is a memory barrier on each atomic on weakly ordered architectures (free on x86 for loads). The Go team decided the simplicity is worth the cost.

**45. If I do `atomic.StoreInt32(&x, 1); atomic.StoreInt32(&y, 1)` on goroutine A and `atomic.LoadInt32(&y); atomic.LoadInt32(&x)` on goroutine B, what guarantees do I have?**

If B's load of y observes A's store of y, then B's load of x must observe A's store of x. (SC: store-store and load-load orders are preserved.) This is Dekker's algorithm and works in Go but not in C++ with relaxed atomics.

**46. What does "happens-before" mean in the Go memory model for atomics?**

If atomic operation B observes the effect of atomic operation A (e.g., a Load sees the value written by a Store), then A is synchronised before B. Any writes done by A's goroutine before A are visible to B's goroutine after B.

**47. Does `atomic.LoadInt64` synchronise with channel sends?**

Indirectly. The Go memory model says a channel send is synchronised before the corresponding receive. If a send observes (or transmits a value derived from) an atomic store, the atomic ordering propagates through the channel.

**48. What is a torn read?**

A read that observes half of one write and half of another. On 64-bit hardware with aligned 64-bit accesses, plain loads/stores cannot tear at the hardware level — but the compiler can split a logical 64-bit access into multiple smaller ones if it does not know the access is atomic. Hence the need for `atomic.LoadInt64`.

**49. Can a plain `int32` access tear on amd64?**

At the hardware level, no — aligned 4-byte access on amd64 is atomic. But the compiler is free to reorder, fold, or eliminate plain accesses. So while the value will not tear, you may read the wrong value entirely. Use `atomic.LoadInt32` / `atomic.Int32`.

---

## Section I — Real-world traps

**50. A team complains their counter is slow under load. Profile shows `LOCK XADD` is in the top. What now?**

Shard the counter. Replace one `atomic.Uint64` with `[]paddedCounter`, each goroutine writes to a per-P shard, readers sum across shards. 10-20x throughput improvement under heavy contention.

**51. Your production service runs on amd64. You add an `int64` field to a struct. Is it safe to use `atomic.AddInt64` on it?**

On amd64, yes (alignment is automatic). On 32-bit ARM, no (alignment is not guaranteed unless the field is first or you use `atomic.Int64`). For portability, always use `atomic.Int64`.

**52. Code review: someone writes `if atomic.LoadInt32(&flag) == 0 { atomic.StoreInt32(&flag, 1); doSetup() }`. Bug?**

Yes — two goroutines can both see flag=0, both store 1, both call doSetup. This is the classic non-atomic test-and-set. The fix is `atomic.CompareAndSwap(&flag, 0, 1)`, or use `sync.Once`.

**53. Code review: someone uses `atomic.Pointer[Config]` for the config and the config struct has a slice field that is sometimes mutated. Bug?**

Yes — the published `*Config` must be immutable. Mutating the slice racing with readers who already loaded the pointer is undefined. Either build a new Config on every update, or document that the slice must not be mutated.

**54. A junior wants to use `atomic.Value` for a config pointer. You override?**

Yes, for new code. `atomic.Pointer[Config]` is faster (no boxing), type-safe at compile time (no `.(*Config)` assertion), and clearer. `atomic.Value` was the answer pre-generics; Go 1.19+ has a better one.

**55. Your benchmark shows `atomic.Int64.Add` taking 80ns instead of the expected 10ns. What is likely happening?**

False sharing. Another hot atomic shares the cache line. Pad with `_ [56]byte` and re-measure. Typical fix: 10x throughput recovery.

**56. Production code uses `atomic.Int64` everywhere, but a customer reports crashes on `linux/arm/v7`. What is the likely cause?**

Pre-Go 1.19, this was the 32-bit ARM alignment trap. In Go 1.19+, `atomic.Int64` should be safe (the `align64` magic types it carries handle alignment). But if the customer is on Go 1.18 or earlier, the trap returns. Upgrade Go, or move the field to be first in the struct.

**57. Should the body of a CAS loop allocate?**

No. Each retry repeats the allocation. Under contention this churns garbage. Move allocations outside the loop or accept that you have a contention problem worth a different design.

**58. When is a spinlock OK in Go?**

Almost never. Go's scheduler cannot preempt a spinning goroutine on cooperative scheduler models, and the goroutine consumes a full CPU. `sync.Mutex` spins briefly and then parks via futex, which is what you want. The runtime uses spinlocks internally in a few low-level places (e.g., during stack copies) but application code should not.

---

## Section J — Performance and engineering judgement

**59. You have a global counter incremented millions of times per second. What is the right primitive?**

Sharded atomic counters (one per logical CPU), padded to a cache line, summed lazily by readers. This is the Prometheus pattern.

**60. You have a configuration object updated once per minute and read on every request. What is the right primitive?**

`atomic.Pointer[Config]`. Readers do one atomic load with zero contention. Updates allocate a new Config and Store it. No mutex.

**61. You have a buffer with read and write positions, updated by one producer and one consumer. What is the right primitive?**

A pair of `atomic.Uint64` (head and tail) for a single-producer-single-consumer ring buffer. No mutex needed. This is the LMAX Disruptor pattern, used in high-performance trading systems and stream processors.

**62. You have a complex state machine with 5 fields that must be updated together. What is the right primitive?**

`sync.Mutex` over the struct. Atomics cannot give you joint updates of 5 fields. If the read-to-write ratio is high, consider `RWMutex` — but only if the read path is large enough that one extra atomic does not dominate.

**63. Why is `sync.RWMutex` not always better than `sync.Mutex` for read-heavy workloads?**

`RLock`/`RUnlock` are more expensive than `Lock`/`Unlock` (more atomics on the fast path). The break-even is roughly 1000+ readers per writer with non-trivial read critical sections. For small critical sections, a plain mutex is faster.

**64. Production has 10,000 concurrent requests, each incrementing a shared counter. What pattern do you use?**

Sharded counter with per-P shards. The single `atomic.Uint64` becomes the bottleneck at this scale due to cache-line bouncing. Sharding spreads the writes across cores.

**65. You add a new metric counter to a hot path. Should you pad it?**

Default: no. Padding costs memory and is rarely needed. Profile first. If `BenchmarkX-1` is faster than `BenchmarkX-8`, suspect false sharing and add padding.

**66. Why might `atomic.Int64.CompareAndSwap` succeed in test and fail under load?**

Contention. The first goroutine wins; others lose and retry. The loop pattern handles this naturally. If your CAS is single-attempt (no loop), high load means many failed attempts; you may be silently dropping work.

**67. How do you measure mutex contention in Go?**

```bash
go test -bench=. -mutexprofile=mu.prof
go tool pprof mu.prof
```

In production, enable with `runtime.SetMutexProfileFraction(1)` (cost: ~5% overhead with rate 1; rate 100 samples 1% of contention events).

**68. What is the largest atomic operation in `sync/atomic`?**

64-bit (Int64, Uint64, Pointer on 64-bit platforms). Go does not expose 128-bit CAS publicly. The runtime uses double-word CAS internally for some structures but it is not part of the public API.

**69. Why is there no `atomic.Float64`?**

Float arithmetic does not map to a single atomic instruction (there is no `LOCK FADD`). Operations like "add" on a float require a CAS loop (load bits, compute new float, CAS new bits). The Prometheus counter shows this pattern: store the float as `uint64` bits, CAS-loop for `Add(float)`.

**70. What does `sync.Once.Do` cost on the fast path?**

One `atomic.LoadUint32`. If `done` is 1, return immediately. The slow path takes a mutex and runs the function once. So calling `Once.Do` repeatedly after the first call costs essentially the same as one atomic load.
