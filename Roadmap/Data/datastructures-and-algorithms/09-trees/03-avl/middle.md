# AVL Tree — Middle Level

> **Audience:** Engineers who have implemented basic recursive AVL insert and delete and want the theoretical underpinnings and the production-grade variants. Prerequisite: `junior.md`.

This document covers the **proof of the tight height bound**, the formal comparison with **red-black trees**, the **balance-factor (2-bit)** encoding that saves memory, the **iterative** AVL using parent pointers (no recursion stack), **bulk-loading** an AVL from sorted input in linear time, the **order-statistic** augmentation, **persistent (functional)** AVL with path copying, and a summary table of every balanced-BST variant you might encounter (treap, splay, red-black, AA, WAVL).

---

## Table of Contents

1. [Height Bound Proof — The Fibonacci Tree](#height-proof)
2. [AVL vs Red-Black — Formal Comparison](#vs-rb)
3. [Storing Balance Factor in 2 Bits](#bf-bits)
4. [Iterative AVL with Parent Pointers](#iterative)
5. [Bulk-Loading from Sorted Input in O(n)](#bulk-load)
6. [Order-Statistic AVL](#order-stat)
7. [Persistent AVL via Path Copying](#persistent)
8. [Comparison Table — AVL vs Treap vs Splay vs Red-Black](#comparison)

---

<a name="height-proof"></a>
## 1. Height Bound Proof — The Fibonacci Tree

We want to prove: **an AVL tree of `n` nodes has height `h ≤ 1.44 × log₂(n + 2) - 0.328`**.

The standard technique: instead of bounding `h` in terms of `n`, bound the **minimum number of nodes** `N(h)` in any AVL tree of height `h`. Then invert to express `h` in terms of `n`.

### 1.1 Recurrence for `N(h)`

Let `N(h)` = minimum number of nodes in an AVL tree of height `h`. By convention:
- `N(-1) = 0` (empty tree)
- `N(0) = 1` (single node, leaf)
- `N(1) = 2` (root with one child — bf = ±1)

For `h ≥ 2`, the sparsest AVL of height `h` has a root whose two children are the sparsest AVLs of heights `h - 1` and `h - 2` (one extra level taller, the other one shorter — they differ by 1 because if they differed by 0 we could remove a level). Therefore:

```
N(h) = 1 + N(h - 1) + N(h - 2)
```

This is the **Fibonacci recurrence shifted by a constant**. Compare with:

```
F(0) = 0, F(1) = 1, F(n) = F(n-1) + F(n-2)
```

Closed form: `N(h) = F(h + 3) - 1`. You can verify:
- `N(0) = F(3) - 1 = 2 - 1 = 1` ✓
- `N(1) = F(4) - 1 = 3 - 1 = 2` ✓
- `N(2) = F(5) - 1 = 5 - 1 = 4` ✓

The **Fibonacci tree** of height `h` is the unique AVL tree achieving `N(h)` nodes. It is the worst-case input — the sparsest legal AVL.

### 1.2 Inverting to get height bound

By Binet's formula, `F(k) ≈ φ^k / √5` where `φ = (1 + √5) / 2 ≈ 1.618`. So:

```
n + 1 ≥ N(h) + 1 = F(h + 3)
       ≈ φ^(h+3) / √5
```

Taking `log_φ` of both sides:

```
log_φ(√5 (n + 1)) ≥ h + 3
h ≤ log_φ(n + 1) + log_φ(√5) - 3
```

Converting to log base 2 (`log_φ(x) = log₂(x) / log₂(φ)` and `log₂(φ) ≈ 0.6942`):

```
h ≤ (1 / log₂ φ) × log₂(n + 1) + constant
  ≈ 1.4404 × log₂(n + 1) + constant
```

After tightening the constant (and shifting from `n + 1` to `n + 2` for clean handling of the `N(-1) = 0` boundary), the bound usually quoted is:

```
h ≤ 1.4404 × log₂(n + 2) - 0.3277
```

For practical use: **AVL height is at most ~44% more than the optimal complete-tree height of `⌊log₂ n⌋`**. A perfect tree of 10⁶ nodes has height 19; the worst AVL of 10⁶ nodes has height at most 28. That 9-level gap is the price of incremental balancing — never having to rebuild.

### 1.3 Comparison with red-black

A red-black tree of `n` nodes has height `h ≤ 2 × log₂(n + 1)`. For 10⁶ nodes: 40 levels worst case. AVL: 28 levels. So **AVL guarantees ~30% faster lookups in the worst case**.

The trade is more rotations on inserts and deletes, covered next.

### 1.4 Quick reference table

| h | min nodes N(h) | h | min nodes |
|---|---|---|---|
| 0 | 1 | 10 | 88 |
| 1 | 2 | 15 | 986 |
| 2 | 4 | 20 | 10,945 |
| 3 | 7 | 25 | 121,392 |
| 4 | 12 | 30 | 1,346,268 |
| 5 | 20 | 35 | 14,930,351 |
| 6 | 33 | 40 | 165,580,140 |
| 7 | 54 | 45 | 1,836,311,902 |

To unbalance an AVL to height 30, you need at least 1.3 million carefully ordered inserts. A naive sorted-input attack gets nowhere — AVL rotates that into a balanced tree of height ~20.

---

<a name="vs-rb"></a>
## 2. AVL vs Red-Black — Formal Comparison

Both are self-balancing BSTs invented at IBM Research within a decade of each other (AVL 1962, RB 1972 by Bayer; reformulated by Guibas and Sedgewick 1978). They make different trade-offs.

### 2.1 Height bounds

| Tree | Height bound | Constant |
|---|---|---|
| Optimal (complete) | `⌊log₂ n⌋` | 1.0 |
| AVL | `1.44 log₂(n+2) - 0.328` | 1.44 |
| Red-black | `2 log₂(n+1)` | 2.0 |
| WAVL (relaxed) | `2 log₂ n` | 2.0 |

AVL is **strictly tighter**. On the same number of nodes, an AVL tree is shorter than a red-black tree — so **lookups touch fewer nodes**.

### 2.2 Rotations per operation

| Operation | AVL | Red-black |
|---|---|---|
| Insert | ≤ 2 rotations | ≤ 2 rotations |
| Delete | O(log n) rotations | ≤ 3 rotations |

This is the key difference. Both trees recolor and rotate after inserts at similar amortized cost, but **AVL deletes cascade** — every rebalanced ancestor can shorten its subtree by 1, which can unbalance the next ancestor up. Red-black deletes terminate after at most 3 rotations because the relaxed invariant absorbs height changes via recoloring.

For workloads dominated by deletes (e.g., LRU caches with frequent eviction), this matters. For read-mostly indexes, it doesn't.

### 2.3 Memory per node

| Tree | Extra bits per node |
|---|---|
| AVL with stored height (32-bit int) | 32 bits |
| AVL with balance factor (2 bits) | 2 bits (often padded to 8) |
| Red-black | 1 bit (color) |

In a packed implementation, RB saves 1–4 bytes per node. For trees of 10⁹ small-key entries, this is gigabytes.

### 2.4 Cache behavior

Both have the same cache behavior in terms of pointer chasing — each step touches a node. AVL's slightly shorter height means slightly fewer cache misses per lookup. The difference is small (10–30%); for cache-sensitive workloads neither beats a B-tree.

### 2.5 Which to choose

| Workload | Pick |
|---|---|
| Read-heavy, lookups dominate | **AVL** |
| Write-heavy, deletes frequent | **Red-black** |
| Concurrent | Neither — use skip list or copy-on-write B-tree |
| Persistent / functional | **AVL** with path copying (deterministic) or **2-3-4 / red-black** |
| Standard library default | Red-black (`std::map`, `TreeMap`) — the universal compromise |

---

<a name="bf-bits"></a>
## 3. Storing Balance Factor in 2 Bits

In `junior.md` we cached the full height (4 bytes). The original Adelson-Velsky and Landis paper used a different encoding: just the **balance factor**, which is always one of `{-1, 0, +1}` — three values, easily packed into 2 bits per node.

### 3.1 Motivation

For a 1-billion-entry AVL map, height field at 4 bytes/node costs 4 GB. Balance factor at 2 bits (rounded up to a byte for alignment) costs 1 GB. With bit-packing into existing pointer LSBs (pointers are 8-byte aligned, so 3 low bits are always zero), you can encode the balance factor "for free" inside one of the child pointers.

### 3.2 Rotation cases recompute bf directly

In the height-cached form, rotations call `updateHeight` which traverses the children. In the bf-cached form, rotations recompute the new balance factors from the **case** that triggered the rotation. There are a finite number of cases; you precompute a table.

Example: in the LL case after insert, before rotation:
```
z  : bf = +2
y = z.left  : bf = +1
```
After `rotateRight(z)`:
```
y  : bf = 0
z  : bf = 0
```

In the LR case before:
```
z : bf = +2
y = z.left  : bf = -1
x = y.right : bf = +1 or -1 or 0   (3 sub-cases)
```

After the double rotation, the new bf of `y`, `z`, and `x` depends on the bf of `x` before:

| bf(x) before | bf(y) after | bf(z) after | bf(x) after |
|---|---|---|---|
| +1 | 0  | -1 | 0 |
| -1 | +1 | 0  | 0 |
|  0 | 0  | 0  | 0 |

These tables are short, fit in cache, and avoid all the runtime height arithmetic. The cost is a more complex rotation routine and a longer learning curve. Most production AVL libraries (e.g., Boost.Intrusive, the GNU libavl) use the bf form.

### 3.3 Iterative-friendly

Because bf doesn't require children's heights to be known, the bf form is easier to combine with iterative traversal (next section). You don't need to "carry up" heights along the path — you only need parent pointers.

---

<a name="iterative"></a>
## 4. Iterative AVL with Parent Pointers

Recursive AVL uses O(log n) stack frames per operation. For most uses that is fine. But:

- Real-time / embedded systems may have a fixed small stack.
- Generators / coroutines that iterate over the tree shouldn't carry deep stacks.
- Functional persistent variants need the path anyway (for path copying).

Iterative AVL stores a **parent pointer** in each node, climbs from the modified leaf back up to the root using `node.parent`, and rebalances along the way.

### 4.1 Node with parent pointer

```go
type Node struct {
    Key                  int
    Left, Right, Parent  *Node
    Height               int
}
```

Adds 8 bytes per node on 64-bit systems. Cuts recursion stack to zero.

### 4.2 Iterative insert

**Go:**
```go
func (t *Tree) Insert(key int) {
    // 1. BST insert iteratively.
    var parent *Node
    cur := t.Root
    for cur != nil {
        parent = cur
        if key < cur.Key {
            cur = cur.Left
        } else if key > cur.Key {
            cur = cur.Right
        } else {
            return
        }
    }
    n := &Node{Key: key, Parent: parent, Height: 0}
    if parent == nil {
        t.Root = n
        return
    }
    if key < parent.Key {
        parent.Left = n
    } else {
        parent.Right = n
    }

    // 2. Walk up from n's parent, rebalance.
    for p := parent; p != nil; p = p.Parent {
        updateHeight(p)
        b := balanceFactor(p)

        var newSubtreeRoot *Node
        switch {
        case b > 1 && balanceFactor(p.Left) >= 0:
            newSubtreeRoot = rotateRight(p)
        case b > 1:
            p.Left = rotateLeft(p.Left)
            newSubtreeRoot = rotateRight(p)
        case b < -1 && balanceFactor(p.Right) <= 0:
            newSubtreeRoot = rotateLeft(p)
        case b < -1:
            p.Right = rotateRight(p.Right)
            newSubtreeRoot = rotateLeft(p)
        default:
            continue
        }
        // Rewire the new subtree root into its grandparent or the tree root.
        gp := newSubtreeRoot.Parent
        if gp == nil {
            t.Root = newSubtreeRoot
        } else if gp.Left == p {
            gp.Left = newSubtreeRoot
        } else {
            gp.Right = newSubtreeRoot
        }
        // Insert is "at most one rebalance" — early exit.
        return
    }
}
```

The rotation routines must update parent pointers too:

```go
func rotateRight(y *Node) *Node {
    x := y.Left
    b := x.Right

    x.Right = y
    y.Left = b
    if b != nil {
        b.Parent = y
    }
    x.Parent = y.Parent
    y.Parent = x

    updateHeight(y)
    updateHeight(x)
    return x
}
```

### 4.3 Iterative delete

Same shape: find and remove the node, then walk up from the modified parent rebalancing each ancestor. Because delete can cascade, you do **not** early-exit; you must continue to the root.

### 4.4 Trade-offs

Iterative AVL is faster (no function call overhead), uses zero stack, and is the natural form for persistent variants. The cost is an extra pointer per node (8 bytes) and longer code. For a production library where you control all access, it is the better choice.

---

<a name="bulk-load"></a>
## 5. Bulk-Loading from Sorted Input in O(n)

If you already have your data sorted (e.g., from a database scan or a file), inserting one-by-one costs O(n log n). You can do better.

### 5.1 The recursive midpoint construction

```
build(arr, lo, hi):
    if lo > hi: return null
    mid = lo + (hi - lo) / 2
    node = Node(arr[mid])
    node.left  = build(arr, lo, mid - 1)
    node.right = build(arr, mid + 1, hi)
    updateHeight(node)
    return node
```

Each node is created exactly once; the heights are filled bottom-up. Total work is O(n). The resulting tree is a **perfectly balanced BST**, which is automatically AVL.

**Go:**
```go
func BuildFromSorted(arr []int) *Node {
    return build(arr, 0, len(arr)-1)
}

func build(arr []int, lo, hi int) *Node {
    if lo > hi {
        return nil
    }
    mid := lo + (hi-lo)/2
    n := &Node{Key: arr[mid]}
    n.Left = build(arr, lo, mid-1)
    n.Right = build(arr, mid+1, hi)
    updateHeight(n)
    return n
}
```

### 5.2 Bottom-up linear-time variant

If you want to avoid the recursion stack and produce a tree with parent pointers in true O(n) time, build leaf rows first, then internal nodes layer by layer using a queue. The "perfect tree with leftover leaves on the bottom row" construction handles `n` that is not `2^k - 1`. See `tasks.md` task 5 for full code.

### 5.3 Practical impact

Building 10⁶ entries:
- One-by-one inserts: ~20 million operations.
- Bulk-load: ~1 million operations.

20× faster, and the tree is perfectly balanced, not merely AVL-balanced. Use this whenever your initial data is sorted (database initial load, snapshot restore, segment-merge in LSM-style storage).

---

<a name="order-stat"></a>
## 6. Order-Statistic AVL

Augment each node with `Size` — the number of nodes in its subtree (including itself). Maintain in `updateHeight`:

```go
func updateNode(n *Node) {
    n.Height = max(height(n.Left), height(n.Right)) + 1
    n.Size   = 1 + size(n.Left) + size(n.Right)
}

func size(n *Node) int {
    if n == nil { return 0 }
    return n.Size
}
```

Rotations preserve sizes because each rotated node's subtree is still composed of the same descendants. Two operations become possible in O(log n):

### 6.1 `kth(k)` — find the k-th smallest key

```go
func kth(root *Node, k int) *Node {
    leftSize := size(root.Left)
    if k == leftSize+1 {
        return root
    }
    if k <= leftSize {
        return kth(root.Left, k)
    }
    return kth(root.Right, k-leftSize-1)
}
```

### 6.2 `rank(key)` — how many keys are < this key

```go
func rank(root *Node, key int) int {
    if root == nil { return 0 }
    if key < root.Key {
        return rank(root.Left, key)
    }
    if key > root.Key {
        return size(root.Left) + 1 + rank(root.Right, key)
    }
    return size(root.Left)
}
```

Both run in O(log n). Together they implement a **dynamic ordered set** with rank/select queries — the building block for median maintenance, percentile streaming, and competitive-programming problems like "count of inversions".

### 6.3 Other augmentations

- **Subtree sum** (`Sum` field): supports range sum queries with two `rank`-like walks.
- **Subtree min/max**: useful for range-min/max queries — but a segment tree is usually a better fit.
- **Number of marked nodes**: for partial deletion in a logical-delete scheme.

The general principle: any property that is a fold of `(self_value, left_aggregate, right_aggregate)` and updated O(1) per node is mergeable through rotations.

---

<a name="persistent"></a>
## 7. Persistent AVL via Path Copying

A **persistent** data structure keeps every prior version accessible after each update. Useful for:

- Undo/redo with O(log n) history step.
- Software transactional memory.
- Functional languages (every "mutation" returns a new tree, old version still valid).
- Snapshot isolation in databases.

### 7.1 Path copying

To insert key `k` into AVL version `v`:
1. Walk down the path to `k`'s position.
2. Allocate a **new node** for each node on that path.
3. Each new node references the **unchanged** child on the off-path side.
4. The new tree shares O(n - log n) nodes with the old tree.

```python
def insert_persistent(root, key):
    if root is None:
        return Node(key)
    if key < root.key:
        new_left = insert_persistent(root.left, key)
        new_root = Node(root.key)
        new_root.left  = new_left
        new_root.right = root.right        # shared with old tree
    elif key > root.key:
        new_right = insert_persistent(root.right, key)
        new_root = Node(root.key)
        new_root.left  = root.left          # shared
        new_root.right = new_right
    else:
        return root

    update_height(new_root)
    return rebalance_persistent(new_root)
```

Each insert allocates O(log n) new nodes (the path) and reuses O(n - log n) old ones. The old version remains valid as a starting point for other operations or rollbacks.

### 7.2 Cost analysis

| Aspect | Cost |
|---|---|
| Time per insert | O(log n) |
| Extra memory per insert | O(log n) — only the path |
| Space for `k` versions | O(n + k log n) — shared structure |
| Read in version `v` | O(log n) — same as a regular AVL |

This is **dramatically more efficient** than copying the whole tree per version (`O(n)` per version). It is the technique used by Clojure's persistent maps, Scala's `TreeMap`, OCaml's `Set`, and Git's tree objects.

### 7.3 Persistent vs immutable

A subtle distinction: a **persistent** structure exposes its old versions to clients. An **immutable** structure merely doesn't mutate. The implementation may be the same; the API differs in whether old versions are addressable.

For Okasaki's full treatment, see *Purely Functional Data Structures* (Cambridge, 1998). His persistent red-black trees are the most popular, but persistent AVL is simpler and slightly faster in the worst case.

---

<a name="comparison"></a>
## 8. Comparison Table — AVL vs Treap vs Splay vs Red-Black

| Property | AVL | Red-Black | Treap | Splay | AA Tree | WAVL |
|---|---|---|---|---|---|---|
| **Invariant** | `|bf| ≤ 1` | red-black coloring | heap on priorities | none (amortized) | AA constraints | weak AVL ranks |
| **Worst-case search** | O(log n) | O(log n) | O(log n) expected | O(n) — amortized O(log n) | O(log n) | O(log n) |
| **Worst-case insert** | O(log n), ≤2 rot | O(log n), ≤2 rot | O(log n) expected | O(log n) amortized | O(log n) | O(log n) |
| **Worst-case delete** | O(log n), O(log n) rot | O(log n), ≤3 rot | O(log n) expected | O(log n) amortized | O(log n) | O(log n), ≤2 rot amortized |
| **Height bound** | `1.44 log n` | `2 log n` | `O(log n)` whp | unbounded (but amortized fine) | `2 log n` | `2 log n` |
| **Memory overhead** | 4B (height) or 2 bits (bf) | 1 bit (color) | 4–8B (priority) | 0 | 1 bit (level) | 2 bits (rank diff) |
| **Best for** | Read-heavy | Mixed | Randomized, simple to code | Locality-sensitive | Pedagogy / RB substitute | Theoretical lower bounds |
| **In stdlib** | Boost.Intrusive | C++ `std::map`, Java `TreeMap` | competitive programming | rare | rare | rare |
| **Amortized only?** | No | No | Yes (random priority) | Yes | No | Partly |
| **Notes** | Tightest balance | Universal default | Self-organizing via random priorities | Recently-accessed nodes near root | Simpler red-black | Hybrid AVL/RB by Haeupler-Sen-Tarjan |

### 8.1 When to use which (decision tree)

```
Need ordered ops (range, predecessor, kth)?
  No → hash map
  Yes:
    On disk / huge data set?
      Yes → B-tree / B+ tree
      No:
        Workload?
          Read-heavy → AVL
          Write-heavy → red-black
          Want locality of reference (recently accessed clustered) → splay
          Need lock-free → skip list
          Need persistent / immutable → persistent AVL or persistent RB
          Need simple random code in 30 lines → treap
```

### 8.2 The honest answer

For 95% of production needs, you should reach for your language's built-in sorted-map: `std::map` (C++ red-black), `TreeMap` (Java red-black), `sortedcontainers.SortedDict` (Python — actually a sorted-list-of-lists, not a tree), `BTreeMap` (Rust B-tree). The difference between AVL and red-black is small enough that the standard library's choice is almost always good enough, and the engineering cost of maintaining your own is enormous.

You build your own AVL when:
- You're in a language with no sorted-map standard library (some embedded C).
- You need a specific augmentation (subtree sum, interval merging) that the standard map doesn't expose.
- You're writing a database storage engine where every byte and cycle matters.
- You're studying. This is the most common case for this document.

---

Continue with `senior.md` for the real-world deployments of AVL in operating systems, computational geometry libraries, and database engines.
