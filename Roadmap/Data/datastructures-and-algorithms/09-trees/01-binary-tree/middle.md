# Binary Tree — Middle Level

> **Audience:** Engineers who can write recursive size/height/traversals fluently and want the variant family used in real libraries, compilers, and competitive programming. Prerequisite: `junior.md`.

This document covers the **next layer** of binary-tree knowledge: how to **classify** trees (full vs complete vs perfect vs balanced vs degenerate, with detection code), how to traverse **iteratively** with an explicit stack, the **Morris traversal** that achieves O(1) extra space by temporarily rewiring nodes, how to **serialize and deserialize** a tree to and from a string (LeetCode 297, used by Redis dumps and similar tools), the **lowest common ancestor** problem with both the recursive baseline and a preview of binary lifting, classic **tree DP** problems (diameter, max path sum, subtree sum), the original **threaded binary tree** idea of Perlis & Thornton (1960), **symmetry / mirror** checks, and **reconstruction from preorder + inorder** which underlies many parser tools.

---

## Table of Contents

1. [Tree Variants — Formal Definitions and Detection Code](#variants)
2. [Iterative Traversal with an Explicit Stack](#iterative)
3. [Morris Traversal — O(1) Space via Threading](#morris)
4. [Serialization and Deserialization](#serdes)
5. [Lowest Common Ancestor](#lca)
6. [Tree DP — Diameter, Max Path Sum, Subtree Sum](#tree-dp)
7. [Threaded Binary Trees — Perlis & Thornton 1960](#threaded)
8. [Mirror and Symmetry Checks](#mirror)
9. [Reconstruction from Preorder + Inorder](#reconstruct)

---

<a name="variants"></a>
## 1. Tree Variants — Formal Definitions and Detection Code

### 1.1 Full (a.k.a. proper / strict) binary tree

Every node has **either 0 or 2 children** — never exactly 1.

```python
def is_full(root):
    if root is None:
        return True
    if (root.left is None) != (root.right is None):
        return False                    # one child but not both → not full
    return is_full(root.left) and is_full(root.right)
```

Detection: O(n). Used in expression trees (every operator has exactly 2 operands), in Huffman coding trees, in binary heap shape (when zero-padded), and in some interpreter ASTs.

### 1.2 Complete binary tree

Every level is completely filled except possibly the last, and the last level is filled **from left to right with no gaps**. This is the shape every binary heap must maintain, and the reason heaps can be stored in an array.

```java
public static boolean isComplete(TreeNode root) {
    if (root == null) return true;
    Deque<TreeNode> q = new ArrayDeque<>();
    q.offer(root);
    boolean sawNull = false;
    while (!q.isEmpty()) {
        TreeNode n = q.poll();
        if (n == null) {
            sawNull = true;
        } else {
            if (sawNull) return false;  // a real node after a null → gap → not complete
            q.offer(n.left);
            q.offer(n.right);
        }
    }
    return true;
}
```

Idea: do a level-order walk, but enqueue `null` placeholders too. The first time you see a `null`, the rest of the walk must be all `null`s, otherwise the tree has a gap.

### 1.3 Perfect binary tree

Every internal node has 2 children **and** every leaf is at the same depth. A perfect tree of height `h` has exactly `2^(h+1) - 1` nodes.

```go
// Perfect iff all leaves are at the same depth AND every internal node has 2 children.
func IsPerfect(root *Node) bool {
    h := leftmostDepth(root)
    return checkPerfect(root, 0, h)
}
func leftmostDepth(n *Node) int {
    d := 0
    for n != nil {
        d++
        n = n.Left
    }
    return d - 1   // we measure in edges; root has depth 0
}
func checkPerfect(n *Node, depth, target int) bool {
    if n == nil {
        return true
    }
    if n.Left == nil && n.Right == nil {
        return depth == target
    }
    if n.Left == nil || n.Right == nil {
        return false
    }
    return checkPerfect(n.Left, depth+1, target) &&
           checkPerfect(n.Right, depth+1, target)
}
```

### 1.4 Height-balanced binary tree (AVL-style)

For **every** node, `|height(left) - height(right)| <= 1`. The naive check is O(n²); the linear-time check returns "height or -1 if unbalanced" in one pass.

```python
def is_balanced(root):
    def h(node):
        if node is None:
            return 0
        lh = h(node.left)
        if lh == -1: return -1
        rh = h(node.right)
        if rh == -1: return -1
        if abs(lh - rh) > 1:
            return -1
        return 1 + max(lh, rh)
    return h(root) != -1
```

`-1` is a sentinel meaning "already failed, stop". Time O(n).

### 1.5 Degenerate (skewed) tree

Every node has at most one child. Effectively a linked list. Height = `n - 1`. Detection: at every node, at most one child is non-null. We rarely test for it explicitly — we test that "balanced is false and the tree behaves like a list" via height = n - 1 instead.

---

<a name="iterative"></a>
## 2. Iterative Traversal with an Explicit Stack

Why bother? Three reasons: (1) avoid stack overflow on a 100,000-deep skewed tree, (2) be able to pause and resume traversal (state lives on the heap), (3) get a real iterator (`std::map::iterator++` works exactly this way).

### 2.1 Iterative preorder

Push the right child before the left, so the LIFO stack pops left first.

**Go:**
```go
func PreorderIter(root *Node, visit func(int)) {
    if root == nil {
        return
    }
    stack := []*Node{root}
    for len(stack) > 0 {
        n := stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        visit(n.Val)
        if n.Right != nil {
            stack = append(stack, n.Right)
        }
        if n.Left != nil {
            stack = append(stack, n.Left)
        }
    }
}
```

### 2.2 Iterative inorder

We push every left-spine node, then pop, visit, and descend to its right child.

**Java:**
```java
public static void inorderIter(TreeNode root, IntConsumer visit) {
    Deque<TreeNode> stack = new ArrayDeque<>();
    TreeNode cur = root;
    while (cur != null || !stack.isEmpty()) {
        while (cur != null) {
            stack.push(cur);
            cur = cur.left;
        }
        cur = stack.pop();
        visit.accept(cur.val);
        cur = cur.right;
    }
}
```

This is the *exact* algorithm `std::map::iterator::operator++` implements (modulo parent pointers).

### 2.3 Iterative postorder

Two common techniques: (a) two stacks (push root onto first, transfer to second in modified order), (b) one stack with a "last visited" sentinel.

**Python (one stack, last-visited):**
```python
def postorder_iter(root):
    stack, out, last = [], [], None
    cur = root
    while cur or stack:
        while cur:
            stack.append(cur)
            cur = cur.left
        peek = stack[-1]
        if peek.right and last is not peek.right:
            cur = peek.right
        else:
            out.append(peek.val)
            last = stack.pop()
    return out
```

`last` records the most recently visited node, so we know whether to descend into the right subtree or to finish the current node.

---

<a name="morris"></a>
## 3. Morris Traversal — O(1) Space via Threading

J. M. Morris, "Traversing binary trees simply and cheaply" (Information Processing Letters, 1979), showed an inorder traversal that uses **zero auxiliary memory** — no stack, no recursion — by temporarily reusing the `null` right pointer of a node's inorder predecessor to point back up to the current node, then undoing the pointer when control returns.

### The trick

When you're at node `cur` and `cur.left` exists, the inorder successor of `cur` is `cur`, and the inorder *predecessor* of `cur` is the **rightmost** node of `cur.left`'s subtree. That rightmost node has `right == null`. So:

1. Find the rightmost node of `cur.left` (call it `pred`).
2. Set `pred.right = cur` (a "thread").
3. Move `cur = cur.left`.
4. Later, when we come back to `cur` via the thread, we see `pred.right == cur`, restore `pred.right = null`, visit `cur`, then move `cur = cur.right`.

Each thread is created once and destroyed once, so total work is O(n).

### Code

**Python:**
```python
def morris_inorder(root):
    cur = root
    while cur:
        if cur.left is None:
            yield cur.val
            cur = cur.right
        else:
            pred = cur.left
            while pred.right and pred.right is not cur:
                pred = pred.right
            if pred.right is None:
                pred.right = cur          # set thread
                cur = cur.left
            else:
                pred.right = None         # undo thread
                yield cur.val
                cur = cur.right
```

**Go:**
```go
func MorrisInorder(root *Node, visit func(int)) {
    cur := root
    for cur != nil {
        if cur.Left == nil {
            visit(cur.Val)
            cur = cur.Right
            continue
        }
        pred := cur.Left
        for pred.Right != nil && pred.Right != cur {
            pred = pred.Right
        }
        if pred.Right == nil {
            pred.Right = cur
            cur = cur.Left
        } else {
            pred.Right = nil
            visit(cur.Val)
            cur = cur.Right
        }
    }
}
```

### Trade-offs

- Time: O(n). Each edge is walked at most twice, so O(n) total.
- Space: **O(1) extra** — no stack, no recursion.
- **Mutates the tree** during traversal. Not thread-safe without an external lock. If another thread reads during Morris, it can briefly see a thread and follow a cycle.
- Cannot use on **immutable** trees.

Morris is a beautiful trick. Use it when memory is truly precious (deeply embedded systems, kernel code) or when the interviewer specifically asks for O(1) space. Otherwise the iterative-stack version is clearer.

---

<a name="serdes"></a>
## 4. Serialization and Deserialization

LeetCode 297: design a string format you can write a binary tree to, and read it back. The most common scheme is **preorder with null markers**.

### Preorder + null markers — write

**Java:**
```java
public String serialize(TreeNode root) {
    StringBuilder sb = new StringBuilder();
    pre(root, sb);
    return sb.toString();
}
private void pre(TreeNode n, StringBuilder sb) {
    if (n == null) { sb.append("# "); return; }
    sb.append(n.val).append(' ');
    pre(n.left, sb);
    pre(n.right, sb);
}
```

The example tree from `junior.md` serializes to `"10 5 3 # # 7 # # 15 # 20 # # "`.

### Preorder + null markers — read

**Java:**
```java
public TreeNode deserialize(String data) {
    java.util.Iterator<String> it = java.util.Arrays.stream(data.trim().split("\\s+")).iterator();
    return build(it);
}
private TreeNode build(java.util.Iterator<String> it) {
    if (!it.hasNext()) return null;
    String tok = it.next();
    if (tok.equals("#")) return null;
    TreeNode n = new TreeNode(Integer.parseInt(tok));
    n.left  = build(it);
    n.right = build(it);
    return n;
}
```

Why this works: in preorder, every node's left subtree is written entirely before its right subtree, so the **stream of tokens uniquely determines the tree** as long as null markers separate empty subtrees. Without null markers, you could not tell a tree from its mirror image.

### Level-order with null markers (LeetCode format)

Used by LeetCode's `[1,2,3,null,4,5]` notation. Same idea, but using BFS.

**Python:**
```python
from collections import deque

def serialize_level(root):
    if root is None:
        return ""
    out, q = [], deque([root])
    while q:
        n = q.popleft()
        if n is None:
            out.append("#")
        else:
            out.append(str(n.val))
            q.append(n.left)
            q.append(n.right)
    while out and out[-1] == "#":
        out.pop()        # trim trailing nulls
    return " ".join(out)

def deserialize_level(s):
    if not s:
        return None
    toks = s.split()
    root = TreeNode(int(toks[0]))
    q = deque([root])
    i = 1
    while q and i < len(toks):
        n = q.popleft()
        if toks[i] != "#":
            n.left = TreeNode(int(toks[i]))
            q.append(n.left)
        i += 1
        if i < len(toks) and toks[i] != "#":
            n.right = TreeNode(int(toks[i]))
            q.append(n.right)
        i += 1
    return root
```

### Real-world serdes

Redis's `DUMP`/`RESTORE` protocol serializes its inner data structures (skip lists, ziplists) using a similar tag-and-recurse scheme. Java's `ObjectOutputStream`, Python's `pickle`, and Protocol Buffers all handle recursive structures by emitting a node's type tag then its children. The pattern is universal.

---

<a name="lca"></a>
## 5. Lowest Common Ancestor

The **LCA** of two nodes `p` and `q` is the deepest node that is an ancestor of both. Classic problem; appears in Git (finding merge base), in phylogenetic trees (most recent common ancestor of two species), and in graph drawing.

### Recursive baseline (no parent pointers, no preprocessing)

```python
def lca(root, p, q):
    if root is None or root is p or root is q:
        return root
    l = lca(root.left, p, q)
    r = lca(root.right, p, q)
    if l and r:
        return root        # p and q are in different subtrees → root is the LCA
    return l if l else r
```

O(n) time, O(h) space. Single pass; one recursion per node.

### With parent pointers — two-list intersection

If every node has a parent pointer, walk both nodes' ancestor chains, level them up to the same depth, then walk up together until they meet. O(h) time, O(1) space. This is exactly how `os.path.commonpath` is conceptually computed.

### Preview: binary lifting for O(log n) LCA after O(n log n) preprocessing

Used in competitive programming and in some database query planners. Precompute `up[k][v] = the 2^k-th ancestor of v`. Answer each LCA query in O(log n) by jumping in powers of 2. We cover this in the LCA-specific topic later in the roadmap; for now, know it exists.

---

<a name="tree-dp"></a>
## 6. Tree DP — Diameter, Max Path Sum, Subtree Sum

Tree DP = dynamic programming on a tree, where each node aggregates information from its children. The pattern: a recursive helper returns **two things** — what you tell the parent, and the (possibly different) global best so far.

### 6.1 Diameter (LeetCode 543)

The **diameter** of a tree is the number of edges on the longest path between any two nodes. (Sometimes phrased "longest path in nodes" — be precise.)

```go
func Diameter(root *Node) int {
    best := 0
    var depth func(n *Node) int
    depth = func(n *Node) int {
        if n == nil {
            return 0
        }
        l := depth(n.Left)
        r := depth(n.Right)
        if l+r > best {
            best = l + r              // path through n has l + r edges
        }
        if l > r {
            return 1 + l
        }
        return 1 + r
    }
    depth(root)
    return best
}
```

Time O(n). The helper returns "depth seen so far" to its parent; the global `best` tracks "the longest path through some node". This two-channel return is the key tree-DP idiom.

### 6.2 Maximum path sum (LeetCode 124)

A "path" is any sequence of nodes connected by edges. The path may dip into one subtree and come back. Find the path with maximum sum.

```python
def maxPathSum(root):
    best = float("-inf")
    def gain(n):
        nonlocal best
        if n is None:
            return 0
        l = max(0, gain(n.left))     # if negative, skip
        r = max(0, gain(n.right))
        best = max(best, n.val + l + r)
        return n.val + max(l, r)
    gain(root)
    return best
```

The helper returns "best one-sided gain from this node" (which is what the parent could extend); the global `best` tracks "best path bending at some node".

### 6.3 Subtree sum / sum at every node

Useful for problems like "find subtree with given sum" (LC 508). Postorder, return the sum, optionally record into a dict.

```java
public int subtreeSum(TreeNode root, Map<TreeNode, Integer> sums) {
    if (root == null) return 0;
    int total = root.val
              + subtreeSum(root.left,  sums)
              + subtreeSum(root.right, sums);
    sums.put(root, total);
    return total;
}
```

Time O(n), space O(n) for the map.

---

<a name="threaded"></a>
## 7. Threaded Binary Trees — Perlis & Thornton 1960

A. J. Perlis and C. Thornton, "Symbol manipulation by threaded lists" (CACM, April 1960), introduced **threaded trees** as a way to traverse a tree without recursion and without a stack — by reusing the null pointers as **threads** that point to the inorder predecessor or successor.

- **Right-threaded**: every node's null `right` pointer is replaced with a pointer to its inorder successor.
- **Left-threaded**: every node's null `left` pointer is replaced with a pointer to its inorder predecessor.
- **Fully threaded**: both.

You need an extra bit per pointer (`isThread: bool`) to distinguish "real child" from "thread", or a sentinel scheme. Once threaded, you can find the inorder successor of any node in O(1) amortized — no recursion. The cost: extra bit per node, extra bookkeeping on insert/delete.

This was a huge deal in 1960 because computers had **tiny stacks** (some had no hardware stack at all) and recursion was expensive. Modern hardware makes the trade-off less compelling, but the idea survives in **Morris traversal** (which threads temporarily during the walk and undoes the thread immediately).

```
Standard:           Threaded (dashes are threads up to inorder successor):
     10                   10
    /  \                 /  \
   5    15              5    15
                       /|    |
                      3 7    20
                     - -    -
                     |  |   ↑
                     ↑  ↑   |
                     5  10  *  (10's right is real)
```

Reading: D. Knuth, TAOCP v1 §2.3.1 covers threaded trees in detail and credits Perlis and Thornton.

---

<a name="mirror"></a>
## 8. Mirror and Symmetry Checks

### 8.1 Invert (mirror) a tree — LeetCode 226

Swap every left and right child.

**Python:**
```python
def invert(root):
    if root is None:
        return None
    root.left, root.right = invert(root.right), invert(root.left)
    return root
```

O(n) time, O(h) space. Famous for being the LeetCode problem that Max Howell (creator of Homebrew) tweeted he failed in a Google interview in 2015. Don't be that person.

### 8.2 Symmetric tree — LeetCode 101

A tree is symmetric if it's a mirror image of itself.

**Java:**
```java
public boolean isSymmetric(TreeNode root) {
    return root == null || mirror(root.left, root.right);
}
private boolean mirror(TreeNode a, TreeNode b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.val == b.val
        && mirror(a.left,  b.right)
        && mirror(a.right, b.left);
}
```

Notice we compare `a.left` to `b.right` (and vice versa) — that's what "mirror" means. A single tree is symmetric iff its left subtree mirrors its right subtree.

---

<a name="reconstruct"></a>
## 9. Reconstruction from Preorder + Inorder

Given preorder = `[10, 5, 3, 7, 15, 20]` and inorder = `[3, 5, 7, 10, 15, 20]`, recover the original tree (LeetCode 105). This is the algorithm a recursive-descent parser uses when rebuilding an AST from a stream of tokens.

### Idea

1. The **first** element of preorder is the root.
2. Find that element's index in inorder. Everything to its left is the left subtree's inorder; everything to its right is the right subtree's inorder.
3. The next `(size of left subtree)` elements of preorder are the left subtree's preorder; the rest is the right subtree's preorder.
4. Recurse.

### Code with index map (avoids O(n²) lookup)

**Go:**
```go
func BuildTree(preorder, inorder []int) *Node {
    idx := make(map[int]int, len(inorder))
    for i, v := range inorder {
        idx[v] = i
    }
    var build func(preLo, preHi, inLo, inHi int) *Node
    build = func(preLo, preHi, inLo, inHi int) *Node {
        if preLo > preHi {
            return nil
        }
        root := &Node{Val: preorder[preLo]}
        mid := idx[root.Val]
        leftSize := mid - inLo
        root.Left  = build(preLo+1, preLo+leftSize, inLo, mid-1)
        root.Right = build(preLo+leftSize+1, preHi, mid+1, inHi)
        return root
    }
    return build(0, len(preorder)-1, 0, len(inorder)-1)
}
```

**Python:**
```python
def build_tree(preorder, inorder):
    idx = {v: i for i, v in enumerate(inorder)}
    def build(p_lo, p_hi, i_lo, i_hi):
        if p_lo > p_hi:
            return None
        root = TreeNode(preorder[p_lo])
        mid = idx[root.val]
        left_size = mid - i_lo
        root.left  = build(p_lo + 1, p_lo + left_size, i_lo, mid - 1)
        root.right = build(p_lo + left_size + 1, p_hi, mid + 1, i_hi)
        return root
    return build(0, len(preorder) - 1, 0, len(inorder) - 1)
```

Time O(n) with the index map, O(n²) without. The same technique works for **postorder + inorder** (use the last postorder element as root). **Preorder + postorder alone is ambiguous** — there are multiple trees fitting a given pair unless the tree is full.

### Why does this matter?

Compiler front-ends frequently rebuild ASTs from serialized forms (cached IR, pre-compiled headers, JIT inline caches). The algorithm above is exactly what they do. Understanding it makes reading LLVM, V8, and SpiderMonkey source code less mysterious.

---

## Summary

- **Variant detection** in O(n) per kind: full (children come in pairs), complete (BFS with null sentinels), perfect (depth check + full check), balanced (single-pass height with -1 sentinel).
- **Iterative traversals** trade code clarity for stack-overflow safety and pauseability. Preorder is push-right-then-left. Inorder walks the left spine. Postorder uses a "last-visited" sentinel.
- **Morris traversal** (1979) achieves O(1) extra space by temporarily threading null right pointers up to inorder successors. Mutating, not thread-safe, but beautiful.
- **Serialize / deserialize** with preorder + null markers (or LeetCode-style level-order) uniquely encodes a tree. Same idea backs Redis DUMP, pickle, protobuf nested messages.
- **LCA** recursively in O(n); with parent pointers in O(h); with binary lifting in O(log n) after O(n log n) prep.
- **Tree DP** = "return one thing to parent, update a global best". Diameter, max-path-sum, count-good-subtrees all follow this idiom.
- **Threaded trees** (Perlis & Thornton 1960) preceded Morris by 19 years; same idea, made permanent in the data structure.
- **Reconstruction from preorder + inorder** in O(n) with an index map is the standard parser/IR reload technique.

Next: `senior.md` for production usage (DOM trees, ASTs, file systems, HashMap treeification, Merkle trees) and `professional.md` for cache layouts, arenas, lock-free traversal, and persistent trees.
