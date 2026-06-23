---
layout: default
title: Specification
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/specification/
---

# Concurrent Trees — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [B-Tree Invariants](#b-tree-invariants)
3. [B+-Tree Invariants](#b-tree-invariants-1)
4. [The Lehman-Yao B-link Protocol](#the-lehman-yao-b-link-protocol)
5. [OLFIT / OCC Correctness](#olfit--occ-correctness)
6. [ART Invariants](#art-invariants)
7. [Bw-tree Normative Rules](#bw-tree-normative-rules)
8. [MVCC Visibility Rule](#mvcc-visibility-rule)
9. [Go Library Specifications](#go-library-specifications)
10. [References](#references)

---

## Introduction

This file collects formal invariants and protocol specifications for the concurrent tree designs covered in this section. It is normative for implementations: an implementation that violates these invariants is buggy by definition.

The major sources:

- **Bayer, McCreight (1972)**: The original B-tree paper.
- **Lehman, Yao (1981)**: The B-link tree paper, foundation of concurrent B+-trees.
- **Cha, Hwang et al. (2001)**: OLFIT paper, formalizing optimistic latch-free traversal.
- **Levandoski, Lomet, Sengupta (2013)**: The Bw-tree paper.
- **Leis, Kemper, Neumann (2013)**: ART paper.
- **PostgreSQL `src/backend/access/nbtree/README`**: Production-grade B-link description.
- **Go specification** at `go.dev/ref/spec` and memory model at `go.dev/ref/mem`.

---

## B-Tree Invariants

Bayer-McCreight 1972 B-tree of minimum degree `t` (CLRS Chapter 18).

**Per-node invariants:**

1. Every node has between `t-1` and `2t-1` keys, except the root which can have 1 to `2t-1` keys.
2. Every internal node with `k` keys has exactly `k+1` children.
3. All leaves are at the same depth.

**Per-key invariants:**

4. Keys within a node are stored in sorted order.
5. For an internal node with keys `k_1 < k_2 < ... < k_n` and children `c_0, c_1, ..., c_n`:
    - All keys in subtree rooted at `c_i` are between `k_i` and `k_{i+1}` (with `k_0 = -∞` and `k_{n+1} = +∞`).

**Height invariant:**

6. Height of a tree with `n` keys is `O(log_t n)`.

A concurrent B-tree implementation must maintain these invariants under all interleavings of concurrent operations. Failure to do so is a correctness bug.

---

## B+-Tree Invariants

B+-tree extends B-tree:

1. All keys / data reside in leaves.
2. Internal nodes contain only routing keys (separators).
3. Leaves are linked into a doubly-linked list (or singly-linked for B-link).
4. The same height, fanout, and order invariants as B-tree apply.

For range queries, the leaf linked list is traversed.

---

## The Lehman-Yao B-link Protocol

Lehman-Yao 1981 augments B+-tree with:

5. Each node has a **high key**: the largest key reachable through this node.
6. Each node has a **right sibling pointer**.

**Invariant L1 (High Key):**

For every node `N`:
- `N.highKey >= max(key reachable through N)`

**Invariant L2 (Right-Link Reachability):**

For every node `N` and every key `k > N.highKey` that exists in the tree:
- `k` is reachable through `N.rightSib` (transitively).

**Invariant L3 (Parent-Child Consistency):**

For every internal node `P` with children `C_1, C_2, ..., C_n`:
- The high keys of consecutive children are in sorted order matching P's routing keys.

**Protocol P1 (Split):**

When splitting node `N` into `N` and `M`:
1. Allocate `M`. Populate it with the upper half of `N`'s items.
2. Set `M.highKey = N.highKey`.
3. Set `M.rightSib = N.rightSib`.
4. Set `N.highKey = median key - 1` (or appropriate value).
5. Atomically set `N.rightSib = M`. **This is the publication point.**
6. Update parent to know about `M` (separate step).

After step 5, in-flight readers on `N` who see `key > N.highKey` follow `N.rightSib` to `M`.

**Protocol P2 (Read):**

To find key `k`:
1. Start at root. Acquire S-latch.
2. While not at leaf:
    a. If `k > N.highKey`, follow `N.rightSib`. Repeat.
    b. Find child `c` covering `k`. Acquire S-latch on `c`. Release latch on `N`.
    c. Move to `c`.
3. At leaf, find `k` in items (with right-sib chasing as needed).

**Termination guarantee:**

Right-sib chains are finite (each node has at most one right sibling). The walk terminates.

---

## OLFIT / OCC Correctness

Cha et al. 2001 OLFIT protocol.

**Per-node:**

- Each node `N` has a `version` counter.
- Writers increment `version` to odd at start, to even at end.
- Writers serialize via a per-node latch.

**Protocol R1 (Read):**

To read fields of node `N`:
1. Load `v1 = atomic.Load(N.version)`.
2. If `v1` is odd, retry (writer in flight).
3. Read all fields of `N`.
4. Load `v2 = atomic.Load(N.version)`.
5. If `v2 != v1`, retry (mutation during read).
6. Use the values.

**Protocol W1 (Write):**

To mutate `N`:
1. Acquire `N.writeMu`.
2. `atomic.Add(N.version, 1)` — now odd.
3. Mutate fields.
4. `atomic.Add(N.version, 1)` — now even.
5. Release `N.writeMu`.

**Correctness argument:**

A reader's `(v1, v2)` pair is the same if and only if no writer began-and-completed between the two loads. Since writes are bracketed by `++version` (odd) and `++version` (even), the version counter changes exactly twice per write. Thus `v1 == v2` even-valued means no write occurred.

This argument requires that field reads do not move past the version loads — i.e., the memory ordering must be such that `atomic.Load(version)` happens-before reads of other fields. In Go, `atomic.Load` provides this acquire semantic.

---

## ART Invariants

Leis et al. 2013 ART.

**Per-node:**

1. Each internal node is one of Node4, Node16, Node48, or Node256.
2. The number of children fits the node type:
    - Node4: 1-4 children.
    - Node16: 5-16 children.
    - Node48: 17-48 children.
    - Node256: 49-256 children.
3. Each internal node has a `prefix` (up to MaxPrefix bytes). All keys in the subtree share this prefix at the corresponding depth.

**Per-leaf:**

4. Leaves hold (key, value) pairs.

**Resize triggers:**

5. When a Node4 is full and an insert occurs, resize to Node16. Similarly for Node16 → Node48 and Node48 → Node256.
6. When a Node16's `numChildren` drops below the lower bound, resize to Node4. Similarly for downsizes.

**Concurrent ART (OLFIT-style):**

7. Each node has a version counter (as in OLFIT).
8. Readers validate via version check.
9. Writers take per-node latch, mutate, increment version twice.
10. Resize is special: allocate new node, copy children, then update parent's pointer (CAS or atomic store).

---

## Bw-tree Normative Rules

Levandoski et al. 2013.

**Structural:**

1. Logical tree of B+-tree nodes (internal + leaves).
2. Mapping table maps `NodeID` to current state pointer.
3. State pointer points to a chain of zero or more delta records terminating in a base node.

**Updates:**

4. To update node `id`: allocate a new delta `d`, set `d.next = mapping[id]`, then `CAS(mapping[id], old, d)`.
5. Reads walk the chain plus base, applying deltas to interpret the current state.

**Consolidation:**

6. When chain length exceeds threshold, build a fresh base node by walking the chain.
7. `CAS(mapping[id], current chain head, fresh base)`. On failure, abandon.

**Splits:**

8. Allocate new node `id'` with the upper half of items.
9. Post a SplitDelta to `mapping[id]` recording `(pivot, id')`.
10. Eventually update the parent via a separate delta.

**Reclamation:**

11. Old chains and base nodes are reclaimed via epoch-based reclamation.
12. In Go, GC subsumes this if no goroutine retains the old chain.

**Correctness:**

13. At any point, the union of (mapping table entries, in-flight readers' cached pointers) covers all valid versions.
14. Once `mapping[id]` is updated, future readers see the new state; in-flight readers see their cached state.

---

## MVCC Visibility Rule

For a row version `v` with `XMin` (created), `XMax` (deleted, 0 if not), and a reader with snapshot timestamp `T`:

```
visible(v, T) =
    XMin is committed
    AND XMin <= T
    AND (XMax == 0
         OR XMax is not committed
         OR XMax > T)
```

A reader walks the version chain (newest to oldest) and returns the first version where `visible(v, T)` is true.

**Garbage collection:**

A version `v` may be reclaimed when:

```
v.XMax != 0
AND XMax is committed
AND XMax < oldest active snapshot timestamp
```

I.e., the version is deleted, the deletion is permanent, and no active reader can see the version.

**Snapshot isolation:**

Each transaction `T` has a single snapshot timestamp assigned at Begin. All its reads see versions visible at that timestamp. Writes create versions with `XMin = T.id`.

**Serializable isolation:**

In addition to SI rules, at commit time, validate that no version in the read set has been superseded by a transaction that committed after `T`'s snapshot. If any has, abort.

---

## Go Library Specifications

### `github.com/google/btree.BTreeG[T]`

From the package documentation:

> Write operations are not safe for concurrent mutation by multiple goroutines, but Read operations are.

Normative interpretation:

- Multiple goroutines may call `Get`, `Has`, `Min`, `Max`, `Len`, `Ascend`, etc., concurrently if no goroutine is in any write method.
- No mutation method (`ReplaceOrInsert`, `Delete`, `DeleteMin`, `DeleteMax`, `Clear`) may be called concurrently with any other method on the same `BTreeG`.

The caller MUST enforce these constraints via external synchronization (e.g., `sync.Mutex` or `sync.RWMutex`).

`Clone()` returns a new tree sharing structure with the original via copy-on-write. Mutations to either tree clone the affected path. Cost: `O(1)` for `Clone`, `O(log n)` per write to shared subtrees.

### `github.com/tidwall/btree.BTreeG[T]`

From the package documentation: similar contract; mutations are not concurrent-safe; reads-only-without-concurrent-writers is safe.

`Copy()`: O(1) refcount bump. Subsequent writes path-copy shared nodes.

Hint API: `SetHint`, `GetHint`, `DeleteHint`. The `Hint` value is per-goroutine; do not share across goroutines.

### `go.etcd.io/bbolt`

Concurrency: **one writer at a time per database; many readers**.

Each transaction (`db.Begin(writable)`) is either read-only or writable. Writable transactions are exclusive. Read transactions see a consistent snapshot.

Pages modified by a writable transaction are written to new locations on commit; old pages are freed once no read transaction can see them.

---

## Go Memory Model Excerpts (Relevant to Trees)

From `https://go.dev/ref/mem`:

> A `sync.Mutex.Unlock` happens-before the next `sync.Mutex.Lock`.

For tree protection: a write under `Unlock` is visible to a subsequent read under `Lock`.

> `atomic.Store(p, v)` happens-before any `atomic.Load(p)` that returns `v`.

For publish/subscribe COW: the writer's `atomic.Pointer.Store(&snapshot, newSnap)` makes all writes building `newSnap` visible to readers' `atomic.Pointer.Load(&snapshot)`.

> A `channel send` happens-before the matching `channel receive`.

For channel-based serialization: writes before a send are visible after the matching receive.

These guarantees are foundational. Concurrent tree implementations rely on them.

---

## Bibliography

- Bayer, McCreight (1972), *Organization and Maintenance of Large Ordered Indexes*.
- Lehman, Yao (1981), *Efficient Locking for Concurrent Operations on B-Trees*.
- Cha, Hwang et al. (2001), *Cache-Conscious Concurrency Control of Main-Memory Indexes on Shared-Memory Multiprocessor Systems*.
- Levandoski, Lomet, Sengupta (2013), *The Bw-Tree: A B-tree for New Hardware Platforms*.
- Leis, Kemper, Neumann (2013), *The Adaptive Radix Tree: ARTful Indexing for Main-Memory Databases*.
- Diaconu et al. (2013), *Hekaton: SQL Server's Memory-Optimized OLTP Engine*.
- Mao, Kohler, Morris (2012), *Cache Craftiness for Fast Multicore Key-Value Storage*.
- CLRS, *Introduction to Algorithms*, Chapter 18 (B-Trees).
- PostgreSQL source, `src/backend/access/nbtree/README`.
- Go specification, `go.dev/ref/spec`.
- Go memory model, `go.dev/ref/mem`.
- `github.com/google/btree`, package documentation.
- `github.com/tidwall/btree`, package documentation.
- `go.etcd.io/bbolt`, package documentation.

---

## References

- The Lehman-Yao paper is the most-cited and most-applicable. Read it first.
- The OLFIT paper is the second most-applicable for in-memory work.
- The Bw-tree paper requires patience and possibly multiple readings.
- PostgreSQL's nbtree README is the best free engineering treatment available.

This specification is normative for the implementations described in the junior, middle, senior, and professional files of this section. Implementations that violate these invariants are buggy and must be corrected.

---

## Appendix A: Formal proof sketch of Lehman-Yao correctness

The Lehman-Yao paper proves correctness via a series of lemmas. Briefly:

**Lemma 1 (Search Terminates):** Any search operation terminates in `O(h + r)` steps, where `h` is tree height and `r` is the maximum right-sibling chain length encountered. Since splits move keys to the right and high keys decrease monotonically, `r` is bounded.

**Lemma 2 (Search Correctness):** A search for key `k` returns the value if `k` is in the tree, and "not found" otherwise. The right-sibling chasing guarantees that `k`'s leaf is visited.

**Lemma 3 (Insert Correctness):** An insert of `(k, v)` makes the tree contain `(k, v)` after completion. The preemptive-split protocol guarantees parent nodes have room when children push up.

**Lemma 4 (Concurrency Safety):** Multiple concurrent operations on disjoint paths do not interfere. The latch crabbing protocol ensures that only the current node's latch is required for each step.

**Theorem (Linearizability):** All operations appear to take effect at some atomic point between their invocation and completion. This atomic point is the latch acquisition for write operations, and the version-validated read for OLFIT readers.

The full proof requires careful case analysis of split/merge protocols and their interaction with concurrent reads. Refer to the paper for details.

---

## Appendix B: Formal specification of MVCC validation

For Hekaton-style optimistic MVCC, the commit-time validation:

```
Validate(tx):
    for each (key, oldVersion) in tx.Reads:
        currentRow = lookupRow(key)
        if currentRow == nil:
            return Conflict  // row was deleted
        for each version v in currentRow.versions:
            if v == oldVersion:
                if v.XMax != 0 and v.XMax != tx.id and isCommitted(v.XMax):
                    return Conflict  // someone else committed a delete
                break
        else:
            return Conflict  // version no longer in chain
    return Success
```

If `Validate(tx)` returns `Success`, the transaction may commit. Otherwise, abort and retry.

For serializable isolation, additionally check that no version that `tx` read has been **superseded** by a newer version committed by another transaction after `tx.snapshot`. The implementation:

```
ValidateSerializable(tx):
    for each (key, oldVersion) in tx.Reads:
        currentRow = lookupRow(key)
        // Check whether a version newer than oldVersion is committed after tx.snapshot.
        for v := currentRow.Newest; v != oldVersion; v = v.Next:
            if isCommitted(v.XMin) and v.XMin > tx.snapshot:
                return Conflict
    return Success
```

This is stricter than SI: any read-write conflict aborts.

---

## Appendix C: Formal specification of the publish/subscribe COW protocol

The publish/subscribe pattern in Go:

```
type Store {
    mu       Mutex
    live     Tree
    snapshot atomic.Pointer[Tree]
}

Set(k, v):
    mu.Lock()
    live.Set(k, v)
    snapshot.Store(live.Copy())
    mu.Unlock()

Get(k):
    return snapshot.Load().Get(k)
```

**Invariant 1 (Snapshot Consistency):** Each value of `snapshot` corresponds to a valid, complete tree.

**Invariant 2 (Eventual Visibility):** After `Set(k, v)` returns, every subsequent call to `Get(k)` returns `v` (until a later `Set`).

**Invariant 3 (Monotonic Publication):** If `s1 = snapshot.Load()` at time `t1` and `s2 = snapshot.Load()` at time `t2 > t1`, then `s2` is at least as recent as `s1` (in terms of writes applied).

**Invariant 4 (Reader Wait-Freedom):** `Get` does not block; it completes in bounded time independent of writer activity.

**Invariant 5 (Writer Liveness):** `Set` completes in finite time (bounded by Tree operations, snapshot copy, and mutex acquisition).

**Memory model correctness:** The `atomic.Pointer.Store` operation provides release semantics, ensuring all writes that built the new snapshot are visible to readers performing `atomic.Pointer.Load` (which provides acquire semantics).

---

## Appendix D: Specification of `tidwall/btree.BTreeG[T].Copy()`

**Pre-condition:** `tr` is a valid `BTreeG[T]` with refcount 1 on its root node.

**Post-condition:**

- Returns a new `BTreeG[T]` whose root pointer equals `tr`'s root pointer.
- The shared root's refcount is incremented to 2.
- Both trees support concurrent reads (but not concurrent writes — that requires external synchronization).

**Cost:** `O(1)` time, one struct allocation, one atomic increment.

**Subsequent write behavior:**

- A write to either tree triggers path-copy of any node with refcount > 1.
- Cloned nodes have their refcount set to 1; original retains its refcount.
- Children of cloned nodes are shared; their refcounts are incremented.

**Implications:**

- Reads on either tree continue to work concurrently with writes on the other tree.
- Memory is reclaimed by Go's GC when no goroutine retains a pointer to a node.

---

## Appendix E: Specification of `google/btree.BTreeG[T].Clone()`

Similar to `tidwall/btree.Copy()` but with subtle differences:

- `Clone()` increments refcount on the root *and all its children* (one level deep).
- Path-copy happens lazily during subsequent writes.

The semantics are equivalent at the API level; the implementation differs.

---

## Appendix F: Specification of `bbolt`'s transaction protocol

**Read transaction (`Tx.View(fn)`):**

- Acquires `db.metaLock` briefly to read the current meta page.
- Releases `metaLock`.
- Reads pages directly via mmap.
- May coexist with one write transaction and other read transactions.
- Pages freed by writers are not reused until this transaction completes.

**Write transaction (`Tx.Update(fn)`):**

- Acquires `db.rwMutex` exclusively.
- Reads the current meta.
- Modifications happen on in-memory copies of pages.
- On commit:
    - Write modified pages to new locations on disk.
    - Update the meta page.
    - Mark freed pages for future reuse (after all currently-active read transactions complete).
    - fsync.
- Releases `rwMutex`.

**Concurrency:**

- Multiple read transactions: yes.
- One read + one write: yes.
- Multiple write transactions: no — serialized.

**Crash recovery:**

- On startup, bbolt reads both meta pages.
- The meta with the higher transaction ID and a valid checksum is the current root.
- The other meta is overwritten on the next commit.
- No WAL is used; pages are written before the meta update.

---

## Appendix G: Specification of MassTree's tree-of-trees

MassTree (Mao et al. 2012) is a tree of B+-trees keyed by 8-byte key fragments.

**Per-tree-level:**

- A B+-tree storing `(8-byte key prefix, child tree pointer)` pairs.
- Standard B-link protocol with OLFIT-style version counters.

**Per-key:**

- Keys are split into 8-byte fragments.
- The top-level tree routes by the first 8 bytes.
- The second-level tree routes by the next 8 bytes within keys sharing the first 8 bytes.
- And so on.

**Invariant:** Equal keys map to the same leaf path; different keys diverge at some level.

**Concurrency:** Each level's B+-tree is independently concurrent. Modifications at one level do not affect siblings at other levels.

---

## Appendix H: Specification of concurrent ART resize

When a Node4 fills and an insert requires a new child:

1. Allocate a new Node16. Copy children from the Node4 (which is X-latched).
2. Acquire the parent's X-latch.
3. Atomically update the parent's pointer to point to the Node16.
4. Release latches.
5. Retire the Node4 to an epoch reclaimer (or rely on GC).

In-flight readers on the Node4 see a stable Node4 (the X-latch ensures no modifications occurred during the copy). After step 3, new readers from the parent reach the Node16. After the old Node4 is no longer reachable by any reader, it can be freed.

**Invariant:** No reader ever sees a partially-resized node. The resize is atomic with respect to readers (the parent's pointer flip is the atomic publication point).

---

## Appendix I: Specification of epoch-based reclamation

Epoch-based reclamation (EBR) is a mechanism to safely free memory that may still be in use by concurrent readers.

**Protocol:**

1. A global epoch counter `E` is maintained.
2. Each reader, before performing a read, records the current epoch: `localEpoch = E`.
3. After the read, the reader clears `localEpoch`.
4. When an object is retired, it is tagged with the current `E`.
5. The reclaimer periodically advances `E`. Objects tagged with `E - k` (for some safety margin `k`, typically 2 or 3) can be freed only when no reader's `localEpoch` is in `[E - k, E]`.

**Invariant:** A retired object is freed only after every reader that could see it has completed.

In Go, the GC subsumes this: an object is freed only when no goroutine retains a pointer to it. As long as readers do not stash pointers in long-lived data structures, GC works.

For Go programs using `unsafe.Pointer` or cgo, manual epoch reclamation may be necessary.

---

## Appendix J: Specification of the Bw-tree consolidation race

When two threads simultaneously attempt to consolidate the same delta chain:

1. Thread A reads `mapping[id]`, observing the current chain head.
2. Thread A allocates a new base node by walking the chain.
3. Thread B inserts a new delta to the chain. The chain head is now Thread B's delta.
4. Thread A attempts CAS to swap the chain head with the new base.
5. The CAS fails (old value no longer matches).
6. Thread A discards its work.

Alternative outcome: if Thread A's CAS succeeds (Thread B is delayed), then Thread B's insert sees the new base on its next operation and proceeds correctly.

**Invariant:** At all times, `mapping[id]` points to a valid chain (or base node) representing the logical state of node `id`.

**Liveness:** Eventually, some consolidator's CAS succeeds. Backoff prevents excessive retries.

---

## Appendix K: Formal correctness of the order book example

The order book in the senior file's Appendix H maintains the following invariants:

1. **Sort invariant:** `bids` is sorted by (Price desc, Time asc, ID asc). `asks` is sorted by (Price asc, Time asc, ID asc).
2. **Index invariant:** `byID[id]` returns the Order in the book, or no entry if the order is canceled / matched.
3. **Snapshot consistency:** `bidSnapshot` and `askSnapshot` represent a consistent point-in-time view, possibly with respect to a single `Match` operation.

**Match correctness:**

- A trade occurs only if `bid.Price >= ask.Price`.
- The trade quantity is `min(bid.Qty, ask.Qty)`.
- The trade price is `ask.Price` (this is one convention; other markets use `bid.Price`).
- If a trade exhausts an order, the order is removed from both `byID` and the book.

**Concurrency:**

- Under the single `mu`, all operations are linearizable.
- `MarketData` reads from the snapshots without taking `mu`, so it may observe slightly stale state.

---

## Appendix L: Specification of the `sync` package primitives

For the concurrent tree implementations, the relevant `sync` primitives:

**`sync.Mutex`:**

- `Lock()` blocks until exclusive access is acquired.
- `Unlock()` releases. Must be called by the goroutine that holds the lock.
- Not reentrant.
- Provides happens-before guarantee: writes before `Unlock` are visible to operations after subsequent `Lock`.

**`sync.RWMutex`:**

- `RLock()` / `RUnlock()` for shared (read) access.
- `Lock()` / `Unlock()` for exclusive access.
- Many readers may hold `RLock` simultaneously.
- A writer's `Lock` waits for all readers and writers; subsequent readers also wait.
- Not reentrant.

**`atomic.Pointer[T]`:**

- `Load()` returns the current pointer atomically.
- `Store(p)` sets the pointer atomically.
- `CompareAndSwap(old, new)` atomically swaps if the current value equals `old`.
- Provides acquire/release semantics.

**`sync.Cond`:**

- `Wait()` releases the lock, sleeps, re-acquires.
- `Signal()` wakes one waiter.
- `Broadcast()` wakes all waiters.
- Used with a `sync.Mutex` for condition-based signaling.

---

## Appendix M: Bibliography (extended)

Beyond the core papers listed above:

- Faleiro, Abadi (2015), *Rethinking Serializable Multiversion Concurrency Control*.
- Larson, Blanas, Diaconu, Freedman, Patel, Zwilling (2011), *High-Performance Concurrency Control Mechanisms for Main-Memory Databases*.
- Kim, Chhugani, Satish, Sedlar, Nguyen, Kaldewey, Lee, Brandt, Dubey (2010), *FAST: Fast Architecture Sensitive Tree Search on Modern CPUs and GPUs*.
- Bender, Demaine, Farach-Colton (2005), *Cache-Oblivious B-Trees*.
- McKenney (2017), *Is Parallel Programming Hard, And, If So, What Can You Do About It?*
- Graefe (2010), *A Survey of B-Tree Locking Techniques*.
- Wang, Lomet, Yang, Mahmoud (2018), *Building a Bw-Tree Takes More Than Just Buzz Words*.

---

## Appendix N: Closing

This specification file is intended to be the single normative source for the correctness of concurrent tree implementations. If you build a concurrent tree in Go and want to verify correctness:

1. Choose a protocol from this file (Lehman-Yao, OLFIT, Bw-tree, COW publish/subscribe).
2. Implement it.
3. Verify each invariant in this file holds in your implementation (with assertions in debug builds).
4. Test under `go test -race` extensively.
5. Cross-check against the published papers.

A passing test suite + invariant assertions + paper alignment = high confidence in correctness.

