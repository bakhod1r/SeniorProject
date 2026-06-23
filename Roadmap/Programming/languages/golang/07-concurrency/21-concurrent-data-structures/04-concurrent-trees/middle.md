---
layout: default
title: Middle
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/middle/
---

# Concurrent Trees — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Hand-Over-Hand Locking (Lock Coupling)](#hand-over-hand-locking-lock-coupling)
6. [Optimistic Concurrency with Version Counters](#optimistic-concurrency-with-version-counters)
7. [Copy-On-Write Trees](#copy-on-write-trees)
8. [Sibling-Pointer (B-link) Sketch](#sibling-pointer-b-link-sketch)
9. [Working With `tidwall/btree` at Depth](#working-with-tidwallbtree-at-depth)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use](#product-use)
13. [Performance Tips](#performance-tips)
14. [Best Practices](#best-practices)
15. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Common Misconceptions](#common-misconceptions)
18. [Tricky Points](#tricky-points)
19. [Test](#test)
20. [Tricky Questions](#tricky-questions)
21. [Cheat Sheet](#cheat-sheet)
22. [Self-Assessment Checklist](#self-assessment-checklist)
23. [Summary](#summary)
24. [Further Reading](#further-reading)
25. [Related Topics](#related-topics)
26. [Diagrams](#diagrams)

---

## Introduction

> Focus: "I have a B-tree, I have hot writes, and one big mutex is killing me. What protocol do I actually run?"

At the junior level you wrapped `google/btree` in a single `sync.Mutex` (or `sync.RWMutex`) and shipped. That works for most services. But sometimes profiling shows that the mutex *is* your bottleneck: profiles point to `runtime.lock_*`, contention metrics climb under load, and adding cores makes things worse, not better. At that point you need *finer-grained* concurrency on the tree itself.

This file teaches four core techniques that, used alone or in combination, let many goroutines work on the same tree at the same time:

1. **Hand-over-hand locking (a.k.a. lock-coupling, latch-crabbing).** Each goroutine holds at most two node-level locks at a time as it walks the tree.
2. **Optimistic concurrency.** Readers traverse without taking any lock at all; they validate their reads against a per-node version counter and retry on conflict.
3. **Copy-on-write (COW).** Writers produce a brand-new tree by cloning only the path they touch; readers continue to see the immutable old tree.
4. **Sibling-pointer trees (B-link).** Each node has a pointer to its right sibling, so concurrent splits can be discovered without re-locking the parent.

You will also learn how `tidwall/btree`'s COW snapshot path is implemented internally — and how to exploit it for "publish/subscribe"–style read paths that never block writers.

This file is for engineers who already know:

- How to write a `sync.RWMutex`-protected `BTreeG`.
- What `sync/atomic` does, including `atomic.LoadUint64` / `atomic.CompareAndSwapPointer`.
- How `unsafe.Pointer` interacts with `atomic.LoadPointer` (briefly; you will not need to write any).
- Why Go's `sync` package locks are not reentrant.
- The Go memory model basics: a `sync.Mutex.Unlock` *happens-before* the next `Lock`.

If any of those is shaky, return to `junior.md` and to the chapters on `sync` and the memory model.

---

## Prerequisites

- **Required:** Comfortable with the [junior file](junior/).
- **Required:** Familiar with `sync.RWMutex`, `sync.Cond`, `sync/atomic`.
- **Required:** Read the Go memory model at `go.dev/ref/mem` once.
- **Helpful:** Have looked at the `google/btree` source — the data layout will help here.
- **Helpful:** Read the Lehman-Yao 1981 paper. It is ~10 pages and the foundation of much of this file.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Latch** | Database paper terminology for a short-lived, in-memory lock on a data structure node. Equivalent to "lock" in Go terminology. |
| **Lock-coupling / hand-over-hand / latch-crabbing** | A traversal protocol where each thread holds the parent lock until the child lock is acquired, then releases the parent. |
| **Optimistic concurrency control (OCC)** | Read without locking, then validate against a version counter. If invalid, retry. |
| **Version counter** | A monotonically increasing integer per node (or per tree) that increments on every write. Readers capture it before reading and check it after. |
| **OLFIT** | "Optimistic Latch-Free Index Traversal" — a 2001 paper combining version counters with no read latches at all. The intellectual ancestor of optimistic B-trees. |
| **B-link tree** | A B-tree variant from Lehman & Yao (1981) where every node has a "right sibling" pointer. Allows splits to be visible to other readers without re-latching the parent. |
| **Copy-on-write (COW)** | An update strategy where modifications produce new nodes instead of mutating existing ones. The unmodified portion of the tree is shared. |
| **Path copying** | The minimum COW: only the nodes on the root-to-leaf path of the update are cloned. The rest of the tree is shared. |
| **Persistent data structure** | A data structure that preserves previous versions when modified. COW trees are the standard implementation. |
| **MVCC** | Multi-version concurrency control. Each transaction sees a snapshot; writers create new versions. |
| **RCU** | Read-copy-update. Writers swap a pointer atomically; readers proceed without locks; old memory is freed only when all readers that could see it have finished. |
| **Latch grandfather** | The ancestor latch that you must hold until you are sure no split could propagate up to it. |
| **Crab walk** | Same as lock-coupling. |
| **Latch contention** | The wait time caused by goroutines competing for the same latch. |
| **Lock-free** | A protocol where at least one thread is guaranteed to make progress even if others stall. |
| **Wait-free** | Every thread completes in bounded steps. Strongest progress guarantee. |
| **Tree spine** | The path from root to leaf. |
| **Right sibling pointer** | A pointer from each node to its in-order successor at the same level. The key innovation of B-link trees. |
| **Highkey** | In B-link, the highest key reachable through this node; used by readers to detect that a split happened. |

---

## Core Concepts

### Why finer-grained locking pays off

A single `sync.RWMutex` on the entire tree serializes all writes and forces readers to wait for writers. Even if your workload is 99% reads, the 1% writes cause the readers to stall in bursts. On 64-core hardware doing 10k writes/sec, you can spend a meaningful fraction of cycles just in lock contention.

Fine-grained locking aims at one of two outcomes:

- **Concurrency at the protocol level.** Two writers in different parts of the tree never contend.
- **Readers do not block writers, and writers do not block readers.** Achieved via COW, RCU, or version-based optimism.

The cost is complexity. Every protocol below has subtle correctness arguments and tricky bug modes. You should reach for them in this order:

1. Single global lock (`Mutex` / `RWMutex`).
2. Sharded locks (one tree per shard).
3. Hand-over-hand locking (per-node locks, walk-coupled).
4. Copy-on-write with publish/subscribe.
5. Optimistic concurrency with version validation.
6. B-link tree with no parent re-latching.
7. RCU-based publish + epoch reclamation.

Pick the *first* one whose throughput numbers meet your needs. Each step up roughly doubles the implementation difficulty.

### A note on Go vs C

Most published B-tree concurrency papers are written for C or C++. They assume:

- Manual memory management (so freeing a node is a deliberate action).
- Pointer-sized atomic operations (`atomic_compare_exchange_strong`).
- No garbage collector that observes all reachable memory.

Go is different:

- The garbage collector observes pointers everywhere. This *simplifies* RCU: you do not need an epoch reclaimer; the GC is one. As long as the old root is not reachable, it gets collected.
- `atomic.Pointer[T]` (since Go 1.19) gives you typed atomic pointer operations.
- `sync.Mutex` is not reentrant; you must never call `Lock()` twice on the same goroutine.
- Goroutines are not preemptible at arbitrary points (until Go 1.14, when async preemption arrived). Long lock-holding without yielding can hurt the scheduler.

These differences make Go a *better* host language for the publish/subscribe and RCU-style approaches than C, and a *worse* one for the latch-busy approaches that depend on per-thread context (no thread-local storage in Go).

---

## Hand-Over-Hand Locking (Lock Coupling)

The first technique. The idea: each node has its own `sync.RWMutex`. To traverse, you `RLock(root)`, find the right child, `RLock(child)`, then `RUnlock(root)`. You hold at most two locks at a time, both as read locks. Writers do the same but acquire write locks instead.

### A minimal hand-over-hand BST (for clarity, not production)

A B-tree version is harder; let's start with a binary search tree.

```go
package hohbst

import "sync"

type Node struct {
    mu          sync.RWMutex
    key         int
    value       string
    left, right *Node
}

type Tree struct {
    rootMu sync.RWMutex
    root   *Node
}

func (t *Tree) Get(k int) (string, bool) {
    t.rootMu.RLock()
    n := t.root
    if n == nil {
        t.rootMu.RUnlock()
        return "", false
    }
    n.mu.RLock()
    t.rootMu.RUnlock()

    for n != nil {
        switch {
        case k < n.key:
            child := n.left
            if child == nil {
                n.mu.RUnlock()
                return "", false
            }
            child.mu.RLock()
            n.mu.RUnlock()
            n = child
        case k > n.key:
            child := n.right
            if child == nil {
                n.mu.RUnlock()
                return "", false
            }
            child.mu.RLock()
            n.mu.RUnlock()
            n = child
        default:
            v := n.value
            n.mu.RUnlock()
            return v, true
        }
    }
    return "", false
}
```

At every moment we hold either the root mutex or one node mutex; for the duration of the "step" we hold two. Other goroutines can be walking the same tree at completely different places.

### Hand-over-hand for writes is harder

Writes are harder because you have to anticipate splits / merges that might propagate upward. The pessimistic strategy is to walk down with *write* locks, releasing them only when you can prove the parent will not need to be modified. For a BST:

- Insert: if the leaf does not exist yet, you only need to lock the *parent* of the insertion point.
- Delete: you might need to walk back up to rebalance (in AVL or RB). That makes hand-over-hand for deletes in those trees genuinely complex.

For B-trees, the standard CLRS "preemptive split" trick fits hand-over-hand beautifully: as you walk down for an insert, *split any full node you encounter*. Then by the time you reach the leaf, the parent is guaranteed to have room, so you can release every ancestor.

Pseudocode:

```
Insert(key):
    Lock(root)
    if root is full:
        new = newNode()
        new.children[0] = root
        new.split(0)  // split root's child 0
        root = new
    node = root
    while node is not a leaf:
        i = find child index for key
        Lock(node.children[i])
        if node.children[i] is full:
            node.split(i)
            // Re-evaluate which child after split
            if key > node.keys[i]:
                Unlock(node.children[i])  // we'll re-lock the right half
                i++
                Lock(node.children[i])
        Unlock(node)  // safe: any future split inside the child stays inside the child
        node = node.children[i]
    // node is a leaf with room
    node.insertItem(key)
    Unlock(node)
```

The key invariant: by the time we descend into a child, that child has room to absorb a split from below. So we can release the parent.

For reads on the same tree, hand-over-hand with read locks works as in the BST example above, and reads and writes can overlap freely — `RWMutex` is shared between readers but exclusive against writers.

### Go pitfalls in hand-over-hand

- **`sync.RWMutex` is not reentrant.** Acquiring it twice on the same goroutine deadlocks. Make sure your code never re-enters.
- **Deferring `Unlock` does not work cleanly across iterations.** You must call `Unlock` explicitly inside the loop. Forgetting to do so is the #1 hand-over-hand bug.
- **Each node carries an `RWMutex`.** That is 24 bytes on 64-bit Go. A million-node tree adds ~24 MB just in mutex headers. Acceptable, but real.
- **The order of `Lock(child); Unlock(parent)` matters.** If you `Unlock(parent)` first, another goroutine can free the child before you lock it.

### When to use it

Hand-over-hand is appropriate when:

- Writes are frequent enough that one big lock hurts.
- Workloads are spread across the tree (no single hot key).
- You control the tree implementation (you cannot retrofit hand-over-hand onto `google/btree` without forking).

For most Go programs, the per-node mutex overhead and implementation complexity make this not worth it; sharding is simpler and gets you 80% of the benefit. Hand-over-hand really shines in single-tree, high-throughput, ordered-range workloads where sharding would defeat the range query.

---

## Optimistic Concurrency with Version Counters

The second technique. Goal: readers traverse with no locks at all. Each node carries an integer version that increments on every write to that node. Readers capture the version before reading and check it after; if it changed, retry.

### Minimal version-counter tree (BST again)

```go
package occbst

import (
    "sync"
    "sync/atomic"
)

type Node struct {
    version uint64       // atomic; incremented on every mutation
    writeMu sync.Mutex   // held by writers only
    key     int
    value   string
    left    *Node
    right   *Node
}

type Tree struct {
    rootRef atomic.Pointer[Node]
}

func (t *Tree) Get(k int) (string, bool) {
    for retry := 0; retry < 8; retry++ {
        n := t.rootRef.Load()
        if n == nil {
            return "", false
        }
    Walk:
        for n != nil {
            v1 := atomic.LoadUint64(&n.version)
            if v1&1 == 1 {
                // Writer is in flight; back off and retry.
                continue Walk
            }
            key := n.key
            value := n.value
            left := n.left
            right := n.right
            // Validate that the node has not been mutated under us.
            v2 := atomic.LoadUint64(&n.version)
            if v2 != v1 {
                continue Walk // dirty read; restart from current n
            }
            switch {
            case k < key:
                n = left
            case k > key:
                n = right
            default:
                return value, true
            }
        }
        return "", false
    }
    // Bound retries — fall back to a global lock if we keep failing.
    panic("too many OCC retries")
}
```

Writers use a `writeMu` to serialize among themselves and bump the version twice — once at the start (`v |= 1`) and once at the end (`v += 1`):

```go
func (n *Node) beginWrite() {
    n.writeMu.Lock()
    atomic.AddUint64(&n.version, 1) // now odd: "writer in flight"
}

func (n *Node) endWrite() {
    atomic.AddUint64(&n.version, 1) // now even: "writer done"
    n.writeMu.Unlock()
}
```

So an odd version means "writer in flight, do not trust reads"; an even version means "stable." Readers loop until they see a stable, unchanged version across their entire read of the node.

### OLFIT (Optimistic Latch-Free Index Traversal)

The 2001 OLFIT paper from Korean Telecommunications introduced this exact protocol for B-trees. Key adaptations:

- Each B-tree node has a `latch` (mutex) for writers, and a `version` for readers.
- Readers do not take the latch; they validate the version.
- If validation fails, they restart from the root.
- Writers take the latch, set version odd, mutate, set version even, release.

OLFIT is the basis of many modern in-memory database B-trees (Hekaton, HyPer, DuckDB's earlier versions). The protocol is correct, simple, and very fast on read-heavy workloads.

### Pitfalls

- **The Go memory model requires explicit atomics.** Plain reads of `version` are racy in the data-race sense; the race detector will flag them. Use `atomic.LoadUint64`.
- **You must read every field through atomics or under the version check.** A non-atomic read of a pointer can return a torn pointer on 32-bit platforms.
- **Validation must be a *complete* read.** If you split your read of a node across two version checks, you may see inconsistent state.
- **Retries can starve under heavy writes.** Bound the retry count and fall back to a lock.
- **The B-tree case has an additional concern.** A reader may descend into a node that has just been *split*. After the split, the key it was looking for may be in the right sibling, not in this node. The B-link sibling pointer (next section) solves this.

### When to use it

OCC is appropriate when:

- Reads vastly outnumber writes (e.g., 99% reads).
- Writers are infrequent enough that retries are rare.
- You can write the protocol correctly. (Many people cannot; bug rate is high.)

For Go programs, a simpler alternative often beats raw OCC: COW with snapshot publishing. Readers see an immutable snapshot; writers build a new snapshot and publish it atomically. No retries, no version counters. Read on.

---

## Copy-On-Write Trees

The third technique, and the one used by both `google/btree` (for `Clone`) and `tidwall/btree` (for `Copy`). The idea: mutations produce a brand-new path from root to leaf; the rest of the tree is shared.

### Path copying, drawn

Starting tree:

```
            R
           / \
          A   B
         / \   \
        C   D   E
```

You want to insert into `C`. You create:

- `C'` — a new C with the new item.
- `A'` — a new A pointing to `C'` and the old `D`.
- `R'` — a new root pointing to `A'` and the old `B`.

The new tree's root is `R'`; the old tree's root is `R`. The subtrees rooted at `D`, `B`, and `E` are *shared* between the two trees.

```
old: R---A---C
         \---D
     \---B---E

new: R'--A'--C'
         \---D       (shared with old)
     \---B---E       (shared with old)
```

Any reader holding the old root pointer continues to see the old tree, unmodified. Any subsequent reader who gets the new root pointer sees the new tree. Both trees are valid; both are immutable from the reader's perspective.

### Path copying cost

Per write: `O(log n)` allocations and copies. For a B-tree of fanout 64 storing a billion entries, that is ~5 nodes copied per write, each ~1 KB. About 5 KB of allocation per write — well within Go's GC capacity.

### A minimal COW BST

```go
package cowbst

import "sync/atomic"

type Node struct {
    key   int
    value string
    left  *Node
    right *Node
}

type Tree struct {
    root atomic.Pointer[Node]
}

// Insert atomically replaces the root with a new tree containing (k, v).
// Multiple concurrent inserts may race; the last to CAS wins (others retry).
func (t *Tree) Insert(k int, v string) {
    for {
        old := t.root.Load()
        newRoot := insert(old, k, v)
        if t.root.CompareAndSwap(old, newRoot) {
            return
        }
        // Someone else updated; retry.
    }
}

func insert(n *Node, k int, v string) *Node {
    if n == nil {
        return &Node{key: k, value: v}
    }
    nn := *n // shallow copy
    switch {
    case k < n.key:
        nn.left = insert(n.left, k, v)
    case k > n.key:
        nn.right = insert(n.right, k, v)
    default:
        nn.value = v
    }
    return &nn
}

func (t *Tree) Get(k int) (string, bool) {
    n := t.root.Load()
    for n != nil {
        switch {
        case k < n.key:
            n = n.left
        case k > n.key:
            n = n.right
        default:
            return n.value, true
        }
    }
    return "", false
}
```

Reads are pure pointer chasing — no locks at all. Writes are wait-free *within the recursion* but spin on the root CAS. Under heavy write contention, the CAS retries can hurt — typically you serialize writes with a single mutex (writes are still cheap because allocation, not contention, is the cost) and let reads be lock-free.

A more typical production shape:

```go
type Tree struct {
    writeMu sync.Mutex
    root    atomic.Pointer[Node]
}

func (t *Tree) Insert(k int, v string) {
    t.writeMu.Lock()
    defer t.writeMu.Unlock()
    newRoot := insert(t.root.Load(), k, v)
    t.root.Store(newRoot)
}
```

Writes are serialized; reads are wait-free; the GC reclaims old nodes when no reader is holding them. This is essentially RCU in Go.

### COW B-trees (`tidwall/btree`)

`tidwall/btree` implements COW path copying for both `Set` and `Delete`. The internal node carries a reference count; when `Copy()` is called, the root's refcount goes from 1 to 2 (both trees own it). On the next write to either tree, the affected nodes (those with refcount > 1) are cloned before mutation. Reads do not need locks if the tree is treated as immutable.

Idiomatic Go pattern:

```go
type Store struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
}

func New() *Store {
    s := &Store{live: btree.NewBTreeG[Item](less)}
    s.snapshot.Store(s.live.Copy())
    return s
}

func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.live.Set(it)
    s.snapshot.Store(s.live.Copy())
}

func (s *Store) Get(k int) (Item, bool) {
    return s.snapshot.Load().Get(Item{Key: k})
}
```

Read path: zero locks. Write path: one mutex, one `Copy` (which is `O(1)`). The published snapshot is replaced atomically. Old snapshots are GC'd when no goroutine holds them.

This is the simplest production-grade concurrent ordered structure you can build in Go. It works, it scales, it has no exotic bugs.

### When to use COW

COW is the right default for:

- Read-heavy workloads (most of them).
- Workloads needing point-in-time snapshots.
- Workloads that fit comfortably in memory (COW costs extra memory during writes).
- Workloads where eventual visibility is acceptable (readers see the most recent published snapshot).

COW is wrong when:

- You need strong "read-your-writes" within a single goroutine after a `Set` (you must re-load the snapshot after every write you care about).
- Writes are huge bursts that thrash allocation.
- You need strict ordering between reads and writes (use a single Mutex).

### Memory pressure of COW

A single COW write allocates one node per level — `O(log n)` total. At fanout 32, a billion-entry tree has height ~6, so ~6 nodes per write, each holding ~32 items of fixed size. For 64-byte items, that is roughly 12 KB per write of fresh allocation. The GC can comfortably handle 10k writes/sec at that rate; 100k writes/sec starts to put pressure on it.

A workaround: build a *batched* write API that collects N writes and applies them in one `Set` pass over the live tree, then publishes the snapshot once. Fewer snapshot allocations; same correctness.

---

## Sibling-Pointer (B-link) Sketch

The Lehman-Yao B-link tree solves the "concurrent split made my reader walk into the wrong node" problem.

### The problem

A reader walks from root to leaf looking for key `K`. It descends into node `N`. Meanwhile, a writer splits `N` into `N` (left half) and `M` (right half), pushing the median key up. Now `K` may belong to `M`, not `N`. The reader does not know about `M` because the parent pointer to `M` is being added simultaneously.

Without B-link: the reader must re-lock the parent and re-traverse to discover `M`. This makes concurrent splits painful.

### The fix

Every node has an extra pointer: `rightSibling`. Whenever a node is split, the right half exists *before* the parent learns about it. The parent updates its child pointers after the split is complete.

If a reader on `N` sees that its current node's `highkey` (largest key) is less than `K`, it follows `rightSibling` to find `K`. No re-latching of the parent needed.

```
Before split:
  Parent: ... | N | ...
  N: keys [a, b, c, d, e, f, g] rightSibling=Q

After split (during which a reader may see):
  N: keys [a, b, c]  highkey=c  rightSibling=M
  M: keys [d, e, f, g]  highkey=g  rightSibling=Q
  Parent: ... | N | ...  (not yet updated)

Reader looking for f:
  arrives at N
  f > highkey(N) = c, so follow rightSibling to M
  finds f in M
```

The parent will eventually be updated:

```
After parent update:
  Parent: ... | N | M | ...
  (subsequent readers find M directly through the parent)
```

The B-link protocol is the foundation of every serious concurrent B-tree implementation, including PostgreSQL's nbtree and InnoDB's index trees.

### A Go sketch

```go
// Pseudocode, not runnable.
type bLinkNode struct {
    mu          sync.RWMutex
    keys        []int
    values      []string
    children    []*bLinkNode // only for internal nodes
    rightSib    *bLinkNode
    highkey     int
    isLeaf      bool
}

func (t *bLinkTree) Get(k int) (string, bool) {
    n := t.root
    for !n.isLeaf {
        n.mu.RLock()
        // Follow right sibling chain if key > highkey
        for n.highkey < k && n.rightSib != nil {
            next := n.rightSib
            next.mu.RLock()
            n.mu.RUnlock()
            n = next
        }
        // Descend
        i := childIndex(n, k)
        child := n.children[i]
        child.mu.RLock()
        n.mu.RUnlock()
        n = child
    }
    // Leaf
    n.mu.RLock()
    for n.highkey < k && n.rightSib != nil {
        next := n.rightSib
        next.mu.RLock()
        n.mu.RUnlock()
        n = next
    }
    v, ok := lookupInLeaf(n, k)
    n.mu.RUnlock()
    return v, ok
}
```

The "follow rightSib if highkey < k" logic is the entire correctness trick: a reader can recover from a missed split by walking right.

### Why this matters in Go

Strictly speaking you can build a fully working concurrent B-tree in Go without B-link, using hand-over-hand and serializing splits with a tree-wide write lock. B-link is the *throughput* improvement: it lets splits be local, not requiring any tree-wide latch. For workloads with frequent splits (e.g., monotonically increasing keys), B-link can multiply write throughput several-fold.

You will almost never implement B-link from scratch in Go for a service. You will rely on a library that does. Knowing the protocol exists is what lets you read the source of a competent library (or PostgreSQL's `nbtree.c`) and understand it.

---

## Working With `tidwall/btree` at Depth

`github.com/tidwall/btree` is the cleanest Go library for COW-style ordered data. Let's look at how to use its features deliberately.

### COW semantics in detail

```go
tr := btree.NewBTreeG[Item](less)
tr.Set(Item{Key: 1})
tr.Set(Item{Key: 2})
tr.Set(Item{Key: 3})

snap1 := tr.Copy()  // O(1); both share the root
tr.Set(Item{Key: 4}) // tr clones the path; snap1 unaffected
snap2 := tr.Copy()  // O(1); tr and snap2 share

snap1.Set(Item{Key: 99}) // snap1 also clones; tr unaffected
```

After this sequence:

- `tr` has `{1,2,3,4}` (and its own copy of the spine touched by 4).
- `snap1` has `{1,2,3,99}` (and its own copy of the spine touched by 99).
- `snap2` has `{1,2,3,4}` and shares structure with `tr` up until the next write.

The clever bit: any node whose refcount is 1 can be modified in place (no clone). Only nodes with refcount > 1 need to be cloned. So sequential writes within the same tree do not pay the COW cost.

### Lock-coupled internals

`tidwall/btree` provides `Iter` for explicit, cursor-style iteration:

```go
it := tr.Iter()
defer it.Release()
for ok := it.First(); ok; ok = it.Next() {
    fmt.Println(it.Item())
}
```

Internally, `Iter` holds a path of nodes from root to the current leaf. It does *not* hold any locks — it relies on the COW invariant that the nodes it observed cannot be mutated. If another goroutine writes to the tree, those writes happen on cloned nodes; the iterator's view is stable.

This is genuinely lock-free reading. The cost is paid in the COW writer's allocation.

### A pattern: publish-subscribe with versioned snapshots

```go
type Store struct {
    mu      sync.Mutex
    live    *btree.BTreeG[Item]
    pub     atomic.Pointer[Published]
}

type Published struct {
    Version int64
    Tree    *btree.BTreeG[Item]
}

func New() *Store {
    s := &Store{live: btree.NewBTreeG[Item](less)}
    s.pub.Store(&Published{Tree: s.live.Copy()})
    return s
}

func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.live.Set(it)
    cur := s.pub.Load()
    s.pub.Store(&Published{Version: cur.Version + 1, Tree: s.live.Copy()})
}

func (s *Store) View() *Published {
    return s.pub.Load()
}
```

A reader can:

```go
p := store.View()
// p.Tree is an immutable snapshot; iterate it freely.
// p.Version lets callers detect changes.
```

Readers do not block writers; writers do not block readers; readers do not block each other. The cost: every write does an `O(1)` clone plus one atomic pointer store. The benefit: read throughput limited only by memory bandwidth.

This is a *very* good default for Go services that need an ordered concurrent index. It is implemented in production at multiple companies under different names ("DurableMap," "MVMap," "AtomicTree"). The shape is always the same.

### A pattern: pending writes batched, then published

To reduce snapshot churn:

```go
type BatchedStore struct {
    mu      sync.Mutex
    live    *btree.BTreeG[Item]
    pending []Item // accumulated since last publish
    pub     atomic.Pointer[btree.BTreeG[Item]]
}

func (s *BatchedStore) Set(it Item) {
    s.mu.Lock()
    s.pending = append(s.pending, it)
    s.mu.Unlock()
}

func (s *BatchedStore) Flush() {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, it := range s.pending {
        s.live.Set(it)
    }
    s.pending = s.pending[:0]
    s.pub.Store(s.live.Copy())
}
```

Now `Set` is super fast (one append + lock acquisition) but readers do not see the new items until `Flush` runs. Run `Flush` from a ticker at, say, 100 Hz, and you have at most 10 ms of read staleness in exchange for amortized snapshot allocation.

### The `Hint` API

`tidwall/btree` exposes `SetHint`, `GetHint`, `DeleteHint`. A `Hint` is a small caller-side bookmark that records the path taken on the last access. If your next access is "nearby" in key order, the tree can shortcut from the hint, skipping the root traversal.

```go
var hint btree.PathHint
tr.SetHint(Item{Key: 100}, &hint)
tr.GetHint(Item{Key: 101}, &hint) // shortcuts down from the previous path
```

Useful for bulk insert in key order (the hint stays valid through neighboring nodes), or for cursor scans that interleave reads and writes.

---

## Coding Patterns

**Pattern 1: One tree, one mutex, but mutex held only for the lookup.**

Sometimes the lock is hot not because the tree is hot, but because the *work* under the lock is hot. Be ruthless about minimizing work under the lock:

```go
// Bad: large struct allocation under lock
func (t *Tree) Insert(k int, big BigStruct) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.bt.ReplaceOrInsert(Item{Key: k, Value: big.Render()}) // Render() is slow
}

// Good: prep outside, insert inside
func (t *Tree) Insert(k int, big BigStruct) {
    v := big.Render()
    t.mu.Lock()
    defer t.mu.Unlock()
    t.bt.ReplaceOrInsert(Item{Key: k, Value: v})
}
```

This is true of *any* lock, not just trees. Prepare outside, mutate inside.

**Pattern 2: Always release lock before calling callbacks.**

```go
// Bad: deadlock if callback re-enters
func (t *Tree) ScanAndCall(fn func(Item)) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    t.bt.Ascend(func(it Item) bool { fn(it); return true })
}

// Good: snapshot, release, call
func (t *Tree) ScanAndCall(fn func(Item)) {
    t.mu.RLock()
    var snap []Item
    t.bt.Ascend(func(it Item) bool { snap = append(snap, it); return true })
    t.mu.RUnlock()
    for _, it := range snap {
        fn(it)
    }
}
```

For huge trees, the snapshot slice can be big. The COW snapshot pattern (publish/subscribe) is better in that case.

**Pattern 3: Snapshot for read-many, lock for write-rare.**

Most services have one writer and many readers. Use the publish/subscribe COW pattern. Reads are wait-free; writes pay one `Copy` per write.

**Pattern 4: Single-writer goroutine + channels.**

Sometimes it is simplest to make the tree single-threaded behind a goroutine:

```go
type Op struct {
    Kind  int // 0=set, 1=get, 2=del
    Item  Item
    Reply chan Item
}

type ChanStore struct {
    ops chan Op
}

func (s *ChanStore) run() {
    tr := btree.NewBTreeG[Item](less)
    for op := range s.ops {
        switch op.Kind {
        case 0:
            tr.Set(op.Item)
        case 1:
            it, _ := tr.Get(op.Item)
            op.Reply <- it
        case 2:
            tr.Delete(op.Item)
        }
    }
}
```

Simple, but every operation pays channel overhead. Use only when the tree is *the* bottleneck shared resource and you want a single ownership model. Most services should not.

**Pattern 5: Per-shard publish/subscribe.**

Combine sharding and publish/subscribe: N shards, each shard with its own published snapshot. Get the best of both — point-access scales with shards, snapshot ensures readers never block.

---

## Clean Code

- **Hide which protocol you use.** A caller should not know whether you used `RWMutex`, COW, or OCC. Refactor freely.
- **Name the snapshot type clearly.** `Snapshot[T]`, `View[T]`, `Published[T]` — not `BtreeRefRef`.
- **Document staleness explicitly.** "Readers see the snapshot as of the last `Publish`. Call `Publish` to make recent writes visible to readers."
- **Comment every lock with its invariant.** "// mu protects bt; held briefly to take a Copy() and swap the published snapshot."
- **Avoid mixing protocols.** Do not have some methods use COW snapshots and others read live with `RWMutex`. Pick one.

---

## Product Use

A few real shapes that appear in production:

- **Internal config store.** Publish/subscribe COW. Writers (admins) are rare; readers are every request.
- **In-memory index of items behind a microservice.** Per-shard COW snapshots, refreshed every 100 ms.
- **Real-time analytics buffer.** Single-writer goroutine ingests events; readers query a published snapshot.
- **Time-series ring index.** Hand-over-hand for writes (lots of new keys at the right edge), COW snapshot for reads.
- **Per-tenant route table.** One COW tree per tenant; updates atomic per tenant; readers always see one consistent tenant.

---

## Performance Tips

- **Profile before optimizing.** `pprof` will tell you whether the lock is hot. If it is not, do not change anything.
- **Snapshot replacement is GC pressure.** Each `Copy` + publish allocates. Watch `go tool pprof` for `runtime.mallocgc`.
- **Batch writes when possible.** One published snapshot per 100 writes amortizes allocation.
- **Tune the B-tree degree.** For COW, lower degree (16) means shallower path-copy cost; higher degree (64) means flatter tree but more in-node copying on writes. Benchmark.
- **For pure reads, drop to plain pointer chasing.** No mutex, no atomic — just an `atomic.Pointer[...]` load of the root and walk.
- **For hand-over-hand, use `sync.RWMutex` only when reads dominate.** A plain `sync.Mutex` is smaller and faster if every traversal is a writer (e.g., a TTL eviction loop).
- **Avoid `defer` in hot inner loops.** `defer` costs ~30 ns; in a tight CAS loop it shows up in flamegraphs.

---

## Best Practices

- Default to publish/subscribe COW with `tidwall/btree`. It is correct, fast, and easy to reason about.
- Only move to hand-over-hand if you have measured COW snapshot allocation as the bottleneck.
- Only move to OCC if you have measured the COW publish/swap as the bottleneck (rare).
- Document the snapshot semantics in your public API.
- Test under `-race` always.
- Test with `go test -count=100 -race` to shake out flaky races.
- Benchmark on real hardware and real workloads.

---

## Edge Cases and Pitfalls

- **Snapshot held forever pins memory.** If a goroutine grabs a snapshot and never lets go, the GC cannot free old nodes. Be diligent about scoping snapshots.
- **`atomic.Pointer[T].CompareAndSwap` is not a panacea.** CAS retries can starve under heavy contention.
- **`Copy()` followed by many small writes is wasteful.** Each write may clone. Prefer batched writes between `Copy()` calls.
- **`Iter` invalidation.** If you write to the tree while an `Iter` is open, the iterator continues on its own copy of the spine — but new items are not visible. Decide whether this is what you want.
- **Reentrant callbacks.** Same as junior level, only more so. Hand-over-hand is *especially* sensitive.
- **GC and pinned pointers.** A snapshot kept in a global variable will pin every node in that snapshot's structural footprint. Memory grows.

---

## Common Mistakes

1. **Mixing protocols.** Some methods snapshot; others lock the live tree. Race conditions emerge.
2. **Forgetting to release a hand-over-hand lock on an early return.** Use explicit Unlock at every exit.
3. **Reading a node without taking its OCC version.** Plain `read` looks fine in non-concurrent tests, breaks under load.
4. **Implementing your own COW B-tree.** Use a library. Yours will be slower and buggier.
5. **Publishing after every `Set`.** Causes excessive allocation. Batch.
6. **Holding the write mutex across the `Copy()`.** `Copy()` is cheap but still costs an allocation. Keep the critical section short.
7. **Snapshot leak.** A goroutine holds a snapshot indefinitely; old tree memory accumulates.
8. **Recursive locking.** `sync.RWMutex` is not reentrant. Don't call into a method that takes the same lock.
9. **Using `RWMutex` for write-heavy workloads.** Plain `Mutex` is faster.

---

## Common Misconceptions

- *"COW is free for reads."* Reads are lock-free, yes; but you still pay the indirection of an atomic pointer load and the path traversal. Compared to a non-COW tree, the read cost is the same; the savings come from avoiding the *lock*.
- *"OCC is faster than COW."* Sometimes. OCC saves the allocation but adds the version check. For most Go workloads, COW wins.
- *"B-link is necessary for any concurrent B-tree."* No. A single-tree-write-lock B-tree works fine for moderate throughput. B-link is for high write contention.
- *"Hand-over-hand locks fewer bytes than COW."* Hand-over-hand allocates `sync.RWMutex` per node (24 bytes). COW allocates new nodes per write (~ kB). For *small* trees with high write rates, hand-over-hand may win on memory; for large trees with moderate write rates, COW wins.
- *"`sync.Map` does optimistic concurrency."* Sort of, but not for ordered data. Different beast.

---

## Tricky Points

- **Publishing a snapshot does *not* guarantee that subsequent reads observe the publish.** A reader who loaded the previous snapshot keeps reading from it. "Eventual visibility" is the right mental model.
- **`atomic.Pointer.Store` is a release; `Load` is an acquire.** That is the Go memory model guarantee for atomic pointer ops. You can rely on it for publish/subscribe.
- **The `live` tree in publish/subscribe is mutated only by the writer goroutine.** Calling any method on it from a reader (even `Len()`) is a race.
- **A `Copy()` followed by a `Set` may allocate more nodes than expected if the live tree's structure is complex.** Allocation is `O(log n)` *per write*, but a long batch of writes after a `Copy()` may scatter clones.
- **`writeMu` in OCC must be held for the entire write, including the version increment.** Releasing it between the increment and the validation gives readers a window where they see "writer in flight" but `writeMu` is free — confusing.

---

## Test

```go
package store_test

import (
    "sync"
    "sync/atomic"
    "testing"

    "github.com/tidwall/btree"
    "example.com/store"
)

func TestPublishSubscribe(t *testing.T) {
    s := store.New()
    var wg sync.WaitGroup
    const N = 10_000
    // Writer
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < N; i++ {
            s.Set(store.Item{Key: i, Value: i})
        }
    }()
    // Readers
    var lastSeen int64
    for r := 0; r < 8; r++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < N; i++ {
                view := s.View()
                if it, ok := view.Tree.Get(store.Item{Key: i}); ok {
                    atomic.StoreInt64(&lastSeen, int64(it.Key))
                }
            }
        }()
    }
    wg.Wait()
    if s.View().Tree.Len() != N {
        t.Fatalf("len=%d", s.View().Tree.Len())
    }
}
```

Run with `-race -count=10` to shake out concurrency bugs.

---

## Tricky Questions

**Q1.** In hand-over-hand, why must you lock the child *before* unlocking the parent?
A. So that a writer cannot delete (and have GC reclaim) the child between unlock and lock.

**Q2.** In OCC, what happens if `version` overflows?
A. With `uint64`, in practice never. With `uint32`, you must protect with a global "rotation epoch" or accept rare retries.

**Q3.** A reader using a published COW snapshot misses a write. Is this a bug?
A. No — it is the documented eventual-visibility semantics. The reader sees a *consistent* snapshot, not necessarily the newest one.

**Q4.** Why does `tidwall/btree.Copy()` run in `O(1)`?
A. It increments a refcount on the root node. No actual data is copied until the first write to either tree.

**Q5.** In the publish/subscribe pattern, why is `s.live` not accessed by readers?
A. Because the live tree is mutated by the writer. Reading it concurrently is a race; the snapshot is the safe view.

**Q6.** Can two writers concurrently call `Set` on the same publish/subscribe `Store`?
A. Only if you take `mu` around the entire `Set`. If both bypass the mutex, they race on `s.live`.

**Q7.** What does the B-link "highkey" field mean?
A. The largest key reachable through this node. If a reader's target key exceeds the highkey, the reader follows `rightSib`.

**Q8.** What is the memory cost of one COW write on a 1B-entry tree of fanout 32?
A. About 6 nodes (height ~6), each holding ~32 items. For 32-byte items, that is ~6 KB per write of fresh allocation. The GC reclaims after no reader holds the old version.

**Q9.** Why not use `sync.RWMutex` for COW writes?
A. Writes are serialized via a single `sync.Mutex`. Multiple writers would have to merge their changes, which is harder than serializing. Reads are lock-free, so the writer mutex is the only lock in the system.

**Q10.** Is COW lock-free for reads?
A. Yes. Reads just load an `atomic.Pointer` and walk pointers in the snapshot. No mutex, no CAS.

---

## Cheat Sheet

| Technique | Read latency | Write latency | Memory | Complexity |
|-----------|--------------|---------------|--------|------------|
| Single Mutex | Lock cost | Lock cost | Low | Trivial |
| RWMutex | Read lock cost | Exclusive | Low | Trivial |
| Sharded | Lock cost | Lock cost | Low | Easy |
| Hand-over-hand | 2 locks per step | 2 locks per step | Mid (per-node mutex) | Medium |
| OCC | None (read+verify) | Lock + version | Low | Hard |
| COW publish | Pointer load + walk | Path-copy + publish | High (snapshots) | Medium |
| B-link | Lock + maybe walk right | Lock + split | Mid | Hard |
| RCU | Pointer load + walk | Path-copy + publish + epoch | Mid | Hard |

Default: **COW publish/subscribe with `tidwall/btree`.** Reach for others only with profiling evidence.

---

## Self-Assessment Checklist

- [ ] Explain hand-over-hand locking on a BST.
- [ ] Write a publish/subscribe `Store` backed by `tidwall/btree.Copy()`.
- [ ] Explain what a B-link right-sibling pointer does.
- [ ] Explain why `atomic.Pointer.Store` is sufficient for the publish step.
- [ ] Explain the version-counter protocol of OCC and when it fails.
- [ ] Spot reentrant-callback deadlocks in code review.
- [ ] Identify when one big mutex is fine and when it is not.
- [ ] Run a `-race` test on a COW tree and interpret the output.
- [ ] Describe how `tidwall/btree`'s refcount-based COW works.
- [ ] Compare the memory cost of hand-over-hand vs COW.

---

## Summary

The middle level is about making writers and readers overlap without corrupting the tree. Hand-over-hand locks scale the writer / writer overlap by giving each node its own mutex. Optimistic concurrency removes read latches entirely by validating against version counters. Copy-on-write makes readers genuinely lock-free at the cost of per-write allocation. Sibling pointers (B-link) let splits be visible to in-flight readers without re-latching the parent.

In Go, the practical sweet spot for almost every service is **COW publish/subscribe with `tidwall/btree`**: writers serialize on one mutex, take an `O(1)` `Copy()` after each write (or each batch), and publish the result via `atomic.Pointer`. Readers do not lock at all. This handles every realistic in-memory ordered-data workload in production Go code.

The next file (senior) shows how real database storage engines (PostgreSQL, InnoDB, BoltDB) take these ideas further: latching protocols, RCU + epoch-based reclamation, MVCC integration, immutable persistent trees.

---

## Further Reading

- Lehman, Yao, *Efficient Locking for Concurrent Operations on B-Trees* (1981).
- Cha, Hwang, *Cache-Conscious Concurrency Control of Main-Memory Indexes on Shared-Memory Multiprocessor Systems* (2001) — OLFIT.
- Levandoski et al., *The Bw-Tree* (2013).
- McKenney, *Is Parallel Programming Hard?* (2017) — RCU bible.
- Source of `tidwall/btree` and `google/btree`.

---

## Related Topics

- [Senior file](senior/) — latching protocols, MVCC, RCU.
- [Copy-on-Write](../05-copy-on-write/) — broader pattern.
- [Concurrent Skip List](../03-concurrent-skip-list/) — alternative ordered structure.

---

## Diagrams

### Hand-over-hand timeline

```
Time -->

G1: RLock(root); RLock(N1); RUnlock(root); RLock(N2); RUnlock(N1); ...
G2:       RLock(root); RLock(N3); RUnlock(root); RLock(N4); RUnlock(N3); ...
G3:                    RLock(root); RLock(N5); RUnlock(root); ...
```

### COW publish

```
Time -->

writer:  Set(it1) -> Copy -> Store(snap_v1)
                     Set(it2) -> Copy -> Store(snap_v2)
                                          Set(it3) -> Copy -> Store(snap_v3)

reader1: Load(snap_v1) ... walks ... done
reader2:                Load(snap_v2) ... walks ... done
reader3:                                Load(snap_v3) ... walks ... done
```

Snapshots `v1`, `v2`, `v3` coexist until the last reader holding each one is done. Then GC reclaims their unique nodes.

### B-link split

```
Before:                    During (reader visible):       After (parent updated):
  P [...|x|...]               P [...|x|...]                  P [...|x|y|...]
       |                          |   \                          |   |
       N                          N    M                         N   M
       |                          |    |
   right=Q                    right=M  right=Q                right=M  right=Q
```

The reader on `N` notices `key > highkey(N)` and follows `right=M` to find the key — no parent re-lock.

---

## Appendix A: A complete hand-over-hand B-tree, working code

Below is a fully working hand-over-hand B-tree of `int` keys and `int` values, with proper preemptive splits, fanout-controlled nodes, and per-node `sync.RWMutex`. It is simpler than `google/btree` (no deletion, no generics, fixed types) so you can read every line.

```go
package hohbtree

import "sync"

const (
    // Each node holds between minItems and maxItems = 2*minItems items.
    minItems = 16
    maxItems = 2 * minItems
)

type Node struct {
    mu       sync.RWMutex
    leaf     bool
    items    []item
    children []*Node // len(children) == len(items)+1 if !leaf, else nil
}

type item struct {
    key int
    val int
}

type Tree struct {
    rootMu sync.RWMutex
    root   *Node
}

func New() *Tree {
    return &Tree{root: &Node{leaf: true}}
}

// findInNode returns (index of first item >= key, exact match).
func findInNode(n *Node, key int) (int, bool) {
    lo, hi := 0, len(n.items)
    for lo < hi {
        mid := int(uint(lo+hi) >> 1)
        if n.items[mid].key < key {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    if lo < len(n.items) && n.items[lo].key == key {
        return lo, true
    }
    return lo, false
}

func (t *Tree) Get(key int) (int, bool) {
    t.rootMu.RLock()
    n := t.root
    n.mu.RLock()
    t.rootMu.RUnlock()

    for {
        i, found := findInNode(n, key)
        if found {
            v := n.items[i].val
            n.mu.RUnlock()
            return v, true
        }
        if n.leaf {
            n.mu.RUnlock()
            return 0, false
        }
        child := n.children[i]
        child.mu.RLock()
        n.mu.RUnlock()
        n = child
    }
}

// splitChild splits n.children[i], which must be full (len(items) == maxItems).
// n must be write-locked. The child becomes the left half; a new right child is
// inserted after it; the median goes into n.items.
func (n *Node) splitChild(i int) {
    full := n.children[i]
    // (full is already write-locked by the caller)
    mid := len(full.items) / 2
    medianItem := full.items[mid]
    right := &Node{leaf: full.leaf}
    right.items = append(right.items, full.items[mid+1:]...)
    full.items = full.items[:mid]
    if !full.leaf {
        right.children = append(right.children, full.children[mid+1:]...)
        full.children = full.children[:mid+1]
    }
    // Insert medianItem into n.items at index i; insert right into n.children at i+1.
    n.items = append(n.items, item{})
    copy(n.items[i+1:], n.items[i:])
    n.items[i] = medianItem
    n.children = append(n.children, nil)
    copy(n.children[i+2:], n.children[i+1:])
    n.children[i+1] = right
}

func (t *Tree) Set(key, val int) {
    t.rootMu.Lock()
    root := t.root
    root.mu.Lock()
    if len(root.items) == maxItems {
        // Grow: new root with old root as the sole child, then split.
        newRoot := &Node{leaf: false, children: []*Node{root}}
        newRoot.mu.Lock()
        newRoot.splitChild(0)
        t.root = newRoot
        root.mu.Unlock() // old root is still locked by us above via "root.mu.Lock()"
        root = newRoot
    }
    t.rootMu.Unlock()
    // root is write-locked
    insertNonFull(root, key, val)
}

// insertNonFull assumes n is write-locked and not full.
// On exit, n is unlocked.
func insertNonFull(n *Node, key, val int) {
    i, found := findInNode(n, key)
    if found {
        n.items[i].val = val
        n.mu.Unlock()
        return
    }
    if n.leaf {
        n.items = append(n.items, item{})
        copy(n.items[i+1:], n.items[i:])
        n.items[i] = item{key: key, val: val}
        n.mu.Unlock()
        return
    }
    // Internal: descend.
    child := n.children[i]
    child.mu.Lock()
    if len(child.items) == maxItems {
        n.splitChild(i)
        // After split, key may belong in the new right child.
        if key > n.items[i].key {
            child.mu.Unlock()
            child = n.children[i+1]
            child.mu.Lock()
        }
    }
    // Hand-over-hand: release parent before recursing.
    n.mu.Unlock()
    insertNonFull(child, key, val)
}
```

What to notice:

- Every method ends with the node unlocked.
- `Set` holds `rootMu` exactly long enough to grow the tree (if needed), then releases.
- Reads hold at most two locks (parent + current).
- Writes hold at most three locks momentarily (parent + current + child during split), but only two of them are on the descent path.
- Splits propagate upward via the preemptive-split invariant: by the time we descend, the parent has room.

The code is about 100 lines and handles all the tricky cases (root split, intermediate split, leaf insert). Compare to a production B-tree (`google/btree` is ~1000 lines); the extra lines are mostly delete, iteration, and generics.

This code is yours to study. Run `go test -race` with a stress test and convince yourself it works.

---

## Appendix B: A complete COW BST publish/subscribe store

```go
package cowstore

import (
    "sync"
    "sync/atomic"
)

type Node struct {
    Key   int
    Value int
    Left  *Node
    Right *Node
}

type Store struct {
    writeMu sync.Mutex
    root    atomic.Pointer[Node]
}

func New() *Store {
    var s Store
    s.root.Store(nil)
    return &s
}

func (s *Store) Get(k int) (int, bool) {
    for n := s.root.Load(); n != nil; {
        switch {
        case k < n.Key:
            n = n.Left
        case k > n.Key:
            n = n.Right
        default:
            return n.Value, true
        }
    }
    return 0, false
}

func (s *Store) Set(k, v int) {
    s.writeMu.Lock()
    defer s.writeMu.Unlock()
    s.root.Store(insert(s.root.Load(), k, v))
}

func insert(n *Node, k, v int) *Node {
    if n == nil {
        return &Node{Key: k, Value: v}
    }
    nn := *n
    switch {
    case k < n.Key:
        nn.Left = insert(n.Left, k, v)
    case k > n.Key:
        nn.Right = insert(n.Right, k, v)
    default:
        nn.Value = v
    }
    return &nn
}

func (s *Store) Delete(k int) {
    s.writeMu.Lock()
    defer s.writeMu.Unlock()
    s.root.Store(remove(s.root.Load(), k))
}

func remove(n *Node, k int) *Node {
    if n == nil {
        return nil
    }
    nn := *n
    switch {
    case k < n.Key:
        nn.Left = remove(n.Left, k)
        return &nn
    case k > n.Key:
        nn.Right = remove(n.Right, k)
        return &nn
    default:
        // Found the node to delete.
        if n.Left == nil {
            return n.Right
        }
        if n.Right == nil {
            return n.Left
        }
        // Find in-order successor and splice it.
        succ := n.Right
        for succ.Left != nil {
            succ = succ.Left
        }
        newRight := remove(n.Right, succ.Key)
        return &Node{Key: succ.Key, Value: succ.Value, Left: n.Left, Right: newRight}
    }
}
```

What this gives you:

- `Get` is wait-free: one atomic pointer load and pure pointer chasing.
- `Set` and `Delete` serialize under `writeMu`. They allocate `O(log n)` new nodes per call.
- Readers may see either the old or new tree; the publish is atomic via `atomic.Pointer.Store`.
- The GC reclaims old nodes as soon as no reader holds them.

A reader who started before `Set` sees the old tree; one who started after sees the new tree. There is no need for the reader to know which version they have. This is the simplest possible RCU pattern.

### Why this matters in Go

Compare to C: in C, you would need an *epoch* mechanism to know when it is safe to `free()` the old nodes. In Go, the garbage collector *is* the epoch mechanism. As long as no goroutine retains a pointer to the old tree, it will be collected. This makes Go an unusually pleasant language for RCU-style data structures.

### Extending to a B-tree

The same pattern works for a B-tree:

```go
func insertBT(n *Node, key int) *Node {
    nn := cloneNode(n)
    i, found := findInNode(nn, key)
    if nn.leaf {
        if found {
            nn.items[i].val = key
        } else {
            nn.items = append(nn.items, item{})
            copy(nn.items[i+1:], nn.items[i:])
            nn.items[i] = item{key: key, val: key}
        }
        return nn
    }
    nn.children[i] = insertBT(n.children[i], key)
    if len(nn.children[i].items) > maxItems {
        // Split the cloned child. (Original n.children[i] is unchanged.)
        nn.splitChild(i)
    }
    return nn
}
```

Each level of recursion clones a node. The total allocation per write is `O(log n)`. Old nodes that no longer appear in the current root are eventually GC'd. The result: fully concurrent, lock-free reads, single-writer writes.

This is exactly how `tidwall/btree` works under the hood, modulo refcount-based COW (which avoids cloning nodes with refcount 1).

---

## Appendix C: Three real OCC pitfalls

Optimistic concurrency control sounds simple — read, validate, retry — but the devil is in the validation.

### Pitfall 1: torn reads

A reader reads `(left, right)` of a node before validation completes. Between the two reads, a writer rotates the node, so `left` and `right` come from different versions. The reader's subsequent traversal is on a phantom tree.

Fix: read all relevant fields, *then* validate version, *then* use the values. Never use a value before the validation:

```go
for {
    v1 := atomic.LoadUint64(&n.version)
    if v1&1 == 1 { continue } // writer in flight
    left := n.left
    right := n.right
    key := n.key
    v2 := atomic.LoadUint64(&n.version)
    if v2 != v1 { continue } // dirty
    // Now safe to use left/right/key
    ...
}
```

### Pitfall 2: validation skipped at boundaries

The reader checks the version at the *start* of the node read but not at the *end*. A writer mutates the node between the start check and the end of the read. The reader proceeds with stale data.

Fix: always validate at both endpoints, or re-validate at every "decision point" in the read.

### Pitfall 3: B-tree splits invalidate OCC

A reader traversing an OCC B-tree descends into node `N`. While there, `N` is split into `N` and `M`. The reader's target key is now in `M`. OCC alone does not detect this; the reader's version-check on `N` passes (because `N` has not been mutated again since the split), but the reader is looking at the wrong node.

Fix: combine OCC with B-link (right-sibling pointers). The reader notices `key > highkey(N)`, follows `rightSibling` to `M`, validates `M`'s version, continues.

Real implementations (OLFIT, MassTree) combine OCC + B-link. Standalone OCC is fine for BSTs and skip lists but not B-trees.

---

## Appendix D: The `unsafe.Pointer` underbelly

Some advanced concurrent trees use `unsafe.Pointer` directly with `atomic` operations to pack additional state (a "mark bit") into the pointer. For example, a deletion-mark in a Harris–Michael lock-free linked list. In Go this is rarely worth doing — the `atomic.Pointer[T]` API is type-safe and almost as fast — but you may see it in older code.

```go
// Don't do this unless you must.
type markedPtr unsafe.Pointer

func loadMarked(p *unsafe.Pointer) (*Node, bool) {
    val := atomic.LoadPointer(p)
    return (*Node)(unsafe.Pointer(uintptr(val) &^ 1)), uintptr(val)&1 == 1
}
```

Modern Go (1.19+): use `atomic.Pointer[Node]` and a separate `atomic.Bool` mark. The compiler / runtime optimize this well; the readability win is large.

---

## Appendix E: Build your own publish/subscribe COW store

Exercise: take the BST in Appendix B and:

1. Add a `Range(lo, hi int, fn func(int, int) bool)` method that iterates [lo, hi).
2. Add a `Snapshot()` method that returns an immutable view (a frozen root pointer).
3. Add a `Len()` method that returns the size (you may need to cache it).
4. Add a `Versioned()` method that returns the current root pointer with a monotonic version number.
5. Write a test that runs 100 readers and one writer concurrently and asserts the readers always see a consistent snapshot.

Sample solution sketch:

```go
type Snapshot struct {
    root    *Node
    version int64
    size    int
}

type Store struct {
    writeMu  sync.Mutex
    snapshot atomic.Pointer[Snapshot]
}

func (s *Store) Set(k, v int) {
    s.writeMu.Lock()
    defer s.writeMu.Unlock()
    cur := s.snapshot.Load()
    newRoot, delta := insertCounting(cur.root, k, v)
    s.snapshot.Store(&Snapshot{
        root:    newRoot,
        version: cur.version + 1,
        size:    cur.size + delta,
    })
}

func (s *Store) Snapshot() *Snapshot { return s.snapshot.Load() }

func (sn *Snapshot) Get(k int) (int, bool) { return get(sn.root, k) }
func (sn *Snapshot) Len() int { return sn.size }
```

The `Snapshot` is an immutable record of (root, version, size). Publishing a new snapshot is a single `Store`. Readers receive a fully consistent triple.

### Range query

```go
func (sn *Snapshot) Range(lo, hi int, fn func(int, int) bool) {
    rangeRec(sn.root, lo, hi, fn)
}

func rangeRec(n *Node, lo, hi int, fn func(int, int) bool) bool {
    if n == nil {
        return true
    }
    if n.Key >= lo {
        if !rangeRec(n.Left, lo, hi, fn) {
            return false
        }
    }
    if n.Key >= lo && n.Key < hi {
        if !fn(n.Key, n.Value) {
            return false
        }
    }
    if n.Key < hi {
        if !rangeRec(n.Right, lo, hi, fn) {
            return false
        }
    }
    return true
}
```

Pure recursive in-order walk on an immutable subtree. No locks. Multiple snapshots can iterate concurrently.

---

## Appendix F: An MVCC sketch

Real database engines combine COW with **multi-version concurrency control**: each key carries multiple versions, and each reader sees the version current at their transaction start.

```go
type VersionedItem struct {
    Key      int
    Versions []Version
}

type Version struct {
    Value      int
    CreatedAt  int64 // logical transaction ID
    DeletedAt  int64 // 0 if not deleted
}

type Tree struct {
    mu sync.Mutex
    bt *btree.BTreeG[VersionedItem]
}

func (t *Tree) Write(k, v int, txID int64) {
    t.mu.Lock()
    defer t.mu.Unlock()
    cur, _ := t.bt.Get(VersionedItem{Key: k})
    cur.Key = k
    if len(cur.Versions) > 0 {
        cur.Versions[len(cur.Versions)-1].DeletedAt = txID
    }
    cur.Versions = append(cur.Versions, Version{Value: v, CreatedAt: txID})
    t.bt.ReplaceOrInsert(cur)
}

func (t *Tree) Read(k int, txID int64) (int, bool) {
    t.mu.Lock()
    defer t.mu.Unlock()
    it, ok := t.bt.Get(VersionedItem{Key: k})
    if !ok {
        return 0, false
    }
    // Walk versions to find the one visible at txID.
    for i := len(it.Versions) - 1; i >= 0; i-- {
        v := it.Versions[i]
        if v.CreatedAt <= txID && (v.DeletedAt == 0 || v.DeletedAt > txID) {
            return v.Value, true
        }
    }
    return 0, false
}
```

This is the basic shape. Real MVCC adds garbage collection (drop versions older than the oldest active transaction), index-only scans, snapshot isolation correctness arguments, etc. Out of scope for middle, but it shows how to layer versions on top of a concurrent tree.

---

## Appendix G: Testing race conditions thoroughly

Concurrent code needs special test infrastructure. A few tricks:

### Stress test harness

```go
func stress(t *testing.T, do func(g int)) {
    const goroutines = 32
    const iterations = 100_000
    var wg sync.WaitGroup
    for g := 0; g < goroutines; g++ {
        wg.Add(1)
        go func(g int) {
            defer wg.Done()
            for i := 0; i < iterations; i++ {
                do(g)
            }
        }(g)
    }
    wg.Wait()
}
```

Always run such tests with `-race`. The race detector instrumentation makes the test slower (and sometimes catches different races than non-instrumented runs would expose), so also run a second pass without `-race` to confirm correctness under realistic speeds.

### Sleep injection

To deliberately expose race windows, you can inject `runtime.Gosched()` or `time.Sleep` calls in your code, hidden behind a `test` build tag:

```go
//go:build raceinject
// +build raceinject

package mytree

import "runtime"

func injectYield() { runtime.Gosched() }
```

```go
//go:build !raceinject
// +build !raceinject

package mytree

func injectYield() {}
```

Sprinkle `injectYield()` in places where a race might lurk, and run the test suite with `-tags raceinject -race`. Many subtle bugs surface only with these yields.

### TLA+ or model checking

For really tricky protocols (B-link, OCC, RCU), the gold standard is to model them in TLA+ or in a tool like `runtime.deadlock`. This is overkill for most Go code but appears in serious database work.

---

## Appendix H: A note on `sync.Pool` and freelists

A `sync.Pool` can reduce GC pressure if your tree churns nodes:

```go
var nodePool = sync.Pool{
    New: func() any { return &Node{} },
}

func newNode() *Node {
    n := nodePool.Get().(*Node)
    *n = Node{}
    return n
}

func freeNode(n *Node) {
    nodePool.Put(n)
}
```

For *single-threaded* trees (with external mutex), this is straightforward. For COW trees, it is dangerous: an old node may still be reachable from a held snapshot, and putting it back in the pool risks reuse-while-in-use. Only use `sync.Pool` if you can prove no one still holds the old node — usually after an explicit epoch advance.

Modern Go's GC is fast enough that `sync.Pool` is rarely worth the risk for tree nodes. Profile first.

---

## Appendix I: Combining patterns

You will often combine several techniques. Some classic combinations:

- **Sharded + COW.** N shards, each is a publish/subscribe COW tree. Point access scales linearly with shards; range queries within a shard are still lock-free.
- **Hand-over-hand + B-link.** PostgreSQL-style. Latches are coupled top-down; splits are visible via right-sibling pointers.
- **OCC + B-link.** OLFIT / Masstree style. Readers lock nothing; writers latch one node at a time; B-link handles splits.
- **MVCC + COW.** Most modern databases. Each key has multiple versions; the index is COW so old snapshots remain readable.
- **RCU + epoch reclamation.** Linux kernel style. Pointers are swapped atomically; old memory is freed once all epochs that could see it have ended.

In Go, the **sharded + COW** combo is unreasonably effective. It is simple, scales, and uses standard library primitives only.

---

## Appendix J: A long worked example — versioned key-value store

Let's combine sharding, COW, and per-key versioning into one production-realistic component.

```go
package vkv

import (
    "hash/maphash"
    "sync"
    "sync/atomic"

    "github.com/tidwall/btree"
)

const NShards = 16

type Item struct {
    Key     string
    Value   string
    Version int64
}

func less(a, b Item) bool { return a.Key < b.Key }

type shard struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
    version  atomic.Int64
}

type Store struct {
    shards [NShards]shard
    seed   maphash.Seed
}

func New() *Store {
    s := &Store{seed: maphash.MakeSeed()}
    for i := range s.shards {
        s.shards[i].live = btree.NewBTreeG[Item](less)
        s.shards[i].snapshot.Store(s.shards[i].live.Copy())
    }
    return s
}

func (s *Store) hashShard(k string) *shard {
    var h maphash.Hash
    h.SetSeed(s.seed)
    h.WriteString(k)
    return &s.shards[h.Sum64()%NShards]
}

func (s *Store) Set(key, value string) int64 {
    sh := s.hashShard(key)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    v := sh.version.Add(1)
    sh.live.Set(Item{Key: key, Value: value, Version: v})
    sh.snapshot.Store(sh.live.Copy())
    return v
}

func (s *Store) Get(key string) (string, int64, bool) {
    sh := s.hashShard(key)
    snap := sh.snapshot.Load()
    it, ok := snap.Get(Item{Key: key})
    if !ok {
        return "", 0, false
    }
    return it.Value, it.Version, true
}

// Watch waits until the value for key has version > sinceVersion.
// Polling implementation. Real code would use a per-key cond var.
func (s *Store) Watch(key string, sinceVersion int64) string {
    sh := s.hashShard(key)
    for {
        snap := sh.snapshot.Load()
        if it, ok := snap.Get(Item{Key: key}); ok && it.Version > sinceVersion {
            return it.Value
        }
        // back off; in production use a cond var
    }
}

// SnapshotAll returns a slice of snapshots, one per shard, for a global
// point-in-time consistent read.
func (s *Store) SnapshotAll() [NShards]*btree.BTreeG[Item] {
    var out [NShards]*btree.BTreeG[Item]
    for i := range s.shards {
        out[i] = s.shards[i].snapshot.Load()
    }
    return out
}
```

This is a complete, real, production-grade pattern in well under 100 lines. It:

- Scales writes linearly with `NShards` for uncorrelated keys.
- Has lock-free reads via the published snapshot.
- Returns per-key versions for optimistic update protocols.
- Supports point-in-time "see everything at this moment" reads via `SnapshotAll`.

Many production Go systems run a variant of this exact pattern. Internalizing it is the goal of the middle file.

---

## Appendix K: When the lock *is* the workload

A counterintuitive performance tip: sometimes the right answer is to *not* try to be more concurrent. Some workloads are inherently serial:

- Writing to a strongly consistent log.
- Allocating a unique ID.
- Promoting one of N candidates to leader.

For these, a single `Mutex` + a single goroutine is the correct architecture. Trying to make the tree concurrent does not help if the work that protects the tree is itself serial.

A useful heuristic: if your goroutines spend most of their time *outside* the tree, then making the tree more concurrent helps. If they spend most of their time *inside* it, you need to fix the workload first.

---

## Appendix L: Benchmarking concurrent trees

Three things to benchmark, in this order:

1. **Single-threaded throughput.** Eliminates concurrency cost. Baseline.
2. **Read-only multi-threaded.** Tests read-path scalability.
3. **Mixed multi-threaded.** Realistic workload.

Skeleton:

```go
func BenchmarkSingle(b *testing.B) {
    tr := New()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        tr.Set(i, i)
    }
}

func BenchmarkReadOnly(b *testing.B) {
    tr := New()
    for i := 0; i < 100_000; i++ {
        tr.Set(i, i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            tr.Get(r.Intn(100_000))
        }
    })
}

func BenchmarkMixed(b *testing.B) {
    tr := New()
    for i := 0; i < 100_000; i++ {
        tr.Set(i, i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := r.Intn(100_000)
            if r.Intn(10) == 0 {
                tr.Set(k, k)
            } else {
                tr.Get(k)
            }
        }
    })
}
```

Run with `-cpu=1,2,4,8,16,32` to see how throughput scales with core count. Plot the curves; the shape tells you whether you have a serial bottleneck (flat) or are scaling cleanly (linear) or hitting cache thrashing (down-sloping).

---

## Appendix M: Real shape of the publish/subscribe wait-free reader

A reader's hot path in publish/subscribe COW:

```
load: snap := s.snapshot.Load()       // 1 atomic load
walk: n := snap.root; while n != nil { ... }  // pure pointer chases
```

That's it. Two cache-line reads to load the snapshot pointer and the root, then `O(log n)` cache-line reads down the tree. No mutex acquisition, no memory barrier, no CAS. On modern hardware this clocks under 100 ns for trees that fit in L2.

Now look at a single-Mutex reader's hot path:

```
lock: s.mu.Lock()                     // atomic CAS, memory barrier
walk: n := s.bt.root; while n != nil { ... }  // pointer chases
unlock: s.mu.Unlock()                 // atomic store
```

The lock + unlock cost is ~30 ns on uncontended runs but climbs into the *microseconds* under heavy contention because the CPU has to invalidate caches across cores. The COW reader's cost is independent of writer activity — it does not even know there is a writer.

This is why publish/subscribe COW reads scale linearly with cores in real benchmarks.

---

## Appendix N: When COW is the wrong default

A few honest cases where COW disappoints:

- **Writers are 50%+ of operations.** The snapshot cost dominates. A `Mutex`-only tree may win.
- **Writes touch nearly all keys per second.** Allocation rate is too high; GC pressure dominates.
- **Memory is tight.** Snapshots pin memory; COW doubles the working set during a publish.
- **You need strict freshness.** "I just wrote X; my next read must see X." With publish/subscribe, that's true only if you re-`Load()` after the `Set` returns. Possible but a foot-gun.

The middle-level engineer's job is to recognize these cases and switch to a different pattern (hand-over-hand, OCC, or just `Mutex`) when COW would hurt.

---

## Appendix O: Wrap-up

You have learned four orthogonal techniques:

1. **Hand-over-hand**: per-node locks; readers and writers walk down the tree holding at most two locks.
2. **Optimistic**: per-node version counters; readers traverse lock-free and validate on completion.
3. **Copy-on-write**: writers produce a new tree by path copying; readers see immutable snapshots; publish via `atomic.Pointer`.
4. **B-link**: right-sibling pointers let readers tolerate concurrent splits.

In Go, the simplest combination — single-writer `Mutex` + COW + `atomic.Pointer` publish — handles 90% of real workloads with lock-free reads and excellent throughput. Use the others when measurement demands it.

The next file (`senior.md`) extends this into latching protocols, full RCU with epoch reclamation, MVCC integration, the Lehman-Yao paper in implementation detail, and a tour of how PostgreSQL, BoltDB, and CockroachDB actually do it.

---

## Appendix P: A pure-Go OCC BST end-to-end

To make OCC less abstract, here is a complete, runnable BST that uses version-counter optimism for reads:

```go
package occbst

import (
    "runtime"
    "sync"
    "sync/atomic"
)

type Node struct {
    version uint64 // odd = writer in flight
    writeMu sync.Mutex
    key     int
    value   int
    left    *Node
    right   *Node
}

type Tree struct {
    rootMu sync.Mutex
    root   atomic.Pointer[Node]
}

func New() *Tree {
    return &Tree{}
}

func (n *Node) beginWrite() {
    n.writeMu.Lock()
    atomic.AddUint64(&n.version, 1) // now odd
}

func (n *Node) endWrite() {
    atomic.AddUint64(&n.version, 1) // now even
    n.writeMu.Unlock()
}

func (t *Tree) Get(k int) (int, bool) {
    for retries := 0; retries < 64; retries++ {
        n := t.root.Load()
        if n == nil {
            return 0, false
        }
    walk:
        for n != nil {
            v1 := atomic.LoadUint64(&n.version)
            if v1&1 == 1 {
                runtime.Gosched()
                break walk // retry from current root
            }
            key := n.key
            val := n.value
            left := n.left
            right := n.right
            v2 := atomic.LoadUint64(&n.version)
            if v2 != v1 {
                break walk // retry
            }
            switch {
            case k < key:
                n = left
            case k > key:
                n = right
            default:
                return val, true
            }
        }
        if n != nil {
            continue
        }
        return 0, false
    }
    // Final fallback: under enormous contention, take the root lock.
    t.rootMu.Lock()
    defer t.rootMu.Unlock()
    n := t.root.Load()
    for n != nil {
        switch {
        case k < n.key:
            n = n.left
        case k > n.key:
            n = n.right
        default:
            return n.value, true
        }
    }
    return 0, false
}

func (t *Tree) Set(k, v int) {
    t.rootMu.Lock()
    defer t.rootMu.Unlock()
    n := t.root.Load()
    if n == nil {
        t.root.Store(&Node{key: k, value: v})
        return
    }
    parent := n
    for {
        if k < parent.key {
            if parent.left == nil {
                parent.beginWrite()
                parent.left = &Node{key: k, value: v}
                parent.endWrite()
                return
            }
            parent = parent.left
        } else if k > parent.key {
            if parent.right == nil {
                parent.beginWrite()
                parent.right = &Node{key: k, value: v}
                parent.endWrite()
                return
            }
            parent = parent.right
        } else {
            parent.beginWrite()
            parent.value = v
            parent.endWrite()
            return
        }
    }
}
```

What this demonstrates:

- Reads do not touch `writeMu` at all.
- Reads validate version before *and* after the per-node read.
- An odd version means "writer in flight," readers back off and restart.
- Writers serialize globally via `rootMu` (this is a simplification — real OCC has finer-grained writer locking).
- A bounded retry count prevents infinite loops under pathological writer storms; the fallback acquires the root lock and walks safely.

This is a 100-line, runnable OCC BST. It is not as fast as a COW BST in Go (the atomic operations on `version` are not free), but it shows the protocol clearly.

For a B-tree, you would combine this with B-link sibling pointers to handle splits. The result is OLFIT, which is what high-performance database in-memory indexes (HyPer, Hekaton, Masstree) use.

---

## Appendix Q: A timing diagram of three readers and one writer in publish/subscribe

```
time  --->

writer:    S(it1)|S(it2)|S(it3)
            |     |     |
            Copy  Copy  Copy
            |     |     |
            v     v     v
snapshot:  v1    v2    v3
            ^     ^     ^
reader1:    L----------->done
reader2:           L----->done
reader3:                  L----->done
```

`L` = `Load` of the snapshot pointer. After `L`, the reader does its own pointer chase. The reader's view is *exactly* the snapshot at the moment of `L`. Different readers may have different views. None of them block any other or any writer.

If a reader holds its loaded snapshot for a long time (e.g., during a long export), the GC keeps that snapshot's structure alive. Eventually the export finishes and the snapshot is collected.

---

## Appendix R: Choosing between hand-over-hand and COW

Both are valid middle-level techniques. Some heuristics:

| Property | Hand-over-hand | COW publish/subscribe |
|----------|----------------|-----------------------|
| Read latency | 2 lock ops per level | 1 atomic load + walk |
| Write latency | path-locks + writes | path-copy + 1 atomic store |
| Memory overhead | mutex per node (24B each) | snapshots while held |
| GC pressure | low | medium (clones per write) |
| Implementation complexity | high | medium |
| Range query | works | works (lock-free!) |
| Snapshot | not natural | trivially natural |
| Strict read-your-writes | yes | requires explicit reload |

In Go, **COW publish/subscribe wins on the read path almost always** (lock-free!), at the cost of more memory and GC pressure. If reads are 99% of the workload — and they usually are — COW is the right default.

Hand-over-hand wins when:

- The tree is huge (memory matters more than copies).
- Writes are frequent enough that COW allocation hurts.
- You need strict point-in-time consistency on writes that COW only gives via reload.

---

## Appendix S: Reading list

- *The Art of Multiprocessor Programming*, Herlihy & Shavit, chapter on concurrent search trees.
- The OLFIT paper (Cha et al., 2001).
- The MassTree paper (Mao et al., 2012).
- The Bw-Tree paper (Levandoski et al., 2013) — covered in senior/professional.
- `tidwall/btree` source — about 1500 lines of very readable Go.
- `google/btree` source — about 1000 lines of very readable Go.
- PostgreSQL `src/backend/access/nbtree/README` — describes the B-link protocol as actually used in a production database.
- `bbolt` source — read `bucket.go` and `node.go` for a single-writer MVCC B+-tree on disk.

---

## Appendix T: A short story about a Postgres B-tree bug

In 2015, PostgreSQL had a multi-year-known bug in its B-tree concurrent split protocol. A race between a deleting backend and a vacuuming worker could leave the tree with a brief inconsistency: a leaf could be marked deleted while its parent still pointed to it.

The fix (commit `efada2b8a6` in 2015) tightened the latching protocol around `_bt_unlink_halfdead_page` and added an extra crosscheck. The bug had been mostly invisible because PostgreSQL's vacuum is rare and the race window was small, but corrupting an index in production is unacceptable.

Two takeaways:

1. **Even excellent teams ship subtle concurrent B-tree bugs.** Be humble.
2. **Reading the protocol once is not enough.** You need invariant checks at every step.

Production-grade concurrent trees are *engineered* over years. Use a library.

---

## Appendix U: What goes into the senior file

You have now seen the building blocks. The senior file builds production-engineering-grade systems out of them:

- The Lehman-Yao protocol in implementation depth.
- Latch crabbing on a B+-tree with separate latches for leaves and internal nodes.
- MVCC integrated with the COW snapshot mechanism.
- RCU + epoch reclamation in C-like detail (and why Go does not need it).
- Immutable persistent trees (Hash Array Mapped Tries, finger trees, ropes — briefly).
- A walking tour of PostgreSQL nbtree, InnoDB index, BoltDB / bbolt, CockroachDB Pebble.

The professional file then climbs into Bw-trees, concurrent ART, hardware transactional memory, and Hekaton.

For now: pause, build the publish/subscribe `Store` from Appendix J, test it under `-race`, benchmark it. When the throughput curve looks the way you expect, move on.

---

## Appendix V: Mid-level interview questions

Practice answering aloud:

1. Compare hand-over-hand to COW for a B-tree with 10M entries and 1000 writes/sec.
2. Why does B-link allow lock-free reads when concurrent splits are possible?
3. In Go, why is RCU "simpler" than in C?
4. What is the worst-case allocation rate of COW for a balanced BST under continuous writes?
5. How does `tidwall/btree.Copy()` cost stay `O(1)` if the tree has millions of items?
6. Why must writers serialize on a `Mutex` in publish/subscribe COW?
7. What is the danger of `RWMutex` if writes are frequent?
8. Why do OCC readers need to check the version twice (before and after)?
9. What happens if an OCC reader sees the version is odd?
10. Why does sharding combine well with COW?

Reasoning aloud through these is the test of middle-level mastery.

---

## Appendix W: Closing

You can now build:

- A publish/subscribe COW tree with lock-free reads.
- A hand-over-hand B-tree from scratch.
- An OCC BST with version counters.
- A sharded + COW store that scales to many cores.

You understand the trade-offs between approaches, and you know which to reach for first. That is the middle level.

Take a break, build something real, then come back for the senior file when you want to learn how database engines do it for keeps.

---

## Appendix X: Anatomy of a `tidwall/btree` Copy

Worth walking through carefully. When you call `tr.Copy()`:

1. The library bumps the root node's refcount from 1 to 2.
2. Returns a new `*BTreeG[T]` whose root pointer is the same as `tr`'s root pointer.

That is the entire `Copy` cost: one increment and one struct allocation. `O(1)`.

When you next call `tr.Set(it)`:

1. Walk from root toward the insertion point.
2. At each step, check the node's refcount. If `> 1`, clone the node (and decrement the original's refcount).
3. Update the parent's child pointer to point to the cloned child.
4. Insert into the leaf.

If the path-copied nodes are all `refcount == 1`, this degenerates to a normal in-place update. So sequential writes to a tree that has not been `Copy`'d are as fast as a non-COW tree.

The clone path only triggers for nodes shared with a snapshot. As long as snapshots are short-lived, the amortized COW cost is small.

Implications:

- Each snapshot's lifetime extends the time during which writes pay the COW penalty.
- Long-held snapshots (e.g., debug exports, backups) make subsequent writes slower until the snapshot is collected.
- For very long snapshots, consider periodically dropping and re-acquiring to let the live tree converge to refcount-1 again.

This refcount-based COW is the secret sauce that makes `tidwall/btree.Copy()` practical at high write rates with occasional snapshots.

---

## Appendix Y: A walkthrough of `google/btree`'s `Clone` semantics

`google/btree.BTreeG[T].Clone()` is similar but slightly different:

1. Increments the refcount on the root and all its children.
2. Returns a new `*BTreeG[T]` pointing to the same root.

The cost is `O(1)` allocation but `O(B)` refcount increments on the root's direct children. Subsequent writes path-copy whenever they encounter a shared node.

Both libraries' approaches are correct; `tidwall/btree` is slightly more efficient for the `Copy + many writes` pattern, while `google/btree` is slightly more efficient for the `Clone + few writes + iterate` pattern.

---

## Appendix Z: Deeper benchmarks

Here is a comparison framework you can use to measure the throughput curves of:

- Plain `sync.Mutex` + `google/btree`
- `sync.RWMutex` + `google/btree`
- Publish/subscribe COW + `tidwall/btree`
- Sharded `sync.Mutex` + `google/btree`

```go
package compare_test

import (
    "math/rand"
    "sync"
    "sync/atomic"
    "testing"

    gbt "github.com/google/btree"
    tbt "github.com/tidwall/btree"
)

type item struct{ k, v int }

func lessG(a, b item) bool { return a.k < b.k }
func lessT(a, b item) bool { return a.k < b.k }

// ---------- baseline: Mutex + google ----------
type mutexStore struct {
    mu sync.Mutex
    bt *gbt.BTreeG[item]
}

func newMutex() *mutexStore {
    return &mutexStore{bt: gbt.NewG[item](32, lessG)}
}

func (s *mutexStore) Set(it item) {
    s.mu.Lock()
    s.bt.ReplaceOrInsert(it)
    s.mu.Unlock()
}

func (s *mutexStore) Get(k int) (item, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.bt.Get(item{k: k})
}

// ---------- RWMutex + google ----------
type rwStore struct {
    mu sync.RWMutex
    bt *gbt.BTreeG[item]
}

func newRW() *rwStore {
    return &rwStore{bt: gbt.NewG[item](32, lessG)}
}

func (s *rwStore) Set(it item) {
    s.mu.Lock()
    s.bt.ReplaceOrInsert(it)
    s.mu.Unlock()
}

func (s *rwStore) Get(k int) (item, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.bt.Get(item{k: k})
}

// ---------- COW publish/subscribe + tidwall ----------
type cowStore struct {
    mu       sync.Mutex
    live     *tbt.BTreeG[item]
    snapshot atomic.Pointer[tbt.BTreeG[item]]
}

func newCOW() *cowStore {
    s := &cowStore{live: tbt.NewBTreeG[item](lessT)}
    s.snapshot.Store(s.live.Copy())
    return s
}

func (s *cowStore) Set(it item) {
    s.mu.Lock()
    s.live.Set(it)
    s.snapshot.Store(s.live.Copy())
    s.mu.Unlock()
}

func (s *cowStore) Get(k int) (item, bool) {
    return s.snapshot.Load().Get(item{k: k})
}

// ---------- sharded ----------
type shard struct {
    mu sync.Mutex
    bt *gbt.BTreeG[item]
}

type shardedStore struct {
    shards [16]shard
}

func newSharded() *shardedStore {
    var s shardedStore
    for i := range s.shards {
        s.shards[i].bt = gbt.NewG[item](32, lessG)
    }
    return &s
}

func (s *shardedStore) shard(k int) *shard { return &s.shards[uint(k)%16] }

func (s *shardedStore) Set(it item) {
    sh := s.shard(it.k)
    sh.mu.Lock()
    sh.bt.ReplaceOrInsert(it)
    sh.mu.Unlock()
}

func (s *shardedStore) Get(k int) (item, bool) {
    sh := s.shard(k)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    return sh.bt.Get(item{k: k})
}

// Common benchmark driver.
func benchmarkRead(b *testing.B, prepare func() (set func(int), get func(int))) {
    set, get := prepare()
    for i := 0; i < 100_000; i++ {
        set(i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            get(r.Intn(100_000))
        }
    })
}

func benchmarkMixed(b *testing.B, ratio int, prepare func() (set func(int), get func(int))) {
    set, get := prepare()
    for i := 0; i < 100_000; i++ {
        set(i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := r.Intn(100_000)
            if r.Intn(ratio) == 0 {
                set(k)
            } else {
                get(k)
            }
        }
    })
}

func mutexPrepare() (func(int), func(int)) {
    s := newMutex()
    return func(k int) { s.Set(item{k: k}) }, func(k int) { s.Get(k) }
}
func rwPrepare() (func(int), func(int)) {
    s := newRW()
    return func(k int) { s.Set(item{k: k}) }, func(k int) { s.Get(k) }
}
func cowPrepare() (func(int), func(int)) {
    s := newCOW()
    return func(k int) { s.Set(item{k: k}) }, func(k int) { s.Get(k) }
}
func shardedPrepare() (func(int), func(int)) {
    s := newSharded()
    return func(k int) { s.Set(item{k: k}) }, func(k int) { s.Get(k) }
}

func BenchmarkReadMutex(b *testing.B)   { benchmarkRead(b, mutexPrepare) }
func BenchmarkReadRW(b *testing.B)      { benchmarkRead(b, rwPrepare) }
func BenchmarkReadCOW(b *testing.B)     { benchmarkRead(b, cowPrepare) }
func BenchmarkReadSharded(b *testing.B) { benchmarkRead(b, shardedPrepare) }

func BenchmarkMixed10Mutex(b *testing.B)   { benchmarkMixed(b, 10, mutexPrepare) }
func BenchmarkMixed10RW(b *testing.B)      { benchmarkMixed(b, 10, rwPrepare) }
func BenchmarkMixed10COW(b *testing.B)     { benchmarkMixed(b, 10, cowPrepare) }
func BenchmarkMixed10Sharded(b *testing.B) { benchmarkMixed(b, 10, shardedPrepare) }
```

Run `go test -bench=. -cpu=1,2,4,8,16 -benchtime=2s` and graph the results. A typical 2026 16-core machine shows:

- **Read-only:**
  - Mutex flat after ~2 cores.
  - RWMutex scales to ~8 cores, then flattens.
  - COW scales nearly linearly (limited only by memory bandwidth).
  - Sharded scales linearly until it hits 16 (saturates).
- **10% writes:**
  - Mutex flat at 1 core throughput.
  - RWMutex worse than Mutex because writers block readers.
  - COW scales decently but write cost dominates beyond ~8 cores.
  - Sharded scales near-linearly because writes spread across shards.

These graphs are why "publish/subscribe COW" is the default Go answer for ordered concurrent data, and why sharding is the answer when point-access dominates and range queries are rare.

---

## Appendix AA: A subtle bug in publish/subscribe

A common subtle bug:

```go
// WRONG
func (s *Store) BulkSet(items []Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, it := range items {
        s.live.Set(it)
        s.snapshot.Store(s.live.Copy())
    }
}
```

This works but is slow — it publishes a snapshot per item. Worse, intermediate snapshots are visible to readers, so a reader can see a partially applied batch.

Fix:

```go
func (s *Store) BulkSet(items []Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, it := range items {
        s.live.Set(it)
    }
    s.snapshot.Store(s.live.Copy())
}
```

Publish once at the end. Readers either see no items from the batch or all of them.

---

## Appendix AB: Lessons from real production

A few war stories drawn from real Go services that ship publish/subscribe COW trees:

- **A team had a memory leak.** The cause: a metrics endpoint that exposed `len(snapshot.Bytes())`. The endpoint kept a snapshot in a global for "compute later" but never released it. The snapshot's structural footprint kept hundreds of MB pinned. Fix: copy the size out and drop the snapshot.
- **A team had unexpected staleness.** Their `Publish` was inside a goroutine that ran on a 1-second timer, but their `Set` did not call `Publish` synchronously. Writes were not visible for up to 1 second. Fix: publish synchronously after each write *or* after each batch.
- **A team had unexpected high GC pressure.** They were calling `Copy()` after every `Set` in a hot loop that ran 100k times per second. Fix: batch.
- **A team had unexpected deadlock.** Their `Snapshot` method took the write mutex (to do the `Copy` safely), but a reader called `Snapshot` from inside an iteration callback. Fix: split into a "snapshot for read" path (no lock; just load the published one) and a "snapshot the live tree" path (rare).

All of these are middle-level bugs. They appear when an engineer who understands the pattern fails to think carefully about its edges.

---

## Appendix AC: Closing — the right shape

The default middle-level shape for a Go concurrent ordered store is:

```go
type Store struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
}

func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.live.Set(it)
    s.snapshot.Store(s.live.Copy())
}

func (s *Store) Get(k Key) (Item, bool) {
    return s.snapshot.Load().Get(Item{Key: k})
}

func (s *Store) Range(lo, hi Key, fn func(Item) bool) {
    s.snapshot.Load().Ascend(Item{Key: lo}, func(it Item) bool {
        if !lessKey(it.Key, hi) {
            return false
        }
        return fn(it)
    })
}
```

Internalize this 20-line snippet. It is the answer to a huge fraction of "I need a concurrent ordered map in Go" questions.

When you outgrow it — and you will know because pprof says so — graduate to the senior file.

---

## Appendix AD: A practical recipe — adapting the publish-subscribe pattern to a streaming workload

Many real services are not purely "set + get." They are streaming: events arrive, get indexed, and consumers tail the index.

```go
package eventindex

import (
    "sync"
    "sync/atomic"
    "time"

    "github.com/tidwall/btree"
)

type Event struct {
    TS  int64
    ID  string
    Tag string
}

func less(a, b Event) bool {
    if a.TS != b.TS {
        return a.TS < b.TS
    }
    return a.ID < b.ID
}

type Index struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Event]
    snapshot atomic.Pointer[btree.BTreeG[Event]]
    cond     *sync.Cond
    version  atomic.Int64
}

