# The ABA Problem — Specification

## Table of Contents
1. [Scope](#scope)
2. [Definitions](#definitions)
3. [Necessary Conditions for ABA](#necessary-conditions-for-aba)
4. [Sufficient Conditions for ABA-Freedom](#sufficient-conditions-for-aba-freedom)
5. [Go Memory Model Interaction](#go-memory-model-interaction)
6. [Hardware-Level Specification](#hardware-level-specification)
7. [Reclamation Correctness Properties](#reclamation-correctness-properties)
8. [Tagged-Wrapper Correctness Proof Sketch](#tagged-wrapper-correctness-proof-sketch)
9. [Hazard-Pointer Correctness Proof Sketch](#hazard-pointer-correctness-proof-sketch)
10. [Compliance Checklist](#compliance-checklist)
11. [References](#references)

---

## Scope

This file gives a precise specification of the ABA problem and the conditions under which it can or cannot occur in a Go program. It is not a tutorial; it assumes familiarity with the preceding levels. It is the document you cite in a design review when arguing that a structure is or is not ABA-safe.

The specification covers:

- The formal definition of an ABA occurrence.
- Necessary and sufficient conditions in terms of program state.
- How the Go memory model (Go 1.19+ specification, June 2022 revision) constrains and enables ABA.
- Hardware-level constraints (x86 TSO, ARM relaxed, POWER relaxed) and how Go's seq-cst guarantee maps onto them.
- Correctness predicates for the mainstream mitigations.

---

## Definitions

We work in the standard interleaving semantics of concurrent threads sharing memory.

**Definition 1 (Atomic location).** A memory location `L` is **atomic** if all accesses to it use `sync/atomic` primitives (`Load`, `Store`, `CompareAndSwap`, `Add`, `Swap`).

**Definition 2 (CAS).** `CAS(L, expected, new)` is the operation: atomically, if `*L == expected`, set `*L = new` and return `true`; else return `false`.

**Definition 3 (Observation).** An **observation** of `L` is the value returned by a `Load(L)`. We write `obs_T(L, t) = v` to mean thread `T` at time `t` observed `v` from `L`.

**Definition 4 (ABA event).** An **ABA event** on `L` for thread `T` is a sequence `t_1 < t_2 < t_3 < t_4` such that:
- `obs_T(L, t_1) = A`
- Some other thread changes `L` to `B` at some time in `(t_1, t_3)`
- Some other thread (possibly the same) changes `L` back to `A` at some time in `(t_2, t_4)`
- `T` performs `CAS(L, A, X)` at `t_4` and the CAS succeeds.

The ABA event is **harmful** if the success of the CAS leads to a violation of the abstract data type's invariants. Harmless ABA events exist (e.g., a refcount that bounces 1→2→1 is harmless if the abstract semantics are commutative).

**Definition 5 (ABA-safe).** A program is **ABA-safe** if no ABA event leads to a violation of any invariant of any data type it implements.

**Definition 6 (ABA-free).** A program is **ABA-free** if no ABA event can occur. ABA-freedom implies ABA-safety; the converse does not hold.

The mitigations we discuss aim either for ABA-freedom (tagged wrappers, hazard pointers) or for ABA-safety (recognising harmless ABA, delta operations).

---

## Necessary Conditions for ABA

For an ABA event to occur on location `L`:

**N1. Value reuse.** The value `A` must be re-storable into `L`. If every store to `L` produces a unique value, ABA is structurally impossible. Monotonic counters of sufficient width are the canonical example.

**N2. Observability gap.** Thread `T` must observe `L = A` at `t_1` and again at `t_4` without observing any intervening value. If `T` would observe each intermediate value, the CAS at `t_4` would be against the intermediate, not against the original `A`. Multi-step transactions with `Load` between every CAS make N2 hard to satisfy.

**N3. Algorithmic dependence on history.** The CAS's success at `t_4` must matter to the program's correctness. A CAS that succeeds against a recycled value is harmful only if the surrounding world has changed in a way that the CAS does not detect. If the only state that matters is `L` itself, ABA is harmless.

N1, N2, and N3 are jointly necessary. Removing any one prevents harmful ABA. Concretely:

- Tagged pointers and DWCAS attack N1 by widening the value so each modification produces a unique value.
- Hazard pointers attack N2 by ensuring `T` cannot be preempted past a free without the freeing thread noticing.
- Refactoring the algorithm to be history-independent (e.g., using FAA instead of CAS) attacks N3.

---

## Sufficient Conditions for ABA-Freedom

**S1. Unique-value invariant.** If for every reachable state `s` and every store to `L` from `s`, the stored value is distinct from all previously stored values, then `L` cannot satisfy N1, so no ABA event can occur.

**S2. Continuous observation.** If thread `T` ensures that between `t_1` (first observation of `A`) and `t_4` (CAS), no other thread can store a value different from `A` to `L`, then no ABA event can occur. This is the property hazard pointers establish: the reader publishes a hazard that prevents the address from being reused.

**S3. History-independent CAS.** If the success of `CAS(L, A, X)` does not depend on any state other than `L = A`, then any ABA event is harmless. This is rare in practice — almost all CAS operations in lock-free structures depend on the surrounding state — but the principle underpins the safe use of FAA (`AddInt64`).

**S1** is the property of a sufficiently wide monotonic counter. The Go runtime relies on it for many internal sequences. With `uint64` and `Add(1)`, S1 holds for all practical executions (less than 2^64 increments per execution).

**S2** is the property of hazard pointers and EBR. Both establish that a reader's reference prevents the location from being recycled. EBR generalises this to coarser quiescence periods.

**S3** is the property of FAA-based counters and delta operations. `atomic.AddInt64(p, 1)` cannot ABA because there is no expected value to compare against.

---

## Go Memory Model Interaction

The Go memory model specification (golang.org/ref/mem, 2022 revision) is sequentially consistent for `sync/atomic` operations. We use this to derive ABA-relevant properties.

### Sequential consistency

All atomic operations in any execution have a single total order consistent with program order on each goroutine. For any two atomic operations `a` and `b`, all goroutines agree on whether `a` precedes `b`. This is stronger than the C++11 default and removes a large class of weak-memory reasoning.

The implication for ABA: if thread `T1` observes a value `A` at time `t_1` and thread `T2` writes `A → B → A` at times `t_2 < t_3`, then `T1`'s CAS at `t_4 > t_3` sees the value `T2` wrote at `t_3`. Sequential consistency does not prevent ABA; it just makes the reasoning easier. The ABA event is still possible because seq-cst is about *ordering*, not about *value uniqueness*.

### Happens-before via atomics

Go atomics establish happens-before edges. A `Store` synchronises with a subsequent `Load` that observes the stored value. A successful `CompareAndSwap` synchronises with the immediately preceding `Store` that established the expected value.

For ABA mitigations:

- The hazard-pointer publish (a Store) synchronises with the freeing thread's hazard scan (a Load). This is necessary for the freeing thread to observe the hazard.
- The tagged-wrapper swap synchronises with the next load by any thread, so the new wrapper's fields are visible after the CAS succeeds.

### `runtime.KeepAlive` semantics

`runtime.KeepAlive(x)` ensures `x` is reachable up to the call. The Go specification does not give it stronger semantics; in particular it does not establish synchronisation with the garbage collector beyond reachability. For hazard pointers using `unsafe.Pointer`, `runtime.KeepAlive` is necessary to prevent finalizer surprise but not sufficient for full ABA safety.

### Type-parameterised atomics

`atomic.Pointer[T]` (Go 1.19+) is the only safe way to do CAS on pointer types in modern Go. Earlier `atomic.LoadPointer` / `atomic.StorePointer` on `unsafe.Pointer` is still supported but type-unsafe. The Go memory model treats both identically for ordering purposes.

---

## Hardware-Level Specification

### x86 TSO (Total Store Order)

On x86 and x86_64, the hardware memory model is TSO: stores can be delayed past subsequent loads, but no other reordering. Atomic instructions with the `LOCK` prefix are full barriers. Plain aligned loads and stores are atomic and ordered.

For ABA: the hardware provides single-instruction `CMPXCHG` and `CMPXCHG16B` (DWCAS). Both are sufficient for tagged-pointer schemes. Go's `atomic.CompareAndSwap` compiles to `LOCK CMPXCHG`.

### ARM relaxed memory model

ARMv8 has a relaxed memory model with explicit acquire, release, and full-barrier flavours. Atomic operations are LL/SC (`LDXR`/`STXR`) or, on ARMv8.1+, LSE atomics (`CAS`, `CASP`, `LDADD`).

For ABA: LL/SC has the unique property that it detects *any* write to the cache line, not just a value change. A thread that does `LDXR` then `STXR` will fail the `STXR` if any other thread wrote to the line between, even if the value is the same as what `LDXR` read. This is **stronger than CAS** — LL/SC is intrinsically ABA-free for the load-store pair.

This property does not propagate through Go because Go's atomics are exposed as CAS, not LL/SC. The runtime may use LL/SC internally on ARM to implement CAS, but the API is CAS, which can ABA.

### POWER relaxed memory model

Similar to ARM: relaxed by default, explicit barriers, LL/SC via `lwarx`/`stwcx.`. Same ABA-freedom property for LL/SC.

### RISC-V

RISC-V atomics are LL/SC (`lr`/`sc`) on the A extension. Same ABA-freedom property as ARM and POWER.

### Practical implication

On weak architectures (ARM, POWER, RISC-V), the hardware would natively give us ABA-freedom for individual LL/SC pairs. Go does not expose this and instead provides CAS semantics universally. This is a portability win and an ABA-mitigation loss. In C++, `std::atomic_compare_exchange_weak` allows the compiler to use LL/SC and exposes the weaker (and ABA-immune) semantics; Go made the opposite choice.

The Go choice is defensible because most Go code does not need the LL/SC semantics, and a uniform CAS API simplifies reasoning. But it means Go programmers on ARM cannot exploit a hardware property that C++ programmers can.

---

## Reclamation Correctness Properties

A safe memory reclamation scheme must satisfy:

**R1. No premature free.** If any thread holds a reference to object `O` and may dereference it, `O` is not freed.

**R2. Eventual free.** If no thread holds a reference to `O` and no future operation will obtain one, `O` is eventually freed.

**R3. No double free.** Each allocation is freed at most once.

**R4. Bounded delay.** The time between "safe to free" and "actually free" is bounded.

GC satisfies R1, R2, R3 but not R4 (the bound depends on GC scheduling). Reference counting satisfies all four if implemented carefully. Hazard pointers satisfy all four with `O(P*H)` memory bound and `O(P*H + R)` reclamation latency. EBR satisfies R1, R2, R3 but not R4 (a stalled reader can stall reclamation indefinitely).

For an ABA-safe lock-free algorithm in Go that opts out of GC:

- Reclamation must satisfy R1, otherwise CAS-on-pointer can observe freed memory and crash (a form of harmful ABA).
- The algorithm's CAS must satisfy either S1 (unique values) or S2 (continuous observation) or S3 (history-independent).

If reclamation is GC, R1 is automatic for `*T` references and ABA is impossible for fresh-allocation algorithms. Once you reach for `sync.Pool` or `unsafe`, R1 requires explicit work.

---

## Tagged-Wrapper Correctness Proof Sketch

We prove that the middle.md tagged-wrapper stack is ABA-free.

**Claim.** For all reachable states `s` and all threads `T`, `T`'s `CompareAndSwap(state, old, next)` succeeds at time `t` only if `state == old` at `t`, and `old` is the unique `*versioned` wrapper produced by the modification that last preceded `T`'s observation.

**Proof sketch.**
- `state` holds `*versioned`. Two `*versioned` values are equal iff they point to the same allocation (Go pointer equality on unboxed pointers).
- Each successful CAS produces a fresh `*versioned` allocation. The Go allocator does not reuse heap addresses while they remain reachable; the previous wrapper remains reachable until the CAS that retired it returns, after which it is GC-eligible.
- Therefore, between the time wrapper `w_1` is published and the time wrapper `w_2` replaces it, no third wrapper can equal `w_1` by pointer identity. The GC cannot reallocate `w_1`'s address while `T` still references it.
- A CAS expecting `w_1` succeeds only if `state` still holds `w_1`. By the above, this means no other modification has occurred.

The argument hinges on the GC's reachability discipline. In a manually managed setting, the same code is **not** ABA-free because wrapper addresses can recycle. This is the same proof structure as the GC argument for fresh-node algorithms; the wrapper pattern works in Go for the same reason.

The generation counter inside the wrapper is, in this proof, redundant. The wrapper pointer identity already prevents ABA. The counter is defensive — it documents intent and would catch ABA in a future port to a non-GC environment. Some teams omit the counter; some keep it as a paranoia bit. Both are defensible.

---

## Hazard-Pointer Correctness Proof Sketch

We prove that the senior.md hazard-pointer stack is ABA-free without relying on the Go GC.

**Claim.** For all threads `T`, the pop operation never:
(a) dereferences a freed node, or
(b) succeeds in a CAS where the head has ABA-cycled.

**Proof sketch.**

For (a): the pop loop sets `hp[T] = top` after loading `top`, then re-loads the head. If the re-load differs, retry. Otherwise, between the publication of `hp[T] = top` and the next access, no thread can free `top` because the freeing thread's scan would see `hp[T] = top` and defer.

The crux is the re-read. Between the load and the re-read, suppose another thread popped `top`, retired it, and scanned. The scan happens before any subsequent free, and it sees `hp[T] = top` if the publication completed. If the publication had not completed, the re-read would observe a changed head (because the pop changed it) and retry. Either way, `T` either observes the change and retries (no UAF) or has published its hazard before the scan (also no UAF).

For (b): an ABA cycle on the head requires the head to return to `top`. For that, `top` would have to be re-pushed. But `top` cannot be re-pushed until it is reclaimed (it has been popped, so it is on the retired list). And reclamation requires `hp[T] = nil`. While `hp[T] = top`, `top` cannot be reclaimed, cannot be re-pushed, cannot ABA-cycle the head. QED.

This proof gives ABA-freedom *without* the GC. It is the property that makes hazard pointers worth their cost in non-GC environments. In Go, the GC provides the equivalent property automatically; hazard pointers are only meaningful when you opt out (sync.Pool, unsafe).

---

## Compliance Checklist

To certify a lock-free data structure as ABA-safe in Go:

- [ ] Identify every CAS in the structure.
- [ ] For each CAS, identify the value type compared.
- [ ] For each value type, determine whether values can recur (N1).
- [ ] If values can recur, apply one of:
  - Tagged wrapper (uniqueness via fresh `*versioned`)
  - DWCAS via assembly (uniqueness via 128-bit packed value)
  - Hazard pointers (continuous observation)
  - Algorithm refactor to FAA (history independence)
- [ ] If using `sync.Pool` or `unsafe` for nodes, add a reclamation scheme (hazard pointers, EBR, or refcount).
- [ ] Ensure all counters are `uint64` or wider unless wraparound is provably impossible.
- [ ] Stress-test with `GOMAXPROCS={1, 2, 4, 16}`.
- [ ] Verify with a linearizability checker (porcupine) before shipping.
- [ ] Document the ABA argument in the source as a comment.

A structure that passes all items is ABA-safe under the Go memory model and on all currently supported architectures.

---

## References

1. M. M. Michael and M. L. Scott. *Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms*. PODC 1996.
2. M. M. Michael. *Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects*. IEEE Transactions on Parallel and Distributed Systems, 15(6):491-504, 2004.
3. R. K. Treiber. *Systems Programming: Coping with Parallelism*. Technical Report RJ 5118, IBM Almaden, 1986.
4. T. L. Harris. *A Pragmatic Implementation of Non-Blocking Linked-Lists*. DISC 2001.
5. M. M. Michael. *High Performance Dynamic Lock-Free Hash Tables and List-Based Sets*. SPAA 2002.
6. K. Fraser. *Practical Lock-Freedom*. PhD thesis, University of Cambridge, 2004.
7. T. E. Hart, P. E. McKenney, A. Demke Brown. *Performance of Memory Reclamation for Lockless Synchronization*. Journal of Parallel and Distributed Computing 67(12), 2007.
8. P. Ramalhete, A. Correia. *Hazard Eras — Non-Blocking Memory Reclamation*. SPAA 2017.
9. H. Wen et al. *Interval-Based Memory Reclamation*. PPoPP 2018.
10. C. Yang and J. Mellor-Crummey. *A Wait-Free Queue as Fast as Fetch-and-Add*. PPoPP 2016.
11. A. Morrison and Y. Afek. *Fast Concurrent Queues for x86 Processors*. PPoPP 2013.
12. The Go Memory Model. https://golang.org/ref/mem (June 2022 revision).
13. Intel 64 and IA-32 Architectures Software Developer's Manual, Volume 3A, Chapter 8.
14. Arm Architecture Reference Manual for A-profile architecture, DDI 0487.
15. P. E. McKenney. *Is Parallel Programming Hard, And, If So, What Can You Do About It?* (perfbook), 2023.
16. M. Herlihy and N. Shavit. *The Art of Multiprocessor Programming*, 2nd edition. Morgan Kaufmann, 2020.
