# Tree DP (Dynamic Programming on Trees) — Interview Preparation

Tree DP is a staple of mid-to-senior interviews because it rewards a single crisp insight — *"root the tree, post-order DFS, define a small state per node summarizing its subtree, fold children into the parent"* — and then probes whether you can (a) design the **right state** (include/exclude, longest chain, count+sum), (b) keep clear which value you **return up** vs **record globally**, (c) extend to **rerooting** when every node needs an answer, and (d) handle **deep trees** without a stack overflow. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Problem | dp state per node | Combine | Answer | Complexity |
|---------|-------------------|---------|--------|------------|
| Max independent set / House Robber III | `(excl, incl)` | `excl += max(c)`, `incl += c.excl` | `max(excl, incl)` at root | `O(n)` |
| Tree diameter (edges/weight) | `down[v]` longest chain | track two largest `down[c]+w` | global `max(b1+b2)` | `O(n)` |
| Subtree size / sum | `cnt[v]` / `sum[v]` | add children | per node | `O(n)` |
| Sum of distances (all nodes) | `cnt`, `down`, reroot | DFS1 build, DFS2 transfer | per node | `O(n)` |
| Count independent sets | `(g0, g1)` | multiply children | `g0+g1` mod p | `O(n)` |
| Tree knapsack (budget `W`) | `dp[v][0..W]` | `(max,+)` convolution | `max dp[root]` | `O(n·W)` |

Core template:

```text
dfs(v, parent):
    state = base(v)
    for c in adj[v]:
        if c == parent: continue        # don't walk back up
        state = combine(state, dfs(c, v))  # children before parent (post-order)
    # optional: best = max(best, value_at(v))   # answer can be anywhere
    return state                          # what the PARENT needs
# O(n); recursion depth O(h) — go iterative for deep trees
```

Key facts:
- A tree on `n` nodes has `n-1` edges, no cycles, unique path between any two nodes.
- **Return up** the value the parent needs (often *one* chain); **record globally** the answer (often *two* chains). They differ.
- Rerooting = post-order pass (`down`) + pre-order pass (`up`/`ans`), `O(1)` transfer per edge ⇒ `O(n)` for all roots.
- Deep/path trees overflow the stack ⇒ raise the limit or use iterative DFS.

---

## Junior Questions (12 Q&A)

### J1. What is tree DP in one sentence?
Root the tree, run a post-order DFS so children are computed before parents, and at each node combine the children's results into a small **dp state that summarizes that node's subtree**.

### J2. Why post-order?
Because a node's answer depends on its children's answers. Post-order visits a node only after all its children, so by the time you compute `dp[v]` every `dp[child]` is ready.

### J3. Why is one pass `O(n)`?
A tree has no cycles, so each subtree (each node) is solved exactly once and each of the `n-1` edges is traversed once. Total work is linear.

### J4. What is the `c != parent` check for?
The adjacency list stores undirected edges. Without skipping the parent you would recurse back up the edge you came from — infinite recursion or double counting.

### J5. In House Robber III / tree MIS, why keep two values per node?
`incl` (best if you take `v`) and `excl` (best if you skip `v`). The parent needs both: if it takes itself, children must use `excl`; if it skips itself, children pick `max(incl, excl)`.

### J6. What is the recurrence for tree MIS?
`incl[v] = w[v] + Σ excl[c]` and `excl[v] = Σ max(incl[c], excl[c])`. Answer `max(incl[root], excl[root])`.

### J7. What does a leaf's dp look like in MIS?
`incl = w[leaf]`, `excl = 0` — which the formulas give automatically since the child sum is empty.

### J8. What is the diameter of a tree?
The longest path (most edges, or max weight) between any two nodes. Computable in one DFS.

### J9. In the diameter DFS, what do you return vs record?
**Return** `down[v]`, the single longest downward chain. **Record globally** `b1 + b2`, the sum of the two longest child chains — that path bends through `v`.

### J10. What is `down[v]`?
The length of the longest downward chain from `v` to a leaf in its subtree; `0` for a leaf (in edges).

### J11. Can tree DP solve a graph with a cycle?
No — it relies on the unique-path/acyclic structure so subtrees are disjoint. Cycles break that.

### J12. What is a common beginner bug?
Forgetting the parent guard (infinite recursion), or returning the two-chain sum up in the diameter (breaks path simplicity).

---

## Middle Questions (10 Q&A)

