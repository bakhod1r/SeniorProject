# B+ Tree — Junior Level

> **Read time: ~40 minutes** · **Audience:** Engineers who already know classic B-trees (see `09-trees/08-b-tree`) and want to understand the variant that **every relational database actually uses**.

The B+ tree is, without exaggeration, **the most important data structure in databases**. PostgreSQL, MySQL InnoDB, SQLite, Oracle, SQL Server, LMDB, bbolt, and WiredTiger all use a B+ tree as their primary index structure. NTFS, XFS, and JFS use B+ trees for their on-disk directory layout. If you have ever issued `SELECT * FROM orders WHERE created_at BETWEEN '2026-01-01' AND '2026-02-01'`, the engine walked a B+ tree to answer your query.

This document teaches the B+ tree **specifically as a variant of the classic B-tree** you already know. The differences are small in number but enormous in consequence — they turn an excellent on-disk dictionary (the B-tree) into the right structure for an **analytic-friendly range index** (the B+ tree). We will cover the two non-negotiable structural rules, why they matter, the page layout, search/insert/delete with full walkthroughs, the linked-leaf "scan train" that makes range queries fly, and the bugs you will introduce the first time you write one.

---

## Table of Contents

1. [Introduction — Two Crucial Differences from B-tree](#introduction)
2. [Why this matters: range scans rule the database world](#why)
3. [Prerequisites](#prerequisites)
4. [Glossary](#glossary)
5. [Core Concepts — Routing vs Record Keys, Leaf Chain, Fanout](#core-concepts)
6. [Big-O Summary](#big-o-summary)
7. [Real-World Analogies](#analogies)
8. [B+ tree vs Classic B-tree](#vs-b-tree)
9. [Step-by-Step Walkthrough (t=3, 10 inserts)](#walkthrough)
10. [Code Examples — Go, Java, Python](#code-examples)
11. [Coding Patterns](#patterns)
12. [Error Handling — The Linked-List Disconnect Bug](#errors)
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
## 1. Introduction — Two Crucial Differences from B-tree

A **classic B-tree** (Bayer & McCreight, 1972) stores keys and the associated record (or a pointer to it) at **every** node — both internal nodes and leaf nodes. A search for a key may terminate at an internal node, never reaching a leaf. That is fine for an in-memory dictionary but a poor fit for the dominant query pattern in databases: **range scans**.

The **B+ tree** (formalized in Comer 1979's ACM Computing Surveys article *"The Ubiquitous B-Tree"*) modifies the classic B-tree with **exactly two structural rules** that change everything:

1. **Data lives ONLY at the leaves.** Internal nodes hold *routing keys* only — they are pure navigational signposts pointing at child subtrees. They do **not** carry payloads. A search **always** descends all the way to a leaf, even if the routing key at an internal node matches the search key exactly.

2. **All leaves are linked into a sorted singly-linked list.** Every leaf node has a `nextLeaf` pointer to its right sibling at the same level. Walking these pointers gives an **in-order traversal of all keys in O(1) per step**, with **zero re-traversal of the tree**.

Both rules are small in code. Both are enormous in performance.

The first rule means a routing key like `42` that appears in an internal node is **duplicated** in some leaf below — the leaf is the source of truth. The internal `42` is just a signpost saying "keys ≥ 42 go to the right subtree". This duplication is the visible cost of the design; in exchange you gain uniform tree height, simpler logic, and the property below.

The second rule means a query like

```sql
SELECT * FROM events WHERE ts BETWEEN '2026-05-01' AND '2026-05-02'
```

is answered by **one** descent (find the leaf containing `2026-05-01`), then a **sequential walk** along leaf-chain pointers until we pass `2026-05-02`. No back-tracking up the tree, no re-descent for the next page — just a linked-list walk. On rotating disks, on SSDs, on log-structured caches, sequential leaf traversal is **drastically cheaper** than a series of root-down lookups.

---

<a name="why"></a>
## 2. Why This Matters: Range Scans Rule the Database World

Most production database workloads are **range-dominated**, not exact-match-dominated. Counter your intuition? Consider:

- `SELECT * FROM orders WHERE created_at > now() - interval '1 day'` — range on a timestamp.
- `SELECT * FROM users WHERE id BETWEEN 1000 AND 2000` — range on a primary key.
- `SELECT * FROM logs WHERE level='ERROR' AND ts BETWEEN ... AND ...` — range on a composite key.
- `SELECT * FROM products WHERE category='shoes' ORDER BY price LIMIT 20` — equality on category, then ordered scan over price.
- Pagination: `SELECT * FROM rows WHERE id > $last LIMIT 100` — exactly a leaf-chain walk from a known leaf.

Even a primary-key lookup like `SELECT * FROM users WHERE id = 42` is, in MySQL InnoDB's clustered B+ tree, fundamentally a *single-key range scan* that returns at most one row. Range is the universal operation.

In a classic B-tree, a range scan is **expensive**: after finding the start key, the algorithm must navigate up to the parent, find the next-larger key, possibly traverse down a different subtree, and so on. Every step potentially costs an in-order successor traversal of complexity O(log n) amortized but with high constants because of the tree-walk overhead.

In a B+ tree, the same range scan is **trivially fast**: descend once to the start leaf, then follow `leaf.next` pointers. If the result span is `k` records and a leaf holds `b` records per page, total I/O is `O(log n + k/b)`. The `k/b` term is *sequential* — friendly to disk read-ahead, OS page cache, and SSD prefetching.

This is why **every major SQL database uses a B+ tree** as its on-disk index. The data model — tables of rows queried by ranges of indexed columns — is exactly the workload B+ trees were designed for.

---

<a name="prerequisites"></a>
## 3. Prerequisites

To follow this document, you should already know:

1. **Classic B-tree** — `09-trees/08-b-tree`. The B+ tree differs only in the two rules above; the split, merge, and rebalancing mechanics rhyme with classic B-tree mechanics but with the twist that splits are different at leaves vs internals.
2. **Balanced BST** — `09-trees/04-red-black`. Background mental model for "self-balancing" semantics.
3. **Binary search** — `08-search-algorithms/02-binary-search`. Each B+ tree node uses binary search internally to find the right child or leaf slot.
4. **Big-O thinking** — `01-introduction-to-dsa/03-asymptotic-analysis`. We'll talk about `log_t n` (logarithm base `t`) repeatedly.
5. **Pointers / references in Go / Java / Python** — leaves chain together with sibling pointers; you must track them carefully.

If you are shaky on any of these, especially the classic B-tree, pause and review. The two structural rules will not make sense without that baseline.

---

<a name="glossary"></a>
## 4. Glossary

| Term | Definition |
|---|---|
| **Node / Page** | A unit of storage. Internal nodes route; leaf nodes hold data. On disk, one node = one fixed-size page (commonly 4 KB, 8 KB, or 16 KB). |
| **Order `t` (minimum degree)** | A parameter governing fanout. Every internal node (except root) has between `t` and `2t` children. Equivalently between `t-1` and `2t-1` keys. We use Knuth's convention. |
| **Fanout** | The number of children pointers per internal node. Higher fanout → shallower tree → fewer disk seeks. Typical fanout for an 8 KB page with 24-byte routing keys: ~340. |
| **Routing key** | A key stored in an internal node. Its sole purpose is navigation: "keys ≥ this go right, keys < this go left." It is **not** the canonical copy of the record. |
| **Record key** | A key stored in a leaf node, together with its value (or row pointer). The canonical, queryable copy. |
| **Key duplication** | In a B+ tree, a key that routes at an internal level **also** appears at a leaf. This is the visible "cost" of the design. Often only the routing key (a prefix) is duplicated, not the full value. |
| **Leaf chain** | The singly-linked list of leaf nodes in ascending key order. The `nextLeaf` pointer in each leaf gives O(1) sequential traversal. |
| **Sibling pointer** | Another name for `nextLeaf`. Some B+ trees also maintain a `prevLeaf` pointer for reverse scans (doubly-linked leaves). |
| **Fill factor** | The ratio of used slots to total slots in a node. Splits are triggered at fill = 1.0 (full); merges at fill = 0.5 (half-full). |
| **Split** | When a node overflows, it divides into two siblings; the median routing key is copied (for leaf splits) or moved (for internal splits) into the parent. |
| **Merge** | When a node underflows, it combines with a sibling. The parent loses one routing key. |
| **Borrow / Redistribute** | Cheaper alternative to merge: move one key from a richer sibling to a poor sibling. |
| **Height `h`** | Number of edges from root to a leaf. Uniform across the tree. For `n` keys and fanout `t`: `h = O(log_t n)`. |
| **B-link tree** | A B+ tree variant (Lehman & Yao 1981) that adds a right-link at every level for concurrent operations. Used by PostgreSQL nbtree. See `middle.md`. |
| **IOT (Index-Organized Table)** | A B+ tree whose leaves carry **the full row**, not a pointer to the row. Oracle IOT, MySQL InnoDB primary index. See `senior.md`. |
| **Page split** | Disk-specific term for splitting a node = writing two pages. Costly because it may cascade up the tree. |

---

<a name="core-concepts"></a>
## 5. Core Concepts — Routing vs Record Keys, Leaf Chain, Fanout

### 5.1 The two node types

A B+ tree has **two distinct node types**, which classic B-trees do not:

**Internal node:**
```
+--------------------------------------+
| keys:     [k1, k2, k3, ..., k_{n}]   |
| children: [c0, c1, c2, c3, ..., c_n] |   // n+1 children, n routing keys
+--------------------------------------+
```
- No values, no records, no row pointers. Just routing keys and child pointers.
- Routing rule: child `c_i` covers keys in `[k_i, k_{i+1})` — closed on the left, open on the right, with `k_0 = -∞` and `k_{n+1} = +∞`.

**Leaf node:**
```
+-----------------------------------------------------+
| keys:   [k1, k2, k3, ..., k_n]                      |
| values: [v1, v2, v3, ..., v_n]                      |
| nextLeaf: ----------> (pointer to next leaf)        |
+-----------------------------------------------------+
```
- Holds the actual records.
- Has a `nextLeaf` pointer to the next leaf in key order.
- The last leaf's `nextLeaf` is `nil` (or wraps to a sentinel, depending on the implementation).

In a classic B-tree (`08-b-tree`), every node holds keys AND values, with no distinction between internal and leaf. That's the structural difference in a single sentence.

### 5.2 Key duplication is by design

Suppose the routing key `42` lives in an internal node. Where is the canonical record for `42`? In the leaf that the internal node points to on its right. So `42` appears **twice**: once as a routing signpost, once as a record. This is **not a bug** — it is the explicit cost of B+ trees that buys you uniform height and clean range semantics.

The space overhead from duplication is bounded by `O(n / b)` where `b` is the branching factor, because internal nodes are an `O(1/b)` fraction of all nodes. For a typical fanout of 300, only 1/300 of keys are duplicated. The overhead is negligible.

### 5.3 The leaf chain — the secret weapon

```
[10|20|30] --> [40|50|60] --> [70|80|90] --> [100|110|120] --> nil
```

This singly-linked list of leaves, sorted ascending, is the **single most important structural feature** of the B+ tree. To answer `SELECT * WHERE x BETWEEN 25 AND 95`:

1. Descend to the leaf containing `25` — that's `[10|20|30]` (since 25 falls in its range).
2. Scan the leaf forward, collecting keys `≥ 25` and `≤ 95`: just `30`.
3. Follow `nextLeaf` to `[40|50|60]`: collect `40, 50, 60`.
4. Follow `nextLeaf` to `[70|80|90]`: collect `70, 80, 90`.
5. Follow `nextLeaf` to `[100|110|120]`: stop — `100 > 95`.

Result: `[30, 40, 50, 60, 70, 80, 90]`. Total I/O: one root-to-leaf descent (O(log n)) plus 4 sequential leaf reads. No backtracking.

### 5.4 Fanout — why B+ trees are short

With routing keys typically 8–24 bytes and child pointers 8 bytes, an 8 KB internal page holds:

```
8192 bytes / (24 byte key + 8 byte pointer) ≈ 250 children per node
```

A tree with fanout 250 holding 10⁹ keys has height:

```
log_250(10⁹) = log(10⁹) / log(250) = 9 / 2.4 ≈ 3.8
```

So **any** record in a billion-row table is reachable in **4 page reads**. That is the raw economic argument for B+ trees on disk.

---

<a name="big-o-summary"></a>
## 6. Big-O Summary

| Operation | Complexity (I/O) | Complexity (in-memory) |
|---|---|---|
| **Search** | O(log_t n) | O(log n) |
| **Insert** | O(log_t n) | O(log n) |
| **Delete** | O(log_t n) | O(log n) |
| **Range scan returning `k` records, leaf size `b`** | O(log_t n + k/b) | O(log n + k) |
| **In-order traversal** | O(n/b) sequential pages | O(n) |
| **Min / max** | O(log_t n) (leftmost / rightmost leaf) | O(log n) |
| **Successor / predecessor** | O(1) amortized via leaf chain | O(1) amortized |
| **Space** | O(n / fill_factor) | O(n) |

The crucial improvement over a classic B-tree is **range scan**: `O(log_t n + k/b)` with sequential I/O, vs the classic B-tree's `O(log_t n + k)` in-order traversal that may revisit internal nodes.

For `n = 10⁹` and `t = 250`: about 4 page reads per point lookup. For a range scan returning 100 records with leaf size 50, that's 4 + 2 = **6 pages total**.

---

<a name="analogies"></a>
## 7. Real-World Analogies

### 7.1 A phone book with tabbed cross-references

Imagine a paper phone book. The body is sorted alphabetically (the leaves). At the top there is a single-line index tab section: "A–F: page 1", "G–K: page 47", "L–Q: page 113", "R–Z: page 200". Those tabs are the **routing keys**. They do not contain phone numbers, just pointers. The phone numbers live only in the body.

Now add an arrow at the bottom of each page: "→ continued on next page". That arrow is the **leaf chain pointer**. To list everyone whose name starts with "M" you find the right page once, then follow the arrows.

### 7.2 An apartment building directory + room signs

The lobby directory is small: "Apartments 1–10: Floor 1", "11–20: Floor 2", etc. (routing). Each floor has rooms (leaves) with a "→ next floor" sign. To deliver mail to apartments 7 through 16 you look at the directory once, take the elevator to floor 1, deliver to 7–10, take the stairs to floor 2, deliver to 11–16. One directory lookup, then sequential floor walking.

### 7.3 A library shelving system

The catalog tells you which shelving section contains call number `QA76.6 .C26`. You walk to that section (leaf). To browse "all books on the shelf nearby on related topics," you just walk along the shelves — you don't return to the catalog for each book. That's the leaf chain.

### 7.4 A train system with hub stations

Hub stations (internal nodes) route passengers to the right line but never store passengers. The platforms (leaves) hold the actual riders, and consecutive platforms are linked by a connecting walkway. To find all riders going to stations 4–9 you visit hub stations once, walk to platform 4, then walk along the walkway through 5, 6, 7, 8, 9.

---

<a name="vs-b-tree"></a>
## 8. B+ Tree vs Classic B-tree

| Property | Classic B-tree | B+ tree |
|---|---|---|
| **Where data lives** | All nodes (internal AND leaf) | Leaves only |
| **Routing keys** | Same as record keys | Subset, often only prefixes |
| **Key duplication** | None — each key stored once | Yes — routing keys also appear in leaves |
| **Search termination** | Anywhere (internal or leaf) | Always at a leaf |
| **Leaf links** | Optional / not part of definition | Required, sorted singly-linked list |
| **In-order traversal** | Recursive tree walk, O(log n) per step | Linear leaf chain walk, O(1) per step |
| **Range scan cost** | O(log n + k) with re-traversal | O(log n + k/b) sequential I/O |
| **Memory efficiency** | Slightly better (no duplication) | Slightly worse (~1/b overhead) |
| **Insert / delete complexity** | O(log n), can be tricky to maintain ordering across internal+leaf | O(log n), cleaner because leaves are uniform |
| **Used by** | Some in-memory dictionaries, IndexedDB historically | **All major SQL DBs**: PostgreSQL, MySQL InnoDB, SQLite, Oracle, SQL Server, LMDB, bbolt, WiredTiger |
| **Used by file systems** | Some legacy | NTFS, XFS, JFS, ReiserFS |

**Bottom line:** A classic B-tree is theoretically slightly more space-efficient but practically dominated by the B+ tree's range-scan advantage. Every production database that needs ordered indexes uses the B+ variant.

When **would** you pick a classic B-tree? Almost never on disk. Possibly in memory for a key-value store with no range queries (where you'd actually prefer a hash table anyway). The B+ tree's small space cost is a non-issue compared to its range performance.

---

<a name="walkthrough"></a>
## 9. Step-by-Step Walkthrough (t=3, 10 inserts)

Let `t = 3` (minimum degree). Each node holds between `2` and `5` keys. We'll use leaf capacity 4 for simplicity (max 4 records per leaf, min 2).

Inserts in order: `5, 9, 3, 7, 1, 4, 11, 6, 2, 12`.

### Step 1. Insert 5

Empty tree. Create a leaf, insert 5. Root = this leaf.

```
[5]   (root + leaf, nextLeaf = nil)
```

### Step 2. Insert 9

```
[5, 9]   nextLeaf = nil
```

### Step 3. Insert 3

Sorted order kept. Leaf has 3 keys, still under capacity (4).

```
[3, 5, 9]   nextLeaf = nil
```

### Step 4. Insert 7

```
[3, 5, 7, 9]   nextLeaf = nil    (leaf is now full)
```

### Step 5. Insert 1

Leaf overflows. **Split a leaf:**

- New left leaf: `[1, 3]`
- New right leaf: `[5, 7, 9]`
- Copy the smallest key of the new right leaf (`5`) up to the parent as a routing key.
- Create a new root: internal node with key `[5]` pointing to the two leaves.
- Link leaves: `leftLeaf.nextLeaf = rightLeaf`.

```
            [5]                <- internal (root, routing)
           /   \
      [1, 3] -> [5, 7, 9] -> nil
```

Notice **`5` appears in both** the internal node (routing) and the right leaf (record). That is key duplication in action. This is **different from classic B-tree splits**, which would *move* `5` up rather than copy it. In a B+ tree the leaf must retain `5` because that is where the record lives.

### Step 6. Insert 4

Descend: at root, `4 < 5` → go left → leaf `[1, 3]`. Insert: `[1, 3, 4]`.

```
            [5]
           /   \
   [1, 3, 4] -> [5, 7, 9] -> nil
```

### Step 7. Insert 11

Descend: `11 ≥ 5` → go right → leaf `[5, 7, 9]`. Insert: `[5, 7, 9, 11]` (full).

```
            [5]
           /   \
   [1, 3, 4] -> [5, 7, 9, 11] -> nil
```

### Step 8. Insert 6

Descend: `6 ≥ 5` → right leaf `[5, 7, 9, 11]`. Would become `[5, 6, 7, 9, 11]` — overflow. **Split:**

- Left half: `[5, 6]`
- Right half: `[7, 9, 11]`
- Copy `7` (smallest of new right) up.

Parent currently has key `[5]` and 2 children. After split it gets a new routing key `[5, 7]` and 3 children. Within capacity (max 5 keys).

Fix the leaf chain: `[5, 6].nextLeaf = [7, 9, 11]; [7, 9, 11].nextLeaf = nil`.

```
              [5,    7]
             /   |    \
   [1,3,4] -> [5,6] -> [7,9,11] -> nil
```

### Step 9. Insert 2

Descend: at root, `2 < 5` → go left → leaf `[1, 3, 4]`. Insert: `[1, 2, 3, 4]` (full but OK).

```
              [5,    7]
             /   |    \
 [1,2,3,4] -> [5,6] -> [7,9,11] -> nil
```

### Step 10. Insert 12

Descend: `12 ≥ 7` → right leaf `[7, 9, 11]`. Insert: `[7, 9, 11, 12]` (full).

```
              [5,    7]
             /   |    \
 [1,2,3,4] -> [5,6] -> [7,9,11,12] -> nil
```

Final tree. Notice:
- All paths from root to leaf have length 2 (height 1).
- Every leaf has between 2 and 4 keys (within bounds).
- Keys `5` and `7` are duplicated (routing + record).
- Leaves form the chain `[1,2,3,4] → [5,6] → [7,9,11,12] → nil`.

A range scan for `WHERE x BETWEEN 3 AND 10`:
1. Descend to leaf containing 3: `[1,2,3,4]`. Emit `3, 4`.
2. Follow chain to `[5,6]`. Emit `5, 6`.
3. Follow chain to `[7,9,11,12]`. Emit `7, 9`. Stop at `11 > 10`.

Result: `[3, 4, 5, 6, 7, 9]`. **One descent + 2 chain hops.**

---

<a name="code-examples"></a>
## 10. Code Examples — Go, Java, Python

Below is an in-memory B+ tree supporting `Search`, `Insert`, and `RangeScan`. `Delete` is included only in skeleton form because the full delete logic is long and is covered in `tasks.md` task 1.

### 10.1 Go

```go
package bplustree

const t = 3                  // minimum degree
const leafCap = 2*t - 1      // max keys per leaf = 5 (toy example)

type Leaf struct {
    keys     []int
    values   []string
    nextLeaf *Leaf
}

type Internal struct {
    keys     []int
    children []interface{}   // *Internal or *Leaf
}

type BPlusTree struct {
    root interface{}         // *Internal or *Leaf
}

func New() *BPlusTree {
    return &BPlusTree{root: &Leaf{}}
}

// Search descends to the leaf and returns the value if present.
func (b *BPlusTree) Search(key int) (string, bool) {
    leaf := b.findLeaf(key)
    for i, k := range leaf.keys {
        if k == key {
            return leaf.values[i], true
        }
    }
    return "", false
}

func (b *BPlusTree) findLeaf(key int) *Leaf {
    node := b.root
    for {
        switch n := node.(type) {
        case *Leaf:
            return n
        case *Internal:
            // Find the child to descend into. Use binary search in practice.
            i := 0
            for i < len(n.keys) && key >= n.keys[i] {
                i++
            }
            node = n.children[i]
        }
    }
}

// Insert adds (key, value) to the tree.
func (b *BPlusTree) Insert(key int, value string) {
    promoted, newChild := b.insertRec(b.root, key, value)
    if promoted != nil {
        // Root split: build a new root.
        b.root = &Internal{
            keys:     []int{*promoted},
            children: []interface{}{b.root, newChild},
        }
    }
}

// insertRec returns (promotedKey, newRightSibling) if the child split, else (nil, nil).
func (b *BPlusTree) insertRec(node interface{}, key int, value string) (*int, interface{}) {
    switch n := node.(type) {
    case *Leaf:
        return b.insertIntoLeaf(n, key, value)
    case *Internal:
        // Find child slot.
        i := 0
        for i < len(n.keys) && key >= n.keys[i] {
            i++
        }
        promoted, newRight := b.insertRec(n.children[i], key, value)
        if promoted == nil {
            return nil, nil
        }
        // Child split — insert promoted key + new child here.
        n.keys = append(n.keys, 0)
        copy(n.keys[i+1:], n.keys[i:])
        n.keys[i] = *promoted
        n.children = append(n.children, nil)
        copy(n.children[i+2:], n.children[i+1:])
        n.children[i+1] = newRight
        if len(n.keys) <= leafCap {
            return nil, nil
        }
        return b.splitInternal(n)
    }
    return nil, nil
}

func (b *BPlusTree) insertIntoLeaf(leaf *Leaf, key int, value string) (*int, interface{}) {
    // Insert in sorted order.
    i := 0
    for i < len(leaf.keys) && leaf.keys[i] < key {
        i++
    }
    if i < len(leaf.keys) && leaf.keys[i] == key {
        leaf.values[i] = value             // overwrite duplicate key
        return nil, nil
    }
    leaf.keys = append(leaf.keys, 0)
    copy(leaf.keys[i+1:], leaf.keys[i:])
    leaf.keys[i] = key
    leaf.values = append(leaf.values, "")
    copy(leaf.values[i+1:], leaf.values[i:])
    leaf.values[i] = value
    if len(leaf.keys) <= leafCap {
        return nil, nil
    }
    return b.splitLeaf(leaf)
}

// splitLeaf splits a full leaf, COPIES the smallest key of the new right leaf up.
func (b *BPlusTree) splitLeaf(leaf *Leaf) (*int, interface{}) {
    mid := len(leaf.keys) / 2
    right := &Leaf{
        keys:     append([]int{}, leaf.keys[mid:]...),
        values:   append([]string{}, leaf.values[mid:]...),
        nextLeaf: leaf.nextLeaf,
    }
    leaf.keys = leaf.keys[:mid]
    leaf.values = leaf.values[:mid]
    leaf.nextLeaf = right                  // maintain leaf chain
    promoted := right.keys[0]              // COPY UP (not move)
    return &promoted, right
}

// splitInternal splits a full internal node, MOVES the median key up.
func (b *BPlusTree) splitInternal(n *Internal) (*int, interface{}) {
    mid := len(n.keys) / 2
    promoted := n.keys[mid]
    right := &Internal{
        keys:     append([]int{}, n.keys[mid+1:]...),
        children: append([]interface{}{}, n.children[mid+1:]...),
    }
    n.keys = n.keys[:mid]
    n.children = n.children[:mid+1]
    return &promoted, right
}

// RangeScan returns all (key, value) pairs with lo <= key <= hi.
func (b *BPlusTree) RangeScan(lo, hi int) [][2]interface{} {
    var out [][2]interface{}
    leaf := b.findLeaf(lo)
    for leaf != nil {
        for i, k := range leaf.keys {
            if k < lo {
                continue
            }
            if k > hi {
                return out
            }
            out = append(out, [2]interface{}{k, leaf.values[i]})
        }
        leaf = leaf.nextLeaf               // FOLLOW THE CHAIN
    }
    return out
}
```

The critical lines:
- `right.nextLeaf = leaf.nextLeaf; leaf.nextLeaf = right` — splice the new leaf into the chain.
- `promoted := right.keys[0]` — **copy up**, do not move. The leaf retains the record.
- `splitInternal` uses **move up** (the promoted key is removed from the internal node) — internals do not hold records, so no duplication is needed.

### 10.2 Java

```java
public class BPlusTree<V> {
    private static final int T = 3;
    private static final int LEAF_CAP = 2 * T - 1;

    static abstract class Node {
        int[] keys = new int[0];
    }
    static class Leaf<V> extends Node {
        Object[] values = new Object[0];
        Leaf<V> nextLeaf;
    }
    static class Internal extends Node {
        Node[] children = new Node[0];
    }

    private Node root = new Leaf<V>();

    @SuppressWarnings("unchecked")
    public V search(int key) {
        Leaf<V> leaf = findLeaf(key);
        for (int i = 0; i < leaf.keys.length; i++) {
            if (leaf.keys[i] == key) return (V) leaf.values[i];
        }
        return null;
    }

    private Leaf<V> findLeaf(int key) {
        Node node = root;
        while (node instanceof Internal) {
            Internal in = (Internal) node;
            int i = 0;
            while (i < in.keys.length && key >= in.keys[i]) i++;
            node = in.children[i];
        }
        return (Leaf<V>) node;
    }

    public void insert(int key, V value) {
        Object[] split = insertRec(root, key, value);
        if (split != null) {
            Internal newRoot = new Internal();
            newRoot.keys = new int[]{(int) split[0]};
            newRoot.children = new Node[]{root, (Node) split[1]};
            root = newRoot;
        }
    }

    private Object[] insertRec(Node node, int key, V value) {
        if (node instanceof Leaf) {
            return insertIntoLeaf((Leaf<V>) node, key, value);
        }
        Internal in = (Internal) node;
        int i = 0;
        while (i < in.keys.length && key >= in.keys[i]) i++;
        Object[] split = insertRec(in.children[i], key, value);
        if (split == null) return null;
        in.keys = insertInt(in.keys, i, (int) split[0]);
        in.children = insertNode(in.children, i + 1, (Node) split[1]);
        if (in.keys.length <= LEAF_CAP) return null;
        return splitInternal(in);
    }

    private Object[] insertIntoLeaf(Leaf<V> leaf, int key, V value) {
        int i = 0;
        while (i < leaf.keys.length && leaf.keys[i] < key) i++;
        if (i < leaf.keys.length && leaf.keys[i] == key) {
            leaf.values[i] = value;        // overwrite
            return null;
        }
        leaf.keys = insertInt(leaf.keys, i, key);
        leaf.values = insertObj(leaf.values, i, value);
        if (leaf.keys.length <= LEAF_CAP) return null;
        return splitLeaf(leaf);
    }

    private Object[] splitLeaf(Leaf<V> leaf) {
        int mid = leaf.keys.length / 2;
        Leaf<V> right = new Leaf<>();
        right.keys = java.util.Arrays.copyOfRange(leaf.keys, mid, leaf.keys.length);
        right.values = java.util.Arrays.copyOfRange(leaf.values, mid, leaf.values.length);
        right.nextLeaf = leaf.nextLeaf;
        leaf.keys = java.util.Arrays.copyOfRange(leaf.keys, 0, mid);
        leaf.values = java.util.Arrays.copyOfRange(leaf.values, 0, mid);
        leaf.nextLeaf = right;             // maintain chain
        return new Object[]{right.keys[0], right};   // COPY UP
    }

    private Object[] splitInternal(Internal in) {
        int mid = in.keys.length / 2;
        int promoted = in.keys[mid];
        Internal right = new Internal();
        right.keys = java.util.Arrays.copyOfRange(in.keys, mid + 1, in.keys.length);
        right.children = java.util.Arrays.copyOfRange(in.children, mid + 1, in.children.length);
        in.keys = java.util.Arrays.copyOfRange(in.keys, 0, mid);
        in.children = java.util.Arrays.copyOfRange(in.children, 0, mid + 1);
        return new Object[]{promoted, right};         // MOVE UP
    }

    public java.util.List<V> rangeScan(int lo, int hi) {
        java.util.List<V> out = new java.util.ArrayList<>();
        Leaf<V> leaf = findLeaf(lo);
        while (leaf != null) {
            for (int i = 0; i < leaf.keys.length; i++) {
                if (leaf.keys[i] < lo) continue;
                if (leaf.keys[i] > hi) return out;
                out.add((V) leaf.values[i]);
            }
            leaf = leaf.nextLeaf;          // FOLLOW THE CHAIN
        }
        return out;
    }

    // helpers omitted for brevity: insertInt, insertObj, insertNode
    private static int[] insertInt(int[] a, int idx, int v) {
        int[] r = new int[a.length + 1];
        System.arraycopy(a, 0, r, 0, idx);
        r[idx] = v;
        System.arraycopy(a, idx, r, idx + 1, a.length - idx);
        return r;
    }
    private static Object[] insertObj(Object[] a, int idx, Object v) {
        Object[] r = new Object[a.length + 1];
        System.arraycopy(a, 0, r, 0, idx);
        r[idx] = v;
        System.arraycopy(a, idx, r, idx + 1, a.length - idx);
        return r;
    }
    private static Node[] insertNode(Node[] a, int idx, Node v) {
        Node[] r = new Node[a.length + 1];
        System.arraycopy(a, 0, r, 0, idx);
        r[idx] = v;
        System.arraycopy(a, idx, r, idx + 1, a.length - idx);
        return r;
    }
}
```

### 10.3 Python

```python
from dataclasses import dataclass, field
from typing import Optional, Any

T = 3
LEAF_CAP = 2 * T - 1

@dataclass
class Leaf:
    keys: list = field(default_factory=list)
    values: list = field(default_factory=list)
    next_leaf: Optional["Leaf"] = None
    is_leaf = True

@dataclass
class Internal:
    keys: list = field(default_factory=list)
    children: list = field(default_factory=list)
    is_leaf = False

class BPlusTree:
    def __init__(self):
        self.root = Leaf()

    def search(self, key):
        leaf = self._find_leaf(key)
        for k, v in zip(leaf.keys, leaf.values):
            if k == key:
                return v
        return None

    def _find_leaf(self, key) -> Leaf:
        node = self.root
        while not node.is_leaf:
            i = 0
            while i < len(node.keys) and key >= node.keys[i]:
                i += 1
            node = node.children[i]
        return node

    def insert(self, key, value):
        split = self._insert_rec(self.root, key, value)
        if split is not None:
            promoted, right = split
            new_root = Internal(keys=[promoted], children=[self.root, right])
            self.root = new_root

    def _insert_rec(self, node, key, value):
        if node.is_leaf:
            return self._insert_into_leaf(node, key, value)
        i = 0
        while i < len(node.keys) and key >= node.keys[i]:
            i += 1
        split = self._insert_rec(node.children[i], key, value)
        if split is None:
            return None
        promoted, right = split
        node.keys.insert(i, promoted)
        node.children.insert(i + 1, right)
        if len(node.keys) <= LEAF_CAP:
            return None
        return self._split_internal(node)

    def _insert_into_leaf(self, leaf: Leaf, key, value):
        i = 0
        while i < len(leaf.keys) and leaf.keys[i] < key:
            i += 1
        if i < len(leaf.keys) and leaf.keys[i] == key:
            leaf.values[i] = value
            return None
        leaf.keys.insert(i, key)
        leaf.values.insert(i, value)
        if len(leaf.keys) <= LEAF_CAP:
            return None
        return self._split_leaf(leaf)

    def _split_leaf(self, leaf: Leaf):
        mid = len(leaf.keys) // 2
        right = Leaf(
            keys=leaf.keys[mid:],
            values=leaf.values[mid:],
            next_leaf=leaf.next_leaf,
        )
        leaf.keys = leaf.keys[:mid]
        leaf.values = leaf.values[:mid]
        leaf.next_leaf = right             # CRITICAL: maintain chain
        return right.keys[0], right         # COPY UP

    def _split_internal(self, node: Internal):
        mid = len(node.keys) // 2
        promoted = node.keys[mid]
        right = Internal(
            keys=node.keys[mid + 1:],
            children=node.children[mid + 1:],
        )
        node.keys = node.keys[:mid]
        node.children = node.children[:mid + 1]
        return promoted, right              # MOVE UP

    def range_scan(self, lo, hi):
        out = []
        leaf = self._find_leaf(lo)
        while leaf is not None:
            for k, v in zip(leaf.keys, leaf.values):
                if k < lo:
                    continue
                if k > hi:
                    return out
                out.append((k, v))
            leaf = leaf.next_leaf           # FOLLOW THE CHAIN
        return out
```

The single most important takeaway from all three implementations: **leaf splits copy the median key up; internal splits move the median key up.** This asymmetry is what gives the B+ tree its uniform leaf-resident data invariant.

---

<a name="patterns"></a>
## 11. Coding Patterns

### Pattern 1: Always descend to a leaf, even on equality

```python
while not node.is_leaf:
    i = first_index_where_key_geq(node.keys, search_key)
    node = node.children[i]
```

Do **not** early-return when a routing key in an internal node equals your search key. The record is in the leaf, not in the internal node.

### Pattern 2: Splice into the leaf chain whenever a leaf splits

```python
right.next_leaf = leaf.next_leaf
leaf.next_leaf = right
```

Forgetting this is the #1 B+ tree bug. Range scans silently truncate or skip elements.

### Pattern 3: Copy-up for leaf splits, move-up for internal splits

| Split type | Promote how | Why |
|---|---|---|
| Leaf split | Copy smallest of right leaf | Leaf retains the record (data lives at leaves) |
| Internal split | Move median key | Internals have no records, so move avoids redundancy |

### Pattern 4: Range scans always start with `find_leaf(lo)`, then walk

```python
leaf = find_leaf(lo)
while leaf is not None:
    for k, v in zip(leaf.keys, leaf.values):
        if k < lo: continue
        if k > hi: return
        yield (k, v)
    leaf = leaf.next_leaf
```

### Pattern 5: Binary search inside each node

For correctness, the linear scan `while i < len(keys) and key >= keys[i]` works fine. For performance on large nodes (fanout > 50), use binary search to find the slot in O(log b) instead of O(b). See `senior.md` and `professional.md`.

---

<a name="errors"></a>
## 12. Error Handling — The Linked-List Disconnect Bug

The single biggest pitfall in B+ tree implementation is **failing to maintain the leaf chain correctly during splits and merges**. Symptoms:

- Range scans silently stop early.
- Range scans iterate forever (cycle in the chain).
- `nextLeaf` points to a deallocated / merged-away leaf (use-after-free / NPE).
- Concurrent reads see partial / inconsistent results during a split.

### Bug 1: forgot to splice the new leaf during a split

```python
# WRONG:
def _split_leaf(self, leaf):
    mid = len(leaf.keys) // 2
    right = Leaf(keys=leaf.keys[mid:], values=leaf.values[mid:])
    leaf.keys = leaf.keys[:mid]
    leaf.values = leaf.values[:mid]
    # MISSING: right.next_leaf = leaf.next_leaf
    # MISSING: leaf.next_leaf = right
    return right.keys[0], right
```

A range scan starting at `leaf` will skip `right` entirely. The new leaf is reachable only through the tree (not through the chain), so range scans silently undercount.

### Bug 2: forgot to update the predecessor when merging

When two leaves merge, the leaf-chain pointer of the **predecessor** must skip over the deleted leaf:

```
Before: [A] -> [B (underflows)] -> [C] -> nil
After:  [A] -> [BC merged] -> nil
```

`A.nextLeaf` must be updated to point to the merged result, **not** the deleted `B` or the unchanged `C`. Finding `A` cheaply is non-trivial in a singly-linked chain (it requires either a parent traversal or a `prevLeaf` pointer). Most production B+ trees maintain a doubly-linked leaf chain partly for this reason.

### Bug 3: updating one direction without the other (doubly-linked chains)

If your design uses both `next` and `prev` pointers, every split/merge must update both. Forgetting one half causes reverse scans to dead-end or loop.

### Bug 4: concurrent disconnect

In a single-threaded B+ tree these are easy to avoid with discipline. In a concurrent B+ tree, a split must atomically:
1. Allocate the new leaf.
2. Update predecessor's `nextLeaf` to point to the new leaf.
3. Update tree pointer to the new leaf's parent slot.

A reader observing the chain between steps 1 and 2 sees the old structure (safe). A reader between 2 and 3 sees the new leaf via the chain but cannot yet find it via tree descent (sometimes acceptable, sometimes not). The **Lehman-Yao B-link tree** (see `middle.md`) handles this with right-link pointers at every level so readers can recover from concurrent splits without taking locks.

### Defensive programming

- Every split should be followed by an `assert` that the new leaf's `nextLeaf` matches the parent's right neighbor.
- Run a periodic chain-walk consistency check in dev/test builds.
- In production, maintain an invariant counter: the chain length should equal the tree's leaf count.

---

<a name="performance-tips"></a>
## 13. Performance Tips

1. **Sibling links DOUBLE the cost-effectiveness of range queries.** With them, range scan I/O is `O(log n + k/b)` sequentially. Without them (i.e., a classic B-tree), `O(log n + k)` with random tree-walk hops. For `k=1M` records and `b=100`, that's 10⁶ random reads vs 10⁴ sequential reads.

2. **Pick leaf size for sequential read-ahead.** OS-level read-ahead works best when leaves are aligned to and sized at the page boundary the kernel prefetches. Linux's default read-ahead is 128 KB. A leaf size of 16 KB (the InnoDB default) yields 8 leaves per read-ahead window, often a sweet spot.

3. **Fill leaves to ~70%** initially, not 100%. Inserts into a 100%-full leaf trigger an immediate split. Bulk loaders (Postgres `CREATE INDEX`, MySQL `ALTER TABLE`) leave a configurable amount of free space (`fillfactor`) to absorb inserts without splits.

4. **Use prefix compression in leaves.** Adjacent keys often share long prefixes (timestamps, sorted IDs). Storing only the diff saves substantial space. PostgreSQL nbtree added this in v13.

5. **Use binary search within nodes** when fanout is large (>50). Linear scan is faster only for small nodes due to cache effects.

6. **Cache the leftmost leaf.** Full-scan queries (`SELECT *`) start there. Avoiding the root descent on every full scan is a micro-optimization but easy.

7. **Avoid leaf merges if possible.** Tolerate slightly underfull leaves (down to ~25% fill) before triggering a merge. Merges are expensive (rewrites two pages) and complicate concurrent readers.

---

<a name="best-practices"></a>
## 14. Best Practices

- **Always update sibling pointers atomically with merges/splits.** This is the single most important invariant.
- **Document leaf-chain invariants** in your code: "after split/merge, the leaf chain is in ascending key order and reachable from every leaf via `next`".
- **Use the smallest-key-of-right-leaf as the promoted key.** This is the canonical convention; it makes routing logic uniform.
- **Pick page size = OS page size or its multiple.** Aligning to 4 KB / 8 KB / 16 KB minimizes I/O amplification.
- **Decide upfront whether keys are unique.** Duplicate handling complicates leaf structure (extra chain by key value) and Range semantics.
- **Build a validator.** A function `validate(tree)` that asserts: uniform height, every internal key respects routing rule, every leaf has count in `[t-1, 2t-1]` (root excepted), leaf chain reachable and ordered, no key in two leaves.
- **Test under concurrent insert and range scan** even if your initial implementation is single-threaded — race-condition bugs surface differently from sequential bugs.

---

<a name="edge-cases"></a>
## 15. Edge Cases

| Case | Expected behavior |
|---|---|
| Empty tree | Search returns "not found"; range scan returns empty. Root is an empty leaf. |
| Single leaf, single key | Search works; range scan over the whole tree returns one record. |
| Insert duplicate key | Overwrite value (typical) OR insert next to existing (duplicate-keys mode). Document which. |
| Range scan with `lo == hi` | Returns at most one record. Identical to point lookup. |
| Range scan with `lo > hi` | Empty result. Validate the input. |
| Range scan over entire tree | `lo = -∞, hi = +∞`. Linear walk of the chain from leftmost leaf. |
| Range scan crosses many leaves | I/O is `O(k/b)` sequential pages. |
| Delete the only key in a leaf | Leaf becomes empty; merge with sibling or be left empty (root case). |
| Delete that empties the root leaf | Tree becomes empty; reset root to a fresh empty leaf. |
| Delete a routing key | The routing key in the internal node is NOT the canonical record. Delete from the leaf; the internal routing key may stay (it still routes correctly) or be replaced with the new smallest key of the right subtree. |
| Insert that causes cascading splits up to root | Tree grows by one level. New root is created. |
| Range scan past the last leaf | `nextLeaf` is `nil`; loop terminates naturally. |

---

<a name="common-mistakes"></a>
## 16. Common Mistakes

1. **Forgetting to maintain leaf-chain pointers during merges.** The classic silent bug. Range scans either skip records or loop forever.
2. **Confusing routing keys with record keys.** The internal node has `42`; you assume it IS the record. It is just a signpost. The record `42` is in the leaf to the right.
3. **Deleting a routing key from an internal node when its leaf record is deleted.** The routing key in the internal node should remain (it still routes correctly) unless the entire subtree underneath is emptied. Many beginner implementations incorrectly delete the routing key, leading to a half-broken tree.
4. **Moving the key up on a leaf split (instead of copying).** Classic B-tree mechanics. In a B+ tree the leaf must retain the key — that's where the record lives.
5. **Copying the key up on an internal split (instead of moving).** Internals have no record duty; copy creates redundant routing keys.
6. **Early-terminating descent when the search key equals a routing key.** The record is in a leaf. Always descend.
7. **Using a single node type (no leaf vs internal distinction).** Tempting because it looks cleaner, but you'll regret it at split time. Different splits need different policies.
8. **Maintaining only `next` pointers when reverse scans are required.** `SELECT * ORDER BY t DESC LIMIT 100` requires `prev` pointers or an O(log n) re-descent per leaf.
9. **Setting leaf capacity to a single value forever.** In production you tune leaf size separately from internal-node size. Internals can be wider; leaves are limited by record size.
10. **Not validating the invariant after every operation.** Hidden bugs accumulate. Build `validate(tree)` early and run it in tests after every insert/delete.

---

<a name="cheat-sheet"></a>
## 17. Cheat Sheet

```
TWO RULES THAT MAKE A B+ TREE
   1. Data is in leaves ONLY. Internal nodes are pure routing.
   2. Leaves form a sorted singly-linked list via nextLeaf pointers.

SEARCH(key)
   descend tree, picking child where key fits routing range
   ALWAYS finish at a leaf (never short-circuit on equality)
   linear/binary search inside the leaf

INSERT(key, value)
   descend to target leaf
   insert in sorted order
   if leaf overflows:
       split leaf into [left | right]
       COPY smallest key of right up to parent       <- KEY POINT
       splice right into the leaf chain (next pointers)
   propagate split upward if parent overflows

   when an INTERNAL node splits:
       MOVE median key up (internals do not store records)

DELETE(key)
   descend to target leaf
   remove key from leaf
   if leaf underflows (< t-1 keys):
       borrow from sibling, or
       merge with sibling (update predecessor's next pointer!)
   propagate parent updates

RANGE SCAN(lo, hi)
   leaf = find_leaf(lo)
   while leaf:
       for k,v in leaf:
           if k < lo: continue
           if k > hi: return
           emit (k,v)
       leaf = leaf.next_leaf            <- THE WINNING MOVE

COMPLEXITY
   Search/Insert/Delete: O(log_t n) I/O
   Range scan returning k records, leaf size b: O(log_t n + k/b)
   Space: O(n / fill_factor)
```

---

<a name="animation"></a>
## 18. Visual Animation Reference

See `animation.html` in this folder. The animation renders the tree with leaves visibly chained at the bottom row, color-codes a descent path during search, and animates the chain walk during a range scan (each leaf "pulses green" as the scanner crosses it). Insert mode shows leaf splits and visualizes the moment a new leaf is spliced into the chain. Statistics panel reports tree height, total keys, leaf count, last operation, and range-scan latency.

Working through a 16-element range scan in the animation makes the "one descent + linear chain walk" pattern obvious in a way the prose cannot.

---

<a name="summary"></a>
## 19. Summary

- A B+ tree is a B-tree variant defined by **two rules**: (1) data lives only at leaves; (2) leaves are linked in a sorted singly-linked list.
- The first rule gives uniform tree height and clean record semantics; the second gives `O(log n + k/b)` sequential range scans, the single most important advantage.
- Internal nodes are pure routing — they hold keys but no records. A routing key appearing in an internal node is duplicated in some leaf below; the leaf is the source of truth.
- Leaf splits **copy** the smallest key of the new right leaf up to the parent. Internal splits **move** the median key up.
- The leaf chain must be spliced correctly on every split and merge; failing to do so is the #1 B+ tree bug.
- Range scan = one descent + linear leaf-chain walk. This is why every major SQL database — PostgreSQL, MySQL InnoDB, SQLite, Oracle, SQL Server — uses a B+ tree as its primary index structure.
- The classic B-tree (08-b-tree topic) is theoretically more space-efficient, but its lack of leaf links makes range scans expensive. The B+ tree wins for any range-heavy workload, which describes essentially all relational workloads.

Master the B+ tree and you have mastered the single data structure that runs the bulk of the world's structured data. Almost every database query you have ever issued descended one of these trees.

---

<a name="further-reading"></a>
## 20. Further Reading

- **Comer, D.** (1979). *The Ubiquitous B-Tree*. ACM Computing Surveys 11(2). The first formal survey treatment that names and defines the B+ tree as a B-tree variant — the canonical citation.
- **Lehman, P. L. & Yao, S. B.** (1981). *Efficient Locking for Concurrent Operations on B-Trees*. ACM TODS 6(4). The B-link tree paper. PostgreSQL's nbtree access method is a near-direct implementation.
- **Graefe, G.** (2011). *Modern B-Tree Techniques*. Foundations and Trends in Databases 3(4). The modern survey covering prefix compression, suffix truncation, fractured indexes, and Bε-trees.
- **Petrov, A.** *Database Internals*, O'Reilly, 2019. Chapters 2–3 walk through B+ tree on-disk layouts in real systems with detailed diagrams.
- **Knuth, D. E.** *The Art of Computer Programming, Vol. 3: Sorting and Searching*, 2nd ed., Section 6.2.4. Theoretical analysis of B-trees and their variants.
- **PostgreSQL source code**: `src/backend/access/nbtree/`. The reference implementation of a production B+ tree (Lehman-Yao variant with right-links and Postgres-specific concurrency).
- **SQLite file format spec**, Section 1.6. Walks through SQLite's B+ tree layout in great detail; an excellent learning resource because the entire DB fits on disk in a single file.
- **MySQL InnoDB documentation**: "Clustered and Secondary Indexes". Describes the clustered B+ tree where the primary key index IS the table storage.
- Continue with `middle.md` for B-link trees, copy-on-write B+ trees (LMDB, bbolt), and fractal tree / Bε-tree write buffering (TokuDB).
