# 2-3-4 Tree — Junior Level

> **Read time: ~45 minutes** · **Audience:** Engineers who have built a Binary Search Tree and ideally have seen a [2-3 tree](../18-two-three-tree/junior.md). Prerequisite: `09-trees/02-bst`. No prior knowledge of B-trees or red-black trees is assumed — this document teaches the whole idea from scratch.

The **2-3-4 tree** is a perfectly balanced search tree where every node holds **one, two, or three keys** and has **two, three, or four children**. It is the next step up from the [2-3 tree](../18-two-three-tree/junior.md): where a 2-3 tree allows 2-nodes and 3-nodes, a 2-3-4 tree adds the **4-node** (three keys, four children) as a *legal, permanent* citizen. That one extra node shape unlocks a remarkably clean insertion algorithm and — more importantly — makes the 2-3-4 tree the **exact structure that a [red-black tree](../04-red-black/junior.md) simulates** with a single color bit per node.

If you have read the 2-3 tree file, you will recognize the whole machine here: nodes hold a few keys, all leaves sit at the same depth, and the tree grows at the *root*, never the leaves. The 2-3-4 tree adds two things worth learning for their own sake. First, a slicker **top-down insertion**: instead of inserting and then letting splits *cascade back up*, you **split every full node on the way down**, so by the time you reach the leaf there is guaranteed room and nothing ever cascades. Second, the **red-black correspondence**: a 2-3-4 tree is the cleanest mental model for the balanced tree that ships inside your standard library (`TreeMap`, `std::map`).

This document teaches the 2-3-4 tree so concretely that you will be able to hand-trace a top-down insertion sequence, draw the tree at every step, write a correct `search` and `insert` from memory in Go, Java, or Python, and explain — at a junior level — why a red-black tree is "a 2-3-4 tree wearing a binary costume."

---

## Table of Contents

