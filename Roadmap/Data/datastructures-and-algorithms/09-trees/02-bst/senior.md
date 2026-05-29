# Binary Search Tree — Senior Level

> **Audience:** Engineers who already understand BSTs algorithmically and want to know where ordered-tree structures live inside the systems they touch every day — operating system kernels, standard libraries, database engines, and language runtimes. This document is a tour of where BST-family structures actually run in production.

We made the case in `middle.md` that **vanilla** BSTs don't ship. But **balanced** BSTs — Red-Black trees in particular — are ubiquitous. This document is the field guide: which production system uses which variant for which job, and what trade-offs the implementers made. We also cover the cache story: why a sorted array beats any BST for read-only data on modern hardware.

---

## Table of Contents

1. [`std::set` / `std::map` Internals — libstdc++ and libc++](#stl)
2. [Java `TreeMap` / `TreeSet` — Red-Black Since 1.2 (1998)](#java)
3. [The Linux Kernel's `rbtree`](#rbtree)
4. [BSTs in Language Runtimes and Compilers](#runtimes)
5. [The Hash-Collision DoS Story — BSTs as a Mitigation](#dos)
6. [Memory-Mapped and On-Disk Ordered Maps (LMDB and Friends)](#mmap)
7. [Why Databases Prefer B-trees Over BSTs](#b-vs-bst)
8. [Cache Effects: Sorted Array vs BST](#cache)

---

<a name="stl"></a>
## 1. `std::set` / `std::map` Internals — libstdc++ and libc++

The C++ standard library's `std::set`, `std::map`, `std::multiset`, and `std::multimap` are typically implemented as **Red-Black trees** — a self-balancing BST family covered in detail in `04-red-black`. They are **not** raw unbalanced BSTs.

**Evidence:** In **libstdc++** (GCC's STL), the source lives at `libstdc++-v3/include/bits/stl_tree.h`. The implementation is an explicit red-black tree (`_Rb_tree`) with parent pointers, color bits, and the classic five RB invariants. **libc++** (Clang/LLVM) ships an equivalent in `<__tree>`. **MSVC's STL** likewise uses RB trees.

The standard mandates the operational complexity (`O(log n)` for insert/find/erase) and ordered iteration, but **not** the implementation. In principle a vendor could use an AVL tree or a skip list; in practice every mainstream implementation since the late 1990s has chosen red-black trees because they:

- Guarantee `O(log n)` worst case, not just expected.
- Rotate less often than AVL on insertion (≤ 2 rotations vs. AVL's potential cascade), giving better throughput on write-heavy workloads.
- Have a well-understood proof of correctness and a small set of cases (LL/LR/RL/RR rotations) that fits in a CPU's instruction cache.

The lesson: when you write `std::map<int, std::string>`, you are using a balanced BST with parent pointers and color bits — but the **API** is just "ordered map", and the standard doesn't tell you which balance scheme.

The unordered counterparts `std::unordered_map` / `std::unordered_set` (added in C++11) are hash tables. They beat the tree-based map by ~3-5× for exact lookups but offer no ordering and no range queries.

---

<a name="java"></a>
## 2. Java `TreeMap` / `TreeSet` — Red-Black Since 1.2 (1998)

Java's `java.util.TreeMap` (and `TreeSet`, which is a thin wrapper around `TreeMap`) is a **red-black tree** and has been since JDK 1.2, released December 1998. The implementation source has changed only superficially across Java versions; the algorithm is straight out of CLRS.

The class Javadoc states: *"The implementation provides guaranteed log(n) time cost for the containsKey, get, put and remove operations. Algorithms are adaptations of those in Cormen, Leiserson, and Rivest's Introduction to Algorithms."*

What this means for you, as a Java engineer:

- `TreeMap.put` is **O(log n) guaranteed**, not "O(log n) expected" or "O(log n) amortized". The red-black invariant is maintained after every insertion.
- `TreeMap.firstKey()`, `lastKey()`, `floorKey(k)`, `ceilingKey(k)`, `headMap(k)`, `tailMap(k)`, `subMap(lo, hi)` all run in O(log n) — these are direct exposures of BST primitives: leftmost/rightmost descent, successor/predecessor, range queries.
- `TreeMap.entrySet().iterator()` walks the tree in inorder. Iteration is `O(n)` total, `O(1) amortized` per `next()` thanks to parent pointers and the standard BST-iterator trick (covered in LC 173).
- `NavigableMap` (the interface `TreeMap` implements) was added in Java 1.6 specifically to expose successor / predecessor / range operations that hash maps cannot provide.

The companion **`ConcurrentSkipListMap`** is a *skip list*, not a tree. It exists because lock-free RB tree implementations are notoriously hard; skip lists are easier to make lock-free using compare-and-swap on individual level pointers. We cover skip lists in `05-basic-data-structures/05-skip-list`.

---

<a name="rbtree"></a>
## 3. The Linux Kernel's `rbtree`

The Linux kernel ships a generic red-black tree at `include/linux/rbtree.h` and `lib/rbtree.c`. It is one of the most-used data structures in the kernel — let's list the consumers:

### 3.1 CFS (Completely Fair Scheduler)

The CFS scheduler (the default Linux process scheduler since 2.6.23 in 2007) maintains a per-CPU **red-black tree of runnable tasks**, keyed by **virtual runtime** (`vruntime`). Picking the next task to run is a `rb_first()` call — the leftmost node has the minimum `vruntime` — which is `O(log n)` in the worst case but constant in practice because CFS caches the leftmost pointer. Updating a task's `vruntime` is `rb_erase()` + `rb_insert()`.

Source: `kernel/sched/fair.c`. The structure is named `cfs_rq->tasks_timeline`.

### 3.2 Virtual Memory Areas (VMAs)

Each Linux process has a set of **virtual memory areas** describing its address space layout: code, stack, heap, mmap'd files, shared libraries, etc. These VMAs are stored in a red-black tree keyed by the VMA's starting virtual address, so the kernel can answer "which VMA contains address X?" in `O(log n)` via a standard BST `floor` query.

Source: `mm/mmap.c`, struct `mm_struct` field `mm_rb`. (Linux 6.1, October 2022, partially replaced this with the **maple tree** for better lockless reads — but the rbtree was in service from 2.6.x through 6.0, a span of 17 years.)

### 3.3 ext3 / ext4 directory hashed tree index

ext3/4's HTree directory index uses a hash-based B-tree, not an rbtree directly — but the **dcache** (directory entry cache) used rbtrees for some lookups historically. The point is the kernel's `rbtree` is used wherever ordered-by-key access is needed at scale.

### 3.4 Other consumers

- **`/proc` / `/sys` filesystem entries** — registered handlers indexed by name in rbtrees.
- **Userspace tracing (uprobes)** — uprobe locations.
- **The Btrfs filesystem** — the namesake "B-tree filesystem" uses CoW B-trees, but its in-memory caches use rbtrees.
- **The Network Block Device** and various drivers — interval/range trackers.

The kernel's `rbtree` is **intrusive**: instead of a generic `void *` payload, the user struct embeds a `struct rb_node` field. Insertion expects the caller to supply the comparison function inline. The macros `rb_entry()` / `container_of()` recover the outer struct. This avoids the per-node allocation that a generic tree would need — important when the data structure stores millions of entries.

The big point for senior engineers: **red-black trees are everywhere in the kernel**, and when a kernel developer mentions "rbtree" they mean *that specific structure*, with the API and the invariants documented in `Documentation/core-api/rbtree.rst`.

---

<a name="runtimes"></a>
## 4. BSTs in Language Runtimes and Compilers

- **Python's `dict` is NOT a tree** — it's a hash table (open addressing, since CPython 3.6 with insertion-order preservation as a side effect of the dense layout). For an *ordered* map, you reach for `collections.OrderedDict` (also hash-based, with a doubly linked list for order) or the third-party `sortedcontainers.SortedDict` (a sorted-list-of-sorted-lists structure, *not* a BST — it's chosen for cache-friendliness over a tree).
- **JavaScript's `Map`** — V8 (Chrome / Node.js) implements `Map` as a hash table with insertion-order linked-list overlay. JavaScript has no built-in ordered-by-key map.
- **Ruby's `Hash`** — also hash + linked list for insertion order.
- **Go's `map`** — hash table (Swiss-table-like layout since 1.24).
- **C# `SortedDictionary` and `SortedSet`** — *red-black trees* (per the .NET reference source). `SortedList` is a sorted-array-of-pairs (O(log n) lookup, O(n) insert).
- **Scala `TreeMap`** — red-black tree.
- **Rust `BTreeMap` / `BTreeSet`** — a **B-tree**, not a binary search tree. Rust deliberately picks the B-tree because it is cache-friendlier and faster than a binary RB tree at typical sizes.

So "ordered map" in your language is almost always a balanced BST or a B-tree. The pure binary form (red-black) dominates in C++, Java, C#, Scala; the B-tree form is preferred in Rust and most database engines (see §7 below).

### Compilers and type checkers

BST-family structures appear in:

- **Type-checker symbol tables.** Many compilers maintain an environment as an immutable map (functional language compilers especially). The standard implementation is a **persistent red-black tree** or a **persistent finger tree**; we touch on persistent BSTs in `professional.md`.
- **Constant-pool deduplication.** Some compilers deduplicate string literals using ordered maps so that they can also be range-queried for debug-info generation.
- **Register allocator** "live interval" structures often use interval trees (an augmented BST — `professional.md`).

---

<a name="dos"></a>
## 5. The Hash-Collision DoS Story — BSTs as a Mitigation

In 2011, a famous talk at 28C3 ("Effective Denial of Service attacks against web application platforms" by Klink and Wälde) showed that **hash-table-based** request parameter parsers in PHP, Python, Ruby, Java, and ASP.NET were vulnerable to attacker-crafted inputs that all hashed to the same bucket, degrading the hash table to `O(n²)` insertion. A single HTTP POST with 10,000 carefully chosen form fields could pin a CPU for minutes.

The standard fix is **per-process hash randomization** (e.g., Python's `PYTHONHASHSEED`, glibc's `_Py_HashSecret`). But some platforms chose a different route: **fall back to a tree-based structure when a single hash bucket grows beyond a threshold.**

- **Java's `HashMap`** since Java 8 (2014) does exactly this: when a bucket's linked-list chain exceeds 8 entries (and the table has at least 64 buckets), the chain is converted to a **red-black tree**. Lookups within that bucket become `O(log n)` instead of `O(n)`, capping the DoS damage. The treeification threshold is `TREEIFY_THRESHOLD = 8` in the source.

- **PHP, Ruby, Python** stayed with hash randomization rather than tree-fallback; the implementation cost was lower.

For a senior engineer, the takeaway is that the choice between "hash table" and "ordered tree" is sometimes not exclusive — **Java's HashMap is a hash table that uses a BST as a structural mitigation against adversarial inputs**. The BST contains the worst-case bound that the hash table cannot guarantee.

---

<a name="mmap"></a>
## 6. Memory-Mapped and On-Disk Ordered Maps (LMDB and Friends)

**LMDB** (Lightning Memory-Mapped Database, by Howard Chu, 2011) is an embedded key-value store used by **OpenLDAP**, **Monero**, and many others. LMDB stores data in a **B+-tree** mapped directly into the process's address space via `mmap`. Reads bypass the kernel page cache entirely; the database file *is* the memory.

LMDB isn't a BST — it's a B+-tree — but the *idea* generalizes: the on-disk format is an ordered tree, the in-memory access path is a sequence of pointer chases through `mmap`'d pages, and the same correctness reasoning (ordering invariant, balanced height, split/merge on insert/delete) applies. The reason B+-trees won here is the page-fanout argument from §7.

**SQLite**, **PostgreSQL** indexes, **MySQL InnoDB** primary key storage — all use B-tree variants for the same reason. The closest thing to an on-disk *binary* tree in mainstream use is the WAL-style **LSM tree** (LevelDB, RocksDB, Cassandra, ScyllaDB), which is a layered ordered structure but not a per-record binary tree at all.

---

<a name="b-vs-bst"></a>
## 7. Why Databases Prefer B-trees Over BSTs

A 2-3 line summary of the argument (full treatment in `09-trees/08-b-tree`):

- A modern disk reads in **pages** of 4 KB or 16 KB. The cost of fetching one page is the same as fetching one byte from it. So you want each "node" to hold **as many keys as fit in a page** — typically 100–1000.
- A B-tree of fanout 200 over 1 billion records has height `log_200(10⁹) ≈ 4`. A BST has height `log_2(10⁹) ≈ 30`. Same data, **30 disk seeks vs. 4** — a 7.5× speedup that translates directly to query latency.
- The B-tree doesn't waste in-page scanning: within a page, you do a small linear or binary scan, which is L1-cache-friendly because the page is already loaded.

The in-memory analog of "page" is "cache line" (64 bytes on x86). Cache-oblivious BSTs (van Emde Boas layout, Bender et al., FOCS 2000) and explicit cache-aware structures (B-trees, fractal trees) capture similar wins for RAM-resident workloads. We touch on this in §8.

So when the data lives on disk (or even in slower memory tiers) and the working set is huge, **you want a B-tree, not a BST**. The binary structure is the right teaching abstraction, but production storage almost always picks fatter, page-sized nodes.

---

<a name="cache"></a>
## 8. Cache Effects: Sorted Array vs BST

For **read-only** data, a sorted array with binary search **beats** a balanced BST on modern hardware. Here is the back-of-envelope reasoning.

### Memory hierarchy (Intel Skylake, approximate)

| Level | Capacity | Latency |
|---|---|---|
| L1 cache | 32 KB / core | 4 cycles |
| L2 cache | 256 KB / core | 12 cycles |
| L3 cache | 8 MB shared | 40 cycles |
| Main RAM | GB+ | 150–250 cycles |

A cache miss costs ~50× a cache hit.

### Binary search on a sorted array

A binary search on `n = 1M` `int32` keys touches `⌈log₂(1M)⌉ = 20` indices. The array is 4 MB and partially fits in L3. Importantly, **the first half-dozen iterations hit indices that are accessed by *every* search**, so the top of the implicit binary tree (the middle of the array, the quartiles, the octiles) lives permanently in the L1 cache. Only the last 4-5 iterations miss into L2/L3/RAM.

### Walk through a balanced BST

Every BST node is a heap allocation: 4 bytes of key, 8 bytes per child pointer (16 total on a 64-bit system), 8 bytes for a parent pointer if used, possibly 1 byte for a color bit padded to 8. **Per-node footprint: 32–40 bytes.** 1M nodes = 32-40 MB, larger than L3.

Each step of a BST search jumps to a different heap address. The cache doesn't know where the next jump will go, so it can't prefetch. Every step is a likely cache miss.

### Net effect

For `n = 10⁶`, sorted-array binary search routinely outperforms a BST by 2-3×, despite making the same number of comparisons. For `n = 10⁹` the gap widens because the lower BST levels miss into RAM.

### Mitigations

- **Eytzinger layout** — store the implicit binary tree in BFS order in an array. Index `i`'s children are at `2i+1` and `2i+2`. Cache-friendlier than pointer chasing, and the standard implementation in modern competitive-programming codebases. Pelle Evensen's "binary search redux" and others have benchmarks. See `08-search-algorithms/02-binary-search/professional.md`.
- **B-tree layout in RAM** — same argument as for disk, but at cache-line granularity. Each node holds, say, 7 keys, fitting 64 bytes. Tree depth drops by `log_2(8) = 3×`.
- **Cache-oblivious van Emde Boas layout** — recursively splits the tree into top-half + bottom-half blocks each of size `√n`, so every recursive layer matches some level of the cache hierarchy without knowing its parameters.

### The senior takeaway

**A BST is the right data structure when you need ordered iteration *and* frequent inserts/deletes.** If your data is read-mostly (e.g., a fixed dictionary, a build-once-search-many lookup table), a sorted array with binary search is usually faster and uses less memory. The choice is workload-dependent, and "use a BST" is *not* the default answer — it is the answer for the specific case of frequent ordered mutations.

When you do need BST semantics, **don't write your own**: reach for `TreeMap`, `std::map`, `BTreeMap`, or `SortedDict`. The implementations have been hardened, optimized, and benchmarked over decades.

---

## Further Reading

- **Intel optimization manual** — chapter on cache hierarchy and prefetching.
- **Knuth TAOCP v3 §6.2.4** — multiway trees, the natural progression from BST to B-tree.
- **Cormen et al. (CLRS) Ch. 18** — B-trees, including the disk-page argument.
- **Sedgewick & Wayne, Algorithms 4e §3.4** — hash tables, including treeification rationale.
- **Linux `Documentation/core-api/rbtree.rst`** — the kernel's official `rbtree` API and usage notes.
- **GCC libstdc++ source, `bits/stl_tree.h`** — production RB-tree implementation, readable C++.
- **OpenJDK `java.util.TreeMap` source** — the canonical Java RB-tree.
- **Pelle Evensen, "Binary search revisited"** — Eytzinger layout benchmarks.
- Continue with `professional.md` for concurrent BSTs, persistent BSTs, and augmented BSTs.