### M1. What is the rerooting technique?
A way to compute the answer for **every** node as root in `O(n)`. DFS1 (post-order) computes subtree info `down[v]`; DFS2 (pre-order) pushes "outside the subtree" info `up[v]` from parent to child in `O(1)` per edge.

### M2. Why is naive "answer for every root" `O(n²)`?
Re-running the `O(n)` root DFS for each of the `n` nodes. Rerooting reuses the parent's answer instead of recomputing.

### M3. Give the reroot transfer for sum of distances.
`S[c] = S[v] - cnt[c] + (n - cnt[c])`: moving the root across edge `(v,c)`, the `cnt[c]` subtree nodes get one closer, the other `n - cnt[c]` get one farther.

### M4. What is in-and-out DP?
`answer[v] = combine(down[v], up[v])`, where `down` is the subtree ("in") and `up` is everything outside it ("out"). The two partition the tree.

### M5. Why can't you "subtract a child" from a `max` combine during rerooting?
`max` is not invertible. To get "all children except `c`", use **prefix/suffix** maxima. Subtraction only works for invertible combines like sum.

### M6. What is tree knapsack and its complexity?
Select a budget-bounded subset under a subtree constraint, maximizing value. `dp[v][j]` merged child-by-child as a `(max,+)` convolution. Runs in **`O(n·W)`** when inner loops are capped by `min(subtreeSize, W)`.

### M7. Why is tree knapsack `O(n·W)` and not `O(n·W²)`?
Capping loops by subtree size makes the total merge cost `Σ s_a·s_b`, which counts each pair of nodes once at their LCA = `O(n²)`, and with the `W` cap collapses to `O(n·W)`.

### M8. How do you avoid stack overflow on a deep tree?
Iterative DFS: build a pre-order with an explicit stack and record parents, then evaluate the dp in reverse pre-order (a valid post-order). No recursion.

### M9. How does the two-BFS diameter method compare to the DP method?
Two-BFS (farthest from any node, then farthest from that) is `O(n)` and elegant but **only valid for non-negative edge weights**. The DP method handles negative weights and gives per-node info.

### M10. When do you need 64-bit or modulus?
64-bit for weighted sums/distances on large trees (overflow). Modulus (`10^9+7`) for counting problems where the count grows exponentially — reduce after every operation.

---

## Senior Questions (8 Q&A)

### S1. What is the dominant production failure mode of tree DP?
Recursion depth on a **degenerate (path) tree**: height `n`, so the recursion nests `n` deep and overflows the stack. Default to iterative DFS for unbalanced input.

### S2. How do you make the recurrence stack-safe?
Compute a pre-order via explicit stack with `parent[]`, then iterate it in reverse for the post-order combine; iterate forward for the rerooting pass. No call-stack dependency.

### S3. How do you keep tree knapsack memory bounded?
Free each child's `dp` table after merging it into the parent. Peak memory drops from `O(n·W)` to roughly `O(W·h)`.

### S4. How do you verify a tree DP when `n` is too big to brute-force?
Brute-force oracle for `n ≤ 18` (subset/pair enumeration), property tests on random trees (subtree sizes sum correctly, diameter ≤ n-1), and adversarial shapes (path, star, balanced, singleton).

### S5. Why prefer CSR adjacency at large `n`?
Flat `head/to/nxt` arrays avoid boxing and scatter; on `10^7`-node trees this is often a 2× speedup and lower GC pressure versus lists of objects.

### S6. Can rerooting handle non-invertible combines?
Yes, with prefix/suffix accumulation over each node's children to compute "all children except `c`" in `O(1)`, total `O(n)`.

### S7. What invariant validates a rerooting implementation?
`ans[root]` from the pre-order pass must equal the directly computed `down[root]`; spot-check one leaf with a brute-force distance sum.

### S8. When does tree DP NOT apply?
Cyclic graphs (subtrees not disjoint), state that depends on far-away nodes non-summarizably, or when the per-node state would be exponential.

---

## Behavioral Prompts

- *"Describe a time you optimized an `O(n²)` solution."* Tell the rerooting story: you were recomputing a per-node aggregate from scratch for each node; you recognized adjacent answers differ by a constant-time edge transfer and reduced it to two `O(n)` passes.
- *"How do you handle a hard-to-reproduce production crash?"* The deep-tree stack overflow: it only fires on degenerate input distributions; you reproduced it with a synthetic path tree, then converted the recursion to an iterative explicit-stack DFS.
- *"How do you ensure correctness of a tricky algorithm?"* Brute-force oracle on small `n`, property-based tests on random trees, and adversarial shapes — evidence before claiming done.
- *"Explain a complex idea simply."* Use the org-chart analogy for tree dp: managers wait for all reports' summaries, then write their own.

