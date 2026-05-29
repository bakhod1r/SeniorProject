# AVL Tree — Interview Problems

> **Audience:** Engineers preparing for senior interviews where AVL or balanced-BST manipulation might come up. Solutions in Go, Java, Python. Prerequisite: `junior.md`.

This document gives nine problems that cover the AVL skill matrix end-to-end: implement insert and delete from scratch, verify balance, build from sorted input, find kth, check generic balance (LC 110), implement an inorder iterator, merge two AVLs, and split one. Each problem includes the spec, the approach, complexity analysis, and full solutions in Go, Java, Python.

---

## Table of Contents

1. [Implement AVL Insert From Scratch](#p1)
2. [Implement AVL Delete With Rebalance](#p2)
3. [Verify a Given Tree Is AVL-Balanced](#p3)
4. [Convert Sorted Array to Balanced AVL](#p4)
5. [Find K-th Smallest in AVL (Augmented)](#p5)
6. [LC 110 — Balanced Binary Tree](#p6)
7. [Implement AVL Iterator (Inorder, O(1) Amortized Per Step)](#p7)
8. [Merge Two AVL Trees in Linear Time](#p8)
9. [Split AVL by Key (Tarjan-Style)](#p9)

---

<a name="p1"></a>
## Problem 1. Implement AVL Insert From Scratch

### Spec
Given a tree root and a key, insert the key and return the new root. Preserve the AVL invariant.

### Approach
Standard BST insert + retrace + case-by-case rotation. We already walked through it in `junior.md`; here is the complete polished version.

### Complexity
- Time: O(log n)
- Space: O(log n) recursion stack
- Rotations: at most 2

### Solutions

**Go:**
```go
type Node struct {
    Key         int
    Left, Right *Node
    Height      int
}

func height(n *Node) int {
    if n == nil { return -1 }
    return n.Height
}

func bf(n *Node) int {
    if n == nil { return 0 }
    return height(n.Left) - height(n.Right)
}

func upd(n *Node) {
    if h := height(n.Left); h > height(n.Right) {
        n.Height = h + 1
    } else {
        n.Height = height(n.Right) + 1
    }
}

func rotR(y *Node) *Node {
    x := y.Left
    y.Left = x.Right
    x.Right = y
    upd(y); upd(x)
    return x
}

func rotL(x *Node) *Node {
    y := x.Right
    x.Right = y.Left
    y.Left = x
    upd(x); upd(y)
    return y
}

func Insert(root *Node, k int) *Node {
    if root == nil {
        return &Node{Key: k, Height: 0}
    }
    if k < root.Key {
        root.Left = Insert(root.Left, k)
    } else if k > root.Key {
        root.Right = Insert(root.Right, k)
    } else {
        return root
    }
    upd(root)
    b := bf(root)
    if b > 1 && k < root.Left.Key  { return rotR(root) }
    if b > 1 && k > root.Left.Key  { root.Left = rotL(root.Left); return rotR(root) }
    if b < -1 && k > root.Right.Key { return rotL(root) }
    if b < -1 && k < root.Right.Key { root.Right = rotR(root.Right); return rotL(root) }
    return root
}
```

**Java:**
```java
class Node {
    int key, height;
    Node left, right;
    Node(int k) { key = k; }
}

public class AVL {
    private int h(Node n) { return n == null ? -1 : n.height; }
    private int bf(Node n){ return n == null ? 0 : h(n.left) - h(n.right); }
    private void upd(Node n) { n.height = Math.max(h(n.left), h(n.right)) + 1; }

    private Node rotR(Node y) {
        Node x = y.left;
        y.left = x.right;
        x.right = y;
        upd(y); upd(x);
        return x;
    }
    private Node rotL(Node x) {
        Node y = x.right;
        x.right = y.left;
        y.left = x;
        upd(x); upd(y);
        return y;
    }

    public Node insert(Node root, int k) {
        if (root == null) return new Node(k);
        if (k < root.key) root.left = insert(root.left, k);
        else if (k > root.key) root.right = insert(root.right, k);
        else return root;

        upd(root);
        int b = bf(root);
        if (b > 1 && k < root.left.key)  return rotR(root);
        if (b > 1 && k > root.left.key)  { root.left = rotL(root.left); return rotR(root); }
        if (b < -1 && k > root.right.key) return rotL(root);
        if (b < -1 && k < root.right.key) { root.right = rotR(root.right); return rotL(root); }
        return root;
    }
}
```

**Python:**
```python
class Node:
    __slots__ = ("key", "left", "right", "height")
    def __init__(self, k):
        self.key, self.left, self.right, self.height = k, None, None, 0

def h(n): return -1 if n is None else n.height
def bf(n): return 0 if n is None else h(n.left) - h(n.right)
def upd(n): n.height = max(h(n.left), h(n.right)) + 1

def rotR(y):
    x = y.left
    y.left, x.right = x.right, y
    upd(y); upd(x)
    return x

def rotL(x):
    y = x.right
    x.right, y.left = y.left, x
    upd(x); upd(y)
    return y

def insert(root, k):
    if root is None: return Node(k)
    if k < root.key:   root.left  = insert(root.left, k)
    elif k > root.key: root.right = insert(root.right, k)
    else: return root
    upd(root)
    b = bf(root)
    if b > 1  and k < root.left.key:   return rotR(root)
    if b > 1  and k > root.left.key:   root.left  = rotL(root.left);  return rotR(root)
    if b < -1 and k > root.right.key:  return rotL(root)
    if b < -1 and k < root.right.key:  root.right = rotR(root.right); return rotL(root)
    return root
```

---

<a name="p2"></a>
## Problem 2. Implement AVL Delete With Rebalance

### Spec
Given a tree root and a key, remove the key (if present) and return the new root, maintaining the AVL invariant.

### Approach
Standard BST delete (three cases: leaf, one child, two children with in-order successor swap) followed by a bottom-up retrace using **balance factor of the child** for case selection. Unlike insert, delete cannot use key-based case selection because the key is gone.

### Complexity
- Time: O(log n)
- Rotations: up to O(log n) cascading

### Solutions

**Go:**
```go
func Delete(root *Node, k int) *Node {
    if root == nil { return nil }
    if k < root.Key {
        root.Left = Delete(root.Left, k)
    } else if k > root.Key {
        root.Right = Delete(root.Right, k)
    } else {
        if root.Left == nil || root.Right == nil {
            if root.Left != nil { root = root.Left } else { root = root.Right }
        } else {
            succ := root.Right
            for succ.Left != nil { succ = succ.Left }
            root.Key = succ.Key
            root.Right = Delete(root.Right, succ.Key)
        }
    }
    if root == nil { return nil }
    upd(root)
    b := bf(root)
    if b > 1  && bf(root.Left)  >= 0 { return rotR(root) }
    if b > 1  && bf(root.Left)  <  0 { root.Left  = rotL(root.Left);  return rotR(root) }
    if b < -1 && bf(root.Right) <= 0 { return rotL(root) }
    if b < -1 && bf(root.Right) >  0 { root.Right = rotR(root.Right); return rotL(root) }
    return root
}
```

**Java:**
```java
public Node delete(Node root, int k) {
    if (root == null) return null;
    if (k < root.key) root.left = delete(root.left, k);
    else if (k > root.key) root.right = delete(root.right, k);
    else {
        if (root.left == null || root.right == null) {
            root = (root.left != null) ? root.left : root.right;
        } else {
            Node succ = root.right;
            while (succ.left != null) succ = succ.left;
            root.key = succ.key;
            root.right = delete(root.right, succ.key);
        }
    }
    if (root == null) return null;
    upd(root);
    int b = bf(root);
    if (b > 1  && bf(root.left)  >= 0) return rotR(root);
    if (b > 1  && bf(root.left)  <  0) { root.left  = rotL(root.left);  return rotR(root); }
    if (b < -1 && bf(root.right) <= 0) return rotL(root);
    if (b < -1 && bf(root.right) >  0) { root.right = rotR(root.right); return rotL(root); }
    return root;
}
```

**Python:**
```python
def delete(root, k):
    if root is None: return None
    if k < root.key:    root.left  = delete(root.left, k)
    elif k > root.key:  root.right = delete(root.right, k)
    else:
        if root.left is None or root.right is None:
            root = root.left if root.left is not None else root.right
        else:
            succ = root.right
            while succ.left is not None: succ = succ.left
            root.key = succ.key
            root.right = delete(root.right, succ.key)
    if root is None: return None
    upd(root)
    b = bf(root)
    if b > 1 and bf(root.left) >= 0:  return rotR(root)
    if b > 1 and bf(root.left) <  0:  root.left  = rotL(root.left);  return rotR(root)
    if b < -1 and bf(root.right) <= 0: return rotL(root)
    if b < -1 and bf(root.right) >  0: root.right = rotR(root.right); return rotL(root)
    return root
```

---

<a name="p3"></a>
## Problem 3. Verify a Given Tree Is AVL-Balanced

### Spec
Given a binary tree root (no precomputed heights), return `true` if every node satisfies `|bf| ≤ 1`. Don't compute heights twice — use one bottom-up pass.

### Approach
Recursive: each call returns `(isBalanced, height)`. If any descendant is unbalanced, propagate `false` immediately. Use a sentinel `-1` for height when imbalanced to early-terminate.

### Complexity
- Time: O(n) — visits each node once
- Space: O(h) stack

### Solutions

**Go:**
```go
type TreeNode struct {
    Val   int
    Left, Right *TreeNode
}

func IsAVL(root *TreeNode) bool {
    var check func(*TreeNode) int
    check = func(n *TreeNode) int {
        if n == nil { return -1 }
        lh := check(n.Left)
        if lh == -2 { return -2 }
        rh := check(n.Right)
        if rh == -2 { return -2 }
        if lh-rh > 1 || rh-lh > 1 { return -2 }
        if lh > rh { return lh + 1 }
        return rh + 1
    }
    return check(root) != -2
}
```

**Java:**
```java
public boolean isAVL(TreeNode root) {
    return check(root) != -2;
}
private int check(TreeNode n) {
    if (n == null) return -1;
    int lh = check(n.left);
    if (lh == -2) return -2;
    int rh = check(n.right);
    if (rh == -2) return -2;
    if (Math.abs(lh - rh) > 1) return -2;
    return Math.max(lh, rh) + 1;
}
```

**Python:**
```python
def is_avl(root):
    def check(n):
        if n is None: return -1
        lh = check(n.left)
        if lh == -2: return -2
        rh = check(n.right)
        if rh == -2: return -2
        if abs(lh - rh) > 1: return -2
        return max(lh, rh) + 1
    return check(root) != -2
```

---

<a name="p4"></a>
## Problem 4. Convert Sorted Array to Balanced AVL

### Spec
Given a strictly sorted array of integers, return the root of a balanced AVL tree containing those keys.

### Approach
Pick the middle element as root; recursively build left and right subtrees from the left and right halves. The resulting tree is perfectly balanced (the AVL invariant holds trivially). Linear time.

### Complexity
- Time: O(n)
- Space: O(log n) recursion stack

### Solutions

**Go:**
```go
func SortedArrayToAVL(arr []int) *Node {
    return build(arr, 0, len(arr)-1)
}
func build(arr []int, lo, hi int) *Node {
    if lo > hi { return nil }
    mid := lo + (hi-lo)/2
    n := &Node{Key: arr[mid]}
    n.Left = build(arr, lo, mid-1)
    n.Right = build(arr, mid+1, hi)
    upd(n)
    return n
}
```

**Java:**
```java
public Node sortedArrayToAVL(int[] arr) {
    return build(arr, 0, arr.length - 1);
}
private Node build(int[] arr, int lo, int hi) {
    if (lo > hi) return null;
    int mid = lo + (hi - lo) / 2;
    Node n = new Node(arr[mid]);
    n.left  = build(arr, lo, mid - 1);
    n.right = build(arr, mid + 1, hi);
    upd(n);
    return n;
}
```

**Python:**
```python
def sorted_to_avl(arr):
    def build(lo, hi):
        if lo > hi: return None
        mid = (lo + hi) // 2
        n = Node(arr[mid])
        n.left  = build(lo, mid - 1)
        n.right = build(mid + 1, hi)
        upd(n)
        return n
    return build(0, len(arr) - 1)
```

---

<a name="p5"></a>
## Problem 5. Find K-th Smallest in AVL (Augmented)

### Spec
Augment AVL with `size` per node. Implement `kth(k)` returning the k-th smallest key (1-indexed), in O(log n).

### Approach
Walk down: if `k == size(left) + 1`, current node is the answer. If `k <= size(left)`, recurse left. Else, recurse right with `k -= size(left) + 1`.

### Complexity
- Time: O(log n)
- Space: O(log n) stack (or O(1) iterative)

### Solutions

**Go:**
```go
// Assume Node has Size field, maintained by:
// upd(n): also n.Size = 1 + size(n.Left) + size(n.Right)

func size(n *Node) int {
    if n == nil { return 0 }
    return n.Size
}

func Kth(root *Node, k int) (int, bool) {
    for root != nil {
        leftSize := size(root.Left)
        if k == leftSize+1 {
            return root.Key, true
        }
        if k <= leftSize {
            root = root.Left
        } else {
            k -= leftSize + 1
            root = root.Right
        }
    }
    return 0, false
}
```

**Java:**
```java
public int kth(Node root, int k) {
    while (root != null) {
        int leftSize = size(root.left);
        if (k == leftSize + 1) return root.key;
        if (k <= leftSize) root = root.left;
        else { k -= leftSize + 1; root = root.right; }
    }
    throw new IllegalArgumentException("k out of range");
}
private int size(Node n) { return n == null ? 0 : n.size; }
```

**Python:**
```python
def kth(root, k):
    while root is not None:
        ls = size(root.left)
        if k == ls + 1: return root.key
        if k <= ls: root = root.left
        else:       k -= ls + 1; root = root.right
    return None

def size(n): return 0 if n is None else n.size
```

---

<a name="p6"></a>
## Problem 6. LC 110 — Balanced Binary Tree

### Spec
LeetCode 110. Given a binary tree, return `true` if it is "height-balanced" — for every node, the two subtree heights differ by at most 1. (This is precisely the AVL invariant, applied to a general binary tree.)

### Approach
Identical to Problem 3 — one-pass bottom-up with early exit. The framing is different but the algorithm is the same.

### Complexity
- Time: O(n)
- Space: O(h)

### Solutions

**Go:**
```go
func IsBalanced(root *TreeNode) bool {
    var h func(*TreeNode) int
    h = func(n *TreeNode) int {
        if n == nil { return 0 }
        lh := h(n.Left)
        if lh == -1 { return -1 }
        rh := h(n.Right)
        if rh == -1 || abs(lh-rh) > 1 { return -1 }
        if lh > rh { return lh + 1 }
        return rh + 1
    }
    return h(root) != -1
}
func abs(a int) int { if a < 0 { return -a }; return a }
```

**Java:**
```java
public boolean isBalanced(TreeNode root) { return h(root) != -1; }
private int h(TreeNode n) {
    if (n == null) return 0;
    int lh = h(n.left);
    if (lh == -1) return -1;
    int rh = h(n.right);
    if (rh == -1 || Math.abs(lh - rh) > 1) return -1;
    return Math.max(lh, rh) + 1;
}
```

**Python:**
```python
def isBalanced(root):
    def h(n):
        if n is None: return 0
        lh = h(n.left)
        if lh == -1: return -1
        rh = h(n.right)
        if rh == -1 or abs(lh - rh) > 1: return -1
        return max(lh, rh) + 1
    return h(root) != -1
```

The interviewer-favorite follow-up: "What if the tree is already an AVL? How does that change the answer?" Trick: AVL is balanced by definition; return `true` without traversal if you can trust the tag. Production answer: don't trust the tag; verify.

---

<a name="p7"></a>
## Problem 7. Implement AVL Iterator (Inorder, O(1) Amortized Per Step)

### Spec
Implement an iterator over an AVL tree that yields keys in sorted order. `hasNext()` and `next()` should each run in **O(1) amortized**.

### Approach
The textbook in-order iterator: a stack of "pending" left-spines. `next()` pops the top, then pushes the left spine of the popped node's right child. Each node is pushed and popped exactly once across the whole traversal, so total work is O(n) for n calls, i.e., O(1) amortized per call.

### Complexity
- Time: O(1) amortized per `next()`
- Space: O(h) stack

### Solutions

**Go:**
```go
type AVLIterator struct {
    stack []*Node
}

func NewAVLIterator(root *Node) *AVLIterator {
    it := &AVLIterator{}
    it.pushLeft(root)
    return it
}
func (it *AVLIterator) pushLeft(n *Node) {
    for n != nil {
        it.stack = append(it.stack, n)
        n = n.Left
    }
}
func (it *AVLIterator) HasNext() bool { return len(it.stack) > 0 }
func (it *AVLIterator) Next() int {
    n := it.stack[len(it.stack)-1]
    it.stack = it.stack[:len(it.stack)-1]
    it.pushLeft(n.Right)
    return n.Key
}
```

**Java:**
```java
class AVLIterator {
    Deque<Node> stack = new ArrayDeque<>();
    AVLIterator(Node root) { pushLeft(root); }
    private void pushLeft(Node n) { while (n != null) { stack.push(n); n = n.left; } }
    boolean hasNext() { return !stack.isEmpty(); }
    int next() {
        Node n = stack.pop();
        pushLeft(n.right);
        return n.key;
    }
}
```

**Python:**
```python
class AVLIterator:
    def __init__(self, root):
        self.stack = []
        self._push_left(root)
    def _push_left(self, n):
        while n is not None:
            self.stack.append(n)
            n = n.left
    def has_next(self): return len(self.stack) > 0
    def __next__(self):
        if not self.stack: raise StopIteration
        n = self.stack.pop()
        self._push_left(n.right)
        return n.key
    def __iter__(self): return self
```

---

<a name="p8"></a>
## Problem 8. Merge Two AVL Trees in Linear Time

### Spec
Given two AVLs with keys in disjoint ranges `A.max < B.min`, merge them into a single AVL in O(m + n) time.

### Approach
Inorder traversal of both trees → two sorted arrays → merge into one sorted array → build AVL from sorted array (Problem 4). All steps are O(m + n) or O(m + n).

A more elegant approach using **AVL join** (Tarjan 1983) runs in O(log m + log n) when the trees are heavily skewed in height but degrades to O(m + n) in general; for interview purposes the sorted-array-merge approach is simplest and clearly linear.

### Complexity
- Time: O(m + n)
- Space: O(m + n) auxiliary array

### Solutions

**Go:**
```go
func Merge(a, b *Node) *Node {
    arr := append(inorder(a), inorder(b)...)
    return build(arr, 0, len(arr)-1)
}

func inorder(n *Node) []int {
    if n == nil { return nil }
    out := inorder(n.Left)
    out = append(out, n.Key)
    out = append(out, inorder(n.Right)...)
    return out
}
```

**Java:**
```java
public Node merge(Node a, Node b) {
    List<Integer> arr = new ArrayList<>();
    inorder(a, arr);
    inorder(b, arr);
    int[] xs = arr.stream().mapToInt(Integer::intValue).toArray();
    return build(xs, 0, xs.length - 1);
}
private void inorder(Node n, List<Integer> out) {
    if (n == null) return;
    inorder(n.left, out);
    out.add(n.key);
    inorder(n.right, out);
}
```

**Python:**
```python
def merge(a, b):
    arr = inorder(a) + inorder(b)
    return sorted_to_avl(arr)

def inorder(n):
    if n is None: return []
    return inorder(n.left) + [n.key] + inorder(n.right)
```

For interleaved key ranges, replace the concatenation with a proper merge of two sorted lists (`heapq.merge`, classic two-pointer) — still O(m + n).

---

<a name="p9"></a>
## Problem 9. Split AVL by Key (Tarjan-Style)

### Spec
Given an AVL tree `T` and a key `k`, split into two AVLs `L` and `R` such that every key in `L` is `< k` and every key in `R` is `>= k`.

### Approach
Recursive split. At each node, if its key is `< k`, the node and its left subtree go into `L`; recurse on the right subtree. Otherwise, the node and its right subtree go into `R`; recurse on the left. After the recursive call, **join** the two pieces.

The `join` operation glues a left tree, a middle key, and a right tree into a single balanced AVL, in O(|h_L - h_R| + 1) time. Total split is O(log n) — Tarjan-style — but the constant is high.

For an interview, the simpler O(n) approach (inorder traversal, partition, rebuild) is often enough. We show the recursive split with `join` here as the "advanced" answer.

### Complexity
- Time: O(log² n) without amortization, O(log n) amortized with finger trees
- Space: O(log n)

### Solutions (sketch, Python)

```python
def join_right(tl, k, tr):
    """Join tl, k, tr where every key in tl < k < every key in tr.
       Assumes tl and tr are AVLs. Returns AVL."""
    if h(tl) <= h(tr) + 1:
        n = Node(k)
        n.left, n.right = tl, tr
        upd(n)
        return rebalance(n)
    new_right = join_right(tl.right, k, tr)
    new_root = Node(tl.key)
    new_root.left = tl.left
    new_root.right = new_right
    upd(new_root)
    return rebalance(new_root)

def join(tl, k, tr):
    if h(tl) > h(tr) + 1:
        return join_right(tl, k, tr)
    if h(tr) > h(tl) + 1:
        return join_left(tl, k, tr)
    n = Node(k)
    n.left, n.right = tl, tr
    upd(n)
    return n

def split(t, k):
    """Returns (L, R) where L has keys < k, R has keys >= k."""
    if t is None: return (None, None)
    if k <= t.key:
        L, R = split(t.left, k)
        return (L, join(R, t.key, t.right))
    else:
        L, R = split(t.right, k)
        return (join(t.left, t.key, L), R)
```

(`rebalance` is the unified rebalance routine from `junior.md` §10.4; `join_left` is the mirror of `join_right`. `h` is the cached height accessor.)

### Why this matters in interviews

`split` and `join` together are the foundation of **functional treaps** and **persistent balanced trees** used in JVM-based languages and Haskell. They appear in problems like "given a sorted set, efficiently compute the union of many sets" — an answer that hinges on tree merging cost analysis.

For most coding interviews you don't need this level. For senior systems-design or algorithm-research interviews, you do.

---

## Summary of patterns

Across these nine problems:

- Problems 1, 2 are the **canonical from-scratch implementations**. Master both.
- Problems 3, 6 are the **verify the invariant** family. One traversal, early exit.
- Problem 4 is the **bottom-up construction**. Standard recipe.
- Problem 5 is **augmentation** — add `size`, maintain it, use it for `kth`/`rank`.
- Problem 7 is the **inorder iterator** — used in any sorted-map's `for (k : map)` loop.
- Problems 8, 9 are the **merge / split** family. Linear is fine for interviews; logarithmic is bonus.

If you can write all nine from a blank screen in 30 minutes total, you have mastered AVL.
