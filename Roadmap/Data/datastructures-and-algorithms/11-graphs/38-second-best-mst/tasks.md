# Second-Best Minimum Spanning Tree — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem spec, constraints, hints, and starter code in all three languages. Fill in the logic and validate against the evaluation criteria. A final benchmark task compares the naive `O(E·V)` and the LCA `O((V+E) log V)` approaches.

> Reusable building blocks across tasks: **Union-Find / Kruskal** (from **10-mst-kruskal-prim**), **LCA binary lifting** (from **13-lca**), and the three-branch swap rule:
> `w > max → w−max`; `w == max → 0`; `w < max & second-max exists → w−secondMax`.

---

## Beginner Tasks (5)

### Task 1 — Build the MST and list its non-tree edges

**Problem.** Read a connected weighted undirected graph. Build the MST with Kruskal. Print the MST weight, then print every non-tree edge (the edges *not* chosen) one per line as `u v w`. These non-tree edges are the only swap candidates for the second-best MST.

**Input / Output spec.**
- First line: `n m` (vertices, edges).
- Next `m` lines: `u v w`.
- Output: MST weight on line 1, then each non-tree edge `u v w`.

**Constraints.**
- `2 ≤ n ≤ 10^5`, `n−1 ≤ m ≤ 2·10^5`.
- Weights fit in 32-bit; the graph is connected.

**Hint.** Sort edges by weight; union the endpoints if they are in different sets (tree edge) else record it as non-tree.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

type Edge struct{ u, v, w int }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	edges := make([]Edge, m)
	for i := range edges {
		fmt.Fscan(in, &edges[i].u, &edges[i].v, &edges[i].w)
	}
	_ = sort.Slice
	// TODO: Kruskal. Track inMST[]. Sum weight. Print non-tree edges.
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        int[][] edges = new int[m][3];
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            edges[i][0] = Integer.parseInt(st.nextToken());
            edges[i][1] = Integer.parseInt(st.nextToken());
            edges[i][2] = Integer.parseInt(st.nextToken());
        }
        // TODO: sort by weight, Kruskal, print MST weight + non-tree edges
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    edges = []
    for _ in range(m):
        u, v, w = int(data[idx]), int(data[idx+1]), int(data[idx+2])
        idx += 3
        edges.append((u, v, w))
    # TODO: Kruskal, print MST weight then non-tree edges
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- MST weight matches a reference Kruskal.
- Exactly `m − (n − 1)` non-tree edges are printed.
- Runs within time for `m = 2·10^5`.

---

### Task 2 — Path maximum on a fixed tree (single query)

**Problem.** You are given a tree (not a general graph) with `n` nodes and weighted edges, plus one query `(u, v)`. Print the maximum-weight edge on the path between `u` and `v`. Use a simple BFS/DFS walk for this task (no LCA needed yet).

**Input / Output spec.**
- First line: `n`.
- Next `n−1` lines: `a b w`.
- Last line: `u v`.
- Output: the maximum edge weight on the path `u..v`.

**Constraints.**
- `2 ≤ n ≤ 2000` (so an `O(n)` walk is fine).
- Weights are positive 32-bit integers.

**Hint.** BFS from `u` recording the max edge seen to reach each node; read off the max for `v`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][][2]int, n)
	for i := 0; i < n-1; i++ {
		var a, b, w int
		fmt.Fscan(in, &a, &b, &w)
		adj[a] = append(adj[a], [2]int{b, w})
		adj[b] = append(adj[b], [2]int{a, w})
	}
	var u, v int
	fmt.Fscan(in, &u, &v)
	// TODO: BFS from u, track max edge to reach each node, print maxTo[v]
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            StringTokenizer st = new StringTokenizer(br.readLine());
            int a = Integer.parseInt(st.nextToken());
            int b = Integer.parseInt(st.nextToken());
            int w = Integer.parseInt(st.nextToken());
            adj[a].add(new int[]{b, w});
            adj[b].add(new int[]{a, w});
        }
        StringTokenizer st = new StringTokenizer(br.readLine());
        int u = Integer.parseInt(st.nextToken());
        int v = Integer.parseInt(st.nextToken());
        // TODO: BFS from u tracking max edge, print result for v
    }
}
```

**Starter — Python.**
```python
import sys
from collections import deque

