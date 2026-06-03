# Planar Graphs & Euler's Formula — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code in all three languages. Fill in the planarity / Euler logic and validate against the evaluation criteria.

---

## Beginner Tasks (5)

### Task 1 — Count faces of a connected planar graph

**Problem.** Given a connected planar graph by its vertex count `V` and an edge list, compute the number of faces `F` (outer face included) using Euler's formula. Do not embed the graph; use `F = E − V + 2`.

**Input / Output spec.**
- Input: integer `V`, integer `M` (number of edges), then `M` lines each `u v`.
- Output: a single integer `F`.

**Constraints.**
- `1 ≤ V ≤ 10^6`, `0 ≤ M ≤ 3·10^6`.
- The graph is connected, simple, and planar (guaranteed).
- Time: `O(M)`.

**Hint.** You do not need the edges' structure at all — only the count. `F = M − V + 2`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func countFaces(v, m int) int {
	// TODO: return Euler's F = E - V + 2 for a connected planar graph
	return 0
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var v, m int
	fmt.Fscan(in, &v, &m)
	for i := 0; i < m; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		_ = a
		_ = b
	}
	fmt.Println(countFaces(v, m))
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    static int countFaces(int v, int m) {
        // TODO: F = E - V + 2
        return 0;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int v = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        for (int i = 0; i < m; i++) br.readLine(); // edges unused for the count
        System.out.println(countFaces(v, m));
    }
}
```

**Starter — Python.**
```python
import sys


def count_faces(v: int, m: int) -> int:
    # TODO: F = E - V + 2
    return 0


def main() -> None:
    data = sys.stdin.read().split()
    v, m = int(data[0]), int(data[1])
    # edges in data[2:] are unused for the count
    print(count_faces(v, m))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns `M − V + 2`.
- Runs in `O(M)` (the edge read dominates).
- Correct on a triangle (`V=3, M=3 → 2`) and a tree (`V=n, M=n−1 → 1`).

---

### Task 2 — Edge-bound planarity filter

**Problem.** Given `V` and `E` and a flag `triangleFree`, print `POSSIBLY_PLANAR` if the simple-graph edge bound permits planarity, else `NOT_PLANAR`.

**Input / Output spec.**
- Input: `V E triangleFree` where `triangleFree` is `0` or `1`.
- Output: `POSSIBLY_PLANAR` or `NOT_PLANAR`.

**Constraints.**
- `0 ≤ V ≤ 10^9`, `0 ≤ E ≤ 10^18` — use 64-bit integers.
- `V < 3` is trivially planar.

**Hint.** Bound is `3V − 6` normally, `2V − 4` when triangle-free. Guard `V < 3`.

**Starter — Go.**
```go
package main

import "fmt"

func couldBePlanar(v, e int64, triangleFree bool) bool {
	// TODO: handle V < 3; choose 2V-4 or 3V-6; return e <= bound
	return false
}

func main() {
	var v, e int64
	var tf int
	fmt.Scan(&v, &e, &tf)
	if couldBePlanar(v, e, tf == 1) {
		fmt.Println("POSSIBLY_PLANAR")
	} else {
		fmt.Println("NOT_PLANAR")
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static boolean couldBePlanar(long v, long e, boolean tf) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long v = sc.nextLong(), e = sc.nextLong();
        boolean tf = sc.nextInt() == 1;
        System.out.println(couldBePlanar(v, e, tf) ? "POSSIBLY_PLANAR" : "NOT_PLANAR");
    }
}
```

