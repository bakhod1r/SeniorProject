---
layout: default
title: Cache Coherence — Specification
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/specification/
---

# Cache Coherence — Specification

## Overview

Cache coherence is a property guaranteed by hardware, not by language. The Go memory model relies on it implicitly: every `sync/atomic` operation, every channel send, every mutex Lock/Unlock depends on the underlying hardware coherence to make memory updates visible across goroutines on different cores.

This file collects what the Go language specification and the Go memory model say (directly or indirectly) about cache coherence, plus what they leave to the hardware.

## What the Go Specification Says

The Go language specification does not mention cache coherence. It speaks of:

- **Memory model**: a separate document (`https://go.dev/ref/mem`) describes happens-before relationships.
- **`sync` and `sync/atomic`**: the standard library packages that establish synchronisation.
- **Channels**: communication primitives that also synchronise.

The spec is deliberately silent on hardware. It defines the *language semantics*; the runtime and the hardware implement those semantics.

## What the Go Memory Model Says

From the Go memory model document:

> The Go memory model specifies the conditions under which reads of a variable in one goroutine can be guaranteed to observe values produced by writes to the same variable in a different goroutine.

Key points relevant to coherence:

1. **Atomic operations are synchronising.** A successful `atomic.Store(x, v)` happens-before a subsequent `atomic.Load(x)` that reads `v`.

2. **Channel operations synchronise.** A send happens-before the corresponding receive.

3. **Mutex operations synchronise.** Unlock happens-before subsequent Lock of the same mutex.

4. **No guarantee without synchronisation.** Without `sync/atomic`, channels, or mutexes, the compiler and hardware may reorder, cache, and otherwise transform memory operations.

The memory model abstracts the hardware: as long as you use the synchronising primitives, you get the visibility you need. The hardware coherence protocol is the mechanism that delivers those guarantees.

## What the Hardware Promises

The underlying hardware (x86, ARM, Apple) promises:

1. **Per-location coherence.** For any single memory location, all cores eventually agree on a sequence of values.

2. **Atomicity of aligned, naturally-sized operations.** A 64-bit load or store to an 8-byte-aligned address completes atomically.

3. **Ordering, with caveats.** x86's TSO model preserves most orderings; ARM's weak model requires fences for cross-location ordering.

The Go runtime emits the right fences and atomic instructions to bridge the language's ordering guarantees to the hardware's primitive operations.

## What is Implementation-Defined

The Go spec does not define:

- **Cache line size.** This is hardware-specific (64 or 128 bytes).
- **Coherence cost.** The cost of an atomic operation depends on the hardware state.
- **Padding behaviour.** `_ [N]byte` fields are honoured by the compiler, but the compiler does not add padding automatically.
- **Alignment within structs.** The compiler aligns to the natural alignment of each field; 64-bit atomics may need explicit alignment on 32-bit targets.

## What `sync/atomic` Specifies

The `sync/atomic` package documentation:

> These functions require great care to be used correctly. Except for special, low-level applications, synchronization is better done with channels or the facilities of the sync package.

The package guarantees:

- Atomicity of individual operations.
- 8-byte alignment for 64-bit operations (the caller is responsible for alignment on 32-bit platforms).
- Acquire-release semantics in the typed `atomic.Int64` etc., for new code.

The package does not guarantee:

- Any specific performance characteristics.
- Cache-line layout.
- Cross-architecture identical instruction encoding.

## What `sync` Specifies

The `sync` package documentation:

> Values containing the types defined in this package should not be copied.

The `noCopy` marker (via `go vet`) enforces this. Mutexes, WaitGroups, and Conds must not be copied — doing so creates two independent state words.

The package guarantees:

- Mutex: mutual exclusion.
- RWMutex: reader-writer exclusion.
- WaitGroup: counted barriers.
- Once: at-most-once initialisation.
- Pool: per-P object reuse (no specific lifetime).

The package does not guarantee:

- Fair scheduling (mutex may favour spinning goroutines briefly).
- Specific cache behaviour.

## What Channels Specify

The Go specification's channel section:

> A channel provides a mechanism for concurrently executing functions to communicate by sending and receiving values of a specified element type.

