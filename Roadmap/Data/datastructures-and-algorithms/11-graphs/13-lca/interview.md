# Lowest Common Ancestor — Interview Preparation

LCA is a favorite interview topic because it scales smoothly with seniority: a junior can solve "LCA of a binary tree" with a recursive walk, a mid-level engineer can build binary lifting for repeated queries, and a senior can discuss the Euler-tour RMQ reduction, the `O(N)`/`O(1)` Farach-Colton–Bender method, and where LCA sits in a real hierarchy service. This file is a graded question bank plus four end-to-end coding challenges with runnable Go, Java, and Python solutions.

> **Online vs offline:** This file focuses on the *online* methods (binary lifting, Euler+RMQ). The offline Tarjan/union-find method has its own topic at `12-disjoint-set / 04-offline-lca` — mention it when an interviewer says "all queries are known up front."

---

## Quick-Reference Cheat Sheet

| Method | Build | Query | Online | Also gives |
|--------|-------|-------|--------|-----------|
| Naive equalize + climb | `O(N)` | `O(N)` | yes | — |
| Binary lifting | `O(N log N)` | `O(log N)` | yes | k-th ancestor, path max/min |
| Euler tour + sparse RMQ | `O(N log N)` | `O(1)` | yes | — |
| Farach-Colton–Bender | `O(N)` | `O(1)` | yes | — |
| Tarjan offline (union-find) | `O((N+Q)α)` | amortized `O(α)` | **no** | — |

Core formulas:

```text
up[0][v]  = parent[v]              # root's parent = root (sentinel)
up[k][v]  = up[k-1][ up[k-1][v] ]  # 2^k ancestor
LOG       = ceil(log2(N))
dist(u,v) = depth[u] + depth[v] - 2*depth[lca(u,v)]
```

LCA query (binary lifting):
1. Lift the deeper node to the shallower node's depth.
2. If equal, that node is the LCA.
3. For `k` high→low: if `up[k][u] != up[k][v]`, jump both.
4. Answer = `up[0][u]`.

For a **BST**, LCA is even simpler: walk from the root; go left if both keys are smaller, right if both larger, else the current node is the LCA.

---

## Junior Questions (12 Q&A)

### J1. What is the Lowest Common Ancestor?
In a rooted tree, the LCA of nodes `u` and `v` is the deepest node that is an ancestor of both. A node counts as its own ancestor, so if `u` is an ancestor of `v`, then `LCA(u, v) = u`. The LCA always exists (the root is a common ancestor) and is unique because the ancestors of any node form a single chain up to the root.

### J2. Why does LCA require the tree to be rooted?
"Ancestor" only has meaning once you fix a root — it is defined as "lies on the path from the node up to the root." Without a root there is no up-direction and no ancestor relation, so the LCA is undefined. Re-rooting the tree changes the answer.

### J3. How do you find the LCA naively?
Bring both nodes to the same depth by lifting the deeper one via parent links, then move both up one step at a time until they meet. The meeting node is the LCA. This is `O(N)` per query in the worst case (a path-shaped tree).

### J4. How do you compute the distance between two nodes using LCA?
`dist(u, v) = depth[u] + depth[v] - 2 * depth[lca(u, v)]`. The path goes up from `u` to the LCA and down to `v`; the two upward segments have lengths `depth[u] - depth[lca]` and `depth[v] - depth[lca]`.

### J5. What is binary lifting?
A preprocessing technique that stores `up[k][v]`, the `2^k`-th ancestor of every node, in a table. Built with the recurrence `up[k][v] = up[k-1][up[k-1][v]]`. It lets you jump up by any distance in `O(log N)` by combining powers of two, which gives `O(log N)` LCA queries after an `O(N log N)` build.

### J6. How do you find the LCA in a Binary Search Tree?
Use the ordering. Starting at the root: if both keys are less than the current node, go left; if both are greater, go right; otherwise the paths diverge here, so the current node is the LCA. This is `O(height)` and needs no extra preprocessing.

### J7. How do you find the LCA of two nodes in a general binary tree (LeetCode 236)?
Recurse. If the current node is null or equals `p` or `q`, return it. Recurse left and right. If both sides return non-null, the current node is the LCA. Otherwise return whichever side is non-null. This is a single `O(N)` post-order pass, no parent pointers needed.

### J8. What does `up[0][v]` store, and what about the root?
`up[0][v]` is the immediate parent of `v`. The root has no parent, so by convention `up[0][root] = root` (it points to itself) — a sentinel that makes over-jumps idempotent so they never read garbage.