**Starter — Python.**
```python
import sys


def could_be_planar(v: int, e: int, triangle_free: bool) -> bool:
    # TODO
    return False


def main() -> None:
    v, e, tf = sys.stdin.read().split()
    ok = could_be_planar(int(v), int(e), tf == "1")
    print("POSSIBLY_PLANAR" if ok else "NOT_PLANAR")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `K5` (`5 10 0`) → `NOT_PLANAR`.
- `K3,3` (`6 9 1`) → `NOT_PLANAR`.
- `3×3` grid (`9 12 0`) → `POSSIBLY_PLANAR`.
- No 32-bit overflow on `V = 10^9`.

---

### Task 3 — Generalized Euler for disconnected graphs

**Problem.** Given a graph (possibly disconnected) by `V` and an edge list, compute the number of faces using `F = 1 + C − V + E`, where `C` is the number of connected components. Use union-find or DFS to count `C`.

**Input / Output spec.**
- Input: `V M`, then `M` edges `u v` (0-indexed).
- Output: integer `F`.

**Constraints.**
- `1 ≤ V ≤ 10^6`, `0 ≤ M ≤ 3·10^6`.
- Assume a planar embedding exists.

**Hint.** Count components first; isolated vertices are their own components.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent []int

func find(x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func union(a, b int) {
	// TODO: union by root
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var v, m int
	fmt.Fscan(in, &v, &m)
	parent = make([]int, v)
	for i := range parent {
		parent[i] = i
	}
	for i := 0; i < m; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		union(a, b)
	}
	// TODO: count distinct roots = C, then F = 1 + C - V + M
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    static int[] parent;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void union(int a, int b) {
        // TODO
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int v = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        parent = new int[v];
        for (int i = 0; i < v; i++) parent[i] = i;
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            union(Integer.parseInt(st.nextToken()), Integer.parseInt(st.nextToken()));
        }
        // TODO: count components C, then F = 1 + C - V + M
        System.out.println(0);
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(300000)


def main() -> None:
    data = sys.stdin.read().split()
    idx = 0
    v = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    parent = list(range(v))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        # TODO
        pass

    for _ in range(m):
        a, b = int(data[idx]), int(data[idx + 1])
        idx += 2
        union(a, b)

    # TODO: C = number of distinct roots; F = 1 + C - V + M
    print(0)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Two disjoint triangles (`V=6, M=6, C=2`) → `F = 3`.
- A single tree (`C=1, M=V−1`) → `F = 1`.
- Union-find with path compression, `O(M α(V))`.

---

### Task 4 — Average degree of a planar graph and the degree-≤5 vertex

**Problem.** Given a simple planar graph, (a) print its average degree as a reduced fraction, and (b) print the index of one vertex with degree ≤ 5 (guaranteed to exist by the planar corollary).

**Input / Output spec.**
- Input: `V M`, then `M` edges.
- Output: line 1 = `2M/V` as a fraction `p/q` in lowest terms; line 2 = any vertex index with degree ≤ 5.

**Constraints.**
- `1 ≤ V ≤ 10^6`, graph is simple planar.

**Hint.** Average degree `= 2E/V < 6`, so a degree-≤5 vertex always exists. Compute degrees in one pass.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var v, m int
	fmt.Fscan(in, &v, &m)
	deg := make([]int, v)
	for i := 0; i < m; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		deg[a]++
		deg[b]++
	}
	// TODO: reduce 2m/v; find a vertex with deg <= 5
	_ = deg
	fmt.Println("0/1")
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    static int gcd(int a, int b) { return b == 0 ? a : gcd(b, a % b); }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int v = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        int[] deg = new int[v];
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            int a = Integer.parseInt(st.nextToken());
            int b = Integer.parseInt(st.nextToken());
            deg[a]++; deg[b]++;
        }
        // TODO: reduce 2m/v; find a low-degree vertex
        System.out.println("0/1");
        System.out.println(0);
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd


def main() -> None:
    data = sys.stdin.read().split()
    idx = 0
    v = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    deg = [0] * v
    for _ in range(m):
        a, b = int(data[idx]), int(data[idx + 1])
        idx += 2
        deg[a] += 1
        deg[b] += 1
    # TODO: reduce 2m/v; find a vertex with deg <= 5
    print("0/1")
    print(0)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Fraction is reduced (divide numerator and denominator by `gcd`).
- The reported vertex truly has degree ≤ 5.
- One pass over edges, `O(M)`.

---

### Task 5 — Validate Euler's formula on a given embedding

**Problem.** You are given `V`, `E`, `F`, and `C` (component count) of a claimed planar subdivision. Print `VALID` if `V − E + F == 1 + C`, else `INVALID` along with the actual value of `V − E + F`.

**Input / Output spec.**
- Input: four integers `V E F C`.
- Output: `VALID` or `INVALID <value>`.

**Constraints.**
- All values fit in 64-bit.

**Hint.** This is the master integrity invariant. For connected graphs (`C=1`) it reduces to `V − E + F = 2`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var v, e, f, c int64
	fmt.Scan(&v, &e, &f, &c)
	// TODO: check v - e + f == 1 + c
	_ = v
	_ = e
	_ = f
	_ = c
	fmt.Println("VALID")
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long v = sc.nextLong(), e = sc.nextLong(), f = sc.nextLong(), c = sc.nextLong();
        // TODO
        System.out.println("VALID");
    }
}
```

