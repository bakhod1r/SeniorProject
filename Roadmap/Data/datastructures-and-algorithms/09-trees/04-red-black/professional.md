# Red-Black Tree — Professional Level

> **Audience:** Engineers designing or optimizing the data structures they ship, working on language runtimes, OS kernels, or high-performance databases. Prerequisite: `senior.md`.

This file covers the topics that decide whether an RB tree is the right or wrong choice at the limits — cache behavior on large trees, lock-free and RCU-friendly variants, persistent path copying, tag-pointer tricks, the WAVL unified framework, and cache-conscious node packing that bridges to B-trees.

---

## Table of Contents

1. [Cache Analysis on Large RB Trees](#cache)
2. [Lock-Free RB Trees — Howley & Jones 2012](#lock-free)
3. [RCU-Friendly RB Trees in the Linux Kernel](#rcu)
4. [Persistent Path Copying](#persistent)
5. [Tag-Pointer Trick — Color in the Pointer Low Bit](#tag-pointer)
6. [WAVL Trees as a Unified Framework](#wavl)
7. [Cache-Conscious Node Packing — Bridge to B-Trees](#b-tree)

---

<a name="cache"></a>
## 1. Cache Analysis on Large RB Trees

A red-black tree node in a typical 64-bit user-space implementation occupies:

- 8 bytes color word (1 bit color + padding, or 1-byte color + 7-byte padding due to alignment)
- 24 bytes for left/right/parent pointers
- 8 bytes for the key (if int64), more if a pointer-to-struct
- 8-16 bytes for the value (if a pointer)
- Total: **40-56 bytes per node** depending on layout

A 64-byte L1 cache line holds **one node plus a tiny slice of another**. Every step down the tree is a cache miss, because RB tree nodes are allocated separately on the heap and end up scattered.

For `n = 10⁶`, tree height `h ≈ 20`. A lookup performs up to 20 dependent memory accesses. With L1 hit latency 1 ns, L2 ~3 ns, L3 ~12 ns, and DRAM ~80-100 ns, the dominant factor is which cache the node sits in. Hot nodes (root, leftmost branch) live in L1; cold nodes that haven't been touched recently live in DRAM.

A back-of-envelope estimate for a random lookup in a 10⁶-node RB tree on a modern Intel x86 server:
- Top 1024 nodes (~5 levels) — L1 hit, ~1 ns each = 5 ns
- Next ~32k nodes (5-10 levels) — L2 hit, ~12 ns each = 60 ns
- Bottom 5-10 levels — L3 or DRAM, mostly L3, ~30 ns each = 150-300 ns
- **Total: ~200-350 ns per lookup**

By comparison, a B-tree with branching factor 16 (a typical CPU-tuned in-memory B-tree, e.g., immutable-data B-tree from `BTreeMap` in Rust's `std::collections`) for the same `n = 10⁶`:
- Height `log₁₆(10⁶) ≈ 5`
- Each node is ~256 bytes (4 cache lines), but the comparisons within a node are CPU-cached
- ~5 cache misses total
- **Total: ~100-150 ns per lookup**

So **for large in-memory ordered sets, a B-tree beats an RB tree on lookup by ~2×**. This is the headline result of Bender et al.'s "Cache-Oblivious B-trees" (FOCS 2000) and Bronson et al.'s "A Practical Concurrent Binary Search Tree" (PPoPP 2010). It is why Rust chose `BTreeMap` rather than an RB tree for its standard library — Alex Crichton wrote a long blog post in 2014 explaining the choice on cache-locality grounds.

For small to medium trees (`n < 10⁵`), the tree fits in L2 cache and the gap vanishes. RB trees win on simplicity.

---

<a name="lock-free"></a>
## 2. Lock-Free RB Trees — Howley & Jones 2012

Making an RB tree thread-safe with mutexes is straightforward (one big lock per tree) but does not scale. Fine-grained locking on tree nodes is harder than for skip lists or hash tables because rotations need to atomically swap multiple parent/child pointers — a single CAS can't update three pointers at once.

**Howley & Jones, "A Non-Blocking Internal Binary Search Tree"** (SPAA 2012) describes a non-blocking RB tree using helper records. The idea:
1. Every modification first publishes a **descriptor** record describing the intended change (rotation, recolor, insertion).
2. Other threads observing the descriptor either help complete the operation or wait.
3. The actual pointer swaps are done one at a time via CAS, using the descriptor to coordinate.

The algorithm is correct under TSO/SC memory models with appropriate fences. Performance is competitive with skip lists for read-mostly workloads but lags for write-heavy ones because of the descriptor allocation overhead.

**Production status:** Not widely adopted. Most concurrent ordered maps (`ConcurrentSkipListMap` in Java, `concurrent_map` in TBB, `crossbeam-skiplist` in Rust) use skip lists or hash tries instead. RB trees remain mostly single-threaded.

**Why skip lists win for concurrency:** No restructuring; only the local node and its forward pointers are touched. A single CAS per level suffices for insert. No rotation means no multi-pointer atomicity problem.

---

<a name="rcu"></a>
## 3. RCU-Friendly RB Trees in the Linux Kernel

The Linux kernel pioneered **RCU** (Read-Copy-Update) — a synchronization technique where readers run lock-free while writers atomically swap in a new version, deferring the freeing of old versions until all pre-existing readers have left their critical sections.

Naive RB tree mutation is incompatible with RCU because rotations modify pointers that concurrent readers are following. The Linux kernel handles this via two techniques:

1. **`rb_replace_node()`** atomically swaps one node for another using a single pointer write. The replacement node must be pre-built with all the correct child/parent pointers. Useful for in-place updates where the key changes but the tree structure does not.

2. **For structural changes (insert/delete with rebalance), serialize writers with a regular spinlock** and let readers traverse without locks. Readers may see stale color information or briefly read from a node mid-rotation, but the BST property is maintained throughout so the lookup still finds the right element (or correctly reports absent).

The kernel's `rb_first()`, `rb_next()`, and `rb_prev()` are **not** safe to call under RCU without a lock — they require the writer-lock or the caller's own synchronization. Lookups using a user-written comparator are safe under RCU as long as the comparator only reads stable fields and the lookup tolerates seeing nodes mid-restructure.

For applications that need fully lock-free read traversal (like the VMA tree under heavy fork/exec workloads), the Linux kernel migrated to the **Maple tree** in 2022, which is designed from the ground up for RCU reads.

---

<a name="persistent"></a>
## 4. Persistent Path Copying

We saw Okasaki's persistent RB tree in `middle.md`. The technique generalizes:

**Path copying.** Every update returns a new root. The new root and the new spine (the path from root to the modified node) are freshly allocated; all subtrees off the spine are shared (pointer-equal) with the old version.

Cost per update: O(log n) new allocations (one per level on the spine). Cost per read: O(log n) pointer chases (identical to non-persistent). Memory overhead per persistent version: O(log n) new nodes — most of the structure is shared.

**Use cases:**
- **MVCC databases.** Each transaction sees a consistent snapshot. CouchDB, Datomic, Datascript.
- **Functional programming.** Haskell `Data.Map`, Clojure `PersistentTreeMap`, Scala `TreeMap`.
- **Editor undo/redo.** Each keystroke is a new persistent version; "undo" is just `current = previous`.
- **Time-travel debugging.** Trace every prior state in O(log n) extra space per step.

**The trade-off.** Path copying gives you O(log n) cost per update including the allocation churn. If you do N updates, you allocate ~N · log n nodes. A GC has to clean up the old ones eventually. In a non-GC language (Rust, C++) you use a refcounted Arc/shared_ptr per node, paying for the atomic increments and decrements.

For workloads where structural sharing pays off (MVCC, undo), the overhead is well worth it. For workloads where you just want a fast mutable map, plain in-place RB beats persistent RB by ~3-5× on insert.

---

<a name="tag-pointer"></a>
## 5. Tag-Pointer Trick — Color in the Pointer Low Bit

On 64-bit systems with standard heap alignment (`malloc` returns 8- or 16-byte-aligned pointers), the **low 3 or 4 bits of every heap pointer are guaranteed zero**. You can use those bits as tags without affecting the pointer's ability to be dereferenced.

The Linux kernel uses this to store the color in the parent pointer:

```c
struct rb_node {
    unsigned long __rb_parent_color;   // (parent_addr | color)
    struct rb_node *rb_right;
    struct rb_node *rb_left;
};

#define rb_parent(r)   ((struct rb_node *)((r)->__rb_parent_color & ~3))
#define rb_color(r)    ((r)->__rb_parent_color & 1)
#define rb_is_red(r)   (rb_color(r) == 0)   // by convention
#define rb_is_black(r) (rb_color(r) == 1)
```

Savings: 8 bytes per node (the dedicated color field that would otherwise be padded to 8 bytes). For a tree with 1M nodes, that is 8 MB of memory saved and potentially one fewer cache line per node loaded.

**Catches:**
- Requires that every pointer to a node is at least 8-byte aligned. If your allocator might return 4-byte-aligned addresses (some embedded systems, some custom slab allocators), the trick breaks.
- Bit-fiddling makes the code harder to read and debug. The kernel uses inline macros to keep it readable but every developer touching the code must remember the convention.
- Atomic operations on `__rb_parent_color` need to consider that color changes and parent-pointer changes share the same word — usually fine since both happen under the same writer lock.

In user-space code, the saving is usually not worth the complexity. Most languages don't expose pointer arithmetic safely (Java, Go, Python — impossible; C++ — possible but unidiomatic). In kernel/embedded code where memory matters, the trick is standard.

---

<a name="wavl"></a>
## 6. WAVL Trees as a Unified Framework

In 2015, Bernhard Haeupler, Siddhartha Sen, and Robert Tarjan published *"Rank-Balanced Trees"* (ACM TALG), introducing **WAVL trees** (Weak AVL trees) as a unified framework that interpolates between AVL and red-black.

The key insight: both AVL and RB are special cases of a more general scheme where each node has a **rank** (a non-negative integer) and the tree satisfies "rank-balanced" invariants:
- AVL: rank differences between parent and child are exactly in `{1, 2}`.
- WAVL: rank differences are in `{1, 2}` for non-leaves, but leaves have rank 0 with parent rank 1.
- RB: rank = black-depth; rank differences are in `{0, 1}` and red nodes are exactly the "rank-0-difference children".

The unified rank machinery means a single rebalancing algorithm handles all three trees, parameterized by which invariant you want. WAVL itself gives:
- Height bound `~1.44·log₂(n)` (same as AVL — tighter than RB).
- Amortized O(1) rotations per update (same as RB — better than AVL).

So WAVL is "AVL's height with RB's rotation cost". Tarjan's paper proves the bound rigorously via potential-function analysis.

**Production status:** WAVL is theoretically elegant but has not displaced RB in standard libraries. The C++ STL, Java JDK, Linux kernel all stuck with RB because:
- The implementation is no simpler than RB.
- The benefit (slightly tighter height) is below the noise on cache-bound workloads.
- The institutional knowledge around RB is decades deep.

WAVL appears in research codebases and as the answer to "what's the next balanced BST?" interview questions, but production systems have not migrated.

---

<a name="b-tree"></a>
## 7. Cache-Conscious Node Packing — Bridge to B-Trees

If we step back from "binary tree" and ask "what node shape best uses one cache line?", we get to **cache-conscious B-trees**. A typical CPU cache line is 64 bytes; for a typical key (8-byte int), one cache line holds about 7 keys plus 8 child pointers — i.e., one node of an in-memory B-tree of order ~7-8.

A B-tree of order 16 holding `n = 10⁶` elements has height `log₁₆(10⁶) ≈ 5`. Compared to an RB tree of height ~22, that is 4× fewer cache misses per lookup, and each cache miss is the same ~80 ns of DRAM latency. Net: **roughly 4× faster lookup on a cold tree**.

This is why:
- Rust's `std::collections::BTreeMap` uses an in-memory B-tree of order 6 (so 5-11 keys per node) rather than an RB tree.
- `absl::btree_map` (Google's Abseil) uses an in-memory B-tree.
- C++'s `std::map` is still RB — for API compatibility (iterator stability under insert/delete is hard to maintain in a B-tree).
- The kernel migrated VMAs to the Maple tree (a kind of B-tree).

When does the RB tree still win?

1. **Small trees** (`n < 10³`): everything fits in L2; the B-tree's wider nodes don't help.
2. **API guarantees that require pointer stability** (`std::map`-style iterators): hard in B-trees.
3. **Intrusive embedding**: an `rb_node` is 24 bytes; a B-tree node embedded in user code would have to dynamically grow.
4. **Educational value**: B-trees are harder to teach and implement than RB trees.

The pedagogical bridge: a 2-3-4 tree is a B-tree of order 4, and an RB tree *is* a 2-3-4 tree in disguise (see `middle.md` section 2). So you can think of the RB → B-tree progression as "stop disguising the multi-key nodes; just use them directly". Once node size grows above one cache line, the binary encoding is no longer a win.

For the rest of your career, the rule is approximately:
- **Tiny ordered set, simple API:** Use the language's `TreeMap` / `std::map` (RB tree underneath).
- **Big ordered set, throughput matters:** Use an in-memory B-tree (`BTreeMap` in Rust, `absl::btree_map`, etc.).
- **Disk-resident ordered set:** Use a B+ tree (PostgreSQL, MySQL, LMDB).
- **Concurrent ordered set:** Use a skip list (`ConcurrentSkipListMap`, `crossbeam-skiplist`).

RB trees remain the default for "no thinking required" — but knowing when to reach for a wider-fanout structure is what distinguishes a senior engineer from a principal.

---

## Where to Go Next

- `interview.md` — Coding problems built on RB tree operations and `TreeMap`/`TreeSet` APIs.
- `tasks.md` — Implementation tasks: write the full delete, build LLRB, microbenchmark vs AVL.
- The follow-up topic in `05-trie` covers prefix trees — a structurally simpler but conceptually different balanced tree.
