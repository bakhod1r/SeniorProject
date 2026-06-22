# 2-3 Tree — Junior Level

> **Read time: ~45 minutes** · **Audience:** Engineers who have built a Binary Search Tree and watched it degenerate into a linked list. Prerequisite: `09-trees/02-bst`. No prior knowledge of B-trees or any multiway tree is assumed — this document teaches the whole idea from scratch.

The **2-3 tree** is the gentlest possible introduction to a perfectly balanced search tree. It was introduced by **John Hopcroft in 1970**, two years before Bayer and McCreight published the B-tree. The two ideas are intimately related: a 2-3 tree is *exactly* a B-tree of order 3, the smallest interesting member of the B-tree family. But where a production B-tree packs hundreds of keys into a node to minimize disk reads, a 2-3 tree packs at most **two** keys per node — small enough that you can draw the whole tree on a napkin and trace every insertion by hand.

That smallness is the point. The 2-3 tree teaches you the single most important trick in balanced-tree design: **grow the tree at the root, not at the leaves.** A plain BST grows downward and gets lopsided; a 2-3 tree grows *upward* and stays perfectly even — every leaf sits at the exact same depth, always, no exceptions. Understanding *how* and *why* that happens unlocks red-black trees, AA trees, 2-3-4 trees, and B-trees, all of which are variations on this one idea.

This document teaches the 2-3 tree so concretely that you will be able to hand-trace an insertion sequence including a cascading root split, draw the tree at every step, and write a correct `search` and `insert` from memory in Go, Java, or Python.

---

## Table of Contents

