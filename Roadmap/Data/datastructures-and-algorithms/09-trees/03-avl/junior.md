# AVL Tree — Junior Level

> **Read time: ~45 minutes** · **Audience:** Engineers who have implemented a Binary Search Tree (BST) and seen its degeneration into a linked list. Prerequisite: `09-trees/02-bst`.

The AVL tree is the **first self-balancing binary search tree ever invented** — published by Georgy Adelson-Velsky and Evgenii Landis in 1962 in the Soviet journal *Doklady Akademii Nauk SSSR* under the title *"An algorithm for the organization of information"*. It solved a problem that had plagued every BST user up to that point: when a BST receives keys in sorted order it degenerates into a linked list, and search/insert/delete collapse from O(log n) to O(n). Adelson-Velsky and Landis proved that if you maintain a simple **height invariant** at every node — namely, that the heights of a node's two subtrees differ by at most one — and repair the invariant after every insert and delete using small constant-time **rotations**, you get *guaranteed* O(log n) for all three operations, forever.

This document teaches AVL trees **so concretely** that you will be able to write an iterative, deletion-correct AVL from memory, identify any of the four rotation cases at a glance, prove the height bound, and know when to reach for AVL versus a red-black tree, treap, splay tree, or skip list.

---

## Table of Contents

1. [Introduction — The BST Degeneration Problem](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Height Invariant and Balance Factor](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough — The Four Rotation Cases](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns](#patterns)
11. [Error Handling — Height Update Order Matters](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — The BST Degeneration Problem

You have already built a BST. You inserted 50, 30, 70, 20, 40, 60, 80 in random order and got a perfectly balanced tree of height 2. Search runs in 3 comparisons. You are happy.

Then your production system receives an ascending stream of timestamps — 1, 2, 3, 4, 5, ..., 1,000,000. Each insert goes to the **right child of the rightmost node**. The tree degenerates into a path:

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

Height is now `n - 1`. Search for `999,999` takes a million comparisons. Insert, delete, and find all behave like a singly-linked list. **The asymptotic guarantee O(log n) was never a guarantee at all — it was an average over random insertion orders.**

Adelson-Velsky and Landis observed that the *shape* of a BST is determined by the insertion order, but you can **restore the shape** after every insert and delete by performing **rotations** — local, O(1) pointer rewires that preserve the BST inorder property. The question they answered: how do you decide *when* and *how* to rotate?

Their answer:

1. At every node, track the **height** of its subtree (or equivalently, the **balance factor** = height(left) - height(right)).
2. Require the invariant `|balance_factor| ≤ 1` at every node.
3. After an insert or delete, walk back up from the modified leaf toward the root. At each ancestor, recompute the height. If the balance factor becomes ±2, perform the appropriate rotation to restore `|bf| ≤ 1`.

Because the height of an AVL tree is bounded by `~1.44 log₂(n)` (we prove this in `middle.md`), and because rotations are O(1), every operation runs in `O(log n)` worst case. AVL turned the BST from a fast-on-average data structure into a fast-in-the-worst-case data structure. It made BSTs usable for real systems.

In the 60+ years since, many other self-balancing BSTs have been invented (red-black 1972, AA 1993, splay 1985, treap 1989, scapegoat 1989, WAVL 2015). They all use rotations. They all owe their existence to AVL.

---

<a name="prerequisites"></a>
## 2. Prerequisites

To read this document fluently you should already know:

1. **BST mechanics.** `search`, `insert`, `delete` (including the three deletion cases: no child, one child, two children with in-order successor swap). See `09-trees/02-bst`.
2. **Recursion on tree nodes** — both the "return new subtree root" pattern and the "modify in place" pattern.
3. **Big-O complexity** — what O(log n) vs O(n) actually mean for n = 10⁶.
4. **Pointer/reference semantics** in your language of choice: in Go and Java you mutate via the returned root; in C you'd pass `Node**`.
5. **Why a sorted insertion sequence breaks a vanilla BST** (the introduction).

If any of these is shaky, go back to `09-trees/02-bst` first. Self-balancing trees are *BSTs plus rotations*; you must own the BST half before the balancing half makes sense.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Height of a node** | Number of edges on the longest path from this node down to a leaf. A leaf has height 0. An empty subtree has height -1 (convention). |
| **Height of a tree** | Height of its root. |
| **Subtree height** | Same thing; used when emphasizing that we cache it per-node. |
| **Balance factor (bf)** | `bf(node) = height(node.left) - height(node.right)`. Some textbooks use the reverse sign; we use this convention throughout. |
| **AVL invariant** | At every node, `|bf| ≤ 1`. Equivalently, `bf ∈ {-1, 0, +1}`. |
| **Left-heavy** | `bf = +1` (or +2 transiently before rebalance). Left subtree is taller. |
| **Right-heavy** | `bf = -1` (or -2 transiently). Right subtree is taller. |
| **Balanced node** | `bf = 0`. Both subtrees have equal height. |
| **Unbalanced node** | `|bf| > 1`. Must be repaired. |
| **Rotation** | Constant-time pointer rewire that preserves the inorder sequence. Two primitives: `rotateLeft`, `rotateRight`. |
| **LL case** | Left subtree's left side is heavy. Fix with a single right rotation. |
| **RR case** | Right subtree's right side is heavy. Fix with a single left rotation. |
| **LR case** | Left subtree's right side is heavy. Fix with left-rotate-child then right-rotate-node. |
| **RL case** | Right subtree's left side is heavy. Fix with right-rotate-child then left-rotate-node. |
| **Pivot** | The node that takes the place of the unbalanced node after rotation. |
| **Trinode restructuring** | Tarjan's term for the same operation; emphasizes the three nodes involved (grandparent, parent, child) along the path of insertion. |
| **Retracing** | Walking from the modified node back up to the root, recomputing heights and rebalancing as needed. |
| **Fibonacci tree** | The worst-case AVL tree of given height — sparsest legal AVL. Used to derive the height bound. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Height Invariant and Balance Factor

### 4.1 What each node stores

A vanilla BST node has:

```
key, left, right
```

An AVL node adds one cached field:

```
key, left, right, height
```

We cache `height` rather than recomputing it because every operation needs the height of every ancestor on the path from the root to the modified node. Recomputing recursively each time would cost O(n); caching makes each lookup O(1).

Some implementations cache the **balance factor** (a 2-bit integer in `{-1, 0, +1}`) instead of the full height. That saves memory but makes the rotation code slightly trickier because you must update the bf of the rotated nodes by case analysis. We use **stored height** in this document — it is the easier formulation to learn, easier to debug (print the tree and the height labels), and only costs a few extra bytes per node. `middle.md` shows the balance-factor variant.

### 4.2 Computing balance factor

```
bf(node):
    return height(node.left) - height(node.right)

height(node):
    if node is null: return -1
    else: return node.height
```

The empty-subtree convention `height(null) = -1` is what makes a leaf node (both children null) have `height = max(-1, -1) + 1 = 0`. Different textbooks use different conventions (some say a leaf has height 1 and null has height 0). Pick one and **stick with it across your whole codebase**. We use `height(null) = -1, height(leaf) = 0`.

### 4.3 The invariant

After every public operation (`insert`, `delete`), **every node** in the tree satisfies `|bf(node)| ≤ 1`. Internally, during the bottom-up retrace after an insert or delete, a node can transiently have `|bf| = 2`. That triggers a rotation, and after the rotation the node and its replacement again satisfy `|bf| ≤ 1`.

### 4.4 The two rotation primitives

A **right rotation** at node `y` (with left child `x`) produces this transformation:

```
        y                 x
       / \               / \
      x   C    →        A   y
     / \                   / \
    A   B                 B   C
```

In pseudocode:

```
rotateRight(y):
    x = y.left
    B = x.right

    x.right = y
    y.left  = B

    updateHeight(y)        # y's children changed; y first
    updateHeight(x)        # then x, which now has y as its right child
    return x               # new subtree root
```

The BST inorder property is preserved: the inorder traversal before is `A, x, B, y, C`, and after is `A, x, B, y, C`. Identical. That is **the** defining property of a rotation — it is the only kind of restructuring that keeps a BST a BST.

A **left rotation** at node `x` (with right child `y`) is the mirror:

```
      x                     y
     / \                   / \
    A   y       →         x   C
       / \               / \
      B   C             A   B
```

```
rotateLeft(x):
    y = x.right
    B = y.left

    y.left  = x
    x.right = B

    updateHeight(x)
    updateHeight(y)
    return y
```

These are the **only two primitive operations** in AVL maintenance. Every fix-up uses one or two of them. Each is O(1) — three pointer assignments, two height recomputes.

### 4.5 The four rotation cases

After an insert or delete unbalances a node `z` (so `|bf(z)| = 2`), the fix depends on **where** the imbalance came from. There are exactly four cases. Let `y` be the heavier child of `z`, and `x` be the heavier grandchild on the path from `z` toward the modified leaf.

| Case | Description | Fix |
|---|---|---|
| **LL** | `z` is left-heavy, `y` is left-heavy (or balanced after delete). The new node is in `z.left.left`. | `rotateRight(z)` |
| **RR** | `z` is right-heavy, `y` is right-heavy. New node in `z.right.right`. | `rotateLeft(z)` |
| **LR** | `z` is left-heavy, `y` is right-heavy. New node in `z.left.right`. | `rotateLeft(y)` then `rotateRight(z)` |
| **RL** | `z` is right-heavy, `y` is left-heavy. New node in `z.right.left`. | `rotateRight(y)` then `rotateLeft(z)` |

The LR and RL cases are **double rotations**; you cannot fix them with a single rotation because that would move the imbalance instead of removing it.

### 4.6 Retracing after insert

```
insert(root, key):
    1. Standard BST insert; new node placed at a leaf.
    2. Walk back up. At each ancestor:
       a. Recompute the ancestor's height.
       b. Compute bf.
       c. If |bf| > 1, apply the appropriate rotation.
       d. Replace the ancestor in its parent's pointer with the rotation result.
```

A key property of **insertion**: at most **one rotation** (LL or RR) or **one double rotation** (LR or RL) is needed to restore the entire tree. Once the first unbalanced ancestor is fixed, every higher ancestor's height returns to what it was before the insert, so no further rotations are needed. This is what keeps insert at O(log n) — at most 2 rotations total, no matter how many levels deep.

### 4.7 Retracing after delete

Deletion is **harder**. After a node is removed, the subtree height may decrease, which can unbalance an ancestor. After we rotate to fix that ancestor, the resulting subtree may *itself* be one shorter than before the rotation, which can unbalance the *next* ancestor up. So deletion can cascade rotations all the way to the root — up to `O(log n)` rotations per delete. Each rotation is still O(1), so total delete time is O(log n), but with a larger constant than insert.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | Time | Space | Notes |
|---|---|---|---|
| **search** | O(log n) | O(1) iter / O(log n) rec | Same as BST, but guaranteed worst case |
| **insert** | O(log n) | O(log n) rec stack | At most 2 rotations |
| **delete** | O(log n) | O(log n) rec stack | Up to O(log n) rotations |
| **min / max** | O(log n) | O(1) | Leftmost / rightmost leaf |
| **successor / predecessor** | O(log n) | O(1) with parent pointers, else O(log n) stack |  |
| **inorder traversal** | O(n) | O(log n) | Yields sorted sequence |
| **bulk-load from sorted** | O(n) | O(n) | See `middle.md` |
| **height bound** | `≤ 1.44 log₂(n+2) - 0.328` | — | Tight; Fibonacci tree achieves this |
| **rotations per insert** | ≤ 2 | — | Constant |
| **rotations per delete** | O(log n) worst case | — | Cascading |

For `n = 10⁶`, AVL height is at most ~30. For `n = 10⁹`, at most ~45. Compare to a degenerate vanilla BST: heights of 10⁶ and 10⁹ respectively. AVL turns a 10⁶× slowdown into a small constant factor.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 The meticulous librarian

A librarian shelves books in alphabetical order on a tall shelf. Whenever a new book arrives, she places it in the correct alphabetical slot — but she also walks along the aisle and checks: *is the left side of any sub-shelf much taller than the right?* If yes, she slides one book down and rotates the contents so both sides match. She never lets a sub-shelf get more than one book taller than its sibling. Customers searching for any book walk past at most `1.44 × log₂(N)` shelves to find it.

### 6.2 The military rank tree

In an army, every officer has at most two direct subordinates. The chain of command must be **balanced** — no soldier should have to walk through 30 commanders to reach the general when a parallel path would take 5. Whenever a new soldier is enlisted or one retires, the personnel office "rotates" subordinates between officers to keep the chain balanced. The AVL invariant is the rulebook.

### 6.3 The auto-balanced filing cabinet

Picture a filing cabinet where each drawer can hold two sub-cabinets. Files are organized alphabetically. When a drawer's left sub-cabinet grows two levels taller than its right, the cabinet auto-rotates: the left sub-cabinet's contents move up, the original drawer's contents move down-right, and the structure rebalances. This is what an AVL `rotateRight` does in software.

### 6.4 Why not just "rebuild from scratch"?

You could rebuild the whole tree every time it becomes unbalanced — O(n) work per rebuild. AVL's insight is that **local** rebalancing is enough: only the rotated nodes change pointers, and the rest of the tree is untouched. O(1) work per rotation, O(log n) rotations per operation, O(log n) total. Local repairs scale; global rebuilds don't.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros
- **Guaranteed O(log n) for search, insert, delete.** No worst case scenario.
- **Tightest balance of any classical BST.** Height bound `1.44 log₂ n` is strictly tighter than red-black's `2 log₂(n+1)`. Searches are about 30% faster in the worst case.
- **Conceptually clean.** One invariant, four rotation cases. Easier to verify and prove correct than red-black trees.
- **Stores sorted data with O(log n) inserts and ordered iteration.** Beats hash maps when you need order, range queries, or successor/predecessor.
- **In-place augmentation is easy.** Add a subtree-size or sum field per node, maintain it during rotations, and you get order-statistic queries and range sums for free.

### Cons
- **More rotations per write than red-black.** AVL keeps a tighter balance, so it triggers rotations more often. For write-heavy workloads, red-black wins.
- **Delete can cascade O(log n) rotations.** Vs. red-black where worst-case is 3 rotations per delete.
- **Larger per-node memory.** Caching height costs 4–8 bytes per node. With balance-factor (2 bits) it's cheap, but most production code caches the full height.
- **Cache behavior worse than B-trees.** Each node holds one key; a B-tree node holds 100+. For data on disk or in L3 cache, B-tree dominates.
- **Concurrent AVL is hard.** Rotations move keys across multiple nodes, requiring fine-grained locking or copy-on-write paths.
- **STL `std::map` is red-black, not AVL.** The C++ standard committee chose red-black for write performance. AVL ecosystem support is thinner.

### When to pick AVL
- **Read-heavy, in-memory ordered map.** Lookups dominate; you can afford the extra write cost.
- **Real-time systems where worst-case lookup must be bounded.** AVL's tighter height bound is provable.
- **Computational geometry** — range trees, interval trees, segment trees over points. Lookups are the hot path.
- **Teaching.** AVL is the cleanest place to learn rotation mechanics before moving on to red-black, splay, or B-tree.

### When not to pick AVL
- **Write-heavy workloads.** Use red-black, treap, or skip list.
- **On-disk or out-of-cache.** Use a B-tree or B+-tree.
- **Need lock-free.** Use a skip list (Java `ConcurrentSkipListMap`).
- **Unordered exact-match only.** Use a hash table.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough — The Four Rotation Cases

We will build an AVL tree from scratch by inserting `30, 20, 10` (LL case), then reset and try `10, 20, 30` (RR), `30, 10, 20` (LR), `10, 30, 20` (RL).

### 8.1 LL case — insert `30, 20, 10`

After inserting `30`:
```
30 (h=0, bf=0)
```

After inserting `20`:
```
    30 (h=1, bf=+1)
   /
  20 (h=0)
```
Still balanced.

After inserting `10`:
```
      30 (h=2, bf=+2)  ← unbalanced!
     /
    20 (h=1, bf=+1)
   /
  10 (h=0)
```

`30` has bf = +2 (left-heavy). Its left child `20` has bf = +1 (also left-heavy). The new node `10` is in `30.left.left`. This is the **LL case**. Fix: `rotateRight(30)`.

```
    20 (h=1, bf=0)
   /  \
  10   30
  h=0  h=0
```

Balanced! One rotation, three pointer changes:
- `20.right` was null, now is `30`.
- `30.left` was `20`, now is null (what was `20.right`).
- The parent of `30` (none, since `30` was root) now points to `20`. The root pointer is updated.

### 8.2 RR case — insert `10, 20, 30`

Mirror of above. After all three inserts:
```
  10 (h=2, bf=-2)
    \
     20 (h=1, bf=-1)
       \
        30 (h=0)
```

Fix: `rotateLeft(10)`.

```
    20
   /  \
  10   30
```

### 8.3 LR case — insert `30, 10, 20`

After `30, 10`:
```
    30 (h=1)
   /
  10 (h=0)
```

Insert `20`:
```
      30 (h=2, bf=+2)
     /
    10 (h=1, bf=-1)   ← right-heavy
      \
       20 (h=0)
```

`30` is left-heavy (`bf=+2`) but its left child `10` is right-heavy (`bf=-1`). New node is in `30.left.right`. This is the **LR case**.

A single `rotateRight(30)` would NOT fix it — it would produce:
```
    10
      \
       30
      /
     20
```
which is still unbalanced (30 now has bf = +1, but more importantly the rotation just shifted the imbalance shape). We need a **double rotation**: first rotate left on `10`, then rotate right on `30`.

Step 1: `rotateLeft(10)`:
```
      30 (still bf=+2 momentarily)
     /
    20 (h=1)
   /
  10 (h=0)
```

Step 2: `rotateRight(30)`:
```
    20 (h=1, bf=0)
   /  \
  10   30
```

Balanced. Two rotations, six pointer changes.

### 8.4 RL case — insert `10, 30, 20`

Mirror of LR. After `10, 30, 20`:
```
  10 (h=2, bf=-2)
    \
     30 (h=1, bf=+1)   ← left-heavy
    /
   20 (h=0)
```

Fix: `rotateRight(30)` then `rotateLeft(10)`.

Result:
```
    20
   /  \
  10   30
```

### 8.5 Case-selection rule

Given that node `z` has `|bf(z)| > 1`:

```
if bf(z) > 0:           # z is left-heavy
    if bf(z.left) >= 0: # LL
        rotateRight(z)
    else:               # LR
        z.left = rotateLeft(z.left)
        rotateRight(z)
else:                    # z is right-heavy
    if bf(z.right) <= 0: # RR
        rotateLeft(z)
    else:                # RL
        z.right = rotateRight(z.right)
        rotateLeft(z)
```

The `>= 0` and `<= 0` are deliberate — after a **delete**, the heavier child can have bf = 0 (not strictly heavy on the same side), and the single rotation still works. This subtlety matters; getting it wrong is a classic AVL delete bug.

### 8.6 A larger example — inserts `40, 20, 60, 10, 30, 50, 70, 5, 25`

We start with the perfect skeleton after `40, 20, 60, 10, 30, 50, 70`:
```
        40
       /  \
      20   60
     / \   / \
    10 30 50 70
```

All balance factors zero. Insert `5`:
```
          40 (bf=+1)
         /  \
        20 (bf=+1)   60
       / \           / \
      10 (bf=+1) 30  50 70
     /
    5
```

Walk up. `10`: bf = +1, OK. `20`: bf = +1, OK. `40`: bf = +1, OK. No rotations.

Insert `25`:
```
            40 (bf=+1)
           /  \
          20 (bf=0)   60
         / \           / \
        10  30 (bf=+1) 50 70
       /    /
      5   25
```

Walk up. `30`: bf=+1. `20`: bf = height(left=10’s subtree=1) - height(right=30’s subtree=1) = 0. `40`: bf = 2 - 2 = 0. No rotations.

Now insert `35`:
```
              40 (bf=+1)
             /  \
            20 (bf=-1)   60
           / \             / \
          10  30 (bf=0)   50 70
         /    / \
        5   25 35
```

Walk up. `30`: bf=0. `20`: bf = 1 - 2 = -1. `40`: bf = 3 - 2 = +1. All OK.

Insert `27` next forces a rotation — try it on paper or in `animation.html`.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Node, height helper, rotations

**Go:**
```go
package avl

type Node struct {
    Key         int
    Left, Right *Node
    Height      int   // height of subtree rooted at this node
}

func height(n *Node) int {
    if n == nil {
        return -1
    }
    return n.Height
}

func updateHeight(n *Node) {
    n.Height = max(height(n.Left), height(n.Right)) + 1
}

func balanceFactor(n *Node) int {
    if n == nil {
        return 0
    }
    return height(n.Left) - height(n.Right)
}

func rotateRight(y *Node) *Node {
    x := y.Left
    b := x.Right

    x.Right = y
    y.Left  = b

    updateHeight(y)    // y first; its children changed
    updateHeight(x)    // then x, whose right child is now y
    return x
}

func rotateLeft(x *Node) *Node {
    y := x.Right
    b := y.Left

    y.Left  = x
    x.Right = b

    updateHeight(x)
    updateHeight(y)
    return y
}

func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}
```

**Java:**
```java
public class AVLTree {
    static class Node {
        int key, height;
        Node left, right;
        Node(int key) { this.key = key; this.height = 0; }
    }

    Node root;

    private int height(Node n)    { return n == null ? -1 : n.height; }
    private int bf(Node n)        { return n == null ? 0 : height(n.left) - height(n.right); }
    private void updateHeight(Node n) {
        n.height = Math.max(height(n.left), height(n.right)) + 1;
    }

    private Node rotateRight(Node y) {
        Node x = y.left;
        Node b = x.right;
        x.right = y;
        y.left  = b;
        updateHeight(y);
        updateHeight(x);
        return x;
    }

    private Node rotateLeft(Node x) {
        Node y = x.right;
        Node b = y.left;
        y.left  = x;
        x.right = b;
        updateHeight(x);
        updateHeight(y);
        return y;
    }
}
```

**Python:**
```python
class Node:
    __slots__ = ("key", "left", "right", "height")
    def __init__(self, key):
        self.key, self.left, self.right, self.height = key, None, None, 0

def height(n):
    return -1 if n is None else n.height

def bf(n):
    return 0 if n is None else height(n.left) - height(n.right)

def update_height(n):
    n.height = max(height(n.left), height(n.right)) + 1

def rotate_right(y):
    x, b = y.left, y.left.right
    x.right, y.left = y, b
    update_height(y)
    update_height(x)
    return x

def rotate_left(x):
    y, b = x.right, x.right.left
    y.left, x.right = x, b
    update_height(x)
    update_height(y)
    return y
```

### 9.2 Insert with rebalance

**Go:**
```go
func Insert(root *Node, key int) *Node {
    // 1. Standard BST insert.
    if root == nil {
        return &Node{Key: key, Height: 0}
    }
    if key < root.Key {
        root.Left = Insert(root.Left, key)
    } else if key > root.Key {
        root.Right = Insert(root.Right, key)
    } else {
        return root // duplicate — ignore, or update value if a map
    }

    // 2. Update height of this ancestor.
    updateHeight(root)

    // 3. Check balance and rotate if needed.
    b := balanceFactor(root)

    if b > 1 && key < root.Left.Key {    // LL
        return rotateRight(root)
    }
    if b > 1 && key > root.Left.Key {    // LR
        root.Left = rotateLeft(root.Left)
        return rotateRight(root)
    }
    if b < -1 && key > root.Right.Key {  // RR
        return rotateLeft(root)
    }
    if b < -1 && key < root.Right.Key {  // RL
        root.Right = rotateRight(root.Right)
        return rotateLeft(root)
    }
    return root
}
```

**Java:**
```java
public void insert(int key) { root = insert(root, key); }

private Node insert(Node node, int key) {
    if (node == null) return new Node(key);
    if (key < node.key)      node.left  = insert(node.left, key);
    else if (key > node.key) node.right = insert(node.right, key);
    else return node;                  // ignore duplicate

    updateHeight(node);

    int b = bf(node);

    if (b > 1 && key < node.left.key)        return rotateRight(node);            // LL
    if (b > 1 && key > node.left.key) {       node.left = rotateLeft(node.left);
                                              return rotateRight(node); }         // LR
    if (b < -1 && key > node.right.key)      return rotateLeft(node);             // RR
    if (b < -1 && key < node.right.key) {     node.right = rotateRight(node.right);
                                              return rotateLeft(node); }          // RL
    return node;
}
```

**Python:**
```python
def insert(root, key):
    if root is None:
        return Node(key)
    if key < root.key:
        root.left = insert(root.left, key)
    elif key > root.key:
        root.right = insert(root.right, key)
    else:
        return root

    update_height(root)
    b = bf(root)

    if b > 1 and key < root.left.key:        # LL
        return rotate_right(root)
    if b > 1 and key > root.left.key:        # LR
        root.left = rotate_left(root.left)
        return rotate_right(root)
    if b < -1 and key > root.right.key:      # RR
        return rotate_left(root)
    if b < -1 and key < root.right.key:      # RL
        root.right = rotate_right(root.right)
        return rotate_left(root)
    return root
```

### 9.3 Delete with rebalance

Deletion has more case analysis because the unbalanced node's heavier child might be balanced (bf = 0) — a situation that never arises after an insert.

**Go:**
```go
func Delete(root *Node, key int) *Node {
    if root == nil {
        return nil
    }
    if key < root.Key {
        root.Left = Delete(root.Left, key)
    } else if key > root.Key {
        root.Right = Delete(root.Right, key)
    } else {
        // Found the node.
        if root.Left == nil || root.Right == nil {
            // Zero or one child.
            var child *Node
            if root.Left != nil {
                child = root.Left
            } else {
                child = root.Right
            }
            root = child
        } else {
            // Two children: swap with inorder successor and recurse.
            succ := minNode(root.Right)
            root.Key = succ.Key
            root.Right = Delete(root.Right, succ.Key)
        }
    }
    if root == nil {
        return nil
    }
    updateHeight(root)

    b := balanceFactor(root)

    if b > 1 && balanceFactor(root.Left) >= 0 { // LL (note >= 0 not > 0)
        return rotateRight(root)
    }
    if b > 1 && balanceFactor(root.Left) < 0 {  // LR
        root.Left = rotateLeft(root.Left)
        return rotateRight(root)
    }
    if b < -1 && balanceFactor(root.Right) <= 0 { // RR
        return rotateLeft(root)
    }
    if b < -1 && balanceFactor(root.Right) > 0 {  // RL
        root.Right = rotateRight(root.Right)
        return rotateLeft(root)
    }
    return root
}

func minNode(n *Node) *Node {
    for n.Left != nil {
        n = n.Left
    }
    return n
}
```

**Java:**
```java
public void delete(int key) { root = delete(root, key); }

private Node delete(Node node, int key) {
    if (node == null) return null;
    if (key < node.key) node.left  = delete(node.left, key);
    else if (key > node.key) node.right = delete(node.right, key);
    else {
        if (node.left == null || node.right == null) {
            node = (node.left != null) ? node.left : node.right;
        } else {
            Node succ = minNode(node.right);
            node.key = succ.key;
            node.right = delete(node.right, succ.key);
        }
    }
    if (node == null) return null;
    updateHeight(node);
    int b = bf(node);

    if (b > 1  && bf(node.left)  >= 0) return rotateRight(node);
    if (b > 1  && bf(node.left)  <  0) { node.left  = rotateLeft(node.left);   return rotateRight(node); }
    if (b < -1 && bf(node.right) <= 0) return rotateLeft(node);
    if (b < -1 && bf(node.right) >  0) { node.right = rotateRight(node.right); return rotateLeft(node); }
    return node;
}

private Node minNode(Node n) { while (n.left != null) n = n.left; return n; }
```

**Python:**
```python
def delete(root, key):
    if root is None:
        return None
    if key < root.key:
        root.left = delete(root.left, key)
    elif key > root.key:
        root.right = delete(root.right, key)
    else:
        if root.left is None or root.right is None:
            root = root.left if root.left is not None else root.right
        else:
            succ = root.right
            while succ.left is not None:
                succ = succ.left
            root.key = succ.key
            root.right = delete(root.right, succ.key)
    if root is None:
        return None

    update_height(root)
    b = bf(root)

    if b > 1 and bf(root.left) >= 0:
        return rotate_right(root)
    if b > 1 and bf(root.left) < 0:
        root.left = rotate_left(root.left)
        return rotate_right(root)
    if b < -1 and bf(root.right) <= 0:
        return rotate_left(root)
    if b < -1 and bf(root.right) > 0:
        root.right = rotate_right(root.right)
        return rotate_left(root)
    return root
```

### 9.4 Search

Identical to BST search — the balancing is invisible to the reader. Included for completeness.

**Go:**
```go
func Search(root *Node, key int) *Node {
    for root != nil {
        switch {
        case key == root.Key:
            return root
        case key < root.Key:
            root = root.Left
        default:
            root = root.Right
        }
    }
    return nil
}
```

---

<a name="patterns"></a>
## 10. Coding Patterns

### 10.1 The "return new subtree root" pattern

Every mutating function in our AVL takes a subtree root and returns the (possibly new) subtree root. Callers re-bind:

```
node.left = insert(node.left, key)
```

This is the same pattern used in functional persistent BSTs. It is what lets a single rotation change the root of a subtree without any awkward parent-pointer juggling. **Always use this pattern.** Trying to mutate the parent pointer from inside the rotation is a debugging swamp.

### 10.2 Case selection by subtree comparison vs by inserted key

In the **insert** code above, we selected the rotation case by comparing the inserted key to the child's key:

```
if b > 1 && key < root.Left.Key { return rotateRight(root) }     // LL
```

That works for insert because we know which child the new node went into.

In the **delete** code, the deleted key is gone, so we cannot use it for case selection. Instead we use the **balance factor of the child**:

```
if b > 1 && bf(root.Left) >= 0 { return rotateRight(root) }       // LL
```

Use the child-bf form whenever you don't have a key to compare. It is more general and works for both insert and delete; many production AVL implementations use it exclusively to share a single rebalance routine.

### 10.3 Order of height updates after rotation

After `rotateRight(y)` where `x = y.left`:
1. **Update `y` first** — its children have just changed.
2. **Then update `x`** — its right child is now `y`, whose height was just refreshed.

Reverse this order and `x.height` would be computed from a stale `y.height`, giving a wrong cached height and a silent rebalance bug. The same rule applies to `rotateLeft`. **Children first, then parent.**

### 10.4 Single rebalance routine

A clean way to factor the four cases:

```go
func rebalance(n *Node) *Node {
    updateHeight(n)
    b := balanceFactor(n)
    if b > 1 {
        if balanceFactor(n.Left) < 0 {
            n.Left = rotateLeft(n.Left)
        }
        return rotateRight(n)
    }
    if b < -1 {
        if balanceFactor(n.Right) > 0 {
            n.Right = rotateRight(n.Right)
        }
        return rotateLeft(n)
    }
    return n
}
```

Then insert and delete each end with `return rebalance(root)`. Much less duplication.

### 10.5 Augmentation pattern

To turn AVL into an **order-statistic tree**, add `size int` to each node and maintain it in `updateHeight`:

```
updateNodeStats(n):
    n.Height = max(height(n.Left), height(n.Right)) + 1
    n.Size   = 1 + size(n.Left) + size(n.Right)
```

Rotations preserve sizes correctly as long as you update *both* fields on each rotated node. The pattern generalizes: subtree sum, min/max, count of marked nodes — anything composable from children + self.

---

<a name="errors"></a>
## 11. Error Handling — Height Update Order Matters

### 11.1 The order-of-updates bug

```
rotateRight(y):
    x = y.left
    b = x.right
    x.right = y
    y.left  = b
    updateHeight(x)     // WRONG: x.right is now y, whose height is stale
    updateHeight(y)
    return x
```

Reversing the update order is the **single most common AVL bug**. The fix is trivial — always do `y` first because `y` is the deeper node after the rotation — but the symptom is subtle: balance factors look right immediately after the rotation, but operations several levels up get the wrong height for `x` and may trigger spurious rotations or miss real ones. Hours of debugging.

### 11.2 The `>=` vs `>` bug in delete rebalance

```
if b > 1 && bf(root.Left) > 0 { return rotateRight(root) }   // WRONG
```

For **insert**, this is fine — after an insert, the heavier child cannot have bf = 0. For **delete**, the heavier child can be perfectly balanced (bf = 0). If you use strict `>`, you skip the LL case here and fall through to LR, performing an extra unnecessary rotation that produces a still-balanced result but wastes work. Worse, some readers transcribe `> 0` for both branches and produce a wrong-rotation choice that violates the AVL invariant. **Use `>= 0` for the LL case after delete, `<= 0` for RR**.

### 11.3 Forgetting to update root pointer

```
Insert(root, 42)            // returns new root, you ignored it
```

In Go and Python, `root` is passed by value, so the new root is in the return value. If you don't re-bind, the caller's `root` still points to the old root, which may no longer be in the tree. Always do `root = Insert(root, 42)`. In Java you'd typically wrap in a class with a `root` field that the methods update directly.

### 11.4 Null dereference in rebalance

```
if b > 1 && bf(root.Left) >= 0 { ... }
```

If `b > 1` then `root.Left` cannot be null — a null left child would give bf = -∞ - height(right), which would never satisfy `b > 1`. So the bf(root.Left) call is safe. Convince yourself of this before using the `child-bf` form; relying on assumed invariants in code is fine as long as they really hold.

### 11.5 Other failure modes

| Error | Cause | Mitigation |
|---|---|---|
| Stack overflow on deep tree | Pathological recursion — but AVL height is bounded! Real cause is usually using non-AVL recursive routines on a degenerate input | If using the iterative AVL (see `middle.md`), this can't happen |
| Duplicate key insertion silently dropped | Default behavior in many implementations | If you need multi-keys, use a `count` field per node |
| Inorder iterator broken after modification during iteration | All BST iterators are fragile here | Snapshot keys before iterating, or use a copy-on-write variant |
| Heights become negative | `height(null) = -1` propagates everywhere correctly *only if* you use the `-1` convention | Pick the convention and use a single helper |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Cache the height, not the balance factor — when learning.** Once you're comfortable, the 2-bit balance-factor variant is more cache-friendly. See `middle.md`.
2. **Use iterative AVL when stack is constrained.** Recursive AVL adds O(log n) frames per call. For n = 10⁹ that's ~45 frames — usually fine, but in embedded or fiber-heavy systems, iterative is safer.
3. **Pool node allocations.** A free list of `Node` objects avoids GC pressure on insert-heavy workloads.
4. **Bulk-load when possible.** Building an AVL from a sorted array bottom-up is O(n) (see `tasks.md` task 5), versus O(n log n) for n inserts.
5. **Augment, don't iterate.** If you need "kth smallest" or "rank of key", augment with subtree size and answer in O(log n). Walking the whole tree to count is O(n).
6. **Don't AVL where a hash map would do.** O(log n) is fast but O(1) is faster when you don't need order.
7. **For >100K nodes, consider a B-tree.** Cache misses dominate; B-tree's high branching factor wins by 2–5×.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Pick one height convention and document it.** `height(null) = -1, height(leaf) = 0` is most common; never mix.
- **Encapsulate rotations as private helpers.** Public API is `insert`, `delete`, `search`, `inorder`. Rotations are an implementation detail.
- **Use the "return new subtree root" pattern everywhere.** It compose cleanly and matches functional-AVL implementations.
- **Write a `verify()` debug method** that walks the whole tree and asserts (a) BST property, (b) `|bf| ≤ 1`, (c) cached heights match recomputed heights. Run it in tests after every random sequence.
- **Test with the Fibonacci tree generator** (`tasks.md` task 9). It is the only input that produces the worst-case AVL height; many bugs only surface there.
- **For maps, store value alongside key.** A real AVL map node is `(key, value, left, right, height)`.
- **Use generics in Go/Java.** Avoid `interface{}` / `Object` boxing; the comparison cost dominates.
- **Compare to red-black before shipping.** If your workload is more writes than reads, red-black wins.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Expected behavior |
|---|---|
| Empty tree, search | Return null / -1 / `None` |
| Empty tree, insert | New root with height 0 |
| Empty tree, delete | No-op |
| Delete root with no children | Tree becomes empty |
| Delete root with one child | Child becomes new root |
| Delete root with two children | Successor replaces root; subtree rebalances |
| Insert key equal to existing | Default: silently ignore. Some APIs return false |
| Single-node tree | bf=0; both child subtrees null, height=-1, node height=0 |
| Two-node tree (root + left child) | root bf=+1, leaf bf=0; balanced |
| Two-node tree (root + right child) | root bf=-1, leaf bf=0; balanced |
| Insert into LL pattern at root | Single right rotation; new root is former left child |
| Delete from leftmost causing cascade up to root | Up to log n rotations; height shrinks by 1 |
| All identical keys inserted | If duplicates ignored, tree stays single node |
| Strictly increasing inserts (1,2,3,...,n) | Repeated RR rotations; final tree is balanced of height ⌈log₂ n⌉ |
| Strictly decreasing inserts | Repeated LL rotations; same final shape mirrored |
| Random permutation of [1..n] | Tree has height very close to log₂ n |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Updating the parent's height before the child's height after a rotation.** Always children first, parent second.
2. **Using `> 0` instead of `>= 0` in the delete rebalance LL test.** Works for insert, breaks for delete.
3. **Forgetting to re-assign the returned subtree root.** `Insert(root, x)` → must do `root = Insert(root, x)`.
4. **Mismatched height conventions.** Mixing `height(null)=-1` and `height(null)=0` across modules silently breaks balance factors.
5. **Skipping rebalance in delete two-child case.** After the successor swap and recursive delete, the recursion already rebalanced the right subtree — but you still must rebalance the current node.
6. **Using key comparison for delete case selection.** The key is gone; use bf of the heavier child.
7. **Recomputing height by traversing the subtree.** Caching is the entire point. Always read `node.Height`, never `height(node.Left) + 1` recursively.
8. **Mutating the tree during inorder traversal.** Breaks iterator state. Snapshot first.
9. **Concurrent reads and writes without synchronization.** Rotations move keys; readers can briefly see a non-BST shape.
10. **Allocating a new node on every rotation.** Rotations are in-place pointer rewires; only `updateHeight` mutates per-node data.
11. **Not handling the duplicate-key case.** Decide explicitly: ignore, count, or list of values per key.
12. **Believing AVL "doesn't need" the iterative version.** For deeply recursive systems or low-stack environments, iterative is the safe choice.
13. **Using AVL when a sorted array would do.** If reads dominate and inserts are rare, a sorted array + binary search beats AVL on cache locality.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
NODE FIELDS
    key, left, right, height
    height(null) = -1; height(leaf) = 0

BALANCE FACTOR
    bf(n) = height(n.left) - height(n.right)
    Invariant: |bf(n)| ≤ 1 for every node n

ROTATIONS (O(1) each, preserve inorder)
    rotateRight(y) with x = y.left:
        x.right = y; y.left = (old x.right); update y; update x; return x
    rotateLeft(x) with y = x.right:
        y.left  = x; x.right = (old y.left ); update x; update y; return y

CASE SELECTION (after change, |bf(z)| = 2)
    bf(z) > 0, bf(z.left)  >= 0 → LL → rotateRight(z)
    bf(z) > 0, bf(z.left)  <  0 → LR → rotateLeft(z.left); rotateRight(z)
    bf(z) < 0, bf(z.right) <= 0 → RR → rotateLeft(z)
    bf(z) < 0, bf(z.right) >  0 → RL → rotateRight(z.right); rotateLeft(z)

REBALANCE
    updateHeight(n); apply case → return new subtree root

ROTATIONS PER OPERATION
    insert: at most 2 (1 single OR 1 double)
    delete: up to O(log n) cascading

COMPLEXITY
    search/insert/delete: O(log n) guaranteed
    height bound: h ≤ 1.44 log₂(n+2) - 0.328
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. Insert and delete keys one at a time; the animation highlights:

- The **traversal path** in blue.
- The **balance factor** beside each node, updated bottom-up after each operation.
- The **unbalanced node** in red when `|bf| > 1`.
- The **rotation type label** (LL / LR / RL / RR) above the unbalanced node.
- The **pivot smoothly swapping position** with the rotated parent, animating the structural change.

Stats panel tracks node count, height, total rotations, and last operation type. The "Random Build" button inserts a random permutation; "Fibonacci" inserts the worst-case sparse sequence so you can see the tightest legal AVL shape.

Walking through 8–10 inserts on the animation cements the four-case mental model faster than reading any code.

---

<a name="summary"></a>
## 18. Summary

- **AVL trees solved the BST degeneration problem** in 1962 — the first self-balancing BST, by Adelson-Velsky and Landis.
- Each node caches its **height**. The **balance factor** `bf = h(left) - h(right)` must satisfy `|bf| ≤ 1` everywhere.
- After every insert and delete, walk back up to the root and rebalance using **rotations**. Four cases: LL → rotateRight, RR → rotateLeft, LR → rotateLeft-then-rotateRight, RL → rotateRight-then-rotateLeft.
- **Insert** triggers at most 2 rotations. **Delete** can cascade O(log n) rotations.
- The AVL height is bounded by `1.44 log₂(n+2)`, achieved by the Fibonacci tree. Search, insert, delete all run in O(log n) worst case.
- Always use the **"return new subtree root"** pattern. Update **children's heights before the parent's**. Use **balance factor of the child** (not the inserted key) for delete case selection.
- AVL is best for read-heavy in-memory workloads, range trees, and any application demanding tight worst-case lookup. Red-black (less strict balance, fewer rotations on writes) wins write-heavy workloads.

Master AVL and you own the rotation mechanic that underlies red-black trees, AA trees, splay trees, scapegoat trees, treaps, weight-balanced trees, and WAVL. Every self-balancing BST is "AVL with a different invariant".

---

<a name="further-reading"></a>
## 19. Further Reading

- **Adelson-Velsky, G. M. & Landis, E. M.** (1962). *"An algorithm for the organization of information"* (in Russian). *Doklady Akademii Nauk SSSR* 146 (2), 263–266. The original paper. English translation appears in *Soviet Mathematics Doklady*, 3, 1259–1263 (1962). This is where it all started.
- **Knuth, D. E.** *The Art of Computer Programming, Volume 3: Sorting and Searching*, 2nd ed., Addison-Wesley, 1998. Section 6.2.3 ("Balanced Trees") gives the height bound proof and the Fibonacci-tree extremal analysis.
- **Sedgewick, R. & Wayne, K.** *Algorithms*, 4th ed., Addison-Wesley, 2011. Chapter 3.3 discusses balanced search trees in the context of red-black 2–3 trees; the AVL exposition in older Sedgewick editions is excellent.
- **Cormen, Leiserson, Rivest, Stein** (CLRS). *Introduction to Algorithms*, 3rd ed., MIT Press, 2009. Chapter 13 on red-black trees; the appendix exercises cover AVL.
- **Goodrich, M. T. & Tamassia, R.** *Data Structures and Algorithms in Java*, 6th ed., Wiley, 2014. Chapter 11.2 gives a polished, modern AVL exposition with the trinode-restructuring formulation.
- Continue with `middle.md` for the height bound proof, iterative AVL, bulk-load, order-statistic AVL, and comparison with red-black.
