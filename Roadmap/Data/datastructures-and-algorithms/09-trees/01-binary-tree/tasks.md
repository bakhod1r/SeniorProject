# Binary Tree — Hands-On Tasks

> **Audience:** Anyone working through the binary-tree topic. Ten tasks of escalating difficulty, each with hints, a reference solution in Go/Java/Python, test cases, complexity analysis, and lessons learned. Do them in order — later tasks reuse code from earlier ones.

The point of these tasks is to **build muscle memory**. Reading code is not enough; you have to type the universal DFS template five times before it lives in your fingers. Set aside an afternoon, fire up your editor, and do all ten without copy-pasting from the document. Then come back, read your code against the reference, and notice your own bugs.

---

## Table of Contents

1. [Task 1 — Node Struct and Four Traversals from Scratch](#task1)
2. [Task 2 — Compute Size, Height, and Leaf Count in One DFS](#task2)
3. [Task 3 — Check Height-Balanced (Within ±1)](#task3)
4. [Task 4 — Print Tree as ASCII Art (Rotated 90°)](#task4)
5. [Task 5 — Mirror a Tree In Place](#task5)
6. [Task 6 — Build a Tree from a Flat Array (Level-Order with Nulls)](#task6)
7. [Task 7 — Find All Root-to-Leaf Paths](#task7)
8. [Task 8 — Morris Inorder Traversal (O(1) Space)](#task8)
9. [Task 9 — Serialize Tree to a String and Rebuild from It](#task9)
10. [Task 10 — Detect Isomorphic Trees (Structural Identity Ignoring Child Order)](#task10)

---

<a name="task1"></a>
## Task 1 — Node Struct and Four Traversals from Scratch

**Problem.** Define a `Node` for a binary tree of ints. Implement **preorder**, **inorder**, **postorder**, and **level-order** traversals as functions that fill a slice/list/array with the visit order and return it.

**Hints.**
- Use the universal DFS template for the first three.
- Use a queue (deque/ArrayDeque/slice) for level-order.
- Handle the empty tree (`nil` root) as a valid input.

**Reference solution — Go:**
```go
type Node struct {
    Val   int
    Left  *Node
    Right *Node
}

func Preorder(root *Node) []int {
    var out []int
    var dfs func(*Node)
    dfs = func(n *Node) {
        if n == nil { return }
        out = append(out, n.Val)
        dfs(n.Left); dfs(n.Right)
    }
    dfs(root); return out
}
func Inorder(root *Node) []int {
    var out []int
    var dfs func(*Node)
    dfs = func(n *Node) {
        if n == nil { return }
        dfs(n.Left)
        out = append(out, n.Val)
        dfs(n.Right)
    }
    dfs(root); return out
}
func Postorder(root *Node) []int {
    var out []int
    var dfs func(*Node)
    dfs = func(n *Node) {
        if n == nil { return }
        dfs(n.Left); dfs(n.Right)
        out = append(out, n.Val)
    }
    dfs(root); return out
}
func LevelOrder(root *Node) []int {
    if root == nil { return nil }
    out := []int{}
    q := []*Node{root}
    for len(q) > 0 {
        n := q[0]
        q = q[1:]
        out = append(out, n.Val)
        if n.Left  != nil { q = append(q, n.Left)  }
        if n.Right != nil { q = append(q, n.Right) }
    }
    return out
}
```

**Reference — Java/Python.** Direct translations of the above. The structure is identical: base case on null, recurse, append. For BFS, use `ArrayDeque` in Java and `deque` in Python.

**Test cases.**
- Empty tree → all four return empty.
- Single node `{42}` → all four return `[42]`.
- Example tree from `junior.md` (`10, 5, 15, 3, 7, null, 20`):
  - Preorder: `[10, 5, 3, 7, 15, 20]`
  - Inorder: `[3, 5, 7, 10, 15, 20]`
  - Postorder: `[3, 7, 5, 20, 15, 10]`
  - Level-order: `[10, 5, 15, 3, 7, 20]`
- Left-skewed tree `1 → 2 → 3`: pre = `[1,2,3]`, in = `[3,2,1]`, post = `[3,2,1]`, level = `[1,2,3]`.

**Complexity.** O(n) time for all four; O(h) recursion stack for DFS, O(w) queue width for BFS.

**Lessons learned.** Four traversals share the same skeleton; only the position of `out.append(n.Val)` differs (before recursing for preorder, between for inorder, after for postorder). This is the most important observation in tree algorithms.

---

<a name="task2"></a>
## Task 2 — Compute Size, Height, and Leaf Count in One DFS

**Problem.** Write a single recursive function that returns the tuple `(size, height, leaves)` of the subtree rooted at `root`. Don't make three separate passes.

**Hints.**
- Define a helper that recursively returns the triple.
- Combine: `size = 1 + lSize + rSize`, `height = 1 + max(lH, rH)` (with empty=-1), `leaves = 1 if leaf else lL + rL`.
- A node is a leaf if both children are null.

**Reference — Python:**
```python
def stats(root):
    """Return (size, height, leaves). Empty tree -> (0, -1, 0)."""
    if root is None:
        return (0, -1, 0)
    lS, lH, lL = stats(root.left)
    rS, rH, rL = stats(root.right)
    size   = 1 + lS + rS
    height = 1 + max(lH, rH)
    leaves = (1 if root.left is None and root.right is None
              else lL + rL)
    return (size, height, leaves)
```

**Reference — Go:**
```go
type Stats struct {
    Size, Height, Leaves int
}
func TreeStats(n *Node) Stats {
    if n == nil {
        return Stats{0, -1, 0}
    }
    l := TreeStats(n.Left)
    r := TreeStats(n.Right)
    h := l.Height
    if r.Height > h {
        h = r.Height
    }
    leaves := l.Leaves + r.Leaves
    if n.Left == nil && n.Right == nil {
        leaves = 1
    }
    return Stats{1 + l.Size + r.Size, 1 + h, leaves}
}
```

**Reference — Java:**
```java
record Stats(int size, int height, int leaves) {}
Stats stats(TreeNode n) {
    if (n == null) return new Stats(0, -1, 0);
    Stats l = stats(n.left), r = stats(n.right);
    int sz = 1 + l.size() + r.size();
    int h  = 1 + Math.max(l.height(), r.height());
    int lv = (n.left == null && n.right == null)
             ? 1 : l.leaves() + r.leaves();
    return new Stats(sz, h, lv);
}
```

**Test cases.**
- Empty → (0, -1, 0).
- Single node → (1, 0, 1).
- Example tree → (6, 2, 3) — six nodes, height 2 (edges), three leaves (3, 7, 20).
- Skewed `1→2→3` → (3, 2, 1).

**Complexity.** O(n) time, O(h) space, one pass.

**Lessons learned.** The "two-channel" pattern from `middle.md` generalizes to any number of channels — three here. As long as each statistic has an O(1) combiner from its children, you can compute many statistics in one pass.

---

<a name="task3"></a>
## Task 3 — Check Height-Balanced (Within ±1)

**Problem.** Return true iff for every node, `|height(left) - height(right)| <= 1`. The naive solution is O(n²); achieve O(n).

**Hints.**
- The trick: return a sentinel (e.g., -1) from the recursive height function as soon as imbalance is detected.
- Short-circuit: if a subtree is unbalanced, no need to check the other.

**Reference — Python:**
```python
def is_balanced(root):
    def height_or_fail(n):
        if n is None: return 0
        lh = height_or_fail(n.left)
        if lh == -1: return -1
        rh = height_or_fail(n.right)
        if rh == -1: return -1
        if abs(lh - rh) > 1: return -1
        return 1 + max(lh, rh)
    return height_or_fail(root) != -1
```

**Reference — Go:**
```go
func IsBalanced(root *Node) bool {
    var h func(*Node) int
    h = func(n *Node) int {
        if n == nil { return 0 }
        l := h(n.Left)
        if l == -1 { return -1 }
        r := h(n.Right)
        if r == -1 { return -1 }
        if l-r > 1 || r-l > 1 { return -1 }
        if l > r { return l + 1 }
        return r + 1
    }
    return h(root) != -1
}
```

**Reference — Java:**
```java
public boolean isBalanced(TreeNode root) {
    return h(root) != -1;
}
private int h(TreeNode n) {
    if (n == null) return 0;
    int l = h(n.left);
    if (l == -1) return -1;
    int r = h(n.right);
    if (r == -1) return -1;
    if (Math.abs(l - r) > 1) return -1;
    return 1 + Math.max(l, r);
}
```

**Test cases.**
- Empty → balanced.
- Single node → balanced.
- Perfect tree of height 3 → balanced.
- Skewed → unbalanced for n >= 3 (heights 0 and 1 are 1 apart for n=2 — still balanced).
- A tree where one subtree has height 0 and the other has height 2 → unbalanced.

**Complexity.** O(n) time, O(h) space. The short-circuit makes the worst case still O(n) (we recurse once per node).

**Lessons learned.** The naive "for each node check `|height(left) - height(right)| <= 1`" calls `height` once per node, and `height` is O(n) → O(n²) total. The single-pass trick is to fuse the height computation with the balance check.

---

<a name="task4"></a>
## Task 4 — Print Tree as ASCII Art (Rotated 90°)

**Problem.** Print the tree so the root is at the left edge and the tree extends rightward. Each level adds indentation. Right subtree is printed first (so the layout reads top-to-bottom as right-to-left visually).

```
Example tree (10, 5, 15, 3, 7, null, 20) should print as:
        20
    15
10
        7
    5
        3
```

**Hints.**
- Reverse-inorder traversal (right, self, left) with depth tracking.
- Print `n.val` indented by `4 * depth` spaces.

**Reference — Python:**
```python
def print_tree(root, depth=0):
    if root is None: return
    print_tree(root.right, depth + 1)
    print("    " * depth + str(root.val))
    print_tree(root.left,  depth + 1)
```

**Reference — Go:**
```go
func PrintTree(root *Node, depth int, w io.Writer) {
    if root == nil { return }
    PrintTree(root.Right, depth+1, w)
    fmt.Fprintln(w, strings.Repeat("    ", depth)+strconv.Itoa(root.Val))
    PrintTree(root.Left, depth+1, w)
}
```

**Reference — Java:**
```java
public static void print(TreeNode root) { print(root, 0); }
private static void print(TreeNode n, int depth) {
    if (n == null) return;
    print(n.right, depth + 1);
    System.out.println("    ".repeat(depth) + n.val);
    print(n.left, depth + 1);
}
```

**Test cases.**
- Empty → no output.
- Single → just `42`.
- Example → as shown above.
- Skewed-left → root at the top, each subsequent node indented one level more.

**Complexity.** O(n) time, O(h) recursion stack, O(n) output size.

**Lessons learned.** ASCII tree printing is just a traversal in a slightly unusual order. The same template — but printing instead of collecting — gives you a debugging tool you'll use forever.

---

<a name="task5"></a>
## Task 5 — Mirror a Tree In Place

**Problem.** For every node, swap left and right children. Return the (modified) root.

**Hints.**
- Trivial recursion: swap children, recurse into each.
- Watch the order: in Java/C++ you must recurse on both children **before** assignment, or use a temporary variable.

**Reference — Go:**
```go
func Mirror(root *Node) *Node {
    if root == nil { return nil }
    root.Left, root.Right = Mirror(root.Right), Mirror(root.Left)
    return root
}
```

**Reference — Java:**
```java
public TreeNode mirror(TreeNode root) {
    if (root == null) return null;
    TreeNode l = mirror(root.right);
    TreeNode r = mirror(root.left);
    root.left  = l;
    root.right = r;
    return root;
}
```

**Reference — Python:**
```python
def mirror(root):
    if root is None: return None
    root.left, root.right = mirror(root.right), mirror(root.left)
    return root
```

**Test cases.**
- Empty → still empty.
- Single node → unchanged.
- Example tree → preorder of mirror should be `[10, 15, 20, 5, 7, 3]`.
- Mirror twice → original tree restored.

**Complexity.** O(n) time, O(h) space.

**Lessons learned.** Order of evaluation matters when you're mutating. Java's eager assignment makes the naive solution wrong; Python's tuple unpacking and Go's parallel assignment hide the issue. Know your language's evaluation order.

---

<a name="task6"></a>
## Task 6 — Build a Tree from a Flat Array (Level-Order with Nulls)

**Problem.** Given an input like `[1, 2, 3, None, 4, None, 5]`, build the binary tree where the array is level-order with `None` marking absent children. This is the LeetCode tree-encoding convention.

**Hints.**
- BFS with a queue: pop the next parent, attach its left from the next array slot, then right from the slot after.
- Skip null entries — don't enqueue them.

**Reference — Python:**
```python
from collections import deque

def build(vals):
    if not vals or vals[0] is None: return None
    root = TreeNode(vals[0])
    q = deque([root])
    i = 1
    while q and i < len(vals):
        n = q.popleft()
        if i < len(vals) and vals[i] is not None:
            n.left = TreeNode(vals[i])
            q.append(n.left)
        i += 1
        if i < len(vals) and vals[i] is not None:
            n.right = TreeNode(vals[i])
            q.append(n.right)
        i += 1
    return root
```

**Reference — Go:**
```go
func Build(vals []*int) *Node {
    if len(vals) == 0 || vals[0] == nil { return nil }
    root := &Node{Val: *vals[0]}
    q := []*Node{root}
    i := 1
    for len(q) > 0 && i < len(vals) {
        n := q[0]; q = q[1:]
        if i < len(vals) && vals[i] != nil {
            n.Left = &Node{Val: *vals[i]}
            q = append(q, n.Left)
        }
        i++
        if i < len(vals) && vals[i] != nil {
            n.Right = &Node{Val: *vals[i]}
            q = append(q, n.Right)
        }
        i++
    }
    return root
}
```

**Reference — Java:**
```java
public TreeNode build(Integer[] vals) {
    if (vals.length == 0 || vals[0] == null) return null;
    TreeNode root = new TreeNode(vals[0]);
    Deque<TreeNode> q = new ArrayDeque<>();
    q.offer(root);
    int i = 1;
    while (!q.isEmpty() && i < vals.length) {
        TreeNode n = q.poll();
        if (i < vals.length && vals[i] != null) {
            n.left = new TreeNode(vals[i]);
            q.offer(n.left);
        }
        i++;
        if (i < vals.length && vals[i] != null) {
            n.right = new TreeNode(vals[i]);
            q.offer(n.right);
        }
        i++;
    }
    return root;
}
```

**Test cases.**
- `[]` → null.
- `[1]` → single node.
- `[1, 2, 3]` → root with two children.
- `[1, null, 2]` → root with only right child.
- `[1, 2, 3, null, 4, 5, 6]` → builds matching LeetCode shape.
- `[1, 2, 3, null, null, 4, 5]` → mid-tree nulls handled.

**Complexity.** O(n) time, O(n) space.

**Lessons learned.** Null markers in the input array represent **gaps**, which is why we don't enqueue them — they have no children of their own. This matches the BFS serialization in `middle.md` §4.

---

<a name="task7"></a>
## Task 7 — Find All Root-to-Leaf Paths

**Problem.** Return a list of all paths from root to any leaf, each path as a list of node values.

**Hints.**
- DFS carrying a `current_path` list. On entering, append; on leaving, pop (backtrack).
- A leaf is a node with no children — that's the moment to record the path.

**Reference — Python:**
```python
def root_to_leaf_paths(root):
    out, path = [], []
    def dfs(n):
        if n is None: return
        path.append(n.val)
        if n.left is None and n.right is None:
            out.append(path[:])    # copy
        else:
            dfs(n.left); dfs(n.right)
        path.pop()                  # backtrack
    dfs(root)
    return out
```

**Reference — Go:**
```go
func RootToLeafPaths(root *Node) [][]int {
    var out [][]int
    var path []int
    var dfs func(*Node)
    dfs = func(n *Node) {
        if n == nil { return }
        path = append(path, n.Val)
        if n.Left == nil && n.Right == nil {
            cp := make([]int, len(path))
            copy(cp, path)
            out = append(out, cp)
        } else {
            dfs(n.Left); dfs(n.Right)
        }
        path = path[:len(path)-1]   // backtrack
    }
    dfs(root)
    return out
}
```

**Reference — Java:**
```java
public List<List<Integer>> rootToLeafPaths(TreeNode root) {
    List<List<Integer>> out = new ArrayList<>();
    Deque<Integer> path = new ArrayDeque<>();
    dfs(root, path, out);
    return out;
}
private void dfs(TreeNode n, Deque<Integer> path, List<List<Integer>> out) {
    if (n == null) return;
    path.addLast(n.val);
    if (n.left == null && n.right == null) {
        out.add(new ArrayList<>(path));
    } else {
        dfs(n.left, path, out);
        dfs(n.right, path, out);
    }
    path.removeLast();
}
```

**Test cases.**
- Empty → `[]`.
- Single → `[[42]]`.
- Example tree → `[[10,5,3], [10,5,7], [10,15,20]]`.

**Complexity.** O(n × h) — there are up to n/2 leaves, each path up to h long. Worst case for a balanced tree: O(n log n) output bytes, which dominates.

**Lessons learned.** "Backtracking" is just DFS with append-on-enter and pop-on-leave. The `path[:]` copy is essential — without it, the same list is mutated in all results.

---

<a name="task8"></a>
## Task 8 — Morris Inorder Traversal (O(1) Space)

**Problem.** Implement inorder traversal without recursion and without a stack, using O(1) auxiliary space. Use the Morris threading trick from `middle.md` §3.

**Hints.**
- If `cur.left` is null, visit `cur` and move right.
- Else, find the rightmost node in `cur.left` (the inorder predecessor). If its `right` is null, set it to `cur` (thread) and move left. If its `right` is already `cur`, undo the thread, visit `cur`, move right.

**Reference — Go:**
```go
func MorrisInorder(root *Node) []int {
    var out []int
    cur := root
    for cur != nil {
        if cur.Left == nil {
            out = append(out, cur.Val)
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
            out = append(out, cur.Val)
            cur = cur.Right
        }
    }
    return out
}
```

**Reference — Java:**
```java
public List<Integer> morrisInorder(TreeNode root) {
    List<Integer> out = new ArrayList<>();
    TreeNode cur = root;
    while (cur != null) {
        if (cur.left == null) {
            out.add(cur.val);
            cur = cur.right;
            continue;
        }
        TreeNode pred = cur.left;
        while (pred.right != null && pred.right != cur)
            pred = pred.right;
        if (pred.right == null) {
            pred.right = cur;
            cur = cur.left;
        } else {
            pred.right = null;
            out.add(cur.val);
            cur = cur.right;
        }
    }
    return out;
}
```

**Reference — Python:**
```python
def morris_inorder(root):
    out, cur = [], root
    while cur:
        if cur.left is None:
            out.append(cur.val)
            cur = cur.right
            continue
        pred = cur.left
        while pred.right and pred.right is not cur:
            pred = pred.right
        if pred.right is None:
            pred.right = cur
            cur = cur.left
        else:
            pred.right = None
            out.append(cur.val)
            cur = cur.right
    return out
```

**Test cases.**
- Empty → `[]`.
- Single → `[42]`.
- Example → `[3, 5, 7, 10, 15, 20]` — same as recursive inorder.
- Skewed-right tree (no left children) → falls through the easy path, output is just sequential.
- Verify the tree is **structurally unchanged** after the traversal — threads are undone.

**Complexity.** O(n) time (each edge walked at most twice), O(1) extra space.

**Lessons learned.** Morris is a famous interview problem ("inorder with O(1) space"). It mutates the tree during traversal — not safe for concurrent reads, not safe on immutable trees. But it is a beautiful example of how seemingly required overhead (the stack) can be eliminated by reusing existing structure.

---

<a name="task9"></a>
## Task 9 — Serialize Tree to a String and Rebuild from It

**Problem.** Implement `serialize(root) -> str` and `deserialize(str) -> root` such that `deserialize(serialize(t))` produces a tree structurally identical and value-identical to `t`. Use preorder with `#` for null. Already covered in `middle.md` §4 and `interview.md` LC297.

**Hints.**
- Serialize with preorder: write the value (or `#`), then recurse left, then recurse right.
- Deserialize by reading tokens one at a time. `#` returns null; otherwise build a node and recurse.

**Reference — Python:**
```python
def serialize(root):
    out = []
    def pre(n):
        if n is None:
            out.append("#"); return
        out.append(str(n.val))
        pre(n.left); pre(n.right)
    pre(root)
    return " ".join(out)

def deserialize(s):
    it = iter(s.split())
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

**Reference — Go, Java:** see `interview.md` §9.

**Test cases.**
- Empty tree → `"#"`. Round-trip → empty.
- Single → `"42 # #"`. Round-trip → `Node{42}`.
- Example tree → `"10 5 3 # # 7 # # 15 # 20 # #"`. Round-trip → equal structure and values.
- Property test: build 100 random trees, serialize, deserialize, compare with LC 100 `isSameTree` — they should all match.

**Complexity.** O(n) both directions, O(n) string size.

**Lessons learned.** Preorder uniquely identifies a tree only when null markers are present — without them, a tree and its mirror serialize to the same string. The same logic underpins protobuf nested messages, pickle, and most binary IR formats.

---

<a name="task10"></a>
## Task 10 — Detect Isomorphic Trees (Structural Identity Ignoring Child Order)

**Problem.** Two trees are **isomorphic** if one can be made identical to the other by swapping left/right children at any nodes (any number of times). Values must match positionally after the swaps. Return true iff trees `p` and `q` are isomorphic.

**Hints.**
- Recursive: nulls match nulls; values must match; **either** `(p.left, p.right)` matches `(q.left, q.right)` **or** the swapped pairing matches.

**Reference — Python:**
```python
def is_isomorphic(p, q):
    if p is None and q is None: return True
    if p is None or  q is None: return False
    if p.val != q.val:           return False
    same    = is_isomorphic(p.left,  q.left)  and is_isomorphic(p.right, q.right)
    swapped = is_isomorphic(p.left,  q.right) and is_isomorphic(p.right, q.left)
    return same or swapped
```

**Reference — Go:**
```go
func IsIsomorphic(p, q *Node) bool {
    if p == nil && q == nil { return true }
    if p == nil || q == nil { return false }
    if p.Val != q.Val { return false }
    return (IsIsomorphic(p.Left,  q.Left)  && IsIsomorphic(p.Right, q.Right)) ||
           (IsIsomorphic(p.Left,  q.Right) && IsIsomorphic(p.Right, q.Left))
}
```

**Reference — Java:**
```java
public boolean isIsomorphic(TreeNode p, TreeNode q) {
    if (p == null && q == null) return true;
    if (p == null || q == null) return false;
    if (p.val != q.val)         return false;
    return (isIsomorphic(p.left,  q.left)  && isIsomorphic(p.right, q.right))
        || (isIsomorphic(p.left,  q.right) && isIsomorphic(p.right, q.left));
}
```

**Test cases.**
- Both empty → true.
- One empty → false.
- Identical trees → true.
- A tree and its mirror → true (one swap at the root).
- Different values → false.
- Same structure but different values somewhere → false.
- Different structure (one has a left-leaf, the other has a right-leaf at a different depth) → false.

**Complexity.** Naive recurrence: `T(n) = 4 T(n/2) + O(1)` → `O(n²)` in the worst case (we branch 4 times per level). Tighter analyses for many practical trees give better behavior; for adversarial trees the worst case is `O(n^2)` (or O(n^log₂ 4) = O(n²)). For interviews, this is acceptable.

**Optimization.** Compute a **canonical form** for each subtree (e.g., a hash of the sorted multiset of child hashes), then compare canonical forms in O(n) total. This is how isomorphism is solved at scale (AHU algorithm, Aho-Hopcroft-Ullman 1974).

**Lessons learned.** Isomorphism is structurally similar to "same tree" but with one extra OR. Many tree-recursion problems generalize this way — "try one thing OR try a flipped version".

---

## Wrap-up

Each task adds one technique to your toolbox:

| Task | Technique |
|---|---|
| 1 | Four traversal templates |
| 2 | Multi-statistic single-pass DFS |
| 3 | Short-circuit via sentinel return |
| 4 | Reverse-order traversal for printing |
| 5 | In-place mutation, eval-order pitfalls |
| 6 | BFS construction with null gaps |
| 7 | DFS + backtracking with shared mutable state |
| 8 | Morris threading for O(1) space |
| 9 | Preorder serialization round-trip |
| 10 | Branching OR-recursion (isomorphism) |

Repeat the tasks until you can do all ten in under two hours without consulting the reference. Then move to BSTs (`02-bst`) — the same templates with the added invariant `left < root < right`.
