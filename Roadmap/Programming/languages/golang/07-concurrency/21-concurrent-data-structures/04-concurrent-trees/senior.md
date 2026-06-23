---
layout: default
title: Senior
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/senior/
---

# Concurrent Trees — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Architecture of a Real Concurrent B+-Tree](#architecture-of-a-real-concurrent-b-tree)
5. [Latching Protocols in Depth](#latching-protocols-in-depth)
6. [The Lehman-Yao B-link Protocol, Implementation Grade](#the-lehman-yao-b-link-protocol-implementation-grade)
7. [MVCC Integration](#mvcc-integration)
8. [RCU and Epoch-Based Reclamation](#rcu-and-epoch-based-reclamation)
9. [Immutable Persistent Trees: HAMT and Beyond](#immutable-persistent-trees-hamt-and-beyond)
10. [Engineering Tour: PostgreSQL nbtree, BoltDB, CockroachDB Pebble](#engineering-tour-postgresql-nbtree-boltdb-cockroachdb-pebble)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code at Scale](#clean-code-at-scale)
13. [Product Use](#product-use)
14. [Performance Tips](#performance-tips)
15. [Best Practices](#best-practices)
16. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
17. [Common Mistakes](#common-mistakes)
18. [Common Misconceptions](#common-misconceptions)
19. [Tricky Points](#tricky-points)
20. [Test](#test)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Self-Assessment Checklist](#self-assessment-checklist)
24. [Summary](#summary)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams](#diagrams)

---

## Introduction

> Focus: "I am architecting an in-memory index for a service that handles 100k mixed QPS and must never block readers. What protocol do I run, why, and how do I think about it the way the database engineers do?"

This file is for engineers building or maintaining systems where a tree is a *critical* shared data structure: an in-memory index inside a database engine, a routing table that must serve millions of lookups per second, the working set of a key-value store. At this level "use one mutex" or even "use publish/subscribe COW" is no longer a default that you reach for blindly — it is one of many options whose trade-offs you weigh against latency budgets, memory budgets, GC budgets, and hardware reality.

We assume you have absorbed the middle file: hand-over-hand, OCC, COW, B-link, sharding, snapshot publishing, version counters. The senior file takes those building blocks and:

- Walks through the architecture of a real concurrent B+-tree the way a database engineer designs one — latching protocols, latch crabbing, S/X/SIX modes, B-link, MVCC.
- Treats the Lehman-Yao 1981 paper at implementation grade: invariants, proof sketches, common variations, in-line Go-flavoured pseudocode.
- Integrates the tree with MVCC: per-key version chains, transaction IDs, garbage collection of dead versions, snapshot isolation correctness.
- Treats RCU and epoch-based reclamation in detail — including why Go's GC means you almost never need an explicit epoch system, and the few cases where you do.
- Surveys immutable persistent trees: Hash Array Mapped Tries (HAMT), finger trees, Bw-trees (briefly; full treatment in professional file), ART.
- Tours the source of three real systems — PostgreSQL nbtree, BoltDB / bbolt, CockroachDB Pebble — and explains how each maps the theory to working code.

By the end of this file you should be able to:

- Architect a concurrent B+-tree from first principles.
- Read PostgreSQL's `nbtree.c` and `nbtxlog.c` without confusion.
- Reason about MVCC garbage collection and tombstone half-lives.
- Design epoch reclamation when Go's GC is not enough (e.g., for `unsafe.Pointer` adjacencies).
- Choose between COW, hand-over-hand, OCC, and B-link given a workload's read/write ratio, snapshot needs, and memory budget.

This is the level at which you stop asking "what library should I use?" and start asking "what protocol does this library run, and is it the right one for me?"

---

## Prerequisites

- Fluency with the middle file.
- Familiarity with `sync/atomic`, `atomic.Pointer[T]`, and the Go memory model.
- Some exposure to database internals (any of: PostgreSQL, MySQL, SQLite, BoltDB).
- Comfortable reading concurrent C or C++ — most published material is in those languages.
- Willingness to read the actual source of `tidwall/btree`, `google/btree`, and `bbolt`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Latch** | Short-lived, in-memory mutex on a data structure node. As distinct from a **lock** which protects logical objects (rows) for long durations. |
| **S-latch / X-latch** | Shared and exclusive latches; equivalent of `RLock` / `Lock`. |
| **SIX** | Shared-with-intent-exclusive. A mode that allows reading but prevents new readers while waiting to upgrade. Rarely used in B-trees; common in row locks. |
| **Latch crabbing** | Synonym for hand-over-hand. |
| **Latch coupling** | Synonym for hand-over-hand. |
| **B+-tree** | A B-tree variant where all data lives in the leaves and internal nodes hold only routing keys. Leaves are linked into a doubly-linked list. The dominant index structure in OLTP databases. |
| **High key / right-key** | The largest key reachable through a node. Used by B-link to detect missed splits. |
| **MVCC** | Multi-version concurrency control. Each row has multiple versions. Readers see the version current at their transaction start. |
| **Snapshot isolation** | An MVCC transaction sees a consistent point-in-time snapshot of the data. |
| **Tombstone** | A marker that a key has been deleted. Lives in the index until garbage-collected. |
| **WAL** | Write-Ahead Log. All modifications are appended to a log before being applied in-place. |
| **Page** | A fixed-size unit of disk I/O (typically 4 KB or 8 KB). A B+-tree node is one page. |
| **Page latch** | The in-memory latch on a page held during read / modify. |
| **Buffer pool** | The cache of pages in memory backed by on-disk storage. |
| **RCU** | Read-Copy-Update. Linux kernel pattern; writers swap pointers, readers proceed lock-free, old memory is reclaimed after all in-flight readers finish. |
| **Epoch** | A logical clock for RCU. Each reader registers with the current epoch; memory tagged with epoch E is reclaimed when no reader is in epoch <= E. |
| **Hazard pointer** | Alternative to epoch reclamation. Each reader publishes the pointer it is reading; writers cannot free a published pointer. |
| **Bw-tree** | A B-tree variant from Microsoft Research that uses a mapping table to indirect node IDs to memory pointers, deltas to avoid in-place updates, and epoch-based reclamation. |
| **ART** | Adaptive Radix Tree. A radix trie variant whose nodes adapt their size (4 / 16 / 48 / 256 children) to the number of children. |
| **HAMT** | Hash Array Mapped Trie. A persistent map structure widely used in functional languages (Clojure's PersistentHashMap). |

---

## Architecture of a Real Concurrent B+-Tree

A production-grade in-memory concurrent B+-tree consists of:

1. **A node pool / arena.** Pre-allocated, cache-aligned nodes; index into the pool is the node ID.
2. **A mapping table (optional).** Node IDs → node pointers; allows nodes to be "moved" without updating their parents.
3. **A root pointer.** Atomic; published by the writer when the root changes.
4. **Per-node latches.** Each node has a single latch (or a reader/writer latch) for protocol coordination.
5. **High keys and right-sibling pointers.** B-link style; every node has a high key and a right neighbour pointer.
6. **A free list or epoch-based reclaimer.** Tracks nodes that are no longer reachable but may still be in use by in-flight readers.

The protocol layered on top:

- **Reads**: descend from root to leaf using latch crabbing or OCC.
- **Writes**: descend with X-latches in latch crabbing; release X-latches as soon as splits cannot propagate further upward (preemptive split).
- **Splits**: create a new right sibling, atomically update the parent's child array, release latches.
- **Merges**: similar but rarer; often deferred (deletion marks tombstones, merge happens later in a vacuum process).

In Go, you would typically simplify some of this:

- Use `[]Item` slices inside each node instead of cache-aligned arrays.
- Use Go's GC instead of a manual reclaimer (no epochs needed).
- Use `sync.RWMutex` per node instead of custom S/X latches.
- Use `atomic.Pointer[Node]` for the root.

The result is a simpler, slightly slower implementation than C++, but one that scales to tens of thousands of QPS comfortably.

### A Go skeleton

```go
package btreeplus

import (
    "sync"
    "sync/atomic"
)

const (
    leafFanout     = 64
    internalFanout = 64
)

type Item struct {
    Key   int64
    Value []byte
}

type Node struct {
    latch     sync.RWMutex
    isLeaf    bool
    items     []Item   // sorted by Key
    children  []*Node  // len(items)+1 if !isLeaf; nil if isLeaf
    highKey   int64
    rightSib  *Node    // only used on leaves in classic B+-tree, or all nodes in B-link
    version   atomic.Uint64 // optional OCC support
}

type Tree struct {
    rootMu sync.Mutex
    root   atomic.Pointer[Node]
}
```

We will fill in the methods as we work through the protocols.

---

## Latching Protocols in Depth

### Two-phase latching for inserts (CLRS preemptive splits)

Recall the CLRS top-down preemptive-split algorithm:

```
Insert(key, value):
    1. X-latch the root.
    2. If the root is full, split it (creating a new root above).
    3. node = root
    4. While node is not a leaf:
       a. Identify the child c that the key belongs in.
       b. X-latch c.
       c. If c is full, split it (the result is two children of node).
       d. Update target child to the half containing key.
       e. Release X-latch on node (now safe: node has room for any further split from below).
       f. node = c
    5. node is a leaf with room; insert (key, value).
    6. Release X-latch on node.
```

Invariant: when we descend into `c`, `c` has room. So any future split inside `c`'s subtree cannot propagate up to `node`. Therefore we can release `node`.

This pattern holds at most three latches at once (parent, current child, sibling-during-split). Other inserters can be elsewhere in the tree simultaneously.

### Latch crabbing for reads

For reads, we hold at most two latches at once:

```
Read(key):
    1. S-latch the root.
    2. node = root.
    3. While node is not a leaf:
       a. Identify child c.
       b. S-latch c.
       c. Release S-latch on node.
       d. node = c.
    4. Binary-search for key in node.items.
    5. Release S-latch on node.
```

Readers and writers can overlap freely because of the reader/writer latch semantics. But: a writer's X-latch will block readers' S-latches on the same node. Hot pages become bottlenecks.

### Optimistic latching for reads (OLFIT)

To eliminate the read-side latch entirely:

```
Read(key):
    1. node = root.
    2. Loop:
       a. v1 = atomic.Load(node.version)
       b. If v1 is odd (writer in flight), spin / yield.
       c. children, items = read node fields (still racy)
       d. v2 = atomic.Load(node.version)
       e. If v2 != v1, restart from step 2.
       f. If leaf, search items and return.
       g. Find child c. node = c. Goto 2.
```

Writers increment `version` before and after their modifications:

```
Write(key, value):
    1. X-latch node.
    2. v = atomic.Add(node.version, 1)  // now odd
    3. Mutate.
    4. atomic.Add(node.version, 1)      // now even
    5. Release X-latch.
```

In Go this needs all node fields read through atomics for memory model conformance. The race detector will catch the unprotected reads; a real implementation would mark the structure as deliberately racy.

### SIX (Shared-with-Intent-Exclusive) for B-tree?

SIX modes are rarely used in B-trees because the typical sequence is "read child, write child" or "write child without prior read." A read-then-upgrade pattern is uncommon in tree code. SIX is more common in row-level locking inside databases.

### Comparison: when to use which

| Protocol | Read scalability | Write scalability | Implementation difficulty | Notes |
|----------|------------------|-------------------|---------------------------|-------|
| Single Mutex | None | None | Trivial | Default for low-throughput |
| Sharded Mutex | High (per shard) | High (per shard) | Easy | Range queries hurt |
| Latch crabbing S/X | High (S latches share) | Medium (X latches serialize on hot paths) | Hard | Pre-Lehman-Yao standard |
| Latch crabbing + B-link | High | High | Very hard | PostgreSQL nbtree |
| OLFIT (OCC + B-link) | Very high (read lock-free) | Medium | Very hard | Masstree, OLFIT paper |
| COW publish/subscribe | Lock-free | Medium (path-copy cost) | Medium | tidwall/btree pattern |

For pure in-memory Go in 2026, **COW publish/subscribe with optionally sharded writers** is the right architecture for almost every workload. The latch-crabbing protocols matter more in disk-backed systems where pages cannot be cheaply cloned.

---

## The Lehman-Yao B-link Protocol, Implementation Grade

The Lehman-Yao 1981 paper, "Efficient Locking for Concurrent Operations on B-Trees," is the foundation of nearly every modern concurrent B-tree, including PostgreSQL's nbtree. Reading it is a rite of passage.

### The key idea

Concurrent splits create a problem: a reader descends into node `N`, expecting to find the key. But while the reader is examining `N`, a writer splits `N` into `N` and `M`, pushing the median up to the parent and adding `M` as a new child. The reader's target key may now be in `M`.

Without B-link: the reader must re-acquire the parent's latch and re-traverse. This destroys concurrency.

With B-link: each node has a **high key** (the largest key reachable through it) and a **right-sibling pointer**. After a split, `N`'s high key drops and `N.rightSib = M`. A reader on `N` checks: "is my target key > N.highKey?" If yes, follow `N.rightSib` to `M`. No parent re-latch needed.

### The invariant

For any node `N`:

- `N.highKey` is the largest key reachable through `N`.
- For every key `k > N.highKey` that exists in the tree, `k` is reachable through `N.rightSib`.

This invariant is maintained by split protocols.

### The split protocol in detail

When inserting into a leaf `L` that becomes full:

1. Allocate new leaf `M`.
2. Move the upper half of `L.items` into `M`.
3. Set `M.highKey = L.highKey`.
4. Set `M.rightSib = L.rightSib`.
5. Set `L.highKey = median key`.
6. Set `L.rightSib = M`.   (← this is atomic in C; on Go you do `atomic.Pointer.Store(&L.rightSib, M)`.)
7. Now the parent must be updated to know about `M`. Walk up:
   - X-latch the parent.
   - Insert the (median key, M) entry into parent.
   - Release parent latch.
8. If the parent split, recurse.

Step 6 is the **publication point**. After it, in-flight readers on `L` who see `key > L.highKey` will follow `L.rightSib = M` and find their key. The parent's view (the (M, key) entry) is added later.

A reader that arrives at the parent *after* the parent update will find `M` through the parent's child array directly. A reader that arrived earlier follows `L.rightSib`. Both paths converge correctly.

### Why it works

The crucial property: at no point in the split is any reader's traversal invalidated. Either:

1. The reader's chosen path includes `L` and `M` via the parent (post-parent-update).
2. The reader's chosen path includes `L`, sees `key > L.highKey`, and follows `rightSib` to `M` (pre-parent-update or even concurrently with it).

There is no third path. Both routes succeed.

### Pseudocode for a Lehman-Yao B-link Get

```go
func (t *Tree) Get(key int64) (Item, bool) {
    n := t.root.Load()
    n.latch.RLock()
    for !n.isLeaf {
        // Follow right-sibling chain if key > highKey.
        for key > n.highKey {
            right := n.rightSib
            right.latch.RLock()
            n.latch.RUnlock()
            n = right
        }
        // Descend to the right child.
        i := childIndex(n, key)
        child := n.children[i]
        child.latch.RLock()
        n.latch.RUnlock()
        n = child
    }
    // n is a leaf; same right-walk as above.
    for key > n.highKey {
        right := n.rightSib
        right.latch.RLock()
        n.latch.RUnlock()
        n = right
    }
    i, found := findInItems(n.items, key)
    if !found {
        n.latch.RUnlock()
        return Item{}, false
    }
    it := n.items[i]
    n.latch.RUnlock()
    return it, true
}
```

Notice the structural similarity to plain latch crabbing — the extra logic is just the "follow right" loops before the descent.

### Pseudocode for a Lehman-Yao B-link Insert

```go
func (t *Tree) Insert(key int64, val []byte) {
    n := t.root.Load()
    n.latch.Lock()
    for !n.isLeaf {
        // No need to follow right-sibling on insert; we hold X-latch.
        i := childIndex(n, key)
        child := n.children[i]
        child.latch.Lock()
        n.latch.Unlock()
        n = child
    }
    // n is a leaf. Insert.
    if len(n.items) < leafFanout {
        insertItem(&n.items, key, val)
        n.latch.Unlock()
        return
    }
    // Full. Split.
    m := allocLeaf()
    mid := len(n.items) / 2
    m.items = append(m.items, n.items[mid:]...)
    n.items = n.items[:mid]
    if key >= m.items[0].Key {
        insertItem(&m.items, key, val)
    } else {
        insertItem(&n.items, key, val)
    }
    m.highKey = n.highKey
    m.rightSib = n.rightSib
    n.highKey = m.items[0].Key - 1 // simplification
    n.rightSib = m
    // Now propagate up.
    // (For simplicity assume insert into parent; real code finds parent via a stack.)
    n.latch.Unlock()
    propagateUp(n, m)
}
```

Real production code tracks the descent path in a stack and propagates splits up from there. The key insight is that **the new right sibling is visible to in-flight readers via `rightSib` before the parent is updated.**

### Implementation pitfalls

- **The parent walk must use a stack.** Re-traversing from the root to find the parent introduces races with other concurrent splits.
- **High keys must be updated atomically with the right-sibling pointer.** If a reader sees the new `rightSib` but the old `highKey`, they may follow `rightSib` unnecessarily — usually fine, but check.
- **Merges are the hard case.** A merge violates the B-link invariant if not done carefully. Most production implementations defer merges (`vacuum` in PostgreSQL).
- **Root growth requires special care.** Growing the root means the old root acquires a sibling; you must publish the new root pointer atomically.

### Why you almost never implement this in Go

Implementing Lehman-Yao correctly is a multi-month project even for experienced engineers. Production implementations have evolved over decades. You should:

- Use `tidwall/btree` or `bbolt` and accept their protocol choices.
- Understand B-link well enough to read the source of any tree library and reason about its correctness.
- Reach for B-link only if you are building a database engine.

---

## MVCC Integration

A concurrent index alone is not enough for a database. You also need *transactional* semantics: readers see a consistent snapshot regardless of concurrent writes.

### The version chain model

Each row in the database has a chain of versions:

```
key=42:
  v3 -> v2 -> v1 -> nil
  (v3 = latest, v1 = oldest)
```

Each version has:

```go
type Version struct {
    Value   []byte
    XMin    int64 // transaction ID that created this version
    XMax    int64 // transaction ID that deleted this version (0 = not deleted)
    Next    *Version
}
```

A reader with transaction ID `R`:

- Starts a snapshot at time `R`.
- For each row, walks the version chain until it finds the version with `XMin <= R && (XMax == 0 || XMax > R)`.
- That is the version visible to `R`.

The B-tree index points to the *latest* version of each key. The reader, after looking up the key in the index, walks the version chain to find their visible version.

### Garbage collection

Versions older than the oldest active transaction can be reclaimed:

```
GC pass:
    oldest_active = min(active transaction IDs)
    for each version chain v3 -> v2 -> v1 -> nil:
        find the first version with XMin <= oldest_active.
        Truncate the chain to that point.
```

In PostgreSQL this is `VACUUM`. In MySQL InnoDB it is the `purge thread`. In CockroachDB it is `range GC`. The mechanism is the same.

### Tombstones in the index

A delete creates a new version with `XMax` set. The B-tree index still points to the version chain (it does not know about deletion). Eventually, GC removes the entire chain; only then is the index entry removed.

### Implications for the tree

- The tree is concurrent only at the structural level (latches / COW).
- MVCC is layered on top via per-row version chains.
- The tree's role is to find the *index entry*; the version chain is walked after.

A Go sketch:

```go
type Row struct {
    Key      string
    Versions []Version
    mu       sync.RWMutex
}

type Version struct {
    Value []byte
    XMin  int64
    XMax  int64
}

type Index struct {
    bt *btree.BTreeG[*Row]
}

func (i *Index) Read(key string, txID int64) ([]byte, bool) {
    row, ok := i.bt.Get(&Row{Key: key})
    if !ok {
        return nil, false
    }
    row.mu.RLock()
    defer row.mu.RUnlock()
    for j := len(row.Versions) - 1; j >= 0; j-- {
        v := row.Versions[j]
        if v.XMin <= txID && (v.XMax == 0 || v.XMax > txID) {
            return v.Value, true
        }
    }
    return nil, false
}

func (i *Index) Write(key string, value []byte, txID int64) {
    row, ok := i.bt.Get(&Row{Key: key})
    if !ok {
        row = &Row{Key: key}
        i.bt.ReplaceOrInsert(row)
    }
    row.mu.Lock()
    defer row.mu.Unlock()
    if len(row.Versions) > 0 {
        row.Versions[len(row.Versions)-1].XMax = txID
    }
    row.Versions = append(row.Versions, Version{Value: value, XMin: txID})
}
```

The tree is one mutex; per-row version chains are their own mutexes. Snapshot reads do not block writers; writers do not block readers (assuming row locks are not contended).

### Snapshot isolation correctness

The key property: a reader with `txID = R` sees a consistent view *as if the database had no other concurrent transactions running*. This is achieved by the version visibility rule above. Each row appears to the reader exactly as it was at time `R`, regardless of subsequent writes.

Snapshot isolation is not the strongest isolation level (serializable is stronger), but it is what 99% of production OLTP databases offer because the latency cost of serializable is high.

### When the tree itself needs MVCC

In CockroachDB Pebble, the tree itself stores MVCC entries directly — keys are `(userKey, timestamp)` pairs, sorted by `userKey` ascending and `timestamp` descending. A "get at time T" is a single tree lookup for the largest entry with `(userKey, T_or_less)`. No separate version chain; the tree *is* the version chain.

This is the cleanest design for an LSM-based MVCC store. For a B-tree-based one, the version-chain-per-row design is more common.

---

## RCU and Epoch-Based Reclamation

Read-Copy-Update is the canonical lock-free read pattern in the Linux kernel. Writers swap pointers atomically; readers proceed without locks; old memory is freed only after all in-flight readers finish.

In Go, **the garbage collector subsumes most of RCU's mechanics**. As long as old pointers are not retained by any goroutine, they will be collected. There is no need for an explicit epoch system.

But there are a few cases where you need explicit reclamation in Go:

1. **`unsafe.Pointer` mixed with type-punning.** GC sees only typed pointers; if you cast to `uintptr` to embed bits, GC will collect the object.
2. **`sync.Pool` of nodes with embedded `unsafe.Pointer`.** If a node returned to the pool is reused while another goroutine still holds a pointer to it, you have use-after-free.
3. **Interop with C via cgo.** C-allocated memory is not seen by Go's GC.
4. **Off-heap allocation (e.g., mmap'd regions).** Same as cgo.

For pure Go code with `atomic.Pointer[Node]` and no `unsafe`, you do not need epochs.

### A toy epoch reclaimer

For completeness:

```go
package epoch

import (
    "sync"
    "sync/atomic"
)

type Reclaimer struct {
    epoch  atomic.Int64
    queues []sync.Mutex // per-epoch reclaim queue
    items  [][]any
}

func NewReclaimer() *Reclaimer {
    return &Reclaimer{
        queues: make([]sync.Mutex, 3),
        items:  make([][]any, 3),
    }
}

// Enter is called by a reader at the start of its critical section.
// Returns the epoch the reader is in.
func (r *Reclaimer) Enter() int64 {
    return r.epoch.Load()
}

// Exit signals the reader has left.
func (r *Reclaimer) Exit(epoch int64) {
    // Track per-epoch reader counts via a separate counter.
    // Omitted for brevity.
}

// Retire enqueues an object for reclamation in the current epoch.
func (r *Reclaimer) Retire(obj any) {
    e := r.epoch.Load() % 3
    r.queues[e].Lock()
    r.items[e] = append(r.items[e], obj)
    r.queues[e].Unlock()
}

// Advance moves to the next epoch. Items retired two epochs ago can be freed.
func (r *Reclaimer) Advance() {
    new := r.epoch.Add(1)
    old := (new - 2 + 3) % 3 // 2 epochs back
    r.queues[old].Lock()
    // Wait for all readers in epoch `old` to finish.
    // Then drop items.
    r.items[old] = nil
    r.queues[old].Unlock()
}
```

The epoch reclaimer works in principle but is fiddly. In Go, prefer:

- `atomic.Pointer[T]` for publish.
- Plain GC for reclamation.
- `sync.Pool` only when you can prove no concurrent reader holds the node.

### Hazard pointers

An alternative to epoch reclamation. Each reader publishes the pointers it currently holds into a per-thread "hazard" array. Writers, before freeing a pointer, check no reader's hazard array contains it.

```go
type HazardSlot struct {
    p atomic.Pointer[Node]
}

var hazards [maxThreads]HazardSlot

func (r *Reader) Read() *Node {
    for {
        p := globalRoot.Load()
        hazards[r.id].p.Store(p)
        // Re-check: did the global root change?
        if globalRoot.Load() != p {
            continue
        }
        return p
    }
}

func (w *Writer) Free(p *Node) {
    // Scan all hazard slots; if none contain p, free.
    for i := 0; i < maxThreads; i++ {
        if hazards[i].p.Load() == p {
            return // someone is reading; defer
        }
    }
    // safe to free
}
```

Hazard pointers are precise (you know exactly which objects are in use) but have higher per-read overhead than epochs. Used in some lock-free data structure papers; rare in Go (again, GC suffices).

### When you do need explicit reclamation in Go

If you build a tree where node memory is in an arena (`mmap`'d region or `cgo` allocation), Go's GC cannot help. Then you must implement epoch or hazard reclamation manually.

Real example: `bbolt` uses `mmap`'d pages, so its readers must hold a "transaction" that is essentially an epoch. Until the transaction is closed, pages it touched are not reclaimed.

---

## Immutable Persistent Trees: HAMT and Beyond

For workloads that need cheap snapshots with fully persistent semantics — every version is a first-class value, mutations produce new trees — *immutable* trees are the right architecture.

### Hash Array Mapped Trie (HAMT)

The HAMT is the persistent map data structure used in Clojure (`PersistentHashMap`), Scala (`HashMap`), and many functional libraries. Key properties:

- `O(log_{32} n)` for lookup, insert, delete.
- Structural sharing: insert clones a path of `O(log_{32} n)` nodes.
- Fully persistent: every version is independently usable.
- No tree balancing: hashing distributes keys.

The structure: a tree of fan-out 32, where each node is an array of up to 32 children, and the index at each level is 5 bits of the key's hash.

```go
package hamt

const (
    bitsPerLevel = 5
    fanout       = 1 << bitsPerLevel
    mask         = fanout - 1
)

type Node struct {
    bitmap uint32 // which slots are populated
    slots  []any  // either *Node or *Leaf
}

type Leaf struct {
    Key  uint64
    Hash uint64
    Val  any
    Next *Leaf // for hash collisions
}

func (n *Node) get(hash uint64, level int, key uint64) (any, bool) {
    idx := uint32(hash>>(level*bitsPerLevel)) & mask
    if n.bitmap&(1<<idx) == 0 {
        return nil, false
    }
    pos := bitsBelow(n.bitmap, idx)
    slot := n.slots[pos]
    switch x := slot.(type) {
    case *Node:
        return x.get(hash, level+1, key)
    case *Leaf:
        for x != nil {
            if x.Key == key {
                return x.Val, true
            }
            x = x.Next
        }
    }
    return nil, false
}

func bitsBelow(bitmap, idx uint32) int {
    return popcount(bitmap & ((1 << idx) - 1))
}

func popcount(x uint32) int {
    // ... use math/bits.OnesCount32
}
```

`Insert` is similar but allocates a new `Node` with the slot updated:

```go
func (n *Node) insert(hash uint64, level int, leaf *Leaf) *Node {
    idx := uint32(hash>>(level*bitsPerLevel)) & mask
    pos := bitsBelow(n.bitmap, idx)
    if n.bitmap&(1<<idx) == 0 {
        // Insert new leaf.
        nn := &Node{
            bitmap: n.bitmap | (1 << idx),
            slots:  make([]any, len(n.slots)+1),
        }
        copy(nn.slots[:pos], n.slots[:pos])
        nn.slots[pos] = leaf
        copy(nn.slots[pos+1:], n.slots[pos:])
        return nn
    }
    // Slot occupied. Either descend or split.
    nn := &Node{bitmap: n.bitmap, slots: append([]any{}, n.slots...)}
    switch x := n.slots[pos].(type) {
    case *Node:
        nn.slots[pos] = x.insert(hash, level+1, leaf)
    case *Leaf:
        if x.Hash == leaf.Hash {
            // Hash collision; chain leaves.
            leaf.Next = x
            nn.slots[pos] = leaf
        } else {
            // Promote to subtree.
            sub := &Node{}
            sub = sub.insert(x.Hash, level+1, x)
            sub = sub.insert(leaf.Hash, level+1, leaf)
            nn.slots[pos] = sub
        }
    }
    return nn
}
```

`Insert` allocates ~`O(log_{32} n)` nodes. For a 1B-entry HAMT that is ~6 small allocations per write — comparable to a B-tree COW path-copy.

### Why HAMT instead of COW B-tree?

- HAMT is unordered (hash-based). For ordered workloads, use a tree.
- HAMT has very flat tree (fanout 32 = depth ~6 for 1B entries); the per-write allocation count is bounded.
- HAMT is fully persistent — every version is usable forever without reference counting.

In Go, HAMT implementations exist (`github.com/persistent/data-structures`, others). They are less common than in Clojure / Scala because Go's `sync.Map` and a `sync.RWMutex + map` cover most use cases.

For an *ordered* fully persistent tree, the standard choice is a 2-3 finger tree or a balanced BST variant (e.g., a weight-balanced tree). These appear rarely in Go; reach for them only if your workload demands fully persistent ordered data.

### Bw-tree (preview)

The Bw-tree is the Microsoft Research take on a lock-free B-tree:

- A **mapping table** maps node IDs to memory pointers.
- Nodes are modified by appending **delta records** to a linked chain at the node ID.
- The mapping table entry is updated via CAS to point to the new delta head.
- Periodically, a node's delta chain is **consolidated** into a fresh base node.
- **Epoch-based reclamation** handles old delta records and consolidated bases.

The result: lock-free reads and writes (only CAS contention on the mapping table). Used in Microsoft Hekaton.

Full treatment in the professional file. For now, recognize it as the apex of in-memory B-tree concurrency design.

### Concurrent ART

The Adaptive Radix Tree is a radix trie variant whose nodes adapt their size to the number of children. It is highly cache-efficient and supports both point access and range scans.

A concurrent ART (e.g., the implementation in HyPer and DuckDB) uses OLFIT-style optimistic latching with version counters per node, similar to a concurrent B-tree but on a radix trie shape.

Go implementations: `github.com/plar/go-adaptive-radix-tree` is one; not currently concurrent. If you need concurrent ART in Go, you implement it yourself or use a CGo binding to a C++ library.

For ordered string keys at very high scale, ART beats B-trees on lookup latency. For mixed integer / string keys with range queries, a B-tree is still simpler.

---

## Engineering Tour: PostgreSQL nbtree, BoltDB, CockroachDB Pebble

Reading the source of real systems is the best way to internalize this material.

### PostgreSQL nbtree

`src/backend/access/nbtree/` in the PostgreSQL source. Key files:

- `nbtree.c` — main API.
- `nbtinsert.c` — insertion with Lehman-Yao splits.
- `nbtsearch.c` — search with right-sibling chasing.
- `nbtxlog.c` — write-ahead logging for splits.
- `README` — the protocol described in English. Read this first.

The protocol is Lehman-Yao with several refinements:

- High keys are stored explicitly in every internal node.
- Right-sibling pointers are stored in every page.
- Splits are atomic with respect to readers: the new right sibling is fully populated and linked before the parent is updated.
- Deletes mark tombstones; merges happen lazily via VACUUM.

The page format uses 8 KB pages aligned to disk. Each page has a header, a sorted array of (key, child pointer) entries, and a special area for the high key and right-sibling pointer.

Read the README. It is one of the best technical documents in any open-source codebase.

### BoltDB / bbolt

`go.etcd.io/bbolt` is a pure-Go B+-tree key-value store. Key properties:

- **Single writer at a time.** A `RWTransaction` is exclusive.
- **Many concurrent readers.** Each `ReadTransaction` sees a consistent snapshot.
- **Copy-on-write at page granularity.** A modified page is written to a new location; old pages are freed at commit.
- **mmap'd file.** Reads are direct memory access; no buffer pool.

Key files in bbolt:

- `bucket.go` — the per-bucket B+-tree.
- `node.go` — in-memory node representation.
- `page.go` — on-disk page format.
- `tx.go` — transaction lifecycle.

The concurrency model: one `Update` transaction at a time; many `View` transactions in parallel. Old pages are kept alive until no `View` transaction can see them — a manual epoch reclamation tied to the txid of the oldest active reader.

Reading `bbolt`'s `node.split` and `tx.Commit` gives you a clean picture of how a real production B+-tree implements COW with multi-version reads.

### CockroachDB Pebble

`github.com/cockroachdb/pebble` is a Go LSM-tree-based key-value store. It is the storage engine of CockroachDB.

Pebble is LSM, not B-tree, but it embeds a B-tree-flavoured structure: each SSTable is a sorted on-disk file with a small B-tree index on top. The memtable (in-memory writes before they flush to disk) is a *concurrent skip list*.

Worth reading for:

- How LSM and B-tree concepts interact.
- How the memtable's skip list achieves lock-free reads.
- How range deletes are encoded.
- How MVCC is layered on top (each key is suffixed with a timestamp).

Read `internal/arenaskl` for the lock-free skip list; read `sstable/` for the B-tree-indexed sorted file.

### What these systems share

- **Single-writer or write-mostly-serial.** Most systems do not let many writers contend; they either serialize via transactions or shard writes.
- **Multi-version reads.** Readers see a consistent snapshot regardless of writers.
- **Right-sibling pointers.** Either Lehman-Yao B-link or LSM range tombstones with similar effect.
- **Deferred reclamation.** Old versions live until no reader can see them.
- **Bulk batching.** Writes accumulate and flush together for efficiency.

These are the structural patterns of every production-grade concurrent ordered store. Internalize them.

---

## Coding Patterns

**Pattern 1: Single writer, lock-free readers.**

The most common production pattern. One goroutine (or one transaction at a time) writes; readers see a consistent snapshot.

```go
type Engine struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
}
```

**Pattern 2: Transactional writes via channel.**

For complex multi-step writes, dispatch to a single goroutine:

```go
type WriteCmd struct {
    Op   string
    Item Item
    Done chan error
}

type Engine struct {
    cmds chan WriteCmd
}

func (e *Engine) writer() {
    tr := btree.NewBTreeG[Item](less)
    for cmd := range e.cmds {
        switch cmd.Op {
        case "set":
            tr.Set(cmd.Item)
        case "del":
            tr.Delete(cmd.Item)
        }
        e.publish(tr)
        cmd.Done <- nil
    }
}
```

Writes are serialized through the channel; readers use the published snapshot. This is the actor model applied to a tree.

**Pattern 3: Per-shard publish/subscribe.**

For very high throughput, shard the keyspace and use publish/subscribe per shard.

**Pattern 4: Version chain on top of a tree.**

For MVCC-style reads: the tree stores `*Row`; each row has a version chain.

**Pattern 5: Tombstone + lazy merge.**

Deletes leave tombstones in the tree; a background goroutine merges sparse nodes periodically. Writes never block on a merge.

---

## Clean Code at Scale

- **Encapsulate the protocol.** Every protocol-aware piece of code lives behind a single type. Callers never see latches.
- **Document invariants.** Each method's preconditions and postconditions are commented. "Holds X-latch on node n on entry; releases before return."
- **Use named lock types.** A wrapped `sync.RWMutex` named `Latch` makes the intent clear in code review.
- **Test invariants directly.** A `walkAndVerify` function that asserts all tree invariants after each operation. Run it in tests with `-tags invariants`.
- **Avoid global state.** Latches, root pointers, mapping tables — all live inside the tree struct, not in package globals.
- **Bound retries.** OCC retries bounded by a constant; CAS loops bounded; if exhausted, fall through to a global lock.

---

## Product Use

- **In-memory database engine.** Hekaton-style. Bw-tree or OLFIT-style B-tree. Per-row MVCC chains. Snapshot isolation.
- **Time-series store.** B+-tree of `(timestamp, series_id)`. Lock-free reads via published snapshots. Sharded writes by series ID.
- **Range-scan API.** Customer-facing pagination by cursor. The tree's `Ascend` is the engine; the cursor is the snapshot version.
- **Routing table for an API gateway.** B-tree of route prefixes. Updates from a control plane; reads on every request. COW + atomic publish is the right shape.
- **Live dashboards.** Read-mostly with periodic writes; publish/subscribe COW.
- **Game leaderboards.** Updates per game tick; reads per UI refresh. Per-game sharding with snapshot publishing.

---

## Performance Tips

- **Profile before optimizing.** Use `runtime/pprof` and `runtime/trace`. The hottest things are rarely what you assumed.
- **Watch GC pressure.** COW snapshots produce garbage. `GOGC` and `GOMEMLIMIT` knobs matter. Profile heap allocations.
- **Cache-align nodes.** A B-tree node should fit in a small number of cache lines. Padding to 64 bytes can help.
- **Avoid pointer-heavy items.** Inline values in nodes when possible.
- **Batch writes.** One snapshot publish per N writes amortizes allocation.
- **Pre-allocate node slices.** A node's `items` slice should be pre-sized to the max fanout to avoid `append` reallocations.
- **Tune fanout to your workload.** Lower fanout (16) reduces per-write copy cost. Higher (64) reduces tree depth. Benchmark.
- **Avoid `interface{}` items in the tree.** Use concrete types via generics.
- **Reuse `*btree.BTreeG` allocations.** A `sync.Pool` of cleared trees can help if you build many short-lived trees.

---

## Best Practices

- Choose the simplest protocol that meets your performance budget.
- Default to publish/subscribe COW with `tidwall/btree`.
- Promote to sharded only with profiling evidence.
- Promote to hand-over-hand or OCC only if you are building a database engine.
- Always test with `-race`.
- Always benchmark on realistic hardware and realistic workloads.
- Document the protocol's invariants in the type's doc comment.
- Encapsulate the protocol behind a clean API.

---

## Edge Cases and Pitfalls

- **Reader holding a snapshot indefinitely.** Pins memory; old nodes never collected. Bound snapshot lifetimes.
- **Writer races to publish.** With multiple writer goroutines, you need a mutex around the publish to avoid lost updates.
- **GC pauses under heavy COW.** A 10ms STW pause can ruin tail latency. Tune GOGC.
- **B-link right-sibling on the rightmost node.** It is `nil`; readers must check.
- **MVCC garbage accumulation.** A long-running transaction prevents version GC. Monitor.
- **Tombstone accumulation.** Deletes that are never followed by a merge bloat the tree. Periodic VACUUM.

---

## Common Mistakes

1. Implementing your own B-link instead of using `bbolt` or a similar library.
2. Forgetting to release a latch on every code path.
3. Holding the writer mutex during the `Copy()` (it is cheap but every nanosecond counts).
4. Publishing inside a hot loop without batching.
5. Mixing snapshot reads with live reads in the same query path.
6. Not handling the rightmost-node case in B-link traversal.
7. Garbage-collecting versions still visible to an active transaction.
8. Letting a snapshot leak in a global map.
9. Implementing MVCC version chains as `[]Version` with locked mutation, which becomes the new contention point.
10. Trying to make every operation lock-free when the workload does not need it.

---

## Common Misconceptions

- *"B-link eliminates all latches."* It eliminates parent re-latching on read after a split. Other latches remain.
- *"OCC is lock-free."* No; writers still take a per-node latch. Readers are lock-free.
- *"MVCC is free."* No; version chains cost storage and GC effort.
- *"COW always wins."* COW pays per-write allocation. For write-heavy workloads, hand-over-hand may win.
- *"Sharding solves all concurrency."* It solves point-access scalability but breaks range queries.
- *"You should use a Bw-tree because it is lock-free."* Maybe. Bw-trees are extremely complex and bug-prone. Use one only if you genuinely need its properties.

---

## Tricky Points

- **B-link split visibility.** The right sibling pointer must be published *before* readers can see the parent update. Atomic write order matters.
- **MVCC garbage collection horizon.** Determining the oldest active transaction is itself a concurrent problem.
- **Snapshot reuse.** A snapshot acquired by one goroutine and stored in a global may be referenced long after its acquirer is gone. Document lifecycle.
- **GC and pinned `unsafe.Pointer`.** A `uintptr` does not pin the underlying object. Use `runtime.KeepAlive` if you need it.
- **`atomic.Pointer[T]` after struct embedding.** Be careful with field offsets; atomic must be aligned.

---

## Test

```go
package btree_test

import (
    "math/rand"
    "sync"
    "sync/atomic"
    "testing"

    "github.com/tidwall/btree"
)

type Item struct {
    Key int
    Val int
}

func less(a, b Item) bool { return a.Key < b.Key }

type Engine struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
}

func newEngine() *Engine {
    e := &Engine{live: btree.NewBTreeG[Item](less)}
    e.snapshot.Store(e.live.Copy())
    return e
}

func (e *Engine) Set(it Item) {
    e.mu.Lock()
    defer e.mu.Unlock()
    e.live.Set(it)
    e.snapshot.Store(e.live.Copy())
}

func (e *Engine) Get(k int) (Item, bool) {
    return e.snapshot.Load().Get(Item{Key: k})
}

func TestSnapshotIsolation(t *testing.T) {
    e := newEngine()
    for i := 0; i < 100; i++ {
        e.Set(Item{Key: i, Val: i})
    }
    snap1 := e.snapshot.Load()
    for i := 100; i < 200; i++ {
        e.Set(Item{Key: i, Val: i})
    }
    if snap1.Len() != 100 {
        t.Fatalf("snap1.Len=%d", snap1.Len())
    }
    if e.snapshot.Load().Len() != 200 {
        t.Fatalf("current.Len=%d", e.snapshot.Load().Len())
    }
}

func TestConcurrentReadDuringWrite(t *testing.T) {
    e := newEngine()
    for i := 0; i < 10_000; i++ {
        e.Set(Item{Key: i, Val: i})
    }
    var wg sync.WaitGroup
    // Writer
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 10_000; i < 20_000; i++ {
            e.Set(Item{Key: i, Val: i})
        }
    }()
    // Many readers
    for r := 0; r < 8; r++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < 20_000; i++ {
                k := rand.Intn(20_000)
                e.Get(k)
            }
        }()
    }
    wg.Wait()
}
```

Run with `go test -race -count=10`.

---

## Tricky Questions

**Q1.** Why does Lehman-Yao not need to re-latch the parent on a missed split?
A. Because the right-sibling pointer makes the new sibling reachable to in-flight readers without parent involvement.

**Q2.** In MVCC, how do we know it is safe to garbage collect a version?
A. When its `XMax` is less than the oldest active transaction's snapshot timestamp.

**Q3.** Why does Go's GC subsume RCU?
A. Because GC observes all reachable typed pointers. As soon as a node is unreachable, it is collected. No explicit epoch needed.

**Q4.** When is an explicit epoch reclaimer necessary in Go?
A. When using `unsafe.Pointer`, cgo, or mmap'd memory that Go's GC does not own.

**Q5.** What is the worst-case allocation rate of COW for a tree of fanout 32 and 1B entries under continuous writes?
A. ~6 nodes per write (height ~6). At 100 KB per node, that is ~600 KB/write. At 10k writes/sec, ~6 GB/sec — too much. In practice nodes are smaller (~1 KB) so 6 KB/write, 60 MB/sec — fine.

**Q6.** How does PostgreSQL handle B-tree merges?
A. It defers them. Deletes mark tombstones; `VACUUM` merges sparse pages later.

**Q7.** What is the difference between a B-tree and a B+-tree from a concurrency standpoint?
A. B+-tree leaves are linked into a doubly-linked list, enabling efficient range scans without parent involvement. Concurrent splits must also update sibling links.

**Q8.** Why is the Bw-tree's mapping table key to its design?
A. It indirects from node IDs to memory pointers, allowing nodes to be "moved" (consolidated) without updating all parents.

**Q9.** What makes ART more cache-efficient than a B-tree?
A. ART nodes are sized to the actual number of children (4 / 16 / 48 / 256), wasting no memory on empty slots, and traversal indexes directly by key byte.

**Q10.** What is OLFIT and why does it matter?
A. Optimistic Latch-Free Index Traversal. Readers do not take latches; they validate against per-node version counters. Combined with B-link, it achieves lock-free reads on a B-tree.

---

## Cheat Sheet

| Problem | Architecture |
|---------|--------------|
| In-memory ordered cache | Publish/subscribe COW with tidwall/btree |
| Disk-backed B+-tree | bbolt (single writer, MVCC readers) |
| LSM store | Pebble |
| In-memory radix prefix | ART (if you have one) |
| Persistent unordered map | HAMT |
| Multi-master concurrent B+-tree | Lehman-Yao + MVCC + manual epoch |

| Protocol | Use when |
|----------|---------|
| Single Mutex | Low throughput, simple is best |
| RWMutex | Read-heavy, small tree |
| Sharded | Point-heavy, range-light, very high throughput |
| Hand-over-hand | Building a database engine |
| OLFIT | Read-heavy, very large tree, willing to write a lot of code |
| COW publish/subscribe | Default for ordered concurrent data in Go |
| Lehman-Yao B-link | Inside a real database engine |
| Bw-tree | You are Microsoft Research |

---

## Self-Assessment Checklist

- [ ] Explain Lehman-Yao B-link in your own words.
- [ ] Write the descent loop of a B-link reader.
- [ ] Architect an MVCC version-chain layer on top of a concurrent tree.
- [ ] Explain why Go's GC subsumes RCU and when it does not.
- [ ] Implement a HAMT in Go.
- [ ] Read PostgreSQL nbtree's README without confusion.
- [ ] Choose between hand-over-hand, OCC, and COW with reasoning.
- [ ] Debug a B-tree split race with the help of `-race`.
- [ ] Design a sharded publish/subscribe ordered store.
- [ ] Recognize when to reach for ART, Bw-tree, or stick with B-tree.

---

## Summary

The senior level is about architecting real systems. The protocols are tools; the architecture is the design. For Go in 2026, the dominant architecture is:

- **Publish/subscribe COW with `tidwall/btree`** for in-memory ordered concurrent data.
- **`bbolt`** for on-disk single-writer MVCC.
- **Pebble** for LSM-based large-scale ordered storage.

If you build outside these, you are building a database engine — which is a multi-year project. Read PostgreSQL's nbtree README, BoltDB's source, Pebble's memtable. Internalize Lehman-Yao. Then come back, find the simplest published library that fits your workload, and use it.

The professional file goes further: Bw-trees, concurrent ART, hardware transactional memory, and the inside of Hekaton-class systems.

---

## Further Reading

- Lehman, Yao, *Efficient Locking for Concurrent Operations on B-Trees* (1981).
- Levandoski et al., *The Bw-Tree* (2013).
- Leis et al., *The Adaptive Radix Tree* (2013).
- Cha et al., *OLFIT* (2001).
- Mao et al., *MassTree* (2012).
- PostgreSQL source: `src/backend/access/nbtree/README`.
- bbolt source: `bucket.go`, `node.go`, `tx.go`.
- Pebble source: `internal/arenaskl/` and `sstable/`.
- McKenney, *Is Parallel Programming Hard?* — RCU bible.

---

## Related Topics

- [Professional file](professional/) — Bw-trees, concurrent ART, hardware transactional memory.
- [MVCC](../../../11-databases/06-mvcc/) — full treatment of multi-version concurrency.
- [Copy-on-Write](../05-copy-on-write/) — broader pattern.
- [Concurrent Skip List](../03-concurrent-skip-list/) — alternative ordered structure.

---

## Diagrams

### Lehman-Yao B-link search

```
target = 75

walk root:
  root.highKey = 1000, key=75 <= highKey, ok.
  child = root.children[1]  (covering [50, 100])
  RLock(child); RUnlock(root)
walk child:
  child.highKey = 90, key=75 <= highKey, ok.
  leaf = child.children[0]  (covering [50, 90])
  RLock(leaf); RUnlock(child)
at leaf:
  leaf.highKey = 80, key=75 <= highKey, found.
return value
```

If a split had happened concurrently:

```
at leaf:
  leaf.highKey = 60, key=75 > highKey.
  rightSib = newLeaf
  RLock(rightSib); RUnlock(leaf)
at rightSib:
  rightSib.highKey = 80, key=75 <= highKey, found.
```

### MVCC version chain

```
key=42:
  index_entry -> Row {
    Versions:
      [0] {Value: "a", XMin: 100, XMax: 200}   <- visible to txID in [100, 200)
      [1] {Value: "b", XMin: 200, XMax: 300}   <- visible to txID in [200, 300)
      [2] {Value: "c", XMin: 300, XMax: 0}     <- visible to txID >= 300
  }

reader with txID = 250:
  walk chain, find first version where XMin <= 250 < XMax (or XMax=0).
  v[1] matches: XMin=200, XMax=300. Return "b".
```

### Publish/subscribe COW

```
time -->

writer: Set(it1) Copy() Store(s1)
                       Set(it2) Copy() Store(s2)
                                      Set(it3) Copy() Store(s3)

reader1: Load(s1) ... walks immutable s1 ... done
reader2:          Load(s2) ... walks immutable s2 ... done
reader3:                   Load(s3) ... walks immutable s3 ... done
```

Each snapshot is reachable until no goroutine retains it, then GC reclaims.

### B-tree fanout vs depth

```
fanout: 2   4   8   16   32   64   128
1k:     10   5   4   3    2    2    2
1M:     20  10   7   5    4    4    3
1B:     30  15  10   8    6    5    5
1T:     40  20  14  10    8    7    6
```

Higher fanout = flatter tree = fewer levels = fewer latch acquisitions = faster.

---

## Appendix A: A complete Lehman-Yao B-link B+-tree skeleton in Go

Below is a working (though deliberately small) Lehman-Yao B+-tree of `int64` keys to `string` values. About 250 lines. Read it slowly.

```go
package blink

import (
    "sort"
    "sync"
    "sync/atomic"
)

const fanout = 32

type Node struct {
    latch    sync.RWMutex
    isLeaf   bool
    items    []item            // sorted by Key
    children []*Node           // len(items)+1 if !isLeaf; nil if isLeaf
    highKey  int64             // largest key reachable through this node
    rightSib *Node             // right sibling
    version  atomic.Uint64
}

type item struct {
    Key int64
    Val string
}

type Tree struct {
    rootMu sync.Mutex
    root   atomic.Pointer[Node]
}

func New() *Tree {
    t := &Tree{}
    t.root.Store(&Node{isLeaf: true, highKey: maxInt64})
    return t
}

const maxInt64 = int64(^uint64(0) >> 1)

func findItem(items []item, key int64) (int, bool) {
    lo, hi := 0, len(items)
    for lo < hi {
        mid := int(uint(lo+hi) >> 1)
        if items[mid].Key < key {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    if lo < len(items) && items[lo].Key == key {
        return lo, true
    }
    return lo, false
}

func (t *Tree) Get(key int64) (string, bool) {
    n := t.root.Load()
    n.latch.RLock()
    for !n.isLeaf {
        // Follow right sibling chain if key > highKey.
        for key > n.highKey && n.rightSib != nil {
            next := n.rightSib
            next.latch.RLock()
            n.latch.RUnlock()
            n = next
        }
        i := internalChild(n, key)
        child := n.children[i]
        child.latch.RLock()
        n.latch.RUnlock()
        n = child
    }
    for key > n.highKey && n.rightSib != nil {
        next := n.rightSib
        next.latch.RLock()
        n.latch.RUnlock()
        n = next
    }
    i, found := findItem(n.items, key)
    if !found {
        n.latch.RUnlock()
        return "", false
    }
    v := n.items[i].Val
    n.latch.RUnlock()
    return v, true
}

func internalChild(n *Node, key int64) int {
    // children[i] covers keys <= items[i].Key.
    // Find first items[i].Key >= key.
    i := sort.Search(len(n.items), func(i int) bool {
        return n.items[i].Key >= key
    })
    if i < len(n.items) && n.items[i].Key == key {
        return i + 1
    }
    return i
}

// Set inserts or replaces. Uses simple top-down latching with preemptive splits.
// For brevity, propagation up uses a stack maintained during descent.
func (t *Tree) Set(key int64, val string) {
    t.rootMu.Lock()
    type frame struct {
        node *Node
    }
    var stack []frame
    n := t.root.Load()
    n.latch.Lock()

    // If root is full, grow.
    if len(n.items) == fanout {
        newRoot := &Node{
            isLeaf:   false,
            highKey:  maxInt64,
            children: []*Node{n},
        }
        newRoot.latch.Lock()
        t.root.Store(newRoot)
        splitChildLocked(newRoot, 0)
        n.latch.Unlock()
        n = newRoot
    }
    t.rootMu.Unlock()
    stack = append(stack, frame{n})

    for !n.isLeaf {
        // Follow right-sibling if necessary (in case of concurrent split below).
        for key > n.highKey && n.rightSib != nil {
            right := n.rightSib
            right.latch.Lock()
            n.latch.Unlock()
            n = right
            stack[len(stack)-1] = frame{n}
        }
        i := internalChild(n, key)
        child := n.children[i]
        child.latch.Lock()
        if len(child.items) == fanout {
            splitChildLocked(n, i)
            if key > n.items[i].Key {
                child.latch.Unlock()
                child = n.children[i+1]
                child.latch.Lock()
            }
        }
        n.latch.Unlock()
        n = child
        stack = append(stack, frame{n})
    }

    // n is a leaf with room.
    insertItemSorted(&n.items, key, val)
    if key > n.highKey {
        n.highKey = key
    }
    n.latch.Unlock()
}

// splitChildLocked splits parent.children[i] into two.
// parent must be X-latched; child also X-latched.
func splitChildLocked(parent *Node, i int) {
    child := parent.children[i]
    mid := len(child.items) / 2
    medianKey := child.items[mid].Key
    right := &Node{
        isLeaf:  child.isLeaf,
        highKey: child.highKey,
        rightSib: child.rightSib,
    }
    right.items = append(right.items, child.items[mid:]...)
    if !child.isLeaf {
        right.children = append(right.children, child.children[mid+1:]...)
        child.children = child.children[:mid+1]
    }
    child.items = child.items[:mid]
    child.highKey = medianKey - 1
    child.rightSib = right
    // Insert medianKey into parent.items at i.
    parent.items = append(parent.items, item{})
    copy(parent.items[i+1:], parent.items[i:])
    parent.items[i] = item{Key: medianKey}
    parent.children = append(parent.children, nil)
    copy(parent.children[i+2:], parent.children[i+1:])
    parent.children[i+1] = right
}

func insertItemSorted(items *[]item, key int64, val string) {
    s := *items
    i := sort.Search(len(s), func(i int) bool { return s[i].Key >= key })
    if i < len(s) && s[i].Key == key {
        s[i].Val = val
        return
    }
    s = append(s, item{})
    copy(s[i+1:], s[i:])
    s[i] = item{Key: key, Val: val}
    *items = s
}
```

What this skeleton illustrates:

- Per-node latches.
- Right-sibling chasing in `Get`.
- Preemptive splits on the way down (write path).
- High keys updated atomically with right-sibling pointers.

Not shown (left as exercises):

- Deletes and merges.
- Range iteration via leaf linked list.
- Stack-based parent recovery for B-link writes (this skeleton avoids it by re-locking the root for each operation, which is a simplification).
- B-link writes that fully exploit the right-sibling protocol (rather than re-locking the root).

Read this carefully, run it under `-race` with a stress test, and you have a working B-link tree.

---

## Appendix B: A worked MVCC reader/writer

Here is a full MVCC store with snapshot isolation in Go.

```go
package mvcc

import (
    "sync"
    "sync/atomic"

    "github.com/tidwall/btree"
)

type Version struct {
    Value string
    XMin  int64
    XMax  int64
    Next  *Version // older versions
}

type Row struct {
    Key      string
    Newest   *Version // atomic.Pointer would be better; mutex is simpler
    mu       sync.RWMutex
}

func less(a, b *Row) bool { return a.Key < b.Key }

type Store struct {
    mu       sync.Mutex
    bt       *btree.BTreeG[*Row]
    snapshot atomic.Pointer[btree.BTreeG[*Row]]
    txCounter atomic.Int64
}

func New() *Store {
    s := &Store{bt: btree.NewBTreeG[*Row](less)}
    s.snapshot.Store(s.bt.Copy())
    return s
}

// Begin returns a new transaction ID.
func (s *Store) Begin() int64 {
    return s.txCounter.Add(1)
}

// Write inserts a new version of (key, value) for transaction txID.
func (s *Store) Write(key, value string, txID int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    row, ok := s.bt.Get(&Row{Key: key})
    if !ok {
        row = &Row{Key: key}
        s.bt.Set(row)
    }
    row.mu.Lock()
    if row.Newest != nil {
        row.Newest.XMax = txID
    }
    row.Newest = &Version{Value: value, XMin: txID, XMax: 0, Next: row.Newest}
    row.mu.Unlock()
    s.snapshot.Store(s.bt.Copy())
}

// Read returns the value visible at transaction txID.
func (s *Store) Read(key string, txID int64) (string, bool) {
    snap := s.snapshot.Load()
    row, ok := snap.Get(&Row{Key: key})
    if !ok {
        return "", false
    }
    row.mu.RLock()
    defer row.mu.RUnlock()
    for v := row.Newest; v != nil; v = v.Next {
        if v.XMin <= txID && (v.XMax == 0 || v.XMax > txID) {
            return v.Value, true
        }
    }
    return "", false
}

// GC removes versions older than minActive (smallest active transaction's snapshot ID).
func (s *Store) GC(minActive int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.Scan(func(row *Row) bool {
        row.mu.Lock()
        for v := row.Newest; v != nil && v.Next != nil; v = v.Next {
            if v.Next.XMax != 0 && v.Next.XMax < minActive {
                v.Next = nil
                break
            }
        }
        row.mu.Unlock()
        return true
    })
}
```

A full MVCC system would add:

- Optimistic conflict detection (first-committer-wins).
- Read-your-own-writes within a transaction.
- Range scans with snapshot consistency.
- Per-row CAS instead of per-row mutex for higher throughput.

But the skeleton is enough to demonstrate the architecture: the tree holds row pointers; each row holds a version chain; readers see the chain version visible at their snapshot.

---

## Appendix C: Concurrent ART sketch

ART (Adaptive Radix Tree) is the in-memory index of choice for many modern databases. Concurrent ART (cART) uses OLFIT-style version counters.

```go
package art

import (
    "sync"
    "sync/atomic"
)

type NodeKind uint8

const (
    Node4 NodeKind = iota
    Node16
    Node48
    Node256
    Leaf
)

type Node struct {
    kind     NodeKind
    version  atomic.Uint64
    writeMu  sync.Mutex
    prefix   []byte
    // For internal nodes:
    keys     []byte  // or [256]byte for Node256
    children []*Node
    // For leaves:
    key      []byte
    value    []byte
}
```

Lookup:

```go
func (t *Tree) Get(key []byte) ([]byte, bool) {
    for retry := 0; retry < 64; retry++ {
        n := t.root.Load()
        depth := 0
        for {
            v1 := n.version.Load()
            if v1&1 == 1 {
                continue // writer in flight
            }
            // Check prefix.
            for i := 0; i < len(n.prefix); i++ {
                if depth+i >= len(key) || n.prefix[i] != key[depth+i] {
                    return nil, false
                }
            }
            depth += len(n.prefix)
            if n.kind == Leaf {
                if !bytesEqual(n.key, key) {
                    return nil, false
                }
                val := n.value
                if n.version.Load() != v1 {
                    break // retry
                }
                return val, true
            }
            if depth >= len(key) {
                return nil, false
            }
            byte := key[depth]
            child := findChild(n, byte)
            if child == nil {
                if n.version.Load() != v1 {
                    break
                }
                return nil, false
            }
            if n.version.Load() != v1 {
                break // retry
            }
            n = child
            depth++
        }
    }
    panic("too many retries")
}
```

The structure is similar to OCC B-tree: per-node version, read-validate, restart on conflict. The differences are ART-specific (prefix compression, byte-indexed children, four node sizes).

A full ART implementation in Go would be ~2000 lines. The DuckDB and HyPer implementations in C++ are similar in spirit.

---

## Appendix D: A detailed look at bbolt's internals

bbolt uses a single-writer, multiple-reader MVCC model with COW at page granularity. The architecture:

- **mmap'd file.** Pages are accessed directly via memory mapping.
- **Meta pages.** Two of them at offsets 0 and 1; the one with the higher txid is the current root.
- **Pages.** Either branch (internal) or leaf, each 4 KB by default.
- **Transactions.** A `*Tx` is created via `db.Begin(writable)`. Writable transactions are exclusive; read transactions are not.
- **Page free list.** Tracks pages that can be reused. A page can be reused only when no active read transaction can see it.

The COW happens at commit time. The writable transaction builds an in-memory tree of modifications. On commit:

1. Write all dirty pages to new locations on disk.
2. Update the meta page atomically (single 4 KB write).
3. The new meta page becomes the source of truth.
4. Pages freed by the transaction can be reused after the oldest read transaction completes.

Each `Tx` carries a `txid`. The free list tracks "pages freed in txid X." A page can be reused only when all transactions started before its free-txid have committed.

This is essentially an epoch reclaimer where the epoch is the transaction ID, and the reader population is the set of active read transactions.

Read `bbolt/bucket.go` and `bbolt/tx.go` for the implementation. About 3000 lines. The code is unusually readable for a production database.

---

## Appendix E: A detailed look at CockroachDB Pebble's memtable

Pebble's memtable is a concurrent skip list at `internal/arenaskl`. Why a skip list and not a B-tree?

- Skip lists are easier to make lock-free.
- The memtable is short-lived (flushed to disk when full); allocation cost matters less.
- The skip list's "level" structure naturally supports the LSM merge pattern.

The skip list uses an arena allocator: a contiguous chunk of memory from which nodes are bump-allocated. No GC pressure during writes. When the memtable flushes, the entire arena is discarded at once.

This is a great pattern in Go for short-lived structures: allocate from an arena, drop the arena, let the GC handle the bulk free.

```go
// Conceptual sketch.
type Arena struct {
    buf [1 << 20]byte
    off atomic.Uint64
}

func (a *Arena) Alloc(n int) []byte {
    end := a.off.Add(uint64(n))
    return a.buf[end-uint64(n) : end]
}
```

Arena allocation + CAS-based node linkage = lock-free, GC-free skip list. Pebble's implementation is more sophisticated (free slots, variable-sized nodes), but the core idea is this.

---

## Appendix F: A taxonomy of structural sharing strategies

When designing a persistent ordered structure, your options for sharing are:

1. **Path copy (most B-tree COW).** Clone only the nodes on the modified path. Sharing is total elsewhere.
2. **Whole subtree clone (older Lisp lists).** Clone the entire affected subtree. Sharing is minimal.
3. **Delta chain (Bw-tree).** Append a delta record describing the change; the old node remains accessible.
4. **Refcount + COW (tidwall/btree).** Share until refcount > 1, then clone.
5. **Version-numbered slots (some persistent vectors).** Each slot has a version; reads return the version visible to the reader's transaction.

Each strategy has trade-offs:

| Strategy | Read cost | Write cost | Memory overhead |
|----------|-----------|------------|-----------------|
| Path copy | Same as non-persistent | log(n) allocations | log(n) per write |
| Whole subtree clone | Same | O(n/2) | O(n) per write |
| Delta chain | Walk deltas + base | O(1) | O(deltas) until consolidation |
| Refcount + COW | Same | log(n) when shared | log(n) per shared write |
| Version-numbered | Same + version check | O(1) per slot | Bounded by version count |

For most Go workloads, refcount + COW (à la `tidwall/btree`) is the right default.

---

## Appendix G: Lessons from designing concurrent trees in production

A few lessons that recur across teams I have observed:

- **Single-writer is almost always good enough.** Multi-writer concurrency is rare in real workloads; even "highly concurrent" workloads usually fan out by partition, with one logical writer per partition.
- **Snapshots are the unsung hero.** Most "I need concurrent reads" turns out to be "I need a consistent snapshot for this report / query / dump." Publish/subscribe COW solves this elegantly.
- **GC dominates microbenchmarks.** If your tree does 10k writes/sec and each write allocates 6 nodes, you allocate 60k objects/sec. The GC handles this comfortably, but the cycle pause shows up in P99 latency.
- **Memory budget is real.** A million-entry COW snapshot pins millions of nodes. If you have many snapshots in flight, memory grows fast.
- **Range queries are the hidden complexity.** Sharding makes them hard. Persistent COW handles them well. Hand-over-hand handles them well. OCC needs careful protocol design.
- **Tests must be exhaustive.** Race conditions surface only under specific interleavings. Run `-race -count=100` and consider model checking for protocols you invent.

---

## Appendix H: A long worked architecture — Order Book

Suppose you are building an in-memory order book for a financial trading system. Requirements:

- **Two ordered books**: bids (highest price first) and asks (lowest price first).
- **Insert** an order in `O(log n)`.
- **Cancel** an order by ID in `O(log n)`.
- **Match**: pop the best bid and best ask and execute if `bid.price >= ask.price`.
- **Read latency**: P99 < 100 microseconds.
- **Write latency**: P99 < 100 microseconds.
- **Snapshot**: market data feeds receive periodic snapshots.

Architecture:

```go
package orderbook

import (
    "sync"
    "sync/atomic"

    "github.com/tidwall/btree"
)

type Order struct {
    ID    string
    Price int64 // ticks, integer
    Qty   int64
    Time  int64
}

func bidLess(a, b *Order) bool {
    if a.Price != b.Price {
        return a.Price > b.Price // highest first
    }
    if a.Time != b.Time {
        return a.Time < b.Time // earliest first
    }
    return a.ID < b.ID
}

func askLess(a, b *Order) bool {
    if a.Price != b.Price {
        return a.Price < b.Price // lowest first
    }
    if a.Time != b.Time {
        return a.Time < b.Time
    }
    return a.ID < b.ID
}

type Book struct {
    mu          sync.Mutex
    bids        *btree.BTreeG[*Order]
    asks        *btree.BTreeG[*Order]
    byID        map[string]*Order
    bidSnapshot atomic.Pointer[btree.BTreeG[*Order]]
    askSnapshot atomic.Pointer[btree.BTreeG[*Order]]
}

func New() *Book {
    b := &Book{
        bids: btree.NewBTreeG[*Order](bidLess),
        asks: btree.NewBTreeG[*Order](askLess),
        byID: make(map[string]*Order),
    }
    b.bidSnapshot.Store(b.bids.Copy())
    b.askSnapshot.Store(b.asks.Copy())
    return b
}

func (b *Book) PlaceBid(o *Order) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.bids.Set(o)
    b.byID[o.ID] = o
    b.bidSnapshot.Store(b.bids.Copy())
}

func (b *Book) PlaceAsk(o *Order) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.asks.Set(o)
    b.byID[o.ID] = o
    b.askSnapshot.Store(b.asks.Copy())
}

func (b *Book) Cancel(id string) bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    o, ok := b.byID[id]
    if !ok {
        return false
    }
    delete(b.byID, id)
    b.bids.Delete(o)
    b.asks.Delete(o)
    b.bidSnapshot.Store(b.bids.Copy())
    b.askSnapshot.Store(b.asks.Copy())
    return true
}

func (b *Book) Match() []Trade {
    b.mu.Lock()
    defer b.mu.Unlock()
    var trades []Trade
    for {
        bid, hasBid := b.bids.Min()
        ask, hasAsk := b.asks.Min()
        if !hasBid || !hasAsk || bid.Price < ask.Price {
            break
        }
        qty := min(bid.Qty, ask.Qty)
        trades = append(trades, Trade{BidID: bid.ID, AskID: ask.ID, Price: ask.Price, Qty: qty})
        bid.Qty -= qty
        ask.Qty -= qty
        if bid.Qty == 0 {
            b.bids.Delete(bid)
            delete(b.byID, bid.ID)
        }
        if ask.Qty == 0 {
            b.asks.Delete(ask)
            delete(b.byID, ask.ID)
        }
    }
    if len(trades) > 0 {
        b.bidSnapshot.Store(b.bids.Copy())
        b.askSnapshot.Store(b.asks.Copy())
    }
    return trades
}

// MarketData returns a point-in-time snapshot of the top N levels.
func (b *Book) MarketData(depth int) MarketSnapshot {
    bidSnap := b.bidSnapshot.Load()
    askSnap := b.askSnapshot.Load()
    var bidLevels, askLevels []Level
    bidSnap.Scan(func(o *Order) bool {
        if len(bidLevels) >= depth {
            return false
        }
        // Aggregate by price
        if n := len(bidLevels); n > 0 && bidLevels[n-1].Price == o.Price {
            bidLevels[n-1].Qty += o.Qty
        } else {
            bidLevels = append(bidLevels, Level{Price: o.Price, Qty: o.Qty})
        }
        return true
    })
    askSnap.Scan(func(o *Order) bool {
        if len(askLevels) >= depth {
            return false
        }
        if n := len(askLevels); n > 0 && askLevels[n-1].Price == o.Price {
            askLevels[n-1].Qty += o.Qty
        } else {
            askLevels = append(askLevels, Level{Price: o.Price, Qty: o.Qty})
        }
        return true
    })
    return MarketSnapshot{Bids: bidLevels, Asks: askLevels}
}

type Trade struct {
    BidID string
    AskID string
    Price int64
    Qty   int64
}

type Level struct {
    Price int64
    Qty   int64
}

type MarketSnapshot struct {
    Bids []Level
    Asks []Level
}
```

What this gives you:

- `Place`, `Cancel`, `Match` are O(log n) under one mutex.
- `MarketData` reads from a published snapshot without taking the mutex.
- Trade matching is atomic with respect to readers: either a trade has happened (and the snapshot is updated) or not.

Throughput at typical hardware: ~100k orders/sec for `Place`, ~10M snapshots/sec for `MarketData`. The fundamental limit is mutex contention on `Place` / `Cancel` — to scale further you'd shard by symbol (one book per symbol, no inter-symbol contention).

This is a complete, production-shape order book in well under 200 lines.

---

## Appendix I: When to give up and call C

Sometimes Go is not the right language for the innermost loop. If you are building:

- A database engine with custom B-tree page formats.
- A real-time trading system with sub-microsecond latency.
- A specialized in-memory index with custom layout.

…then CGo'ing to a C/C++ implementation (e.g., libART, RocksDB, RethinkDB engine) may be the right move. The Go layer becomes the orchestration; the C layer is the actual tree.

Trade-offs:

- CGo has per-call overhead (~150 ns) that erodes the latency benefit.
- C code is harder to debug from Go.
- Memory ownership is unclear.

Avoid this unless profiling shows Go's GC or scheduler is genuinely your bottleneck. Most "we need C-fast" claims dissolve under careful profiling.

---

## Appendix J: A taxonomy of B-tree variants

Worth knowing in case you see them in literature:

- **B-tree (classic).** All nodes hold data and routing keys.
- **B+-tree.** Data only in leaves; internal nodes hold routing keys. Leaves linked into a list.
- **B*-tree.** Splits less aggressively (waits until two siblings are full, then redistributes). Higher fill factor.
- **B-link tree.** B+-tree with right-sibling pointers and high keys. Lehman-Yao.
- **Cb-tree / cache-oblivious B-tree.** Designed for cache hierarchies; van Emde Boas layout.
- **PA-B-tree (partitioned).** Each leaf is a small partition; aggregates higher up.
- **Bw-tree.** Lock-free with mapping table and delta chains.
- **FB-tree / fast B-tree.** Hardware-aware fanout, lock-free with hardware transactional memory.

For Go services, you will encounter B+-trees (bbolt, BadgerDB), B-link trees (PostgreSQL nbtree if you cross over), and B*-trees in some on-disk stores. The rest are research vehicles or specific-purpose.

---

## Appendix K: A roadmap to the professional file

The professional file goes further into:

- The Bw-tree at full implementation detail.
- Concurrent ART with prefix compression and SIMD-accelerated lookups.
- Hardware transactional memory (Intel TSX, restricted transactional memory).
- Hekaton-class in-memory engines.
- Comparisons across PostgreSQL, MySQL InnoDB, MS SQL Server in-memory tables, Oracle TimesTen, SAP HANA.

If the senior file equipped you to architect a real concurrent ordered store, the professional file equips you to compare and critique the choices made by the world's most advanced database engines.

---

## Appendix L: Closing

You now know enough to:

- Architect any in-memory ordered concurrent store in Go.
- Read PostgreSQL nbtree's source.
- Understand BoltDB's MVCC design.
- Compare COW, hand-over-hand, OCC, and B-link with conviction.
- Implement MVCC version chains on top of a concurrent tree.
- Reason about RCU and epoch reclamation, knowing when Go's GC saves you the trouble.

Practice: build the order book in Appendix H. Profile it. Then read the bbolt source.

When you can describe each architectural choice in bbolt with confidence, you are senior.

---

## Appendix M: Detailed walk through the Lehman-Yao split protocol

Let's step through a single split end-to-end with diagrams.

Initial state — leaf `L` is full with keys `{10, 20, 30, 40, 50, 60, 70, 80}`, fanout 8. We want to insert `35`.

```
                Parent
              [Key=100, RightSib=nil, HighKey=200]
                   |
                   v
                  L
              [10,20,30,40,50,60,70,80]
              highKey=80, rightSib=nil
```

Step 1: latch `L` exclusive.

Step 2: `L` is full. Allocate `M`:

```
M = new leaf
M.items = []
M.highKey = L.highKey = 80
M.rightSib = L.rightSib = nil
```

Step 3: split items at mid=4. Move upper half to `M`:

```
L.items = [10, 20, 30, 40]
M.items = [50, 60, 70, 80]
medianKey = 50  (the smallest key now in M)
```

Step 4: insert `35` into `L` (it belongs in the left half).

```
L.items = [10, 20, 30, 35, 40]
```

Step 5: update `L.highKey` to `medianKey - 1 = 49`, and `L.rightSib = M`.

```
L: items=[10,20,30,35,40], highKey=49, rightSib=M
M: items=[50,60,70,80],     highKey=80, rightSib=nil
```

**Critical moment**: at this point, in-flight readers who descend into `L` looking for key 60 will see `60 > L.highKey = 49`, follow `L.rightSib = M`, find 60. Correct.

Readers descending from `Parent` see the parent's child pointer still pointing only to `L` (the parent has not been updated yet). They land in `L`, then walk right to `M` as needed. Also correct.

Step 6: release latch on `L`. (Atomic publication.)

Step 7: propagate up. Latch `Parent` exclusive, insert `(medianKey=50, M)` into parent's items / children:

```
Parent: items=[50,100], children=[L,M,...] highKey=200
```

Step 8: release `Parent`'s latch.

After full propagation, the structure is:

```
                Parent
                /     \
               L       M
            [10..40] [50..80]
```

Both readers and writers can have been working concurrently throughout. The B-link right-sibling pointer guaranteed no reader ever returned a wrong result.

### Common variations

- **Right-only split**: All inserts at the right edge. Common in monotonic key sequences (timestamps). The B-link protocol handles this well; the rightmost node's `rightSib` stays nil but the new sibling becomes the new rightmost.
- **Cascading split**: A leaf split forces a parent split, which forces a grandparent split, up to the root. The B-link protocol handles this incrementally; each level's split is locally atomic.
- **Root split**: Special case. A new root is created above the old root. The protocol must atomically install the new root (via `atomic.Pointer.Store(&t.root, newRoot)`).

### Lehman-Yao's proof sketch

The paper proves that the B-link protocol maintains four invariants:

1. **High key invariant**: every node `N` has `N.highKey` >= max key reachable through `N`.
2. **Right-link invariant**: for any key `k > N.highKey` that is in the tree, `k` is reachable through `N.rightSib`.
3. **Parent invariant**: every internal node's children's high keys are in sorted order matching the internal node's routing keys.
4. **Termination invariant**: any traversal terminates because the right-sibling chain is finite.

These invariants are maintained at every step of the split protocol because the split publishes the new right sibling before any parent update.

You should be able to articulate these invariants when reading any B-link implementation.

---

## Appendix N: Designing snapshot isolation with COW

A subtle exercise: implement snapshot isolation on top of a COW tree.

```go
package siso

import (
    "sync"
    "sync/atomic"

    "github.com/tidwall/btree"
)

type Entry struct {
    Key   string
    Value string
}

func less(a, b Entry) bool { return a.Key < b.Key }

type Engine struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Entry]
    snapshot atomic.Pointer[btree.BTreeG[Entry]]
}

type Snapshot struct {
    tree *btree.BTreeG[Entry]
    // writes performed within this snapshot (visible only to it until commit)
    writes map[string]string
    deletes map[string]struct{}
}

func New() *Engine {
    e := &Engine{live: btree.NewBTreeG[Entry](less)}
    e.snapshot.Store(e.live.Copy())
    return e
}

func (e *Engine) BeginRead() *Snapshot {
    return &Snapshot{tree: e.snapshot.Load(), writes: nil, deletes: nil}
}

func (e *Engine) BeginWrite() *Snapshot {
    return &Snapshot{
        tree:    e.snapshot.Load(),
        writes:  make(map[string]string),
        deletes: make(map[string]struct{}),
    }
}

func (s *Snapshot) Get(key string) (string, bool) {
    if s.writes != nil {
        if v, ok := s.writes[key]; ok {
            return v, true
        }
        if _, ok := s.deletes[key]; ok {
            return "", false
        }
    }
    e, ok := s.tree.Get(Entry{Key: key})
    return e.Value, ok
}

func (s *Snapshot) Set(key, value string) {
    if s.writes == nil {
        panic("read snapshot")
    }
    s.writes[key] = value
    delete(s.deletes, key)
}

func (s *Snapshot) Delete(key string) {
    if s.writes == nil {
        panic("read snapshot")
    }
    delete(s.writes, key)
    s.deletes[key] = struct{}{}
}

func (e *Engine) Commit(s *Snapshot) bool {
    e.mu.Lock()
    defer e.mu.Unlock()
    // Optional: validate no other write changed our read set. Omitted.
    for k, v := range s.writes {
        e.live.Set(Entry{Key: k, Value: v})
    }
    for k := range s.deletes {
        e.live.Delete(Entry{Key: k})
    }
    e.snapshot.Store(e.live.Copy())
    return true
}

func (e *Engine) Abort(s *Snapshot) {
    // Discard the snapshot's pending changes; nothing else to do.
}
```

This gives you snapshot isolation:

- Read snapshots see the engine's published state at `Begin` time, immune to concurrent writes.
- Write snapshots accumulate changes in their own `writes` / `deletes` maps.
- On `Commit`, changes are applied to `live` and the new snapshot is published.

What this lacks vs production SI:

- **Conflict detection**: a real SI engine detects write-write conflicts via first-committer-wins. The skeleton always commits, which is read-committed plus snapshot reads, not strict SI.
- **Range scans**: not handled. You would need to also iterate the writes/deletes overlay.
- **Garbage collection**: not needed because COW snapshots auto-GC.

Still, it shows how to layer transactional semantics on top of a COW tree in well under 100 lines. This is the architecture inside many embedded Go transactional stores.

---

## Appendix O: A note on lock-free progress guarantees

Three levels of progress guarantees in concurrent algorithms:

- **Obstruction-free**: a thread makes progress if it runs in isolation. Weakest.
- **Lock-free**: at least one thread makes progress at any moment. Stronger.
- **Wait-free**: every thread makes progress in bounded steps. Strongest.

Production B-tree implementations are typically lock-free for reads, single-writer-serialized for writes. True wait-free B-trees exist (e.g., a 2017 paper by Pradeep Singh) but are largely academic.

In Go, the natural shape — COW publish/subscribe with single-writer mutex — gives:

- **Wait-free reads** (just an atomic load and pointer walk).
- **Lock-free writes** under the mutex (each writer makes progress once it acquires the mutex).

For 95% of workloads this is the right design.

---

## Appendix P: How Pebble's memtable handles concurrent writes

Pebble (CockroachDB's storage engine) uses a lock-free concurrent skip list as the memtable. Worth dissecting because it shows what's possible in Go.

The skip list is built on an arena allocator. Each node is a fixed-size record with:

- The key (variable-length, stored after the record header).
- The value pointer (offset into the arena).
- Forward pointers at each level.

Writes:

1. Allocate a node from the arena (CAS on the arena's offset pointer).
2. Compute the node's height (random level).
3. Find the insertion point at each level.
4. CAS the predecessor's forward pointer at each level to point to the new node.

Reads:

1. Start at the highest level of the head node.
2. Follow forward pointers, descending when the next key exceeds the target.
3. At the bottom level, the next node either is the target or is greater.

The arena avoids GC pressure. The CAS-based linking is lock-free. The skip list's randomized height avoids the rotation problems of balanced trees.

For an ordered structure that has to handle thousands of concurrent writes per second with single-digit microsecond latency, the concurrent skip list is hard to beat. Pebble's `arenaskl` is ~600 lines of careful Go.

---

## Appendix Q: Why Bw-trees exist

The Bw-tree (Microsoft Research, 2013) addresses two limitations of latch-based B-trees:

1. **Latch contention.** Even fine-grained latches become bottlenecks at high concurrency.
2. **In-place updates.** They invalidate CPU caches across cores and stress flash storage.

The Bw-tree's innovations:

- **Mapping table.** Node IDs map to memory pointers. Updates change the table entry via CAS, not the node itself.
- **Delta chains.** Updates append a delta record describing the change. A reader walks the delta chain plus base node.
- **Consolidation.** Periodically, delta chains are folded into a fresh base node (via CAS on the mapping table).
- **Epoch reclamation.** Old base nodes and delta records are freed only when no thread can see them.

The result: lock-free reads, lock-free writes, no in-place mutation. Excellent for flash (no in-place writes) and high concurrency (no contention).

The cost: complexity. The original Bw-tree paper is ~14 pages and references several follow-up papers for completeness. Implementations are sparse (Microsoft Hekaton, OpenBwTree research code).

In Go, the GC subsumes epoch reclamation, simplifying things significantly. But the mapping table + delta chain protocol is still ~5000 lines of careful code. Worth attempting only if you genuinely need the properties.

Professional file covers Bw-trees in implementation depth.

---

## Appendix R: A profile-then-decide framework

When asked to "make the concurrent tree faster," follow this framework:

1. **Profile**. Use `runtime/pprof` to find the actual bottleneck. Is it the mutex? Allocation? Tree traversal? Often it is none of these — it is the work *outside* the tree.

2. **Measure** the existing throughput, scaling curve, and tail latency. Plot throughput vs cores; if flat, you have a serial bottleneck.

3. **Hypothesize** what would help. "Reads are bottlenecked on mutex contention." "Writes are bottlenecked on allocation."

4. **Try the simplest fix**. If reads contend, switch from `Mutex` to `RWMutex`. If still contented, switch to COW publish/subscribe. If still contended, shard.

5. **Re-measure**. Verify the fix actually helped. Often it does not — you fixed something that was not the bottleneck.

6. **Repeat**. Each fix shifts the bottleneck. Iterate until the throughput meets the requirement.

This is the difference between an engineer who knows what protocols exist (junior / middle) and one who can apply them correctly (senior).

---

## Appendix S: A list of senior-level interview prompts

Practice articulating answers to these:

1. Design an in-memory concurrent ordered key-value store for a global-scale service with 10M reads/sec and 100k writes/sec. What protocol, what library, what trade-offs?

2. Compare PostgreSQL's B-link tree to Pebble's LSM. When would you choose which?

3. Explain MVCC garbage collection. What goes wrong if it stops?

4. A reader holds a snapshot forever. What happens? How would you bound this?

5. Walk through the Lehman-Yao split protocol, step by step, identifying every atomic operation.

6. Design an ordered concurrent tree for a 1B-entry workload in 64 GB of RAM. How do you stay under the budget?

7. Explain why a single Mutex around a B-tree might outperform a fine-grained latching version for a small tree.

8. When would you use ART instead of a B-tree?

9. Explain the role of hazard pointers vs epoch reclamation.

10. Design an order book for a 100k-orders-per-second trading system. Outline the data structures, locks, and snapshot strategy.

For each, articulate your assumptions, the protocol, the bottleneck, and the failure modes. A senior interview is not about the right answer — it is about reasoning through the trade-offs.

---

## Appendix T: A concluding pep talk

You have read several thousand lines of concurrency theory and implementation. The temptation now is to reach for the most sophisticated technique on every problem. Resist.

The senior engineer's job is to:

1. Identify the simplest pattern that meets the requirement.
2. Implement it carefully.
3. Measure.
4. Only then graduate to more sophisticated patterns, with evidence.

In Go, the simplest patterns — single mutex, publish/subscribe COW — handle the vast majority of workloads. Hand-over-hand, OCC, B-link, MVCC, Bw-trees, ART — these are real tools, but they earn their place in a system through measurement and necessity, not enthusiasm.

The senior file's goal was to make you fluent in the vocabulary of concurrent trees so you can converse with database engineers, read PostgreSQL source, and architect systems with confidence. The professional file goes further into research-grade territory: Bw-trees, concurrent ART, hardware transactional memory, in-memory database engines.

When you can read PostgreSQL's `nbtree.c` for fun and disagree with one of its choices on principled grounds, you are senior. Carry that forward.

---

## Appendix U: A list of related Go libraries

For reference:

- `github.com/google/btree` — single-threaded with clone-based COW.
- `github.com/tidwall/btree` — single-threaded with refcount-based COW, plus Hint API.
- `go.etcd.io/bbolt` — on-disk MVCC B+-tree.
- `github.com/dgraph-io/badger` — LSM-tree-based KV store.
- `github.com/cockroachdb/pebble` — LSM-tree-based KV store (CockroachDB's engine).
- `github.com/petar/GoLLRB` — single-threaded LLRB tree.
- `github.com/derekparker/trie` — string trie.
- `github.com/plar/go-adaptive-radix-tree` — single-threaded ART.
- `github.com/cespare/swisstable` — Swiss-table hash map.

In aggregate, these libraries cover ordered, unordered, in-memory, on-disk, persistent, single-writer, multi-writer. Knowing which fits your workload is more important than knowing the algorithm.

---

## Appendix V: A long set of self-study exercises

For senior-level mastery, do at least five of these:

1. Implement a Lehman-Yao B-link tree in Go. Stress-test it.
2. Implement MVCC with snapshot isolation on top of a concurrent tree.
3. Read PostgreSQL's `src/backend/access/nbtree/README` and rewrite it in your own words.
4. Read bbolt's `bucket.go` and `tx.go` and explain the lifecycle of a write transaction in your own words.
5. Build the order book from Appendix H. Profile it on real hardware.
6. Implement a HAMT in Go. Compare its throughput against `sync.Map`.
7. Implement a concurrent ART. Compare its throughput against `tidwall/btree`.
8. Implement an epoch reclaimer in Go. Use it for an `unsafe.Pointer`-based lock-free queue.
9. Compare the publish/subscribe COW pattern to hand-over-hand on a write-heavy workload.
10. Design (without coding) a Bw-tree variant suited to Go. Identify what Go's GC simplifies.

Each exercise produces real understanding. Reading without coding produces vocabulary, not skill.

---

## Appendix W: Closing the senior file

The senior file equipped you to:

- Architect any concurrent ordered store in Go.
- Read the source of any production B-tree library.
- Choose between protocols with reasoning.
- Implement Lehman-Yao, OCC, and COW correctly.
- Reason about MVCC snapshot isolation.
- Recognize when Go's GC saves you the trouble of epoch reclamation.

Take a break, build one of the exercises end-to-end, and read PostgreSQL's nbtree source.

The professional file awaits: Bw-trees, concurrent ART, hardware transactional memory, Hekaton internals, and a comparative tour of every major database engine's index structure.

---

## Appendix X: A deep look at MVCC visibility rules

MVCC's correctness hinges on the visibility predicate: given a reader's transaction ID `R` and a version with `XMin` and `XMax`, when is the version visible?

The classic rule for snapshot isolation:

```
visible(R, v) =
    v.XMin <= R                             // version was created before our snapshot
    AND v.XMin is committed                 // version's creator committed
    AND (v.XMax == 0 OR v.XMax > R          // either not deleted, or deleted after our snapshot
         OR v.XMax is not committed)        // OR deletion has not committed yet
```

There are subtle cases:

- **In-flight transactions**: A version created by a transaction still in flight is *not* visible to other readers. The version is invisible until the creating transaction commits.
- **Aborted transactions**: A version whose creator aborted is invisible forever; treat as if never created.
- **Read-your-own-writes**: Within transaction `T`, `T`'s own writes are visible to its own reads, even if `T` has not committed.
- **Range writes**: A delete-range operation creates per-row tombstones. Each tombstone has its own `XMax`.

A correct MVCC implementation maintains a **commit log** or **transaction status table** that records `(txID, status)` for each transaction. The visibility predicate consults this table.

In PostgreSQL, this is the `pg_xact` (transaction status) directory. In MySQL InnoDB, it is the rollback segment's `trx_id` info.

### Garbage collection horizon

A version `v` is safe to discard when:

- `v.XMax != 0 AND v.XMax is committed AND v.XMax < oldestActiveSnapshot`

That is, the version has been deleted by a committed transaction, and no active reader's snapshot can see it.

The trickiest part of MVCC is computing `oldestActiveSnapshot` correctly. A long-running read transaction prevents GC of any version it might see. This is why long-running reports are dangerous in OLTP systems — they bloat the version chain.

In production, this is monitored carefully. PostgreSQL's `pg_stat_activity` shows the oldest transaction; CockroachDB monitors GC TTL.

### Implementing in Go

A skeleton:

```go
type TxStatus int

const (
    InProgress TxStatus = iota
    Committed
    Aborted
)

type TxTable struct {
    mu     sync.RWMutex
    status map[int64]TxStatus
}

func (t *TxTable) Get(txID int64) TxStatus {
    t.mu.RLock()
    defer t.mu.RUnlock()
    return t.status[txID]
}

type Version struct {
    Value string
    XMin  int64
    XMax  int64
    Next  *Version
}

func visible(reader int64, v *Version, table *TxTable) bool {
    if v.XMin > reader {
        return false
    }
    if table.Get(v.XMin) != Committed {
        return false
    }
    if v.XMax != 0 && table.Get(v.XMax) == Committed && v.XMax <= reader {
        return false
    }
    return true
}
```

This is the kernel of every MVCC implementation. The complexity comes from making the `TxTable` fast (it is consulted on every read), making GC efficient, and handling distributed transactions across many nodes.

For pure in-memory single-node Go, the skeleton above is sufficient. Real systems add WAL, distributed commit protocols, and aggressive caching.

---

## Appendix Y: A view of the world from each library

To consolidate, here is how each library answers "what protocol do I run?":

### `google/btree`

- Single-threaded by contract.
- Caller wraps with `sync.Mutex` or `sync.RWMutex`.
- `Clone()` is `O(1)` copy-on-write with refcount on each node.
- Subsequent writes path-copy shared nodes.
- GC handles reclamation.

### `tidwall/btree`

- Single-threaded by contract.
- Caller wraps with `sync.Mutex` or `sync.RWMutex`.
- `Copy()` is `O(1)` refcount bump on root.
- `Hint` API for nearby-access fast path.
- GC handles reclamation.

### `bbolt`

- Single-writer per database.
- Multiple readers see consistent snapshots.
- Page-level COW with mmap.
- Manual epoch reclamation via transaction IDs.
- WAL via the `data` file's freelist.

### `BadgerDB`

- LSM-tree-based KV store.
- Memtable is a skip list (concurrent reads, single writer).
- SSTables are immutable.
- MVCC keys (`userKey | timestamp`).
- Background compaction.

### `Pebble`

- LSM-tree-based KV store.
- Memtable is a *concurrent* skip list (arena-allocated).
- Range deletes encoded as tombstones.
- MVCC keys.
- Background compaction.

### Hypothetical pure-Go Lehman-Yao B-link tree

- Per-node `sync.RWMutex`.
- Right-sibling pointers.
- Optionally version-counter OCC for reads.
- GC handles reclamation.

Each library makes a coherent set of trade-offs. Reading their READMEs and source is the fastest way to internalize the design space.

---

## Appendix Z: A scaling reference

For a back-of-envelope sense of what each protocol can do, on 2026-era 16-core hardware:

| Protocol | Reads/sec | Writes/sec | P99 read latency |
|----------|-----------|------------|------------------|
| `Mutex` | 5M-10M | 0.5M-1M | 10 μs |
| `RWMutex` | 20M+ (read-only) | 0.5M-1M | 5 μs (idle), 100 μs (with writers) |
| Sharded `Mutex` | 50M+ | 5M+ | 5 μs |
| COW publish/subscribe | 100M+ | 100k-500k | 1 μs |
| Lehman-Yao B-link | 50M | 5M | 5 μs |
| OLFIT B-tree | 100M+ | 5M+ | 1 μs |
| Bw-tree | 100M+ | 10M+ | 1 μs |

Numbers are rough and workload-dependent. The point: COW publish/subscribe gets you within striking distance of the most exotic protocols for reads, at a fraction of the implementation complexity.

---

## Appendix AA: Engineering culture around concurrency

A few cultural observations from teams that ship concurrent trees well:

- **Pair programming or buddy reviews for any change to lock protocols.** Single-developer changes to concurrency primitives are often subtly wrong.
- **Mandatory `-race` in CI.** No exception.
- **Stress-test before merge.** Every change goes through hours of randomized load before reaching main.
- **Invariant checkers**. Code paths that assert tree invariants after each operation, enabled under a build tag for tests.
- **Public design docs.** Every non-trivial concurrency change has a one-page design doc explaining the protocol and its proof sketch.
- **A culture of measuring.** "Faster" requires benchmark evidence, not vibes.

Teams that skip these ship subtle bugs that take months to detect. Teams that follow them ship reliable systems.

---

## Appendix AB: Closing closing

You have all the building blocks. From here it is practice and judgment. Build something, profile it, change it, measure it again. Read source code. Read papers. Talk to other engineers.

The senior level is not a destination but a posture: every problem starts with "what is the simplest thing that could work?" and ends with "I have measurements proving this is right."

Onward to professional, where we look at the most sophisticated tree implementations in production.

---

## Appendix AC: A walkthrough of `bbolt`'s `node.split` in Go

`bbolt`'s `node` type represents an in-memory B+-tree node. Reading the `split` function shows how a real production splitter works.

The relevant code (simplified):

```go
// split breaks up a node into multiple smaller nodes, if appropriate.
// This should only be called from the spill() function.
func (n *node) split(pageSize uintptr) []*node {
    var nodes []*node

    node := n
    for {
        a, b := node.splitTwo(pageSize)
        nodes = append(nodes, a)

        if b == nil {
            break
        }
        node = b
    }
    return nodes
}

// splitTwo breaks up a node into two smaller nodes, if appropriate.
// Returns the original node and a new right node.
func (n *node) splitTwo(pageSize uintptr) (*node, *node) {
    // Ignore the split if the page doesn't have at least enough nodes for
    // two pages or if the nodes can fit in a single page.
    if len(n.inodes) <= (minKeysPerPage*2) || n.sizeLessThan(pageSize) {
        return n, nil
    }

    fillPercent := n.bucket.FillPercent
    if fillPercent < minFillPercent {
        fillPercent = minFillPercent
    } else if fillPercent > maxFillPercent {
        fillPercent = maxFillPercent
    }
    threshold := int(float64(pageSize) * fillPercent)

    splitIndex, _ := n.splitIndex(threshold)

    var next *node
    if n.parent == nil {
        next = &node{bucket: n.bucket, isLeaf: n.isLeaf}
        n.parent = &node{bucket: n.bucket, children: []*node{n, next}}
        // Update parent pointer.
        ...
    } else {
        next = &node{bucket: n.bucket, isLeaf: n.isLeaf, parent: n.parent}
        n.parent.children = append(n.parent.children, next)
    }

    // Split inodes across two nodes.
    next.inodes = n.inodes[splitIndex:]
    n.inodes = n.inodes[:splitIndex]

    n.bucket.tx.stats.Split++
    return n, next
}
```

What is happening:

- A `node` is the in-memory representation of a B+-tree node.
- `splitTwo` checks if the node is large enough to split (heuristic: minKeysPerPage*2 entries, or size exceeds threshold).
- The split index is chosen so that both halves fit in a page after split.
- The right half (`next`) is created with the upper-half items.
- The parent is updated to point to `next`.

This is the in-memory part of the split. The actual page allocation happens at commit time:

```go
// spill writes the nodes to dirty pages and splits nodes as it goes.
// Returns an error if dirty pages cannot be allocated.
func (n *node) spill() error {
    var tx = n.bucket.tx
    if n.spilled {
        return nil
    }

    // Spill child nodes first. Child nodes can materialize sibling nodes in
    // the case of split-merge so we cannot use a range loop.
    sort.Sort(n.children)
    for i := 0; i < len(n.children); i++ {
        if err := n.children[i].spill(); err != nil {
            return err
        }
    }

    // We no longer need the child list because it's only used for spill tracking.
    n.children = nil

    // Split nodes into appropriate sizes. The first node will always be n.
    var nodes = n.split(uintptr(tx.db.pageSize))
    for _, node := range nodes {
        // Add node's page to the freelist if it's not new.
        if node.pgid > 0 {
            tx.db.freelist.free(tx.meta.txid, tx.page(node.pgid))
            node.pgid = 0
        }

        // Allocate contiguous space for the node.
        p, err := tx.allocate((node.size() + tx.db.pageSize - 1) / tx.db.pageSize)
        if err != nil {
            return err
        }

        node.pgid = p.id
        node.write(p)
        node.spilled = true

        // Insert into parent inodes.
        if node.parent != nil {
            ...
        }

        tx.stats.Spill++
    }
    ...
}
```

The `spill` function:

- Walks children first.
- Splits the node into pieces that each fit in a page.
- Frees the old page (the new pages will hold the new content).
- Allocates new pages from the free list.
- Writes the page content.

A page is freed only at the next `Commit` when no read transaction can see it.

This is a single-writer B+-tree with copy-on-write at page granularity. It is the cleanest production embedded ordered store in Go and worth reading end-to-end.

---

## Appendix AD: A walk through `tidwall/btree`'s `Set` implementation

A simplified excerpt of `tidwall/btree.BTreeG.Set`:

```go
func (tr *BTreeG[T]) Set(item T) (T, bool) {
    if tr.root == nil {
        tr.root = tr.newNode(true)
        tr.root.items[0] = item
        tr.root.numItems = 1
        tr.count = 1
        return zero, false
    }
    tr.root = tr.cowLoad(tr.root)
    if tr.root.numItems == maxItems {
        // Root is full; need a new root above it.
        n := tr.newNode(false)
        n.children[0] = tr.root
        n.numItems = 0
        tr.splitChild(n, 0)
        tr.root = n
    }
    prev, replaced := tr.setNonFull(tr.root, item)
    if !replaced {
        tr.count++
    }
    return prev, replaced
}

func (tr *BTreeG[T]) cowLoad(n *node[T]) *node[T] {
    if atomic.LoadInt32(&n.shared) == 0 {
        return n
    }
    // Shared; clone.
    nn := tr.newNode(n.leaf)
    *nn = *n
    nn.items = append([]T{}, n.items[:n.numItems]...)
    if !n.leaf {
        nn.children = append([]*node[T]{}, n.children[:n.numItems+1]...)
    }
    nn.shared = 0
    return nn
}
```

Key observations:

- `cowLoad(n)` clones `n` if it is shared (refcount > 1), otherwise returns it.
- Each level of the descent calls `cowLoad`, ensuring no shared node is mutated in place.
- The clone is shallow plus copy-slice; references to children are shared until those children themselves are mutated.

This is the path-copying COW protocol with refcount-based laziness. It is `O(log n)` per write when the tree is shared with a snapshot, `O(log n)` regular cost when not shared.

Reading the source of `tidwall/btree` end-to-end (about 1500 lines) is one of the best uses of senior-level study time.

---

## Appendix AE: A meditation on memory ordering

Go's memory model guarantees:

- A `sync.Mutex.Unlock` happens-before the next `Lock`.
- `atomic.Store` happens-before the matching `atomic.Load`.
- `channel send` happens-before the matching `channel receive`.
- `WaitGroup.Wait` happens-after all `Done`s.

For concurrent trees, the practical implications:

- When you `atomic.Pointer.Store(&t.root, newRoot)`, any reader who subsequently `Load`s the root sees a fully constructed `newRoot`.
- When you publish a snapshot via `atomic.Pointer`, the readers do not see torn structures.
- When you `Mutex.Unlock`, any reader who subsequently `Lock`s sees the writes inside the critical section.

What is **not** guaranteed:

- Plain reads / writes of a shared variable are racy. The compiler may reorder them; the CPU may reorder them; readers may see torn values.
- A `Mutex.Lock` does *not* guarantee visibility of writes performed *outside* a critical section.

For concurrent trees, this means:

- Always use `atomic.Pointer` for the published root.
- Always use `sync.Mutex` (or `sync.RWMutex`) for any other shared mutation.
- Never mix atomic and non-atomic reads/writes on the same variable.

The `go test -race` flag catches violations. Run it religiously.

---

## Appendix AF: A long detailed example — a concurrent index for a metrics server

A realistic senior-level project: build the index for a metrics server that ingests millions of metrics per second and serves time-range queries.

Requirements:

- Ingest metrics keyed by `(name, labels, timestamp, value)`.
- Query "all metrics with name X and labels Y between time T1 and T2."
- Return results in `O(log n + k)` where k is the result count.
- Memory budget: 16 GB.
- Latency budget: P99 query under 10 ms.

Architecture:

1. **Per-series sharding.** Each series (name+labels) gets its own time-keyed tree.
2. **Series index.** A map from series key to its tree.
3. **Time tree.** Each series has a `tidwall/btree` of `(timestamp, value)`.
4. **Snapshot publication.** Writes publish a fresh snapshot every N seconds.
5. **TTL eviction.** Old metrics are evicted by a background goroutine.

Code skeleton:

```go
package metricindex

import (
    "sync"
    "sync/atomic"

    "github.com/tidwall/btree"
)

type Point struct {
    TS    int64
    Value float64
}

func less(a, b Point) bool { return a.TS < b.TS }

type Series struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Point]
    snapshot atomic.Pointer[btree.BTreeG[Point]]
}

func newSeries() *Series {
    s := &Series{live: btree.NewBTreeG[Point](less)}
    s.snapshot.Store(s.live.Copy())
    return s
}

type Index struct {
    mu     sync.RWMutex
    series map[string]*Series
}

func New() *Index {
    return &Index{series: make(map[string]*Series)}
}

func (i *Index) seriesFor(key string) *Series {
    i.mu.RLock()
    s, ok := i.series[key]
    i.mu.RUnlock()
    if ok {
        return s
    }
    i.mu.Lock()
    s, ok = i.series[key]
    if !ok {
        s = newSeries()
        i.series[key] = s
    }
    i.mu.Unlock()
    return s
}

func (i *Index) Ingest(seriesKey string, ts int64, value float64) {
    s := i.seriesFor(seriesKey)
    s.mu.Lock()
    defer s.mu.Unlock()
    s.live.Set(Point{TS: ts, Value: value})
    s.snapshot.Store(s.live.Copy())
}

func (i *Index) Query(seriesKey string, lo, hi int64) []Point {
    s := i.seriesFor(seriesKey)
    snap := s.snapshot.Load()
    var out []Point
    snap.Ascend(Point{TS: lo}, func(p Point) bool {
        if p.TS >= hi {
            return false
        }
        out = append(out, p)
        return true
    })
    return out
}

func (i *Index) EvictOlderThan(cutoff int64) (deleted int) {
    i.mu.RLock()
    series := make([]*Series, 0, len(i.series))
    for _, s := range i.series {
        series = append(series, s)
    }
    i.mu.RUnlock()
    for _, s := range series {
        s.mu.Lock()
        var toDelete []Point
        s.live.Ascend(Point{TS: 0}, func(p Point) bool {
            if p.TS >= cutoff {
                return false
            }
            toDelete = append(toDelete, p)
            return true
        })
        for _, p := range toDelete {
            s.live.Delete(p)
        }
        if len(toDelete) > 0 {
            s.snapshot.Store(s.live.Copy())
            deleted += len(toDelete)
        }
        s.mu.Unlock()
    }
    return
}
```

Sized for the requirements:

- Per-series mutex avoids cross-series write contention.
- Per-series snapshot enables lock-free range queries.
- Series index uses `RWMutex` (we expect rare new-series creation, frequent lookup).
- Eviction takes per-series locks briefly.

Throughput on 16-core hardware: ~5M ingests/sec across all series, hundreds of millions of queries/sec. Memory: linear in the number of metrics (each Point is 16 bytes, so 1B metrics = 16 GB). The architecture trivially fits.

This is the shape of real Prometheus / InfluxDB / VictoriaMetrics indexes. The details differ (they use specialized in-memory layouts), but the architectural shape is identical.

---

## Appendix AG: Final summary and roadmap

You can now:

- Architect a concurrent ordered store from first principles.
- Implement Lehman-Yao, OCC, COW, hand-over-hand, B-link.
- Layer MVCC on top of any concurrent tree.
- Read and critique any production B-tree library.
- Reason about RCU, epoch reclamation, and Go's GC.

You should:

- Build the metrics server from Appendix AF.
- Read PostgreSQL nbtree source.
- Read bbolt source.
- Read Pebble's memtable source.
- Implement Lehman-Yao from scratch and stress-test it.

You should not:

- Implement a Bw-tree unless you genuinely need its properties.
- Reach for hand-over-hand without profile evidence.
- Use OCC without B-link on a B-tree.
- Skip MVCC GC monitoring in any production system.
- Build a custom tree when a library will do.

The professional file goes into Bw-trees, concurrent ART, hardware transactional memory, Hekaton, SAP HANA, and the bleeding edge of in-memory database engine design. By then you will have the vocabulary to read it as commentary on choices, not as new material.

Welcome to senior-grade concurrent trees in Go.

---

## Appendix AH: A short critique of common Go idioms

A few common Go patterns that interact badly with concurrent trees:

- **`defer mu.Unlock()` in a tight loop.** `defer` costs ~30 ns; in a hot loop that contains 100k iterations, you pay 3 ms. Profile and consider explicit Unlock if the loop body is small.
- **`sync.Map` for ordered data.** No. `sync.Map` has no ordering. Use a tree.
- **`for k, v := range m` for "the smallest key."** Wrong; `range` is unordered. Use a tree.
- **`channel`-based serialization for trees.** Often unnecessary. A `sync.Mutex` is faster than channel handoff. Use channels for coordination, not for serializing data structure access.
- **`atomic.Value` for the snapshot.** `atomic.Value` predates `atomic.Pointer[T]`. Prefer the latter (typed, faster).
- **`sync.Pool` for tree nodes in a COW tree.** Dangerous unless you can prove no concurrent reader holds the pooled node. Usually not worth the risk.

These are micro-optimizations but matter at scale.

---

## Appendix AI: Senior-level closing

The senior level is a long road. You started junior with "use one mutex." You now know dozens of protocols, when to apply them, and how to read the source of any concurrent tree library.

The trick is to keep that knowledge in your back pocket and *not* deploy it eagerly. The first tool is still the right one in most situations. The advanced tools earn their place through evidence, not enthusiasm.

When you reach for the right tool for the right job, with measurement to back it up, you are senior.

Go forth and build.

---

## Appendix AJ: An extended look at how PostgreSQL implements B-link

PostgreSQL's `nbtree` is the canonical production B-link implementation. Reading its key data structures clarifies the protocol.

A `BTPageOpaque` is the per-page metadata at the end of every B-tree page:

```c
typedef struct BTPageOpaqueData {
    BlockNumber btpo_prev;       /* left sibling, or P_NONE if leftmost */
    BlockNumber btpo_next;       /* right sibling, or P_NONE if rightmost */
    uint32      btpo_level;      /* tree level; 0 = leaf */
    uint16      btpo_flags;      /* flags */
    BTCycleId   btpo_cycleid;    /* vacuum cycle ID of latest split */
} BTPageOpaqueData;
```

Each page has a **left sibling** and **right sibling** pointer. Yes, left as well as right — this enables the doubly-linked leaf level for backward range scans. The B-link protocol only requires right siblings; PostgreSQL adds left siblings as a leaf-level optimization.

The flags include `BTP_DELETED`, `BTP_HALF_DEAD`, `BTP_LEAF`, `BTP_ROOT`, `BTP_INCOMPLETE_SPLIT`. The `BTP_INCOMPLETE_SPLIT` flag is set on a parent if its child's split is in progress; this lets a recovering process repair an incomplete split after a crash.

The page format itself:

```
+----------------+
| PageHeaderData |  (24 bytes)
+----------------+
| ItemIdData[]   |  (4 bytes each)
+----------------+
|                |
|  free space    |
|                |
+----------------+
| Items          |  (variable, growing upward)
+----------------+
| BTPageOpaque   |  (16 bytes)
+----------------+
```

`ItemIdData` is a (offset, length) pointer; items are stored in reverse-key order so the smallest keys are at the bottom and the rightmost (largest) at the top.

The high key is stored as the first item in the page (item 1). PostgreSQL inverts the typical layout: the special "high key" is just the first item, and routing entries follow. This is an optimization to avoid a separate field.

The **page split protocol** in PostgreSQL:

1. Acquire X-lock on the leaf to be split.
2. Choose a split point.
3. Allocate a new page (right sibling).
4. Copy upper half of items to the new page.
5. Update the new page's right-sibling to the old page's right-sibling.
6. Write WAL record. (PostgreSQL is durable; this is essential.)
7. Atomically update the old page: shorten items, set right-sibling to new page.
8. Release X-lock on old page.
9. Crab up to the parent and insert the (mid-key, new-page) entry.
10. If parent split, recurse.

The WAL is the durability anchor. After step 7, the new page is visible to in-flight readers via the right-sibling pointer; after step 9, the parent knows about it. Both states are recoverable from WAL after a crash.

### The "incomplete split" recovery

If PostgreSQL crashes between step 7 and step 9, the parent does not know about the new page, but the right-sibling pointer is set. On recovery, PostgreSQL detects this via the `BTP_INCOMPLETE_SPLIT` flag on the parent and completes the split.

This is the kind of detail that makes production B-trees genuinely hard. The protocol must handle:

- Concurrent readers.
- Concurrent writers.
- Crash recovery.
- WAL replay correctness.
- Locking deadlock prevention.

PostgreSQL's `nbtree` has been refined over 25+ years.

### `_bt_findinsertloc`: the leaf insert search

```c
/* Find the right leaf for inserting `itup` */
static OffsetNumber _bt_findinsertloc(Relation rel, BTInsertState insertstate, ...) {
    ...
    while (P_FIRSTDATAKEY(opaque) <= itemid && ...) {
        /* Walk right if current page's high key is less than target. */
        if (... high key < itup_key ...) {
            _bt_relbuf(...);
            buf = _bt_getbuf(... opaque->btpo_next ...);
            opaque = ...
            continue;
        }
        ...
    }
    ...
}
```

The pattern is identical to our Go pseudocode: walk right while the high key is less than the target. PostgreSQL adds many optimizations (skipping pages known to be full, MVCC visibility checks on tuples), but the structural pattern is Lehman-Yao.

If you read one file in the PostgreSQL source, read `src/backend/access/nbtree/README`. If you read a second, `nbtinsert.c`. The protocol becomes vivid.

---

## Appendix AK: The dual-tree pattern for write-heavy workloads

A pattern I have seen in several production systems: maintain **two trees** to absorb write churn.

```go
type DualStore struct {
    mu     sync.Mutex
    front  *btree.BTreeG[Item]
    back   *btree.BTreeG[Item]
    pub    atomic.Pointer[btree.BTreeG[Item]]
}

func (s *DualStore) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.back.Set(it)
}

func (s *DualStore) Get(k int) (Item, bool) {
    return s.pub.Load().Get(Item{Key: k})
}

func (s *DualStore) Publish() {
    s.mu.Lock()
    defer s.mu.Unlock()
    // Merge back into front.
    s.back.Ascend(Item{}, func(it Item) bool {
        s.front.Set(it)
        return true
    })
    s.back.Clear()
    s.pub.Store(s.front.Copy())
}
```

Writes accumulate in `back`; on `Publish`, they are folded into `front` and a snapshot is published. The dual-tree separates the "hot write side" from the "stable read side."

Variations:

- **LSM-like**: `back` flushes to disk; `front` lives in memory.
- **Buffered**: `back` is a `map[K]V` for `O(1)` writes; on flush it sorts and merges into `front`.
- **Aged**: `back` rotates to `front` every N seconds; old `front` becomes a snapshot.

The pattern shines when writes are bursty: 100k writes/sec for 1 second, then quiet for 10 seconds. The dual-tree absorbs the burst without snapshotting per-write.

---

## Appendix AL: Per-shard with cross-shard reads

A subtle architectural problem: per-shard sharding handles point access well, but cross-shard range queries are painful.

```go
type Sharded struct {
    shards [16]Shard
}

type Shard struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
}

// Range scan across all shards. Must visit every shard.
func (s *Sharded) RangeAll(lo, hi int, fn func(Item) bool) {
    snapshots := make([]*btree.BTreeG[Item], 16)
    for i := range s.shards {
        snapshots[i] = s.shards[i].snapshot.Load()
    }
    // Merge sort the 16 snapshots' iterators.
    ...
}
```

The merge-sort step is non-trivial. Use a heap-of-iterators:

```go
type cursor struct {
    iter *btree.IterG[Item]
    cur  Item
    ok   bool
}

type cursorHeap []*cursor

func (h cursorHeap) Len() int           { return len(h) }
func (h cursorHeap) Less(i, j int) bool { return less(h[i].cur, h[j].cur) }
func (h cursorHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *cursorHeap) Push(x any)        { *h = append(*h, x.(*cursor)) }
func (h *cursorHeap) Pop() any          { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

func (s *Sharded) RangeAll(lo, hi int, fn func(Item) bool) {
    var heap cursorHeap
    for i := range s.shards {
        it := s.shards[i].snapshot.Load().Iter()
        if ok := it.Seek(Item{Key: lo}); ok && it.Item().Key < hi {
            heap = append(heap, &cursor{iter: &it, cur: it.Item(), ok: true})
        }
    }
    heapInit(&heap)
    for len(heap) > 0 {
        top := heap[0]
        if !fn(top.cur) {
            break
        }
        if top.iter.Next() && top.iter.Item().Key < hi {
            top.cur = top.iter.Item()
            heapFix(&heap, 0)
        } else {
            heapPop(&heap)
        }
    }
}
```

Adding this complexity has a cost. If range queries are frequent, sharding may not be worth it. If range queries are rare, sharding is great.

The trade-off is fundamental: point access wants sharding; range access wants one tree.

---

## Appendix AM: Reader-side optimizations

A few tricks that apply only to readers:

- **Cache the snapshot pointer in goroutine-local state.** If a goroutine does 1000 reads, it can `Load` once and reuse.
- **Iterate with hints.** `tidwall/btree` supports `Hint`s that shortcut from a previous access path.
- **Materialize hot ranges.** If you query "all entries between T-1h and T" repeatedly, cache the result and invalidate on new writes.
- **Parallelize within a range scan.** Multiple goroutines can each take a sub-range and process in parallel.

All optimizations should be measured. None are obvious wins.

---

## Appendix AN: Concurrent read iterators

A subtle problem: how do you express "iterate a tree from goroutine A while goroutine B may insert"?

With a published snapshot, A iterates the snapshot. B writes to `live`. They are completely independent.

```go
snap := tr.snapshot.Load()
snap.Ascend(Item{Key: 0}, func(it Item) bool { ... })
```

The iterator holds a reference to the snapshot. As long as that reference exists, the snapshot is alive (GC will not collect it).

Compare to a `sync.RWMutex`-protected tree:

```go
tr.mu.RLock()
defer tr.mu.RUnlock()
tr.bt.Ascend(Item{Key: 0}, func(it Item) bool {
    ...
    // BAD: cannot mutate tr inside callback (deadlock)
    // BAD: writer is blocked until this returns
})
```

The COW approach is strictly better for iteration:

- The iterator runs as long as it likes.
- Writers proceed unimpeded.
- The iterator can do anything it wants in the callback (no re-entrancy concern).

This is why COW publish/subscribe wins for read-mostly workloads: it cleanly separates the read path from the write path.

---

## Appendix AO: Closing thoughts on the senior level

The senior level is about *judgment*. You know many protocols; the skill is choosing the right one. You know many libraries; the skill is choosing the right one. You know many trade-offs; the skill is articulating them and matching them to your workload.

When you can:

- Look at a profile and identify which protocol's bottleneck you are hitting.
- Read a B-tree library's source and explain its protocol.
- Justify the choice of `tidwall/btree` over `google/btree` (or vice versa) for a specific workload.
- Layer MVCC on a concurrent tree without bugs.
- Spot a Lehman-Yao split bug in code review.

…you are senior. The professional file completes the picture with the most advanced techniques in production: Bw-trees, concurrent ART, hardware transactional memory.

Until then: build, profile, build more.

---

## Appendix AP: A deep tour of `tidwall/btree.PathHint`

`tidwall/btree`'s `PathHint` is one of the most useful library features for senior-level engineers.

```go
type PathHint struct {
    used [8]bool
    path [8]uint8
}
```

A hint stores the indices used at each level of a previous tree access. The next access can "shortcut" by checking the hinted indices first. If they match, the lookup descends in `O(1)` per level instead of `O(log fanout)`.

Use case: a workload that repeatedly accesses consecutive keys.

```go
var hint btree.PathHint
for i := 0; i < 1_000_000; i++ {
    tr.SetHint(Item{Key: i, Value: i}, &hint)
}
```

The hint adapts: it remembers the path of the previous insert, and the next insert (which is one greater) finds the same path. This makes bulk-sorted-insert dramatically faster than random insert.

Similarly for `GetHint`:

```go
var hint btree.PathHint
for i := 0; i < 1_000_000; i++ {
    val, _ := tr.GetHint(Item{Key: i}, &hint)
    ...
}
```

A 10-20x speedup is typical for sorted access patterns.

The hint is also useful in cursor scans: each iteration's hint helps the next iteration find its starting point quickly.

The downside: hints are per-goroutine. They are not safe to share across goroutines. Treat them like a local variable.

For range scans that produce results in order, a `tidwall/btree.IterG` is even better — it explicitly maintains the descent path and advances in `O(1)` amortized.

---

## Appendix AQ: When sharding gets messy

A war story: a team built a sharded ordered store ("16 shards, hashed by user ID"). Throughput was great. Then they needed to add "show me all users created in the last hour."

The hash sharding meant users created in the last hour were spread across all 16 shards uniformly. The query had to fan out to all 16 and merge.

Fine. But then they added "for each of these recent users, show their last 10 events." Each user's events were also sharded by user ID into the same 16 shards. So the query became: 16 fan-outs to find recent users, then for each user, a single shard lookup. Net: 16x the work plus user-shard lookups.

The fix: **change the sharding key**. They added a *secondary index*, a separate sharded tree keyed by `(createdAt, userID)`, with the same 16 shards. Now "users created in the last hour" was answered by a range scan within each shard of the secondary index, returning ordered results.

The lesson: sharding's "what is the right shard key?" question is much harder than "should I shard at all?" If you ever need ordered queries across the keyspace, hash sharding will burn you.

Alternative: **range sharding**. Shard by key range, not hash. Keys 0..1M in shard 0, 1M..2M in shard 1, etc. Range queries within the keyspace touch only one or two shards. Point access is still `O(1)` after the range lookup.

Range sharding has its own problems (hotspots if writes concentrate on one range). Hybrid approaches (CockroachDB's range sharding with auto-splitting) try to get the best of both.

This is senior-level system design: choosing the *right* concurrency strategy for the workload's actual query patterns.

---

## Appendix AR: A note on Go's `runtime/trace` for concurrency debugging

`pprof` shows you where CPU and memory time goes. `runtime/trace` shows you *when* and *why* — goroutine scheduling, blocking, GC, syscalls.

For concurrent tree debugging:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()

// run your workload
```

Then `go tool trace trace.out`. You see a timeline of every goroutine, every blocking event, every GC pause. If a goroutine is blocked on `sync.Mutex.Lock`, you see exactly when and for how long. If GC is dominating, you see the STW pauses.

For tree concurrency tuning, `runtime/trace` is invaluable. Use it to confirm hypotheses about contention before reaching for fine-grained protocols.

---

## Appendix AS: A final list of references

Read at least three of these in full:

- Lehman, Yao (1981), *Efficient Locking for Concurrent Operations on B-Trees*. The foundation. ~10 pages.
- Cha, Hwang et al. (2001), *OLFIT*. The optimistic latch-free protocol. ~15 pages.
- Mao, Kohler, Morris (2012), *Cache Craftiness for Fast Multicore Key-Value Storage* (MassTree). ~14 pages.
- Levandoski, Lomet, Sengupta (2013), *The Bw-Tree*. ~14 pages, but you may need to read it twice.
- Leis, Kemper, Neumann (2013), *The Adaptive Radix Tree (ART)*. ~12 pages.
- McKenney (2017), *Is Parallel Programming Hard?* — RCU and more. Free PDF.
- Stonebraker et al. (2007), *The End of an Architectural Era* — the case for in-memory column stores.
- Goetz Graefe (2010), *A Survey of B-Tree Locking Techniques*. A comprehensive review.
- The CockroachDB blog posts on Pebble — engineering details of a Go LSM-tree.
- The PostgreSQL source tree's `nbtree/README` and related comments.

Reading the original sources directly is the difference between knowing names and knowing techniques.

---

## Appendix AT: A senior interview preparation guide

If you are interviewing for a senior role that involves concurrent data structures:

1. Be ready to walk through publish/subscribe COW on a whiteboard.
2. Be ready to explain Lehman-Yao's right-sibling pointer in one minute.
3. Be ready to design an order book or metrics index in 15 minutes.
4. Know the names and approximate trade-offs of `tidwall/btree`, `google/btree`, `bbolt`, `Pebble`, `BadgerDB`.
5. Be honest about the limits of your knowledge. "I have not implemented a Bw-tree but I have read the paper and could describe its delta-chain mechanism."
6. Bring up profiling. Senior interviewers want to know you measure before you optimize.

A typical interview prompt: "Design an in-memory time-series index." Your answer should:

- Identify the access patterns (heavy ingest, occasional range query, periodic eviction).
- Pick an architecture (per-series sharding + publish/subscribe COW).
- Discuss trade-offs (memory, GC, scaling, multi-series queries).
- Hand-wave the implementation but cite specific Go primitives (`tidwall/btree`, `atomic.Pointer`, `sync.Mutex`).

You do not need to remember every detail. Show that you can reason in this design space.

---

## Appendix AU: Truly closing the senior file

This has been a long file. Let's land:

**The senior level is not a level you reach by reading.** It is a level you reach by reading, building, profiling, redesigning, and reading the source of real systems repeatedly.

The single most useful exercise: take an existing simple wrapper around `tidwall/btree` (something like the metrics server in Appendix AF) and stress-test it on real hardware. Find the bottleneck. Fix it. Find the next one. Repeat. After three or four iterations, you will have a deep intuition for which protocol matters for which workload — an intuition no amount of reading can confer.

The professional file follows. It treats Bw-trees, concurrent ART, hardware transactional memory, and the inside of Hekaton-class systems. It is for those who design or maintain database engines.

When you arrive there, the language will be familiar; the techniques will be variations on themes you already know. You will be ready.

---

## Appendix AV: A close look at hand-coded latch upgrades

In some protocols, a reader needs to "upgrade" from a shared latch to an exclusive latch — e.g., it spotted a deletion candidate while scanning and wants to delete in place.

Go's `sync.RWMutex` does not support direct upgrade. You must:

1. Release the read lock.
2. Acquire the write lock.
3. Re-verify the precondition (someone else may have changed state).

```go
func (t *Tree) DeleteCandidate(key int) {
    t.mu.RLock()
    item, ok := t.bt.Get(Item{Key: key})
    if !ok || !item.shouldDelete() {
        t.mu.RUnlock()
        return
    }
    t.mu.RUnlock()
    t.mu.Lock()
    defer t.mu.Unlock()
    // Re-verify: maybe someone deleted/modified in between
    cur, ok := t.bt.Get(Item{Key: key})
    if !ok || !cur.shouldDelete() {
        return
    }
    t.bt.Delete(Item{Key: key})
}
```

The pattern: "look, then look-again-with-write-lock." It is mandatory whenever the upgrade is not atomic.

In the COW publish/subscribe pattern, this is much cleaner:

```go
func (t *Store) DeleteCandidate(key int) {
    snap := t.snapshot.Load()
    item, ok := snap.Get(Item{Key: key})
    if !ok || !item.shouldDelete() {
        return
    }
    t.mu.Lock()
    defer t.mu.Unlock()
    cur, ok := t.live.Get(Item{Key: key})
    if !ok || !cur.shouldDelete() {
        return
    }
    t.live.Delete(Item{Key: key})
    t.snapshot.Store(t.live.Copy())
}
```

The first check is on the snapshot (lock-free). Only if the check passes do we acquire the write lock and verify again. This minimizes lock-holding time and removes the upgrade pattern.

This kind of optimization is everywhere in production code.

---

## Appendix AW: A field guide to errors I have seen

In production reviews of concurrent tree code, the most common errors:

1. **Forgotten Unlock on early return.** Especially common when adding error returns to existing methods.
2. **Iterator that takes the lock and never releases.** A callback raises an exception; defer is forgotten; lock leaks.
3. **Snapshot in a long-lived goroutine.** Memory grows.
4. **Mixed snapshot + live read in the same code path.** Inconsistency.
5. **Implicit assumption about iteration order.** "I assume Ascend is in insertion order" — no, it is in `Less` order.
6. **Mutating an item while in the tree.** The tree's invariants break silently.
7. **`Mutex` taken twice on the same goroutine.** Reentrant deadlock.
8. **Channels used to serialize tree access.** Slower than a mutex; harder to debug.
9. **Heap allocations in the hot path.** Each `Item` allocation triggers GC pressure under high QPS.
10. **Ignoring `go test -race` failures.** Always fix the race; never `nolint`.

Building a list like this for your own team is high-leverage.

---

## Appendix AX: Architectural sketch — geographic data

Suppose you need an in-memory ordered store for geographic point data: each entry has a (lat, lng) coordinate and a payload. Queries: "all points within this bounding box."

A naive B-tree of `(lat, lng)` does not work — bounding-box queries do not map to range queries.

Options:

1. **Geohash + B-tree.** Encode (lat, lng) into a geohash (Z-order curve). Adjacent geohashes correspond to nearby points (mostly). A bounding box becomes a small set of geohash ranges.
2. **R-tree.** A spatial tree that indexes bounding boxes. Range queries are native.
3. **kd-tree.** A binary tree alternating splits between dimensions.
4. **Quadtree.** A four-way split tree (each node has four children for NW/NE/SW/SE).

For concurrency in Go: COW publish/subscribe with a geohash + B-tree is the simplest. R-trees in Go exist (`github.com/dhconnelly/rtreego`) but are not concurrent.

This is an example where the right *data structure* matters more than the right *concurrency protocol*. Senior engineers know to ask "is the tree even the right shape for this query?" before asking about concurrency.

---

## Appendix AY: A summary of "what worked in production"

From my own observation:

- **Publish/subscribe COW.** Used in 60%+ of cases. The default.
- **Per-shard COW.** Used when throughput exceeds a single tree's capacity. ~20%.
- **`bbolt` for persistence.** Used in 10% of cases where on-disk MVCC is required.
- **`Pebble` for LSM.** Used in another 5%, mostly larger systems.
- **Custom hand-over-hand / OCC.** Almost never. Only when implementing a database engine.
- **Bw-tree / concurrent ART.** Never in pure Go production code I have seen. Only in C/C++ libraries called via cgo.

The clear winner for general-purpose Go: publish/subscribe COW with `tidwall/btree`. Master this pattern, and you will solve 60% of "I need a concurrent ordered map" problems in your career.

---

## Appendix AZ: Closing for real

You have read ~3500 lines of senior-level material. That is enough.

The professional file follows. It is for those who want or need to go deeper still — Bw-trees, concurrent ART, hardware transactional memory, the inside of Hekaton-class systems. If your career involves writing or maintaining database engines, you need it. If not, you do not.

Either way: thank you for reading. Now go build something.

---

## Appendix BA: A complete sharded MVCC store

Putting together everything from this file — sharding, COW publish/subscribe, MVCC version chains, snapshot isolation — here is a complete sharded MVCC store in Go. About 200 lines. This is roughly what a real production system looks like at this level.

```go
package shardedmvcc

import (
    "hash/maphash"
    "sync"
    "sync/atomic"

    "github.com/tidwall/btree"
)

const numShards = 16

type Version struct {
    Value []byte
    XMin  int64
    XMax  int64
    Next  *Version
}

type Row struct {
    Key      string
    mu       sync.Mutex
    Newest   *Version
}

func less(a, b *Row) bool { return a.Key < b.Key }

type shard struct {
    mu       sync.Mutex
    live     *btree.BTreeG[*Row]
    snapshot atomic.Pointer[btree.BTreeG[*Row]]
}

type Store struct {
    shards    [numShards]shard
    seed      maphash.Seed
    txCounter atomic.Int64
}

func New() *Store {
    s := &Store{seed: maphash.MakeSeed()}
    for i := range s.shards {
        s.shards[i].live = btree.NewBTreeG[*Row](less)
        s.shards[i].snapshot.Store(s.shards[i].live.Copy())
    }
    return s
}

func (s *Store) shardOf(key string) *shard {
    var h maphash.Hash
    h.SetSeed(s.seed)
    h.WriteString(key)
    return &s.shards[h.Sum64()%numShards]
}

func (s *Store) Begin() int64 {
    return s.txCounter.Add(1)
}

func (s *Store) Write(key string, value []byte, txID int64) {
    sh := s.shardOf(key)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    row, ok := sh.live.Get(&Row{Key: key})
    if !ok {
        row = &Row{Key: key}
        sh.live.Set(row)
    }
    row.mu.Lock()
    if row.Newest != nil {
        row.Newest.XMax = txID
    }
    row.Newest = &Version{Value: value, XMin: txID, Next: row.Newest}
    row.mu.Unlock()
    sh.snapshot.Store(sh.live.Copy())
}

func (s *Store) Read(key string, txID int64) ([]byte, bool) {
    sh := s.shardOf(key)
    snap := sh.snapshot.Load()
    row, ok := snap.Get(&Row{Key: key})
    if !ok {
        return nil, false
    }
    row.mu.Lock()
    defer row.mu.Unlock()
    for v := row.Newest; v != nil; v = v.Next {
        if v.XMin <= txID && (v.XMax == 0 || v.XMax > txID) {
            return v.Value, true
        }
    }
    return nil, false
}

// GC removes versions older than minActive across all shards.
func (s *Store) GC(minActive int64) (removed int) {
    for i := range s.shards {
        sh := &s.shards[i]
        sh.mu.Lock()
        sh.live.Scan(func(row *Row) bool {
            row.mu.Lock()
            for v := row.Newest; v != nil && v.Next != nil; v = v.Next {
                if v.Next.XMax != 0 && v.Next.XMax < minActive {
                    n := 0
                    for x := v.Next; x != nil; x = x.Next {
                        n++
                    }
                    v.Next = nil
                    removed += n
                    break
                }
            }
            row.mu.Unlock()
            return true
        })
        sh.mu.Unlock()
    }
    return
}

// RangeRead scans keys in a single shard's view (no cross-shard ordering).
// For a global ordered range scan, see RangeReadAll.
func (s *Store) RangeRead(lo, hi string, txID int64) []KV {
    // For a sharded store with hash-based sharding, a true cross-shard
    // range scan must visit every shard and merge-sort. This is a simplification:
    // we accept that the result is *unordered*, returning everything visible
    // at txID with key in [lo, hi).
    var out []KV
    for i := range s.shards {
        sh := &s.shards[i]
        snap := sh.snapshot.Load()
        snap.Ascend(&Row{Key: lo}, func(row *Row) bool {
            if row.Key >= hi {
                return false
            }
            row.mu.Lock()
            for v := row.Newest; v != nil; v = v.Next {
                if v.XMin <= txID && (v.XMax == 0 || v.XMax > txID) {
                    out = append(out, KV{Key: row.Key, Value: v.Value})
                    break
                }
            }
            row.mu.Unlock()
            return true
        })
    }
    return out
}

type KV struct {
    Key   string
    Value []byte
}
```

This 200-line file gives you:

- Sharded writes (16x scaling for hashable keys).
- Lock-free reads via shard snapshots.
- Per-key MVCC version chains.
- Snapshot isolation.
- Cross-shard (unordered) range queries.
- Garbage collection of dead versions.

It is incomplete in production-relevant ways (no WAL, no commit log, no conflict detection), but as an in-memory transactional store it is genuinely usable. Many real Go services run something close to this for their internal transactional state.

---

## Appendix BB: Final reading list for senior mastery

The minimum reading list to claim "senior at concurrent trees in Go":

1. The junior, middle, and senior files of this section.
2. The README of PostgreSQL `nbtree`.
3. The bbolt source (`bucket.go`, `node.go`, `tx.go`).
4. The `tidwall/btree` source.
5. The Lehman-Yao paper.
6. McKenney's RCU bible (chapters on read-side critical sections).
7. The Pebble memtable source (`internal/arenaskl/`).

Optional but recommended:

8. The OLFIT paper.
9. The MassTree paper.
10. The Bw-tree paper.
11. The ART paper.

If you read those, your mental model of concurrent ordered data structures will be richer than 99% of working Go engineers'. The professional file builds on that base.

---

## Appendix BC: A short story to close

In 2024, a senior engineer at a payments company spent six months designing a hand-over-hand concurrent B-tree from scratch to replace a single-mutex `map[string]Account`. The design was elegant, the code beautiful. After deployment, throughput improved by 8%.

Two months later, a different engineer profiled the system and discovered that 70% of CPU was being spent in JSON serialization, not the tree. Replacing the JSON encoder saved 50%. The fancy tree's contribution faded into the noise.

The moral: **profile first**. Senior engineers do not just know advanced techniques; they know when *not* to deploy them.

You are senior when you reach for the simplest solution that meets your measured needs, and when you accept that the most beautiful protocol in the world is irrelevant if it is not the bottleneck.

Carry that forward to the professional file. The advanced techniques exist; deploy them with discipline.

Now: build something. Profile it. Iterate.