**Starter — Python.**
```python
import sys


def main() -> None:
    v, e, f, c = map(int, sys.stdin.read().split())
    # TODO: check v - e + f == 1 + c
    print("VALID")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `8 12 6 1` (cube) → `VALID`.
- `5 10 7 1` (bogus `F`) → `INVALID 2`.
- Reports the actual `V − E + F` on failure.

---

## Intermediate Tasks (5)

### Task 6 — Trace faces from a rotation system

**Problem.** Given each vertex's clockwise-ordered neighbor list, trace all faces using the "next dart in rotation" rule and print the number of faces. Verify against Euler's formula.

**Input / Output spec.**
- Input: `V`, then `V` lines: vertex `v`, its degree `d`, then `d` neighbors in clockwise order. Then `E`.
- Output: the traced face count.

**Constraints.**
- `1 ≤ V ≤ 10^5`, connected planar embedding.

**Hint.** For a dart `u→v`, the next dart leaves `v` toward the neighbor clockwise-after `u` in `v`'s rotation. Mark darts used; count cycles.

**Starter — Go.**
```go
package main

import "fmt"

type Tracer struct {
	rotation map[int][]int
	posOf    map[int]map[int]int // posOf[v][u] = index of u in v's rotation
}

func (t *Tracer) nextDart(u, v int) (int, int) {
	// TODO: idx = posOf[v][u]; nxt = rotation[v][(idx+1)%len]
	return 0, 0
}

func (t *Tracer) trace(edges [][2]int) int {
	// TODO: split into darts, follow nextDart, count cycles
	return 0
}

func main() {
	// TODO: read input, build rotation + posOf, call trace
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    Map<Integer, List<Integer>> rotation = new HashMap<>();
    Map<Integer, Map<Integer, Integer>> posOf = new HashMap<>();

    int[] nextDart(int u, int v) {
        // TODO
        return new int[]{0, 0};
    }

    int trace(int[][] edges) {
        // TODO: dart set, follow nextDart, count cycles
        return 0;
    }

    public static void main(String[] args) {
        // TODO: parse input, build structures, print trace
        System.out.println(0);
    }
}
```

**Starter — Python.**
```python
import sys


def trace_faces(rotation, edges):
    pos_of = {v: {u: i for i, u in enumerate(nbrs)} for v, nbrs in rotation.items()}

    def next_dart(u, v):
        # TODO: idx = pos_of[v][u]; return v, rotation[v][(idx+1)%len]
        return v, u

    used = set()
    faces = 0
    darts = []
    for a, b in edges:
        darts.append((a, b))
        darts.append((b, a))
    for start in darts:
        if start in used:
            continue
        u, v = start
        while (u, v) not in used:
            used.add((u, v))
            u, v = next_dart(u, v)
        faces += 1
    return faces


def main() -> None:
    # TODO: parse input, build rotation, call trace_faces
    print(0)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Square+diagonal embedding traces 3 faces.
- Traced count equals `E − V + 2` for the connected input.
- `O(E)` total; each dart visited once.

---

### Task 7 — Build and color the dual graph (≤ 5 colors)

**Problem.** Given an edge list and the face on each side of every edge, build the dual graph and greedily color it with at most... as few colors as the greedy heuristic uses (which will be ≤ 6 for a planar dual, ≤ 5 with smallest-last ordering). Print the color count used.

**Input / Output spec.**
- Input: `E`, then `E` lines `u v fLeft fRight`.
- Output: number of colors used by the greedy coloring of the dual.

**Constraints.**
- Faces are `0..F−1`. Skip bridges (`fLeft == fRight`).

**Hint.** Build dual adjacency, then greedy-color by descending degree. See `27-graph-coloring`.