1. [Introduction — Why BSTs Go Crooked](#introduction)
2. [History — Hopcroft, 1970](#history)
3. [Prerequisites](#prerequisites)
4. [Glossary](#glossary)
5. [Core Concepts — 2-Nodes, 3-Nodes, and the Equal-Depth Invariant](#core-concepts)
6. [Search — Walking 2 or 3 Ways](#search)
7. [Insertion — Split and Push Up](#insertion)
8. [Worked Example — Build a Tree from Scratch](#worked-example)
9. [The Equal-Depth Invariant, Proven by Construction](#invariant)
10. [Big-O Summary](#big-o)
11. [Real-World Analogies](#analogies)
12. [Pros and Cons vs Plain BST](#pros-cons)
13. [A Note on Deletion](#deletion)
14. [Code Examples — Go, Java, Python](#code-examples)
15. [Coding Patterns](#patterns)
16. [Common Mistakes](#common-mistakes)
17. [Edge Cases](#edge-cases)
18. [Cheat Sheet](#cheat-sheet)
19. [Visual Animation Reference](#animation)
20. [Summary](#summary)
21. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Why BSTs Go Crooked

You have already built a [Binary Search Tree](../02-bst/junior.md). You inserted `50, 30, 70, 20, 40, 60, 80` and got a beautifully balanced tree of height 2. Three comparisons find anything. Life is good.

Then a stream of already-sorted data arrives — `1, 2, 3, 4, 5, ..., 1000000` — and every insert lands on the right child of the rightmost node. The tree collapses into a straight line:

```
1
 \
  2
   \
    3
     \
      ...
       \
        1000000
```

Height is now `n - 1`. A search for `999999` walks a million nodes. Insert, delete, find — all degrade to O(n), the speed of a singly linked list. **The cherished O(log n) was never a guarantee. It was a lucky average over random insertion orders**, and real data is rarely random.

The fundamental disease of the BST is this: **the shape of the tree is decided by the order keys arrive, and the tree has no mechanism to fix a bad shape.** Each new key is bolted onto a leaf, the tree grows *downward*, and a sorted input grows it downward in one single direction forever.

There are two cures. The first, invented by [AVL trees](../03-avl/junior.md) in 1962, keeps the tree binary and *repairs* a bad shape after the fact using **rotations**. The second — the one in this document — is more radical: **change the rules so a bad shape can never form in the first place.**

The 2-3 tree's trick is to let a node hold either **one key or two keys**, and to insist on one ironclad rule: **every leaf is at exactly the same depth.** When you insert a key and a leaf gets too full, you do *not* hang a new node below it (that would make one path longer than the others). Instead you **split** the overfull node and push its middle key **up** to the parent. If the parent overflows too, it splits and pushes up again. The splitting can ripple all the way to the root — and when the *root* splits, a brand-new root appears on top, and **the whole tree gets one level taller, uniformly.**

That is the headline. A BST grows at the leaves and gets crooked. A 2-3 tree grows at the root and stays perfectly even. There is no insertion order on Earth that can unbalance it.

```
Plain BST after inserting 1,2,3,4,5:    2-3 Tree after inserting 1,2,3,4,5:

1                                                [2 . 4]
 \                                              /   |   \
  2                                          [1]  [3]  [5]
   \
    3                                        height = 1, every leaf at depth 1
     \                                       search for anything: 2 steps
      4
       \                                     (the BST takes up to 5 steps)
        5

height = 4, degenerate
```

This document teaches you exactly how that machine works.

---

<a name="history"></a>
## 2. History — Hopcroft, 1970

The 2-3 tree was introduced by **John E. Hopcroft** in 1970, in lecture notes and seminars at Cornell University (Aho, Hopcroft, and Ullman later popularized it in their 1974 textbook *The Design and Analysis of Computer Algorithms*). Hopcroft would go on to share the 1986 Turing Award with Robert Tarjan for fundamental contributions to algorithms and data structures.

The 2-3 tree predates the **B-tree** of Bayer and McCreight (1972) by about two years, and the **red-black tree** of Guibas and Sedgewick (1978) by about eight. Historically and conceptually it sits at the root of the balanced-tree family:

- A **2-3 tree is exactly a B-tree of order 3** — the smallest non-trivial B-tree. Everything you learn here transfers directly to the [B-tree](../11-b-tree/junior.md), which simply allows many more keys per node so it can minimize disk reads.
- The **2-3-4 tree** is the next step up (nodes hold 1, 2, or 3 keys), and it is the model that the **[red-black tree](../04-red-black/junior.md)** simulates with one bit of color per node. Every red-black tree is a 2-3-4 tree in disguise; some authors (notably Sedgewick) teach a *left-leaning* red-black tree that is a 2-3 tree in disguise.
- The **AA tree** (Arne Andersson, 1993) is another red-black variant explicitly designed to mirror a 2-3 tree.

So the 2-3 tree is not a museum piece. It is the **conceptual seed** of nearly every balanced search tree in production today. People rarely implement a raw 2-3 tree (the splitting bookkeeping is more annoying than a red-black tree's color flips), but they implement its *descendants* constantly. Learn the 2-3 tree and the others stop being mysterious.

---

<a name="prerequisites"></a>
## 3. Prerequisites

To read this fluently you should already be comfortable with:

1. **BST mechanics.** `search` and `insert` for an unbalanced binary search tree. You should be able to write them without thinking. See [`09-trees/02-bst`](../02-bst/junior.md).
2. **Why a sorted insertion sequence breaks a vanilla BST** — the degeneration story from the introduction.
3. **Tree vocabulary** — node, child, parent, leaf, root, depth, height, subtree.
4. **Big-O intuition** — what O(log n) versus O(n) means concretely when n = 1,000,000.

You do **not** need to know anything about AVL rotations, red-black colors, or B-trees. The 2-3 tree is the place to learn balancing *before* any of those. In fact, the recommended path is: BST → 2-3 tree → red-black tree → B-tree. This file is step two.

---

<a name="glossary"></a>
## 4. Glossary

| Term | Definition |
|---|---|
| **2-node** | A node holding **one key** and having **two children** (or zero children if it is a leaf). Exactly a normal BST node. |
| **3-node** | A node holding **two keys** and having **three children** (or zero children if it is a leaf). The keys split the value range into three intervals. |
| **4-node** | A *temporary, illegal* node holding **three keys** and four children. It only exists for a split second during an insert before being split. Never allowed to persist. |
| **Key** | A stored search value. A 2-node has one; a 3-node has two (in sorted order, `key1 < key2`). |
| **Leaf** | A node with no children. In a 2-3 tree, leaves can be 2-nodes or 3-nodes. **All leaves are at the same depth** — the defining invariant. |
| **Internal node** | Any non-leaf node. A 2-node internal node has exactly 2 children; a 3-node internal node has exactly 3. |
| **Split** | The act of breaking an overfull 4-node into two 2-nodes and pushing its **middle key** up into the parent. |
| **Push up / promote** | Sending the middle key of a split up to the parent so it can act as a separator there. |
| **Cascade** | When a push-up overflows the parent into a 4-node, which itself splits and pushes up, possibly repeating up to the root. |
| **Height** | Number of edges on a root-to-leaf path. Because all leaves are equidistant, **every** root-to-leaf path has the same length — the height is well-defined and unambiguous. |
| **Order-3 B-tree** | The formal name for a 2-3 tree in B-tree terminology: nodes hold between 1 and 2 keys, between 2 and 3 children. |
| **Separator key** | A key inside an internal node that separates the value ranges of two adjacent children. |
| **Perfectly height-balanced** | Stronger than AVL's "differ by at most 1": in a 2-3 tree, all leaf depths are *exactly* equal. |

---

<a name="core-concepts"></a>
## 5. Core Concepts — 2-Nodes, 3-Nodes, and the Equal-Depth Invariant

A 2-3 tree is a search tree built from just two kinds of nodes.

### 5.1 The 2-node

A **2-node** holds one key and has two children. It is identical to an ordinary BST node:

```
        [m]
       /   \
   < m       > m
```

Everything in the left subtree is less than `m`; everything in the right subtree is greater than `m`. Standard BST rule.

### 5.2 The 3-node

A **3-node** holds two keys, `a` and `b` with `a < b`, and has **three** children. The two keys carve the number line into three intervals:

```
        [a . b]
       /   |   \
   < a   a..b   > b
```

- The **left** child holds keys less than `a`.
- The **middle** child holds keys strictly between `a` and `b`.
- The **right** child holds keys greater than `b`.

This is the new idea. By allowing a node to hold two keys and three children, a 2-3 tree gains a "shock absorber": when a node would overflow, it can sometimes just absorb the extra key by becoming a 3-node, instead of being forced to grow a new level the way a BST is.

### 5.3 The four invariants

A valid 2-3 tree satisfies all of these at all times:

1. **Every node is a 2-node or a 3-node.** Never one key with three children, never three keys, never anything else. (A 4-node may appear *transiently* mid-insert but is immediately split.)
2. **Search-tree ordering holds.** For a 2-node `[m]`: left subtree `< m <` right subtree. For a 3-node `[a . b]`: left `< a <` middle `< b <` right.
3. **All leaves are at the same depth.** Every path from the root to a leaf has the *exact same length*. This is the balance guarantee.
4. **A node is a leaf or it is full of children.** A 2-node leaf has 0 children; a 2-node internal node has exactly 2. A 3-node leaf has 0 children; a 3-node internal node has exactly 3. You never see a "half-attached" node.

Invariant 3 is the one that makes everything fast. A BST has no such rule, which is why it can become a line. A 2-3 tree *enforces* equal depth, and the insertion algorithm (next section) is carefully designed so that the only way to grow taller is to grow at the root — uniformly, preserving equal depth.

### 5.4 How tall is a 2-3 tree?

Because every internal node has at least 2 and at most 3 children, a tree of height `h` holds:

- **At most** all 3-nodes: each level multiplies the node count by 3, and each node holds 2 keys. Keys ≤ `2 · (3^(h+1) − 1) / 2 = 3^(h+1) − 1`.
- **At least** all 2-nodes (a plain perfect binary tree): keys ≥ `2^(h+1) − 1`.

Inverting: `log₃(n+1) − 1 ≤ h ≤ log₂(n+1) − 1`. So the height is **Θ(log n)**, squeezed between `log₃ n` and `log₂ n`. For `n = 1,000,000` that is roughly 12 to 20 levels — versus up to 1,000,000 for a degenerate BST. That is the entire payoff in one line.

---

<a name="search"></a>
## 6. Search — Walking 2 or 3 Ways

Searching a 2-3 tree is just a BST search with one twist: at each node you compare against **one or two** keys to choose among **two or three** children.

Starting at the root, at each node:

- If the node is a **2-node** `[m]`:
  - `key == m` → **found.**
  - `key < m` → go to the **left** child.
  - `key > m` → go to the **right** child.
- If the node is a **3-node** `[a . b]`:
  - `key == a` or `key == b` → **found.**
  - `key < a` → go to the **left** child.
  - `a < key < b` → go to the **middle** child.
  - `key > b` → go to the **right** child.

If you reach a leaf and the key is not there, it is not in the tree.

### Worked search

Find `15` in this tree:

```
              [10 . 20]
             /    |    \
        [5]   [12 . 15]  [25]
```

1. Root `[10 . 20]`: `15` is between `10` and `20`, so go to the **middle** child.
2. Middle child `[12 . 15]`: `15 == 15` → **found** at depth 1.

Find `7`:

1. Root `[10 . 20]`: `7 < 10` → go **left**.
2. Left child `[5]`: `7 > 5` → go to its **right** child. But `[5]` is a leaf with no children → **not found.**

Search visits one node per level and does at most two comparisons per node, so it is **O(log n)**.

---

<a name="insertion"></a>
## 7. Insertion — Split and Push Up

Insertion is where the magic lives. The rule is **always insert into a leaf**, never into an internal node, and then fix up any overflow by splitting and pushing the middle key upward.

### 7.1 Find the target leaf

Run the search above as if looking for the new key. Since the key is not yet present, the search ends at a leaf. **That leaf is where the key goes.** (We always add at a leaf, exactly so that no path becomes shorter or longer than the others.)

### 7.2 Add the key to the leaf

- If the leaf is a **2-node** `[m]`: it now holds two keys and becomes a **3-node**. No split needed. Done.
  ```
  Insert 8 into [5]   →   [5 . 8]
  ```
- If the leaf is a **3-node** `[a . b]`: adding a third key makes a temporary, illegal **4-node** `[a . x . b]` (the three keys sorted). It must split.

### 7.3 Split a 4-node

A 4-node `[lo . mid . hi]` splits into three pieces:

```
        [lo . mid . hi]                    push mid UP
       /   |    |     \                          │
                              ───split───►       ▼
                                              ...[mid]...
                                              /        \
                                          [lo]        [hi]
```

- The **middle key `mid` is pushed up** into the parent, where it becomes a new separator.
- The **left key `lo` becomes a new 2-node**; it keeps the two leftmost children of the 4-node.
- The **right key `hi` becomes a new 2-node**; it keeps the two rightmost children.

Now the parent has received a new key. Two things can happen:

- **Parent was a 2-node:** it absorbs `mid` and becomes a 3-node. The new left/right nodes slot in as its children. **Done — no cascade.**
- **Parent was a 3-node:** it momentarily becomes a 4-node and must split too. **The split cascades upward**, repeating step 7.3 one level higher.

### 7.4 Splitting the root grows the tree

If the cascade reaches the **root** and the root is a 3-node, it splits into a 4-node and pushes its middle key up — but there is no parent to receive it. So a **brand-new root** is created holding just that middle key, with the two split halves as its children:

```
Root 4-node [lo . mid . hi]          New root [mid]
                          ───►        /          \
                                   [lo]          [hi]
```

The tree just gained one level. Crucially, **every** leaf is now exactly one edge farther from the root than before — equally. The equal-depth invariant survives. **This is the only way a 2-3 tree ever grows taller, and it is why the tree grows at the root rather than the leaves.**

### 7.5 The full picture

```
INSERT(key):
    leaf = search down to the leaf where key belongs
    add key into leaf
    while current node has 3 keys (it is a 4-node):
        split it: push middle key up, make two 2-nodes
        if there is no parent:
            create a new root from the middle key   ← tree grows up
            break
        else:
            move up to the parent (which just received the middle key)
```

Insertion does one walk **down** to find the leaf, then at most one walk **up** to handle cascading splits. Both walks are O(log n), so insertion is **O(log n)**.

---

<a name="worked-example"></a>
## 8. Worked Example — Build a Tree from Scratch

Let us insert the sequence **`1, 2, 3, 4, 5, 6, 7`** — the very sorted sequence that *destroys* a plain BST — and watch the 2-3 tree stay perfectly balanced. Draw along on paper; this single trace teaches more than any prose.

### Insert 1
Empty tree → the root is a leaf 2-node.
```
[1]
```

### Insert 2
Search ends at leaf `[1]`. It is a 2-node, so it absorbs `2` and becomes a 3-node.
```
[1 . 2]
```

### Insert 3
Search ends at leaf `[1 . 2]`, a 3-node. Adding `3` makes the temporary 4-node `[1 . 2 . 3]`. **Split.** Middle key `2` is pushed up; since there is no parent, it becomes a new root. `1` and `3` become its children.
```
      [2]
     /   \
   [1]   [3]
```
The tree just grew at the root. Height is now 1. Both leaves at depth 1. 

### Insert 4
Search: `4 > 2` → go right to leaf `[3]`. It is a 2-node, absorbs `4` → `[3 . 4]`.
```
      [2]
     /   \
   [1]  [3 . 4]
```

### Insert 5
Search: `5 > 2` → right to `[3 . 4]`. `5 > 4`, a 3-node leaf → temporary 4-node `[3 . 4 . 5]`. **Split.** Middle `4` pushes up into parent `[2]`. The parent is a 2-node, so it absorbs `4` and becomes the 3-node `[2 . 4]`. The split halves `[3]` and `[5]` become the middle and right children.
```
       [2 . 4]
      /   |   \
   [1]  [3]  [5]
```
No cascade — the parent had room. Height still 1.

### Insert 6
Search: `6 > 4` → right to `[5]`, a 2-node leaf → `[5 . 6]`.
```
       [2 . 4]
      /   |   \
   [1]  [3]  [5 . 6]
```

### Insert 7
Search: `7 > 4` → right to `[5 . 6]`, a 3-node leaf → temporary 4-node `[5 . 6 . 7]`. **Split.** Middle `6` pushes up into parent `[2 . 4]`. But the parent is *already a 3-node* — receiving `6` makes it the temporary 4-node `[2 . 4 . 6]`. **It splits too — a cascade!**

The middle key `4` pushes up. There is no parent, so `4` becomes a **new root**. The 4-node `[2 . 4 . 6]` splits into `[2]` and `[6]`, each keeping two of the four children below:

```
            [4]
          /     \
      [2]        [6]
     /   \      /   \
   [1]   [3]  [5]   [7]
```

The tree grew at the root **again**. Height is now 2, and — look carefully — **every one of the four leaves is at depth 2.** A perfectly balanced tree, built from the worst-case sorted input that turns a BST into a 7-node line. That is the whole promise of the 2-3 tree, demonstrated.

> **Try it yourself:** continue inserting `8, 9, 10`. You will fill out the rightmost leaf, split once without cascading, and see the tree stay flat. Tracing three or four more inserts on paper cements the split-and-push-up reflex permanently.

---

<a name="invariant"></a>
## 9. The Equal-Depth Invariant, Proven by Construction

Here is the elegant part: the equal-depth invariant is not maintained by a separate "rebalance" step the way AVL trees rebalance with rotations. It is maintained **automatically**, as a side effect of *how* keys are inserted. Three observations prove it:

1. **New keys only ever go into existing leaves.** A new key never gets its own new leaf node hung below an existing leaf. So no single path can get longer by adding a key — the leaf just gets fatter (2-node → 3-node), not deeper.

2. **A split never changes the depth of any leaf.** When a 4-node splits into two 2-nodes, those two nodes sit at the *same level the 4-node was on*. Their children (if any) keep the same depth. The only thing that moves is the middle key, which goes *up* — and a key moving up does not change any leaf's depth.

3. **The only depth change is a root split, and it affects every leaf equally.** When the root splits and a new root appears on top, *every* leaf becomes exactly one edge deeper. Uniformly. The tree gets taller all at once, never in just one branch.

Put together: leaves can only get fatter or get uniformly deeper, never individually deeper. Therefore **all leaves stay at the same depth, forever, no matter what order keys arrive in.** Contrast this with a BST, where each insert grows exactly one path by one node, so the paths drift apart. The 2-3 tree's insertion rule makes drift impossible.

This is the single most important idea to carry away from this document. Every balanced tree you will ever study is some clever encoding of "grow at the root, keep the leaves level."

---

<a name="big-o"></a>
## 10. Big-O Summary

| Operation | Time | Space | Notes |
|---|---|---|---|
| **search** | O(log n) | O(1) iterative / O(log n) recursive | At most 2 comparisons per level |
| **insert** | O(log n) | O(log n) for the path | One walk down, one cascade up; both bounded by height |
| **delete** | O(log n) | O(log n) | Harder; mirrors insert with merge/borrow (see [`./middle.md`](./middle.md)) |
| **min / max** | O(log n) | O(1) | Walk to leftmost / rightmost leaf |
| **predecessor / successor** | O(log n) | O(log n) | Standard BST-style traversal |
| **inorder traversal** | O(n) | O(log n) | Visit children and keys in order → sorted output |
| **height** | Θ(log n) | — | `log₃(n+1) − 1 ≤ h ≤ log₂(n+1) − 1` |

For `n = 10⁶`, height is between ~12 and ~20. For `n = 10⁹`, between ~18 and ~30. The worst case **equals** the best case to within a small constant factor — there is no degenerate input. That guaranteed worst case is the reason balanced trees exist.

---

<a name="analogies"></a>
## 11. Real-World Analogies

### 11.1 The expanding filing folder

Picture an accordion folder where each pocket can hold up to two documents. When you try to file a third document into a full pocket, you do not cram it in — you split the pocket into two, and you label a new divider tab with the *middle* document's name and slide that tab up to the parent shelf. If the parent shelf's divider rack is also full, *it* splits and pushes a tab up to the cabinet level. When the very top cabinet overflows, you buy a taller cabinet and everything sits one shelf lower — uniformly. That is a 2-3 tree insert, top to bottom.

### 11.2 Corporate reorg that promotes from the middle

A manager can supervise two or three reports. When a team grows to a fourth report, you do not pile everyone under one overworked manager (a lopsided BST). Instead you split the team, **promote the middle person** to be a new manager, and that promotion bubbles up the org chart. If it reaches the CEO and the top is full, you add a new layer of leadership — and every individual contributor is now exactly one rung farther from the top, all at once. Nobody's reporting chain becomes mysteriously longer than anyone else's.

### 11.3 The always-level bookshelf

Imagine a magical bookshelf rule: every book must be exactly the same number of shelves above the floor. You can never make one column taller than another. The only way to add height is to lift the **entire** shelf assembly and slide a new floor underneath. That constraint — *the leaves stay level; growth happens at the bottom of the structure (the root, drawn at the top) uniformly* — is precisely the equal-depth invariant.

---

<a name="pros-cons"></a>
## 12. Pros and Cons vs Plain BST

### Pros
- **Guaranteed O(log n)** for search, insert, and delete. No degenerate input exists — sorted data, reverse-sorted data, and random data all produce a balanced tree.
- **Perfectly height-balanced.** Stronger than AVL's "heights differ by at most 1": *all* leaves are at the *exact same* depth. The cleanest possible balance guarantee.
- **Conceptually simple to balance.** No rotations, no color bits. Balancing is a side effect of split-and-push-up. Many people find the *idea* easier to grasp than red-black rotations.
- **The gateway to B-trees.** Once you understand this, the [B-tree](../11-b-tree/junior.md) is "the same thing, but each node holds hundreds of keys to fit a disk page," and the [red-black tree](../04-red-black/junior.md) is "a 2-3-4 tree encoded with one color bit per node."

### Cons
- **Two node shapes complicate the code.** Every operation must branch on "is this a 2-node or a 3-node?" In a real implementation this is fiddlier than a uniform binary node — which is exactly why red-black trees (a binary encoding of a 2-3-4 tree) are usually preferred in production.
- **Deletion is genuinely harder than insertion.** Borrowing and merging underflowing nodes has more cases than splitting. Most courses defer the full delete to a later lesson (so do we — see [`./middle.md`](./middle.md)).
- **More pointer-chasing per key than a B-tree.** With only two keys per node, a 2-3 tree has nearly as many nodes as a binary tree, so it has poor cache and disk locality. Production systems use high-fanout B-trees instead. The 2-3 tree is a *teaching* structure and an in-memory ordered-map building block, not a disk index.
- **Rarely implemented directly.** You will almost always reach for a red-black tree (the standard library's `TreeMap` / `std::map`) or a B-tree instead. The 2-3 tree's value is conceptual: it is the mental model those structures are built on.

### When to reach for what
- Need an **ordered in-memory map** in production? Use a red-black tree (it is what your language's standard library ships). It is a 2-3-4 tree under the hood.
- Storing data **on disk** or larger than cache? Use a [B-tree / B+ tree](../11-b-tree/junior.md).
- **Learning how balanced trees work**? The 2-3 tree is the best place to start — and that is exactly what you are doing now.

---

<a name="deletion"></a>
## 13. A Note on Deletion

Deletion in a 2-3 tree is the mirror image of insertion, and it is **harder** — which is why we keep it light at this level and give it full treatment in [`./middle.md`](./middle.md).

The intuition: insertion's problem is **overflow** (a node gets too many keys), fixed by **splitting** and **pushing up**. Deletion's problem is the opposite — **underflow** (a node loses its only key and has none left), fixed by **borrowing** a key from a neighbor sibling or **merging** with one.

A quick sketch of how it works:

1. **If the key to delete is in an internal node**, first swap it with its **in-order predecessor or successor** (which always lives in a leaf), so that the actual removal happens at a leaf. This is the same predecessor/successor trick you used for [BST deletion](../02-bst/junior.md).
2. **Remove the key from the leaf.** If the leaf was a 3-node, it simply becomes a 2-node and you are done — no underflow.
3. **If the leaf was a 2-node**, removing its key leaves it empty (an "underflow"). Now you must repair:
   - **Borrow:** if an adjacent sibling is a 3-node, rotate a key through the parent — the sibling lends a key up to the parent, and the parent lends a key down to the empty node.
   - **Merge:** if no sibling can spare a key, merge the empty node with a sibling and a key pulled down from the parent. This may cause the *parent* to underflow, which **cascades upward** — exactly mirroring how a split cascades upward during insert.
4. **If the merge cascade reaches the root and empties it**, the root is removed and its single child becomes the new root. **The tree shrinks by one level — uniformly.** This is the exact mirror of a root split growing the tree.

Notice the symmetry: insert cascades **splits** up and grows at the root; delete cascades **merges** up and shrinks at the root. Both keep all leaves at equal depth. The full case analysis (borrow-left, borrow-right, merge-left, merge-right) lives in [`./middle.md`](./middle.md).

---

<a name="code-examples"></a>
## 14. Code Examples — Go, Java, Python

Below is a clear, correct implementation of the **node model**, **search**, and **insertion** in all three languages. At junior level we favor **clarity over cleverness**: we model a node explicitly as "1 or 2 keys, 2 or 3 children," and insertion returns a small "split result" struct up the recursion when a node overflows. This recursive "bubble the split up the return value" style is the cleanest correct formulation and avoids parent pointers entirely.

### 14.1 Python

```python
class Node:
    """A 2-3 tree node: 1 key (2-node) or 2 keys (3-node)."""
    __slots__ = ("keys", "children")

    def __init__(self, keys, children=None):
        self.keys = keys                  # [k1] or [k1, k2], sorted
        self.children = children or []    # [] for a leaf; else len(keys)+1 kids

    def is_leaf(self):
        return len(self.children) == 0


class TwoThreeTree:
    def __init__(self):
        self.root = None

    # ------------------------------- search -------------------------------
    def search(self, key):
        node = self.root
        while node is not None:
            if key in node.keys:
                return True
            if key < node.keys[0]:
                if node.is_leaf():
                    return False
                node = node.children[0]
            elif len(node.keys) == 1 or key < node.keys[1]:
                # 2-node right child, or 3-node middle child
                if node.is_leaf():
                    return False
                node = node.children[1]
            else:
                if node.is_leaf():
                    return False
                node = node.children[2]
        return False

    # ------------------------------- insert -------------------------------
    def insert(self, key):
        if self.root is None:
            self.root = Node([key])
            return
        split = self._insert(self.root, key)
        if split is not None:
            # the root split: build a new root from the pushed-up middle key
            mid, left, right = split
            self.root = Node([mid], [left, right])

    def _insert(self, node, key):
        """Insert key into the subtree at node.
        Returns None if no split, else (mid_key, left_node, right_node)."""
        if key in node.keys:
            return None                                  # duplicate: ignore

        if node.is_leaf():
            node.keys.append(key)
            node.keys.sort()
            if len(node.keys) == 3:                      # overflow → split
                return self._split(node)
            return None

        # internal node: pick the child to descend into
        idx = self._child_index(node, key)
        split = self._insert(node.children[idx], key)
        if split is None:
            return None

        # a child split: absorb its pushed-up key into this node
        mid, left, right = split
        node.keys.insert(idx, mid)
        node.children[idx] = left
        node.children.insert(idx + 1, right)
        if len(node.keys) == 3:                          # this node overflowed
            return self._split(node)
        return None

    @staticmethod
    def _child_index(node, key):
        if key < node.keys[0]:
            return 0
        if len(node.keys) == 1 or key < node.keys[1]:
            return 1
        return 2

    @staticmethod
    def _split(node):
        """Split an overfull 3-key node into two 2-nodes; return the push-up."""
        lo, mid, hi = node.keys
        if node.is_leaf():
            left = Node([lo])
            right = Node([hi])
        else:
            c = node.children
            left = Node([lo], [c[0], c[1]])
            right = Node([hi], [c[2], c[3]])
        return (mid, left, right)
```

### 14.2 Go

```go
package twothree

// Node is a 2-3 tree node: 1 key (2-node) or 2 keys (3-node).
type Node struct {
    keys     []int
    children []*Node // empty for a leaf; else len(keys)+1 children
}

func (n *Node) isLeaf() bool { return len(n.children) == 0 }

// Tree is the 2-3 tree.
type Tree struct {
    root *Node
}

// splitResult carries a pushed-up key and its two halves up the recursion.
type splitResult struct {
    mid         int
    left, right *Node
}

// ------------------------------- search -------------------------------

func (t *Tree) Search(key int) bool {
    node := t.root
    for node != nil {
        for _, k := range node.keys {
            if k == key {
                return true
            }
        }
        if node.isLeaf() {
            return false
        }
        node = node.children[childIndex(node, key)]
    }
    return false
}

func childIndex(n *Node, key int) int {
    if key < n.keys[0] {
        return 0
    }
    if len(n.keys) == 1 || key < n.keys[1] {
        return 1
    }
    return 2
}

// ------------------------------- insert -------------------------------

func (t *Tree) Insert(key int) {
    if t.root == nil {
        t.root = &Node{keys: []int{key}}
        return
    }
    s := t.insert(t.root, key)
    if s != nil {
        // root split: grow the tree by one level
        t.root = &Node{keys: []int{s.mid}, children: []*Node{s.left, s.right}}
    }
}

func (t *Tree) insert(node *Node, key int) *splitResult {
    for _, k := range node.keys {
        if k == key {
            return nil // duplicate: ignore
        }
    }

    if node.isLeaf() {
        node.keys = insertSorted(node.keys, key)
        if len(node.keys) == 3 {
            return split(node)
        }
        return nil
    }

    idx := childIndex(node, key)
    s := t.insert(node.children[idx], key)
    if s == nil {
        return nil
    }

    // absorb the child's pushed-up key into this node
    node.keys = insertSorted(node.keys, s.mid)
    node.children[idx] = s.left
    node.children = insertChildAt(node.children, idx+1, s.right)
    if len(node.keys) == 3 {
        return split(node)
    }
    return nil
}

func split(node *Node) *splitResult {
    lo, mid, hi := node.keys[0], node.keys[1], node.keys[2]
    var left, right *Node
    if node.isLeaf() {
        left = &Node{keys: []int{lo}}
        right = &Node{keys: []int{hi}}
    } else {
        c := node.children
        left = &Node{keys: []int{lo}, children: []*Node{c[0], c[1]}}
        right = &Node{keys: []int{hi}, children: []*Node{c[2], c[3]}}
    }
    return &splitResult{mid: mid, left: left, right: right}
}

func insertSorted(keys []int, key int) []int {
    i := 0
    for i < len(keys) && keys[i] < key {
        i++
    }
    keys = append(keys, 0)
    copy(keys[i+1:], keys[i:])
    keys[i] = key
    return keys
}

func insertChildAt(children []*Node, idx int, child *Node) []*Node {
    children = append(children, nil)
    copy(children[idx+1:], children[idx:])
    children[idx] = child
    return children
}
```

### 14.3 Java

```java
import java.util.ArrayList;
import java.util.List;

public class TwoThreeTree {

    /** A 2-3 tree node: 1 key (2-node) or 2 keys (3-node). */
    static final class Node {
        final List<Integer> keys = new ArrayList<>();      // 1 or 2 keys, sorted
        final List<Node> children = new ArrayList<>();     // empty, or keys+1 kids

        boolean isLeaf() { return children.isEmpty(); }
    }

    /** Carries a pushed-up key and its two halves up the recursion. */
    private static final class Split {
        final int mid;
        final Node left, right;
        Split(int mid, Node left, Node right) {
            this.mid = mid; this.left = left; this.right = right;
        }
    }

    private Node root;

    // ------------------------------- search -------------------------------

    public boolean search(int key) {
        Node node = root;
        while (node != null) {
            if (node.keys.contains(key)) return true;
            if (node.isLeaf()) return false;
            node = node.children.get(childIndex(node, key));
        }
        return false;
    }

    private static int childIndex(Node n, int key) {
        if (key < n.keys.get(0)) return 0;
        if (n.keys.size() == 1 || key < n.keys.get(1)) return 1;
        return 2;
    }

    // ------------------------------- insert -------------------------------

    public void insert(int key) {
        if (root == null) {
            root = new Node();
            root.keys.add(key);
            return;
        }
        Split s = insert(root, key);
        if (s != null) {                          // root split → grow one level
            Node newRoot = new Node();
            newRoot.keys.add(s.mid);
            newRoot.children.add(s.left);
            newRoot.children.add(s.right);
            root = newRoot;
        }
    }

    private Split insert(Node node, int key) {
        if (node.keys.contains(key)) return null;          // duplicate: ignore

        if (node.isLeaf()) {
            insertSorted(node.keys, key);
            return node.keys.size() == 3 ? split(node) : null;
        }

        int idx = childIndex(node, key);
        Split s = insert(node.children.get(idx), key);
        if (s == null) return null;

        // absorb the child's pushed-up key
        insertSorted(node.keys, s.mid);
        node.children.set(idx, s.left);
        node.children.add(idx + 1, s.right);
        return node.keys.size() == 3 ? split(node) : null;
    }

    private static Split split(Node node) {
        int lo = node.keys.get(0), mid = node.keys.get(1), hi = node.keys.get(2);
        Node left = new Node();
        Node right = new Node();
        left.keys.add(lo);
        right.keys.add(hi);
        if (!node.isLeaf()) {
            left.children.add(node.children.get(0));
            left.children.add(node.children.get(1));
            right.children.add(node.children.get(2));
            right.children.add(node.children.get(3));
        }
        return new Split(mid, left, right);
    }

    private static void insertSorted(List<Integer> keys, int key) {
        int i = 0;
        while (i < keys.size() && keys.get(i) < key) i++;
        keys.add(i, key);
    }
}
```

### 14.4 Why this shape of code?

The recursion returns a `Split` / `splitResult` / tuple **only when a node overflowed**, carrying the middle key and the two new halves up to the caller. The caller (the parent) absorbs that key — and if *it* now overflows, it returns its own split, and so the cascade rides the call stack upward naturally. When the *root's* call returns a split, the public `insert` builds a new root from it. This is the cleanest way to express "split and push up" without storing parent pointers, and it maps one-to-one onto the [B-tree](../11-b-tree/junior.md) insert you will meet later.

---

<a name="patterns"></a>
## 15. Coding Patterns

### 15.1 Return-the-split-up-the-stack

The pattern above — return `null` when nothing happened, return a `Split` when a node overflowed — is the 2-3 / B-tree analogue of the AVL **"return the new subtree root"** pattern. It lets a single downward recursion handle an upward cascade using only the call stack. Learn it once; it reappears in every multiway tree.

### 15.2 Branch on key count, not on a node "type" flag

Notice the code never stores a `isThreeNode` boolean. It just checks `len(keys)`. A 2-node has one key; a 3-node has two; a transient 4-node has three (and is immediately split). Deriving the node "type" from `len(keys)` keeps the invariant `len(children) == len(keys) + 1` self-evident and eliminates a field that could fall out of sync.

### 15.3 Always insert at a leaf

Every insert descends to a leaf and adds there, *never* into an internal node directly. Internal nodes only ever receive keys via a **push-up** from a split below them. This single discipline is what guarantees the equal-depth invariant — internalize it.

### 15.4 The `child_index` helper

Choosing which of 2 or 3 children to descend into is the one piece of logic every operation shares. Factor it into one helper (`childIndex` / `_child_index`) and call it from search, insert, and delete alike. A bug here corrupts everything, so it is worth isolating and testing in one place.

---

<a name="common-mistakes"></a>
## 16. Common Mistakes

1. **Hanging a new leaf below an existing leaf** instead of fattening the leaf into a 3-node or splitting it. This is the BST reflex, and it instantly breaks the equal-depth invariant. New keys go *into* a leaf, never *below* it.
2. **Pushing up the wrong key on a split.** The **middle** key of the three goes up; the smallest and largest stay as the two new 2-nodes. Pushing up the smallest or largest scrambles the ordering.
3. **Forgetting to distribute the four children when splitting an internal 4-node.** A split of an internal node must hand children `[c0, c1]` to the left half and `[c2, c3]` to the right half. Drop or duplicate a child and the tree corrupts silently.
4. **Letting a 4-node persist.** A 4-node is allowed to exist for one instant during an insert and must be split immediately. If your code ever stores a node with three keys, the invariant is broken.
5. **Not cascading the split upward.** After a split pushes a key into a parent that is already a 3-node, that parent becomes a 4-node and must *itself* split. Stopping the cascade early leaves an illegal node. The return-the-split pattern handles this automatically — but only if the caller actually checks the return value.
6. **Forgetting the new-root case.** When the cascade reaches the top and the root splits, you must create a brand-new root from the pushed-up key. Skip this and you lose the key (and the tree stops growing). This is the *only* place the tree's height increases.
7. **Off-by-one in `childIndex`.** For a 3-node, `key < keys[1]` (after ruling out `key < keys[0]`) selects the **middle** child, not the right. Drawing the three intervals `<a`, `a..b`, `>b` next to your code prevents this.
8. **Mishandling duplicates.** Decide a policy explicitly — ignore, count, or store a list per key — and check for the duplicate *before* descending, as the sample code does. Silently inserting a duplicate corrupts the ordering assumptions.
9. **Comparing against only one key in a 3-node during search.** A 3-node needs up to two comparisons. Checking only the first key sends searches down the wrong child.

---

<a name="edge-cases"></a>
## 17. Edge Cases

| Case | Expected behavior |
|---|---|
| Empty tree, search | Return false / not found. |
| Empty tree, insert | Root becomes a single leaf 2-node holding the key. |
| Insert into a single 2-node leaf | Leaf becomes a 3-node. No split, height stays 0. |
| Insert into a single 3-node leaf | Splits; middle key becomes a new root. **Height grows to 1.** |
| Insert a duplicate key | Default: ignore. Decide and document the policy. |
| Sorted ascending inserts `1,2,3,…` | Stays perfectly balanced; height grows ~`log n` via periodic root splits. **This is the input that destroys a BST.** |
| Sorted descending inserts | Same — balanced. The 2-3 tree is order-insensitive. |
| Cascading split reaching the root | New root created; every leaf becomes one edge deeper, uniformly. |
| All identical keys (duplicates ignored) | Tree stays a single node. |
| Search for a key smaller than everything | Walk left children to a leaf, return not found. |
| Search for a key larger than everything | Walk right children to a leaf, return not found. |

---

<a name="cheat-sheet"></a>
## 18. Cheat Sheet

```
NODE SHAPES
    2-node: [m]        1 key, 2 children   (left < m < right)
    3-node: [a . b]    2 keys, 3 children  (left < a < middle < b < right)
    4-node: [a . x . b]  ILLEGAL, transient — must split immediately

INVARIANTS
    Every node is a 2-node or 3-node
    Search ordering holds at every node
    ALL leaves at the same depth   ← the balance guarantee
    A node is a leaf, or it has exactly (#keys + 1) children

SEARCH
    At each node compare against 1 or 2 keys,
    descend into the matching child interval.
    Reach a leaf without a match → not found.

INSERT
    1. Descend to the target LEAF.
    2. Add the key there.
    3. While the node now has 3 keys (a 4-node):
         push the MIDDLE key up,
         split into two 2-nodes (lo and hi),
         hand children [c0,c1] to lo, [c2,c3] to hi,
         move up to the parent (which received the middle key).
    4. If the cascade reaches the root and it splits:
         make a NEW root from the pushed-up key.   ← tree grows at the root

SPLIT a 4-node [lo . mid . hi]
    mid   → pushed up to the parent (separator)
    [lo]  → new 2-node, keeps children c0, c1
    [hi]  → new 2-node, keeps children c2, c3

HEIGHT
    log₃(n+1) − 1  ≤  h  ≤  log₂(n+1) − 1    → Θ(log n)

COMPLEXITY
    search / insert / delete: O(log n) guaranteed, no degenerate input

RELATIONSHIPS
    2-3 tree   = B-tree of order 3
    2-3-4 tree = the tree a red-black tree encodes with color bits
```

---

<a name="animation"></a>
## 19. Visual Animation Reference

See `animation.html` in this folder. Insert keys one at a time and watch:

- A **2-node turn green into a 3-node** when it absorbs a second key without splitting.
- A node **flash yellow** as it overflows into a temporary 4-node, then **split** into two nodes with the middle key visibly **sliding up** to the parent.
- A **cascade** ripple upward when the parent was already full, all the way to a **root split** that grows the whole tree one level and pushes every leaf down in unison.
- The stats panel reports height, key count, node count, and the count of 2-nodes versus 3-nodes.

The recommended demo is the sorted sequence from §8 — **`1, 2, 3, 4, 5, 6, 7`** — side by side with a plain BST built from the same input. Watch the BST stretch into a 7-node line while the 2-3 tree stays a flat, two-level tree. That contrast is the entire lesson in one animation.

---

<a name="summary"></a>
## 20. Summary

- A **2-3 tree** is a perfectly height-balanced search tree where every node is a **2-node** (1 key, 2 children) or a **3-node** (2 keys, 3 children), and **all leaves sit at exactly the same depth**. It is precisely a **B-tree of order 3**, introduced by **John Hopcroft in 1970**.
- **Search** walks down the tree comparing against one or two keys per node to pick among two or three children — O(log n).
- **Insertion** always adds a key to a **leaf**. If the leaf overflows to a temporary 4-node, it **splits**: the **middle key is pushed up** to the parent, and the node becomes two 2-nodes. The push-up can **cascade** upward, and when the **root** splits, a new root is created and **the whole tree grows one level — uniformly**.
- That upward growth is the key insight: a BST grows at the leaves and goes crooked; a 2-3 tree grows at the root and **stays level no matter the insertion order**. The equal-depth invariant is maintained for free, as a side effect of split-and-push-up — no rotations required.
- Height is **Θ(log n)** (between `log₃ n` and `log₂ n`), so search, insert, and delete are all **O(log n)** with no degenerate case.
- **Deletion** mirrors insertion: underflow is fixed by **borrowing** or **merging**, cascading upward, and an emptied root shrinks the tree one level. It is harder than insertion — full details in [`./middle.md`](./middle.md).
- The 2-3 tree is rarely implemented in production (red-black trees and B-trees are preferred), but it is the **conceptual seed** of all of them. Master it and the [red-black tree](../04-red-black/junior.md), the [2-3-4 tree](../11-b-tree/junior.md), and the [B-tree](../11-b-tree/junior.md) become straightforward variations on one idea.

Next: [`./middle.md`](./middle.md) covers full deletion with borrow/merge case analysis, the formal equivalence to order-3 B-trees and to red-black trees, bulk loading, and proofs of the height bounds.

---

<a name="further-reading"></a>
## 21. Further Reading

- **Aho, A. V., Hopcroft, J. E., & Ullman, J. D.** *The Design and Analysis of Computer Algorithms*, Addison-Wesley, 1974. The 2-3 tree is presented here by its originator; the canonical early reference.
- **Sedgewick, R. & Wayne, K.** *Algorithms*, 4th ed., Addison-Wesley, 2011. Section 3.3 develops the 2-3 tree in detail and then derives the **left-leaning red-black tree** directly from it — the clearest demonstration that red-black trees *are* 2-3 trees.
- **Cormen, Leiserson, Rivest, Stein (CLRS).** *Introduction to Algorithms*, 3rd ed., MIT Press, 2009. Chapter 18 ("B-Trees") generalizes the 2-3 tree to arbitrary order; read it after this to see the disk-oriented payoff.
- **Knuth, D. E.** *The Art of Computer Programming, Volume 3: Sorting and Searching*, 2nd ed., Addison-Wesley, 1998. Section 6.2.4 treats multiway balanced trees with full mathematical depth.
- **Bayer, R. & McCreight, E. M.** (1972). *Organization and maintenance of large ordered indexes.* Acta Informatica 1(3), 173–189. The B-tree paper — the disk-scaled descendant of the 2-3 tree.
- Continue with [`./middle.md`](./middle.md) for deletion, the red-black and B-tree equivalences, and the height-bound proofs.
