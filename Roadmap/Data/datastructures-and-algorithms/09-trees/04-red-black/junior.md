# Red-Black Tree — Junior Level

> **Read time: ~45 minutes** · **Audience:** Engineers comfortable with BSTs and rotations (see `02-bst` and `03-avl`) who want to understand the balanced tree used by `std::map`, Java `TreeMap`, and the Linux kernel.

A Red-Black Tree (RB tree) is a self-balancing binary search tree where every node carries one extra bit of information — a color, either **red** or **black** — and four global invariants on those colors guarantee the tree stays within a factor of 2 of optimal height. The result is a structure that supports **insert, delete, lookup, predecessor, successor, range, rank, and ordered traversal all in O(log n) worst case**, with cache-friendly node sizes and far fewer rotations on update than AVL.

That last property — *fewer rotations* — is the reason the world's most performance-critical ordered containers chose red-black over AVL: `std::map` and `std::set` in libstdc++, `TreeMap`/`TreeSet` in Java, the Linux kernel's CFS scheduler runqueue, the per-process virtual memory area (VMA) tree, ext3/4 directory hashes, and the `epoll` interest set. Every time you call `std::map::insert` you are running the algorithm in this document.

This file teaches red-black trees **deeply enough that you can read CLRS chapter 13 and the Linux `rbtree.c` source without surprise**. We cover the 5 invariants, why they bound height, all 6 insertion fixup cases (and their mirror images), the analogous deletion fixup cases, a sentinel-NIL implementation pattern that drastically simplifies the code, and the typical bugs juniors hit when they try to write it from memory.

---

## Table of Contents