### J9. How big should the lifting table be?
`LOG = ceil(log2(N))` rows, each of length `N`. `2^LOG` must be at least the maximum possible depth. For `N` up to `10^5`, `LOG = 17` suffices (`2^17 = 131072`).

### J10. Is LCA(u, u) well-defined?
Yes — it is `u` itself, since every node is its own ancestor. The standard algorithms return it correctly: equalizing depth makes the two equal and returns `u`.

### J11. What is a k-th ancestor query and how does binary lifting answer it?
The k-th ancestor of `v` is the node `k` levels above it. Decompose `k` into its binary set bits and, for each set bit `i`, jump `v = up[i][v]`. If `k > depth[v]`, there is no such ancestor (return a sentinel). This is `O(log N)`.

### J12 (analysis). Why is the climb loop from the high bit down to the low bit?
You want the largest jump that keeps both nodes strictly below the LCA. Taking the biggest safe jump first leaves a remainder the smaller jumps can finish. You jump only when `up[k][u] != up[k][v]`, which proves both are still below the LCA. Going low-to-high could let an early small jump land on or above the LCA and lose that invariant.

---

## Middle Questions (12 Q&A)

### M1. Walk through the full binary-lifting query.
WLOG `depth[u] >= depth[v]`. Lift `u` by `depth[u] - depth[v]` using k-th ancestor. If `u == v`, return `u`. Otherwise, for `k` from `LOG-1` down to `0`, if `up[k][u] != up[k][v]`, set `u = up[k][u]` and `v = up[k][v]`. After the loop, `u` and `v` are the LCA's two children, so return `up[0][u]`.

### M2. How does the Euler tour reduce LCA to RMQ?
DFS the tree, appending each node on entry and after returning from each child — an array of length `2N-1`. The LCA of `u` and `v` is the node with minimum depth in the tour between the first occurrences of `u` and `v`. So LCA becomes a Range Minimum Query on the depth array, answerable in `O(1)` with a sparse table.

### M3. Compare binary lifting and Euler+RMQ.
Both build in `O(N log N)`. Binary lifting queries in `O(log N)` but also supports k-th ancestor and path aggregates and is simpler to extend. Euler+RMQ queries in `O(1)`, ideal when query volume is huge, but does not give k-th ancestor for free. Pick lifting by default; pick Euler+RMQ when `Q >> N`.

### M4. How do you answer "is `a` an ancestor of `b`" in O(1)?
Record DFS entry/exit times `tin`/`tout`. Then `a` is an ancestor of `b` iff `tin[a] <= tin[b] && tout[b] <= tout[a]`. This needs only the Euler-time arrays, no lifting table.

### M5. How do you find the maximum edge weight on the path between two nodes?
Augment binary lifting: store `maxw[k][v]` = max edge weight on the `2^k` climb from `v`, with `maxw[k][v] = max(maxw[k-1][v], maxw[k-1][up[k-1][v]])`. During the LCA query, fold each jump's `maxw` into a running maximum. `O(log N)` per query. The same template works for min, sum, or gcd.

### M6. What is the Farach-Colton–Bender method, at a high level?
It reduces LCA to ±1 RMQ via the Euler tour, then decomposes the depth array into blocks of size `½ log m`. The top level uses a sparse table over block minima; the bottom level exploits that, because consecutive depths differ by exactly ±1, there are only `O(√m)` distinct block patterns to tabulate. The result is `O(N)` build and `O(1)` query — asymptotically optimal.

### M7. When is the naive method actually fine?
When you have few queries, or the tree is shallow/balanced (expected height `O(log N)`), or you are building a correctness oracle to test the fast methods. It is `O(N)` worst case per query but `O(log N)` expected on balanced random trees, and the code is trivial.

### M8. How do you handle a deep tree during preprocessing?
The preprocessing DFS can overflow the recursion stack on a path-shaped tree of `10^5+` nodes. Use an iterative DFS with an explicit stack, or raise the recursion limit. Production indexers should always be iterative.

### M9. What is a virtual (auxiliary) tree and why use LCA to build it?
Given `k` marked nodes, the virtual tree is the minimal tree containing them plus their pairwise LCAs, with chains contracted. You sort the marked nodes by Euler-entry time, insert LCAs of adjacent pairs, and connect with a stack. It shrinks per-query work from `O(N)` to `O(k log k)` — essential when many queries each touch few nodes.

### M10. How do you find the k-th node on the path from `u` to `v`?
Let `l = lca(u, v)` and `d = dist(u, v)`. If `k <= depth[u] - depth[l]`, the answer is the `k`-th ancestor of `u`. Otherwise it is the `(d - k)`-th ancestor of `v`. Both are `O(log N)` with binary lifting.

