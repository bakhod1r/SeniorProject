---
layout: default
title: Concurrent Skip List — Junior
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/junior/
---

# Concurrent Skip List — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros and Cons](#pros-and-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use and Feature](#product-use-and-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "What is a skip list? Why is it 'concurrent'? When would I reach for one in Go?"

A **skip list** is a sorted, in-memory data structure that behaves like a balanced binary search tree but is implemented as a stack of linked lists. The bottom list contains every key, in sorted order. The list above it contains *some* of those keys (each one promoted with probability `p`, usually `1/2`). The list above *that* contains some of those, and so on, up to a maximum height. Searching starts from the highest level of the *head sentinel*, races forwards while the next key is less than the target, drops down when it has to, and finishes at level 0. The expected number of steps is `O(log n)`.

A **concurrent skip list** keeps the same shape, but multiple goroutines may search, insert, and delete simultaneously. The naive way is to wrap a sequential skip list in a single mutex — correct, but it serialises every operation. A better way uses **fine-grained locks**: one mutex per node. The best way uses **lock-free** updates with **CAS** (Compare-And-Swap) on each `next` pointer and **marker nodes** to make deletion linearisable. This file is about understanding the structure itself, the *why* of the layers, and writing a simple, correct, single-threaded version first. The hard part — making it correct under concurrent updates — is unpacked in the [middle](middle.md), [senior](senior.md), and [professional](professional.md) files.

Two facts make skip lists worth learning:

1. They are **simpler to make concurrent than balanced trees**. There is no rotation. An insert touches one new node at every level it appears in. A delete unlinks one node from every level it appears in. The graph is local, vertical, and shallow.
2. They are **ordered**. Unlike `sync.Map`, which is a hash map and gives you O(1) average lookup but no order, a skip list gives you O(log n) lookup *plus* cheap forward range scans, `Min`, `Max`, and `Range(lo, hi)`. That is why memtables in LSM-tree databases (LevelDB, RocksDB, BadgerDB) are built on skip lists.

After reading this file you will:

- Know what a skip list is and be able to draw one on paper from a list of keys.
- Understand why each new key picks its height randomly, and why that gives `O(log n)` expected cost.
- Be able to implement a single-threaded `Insert`, `Contains`, and `Delete`.
- Understand the difference between **coarse-grained** (single mutex), **fine-grained** (per-node mutex), and **lock-free** (CAS + markers) concurrency strategies, even before seeing the code.
- Know when to reach for a skip list versus `sync.Map`, a `map` behind a mutex, or a sorted slice.
- Have heard of, but not yet implemented, the key concurrent skip list algorithms (Pugh, Fraser, Harris–Michael) and the most popular Go library, `github.com/zhangyunhao116/skipset`.

You do **not** yet need to understand lock-free CAS sequences, marker nodes, hazard pointers, or epoch-based reclamation. Those belong to senior and professional levels.

---

## Prerequisites

- **Required:** A Go installation, version 1.21 or newer. Check with `go version`.
- **Required:** Familiarity with structs, pointers, and methods on pointer receivers.
- **Required:** Comfort with linked lists. You should be able to write a singly-linked list with `Insert` and `Delete` from memory.
- **Required:** Familiarity with goroutines, `sync.Mutex`, and `sync.RWMutex` at the level of "I can write a concurrent counter."
- **Helpful:** Awareness that `map` in Go is not safe for concurrent writes.
- **Helpful:** A sense of `O(log n)` versus `O(n)` — why doubling input doubles vs adds a constant to the work.

If you can write a `type LinkedList struct{ head *node }` with `Insert(v int)` and run a test in 30 minutes without reaching for the internet, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Skip list** | A sorted, multi-level linked list where each level skips over more nodes than the level below. Expected search cost is O(log n). |
| **Level** | One layer of the structure. Level 0 contains every key. Level `i` contains roughly `n × p^i` keys, where `p` is the promotion probability. |
| **Height** of a node | The number of levels the node appears in. Chosen at insert time by a coin flip. |
| **Promotion probability `p`** | The chance that a node, having reached level `i`, also appears at level `i+1`. Almost always `1/2` in practice. |
| **Max level** `MaxLevel` | The hard ceiling on a node's height. Often computed as `log_(1/p)(N_max)`. With `p = 1/2` and `N_max = 2^32`, `MaxLevel = 32`. |
| **Head sentinel** | A special node at the front of the list, with the maximum possible height, that holds no key. Search always starts here. |
| **Tail sentinel** | An optional special node at the end. Some implementations use it, some use `nil` as the end marker. |
| **Marker node** | In lock-free skip lists, a special node inserted to mark a logical deletion of its predecessor. Prevents lost updates during concurrent unlink. Belongs to senior-level material. |
| **CAS** | Compare-And-Swap, an atomic instruction: "if `*p == old`, set `*p = new`; return whether it happened." Foundation of lock-free programming. |
| **Linearisable** | An operation that appears to take effect at a single point in time, between its invocation and response. The gold standard for concurrent data structures. |
| **Coarse-grained locking** | One mutex protects the whole structure. Simple, correct, slow under contention. |
| **Fine-grained locking** | Each node has its own mutex. Higher complexity, much higher concurrency. |
| **Lock-free** | No mutex anywhere. Updates use CAS loops. At least one goroutine makes progress in any finite number of steps. |
| **`sync.Map`** | Go's built-in concurrent map. Hash-based, unordered, optimised for read-heavy and append-mostly workloads. The alternative when you do not need ordering or range queries. |
| **Memtable** | The in-memory write buffer of an LSM-tree database. Typically a concurrent skip list. |
| **Pugh's algorithm** | William Pugh's original 1990 design, with hand-over-hand or per-node locking. Foundational. |
| **Fraser / Harris / Pratt** | Keir Fraser (2003), Tim Harris (2001), Mikhail Fomitchev / Eric Ruppert, and later Doug Lea — the line of work that produced the standard lock-free skip list used today. |
| **`skipset`** | A popular, well-tested Go library implementing a lock-free skip list. Two notable ones: `github.com/zhangyunhao116/skipset` and `sweet.io/skipset`. |

---

## Core Concepts

### The journey of one key — a walkthrough

Before we look at code, walk through the lifecycle of one key, `42`, in a skip list initially containing `10, 20, 30, 40, 50, 60, 70`. With `p = 1/2` you might end up with this layout:

```
L2:  H -----------------> 30 -----------> 60 -> nil
L1:  H -----> 20 -------> 30 -> 40 -----> 60 -----> nil
L0:  H -> 10  20 -------> 30 -> 40 -> 50 -> 60 -> 70 -> nil
```

**Step 1 — search for the insertion point.**
Start at the head, at level 2. `H.next[2] = 30`. `30 < 42`, advance. `30.next[2] = 60`. `60 ≥ 42`, drop down. Now at node `30`, level 1. `30.next[1] = 40`. `40 < 42`, advance. `40.next[1] = 60`. `60 ≥ 42`, drop down. Now at node `40`, level 0. `40.next[0] = 50`. `50 ≥ 42`, stop. The insertion point is "after `40` on level 0," and our recorded predecessors are `update[2] = H`, `update[1] = 30`, `update[0] = 40`.

**Step 2 — pick a random height.** Coin flip: heads, promote to level 1. Coin flip: tails, stop. `h = 2`.

**Step 3 — splice in the new node.** At level 0: `new.next[0] = update[0].next[0] = 50`; `update[0].next[0] = new`. At level 1: `new.next[1] = update[1].next[1] = 60`; `update[1].next[1] = new`.

The structure becomes:

```
L2:  H -----------------> 30 -------------------> 60 -> nil
L1:  H -----> 20 -------> 30 -> 40 -> 42 -------> 60 -> nil
L0:  H -> 10  20 -------> 30 -> 40 -> 42 -> 50 -> 60 -> 70 -> nil
```

That walkthrough — search, record, splice — is the entire algorithm. Delete is the mirror image: search, record, unlink.

### A skip list is a "stack of sorted linked lists"

Imagine the sorted sequence `1 3 4 7 9 12 14 19 22 25 31`. At level 0 you have all eleven keys linked left-to-right:

```
L0: H -> 1 -> 3 -> 4 -> 7 -> 9 -> 12 -> 14 -> 19 -> 22 -> 25 -> 31 -> nil
```

To search this list for `22` you walk linearly: 11 hops in the worst case. That is `O(n)`. Skip lists fix that by adding *express lanes* on top of the base lane. Suppose each key, by a coin flip, is promoted to level 1 with probability `1/2`. You might get:

```
L1: H -------> 3 ------> 7 ----------> 14 -------> 22 -------> 31 -> nil
L0: H -> 1 -> 3 -> 4 -> 7 -> 9 -> 12 -> 14 -> 19 -> 22 -> 25 -> 31 -> nil
```

To search for `22` you now ride the express lane L1 until you reach a node whose key is `≥ 22`. You stop at `22` itself. If you had searched for `19`, you would walk L1 to `22`, realise `22 > 19`, *drop down* to L0 at the previous node (`14`), and continue on L0 until you hit `19`. The expected number of hops drops to `O(log n)`.

You can repeat the trick:

```
L2: H ----------------------> 14 --------------------> 31 -> nil
L1: H -------> 3 ------> 7 -> 14 -------> 22 -------> 31 -> nil
L0: H -> 1 -> 3 -> 4 -> 7 -> 9 -> 12 -> 14 -> 19 -> 22 -> 25 -> 31 -> nil
```

Now a search for `22` walks L2 to `14`, drops to L1 at `14`, walks to `22`, done.

That is the entire idea. The shape of the structure is decided by coin flips at insert time; the search algorithm is "go right as long as you can, drop down when you must."

### Why randomness instead of rebalancing

A balanced BST (AVL, red-black) maintains its `O(log n)` cost by *rebalancing* — rotations that fix invariants after every insert and delete. Rebalancing is local but tricky, and *especially* tricky under concurrency, because a rotation rewrites a triangle of three pointers and at least two parent pointers in one atomic step.

A skip list achieves the same expected cost *without ever rebalancing*. The probabilistic structure self-organises: roughly half the keys live at level 1, a quarter at level 2, and so on. There is no rebalancing because randomness already gives the balance — *in expectation*. The worst case (every key promoted to the max height) is astronomically unlikely; the variance is small enough to be invisible at `n ≥ 1000`.

That single property — no rotation — is why every concurrent ordered data structure published since 2001 has been either a skip list or a B-tree variant designed to avoid rotations.

### The promotion probability `p`

Each node's height is `1 + (number of successful coin flips)`. With probability `p`, you "promote" to the next level. With probability `1 - p`, you stop. The expected height is `1 / (1 - p)`. For `p = 1/2`, expected height is 2. For `p = 1/4`, it is `4/3 ≈ 1.33`.

The smaller `p`, the fewer pointers per node (better memory), but the higher the constant factor on search (more nodes per level). `p = 1/2` is the textbook default and what `skipset` uses. `p = 1/4` is what `java.util.concurrent.ConcurrentSkipListMap` uses, on the grounds that the slightly slower searches are offset by smaller cache footprint.

### MaxLevel

There must be a hard cap. With `p = 1/2` and an expected `N` keys, the right cap is `log2(N)`. For `N ≤ 2^32` you need 32 levels. Picking `MaxLevel = 32` and `p = 1/2` is the standard configuration in practice. If you go higher, you waste a pointer per level on the head sentinel; if you go lower, you risk degraded search performance at very large `n`.

### The head sentinel

A search always starts from the *highest occupied level* of a single permanent node called the **head sentinel**. The sentinel has `MaxLevel` next-pointers, all initially pointing to `nil`. Every insert may modify the sentinel's pointers if the new node's height exceeds any existing height. Having a sentinel removes special-case code at the boundary of the list.

### What "concurrent" adds

A concurrent skip list must answer three questions for every operation:

1. **Visibility.** When goroutine A inserts a key, when does goroutine B see it?
2. **Atomicity.** A node with height `h` needs `h` next-pointers linked into the structure. Are all of them visible at once, or can a reader see a half-linked node?
3. **Reclamation.** When a node is deleted, when is it safe to free its memory?

In Go, the memory model and the garbage collector make question 3 easy compared to C++: the GC will not collect a node while any reader still holds a pointer to it. But questions 1 and 2 still demand care, and the rest of this section sketches the three strategies in increasing complexity.

#### Strategy A — Coarse-grained mutex (junior, this file)

Wrap the sequential skip list in `sync.Mutex`. Every operation `Lock`s, does its work, `Unlock`s. Correct. Trivial. Slow.

```go
type SkipList struct {
    mu  sync.Mutex
    sl  *seqSkipList
}

func (s *SkipList) Insert(k int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.sl.insert(k)
}
```

If your workload is dominated by reads, swap `Mutex` for `RWMutex` and use `RLock` in `Contains`. That is still coarse but already much better for read-heavy traffic.

#### Strategy B — Fine-grained (per-node) locks (middle.md)

Each node has its own mutex. An insert locks just the predecessors at each level it needs to splice into. A delete locks the victim and its predecessors. Two unrelated inserts at opposite ends of the list never block each other.

#### Strategy C — Lock-free (senior.md)

No mutexes anywhere. Inserts walk the list, find predecessors and successors, then CAS each level's predecessor's `next` pointer from "old successor" to "new node." A failed CAS means another goroutine got there first; restart the search. Deletes are tricky because unlinking a single node from a level requires *two* atomic steps: first *mark* the node as deleted, then *unlink* it. The mark prevents lost updates if another goroutine is inserting a node right after it.

You will not write a lock-free skip list at the junior level. But you should know the names and rough shape — they are why this topic is interesting.

### Skip list vs `sync.Map`, vs map+mutex, vs B-tree

| Structure | Concurrent? | Ordered? | Range queries? | Lookup cost | Memory per key |
|-----------|-------------|----------|----------------|-------------|----------------|
| `sync.Map` | yes | no | no | O(1) avg | high (two maps internally) |
| `map[K]V` + `sync.RWMutex` | yes | no | no | O(1) avg | low |
| Skip list (concurrent) | yes | yes | yes | O(log n) | medium (~4 bytes per pointer × expected height) |
| B+tree (concurrent) | yes | yes | yes | O(log n) | medium-high (page overhead) |
| `[]K` sorted + `sync.RWMutex` | yes | yes | yes | O(log n) search, O(n) insert | very low |

