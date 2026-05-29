# Binary Search Tree — Interview Problems

> **Audience:** Candidates preparing for senior software engineer interviews at FAANG-tier or comparable companies. Each problem is presented in the format used in real interviews: a precise statement, a discussion of approaches, and clean reference solutions in Go, Java, and Python. The trap and the easy-to-miss edge case are called out for every problem.

The BST family is one of the densest topics in coding interviews because the problems exercise three orthogonal skills at once: recursion on subtrees, the BST invariant as a pruning tool, and inorder traversal as a semantic. A single problem (LC 98, Validate BST) has been ranked among the top-20 most-asked Google interview questions for over a decade.

This document covers 11 representative problems.

---

## Table of Contents

1. [LC 700 — Search in a BST](#lc700)
2. [LC 701 — Insert into a BST](#lc701)
3. [LC 450 — Delete Node in a BST](#lc450)
4. [LC 98 — Validate Binary Search Tree](#lc98)
5. [LC 230 — Kth Smallest Element in a BST](#lc230)
6. [LC 235 — Lowest Common Ancestor of a BST](#lc235)
7. [LC 173 — Binary Search Tree Iterator](#lc173)
8. [LC 108 — Convert Sorted Array to BST](#lc108)
9. [LC 1382 — Balance a BST](#lc1382)
10. [LC 1008 — Construct BST from Preorder Traversal](#lc1008)
11. [LC 99 — Recover Binary Search Tree](#lc99)
12. [LC 783 — Minimum Distance Between BST Nodes](#lc783)

---

<a name="lc700"></a>
## 1. LC 700 — Search in a BST (Easy)

> Given the root of a BST and an integer `val`, find the node in the BST whose value equals `val`. Return the subtree rooted at that node; if no such node exists, return `null`.

**Approach.** Classic iterative or recursive BST descent. Both versions are O(h). Iterative is preferred for memory safety on tall trees.

**Go:**
```go
func searchBST(root *TreeNode, val int) *TreeNode {
    for root != nil && root.Val != val {
        if val < root.Val {
            root = root.Left
        } else {
            root = root.Right
        }
    }
    return root
}
```

**Java:**
```java
public TreeNode searchBST(TreeNode root, int val) {
    while (root != null && root.val != val) {
        root = (val < root.val) ? root.left : root.right;
    }
    return root;
}
```

**Python:**
```python
def searchBST(self, root, val):
    while root and root.val != val:
        root = root.left if val < root.val else root.right
    return root
```

**Edge case** — empty tree (`root == null`). The loop body never executes; returns `null`. Correct.

---

<a name="lc701"></a>
## 2. LC 701 — Insert into a BST (Medium)

> Insert `val` into a BST and return the new root. The tree is guaranteed not to already contain `val`.

**Approach.** Recursive "return new subtree root" idiom. Iterative version saves O(h) stack.

**Go (recursive):**
```go
func insertIntoBST(root *TreeNode, val int) *TreeNode {
    if root == nil { return &TreeNode{Val: val} }
    if val < root.Val { root.Left  = insertIntoBST(root.Left,  val) }
    if val > root.Val { root.Right = insertIntoBST(root.Right, val) }
    return root
}
```

**Java (iterative):**
```java
public TreeNode insertIntoBST(TreeNode root, int val) {
    if (root == null) return new TreeNode(val);
    TreeNode n = root;
    while (true) {
        if (val < n.val) {
            if (n.left == null) { n.left = new TreeNode(val); return root; }
            n = n.left;
        } else {
            if (n.right == null) { n.right = new TreeNode(val); return root; }
            n = n.right;
        }
    }
}
```

**Python (recursive):**
```python
def insertIntoBST(self, root, val):
    if root is None:
        return TreeNode(val)
    if val < root.val:
        root.left = self.insertIntoBST(root.left, val)
    else:
        root.right = self.insertIntoBST(root.right, val)
    return root
```

**Trap** — forgetting to assign the recursive result. `self.insertIntoBST(root.left, val)` without `root.left = ...` loses the new node entirely.

---

<a name="lc450"></a>
## 3. LC 450 — Delete Node in a BST (Medium)

> Remove the node with key `key` from a BST. Return the new root. Three cases: leaf, one child, two children. The two-children case is handled via Hibbard deletion (inorder successor).

**Go:**
```go
func deleteNode(root *TreeNode, key int) *TreeNode {
    if root == nil { return nil }
    switch {
    case key < root.Val:
        root.Left = deleteNode(root.Left, key)
    case key > root.Val:
        root.Right = deleteNode(root.Right, key)
    default:
        if root.Left == nil  { return root.Right }
        if root.Right == nil { return root.Left }
        succ := root.Right
        for succ.Left != nil { succ = succ.Left }
        root.Val = succ.Val
        root.Right = deleteNode(root.Right, succ.Val)
    }
    return root
}
```

**Java:**
```java
public TreeNode deleteNode(TreeNode root, int key) {
    if (root == null) return null;
    if (key < root.val)      root.left  = deleteNode(root.left,  key);
    else if (key > root.val) root.right = deleteNode(root.right, key);
    else {
        if (root.left  == null) return root.right;
        if (root.right == null) return root.left;
        TreeNode succ = root.right;
        while (succ.left != null) succ = succ.left;
        root.val   = succ.val;
        root.right = deleteNode(root.right, succ.val);
    }
    return root;
}
```

**Python:**
```python
def deleteNode(self, root, key):
    if root is None:
        return None
    if key < root.val:
        root.left = self.deleteNode(root.left, key)
    elif key > root.val:
        root.right = self.deleteNode(root.right, key)
    else:
        if root.left is None:  return root.right
        if root.right is None: return root.left
        succ = root.right
        while succ.left is not None: succ = succ.left
        root.val   = succ.val
        root.right = self.deleteNode(root.right, succ.val)
    return root
```

**Trap** — for the two-children case, candidates often try to *swap the entire node* (rewriting its `.left` and `.right` pointers) instead of just copying the **value** of the successor. The simpler "copy key, recursively delete successor" version is bug-proof and runs in O(h).

---

<a name="lc98"></a>
## 4. LC 98 — Validate Binary Search Tree (Medium) — THE CLASSIC TRAP

> Given a binary tree, determine if it is a valid BST. Strict inequality on both sides.

This is the #1 BST interview problem and the one candidates fail most often. The trap is described in `middle.md` §7: comparing only direct children is wrong.

### Solution A — Min/Max bounds

**Java:**
```java
public boolean isValidBST(TreeNode root) {
    return validate(root, Long.MIN_VALUE, Long.MAX_VALUE);
}
private boolean validate(TreeNode n, long lo, long hi) {
    if (n == null) return true;
    if (n.val <= lo || n.val >= hi) return false;
    return validate(n.left,  lo, n.val) &&
           validate(n.right, n.val, hi);
}
```

Using `long` bounds is critical: a node with `Integer.MAX_VALUE` as its key must still validate, so the upper sentinel cannot equal `Integer.MAX_VALUE`.

**Go:**
```go
import "math"

func isValidBST(root *TreeNode) bool {
    var rec func(n *TreeNode, lo, hi float64) bool
    rec = func(n *TreeNode, lo, hi float64) bool {
        if n == nil { return true }
        v := float64(n.Val)
        if v <= lo || v >= hi { return false }
        return rec(n.Left, lo, v) && rec(n.Right, v, hi)
    }
    return rec(root, math.Inf(-1), math.Inf(1))
}
```

**Python:**
```python
def isValidBST(self, root):
    def rec(n, lo=float('-inf'), hi=float('inf')):
        if n is None: return True
        if not (lo < n.val < hi): return False
        return rec(n.left, lo, n.val) and rec(n.right, n.val, hi)
    return rec(root)
```

### Solution B — Inorder traversal

```python
def isValidBST(self, root):
    self.prev = float('-inf')
    def inorder(n):
        if n is None: return True
        if not inorder(n.left): return False
        if n.val <= self.prev: return False
        self.prev = n.val
        return inorder(n.right)
    return inorder(root)
```

Both are O(n). Pick by taste; the min/max version generalizes to a broader pattern.

---

<a name="lc230"></a>
## 5. LC 230 — Kth Smallest Element in a BST (Medium)

> Given a BST, return the k-th smallest value (1-indexed).

**Approach.** Inorder traversal with early stop. Iterative-with-stack is the idiomatic solution.

**Python:**
```python
def kthSmallest(self, root, k):
    stack = []
    n = root
    while n or stack:
        while n:
            stack.append(n); n = n.left
        n = stack.pop()
        k -= 1
        if k == 0:
            return n.val
        n = n.right
```

**Go:**
```go
func kthSmallest(root *TreeNode, k int) int {
    stack := []*TreeNode{}
    n := root
    for n != nil || len(stack) > 0 {
        for n != nil { stack = append(stack, n); n = n.Left }
        n = stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        k--
        if k == 0 { return n.Val }
        n = n.Right
    }
    return -1
}
```

**Java:**
```java
public int kthSmallest(TreeNode root, int k) {
    Deque<TreeNode> stack = new ArrayDeque<>();
    TreeNode n = root;
    while (n != null || !stack.isEmpty()) {
        while (n != null) { stack.push(n); n = n.left; }
        n = stack.pop();
        if (--k == 0) return n.val;
        n = n.right;
    }
    return -1;
}
```

**Follow-up the interviewer will ask** — what if the BST is modified often and you need many k-th queries? Answer: augment with `subtree_size` (see `professional.md` §6.1) for `O(log n)` k-th queries.

---

<a name="lc235"></a>
## 6. LC 235 — Lowest Common Ancestor of a BST (Medium)

> Given a BST and two nodes `p` and `q`, return their LCA. The LCA is the deepest node that has both `p` and `q` as descendants (a node can be a descendant of itself).

**Approach.** Exploit the BST invariant: the LCA is the **first node we encounter** on the descent from root where `p` and `q` lie on different sides (one less, one greater) — or one of `p` / `q` is the node itself.

**Go:**
```go
func lowestCommonAncestor(root, p, q *TreeNode) *TreeNode {
    for root != nil {
        switch {
        case p.Val < root.Val && q.Val < root.Val:
            root = root.Left
        case p.Val > root.Val && q.Val > root.Val:
            root = root.Right
        default:
            return root
        }
    }
    return nil
}
```

**Java:**
```java
public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
    while (root != null) {
        if (p.val < root.val && q.val < root.val)      root = root.left;
        else if (p.val > root.val && q.val > root.val) root = root.right;
        else                                            return root;
    }
    return null;
}
```

**Python:**
```python
def lowestCommonAncestor(self, root, p, q):
    while root:
        if p.val < root.val and q.val < root.val:
            root = root.left
        elif p.val > root.val and q.val > root.val:
            root = root.right
        else:
            return root
    return None
```

Time O(h), space O(1) iteratively.

**Contrast with LC 236** (general binary tree LCA): there you can't shortcut and must do a full DFS. The BST version is dramatically simpler.

---

<a name="lc173"></a>
## 7. LC 173 — Binary Search Tree Iterator (Medium)

> Design a stateful iterator `BSTIterator` with `next()` returning the next smallest key and `hasNext()` returning whether more keys remain. `next()` must run in **O(1) amortized** time using at most **O(h)** memory.

**Approach.** Stack-based partial inorder traversal. Push the leftmost spine at construction; each `next()` pops one, then pushes the leftmost spine of its right child.

**Python:**
```python
class BSTIterator:
    def __init__(self, root):
        self.stack = []
        self._push_left(root)

    def _push_left(self, node):
        while node:
            self.stack.append(node)
            node = node.left

    def next(self):
        n = self.stack.pop()
        self._push_left(n.right)
        return n.val

    def hasNext(self):
        return bool(self.stack)
```

**Go:**
```go
type BSTIterator struct{ stack []*TreeNode }

func Constructor(root *TreeNode) BSTIterator {
    it := BSTIterator{}
    it.pushLeft(root)
    return it
}
func (it *BSTIterator) pushLeft(n *TreeNode) {
    for n != nil { it.stack = append(it.stack, n); n = n.Left }
}
func (it *BSTIterator) Next() int {
    n := it.stack[len(it.stack)-1]
    it.stack = it.stack[:len(it.stack)-1]
    it.pushLeft(n.Right)
    return n.Val
}
func (it *BSTIterator) HasNext() bool { return len(it.stack) > 0 }
```

**Java:**
```java
class BSTIterator {
    private final Deque<TreeNode> stack = new ArrayDeque<>();
    public BSTIterator(TreeNode root) { pushLeft(root); }
    private void pushLeft(TreeNode n) {
        while (n != null) { stack.push(n); n = n.left; }
    }
    public int next() {
        TreeNode n = stack.pop();
        pushLeft(n.right);
        return n.val;
    }
    public boolean hasNext() { return !stack.isEmpty(); }
}
```

**Amortized analysis.** Each node is pushed and popped exactly once across all `next()` calls. n nodes → n pushes + n pops total → 2n operations spread over n calls = 2 ops per call amortized → O(1).

**Space.** Stack depth is bounded by `O(h)`, *not* `O(n)`. For balanced BSTs this is O(log n).

This pattern is the foundation of **lazy iterators** in C++'s `std::map::iterator`, Java's `TreeMap.entrySet().iterator()`, and similar STL/JCL iterators across languages.

---

<a name="lc108"></a>
## 8. LC 108 — Convert Sorted Array to BST (Easy)

> Given a sorted array, build a **height-balanced** BST.

**Approach.** Recursive midpoint pick. The midpoint becomes the subtree root; recurse on left half and right half. Covered in detail in `middle.md` §9.

**Python:**
```python
def sortedArrayToBST(self, nums):
    def rec(lo, hi):
        if lo > hi: return None
        mid = (lo + hi) // 2
        node = TreeNode(nums[mid])
        node.left  = rec(lo, mid - 1)
        node.right = rec(mid + 1, hi)
        return node
    return rec(0, len(nums) - 1)
```

**Go:**
```go
func sortedArrayToBST(nums []int) *TreeNode {
    var rec func(lo, hi int) *TreeNode
    rec = func(lo, hi int) *TreeNode {
        if lo > hi { return nil }
        mid := lo + (hi-lo)/2
        return &TreeNode{Val: nums[mid], Left: rec(lo, mid-1), Right: rec(mid+1, hi)}
    }
    return rec(0, len(nums)-1)
}
```

**Java:**
```java
public TreeNode sortedArrayToBST(int[] nums) {
    return build(nums, 0, nums.length - 1);
}
private TreeNode build(int[] nums, int lo, int hi) {
    if (lo > hi) return null;
    int mid = lo + (hi - lo) / 2;
    TreeNode n = new TreeNode(nums[mid]);
    n.left  = build(nums, lo, mid - 1);
    n.right = build(nums, mid + 1, hi);
    return n;
}
```

Time O(n). Space O(log n) recursion + O(n) for the tree.

---

<a name="lc1382"></a>
## 9. LC 1382 — Balance a BST (Medium)

> Given a possibly-unbalanced BST, return a balanced BST with the same node values.

**Approach.** Two-pass: inorder traversal to extract sorted values, then LC 108 to rebuild balanced. Total O(n). Cannot do better without rotations.

**Python:**
```python
def balanceBST(self, root):
    vals = []
    def inorder(n):
        if n is None: return
        inorder(n.left); vals.append(n.val); inorder(n.right)
    inorder(root)
    def build(lo, hi):
        if lo > hi: return None
        mid = (lo + hi) // 2
        n = TreeNode(vals[mid])
        n.left  = build(lo, mid - 1)
        n.right = build(mid + 1, hi)
        return n
    return build(0, len(vals) - 1)
```

**Go:**
```go
func balanceBST(root *TreeNode) *TreeNode {
    var vals []int
    var inorder func(*TreeNode)
    inorder = func(n *TreeNode) {
        if n == nil { return }
        inorder(n.Left); vals = append(vals, n.Val); inorder(n.Right)
    }
    inorder(root)
    var build func(lo, hi int) *TreeNode
    build = func(lo, hi int) *TreeNode {
        if lo > hi { return nil }
        mid := lo + (hi-lo)/2
        return &TreeNode{Val: vals[mid], Left: build(lo, mid-1), Right: build(mid+1, hi)}
    }
    return build(0, len(vals)-1)
}
```

**Java:** analogous — left as exercise; same pattern.

**Discussion.** This is the "compaction" strategy real systems use occasionally when they want O(log n) lookups without per-operation balancing — accept that the tree drifts unbalanced, periodically rebuild. Simple to implement, predictable.

---

<a name="lc1008"></a>
## 10. LC 1008 — Construct BST from Preorder Traversal (Medium)

> Given the preorder traversal of a BST, reconstruct the tree.

**Insight.** In a preorder of a BST: first element is the root; the next contiguous prefix of values **less than root** form the preorder of the left subtree; the rest form the preorder of the right subtree.

**O(n) approach using bounds:**

```python
def bstFromPreorder(self, preorder):
    self.i = 0
    def build(upper):
        if self.i == len(preorder) or preorder[self.i] > upper:
            return None
        v = preorder[self.i]; self.i += 1
        root = TreeNode(v)
        root.left  = build(v)
        root.right = build(upper)
        return root
    return build(float('inf'))
```

**Go:**
```go
func bstFromPreorder(preorder []int) *TreeNode {
    i := 0
    var build func(upper int) *TreeNode
    build = func(upper int) *TreeNode {
        if i == len(preorder) || preorder[i] > upper { return nil }
        v := preorder[i]; i++
        return &TreeNode{Val: v, Left: build(v), Right: build(upper)}
    }
    return build(1<<31 - 1)
}
```

**Java:**
```java
class Solution {
    int i = 0;
    public TreeNode bstFromPreorder(int[] preorder) {
        return build(preorder, Integer.MAX_VALUE);
    }
    private TreeNode build(int[] a, int upper) {
        if (i == a.length || a[i] > upper) return null;
        TreeNode root = new TreeNode(a[i++]);
        root.left  = build(a, root.val);
        root.right = build(a, upper);
        return root;
    }
}
```

Time O(n) because each element is consumed once. The naive recursive "split on first-greater-than-root" version is O(n²) worst case.

---

<a name="lc99"></a>
## 11. LC 99 — Recover Binary Search Tree (Medium)

> Exactly two nodes in a BST have been swapped. Recover the BST without changing the tree structure (only swap their values).

**Approach.** Inorder traversal of a valid BST yields a strictly increasing sequence. If two nodes are swapped, the sequence has either **one** or **two** "drops" (places where `prev > curr`):
- **Two adjacent nodes swapped** → one drop, the swapped pair is `(prev, curr)`.
- **Two non-adjacent nodes swapped** → two drops. The first node is `prev` of the first drop; the second is `curr` of the second drop.

**Python (Morris traversal for O(1) space is the bonus version; here's the simpler stack version):**
```python
def recoverTree(self, root):
    first = second = prev = None
    stack = []
    n = root
    while n or stack:
        while n:
            stack.append(n); n = n.left
        n = stack.pop()
        if prev and prev.val > n.val:
            if first is None: first = prev
            second = n
        prev = n
        n = n.right
    first.val, second.val = second.val, first.val
```

**Go:**
```go
func recoverTree(root *TreeNode) {
    var first, second, prev *TreeNode
    stack := []*TreeNode{}
    n := root
    for n != nil || len(stack) > 0 {
        for n != nil { stack = append(stack, n); n = n.Left }
        n = stack[len(stack)-1]; stack = stack[:len(stack)-1]
        if prev != nil && prev.Val > n.Val {
            if first == nil { first = prev }
            second = n
        }
        prev = n
        n = n.Right
    }
    first.Val, second.Val = second.Val, first.Val
}
```

**Java:**
```java
class Solution {
    TreeNode first, second, prev;
    public void recoverTree(TreeNode root) {
        Deque<TreeNode> stack = new ArrayDeque<>();
        TreeNode n = root;
        while (n != null || !stack.isEmpty()) {
            while (n != null) { stack.push(n); n = n.left; }
            n = stack.pop();
            if (prev != null && prev.val > n.val) {
                if (first == null) first = prev;
                second = n;
            }
            prev = n;
            n = n.right;
        }
        int t = first.val; first.val = second.val; second.val = t;
    }
}
```

Time O(n), space O(h) for the stack. Morris traversal can reduce space to O(1) — see CLRS §10.4-3 — at the cost of more complex code.

---

<a name="lc783"></a>
## 12. LC 783 — Minimum Distance Between BST Nodes (Easy)

> Find the minimum absolute difference between values of any two nodes in a BST.

**Insight.** The minimum difference in a sorted sequence is always between **adjacent** elements. Inorder traversal yields sorted; track `min(|curr - prev|)` as we walk.

**Python:**
```python
def minDiffInBST(self, root):
    self.prev = None
    self.ans = float('inf')
    def inorder(n):
        if n is None: return
        inorder(n.left)
        if self.prev is not None:
            self.ans = min(self.ans, n.val - self.prev)
        self.prev = n.val
        inorder(n.right)
    inorder(root)
    return self.ans
```

**Go:**
```go
func minDiffInBST(root *TreeNode) int {
    prev := -1
    ans := 1 << 30
    var inorder func(*TreeNode)
    inorder = func(n *TreeNode) {
        if n == nil { return }
        inorder(n.Left)
        if prev >= 0 && n.Val - prev < ans {
            ans = n.Val - prev
        }
        prev = n.Val
        inorder(n.Right)
    }
    inorder(root)
    return ans
}
```

**Java:**
```java
class Solution {
    Integer prev = null;
    int ans = Integer.MAX_VALUE;
    public int minDiffInBST(TreeNode root) {
        inorder(root);
        return ans;
    }
    private void inorder(TreeNode n) {
        if (n == null) return;
        inorder(n.left);
        if (prev != null) ans = Math.min(ans, n.val - prev);
        prev = n.val;
        inorder(n.right);
    }
}
```

Time O(n), space O(h).

**Variant** — LC 530 ("Minimum Absolute Difference in BST") is the exact same problem under a different number.

---

## Interview Tips

1. **Start with the BST invariant.** Reciting it precisely signals that you understand the structure, not just the operations.
2. **Use the min/max bounds pattern for validation.** It's the right answer to LC 98 and to most invariant-checking problems.
3. **Use inorder traversal for any "sorted" problem.** Kth-smallest, validation, two-sum-in-BST, recover BST, minimum distance — they all reduce to "walk the tree in order, look at adjacent pairs".
4. **For LCA, exploit the ordering.** LC 235 has an O(h) iterative solution; LC 236 (binary tree LCA) needs DFS. Don't conflate.
5. **For the iterator pattern (LC 173), drive home that O(1) amortized comes from the n pushes + n pops argument.** Interviewers love this analysis.
6. **For deletion, walk through Case A, B, C explicitly.** Even if you write the code, the verbal explanation matters.
7. **Mention follow-ups proactively.** "If we needed many kth-smallest queries, we'd augment with subtree sizes for O(log n) per query." Shows depth.
8. **Always sanity-check on tiny trees** — empty, single node, two nodes, balanced 3-node, skewed 3-node. Most bugs surface immediately.

Good luck.