### M11. How do you support LCA when the tree can have edges added at the leaves?
For leaf-only insertions you can extend binary lifting incrementally: a new leaf's `up[0]` is its parent, and `up[k][leaf] = up[k-1][up[k-1][leaf]]` uses already-built ancestors. Depth is parent depth + 1. Each insertion is `O(log N)`. General dynamic trees need link-cut trees.

### M12 (analysis). Why does the sparse-table RMQ give O(1) for LCA but a segment tree gives O(log N)?
A sparse table precomputes the min over every power-of-two-length range. For an idempotent operator like min, any range `[i, j]` is covered by two overlapping power-of-two ranges, and overlap is harmless, so one comparison answers the query in `O(1)`. A segment tree must combine `O(log N)` disjoint canonical ranges, so it is `O(log N)`. The sparse table trades `O(N log N)` space and immutability for the faster query.

---

## Senior Questions (10 Q&A)

### S1. Compare all the LCA methods and when you would pick each.
Naive for few queries or as an oracle. Binary lifting as the flexible default (also k-th ancestor, path aggregates). Euler+RMQ for `O(1)` queries on a static tree with huge query volume. Farach-Colton–Bender for very large `N` where `O(N log N)` memory is too much. Tarjan offline when all queries are known up front and you only need plain LCA. HLD when you need *updatable* path aggregates. Link-cut trees when the tree mutates faster than you can rebuild.

### S2. How would you serve LCA queries over a large category tree in production?
Treat the index as an immutable, precomputed artifact. Build binary lifting (or Euler+RMQ) once, serve lock-free concurrent reads, and rebuild on tree change with an atomic pointer swap. For DB-backed hierarchies that must be queried in SQL, use materialized paths (LCA = longest common path prefix) or a closure table instead.

### S3. Why are LCA indexes great for concurrency?
They are immutable after build: a query only reads `up[][]`, `depth[]`, and the RMQ table. Read-only artifacts need no locks, share safely across threads and processes (even mmap), and scale linearly with cores. Updates use copy-on-rebuild plus an atomic pointer swap so readers never see a half-built index.

### S4. How do you keep an LCA index correct when the tree changes?
If changes are rare (category trees, taxonomies), rebuild the whole index in the background and publish atomically; track `index_age` to detect staleness. If changes are frequent (comment threads, live forests), use an order-maintenance Euler tour or link-cut trees for incremental `O(log N)` updates. Re-rooting forces a full rebuild.

### S5. What is the LCA ⟺ RMQ equivalence and why does it matter?
LCA reduces to ±1 RMQ via the Euler tour; RMQ reduces to LCA via the Cartesian tree. They are linearly equivalent, so any `O(f)/O(g)` solution for one transfers to the other. This is the theoretical backbone of Farach-Colton–Bender and lets you reuse RMQ machinery for tree problems.

### S6. How would you compute distances between many pairs efficiently?
Precompute `depth[]` and an LCA structure once. Each distance is `depth[u] + depth[v] - 2*depth[lca(u,v)]`, costing one LCA query. With Euler+RMQ that is `O(1)` per pair after `O(N log N)` build; with binary lifting it is `O(log N)` per pair.

### S7. How do you detect that input is not a valid tree before building?
A rooted tree on `N` nodes has exactly `N-1` edges, is connected, and is acyclic. Validate edge count, run a DFS/BFS to confirm connectivity and that no node gets two parents, and reject cycles. A non-tree input makes the DFS loop or produce inconsistent depths, yielding silently wrong LCAs.

### S8. How would you reduce the memory of a binary-lifting index?
Use `int32` indices when `N < 2^31` to halve `up[][]`. Drop to Euler+RMQ if you do not need k-th ancestor. For very large `N`, use Farach-Colton–Bender for `O(N)` space. If you only need ancestor tests, store just `tin`/`tout` (`2N` integers).

### S9. How do path queries combine LCA with heavy-light decomposition?
HLD splits any root-to-node path into `O(log N)` contiguous heavy chains, each mapped to a segment-tree range. To query the path `u`–`v`, you split at `lca(u, v)` and walk up both sides chain by chain, combining `O(log N)` segment-tree queries — giving updatable path aggregates that plain LCA cannot. (See the sibling topic `14-heavy-light-decomposition`.)

### S10 (analysis). What is the lower bound for the static LCA problem and does any method reach it?
You need `Ω(N)` space to encode the tree and `Ω(1)` time to answer. Farach-Colton–Bender achieves `O(N)` space and `O(1)` query, matching both, so it is asymptotically optimal for the static problem. The remaining research is on dynamic, succinct (`2N + o(N)` bits), parallel, and DAG variants.

---

## Professional Questions (8 Q&A)

