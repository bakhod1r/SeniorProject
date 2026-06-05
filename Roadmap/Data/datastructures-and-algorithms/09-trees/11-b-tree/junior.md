# B-Tree — Junior Level

> **Read time: ~45 minutes** · **Audience:** Engineers comfortable with binary search trees who want to understand the data structure that powers every relational database and filesystem on the planet.

A **B-tree** is the data structure that quietly runs the world's storage. Every time you query PostgreSQL, MySQL, Oracle, or SQL Server, you traverse a B-tree (technically usually a B+ tree, its sibling — covered separately in `11-b-plus-tree/`). Every time you open a file in HFS+, NTFS, XFS, or btrfs, the filesystem walks a B-tree to find the inode. Every time `etcd` serves a Kubernetes lookup, a copy-on-write B-tree (`bbolt`) hands back the value. Every time a Monero wallet finds a transaction, an LMDB B+ tree resolves it. B-trees are the answer to the single most important question in storage engineering: **how do you keep an ordered index searchable when it does not fit in RAM?**

This document teaches you the classic B-tree of Bayer & McCreight — the one with keys at every level, internal and leaf — so thoroughly that you can implement it from memory, debug a split bug on the back of a napkin, and reason about why your database picks a B-tree index over a hash index for a `BETWEEN` query.

---

## Table of Contents

