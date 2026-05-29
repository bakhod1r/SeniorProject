# Binary Search Tree — Tasks

> **Audience:** Self-study. Each task is a self-contained exercise with a precise specification, hints on the intended approach, and a complete reference solution in Go, Java, or Python (occasionally more than one language for the central exercises). The tasks build on each other; do them in order.

The goal is not just to write code that passes — it is to develop the *muscle memory* for the BST patterns: the "return new subtree root" recursion, the inorder traversal as a sorted iterator, the bounds technique for invariant checks, and the augmentation pattern for order statistics. By the time you finish task 10, you should be able to write any of these from scratch in under five minutes.

---

## Table of Contents

1. [Implement BST: Node + recursive insert/search/delete](#t1)
2. [Build a BST from an input stream and print inorder](#t2)
3. [Validate a BST — bounds vs inorder](#t3)
4. [Iterative k-th smallest (no global state)](#t4)
5. [Inorder successor / predecessor — with and without parent pointers](#t5)
6. [Range query: print all keys in [lo, hi]](#t6)
7. [Convert BST to sorted circular doubly linked list in place](#t7)
8. [Random-input vs sorted-input height experiment](#t8)
9. [Build a balanced BST from a sorted array](#t9)
10. [Augmented BST: subtree size, getRank, getByRank](#t10)
11. [Iterative delete with parent tracking](#t11)

---

<a name="t1"></a>
## Task 1 — Implement BST: Node + recursive insert/search/delete

**Spec.** Implement a generic-int BST with three operations: `insert(root, key)`, `search(root, key)`, `delete(root, key)`. All three return the (possibly new) root of the subtree. Duplicates are rejected (silent no-op). Cover all three deletion cases (no child, one child, two children with Hibbard).

**Hints.** Use the "return new subtree root" recursive idiom from `junior.md`. For deletion's two-child case, find the inorder successor (leftmost of the right subtree), copy its key, recursively delete the successor.

**Reference solution (Python):**

```python
class Node:
    __slots__ = ("key", "left", "right")
    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None

def insert(root, key):
    if root is None:
        return Node(key)
    if key < root.key:
        root.left = insert(root.left, key)
    elif key > root.key:
        root.right = insert(root.right, key)
    return root

def search(root, key):
    if root is None or root.key == key:
        return root
    if key < root.key:
        return search(root.left, key)
    return search(root.right, key)

def delete(root, key):
    if root is None:
        return None
    if key < root.key:
        root.left = delete(root.left, key)
    elif key > root.key:
        root.right = delete(root.right, key)
    else:
        if root.left is None:
            return root.right
        if root.right is None:
            return root.left
        succ = root.right
        while succ.left is not None:
            succ = succ.left
        root.key = succ.key
        root.right = delete(root.right, succ.key)
    return root
```

**Test it.** Build the tree from `junior.md` walkthrough (insert 5, 3, 8, 1, 4, 7, 9), delete 5, then 3, then 8. Verify inorder is `[1, 4, 7, 9]` after all three deletions.

---

<a name="t2"></a>
## Task 2 — Build a BST from an input stream and print inorder

**Spec.** Read integers from standard input (one per line, end with EOF), insert each into a BST, then print all keys in sorted order.

**Hints.** This is the simplest application of "BST as a sorted container". After all insertions, an inorder traversal gives the sorted output.

**Reference solution (Go):**

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "strconv"
    "strings"
)

type Node struct {
    Key         int
    Left, Right *Node
}

func insert(root *Node, key int) *Node {
    if root == nil { return &Node{Key: key} }
    if key < root.Key { root.Left = insert(root.Left, key) }
    if key > root.Key { root.Right = insert(root.Right, key) }
    return root
}

func inorder(root *Node, out *[]int) {
    if root == nil { return }
    inorder(root.Left, out)
    *out = append(*out, root.Key)
    inorder(root.Right, out)
}

func main() {
    sc := bufio.NewScanner(os.Stdin)
    var root *Node
    for sc.Scan() {
        line := strings.TrimSpace(sc.Text())
        if line == "" { continue }
        k, err := strconv.Atoi(line)
        if err != nil { continue }
        root = insert(root, k)
    }
    var out []int
    inorder(root, &out)
    for i, v := range out {
        if i > 0 { fmt.Print(" ") }
        fmt.Print(v)
    }
    fmt.Println()
}
```

**Discussion.** This is "tree-sort". It runs in expected O(n log n) for random input but degrades to O(n²) for sorted input. Compare with `sort.Ints(out)` which is O(n log n) guaranteed — quicksort, in this case, which has its own adversarial worst case.

---

<a name="t3"></a>
## Task 3 — Validate a BST — bounds vs inorder

**Spec.** Write **two** functions, `is_bst_bounds(root)` and `is_bst_inorder(root)`, both returning a bool. Both must correctly reject the trap tree from `middle.md` §7.

**Reference solution (Python):**

```python
import math

def is_bst_bounds(root):
    def rec(n, lo, hi):
        if n is None: return True
        if not (lo < n.key < hi): return False
        return rec(n.left, lo, n.key) and rec(n.right, n.key, hi)
    return rec(root, -math.inf, math.inf)

def is_bst_inorder(root):
    prev = [-math.inf]
    def rec(n):
        if n is None: return True
        if not rec(n.left): return False
        if n.key <= prev[0]: return False
        prev[0] = n.key
        return rec(n.right)
    return rec(root)
```

**Test it.** Build the trap tree explicitly:

```python
root = Node(10)
root.left = Node(5)
root.right = Node(15)
root.right.left = Node(6)     # 6 < 10, in right subtree of 10 → invalid
root.right.right = Node(20)
assert not is_bst_bounds(root)
assert not is_bst_inorder(root)
```

Both must return `False`. A naive "compare with direct children only" version returns `True`, which is the trap.

---

<a name="t4"></a>
## Task 4 — Iterative k-th smallest (no global state)

**Spec.** Implement `kth_smallest(root, k)` iteratively using only an explicit stack. No recursion. No mutable globals.

**Hints.** Stack-based inorder traversal. Decrement `k` each time you "visit" a node; return the node's key when `k == 0`.

**Reference solution (Python):**

```python
def kth_smallest(root, k):
    stack = []
    n = root
    while n is not None or stack:
        while n is not None:
            stack.append(n)
            n = n.left
        n = stack.pop()
        k -= 1
        if k == 0:
            return n.key
        n = n.right
    raise ValueError(f"tree has fewer than k elements")
```

**Reference solution (Go):**

```go
func KthSmallest(root *Node, k int) (int, bool) {
    stack := []*Node{}
    n := root
    for n != nil || len(stack) > 0 {
        for n != nil {
            stack = append(stack, n)
            n = n.Left
        }
        n = stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        k--
        if k == 0 { return n.Key, true }
        n = n.Right
    }
    return 0, false
}
```

**Complexity.** Time O(h + k) — best case the k-th smallest is in the leftmost spine, so the loop iterates `O(h)` pushes plus k pops.

---

<a name="t5"></a>
## Task 5 — Inorder successor / predecessor — with and without parent pointers

**Spec.** Implement two versions of `successor(...)`.
- `successor_root(root, key)`: takes the tree root and a target key.
- `successor_node(node)`: takes a node that has a `.parent` field.

Symmetric for predecessor. The "without parent pointers" version walks down from root; the "with parent pointers" version starts at the node.

**Reference solution (Python):**

```python
def successor_root(root, key):
    """Smallest key > key, or None."""
    succ = None
    n = root
    while n is not None:
        if n.key > key:
            succ = n
            n = n.left
        else:
            n = n.right
    return succ

# Node with parent pointers
class PNode:
    __slots__ = ("key", "left", "right", "parent")
    def __init__(self, key, parent=None):
        self.key = key; self.left = None; self.right = None; self.parent = parent

def successor_node(x):
    """Inorder successor of x. None if x is the maximum."""
    if x.right is not None:
        n = x.right
        while n.left is not None:
            n = n.left
        return n
    # walk up until we cross a left-child edge
    n = x
    while n.parent is not None and n.parent.right is n:
        n = n.parent
    return n.parent
```

**Reference solution (Java):**

```java
public static BSTNode successorFromRoot(BSTNode root, int key) {
    BSTNode succ = null;
    BSTNode n = root;
    while (n != null) {
        if (n.key > key) {
            succ = n;
            n = n.left;
        } else {
            n = n.right;
        }
    }
    return succ;
}

public static PNode successorFromNode(PNode x) {
    if (x.right != null) {
        PNode n = x.right;
        while (n.left != null) n = n.left;
        return n;
    }
    PNode n = x;
    while (n.parent != null && n.parent.right == n) {
        n = n.parent;
    }
    return n.parent;
}
```

**Test.** Build a tree of 1, 3, 5, 7, 9 (already sorted, so this is also the worst case for shape — right-spine). Verify successor of 5 is 7, predecessor of 5 is 3, successor of 9 is None, predecessor of 1 is None.

---

<a name="t6"></a>
## Task 6 — Range query: print all keys in [lo, hi]

**Spec.** Implement `range_keys(root, lo, hi)` returning a list of all keys `k` with `lo <= k <= hi`, in sorted order. Use pruning so subtrees entirely outside `[lo, hi]` are skipped.

**Reference solution (Go):**

```go
func RangeKeys(root *Node, lo, hi int) []int {
    var out []int
    var rec func(*Node)
    rec = func(n *Node) {
        if n == nil { return }
        if n.Key > lo { rec(n.Left) }
        if n.Key >= lo && n.Key <= hi { out = append(out, n.Key) }
        if n.Key < hi { rec(n.Right) }
    }
    rec(root)
    return out
}
```

**Reference solution (Python):**

```python
def range_keys(root, lo, hi):
    out = []
    def rec(n):
        if n is None: return
        if n.key > lo:           rec(n.left)
        if lo <= n.key <= hi:    out.append(n.key)
        if n.key < hi:           rec(n.right)
    rec(root)
    return out
```

**Test.** Build a BST with keys 10, 5, 15, 3, 7, 12, 20. Call `range_keys(root, 6, 14)`. Expected: `[7, 10, 12]`. Verify that the subtree rooted at 3 is never visited (it's entirely below `lo=6`).

**Complexity.** O(k + h) where k is the number of matching keys.

---

<a name="t7"></a>
## Task 7 — Convert BST to sorted circular doubly linked list in place

**Spec.** Reinterpret each node's `left` as `prev` and `right` as `next`. Produce a **circular** doubly linked list (last node's `next` points to the first; first node's `prev` points to the last). Return the head (the smallest key).

**Reference solution (Python):**

```python
def bst_to_circular_dll(root):
    if root is None: return None
    head = [None]; prev = [None]
    def visit(n):
        if n is None: return
        visit(n.left)
        if prev[0] is None:
            head[0] = n
        else:
            prev[0].right = n
            n.left = prev[0]
        prev[0] = n
        visit(n.right)
    visit(root)
    # make it circular
    head[0].left = prev[0]
    prev[0].right = head[0]
    return head[0]
```

**Test.** Build a 5-node BST, convert, then walk the list 5 steps forward and verify you return to the head. Walk 5 steps backward and verify the same.

This problem is LeetCode 426 (premium). Time O(n), no new allocations.

---

<a name="t8"></a>
## Task 8 — Random-input vs sorted-input height experiment

**Spec.** Insert `n = 10,000` distinct keys into two BSTs:
- BST A: keys in **sorted** order (1, 2, ..., 10000).
- BST B: same keys in **random** order.

Measure the resulting **height** of each tree and print them. The expected outcome: A has height 9999 (right-spine), B has height around `2 * log2(10000) ≈ 27` (a small constant times log n).

**Reference solution (Python):**

```python
import random
import sys
sys.setrecursionlimit(100000)

def height(node):
    if node is None: return -1
    return 1 + max(height(node.left), height(node.right))

def build(keys):
    root = None
    for k in keys:
        root = insert(root, k)         # insert from task 1
    return root

if __name__ == "__main__":
    n = 10000
    sorted_keys = list(range(n))
    random_keys = sorted_keys[:]
    random.shuffle(random_keys)

    sys.setrecursionlimit(n + 1000)
    a = build(sorted_keys)
    print(f"sorted input  → height {height(a)}")
    b = build(random_keys)
    print(f"random input  → height {height(b)}")
```

**Expected output (representative):**
```
sorted input  → height 9999
random input  → height 28
```

The factor of ~350× difference is the practical face of the degeneration problem. If you cannot resort the input, you must use a balanced tree.

**Note.** The recursive `insert` from task 1 will stack-overflow on the sorted-keys case for `n = 10000` without raising the recursion limit. This is itself a hint that vanilla BSTs are fragile.

---

<a name="t9"></a>
## Task 9 — Build a balanced BST from a sorted array

**Spec.** Given a sorted array, build a perfectly balanced BST. Return the root. The resulting tree height must be `⌈log₂(n+1)⌉`.

**Reference solution (Java):**

```java
public static BSTNode buildBalanced(int[] arr) {
    return build(arr, 0, arr.length - 1);
}
private static BSTNode build(int[] arr, int lo, int hi) {
    if (lo > hi) return null;
    int mid = lo + (hi - lo) / 2;
    BSTNode node = new BSTNode(arr[mid]);
    node.left  = build(arr, lo, mid - 1);
    node.right = build(arr, mid + 1, hi);
    return node;
}
```

**Reference solution (Go):**

```go
func BuildBalanced(arr []int) *Node {
    var rec func(lo, hi int) *Node
    rec = func(lo, hi int) *Node {
        if lo > hi { return nil }
        mid := lo + (hi-lo)/2
        return &Node{Key: arr[mid], Left: rec(lo, mid-1), Right: rec(mid+1, hi)}
    }
    return rec(0, len(arr)-1)
}
```

**Test.** Build from `[1..1023]`. Height should be exactly 9 (since `2^10 - 1 = 1023`). Inorder traversal should reproduce `[1..1023]`.

**Discussion.** Combined with task 8, you get the "compaction" trick: when your BST gets degraded, inorder-traverse it into a sorted array, then rebuild balanced in O(n).

---

<a name="t10"></a>
## Task 10 — Augmented BST: subtree size, getRank, getByRank

**Spec.** Augment each BST node with a `size` field equal to the size of the subtree rooted at that node. Maintain `size` on insertion and deletion. Implement:
- `get_rank(root, key)`: returns the 1-indexed rank of `key` (number of keys ≤ `key`). If `key` is not present, returns the rank as if it were inserted.
- `get_by_rank(root, k)`: returns the k-th smallest key (1-indexed). Returns None if k is out of range.

**Reference solution (Python):**

```python
class SNode:
    __slots__ = ("key", "left", "right", "size")
    def __init__(self, key):
        self.key = key; self.left = None; self.right = None; self.size = 1

def _size(n):
    return n.size if n is not None else 0

def _update(n):
    n.size = 1 + _size(n.left) + _size(n.right)

def aug_insert(root, key):
    if root is None:
        return SNode(key)
    if key < root.key:
        root.left = aug_insert(root.left, key)
    elif key > root.key:
        root.right = aug_insert(root.right, key)
    _update(root)
    return root

def aug_delete(root, key):
    if root is None: return None
    if key < root.key:
        root.left = aug_delete(root.left, key)
    elif key > root.key:
        root.right = aug_delete(root.right, key)
    else:
        if root.left is None:  return root.right
        if root.right is None: return root.left
        succ = root.right
        while succ.left is not None: succ = succ.left
        root.key = succ.key
        root.right = aug_delete(root.right, succ.key)
    _update(root)
    return root

def get_rank(root, key):
    """Rank = number of keys <= key. Iterative."""
    rank = 0
    n = root
    while n is not None:
        if key < n.key:
            n = n.left
        elif key > n.key:
            rank += _size(n.left) + 1
            n = n.right
        else:
            return rank + _size(n.left) + 1
    return rank      # key not present: rank if it were the largest <= key

def get_by_rank(root, k):
    n = root
    while n is not None:
        left = _size(n.left)
        if k == left + 1:
            return n.key
        if k <= left:
            n = n.left
        else:
            k -= left + 1
            n = n.right
    return None
```

**Test.** Insert 50, 30, 70, 20, 40, 60, 80. Expected sizes:
```
                50 (7)
              /        \
          30 (3)      70 (3)
          /   \        /   \
     20 (1) 40 (1) 60 (1) 80 (1)
```

- `get_rank(50)` → 4
- `get_rank(60)` → 5
- `get_by_rank(1)` → 20
- `get_by_rank(7)` → 80
- `get_by_rank(4)` → 50

This is the **order statistic tree** from `professional.md` §6.1. The augmentation pattern generalizes to interval trees, segment sums, and any associative aggregate over a key range.

---

<a name="t11"></a>
## Task 11 — Iterative delete with parent tracking

**Spec.** Implement `delete_iter(root, key)` without recursion. Track the parent of each node to splice out children correctly.

**Hints.** Step 1: walk down to find the node, remembering the parent. Step 2: handle the three cases by rewriting the parent's appropriate child link.

**Reference solution (Python):**

```python
def delete_iter(root, key):
    parent = None
    node = root
    while node is not None and node.key != key:
        parent = node
        node = node.left if key < node.key else node.right
    if node is None:
        return root     # key not present

    def replace_in_parent(new_child):
        nonlocal root
        if parent is None:
            root = new_child
        elif parent.left is node:
            parent.left = new_child
        else:
            parent.right = new_child

    if node.left is None:
        replace_in_parent(node.right)
    elif node.right is None:
        replace_in_parent(node.left)
    else:
        # find inorder successor (leftmost of right subtree)
        succ_parent = node
        succ = node.right
        while succ.left is not None:
            succ_parent = succ
            succ = succ.left
        # copy successor's key and splice it out
        node.key = succ.key
        if succ_parent.left is succ:
            succ_parent.left = succ.right
        else:
            succ_parent.right = succ.right
    return root
```

**Discussion.** The recursive version is shorter and the compiler in many languages compiles it to similar assembly. The iterative version is the one you write when (a) you don't trust the call stack to be deep enough, or (b) you are writing in a language without a recursion-friendly stack. The latter is common in embedded contexts.

**Test.** Build the tree from task 1, then iteratively delete the root (5). Verify the result matches the recursive version.

---

## Wrap-up

After finishing all eleven tasks, you have written every BST operation in at least one language, exercised the bounds-based invariant check, the augmentation pattern, the in-place DLL conversion, and the random-vs-sorted experiment that motivates everything in `03-avl`.

Recommended next step: **read `03-avl` and implement AVL rotations on top of your task-1 BST**. The AVL invariant is one extra field (`height`) and four rotation cases. Get that working and you have a self-balancing tree of your own design.