func New() *Index {
    s := &Index{live: btree.NewBTreeG[Event](less)}
    s.snapshot.Store(s.live.Copy())
    s.cond = sync.NewCond(&s.mu)
    return s
}

// Append adds events in bulk. Publishes one snapshot for the whole batch.
func (s *Index) Append(events []Event) {
    s.mu.Lock()
    for _, e := range events {
        s.live.Set(e)
    }
    s.snapshot.Store(s.live.Copy())
    s.version.Add(1)
    s.cond.Broadcast()
    s.mu.Unlock()
}

// Since returns events with TS >= sinceTS, blocking up to timeout if there are none.
func (s *Index) Since(sinceTS int64, timeout time.Duration) []Event {
    deadline := time.Now().Add(timeout)
    for {
        snap := s.snapshot.Load()
        var out []Event
        snap.Ascend(Event{TS: sinceTS}, func(e Event) bool {
            out = append(out, e)
            return true
        })
        if len(out) > 0 {
            return out
        }
        s.mu.Lock()
        if s.snapshot.Load() != snap {
            s.mu.Unlock()
            continue
        }
        // Wait for next publish or timeout.
        timer := time.AfterFunc(time.Until(deadline), func() { s.cond.Broadcast() })
        s.cond.Wait()
        timer.Stop()
        s.mu.Unlock()
        if time.Now().After(deadline) {
            return nil
        }
    }
}
```

A few subtle points:

- The `cond` is signaled inside the same critical section that publishes the snapshot. Readers waiting in `Since` will be woken.
- Readers re-check the snapshot pointer after taking the mutex to avoid a missed wake-up.
- `time.AfterFunc` triggers the broadcast on timeout so the reader can wake up and return empty.

This is essentially a "tail -f" backed by a concurrent tree. Real services use this pattern for live dashboards, event streams, and cursor-based pagination.

---

## Appendix AE: Mixing patterns — sharded publish/subscribe + per-shard cond vars

For high-throughput streaming with many subscribers, combine sharding with per-shard cond vars:

```go
type Shard struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Event]
    snapshot atomic.Pointer[btree.BTreeG[Event]]
    cond     *sync.Cond
    version  atomic.Int64
}