---

## Coding Challenges

> Each challenge ships with runnable Go, Java, and Python.

### Challenge 1 — Tree MIS / House Robber III

**Problem.** Each node has a non-negative value. Choose a set of nodes with no two adjacent (no parent–child both chosen), maximizing total value. Return the maximum.

**Approach.** Post-order DFS returning `(excl, incl)`; answer `max` at root. `O(n)`.

#### Go
```go
package main

import "fmt"

var (
	adj [][]int
	val []int64
)

func dfs(v, p int) (int64, int64) {
	excl, incl := int64(0), val[v]
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		ce, ci := dfs(c, v)
		if ce > ci {
			excl += ce
		} else {
			excl += ci
		}
		incl += ce
	}
	return excl, incl
}

func main() {
	val = []int64{3, 2, 1, 1, 3, 1}
	adj = make([][]int, len(val))
	for _, e := range [][2]int{{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}} {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	e, i := dfs(0, -1)
	if e > i {
		fmt.Println(e)
	} else {
		fmt.Println(i)
	}
}
```

#### Java
```java
import java.util.*;

public class HouseRobberIII {
    static List<Integer>[] adj;
    static long[] val;

    static long[] dfs(int v, int p) {
        long excl = 0, incl = val[v];
        for (int c : adj[v]) {
            if (c == p) continue;
            long[] ch = dfs(c, v);
            excl += Math.max(ch[0], ch[1]);
            incl += ch[0];
        }
        return new long[]{excl, incl};
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        val = new long[]{3, 2, 1, 1, 3, 1};
        adj = new List[val.length];
        for (int i = 0; i < val.length; i++) adj[i] = new ArrayList<>();
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}};
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
        long[] r = dfs(0, -1);
        System.out.println(Math.max(r[0], r[1]));
    }
}
```

#### Python
```python
import sys
sys.setrecursionlimit(1 << 25)


def house_robber_iii(val, edges):
    adj = [[] for _ in val]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)

    def dfs(v, p):
        excl, incl = 0, val[v]
        for c in adj[v]:
            if c == p:
                continue
            ce, ci = dfs(c, v)
            excl += max(ce, ci)
            incl += ce
        return excl, incl

    return max(dfs(0, -1))


if __name__ == "__main__":
    print(house_robber_iii([3, 2, 1, 1, 3, 1],
                           [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5)]))  # 8
```

---

### Challenge 2 — Tree Diameter

**Problem.** Given a tree, return the number of edges on its longest path (the diameter).

**Approach.** One DFS; `down[v]` = longest downward chain; global `best = max(b1 + b2)`. `O(n)`.

#### Go
```go
package main

import "fmt"

var (
	g    [][]int
	best int
)

func down(v, p int) int {
	b1, b2 := 0, 0
	for _, c := range g[v] {
		if c == p {
			continue
		}
		d := down(c, v) + 1
		if d > b1 {
			b1, b2 = d, b1
		} else if d > b2 {
			b2 = d
		}
	}
	if b1+b2 > best {
		best = b1 + b2
	}
	return b1
}

func main() {
	g = make([][]int, 6)
	for _, e := range [][2]int{{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}} {
		g[e[0]] = append(g[e[0]], e[1])
		g[e[1]] = append(g[e[1]], e[0])
	}
	down(0, -1)
	fmt.Println(best) // 4  (3-1-0-2-5)
}
```

#### Java
```java
import java.util.*;

public class TreeDiameter {
    static List<Integer>[] g;
    static int best = 0;

    static int down(int v, int p) {
        int b1 = 0, b2 = 0;
        for (int c : g[v]) {
            if (c == p) continue;
            int d = down(c, v) + 1;
            if (d > b1) { b2 = b1; b1 = d; }
            else if (d > b2) b2 = d;
        }
        best = Math.max(best, b1 + b2);
        return b1;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        g = new List[6];
        for (int i = 0; i < 6; i++) g[i] = new ArrayList<>();
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}};
        for (int[] e : edges) { g[e[0]].add(e[1]); g[e[1]].add(e[0]); }
        down(0, -1);
        System.out.println(best); // 4
    }
}
```