### P1. Prove the binary-lifting query returns the LCA.
After equalizing depth, both nodes are at depth `depth(v) >= depth(LCA)`, so they share the same LCA. Maintain the invariant "both current nodes are strict descendants of the LCA at equal depth." Jumping `2^k` only when `up[k][u] != up[k][v]` keeps both below the LCA (equal `2^k`-ancestors would mean a common ancestor at that height, i.e. `>= LCA`). After the high-to-low loop no jump is possible, so both are the LCA's children, and `up[0][u]` is the LCA.

### P2. Why is the `up[k][v] = up[k-1][up[k-1][v]]` recurrence valid past the root?
Iterated parents compose: `par^{a+b} = par^a ∘ par^b`. Setting `par(root) = root` makes `par^m(root) = root` for all `m`, so over-jumps stay at the root rather than reading an out-of-bounds or wrong value. The recurrence therefore holds for every node including those whose `2^{k-1}`-ancestor is already the root.

### P3. Derive the O(√m) block-pattern bound in Farach-Colton–Bender.
The Euler-tour depth array has the ±1 property: consecutive entries differ by exactly 1. A block of size `b = ½ log₂ m` is determined, up to an additive constant, by its `b-1` ±1 steps, i.e. `b-1` sign bits. So there are at most `2^{b-1} = 2^{(½ log m) - 1} = O(√m)` distinct block shapes. Tabulating in-block RMQ for all shapes and sub-ranges costs `O(√m · b²) = o(m)`, which is why the bottom level is "free."

### P4. Why does a sparse table answer min-RMQ in O(1) but not sum-RMQ?
The `O(1)` overlap trick relies on **idempotence**: `min(min(a,b), min(b,c)) = min(a,b,c)` even though `b` is counted twice. Sum is not idempotent — double-counting the overlap corrupts the answer — so sum-RMQ needs disjoint ranges (`O(log N)` via prefix sums or a segment tree). LCA uses min, so it inherits the `O(1)` query.

### P5. How does the Cartesian-tree reduction turn RMQ into LCA?
Build the Cartesian tree of the array (root = global minimum, recurse on left/right halves). Each node's subtree spans a contiguous index range whose minimum is that node's value. The RMQ of `[i, j]` is the value at `LCA(i, j)` in the Cartesian tree, because that LCA is the shallowest node whose range contains both indices, i.e. the minimum of the range. The tree builds in `O(N)` with a monotonic stack.

### P6. What changes for LCA on a DAG, and why is it harder?
On a DAG a pair can have several incomparable "lowest" common ancestors, so the answer is a *set*, not a single node. All-pairs LCA on a DAG reduces to Boolean matrix multiplication, giving `O(N^ω)` algorithms (`ω ≈ 2.37`), and improving this is open. The tree case is special because ancestor sets are chains, guaranteeing a unique answer.

### P7. How would you make LCA fully dynamic under edge insert/delete?
Use link-cut trees (Sleator–Tarjan): represent the forest with preferred-path decomposition and splay trees, supporting `link`, `cut`, `findRoot`, and LCA-style queries in `O(log N)` amortized. Euler-tour trees are an alternative for connectivity with augmentation. Both trade the static `O(1)` query for `O(log N)` amortized to gain mutability.

### P8 (analysis). Why is binary lifting often faster than FCB in practice despite worse asymptotics?
FCB is `O(N)`/`O(1)` but has a large constant and pointer-chasing into several small tables, plus complex code. Binary lifting is `O(N log N)`/`O(log N)` but its query is a tight loop of array reads, and for `N` up to ~`10^5` the whole table fits in L2/L3 cache, so the `log N` factor is cheap. The crossover where FCB's asymptotics win is at fairly large `N`; below it, the simpler structure with the smaller constant wins wall-clock.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose a precomputed index over recomputing on the fly.
Look for: the access pattern (many reads of a static structure), the alternative (recompute per query), the criteria (latency, memory, freshness), and the decision (build once, serve immutable, rebuild on change). Strong answers cite the memory budget (`N log N`), the read/write ratio, and how staleness was monitored.

### B2. Design a service that answers "common parent category" for an e-commerce catalog.
Binary-lifting (or Euler+RMQ) index over the category tree, rebuilt on catalog edits and published atomically; lock-free reads; `index_age` alerting for staleness. Discuss the DB-backed alternative (materialized `ltree` paths, LCA = longest common prefix) and when to prefer it for SQL queryability and cheap inserts.

### B3. Design distance queries between users in a hierarchical org graph.
Precompute depths and an LCA index; `dist = depth[u] + depth[v] - 2*depth[lca]`. Discuss rebuild on reorgs, sharding huge orgs into a replicated top tree plus per-subtree shards, and batching remote queries to amortize network cost.

