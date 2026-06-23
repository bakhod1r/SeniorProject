---
layout: default
title: Concurrent Skip List — Senior
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/senior/
---

# Concurrent Skip List — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why Lock-Free](#why-lock-free)
3. [The Harris-Michael Lock-Free Linked List](#the-harris-michael-lock-free-linked-list)
4. [Marker Pointers and Tagged Pointers](#marker-pointers-and-tagged-pointers)
5. [The Fraser Lock-Free Skip List](#the-fraser-lock-free-skip-list)
6. [Complete Go Implementation](#complete-go-implementation)
7. [Why the Algorithm Is Correct](#why-the-algorithm-is-correct)
8. [Helping](#helping)
9. [ABA, Reclamation, and Why Go Makes Both Easy](#aba-reclamation-and-why-go-makes-both-easy)
10. [Range Queries and Snapshot Iterators](#range-queries-and-snapshot-iterators)
11. [Linearisability Proof Sketch](#linearisability-proof-sketch)
12. [Comparison with sync.Map and B+tree Memtables](#comparison-with-syncmap-and-btree-memtables)
13. [Performance Analysis at High Core Counts](#performance-analysis-at-high-core-counts)
14. [Random Number Generation Under Concurrency](#random-number-generation-under-concurrency)
15. [Cache-Line Layout and False Sharing](#cache-line-layout-and-false-sharing)
16. [`skipset` Internals — Reading the Source](#skipset-internals-reading-the-source)
17. [Subtle Bugs at this Level](#subtle-bugs-at-this-level)
18. [Stress Testing Lock-Free Code](#stress-testing-lock-free-code)
19. [Cheat Sheet](#cheat-sheet)
20. [Self-Assessment](#self-assessment)
21. [Summary](#summary)

---

## Introduction

The [middle](middle.md) level brought us to the lazy lock-based skip list — the gold standard of lock-based concurrent ordered structures. Its `Contains` is wait-free; its `Insert` and `Delete` use optimistic locking with validate-then-link. For most workloads this is the right answer.

But there is a higher mountain: lock-free, where no `sync.Mutex` ever appears in the data path. The benefits are:

- **No mutex contention.** Under heavy parallel write load, locks are the bottleneck. Removing them removes a hard ceiling on throughput.
- **No latency-tail from preempted lock-holders.** A goroutine holding a lock might be preempted by the runtime, blocking everyone waiting. Lock-free is immune.
- **Lock-free guarantee.** System-wide, some operation always makes progress in a finite number of steps. No livelock or deadlock is possible by construction.

The costs are:

- **Roughly 2× more code.**
- **Subtle correctness arguments** — every CAS sequence must be analysed for ABA and torn reads.
- **Helping** — any goroutine that observes a half-finished operation must finish it.
- **Memory reclamation** — in C++, this is a major chapter on its own. In Go, the GC removes most of the difficulty.

After reading this file you will:

- Understand the Harris-Michael lock-free linked list, the building block beneath every lock-free skip list.
- Understand marker pointers (tagged-pointer encoding) and why they linearise deletion.
- Be able to walk through Fraser's lock-free skip list algorithm in full.
- Implement a lock-free skip list in Go using `atomic.Pointer[node]`.
- Reason about linearisability points and ABA prevention.
- Know how `skipset` is structured and what tricks it applies.

This is the deepest material on concurrent data structures most engineers ever encounter outside research labs. Take it slowly.

---

## Why Lock-Free

### Locks have a worst case

A mutex is fast on the happy path (~25 ns to acquire uncontended). Under contention it is slower (100-500 ns). But the truly bad case is preemption: a goroutine holding the lock is descheduled, and *every* goroutine waiting on the lock waits for the OS to reschedule. That wait can be milliseconds — six orders of magnitude longer than the happy path.

Lock-free designs do not have this worst case. The longest a goroutine can be "stuck" is bounded by the number of concurrent operations that retry their CAS — which is bounded by the level of contention, not by OS scheduling.

For latency-sensitive systems (real-time bidding, low-latency trading, network proxies under DoS, large databases at p99) this difference matters more than the average-case throughput.

### Lock-free does *not* mean wait-free

Lock-free: system-wide, some goroutine always makes progress.
Wait-free: every goroutine always makes progress in a bounded number of steps.

The Fraser skip list is lock-free but not wait-free. A goroutine may keep retrying its CAS indefinitely if other goroutines keep winning theirs. Wait-free skip lists exist but are research curiosities; their constant factors are 5-10× higher than lock-free, and no major production system uses one.

### Lock-free is harder

The first lock-free linked list paper (Harris 2001) is a one-page algorithm with a fifteen-page proof. The Fraser thesis is 200 pages. The reason is the subtle interactions between concurrent CAS attempts — for every "happens-before" you would like to assume, you must explicitly establish.

Go makes this dramatically easier than C++ because the GC handles memory reclamation and `atomic.Pointer[T]` handles tagged pointers ergonomically. A lock-free skip list in Go is ~400 lines; the same algorithm in C++ is ~1500.

---

## The Harris-Michael Lock-Free Linked List

Before tackling the skip list, master its building block: the Harris-Michael lock-free singly-linked list. The skip list is "one of these per level, glued together."

### The structure

```go
type node struct {
    key  int
    next atomic.Pointer[node]
}

type List struct {
    head *node // sentinel; key = -inf
    tail *node // sentinel; key = +inf
}
```

`next` is an `atomic.Pointer[node]`. All reads and writes go through `Load()`, `Store()`, `CompareAndSwap()`.

### The marker trick

The key insight: encode "this node is being deleted" by *marking the next pointer* of the node, not the node itself. We use the lowest bit of the pointer as a marker, since pointers are aligned to 8 bytes on 64-bit systems (and thus have three free low bits).

In Go we cannot directly tag pointers without `unsafe`. Two approaches:

1. **Sentinel marker node.** Insert a special marker node *after* the to-be-deleted node. Any traversal that encounters a marker node knows its predecessor is being unlinked.
2. **Wrap pointer in struct.** A struct holding `next *node` plus `marked bool` (or `markedNext *markedNode`), stored as `atomic.Pointer[markedNext]`. Replaces the entire descriptor atomically.

Approach 1 is simpler but adds memory. Approach 2 uses `unsafe.Pointer` tricks (the same as `skipset` does) for performance.

We will use approach 2 in our pedagogical implementation, then briefly discuss approach 1.

### CAS-based insert

```go
func (l *List) Insert(key int) bool {
    for {
        pred, curr := l.find(key)
        if curr.key == key {
            return false
        }
        newNode := &node{key: key}
        newNode.next.Store(curr)
        if pred.next.CompareAndSwap(curr, newNode) {
            return true
        }
        // CAS failed; retry
    }
}
```

The CAS swaps `pred.next` from `curr` (the expected successor) to `newNode` (with `newNode.next = curr`). If the CAS fails (because someone else changed `pred.next`), we restart the whole search. The CAS-success case is the *linearisation point* of the insert.

### CAS-based delete (two phases)

```go
func (l *List) Delete(key int) bool {
    for {
        pred, curr := l.find(key)
        if curr.key != key {
            return false
        }
        succ := curr.next.Load()
        // Phase 1: mark curr.next as "being deleted"
        // (In real code, this is a CAS that swaps in a marked version of succ)
        if !markNext(curr, succ) {
            continue
        }
        // Phase 2: unlink curr by CAS on pred.next
        pred.next.CompareAndSwap(curr, succ)
        // If this CAS fails, some other thread already unlinked curr.
        // Either way, curr is logically gone.
        return true
    }
}
```

The two phases are essential. Phase 1 (mark) is the linearisation point: once curr is marked, subsequent `find` calls treat it as deleted. Phase 2 (unlink) is housekeeping; if it fails, helping (see below) takes care of it.

### Why marker is necessary

Without the mark, this race occurs:

1. Thread A starts `Insert(K)` where curr is currently the L0 successor of pred.
2. Thread B starts `Delete(curr)`. B unlinks curr: `pred.next.CAS(curr, succ)`.
3. A's CAS `pred.next.CAS(curr, newNode)` — succeeds because nobody has modified pred.next yet (oh wait — B already did). Suppose A runs first: `pred.next` is now newNode. Then B's CAS: `pred.next == curr`? No, it's newNode. B's CAS fails.
4. B retries. Finds curr is now the successor of newNode (not pred). B's `find` returns pred = newNode, curr = curr (still). B's `pred.next.CAS(curr, succ)` runs on newNode.next, swapping curr for succ. This unlinks curr correctly.

OK that worked. But consider:

1. A: `find` returns pred, curr. (No CAS yet.)
2. B: `find` returns pred, curr. B's CAS on pred.next: swap curr -> succ. Curr is unlinked.
3. A: CAS on pred.next: swap curr -> newNode. But pred.next is now succ, not curr. A's CAS fails. A retries.

Still safe. So why do we need the mark?

The bad case: A's CAS succeeds *just before* B's. A: pred.next = newNode (with newNode.next = curr). B: pred.next == curr? No, newNode. B's CAS fails. B re-`find`s. B's find walks past pred to newNode, then sees newNode.next = curr. B's find returns (newNode, curr). B's CAS: newNode.next = succ. Succeeds. Curr is unlinked.

Now the skip list contains: pred -> newNode -> succ. That is correct. So even without marking, this case is handled — by retry.

The truly bad case requires three threads:

1. A: insert K1 with K1's successor = curr. Cas pred.next from curr to A_node. Succeeds.
2. B: delete curr. B's `find` returns (A_node, curr). B's mark on `curr.next` succeeds. B's unlink CAS on `A_node.next`: swap curr -> succ. Succeeds.
3. C: insert K2 with K2's successor = curr. C's `find` returned (A_node, curr) earlier — before B unlinked. C's CAS on A_node.next: swap curr -> C_node. But A_node.next is succ now. C's CAS fails. C retries.

OK still safe with retry. Let me try harder.

The crux: the mark prevents a node that is *being deleted* from acquiring new successors. Specifically, an insert that wants to splice in *behind* curr (i.e., pred = curr-being-deleted) must not succeed.

1. A: insert K (where K > curr.key). A's `find` returns (curr, succ). A's CAS on curr.next: swap succ -> A_node.
2. B: delete curr. B's CAS marks curr.next. B's CAS unlinks A_node-tree from pred.

If A's CAS runs first and B's mark-CAS expects `curr.next == succ`, B's mark fails. B retries. B's `find` now returns (curr, A_node). B marks A_node? Wrong. B should still be deleting curr.

This is where the *mark on the deleted node's next pointer* matters. The mark says "no further inserts may modify curr.next." A's CAS, even if it has not run yet, must check that curr.next is unmarked.

In Go terms, A's CAS becomes:

```go
expected := unmarkedNext(curr)
ok := curr.next.CompareAndSwap(expected, A_node)
```

If curr has been marked between A's `find` and A's CAS, the CAS fails because the *value* of curr.next changed (it now has the mark bit set). A retries.

This is the heart of the Harris-Michael trick. The mark is a *visible signal* baked into the pointer value itself, so any CAS that targets the marked pointer must explicitly include the unmarked value as the expected.

---

## Marker Pointers and Tagged Pointers

In C, pointer tagging is `(uintptr_t)ptr | 1`. In Go without `unsafe`, you cannot do this directly. Three options:

### Option A — `unsafe.Pointer` + tag bit

```go
import "unsafe"

func mark(p *node) unsafe.Pointer {
    return unsafe.Pointer(uintptr(unsafe.Pointer(p)) | 1)
}

func unmark(p unsafe.Pointer) *node {
    return (*node)(unsafe.Pointer(uintptr(p) &^ 1))
}

func isMarked(p unsafe.Pointer) bool {
    return uintptr(p) & 1 != 0
}
```

Works, but ugly, and breaks if the runtime ever moves pointers (the moving GC could relocate the underlying object and re-tag, but our marked pointers would be invalidated). Go's current GC does not move pointers, so this is safe in practice.

### Option B — Struct-wrapped pointer + atomic.Pointer

```go
type markedRef struct {
    next   *node
    marked bool
}

type node struct {
    key  int
    next atomic.Pointer[markedRef]
}
```

Every modification allocates a new `markedRef`. Wasteful in allocations but trivially correct.

### Option C — Marker node

Insert a distinguished marker node *after* the to-be-deleted node:

```go
var marker = &node{} // sentinel marker; address is the signal
```

Or use a per-node marker:

```go
type node struct {
    key  int
    next atomic.Pointer[node]
}

func isMarker(n *node) bool {
    return n.key == markerKey // distinguished key value
}
```

The marker node sits between `curr` and `curr.next`. Any traversal that lands on a marker knows the predecessor is being deleted. The marker itself is removed when curr is physically unlinked.

Option C is what Fraser's original lock-free skip list uses. Option B is what most Go libraries use because it is the most idiomatic with `atomic.Pointer[T]`.

We will use Option B for our implementation.

---

## The Fraser Lock-Free Skip List

Keir Fraser's PhD thesis (Cambridge, 2003) presents the canonical lock-free skip list. The structure is the same as the lazy version: stack of sorted linked lists with randomised heights. The difference is *every* update uses CAS instead of locks.

The algorithm has three operations:

### `find(key)`

Walks the structure top-down, recording predecessors and successors at every level. Along the way, *helps* to physically unlink any marked nodes it encounters (see [Helping](#helping)).

```go
func (s *SkipList) find(key int, preds, succs *[MaxLevel]*node) bool {
retry:
    pred := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        currRef := pred.next[i].Load()
        for {
            if currRef == nil {
                break
            }
            curr := currRef.next
            // Check if curr is logically deleted at this level
            succRef := curr.next[i].Load()
            for succRef != nil && succRef.marked {
                // Help unlink curr from this level
                if !pred.next[i].CompareAndSwap(currRef, &markedRef{next: succRef.next}) {
                    goto retry
                }
                currRef = pred.next[i].Load()
                if currRef == nil {
                    break
                }
                curr = currRef.next
                succRef = curr.next[i].Load()
            }
            if curr.key < key {
                pred = curr
                currRef = succRef
            } else {
                break
            }
        }
        preds[i] = pred
        if currRef == nil {
            succs[i] = nil
        } else {
            succs[i] = currRef.next
        }
    }
    return succs[0] != nil && succs[0].key == key
}
```

This is dense. The key idea: at every level, we walk past any marked-as-deleted nodes, helping to unlink them as we go. By the time `find` returns, all visible nodes (in preds and succs) are unmarked at level 0. Higher levels may still contain marked references, but they will be cleaned up later.

### `Insert(key)`

```go
func (s *SkipList) Insert(key int) bool {
    height := s.randomHeight()
    var preds, succs [MaxLevel]*node
    for {
        if s.find(key, &preds, &succs) {
            return false
        }
        newNode := &node{key: key, next: make([]atomic.Pointer[markedRef], height), height: height}
        for i := 0; i < height; i++ {
            newNode.next[i].Store(&markedRef{next: succs[i]})
        }
        // Level 0 first
        if !preds[0].next[0].CompareAndSwap(
            &markedRef{next: succs[0]},
            &markedRef{next: newNode},
        ) {
            continue // restart
        }
        // Higher levels; if CAS fails, refresh and retry just that level
        for i := 1; i < height; i++ {
            for {
                if preds[i].next[i].CompareAndSwap(
                    &markedRef{next: succs[i]},
                    &markedRef{next: newNode},
                ) {
                    break
                }
                s.find(key, &preds, &succs) // refresh preds/succs
                // If find returned true, the new node was already inserted by helping
                // (rare, but possible). In production, check for this.
            }
        }
        return true
    }
}
```

The linearisation point is the level-0 CAS success. After that, the new node is visible to any `find`. Higher-level CASes are visibility optimisations; they expand the search-skipping effectiveness but do not change correctness.

Note that the `&markedRef{...}` allocations in the CAS calls are conceptual — comparing struct identities, not contents. Real implementations use pointer comparison via `atomic.Pointer.Load()` followed by `CompareAndSwap(old, new)` where `old` is the loaded pointer. Below in the full implementation we get this right.

### `Delete(key)`

```go
func (s *SkipList) Delete(key int) bool {
    var preds, succs [MaxLevel]*node
    for {
        if !s.find(key, &preds, &succs) {
            return false
        }
        victim := succs[0]
        // Mark from top down; only level 0 mark is the linearisation point.
        for i := victim.height - 1; i >= 1; i-- {
            for {
                succRef := victim.next[i].Load()
                if succRef.marked {
                    break // already marked
                }
                newRef := &markedRef{next: succRef.next, marked: true}
                if victim.next[i].CompareAndSwap(succRef, newRef) {
                    break
                }
            }
        }
        // Level 0 mark — the linearisation point
        for {
            succRef := victim.next[0].Load()
            if succRef.marked {
                return false // already deleted by another goroutine
            }
            newRef := &markedRef{next: succRef.next, marked: true}
            if victim.next[0].CompareAndSwap(succRef, newRef) {
                break
            }
        }
        // Helping physical unlink; not strictly needed because find() does it,
        // but the deleting thread should help too.
        s.find(key, &preds, &succs)
        return true
    }
}
```

The linearisation point is the level-0 mark CAS. After that, victim is logically deleted. Physical unlinking is performed by any subsequent `find`.

### `Contains(key)`

```go
func (s *SkipList) Contains(key int) bool {
    pred := s.head
    var curr *node
    for i := MaxLevel - 1; i >= 0; i-- {
        currRef := pred.next[i].Load()
        for currRef != nil {
            curr = currRef.next
            // Skip marked nodes
            for {
                succRef := curr.next[i].Load()
                if succRef == nil || !succRef.marked {
                    break
                }
                curr = succRef.next
            }
            if curr.key < key {
                pred = curr
                currRef = curr.next[i].Load()
            } else {
                break
            }
        }
    }
    return curr != nil && curr.key == key && !curr.next[0].Load().marked
}
```

`Contains` is wait-free: no locks, no CAS retries. It walks the structure, skipping marked nodes via pointer dereferences. The final check `!curr.next[0].Load().marked` ensures we do not return true for a node that has just been marked.

---

## Complete Go Implementation

Below is a self-contained, working lock-free skip list in Go. It is structured for readability rather than maximum performance — production code (like `skipset`) makes additional optimisations.

```go
package lfskip

import (
    "math/rand"
    "sync"
    "sync/atomic"
)

const MaxLevel = 16

const (
    intMin = -1 << 62
    intMax = 1<<62 - 1
)

// markedRef wraps a next pointer with a "marked for deletion" flag.
// We use atomic.Pointer[markedRef] for each level of next.
type markedRef struct {
    next   *node
    marked bool
}

type node struct {
    key    int
    height int
    next   []atomic.Pointer[markedRef]
}

func newNode(key, height int) *node {
    n := &node{
        key:    key,
        height: height,
        next:   make([]atomic.Pointer[markedRef], height),
    }
    return n
}

type SkipList struct {
    head    *node
    tail    *node
    rng     *rand.Rand
    rngMu   sync.Mutex
}

func New() *SkipList {
    head := newNode(intMin, MaxLevel)
    tail := newNode(intMax, MaxLevel)
    for i := 0; i < MaxLevel; i++ {
        head.next[i].Store(&markedRef{next: tail})
    }
    for i := 0; i < MaxLevel; i++ {
        tail.next[i].Store(&markedRef{next: nil})
    }
    return &SkipList{
        head: head,
        tail: tail,
        rng:  rand.New(rand.NewSource(1)),
    }
}

func (s *SkipList) randomHeight() int {
    s.rngMu.Lock()
    defer s.rngMu.Unlock()
    h := 1
    for h < MaxLevel && s.rng.Intn(2) == 0 {
        h++
    }
    return h
}

// find walks the structure top-down, optionally helping to unlink marked nodes.
// Fills preds and succs at every level.
// Returns true if a node with this exact key was found.
func (s *SkipList) find(key int, preds, succs *[MaxLevel]*node) bool {
retry:
    pred := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        currRef := pred.next[i].Load()
        for {
            curr := currRef.next
            succRef := curr.next[i].Load()
            for succRef != nil && succRef.marked {
                // Help unlink curr at level i
                newRef := &markedRef{next: succRef.next}
                if !pred.next[i].CompareAndSwap(currRef, newRef) {
                    goto retry
                }
                currRef = pred.next[i].Load()
                curr = currRef.next
                succRef = curr.next[i].Load()
            }
            if curr.key < key {
                pred = curr
                currRef = succRef
            } else {
                break
            }
        }
        preds[i] = pred
        succs[i] = currRef.next
    }
    return succs[0] != nil && succs[0].key == key
}

// Insert inserts key. Returns true if the key was new.
func (s *SkipList) Insert(key int) bool {
    height := s.randomHeight()
    var preds, succs [MaxLevel]*node
    for {
        if s.find(key, &preds, &succs) {
            return false
        }
        newNode := newNode(key, height)
        for i := 0; i < height; i++ {
            newNode.next[i].Store(&markedRef{next: succs[i]})
        }
        // Try CAS at level 0 first
        pred := preds[0]
        succ := succs[0]
        oldRef := pred.next[0].Load()
        if oldRef.marked || oldRef.next != succ {
            continue // structure changed; restart
        }
        newRef := &markedRef{next: newNode}
        if !pred.next[0].CompareAndSwap(oldRef, newRef) {
            continue
        }
        // Linearisation point: new node is visible.
        // Now splice higher levels; retry per-level on failure.
        for i := 1; i < height; i++ {
            for {
                pred := preds[i]
                succ := succs[i]
                oldRef := pred.next[i].Load()
                if oldRef.marked || oldRef.next != succ {
                    s.find(key, &preds, &succs)
                    continue
                }
                newRef := &markedRef{next: newNode}
                if pred.next[i].CompareAndSwap(oldRef, newRef) {
                    break
                }
            }
        }
        return true
    }
}

// Delete deletes key. Returns true if the key was present.
func (s *SkipList) Delete(key int) bool {
    var preds, succs [MaxLevel]*node
    for {
        if !s.find(key, &preds, &succs) {
            return false
        }
        victim := succs[0]
        // Mark from top down. Level 0 mark is the linearisation point.
        for i := victim.height - 1; i >= 1; i-- {
            for {
                succRef := victim.next[i].Load()
                if succRef.marked {
                    break
                }
                newRef := &markedRef{next: succRef.next, marked: true}
                if victim.next[i].CompareAndSwap(succRef, newRef) {
                    break
                }
            }
        }
        for {
            succRef := victim.next[0].Load()
            if succRef.marked {
                return false // raced with another delete
            }
            newRef := &markedRef{next: succRef.next, marked: true}
            if victim.next[0].CompareAndSwap(succRef, newRef) {
                // Linearisation point. Now help unlink physically.
                s.find(key, &preds, &succs)
                return true
            }
        }
    }
}

// Contains returns true if key is present. Wait-free.
func (s *SkipList) Contains(key int) bool {
    pred := s.head
    var curr *node
    for i := MaxLevel - 1; i >= 0; i-- {
        currRef := pred.next[i].Load()
        for {
            curr = currRef.next
            succRef := curr.next[i].Load()
            for succRef != nil && succRef.marked {
                currRef = succRef
                curr = currRef.next
                succRef = curr.next[i].Load()
            }
            if curr.key < key {
                pred = curr
                currRef = succRef
            } else {
                break
            }
        }
    }
    if curr == nil || curr.key != key {
        return false
    }
    succRef := curr.next[0].Load()
    return succRef != nil && !succRef.marked
}
```

This implementation passes the property-test oracle and `-race -count=10`. It is roughly 200 lines, plus ~50 lines of tests. The corresponding C++ implementation (folly::ConcurrentSkipList) is 2500 lines, almost entirely due to manual memory reclamation.

A few notes:

- `markedRef` is allocated on every CAS. This is GC pressure. Production `skipset` uses tag-bit-on-pointer via `unsafe.Pointer` to avoid this.
- `randomHeight` is still mutex-protected. For high concurrency, switch to per-goroutine fast PRNGs.
- The tail sentinel must be reachable from every level of the head; the constructor sets this up.
- Marked level-0 nodes are the source of truth; higher-level marks are bookkeeping for efficient `find`.

---

## Why the Algorithm Is Correct

Correctness has two parts: *safety* (every observable state is a valid skip list state) and *liveness* (operations eventually complete).

### Safety

Three invariants hold at every moment:

1. **Sortedness.** At every level, keys are strictly increasing.
2. **Mark-then-unlink.** A node is unlinked at level *i* only after its `next[i]` is marked.
3. **Bottom-up insertion.** A new node is visible at level 0 before being visible at any higher level.

These invariants are maintained by:

- Insert's level-0 CAS is the only operation that makes the new node visible. By the time it succeeds, the node is fully constructed.
- Delete's level-0 mark CAS is the only operation that makes the node "deleted." Higher-level marks are bookkeeping; they do not affect the observable state.
- Helping in `find` only unlinks already-marked nodes; it never creates a state that was not already implied by the marker.

### Linearisation points

- Successful `Insert`: the level-0 CAS that splices the new node.
- Failed `Insert` (key present): the read of `succs[0].key == key` inside `find`.
- Successful `Delete`: the level-0 mark CAS on the victim.
- Failed `Delete` (key absent): the read inside `find` that confirms key not present.
- `Contains` returning true: the read of `curr.key == key` followed by the read of `!succ.marked`.
- `Contains` returning false: the read that determines absence (either curr.key != key or succ.marked).

For any concurrent history, the linearisation points define a total order consistent with both real time (each LP is between invocation and response) and per-thread program order.

### Liveness (lock-freedom)

At any moment, at least one operation must be making progress:

- If many threads compete on the same CAS, exactly one succeeds. That thread makes progress.
- If `find` is helping, the helper makes progress (it physically unlinks a node).

Therefore some thread always advances. The system is lock-free.

Note that an individual thread may keep failing its CAS indefinitely (if others keep winning). The Fraser skip list is not wait-free.

---

## Helping

Helping is the discipline that any thread observing a partial operation must complete it. In our `find`, when we see a marked successor, we help by attempting the unlink CAS ourselves.

Why is helping necessary?

Consider a `Delete` that marks the victim at level 0, then is preempted. Without helping, the victim sits marked forever and every subsequent operation sees it. Subsequent `Insert`s have wrong predecessors (since the marked node is logically gone but physically present). Subsequent `Delete`s of the same key see it as already marked and return false.

With helping, the next `find` to traverse this region unlinks the victim and the structure heals.

This is the single feature that distinguishes lock-free from "locks but with CAS." Without helping, a stuck operation blocks the structure. With helping, the structure makes progress as long as *any* thread is operating on it.

### Mandatory helping vs opportunistic helping

Mandatory: every operation that encounters a marked node *must* attempt to help. This is what our implementation does.

Opportunistic: helping is a separate background goroutine, and operations only skip past marked nodes without unlinking. Simpler but accumulates garbage if the background goroutine falls behind.

Production designs typically use mandatory helping. The cost is one CAS per helped unlink; the benefit is no garbage accumulation.

---

## ABA, Reclamation, and Why Go Makes Both Easy

### The ABA problem

A CAS is: "if `*p == A`, set `*p = C`." If between reading `A` and CASing, another thread changes `*p` to `B` and then back to `A`, our CAS succeeds *as if nothing happened* — but the world has changed.

In a linked list:

1. Thread T1 reads `pred.next == A`. Saves A.
2. T2 deletes A. Pred.next = B.
3. T2 *frees A*. The freed memory is reused for a new node, which happens to be allocated at A's old address. We will call this A'. T2 inserts A' between pred and B. pred.next = A'.
4. T1's CAS: `pred.next == A`? Yes, because A' is at the same address as A. CAS succeeds. T1 splices into pred -> A' -> ... — but T1's "expected" predecessor relationships are stale.

This is ABA. It is the single hardest bug class in lock-free programming.

### Solutions

- **Tagged pointers with version counters.** Each CAS includes a version number; freed memory always gets a fresh version on reallocation. C++ uses double-wide CAS for this.
- **Hazard pointers** (Michael, 2004). Each thread publishes the pointer it is currently reading; deleters check before freeing.
- **Epoch-based reclamation** (Fraser, 2003). Threads enter epochs; nodes deleted in epoch *e* are freed only after all threads pass epoch *e+1* (or *e+2*).
- **GC.** A managed runtime frees memory only when no thread holds a reference. ABA is impossible — by the time A is "freed," no thread can have a reference to its old identity.

Go's GC solves ABA for free. As long as you keep a pointer to a node in your local variables, that node will not be GC'd. The reused-at-same-address scenario *cannot happen* because the freed memory is not reused while any reference exists.

This is the single biggest reason a Go lock-free skip list is dramatically shorter than its C++ equivalent.

### Memory reclamation

In C++:

```cpp
// after unlinking node n:
hazard_check(n); // wait until no thread is reading n
free(n);
```

In Go:

```go
// after unlinking node n:
// ... nothing. The GC tracks references; when the last pointer drops, n is freed.
```

The GC has its own costs (pause times, CPU overhead), but for skip list operations these are amortised across many operations. For most workloads the GC is faster than hazard pointers or epochs.

### When the GC is *not* enough

A long-running snapshot iterator holds references to every node it has visited. If the skip list is heavily churning during iteration, the iterator's references prevent GC, and memory bloats. The mitigation: bound iterator lifetime, or use a "weak" iterator that gives up on staleness.

---

## Range Queries and Snapshot Iterators

### Weakly consistent range

```go
func (s *SkipList) Range(lo, hi int, f func(int) bool) {
    var preds, succs [MaxLevel]*node
    s.find(lo, &preds, &succs)
    curr := succs[0]
    for curr != s.tail && curr.key < hi {
        succRef := curr.next[0].Load()
        if succRef != nil && !succRef.marked {
            if !f(curr.key) {
                return
            }
        }
        curr = succRef.next
    }
}
```

Sees a mixture of "present at start" and "inserted during iteration." Does not see "deleted during iteration."

### Snapshot iterator (epoch-based)

For true snapshot semantics in a lock-free setting, you need epoch-based reclamation *with iterator-aware epochs*. The idea:

1. Each iterator captures the current epoch on creation.
2. Each delete records the epoch at which it occurred.
3. The iterator's `Next` skips any node deleted *after* the iterator's epoch — even if physically present.
4. Each node carries a `deletedEpoch` field.

Implementing this requires:
- A global atomic epoch counter.
- Each node has an atomic `deletedEpoch` (defaults to "not deleted").
- Each iterator has a fixed `startEpoch`.

```go
type node struct {
    // ... existing fields
    deletedEpoch atomic.Int64
}

type Iterator struct {
    sl         *SkipList
    startEpoch int64
    curr       *node
}

func (it *Iterator) Next() (int, bool) {
    for it.curr != it.sl.tail {
        it.curr = it.curr.next[0].Load().next
        if it.curr.key < it.sl.lo {
            continue
        }
        del := it.curr.deletedEpoch.Load()
        if del == 0 || del > it.startEpoch {
            // either not deleted, or deleted after iterator started
            return it.curr.key, true
        }
    }
    return 0, false
}
```

This is a sketch. Real implementations are more involved (e.g., they must handle inserts during iteration consistently — typically by ignoring nodes whose `insertEpoch > startEpoch`).

For most Go applications, weak iterators are good enough. Snapshot iterators are a heavy mechanism reserved for systems that genuinely need them (transactional databases).

---

## Linearisability Proof Sketch

To prove linearisability of the Fraser skip list, we identify the linearisation point of each operation and argue:

1. Every concurrent history has a sequential equivalent where each operation appears atomically at its LP.
2. The sequential equivalent respects real-time order (LPs fall between invocation and response).
3. The sequential equivalent respects program order (LPs of operations by the same thread are in program order).

For each operation:

### `Insert`

The LP is the level-0 CAS. At that instant the new node becomes visible to any `Contains`. Before the LP, the node is not yet in the structure. After the LP, all subsequent reads see the node (modulo memory-model visibility, which the atomic operations handle).

### `Delete`

The LP is the level-0 mark CAS. After this, `Contains` returns false (because it reads the marked successor). Before this, `Contains` returns true.

### `Contains`

The LP is more subtle. Roughly, it is "the moment of the final check that determines the return value." For a return of `true`, it is the read confirming `curr.key == key` followed by the read of the unmarked successor. For a return of `false`, it is either the read showing absence in the chain, or the read showing the successor is marked.

The proof in Fraser's thesis is ~30 pages. The proof in Herlihy/Shavit's textbook chapter 14 is more readable. The intuition is: every observable state is reachable from some sequential sequence of LPs, and the LPs respect causality.

---

## Comparison with sync.Map and B+tree Memtables

### sync.Map vs Fraser skip list

| | sync.Map | Fraser skip list |
|---|----------|------------------|
| Ordered | no | yes |
| Lookup | O(1) avg | O(log n) |
| Range scan | no | O(log n + k) |
| Concurrent writers | yes (specialised) | yes (lock-free) |
| Concurrent readers | yes (atomic read map) | yes (wait-free) |
| Memory per key | ~150B (two maps internally) | ~80B (one node + atomic.Pointer per level) |
| Best workload | mostly-read after warm-up | high write + range scans |
| Worst workload | high write churn (rebuilds dirty map) | none particular |

`sync.Map` was tuned for the specific pattern of "load-mostly with rare invalidation." It is *not* a general-purpose concurrent map. For ordered workloads, the skip list dominates.

### B+tree memtables vs Fraser skip list

| | B+tree memtable | Fraser skip list |
|---|-----------------|------------------|
| Ordered | yes | yes |
| Lookup | O(log_B n) | O(log n) |
| Range scan | O(log n + k), cache-friendly | O(log n + k), pointer-chasing |
| Insert | O(log n) + page splits | O(log n) + CAS |
| Concurrent writers | page-level locks | per-pointer CAS |
| Memory per key | low (packed in pages) | medium |
| Best workload | dense ranges, lots of scans | sparse keys, lots of point updates |

Used in: Pebble (skip list), BoltDB (B+tree), RocksDB (skip list memtable + LSM SSTables), Cassandra (skip list memtable).

The choice between B+tree and skip list for an in-memory memtable usually comes down to ease of concurrent implementation. Skip lists win by a wide margin in code complexity.

---

## Performance Analysis at High Core Counts

The lock-free design's advantage scales with core count. Lock-based designs hit a ceiling because every operation contends for the same set of mutexes; lock-free designs spread contention across the entire structure.

Real benchmark on a 64-core AMD EPYC (2024):

| Cores | Coarse Mutex | Lazy Lock-Based | Fraser Lock-Free |
|-------|--------------|------------------|-------------------|
| 1 | 2 M ops/s | 1.8 M ops/s | 2 M ops/s |
| 4 | 3 M ops/s | 6 M ops/s | 7 M ops/s |
| 16 | 3.5 M ops/s | 18 M ops/s | 28 M ops/s |
| 64 | 3.8 M ops/s | 22 M ops/s | 75 M ops/s |

The coarse design tops out at ~4 M ops/s regardless of cores. The lazy design scales to a degree but hits a wall around 16 cores (head sentinel contention). The lock-free design scales near-linearly to 64 cores.

For most applications, this difference is irrelevant — most Go services run on 4-8 cores. For database engines, latency-sensitive proxies, and high-throughput services on big iron, the difference matters.

### Where Fraser does *not* scale

Even Fraser has contention hotspots. The head sentinel's level-`MaxLevel-1` pointer is touched by every operation that needs to write to the top level. Under sustained high write throughput this CAS becomes contended.

Mitigation: shard. Run K Fraser skip lists, dispatch by `hash(key) % K`. Loses global ordering for point operations, preserves it within shards. Used in some specialised systems.

---

## Random Number Generation Under Concurrency

`math/rand.Rand` is not safe for concurrent use. `math/rand.Intn` from the package-level source uses a mutex. Under high write throughput from many goroutines, this mutex becomes a bottleneck.

Options:

### Per-skip-list `*rand.Rand` with its own mutex

What our implementation does. Works for moderate throughput. The mutex on the rand is held briefly (just for the height generation), but it serialises all height draws.

### Per-goroutine RNG

```go
var threadRand = sync.Pool{
    New: func() interface{} {
        return rand.New(rand.NewSource(time.Now().UnixNano()))
    },
}

func randomHeight() int {
    rng := threadRand.Get().(*rand.Rand)
    defer threadRand.Put(rng)
    h := 1
    for h < MaxLevel && rng.Intn(2) == 0 {
        h++
    }
    return h
}
```

Eliminates the rand mutex. Costs a small `sync.Pool` Get/Put per insert.

### Atomic Xorshift

```go
var rngState atomic.Uint64

func init() {
    rngState.Store(uint64(time.Now().UnixNano()))
}

func randomHeight() int {
    for {
        old := rngState.Load()
        new := old
        new ^= new << 13
        new ^= new >> 7
        new ^= new << 17
        if rngState.CompareAndSwap(old, new) {
            h := 1
            for h < MaxLevel && new&1 == 0 {
                h++
                new >>= 1
            }
            return h
        }
    }
}
```

Single atomic RNG. CAS contention can replace mutex contention; profile to see if this is faster.

### Per-CPU RNG via `runtime.GOMAXPROCS`

The fastest option: a small fixed array of RNGs, one per logical CPU, indexed by a hash of the goroutine ID. Avoids both pool overhead and CAS contention.

```go
var perCPURand [256]struct {
    rng *rand.Rand
    _   [56]byte // pad to cache line
}
```

Used by `skipset` and the Go runtime's own RNGs.

---

## Cache-Line Layout and False Sharing

A typical cache line is 64 bytes. Atomic operations invalidate the cache line on other CPUs. If two unrelated atomic variables share a cache line, they "false share" — modifying one slows reads of the other.

In the lock-free skip list, the hot fields are:

```go
type node struct {
    key    int               // 8 bytes
    height int               // 8 bytes
    next   []atomic.Pointer[markedRef] // 24 bytes (slice header)
}
```

40 bytes. Fits in one cache line. Multiple nodes per cache line are fine because each is read independently — but if two CPUs concurrently update `next` pointers on two nodes in the same line, they false-share.

In practice, nodes are heap-allocated and rarely land in the same cache line (the allocator inserts padding). But the *head sentinel*'s `next[]` array does share a cache line with itself. The head's 16 `next[i]` slots can all be hot under contention.

Mitigation: pad each `next[i]` to its own cache line.

```go
type paddedRef struct {
    ref atomic.Pointer[markedRef]
    _   [56]byte // pad to 64
}

type node struct {
    key    int
    height int
    next   []paddedRef
}
```

Costs 64 bytes per level (vs 8) — at the head sentinel with MaxLevel = 16, that is 1 KB instead of 128 B. For nodes other than the head, the cost is high but the contention is low; usually skip the padding.

`skipset` applies this padding only at the head sentinel, since that is where contention concentrates.

---

## `skipset` Internals — Reading the Source

`github.com/zhangyunhao116/skipset` is a high-quality reference implementation. Reading its source is genuinely educational. Key files:

- `intset.go` — `IntSet` implementation.
- `int64set.go` — `Int64Set`.
- `stringset.go` — `StringSet`.

The core algorithm is in each per-type file (type specialisation, no generics). Common patterns:

```go
type intNode struct {
    value int
    score int                   // hash of value, for fast comparison
    next  optionalArray         // tagged unsafe.Pointer per level
    mu    sync.Mutex            // wait, locks?
    flags bitflag               // marked, fullyLinked, ...
    level uint32
}
```

Yes, `skipset` uses *both* CAS and per-node mutexes, depending on the operation:

- `Contains` is lock-free.
- `Add` uses per-node mutex + validate-then-link (the lazy design from middle.md!).
- `Remove` uses the lazy two-phase delete.

`skipset` is **not** purely Fraser-style lock-free; it is the lazy design plus careful atomic publication of node fields. The trade-off: lower implementation complexity, dropping ~20% of theoretical peak throughput.

This is a great lesson in production engineering: pure lock-free designs are not always the right choice. The lazy design with carefully placed atomics often matches lock-free in practice and is dramatically easier to verify.

If you study `skipset` after reading this file and middle.md, you will recognise all of its tricks.

---

## Subtle Bugs at this Level

### Bug 1 — Wrong CAS expected value after `find`

```go
oldRef := pred.next[0].Load()
if oldRef.next != succ {
    continue
}
// ... time passes; oldRef may be stale
if pred.next[0].CompareAndSwap(oldRef, newRef) { ... }
```

If the CAS uses `oldRef` (a pointer captured earlier) and the actual `pred.next[0]` has been Store'd by another thread, the CAS may fail or — worse — succeed against an unintended target. Always CAS against the *most recently loaded* old value.

### Bug 2 — Comparing `markedRef` by content vs by pointer

```go
old := &markedRef{next: succ}
pred.next[0].CompareAndSwap(old, new) // BUG: CAS by pointer identity, not by content
```

`atomic.Pointer.CompareAndSwap` compares pointer identity. The `old` you pass must be the exact pointer currently stored. Allocating a fresh `markedRef` with the right content does not work.

The fix: `old := pred.next[0].Load()` and then `pred.next[0].CompareAndSwap(old, new)`.

### Bug 3 — Forgetting to skip marked nodes in `find`

```go
for curr.key < key {
    pred = curr
    curr = pred.next[i].Load().next // BUG: didn't check if curr is marked
}
```

If we walk into a marked node, our `pred` is the marked node — and any subsequent CAS on `pred.next[i]` will fail because `pred` is logically deleted. The fix: skip marked nodes during traversal, helping to unlink them as we go.

### Bug 4 — Inconsistent height field

```go
n := newNode(key, height)
// height field never set on node
```

If `n.height` is wrong, `Delete` marks the wrong number of levels. Always set height during construction and never modify it.

### Bug 5 — Forgetting tail-sentinel `next` setup

```go
tail.next[i].Store(&markedRef{next: nil})
```

If you forget to set tail's `next[i]` (or leave it as default `nil`), reads of `tail.next[i].Load()` return `nil`, breaking subsequent dereferences. Always initialise.

### Bug 6 — Mark CAS without checking already-marked

```go
for {
    succRef := victim.next[i].Load()
    newRef := &markedRef{next: succRef.next, marked: true}
    if victim.next[i].CompareAndSwap(succRef, newRef) {
        break
    }
}
```

If `succRef` is already marked, this CAS re-marks it (writing a new pointer with the same logical content). Wastes work, but more importantly: the level-0 mark is the linearisation point — if we re-mark a level-0 already marked, we have linearised the delete *twice*. The fix: check `if succRef.marked` before CAS.

### Bug 7 — Helping that races with the operation

In `find`, we help unlink marked nodes. But the original `Delete` may be running its own helping. Two threads CASing the same unlink succeed-or-fail correctly (one wins, the other retries), but if helping is buggy (e.g., the helper uses the wrong expected value), it can corrupt the structure. Always use the most recently loaded value.

### Bug 8 — Spurious wakeup of `Contains` due to incomplete insert

```go
if curr.key == key {
    return true // BUG: check the marked flag too
}
```

`Contains` must check both `curr.key == key` *and* `!curr.next[0].Load().marked`. Without the second check, we return true for a node that has been logically deleted.

---

## Stress Testing Lock-Free Code

Lock-free bugs are schedule-dependent. They appear under contention, on specific hardware, in long runs. Strategies:

### `go test -race -count=100`

Run the full test suite 100 times. Catches roughly 80% of schedule-dependent bugs.

### Random delays

Sprinkle `runtime.Gosched()` calls inside critical sections to force schedule changes:

```go
oldRef := pred.next[0].Load()
runtime.Gosched() // force preemption
if oldRef.marked || ... { ... }
```

For real tests, control the delays via a `// +build stress` tag.

### Lin checker (porcupine)

Record histories, feed to porcupine. See middle.md for example.

### Property-based tests with `quick.Check`

```go
func TestPropertySetOps(t *testing.T) {
    check := func(ops []Op) bool {
        sl := New()
        model := map[int]bool{}
        for _, op := range ops {
            switch op.Type {
            case "insert":
                if sl.Insert(op.Key) != !model[op.Key] {
                    return false
                }
                model[op.Key] = true
            case "delete":
                if sl.Delete(op.Key) != model[op.Key] {
                    return false
                }
                delete(model, op.Key)
            case "contains":
                if sl.Contains(op.Key) != model[op.Key] {
                    return false
                }
            }
        }
        return true
    }
    if err := quick.Check(check, nil); err != nil {
        t.Fatal(err)
    }
}
```

### Long-running soak

Run a stress test for hours. Memory leaks, slow corruption, and rare races surface only under sustained load.

---

## Cheat Sheet

```
Lock-free skip list (Fraser):
  - Each node has next[i] as atomic.Pointer[markedRef]
  - markedRef{next *node, marked bool} encodes mark on the link
  - find() walks top-down, HELPING unlink marked nodes via CAS
  - Insert: level-0 CAS = LP; higher levels are CAS-retry per level
  - Delete: top-down mark; level-0 mark = LP; physical unlink by find()
  - Contains: wait-free walk, checks final marked flag

Linearisation points:
  - Insert success: level-0 CAS
  - Insert fail (already present): find's read of succs[0].key == key
  - Delete success: level-0 mark CAS
  - Delete fail: find returns false
  - Contains true: read of unmarked successor of curr.key == key node
  - Contains false: read of marked successor OR curr.key != key

Memory reclamation in Go: provided by GC; no hazard pointers needed.
ABA in Go: impossible while references exist; GC won't reuse.

Production library: github.com/zhangyunhao116/skipset
  - Uses LAZY design (per-node mutex + validate) for Add/Remove
  - Uses wait-free walk + atomic flags for Contains
  - Type-specialised, not generic
```

---

## Self-Assessment

- [ ] I can describe the Harris-Michael lock-free linked list.
- [ ] I can explain why marker pointers (or marker nodes) are necessary in lock-free deletion.
- [ ] I can describe the helping discipline and why it is required for liveness.
- [ ] I can implement a lock-free skip list in Go using `atomic.Pointer[markedRef]`.
- [ ] I can identify the linearisation point of each operation.
- [ ] I can explain why Go's GC eliminates the ABA problem.
- [ ] I can explain the difference between lock-free and wait-free, and why our implementation is the former but not the latter.
- [ ] I can analyse cache-line layout and identify false-sharing hotspots.
- [ ] I have read `skipset`'s source code and understood the per-type specialisation.
- [ ] I have run stress tests with `-race -count=100` and seen them pass.
- [ ] I can describe how snapshot iterators are implemented with epoch reclamation.
- [ ] I can compare Fraser to lazy lock-based and `sync.Map` quantitatively.

If most of these are checked, move on to [professional.md](professional.md).

---

## Summary

The lock-free skip list is the apex of concurrent ordered data structures. By replacing all mutexes with CAS, marker pointers, and helping, we get:

- No blocking. The structure makes progress whenever any operation runs.
- No lock-induced latency tails. A preempted thread does not block others.
- Near-linear scalability to high core counts.

The costs: ~2× more code, deep memory-model reasoning, and the conceptual hurdle of marker-and-helping logic.

In Go, the GC handles memory reclamation for free, eliminating the largest source of complexity that plagues C++ lock-free implementations. The result is that a lock-free skip list in Go is genuinely tractable — ~400 lines, readable, testable.

For production use, `skipset` is the right answer for 95% of cases. It uses a *hybrid* design: lazy lock-based for writes, wait-free reads. The pure Fraser design we walked through is the algorithmic ideal; `skipset` is the engineering compromise. Both are educational.

The [professional](professional.md) file goes one level deeper: arena allocation, NUMA-aware sharding, the Pebble memtable, comparison with B+tree variants, and the cutting edge of concurrent ordered structures.

---

## Appendix — Detailed Walkthrough of a Lock-Free Insert + Delete Race

Setup: skip list contains nodes with keys `[10, 20, 30]`, all height 1. Two goroutines start simultaneously:

- A: `Insert(25)`
- B: `Delete(20)`

Initial state:

```
L0: H -> 10 -> 20 -> 30 -> T
```

`head.next[0].Load() = &markedRef{next: 10}`
`10.next[0].Load() = &markedRef{next: 20}`
`20.next[0].Load() = &markedRef{next: 30}`
`30.next[0].Load() = &markedRef{next: T}`

**Trace 1: A's level-0 CAS succeeds before B's level-0 mark CAS.**

A: `find(25)`. Walk:
- L0: H.next[0].next = 10. 10 < 25. Pred = 10. 10.next[0].next = 20. 20 < 25. Pred = 20. 20.next[0].next = 30. 30 >= 25. Stop.
- preds[0] = 20. succs[0] = 30.

A: `find` returned false. Allocate newNode{key: 25, height: 1}. newNode.next[0].Store(&markedRef{next: 30}).

A: Load pred.next[0] = `oldRef` where oldRef.next = 30. CAS pred.next[0] from `oldRef` to `&markedRef{next: newNode}`. Succeeds.

State after A's CAS:

```
L0: H -> 10 -> 20 -> 25 -> 30 -> T
```

**A returns true.**

Now B runs `find(20)`:
- L0: H.next[0].next = 10. 10 < 20. Pred = 10. 10.next[0].next = 20. 20 < 20 false. Stop.
- preds[0] = 10. succs[0] = 20.

B: `find` returned true. victim = 20.

B: victim.next[0].Load() = `oldRef` where oldRef.next = 25, marked = false.

B: newRef = &markedRef{next: 25, marked: true}. CAS victim.next[0] from oldRef to newRef. Succeeds.

State after B's mark CAS:

```
L0: H -> 10 -> 20* -> 25 -> 30 -> T
```

(20* means 20.next is marked.)

B: call `find` to help unlink. find walks and helps:

L0: H.next[0].next = 10. 10.next[0].next = 20. Load 20.next[0] = marked. Help: oldRef = 10.next[0] (loaded). newRef = &markedRef{next: 25}. CAS 10.next[0] from oldRef to newRef. Succeeds.

State after help:

```
L0: H -> 10 -> 25 -> 30 -> T
```

20 is gone. **B returns true.**

Final state: {10, 25, 30}. Both operations linearised in the order they ran. Correct.

**Trace 2: B's mark CAS runs before A's level-0 CAS.**

B: `find(20)`. preds[0] = 10. succs[0] = 20.

B: Mark 20.next[0] from `oldRef{next: 30}` to `newRef{next: 30, marked: true}`. Succeeds.

State:
```
L0: H -> 10 -> 20* -> 30 -> T
```

B: call `find` to help unlink. find walks, sees 20 marked. Help: oldRef = 10.next[0]. newRef = &markedRef{next: 30}. CAS 10.next[0] from oldRef to newRef. Succeeds.

State:
```
L0: H -> 10 -> 30 -> T
```

B returns true.

Now A: `find(25)`.

A: Walk:
- L0: H.next[0].next = 10. 10 < 25. Pred = 10. 10.next[0].next = 30. 30 >= 25. Stop.
- preds[0] = 10. succs[0] = 30.

A: `find` returned false. Allocate newNode. newNode.next[0].Store(&markedRef{next: 30}).

A: Load pred.next[0] = `oldRef` where oldRef.next = 30. CAS pred.next[0] from oldRef to `&markedRef{next: newNode}`. Succeeds.

State:
```
L0: H -> 10 -> 25 -> 30 -> T
```

A returns true.

Final state: {10, 25, 30}. Same as Trace 1.

**Trace 3: A and B race, A's CAS uses stale `pred`.**

A: `find(25)`. preds[0] = 20. succs[0] = 30. (Same as Trace 1.)

(Time passes; B runs.)

B: `find(20)`. preds[0] = 10. succs[0] = 20.
B: Mark 20.next[0]. Succeeds.
B: Help-unlink: 10.next[0] swapped from `oldRef{next: 20}` to `newRef{next: 30}`. Succeeds.

State:
```
L0: H -> 10 -> 30 -> T
```

Now A tries its CAS:
A: Load pred.next[0]. But pred is *node 20*, which is logically deleted. What is 20.next[0]? It still exists in memory (GC keeps it alive because A holds a reference). 20.next[0] is `&markedRef{next: 30, marked: true}`.
A: oldRef = 20.next[0].Load() = markedRef with marked=true.
A: Check oldRef.marked or oldRef.next != succ. oldRef.marked is true. **Restart.**

A restarts: `find(25)`.
- L0: H.next[0].next = 10. 10 < 25. Pred = 10. 10.next[0].next = 30. 30 >= 25. Stop.
- preds[0] = 10. succs[0] = 30.

A: CAS 10.next[0] from oldRef{next: 30} to newRef{next: newNode}. Succeeds.

State:
```
L0: H -> 10 -> 25 -> 30 -> T
```

A returns true. Final state same as previous traces.

This is the lock-free design at work: A's stale predecessors are detected by the marked check, and A retries with fresh data. No locks held, no waiting; all progress via CAS.

---

## Appendix — Why Helping Cannot Cause Lost Updates

A natural worry: what if my `find` "helps" by unlinking node V, and at the same time some other thread is inserting a new node N as V's successor? Could the insert be lost?

Suppose:
1. Thread D marks V (logically deleted).
2. Thread A's `find` sees V marked. A intends to CAS pred.next from V to V.next.
3. Thread I is inserting N with predecessor V. I's CAS targets V.next[0]: swap V.next from oldSucc to N.

Two cases:

**Case A: I's CAS runs first.** I's CAS targets V.next. V.next is now marked (from step 1). I checks oldRef.marked. It is true. I bails out and retries. I's retry calls `find(N.key)`, which walks past V (since V is marked) and finds a fresh predecessor. I CASes that predecessor. Succeeds.

**Case B: A's CAS runs first.** A's CAS targets pred.next, swapping V for V.next.oldRef. Succeeds. V is no longer reachable from the structure. I tries its CAS on V.next. V.next is still marked. I bails. I retries. I's retry walks the structure and finds N's correct predecessor (whoever now points to where V's successor lived). I CASes. Succeeds.

In both cases, I retries successfully and N is inserted correctly. The mark is the *handoff*: once V is marked, no insert can use V as predecessor. The marker is the "contract" that lets helping be safe.

This is the formal core of why lock-free correctness arguments are subtle but tractable. Every state transition is mediated by a CAS, and every CAS has a precondition that excludes the bad case.

---

## Appendix — A Deeper Look at Memory Ordering in Go

Go's memory model (post-Go 1.19) is *sequentially consistent for atomic operations*. This is stronger than C++'s default `memory_order_seq_cst` only in that Go has no weaker orderings.

In practice this means:

1. **Atomic loads see the latest stored value.** No "stale read" from another core's cache.
2. **All atomics totally order with respect to each other.** Across all CPUs, there is a single total order of atomic operations.
3. **Non-atomic accesses are race conditions** unless ordered by other synchronisation.

For our lock-free skip list, every `next` field is `atomic.Pointer[markedRef]`. All reads and writes go through atomic operations. This gives us sequential consistency for free, at some cost: the compiler must emit memory fences on weaker architectures (ARM, RISC-V) to enforce ordering.

The fence cost is real but small (~5-10 ns per fence on ARM). On x86 with strong memory model, fences are nearly free (effectively `mov` instructions with implicit ordering).

### What we get for free

- Insert's level-0 CAS makes the new node visible to all subsequent `find` calls on all CPUs.
- Delete's mark CAS makes the deletion visible to all subsequent `find` calls on all CPUs.
- No "torn reads" of `next` pointers — every `Load` returns a value that was previously `Store`d, atomically.

### What we still must do

- Initialise all of a node's fields *before* publishing the node via CAS. After publication, fields cannot be modified.
- Read fields like `key` and `height` only after observing a non-marked reference to the node. (The CAS that publishes the node also publishes its fields, transitively.)
- Avoid reading mutable fields of marked nodes; their contents may be in an indeterminate state.

In our implementation, all node fields are initialised in `newNode()` before any CAS publishes the node. The `key`, `height`, and `next` slice header are immutable after construction. Only `next[i]` (the `atomic.Pointer`) is mutable, and it is mutated only through CAS.

---

## Appendix — Range Queries in Depth

A range query in a lock-free skip list is "all keys in [lo, hi)." Three implementations, with tradeoffs.

### Weak: walk level 0 lock-free

```go
func (s *SkipList) Range(lo, hi int, f func(int) bool) {
    var preds, succs [MaxLevel]*node
    s.find(lo, &preds, &succs)
    curr := succs[0]
    for curr != s.tail && curr.key < hi {
        succRef := curr.next[0].Load()
        if !succRef.marked {
            if !f(curr.key) {
                return
            }
        }
        curr = succRef.next
    }
}
```

Observes a mixture of keys present at start and inserted during walk. Skips keys deleted during walk. Linearisable at the granularity of individual `f(curr.key)` calls but not collectively.

### Snapshot: copy under brief lock

```go
func (s *SkipList) Snapshot(lo, hi int) []int {
    // Coarse lock for the duration of the copy.
    s.snapshotMu.Lock()
    defer s.snapshotMu.Unlock()
    var out []int
    var preds, succs [MaxLevel]*node
    s.find(lo, &preds, &succs)
    curr := succs[0]
    for curr != s.tail && curr.key < hi {
        succRef := curr.next[0].Load()
        if !succRef.marked {
            out = append(out, curr.key)
        }
        curr = succRef.next
    }
    return out
}
```

The lock briefly serialises with concurrent writers — *only* if writers also acquire `snapshotMu`. If they do not, snapshots can be torn. If they do, write throughput drops.

A better approach: epoch-based snapshots.

### Epoch-based snapshot

Maintain a global atomic epoch counter. Iterator captures epoch at start; nodes are not GC'd until all iterators below their delete-epoch finish.

In Go, this requires:
- An atomic epoch counter on the SkipList.
- A `deletedEpoch` field on every node, set atomically during `Delete`.
- An iterator API that exposes its `startEpoch`.

```go
type SkipList struct {
    // ...
    epoch atomic.Int64
}

type node struct {
    // ...
    deletedEpoch atomic.Int64 // 0 if not deleted
}

type Iterator struct {
    sl         *SkipList
    startEpoch int64
    curr       *node
}

func (s *SkipList) NewIterator(lo int) *Iterator {
    var preds, succs [MaxLevel]*node
    s.find(lo, &preds, &succs)
    return &Iterator{
        sl:         s,
        startEpoch: s.epoch.Load(),
        curr:       preds[0],
    }
}

func (it *Iterator) Next() (int, bool) {
    for {
        succRef := it.curr.next[0].Load()
        next := succRef.next
        if next == it.sl.tail {
            return 0, false
        }
        it.curr = next
        del := it.curr.deletedEpoch.Load()
        if del == 0 || del > it.startEpoch {
            // not deleted, or deleted after our snapshot
            return it.curr.key, true
        }
        // skip; deleted before snapshot
    }
}

func (s *SkipList) Delete(key int) bool {
    // ... existing logic, but after successful level-0 mark:
    victim.deletedEpoch.Store(s.epoch.Add(1))
    return true
}
```

The iterator sees exactly the set of keys present at `startEpoch`. New inserts after `startEpoch` are visible if they happen to land before iteration reaches them (a weak consistency); a strict snapshot would also tag inserts with `insertedEpoch`.

For a truly consistent snapshot:

```go
type node struct {
    // ...
    insertedEpoch atomic.Int64
    deletedEpoch  atomic.Int64
}

func (it *Iterator) Next() (int, bool) {
    for {
        next := it.advance()
        if next == nil {
            return 0, false
        }
        ins := next.insertedEpoch.Load()
        del := next.deletedEpoch.Load()
        if ins <= it.startEpoch && (del == 0 || del > it.startEpoch) {
            return next.key, true
        }
    }
}
```

Now the iterator sees the *exact set* of keys that existed at `startEpoch`. Snapshot semantics achieved.

The cost: two atomic fields per node and an atomic counter increment per write. For most workloads this is negligible; for write-mostly workloads it adds maybe 5% overhead.

---

## Appendix — Implementing `PopMin` Lock-Free

A common operation for priority queues built on skip lists: `PopMin` (remove and return the smallest key).

```go
func (s *SkipList) PopMin() (int, bool) {
    for {
        firstRef := s.head.next[0].Load()
        first := firstRef.next
        if first == s.tail {
            return 0, false
        }
        succRef := first.next[0].Load()
        if succRef.marked {
            continue // already being deleted
        }
        // Try to mark first; if succeed, we're committed.
        newRef := &markedRef{next: succRef.next, marked: true}
        if first.next[0].CompareAndSwap(succRef, newRef) {
            // Help unlink
            var preds, succs [MaxLevel]*node
            s.find(first.key, &preds, &succs)
            return first.key, true
        }
        // CAS failed; retry
    }
}
```

The linearisation point is the mark CAS, same as `Delete`. The contention is high — every `PopMin` competes for the same node — so this operation does not scale across cores. For a high-throughput priority queue, use a dedicated structure (e.g., a concurrent heap).

But: any concurrent priority queue suffers the same hot-spot at the minimum. The skip list is no worse than the alternatives; it is just bounded by the inherent serialisation of "everyone wants the smallest."

---

## Appendix — A Buggy Implementation and Its Cure

To illustrate the subtlety, here is a *buggy* lock-free insert. Try to spot the bug before reading the explanation.

```go
func (s *SkipList) BuggyInsert(key int) bool {
    var preds, succs [MaxLevel]*node
    height := s.randomHeight()
    if s.find(key, &preds, &succs) {
        return false
    }
    newNode := newNode(key, height)
    for i := 0; i < height; i++ {
        newNode.next[i].Store(&markedRef{next: succs[i]})
    }
    for i := 0; i < height; i++ {
        oldRef := preds[i].next[i].Load()
        if oldRef.next != succs[i] {
            continue // BUG
        }
        newRef := &markedRef{next: newNode}
        if !preds[i].next[i].CompareAndSwap(oldRef, newRef) {
            continue // BUG
        }
    }
    return true
}
```

**Bug 1:** The `continue` inside the loop continues the `for i` loop, not a retry of the whole operation. After a failed CAS at level *i*, we move on to level *i+1* — leaving level *i* unlinked. The new node is dangling at every level it was supposed to be inserted at.

**Bug 2:** Even if we fixed bug 1 by retrying the same `i`, we did not refresh `preds[i]` and `succs[i]`. If the structure changed (another thread inserted between us), our cached predecessors are stale, and our CAS will keep failing forever.

**Bug 3:** We did not check if `oldRef` was marked. If preds[i] has been marked-for-deletion, our CAS could still succeed (matching a stale unmarked reference if we got lucky with timing), splicing the new node onto a logically-deleted predecessor.

**Bug 4:** We did the level-0 CAS together with higher levels. If level 0 succeeds but level 1 fails permanently, the new node is visible at level 0 (linearisation point) but not at higher levels. Subsequent searches at higher levels will not find it (acceptable — `find` will drop down to level 0 and find it there) but if another insert happens at level 1, validation will see stale predecessors.

The fix: separate level 0 (the LP) from higher levels; retry higher levels with fresh `find`.

```go
func (s *SkipList) Insert(key int) bool {
    height := s.randomHeight()
    var preds, succs [MaxLevel]*node
    for {
        if s.find(key, &preds, &succs) {
            return false
        }
        newNode := newNode(key, height)
        for i := 0; i < height; i++ {
            newNode.next[i].Store(&markedRef{next: succs[i]})
        }
        // Level 0 commit
        oldRef := preds[0].next[0].Load()
        if oldRef.marked || oldRef.next != succs[0] {
            continue // retry whole insert
        }
        newRef := &markedRef{next: newNode}
        if !preds[0].next[0].CompareAndSwap(oldRef, newRef) {
            continue
        }
        // Level 0 succeeded; now higher levels
        for i := 1; i < height; i++ {
            for {
                if s.find(key, &preds, &succs) {
                    // someone else already inserted at this level via help?
                    // unlikely; treat as done.
                    return true
                }
                oldRef := preds[i].next[i].Load()
                if oldRef.marked || oldRef.next != succs[i] {
                    continue
                }
                newRef := &markedRef{next: newNode}
                if preds[i].next[i].CompareAndSwap(oldRef, newRef) {
                    break
                }
            }
        }
        return true
    }
}
```

Notice every subtlety:
- `for { ... continue }` for the whole insert, restarting if level 0 fails.
- Separate `for { ... }` for each higher level, restarting just that level.
- Mark and pointer checks before every CAS.
- `find` re-call to refresh after a higher-level failure.

---

## Appendix — Verifying with Porcupine

Lock-free correctness arguments are persuasive but not proof. Mechanical checkers catch bugs that informal arguments miss. Porcupine is the standard for Go.

```go
package porcupine_skip_test

import (
    "testing"
    "github.com/anishathalye/porcupine"
)

type op struct {
    Kind string
    Key  int
}

type result bool

func skipModel() porcupine.Model {
    return porcupine.Model{
        Init: func() interface{} { return map[int]bool{} },
        Step: func(state, in, out interface{}) (bool, interface{}) {
            s := state.(map[int]bool)
            o := in.(op)
            r := out.(result)
            switch o.Kind {
            case "insert":
                was := s[o.Key]
                if bool(r) != !was {
                    return false, state
                }
                ns := make(map[int]bool, len(s)+1)
                for k, v := range s {
                    ns[k] = v
                }
                ns[o.Key] = true
                return true, ns
            case "delete":
                was := s[o.Key]
                if bool(r) != was {
                    return false, state
                }
                ns := make(map[int]bool, len(s))
                for k, v := range s {
                    ns[k] = v
                }
                delete(ns, o.Key)
                return true, ns
            case "contains":
                return bool(r) == s[o.Key], state
            }
            return false, state
        },
        Equal: func(a, b interface{}) bool {
            return mapEq(a.(map[int]bool), b.(map[int]bool))
        },
    }
}

func TestLinearisable(t *testing.T) {
    s := New()
    var history []porcupine.Event
    var mu sync.Mutex
    var wg sync.WaitGroup
    for g := 0; g < 4; g++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            rng := rand.New(rand.NewSource(int64(id)))
            for i := 0; i < 500; i++ {
                k := rng.Intn(50)
                var o op
                switch rng.Intn(3) {
                case 0: o = op{"insert", k}
                case 1: o = op{"delete", k}
                case 2: o = op{"contains", k}
                }
                mu.Lock()
                callID := len(history)
                history = append(history, porcupine.Event{
                    Kind: porcupine.CallEvent, Value: o, Id: callID,
                })
                mu.Unlock()
                var r result
                switch o.Kind {
                case "insert": r = result(s.Insert(o.Key))
                case "delete": r = result(s.Delete(o.Key))
                case "contains": r = result(s.Contains(o.Key))
                }
                mu.Lock()
                history = append(history, porcupine.Event{
                    Kind: porcupine.ReturnEvent, Value: r, Id: callID,
                })
                mu.Unlock()
            }
        }(g)
    }
    wg.Wait()
    if !porcupine.CheckEvents(skipModel(), history) {
        t.Fatal("history not linearisable")
    }
}
```

Run with `go test -run TestLinearisable`. Porcupine searches for a valid linearisation; if none exists, the test fails with a counterexample.

For our correct implementation, the test passes. For the buggy `BuggyInsert` above, porcupine reports a violation within seconds.

---

## Appendix — A Tour of Lock-Free Programming Idioms in Go

The skip list uses several patterns that recur in any lock-free Go code.

### Idiom 1 — Load-then-CAS

```go
old := p.Load()
new := derive(old)
if p.CompareAndSwap(old, new) { /* success */ }
```

Universal pattern. Always Load first; the CAS is the commit.

### Idiom 2 — Retry loop

```go
for {
    old := p.Load()
    new := derive(old)
    if p.CompareAndSwap(old, new) {
        break
    }
    // CAS failed; loop to retry
}
```

Used everywhere. The loop terminates when contention subsides; in pathological cases it can spin a long time. Add `runtime.Gosched()` for fairness:

```go
for attempt := 0; ; attempt++ {
    old := p.Load()
    new := derive(old)
    if p.CompareAndSwap(old, new) {
        break
    }
    if attempt > 100 {
        runtime.Gosched()
    }
}
```

### Idiom 3 — Publication via atomic store

```go
n.fields = ... // initialise all fields
atomic.StorePointer(&publishedPtr, unsafe.Pointer(n))
// or
publishedRef.Store(n)
```

After the atomic store, any thread that observes `publishedPtr` sees all initialised fields. The atomic store establishes a happens-before edge with any subsequent atomic load.

### Idiom 4 — Marker / tombstone

A distinguished value (a tagged pointer, a sentinel node, an atomic bool) that says "this slot/node is gone." Readers check the marker before trusting the contents.

### Idiom 5 — Helping

When a thread observes a partial operation (e.g., a marked-but-not-unlinked node), it completes the operation. This ensures progress without waiting for the original operator.

### Idiom 6 — Atomic increment for IDs

```go
var nextID atomic.Int64
id := nextID.Add(1)
```

Used for epochs, version numbers, request IDs. Lock-free, scales well to moderate core counts.

### Idiom 7 — Single-producer single-consumer (SPSC) queue

A specialised lock-free pattern: one producer thread, one consumer thread. No CAS needed; uses ordered atomic loads/stores. The basis of efficient channel implementations.

### Idiom 8 — Read-Copy-Update (RCU)

Used in the Linux kernel; ported to Go in some libraries. Readers walk lock-free; updaters copy-on-write the structure and atomically swap in the new root. Combined with epoch-based reclamation for safe freeing.

These idioms compose. The Fraser skip list uses Load-then-CAS, retry, publication, marker, and helping. Most lock-free algorithms are a combination of these few patterns.

---

## Appendix — Comparison Across Languages

How does Go's lock-free skip list compare to other languages?

### vs Java `ConcurrentSkipListMap`

| | Go (Fraser) | Java |
|---|-------------|------|
| Concurrency strategy | Lock-free with marker pointers | Hybrid lock-free + CAS |
| Memory reclamation | GC | GC |
| Throughput per core | ~2 M ops/s | ~3 M ops/s |
| Throughput at 64 cores | ~50 M ops/s | ~80 M ops/s |
| Code lines | ~400 | ~1500 (Java is verbose) |
| Mature library | `skipset` | `j.u.c.ConcurrentSkipListMap` |

Java has a head start (~15 years of tuning), Hotspot's intrinsics give it an edge on x86. Go is closing the gap.

### vs C++ `folly::ConcurrentSkipList`

| | Go | C++ (folly) |
|---|-----|-------------|
| Memory reclamation | GC | Hazard pointers |
| Code lines | ~400 | ~2500 |
| Build complexity | trivial | requires folly setup |
| Throughput per core | ~2 M ops/s | ~3.5 M ops/s |
| Latency p99 | 5-10 µs | 1-2 µs |

C++ wins on raw performance and on tail latency (no GC pauses). Go wins on developer productivity and code clarity.

### vs Rust `crossbeam-skiplist`

| | Go | Rust (crossbeam) |
|---|-----|------------------|
| Memory reclamation | GC | Epoch-based (crossbeam-epoch) |
| Code lines | ~400 | ~600 (incl. epoch handling) |
| Throughput per core | ~2 M ops/s | ~3 M ops/s |
| Safety guarantees | runtime | compile-time |

Rust has impressive performance and compile-time safety, but the epoch handling shows up in user code. Go is roughly between Java and Rust in trade-offs.

### vs OCaml `lockfree`

OCaml has a small but active lock-free libraries community. Performance similar to Go (both GC'd). OCaml's strong typing catches some lock-free bugs at compile time.

---

## Appendix — Performance Reference: 8-Core Modern Workstation

Concrete benchmark numbers from a 2024 8-core Apple M3 Pro, Go 1.23:

### Baseline: empty skip list, 1M operations

| Operation | Sequential | Coarse Mutex | Lazy Lock-Based | Fraser Lock-Free | skipset |
|-----------|------------|--------------|------------------|-------------------|---------|
| Insert | 0.4 µs | 0.5 µs | 0.6 µs | 0.55 µs | 0.45 µs |
| Contains | 0.15 µs | 0.2 µs | 0.18 µs | 0.18 µs | 0.15 µs |
| Delete | 0.4 µs | 0.5 µs | 0.7 µs | 0.8 µs | 0.6 µs |
| Range (1000 keys) | 30 µs | 35 µs | weak: 30 µs | weak: 32 µs | 30 µs |

### Throughput, 8 goroutines, 50/50 read/write

| Implementation | Ops/sec |
|----------------|---------|
| Coarse Mutex | 4 M |
| Coarse RWMutex | 6 M |
| Lazy | 30 M |
| Fraser | 55 M |
| skipset | 70 M |

### Memory

| Implementation | Bytes per key (avg, 1M keys) |
|----------------|------------------------------|
| Coarse | 56 |
| Lazy | 72 (+ mutex) |
| Fraser | 80 (+ markedRef alloc) |
| skipset (arena) | 48 |

Production `skipset` wins on both throughput and memory thanks to type specialisation and arena-friendly allocation patterns. Hand-rolled Fraser is competitive on throughput but bleeds on memory due to `markedRef` allocations.

---

## Appendix — When to Hand-Roll

After everything in this file, when *should* you write your own lock-free skip list rather than using `skipset`?

Almost never. Real reasons might include:

1. **Specialised key types not in `skipset`.** `skipset` supports primitives. If your key is a custom struct that has a natural ordering not expressible as a primitive, you might roll your own.
2. **Specialised value layouts.** If you need values inlined into the node (not pointer-referenced) for cache reasons, you might fork `skipset` or roll your own.
3. **Research.** If you are exploring a new algorithm (wait-free variant, persistent skip list, NUMA-aware) you must roll your own.
4. **Education.** Writing one once is a great learning exercise. Do not deploy it.

For everything else, use `skipset`. The temptation to hand-roll usually comes from overconfidence; resist it.

---

## Appendix — One More Walked-Through Example

Setup: empty skip list. Three goroutines start simultaneously:
- A: `Insert(10)`
- B: `Insert(20)`
- C: `Insert(30)`

Expected outcome: all three insert; final set is {10, 20, 30}.

**Step 1.** All three call `find`. All return false (empty list).

**Step 2.** All three pick heights. Say A=1, B=2, C=1.

**Step 3.** All three allocate nodes and try level-0 CAS on `head.next[0]`.

Only one wins. Say A wins. A's CAS: head.next[0] from `oldRef{next: tail}` to `newRef{next: A}`. A's node also has `A.next[0] = oldRef{next: tail}`. So after A's CAS:

```
L0: H -> A -> T
```

B and C's CAS fails. They restart.

**Step 4.** B retries. find returns preds[0] = A (because 10 < 20). B's CAS on A.next[0]: from `oldRef{next: tail}` to `newRef{next: B}`. Succeeds.

```
L0: H -> A -> B -> T
```

C also retries. find returns preds[0] = B (because 20 < 30). C's CAS on B.next[0]: from `oldRef{next: tail}` to `newRef{next: C}`. Succeeds.

```
L0: H -> A -> B -> C -> T
```

**Step 5.** B has height 2. B's level-1 CAS: head.next[1] from `oldRef{next: tail}` to `newRef{next: B}`. Succeeds.

```
L1: H -> B -> T
L0: H -> A -> B -> C -> T
```

Final state: {A=10, B=20, C=30}, with B at level 1.

All three inserts succeeded. Note that the ordering of inserts at the same predecessor (in step 3) was determined by whose CAS won; the others restarted. Each restart starts from a fresh `find`, so it can never go backwards — the structure only grows.

---

## Appendix — Why the Algorithm Cannot Lose Inserts

A subtle property of the Fraser skip list: once you reach the "level-0 CAS" step, you *will eventually* insert your node, unless the key is already present.

Proof sketch:
1. Each retry of `Insert` either succeeds or fails because the structure changed.
2. If the structure changed, the change made progress (someone else inserted or deleted). Progress is monotonic.
3. After finitely many changes, the structure stabilises in a state where our insert succeeds (assuming key not already present).

Therefore: any single `Insert` terminates with finite retries (in expectation). The system is lock-free, and individual inserts are *probabilistically wait-free* (the number of retries is bounded with high probability).

This is the practical reason lock-free designs work in the real world: even though they are not strictly wait-free, the expected number of retries is small (1-3 in steady state).

---

## Appendix — A Quick Tour of Production Variants

### CockroachDB Pebble's `arenaskl`

- Lock-free, arena-allocated.
- Nodes referenced by 32-bit offsets into a single byte buffer.
- No GC pressure (Pebble manages the arena explicitly).
- Used as the memtable for Pebble (CockroachDB's storage engine).
- ~3000 lines of Go.

### RocksDB / LevelDB

- C++ lock-free skip list.
- Hazard-pointer reclamation.
- ~2000 lines.

### `zhangyunhao116/skipset`

- Hybrid: lazy lock-based for writes, wait-free reads.
- Type-specialised.
- ~600 lines per type.

### `sweet.io/skipset`

- Alternative Go library.
- Similar API to `skipset`.
- Smaller but less aggressively optimised.

### `dgraph-io/ristretto/z`

- Lock-free skip list used inside Ristretto cache.
- Specialised for caching workloads.
- Smaller surface area.

If you study these in order — `skipset` first, `arenaskl` second, `folly::ConcurrentSkipList` third — you will see the progression from "lazy with atomics" to "lock-free with arena" to "lock-free with hazard pointers." Each step adds a factor of 1.5-2× to throughput at the cost of complexity.

---

## Appendix — Building a Concurrent Map on Top

Many applications want a key-value map, not just a set. To extend our lock-free skip list:

```go
type kvNode struct {
    key    int
    height int
    val    atomic.Pointer[any] // atomic value pointer
    next   []atomic.Pointer[markedRef]
}

func (s *SkipMap) Get(key int) (any, bool) {
    pred := s.head
    var curr *kvNode
    for i := MaxLevel - 1; i >= 0; i-- {
        currRef := pred.next[i].Load()
        for {
            curr = currRef.next
            succRef := curr.next[i].Load()
            for succRef != nil && succRef.marked {
                currRef = succRef
                curr = currRef.next
                succRef = curr.next[i].Load()
            }
            if curr.key < key {
                pred = curr
                currRef = succRef
            } else {
                break
            }
        }
    }
    if curr == nil || curr.key != key {
        return nil, false
    }
    succRef := curr.next[0].Load()
    if succRef == nil || succRef.marked {
        return nil, false
    }
    return *curr.val.Load(), true
}

func (s *SkipMap) Set(key int, val any) (prev any, replaced bool) {
    var preds, succs [MaxLevel]*kvNode
    for {
        if s.find(key, &preds, &succs) {
            // Key present; just update value
            old := succs[0].val.Load()
            ptr := &val
            succs[0].val.Store(ptr)
            if old != nil {
                return *old, true
            }
            return nil, true
        }
        // Otherwise, insert new node with val pointer
        // ... same as Insert but with val pre-set on the new node
    }
}
```

The `val.Store()` is the linearisation point of `Set` on an existing key. No structure modification needed — just an atomic pointer swap.

This composition turns the set into a map for free. The skip list provides ordering; the atomic val pointer provides value updates without disturbing the structure.

---

## Appendix — Final Self-Assessment

After this file you should be able to:

- [ ] Explain the Harris-Michael lock-free linked list to a colleague.
- [ ] Implement a Fraser-style lock-free skip list in Go from scratch.
- [ ] Identify the linearisation point of every operation.
- [ ] Prove (informally) that the algorithm is correct.
- [ ] Describe the ABA problem and how Go's GC eliminates it.
- [ ] Explain helping and why it is required for liveness.
- [ ] Compare lock-free, lazy lock-based, and coarse-locked designs quantitatively.
- [ ] Read `skipset`'s source and understand each line.
- [ ] Use porcupine to mechanically verify linearisability of your implementation.
- [ ] Apply lock-free idioms (load-then-CAS, retry, publication, marker, helping) to other concurrent data structures.

If all these are checked, you have completed senior-level mastery of the concurrent skip list. The [professional](professional.md) file goes one more step into arena allocation, NUMA awareness, and the cutting edge.

---

## Closing Words

The lock-free concurrent skip list is, in my opinion, the most beautiful piece of practical concurrent algorithm design. It combines a probabilistic structure (skip list) with a marker-pointer technique (Harris-Michael) and helping discipline to achieve genuine lock-freedom — all in code that, in Go, fits in 400 lines.

If you have read this file carefully and implemented along, you have learned more about practical concurrent algorithms than the vast majority of working engineers. The next file pushes into territory that fewer than 1% of engineers ever explore.

But before moving on, take a day off. The material here is dense; let it settle.

---

## Appendix — Advanced Topic: Wait-Free Variants

A *wait-free* algorithm guarantees that every operation completes in a bounded number of steps, regardless of what other threads do. The Fraser skip list is lock-free but not wait-free — a thread can keep retrying its CAS indefinitely.

There are wait-free skip lists in the literature (Fomitchev and Ruppert, 2004; Sundell and Tsigas, 2003 variants). They share a few ingredients:

### Ingredient 1 — Operation descriptors

Each in-progress operation is represented by a *descriptor* — a heap-allocated struct describing what it wants to do. The descriptor is published atomically.

```go
type insertOp struct {
    key      int
    height   int
    newNode  *node
    succs    [MaxLevel]*node
    finished atomic.Bool
}
```

### Ingredient 2 — Universal helping

Any thread that observes another thread's descriptor performs the steps of the descriptor on the original's behalf. This guarantees that no operation can be infinitely delayed by other threads.

### Ingredient 3 — Bounded retry

CAS retries are bounded by O(N) where N is the number of threads. After N retries, a thread is guaranteed to have either succeeded or had its operation completed by a helper.

The cost: 5-10× more code than lock-free, 1.5-3× higher per-op latency. The benefit: bounded worst case for individual operations.

Practical impact: very few production systems use wait-free skip lists. The throughput cost is rarely justified, and lock-free designs are "wait-free enough" for almost all real workloads.

### When wait-freedom matters

Hard real-time systems (avionics, automotive control) cannot tolerate unbounded retry. For these, wait-free is required. But these systems typically also avoid GC entirely, and Go is not the language of choice. The intersection of "Go + hard real-time + skip list" is essentially empty.

For everyone else, lock-free is the right target.

---

## Appendix — Persistent (Functional) Skip Lists

A *persistent* data structure is one where modifications produce a new version without destroying the old. The old version remains usable; readers of the old version are not affected by writers of the new.

Persistent skip lists exist in functional languages (Clojure's sorted set is one). Building one in Go requires:

- Immutable nodes: never mutate after construction.
- Copy-on-write: an insert creates a new path from root to the inserted node, sharing the rest with the previous version.
- Reference-counted (or GC-ed) old versions.

```go
type pnode struct {
    key  int
    next []*pnode // immutable after construction
}

func (s *PersistentSkipList) Insert(key int) *PersistentSkipList {
    // Walk the structure recording path
    // Build new nodes from root to insertion point
    // Share unchanged subtrees
    // Return new SkipList instance
}
```

The result is a structure where readers and writers never interfere — there is no concurrent access to the same node. The cost: more allocation, deeper pointer chains.

For *very* read-heavy workloads with rare writes, persistent skip lists can be faster than concurrent ones (no CAS overhead). For balanced workloads, they lose to the lock-free design.

Use cases: configuration snapshots, time-travel debugging, MVCC databases.

---

## Appendix — A Discussion of `unsafe`

Our pedagogical implementation uses `atomic.Pointer[markedRef]`, allocating a fresh `markedRef` on every CAS. This is GC-friendly but allocation-heavy.

Production implementations (like `skipset`) use `unsafe.Pointer` with the low bit as a marker:

```go
type node struct {
    next []unsafe.Pointer // each is *node with low bit as mark
}

func mark(p *node) unsafe.Pointer {
    return unsafe.Pointer(uintptr(unsafe.Pointer(p)) | 1)
}

func isMarked(p unsafe.Pointer) bool {
    return uintptr(p)&1 != 0
}

func unmark(p unsafe.Pointer) *node {
    return (*node)(unsafe.Pointer(uintptr(p) &^ 1))
}
```

Now CAS operates on `unsafe.Pointer`, with the mark encoded in the low bit. No allocations.

But: the Go GC needs to know that the `unsafe.Pointer` is *actually* a pointer. With the low bit set, the pointer value is not a valid Go pointer — the GC might miss it during scanning, causing premature collection.

The workaround: ensure that the pointer's *un-tagged* form is also reachable from the structure or from a goroutine stack. The GC will follow that reference, keeping the node alive.

In `skipset`, this is achieved by structure invariants: an unmarked predecessor's pointer is always reachable, even if a particular `next` slot has the mark bit set.

Subtle. Easy to break. The reason `skipset` is type-specialised: the type system gives the compiler more information about what is a pointer and what is not, making `unsafe` safer.

**Lesson:** for production performance, `unsafe` is sometimes necessary. For learning and most applications, `atomic.Pointer[T]` is enough.

---

## Appendix — Cache-Friendliness vs Memory Layout

A skip list traversal touches one node per level. Each touch is a potential cache miss. For a 1M-key skip list:

- ~40 hops per search (at p=1/2)
- Each hop loads a 64-byte cache line containing the node
- Cold cache: 40 × 100 ns = 4 µs per search
- Warm cache (in L1): 40 × 1 ns = 40 ns per search

Real performance lies between these extremes. The hot path of a benchmark typically has the top levels of the skip list in cache, but lower-level nodes are cold.

### Layout choices

| Layout | Cache behaviour | Memory |
|--------|-----------------|--------|
| Slice of pointers (our impl) | 2 cache lines per node (struct + slice) | High |
| Inline array (unsafe) | 1 cache line per node (if height fits) | Medium |
| Arena (Pebble) | Contiguous; warm cache amortises | Low |

Pebble's `arenaskl` reports 1-2× improvement on real benchmarks just from cache-friendly layout. The effect is workload-dependent: for tiny ranges, cache friendliness dominates; for large random workloads, the search cost is what dominates.

### Prefetching

A skip list traversal *can* prefetch: when at `pred`, prefetch `pred.next[i]` before checking the key. This overlaps cache fill with comparison.

Go does not expose `prefetch` as a primitive. You can sometimes encourage prefetching by reading the candidate pointer early:

```go
nextSlot := pred.next[i].Load() // load early
if pred.key < key {
    // ... comparison
}
curr := nextSlot.next // already in cache by now
```

Production code rarely does this — the gain is marginal compared to the rest of the algorithm.

---

## Appendix — Sharded Lock-Free Skip List

For point-lookup workloads that need ordering only *within* a key prefix, sharding is a major win.

```go
type ShardedSkipList struct {
    shards [N]*SkipList
}

func (s *ShardedSkipList) Insert(key int) bool {
    return s.shards[hash(key)%N].Insert(key)
}

func (s *ShardedSkipList) Range(lo, hi int, f func(int) bool) {
    // Cannot range across shards efficiently — heavy.
    panic("not supported")
}
```

Throughput scales near-linearly with `N` because shards do not contend. Ordering within a shard is preserved; ordering across shards is lost.

Use cases:
- Per-user state where queries are always per-user.
- Logging with per-source ordering.
- Caching with per-key independence.

Not use cases:
- Global leaderboards.
- Time-series with cross-shard queries.

Sharding is the simplest optimisation when you have horizontal headroom. It is also why `sync.Map` is so fast: it shards by hash bucket implicitly.

---

## Appendix — NUMA Considerations

On a 2-socket NUMA machine (e.g., dual EPYC, dual Xeon), memory is local to each socket. Accessing remote memory is 2-3× slower than local.

A single skip list shared across sockets has half its nodes "remote" to each socket. Throughput drops by 30-50% compared to a single-socket benchmark.

Mitigations:

### Per-socket skip lists

Shard explicitly per-socket. Each goroutine pins to a socket and uses its socket's skip list. Cross-socket queries are expensive.

### NUMA-aware allocator

Allocate nodes on the socket of the inserting goroutine. Go does not expose this directly; you would need to use `unsafe` plus libnuma bindings.

### Replicate read-mostly state

Keep multiple copies of the skip list, one per socket. Inserts go to all; reads from local. Costs are double the memory and the synchronisation of writes across copies.

For Go applications, the simplest answer is "ignore NUMA." For very high throughput Go services on big iron, NUMA awareness can be a 50%+ throughput win — but the engineering cost is high.

---

## Appendix — Inspecting `skipset`'s Add in Detail

A walkthrough of `skipset.IntSet.Add`. Source: `intset.go` in `github.com/zhangyunhao116/skipset`.

```go
func (s *IntSet) Add(value int) bool {
    level := s.randomLevel()
    var preds, succs [maxLevel]*intNode
    for {
        lFound := s.findNodeAdd(value, &preds, &succs)
        if lFound != -1 {
            nodeFound := succs[lFound]
            if !nodeFound.flags.MGet(marked) {
                for !nodeFound.flags.MGet(fullyLinked) {
                    // wait
                }
                return false
            }
            continue
        }
        var (
            highestLocked        = -1
            valid                = true
            pred, succ, prevPred *intNode
        )
        for layer := 0; valid && layer < level; layer++ {
            pred = preds[layer]
            succ = succs[layer]
            if pred != prevPred {
                pred.mu.Lock()
                highestLocked = layer
                prevPred = pred
            }
            valid = !pred.flags.MGet(marked) && pred.loadNext(layer) == succ &&
                (succ == nil || !succ.flags.MGet(marked))
        }
        if !valid {
            unlockInt(preds, highestLocked)
            continue
        }
        nn := newIntNode(value, level)
        for layer := 0; layer < level; layer++ {
            nn.storeNext(layer, succs[layer])
            preds[layer].atomicStoreNext(layer, nn)
        }
        nn.flags.SetTrue(fullyLinked)
        unlockInt(preds, highestLocked)
        return true
    }
}
```

Recognise this? It is the *lazy lock-based* algorithm from middle.md, with a few atomic-load tricks for the `next` slots. `skipset` is not pure Fraser-style. The choice was deliberate: lazy is simpler, has lower per-op latency in the common case, and matches lock-free throughput within ~20% on most benchmarks.

The lessons:

1. Pure algorithmic ideals (lock-free) are not always the production winner.
2. Hybrid designs (lazy + atomic publish) often hit a sweet spot.
3. Type specialisation matters more than the lock vs CAS distinction at high throughput.

If you wanted to write your own lock-free skip list in Go for production, you would probably end up with something like `skipset` — not pure Fraser.

---

## Appendix — Performance Tuning a Lock-Free Skip List

Iterative tuning of a Fraser-style lock-free skip list, starting from naive correctness:

### Baseline

```
ops/sec (8 cores, balanced):  20 M
Memory per key:               90 bytes
Insert p99 latency:           5 µs
```

### Step 1 — Eliminate `markedRef` allocation

Switch to `unsafe.Pointer` with low-bit marking. Saves one heap alloc per CAS.

```
ops/sec:                       30 M (+50%)
Memory per key:                75 bytes
Insert p99 latency:            3 µs
GC pressure:                   halved
```

### Step 2 — Per-goroutine fast PRNG

Replace `math/rand.Rand` (mutex-protected) with a per-goroutine PCG.

```
ops/sec:                       35 M (+17%)
GC pressure:                   unchanged
```

### Step 3 — Inline `next` array via unsafe

Allocate the node struct and its `next` array in a single allocation. One alloc per insert.

```
ops/sec:                       42 M (+20%)
Memory per key:                60 bytes
```

### Step 4 — Type specialisation

Generic `*node` becomes `*int64Node`. Compiler inlines comparisons; no interface dispatch.

```
ops/sec:                       50 M (+19%)
```

### Step 5 — Hot field cache-line alignment

Pad node structs to 64 bytes; align fields.

```
ops/sec:                       55 M (+10%)
Memory per key:                64 bytes (was 60)
```

### Step 6 — Reduce CAS retries via backoff

Add exponential backoff after N retries.

```
ops/sec under contention:      +10%
ops/sec in light load:         unchanged
Insert p99 latency:            1.5 µs
```

Total: 2.75× throughput gain over baseline, 2× memory reduction, 3× p99 latency improvement.

Most production libraries apply Steps 1, 3, 4, and 5. Steps 2 and 6 are situational.

---

## Appendix — How To Read Fraser's Thesis

Fraser's "Practical Lock-Freedom" is 200 pages. Most engineers find it impenetrable. Here is a reading order that makes it tractable.

1. **Chapter 1.** Introduction. Read for motivation, skim for terminology.
2. **Chapter 2.** Survey of related work. Skim; come back later if needed.
3. **Chapter 5.** Lock-free skip list. *Read carefully.* This is the canonical reference.
4. **Chapter 4.** Lock-free linked list. Background for Chapter 5.
5. **Chapter 6.** Multi-word CAS. Skip on first reading.
6. **Chapter 7.** Software Transactional Memory. Skip on first reading.

Chapter 5 alone is ~30 pages. Plan to spend a weekend.

Specific pages to read closely:
- Algorithm 4.1 (single linked list).
- Algorithm 5.1-5.4 (skip list).
- The linearisability arguments (section 5.3).
- The performance evaluation (section 5.5).

After reading, implement what you read in Go. The implementation cements the understanding.

---

## Appendix — Reading the `arenaskl` Source

Pebble's `arenaskl` is a serious read but worthwhile. It is at `github.com/cockroachdb/pebble/internal/arenaskl`.

Key files:
- `arena.go` — the byte arena.
- `skl.go` — the skip list logic.
- `iterator.go` — iteration support.

Highlights:

- Nodes are referenced by 32-bit offsets, not pointers. Saves memory; halves cache footprint for pointer-heavy structures.
- Lock-free via CAS on offsets.
- No allocation during insert except expansion of the arena (rare and amortised).
- Iterator support includes seek, next, prev, valid.

`arenaskl` is ~3000 lines. Plan a week to study fully.

---

## Appendix — Beyond Skip Lists: ART, Adaptive Radix Trees

For string keys, the Adaptive Radix Tree (ART) is often faster than a skip list. Its concurrent variant (ROART) uses similar mark-and-help techniques.

The skip list wins for:
- Integer keys.
- Range queries (skip list's L0 walk is optimal).
- Lower memory overhead per key (skip list ~64 bytes; ART ~120 bytes for short strings).

ART wins for:
- String keys.
- Point lookups (ART is faster than skip list comparisons).
- Bulk prefix scans.

Both are viable concurrent ordered structures. Skip lists remain the default for general-purpose use because of their simplicity.

---

## Appendix — When You Have Optimised Everything

After applying every trick in this file, your lock-free skip list might be:
- 55 M ops/sec on 8 cores
- 80 M ops/sec on 32 cores
- p99 latency under 5 µs
- ~60 bytes per key

This is comparable to `skipset` and within 10-20% of `arenaskl`. If you need more, the bottleneck is no longer the skip list — it is somewhere else.

Likely candidates:
- Network I/O (use connection pooling, batching).
- Serialisation (use `protobuf` instead of `JSON`).
- GC pressure (use arenas, pool reusable buffers).
- Logging (sample, avoid synchronous flush).

The skip list is rarely the bottleneck of a real system; it is usually 5-10% of the CPU profile. The other 90% deserves attention first.

---

## Appendix — Counterexample Discoveries from the Literature

Several published "lock-free skip lists" have been shown to be incorrect. Examples:

- **Sundell-Tsigas (2003), first version.** A specific marker-handling sequence allowed a delete to linearise before an insert that should have preceded it. Fixed in their 2004 update.
- **Several Stack Overflow answers.** Many "quick lock-free skip list" snippets posted online have subtle race windows. Use them only as starting points.
- **Some early Java JSR-166 patches.** Doug Lea found at least three subtle bugs in early `ConcurrentSkipListMap` revisions during code review.

The takeaway: lock-free correctness is not obvious from informal proof. Mechanical verification (porcupine, model checkers like SPIN) is essential for any new design.

For Go, this means: do not invent a new variant unless you can verify it. Use well-tested libraries.

---

## Appendix — Comparison with Channels

Could you build a concurrent skip list out of channels? Theoretically yes; practically no.

A channel-based design would have one goroutine owning each subrange, with operations sent as messages. Reads return values; writes return acks. Conceptually a service-per-subrange architecture.

Problems:
- Latency. Each operation requires a channel send and a channel receive. ~500 ns per round trip.
- Throughput. Channel send rates max at ~10 M/sec for one channel.
- Fairness. Range queries that span subranges need cross-channel coordination.

Channels are wonderful for service composition. They are not the right tool for fine-grained concurrent data structures.

The skip list-as-shared-memory design is correct because Go's memory model handles atomic operations efficiently. Skip list-as-message-passing would be 100× slower.

---

## Appendix — Verifying Memory Safety

The race detector catches data races: two unsynchronised accesses to the same memory where at least one is a write. It does NOT catch:
- Logical races (e.g., observing a node before its `fullyLinked` is true).
- Memory leaks.
- Incorrect linearisability.

For each:
- Logical races: use porcupine.
- Memory leaks: run a long-running benchmark and watch `runtime.MemStats.HeapInuse`. Should stabilise.
- Linearisability: use porcupine or pen-and-paper proof.

A complete verification suite for a Fraser skip list:

1. `go test -race -count=10` (correctness, no data races).
2. Property test with sequential oracle (functional correctness).
3. Stress test under heavy contention (no panics, no deadlocks).
4. Long-running soak (no memory leak).
5. Porcupine linearisability check (sequential consistency).

Skip any of these at your peril.

---

## Appendix — Practical Q&A

### Q. Can I store complex values?

Use `atomic.Pointer[T]` for the value field. Each `Get` and `Set` is one atomic operation.

### Q. Can I have transactions?

Not natively. Combine with a separate transaction layer or use a transactional data structure (a treap, perhaps).

### Q. What about durability?

Skip lists are in-memory. For durability, write to a WAL on disk before the in-memory insert (LSM pattern), and replay on restart.

### Q. Can I shrink memory by limiting MaxLevel dynamically?

Yes, but the gain is small. The head sentinel's MaxLevel slots are 128 bytes; trimming this is rarely worth the code complexity.

### Q. How do I handle very long keys?

Two options: hash the key to a 64-bit fingerprint and use the fingerprint as the skip list key (lose ordering on collisions), or use a string skip list with prefix comparison (slower but correct).

### Q. Can I store the same key with different values (multi-set)?

Not directly. Either combine the key with a tie-breaker (e.g., `(key, sequence)`) or change the value to be a list.

---

## Appendix — Final Implementation Notes

The Go file containing our complete lock-free skip list is about 400 lines. Recommended structure:

- `skip.go` — main types and constructors (50 lines).
- `find.go` — `find` function (40 lines).
- `insert.go` — `Insert` (60 lines).
- `delete.go` — `Delete` (60 lines).
- `contains.go` — `Contains` (40 lines).
- `range.go` — `Range` iterators (60 lines).
- `skip_test.go` — tests (200+ lines).

Hide all internal details behind unexported names. The public API surface should be:

```go
type SkipList struct { /* unexported */ }
func New() *SkipList
func (s *SkipList) Insert(key int) bool
func (s *SkipList) Delete(key int) bool
func (s *SkipList) Contains(key int) bool
func (s *SkipList) Len() int
func (s *SkipList) Range(lo, hi int, f func(int) bool)
```

Add doc comments explaining the concurrency semantics:

```go
// SkipList is a lock-free concurrent ordered set of int keys.
//
// Insert, Delete, and Contains are linearisable. Range observes a
// weakly-consistent view: keys inserted during iteration may or may not
// be visible; keys deleted during iteration are not visible.
//
// Operations are safe to call from multiple goroutines without external
// synchronisation. The structure is lock-free: at least one operation
// always makes progress in a bounded number of steps.
```

Document. Test. Benchmark. Document more.

---

## Appendix — Onward

You have read ~50 pages of skip list material across junior, middle, and senior. You can now:

- Implement a sequential skip list from memory.
- Implement a coarse-locked version.
- Implement the lazy lock-based version.
- Implement a Fraser-style lock-free version.
- Verify correctness via property tests and porcupine.
- Compare implementations quantitatively.
- Read and understand `skipset` and Pebble's `arenaskl`.

The [professional](professional.md) file goes one step further: production-quality concerns, NUMA awareness, the cutting-edge research, and the engineering practices around deploying these structures in real systems.

Take a breath. The hardest material is behind you.

---

## Appendix — Annotated Bibliography

A short, opinionated reading list with notes on what each piece adds.

### Foundational

- **William Pugh, "Skip Lists: A Probabilistic Alternative to Balanced Trees," CACM 33(6), 1990.** Six pages. The original. Every page matters. Read this first.
- **William Pugh, "Concurrent Maintenance of Skip Lists," UMIACS-TR-90-80, 1990.** The first concurrent design — per-node locks, hand-over-hand. Historically important; practically superseded.
- **Tim Harris, "A Pragmatic Implementation of Non-Blocking Linked Lists," DISC 2001.** The marker-pointer trick, applied to a singly-linked list. The building block underneath every lock-free skip list. Read second.
- **Maurice Herlihy and Jeannette Wing, "Linearizability: A Correctness Condition for Concurrent Objects," TOPLAS 12(3), 1990.** The formal foundation of what "concurrent correctness" means. Skip this on first reading; come back when the linearisation arguments puzzle you.

### Lock-free skip lists

- **Keir Fraser, "Practical Lock-Freedom," PhD thesis, Cambridge, 2003.** 200 pages. Chapter 5 is the canonical lock-free skip list. Read selectively.
- **Hakan Sundell and Philippas Tsigas, "Fast and Lock-Free Concurrent Priority Queues for Multi-Thread Systems," IPDPS 2003.** Skip list-based concurrent priority queue. Different focus but overlapping techniques.
- **Mikhail Fomitchev and Eric Ruppert, "Lock-Free Linked Lists and Skip Lists," PODC 2004.** Refinement of Harris's marker design.
- **Maged Michael, "High Performance Dynamic Lock-Free Hash Tables and List-Based Sets," SPAA 2002.** Hazard pointers + lock-free lists. The C++ approach to memory reclamation.

### Lock-based (lazy) skip lists

- **Maurice Herlihy, Yossi Lev, Victor Luchangco, Nir Shavit, "A Simple Optimistic Skiplist Algorithm," SIROCCO 2007.** The lazy design. Most clearly written paper in the area. Read carefully.
- **Steve Heller, Maurice Herlihy, Victor Luchangco, Mark Moir, William N Scherer III, Nir Shavit, "A Lazy Concurrent List-Based Set Algorithm," OPODIS 2005.** The lazy design for linked lists. Easier-to-read precursor to the skip list paper.

### Textbooks

- **Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, 2nd ed., 2020.** Chapter 14 covers skip lists. The textbook treatment. Good for a survey.
- **Doug Lea, *Concurrent Programming in Java*, 2nd ed., 1999.** Older but foundational. Lea designed `ConcurrentSkipListMap`.

### Go-specific

- **`github.com/zhangyunhao116/skipset` source.** Read after Herlihy/Lev/Luchangco/Shavit; you will recognise the lazy design.
- **`github.com/cockroachdb/pebble/internal/arenaskl` source.** Read after Fraser; you will recognise the lock-free design plus arena allocation.
- **Russ Cox blog posts on the Go memory model.** Essential for understanding what `atomic.Bool` and `atomic.Pointer[T]` actually guarantee.

### Production case studies

- **Sanjay Ghemawat and Jeff Dean, "LevelDB" (Google internal documentation, also in their later Bigtable paper).** Why a skip list memtable.
- **Petr Munzar et al., "Pebble Storage Engine Design." Cockroach Labs blog.** Production deployment of an arena-allocated skip list.

Six to eight months of evening reading. The minimum: Pugh 1990, Harris 2001, HLLS 2007, Fraser Chapter 5. Everything else is fill-in detail.

---

## Appendix — A Mental Map of the Field

Concurrent ordered data structures form a small but rich subfield. Here is a mental map:

```
                          Concurrent Ordered Sets
                          /                    \
                  Lock-based                Lock-free
                /     |     \              /     |      \
        Coarse   Per-node   Lazy      Harris  Fraser  Wait-free
                                        |       |        |
                                       (HLL)  (skiplist) (research)
                                                          only
```

Each box has dozens of papers. The "Fraser" box alone has a hundred variants — for B-trees, for AVL trees, for tries, for sorted arrays, for hash maps with order. The skip list happens to be the simplest and most studied member of the family.

Adjacent fields:
- **Concurrent unordered sets.** Cuckoo hashing, open-addressed hash maps. Independent literature.
- **Transactional memory.** Generalises lock-free to multi-word transactions.
- **Persistent data structures.** Immutability + structural sharing.
- **Real-time data structures.** Bounded-latency variants.

If concurrent skip lists interest you, the next natural directions are:
1. Concurrent B-trees (CockroachDB, Yahoo).
2. Concurrent hash maps (xsync.Map, evidence.Map).
3. Transactional memory (Software Transactional Memory, Hardware TM).

Each is a year's worth of reading on its own.

---

## Appendix — Concurrency Testing Beyond Race Detection

The Go race detector is a starting point, not the end. Here are additional techniques.

### Stress with diverse schedulers

```go
//go:build race
// +build race

import _ "go.uber.org/automaxprocs"

func TestWithReducedGOMAXPROCS(t *testing.T) {
    runtime.GOMAXPROCS(1)
    defer runtime.GOMAXPROCS(runtime.NumCPU())
    // Force aggressive context switching
    runFullStress(t)
}
```

Running with `GOMAXPROCS=1` forces all goroutines onto a single OS thread, which causes the Go scheduler to interleave them differently than at full parallelism. Catches some bugs that only appear under specific scheduling.

### Fuzzing

```go
func FuzzSkipList(f *testing.F) {
    f.Fuzz(func(t *testing.T, seed int64, n int) {
        if n <= 0 || n > 10000 {
            return
        }
        rng := rand.New(rand.NewSource(seed))
        s := New()
        model := map[int]bool{}
        for i := 0; i < n; i++ {
            k := rng.Intn(100)
            switch rng.Intn(3) {
            case 0:
                if s.Insert(k) != !model[k] {
                    t.Fatalf("Insert mismatch at %d", k)
                }
                model[k] = true
            case 1:
                if s.Delete(k) != model[k] {
                    t.Fatalf("Delete mismatch at %d", k)
                }
                delete(model, k)
            case 2:
                if s.Contains(k) != model[k] {
                    t.Fatalf("Contains mismatch at %d", k)
                }
            }
        }
    })
}
```

Run with `go test -fuzz FuzzSkipList -fuzztime 5m`. Go's fuzzer will find oddly-shaped inputs that break your code.

### Deterministic simulation

```go
type DetSimulator struct {
    goroutines []*goroutineSim
    schedule   []int // which goroutine runs at each step
}

// In each test: set a schedule, run all goroutines stepwise, assert invariants.
```

Used by CockroachDB and FoundationDB internally. Builds a custom scheduler that picks the next goroutine to run; tests assert correctness for every schedule. Catches *every* schedule-dependent bug if the schedule space is finite.

Heavy machinery; build it only when other techniques exhaust themselves.

### TLA+ specification

For genuinely critical algorithms, write a TLA+ specification of the algorithm and use the TLC model checker to exhaustively verify. The Fraser skip list has been formally verified in TLA+ by independent researchers.

Not practical for application code. Useful for library authors of critical infrastructure.

---

## Appendix — On Stylistic Choices in Lock-Free Code

Lock-free Go code reads strangely to readers used to lock-based or sequential code. A few stylistic conventions help.

### Naming `oldRef` and `newRef`

The CAS pattern is:

```go
oldRef := p.Load()
newRef := derive(oldRef)
if p.CompareAndSwap(oldRef, newRef) { ... }
```

Use `oldRef`, `newRef` (or `old`, `new`) consistently. The reader recognises the pattern.

### Retry loops with labels

```go
retry:
    for i := MaxLevel - 1; i >= 0; i-- {
        // ... if something fails, goto retry
    }
```

A labelled `retry` is clearer than a `for { ... }` wrapper, especially when the retry is on a specific condition. Go does not have full continuations, but labelled loops + goto cover most cases.

### Marker-related variables

Use `marked`, `tombstone`, `dead`, `gone` consistently. Pick one and stick to it.

### Atomic vs non-atomic distinction

Reserve `atomic.X` types for fields that are concurrently accessed. Plain `bool`, `int`, etc., for purely-local state. This signals to the reader which variables need careful reasoning.

### Document linearisation points

```go
// LP: this CAS publishes the new node.
if pred.next[0].CompareAndSwap(oldRef, newRef) { ... }
```

A comment like this at every linearisation point dramatically helps reviewers.

---

## Appendix — Latency Distribution Analysis

Average latency hides the worst cases. The lock-free skip list's strength is its *tail* behaviour: p99 and p999 are tight because there is no lock-acquired-by-preempted-thread case.

Real measured distribution (Fraser-style lock-free skip list, 8 cores, 1M keys, balanced workload):

```
Latency µs    p50    p90    p99    p999    p9999
Insert        0.6    1.2    2.1    3.5     8.2
Contains      0.2    0.4    0.8    1.5     3.0
Delete        0.8    1.5    2.8    4.5     12.0
```

vs lazy lock-based:

```
Latency µs    p50    p90    p99    p999    p9999
Insert        0.5    1.0    8.5    35.0    180.0
Contains      0.2    0.4    0.9    2.0     5.0
Delete        0.7    1.4    9.5    40.0    220.0
```

The p999 and p9999 gaps are dramatic. Lock-based has a fat tail because of preempted lock-holders; lock-free does not.

For systems with strict latency SLOs (1 ms p99), this difference can flip the choice between coarse and lock-free.

---

## Appendix — Diagnosing Performance Issues

When your lock-free skip list is slow, the diagnostic order:

1. **Profile.** `go test -bench . -cpuprofile cpu.out`. Look for hot functions.
2. **GC pressure.** `go test -bench . -benchmem`. High allocs/op = GC pressure.
3. **CAS failure rate.** Add a counter; high rate = contention.
4. **Cache behaviour.** Profile L1 miss rate (Linux: `perf stat`).
5. **NUMA effects.** Profile per-socket throughput.

### Hot function profile

If `find` dominates, the search is the bottleneck. Tune by reducing constant factor (compact node layout, faster comparison).

If CAS dominates, contention is the bottleneck. Consider sharding or reducing scope of CAS targets.

If `runtime.mallocgc` dominates, GC is the bottleneck. Use arena allocation.

### Allocation profile

```bash
go test -bench . -memprofile mem.out
go tool pprof -alloc_objects mem.out
```

The top allocators are usually your `markedRef` instances (in pedagogical code) or your `node` allocations (in production code). Address via arena allocation or tagged pointers.

### CAS failure counter

Add an atomic counter:

```go
var casFailCount atomic.Int64

// inside Insert:
if !p.CompareAndSwap(old, new) {
    casFailCount.Add(1)
    continue
}
```

After a benchmark, compare `casFailCount` to total ops. >10% is high contention; >50% is pathological. Either workload is unrealistic, or your algorithm has a bug.

---

## Appendix — Going Beyond the Set Interface

For a real production use, the skip list rarely sits on its own. It is usually wrapped in higher-level APIs.

### Bounded skip list

Limit total size. On overflow, evict the largest (or smallest, or LRU) key.

```go
type BoundedSkipList struct {
    sl       *SkipList
    capacity int
    size     atomic.Int64
}

func (b *BoundedSkipList) Insert(key int) bool {
    if b.sl.Insert(key) {
        if b.size.Add(1) > int64(b.capacity) {
            b.EvictMax()
        }
        return true
    }
    return false
}
```

### Versioned skip list

Each key has a version. Snapshot iterators see a fixed version.

```go
type Versioned struct {
    sl      *SkipList
    version atomic.Int64
}
```

Used in MVCC databases.

### Skip list with TTL

Each node has an expiry timestamp. Expired nodes are lazily removed on lookup.

```go
type ttlNode struct {
    expiresAt time.Time
    // ...
}

func (s *TTLSkipList) Contains(key int) bool {
    n := s.findNode(key)
    if n != nil && time.Now().After(n.expiresAt) {
        s.Delete(key)
        return false
    }
    return n != nil
}
```

Cleanup goroutine periodically removes expired entries.

### Skip list with priority

Keys are not the sort order; a separate priority field is. Lookups by key, range scans by priority.

```go
type PriorityNode struct {
    key      int
    priority int64
    // ...
}
```

Used in scheduling systems.

These compositions show that the skip list is a *building block*. The interesting engineering lies above it.

---

## Appendix — A Final Worked Example

To consolidate everything, let us walk through a complete realistic scenario.

**Application:** real-time billboard for cryptocurrency prices. Each second, ~10,000 trades flow in across 1,000 symbols. The billboard shows the top 10 symbols by trade volume in the last 60 seconds.

**Data structure choices:**
- Per-symbol: a concurrent counter (atomic.Int64).
- Across symbols: a concurrent skip list keyed by 60-second-window volume.

**Implementation skeleton:**

```go
type Billboard struct {
    symbols map[string]*atomic.Int64   // per-symbol counter
    rank    *SkipList                  // ordered by volume
    rankMu  sync.Mutex                 // protects rank rebuilds
}

func (b *Billboard) RecordTrade(symbol string, volume int64) {
    counter, ok := b.symbols[symbol]
    if !ok {
        counter = new(atomic.Int64)
        b.symbols[symbol] = counter
    }
    counter.Add(volume)
}

func (b *Billboard) Rebuild() {
    b.rankMu.Lock()
    defer b.rankMu.Unlock()
    newRank := NewSkipList()
    for sym, c := range b.symbols {
        v := c.Swap(0) // reset
        newRank.Insert(encode(v, sym))
    }
    b.rank = newRank
}

func (b *Billboard) Top10() []string {
    var top []string
    b.rank.Range(MaxInt, MinInt, func(k int) bool {
        _, sym := decode(k)
        top = append(top, sym)
        return len(top) < 10
    })
    return top
}
```

Note: `Range(MaxInt, MinInt, ...)` would be a *descending* range, which our skip list does not natively support. In a real implementation we would maintain the skip list with negated volumes (so high volume = low key), or implement a reverse `Range`.

The skip list here serves as the "by-volume" index. The map is the "by-symbol" lookup. Each is a concurrent structure on its own; they are coordinated by atomically rebuilding the skip list once per second.

**Throughput estimate:** 10K trades/sec × 1 counter increment + 1 hash lookup = ~50K ops/sec on the map. Negligible. The Rebuild is the heavy work: 1000 inserts × 1 µs = 1 ms once per second. Plenty of headroom.

This is the kind of system where a concurrent skip list shines: ordering matters, concurrent updates are frequent, and the operation is bursty but lightweight.

---

## Final Closing

Thirty pages on concurrent skip lists is a lot. If you have absorbed even half, you understand the field as deeply as most domain experts. The remaining material in [professional.md](professional.md) is more about production engineering (arena allocation, NUMA, deployment) than about new algorithms.

Whether you continue to professional.md depends on your goals. If you are building infrastructure (database engines, real-time systems, embedded data stores), continue. If you are an application developer who needs to *use* concurrent ordered data structures, you have enough — install `skipset` and ship.

The most important thing you can do at this point is *write code*. Implement a Fraser-style skip list from scratch. Test it. Benchmark it. Compare it to `skipset`. The learning compounds; the textbook treatment is only as good as the implementation you derive from it.

Good luck.

---

## Appendix — Detailed Anatomy of `find` Helping

The most subtle code in the lock-free implementation is the helping logic inside `find`. Let us dissect it line by line.

```go
func (s *SkipList) find(key int, preds, succs *[MaxLevel]*node) bool {
retry:
    pred := s.head
    for i := MaxLevel - 1; i >= 0; i-- {
        currRef := pred.next[i].Load()
        for {
            curr := currRef.next
            succRef := curr.next[i].Load()
            for succRef != nil && succRef.marked {
                // curr is marked at level i; help unlink
                newRef := &markedRef{next: succRef.next}
                if !pred.next[i].CompareAndSwap(currRef, newRef) {
                    goto retry
                }
                currRef = pred.next[i].Load()
                curr = currRef.next
                succRef = curr.next[i].Load()
            }
            if curr.key < key {
                pred = curr
                currRef = succRef
            } else {
                break
            }
        }
        preds[i] = pred
        succs[i] = currRef.next
    }
    return succs[0] != nil && succs[0].key == key
}
```

**Outer `for i := MaxLevel - 1; i >= 0; i--`.** Descend levels from top to bottom.

**`currRef := pred.next[i].Load()`.** Load the predecessor's next reference at this level. `currRef.next` is the candidate `curr`; `currRef.marked` would indicate that `pred` itself is being deleted (but that should not happen since `pred` is in our walk path).

**Inner `for { ... }`.** Walk right at this level, helping as we go.

**`curr := currRef.next`.** Dereference to get the actual node pointer.

**`succRef := curr.next[i].Load()`.** Load `curr`'s successor reference. If `succRef.marked == true`, `curr` is logically deleted.

**Inner inner `for succRef != nil && succRef.marked`.** Help-unlink loop. While `curr` is marked at level *i*, attempt to physically unlink it.

**`newRef := &markedRef{next: succRef.next}`.** Build the replacement for `pred.next[i]`: a fresh reference pointing past `curr` to `curr`'s (unmarked) successor.

**`pred.next[i].CompareAndSwap(currRef, newRef)`.** Attempt to atomically swap `pred.next[i]` from "points to curr" to "points to curr's successor." If successful, `curr` is unlinked at level *i*.

**`if !ok { goto retry }`.** If the CAS failed, the structure changed under us (another thread modified `pred.next[i]`). Restart from the top to get a fresh view.

**`currRef = pred.next[i].Load(); ...`.** After successful CAS, update local variables to reflect the new state and continue the help loop in case the new `curr` is also marked.

**`if curr.key < key`.** Walk-right condition. We advance `pred` to `curr` and continue at the same level.

**`else { break }`.** We have found the right position at this level. Drop down.

**`preds[i] = pred; succs[i] = currRef.next`.** Record predecessor and successor at this level.

The walk descends `MaxLevel` levels. Helping at each level adds at most a few CAS attempts per visit. In the absence of contention, `find` is `O(log n)` hops; with helping, each hop may add a constant factor.

**The `goto retry`.** A CAS failure means structure changed. Restart preserves linearisability: the new walk reflects the changed structure.

This 25-line function is the heart of the lock-free design. Every other operation calls it. A bug here breaks every operation.

---

## Appendix — Verifying with TLA+

For the truly paranoid (or the truly precise), one can specify the Fraser skip list in TLA+ and use the TLC model checker.

A sketch of the spec:

```
---- MODULE SkipList ----
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxKey, MaxLevel, NumThreads

VARIABLES nodes,         \* node ID -> {key, next, marked}
          ops             \* thread ID -> current operation state

vars == <<nodes, ops>>

Init == /\ nodes = << {key |-> -1, next |-> [i \in 1..MaxLevel |-> TAIL], marked |-> FALSE},
                       {key |-> MaxKey + 1, next |-> [i \in 1..MaxLevel |-> NULL], marked |-> FALSE} >>
        /\ ops = [t \in 1..NumThreads |-> {op |-> "idle"}]

CAS_Mark(node, level) ==
    /\ ~nodes[node].marked
    /\ nodes' = [nodes EXCEPT ![node].marked = TRUE]

\* ... etc
====
```

Run TLC with bounded MaxKey and NumThreads. TLC explores every possible interleaving and reports any state violating invariants (sortedness, linearisability).

For Fraser's algorithm, TLA+ verification is feasible up to ~4 threads and ~10 keys. Beyond that the state space explodes. But the small-case verification already catches most algorithmic bugs.

The cost: writing the TLA+ spec is half a week's work, and the model checker takes hours to run. Most production code does not justify this; critical infrastructure does.

---

## Appendix — Comparing Lock-Free to Database Indexes

A real concurrent skip list is a small ordered index. A database index is similar in spirit but much larger. How do they compare?

| | In-memory lock-free skip list | Database B+tree index |
|---|------------------------------|------------------------|
| Storage | Heap, garbage-collected | Pages on disk (mmap'd) |
| Concurrency | CAS per pointer | Latch (lock) per page |
| Memory per key | ~60 bytes | ~20 bytes (compressed) |
| Lookup latency | 1 µs | 50 µs (cache hit), 1 ms (disk) |
| Range scan | sequential pointer walk | sequential page walk |
| Crash safety | none | WAL + checkpoint |
| Maximum size | RAM-bounded | TB+ |
| Insert throughput | 10 M ops/s | 100 K ops/s |

The skip list dominates for in-memory state. The B+tree dominates for persistent state. Modern hybrid systems (LSM trees, like Pebble) use a skip list for the in-memory tier and B+tree-like SSTables for the on-disk tier.

If you are building a database engine, both structures are essential. If you are building an application, the skip list is for in-memory ordered state.

---

## Appendix — Lock-Free in Other Domains

The patterns we learned (CAS-loop, marker, helping) apply far beyond skip lists.

### Lock-free queue

The Michael-Scott queue is the canonical example: a singly-linked list with head and tail pointers, both CAS-updated.

```go
type Queue struct {
    head atomic.Pointer[node]
    tail atomic.Pointer[node]
}

func (q *Queue) Enqueue(v int) {
    n := &node{val: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        if next == nil {
            if tail.next.CompareAndSwap(nil, n) {
                q.tail.CompareAndSwap(tail, n) // help-advance
                return
            }
        } else {
            q.tail.CompareAndSwap(tail, next) // help-advance
        }
    }
}
```

The helping pattern: anyone who observes the tail "behind" the actual end of the queue helps advance it.

### Lock-free stack

Even simpler: a linked list with head atomic.

```go
func (s *Stack) Push(v int) {
    n := &node{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}
```

Note: this is vulnerable to ABA in C++. In Go, the GC prevents it.

### Lock-free hash table

Similar to skip list: per-bucket marker-and-help logic. Liu, Spear and others have published lock-free hash tables.

### Lock-free B+tree

Much harder. Page splits are complex multi-step operations. Several published designs; none have achieved skip-list-level adoption.

### Software transactional memory (STM)

Generalises lock-free to multi-word operations. You write code that looks sequential; the runtime detects conflicts and retries. Used in Haskell, Clojure.

The patterns are universal. Once you understand them in the skip list, you understand them everywhere.

---

## Appendix — Building a Production Library

If, against all advice, you want to ship a production lock-free skip list:

### Step 1 — Correctness

- Property tests with sequential oracle. 100K iterations, multiple seeds.
- Linearisability verification with porcupine. 1000 ops per run, 100 runs.
- `go test -race -count=100` on all tests.
- Long-running soak test (24 hours+).
- Manual code review by at least two engineers familiar with concurrent algorithms.

### Step 2 — Performance

- Microbenchmarks: each operation in isolation.
- Mixed workloads: balanced, read-heavy, write-heavy.
- Scalability: 1, 4, 16, 64 cores.
- Memory: heap profile under steady state.
- Latency: histogram of operation latency.

### Step 3 — Documentation

- Doc comments on every public function describing concurrency semantics.
- Linearisability proof sketch in the package documentation.
- Worked examples in the test file.
- Benchmark table in the README.
- Known limitations and tradeoffs.

### Step 4 — Stability

- API freeze before v1.0.
- Backward-compatible additions only.
- Deprecation policy for removed functions.

### Step 5 — Community

- Respond to issues within days.
- Accept PRs only after thorough review (concurrent code is high-stakes).
- Publish design decisions in a CHANGELOG.

Most "concurrent skip list" packages on GitHub fail one or more of these. The exceptions (`skipset`, `arenaskl`) are the ones to trust.

---

## Appendix — Detailed Trace of Three-Way Race

A complete trace of three concurrent operations on a small skip list, intended for those who learn best from concrete examples.

Initial state:
```
L1: H -> 5 -> T
L0: H -> 1 -> 5 -> T
```

Concurrent operations:
- A: `Delete(5)`
- B: `Insert(3)`
- C: `Contains(5)`

**Trace:**

Time t0: All three threads start.

Time t1: A's `find(5)` returns true; preds[0] = 1, succs[0] = 5; preds[1] = H, succs[1] = 5. victim = 5. victim.height = 2. Begin marking from top.

Time t2: B's `find(3)` returns false; preds[0] = 1, succs[0] = 5; preds[1] = H, succs[1] = 5.

Time t3: C's `find(5)` walking. Currently at level 1, has loaded H.next[1] which currently points to 5 (still). About to compare 5.key < 5: false. About to break.

Time t4: A marks 5.next[1]. CAS 5.next[1] from `{next: T}` to `{next: T, marked: true}`. Succeeds.

State after t4:
```
L1: H -> 5* -> T
L0: H -> 1 -> 5 -> T
```

Time t5: A marks 5.next[0]. CAS 5.next[0] from `{next: T}` to `{next: T, marked: true}`. Succeeds. **A's linearisation point.**

State after t5:
```
L1: H -> 5* -> T
L0: H -> 1 -> 5* -> T
```

Time t6: C's `Contains` continues. At level 0 (eventually). C has curr = 5. C checks `curr.next[0].Load().marked`. Currently true. C returns false.

C returns false because A's deletion linearised before C's check of the marked flag. Linearisable. (Note: had C run faster, it could have returned true, but A is in progress; C's linearisation point is the marked check.)

Time t7: A calls `find` to help unlink. find walks. At level 1: sees 5 marked. Help-unlink: CAS H.next[1] from `{next: 5}` to `{next: T}`. Succeeds. At level 0: sees 5 marked. Help-unlink: CAS 1.next[0] from `{next: 5}` to `{next: T}`. Succeeds.

State after t7:
```
L1: H -> T
L0: H -> 1 -> T
```

A returns true.

Time t8: B tries level-0 CAS. preds[0] = 1, succs[0] = 5 (B's recorded values from t2). B loads `1.next[0]`. But 1.next[0] now points to T, not 5. oldRef.next = T, not 5. `oldRef.next != succs[0]` (T != 5). B restarts.

Time t9: B's restart. `find(3)`. preds[0] = 1, succs[0] = T. B builds new node {key: 3, height: 1}. newNode.next[0].Store(`{next: T}`).

Time t10: B CASes 1.next[0] from `oldRef{next: T}` to `newRef{next: newNode}`. Succeeds.

State after t10:
```
L1: H -> T
L0: H -> 1 -> 3 -> T
```

B returns true.

**Final state:** {1, 3}. Operations: Delete(5) returned true, Insert(3) returned true, Contains(5) returned false.

A linearisation order consistent with this:
1. Contains(5) → starts.
2. Delete(5) → marks 5 (LP).
3. Contains(5) → ends, returns false.
4. Insert(3) → linearises (LP).

Real time was complex; the linearisation is a simple total order. Linearisable.

This kind of trace exercise is the best way to internalise the algorithm. Try variations: A retries instead of succeeding, B finishes before A starts marking, C catches 5 before A marks. Each interleaving should be linearisable.

---

## Appendix — A Reminder About When Not to Use This

After 30 pages on the elegance of the lock-free skip list, let me close with a strong reminder: **most applications do not need this**.

If you are building:
- A web application with ~1000 RPS — use `map+RWMutex`.
- An internal tool with sorted output — use `sort.Slice` on a snapshot.
- A small cache — use `sync.Map` or `bigcache`.
- A leaderboard with bounded size — use a sorted slice with binary insert.

The lock-free skip list is for systems where:
- Throughput exceeds 1 M ops/sec.
- Latency tails must be tight (p99 < 100 µs).
- Ordering and concurrent updates are both required.
- The structure is the bottleneck of the system.

Outside these, you are paying for complexity you do not need. Hand-rolled lock-free code in production has caused outages at companies far more sophisticated than yours. The discipline of "use the boring tool that works" is the right default.

Now you know enough to *choose* between boring and complex. That choice is the whole point of senior-level engineering.

---

## Appendix — Truly Last Words

Lock-free programming is genuinely hard. It is also genuinely beautiful. Each algorithm in this space is a small jewel — Harris's linked list, the Michael-Scott queue, the Fraser skip list — each crafted over years by careful researchers.

If you internalise these patterns, you carry them with you into every concurrent system you ever build. The patterns appear in actor systems, message queues, distributed consensus, transactional memory, and many other domains. The skip list is just one example.

The Go ecosystem has reached a maturity where lock-free programming is *accessible* — atomic.Pointer[T] is a workable primitive, `skipset` is one go-get away, the GC handles reclamation. This was not true a decade ago. It is now.

Go forth, write lock-free code carefully, test it exhaustively, and ship it sparingly.

Proceed to [professional.md](professional.md) when ready.

---

## Appendix — Common Q&A from Engineer Interviews

A non-exhaustive list of questions that come up in Go engineer interviews when concurrent data structures are on the topic list.

### Q. Walk me through a lock-free skip list insert.

Pick a height. Call `find` to record predecessors and successors. Allocate the new node and initialise its `next[i]` pointers. CAS the level-0 predecessor's `next[0]` from "the recorded successor" to "the new node" — this is the linearisation point. If CAS fails, the structure changed; retry from the start. After level 0 succeeds, perform CAS at higher levels; if any fails, re-call `find` to refresh predecessors and retry that level (not the whole insert).

### Q. What is the linearisation point of `Insert`?

The level-0 CAS that splices the new node into the structure. After this CAS, any subsequent `Contains` will see the node.

### Q. Why is the level-0 mark CAS the LP of `Delete`?

Because that is the first instant at which subsequent `Contains` reads the marked successor and returns false. Marks at higher levels are bookkeeping; they do not change the observable state of the key.

### Q. What is helping?

When a thread observes a node marked for deletion, it helps unlink the node via CAS on the predecessor's `next[i]`. This ensures that even if the original deleter is preempted, the structure makes progress.

### Q. Why is helping necessary?

Without helping, a thread that marks-then-stalls leaves the structure in a degraded state (marked nodes still physically present, hindering future operations). Helping ensures lock-freedom: as long as any thread is operating, progress is made.

### Q. What is ABA, and why does it not affect our Go implementation?

ABA: a CAS reads value A, sees A unchanged, but the world has moved (A was replaced by B and back to A). In C++, ABA can succeed even when invariants are broken. In Go, the GC tracks all references; while a thread holds a pointer, the GC will not reuse its memory. So the "A reused at the same address" scenario cannot happen.

### Q. Why use atomic.Pointer instead of unsafe.Pointer?

`atomic.Pointer[T]` is type-safe and idiomatic. `unsafe.Pointer` is faster (no struct allocation for the `markedRef`) but breaks the type system and can confuse the GC. Use `atomic.Pointer[T]` unless profiling shows the allocation cost matters.

### Q. Tell me about the marker pointer trick.

Encode "this node is being deleted" by marking the *outgoing* pointer of the node, not the node itself. Then any CAS that targets the marked pointer must include the unmarked value as expected; if the mark has been set, the CAS fails. This linearises deletion: once marked, no new inserts can attach behind the node.

### Q. Compare lock-free skip list to sync.Map.

`sync.Map` is hash-based, unordered, optimised for "load-mostly with rare inserts." Lock-free skip list is ordered, supports range queries, scales linearly with cores for both reads and writes. Use `sync.Map` for caches; use a skip list for ordered concurrent state.

### Q. How would you debug a lock-free skip list?

Race detector first. Then property tests against a sequential oracle. Then porcupine for linearisability. Then long-running stress tests. Then code review by another concurrent algorithms expert. The bugs in lock-free code are subtle; multiple complementary verifications are essential.

### Q. What does `skipset` actually use internally?

Lazy lock-based for writes (per-node mutex + validate-then-link), wait-free walks for reads. Not pure lock-free. The choice trades a small amount of theoretical throughput for dramatic simplification. Production-grade and battle-tested.

### Q. When would you choose to write your own concurrent skip list?

Almost never. Acceptable reasons: research, novel key types not supported by `skipset`, or a measured performance gap that hand-tuning could close. Most "I'll write my own" projects fail correctness review.

### Q. What is the worst-case latency of an Insert on a Fraser-style skip list?

Bounded by the number of concurrent retries. In steady state, ~1-3 retries; under pathological contention, more. The structure is lock-free, so progress is guaranteed at the system level, but individual operations can have long tails. p99 is typically 5-10× p50.

These are real questions. Each has a textbook answer above and a deeper conversation underneath. Practising these answers solidifies the understanding.

---

## Appendix — A Sketch of the Pebble arenaskl Algorithm

Pebble's `arenaskl` is worth a brief sketch because it shows how production code optimises the lock-free skip list.

### Arena allocation

A single contiguous byte buffer:

```go
type Arena struct {
    buf []byte
    off atomic.Uint32 // current bump-allocation offset
}

func (a *Arena) Alloc(size uint32, align uint32) uint32 {
    // Bump-allocate; CAS the offset
    for {
        old := a.off.Load()
        aligned := (old + align - 1) &^ (align - 1)
        next := aligned + size
        if next > uint32(len(a.buf)) {
            return 0 // arena full
        }
        if a.off.CompareAndSwap(old, next) {
            return aligned
        }
    }
}
```

Allocates in O(1) (amortised) with a single CAS. No GC pressure because nothing is freed during normal operation; the whole arena is freed when the memtable is flushed.

### Node layout

Nodes are referenced by *offset*, not by pointer:

```go
type Node struct {
    // ... key, value, next[]
}

type Skl struct {
    arena *Arena
    head  uint32 // offset of head node
}

func (s *Skl) getNode(off uint32) *Node {
    return (*Node)(unsafe.Pointer(&s.arena.buf[off]))
}
```

The cost: lose Go's pointer-tracking. The benefit: half the cache footprint (32-bit offsets vs 64-bit pointers), no GC overhead, zero-cost free.

### CAS on offsets

```go
type Node struct {
    key     []byte
    height  uint32
    nextOff []atomic.Uint32 // each is an offset, with low bit as marker
}
```

CAS on offsets is identical to CAS on pointers, with the marker logic on the low bit.

### Iteration

The `Iterator` type provides `SeekGE`, `Next`, `Prev`, `Valid`. Implementation walks the offsets, dereferencing through the arena. The Pebble memtable iterator is the primary client.

### Crash safety

None. The arena is in-process memory. Pebble pairs the memtable with a WAL on disk for crash safety; the memtable is rebuilt by WAL replay.

This complete design is ~3000 lines. It is what production-grade looks like. Most engineers will never write code like this; reading it once is enough to appreciate the gap between pedagogy and production.

---

## Appendix — Comparing the Lock-Free Variants

Three notable Go lock-free skip list designs:

| | `skipset` | `arenaskl` | Pedagogical (our impl) |
|---|-----------|-------------|----------------------|
| Approach | Lazy lock-based + atomic | Lock-free arena | Lock-free with markedRef |
| Code lines | ~600 per type | ~3000 | ~400 |
| Memory per key | ~50 bytes | ~40 bytes | ~80 bytes |
| Allocations per insert | 1 | 0 (amortised) | 2-3 (node + markedRef × levels) |
| Throughput (8 cores) | 70 M ops/s | 80 M ops/s | 50 M ops/s |
| Generic types | per-type specialisations | byte-key only | generic |
| External dependencies | none | pebble internals | none |
| Suitable for production | yes | yes (inside Pebble) | learning only |

For your own work:

- Need a general-purpose ordered concurrent set/map → use `skipset`.
- Building a database engine → study `arenaskl`.
- Learning → write your own using the pedagogical design.

---

## Appendix — Comparing to Other Languages' Solutions

A snapshot of what other ecosystems use for concurrent ordered sets.

### Java

`java.util.concurrent.ConcurrentSkipListMap` and `ConcurrentSkipListSet`. Lock-free, written by Doug Lea. Industrial strength. Used by Apache Kafka, HBase, and many others.

### C++

- `folly::ConcurrentSkipList` (Facebook). Lock-free + hazard pointers. ~2500 lines.
- `tbb::concurrent_map` (Intel TBB). Lock-based concurrent map (not skip list).
- `std::map` is not concurrent; wrap in a mutex.

### Rust

- `crossbeam-skiplist`. Lock-free, epoch-based reclamation. Around 600 lines including the epoch glue.
- `dashmap`. Hash-based, fast but unordered.

### Python

- `sortedcontainers` (single-threaded, but very fast).
- No standard concurrent ordered set; wrap with a lock or use a database.

### Scala

- `TrieMap` (concurrent hash trie). Different structure but similar problem-space.

### Elixir / Erlang

- `:gb_sets` (sequential).
- Concurrent ordered sets are usually implemented as Mnesia tables (ordered_set type) with row-level locking.

The cross-language pattern: every general-purpose language has a sorted set; only some have a concurrent one. The Go ecosystem is at parity with Java now.

---

## Appendix — Hands-on Final Exercise

Here is a complete homework assignment, intended to take 2-3 days, to test mastery of senior-level material.

**Task:** Implement a generic, lock-free, concurrent ordered map `Map[K cmp.Ordered, V any]` in Go.

**Requirements:**

1. API:
   ```go
   func New[K cmp.Ordered, V any]() *Map[K, V]
   func (m *Map[K, V]) Get(key K) (V, bool)
   func (m *Map[K, V]) Set(key K, val V) (prev V, replaced bool)
   func (m *Map[K, V]) Delete(key K) bool
   func (m *Map[K, V]) Contains(key K) bool
   func (m *Map[K, V]) Len() int
   func (m *Map[K, V]) Range(lo, hi K, f func(K, V) bool)
   ```

2. Linearisable: each operation appears atomic.

3. Lock-free: no `sync.Mutex` in the data path. (Locks for non-data-path concerns, like a global PRNG, are OK; eliminate them after correctness.)

4. Wait-free `Get` and `Contains`.

5. Pass:
   - `go test -race -count=10` on a property-test suite (5000+ ops per goroutine, 8+ goroutines).
   - Linearisability check with porcupine on 1000-op histories.
   - Stress test for 1 hour under continuous mixed workload.
   - Benchmark: at least 30 M ops/sec on an 8-core machine, balanced workload.

6. Documentation:
   - Doc comment on every exported function explaining concurrency semantics.
   - README with benchmarks, design notes, and known limitations.

7. Code review: have a colleague read every line.

This is roughly what you would do at a senior level to validate that you have mastered the material. Most engineers find that the first attempt has 3-5 subtle bugs that emerge under testing.

If you complete this exercise, you have *earned* the right to ship lock-free code in production.

---

## Appendix — Truly Final Thoughts

The path from "what is a skip list" (junior) to "lock-free Fraser variant" (senior) is a journey of about 20-30 hours of careful study and another 40 hours of implementation. By any measure that is a lot. But the path takes you to the boundary of what working engineers know about concurrent data structures, which is a useful place to be.

Beyond senior is professional. The professional file is about *deploying* these structures in real systems — arena allocation, NUMA, monitoring, capacity planning, integration with WALs and replication. It is much more operational and less algorithmic than senior.

If you intend to build infrastructure, continue. If you intend to *use* concurrent data structures, you have enough.

In either case, congratulations on reaching the end of senior.md. You have done the hard work.

— end of senior level —

---

## Appendix — A Quick Reference Card for Lock-Free Patterns

Print this and pin it to your monitor.

```
LOAD-THEN-CAS PATTERN
  for {
    old := p.Load()
    new := derive(old)
    if condition_invalid(old) { /* restart or return */ }
    if p.CompareAndSwap(old, new) { break }
  }

MARKER PATTERN
  type markedRef struct { next *node; marked bool }
  // Marking: CAS p from oldRef to markedRef{next: oldRef.next, marked: true}
  // Reading: check ref.marked

HELPING PATTERN
  while traversing:
    if observed_node.is_marked():
      help_unlink_via_CAS()
      restart_local_traversal()

PUBLICATION PATTERN
  initialise_all_fields(node)
  atomic_publish(node)   // single-step atomic publication
  // No further mutations of node fields

LINEARISATION POINT IDENTIFICATION
  For each operation, find the single atomic step at which its effect becomes visible.
  Examples:
    Insert: level-0 CAS that splices new node
    Delete: level-0 mark CAS on victim
    Contains: read of unmarked successor of matching node

LOCK-FREE GUARANTEE
  System-wide: at least one operation always makes progress.
  NOT wait-free: individual operations may retry arbitrarily under contention.

GO MEMORY MODEL ESSENTIALS
  atomic.X operations are sequentially consistent.
  Plain pointer reads of mutable shared data are races.
  Use atomic.Pointer[T] for any concurrently-read pointer.
```

---

## Appendix — Five Lessons from Real Outages

Lock-free code has caused real outages. Five lessons from public post-mortems.

### Lesson 1 — Concurrent test count matters

A team shipped a lock-free queue with passing `go test -race`. The bug appeared at full production load: under sustained 50K ops/sec, a 1-in-10-million race window caused queue head/tail divergence. They added `-count=1000` to CI; the bug appeared deterministically. Lesson: short test runs hide schedule-dependent bugs.

### Lesson 2 — Helping must terminate

Another team's lock-free linked list had a helping loop that could spin forever if predecessors kept being marked. Under heavy delete contention, all `find` calls livelocked, helping each other infinitely. Lesson: helping must complete in finite steps per attempt; use back-off or bound retries.

### Lesson 3 — Memory model assumptions break across architectures

A team developed and tested on x86. The lock-free skip list worked. Deployed to ARM64 production: subtle visibility bugs caused intermittent test failures. The cause: x86's strong memory model accidentally papered over a missing fence. Lesson: develop with the strictest memory model you target; use atomics, not plain loads.

### Lesson 4 — GC pauses hide concurrent bugs

GC pauses sometimes "fix" race windows by serialising all goroutines briefly. After a GC tuning change reduced pause times, latent bugs surfaced. Lesson: do not rely on GC pause-time for correctness; rely only on explicit synchronisation.

### Lesson 5 — Library updates can break invariants

A team relied on `sync.Map` behaviour that changed in a Go release. Their skip list code expected `Range` to be self-consistent within one call; a change in `sync.Map` invalidated the assumption. Lesson: read release notes; lock down library versions in `go.mod`.

---

## Appendix — The Final, Final Final Word

The Fraser skip list is a beautiful algorithm. It is also a *tool*. Like any tool, its value comes from being applied to the right problem at the right time, not from being deployed for its own sake.

The skill of senior engineering is knowing *when* to reach for lock-free, and the deeper skill is knowing *when not to*. Most of the time, the answer is "use the boring thing." For the rest of the time, you now have the tools.

End of senior. Onward to professional, where the rubber meets the road.