1. [Introduction — Why Not Just Use AVL?](#introduction)
2. [History — Bayer 1972, Guibas & Sedgewick 1978](#history)
3. [Prerequisites](#prerequisites)
4. [Glossary](#glossary)
5. [Core Concepts — The 5 Properties](#properties)
6. [Why Height ≤ 2·log₂(n+1)](#height-bound)
7. [Big-O Summary](#big-o)
8. [Real-World Analogies](#analogies)
9. [Pros and Cons vs AVL](#vs-avl)
10. [Step-by-Step Walkthrough — Insert 10, 20, 30, 15, 25](#walkthrough)
11. [Code — Go, Java, Python](#code)
12. [Coding Patterns — The Sentinel-NIL Trick](#patterns)
13. [Error Handling](#errors)
14. [Performance Tips](#performance)
15. [Best Practices](#best-practices)
16. [Edge Cases](#edge-cases)
17. [Common Mistakes](#mistakes)
18. [Cheat Sheet](#cheat-sheet)
19. [Animation Reference](#animation)
20. [Summary](#summary)
21. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Why Not Just Use AVL?

You already know an AVL tree: at every node, `|height(left) - height(right)| ≤ 1`. The tree is **strictly** balanced, so lookup is fast — at most ~1.44 · log₂(n) comparisons in the worst case.

The cost of that strictness is **rotation pressure on updates**. Every insertion in an AVL tree may walk back up to the root and rotate at each ancestor whose balance factor moved out of range. Deletes can be even worse — a single deletion in AVL may cascade rotations all the way to the root, performing O(log n) rotations in the worst case.

Red-black trees relax the height constraint from "1.44 · log₂(n)" to "2 · log₂(n+1)". That is a ~40 % taller tree in the worst case, but the payoff is dramatic:

- **An insertion in an RB tree performs at most 2 rotations**, after which any further corrections are *recolorings* — pointer-free O(1) flips of a color bit.
- **A deletion in an RB tree performs at most 3 rotations.**
- The total number of color changes during an insertion is amortized O(1) — proved by an accounting argument on potential.

So you trade a slightly taller tree (irrelevant — lookup is still O(log n) and the cache miss count grows by a tiny constant) for **dramatically cheaper writes**. On workloads that are read-heavy but not read-only — caches with eviction, scheduler runqueues, in-memory indexes, kernel VMA maps — RB trees win convincingly.

Concretely, that is why every general-purpose ordered map in mainstream standard libraries is a red-black tree:

| Library / system | Container | Year |
|---|---|---|
| C++ STL (libstdc++, MSVC, libc++) | `std::map`, `std::set`, `std::multimap`, `std::multiset` | ~1998 |
| Java JDK | `TreeMap`, `TreeSet`, `ConcurrentSkipListMap` uses skip lists instead | 1998 |
| Java JDK 8+ | `HashMap` per-bucket structure when bucket size ≥ 8 | 2014 |
| Linux kernel | `rbtree.h` — CFS scheduler, VMAs, ext3/4 htree, epoll, cgroups | continuously since 2005 |
| PostgreSQL | `RBTree` for prefetch buffer reservation | various |
| .NET BCL | `SortedDictionary<K,V>`, `SortedSet<T>` | 2008 |

You will spend a significant fraction of your career writing code that, somewhere underneath, ends up calling into a red-black tree. Understanding it well changes how you reason about performance.

---

<a name="history"></a>
## 2. History — Bayer 1972, Guibas & Sedgewick 1978

The structure is older than the name. In 1972, **Rudolf Bayer** published *"Symmetric binary B-trees: Data structure and maintenance algorithms"* (Acta Informatica). He was looking for a way to represent a **2-3-4 tree** (a B-tree of order 4) inside a binary tree, by encoding the "3-node" and "4-node" multi-key nodes as small clusters of binary nodes joined by a special kind of link. Bayer called them *symmetric binary B-trees*.

Six years later, in 1978, **Leonidas Guibas and Robert Sedgewick** published *"A dichromatic framework for balanced trees"* (FOCS) and renamed the special link to "red" (and the ordinary one to "black"). The dichromatic (two-color) framing made the invariants easier to state and the proofs cleaner, and the name **red-black tree** stuck.

You still see the 2-3-4 origin everywhere in the algorithm:

- A red link is exactly the way to draw the second key of a **3-node** in a 2-3-4 tree as a child link instead of a horizontal one.
- A node with two red children is exactly a **4-node**.
- The deletion algorithm's "double black" sentinel is the binary-tree shadow of the 2-3-4 merge operation.

We will use this 2-3-4 mental model in `middle.md` to justify Sedgewick's Left-Leaning Red-Black variant, which got the implementation down from ~80 lines (CLRS) to ~30.

In 2008, Sedgewick published *"Left-leaning Red-Black Trees"* — a constraint that every red link must be a left child — and showed it cuts the case analysis in half. CLRS chapter 13 still teaches the symmetric ("regular") version because that is what the Linux kernel, `std::map`, and `TreeMap` actually implement.

---

<a name="prerequisites"></a>
## 3. Prerequisites

Before reading this, you should be comfortable with:

1. **Binary Search Tree property** — for every node `x`, all keys in `left(x)` are `< x.key`, all keys in `right(x)` are `> x.key`. Covered in `02-bst`.
2. **BST insert and delete (without rebalancing).** You should be able to write these blindfolded.
3. **Left rotation and right rotation.** Pointer surgery preserving the BST order. Covered in `03-avl`.
4. **Tree height and big-O.** Why height is the relevant cost metric for tree operations.

If any of those is fuzzy, fix it first — every step below assumes them.

A quick rotation refresher (we use it constantly):

```
LEFT-ROTATE(x):                       RIGHT-ROTATE(y):
                                                  
       x                  y                      y               x
      / \                / \                    / \             / \
     a   y     -->      x   c                  x   c   -->     a   y
        / \            / \                    / \                 / \
       b   c          a   b                  a   b               b   c

  (rotates left around x;          (rotates right around y;
   y's left subtree becomes         x's right subtree becomes
   x's right subtree)               y's left subtree)
```

A rotation **preserves the BST order** (the in-order traversal is unchanged) and changes the height of the involved subtree by ±1.

---

<a name="glossary"></a>
## 4. Glossary

| Term | Definition |
|---|---|
| **Red node** | A node whose color attribute is `RED`. Always has a black parent (the red property). |
| **Black node** | A node whose color attribute is `BLACK`. May have a parent of any color. |
| **NIL leaf** | A sentinel node representing "absent child". Every absent left/right child points to NIL. **NIL is always BLACK.** Implementations either use a single shared sentinel object (Linux, libstdc++) or Java `null` plus the convention that `null` is black. |
| **Black-height (bh)** | The number of black nodes on any root-to-NIL path starting **below** a node (not counting the node itself). Property 5 says this number is the same for every path. |
| **Red property** | Property 4. No red node has a red child. Equivalently, on any root-to-NIL path, red nodes are never consecutive. |
| **Root property** | Property 2. The root is always black. After every insert/delete fixup, we re-color the root black to preserve this. |
| **Leaf property** | Property 3. Every NIL is black. With a single shared sentinel this is enforced by construction. |
| **Black-depth** | The number of black nodes on the path from the root **down to** the node (counted from the top). Useful for proofs. |
| **External node** | Another name for NIL leaf. CLRS uses "external"; the Linux kernel uses "NULL or sentinel". |
| **Internal node** | A non-NIL node that holds an actual key. |
| **Fixup** | The procedure that walks up from a newly inserted (or just-deleted) node, fixing any property violations using rotations and recolorings. |
| **Case (1–6)** | A specific local configuration during fixup that determines which rotation/recolor sequence to apply. There are 3 cases for insert and 4 cases for delete, each with a mirror image. |
| **Uncle** | The sibling of a node's parent. Insert fixup branches on the uncle's color. |
| **Sibling** | The other child of a node's parent. Delete fixup branches on the sibling's color and the colors of the sibling's children. |
| **Sentinel** | A real node object that stands in for NIL. Its color is BLACK; its key is undefined; pointers to it can be safely dereferenced (unlike `null`), which simplifies parent-pointer code. |

---

<a name="properties"></a>
## 5. Core Concepts — The 5 Properties

A red-black tree is a BST in which every node is either red or black and the following five properties hold simultaneously:

1. **Property 1 — Color.** Every node is either RED or BLACK.
2. **Property 2 — Root.** The root is BLACK.
3. **Property 3 — Leaves.** Every NIL (external leaf) is BLACK.
4. **Property 4 — Red.** If a node is RED, both of its children are BLACK. (Equivalently: no two consecutive red nodes on any path.)
5. **Property 5 — Black height.** For each node, every simple path from that node to any descendant NIL contains the same number of BLACK nodes.

Properties 1 and 3 are trivial constraints on the representation. Properties 2 is a convenience that simplifies the proofs. The real content is **Property 4 (no red-red)** and **Property 5 (equal black-height)** — together they force the tree to be balanced within a factor of 2.

Here is the smallest tree that satisfies all five properties (besides the empty tree and the single-node tree):

```
           [10 B]
          /      \
       [5 R]   [15 R]
       / \      / \
     NIL NIL  NIL NIL
```

- Property 1: every node colored. ✓
- Property 2: root `10` is black. ✓
- Property 3: NILs are black. ✓
- Property 4: `5` is red, both its children are NIL (black). `15` likewise. No red-red. ✓
- Property 5: every root-to-NIL path passes through `10` (black) plus one NIL (black) = 2 black nodes. Same on every path. ✓

Now picture inserting `7`. The standard BST rule places `7` as the left child of `5`. New nodes are colored RED (we will see why shortly):

```
           [10 B]
          /      \
       [5 R]   [15 R]
       / \      / \
    [7 R] NIL  NIL NIL
       \
       NIL
```

This violates Property 4 — `5` is red and its child `7` is red. The fixup procedure runs to repair it. We will trace the cases in section 10.

---

<a name="height-bound"></a>
## 6. Why Height ≤ 2·log₂(n+1)

The five properties imply a height bound. Here is the standard argument (CLRS Lemma 13.1):

**Claim.** A red-black tree with `n` internal (non-NIL) nodes has height `h ≤ 2·log₂(n + 1)`.

**Step 1 — Black-height bounds size.** Let `bh(x)` be the black-height of node `x` (number of black nodes on any root-to-NIL path below `x`, not counting `x`). By induction on `bh(x)`: a subtree rooted at `x` contains at least `2^bh(x) − 1` internal nodes.

- Base case: `bh(x) = 0` means `x` is a NIL leaf, subtree has 0 internal nodes ≥ `2⁰ − 1 = 0`. ✓
- Inductive step: `x` has two children whose black-heights are at least `bh(x) − 1` each (the child's bh is `bh(x) − 1` if the child is black, `bh(x)` if red — either way ≥ `bh(x) − 1`). By induction each subtree has ≥ `2^{bh(x)−1} − 1` nodes, so the subtree of `x` has ≥ `2 · (2^{bh(x)−1} − 1) + 1 = 2^bh(x) − 1` internal nodes. ✓

**Step 2 — Height bounds black-height.** Property 4 (no red-red) means at least half the nodes on any root-to-NIL path are black. So `bh(root) ≥ h / 2`, where `h` is the tree height.

**Combining.** Let `n` be the number of internal nodes. From step 1, `n ≥ 2^bh(root) − 1`, so `bh(root) ≤ log₂(n + 1)`. From step 2, `h ≤ 2 · bh(root) ≤ 2·log₂(n + 1)`. **Done.**

So for `n = 10⁶`, the height is at most `2·log₂(10⁶ + 1) ≈ 40`. Compare with AVL which gives at most `1.44 · log₂(n) ≈ 29` for the same `n`. The RB tree is up to ~40 % deeper. In practice both round-trip a cache line per node, so the wall-clock difference on lookup is small.

---

<a name="big-o"></a>
## 7. Big-O Summary

| Operation | Worst case | Amortized | Notes |
|---|---|---|---|
| Search | O(log n) | O(log n) | Identical to BST search; ignores colors. |
| Predecessor / Successor | O(log n) | O(1) amortized over a full in-order traversal | Walks at most one path up and one down. |
| Insert | O(log n) | O(log n) for time; **O(1) rotations** | At most 2 rotations; recolorings bounded by tree height but amortized O(1). |
| Delete | O(log n) | O(log n) for time; **O(1) rotations** | At most 3 rotations; recolorings amortized O(1). |
| Min / Max | O(log n) | O(log n) | Walk leftmost / rightmost. |
| Successor of leftmost in iteration | O(1) amortized | over a full traversal | The "successor" function is O(1) amortized but O(log n) worst case per call. |
| Space | O(n) | one byte (or one bit) of color per node + 2 child pointers + key + (optional) parent pointer | |
| Tree height | ≤ 2·log₂(n + 1) | ≈ log₂(n + 1) average | |

The crucial line: **inserts and deletes do at most 2 and 3 rotations respectively**, regardless of `n`. The total work is O(log n) only because of the upward walk and the recolorings — but pointer surgery is rare.

---

<a name="analogies"></a>
## 8. Real-World Analogies

### 8.1 The 2-3-4 tree disguised as a binary tree
A 2-3-4 tree has nodes that hold 1, 2, or 3 keys (and correspondingly 2, 3, or 4 children). A red-black tree represents the same logical structure in a strictly binary tree by "gluing" the extra keys with red links. A red node and its black parent together represent one 3-node in a 2-3-4 tree; a black node with two red children represents one 4-node. The 2-3-4 tree's height is `log₄(n)` ≈ `0.5·log₂(n)`, and gluing each multi-key node uses at most one extra level → red-black height ≤ `2·log₂(n+1)`. The height bound is no accident.

### 8.2 The NIL sentinel as null-object pattern
The single shared NIL sentinel is the **Null Object design pattern** from Gamma et al. Every "missing child" pointer points to the same heap-allocated NIL node, which has color BLACK and undefined key. You can dereference it safely — `nil.color` returns BLACK. This eliminates roughly half the null-checks in the insert/delete fixup procedures.

### 8.3 The traffic-light invariant
Think of the red property as "no two red lights in a row on any road". When a red light replaces an intersection, you must repaint it black or rearrange the road to keep the road still working — that is the fixup. The black-height property is "every road from this intersection to the city limit has the same number of black lights" — the city is uniformly lit.

---

<a name="vs-avl"></a>
## 9. Pros and Cons vs AVL

| Aspect | Red-Black | AVL |
|---|---|---|
| Worst-case height | 2·log₂(n+1) | 1.44·log₂(n) |
| Lookup speed (in cache) | ~40 % more comparisons in worst case | tighter bound |
| Insert rotations (worst) | ≤ 2 | O(log n) |
| Delete rotations (worst) | ≤ 3 | O(log n) |
| Bookkeeping per node | 1 bit (color) | 2 bits or full int (height/balance factor) |
| Implementation complexity | Higher (6 insert cases, 8 delete cases) | Lower (4 rotation cases) |
| Used by `std::map`, Linux | Yes | No |
| Used by databases (B-tree leaves) | No (B-trees instead) | No |
| Best for | Mixed read/write, e.g., schedulers, caches | Read-heavy after bulk build |
| Worst for | Read-only after build | Insert-heavy |

**Rule of thumb:** if your workload mixes reads and writes, red-black wins. If you build once and read many times, AVL's tighter height saves a comparison or two on each lookup. In modern systems with prefetching, branch prediction, and tiered caches, the difference is rarely measurable below 10⁶ nodes.

---

<a name="walkthrough"></a>
## 10. Step-by-Step Walkthrough — Insert 10, 20, 30, 15, 25

We will trace inserts into an empty RB tree, applying the fixup at each step. Color codes: `[x B]` = black, `[x R]` = red. NILs are not drawn.

### Insert 10
The very first node becomes the root. New nodes are inserted RED, then the fixup runs. Since the only red-red violation possible at the root is "the new node is red and its parent is red" — but there is no parent — we just paint the root black.

```
[10 B]
```

### Insert 20
Standard BST: 20 > 10, place as right child of 10, colored red.

```
[10 B]
    \
   [20 R]
```

No violations: parent `10` is black, so the red `20` does not violate property 4. Black-heights match (every NIL below `10` is reached via 1 black node — namely `10` itself's NIL children, and the NIL children of `20` plus `20` is red so they still count 1). Done.

### Insert 30
Standard BST: 30 > 10, then 30 > 20, place as right child of 20, colored red.

```
[10 B]
    \
   [20 R]
       \
      [30 R]
```

Property 4 violated: `20` is red, `30` is red. Run **insert-fixup**.

We are at node `z = 30`. `z.parent = 20` is red. `z.parent.parent = 10`. Uncle = `10.left` = NIL (black). 

This is **Case 3**: `z`'s uncle is black, and `z` is a right child (and `z.parent` is a right child of `z.parent.parent`). The fix:
- Color `z.parent` (20) BLACK.
- Color `z.parent.parent` (10) RED.
- Left-rotate around `z.parent.parent` (10).

After:

```
   [20 B]
   /    \
[10 R]  [30 R]
```

Then we paint the root black (the root must always be black, property 2):

```
   [20 B]
   /    \
[10 R]  [30 R]
```

(`20` was already going to be the new root after the rotation, and we colored it BLACK in the case, so we are done.) All five properties hold. Tree is balanced; height is 2.

### Insert 15
Standard BST: 15 < 20, then 15 > 10, place as right child of 10.

```
   [20 B]
   /    \
[10 R]  [30 R]
    \
   [15 R]
```

`10` is red, `15` is red. Run fixup. `z = 15`. `z.parent = 10` (red). `z.parent.parent = 20`. Uncle = `20.right` = `30` (red).

This is **Case 1**: uncle is red. The fix is pure recoloring (no rotation):
- Color parent (10) BLACK.
- Color uncle (30) BLACK.
- Color grandparent (20) RED.
- Set `z = grandparent` and continue (in case it caused a new violation higher up).

After recolor:

```
   [20 R]
   /    \
[10 B]  [30 B]
    \
   [15 R]
```

Now `z = 20`. Is `z.parent` red? `z` is the root, parent is NIL. Loop exits. Paint root black:

```
   [20 B]
   /    \
[10 B]  [30 B]
    \
   [15 R]
```

All properties hold. Black-height = 2 on every path.

### Insert 25
Standard BST: 25 < 30, place as left child of 30.

```
   [20 B]
   /    \
[10 B]  [30 B]
    \    /
   [15 R] [25 R]
```

Parent of `25` is `30`, which is BLACK. No violation. Done.

Five inserts, one rotation (when inserting 30), three recolorings (when inserting 15). The final tree has the optimal binary-tree height for 5 nodes. This is the typical pattern: most inserts trigger no rotation at all, just a quick recolor walk up the tree.

---

<a name="code"></a>
## 11. Code — Go, Java, Python

We will implement the **CLRS textbook version** (symmetric, parent pointer, single NIL sentinel). The simpler **Left-Leaning** variant is in `middle.md`.

### 11.1 Go — Node type + rotations

```go
package rbtree

type color bool

const (
    red   color = true
    black color = false
)

type Node struct {
    key                 int
    color               color
    left, right, parent *Node
}

// Tree holds the root and the shared NIL sentinel.
type Tree struct {
    root *Node
    nil_ *Node // sentinel: color=black, key undefined
}

func New() *Tree {
    sentinel := &Node{color: black}
    return &Tree{root: sentinel, nil_: sentinel}
}

// leftRotate rotates around x. x's right child becomes its new parent.
//
//      x                 y
//     / \               / \
//    a   y    -->      x   c
//       / \           / \
//      b   c         a   b
func (t *Tree) leftRotate(x *Node) {
    y := x.right
    x.right = y.left
    if y.left != t.nil_ {
        y.left.parent = x
    }
    y.parent = x.parent
    switch {
    case x.parent == t.nil_:
        t.root = y
    case x == x.parent.left:
        x.parent.left = y
    default:
        x.parent.right = y
    }
    y.left = x
    x.parent = y
}

// rightRotate is the mirror image of leftRotate.
func (t *Tree) rightRotate(y *Node) {
    x := y.left
    y.left = x.right
    if x.right != t.nil_ {
        x.right.parent = y
    }
    x.parent = y.parent
    switch {
    case y.parent == t.nil_:
        t.root = x
    case y == y.parent.right:
        y.parent.right = x
    default:
        y.parent.left = x
    }
    x.right = y
    y.parent = x
}
```

### 11.2 Go — Insert and Insert-Fixup

```go
func (t *Tree) Insert(key int) {
    z := &Node{key: key, color: red, left: t.nil_, right: t.nil_, parent: t.nil_}
    y := t.nil_
    x := t.root
    for x != t.nil_ {
        y = x
        if z.key < x.key {
            x = x.left
        } else {
            x = x.right
        }
    }
    z.parent = y
    switch {
    case y == t.nil_:
        t.root = z
    case z.key < y.key:
        y.left = z
    default:
        y.right = z
    }
    t.insertFixup(z)
}

func (t *Tree) insertFixup(z *Node) {
    for z.parent.color == red {
        if z.parent == z.parent.parent.left {
            y := z.parent.parent.right // uncle
            if y.color == red {
                // Case 1: uncle red — recolor and move up
                z.parent.color = black
                y.color = black
                z.parent.parent.color = red
                z = z.parent.parent
            } else {
                if z == z.parent.right {
                    // Case 2: zig-zag — rotate to convert to Case 3
                    z = z.parent
                    t.leftRotate(z)
                }
                // Case 3: zig-zig — recolor and rotate grandparent
                z.parent.color = black
                z.parent.parent.color = red
                t.rightRotate(z.parent.parent)
            }
        } else {
            // Mirror cases when z's parent is a right child
            y := z.parent.parent.left
            if y.color == red {
                z.parent.color = black
                y.color = black
                z.parent.parent.color = red
                z = z.parent.parent
            } else {
                if z == z.parent.left {
                    z = z.parent
                    t.rightRotate(z)
                }
                z.parent.color = black
                z.parent.parent.color = red
                t.leftRotate(z.parent.parent)
            }
        }
    }
    t.root.color = black // property 2: root is always black
}
```

The six cases are: **Case 1, 2, 3** (parent is a left child) and their mirror images when the parent is a right child. CLRS calls all six "Case 1, 2, 3" and selects between the symmetric pair based on `z.parent == z.parent.parent.left`.

### 11.3 Java — Node and Rotation

```java
public final class RBTree<K extends Comparable<K>> {
    private static final boolean RED = true, BLACK = false;

    private static final class Node<K> {
        K key;
        boolean color;
        Node<K> left, right, parent;
        Node(K key, boolean color) { this.key = key; this.color = color; }
    }

    private final Node<K> NIL = new Node<>(null, BLACK); // shared sentinel
    private Node<K> root = NIL;

    public RBTree() {
        NIL.left = NIL.right = NIL.parent = NIL;
    }

    private void leftRotate(Node<K> x) {
        Node<K> y = x.right;
        x.right = y.left;
        if (y.left != NIL) y.left.parent = x;
        y.parent = x.parent;
        if (x.parent == NIL)            root = y;
        else if (x == x.parent.left)    x.parent.left = y;
        else                            x.parent.right = y;
        y.left = x;
        x.parent = y;
    }

    private void rightRotate(Node<K> y) {
        Node<K> x = y.left;
        y.left = x.right;
        if (x.right != NIL) x.right.parent = y;
        x.parent = y.parent;
        if (y.parent == NIL)            root = x;
        else if (y == y.parent.right)   y.parent.right = x;
        else                            y.parent.left = x;
        x.right = y;
        y.parent = x;
    }

    public void insert(K key) {
        Node<K> z = new Node<>(key, RED);
        z.left = z.right = NIL;
        Node<K> y = NIL, x = root;
        while (x != NIL) {
            y = x;
            x = (key.compareTo(x.key) < 0) ? x.left : x.right;
        }
        z.parent = y;
        if (y == NIL)                          root = z;
        else if (key.compareTo(y.key) < 0)     y.left = z;
        else                                   y.right = z;
        insertFixup(z);
    }

    private void insertFixup(Node<K> z) {
        while (z.parent.color == RED) {
            if (z.parent == z.parent.parent.left) {
                Node<K> y = z.parent.parent.right;
                if (y.color == RED) {                       // Case 1
                    z.parent.color = BLACK;
                    y.color = BLACK;
                    z.parent.parent.color = RED;
                    z = z.parent.parent;
                } else {
                    if (z == z.parent.right) {              // Case 2
                        z = z.parent;
                        leftRotate(z);
                    }
                    z.parent.color = BLACK;                 // Case 3
                    z.parent.parent.color = RED;
                    rightRotate(z.parent.parent);
                }
            } else {
                Node<K> y = z.parent.parent.left;
                if (y.color == RED) {
                    z.parent.color = BLACK;
                    y.color = BLACK;
                    z.parent.parent.color = RED;
                    z = z.parent.parent;
                } else {
                    if (z == z.parent.left) {
                        z = z.parent;
                        rightRotate(z);
                    }
                    z.parent.color = BLACK;
                    z.parent.parent.color = RED;
                    leftRotate(z.parent.parent);
                }
            }
        }
        root.color = BLACK;
    }
}
```

### 11.4 Python — Full minimal implementation

```python
RED, BLACK = True, False

class Node:
    __slots__ = ('key', 'color', 'left', 'right', 'parent')
    def __init__(self, key, color=RED):
        self.key = key
        self.color = color
        self.left = self.right = self.parent = None

class RBTree:
    def __init__(self):
        self.NIL = Node(None, BLACK)
        self.NIL.left = self.NIL.right = self.NIL.parent = self.NIL
        self.root = self.NIL

    # --- rotations ---
    def _left_rotate(self, x):
        y = x.right
        x.right = y.left
        if y.left is not self.NIL:
            y.left.parent = x
        y.parent = x.parent
        if x.parent is self.NIL:
            self.root = y
        elif x is x.parent.left:
            x.parent.left = y
        else:
            x.parent.right = y
        y.left = x
        x.parent = y

    def _right_rotate(self, y):
        x = y.left
        y.left = x.right
        if x.right is not self.NIL:
            x.right.parent = y
        x.parent = y.parent
        if y.parent is self.NIL:
            self.root = x
        elif y is y.parent.right:
            y.parent.right = x
        else:
            y.parent.left = x
        x.right = y
        y.parent = x

    # --- insert ---
    def insert(self, key):
        z = Node(key, RED)
        z.left = z.right = self.NIL
        y, x = self.NIL, self.root
        while x is not self.NIL:
            y = x
            x = x.left if z.key < x.key else x.right
        z.parent = y
        if y is self.NIL:
            self.root = z
        elif z.key < y.key:
            y.left = z
        else:
            y.right = z
        self._insert_fixup(z)

    def _insert_fixup(self, z):
        while z.parent.color == RED:
            if z.parent is z.parent.parent.left:
                u = z.parent.parent.right          # uncle
                if u.color == RED:                  # Case 1
                    z.parent.color = BLACK
                    u.color = BLACK
                    z.parent.parent.color = RED
                    z = z.parent.parent
                else:
                    if z is z.parent.right:         # Case 2
                        z = z.parent
                        self._left_rotate(z)
                    z.parent.color = BLACK          # Case 3
                    z.parent.parent.color = RED
                    self._right_rotate(z.parent.parent)
            else:
                u = z.parent.parent.left
                if u.color == RED:
                    z.parent.color = BLACK
                    u.color = BLACK
                    z.parent.parent.color = RED
                    z = z.parent.parent
                else:
                    if z is z.parent.left:
                        z = z.parent
                        self._right_rotate(z)
                    z.parent.color = BLACK
                    z.parent.parent.color = RED
                    self._left_rotate(z.parent.parent)
        self.root.color = BLACK
```

### 11.5 Delete (sketch, full code in `tasks.md`)

Delete is harder than insert because removing a black node decreases the black-height of its subtree by 1, violating property 5. The fixup procedure carries an "extra black" up the tree until it can be absorbed.

In CLRS pseudocode the delete fixup has **4 cases** (and their 4 mirror images), branching on:
- color of `w` (the sibling of `x`),
- color of `w.left`,
- color of `w.right`.

The complete deletion code is ~90 lines in CLRS and is given in full in `tasks.md` task 4. For now, internalize this fact: the deletion fixup walks at most O(log n) levels but performs at most **3 rotations** total.

---

<a name="patterns"></a>
## 12. Coding Patterns — The Sentinel-NIL Trick

The single most important implementation pattern is the **shared NIL sentinel**: instead of using language `null` for missing children, allocate one node object once, color it BLACK, and use its address as the "no child" marker.

Why this matters:

1. **No null checks in fixup.** The line `if u.color == RED` reads from `u` even when `u` would be null. With a sentinel, `u` always points to a real node, so the read is safe.
2. **Parent of root.** The root's parent is the NIL sentinel, so `z.parent.color` works uniformly even when `z` is the root.
3. **Cleaner case analysis.** CLRS pseudocode pretends `T.nil` is the universal sentinel and reads color, parent, left, right from it. Real implementations follow.

**Trade-off:** the sentinel is a real allocation. In a 64-bit Java VM, this is one object header (~16 bytes) + 4 references = ~48 bytes, allocated once per tree (or shared globally across all trees of the same type, as in the Linux kernel). Memory cost: negligible. Cognitive cost: small initial confusion. Code-clarity gain: large.

**Linux kernel's approach (`include/linux/rbtree.h`):** uses `NULL` instead of a sentinel — they pay for the null checks but save the cache footprint of a per-tree sentinel object. For kernel data structures (millions of trees in a running system) the trade-off goes the other way. For user-space libraries (a few large trees) the sentinel wins.

**Java's TreeMap:** does **not** use a sentinel; it uses `null` for missing children and inlines null-checks into the rotations. Java's TreeMap is the historical implementation and the choice predates the trend toward sentinels.

---

<a name="errors"></a>
## 13. Error Handling

| Error | Cause | Mitigation |
|---|---|---|
| `NullPointerException` in fixup | Forgot to set new node's left/right to NIL sentinel | Always assign `z.left = z.right = NIL` at allocation. |
| Root has red color after fixup | Forgot the final `root.color = BLACK` line | Always end `insertFixup` with the explicit re-color. |
| Black-height drifts after delete | Off-by-one in the fixup loop | Run the `validate()` function from `tasks.md` task 5 in test mode. |
| Sentinel's parent pointer modified | A rotation around the root forgot to skip the sentinel | After any rotation, reset `NIL.parent = NIL` defensively. |
| Cycle in tree | A rotation forgot to update `x.parent = y` | Static analysis in the validator: any node reachable from itself = cycle. |
| Duplicate keys | Default insert allows duplicates | Decide policy: reject, ignore, or store as multiset; document explicitly. |

---

<a name="performance"></a>
## 14. Performance Tips

1. **Use intrusive nodes when possible.** The Linux kernel embeds `struct rb_node` inside the containing struct (`task_struct`, `vm_area_struct`, etc.) instead of holding a key + value pointer. Saves one allocation and one pointer chase per node.

2. **Stuff the color bit into a pointer.** On 64-bit systems, all heap pointers are 8-byte aligned, so the low 3 bits are always zero. You can use bit 0 as the color, saving 8 bytes per node. The Linux kernel does this. See `professional.md`.

3. **Cache the leftmost node for fast min().** A common augmentation: keep a `leftmost` pointer in the tree struct, updated on insert/delete. `min()` becomes O(1), which is hot in scheduler runqueues.

4. **Avoid recursion.** The CLRS code is iterative for a reason — Java/Go stack frames are large and trees can be 40 deep. Stay iterative.

5. **Prefer iterative successor.** The successor walks at most one path up and one path down; amortized O(1) over a full traversal even though worst case is O(log n) per call.

6. **For lookups only, use a hash table.** RB trees pay for ordering. If you don't need range queries, predecessor/successor, or sorted iteration, use a `HashMap` and get O(1) lookups.

---

<a name="best-practices"></a>
## 15. Best Practices

- **Use a sentinel for clarity, null for memory.** Match your environment's conventions.
- **Encapsulate rotations as private helpers.** Never call rotations from user-facing code.
- **Always run a `validate()` check in tests.** See `tasks.md` task 5 for the checker that verifies all 5 properties.
- **Pick the augmentation up front.** Subtree size? Min/max cache? Interval information? Adding it later means re-auditing every rotation site.
- **Document case numbers in comments.** CLRS naming ("Case 1: uncle red") is the lingua franca; future you (and your reviewer) will thank you.
- **Prefer LLRB (see `middle.md`) for teaching code.** It is half the size and provably correct. For production, use the symmetric CLRS form because that is what `std::map` and Linux do.
- **Test against `std::map` / `TreeMap` as the oracle.** Generate random op sequences and assert equality with a known-good implementation. Catches 90 % of bugs.

---

<a name="edge-cases"></a>
## 16. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty tree, insert 1 | `insert(5)` | Tree becomes `[5 B]` (root colored black). |
| Empty tree, delete | `delete(anything)` | Silent no-op or NotFound exception per policy. |
| Insert duplicate | `insert(5); insert(5)` | Policy choice: duplicate as right child, reject, or treat as multiset. |
| Delete root with two children | `delete(root.key)` | Replace with successor (in-order); rebalance from there. |
| Delete only node | `delete(root.key)` on 1-node tree | Tree becomes empty (root = NIL). |
| Insert N=1 million sequential | Naive BST would degenerate | RB tree stays at height ≤ 40. |
| Sentinel NIL queried for key | `nil.key` | Undefined value; never compared against a real key. |
| All same color (impossible) | An all-red tree violates property 4; an all-black tree may violate property 5 if asymmetric. | Validator catches it. |

---

<a name="mistakes"></a>
## 17. Common Mistakes

1. **Forgetting `root.color = BLACK` at the end of fixup.** The loop sometimes ends with the root still red. Always re-color.
2. **Mixing Case 2 (zig-zag) with Case 3 (zig-zig) recolor order.** Case 2 rotates *first*, then runs Case 3 logic; Case 3 colors *first*, then rotates. Reversing causes corrupt trees.
3. **Wrong uncle.** When `z.parent` is the right child, uncle is `z.parent.parent.left`, not `.right`. Mirror cases are easy to miscopy.
4. **NIL parent pointer left dangling.** The shared sentinel's parent gets stomped during a rotation around the root if you forget the `x.parent == T.nil` branch.
5. **Inserting black instead of red.** New nodes must be red so they don't violate property 5 (black-height) on insertion. Coloring them black moves the problem from property 4 to property 5, which is much harder to fix.
6. **Using `>` instead of `>=` for duplicate placement.** Decide once whether duplicates go left or right; consistency matters for delete to find them.
7. **Calling rotation on a NIL.** The rotation procedures dereference `x.right` / `y.left`; if those are NIL, you crash. Verify the case logic ensures non-NIL children before each rotation.
8. **Delete fixup: forgetting to update `x.parent` after replacing.** The deleted node's child becomes the new occupant; its parent pointer must be set even if the child is NIL (the sentinel cares about its parent because the loop reads it).

---

<a name="cheat-sheet"></a>
## 18. Cheat Sheet

```
THE 5 PROPERTIES
  1. Every node RED or BLACK.
  2. Root is BLACK.
  3. Every NIL leaf is BLACK.
  4. RED node ⇒ both children BLACK (no red-red).
  5. Every root-to-NIL path has the same number of BLACK nodes.

HEIGHT BOUND
  h ≤ 2·log₂(n + 1)

INSERT
  1. Standard BST insert as RED.
  2. While z.parent is RED:
       u = uncle(z)
       Case 1 (u RED):   recolor parent+uncle BLACK, grandparent RED, z = grandparent.
       Case 2 (u BLK, z is "inner" grandchild): rotate parent to make Case 3.
       Case 3 (u BLK, z is "outer"): recolor parent BLACK, grandparent RED, rotate grandparent.
  3. root.color = BLACK.

DELETE
  1. Standard BST delete; track the color y_orig_color of the spliced node.
  2. If y_orig_color was BLACK, run deleteFixup(x) on the replacement.
  3. deleteFixup walks up; 4 cases on sibling w and w's children's colors.
  4. Loop ends with x.color = BLACK.

COMPLEXITY
  Search   O(log n)
  Insert   O(log n) time, ≤ 2 rotations
  Delete   O(log n) time, ≤ 3 rotations
  Space    O(n)
```

---

<a name="animation"></a>
## 19. Animation Reference

Open `animation.html` in this folder. It supports inserting and deleting keys one at a time, displays each node in its current color, labels the active fixup case above the affected node ("Case 1: uncle red — recolor"), animates rotations, and shows live statistics (count, black-height, height, rotations performed, recolorings performed). The Validate button runs the 5-property checker and briefly highlights any node that violates an invariant.

A 5-minute play session walking inserts 10, 20, 30, 15, 25, 5, 7, 12 (the standard CLRS demo) will cement the case-labeling in your head better than any textbook diagram.

---

<a name="summary"></a>
## 20. Summary

- A red-black tree is a self-balancing BST where every node has a color (red or black) and 5 global properties hold.
- The properties together imply `height ≤ 2·log₂(n + 1)`, so all operations are O(log n).
- The 5 properties: (1) every node colored, (2) root is black, (3) NIL leaves are black, (4) no two consecutive red nodes, (5) every root-to-NIL path has equal black count.
- Insert: standard BST insert as red, then fix Property 4 violations using the 3-case insert fixup (uncle red ⇒ recolor; uncle black + inner ⇒ rotate to outer; uncle black + outer ⇒ recolor+rotate). At most 2 rotations.
- Delete: standard BST delete, then fix Property 5 violations using the 4-case delete fixup. At most 3 rotations.
- The shared NIL sentinel pattern simplifies the code by eliminating most null checks.
- Why RB instead of AVL? Fewer rotations on update, only 1 extra bit per node, simpler invariants. That is why every mainstream ordered map (C++ STL, Java TreeMap, Linux kernel) uses red-black.

You are now ready for `middle.md`, which covers the formal height proof, Sedgewick's Left-Leaning Red-Black variant, top-down vs bottom-up insertion, persistent red-black trees, and the 2-3-4 tree equivalence.

---

<a name="further-reading"></a>
## 21. Further Reading

- **Bayer**, "Symmetric Binary B-Trees: Data Structure and Maintenance Algorithms", Acta Informatica 1, 1972. The original paper.
- **Guibas & Sedgewick**, "A Dichromatic Framework for Balanced Trees", FOCS 1978. The paper that introduced the names "red" and "black".
- **Sedgewick**, "Left-leaning Red-Black Trees", 2008 (draft). The simplification that is now taught in *Algorithms* 4th edition.
- **Cormen, Leiserson, Rivest, Stein (CLRS)**, *Introduction to Algorithms*, 3rd or 4th edition, Chapter 13. The canonical textbook treatment, with all six insert cases and all eight delete cases worked out in pseudocode.
- **Okasaki**, *Purely Functional Data Structures*, Cambridge University Press, 1998, section 3.3. Persistent red-black trees in Haskell, ~12 lines.
- **Eisenstat**, "Tarjan's Rank-Balanced Trees", 2013. WAVL trees as a unified framework for red-black and AVL.
- **Linux kernel source**, `lib/rbtree.c` and `include/linux/rbtree.h`. Real, production red-black code that powers a billion devices.
- Continue with `middle.md` for LLRB, persistence, and 2-3-4 equivalence.