def main():
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a, b, w = int(data[idx]), int(data[idx+1]), int(data[idx+2])
        idx += 3
        adj[a].append((b, w))
        adj[b].append((a, w))
    u, v = int(data[idx]), int(data[idx+1])
    # TODO: BFS from u tracking max edge to each node, print max_to[v]
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on hand traces (path tree, star tree, single edge).
- `O(n)` per query; no LCA required at this size.

---

### Task 3 — Second-best MST weight (naive path walk)

**Problem.** Compute the second-best MST weight using the *naive* method: build the MST, then for each non-tree edge walk the tree path in `O(V)` to find the max (and, for ties, second-max) edge, and apply the three-branch rule. Print the second-best weight, or `-1` if no second-best exists.

**Input / Output spec.** Same input format as Task 1; output the single second-best weight (or `-1`).

**Constraints.**
- `2 ≤ n ≤ 2000`, `m ≤ 5000` (naive `O(E·V)` must pass).
- Weights are 32-bit; graph connected.

**Hint.** For each non-tree edge, BFS/DFS the MST from `u` to `v` recording the two largest distinct edge weights on the path. Remember the `w == max → 0` branch.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

type Edge struct{ u, v, w int }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	edges := make([]Edge, m)
	for i := range edges {
		fmt.Fscan(in, &edges[i].u, &edges[i].v, &edges[i].w)
	}
	_ = sort.Slice
	// TODO: Kruskal -> inMST, mstW, adjacency.
	// TODO: for each non-tree edge, walk path for (max, secondMax).
	// TODO: apply three-branch rule, track best delta, print mstW+best or -1.
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        int[][] edges = new int[m][3];
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            for (int j = 0; j < 3; j++) edges[i][j] = Integer.parseInt(st.nextToken());
        }
        // TODO: Kruskal, then naive path walk for (max, secondMax) per non-tree edge.
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    edges = []
    for _ in range(m):
        edges.append((int(data[p]), int(data[p+1]), int(data[p+2])))
        p += 3
    # TODO: Kruskal -> in_mst, mst_w, adjacency
    # TODO: naive path walk per non-tree edge -> (max, second_max)
    # TODO: three-branch delta, print mst_w + best or -1
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Matches a brute-force enumerator on small graphs, including tie-heavy ones.
- Returns `-1` for a tree input.
- Returns MST weight (delta 0) when multiple MSTs exist.

---

### Task 4 — Detect whether the MST is unique

**Problem.** Given a connected weighted graph, print `UNIQUE` if it has exactly one MST, else `MULTIPLE`. Use the second-best machinery: the MST is non-unique iff some non-tree edge's weight equals its path-maximum (`delta = 0`).

**Input / Output spec.** Same input as Task 1; output `UNIQUE` or `MULTIPLE`.

**Constraints.**
- `2 ≤ n ≤ 2000`, `m ≤ 5000` (naive path walk acceptable).

**Hint.** Build the MST; for each non-tree edge compute the path-max; if any non-tree edge has `w == pathMax`, the MST is not unique.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ u, v, w int }
	edges := make([]E, m)
	for i := range edges {
		fmt.Fscan(in, &edges[i].u, &edges[i].v, &edges[i].w)
	}
	// TODO: Kruskal; for each non-tree edge compute pathMax.
	// TODO: if any non-tree w == pathMax -> MULTIPLE, else UNIQUE.
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        int[][] edges = new int[m][3];
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            for (int j = 0; j < 3; j++) edges[i][j] = Integer.parseInt(st.nextToken());
        }
        // TODO: Kruskal, pathMax per non-tree edge; print UNIQUE / MULTIPLE
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    edges = []
    for _ in range(m):
        edges.append((int(data[p]), int(data[p+1]), int(data[p+2])))
        p += 3
    # TODO: Kruskal; if any non-tree edge w == its path-max -> MULTIPLE else UNIQUE
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Agrees with a brute-force MST counter on small graphs.
- All-distinct-weight graphs report `UNIQUE`.
- Graphs with a duplicate-weight cycle report `MULTIPLE`.

---

### Task 5 — Best swap for a specific lost link

**Problem.** Given a connected graph and a designated **tree** edge `f = (a, b)` (guaranteed to be in the MST), compute the cheapest spanning tree that does *not* use `f`. That is the MST minus `f` plus the lightest non-tree edge whose fundamental cycle covers `f`. Print that weight, or `-1` if removing `f` disconnects the graph.