type ShardedIndex struct {
    shards [16]Shard
    seed   maphash.Seed
}

// One subscriber per shard means N goroutines, but reads are completely
// independent — no cross-shard contention.
```

This pattern shows up in real systems that ingest millions of events per second and serve thousands of concurrent subscribers. The arithmetic works because:

- Sharding eliminates write contention.
- Publish/subscribe eliminates read locks.
- Per-shard cond vars eliminate cross-shard wakeups.

The result is a 16-shard system that does 16 independent things at once, each performing one publish/subscribe COW tree.

---

## Appendix AF: A final mental model

Picture concurrent trees as a *publication system*.

- A writer produces a *version* of the tree.
- A reader subscribes to a version (the latest one when they `Load`).
- Once subscribed, the reader can read at leisure; their version is immutable.
- New versions appear; old versions remain alive until no reader holds them.
- The garbage collector reclaims orphan versions.

This is the right mental model for middle-level concurrent trees in Go. Hand-over-hand and OCC are special-purpose alternatives; COW publish/subscribe is the rule.

Once you internalize this, the senior file's deeper material — MVCC, RCU, full Lehman-Yao, the Bw-tree — becomes a series of refinements to the same idea, not a new world.

Welcome to the middle. Onward to senior.

---

## Appendix AG: An LRU cache built on a concurrent tree + map

A classical concurrent LRU is a doubly-linked list + map. But with a tree, you get something more flexible: ordered by access time, with `O(log n)` "evict oldest" and `O(log n)` "promote to most recent."

```go
package treelru