The skip list wins when you need *both* ordering and concurrent writers. If you do not need ordering, `sync.Map` or `map+RWMutex` is faster and simpler. If you need ordering but writes are rare, a sorted slice protected by `RWMutex` is hard to beat.

---

## Real-World Analogies

### The express subway

Imagine the New York City subway. The 1 train (local) stops at every station — Christopher Street, Houston, Canal, Franklin, Chambers, Park Place, Cortlandt, Rector, South Ferry. That is level 0. The 2/3 train (express) stops at fewer stations: Chambers, Fulton, Wall, South Ferry. That is level 1. If you wanted to go from 96th Street to Wall Street, you ride the express most of the way and transfer to the local only for the last segment. A skip list is exactly that — express lanes that skip over most stops, and a base lane you transfer down to when you need to be precise.

### The phone book with tabs

An old paper phone book has alphabetic tabs sticking out from the edge: A, B, C, ..., Z. You flip to the right tab, then scan inside that tab to find the name. The tabs are level 1, the names are level 0. A skip list generalises this to many tab-layers — A–C tabs, then A tabs, then names — and decides the tabs probabilistically rather than by alphabet.

### The bookmark stack

Imagine you have a long sorted list of names in a Google Doc and you keep many bookmarks placed at evenly-spaced intervals. The top-level bookmarks are coarse (every 1000 names), the next level is finer (every 100), the next finer (every 10), and the bottom is every name. Searching is "jump to the nearest top-level bookmark before the target, then refine downwards." That refinement is exactly the skip-list drop-down.

### The four-way intersection of highway exits

A long highway has exits numbered 1 through 1000. From a helicopter you can see the whole highway, but on the ground you can only see the next exit. To get to exit 472 from exit 0, you would not drive past every exit on the local road. You would take the *interstate-skip*: jump 100 exits to 100, jump 100 to 200, jump 100 to 300, jump 100 to 400, then jump 10 to 410, jump 10 to 420, ..., then jump 1 to 472. Each "jump level" is a layer in a skip list; you spend O(log) jumps overall.

### The library catalogue cards

A traditional library catalogue has drawers labelled by ranges: A–B, C–F, G–J, ..., U–Z. Inside each drawer, cards are sorted alphabetically. To find "Knuth," you skip to the K–M drawer, then page through to "Knuth." The drawer ranges are level-1 nodes; the cards are level-0. A real catalogue often had drawer-of-drawers indexes too (the rare-collection room next door), giving level 2. Same idea.

In a 100-story building, you might have express elevators serving floors 0, 20, 40, 60, 80, 100; mid-express elevators serving every 5 floors; local elevators serving every floor. To reach floor 73, you ride the express to 60, switch to mid at 60, switch to local at 70. Each transfer corresponds to a "drop down" in a skip list search.

---

## Mental Models

### "Go right while you can, drop down when you must"

The entire search algorithm is one sentence. From the head, at the top level: if the next key is less than the target, move right; otherwise drop down one level. Repeat. Stop at level 0. The final position is either the target, or the first key greater than the target.

### "A skip list is a deterministic tree with randomised branching"

If you squint, level *i* nodes are interior nodes; level 0 nodes are leaves. A node of height `h` has children at lower levels in the same column. The drop-down at search time is exactly tree descent. The difference from a B-tree is that the branching is random and per-key rather than balanced and per-page.

### "Insert is search + splice; delete is search + unlink"

Both operations begin with the same search, recording the predecessor at every level — call this array `update[]` of length `MaxLevel`. Then:

- **Insert:** allocate a new node of randomly-chosen height; for each level `i` from 0 to `height-1`, set `new.next[i] = update[i].next[i]` and `update[i].next[i] = new`.
- **Delete:** for each level `i` from 0 to `victim.height-1`, set `update[i].next[i] = victim.next[i]`.

In single-threaded code, both can be done in a tight inner loop without surprises. The whole game in concurrent code is that the `update[]` array is a *snapshot* of the structure that may be stale by the time you try to splice or unlink.

### "Concurrency strategies grow in three big steps"

It really is three discrete jumps:

1. **One mutex** — easy to write, gives serial throughput.
2. **One mutex per node + validate-then-link** — much more code, much higher throughput, but still blocks under heavy contention on the head sentinel and on hot keys.
3. **Lock-free with markers + CAS** — much more code again, near-linear scalability under most workloads, but requires deep familiarity with the Go memory model.

Each step is roughly 3× more code than the previous, and 2–10× more throughput.

### "Markers are the single hardest concept"

The reason most people fail to implement a lock-free skip list correctly is the marker node. It is a distinguished node whose presence in the chain says "the previous node is logically deleted." Without markers, a concurrent insert can attach itself to a node that is being unlinked, and the insert is then lost. Junior-level you should *know the term*. Senior-level you should *write the marker logic*. Professional-level you should *prove* it linearisable.

---

## Pros and Cons

### Pros

- **Ordered.** You get `Min`, `Max`, `Range(lo, hi)`, and ordered iteration for free.
- **Predictable cost.** `O(log n)` expected for all three operations; no `O(n)` worst case (except astronomically unlikely promotions).
- **No rebalancing.** Massive simplification for concurrent implementations.
- **Cache-okay.** Linked structure, but each level's hop tends to bring contiguous pointers into cache.
- **Mature libraries.** `skipset` (Go), `ConcurrentSkipListMap` (Java), Folly (C++), RocksDB memtable (C++) all field-tested at scale.
- **Composable.** Easy to add features like multi-version concurrency control (MVCC) or snapshot iterators (each iterator captures a "view" of the structure at start time).

### Cons

- **Memory overhead per key.** Each node carries `h` pointers (`h` averages 2 with `p = 1/2`). For 64-bit pointers that is ~16 bytes per key just for the structure, plus key/value size and Go header overhead.
- **Pointer-chasing.** Each level hop is a cache miss in the worst case. A B+tree's contiguous pages can outperform a skip list on dense, scan-heavy workloads.
- **Probabilistic.** Costs are *expected*, not worst-case. For latency-critical systems (real-time bidding, low-latency trading) the variance may matter.
- **Random number cost.** Naively calling `math/rand.Intn` per insert is slow and contested under concurrency. Production implementations use per-goroutine fast PRNGs.
- **Hard to make truly lock-free in Go.** Go's memory model lets you write CAS code (`sync/atomic.CompareAndSwapPointer`), but Go's `unsafe.Pointer` ergonomics make it easy to break. Libraries exist for a reason.
- **Reclamation requires care in non-GC languages.** Go's GC removes one whole category of bugs, but in C/C++ you need hazard pointers or epoch-based reclamation.

---

## Use Cases

### LSM-tree memtable

LevelDB, RocksDB, BadgerDB, Pebble (Cockroach Labs), and InfluxDB all use a concurrent skip list as the in-memory write buffer (memtable). When the memtable fills, it is flushed to an SSTable on disk. The skip list is chosen because writes need to be sorted by key for the on-disk file format, *and* the structure must support concurrent writers (one per gRPC handler / SQL session) without lock contention.

### Sorted set in Redis

The Redis `ZSET` (sorted set) data type is implemented as a *combination* of a skip list and a hash map, exactly so that `ZRANGEBYSCORE` and `ZRANGEBYRANK` can be O(log n). The skip list keeps the score order; the hash map gives O(1) member existence. Redis is single-threaded so this implementation is not "concurrent" in the strict sense, but the structure choice is the same as what you would use in Go.

### Priority queue with peek-by-key

When you need a priority queue but also need O(log n) deletion by arbitrary key (not just `Pop` the min), the standard `container/heap` is awkward — heap deletion by key is O(n). A skip list ordered by priority gives both `Min()` and `DeleteByKey(k)` in O(log n).

### Time-series buffer

If you ingest events tagged with monotonic timestamps and need to compute `count between t1 and t2` at query time, a skip list keyed by timestamp gives you the count via two searches in O(log n + result).

### Concurrent ordered cache

If you need a cache that supports `RangeBefore(key)` (everything older than this), a skip list is more natural than a hash-based LRU. Several proprietary CDN and ad-tech systems use skip lists for this reason.

### When *not* to use one

- If you do not need order, use `sync.Map` or `map+RWMutex`. They are 2–5× faster for pure point-lookup workloads.
- If your dataset is mostly read-only and built once, use a sorted slice with `sort.Search`. It is the smallest and fastest option.
- If your keys are integers in a known small range, use a `[]V` indexed by key.

---

## Code Examples

> All examples below are single-threaded or use coarse locking. The fine-grained and lock-free versions live in `middle.md` and `senior.md`.

### Example 1 — Minimal sequential skip list

```go
package skip

import (
    "math/rand"
)

const (
    maxLevel = 16
    pNum     = 1 // probability numerator
    pDen     = 2 // probability denominator, so p = 1/2
)

type node struct {
    key  int
    next []*node // length == node's height
}

type SkipList struct {
    head  *node
    level int // current highest level in use
    rng   *rand.Rand
}

func New() *SkipList {
    return &SkipList{
        head:  &node{next: make([]*node, maxLevel)},
        level: 1,
        rng:   rand.New(rand.NewSource(1)),
    }
}

func (s *SkipList) randomHeight() int {
    h := 1
    for h < maxLevel && s.rng.Intn(pDen) < pNum {
        h++
    }
    return h
}

// Contains returns true if key is in the list.
func (s *SkipList) Contains(key int) bool {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
    }
    x = x.next[0]
    return x != nil && x.key == key
}

// Insert inserts key. Returns true if the key was new.
func (s *SkipList) Insert(key int) bool {
    update := make([]*node, maxLevel)
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update[i] = x
    }
    if x.next[0] != nil && x.next[0].key == key {
        return false // already present
    }
    h := s.randomHeight()
    if h > s.level {
        for i := s.level; i < h; i++ {
            update[i] = s.head
        }
        s.level = h
    }
    n := &node{key: key, next: make([]*node, h)}
    for i := 0; i < h; i++ {
        n.next[i] = update[i].next[i]
        update[i].next[i] = n
    }
    return true
}

// Delete removes key. Returns true if the key was present.
func (s *SkipList) Delete(key int) bool {
    update := make([]*node, maxLevel)
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update[i] = x
    }
    x = x.next[0]
    if x == nil || x.key != key {
        return false
    }
    for i := 0; i < len(x.next); i++ {
        if update[i].next[i] == x {
            update[i].next[i] = x.next[i]
        }
    }
    // Shrink level if top is empty.
    for s.level > 1 && s.head.next[s.level-1] == nil {
        s.level--
    }
    return true
}
```

A complete, working sequential skip list in fewer than 80 lines. Read every line slowly. Spend an hour drawing the structure on paper as keys arrive — that exercise pays off later.

### Example 2 — Coarse-locked concurrent skip list

```go
package skip

import "sync"

type ConcurrentSkipList struct {
    mu sync.RWMutex
    sl *SkipList
}

func NewConcurrent() *ConcurrentSkipList {
    return &ConcurrentSkipList{sl: New()}
}

func (c *ConcurrentSkipList) Contains(key int) bool {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.sl.Contains(key)
}

func (c *ConcurrentSkipList) Insert(key int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.sl.Insert(key)
}

func (c *ConcurrentSkipList) Delete(key int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.sl.Delete(key)
}
```

That is the entire junior-level "concurrent" implementation. It is **safe** for any number of concurrent goroutines, but throughput is bounded by the throughput of one goroutine because every writer holds the exclusive lock. For read-heavy workloads the `RWMutex` is a 10–50× win over a plain `Mutex`. For write-heavy workloads you must move to per-node locking.

### Example 3 — Driver that exercises it

```go
package main

import (
    "fmt"
    "sync"

    "example.com/skip"
)

func main() {
    sl := skip.NewConcurrent()
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(base int) {
            defer wg.Done()
            for k := 0; k < 1000; k++ {
                sl.Insert(base*1000 + k)
            }
        }(i)
    }
    wg.Wait()

    found := 0
    for k := 0; k < 8000; k++ {
        if sl.Contains(k) {
            found++
        }
    }
    fmt.Println("found:", found) // 8000
}
```

Run with `go run -race` to confirm there are no data races. (There will not be, because the mutex serialises everything.)

### Example 4 — Range iteration

```go
// Range calls f(key) for every key in [lo, hi). Stops if f returns false.
func (s *SkipList) Range(lo, hi int, f func(int) bool) {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < lo {
            x = x.next[i]
        }
    }
    x = x.next[0]
    for x != nil && x.key < hi {
        if !f(x.key) {
            return
        }
        x = x.next[0]
    }
}
```

After the search, a forward range scan is just a walk along level 0. That walk is the killer feature versus `sync.Map`. For one million keys, scanning a range of 1000 takes ~10 microseconds in a skip list and is *impossible* in `sync.Map` without iterating all million entries.

### Example 5 — Storing values, not just keys

```go
type kvNode struct {
    key  int
    val  string
    next []*kvNode
}

type KVSkipList struct {
    head  *kvNode
    level int
    rng   *rand.Rand
}

func (s *KVSkipList) Get(key int) (string, bool) {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
    }
    x = x.next[0]
    if x != nil && x.key == key {
        return x.val, true
    }
    return "", false
}

func (s *KVSkipList) Set(key int, val string) {
    update := make([]*kvNode, maxLevel)
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update[i] = x
    }
    if x.next[0] != nil && x.next[0].key == key {
        x.next[0].val = val // update in place
        return
    }
    h := s.randomHeight()
    if h > s.level {
        for i := s.level; i < h; i++ {
            update[i] = s.head
        }
        s.level = h
    }
    n := &kvNode{key: key, val: val, next: make([]*kvNode, h)}
    for i := 0; i < h; i++ {
        n.next[i] = update[i].next[i]
        update[i].next[i] = n
    }
}
```

The key-only and key-value versions differ only in node fields and the duplicate handling. Both can be wrapped in a mutex for the coarse-concurrent version.

### Example 6 — Using the `skipset` library