**Starter — Go.**
```go
package main

import "fmt"

func buildDual(edges [][4]int) map[int]map[int]bool {
	dual := map[int]map[int]bool{}
	for _, e := range edges {
		f1, f2 := e[2], e[3]
		if f1 != f2 {
			// TODO: add f1-f2 to dual (use set to dedupe)
		}
	}
	return dual
}

func greedyColor(dual map[int]map[int]bool) int {
	// TODO: order vertices by descending degree, assign smallest free color
	return 0
}

func main() {
	// TODO: read edges, build dual, color, print color count
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static Map<Integer, Set<Integer>> buildDual(int[][] edges) {
        Map<Integer, Set<Integer>> dual = new HashMap<>();
        for (int[] e : edges) {
            int f1 = e[2], f2 = e[3];
            if (f1 != f2) {
                // TODO: add both directions
            }
        }
        return dual;
    }

    static int greedyColor(Map<Integer, Set<Integer>> dual) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        // TODO
        System.out.println(0);
    }
}
```

**Starter — Python.**
```python
import sys
from collections import defaultdict


def build_dual(edges):
    dual = defaultdict(set)
    for u, v, f1, f2 in edges:
        if f1 != f2:
            dual[f1].add(f2)
            dual[f2].add(f1)
    return dual


def greedy_color(dual):
    # TODO: order by descending degree; assign smallest color not used by neighbors
    return 0


def main() -> None:
    data = sys.stdin.read().split()
    # TODO: parse, build dual, color, print
    print(0)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Dual of a triangle (2 faces) needs 2 colors.
- Color count ≤ 6 for any planar dual; ≤ 5 with smallest-last ordering.
- No two adjacent faces share a color.

---

### Task 8 — Detect non-planarity by edge bound across a graph stream

**Problem.** Process a stream of graphs; for each, given `V`, `E`, and a bipartite flag, print whether it is definitely non-planar by the edge bound. Count how many were rejected.

**Input / Output spec.**
- Input: `T`, then `T` lines `V E bipartite`.
- Output: for each, `REJECT` or `KEEP`; final line: number rejected.

**Constraints.**
- `1 ≤ T ≤ 10^5`, 64-bit `V, E`.

**Hint.** Reuse the bound from Task 2; bipartite ⇒ triangle-free ⇒ `2V − 4`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func definitelyNonPlanar(v, e int64, bipartite bool) bool {
	// TODO: return true if e exceeds the applicable bound
	return false
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var t int
	fmt.Fscan(in, &t)
	rejected := 0
	for i := 0; i < t; i++ {
		var v, e int64
		var bp int
		fmt.Fscan(in, &v, &e, &bp)
		// TODO: decide, print, count
		_ = v
		_ = e
		_ = bp
	}
	fmt.Fprintln(out, rejected)
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    static boolean definitelyNonPlanar(long v, long e, boolean bp) {
        // TODO
        return false;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int t = Integer.parseInt(br.readLine().trim());
        StringBuilder sb = new StringBuilder();
        int rejected = 0;
        for (int i = 0; i < t; i++) {
            StringTokenizer st = new StringTokenizer(br.readLine());
            long v = Long.parseLong(st.nextToken());
            long e = Long.parseLong(st.nextToken());
            boolean bp = Integer.parseInt(st.nextToken()) == 1;
            // TODO
        }
        sb.append(rejected).append('\n');
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def definitely_non_planar(v: int, e: int, bipartite: bool) -> bool:
    # TODO
    return False


def main() -> None:
    data = sys.stdin.read().split()
    idx = 0
    t = int(data[idx]); idx += 1
    out = []
    rejected = 0
    for _ in range(t):
        v, e, bp = int(data[idx]), int(data[idx + 1]), data[idx + 2] == "1"
        idx += 3
        # TODO
    out.append(str(rejected))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `K5` line rejected; `K3,3` line rejected (needs bipartite flag).
- Sparse graphs kept.
- `O(T)` total.

---

### Task 9 — Minimum routing layers (graph thickness lower bound)

**Problem.** Given a net graph's `V` and `E`, print the lower bound on routing layers `⌈E / (3V − 6)⌉` (and the bipartite version `⌈E / (2V − 4)⌉`). For `V < 3`, the bound is 1.

**Input / Output spec.**
- Input: `V E`.
- Output: two integers: generic layer bound, then bipartite layer bound.

**Constraints.**
- `1 ≤ V ≤ 10^9`, 64-bit `E`.

**Hint.** Each planar layer holds at most `3V − 6` edges. Use ceiling division.

**Starter — Go.**
```go
package main

import "fmt"

