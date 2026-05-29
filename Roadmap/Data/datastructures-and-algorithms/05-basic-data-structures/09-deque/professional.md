# Deque — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Amortized Analysis of the Circular Array Deque](#amortized-analysis-of-the-circular-array-deque)
3. [Chase-Lev Work-Stealing Deque — Correctness](#chase-lev-work-stealing-deque--correctness)
4. [Lower Bounds for Concurrent Deques](#lower-bounds-for-concurrent-deques)
5. [Persistent Deques (Kaplan-Tarjan)](#persistent-deques-kaplan-tarjan)
6. [Cache-Oblivious and I/O Complexity](#cache-oblivious-and-io-complexity)
7. [Summary](#summary)

---

## Formal Definition

A **deque** is an abstract data type defined as a tuple `(S, ops)` where:

```text
S      = a finite sequence of elements from some universe U
ops    = { pushFront, pushBack, popFront, popBack,
           peekFront, peekBack, size, isEmpty }

State:  S = <a_1, a_2, ..., a_n>     (n >= 0)

Axioms (small-step semantics):

  pushFront(S, x) -> <x, a_1, ..., a_n>
  pushBack(S, x)  -> <a_1, ..., a_n, x>
  popFront(S)     -> (a_1, <a_2, ..., a_n>)   if n >= 1; undefined otherwise
  popBack(S)      -> (a_n, <a_1, ..., a_{n-1}>) if n >= 1; undefined otherwise
  peekFront(S)    -> a_1                       if n >= 1
  peekBack(S)     -> a_n                       if n >= 1
  size(S)         -> n
  isEmpty(S)      -> (n = 0)

Invariant I(S): n = |S| and the sequence is well-formed (no holes).
```

A correct implementation must preserve I(S) after every operation. The cost model is the **word-RAM model**: arithmetic, comparison, array access, and pointer dereference cost O(1).

---

## Amortized Analysis of the Circular Array Deque

We prove that the circular-array deque with doubling growth achieves **O(1) amortized cost per push and pop**, despite the O(n) cost of `grow`.

### Setup

Let the operations be a sequence `op_1, op_2, ..., op_m`. Each `op_i` is one of `pushFront`, `pushBack`, `popFront`, `popBack`. Let `c_i` be the **actual cost** of `op_i` measured as the number of array slots written.

Non-grow operations: `c_i = 1` (one slot written, indices updated).
Grow operations: `c_i = n_i + 1` where `n_i` is the size at the time of the grow (we copy `n_i` slots and then write the new element).

We will show `Sum_{i=1..m} c_i = O(m)`, hence amortized cost per operation is O(1).

### Aggregate Method

Consider a sequence that performs only pushes (the worst case for grow). Starting from initial capacity `c_0`, the deque grows when size reaches `c_0`, then `2c_0`, then `4c_0`, ..., until the final size `n <= 2c_0 * 2^k` for the smallest `k` such that `2c_0 * 2^k >= n`.

Total cost over `n` pushes:

```text
T(n) = n                           (one cost per push)
     + c_0 + 2c_0 + 4c_0 + ... + 2^k c_0   (grow copies)

       <= n + 2c_0 * 2^k
       <= n + 2n                   (since 2c_0 * 2^k <= 2n if we grow exactly when full)
       = 3n
       = O(n)
```

Therefore amortized cost per push is `T(n)/n <= 3 = O(1)`. QED for push-only sequences.

For mixed pushes and pops, the argument extends because pops do not trigger grows and each grow accounts for at most twice the size at the time of grow. We formalize this with the **potential method**.

### Potential Method (Banker's Argument)

Define a potential function `Phi: states -> R_{>=0}`:

```text
Phi(D) = max(0, 2 * size(D) - capacity(D))
```

**Properties:**

- `Phi(D_0) = 0` for an empty deque with initial capacity (size=0, so 2*0 - c_0 = -c_0 < 0, clamped to 0).
- `Phi(D) >= 0` always.
- After a grow, capacity doubles. Just before grow: `size = capacity`, so `Phi = 2*capacity - capacity = capacity`. Just after grow: `capacity_new = 2*capacity`, `size_new = size + 1 = capacity + 1`, so `Phi_new = 2*(capacity + 1) - 2*capacity = 2`. Potential released: `capacity - 2`.

**Amortized cost** of operation `op_i`:

```text
a_i = c_i + Phi(D_i) - Phi(D_{i-1})
```

**Case 1: push without grow.** Size increases by 1, capacity unchanged. `Phi` increases by 2 (if `2*size > capacity`) or stays at 0.
```text
a_i = 1 + (Phi_new - Phi_old) <= 1 + 2 = 3
```

**Case 2: push triggering grow.** Actual cost `c_i = size + 1 = capacity + 1`. Capacity doubles, size becomes `capacity + 1`.
```text
Phi_old = 2*capacity - capacity = capacity
Phi_new = 2*(capacity+1) - 2*capacity = 2
a_i = (capacity + 1) + (2 - capacity) = 3
```

**Case 3: pop.** Size decreases by 1, capacity unchanged. `Phi` decreases by 2 or stays at 0.
```text
a_i = 1 + (Phi_new - Phi_old) <= 1 - 0 = 1
```

(We can ignore shrinking the array for simplicity. Practical implementations either never shrink, or shrink only when `size < capacity/4` — same analysis with different constants.)

**Conclusion.** `a_i <= 3` for every operation. Sum over `m` operations:

```text
Sum c_i = Sum a_i - Phi(D_m) + Phi(D_0) <= 3m
```

Therefore amortized cost per operation is at most 3 = **O(1)**. QED.

### Why "Banker's" Method

The intuition: we charge each push **3 units of cost** — 1 for the actual write, and 2 deposited "in the bank". When a grow happens, the bank has accumulated enough credits (2 per push since the last grow, and there have been at least `capacity/2` pushes since last grow) to pay for the copy: `2 * capacity/2 = capacity` credits, exactly what the grow costs.

The potential function is the formal version of this bank balance.

---

## Chase-Lev Work-Stealing Deque — Correctness

The Chase-Lev deque (Chase & Lev, SPAA 2005) supports:

- `pushBottom(x)` — called only by the **owner**.
- `popBottom()` — called only by the **owner**.
- `steal()` — called by **thieves**.

Invariant of state: `bottom` index points one past the last element (next slot to write). `top` index points to the first element to be stolen. `top <= bottom`. The deque contains the elements at indices `[top, bottom)`.

### Pseudocode (simplified)

```text
struct Deque:
    array: Array      // resizeable
    top: AtomicLong   // index of next steal
    bottom: AtomicLong // index of next push

pushBottom(x):
    b = bottom.load(relaxed)
    array[b mod cap] = x
    memory_fence(release)
    bottom.store(b + 1, relaxed)

popBottom():
    b = bottom.load(relaxed) - 1
    bottom.store(b, relaxed)
    memory_fence(seq_cst)
    t = top.load(relaxed)
    if t > b:
        bottom.store(b + 1, relaxed)      // restore
        return EMPTY
    x = array[b mod cap]
    if t < b:
        return x                          // exclusive — no race
    // t == b: race with steal
    if !CAS(top, t, t + 1):
        return EMPTY                      // thief won
    bottom.store(b + 1, relaxed)
    return x

steal():
    t = top.load(acquire)
    memory_fence(seq_cst)
    b = bottom.load(acquire)
    if t >= b: return EMPTY
    x = array[t mod cap]
    if !CAS(top, t, t + 1):
        return ABORT
    return x
```

### Correctness sketch

**Claim 1 (linearizability).** Every operation appears to execute atomically at some point between its invocation and its response.

The linearization points are:
- `pushBottom`: the store to `bottom` at the end.
- `popBottom`: either the store to `bottom` (uncontended case) or the CAS on `top` (contested case).
- `steal`: the successful CAS on `top`.

**Claim 2 (safety — no element is returned twice).** Each element occupies a unique slot in `array`. An element at index `i` can be removed only by either `popBottom` (when the owner's `b` arrives at `i`) or `steal` (when a thief's `t` arrives at `i`). At index `t == b == i`, exactly one of the two CAS sequences wins: the CAS in `popBottom` and the CAS in `steal` both target `top` from value `t` to value `t+1`. Exactly one succeeds; the other returns `EMPTY` or `ABORT`. No double-take.

**Claim 3 (liveness — every steal terminates).** Steals do not loop. A failing CAS returns `ABORT` and the caller retries with a fresh `top` snapshot. There is no unbounded retry inside the operation. (System-level liveness is the responsibility of the work-stealing policy: a thief failing to steal may try another victim.)

**Claim 4 (no ABA).** The `top` index is monotonically increasing. It is never decreased by any operation. Therefore the CAS on `top` cannot succeed against a stale snapshot — if the snapshot value `t` has been incremented, the CAS fails. ABA is structurally impossible.

### Wait-freedom vs lock-freedom

Chase-Lev is **lock-free** but not **wait-free** — a `steal` can `ABORT` repeatedly if many thieves race the same victim. In practice with random victim selection this is rare; theoretical worst-case is unbounded retries. Wait-free variants exist (e.g. Le, Pop, Cohen, Nardelli, 2013) at higher constant cost.

---

## Lower Bounds for Concurrent Deques

A natural question: can we make a concurrent deque with **O(1) wait-free** operations at both ends, without atomic CAS?

The answer is **no** — a beautiful negative result.

**Theorem (Herlihy 1991, applied to deques).** Any wait-free implementation of a deque on a multiprocessor with N threads requires synchronisation primitives of **consensus number >= 2**. In particular, read/write registers (consensus number 1) are insufficient.

Sketch: the deque can solve **two-thread consensus**: thread 0 writes its proposal then `pushBack`s a sentinel; thread 1 writes then `pushBack`s; whoever's sentinel arrives first wins. Two-thread consensus requires consensus number >= 2 (Herlihy's hierarchy), which excludes load/store atomics.

Therefore: **CAS or equivalent is necessary** for any non-trivial concurrent deque. This is why all production implementations use CAS at the contested end. The lower bound is tight (Chase-Lev uses one CAS in the contested case).

A stronger result by Attiya, Hendler, and Woelfel (PODC 2008) shows that any implementation of a deque using `O(1)` memory operations per call has **linear total memory contention** in the worst case under adversarial scheduling. In production this is mitigated by per-thread deques (work-stealing) rather than a single shared deque.

---

## Persistent Deques (Kaplan-Tarjan)

A **persistent** data structure preserves all old versions — every update produces a new version, but old versions remain accessible. For deques, this is non-trivial because both ends mutate.

**Naive persistent deque:** a doubly-linked list with structural sharing. Push/pop at either end is O(n) because you must rebuild the spine.

**Kaplan-Tarjan (STOC 1995):** a persistent deque with **O(1) worst-case** push, pop, peek at both ends, supporting **catenation** (concat two deques) also in O(1).

### Structure

Kaplan-Tarjan uses **recursive slowdown**. The deque is represented as a series of "yellow", "green", and "red" buffers, where:

- Each level holds a small constant number of elements.
- The "color" tracks how close the level is to needing a rebalance.
- "Green" = stable. "Yellow" = near overflow/underflow. "Red" = forced rebalance.

When an operation makes a buffer "red", the rebalance is **lazily propagated** to the next level. The invariant: between any two "red" levels there is at least one "green" level. This bounds the rebalance work to O(1) amortized per operation, then a clever "implicit" trick converts amortized to worst-case.

### Catenation

Concatenating two deques in O(1) — concat the tails of the spines and let recursive slowdown re-stabilise lazily. This is the killer feature: most data structures cannot catenate in less than O(min(m, n)).

### Practical use

Kaplan-Tarjan deques are used in compiler middle-ends (CFG edge lists), functional language runtimes (Haskell's `Data.Sequence` uses a finger tree, which has the same O(1) ends + O(log n) splits), and any persistent setting (databases, version control, undo systems with branching history).

The full implementation is ~1000 lines of dense code and rarely shipped raw — most languages use **finger trees** (Hinze & Paterson, 2006) instead, which give O(log n) splits at the cost of O(log n) random access but with simpler implementation.

---

## Cache-Oblivious and I/O Complexity

In the **external-memory model**, the cost is measured in number of block I/Os between main memory of size `M` and disk in blocks of size `B`.

### Ring buffer deque

A naive ring buffer touches one element per push/pop. In the external-memory model:

- A sequential burst of `B` pushes touches one block: 1 I/O.
- Amortised: O(1/B) I/Os per push.
- Worst-case grow operation: O(n/B) I/Os to copy.

**Cache-oblivious amortized cost: O(1/B) per operation.** This is optimal for sequential access at both ends.

### Block-list deque (CPython, std::deque)

Block size `b` (~64 elements in CPython). Each block fits in one cache line if `b * sizeof(elem) <= 64 bytes`, which holds for pointer-sized elements.

- Push/pop at an end: O(1) main-memory operations, O(1/min(B, b)) I/Os amortized.
- New block allocation: O(b/B) I/Os, but happens once every `b` pushes — same amortization.

In practice block-lists and ring buffers are equivalent in cache I/O. Block-lists win when memory pressure causes the ring buffer's idle slack to be paged out — the block-list has no such slack.

### Doubly-linked deque

Each node is allocated on the heap. With good allocator behavior, sequentially-allocated nodes may share a cache line, but **after garbage collection** or fragmentation, they end up scattered.

- Worst case: 1 I/O per push and 1 I/O per pop (each node is a cache miss).
- This is **O(B) times worse** than the ring buffer in I/O cost.

This is the formal reason `LinkedList` benchmarks slowly — not the algorithmic complexity but the cache miss rate.

### Cache-oblivious work-stealing

Chase-Lev with a ring-buffer backing has the **same cache-oblivious cost** as the sequential ring buffer (O(1/B) amortized per local op). Stealing brings in a remote cache line — O(1) I/O — but is amortized over the many local ops between steals.

---

## Summary

| Result                                                  | Statement                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| **Amortized cost of ring-buffer push/pop**              | O(1) by the banker's method with potential `Phi = 2*size - capacity` |
| **Chase-Lev correctness**                               | Linearizable, no double-take by monotonic `top`, no ABA, lock-free not wait-free |
| **Lower bound for concurrent deque**                    | Consensus number >= 2; CAS or stronger primitive required  |
| **Persistent deque (Kaplan-Tarjan)**                    | O(1) worst-case at both ends + O(1) catenation via recursive slowdown |
| **External-memory ring buffer**                         | O(1/B) amortized I/Os per end operation                    |
| **External-memory linked list**                         | O(1) I/Os per operation — O(B) times worse than ring buffer |
| **Practical implication**                               | Cache behavior, not asymptotic complexity, drives real-world throughput |

The professional view of the deque: a structure whose simplicity hides genuine depth. The potential function for growth is a 30-second proof that justifies the doubling strategy of every dynamic-array container in every language. Chase-Lev gave us a lock-free deque that powers modern parallel runtimes. Kaplan-Tarjan gave us a persistent deque that bridges imperative and functional programming. The cache-oblivious analysis explains why `ArrayDeque` outruns `LinkedList` by an order of magnitude in real benchmarks, even though both have the same Big-O.

These results are what makes the deque worth a chapter in any serious data structures course.