### B4. A junior asks: "Why not just store every node's full ancestor list?"
That is `O(N·depth)` memory (up to `O(N²)` on a path) and `O(depth)` per LCA via list intersection. Materialized paths are a refined version of this idea and are fine for shallow DB hierarchies, but for deep or large trees binary lifting (`O(N log N)`, `O(log N)`) or FCB (`O(N)`, `O(1)`) dominate. Use it as a teaching moment about matching the structure to depth and query volume.

### B5. Your LCA service started returning wrong answers after a data import. How do you investigate?
Check `index_age` and the source-vs-artifact version first — a skipped rebuild yields stale answers. Validate the imported tree (edge count `N-1`, connected, acyclic, single parent per node); a cycle or extra parent corrupts depths. Verify the root did not change. Re-run the index build against a naive oracle on sampled pairs. Add the validation as a pre-publish gate.

---

## Coding Challenges

### Challenge 1: LCA of a Binary Tree (LeetCode 236)

**Problem.** Given the root of a binary tree and two nodes `p` and `q` (both guaranteed present), return their lowest common ancestor. Nodes do not carry parent pointers.

**Example.**
```text
        3
       / \
      5   1
     /|   |\
    6 2   0 8
     / \
    7   4
LCA(5, 1) = 3
LCA(5, 4) = 5   (5 is an ancestor of 4)
```

**Constraints.** `2 <= nodes <= 10^5`, all values unique, `p != q`.

**Approach.** Single post-order recursion. If the node is null or matches `p`/`q`, return it. Recurse both sides; if both return non-null, the current node is the LCA; otherwise bubble up the non-null side. `O(N)` time, `O(H)` stack.

**Go.**
```go
package main

import "fmt"

type TreeNode struct {
	Val         int
	Left, Right *TreeNode
}

func lowestCommonAncestor(root, p, q *TreeNode) *TreeNode {
	if root == nil || root == p || root == q {
		return root
	}
	left := lowestCommonAncestor(root.Left, p, q)
	right := lowestCommonAncestor(root.Right, p, q)
	if left != nil && right != nil {
		return root
	}
	if left != nil {
		return left
	}
	return right
}

func main() {
	n7 := &TreeNode{Val: 7}
	n4 := &TreeNode{Val: 4}
	n2 := &TreeNode{Val: 2, Left: n7, Right: n4}
	n6 := &TreeNode{Val: 6}
	n5 := &TreeNode{Val: 5, Left: n6, Right: n2}
	n0 := &TreeNode{Val: 0}
	n8 := &TreeNode{Val: 8}
	n1 := &TreeNode{Val: 1, Left: n0, Right: n8}
	root := &TreeNode{Val: 3, Left: n5, Right: n1}
	fmt.Println(lowestCommonAncestor(root, n5, n1).Val) // 3
	fmt.Println(lowestCommonAncestor(root, n5, n4).Val) // 5
}
```

**Java.**
```java
public class LCABinaryTree {
    static class TreeNode {
        int val;
        TreeNode left, right;
        TreeNode(int v) { val = v; }
    }

    public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
        if (root == null || root == p || root == q) return root;
        TreeNode left = lowestCommonAncestor(root.left, p, q);
        TreeNode right = lowestCommonAncestor(root.right, p, q);
        if (left != null && right != null) return root;
        return left != null ? left : right;
    }

    public static void main(String[] args) {
        TreeNode n7 = new TreeNode(7), n4 = new TreeNode(4);
        TreeNode n2 = new TreeNode(2); n2.left = n7; n2.right = n4;
        TreeNode n6 = new TreeNode(6);
        TreeNode n5 = new TreeNode(5); n5.left = n6; n5.right = n2;
        TreeNode n0 = new TreeNode(0), n8 = new TreeNode(8);
        TreeNode n1 = new TreeNode(1); n1.left = n0; n1.right = n8;
        TreeNode root = new TreeNode(3); root.left = n5; root.right = n1;
        LCABinaryTree s = new LCABinaryTree();
        System.out.println(s.lowestCommonAncestor(root, n5, n1).val); // 3
        System.out.println(s.lowestCommonAncestor(root, n5, n4).val); // 5
    }
}
```

