---
layout: default
title: Specification
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/specification/
---

# Concurrent Skip List — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Skip List Invariants](#skip-list-invariants)
3. [Probabilistic Height and Expected Cost](#probabilistic-height-and-expected-cost)
4. [Sequential Algorithm (Pugh 1990)](#sequential-algorithm-pugh-1990)
5. [Concurrency Models for Skip Lists](#concurrency-models-for-skip-lists)
6. [Lock-Free Algorithm (Fraser / Harris / Pratt)](#lock-free-algorithm-fraser--harris--pratt)
7. [Marker Nodes and the Harris–Michael Deletion Lemma](#marker-nodes-and-the-harrismichael-deletion-lemma)
8. [Memory Ordering Requirements](#memory-ordering-requirements)
9. [Linearisability and Progress Guarantees](#linearisability-and-progress-guarantees)
10. [Range Query Semantics](#range-query-semantics)
11. [Memory Reclamation](#memory-reclamation)
12. [Comparison with B-Tree](#comparison-with-b-tree)
13. [Implementation Surface in Go](#implementation-surface-in-go)
14. [References](#references)

---

## Introduction

A **skip list** is a probabilistic, multi-level linked list invented by William Pugh in 1990. It substitutes Bernoulli randomisation for the rotations of a balanced binary tree, achieving the same expected `O(log n)` cost for search, insert, and delete while keeping each modification *strictly local*: the structure of one node touches only a single vertical column of pointers.

This locality is what makes skip lists attractive for concurrency. A B-tree update rebalances along an entire root-to-leaf path, sometimes across the whole tree (after node splits and merges). A skip list update touches at most `O(log n)` *individual* `next` pointers, each settable with a single CAS. There is no "page splitting" and no "rebalancing." The same property that lets skip lists exist (randomisation absorbs the work of explicit balancing) lets them be concurrent (no large invariant ever needs to be re-established atomically).

This specification gathers the formal properties that the more practical sub-pages (`junior.md`, `middle.md`, `senior.md`, `professional.md`) reference informally. Where Go-specific behaviour matters, we cite the Go memory model (`go.dev/ref/mem`); where the algorithm is language-agnostic, we cite the original papers.

---

## Skip List Invariants

Let `S` be a skip list. We label nodes with a key and a *height* `h(x) >= 1`. Each node carries an array `next[0..h(x)-1]` of forward pointers.

### Structural invariants

1. **Sorted at every level.** For every level `i` and every node `x` with `next[i] = y`, either `y` is the right sentinel `+inf` or `key(x) < key(y)`. The order at level `i+1` is a sub-sequence of the order at level `i`.

2. **Tower correspondence.** A node of height `h` appears in levels `0..h-1`. Levels above `h-1` do not point to it. If a node is present at level `i+1`, it is also present at level `i`.

3. **Bottom-level completeness.** Every present key appears at level 0. Level 0 is a sorted singly-linked list of all keys.

4. **Left and right sentinels.** `head` is a synthetic node with `key = -inf` at the maximum allowed height. `tail` is the synthetic right sentinel with `key = +inf`. Both are immortal: their identities never change.

5. **Height bound.** `1 <= h(x) <= MaxLevel`, where `MaxLevel` is chosen so that the expected number of nodes at the top level is `O(1)` for the workload size. With `p = 1/2`, `MaxLevel = 16` supports ~65 K entries; `MaxLevel = 32` supports ~4 G entries.

### Invariants that the concurrent algorithm must preserve

To these, the concurrent algorithm adds two more invariants that protect against the in-between states that linearisation requires.

6. **Marker invariant (during deletion).** A node `x` being deleted goes through three states: *live*, *marked* (a deletion flag is set on `x.next[i]` for each level, top-to-bottom), and *unlinked* (predecessors have CAS'd past it). A search must treat a marked node as already deleted.

7. **Bottom-up unlink ordering.** Although marking proceeds top-down, *unlinking* (physically removing `x` from level `i`) proceeds *bottom-up* in some variants and is order-agnostic in others. The critical rule is that no reader may observe the node "deleted at level `i`" but "present at level `j > i`" with a forward pointer that suggests it is still alive at the lower level. Marking the bottom level *last* (Lev et al. 2006) avoids this entirely: as long as `next[0]` is unmarked, the node is logically present.

---

## Probabilistic Height and Expected Cost

Pugh assigns each new node a height `h` drawn from a geometric distribution with success probability `p`:

```
P(h = k) = p^(k-1) * (1 - p)     for k = 1, 2, ...
```

Common choices are `p = 1/2` (Pugh's original) and `p = 1/4` (used by Java `ConcurrentSkipListMap` because it cuts memory by ~33% with a small constant-factor cost increase).

### Expected search cost

The number of pointer hops to locate a key is `O(log_{1/p} n)`. For `p = 1/2` this is `O(log_2 n)`. The constant factor is roughly `2` (each level, the search walks an expected geometric number of nodes before dropping).

### Expected node count per level

Level `i` contains `n * p^i` nodes in expectation. Total expected node count is `n / (1 - p)`, i.e., a constant overhead over the bottom-level singly linked list. For `p = 1/2`: `2n` pointers total; for `p = 1/4`: `4n/3 ~= 1.33 n` pointers.

### Tail bounds

Pugh's analysis (and later Devroye 1992) gives:

- `P(search > c * log_{1/p} n) <= n^(-(c-1))` for `c > 1`.

So with `p = 1/2` and `n = 2^20`, a search exceeding `60` pointer hops has probability at most `2^-40`. Worst-case is unbounded but practically irrelevant.

### Variance vs balanced trees

A red-black tree gives *deterministic* `O(log n)`. A skip list gives `O(log n)` *in expectation*, with tail probability vanishing exponentially. For high-percentile latency (P99.9), this means a small fraction of operations are slower; for throughput, the average dominates and skip lists match trees.

---

## Sequential Algorithm (Pugh 1990)

### Search

```
search(key):
    x = head
    for i = MaxLevel - 1 down to 0:
        while x.next[i].key < key:
            x = x.next[i]
    x = x.next[0]
    if x.key == key: return x
    else: return nil
```

The classic "descend and skip" loop. At each level, advance as far as possible without overshooting; then drop one level. Final answer is at level 0.

### Insert

```
insert(key, value):
    update[MaxLevel]  // predecessors at each level
    x = head
    for i = MaxLevel - 1 down to 0:
        while x.next[i].key < key:
            x = x.next[i]
        update[i] = x
    x = x.next[0]
    if x.key == key:
        x.value = value
        return
    h = randomHeight()
    new = Node(key, value, h)
    for i = 0 to h - 1:
        new.next[i] = update[i].next[i]
        update[i].next[i] = new
```

`update[]` records the rightmost predecessor at each level — exactly the nodes whose `next[i]` pointer must be redirected to the new node.

### Delete

```
delete(key):
    update[MaxLevel]
    x = head
    for i = MaxLevel - 1 down to 0:
        while x.next[i].key < key:
            x = x.next[i]
        update[i] = x
    x = x.next[0]
    if x.key != key: return
    for i = 0 to h(x) - 1:
        update[i].next[i] = x.next[i]
```

Same lookup phase, then splice each level around the victim.

### Why this is hard to make concurrent naively

Insert touches `h` predecessors. Between the moment we record `update[i]` and the moment we write `update[i].next[i] = new`, another thread can modify the structure under our feet:

- Insert a node between `update[i]` and the value we read for `update[i].next[i]` → we splice past it, losing the inserted node from level `i`.
- Delete `update[i]` itself → our write happens on a node no other thread sees.
- Insert a node with the same key → we end up with two copies.

This is the racing window that locks (coarse, fine-grained, or lock coupling) or CAS-based optimistic protocols must close.

---

## Concurrency Models for Skip Lists

Four models from most to least synchronisation:

### 1. Coarse-grained lock (a.k.a. "the global mutex")

One `sync.Mutex` protects the whole structure. Trivial correctness, terrible scalability — under contention it degrades to single-threaded performance.

### 2. Fine-grained per-node locks (Pugh's original concurrent variant)

Each node has its own lock. Insert and delete acquire locks on the predecessor at each level, validate the predecessor still points to the expected successor, and only then mutate. This is the *lock coupling* or *hand-over-hand* style.

Pugh's 1990 paper sketches this but does not prove linearisability for it. Herlihy and Shavit (*The Art of Multiprocessor Programming*, ch. 14) make the proof rigorous.

### 3. Optimistic with validation (Herlihy / Shavit 2008)

A search phase **without** holding locks. Then, before mutating, the writer acquires locks on the predecessors *and* re-validates that they still point to what was found. If validation fails, restart. This eliminates the need to hold locks during the search.

### 4. Lock-free (Fraser 2003 thesis, Harris 2001, Lev / Luchangco / Olszewski 2006)

No locks at all. Every mutation is a single CAS. Threads cooperate via *marker pointers* — a thread that observes a marker takes over and finishes the in-progress operation. This gives the strongest progress guarantee but requires careful memory reclamation (or a GC, in Go's case).

The remainder of this specification focuses on model 4.

---

## Lock-Free Algorithm (Fraser / Harris / Pratt)

### The core trick: pointer-stealing tag bits

Each `next[i]` pointer carries one extra bit (`marked`). The triple `(pointer, marked)` is updated atomically. In Go we represent this in one of three ways:

- **`atomic.Pointer[node]` plus an `atomic.Bool` per pointer.** Two separate atomics — requires a small protocol (set the bool first, then CAS the pointer) and a careful interpretation. This is closest to Harris's original "tagged pointers" but loses the *atomic two-field* property.
- **A wrapper struct `markedRef{ next *node; marked bool }` stored via `atomic.Pointer[markedRef]`.** Replaces the two fields with a single atomic pointer to an immutable triple. Used by Java `ConcurrentSkipListMap` (as `Index` and `Node` with `marker` sentinels).
- **Low-bit tagging via `unsafe`.** On all common architectures, node pointers are at least 8-byte aligned, so the low 3 bits are free. We pack the `marked` bit into bit 0. This is the most cache-friendly representation but uses `unsafe`.

The Go community libraries (`github.com/zhangyunhao116/skipset`, `github.com/MauriceGit/skiplist`) use the *marker node* variant — a sentinel `*marker` node inserted in front of a deleted node — rather than a tag bit. This is the Java approach and is described next.

### Marker nodes (Java / zhangyunhao116 style)

Instead of tagging the pointer leaving the predecessor, you insert a *marker* node immediately to the right of the deleted node:

```
... -> pred -> victim -> succ -> ...
becomes
... -> pred -> victim -> marker -> succ -> ...   (step 1)
then
... -> pred ----------------> succ -> ...        (step 2)
```

A `marker` is a node with a sentinel key that *belongs to* the victim. Any reader that crosses a marker treats the preceding victim as deleted. This makes the deletion visible *atomically* with the first CAS (insertion of the marker), even though the actual unlink (CAS skipping past `victim -> marker`) happens later.

Marker invariants:

- A marker node points only to a real node (the successor) or to `tail`.
- A marker is reachable only via the victim it tags; no other forward pointer ever points to a marker.
- A marker's `next[0]` pointer is never modified after creation.

### Insert (lock-free)

```
insert(key, value):
    while true:
        preds[], succs[] = findPredsAndSuccs(key)
        if succs[0].key == key and not marked(succs[0]):
            // already present — return existing
            return succs[0]
        h = randomHeight()
        new = Node(key, value, h)
        for i = 0 to h - 1:
            new.next[i] = succs[i]
        // CAS the bottom level first
        if !CAS(&preds[0].next[0], succs[0], new):
            continue   // retry from scratch
        // Now link upper levels; we are "logically present"
        for i = 1 to h - 1:
            while true:
                if CAS(&preds[i].next[i], succs[i], new):
                    break
                preds[], succs[] = findPredsAndSuccs(key)  // refresh
        return new
```

Two important properties:

1. **The bottom-level CAS is the linearisation point.** Once `preds[0].next[0]` has been redirected to `new`, the key is "present" in the structure for any other thread that arrives. The upper levels are optimisation; their absence merely slows down later searches.

2. **Upper-level linking can race indefinitely with deletes / inserts of nearby keys**, but progress is still guaranteed because the bottom CAS already succeeded and the upper CAS only refines.

### Delete (lock-free)

```
delete(key):
    while true:
        preds[], succs[] = findPredsAndSuccs(key)
        if succs[0].key != key: return false
        victim = succs[0]
        // Mark top-down so that the bottom mark is last (Lev et al.)
        for i = h(victim) - 1 down to 1:
            while true:
                if marked(victim.next[i]): break
                if CAS(&victim.next[i], succ, mark(succ)): break
        // Bottom level: marking is the linearisation point
        while true:
            if marked(victim.next[0]): return false   // someone else
            if CAS(&victim.next[0], succ, mark(succ)): break
        // Physical unlink (helping is allowed)
        findPredsAndSuccs(key)  // triggers unlink of marked node
        return true
```

The "physical unlink" in the last line uses the helping mechanism inside `findPredsAndSuccs`: any traversal that encounters a marked node CAS's the predecessor's `next` to skip past it. The deleter does not need to retain references to the predecessors after marking; future traversals will perform the cleanup.

### `findPredsAndSuccs` with helping

```
findPredsAndSuccs(key):
    while true:
        x = head
        for i = MaxLevel - 1 down to 0:
            x_next = x.next[i]
            // Skip over marked nodes (help unlink them)
            while marked(x_next.next[i]):
                successor = unmark(x_next.next[i])
                if !CAS(&x.next[i], x_next, successor): goto retry
                x_next = successor
            while x_next.key < key:
                x = x_next
                x_next = x.next[i]
                while marked(x_next.next[i]):
                    successor = unmark(x_next.next[i])
                    if !CAS(&x.next[i], x_next, successor): goto retry
                    x_next = successor
            preds[i] = x
            succs[i] = x_next
        return preds, succs
    retry:
        continue
```

Every traversal helps clean up. This is the *helping* principle of lock-free algorithms: there is no thread "responsible for finishing"; whoever notices the partial state pushes it to completion.

---

## Marker Nodes and the Harris–Michael Deletion Lemma

The reason markers are necessary — and why the "mark the pointer in the predecessor" approach has a subtle bug that markers fix — is captured in the *Harris–Michael lemma*:

> In any lock-free linked list using only a `marked` bit on outgoing pointers, two threads racing to insert different nodes between the same predecessor and the same successor can produce a state where one inserted node is unreachable.

The standard counterexample:

1. Thread A reads `pred.next = succ` and prepares to insert `x` between them.
2. Thread B reads `pred.next = succ` and prepares to insert `y` between them.
3. Thread A CAS's `pred.next` from `succ` to `x`. Succeeds.
4. Thread C deletes `succ` by marking `succ.next`.
5. Thread B retries; its CAS still expects `pred.next = succ` — but `pred.next` is now `x`. B reads the new state and inserts `y` between `x` and `succ`.

In a "mark the pointer" scheme, step 4 marks the outgoing pointer of `succ`. If thread B inserts between a marked predecessor and a marked successor, the chain breaks: B's CAS succeeds, but a concurrent unlink may splice past B's node.

Harris's 2001 paper closes this by requiring the *predecessor's outgoing pointer* to be checked unmarked before the CAS. Markers, the alternative used by Pugh / Lev / Java, encode the deletion **as a node in the chain** rather than a bit on a pointer. They have an algorithmic property:

> A `marker` node M tagged to a victim V is *immutable after creation*. M.next[0] is never CAS'd. The only CAS that ever involves M is the one that unlinks `(V -> M)` from the predecessor.

This immutability means that a thread following `pred.next -> V -> M -> succ` always observes consistent values: either it sees the chain intact (V logically deleted) or it has been unlinked entirely. There is no "marker exists but successor pointer is stale" state.

### Formal correctness sketch

**Theorem (linearisability of marker-based delete).** Let `T` be a thread that successfully inserts a marker tagging victim `V`. Let `r` be the moment the marker insertion CAS returns success. Then for any other thread `R` whose linearisation point is at some moment `r' > r`, `R.contains(key(V)) = false`.

**Proof sketch.** Any traversal that reaches `V` at level 0 reads `V.next[0]`. After the marker CAS, `V.next[0]` is the marker. The lock-free traversal protocol treats "successor is a marker" as "this node is deleted." Therefore `R.contains` returns false. The bottom level being the linearisation point is what makes this an *atomic* logical deletion across all levels — searches at any level eventually drop to level 0, where the marker is visible. QED (informal).

---

## Memory Ordering Requirements

Go's memory model is described in `https://go.dev/ref/mem`. Relevant guarantees:

### Atomic operations are sequentially consistent

> The APIs in the sync/atomic package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. **All the atomic operations executed in a program behave as though executed in some sequentially consistent order.** (Go 1.19+)

This is stronger than C++11's "acquire/release" or "relaxed" modes. In Go, every `atomic.CompareAndSwap`, `atomic.Load`, and `atomic.Store` is sequentially consistent with respect to every other atomic. This vastly simplifies the implementation: the algorithm's correctness only needs to be argued under sequential consistency, with no fencing concerns.

### What this means for the algorithm

- Reading `node.next[i]` via `atomic.LoadPointer` synchronises with the most recent `atomic.StorePointer` (or successful CAS) to the same address.
- The CAS that publishes a new node serves as both a release (publishing the new node's fields) and an acquire (for the reader that observes it). All fields of the new node, written before the CAS, are visible to the reader that observes the new pointer.
- We do **not** need to manually emit fences. Where C++ requires `std::memory_order_release` on publish and `std::memory_order_acquire` on read, Go's atomics already give that for free.

### Practical consequences

1. **Node initialisation must complete before the CAS.** Write `new.next[i] = succs[i]` for all `i` first, then CAS the predecessor. Once CAS succeeds, the writes to `new.next[]` are visible to every reader that observes `new` via the predecessor's pointer.

2. **Reading a marked successor.** A reader that loads `pred.next[i]` and observes a node `x` whose `x.next[0]` is marked has, by transitivity of synchronisation, observed every event that happened-before the marker insertion. This includes the deleter's local computation.

3. **The `value` field for value updates.** If we allow `value` to be updated in place (rather than allocating a new node), the update must be atomic. Use `atomic.Pointer[V]` for the value field; or replace the whole node on update.

### Anti-pattern: relaxed atomics simulated with plain reads

```go
// WRONG: reading next[i] without atomic
if n.next[0] == nil { ... }  // data race with concurrent CAS
```

Plain reads of a field that is concurrently CAS'd are data races. The race detector flags them. Always use `n.next[0].Load()` (assuming `next` is `[]atomic.Pointer[node]`).

---

## Linearisability and Progress Guarantees

### Linearisation points

Define each operation's *linearisation point* — the single moment at which the operation appears to take effect atomically:

| Operation | Linearisation point |
|---|---|
| `Get(k)` returning a node `n` | The `atomic.Load` of `n.next[0]` that observed `n` unmarked. |
| `Get(k)` returning nil | The `atomic.Load` that observed the first node with `key > k`. |
| `Insert(k, v)` of a new node | The successful CAS of `pred.next[0]` to the new node. |
| `Insert(k, v)` updating an existing | The successful CAS / atomic store on the existing node's value. |
| `Delete(k)` of a present node | The successful CAS that marks `victim.next[0]`. |
| `Delete(k)` of an absent node | The `atomic.Load` that confirmed absence. |

Linearisability follows: every concurrent execution is equivalent to some sequential execution in which each operation is placed at its linearisation point.

### Progress: lock-free, not wait-free

The algorithm is **lock-free**: at every moment, at least one thread makes progress. It is **not wait-free**: a thread can be starved indefinitely if other threads keep racing past it.

In practice:
- Under low contention: every CAS succeeds first try. Cost ~ same as sequential.
- Under high contention on a single key: starvation possible but rare; backoff and retry usually finish in O(contention) attempts.
- Under hot range-insert (sequential keys): the bottleneck is the rightmost predecessor's `next[0]`. Throughput degrades to ~the CAS bandwidth of the cache line.

To approach wait-freedom, more elaborate schemes (Kogan & Petrank's "fast-path / slow-path") exist but are rarely used because they are slower in the common case and the lock-free version's worst case is acceptable.

---

## Range Query Semantics

A range query — `Range(from, to)` returning all keys in `[from, to)` — is the operation skip lists do better than `sync.Map`.

### What is *not* guaranteed

A range query over a concurrently mutated skip list is **not** linearisable as a snapshot. Specifically:

- A key inserted between `from` and `to` *after* the iteration begins **may or may not** be observed.
- A key deleted from the range *after* the iteration begins **may or may not** be observed.

Formally: a range iteration's result corresponds to *some* set of keys present at *some* moment in `[start, end]` of the iteration — but not necessarily at any single moment.

### What *is* guaranteed

- **No key in the range that has been present continuously throughout the iteration is missed.**
- **No key outside the range is reported.**
- **Order is monotonic non-decreasing.**
- **No key is reported more than once.**

This is the "weak iterator" guarantee of Java `ConcurrentSkipListMap`. It is sufficient for most workloads (snapshotting a cache, scanning a sorted index for a UI page) and dramatically cheaper than full snapshot isolation.

### Snapshot iteration via copy-on-write

If a true snapshot is needed, the standard technique is to maintain an immutable copy reference (`atomic.Pointer[snapshot]`) updated periodically; readers read the snapshot, writers update the live tree and occasionally bump the snapshot. The trade-off is space (one snapshot worth) and write amplification.

### Range cost

`O(log n + k)` where `k` is the number of keys in the range. The `log n` is the cost to find `from`; the `k` is the cost to walk the bottom level until `to`.

---

## Memory Reclamation

In a non-GC language, the central correctness question of any lock-free linked structure is *when is it safe to free a node*. A node is safe to free only when no thread can hold a reference to it. The five canonical techniques:

### 1. Garbage collection (Go's choice)

Go solves this automatically. Once no reachable variable holds a pointer to a deleted node, the GC will eventually reclaim it. There is no manual reclamation step; `runtime.GC()` does not need to be called.

This is the dominant reason Go skip lists are simple. The Java equivalent (Doug Lea's `ConcurrentSkipListMap`) is also GC-backed and is correspondingly simple. The C/C++ equivalent (Fraser's thesis) requires *epoch-based reclamation* or *hazard pointers*, adding hundreds of lines of code and a per-thread overhead.

### 2. Hazard pointers (Michael 2004)

Each thread publishes a small array of pointers it is "currently using." Before freeing a node, the freer scans all hazard pointer arrays; if the node is referenced, freeing is deferred.

Cost: every load of a node pointer involves a publish+verify protocol (read, publish to hazard slot, re-read to verify, retry on mismatch). Typically 2 fences per pointer load.

### 3. Epoch-based reclamation (EBR, Fraser 2003)

The global clock has a monotonically increasing *epoch*. Each thread, on each operation, records the epoch it is currently working in. To reclaim, the system identifies an epoch older than all live thread epochs; any node freed before that epoch can safely be reclaimed.

Fast in the common case (one cache-line load per operation) but a slow thread can prevent reclamation indefinitely.

### 4. Reference counting (atomically incremented per traversal)

High overhead — every pointer follow involves an atomic increment. Rarely used for skip lists in practice.

### 5. RCU (Read-Copy-Update)

Used in the Linux kernel. Readers proceed without any synchronisation; writers wait for "grace periods" during which all readers have left their critical sections, then free. Requires kernel support (preemption disable) — not available in user-space Go.

### Why Go skip lists are simpler

The Java `ConcurrentSkipListMap` source is ~3000 lines. Pugh's original C implementation, plus hazard pointers, plus a memory pool would be similar. A complete Go skip list (`zhangyunhao116/skipset`) is ~600 lines because the GC removes the entire reclamation layer.

The cost: occasional GC pauses (modest in modern Go), and slightly higher memory due to deferred reclamation. The trade-off is overwhelmingly worth it.

---

## Comparison with B-Tree

| Property | Skip list | B+tree (page-based) |
|---|---|---|
| Expected lookup cost | `O(log n)` | `O(log n)` |
| Lookup constant factor | ~`2 log_2 n` pointer hops | ~`log_B n` page reads * `log_2 B` in-page comparisons |
| Memory per key | ~2 pointers (level 0) + `O(1)` upper-level pointers in expectation | ~1 pointer-share + key, packed in a page |
| Cache locality (sequential scan) | Good — `next[0]` is linear | Excellent — keys are packed in pages |
| Cache locality (random search) | Mediocre — each hop is a fresh cache line | Better — one page = many keys |
| Concurrent update cost | `O(log n)` independent CAS's | One or more pages locked along the path; splits propagate |
| Implementation complexity (concurrent) | Moderate (300–700 LOC) | High (1500+ LOC) |
| Behaviour under hot key | Single cache line contention at predecessor | Page-level contention (worse: more keys per page) |
| Range queries | `O(log n + k)`, weak snapshot | `O(log n + k)`, page-aligned, often atomic per page |
| Persistence (disk-backed) | Awkward — variable-size nodes | Native — pages are the I/O unit |
| Typical use | In-memory ordered set (memtable, index) | On-disk index (PostgreSQL, MySQL) |

### When to pick which

- **In-memory, concurrent ordered set with lots of writes:** skip list wins on simplicity and update locality. LevelDB, RocksDB, BadgerDB all use skip lists for the in-memory memtable.
- **On-disk ordered index:** B+tree wins. Page-based layout matches block I/O.
- **In-memory, mostly read:** either works; B+tree gives slightly better cache use, skip list is simpler.

### Why memtables are skip lists

The memtable in an LSM database receives random-key inserts at high rate, must support range scans for compaction, must be deletable (drop the memtable) without coordination, and must allow lookups concurrently with writes. Skip lists' update locality is exactly what is wanted; B+tree page splits would cause periodic latency spikes.

---

## Implementation Surface in Go

### Type signature (interface)

```go
type SkipList[K Ordered, V any] struct { ... }

func New[K Ordered, V any](cmp func(K, K) int) *SkipList[K, V]
func (s *SkipList[K, V]) Get(key K) (V, bool)
func (s *SkipList[K, V]) Set(key K, value V)
func (s *SkipList[K, V]) Delete(key K) bool
func (s *SkipList[K, V]) Range(from, to K, yield func(K, V) bool)
func (s *SkipList[K, V]) Len() int
```

Note: `Len` on a lock-free skip list is *cheap but loosely consistent* — typically tracked as an `atomic.Int64` updated by inserts and deletes. The reported value is a snapshot of *some* moment, not necessarily the call moment.

### Node layout (lock-free)

```go
type node[K Ordered, V any] struct {
    key   K
    val   atomic.Pointer[V]
    level uint8
    // length-`level` slice of atomic markable pointers
    next  []atomic.Pointer[markedRef[K, V]]
}

type markedRef[K Ordered, V any] struct {
    next   *node[K, V]
    marked bool
}
```

Trade-offs:

- `markedRef` is allocated on every pointer change. Modern Go GCs handle this efficiently, but a careful implementation can reuse `markedRef` instances when the underlying pointer doesn't change.
- The `level` field is fixed at construction; height never grows.
- `val` is an `atomic.Pointer[V]` to allow in-place updates.

### Marker node variant (Java-style, simpler to code in Go)

```go
type node[K Ordered, V any] struct {
    key   K
    val   atomic.Pointer[V]
    next  []atomic.Pointer[node[K, V]]
    isMarker bool   // immortal flag
}
```

A marker node has `isMarker = true` and its `next[0]` is set once at construction. Marking a victim means inserting a marker between the victim and its successor via CAS — no special pointer-bit handling needed.

### Random source

`math/rand/v2` (Go 1.22+) is goroutine-safe and far faster than `math/rand`. For per-goroutine sources, embed a `rand.PCG` in each thread's local state.

```go
func (s *SkipList[K, V]) randomHeight() int {
    h := 1
    for h < s.maxLevel && s.rng.Uint32() < s.threshold {
        h++
    }
    return h
}
```

`threshold = math.MaxUint32 * p` where `p` is the per-level probability.

### Sentinels

```go
var head = &node[K, V]{ next: make([]atomic.Pointer[node[K, V]], maxLevel) }
// tail is `nil` — searches treat the end of the level-0 chain as +inf
```

A nil successor is the cleanest sentinel; alternatively, use a dedicated `tail` node with key `+inf`.

---

## References

### Papers

- Pugh, W. (1990). *Skip Lists: A Probabilistic Alternative to Balanced Trees.* Communications of the ACM 33(6).
- Pugh, W. (1990). *Concurrent Maintenance of Skip Lists.* Tech report CS-TR-2222, University of Maryland.
- Harris, T. (2001). *A pragmatic implementation of non-blocking linked-lists.* DISC 2001.
- Fraser, K. (2003). *Practical Lock-Freedom.* PhD thesis, University of Cambridge.
- Michael, M. (2004). *Hazard pointers: safe memory reclamation for lock-free objects.* IEEE TPDS 15(6).
- Lev, Y.; Luchangco, V.; Olszewski, M. (2006). *Scalable and lock-free concurrent dictionaries.* SAC 2006.
- Herlihy, M.; Shavit, N. (2008). *The Art of Multiprocessor Programming.* Morgan Kaufmann. Chapter 14.
- Devroye, L. (1992). *A limit theory for random skip lists.* Annals of Applied Probability 2(3).

### Go libraries

- `github.com/zhangyunhao116/skipset` — Marker-node, GC-backed concurrent skip set, used in production by some Go services.
- `github.com/MauriceGit/skiplist` — Coarse-locked, optimised for sequential access.
- `github.com/huandu/skiplist` — Sequential reference implementation, no concurrency.
- `github.com/sean-public/fast-skiplist` — Lock-free, smaller API surface.

### Java reference

- `java.util.concurrent.ConcurrentSkipListMap` — Doug Lea's marker-node implementation, JDK 6+.

### Memory model

- Go memory model: `https://go.dev/ref/mem`
- C++ memory model (for comparison with manual fencing): `https://en.cppreference.com/w/cpp/atomic/memory_order`
- LevelDB memtable implementation: `https://github.com/google/leveldb/blob/main/db/skiplist.h`