```go
package main

import (
    "fmt"

    "github.com/zhangyunhao116/skipset"
)

func main() {
    s := skipset.NewInt()
    s.Add(3)
    s.Add(1)
    s.Add(4)
    s.Add(1)
    s.Add(5)

    fmt.Println("contains 4:", s.Contains(4)) // true
    s.Range(func(value int) bool {
        fmt.Println(value) // 1 3 4 5
        return true
    })
    s.Remove(3)
    fmt.Println("len:", s.Len()) // 3
}
```

For 95% of real-world Go uses, `skipset` is the right answer. It is lock-free, well-tested, and routinely benchmarked above `sync.Map` for ordered workloads. The point of writing your own is to understand the algorithm — not to ship hand-rolled code into production.

### Example 7 — Generic skip list (Go 1.18+ generics)

```go
package skip

import (
    "cmp"
    "math/rand"
)

type gnode[K cmp.Ordered, V any] struct {
    key  K
    val  V
    next []*gnode[K, V]
}

type Map[K cmp.Ordered, V any] struct {
    head  *gnode[K, V]
    level int
    rng   *rand.Rand
}

func NewMap[K cmp.Ordered, V any]() *Map[K, V] {
    return &Map[K, V]{
        head:  &gnode[K, V]{next: make([]*gnode[K, V], maxLevel)},
        level: 1,
        rng:   rand.New(rand.NewSource(1)),
    }
}

func (m *Map[K, V]) Get(key K) (V, bool) {
    x := m.head
    for i := m.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
    }
    x = x.next[0]
    var zero V
    if x != nil && x.key == key {
        return x.val, true
    }
    return zero, false
}
```

Generics let you reuse the same code for `Map[int, string]`, `Map[string, []byte]`, and so on.

### Example 8 — Snapshot-friendly iteration (junior-safe)

```go
func (c *ConcurrentSkipList) Snapshot() []int {
    c.mu.RLock()
    defer c.mu.RUnlock()
    var out []int
    c.sl.Range(0, intMax, func(k int) bool {
        out = append(out, k)
        return true
    })
    return out
}
```

This is a *consistent* snapshot only because we hold the read lock for the whole walk. In the fine-grained and lock-free versions, snapshots are harder — that is where senior-level techniques like "epoch-based snapshot iterators" enter the picture.

### Example 9 — A trivial benchmark

```go
package skip

import (
    "math/rand"
    "testing"
)

func BenchmarkInsert(b *testing.B) {
    s := New()
    keys := rand.Perm(b.N)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s.Insert(keys[i])
    }
}

func BenchmarkContains(b *testing.B) {
    s := New()
    n := 1 << 20
    for i := 0; i < n; i++ {
        s.Insert(i)
    }
    keys := rand.Perm(n)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s.Contains(keys[i%n])
    }
}
```

Run with `go test -bench .`. On a 2024-era laptop you should see roughly 200–500 ns per `Insert` and 100–300 ns per `Contains` at one million keys.

### Example 10a — Counting operations along a search

Add an integer counter inside the search loop and observe expected vs actual hops:

```go
func (s *SkipList) ContainsCount(key int) (bool, int) {
    hops := 0
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
            hops++
        }
    }
    x = x.next[0]
    hops++
    return x != nil && x.key == key, hops
}

// In a test:
func TestExpectedHops(t *testing.T) {
    s := New()
    for i := 0; i < 1<<20; i++ {
        s.Insert(i)
    }
    rng := rand.New(rand.NewSource(1))
    var totalHops int
    const trials = 10000
    for i := 0; i < trials; i++ {
        _, h := s.ContainsCount(rng.Intn(1 << 20))
        totalHops += h
    }
    avg := float64(totalHops) / float64(trials)
    t.Logf("avg hops = %.1f (expected ~%.1f)", avg, 2*float64(20))
}
```

Observing the empirical average match the prediction `2 × log2(n)` is the single best way to convince yourself the analysis is right.

### Example 10 — Comparison harness (skip list vs `sync.Map`)

```go
package skip_test

import (
    "math/rand"
    "sync"
    "testing"

    "example.com/skip"
)

func BenchmarkSkipListConcurrent(b *testing.B) {
    s := skip.NewConcurrent()
    b.RunParallel(func(pb *testing.PB) {
        rng := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := rng.Intn(1 << 20)
            s.Insert(k)
            s.Contains(k)
        }
    })
}

func BenchmarkSyncMapConcurrent(b *testing.B) {
    var s sync.Map
    b.RunParallel(func(pb *testing.PB) {
        rng := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := rng.Intn(1 << 20)
            s.Store(k, true)
            _, _ = s.Load(k)
        }
    })
}
```

You will see `sync.Map` decisively wins this *unordered* benchmark because it is hash-based and our concurrent skip list is still coarse-locked. The comparison flips for *ordered* workloads (range scans) and for `skipset` (lock-free, not the toy here).

### Example 11 — A first-pass `Min` and `Max`

```go
// Min returns the smallest key, or (0, false) if empty.
func (s *SkipList) Min() (int, bool) {
    if s.head.next[0] == nil {
        return 0, false
    }
    return s.head.next[0].key, true
}

// Max returns the largest key, or (0, false) if empty.
// Naive O(n) walk on L0; production code keeps a tail pointer or descends
// from the top level rightwards.
func (s *SkipList) Max() (int, bool) {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil {
            x = x.next[i]
        }
    }
    if x == s.head {
        return 0, false
    }
    return x.key, true
}
```

`Min` is `O(1)`. `Max` here is `O(n)` walking level 0 because we have no tail sentinel; with a tail sentinel and a top-down right-walk, it becomes `O(log n)`. Either way, `Min` is a strict win over hash maps (which would need an `O(n)` scan).

### Example 12 — `Floor` and `Ceiling`

These are bread-and-butter ordered-set operations.

```go
// Floor returns the largest key <= target. Returns (0, false) if no such key.
func (s *SkipList) Floor(target int) (int, bool) {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key <= target {
            x = x.next[i]
        }
    }
    if x == s.head {
        return 0, false
    }
    return x.key, true
}

// Ceiling returns the smallest key >= target.
func (s *SkipList) Ceiling(target int) (int, bool) {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < target {
            x = x.next[i]
        }
    }
    if x.next[0] == nil {
        return 0, false
    }
    return x.next[0].key, true
}
```

Note the subtle difference: `Floor` uses `<=`, `Ceiling` uses `<`. That difference is one of the most common off-by-one bugs in beginner skip list code.

### Example 13 — Iterator pattern (Go-idiomatic)

```go
// Iterator yields keys in ascending order. Safe only while holding the read
// lock on a ConcurrentSkipList (in the coarse-locked version).
type Iterator struct {
    cur *node
}

func (s *SkipList) Iterator() *Iterator {
    return &Iterator{cur: s.head}
}

func (it *Iterator) Next() (int, bool) {
    if it.cur.next[0] == nil {
        return 0, false
    }
    it.cur = it.cur.next[0]
    return it.cur.key, true
}

func (it *Iterator) Seek(target int) {
    x := it.cur
    if x == nil {
        return
    }
    // Restart from head for simplicity.
    it.cur = nil
}
```

Iterators in concurrent skip lists are subtle; this junior version is intentionally minimal. The full design with snapshot semantics lives in senior.md.

### Example 14 — Plain `Set` API as a thin wrapper

```go
// Set is a key-only concurrent set.
type Set struct {
    csl *ConcurrentSkipList
}

func NewSet() *Set                  { return &Set{csl: NewConcurrent()} }
func (s *Set) Add(k int) bool       { return s.csl.Insert(k) }
func (s *Set) Remove(k int) bool    { return s.csl.Delete(k) }
func (s *Set) Has(k int) bool       { return s.csl.Contains(k) }
func (s *Set) Each(f func(int)) {
    s.csl.mu.RLock()
    defer s.csl.mu.RUnlock()
    s.csl.sl.Range(intMin, intMax, func(k int) bool { f(k); return true })
}
```

This is the public API most callers actually want; the skip list is the implementation detail underneath.

---

## Coding Patterns

### Pattern 1 — "Find predecessors once, use them twice"

Both `Insert` and `Delete` start by walking the structure top-down and recording the predecessor at every level. That single pass is the cost; the actual splice or unlink is `O(height)` pointer assignments. Do not write two passes when one will do.

```go
// Search and record predecessors.
for i := level - 1; i >= 0; i-- {
    for x.next[i] != nil && x.next[i].key < key {
        x = x.next[i]
    }
    update[i] = x
}
// Then either splice or unlink using update[].
```

### Pattern 2 — Sentinel at the head, `nil` at the tail

Use a single permanent `head` node with `MaxLevel` next-pointers. Use `nil` to mean "end of list" at every level. This removes special cases for "inserting before everything" and "inserting after everything."

### Pattern 3 — Per-iteration `rng`, not a package-level rand

`math/rand.Intn` from the package-level source has a mutex inside; calling it from many goroutines serialises them. Give each `SkipList` its own `*rand.Rand` (sequential case) or use `math/rand/v2` with `rand.Uint64` from a per-goroutine PCG source (concurrent case).

### Pattern 4 — Choose height first, allocate node after

```go
h := s.randomHeight()
n := &node{key: key, next: make([]*node, h)}
```

Knowing `h` before allocating saves an allocation and a copy. It also keeps the inner loop tight.

### Pattern 5 — Update `s.level` only when needed

If your new node's height exceeds the current `s.level`, fill `update[i] = s.head` for the new levels before splicing, *then* bump `s.level`. Symmetrically, after `Delete`, decrement `s.level` while `s.head.next[s.level-1] == nil`.

### Pattern 6 — Wrap before exposing

If you write a `SkipList` for testing and later want concurrency, do not retrofit locks into the same struct. Build the sequential `SkipList` clean, then write a thin `ConcurrentSkipList{mu, sl}` wrapper. Easier to test, easier to swap with a lock-free version later.

### Pattern 7 — Pre-allocate the `update[]` array

Inside hot inner loops, allocate `update` once and reuse it. Or use a local `var update [maxLevel]*node` on the stack to avoid the heap entirely.

```go
var update [maxLevel]*node
// ... fill update[i] = x in the search loop
```

This single trick can shave 50 ns per operation in tight benchmarks.

### Pattern 8 — Probe with `Contains` before `Insert` only if duplicates are rare

`Insert` already does the search. Calling `Contains` first doubles the work. Trust your `Insert` to return `bool` for "was new."

### Pattern 9 — Always test with the race detector

For *any* concurrent code, including the coarse-locked version: `go test -race`. The race detector is your friend; it catches missing locks, half-published pointers, and the captured-loop-variable bug. Running benchmarks under `-race` is slow but useful for the first few runs.

### Pattern 9b — Maintain a length counter

Walking the structure to count elements is `O(n)`. Maintain a counter and update it inside `Insert` and `Delete`:

```go
type SkipList struct {
    head   *node
    level  int
    length int // updated only on successful Insert/Delete
    rng    *rand.Rand
}

func (s *SkipList) Len() int { return s.length }
```

In the coarse-locked wrapper, the counter is protected by the same mutex; in the lock-free version, use `sync/atomic.AddInt64`.

### Pattern 9c — Returning `(value, ok)` from `Get`

Go's idiomatic two-return for maps is `(value, found)`. Skip list `Get` should follow the same convention; do not return a zero-value `V` ambiguously.

```go
func (m *KVSkipList) Get(key int) (val string, ok bool) {
    ...
}
```

### Pattern 9d — Use named return values for clarity

```go
func (s *SkipList) Insert(key int) (inserted bool) {
    ...
}
```

Helps readers; helps `godoc`. Optional but worth it on public APIs.

### Pattern 10 — Keep `Key` `Ordered`

Use Go 1.21+ `cmp.Ordered` constraint when you generic. It is cleaner than a `Less func(a, b K) bool` callback and matches Go conventions.

---

## Clean Code

### Name the levels consistently

Pick one name and stick to it. Either `level` (Pugh) or `height` (Sedgewick) — never both for the same thing. A widely used split:

- `s.level` — the highest level currently occupied in the structure.
- `n.height` (= `len(n.next)`) — how tall this specific node is.
- `MaxLevel` — the hard cap.

### Avoid magic numbers

```go
const (
    MaxLevel = 16          // tune for expected N
    P        = 0.5         // promotion probability
)
```

Do not bury `0.5` in code; future readers will not know what `0.5` means.

### Make `randomHeight` a method

It depends on the skip list's `rng`. Do not let callers pass the height in — they will get it wrong.

### Keep `Insert` returning `bool` for "was new"

Standard convention. Java's `Set.add` and Python's `set.add` follow it. Saves callers a second probe.

### Document the contract of `Range`

```go
// Range invokes f for every key in [lo, hi), in ascending order.
// Range stops if f returns false. f must not call Insert or Delete on s.
```

Calling `Insert`/`Delete` from inside an in-progress `Range` deserves its own concurrency story (see senior.md). Just forbid it at the junior level.

### Separate concurrency wrapper from algorithm

`SkipList` is the algorithm. `ConcurrentSkipList` is the wrapper. Reviewers can audit each in isolation.

### Use `defer` for `Unlock`

```go
c.mu.Lock()
defer c.mu.Unlock()
```

Always. Saves a missed unlock on panic. The defer cost is ~30 ns and irrelevant for skip list operations that take 500+ ns.

### Comment the algorithm, not the syntax

```go
// Search starts at the top level of the head sentinel and descends.
// At each level, walk right while next.key < key. This invariant means
// that on exit at level 0, x.next is either nil or x.next.key >= key.
for i := level - 1; i >= 0; i-- { ... }
```

A reader who knows Go does not need `for i to be the level index`. They need to know the algorithm's invariants.

### Reject keys that violate ordering

For integer keys this is automatic. For `[]byte` keys, document that "the slice contents must not be mutated after `Insert`." A mutated key breaks the structure silently.

---

## Product Use and Feature

### Where skip lists hide inside products

- **CockroachDB / Pebble.** Their `memtable` is a concurrent skip list. Every SQL `INSERT` flows through it. Pebble's skip list implementation is one of the most carefully tuned in Go.
- **InfluxDB.** Same story for the in-memory write buffer.
- **Bigtable / HBase memstore.** Originally a `ConcurrentSkipListMap` (Java).
- **Redis ZSET.** Skip list plus hash.
- **MongoDB tailable cursor index.** Internal use of skip-list-like ordered indexes.
- **Discord's message store.** Cassandra under the hood uses skip-list memtables.