Channel send/receive synchronises sender and receiver. The hardware-level details (locks, atomic operations within the channel's internal state) are not exposed.

## What the Runtime Specifies

Internal runtime mechanisms (`runtime.GOMAXPROCS`, `runtime.NumGoroutine`, `runtime.LockOSThread`) have documented semantics but vague performance characteristics.

`runtime.LockOSThread`: pins a goroutine to its OS thread. It does *not* pin to a CPU core. The OS may migrate the thread.

`runtime.GOMAXPROCS(n)`: sets the maximum number of P (logical processors). Does not control which physical cores are used.

## What is Architectural

Cache line size, store buffer width, snoop filter capacity, NUMA latencies — these are architectural details. They are documented in:

- Intel Optimization Reference Manual.
- AMD Software Optimization Guide.
- ARM Architecture Reference Manual.
- Apple Silicon documentation.

Refer to these for specific numbers.

## What Tools Specify

`pprof`, `perf`, `perf c2c`, `benchstat` have their own specs:

- `pprof`: sampling-based CPU profile.
- `perf stat`: hardware counter aggregation.
- `perf c2c`: cache-to-cache event reporting.
- `benchstat`: statistical comparison of Go benchmarks.

These are diagnostics, not language features. Their output is interpreted in light of the hardware specs above.

## Relationship to Other Specifications

- **Java Memory Model (JMM):** similar philosophy; defines happens-before in language terms; relies on hardware coherence.
- **C++ Memory Model:** more explicit about ordering levels (relaxed, acquire, release, sequentially consistent). Go's model is roughly sequential consistency for atomics, with relaxed semantics requiring explicit care.
- **Linux Kernel Memory Model:** broader, more permissive; covers SMP synchronisation primitives.

## What This Section's Files Specify

The other files in this section provide:

- Conceptual descriptions (junior.md, middle.md).
- Design patterns (senior.md, professional.md).
- Practical exercises (tasks.md, find-bug.md, optimize.md).
- Specifications (this file).
- Interview prep (interview.md).

Together, they form a comprehensive reference. None of them is itself a formal specification; the Go memory model and `sync` / `sync/atomic` documentation are the canonical specs.

## Practical Implications of the Specification

1. **Use `sync/atomic` for shared variables.** Bare reads/writes are not safe.
2. **Use the typed atomics (`atomic.Int64`).** Better safety and alignment.
3. **Pad explicitly.** The compiler does not pad for cache lines.
4. **Trust the memory model.** Happens-before guarantees apply across all architectures.
5. **Test cross-architecture.** Performance differs; correctness should not.

## Summary

The Go specification is intentionally silent on cache coherence — a hardware concern. The Go memory model abstracts coherence via happens-before; the `sync` and `sync/atomic` packages implement it; the runtime emits the right hardware instructions. As long as you use these primitives correctly, the hardware coherence makes your program work. Cache-aware design is about *performance*, which the spec does not promise. Performance is yours to design, measure, and optimise.

## References

- Go specification: https://go.dev/ref/spec
- Go memory model: https://go.dev/ref/mem
- `sync/atomic` documentation: `go doc sync/atomic`
- `sync` documentation: `go doc sync`
- Intel Optimization Reference Manual.
- ARM Architecture Reference Manual ARMv8.

## Closing

The specification is short because the language stays out of hardware. The reality is long because the hardware is complex. Bridge the two with knowledge and discipline.

End of specification.md.

---

## Appendix: Quoted Excerpts from the Go Memory Model

A few key quotes for reference.

> Programs that modify data being simultaneously accessed by multiple goroutines must serialize such access. To serialize access, protect the data with channel operations or other synchronization primitives such as those in the sync and sync/atomic packages.

> The init function for any package runs before any other code in the same package starts.

> The go statement that starts a new goroutine happens before the goroutine's execution begins.

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

> The k-th receive on a channel with capacity C is synchronized before the (k+C)-th send from that channel completes.

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

> A successful call of l.TryLock (or l.TryRLock) is equivalent to a call of l.Lock (or l.RLock). An unsuccessful call has no synchronizing effect at all.

> For sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() is synchronized before call m of l.Lock() returns.

> For sync.Once, the call to f happens before the return of any call to once.Do(f).

> For atomic operations: If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

These quotes are the contract. Cache coherence is the mechanism. Layout is the optimisation.

---

## Appendix: How Go Compiles Atomics

For specification completeness, here is how Go's typed atomics compile.

### x86-64

```
atomic.Int64.Load()        -> MOVQ (acquire by default)
atomic.Int64.Store(v)      -> XCHGQ (implicitly LOCKed)
atomic.Int64.Add(d)        -> LOCK XADDQ
atomic.Int64.CompareAndSwap(o, n) -> LOCK CMPXCHGQ
atomic.Int64.Swap(v)       -> XCHGQ
```

### ARM64 (LSE)

```
atomic.Int64.Load()        -> LDAR (load-acquire)
atomic.Int64.Store(v)      -> STLR (store-release)
atomic.Int64.Add(d)        -> LDADD
atomic.Int64.CompareAndSwap(o, n) -> CAS
atomic.Int64.Swap(v)       -> SWP
```

### ARM64 (LL/SC, older)

```
atomic.Int64.Add(d)        -> LDXR/STXR loop
atomic.Int64.CompareAndSwap(o, n) -> LDXR/STXR loop
```

The Go toolchain picks LSE vs LL/SC based on target.

These details are implementation, not specification. The spec only says "atomic with appropriate ordering."

---

## Appendix: Alignment Specification

`sync/atomic` documentation:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned.

This is the alignment specification. For 64-bit fields in structs on 32-bit ARM:
- Place the 64-bit field first in the struct.
- Or use `atomic.Int64` (typed) which contains alignment magic.
- Or allocate explicitly with care.

64-bit platforms (amd64, arm64) have no such restriction; natural alignment suffices.

---

## Appendix: A Note on Memory Models

Memory models specify what reorderings are allowed:

| Model | Reorderings Allowed |
|-------|---------------------|
| Sequential consistency (strongest) | None |
| TSO (x86) | StoreLoad only |
| ARM, POWER (weak) | All four (LoadLoad, LoadStore, StoreLoad, StoreStore) |

Go's memory model, layered on top of these, ensures that the synchronising primitives establish happens-before. The hardware-level differences are invisible to correct Go programs.

---

## Final

This is the specification file. It is intentionally short and reference-oriented; the conceptual material is in junior/middle/senior/professional. Refer to the Go memory model and `sync/atomic` docs for authoritative specifications.

End.

---

## Long Appendix: Detailed Memory Model Walk-Through

A more thorough walk through the Go memory model with reference to coherence.

### The Happens-Before Relationship

A *happens-before* relationship between two events says: the first must be observable by the second. The Go memory model defines several sources of happens-before:

1. **Program order within a single goroutine.** Statement A in goroutine G happens-before statement B in G if A appears textually before B.

2. **Goroutine creation.** `go f()` happens-before the first instruction of `f()`.

3. **Channel send/receive.** A send on a channel happens-before the matching receive completes.

4. **Channel close.** Close happens-before a receive that returns because of the close.

5. **Mutex unlock.** Unlock happens-before a subsequent Lock of the same mutex.

6. **Mutex RUnlock.** RUnlock happens-before a subsequent Lock (write lock).

7. **WaitGroup Done.** Done happens-before Wait that returns.

8. **Once Do.** The first call to f happens-before all subsequent Do returns.

9. **Atomic operations.** A successful atomic Store happens-before atomic Load that reads the value.

These are the only sources of happens-before. Everything else (regular reads/writes, computation) is unsynchronised and may be reordered, cached, or otherwise transformed.

### How Coherence Implements Happens-Before

The hardware coherence protocol provides per-location guarantees. Combined with memory fences (inserted by the Go runtime around synchronising operations), it builds the cross-location guarantees of happens-before.

Example: Goroutine A does `x = 1; atomic.Store(&y, 2)`. Goroutine B does `if atomic.Load(&y) == 2 { read x }`.

- The atomic Store on y is a release barrier; the x = 1 store happens before it.
- The atomic Load on y is an acquire barrier; the read of x happens after.
- The hardware coherence ensures both stores eventually become visible.
- The fences ensure that "x = 1" is visible to anyone who sees "y = 2".

Without the atomic ops, the compiler or hardware might reorder x = 1 past the y = 2 store, breaking the invariant. With them, the runtime emits the necessary fences (or uses LOCK on x86) and coherence delivers the rest.

### Data Races

A data race is two concurrent accesses to the same variable, at least one a write, with no synchronising happens-before relationship between them.

The Go memory model declares the result undefined.

In practice on modern hardware:

- The hardware will still produce a coherent sequence of values for that location.
- But the compiler may have transformed the code in ways that surprise (load tearing, hoisted out of loops, etc.).
- Other variables that share a cache line may also show unexpected effects.

The race detector flags data races. Use it routinely.

### Sequential Consistency for Atomics

Go's `sync/atomic` operations are sequentially consistent for the operations on atomic variables themselves. This is stronger than C++'s relaxed atomics. For most code, this is what you want.

Sequential consistency means: all atomic ops appear to happen in a total order consistent with each goroutine's program order. No reorderings between atomic ops on different variables across goroutines.

This is implemented in hardware by:
- x86: native (TSO is close enough for atomics).
- ARM: explicit fences (DMB ISH) around atomic ops.

Cost: full fence on every atomic write, in some cases. Acceptable for typical use.

### What `sync.Map` Promises

```go
// Range calls f sequentially for each key and value present in the map.
// If f returns false, range stops the iteration.
//
// Range does not necessarily correspond to any consistent snapshot of the Map's
// contents...
```

Range is not snapshot-consistent. Other operations may proceed concurrently. This is by design — a true snapshot would require copying the entire map.

If you need a snapshot, copy explicitly:
```go
var snap = map[K]V{}
m.Range(func(k, v interface{}) bool {
    snap[k.(K)] = v.(V)
    return true
})
```

The copy is itself not atomic; later writes may not be in your snap. Document the trade-off.

### What `sync.Pool` Promises

```go
// Get returns an arbitrary item from the Pool, removes it from the Pool, and
// returns it to the caller... If Get would otherwise return nil and p.New is
// non-nil, Get returns the result of calling p.New.
```

Specifically:
- Get may return nil if the pool is empty and New is nil.
- The runtime may discard pool entries arbitrarily (typically during GC).
- Put may discard the value if the pool is at internal capacity.

Use sync.Pool for caching, not for state. A pool is not a free list with guaranteed lifetime.

### What `sync.Mutex` Promises

```go
// A Mutex must not be copied after first use.
```

The state word's identity matters. Copying creates two state words.

The mutex:
- Provides mutual exclusion.
- Is not reentrant (locking twice from the same goroutine deadlocks).
- Has starvation prevention (after 1ms wait, switches to FIFO).

### What `runtime.GOMAXPROCS` Promises

```go
// GOMAXPROCS sets the maximum number of CPUs that can be executing simultaneously
// and returns the previous setting.
```

This sets the number of Ps. Each P can run one goroutine at a time. The runtime schedules across Ps.

GOMAXPROCS does not pin to physical cores. The OS scheduler decides which physical core runs each M.

### What `runtime.LockOSThread` Promises

```go
// LockOSThread wires the calling goroutine to its current operating system
// thread. The calling goroutine will always execute in that thread, and no
// other goroutine will execute in it, until the calling goroutine has made as
// many calls to UnlockOSThread as to LockOSThread.
```

Pins goroutine to OS thread. The OS still schedules the thread freely. No CPU affinity is implied.

For CPU affinity, combine with cgo `sched_setaffinity`.

---

## Long Appendix: Hardware Specifications Cross-Referenced

A summary table of hardware aspects relevant to coherence.

| Aspect | x86-64 | ARM64 (Graviton) | Apple Silicon |
|--------|--------|------------------|----------------|
| Cache line | 64 B | 64 B | 128 B |
| Memory model | TSO | Weak | Weak |
| Atomic add | LOCK XADD | LDADD (LSE) | LDADD |
| Atomic CAS | LOCK CMPXCHG | CAS (LSE) | CAS |
| Atomic load | MOV | LDAR | LDAR |
| Atomic store | XCHG | STLR | STLR |
| Full fence | MFENCE | DMB ISH | DMB ISH |
| Cache coherence | MESI/MESIF | MESI/MOESI | MESI variant |
| Snoop filter | Yes | Yes | Yes |
| NUMA domains | Per socket | Per socket | Per cluster |

Refer to the appropriate vendor's optimization manual for definitive details.

---

## Long Appendix: A Pseudo-Formal Statement of the Go Memory Model

To be technically precise, the Go memory model can be informally summarised as:

Let `<` denote happens-before (a partial order). For variables x, y, ..., goroutines g_1, g_2, ..., and operations on those:

1. If statements A and B are in the same goroutine and A appears textually before B, then A < B.
2. For a channel c: send(c, v) < recv(c) where recv returns v.
3. For a channel c (buffered): the k-th receive < the (k + cap(c))-th send.
4. For a closed channel: close(c) < recv(c) that returns the zero value.
5. For a mutex m: unlock(m) < the next lock(m).
6. For atomic store and load: store(x, v) < load(x) that returns v.
7. For Once: the call to f < the return of all subsequent Do.

A read R of variable v is allowed to observe the value of a write W of v if and only if:
- Neither R < W nor W < R (concurrent), or
- W < R and there is no other write W' of v with W < W' < R.

This is the formal contract. The hardware (via coherence) and the compiler (via fence insertion) implement it.

---

## Long Appendix: The Relationship Between This Spec and Other Specs

- **Go spec:** defines syntax and basic semantics; silent on memory model.
- **Go memory model:** defines happens-before; depends on hardware coherence as implementation.
- **`sync/atomic` package doc:** defines per-operation semantics.
- **`sync` package doc:** defines synchronisation primitive semantics.
- **`runtime` package doc:** defines runtime-level operations.
- **Intel/AMD/ARM manuals:** define hardware-level behaviour.
- **`golang.org/x/sys/cpu`:** exposes cache-related constants.

This file is meta — it points to the others. The canonical specifications are the language documents.

---

## Long Final Summary

The Go specification does not directly address cache coherence. The Go memory model abstracts it via happens-before. The hardware delivers it via coherence protocols. The standard library uses it. Your code benefits from it whether you know it or not. Cache-aware design is performance optimisation; correctness is guaranteed by following the memory model. Use `sync/atomic` and `sync` primitives. Pad and shard for performance. Measure. Iterate.

End of specification.md.

---

## Long Appendix: Implementation Details Beyond the Specification

For completeness, here are implementation details that are *not* specified but are stable across Go versions:

### Mutex internals

- `sync.Mutex` is a 32-bit state word plus a 32-bit semaphore.
- The state word's bit layout: bit 0 locked, bit 1 woken, bit 2 starving, bits 3+ waiter count.
- Spin limit ~30 iterations before parking.
- Starvation threshold: 1ms.

### Pool internals

- `sync.Pool` has one slot per P.
- Each slot is padded to 128 bytes.
- A victim cache holds the previous GC cycle's entries.
- Entries are dropped on GC; not guaranteed to survive.

### Map internals

- `sync.Map` has read + dirty maps.
- Read map is atomically swappable.
- Promotion happens after a threshold of misses.

### Channel internals

- `hchan` is the channel struct.
- Contains qcount, sendx, recvx, lock, and waitq.
- Around 96 bytes in size.

### Allocator internals

- Per-P mcache for small allocations.
- Per-size-class mcentral shared across Ps.
- Global mheap for large allocations.
- Tiny allocator for <16B objects.

These are not part of the language specification. They may change between Go versions. Production code should not depend on these details.

For canonical specs, see the documentation. For internal details, read the source.

---

## Long Appendix: Closing Thoughts

The specification is short. The implementation is long. The hardware is complex. The Go memory model bridges them.

Use `sync` and `sync/atomic` primitives correctly, and your Go code is portable, correct, and fast on any modern hardware.

Optimize for performance with the patterns from junior/middle/senior/professional. Verify with benchmarks and hardware counters. Document layout invariants. Iterate.

The spec gives correctness. You give performance.

End.

---

## Final Notes

The Go specification, the Go memory model, the `sync/atomic` package, the `sync` package, the hardware coherence protocol, and the Go runtime: six layers, each with its own spec, working together to give you a coherent programming model.

Understanding all six is the work of years. This file is one small reference.

For deep practical material, read junior/middle/senior/professional in this section. For correctness contracts, read the linked specs.

Apply both.

End of specification.md, truly.

---

## Marker

End.

---

## Final Appendix: The Specification Loop

When in doubt about coherence behaviour:

1. Check the Go memory model document.
2. Check the `sync/atomic` package documentation.
3. Check the `sync` package documentation.
4. Read the relevant runtime source (`sync/pool.go`, etc.).
5. Read the relevant hardware vendor's manual for low-level details.

If after all that you still don't know, write a benchmark and observe. The hardware always tells the truth.

End of specification material.

End.

---

## Final Appendix

Cache coherence in Go is governed by:
- The Go language specification (silent on hardware).
- The Go memory model (defines happens-before).
- The `sync/atomic` package (atomic semantics).
- The `sync` package (synchronisation primitives).
- The runtime (implementation).
- The hardware (mechanism).

Each layer has its own spec. Together they form a coherent (pun intended) programming model.

End.
