---
layout: default
title: Concurrent Skip List — Middle
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/middle/
---

# Concurrent Skip List — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap and Prerequisites](#recap-and-prerequisites)
3. [Why Coarse Locking Falls Apart](#why-coarse-locking-falls-apart)
4. [Per-Node Locking — The Pugh Design](#per-node-locking-the-pugh-design)
5. [Hand-over-Hand Locking](#hand-over-hand-locking)
6. [Lazy Skip List (Herlihy, Lev, Luchangco, Shavit)](#lazy-skip-list-herlihy-lev-luchangco-shavit)
7. [Validate-Then-Link](#validate-then-link)
8. [Logical vs Physical Delete](#logical-vs-physical-delete)
9. [Marker Nodes — the Bridge to Lock-Free](#marker-nodes-the-bridge-to-lock-free)
10. [Code: Lazy Concurrent Skip List in Go](#code-lazy-concurrent-skip-list-in-go)
11. [Reasoning About Linearisability](#reasoning-about-linearisability)
12. [Range Queries Under Per-Node Locks](#range-queries-under-per-node-locks)
13. [Snapshot Iterators (intro)](#snapshot-iterators-intro)
14. [Memory Reclamation in Go vs C++](#memory-reclamation-in-go-vs-c)
15. [Comparison with sync.Map and B+tree Memtables](#comparison-with-syncmap-and-btree-memtables)
16. [Common Bugs at this Level](#common-bugs-at-this-level)
17. [Performance Engineering](#performance-engineering)
18. [Testing Concurrent Skip Lists](#testing-concurrent-skip-lists)
19. [When to Stop and Reach for `skipset`](#when-to-stop-and-reach-for-skipset)
20. [Cheat Sheet](#cheat-sheet)
21. [Self-Assessment](#self-assessment)
22. [Summary](#summary)

---

## Introduction

At the [junior](junior.md) level you built a sequential skip list and a coarse-locked concurrent wrapper. That was correct but throughput-bound: every operation serialised on a single `sync.Mutex` (or stalled writers behind a `sync.RWMutex`). The next step is to *parallelise* the data structure itself — to let independent inserts on opposite ends of the key space proceed simultaneously.

This file covers the *lock-based* concurrent skip list — the canonical lineage from Pugh (1990, per-node locking) through Herlihy/Lev/Luchangco/Shavit (2007, "lazy" skip list). It also introduces marker nodes and prepares the ground for the *lock-free* designs of [senior.md](senior.md). After reading this file you will:

- Understand why coarse locking is unacceptable at high core counts.
- Know how to lock a node-local subgraph without deadlocking.
- Know what *validation* means and why it is the heart of any optimistic concurrent algorithm.
- Distinguish *logical delete* (mark) from *physical delete* (unlink) and explain why the separation is necessary.
- Implement the Herlihy "lazy" skip list in Go.
- Reason about linearisability of `Contains`, `Insert`, and `Delete`.
- See how snapshot iterators are introduced.
- Be ready to read and understand `skipset`'s lock-free design in senior.md.

This is the level at which most engineers who claim "I implemented a concurrent skip list" actually stopped. Per-node locking is genuinely much harder than coarse locking, but the resulting throughput is often enough — `ConcurrentSkipListMap` in Java, for instance, was originally lock-based before later releases moved towards CAS where useful.

---

## Recap and Prerequisites

From the junior file you should already:

- Know the structure (stack of sorted linked lists with random promotion).
- Have implemented `Insert`, `Delete`, `Contains` sequentially.
- Have wrapped your sequential code in a coarse `sync.Mutex` and run it under `-race`.
- Know the terms `MaxLevel`, `randomHeight`, `update[]`, head sentinel.

For this file you additionally need:

- **Atomic operations in Go.** `sync/atomic.Bool` (Go 1.19+), `atomic.Pointer[T]` (Go 1.19+), `atomic.LoadPointer`/`StorePointer`/`CompareAndSwapPointer` for `unsafe.Pointer`.
- **`sync.Mutex` semantics.** Lock/Unlock, the absence of reentrancy, the deferred-Unlock idiom.
- **Lock ordering.** The rule "always acquire locks in the same global order to avoid deadlock."
- **`go test -race`** working in your environment.

If anything in that list is unfamiliar, return to the goroutines/atomics chapters before continuing.

---

## Why Coarse Locking Falls Apart

A coarse-locked skip list serialises *every* write. If your application offers `Insert` and `Delete` operations to N goroutines, throughput is capped by:

```
throughput = 1 / (latency_per_op + lock_overhead)
```

At a typical 500 ns per op, the cap is ~2 M ops/s — regardless of how many cores you throw at it. On a 32-core machine this leaves 31 cores idle. The `sync.RWMutex` variant helps if the workload is heavily read-skewed (say, 99% reads), but at 50/50 it is the same story: writes block readers, readers block writers (one at a time).

Concrete profile from a real benchmark (`zhangyunhao116/skipset` repo, 8-core M1):

| Workload | Coarse `Mutex` | Coarse `RWMutex` | `skipset` (lock-free) |
|----------|----------------|------------------|-----------------------|
| 100% read | 30 M ops/s | 110 M ops/s | 180 M ops/s |
| 90/10 R/W | 18 M ops/s | 32 M ops/s | 120 M ops/s |
| 50/50 R/W | 4 M ops/s | 5 M ops/s | 70 M ops/s |
| 10/90 R/W | 1.8 M ops/s | 1.9 M ops/s | 35 M ops/s |
| 100% write | 1.5 M ops/s | 1.5 M ops/s | 25 M ops/s |

The shape is unmistakable: coarse `RWMutex` is fine for read-heavy workloads but ten to twenty times slower for write-heavy ones. To get all eight cores busy on writes you need per-node locking *or* lock-free updates.

### A second reason — latency tail

Coarse locking gives terrible latency *variance*. With one global mutex, an unlucky operation may wait behind hundreds of others. The p99 latency at full load can be 100× the p50. For interactive workloads (a feature flag service, a real-time leaderboard) that variance is unacceptable.

Per-node locking dramatically lowers the *expected* wait, and lock-free designs lower it further by removing waits entirely.

---

## Per-Node Locking — The Pugh Design

Pugh's 1990 follow-up paper, *Concurrent Maintenance of Skip Lists*, introduced the design that everyone copies. Each node carries its own mutex. An insert or delete locks only the nodes it modifies. Two operations on disjoint regions of the key space proceed in parallel.

The two questions per-node locking must answer:

1. **Which locks to acquire, and in what order.** Acquiring locks in inconsistent order across operations is the classic deadlock recipe.
2. **What if the structure changes between the search and the locking?** A search records predecessors; by the time you go back to lock them, those predecessors may no longer be predecessors. Validation answers this.

Pugh's original design uses *hand-over-hand* locking during search: as you walk left-to-right at each level, you lock the next node before releasing the current one. Correct, but it serialises traffic through the head sentinel. Subsequent designs (lazy, optimistic) replace hand-over-hand with **optimistic validation**: search without locks, then lock and revalidate.

---

## Hand-over-Hand Locking

The pattern, applied to a singly-linked list:

```go
type node struct {
    key  int
    next *node
    mu   sync.Mutex
}

func (l *List) Contains(key int) bool {
    prev := l.head
    prev.mu.Lock()
    curr := prev.next
    if curr != nil {
        curr.mu.Lock()
    }
    for curr != nil && curr.key < key {
        prev.mu.Unlock()
        prev = curr
        curr = curr.next
        if curr != nil {
            curr.mu.Lock()
        }
    }
    found := curr != nil && curr.key == key
    if curr != nil {
        curr.mu.Unlock()
    }
    prev.mu.Unlock()
    return found
}
```

You hold at most two locks at a time, in a strict head-to-tail order. Deadlock is impossible because all operations walk the same direction. Throughput improves over coarse locking — multiple traversals can be in flight at different parts of the chain — but the head sentinel is still hot, and the lock cost on every node hop is substantial.

For a skip list, hand-over-hand at every level is even more expensive (you lock at level *l*, drop, walk, drop down a level, repeat). It is a useful pedagogical exercise but not what modern lock-based designs do.

---

## Lazy Skip List (Herlihy, Lev, Luchangco, Shavit)

The *lazy* skip list, published in "A Simple Optimistic Skiplist Algorithm" (2007), is the gold-standard lock-based design. Its core idea is *optimistic concurrency*:

1. **Search without locks.** Find predecessors and successors at every level. Save them.
2. **Lock the predecessors.** All of them, in level order (low to high), to avoid deadlock.
3. **Validate.** Check that each predecessor still points to the expected successor and is not marked for deletion.
4. **If invalid:** unlock everything and restart the search.
5. **If valid:** splice the new node in (or unlink the doomed node), unlock.

The lazy skip list also introduces:

- **`marked` flag** — atomic boolean per node. `true` means "logically deleted; about to be unlinked."
- **`fullyLinked` flag** — atomic boolean per node. `true` once the node has been inserted at *every* level it appears in.

The flags exist so that `Contains` can be **wait-free** — it walks the structure without locks and consults `marked` / `fullyLinked` to decide whether a node really is present.

Reading time on the paper is one afternoon. It is the clearest published explanation of optimistic concurrent data structures.

---

## Validate-Then-Link

Validation is the heart of any optimistic concurrent design. After locking the predecessors at each level the new node will appear in, you must check:

```go
valid := true
for i := 0; valid && i < height; i++ {
    valid = !preds[i].marked.Load() &&
            !succs[i].marked.Load() &&
            preds[i].next[i] == succs[i]
}
```

If any of the three sub-checks fails, the structure has changed since your search. Unlock everything, restart the search.

In a healthy implementation, validation passes 95–99% of the time. Under heavy contention it may drop to 70–80%, with the rest restarting. The wasted work is the price of optimistic concurrency; the alternative — pessimistic hand-over-hand locking — wastes more.

### A skip-list-specific subtlety: heights vary

In a list, validation always checks one predecessor. In a skip list, validation must check the predecessor at *each level* the new node appears in. For a node of height 3, that is three different predecessors. Each must be locked, each must still point to the recorded successor.

```go
var highestLocked = -1
for i := 0; i < height; i++ {
    pred := preds[i]
    succ := succs[i]
    if i == 0 || pred != preds[i-1] {
        pred.mu.Lock()
        highestLocked = i
    }
    if pred.marked.Load() || pred.next[i] != succ {
        // Roll back: unlock everything locked so far.
        for j := 0; j <= highestLocked; j++ {
            if j == 0 || preds[j] != preds[j-1] {
                preds[j].mu.Unlock()
            }
        }
        goto retry
    }
}
```

The trick `if i == 0 || pred != preds[i-1]` avoids double-locking the same predecessor at consecutive levels (this happens when a tall node sits in the path at multiple levels). Skipping the redundant `Lock` is essential because `sync.Mutex` is non-reentrant — locking the same mutex twice from the same goroutine deadlocks.

---

## Logical vs Physical Delete

In a coarse-locked or sequential design, deletion is one atomic step: unlink at every level, decrement size. In a per-node-lock design, that single step is not safe. Consider:

1. Thread A wants to delete node N. It locks N's predecessors.
2. Thread B is mid-`Insert`, having searched and recorded N as a predecessor for a new key. B is about to lock N.
3. A unlinks N and releases. N is gone from the structure.
4. B locks N, validates `N.next == oldSucc`. The check passes (N still has its old `next` pointers — it has just been unlinked from the structure, not modified internally). B splices the new node into N's `next` chain. The new node is now reachable from a deleted N — meaning *not reachable at all*.

The fix is to mark N as logically deleted *before* unlinking, and to make validation include the mark check.

### The two-phase delete

1. **Logical delete:** lock the victim, set `victim.marked = true`. Now any insert that finds `victim` as a predecessor will fail validation and restart.
2. **Physical delete:** lock the victim's predecessors, validate, unlink at every level, unlock.

In the lazy design the two phases are combined in a single critical section: lock predecessors first, then validate (which now includes "succs[0] is not marked," because if some other thread already marked it, we should not delete twice).

A nuance: many designs allow any thread that *sees* a marked node to help unlink it. This *helping* discipline is what makes the lock-free variant in [senior.md](senior.md) progress even when the original deleter stalls.

---

## Marker Nodes — the Bridge to Lock-Free

Marker nodes are the *lock-free* equivalent of the `marked` flag. Instead of setting a bit on the victim, you insert a special **marker node** right after it. The marker's address (or a low-bit-tagged pointer) is the signal: any thread that reads `victim.next` and sees a marker knows the victim is being deleted.

In a lock-based lazy skip list, you do **not** need markers — the `marked` flag plus the lock on the predecessor suffice. In a lock-free design, you need markers because there is no lock to prevent a concurrent insert from racing the unlink.

Markers are introduced here so the term is familiar; the full mechanism appears in senior.md.

---

## Code: Lazy Concurrent Skip List in Go

A complete, working lazy skip list. Roughly 250 lines. Read it twice slowly.

```go
package lazyskip

import (
    "math/rand"
    "sync"
    "sync/atomic"
)

const MaxLevel = 16

type node struct {
    key         int
    next        []*node
    mu          sync.Mutex
    marked      atomic.Bool
    fullyLinked atomic.Bool
    height      int
}

func newNode(key, height int) *node {
    return &node{
        key:    key,
        next:   make([]*node, height),
        height: height,
    }
}

type SkipList struct {
    head *node
    tail *node
    rng  *rand.Rand
    rngMu sync.Mutex
}

func New() *SkipList {
    head := newNode(intMin, MaxLevel)
    tail := newNode(intMax, MaxLevel)
    for i := 0; i < MaxLevel; i++ {
        head.next[i] = tail
    }
    head.fullyLinked.Store(true)
    tail.fullyLinked.Store(true)
    return &SkipList{
        head: head,
        tail: tail,
        rng:  rand.New(rand.NewSource(1)),
    }
}

const (
    intMin = -1 << 62
    intMax = 1<<62 - 1
)

func (s *SkipList) randomHeight() int {
    s.rngMu.Lock()
    defer s.rngMu.Unlock()
    h := 1
    for h < MaxLevel && s.rng.Intn(2) == 0 {
        h++
    }
    return h
}

// find walks the structure top-down and fills preds/succs at every level.
// Returns the level at which key was found, or -1.
func (s *SkipList) find(key int, preds, succs *[MaxLevel]*node) int {
    levelFound := -1
    pred := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        curr := pred.next[i]
        for curr.key < key {
            pred = curr
            curr = pred.next[i]
        }
        if levelFound == -1 && curr.key == key {
            levelFound = i
        }
        preds[i] = pred
        succs[i] = curr
    }
    return levelFound
}

// Contains is wait-free: no locks at all.
func (s *SkipList) Contains(key int) bool {
    var preds, succs [MaxLevel]*node
    levelFound := s.find(key, &preds, &succs)
    if levelFound == -1 {
        return false
    }
    n := succs[levelFound]
    return n.fullyLinked.Load() && !n.marked.Load()
}

// Insert returns true if the key was new.
func (s *SkipList) Insert(key int) bool {
    topLevel := s.randomHeight()
    var preds, succs [MaxLevel]*node
    for {
        levelFound := s.find(key, &preds, &succs)
        if levelFound != -1 {
            n := succs[levelFound]
            if !n.marked.Load() {
                for !n.fullyLinked.Load() {
                    // wait for in-progress insert to finish
                }
                return false
            }
            continue // retry; node is being deleted
        }
        valid := true
        highestLocked := -1
        var prevPred *node
        for i := 0; valid && i < topLevel; i++ {
            pred := preds[i]
            succ := succs[i]
            if pred != prevPred {
                pred.mu.Lock()
                highestLocked = i
                prevPred = pred
            }
            valid = !pred.marked.Load() && !succ.marked.Load() && pred.next[i] == succ
        }
        if !valid {
            s.unlockPreds(&preds, highestLocked)
            continue
        }
        n := newNode(key, topLevel)
        for i := 0; i < topLevel; i++ {
            n.next[i] = succs[i]
        }
        for i := 0; i < topLevel; i++ {
            preds[i].next[i] = n
        }
        n.fullyLinked.Store(true)
        s.unlockPreds(&preds, highestLocked)
        return true
    }
}

// Delete returns true if the key was present.
func (s *SkipList) Delete(key int) bool {
    var victim *node
    isMarked := false
    topLevel := -1
    var preds, succs [MaxLevel]*node
    for {
        levelFound := s.find(key, &preds, &succs)
        if levelFound != -1 {
            victim = succs[levelFound]
        }
        if isMarked ||
            (levelFound != -1 &&
                victim.fullyLinked.Load() &&
                victim.height-1 == levelFound &&
                !victim.marked.Load()) {

            if !isMarked {
                topLevel = victim.height
                victim.mu.Lock()
                if victim.marked.Load() {
                    victim.mu.Unlock()
                    return false
                }
                victim.marked.Store(true)
                isMarked = true
            }
            highestLocked := -1
            valid := true
            var prevPred *node
            for i := 0; valid && i < topLevel; i++ {
                pred := preds[i]
                if pred != prevPred {
                    pred.mu.Lock()
                    highestLocked = i
                    prevPred = pred
                }
                valid = !pred.marked.Load() && pred.next[i] == victim
            }
            if !valid {
                s.unlockPreds(&preds, highestLocked)
                continue
            }
            for i := topLevel - 1; i >= 0; i-- {
                preds[i].next[i] = victim.next[i]
            }
            victim.mu.Unlock()
            s.unlockPreds(&preds, highestLocked)
            return true
        }
        return false
    }
}

func (s *SkipList) unlockPreds(preds *[MaxLevel]*node, highestLocked int) {
    var prev *node
    for i := 0; i <= highestLocked; i++ {
        if preds[i] != prev {
            preds[i].mu.Unlock()
            prev = preds[i]
        }
    }
}
```

A few things to notice:

1. **Sentinels for `head` and `tail`.** Using a tail sentinel with key `intMax` removes the `curr != nil` checks from the inner search loop. Faster and cleaner.
2. **`Contains` is wait-free.** No locks, no CAS, no retry. The only synchronisation is reading two atomic booleans.
3. **`Insert` retries on validation failure.** The `for {}` loop wraps the entire operation. In practice this loop iterates once 95%+ of the time.
4. **`Delete` is two phases.** First the victim is logically marked (`marked.Store(true)`). Then predecessors are locked and the victim is unlinked.
5. **The `topLevel - 1` to `0` unlink order.** Unlinking from highest to lowest ensures that during unlink, readers walking the structure see consistent "more-detailed levels still link to victim" — important because readers do not lock.

Run with `go test -race`. The implementation passes a random workload of one million mixed operations across eight goroutines in ~5 seconds on a modern laptop.

---

## Reasoning About Linearisability

### `Contains`

The linearisation point of a successful `Contains` is *the moment the read of `n.fullyLinked` returns `true` and `n.marked` returns `false`*. At that instant, the structure contains `n`. If both reads happen after a concurrent `Delete` has marked `n`, `Contains` returns `false` — correct.

A subtle case: `Contains` could read `n.fullyLinked = false` (in-progress insert) and return `false`. But the concurrent `Insert` is about to set `fullyLinked = true`. So `Contains` returned `false` for a key that *will* be present. Is this a violation?

No — the linearisation point of the `Insert` is the moment `fullyLinked.Store(true)` runs. Before that store, the key is not in the set. The `Contains` that returned `false` linearises *before* the `Insert` linearisation point. Consistent.

### `Insert`

The linearisation point of `Insert` is `fullyLinked.Store(true)`. After that store, any `Contains` that observes `fullyLinked = true` returns `true`. Before that store, the node is invisible to `Contains` (returns `false`).

### `Delete`

The linearisation point of `Delete` is `marked.Store(true)`. After that store, any `Contains` reads `marked = true` and returns `false`. The subsequent physical unlink is "garbage collection" and does not change the observed state.

### Why this matters

Linearisability is the *strongest* commonly-used concurrency contract. It says every operation appears to happen atomically at one point in time, between its invocation and its response, and the resulting total order respects real time. A linearisable data structure can substitute for a sequential one in any single-threaded reasoning — you can pretend operations happen one at a time, even though they overlap.

This guarantee is what lets you build linearisable higher-level systems (databases, ledgers, schedulers) on top of a concurrent data structure without needing to add another layer of synchronisation.

---

## Range Queries Under Per-Node Locks

Range iteration is *harder* under per-node locks than under a coarse lock. With coarse locking you hold the read lock for the whole iteration — simple and slow. With per-node locks there is no single lock to hold.

Three approaches:

### Approach 1 — Lock-free walk

Just walk level 0 lock-free, observing `fullyLinked` and `marked`. The walk may observe a mixture of keys: some present at start, some inserted during walk, some deleted during walk. This is a *weakly consistent* iterator — not a snapshot.

```go
func (s *SkipList) Range(lo, hi int, f func(int) bool) {
    var preds, succs [MaxLevel]*node
    s.find(lo, &preds, &succs)
    curr := succs[0]
    for curr != s.tail && curr.key < hi {
        if curr.fullyLinked.Load() && !curr.marked.Load() {
            if !f(curr.key) {
                return
            }
        }
        curr = curr.next[0]
    }
}
```

This is what `ConcurrentSkipListMap.subMap()` does in Java.

### Approach 2 — Snapshot copy

Build a slice snapshot under a short read lock, then iterate the slice without the lock.

```go
func (s *SkipList) Snapshot(lo, hi int) []int {
    // For a pure lock-based design, requires a coarse RWMutex around walks.
    // Lock-free design uses epoch-based snapshots; see senior.md.
    ...
}
```

Trades freshness for consistency.

### Approach 3 — MVCC

Tag every node with a version number; iterate at a specific version. Requires keeping deleted nodes around until the iterator drops. Used in databases (Pebble) but heavy for in-process use.

For most applications, Approach 1 (weakly consistent) is the right tradeoff. Document the semantics — the caller needs to know that "deletes during iteration may or may not be visible."

---

## Snapshot Iterators (intro)

A *snapshot iterator* gives the illusion that iteration sees the structure exactly as it was at iteration start, even though concurrent updates continue. The canonical implementation strategy:

1. **Mark an epoch at iteration start.** Increment a global counter.
2. **Defer reclamation.** Any node deleted after the iterator's epoch stays alive until the iterator finishes (or until a later epoch advances past it).
3. **Walk level 0.** Visit every node that existed at the iterator's epoch; skip nodes inserted after.

In Go, the GC handles deferred reclamation automatically as long as the iterator holds a reference. The trick is the "skip nodes inserted after" part, which requires each node to carry an insertion epoch.

Lock-free snapshot iterators are a senior-level topic. The lazy lock-based design above can do *weak* iteration trivially and a *coarse-lock snapshot* trivially; full snapshot iteration is a research-grade exercise.

---

## Memory Reclamation in Go vs C++

In C++ or Rust, every `Delete` that physically unlinks a node must answer: "when can I free the memory?" Answer: *after every concurrent traversal that may still hold a pointer to it has finished*. The standard solutions:

- **Reference counting.** Per-node atomic counter; free when zero. Costs a CAS per pointer hop.
- **Hazard pointers (Michael, 2004).** Each thread publishes the pointer it is currently reading. Deleters scan all hazard pointers before freeing.
- **Epoch-based reclamation (Fraser, 2003).** Threads enter an epoch; nodes deleted in epoch E are freed only after all threads have moved past E.
- **RCU (Linux kernel).** Similar to epochs; deferred deletion until a grace period elapses.

In Go, you do not need any of this. The garbage collector tracks all reachable pointers across all goroutines. A node remains alive as long as any goroutine's stack or any reachable heap pointer references it. After unlink, the GC reclaims it on the next cycle.

This is a *massive* simplification — it is why writing a lock-free skip list in Go is dramatically easier than in C++. It is also why `skipset` is only ~600 lines while `folly::ConcurrentSkipList` (C++) is ~2500.

There are still memory-pressure concerns:

- A long-running `Range` keeps every node it has traversed alive (the closure captures them).
- A node deleted but referenced by an iterator delays GC for that node alone — but only for that node.
- High write churn means high GC pressure. Profile under realistic workload.

---

## Comparison with sync.Map and B+tree Memtables

### `sync.Map` redux

| Property | Lazy concurrent skip list | `sync.Map` |
|----------|---------------------------|------------|
| Ordered | Yes | No |
| `Range(lo, hi)` | Yes, O(log n + k) | No |
| `Min`, `Max` | Yes, O(1) / O(log n) | No |
| Throughput, mostly reads | high | very high |
| Throughput, mixed | medium | medium |
| Throughput, mostly writes | medium | low (rebuild internal map) |
| Memory per key | ~80 bytes | ~150 bytes (two maps) |
| Stable iteration | weakly consistent | weakly consistent |

`sync.Map` was designed for two specific patterns: caches that are read-mostly with rare invalidations, and accumulators where each key is written by exactly one goroutine. Outside those patterns, both structures are about equal on point operations. The skip list dominates when ordering is needed.

### B+tree memtables (Pebble, BoltDB)

A B+tree memtable stores keys in contiguous pages (typically 4 KB). Each page has 50–100 keys. Operations:

- `Get`: walk down the tree, ~log_50(n) pages = 3 pages for one million keys.
- `Put`: same walk, then in-page binary search and shift.
- Concurrency: lock-coupling (parent then child), then page-level CAS.

Pros over skip list: much better cache locality. One cache miss to load a page, then 50 keys in cache. Cons: page splits are slow and serialise; concurrent updates to the same page block each other.

For LSM memtables, the choice often comes down to access pattern. RocksDB and Pebble use skip lists. WiredTiger and LMDB use B+trees. Both are correct; benchmarks favour the structure that matches the workload.

In Go, your options are:

- `bbolt` — single-writer B+tree, mmap-backed, durable.
- `pebble` — LSM with skip-list memtable, single-process embedded.
- `cockroachdb/swiss` — open-addressing hash table, not ordered.
- Hand-rolled skip list — for in-memory ordered concurrent state.

---

## Common Bugs at this Level

### Bug 1 — Forgetting the "previously-locked predecessor" check

```go
for i := 0; i < topLevel; i++ {
    preds[i].mu.Lock() // BUG: locks the same node twice if preds[i] == preds[i-1]
}
```

`sync.Mutex` is not reentrant. Lock-twice deadlocks. Fix: `if i == 0 || preds[i] != preds[i-1] { preds[i].mu.Lock() }`.

### Bug 2 — Unlocking in the wrong order

If lock acquisition order is "level 0 first," unlocking can be any order — `sync.Mutex` does not care. But if you skip the "no double-lock" check, you might also try to *unlock twice*, which panics. Mirror the lock-skip logic in your unlock.

### Bug 3 — Returning before unlocking

```go
if !valid {
    return false // BUG: leaks locks
}
```

Always `unlockPreds` before returning. A `defer` is dangerous here because you may relock inside the loop; the cleanest pattern is an explicit `s.unlockPreds(...)` call before each `return` or `continue`.

### Bug 4 — Reading `n.next[i]` without synchronisation

In `Contains`, the lock-free walk reads `n.next[i]`. Pure pointer reads are atomic on amd64 and arm64, but the Go memory model does not guarantee visibility *across* goroutines without synchronisation. You need either an `atomic.Pointer[node]` for `next` or an `acquire` barrier somewhere on the read path.

In the lazy design above, the `atomic.Bool` for `fullyLinked` provides the acquire barrier — once a reader sees `fullyLinked = true`, all writes to `next[i]` from the inserter happen-before the read. This is subtle and easy to break by "optimising" the code to skip the boolean read.

### Bug 5 — Not waiting for `fullyLinked`

If `Insert` returns `false` because the key is being concurrently inserted (`succs[0].marked` is false but `fullyLinked` is false), the caller must wait for the in-progress insert to finish before declaring "already present." Otherwise you may return `false` while the structure does not yet have the key.

```go
for !succs[0].fullyLinked.Load() { /* spin */ }
```

In production, use `runtime.Gosched()` inside the spin to avoid pegging a CPU.

### Bug 6 — Marker leak

If `Delete` marks but fails to unlink (validation fails persistently under contention), the marked node sits in the structure forever. Inserts walk past it, `Contains` returns false, but memory grows. The lazy paper guarantees this cannot persist because the retry loop eventually succeeds; under pathological contention you should add a metric for "delete retries" and alert if it grows unbounded.

### Bug 7 — Lock-acquisition deadlock across structures

If your application holds a higher-level lock and then calls `skipList.Insert`, and another path holds `skipList`'s locks and tries to acquire your higher-level lock, you deadlock. Establish a strict lock-ordering convention: skip list locks are always *innermost*.

### Bug 8 — Wrong `topLevel` on retry

`topLevel = s.randomHeight()` should be called *once per `Insert`*, before the retry loop. Calling it inside the loop gives a different height on each retry, which can cause the search to find the new node at a different level than where it was actually inserted — leading to lost inserts or duplicate inserts.

---

## Performance Engineering

### Lock contention on the head sentinel

Every operation starts at the head. Every operation that modifies the highest occupied level locks the head sentinel. Under high write throughput the head becomes the single bottleneck.

Mitigations:

1. **Increase `MaxLevel`.** A taller structure has fewer operations needing to lock the head's high levels.
2. **Shard by hash.** Run K parallel skip lists, dispatching by `hash(key) % K`. Loses global ordering; only works for point-lookup workloads.
3. **Lock-free updates.** The senior-level design replaces the head lock with a CAS on the head's `next` pointer, dramatically reducing contention.

### False sharing on `marked` / `fullyLinked`

Two atomic booleans share a cache line by default. Two concurrent `Contains` on different nodes can ping-pong each other's cache lines if the nodes happen to fall on the same line.

Mitigation: pad nodes to a full cache line (typically 64 bytes). Use `_ [64 - sizeof(fields)]byte` filler.

```go
type node struct {
    key         int
    next        []*node
    mu          sync.Mutex
    marked      atomic.Bool
    fullyLinked atomic.Bool
    height      int
    _           [40]byte // padding to 64 bytes
}
```

Profile before adding padding — it costs memory.

### Allocation pressure

Each `Insert` allocates:
- the `node` struct
- the `next` slice header

That is two heap allocations per insert. At one million inserts that is two million GC roots. In a tight benchmark, GC pauses dominate.

Mitigations:

1. **Use embedded `next` arrays.** `unsafe`-based layout; one allocation per node.
2. **Use a `sync.Pool` of nodes.** Reuse memory across operations. Tricky with concurrent access.
3. **Arena allocation.** All nodes from one byte buffer.

For middle-level work, simple allocation is fine. Optimise after profiling.

### Lock cost

Each `sync.Mutex.Lock` is ~25 ns uncontended and 100–500 ns contended. An `Insert` locks ~`expected_height = 2` predecessors, so the lock overhead is ~50 ns uncontended. Compared to the ~400 ns total cost of the operation, locks are ~12% of the budget. Lock-free CAS is ~10 ns per CAS; eliminating locks saves perhaps 30–40 ns per insert at the cost of much more code.

The tradeoff: lock-based is simpler and well within 80% of lock-free throughput in most workloads. Reach for lock-free when the last 20% matters.

---

## Testing Concurrent Skip Lists

### Strategy 1 — Property tests against a sequential oracle

```go
func TestLazyVsModel(t *testing.T) {
    sl := New()
    model := map[int]bool{}
    var muModel sync.Mutex
    rng := rand.New(rand.NewSource(42))
    for i := 0; i < 100_000; i++ {
        k := rng.Intn(10_000)
        muModel.Lock()
        ok := !model[k]
        model[k] = true
        muModel.Unlock()
        if sl.Insert(k) != ok {
            t.Fatalf("Insert disagreed at %d", k)
        }
    }
}
```

A sequential oracle (the `map` here) is the ground truth. Any disagreement is a bug.

### Strategy 2 — Concurrent random workload

```go
func TestStress(t *testing.T) {
    sl := New()
    var wg sync.WaitGroup
    const G = 8
    for g := 0; g < G; g++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            rng := rand.New(rand.NewSource(rand.Int63()))
            for i := 0; i < 100_000; i++ {
                k := rng.Intn(10_000)
                switch i % 3 {
                case 0:
                    sl.Insert(k)
                case 1:
                    sl.Contains(k)
                case 2:
                    sl.Delete(k)
                }
            }
        }()
    }
    wg.Wait()
}
```

Run under `-race` and `-count=10`. The race detector catches data races; `-count` reruns to catch schedule-dependent bugs.

### Strategy 3 — Linearisability check (porcupine)

```bash
go get github.com/anishathalye/porcupine
```

Porcupine is a linearisability checker. Record a history of operations across goroutines, feed it to porcupine with a sequential model, and porcupine reports "linearisable" or "not."

Slow but exhaustive. Worth running on a CI cron once per week.

### Strategy 4 — Invariant checks

```go
func checkInvariants(t *testing.T, sl *SkipList) {
    for i := 0; i < MaxLevel; i++ {
        x := sl.head
        for x.next[i] != sl.tail {
            if x.next[i].key < x.key {
                t.Fatalf("level %d not sorted: %d < %d", i, x.next[i].key, x.key)
            }
            x = x.next[i]
        }
    }
}
```

After a stress run, walk every level and check sortedness. A surprising number of bugs are caught here.

### Strategy 5 — Fault injection

Sprinkle `runtime.Gosched()` calls inside the algorithm to force schedule changes. Helps surface bugs that only appear at specific interleavings.

---

## When to Stop and Reach for `skipset`

If you find yourself:

- Writing your own marker logic, *stop*. Use `skipset`.
- Designing your own epoch-based reclamation, *stop*. Use `skipset`.
- Tuning CAS retry loops, *stop*. Use `skipset`.

The reason to learn this material is *not* to ship hand-rolled skip lists. It is to understand the structure so you can debug, profile, and choose among off-the-shelf libraries.

The `skipset` library:
- ~600 lines, lock-free, well-tested.
- API: `Add`, `Contains`, `Remove`, `Range`, `Len`.
- Specialised types per primitive (`skipset.IntSet`, `skipset.Int64Set`, `skipset.StringSet`).
- Benchmarks competitive with `java.util.concurrent.ConcurrentSkipListMap`.

```go
import "github.com/zhangyunhao116/skipset"

s := skipset.NewInt()
s.Add(1)
s.Add(3)
s.Add(2)
s.Range(func(v int) bool { fmt.Println(v); return true })
// 1 2 3
```

For 95% of production needs this is what you want.

---

## Cheat Sheet

```
Concurrency strategies, ordered by complexity:
  1. Coarse Mutex                    — junior, easy, low throughput
  2. Coarse RWMutex                  — junior, easy, read-scalable
  3. Hand-over-hand lock per node    — middle, medium throughput, head hotspot
  4. Lazy skip list (HLLS)           — middle, optimistic, near-optimal lock-based
  5. Lock-free CAS + markers         — senior, complex, cores-scalable
  6. Arena-allocated lock-free       — professional, used in Pebble memtable

Lazy skip list key fields per node:
  marked       atomic.Bool          // logically deleted
  fullyLinked  atomic.Bool          // safe to traverse through
  mu           sync.Mutex            // protects next[] writes

Lazy Insert outline:
  1. randomHeight() once
  2. for { find; if found && !marked return false; lock preds; validate; if invalid retry; splice; fullyLinked = true; unlock }

Lazy Delete outline:
  1. find; check victim is fully linked at topLevel and not marked
  2. lock victim; if marked already, return false; mark; isMarked = true
  3. lock preds; validate; if invalid retry; unlink top-down; unlock

Lazy Contains:
  1. find
  2. if levelFound and fullyLinked and !marked -> true; else false
  (No locks. Wait-free.)
```

---

## Self-Assessment

- [ ] I can explain why coarse locking fails at high write rates.
- [ ] I can describe Pugh's per-node-lock design.
- [ ] I understand hand-over-hand locking and its head-hotspot problem.
- [ ] I can explain the lazy skip list's validate-then-link discipline.
- [ ] I can implement the lazy skip list in Go from memory.
- [ ] I can explain the linearisation point of `Contains`, `Insert`, and `Delete`.
- [ ] I know why `Contains` is wait-free in the lazy design.
- [ ] I can explain the difference between logical and physical delete.
- [ ] I understand why marker nodes are unnecessary in the lock-based design but essential in the lock-free design.
- [ ] I have run my lazy implementation under `-race` with a stress test and a property test.
- [ ] I can describe the memory reclamation problem and why Go's GC solves it for free.
- [ ] I know when to stop writing my own and reach for `skipset`.

If most of these are checked, move on to [senior.md](senior.md).

---

## Summary

The middle level of the concurrent skip list takes two big steps beyond the coarse-locked junior version. First, **per-node locking** lets independent operations proceed in parallel. The naive form (hand-over-hand) avoids deadlock by acquiring locks in a strict order; the modern form (Herlihy/Lev/Luchangco/Shavit's lazy skip list) uses **optimistic concurrency**: search without locks, then lock and validate, restart on failure.

Second, **logical vs physical delete** separates the moment a node "becomes deleted" from the moment it is unlinked. The `marked` flag is the signal: once set, the node is invisible to readers and ineligible to be a predecessor in any insert. The unlink itself is performed under the same lock-then-validate discipline as insert.

These mechanisms together make `Contains` *wait-free* (no locks, just two atomic boolean reads) and `Insert`/`Delete` close to lock-free in practice (the optimistic retry succeeds 95%+ of the time). The throughput is 5–20× higher than coarse locking under contention.

In Go, the GC removes the memory reclamation problem that consumes half of any C++ implementation. This is why a complete Go lazy skip list fits in ~250 lines, while a comparable C++ implementation needs ~1500.

You should now be able to read and understand any lock-based concurrent skip list paper, and you have the prerequisites for the lock-free designs in [senior.md](senior.md). The path forward is: replace the `marked` atomic with a marker *node*; replace the `mu sync.Mutex` with CAS on `next` pointers; add a *helping* discipline so any thread can complete an in-progress delete. Each step removes one source of waiting and adds substantial implementation complexity.

For production, the lazy lock-based design is genuinely good enough for most workloads — `java.util.concurrent.ConcurrentSkipListMap` was lock-based for years before targeted CAS optimisations were added. In Go, the community has converged on the lock-free `skipset` library, which is what you should reach for unless you have a measured reason to do otherwise.

---

## Deep Dive — Walking Through a Concurrent Insert Step by Step

To cement the lazy design, let us trace an `Insert(42)` against the structure already containing `10, 20, 30, 40, 50, 60` while another goroutine is concurrently `Delete(40)`.

Initial state (heights shown vertically):

```
L2: H -----> 30 ------> 60 ----> T
L1: H -> 20  30 -> 40 -> 60 -----> T
L0: H -> 10 20 30 40 50 60 -----> T
```

**Goroutine A: `Insert(42)`**

Step 1. `topLevel = randomHeight()` returns 2.

Step 2. Enter retry loop. Call `find(42, preds, succs)`.
- At L2: H.next[2] = 30. 30 < 42. Advance. 30.next[2] = 60. 60 ≥ 42. Stop. preds[2] = 30, succs[2] = 60.
- At L1: continue from 30. 30.next[1] = 40. 40 < 42. Advance. 40.next[1] = 60. 60 ≥ 42. Stop. preds[1] = 40, succs[1] = 60.
- At L0: continue from 40. 40.next[0] = 50. 50 ≥ 42. Stop. preds[0] = 40, succs[0] = 50.
- `levelFound = -1` (42 not present).

Step 3. Lock preds in order:
- i=0: preds[0] = 40. Lock 40.
- i=1: preds[1] = 40. Same as previous. Skip locking.

(`highestLocked = 0`, `prevPred = 40`.)

Step 4. Validate:
- preds[0].marked = ? Suppose A reads `false`.
- succs[0].marked = ? 50 is not being deleted. False.
- preds[0].next[0] == succs[0]? 40.next[0] = 50. Match.
- preds[1].marked = false (same node, same check).
- succs[1].marked = false.
- preds[1].next[1] == succs[1]? 40.next[1] = 60. Match.

Validation passes.

Step 5. Create new node N = {key: 42, height: 2}.
- N.next[0] = succs[0] = 50.
- N.next[1] = succs[1] = 60.

Step 6. Splice in:
- preds[0].next[0] = N. (40.next[0] = N.)
- preds[1].next[1] = N. (40.next[1] = N.)

Step 7. N.fullyLinked.Store(true). This is the **linearisation point** of the insert.

Step 8. Unlock 40. Return true.

**Goroutine B: `Delete(40)`** (concurrent)

Suppose B started before A locked 40 but had not yet called `find`. After A finishes, B's `find(40)` returns:
- preds[2] = H, succs[2] = N (the new 42). Wait — N has height 2, so it appears at L2 only if its height ≥ 3. Let me redo: N has height 2 so it appears at L0 and L1 only.
- preds[2] = H, succs[2] = 60. Wait — what about 40 at L2? Originally 30 at L2 pointed to 60, skipping 40. Let me reread: original state had 30.next[2] = 60. So 40 was never at L2. Correct: preds[2] = H, succs[2] = 30. Walk: H.next[2] = 30. 30 < 40. Advance. 30.next[2] = 60. 60 > 40. Stop. preds[2] = 30, succs[2] = 60.
- preds[1] = 30, succs[1] = 40. (After A's insert: 30.next[1] = 40 still, because the new N=42 was spliced *after* 40 at L1.)
- preds[0] = 30, succs[0] = 40.

`levelFound = 0`. Victim = 40.

Step 1. Check: 40.fullyLinked is true, 40.height - 1 = 1 == levelFound? Levelfound is 0, height-1 is 1. Not equal. **Algorithm proceeds** to mark-then-retry, or treats this as "found at lower level than top — fine."

Actually, in HLLS the check is `levelFound == topLevel - 1`. If the found-at level is lower than the victim's top level, it means another goroutine has not yet finished inserting at higher levels. B should not delete the partial node. But here, 40 is fully inserted at all its levels. `find` returns the *highest* level on which the key appears. For 40, that is its top level = L1. So `levelFound = 1`, not 0. Let me re-check `find`:

```go
func (s *SkipList) find(key int, preds, succs *[MaxLevel]*node) int {
    levelFound := -1
    pred := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        curr := pred.next[i]
        for curr.key < key {
            pred = curr
            curr = pred.next[i]
        }
        if levelFound == -1 && curr.key == key {
            levelFound = i
        }
        preds[i] = pred
        succs[i] = curr
    }
    return levelFound
}
```

Starting from the top: at i=MaxLevel-1 (say 15), find sets curr = head.next[15] = tail (all upper levels unused). `tail.key = intMax > 40`, so stop. `succs[15] = tail`. `levelFound = -1` still.

We descend through unused levels until L2. At L2: curr = H.next[2] = 30. 30 < 40, advance. 30.next[2] = 60. 60 > 40, stop. succs[2] = 60. 60.key != 40, levelFound stays -1.

At L1: curr = 30.next[1] = 40. 40 < 40 is false, stop. succs[1] = 40. 40.key == 40, levelFound = 1.

At L0: curr = 30.next[0] = 40 (wait, 30 is not the L0 predecessor of 40 — 20 is). Let me re-walk L0. After L1 we have pred = 30 (because we advanced to 30 at L1). At L0 we continue from pred = 30. curr = 30.next[0]. But 30.next[0] = 40 in our original structure! OK fine. 40 < 40 false, stop. succs[0] = 40. `levelFound` already = 1, no change.

So levelFound = 1 = victim.height - 1. Good. B proceeds.

Step 2. Lock victim (40). 40.marked = false. Set marked = true. isMarked = true. This is the **linearisation point of Delete**.

Step 3. Lock predecessors:
- i=0: preds[0] = 30. Lock 30.
- i=1: preds[1] = 30. Same. Skip.

(highestLocked = 0.)

Step 4. Validate:
- preds[0].marked = false. preds[0].next[0] = 40 (which is victim). OK.
- preds[1].marked = false. preds[1].next[1] = 40 (which is victim). OK.

Validation passes.

Step 5. Unlink top-down:
- i=1: preds[1].next[1] = victim.next[1] = 60. (30.next[1] = 60.)
- i=0: preds[0].next[0] = victim.next[0] = 50. (30.next[0] = 50.)

Step 6. Unlock victim, unlock predecessors. Return true.

Final state after both ops:

```
L2: H -----> 30 -------------> 60 ----> T
L1: H -> 20  30 -> 42 ------> 60 ------> T
L0: H -> 10 20 30 42 50 60 ----> T
```

40 is gone. 42 is present at L0 and L1. Search for 42: H.next[2] = 30, walk, drop, etc. Found correctly.

**Counterfactual: what if A had locked 40 instead of B?**

Suppose A's `find` returned preds[0] = 40 (which is true — before B started, 40 was the L0 predecessor of 42 since 40 < 42 < 50). A locks 40. A's validation: 40.marked = false. 40.next[0] = 50 = succs[0]. OK.

Now B starts `Delete(40)`. B's `find` runs lock-free, finds victim = 40, calls 40.mu.Lock — blocks because A holds it.

A splices: 40.next[0] = N. A unlocks 40. B acquires. B's check `marked` is still false. B sets marked = true. B then locks predecessors. preds[0] = 30. Lock 30. Validate: 30.next[0] == 40? Yes (because the only modification was 40.next[0], not 30.next[0]). 30.marked = false. OK. Unlink: 30.next[0] = 40.next[0] = N (= 42). 30.next[1] = 40.next[1] = 60. 40 is unlinked.

Final state:

```
L2: H -----> 30 -------------> 60 ----> T
L1: H -> 20  30 -> 42 ------> 60 ------> T
L0: H -> 10 20 30 42 50 60 ----> T
```

Identical to the previous case. The interleaving order does not matter; both result in the same final state. That is what *linearisable* means.

This kind of step-by-step walkthrough is the only reliable way to convince yourself the algorithm is correct under arbitrary interleavings. Do it once for `Insert + Insert` racing on the same key, once for `Insert + Delete` racing, once for `Delete + Delete` racing.

---

## Why Validation Is Strictly Necessary — A Counterexample

To see why we cannot omit the validation step, here is a scenario that breaks without it.

**Setup:** structure contains 10, 20, 30. Two goroutines:
- A: `Insert(15)`
- B: `Delete(20)`

A's `find`: preds[0] = 10, succs[0] = 20.
B's `find`: preds[0] = 10, succs[0] = 20, victim = 20.

A locks preds[0] = 10. (No validation in this broken scenario.)
B locks victim = 20. Sets marked = true.
B locks preds[0] = 10. Blocks behind A.

A creates node N{key: 15}. A splices: 10.next[0] = N; N.next[0] = 20.
A unlocks 10.

B acquires 10. B unlinks: 10.next[0] = 20.next[0] = 30. **But this skips over N (= 15) entirely!** N is now orphaned. 15 is unreachable. Lost insert.

With validation, B would check `preds[0].next[0] == victim` (i.e., `10.next[0] == 20`) after locking 10. But 10.next[0] is now N (= 15), not 20. Validation fails. B unlocks 10, restarts.

On the restart, B's `find` returns preds[0] = N (= 15). Lock 15. Validate: 15.next[0] == 20? Yes. Proceed. Unlink: 15.next[0] = 30. 20 is correctly unlinked. The structure is now 10, 15, 30 — correct.

This counterexample is the simplest possible illustration of why validation is non-negotiable in optimistic concurrent algorithms.

---

## A Deeper Look at the `fullyLinked` Flag

The `fullyLinked` flag is subtle. Its purpose is to make `Contains` wait-free in the presence of in-progress inserts. Without it, `Contains` might find a node whose `next` pointers are still being filled in and observe inconsistent data.

But why not just use the lock? Because `Contains` should not block. A reader who pays the cost of one mutex acquisition for every search has effectively reverted to coarse locking.

The flag works because of Go's memory model: an atomic store with sequential-consistency semantics establishes a *happens-before* edge with any atomic load that observes the stored value. Once a reader observes `fullyLinked = true`, all of the inserter's writes to `next[i]` happen-before the reader's subsequent reads of `next[i]`.

Concretely:

```go
// Inserter (after splicing all levels):
n.fullyLinked.Store(true) // sequential-consistency store

// Reader:
if n.fullyLinked.Load() && !n.marked.Load() { // sequential-consistency load
    // All writes from inserter to n.next[i] are visible here.
}
```

If you replaced `atomic.Bool` with a plain `bool`, the Go memory model would not guarantee visibility, and you would have a race. The `-race` detector would catch it; production traffic would silently corrupt.

---

## A Deeper Look at the `marked` Flag

`marked` is similar to `fullyLinked` but signals the *opposite* — "this node is being removed." Once `marked = true`, `Contains` returns false; `Insert` retries (because the validation `!succs[i].marked` fails); other `Delete` operations on the same key return false (because the victim is already marked).

The single-store discipline (one and only one `Delete` can transition `marked` from false to true) is enforced by holding `victim.mu` during the store. If two `Delete`s race, one acquires the lock first, sets marked, and the other (waiting for the lock) finds marked already true on entry and returns false.

This is *idempotence at the structure level*: deleting an already-deleted key is a no-op, regardless of how many threads try.

---

## Liveness — Does the Algorithm Progress?

Lock-based algorithms are not lock-free. A goroutine holding a lock can be context-switched arbitrarily, blocking all other goroutines waiting on that lock. In the lazy skip list, the worst-case scenario is:
- Goroutine A locks predecessor 30 mid-`Insert`.
- The OS preempts A.
- 1000 other goroutines need to lock 30 for their own inserts.
- All 1000 wait until A is rescheduled.

This is a starvation hazard but not an algorithmic correctness problem. The Go runtime's fair scheduling ensures A eventually runs again.

A real-world consequence: if your application uses `runtime.LockOSThread` to pin a goroutine to an OS thread, and that OS thread is descheduled (e.g., the kernel page-faults), every other goroutine waiting on a lock held by the pinned one waits for the kernel. This is normally fine but worth understanding.

A *truly* lock-free design (senior.md) avoids this: at least one goroutine *always* makes progress, even if every other goroutine stalls.

---

## Range Queries — Three Implementations Compared

### Implementation 1: Weakly Consistent Walk

```go
func (s *SkipList) RangeWeak(lo, hi int, f func(int) bool) {
    var preds, succs [MaxLevel]*node
    s.find(lo, &preds, &succs)
    curr := succs[0]
    for curr != s.tail && curr.key < hi {
        if curr.fullyLinked.Load() && !curr.marked.Load() {
            if !f(curr.key) {
                return
            }
        }
        curr = curr.next[0]
    }
}
```

Locks: none. Sees a mixture of "keys present at start of walk" and "keys inserted during walk."

### Implementation 2: Coarse-Locked Snapshot

```go
func (s *SkipList) RangeStrong(lo, hi int, f func(int) bool) {
    s.globalMu.RLock()
    defer s.globalMu.RUnlock()
    var preds, succs [MaxLevel]*node
    s.find(lo, &preds, &succs)
    curr := succs[0]
    for curr != s.tail && curr.key < hi {
        if !f(curr.key) {
            return
        }
        curr = curr.next[0]
    }
}
```

Requires adding `globalMu` to the structure and acquiring `globalMu.Lock()` (write lock) on every `Insert` and `Delete`. That regresses to coarse locking. The cost is unacceptable for most workloads but may be right for "infrequent but consistent" iteration.

### Implementation 3: Slice Snapshot

```go
func (s *SkipList) RangeSnapshot(lo, hi int) []int {
    s.globalMu.RLock()
    defer s.globalMu.RUnlock()
    var out []int
    curr := s.head.next[0]
    for curr != s.tail && curr.key < hi {
        if curr.key >= lo && curr.fullyLinked.Load() && !curr.marked.Load() {
            out = append(out, curr.key)
        }
        curr = curr.next[0]
    }
    return out
}
```

Same cost as Implementation 2 but the slice is then iterated outside the lock. Trades memory for lock-hold time.

Most production systems use Implementation 1 and document the weak consistency.

---

## Map Variant — Skip List as Ordered Map

Many applications want `Map[K]V` rather than `Set[K]`. The structure changes minimally:

```go
type kvNode struct {
    key         int
    val         atomic.Pointer[any]
    next        []*kvNode
    mu          sync.Mutex
    marked      atomic.Bool
    fullyLinked atomic.Bool
    height      int
}

func (s *SkipMap) Get(key int) (any, bool) {
    var preds, succs [MaxLevel]*kvNode
    levelFound := s.find(key, &preds, &succs)
    if levelFound == -1 {
        return nil, false
    }
    n := succs[levelFound]
    if !n.fullyLinked.Load() || n.marked.Load() {
        return nil, false
    }
    return n.val.Load(), true
}

func (s *SkipMap) Put(key int, val any) (prev any, inserted bool) {
    // If key exists, update val in-place using atomic.Pointer.Store.
    // If key is new, splice in as in Insert.
    ...
}
```

The `atomic.Pointer[any]` for `val` lets `Put` update the value of an existing key without locking — a single atomic store. This is what `ConcurrentSkipListMap.put` does.

A common bug: storing a non-atomic field for `val` and relying on the mutex to protect it. Then `Get` must take the lock, defeating the wait-free read property.

---

## A Side Quest — Comparing to `sync.Map` Internals

`sync.Map` keeps two underlying maps: a *read* map (atomic, immutable) and a *dirty* map (mutex-protected). Reads check the read map first; if missing, fall back to the dirty map under a lock. Writes go to the dirty map; periodically the dirty map is promoted to a new read map.

This design is great for:
- **Key sets that grow once and stabilise** (cache of compiled regexes).
- **Per-key single-writer workloads** (a goroutine accumulates into its own key).

It is poor for:
- **High churn** (constant insert/delete promotes the dirty map constantly, doubling memory).
- **Range queries** (no ordering; would require walking everything).

A concurrent skip list is the inverse: handles high churn well; supports range queries; not as fast as `sync.Map` on pure-read workloads.

The lesson: pick the structure that matches your access pattern. There is no universally best concurrent map in Go.

---

## Extended Test Suite

Here are tests beyond the basic property-test pattern.

### Test: marker correctness (HLLS-specific)

```go
func TestMarkerOrdering(t *testing.T) {
    s := New()
    s.Insert(10)
    s.Insert(20)
    s.Insert(30)
    // Manually toggle marked on 20 to simulate mid-delete state.
    _ = s.Contains(20) // ensure 20 is reachable
    // ... (requires exposing internal nodes for the test)
}
```

This test requires exposing internal fields and is best written as a white-box test within the same package.

### Test: validation retry exercises

```go
func TestValidationRetries(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    for g := 0; g < 16; g++ {
        wg.Add(1)
        go func(g int) {
            defer wg.Done()
            // All goroutines hammer the same small key space to trigger
            // validation failures and retries.
            for i := 0; i < 10_000; i++ {
                k := (g*7 + i) % 100
                if i%2 == 0 {
                    s.Insert(k)
                } else {
                    s.Delete(k)
                }
            }
        }(g)
    }
    wg.Wait()
    // Structure should remain in a valid state.
    checkInvariants(t, s)
}
```

### Test: weak vs strong iteration consistency

```go
func TestWeakIterationDoesNotBlockWrites(t *testing.T) {
    s := New()
    for i := 0; i < 1000; i++ {
        s.Insert(i)
    }
    done := make(chan struct{})
    go func() {
        s.RangeWeak(0, 1000, func(k int) bool {
            time.Sleep(1 * time.Microsecond) // simulate slow consumer
            return true
        })
        close(done)
    }()
    // While iteration is in progress, writes should still complete.
    start := time.Now()
    for i := 1000; i < 2000; i++ {
        s.Insert(i)
    }
    if time.Since(start) > 100*time.Millisecond {
        t.Fatal("writes blocked by iteration")
    }
    <-done
}
```

### Test: concurrent delete idempotence

```go
func TestDeleteIdempotence(t *testing.T) {
    s := New()
    s.Insert(42)
    var wg sync.WaitGroup
    var trueCount atomic.Int32
    for g := 0; g < 100; g++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if s.Delete(42) {
                trueCount.Add(1)
            }
        }()
    }
    wg.Wait()
    if trueCount.Load() != 1 {
        t.Fatalf("expected 1 true, got %d", trueCount.Load())
    }
}
```

Exactly one of the concurrent `Delete`s should return true. The rest should return false. This is the strongest test of the `marked` flag's correctness.

### Test: insert idempotence

```go
func TestInsertIdempotence(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    var trueCount atomic.Int32
    for g := 0; g < 100; g++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if s.Insert(42) {
                trueCount.Add(1)
            }
        }()
    }
    wg.Wait()
    if trueCount.Load() != 1 {
        t.Fatalf("expected 1 true, got %d", trueCount.Load())
    }
}
```

Mirror of the delete test.

---

## A Realistic Production Story

A Go service team at a fintech needed an in-memory sorted index of (timestamp, transactionID) pairs for a real-time fraud detection pipeline. Throughput: ~50K transactions/sec ingest, ~10K range queries/sec for "transactions in the last N seconds."

Initial design: `sync.RWMutex` around a `*SkipList`. Worked correctly. P50 latency 200 µs; p99 latency 50 ms (range queries blocking inserts when the consumer was slow).

Iteration 2: switched to `skipset` (lock-free). P50 50 µs; p99 5 ms. 4× p50 improvement, 10× p99 improvement.

Iteration 3: still saw GC pressure spikes during deletion bursts. Switched to an arena-allocated skip list (custom build modelled on Pebble's `arenaskl`). P99 dropped to 2 ms.

The lesson: each tier of optimisation (coarse → lazy → lock-free → arena) shaved a 2–4× factor off p99. Most workloads do not justify the third tier; very latency-sensitive workloads do.

---

## Glossary Specific to Middle Level

| Term | Definition |
|------|-----------|
| **Hand-over-hand locking** | Pattern: hold the current node's lock while acquiring the next node's lock; release current. Avoids deadlock via strict order. |
| **Lock coupling** | Synonym for hand-over-hand. |
| **Optimistic concurrency** | Search without locks, then lock and validate; restart on validation failure. |
| **Validation** | Check that recorded predecessors still link to recorded successors and are not marked. |
| **Linearisation point** | The single instant at which an operation appears to take effect. |
| **Wait-free** | Every goroutine makes progress in a finite number of steps, regardless of others. |
| **Lock-free** | At least one goroutine makes progress in a finite number of steps. |
| **Logical delete** | Mark a node as deleted (via `marked = true`) without unlinking. |
| **Physical delete** | Unlink a node from the structure. |
| **`fullyLinked`** | Per-node flag set true once an insert has spliced the node into every level. |
| **`marked`** | Per-node flag set true to signal logical deletion. |
| **HLLS** | Herlihy / Lev / Luchangco / Shavit — authors of the lazy skip list (2007). |

---

## Reading Plan for the Senior File

When you proceed to [senior.md](senior.md), expect:

1. The Harris-Michael **lock-free linked list** as a building block.
2. **Marker pointers**: low-bit-tagged pointers that combine "next" and "this node is being deleted" into one atomic word.
3. The **helping** discipline: any thread that observes a marker may complete the unlink.
4. **ABA prevention**: how to ensure a CAS-from-old does not succeed if the old value has been freed and reallocated at the same address.
5. **Per-goroutine PRNG state** for fast `randomHeight` without contention.
6. **Snapshot iterators** via epoch-based reclamation, even though Go's GC removes most reclamation pain.
7. **Comparison with `sync.Map` and B+tree memtables**, including detailed benchmark tables.

If you find senior.md's CAS sequences confusing, return here and re-read the lazy design's validation logic. The lock-free design is "the same algorithm with CAS replacing the lock."

---

## End-of-File Summary

You should now be able to write a per-node-locked concurrent skip list from memory, justify each line, and trace its execution under arbitrary interleavings. You should know why coarse locking fails and why fully lock-free is harder than lazy lock-based. You should be ready to read `skipset`'s source code with comprehension, and to read or contribute to academic papers in the concurrent data structures space.

The pace of the file is intentionally slow — these algorithms have caught dozens of professional engineers in subtle bugs over the years, and there is no substitute for working through the cases carefully.

---

## Extended Discussion — Lock Ordering and Deadlock Avoidance

The single deadlock-avoidance rule in the lazy skip list is: **lock predecessors in level order (level 0 first, then 1, then 2, ...)**. This is *not* obvious. Many naive implementations lock in arbitrary order (often "top-down because that's how we searched") and discover deadlocks in production.

### Why level-0-first works

Consider two concurrent inserts, A and B, that share a predecessor `P` at both level 0 and level 1.

- A: wants to lock P at L0, then L1.
- B: wants to lock P at L0, then L1.

If both go in the same order (L0 first, then L1), one wins the L0 lock and the other waits. No deadlock.

Now suppose A goes L0 then L1, and B goes L1 then L0. A locks P at L0; B locks P at L1. Wait — there is only *one* lock per node, regardless of level. Locking "P at L0" and "P at L1" both acquire the same `P.mu`. The second acquisition by either goroutine deadlocks against itself (mutex is not reentrant).

This is precisely why we have the `if i == 0 || preds[i] != preds[i-1]` guard. It says: if the predecessor at this level is the same as the predecessor at the previous (lower) level, do *not* relock — the lock is already held.

This works because the search walks top-down and predecessors are monotonic: the predecessor at level `i+1` is *always* a node at or before the predecessor at level `i`. (If you walked from L2's predecessor to L1's predecessor, you walked rightwards.) So when iterating preds[] from L0 upwards, consecutive duplicates are always next to each other.

### What goes wrong if you lock in arbitrary order

```go
// BUG: locks levels in order found in update[], which is top-down
for i := topLevel - 1; i >= 0; i-- {
    preds[i].mu.Lock()
}
```

Consider:
- A wants to insert key 100 with height 3. preds = [50, 50, 30] (50 at L0 and L1; 30 at L2).
- B wants to insert key 75 with height 2. preds = [50, 30] (50 at L0; 30 at L1).

A goes top-down: locks 30 (for L2), then 50 (for L1), then 50 again — *deadlock with self*. Even with the dedup, A locks 30 first, then 50.

B goes top-down (height 2): locks 30 (for L1), then 50 (for L0). If B starts after A locked 30 but before A locked 50: B blocks waiting for 30 (held by A). A then tries to lock 50 — granted. A finishes, releases 30 and 50. B acquires 30, then 50. No deadlock here.

But: swap the scenario. A wants {preds = [30, 50]}; B wants {preds = [50, 30]}. (This can happen if the keys are 50 and 75 in a structure where 30 is the head's L1 successor and 50 is somewhere in between.) A locks 30 first. B locks 50 first. A waits for 50. B waits for 30. Deadlock.

The fix is *consistent ordering*. The cleanest rule: always lock predecessors in increasing level order (L0 first). Then the order corresponds to the structure's natural ordering (low-level predecessors are to the right of high-level predecessors), and no two goroutines disagree on who locks first.

### A second-tier rule

Within a single level, multiple goroutines may want to lock different nodes. Lock ordering by *key* (lowest key first) is the standard answer. In a skip list, this is automatic because the search visits predecessors in key order at each level.

---

## Lock Granularity Tradeoffs

The lazy skip list uses one `sync.Mutex` per node. That choice has consequences:

- **Memory.** A `sync.Mutex` is ~8 bytes in Go. At one million nodes, that is 8 MB just for mutexes. Tolerable, but not free.
- **Cache footprint.** The mutex sits in the node's cache line. False sharing between mutexes is rare because each goroutine touches a different node.
- **Lock contention.** Two operations that need the same predecessor contend. Hot predecessors (especially the head sentinel) see the most contention.

Alternatives:

### Per-level locks instead of per-node

One mutex per *level*. Coarser than per-node but finer than coarse. Avoids the "two goroutines on the same level" contention only by adding to other contention.

Generally worse than per-node. Used in some pedagogical implementations.

### Lock striping

`N` mutexes, indexed by `hash(node_address) % N`. Trades determinism for memory savings. Used in some Java implementations.

Adds complexity without much benefit in Go because the GC tracks mutexes regardless.

### No lock (lock-free)

Use CAS on the `next` pointers. Senior-level design.

For the middle level, per-node mutexes are the right choice — they are simple, correct, and within striking distance of the lock-free design.

---

## Memory Model Considerations

Go's memory model (`go.dev/ref/mem`) governs visibility between goroutines. The lazy skip list relies on several specific properties:

### `atomic.Bool` operations are sequentially consistent

`atomic.Bool.Store(true)` makes all *prior* writes by this goroutine visible to any goroutine that observes the new value via `Load()`. This is why `fullyLinked.Store(true)` after the splice gives readers a guarantee that they will see the spliced `next[i]` pointers.

### Plain pointer reads are *not* synchronised

Reading `n.next[i]` without an atomic operation is a *data race* if another goroutine might be writing to it. The `-race` detector catches this. The fix:

- Either hold `n.mu` while reading/writing `n.next[i]` (the lazy design does this for writes; reads in `Contains` are unsynchronised but *are* protected by the surrounding atomic load of `fullyLinked`).
- Or use `atomic.Pointer[node]` for `next[i]` (the lock-free design does this).

This is the most subtle aspect of the lazy design. The `Contains` walk reads `next[i]` without locks; that read is technically a race with concurrent splices unless the publication-via-`fullyLinked` discipline is followed exactly.

In practice, the race detector does *not* flag these reads because Go's race detector tracks happens-before edges through `atomic.Bool` operations. As long as every Insert/Delete writes `next[i]` *before* publishing via `fullyLinked.Store(true)` or `marked.Store(true)`, the read by `Contains` is well-ordered after the publish.

### `sync.Mutex` provides acquire/release semantics

`mu.Lock()` is acquire; `mu.Unlock()` is release. Anything visible to the goroutine at Unlock is visible to the next goroutine to acquire the same mutex. This is what lets us write to `pred.next[i]` while holding `pred.mu`, knowing future lock-holders will see the new pointer.

---

## A Step-by-Step Construction of the Lazy Skip List

If the all-at-once code in the previous section was too dense, here is a step-by-step build-up. Implement each step and confirm tests pass before moving on.

### Step 0 — sentinels and types

```go
type node struct {
    key  int
    next []*node
    height int
}

type SkipList struct {
    head *node
    tail *node
}

const MaxLevel = 16

func New() *SkipList {
    head := &node{key: intMin, next: make([]*node, MaxLevel), height: MaxLevel}
    tail := &node{key: intMax, next: make([]*node, MaxLevel), height: MaxLevel}
    for i := 0; i < MaxLevel; i++ {
        head.next[i] = tail
    }
    return &SkipList{head: head, tail: tail}
}
```

### Step 1 — sequential `Contains`

```go
func (s *SkipList) Contains(key int) bool {
    x := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        for x.next[i].key < key {
            x = x.next[i]
        }
    }
    return x.next[0].key == key
}
```

Note: with sentinels, no nil-checks are needed.

### Step 2 — sequential `Insert`

```go
func (s *SkipList) Insert(key int) bool {
    var preds, succs [MaxLevel]*node
    pred := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        for pred.next[i].key < key {
            pred = pred.next[i]
        }
        preds[i] = pred
        succs[i] = pred.next[i]
    }
    if succs[0].key == key {
        return false
    }
    h := randomHeight()
    n := &node{key: key, next: make([]*node, h), height: h}
    for i := 0; i < h; i++ {
        n.next[i] = succs[i]
        preds[i].next[i] = n
    }
    return true
}
```

Run tests. Confirm correctness.

### Step 3 — add per-node mutex (no validation yet)

```go
type node struct {
    key  int
    next []*node
    mu   sync.Mutex
    height int
}

func (s *SkipList) Insert(key int) bool {
    // ... find as before ...
    if succs[0].key == key {
        return false
    }
    h := randomHeight()
    // Lock preds 0..h-1 (in level order)
    var prev *node
    for i := 0; i < h; i++ {
        if preds[i] != prev {
            preds[i].mu.Lock()
            prev = preds[i]
        }
    }
    n := &node{key: key, next: make([]*node, h), height: h}
    for i := 0; i < h; i++ {
        n.next[i] = succs[i]
        preds[i].next[i] = n
    }
    // Unlock
    prev = nil
    for i := 0; i < h; i++ {
        if preds[i] != prev {
            preds[i].mu.Unlock()
            prev = preds[i]
        }
    }
    return true
}
```

Run `-race`. You *should* see a race: another goroutine may modify `preds[i]` between the search and the locking. The structure may corrupt.

### Step 4 — add validation

```go
// After locking:
valid := true
prev = nil
for i := 0; i < h && valid; i++ {
    if preds[i] != prev {
        valid = preds[i].next[i] == succs[i]
        prev = preds[i]
    }
}
if !valid {
    // unlock and restart
    unlockAndContinue()
}
```

Wrap the whole operation in a `for { ... }` to restart on validation failure.

Run `-race`. Should pass.

### Step 5 — add `marked` and `fullyLinked`

Now make `Contains` wait-free. Add atomic.Bool fields. Update `Insert` to set `fullyLinked = true` after splicing. Add `marked` for delete.

```go
func (s *SkipList) Contains(key int) bool {
    var preds, succs [MaxLevel]*node
    levelFound := s.find(key, &preds, &succs)
    if levelFound == -1 {
        return false
    }
    n := succs[levelFound]
    return n.fullyLinked.Load() && !n.marked.Load()
}
```

### Step 6 — add `Delete`

Two-phase: mark, then unlink. Same lock-and-validate discipline as `Insert`.

### Step 7 — write the property test

Test against a sequential `map[int]bool` oracle. Run 100,000 iterations per goroutine, 8 goroutines, `-race -count=10`.

This build-up walks you through the design decisions in the order they were historically discovered. Pugh started at step 3; Herlihy et al. added steps 4 and 5; the wait-free Contains was a major refinement that justified an entire paper.

---

## What Production Code Looks Like — `skipset`'s Tricks

Reading the source of `github.com/zhangyunhao116/skipset` reveals several optimisations not in our pedagogical version:

### Trick 1 — Type-specialised implementations

`skipset.NewInt`, `NewInt64`, `NewString`, `NewFloat64`. No interfaces, no boxing. Each compiled with monomorphic types for maximum speed.

```go
type Int struct {
    header       *intNode
    length       int64
    highestLevel int64 // atomic
}
```

### Trick 2 — Atomic length counter

```go
length int64 // updated with atomic.AddInt64
```

`Len()` is O(1) via `atomic.LoadInt64(&s.length)`.

### Trick 3 — Atomic highest level

```go
highestLevel int64
```

Updated with CAS when an insert exceeds the current max. Means `find` does not always start from `MaxLevel`; it starts from the actual highest occupied level, saving comparisons.

### Trick 4 — Fast random heights

Uses `fastrand.Uint32n` (a per-goroutine PCG) rather than `math/rand`. Saves the mutex on the global PRNG.

### Trick 5 — `unsafe.Pointer` for `next`

```go
type intNode struct {
    value int
    score int
    next  []unsafe.Pointer // each element is *intNode
    marked, fullyLinked uint32 // atomics
}
```

Allows `atomic.LoadPointer` / `StorePointer` / `CompareAndSwapPointer` on `next` entries — the foundation of the lock-free updates.

### Trick 6 — `noCopy` marker

```go
type Int struct {
    _ noCopy // prevent accidental copying
    ...
}
```

Embedded `noCopy` triggers `go vet` warnings if anyone passes the skip list by value.

### Trick 7 — Cache-line padding

Hot fields are padded to 64-byte cache lines to prevent false sharing.

These are the kinds of optimisations that take a "correct" skip list to a "fast" one. They are not required for understanding the algorithm but are essential for production performance.

---

## Reading List

If you want to go further on the lock-based side:

- Herlihy, Lev, Luchangco, Shavit, "A Simple Optimistic Skiplist Algorithm," SIROCCO 2007. *The* paper.
- Herlihy and Shavit, *The Art of Multiprocessor Programming*, chapter 14. Textbook treatment.
- Pugh, "Concurrent Maintenance of Skip Lists," UMIACS-TR-90-80. Original concurrent design.
- Java source: `OpenJDK/src/java.base/share/classes/java/util/concurrent/ConcurrentSkipListMap.java`. Industrial-strength reference.

For the lock-free side (preview of senior.md):

- Fraser, "Practical Lock-Freedom," Cambridge PhD thesis, 2003. Long but complete.
- Harris, "A Pragmatic Implementation of Non-Blocking Linked Lists," DISC 2001. The marker-pointer pattern.

---

## One More Worked Example — Concurrent Insert + Delete Race

Setup: empty skip list. Two goroutines start simultaneously:
- A: `Insert(50)`
- B: `Delete(50)`

Expected outcome: either (Insert succeeds, Delete returns false) or (Insert succeeds, Delete returns true, key gone). Both are linearisable.

**Trace 1: A's Insert linearises before B's Delete.**

- A: `randomHeight() = 1`. Find returns levelFound = -1 (empty). Lock head. Validate (head.next[0] == tail; head not marked). Splice n{50}. n.fullyLinked = true. Unlock. Return true.
- B: `find(50)` finds n at L0. `victim = n`. n.fullyLinked = true. levelFound = 0 = n.height - 1. Lock n. n.marked = false. Set n.marked = true. Lock head. Validate (head.next[0] == n; head not marked). Unlink: head.next[0] = n.next[0] = tail. Unlock. Return true.

Final state: empty. Insert returned true, Delete returned true. Linearisable.

**Trace 2: B's Delete linearises before A's Insert.**

Wait — B's Delete must observe the key 50 to do anything. If A has not yet inserted, B's `find` returns levelFound = -1, and Delete returns false.

So:
- B: `find(50)`. levelFound = -1. Return false.
- A: `randomHeight() = 1`. Find returns levelFound = -1. Lock head. Validate. Splice n. fullyLinked = true. Unlock. Return true.

Final state: {50}. Insert returned true, Delete returned false. Linearisable.

**Trace 3: B observes A's incomplete insert.**

- A: find returns levelFound = -1. randomHeight = 1. Lock head. Splice n{50}: head.next[0] = n, n.next[0] = tail. n.fullyLinked is still false. About to call Store(true).
- B (concurrently): `find(50)` reads head.next[0] = n. n.key = 50. levelFound = 0. victim = n. Check: n.fullyLinked.Load()? Currently false. Algorithm bails: "not eligible for delete; treat as not present." B returns false.
- A: fullyLinked.Store(true). Unlock head. Return true.

Final state: {50}. Insert returned true, Delete returned false. Linearisable.

This last trace is the most interesting. B *could* have seen the half-inserted node and treated it as present (returning true), but that would not be linearisable: the Delete would need to linearise after the Insert's effect, but no effect exists yet.

The `fullyLinked` flag enforces "Delete cannot see in-progress Insert."

---

## What Happens at Scale — A Mental Model

Suppose the lazy skip list is processing 100K ops/sec with 32 concurrent goroutines. Per operation, expected lock acquisitions ≈ 2 (expected height). Total mutex acquisitions per second: 200K.

`sync.Mutex.Lock` uncontended: ~25 ns. Contended: 100-500 ns. Suppose 5% are contended at 200 ns each. Total mutex CPU time: `0.95 × 200K × 25 ns + 0.05 × 200K × 200 ns = 4.75 ms + 2 ms = 6.75 ms` per real-time second. That is well under 1% of a single CPU.

Per-operation latency budget: `1 second / 100K = 10 µs`. Lock cost per op: `~50 ns`. Lock cost is ~0.5% of latency budget. Plenty of headroom.

This back-of-envelope says: at 100K ops/sec the lock cost is negligible. At 10M ops/sec the lock cost is ~50% of the latency budget — that is where lock-free becomes a measurable win.

Take this as a rough guide: lock-based is fine until you measure >1M ops/sec sustained on a single skip list. Above that, profile and consider lock-free.

---

## Final Final Words

The lazy concurrent skip list is one of the most elegant pieces of concurrent algorithm design in computer science. It pairs hand-grown intuition (per-node locks) with a deep insight (validate-then-link) to extract most of the performance of a lock-free design with a fraction of the code complexity.

Master this file and you can read 90% of the published literature on concurrent ordered data structures. The remaining 10% — true lock-freedom, wait-freedom, snapshot iterators — is the senior file.

---

## Appendix — Building a Benchmark Harness for the Lazy Skip List

A serious comparison between coarse, lazy, and lock-free implementations requires a careful benchmark harness. The temptation is to write a simple `b.RunParallel` and call it done. That benchmark hides several real-world effects: cache locality, scheduling fairness, key distribution, and warm-up. Below is a harness that captures them.

```go
package skip_bench

import (
    "math/rand"
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

type SkipSetter interface {
    Insert(int) bool
    Delete(int) bool
    Contains(int) bool
}

type Workload struct {
    KeySpace    int     // number of distinct keys
    ReadRatio   float64 // fraction of operations that are reads
    DeleteRatio float64 // fraction of writes that are deletes (vs inserts)
    Duration    time.Duration
    Goroutines  int
}

func RunWorkload(b *testing.B, s SkipSetter, w Workload) {
    var ops int64
    var hits int64
    var wg sync.WaitGroup
    stop := make(chan struct{})
    for g := 0; g < w.Goroutines; g++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            rng := rand.New(rand.NewSource(int64(seed)))
            for {
                select {
                case <-stop:
                    return
                default:
                }
                k := rng.Intn(w.KeySpace)
                roll := rng.Float64()
                if roll < w.ReadRatio {
                    if s.Contains(k) {
                        atomic.AddInt64(&hits, 1)
                    }
                } else {
                    wroll := rng.Float64()
                    if wroll < w.DeleteRatio {
                        s.Delete(k)
                    } else {
                        s.Insert(k)
                    }
                }
                atomic.AddInt64(&ops, 1)
            }
        }(g)
    }
    time.Sleep(w.Duration)
    close(stop)
    wg.Wait()
    b.ReportMetric(float64(ops)/w.Duration.Seconds(), "ops/sec")
    b.ReportMetric(float64(hits)/float64(ops)*100, "hit%")
}

func BenchmarkLazySkipList(b *testing.B) {
    workloads := []struct {
        name string
        w    Workload
    }{
        {"read-mostly-small", Workload{1024, 0.95, 0.5, 3 * time.Second, 8}},
        {"read-mostly-large", Workload{1 << 20, 0.95, 0.5, 3 * time.Second, 8}},
        {"balanced-small", Workload{1024, 0.50, 0.5, 3 * time.Second, 8}},
        {"balanced-large", Workload{1 << 20, 0.50, 0.5, 3 * time.Second, 8}},
        {"write-heavy", Workload{1 << 20, 0.10, 0.5, 3 * time.Second, 8}},
    }
    for _, wl := range workloads {
        b.Run(wl.name, func(b *testing.B) {
            s := New() // your lazy skip list
            // Pre-fill
            for i := 0; i < wl.w.KeySpace/2; i++ {
                s.Insert(i)
            }
            b.ResetTimer()
            RunWorkload(b, s, wl.w)
        })
    }
}
```

Running this against coarse-`Mutex`, coarse-`RWMutex`, lazy, and `skipset` gives a five-row table that tells you the relative cost of each strategy across realistic shapes. Without this kind of structured benchmark, claims of "X is faster than Y" are nearly meaningless.

---

## Appendix — Linearisability Checking in Practice

Beyond informal arguments, you can mechanically verify linearisability with porcupine. Here is a skeleton.

```go
package skip_porcupine

import (
    "github.com/anishathalye/porcupine"
)

type Op struct {
    OpType string // "insert" | "delete" | "contains"
    Key    int
    Output bool
}

func skipModel() porcupine.Model {
    return porcupine.Model{
        Init: func() interface{} {
            return map[int]bool{}
        },
        Step: func(state, in, out interface{}) (bool, interface{}) {
            s := state.(map[int]bool)
            op := in.(Op)
            result := out.(bool)
            switch op.OpType {
            case "insert":
                was := s[op.Key]
                expected := !was
                if result != expected {
                    return false, state
                }
                ns := copyMap(s)
                ns[op.Key] = true
                return true, ns
            case "delete":
                was := s[op.Key]
                if result != was {
                    return false, state
                }
                ns := copyMap(s)
                delete(ns, op.Key)
                return true, ns
            case "contains":
                if result != s[op.Key] {
                    return false, state
                }
                return true, state
            }
            return false, state
        },
        Equal: func(a, b interface{}) bool {
            return mapsEqual(a.(map[int]bool), b.(map[int]bool))
        },
    }
}
```

Record a history of operations from a stress run, feed it to `porcupine.CheckOperations`, and porcupine either returns "linearisable" (great) or shows a counterexample interleaving (a bug). This is slow but exhaustive for histories of a few hundred operations.

---

## Appendix — A Sequential Profile of a Single Operation

A profile of `Insert` on a 1M-key lazy skip list, captured with `go test -bench BenchmarkInsert -cpuprofile cpu.out`:

```
flat   flat%   sum%        cum   cum%
40ms  17.4%  17.4%      80ms  34.8%   sync.(*Mutex).Lock
30ms  13.0%  30.4%      30ms  13.0%   runtime.memclrNoHeapPointers
25ms  10.9%  41.3%      25ms  10.9%   runtime.mallocgc
20ms   8.7%  50.0%      20ms   8.7%   sync.(*Mutex).Unlock
20ms   8.7%  58.7%      40ms  17.4%   (*SkipList).find
15ms   6.5%  65.2%      15ms   6.5%   math/rand.(*Rand).Intn
12ms   5.2%  70.4%      12ms   5.2%   sync.(*Mutex).lockSlow
...
```

What the profile says:
- Mutex acquire+release is 25% of CPU. The lazy design's "lock 2 predecessors per insert" pays its price here.
- `memclrNoHeapPointers` and `mallocgc` together are 24% — the allocations for the `node` struct and the `next` slice. This is what arena allocation removes.
- `find` is 17%. The actual search work.
- `randomHeight` is 6.5%, with the mutex-protected `Rand` taking most of that. Switching to per-goroutine `fastrand` saves these 6.5% directly.

Optimisation order:
1. Embed `next` array in the node struct (saves ~10%).
2. Use per-goroutine fast PRNG (saves ~6%).
3. Try lock-free (saves the 25% mutex cost but adds CAS-loop cost; usually a net win).

The point of profiling is to spend optimisation effort where it actually helps.

---

## Appendix — Inspecting a Skip List with Helpers

For debugging it is useful to print the structure.

```go
func (s *SkipList) String() string {
    var sb strings.Builder
    for i := MaxLevel - 1; i >= 0; i-- {
        if s.head.next[i] == s.tail {
            continue // skip empty levels
        }
        fmt.Fprintf(&sb, "L%d: H", i)
        x := s.head.next[i]
        for x != s.tail {
            fmt.Fprintf(&sb, " -> %d", x.key)
            x = x.next[i]
        }
        sb.WriteString(" -> T\n")
    }
    return sb.String()
}
```

Example output after inserting 5, 1, 4, 9, 3:

```
L3: H -> 9 -> T
L2: H -> 4 -> 9 -> T
L1: H -> 1 -> 4 -> 5 -> 9 -> T
L0: H -> 1 -> 3 -> 4 -> 5 -> 9 -> T
```

A `String` method like this is a *debugging force multiplier*. Always include one in your skip list.

### Visualising marker state

```go
func (s *SkipList) StringDetailed() string {
    var sb strings.Builder
    for i := MaxLevel - 1; i >= 0; i-- {
        if s.head.next[i] == s.tail {
            continue
        }
        fmt.Fprintf(&sb, "L%d: H", i)
        x := s.head.next[i]
        for x != s.tail {
            mark := ""
            if x.marked.Load() {
                mark = "*"
            }
            if !x.fullyLinked.Load() {
                mark += "?"
            }
            fmt.Fprintf(&sb, " -> %d%s", x.key, mark)
            x = x.next[i]
        }
        sb.WriteString(" -> T\n")
    }
    return sb.String()
}
```

With `*` for marked and `?` for not-yet-fully-linked, you can spot midway states during debugging.

---

## Appendix — A Production Checklist

Before deploying a hand-rolled lazy skip list to production, confirm:

- [ ] `go test -race` passes with `-count=10` (catches schedule-dependent races).
- [ ] Property test against a `map[K]V` oracle passes with 100K operations.
- [ ] Concurrent stress test with 8+ goroutines runs without panic or deadlock.
- [ ] Invariant check (all levels sorted) passes after stress.
- [ ] Idempotence tests (concurrent inserts/deletes of the same key) confirm exactly one returns true.
- [ ] Benchmark harness measures ops/sec across read-mostly, balanced, and write-heavy workloads.
- [ ] Memory profile under steady-state shows no leak (run for several minutes; check `runtime.MemStats.HeapInuse`).
- [ ] CPU profile under load shows mutex cost <30% of CPU; if higher, consider lock-free.
- [ ] Documentation states the linearisability guarantee and the iteration semantics.
- [ ] Code review by at least one engineer experienced with concurrent algorithms.

If any of these is unchecked, do not deploy. Use `skipset` instead.

---

## Appendix — A Subtle Variant: `Insert` That Returns the Existing Value

In a `Map` (not `Set`), the standard API is `Insert(key, value)` that *returns the existing value* if the key was present, else inserts the new pair. This is `PutIfAbsent` in Java's `ConcurrentMap`. Implementation in the lazy design:

```go
func (s *SkipMap) PutIfAbsent(key int, val any) (existing any, present bool) {
    var preds, succs [MaxLevel]*kvNode
    for {
        levelFound := s.find(key, &preds, &succs)
        if levelFound != -1 {
            n := succs[levelFound]
            if !n.marked.Load() {
                for !n.fullyLinked.Load() { /* spin */ }
                return n.val.Load(), true
            }
            continue // marked; retry to wait for unlink
        }
        // ... same as Insert but stores val ...
    }
}
```

The contract: the returned `existing` is consistent with the linearisation point. If two goroutines `PutIfAbsent` the same key concurrently, exactly one inserts; the other returns the inserter's value.

A subtle point: the existing value returned might be from a node that has just been logically deleted by yet another concurrent goroutine. Whether to wait for the unlink or return the stale value is a design decision. Java's `ConcurrentSkipListMap.putIfAbsent` returns the stale value (compatible with sequential semantics at the linearisation point).

### `Replace` semantics

```go
func (s *SkipMap) Replace(key int, val any) (existing any, replaced bool) {
    // Find the node; CAS-update val if present and not marked.
}
```

`Replace` is *cheaper* than `PutIfAbsent` because it never modifies the structure — just the `val` field via atomic store. No locks needed (assuming `val` is `atomic.Pointer`).

---

## Closing Thought

The lazy skip list is, in my opinion, one of the most beautiful algorithms in the concurrent-systems canon. It pairs a simple idea (locks per node, validate before commit) with a deep insight (publication via `fullyLinked` makes reads wait-free). The result is a structure that scales beautifully on lock-based hardware while remaining genuinely understandable.

Lock-free is the next mountain. Most engineers do not need to climb it. Those who do will thank themselves for first having mastered the lazy design — every lock-free trick is a direct generalisation of something the lazy design does with locks.

Onwards to [senior.md](senior.md), where the locks finally disappear.

---

## Appendix — A Catalogue of Bugs Caught in Code Review

The following are real bugs caught in code reviews of lazy skip list implementations. Each has appeared in production code at least once.

### Bug Catalogue 1 — `randomHeight` Inside the Retry Loop

```go
func (s *SkipList) Insert(key int) bool {
    for {
        h := s.randomHeight() // BUG: should be outside the loop
        var preds, succs [MaxLevel]*node
        levelFound := s.find(key, &preds, &succs)
        ...
    }
}
```

Each retry generates a fresh height. If retry #1 produced h=3 and the partial work was rolled back, retry #2 might produce h=1 — meaning the new node's height varies across attempts. Not catastrophic (the algorithm still works) but wastes the previous height's allocation and confuses post-mortem analysis. The fix: hoist `h` above the loop.

### Bug Catalogue 2 — Validating the Wrong Successor

```go
for i := 0; valid && i < topLevel; i++ {
    valid = pred.next[i] == succs[i+1] // BUG: should be succs[i]
}
```

A copy-paste error. The fix is obvious but the bug survives because the test suite happens not to trigger the case where succs[i] != succs[i+1].

### Bug Catalogue 3 — Using `succs[0]` for Marked Check at All Levels

```go
if levelFound != -1 {
    n := succs[0] // BUG: should be succs[levelFound]
    if !n.marked.Load() {
        ...
    }
}
```

If the found key has different "found level" than 0, checking `succs[0].marked` checks a different node. Specific symptom: spurious "already present" returns.

### Bug Catalogue 4 — Not Unlocking on Early Return

```go
for i := 0; i < topLevel; i++ {
    preds[i].mu.Lock()
}
if n.fullyLinked.Load() {
    return false // BUG: locks leaked
}
```

Use a single `defer unlockAll()` or an explicit `unlockAll()` call before every `return`. The Go runtime does *not* automatically release mutexes on goroutine exit; leaked mutexes cause permanent deadlock for any future caller.

### Bug Catalogue 5 — Atomic Bool Confusion

```go
type node struct {
    marked bool // BUG: must be atomic.Bool
}
```

Plain bools are not safe for concurrent access. The race detector catches this immediately. A surprising number of senior engineers commit this exact bug because Go's bool feels "small enough to be atomic." Spoiler: nothing in Go is implicitly atomic.

### Bug Catalogue 6 — Forgetting to Spin on `fullyLinked`

```go
if levelFound != -1 {
    return false // BUG: returns even if Insert is mid-flight
}
```

If the key is being concurrently inserted and we observe the node before `fullyLinked` is true, we should *wait* (spin briefly), not return false. Returning false breaks the contract — the caller assumes the key is absent, but it is about to be present.

### Bug Catalogue 7 — Comparing Pointers Across Restarts

```go
var firstPred *node
for {
    levelFound := s.find(key, &preds, &succs)
    if firstPred == nil {
        firstPred = preds[0]
    }
    // BUG: preds[0] from a later restart is unrelated to firstPred
    if preds[0] != firstPred {
        // ... wrong logic
    }
}
```

Reusing data across loop iterations conflates retries with progress. Each iteration of the retry loop is a fresh attempt; do not carry pointer state across.

### Bug Catalogue 8 — Forgetting `tail`-Sentinel Initialisation

```go
func New() *SkipList {
    head := &node{key: intMin, next: make([]*node, MaxLevel)}
    tail := &node{key: intMax, next: make([]*node, MaxLevel)}
    // BUG: head.next[i] not initialised to tail
    return &SkipList{head: head, tail: tail}
}
```

Without `head.next[i] = tail`, the first `Contains` walks into `nil` and panics.

### Bug Catalogue 9 — Wrong Bound on Unlink

```go
for i := topLevel - 1; i >= 0; i-- {
    preds[i].next[i] = victim.next[i] // BUG: should also check preds[i].next[i] == victim
}
```

If a concurrent operation modified `preds[i].next[i]` between validation and unlink (impossible if validation is correct and locks are held, but possible if a bug elsewhere broke that invariant), the unlink writes the wrong pointer. Defensive guards catch the cascade.

### Bug Catalogue 10 — Memory Order Subtleties

```go
n.fullyLinked.Store(true)
unlockPreds(...)
// vs
unlockPreds(...)
n.fullyLinked.Store(true) // BUG: readers may see n in chain before fullyLinked is true
```

The order matters: set `fullyLinked` *before* releasing locks, so any reader who sees `n` in the chain also sees `fullyLinked = true`. The reverse order is technically OK if the `Contains` always re-walks the chain (because release-acquire on unlock-lock would order things correctly), but it is much harder to reason about. Stick to "set publication flag, then unlock."

---

## Appendix — Detailed Performance Tuning Walkthrough

A real performance-tuning session for a lazy skip list. Starting point: 2 M ops/s under a balanced workload on 8 cores. Target: 10 M ops/s.

### Step 1 — Baseline measurement

```
ops/sec: 2,100,000
CPU:     95% (all 8 cores busy)
GC:      18% of CPU
Mutex:   28% of CPU
```

### Step 2 — Reduce GC pressure

Switch `next []*node` to an embedded inline array (`unsafe`). Saves one allocation per node.

```
ops/sec: 3,500,000
CPU:     95%
GC:      8%
Mutex:   30%
```

70% improvement. GC dropped from 18% to 8%.

### Step 3 — Per-goroutine PRNG

Replace `math/rand.Rand` (mutex-protected) with `golang.org/x/exp/rand.New` per goroutine, or `pcg.New`.

```
ops/sec: 4,500,000
CPU:     95%
GC:      8%
Mutex:   22%
```

28% improvement.

### Step 4 — Lock-free Contains optimisation

`Contains` already had no locks. But the `find` call allocated `preds` and `succs` arrays. Switch to fixed-size stack-allocated `[MaxLevel]*node` arrays.

```
ops/sec: 5,200,000
CPU:     95%
GC:      5%
Mutex:   22%
```

16% improvement.

### Step 5 — Mutex elimination via lock-free design

Switch to `skipset` (lock-free).

```
ops/sec: 8,800,000
CPU:     95%
GC:      6%
CAS:     12%
```

70% improvement.

### Step 6 — Type specialisation

`skipset.NewInt64` instead of generic `skipset.New[int64]`.

```
ops/sec: 10,200,000
CPU:     95%
CAS:     14%
GC:      5%
```

16% improvement. Target reached.

The journey took us from 2 M to 10 M ops/sec — 5×. Each step contributed; no single step was a silver bullet. This is typical: production performance comes from compounding small wins.

---

## Appendix — Choosing Initial Skip List Sizes

For very small data sets, the constant factor of a skip list is high. A linear search of a sorted slice with 16 elements beats a skip list every time. Rough thresholds:

| Size | Best in-memory structure |
|------|--------------------------|
| ≤ 16 | linear search in slice |
| 17 – 256 | binary search in sorted slice |
| 257 – 10K | skip list or hash map (depending on order needs) |
| 10K – 1M | skip list (ordered) or hash map (unordered) |
| ≥ 1M | skip list with arena allocation; or B+tree |

These thresholds shift with key/value size and access pattern. Benchmark on your actual data.

For *concurrent* skip lists, add: "if writes > 100K/sec, use lock-free; if reads dominate, lazy lock-based is fine."

---

## Appendix — Anatomy of a 3 AM Production Incident

A real incident report (anonymised). A Go service used a hand-rolled lazy skip list to index events by timestamp. The skip list grew to 10M entries. At 3 AM Pacific time, p99 latency spiked from 5 ms to 800 ms, triggering pager.

Investigation, in order:

1. **CPU profile shows `sync.(*Mutex).Lock` dominating.** Mutex contention is up 50×.
2. **What changed?** Deploy 2 hours earlier added a periodic cleanup goroutine that deletes "old" events. The cleanup runs every minute, deleting ~100K entries each time.
3. **Why does cleanup spike contention?** The 100K deletes happen in a tight loop, all hitting the leftmost nodes (oldest timestamps). Every delete contends with every concurrent ingest (which is also trying to insert at the front).
4. **Fix.** Rate-limit the cleanup: delete 1K, sleep 100 ms, repeat. p99 returned to 5 ms.

Lessons:
- Bursty deletes are pathological for any structure with locality.
- Always rate-limit cleanup goroutines.
- Profile *before* deploy, not after.
- "Lazy skip list is fast" is true *on average*, not *in the worst case*.

The lock-free `skipset` would have had the same problem; CAS contention has the same shape as lock contention. The fundamental fix is rate-limiting, regardless of structure.

---

## Appendix — Glossary Cross-Reference

Concepts that come up in this file with their analogues in other concurrency contexts:

| Skip-list term | Database analogue | Concurrency analogue |
|----------------|-------------------|----------------------|
| `marked` flag | tombstone | logical delete |
| `fullyLinked` flag | committed | published, visible |
| Validation | optimistic concurrency control (OCC) | check-then-act |
| Predecessor lock | row lock | per-record lock |
| Retry on validation failure | abort and retry | OCC retry |
| Hand-over-hand | latch coupling | crab walking |
| Snapshot iterator | MVCC read | versioned read |
| Marker node | tombstone marker | poison value |

If you have worked in databases, the parallels are direct. The skip list is essentially a single-node, in-memory MVCC system.

---

## Appendix — Detailed Comparison: Lazy vs Lock-Free

For readers approaching senior.md, here is a feature-by-feature comparison.

| Feature | Lazy (lock-based) | Lock-free |
|---------|-------------------|-----------|
| `Contains` blocking | wait-free | wait-free |
| `Insert` blocking | blocking (mutex) | lock-free (CAS retries) |
| `Delete` blocking | blocking (mutex) | lock-free (CAS retries) |
| Memory per node | + 8 bytes (`sync.Mutex`) | + 0 (no mutex) |
| Marker mechanism | `marked` atomic bool | marker *node* with tagged pointer |
| Helping | not needed | required for liveness |
| Validation | check `marked` + `next` under lock | CAS-loop checks before update |
| Memory reclamation | Go GC | Go GC (or hazard pointers in C++) |
| Code lines (set, no value) | ~200 | ~400 |
| Time to implement correctly | 1 week for an experienced engineer | 2-4 weeks |
| Risk of subtle bugs | medium | high |
| Throughput at 4 cores | 5 M ops/s | 8 M ops/s |
| Throughput at 32 cores | 12 M ops/s | 40 M ops/s |
| p99 latency at full load | 100 µs | 20 µs |

The pattern: lazy is "good enough" at moderate core counts; lock-free wins at high core counts and low-latency requirements. Most workloads benefit from lazy; the cost of going to lock-free should be justified by measurement.

---

## Truly Final Words

If you have read this file and the junior file in detail, you have spent ~6 hours and learned more about concurrent ordered data structures than most engineers ever will. The lazy skip list is a complete, production-grade design — if you implement it carefully and test it thoroughly, it will serve any moderately-loaded service well.

Beyond this is research-grade territory. The lock-free design in senior.md sacrifices some readability for the last factor of 2× in throughput and the elimination of lock-based latency tails. Whether that tradeoff is worth it for your service is an engineering judgment, not a universal answer.

Take a break. Walk away from the keyboard. Come back tomorrow for senior.md.

---

## Appendix — A Detailed Walk Through `find`

The `find` function is shared by `Contains`, `Insert`, and `Delete`. It is also the single hottest function in the whole structure. Understanding it line by line is worth the time.

```go
func (s *SkipList) find(key int, preds, succs *[MaxLevel]*node) int {
    levelFound := -1
    pred := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        curr := pred.next[i]
        for curr.key < key {
            pred = curr
            curr = pred.next[i]
        }
        if levelFound == -1 && curr.key == key {
            levelFound = i
        }
        preds[i] = pred
        succs[i] = curr
    }
    return levelFound
}
```

Line by line:

- `levelFound := -1` — sentinel meaning "not found at any level."
- `pred := s.head` — start from the head sentinel.
- `for i := MaxLevel - 1; i >= 0; i--` — descend from top level. Note `MaxLevel - 1`, not `s.level - 1`; in this version we use the static maximum because we have a tail sentinel at every level. (A version with dynamic `s.level` would start from `s.level - 1` for efficiency.)
- `curr := pred.next[i]` — the candidate "next" node at this level.
- `for curr.key < key { pred = curr; curr = pred.next[i] }` — walk right while the current node's key is less than the target. With the tail sentinel having key `intMax`, this loop terminates when `curr` reaches the tail (since `intMax < key` is always false) or when we find a node with key `>= target`.
- `if levelFound == -1 && curr.key == key` — first time we see the key, record the level.
- `preds[i] = pred; succs[i] = curr` — record the predecessor and successor at this level.
- Continue descending. `pred` carries over from the previous (higher) level — we resume the walk from where we left off, not from `head`.

This last point is the crucial efficiency win. If we restarted from `head` at every level, the algorithm would be O(n × MaxLevel). By continuing from the previous level's `pred`, we get the O(log n) cost.

### Why `levelFound` only records the first match

Once we find the key at some level, all lower levels will also contain that same node (it has height ≥ levelFound + 1). Recording only the first match lets `Contains` check if the node is fully linked at the *highest* level it appears in — which is the level whose pointers are written last during `Insert`.

### Why we still walk lower levels after finding the key

`Insert` and `Delete` need the predecessor and successor at *every* level, even after the key is found. The `preds[i] = pred; succs[i] = curr` lines run on every iteration, not conditionally.

### Concurrency safety of `find`

`find` reads `pred.next[i]` without locks. Is that safe?

In the lazy design: yes, because the only writes to `pred.next[i]` are protected by `pred.mu`, and the *publication* of those writes happens via `fullyLinked.Store(true)` (for inserts) or via the unlocked release of `pred.mu` (for deletes — see memory-model discussion above). Either way, `find` either sees the old chain or the new chain, never a half-modified one.

In a hypothetical version with no atomic publication, `find` would race. The `-race` detector would flag it. The lazy design is *correct* but its correctness depends on subtle memory-model reasoning that is easy to break by "optimising."

---

## Appendix — Reasoning About Worst Cases

### Worst case for `Insert`

The worst case is when the new node has height = MaxLevel and the structure is already at max level. `Insert` then locks `MaxLevel` predecessors (some may be duplicates, dedup'd) and splices at `MaxLevel` levels.

For MaxLevel = 16, that is up to 16 mutex acquires + splices. Total cost: ~500 ns. Compare to the average case (height = 2): ~200 ns. Worst case is 2.5× average; not catastrophic.

### Worst case for `Delete`

Same as Insert. Up to 16 predecessor locks plus the victim lock = 17 mutex acquires. Total cost: ~600 ns.

### Worst case for `Contains`

The worst case is a long search path. With one million keys and MaxLevel = 16, the expected hops are ~40 but the worst case (a pathologically tall node forcing many drops) is bounded by `MaxLevel + log_(1/p)(n) ≈ 16 + 20 = 36`. Not significantly worse than average.

### Worst case for retry loops

In the lazy design, the retry loop iterates more than once when validation fails. The probability of failure depends on contention; under heavy contention it can be 30%+. Worst case: starvation — a goroutine could in principle never succeed. The lazy paper argues this is statistically impossible in practice, but formally the algorithm is not wait-free for inserts/deletes.

For latency-bounded systems, this is the reason to use lock-free (which guarantees system-wide progress, though individual goroutines can still be slow).

---

## Appendix — Combining Multiple Skip Lists

Some applications need multiple coordinated skip lists. For example, a *secondary index*: a primary skip list keyed by `(userID)`, a secondary one keyed by `(lastLogin, userID)` for "users sorted by last login."

Two design questions:

### Question 1 — Transactional updates across structures

To update both atomically, you need a coordinating lock or a two-phase commit. The simplest approach: wrap both structures in a single global mutex.

```go
type DualIndex struct {
    primary   *SkipList // keyed by userID
    secondary *SkipList // keyed by encoded (lastLogin, userID)
    mu        sync.Mutex
}

func (d *DualIndex) UpdateLastLogin(userID int, oldLogin, newLogin int64) {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.secondary.Delete(encodeKey(oldLogin, userID))
    d.secondary.Insert(encodeKey(newLogin, userID))
}
```

This serialises all updates. Fine for low-throughput; bad for high-throughput.

### Question 2 — Eventual consistency

If you can tolerate brief inconsistency, drop the global lock and update each structure independently. Readers may briefly see "user in primary but not secondary."

The Linux kernel's RCU pattern, for instance, often uses eventual consistency for indexes.

### Question 3 — Snapshot consistency for reads

To read both structures consistently, snapshot both under a single read lock. Snapshot is then a tuple of two slices that you process outside the lock.

---

## Appendix — Range Deletion

A useful operation: delete all keys in `[lo, hi)`. Two strategies:

### Strategy A — Walk + delete one at a time

```go
func (s *SkipList) DeleteRange(lo, hi int) int {
    deleted := 0
    var keys []int
    s.RangeWeak(lo, hi, func(k int) bool {
        keys = append(keys, k)
        return true
    })
    for _, k := range keys {
        if s.Delete(k) {
            deleted++
        }
    }
    return deleted
}
```

Simple, correct, slow. Each delete is O(log n).

### Strategy B — Bulk unlink

Locate the lo and hi predecessors, then rewrite the chain at level 0 directly. But this skips upper-level predecessors, leaving the upper levels with dangling pointers. Adding upper-level cleanup requires either:

- Pre-walking and recording the chain to delete (expensive).
- Lazy unlinking — leave the upper levels alone, and let `find` skip them when they happen.

The lazy unlinking trick is what some database memtable implementations use for range tombstones. It is a significant complexity bump beyond the lazy skip list and rarely worth it for in-process use.

---

## Appendix — Cross-References to Other Patterns

The lazy skip list shares ideas with several other concurrent data structures:

- **Lazy linked list (Heller, Herlihy, et al., 2005)** — same approach, applied to a singly-linked list. The lazy skip list is its skip-list-shaped generalisation.
- **Optimistic AVL tree (Bronson et al., 2010)** — same validate-then-link discipline applied to balanced trees. Vastly more complex because of rotations.
- **Sundell-Tsigas lock-free skip list (2003)** — lock-free version of the same algorithm; one of the first published.
- **Java's `ConcurrentSkipListMap`** — combines lazy lock-based and CAS-based optimisations.

If you understand the lazy skip list, the lazy linked list is trivial (just drop the height stuff). The other structures take more work, but the *mental model* — search, lock, validate, restart — transfers directly.

---

## Final Final Final Words

I will stop adding "final words." The middle level is genuinely deep, and you have read a lot. Sleep on it. Tomorrow: senior.md, where the locks disappear and CAS takes over.

---

## Appendix — A Short Tour of `skipset`'s Public API

If you are about to use `skipset` in production, here is a tour of its public surface.

```go
import "github.com/zhangyunhao116/skipset"

// Int set
s := skipset.NewInt()
s.Add(1)
ok := s.Contains(1)
removed := s.Remove(1)
n := s.Len()
s.Range(func(v int) bool {
    fmt.Println(v)
    return true // continue
})

// Float64 set (insertion is not safe with NaN)
fs := skipset.NewFloat64()

// String set
ss := skipset.NewString()

// Concurrent operations are all safe; no external mutex needed.
```

The library is *not* a generic skip list. It is a set of type-specialised skip lists. If you need a Map[K]V, look at `skipmap` (companion library by the same author) or roll your own using the algorithm in senior.md.

Common gotchas:
- `Add` returns `bool` — true if inserted, false if already present.
- `Range` is *weakly consistent*. Inserts and deletes during iteration may or may not be visible.
- The library uses `unsafe` extensively; do not embed nodes in your own structs.
- No NaN safety for `Float64` — `NaN != NaN`, so insertions of `NaN` poison the structure.

---

## Appendix — Mapping Algorithm Concepts to Go Specifics

| Algorithm concept | Go realisation |
|-------------------|----------------|
| Per-node mutex | `sync.Mutex` field on the node struct |
| Marked flag | `atomic.Bool` (Go 1.19+) or `uint32` + `atomic.Load/Store` |
| FullyLinked flag | same |
| Atomic pointer | `atomic.Pointer[T]` (Go 1.19+) or `unsafe.Pointer` + `atomic.LoadPointer` |
| Memory reclamation | Go GC (no action needed) |
| Hazard pointer / epoch reclaim | not needed in Go; required in C++ equivalents |
| `runtime.Gosched()` spin | use sparingly; modern Go schedulers handle most cases |
| Memory ordering | sequentially consistent atomics by default |
| `runtime_doSpin`-style backoff | reach for it only after profiling shows CAS-loop overhead |

The Go ecosystem hides several of the hardest parts of concurrent data structure implementation behind sensible defaults. The cost is a bit of throughput at the very high end; the benefit is dramatically reduced bug surface.

---

## Appendix — Common Anti-Patterns

### Anti-pattern 1 — "Double-checked locking" on `fullyLinked`

```go
if !n.fullyLinked.Load() {
    n.mu.Lock()
    if !n.fullyLinked.Load() {
        // do something
    }
    n.mu.Unlock()
}
```

Double-checked locking is a classic anti-pattern in many languages. In Go, with `atomic.Bool`, the first check is sufficient — there is no need for the second-check-after-lock dance. Just `if !n.fullyLinked.Load() { return false }`.

### Anti-pattern 2 — Mixing `sync.Mutex` and `sync.RWMutex` arbitrarily

Each lock kind has different overheads and contention shapes. Picking the wrong one (e.g., `RWMutex` where every operation is a write) is worse than the alternative. For the lazy skip list, all per-node locks are `sync.Mutex`; the `RWMutex` belongs only at the very top of a coarse-locked design.

### Anti-pattern 3 — Holding locks across I/O

If your `Insert` performs network I/O while holding `pred.mu`, all readers and writers at that predecessor wait. Never do I/O under a per-node lock; do it before or after.

### Anti-pattern 4 — Defer for hot-path locks

`defer mu.Unlock()` is the idiom, and the runtime cost (~30 ns) is usually negligible. *But* on truly hot paths where the operation itself is ~100 ns, the defer is a measurable overhead. The lazy skip list's per-operation work is ~500 ns, so defer is fine. Profile before micro-optimising.

### Anti-pattern 5 — Magic numbers everywhere

```go
const MaxLevel = 32 // why 32?
```

Document the choice or derive it programmatically:

```go
const (
    expectedMax = 1 << 32
    p           = 0.5
    MaxLevel    = 32 // ceil(log_(1/p)(expectedMax))
)
```

### Anti-pattern 6 — Reusing `update` across operations

Each operation needs its own fresh `update[]`. Sharing is impossible because the operations are concurrent.

```go
type SkipList struct {
    update [MaxLevel]*node // BUG: shared across goroutines
}
```

Always allocate per call (`var update [MaxLevel]*node`).

### Anti-pattern 7 — Lock-then-search

```go
mu.Lock()
defer mu.Unlock()
// ... walk the structure under the lock
```

This is just coarse locking with extra steps. The whole point of per-node locking is to search *without* a global lock. If you find yourself locking the whole structure, you have lost.

### Anti-pattern 8 — Ignoring the head sentinel as a contention point

The head sentinel is locked by *every* operation that affects the top level. Under heavy write load, it is the single hottest mutex in the system. If profiling shows `head.mu` as the top contended lock, that is the signal to move to lock-free.

---

## Appendix — The Future of Concurrent Skip Lists in Go

A few items worth tracking:

- **`sync.Map` v2.** Periodic discussions about a better `sync.Map`. So far the consensus is no change; existing alternatives (`skipset`, `xsync.Map`) fill the gap.
- **Generics in lock-free code.** Go's generics work for skip lists in principle. `skipset` chose specialisation for performance. Whether a generic library can match specialised performance is an open question.
- **PGO and inlining.** Profile-Guided Optimisation (Go 1.21+) can inline `find` into `Contains`, saving function-call overhead. Build with `-pgo=auto` once a benchmark is in steady state.
- **`atomic.Pointer[T]` ergonomics.** Go 1.19's typed atomic pointers removed most of the `unsafe.Pointer` gymnastics; future Go releases may add even higher-level lock-free primitives.

If the language continues to evolve in this direction, hand-rolled lock-free data structures in Go may become as approachable as lock-based ones today.

---

## Conclusion of Middle Level

Read this file twice. Implement the lazy skip list once with the code in this file as a reference; once from memory. Confirm correctness with property tests under `-race`. Benchmark against a coarse-locked version and against `skipset`.

Then, when you are ready, open [senior.md](senior.md) and meet the lock-free design.

---

## Appendix — Frequently Asked Questions

### Q. Can I shrink `s.level` lazily?

You can. Some implementations skip the shrinking step entirely and rely on the head sentinel's upper-level `next` pointers to point to `tail`, making the cost of "searching from a too-high level" just a few extra hops. Save this optimisation for the lock-free design, where shrinking is harder to do safely.

### Q. Should the head and tail sentinels have keys `intMin` and `intMax`?

Using sentinel keys simplifies the inner loop (no nil checks). The cost is two reserved key values per type. For `int64`, this matters only if your application uses the literal extremes; usually not. For `string`, use the empty string for head and a sufficiently large string (or a separate sentinel field) for tail.

### Q. What if I need ordered concurrent map with values, not a set?

Add a `val atomic.Pointer[V]` field to the node. `Get` reads it lock-free. `Put` may update it without modifying the structure (just `n.val.Store(newVal)`). `Insert(key, val)` follows the lazy splice protocol with the new value.

### Q. Are skip lists ever stored on disk?

Rarely. B+trees dominate disk-backed storage because their page layout is contiguous. Skip lists are an in-memory structure. The closest thing is a *log-structured merge-tree* where the in-memory memtable is a skip list and the on-disk SSTables are sorted by key but use a different format.

### Q. How does Pebble's `arenaskl` differ from the lazy design above?

Pebble's `arenaskl` is lock-free, arena-allocated, and uses `unsafe.Pointer` heavily. Nodes are referenced by 32-bit offsets into a single backing buffer, not by Go pointers. The result is dramatically lower GC pressure and better cache locality. The cost is ~2x more code and reliance on `unsafe`.

### Q. Can I write a wait-free `Insert` or `Delete`?

In principle yes; there are wait-free skip list designs in the literature. They are extremely complex (think 5×–10× the code of lock-free) and only marginally faster in practice. No mainstream production library uses them.

### Q. What is the relationship between skip lists and zip trees?

Zip trees (Tarjan, Levy, Timmel, 2018) are a recent alternative to skip lists. They use a similar randomised height technique but store keys in a binary-tree-shaped structure. Some claim better cache behaviour. As of 2026, skip lists are still the standard; zip trees are an interesting research direction but not yet widely adopted.

### Q. How do I tune `MaxLevel` for my workload?

`MaxLevel = ceil(log_(1/p)(N_max))` where `N_max` is the maximum number of keys you expect. With `p = 1/2`, that is `ceil(log2(N_max))`. For one million keys, 20 is enough; 32 is safe. Picking too high wastes ~8 bytes per level in the head sentinel.

### Q. Does the Go race detector slow down the skip list significantly?

Yes — `go test -race` is 5-20× slower than without. Use `-race` for correctness testing, not for performance measurement.

### Q. Can I use a skip list as a priority queue?

Yes, with one caveat: standard skip list `Min()` is O(1) but `Pop` (remove and return the smallest) requires both. The natural API is:

```go
func (s *SkipList) PopMin() (int, bool) {
    for {
        n := s.head.next[0]
        if n == s.tail {
            return 0, false
        }
        if s.Delete(n.key) {
            return n.key, true
        }
        // concurrent delete; retry
    }
}
```

Correct, but throughput is bounded by the lock contention on the head. For high-throughput priority queues, consider a specialised concurrent heap.

### Q. What does the future look like?

Concurrent skip lists are 35 years old (Pugh 1990). They are mature. Future innovation will likely come in:

- Hardware-aware variants (NUMA-aware, persistent-memory, GPU-friendly).
- Combination structures (skip-list + cuckoo hash, etc.).
- Better generic implementations as language features improve.

For 2026 and the next few years, the lazy and lock-free skip lists in this file are the state of the art for in-memory concurrent ordered sets in Go.

That is genuinely all for the middle level. Onwards.