**Python.**
```python
from typing import Optional


class TreeNode:
    def __init__(self, val: int):
        self.val = val
        self.left: Optional["TreeNode"] = None
        self.right: Optional["TreeNode"] = None


def lowest_common_ancestor(root, p, q):
    if root is None or root is p or root is q:
        return root
    left = lowest_common_ancestor(root.left, p, q)
    right = lowest_common_ancestor(root.right, p, q)
    if left and right:
        return root
    return left if left else right


if __name__ == "__main__":
    n7, n4 = TreeNode(7), TreeNode(4)
    n2 = TreeNode(2); n2.left, n2.right = n7, n4
    n6 = TreeNode(6)
    n5 = TreeNode(5); n5.left, n5.right = n6, n2
    n0, n8 = TreeNode(0), TreeNode(8)
    n1 = TreeNode(1); n1.left, n1.right = n0, n8
    root = TreeNode(3); root.left, root.right = n5, n1
    print(lowest_common_ancestor(root, n5, n1).val)  # 3
    print(lowest_common_ancestor(root, n5, n4).val)  # 5
```

**Follow-up.** What if there are many queries on the same tree? Convert to parent/depth arrays and build binary lifting once, then answer each in `O(log N)`.

---

### Challenge 2: LCA of a Binary Search Tree (LeetCode 235)

**Problem.** Given a BST and two nodes `p`, `q`, return their LCA. Exploit the BST ordering.

**Constraints.** All values unique; `p`, `q` present.

**Approach.** Walk from the root. If both `p` and `q` are smaller, go left; if both larger, go right; otherwise the split point (current node) is the LCA. `O(H)` time, `O(1)` extra space.

**Go.**
```go
package main

import "fmt"

type TreeNode struct {
	Val         int
	Left, Right *TreeNode
}

func lcaBST(root *TreeNode, p, q int) int {
	for root != nil {
		if p < root.Val && q < root.Val {
			root = root.Left
		} else if p > root.Val && q > root.Val {
			root = root.Right
		} else {
			return root.Val
		}
	}
	return -1
}

func main() {
	root := &TreeNode{Val: 6,
		Left:  &TreeNode{Val: 2, Left: &TreeNode{Val: 0}, Right: &TreeNode{Val: 4}},
		Right: &TreeNode{Val: 8}}
	fmt.Println(lcaBST(root, 2, 8)) // 6
	fmt.Println(lcaBST(root, 0, 4)) // 2
}
```

**Java.**
```java
public class LCABinarySearchTree {
    static class TreeNode {
        int val;
        TreeNode left, right;
        TreeNode(int v) { val = v; }
    }

    public int lca(TreeNode root, int p, int q) {
        while (root != null) {
            if (p < root.val && q < root.val) root = root.left;
            else if (p > root.val && q > root.val) root = root.right;
            else return root.val;
        }
        return -1;
    }

    public static void main(String[] args) {
        TreeNode root = new TreeNode(6);
        root.left = new TreeNode(2);
        root.left.left = new TreeNode(0);
        root.left.right = new TreeNode(4);
        root.right = new TreeNode(8);
        LCABinarySearchTree s = new LCABinarySearchTree();
        System.out.println(s.lca(root, 2, 8)); // 6
        System.out.println(s.lca(root, 0, 4)); // 2
    }
}
```

**Python.**
```python
from typing import Optional


class TreeNode:
    def __init__(self, val: int):
        self.val = val
        self.left: Optional["TreeNode"] = None
        self.right: Optional["TreeNode"] = None


def lca_bst(root, p: int, q: int) -> int:
    while root:
        if p < root.val and q < root.val:
            root = root.left
        elif p > root.val and q > root.val:
            root = root.right
        else:
            return root.val
    return -1


if __name__ == "__main__":
    root = TreeNode(6)
    root.left = TreeNode(2)
    root.left.left = TreeNode(0)
    root.left.right = TreeNode(4)
    root.right = TreeNode(8)
    print(lca_bst(root, 2, 8))  # 6
    print(lca_bst(root, 0, 4))  # 2
```

**Follow-up.** Why is this simpler than the general binary-tree case? The BST ordering tells you which subtree both targets live in without searching, so you never branch into both children.

---

### Challenge 3: Kth Ancestor of a Tree Node (LeetCode 1483)

**Problem.** Design `TreeAncestor(n, parent)` supporting `getKthAncestor(node, k)`: the `k`-th ancestor of `node`, or `-1` if it does not exist. `parent[0] = -1` (the root).

**Constraints.** `1 <= n <= 5·10^4`, up to `5·10^4` queries; each query must be sublinear.

**Approach.** Binary lifting. Build `up[k][v]` in `O(N log N)`; answer each query by jumping over the set bits of `k` in `O(log N)`. Use `-1` as the sentinel above the root and propagate it.

