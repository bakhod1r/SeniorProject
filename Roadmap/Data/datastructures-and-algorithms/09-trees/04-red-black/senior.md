# Red-Black Tree — Senior Level

> **Audience:** Engineers building or extending systems where the red-black tree underneath matters: kernels, language runtimes, databases, standard libraries. Prerequisite: `middle.md`.

This file is a tour of how red-black trees are used in production systems, from the Linux kernel's hottest data structures to the JDK's `TreeMap` and the C++ standard library. After reading it, you will know which line of code in your application secretly drops down into a red-black tree, and why.

---

## Table of Contents

1. [Linux Kernel `rbtree.h` — the Five Famous Uses](#linux)
2. [The CFS Scheduler Runqueue](#cfs)
3. [Process Virtual Memory Areas (VMAs)](#vma)
4. [ext3/4 htree — Directory Hash Index](#htree)
5. [`epoll` Interest Set and Wait List](#epoll)
6. [cgroup Hierarchy](#cgroup)
7. [C++ libstdc++ `_Rb_tree` — Under `std::map` and Friends](#libstdc)
8. [Java JDK `TreeMap` and `TreeSet` — Josh Bloch, 1998](#treemap)
9. [Java `HashMap` Treeification — JEP 180, Java 8](#hashmap-tree)
10. [PostgreSQL `RBTree` — Prefetch Buffer Reservation](#postgres)
11. [Why RB Won — A Synthesis](#why-rb)

---

<a name="linux"></a>
## 1. Linux Kernel `rbtree.h` — the Five Famous Uses

The Linux kernel ships a single generic red-black tree at `include/linux/rbtree.h` plus `lib/rbtree.c`. It is intrusive: you embed `struct rb_node` inside the containing struct, and traversal returns a pointer to `rb_node` that you `container_of()` back to your struct. No allocations beyond the user's own struct.

```c
struct rb_node {
    unsigned long  __rb_parent_color;   // parent pointer in upper bits; color in bit 0
    struct rb_node *rb_right;
    struct rb_node *rb_left;
} __attribute__((aligned(sizeof(long))));

struct rb_root {
    struct rb_node *rb_node;
};
```

The notable design choices:

- **Color packed into the parent pointer.** `__rb_parent_color` is `(parent | color)`. Bit 0 stores the color; the other 63 bits store the parent address. This works because heap allocations are at least 8-byte aligned, so bit 0 of any pointer is naturally zero. Macro `rb_parent(n)` masks bit 0 out; `rb_color(n)` reads it. Saves 8 bytes per node — significant when you have millions of nodes.
- **No sentinel.** The kernel uses `NULL` for missing children and pays the null-check tax in the fixup functions. Saves the cost of one sentinel object per tree, which matters at kernel scale.
- **Intrusive — no key, no value.** The user owns the layout; the rb_node is just three pointers. Comparison is the user's responsibility: they write the search and insert wrappers.
- **`rb_first()` and `rb_last()` walk down O(log n).** No cached min/max pointer in the bare API; some users (CFS) cache it externally.
- **`rb_first_cached()`** (added in 2017, commit `d72da4a4d973`) provides a variant that caches the leftmost node for O(1) `rb_first`. Many performance-critical users have migrated.

You will find calls to `rb_insert_color`, `rb_erase`, `rb_first`, `rb_next`, and `rb_prev` peppered through ~1,200 files in the kernel tree. The big five users:

| Subsystem | Tree | Workload |
|---|---|---|
| CFS scheduler | `cfs_rq.tasks_timeline` | Sorted runqueue of runnable tasks by virtual runtime |
| Memory mgmt | `mm_struct.mm_rb` | Per-process VMAs sorted by start address |
| ext3/4 | htree directory index | Filename-hash → block number |
| epoll | `eventpoll.rbr` | Interest set of monitored file descriptors |
| cgroup v2 | `cgroup_subsys_state` hierarchy | Process group tree |

We dig into each below.

---

<a name="cfs"></a>
## 2. The CFS Scheduler Runqueue

The **Completely Fair Scheduler** (CFS), introduced by Ingo Molnár in Linux 2.6.23 (October 2007) and still the default scheduler in 2026, uses a red-black tree as its runqueue.

The key insight of CFS: instead of tracking explicit priorities and time slices, give each task a **virtual runtime (`vruntime`)** — the cumulative CPU time it has consumed, scaled by its weight. The scheduler always picks the task with the smallest `vruntime`. Higher-priority (lower nice value) tasks have their `vruntime` advance more slowly, so they get picked more often; equal-priority tasks share the CPU fairly because their `vruntime`s stay in sync.

The data structure that holds runnable tasks is a red-black tree keyed by `vruntime`:

```c
// kernel/sched/sched.h
struct cfs_rq {
    ...
    struct rb_root_cached tasks_timeline;   // RB tree of runnable tasks
    ...
};
```

Operations on every scheduling tick:
- **Pick next task:** `rb_first_cached(&cfs_rq->tasks_timeline)` — O(1) thanks to the cached leftmost.
- **Insert just-woken or newly-runnable task:** `__enqueue_entity()` does standard RB insert by `vruntime` key — O(log n).
- **Remove task that goes to sleep or migrates:** `__dequeue_entity()` does RB delete — O(log n).
- **Update vruntime mid-flight:** typically remove + reinsert.

On a typical server with `O(num_cpus × 1000)` runnable tasks, the tree has ~32-64 nodes per CPU, height around 5-6. Each scheduling decision touches a handful of nodes — well within an L1 cache line. The choice of RB over AVL here is exactly because rebalances are constant — the scheduler runs millions of times per second, so any per-operation overhead matters.

In 2025 the kernel started experimenting with **EEVDF** (Earliest Eligible Virtual Deadline First) as a CFS replacement; EEVDF still uses an RB tree as its core data structure, just with a different key.

---

<a name="vma"></a>
## 3. Process Virtual Memory Areas (VMAs)

Every Linux process has a memory map — a list of `vm_area_struct` objects describing chunks of virtual address space (code, heap, stack, mmap'd files, shared memory, etc.). On a busy process you can easily have hundreds of VMAs (Chrome at startup has ~700; a JVM has a few hundred too).

The kernel needs to answer two questions quickly:
1. **Given an address, which VMA contains it?** (Page fault handler, every fault.)
2. **Find the next VMA after a given address.** (Iterating, finding free space.)

For decades (1996–2022) the answer was a red-black tree keyed by VMA start address, hanging off `mm_struct.mm_rb`. Lookups are O(log n) by binary search through the tree. The complexity was acceptable because page faults are rare compared to instructions.

In Linux 6.1 (December 2022) the VMA tree was replaced by a **Maple tree** — a range-based B-tree designed by Liam Howlett specifically for VMA workloads — because the RB tree's per-node overhead (24 bytes for `rb_node`) and its O(log n) lookup became bottlenecks for processes with thousands of VMAs (LMDB, JVM with many shared libraries). The Maple tree fits more keys per cache line and supports range operations natively.

But for ~26 years the RB tree was the VMA index of choice, and the migration story is itself instructive about *when* the RB tree stops being the best choice: when key distributions are amenable to range packing and per-node memory dominates over rebalance cost.

---

<a name="htree"></a>
## 4. ext3/4 htree — Directory Hash Index

ext3 introduced "htree" directory indexing in 2002 (Daniel Phillips). A directory in ext3/4 is stored as a hashed B-tree where filename hashes are the keys. The on-disk structure is a B-tree of order ~512 (one disk block per node).

In memory, ext3/4 caches a portion of the htree as a red-black tree (`fs/ext4/dir.c` — `dx_iter`, `dx_root`). The RB tree provides quick lookup of cached hash entries during directory traversal. RB rather than B-tree in memory because at this level the working set is small and a balanced binary tree wins over a wide-fanout in-memory B-tree.

---

<a name="epoll"></a>
## 5. `epoll` Interest Set and Wait List

`epoll` is the Linux scalable I/O event notification facility (since 2.6, replaces `select` and `poll`). Every `epoll` instance maintains an **interest set**: file descriptors the user has registered with `epoll_ctl(EPOLL_CTL_ADD)`.

The interest set is a red-black tree keyed by `(file*, fd)`:

```c
// fs/eventpoll.c
struct eventpoll {
    ...
    struct rb_root_cached rbr;        // interest set: registered fds
    struct list_head      rdllist;    // ready list: fds with pending events
    ...
};

struct epitem {
    union {
        struct rb_node       rbn;     // node in eventpoll.rbr
        struct rcu_head      rcu;
    };
    struct list_head         rdllink; // node in eventpoll.rdllist
    ...
};
```

When user calls `epoll_ctl(EPOLL_CTL_ADD, fd)`, the kernel does an RB insert. `EPOLL_CTL_DEL` does an RB delete. `EPOLL_CTL_MOD` does an RB lookup and updates the entry.

The reason RB rather than a hash table: the interest set is often small (under 100 fds on most apps) but can grow to tens of thousands on high-fanout servers (nginx, Envoy). The RB tree gives predictable O(log n) without the resize hiccups of a hash table, and importantly the kernel can iterate it in fd-sorted order for debugging (`/proc/<pid>/fdinfo/<epoll>`).

The **ready list** (`rdllist`) is a doubly-linked list, not a tree — events fire in arrival order, and we just need to drain them.

---

<a name="cgroup"></a>
## 6. cgroup Hierarchy

cgroup v2 organizes processes into a hierarchy for resource accounting (CPU, memory, I/O, devices). Each cgroup is a node; children are linked into the parent via, you guessed it, a red-black tree keyed by some identifier.

The cgroup tree is small (rarely more than a few hundred nodes on a typical container host running 50 containers), but the lookup pattern is hot during system calls that resolve a task's cgroup ancestry. RB keeps it predictable.

---

<a name="libstdc"></a>
## 7. C++ libstdc++ `_Rb_tree` — Under `std::map` and Friends

In GCC's libstdc++, the file `include/bits/stl_tree.h` defines a generic red-black tree template `_Rb_tree<Key, Val, KeyOfValue, Compare, Alloc>` that is the **shared backing store** for `std::map`, `std::set`, `std::multimap`, and `std::multiset`. Same file in libc++ (LLVM); slightly different in MSVC STL.

Each node is:

```cpp
struct _Rb_tree_node_base {
    enum _Rb_tree_color { _S_red = false, _S_black = true };
    _Rb_tree_color    _M_color;
    _Rb_tree_node_base* _M_parent;
    _Rb_tree_node_base* _M_left;
    _Rb_tree_node_base* _M_right;
};

template<typename _Val>
struct _Rb_tree_node : public _Rb_tree_node_base {
    _Val _M_value_field;
};
```

Layout: 1 byte color (rounded up to 8 due to alignment) + 3 pointers (24 bytes) + the value. On 64-bit, an `std::map<int,int>` node is 32 + 8 = 40 bytes plus the value. The color is its own byte rather than stuffed into a pointer because libstdc++ aims for portability across allocators and the saving is marginal in user space.

Notable design choices in libstdc++:
- **Header sentinel.** A single "header" node serves as both the parent of the root and the sentinel terminating iterators. `_M_header._M_left` points to the leftmost node (for O(1) `begin()`); `_M_header._M_right` points to the rightmost. The header itself doesn't hold a value.
- **Iterator stability across modifications.** Insert and erase only invalidate iterators to the erased element. This is a contractual guarantee of `std::map` and a non-trivial constraint on the implementation.
- **Move semantics since C++11.** `std::map(map&&)` does pointer swap, O(1).

The CLRS algorithm is implemented faithfully — `_Rb_tree_insert_and_rebalance` and `_Rb_tree_rebalance_for_erase` are the entry points. If you compile `std::map::insert` and disassemble, you will see exactly the case analysis from `junior.md`.

---

<a name="treemap"></a>
## 8. Java JDK `TreeMap` and `TreeSet` — Josh Bloch, 1998

`java.util.TreeMap` was added to the JDK in Java 1.2 (December 1998) by Josh Bloch. The implementation is a red-black tree in `Entry` objects, with `null` (not a sentinel) for missing children:

```java
static final class Entry<K,V> implements Map.Entry<K,V> {
    K key;
    V value;
    Entry<K,V> left;
    Entry<K,V> right;
    Entry<K,V> parent;
    boolean color = BLACK;
    ...
}
```

The implementation predates the sentinel-NIL trend. Every fixup site has explicit `null` checks; the code is harder to read than CLRS pseudocode for that reason.

Key features:
- `TreeMap` implements `NavigableMap<K,V>` (added in Java 1.6) — `ceilingKey`, `floorKey`, `higherKey`, `lowerKey`, `firstKey`, `lastKey`, plus the `descendingMap()` view. These are all natural with an RB tree.
- The tree maintains no cached min/max — `firstKey()` walks the leftmost path in O(log n) per call. Hot path: a `for (K key : tm.keySet())` does one O(log n) initial walk then O(1) successor per step.
- Iteration uses `successor(Entry e)` defined in the same file — about 25 lines of standard "if has right subtree, leftmost of right; else walk up to first ancestor where we came from left".

`TreeSet` is `new HashSet<>(new TreeMap<>())` adapted, sharing the implementation.

`ConcurrentSkipListMap` exists for concurrent ordered map needs and uses skip lists, not RB — locking an RB tree concurrently is much harder than skip lists.

---

<a name="hashmap-tree"></a>
## 9. Java `HashMap` Treeification — JEP 180, Java 8

This is the trick that surprises many engineers. Since Java 8 (2014, JEP 180), `HashMap` no longer uses pure separate chaining. Each bucket starts as a linked list, but when a bucket's chain length grows beyond a threshold, it is **upgraded to a red-black tree**:

```java
static final int TREEIFY_THRESHOLD   = 8;   // chain length to convert list -> tree
static final int UNTREEIFY_THRESHOLD = 6;   // chain length to convert tree -> list
static final int MIN_TREEIFY_CAPACITY = 64; // overall map size below this -> resize instead
```

When a bucket reaches 8 entries AND the map has at least 64 buckets total, the bucket is converted to a red-black tree of `TreeNode` objects. Subsequent operations on that bucket are O(log k) where k is the bucket size, instead of O(k).

The keys in the tree are compared using `hashCode` first, then `Comparable` if the keys implement it, then a deterministic "class name + identity hash" tiebreaker. The point is to keep the tree balanced **even when the user's `hashCode` is bad** — the original motivation for JEP 180 was to mitigate **hash-collision DoS attacks** (CVE-2011-4858 and friends), where an attacker crafts inputs that all collide to one bucket, turning a million-element map into a million-element linked list and an O(1) lookup into an O(n) one.

If many deletes shrink the tree-bucket back to 6 entries, it converts back to a linked list (`UNTREEIFY_THRESHOLD`). The asymmetric thresholds (8 to grow, 6 to shrink) prevent oscillation around the boundary.

So every Java app touches a red-black tree any time a `HashMap` bucket fills with collisions. The structure is the same as `TreeMap`'s, but the keys are compared by `hashCode | Comparable | identity` rather than user comparator, and the trees are small (rarely > 32 entries — at that point the whole `HashMap` resizes).

---

<a name="postgres"></a>
## 10. PostgreSQL `RBTree` — Prefetch Buffer Reservation

PostgreSQL ships a generic RB tree in `src/backend/lib/rbtree.c`, used (among other places) by the GIN index for postingTree split coordination, by the prefetch buffer reservation, and by the buffer manager's freelist for some workloads. The code follows the CLRS algorithm, with a sentinel:

```c
struct RBTree {
    RBTNode    *root;
    Size        node_size;
    rbt_comparator      comparator;
    rbt_combiner        combiner;        // for "insert if absent, else merge"
    rbt_allocfunc       allocfunc;
    rbt_freefunc        freefunc;
    void               *arg;
    RBTNode             nullNode;        // shared NIL sentinel
};
```

PostgreSQL's RB tree is reusable: callers provide a comparator and pluggable allocator. This style (generic via callbacks rather than C++ templates) is common in C codebases.

The RB tree is used here, again, because the workloads are insert/delete heavy and a balanced binary tree gives predictable O(log n) without the resize stalls of a hash table.

---

<a name="why-rb"></a>
## 11. Why RB Won — A Synthesis

Across kernels, language runtimes, databases, and standard libraries, the same pattern emerges:

**RB is chosen when:**
1. **Inserts and deletes are frequent** — schedulers, caches, event sets.
2. **Predictable worst-case latency matters** — no resize stalls, no rebalance cascades.
3. **The data fits comfortably in cache** — small n (10²–10⁵), node sizes 32-48 bytes.
4. **Ordering or range queries are needed** — predecessor, successor, in-order iteration.
5. **The implementation cost is amortized once at the library level** — every `std::map` user gets it for free.

**RB is not chosen when:**
1. **The data is much larger than cache** — B-trees / B+ trees / Maple trees win for disk-resident or cache-cold workloads (used by PostgreSQL btree indexes, ext4 directory leaves, Linux VMA tree post 6.1).
2. **Exact-match lookup is all you need** — hash tables are O(1) and beat RB on average.
3. **The data is mostly read after a one-time bulk load** — AVL's tighter height saves a comparison or two.
4. **Concurrency is paramount** — skip lists or wait-free trees (CTrie) are much easier to make concurrent.

The 1-bit-per-node color tag, the cache-friendly small node size, the 2-rotation-max insert, and the 3-rotation-max delete add up to a structure that is "good enough at everything" while being "best in class" at none — and that is what makes it the perfect default. Every standard-library author who has had to pick *one* balanced BST has picked red-black, and 50 years after Bayer's paper that ratio shows no sign of changing.