1. [Introduction — Why Balance Matters, and Why a Fourth Node Shape Helps](#introduction)
2. [History — Bayer & McCreight to Guibas & Sedgewick](#history)
3. [Prerequisites](#prerequisites)
4. [Glossary](#glossary)
5. [Core Concepts — 2-, 3-, and 4-Nodes and the Equal-Depth Invariant](#core-concepts)
6. [Search — Walking 2, 3, or 4 Ways](#search)
7. [Insertion — The Top-Down Preemptive Split](#insertion)
8. [Worked Example — Build a Tree from Scratch](#worked-example)
9. [The Equal-Depth Invariant, Proven by Construction](#invariant)
10. [The Red-Black Correspondence (A Gentle First Look)](#red-black)
11. [Big-O Summary](#big-o)
12. [Real-World Analogies](#analogies)
13. [Pros and Cons — vs Plain BST and vs 2-3 Tree](#pros-cons)
14. [A Note on Deletion](#deletion)
15. [Code Examples — Go, Java, Python](#code-examples)
16. [Coding Patterns](#patterns)
17. [Common Mistakes](#common-mistakes)
18. [Edge Cases](#edge-cases)
19. [Cheat Sheet](#cheat-sheet)
20. [Visual Animation Reference](#animation)
21. [Summary](#summary)
22. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Why Balance Matters, and Why a Fourth Node Shape Helps

You have already built a [Binary Search Tree](../02-bst/junior.md). You inserted `50, 30, 70, 20, 40, 60, 80` and got a tidy tree of height 2 — three comparisons find anything. Then a stream of already-sorted data arrives — `1, 2, 3, 4, 5, ..., 1000000` — every insert lands on the right child of the rightmost node, and the tree collapses into a straight line:

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

Height is now `n - 1`. A search for `999999` walks a million nodes. Insert, delete, find — all degrade to O(n), the speed of a linked list. **O(log n) was never a guarantee in a plain BST. It was a lucky average over random insertion orders**, and real data is rarely random.

The disease is that **the shape of a BST is decided by the order keys arrive, and the BST has no mechanism to fix a bad shape.** Each new key is bolted onto a leaf, the tree grows *downward*, and sorted input grows it downward in one direction forever.

The cure used by 2-3 and 2-3-4 trees is radical: **change the rules so a bad shape can never form.** Let a node hold more than one key, and insist on one ironclad rule — **every leaf is at exactly the same depth.** When a node gets too full, you do *not* hang a new node below it (that would make one path longer). Instead you **split** the overfull node and push its middle key **up**. Done right, this keeps every leaf level forever, no matter the insertion order.

### Where the fourth node shape comes in

A [2-3 tree](../18-two-three-tree/junior.md) allows two node shapes: the **2-node** (1 key, 2 children) and the **3-node** (2 keys, 3 children). A 2-3-**4** tree allows a third: the **4-node** (3 keys, 4 children). Here is the key difference in spirit:

- In a 2-3 tree, a 4-node is **illegal** — it can exist only for an instant during an insert before being split.
- In a 2-3-4 tree, a 4-node is a **legal, permanent** node. You are allowed to *keep* a 4-node in the tree.

Why add it? Two reasons, both of which pay off below:

1. **A slicker insertion.** Because 4-nodes are legal, we can afford to be aggressive and **split full 4-nodes preemptively, on the way down**, before we even reach the leaf. This guarantees there is always room at the bottom, so an insert never has to walk back up to fix a cascade. One downward pass and you are done.
2. **The red-black connection.** A red-black tree represents each 2-3-4 node with one black node plus zero, one, or two red children. The 4-node — black with two red kids — is the heart of that encoding. A red-black tree is *literally a 2-3-4 tree drawn with binary nodes and a color bit*. Understand the 2-3-4 tree and the [red-black tree](../04-red-black/junior.md) stops being a pile of mysterious rotation cases.

```
Plain BST after inserting 1,2,3,4,5:    2-3-4 Tree after inserting 1,2,3,4,5:

1                                                  [2]
 \                                                /   \
  2                                          [1]    [3 . 4 . 5]
   \
    3                                        height = 1, every leaf at depth 1
     \                                       search for anything: at most 2 steps
      4
       \                                     (the BST takes up to 5 steps)
        5

height = 4, degenerate
```

This document teaches you exactly how that machine works.

---

<a name="history"></a>
## 2. History — Bayer & McCreight to Guibas & Sedgewick

The 2-3-4 tree is a member of the **B-tree** family invented by **Rudolf Bayer and Edward McCreight** at Boeing in 1971–72. In B-tree terminology, a 2-3-4 tree is **exactly a B-tree of order 4**: nodes hold between 1 and 3 keys and have between 2 and 4 children. Everything you learn here transfers directly to the [B-tree](../11-b-tree/junior.md), which simply allows hundreds of keys per node to minimize disk reads.

The structure earns its fame from a 1978 paper by **Leonidas Guibas and Robert Sedgewick**, *"A Dichromatic Framework for Balanced Trees."* They showed that a 2-3-4 tree can be **encoded as a binary tree** by coloring nodes red or black: a 3-node becomes a black node with one red child, and a 4-node becomes a black node with two red children. This is the **[red-black tree](../04-red-black/junior.md)** — and it is the balanced tree that almost every standard library actually ships (Java's `TreeMap`, C++'s `std::map`, the Linux kernel's scheduler). The 2-3-4 tree is the conceptual original; the red-black tree is its efficient binary disguise.

So the lineage runs: **2-3 tree** (Hopcroft, 1970) → **B-tree** (Bayer & McCreight, 1972) → **2-3-4 tree** (the order-4 B-tree) → **red-black tree** (Guibas & Sedgewick, 1978, as the binary encoding of the 2-3-4 tree). People rarely implement a raw 2-3-4 tree in production — they implement its red-black disguise — but learning the 2-3-4 tree first makes the red-black tree comprehensible instead of magical.

---

<a name="prerequisites"></a>
## 3. Prerequisites

To read this fluently you should already be comfortable with:

1. **BST mechanics.** `search` and `insert` for an unbalanced binary search tree. See [`09-trees/02-bst`](../02-bst/junior.md).
2. **Why a sorted insertion sequence breaks a vanilla BST** — the degeneration story from the introduction.
3. **Tree vocabulary** — node, child, parent, leaf, root, depth, height, subtree.
4. **Big-O intuition** — what O(log n) versus O(n) means concretely when n = 1,000,000.

It will help enormously, though it is not strictly required, to have read the [**2-3 tree**](../18-two-three-tree/junior.md) file first. The 2-3-4 tree is the next step up, and the two share most of their machinery. Where they differ — chiefly the *top-down* insertion below — this file calls it out explicitly.

You do **not** need to know anything about AVL rotations, red-black colors, or B-trees. The recommended path is: BST → 2-3 tree → **2-3-4 tree** → red-black tree → B-tree. This file is step three.

---

<a name="glossary"></a>
## 4. Glossary

| Term | Definition |
|---|---|
| **2-node** | A node holding **one key** with **two children** (or zero children if a leaf). Identical to a normal BST node. |
| **3-node** | A node holding **two keys** with **three children** (or zero children if a leaf). The keys split the value range into three intervals. |
| **4-node** | A node holding **three keys** with **four children** (or zero if a leaf). In a 2-3-4 tree this is a **legal, permanent** node — unlike in a 2-3 tree, where a 4-node is only a transient overflow. |
| **Full node** | A 4-node. It cannot absorb another key without splitting, so the top-down algorithm splits it *preemptively* on the way down. |
| **Key** | A stored search value. A 2-node has one; a 3-node has two; a 4-node has three (always kept sorted). |
| **Leaf** | A node with no children. In a 2-3-4 tree, leaves can be 2-, 3-, or 4-nodes. **All leaves are at the same depth** — the defining invariant. |
| **Internal node** | Any non-leaf node. It has exactly (number of keys + 1) children. |
| **Split** | Breaking a 4-node into two 2-nodes and pushing its **middle key** up into the parent. |
| **Preemptive split** | Splitting a full 4-node *on the way down* during an insert, before reaching the leaf — the signature move of top-down insertion. |
| **Push up / promote** | Sending the middle key of a split up to the parent, where it becomes a separator. |
| **Separator key** | A key inside an internal node that separates the value ranges of two adjacent children. |
| **Height** | Number of edges on a root-to-leaf path. Because all leaves are equidistant, **every** path has the same length. |
| **Order-4 B-tree** | The formal name for a 2-3-4 tree: nodes hold 1–3 keys and 2–4 children. |
| **Perfectly height-balanced** | Stronger than AVL's "differ by at most 1": all leaf depths are *exactly* equal. |
| **Isomorphic to red-black** | A 2-3-4 tree maps one-to-one onto a red-black tree: 2-node = black; 3-node = black + one red child; 4-node = black + two red children. |

---

<a name="core-concepts"></a>
## 5. Core Concepts — 2-, 3-, and 4-Nodes and the Equal-Depth Invariant

A 2-3-4 tree is a search tree built from exactly three kinds of nodes.

### 5.1 The 2-node

A **2-node** holds one key and has two children. It is identical to an ordinary BST node:

```
        [m]
       /   \
   < m       > m
```

Everything in the left subtree is less than `m`; everything in the right subtree is greater than `m`. Standard BST rule.

### 5.2 The 3-node

A **3-node** holds two keys, `a` and `b` with `a < b`, and has **three** children:

```
        [a . b]
       /   |   \
   < a   a..b   > b
```

- The **left** child holds keys less than `a`.
- The **middle** child holds keys strictly between `a` and `b`.
- The **right** child holds keys greater than `b`.

### 5.3 The 4-node

A **4-node** holds three keys, `a < b < c`, and has **four** children. The three keys carve the number line into four intervals:

```
         [a . b . c]
        /   |   |   \
    < a  a..b  b..c  > c
```

- Child 0 holds keys less than `a`.
- Child 1 holds keys between `a` and `b`.
- Child 2 holds keys between `b` and `c`.
- Child 3 holds keys greater than `c`.

This is the new idea relative to the 2-3 tree. The 4-node is a **legal, permanent** node here. It is also the node we will *split preemptively* during insertion — and the node that becomes "black with two red children" when we encode the tree as a [red-black tree](../04-red-black/junior.md).

### 5.4 The four invariants

A valid 2-3-4 tree satisfies all of these at all times:

1. **Every node is a 2-node, 3-node, or 4-node.** One key with two children, two keys with three children, or three keys with four children — nothing else. Never four keys.
2. **Search-tree ordering holds.** For a 2-node `[m]`: left `< m <` right. For a 3-node `[a . b]`: left `< a <` middle `< b <` right. For a 4-node `[a . b . c]`: child0 `< a <` child1 `< b <` child2 `< c <` child3.
3. **All leaves are at the same depth.** Every path from the root to a leaf has the *exact same length*. This is the balance guarantee.
4. **A node is a leaf, or it has exactly (number of keys + 1) children.** A 2-node leaf has 0 children, a 2-node internal node has 2. A 4-node leaf has 0 children, a 4-node internal node has 4. You never see a "half-attached" node.

Invariant 3 is the one that makes everything fast. The insertion algorithm (next section) is carefully designed so that the only way to grow taller is to grow at the root — uniformly, preserving equal depth.

### 5.5 How tall is a 2-3-4 tree?

Because every internal node has between 2 and 4 children, a tree of height `h` holds:

- **At most** all 4-nodes: each level multiplies the node count by 4, and each node holds 3 keys. Keys ≤ `3 · (4^(h+1) − 1) / 3 = 4^(h+1) − 1`.
- **At least** all 2-nodes (a plain perfect binary tree): keys ≥ `2^(h+1) − 1`.

Inverting: `log₄(n+1) − 1 ≤ h ≤ log₂(n+1) − 1`. So the height is **Θ(log n)**, squeezed between `log₄ n` and `log₂ n`, and in particular `h ≤ log₂ n` always. For `n = 1,000,000` that is roughly 10 to 20 levels — versus up to 1,000,000 for a degenerate BST. That guaranteed bound is the entire payoff.

---

<a name="search"></a>
## 6. Search — Walking 2, 3, or 4 Ways

Searching a 2-3-4 tree is just a BST search with one twist: at each node you compare against **one, two, or three** keys to choose among **two, three, or four** children.

Starting at the root, at each node:

- If the node is a **2-node** `[m]`: `key == m` → found; `key < m` → left child; `key > m` → right child.
- If the node is a **3-node** `[a . b]`: equal to either key → found; `key < a` → left; `a < key < b` → middle; `key > b` → right.
- If the node is a **4-node** `[a . b . c]`: equal to any key → found; `key < a` → child 0; `a < key < b` → child 1; `b < key < c` → child 2; `key > c` → child 3.

If you reach a leaf and the key is not among its keys, it is not in the tree.

### Worked search

Find `15` in this tree:

```
              [10 . 20]
             /    |    \
        [5]  [12 . 15]  [25 . 30]
```

1. Root `[10 . 20]`: `15` is between `10` and `20`, so go to the **middle** child.
2. Middle child `[12 . 15]`: `15 == 15` → **found** at depth 1.

Find `7`:

1. Root `[10 . 20]`: `7 < 10` → go **left**.
2. Left child `[5]`: `7 > 5` → go to its **right** child. But `[5]` is a leaf with no children → **not found.**

Search visits one node per level and does at most three comparisons per node, so it is **O(log n)**.

---

<a name="insertion"></a>
## 7. Insertion — The Top-Down Preemptive Split

This is the part worth slowing down for. The 2-3-4 tree's signature is a **top-down insertion** that does a single downward pass with no cascade back up. The trick is one rule:

> **On the way down from the root to the target leaf, split every full 4-node you meet — *before* descending into it.**

Because you split full nodes proactively, you never arrive at a node that has no room. By the time you reach the leaf, the leaf is guaranteed to be a 2-node or 3-node (it has room for one more key), so the actual insertion is trivial and never overflows. The splitting all happens *on the way down*, so there is no walking back up.

Let us see why that works, piece by piece.

### 7.1 Splitting a 4-node, and why the parent always has room

When you split a 4-node `[a . b . c]`, the middle key `b` is pushed up into the parent and the node becomes two 2-nodes — `[a]` keeping the two left children, `[c]` keeping the two right children:

```
        [a . b . c]                   push b UP
       /  |   |   \                        │
                          ───split───►     ▼
                                        ...[b]...
                                        /        \
                                     [a]          [c]
```

Here is the crucial guarantee that makes top-down insertion work: **the parent always has room for the pushed-up key.** Why? Because as we descend, we split *the parent first* if it was full. By the time we look at a child, we already ensured the parent is **not** a 4-node — it is a 2-node or 3-node, so it has space to absorb one promoted key and become a 3-node or 4-node. The split therefore never cascades. One key goes up; the parent has room; we move on.

(There is one special case: the **root**. If the root itself is a full 4-node, there is no parent to receive the pushed-up key, so we first create a brand-new root above it. We cover that in 7.3.)

### 7.2 Absorbing the pushed-up key into the parent

When a 4-node child splits and pushes its middle key `b` up, the parent absorbs `b` as a new separator and gains the two halves as children:

- **Parent was a 2-node `[m]`** → becomes a 3-node. The split's two halves slot in as adjacent children.
- **Parent was a 3-node `[p . q]`** → becomes a 4-node. The split's two halves slot in.

That is the whole reason we split full nodes *before* descending: it keeps the parent at 2- or 3-node, so absorbing one key can only ever push it to a 3- or 4-node — never to an overflow.

### 7.3 Splitting the root grows the tree

If, at the very start of an insert, the **root** is a full 4-node, split it first: its middle key becomes a brand-new root (a 2-node), and its two halves become that root's children:

```
Root 4-node [a . b . c]          New root [b]
                          ───►    /          \
                               [a]            [c]
```

The tree just gained one level, and **every** leaf is now exactly one edge farther from the root than before — equally. The equal-depth invariant survives. **This is the only way a 2-3-4 tree ever grows taller, and it is why the tree grows at the root rather than the leaves.**

### 7.4 The full top-down algorithm

```
INSERT(key):
    if the root is a 4-node:
        split the root              ← may grow the tree one level
    node = root
    loop:
        # invariant: node is NOT a 4-node (we split it before arriving)
        if node is a leaf:
            add key into node (it has room) → done
        child = the child of node that key belongs in
        if child is a 4-node:
            split child, pushing its middle key up into node
            # node is not full, so it absorbs the key with room to spare
            re-pick child now that node gained a key
        node = child               ← descend one level
```

Notice there is no "walk back up" step at all. Every split happens *as we descend*, and because we always split a full node *before* we enter it, we maintain the invariant "the node I am standing on is never a 4-node." Insertion is therefore **one pass down**, O(log n).

### 7.5 The bottom-up alternative (for context)

There is another, older way to insert, the same one used by the [2-3 tree](../18-two-three-tree/junior.md): descend without splitting anything, add the key to the leaf, and if the leaf overflows into a temporary 4-node, **split it and let the split cascade back up** the path until a node has room (or a new root is made). This **bottom-up** method also works and produces a valid 2-3-4 tree.

So why feature the top-down method? Two reasons:

1. **No second pass.** Top-down finishes in one descent; bottom-up needs a walk back up to handle cascades. With parent pointers or a single pass, top-down is simpler to reason about for this tree.
2. **It mirrors the red-black insert.** The standard red-black insertion is essentially the top-down preemptive split in binary disguise — splitting a 4-node corresponds to a *color flip*, and the rare adjustments correspond to *rotations*. Learning top-down here makes red-black insertion familiar later.

Both methods are correct; the **top-down preemptive split is the canonical method for the 2-3-4 tree**, and it is the one we trace and code below.

---

<a name="worked-example"></a>
## 8. Worked Example — Build a Tree from Scratch

Let us insert the sequence **`1, 2, 3, 4, 5, 6, 7`** — the very sorted sequence that *destroys* a plain BST — using the **top-down** method, and watch the 2-3-4 tree stay perfectly balanced. Draw along on paper; this single trace teaches more than any prose.

### Insert 1
Empty tree → the root is a leaf 2-node.
```
[1]
```

### Insert 2
Root `[1]` is not a 4-node, so no split. It is a leaf with room → absorb `2`.
```
[1 . 2]
```

### Insert 3
Root `[1 . 2]` is a 3-node, not full, so no split. It is a leaf with room → absorb `3`. Now it is a **legal 4-node**.
```
[1 . 2 . 3]
```
A plain BST would already be a 3-node line here. The 2-3-4 tree happily keeps the 4-node.

### Insert 4
**Top-down:** check the root first. The root `[1 . 2 . 3]` **is** a full 4-node, so **split it preemptively**. Middle key `2` becomes a new root; `1` and `3` become children:
```
      [2]
     /   \
   [1]   [3]
```
Now descend from the (new, non-full) root. `4 > 2` → go right to leaf `[3]`. It is a 2-node with room → absorb `4`.
```
      [2]
     /   \
   [1]   [3 . 4]
```
The tree grew at the root. Height is now 1; both leaves at depth 1.

### Insert 5
Root `[2]` is not full → no split. Descend: `5 > 2` → right child `[3 . 4]`. It is a 3-node, **not** full, so no preemptive split. It is a leaf with room → absorb `5`.
```
      [2]
     /   \
   [1]   [3 . 4 . 5]
```
The right leaf is now a legal 4-node. Still height 1.

### Insert 6
Root `[2]` is not full → no split. Descend: `6 > 2`, so the child we want is `[3 . 4 . 5]`. **That child is a full 4-node**, so **split it preemptively** before entering. Middle key `4` pushes up into the root `[2]`, which is a 2-node and absorbs it → `[2 . 4]`:
```
       [2 . 4]
      /   |   \
   [1]  [3]   [5]
```
Now re-pick the child for `6`: `6 > 4` → right child `[5]`, a 2-node leaf with room → absorb `6`.
```
       [2 . 4]
      /   |   \
   [1]  [3]   [5 . 6]
```
No cascade — the split key landed in a parent that had room, exactly as the top-down rule guarantees. Height still 1.

### Insert 7
Root `[2 . 4]` is a 3-node, not full → no split. Descend: `7 > 4` → right child `[5 . 6]`, a 3-node, **not** full → no preemptive split. It is a leaf with room → absorb `7`.
```
       [2 . 4]
      /   |   \
   [1]  [3]   [5 . 6 . 7]
```
A perfectly balanced tree, built from the worst-case sorted input that turns a BST into a 7-node line — and every leaf is at depth 1. Notice how the legal 4-node `[5 . 6 . 7]` lets us absorb keys *without* splitting until we truly need the room, which is exactly what keeps the work low.

> **Try it yourself:** continue inserting `8`. Root `[2 . 4]` is not full, so descend; the child `[5 . 6 . 7]` *is* a full 4-node, so split it preemptively — `6` pushes up into `[2 . 4]`, making it the 4-node `[2 . 4 . 6]` — then place `8` to the right of `7`. Tracing three or four more inserts on paper cements the split-on-the-way-down reflex permanently.

### A second trace that grows the root via a preemptive split

To see the root split happen *because* of a preemptive split (not just because the root started full), continue the tree above and insert a few more keys until the root itself fills to `[2 . 4 . 6]`. The next insert that needs to pass *through* the root will first split it: middle key `4` becomes a new root, the tree gains a level, and once again every leaf descends by exactly one edge — uniformly. This is the same "grow at the root" behavior you saw in the [2-3 tree](../18-two-three-tree/junior.md).

---

<a name="invariant"></a>
## 9. The Equal-Depth Invariant, Proven by Construction

The equal-depth invariant is not maintained by a separate "rebalance" step the way AVL trees rebalance with rotations. It is maintained **automatically**, as a side effect of *how* keys are inserted. Three observations prove it:

1. **New keys only ever go into existing leaves.** A new key never gets its own new leaf node hung below an existing leaf. So no single path can get longer by adding a key — the leaf just gets fatter (2 → 3 → 4 keys), not deeper.

2. **A split never changes the depth of any leaf.** When a 4-node splits into two 2-nodes, those two nodes sit at the *same level the 4-node was on*. Their children (if any) keep the same depth. The only thing that moves is the middle key, which goes *up* — and a key moving up does not change any leaf's depth.

3. **The only depth change is a root split, and it affects every leaf equally.** When the root splits and a new root appears on top, *every* leaf becomes exactly one edge deeper. Uniformly. The tree gets taller all at once, never in just one branch.

Put together: leaves can only get fatter or get uniformly deeper, never individually deeper. Therefore **all leaves stay at the same depth, forever, no matter what order keys arrive in.** Contrast this with a BST, where each insert grows exactly one path by one node, so the paths drift apart. The 2-3-4 tree's insertion rule makes drift impossible.

This is the single most important idea to carry away. Every balanced tree you will study is some clever encoding of "grow at the root, keep the leaves level."

---

<a name="red-black"></a>
## 10. The Red-Black Correspondence (A Gentle First Look)

Here is the payoff that makes the 2-3-4 tree worth learning even though you will rarely implement one directly: **a 2-3-4 tree is isomorphic to a [red-black tree](../04-red-black/junior.md).** That word "isomorphic" means there is a perfect, structure-preserving, two-way translation. A red-black tree is the **binary encoding** of a 2-3-4 tree.

The translation maps each 2-3-4 node to a small cluster of binary nodes colored black and red:

```
2-node  [m]              →    a single BLACK node m

3-node  [a . b]          →    BLACK b with a RED left child a
                              (or the mirror: BLACK a with RED right child b)

                                    (b)              black
                                   /
                                 (a)                 red

4-node  [a . b . c]      →    BLACK b with TWO RED children a and c

                                    (b)              black
                                   /   \
                                 (a)   (c)           red   red
```

Read that table the other way and the rules of red-black trees fall out naturally:

- **A red node is just "a key glued into its parent's 2-3-4 node."** A 3-node is one black node plus one red partner; a 4-node is one black node plus two red partners. Red links are *internal* to a 2-3-4 node.
- **Black height is uniform** because each 2-3-4 level contributes exactly one black node to every root-to-leaf path. The 2-3-4 tree's equal-leaf-depth invariant becomes the red-black tree's "every path has the same number of black nodes."
- **No two reds in a row** because a 4-node is the biggest a 2-3-4 node gets — black with at most two red kids. Two reds stacked vertically would mean a node with four keys, which is illegal.
- **Splitting a full 4-node corresponds to a color flip.** When red-black insertion recolors a black-with-two-reds cluster, it is doing the 2-3-4 preemptive split: the middle key (black) gets promoted toward the parent (turns red), and the two red children become black 2-nodes.

You do not need to master red-black trees to finish this file. The point at junior level is simply this: **when you learn the red-black tree, you are not learning a new structure — you are learning the binary costume the 2-3-4 tree wears so it can be implemented with ordinary two-child nodes and one color bit.** The full proof of the isomorphism, and the exact mapping of splits to rotations and recolorings, is developed at [`./middle.md`](./middle.md) and senior level.

---

<a name="big-o"></a>
## 11. Big-O Summary

| Operation | Time | Space | Notes |
|---|---|---|---|
| **search** | O(log n) | O(1) iterative / O(log n) recursive | At most 3 comparisons per level |
| **insert (top-down)** | O(log n) | O(1) extra (one pass down) | Split full 4-nodes on the way down; no cascade |
| **delete** | O(log n) | O(log n) | Mirror of insert with merge/borrow (see [`./middle.md`](./middle.md)) |
| **min / max** | O(log n) | O(1) | Walk to leftmost / rightmost leaf |
| **predecessor / successor** | O(log n) | O(log n) | Standard tree traversal |
| **inorder traversal** | O(n) | O(log n) | Visit children and keys in order → sorted output |
| **height** | Θ(log n) | — | `log₄(n+1) − 1 ≤ h ≤ log₂(n+1) − 1` |

For `n = 10⁶`, height is between ~10 and ~20. For `n = 10⁹`, between ~15 and ~30. The worst case **equals** the best case to within a small constant factor — there is no degenerate input. Note the key bound `h ≤ log₂ n`: a 2-3-4 tree is never taller than a *perfectly* balanced binary tree, which is precisely why its red-black encoding has height at most `2 · log₂ n`.

---

<a name="analogies"></a>
## 12. Real-World Analogies

### 12.1 The expanding filing folder with a "clear the aisle first" rule

Picture an accordion folder where each pocket holds up to three documents. The top-down rule is: *before* you walk down to file a new document, you check each pocket on the path — and any pocket that is already full (three documents) you **split right then**, labeling a new divider tab with the middle document's name and sliding it up to the shelf above. Because you cleared every full pocket on the way down, the pocket you finally reach always has room. You never have to backtrack up the cabinet to fix an overflow. That "split full pockets as you descend" discipline is the top-down preemptive split.

### 12.2 Corporate reorg that promotes preemptively

A manager can supervise up to four reports (a 4-node). Before assigning a new hire down a chain of command, HR walks the chain top-down and **proactively** reorganizes any team that is already at four — promoting the middle person to a new manager one level up. By the time the new hire reaches the bottom team, that team has room. Nobody's reporting chain ends up mysteriously longer than anyone else's, because the only way the org gets taller is a reorg at the very top that pushes *everyone* down one rung at once.

### 12.3 The always-level bookshelf

Every book must sit exactly the same number of shelves above the floor; you can never make one column taller than another. The only way to add height is to lift the **entire** shelf assembly and slide a new floor underneath. That constraint — *the leaves stay level; growth happens at the root, uniformly* — is precisely the equal-depth invariant.

---

<a name="pros-cons"></a>
## 13. Pros and Cons — vs Plain BST and vs 2-3 Tree

### Versus a plain BST

**Pros**
- **Guaranteed O(log n)** for search, insert, and delete. No degenerate input exists — sorted, reverse-sorted, and random data all produce a balanced tree.
- **Perfectly height-balanced.** Stronger than AVL's "heights differ by at most 1": *all* leaves are at the *exact same* depth.
- **Insertion is a clean single downward pass.** The top-down preemptive split means no walking back up to fix cascades — simpler control flow than the cascade-up insert.
- **The gateway to red-black and B-trees.** Once you understand this, the [red-black tree](../04-red-black/junior.md) is "this tree, encoded in binary with a color bit," and the [B-tree](../11-b-tree/junior.md) is "this tree with hundreds of keys per node to fit a disk page."

**Cons**
- **Three node shapes complicate the code.** Every operation must branch on "2-, 3-, or 4-node?" — fiddlier than a uniform binary node, which is exactly why red-black trees (the binary encoding) are usually preferred in production.
- **Deletion is genuinely harder than insertion.** Borrowing and merging underflowing nodes has more cases than splitting.
- **Poor cache/disk locality.** With at most three keys per node, a 2-3-4 tree has nearly as many nodes as a binary tree. Production disk indexes use high-fanout B-trees instead.

### Versus a 2-3 tree

The 2-3-4 tree and the [2-3 tree](../18-two-three-tree/junior.md) are close cousins; choosing between them at junior level is mostly about *which balanced tree you are trying to understand next*.

| Aspect | 2-3 tree | 2-3-4 tree |
|---|---|---|
| Node shapes | 2-node, 3-node | 2-node, 3-node, **4-node** |
| B-tree order | 3 | 4 |
| 4-node status | Illegal (transient only) | **Legal, permanent** |
| Canonical insert | Insert at leaf, **cascade splits up** | **Split full nodes top-down**, no cascade |
| Encodes as | Left-leaning red-black tree (Sedgewick) | Classic red-black tree (Guibas–Sedgewick) |
| Height bound | `log₃ n ≤ h ≤ log₂ n` | `log₄ n ≤ h ≤ log₂ n` (slightly shorter) |

The practical headline: **the 2-3-4 tree maps onto the *classic* red-black tree** that your standard library ships, which is the main reason it is taught. The 2-3 tree maps onto the *left-leaning* red-black variant. If your goal is to understand `TreeMap` / `std::map`, the 2-3-4 tree is the more directly relevant model. The 2-3 tree, with only two node shapes, is marginally simpler to reason about as a *first* balanced tree — which is why the recommended path visits it first.

### When to reach for what
- Need an **ordered in-memory map** in production? Use a red-black tree (it is what your language's standard library ships). It is a 2-3-4 tree under the hood.
- Storing data **on disk** or larger than cache? Use a [B-tree / B+ tree](../11-b-tree/junior.md).
- **Learning how the standard-library balanced tree works**? The 2-3-4 tree is the model to study — and that is exactly what you are doing now.

---

<a name="deletion"></a>
## 14. A Note on Deletion

Deletion in a 2-3-4 tree is the mirror image of insertion, and it is **harder** — which is why we keep it light at this level and give it full treatment in [`./middle.md`](./middle.md).

The intuition: insertion's problem is **overflow** (a node gets too many keys), fixed by **splitting** and **pushing up**. Deletion's problem is the opposite — **underflow** (a node would be left with no keys), fixed by **borrowing** a key from a sibling or **merging** with one.

There is a pleasing top-down version of delete too: just as insert splits full 4-nodes on the way down so the leaf always has room, delete **ensures every node on the path has at least two keys** on the way down (by borrowing or merging preemptively), so that removing a key from the leaf never causes an underflow. A quick sketch:

1. **If the key to delete is in an internal node**, swap it with its **in-order predecessor or successor** (which lives in a leaf), so the actual removal happens at a leaf — the same trick you used for [BST deletion](../02-bst/junior.md).
2. **On the way down, keep every visited node from being a bare 2-node:** if the next node you would enter has only one key, **borrow** a key from a sibling (rotate one through the parent) or **merge** it with a sibling and a key pulled down from the parent.
3. **Remove the key from the leaf**, which now safely has a spare.
4. **A merge that empties the root** removes the root and promotes its single child — **the tree shrinks one level, uniformly**, the exact mirror of a root split during insert.

Notice the symmetry: insert splits full nodes top-down and grows at the root; delete fattens thin nodes top-down and shrinks at the root. Both keep all leaves at equal depth. The full case analysis lives in [`./middle.md`](./middle.md).

---

<a name="code-examples"></a>
## 15. Code Examples — Go, Java, Python

Below is a clear, correct implementation of the **node model**, **search**, and **top-down insertion** in all three languages. At junior level we favor **clarity over cleverness**: a node is modeled explicitly as "1–3 keys, 0 or (keys+1) children," and insertion does one downward pass, splitting any full 4-node *before* descending into it. We split the root up front (with a parent pointer in hand for the rest of the path), which keeps the code a single clean loop with no recursion and no cascade.

### 15.1 Python

```python
class Node:
    """A 2-3-4 tree node: 1-3 keys, and 0 or (len(keys)+1) children."""
    __slots__ = ("keys", "children")

    def __init__(self, keys=None, children=None):
        self.keys = keys or []              # 1, 2, or 3 keys, sorted
        self.children = children or []      # [] for a leaf; else len(keys)+1

    def is_leaf(self):
        return len(self.children) == 0

    def is_full(self):
        return len(self.keys) == 3          # a 4-node


class TwoThreeFourTree:
    def __init__(self):
        self.root = Node()                  # empty tree = empty leaf node

    # ------------------------------- search -------------------------------
    def search(self, key):
        node = self.root
        while node is not None:
            i = 0
            while i < len(node.keys) and key > node.keys[i]:
                i += 1
            if i < len(node.keys) and key == node.keys[i]:
                return True
            if node.is_leaf():
                return False
            node = node.children[i]
        return False

    # ------------------------------- insert -------------------------------
    def insert(self, key):
        # 1. If the root is a full 4-node, split it first → tree grows a level.
        if self.root.is_full():
            new_root = Node()
            new_root.children.append(self.root)
            self._split_child(new_root, 0)
            self.root = new_root

        # 2. Single downward pass, splitting any full child before descending.
        node = self.root
        while True:
            # pick the child index for key
            i = 0
            while i < len(node.keys) and key > node.keys[i]:
                i += 1
            if i < len(node.keys) and key == node.keys[i]:
                return                       # duplicate: ignore

            if node.is_leaf():
                node.keys.insert(i, key)     # room is guaranteed
                return

            if node.children[i].is_full():
                self._split_child(node, i)   # split before descending
                if key > node.keys[i]:       # the pushed-up key may shift us right
                    i += 1
            node = node.children[i]

    @staticmethod
    def _split_child(parent, i):
        """Split parent.children[i], a full 4-node, pushing its middle key up
        into parent at position i. Parent is guaranteed not full."""
        full = parent.children[i]
        lo, mid, hi = full.keys
        left = Node([lo])
        right = Node([hi])
        if not full.is_leaf():
            left.children = full.children[0:2]
            right.children = full.children[2:4]
        parent.keys.insert(i, mid)
        parent.children[i] = left
        parent.children.insert(i + 1, right)
```

### 15.2 Go

```go
package twothreefour

// Node is a 2-3-4 tree node: 1-3 keys, and 0 or len(keys)+1 children.
type Node struct {
    keys     []int
    children []*Node // empty for a leaf; else len(keys)+1 children
}

func (n *Node) isLeaf() bool { return len(n.children) == 0 }
func (n *Node) isFull() bool { return len(n.keys) == 3 } // a 4-node

// Tree is the 2-3-4 tree.
type Tree struct {
    root *Node
}

func NewTree() *Tree { return &Tree{root: &Node{}} }

// ------------------------------- search -------------------------------

func (t *Tree) Search(key int) bool {
    node := t.root
    for node != nil {
        i := 0
        for i < len(node.keys) && key > node.keys[i] {
            i++
        }
        if i < len(node.keys) && key == node.keys[i] {
            return true
        }
        if node.isLeaf() {
            return false
        }
        node = node.children[i]
    }
    return false
}

// ------------------------------- insert -------------------------------

func (t *Tree) Insert(key int) {
    // 1. Split a full root first → the tree grows one level.
    if t.root.isFull() {
        newRoot := &Node{children: []*Node{t.root}}
        splitChild(newRoot, 0)
        t.root = newRoot
    }

    // 2. One downward pass, splitting any full child before descending.
    node := t.root
    for {
        i := 0
        for i < len(node.keys) && key > node.keys[i] {
            i++
        }
        if i < len(node.keys) && key == node.keys[i] {
            return // duplicate: ignore
        }

        if node.isLeaf() {
            node.keys = insertIntAt(node.keys, i, key) // room is guaranteed
            return
        }

        if node.children[i].isFull() {
            splitChild(node, i) // split before descending
            if key > node.keys[i] {
                i++ // pushed-up key may shift us to the right half
            }
        }
        node = node.children[i]
    }
}

// splitChild splits parent.children[i] (a full 4-node), pushing its middle key
// up into parent. parent is guaranteed not full.
func splitChild(parent *Node, i int) {
    full := parent.children[i]
    lo, mid, hi := full.keys[0], full.keys[1], full.keys[2]

    left := &Node{keys: []int{lo}}
    right := &Node{keys: []int{hi}}
    if !full.isLeaf() {
        left.children = []*Node{full.children[0], full.children[1]}
        right.children = []*Node{full.children[2], full.children[3]}
    }

    parent.keys = insertIntAt(parent.keys, i, mid)
    parent.children[i] = left
    parent.children = insertChildAt(parent.children, i+1, right)
}

func insertIntAt(s []int, idx, v int) []int {
    s = append(s, 0)
    copy(s[idx+1:], s[idx:])
    s[idx] = v
    return s
}

func insertChildAt(s []*Node, idx int, v *Node) []*Node {
    s = append(s, nil)
    copy(s[idx+1:], s[idx:])
    s[idx] = v
    return s
}
```

### 15.3 Java

```java
import java.util.ArrayList;
import java.util.List;

public class TwoThreeFourTree {

    /** A 2-3-4 tree node: 1-3 keys, and 0 or (keys+1) children. */
    static final class Node {
        final List<Integer> keys = new ArrayList<>();   // 1-3 keys, sorted
        final List<Node> children = new ArrayList<>();  // empty, or keys+1

        boolean isLeaf() { return children.isEmpty(); }
        boolean isFull() { return keys.size() == 3; }   // a 4-node
    }

    private Node root = new Node();   // empty tree = empty leaf node

    // ------------------------------- search -------------------------------

    public boolean search(int key) {
        Node node = root;
        while (node != null) {
            int i = 0;
            while (i < node.keys.size() && key > node.keys.get(i)) i++;
            if (i < node.keys.size() && key == node.keys.get(i)) return true;
            if (node.isLeaf()) return false;
            node = node.children.get(i);
        }
        return false;
    }

    // ------------------------------- insert -------------------------------

    public void insert(int key) {
        // 1. Split a full root first → the tree grows one level.
        if (root.isFull()) {
            Node newRoot = new Node();
            newRoot.children.add(root);
            splitChild(newRoot, 0);
            root = newRoot;
        }

        // 2. One downward pass, splitting any full child before descending.
        Node node = root;
        while (true) {
            int i = 0;
            while (i < node.keys.size() && key > node.keys.get(i)) i++;
            if (i < node.keys.size() && key == node.keys.get(i)) return; // dup

            if (node.isLeaf()) {
                node.keys.add(i, key);    // room is guaranteed
                return;
            }

            if (node.children.get(i).isFull()) {
                splitChild(node, i);      // split before descending
                if (key > node.keys.get(i)) i++; // may shift to the right half
            }
            node = node.children.get(i);
        }
    }

    /** Split parent.children[i] (a full 4-node), pushing its middle key up.
        parent is guaranteed not full. */
    private static void splitChild(Node parent, int i) {
        Node full = parent.children.get(i);
        int lo = full.keys.get(0), mid = full.keys.get(1), hi = full.keys.get(2);

        Node left = new Node();
        Node right = new Node();
        left.keys.add(lo);
        right.keys.add(hi);
        if (!full.isLeaf()) {
            left.children.add(full.children.get(0));
            left.children.add(full.children.get(1));
            right.children.add(full.children.get(2));
            right.children.add(full.children.get(3));
        }

        parent.keys.add(i, mid);
        parent.children.set(i, left);
        parent.children.add(i + 1, right);
    }
}
```

### 15.4 Why this shape of code?

The whole algorithm is **one loop with no recursion and no second pass**. The single helper, `splitChild(parent, i)`, splits a full child and hands its middle key to the parent — and we only ever call it when the *parent* has room, so it can never fail. We split the root up front so that, inside the loop, the node we are standing on is never full; that one precondition is what lets the loop descend without ever looking back up.

This is exactly the **CLRS B-tree insertion** specialized to order 4. When you reach the [B-tree](../11-b-tree/junior.md), you will recognize this code with the constant `3` replaced by `2t − 1`. Top-down preemptive splitting is the standard way to insert into any B-tree, and the 2-3-4 tree is the smallest one where it shows its whole shape.

---

<a name="patterns"></a>
## 16. Coding Patterns

### 16.1 Split the root first, then never look up again

Splitting a full root *before* the descent is the trick that makes the main loop trivial. After that one check, the loop maintains the invariant "the current node is not full," so every child split lands in a parent with room. No cascade, no recursion, no parent stack. Internalize this: **establish the precondition once at the top, then preserve it on every step down.**

### 16.2 Split-on-the-way-down (preemptive splitting)

The defining pattern of B-tree-family inserts: when about to descend into a **full** child, split it first. It guarantees the leaf has room and turns insertion into a single pass. It also maps directly to the red-black **color-flip-on-the-way-down** of top-down red-black insertion.

### 16.3 Branch on key count, not on a node "type" flag

The code never stores an `isThreeNode` boolean. It checks `len(keys)`: one key is a 2-node, two a 3-node, three a 4-node. Deriving the node "type" from `len(keys)` keeps the invariant `len(children) == len(keys) + 1` self-evident and removes a field that could drift out of sync.

### 16.4 The "find the child index" inner loop

Choosing which child to descend into — scanning keys until `key ≤ keys[i]` — is the one piece of logic search, insert, and delete all share. Keep it identical everywhere; a bug here corrupts every operation. Remember to re-pick the index after a preemptive split, because the pushed-up key may shift the target to the right half.

---

<a name="common-mistakes"></a>
## 17. Common Mistakes

1. **Forgetting to re-pick the child index after a preemptive split.** When you split a full child, its middle key is pushed up into the current node *at the same index*. The key you are inserting might now belong on the **right** half, so you must compare against the newly promoted key and possibly increment the index. Skip this and keys land in the wrong subtree.
2. **Splitting into the parent when the parent is full.** The entire point of top-down splitting is that you split full nodes *before* entering them, so the parent always has room. If you ever call the split helper with a full parent, your precondition is broken — usually because you forgot to split the root first.
3. **Pushing up the wrong key on a split.** The **middle** key of the three goes up; the smallest and largest stay as the two new 2-nodes. Pushing up the smallest or largest scrambles the ordering.
4. **Forgetting to distribute the four children when splitting an internal 4-node.** A split of an internal node must hand children `[c0, c1]` to the left half and `[c2, c3]` to the right half. Drop or duplicate a child and the tree corrupts silently.
5. **Hanging a new leaf below an existing leaf** instead of inserting the key *into* the leaf. This is the BST reflex, and it instantly breaks the equal-depth invariant. New keys go *into* a leaf, never *below* it.
6. **Forgetting the new-root case.** When the root is a full 4-node, you must create a brand-new root above it before descending. Skip this and the root has nowhere to push its middle key. This is the *only* place the tree's height increases.
7. **Comparing against only one key in a 3- or 4-node during search.** A 4-node needs up to three comparisons. Stopping early sends searches down the wrong child.
8. **Mishandling duplicates.** Decide a policy explicitly — ignore, count, or store a list per key — and check for the duplicate *as you scan keys*, as the sample code does.
9. **Confusing the 2-3 tree's rules with the 2-3-4 tree's.** In a [2-3 tree](../18-two-three-tree/junior.md), a 4-node is illegal and splits happen *bottom-up via cascade*. In a 2-3-4 tree, the 4-node is legal and the canonical insert splits *top-down preemptively*. Mixing the two produces subtle bugs.

---

<a name="edge-cases"></a>
## 18. Edge Cases

| Case | Expected behavior |
|---|---|
| Empty tree, search | Return false / not found. |
| Empty tree, insert | Root (an empty leaf) gains its first key, becoming a 2-node. |
| Insert into a 2-node leaf | Becomes a 3-node. No split. |
| Insert into a 3-node leaf | Becomes a legal 4-node. No split. |
| Insert into a 4-node leaf | The 4-node was split *on the way down*, so by the time you reach it there is room. Height may have grown if the split chain reached the root. |
| Root is a full 4-node at the start of an insert | Split it first → new root, **height grows by 1**, every leaf one edge deeper. |
| Insert a duplicate key | Default: ignore. Decide and document the policy. |
| Sorted ascending inserts `1,2,3,…` | Stays perfectly balanced; height grows ~`log n` via periodic root splits. **This is the input that destroys a BST.** |
| Sorted descending inserts | Same — balanced. The 2-3-4 tree is order-insensitive. |
| Search for a key smaller than everything | Walk leftmost children to a leaf, return not found. |
| Search for a key larger than everything | Walk rightmost children to a leaf, return not found. |

---

<a name="cheat-sheet"></a>
## 19. Cheat Sheet

```
NODE SHAPES (all three LEGAL and permanent)
    2-node: [m]            1 key,  2 children   (left < m < right)
    3-node: [a . b]        2 keys, 3 children   (l < a < m < b < r)
    4-node: [a . b . c]    3 keys, 4 children   (c0 < a < c1 < b < c2 < c < c3)

INVARIANTS
    Every node is a 2-, 3-, or 4-node (never 4 keys)
    Search ordering holds at every node
    ALL leaves at the same depth        ← the balance guarantee
    A node is a leaf, or it has exactly (#keys + 1) children

SEARCH
    At each node compare against 1-3 keys, descend into the matching interval.
    Reach a leaf without a match → not found.

INSERT (TOP-DOWN, the canonical method)
    1. If the ROOT is a full 4-node, split it → new root (tree grows a level).
    2. Walk down. Before descending into any FULL 4-node child, SPLIT it:
         push its MIDDLE key up into the (guaranteed non-full) parent,
         leaving two 2-nodes. Re-pick the child (the pushed-up key may
         shift you to the right half).
    3. The leaf you reach always has room → insert the key there. Done.
    (No cascade back up — all splitting happens on the way down.)

SPLIT a 4-node [lo . mid . hi]
    mid   → pushed up to the parent (separator)
    [lo]  → new 2-node, keeps children c0, c1
    [hi]  → new 2-node, keeps children c2, c3

HEIGHT
    log₄(n+1) − 1  ≤  h  ≤  log₂(n+1) − 1    → Θ(log n),  h ≤ log₂ n

COMPLEXITY
    search / insert / delete: O(log n) guaranteed, no degenerate input

RED-BLACK CORRESPONDENCE (isomorphic!)
    2-node = BLACK
    3-node = BLACK + one RED child
    4-node = BLACK + two RED children
    → a red-black tree IS a 2-3-4 tree in binary disguise.

RELATIONSHIPS
    2-3-4 tree   = B-tree of order 4
    2-3-4 tree   = the tree a classic red-black tree encodes with color bits
```

---

<a name="animation"></a>
## 20. Visual Animation Reference

See `animation.html` in this folder. Insert keys one at a time and watch:

- A **2-node turn into a 3-node, then into a 4-node** as it absorbs keys without splitting — the 4-node is allowed to stay.
- A **full 4-node flash and split *on the way down*** during an insert: its middle key **slides up** into the (non-full) parent, leaving two 2-nodes, *before* the search continues downward.
- A **root split** grow the whole tree one level and push every leaf down in unison.
- Optionally, a **red-black overlay** that colors the 2-3-4 nodes (black trunk, red glued-in partners) so you can watch a 4-node become "black with two red children" — the isomorphism made visible.
- The stats panel reports height, key count, and the counts of 2-, 3-, and 4-nodes.

The recommended demo is the sorted sequence from §8 — **`1, 2, 3, 4, 5, 6, 7`** — side by side with a plain BST built from the same input. Watch the BST stretch into a 7-node line while the 2-3-4 tree stays a flat, two-level tree. That contrast is the entire lesson in one animation.

---

<a name="summary"></a>
## 21. Summary

- A **2-3-4 tree** is a perfectly height-balanced search tree where every node is a **2-node** (1 key, 2 children), a **3-node** (2 keys, 3 children), or a **4-node** (3 keys, 4 children), and **all leaves sit at exactly the same depth**. It is precisely a **B-tree of order 4**.
- **Search** walks down the tree comparing against one to three keys per node to pick among two to four children — O(log n).
- **Insertion (top-down, the canonical method)** makes one downward pass and **splits every full 4-node it meets *before* descending into it**. Because the parent is always cleared of fullness first, the pushed-up middle key always has room, so the insert **never cascades back up**. When the *root* is a full 4-node, it is split first and the tree grows one level — uniformly.
- A **bottom-up** insert (insert at the leaf, then cascade splits upward, as in the [2-3 tree](../18-two-three-tree/junior.md)) is also valid, but the **top-down preemptive split** is the standard method here and is the one that mirrors red-black insertion.
- The equal-depth invariant is maintained **for free**: keys only ever enter leaves, splits never change any leaf's depth, and the only height change is a root split that deepens *every* leaf at once.
- Height is **Θ(log n)** (between `log₄ n` and `log₂ n`), so search, insert, and delete are all **O(log n)** with no degenerate input.
- **Deletion** mirrors insertion: underflow is fixed by **borrowing** or **merging**, and an emptied root shrinks the tree one level. Full details in [`./middle.md`](./middle.md).
- The headline reason to learn the 2-3-4 tree is the **red-black correspondence**: a [red-black tree](../04-red-black/junior.md) is a 2-3-4 tree encoded in binary with one color bit per node (2-node = black; 3-node = black + one red; 4-node = black + two reds). Master this tree and the red-black tree — the balanced tree inside your standard library — stops being mysterious.

Next: [`./middle.md`](./middle.md) covers full top-down deletion with borrow/merge case analysis, the formal isomorphism to red-black trees (splits ↔ recolorings, the rare adjustment ↔ rotations), the order-4 B-tree equivalence, and proofs of the height bounds.

---

<a name="further-reading"></a>
## 22. Further Reading

- **Cormen, Leiserson, Rivest, Stein (CLRS).** *Introduction to Algorithms*, 3rd ed., MIT Press, 2009. Chapter 18 ("B-Trees") presents the top-down, split-full-nodes-on-the-way-down insertion this file uses; the 2-3-4 tree is the order-4 case (`t = 2`).
- **Sedgewick, R. & Wayne, K.** *Algorithms*, 4th ed., Addison-Wesley, 2011. Section 3.3 develops balanced trees and the red-black correspondence; the clearest demonstration that red-black trees *are* 2-3-4 (and 2-3) trees.
- **Guibas, L. J. & Sedgewick, R.** (1978). *A Dichromatic Framework for Balanced Trees.* The paper that introduced red-black trees as the binary encoding of 2-3-4 trees — the source of the isomorphism in §10.
- **Bayer, R. & McCreight, E. M.** (1972). *Organization and maintenance of large ordered indexes.* Acta Informatica 1(3), 173–189. The B-tree paper; the 2-3-4 tree is its order-4 member.
- **Knuth, D. E.** *The Art of Computer Programming, Volume 3: Sorting and Searching*, 2nd ed., Addison-Wesley, 1998. Section 6.2.4 treats multiway balanced trees with full mathematical depth.
- Compare with the sibling [`../18-two-three-tree/junior.md`](../18-two-three-tree/junior.md) (two node shapes, cascade-up insert) and continue to [`./middle.md`](./middle.md) for deletion, the red-black equivalence, and the height-bound proofs.