**Go.**
```go
package main

import "fmt"

type TreeAncestor struct {
	up  [][]int
	log int
}

func Constructor(n int, parent []int) TreeAncestor {
	log := 1
	for (1 << log) < n {
		log++
	}
	up := make([][]int, log)
	for k := range up {
		up[k] = make([]int, n)
	}
	copy(up[0], parent) // up[0][0] == -1 for the root
	for k := 1; k < log; k++ {
		for v := 0; v < n; v++ {
			if up[k-1][v] == -1 {
				up[k][v] = -1
			} else {
				up[k][v] = up[k-1][up[k-1][v]]
			}
		}
	}
	return TreeAncestor{up: up, log: log}
}

func (t *TreeAncestor) GetKthAncestor(node, k int) int {
	for i := 0; i < t.log && node != -1; i++ {
		if (k>>i)&1 == 1 {
			node = t.up[i][node]
		}
	}
	return node
}

func main() {
	t := Constructor(7, []int{-1, 0, 0, 1, 1, 2, 4})
	fmt.Println(t.GetKthAncestor(6, 2)) // 1
	fmt.Println(t.GetKthAncestor(6, 5)) // -1
	fmt.Println(t.GetKthAncestor(3, 1)) // 1
}
```

**Java.**
```java
public class TreeAncestor {
    private final int[][] up;
    private final int log;

    public TreeAncestor(int n, int[] parent) {
        int lg = 1;
        while ((1 << lg) < n) lg++;
        this.log = lg;
        this.up = new int[log][n];
        System.arraycopy(parent, 0, up[0], 0, n); // up[0][0] == -1
        for (int k = 1; k < log; k++) {
            for (int v = 0; v < n; v++) {
                up[k][v] = up[k - 1][v] == -1 ? -1 : up[k - 1][up[k - 1][v]];
            }
        }
    }

    public int getKthAncestor(int node, int k) {
        for (int i = 0; i < log && node != -1; i++) {
            if (((k >> i) & 1) == 1) node = up[i][node];
        }
        return node;
    }

    public static void main(String[] args) {
        TreeAncestor t = new TreeAncestor(7, new int[]{-1, 0, 0, 1, 1, 2, 4});
        System.out.println(t.getKthAncestor(6, 2)); // 1
        System.out.println(t.getKthAncestor(6, 5)); // -1
        System.out.println(t.getKthAncestor(3, 1)); // 1
    }
}
```

**Python.**
```python
from typing import List


class TreeAncestor:
    def __init__(self, n: int, parent: List[int]):
        self.log = max(1, (n - 1).bit_length())
        self.up = [[0] * n for _ in range(self.log)]
        self.up[0] = parent[:]  # up[0][0] == -1
        for k in range(1, self.log):
            prev = self.up[k - 1]
            cur = self.up[k]
            for v in range(n):
                cur[v] = -1 if prev[v] == -1 else prev[prev[v]]

    def getKthAncestor(self, node: int, k: int) -> int:
        i = 0
        while k and node != -1:
            if k & 1:
                node = self.up[i][node]
            k >>= 1
            i += 1
        return node


if __name__ == "__main__":
    t = TreeAncestor(7, [-1, 0, 0, 1, 1, 2, 4])
    print(t.getKthAncestor(6, 2))  # 1
    print(t.getKthAncestor(6, 5))  # -1
    print(t.getKthAncestor(3, 1))  # 1
```

**Follow-up.** Extend this to LCA: also store `depth[]` and add the lift-then-climb query.

---

### Challenge 4: LCA of Deepest Leaves (LeetCode 1123)

**Problem.** Given a binary tree, return the LCA of all its deepest leaves.

**Constraints.** `1 <= nodes <= 1000`.

**Approach.** Post-order returning `(depth, lca)` for each subtree. If the left and right subtrees have equal max depth, the current node is the LCA of the deepest leaves of this subtree. Otherwise propagate the deeper side's `(depth+1, lca)`. `O(N)`.

**Go.**
```go
package main

import "fmt"

type TreeNode struct {
	Val         int
	Left, Right *TreeNode
}

func lcaDeepestLeaves(root *TreeNode) *TreeNode {
	var dfs func(*TreeNode) (int, *TreeNode)
	dfs = func(node *TreeNode) (int, *TreeNode) {
		if node == nil {
			return 0, nil
		}
		ld, ln := dfs(node.Left)
		rd, rn := dfs(node.Right)
		if ld == rd {
			return ld + 1, node
		}
		if ld > rd {
			return ld + 1, ln
		}
		return rd + 1, rn
	}
	_, ans := dfs(root)
	return ans
}

func main() {
	root := &TreeNode{Val: 3,
		Left:  &TreeNode{Val: 5, Left: &TreeNode{Val: 6}, Right: &TreeNode{Val: 2}},
		Right: &TreeNode{Val: 1}}
	fmt.Println(lcaDeepestLeaves(root).Val) // 5
}
```

