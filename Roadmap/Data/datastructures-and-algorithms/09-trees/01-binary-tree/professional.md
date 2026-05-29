# Binary Tree — Professional Level

> **Audience:** Engineers writing latency-sensitive code, kernel modules, database internals, JIT runtimes, or any system where the constant factor of tree operations matters as much as the asymptotic. Prerequisites: `junior.md`, `middle.md`, `senior.md`.

This document is about the **physical** layer of binary trees — how pointer chasing actually translates into DRAM accesses, what arena allocators buy you, why van Emde Boas and Eytzinger layouts beat naive node layouts by 2–10×, how concurrent traversal works without locks, how pointer compression doubles cache density, how persistent (immutable) trees enable structural sharing, and a sketch of "fat trees" from networking that borrow the name but solve a very different problem.

---

## Table of Contents

1. [Pointer-Chasing Latency — the Numbers](#latency)
2. [Arena and Bump Allocators](#arena)
3. [Cache-Oblivious Layouts — van Emde Boas](#veb)
4. [Eytzinger Layout for Complete Trees](#eytzinger)
5. [Concurrent Traversal — RCU and Hand-Over-Hand](#concurrent)
6. [Pointer Compression — Compressed Oops](#compression)
7. [Persistent (Immutable) Trees — HAMT, Finger Trees](#persistent)
8. [Iterator Invalidation under Concurrent Modification](#invalidation)
9. [Fat Trees in Networking](#fattrees)

---

<a name="latency"></a>
## 1. Pointer-Chasing Latency — the Numbers

Recall the cache hierarchy (Intel Sapphire Rapids, 2023, representative):

| Level | Size | Latency |
|---|---|---|
| L1d | 48 KB / core | 5 cycles ≈ 1.4 ns @ 3.5 GHz |
| L2 | 2 MB / core | 14 cycles ≈ 4 ns |
| L3 (shared) | 1.875 MB × cores | ~50 cycles ≈ 15 ns |
| DRAM | depends | 200+ cycles ≈ 60–100 ns |
| Remote NUMA DRAM | | 250+ ns |

A tree walk that descends `h` levels, missing cache at every step, takes `h × 80 ns` minimum. For `h = 20` (balanced tree of 1M nodes) that's 1.6 µs **per lookup**. A `HashMap.get` on the same data costs ~50 ns (one cache miss to the bucket + one to the entry). The gap is 30×.

**Reality is worse than the table suggests.** Modern CPUs prefetch contiguous memory aggressively. An array scan of 1 million ints (4 MB) at 30 GB/s of DRAM bandwidth takes ~130 µs — but the prefetcher hides almost all the latency, so the CPU is rarely stalled. A pointer-chasing walk **cannot prefetch** because the next address is unknown until the current load completes. This is called a **dependent load** and is the bane of pointer-rich data structures.

Knuth, TAOCP v3 §6.5, has a tongue-in-cheek line: "*the asymptotic complexity is the same, but the constant is unkind*". For trees, the constant is set by cache behavior.

---

<a name="arena"></a>
## 2. Arena and Bump Allocators

The single highest-leverage fix for cache-unfriendliness: **allocate tree nodes contiguously**. An **arena** (or **bump allocator** or **region**) is a big preallocated buffer; you allocate by incrementing a pointer.

### Postgres `MemoryContext`

Postgres groups allocations into `MemoryContext`s (`src/backend/utils/mmgr/aset.c`). When the planner builds a plan tree, every `Plan` node is allocated in the planner's `MemoryContext`, packing them tightly. When the query completes, Postgres frees the *entire context* in one operation — no per-node free needed. Walking the plan tree later touches consecutive cache lines instead of scattered allocations.

### LLVM `BumpPtrAllocator`

LLVM allocates AST and IR nodes in `BumpPtrAllocator` (`llvm/Support/Allocator.h`). Construction is a single pointer increment; deallocation is a single pointer reset. Walking IR is fast because adjacent IR nodes are typically adjacent in memory.

### Hand-rolled in Go

```go
type NodePool struct {
    nodes []Node
}
func (p *NodePool) Alloc(val int) *Node {
    p.nodes = append(p.nodes, Node{Val: val})
    return &p.nodes[len(p.nodes)-1]
}
```

(In Go, beware that `append` may reallocate the backing array, invalidating earlier pointers. Use `make([]Node, 0, capacity)` with a known cap, or a linked list of slabs.)

### Effect

A tree of 1 million 64-bit-int nodes built with `new Node` everywhere in Java occupies ~40 MB (16-byte object header + 8 bytes value + two compressed-oop 4-byte pointers + 8-byte padding ≈ 40 bytes per node). Built in arenas, the same tree fits in roughly the same memory but is *contiguous* — meaning a cold tree walk can run 5–10× faster simply because the L2/L3 prefetcher recognizes the sequential access pattern.

---

<a name="veb"></a>
## 3. Cache-Oblivious Layouts — van Emde Boas

Bender, Demaine, Farach-Colton, "Cache-Oblivious B-Trees" (FOCS 2000), showed how to lay out a binary tree so that **any** cache walk of depth `h` causes only `O(h / log B)` cache misses, where `B` is the cache line size — *without* knowing `B` at compile time. The trick: the **van Emde Boas layout**.

### The recursive idea

Take a perfect binary tree of height `h`. Cut it horizontally at depth `h/2`. The top half is one subtree of height `h/2`. The bottom half is `2^(h/2)` subtrees of height `h/2`. Lay out **the top subtree first**, then each bottom subtree (in left-to-right order), each recursively laid out the same way.

Once a subtree's height fits in a cache line, the whole subtree comes into cache on one access. The recursion guarantees that subtrees-fitting-in-cache exist regardless of `B`.

```
Standard preorder layout (cache-unfriendly):
[root, root.left, root.left.left, ..., root.right, ...]

van Emde Boas layout (cache-oblivious):
[top-half-laid-out-recursively,
 first-bottom-subtree-laid-out-recursively,
 second-bottom-subtree-laid-out-recursively, ...]
```

### Result

Search performance is within a constant factor of B-trees tuned to the cache size — but without any tuning. "Cache-oblivious" doesn't mean ignorant of cache; it means optimal for *all* cache sizes simultaneously.

Used in: CGAL (computational geometry), some in-memory databases (HyPer, TUM's research engine), and in textbook-correctness benchmarks. Not yet in widespread production tree-map libraries, because B-trees + a known page size win in practice.

---

<a name="eytzinger"></a>
## 4. Eytzinger Layout for Complete Trees

A simpler and devastatingly effective layout for **read-only complete binary trees**: store the tree in an array with `root = index 0`, `left(i) = 2i+1`, `right(i) = 2i+2`. No pointers. The whole tree fits in a contiguous array. This is named after Michael Eytzinger, a 16th-century Austrian historian who used the same indexing for genealogies, but in CS it's known from heap implementations.

### Why it's so fast

- No pointer dereference per child — just integer arithmetic.
- Sequential L1 prefetching often pulls the next level into cache before you ask for it.
- `2i+1` and `2i+2` are adjacent → tend to be on the same cache line for small `i`.
- No GC pressure (no heap allocations per node).

### Where it's used

- **Binary heaps** (priority queues): the canonical Eytzinger user. `heapq` in Python, `PriorityQueue` in Java, `container/heap` in Go.
- **Segment trees** and **Fenwick trees**: array-backed for the same reason.
- **In-memory search indexes** for static data: Khuong & Morin, "Array Layouts for Comparison-Based Searching" (ACM JEA 2017), showed Eytzinger search beats `std::lower_bound` by 2× on hot data thanks to prefetching.
- **B+ tree leaf nodes**: each leaf node is itself a small Eytzinger-style sorted array, scanned linearly because of cache friendliness.

### When you can't use it

- The tree must be **mostly complete** — a skewed or sparse tree wastes most of the array.
- It must be **read-mostly** — inserts require shifting half the array on average.
- For dynamic trees, B-trees with large fanout (say 64-way) beat binary Eytzinger because each node's children all live in one cache line.

---

<a name="concurrent"></a>
## 5. Concurrent Traversal — RCU and Hand-Over-Hand

When multiple threads read a tree while one mutates it, naive code crashes (read could follow a pointer the writer just freed).

### Hand-over-hand locking (a.k.a. lock coupling)

Walk the tree holding a lock on the **current node** while you acquire a lock on the **child**. Release the parent's lock only after you have the child's. The walker never holds more than two locks. A writer doing the same can't deadlock readers.

```
walk(node):
    lock(node)
    while node.left:
        lock(node.left)
        unlock(node)        # release parent
        node = node.left
    ...
    unlock(node)
```

Used in early Berkeley DB and in academic B-tree research. Slow in practice (one CAS per node), but provably correct.

### RCU (Read-Copy-Update)

Linux kernel's standard pattern, by Paul McKenney (early 2000s). Readers walk the tree **without any lock**, just dereferencing pointers. Writers build a new copy of the modified subtree and atomically swap a single pointer in the parent. Old nodes are freed only after a **grace period** in which every CPU has passed through a quiescent state (no reader can still be holding a reference).

Used in: Linux `rcu` API, Linux `dcache` (directory entry cache, which is a tree), Linux page table walks, `liburcu` userspace library, much of the kernel's networking stack.

Readers are essentially free. Writers pay for the copy and the grace period. For read-mostly trees, the throughput improvement vs locks is enormous — often 10×+ at high core counts.

### Lock-free trees

Howley & Jones, "A Non-Blocking Internal Binary Search Tree" (SPAA 2012), and Natarajan & Mittal, "Fast Concurrent Lock-Free Binary Search Trees" (PPoPP 2014), give CAS-based wait-free or lock-free BSTs. Used in some research systems and in Java's `ConcurrentSkipListMap` (a related concurrent ordered structure). Production deployment is rare because the implementations are intricate and the wins over RCU + copy-on-write are small in practice.

---

<a name="compression"></a>
## 6. Pointer Compression — Compressed Oops

Until 2008, every Java object reference was a full 64-bit pointer on 64-bit JVMs. For pointer-heavy data structures like trees, where each node has 2–3 pointers and a small value, the pointer overhead dominated. HotSpot's **Compressed Oops** (Lindholm, Yellin, Bracha, Buckley, *The Java Virtual Machine Specification, Java SE 8 Edition*, §2.4 commentary; landed in JDK 6u14, 2009) replaces 64-bit pointers with 32-bit indices into a heap base. Decompression is a `shift + add` — essentially free.

Effect: a Java tree node shrinks from ~56 bytes to ~32 bytes (44% smaller). Twice as many nodes fit in cache. Tree walks roughly 2× faster.

Enabled by default for heaps under 32 GB (since 35 bits = 32 GB addressable with 3-bit shift). Disabled for larger heaps unless you use `-XX:+UseCompressedOops` with an alignment shift trick.

### Other examples

- **V8 (Chrome's JS engine)** introduced pointer compression in 2019 (V8 7.6). Same idea: 32-bit pointers within the JS heap. Memory savings of 40% on real pages.
- **Linux kernel** uses 32-bit indices into `mem_map` arrays instead of `struct page *` pointers in many places.
- **CockroachDB** stores keys as offsets into a slab rather than full pointers in its B-tree nodes.

For a custom tree in C++, if you know the arena fits in 4 GB, you can use `uint32_t` indices into the arena instead of full pointers, halving node size at the cost of a base-address addition on each access.

---

<a name="persistent"></a>
## 7. Persistent (Immutable) Trees — HAMT, Finger Trees

A **persistent** data structure keeps all previous versions accessible after a modification. The most economical way to implement one is via **structural sharing**: a modification creates a new root and a few new internal nodes along a path; the unchanged subtrees are shared with the old version.

### Clojure's PersistentHashMap — HAMT

Phil Bagwell, "Ideal Hash Trees" (EPFL Tech Report 2000), introduced the **Hash Array Mapped Trie** (HAMT). Clojure's `PersistentHashMap` (Rich Hickey, 2007) is a HAMT with 32-way branching. Each "trie" level dispatches on 5 bits of the hash, giving height `log₃₂(n)` ≈ 6 for billion-element maps. Modification creates O(log n) new nodes; the rest of the tree is shared with the previous version.

Scala's immutable `Map` and `Set`, Elixir's `Map`, and Rust's `im` crate all use HAMT variants. They are the gold standard for "functional" hash maps.

### Haskell's `Data.Map`

A balanced binary tree implemented in Haskell, fully persistent. Inserting into a 1-million-element map creates ~20 new nodes (one per path-from-root level) and shares everything else. The old map is still valid and unchanged.

### Scala `Vector`

A 32-way trie that gives O(log₃₂ n) random access. Used as the default immutable indexed sequence. Same idea as HAMT but indexed by integer, not by hash.

### Finger trees

Hinze & Paterson, "Finger Trees: A Simple General-purpose Data Structure" (JFP 2006). A more general persistent tree that supports O(1) access to both ends and O(log n) split/concat. Used in Haskell's `Data.Sequence` and in Clojure's persistent queues.

### Why this matters

Persistent trees give you **snapshot semantics for free**. Every previous version of a Clojure map is still accessible — no copying. Reasoning about concurrent code becomes much easier (no mutation = no races). Time-travel debugging, transactional memory, and undo/redo all become trivial.

The cost: every "modification" allocates O(log n) new nodes, which means more GC pressure than in-place mutation. For some workloads (immutable views over write-once data) this is a free win; for hot mutation loops, it's a serious cost.

---

<a name="invalidation"></a>
## 8. Iterator Invalidation under Concurrent Modification

In `java.util.TreeMap`, iterating while another thread modifies the tree throws `ConcurrentModificationException` on the next iteration step — a **fail-fast** behavior implemented via a `modCount` field bumped on every structural change. The iterator caches the `modCount` it saw at construction time and checks every `next()`.

In C++'s `std::map`, the rules are weaker: insertions don't invalidate iterators (because rotations don't move nodes); only erasures invalidate the iterator pointing at the erased node. Iterators to other nodes remain valid through arbitrary insert/delete sequences. This is a load-bearing guarantee on top of which many algorithms are written.

For lock-free / RCU trees, iterators see a consistent **snapshot** because readers traverse pointers that the writer can't have freed yet (grace period not over). The iterator is "stable" in the sense that it returns valid data, but it may not see the latest modifications — a deliberate design choice.

For persistent trees, the question is moot: every version is immutable, so iterators over version `v` are always valid regardless of what version `v+1` looks like.

If you build your own concurrent tree, decide and document one of:
- **Fail-fast** (Java approach): cheap to implement, helps detect bugs, but limits use cases.
- **Strong stability** (`std::map`): invalidate only iterators to erased nodes.
- **Snapshot semantics** (RCU): walk a consistent point-in-time view, miss later mutations.
- **Locked**: take a global tree lock for the duration of iteration. Simple but kills concurrency.

---

<a name="fattrees"></a>
## 9. Fat Trees in Networking

The term "fat tree" comes from Charles Leiserson, "Fat-trees: Universal Networks for Hardware-Efficient Supercomputing" (IEEE Trans. Computers, 1985), and is **completely unrelated to binary search**. A fat tree is a topology used to wire up large clusters (today's "Clos networks" in data centers, used by Facebook, Google, Microsoft). The defining feature: **edges closer to the root have higher bandwidth** (they are "fatter") so that aggregate bandwidth doesn't bottleneck at the root.

Why mention it here? Because you'll encounter the phrase in distributed systems and people sometimes assume it's a CS data structure. It isn't — it's a network topology. But the *concept* — a hierarchical structure where the higher levels have more capacity — appears in software too:
- Tiered caches (L1 small/fast, L3 large/slow — capacity grows toward the root of the lookup hierarchy).
- Hash-array-mapped tries with wide branching at the root.
- Distributed query layers where the coordinator can handle more requests than any single shard.

The networking sense is the original; the data-structure sense is borrowed.

---

## Summary

- Pointer chasing on a cold tree costs **60–100 ns per hop**. A 20-deep walk is 1.6 µs. Hash-map lookup of the same data is ~50 ns. Plan around this.
- **Arena allocators** (Postgres `MemoryContext`, LLVM `BumpPtrAllocator`) pack nodes contiguously — 5–10× tree-walk speedup essentially for free.
- **van Emde Boas layout** is cache-oblivious — optimal for *all* cache sizes without tuning.
- **Eytzinger layout** (array-backed complete tree) eliminates pointers entirely — fastest possible binary tree, but only works for static or rare-update workloads.
- **RCU** (Linux) makes reads lock-free and writes copy-on-write. The standard pattern for read-mostly trees in the kernel.
- **Compressed pointers** (JVM oops, V8 since 2019) halve pointer size — twice the cache density.
- **Persistent trees** (HAMT in Clojure, balanced trees in Haskell `Data.Map`, finger trees in `Data.Sequence`) give snapshot semantics via structural sharing. Cost: O(log n) allocations per modification.
- **Iterator invalidation** policies vary (`std::map` strong-stability, Java fail-fast, RCU snapshot, persistent always-valid). Pick and document one explicitly when building a tree-like API.
- **Fat trees** in networking are a topology, not a data structure — but the "fatter near the root" idea recurs in software.

The recurring theme: at production scale, **the data structure is the memory layout**. The abstract binary tree from `junior.md` is one of dozens of physical realizations of the same logical shape, each with different latency, throughput, and concurrency characteristics. Choosing the right realization is the senior-to-staff engineering call.
