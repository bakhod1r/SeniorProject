# Tree DP (Dynamic Programming on Trees) — Middle Level

> **Focus:** The **rerooting technique** (compute the answer for *every* node as root in `O(n)` with two DFS passes), **in-and-out DP** (combine "what hangs below me" with "what hangs above me"), **tree knapsack** (group/bounded knapsack folded into the DFS, with the subtree-size complexity argument), and **iterative DFS** so deep trees never overflow the stack. Plus the comparisons that tell you which tool fits.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Rerooting in Detail](#rerooting-in-detail)
6. [Tree Knapsack](#tree-knapsack)
7. [Iterative DFS](#iterative-dfs)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: root the tree, post-order DFS, fold children into the parent — `O(n)`. That solves problems where the answer lives **at the root** (or anywhere, tracked by a global). At middle level you confront the questions that decide whether your solution is *fast enough* and *correct on adversarial input*:

- I need the answer **for every node as the root** — sum of distances to all other nodes, the farthest node from each vertex, the best subtree value seen from each direction. Rerunning the root DFS `n` times is `O(n²)`. How do I get all `n` answers in `O(n)`?
- The information a node needs is **partly below it and partly above it** ("everything in my subtree" *plus* "everything outside my subtree"). How do I combine the two cleanly? (**In-and-out DP** / rerooting.)
- I have a **budget** — pick at most `W` units of weight from the tree to maximize value, with the constraint that you can only take a node if you took its parent (or some subtree-shaped constraint). That is **tree knapsack**, and its complexity is famously `O(n·W)` despite looking like it should be worse.
- My tree is a chain of `10^6` nodes and recursion overflows the stack. How do I run the **same dp iteratively**?

These four — rerooting, in/out DP, tree knapsack, iterative DFS — are the working tree-dp toolkit. The unifying idea remains *state per node summarizing a region of the tree*; what changes is **which region** (subtree vs whole tree minus subtree) and **how rich** the per-node state must be (a tuple vs a whole knapsack array).

---

## Deeper Concepts

### The two directions of information

Root the tree at `r`. For a node `v` there are exactly two "worlds":

- **Down (subtree of `v`):** everything reachable from `v` going away from the root. This is what the junior post-order DFS computes: `down[v]`.
- **Up (the rest of the tree):** the parent, the parent's other children, the grandparent, and so on — everything *outside* `v`'s subtree, entered through `v`'s parent. Call it `up[v]`.

Many "answer for every root" problems decompose as `answer[v] = combine(down[v], up[v])`. The first DFS computes all `down[v]` bottom-up; the second DFS pushes `up[v]` **top-down** from parent to child. Two passes, `O(n)` total. This is the heart of **rerooting** and **in-and-out DP**.

### Why naive rerooting is `O(n²)` and the fix

If you literally re-run the post-order DFS treating each of the `n` nodes as the root, each run is `O(n)`, giving `O(n²)`. Rerooting observes that **moving the root from a node to an adjacent node changes only a tiny, local part of the dp** — the edge between them flips direction. So instead of recomputing from scratch, you *transfer* the answer across one edge in `O(1)` (or `O(deg)` with care), visiting each edge twice. Total `O(n)`.

### The "remove one child" subtlety

When computing `up[child]` for a node `v`, the child must see `v`'s contribution **excluding the child's own subtree** (otherwise it would double-count itself). Two clean ways to get "the combine of all children except this one":

1. **Prefix/suffix products.** For an associative combine, precompute prefix and suffix accumulations over `v`'s children, so "all but child `i`" is `prefix[i-1] ∘ suffix[i+1]` in `O(1)`.
2. **Invertible combine.** If the combine has an inverse (e.g. sum: subtract; product: divide when nonzero), compute the full combine and remove the one child. Faster but only works for invertible operations — and `max` is **not** invertible, so prefer prefix/suffix for `max`-type dps.

### In-and-out DP, stated

"In" = the subtree dp (`down`). "Out" = the dp of everything else (`up`). The pattern:

```
DFS1 (post-order):   down[v] = combine over children c of f(down[c])
DFS2 (pre-order):    for each child c of v:
                         contribFromV = combine( up[v], all children of v except c )
                         up[c] = g(contribFromV)
answer[v] = h(down[v], up[v])
```

The functions `f, g, h` are problem-specific, but the skeleton is fixed. "Sum of distances in tree" (LeetCode 834) is the textbook instance and appears as a coding challenge in `interview.md`.

---

## Comparison with Alternatives

### One-pass tree dp vs rerooting

| Goal | One-pass post-order | Rerooting (two-pass) |
|------|--------------------|-----------------------|
| Answer at the root only | `O(n)` ✓ | overkill |
| Answer anywhere, via a global max | `O(n)` ✓ | unnecessary |
| **Answer for every node as root** | `O(n²)` (rerun) | **`O(n)`** ✓ |
| Per-node value depends on the whole tree | needs up + down | rerooting is the tool |

### Tree diameter: three ways

| Method | Idea | Time | Notes |
|--------|------|------|-------|
| Single DFS dp | two longest child chains, global max | `O(n)` | junior approach; works with negative edge weights too if done with care |
| Two BFS/DFS | farthest node `u` from any start, then farthest from `u` | `O(n)` | elegant but **only valid for non-negative edge weights** |
| Rerooting | farthest distance from every node, take the max | `O(n)` | gives the eccentricity of *every* node, not just the diameter |

### Tree knapsack vs flat knapsack

| Aspect | Flat 0/1 knapsack | Tree knapsack |
|--------|-------------------|----------------|
| Items | independent | a node is takeable only under a subtree constraint |
| State | `dp[capacity]` | `dp[v][capacity]` merged child-by-child |
| Complexity | `O(n·W)` | `O(n·W)` (with the subtree-size argument — see below and `professional.md`) |
| Merge | add one item | a `(group) knapsack` merge per child |

---

## Advanced Patterns

### Pattern 1: down[] + up[] = answer for every node

The master pattern of this file. Compute `down` in DFS1, push `up` in DFS2, combine.

### Pattern 2: prefix/suffix over children for "all but one"

When DFS2 needs "the combine of `v`'s children excluding child `c`", precompute prefix and suffix arrays of the children's contributions. Essential whenever the combine (e.g. `max`, or "two best") is **not invertible**.

### Pattern 3: small fixed tuple states

Many problems keep `O(1)` numbers per node: `(included, excluded)` for MIS, `(longest down chain, second longest)` for diameter, `(count, sum)` for averages. Rerooting these is cheap because transferring `O(1)` data across an edge is `O(1)`.

### Pattern 4: knapsack-shaped state per node

When the per-node state is itself an array of size `W+1`, merging two children is a `(min(size, W))²`-style convolution. The total cost telescopes to `O(n·W)` by the subtree-size argument.

---

## Rerooting in Detail

**Goal (running example): sum of distances.** For a tree, compute for every node `v` the value `S[v] = Σ_u dist(v, u)` — the sum of distances from `v` to all other nodes.

**DFS1 (post-order), rooted at `0`:** compute
- `cnt[v]` = number of nodes in `v`'s subtree (including `v`),
- `down[v]` = `Σ_{u in subtree(v)} dist(v, u)` = sum of distances from `v` to nodes **below** it.

```
cnt[v]  = 1 + Σ_c cnt[c]
down[v] = Σ_c ( down[c] + cnt[c] )    # each subtree node is one edge farther from v than from c
```

So `S[0] = down[0]` (the root sees its whole tree as "below").

**DFS2 (pre-order), push the answer down:** when we move the root from `v` to its child `c`, the `cnt[c]` nodes in `c`'s subtree get **one closer** (each loses 1 distance) and the other `n - cnt[c]` nodes get **one farther** (each gains 1). Therefore:

```
S[c] = S[v] - cnt[c] + (n - cnt[c])
```

That is an `O(1)` transfer across each edge. Visiting all edges top-down gives every `S[v]` in `O(n)`. This is rerooting in its purest form: the global answer for a neighbor is one cheap update away from the current node's answer.

**Correctness intuition (full proof in `professional.md`):** `S[v]` correctly equals the sum over the subtree (`down[v]`) plus the sum over the rest of the tree, and the rest-of-tree contribution is exactly what the parent passes down adjusted by the `±1`-per-node distance change when the root crosses the edge.

---

## Tree Knapsack

**Problem.** Each node `i` has weight `w[i]` and value `val[i]`. You may select a node only if its parent is also selected (a "dependency"/subtree constraint). With total weight budget `W`, maximize selected value. (Variants: "pick exactly `k` nodes", "group knapsack on a tree".)

**State.** `dp[v][j]` = best value obtainable from the subtree of `v` using budget exactly/at most `j`, **given that `v` is taken** (so its children may or may not be).

**Merge.** Start with `dp[v]` representing "only `v` taken" (value `val[v]` at weight `w[v]`). For each child `c`, merge `c`'s table into `v`'s with a knapsack convolution:

```
new[v][j] = max over split j = a + b of ( dp[v][a] + dp[c][b] )
```

**Why this is `O(n·W)` and not `O(n·W²)` — the subtree-size argument.** The naive bound says each merge is `O(W²)` and there are `n` merges, giving `O(n·W²)`. But you **cap each table's dimension at the subtree size** (a subtree of `s` nodes can hold at most `s` items, so you never iterate its index past `min(cnt, W)`). The cost of merging subtree of size `a` with subtree of size `b` is `O(a·b)`. Summed over the tree, `Σ a·b` counts, for each **pair of nodes**, the moment their subtrees first merge — and each unordered pair merges exactly once. That is `O(n²)` pairs, i.e. `O(n²)` when `W ≥ n`, and `O(n·W)` once you also cap at `W`. The rigorous derivation (the "merging-small-to-large is bounded by counting pairs" lemma) is in `professional.md`. The practical takeaway: **bound your inner loops by `min(subtreeSize, W)`** and the complexity collapses to `O(n·W)`.

```
for child c of v:
    for j from min(cnt[v], W) down to 0:           # already-collected size of v
        for b from 0 to min(cnt[c], W - j):        # take b weight from c's subtree
            dp[v][j+b] = max(dp[v][j+b], dp[v][j] + dp[c][b])
    cnt[v] += cnt[c]                                # grow the cap as children merge
```

The descending `j` loop and the `cnt`-capped bounds are exactly what makes the analysis work.

---

## Iterative DFS

Recursion is the natural expression of tree dp, but a **path-like tree of `10^6` nodes** overflows the call stack in Go, Java, and (by default) Python. Two production-safe options:

1. **Raise the recursion limit / stack size.** Quick but fragile; `senior.md` covers the limits per language.
2. **Explicit-stack iterative DFS.** Push `(node, parent, childIndex)` frames; on first visit push children, on the post-visit pop fold them in. Below is an iterative MIS that mirrors the recursive version exactly.

The key is to emulate **post-order**: process a node's children fully, *then* the node. The two-phase trick is to push each node twice, or to push a node, mark it "entered", push its children, and combine when it is popped after its children.

---

## Code Examples

### Sum of distances in a tree via rerooting (every node's answer in `O(n)`)

#### Go

```go
package main

import "fmt"

var (
	adj   [][]int
	cnt   []int
	down  []int64
	ans   []int64
	nGlob int
)

func dfs1(v, p int) {
	cnt[v] = 1
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		dfs1(c, v)
		cnt[v] += cnt[c]
		down[v] += down[c] + int64(cnt[c]) // subtree nodes are 1 edge farther from v
	}
}

func dfs2(v, p int) {
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		ans[c] = ans[v] - int64(cnt[c]) + int64(nGlob-cnt[c]) // O(1) reroot transfer
		dfs2(c, v)
	}
}

func main() {
	nGlob = 6
	adj = make([][]int, nGlob)
	cnt = make([]int, nGlob)
	down = make([]int64, nGlob)
	ans = make([]int64, nGlob)
	edges := [][2]int{{0, 1}, {0, 2}, {2, 3}, {2, 4}, {2, 5}}
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	dfs1(0, -1)
	ans[0] = down[0]
	dfs2(0, -1)
	fmt.Println(ans) // sum of distances from each node
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
        cnt = new int[n];
        down = new long[n];
        ans = new long[n];
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

**What it does:** `dfs1` computes subtree sizes and "sum of distances to nodes below". `dfs2` rerolls each child's answer from its parent's in `O(1)`. Every node's total distance is produced in one linear pass each — `O(n)` overall.
**Run:** `go run main.go` | `javac SumOfDistances.java && java SumOfDistances` | `python sum_dist.py`

### Tree knapsack (dependency: take a node only if its parent is taken)

#### Go

```go
package main

import "fmt"

var (
	adj    [][]int
	wgt    []int
	val    []int
	cap    int
	dp     [][]int // dp[v][j] = best value from subtree(v) using <= j budget, v taken
	subCnt []int   // collected weight cap so far
)

func dfs(v, p int) {
	dp[v] = make([]int, cap+1)
	for j := 0; j <= cap; j++ {
		if j >= wgt[v] {
			dp[v][j] = val[v] // v itself is taken
		} else {
			dp[v][j] = -1 // cannot even afford v
		}
	}
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		dfs(c, v)
		nd := make([]int, cap+1)
		copy(nd, dp[v])
		for j := wgt[v]; j <= cap; j++ {
			if dp[v][j] < 0 {
				continue
			}
			for b := 0; b+j <= cap; b++ {
				if dp[c][b] < 0 {
					continue
				}
				if dp[v][j]+dp[c][b] > nd[j+b] {
					nd[j+b] = dp[v][j] + dp[c][b]
				}
			}
		}
		dp[v] = nd
	}
}

func main() {
	n := 4
	adj = make([][]int, n)
	wgt = []int{1, 2, 1, 2}
	val = []int{5, 6, 4, 3}
	cap = 4
	dp = make([][]int, n)
	edges := [][2]int{{0, 1}, {0, 2}, {1, 3}}
	for _, e := range edges {
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
	fmt.Println("best value within budget =", best)
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

    static void dfs(int v, int p) {
        dp[v] = new int[cap + 1];
        Arrays.fill(dp[v], Integer.MIN_VALUE / 2);
        for (int j = w[v]; j <= cap; j++) dp[v][j] = val[v]; // v taken
        cnt[v] = w[v];
        for (int c : adj[v]) {
            if (c == p) continue;
            dfs(c, v);
            int[] nd = dp[v].clone();
            for (int j = w[v]; j <= Math.min(cnt[v], cap); j++) {
                if (dp[v][j] < 0) continue;
                for (int b = 0; b <= Math.min(cnt[c], cap - j); b++) {
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
        int n = 4;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        w = new int[]{1, 2, 1, 2};
        val = new int[]{5, 6, 4, 3};
        cnt = new int[n];
        cap = 4;
        dp = new int[n][];
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}};
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
        dfs(0, -1);
        int best = 0;
        for (int x : dp[0]) best = Math.max(best, x);
        System.out.println("best value within budget = " + best);
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
            row[j] = val[v]               # v itself taken
        cnt[v] = w[v]
        for c in adj[v]:
            if c == p:
                continue
            dfs(c, v)
            nd = row[:]
            jmax = min(cnt[v], cap)
            for j in range(w[v], jmax + 1):
                if row[j] == NEG:
                    continue
                bmax = min(cnt[c], cap - j)
                for b in range(bmax + 1):
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
    print("best value within budget =",
          tree_knapsack(4, [(0, 1), (0, 2), (1, 3)],
                        [1, 2, 1, 2], [5, 6, 4, 3], 4))
```

**What it does:** node `0` (value 5, weight 1) must be taken to take any descendant. With budget 4 the best pick is `{0, 1, 2}` = `5 + 6 + 4 = 15`. The `min(cnt, cap)` bounds on the loops are what make this `O(n·W)`.
**Run:** `go run main.go` | `javac TreeKnapsack.java && java TreeKnapsack` | `python tree_knap.py`

### Iterative post-order DFS (stack-safe MIS)

#### Go

```go
package main

import "fmt"

func main() {
	n := 6
	adj := make([][]int, n)
	w := []int64{3, 2, 1, 1, 3, 1}
	edges := [][2]int{{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}}
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	excl := make([]int64, n)
	incl := make([]int64, n)
	parent := make([]int, n)
	order := []int{} // nodes in the order they were entered (pre-order)
	parent[0] = -1
	stack := []int{0}
	visited := make([]bool, n)
	visited[0] = true
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		order = append(order, v)
		for _, c := range adj[v] {
			if !visited[c] {
				visited[c] = true
				parent[c] = v
				stack = append(stack, c)
			}
		}
	}
	// process in REVERSE pre-order = a valid post-order (children before parents)
	for i := len(order) - 1; i >= 0; i-- {
		v := order[i]
		incl[v] = w[v]
		// excl[v] starts at 0
		for _, c := range adj[v] {
			if c == parent[v] {
				continue
			}
			if excl[c] > incl[c] {
				excl[v] += excl[c]
			} else {
				excl[v] += incl[c]
			}
			incl[v] += excl[c]
		}
	}
	best := excl[0]
	if incl[0] > best {
		best = incl[0]
	}
	fmt.Println("MIS (iterative) =", best) // 8
}
```

#### Java

```java
import java.util.*;

public class IterativeTreeDP {
    public static void main(String[] args) {
        int n = 6;
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        long[] w = {3, 2, 1, 1, 3, 1};
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}};
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }

        long[] excl = new long[n], incl = new long[n];
        int[] parent = new int[n];
        int[] order = new int[n];
        int oi = 0;
        boolean[] vis = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>();
        st.push(0); vis[0] = true; parent[0] = -1;
        while (!st.isEmpty()) {
            int v = st.pop();
            order[oi++] = v;
            for (int c : adj[v]) if (!vis[c]) { vis[c] = true; parent[c] = v; st.push(c); }
        }
        for (int i = n - 1; i >= 0; i--) {
            int v = order[i];
            incl[v] = w[v];
            for (int c : adj[v]) {
                if (c == parent[v]) continue;
                excl[v] += Math.max(excl[c], incl[c]);
                incl[v] += excl[c];
            }
        }
        System.out.println("MIS (iterative) = " + Math.max(excl[0], incl[0])); // 8
    }
}
```

#### Python

```python
def mis_iterative(n, edges, w):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    parent = [-1] * n
    order = []
    visited = [False] * n
    stack = [0]
    visited[0] = True
    while stack:
        v = stack.pop()
        order.append(v)
        for c in adj[v]:
            if not visited[c]:
                visited[c] = True
                parent[c] = v
                stack.append(c)
    excl = [0] * n
    incl = [0] * n
    for v in reversed(order):          # reverse pre-order = post-order
        incl[v] = w[v]
        for c in adj[v]:
            if c == parent[v]:
                continue
            excl[v] += max(excl[c], incl[c])
            incl[v] += excl[c]
    return max(excl[0], incl[0])


if __name__ == "__main__":
    print("MIS (iterative) =",
          mis_iterative(6, [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5)],
                        [3, 2, 1, 1, 3, 1]))  # 8
```

**What it does:** builds a pre-order with an explicit stack, then processes nodes in **reverse** pre-order — which is a valid post-order (every child precedes its parent in reverse). No recursion, so a million-node chain is fine.
**Run:** `go run main.go` | `javac IterativeTreeDP.java && java IterativeTreeDP` | `python iter_dp.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Double-counting in reroot | Used `down[c]` when forming `up[c]` without removing `c`'s own contribution. | Use "all children except `c`" via prefix/suffix or the `±1` distance identity. |
| `max` reroot gives wrong answer | Tried to "subtract" a child from a `max` combine; `max` is not invertible. | Use prefix/suffix maxima, not subtraction. |
| Knapsack `O(n·W²)` blowup | Inner loop ran to `W` instead of `min(subtreeSize, W)`. | Cap loops by collected subtree size; grow `cnt[v]` as children merge. |
| Stack overflow on deep tree | Recursive DFS on a `10^6`-node chain. | Iterative DFS (reverse pre-order) or raised stack limit. |
| Wrong post-order from stack | Folded a node before its children were done. | Process in reverse pre-order, or use the two-push "enter/exit" technique. |
| Reroot transfer wrong sign | Mixed up "closer" vs "farther" subtree on the moved edge. | `S[c] = S[v] - cnt[c] + (n - cnt[c])`: subtree gets closer, rest gets farther. |

---

## Performance Analysis

- **One-pass dp:** `O(n)` time, `O(n)` space, `O(h)` stack.
- **Rerooting:** `O(n)` time (each edge processed twice), `O(n)` space for `down`, `up`, `cnt`.
- **Tree knapsack:** `O(n·W)` time with the subtree-size cap; `O(n·W)` space if you keep every node's table, reducible to `O(W)` extra if you free child tables after merging.
- **Iterative DFS:** same asymptotics as recursive, `O(n)` explicit-stack memory, but no call-stack limit.

The recurring performance lesson: **cap inner loops by what is structurally possible** (subtree size), and **transfer answers across edges instead of recomputing** (rerooting). Both turn an apparent `O(n²)` (or worse) into `O(n)` or `O(n·W)`.

---

## Best Practices

- Write rerooting as **exactly two DFS passes** with named arrays `down`, `up`/`ans`, `cnt`; document what each holds.
- For non-invertible combines (`max`, "two best"), **always** use prefix/suffix, never subtraction.
- In tree knapsack, **bound loops by `min(cnt, W)`** and grow `cnt` incrementally — this is both correct and what makes it `O(n·W)`.
- Default to **iterative DFS** in environments with small stacks or when `n` can exceed ~10⁵ in a possibly-degenerate tree.
- Validate rerooting by checking that `ans[root]` from DFS2 equals the directly computed `down[root]`, and spot-check one leaf by brute force.
- Free per-node knapsack tables after a child is merged to keep memory `O(W)` extra.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation shows a post-order DFS filling `(excl, incl)` bottom-up; the same engine illustrates how, after the first pass, a second top-down pass could transfer an answer across each edge — the essence of rerooting and in/out DP discussed here.

---

## Summary

Middle-level tree dp is about **which region a node summarizes** and **how rich its state is**. Rerooting computes the answer for *every* node as root in `O(n)` by a post-order pass that builds `down[v]` (subtree info) and a pre-order pass that pushes `up[v]` (everything-else info), transferring across each edge in `O(1)` — the canonical instance is sum-of-distances. In-and-out DP is the same idea framed as `answer[v] = combine(down[v], up[v])`; remember that non-invertible combines like `max` need prefix/suffix, not subtraction. Tree knapsack folds a knapsack array into each node and runs in `O(n·W)` precisely because you cap inner loops by subtree size, so the total merge work counts each node pair once. Finally, deep trees demand **iterative DFS** (process nodes in reverse pre-order) so a million-node chain never overflows the stack. Together these four techniques cover the overwhelming majority of competitive and production tree-dp problems.