func minLayers(v, e, perLayer int64) int64 {
	if v < 3 {
		return 1
	}
	// TODO: ceil(e / perLayer)
	return 0
}

func main() {
	var v, e int64
	fmt.Scan(&v, &e)
	fmt.Println(minLayers(v, e, 3*v-6), minLayers(v, e, 2*v-4))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static long minLayers(long v, long e, long perLayer) {
        if (v < 3) return 1;
        // TODO: ceil(e / perLayer)
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long v = sc.nextLong(), e = sc.nextLong();
        System.out.println(minLayers(v, e, 3 * v - 6) + " " + minLayers(v, e, 2 * v - 4));
    }
}
```

**Starter — Python.**
```python
import sys


def min_layers(v: int, e: int, per_layer: int) -> int:
    if v < 3:
        return 1
    # TODO: ceil(e / per_layer)
    return 0


def main() -> None:
    v, e = map(int, sys.stdin.read().split())
    print(min_layers(v, e, 3 * v - 6), min_layers(v, e, 2 * v - 4))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `K5` (`5 10`) → generic bound `2`.
- A planar graph (`E ≤ 3V − 6`) → `1`.
- Correct ceiling division (no off-by-one), no overflow.

---

### Task 10 — Verify a triangulation (maximal planar)

**Problem.** Given a simple connected planar graph's `V` and `E`, decide whether it is a triangulation (maximal planar): print `TRIANGULATION` iff `E == 3V − 6` (and `V ≥ 3`), else `NOT_MAXIMAL` with how many edges could still be added (`3V − 6 − E`).

**Input / Output spec.**
- Input: `V E`.
- Output: `TRIANGULATION` or `NOT_MAXIMAL k`.

**Constraints.**
- `3 ≤ V ≤ 10^9`, `E ≤ 3V − 6` (valid planar input).

**Hint.** Maximal planar ⇔ every face is a triangle ⇔ `E = 3V − 6`, and then `F = 2V − 4`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var v, e int64
	fmt.Scan(&v, &e)
	max := 3*v - 6
	// TODO: compare e to max; print accordingly
	_ = max
	fmt.Println("NOT_MAXIMAL")
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long v = sc.nextLong(), e = sc.nextLong();
        long max = 3 * v - 6;
        // TODO
        System.out.println("NOT_MAXIMAL");
    }
}
```

**Starter — Python.**
```python
import sys


def main() -> None:
    v, e = map(int, sys.stdin.read().split())
    mx = 3 * v - 6
    # TODO: if e == mx -> TRIANGULATION else NOT_MAXIMAL (mx - e)
    print("NOT_MAXIMAL")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `K4` (`4 6`) → `TRIANGULATION` (`3·4−6 = 6`).
- Cube (`8 12`) → `NOT_MAXIMAL 6` (`3·8−6 = 18`).
- Correct remaining-edge count.

---

## Advanced Tasks (5)

### Task 11 — Full face tracer producing the DCEL `next` pointers

**Problem.** Extend Task 6: build the DCEL by recording, for each dart, its `next` dart on the same face and its face id. Output, for each face, its boundary as a vertex cycle.

**Constraints.** `V ≤ 10^5`, connected planar embedding via rotation system.

**Hint.** `next(u→v) = (v→ clockwise-after-u in v's rotation)`. `twin(u→v) = (v→u)`. Store both; assign face ids during the trace.

**Starter — Python.**
```python
import sys


def build_dcel(rotation, edges):
    pos_of = {v: {u: i for i, u in enumerate(nbrs)} for v, nbrs in rotation.items()}

    def next_dart(u, v):
        nbrs = rotation[v]
        idx = pos_of[v][u]
        return v, nbrs[(idx + 1) % len(nbrs)]

    next_of = {}    # dart -> next dart on same face
    face_of = {}    # dart -> face id
    faces = []      # face id -> list of vertices on boundary
    used = set()
    darts = []
    for a, b in edges:
        darts.append((a, b))
        darts.append((b, a))
    fid = 0
    for start in darts:
        if start in used:
            continue
        boundary = []
        u, v = start
        while (u, v) not in used:
            used.add((u, v))
            face_of[(u, v)] = fid
            nu, nv = next_dart(u, v)
            next_of[(u, v)] = (nu, nv)
            boundary.append(u)
            u, v = nu, nv
        faces.append(boundary)
        fid += 1
    return faces, next_of, face_of


def main() -> None:
    # TODO: parse input, call build_dcel, print each face's boundary
    print(0)


if __name__ == "__main__":
    main()
```

