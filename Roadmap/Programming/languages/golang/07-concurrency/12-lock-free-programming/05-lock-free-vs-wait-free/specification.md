# Lock-Free vs Wait-Free — Specification

## Table of Contents
1. [Purpose](#purpose)
2. [Notation and Model](#notation-and-model)
3. [Progress Definitions](#progress-definitions)
4. [Containment Relations](#containment-relations)
5. [Consensus Numbers](#consensus-numbers)
6. [The Universal Construction](#the-universal-construction)
7. [Linearisability](#linearisability)
8. [Bounded Variants](#bounded-variants)
9. [Go Mapping](#go-mapping)
10. [References](#references)

---

## Purpose

This document gives precise, falsifiable definitions of the four progress classes — blocking, obstruction-free, lock-free, wait-free — and of the auxiliary notions used to classify primitives and algorithms. The goal is to give engineers and reviewers a shared vocabulary that admits proof rather than argument by assertion.

All definitions follow Herlihy's 1991 *Wait-Free Synchronization* (ACM TOPLAS) and Herlihy and Shavit's *The Art of Multiprocessor Programming* (2nd ed.). Where Go-specific terms are used, the mapping to the formal model is given explicitly.

---

## Notation and Model

### Threads

A *thread* is a sequential entity that executes a deterministic algorithm. In Go, a thread corresponds to a goroutine; the goroutine-to-OS-thread mapping is irrelevant to the model.

### Steps

A *step* of thread T is a single atomic primitive operation by T: a load, store, atomic add, CAS, or other hardware-supported atomic. Local computation between primitives is not counted as a step in the progress sense.

### Operations

An *operation* of a data structure is one invocation of its public interface (e.g., `Push`, `Pop`, `Load`, `Add`). An operation is composed of zero or more steps.

### Executions

An *execution* is an interleaving of steps from one or more threads. An *infinite* execution contains infinitely many steps. A *fair* execution is one in which every thread that is *enabled* (not waiting on a blocking primitive) takes infinitely many steps.

### Adversaries

An *adversary* chooses, at each point in the execution, which thread takes the next step. Different progress classes are defined by what the adversary can do.

---

## Progress Definitions

### Blocking

An algorithm `A` for object `O` is *blocking* if there exists an execution in which some thread T invokes an operation on `O` and never returns, despite never being explicitly terminated.

Equivalently: T's progress can depend on another thread S taking a particular step. If S never takes that step, T waits forever.

Canonical example: a mutex. If T calls `Lock()` and the holder S is descheduled, T waits.

### Obstruction-Free

An algorithm `A` is *obstruction-free* if every thread that runs *in isolation* (with no other thread taking any step) completes any operation in a bounded number of steps.

Equivalently: if the adversary stops all but one thread, the lone thread finishes in a bounded number of its own steps.

Obstruction-free permits *livelock*: two or more threads can interfere indefinitely if the adversary keeps all of them running.

### Lock-Free

An algorithm `A` is *lock-free* if, in every infinite execution, infinitely many operations complete.

Equivalently: the adversary cannot construct an infinite execution in which no operation ever completes.

Lock-free permits *starvation* of individual threads. The system as a whole makes progress, but any particular thread may be unlucky forever.

### Wait-Free

An algorithm `A` is *wait-free* if there exists an integer `B(A, N)`, possibly depending on the number of threads `N`, such that every operation completes within `B` of its own steps, regardless of the adversary's choices.

Equivalently: every thread, on every operation, takes at most `B` steps before returning. Starvation is impossible. Thread failure is tolerated, because a failed thread's operations either completed (within `B` steps) or never started.

`B` is typically polynomial in `N`. Common bounds: `O(1)` (single-instruction atomics), `O(N)` (Kogan-Petrank style), `O(N log N)` (some hash tables).

---

## Containment Relations

The four classes form a strict containment chain:

```
Wait-free  ⊂  Lock-free  ⊂  Obstruction-free  ⊂  Non-blocking
                                                       |
                                                   Blocking is the
                                                   complement.
```

### Proof sketches

**Wait-free ⇒ Lock-free.** If every operation completes within `B` steps, infinitely many operations complete in any infinite execution. So infinitely many operations complete.

**Lock-free ⇒ Obstruction-free.** If a single thread runs in isolation (no other thread takes a step), every step it takes either completes an operation or moves toward completing one. By lock-freedom, *some* operation must complete; with only one thread running, that operation must be the isolated thread's. So an isolated thread makes progress.

**Obstruction-free ⇒ Non-blocking.** Trivial: obstruction-free guarantees progress in some scenario, so progress is possible, so the algorithm is non-blocking.

### Strictness

Each containment is strict:

- *Obstruction-free but not lock-free.* Two-thread STM with no helping. Each thread alone completes; together they livelock.
- *Lock-free but not wait-free.* Treiber stack, Michael-Scott queue, any CAS-loop counter.
- *Blocking but not non-blocking.* `sync.Mutex`, `sync.Cond`, channels.

---

## Consensus Numbers

The *consensus number* `cn(P)` of a primitive `P` is the maximum number of threads for which `P` can implement *consensus*.

### Consensus

A *consensus object* allows up to `N` threads to each propose a value; the object returns the same value to every thread, and that value is one of the proposed values.

### Hierarchy

| Primitive | Consensus number |
|-----------|------------------|
| Atomic read/write register | 1 |
| Test-and-set | 2 |
| Fetch-and-add | 2 |
| Single-word swap | 2 |
| `n`-process queue, stack, set | 2 |
| `m`-register assignment (atomic write of `m` registers) | `2m - 2` |
| Compare-and-swap (CAS) | infinity |
| Load-linked / store-conditional (LL/SC) | infinity |
| Double-word CAS | infinity |

### Theorem (Herlihy 1991)

A primitive `P` can implement a wait-free version of any object with operations involving up to `cn(P)` threads, and *only* such objects.

### Implications

- `atomic.AddInt64`, `atomic.SwapInt64`: consensus number 2. Wait-free for 2 threads, no wait-free implementation for 3+ threads requiring agreement.
- `atomic.CompareAndSwapInt64`: consensus number infinity. Universal.
- Read/write only: consensus number 1. No wait-free queue, stack, or set is possible.

### Why CAS suffices

CAS resolves any race between any number of threads by giving exactly one thread a clear "I won" signal. That signal is sufficient to bootstrap consensus, which is sufficient to bootstrap the universal construction, which gives wait-free implementations of any object.

---

## The Universal Construction

### Statement

Given:
- A sequential specification of an object `O`.
- CAS primitive.
- `N` threads.

There exists a wait-free, linearisable implementation of `O` for `N` threads, with per-operation step bound `O(N + M)` where `M` is the number of operations applied to the object so far.

### Construction sketch

1. The shared state is a single CAS-protected pointer to the head of a linked list of *operation records*.
2. Each thread maintains an *announcement* slot for its next operation.
3. To perform an operation, thread T:
   a. Writes its operation record into its announcement slot.
   b. Scans the announcement table, selecting the operation to append next according to a fair (e.g., round-robin) rule.
   c. CAS-appends the selected operation onto the head of the list.
   d. Replays the entire list locally to compute T's operation's return value.
4. Step (b) ensures every announced operation reaches the list within `O(N)` arrivals, giving the wait-free bound.

### Limitations

The construction has high per-operation cost (`O(M)`) and high memory traffic (every operation reads every announcement and replays the list). Specialised algorithms beat it by orders of magnitude.

### Practical significance

The construction proves that wait-free implementations exist for every object. The proof is therefore an existence result, not an engineering recipe.

---

## Linearisability

### Definition

An execution `E` is *linearisable* with respect to a sequential specification `S` if there exists a total order `L` on the operations of `E` such that:
- `L` is consistent with the partial order on operations imposed by per-thread sequence and by real-time precedence (operation `op1` precedes `op2` in `L` if `op1` returned before `op2` was invoked).
- The sequence of operations under `L` is a legal sequential execution of `S`.

An algorithm is *linearisable* if every execution it admits is linearisable.

### Orthogonality with progress

Linearisability is a *correctness* property. Progress is a *liveness* property. The two are independent:

| | Blocking | Lock-free | Wait-free |
|---|---|---|---|
| Linearisable | Mutex-protected counter | Michael-Scott queue | `atomic.Add` |
| Sequentially consistent only | Some weaker structures | Some relaxed designs | Some research designs |

### Why Go usually wants linearisable

Go's `sync/atomic` operations are sequentially consistent, which is a stronger guarantee than required for linearisability of single-operation structures. Most application code expects linearisable behaviour ("if `Push(v)` returns before `Pop()` is called, `Pop` sees `v`"). Non-linearisable designs are surprising to callers and should be documented prominently.

---

## Bounded Variants

The formal definitions above admit several useful weakenings.

### Bounded lock-free

An algorithm is *bounded lock-free* with bound `K` if every operation either completes or returns a failure indication within `K` of its own steps.

Example: CAS-loop with `K = 16` and an `errContended` return path.

A bounded lock-free algorithm is not wait-free (operations can fail), but it has a bounded per-operation step count, which is what most real systems care about.

### Population-oblivious wait-free

An algorithm is *population-oblivious wait-free* if the step bound `B` does not depend on the number of threads `N`. Few non-trivial algorithms achieve this. `atomic.Add` does (`B = 1` regardless of `N`); helping-based queues do not (`B = O(N)`).

### Wait-free in expectation

Some randomised algorithms are *wait-free in expectation*: every operation completes in expected `O(f(N))` steps, but the worst case may be unbounded. This is weaker than worst-case wait-free; for hard real-time it does not suffice.

### Practical bounds in published algorithms

| Algorithm | Class | Bound |
|-----------|-------|-------|
| `atomic.Add` (single counter) | Wait-free | `O(1)` |
| Kogan-Petrank queue | Wait-free | `O(N)` per operation |
| Yang-Mellor-Crummey wait-free queue | Wait-free | `O(N)` per operation, lower constants |
| Treiber stack | Lock-free | Unbounded |
| Michael-Scott queue | Lock-free | Unbounded |
| Universal Construction (Herlihy 1991) | Wait-free | `O(N + M)` per operation, `M` = operations applied |

---

## Go Mapping

The formal definitions apply directly to Go with the following identifications.

### Threads = goroutines

A goroutine is a thread in the formal sense. The mapping of goroutines to OS threads is handled by the runtime and does not affect the progress class of an algorithm.

### Steps = atomic primitives

A *step* in Go is one of:
- `atomic.LoadXxx`, `atomic.StoreXxx`, `atomic.AddXxx`, `atomic.SwapXxx`, `atomic.CompareAndSwapXxx`.
- A mutex `Lock` or `Unlock` (composed of underlying atomic primitives, but treated as a step for the *blocking* classification).
- A channel send or receive (composed of underlying primitives, but blocking).

Local computation between atomic primitives is not a step.

### Adversary = scheduler

The Go scheduler is the adversary in the formal sense. It can preempt a goroutine at safe points (function calls, channel operations) and at the 10ms preemption tick. The scheduler is *fair* in practice (every runnable goroutine eventually runs), but the model permits an unfair adversary, and the progress class must hold against that adversary.

### GC pauses

A GC stop-the-world pause affects all goroutines equally. Within the formal model, a GC pause is *not* an adversary action — it is a system-level halt of all threads. Progress classes are defined relative to the threads that are running, so a GC pause is invisible at the model level.

In practice, GC pauses violate the spirit of wait-freedom for hard real-time. Application code that needs wait-free *despite* GC pauses must use a runtime that does not have GC pauses, which Go is not.

### Specific operations

| Go construct | Class | Bound |
|--------------|-------|-------|
| `atomic.LoadInt64` | Wait-free | 1 step |
| `atomic.StoreInt64` | Wait-free | 1 step |
| `atomic.AddInt64` | Wait-free | 1 step |
| `atomic.CompareAndSwapInt64` (single call) | Wait-free | 1 step |
| `for { ... atomic.CompareAndSwap ... }` | Lock-free | Unbounded |
| `sync.Mutex.Lock` (uncontended) | Blocking | 1-2 steps (effectively wait-free) |
| `sync.Mutex.Lock` (contended) | Blocking | Unbounded wait |
| `sync.RWMutex.RLock` | Blocking | Bounded if no writer, unbounded otherwise |
| `chan` send (room available) | Mixed (mutex protected) | Bounded with no contention |
| `chan` send (full) | Blocking | Unbounded |
| `sync.Once.Do` (first call) | Blocking | Unbounded |
| `sync.Once.Do` (subsequent) | Wait-free | 1 step (one atomic load) |
| `sync.Map.Load` (hot key) | Wait-free | 1 step (in steady state) |
| `sync.Map.Load` (miss) | Blocking | Mutex-bounded |
| `sync.Pool.Get` (per-P) | Lock-free | Bounded under fast path |
| Treiber stack `Push` / `Pop` | Lock-free | Unbounded |
| Michael-Scott queue `Enqueue` / `Dequeue` | Lock-free | Unbounded |
| Kogan-Petrank queue | Wait-free | `O(N)` per operation |
| `time.Now` (vDSO path) | Wait-free | 1 step |

---

## References

- Maurice Herlihy, *Wait-Free Synchronization*, ACM Transactions on Programming Languages and Systems 13(1), 1991. The foundational paper. Defines the hierarchy, proves the consensus impossibility, introduces the universal construction.
- Maurice Herlihy, *A Methodology for Implementing Highly Concurrent Data Objects*, ACM TOPLAS 15(5), 1993. Refines and extends the 1991 universal construction.
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, 2nd ed., Morgan Kaufmann, 2020. Chapters 3-5 give the canonical textbook treatment.
- Alex Kogan and Erez Petrank, *Wait-Free Queues With Multiple Enqueuers and Dequeuers*, PPoPP 2011. The reference wait-free queue with `O(N)` per-operation bound.
- Maged Michael and Michael Scott, *Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms*, PODC 1996. The lock-free queue.
- R. K. Treiber, *Systems Programming: Coping with Parallelism*, IBM Research Report RJ 5118, 1986. The lock-free stack.
- Maurice Herlihy and Jeannette Wing, *Linearizability: A Correctness Condition for Concurrent Objects*, ACM TOPLAS 12(3), 1990. The formal definition of linearisability.
- *The Go Memory Model*, https://golang.org/ref/mem. Go's memory ordering rules.
- The Go runtime source, particularly `src/sync/`, `src/runtime/`, and `src/sync/atomic/`. Working examples of mutex, lock-free, and wait-free designs in production code.