**Java.**
```java
public class LCADeepestLeaves {
    static class TreeNode {
        int val;
        TreeNode left, right;
        TreeNode(int v) { val = v; }
    }

    static class Result {
        int depth;
        TreeNode node;
        Result(int d, TreeNode n) { depth = d; node = n; }
    }

    public TreeNode lcaDeepestLeaves(TreeNode root) {
        return dfs(root).node;
    }

    private Result dfs(TreeNode node) {
        if (node == null) return new Result(0, null);
        Result l = dfs(node.left), r = dfs(node.right);
        if (l.depth == r.depth) return new Result(l.depth + 1, node);
        return l.depth > r.depth ? new Result(l.depth + 1, l.node)
                                 : new Result(r.depth + 1, r.node);
    }

    public static void main(String[] args) {
        TreeNode root = new TreeNode(3);
        root.left = new TreeNode(5);
        root.left.left = new TreeNode(6);
        root.left.right = new TreeNode(2);
        root.right = new TreeNode(1);
        System.out.println(new LCADeepestLeaves().lcaDeepestLeaves(root).val); // 5
    }
}
```

**Python.**
```python
from typing import Optional, Tuple


class TreeNode:
    def __init__(self, val: int):
        self.val = val
        self.left: Optional["TreeNode"] = None
        self.right: Optional["TreeNode"] = None


def lca_deepest_leaves(root):
    def dfs(node) -> Tuple[int, Optional[TreeNode]]:
        if node is None:
            return 0, None
        ld, ln = dfs(node.left)
        rd, rn = dfs(node.right)
        if ld == rd:
            return ld + 1, node
        return (ld + 1, ln) if ld > rd else (rd + 1, rn)

    return dfs(root)[1]


if __name__ == "__main__":
    root = TreeNode(3)
    root.left = TreeNode(5)
    root.left.left = TreeNode(6)
    root.left.right = TreeNode(2)
    root.right = TreeNode(1)
    print(lca_deepest_leaves(root).val)  # 5
```

**Follow-up.** Note this never explicitly computes pairwise LCAs — it folds depth and LCA together in one pass, a common interview elegance.

---

## Common Pitfalls in Interviews

- **Forgetting the root sentinel.** Leaving `up[0][root] = 0` when node 0 is real corrupts over-jumps. Use the node itself or `-1` and propagate it.
- **Not equalizing depth first.** The climb loop assumes both nodes are at equal depth; lift the deeper one before the loop.
- **Jumping when ancestors are equal.** You must jump only when `up[k][u] != up[k][v]`; jumping on equality overshoots the LCA.
- **Returning `u` instead of `up[0][u]`.** The climb stops one below the LCA.
- **Sizing `LOG` too small.** `2^LOG` must exceed the max depth; off-by-one here is a silent out-of-bounds.
- **Recursive DFS on a deep tree.** Stack overflow on path-shaped inputs; go iterative.
- **Mixing 0- and 1-indexing.** Align node ids, edge lists, and array sizes; the most common silent bug.
- **Using a segment tree where a sparse table suffices.** For static min-RMQ the sparse table gives `O(1)` queries; reaching for a segment tree is `O(log N)` for no benefit.
- **Confusing online and offline.** If the interviewer says "all queries up front," Tarjan offline may be simpler — but do not use it when queries arrive interleaved.

---

## What Interviewers Are Really Testing

An LCA question is a compact way to probe several skills at once. First, **can you recognize the tree structure** behind a disguised problem — distances, ancestor relationships, path queries, and "common parent" all reduce to LCA. Second, **can you scale a solution**: the same problem moves from a single recursive `O(N)` walk (one query) to binary lifting (many queries) to Euler+RMQ (huge query volume) to Farach-Colton–Bender (`O(N)`/`O(1)`), and a strong candidate names the right point on that curve for the stated constraints. Third, **do you handle the corners**: the root sentinel, equal-depth nodes, `u == v`, deep-tree recursion, `LOG` sizing, and indexing. Fourth, **can you reason about the deeper theory** — the LCA ⟺ RMQ equivalence, why the sparse table is `O(1)` for min but not sum, and why the `O(1)`/`O(N)` bound is optimal. You do not need every method coded perfectly on the spot, but you should know they exist, name the right tool for the constraints, and explain the trade-offs. The best answers also reach into production: how the index is immutable and lock-free for reads, how it stays fresh when the tree changes, and how you would monitor staleness. That breadth — pattern recognition, scaling, corner cases, theory, and operations — is exactly what an LCA question lets you demonstrate in one conversation.
