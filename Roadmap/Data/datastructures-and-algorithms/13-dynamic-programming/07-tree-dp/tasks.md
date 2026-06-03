# Tree DP (Dynamic Programming on Trees) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise I/O spec and starter code in all three languages. Implement the post-order DFS (and, where noted, the second rerooting pass).
> **Always test against a brute-force oracle on small trees (try all subsets / all node pairs) before trusting the dp.**
> Reminder: a tree on `n` nodes has `n-1` edges; guard the parent in the DFS; watch recursion depth on path-shaped trees (raise the limit or go iterative).

---

## Beginner Tasks (5)

### Task 1 — Subtree sizes

**Problem.** Given a rooted tree (root `0`), compute `size[v]` = number of nodes in the subtree of `v` (including `v`).

**Input / Output spec.**
- Read `n`, then `n-1` edges `u v`.
- Print `size[0] size[1] … size[n-1]` space-separated.

**Constraints.** `1 ≤ n ≤ 2·10^5`. The graph is a tree, 0-indexed.

**Hint.** `size[v] = 1 + Σ size[c]` over children. One post-order DFS.

**Starter — Go.**
```go
package main

import "fmt"

var adj [][]int
var size []int

func dfs(v, p int) {
	// TODO: size[v] = 1 + sum of children sizes
}

func main() {
	var n int
	fmt.Scan(&n)
	adj = make([][]int, n)
	size = make([]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	dfs(0, -1)
	for i, s := range size {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(s)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class SubtreeSizes {
    static List<Integer>[] adj;
    static int[] size;

    static void dfs(int v, int p) {
        // TODO
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        adj = new List[n];
        size = new int[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        dfs(0, -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(size[i]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)
    size = [0] * n

    def dfs(v, p):
        # TODO: size[v] = 1 + sum of children
        pass

    dfs(0, -1)
    print(*size)


main()
```

---

### Task 2 — Subtree value sums

**Problem.** Each node has a value `a[v]`. Compute `sum[v]` = sum of values in the subtree of `v`.

**I/O spec.** Read `n`, then `a[0..n-1]`, then `n-1` edges. Print `sum[0..n-1]`.

**Constraints.** `1 ≤ n ≤ 2·10^5`, `|a[v]| ≤ 10^9`. Use 64-bit.

