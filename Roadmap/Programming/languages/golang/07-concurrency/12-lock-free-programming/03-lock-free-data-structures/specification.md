# Lock-Free Data Structures — Specification Level

## Table of Contents
1. [Introduction](#introduction)
2. [Linearizability](#linearizability)
3. [Progress Guarantees, Formally](#progress-guarantees-formally)
4. [Treiber Stack Linearization](#treiber-stack-linearization)
5. [Michael-Scott Queue Formal Model](#michael-scott-queue-formal-model)
6. [Harris List Correctness](#harris-list-correctness)
7. [ABA-Freedom Arguments](#aba-freedom-arguments)
8. [Memory Model Constraints](#memory-model-constraints)
9. [Summary](#summary)

---

## Introduction

This file states the formal properties that the lock-free data structures in this section are supposed to satisfy and sketches the arguments by which they satisfy them. The treatment is informal in style and rigorous in intent. The goal is that a reader can pick up Herlihy and Shavit's *The Art of Multiprocessor Programming* or the original papers and follow the formal proofs, having seen the structure of those arguments here.

The Go-specific framing matters because Go's memory model is sequentially consistent for atomic operations, which strengthens the available reasoning compared to the original C++ proofs. Several proof obligations in C++ (e.g. acquire/release pairings) collapse to "all atomics are seq-cst" in Go.

---

## Linearizability

A concurrent data structure is **linearizable** if every concurrent execution is equivalent to some sequential execution in which each operation appears to take effect at a single point — its **linearization point** — between its invocation and its response. Linearizability is the standard correctness condition for concurrent objects (Herlihy and Wing, 1990).

The proof obligation: for every method of the data structure, identify the linearization point — the single atomic instruction at which the operation's effect becomes visible to other operations.

For lock-free data structures, the linearization point is almost always a successful CAS or atomic store. The proof reduces to: every successful linearization-point operation transitions the structure between valid sequential states.

---

## Progress Guarantees, Formally

Progress conditions in increasing strength:

- **Obstruction-freedom.** A thread that runs in isolation (no other threads taking steps) completes in a bounded number of its own steps.
- **Lock-freedom.** In any execution, some thread completes in a bounded number of steps. Equivalent: the system as a whole makes progress.
- **Wait-freedom.** Every thread completes in a bounded number of its own steps regardless of other threads' behaviour.

Wait-free is the strongest and hardest. Lock-free is the standard target. Obstruction-free is rare in practice but useful in proofs.

Note: progress is a property of the algorithm, not the hardware. A wait-free algorithm running on a single core that is being context-switched out is still wait-free at the algorithmic level.

---

## Treiber Stack Linearization

The Treiber stack supports `Push(v)` and `Pop() -> (v, ok)`. The sequential state is a finite sequence `s_0, s_1, ..., s_{n-1}` with `s_0` at the bottom and `s_{n-1}` at the top.

### Linearization points

- **Push:** the successful `CAS(head, top, newNode)`. Before the CAS, `newNode` is invisible to other threads (it lives only in the pusher's local memory). After the CAS, `head` points to `newNode`, and `newNode.next` points to the previous top.

- **Pop (successful):** the successful `CAS(head, top, top.next)`. Before the CAS, `top` is still the head from other threads' perspective. After, `head` advances and the popper has captured `top.value`.

- **Pop (empty):** the load `head == nil`. The linearization point is the load itself, with the proof obligation that `head` was nil at some point during the operation's interval.

### Why these are valid linearization points

Push: a successful CAS atomically reads the old head and writes the new head. The CAS instruction is a single point on every thread's timeline. After the CAS, any subsequent thread that reads `head` sees the new node. The transition from a stack of `n` elements to `n+1` elements happens at the CAS.

Pop (successful): the CAS atomically swaps `head` from the captured `top` to `top.next`. The element popped is exactly `top.value`, which the popper has already read (before the CAS) and captured locally. The stack transitions from `n` elements to `n-1` at the CAS.

Pop (empty): if the load sees `head == nil`, the operation linearizes at the load. The proof requires that the stack was empty at the time of the load — true by construction, since `head == nil` is the empty-stack condition.

### Lock-freedom argument

Every iteration of the CAS loop either succeeds (and the operation returns) or fails because another thread's CAS succeeded. So in every iteration where the calling thread fails, some other thread has made progress. The system as a whole makes progress in every step. Lock-free.

The Treiber stack is not wait-free: a single thread can be starved by an arbitrarily-long sequence of CAS failures.

---

## Michael-Scott Queue Formal Model

The MS-queue supports `Enqueue(v)` and `Dequeue() -> (v, ok)`. The sequential state is a finite FIFO sequence.

### Invariants

- `head` and `tail` are both non-nil; they both point into the structure.
- The list reachable from `head.next` to `tail` contains the queue's elements in FIFO order.
- `head` always points to a dummy node; the first real element is `head.next`.
- `tail` points to the last node *or* to its predecessor (the "lagging tail" case).

The lagging-tail invariant captures the gap between the two CASes in `Enqueue`: between CAS-1 (linking the new node) and CAS-2 (advancing `tail`), `tail` lags by one node.

### Linearization points

- **Enqueue:** the successful `CAS(tail.next, nil, newNode)`. This is the moment the new node becomes part of the list. The subsequent `CAS(tail, oldTail, newNode)` is just maintenance; the helping pattern lets other threads complete it.

- **Dequeue (successful):** the successful `CAS(head, oldHead, oldHead.next)`. This advances head past the dummy and adopts the next node as the new dummy.

- **Dequeue (empty):** the observation `head == tail && tail.next == nil`. The linearization point is the load of `tail.next` after observing `head == tail`.

### Proof of FIFO

A node `n` becomes part of the queue when `CAS(tail.next, nil, n)` succeeds. After that, no successful `Enqueue` can place a node before `n` in the list — because the list grows only at the tail. So `n` is at position `i` and any later enqueue places its node at position `> i`. FIFO is preserved.

A dequeue removes the dummy and adopts the position-0 node as the new dummy. The element returned is the value of the new-dummy node (the former position-0 node). So elements are dequeued in their enqueue order.

### Lock-freedom argument

Enqueue: either the first CAS succeeds (progress), or another thread's CAS succeeded (their progress). After CAS-1 succeeds, CAS-2 either succeeds or has been done by a helper — in either case, the structure has advanced. So enqueue is lock-free.

Dequeue: either it succeeds, or it observes a lagging tail and helps advance it, or it observes empty. The help case makes progress on the enqueue side; the success and empty cases make progress directly. Lock-free.

Why MS-queue is not wait-free: a dequeuer can be CAS'd-out repeatedly by other dequeuers, indefinitely.

---

## Harris List Correctness

Harris's lock-free linked list supports `Find(k)`, `Insert(k, v)`, `Delete(k)` on a sorted-by-key list. The mark bit on `next` pointers carries the "logical delete" state.

### Invariants

- The list is sorted by key.
- Each node's `next` is either a plain pointer or a marked pointer.
- A node with marked `next` is logically deleted. It is still reachable from its predecessor until physical unlink completes.
- A successful insert places the new node at the unique position consistent with the sort order.

### Linearization points

- **Insert:** the successful `CAS(pred.next, ⟨curr, unmarked⟩, ⟨newNode, unmarked⟩)`. The new node becomes reachable atomically.

- **Delete:** the successful `CAS(curr.next, ⟨succ, unmarked⟩, ⟨succ, marked⟩)`. This is the **logical** delete. Physical unlink may follow but is not needed for linearization.

- **Find:** the read of `curr.key == k` and the test of `curr.next`'s mark bit. The point is the read of the mark bit: if unmarked, the key is present; if marked, the key is logically absent.

### Why the mark is the linearization point of Delete

A logical delete must be a single atomic instant. Before the mark, the node is in the list; after the mark, the node is logically removed regardless of whether anyone has unlinked it. The CAS that flips the mark bit is that instant. Subsequent physical unlink is bookkeeping.

A concurrent Insert that targeted the marked node's position will fail its own CAS (because `pred.next` no longer points to a plain unmarked reference) and must retry, observing the mark and helping unlink as part of its search.

### Lock-freedom argument

Every CAS either succeeds (own progress) or fails because another thread's CAS succeeded. Search loops are bounded by the list length plus the count of concurrent operations. Insert and Delete have a finite number of CAS retries before some operation succeeds. Lock-free.

---

## ABA-Freedom Arguments

The ABA problem applies to designs where the same value can return to a shared location after being seen by a thread. We analyse each structure.

### Treiber stack in Go

ABA requires the same node pointer to be reused. A node freed by a popper might be re-pushed by a different pusher; in C/C++, the malloc/free cycle can hand out the same address. In Go, the GC keeps the popped node alive as long as the popper holds a reference. A re-push of the same `*Node` is impossible because no other thread can construct a `*Node` that points to the same allocation; the popper's local reference pins the allocation.

This is the Go-specific ABA-freedom argument: Go's GC makes ABA on `*T` impossible in single-language code. It does not protect against ABA on integer indices or on `unsafe.Pointer` aliases to off-heap memory.

### Treiber stack with index-based slots

A version where slots are array indices needs explicit ABA protection: a version counter combined with the index in a 64-bit field, atomically updated.

### MS-queue in Go

Same reasoning. The MS-queue passes node pointers; the GC pins them; no ABA on the pointer comparisons.

### Vyukov MPMC queue

This design is ABA-immune by construction. The sequence-number protocol does not compare pointers; it compares monotonically-increasing 64-bit counters. A counter that returns to a previous value would require `2^64` operations, which is not a concern in practice.

### Harris list in Go

The `markableNext` wrapper struct is allocated fresh on every CAS. Two different threads cannot construct identical `*markableNext` values; the pointer identity protects against ABA on the wrapper.

### Hash maps with key-value tagging

Click-style hash maps embed sentinels (TOMBSTONE, PRIME) in the value, not in pointer aliasing. ABA-freedom follows from the state machine: a slot's state sequence is well-defined and never revisits a state with the same `(key, value)` pair after a delete.

---

## Memory Model Constraints

Go's memory model (revised June 2022) defines the happens-before relation in terms of synchronisation operations. Atomic operations on `sync/atomic` types are sequentially consistent: there is a total order on all atomic operations, and every thread sees this order.

### What sequential consistency buys

In a sequentially consistent model:

- Every atomic load sees the most recent atomic store in the total order.
- The order in which a single thread executes its atomic operations is preserved.
- The "Dekker-style" mutual-exclusion paradox does not arise: two threads each storing then loading see at least one of the stores.

For lock-free proofs this means: every "if I see X, then Y must have happened-before" argument that holds in textbook sequential reasoning also holds in Go.

### What sequential consistency does not buy

- Non-atomic accesses to non-atomic fields are not synchronised. A struct field that is not `atomic.Whatever` cannot be safely read concurrently with a write, even if there is an atomic op nearby.
- Memory ordering between atomic and non-atomic accesses still requires reasoning about happens-before. The standard pattern: write non-atomic data, then atomic-publish a pointer to it. Readers atomic-load the pointer, then access the non-atomic data through it. The atomic op transitively orders the data.

### The published-pointer pattern in proofs

The MS-queue's enqueue:

```go
newNode := &Node{value: v}      // (1) non-atomic init
oldTail.next.CompareAndSwap(nil, newNode) // (2) atomic publish
```

Step (1) is non-atomic; step (2) is atomic. The Go memory model says: any thread that observes `newNode` via an atomic load from `oldTail.next` sees the result of step (1) as if it had happened-before the load. This is the foundation of all "construct then publish" patterns.

For lock-free data structures, every node is constructed locally, then published via a CAS. The proof obligation per operation: every field of the new node is initialised before the CAS that publishes it. Easy to check; mostly enforced by Go's compiler ordering.

### What about ARM?

On ARM, the hardware does not provide sequential consistency natively. Go's atomics insert the necessary barriers (`dmb`, `ldar`, `stlr`) to enforce SC at the language level. The cost is real; on heavily-atomic workloads, ARM is slower than x86. But the reasoning is the same.

---

## Summary

The formal underpinnings of lock-free data structures are linearizability (correctness) and lock-freedom (progress). Each canonical structure has a documented linearization point — usually a single CAS or atomic store — at which its operation takes effect.

In Go, the proofs are simplified by sequential consistency of atomics and by garbage-collected reclamation that eliminates pointer-ABA. The simplifications are real but not total: index-based ABA, non-atomic field ordering, and progress arguments still need care.

The canonical references:

- Herlihy and Wing, *Linearizability: A Correctness Condition for Concurrent Objects* (1990) — the foundational definition.
- Herlihy and Shavit, *The Art of Multiprocessor Programming*, 2nd ed. (2020) — textbook treatment with worked proofs.
- Treiber, *Systems Programming: Coping with Parallelism* (IBM Research Report RJ 5118, 1986) — the stack.
- Michael and Scott, *Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms* (PODC 1996) — the queue.
- Harris, *A Pragmatic Implementation of Non-Blocking Linked-Lists* (DISC 2001) — the list with logical deletion.
- Click, *A Lock-Free Wait-Free Hash Table* (JavaOne 2007) — the hash map.

Read at least one of these papers before claiming you have implemented the corresponding structure.

---

## Related Topics

- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress hierarchy in detail
- [04-memory-fences](../04-memory-fences/) — Happens-before in Go atomics
- [02-aba-problem](../02-aba-problem/) — ABA cases and mitigations
- [01-cas-algorithms](../01-cas-algorithms/) — The CAS primitive