import (
    "sync"
    "sync/atomic"

    "github.com/tidwall/btree"
)

type Entry struct {
    Key        string
    Value      string
    LastAccess int64 // logical timestamp
}

func less(a, b Entry) bool {
    if a.LastAccess != b.LastAccess {
        return a.LastAccess < b.LastAccess
    }
    return a.Key < b.Key
}

type LRU struct {
    mu      sync.Mutex
    bt      *btree.BTreeG[Entry]
    byKey   map[string]Entry
    cap     int
    counter atomic.Int64
}

func New(cap int) *LRU {
    return &LRU{
        bt:    btree.NewBTreeG[Entry](less),
        byKey: make(map[string]Entry, cap),
        cap:   cap,
    }
}

func (l *LRU) Set(key, value string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    ts := l.counter.Add(1)
    if old, ok := l.byKey[key]; ok {
        l.bt.Delete(old)
    }
    e := Entry{Key: key, Value: value, LastAccess: ts}
    l.bt.Set(e)
    l.byKey[key] = e
    for len(l.byKey) > l.cap {
        oldest, _ := l.bt.Min()
        l.bt.Delete(oldest)
        delete(l.byKey, oldest.Key)
    }
}

func (l *LRU) Get(key string) (string, bool) {
    l.mu.Lock()
    defer l.mu.Unlock()
    e, ok := l.byKey[key]
    if !ok {
        return "", false
    }
    l.bt.Delete(e)
    e.LastAccess = l.counter.Add(1)
    l.bt.Set(e)
    l.byKey[key] = e
    return e.Value, true
}
```

What this gives you that a list-based LRU doesn't:

- **Tied-by-time tie-breaker is built in via the comparator.**
- **You can ask "what are the 10 oldest entries?" in `O(log n + 10)`.**
- **You can ask "what entries were accessed before time T?" via `AscendLessThan`.**

The downside: `Get` is no longer `O(1)` — it's `O(log n)` because of the tree update. Trade-off worth making if you ever want to introspect access patterns.

Combine this with publish/subscribe for a read-mostly cache where `Get` from the snapshot avoids the lock entirely (at the cost of not updating `LastAccess` for reads, which may or may not be what you want).

---

## Appendix AH: A persistent (immutable) tree from scratch

Sometimes you want a *fully* immutable tree — one that supports `O(log n)` `Insert` returning a new tree, with no mutation of any shared state. Useful for:

- Functional-style code.
- Multi-version reads where every version is a first-class value.
- Time-travel debugging.

```go
package immutable

