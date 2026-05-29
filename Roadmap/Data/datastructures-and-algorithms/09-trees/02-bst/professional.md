# Binary Search Tree — Professional Level

> **Audience:** Engineers and researchers who treat BSTs as building blocks in concurrent systems, functional programming, and augmented data structures. We assume the operational fundamentals from `junior.md`/`middle.md` and the production landscape from `senior.md`.

This document collects topics that turn the BST from an algorithmic curiosity into a substrate for real engineering: pointer-chasing performance on modern hardware, lock-free and concurrent BSTs, persistent (immutable) BSTs in functional languages, cache-conscious layouts, garbage-collection interaction, and the powerful pattern of **augmentation** — storing extra information at each node to answer non-membership queries (order statistics, interval overlap, segment sums) in `O(log n)`.

---

## Table of Contents

1. [Pointer-Chasing Cost on Modern Hardware](#pointer-chasing)
2. [Concurrent BSTs — Lock-Free and Hand-Over-Hand](#concurrent)
3. [Persistent (Functional) BSTs](#persistent)
4. [Compressed Pointers and Cache-Conscious Layouts](#compressed)
5. [Garbage Collection Interaction](#gc)
6. [Augmented BSTs — Order Statistics, Intervals, Segment Sums](#augmented)
7. [Concurrent Modification Semantics — `ConcurrentModificationException` and friends](#cme)

---

<a name="pointer-chasing"></a>
## 1. Pointer-Chasing Cost on Modern Hardware

Every BST operation walks a chain of pointers from the root to a leaf. Each pointer dereference is a load from a random memory address that the CPU could not predict ahead of time. This pattern is the worst case for two CPU features that otherwise carry most of modern performance:

1. **Hardware prefetching.** Prefetchers detect sequential or stride access patterns and pre-load cache lines before the program asks for them. Pointer-chasing has **no stride** — the next address depends on the value just loaded — so prefetchers cannot help.
2. **Out-of-order execution.** Modern cores keep dozens of instructions in flight, executing whichever are ready. A dependency chain (`load → compare → branch → load → compare → branch`) serializes execution: each iteration must complete before the next begins.

The net result: a BST traversal on a tree larger than L3 cache costs roughly **one main-memory latency per level**. For a 1-million-node tree (20 levels) with ~100 ns per RAM access, a single search costs ~2 µs — versus ~30 ns for a hash-table lookup that hits L3.

### Quantified

| Structure | Search cost on 1M entries (rough) |
|---|---|
| Hash table (L3 resident) | 30-50 ns |
| Sorted-array binary search (L3 resident) | 100-300 ns |
| Cache-friendly BST (B-tree, fanout 8, RAM) | 300-600 ns |
| Pointer-chase BST (RB tree, RAM) | 1-3 µs |

These numbers are why **modern in-memory ordered maps prefer B-tree layouts** (Rust's `BTreeMap`, Google's `absl::btree_map`, ClickHouse's column stores) over RB trees: same `O(log n)` asymptotics, dramatically better constants on real workloads.

### Mitigation strategies

- **B-tree / B+-tree layout** in RAM (cache-block-sized nodes).
- **Implicit / cache-oblivious layouts** (Eytzinger, van Emde Boas).
- **Software prefetching** — explicit `__builtin_prefetch` for the *next-next* node based on a predicted branch outcome. Works only if you can predict cheaply.
- **Memory pool / arena allocation** — allocate all tree nodes contiguously rather than via `malloc`/`new` per node, increasing the chance of cache hits when nodes happen to be nearby.

---

<a name="concurrent"></a>
## 2. Concurrent BSTs — Lock-Free and Hand-Over-Hand

Concurrent BSTs are notoriously difficult. Two threads inserting near each other can race on the same parent pointer; deletion is even worse because the structure changes globally (rotations can move a node far from where another thread expected it).

### Strategy 1: One global lock

The simplest approach: a single `RWMutex` protects the entire tree. Read-heavy workloads use the read side; writers take the write side. This serializes writes and offers zero scalability for write-heavy loads, but it is correct and trivial to implement.

### Strategy 2: Hand-over-hand locking ("lock coupling")

Each node has its own lock. A thread descending the tree holds the lock on the current node, **acquires** the lock on the child, then **releases** the parent. At most two locks are held at once. This allows multiple concurrent searches and uncontended inserts in different subtrees, but introduces lock-acquire overhead at every level.

This is exactly the technique used in early **B-tree concurrent indexes** in databases. PostgreSQL's btree access method (`src/backend/access/nbtree/`) uses a similar approach plus more sophisticated split coordination.

### Strategy 3: Lock-free BSTs

True lock-free BSTs were an open research problem for years. The first practical lock-free BST design is **Ellen, Fatourou, Ruppert, van Breugel** — "Non-blocking Binary Search Trees" (PODC 2010). Their construction uses **co-operative helping**: a thread modifying a node leaves a "flag" describing the operation; other threads that find the flag help complete it before proceeding. This avoids the ABA problem and ensures progress without locks.

Subsequent work — **Howley and Jones (SPAA 2012)**, **Natarajan and Mittal (PPoPP 2014)** — improved the constant factors and added range queries. None of these designs has become a standard library primitive; they remain research code and specialized in-memory database implementations.

### Strategy 4: RCU (Read-Copy-Update)

For **read-heavy** workloads, the Linux kernel uses **RCU** to allow lock-free readers concurrent with a single writer. Writers create a new version of any modified subtree, install it with a single pointer swap, and defer freeing the old version until all in-flight readers have finished (a "grace period"). The readers never block; the writer pays a memory cost.

The trade-off is that RCU works well when writes are rare (e.g., the VMA tree changes only on `mmap`/`munmap`, which is uncommon compared to memory access). For write-heavy workloads RCU is wrong.

### Strategy 5: Skip list instead of BST

Java's `ConcurrentSkipListMap` and many other concurrent ordered maps use a **skip list**, not a BST. The reason is operational: skip lists are easier to make lock-free because their structure is "fix-up" friendly — a level pointer can be CAS'd into place without coordinating with the rest of the structure. BSTs have more global invariants (the BST property + the balance invariant) and harder local fixups. Empirically, lock-free skip lists are ~2-3× faster than lock-free RB trees at typical concurrency levels.

---

<a name="persistent"></a>
## 3. Persistent (Functional) BSTs

A **persistent** data structure is one where every "modification" produces a new version while leaving the old version intact. Persistent BSTs are central to functional programming:

- **Clojure's `sorted-map` and `sorted-set`** — persistent red-black trees. `(assoc m k v)` returns a new map sharing most of `m`'s structure.
- **Scala's `TreeMap` (immutable)** — also a persistent red-black tree.
- **Haskell's `Data.Map.Map`** — a **size-balanced binary tree** (Adams 1992) maintained as fully persistent.
- **OCaml's `Map.Make(...)`** — likewise a balanced BST, persistent.

### Path copying

The standard implementation technique is **path copying**: when you insert a key, you allocate new nodes only along the **search path** from the root to the new leaf, sharing all subtrees that don't change. Insertion is `O(log n)` time and `O(log n)` *additional* space (one new node per level). The old tree is untouched, so concurrent readers see a consistent snapshot without locks.

```
Original tree:
        5
       / \
      3   8

Insert 7 → new tree shares the left subtree:
        5'
       / \
      3   8'        (5 and 3 are shared; 5' and 8' are new)
         /
        7
```

This is the same trick the Linux kernel uses for RCU updates, generalized into a primitive that you can build entire languages on top of. Implementing `git` history is in a deep sense the same idea: each commit is a persistent snapshot of the file tree.

### Persistent BSTs as version-control primitives

Real databases and editors use persistent trees for:

- **Versioned configuration stores** (etcd, Consul, ZooKeeper) — each commit produces a snapshot.
- **CRDT data types** — concurrent users append to a persistent ordered map; merges become structural joins.
- **Code editors with undo / redo** — Emacs uses a related technique (undo tree) for per-buffer history.

### Cost in practice

Path-copying persistent BSTs use ~3-5× the memory of a destructive BST (more if the tree is wide and shallow), and have ~2× the operation cost due to allocation overhead. In garbage-collected languages this is acceptable; in C/C++ you would use a different technique (e.g., Bw-tree, log-structured).

### Reference

- **Driscoll, Sarnak, Sleator, Tarjan.** "Making Data Structures Persistent." J. Comp. Sys. Sci. 38, 1989. The foundational paper introducing partial, full, and confluent persistence.
- **Okasaki, Chris.** *Purely Functional Data Structures*, 1998. The book that brought persistent structures into the mainstream.
- **Adams, S.** "Implementing Sets Efficiently in a Functional Language." Tech Report CSTR 92-10, University of Southampton, 1992. The weight-balanced tree behind Haskell's `Map`.

---

<a name="compressed"></a>
## 4. Compressed Pointers and Cache-Conscious Layouts

A standard 64-bit BST node has 16 bytes of pointers (two 8-byte children). For trees with `< 2³²` nodes (effectively all real trees), you can use **32-bit indices** into a node array instead of 8-byte pointers, cutting per-node footprint in half. The trade-off is that you lose true heap-allocation semantics — nodes are tied to the array — but you gain a **2× reduction in tree memory** and dramatically better cache behavior.

Production systems that use compressed pointers include:

- **HotSpot JVM**'s `UseCompressedOops` — encodes 64-bit object references as 32-bit offsets from a base address, providing transparent 50% pointer compression for heaps up to 32 GB. Default-on since JDK 6.
- **CockroachDB**'s in-memory index structures.
- Many game engines for entity hierarchies.

### Cache-conscious tree layouts

Beyond compressed pointers, several layouts pack tree nodes into cache-friendly chunks:

- **Eytzinger order** — BFS order in an implicit array. Level 0 root at index 0, level 1 at indices 1-2, etc. Children of `i`: `2i+1`, `2i+2`. No explicit pointers; arithmetic gives child positions. Great for fixed-size static trees; rebuilding for inserts is `O(n)`.
- **van Emde Boas (vEB) layout** — recursive partitioning into top half and bottom blocks of size `√n`. Cache-oblivious: any reasonable cache size is matched by some recursive level. Discovered by Bender, Demaine, Farach-Colton (FOCS 2000).
- **B-tree in RAM** — fanout 8-16 per node, ~64-128 bytes per node, fits a cache line or two. Used by Rust's `BTreeMap`, Google's `absl::btree_set`, ClickHouse.

For a senior engineer the take-away: **the right tree layout depends on the access pattern and the cache hierarchy**, not just the asymptotic complexity. If you are choosing a tree implementation and you care about constants, evaluate at least Eytzinger and B-tree-in-RAM variants before settling on a pointer-based RB tree.

---

<a name="gc"></a>
## 5. Garbage Collection Interaction

In garbage-collected languages (Java, Go, C#, Python, JavaScript), every BST node is an object. A tree with 10 million nodes is 10 million live objects, all reachable, all scanned by the GC on every cycle.

### Impact on a generational GC

- **Young-generation overhead is small** — new nodes are allocated in the nursery and either promoted or freed quickly.
- **Old-generation cost is significant** — long-lived tree nodes sit in the old generation, get marked on every major GC, and contribute to GC pause time roughly proportional to their count.
- **Compaction cost** — a moving GC must update all references, including BST child pointers, when relocating nodes. This is one of the reasons compressed pointers help: less data to update.

### What this means for design

- **Keep trees small.** A million-node BST adds noticeable GC pressure in Java; ten million is painful; a hundred million may force you to switch to off-heap storage (Java's `sun.misc.Unsafe`, ByteBuffer-backed structures).
- **Use primitive collections when possible.** A `TreeMap<Integer, Integer>` boxes every key and value; `IntIntTreeMap` from Eclipse Collections or HPPC stores primitives and dramatically reduces GC load.
- **Consider off-heap structures for very large trees.** ChronicleMap, Aeron's archive structures, and many high-frequency-trading systems store ordered indexes off-heap to bypass GC entirely.
- **Reuse nodes.** Some implementations pool deleted nodes for reinsertion, avoiding allocator churn. Useful when the tree size oscillates around a mean.

In Go, the picture is similar but the impact is smaller because Go's GC scans only pointer-bearing words. Nodes that store primitives have lower scan cost; using a `struct` with no pointers (only int keys, child indices) approaches off-heap performance.

---

<a name="augmented"></a>
## 6. Augmented BSTs — Order Statistics, Intervals, Segment Sums

A standard BST answers **membership** queries (`does key k exist? where?`). Real applications often need richer queries:

- **Order statistics**: "what is the 47th smallest key?" or "what is the rank of key k?"
- **Interval overlap**: "given query interval `[a, b]`, return all stored intervals that overlap it."
- **Range sums**: "sum of all values whose keys lie in `[lo, hi]`."

The technique is **augmentation**: store a small piece of extra information at each node and maintain it as a BST invariant during insertion and deletion. CLRS Ch. 14 has the canonical treatment.

### 6.1 Order-statistic tree (size augmentation)

Add `size` to each node: `size(x) = 1 + size(x.left) + size(x.right)`. Maintain it on insert and delete (O(1) work per modified node along the path).

**Queries:**

```python
def get_rank(node, key):
    """Return the 1-indexed rank of key (number of keys <= key)."""
    rank = 0
    while node is not None:
        if key < node.key:
            node = node.left
        elif key > node.key:
            rank += size_of(node.left) + 1
            node = node.right
        else:
            return rank + size_of(node.left) + 1
    return rank
```

```python
def get_by_rank(node, k):
    """Return the k-th smallest key (1-indexed)."""
    while node is not None:
        left = size_of(node.left)
        if k == left + 1:
            return node.key
        if k <= left:
            node = node.left
        else:
            k -= left + 1
            node = node.right
    return None     # k out of range
```

Both queries: `O(h)`.

This is the standard solution for **percentile / quantile** queries on a streaming dataset, leaderboards ("what rank am I?"), and any "kth-smallest" problem on a dynamic set.

### 6.2 Interval tree

Each node stores an interval `[lo, hi]` and an augmentation `max_hi` = the maximum `hi` over the subtree. The BST is keyed on `lo`. Overlap query for `[a, b]`:

- If `node.max_hi < a`: no overlap in this subtree, prune.
- Otherwise recurse left, check the current node (`overlaps(node, [a,b])`), and recurse right only if `node.lo <= b`.

Used in calendar applications ("which meetings overlap this time slot?"), genome analysis (overlapping gene regions), and IP packet routing (longest prefix match in some implementations).

CLRS Section 14.3 covers interval trees in depth.

### 6.3 Segment-sum augmentation

Each node stores `subtree_sum = value + subtree_sum(left) + subtree_sum(right)`. Range-sum query `[lo, hi]`:

```
range_sum([lo, hi]) = sum_of(<=hi) - sum_of(<lo)
```

where `sum_of(x)` is implemented as a single root-to-x walk accumulating left-subtree sums. O(log n) per query when the tree is balanced.

Fenwick trees and segment trees often outperform augmented BSTs for static-keyed range sums (they are simpler and more cache-friendly), but augmented BSTs win when the key set itself is dynamic.

### Key principle

**Any associative function** can be augmented onto a BST, as long as:
- The function is computable from a node's value plus the augmentations on its two children.
- It is maintainable in O(1) per node-modification (so per-operation cost stays O(h)).

This makes BSTs (or more often their balanced variants) extraordinarily versatile substrates for "any-aggregate-over-range" queries.

---

<a name="cme"></a>
## 7. Concurrent Modification Semantics

When a tree is mutated during iteration, the iterator's invariants break: parent pointers may dangle, the next-in-inorder relationship may have changed, deleted nodes may be revisited.

Different libraries take different positions:

- **Java's `TreeMap`** — iterators are **fail-fast**: they throw `ConcurrentModificationException` on next mutation detection. Internally they snapshot the `modCount` field at iterator creation and compare on every `next()`.
- **C++'s `std::map`** — iterators are stable across **insertions** (insert never invalidates iterators to other nodes) but invalidated for the **deleted element only**. This is unusual and useful — you can iterate while deleting if you save the next iterator first.
- **Java's `ConcurrentSkipListMap`** — **weakly consistent** iterators: they reflect some recent state, do not throw, may or may not see concurrent mutations.

For senior engineers, the practical rules of thumb:

1. **Don't mutate while iterating** unless the container explicitly documents it.
2. **Snapshot first** if you need to iterate stably under concurrent writes — copy the keys into a list, iterate the list, look up each value from the live map.
3. **Use a copy-on-write collection** when readers vastly outnumber writers.
4. **Use a `ConcurrentSkipListMap` or `ConcurrentNavigableMap`** when you need ordered iteration with concurrent writers.

The pattern "log a `ConcurrentModificationException` once, ignore it, hope for the best" is the source of countless production bugs. Take the snapshot.

---

## Further Reading

- **Ellen, Fatourou, Ruppert, van Breugel.** "Non-blocking Binary Search Trees." PODC 2010. The first practical lock-free BST.
- **Howley & Jones.** "A Non-blocking Internal Binary Search Tree." SPAA 2012.
- **Driscoll, Sarnak, Sleator, Tarjan.** "Making Data Structures Persistent." J. Comp. Sys. Sci. 1989. The persistence taxonomy.
- **Okasaki.** *Purely Functional Data Structures*, Cambridge 1998.
- **CLRS** Ch. 14 — Augmenting Data Structures.
- **Bender, Demaine, Farach-Colton.** "Cache-Oblivious B-Trees." FOCS 2000.
- **Linux Documentation** — `Documentation/RCU/whatisRCU.txt` for RCU on tree-like structures.
- **OpenJDK source** — `java.util.TreeMap` for the fail-fast iterator pattern; `java.util.concurrent.ConcurrentSkipListMap` for weakly consistent iteration.
- Continue with `04-red-black` for the dominant production balancing scheme.