#### Python
```python
import sys
sys.setrecursionlimit(1 << 25)


def tree_diameter(n, edges):
    g = [[] for _ in range(n)]
    for a, b in edges:
        g[a].append(b)
        g[b].append(a)
    best = 0

    def down(v, p):
        nonlocal best
        b1 = b2 = 0
        for c in g[v]:
            if c == p:
                continue
            d = down(c, v) + 1
            if d > b1:
                b1, b2 = d, b1
            elif d > b2:
                b2 = d
        best = max(best, b1 + b2)
        return b1

    down(0, -1)
    return best


if __name__ == "__main__":
    print(tree_diameter(6, [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5)]))  # 4
```

---

### Challenge 3 — Sum of Distances in Tree (rerooting)

**Problem.** Return an array `ans` where `ans[v]` is the sum of distances from `v` to every other node. (LeetCode 834.)

**Approach.** DFS1: `cnt[v]`, `down[v]`. DFS2 reroot: `ans[c] = ans[v] - cnt[c] + (n - cnt[c])`. `O(n)`.

#### Go
```go
package main

import "fmt"

var (
	adj  [][]int
	cnt  []int
	down []int64
	ans  []int64
	N    int
)

func dfs1(v, p int) {
	cnt[v] = 1
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		dfs1(c, v)
		cnt[v] += cnt[c]
		down[v] += down[c] + int64(cnt[c])
	}
}

func dfs2(v, p int) {
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		ans[c] = ans[v] - int64(cnt[c]) + int64(N-cnt[c])
		dfs2(c, v)
	}
}

func main() {
	N = 6
	adj = make([][]int, N)
	cnt = make([]int, N)
	down = make([]int64, N)
	ans = make([]int64, N)
	for _, e := range [][2]int{{0, 1}, {0, 2}, {2, 3}, {2, 4}, {2, 5}} {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	dfs1(0, -1)
	ans[0] = down[0]
	dfs2(0, -1)
	fmt.Println(ans)
}
```

#### Java
```java
import java.util.*;

public class SumOfDistances {
    static List<Integer>[] adj;
    static int[] cnt;
    static long[] down, ans;
    static int n;

    static void dfs1(int v, int p) {
        cnt[v] = 1;
        for (int c : adj[v]) {
            if (c == p) continue;
            dfs1(c, v);
            cnt[v] += cnt[c];
            down[v] += down[c] + cnt[c];
        }
    }

    static void dfs2(int v, int p) {
        for (int c : adj[v]) {
            if (c == p) continue;
            ans[c] = ans[v] - cnt[c] + (n - cnt[c]);
            dfs2(c, v);
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        n = 6;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        cnt = new int[n]; down = new long[n]; ans = new long[n];
        int[][] edges = {{0, 1}, {0, 2}, {2, 3}, {2, 4}, {2, 5}};
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
        dfs1(0, -1);
        ans[0] = down[0];
        dfs2(0, -1);
        System.out.println(Arrays.toString(ans));
    }
}
```

#### Python
```python
import sys
sys.setrecursionlimit(1 << 25)


def sum_of_distances(n, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    cnt = [0] * n
    down = [0] * n
    ans = [0] * n

    def dfs1(v, p):
        cnt[v] = 1
        for c in adj[v]:
            if c == p:
                continue
            dfs1(c, v)
            cnt[v] += cnt[c]
            down[v] += down[c] + cnt[c]

    def dfs2(v, p):
        for c in adj[v]:
            if c == p:
                continue
            ans[c] = ans[v] - cnt[c] + (n - cnt[c])
            dfs2(c, v)

    dfs1(0, -1)
    ans[0] = down[0]
    dfs2(0, -1)
    return ans


if __name__ == "__main__":
    print(sum_of_distances(6, [(0, 1), (0, 2), (2, 3), (2, 4), (2, 5)]))
```

---

### Challenge 4 — Tree Knapsack

**Problem.** Each node has weight `w[i]` and value `val[i]`. A node may be selected only if its parent is selected (root is free to start the chain). With budget `W`, maximize total value.

**Approach.** `dp[v][j]` = best value from subtree of `v` with budget `≤ j`, `v` taken. Merge children with a `(max,+)` convolution capped by subtree size. `O(n·W)`.