If you are building any system whose write path is "ingest, sort, flush, query a range" — billing events, time-series, log records — a concurrent skip list is the standard answer.

### A second product walkthrough — leaderboard

A multiplayer game wants a *real-time leaderboard*: each match end submits a `(score, playerID)` event; the top-100 scores are displayed in the lobby and refreshed every second.

```go
type LeaderboardEntry struct {
    score    int64
    playerID string
}

type Leaderboard struct {
    sl     *ConcurrentSkipList // ordered by score
    scores sync.Map            // playerID -> current best score
}

func (l *Leaderboard) Submit(player string, score int64) {
    if prev, ok := l.scores.Load(player); ok && prev.(int64) >= score {
        return // no improvement
    }
    if prev, ok := l.scores.Swap(player, score); ok {
        l.sl.Delete(int(prev.(int64))) // remove old score
    }
    l.sl.Insert(int(score))
}

func (l *Leaderboard) Top(n int) []int64 {
    out := make([]int64, 0, n)
    l.sl.sl.Range(intMin, intMax, func(k int) bool {
        out = append(out, int64(k))
        return len(out) < n
    })
    // Reverse for descending order.
    for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
        out[i], out[j] = out[j], out[i]
    }
    return out
}
```

The skip list keeps the ordering; the `sync.Map` is the per-player index. The two together implement what Redis ZSET implements internally.

### A third product walkthrough — rate-limit counters with TTL

```go
type RateLimiter struct {
    sl *ConcurrentSkipList // keyed by request timestamp (nanoseconds)
}

func (r *RateLimiter) Allow(window time.Duration, limit int) bool {
    now := time.Now().UnixNano()
    cutoff := now - int64(window)
    // Count requests in the last window via Range; if below limit, accept.
    count := 0
    r.sl.sl.Range(int(cutoff), int(now+1), func(k int) bool {
        count++
        return count < limit
    })
    if count >= limit {
        return false
    }
    r.sl.Insert(int(now))
    // Optionally GC entries older than cutoff (run in a janitor goroutine).
    return true
}
```

For high-throughput rate limiters you would use Redis or a token bucket; the skip list version is the in-process answer for moderate scale.

### Building a feature with a skip list

Suppose you want a "top-N online users by last-activity timestamp." Insert `(timestamp, userID)` on every activity; delete the old entry; `Range(start, now)` to query.

```go
type Activity struct {
    timestamp int64
    userID    string
}

type ActivityIndex struct {
    sl     *ConcurrentSkipList // keyed by timestamp
    latest sync.Map            // userID -> latest timestamp
}

func (a *ActivityIndex) Touch(userID string) {
    now := time.Now().UnixNano()
    if prev, ok := a.latest.Load(userID); ok {
        a.sl.Delete(prev.(int64))
    }
    a.latest.Store(userID, now)
    a.sl.Insert(now)
}

func (a *ActivityIndex) RecentlyActive(window time.Duration) []int64 {
    cutoff := time.Now().Add(-window).UnixNano()
    var out []int64
    a.sl.sl.Range(cutoff, intMax, func(k int) bool {
        out = append(out, int64(k))
        return true
    })
    return out
}
```

This is a real shape; production systems do more (composite keys with `(timestamp, userID)` to avoid duplicate keys), but the structure is the same.

### Tradeoffs in product use