type Tree struct {
    root *node
}

type node struct {
    key         int
    value       int
    left, right *node
    height      int
}

func (t Tree) Insert(k, v int) Tree {
    return Tree{root: insert(t.root, k, v)}
}

func insert(n *node, k, v int) *node {
    if n == nil {
        return &node{key: k, value: v, height: 1}
    }
    if k < n.key {
        return rebalance(&node{
            key: n.key, value: n.value,
            left:  insert(n.left, k, v),
            right: n.right,
        })
    }
    if k > n.key {
        return rebalance(&node{
            key: n.key, value: n.value,
            left:  n.left,
            right: insert(n.right, k, v),
        })
    }
    return &node{key: k, value: v, left: n.left, right: n.right, height: n.height}
}

func height(n *node) int {
    if n == nil {
        return 0
    }
    return n.height
}

func rebalance(n *node) *node {
    n.height = 1 + max(height(n.left), height(n.right))
    bf := height(n.left) - height(n.right)
    switch {
    case bf > 1 && height(n.left.left) >= height(n.left.right):
        return rotateRight(n)
    case bf > 1:
        n.left = rotateLeft(n.left)
        return rotateRight(n)
    case bf < -1 && height(n.right.right) >= height(n.right.left):
        return rotateLeft(n)
    case bf < -1:
        n.right = rotateRight(n.right)
        return rotateLeft(n)
    }
    return n
}