#### Go
```go
package main

import "fmt"

var (
	adj      [][]int
	w, val   []int
	cnt      []int
	dp       [][]int
	capacity int
)

const NEG = -1 << 30

func dfs(v, p int) {
	dp[v] = make([]int, capacity+1)
	for j := 0; j <= capacity; j++ {
		if j >= w[v] {
			dp[v][j] = val[v]
		} else {
			dp[v][j] = NEG
		}
	}
	cnt[v] = w[v]
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		dfs(c, v)
		nd := make([]int, capacity+1)
		copy(nd, dp[v])
		jmax := cnt[v]
		if jmax > capacity {
			jmax = capacity
		}
		for j := w[v]; j <= jmax; j++ {
			if dp[v][j] < 0 {
				continue
			}
			bmax := cnt[c]
			if bmax > capacity-j {
				bmax = capacity - j
			}
			for b := 0; b <= bmax; b++ {
				if dp[c][b] < 0 {
					continue
				}
				if dp[v][j]+dp[c][b] > nd[j+b] {
					nd[j+b] = dp[v][j] + dp[c][b]
				}
			}
		}
		cnt[v] += cnt[c]
		dp[v] = nd
	}
}

func main() {
	w = []int{1, 2, 1, 2}
	val = []int{5, 6, 4, 3}
	capacity = 4
	n := len(w)
	adj = make([][]int, n)
	cnt = make([]int, n)
	dp = make([][]int, n)
	for _, e := range [][2]int{{0, 1}, {0, 2}, {1, 3}} {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	dfs(0, -1)
	best := 0
	for _, x := range dp[0] {
		if x > best {
			best = x
		}
	}
	fmt.Println(best) // 15
}
```

#### Java
```java
import java.util.*;

public class TreeKnapsack {
    static List<Integer>[] adj;
    static int[] w, val, cnt;
    static int cap;
    static int[][] dp;
    static final int NEG = Integer.MIN_VALUE / 2;

    static void dfs(int v, int p) {
        dp[v] = new int[cap + 1];
        Arrays.fill(dp[v], NEG);
        for (int j = w[v]; j <= cap; j++) dp[v][j] = val[v];
        cnt[v] = w[v];
        for (int c : adj[v]) {
            if (c == p) continue;
            dfs(c, v);
            int[] nd = dp[v].clone();
            int jmax = Math.min(cnt[v], cap);
            for (int j = w[v]; j <= jmax; j++) {
                if (dp[v][j] < 0) continue;
                int bmax = Math.min(cnt[c], cap - j);
                for (int b = 0; b <= bmax; b++) {
                    if (dp[c][b] < 0) continue;
                    nd[j + b] = Math.max(nd[j + b], dp[v][j] + dp[c][b]);
                }
            }
            cnt[v] += cnt[c];
            dp[v] = nd;
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        w = new int[]{1, 2, 1, 2};
        val = new int[]{5, 6, 4, 3};
        cap = 4;
        int n = w.length;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        cnt = new int[n];
        dp = new int[n][];
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}};
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
        dfs(0, -1);
        int best = 0;
        for (int x : dp[0]) best = Math.max(best, x);
        System.out.println(best); // 15
    }
}
```

#### Python
```python
import sys
sys.setrecursionlimit(1 << 25)

NEG = float("-inf")


def tree_knapsack(n, edges, w, val, cap):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    dp = [None] * n
    cnt = [0] * n

    def dfs(v, p):
        row = [NEG] * (cap + 1)
        for j in range(w[v], cap + 1):
            row[j] = val[v]
        cnt[v] = w[v]
        for c in adj[v]:
            if c == p:
                continue
            dfs(c, v)
            nd = row[:]
            for j in range(w[v], min(cnt[v], cap) + 1):
                if row[j] == NEG:
                    continue
                for b in range(min(cnt[c], cap - j) + 1):
                    if dp[c][b] == NEG:
                        continue
                    if row[j] + dp[c][b] > nd[j + b]:
                        nd[j + b] = row[j] + dp[c][b]
            cnt[v] += cnt[c]
            row = nd
        dp[v] = row

    dfs(0, -1)
    return max(x for x in dp[0] if x != NEG)


if __name__ == "__main__":
    print(tree_knapsack(4, [(0, 1), (0, 2), (1, 3)],
                        [1, 2, 1, 2], [5, 6, 4, 3], 4))  # 15
```

---

## Closing Advice

- **State the state.** Before coding, say out loud what `dp[v]` means over `T_v`. Most failures are state-design failures.
- **Return vs record.** In any "best path anywhere" problem (diameter), the value you return up and the value you compare globally are different — say which is which.
- **Reach for rerooting** the moment the problem asks for an answer at *every* node; otherwise you will write `O(n²)`.
- **Mind the stack.** If the tree can be a long chain, go iterative or raise the limit before the interview clock runs out.
- **Test small.** Verify on the 6-node example or a hand-drawn tree; a brute force on `n ≤ 12` catches the subtle bugs.