**Input / Output spec.**
- Same graph input as Task 1, then a final line `a b` identifying the lost tree edge.
- Output: the cheapest spanning weight avoiding `f`, or `-1`.

**Constraints.**
- `2 ≤ n ≤ 2000`, `m ≤ 5000`.

**Hint.** Removing `f` splits the MST into two components; the cheapest reconnection is the minimum-weight non-tree edge with one endpoint in each component. Find the components via BFS on the MST without `f`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ u, v, w int }
	edges := make([]E, m)
	for i := range edges {
		fmt.Fscan(in, &edges[i].u, &edges[i].v, &edges[i].w)
	}
	var a, b int
	fmt.Fscan(in, &a, &b)
	// TODO: Kruskal -> mstW, tree adjacency.
	// TODO: remove edge (a,b) from the tree, BFS to 2-color components.
	// TODO: min non-tree edge crossing the cut; print mstW - w(f) + minCross or -1.
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        int[][] edges = new int[m][3];
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            for (int j = 0; j < 3; j++) edges[i][j] = Integer.parseInt(st.nextToken());
        }
        st = new StringTokenizer(br.readLine());
        int a = Integer.parseInt(st.nextToken());
        int b = Integer.parseInt(st.nextToken());
        // TODO: Kruskal; cut MST at (a,b); 2-color; min crossing non-tree edge.
    }
}
```

**Starter — Python.**
```python
import sys
from collections import deque

def main():
    data = sys.stdin.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    edges = []
    for _ in range(m):
        edges.append((int(data[p]), int(data[p+1]), int(data[p+2])))
        p += 3
    a, b = int(data[p]), int(data[p+1])
    # TODO: Kruskal; remove (a,b); BFS-color components; min crossing edge
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on a path graph where `f` is the only bridge between halves.
- Returns `-1` when `f` is a bridge of the whole graph (no reconnection).
- Matches "rebuild MST without `f`" on random graphs.

---

## Intermediate Tasks (5)

### Task 6 — Second-best MST with LCA binary lifting

**Problem.** Re-solve Task 3 but at scale: build the MST, then answer all path-max (and second-max) queries with LCA binary lifting in `O(log V)`. Print the second-best weight or `-1`.

**Input / Output spec.** Same as Task 1; output the second-best weight or `-1`.

**Constraints.**
- `2 ≤ n ≤ 10^5`, `m ≤ 2·10^5`. The naive `O(E·V)` will TLE; you must use LCA.

**Hint.** Store `up[k][v]`, `mx1[k][v]`, `mx2[k][v]`. Build the tree iteratively. Merge keeps the two largest *distinct* values.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

const NEG = -1 << 60

type Edge struct{ u, v, w int }

func merge(a1, a2, b1, b2 int) (int, int) {
	// TODO: return the two largest distinct values among the four
	return 0, 0
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	edges := make([]Edge, m)
	for i := range edges {
		fmt.Fscan(in, &edges[i].u, &edges[i].v, &edges[i].w)
	}
	_ = sort.Slice
	_ = NEG
	// TODO: Kruskal -> adjacency, inMST, mstW.
	// TODO: build LCA tables (up, mx1, mx2). Query each non-tree edge.
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    static final int NEG = Integer.MIN_VALUE / 4;
    static int[] merge(int a1, int a2, int b1, int b2) {
        // TODO: two largest distinct values
        return new int[]{0, 0};
    }
    public static void main(String[] args) throws IOException {
        // TODO: read graph, Kruskal, build LCA, scan non-tree edges
    }
}
```

**Starter — Python.**
```python
import sys

NEG = float("-inf")

def merge(a1, a2, b1, b2):
    # TODO: two largest distinct values among the four
    pass

def main():
    data = sys.stdin.buffer.read().split()
    # TODO: parse, Kruskal, build lifting tables, query non-tree edges
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output identical to Task 3 on shared inputs.
- Runs within time for `m = 2·10^5` (the naive version would not).
- Passes a tie-heavy fuzz test vs brute force.

---

### Task 7 — Report the actual swap edges

**Problem.** Extend Task 6: along with the second-best weight, print the entering non-tree edge `u v w` and the weight of the removed tree edge. If several swaps tie for the minimum delta, print the one whose entering edge has the smallest index.

**Input / Output spec.** Same input as Task 1; output two lines: the second-best weight, then `enteringU enteringV enteringW removedWeight`. If no second-best, print `-1`.