func rotateLeft(n *node) *node {
    r := n.right
    nl := &node{
        key: n.key, value: n.value,
        left:  n.left,
        right: r.left,
    }
    nl.height = 1 + max(height(nl.left), height(nl.right))
    return &node{
        key: r.key, value: r.value,
        left:  nl,
        right: r.right,
        height: 1 + max(nl.height, height(r.right)),
    }
}

func rotateRight(n *node) *node {
    l := n.left
    nr := &node{
        key: n.key, value: n.value,
        left:  l.right,
        right: n.right,
    }
    nr.height = 1 + max(height(nr.left), height(nr.right))
    return &node{
        key: l.key, value: l.value,
        left:  l.left,
        right: nr,
        height: 1 + max(height(l.left), nr.height),
    }
}
```

This is an immutable AVL tree. Every `Insert` returns a new tree. Existing trees are unchanged. Structural sharing means a series of inserts costs `O(log n)` per insert, not `O(n)`.

Use cases in Go:

- Replicate the in-memory state across versions for time-travel debugging.
- Pass tree-of-state snapshots between goroutines safely with no synchronization at all.
- Implement undo / redo by stashing old trees.

This is the same principle as `tidwall/btree.Copy()`, just baked into the type system: there is no mutable variant at all. Pure functional, fully concurrent for free.

---

## Appendix AI: A `sync.Cond`-based pub/sub variant

For workloads where readers want push notifications rather than polling, layer a `sync.Cond` over the snapshot:

```go
type PubStore struct {
    mu       sync.Mutex
    cond     *sync.Cond
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
    version  atomic.Int64
}

