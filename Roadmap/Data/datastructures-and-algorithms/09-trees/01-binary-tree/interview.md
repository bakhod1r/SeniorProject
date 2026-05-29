# Binary Tree — Interview Problems

> **Audience:** Anyone preparing for FAANG-style coding interviews on binary trees. 12 essential problems, each with three-language solutions, complexity analysis, and pitfall notes. Prerequisites: `junior.md`, `middle.md`.

Tree problems are a top-3 category in coding interviews, alongside arrays/strings and graphs. The good news: nearly all of them reduce to the **universal DFS template** plus one or two twists. The pattern recognition you learn here transfers everywhere.

For each problem we give: the statement (LeetCode reference), the approach, Go/Java/Python solutions, the complexity, and the common pitfalls that cause "almost correct" submissions to fail.

---

## Table of Contents

1. [LC 104 — Maximum Depth of Binary Tree](#lc104)
2. [LC 100 — Same Tree](#lc100)
3. [LC 101 — Symmetric Tree](#lc101)
4. [LC 102 — Binary Tree Level Order Traversal](#lc102)
5. [LC 226 — Invert Binary Tree](#lc226)
6. [LC 543 — Diameter of Binary Tree](#lc543)
7. [LC 124 — Binary Tree Maximum Path Sum](#lc124)
8. [LC 236 — Lowest Common Ancestor](#lc236)
9. [LC 297 — Serialize and Deserialize Binary Tree](#lc297)
10. [LC 199 — Binary Tree Right Side View](#lc199)
11. [LC 105 — Construct Binary Tree from Preorder and Inorder](#lc105)
12. [LC 114 — Flatten Binary Tree to Linked List](#lc114)

---

<a name="lc104"></a>
## 1. LC 104 — Maximum Depth of Binary Tree

**Statement.** Given the root of a binary tree, return its maximum depth — the number of nodes along the longest root-to-leaf path.

**Approach.** The universal DFS template. Base case: empty → 0. Recursive case: 1 + max(left depth, right depth).

**Go:**
```go
func MaxDepth(root *TreeNode) int {
    if root == nil {
        return 0
    }
    l, r := MaxDepth(root.Left), MaxDepth(root.Right)
    if l > r {
        return l + 1
    }
    return r + 1
}
```

**Java:**
```java
public int maxDepth(TreeNode root) {
    if (root == null) return 0;
    return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
}
```

**Python:**
```python
def maxDepth(root):
    if root is None:
        return 0
    return 1 + max(maxDepth(root.left), maxDepth(root.right))
```

**Complexity.** O(n) time, O(h) space (recursion stack). For a balanced tree h = log n; for a skewed tree h = n.

**Pitfalls.**
- "Depth in nodes" (1 for a single node) vs "depth in edges" (0 for a single node). LeetCode 104 uses nodes — return 1 for a single node, 0 for empty.
- Iterative BFS works too (count levels), but recursion is shorter.

---

<a name="lc100"></a>
## 2. LC 100 — Same Tree

**Statement.** Given two binary tree roots `p` and `q`, return true iff they are structurally identical and have the same values at corresponding positions.

**Approach.** Recursive pairwise comparison. Both null → equal. One null → unequal. Otherwise: values match AND left subtrees equal AND right subtrees equal.

**Go:**
```go
func IsSameTree(p, q *TreeNode) bool {
    if p == nil && q == nil {
        return true
    }
    if p == nil || q == nil {
        return false
    }
    return p.Val == q.Val &&
        IsSameTree(p.Left, q.Left) &&
        IsSameTree(p.Right, q.Right)
}
```

**Java:**
```java
public boolean isSameTree(TreeNode p, TreeNode q) {
    if (p == null && q == null) return true;
    if (p == null || q == null) return false;
    return p.val == q.val
        && isSameTree(p.left,  q.left)
        && isSameTree(p.right, q.right);
}
```

**Python:**
```python
def isSameTree(p, q):
    if p is None and q is None: return True
    if p is None or  q is None: return False
    return (p.val == q.val
            and isSameTree(p.left,  q.left)
            and isSameTree(p.right, q.right))
```

**Complexity.** O(min(|p|, |q|)) time, O(min(h_p, h_q)) space.

**Pitfalls.**
- Comparing references (`p == q` in Java) doesn't compare values.
- Two-line check `if p is None or q is None: return p is q` is a clever way to merge the two null cases.

---

<a name="lc101"></a>
## 3. LC 101 — Symmetric Tree

**Statement.** Return true iff the tree is a mirror image of itself (symmetric around its root).

**Approach.** Recursive helper on two nodes: are they mirror images? Mirror means values equal AND a's left mirrors b's right AND a's right mirrors b's left.

**Go:**
```go
func IsSymmetric(root *TreeNode) bool {
    if root == nil {
        return true
    }
    return mirror(root.Left, root.Right)
}
func mirror(a, b *TreeNode) bool {
    if a == nil && b == nil {
        return true
    }
    if a == nil || b == nil {
        return false
    }
    return a.Val == b.Val && mirror(a.Left, b.Right) && mirror(a.Right, b.Left)
}
```

**Java:**
```java
public boolean isSymmetric(TreeNode root) {
    return root == null || mirror(root.left, root.right);
}
private boolean mirror(TreeNode a, TreeNode b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.val == b.val && mirror(a.left, b.right) && mirror(a.right, b.left);
}
```

**Python:**
```python
def isSymmetric(root):
    def mirror(a, b):
        if a is None and b is None: return True
        if a is None or  b is None: return False
        return a.val == b.val and mirror(a.left, b.right) and mirror(a.right, b.left)
    return root is None or mirror(root.left, root.right)
```

**Complexity.** O(n), O(h).

**Pitfalls.**
- The crucial bug: writing `mirror(a.left, b.left)` instead of `mirror(a.left, b.right)`. That checks structural equality of the two subtrees, not mirror symmetry.
- Iterative version uses a queue with pairs `(a, b)` instead of a single node.

---

<a name="lc102"></a>
## 4. LC 102 — Binary Tree Level Order Traversal

**Statement.** Return a list of lists, each inner list containing the values at one depth, top to bottom.

**Approach.** BFS with a queue. At the top of each iteration record the queue size — that's the count of nodes at the current level.

**Go:**
```go
func LevelOrder(root *TreeNode) [][]int {
    if root == nil {
        return nil
    }
    out := [][]int{}
    q := []*TreeNode{root}
    for len(q) > 0 {
        n := len(q)
        level := make([]int, 0, n)
        for i := 0; i < n; i++ {
            node := q[i]
            level = append(level, node.Val)
            if node.Left != nil {
                q = append(q, node.Left)
            }
            if node.Right != nil {
                q = append(q, node.Right)
            }
        }
        q = q[n:]
        out = append(out, level)
    }
    return out
}
```

**Java:**
```java
public List<List<Integer>> levelOrder(TreeNode root) {
    List<List<Integer>> out = new ArrayList<>();
    if (root == null) return out;
    Deque<TreeNode> q = new ArrayDeque<>();
    q.offer(root);
    while (!q.isEmpty()) {
        int sz = q.size();
        List<Integer> level = new ArrayList<>(sz);
        for (int i = 0; i < sz; i++) {
            TreeNode n = q.poll();
            level.add(n.val);
            if (n.left  != null) q.offer(n.left);
            if (n.right != null) q.offer(n.right);
        }
        out.add(level);
    }
    return out;
}
```

**Python:**
```python
from collections import deque

def levelOrder(root):
    if root is None: return []
    out, q = [], deque([root])
    while q:
        level = []
        for _ in range(len(q)):
            n = q.popleft()
            level.append(n.val)
            if n.left:  q.append(n.left)
            if n.right: q.append(n.right)
        out.append(level)
    return out
```

**Complexity.** O(n) time, O(w) space, where `w` is the maximum width.

**Pitfalls.**
- Forgetting to snapshot the queue size at the top of the level — adding children mid-loop inflates the level.
- LeetCode wants `[[]]` not `[[null]]` for `[]` input; check that "no root" returns an empty outer list.

---

<a name="lc226"></a>
## 5. LC 226 — Invert Binary Tree

**Statement.** Swap every node's left and right child, recursively.

**Approach.** Recursive swap.

**Go:**
```go
func InvertTree(root *TreeNode) *TreeNode {
    if root == nil {
        return nil
    }
    root.Left, root.Right = InvertTree(root.Right), InvertTree(root.Left)
    return root
}
```

**Java:**
```java
public TreeNode invertTree(TreeNode root) {
    if (root == null) return null;
    TreeNode left  = invertTree(root.right);   // recurse first
    TreeNode right = invertTree(root.left);
    root.left  = left;
    root.right = right;
    return root;
}
```

**Python:**
```python
def invertTree(root):
    if root is None:
        return None
    root.left, root.right = invertTree(root.right), invertTree(root.left)
    return root
```

**Complexity.** O(n) time, O(h) space.

**Pitfalls.**
- In Java, naive `root.left = invertTree(root.right); root.right = invertTree(root.left);` is **wrong** — the second call recurses into the already-swapped value. Either use a temporary variable or evaluate both calls before assignment, as shown.
- Python and Go's parallel-assignment syntax sidesteps this bug.

---

<a name="lc543"></a>
## 6. LC 543 — Diameter of Binary Tree

**Statement.** Return the number of edges on the longest path between any two nodes in the tree (path need not pass through root).

**Approach.** Tree DP with two-channel return. Helper returns "depth from here downward"; global tracks "longest path passing through any node".

**Go:**
```go
func DiameterOfBinaryTree(root *TreeNode) int {
    best := 0
    var depth func(*TreeNode) int
    depth = func(n *TreeNode) int {
        if n == nil {
            return 0
        }
        l := depth(n.Left)
        r := depth(n.Right)
        if l+r > best {
            best = l + r
        }
        if l > r {
            return l + 1
        }
        return r + 1
    }
    depth(root)
    return best
}
```

**Java:**
```java
private int best = 0;
public int diameterOfBinaryTree(TreeNode root) {
    best = 0;
    depth(root);
    return best;
}
private int depth(TreeNode n) {
    if (n == null) return 0;
    int l = depth(n.left), r = depth(n.right);
    best = Math.max(best, l + r);
    return 1 + Math.max(l, r);
}
```

**Python:**
```python
def diameterOfBinaryTree(root):
    best = 0
    def depth(n):
        nonlocal best
        if n is None: return 0
        l, r = depth(n.left), depth(n.right)
        best = max(best, l + r)
        return 1 + max(l, r)
    depth(root)
    return best
```

**Complexity.** O(n), O(h).

**Pitfalls.**
- Diameter is in **edges**, not nodes. The path `A-B-C` has 2 edges, not 3 nodes. `l + r` (in edges) is correct; `l + r + 1` (in nodes) is wrong for LC 543.
- Returning the diameter from the helper instead of tracking globally is tempting but wrong — the helper must return "depth", which is what the parent can extend.

---

<a name="lc124"></a>
## 7. LC 124 — Binary Tree Maximum Path Sum

**Statement.** A path is any node-to-node sequence following parent-child edges, each node visited at most once. Return the maximum sum of any path. Values may be negative.

**Approach.** Same two-channel pattern. Helper returns "best one-sided gain extending up to parent"; global tracks "best path bending here". Crucially, **clip negative gains to 0** — if a subtree contributes negative, skip it.

**Go:**
```go
func MaxPathSum(root *TreeNode) int {
    best := math.MinInt32
    var gain func(*TreeNode) int
    gain = func(n *TreeNode) int {
        if n == nil {
            return 0
        }
        l := max(0, gain(n.Left))
        r := max(0, gain(n.Right))
        if n.Val+l+r > best {
            best = n.Val + l + r
        }
        return n.Val + max(l, r)
    }
    gain(root)
    return best
}
func max(a, b int) int { if a > b { return a }; return b }
```

**Java:**
```java
private int best;
public int maxPathSum(TreeNode root) {
    best = Integer.MIN_VALUE;
    gain(root);
    return best;
}
private int gain(TreeNode n) {
    if (n == null) return 0;
    int l = Math.max(0, gain(n.left));
    int r = Math.max(0, gain(n.right));
    best = Math.max(best, n.val + l + r);
    return n.val + Math.max(l, r);
}
```

**Python:**
```python
def maxPathSum(root):
    best = float("-inf")
    def gain(n):
        nonlocal best
        if n is None: return 0
        l = max(0, gain(n.left))
        r = max(0, gain(n.right))
        best = max(best, n.val + l + r)
        return n.val + max(l, r)
    gain(root)
    return best
```

**Complexity.** O(n), O(h).

**Pitfalls.**
- Initialize `best` to `-∞`, not 0. A tree of all-negative values yields a negative answer.
- Forgetting the `max(0, ...)` clipping returns a sum that includes harmful subtrees.
- Returning `gain` and using "the maximum gain" as the answer is wrong — the answer is "best path bending at some node", which can include both children's gains.

---

<a name="lc236"></a>
## 8. LC 236 — Lowest Common Ancestor of a Binary Tree

**Statement.** Given two nodes `p` and `q` in a binary tree (no BST property assumed, no parent pointers), return their lowest common ancestor.

**Approach.** Recurse. If the current node is null, or is `p` or `q`, return it. Otherwise recurse into both subtrees. If both subtrees return non-null, this node is the LCA. Otherwise return whichever side returned non-null.

**Go:**
```go
func LowestCommonAncestor(root, p, q *TreeNode) *TreeNode {
    if root == nil || root == p || root == q {
        return root
    }
    l := LowestCommonAncestor(root.Left, p, q)
    r := LowestCommonAncestor(root.Right, p, q)
    if l != nil && r != nil {
        return root
    }
    if l != nil {
        return l
    }
    return r
}
```

**Java:**
```java
public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
    if (root == null || root == p || root == q) return root;
    TreeNode l = lowestCommonAncestor(root.left,  p, q);
    TreeNode r = lowestCommonAncestor(root.right, p, q);
    if (l != null && r != null) return root;
    return l != null ? l : r;
}
```

**Python:**
```python
def lowestCommonAncestor(root, p, q):
    if root is None or root is p or root is q:
        return root
    l = lowestCommonAncestor(root.left,  p, q)
    r = lowestCommonAncestor(root.right, p, q)
    if l and r: return root
    return l if l else r
```

**Complexity.** O(n), O(h).

**Pitfalls.**
- This solution **assumes** both `p` and `q` are in the tree. If one might be absent, a separate "found" flag pass is needed (or post-validate).
- The check is *reference equality* (`root == p`), not value equality. Don't compare `root.val == p.val` unless the problem guarantees unique values.

---

<a name="lc297"></a>
## 9. LC 297 — Serialize and Deserialize Binary Tree

**Statement.** Design serialize/deserialize methods so the original tree can be recovered exactly.

**Approach.** Preorder with `#` sentinel for null. Already covered in `middle.md`; here are minor variations.

**Go:**
```go
type Codec struct{}
func (c *Codec) Serialize(root *TreeNode) string {
    var sb strings.Builder
    var pre func(*TreeNode)
    pre = func(n *TreeNode) {
        if n == nil {
            sb.WriteString("# ")
            return
        }
        sb.WriteString(strconv.Itoa(n.Val))
        sb.WriteByte(' ')
        pre(n.Left)
        pre(n.Right)
    }
    pre(root)
    return sb.String()
}
func (c *Codec) Deserialize(data string) *TreeNode {
    toks := strings.Fields(data)
    i := 0
    var build func() *TreeNode
    build = func() *TreeNode {
        if i >= len(toks) || toks[i] == "#" {
            i++
            return nil
        }
        v, _ := strconv.Atoi(toks[i]); i++
        n := &TreeNode{Val: v}
        n.Left  = build()
        n.Right = build()
        return n
    }
    return build()
}
```

**Java:**
```java
public class Codec {
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
    public TreeNode deserialize(String data) {
        Iterator<String> it = Arrays.stream(data.trim().split("\\s+")).iterator();
        return build(it);
    }
    private TreeNode build(Iterator<String> it) {
        if (!it.hasNext()) return null;
        String t = it.next();
        if (t.equals("#")) return null;
        TreeNode n = new TreeNode(Integer.parseInt(t));
        n.left  = build(it);
        n.right = build(it);
        return n;
    }
}
```

**Python:**
```python
class Codec:
    def serialize(self, root):
        out = []
        def pre(n):
            if n is None:
                out.append("#"); return
            out.append(str(n.val))
            pre(n.left); pre(n.right)
        pre(root)
        return " ".join(out)
    def deserialize(self, data):
        it = iter(data.split())
        def build():
            t = next(it, None)
            if t is None or t == "#":
                return None
            n = TreeNode(int(t))
            n.left  = build()
            n.right = build()
            return n
        return build()
```

**Complexity.** O(n) for both.

**Pitfalls.**
- Forgetting to emit a null marker → ambiguous serialization.
- Using `split(",")` when input separator is space (or vice versa).
- BFS-based serialization (LeetCode format) is also fine — see `middle.md`.

---

<a name="lc199"></a>
## 10. LC 199 — Binary Tree Right Side View

**Statement.** Imagine standing on the right side of the tree. Return the values of the nodes you can see, top to bottom.

**Approach.** Two equally common solutions: (a) BFS, take the **last** node of each level; (b) DFS visiting right child first, push to result the first time we hit each new depth.

**Go (DFS):**
```go
func RightSideView(root *TreeNode) []int {
    out := []int{}
    var dfs func(*TreeNode, int)
    dfs = func(n *TreeNode, depth int) {
        if n == nil {
            return
        }
        if depth == len(out) {
            out = append(out, n.Val)
        }
        dfs(n.Right, depth+1)
        dfs(n.Left,  depth+1)
    }
    dfs(root, 0)
    return out
}
```

**Java (BFS):**
```java
public List<Integer> rightSideView(TreeNode root) {
    List<Integer> out = new ArrayList<>();
    if (root == null) return out;
    Deque<TreeNode> q = new ArrayDeque<>();
    q.offer(root);
    while (!q.isEmpty()) {
        int sz = q.size();
        for (int i = 0; i < sz; i++) {
            TreeNode n = q.poll();
            if (i == sz - 1) out.add(n.val);
            if (n.left  != null) q.offer(n.left);
            if (n.right != null) q.offer(n.right);
        }
    }
    return out;
}
```

**Python (DFS):**
```python
def rightSideView(root):
    out = []
    def dfs(n, depth):
        if n is None: return
        if depth == len(out):
            out.append(n.val)
        dfs(n.right, depth + 1)
        dfs(n.left,  depth + 1)
    dfs(root, 0)
    return out
```

**Complexity.** O(n), O(h).

**Pitfalls.**
- DFS must visit right **before** left to ensure we record the rightmost node first at each new depth.
- "Last node at each level" — if a level has no right child but only a left, that left node is the rightmost at its level. Both algorithms handle this correctly.

---

<a name="lc105"></a>
## 11. LC 105 — Construct Binary Tree from Preorder and Inorder

**Statement.** Given preorder and inorder traversal sequences (no duplicates), reconstruct the tree.

**Approach.** First preorder element is the root. Find its position in inorder; everything left = left subtree's inorder; right = right subtree's inorder. Recurse. Use an index map for O(1) lookup.

(Detailed code already in `middle.md` §9; we repeat the Java version here for completeness in the interview file.)

**Java:**
```java
public TreeNode buildTree(int[] preorder, int[] inorder) {
    Map<Integer, Integer> idx = new HashMap<>();
    for (int i = 0; i < inorder.length; i++) idx.put(inorder[i], i);
    return build(preorder, 0, preorder.length - 1, 0, inorder.length - 1, idx);
}
private TreeNode build(int[] pre, int pLo, int pHi, int iLo, int iHi, Map<Integer,Integer> idx) {
    if (pLo > pHi) return null;
    TreeNode root = new TreeNode(pre[pLo]);
    int mid = idx.get(root.val);
    int leftSize = mid - iLo;
    root.left  = build(pre, pLo + 1, pLo + leftSize, iLo, mid - 1, idx);
    root.right = build(pre, pLo + leftSize + 1, pHi, mid + 1, iHi, idx);
    return root;
}
```

**Python:**
```python
def buildTree(preorder, inorder):
    idx = {v: i for i, v in enumerate(inorder)}
    def build(p_lo, p_hi, i_lo, i_hi):
        if p_lo > p_hi: return None
        root = TreeNode(preorder[p_lo])
        mid = idx[root.val]
        left_size = mid - i_lo
        root.left  = build(p_lo + 1, p_lo + left_size, i_lo, mid - 1)
        root.right = build(p_lo + left_size + 1, p_hi, mid + 1, i_hi)
        return root
    return build(0, len(preorder) - 1, 0, len(inorder) - 1)
```

**Go:**
```go
func BuildTree(preorder, inorder []int) *TreeNode {
    idx := make(map[int]int, len(inorder))
    for i, v := range inorder {
        idx[v] = i
    }
    var build func(pLo, pHi, iLo, iHi int) *TreeNode
    build = func(pLo, pHi, iLo, iHi int) *TreeNode {
        if pLo > pHi {
            return nil
        }
        root := &TreeNode{Val: preorder[pLo]}
        mid := idx[root.Val]
        leftSize := mid - iLo
        root.Left  = build(pLo+1, pLo+leftSize, iLo, mid-1)
        root.Right = build(pLo+leftSize+1, pHi, mid+1, iHi)
        return root
    }
    return build(0, len(preorder)-1, 0, len(inorder)-1)
}
```

**Complexity.** O(n) time with the map, O(n) space.

**Pitfalls.**
- Without the index map, naive `Arrays.indexOf` makes it O(n²).
- For duplicate values, the index map breaks down — the problem assumes unique values.
- `leftSize = mid - iLo` is the count of nodes left of the root in inorder; off-by-one here is the most common bug.

---

<a name="lc114"></a>
## 12. LC 114 — Flatten Binary Tree to Linked List

**Statement.** Rearrange the tree in place so that every node's left child is null and every node's right child is the next node in preorder.

**Approach (in-place).** Reverse-preorder visit: for each node, attach its current "previously processed" node as its right child, set left to null. Maintain a `prev` pointer. Equivalent to DFS in preorder reversed.

**Go:**
```go
var prev *TreeNode
func Flatten(root *TreeNode) {
    prev = nil
    flat(root)
}
func flat(n *TreeNode) {
    if n == nil {
        return
    }
    flat(n.Right)
    flat(n.Left)
    n.Right = prev
    n.Left  = nil
    prev = n
}
```

**Java:**
```java
private TreeNode prev = null;
public void flatten(TreeNode root) {
    if (root == null) return;
    flatten(root.right);
    flatten(root.left);
    root.right = prev;
    root.left  = null;
    prev = root;
}
```

**Python:**
```python
def flatten(root):
    prev = [None]
    def flat(n):
        if n is None: return
        flat(n.right)
        flat(n.left)
        n.right = prev[0]
        n.left  = None
        prev[0] = n
    flat(root)
```

**Complexity.** O(n) time, O(h) space (recursion).

**Pitfalls.**
- The intuitive forward-preorder solution requires saving each node's right subtree before recursing into left — error-prone. The reverse-preorder trick is cleaner.
- O(1) space iterative solution (Morris-like): for each node, if it has a left child, find the rightmost in the left subtree, attach the original right to that rightmost, then make the left child the new right and null out left. Move down right.

```python
def flatten_morris(root):
    cur = root
    while cur:
        if cur.left:
            rm = cur.left
            while rm.right:
                rm = rm.right
            rm.right   = cur.right
            cur.right  = cur.left
            cur.left   = None
        cur = cur.right
```

---

## Wrap-up

Every problem here is one of three patterns:

1. **Universal DFS template** (104, 100, 101, 226, 105) — base case on null, recurse, combine.
2. **Two-channel DFS** (543, 124, 199-DFS) — helper returns "value for parent", global tracks "best".
3. **BFS with queue** (102, 199-BFS) — level by level using snapshotted queue size.

LCA (236) and Serdes (297) are flavors of pattern 1 with one twist. Flatten (114) is a clever in-place rearrangement that the Morris-trick generalizes.

Memorize the templates; recognize the pattern; the implementation falls out. Practice all 12 problems until you can write them in 5 minutes each. Then move on to `02-bst` for the search-tree variant.
