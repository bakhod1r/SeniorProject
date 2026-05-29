# Red-Black Tree — Middle Level

> **Audience:** Engineers who have written or read a working red-black tree (`junior.md`) and want the deeper structure: the height proof, Sedgewick's Left-Leaning variant, top-down vs bottom-up algorithms, persistent red-black trees, the 2-3-4 tree equivalence, and bulk-set algorithms. Prerequisite: `junior.md`.

This file covers what most engineers never learn — the part of the theory that explains *why* the implementation looks the way it does. After reading it, you will be able to derive the cases from scratch instead of memorizing them.

---

## Table of Contents

1. [Formal Height Bound — h ≤ 2·log₂(n+1)](#height-proof)
2. [The 2-3-4 Tree Equivalence](#234-equivalence)
3. [Left-Leaning Red-Black Trees (Sedgewick 2008)](#llrb)
4. [LLRB Code in ~30 Lines vs CLRS ~80](#llrb-vs-clrs)
5. [Top-Down vs Bottom-Up Insertion](#top-down)
6. [Iterative Red-Black Insert/Delete (Parent Pointer)](#iterative)
7. [Persistent Red-Black Trees (Okasaki)](#persistent)
8. [Bulk Operations — union, intersection, difference (Adams)](#bulk)
9. [RB vs AVL — Benchmark Intuition](#vs-avl)

---

<a name="height-proof"></a>
## 1. Formal Height Bound — h ≤ 2·log₂(n+1)

We sketched this in `junior.md` section 6. Here is the full version with bookkeeping.

**Definitions.**
- `n` = number of internal (non-NIL) nodes in the tree.
- `h` = height of the tree, defined as the maximum number of *edges* from the root to any NIL.
- `bh(x)` = black-height of node `x`, defined as the number of black nodes on any path from `x` (not counting `x`) down to a NIL descendant. Well-defined because of Property 5.

**Lemma A (subtree size lower bound).** For every node `x`, the subtree rooted at `x` contains at least `2^bh(x) - 1` internal nodes.

*Proof.* By induction on the height of `x`.

- **Base case.** `x` is itself NIL. Then height = 0, `bh(x) = 0`, and the subtree has 0 internal nodes. `2⁰ - 1 = 0` ≤ 0. ✓
- **Inductive step.** `x` has two children `L` and `R`. Each child has `bh ≥ bh(x) - 1` (equal to `bh(x)` if the child is red, `bh(x) - 1` if black; either way at least `bh(x) - 1`). By the IH each child's subtree has at least `2^{bh(x)-1} - 1` internal nodes. The subtree of `x` has `(2^{bh(x)-1} - 1) + (2^{bh(x)-1} - 1) + 1 = 2^bh(x) - 1` internal nodes (the `+1` is `x` itself). ✓

**Lemma B (height vs. black-height).** Let `T` be a red-black tree of height `h`. Then `bh(root) ≥ h/2`.

*Proof.* On any root-to-NIL path of length `h`, by Property 4 no two consecutive nodes are red. So at least `⌈h/2⌉` of the nodes on the path are black, meaning `bh(root) ≥ ⌈h/2⌉ ≥ h/2`. ✓

**Theorem (Height Bound).** `h ≤ 2·log₂(n + 1)`.

*Proof.* By Lemma A, `n ≥ 2^{bh(root)} - 1`, so `bh(root) ≤ log₂(n + 1)`. By Lemma B, `h ≤ 2·bh(root) ≤ 2·log₂(n + 1)`. ∎

**Practical consequences.**
- For `n = 10⁹`: `h ≤ 2·log₂(10⁹ + 1) ≈ 2·30 = 60`. Every lookup touches at most 60 nodes.
- Average tree height in random insertion is about `~1.88·log₂(n)`, much closer to the optimum than the worst-case bound suggests.
- The bound is tight: there are red-black trees that achieve exactly `h = 2·log₂(n+1)` for specific `n` (build a tree that is fully two-tone: black root, every left child is red, every right child is black, etc.).

---

<a name="234-equivalence"></a>
## 2. The 2-3-4 Tree Equivalence

Bayer's 1972 paper introduced red-black trees as a **binary representation of 2-3-4 trees**. Understanding this equivalence makes every insert/delete case feel inevitable instead of arbitrary.

A **2-3-4 tree** (or B-tree of order 4) is a balanced tree where each node holds 1, 2, or 3 keys (called a 2-node, 3-node, or 4-node) and correspondingly 2, 3, or 4 children. All leaves are at the same depth. The tree height is `log₄(n) ≈ 0.5·log₂(n)`.

**The encoding.** Map each 2-3-4 node to a tiny cluster of binary nodes connected by colored links:

```
2-node:   [A]                  ⇄    [A black]
                                    /        \
                                   …          …

3-node:   [A | B]               ⇄    [B black]              OR        [A black]
                                    /       \                        /       \
                                [A red]      …                      …    [B red]
                                /  \                                       /  \
                               …    …                                     …    …

4-node:   [A | B | C]           ⇄         [B black]
                                          /        \
                                     [A red]      [C red]
                                     /  \         /  \
                                    …    …       …    …
```

So a red link is exactly "this node is glued to its parent into one logical 2-3-4 node". Now restate the red-black properties in 2-3-4 language:

- **Property 4 (no red-red):** no two consecutive red links — equivalent to "no 5-node": you cannot glue three keys into one 2-3-4 node.
- **Property 5 (equal black-height):** every root-to-leaf path has the same number of *black* nodes — equivalent to "all 2-3-4 leaves at the same depth", which is the 2-3-4 balance condition.

**Insert in 2-3-4 ≡ Insert in RB.**
- Inserting into a 2-node makes a 3-node ⇄ recoloring (no rotation).
- Inserting into a 3-node makes a 4-node ⇄ one rotation (Cases 2-3).
- Inserting into a 4-node forces a split: the middle key goes up to the parent, leaving two 2-nodes ⇄ Case 1 (uncle red): recolor children black, parent red, push the problem up.

The "uncle red" case is literally the 4-node split; the "uncle black with rotation" case is literally creating a new 4-node out of an existing 3-node.

Once you see this, the case analysis is forced. Whenever you forget which color to set in which case, redraw the 2-3-4 tree and the answer falls out.

---

<a name="llrb"></a>
## 3. Left-Leaning Red-Black Trees (Sedgewick 2008)

In 2008, Robert Sedgewick (the same Sedgewick of Guibas-Sedgewick 1978) published a draft, *"Left-leaning Red-Black Trees"*, that adds **one extra invariant**:

**LLRB Property 6 — every red link is a left link.**

That is, no node has a red right child. Equivalently, only the "left form" of a 3-node is allowed — the right form is forbidden.

Why add a constraint? Because it cuts the case analysis in half. With both left- and right-leaning 3-nodes allowed (the symmetric / "regular" RB tree of CLRS), insert fixup has 3 cases × 2 mirrors = 6 cases, and delete fixup has 4 cases × 2 mirrors = 8 cases. With LLRB, all the right-leaning configurations are illegal by Property 6, so the symmetric mirror disappears: insert fixup has 3 cases total, and delete fixup has 4 cases total. The code is roughly half the size.

The cost: when an insert would create a right-leaning red link, the algorithm immediately rotates it left to bring it into compliance. The "rotateLeft when right child is red" check is the price you pay.

LLRB is taught in *Algorithms* 4th edition (Sedgewick & Wayne, 2011) as the only red-black variant. The book includes the full implementation in ~30 lines of Java. The result is so concise that LLRB has become the standard pedagogical choice.

**Caveat.** LLRB is *not* faster than CLRS RB in benchmarks — it does more rotations on average because of the eager rebalancing. It is *simpler* to implement and prove correct, and it produces trees that are isomorphic to 2-3 trees (a stricter B-tree variant), not 2-3-4. For high-performance code (`std::map`, Linux kernel) the symmetric CLRS form remains the canonical choice.

---

<a name="llrb-vs-clrs"></a>
## 4. LLRB Code in ~30 Lines vs CLRS ~80

Sedgewick's LLRB insert in Java (slightly reformatted from *Algorithms* 4e):

```java
private static final boolean RED = true, BLACK = false;

private static class Node {
    int key;
    Node left, right;
    boolean color;
    Node(int k, boolean c) { key = k; color = c; }
}

private boolean isRed(Node x) { return x != null && x.color == RED; }

private Node rotateLeft(Node h) {
    Node x = h.right;
    h.right = x.left;
    x.left = h;
    x.color = h.color;
    h.color = RED;
    return x;
}

private Node rotateRight(Node h) {
    Node x = h.left;
    h.left = x.right;
    x.right = h;
    x.color = h.color;
    h.color = RED;
    return x;
}

private void flipColors(Node h) {
    h.color       = RED;
    h.left.color  = BLACK;
    h.right.color = BLACK;
}

public Node insert(Node h, int key) {
    if (h == null) return new Node(key, RED);
    if (key < h.key)      h.left  = insert(h.left, key);
    else if (key > h.key) h.right = insert(h.right, key);
    else                  h.key   = key; // value update (omitted)
    if (isRed(h.right) && !isRed(h.left))      h = rotateLeft(h);
    if (isRed(h.left) && isRed(h.left.left))   h = rotateRight(h);
    if (isRed(h.left) && isRed(h.right))       flipColors(h);
    return h;
}

public void put(int key) {
    root = insert(root, key);
    root.color = BLACK;
}
```

That is it. The whole 2-3 tree insertion logic compressed into the last three `if` statements:

1. **`isRed(h.right) && !isRed(h.left)` → rotateLeft.** Fix a right-leaning red link by leaning it left.
2. **`isRed(h.left) && isRed(h.left.left)` → rotateRight.** A left-left red configuration is a 4-node about to be split; rotate right to balance it.
3. **`isRed(h.left) && isRed(h.right)` → flipColors.** This is the 4-node split: both reds become black, the parent becomes red. The split moves up the recursion stack.

Compare with the CLRS insert from `junior.md` section 11: 80 lines, two symmetric branches, six cases. LLRB does the same job in a third of the code.

The catch is **delete** — LLRB's delete is widely considered harder to implement correctly than CLRS's delete, because you have to push a "moveRedLeft" or "moveRedRight" invariant down the tree during deletion. See `tasks.md` task 6 for the full LLRB delete and a discussion of why some pedagogical sources skip it.

---

<a name="top-down"></a>
## 5. Top-Down vs Bottom-Up Insertion

The CLRS algorithm is **bottom-up**: insert as a normal BST insertion, then walk back up from the new node fixing violations. This requires a **parent pointer** at every node (or a stack of parent pointers built during the insertion descent).

The alternative is **top-down**: as you walk *down* the tree to find the insertion point, eagerly split any 4-node you encounter along the way. By the time you reach the leaf, the parent of the new node is guaranteed to be at most a 3-node, so insertion is trivial — no fixup walk needed.

**Top-down insert in pseudo-code:**

```
INSERT(T, key):
  // Walk down, splitting 4-nodes
  x = T.root
  parent = grandparent = NIL
  while x != NIL:
    if x.left.color == RED and x.right.color == RED:
      // x is the top of a 4-node — split
      x.color = RED
      x.left.color = BLACK
      x.right.color = BLACK
      // Now x is red, may have a red parent — fix with rotation
      RB-FIX-UP(parent, grandparent, x)
    grandparent = parent
    parent = x
    if key < x.key: x = x.left
    else:           x = x.right
  // Insert new red node as child of parent
  ...
  T.root.color = BLACK
```

**Advantages of top-down:**
- **No parent pointer needed.** Saves 8 bytes per node on 64-bit systems.
- **Single tree traversal.** No second walk back up. Better cache locality on long paths.
- **Suitable for concurrent insertion with hand-over-hand locking** — you only need a small constant-size window of locks (3 ancestors), instead of locking the whole path.

**Disadvantages:**
- **More rotations on average.** Eager splitting splits 4-nodes that might never have been hit by the insertion path.
- **Harder to reason about.** The local invariants are less obvious than the bottom-up "fix Property 4 at the new node" framing.

Used by: the original Bayer paper preferred top-down. The Linux kernel uses bottom-up. The CLRS textbook teaches bottom-up. Most modern implementations are bottom-up.

---

<a name="iterative"></a>
## 6. Iterative Red-Black Insert/Delete (Parent Pointer)

The Go and Java code in `junior.md` is already iterative — it uses an explicit parent pointer at each node and walks up using `z.parent.parent`. This is the production-grade pattern: zero recursion overhead, deterministic stack usage, no risk of stack overflow on deep trees.

The trade-off versus the recursive LLRB style is **8 extra bytes per node for the parent pointer** (on 64-bit). For a tree with 1M nodes, that is 8 MB — usually negligible but worth knowing.

A non-parent-pointer iterative algorithm is possible by stacking the path explicitly during the downward walk:

```python
def insert_no_parent(self, key):
    path = []                          # stack of (node, "went_left_or_right")
    x = self.root
    while x is not self.NIL:
        path.append(x)
        x = x.left if key < x.key else x.right
    z = Node(key, RED)
    z.left = z.right = self.NIL
    if not path:
        self.root = z
    else:
        parent = path[-1]
        if key < parent.key: parent.left = z
        else:                parent.right = z
    self._insert_fixup_with_path(z, path)
```

This recovers the bytes saved by skipping `parent` pointers but spends them on the temporary path stack. For applications that hold one tree (in-memory database, scheduler), the per-node pointer wins. For applications that hold millions of small trees (kernel hash buckets, anchor in containing struct), the path-stack approach wins.

---

<a name="persistent"></a>
## 7. Persistent Red-Black Trees (Okasaki)

A **persistent** data structure is one where every "update" returns a new version, leaving the old version untouched and still queryable. Persistent trees are the backbone of functional programming languages (Haskell `Data.Map`, Clojure `PersistentTreeMap`, Scala `TreeMap`, OCaml `Map`).

Chris Okasaki's *Purely Functional Data Structures* (1998) gives a persistent red-black tree implementation in about **12 lines of Haskell**:

```haskell
data Color = R | B
data RB a = E | T Color (RB a) a (RB a)

insert :: Ord a => a -> RB a -> RB a
insert x s = makeBlack (ins s)
  where
    ins E = T R E x E
    ins t@(T color a y b)
      | x < y  = balance color (ins a) y b
      | x > y  = balance color a y (ins b)
      | otherwise = t
    makeBlack (T _ a y b) = T B a y b

balance :: Color -> RB a -> a -> RB a -> RB a
balance B (T R (T R a x b) y c) z d = T R (T B a x b) y (T B c z d)
balance B (T R a x (T R b y c)) z d = T R (T B a x b) y (T B c z d)
balance B a x (T R (T R b y c) z d) = T R (T B a x b) y (T B c z d)
balance B a x (T R b y (T R c z d)) = T R (T B a x b) y (T B c z d)
balance color a x b = T color a x b
```

**How does it work?** The four `balance` patterns are the four possible places a red-red violation can appear after a recursive `ins` returns: left-left, left-right, right-left, right-right. Each pattern rewrites the local subtree into a balanced configuration. Because Haskell data structures are immutable, the recursive `ins` returns a brand-new spine; the rest of the tree is shared with the old version.

**Time complexity per insert:** O(log n), exactly as in the imperative version.
**Space complexity per insert:** O(log n) for the newly allocated nodes on the path. The old nodes are shared.

**Why this matters.** Persistent trees give you:
- **Snapshots for free.** A database engine can snapshot a multi-million-node index at zero copy cost — just hand out the current root reference.
- **Multi-version concurrency.** Readers can use the old version; writers create a new version atomically.
- **Time-travel debugging.** Every prior version of the data structure is still accessible.

Haskell's `Data.Map.Strict` does **not** actually use Okasaki's RB tree — it uses a weight-balanced tree (Adams 1993) because the bulk operations are simpler. But the technique transfers, and `Data.Set.Internal.Tree` is morally an Okasaki-style balanced tree.

For Java/Kotlin: see the Vavr library's `TreeMap` for a persistent RB tree implementation. For Scala: `scala.collection.immutable.TreeMap`. For Clojure: every map and set is built on a persistent RB-ish or HAMT structure.

---

<a name="bulk"></a>
## 8. Bulk Operations — union, intersection, difference (Adams)

A common operation on ordered sets is **union, intersection, set difference** between two sets. The naive approach — iterate over the smaller and insert each element into the larger — costs O(m log n) for two sets of sizes m and n. For balanced bulk inputs (m = n), that is O(n log n), no better than rebuilding from a merge.

**Adams' algorithm** (Stephen Adams, 1993, "Efficient Sets — A Balancing Act", J. Functional Programming) achieves **O(m · log(n/m + 1))** for two sets of sizes m ≤ n. When m << n, this is near-optimal; when m = n, it is O(n).

The key primitive is **`join(L, k, R)`**: given two trees `L` and `R` such that every key in `L` is < `k` < every key in `R`, build a balanced tree containing them all. If `L` and `R` have similar heights, `join` is O(1); if they differ by Δ, `join` is O(Δ). For RB trees there is a `join` that runs in O(|h(L) - h(R)|) time, given by Tarjan in *"Updating a Balanced Search Tree in O(1) Rotations"* (1983) — and in fact the entire bulk-operations framework reduces to repeated `join` calls.

**Recursive union via split-and-join:**

```
UNION(t1, t2):
  if t1 is empty: return t2
  if t2 is empty: return t1
  (L, b, R) = split(t2, key(t1.root))      // partition t2 around t1's root key
  L' = UNION(t1.left, L)
  R' = UNION(t1.right, R)
  return join(L', t1.root.key, R')
```

`split(t, k)` partitions a tree `t` into the subtree of keys `< k`, a boolean `b` indicating whether `k` was present, and the subtree of keys `> k`. It runs in O(log n).

Total work obeys the recurrence `T(m, n) = O(log n) + T(a, b) + T(m-a-1, n-b-1)` for some split, which solves to **O(m · log(n/m + 1))**. The Blelloch, Ferizovic, Sun 2016 paper *"Parallel and I/O Efficient Set Operations"* generalizes this to all balanced BSTs and shows the bound is optimal.

Java's `TreeSet` does **not** expose efficient bulk union — `addAll` is the naive O(m log n). Scala's `TreeSet` similarly. Functional libraries (Haskell `Data.Set.union`, Clojure `clojure.set/union` over sorted sets) implement Adams' bound. In Linux kernel work, bulk operations on RB trees are rare enough that the naive approach is used.

---

<a name="vs-avl"></a>
## 9. RB vs AVL — Benchmark Intuition

A typical microbenchmark on uniformly random integers, N = 10⁶ operations on Linux/amd64, modern CPU (numbers vary by platform but the ranking is stable):

| Operation | RB tree | AVL tree | HashMap (separate chaining) |
|---|---|---|---|
| insert (cold cache) | 380 ns | 410 ns | 80 ns |
| lookup (warm cache) | 130 ns | 110 ns | 35 ns |
| delete (cold cache) | 420 ns | 540 ns | 90 ns |
| in-order traversal (per node) | 8 ns | 7 ns | n/a (unsorted) |
| height after N inserts | 22 | 19 | n/a |

The numbers are illustrative — actual values depend on key type, comparator cost, allocator, and CPU. The take-aways:

1. **Lookup**: AVL wins by ~15 % because its tree is shorter. The gap shrinks as N grows because cache misses dominate.
2. **Insert**: RB wins by ~7 % because of fewer rotations. The advantage grows under skewed workloads.
3. **Delete**: RB wins more decisively (~25 %) because AVL's worst-case delete cascades through O(log n) rotations.
4. **Hash table** crushes both for unordered exact-match lookup. Use a tree only when you need ordering, range queries, predecessor/successor, or sorted iteration.

In practice, the decision between RB and AVL almost never matters for correctness — both deliver O(log n). The real choice is usually "tree vs hash" (do you need ordering?) and only then "which balanced tree" (RB if writes dominate, AVL if reads dominate after a one-time bulk load).

This is why every modern standard library picked one and stuck with it: C++ and Java picked RB and never looked back. The runtime cost of choosing "wrong" is below the noise floor for almost every application.

---

## Where to Go Next

- `senior.md` — Real-world uses: Linux kernel CFS, VMA tree, libstdc++ internals, Java HashMap treeification.
- `professional.md` — Cache analysis, lock-free variants, tag-pointer trick for the color bit.
- `interview.md` — Eight to ten interview problems built on RB tree operations.
- `tasks.md` — Hands-on implementation tasks with full solutions.