func NewPub() *PubStore {
    s := &PubStore{live: btree.NewBTreeG[Item](less)}
    s.snapshot.Store(s.live.Copy())
    s.cond = sync.NewCond(&s.mu)
    return s
}

func (s *PubStore) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.live.Set(it)
    s.snapshot.Store(s.live.Copy())
    s.version.Add(1)
    s.cond.Broadcast()
}

func (s *PubStore) WaitForVersion(min int64) {
    s.mu.Lock()
    for s.version.Load() < min {
        s.cond.Wait()
    }
    s.mu.Unlock()
}
```

Subscribers can block on a specific version and be woken when the next publish arrives. Useful for coordinated reads after writes ("write X, then notify all subscribers that the new state is visible").

---

## Appendix AJ: A summary diagram of techniques

```
                    +---------------------------+
                    |   ordered tree workloads  |
                    +-------------+-------------+
                                  |
            +---------------------+---------------------+
            |                     |                     |
       read-heavy             mixed                write-heavy
            |                     |                     |
            v                     v                     v
       +--------+         +-------------+         +-----------+
       |  COW   |         |    COW +    |         |  sharded  |
       |  pub/  |         |   sharded   |         |  RWMutex  |
       |  sub   |         |             |         |           |
       +--------+         +-------------+         +-----------+
            |                     |                     |
            v                     v                     v
       reads lock-free      ~16x scaling          ~16x scaling
       writes 1 mutex       both for r and w      writes mostly serial
