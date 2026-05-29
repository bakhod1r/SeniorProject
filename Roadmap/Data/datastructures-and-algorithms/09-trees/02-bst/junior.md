# Binary Search Tree (BST) — Junior Level

> **Read time: ~40 minutes** · **Audience:** Students who have just finished the previous topic, *Binary Tree*, and are comfortable with recursion, references/pointers, and the four traversals (preorder, inorder, postorder, level order).

A **Binary Search Tree** is the simplest tree structure that gives you fast `search`, `insert`, and `delete` all at the same time — when it behaves. It is also a perfect teaching ground for one of the most important lessons in data-structure design: **a clever invariant is worthless if you forget to maintain it**. A BST that grows out of an unlucky input degenerates into a linked list and loses every advantage it was supposed to give you.

In this document we walk the unbalanced BST end to end: the ordering invariant, why an inorder traversal magically produces a sorted sequence, the three classic deletion cases (no child, one child, two children — solved with the **inorder successor** trick by Hibbard in 1962), the iterative and recursive implementations in Go, Java, and Python, and the degeneration problem that motivates AVL, Red-Black, B-trees, and every other balanced tree the industry actually uses in production.

---

## Table of Contents

1. [Introduction — The BST Invariant](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies (and a Trap)](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Iterative Versions](#iterative)
11. [Coding Patterns](#patterns)
12. [Error Handling — Duplicates and `null`](#errors)
13. [Performance Tips — Input Order Matters](#performance-tips)
14. [Best Practices](#best-practices)
15. [Edge Cases](#edge-cases)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Visual Animation Reference](#animation)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — The BST Invariant

A binary tree by itself imposes **no order** on the values its nodes carry. The previous topic (`01-binary-tree`) showed you how to walk such a tree, but a plain binary tree gives you nothing better than O(n) search — you must visit every node to look up a value.

A **Binary Search Tree** is a binary tree with a single extra rule, the **BST invariant**:

> For every node `x`:
> - every key in the **left** subtree of `x` is **strictly less than** `x.key`, and
> - every key in the **right** subtree of `x` is **strictly greater than** `x.key`.
> - This rule applies recursively to every subtree.

That single rule is what turns a tree into a search structure. With the invariant in place:

- **Search** becomes a path from the root to (at most) a leaf: at every node you compare and go left or right. The path has length equal to the **height** of the tree.
- **Insert** is "search until you fall off, then attach there".
- **Delete** is "find the node, then splice it out while preserving the invariant".

All three operations take time proportional to the **height** of the tree, written `h`. If the tree happens to be **balanced** (left and right subtrees of every node have similar depth), `h ≈ log₂ n` and these operations are O(log n) — which is what makes BSTs interesting. If the tree is **unbalanced**, `h` can be as bad as `n`, and the BST degenerates into a glorified linked list.

A standalone BST has **no mechanism** to keep itself balanced. That is why `std::set`, `std::map`, Java `TreeMap`/`TreeSet`, and basically every production "ordered map" use a **balanced** variant (Red-Black, AVL, B-tree). We cover those in `03-avl` and `04-red-black`. This document is about the raw BST and what it does and does not give you.

The pedagogical reason we start here is that everything you learn — the invariant, the three deletion cases, the inorder-traversal-yields-sorted property, the recursive "return new subtree root" style — carries forward unchanged to AVL and Red-Black, which add **rotations** on top. Get this layer right and the balanced variants become "BST + extra bookkeeping".

---

<a name="prerequisites"></a>
## 2. Prerequisites

You should be comfortable with everything in `01-binary-tree` plus the following:

1. **Binary tree mechanics.** A node has a key (or value) plus two child references called `left` and `right`, each possibly null. A *leaf* is a node with both children null. The *root* is the node with no parent; an empty tree has `root == null`.
2. **Recursion on subtrees.** The standard pattern: "to do X on the tree rooted at `node`, do X on `node.left`, do X on `node.right`, then combine." If recursion still feels foreign, drill `01-binary-tree` until walking a tree recursively is automatic.
3. **A total order on keys.** "Total order" means that for any two keys `a` and `b`, exactly one of `a < b`, `a == b`, `a > b` holds, and the order is transitive (`a < b ∧ b < c ⇒ a < c`). Integers, strings (lexicographic), tuples — all fine. Floating-point `NaN` is **not** totally ordered with itself (`NaN != NaN`), and trying to insert `NaN` into a BST will break it silently. Custom types need a `Comparable` / `Comparator` / `<` operator that satisfies the rules.
4. **Pointers vs values.** In Java and Python, tree nodes are objects accessed by reference. In Go, you use `*Node`. The distinction matters when you "modify a subtree" — you either mutate fields in place, or you rebuild the parent's link to a new subtree root.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **BST property / invariant** | The ordering rule: left subtree < node < right subtree, recursively. |
| **Search path** | The sequence of nodes visited from the root to either the target or the empty position where the target would be. Length = path length, at most `h`. |
| **Insertion path** | The search path for the new key. The new node is attached at its tail. |
| **Inorder traversal** | Visit left subtree, then current node, then right subtree. On a BST, produces a **sorted** sequence of keys. |
| **Inorder successor** | The next key after `x` in sorted order. If `x` has a right child, it is the **leftmost** node of the right subtree; otherwise it is the lowest ancestor whose left subtree contains `x`. |
| **Inorder predecessor** | The previous key. Symmetric: rightmost of the left subtree, or the lowest ancestor whose right subtree contains `x`. |
| **Leaf** | A node with no children. The simplest case in deletion. |
| **Height (`h`)** | Length of the longest root-to-leaf path. A single-node tree has height 0 (some textbooks use 1; this doc uses **height-of-edges** so root-only = 0). |
| **Balanced** | Informal: `h = O(log n)`. Each balanced-tree family has its own precise definition. |
| **Skewed / degenerate tree** | A tree where every node has at most one child along one direction; `h = n - 1`. The result of inserting sorted input into a vanilla BST. |
| **Leaf-replace deletion** | The trivial deletion case: target is a leaf — just detach it. |
| **Hibbard deletion** | The classical algorithm for deleting a node with two children: replace its key with the inorder successor's key, then delete the successor (which by definition has at most one child). Published by Thomas N. Hibbard in 1962. |
| **Duplicate key policy** | Decision: reject, replace, or treat the tree as a multiset (allow duplicates by convention going right). Project-specific; pick one and document it. |

---

<a name="core-concepts"></a>
## 4. Core Concepts

### 4.1 The BST invariant, formally

For every node `x` in the tree, two conditions hold simultaneously:

```
∀ y ∈ leftSubtree(x):  y.key < x.key
∀ z ∈ rightSubtree(x): z.key > x.key
```

The classic interview trap is to verify only the **direct children** of a node (`x.left.key < x.key` and `x.right.key > x.key`) and conclude the tree is a BST. **That is wrong.** The invariant has to hold for every descendant, not just the immediate child. We come back to this in `interview.md` (LC 98).

### 4.2 Why an inorder traversal yields a sorted sequence

Inorder traversal = "left, node, right". On a BST, by induction:

- The base case is the empty subtree, which yields the empty (already-sorted) sequence.
- For a non-empty subtree rooted at `x`: by hypothesis, `inorder(x.left)` is sorted and contains keys all less than `x.key`. Then we emit `x.key` (still in order). Then `inorder(x.right)` is sorted and contains keys all greater than `x.key`. Concatenated: still sorted.

This is the single most important property of BSTs in practice. It means a BST is simultaneously a **sorted container** and a **searchable container** — you get sorted iteration for free.

### 4.3 Search

To search for `target`:

```
node = root
while node != null:
    if target == node.key: return node     # found
    if target <  node.key: node = node.left
    else:                  node = node.right
return null                                # not found
```

At each step you eliminate one entire subtree. The number of comparisons equals the depth of `target` (or the depth of the empty position where it would be). Worst case: height of the tree.

### 4.4 Insert

Inserting `key` follows the same path as a search; when you "fall off" (reach a null child), attach a fresh node there:

```
if root == null: root = new Node(key); return
node = root
while True:
    if key == node.key: handle duplicate (reject / replace / multiset)
    if key <  node.key:
        if node.left == null: node.left = new Node(key); return
        node = node.left
    else:
        if node.right == null: node.right = new Node(key); return
        node = node.right
```

The new node is always inserted as a **leaf**. The tree's shape is determined entirely by the **order** in which keys are inserted — not by the keys themselves. This is the seed of the degeneration problem.

### 4.5 Delete — the three cases (Hibbard 1962)

Delete is the only non-trivial operation. There are three cases, in increasing order of complexity:

**Case A — target has no children (leaf).** Just remove it: set its parent's link to `null`.

**Case B — target has exactly one child.** Splice it out: replace the target in its parent's link with its only child.

**Case C — target has two children.** You cannot simply detach it — the tree would lose either the left or right subtree. Hibbard's solution:

1. Find the **inorder successor** `s` of the target (= leftmost node of the target's right subtree).
2. **Copy** `s.key` into the target's slot.
3. **Delete** `s` from the right subtree. By construction, `s` has no left child (it's the leftmost), so this delete falls into case A or case B and recurses one level.

This preserves the invariant: `s.key` is the smallest key greater than every key in the left subtree and the smallest key in the right subtree, so it slots in perfectly.

You can equally use the **inorder predecessor** (rightmost of the left subtree). Convention varies; this document uses inorder successor consistently. A subtle issue is that Hibbard deletion is **not symmetric**: repeated deletions of always-the-successor make the tree drift toward an unbalanced shape over time. This is the *Hibbard deletion asymmetry* problem, studied by Knuth and others — alternating between predecessor and successor improves but does not fix it. Balanced trees fix it properly.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | Best case | Average case (random insertion order) | Worst case (skewed) |
|---|---|---|---|
| Search | O(1) | O(log n) | O(n) |
| Insert | O(1) | O(log n) | O(n) |
| Delete | O(1) | O(log n) | O(n) |
| Inorder traversal | O(n) | O(n) | O(n) |
| Find min / max | O(1) | O(log n) | O(n) |
| Build from `n` keys | O(n) | O(n log n) expected | O(n²) |
| Space | O(n) | O(n) | O(n) |

All three primary operations are **O(h)** where `h` is the tree's height. The single most important takeaway from this table: the worst case is **O(n)**. A bare BST guarantees nothing about height. AVL and Red-Black guarantee `h = O(log n)` by spending a constant per operation to keep the tree balanced.

**Expected height with random insertion order:** It is a classical result (proved by Robson 1979 and others) that inserting `n` distinct keys in **uniformly random order** yields a BST of expected height `Θ(log n)` — roughly `4.31 log n` in the limit. So a randomly built BST is balanced *on average*. The problem is real inputs are rarely uniformly random.

---

<a name="analogies"></a>
## 6. Real-World Analogies (and a Trap)

### 6.1 A sorted dictionary you also frequently insert into

Picture a paper dictionary that you keep adding new words to. With a flat sorted array, every new word requires shifting half the existing entries — terrible. With a BST, each insertion just walks a path of length `h` and attaches a new leaf. Searching is the same walk. The structure of the dictionary mirrors the order in which you happened to add the words.

### 6.2 The "20 questions" game

You guess a value by asking yes/no questions that split the remaining candidates roughly in half. A BST encodes exactly such a sequence of yes/no questions: at every node, the question is "is your key less than this?". Reaching a leaf is reaching a conclusion.

### 6.3 A common BUT WRONG analogy: the Unix process tree by PID

A common mistake is to think of any hierarchical "tree" in the operating system as a BST. The Linux process tree (`pstree`, `ps -ef --forest`) is a tree, but its child links represent **parent-child process relationships**, not key ordering by PID. PIDs in the process tree are **not** ordered as in a BST — a parent process can have a smaller or larger PID than its children. Be deliberate about which kind of tree something is before reaching for BST intuitions. (See `senior.md` for what the Linux kernel actually *does* use BSTs for — the answer involves `rbtree` for memory regions and CFS scheduling.)

### 6.4 A choose-your-own-adventure book

Each page asks a question and tells you "if yes, go to page X, if no, go to page Y". The story tree is structurally a BST-like binary tree where the branching encodes information rather than ordering.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros

- **All three operations in one structure.** Sorted array gives O(log n) search but O(n) insert/delete. Hash table gives O(1) average insert/search/delete but no ordering. BST gives O(log n) for everything *when balanced*, plus sorted iteration.
- **Inorder traversal yields a sorted sequence in O(n).** No extra sorting step.
- **Range queries are natural.** Print all keys in `[lo, hi]` in `O(k + h)` where `k` is the number of matches. Hash tables can't do this efficiently.
- **Successor and predecessor are O(h).** Hash tables can't do this at all.
- **Conceptually simple.** A node with two pointers and a key; the invariant in one sentence.

### Cons

- **No balancing.** Adversarial input (sorted, reverse-sorted) gives O(n) height. This is *the* reason raw BSTs are not used in production.
- **Pointer chasing is cache-hostile.** Each node is a separate heap allocation; traversal jumps around memory. A sorted array's binary search is much faster on modern hardware for read-mostly workloads.
- **Per-node overhead.** Two pointers (16 bytes on 64-bit systems) per key, plus header bytes. For 32-bit integer keys, the overhead is 4× the data.
- **Deletion is the trickiest part.** Three cases, easy to get wrong. We will write it carefully below.
- **Hibbard-deletion asymmetry.** Long-lived trees under many deletions slowly skew.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

### 8.1 Insertion sequence: 5, 3, 8, 1, 4, 7, 9

Start with an empty tree.

**Insert 5.** Tree is empty, so `5` becomes the root.

```
    5
```

**Insert 3.** Compare with 5: `3 < 5`, go left. Left is null → attach.

```
    5
   /
  3
```

**Insert 8.** `8 > 5`, go right. Right is null → attach.

```
    5
   / \
  3   8
```

**Insert 1.** `1 < 5` → left to 3. `1 < 3` → left of 3 is null → attach.

```
    5
   / \
  3   8
 /
1
```

**Insert 4.** `4 < 5` → left to 3. `4 > 3` → right of 3 is null → attach.

```
    5
   / \
  3   8
 / \
1   4
```

**Insert 7.** `7 > 5` → right to 8. `7 < 8` → left of 8 is null → attach.

**Insert 9.** `9 > 5` → right to 8. `9 > 8` → right of 8 is null → attach.

Final tree:

```
        5
       / \
      3   8
     / \ / \
    1  4 7  9
```

**Inorder traversal** (left, node, right): `1, 3, 4, 5, 7, 8, 9` — sorted, as expected.

### 8.2 Search for 7

Start at root 5. `7 > 5`, go right to 8. `7 < 8`, go left to 7. `7 == 7` — found. Three comparisons, path length 2.

### 8.3 Delete 5 (the root, with two children)

The root has two children, so this is Case C. Steps:

1. Find inorder successor of 5: leftmost of right subtree.
   - Right subtree is rooted at 8. Walk left: 8.left = 7. 7.left = null → 7 is the successor.
2. Copy 7's key into the root.
3. Delete 7 from the right subtree (where it sits as a leaf, Case A).

Result:

```
        7
       / \
      3   8
     / \   \
    1  4    9
```

Inorder: `1, 3, 4, 7, 8, 9`. Sorted. Invariant preserved.

### 8.4 Now delete 3 (has two children)

Successor of 3: leftmost of its right subtree (which is just 4 — a leaf). Copy 4 into 3's slot, delete 4 from the right subtree.

```
        7
       / \
      4   8
     /     \
    1       9
```

Inorder: `1, 4, 7, 8, 9`. Sorted. Done.

### 8.5 Then delete 8 (has one child)

Case B: 8 has only a right child (9). Splice it out — replace 8 in its parent (the root 7) with 9.

```
        7
       / \
      4   9
     /
    1
```

Inorder: `1, 4, 7, 9`. Sorted. Done.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Node definition

**Go:**
```go
package bst

type Node struct {
    Key         int
    Left, Right *Node
}
```

**Java:**
```java
public class BSTNode {
    int key;
    BSTNode left, right;

    public BSTNode(int key) {
        this.key = key;
    }
}
```

**Python:**
```python
class Node:
    __slots__ = ("key", "left", "right")
    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None
```

The `__slots__` declaration in Python saves memory by avoiding the per-instance `__dict__`; tree nodes are created in large numbers, so it matters.

### 9.2 Recursive insert

The standard idiom is "return the (possibly new) root of the subtree". This avoids parent pointers entirely.

**Go:**
```go
// Insert returns the new root of the subtree after inserting key.
// Duplicate keys are silently rejected; see middle.md for alternatives.
func Insert(root *Node, key int) *Node {
    if root == nil {
        return &Node{Key: key}
    }
    if key < root.Key {
        root.Left = Insert(root.Left, key)
    } else if key > root.Key {
        root.Right = Insert(root.Right, key)
    }
    // key == root.Key: ignore duplicate
    return root
}
```

**Java:**
```java
public static BSTNode insert(BSTNode root, int key) {
    if (root == null) return new BSTNode(key);
    if (key < root.key)      root.left  = insert(root.left,  key);
    else if (key > root.key) root.right = insert(root.right, key);
    // duplicate: ignore
    return root;
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
    # duplicate: ignore
    return root
```

The "return new subtree root" pattern is the single most important idiom in this file. It is used by every recursive BST function. Internalize it.

### 9.3 Recursive search

**Go:**
```go
func Search(root *Node, key int) *Node {
    if root == nil || root.Key == key {
        return root
    }
    if key < root.Key {
        return Search(root.Left, key)
    }
    return Search(root.Right, key)
}
```

**Java:**
```java
public static BSTNode search(BSTNode root, int key) {
    if (root == null || root.key == key) return root;
    if (key < root.key) return search(root.left,  key);
    return                       search(root.right, key);
}
```

**Python:**
```python
def search(root, key):
    if root is None or root.key == key:
        return root
    if key < root.key:
        return search(root.left, key)
    return search(root.right, key)
```

### 9.4 Recursive delete (Hibbard, inorder successor)

**Go:**
```go
// Delete removes key from the BST rooted at root and returns the new root.
// If key is absent the tree is unchanged.
func Delete(root *Node, key int) *Node {
    if root == nil {
        return nil
    }
    switch {
    case key < root.Key:
        root.Left = Delete(root.Left, key)
    case key > root.Key:
        root.Right = Delete(root.Right, key)
    default:
        // Found the node to delete.
        if root.Left == nil {
            return root.Right            // Case A or B (no left child)
        }
        if root.Right == nil {
            return root.Left             // Case B (no right child)
        }
        // Case C: two children. Replace key with inorder successor.
        succ := findMin(root.Right)
        root.Key = succ.Key
        root.Right = Delete(root.Right, succ.Key)
    }
    return root
}

func findMin(n *Node) *Node {
    for n.Left != nil {
        n = n.Left
    }
    return n
}
```

**Java:**
```java
public static BSTNode delete(BSTNode root, int key) {
    if (root == null) return null;
    if (key < root.key) {
        root.left = delete(root.left, key);
    } else if (key > root.key) {
        root.right = delete(root.right, key);
    } else {
        if (root.left  == null) return root.right;    // Case A or B
        if (root.right == null) return root.left;     // Case B
        BSTNode succ = findMin(root.right);           // Case C
        root.key   = succ.key;
        root.right = delete(root.right, succ.key);
    }
    return root;
}

private static BSTNode findMin(BSTNode n) {
    while (n.left != null) n = n.left;
    return n;
}
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
        # Found
        if root.left is None:
            return root.right          # case A or B
        if root.right is None:
            return root.left           # case B
        succ = _find_min(root.right)   # case C
        root.key = succ.key
        root.right = delete(root.right, succ.key)
    return root

def _find_min(n):
    while n.left is not None:
        n = n.left
    return n
```

A subtle but important point: when we copy `succ.key` into `root` and recursively delete `succ.key` from the right subtree, the recursion is guaranteed to fall into Case A or Case B (because `succ` is the leftmost of its subtree, so it has no left child). The recursion adds at most one extra level — O(h) total.

---

<a name="iterative"></a>
## 10. Iterative Versions

Iterative versions trade clarity for O(1) stack space. They are preferred for very deep trees (which, for unbalanced BSTs, can happen) and for languages without good tail-call optimization (Java, Go).

### 10.1 Iterative search

**Go:**
```go
func SearchIter(root *Node, key int) *Node {
    for n := root; n != nil; {
        switch {
        case key == n.Key:
            return n
        case key <  n.Key:
            n = n.Left
        default:
            n = n.Right
        }
    }
    return nil
}
```

**Java:**
```java
public static BSTNode searchIter(BSTNode root, int key) {
    BSTNode n = root;
    while (n != null) {
        if (key == n.key) return n;
        n = (key < n.key) ? n.left : n.right;
    }
    return null;
}
```

**Python:**
```python
def search_iter(root, key):
    n = root
    while n is not None:
        if key == n.key:
            return n
        n = n.left if key < n.key else n.right
    return None
```

### 10.2 Iterative insert

**Go:**
```go
func InsertIter(root *Node, key int) *Node {
    newNode := &Node{Key: key}
    if root == nil {
        return newNode
    }
    n := root
    for {
        switch {
        case key == n.Key:
            return root                  // duplicate, ignore
        case key <  n.Key:
            if n.Left == nil { n.Left = newNode; return root }
            n = n.Left
        default:
            if n.Right == nil { n.Right = newNode; return root }
            n = n.Right
        }
    }
}
```

**Python:**
```python
def insert_iter(root, key):
    if root is None:
        return Node(key)
    n = root
    while True:
        if key == n.key:
            return root
        if key < n.key:
            if n.left is None:
                n.left = Node(key); return root
            n = n.left
        else:
            if n.right is None:
                n.right = Node(key); return root
            n = n.right
```

### 10.3 Iterative delete (parent-tracking)

Iterative delete requires tracking the parent of the current node so you can rewrite its child link. We will not write it here in full because the recursive version is shorter and clearer; see `tasks.md` for a fully iterative implementation.

---

<a name="patterns"></a>
## 11. Coding Patterns

### 11.1 "Recurse on a subtree, return the new subtree root"

This single idiom underlies insert, delete, and most BST transformations. The signature is `f(node, ...) -> Node`. Inside, you either return `node` unchanged or return a different node (a newly created one, the spliced-in child, or the rebuilt subtree root). The caller does `node.left = f(node.left, ...)` so the parent's link is rewritten automatically. **No parent pointers, no explicit parent argument, no global state.**

### 11.2 "Find leftmost / rightmost"

Walk down `left` (or `right`) until you can't. Returns the min (or max) key in the subtree. Used in deletion, predecessor/successor, range queries.

### 11.3 "Compare-and-descend"

Search-style operations: at each node, compare against `key`, descend left or right (or return). This pattern is used in `search`, `insert`, `LCA`, `range`, `validate`.

### 11.4 "Inorder accumulator"

To produce a sorted list of keys, do an inorder traversal pushing keys into an accumulator. Variants: stop early (kth-smallest), filter (in-range), pair up (closest pair). Stack-based iterative inorder is in `middle.md`.

---

<a name="errors"></a>
## 12. Error Handling — Duplicates and `null`

### 12.1 Duplicate key policy

Decide *before* you write code:

- **Reject** (the default in this document): insert is a no-op when the key already exists.
- **Replace value** (when the node carries an associated payload, e.g., a map): keep the existing node, overwrite its `value` field.
- **Multiset** (allow duplicates): convention is to send equal keys consistently right (or left). This is its own data structure; see `05-basic-data-structures/07-multiset-bag`. Pure BSTs as multisets are rare in practice because the unbalanced shape gets worse.

Whichever policy you pick, **document it** at the function signature and stick to it across the codebase. Mixing policies inside a single tree leads to keys being lost or duplicated mysteriously.

### 12.2 Null / empty tree

Every function must handle `root == null`:
- `Search(null, k)` → `null` / `None`
- `Insert(null, k)` → new single-node tree
- `Delete(null, k)` → `null`
- `Traverse(null)` → no output

Treat the empty tree as a valid value, not an error.

### 12.3 Floating-point / NaN

Don't store `NaN` keys. Comparisons with `NaN` always return false, so `Insert(NaN)` will walk one branch forever (well, until the loop attaches it somewhere) and `Search(NaN)` will never find anything. Filter or reject `NaN` at the API boundary.

### 12.4 Stack overflow

A skewed BST with n = 100,000 nodes will cause recursive `Insert`/`Search`/`Delete` to recurse 100,000 deep and **blow the stack** in Go and Java. Use the iterative versions for unbounded inputs, or rely on a balanced tree.

---

<a name="performance-tips"></a>
## 13. Performance Tips — Input Order Matters

This is the single most important practical lesson about BSTs.

**Insertion order determines tree shape.** Same set of keys, different insertion orders, completely different trees.

### Example: insert `1, 2, 3, 4, 5` into an empty BST in two different orders.

**Order A — sorted (1, 2, 3, 4, 5):**

```
1
 \
  2
   \
    3
     \
      4
       \
        5
```

Height 4. Every operation is O(n). The "BST" is now a singly linked list with one wasted pointer per node. Search for 5 takes 5 comparisons — exactly what linear search costs.

**Order B — interleaved (3, 1, 4, 2, 5):**

```
    3
   / \
  1   4
   \   \
    2   5
```

Height 2. Search for 5 takes 3 comparisons.

For random insertion order, you usually get something close to Order B. But "usually" is not "always". Real-world inputs are often already sorted (events by timestamp, user IDs assigned monotonically, sensor readings). Inserting them naively into a vanilla BST gives the worst possible shape.

### Mitigations

1. **Randomize input order before bulk insert.** If you have all keys up front, shuffle them. Expected height becomes `O(log n)`.
2. **Insert the median first.** If you have a sorted array, insert middle, then recurse left and right halves. Gives a perfectly balanced tree in `O(n)`. We code this in `tasks.md` (build-from-sorted-array).
3. **Use a balanced tree.** AVL, Red-Black, B-tree — covered in `03-avl`, `04-red-black`, `08-b-tree`. This is what production code does.
4. **Use a randomized BST (treap, randomized BST).** Briefly covered in `middle.md`. Trades determinism for expected balance without explicit rotations.

---

<a name="best-practices"></a>
## 14. Best Practices

- **Pick and document a duplicate policy.** Reject is the safest default.
- **Use the recursive "return new root" idiom.** It is shorter, more obvious, and avoids parent-pointer bugs.
- **Test deletion exhaustively.** All three cases × root vs internal vs leaf × tree of size 1, 2, 3, 4. Most BST bugs hide in delete.
- **Inorder-traverse and verify sortedness** in unit tests. A single inorder check catches almost every invariant violation.
- **Don't use a vanilla BST for unsorted user input.** Reach for `TreeMap` / `std::map` / `sortedcontainers.SortedDict` or build the input randomly.
- **Use a stack-based iterative traversal** when the tree might be deep. Recursive walks blow the stack on skewed trees.
- **Avoid storing parent pointers** unless you specifically need successor in O(1) amortized; they double the per-node overhead and create cycles for GCs.
- **Profile before optimizing.** A 32-bit-key sorted array with binary search outperforms a heap-allocated BST for read-mostly workloads at most realistic sizes.

---

<a name="edge-cases"></a>
## 15. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty tree, search | `root = null`, search any | `null` |
| Empty tree, insert | `root = null`, insert k | new single-node tree |
| Empty tree, delete | `root = null`, delete any | `null` |
| Single node, delete that node | `root = {k}`, delete k | empty tree |
| Single node, search | `root = {k}`, search k | the node |
| Delete the root with two children | `{5,3,8}`, delete 5 | inorder successor (8) replaces 5 |
| Delete the root with one child | `{5,3}`, delete 5 | tree becomes `{3}` |
| All keys on the left (degenerate) | insert 5,4,3,2,1 | linked list of left children |
| All keys on the right (degenerate) | insert 1,2,3,4,5 | linked list of right children |
| Duplicate key on insert | tree has 5, insert 5 | depends on policy; default reject |
| Delete a key not present | delete 7 from `{5,3,8}` | tree unchanged |
| Two nodes, delete the parent | `{5,3}`, delete 5 | `{3}` |
| Delete a node whose inorder successor is its direct right child | `{5,3,8}`, delete 5 with succ=8 | 8 replaces 5; 5's right becomes 8's old right (null) |

---

<a name="common-mistakes"></a>
## 16. Common Mistakes

1. **Validating BST by comparing only direct children.** Checking `node.left.key < node.key` doesn't enforce the invariant — every descendant in the left subtree must be less. Use min/max bounds (covered in `middle.md`).
2. **Forgetting to return the new subtree root.** Calling `insert(root.left, key)` without assigning the result loses the new node entirely.
3. **Deleting a two-child node by detaching only one subtree.** You lose half the tree.
4. **Using the inorder successor's NODE (not key) and forgetting to splice.** Copy the **key**, then recursively delete from the right subtree. Don't dangle pointers.
5. **Storing duplicates inconsistently.** Sometimes left, sometimes right. Inorder traversal stops being sorted.
6. **Recursing on a skewed tree.** With n = 100,000 already-sorted insertions, recursive search stack-overflows. Use iterative.
7. **Treating BST and balanced BST as the same thing.** They are not. Plain BST has no balance guarantee.
8. **Modifying parent pointers without updating the parent.** If you keep parent pointers, every link change is two writes.
9. **Comparing floating-point keys with `==`.** Use a tolerance, or use integer/string keys.
10. **Inserting into a "BST" without checking the comparator.** A broken comparator (non-transitive, not antisymmetric) silently corrupts the tree.

---

<a name="cheat-sheet"></a>
## 17. Cheat Sheet

```
SEARCH(root, key):
    while root != null and root.key != key:
        root = root.left if key < root.key else root.right
    return root

INSERT(root, key):
    if root == null: return new Node(key)
    if key < root.key: root.left  = INSERT(root.left,  key)
    if key > root.key: root.right = INSERT(root.right, key)
    return root

DELETE(root, key):
    if root == null: return null
    if key < root.key: root.left  = DELETE(root.left,  key)
    elif key > root.key: root.right = DELETE(root.right, key)
    else:
        if root.left  == null: return root.right
        if root.right == null: return root.left
        succ = MIN(root.right)
        root.key = succ.key
        root.right = DELETE(root.right, succ.key)
    return root

INORDER(root):
    if root != null:
        INORDER(root.left)
        VISIT(root)
        INORDER(root.right)

COMPLEXITY: O(h) per op; h = log n balanced, h = n skewed
```

---

<a name="animation"></a>
## 18. Visual Animation Reference

Open `animation.html` in this folder. You can type a comma-separated list of integers and watch them get inserted one by one — each insertion animates the search path, highlights the comparison at every node (yellow on the node being tested, blue on "going left", orange on "going right"), and then attaches the new leaf. The Search button animates the path-to-target. The Delete button animates the three cases visibly; for two-child deletions it highlights the inorder successor before performing the swap. Stats below the canvas show node count, current height, whether the tree is balanced (informally: `height <= 2 * log2(n+1)`), and the running inorder traversal as a sorted sequence.

Insert the sequence `5, 3, 8, 1, 4, 7, 9` and verify the tree from the walkthrough. Then insert `1, 2, 3, 4, 5` and watch the BST degenerate into a right-spine linked list. That visual is more memorable than any paragraph.

---

<a name="summary"></a>
## 19. Summary

- A BST is a binary tree with the invariant `left subtree < node < right subtree`, applied recursively.
- All three primary operations — search, insert, delete — run in O(h) time where `h` is the tree's height.
- `h` ranges from `log₂ n` (balanced) to `n - 1` (skewed). A vanilla BST does nothing to keep `h` small; insertion order determines the shape.
- Inorder traversal of a BST produces a sorted sequence. This is the deepest reason BSTs are useful.
- Deletion has three cases: leaf (detach), one child (splice), two children (replace with inorder successor and recursively delete that successor — Hibbard 1962).
- The "return new subtree root" recursive idiom is the cleanest way to write insert and delete. Use it.
- Vanilla BSTs are almost never used in production. Their value is pedagogical: they teach the invariant and the operations that AVL, Red-Black, and B-trees build on.
- The next topic, `03-avl`, adds the height-balanced invariant and rotations on top of everything in this document.

---

<a name="further-reading"></a>
## 20. Further Reading

- **Hibbard, Thomas N.** "Some Combinatorial Properties of Certain Trees with Applications to Searching and Sorting." *JACM* 9(1), 1962. The original BST deletion paper.
- **Knuth, Donald E.** *The Art of Computer Programming, Volume 3: Sorting and Searching*, Section 6.2.2 ("Binary Tree Searching"). The definitive treatment; includes the famous height-after-many-deletions analysis showing Hibbard deletion's asymmetry.
- **Cormen, Leiserson, Rivest, Stein.** *Introduction to Algorithms* (CLRS), 4th ed., Chapter 12 ("Binary Search Trees"). Standard proofs, including expected height for random insertion order (`Θ(log n)`).
- **Robson, John M.** "The Height of Binary Search Trees." *Australian Computer Journal*, 1979. The expected-height analysis.
- **Sedgewick, Robert and Wayne, Kevin.** *Algorithms*, 4th ed., Chapter 3.2. Excellent practical exposition with code.
- **Eppstein, David.** "Hibbard Deletion." Lecture notes — explanation of why repeated Hibbard deletion drifts the tree shape.
- Continue with `middle.md` for validation, predecessor/successor, range queries, treaps, and splay trees, and with `03-avl` for the first balanced variant.
