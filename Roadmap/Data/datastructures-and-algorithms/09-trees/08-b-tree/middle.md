# B-Tree — Middle Level

> **Audience:** Engineers fluent in the proactive-split B-tree from `junior.md` who want the variant family used in real storage engines and high-throughput indexes. Prerequisite: `junior.md`.

This document covers the B-tree family beyond the classic textbook version: the **B+ tree** (preview — full treatment lives in `11-b-plus-tree/`), small-degree special cases (**2-3** and **2-3-4** trees), the famous **equivalence between red-black trees and 2-3-4 B-trees**, **bulk loading** to build a tree from sorted input in O(n) without splits, the **concurrency techniques** that let many threads or many database connections read and modify the same tree at once (**lock coupling**, **B-link trees**), **copy-on-write** variants used by Btrfs, ZFS, and LMDB for crash safety and snapshots, **fractal trees** (the Bε-tree) which add write buffering to push throughput an order of magnitude, and **B\*-trees** (Knuth's high-utilization variant).

---

## Table of Contents

1. [B-Tree vs B+ Tree — Preview](#bplus)
2. [2-3 Trees and 2-3-4 Trees](#234)
3. [Equivalence: Red-Black Tree IS a 2-3-4 Tree](#rb-equiv)
4. [Bulk Loading from Sorted Input](#bulk-load)
5. [Concurrency: Lock Coupling, Latching Protocols](#concurrency)
6. [B-Link Trees (Lehman & Yao, 1981)](#blink)
7. [Copy-on-Write B-Trees: Btrfs, ZFS, LMDB](#cow)
8. [Fractal Trees / Bε-Trees: TokuDB / PerconaFT](#fractal)
9. [B\*-Trees: Knuth's High-Utilization Variant](#bstar)

---

<a name="bplus"></a>
## 1. B-Tree vs B+ Tree — Preview

The classic B-tree of `junior.md` stores **keys and values at every level** — internal nodes and leaves alike. The **B+ tree** moves all data to the leaves and uses internal nodes purely as a routing index. The detailed treatment lives in `11-b-plus-tree/`, but the headline contrasts are:

| Property | Classic B-tree | B+ tree |
|---|---|---|
| Where keys live | Every node | Internal nodes hold **separators only**; leaves hold all keys + values |
| Leaf linkage | None | **Leaves form a doubly-linked list** for fast range scans |
| Lookup cost | May stop at any level (internal hit) | Always reaches a leaf |
| Range scan | Inorder traversal across the tree | Walk leaf list directly |
| Fanout for given page size | Lower (keys carry values, fewer fit) | Higher (internal nodes only carry keys + child pointers) |
| Used by | Filesystem catalogs, simple key-value stores | Every major RDBMS index, most modern KV stores |

Because B+ tree internal nodes are slimmer, they hold more separators, so the tree is shallower than a classic B-tree storing the same data. And because leaves are linked, `SELECT * WHERE ts BETWEEN ... ` walks one chain of pages rather than recursing back into the tree. These two advantages explain why every relational database picked the B+ tree variant.

For the rest of this document we focus on the **classic B-tree** — the variants below are mostly B-tree variants, not B+-tree variants.

---

<a name="234"></a>
## 2. 2-3 Trees and 2-3-4 Trees

A **2-3 tree** is a B-tree with `t = 2`: every node holds **1 or 2 keys** (2 or 3 children — hence the name). A **2-3-4 tree** is `t = 2` plus one extra slot: **1, 2, or 3 keys** (2, 3, or 4 children).

These small-degree B-trees are not for disk. Each node is tiny — a few bytes — so the "pack many keys per I/O" argument disappears. Instead, they are used as a teaching device and as an in-memory balanced tree.

### Why study them?

1. **They isolate the split/merge logic** without the noise of large arrays. A 2-3 tree split produces two single-key nodes; the median is obvious.
2. **2-3-4 trees are isomorphic to red-black trees** (next section). Understanding 2-3-4 split mechanics is the cleanest way to internalize why red-black rotations exist.
3. **Java's `TreeMap` and `LinkedHashMap` are red-black trees**, and **C++'s `std::map` and `std::set` are red-black trees**, all of which are 2-3-4 trees in disguise. If you ever need to write code that interacts with their guarantees, the 2-3-4 mental model is the right one.

### 2-3 tree insert (the classical Sedgewick treatment)

A 2-3 tree node is either:
- **2-node:** one key, two children (`< K` and `> K`).
- **3-node:** two keys, three children.

Insertion goes to a leaf. If the leaf is a 2-node, it becomes a 3-node (done). If the leaf is a 3-node, we **temporarily allow a 4-node** with three keys, then split: the middle key bubbles up to the parent. If the parent was a 2-node it becomes a 3-node (done). If the parent was a 3-node it again becomes a temporary 4-node and splits — and so on up to the root. The root split is the only place the tree grows in height.

### 2-3-4 tree insert (top-down version)

The 2-3-4 tree allows 4-nodes as a stable state. Insertion is **top-down with proactive splits** — exactly the same pattern as the general B-tree from `junior.md` with `t = 2`:

```
INSERT(key):
    while descending:
        if current node is a 4-node:
            split it (median rises to parent)
            adjust direction
    insert key into the leaf 2-node or 3-node
```

The top-down version is preferred because (a) it never needs to climb back up to fix overflow, and (b) it maps directly to the red-black tree rotations.

---

<a name="rb-equiv"></a>
## 3. Equivalence: Red-Black Tree IS a 2-3-4 Tree

The deepest theoretical result in this whole topic. (Covered also in `04-red-black/` from the other side.)

A **red-black tree** is a binary search tree where each node is colored red or black such that:

1. The root is black.
2. Every red node has black children. (No two reds in a row.)
3. Every root-to-leaf path passes through the same number of black nodes ("black height").
4. NIL leaves are black.

The bijection with 2-3-4 trees is:

- A **black node alone** corresponds to a **2-node** in the 2-3-4 tree.
- A **black node with one red child** corresponds to a **3-node**.
- A **black node with two red children** corresponds to a **4-node** (the black node and its two red children together hold three keys).

Under this correspondence:
- A **red-black tree rotation** is exactly a **2-3-4 tree split or merge**.
- The **black height** of the red-black tree equals the **height** of the 2-3-4 tree.

This is why red-black trees are O(log n): the corresponding 2-3-4 tree has height log₂ n, and the red-black tree's *black height* is at most log₂ n. Each level of the 2-3-4 tree expands to at most two levels of the red-black tree (a black node plus one red child), so the red-black tree's total height is at most `2 · log₂ n`.

**Conclusion:** when you write `TreeMap.put(k, v)` in Java, what is *really* happening underneath is a 2-3-4 B-tree top-down insert with proactive 4-node splits — just disguised as red-black rotations and recolorings. This is also why Sedgewick's "Left-Leaning Red-Black tree" (2008) was a simplification — it canonicalized the red-link direction so that the 2-3-4 correspondence becomes one-to-one rather than ambiguous.

---

<a name="bulk-load"></a>
## 4. Bulk Loading from Sorted Input

Inserting `n` keys one at a time into an initially empty B-tree costs O(n · log_t n) and produces nodes that are about 50–75% full on average. If you have all `n` keys upfront and they are already sorted, you can build a B-tree in **O(n)** with **100% full leaves and configurable fill rate on internal nodes** — much faster build and a tighter result.

### The algorithm

1. **Pack the leaves left-to-right.** Read keys in order; emit a leaf node every `2t-1` keys. Last leaf gets the remainder.
2. **Build the next level.** Each pair of adjacent leaves contributes one separator key (the smallest key of the right leaf, or the largest of the left — pick a consistent convention). Group `2t-1` separators per internal node, emit nodes left-to-right.
3. **Repeat** until you have a single root.

```python
def bulk_load(sorted_keys, t):
    # 1. Build leaf layer
    leaves = []
    i = 0
    n = len(sorted_keys)
    while i < n:
        leaf = BTreeNode(t, leaf=True)
        leaf.keys = sorted_keys[i:i + (2 * t - 1)]
        leaves.append(leaf)
        i += 2 * t - 1

    # 2. Build internal layers bottom-up
    level = leaves
    while len(level) > 1:
        parents = []
        i = 0
        while i < len(level):
            p = BTreeNode(t, leaf=False)
            chunk = level[i:i + (2 * t)]
            p.children = chunk
            # promote separator keys
            for c in chunk[1:]:
                p.keys.append(c.keys[0])
            parents.append(p)
            i += 2 * t
        level = parents

    root_tree = BTree(t)
    root_tree.root = level[0]
    return root_tree
```

Time complexity is O(n) — each key is touched exactly once on its way into a leaf, plus a logarithmic factor of separator promotions that telescope into O(n / t). Space is O(n / t).

### When you want this

- **Initial loading** of a database (PostgreSQL `pg_restore`, MySQL `LOAD DATA INFILE` with index disabled, then `ALTER TABLE ... ADD INDEX`).
- **Index rebuild** after schema change.
- **Compaction** in LSM-tree systems when writing out a new B+ tree-shaped SSTable.
- **B-tree from an external sort** in OLAP pipelines.

### Variants

- **Fill factor.** Leaves are typically packed only to 70–90% of capacity (rather than 100%) to leave room for future inserts without immediate splits. PostgreSQL exposes `FILLFACTOR` for exactly this.
- **Build with concurrent reads.** Some engines allow `CREATE INDEX CONCURRENTLY` — they bulk-load while accepting writes by following a parallel update log and replaying it at the end.

---

<a name="concurrency"></a>
## 5. Concurrency: Lock Coupling, Latching Protocols

A real database has **thousands of concurrent connections** reading and writing the same B-tree. The first hard question: **how do you let many threads traverse the tree at once without races?**

The naive answer — one global lock on the whole tree — gives correct results and zero throughput. The standard production answer is **lock coupling**, also called **latch crabbing**.

### Lock coupling for search (shared locks)

```
acquire S-latch on root
while not at leaf:
    let child = next step
    acquire S-latch on child
    release S-latch on parent
return result
```

Two locks are held at most. Each lock release happens as soon as the *next* lock is acquired — the locks "crawl" down the tree like a crab. Multiple readers descend in parallel; their locks overlap on only one node at a time.

### Lock coupling for insert (exclusive locks, naively)

```
acquire X-latch on root
descend:
    acquire X-latch on child
    if child is "safe" (not full):
        release X-latches on all ancestors
    move down
do insertion at leaf, propagate split upward if needed
```

A node is **safe for an insert** if it has room for one more key (`< 2t-1`). Once a safe ancestor is found, all locks above it can be released because no split will propagate past that point. In practice, most inserts release the root's lock immediately because the root almost always has room.

### Optimistic latching (the modern approach)

Acquiring write locks all the way from the root is expensive. Modern systems (PostgreSQL, InnoDB, WiredTiger) use **optimistic latching**:

1. Descend with shared latches only, finding the target leaf.
2. Upgrade to exclusive latch on the leaf.
3. If the leaf has room → insert and release.
4. If the leaf is full → restart with the pessimistic protocol that locks ancestors.

About 99% of inserts complete on the optimistic path. The 1% pessimistic retry is fine because splits are rare.

### Read-write conflicts

The above is sufficient for correctness *if* readers and writers cannot both hold locks on the same node. The lock manager must use proper shared/exclusive lock semantics: a writer descending and a reader descending will serialize on the first node they both touch. Modern engines minimize this with versioned page reads (epoch-based, hazard pointers, RCU) — see WiredTiger's "hazard pointer" implementation for a production example.

---

<a name="blink"></a>
## 6. B-Link Trees (Lehman & Yao, 1981)

In the paper **"Efficient Locking for Concurrent Operations on B-Trees"** (ACM TODS, 1981), Philip Lehman and S. Bing Yao introduced the **B-link tree**, which dramatically simplifies concurrent B-tree operations.

The structural change: **every node has a `right` pointer to its right sibling** at the same level. The keys in the parent only weakly bound the keys in children — a child may temporarily hold keys greater than the parent's separator until the parent catches up. Searchers who fall off the end of a node simply follow the `right` pointer.

### What this buys you

- **Search uses no locks at all** (except read consistency). Descend by reading the page. If your key is greater than the largest key in this page, follow `right` to the sibling and try again. No latch on the parent is required.
- **Inserts hold one latch at a time.** When a node splits, the new sibling is added to the right and the right-link is updated. Searchers concurrently descending may briefly miss the new split, but the right-link rescues them — they just walk one extra hop. The parent's separator gets updated lazily.
- **Splits do not block traversals.** A writer can split a node while readers are inside it; the readers may visit the old half-empty version and then chase the right-link to find any keys they missed.

The B-link tree pattern is implemented in **PostgreSQL's `nbtree` access method** to this day. The technique generalizes: every modern concurrent B-tree variant either uses Lehman-Yao right-links directly or uses an equivalent escape route.

### Code sketch (search)

```
def search_blink(root, key):
    node = root
    while True:
        # follow right-links until we find the page that should contain key
        while node.right is not None and key > node.high_key:
            node = node.right
        if node.is_leaf:
            return node.find(key)
        # pick child whose range contains key
        child = node.choose_child(key)
        node = child
```

The `high_key` is each node's maximum key; if your search target exceeds it, this node was split since you began descending and you must follow `right` to find your data.

---

<a name="cow"></a>
## 7. Copy-on-Write B-Trees: Btrfs, ZFS, LMDB

A **copy-on-write (CoW)** B-tree never modifies an existing node. Every update writes a **new version** of any node on the path from the modified leaf back up to the root. The old root remains valid and reachable until garbage-collected.

### Why CoW?

1. **Crash safety.** The root pointer is a single 8-byte value; atomically swapping it commits the transaction. If the crash happens mid-update, the old root is still consistent — there are no half-modified internal nodes to recover.
2. **Cheap snapshots.** A snapshot is just retaining an old root pointer. Reading the snapshot traverses the tree as it was at that moment — no copying, no quiescent point.
3. **No in-place modifications** → no write-ahead log for the index itself (still needed for the rest of the database).
4. **Easy multi-version concurrency.** Readers see the snapshot they started with; they never block writers, and writers never block readers.

### The trade-off

- **Write amplification.** Modifying one key writes `log_t n` new pages, not one. For `t=128, n=10⁹`, that is ~5 new pages per insert. The old pages must be garbage-collected later.
- **Fragmentation.** New pages are appended; old pages free up randomly. Long-running systems need compaction.
- **Heavier root I/O.** The root is rewritten on every commit. CoW systems amortize this by batching many updates into one root rewrite.

### Production examples

- **LMDB** (Lightning Memory-Mapped Database). Howard Chu's mmap'd CoW B+ tree, used by OpenLDAP, Monero, and Cuckoo Cycle miners. ~6,000 lines of C. The whole database is a memory-mapped file; the OS page cache *is* the buffer pool. Single-writer / many-reader; no write-ahead log; commits flip a header pointer.
- **bbolt** (Go fork of BoltDB). Same architecture as LMDB; used by **etcd** (which means it underpins every Kubernetes deployment), Consul, and InfluxDB v1.
- **Btrfs** ("B-tree filesystem"). Linux filesystem where everything is a CoW B-tree: the file-extent tree, the inode tree, the checksum tree, the snapshot tree — all separate B-trees, all CoW.
- **ZFS**. Solaris-origin filesystem; uses **CoW Merkle B-trees** — every block carries a checksum, written by its parent — guaranteeing end-to-end integrity.
- **WiredTiger** (default MongoDB engine since 3.2). Hybrid: in-memory B-tree with append-only on-disk log; periodic checkpoints write a CoW snapshot.

### Pseudocode for a CoW insert

```
def cow_insert(old_root, key, value):
    new_root, _ = cow_insert_into(old_root, key, value)
    return new_root         # caller atomically swaps root pointer

def cow_insert_into(node, key, value):
    new_node = copy(node)
    if node.is_leaf:
        new_node.add(key, value)
        if new_node.too_big:
            return split(new_node)
        return new_node, None
    i = new_node.child_index(key)
    new_child, propagated = cow_insert_into(node.children[i], key, value)
    new_node.children[i] = new_child
    if propagated is not None:
        new_node.absorb(propagated)
        if new_node.too_big:
            return split(new_node)
    return new_node, None
```

Each level produces a fresh node. The old tree is untouched.

---

<a name="fractal"></a>
## 8. Fractal Trees / Bε-Trees: TokuDB / PerconaFT

The B-tree's Achilles' heel is **random writes**. An insert dirties one leaf — but that leaf likely lives on a different page from the previous insert, so you pay one full random I/O per write. On HDD, this caps you at ~100 writes/second; on SSD, at ~10,000.

The **Bε-tree** (read "B-epsilon tree"), introduced by **Brodal & Fagerberg (2003)** and turned into a production engine by **Tokutek's TokuDB** (later **PerconaFT**), patches this. Each internal node carries a **message buffer** of pending updates that have not yet been pushed down to leaves. Inserts go into the root's buffer in O(1) I/O. When a buffer overflows, its messages are flushed in bulk to the appropriate children — turning many random leaf writes into one sequential write per child.

### The trade-off parameter ε

A Bε-tree has each internal node split between key entries and buffer entries: a fraction `B^ε` of the page holds keys (B = page size in entries), and `B^(1-ε)` holds buffered messages. Tuning `ε ∈ (0, 1)` interpolates:

- `ε → 1`: behaves like a classical B-tree (no buffering). O(log_B n) inserts and searches.
- `ε → 0`: maximum buffering. Insert cost drops to O(log_B(n) / B^ε), search cost rises to O(log_B(n) · B^ε).
- Tokutek picked `ε ≈ 0.5`, giving roughly **100× faster insert throughput than a B-tree** with searches only ~2× slower.

### Where this lives

- **TokuDB / PerconaFT** (MySQL storage engine, Percona Server). Was open source until 2021.
- **TokuMX** (former MongoDB drop-in).
- **The bcachefs** filesystem incorporates ideas from the same line of research.

### Bigger context

Bε-trees occupy a middle ground between B-trees and **LSM trees** (log-structured merge trees, as in RocksDB / LevelDB / Cassandra). Both buffer writes; LSM trees buffer them in an in-memory `MemTable` then write entire sorted runs as new SSTables, while Bε-trees buffer them inside the existing tree's nodes. LSM throughput is higher; Bε read latency is closer to a plain B-tree. We compare them in detail in `professional.md`.

---

<a name="bstar"></a>
## 9. B\*-Trees: Knuth's High-Utilization Variant

In Knuth TAOCP Volume 3 §6.2.4, Knuth describes a variant called the **B\*-tree** (read "B-star tree"; not to be confused with B+ tree). Its goal: **keep nodes more than 2/3 full** instead of the classic 1/2 minimum.

The change is in the split rule. Instead of splitting a single full node into two half-full ones, the B\*-tree **redistributes between the full node and a sibling before splitting**. Only when **both adjacent siblings are also full** does it split — and then it splits *two* nodes into *three*, so each result is roughly 2/3 full.

| Variant | Minimum fill | Average fill (random inserts) |
|---|---|---|
| Classic B-tree | 50% | ~70% (ln 2) |
| B\*-tree | 67% | ~80% |

Higher average fill means a shallower tree, fewer disk reads per lookup, and less wasted disk space. The cost is more complex code and extra I/O on the split path (you touch two or three nodes instead of one).

B\*-trees are used selectively. **HFS+** (macOS catalog) uses B\*-trees with `t` chosen so each node is one 4 KB allocation block. **NTFS** uses a B\*-like layout for the Master File Table indexes. Most relational databases stick with classic B+ trees because the split-cost increase isn't worth the modest fill improvement.

---

## What's next

- `senior.md` enumerates **production usage** — which databases and filesystems use which variant — with specific page sizes and lock protocols.
- `professional.md` digs into **cache-conscious layouts**, **SIMD scans within a node**, **LSM-vs-B-tree trade-offs**, **buffer-managed vs mmap'd B-trees**, and **adaptive radix trees as hot-page replacements**.
- `interview.md` walks through 10 implementation-heavy interview problems.
- `tasks.md` gives reference solutions for 10 hands-on tasks.
- `animation.html` lets you visualize splits, merges, and rotations in real time.

---

## Further reading for this level

- **Lehman, P. L., & Yao, S. B.** (1981). *Efficient Locking for Concurrent Operations on B-Trees.* ACM TODS 6(4). The B-link paper.
- **Sedgewick, R.** (1998). *Algorithms in C, Parts 1–4*, Chapter 13 ("Balanced Trees"). The cleanest 2-3, 2-3-4, and red-black equivalence treatment.
- **Sedgewick, R.** (2008). *Left-Leaning Red-Black Trees.* Princeton tech note. One-to-one 2-3 tree correspondence.
- **Brodal, G. S., & Fagerberg, R.** (2003). *Lower Bounds for External Memory Dictionaries.* SODA. Introduces the Bε-tree trade-off.
- **Bender, M. A., et al.** (2007). *An Introduction to Bε-trees and Write-Optimization.* USENIX ;login:. Accessible overview.
- **Chu, H.** (2011). *LMDB: A Memory-Mapped Database and Backend for OpenLDAP.* The LMDB design paper.
- **Mason, C.** (2007). *Btrfs Design.* Linux Kernel Summit slides.
- **Petrov, A.** *Database Internals*, O'Reilly 2019, Chapter 6 "B-Tree Variants" and Chapter 8 "Transaction Processing and Recovery".