```

The leftmost column (COW pub/sub) is the universal default. The middle column adds sharding for very high concurrency. The rightmost column is rarely needed in Go.

---

## Appendix AK: Final example — combined pattern with eviction

A complete, realistic, production-ready in-memory ordered store with publish/subscribe and TTL eviction:

```go
package store

import (
    "sync"
    "sync/atomic"
    "time"

    "github.com/tidwall/btree"
)

type Item struct {
    Key     string
    Value   any
    Expires time.Time
}

func less(a, b Item) bool { return a.Key < b.Key }
func expiresLess(a, b Item) bool {
    if !a.Expires.Equal(b.Expires) {
        return a.Expires.Before(b.Expires)
    }
    return a.Key < b.Key
}

type Store struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    byExp    *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
}

func New() *Store {
    s := &Store{
        live:  btree.NewBTreeG[Item](less),
        byExp: btree.NewBTreeG[Item](expiresLess),
    }
    s.snapshot.Store(s.live.Copy())
    return s
}

func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if old, ok := s.live.Get(it); ok {
        s.byExp.Delete(old)
    }
    s.live.Set(it)
    s.byExp.Set(it)
    s.snapshot.Store(s.live.Copy())
}

func (s *Store) Get(key string) (any, bool) {
    it, ok := s.snapshot.Load().Get(Item{Key: key})
    if !ok || time.Now().After(it.Expires) {
        return nil, false
    }
    return it.Value, true
}

// EvictExpired removes all items with Expires < now. Publishes one new snapshot.
func (s *Store) EvictExpired(now time.Time) int {
    s.mu.Lock()
    defer s.mu.Unlock()
    var toDelete []Item
    s.byExp.Ascend(Item{Expires: now.Add(-time.Hour)}, func(it Item) bool {
        if it.Expires.After(now) {
            return false
        }
        toDelete = append(toDelete, it)
        return true
    })
    for _, it := range toDelete {
        s.live.Delete(it)
        s.byExp.Delete(it)
    }
    if len(toDelete) > 0 {
        s.snapshot.Store(s.live.Copy())
    }
    return len(toDelete)
}
```

The two indexes (`live` by key, `byExp` by expiration time) share one mutex. `Get` does not touch the mutex at all — it reads the published snapshot. `EvictExpired` runs from a background ticker.

This is a 60-line, lock-free-on-reads, snapshot-isolated, TTL-aware concurrent ordered store. It would happily handle 100k-QPS reads on a single core, and 10k writes/sec with snapshot churn well within Go's GC budget.

When you have written this kind of code in your sleep, you are ready for the senior file.

---

## Appendix AL: Saying goodbye to one big lock, gracefully

A migration path from "one big mutex" to "publish/subscribe COW":

1. **Step 1: keep the mutex, add a snapshot.** Each `Set` calls `s.snapshot.Store(s.live.Copy())` while holding the mutex. `Get` reads the snapshot. *Now `Get` is lock-free.* (Existing readers that still take the mutex continue to work.)
2. **Step 2: remove the mutex from `Get`.** Update every caller to use the snapshot.
3. **Step 3: batch publishes.** Add a "dirty" flag and only publish when a batch is done.
4. **Step 4: optionally shard.** If write throughput is still an issue, shard.

Each step is incremental, testable, and can be deployed independently. Profile after each step.

---

## Appendix AM: Final summary

You can build:

- A hand-over-hand B-tree from scratch in ~150 lines (Appendix A).
- A COW BST with lock-free reads in ~50 lines (Appendix B).
- An OCC BST with version counters in ~100 lines (Appendix P).
- A complete publish/subscribe ordered store (Appendix AC, AK).
- A pub/sub variant with TTL eviction and dual indexes (Appendix AK).

You can choose between protocols by reasoning about your read/write ratio, snapshot needs, and memory budget.

You understand the difference between Go's GC making RCU trivial vs C's epoch reclamation pain.

You know when to reach for COW (almost always) vs hand-over-hand (rarely) vs OCC (rarely) vs RWMutex (for read-heavy with small trees).

You are ready for the senior file.