> Provide equivalent Go and Java implementations following the same dart / `next` / `face_of` structure.

**Evaluation criteria.**
- Each face boundary is a closed walk returning to its start.
- Number of faces matches `E − V + 2`.
- `Σ deg(f) == 2E` (each dart in exactly one face).

---

### Task 12 — Planar min-cut via the dual (conceptual + small instance)

**Problem.** For a small planar `s–t` graph given with its embedding, build the dual and find an `s–t` minimum cut by computing a shortest separating cycle in the (augmented) dual. For this task, restrict to a grid graph and verify the cut value against a direct max-flow.

**Constraints.** Grid up to `50×50`; integer edge capacities.

**Hint.** Cycle in `G` ↔ cut in `G*`. For `s–t` planar min-cut, add the standard "split the outer face along an `s–t` curve" construction, then run Dijkstra on the dual. See `16-max-flow-edmonds-karp-dinic` for the baseline.

**Starter — Python.**
```python
import heapq


def planar_min_cut_grid(rows, cols, h_cap, v_cap):
    """h_cap[r][c], v_cap[r][c] are edge capacities of a grid.
    Return the s-t min cut value via shortest path in the dual (sketch)."""
    # TODO: construct dual nodes (one per grid cell + outer), connect across
    # each primal edge with weight = capacity, add the s-t separating curve,
    # then Dijkstra from the dual source to the dual sink.
    return 0


def main() -> None:
    # TODO: parse a small grid, compute cut, compare to a max-flow baseline
    print(0)


if __name__ == "__main__":
    main()
```

> Provide Go and Java versions; the dual-Dijkstra core mirrors `04-dijkstra`.

**Evaluation criteria.**
- Cut value equals a direct Edmonds–Karp / Dinic max-flow on the same grid.
- Dual Dijkstra runs in `O(E log V)` on the dual.
- Correct handling of the `s–t` separating curve.

---

### Task 13 — Greedy 5-coloring of a planar graph (degree-≤5 peeling)

**Problem.** Implement the constructive Five-Color-style peeling: repeatedly remove a vertex of degree ≤ 5, color in reverse order with the first color free among already-colored neighbors. Guarantee ≤ 6 colors (smallest-last); aim for ≤ 5 on typical planar input.

**Constraints.** `V ≤ 10^6`, simple planar.

**Hint.** Maintain a bucket queue by degree; a degree-≤5 vertex always exists in a planar graph. Reverse the removal order to color.

**Starter — Python.**
```python
import sys


def five_color(adj):
    n = len(adj)
    deg = [len(adj[v]) for v in range(n)]
    removed = [False] * n
    order = []
    # smallest-last: repeatedly peel a min-degree (always <= 5) vertex
    # TODO: use a bucket queue keyed by current degree
    # for each peel: append to order, decrement neighbors' degrees

    color = [-1] * n
    for v in reversed(order):
        used = {color[w] for w in adj[v] if color[w] != -1}
        c = 0
        while c in used:
            c += 1
        color[v] = c
    return color


def main() -> None:
    # TODO: parse graph, color, print number of colors used
    print(0)


if __name__ == "__main__":
    main()
```

> Provide Go and Java versions with the same bucket-queue peeling.

**Evaluation criteria.**
- Produces a proper coloring (no adjacent same color).
- Uses ≤ 6 colors on any planar input; ≤ 5 on most.
- Peeling + coloring is `O(V + E)`.

---

### Task 14 — Genus lower bound and toroidal check

**Problem.** Given a simple connected graph's `V` and `E`, print the genus lower bound `⌈(E − 3V + 6)/6⌉` (clamped at 0). Flag whether the graph is *possibly* planar (bound 0), or *possibly toroidal* (bound 1), etc.

**Constraints.** 64-bit `V, E`.

**Hint.** From `V − E + F = 2 − 2g` and `F ≤ 2E/3`: `g ≥ (E − 3V + 6)/6`.