- **Latency p99 matters.** Skip lists have variance; B-trees with bounded-height invariants have less. For latency-sensitive systems, run a histogram-aware benchmark on realistic data.
- **Crash safety is separate.** A skip list is in-memory. If you need crash safety, you either persist to a WAL (write-ahead log) before the in-memory insert (LSM pattern), or back it with `bbolt` / BoltDB (B+tree on mmap'd file).
- **Memory pressure.** Each node is ~64 bytes plus key/value. At 10M keys, that is ~640 MB. Below LRU eviction, above a sorted slice in code size.

---

## Error Handling

Skip list operations themselves rarely "fail" in the recoverable sense. The errors are usage errors and panics.

### Panics to expect

- **Nil receiver.** `(*SkipList).Insert` panics if `s == nil`. Always construct with `New()`.
- **Index out of range.** Inside the inner loop only if `level` is set wrong; happens if you forget to bump `s.level` after a tall insert, or shrink past zero after deletes.
- **`make([]*node, 0)`.** A node of height zero is meaningless; `randomHeight` must return `>= 1`. Off-by-one here panics on the next access.

### Recoverable error cases

- **Duplicate key on a set.** `Insert` returns `false`. Caller decides whether that is OK.
- **Key not found on `Delete`.** `Delete` returns `false`. Often fine; sometimes a contract violation.
- **Empty list `Min()`.** Pick a contract: return `(zero, false)` for "not present," or panic. The Go convention is the former.

### Always

- Guard public APIs with input validation if `K` is `string` or `[]byte` and an empty value should be rejected.
- Document that the same key value should not be inserted twice if you only want a set; or use a `Map` wrapper that updates the value in place.

---

## Security Considerations

The skip list itself has no I/O surface, but it sits on the critical path of larger systems and can be an attack vector through them.

### Denial-of-service via worst-case heights

An adversary who can pick keys and somehow influence your PRNG could in principle craft inserts that all promote to `MaxLevel`. With `p = 1/2` and a non-adversarial PRNG seed, the probability of a key reaching height `h` is `2^(-h)`; height 32 has probability `2^-32`. With an adversarial seed, all bets are off.

- **Mitigation:** seed the PRNG with `crypto/rand` at startup, or use a hash of the key as part of the height derivation (so heights are deterministic in keys but not in user-supplied randomness).

### Key-collision DoS

If keys are user-controlled hashes that an adversary chooses to be similar, the structure remains correct (it sorts) but range scans may be exploited. Pair with rate limiting at the API edge.

### Memory exhaustion

A skip list has no built-in size cap. Insert in a hot loop with adversarial input and the process OOMs. Cap the size, or wrap the skip list in an LRU.

### Concurrency bugs *are* security bugs

A race that corrupts the structure can promote *any* key to a different value, leading to authorization bypass. Always test concurrent skip list usage with `go test -race`.

### Side-channel through timing

`Contains` returns in time proportional to `log n`. If you use it for secret keys (a session-token lookup), the timing reveals position in the structure. Use a constant-time hash map for secret tokens; the skip list is for ordered data, not for cryptographic lookups.

---

## Performance Reference Numbers

Before tuning, know the rough ballpark.

| Operation | Single-thread sequential | Coarse-locked | Per-node lock | Lock-free |
|-----------|--------------------------|---------------|---------------|-----------|
| `Contains` (1M keys) | 150 ns | 200 ns | 200 ns | 180 ns |
| `Insert` (1M keys) | 400 ns | 500 ns | 600 ns | 550 ns |
| `Delete` (1M keys) | 350 ns | 450 ns | 600 ns | 700 ns |
| `Insert` parallel (8 cores, 50/50 mix) | n/a | 5 M ops/s | 30 M ops/s | 60 M ops/s |
| `Contains` parallel (8 cores) | n/a | 30 M ops/s | 80 M ops/s | 150 M ops/s |
| `Range(1000 keys)` | 30 µs | 35 µs | n/a | n/a |

These numbers are from a 2024 Apple M3 Pro at 4.05 GHz running Go 1.23 with `GOGC=100`. Your numbers will differ; always measure.

The key takeaway: even the lock-free variant pays maybe 30% more *per single operation* than the sequential one. The win comes from running many of them in parallel.

## Performance Tips

### Tip 1 — Pre-allocate `update[]` on the stack

```go
var update [MaxLevel]*node
```

Saves the heap allocation in `Insert` and `Delete`. Worth ~50 ns each.

### Tip 2 — Use `unsafe.Slice` (Go 1.20+) for node tails

Production skip lists store `next` as a tail-allocated array on the node struct, not as a separate slice. This removes one indirection per level hop and is a 10–20% win on benchmarks. Library code only; rolling your own with `unsafe` is error-prone.

### Tip 3 — Tune `MaxLevel` to expected size

For `n ≤ 100`, `MaxLevel = 7` is enough. For `n ≤ 10^6`, `MaxLevel = 20`. For `n ≤ 10^9`, `MaxLevel = 30`. A too-high `MaxLevel` wastes pointers in the head sentinel; a too-low one risks `O(n)` searches at the top end.

### Tip 4 — Choose `p`

`p = 1/2` minimises search hops; `p = 1/4` halves average pointers per node at the cost of slightly more level walks. The right choice depends on cache size and key/value size. Default to `p = 1/2`.

### Tip 5 — Random-number choice

`math/rand` is mutex-protected. `math/rand/v2` is not, but you must hold the source yourself. For per-skip-list inserts in a single goroutine, the difference is invisible. For shared `Insert` from many goroutines, even after you make the structure lock-free, the RNG can become the bottleneck.

### Tip 6 — Compare and switch keys

For numeric keys, comparison is one instruction. For string keys, profile the comparator. A skip list with a million 64-byte keys spends ~30% of `Contains` cost in `bytes.Compare`. Switching to a fixed-prefix comparator can be a win.

### Tip 7 — Cache the most recent search position

If you `Contains` a key and the next call is for a nearby key, restarting from `head` wastes work. The "finger search" optimisation caches the previous endpoint; subsequent searches start there. Worth 2–5× on locality-heavy workloads.

### Tip 8 — Avoid `runtime.NumCPU` shards prematurely

A common idea is to shard a skip list into `N` per-CPU lists. That is rarely a win for ordered data because `Range` across shards is `O(N × log n)`. Only shard if you have measured contention and your queries are point-only.

### Tip 9 — Read with `RWMutex`, not `Mutex`

If you stay coarse-locked, `sync.RWMutex` lets many `Contains` calls proceed in parallel. The reader cost is minimal but the throughput gain is huge for read-heavy traffic.

### Tip 10 — Profile before tuning

`go test -bench . -benchmem -cpuprofile cpu.out`. Open with `go tool pprof`. The hot path is almost always inside the search loop; tune that first.

---

## Best Practices

1. **Start with `skipset`.** Do not write your own concurrent skip list for production unless you have a benchmark-proven reason. Hand-rolled bugs are silent.
2. **Test under `-race`.** Every concurrent test, every time. The cost is irrelevant; the bug it catches is not.
3. **Bound the size.** Wrap with an LRU or with a manual flush trigger at `Len() > N`.
4. **Snapshot for offline iteration.** If a caller wants the full set, return a slice copy; do not lend a live iterator across goroutines.
5. **Document the contract.** "Concurrent skip list, lock-free, supports `Insert`, `Delete`, `Contains`, `Range`. Range iteration sees a consistent snapshot of keys present at the start of iteration. Inserts and deletes during iteration may or may not be visible."
6. **Pick generics.** `Map[K cmp.Ordered, V any]` beats untyped `interface{}` for performance and clarity.
7. **Avoid copying.** Always pass `*SkipList` by pointer; copying a skip list is meaningless and dangerous.
8. **Avoid embedding.** `type MyThing struct { *SkipList }` is tempting but exposes internal methods. Use a named field.
9. **Use atomic counters for `Len()`.** Counting on demand by walking is `O(n)`. Maintain a counter under the mutex (junior) or via `sync/atomic.AddInt64` (senior).
10. **Choose your stable seed for tests.** Random promotion makes outputs nondeterministic. Tests should use a fixed seed and assert structural invariants, not exact heights.

---

## Edge Cases and Pitfalls

### Pitfall 1 — Forgetting to bump `s.level`

```go
if h > s.level {
    for i := s.level; i < h; i++ {
        update[i] = s.head
    }
    s.level = h
}
```

If you skip this block, your new tall node's upper levels are spliced behind a head whose `update[i]` slot was uninitialised (or pointing to an unrelated node). The search will then not find the key on future calls.

### Pitfall 2 — `update[i].next[i] != x` on delete

If something concurrent has already moved `x`, your `Delete` will silently link the wrong nodes. In the coarse-locked version this cannot happen because the mutex serialises everything; but it is the *first* check you must add when moving to per-node locks.

### Pitfall 3 — Mutating keys after insert

```go
key := []byte("alice")
sl.Insert(key)
key[0] = 'b' // now sl thinks 'b' is at the position of 'a'
```

Skip lists assume keys are immutable. Document this loudly.

### Pitfall 4 — Shared `*rand.Rand` across goroutines

`*rand.Rand` is not safe for concurrent use. If multiple goroutines insert simultaneously and share the same `rng`, you will see panics or duplicated values. Per-skiplist with a mutex (coarse) or per-goroutine sources (lock-free) both work.

### Pitfall 5 — Comparison overflow

For 64-bit integer keys, `a - b < 0` is *not* the same as `a < b` when `b` is `math.MinInt64`. Use `<` directly; the compiler turns it into a single comparison instruction.

### Pitfall 6 — `MaxLevel = 0` or negative

A typo here breaks the structure on the first insert. Use a `const`, not a parameter.

### Pitfall 7 — Inserting `nil` key into a string-keyed list

`""` and `nil` may be the same for some comparators and different for others. Decide and document.

### Pitfall 8 — Garbage from `Delete`

After `Delete`, the unlinked node may still be referenced by a goroutine that started a search before the unlink. In Go, the GC keeps it alive until the last pointer drops. In C++ you would need hazard pointers. Do not "manually free" anything.

### Pitfall 9 — `Range` deadlock with `f` that calls back

If `f` inside `Range` calls another method on the same skip list, the second method tries to acquire the lock the first call holds. Deadlock. Document the contract.

### Pitfall 9b — `Range` with adversarial `f`

If `f` performs blocking I/O on each key (a network call, a database write), `Range` holds the read lock for the whole duration. Other writers wait. Always make `f` cheap, or copy keys to a slice under the lock and process outside.

### Pitfall 9c — Confusing `level` with `height`

`s.level` is the current highest occupied level (1-indexed). `n.height` is the height of a specific node (equal to `len(n.next)`). Mix them up in a loop bound and you walk into garbage.

### Pitfall 9d — Forgetting `update` is `MaxLevel`, not `s.level`

```go
update := make([]*node, MaxLevel) // not s.level
```

If you size `update` to `s.level`, your tall new node's upper levels have no recorded predecessor.

### Pitfall 9e — Capacity allocation in `make([]*node, MaxLevel)`

`make([]*node, MaxLevel)` allocates `MaxLevel` *nil* pointers — exactly what we want. Do not write `make([]*node, 0, MaxLevel)`; that gives an empty slice and the indexed assignment `update[i] = x` panics.

### Pitfall 10 — Forgetting that `Range` needs the read lock for the whole walk

If you take the lock, build a snapshot, drop the lock, then walk the snapshot — fine. If you take the lock, walk, *and* an `Insert` in between flips the structure — chaos. Hold the lock for the entire iteration in the coarse version.

---

## Annotated Mistakes — Beginner Mistakes Caught in Code Review

A junior engineer's first PR with a hand-rolled skip list will typically have most of the following. Reviewer comments included.

```go
// Mistake A
func (s *SkipList) Insert(key int) {
    update := []*node{}
    x := s.head
    for i := s.level; i >= 0; i-- {  // BUG: should be s.level - 1
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update = append(update, x)  // BUG: update is in reverse order
    }
    ...
}
```

Reviewer: "`i := s.level` indexes past the array; you want `s.level - 1`. Also, appending into `update` produces a reversed array; build it as `update[i] = x` with a pre-sized slice."

```go
// Mistake B
func (s *SkipList) Insert(key int) bool {
    var update [MaxLevel]*node
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update[i] = x
    }
    if x.next[0].key == key {  // BUG: x.next[0] may be nil
        return false
    }
    ...
}
```

Reviewer: "`x.next[0]` is nil if you walked to the end. Guard with `x.next[0] != nil && x.next[0].key == key`."

```go
// Mistake C
func (s *SkipList) Delete(key int) bool {
    var update [MaxLevel]*node
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update[i] = x
    }
    x = x.next[0]
    if x == nil || x.key != key {
        return false
    }
    for i := 0; i < s.level; i++ {  // BUG: should be len(x.next)
        update[i].next[i] = x.next[i]
    }
    return true
}
```

Reviewer: "You unlink at *every* level, even ones the node does not appear in. This skips over arbitrary other nodes. Use `len(x.next)` as the bound, and `if update[i].next[i] == x` as the guard."

```go
// Mistake D
type SkipList struct {
    head  *node
    level int
}

func New() *SkipList {
    return &SkipList{head: &node{}}  // BUG: head.next is nil
}
```

Reviewer: "Construct the head with `&node{next: make([]*node, MaxLevel)}`. Otherwise every search panics on `head.next[i]`."

```go
// Mistake E
func (s *SkipList) randomHeight() int {
    return rand.Intn(MaxLevel) + 1  // BUG: uniform, not geometric
}
```

Reviewer: "Uniform heights destroy the `O(log n)` guarantee — every node is roughly `MaxLevel/2` tall, so the structure becomes a forest of equal-sized layers. Use the coin-flip loop."

These five mistakes are not made up; they appear in roughly every other skip list code review.

## Common Mistakes

1. **Writing the search top-down vs bottom-up the wrong way.** Search always starts at the highest level and works *down*. Beginners sometimes start from level 0 and walk to the right, which is just a linked list.
2. **Initialising `head` with `next: nil`.** Then `s.head.next[i]` panics. Initialise `make([]*node, MaxLevel)`.
3. **Allocating the new node before knowing its height.** Then you can not size its `next` slice correctly.
4. **Calling `randomHeight()` twice per insert.** Once, store, use everywhere.
5. **Forgetting to compare `x.key == key` after the inner loop.** The inner loop guarantees `next.key >= key`, but you must check equality at the end.
6. **Putting `Lock` inside the inner loop.** Lock outside the entire operation in the coarse version, not inside.
7. **Treating `RWMutex` as free for readers.** It has cost. Profile before assuming it always wins.
8. **Mixing coarse and fine-grained code.** Pick one. The combination is almost always wrong.
9. **Using `defer wg.Done()` without `defer mu.Unlock()`.** When you remember one but forget the other, you leak a lock on panic.
10. **Returning a pointer to an internal node.** Now the caller mutates your structure. Always return copies of keys/values.

---

## Common Misconceptions

### "Skip lists are slower than balanced trees"

In a single-threaded benchmark, a well-implemented red-black tree is 1.2–1.5× faster than a skip list. In a concurrent benchmark with realistic contention, the skip list wins by 3–10× because the tree's rotations serialise.

### "Lock-free means wait-free"

No. Lock-free means *at least one* goroutine makes progress in a finite number of steps. Wait-free means *every* goroutine does. Most lock-free skip lists are not wait-free; under heavy contention, a slow goroutine can be starved.

### "`sync.Map` is just a hash-based skip list"

Different structure entirely. `sync.Map` is two `map`s plus pointer-swapping. It is not ordered, has no `Range(lo, hi)`, and has very different performance characteristics.

### "Coarse locking is bad"

It is bad *only when contention is high*. For low-write workloads (1000 inserts per second on an 8-core machine), the difference between coarse and fine-grained is invisible. Profile first.

### "Skip lists need a fancy PRNG"

For most workloads, a per-skip-list `*rand.Rand` is enough. Worry about PRNG quality only if a benchmark shows it as the hot spot, or if you have an adversarial input model.

### "`MaxLevel` should match `log(N)` exactly"

The constant matters more than people expect. Going from 16 to 32 to 64 levels barely changes search cost but doubles head-sentinel memory. Default to 16 for any size up to one million.

### "All concurrent skip lists are roughly equivalent"

There is a huge gap between Pugh's per-node-lock design (good) and Fraser's lock-free design (much better at high core counts). Pick a library that names which algorithm it uses; lazy implementations exist.

### "The race detector catches every concurrency bug"

It catches *data races* — two unsynchronised accesses where at least one is a write. It does not catch *logical races* (ABA, lost wakeups). The lock-free skip list's marker logic is logical; the race detector will not help you.

### "Snapshot iterators are easy"

In the coarse-locked version, yes — hold the lock. In the lock-free version, snapshot is the single hardest problem. Senior-level material.

### "Memory reclamation is solved by the GC"

In Go, mostly yes. But: the GC waits for the *last pointer* to drop. A long-running `Range` keeps every node it has touched alive, which means a long `Range` on a churning skip list bloats memory.

---

## Tricky Points

### TP 1 — Why `p = 1/2` and not `p = 1/4` or `p = 3/4`

The expected number of pointer hops in a search is approximately `(1 / p) × log_(1/p)(n) + 1`. Taking the derivative with respect to `p` and setting it to zero gives `p ≈ 1/e ≈ 0.368`. The closest convenient fractions are `1/2` and `1/4`. `1/2` minimises the *constant*; `1/4` minimises *memory*. The right choice is workload-dependent.

### TP 2 — Why the inner loop is `next[i].key < key` and not `<=`

If you use `<=`, you walk past the target at the higher levels and have to come back. Using `<` leaves the search "just before or at" the target, which is the correct precondition for splice and unlink.

### TP 3 — Why `MaxLevel = 16` works for billions of keys in practice

With `p = 1/2`, the probability that a *single* key reaches level 16 is `2^-16 ≈ 1.5e-5`. The probability that *no* key in `n = 10^6` does is `(1 - 1.5e-5)^10^6 ≈ e^-15 ≈ 3e-7`. So MaxLevel 16 is comfortable up to a few million; above that, prefer 20 or 24.

### TP 4 — The randomised cost analysis

The expected number of comparisons to search for any key is bounded above by `(1 + 1/p) × log_(1/p)(n) + 1/(1-p)`. For `p = 1/2`, that is roughly `2 × log2(n) + 2`. For one million keys, `2 × 20 + 2 = 42` comparisons. That is the magic number.

### TP 5 — `s.level` shrinks on `Delete`

If you delete the tallest node, several upper levels of the head sentinel may now point to `nil`. Decrement `s.level` while `head.next[s.level-1] == nil` and `s.level > 1`. Skip this and your searches still work but are slightly slower.

### TP 6 — Why you can not "build in parallel" by sharding inserts

Imagine sharding inserts to `K` skip lists by hash of key, then merging at the end. The merge is `O(n log n)` and you lose ordering on point lookups (which shard?). Sharding is not free for ordered data.

### TP 7 — Why `RWMutex` writers can starve

Go's `RWMutex` does not guarantee fairness between readers and writers. Under continuous reader load, a writer can wait arbitrarily long. For read-heavy skip lists this is usually fine; for balanced workloads it is a reason to move to per-node locking.

### TP 8 — Why `Range` should not be implemented "recursively top-down"

A natural-seeming idea: walk from top level, recurse into ranges. It is slower than the standard "search lo, then walk forward on level 0," because the recursion does more pointer hops without benefit.

### TP 9 — Floating-point promotion

If you tune `p` to a non-fraction (e.g. `1/e ≈ 0.368`), use `s.rng.Float64() < 0.368`. The `Intn(pDen) < pNum` form only works for rational `p`.

### TP 9b — The "lazy update of `s.level`" subtlety

If your `Insert` discovers `h > s.level` and bumps `s.level` *before* splicing, a concurrent reader (in the per-node-lock version) might start at a level whose head pointer is nil. Subtle, version-dependent. In the coarse version, this is invisible because the lock holds; remember it when you graduate to fine-grained.

### TP 9c — `Range` and concurrent `Delete`

In the coarse version, holding the read lock prevents `Delete`. In the lock-free version, a `Delete` may happen during a `Range`. Should the iterator see the deleted key? Either contract is defensible. `skipset` chooses "iterators see a snapshot at the start of iteration."

### TP 9d — Why some implementations store `prev[]` pointers

A *doubly-linked* skip list stores `prev[]` as well as `next[]`. This makes reverse iteration cheap but doubles pointer count and makes lock-free updates much harder. Most production designs are forward-only.

### TP 9e — Why `Insert` and `Update` are different concerns for a Map

`Insert` says "add this key with this value if not present." `Update` says "overwrite the value if present, do nothing otherwise." `Upsert` says "always set the value, insert if absent." Decide which API you expose; the search code is shared.

### TP 10 — Why the head sentinel is permanent

If you allowed `head` to be deallocated and reallocated, every reader would need to revalidate its starting point. Keeping `head` for the lifetime of the structure makes reads trivial.

---

## Test

### Test 1 — Insert, Contains, Delete

```go
func TestBasic(t *testing.T) {
    s := New()
    keys := []int{3, 1, 4, 1, 5, 9, 2, 6, 5, 3}
    for _, k := range keys {
        s.Insert(k)
    }
    for _, k := range keys {
        if !s.Contains(k) {
            t.Fatalf("missing %d", k)
        }
    }
    if !s.Delete(5) {
        t.Fatalf("delete 5 returned false")
    }
    if s.Contains(5) {
        t.Fatalf("5 still present after delete")
    }
}
```

### Test 2 — Sorted iteration

```go
func TestSorted(t *testing.T) {
    s := New()
    for _, k := range rand.Perm(1000) {
        s.Insert(k)
    }
    var seen []int
    s.Range(0, 1000, func(k int) bool {
        seen = append(seen, k)
        return true
    })
    for i, v := range seen {
        if v != i {
            t.Fatalf("seen[%d] = %d", i, v)
        }
    }
}
```

### Test 3 — Race-detector concurrent stress

```go
func TestConcurrentStress(t *testing.T) {
    c := NewConcurrent()
    var wg sync.WaitGroup
    for g := 0; g < 8; g++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            rng := rand.New(rand.NewSource(rand.Int63()))
            for i := 0; i < 10_000; i++ {
                k := rng.Intn(1 << 16)
                switch i % 3 {
                case 0:
                    c.Insert(k)
                case 1:
                    c.Contains(k)
                case 2:
                    c.Delete(k)
                }
            }
        }()
    }
    wg.Wait()
}
```

Run with `go test -race -count=5`. The `count` rerun catches schedule-dependent bugs.

### Test 4 — Length consistency

```go
func TestLen(t *testing.T) {
    s := New()
    for i := 0; i < 1000; i++ {
        s.Insert(i)
    }
    n := 0
    s.Range(intMin, intMax, func(int) bool { n++; return true })
    if n != 1000 {
        t.Fatalf("got %d, want 1000", n)
    }
}
```

### Test 5 — Idempotence

```go
func TestIdempotent(t *testing.T) {
    s := New()
    s.Insert(42)
    if s.Insert(42) {
        t.Fatalf("second Insert returned true")
    }
    if !s.Delete(42) {
        t.Fatalf("Delete returned false")
    }
    if s.Delete(42) {
        t.Fatalf("second Delete returned true")
    }
}
```

### Test 6 — Empty list

```go
func TestEmpty(t *testing.T) {
    s := New()
    if s.Contains(0) {
        t.Fatal("empty list contains 0?")
    }
    if s.Delete(0) {
        t.Fatal("empty Delete returned true")
    }
    s.Range(0, 100, func(int) bool {
        t.Fatal("empty Range called f")
        return false
    })
}
```

### Test 7 — Structural invariants

```go
func TestInvariants(t *testing.T) {
    s := New()
    for _, k := range rand.Perm(1000) {
        s.Insert(k)
    }
    // Invariant: at every level, keys are strictly increasing.
    for i := 0; i < s.level; i++ {
        x := s.head.next[i]
        for x != nil && x.next[i] != nil {
            if x.key >= x.next[i].key {
                t.Fatalf("level %d not sorted: %d >= %d", i, x.key, x.next[i].key)
            }
            x = x.next[i]
        }
    }
}
```

### Test 8 — Range bounds

```go
func TestRangeBounds(t *testing.T) {
    s := New()
    for i := 0; i < 100; i++ {
        s.Insert(i)
    }
    var out []int
    s.Range(25, 75, func(k int) bool {
        out = append(out, k)
        return true
    })
    if len(out) != 50 || out[0] != 25 || out[49] != 74 {
        t.Fatalf("got %v", out)
    }
}
```

### Test 9 — Stop iteration

```go
func TestRangeStop(t *testing.T) {
    s := New()
    for i := 0; i < 100; i++ {
        s.Insert(i)
    }
    seen := 0
    s.Range(0, 100, func(k int) bool {
        seen++
        return seen < 10
    })
    if seen != 10 {
        t.Fatalf("got %d, want 10", seen)
    }
}
```

### Test 10 — Property test (fuzz-ish)

```go
func TestProperty(t *testing.T) {
    rng := rand.New(rand.NewSource(1))
    s := New()
    set := map[int]bool{}
    for i := 0; i < 10000; i++ {
        k := rng.Intn(1024)
        switch rng.Intn(3) {
        case 0:
            s.Insert(k)
            set[k] = true
        case 1:
            s.Delete(k)
            delete(set, k)
        case 2:
            if s.Contains(k) != set[k] {
                t.Fatalf("mismatch at %d", k)
            }
        }
    }
}
```

This last test is the most powerful: it asserts that the skip list and a reference `map[int]bool` agree under random operations.

### Test 11 — Benchmark progression

```go
func BenchmarkInsertSizes(b *testing.B) {
    for _, n := range []int{100, 1000, 10000, 100000, 1_000_000} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            s := New()
            for i := 0; i < n; i++ {
                s.Insert(i)
            }
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                s.Insert(n + i) // append-only
            }
        })
    }
}
```

You will observe that ns/op grows logarithmically with `n`, not linearly. If you ever see linear growth, your search has a bug — most likely you walk level 0 from the head.

### Test 12 — Coverage of `Range` early stop

```go
func TestRangeEarlyStop(t *testing.T) {
    s := New()
    for i := 0; i < 100; i++ {
        s.Insert(i)
    }
    s.Range(0, 100, func(k int) bool {
        if k == 5 {
            return false
        }
        if k > 5 {
            t.Fatalf("iteration continued past stop")
        }
        return true
    })
}
```

### Test 13 — Concurrent reader-writer test (coarse)

```go
func TestRWConcurrent(t *testing.T) {
    c := NewConcurrent()
    for i := 0; i < 1000; i++ {
        c.Insert(i)
    }
    var wg sync.WaitGroup
    stop := make(chan struct{})
    // 1 writer
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 1000; ; i++ {
            select {
            case <-stop:
                return
            default:
                c.Insert(i)
            }
        }
    }()
    // 7 readers
    for r := 0; r < 7; r++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < 100_000; i++ {
                _ = c.Contains(i % 1000)
            }
        }()
    }
    time.Sleep(100 * time.Millisecond)
    close(stop)
    wg.Wait()
}
```

Run with `-race`. The point of the test is that the read-mostly access pattern survives a continuous writer.

### Test 14 — Property test with model

```go
func TestModelOracle(t *testing.T) {
    rng := rand.New(rand.NewSource(42))
    s := New()
    var model []int
    for op := 0; op < 5000; op++ {
        switch rng.Intn(3) {
        case 0:
            k := rng.Intn(1000)
            ok := s.Insert(k)
            i := sort.SearchInts(model, k)
            present := i < len(model) && model[i] == k
            if ok == present {
                t.Fatalf("Insert oracle disagreed at k=%d: sl=%v model=%v", k, ok, !present)
            }
            if !present {
                model = append(model, 0)
                copy(model[i+1:], model[i:])
                model[i] = k
            }
        case 1:
            k := rng.Intn(1000)
            ok := s.Delete(k)
            i := sort.SearchInts(model, k)
            present := i < len(model) && model[i] == k
            if ok != present {
                t.Fatalf("Delete oracle disagreed at k=%d", k)
            }
            if present {
                model = append(model[:i], model[i+1:]...)
            }
        case 2:
            k := rng.Intn(1000)
            i := sort.SearchInts(model, k)
            present := i < len(model) && model[i] == k
            if s.Contains(k) != present {
                t.Fatalf("Contains oracle disagreed at k=%d", k)
            }
        }
    }
}
```

The sorted slice `model` is the reference. The test fails immediately on any divergence. This single test catches dozens of subtle bugs that hand-written assertions miss.

---

## Tricky Questions

### Q1 — What is the expected height of the tallest node in a skip list of n keys?

With `p = 1/2`, the expected maximum height is `log2(n) + γ/ln(2) ≈ log2(n) + 0.83`, where `γ` is the Euler–Mascheroni constant. The probability of a node reaching height `h` is `2^-h`; with `n` independent draws, the expected max is dominated by the largest of `n` geometric random variables.

### Q2 — Why does the search algorithm work even when the structure is "weird"?

Because the invariant maintained by all inserts and deletes is "at every level, keys are strictly increasing." The search relies only on that invariant, not on the specific heights. Any structure that satisfies the invariant is searchable.

### Q3 — Can a skip list be made deterministic?

Yes — there are *deterministic skip lists* (Munro, Papadakis, Sedgewick) that promote based on neighbour-count rules rather than coin flips. They have worst-case O(log n) and avoid the variance, but the rules make concurrent updates harder. Most production code uses randomised promotion.

### Q4 — Why does the coarse-locked version still scale better than a single linked list?

It does not, on point operations. It does on `Range` — but a single big linked list would not support efficient `Range` anyway. The win of the skip list is *algorithmic*; the win of "concurrent" is incremental on top.

### Q5 — If I have a `sync.RWMutex`, why ever bother with per-node locks?

Because `RWMutex.RLock` still requires an exclusive `Lock` for any write. Under any meaningful write workload (1% writes is plenty), the `RWMutex` becomes the bottleneck. Per-node locks let readers and writers proceed in parallel as long as they are not at the same place.

### Q6 — Why do we need markers in the lock-free version?

To linearise deletes. Without a marker, a concurrent insert that sees the about-to-be-deleted node may attach itself behind it. When the unlink completes, the new node is lost. The marker says "do not attach here; this node is going away." Senior-level material.

### Q7 — Could you use a `sync.Map` plus a sorted index for the same result?

You could keep a `sync.Map[K]V` for point lookup and a separate sorted structure for ordered queries. But keeping them consistent under concurrent updates is itself a hard problem; the skip list collapses both into one structure.

### Q8 — Why is `MaxLevel` a hard cap and not "grow as needed"?

You could dynamically grow the head sentinel's `next` array, but that requires re-publishing the head atomically — and now the search start is a moving target. Picking a generous `MaxLevel` once is dramatically simpler.

### Q9 — Why is `O(log n)` *expected* good enough?

Because the variance is tiny. Chernoff bounds give "tallest node is within +O(1) of the expected" with probability `1 - 1/n^2`. In practice the tail latency is dominated by GC pauses and cache misses, not by the skip list's randomness.

### Q9b — How is a skip list related to a B-tree?

Both are ordered indexes with `O(log n)` operations. A B-tree minimises cache misses by packing many keys into a node; a skip list packs one key per node but multiple pointers per node. On disk and at very large `n`, the B-tree wins. In memory at moderate `n`, the skip list wins on concurrent updates because there is no page-split.

### Q9c — What happens to the structure if `randomHeight` always returns 1?

It degenerates to a sorted linked list. `Contains` becomes `O(n)`. Insert becomes `O(n)`. Delete becomes `O(n)`. The structure is still correct; only the *cost* breaks.

### Q9d — What happens if `randomHeight` always returns `MaxLevel`?

Every node is at every level. Search is still `O(n)` because every level has every key. Memory grows by a factor of `MaxLevel`. The structure is correct; the costs explode in both dimensions.

### Q9e — Can two threads see different histories of inserts?

Under coarse locking, no — every operation is atomic with respect to every other. Under per-node locking, yes — readers may see "Insert A but not yet Insert B" even though A was committed after B in real time. This is allowed by the linearisability contract as long as some total order exists consistent with each thread's local history.

### Q10 — When would you *not* use a skip list even if you need ordering?

If your data fits in cache and updates are bursty, a `[]K` sorted slice with `sort.Search` for reads and `copy`-shift for writes is faster. If your data is huge and on disk, a B+tree beats a skip list on cache locality. The skip list is the sweet spot for "fits in RAM, needs concurrent ordered access."

---

## Cheat Sheet

```
Probability of node height h:        p^(h-1) × (1 - p)
Expected height:                     1 / (1 - p)              ; =2 for p=1/2
Expected search hops:                ~ (1/p) × log_(1/p)(n)   ; ~2 × log2(n) for p=1/2
Optimal p (search-time):             1/e ≈ 0.37
Pointers per node:                   h (avg = 2 for p=1/2)
MaxLevel rule of thumb:              ceil(log_(1/p)(N_max))    ; 16-32 covers everything

Operation costs (expected):
  Contains:                          O(log n)
  Insert:                            O(log n)
  Delete:                            O(log n)
  Range(lo, hi):                     O(log n + k), k = result size
  Snapshot:                          O(n)

Concurrency strategies, junior to professional:
  1. Single sync.Mutex                — easy, slow
  2. sync.RWMutex                     — easy, read-heavy wins
  3. Per-node sync.Mutex + validate   — middle level
  4. Lock-free CAS + markers          — senior level
  5. Sharded lock-free                — professional level

Go library to use in production:     github.com/zhangyunhao116/skipset
                                     sweet.io/skipset
```

---

## Self-Assessment Checklist

- [ ] I can draw a skip list of 8 keys with three levels on paper.
- [ ] I can write a `Contains` from memory.
- [ ] I can write an `Insert` from memory.
- [ ] I can write a `Delete` from memory.
- [ ] I can explain why `randomHeight` uses a coin flip with probability `p`.
- [ ] I can name the three concurrency strategies (coarse, fine-grained, lock-free).
- [ ] I have run my coarse-locked skip list under `go test -race` and seen it pass.
- [ ] I have benchmarked my skip list vs a `map[int]bool` and understand why the map wins on point lookups.
- [ ] I know what `MaxLevel` does and why 16 is enough for one million keys.
- [ ] I have heard of `skipset`, `ConcurrentSkipListMap`, and the Pugh / Fraser / Harris–Pratt line of work.
- [ ] I can state the time and space complexity of every operation.
- [ ] I understand that a skip list is not the right answer for hash-based point lookups.

If most of these are checked, move on to [middle.md](middle.md).

---

## Summary

A skip list is a stack of sorted linked lists where each level skips over more nodes than the level below. The height of each node is chosen randomly at insert time, which gives `O(log n)` expected cost for search, insert, and delete *without* any rebalancing. The structure is therefore much easier to make concurrent than a balanced tree.

The simplest concurrent version wraps a sequential skip list in a single mutex. It is correct, it is `O(log n)`, and it is the right starting point for any project where contention is unproven. When contention becomes a measured bottleneck, the next step is per-node locking (middle level), and after that lock-free CAS with marker nodes (senior level).

In Go, the standard library does not ship a skip list. The community-standard library is `github.com/zhangyunhao116/skipset`. It is lock-free, well-tested, and the right answer for almost every production need. The point of writing your own is to understand the structure and the concurrency strategies — not to ship a hand-rolled implementation.

Skip lists matter because they sit on the critical path of databases (memtables), caches (ordered TTL), priority queues with cancellation, and any system where you need *both* concurrent updates and ordered iteration. Hash maps cannot do the second; balanced trees struggle with the first. The skip list is the practical sweet spot.

---

## What You Can Build

After this file, you can build:

- A sequential skip list with `Insert`, `Contains`, `Delete`, `Range`.
- A coarse-locked concurrent wrapper around it.
- A read-heavy concurrent ordered set using `sync.RWMutex`.
- A simple time-bucketed event index for an analytics service.
- A small in-memory key-value store with range scans, suitable as the memtable for a toy database project.
- Benchmarks comparing your skip list to `sync.Map` and to a sorted slice.

You can *not* yet build a production-grade concurrent skip list. That requires per-node locking (middle.md) or lock-free CAS (senior.md).

---

## Further Reading

- **William Pugh, "Skip Lists: A Probabilistic Alternative to Balanced Trees,"** *CACM*, 1990. The original paper. Six pages, every one worth reading.
- **William Pugh, "Concurrent Maintenance of Skip Lists,"** UMIACS-TR-90-80, 1990. The first concurrent design, with per-node locks.
- **Keir Fraser, "Practical Lock-Freedom,"** PhD thesis, Cambridge, 2003. The lock-free design used by `java.util.concurrent.ConcurrentSkipListMap` and `skipset`.
- **Tim Harris, "A Pragmatic Implementation of Non-Blocking Linked Lists,"** DISC 2001. The Harris–Michael lock-free linked list — the building block underneath every lock-free skip list.
- **Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, chapter 14.** The classroom presentation.
- **Doug Lea, `java.util.concurrent.ConcurrentSkipListMap` Javadoc and source.** The canonical industrial implementation.
- **`github.com/zhangyunhao116/skipset`** — the popular Go library.
- **`github.com/cockroachdb/pebble/internal/arenaskl`** — Pebble's skip list, tuned for memtable use.

---

## Related Topics

- [Concurrent Trees](../04-concurrent-trees/) — the other ordered concurrent structure.
- [Concurrent Maps](../02-lru-concurrent/) — sibling structure for unordered concurrent access.
- [`sync.Map` overview](../../03-sync-package/) — Go's hash-based concurrent map.
- [Mutexes](../../05-mutexes/) — the coarse locking primitive used here.
- [Atomics](../../09-atomics/) — the foundation of lock-free programming.
- [Memory Model](../../22-memory-model/) — what Go guarantees about visibility between goroutines.

---

## Glossary, Round Two — Subtle Distinctions

Many beginners mix up similarly-named concepts. Here is a second-pass glossary that disambiguates.

- **Skip list vs. skiplist.** Same thing. Pugh's original paper writes "skip list." Most Go libraries write `skiplist` or `skipset` for the type name. Either is accepted.
- **Height vs. level.** *Height* refers to a *node*; *level* refers to the *structure* or to a *layer*. "This node has height 3, so it appears at levels 0, 1, and 2."
- **MaxLevel vs. current level.** `MaxLevel` is the hard cap (e.g., 16). `s.level` is the *current* highest occupied layer; it grows when a tall node is inserted and shrinks when the tallest node is deleted.
- **Predecessor vs. successor.** Predecessor is the node before the target *at a given level*. Successor is the node after. Both change per level.
- **Coarse vs. fine-grained vs. lock-free.** Coarse: one mutex. Fine: per-node mutex. Lock-free: no mutexes, only atomic CAS.
- **Linearisable vs. sequentially consistent.** Linearisable is the stronger guarantee — every operation appears to happen at one point between invocation and response, *and* that point respects real-time order between threads. Sequentially consistent only requires a total order, not respect for real-time order. Skip list APIs aim for linearisable.
- **Logical delete vs. physical delete.** Logical delete marks a node as deleted but leaves it in the chain. Physical delete unlinks it. Many lock-free skip lists separate these two steps and let any thread perform the physical delete on behalf of the deleter.
- **Marker vs. sentinel.** Marker is a special node inserted to signal "this is being deleted." Sentinel is a permanent boundary node (head or tail).

If you can recite each of these without looking, your terminology is solid.

---

## A Walkthrough Comparing Implementations Side by Side

Let us imagine three flavours of `Insert(42)` on the same skip list and compare them line by line. (The implementations below are sketched for illustration; the per-node-lock and lock-free versions are properly developed in [middle.md](middle.md) and [senior.md](senior.md).)

### Coarse-locked Insert

```go
func (c *Coarse) Insert(k int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.sl.Insert(k) // sequential algorithm
}
```

The mutex is the entire concurrency story. Inside, the code is exactly the sequential version. 5 lines of mutex code; the rest is reused.

### Per-node-lock Insert (sketch)

```go
func (c *Fine) Insert(k int) bool {
    for {
        var preds, succs [MaxLevel]*node
        levelFound := c.findPreds(k, &preds, &succs)
        if levelFound != -1 && succs[0].marked.Load() == false {
            // already present; wait for fully linked
            for !succs[0].fullyLinked.Load() {
                runtime.Gosched()
            }
            return false
        }
        h := c.randomHeight()
        valid := true
        var highestLocked int = -1
        for i := 0; i < h && valid; i++ {
            preds[i].mu.Lock()
            highestLocked = i
            valid = !preds[i].marked.Load() && preds[i].next[i] == succs[i]
        }
        if !valid {
            unlockAll(preds, highestLocked)
            continue // restart
        }
        n := &node{key: k, next: make([]*node, h)}
        for i := 0; i < h; i++ {
            n.next[i] = succs[i]
            preds[i].next[i] = n
        }
        n.fullyLinked.Store(true)
        unlockAll(preds, highestLocked)
        return true
    }
}
```

Notice three new ingredients: `marked` (a per-node bool for logical delete), `fullyLinked` (a per-node bool for "I am safe to traverse through"), and *validation* (`preds[i].next[i] == succs[i]`). The CAS-loop discipline is just starting; the next file makes it formal.

### Lock-free Insert (sketch)

```go
func (c *LF) Insert(k int) bool {
    for {
        var preds, succs [MaxLevel]*node
        if c.find(k, &preds, &succs) {
            return false // key present
        }
        h := c.randomHeight()
        n := &node{key: k, next: make([]*node, h)}
        for i := 0; i < h; i++ {
            n.next[i] = succs[i]
        }
        // Level 0 first; if CAS fails, restart whole insert.
        if !atomic.CompareAndSwapPointer(
            (*unsafe.Pointer)(unsafe.Pointer(&preds[0].next[0])),
            unsafe.Pointer(succs[0]),
            unsafe.Pointer(n),
        ) {
            continue
        }
        // Higher levels; if a CAS fails here, retry with fresh find.
        for i := 1; i < h; i++ {
            for {
                if atomic.CompareAndSwapPointer(...) {
                    break
                }
                c.find(k, &preds, &succs) // refresh
            }
        }
        return true
    }
}
```

No locks, but a tangle of CAS retries. The cost is roughly the same as the per-node-lock version on single-thread workloads; the win is at very high core counts where lock contention disappears.

Reading these three side by side once gives you a feel for the *spectrum* of concurrency designs. None of them is "obviously better"; each fits a different operating point.

---

## Diagrams and Visual Aids

### Diagram 1 — A 3-level skip list

```
Level 2:  H ----------> 14 ------------------> 31 -> nil
                         |                      |
Level 1:  H ---> 3 --> 7 - 14 ----> 22 -------> 31 -> nil
                |     |   |          |          |
Level 0:  H -> 1 3 4 7 9 12 14 19 22 25 ----> 31 -> nil
```

(`H` is the head sentinel; arrows are next-pointers at the given level.)

### Diagram 2 — Search path for key `19`

```
Level 2:  H ----------> 14*------------------> 31
                          \
Level 1:                   14 -> 22*
                                  \
Level 0:                           19  <- found
```

(`*` marks "step here, then drop down because next is too big.")

### Diagram 3 — Insert path for key `13`

```
Step 1: search and record predecessors at each level.
        update[2] = H (next is 14 > 13)
        update[1] = 12 — wait, 12 not at L1; update[1] = 7
        update[0] = 12

Step 2: pick height h (say h = 2).

Step 3: splice.
        new.next[0] = update[0].next[0] = 14
        update[0].next[0] = new
        new.next[1] = update[1].next[1] = 14
        update[1].next[1] = new
```

### Diagram 4 — Three concurrency strategies side-by-side

```
Coarse (one Mutex):     [Lock] (search, splice) [Unlock]
                        Operations serialised globally.

Per-node:               (search) [LockPreds] (validate) (splice) [UnlockPreds]
                        Independent operations parallel; head still hot.

Lock-free:              (search) (CAS each level until success or restart)
                        No locks; failures restart; markers protect deletes.
```

### Diagram 5 — Memory layout per node

```
node {
    key      uint64
    val      [V]              (in Map version)
    next     []*node           (length = height, 1..MaxLevel)
}

Total bytes per node ≈ 24 + height × 8.
Expected node size at p=1/2: 24 + 2 × 8 = 40 bytes (plus key/value).
```

### Diagram 6 — Cost shape vs `n`

```
log n:    1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20
n:        2  4  8 16 32 64 ...                                  ~1M
hops:     ~2 ~4 ~6 ~8 ~10  ...                                  ~40
```

That last column — 40 hops for one million keys — is the central engineering fact. Every concurrent skip list optimisation is about making each of those 40 hops faster.

---

End of junior file. The next step is [middle.md](middle.md): per-node locking, validate-then-link, lazy deletion, and why the head sentinel is still the bottleneck.

---

## Extended Walkthrough — Building a Skip List from Scratch in One Sitting

Many readers absorb concepts faster from a single uninterrupted walkthrough than from many short snippets. This section assumes you are at a terminal with `go` installed and want to type along.

### Setup

```bash
mkdir -p ~/sandbox/skip && cd ~/sandbox/skip
go mod init example.com/skip
```

### Step 1 — The skeleton

Create `skip.go`:

```go
package skip

import "math/rand"

const MaxLevel = 16

type node struct {
    key  int
    next []*node
}

type SkipList struct {
    head  *node
    level int
    rng   *rand.Rand
}

func New() *SkipList {
    return &SkipList{
        head:  &node{next: make([]*node, MaxLevel)},
        level: 1,
        rng:   rand.New(rand.NewSource(1)),
    }
}
```

Compile with `go build .`. It works; nothing observable, but the package compiles cleanly.

### Step 2 — `randomHeight`

```go
func (s *SkipList) randomHeight() int {
    h := 1
    for h < MaxLevel && s.rng.Intn(2) == 0 {
        h++
    }
    return h
}
```

Add a quick smoke test. Create `skip_test.go`:

```go
package skip

import (
    "fmt"
    "testing"
)

func TestRandomHeightDistribution(t *testing.T) {
    s := New()
    counts := make([]int, MaxLevel+1)
    const N = 1 << 16
    for i := 0; i < N; i++ {
        counts[s.randomHeight()]++
    }
    for h, c := range counts {
        if c > 0 {
            fmt.Printf("h=%d: %.4f\n", h, float64(c)/N)
        }
    }
}
```

Run `go test -v -run TestRandomHeightDistribution`. You should see roughly `h=1: 0.5, h=2: 0.25, h=3: 0.125, ...`. If the distribution is wildly off, your `randomHeight` is broken.

### Step 3 — `Contains`

```go
func (s *SkipList) Contains(key int) bool {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
    }
    x = x.next[0]
    return x != nil && x.key == key
}
```

Now `Contains` works on an empty list (it returns `false`). Confirm with a test before moving on.

### Step 4 — `Insert`

```go
func (s *SkipList) Insert(key int) bool {
    var update [MaxLevel]*node
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update[i] = x
    }
    if x.next[0] != nil && x.next[0].key == key {
        return false
    }
    h := s.randomHeight()
    if h > s.level {
        for i := s.level; i < h; i++ {
            update[i] = s.head
        }
        s.level = h
    }
    n := &node{key: key, next: make([]*node, h)}
    for i := 0; i < h; i++ {
        n.next[i] = update[i].next[i]
        update[i].next[i] = n
    }
    return true
}
```

Now write a test:

```go
func TestInsertContains(t *testing.T) {
    s := New()
    for _, k := range []int{3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5} {
        s.Insert(k)
    }
    for _, k := range []int{1, 2, 3, 4, 5, 6, 9} {
        if !s.Contains(k) {
            t.Errorf("missing %d", k)
        }
    }
    for _, k := range []int{0, 7, 8, 10} {
        if s.Contains(k) {
            t.Errorf("unexpected %d", k)
        }
    }
}
```

### Step 5 — `Delete`

```go
func (s *SkipList) Delete(key int) bool {
    var update [MaxLevel]*node
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.next[i] != nil && x.next[i].key < key {
            x = x.next[i]
        }
        update[i] = x
    }
    x = x.next[0]
    if x == nil || x.key != key {
        return false
    }
    for i := 0; i < len(x.next); i++ {
        if update[i].next[i] == x {
            update[i].next[i] = x.next[i]
        }
    }
    for s.level > 1 && s.head.next[s.level-1] == nil {
        s.level--
    }
    return true
}
```

Run the property test from Test 10 above. It should pass within seconds.

### Step 6 — Add the concurrent wrapper

Create `concurrent.go`:

```go
package skip

import "sync"

type ConcurrentSkipList struct {
    mu sync.RWMutex
    sl *SkipList
}

func NewConcurrent() *ConcurrentSkipList { return &ConcurrentSkipList{sl: New()} }

func (c *ConcurrentSkipList) Contains(k int) bool {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.sl.Contains(k)
}

func (c *ConcurrentSkipList) Insert(k int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.sl.Insert(k)
}

func (c *ConcurrentSkipList) Delete(k int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.sl.Delete(k)
}
```

Now run `go test -race`. Anything that fails here is your bug, not the runtime's.

### Step 7 — Bench

```go
func BenchmarkContains(b *testing.B) {
    s := New()
    n := 1 << 20
    for i := 0; i < n; i++ {
        s.Insert(i)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s.Contains(i % n)
    }
}
```

Run `go test -bench BenchmarkContains -benchtime=2s`. You should see in the hundreds of nanoseconds — say 200–500 ns. If it is ten times slower, your search has an off-by-one.

That is a complete working skip list in roughly 100 lines, plus tests. The remainder of the level files build on this skeleton.

---

## Comparison Matrix in Detail

Here is a more verbose comparison than the one earlier, with notes on *why* each row reads as it does.

| Property | Sorted slice + RWMutex | map + RWMutex | sync.Map | Skip list (coarse) | Skip list (per-node) | Skip list (lock-free) | B-tree |
|----------|------------------------|---------------|----------|--------------------|-----------------------|-----------------------|--------|
| Ordered | Yes | No | No | Yes | Yes | Yes | Yes |
| Range scan | O(log n + k) | n/a | n/a | O(log n + k) | O(log n + k) | O(log n + k) | O(log n + k) |
| Point lookup | O(log n) | O(1) avg | O(1) avg | O(log n) exp | O(log n) exp | O(log n) exp | O(log n) |
| Insert | O(n) (shift) | O(1) amort | O(1) amort | O(log n) exp | O(log n) exp | O(log n) exp | O(log n) |
| Delete | O(n) (shift) | O(1) | O(1) (but lazy) | O(log n) exp | O(log n) exp | O(log n) exp | O(log n) |
| Concurrent readers | many | many | many | many | many | many | many |
| Concurrent writers | one | one | (specialised) | one | many | many | many |
| Memory per key | 1 × key | 1 key + table overhead | 2 keys (read+dirty) | h × pointer + key | h × pointer + key + mutex | h × pointer + key | (page) |
| Cache-friendly | very | medium | medium | medium | medium | medium | very |
| Code complexity | small | small | small | small | medium | large | large |
| Crash safety | none | none | none | none | none | none | none (memtable) |
| Typical Go choice | uncommon | common | common | uncommon | rare | use `skipset` | use `bbolt` |

The rightmost column (B-tree) is what a disk-backed database picks; the skip list columns are what an in-memory database picks. The intermediate columns (`sync.Map`, map+RWMutex) are what most Go applications pick when ordering does not matter.

---

## Sample Production Concerns

Below are real-world questions that teams ask when evaluating a concurrent skip list for production. Knowing the questions is half the work.

### Q — How much memory will it use?

Approximate formula: `n × (overhead per node + expected height × 8 bytes + key size + value size)`. With `p = 1/2`, expected height is 2, so the pointer overhead is `~16 bytes`. Add Go's header overhead (`~24 bytes`) and you get roughly `40 + key + value` bytes per key. At one million 8-byte keys and 16-byte values, that is `~64 MB`. Useful for capacity planning.

### Q — Will it survive a process crash?

No. Pair with a WAL if you need durability. The LSM-tree pattern is "append to a WAL on disk, insert into the skip list memtable in RAM; on crash, replay WAL." Pebble and BadgerDB both do this.

### Q — How does it interact with the Go GC?

A skip list holds many pointers; the GC has to scan every node's `next` slice during a GC cycle. With one million nodes at expected height 2, that is ~2 million pointers — small by GC standards (the GC handles billions of pointers per second). For most workloads the skip list is GC-invisible. For pathologically deep deletes that hold onto unreachable subgraphs, the GC catches up on the next cycle.

### Q — How will it behave under sustained 90% write workload?

With coarse locking, every write contends. Throughput is at best the latency of one `Insert` (~500 ns) times one core: 2 M ops/s on a single core, no parallelism. With per-node locks, scales to 5–10 cores. With lock-free, scales to all cores until contention on the head sentinel becomes the bottleneck.

### Q — What is the p99 latency?

Coarse-locked: dominated by lock wait time, which can be arbitrarily large under contention. Per-node: dominated by the largest lock window any goroutine experiences. Lock-free: dominated by CAS-loop retries; in steady state, p99 is ~3× p50.

### Q — How does it compare to `ConcurrentSkipListMap` in Java?

Same algorithm family (Fraser/Harris-Pratt). Java's version uses `VarHandle` for CAS; Go's `skipset` uses `sync/atomic.CompareAndSwapPointer`. Performance is comparable per-core; Go has slightly lower throughput at very high core counts because Go's atomics on amd64 are slightly slower than Java's (Hotspot's intrinsics are aggressive). The functional contract is essentially the same.

### Q — Can I add custom comparators?

In `skipset`, no — there are typed constructors per primitive type. In a generic Go 1.21+ skip list, yes, via a `Less func(a, b K) bool` constructor parameter. Custom comparators add a tiny per-comparison call overhead.

### Q — Can I have duplicate keys?

Standard skip lists are sets — at most one node per key. If you need multi-set behaviour, store a list of values per node, or include a sequence number as a key tie-breaker.

### Q — Does it support transactions?

Not natively. Wrap with a `sync.Mutex` for "atomic group of operations" or build MVCC on top with snapshot iterators. The Pebble memtable does the latter.

---

## A Day in the Life of an Insert

To cement the picture, let us trace what happens when application code calls `c.Insert(42)` on a coarse-locked concurrent skip list.

1. **Goroutine A enters `Insert`.** It calls `c.mu.Lock()`. The `sync.Mutex` is uncontended; Lock returns in nanoseconds.
2. **Goroutine B, meanwhile, calls `c.Contains(10)`.** It calls `c.mu.RLock()`. But `RLock` blocks because the writer holds the lock. B parks on a runtime queue.
3. **A executes the sequential `Insert`.** It walks the structure top-down, recording predecessors. ~30 pointer hops at one million keys.
4. **A draws a random height.** `randomHeight` returns, say, 3.
5. **A allocates a new node.** `make([]*node, 3)` and the node struct — one or two heap allocations.
6. **A splices.** Three `next` pointers updated. Three writes to RAM.
7. **A updates `s.level` if needed.** No-op here because `s.level >= 3` already.
8. **A returns `true`.** `defer` runs `c.mu.Unlock()`.
9. **B wakes up.** `RLock` returns. B does its read. B returns.

Total time for A: ~500 ns of work, ~30 ns of locking overhead. Total time B was blocked: ~530 ns. Multiply by N concurrent goroutines for the worst-case waiting line.

This is the *complete picture* you should hold in your head whenever you reason about a coarse-locked skip list's performance.

---

## What Changes at the Middle Level

When you move to per-node locking, the picture changes in three concrete ways:

1. **The single coarse lock disappears.** There is no `c.mu`. Each node has its own lock.
2. **`Insert` and `Delete` lock only the predecessors they need.** `Insert(42)` locks the predecessors at each level; `Insert(1000000)` locks completely different predecessors. They proceed in parallel.
3. **Validation appears.** After acquiring the predecessor lock, you must re-check that the predecessor's `next` pointer at this level still points to the expected successor. If not, release locks and restart. This is the *validate-then-link* pattern.

The cost of all this is ~3× more code, ~2× higher single-thread latency, and 5–10× higher throughput under contention. Whether that is worth it is the central engineering question of [middle.md](middle.md).

---

## Practice Plan — One Week of Focused Effort

To master the junior-level material, plan five hours over the week.

- **Day 1 (1h).** Type along with the "Building from Scratch" section above. Run the property test.
- **Day 2 (1h).** Without looking, re-implement `Insert` and `Delete`. Watch your tests fail; fix them.
- **Day 3 (1h).** Add `Range`, `Floor`, `Ceiling`. Write tests for each.
- **Day 4 (1h).** Add the coarse-locked wrapper. Run `go test -race` and `go test -bench .`.
- **Day 5 (1h).** Compare your skip list to `sync.Map` in a `RunParallel` benchmark. Understand why your skip list loses on point-lookups and wins on ordered iteration.

If you finish all five days and your benchmarks make sense, you are ready for middle.md.

---

## Final Words

## Further Worked Example — Inserting a Sequence and Visualising It

Let us insert the keys `5, 12, 1, 17, 4, 11, 9, 13, 8` one at a time, choosing heights from a deterministic sequence `2, 3, 1, 1, 2, 1, 4, 1, 2` (these are heights, not promotions; chosen for clarity).

**Insert 5 (h=2).**

```
L1: H -> 5
L0: H -> 5
```

**Insert 12 (h=3).** The new max level is 3.

```
L2: H -> 12
L1: H -> 5 -> 12
L0: H -> 5 -> 12
```

**Insert 1 (h=1).**

```
L2: H ------> 12
L1: H ---> 5 -> 12
L0: H -> 1 -> 5 -> 12
```

**Insert 17 (h=1).**

```
L2: H ----------> 12
L1: H ------> 5 -> 12
L0: H -> 1 -> 5 -> 12 -> 17
```

**Insert 4 (h=2).**

```
L2: H ----------------> 12
L1: H ---------> 4 -> 5 -> 12
L0: H -> 1 -> 4 -> 5 -> 12 -> 17
```

**Insert 11 (h=1).**

```
L2: H -------------------> 12
L1: H ---------> 4 -> 5 ----> 12
L0: H -> 1 -> 4 -> 5 -> 11 -> 12 -> 17
```

**Insert 9 (h=4).** New max level is 4.

```
L3: H ----------> 9
L2: H ----------> 9 ----> 12
L1: H ---> 4 -> 5 -> 9 ----> 12
L0: H -> 1 -> 4 -> 5 -> 9 -> 11 -> 12 -> 17
```

**Insert 13 (h=1).**

```
L3: H ----------> 9
L2: H ----------> 9 -----------> 12
L1: H ---> 4 -> 5 -> 9 ---------> 12
L0: H -> 1 -> 4 -> 5 -> 9 -> 11 -> 12 -> 13 -> 17
```

**Insert 8 (h=2).**

```
L3: H ----------> 9
L2: H ----------> 9 --------------> 12
L1: H ---> 4 -> 5 -> 8 -> 9 ---------> 12
L0: H -> 1 -> 4 -> 5 -> 8 -> 9 -> 11 -> 12 -> 13 -> 17
```

**Search for 11.** Start at L3, head. `next[3] = 9`. `9 < 11`. Advance. `9.next[3] = nil`. Drop. At node `9`, L2. `9.next[2] = 12`. `12 >= 11`. Drop. At `9`, L1. `9.next[1] = 12`. `12 >= 11`. Drop. At `9`, L0. `9.next[0] = 11`. Found in 6 hops.

This walkthrough is the kind of thing every textbook draws once and most readers gloss over. Draw it on paper. Then draw a delete of `9` (which is height 4, so unlink at all four levels). You will see firsthand why the algorithm is correct: every level remains sorted; every search path remains valid.

---

## Quick Reference — One-page

```
Skip list invariant: at every level i, keys are strictly increasing.
Insert: search, record predecessors per level, splice into chosen height.
Delete: search, record predecessors per level, unlink at every level the node appears in.
Contains: search, check level-0 endpoint == target.

Probability of node height = h:  p^(h-1) × (1 - p)
Expected height:                  1 / (1 - p)
Expected search hops:             (1/p) × log_(1/p)(n) + O(1)
With p=1/2:                       ~2 × log2(n) ≈ 40 hops at n = 1M

Concurrent strategies:
  Coarse Mutex      — easy, low scale
  Coarse RWMutex    — easy, read-heavy wins
  Per-node Mutex    — medium-hard, write-scalable
  Lock-free CAS     — hard, cores-scalable
  + Marker nodes    — required for lock-free correctness

Go libraries:
  github.com/zhangyunhao116/skipset — production-grade, lock-free
  sweet.io/skipset                   — alternative; check benchmarks
  cockroachdb/pebble/internal/arenaskl — memtable-specialised

When to use a skip list:
  Need ordering AND concurrent updates: yes.
  Need ordering, single writer:         maybe (sorted slice often wins).
  No ordering needed:                   no — use sync.Map.

When NOT to use a skip list:
  Tiny datasets (<100 keys):            sorted slice or array.
  On-disk index:                        B+tree.
  Cryptographic key store:              constant-time hash map.
  Crash-safe persistent store:          BoltDB / bbolt / Pebble.
```

This single page is what you want pinned to your monitor while writing your first skip list.

---

## Final Words

A skip list is one of the most elegant data structures in computer science. Its randomness is its discipline; its lack of rebalancing is its concurrent strength. The single-threaded version is short enough to write from memory after one careful read. The concurrent versions get progressively more interesting — and the deepest material is genuinely hard, on the boundary of current research.

But at the junior level, your job is just to *see* the structure. Pick up a sheet of paper. Draw a skip list with eight keys. Trace a search. Trace an insert. Trace a delete. Cross your fingers and run `go test -race`. The rest of this folder builds on top of that picture.

---

## Appendix A — Comparing Memory Layouts

There are three common memory layouts for a skip list node. Each has tradeoffs.

### Layout 1 — Slice of `next` pointers

```go
type node struct {
    key  K
    val  V
    next []*node // length = node's height
}
```

Pros: simple, idiomatic Go, GC-friendly.
Cons: two allocations per insert (struct + slice), and pointer chasing across the slice header to the pointers.

This is what every junior implementation uses, and what the code in this file uses.

### Layout 2 — Embedded array tail (`unsafe`)

```go
type node struct {
    key    K
    val    V
    height int
    // next pointers follow inline, of variable length
}

func newNode(key K, val V, h int) *node {
    size := unsafe.Sizeof(node{}) + uintptr(h)*unsafe.Sizeof((*node)(nil))
    mem := unsafe.Pointer(&make([]byte, size)[0])
    n := (*node)(mem)
    n.key = key
    n.val = val
    n.height = h
    return n
}

func (n *node) nextAt(i int) **node {
    base := unsafe.Pointer(n) + unsafe.Sizeof(node{})
    return (**node)(unsafe.Pointer(uintptr(base) + uintptr(i)*unsafe.Sizeof((*node)(nil))))
}
```

Pros: one allocation per insert; better cache locality.
Cons: requires `unsafe`; harder to debug; the GC must still see the pointers inside the tail, which means hooking into the runtime in a delicate way. Production libraries use this layout (Pebble's `arenaskl`), but it is not a beginner exercise.

### Layout 3 — Arena allocation

```go
type arena struct {
    buf []byte
    off int
}

func (a *arena) alloc(size int) []byte {
    a.off += size
    return a.buf[a.off-size : a.off]
}
```

Allocate all nodes from a single contiguous byte buffer. Nodes are referenced by *offset* into the arena, not by pointer. The arena lives as long as the skip list. When the skip list is dropped, the entire arena is freed at once.

Pros: zero per-node GC overhead; perfect cache locality; trivial to checkpoint.
Cons: requires `unsafe` and careful pointer-to-offset conversion; resizing the arena is awkward; reclamation requires the whole structure to be discarded.

This is the layout used by Pebble's `arenaskl`. It is genuinely the right answer for a high-throughput memtable, but it is two levels of abstraction above what we are doing here. Bookmark for the future.

---

## Appendix B — Tiny History

- **1990.** William Pugh publishes "Skip Lists: A Probabilistic Alternative to Balanced Trees" (CACM). The single most influential data structures paper of the early 1990s.
- **1990.** Pugh follows up with "Concurrent Maintenance of Skip Lists" (UMIACS-TR-90-80). Per-node-lock design.
- **2001.** Tim Harris publishes "A Pragmatic Implementation of Non-Blocking Linked Lists" (DISC 2001). Introduces the marker pattern for lock-free single-linked lists.
- **2001.** Maged Michael publishes "High Performance Dynamic Lock-Free Hash Tables and List-Based Sets" (SPAA 2002). Refines Harris's design.
- **2003.** Keir Fraser's Cambridge PhD thesis, "Practical Lock-Freedom," includes a full lock-free skip list using markers. The standard reference.
- **2004.** Doug Lea ships `java.util.concurrent.ConcurrentSkipListMap` in Java 1.6. First mainstream production lock-free skip list.
- **2007.** LevelDB (Google) ships with a concurrent skip list memtable; the design influences RocksDB, BadgerDB, Pebble, and many others.
- **2010s.** Several Go libraries appear: `huandu/skiplist` (single-threaded), `zhangyunhao116/skipset` (lock-free), `sweet.io/skipset` (alternate).
- **2020s.** CockroachDB's Pebble engine uses arena-allocated skip lists for its memtable; Pebble's `internal/arenaskl` becomes a reference implementation.

The arc is consistent: 1990 invents the structure; 2001–2004 makes it lock-free; 2007 onwards integrates it into industrial databases. The Go ecosystem joined this conversation roughly a decade ago and now has several mature libraries.

---

## Appendix C — Glossary of Symbols Used in Papers

When you read Pugh, Fraser, or the Java source, you will see:

- `L` — current top level of the structure.
- `MaxLevel` — hard cap on a node's height.
- `p` — promotion probability (usually `1/2` or `1/4`).
- `update[]` — array of predecessors at each level.
- `x.forward[i]` — Pugh's name for `x.next[i]`.
- `x.next[i]` — Sedgewick/CLRS name for the same.
- `pred`, `succ` — predecessor and successor at a given level.
- `mark` — the "logically deleted" flag.
- `helper` — a thread that completes a half-finished operation on behalf of another.
- `linearisation point` — the single instant at which an operation is deemed to take effect.

If you read papers and see these symbols, the translation back to Go code is one line each.

---

End of junior.md. Total length is intentionally substantial — the concurrent skip list is the gateway to lock-free programming in Go, and a thorough junior file pays off when you reach senior and professional levels. Continue with [middle.md](middle.md).