**Constraints.** `2 ≤ n ≤ 10^5`, `m ≤ 2·10^5`.

**Hint.** Track the winning edge index and the removed weight alongside the minimum delta; iterate edges in index order so ties resolve to the smallest index.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	// TODO: as Task 6, but also remember bestIdx and removedWeight for the min delta.
	_ = n
	_ = m
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task7 {
    public static void main(String[] args) throws IOException {
        // TODO: as Task 6, additionally track entering edge index + removed weight
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.buffer.read().split()
    # TODO: as Task 6, track (best_delta, entering_index, removed_weight)
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- The reported swap reconstructs a tree whose weight equals the printed second-best.
- Tie-break by smallest entering-edge index is respected.
- `-1` for tree-only inputs.

---

### Task 8 — Critical and pseudo-critical MST edges

**Problem.** Given a connected graph with indexed edges, output the indices of all critical edges (in every MST) and all pseudo-critical edges (in some MST but not all). Follow the same spec as LeetCode 1489.

**Input / Output spec.**
- `n m`, then `m` lines `u v w` (edge `i` is the `i`-th read).
- Output two lines: critical indices (ascending), then pseudo-critical indices (ascending).

**Constraints.**
- `2 ≤ n ≤ 100`, `m ≤ 200` (so `O(m²)` force-in/force-out is fine).

**Hint.** Base MST weight `B`. Edge is critical if forcing it out makes the MST weight `> B` (or disconnects). Else pseudo-critical if forcing it in keeps weight `= B`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ u, v, w, id int }
	edges := make([]E, m)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &edges[i].u, &edges[i].v, &edges[i].w)
		edges[i].id = i
	}
	sort.Slice(edges, func(a, b int) bool { return edges[a].w < edges[b].w })
	// TODO: mstWeight(skip, force) helper; classify each original edge id.
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    public static void main(String[] args) throws IOException {
        // TODO: read graph; sort; mstWeight(skip, force); classify.
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.read().split()
    # TODO: read; sort; mst_weight(skip, force); classify each edge id
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Matches a brute-force "in every / some MST" enumerator on small graphs.
- Output indices are sorted ascending.
- Handles ties (the whole point of the problem).

---

### Task 9 — Edge-weight tolerance ranges

**Problem.** For each MST (tree) edge `f`, compute how much its weight could *increase* before the MST changes: that is the smallest non-tree-edge weight among edges whose fundamental cycle covers `f`, minus `w(f)` (or `+∞` if no such edge). For each non-tree edge `e`, compute how much its weight could *decrease* before it enters the MST: `w(e) − pathMax(e)`. Print both tables.

**Input / Output spec.**
- Same graph input as Task 1.
- Output: for each tree edge, `u v w tolerance`; for each non-tree edge, `u v w slack`.

**Constraints.**
- `2 ≤ n ≤ 2000`, `m ≤ 5000` (naive acceptable; LCA optional for credit).

**Hint.** A non-tree edge `e` covering a path "tightens" every tree edge on that path: tree edge `f`'s tolerance is `min over covering e of w(e) − w(f)`. Sweep non-tree edges; for each, update the min covering weight of every tree edge on its path.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	// TODO: Kruskal; for non-tree edges, sweep their paths to set tree-edge tolerances.
	// TODO: for each non-tree edge slack = w - pathMax.
	_ = n
	_ = m
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    public static void main(String[] args) throws IOException {
        // TODO: Kruskal; compute tree-edge tolerances and non-tree slacks
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.read().split()
    # TODO: Kruskal; tolerances via covering sweep; slacks via path-max
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- A tree edge with tolerance `t`: increasing its weight by `< t` keeps the same MST; by `> t` changes it (verify by re-running Kruskal with the perturbed weight).
- Non-tree slack `s`: decreasing `w(e)` by `> s` makes `e` enter the MST.
- Edges with no covering non-tree edge report `+∞` tolerance.

---

### Task 10 — Stress test against brute force

**Problem.** Write a fuzzer: generate random small connected graphs (`n ≤ 7`) with integer weights in a tiny range (to force ties), compute the second-best weight with both a brute-force enumerator (all `C(m, n−1)` subsets) and your fast LCA solution, and assert they agree over thousands of trials. Report the number of trials and any mismatches.

**Input / Output spec.**
- No stdin; the program self-generates inputs from a fixed seed.
- Output: `tested <count> fails <count>` and the first few failing graphs if any.

**Constraints.**
- `n ∈ [3, 7]`, weights in `[1, 6]`, at least `5000` trials.

**Hint.** The brute-force second-best is: enumerate spanning-tree weights; if the minimum weight occurs `≥ 2` times the answer equals the MST weight, else it is the next distinct weight. This is the exact oracle that catches the equal-weight bug.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func bruteSecondBest(n int, edges [][3]int) int {
	// TODO: enumerate all (n-1)-subsets, keep spanning trees, derive second-best
	return 0
}

func fastSecondBest(n int, edges [][3]int) int {
	// TODO: your Task 6 solution adapted to this signature
	return 0
}

func main() {
	r := rand.New(rand.NewSource(1))
	tested, fails := 0, 0
	for t := 0; t < 5000; t++ {
		_ = r
		// TODO: build a random connected graph, compare brute vs fast
	}
	fmt.Printf("tested %d fails %d\n", tested, fails)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    public static void main(String[] args) {
        Random r = new Random(1);
        int tested = 0, fails = 0;
        for (int t = 0; t < 5000; t++) {
            // TODO: random connected graph; compare brute vs fast second-best
        }
        System.out.println("tested " + tested + " fails " + fails);
    }
}
```

**Starter — Python.**
```python
import itertools, random

def brute_second_best(n, edges):
    # TODO: enumerate spanning trees; if min weight repeats -> equals MST else next distinct
    pass

def fast_second_best(n, edges):
    # TODO: Task 6 solution
    pass

def main():
    random.seed(1)
    tested = fails = 0
    for _ in range(5000):
        # TODO: random connected graph; compare
        pass
    print(f"tested {tested} fails {fails}")

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `fails == 0` across all trials.
- The fuzzer actually exercises ties (verify it generates graphs where second-best equals MST).
- Removing the equal-weight branch from the fast solution makes the fuzzer report failures (proves the test has teeth).

---

## Advanced Tasks (5)

### Task 11 — Second-best MST with heavy-light decomposition

**Problem.** Solve the second-best MST, but compute path-maxima with heavy-light decomposition over a segment tree instead of binary lifting. This prepares you for the dynamic variant in Task 13.

**Constraints.** `2 ≤ n ≤ 10^5`, `m ≤ 2·10^5`. Per-query `O(log² V)` is acceptable.

**Hint.** Put edge weights on the child endpoint. HLD decomposes the path into `O(log V)` chains; query the max over each chain's segment-tree range. See sibling **14-heavy-light-decomposition**.

**Starter — Go.**
```go
package main

// TODO: HLD with segment tree storing edge weights on child nodes.
// TODO: pathMax(u, v) climbing chains; then the standard non-tree-edge scan.
func main() {}
```

**Starter — Java.**
```java
public class Task11 {
    // TODO: HLD + segment tree path-max; second-best scan.
    public static void main(String[] args) {}
}
```

**Starter — Python.**
```python
# TODO: HLD + iterative segment tree for path-max; second-best scan.
def main():
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output matches the binary-lifting solution (Task 6) on shared inputs.
- Path decomposition uses `O(log V)` chains per query.
- For first-max only this is enough; extend the segment tree node to carry (max, second-max) for full correctness on ties.

---

### Task 12 — Per-link backup table for the whole MST

**Problem.** For every tree edge `f`, compute the cheapest spanning tree that avoids `f` (the backup cost from Task 5, but for all tree edges at once and efficiently). Print, for each tree edge, `u v w backupWeight` (or `-1` if `f` is a bridge of the graph).

**Constraints.** `2 ≤ n ≤ 10^5`, `m ≤ 2·10^5`. Aim for near-linear via a covering sweep, not `O(V)` per edge.

**Hint.** Sweep non-tree edges in increasing weight. Each covers a tree path; assign it as the backup of every still-unassigned tree edge on that path, using a union-find "jump to the next unassigned tree edge toward the LCA" trick so each tree edge is assigned exactly once.

**Starter — Go.**
```go
package main

// TODO: Kruskal; LCA for path endpoints; DSU "skip assigned" pointer-jumping
// to assign each tree edge its lightest covering non-tree edge in near-linear time.
func main() {}
```

**Starter — Java.**
```java
public class Task12 {
    // TODO: covering sweep with DSU skip-pointers for per-link backups.
    public static void main(String[] args) {}
}
```

**Starter — Python.**
```python
# TODO: covering sweep + DSU skip pointers; per-link backup table.
def main():
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each tree edge's backup matches a direct "remove `f`, find min crossing edge" check.
- Bridges report `-1`.
- Total time is near-linear (each tree edge assigned once), verified by timing on `m = 2·10^5`.

---

### Task 13 — Online weight updates with HLD

**Problem.** Support a mix of operations on a fixed-topology graph whose MST you maintain conceptually via path-max queries: (1) update the weight of an existing edge, (2) query the current second-best MST weight. Use HLD + segment tree so each update is `O(log² V)`; recompute the second-best contribution lazily for affected non-tree edges.

**Constraints.** `2 ≤ n ≤ 5·10^4`, total operations `≤ 10^5`. Topology does not change; only weights do.

**Hint.** Maintain the MST and the HLD path-max structure. On a weight change, only swaps through paths touching the changed edge can flip; recompute the global second-best by re-scanning affected non-tree edges (or, for full credit, maintain a multiset of per-edge deltas keyed by edge and update incrementally).

**Starter — Go.**
```go
package main

// TODO: HLD path-max with point updates; maintain min swap delta under updates.
func main() {}
```

**Starter — Java.**
```java
public class Task13 {
    // TODO: HLD + segment tree updates; incremental second-best.
    public static void main(String[] args) {}
}
```

**Starter — Python.**
```python
# TODO: HLD updates; recompute/maintain second-best across operations.
def main():
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each query matches a from-scratch recomputation at that moment.
- Updates are `O(log² V)`; queries within budget.
- Correct under interleaved updates and queries (stress vs naive recompute).

---

### Task 14 — k smallest spanning tree weights

**Problem.** Output the weights of the `k` smallest spanning trees in nondecreasing order (with multiplicity). For `k = 2` this is MST then second-best; for larger `k` use Eppstein/Gabow branching: a priority queue of constrained subproblems, each expanded by its best constrained swap.

**Constraints.** `2 ≤ n ≤ 50`, `m ≤ 200`, `k ≤ 100`. Correctness over speed at this size.

**Hint.** A subproblem fixes some edges "in" and some "out." Its best tree is the constrained MST; its best swap is the minimum-delta swap respecting the constraints (path-max over removable edges only). Pop the cheapest, emit it, and branch on the swap edge.

**Starter — Go.**
```go
package main

// TODO: constrained MST + best swap; priority queue of subproblems; pop k times.
func main() {}
```

**Starter — Java.**
```java
public class Task14 {
    // TODO: Eppstein/Gabow branching for k-best spanning trees.
    public static void main(String[] args) {}
}
```

**Starter — Python.**
```python
# TODO: branching over (forced-in, forced-out) subproblems; k smallest weights.
def main():
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- For `k = 1, 2` matches MST and second-best exactly.
- The emitted sequence is nondecreasing.
- Matches a brute-force "sort all spanning-tree weights, take first k" on tiny graphs.

---

### Task 15 — Count distinct second-best spanning trees

**Problem.** Given a connected graph, count how many *distinct* spanning trees achieve the second-best weight. (When the MST is non-unique, "second-best weight" equals the MST weight, and you count distinct minimum trees minus the one designated MST — define and document your convention.)

**Constraints.** `2 ≤ n ≤ 12`, `m ≤ 30`. Brute force or careful combinatorics.

**Hint.** For small `n`, enumerate spanning trees (or use Kirchhoff's theorem to count, see sibling **24-kirchhoff-theorem**), bucket by weight, and report the count at the second-best weight. State clearly whether two trees that differ only by an equal-weight edge identity count as distinct.

**Starter — Go.**
```go
package main

// TODO: enumerate spanning trees; bucket by weight; count at second-best weight.
func main() {}
```

**Starter — Java.**
```java
public class Task15 {
    // TODO: enumerate / count spanning trees by weight; report second-best count.
    public static void main(String[] args) {}
}
```

**Starter — Python.**
```python
# TODO: enumerate spanning trees by weight; count those at the second-best weight.
def main():
    pass

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Agrees with a hand count on small graphs.
- The distinctness convention is documented and consistent.
- Handles the non-unique-MST case explicitly.

---

## Benchmark Task — Naive vs LCA path-max

**Problem.** Benchmark two second-best-MST implementations on random connected graphs of increasing size:
- **(a) Naive:** path walk per non-tree edge, `O(E·V)`.
- **(b) LCA:** binary lifting, `O((V+E) log V)`.

Generate a connected graph (a random spanning path plus random extra edges), build it once, and time only the second-best computation (exclude graph generation and MST build if you wish, but be consistent). Report mean time over at least 5 runs per size. Use the same seed across languages so inputs match.

**Sizes to test.** `(V, E) ∈ {(1000, 5000), (5000, 20000), (20000, 80000), (50000, 200000)}`. The naive method may be skipped for the largest size if it would exceed a few minutes — note that in your report.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func genGraph(n, m int, seed int64) [][3]int {
	r := rand.New(rand.NewSource(seed))
	edges := make([][3]int, 0, m)
	for i := 0; i < n-1; i++ {
		edges = append(edges, [3]int{i, i + 1, 1 + r.Intn(1000)})
	}
	for len(edges) < m {
		u, v := r.Intn(n), r.Intn(n)
		if u != v {
			edges = append(edges, [3]int{u, v, 1 + r.Intn(1000)})
		}
	}
	return edges
}

func naiveSecondBest(n int, edges [][3]int) int  { /* TODO */ return 0 }
func lcaSecondBest(n int, edges [][3]int) int    { /* TODO */ return 0 }

func timeIt(f func() int) float64 {
	start := time.Now()
	f()
	return float64(time.Since(start).Microseconds()) / 1000.0
}

func main() {
	type sz struct{ v, e int }
	sizes := []sz{{1000, 5000}, {5000, 20000}, {20000, 80000}, {50000, 200000}}
	fmt.Println("V        E         naive_ms      lca_ms")
	for _, s := range sizes {
		edges := genGraph(s.v, s.e, 42)
		// TODO: average over >=5 runs; skip naive for the largest if too slow
		_ = edges
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Benchmark {
    static int[][] genGraph(int n, int m, long seed) {
        Random r = new Random(seed);
        List<int[]> es = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) es.add(new int[]{i, i + 1, 1 + r.nextInt(1000)});
        while (es.size() < m) {
            int u = r.nextInt(n), v = r.nextInt(n);
            if (u != v) es.add(new int[]{u, v, 1 + r.nextInt(1000)});
        }
        return es.toArray(new int[0][]);
    }

    static int naiveSecondBest(int n, int[][] edges) { /* TODO */ return 0; }
    static int lcaSecondBest(int n, int[][] edges)   { /* TODO */ return 0; }

    public static void main(String[] args) {
        int[][] sizes = {{1000, 5000}, {5000, 20000}, {20000, 80000}, {50000, 200000}};
        System.out.println("V        E         naive_ms      lca_ms");
        for (int[] s : sizes) {
            int[][] edges = genGraph(s[0], s[1], 42);
            // TODO: average over >=5 runs; print row; skip naive for largest if slow
        }
    }
}
```

**Starter — Python.**
```python
import random, time
from typing import List, Tuple

def gen_graph(n: int, m: int, seed: int) -> List[Tuple[int, int, int]]:
    r = random.Random(seed)
    edges = [(i, i + 1, 1 + r.randrange(1000)) for i in range(n - 1)]
    while len(edges) < m:
        u, v = r.randrange(n), r.randrange(n)
        if u != v:
            edges.append((u, v, 1 + r.randrange(1000)))
    return edges

def naive_second_best(n, edges) -> int:
    # TODO: O(E*V) path walk
    return 0

def lca_second_best(n, edges) -> int:
    # TODO: O((V+E) log V) binary lifting
    return 0

def time_it(fn) -> float:
    t = time.perf_counter()
    fn()
    return (time.perf_counter() - t) * 1000.0

def main():
    sizes = [(1000, 5000), (5000, 20000), (20000, 80000), (50000, 200000)]
    print("V        E         naive_ms      lca_ms")
    for v, e in sizes:
        edges = gen_graph(v, e, 42)
        # TODO: average >=5 runs; skip naive for the largest if too slow
        _ = edges

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Both methods produce the **same** second-best weight on every size (correctness gate before timing).
- The LCA method scales smoothly; the naive method grows roughly with `E·V` and becomes impractical by `(20000, 80000)`.
- Same seed yields the same graph across languages (verify by printing the MST weight).
- Report mean over ≥ 5 runs, excluding graph generation from the timed region.
- Writeup: at which size does naive cross 1 second, and which language showed the widest naive/LCA gap, and why (interpreter overhead vs constant factors).
