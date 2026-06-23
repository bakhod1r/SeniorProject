---
layout: default
title: Junior
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/junior/
---

# Concurrent Trees — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Why Not Just Use a `map`?](#why-not-just-use-a-map)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Pros and Cons](#pros-and-cons)
9. [Use Cases](#use-cases)
10. [Code Examples](#code-examples)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code](#clean-code)
13. [Product Use](#product-use)
14. [Error Handling](#error-handling)
15. [Security Considerations](#security-considerations)
16. [Performance Tips](#performance-tips)
17. [Best Practices](#best-practices)
18. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Tricky Points](#tricky-points)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> Focus: "What is a balanced search tree? Why do I need *ordering*? How do I share one between goroutines without corruption?"

A **tree**, in this context, is a data structure that stores key–value pairs in **sorted key order**. Unlike a Go `map`, which is built on a hash table and offers no ordering guarantee, a tree lets you:

- Look up a specific key in `O(log n)` time
- Iterate keys **in order**: from smallest to largest, or within a range like `[100, 200]`
- Find "the next key greater than `k`" or "the largest key less than `k`"
- Stream records in sorted order without holding everything in memory

This second column — *ordered* operations — is why databases, file systems, search indexes, time-series stores, and almost every persistent storage engine in existence are built on B-trees, B+-trees, or radix trees, not on hash tables.

A **concurrent tree** is the same structure designed so that multiple goroutines can read and write at the same time without corrupting it. Doing this *correctly* and *fast* is one of the deepest problems in systems programming. There are entire PhD theses and decades of academic papers on it. But at the junior level, you only need to learn three things:

1. **What a balanced tree looks like** (a B-tree in particular, because that is what real Go libraries give you).
2. **Why a plain unguarded tree breaks under concurrent writes.**
3. **The simplest possible way to share a tree between goroutines:** put a single `sync.Mutex` or `sync.RWMutex` in front of it.

This file teaches those three things, then walks through using `github.com/google/btree`, the most popular Go in-memory B-tree, with safe concurrent wrappers. By the end you will be able to share an ordered key–value store across goroutines confidently, and you will know exactly *why* more advanced approaches (hand-over-hand, optimistic, RCU, Bw-trees) exist — even if you have not learned them yet.

You do **not** need to understand red-black trees, AVL rotations, B+-tree internals, latch crabbing, optimistic concurrency control, RCU, epoch-based reclamation, the Bw-tree, ART, or page eviction. Those are middle, senior, and professional material. This file is about the basics: trees, ordering, locks, and the first real Go library.

---

## Prerequisites

- **Required:** A working Go installation (1.21+ recommended). Run `go version` to check.
- **Required:** Comfort with goroutines, `go func()`, and `sync.WaitGroup`. See the [Goroutines junior file](../../01-goroutines/01-overview/junior/).
- **Required:** Comfort with `sync.Mutex` and `sync.RWMutex`. You should know what `Lock()`, `Unlock()`, `RLock()`, `RUnlock()` do and why double-locking deadlocks.
- **Required:** Familiarity with Go's built-in `map` and `slice`. You should know that `map` access is *not* safe under concurrent writes.
- **Helpful:** Some exposure to a binary search tree from a CS course. Not required.
- **Helpful:** Familiarity with `go get` and Go modules so you can install `github.com/google/btree`.

Verify the test environment works:

```bash
mkdir tree-junior && cd tree-junior
go mod init example.com/tree
go get github.com/google/btree
```

If `go get` succeeds and downloads `btree`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Tree** | A hierarchical data structure where each node has zero or more children and there are no cycles. In this section, always an *ordered* search tree. |
| **Binary search tree (BST)** | A tree where each node has at most two children, the left subtree holds smaller keys, the right subtree holds larger keys. The simplest ordered tree. |
| **Balanced tree** | A tree that keeps its height proportional to `log(n)` so all operations stay `O(log n)`. Unbalanced trees degrade to `O(n)`. |
| **AVL tree** | A self-balancing BST that maintains a height difference of at most 1 between left and right subtrees of every node. |
| **Red-black tree** | A self-balancing BST that uses one bit per node ("red" or "black") to keep the tree approximately balanced. Used by `std::map` in C++, `TreeMap` in Java. |
| **B-tree** | A balanced tree where each node may hold many keys and many children (typically dozens or hundreds). Designed for disk and cache efficiency. The basis of almost every database index. |
| **B+-tree** | A variant of the B-tree where all data lives in the leaves and internal nodes hold only routing keys. Leaves are linked to support efficient range scans. The dominant index structure in databases. |
| **Fanout / Order** | The maximum number of children a B-tree node can have. Common values are 16, 32, 64, 128, 256. |
| **Height** | The number of levels in the tree. A balanced B-tree of fanout `B` storing `n` keys has height roughly `log_B(n)`. |
| **`google/btree`** | A pure-Go in-memory B-tree library at `github.com/google/btree`. The de-facto standard for sorted in-memory data in Go. |
| **`tidwall/btree`** | A generic, optionally goroutine-safe B-tree at `github.com/tidwall/btree`. Supports copy-on-write and lockless reads when used in immutable mode. |
| **Concurrent data structure** | A data structure designed to be accessed by multiple goroutines (or threads) at the same time without corruption. |
| **Coarse-grained locking** | One lock protects the entire data structure. Simple, safe, but limits scalability. |
| **Fine-grained locking** | Different locks protect different parts of the data structure. Harder, but allows real parallelism. |
| **`sync.Mutex`** | Standard Go mutual-exclusion lock. Only one goroutine at a time may hold it. |
| **`sync.RWMutex`** | A reader/writer lock. Multiple readers may hold it concurrently, but a writer is exclusive. |
| **Race condition** | A bug where the program's behavior depends on the unpredictable interleaving of goroutines. The Go race detector (`go test -race`) finds many of these. |
| **Order statistic** | A query like "what is the 100th smallest key?" Trees can answer this in `O(log n)` if they store subtree sizes. |
| **Range query** | A query like "give me all keys between 50 and 200." A tree handles this naturally; a hash map does not. |

---

## Core Concepts

### What does "ordered" mean, and why is it useful?

A Go `map[int]string` lets you do this:

```go
m := map[int]string{1: "a", 7: "g", 3: "c"}
fmt.Println(m[3]) // "c"
```

But `for k, v := range m` gives you the keys in **random order** — and Go intentionally randomizes the iteration order so you do not accidentally rely on it. There is no way to ask "what is the smallest key in this map?" without scanning every entry. There is no way to ask "give me all keys between 3 and 7" without scanning every entry.

A tree gives you all of these:

- "Smallest key" — walk to the leftmost leaf, `O(log n)`.
- "Largest key" — walk to the rightmost leaf, `O(log n)`.
- "All keys in `[lo, hi]`" — find `lo`, then walk forward to `hi` in key order, `O(log n + k)` where `k` is the result count.
- "Next key after `k`" — find `k`, then take one step right, `O(log n)`.

These are the building blocks of:

- **Database indexes** (`SELECT * WHERE created_at BETWEEN x AND y`)
- **Time-series storage** ("all readings in the last hour")
- **Geographic indexes** ("all points within this rectangle" — done with multi-dimensional trees like R-trees or BVH)
- **Filesystem directory entries** sorted by name
- **In-memory caches** that need to evict the oldest entry
- **Auto-complete** (find all keys with prefix `p`)
- **Routing tables** in networking (longest-prefix match uses a tree)

If you ever want any of those operations, a hash map is not enough.

### A binary search tree, drawn

The simplest ordered tree is a BST. Each node stores one key and has two children: smaller keys go left, larger go right. To find a key, you walk from the root, comparing at each step.

```
            50
           /  \
          /    \
        30      70
       /  \    /  \
      20   40 60   80
```

`Find(60)`: compare 60 to 50 → go right. Compare 60 to 70 → go left. Compare 60 to 60 → found.

In the worst case (a long thin tree), this is `O(n)`. To keep it `O(log n)`, BSTs need *balancing* — AVL trees, red-black trees, and many other variants. But under concurrent access, balancing is *the* hardest part: rotating a node touches its parent, both children, and possibly its grandparent simultaneously.

### A B-tree, drawn

A B-tree generalizes the BST. Instead of one key per node, each node holds many keys (up to some maximum, often called the *order*) and many children:

```
                  +-------------------+
                  |  30   60   90     |  (one node, three keys, four children)
                  +-------------------+
                 /     |      |       \
               /       |      |         \
        [10,20] [40,50] [70,80]  [100,110,120]
```

A `Find(70)`: compare to 30 (greater), to 60 (greater), to 90 (less). Go to the third child. Search inside it. Done.

Why bigger nodes? Two reasons:

1. **Cache and disk locality.** A node fits in one cache line (or one disk page). Scanning 32 keys inside a single node is much cheaper than chasing 5 pointers through a deep BST, because each pointer chase is a possible cache miss.
2. **Lower height.** A tree of fanout 64 storing a billion items has height ~5. The same number in a BST has height 30. Five comparisons of cache-resident nodes beats thirty pointer chases hands down.

B-trees are why every database index in the world (Postgres, MySQL's InnoDB, SQLite, Oracle, SQL Server, MongoDB's WiredTiger, BoltDB, BadgerDB, LMDB, ...) is a B-tree or B+-tree variant. They are also why `google/btree` and `tidwall/btree` exist as Go libraries: when you want sorted data in memory, you almost always want a B-tree.

### What can go wrong under concurrent writes?

Imagine two goroutines call `Insert(k, v)` on the same tree at the same time. Each one:

1. Walks from the root looking for the right leaf.
2. If the leaf has space, inserts the new key there.
3. If the leaf is full, *splits* it into two leaves and pushes one key up to the parent.
4. If the parent is now full, splits it too. And so on recursively up to the root.

Without any synchronization, two concurrent splits can:

- Both read a parent pointer, then both try to write a new child pointer into the same slot.
- One thread sees a half-finished split where a child has been added but the parent pointer not yet updated, then it walks into a phantom subtree.
- A reader walks down a node that another writer has just freed because it was merged with a sibling.
- The root pointer itself gets overwritten by two threads racing.

The result is **silent corruption**: lookups return wrong values, range scans skip records or revisit them, the tree's invariants no longer hold, and a future `Insert` panics with an out-of-bounds slice access because the in-memory layout is no longer consistent.

This is not a theoretical concern. Run a tiny program that spawns 8 goroutines all inserting into an unguarded BST and you will see crashes within milliseconds. The Go race detector (`-race`) will flag the writes.

### The simplest fix: one big lock

The first defense, and the one a junior engineer should default to, is a **single mutex around the entire tree**:

```go
type SafeTree struct {
    mu sync.Mutex
    bt *btree.BTreeG[Item]
}

func (s *SafeTree) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.ReplaceOrInsert(it)
}

func (s *SafeTree) Get(key int) (Item, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    it, ok := s.bt.Get(Item{Key: key})
    return it, ok
}
```

This is **correct**. It is **slow** if you have hundreds of cores hammering the same tree, but it is far better than a corrupt tree, and for many real workloads — admin panels, configuration services, CLIs, anything below a few thousand QPS — it is plenty.

The middle and senior files teach you how to do better than this. But you should never feel bad about starting here. "A single mutex" is the right answer to most concurrency questions you will ever face professionally, until profiling proves otherwise.

### `sync.RWMutex`: many readers, one writer

If your workload is **read-heavy** (e.g., 99% lookups, 1% inserts), you can do better with `sync.RWMutex`:

```go
type RWSafeTree struct {
    mu sync.RWMutex
    bt *btree.BTreeG[Item]
}

func (s *RWSafeTree) Get(key int) (Item, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.bt.Get(Item{Key: key})
}

func (s *RWSafeTree) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.ReplaceOrInsert(it)
}
```

Multiple goroutines may hold `RLock()` at once. As soon as one goroutine calls `Lock()` for a write, new readers wait and the writer waits for existing readers to finish.

`RWMutex` is *not* free: its read path is a bit slower than `Mutex`, and on heavily contended hot keys it can perform worse. Benchmark first. For the rest of this file we will assume `RWMutex` is fine.

### Why the next level is harder

Suppose you have 64 CPU cores and 99%-reader traffic. With `RWMutex`, all 64 cores can read concurrently — until a writer arrives. Then everything stalls. If writes are 1% of the workload, that is still hundreds of stalls per second.

The next steps are about **letting writers and readers overlap** safely:

- **Hand-over-hand (lock-coupling):** lock only the path you are walking, releasing the parent as soon as the child is safely locked.
- **Optimistic concurrency:** readers do not lock at all; they read, then check a version counter to confirm the data did not change underneath them.
- **Copy-on-write (COW):** every writer produces a brand-new tree; readers see the old immutable snapshot. Common in `google/btree` and `tidwall/btree`.
- **RCU:** writers replace pointers atomically while readers proceed unaware; old memory is freed only after all readers that could see it have finished.

These are middle, senior, and professional material. For now, return to the safe defaults: one `Mutex` or one `RWMutex`, and a real B-tree library.

---

## Why Not Just Use a `map`?

It is fair to ask: when is `map[K]V + sync.RWMutex` enough? The answer:

- You do **not** need ordering, range scans, or "next greater key."
- You do **not** need iteration in sorted order.
- You do **not** need to maintain insertion order (use `slice` for that).

If none of those apply, a `sync.Map` or a guarded `map` is simpler, faster, and uses less memory than any tree. Reach for a tree the moment you need ordered access. Reach for `sync.Map` when reads vastly outnumber writes and you do not need ordering.

A quick decision table:

| Need | Pick |
|------|-----|
| Unordered, mostly-static keys, high-read | `sync.Map` |
| Unordered, mixed read/write | `map` + `sync.RWMutex` |
| Ordered iteration, range scans | `google/btree` + `sync.RWMutex` |
| Ordered with frequent COW snapshots | `tidwall/btree` |
| On-disk persistence, ordered | `bbolt`, `BadgerDB`, `LMDB` |

---

## Real-World Analogies

**A library card catalog.** Hash maps are like a bag of cards: you can find one if you have the exact title, but you cannot ask "show me everything starting with M." A tree is the catalog itself — drawers sorted by author, then by title. Range queries are natural; ordering is preserved.

**A phone book.** Names sorted alphabetically. Finding "Smith" is fast (you flip to the S section, then narrow down). Finding "all names starting with Sm" is also fast. A tree behaves the same way.

**The TOC of a giant manual.** When you go to a 1000-page reference, you do not scan page 1 to find chapter 7. You look at the table of contents (the top of the tree), find the right section (an internal node), then find the right subsection (a deeper internal node), and only then read the page (a leaf). Each lookup is `O(log n)`.

**A locked filing cabinet shared by clerks.** The first concurrent version is "only one clerk in the room at a time" — a single mutex. The second is "many clerks can read at once but only one may write" — a reader/writer mutex. The third is "each clerk locks only the drawer they are using" — hand-over-hand locking. The fourth is "each clerk takes a photocopy and writes on that; the original stays untouched" — copy-on-write. Concurrent trees evolve along the same path.

---

## Mental Models

**Model 1: a tree is a sorted index.**
Stop thinking of trees as "nodes and pointers" and start thinking of them as a sorted index over your data. Every operation — insert, delete, lookup, range scan, predecessor, successor — is a query on that sorted index. The tree structure is just a way to make those queries fast.

**Model 2: a B-tree is a `[]Page` of small sorted arrays glued together by routing keys.**
Each B-tree node is a sorted array. Internal nodes route you to the right child based on key comparisons. Leaves hold the actual data (in a B+-tree) or all entries (in a B-tree). Insertion that overflows a node *splits* it; deletion that underflows a node *merges* it with a sibling.

**Model 3: concurrency on a tree is concurrency on a graph.**
Locking a tree is not like locking a slice. You may need to lock the path you walk, not the whole structure. The hierarchy of locks (root first, then child, then grandchild) matches the structural hierarchy of the tree itself. This is what makes hand-over-hand locking natural.

**Model 4: most reads do not need to wait for writes — they need a stable snapshot.**
Almost all the cleverness in advanced concurrent trees comes from the realization that a reader does not need a fresh, just-written view of the data; it needs a *consistent* view. Copy-on-write, RCU, and MVCC all give readers a consistent snapshot without making them wait for writers.

---

## Pros and Cons

### Pros

- **Ordered access:** range scans, predecessor, successor, min, max.
- **Predictable performance:** `O(log n)` for all single-key operations, no amortized resize hiccups (a `map` resizes in `O(n)`).
- **Range-based deletion** and iteration are natural.
- **Composable with persistent storage:** the same B-tree shape works on-disk in BoltDB, BadgerDB, LMDB, SQLite, Postgres.
- **Memory locality** when fanout is large: a 64-key node uses one or two cache lines.

### Cons

- **More complex than a `map`.** Every operation is recursive and balanced.
- **Slower single-key lookups** than a hash map when ordering is unnecessary.
- **Concurrent versions are hard.** A single-lock tree is easy; anything beyond that requires careful protocol design.
- **GC pressure** if you allocate per-key node objects (a Go-idiomatic B-tree with slice-backed nodes mitigates this).
- **Memory overhead** from internal nodes that hold only routing keys, not data.

---

## Use Cases

- **In-memory sorted indexes** for a microservice: latest 1000 events by timestamp.
- **Range queries** in admin tools: "all users created between 2024-01-01 and 2024-06-30."
- **Cursor-based pagination** that needs `WHERE id > last_id ORDER BY id LIMIT 100`.
- **Auto-complete** with prefix scans (using a `string` key and a B-tree).
- **Time-series buffers** that accept inserts and stream out in order.
- **Priority queues with mutations.** A heap is faster for fixed priorities, but a tree lets you `Update(key, newPriority)` cheaply.
- **Schedulers** that need "next deadline" in `O(log n)`.

---

## Code Examples

### Example 1: starting with `google/btree`

`github.com/google/btree` is the simplest, most idiomatic in-memory B-tree in Go.

```go
package main

import (
    "fmt"

    "github.com/google/btree"
)

type Item struct {
    Key   int
    Value string
}

// Less implements btree.Item via the BTreeG[Item] generic API.
func (a Item) Less(b Item) bool { return a.Key < b.Key }

func main() {
    // Degree 32: each node holds up to 63 items, has up to 64 children.
    tr := btree.NewG[Item](32, func(a, b Item) bool { return a.Less(b) })

    tr.ReplaceOrInsert(Item{Key: 10, Value: "ten"})
    tr.ReplaceOrInsert(Item{Key: 1, Value: "one"})
    tr.ReplaceOrInsert(Item{Key: 5, Value: "five"})

    // Lookup
    if v, ok := tr.Get(Item{Key: 5}); ok {
        fmt.Println("got", v.Value) // got five
    }

    // Ordered iteration
    tr.Ascend(func(it Item) bool {
        fmt.Println(it.Key, it.Value)
        return true
    })
    // 1 one
    // 5 five
    // 10 ten

    // Range scan
    tr.AscendRange(Item{Key: 2}, Item{Key: 10}, func(it Item) bool {
        fmt.Println("in range", it.Key)
        return true
    })
    // in range 5
}
```

`btree.NewG[T]` is the generic constructor. The argument `32` is the *degree*; the package documents it as "minimum degree," which means each non-root node has between `degree-1` and `2*degree-1` items. Higher degree means flatter tree, more in-node comparisons, better cache behavior.

**This `btree.BTreeG` is not safe for concurrent writers.** Reading the doc carefully: "Write operations are not safe for concurrent mutation by multiple goroutines, but Read operations are." That is a very specific promise: a goroutine that only calls `Get`, `Ascend`, etc., does not need to lock — *as long as no writer is active*. We must enforce that separation with our own locks.

### Example 2: wrap it in `sync.RWMutex`

```go
package safetree

import (
    "sync"

    "github.com/google/btree"
)

type Item struct {
    Key   int
    Value string
}

type Tree struct {
    mu sync.RWMutex
    bt *btree.BTreeG[Item]
}

func New(degree int) *Tree {
    return &Tree{
        bt: btree.NewG[Item](degree, func(a, b Item) bool { return a.Key < b.Key }),
    }
}

func (t *Tree) Set(it Item) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.bt.ReplaceOrInsert(it)
}

func (t *Tree) Get(key int) (Item, bool) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    return t.bt.Get(Item{Key: key})
}

func (t *Tree) Delete(key int) (Item, bool) {
    t.mu.Lock()
    defer t.mu.Unlock()
    return t.bt.Delete(Item{Key: key})
}

func (t *Tree) Len() int {
    t.mu.RLock()
    defer t.mu.RUnlock()
    return t.bt.Len()
}

// Range iterates [lo, hi). The callback returns false to stop early.
// Note: the callback runs WHILE we hold the read lock. Do not call
// back into the tree from it.
func (t *Tree) Range(lo, hi int, fn func(Item) bool) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    t.bt.AscendRange(Item{Key: lo}, Item{Key: hi}, fn)
}
```

This is the standard, safe, junior-level concurrent tree in Go. It does not scale to dozens of cores under write contention, but it never corrupts, and the read path is genuinely concurrent.

### Example 3: a quick benchmark of the safe wrapper

```go
package safetree_test

import (
    "math/rand"
    "sync"
    "testing"
)

func BenchmarkTreeReadHeavy(b *testing.B) {
    tr := New(32)
    for i := 0; i < 10_000; i++ {
        tr.Set(Item{Key: i, Value: "x"})
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            tr.Get(r.Intn(10_000))
        }
    })
}

func BenchmarkTreeMixed(b *testing.B) {
    tr := New(32)
    var wg sync.WaitGroup
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            k := r.Intn(10_000)
            if r.Intn(10) == 0 {
                tr.Set(Item{Key: k, Value: "x"})
            } else {
                tr.Get(k)
            }
        }
    })
    wg.Wait()
}
```

Run with:

```
go test -bench=. -benchmem -cpu=1,2,4,8
```

You will see the read-heavy benchmark scale roughly linearly until the write benchmark hits the writer-exclusive bottleneck. That gap is exactly what middle-level techniques (hand-over-hand, COW, RCU) aim to close.

### Example 4: range scan in a real product

A typical use case: an in-memory store of recent log lines, keyed by timestamp, served to a debugging UI:

```go
type LogLine struct {
    TSNanos int64
    Line    string
}

type LogIndex struct {
    mu sync.RWMutex
    bt *btree.BTreeG[LogLine]
}

func NewLogIndex() *LogIndex {
    return &LogIndex{
        bt: btree.NewG[LogLine](64, func(a, b LogLine) bool {
            return a.TSNanos < b.TSNanos
        }),
    }
}

func (li *LogIndex) Append(line string, tsNanos int64) {
    li.mu.Lock()
    defer li.mu.Unlock()
    li.bt.ReplaceOrInsert(LogLine{TSNanos: tsNanos, Line: line})
}

// Tail returns the most recent N lines in chronological order.
func (li *LogIndex) Tail(n int) []LogLine {
    li.mu.RLock()
    defer li.mu.RUnlock()
    out := make([]LogLine, 0, n)
    li.bt.Descend(func(l LogLine) bool {
        out = append(out, l)
        return len(out) < n
    })
    // Reverse for chronological order.
    for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
        out[i], out[j] = out[j], out[i]
    }
    return out
}

// Between returns lines with timestamps in [lo, hi).
func (li *LogIndex) Between(loNanos, hiNanos int64) []LogLine {
    li.mu.RLock()
    defer li.mu.RUnlock()
    var out []LogLine
    li.bt.AscendRange(
        LogLine{TSNanos: loNanos},
        LogLine{TSNanos: hiNanos},
        func(l LogLine) bool { out = append(out, l); return true },
    )
    return out
}
```

A real implementation would also bound the index size (drop entries older than `now - 1h`), which a tree handles naturally via `AscendLessThan(cutoff, ...)` + `Delete`.

### Example 5: `tidwall/btree` for generic, snapshot-friendly use

`github.com/tidwall/btree` is a competing library with one big extra feature: cheap *copy-on-write snapshots*.

```go
package main

import (
    "fmt"

    "github.com/tidwall/btree"
)

type Item struct {
    Key   string
    Value int
}

func less(a, b Item) bool { return a.Key < b.Key }

func main() {
    tr := btree.NewBTreeG[Item](less)

    tr.Set(Item{Key: "a", Value: 1})
    tr.Set(Item{Key: "b", Value: 2})

    // O(1) snapshot. Both 'tr' and 'snap' can mutate independently
    // — internal nodes are shared and copied on write.
    snap := tr.Copy()

    tr.Set(Item{Key: "c", Value: 3})

    fmt.Println(tr.Len())   // 3
    fmt.Println(snap.Len()) // 2

    snap.Set(Item{Key: "x", Value: 99})
    if _, ok := tr.Get(Item{Key: "x"}); !ok {
        fmt.Println("tr does not see snapshot mutations")
    }
}
```

That `Copy()` returns in `O(1)` — it just bumps a reference count on the root. The trees diverge as either side writes. This is **persistent data structure** territory and you will meet it again in the middle and senior files. For now: know it exists, and that for snapshot-heavy workloads `tidwall/btree` may be a better fit than `google/btree`.

`tidwall/btree` also offers `btree.BTreeG[T]` with a `Less` function, and a `Hint`-based fast path for repeated nearby accesses. The package documentation is excellent and worth reading end-to-end before you commit to a choice.

### Example 6: detecting the bug yourself

To convince yourself you really do need locks, here is a tiny program that breaks a `google/btree` under concurrent writes:

```go
package main

import (
    "fmt"
    "sync"

    "github.com/google/btree"
)

type Item struct{ K int }

func less(a, b Item) bool { return a.K < b.K }

func main() {
    tr := btree.NewG[Item](16, less)
    var wg sync.WaitGroup
    for w := 0; w < 4; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for i := 0; i < 50_000; i++ {
                tr.ReplaceOrInsert(Item{K: seed*100_000 + i})
            }
        }(w)
    }
    wg.Wait()
    fmt.Println("len:", tr.Len()) // often much less than 200_000, or panic
}
```

Run it under `go run -race main.go`. The race detector will scream about concurrent writes to the same B-tree nodes. Drop the `-race` and run it many times — you will see crashes, panics, or wildly wrong `Len()` values. Wrapping every call in a single `sync.Mutex` makes the program correct.

### Example 7: comparing `map+RWMutex` to `btree+RWMutex` for read latency

When ordering is *not* required, a `map` is strictly faster. The point of using a tree is the ordered operations. Here is a tiny benchmark sketch:

```go
func BenchmarkMapGet(b *testing.B) {
    m := make(map[int]string)
    var mu sync.RWMutex
    for i := 0; i < 10_000; i++ {
        m[i] = "x"
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            mu.RLock()
            _ = m[i%10_000]
            mu.RUnlock()
            i++
        }
    })
}
```

You will typically see `map` reads at 2–4x the throughput of `btree` reads. Trees pay for ordering. Use them when you need it; use a `map` when you do not.

### Example 8: avoid leaking the iteration callback

A common junior mistake is to forget that the iteration callback runs *while holding the read lock*:

```go
// BAD: deadlock waiting to happen.
func (li *LogIndex) PrintAll(fn func(LogLine)) {
    li.mu.RLock()
    defer li.mu.RUnlock()
    li.bt.Ascend(func(l LogLine) bool {
        fn(l)            // user-supplied! Could call back into LogIndex!
        return true
    })
}
```

If `fn` calls `li.Append(...)`, the goroutine deadlocks: it is trying to take the write lock while holding the read lock. The fix is either:

1. Collect into a slice under the lock, then call `fn` outside:

   ```go
   func (li *LogIndex) PrintAll(fn func(LogLine)) {
       li.mu.RLock()
       var snapshot []LogLine
       li.bt.Ascend(func(l LogLine) bool {
           snapshot = append(snapshot, l)
           return true
       })
       li.mu.RUnlock()
       for _, l := range snapshot {
           fn(l)
       }
   }
   ```

2. Or document loudly that callbacks must not re-enter the tree.

Almost every junior-level bug with concurrent trees is some variant of "I called something inside the lock that took the lock again."

---

## Coding Patterns

**Pattern 1: one struct, one mutex, all methods take the lock.**
The simplest concurrent tree exports only methods on a struct. Direct access to the underlying `*btree.BTreeG` is hidden. This makes the locking discipline a property of the *type*, not of every caller.

**Pattern 2: read methods take `RLock`, mutation methods take `Lock`.**
Be strict. A method that *might* mutate must take `Lock`. Conditional logic ("only lock if we are about to write") is a deadlock waiting to happen — use `Lock` always for mutators.

**Pattern 3: return slices from range queries, not iterators.**
Resist the temptation to return a `chan Item` or a callback-style iterator. Both surface the lock to the caller. Materialize a `[]Item` under the lock and return it. Pay the allocation; keep the API safe.

**Pattern 4: use COW snapshots for read-heavy "long" queries.**
If a query takes seconds (a full export, a backup, a JSON dump), do not hold the read lock that long — switch to `tidwall/btree` and `Copy()` the tree, then dump from the snapshot.

**Pattern 5: split the tree by shard for write throughput.**
A simple, scalable trick: maintain `N` independent trees keyed by `hash(key) % N` and have one mutex per shard. Reads to disjoint shards never contend. Writes to disjoint shards never contend. This is "poor man's hand-over-hand," and it works astonishingly well.

```go
type ShardedTree struct {
    shards [16]*Tree
}

func NewSharded() *ShardedTree {
    var s ShardedTree
    for i := range s.shards {
        s.shards[i] = New(32)
    }
    return &s
}

func (s *ShardedTree) shard(k int) *Tree { return s.shards[uint(k)%16] }
func (s *ShardedTree) Set(it Item)        { s.shard(it.Key).Set(it) }
func (s *ShardedTree) Get(k int) (Item, bool) { return s.shard(k).Get(k) }
```

The downside: range queries that span shards must visit them all and merge. If range queries matter, use one tree.

---

## Clean Code

- **Name the type after the *purpose*, not the data structure.** `LogIndex`, `EventQueue`, `RouteTable` — not `BTreeWrapper`.
- **Hide the library choice.** Do not expose `*btree.BTreeG[Item]` in your public API. If you later switch from `google/btree` to `tidwall/btree`, callers must not have to change.
- **Group every lock with a comment explaining the invariant.**

  ```go
  // mu protects bt and len.
  // Always take mu before reading or writing either field.
  mu  sync.RWMutex
  bt  *btree.BTreeG[Item]
  len int // duplicated for O(1) Len() without lock — wait, no: see Len() below.
  ```

- **Prefer immutable items.** If `Item` has mutable fields and you mutate one *outside* the tree, you have invented a race that the tree cannot help you with. Treat items in the tree as immutable; produce a new item to update.
- **Define `Less` once and document it.** A subtle bug source: two libraries with slightly different `Less` semantics on `nil` items, or `Less` that is not a strict weak order (e.g., `<=` instead of `<`).

---

## Product Use

A common shape in real Go services:

- **`MetricsBuffer`** — a B-tree of `(timestamp, metricID)` for a 5-minute sliding window of in-memory observations. Background goroutine evicts entries older than the window. `Mutex`-protected.
- **`SessionStore`** — a B-tree keyed by `(userID, sessionID)` so all sessions of a user can be enumerated. `RWMutex`-protected.
- **`AuditLogTail`** — a B-tree of recent audit events, served via an admin UI that wants `last 1000` or `last hour`.
- **`Scheduler`** — a B-tree keyed by next deadline. Workers `Min()` it, take the next item, and run.
- **`OrderBook`** — a financial trading order book is two B-trees: bids and asks. Hand-over-hand or sharded locking when latency matters.

In every case the rule is the same: start with one mutex and a `google/btree`. Profile. Only graduate to more advanced techniques once you can prove the lock is your bottleneck.

---

## Error Handling

Tree operations rarely *fail* — they succeed or report "not found." But there are a few error-shaped concerns:

- **`Get` returning a zero value.** `btree.BTreeG[T].Get` returns `(T, bool)`. Always check the bool. A zero-valued `Item{Key: 0}` looks like a real item.
- **Iteration callbacks that panic.** A panic inside an `Ascend` callback unwinds through the tree's iteration code. With `google/btree` this is safe — but you may still hold the mutex when the panic propagates out of your method, which is fine if you used `defer Unlock()`. If you forgot `defer`, the panic permanently locks the tree.
- **Out-of-memory.** A 10-million-entry tree of `Item{Value string}` uses several hundred MB. Bound the size or evict.
- **Stale iterators.** `google/btree` returns no iterator object — only callbacks — so this is less of a concern than in C++ STL maps. Good.

---

## Security Considerations

- **Untrusted keys.** If the keys come from user input, an attacker may craft inputs designed to cause hash collisions or pathological balancing. A balanced B-tree is robust here (every operation is `O(log n)` regardless of key distribution), but you should still bound the *total* number of keys an attacker can insert.
- **Range scan as a denial-of-service vector.** `AscendRange(0, MaxInt)` on a 10-million-entry tree under a single read lock will block writers for a long time. Always bound page size in user-facing APIs.
- **Sensitive values.** If items contain secrets, prefer `[]byte` you can `zero` after use rather than `string` (strings cannot be wiped because Go interns / shares them).
- **Snapshots and disclosure.** A COW snapshot of the tree retains a reference to every key and value visible at snapshot time, preventing them from being GC'd. If those entries contain secrets, the snapshot is also sensitive.

---

## Performance Tips

- **Choose the right degree.** For `google/btree`, degree 32 to 64 is a good default for in-memory use. Higher degrees flatten the tree (good) but make per-node scans longer (sometimes bad).
- **Avoid pointer-heavy item types.** A B-tree of `Item{Key int; Value string}` keeps everything inline. A B-tree of `Item{Key int; Value *BigStruct}` chases a pointer on every visit.
- **Pre-size on bulk load.** If you can sort your data first and insert in order, both `google/btree` and `tidwall/btree` accept that gracefully and build a compact tree.
- **Avoid `Len()` if you do not need it.** It is `O(1)` in both libraries (they cache the count), but every method call is at minimum a mutex acquisition.
- **Avoid creating throwaway items for lookups.** `tr.Get(Item{Key: 5})` allocates if `Item` is a large struct. Use a tiny key-only struct or a custom `Less` that ignores everything except the key.
- **Profile before sharding.** "Add a mutex per shard" is the most over-applied advice in concurrent Go. Most workloads are not write-bound enough to justify it.

---

## Best Practices

- Default to **one mutex per tree**. Add complexity only if profiling shows the lock is hot.
- Default to **`RWMutex` if reads outnumber writes by 5x or more**, `Mutex` otherwise.
- Never expose the underlying `*btree.BTreeG` outside its owning type.
- Always validate `Less` is a strict weak order. Reflexivity (`Less(a, a) == false`) and asymmetry (`Less(a,b) && !Less(b,a)`) matter.
- Document the iteration contract: "callback runs while the tree is locked; do not re-enter."
- Run the race detector in CI: `go test -race ./...`.
- Treat tree items as immutable. Replace, do not mutate.
- For high snapshot churn, prefer `tidwall/btree`. For simple sorted in-memory state, prefer `google/btree`.

---

## Edge Cases and Pitfalls

- **Inserting an item that already exists.** Both libraries' `ReplaceOrInsert` / `Set` overwrite by key. If you want "insert if absent," check with `Get` first — but doing so without holding the lock between `Get` and `Set` races. Do it under one acquisition.
- **Deleting during iteration.** Most B-tree iterators are not safe against in-flight mutations. Buffer the keys to delete, then delete after the iteration returns.
- **`Less` panics.** A `Less` that does `nil` pointer dereferences will panic *inside* the tree, leaving the tree in an unknown state. Make `Less` total.
- **A `Min()` on an empty tree.** Returns the zero value with `ok=false` in `google/btree`. Do not forget the `ok`.
- **A tree of float keys with `NaN`.** `NaN < NaN` is false, so `Less` is not a strict weak order if you allow `NaN`. Reject `NaN` on insert.
- **Long-running iteration callbacks.** The lock is held the whole time. A 10-second callback blocks all writers for 10 seconds.
- **Snapshot fan-out.** `tidwall/btree.Copy()` is cheap, but each unique snapshot retains its diverged subtree. Holding 1000 snapshots costs.

---

## Common Mistakes

1. **Sharing a `google/btree` directly between goroutines.** It is *not* safe for concurrent writes. Always wrap.
2. **Using `RWMutex` when writes dominate.** The reader/writer machinery is slightly slower than `Mutex`. If writes are 50% of operations, plain `Mutex` is faster.
3. **Returning a callback iterator that holds the lock.** Caller deadlocks the moment they call back into the tree.
4. **Forgetting to defer Unlock.** A panic mid-method leaves the tree locked forever.
5. **Comparing keys with `==` when you defined a custom `Less`.** They must agree: `a == b` iff `!Less(a,b) && !Less(b,a)`.
6. **Spawning a goroutine inside a method that holds the lock and waiting for it.** The goroutine cannot acquire the same lock — deadlock.
7. **Assuming `Len()` is free.** It is fast, but it still takes the lock.
8. **Storing pointers to items returned from the tree and mutating them.** You have mutated the tree's internal state.
9. **Using a B-tree when a hash map would do.** Slower, more memory, more complex. Use the right tool.
10. **Building one tree per request.** A tree is meant to live for the process lifetime. Per-request allocation defeats the cache locality.

---

## Common Misconceptions

- *"B-trees are only for disk."* No. They are excellent in-memory structures because they are cache-friendly.
- *"A `sync.Map` is always faster than a tree."* No. `sync.Map` is optimized for "many keys, mostly written once, read many times." It is not faster than a guarded `map` or tree for general workloads.
- *"My read lock means I am safe to mutate the data items."* Wrong. The lock guards the tree's structure, not the data inside items. Treat items as immutable.
- *"If I use `RWMutex` everywhere, my reads scale linearly."* Only until a writer arrives. Writers force all readers to wait, and all subsequent readers wait too.
- *"Copy-on-write is free."* It is `O(1)` per snapshot, but writes after a snapshot are slower (they may have to clone a path).
- *"`google/btree` and `tidwall/btree` are interchangeable."* The APIs are similar; the trade-offs differ. `tidwall/btree` shines for snapshots; `google/btree` for raw lookup speed.
- *"A balanced tree is always faster than a slice for small N."* No. For N < ~50, a sorted slice with binary search is often faster than any tree, especially in cache misses.

---

## Tricky Points

- **`Less` total order.** `Less(a,b) || Less(b,a) || a == b` must hold. NaN floats break this.
- **Race between snapshot and write.** In `tidwall/btree`, taking `Copy()` while a writer is mid-`Set` is safe only if both happen under your own external lock. The library does not provide thread-safety on its own.
- **Iteration "stop early" semantics.** `Ascend(fn)` keeps calling `fn` while it returns `true`. Returning `false` stops. Reversing this convention is a bug.
- **`Min` and `Max` on a single-element tree.** Both return the same item. Make sure your callers handle that.
- **Empty range queries.** `AscendRange(5, 5)` returns nothing because the range is half-open `[5, 5) = {}`.
- **Modifying the key of an item already in the tree.** Even outside the tree, if your `Less` reads `Item.Key`, mutating it corrupts ordering. Always remove, mutate, re-insert.

---

## Test

```go
package safetree_test

import (
    "sync"
    "testing"

    "example.com/safetree"
)

func TestBasic(t *testing.T) {
    tr := safetree.New(8)
    tr.Set(safetree.Item{Key: 1, Value: "one"})
    tr.Set(safetree.Item{Key: 2, Value: "two"})
    if it, ok := tr.Get(1); !ok || it.Value != "one" {
        t.Fatalf("get(1) = %+v, %v", it, ok)
    }
    if tr.Len() != 2 {
        t.Fatalf("len = %d", tr.Len())
    }
}

func TestRange(t *testing.T) {
    tr := safetree.New(8)
    for i := 0; i < 100; i++ {
        tr.Set(safetree.Item{Key: i})
    }
    var got []int
    tr.Range(10, 20, func(it safetree.Item) bool {
        got = append(got, it.Key)
        return true
    })
    if len(got) != 10 || got[0] != 10 || got[9] != 19 {
        t.Fatalf("range = %v", got)
    }
}

func TestConcurrent(t *testing.T) {
    tr := safetree.New(32)
    var wg sync.WaitGroup
    const writers = 8
    const perWriter = 10_000
    for w := 0; w < writers; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for i := 0; i < perWriter; i++ {
                tr.Set(safetree.Item{Key: seed*perWriter + i})
            }
        }(w)
    }
    // Concurrent readers
    for r := 0; r < 4; r++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < 50_000; i++ {
                tr.Get(i % 1000)
            }
        }()
    }
    wg.Wait()
    if tr.Len() != writers*perWriter {
        t.Fatalf("len = %d, want %d", tr.Len(), writers*perWriter)
    }
}
```

Run with `go test -race`. The test passes only if the wrapper's locks are correct.

---

## Tricky Questions

**Q1.** What does `tr.AscendRange(Item{Key: 5}, Item{Key: 5}, ...)` return?
A. Nothing — `AscendRange(lo, hi, ...)` is a half-open `[lo, hi)` interval, so `[5,5)` is empty.

**Q2.** If two goroutines both call `tr.Set` on the same key, who wins?
A. The last one to acquire the write lock — both succeed, but only the second's value remains in the tree.

**Q3.** Is `tr.Len()` `O(1)` or `O(n)`?
A. `O(1)` for both `google/btree` and `tidwall/btree`. They cache the count.

**Q4.** Can two goroutines hold `RLock()` and both iterate the tree at the same time?
A. Yes, that is the whole point of `RWMutex`. As long as no writer holds `Lock`, any number of readers may proceed.

**Q5.** I want "insert if absent." How do I do that race-free?
A. Acquire the write lock, then `if _, ok := bt.Get(item); !ok { bt.ReplaceOrInsert(item) }`, then unlock. A `Get` followed by a `Set` under separate lock acquisitions is a race.

**Q6.** My write throughput is too low — should I switch to a lock-free tree?
A. No. First, profile. Then try sharding (multiple trees, one lock each). Then try `RWMutex` if reads dominate. Then consider COW. Only after all that should you reach for hand-over-hand or RCU.

**Q7.** Does `tidwall/btree.Copy()` really run in `O(1)`?
A. Yes — it bumps a reference count on the root node. The cost is paid lazily on the first subsequent write to either tree, which may have to clone one root-to-leaf path.

**Q8.** Why is `google/btree.BTreeG` documented as "read operations are safe for concurrent use" but "write operations are not"? Surely a read while a write is in progress is unsafe?
A. Yes. The docs mean: reads are safe with reads; writes are not safe with anything else. You still need a `RWMutex`.

**Q9.** I have 200 million entries. Is a B-tree the right call?
A. For in-memory, yes — but ensure your machine has enough RAM (`~100 bytes per entry` is a fair rough estimate; multiply). For on-disk, look at BoltDB / BadgerDB / LMDB.

**Q10.** Should I use a B-tree or a skip list for an in-memory ordered index?
A. They are competitive. Skip lists are easier to make concurrent (each node has independent forward pointers). B-trees are more cache-friendly and faster in single-threaded benchmarks. Both are fine choices.

---

## Cheat Sheet

| Operation | `google/btree` (`BTreeG[T]`) | `tidwall/btree` (`BTreeG[T]`) | Concurrent? |
|-----------|------------------------------|--------------------------------|-------------|
| Construct | `btree.NewG[T](degree, less)` | `btree.NewBTreeG[T](less)` | n/a |
| Insert / Set | `tr.ReplaceOrInsert(it)` | `tr.Set(it)` | external lock |
| Get | `tr.Get(key) (T, bool)` | `tr.Get(key) (T, bool)` | external lock |
| Delete | `tr.Delete(key)` | `tr.Delete(key)` | external lock |
| Iterate all | `tr.Ascend(fn)` | `tr.Scan(fn)` | external lock |
| Range scan | `tr.AscendRange(lo, hi, fn)` | `tr.Ascend(pivot, fn)` | external lock |
| Min / Max | `tr.Min()` / `tr.Max()` | `tr.Min()` / `tr.Max()` | external lock |
| Length | `tr.Len()` | `tr.Len()` | external lock |
| Snapshot | n/a (do a `Clone()`) | `tr.Copy()` (`O(1)`) | external lock |

Defaults:

| Workload | Recommended |
|----------|-------------|
| Pure read | `RWMutex` |
| Read-heavy with rare writes | `RWMutex` |
| Mixed read/write | `Mutex` |
| Snapshot-heavy | `tidwall/btree` + `Mutex` |
| Sharded writes | `[N]*Tree` + `[N]Mutex` |

---

## Self-Assessment Checklist

You are ready to move to `middle.md` when you can:

- [ ] Explain in one sentence what an ordered search tree is.
- [ ] Draw a B-tree of degree 3 holding 10 random keys.
- [ ] Explain why `map + RWMutex` is wrong when you need range queries.
- [ ] Write a `Mutex`-protected wrapper around `google/btree`.
- [ ] Decide between `Mutex` and `RWMutex` based on read/write ratio.
- [ ] Spot the "callback re-enters the tree" deadlock in code review.
- [ ] Run `go test -race` on a concurrent tree test and interpret the output.
- [ ] Recognize when sharding will help and when it will not.
- [ ] Name three alternatives the middle file will explore.
- [ ] Explain why `Less` must be a strict weak order.

---

## Summary

A tree is an ordered key–value store. You reach for one when you need range scans, predecessor / successor queries, or sorted iteration — things a hash map cannot give you. In Go, `github.com/google/btree` and `github.com/tidwall/btree` are the two libraries you will almost always pick.

Neither is safe for concurrent writes out of the box. The junior-level fix is the right one for the vast majority of programs: wrap the tree in a struct, put a `sync.Mutex` (or `sync.RWMutex` if reads dominate) inside it, and have every method take the lock. Hide the underlying library type, document the iteration contract, and test with `go test -race`.

From there, advanced techniques — hand-over-hand, optimistic, copy-on-write, RCU, Bw-trees, ART — exist to reduce the time the single lock is held. They are subjects of the middle, senior, and professional files. Master the basics first.

---

## What You Can Build

- A real-time in-memory log tail server with range-by-timestamp queries.
- An admin dashboard backed by a sorted in-memory index of user actions.
- A scheduler that runs the next task by deadline.
- A bounded "recent N events" buffer that supports `since(timestamp)` queries.
- A leader-election helper that orders candidates by priority.
- A simple in-memory key–value store with prefix scan.
- A unit-test fixture that simulates a B-tree-backed index for a database service.

---

## Further Reading

- `github.com/google/btree` — package documentation and source.
- `github.com/tidwall/btree` — package documentation and README.
- *Introduction to Algorithms*, CLRS, Chapter 18 (B-Trees).
- Go blog: "Go maps in action" (for the comparison baseline).
- The `runtime/proc.go` source for how Go schedules many goroutines (helpful context for why "lots of small reads" actually scale).
- The Lehman-Yao 1981 paper *Efficient Locking for Concurrent Operations on B-Trees* (read at middle level — it is short and lovely).
- The Wikipedia entries on AVL trees, red-black trees, B-trees, B+-trees.

---

## Related Topics

- [Concurrent Skip List](../03-concurrent-skip-list/) — the other classic ordered concurrent structure.
- [LRU Concurrent](../02-lru-concurrent/) — caches that need ordered eviction.
- [Copy-on-Write](../05-copy-on-write/) — the technique under `tidwall/btree.Copy()`.
- [`sync.RWMutex`](../../03-sync-package/02-rwmutex/) — the lock you will pair with the tree.
- [Channels](../../02-channels/01-overview/) — an alternative pattern for serializing access (one goroutine owns the tree, others send requests on a channel).

---

## Diagrams and Visual Aids

### A B-tree of degree 3 (max 2 keys per node)

```
                  [ 30 | 60 ]
                 /     |    \
                /      |     \
        [10|20]   [40|50]   [70|80]
```

Each internal node has at most 2 keys and 3 children. Leaves hold values; internal keys are routing markers.

### What happens when a leaf overflows

Before inserting 25 into `[10|20]`:

```
        [ 30 | 60 ]
       /     |    \
  [10|20] [40|50] [70|80]
```

After:

```
        [ 20 | 30 | 60 ]            <- 20 pushed up; root may itself split
       /    |    |    \
   [10] [25]  [40|50] [70|80]
```

Splits propagate upward until a node has room. Concurrent splits without locking corrupt the parent's child array.

### Lock ladder (single mutex vs sharded)

```
Single mutex:                 Sharded:
    goroutines                    goroutines
    | | | | |                     | | | | | | | |
       v                          / | | | | | | \
      [MUTEX]              [M0][M1][M2][M3]...[M15]
       |                    |   |   |   |       |
      [TREE]              [T0][T1][T2][T3]...[T15]
```

The single mutex serializes all access. The sharded layout lets `N` non-colliding operations proceed in parallel.

### Reader/writer lock timing

```
time -->

readers:  R1 ===========>
          R2     ===========>
          R3              =====>
writer:                          W1 ============>
readers:                                          R4 ===>
                                                  R5 ===>
```

Readers may overlap freely. A writer blocks all subsequent readers (and any in-flight reader must finish before the writer gets the lock). After the writer releases, readers may resume.

### Why the next files exist

```
junior:     [one tree] <- [one mutex] <- [all goroutines]
middle:     [one tree] <- [many fine-grained locks one per node]
senior:     [one tree] <- [B-link optimistic + RCU readers]
pro:        [Bw-tree: mapping table + delta chains + epochs]
```

Each step trades complexity for the ability to let writers and readers overlap.

---

## Appendix A: The BST in detail (the bottom of the rabbit hole)

Before B-trees were invented, the standard ordered structure was the binary search tree. Even though you will almost never use a plain BST in production Go (no balancing, terrible cache behaviour, easy to break), understanding one cements all the language you need for everything else.

### The data shape

```go
type BSTNode struct {
    Key   int
    Value string
    Left  *BSTNode
    Right *BSTNode
}

type BST struct {
    root *BSTNode
}
```

That is it. A `BST` is a pointer to a root node, each node holds a key, a value, and two child pointers. The invariant: for every node `n`, every key in `n.Left`'s subtree is `< n.Key`, and every key in `n.Right`'s subtree is `> n.Key`.

### Insert

```go
func (t *BST) Insert(k int, v string) {
    t.root = insert(t.root, k, v)
}

func insert(n *BSTNode, k int, v string) *BSTNode {
    if n == nil {
        return &BSTNode{Key: k, Value: v}
    }
    switch {
    case k < n.Key:
        n.Left = insert(n.Left, k, v)
    case k > n.Key:
        n.Right = insert(n.Right, k, v)
    default:
        n.Value = v // overwrite on equal key
    }
    return n
}
```

This is the **recursive functional pattern**: each call returns a (possibly new) subtree root, and the caller stitches it in. That same shape generalizes to copy-on-write trees in the middle file.

### Lookup

```go
func (t *BST) Get(k int) (string, bool) {
    for n := t.root; n != nil; {
        switch {
        case k < n.Key:
            n = n.Left
        case k > n.Key:
            n = n.Right
        default:
            return n.Value, true
        }
    }
    return "", false
}
```

Iterative; faster than recursive lookup because no function-call overhead. Both are `O(h)` where `h` is height.

### The pathological insert

```go
func main() {
    var t BST
    for i := 1; i <= 1_000_000; i++ {
        t.Insert(i, "x") // keys in sorted order
    }
    // The tree is now a 1,000,000-node linked list.
    // Get(1_000_000) takes 1,000,000 comparisons.
}
```

Inserting in sorted order gives you the worst possible BST: a thin chain. Lookups degrade to `O(n)`. This is why balancing exists.

### Why a balanced BST is hard concurrently

Balancing involves *rotations*. A right rotation around `x`:

```
Before:                 After:
        x                       y
       / \                     / \
      y   C        =>         A   x
     / \                         / \
    A   B                       B   C
```

To do this concurrently, you must lock `x`, `y`, `A`, `B`, `C`, **and** `x`'s parent. Many threads doing many rotations simultaneously can interlock and deadlock unless you have a global lock ordering. This is exactly why B-trees beat balanced BSTs in concurrent workloads: each node holds many keys, so splits and merges happen 1/B as often.

---

## Appendix B: The B-tree in detail

A B-tree of *minimum degree* `t` has:

- Each node holds between `t-1` and `2t-1` keys (so each internal node has between `t` and `2t` children).
- All leaves at the same depth.
- Keys within a node are sorted.
- For an internal node with keys `k1 < k2 < ... < kn` and children `c0, c1, ..., cn`, every key in `c_i` is between `k_i` and `k_{i+1}`.

This is the textbook definition (CLRS chapter 18). `google/btree` uses *exactly* this convention with `BTreeG[T]` constructed via `NewG[T](degree, less)`.

### Walking a B-tree

```go
// Pseudocode using a hypothetical exposed Node type.
func find(n *Node, k Item) (Item, bool) {
    // Binary search inside the node for k.
    i := sort.Search(len(n.items), func(i int) bool {
        return !less(n.items[i], k) // first item >= k
    })
    if i < len(n.items) && !less(k, n.items[i]) {
        return n.items[i], true // exact match
    }
    if n.IsLeaf() {
        return Item{}, false
    }
    return find(n.children[i], k)
}
```

A real B-tree uses linear scan for small nodes (faster than binary search up to ~16 keys because of branch prediction) and binary search above that.

### Insertion: top-down split

The classic algorithm (CLRS): walk down the tree, and *whenever you encounter a full node* (`2t-1` keys), split it preemptively. That guarantees that when you reach the leaf, the parent has room to absorb a key pushed up.

```
Before: parent has room. Child is full [a|b|c|d|e].
Insert into parent:
   - Split child into [a|b] and [d|e], pushing c up.
   - Parent now has c and points to the two halves.
   - Recurse into whichever half holds the key.
```

This is why B-trees never overflow without being noticed: every step down validates the path will accept a split.

### Deletion: bottom-up merge

Deletion is the tricky one. CLRS describes a single-pass top-down algorithm that ensures every node on the path has at least `t` keys (more than the minimum), so deleting from a leaf cannot underflow the parent. Production implementations (including `google/btree`) take various shortcuts because writes are exclusive.

### Concurrency on B-trees: the menu

| Strategy | Idea | Where you'll meet it |
|----------|-----|----------------------|
| Single global lock | `sync.Mutex` around root | this file |
| Reader/writer lock | `sync.RWMutex` | this file |
| Sharding | `N` independent trees | this file |
| Hand-over-hand (lock crabbing) | release parent once child is locked | middle file |
| Optimistic concurrency | read without lock, validate via version | middle file |
| Copy-on-write (functional) | every writer clones the path; readers see immutable old tree | middle file |
| B-link tree (Lehman-Yao) | every node has a right sibling pointer; concurrent splits visible without parent latch | senior file |
| RCU | atomic pointer swap, deferred reclamation | senior file |
| Bw-tree | log-structured + delta chains + mapping table | professional file |

You will recognize each of these names again. For now you only need the first three.

---

## Appendix C: Choosing between `google/btree` and `tidwall/btree`

Both libraries:

- Provide a generic `BTreeG[T]` with a `less func(a, b T) bool`.
- Are pure Go, zero external dependencies.
- Have excellent test suites.
- Are not safe for concurrent writes without external locking.

Differences:

| Feature | `google/btree` | `tidwall/btree` |
|---------|----------------|------------------|
| Snapshot (`Copy`) | Yes (`Clone`) with COW root cloning | Yes (`Copy`) — fully persistent; both halves can mutate |
| Hint-based fast path | No | Yes (`SetHint`, `GetHint`) |
| Iteration shape | Callback style (`Ascend`, etc.) | Both callback (`Scan`) and "iter" object (`Iter`) |
| Tree degree | Configurable at construction | Hardcoded to 32 (with `BTreeGOptions`) |
| Memory layout | Slice-of-items per node | Slice-of-items per node |
| Speed (single-threaded inserts) | Fast | Marginally faster on most benches |
| API stability | Stable since v1 | Stable since v1 |

A short rule:

- **Need ordered map, will lock externally, do not need snapshots.** → `google/btree`.
- **Need ordered map with frequent cheap snapshots.** → `tidwall/btree`.
- **Need on-disk B+-tree.** → `bbolt`, `BadgerDB`, or `LMDB` (out of scope here).

### A side-by-side `Set`/`Get`/`Range` benchmark sketch

```go
package main

import (
    "fmt"
    "math/rand"
    "testing"

    gbt "github.com/google/btree"
    tbt "github.com/tidwall/btree"
)

type item struct{ k int }

func lessG(a, b item) bool { return a.k < b.k }
func lessT(a, b item) bool { return a.k < b.k }

func BenchmarkGoogleSet(b *testing.B) {
    tr := gbt.NewG[item](32, lessG)
    for i := 0; i < b.N; i++ {
        tr.ReplaceOrInsert(item{k: rand.Int()})
    }
}

func BenchmarkTidwallSet(b *testing.B) {
    tr := tbt.NewBTreeG[item](lessT)
    for i := 0; i < b.N; i++ {
        tr.Set(item{k: rand.Int()})
    }
}

func main() {
    res := testing.Benchmark(BenchmarkGoogleSet)
    fmt.Println("google:", res)
    res = testing.Benchmark(BenchmarkTidwallSet)
    fmt.Println("tidwall:", res)
}
```

On most hardware in 2025 the two libraries land within 10% of each other on `Set`. For `Get`, `google/btree` is typically slightly ahead. For `Copy + diverge`, `tidwall/btree` wins decisively. Always benchmark on your real data.

---

## Appendix D: Five extended examples

### D.1 In-memory ordered cache with TTL

```go
package cache

import (
    "sync"
    "time"

    "github.com/google/btree"
)

type Entry struct {
    Key    string
    Value  any
    Expire time.Time
}

func (e Entry) less(b Entry) bool {
    if !e.Expire.Equal(b.Expire) {
        return e.Expire.Before(b.Expire)
    }
    return e.Key < b.Key
}

// Ordered by expiry so we can sweep the oldest in O(log n + k).
type Cache struct {
    mu    sync.Mutex
    byTTL *btree.BTreeG[Entry]
    byKey map[string]Entry
}

func New() *Cache {
    return &Cache{
        byTTL: btree.NewG[Entry](32, func(a, b Entry) bool { return a.less(b) }),
        byKey: make(map[string]Entry),
    }
}

func (c *Cache) Set(k string, v any, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if old, ok := c.byKey[k]; ok {
        c.byTTL.Delete(old)
    }
    e := Entry{Key: k, Value: v, Expire: time.Now().Add(ttl)}
    c.byKey[k] = e
    c.byTTL.ReplaceOrInsert(e)
}

func (c *Cache) Get(k string) (any, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.byKey[k]
    if !ok || time.Now().After(e.Expire) {
        return nil, false
    }
    return e.Value, true
}

// SweepExpired removes all expired entries. Runs in O(k log n) where k is expired count.
func (c *Cache) SweepExpired(now time.Time) int {
    c.mu.Lock()
    defer c.mu.Unlock()
    var toDelete []Entry
    c.byTTL.AscendLessThan(Entry{Expire: now}, func(e Entry) bool {
        toDelete = append(toDelete, e)
        return true
    })
    for _, e := range toDelete {
        c.byTTL.Delete(e)
        delete(c.byKey, e.Key)
    }
    return len(toDelete)
}
```

Two indexes — a `map[string]Entry` for `O(1)` keyed lookup and a B-tree for ordered eviction — combined under one mutex. This pattern is everywhere: every TTL cache, every priority queue with mutations, every LRU-by-time.

### D.2 An audit log with per-tenant scoping

```go
package audit

import (
    "sync"

    "github.com/google/btree"
)

type Event struct {
    Tenant string
    Time   int64
    Body   string
}

func less(a, b Event) bool {
    if a.Tenant != b.Tenant {
        return a.Tenant < b.Tenant
    }
    return a.Time < b.Time
}

type Log struct {
    mu sync.RWMutex
    bt *btree.BTreeG[Event]
}

func New() *Log {
    return &Log{bt: btree.NewG[Event](64, less)}
}

func (l *Log) Append(e Event) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.bt.ReplaceOrInsert(e)
}

// QueryTenant returns events for one tenant between lo and hi (half-open).
func (l *Log) QueryTenant(tenant string, lo, hi int64) []Event {
    l.mu.RLock()
    defer l.mu.RUnlock()
    var out []Event
    l.bt.AscendRange(
        Event{Tenant: tenant, Time: lo},
        Event{Tenant: tenant, Time: hi},
        func(e Event) bool { out = append(out, e); return true },
    )
    return out
}
```

Composite keys `(tenant, time)` and the tree's ordered iteration give you per-tenant range scans for free, *as long as the comparator puts tenant first*. This is the same trick relational databases use with composite indexes.

### D.3 A priority queue you can update

```go
package pq

import (
    "sync"

    "github.com/google/btree"
)

type Task struct {
    ID       string
    Deadline int64
}

func less(a, b Task) bool {
    if a.Deadline != b.Deadline {
        return a.Deadline < b.Deadline
    }
    return a.ID < b.ID
}

type Queue struct {
    mu sync.Mutex
    bt *btree.BTreeG[Task]
    by map[string]Task // ID -> Task for O(log n) "update by ID"
}

func New() *Queue {
    return &Queue{
        bt: btree.NewG[Task](32, less),
        by: make(map[string]Task),
    }
}

func (q *Queue) Push(t Task) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if old, ok := q.by[t.ID]; ok {
        q.bt.Delete(old)
    }
    q.bt.ReplaceOrInsert(t)
    q.by[t.ID] = t
}

func (q *Queue) PopMin() (Task, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    t, ok := q.bt.Min()
    if !ok {
        return Task{}, false
    }
    q.bt.Delete(t)
    delete(q.by, t.ID)
    return t, true
}

func (q *Queue) UpdateDeadline(id string, newDeadline int64) bool {
    q.mu.Lock()
    defer q.mu.Unlock()
    old, ok := q.by[id]
    if !ok {
        return false
    }
    q.bt.Delete(old)
    nt := Task{ID: id, Deadline: newDeadline}
    q.bt.ReplaceOrInsert(nt)
    q.by[id] = nt
    return true
}
```

A binary heap (`container/heap`) is faster for pure push/pop, but does not support `O(log n)` `UpdateDeadline`. The tree-based queue does.

### D.4 A read-replica pattern using a snapshot

```go
package readreplica

import (
    "sync"

    "github.com/tidwall/btree"
)

type Item struct {
    Key   string
    Value string
}

func less(a, b Item) bool { return a.Key < b.Key }

type Store struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot *btree.BTreeG[Item] // read-mostly, swapped atomically by mutex
}

func New() *Store {
    s := &Store{
        live: btree.NewBTreeG[Item](less),
    }
    s.snapshot = s.live.Copy()
    return s
}

func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.live.Set(it)
}

// Publish atomically rotates the snapshot to the latest live tree.
// Call from a background goroutine every N ms or on N writes.
func (s *Store) Publish() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.snapshot = s.live.Copy()
}

// Get reads from the published snapshot — no lock at all on the hot path.
func (s *Store) Get(key string) (Item, bool) {
    s.mu.Lock()
    snap := s.snapshot
    s.mu.Unlock()
    return snap.Get(Item{Key: key})
}
```

This is the seed of **MVCC**: writers update a "live" tree, readers see a published snapshot. Even this junior-level version eliminates reader-writer contention almost entirely. You will see it generalized in the senior file.

### D.5 A safer wrapper that exposes a `Snapshot()`

```go
package safetree

import (
    "sync"

    "github.com/tidwall/btree"
)

type Item struct {
    Key int
    Val string
}

func less(a, b Item) bool { return a.Key < b.Key }

type Tree struct {
    mu sync.Mutex
    bt *btree.BTreeG[Item]
}

func New() *Tree {
    return &Tree{bt: btree.NewBTreeG[Item](less)}
}

func (t *Tree) Set(it Item) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.bt.Set(it)
}

func (t *Tree) Get(k int) (Item, bool) {
    t.mu.Lock()
    defer t.mu.Unlock()
    return t.bt.Get(Item{Key: k})
}

// Snapshot returns an immutable read-only view that does not hold the lock.
// Cheap (O(1)) and safe to share across goroutines.
type Snapshot struct{ bt *btree.BTreeG[Item] }

func (t *Tree) Snapshot() *Snapshot {
    t.mu.Lock()
    defer t.mu.Unlock()
    return &Snapshot{bt: t.bt.Copy()}
}

func (s *Snapshot) Get(k int) (Item, bool)      { return s.bt.Get(Item{Key: k}) }
func (s *Snapshot) Range(lo, hi int, fn func(Item) bool) {
    s.bt.Ascend(Item{Key: lo}, func(it Item) bool {
        if it.Key >= hi {
            return false
        }
        return fn(it)
    })
}
```

The `Snapshot` is a separate type, owned by whoever called `Snapshot()`. Its methods take no lock. The tree can keep churning while the caller iterates the snapshot at leisure.

---

## Appendix E: Walking through a real `google/btree` source snippet

It is worth opening the `google/btree` repo and reading `btree.go` once. About 1000 lines, very readable. Key takeaways:

- Each `node` is a `items []Item` slice plus a `children []*node` slice. Both are sized at `2*degree`.
- `node.insertItemAt(index, item)` shifts the slice — `O(degree)` but excellent cache behavior.
- `node.split(i)` splits a full child of `n.children[i]` into two and pushes the median up. Same pattern as CLRS.
- The `BTree` itself just holds a `root *node` and a `length int`.

There is **no locking** in the source. The contract is: do not call mutating methods concurrently. That contract is exactly what we encode with our `sync.Mutex`.

---

## Appendix F: When you should *not* use a tree

A few situations where a tree is the wrong default:

- **You have only a handful of items (< ~50).** A sorted `[]Item` with `sort.Search` beats every tree on cache behavior. Concurrency? `sync.Mutex` + copy on every change is fine for that size.
- **Your keys are integers in a small bounded range.** A `[]Value` indexed by key is `O(1)` and unbeatable.
- **Your access pattern is "iterate everything in insertion order."** A `[]Item` is right. Use a tree only if order *by key* matters.
- **You need radix / prefix lookup on strings with shared prefixes.** Use a trie or ART, not a B-tree. The middle file covers ART.
- **You need on-disk persistence.** Skip in-memory libraries entirely and use bbolt or BadgerDB.

---

## Appendix G: A glossary of confusing terms

| Term | Meaning |
|------|---------|
| **Latch vs lock** | Database papers use *latch* for short-lived in-memory locks on data structures (B-tree nodes) and *lock* for long-lived application-level locks on logical objects (rows). In Go we just say "lock," but you'll meet "latch" in the senior file. |
| **Coupling vs crabbing** | Both refer to hand-over-hand locking. "Crabbing" is the British term, "coupling" the American; the algorithm is identical. |
| **Spine vs leaves** | The *spine* is the path from root to leaf. *Leaves* are the bottom-level nodes that hold data (in a B+-tree) or terminal entries (in a B-tree). |
| **Pessimistic vs optimistic** | Pessimistic locking takes the lock before reading. Optimistic reads first and validates after. |
| **MVCC** | Multi-version concurrency control. Each writer creates a new version; readers see the version current at their start time. |
| **RCU** | Read-Copy-Update. Linux kernel pattern: writers replace pointers atomically, deferring the free of old data until all in-flight readers finish. |
| **Bw-tree** | A lock-free B-tree from Microsoft Research that uses a mapping table to indirect node IDs to memory pointers, deltas to avoid in-place updates, and epoch-based reclamation. Senior/pro material. |
| **ART** | Adaptive Radix Tree. A radix trie variant that adapts each node's size to the number of children. Used as the in-memory index in many modern databases (e.g., DuckDB). |

You do not need to use these words yet, but recognising them will save you when you read the next files.

---

## Appendix H: A working "make-believe" lock-coupling sketch

Just so you can see what the *next* level looks like — here is a strawman hand-over-hand traversal that you would *not* actually write yourself but is helpful to read:

```go
// Pseudocode only. Real `google/btree` does not expose nodes.
type lcNode struct {
    mu       sync.RWMutex
    items    []Item
    children []*lcNode
}

func findHandOverHand(root *lcNode, key Item) (Item, bool) {
    n := root
    n.mu.RLock()
    for {
        i := sort.Search(len(n.items), func(i int) bool {
            return !less(n.items[i], key)
        })
        if i < len(n.items) && !less(key, n.items[i]) {
            it := n.items[i]
            n.mu.RUnlock()
            return it, true
        }
        if len(n.children) == 0 {
            n.mu.RUnlock()
            return Item{}, false
        }
        child := n.children[i]
        child.mu.RLock()
        n.mu.RUnlock() // release the parent: this is the "hand-over-hand"
        n = child
    }
}
```

Why this matters: at any moment, the searcher holds at most **two** node locks — the parent it is leaving and the child it is entering. Other searchers can be at completely different parts of the tree. Writers can be splitting nodes far away. The contention surface shrinks dramatically.

Real production implementations use exactly this idea, plus additional tricks for split safety (the B-link tree's right-sibling pointer), and additional tricks for read-only paths (no locks at all, just version validation). The middle and senior files build all of it up. For now, savour that the simple recursive search you wrote in Appendix A's BST has a concurrent cousin that is only slightly more code.

---

## Appendix I: Twenty quick exercises (no answers — for self-study)

1. Write a `sync.Mutex`-protected `IntSet` backed by `google/btree`.
2. Add `Min()`, `Max()`, and `Len()` to it.
3. Add `Range(lo, hi int) []int`.
4. Convert the mutex to `RWMutex`. Decide which methods take `RLock` vs `Lock`.
5. Write a unit test that runs 100 goroutines all calling `Add` and `Contains` and confirms the final size.
6. Run the test under `-race`. Fix anything it reports.
7. Replace the mutex with a sharded design (4 shards). Benchmark.
8. Add a `Snapshot()` method backed by `tidwall/btree.Copy()`. Show it returns a stable view.
9. Implement a tiny LRU using a B-tree of `(lastAccess, key)` plus a `map[key]node`. Evict from `Min`.
10. Implement a per-tenant audit log where the B-tree's key is `(tenant, timestamp)`.
11. Implement an "insert if absent" method without a race.
12. Implement an iterator that holds the lock only while it advances, not while the caller processes.
13. Write a property test: insert N random keys, iterate ascending, assert result is sorted.
14. Write a property test: insert and delete random keys, compare against `map[int]struct{}`.
15. Measure how degree (4, 8, 16, 32, 64, 128) affects `Set`/`Get` throughput.
16. Measure how the `RWMutex` write penalty grows with the number of concurrent readers.
17. Add a `Replace(old, new Item)` that atomically swaps one item for another, asserting the old exists.
18. Add a `Watch(prefix)` that returns a snapshot whenever a key with the prefix is inserted.
19. Document your wrapper's API in a top-of-file comment so a new engineer can use it without reading the implementation.
20. Read the `google/btree` `BTreeG.delete` source and explain its algorithm in your own words.

Doing five of these well will graduate you to the middle file.

---

## Appendix J: A take-home worked example — the `SortedSet` type

A common interview / on-call request: build a `SortedSet[T]` type that supports:

- `Add(t T)`
- `Remove(t T) bool`
- `Contains(t T) bool`
- `Range(lo, hi T) []T`
- `Len() int`
- Safe under concurrent use.

A complete, idiomatic answer:

```go
package sortedset

import (
    "sync"

    "github.com/google/btree"
)

type Set[T any] struct {
    mu sync.RWMutex
    bt *btree.BTreeG[T]
}

func New[T any](degree int, less func(a, b T) bool) *Set[T] {
    return &Set[T]{
        bt: btree.NewG[T](degree, less),
    }
}

func (s *Set[T]) Add(t T) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.ReplaceOrInsert(t)
}

func (s *Set[T]) Remove(t T) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    _, ok := s.bt.Delete(t)
    return ok
}

func (s *Set[T]) Contains(t T) bool {
    s.mu.RLock()
    defer s.mu.RUnlock()
    _, ok := s.bt.Get(t)
    return ok
}

func (s *Set[T]) Range(lo, hi T) []T {
    s.mu.RLock()
    defer s.mu.RUnlock()
    var out []T
    s.bt.AscendRange(lo, hi, func(t T) bool {
        out = append(out, t)
        return true
    })
    return out
}

func (s *Set[T]) Len() int {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.bt.Len()
}
```

That single file — under 50 lines — is a complete, correct, race-free, idiomatic Go sorted set. Ninety percent of professional uses of "I need an ordered concurrent thing" can stop right here. Walk into your next code review with this pattern and you will be fine.

---

## Appendix K: A long final example — a leaderboard

Suppose you are building a real-time leaderboard for a game. Each player has a score; the top 100 should be queryable in real time; scores update tens of thousands of times per second; rank queries ("what is player X's rank?") should be `O(log n)`.

```go
package leaderboard

import (
    "sync"

    "github.com/google/btree"
)

// We need ordering by (score desc, name asc).
type Entry struct {
    Name  string
    Score int64
}

func less(a, b Entry) bool {
    if a.Score != b.Score {
        return a.Score > b.Score // higher first
    }
    return a.Name < b.Name
}

type Board struct {
    mu     sync.Mutex
    bt     *btree.BTreeG[Entry]
    byName map[string]Entry
}

func New() *Board {
    return &Board{
        bt:     btree.NewG[Entry](64, less),
        byName: make(map[string]Entry),
    }
}

func (b *Board) Update(name string, score int64) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if old, ok := b.byName[name]; ok {
        b.bt.Delete(old)
    }
    e := Entry{Name: name, Score: score}
    b.bt.ReplaceOrInsert(e)
    b.byName[name] = e
}

func (b *Board) TopN(n int) []Entry {
    b.mu.Lock()
    defer b.mu.Unlock()
    out := make([]Entry, 0, n)
    b.bt.Ascend(func(e Entry) bool { // ascending = highest score first because of less()
        out = append(out, e)
        return len(out) < n
    })
    return out
}

// RankOf is O(n) in this naive version. The senior file shows how to
// augment B-trees with subtree sizes to make this O(log n).
func (b *Board) RankOf(name string) (int, bool) {
    b.mu.Lock()
    defer b.mu.Unlock()
    e, ok := b.byName[name]
    if !ok {
        return 0, false
    }
    rank := 0
    b.bt.Ascend(func(x Entry) bool {
        rank++
        return less(x, e) || (!less(e, x) && x.Name != e.Name)
    })
    return rank, true
}
```

This is a fully working leaderboard at junior level. It scales to perhaps a few hundred QPS comfortably. The next files show how to scale it to hundreds of thousands.

Important things this example illustrates:

- **Composite ordering matters.** `(score desc, name asc)` is one comparator. Get it wrong and your top-N is wrong.
- **Two indexes, one lock.** The `map[string]Entry` is for `O(1)` "find old entry by name"; the B-tree is for ordered iteration. They are kept in sync under the same lock.
- **Augmented trees** (where each node stores aggregate information about its subtree) turn `RankOf` from `O(n)` to `O(log n)`. The middle file introduces them.

---

## Appendix L: A note on `container/list` and why it is *not* a tree

The Go standard library ships `container/list` (a doubly-linked list) and `container/heap` (a binary heap), but no balanced search tree. People sometimes reach for `container/list` thinking it offers ordered access. It does not — insertions are positional, not ordered by key, and `Get` is `O(n)`. Use a B-tree when you need ordering.

The historical reason: the Go authors decided ordering should be opt-in via third-party libraries, and the community has rallied around `google/btree` and `tidwall/btree`. There is no current proposal to add `container/btree` to the standard library.

---

## Appendix M: A second look at the race detector

The race detector is your best friend when working with concurrent trees. A typical invocation:

```bash
go test -race -count=10 -timeout=60s ./...
```

- `-race` instruments every memory access.
- `-count=10` reruns the test 10 times to catch flaky races.
- `-timeout=60s` makes sure you do not hang on a deadlock.

Common race detector output for a misuse of `google/btree`:

```
==================
WARNING: DATA RACE
Write at 0x00c0001a4000 by goroutine 7:
  github.com/google/btree.(*node[...]).insertItemAt(...)
      .../btree.go:382 +0x9c
  github.com/google/btree.(*BTreeG[...]).ReplaceOrInsert(...)
      .../btree.go:931 +0x4c
  main.main.func1()
      main.go:18 +0x60

Previous write at 0x00c0001a4000 by goroutine 6:
  ...
==================
```

Two goroutines wrote to the same B-tree slot. The fix is always one of: introduce a mutex, switch to a snapshot, or use a different per-shard tree.

CI builds **must** run `-race` for any package that includes concurrency primitives. Treat race detector hits as P0 bugs.

---

## Appendix N: A summary you can print

Print this and tape it to your monitor:

```
+-------------------------------------------------------------+
| CONCURRENT TREES — JUNIOR                                   |
+-------------------------------------------------------------+
| 1. Trees give you SORTED operations. Hash maps do not.      |
| 2. google/btree and tidwall/btree are not thread-safe.      |
| 3. Wrap them: one struct, one Mutex (or RWMutex), all       |
|    methods take the lock.                                   |
| 4. Always `defer mu.Unlock()`.                              |
| 5. Iteration callbacks run UNDER the lock — do not          |
|    re-enter the tree from them.                             |
| 6. RWMutex helps if reads >> writes. Plain Mutex otherwise. |
| 7. Need snapshots? Use tidwall/btree.Copy().                |
| 8. Run `go test -race` always.                              |
| 9. Shard for write throughput. Profile first.               |
| 10. Items in the tree are effectively immutable.            |
+-------------------------------------------------------------+
```

When in doubt: one tree, one mutex, defer Unlock. You will not regret it.

---

## Appendix O: Glossary of `google/btree` API in one page

```go
type BTreeG[T any] struct{}

// Construction
func NewG[T any](degree int, less LessFunc[T]) *BTreeG[T]
type LessFunc[T any] func(a, b T) bool

// Mutation (NOT goroutine-safe with other mutators or readers)
func (t *BTreeG[T]) ReplaceOrInsert(item T) (T, bool)
func (t *BTreeG[T]) Delete(item T) (T, bool)
func (t *BTreeG[T]) DeleteMin() (T, bool)
func (t *BTreeG[T]) DeleteMax() (T, bool)
func (t *BTreeG[T]) Clear(addNodesToFreelist bool)
func (t *BTreeG[T]) Clone() *BTreeG[T] // O(1), shares structure

// Read (safe with other readers if no writer is active)
func (t *BTreeG[T]) Get(item T) (T, bool)
func (t *BTreeG[T]) Min() (T, bool)
func (t *BTreeG[T]) Max() (T, bool)
func (t *BTreeG[T]) Has(item T) bool
func (t *BTreeG[T]) Len() int

// Iteration
type ItemIterator[T any] func(item T) bool
func (t *BTreeG[T]) Ascend(iter ItemIterator[T])
func (t *BTreeG[T]) AscendGreaterOrEqual(pivot T, iter ItemIterator[T])
func (t *BTreeG[T]) AscendLessThan(pivot T, iter ItemIterator[T])
func (t *BTreeG[T]) AscendRange(greaterOrEqual, lessThan T, iter ItemIterator[T])
func (t *BTreeG[T]) Descend(iter ItemIterator[T])
func (t *BTreeG[T]) DescendGreaterThan(pivot T, iter ItemIterator[T])
func (t *BTreeG[T]) DescendLessOrEqual(pivot T, iter ItemIterator[T])
func (t *BTreeG[T]) DescendRange(lessOrEqual, greaterThan T, iter ItemIterator[T])
```

Notes:

- `Clone()` shares structure via copy-on-write. Mutating either tree clones the affected path.
- `Clear(true)` keeps freed nodes in a freelist for reuse — useful if you cycle items in and out at high rate.
- `ReplaceOrInsert` returns the *previous* value if any.
- All iteration is callback-driven. The callback can `return false` to stop.

Memorise this page. You will use it forever.

---

## Appendix P: Final pep talk

Concurrent tree material gets *very* deep, very fast. Hand-over-hand locking, optimistic version counters, the Lehman-Yao B-link protocol, ART concurrent, the Bw-tree — these are some of the most beautiful and most intricate algorithms in computer science, and the next three files (middle, senior, professional) will walk you through them step by step.

But the secret is this: 95% of Go programs in production today use a single mutex around an in-memory tree, and they are *fine*. Performance matters; correctness matters more. Reach for the advanced techniques only when you have measured that the lock is your bottleneck.

You are ready. Take a break. Then open `middle.md` when you want to learn how to share a tree across goroutines *without* taking one big lock for every operation.

---

## Appendix Q: Detailed comparison with `sync.Map`

`sync.Map` is the standard library's specialized concurrent map. People sometimes wonder if it can replace a tree for ordered workloads. It cannot, but the comparison is instructive.

| Property | `sync.Map` | `btree+RWMutex` |
|----------|-----------|------------------|
| Ordering | No (hash-based) | Yes |
| Range query (lo, hi) | Not supported | Native |
| Iteration order | Random | Sorted |
| Reads | Lock-free fast path | Read-lock (cheap) |
| Writes | Atomic + dirty map | Write-lock (exclusive) |
| Memory overhead | High (dual maps) | Moderate |
| Best for | Insert-once, read-many | Anything ordered |

When the `sync.Map` documentation says "use this only if your access pattern is mostly read after a stable period of writes," it means literally that: it has two underlying maps (a `read` map for the fast path and a `dirty` map for new entries), and promotion of `dirty` to `read` happens only after many `Load` misses. For a workload that interleaves reads and writes evenly, a `Mutex+map` outperforms it. For ordered workloads, you need the tree.

### A realistic scenario where `sync.Map` is wrong

Your service caches *configuration objects* fetched from a remote API:

- Configuration is set at startup and rarely changes.
- Lookups happen on every request.
- You never need ordering.

`sync.Map` is genuinely the right choice here.

But change one thing — "you want to enumerate configurations alphabetically for an admin UI" — and `sync.Map` falls down. Now you need a tree.

### A realistic scenario where the tree is wrong

You are caching JWT validation results keyed by token hash:

- Tokens are random 256-bit values; ordering is meaningless.
- Lookups are extremely frequent.
- Inserts happen on every successful auth.
- You need TTL eviction.

For this, `sync.Map` plus a separate timer is appropriate. A tree adds overhead for nothing.

The lesson: never pick a data structure for what it sounds like. Pick it for what you will do with it.

---

## Appendix R: A field guide to the libraries' versioning

This file targets:

- `github.com/google/btree` v1.1.x (the generic `BTreeG[T]` API)
- `github.com/tidwall/btree` v1.7.x (the generic `BTreeG[T]` API)

Both libraries previously had non-generic APIs (`Item interface { Less(than btree.Item) bool }` and similar) that you may still find in older codebases. The generic versions are strictly preferable: they avoid interface allocation per item and make `Less` known statically to the compiler, improving inlining.

When you `go get` the library, pin a recent version explicitly:

```
go get github.com/google/btree@latest
go get github.com/tidwall/btree@latest
```

A `go.mod` snippet:

```
require (
    github.com/google/btree v1.1.2
    github.com/tidwall/btree v1.7.0
)
```

Read the changelog for either library before upgrading across a major version. The generic migration was one such break (~v1.1 in google/btree, ~v1.5 in tidwall/btree).

---

## Appendix S: A walkthrough of an in-tree freelist optimization

Both libraries cache freed nodes to reuse them, instead of letting the GC reclaim them. This is a meaningful optimization for high-churn workloads.

In `google/btree`:

```go
// Clear deletes all items, optionally adding the freed nodes to a
// freelist for reuse. The freelist is bounded.
t.Clear(true)
```

In `tidwall/btree`: pooling is automatic and configurable via `BTreeGOptions`.

If you build a per-request tree (rare; please reconsider), the freelist helps avoid GC churn. For long-lived trees, it is rarely the bottleneck.

---

## Appendix T: A taste of the next file

To give you a taste of where the next file goes, here is the "lock-coupling" search drawn as a sequence diagram:

```
Time -->

reader R1:   RLock(root)
             find child = root.children[i]
             RLock(child)
             RUnlock(root)
             find child' = child.children[j]
             RLock(child')
             RUnlock(child)
             ...
             found item; RUnlock(leaf)

reader R2:                RLock(root)
                          find different child
                          RLock(other_child)
                          RUnlock(root)
                          ...

writer W1:                                            Lock(root)
                                                      walk down,
                                                      acquire write
                                                      latches on the
                                                      *path* only,
                                                      releasing
                                                      ancestors when
                                                      it can prove
                                                      they will not
                                                      need to be
                                                      modified.
```

The locks are short-held and per-node. Many readers and many writers can coexist. The cost is: you need to maintain locks *on every node*, not one big lock on the tree. The middle file teaches you exactly how to do that, and the senior file teaches you how to avoid even those locks via versioning and RCU.

For now: rest, run the exercises in Appendix I, and come back when you are ready to move on.

---

## Appendix U: A short tour of related Go libraries

Beyond `google/btree` and `tidwall/btree`, the Go ecosystem has many related ordered structures:

- **`github.com/petar/GoLLRB`** — a Left-Leaning Red-Black tree. Idiomatic, single-threaded.
- **`github.com/emirpasic/gods`** — a collection of data structures including red-black trees, AVL trees, B-trees, treemaps. Useful for prototyping.
- **`github.com/HuKeping/rbtree`** — another red-black tree, slimmer API.
- **`github.com/MauriceGit/skiplist`** — a skip list with similar semantics.
- **`github.com/dgraph-io/badger`** — an LSM-tree-backed embedded key-value store; uses `skiplist` internally for its memtable.
- **`go.etcd.io/bbolt`** — an embedded B+-tree key-value store (single-writer + many MVCC readers).
- **`github.com/cockroachdb/pebble`** — an LSM key-value store (used in CockroachDB).
- **`github.com/dolthub/swiss`** — a Swiss-table hash map (not ordered, but instructive for cache-aware design).

For *in-memory ordered*, `google/btree` and `tidwall/btree` are the defaults and what this section will assume. For persistent, `bbolt` is the most idiomatic.

---

## Appendix V: A side note on tree height arithmetic

You will repeatedly hear "log_B(N)" for B-tree height. Some values to internalise:

| N (entries) | BST height (log2) | B-tree height (log32) | B-tree height (log64) | B-tree height (log128) |
|-------------|-------------------|-----------------------|-----------------------|------------------------|
| 1,000 | 10 | 2 | 2 | 2 |
| 1,000,000 | 20 | 4 | 4 | 3 |
| 1,000,000,000 | 30 | 6 | 5 | 5 |
| 1,000,000,000,000 | 40 | 8 | 7 | 6 |

A B-tree of fanout 128 storing a *trillion* entries fits in 6 levels. Each level visit is one cache line (or one disk page). That is why every database in the world stores its indexes this way.

Picking degree:

- In-memory, CPU cache aware: degree 32 (each node ~512 bytes) or 64 (~1 KB).
- On-disk, page aware: degree such that one node fills one filesystem page (typically 4 KB or 8 KB). For 8-byte keys: degree ~256 or ~512.

Both `google/btree` and `tidwall/btree` are in-memory, so use 32 or 64 unless you have a specific reason. Higher degree makes the tree shallower but the in-node binary search slower.

---

## Appendix W: A worked exercise on `Less` correctness

A common subtle bug. Define `Less` for floating-point keys:

```go
func less(a, b Item) bool {
    return a.Score < b.Score
}
```

If your scores can be `NaN`, this is *broken*. `NaN < x` is false for every `x`, and `x < NaN` is also false. So `NaN` is not less than anything, nor greater than anything, and the tree thinks every `NaN` is equal to every other key. The result: inserting `{Score: math.NaN()}` corrupts the tree.

Fixes:

1. Reject `NaN` before insert.

   ```go
   if math.IsNaN(item.Score) {
       return ErrInvalidScore
   }
   ```

2. Define a total order on floats:

   ```go
   func less(a, b Item) bool {
       af, bf := a.Score, b.Score
       switch {
       case math.IsNaN(af) && math.IsNaN(bf):
           return false
       case math.IsNaN(af):
           return false // NaN treated as max
       case math.IsNaN(bf):
           return true
       default:
           return af < bf
       }
   }
   ```

This is the kind of bug that takes a week to find when you finally allow user-provided data into the tree.

---

## Appendix X: Reading list of papers (for the curious)

You do not need these at junior level, but knowing they exist primes you for the middle and senior files:

- Lehman, Yao (1981), *Efficient Locking for Concurrent Operations on B-Trees* — the B-link tree paper. ~10 pages, classic.
- Levandoski, Lomet, Sengupta (2013), *The Bw-Tree: A B-tree for New Hardware Platforms* — Microsoft's flash-aware lock-free B-tree.
- Leis, Kemper, Neumann (2013), *The Adaptive Radix Tree: ARTful Indexing for Main-Memory Databases* — ART, used by DuckDB and HyPer.
- Mao, Kohler, Morris (2012), *Cache Craftiness for Fast Multicore Key-Value Storage* — the Masstree paper.
- McKenney (2017), *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — the RCU bible. Free PDF online.
- Cha, Hwang, Kim, Kwon (2001), *Cache-Conscious Concurrency Control of Main-Memory Indexes on Shared-Memory Multiprocessor Systems* — origin of OLFIT (Optimistic Latch-Free Index Traversal), the underpinning of many modern designs.

Save these for later. Just knowing what they look like is enough for now.

---

## Appendix Y: One last cheat sheet — workload to structure

| Workload | Best choice |
|----------|-------------|
| Few keys, frequent full iteration | Sorted slice |
| Many keys, hash-only access | `map` + `RWMutex` |
| Many keys, hash-only, write-once | `sync.Map` |
| Many keys, ordered access, mixed read/write | `google/btree` + `Mutex`/`RWMutex` |
| Many keys, ordered access, snapshots | `tidwall/btree` + `Mutex` |
| Many keys, ordered access, very read-heavy | `tidwall/btree` + published snapshot |
| Persistent, ordered | `bbolt` or `BadgerDB` |
| String prefix queries | Trie or ART (middle file) |
| Range queries on 2D coordinates | R-tree (out of scope here) |

Photograph this and save it. It is the most useful page in the file.

---

## Appendix Z: One final story

A senior engineer at a database company once said: "I have written exactly one production B-tree in twenty years, and the rest of the time I have used somebody else's. The B-tree I wrote turned out to be slightly buggy under a contended write workload, and we replaced it with `google/btree` within six months."

The moral: **use the libraries**. Read this file to understand what they do; read the middle and senior files to understand how they *could* be made faster; but in 99% of cases, you should be reaching for `google/btree` or `tidwall/btree`, wrapping it in a `sync.Mutex` or `sync.RWMutex`, and shipping.

Now go ship.

---

## Appendix AA: Long-form walkthrough — building `SortedMap[K, V]` from scratch

To cement everything, let's build a complete, well-tested `SortedMap[K comparable, V any]` step by step.

### Step 1: define the package and exports

```go
// Package sortedmap is a concurrent ordered map backed by google/btree.
//
// SortedMap[K, V] supports the same operations as a map[K]V plus ordered
// iteration, range queries, and predecessor/successor lookups. All methods
// are safe for concurrent use.
package sortedmap

import (
    "sync"

    "github.com/google/btree"
)

// LessFunc returns true if a should sort before b.
type LessFunc[K any] func(a, b K) bool

// SortedMap is a sorted, concurrent key-value map.
type SortedMap[K, V any] struct {
    mu   sync.RWMutex
    bt   *btree.BTreeG[pair[K, V]]
    less LessFunc[K]
}

// pair is the internal item type the B-tree sorts.
type pair[K, V any] struct {
    Key   K
    Value V
}
```

### Step 2: constructor

```go
// New returns an empty SortedMap using the given less function.
func New[K, V any](degree int, less LessFunc[K]) *SortedMap[K, V] {
    if degree < 2 {
        degree = 32
    }
    return &SortedMap[K, V]{
        bt: btree.NewG[pair[K, V]](degree, func(a, b pair[K, V]) bool {
            return less(a.Key, b.Key)
        }),
        less: less,
    }
}
```

Note: we capture `less` once in a closure when building the underlying B-tree. We also store it so methods that need to construct pivot pairs can.

### Step 3: simple read methods

```go
// Get returns the value associated with key and whether it was found.
func (m *SortedMap[K, V]) Get(k K) (V, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    p, ok := m.bt.Get(pair[K, V]{Key: k})
    return p.Value, ok
}

// Has reports whether k is in the map.
func (m *SortedMap[K, V]) Has(k K) bool {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.bt.Has(pair[K, V]{Key: k})
}

// Len returns the number of entries.
func (m *SortedMap[K, V]) Len() int {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.bt.Len()
}
```

### Step 4: simple write methods

```go
// Set inserts or replaces the key with the given value. Returns the
// previous value if any.
func (m *SortedMap[K, V]) Set(k K, v V) (V, bool) {
    m.mu.Lock()
    defer m.mu.Unlock()
    old, ok := m.bt.ReplaceOrInsert(pair[K, V]{Key: k, Value: v})
    return old.Value, ok
}

// Delete removes the key. Returns the value that was removed if any.
func (m *SortedMap[K, V]) Delete(k K) (V, bool) {
    m.mu.Lock()
    defer m.mu.Unlock()
    old, ok := m.bt.Delete(pair[K, V]{Key: k})
    return old.Value, ok
}
```

### Step 5: ordered methods

```go
// Min returns the smallest key and its value, if any.
func (m *SortedMap[K, V]) Min() (K, V, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    p, ok := m.bt.Min()
    return p.Key, p.Value, ok
}

// Max returns the largest key and its value, if any.
func (m *SortedMap[K, V]) Max() (K, V, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    p, ok := m.bt.Max()
    return p.Key, p.Value, ok
}
```

### Step 6: range scan

```go
// Range calls fn for every (key, value) with lo <= key < hi.
// Iteration stops when fn returns false.
// fn runs while holding the read lock; do NOT call back into the map.
func (m *SortedMap[K, V]) Range(lo, hi K, fn func(K, V) bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    m.bt.AscendRange(
        pair[K, V]{Key: lo},
        pair[K, V]{Key: hi},
        func(p pair[K, V]) bool { return fn(p.Key, p.Value) },
    )
}

// RangeCollect materialises [lo, hi) into a slice. Safer for callers that
// might want to mutate the map afterward.
func (m *SortedMap[K, V]) RangeCollect(lo, hi K) []struct {
    K K
    V V
} {
    m.mu.RLock()
    defer m.mu.RUnlock()
    var out []struct {
        K K
        V V
    }
    m.bt.AscendRange(
        pair[K, V]{Key: lo},
        pair[K, V]{Key: hi},
        func(p pair[K, V]) bool {
            out = append(out, struct {
                K K
                V V
            }{p.Key, p.Value})
            return true
        },
    )
    return out
}
```

### Step 7: snapshot

```go
// Snapshot returns an immutable view that callers can iterate without
// blocking writers. O(1).
type Snapshot[K, V any] struct {
    bt   *btree.BTreeG[pair[K, V]]
    less LessFunc[K]
}

func (m *SortedMap[K, V]) Snapshot() *Snapshot[K, V] {
    m.mu.Lock()
    defer m.mu.Unlock()
    return &Snapshot[K, V]{bt: m.bt.Clone(), less: m.less}
}

func (s *Snapshot[K, V]) Get(k K) (V, bool) {
    p, ok := s.bt.Get(pair[K, V]{Key: k})
    return p.Value, ok
}

func (s *Snapshot[K, V]) Len() int { return s.bt.Len() }

func (s *Snapshot[K, V]) Range(lo, hi K, fn func(K, V) bool) {
    s.bt.AscendRange(
        pair[K, V]{Key: lo},
        pair[K, V]{Key: hi},
        func(p pair[K, V]) bool { return fn(p.Key, p.Value) },
    )
}
```

`google/btree.Clone()` returns an `O(1)` shared structure. Subsequent writes to either tree copy-on-write the touched path.

### Step 8: tests

```go
package sortedmap_test

import (
    "math/rand"
    "sort"
    "sync"
    "testing"

    "example.com/sortedmap"
)

func less(a, b int) bool { return a < b }

func TestBasic(t *testing.T) {
    m := sortedmap.New[int, string](32, less)
    m.Set(2, "two")
    m.Set(1, "one")
    m.Set(3, "three")
    if v, ok := m.Get(2); !ok || v != "two" {
        t.Fatalf("get(2)=%v,%v", v, ok)
    }
    if m.Len() != 3 {
        t.Fatalf("len=%d", m.Len())
    }
    k, v, _ := m.Min()
    if k != 1 || v != "one" {
        t.Fatalf("min=%v,%v", k, v)
    }
}

func TestRange(t *testing.T) {
    m := sortedmap.New[int, int](32, less)
    for i := 0; i < 100; i++ {
        m.Set(i, i*10)
    }
    var keys []int
    m.Range(20, 30, func(k, _ int) bool { keys = append(keys, k); return true })
    if len(keys) != 10 || keys[0] != 20 || keys[9] != 29 {
        t.Fatalf("range=%v", keys)
    }
}

func TestSnapshotIsolation(t *testing.T) {
    m := sortedmap.New[int, int](32, less)
    for i := 0; i < 10; i++ {
        m.Set(i, i)
    }
    snap := m.Snapshot()
    for i := 10; i < 20; i++ {
        m.Set(i, i)
    }
    if snap.Len() != 10 {
        t.Fatalf("snapshot.Len=%d", snap.Len())
    }
    if m.Len() != 20 {
        t.Fatalf("map.Len=%d", m.Len())
    }
}

func TestConcurrent(t *testing.T) {
    m := sortedmap.New[int, int](32, less)
    var wg sync.WaitGroup
    for w := 0; w < 8; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            r := rand.New(rand.NewSource(int64(seed)))
            for i := 0; i < 10_000; i++ {
                m.Set(r.Intn(1000), i)
                _, _ = m.Get(r.Intn(1000))
            }
        }(w)
    }
    wg.Wait()
}

func TestAscendingOrder(t *testing.T) {
    m := sortedmap.New[int, int](32, less)
    var input []int
    for i := 0; i < 1000; i++ {
        k := rand.Intn(100_000)
        m.Set(k, k)
        input = append(input, k)
    }
    sort.Ints(input)
    var output []int
    snap := m.Snapshot()
    snap.Range(0, 1_000_000, func(k, _ int) bool { output = append(output, k); return true })
    // dedupe input
    dedup := input[:0]
    for i, k := range input {
        if i == 0 || k != input[i-1] {
            dedup = append(dedup, k)
        }
    }
    if len(dedup) != len(output) {
        t.Fatalf("len mismatch %d vs %d", len(dedup), len(output))
    }
    for i := range dedup {
        if dedup[i] != output[i] {
            t.Fatalf("at %d: %d vs %d", i, dedup[i], output[i])
        }
    }
}
```

Run with `go test -race -v ./...` and all four tests should pass.

### Step 9: benchmarks

```go
func BenchmarkSet(b *testing.B) {
    m := sortedmap.New[int, int](32, less)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        m.Set(i, i)
    }
}

func BenchmarkGetReadOnly(b *testing.B) {
    m := sortedmap.New[int, int](32, less)
    for i := 0; i < 10_000; i++ {
        m.Set(i, i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            m.Get(i % 10_000)
            i++
        }
    })
}

func BenchmarkMixed(b *testing.B) {
    m := sortedmap.New[int, int](32, less)
    for i := 0; i < 10_000; i++ {
        m.Set(i, i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        r := rand.New(rand.NewSource(rand.Int63()))
        for pb.Next() {
            if r.Intn(10) == 0 {
                m.Set(r.Intn(10_000), r.Int())
            } else {
                m.Get(r.Intn(10_000))
            }
        }
    })
}
```

Typical results on a 2026-era 16-core machine:

```
BenchmarkSet            10000000 ops    220 ns/op    48 B/op    1 allocs/op
BenchmarkGetReadOnly-16  5000000 ops    320 ns/op     0 B/op    0 allocs/op
BenchmarkMixed-16         800000 ops   1800 ns/op    12 B/op    0.1 allocs/op
```

Reads scale roughly linearly with cores until you hit some other bottleneck (likely the OS-level scheduler). Mixed slows down dramatically as writers contend for the exclusive lock. This is *exactly* the curve the middle file's fine-grained-locking strategies aim to flatten.

### Step 10: documentation

Open the file in your editor and add a top-of-file doc comment that says exactly what the contract is:

```go
// Package sortedmap is a concurrent ordered map backed by google/btree.
//
// All exported methods are safe for concurrent use. Iteration callbacks
// (Range, RangeCollect) run while holding the read lock; they MUST NOT
// re-enter the map.
//
// For workloads that need cheap point-in-time read views (e.g., long
// debugging dumps, periodic backups), use Snapshot. The snapshot is
// O(1) to construct and is isolated from subsequent writes via the
// underlying tree's copy-on-write semantics.
//
// SortedMap is appropriate when you need ordered access, range queries,
// predecessor/successor lookups, or sorted iteration. If you do not need
// any of those, prefer map[K]V protected by sync.RWMutex (faster for
// pure point access) or sync.Map (when reads vastly outnumber writes).
package sortedmap
```

Documentation is part of the deliverable. A junior engineer who writes the implementation but skips the doc comment has finished 70% of the work.

---

## Appendix AB: Sharded variant — when one mutex is not enough

A natural follow-up to the wrapper above: shard the keyspace. For example, 16 shards keyed by `hash(k) % 16`:

```go
package shardedmap

import (
    "hash/maphash"
    "sync"

    "github.com/google/btree"
)

const NShards = 16

type pair[K, V any] struct {
    Key   K
    Value V
}

type shard[K, V any] struct {
    mu sync.RWMutex
    bt *btree.BTreeG[pair[K, V]]
}

type SortedMap[K, V any] struct {
    shards [NShards]shard[K, V]
    less   func(a, b K) bool
    seed   maphash.Seed
    hash   func(seed maphash.Seed, k K) uint64
}

func New[K, V any](less func(a, b K) bool, hash func(seed maphash.Seed, k K) uint64) *SortedMap[K, V] {
    m := &SortedMap[K, V]{less: less, seed: maphash.MakeSeed(), hash: hash}
    for i := range m.shards {
        m.shards[i].bt = btree.NewG[pair[K, V]](32, func(a, b pair[K, V]) bool {
            return less(a.Key, b.Key)
        })
    }
    return m
}

func (m *SortedMap[K, V]) shardOf(k K) *shard[K, V] {
    return &m.shards[m.hash(m.seed, k)%NShards]
}

func (m *SortedMap[K, V]) Set(k K, v V) {
    s := m.shardOf(k)
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.ReplaceOrInsert(pair[K, V]{Key: k, Value: v})
}

func (m *SortedMap[K, V]) Get(k K) (V, bool) {
    s := m.shardOf(k)
    s.mu.RLock()
    defer s.mu.RUnlock()
    p, ok := s.bt.Get(pair[K, V]{Key: k})
    return p.Value, ok
}
```

Two things break in the sharded version:

1. **Range queries.** A range may span multiple shards. You must visit every shard, collect items, and merge sort. For large ranges this can be slower than the single-tree version.
2. **`Min`/`Max`/`Len`.** Same problem: visit every shard.

Tradeoff: sharding speeds up point reads and writes but slows down ordered queries. For workloads that are 99% point access, it is a great trick. For workloads that need ordered ranges as the primary access pattern, stick with one tree.

A subtle bug to avoid: the hash function for sharding **must not** correlate with the sort order. If `hash(k) = k mod 16`, then keys 0..15 land in different shards, but a range query [0, 16) hits all of them — which is fine — and a range query [0, 1000) hits all of them equally — which is also fine. But if `hash(k) = k / 1000`, then range [0, 1000) hits only one shard. Sounds good? It is *not* good, because it means writes inserting sequential keys all hit one shard, breaking the point of sharding. Use a *uniformly distributed* hash function (`maphash`, `fnv`, `xxhash`, etc.).

---

## Appendix AC: An on-call story

A team I worked with had a Go service with a `map[string]Session` guarded by an `sync.RWMutex`. They needed to evict sessions older than some TTL. They had a separate goroutine that scanned the map every minute, found expired sessions, deleted them. Performance was fine at 10k sessions.

Traffic grew to 1M sessions. The sweep now took 30 seconds, during which the write lock was held. Every login request stalled for 30 seconds. Pager went off.

The fix was a single B-tree: insert into a B-tree keyed by `(expireAt, sessionID)`. The eviction sweep became `AscendLessThan(now, fn)` plus a few deletes — `O(k log n)` for `k` expired sessions, *no* lock held during the scan over a snapshot of expired keys.

The total code change: about 40 lines. The fix landed in production an hour after pager.

**Moral.** A `map` is fine until you need ordered access. The moment you need it, reach for a tree. The change is small. The performance win is enormous.

---

## Appendix AD: How `tidwall/btree` differs subtly

A few specifics that catch newcomers:

- `tidwall/btree.BTreeG[T]` `Set(item) T` returns the *previous* item (if any). The bool is *not* returned; instead a separate `Has` exists. Read the docs.
- `tidwall/btree.BTreeG[T].Ascend(pivot, iter)` starts iteration from `pivot` (inclusive). It does *not* take a `hi` — you must stop yourself in the callback.
- `tidwall/btree.Copy()` shares structure copy-on-write. After many copies, the structural sharing can deduplicate enormous amounts of memory — useful if you keep around hundreds of snapshots.
- `tidwall/btree` has `NewBTreeG` and `NewBTreeGOptions` constructors. The Options version exposes degree, comparator, and locking hints.

If you find yourself fighting the API, switch libraries. Both are excellent; both have slight quirks.

---

## Appendix AE: Closing the loop

You have read 3000+ lines of B-tree concurrency basics. Pause. Re-read Appendix N. Then, in your editor, build the `SortedMap[K, V]` from Appendix AA. Run the tests. Run the benchmarks. Read the `google/btree` source.

Only after that is in your fingers should you move to `middle.md`. The middle file assumes you can write a `Mutex`-protected wrapper in your sleep and that you have felt the read/write contention curve flatten as you switched from `Mutex` to `RWMutex` to sharded. Without that intuition, the middle file's discussions of hand-over-hand vs optimistic vs RCU will feel like words; with it, they will feel like answers to questions you have already asked.

See you in `middle.md`.

---

## Appendix AF: Eight more worked examples

Here are eight smaller, focused examples you can transcribe and run.

### AF.1 Top-K elements seen so far

```go
type TopK struct {
    mu sync.Mutex
    bt *btree.BTreeG[int]
    k  int
}

func NewTopK(k int) *TopK {
    return &TopK{
        bt: btree.NewG[int](32, func(a, b int) bool { return a < b }),
        k:  k,
    }
}

func (t *TopK) Observe(x int) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.bt.ReplaceOrInsert(x)
    for t.bt.Len() > t.k {
        t.bt.DeleteMin()
    }
}

func (t *TopK) Snapshot() []int {
    t.mu.Lock()
    defer t.mu.Unlock()
    out := make([]int, 0, t.bt.Len())
    t.bt.Ascend(func(x int) bool { out = append(out, x); return true })
    return out
}
```

### AF.2 Sliding window of last N events

```go
type Window struct {
    mu  sync.Mutex
    bt  *btree.BTreeG[int64] // timestamps
    max int
}

func NewWindow(max int) *Window {
    return &Window{
        bt:  btree.NewG[int64](32, func(a, b int64) bool { return a < b }),
        max: max,
    }
}

func (w *Window) Record(ts int64) {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.bt.ReplaceOrInsert(ts)
    for w.bt.Len() > w.max {
        w.bt.DeleteMin()
    }
}

func (w *Window) RatePerSec(now int64) float64 {
    w.mu.Lock()
    defer w.mu.Unlock()
    min, ok := w.bt.Min()
    if !ok {
        return 0
    }
    span := float64(now-min) / 1e9
    if span <= 0 {
        return 0
    }
    return float64(w.bt.Len()) / span
}
```

### AF.3 Interval booking calendar

```go
type Booking struct {
    Start int64
    End   int64
    Name  string
}

type Calendar struct {
    mu sync.Mutex
    bt *btree.BTreeG[Booking]
}

func less(a, b Booking) bool { return a.Start < b.Start }

func NewCalendar() *Calendar {
    return &Calendar{bt: btree.NewG[Booking](32, less)}
}

// Book inserts or returns ErrConflict if the interval overlaps an existing one.
func (c *Calendar) Book(b Booking) error {
    c.mu.Lock()
    defer c.mu.Unlock()
    var conflict bool
    c.bt.AscendRange(Booking{Start: b.Start - 24*3600*1e9}, Booking{Start: b.End}, func(x Booking) bool {
        if x.End > b.Start && x.Start < b.End {
            conflict = true
            return false
        }
        return true
    })
    if conflict {
        return errors.New("conflict")
    }
    c.bt.ReplaceOrInsert(b)
    return nil
}
```

### AF.4 IP allowlist with range queries

```go
type IPRange struct {
    Lo uint32
    Hi uint32
}

type Allowlist struct {
    mu sync.RWMutex
    bt *btree.BTreeG[IPRange]
}

func NewAllowlist() *Allowlist {
    return &Allowlist{bt: btree.NewG[IPRange](32, func(a, b IPRange) bool { return a.Lo < b.Lo })}
}

func (a *Allowlist) Allow(r IPRange) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.bt.ReplaceOrInsert(r)
}

func (a *Allowlist) Contains(ip uint32) bool {
    a.mu.RLock()
    defer a.mu.RUnlock()
    var found bool
    a.bt.DescendLessOrEqual(IPRange{Lo: ip}, func(r IPRange) bool {
        if r.Lo <= ip && ip <= r.Hi {
            found = true
        }
        return false // only check the largest .Lo <= ip
    })
    return found
}
```

### AF.5 Versioned config with rollback

```go
type Version struct {
    ID   int64
    Data string
}

type Configs struct {
    mu sync.RWMutex
    bt *btree.BTreeG[Version]
}

func NewConfigs() *Configs {
    return &Configs{bt: btree.NewG[Version](16, func(a, b Version) bool { return a.ID < b.ID })}
}

func (c *Configs) Publish(v Version) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.bt.ReplaceOrInsert(v)
}

func (c *Configs) Current() (Version, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.bt.Max()
}

func (c *Configs) Rollback(toID int64) (Version, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    var target Version
    var found bool
    c.bt.DescendLessOrEqual(Version{ID: toID}, func(v Version) bool {
        target, found = v, true
        return false
    })
    if !found {
        return Version{}, false
    }
    // Delete all versions strictly newer than target
    var toDelete []Version
    c.bt.AscendGreaterOrEqual(Version{ID: target.ID + 1}, func(v Version) bool {
        toDelete = append(toDelete, v)
        return true
    })
    for _, v := range toDelete {
        c.bt.Delete(v)
    }
    return target, true
}
```

### AF.6 Per-user rate counter

```go
type Counters struct {
    mu sync.Mutex
    bt *btree.BTreeG[Counter]
}

type Counter struct {
    User  string
    Count int64
}

func less(a, b Counter) bool { return a.User < b.User }

func NewCounters() *Counters {
    return &Counters{bt: btree.NewG[Counter](32, less)}
}

func (c *Counters) Inc(user string) int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    cur, _ := c.bt.Get(Counter{User: user})
    cur.User = user
    cur.Count++
    c.bt.ReplaceOrInsert(cur)
    return cur.Count
}

func (c *Counters) Snapshot() map[string]int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    out := make(map[string]int64, c.bt.Len())
    c.bt.Ascend(func(x Counter) bool { out[x.User] = x.Count; return true })
    return out
}
```

### AF.7 Prefix scan on string keys

```go
type Trie struct {
    mu sync.RWMutex
    bt *btree.BTreeG[string]
}

func NewTrie() *Trie {
    return &Trie{bt: btree.NewG[string](32, func(a, b string) bool { return a < b })}
}

func (t *Trie) Add(s string) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.bt.ReplaceOrInsert(s)
}

// PrefixScan returns up to max strings starting with prefix.
func (t *Trie) PrefixScan(prefix string, max int) []string {
    t.mu.RLock()
    defer t.mu.RUnlock()
    var out []string
    t.bt.AscendGreaterOrEqual(prefix, func(s string) bool {
        if !strings.HasPrefix(s, prefix) {
            return false
        }
        out = append(out, s)
        return len(out) < max
    })
    return out
}
```

A B-tree of strings turns into a workable prefix index without a real trie. The middle file shows how a true ART beats this for very large datasets.

### AF.8 Two-level sharded TTL cache

```go
type Cache struct {
    shards [16]struct {
        mu sync.Mutex
        bt *btree.BTreeG[Entry]
    }
}

type Entry struct {
    Key    string
    Value  string
    Expire int64
}

func less(a, b Entry) bool {
    if a.Expire != b.Expire {
        return a.Expire < b.Expire
    }
    return a.Key < b.Key
}

func NewCache() *Cache {
    var c Cache
    for i := range c.shards {
        c.shards[i].bt = btree.NewG[Entry](16, less)
    }
    return &c
}

func (c *Cache) shard(k string) *struct {
    mu sync.Mutex
    bt *btree.BTreeG[Entry]
} {
    h := fnv.New32a()
    h.Write([]byte(k))
    return &c.shards[h.Sum32()%16]
}

func (c *Cache) Set(k, v string, expireAtNanos int64) {
    s := c.shard(k)
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.ReplaceOrInsert(Entry{Key: k, Value: v, Expire: expireAtNanos})
}

func (c *Cache) Sweep(nowNanos int64) (deleted int) {
    for i := range c.shards {
        s := &c.shards[i]
        s.mu.Lock()
        var toDel []Entry
        s.bt.AscendLessThan(Entry{Expire: nowNanos}, func(e Entry) bool {
            toDel = append(toDel, e)
            return true
        })
        for _, e := range toDel {
            s.bt.Delete(e)
        }
        deleted += len(toDel)
        s.mu.Unlock()
    }
    return
}
```

Sharded + ordered. Each shard's lock is held only briefly during sweeps. This pattern appears in real production caches, including some inside the Cloudflare and Twitter Go stacks.

---

## Appendix AG: A note on Go generics and tree libraries

Generics (introduced in Go 1.18) made tree libraries dramatically more pleasant to use. Compare the pre-generic API:

```go
// Old: every Item interface{} costs an allocation per call.
type Item interface {
    Less(than Item) bool
}

type MyKey int
func (k MyKey) Less(than Item) bool { return k < than.(MyKey) }

tr.ReplaceOrInsert(MyKey(5)) // boxes into interface
```

…to the generic API:

```go
tr := btree.NewG[int](32, func(a, b int) bool { return a < b })
tr.ReplaceOrInsert(5) // no boxing
```

The generic version is roughly 30% faster on `Set`/`Get` benchmarks because there is no interface boxing per call, and the comparator can be inlined.

If you find yourself maintaining a codebase that still uses the pre-generic `btree.Item` interface, migrating to `btree.BTreeG[T]` is a high-value cleanup.

---

## Appendix AH: A summary of summaries

You have read:

- The basics: trees vs maps, balance, B-trees, locks.
- Two real libraries: `google/btree` and `tidwall/btree`.
- Five wrappers: simple `Mutex`, `RWMutex`, sharded, snapshot, snapshot-publishing.
- Eight worked use cases: TTL cache, audit log, priority queue, leaderboard, sliding window, calendar, IP allowlist, prefix scan.
- An entire `SortedMap[K, V]` built from scratch with tests and benchmarks.
- The race detector, sharding, and the next-level cliff that motivates the middle file.

If you build five of these and run them under `go test -race`, you have all the practical knowledge a junior Go engineer needs to use concurrent ordered data in production. The deeper material exists; it is fascinating; it is rarely necessary; and when it is necessary, you will be ready.

Welcome to ordered concurrent data in Go. Onward.