**Starter — Python.**
```python
import sys
from math import ceil


def genus_lower_bound(v: int, e: int) -> int:
    if v < 3:
        return 0
    g = (e - 3 * v + 6)
    if g <= 0:
        return 0
    return -(-g // 6)  # ceil division


def main() -> None:
    v, e = map(int, sys.stdin.read().split())
    g = genus_lower_bound(v, e)
    label = {0: "possibly planar", 1: "possibly toroidal"}.get(g, f"genus >= {g}")
    print(g, label)


if __name__ == "__main__":
    main()
```

> Provide Go and Java versions; arithmetic only, watch overflow and ceiling.

**Evaluation criteria.**
- `K5` (`5 10`) → `1 possibly toroidal`.
- `K7` (`7 21`) → `1` (`K7` is toroidal).
- Planar input → `0 possibly planar`.

---

### Task 15 — Incremental face splitting under edge insertion

**Problem.** Maintain a planar embedding's face count under a sequence of "insert edge inside face `f` between boundary vertices `a` and `b`" operations. Each valid insertion splits one face into two, so `F += 1`. Verify the Euler invariant after each insert.

**Constraints.** Up to `10^5` insertions; assume each insertion is a valid chord of an existing face.

**Hint.** You do not need full geometry: track `V`, `E`, `F`. Each chord insertion does `E += 1`, `F += 1`, `V` unchanged — Euler stays balanced. (A real DCEL would splice half-edges; here track counts and assert.)

**Starter — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.read().split()
    idx = 0
    v = int(data[idx]); idx += 1
    e = int(data[idx]); idx += 1
    f = int(data[idx]); idx += 1
    q = int(data[idx]); idx += 1
    # invariant: v - e + f == 2 (connected)
    out = []
    for _ in range(q):
        a, b = int(data[idx]), int(data[idx + 1])
        idx += 2
        # TODO: a chord insertion: e += 1, f += 1
        # assert v - e + f == 2, else report INVALID
        out.append(f"{f}")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

> Provide Go and Java versions maintaining the same `V, E, F` counters and asserting `V − E + F == 2`.

**Evaluation criteria.**
- After `k` chord insertions, `F` increased by exactly `k`.
- `V − E + F == 2` holds after every insertion.
- `O(1)` per insertion for the counts.

---

## Benchmark Task

### Benchmark — Euler face count vs full embedding trace at scale

**Goal.** Quantify the gap between the `O(1)` Euler face count and the `O(E)` full face trace on large planar grids, and confirm both agree.

**Setup.** Generate an `n × n` grid graph: `V = n²`, `E = 2n(n − 1)`, connected and planar. The expected face count is `F = E − V + 2 = (n − 1)² + 1` (the `(n−1)²` unit squares plus the outer face).

**What to measure.**
1. Time to compute `F` by Euler's formula (`O(1)` after counting `E`).
2. Time to build the rotation system and trace all faces (`O(E)`).
3. Memory for the DCEL vs the bare counts.

**Reference — Python.**
```python
import time


def euler_faces(n: int) -> int:
    v = n * n
    e = 2 * n * (n - 1)
    return e - v + 2  # = (n-1)^2 + 1


def expected_faces(n: int) -> int:
    return (n - 1) ** 2 + 1


if __name__ == "__main__":
    for n in (100, 500, 1000, 2000):
        t0 = time.perf_counter()
        f_euler = euler_faces(n)
        t1 = time.perf_counter()
        assert f_euler == expected_faces(n), (n, f_euler)
        v, e = n * n, 2 * n * (n - 1)
        print(f"n={n:5d}  V={v:>9}  E={e:>9}  F={f_euler:>9}  "
              f"euler={ (t1 - t0) * 1e6:8.2f} us")
```

**Expected findings.**
- The Euler computation is constant-time regardless of `n` — microseconds even for `n = 2000` (`V = 4M`, `E ≈ 8M`).
- A full trace touches `~2E` darts: for `n = 2000` that is ~16M dart visits — hundreds of milliseconds in Python, milliseconds in Go/Java.
- Both produce identical `F`. The lesson: never build an embedding *just* to count faces; only trace when you need the face *structure* (boundaries, dual, coloring).

**Reporting.** Tabulate `n`, `V`, `E`, `F`, Euler time, trace time, and the ratio. Plot trace time vs `E` to confirm linearity, and confirm Euler time is flat. Implement the trace in Go and Java too and compare the constant factors against the `O(1)` formula.