1. [Introduction — Why Binary Trees Die on Disk](#introduction)
2. [History — Bayer & McCreight at Boeing, 1971](#history)
3. [Prerequisites — BST, Balance, the Disk-I/O Cost Model](#prerequisites)
4. [Glossary](#glossary)
5. [Core Concepts — Order, Fanout, Invariants](#core-concepts)
6. [Big-O Summary](#big-o)
7. [Real-World Analogies](#analogies)
8. [Pros and Cons vs Binary Trees](#pros-cons)
9. [Step-by-Step Walkthrough — t=3, Insert Eight Keys](#walkthrough)
10. [Code Examples — Go, Java, Python](#code-examples)
11. [Coding Patterns — Proactive Split on the Way Down](#patterns)
12. [Error Handling](#errors)
13. [Performance Tips](#performance-tips)
14. [Best Practices](#best-practices)
15. [Edge Cases](#edge-cases)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Visual Animation Reference](#animation)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Why Binary Trees Die on Disk

You already know that a balanced binary search tree gives you O(log₂ n) search, insert, and delete. For 1 billion keys that is ~30 comparisons. Sounds great. So why does no database on Earth store its primary index as a balanced BST?

Because each comparison in a BST follows a pointer to a **child node** that lives somewhere unpredictable in memory — and if the index does not fit in RAM, that pointer dereference becomes a **disk read**. On a rotating hard drive, a random read costs about 10 milliseconds. On a modern SSD, ~100 microseconds. In DRAM, ~100 nanoseconds. The ratio is roughly:

| Medium | Random read | Relative cost |
|---|---|---|
| L1 cache | 1 ns | 1× |
| DRAM | 100 ns | 100× |
| NVMe SSD | 100 µs | 100,000× |
| SATA SSD | 200 µs | 200,000× |
| HDD (7200 RPM) | 10 ms | 10,000,000× |

If a BST search costs 30 disk reads on a billion-key index sitting on HDD, that is **0.3 seconds per lookup** — which means your database can handle about 3 queries per second per core before it falls over. Unacceptable.

The B-tree fixes this with a simple, beautiful insight: **disks read pages, not bytes**. Whether you ask the OS for 1 byte or 4096 bytes, you pay the same I/O cost — one page read. So the structure should pack as many keys as possible into a single page, turning each disk read into a high-fanout comparison instead of a single one. If a node holds 200 keys with 201 child pointers, the tree is roughly log₂₀₀(n) deep — for 1 billion keys, that is **3 to 4 levels**. **Three or four disk reads to find anything in a billion records.** That is the magic.

Concretely, with a 4 KB page and 16-byte (key + child pointer) entries, a node fits ~250 entries. A 3-level tree holds 250³ ≈ 15 million keys; a 4-level tree holds 250⁴ ≈ 4 billion. In practice the **root and most of the internal nodes stay cached in RAM**, so a typical lookup is one disk read (the leaf). This is why a SELECT on a 100 GB indexed PostgreSQL table runs in microseconds.

Every relational database, every key-value store with ordered iteration, every filesystem catalog, every multi-version concurrent control engine, every embedded database (SQLite, BerkeleyDB, LMDB, RocksDB until L0) uses a B-tree or a close variant. Understanding it is non-negotiable for systems work.

---

<a name="history"></a>
## 2. History — Bayer & McCreight at Boeing, 1971

In the late 1960s, **Rudolf Bayer** and **Edward M. McCreight** were working at **Boeing Scientific Research Labs** on the problem of maintaining large ordered indexes on disk for the company's data processing workloads. Existing structures — balanced BSTs, ISAM (Indexed Sequential Access Method), and trie variants — either grew unbalanced over time, required offline reorganization, or wasted space.

Their 1971 internal memo and 1972 paper, **"Organization and Maintenance of Large Ordered Indexes"** (Acta Informatica, Vol. 1, No. 3, pp. 173–189), introduced what they called a **B-tree**. The "B" has never been definitively explained — Bayer once joked, "the more you think about what the B in B-tree could mean, the better you understand B-trees." Candidates include **B**oeing, **B**alanced, **B**ayer, **B**roader (vs binary), and **B**ushy. The authors refuse to confirm any single answer.

The paper's contributions were:

1. A precise definition of the **B-tree invariants** (fill bounds on every node, equal-depth leaves).
2. An insertion algorithm that **preserves balance by node splitting**, propagating splits upward only as needed.
3. A deletion algorithm using **redistribution and merging**.
4. A proof that the height is O(log_t n), giving worst-case logarithmic I/O.
5. The recognition that this matches **disk page sizes**, making it the natural on-disk structure.

The B-tree was a clean break from offline-rebuild ISAM and from in-memory BSTs. Within a decade, every major commercial database had adopted it. By the mid-1980s, the **B+ tree** variant (keys only in leaves, leaves linked) had become dominant for primary indexes because of better range-scan performance — but the original B-tree remains the foundation, and most filesystems still use it directly.

In 1979, **Douglas Comer** wrote the influential survey "The Ubiquitous B-Tree" (ACM Computing Surveys), which named the structure's hegemony — a name that still fits 45 years later.

---

<a name="prerequisites"></a>
## 3. Prerequisites — BST, Balance, the Disk-I/O Cost Model

Before reading further, you should be solid on:

1. **Binary Search Tree** (`02-bst/`). You should be able to write `search`, `insert`, and `delete` for an unbalanced BST without thinking, including the predecessor/successor walk used in BST delete.
2. **Balanced BST concept** — what self-balancing means (AVL, red-black). You do not need to know the rotation mechanics; you only need to understand *why* balance matters.
3. **Binary search within an array** (`08-search-algorithms/02-binary-search/`). B-tree node search uses binary search across the keys in a node.
4. **The disk-I/O cost model.** The relevant cost in storage algorithms is not "number of comparisons" but **"number of pages read or written"**. A B-tree algorithm is analyzed as **O(log_t n) I/Os**, separately from the in-memory comparison cost.

### The disk-I/O cost model in one paragraph

Assume that data lives on a disk divided into fixed-size **pages** (typically 4 KB or 8 KB or 16 KB). The CPU operates on data only after it has been loaded into a memory buffer of one or more pages. Reading or writing a page costs **one I/O**. Reading or writing any number of bytes within an already-loaded page is **free** (relative to the I/O). We count I/Os because they dominate run time by 5–7 orders of magnitude. This model is sometimes called the **external memory model** or, more formally, the **I/O model of Aggarwal & Vitter (1988)**.

---

<a name="glossary"></a>
## 4. Glossary

| Term | Definition |
|---|---|
| **Order `t` (or minimum degree)** | The structural parameter. Every node holds between `t-1` and `2t-1` keys (root may have fewer). Every internal node has between `t` and `2t` children. CLRS uses `t`; some textbooks use `m` for maximum children (so `m = 2t`). |
| **Fanout (or branching factor)** | The actual number of children of a node. Bounded by `t ≤ fanout ≤ 2t` for internal nodes. Average fanout in a well-utilized tree is ~75% of max. |
| **Page** | A fixed-size disk block, typically 4 KB or 8 KB. Each B-tree node is stored in exactly one page. |
| **Leaf node** | A node with no children. In classic B-tree, leaves still hold keys (just like internal nodes). |
| **Internal node** | A non-leaf node. Holds keys *and* child pointers. |
| **Key separator** | A key in an internal node that separates the key ranges of two adjacent children. Inorder: `keys_in_child[i] < node.keys[i] < keys_in_child[i+1]`. |
| **Split** | When a node reaches `2t-1` keys and needs to absorb one more, it splits into two nodes of `t-1` keys each, and the median key moves up to the parent. |
| **Merge** | When two adjacent siblings together have `≤ 2t-2` keys, they combine into one node along with the separator key from the parent. |
| **Redistribute (rotate / borrow)** | When a node underflows (has `t-2` keys), it borrows one key from a sibling that has more than `t-1`, via the parent's separator. Cheaper than merging. |
| **Underflow** | A non-root node with fewer than `t-1` keys. Must be fixed before the tree is valid again. |
| **Overflow** | A node with more than `2t-1` keys. Forbidden — split before this happens. |
| **Height `h`** | Number of edges on a root-to-leaf path. For a B-tree with `n` keys, `h ≤ log_t((n+1)/2)`. |
| **Disk page / block** | The OS-level unit of I/O. Aligning B-tree nodes with pages is the whole point. |
| **Buffer pool** | The in-memory cache of recently-used pages. Database engines manage this aggressively. |

---

<a name="core-concepts"></a>
## 5. Core Concepts — Order, Fanout, Invariants

A B-tree of **minimum degree `t ≥ 2`** is a rooted tree satisfying five invariants:

1. **Every node holds between `t-1` and `2t-1` keys**, in sorted order. (The root may hold between `1` and `2t-1`.)
2. **Every internal node with `k` keys has exactly `k+1` children.** Keys partition the child ranges.
3. **All leaves are at the same depth.** This is what keeps the tree balanced — every root-to-leaf path has the same length.
4. **Keys within a node are sorted ascending.**
5. **For every internal node**, if its keys are `K[0] < K[1] < ... < K[k-1]` and its children are `C[0], C[1], ..., C[k]`, then:
   ```
   every key in C[i] < K[i] < every key in C[i+1]
   ```
   This is the BST property generalized to multi-way.

### Why `2t-1` and not just "some maximum"?

Because the split operation produces **two nodes of exactly `t-1` keys each plus one median key that moves up**. If max keys = `2t-1`, then split → `(t-1) + 1 + (t-1) = 2t-1`. Both halves end up at the minimum allowed size, which is the cleanest possible state. If max were `2t`, the split would leave unequal halves.

### Height bound

A B-tree with `n` keys has height `h ≤ ⌈log_t((n+1)/2)⌉`. The intuition: a tree of height `h` has at least `1 + 2(t-1) + 2t(t-1) + 2t²(t-1) + ... = 2t^h - 1` keys (root + minimally-filled levels). Solving for `h` gives the bound.

For `t = 100` and `n = 10⁹`, `h ≤ ⌈log₁₀₀(5×10⁸)⌉ ≈ 5`. **Five disk reads worst case for a billion records.** That is the engineering payoff.

---

<a name="big-o"></a>
## 6. Big-O Summary

| Operation | Disk I/O | In-memory comparisons |
|---|---|---|
| **Search** | O(log_t n) | O(log_t n × log₂ t) using binary search within nodes |
| **Insert** | O(log_t n) | O(log_t n × t) — proactive splits do constant work each |
| **Delete** | O(log_t n) | O(log_t n × t) |
| **Range query [lo, hi]** | O(log_t n + k/B) where k = result count, B = keys/page | O(log_t n + k) |
| **Min / Max** | O(log_t n) | O(log_t n) |
| **Space** | O(n / utilization) | ~50–75% node fill on average |

The "in-memory" term counts CPU work after the page is loaded. For typical `t = 100` to `500`, both terms are tiny.

---

<a name="analogies"></a>
## 7. Real-World Analogies

### 7.1 The phone book with letter tabs

Old paper phone books had **letter tabs** sticking out — A-D, E-H, I-L, M-P, Q-T, U-Z. To find "Mansurov", you skip to the M-P tab, flip to its first page, find the sub-divider "Ma–Mb", and scan. Two "branches" — letter-range, then sub-range — and you are on the right page. **Each tab is an internal-node key. Each section is a child subtree.** A B-tree with `t=4` on a phone book would have exactly this structure.

### 7.2 The card catalog drawer

Library card catalogs grouped index cards into drawers, each drawer labeled with a range ("Smi-Smy"). A librarian found a book by reading drawer labels (top-level keys), pulling the right drawer (loading the child), then binary-searching within it. Exactly a B-tree lookup.

### 7.3 A book's table of contents with sub-sections

A 1,000-page textbook does not have one index entry per page. It has a 5-page top-level TOC (chapters), each chapter has a sub-TOC (sections), each section's first page lists subsections. Three lookups → page. Three "I/Os" to find anything in 1,000 pages. Compare with skimming page by page.

### 7.4 The bin-packed warehouse

An Amazon fulfillment center groups products into bins, bins into rows, rows into aisles. A picker reads aisle → row → bin labels to find the product. The "tree" they traverse mentally is shallow and high-fanout — exactly because walking around the warehouse is expensive (the "I/O") and reading a printed label is cheap (the "comparison").

---

<a name="pros-cons"></a>
## 8. Pros and Cons vs Binary Trees

### Pros
- **Massive fanout → shallow tree → few disk reads.** The headline benefit.
- **Predictable performance.** Worst case = average case (within a factor of 2). No skewed input destroys it the way it would destroy an unbalanced BST.
- **Cache and page friendly.** Each node fits in a CPU cache line group or a disk page. Loading one node loads `t` to `2t` keys at once.
- **Stable on inserts and deletes.** Self-balancing maintains O(log_t n) worst case forever; no offline rebuild required.
- **Range queries are fast.** In-order traversal between two bounds visits O(k/t) nodes for `k` results.
- **Plays well with locking and copy-on-write.** Granularity of locking = one node = one page.

### Cons
- **Code complexity.** Splitting and merging logic is non-trivial. A naive implementation is 5× longer than a BST.
- **Higher constant factors per operation.** A search comparison cost includes binary-searching within the node, which is more work than a single BST step — but you do far fewer of them.
- **Underutilization.** A pessimistic mixture of inserts and deletes leaves nodes at the minimum `t-1` fill, wasting ~50% of allocated space. Real systems target ~70% utilization.
- **Not ideal for write-heavy workloads.** Each insert may dirty multiple pages all the way up to the root. LSM trees (RocksDB, LevelDB) beat B-trees for write throughput at the cost of read amplification — covered in `professional.md`.
- **Page-aligned layout adds bookkeeping.** Real implementations carry headers, free-space maps, checksums, version counters, and overflow page references — all of which eat into the key-payload area.

---

<a name="walkthrough"></a>
## 9. Step-by-Step Walkthrough — `t=3`, Insert Eight Keys

Let us insert the sequence **10, 20, 5, 6, 12, 30, 7, 17** into an initially empty B-tree of order `t = 3` (so every node holds 2 to 5 keys; every internal node has 3 to 6 children).

### Step 1 — Insert 10
Tree was empty. Create the root with key `10`.
```
[10]
```

### Step 2 — Insert 20
Root has space (1 key < 5 max). Insert in sorted order.
```
[10, 20]
```

### Step 3 — Insert 5
```
[5, 10, 20]
```

### Step 4 — Insert 6
```
[5, 6, 10, 20]
```

### Step 5 — Insert 12
```
[5, 6, 10, 12, 20]        ← root now has 5 keys = 2t-1, FULL
```

### Step 6 — Insert 30
Before descending into the (would-be) root, we check: is the root full? **Yes** — 5 keys = `2t-1`. We split it **before** inserting. The median key (`10`) moves up to a new root; the left half (`[5, 6]`) becomes the left child; the right half (`[12, 20]`) becomes the right child.

```
            [10]
           /    \
       [5, 6]  [12, 20]
```

Now insert `30`. It belongs in the right subtree. The right child has 2 keys (room for 3 more). Insert.

```
            [10]
           /    \
       [5, 6]  [12, 20, 30]
```

### Step 7 — Insert 7
`7 > 10`? No, `7 < 10`, so go left. Left child `[5, 6]` has room. Insert.

```
            [10]
           /    \
      [5, 6, 7]  [12, 20, 30]
```

### Step 8 — Insert 17
`17 > 10`? Yes, go right. Right child `[12, 20, 30]` has 3 keys (still room for 2 more). Insert.

```
            [10]
           /    \
      [5, 6, 7]  [12, 17, 20, 30]
```

### What if we kept going?

If we inserted `1, 2, 3` next, the left child would fill to `[1, 2, 3, 5, 6, 7]` — 6 keys, which is `> 2t-1 = 5`. With **proactive split-on-the-way-down**, we would have noticed the left child is full *before* descending into it, split it, and pushed its median up to the root. The split is always handled by the parent on the way down, so the recursion never has to climb back up to fix overflow.

**This is the elegant insight of the proactive-split insert: every recursive call descends into a non-full node, guaranteeing that any new key can be safely inserted without further work upward.**

---

<a name="code-examples"></a>
## 10. Code Examples — Go, Java, Python

### 10.1 Python — full in-memory B-tree

```python
class BTreeNode:
    """A node of a B-tree of minimum degree t."""
    __slots__ = ("t", "keys", "children", "leaf")

    def __init__(self, t: int, leaf: bool = True):
        self.t = t                              # minimum degree
        self.keys: list[int] = []               # 1 .. 2t-1 keys (root may have less)
        self.children: list["BTreeNode"] = []   # 0 (if leaf) or len(keys)+1 children
        self.leaf = leaf

    def is_full(self) -> bool:
        return len(self.keys) == 2 * self.t - 1


class BTree:
    def __init__(self, t: int = 3):
        if t < 2:
            raise ValueError("minimum degree t must be >= 2")
        self.t = t
        self.root = BTreeNode(t, leaf=True)

    # ----------------------------- search -----------------------------
    def search(self, key: int):
        return self._search(self.root, key)

    def _search(self, node: BTreeNode, key: int):
        i = 0
        while i < len(node.keys) and key > node.keys[i]:
            i += 1
        if i < len(node.keys) and key == node.keys[i]:
            return (node, i)            # found
        if node.leaf:
            return None                 # not present
        return self._search(node.children[i], key)

    # ----------------------------- insert -----------------------------
    def insert(self, key: int):
        root = self.root
        if root.is_full():
            new_root = BTreeNode(self.t, leaf=False)
            new_root.children.append(root)
            self._split_child(new_root, 0)
            self.root = new_root
            self._insert_nonfull(new_root, key)
        else:
            self._insert_nonfull(root, key)

    def _split_child(self, parent: BTreeNode, idx: int):
        """Split parent.children[idx], which must be full."""
        t = self.t
        full = parent.children[idx]
        sibling = BTreeNode(t, leaf=full.leaf)

        # right half of keys go to the new sibling; median is keys[t-1]
        sibling.keys = full.keys[t:]                # keys[t .. 2t-2]
        median = full.keys[t - 1]
        full.keys = full.keys[:t - 1]               # keys[0 .. t-2]

        if not full.leaf:
            sibling.children = full.children[t:]    # children[t .. 2t-1]
            full.children = full.children[:t]       # children[0 .. t-1]

        parent.children.insert(idx + 1, sibling)
        parent.keys.insert(idx, median)

    def _insert_nonfull(self, node: BTreeNode, key: int):
        i = len(node.keys) - 1
        if node.leaf:
            node.keys.append(0)                     # placeholder
            while i >= 0 and key < node.keys[i]:
                node.keys[i + 1] = node.keys[i]
                i -= 1
            node.keys[i + 1] = key
            return
        # find child to descend into
        while i >= 0 and key < node.keys[i]:
            i -= 1
        i += 1
        if node.children[i].is_full():
            self._split_child(node, i)
            if key > node.keys[i]:
                i += 1
        self._insert_nonfull(node.children[i], key)
```

### 10.2 Go — Node struct and search/insert

```go
package btree

// Node is a single B-tree node.
type Node struct {
    keys     []int
    children []*Node
    leaf     bool
    t        int // minimum degree
}

func newNode(t int, leaf bool) *Node {
    return &Node{keys: nil, children: nil, leaf: leaf, t: t}
}

func (n *Node) isFull() bool { return len(n.keys) == 2*n.t-1 }

// Tree is the B-tree.
type Tree struct {
    root *Node
    t    int
}

func New(t int) *Tree {
    if t < 2 {
        panic("t must be >= 2")
    }
    return &Tree{root: newNode(t, true), t: t}
}

// Search returns (node, index) where the key sits, or (nil, -1) if absent.
func (tr *Tree) Search(key int) (*Node, int) { return search(tr.root, key) }

func search(node *Node, key int) (*Node, int) {
    i := 0
    for i < len(node.keys) && key > node.keys[i] {
        i++
    }
    if i < len(node.keys) && key == node.keys[i] {
        return node, i
    }
    if node.leaf {
        return nil, -1
    }
    return search(node.children[i], key)
}

// Insert adds key to the tree. Duplicates are allowed; callers may dedupe.
func (tr *Tree) Insert(key int) {
    if tr.root.isFull() {
        nr := newNode(tr.t, false)
        nr.children = append(nr.children, tr.root)
        tr.splitChild(nr, 0)
        tr.root = nr
    }
    tr.insertNonFull(tr.root, key)
}

func (tr *Tree) splitChild(parent *Node, idx int) {
    t := tr.t
    full := parent.children[idx]
    sib := newNode(t, full.leaf)

    sib.keys = append(sib.keys, full.keys[t:]...) // right half
    median := full.keys[t-1]
    full.keys = full.keys[:t-1]                   // left half

    if !full.leaf {
        sib.children = append(sib.children, full.children[t:]...)
        full.children = full.children[:t]
    }

    // insert sib into parent.children at idx+1
    parent.children = append(parent.children, nil)
    copy(parent.children[idx+2:], parent.children[idx+1:])
    parent.children[idx+1] = sib

    // insert median into parent.keys at idx
    parent.keys = append(parent.keys, 0)
    copy(parent.keys[idx+1:], parent.keys[idx:])
    parent.keys[idx] = median
}

func (tr *Tree) insertNonFull(n *Node, key int) {
    i := len(n.keys) - 1
    if n.leaf {
        n.keys = append(n.keys, 0)
        for i >= 0 && key < n.keys[i] {
            n.keys[i+1] = n.keys[i]
            i--
        }
        n.keys[i+1] = key
        return
    }
    for i >= 0 && key < n.keys[i] {
        i--
    }
    i++
    if n.children[i].isFull() {
        tr.splitChild(n, i)
        if key > n.keys[i] {
            i++
        }
    }
    tr.insertNonFull(n.children[i], key)
}
```

### 10.3 Java — Node and search

```java
public final class BTree {
    private final int t;          // minimum degree
    private Node root;

    public BTree(int t) {
        if (t < 2) throw new IllegalArgumentException("t must be >= 2");
        this.t = t;
        this.root = new Node(t, true);
    }

    private static final class Node {
        final int t;
        final int[] keys;
        final Node[] children;
        int n;          // current key count
        boolean leaf;

        Node(int t, boolean leaf) {
            this.t = t;
            this.keys = new int[2 * t - 1];
            this.children = new Node[2 * t];
            this.n = 0;
            this.leaf = leaf;
        }

        boolean isFull() { return n == 2 * t - 1; }
    }

    /** Search for key. Returns true if present. */
    public boolean contains(int key) { return search(root, key) != null; }

    private static int[] search(Node node, int key) {
        int i = 0;
        while (i < node.n && key > node.keys[i]) i++;
        if (i < node.n && key == node.keys[i]) return new int[]{i};
        if (node.leaf) return null;
        return search(node.children[i], key);
    }

    public void insert(int key) {
        Node r = root;
        if (r.isFull()) {
            Node s = new Node(t, false);
            s.children[0] = r;
            splitChild(s, 0);
            root = s;
            insertNonFull(s, key);
        } else {
            insertNonFull(r, key);
        }
    }

    private void splitChild(Node parent, int idx) {
        Node full = parent.children[idx];
        Node sib = new Node(t, full.leaf);
        sib.n = t - 1;
        for (int j = 0; j < t - 1; j++) sib.keys[j] = full.keys[j + t];
        if (!full.leaf)
            for (int j = 0; j < t; j++) sib.children[j] = full.children[j + t];
        int median = full.keys[t - 1];
        full.n = t - 1;
        for (int j = parent.n; j > idx; j--) parent.children[j + 1] = parent.children[j];
        parent.children[idx + 1] = sib;
        for (int j = parent.n - 1; j >= idx; j--) parent.keys[j + 1] = parent.keys[j];
        parent.keys[idx] = median;
        parent.n++;
    }

    private void insertNonFull(Node n, int key) {
        int i = n.n - 1;
        if (n.leaf) {
            while (i >= 0 && key < n.keys[i]) { n.keys[i + 1] = n.keys[i]; i--; }
            n.keys[i + 1] = key;
            n.n++;
            return;
        }
        while (i >= 0 && key < n.keys[i]) i--;
        i++;
        if (n.children[i].isFull()) {
            splitChild(n, i);
            if (key > n.keys[i]) i++;
        }
        insertNonFull(n.children[i], key);
    }
}
```

### 10.4 Delete — the three cases (Python)

Delete is the trickiest operation. There are three structural cases:

1. **Key is in a leaf** — remove directly.
2. **Key is in an internal node** — replace it with its in-order predecessor (or successor) from a child, then recursively delete that key from the child.
3. **Key is not in the current node and we must descend** — ensure the child we descend into has at least `t` keys; if not, **fill** it by borrowing from a sibling or merging with one.

```python
def delete(self, key: int):
    self._delete(self.root, key)
    if not self.root.keys and not self.root.leaf:
        # root drained — promote its only child
        self.root = self.root.children[0]

def _delete(self, node: BTreeNode, key: int):
    t = self.t
    idx = 0
    while idx < len(node.keys) and key > node.keys[idx]:
        idx += 1

    if idx < len(node.keys) and node.keys[idx] == key:
        if node.leaf:
            node.keys.pop(idx)                          # case 1
        else:
            self._delete_internal(node, idx)            # case 2
    else:
        if node.leaf:
            return                                       # key not in tree
        # case 3: ensure child has >= t keys before descending
        flag = (idx == len(node.keys))
        if len(node.children[idx].keys) < t:
            self._fill(node, idx)
        target = node.children[idx - 1] if flag and idx > len(node.keys) else node.children[idx]
        self._delete(target, key)

def _delete_internal(self, node: BTreeNode, idx: int):
    t = self.t
    k = node.keys[idx]
    if len(node.children[idx].keys) >= t:
        pred = self._get_predecessor(node, idx)
        node.keys[idx] = pred
        self._delete(node.children[idx], pred)
    elif len(node.children[idx + 1].keys) >= t:
        succ = self._get_successor(node, idx)
        node.keys[idx] = succ
        self._delete(node.children[idx + 1], succ)
    else:
        self._merge(node, idx)
        self._delete(node.children[idx], k)

def _get_predecessor(self, node, idx):
    cur = node.children[idx]
    while not cur.leaf:
        cur = cur.children[-1]
    return cur.keys[-1]

def _get_successor(self, node, idx):
    cur = node.children[idx + 1]
    while not cur.leaf:
        cur = cur.children[0]
    return cur.keys[0]

def _fill(self, node, idx):
    t = self.t
    if idx != 0 and len(node.children[idx - 1].keys) >= t:
        self._borrow_from_prev(node, idx)
    elif idx != len(node.keys) and len(node.children[idx + 1].keys) >= t:
        self._borrow_from_next(node, idx)
    else:
        if idx != len(node.keys):
            self._merge(node, idx)
        else:
            self._merge(node, idx - 1)

def _borrow_from_prev(self, node, idx):
    child = node.children[idx]
    sib = node.children[idx - 1]
    child.keys.insert(0, node.keys[idx - 1])
    if not child.leaf:
        child.children.insert(0, sib.children.pop())
    node.keys[idx - 1] = sib.keys.pop()

def _borrow_from_next(self, node, idx):
    child = node.children[idx]
    sib = node.children[idx + 1]
    child.keys.append(node.keys[idx])
    if not child.leaf:
        child.children.append(sib.children.pop(0))
    node.keys[idx] = sib.keys.pop(0)

def _merge(self, node, idx):
    child = node.children[idx]
    sib = node.children[idx + 1]
    child.keys.append(node.keys.pop(idx))
    child.keys.extend(sib.keys)
    if not child.leaf:
        child.children.extend(sib.children)
    node.children.pop(idx + 1)
```

The combination of `_fill`, `_borrow_from_prev`, `_borrow_from_next`, and `_merge` keeps the invariant that **before we ever descend, the child we will land in already has at least `t` keys** — so any later deletion cannot underflow it.

---

<a name="patterns"></a>
## 11. Coding Patterns — Proactive Split on the Way Down

The cleanest B-tree insert is **proactive**: as we descend from root to leaf, **whenever we are about to step into a child that is already full (`2t-1` keys), we split it first**. After the split, the parent has one extra separator key, so we may need to choose the left or right half. We then descend into a node guaranteed to have room for one more key.

```
INSERT(tree, key):
    if root is full:
        new_root = empty internal node
        new_root.children[0] = root
        SPLIT(new_root, 0)
        root = new_root
    INSERT_NONFULL(root, key)

INSERT_NONFULL(node, key):
    if node is leaf:
        binary-search insert key into node.keys
        return
    i = index of first key in node greater than key
    if node.children[i] is full:
        SPLIT(node, i)
        if key > node.keys[i]:
            i += 1
    INSERT_NONFULL(node.children[i], key)
```

The benefit: insertion is **one downward pass**, no climb-back-up. Compared with the alternative "insert then propagate split upward", proactive split:

- Avoids a separate ascend phase, which is harder when each node is on disk.
- Means each parent is locked / pinned only while we are inside it. (Critical for concurrency — see `middle.md`.)
- Bounds work per recursive call at O(t), making total work O(t · log_t n).

The mirror pattern for delete is **proactive fill**: before descending into a child with only `t-1` keys, borrow or merge so it has at least `t`. Same one-pass guarantee.

---

<a name="errors"></a>
## 12. Error Handling

| Error | Cause | Mitigation |
|---|---|---|
| `t < 2` | Caller passed invalid degree | Validate at constructor; raise / panic. |
| Off-by-one in `splitChild` | Forgot that `keys[t-1]` is the median, not `keys[t]` | Draw a picture for `t=3`: keys `[a,b,c,d,e]`, median is `c` at index `2 = t-1`. |
| Children count vs key count desync | Tried to insert child without corresponding key | Invariant test: `len(children) == len(keys) + 1` for every internal node. |
| Root underflow not collapsed | Forgot to drop the root after delete drains it | After delete, if `root.keys` empty and `not root.leaf`, set `root = root.children[0]`. |
| Searching unsorted node | Forgot to sort on insert | Loop invariant: `keys[i] < keys[i+1]` for every `i`. Validate in debug. |
| Concurrent modification during search | No locking / latching | See `middle.md` lock-coupling section. |
| Duplicate keys not deduped | Two keys with same value coexist | Decide policy: B-tree definition allows duplicates; SQL UNIQUE indexes reject; document the choice. |

---

<a name="performance-tips"></a>
## 13. Performance Tips

1. **Pick `t` so a node fits one disk/SSD page.** For 4 KB pages and 16-byte (key, pointer) entries, `2t-1 ≈ 250` → `t ≈ 125`. For 16 KB pages, `t ≈ 500`. This single choice dominates real-world performance.
2. **Binary-search within a node** instead of linear scan once `t > 32`. A 256-key node is 8 comparisons binary vs 128 linear.
3. **Pre-allocate arrays at `2t` capacity** (Java/Go) so split does not reallocate. The Python code above grows dynamically — fine for learning, slow in production.
4. **Use a structure of arrays (SoA), not array of structs (AoS)** within a node — keys in one array, pointers in another. Better cache behavior during the search loop.
5. **Avoid pointer-chasing parent → child by always splitting on descent**; never store parent pointers. (Real disk B-trees almost never store parent pointers; they use a stack on the way down.)
6. **For in-memory B-trees, choose `t = 16` to `t = 32`** so a node fits in a CPU cache line group (~256 bytes per line, ~4 lines per node). This is what Java's `TreeMap` would beat if it were a B-tree (it is a red-black tree; see `04-red-black/`).
7. **Bulk loading from a sorted stream is O(n)** — see `middle.md`. Always faster than n individual inserts.

---

<a name="best-practices"></a>
## 14. Best Practices

- **Document `t` explicitly** in the class API. Users need to know whether the parameter is min-degree (CLRS `t`) or max-children (`m = 2t`); these two conventions differ by a factor of 2 and cause endless confusion.
- **Add an invariant-checker** for tests (`tasks.md` task 8): verify height equality across leaves, key count bounds, sortedness within nodes, BST property across separator keys. Run it on every test fixture.
- **Separate the node from the storage backend.** A clean B-tree has a `Node` interface implemented by `InMemoryNode` and `DiskNode`; the algorithm doesn't know which is which. This is how SQLite, BoltDB, and LMDB are built.
- **For learning, start with `t = 3`**. Splits and merges happen often enough to be visible.
- **Never reach into a node from outside.** All mutation goes through `split`, `merge`, `borrow`, `insert_nonfull`, `delete`. Easier to reason about correctness.
- **Test with random insertion sequences against a sorted dictionary** (`TreeMap` / `dict` / `sorted set`) as oracle. Any divergence in keys means a bug.

---

<a name="edge-cases"></a>
## 15. Edge Cases

| Case | Behavior |
|---|---|
| Empty tree, search | Returns "not found". Root is empty leaf, no children. |
| Insert into empty tree | Root acquires its first key. No split needed until `2t-1` keys total. |
| Insert into tree of height 0 (single node) | Add to root; split if root reaches `2t-1` — tree grows to height 1. |
| Delete from tree of height 0 | Just remove from root. If root becomes empty, tree remains height 0. |
| Delete the only key of a non-root leaf | Triggers fill/merge logic in parent. |
| Delete causes root to lose all keys | Promote root's single child. **Tree height decreases by 1.** This is the *only* place a B-tree shrinks vertically. |
| Insert duplicate key | Allowed by structure; in databases enforced by UNIQUE constraint at the API layer. |
| `t = 2` (2-3-4 tree) | Special case; equivalent to red-black tree as covered in `middle.md`. |
| Sequential ascending inserts | Pessimistic — every new key goes into the rightmost leaf, causing splits all the way up to the root in a regular cadence. Bulk-load instead. |

---

<a name="common-mistakes"></a>
## 16. Common Mistakes

1. **Splitting when not needed.** Splitting a non-full child wastes space and may even reduce fanout below the minimum.
2. **Off-by-one on child count.** For a node with `k` keys there must be exactly `k+1` children. Asserting this at every mutation catches 80% of bugs.
3. **Forgetting to redistribute before merging during delete.** Merging two minimally-full nodes is correct but wasteful when a sibling has spare capacity. Always try borrow first.
4. **Letting the root keep a single empty key array after delete.** Promote its sole child or you waste a layer.
5. **Putting the median key on the wrong side of the split.** The median rises to the parent; the **left half gets keys < median, the right half gets keys > median**. Common typo: median ends up in the left or right half too.
6. **Using `(lo + hi) / 2` for in-node binary search.** Same overflow trap as in plain binary search (see `08-search-algorithms/02-binary-search/junior.md`). Use `lo + (hi - lo) / 2`.
7. **Building a B-tree from sorted input with individual inserts.** Each insert triggers a split because the new key always lands at the rightmost leaf. Bulk-load instead — see `middle.md`.
8. **Not collapsing the root after delete.** Forgetting `if root.keys.empty: root = root.children[0]` produces a tree whose root is an empty internal node — searches still work but waste one comparison.
9. **Sharing a node between siblings (aliasing).** A split must produce a *fresh* sibling; if it accidentally shares the same array reference, mutations corrupt both. Common in Python where slicing returns a new list, but easy to get wrong in Java/Go.

---

<a name="cheat-sheet"></a>
## 17. Cheat Sheet

```
MINIMUM DEGREE t (>= 2)
    Keys per node:     t-1 .. 2t-1     (root: 1 .. 2t-1)
    Children per int:  t   .. 2t
    Height:            <= log_t((n+1)/2)

INVARIANTS
    All leaves at same depth
    Keys within node sorted ascending
    For internal node with keys K[0..k-1] and children C[0..k]:
        every key in C[i] < K[i] < every key in C[i+1]

SEARCH
    Walk node: find smallest i with key <= node.keys[i]
    If equal -> hit
    Else if leaf -> miss
    Else recurse into children[i]

INSERT (proactive split)
    If root full, split first and grow tree height by 1
    Descend; before stepping into a full child, split it
    At leaf, slot key in sorted order

SPLIT child idx
    median = full.keys[t-1]
    left  = full.keys[0..t-2]
    right = full.keys[t..2t-2]
    parent gains median as separator, sib as right neighbor

DELETE (proactive fill)
    Find key location during descent
    Case 1: in leaf -> remove
    Case 2: in internal -> replace with predecessor or successor, recurse
    Case 3: not here -> fill target child to >= t keys, recurse
        fill: borrow from left sib, or right sib, or merge

ROOT COLLAPSE
    After delete, if root has 0 keys and is internal,
        root = root.children[0]   (tree shrinks one level)
```

---

<a name="animation"></a>
## 18. Visual Animation Reference

See `animation.html` in this folder. It renders the B-tree level by level. Adjust `t` from the controls, then insert keys interactively. The animation highlights the path of descent, flashes a node yellow when it is being split, and animates the median key rising to the parent. Delete operations show underflow in red, then animate either a sibling-borrow (a key slides across via the parent) or a merge (two nodes collapse together). The stats panel reports `t`, current height, total keys, total nodes, and average fanout.

Try the canonical insert sequence from §9 with `t=3`: **10, 20, 5, 6, 12, 30, 7, 17**, then add **1, 2, 3** to trigger a cascading split. Then delete keys until the root drops a level.

---

<a name="summary"></a>
## 19. Summary

- A B-tree is a balanced multi-way search tree where each node holds many keys (typically dozens to hundreds), making it the natural fit for disk-resident indexes.
- The minimum-degree parameter `t` controls fill bounds: each node holds `t-1` to `2t-1` keys and `t` to `2t` children (root excepted).
- All leaves sit at the same depth. The tree's height is O(log_t n) — for billion-scale data with `t≈100`, that is 4 to 5 levels, meaning 4 to 5 disk reads per lookup.
- Insertion uses **proactive split on the way down**: split any full child before stepping in, guaranteeing a single downward pass. Deletion mirrors this with **proactive fill**.
- Search, insert, and delete all run in O(log_t n) I/Os with O(t · log_t n) in-memory comparisons.
- Common production tunings: pick `t` so a node fits one disk page (4–16 KB), binary-search within a node, bulk-load from sorted streams when possible.
- B-trees are the substrate of every relational database index, most filesystem catalogs, and every embedded key-value store with ordered iteration. Understanding the proactive split, the three delete cases, and the height bound is the foundational mental model for storage engineering.

Next up: `middle.md` covers 2-3 trees, 2-3-4 trees, the red-black equivalence, bulk loading, concurrency via lock coupling and B-link trees, and copy-on-write variants used by Btrfs and LMDB.

---

<a name="further-reading"></a>
## 20. Further Reading

- **Bayer, R., & McCreight, E. M.** (1972). *Organization and maintenance of large ordered indexes.* Acta Informatica, 1(3), 173–189. The original paper. Short, dense, foundational.
- **Knuth, D. E.** *The Art of Computer Programming, Volume 3: Sorting and Searching*, 2nd ed., Section 6.2.4. The most thorough mathematical treatment, including B*-trees, B-trees of higher order, and the analytic average-case fill rate (~ln 2 ≈ 69%).
- **Comer, D.** (1979). *The Ubiquitous B-Tree.* ACM Computing Surveys 11(2). Classic survey.
- **CLRS** — *Introduction to Algorithms*, 3rd ed., Chapter 18 "B-Trees". The pseudocode this document follows.
- **Sedgewick, R., & Wayne, K.** *Algorithms*, 4th ed., Section 6.2. Concrete Java implementation.
- **Petrov, A.** *Database Internals*, O'Reilly 2019, Chapter 2 "B-Tree Basics" and Chapter 3 "File Formats". The best modern treatment of how B-trees live inside real database engines.
- **Graefe, G.** (2011). *Modern B-Tree Techniques.* Foundations and Trends in Databases 3(4). 200 pages of every optimization shipped since 1970.
- Continue with `middle.md`.
