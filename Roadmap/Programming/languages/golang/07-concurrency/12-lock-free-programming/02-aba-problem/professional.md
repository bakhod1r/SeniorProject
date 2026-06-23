# The ABA Problem — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [DWCAS on x86_64 and ARM64](#dwcas-on-x86_64-and-arm64)
3. [Tagged Pointers on Real Hardware](#tagged-pointers-on-real-hardware)
4. [Hazard Pointers in Production Libraries](#hazard-pointers-in-production-libraries)
5. [Folly's `HazPtr`](#follys-hazptr)
6. [Java's `VarHandle` and JEP 188](#javas-varhandle-and-jep-188)
7. [Linux Kernel RCU as ABA Defence](#linux-kernel-rcu-as-aba-defence)
8. [Wait-Free Queues That Sidestep ABA](#wait-free-queues-that-sidestep-aba)
9. [Postmortem — The Concurrent Map Corruption Bug](#postmortem--the-concurrent-map-corruption-bug)
10. [Postmortem — The Pooled Buffer Use-After-Free](#postmortem--the-pooled-buffer-use-after-free)
11. [Postmortem — The Wrapped Counter Wraparound](#postmortem--the-wrapped-counter-wraparound)
12. [Cross-References to Adjacent Topics](#cross-references-to-adjacent-topics)
13. [Summary](#summary)

---

## Introduction

The professional level is where lock-free programming meets production reality. You have read the Michael and Scott paper, written a hazard-pointer-protected stack, stress-tested it, and now you are looking at an incident report that says "memory corruption in the connection-tracking ring buffer." This file collects what experience teaches once the theory is in place.

The themes:

- Real hardware constrains the design. DWCAS exists on x86_64 (`CMPXCHG16B`) but not all ARM cores; pointer-tagging schemes depend on architectural conventions (TBI on ARMv8.5, MTE on ARMv8.5+).
- Production libraries (Folly, `liburcu`, Java's `j.u.c.atomic`) have made specific choices you should know.
- Postmortems are where the field consolidates its knowledge. We will walk through three composite incidents drawn from public engineering writeups.
- Wait-free queues like LCRQ and Yang and Mellor-Crummey's queue avoid ABA entirely by construction. Understanding why is the senior insight that promotes to staff.

Throughout, we assume you have read senior.md and can implement hazard pointers and EBR. The goal here is the long tail of details that come up in incident reviews and design documents.

---

## DWCAS on x86_64 and ARM64

**Double-word CAS (DWCAS)** compares and swaps two adjacent machine words atomically. On x86_64 the instruction is `CMPXCHG16B`, which atomically compares an 128-bit value in `RDX:RAX` against memory and replaces with `RCX:RBX` if equal. The instruction is present on all 64-bit x86 CPUs since the Athlon 64 (2003) and is the foundation of tagged-pointer schemes that pack `(pointer, gen)` into 128 bits.

```asm
; pseudo-asm for atomic 128-bit CAS
lock cmpxchg16b [rdi]
; on success: ZF=1, memory updated to RCX:RBX
; on failure: ZF=0, RDX:RAX loaded with the current memory value
```

On ARM64 there is no direct DWCAS instruction. The equivalent is built from a load-exclusive pair (`LDXP`) and store-exclusive pair (`STXP`):

```asm
1:  ldxp x0, x1, [x2]
    cmp  x0, x3
    bne  2f
    cmp  x1, x4
    bne  2f
    stxp w5, x6, x7, [x2]
    cbnz w5, 1b
    ; success
    b    3f
2:  clrex
3:
```

ARMv8.1 added `CASP` (compare-and-swap pair) for cores that implement the LSE atomics extension, giving single-instruction DWCAS on modern ARM. Apple Silicon, AWS Graviton 3+, and recent Snapdragon cores all support it; older Cortex-A53 and many embedded ARM cores do not.

### DWCAS in Go

Go's `sync/atomic` does not expose DWCAS. The standard wrappers (`CompareAndSwapInt64`, `atomic.Pointer.CompareAndSwap`) operate on a single machine word. To use DWCAS in Go you must either:

1. **Call out to assembly.** Write a `.s` file with the `CMPXCHG16B` sequence and link it via `//go:linkname` or a Go stub. The `unsafe` boundary is unavoidable.
2. **Use cgo to a C atomic.** `__atomic_compare_exchange_n` with a 16-byte type compiles to `CMPXCHG16B`. Cgo crossing costs roughly 50-100 ns per call, which kills the lock-free win.
3. **Wrap a `*tagged` struct.** This is what middle.md showed. Allocation per modification, but in Go's GC this is acceptable for most workloads.

For nearly all Go code, option 3 is correct. Options 1 and 2 are for high-end performance work in libraries like `chronos` (time series), `weaveworks/mesh`, or `roaring/roaring` where allocation-free lock-free structures matter.

### DWCAS limitations

DWCAS does not solve the use-after-free problem by itself. It detects value-level ABA reliably; it does not prevent a thread from dereferencing a freed node. Hazard pointers, EBR, or GC must still handle reclamation. This is a recurring source of confusion in interviews — DWCAS is necessary but not sufficient.

A second limitation: DWCAS only protects two adjacent words. Anything that spans three or more words still needs an additional indirection or some other scheme.

---

## Tagged Pointers on Real Hardware

Pointer tagging schemes encode a counter in the high or low bits of a pointer. The two-word version (DWCAS) is portable and well-understood; the one-word version is faster but architecture-dependent.

### Single-word tagging (TBI on ARM)

On ARMv8 with **Top Byte Ignore (TBI)** enabled, the top 8 bits of a 64-bit pointer are ignored by hardware on memory accesses. You can stuff a generation counter into the top byte without affecting the address. The Linux kernel uses this for `ARM64_KASAN` and similar.

```go
// Conceptual — actual code requires unsafe and an architecture check.
type taggedPtr uint64

func pack(p *Node, gen uint8) taggedPtr {
    return taggedPtr(uintptr(unsafe.Pointer(p))) | (taggedPtr(gen) << 56)
}

func unpack(t taggedPtr) (*Node, uint8) {
    p := unsafe.Pointer(uintptr(t & 0x00ffffffffffffff))
    gen := uint8(t >> 56)
    return (*Node)(p), gen
}
```

This packs a one-byte generation in a single word. The CAS uses `atomic.Uint64.CompareAndSwap`, one word, single instruction. Allocation-free. Three problems:

1. **8-bit generation wraps in 256 increments.** Inadequate for most uses.
2. **Go GC does not see `uintptr`.** A `taggedPtr` does not pin the `*Node`. You must keep an honest `*Node` reachable somewhere else, which defeats most of the appeal.
3. **TBI is not universal.** Pre-ARMv8.5 cores might trap on tagged addresses depending on configuration.

The TBI approach is rarely used in Go. C and Rust use it more often (`tagged_ptr` crate, Folly `AtomicSharedPtr`). It is good to recognise the term in an architecture discussion.

### MTE (Memory Tagging Extension)

ARMv8.5 introduced **MTE**, which gives every 16-byte block of memory a 4-bit tag and every pointer a 4-bit tag in bits 56-59. Loads check that the pointer tag matches the memory tag; mismatch raises an exception. The intent is hardware-assisted memory-safety debugging (UAF detection).

For ABA mitigation, MTE is incidentally useful: if you change a node's tag whenever you free it, an ABA-attempted dereference will trap. The hardware does the use-after-free check that hazard pointers and EBR do in software. This is an emerging area; production Go code does not currently use it, but Pixel 8 and Apple Silicon support it. Watch this space.

### High-bit stealing on x86_64

On x86_64, virtual addresses use 48 bits (or 57 with 5-level paging on Ice Lake and newer). The high 16 bits are required to match the sign extension of bit 47 (or 56). Stealing them produces non-canonical addresses that trap on dereference. You can use them in a packed value as long as you mask them out before any access. The same caveats as TBI apply: GC-hostile, fragile, rarely worth it.

---

## Hazard Pointers in Production Libraries

Several mature C/C++ libraries provide hazard pointer infrastructure. They are worth studying because they encode lessons learned in production environments.

### `liburcu` (userspace RCU)

Originally Mathieu Desnoyers' work, then merged into the Linux Foundation. Provides four RCU flavours plus support for hazard pointers (`liburcu-cds`). The QSBR flavour is essentially EBR with a polished API. Used by DPDK, LTTng, and many high-performance C systems.

Key design choices:
- Per-thread state is kept in TLS with explicit registration (`rcu_register_thread`).
- Reclamation is deferred to per-thread call_rcu threads to avoid latency spikes.
- Memory ordering is explicit using `<urcu/uatomic.h>`.

### Boost.Lockfree (`boost::lockfree`)

Header-only C++ library with `stack`, `queue`, and `spsc_queue`. Uses tagged pointers via DWCAS internally. Provides freelist allocators that handle reclamation under DWCAS, avoiding ABA entirely.

The freelist is a stack of free nodes. When a node is reclaimed, it goes back to the freelist. The freelist's own ABA is prevented by DWCAS. This design is the canonical "tagged everywhere" approach: every CAS is DWCAS, every pointer carries a generation, and no separate reclamation scheme is needed.

### Junction (Jeff Preshing)

C++ library of lock-free hash maps. Uses QSBR (its own flavour, not liburcu) for reclamation. Junction's hash map is the basis for many production concurrent maps; the QSBR integration is the part you should study.

---

## Folly's `HazPtr`

Facebook's `folly::hazptr` is the reference implementation of hazard pointers in modern C++. The library predates and motivated the C++26 standardisation proposal (P2530). Key features:

### `hazptr_holder` RAII

A `hazptr_holder` is a stack-local object that owns a hazard pointer slot. Construction acquires a slot; destruction releases it.

```cpp
folly::hazptr_holder h;
auto* p = h.protect(atomicPtr);
// use p safely
```

`protect` does the load-publish-reload loop internally. The slot is released when `h` goes out of scope.

### `hazptr_obj_base` CRTP

Objects that participate in hazard-pointer reclamation inherit from `hazptr_obj_base`:

```cpp
class Node : public folly::hazptr_obj_base<Node> { ... };

node->retire(); // schedules reclamation
```

The CRTP gives each object a `next` pointer for the retired list, avoiding allocation in the reclamation path.

### Domain isolation

Multiple `hazptr_domain` instances can coexist, each with its own slot pool and retired list. This lets independent subsystems (network stack, storage stack) have separate reclamation budgets and avoid contention.

### Why Go does not have a `folly::hazptr` equivalent in std

`sync/atomic` is intentionally narrow — Go's standard library tends toward "one obvious way." A hazard-pointer scheme requires per-thread state that is awkward in Go (no TLS), and the GC already handles 95% of the use cases. The third-party libraries `golang-fmemcache` (internal) and `aclements/go-misc/hazptr` exist as experiments but are not production-ready.

If you need hazard pointers in Go, you write them yourself or import an experimental library and pin the version. Be prepared for a maintenance commitment.

---

## Java's `VarHandle` and JEP 188

Java's `j.u.c.atomic.AtomicReference` provides single-word CAS, equivalent to Go's `atomic.Pointer`. Java's ABA defence in the standard library is `AtomicStampedReference`, which packages a reference and an `int` stamp. The stamp acts as a generation counter; CAS succeeds only if both reference and stamp match.

```java
AtomicStampedReference<Node> head = new AtomicStampedReference<>(null, 0);
int[] stamp = new int[1];
Node oldHead = head.get(stamp);
Node newHead = ...;
head.compareAndSet(oldHead, newHead, stamp[0], stamp[0]+1);
```

Internally, `AtomicStampedReference` is implemented as an immutable `Pair(ref, stamp)` referenced by an `AtomicReference<Pair>`. CAS swaps the pair. This is exactly the tagged-wrapper pattern from middle.md, just packaged as a standard-library class.

Java 9 introduced `VarHandle`, exposing finer-grained atomic operations (acquire/release/opaque modes) but still no DWCAS in standard. JEP 188 (the value-types preview) raises the possibility of inline value types making `AtomicStampedReference` allocation-free in the future.

Java's GC plays the same role as Go's: implicit hazard pointers, eliminating use-after-free. The lesson is that "managed runtime + tagged wrapper" is a stable design point that has worked for two decades in Java and is now working in Go.

---

## Linux Kernel RCU as ABA Defence

The Linux kernel uses RCU pervasively as both a reader-side synchronisation primitive *and* a safe reclamation scheme. The relevant primitives:

- `rcu_read_lock()` / `rcu_read_unlock()` — bracket a reader critical section. Compile to disabling preemption (in CONFIG_PREEMPT_RCU=n) or a counter increment (in CONFIG_PREEMPT_RCU=y).
- `synchronize_rcu()` — wait for all pre-existing readers to exit. Used after publishing a new version of a structure.
- `call_rcu(head, func)` — schedule `func` to run after all current readers exit. Used for asynchronous reclamation.

A canonical lock-free linked list traversal in the kernel:

```c
rcu_read_lock();
list_for_each_entry_rcu(p, &mylist, link) {
    if (p->key == target) {
        do_something(p);
        break;
    }
}
rcu_read_unlock();
```

Modifying:

```c
spin_lock(&mylock);
list_del_rcu(&old->link);
spin_unlock(&mylock);
call_rcu(&old->rcu, free_old);
```

The `call_rcu` schedules `free_old(old)` to run after all readers that might still hold `old` have exited. No reader can ever see freed memory; no ABA can occur on the pointer because the freed node is not reused until safe.

RCU's design constraint is that read sections must be short and non-blocking. A reader that sleeps inside `rcu_read_lock` stalls all reclamation. In the kernel, this constraint is enforced by convention and code review. In userspace EBR, the constraint is harder to enforce, which is why hazard eras and interval-based reclamation exist.

The kernel RCU implementation is a remarkable engineering artifact. Reading McKenney's `RCU.txt` and `kernel/rcu/tree.c` gives a deeper understanding of EBR than any paper.

---

## Wait-Free Queues That Sidestep ABA

A class of queue algorithms avoid ABA entirely by design rather than by mitigation. Two that matter for professional work:

### Yang and Mellor-Crummey (PPoPP 2016)

A wait-free MPMC queue using a contiguous array of cells and a CAS-based "fast path / slow path" protocol. Each cell stores a value and a state. The cell never moves; producers and consumers index into the array; no node allocation, no node reclamation. ABA is impossible because there are no pointers to mistake.

The wait-free guarantee comes from a helping mechanism: a slow operation deposits its intent in a global descriptor, and faster operations help complete it. The descriptor itself is allocated, but its lifetime is bounded by the operation, and reclamation is simple.

### LCRQ (Morrison and Afek, PPoPP 2013)

The Linked Concurrent Ring Queue uses a linked list of fixed-size ring buffers. Within a ring, the protocol is wait-free fetch-and-add (FAA), which never has ABA because FAA is a delta operation. Crossing rings requires a CAS to advance the head/tail to the next ring, and the protocol guarantees each ring is consumed before being unlinked. The unlinked rings are reclaimed via hazard pointers or EBR.

LCRQ in benchmarks beats MS queue by 5-10x on contended workloads. It is the workhorse of high-throughput producer-consumer systems. Go implementations exist in `gammazero/deque` family and the runtime's `runqgrab`/`runqputslow` use related techniques.

### Disruptor (LMAX, 2010)

A single-writer ring buffer with multiple consumers tracking independent cursors. The single-writer property eliminates producer ABA. Consumers use atomic loads and FAA for their cursors. The Disruptor is technically not lock-free under the strict definition (a slow consumer can block all consumers) but achieves extraordinary throughput by aligning data structures to cache lines and avoiding any CAS retries on the hot path.

The pattern "use FAA where you can, CAS only at boundaries" is the LCRQ and Disruptor insight. FAA cannot ABA because there is no comparison; the hardware adds and returns. For counters, sequences, and ring indices, FAA is the right tool.

---

## Postmortem — The Concurrent Map Corruption Bug

This is a composite incident drawn from public writeups by Twitter, Netflix, and Uber engineering blogs.

### Symptoms

A concurrent map used as a session cache occasionally returned `nil` for entries that had definitely been inserted, with no error in logs. The rate was ~1 in 10^9 lookups, undetectable under normal traffic but visible during load spikes.

### Investigation

The map was implemented as an open-addressed hash table with linear probing, lock-free using CAS on each slot's `(key, value, state)` triple. Slots had four states: `EMPTY`, `INSERTING`, `OCCUPIED`, `TOMBSTONE`. Insertion CAS'd a slot from `EMPTY` to `INSERTING` to `OCCUPIED`. Deletion CAS'd from `OCCUPIED` to `TOMBSTONE`.

The bug: a slot recently transitioned `OCCUPIED → TOMBSTONE → EMPTY → INSERTING → OCCUPIED` between a reader's first probe and its eventual read of the slot. The reader was looking for key `K1`. Slot 17 once held `K1` but was tombstoned; by the time the reader inspected slot 17, it held `K2`. The reader saw `K2 != K1` and continued probing, falling off the end of the cluster and returning "not found." Meanwhile, `K1` had been re-inserted at slot 17 but the reader had already moved past.

### Root cause

The state machine transitions were ABA-vulnerable. The same slot recycled through states, and a reader interleaved with two writers observed the wrong key without ever seeing an `INSERTING` state. The CAS protocol was correct per-slot but did not provide the global invariant the lookup needed (linear probing assumes a stable cluster during a probe).

### Fix

Each slot gained a 16-bit `epoch` counter. Insertion bumped the epoch. Lookups recorded the epoch at the start and verified at the end; if the epoch had changed for any probed slot, the lookup restarted. This was the equivalent of a generation counter for the entire cluster.

### Lesson

ABA defences at the level of individual atomic operations are not enough when the algorithm's correctness depends on a wider invariant. The lookup needed "no insertion touched any probed slot," and the original CAS only enforced "this specific slot did not change." The fix added a wider observation.

In Go, the equivalent error is implementing a custom CAS-based hash table and failing to handle slot recycling. `sync.Map` sidesteps this by being a read-mostly structure with an explicit `dirty` map for writes; it never recycles slots within a logical version.

---

## Postmortem — The Pooled Buffer Use-After-Free

### Symptoms

A high-throughput RPC server occasionally returned malformed responses to clients — fields scrambled, lengths off by hundreds of bytes. The corruption was random and intermittent. `go test -race` reported nothing because the access patterns were atomically protected.

### Investigation

The server used a `sync.Pool` of byte buffers. Buffers were grabbed for request decoding, retained for response encoding, and returned to the pool on connection close. Some buffers were also referenced by a logging goroutine that asynchronously wrote a copy of each request to disk.

The logging goroutine held a `*Buffer` reference and a request ID. When it got around to logging, it would read `buf.payload` to disk. The connection handler, meanwhile, had returned the buffer to the pool. A new request grabbed the same buffer, mutated it, and the logger wrote partial old data and partial new data.

### Root cause

`sync.Pool` defeats Go's GC-as-implicit-hazard-pointers. The logging goroutine's reference to the buffer did not prevent the pool from handing the buffer to a new caller. Classic ABA: the buffer's address was reused, the logger could not tell.

### Fix

Two options were considered:

1. **Copy the payload into a private buffer before pooling.** Simple, costs an extra alloc per request. Adopted as the immediate fix.
2. **Reference-count the buffer.** The pool would only re-issue after refcount reached zero. More invasive but allocation-free.

The team chose option 1 for simplicity and option 2 for the future, with the realisation that lock-free buffer pools have ABA-like hazards and need explicit lifetime tracking.

### Lesson

`sync.Pool` is not free. Every cross-goroutine reference to a pooled object needs a lifetime story. Pools save allocation but transfer the lifetime-management burden to the application. ABA is the symptom; the underlying issue is that two goroutines disagreed about when a buffer was "in use."

This bug pattern is common enough that the standard advice is **do not put pointers across goroutine boundaries through `sync.Pool` unless you have an explicit lifetime protocol.**

---

## Postmortem — The Wrapped Counter Wraparound

### Symptoms

A trading system's order book matched two orders that should never have matched. The matcher checked an "order generation" counter to confirm the order had not been cancelled and re-submitted; if generations matched, the order was assumed valid.

The corruption was visible only in audit logs, days later, when a trader queried the trade history and saw an impossible match.

### Investigation

The order generation was a `uint32` per-customer counter. A customer who submitted, cancelled, and re-submitted 2^32 orders would see generations wrap. At 10,000 orders per second per customer, this took ~5 days. For most customers, never. For one high-frequency trading customer, it happened weekly.

After wraparound, generation `N` (recent) could equal generation `N - 2^32` (5 days ago). An audit query that referenced the old order picked up the new one. The matcher used the same field, and a delayed cancel-then-resubmit cycle landed on the same generation as an active order. The matcher matched them.

### Root cause

`uint32` was inadequate. The system had been designed when 2^32 orders per customer was thought impossible. As the trader base grew and machines got faster, the assumption silently broke.

### Fix

The field was widened to `uint64`. Migration required a schema change and a re-encoding of all in-flight orders, taking a weekend of engineering. The same pattern was audited across the codebase and several other `uint32` counters were widened preemptively.

### Lesson

Width assumptions baked into protocols and persistent state are hard to change. When in doubt, use 64 bits. The marginal cost is four bytes per counter; the marginal cost of wraparound is unbounded.

In Go this is `atomic.Uint64` rather than `atomic.Uint32`. The default in tagged-pointer wrappers, in generation counters, and in monotonic sequence numbers should be 64 bits.

---

## Cross-References to Adjacent Topics

The professional-level mental model of ABA connects to several other parts of the lock-free programming subsection.

### From [01-cas-algorithms](../01-cas-algorithms/)

CAS is the primitive ABA exploits. The CAS contract says "if old equals current, store new." It does not say "if no other thread touched this address." Understanding the gap between those two statements is the entry point to ABA.

DWCAS and LL/SC extend CAS to address ABA: LL/SC reliably detects intervening writes because the load-linked tracks the cache line, not the value. ARM's LDXR/STXR is LL/SC; LDXP/STXP is LL/SC pair. POWER is similar. x86 has no native LL/SC and relies on `CMPXCHG` or `CMPXCHG16B`.

In Go, all atomics are CAS-equivalent. There is no exposed LL/SC. The runtime uses LL/SC internally on ARM but does not surface it.

### From [03-lock-free-data-structures](../03-lock-free-data-structures/)

The Treiber stack, Michael and Scott queue, Harris linked list, and Vyukov MPMC queue all face ABA in their original C/C++ form. In Go, the GC handles many cases; the design considerations move to slot reuse, generation counters, and pooling. The relationship is bidirectional: knowing the algorithm tells you where ABA hides, and knowing ABA tells you how to read the algorithm's correctness proof.

### From [04-memory-fences](../04-memory-fences/)

Hazard pointer publication requires a store-release; the re-read requires a load-acquire. Without these orderings, a reclaimer can fail to observe a hazard. Go's seq-cst atomics give you both for free. Other languages require explicit ordering and the bugs there are subtle.

### From [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/)

Hazard-pointer-protected reads are wait-free in the strict sense: bounded steps per operation. EBR-protected reads are wait-free in the fast path but lock-free in the worst case (a stalled thread blocks advance). Wait-free queues (Yang and Mellor-Crummey, LCRQ) sidestep ABA by removing the CAS-on-pointer pattern entirely. The progress hierarchy and the ABA mitigation hierarchy align: stronger progress guarantees require stronger reclamation guarantees.

### From `03-sync-package/07-atomic`

`atomic.Pointer[T]` interacts with the GC as discussed in middle.md. Professional engineers should also know that `atomic.Value` (the older, untyped variant) has additional surprises around type stability that compound with ABA. The Go 1.19 type-parameterised atomics are unambiguously better.

---

## Summary

ABA in production is rarely just ABA. It is one face of the broader problem of safe memory reclamation, mixed with hardware constraints (DWCAS availability, MTE, TBI), library choices (Folly, liburcu, `sync.Pool`), and language semantics (GC, finalizers, `unsafe`). The professional engineer treats it as a system property to design for, not a bug to fix after the fact.

The three postmortems above are composites, but the patterns are real: state-machine slot recycling, pool-defeated GC pinning, and counter wraparound. Each was visible only under load that the original designers had not anticipated. Each fix was straightforward once the diagnosis was clear. The lesson is that lock-free code requires a fuller correctness argument than "I used CAS correctly" — it requires a memory-reclamation story, a sufficient width for all counters, and a stress-test regime that exercises slot reuse.

For Go specifically, the professional practice is:

- Default to the GC for reclamation. The performance is usually adequate.
- Use a tagged wrapper for the small fraction of lock-free code where value-level ABA can occur.
- Reach for hazard pointers or EBR only when GC pauses are unacceptable and you have a measurement to justify the complexity.
- Use 64-bit counters everywhere unless you have an audited reason not to.
- Treat `sync.Pool` as opting out of GC reclamation, and build an explicit lifetime story for any pooled object that crosses goroutine boundaries.
- Stress-test with `porcupine` or a similar linearizability checker before shipping.

The next file, specification.md, formalises the conditions under which ABA can and cannot occur, in terms of the Go memory model and the underlying hardware semantics.