**Hint.** `sum[v] = a[v] + Σ sum[c]`. Identical shape to Task 1 with a value instead of `1`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int64, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	sum := make([]int64, n)
	var dfs func(v, p int)
	dfs = func(v, p int) {
		// TODO: sum[v] = a[v] + children sums
	}
	dfs(0, -1)
	for i, s := range sum {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(s)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class SubtreeSums {
    static List<Integer>[] adj;
    static long[] a, sum;

    static void dfs(int v, int p) {
        // TODO
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        a = new long[n]; sum = new long[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextLong();
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        dfs(0, -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(sum[i]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    a = list(map(int, input().split()))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)
    sm = [0] * n

    def dfs(v, p):
        # TODO
        pass

    dfs(0, -1)
    print(*sm)


main()
```

---

### Task 3 — Maximum independent set weight (House Robber III)

**Problem.** Each node has value `a[v] ≥ 0`. Pick a set with no parent–child pair, maximizing total value.

**I/O spec.** Read `n`, `a[0..n-1]`, `n-1` edges. Print the maximum.

**Constraints.** `1 ≤ n ≤ 2·10^5`, `0 ≤ a[v] ≤ 10^9`. 64-bit.

**Hint.** Return `(excl, incl)`; `incl = a[v] + Σ excl[c]`, `excl = Σ max(...)`. Answer `max` at root.

**Starter — Go.**
```go
package main

import "fmt"

var adj [][]int
var a []int64

func dfs(v, p int) (int64, int64) {
	// TODO: return (best excluding v, best including v)
	return 0, 0
}

func main() {
	var n int
	fmt.Scan(&n)
	a = make([]int64, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	e, i := dfs(0, -1)
	if e > i {
		fmt.Println(e)
	} else {
		fmt.Println(i)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class TreeMISWeight {
    static List<Integer>[] adj;
    static long[] a;

    static long[] dfs(int v, int p) {
        // TODO return new long[]{excl, incl}
        return new long[]{0, 0};
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        a = new long[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextLong();
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        long[] r = dfs(0, -1);
        System.out.println(Math.max(r[0], r[1]));
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    a = list(map(int, input().split()))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)

    def dfs(v, p):
        # TODO return (excl, incl)
        return 0, 0

    print(max(dfs(0, -1)))


main()
```

---

### Task 4 — Count leaves in each subtree

**Problem.** Compute `leaves[v]` = number of leaves in the subtree of `v`. (A leaf has no children; for `n = 1`, node 0 is a leaf.)

**I/O spec.** Read `n`, `n-1` edges. Print `leaves[0..n-1]`.

**Constraints.** `1 ≤ n ≤ 2·10^5`.

**Hint.** If `v` has no children (besides parent), `leaves[v] = 1`; else `leaves[v] = Σ leaves[c]`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	leaves := make([]int, n)
	var dfs func(v, p int)
	dfs = func(v, p int) {
		// TODO: count children; if none, leaves[v]=1
	}
	dfs(0, -1)
	for i, l := range leaves {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(l)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class SubtreeLeaves {
    static List<Integer>[] adj;
    static int[] leaves;

    static void dfs(int v, int p) {
        // TODO
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        adj = new List[n];
        leaves = new int[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        dfs(0, -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(leaves[i]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)
    leaves = [0] * n

    def dfs(v, p):
        # TODO
        pass

    dfs(0, -1)
    print(*leaves)


main()
```

---

### Task 5 — Tree diameter (edges)

**Problem.** Print the number of edges on the longest path in the tree.

**I/O spec.** Read `n`, `n-1` edges. Print the diameter.

**Constraints.** `1 ≤ n ≤ 2·10^5`. For `n = 1`, diameter is `0`.

**Hint.** `down[v]` = longest downward chain; global `best = max(b1 + b2)`. Return one chain, record two.

**Starter — Go.**
```go
package main

import "fmt"

var g [][]int
var best int

func down(v, p int) int {
	// TODO: track two largest child chains, update best, return largest
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	g = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		g[u] = append(g[u], v)
		g[v] = append(g[v], u)
	}
	down(0, -1)
	fmt.Println(best)
}
```

**Starter — Java.**
```java
import java.util.*;

public class DiameterEdges {
    static List<Integer>[] g;
    static int best = 0;

    static int down(int v, int p) {
        // TODO
        return 0;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        g = new List[n];
        for (int i = 0; i < n; i++) g[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            g[u].add(v); g[v].add(u);
        }
        down(0, -1);
        System.out.println(best);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    g = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        g[u].append(v)
        g[v].append(u)
    best = 0

    def down(v, p):
        nonlocal best
        # TODO
        return 0

    down(0, -1)
    print(best)


main()
```

---

## Intermediate Tasks (4)

### Task 6 — Tree MIS by node count (unweighted)

**Problem.** Maximum independent set by **count** of nodes (each weight 1).

**I/O spec.** Read `n`, `n-1` edges. Print the maximum number of nodes.

**Constraints.** `1 ≤ n ≤ 2·10^5`.

**Hint.** Same as Task 3 with `a[v] = 1`. For a path of `n` nodes the answer is `⌈n/2⌉`.

**Starter — Go.**
```go
package main

import "fmt"

var adj [][]int

func dfs(v, p int) (int, int) {
	excl, incl := 0, 1
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		// TODO combine
		_ = c
	}
	return excl, incl
}

func main() {
	var n int
	fmt.Scan(&n)
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	e, i := dfs(0, -1)
	if e > i {
		fmt.Println(e)
	} else {
		fmt.Println(i)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class TreeMISCount {
    static List<Integer>[] adj;

    static int[] dfs(int v, int p) {
        int excl = 0, incl = 1;
        for (int c : adj[v]) {
            if (c == p) continue;
            // TODO combine
        }
        return new int[]{excl, incl};
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        int[] r = dfs(0, -1);
        System.out.println(Math.max(r[0], r[1]));
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)

    def dfs(v, p):
        excl, incl = 0, 1
        for c in adj[v]:
            if c == p:
                continue
            # TODO combine
        return excl, incl

    print(max(dfs(0, -1)))


main()
```

---

### Task 7 — Count independent sets mod p

**Problem.** Count the number of independent sets of the tree (including the empty set), modulo `10^9 + 7`.

**I/O spec.** Read `n`, `n-1` edges. Print the count mod `1_000_000_007`.

**Constraints.** `1 ≤ n ≤ 2·10^5`.

**Hint.** `g1[v] = Π g0[c]`, `g0[v] = Π (g0[c] + g1[c])`; answer `(g0[root] + g1[root]) mod p`. Reduce after each operation.

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

var adj [][]int

func dfs(v, p int) (int64, int64) {
	g0, g1 := int64(1), int64(1)
	for _, c := range adj[v] {
		if c == p {
			continue
		}
		// TODO: c0,c1 := dfs(c,v); g0 = g0*((c0+c1)%MOD)%MOD; g1 = g1*c0%MOD
		_ = c
	}
	return g0, g1
}

func main() {
	var n int
	fmt.Scan(&n)
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	g0, g1 := dfs(0, -1)
	fmt.Println((g0 + g1) % MOD)
}
```

**Starter — Java.**
```java
import java.util.*;

public class CountIndependentSets {
    static final long MOD = 1_000_000_007L;
    static List<Integer>[] adj;

    static long[] dfs(int v, int p) {
        long g0 = 1, g1 = 1;
        for (int c : adj[v]) {
            if (c == p) continue;
            // TODO
        }
        return new long[]{g0, g1};
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        long[] r = dfs(0, -1);
        System.out.println((r[0] + r[1]) % MOD);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline
MOD = 1_000_000_007


def main():
    n = int(input())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)

    def dfs(v, p):
        g0, g1 = 1, 1
        for c in adj[v]:
            if c == p:
                continue
            # TODO
        return g0, g1

    g0, g1 = dfs(0, -1)
    print((g0 + g1) % MOD)


main()
```

---

### Task 8 — Sum of distances in tree (rerooting)

**Problem.** For every node `v`, compute the sum of distances from `v` to all other nodes. Print all `n` values.

**I/O spec.** Read `n`, `n-1` edges. Print `ans[0..n-1]`.

**Constraints.** `1 ≤ n ≤ 2·10^5`. Use 64-bit (`ans` can reach ~`n²`). An `O(n²)` solution will TLE.

**Hint.** DFS1: `cnt[v]`, `down[v] = Σ(down[c] + cnt[c])`, `ans[0] = down[0]`. DFS2: `ans[c] = ans[v] - cnt[c] + (n - cnt[c])`.

**Starter — Go.**
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
	// TODO: cnt[v], down[v]
}

func dfs2(v, p int) {
	// TODO: ans[c] = ans[v] - cnt[c] + (N - cnt[c]); recurse
}

func main() {
	fmt.Scan(&N)
	adj = make([][]int, N)
	cnt = make([]int, N)
	down = make([]int64, N)
	ans = make([]int64, N)
	for i := 0; i < N-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	dfs1(0, -1)
	ans[0] = down[0]
	dfs2(0, -1)
	for i, x := range ans {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(x)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class SumDistances {
    static List<Integer>[] adj;
    static int[] cnt;
    static long[] down, ans;
    static int n;

    static void dfs1(int v, int p) { /* TODO */ }
    static void dfs2(int v, int p) { /* TODO */ }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        n = sc.nextInt();
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        cnt = new int[n]; down = new long[n]; ans = new long[n];
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        dfs1(0, -1);
        ans[0] = down[0];
        dfs2(0, -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(ans[i]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)
    cnt = [0] * n
    down = [0] * n
    ans = [0] * n

    def dfs1(v, p):
        # TODO
        pass

    def dfs2(v, p):
        # TODO
        pass

    dfs1(0, -1)
    ans[0] = down[0]
    dfs2(0, -1)
    print(*ans)


main()
```

---

## Advanced Tasks (3)

### Task 9 — Tree knapsack with parent dependency

**Problem.** Each node has weight `w[v]` and value `val[v]`. Selecting `v` requires selecting `par(v)` (root free). With budget `W`, maximize total value.

**I/O spec.** Read `n W`, then `w[v] val[v]` for each node, then `n-1` edges. Print the maximum value.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ W ≤ 2000`, weights/values up to `10^4`. Target `O(n·W)` (cap loops by subtree size).

**Hint.** `dp[v][j]` with `v` taken; merge children by `(max,+)` convolution; bound `j` by `min(cnt[v], W)` and `b` by `min(cnt[c], W-j)`.

**Starter — Go.**
```go
package main

import "fmt"

const NEG = -1 << 30

var (
	adj    [][]int
	w, val []int
	cnt    []int
	dp     [][]int
	W      int
)

func dfs(v, p int) {
	// TODO: init dp[v] (v taken), merge each child with min-bounded loops, grow cnt[v]
}

func main() {
	var n int
	fmt.Scan(&n, &W)
	w = make([]int, n)
	val = make([]int, n)
	for i := 0; i < n; i++ {
		fmt.Scan(&w[i], &val[i])
	}
	adj = make([][]int, n)
	cnt = make([]int, n)
	dp = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	dfs(0, -1)
	best := 0
	for _, x := range dp[0] {
		if x > best {
			best = x
		}
	}
	fmt.Println(best)
}
```

**Starter — Java.**
```java
import java.util.*;

public class TreeKnapsackTask {
    static List<Integer>[] adj;
    static int[] w, val, cnt;
    static int[][] dp;
    static int W;
    static final int NEG = Integer.MIN_VALUE / 2;

    static void dfs(int v, int p) {
        // TODO
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(); W = sc.nextInt();
        w = new int[n]; val = new int[n]; cnt = new int[n]; dp = new int[n][];
        for (int i = 0; i < n; i++) { w[i] = sc.nextInt(); val[i] = sc.nextInt(); }
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        dfs(0, -1);
        int best = 0;
        for (int x : dp[0]) best = Math.max(best, x);
        System.out.println(best);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline
NEG = float("-inf")


def main():
    n, W = map(int, input().split())
    w = [0] * n
    val = [0] * n
    for i in range(n):
        w[i], val[i] = map(int, input().split())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)
    dp = [None] * n
    cnt = [0] * n

    def dfs(v, p):
        # TODO: init row (v taken), merge children with min-bounded loops
        pass

    dfs(0, -1)
    print(max(x for x in dp[0] if x != NEG))


main()
```

---

### Task 10 — Maximum distance from each node (rerooting, max not sum)

**Problem.** For each node `v`, compute the maximum distance (in edges) to any other node (the **eccentricity** of `v`). Print all `n` values.

**I/O spec.** Read `n`, `n-1` edges. Print `ecc[0..n-1]`.

**Constraints.** `1 ≤ n ≤ 2·10^5`. Must be `O(n)`.

**Hint.** This needs a **max** reroot: keep `down1`, `down2` (two longest downward chains) per node so a child can use the parent's best chain *that does not go through itself*. `max` is not invertible — use the two-best trick. `up[c] = 1 + max(up[v], best downward chain of v avoiding c)`.

**Starter — Go.**
```go
package main

import "fmt"

var (
	adj          [][]int
	down1, down2 []int // two longest downward chains
	who          []int // child giving down1
	up           []int
	ans          []int
)

func dfs1(v, p int) {
	// TODO: fill down1[v], down2[v], who[v]
}

func dfs2(v, p int) {
	// TODO: for each child c, up[c] = 1 + max(up[v], (c==who[v]? down2[v] : down1[v]))
	// ans[c] = max(up[c], down1[c]); recurse
}

func main() {
	var n int
	fmt.Scan(&n)
	adj = make([][]int, n)
	down1 = make([]int, n)
	down2 = make([]int, n)
	who = make([]int, n)
	up = make([]int, n)
	ans = make([]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Scan(&u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	dfs1(0, -1)
	dfs2(0, -1)
	ans[0] = down1[0]
	for i := 1; i < n; i++ {
		if down1[i] > ans[i] {
			ans[i] = down1[i]
		}
	}
	for i, x := range ans {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(x)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Eccentricity {
    static List<Integer>[] adj;
    static int[] down1, down2, who, up, ans;

    static void dfs1(int v, int p) { /* TODO */ }
    static void dfs2(int v, int p) { /* TODO */ }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        down1 = new int[n]; down2 = new int[n]; who = new int[n];
        up = new int[n]; ans = new int[n];
        for (int i = 0; i < n - 1; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        dfs1(0, -1);
        dfs2(0, -1);
        for (int i = 0; i < n; i++) ans[i] = Math.max(up[i], down1[i]);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(ans[i]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)
input = sys.stdin.readline


def main():
    n = int(input())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u, v = map(int, input().split())
        adj[u].append(v)
        adj[v].append(u)
    down1 = [0] * n
    down2 = [0] * n
    who = [-1] * n
    up = [0] * n

    def dfs1(v, p):
        # TODO fill down1, down2, who
        pass

    def dfs2(v, p):
        # TODO up[c] = 1 + max(up[v], down2[v] if c==who[v] else down1[v]); recurse
        pass

    dfs1(0, -1)
    dfs2(0, -1)
    ans = [max(up[i], down1[i]) for i in range(n)]
    print(*ans)


main()
```

---

### Task 11 — Number of nodes at each distance: weighted MIS on a tree with iterative DFS

**Problem.** Same as Task 3 (maximum-weight independent set), but `n` can be up to `10^6` and the tree may be a path — a recursive solution will overflow the stack. Implement it **iteratively** (explicit stack, reverse pre-order).

**I/O spec.** Read `n`, `a[0..n-1]`, `n-1` edges. Print the maximum-weight independent set.

**Constraints.** `1 ≤ n ≤ 10^6`, `0 ≤ a[v] ≤ 10^9`. 64-bit. **Recursion is not allowed** (assume the stack is small).

**Hint.** Build a pre-order with an explicit stack, record `parent[]`, then iterate the order in reverse, accumulating `excl[v]`/`incl[v]` from already-processed children.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(reader, &n)
	a := make([]int64, n)
	for i := range a {
		fmt.Fscan(reader, &a[i])
	}
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var u, v int
		fmt.Fscan(reader, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	// TODO: explicit-stack pre-order -> order[], parent[]
	// then reverse loop computing excl[], incl[]
	fmt.Println(0) // replace
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class IterativeMIS {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.nextToken(); int n = (int) st.nval;
        long[] a = new long[n];
        for (int i = 0; i < n; i++) { st.nextToken(); a[i] = (long) st.nval; }
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj[u].add(v); adj[v].add(u);
        }
        // TODO: iterative pre-order, then reverse-order dp
        System.out.println(0); // replace
    }
}
```

**Starter — Python.**
```python
import sys
input = sys.stdin.buffer.read


def main():
    data = input().split()
    idx = 0
    n = int(data[idx]); idx += 1
    a = [int(data[idx + i]) for i in range(n)]; idx += n
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    # TODO: explicit-stack pre-order -> order, parent; reverse loop -> excl, incl
    print(0)  # replace


main()
```

---

## Evaluation Criteria

- **Correctness:** match a brute-force oracle (subset/pair enumeration) on random trees with `n ≤ 14`.
- **Complexity:** one-pass tasks `O(n)`; rerooting `O(n)`; tree knapsack `O(n·W)`; no accidental `O(n²)` reroot.
- **Robustness:** handle `n = 1`, a path tree (depth stress), and a star tree (wide combine).
- **Arithmetic:** 64-bit for sums/distances; modulus reduced after every operation in counting tasks.
- **Stack safety:** Task 11 must run iteratively without overflow on a `10^6`-node path.
