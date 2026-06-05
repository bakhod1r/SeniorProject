# Dominator Tree (Lengauer-Tarjan) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a problem statement, constraints, hints, and reference starter/solution code in all three languages. Recall the pipeline: **DFS numbering → semidominators → link-eval with path compression → correct `sdom` into `idom`**, with the iterative dataflow fixpoint as the simple oracle.

---

## Beginner Tasks (5)

### Task 1 — Dominators by brute force (definition oracle)

**Problem.** For a small flow graph (entry `r`), compute `idom[v]` for every vertex by directly applying the definition: `u` dominates `v` iff removing `u` makes `v` unreachable from `r`. This is your correctness oracle for all later tasks.

**Constraints.** `1 ≤ n ≤ 30`. Vertices `0..n-1`, all reachable from `r`. Time `O(n·(n+m))` (one reachability check per removed vertex).

**Hint.** For each vertex `u`, run a BFS/DFS from `r` with `u` deleted; any `v` that becomes unreachable is dominated by `u`. Then `idom(v)` is the strict dominator of `v` with the **largest** dominator set.

#### Go

```go
package main

import "fmt"

func bruteIdom(n int, succ [][]int, r int) []int {
	reach := func(block int) map[int]bool {
		seen := map[int]bool{}
		if r == block {
			return seen
		}
		stack := []int{r}
		seen[r] = true
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, v := range succ[u] {
				if v != block && !seen[v] {
					seen[v] = true
					stack = append(stack, v)
				}
			}
		}
		return seen
	}
	all := reach(-1)
	dom := make([]map[int]bool, n)
	for v := range dom {
		dom[v] = map[int]bool{}
	}
	for u := 0; u < n; u++ {
		without := reach(u)
		for v := range all {
			if v != u && !without[v] {
				dom[v][u] = true
			}
		}
	}
	idom := make([]int, n)
	for i := range idom {
		idom[i] = -1
	}
	idom[r] = r
	for v := range all {
		if v == r {
			continue
		}
		dom[v][v] = true
		best, bestSize := -1, -1
		for u := range dom[v] {
			if u != v && len(dom[u]) > bestSize {
				bestSize = len(dom[u])
				best = u
			}
		}
		idom[v] = best
	}
	return idom
}

func main() {
	succ := [][]int{{1, 2}, {3}, {3}, {4, 5}, {5}, {}}
	fmt.Println(bruteIdom(6, succ, 0)) // [0 0 0 0 3 3]
}
```

#### Java

```java
import java.util.*;

public class Task1 {
    static int n, r;
    static List<List<Integer>> succ;

    static Set<Integer> reach(int block) {
        Set<Integer> seen = new HashSet<>();
        if (r == block) return seen;
        Deque<Integer> st = new ArrayDeque<>(); st.push(r); seen.add(r);
        while (!st.isEmpty()) {
            int u = st.pop();
            for (int v : succ.get(u))
                if (v != block && seen.add(v)) st.push(v);
        }
        return seen;
    }

    static int[] bruteIdom() {
        Set<Integer> all = reach(-1);
        List<Set<Integer>> dom = new ArrayList<>();
        for (int i = 0; i < n; i++) dom.add(new HashSet<>());
        for (int u = 0; u < n; u++) {
            Set<Integer> without = reach(u);
            for (int v : all) if (v != u && !without.contains(v)) dom.get(v).add(u);
        }
        int[] idom = new int[n]; Arrays.fill(idom, -1); idom[r] = r;
        for (int v : all) {
            if (v == r) continue;
            dom.get(v).add(v);
            int best = -1, bestSize = -1;
            for (int u : dom.get(v))
                if (u != v && dom.get(u).size() > bestSize) { bestSize = dom.get(u).size(); best = u; }
            idom[v] = best;
        }
        return idom;
    }

    public static void main(String[] args) {
        n = 6; r = 0;
        succ = List.of(List.of(1,2), List.of(3), List.of(3), List.of(4,5), List.of(5), List.of());
        System.out.println(Arrays.toString(bruteIdom())); // [0, 0, 0, 0, 3, 3]
    }
}
```

#### Python

```python
def brute_idom(n, succ, r):
    def reach(block):
        if r == block:
            return set()
        seen, stack = {r}, [r]
        while stack:
            u = stack.pop()
            for v in succ[u]:
                if v != block and v not in seen:
                    seen.add(v)
                    stack.append(v)
        return seen

    all_ = reach(-1)
    dom = [set() for _ in range(n)]
    for u in range(n):
        without = reach(u)
        for v in all_:
            if v != u and v not in without:
                dom[v].add(u)
    idom = [-1] * n
    idom[r] = r
    for v in all_:
        if v == r:
            continue
        dom[v].add(v)
        strict = [u for u in dom[v] if u != v]
        idom[v] = max(strict, key=lambda u: len(dom[u]))
    return idom


if __name__ == "__main__":
    succ = [[1, 2], [3], [3], [4, 5], [5], []]
    print(brute_idom(6, succ, 0))  # [0, 0, 0, 0, 3, 3]
```

- **Evaluation:** correctness vs hand-computed `idom`, edge cases (single vertex, chain).

---

### Task 2 — Build the dominator tree from an `idom` array

**Problem.** Given `idom[]` (with `idom[r] = r`), produce `children[]`: for each vertex, the list of vertices whose immediate dominator it is. Print the tree as parent→children lines.

**Constraints.** `1 ≤ n ≤ 10⁵`. `O(n)` time and space.

**Hint.** For every `v ≠ r` with `idom[v] != -1`, append `v` to `children[idom[v]]`. Skip the root self-edge.

Provide starter code that reads `idom` and prints `children` in all three languages (Go slice append, Java `List`, Python list-of-lists).

- **Constraints:** do not add `r` as its own child; handle `idom[v] == -1` (unreachable) by skipping.

---

### Task 3 — Detect a back edge given the dominator tree

**Problem.** Given a CFG and its `idom[]`, identify all **back edges**: edges `t → h` where `h` dominates `t`. These are the loop-defining edges.

**Constraints.** `1 ≤ n ≤ 10⁵`. Preprocess for `O(1)` dominance, then scan edges in `O(E)`.

**Hint.** Euler-tour the dominator tree for in/out times; `h` dominates `t` iff `tin[h] ≤ tin[t] && tout[t] ≤ tout[h]`. An edge `t → h` is a back edge iff `h` dominates `t`.

Provide starter code that computes in/out times via an explicit-stack DFS of the dominator tree and tests each edge, in all three languages.

- **Expected Output:** for the running example plus edge `5 → 3`, the back edge is `(5, 3)` with header `3`.

---

### Task 4 — Print the dominator-tree depth of every vertex

**Problem.** Given `idom[]`, compute `depth[v]` = number of edges from `r` to `v` in the dominator tree (`depth[r] = 0`).

**Constraints.** `1 ≤ n ≤ 10⁵`. `O(n)` via a BFS/DFS of the dominator tree, or memoized walk up `idom`.

**Hint.** `depth[v] = depth[idom[v]] + 1` for `v ≠ r`. Compute in dominator-tree preorder, or memoize a walk up the `idom` chain.

Provide starter code in all three languages (recursive-with-memo or explicit BFS from `r` over `children[]`).

- **Evaluation:** correct depths, no recomputation (each vertex resolved once).

---

### Task 5 — Nearest common dominator of two vertices (naive)

**Problem.** Given `idom[]` and queries `(a, b)`, return the **nearest common dominator** — the lowest vertex in the dominator tree that dominates both `a` and `b` (their LCA in the dom tree).

**Constraints.** `1 ≤ n ≤ 10⁴`, up to `10⁴` queries. Naive walk is fine here: `O(depth)` per query.

**Hint.** Use the two-finger `intersect` from the iterative dataflow algorithm: bring the deeper vertex up by `idom` until depths match, then advance both until they meet. Use the `depth[]` from Task 4.

#### Go

```go
package main

import "fmt"

func ncd(a, b int, idom, depth []int) int {
	for depth[a] > depth[b] {
		a = idom[a]
	}
	for depth[b] > depth[a] {
		b = idom[b]
	}
	for a != b {
		a = idom[a]
		b = idom[b]
	}
	return a
}

func main() {
	idom := []int{0, 0, 0, 0, 3, 3}
	depth := []int{0, 1, 1, 1, 2, 2}
	fmt.Println(ncd(4, 5, idom, depth)) // 3
	fmt.Println(ncd(1, 5, idom, depth)) // 0
}
```

#### Java

```java
public class Task5 {
    static int ncd(int a, int b, int[] idom, int[] depth) {
        while (depth[a] > depth[b]) a = idom[a];
        while (depth[b] > depth[a]) b = idom[b];
        while (a != b) { a = idom[a]; b = idom[b]; }
        return a;
    }

    public static void main(String[] args) {
        int[] idom = {0, 0, 0, 0, 3, 3};
        int[] depth = {0, 1, 1, 1, 2, 2};
        System.out.println(ncd(4, 5, idom, depth)); // 3
        System.out.println(ncd(1, 5, idom, depth)); // 0
    }
}
```

#### Python

```python
def ncd(a, b, idom, depth):
    while depth[a] > depth[b]:
        a = idom[a]
    while depth[b] > depth[a]:
        b = idom[b]
    while a != b:
        a = idom[a]
        b = idom[b]
    return a


if __name__ == "__main__":
    idom = [0, 0, 0, 0, 3, 3]
    depth = [0, 1, 1, 1, 2, 2]
    print(ncd(4, 5, idom, depth))  # 3
    print(ncd(1, 5, idom, depth))  # 0
```

- **Evaluation:** correctness against brute LCA; terminate when `a == b`.

---

## Intermediate Tasks (5)

### Task 6 — Iterative dataflow dominators (Cooper-Harvey-Kennedy)

**Problem.** Implement the full iterative dataflow `idom` algorithm: reverse-postorder ordering, the `intersect` two-finger walk on RPO numbers, and the fixpoint loop. Return `idom[]`.

**Constraints.** `1 ≤ n ≤ 10⁵`. Process in reverse postorder; converge in a few sweeps for reducible graphs.

**Hint.** Compute a DFS postorder, reverse it for RPO, assign `rpoNum`. Initialize `idom[r] = r`, others `-1`. Repeatedly, for each `v ≠ r` in RPO, fold its processed predecessors with `intersect`. Mark `changed` only on an actual update.

Provide starter code in all three languages (the full implementation is in `junior.md`'s "Code Examples"; reproduce and test it here against the Task 1 oracle).

- **Evaluation:** matches the brute oracle; terminates; uses an explicit-stack DFS for postorder.

---

### Task 7 — Lengauer-Tarjan (simple, path compression)

**Problem.** Implement the simple `O(E log V)` Lengauer-Tarjan with DFS numbering, semidominators, and `EVAL`/`LINK` with path compression. Return `idom[]`.

**Constraints.** `1 ≤ n ≤ 2·10⁵`, `1 ≤ m ≤ 5·10⁵`. Use an explicit-stack DFS for large/deep graphs.

**Hint.** Follow the four phases. The bucket of `sdom(w)` is processed when you finish `w` and link it; finalize deferred `idom` in a forward pass: `if idom[w] != vertex[semi[w]]: idom[w] = idom[idom[w]]`.

Provide starter code in all three languages (the full implementation is in `middle.md` and `interview.md` Challenge 1; reproduce it and differential-test against Task 6).

- **Evaluation:** matches iterative dataflow on 1000+ random CFGs; handles a diamond and a nested loop.

---

### Task 8 — Dominance frontiers

**Problem.** Given a CFG and its `idom[]`, compute the **dominance frontier** `DF(u)` for every vertex `u` — the set of merge blocks where `u`'s dominance ends. Output `DF` as adjacency sets.

**Constraints.** `1 ≤ n ≤ 10⁵`. Use the Cooper-Harvey-Kennedy edge-walk method.

**Hint.** For each CFG edge `(a, b)` where `b` has ≥ 2 predecessors, walk `runner = a` up `idom` until `runner == idom[b]`, adding `b` to `DF(runner)` each step.

#### Go

```go
package main

import "fmt"

func dominanceFrontiers(n int, preds [][]int, idom []int) [][]int {
	df := make([]map[int]bool, n)
	for i := range df {
		df[i] = map[int]bool{}
	}
	for b := 0; b < n; b++ {
		if len(preds[b]) < 2 {
			continue
		}
		for _, p := range preds[b] {
			runner := p
			for runner != idom[b] && runner != -1 {
				df[runner][b] = true
				runner = idom[runner]
			}
		}
	}
	out := make([][]int, n)
	for u := 0; u < n; u++ {
		for w := range df[u] {
			out[u] = append(out[u], w)
		}
	}
	return out
}

func main() {
	preds := [][]int{{}, {0}, {0}, {1, 2}, {3}, {3, 4}}
	idom := []int{0, 0, 0, 0, 3, 3}
	df := dominanceFrontiers(6, preds, idom)
	for u := 0; u < 6; u++ {
		fmt.Printf("DF(%d) = %v\n", u, df[u])
	}
}
```

#### Java

```java
import java.util.*;

public class Task8 {
    static List<Set<Integer>> dominanceFrontiers(int n, List<List<Integer>> preds, int[] idom) {
        List<Set<Integer>> df = new ArrayList<>();
        for (int i = 0; i < n; i++) df.add(new HashSet<>());
        for (int b = 0; b < n; b++) {
            if (preds.get(b).size() < 2) continue;
            for (int p : preds.get(b)) {
                int runner = p;
                while (runner != idom[b] && runner != -1) {
                    df.get(runner).add(b);
                    runner = idom[runner];
                }
            }
        }
        return df;
    }

    public static void main(String[] args) {
        List<List<Integer>> preds = List.of(
            List.of(), List.of(0), List.of(0), List.of(1,2), List.of(3), List.of(3,4));
        int[] idom = {0, 0, 0, 0, 3, 3};
        List<Set<Integer>> df = dominanceFrontiers(6, preds, idom);
        for (int u = 0; u < 6; u++) System.out.println("DF(" + u + ") = " + df.get(u));
    }
}
```

#### Python

```python
def dominance_frontiers(n, preds, idom):
    df = [set() for _ in range(n)]
    for b in range(n):
        if len(preds[b]) < 2:
            continue
        for p in preds[b]:
            runner = p
            while runner != idom[b] and runner != -1:
                df[runner].add(b)
                runner = idom[runner]
    return df


if __name__ == "__main__":
    preds = [[], [0], [0], [1, 2], [3], [3, 4]]
    idom = [0, 0, 0, 0, 3, 3]
    df = dominance_frontiers(6, preds, idom)
    for u in range(6):
        print(f"DF({u}) = {sorted(df[u])}")
```

- **Evaluation:** `DF(1) = {3}`, `DF(2) = {3}`, `DF(4) = {5}` on this CFG.

---

### Task 9 — Natural loop bodies

**Problem.** Given a CFG and `idom[]`, find every natural loop: for each back edge `t → h`, return `h` (header) and the set of body blocks (`h`, `t`, and everything reaching `t` without going through `h`).

**Constraints.** `1 ≤ n ≤ 10⁵`. Detect back edges via dominance (Task 3), then backward-flood from `t` stopping at `h`.

**Hint.** Body = `{h}`; start a worklist with `t`; for each popped block, add unvisited predecessors (never re-expand `h`). Merge bodies sharing a header.

Provide starter code in all three languages (the Python version is in `senior.md` §7.3; port it to Go and Java).

- **Evaluation:** on the running example plus `5 → 3`, the loop has header `3` and body `{3, 4, 5}`.

---

### Task 10 — Post-dominators via graph reversal

**Problem.** Compute the **post-dominator** of every vertex: run your dominator algorithm on the **reversed** CFG with the **exit** as root. Add a synthetic exit if there are multiple sinks.

**Constraints.** `1 ≤ n ≤ 10⁵`. Reuse the Task 7 (or Task 6) dominator code unchanged on reversed edges.

**Hint.** Build `rev[v] = [u for each edge u→v]`. If multiple sinks (vertices with no successors), add a synthetic node `n` with an edge from each sink, and run with root `n`.

Provide starter code in all three languages that reverses edges, adds a synthetic exit if needed, and calls the dominator routine.

- **Evaluation:** post-`idom` is exit-rooted; verify a node's post-dominator is the next unavoidable block on the way to exit.

---

## Advanced Tasks (5)

### Task 11 — Differential tester (fast vs oracle)

**Problem.** Build a randomized differential tester: generate random reachable CFGs, compute `idom` with both the Task 1 brute oracle and the Task 7 Lengauer-Tarjan, and assert they agree. Report any mismatch with the failing graph.

**Constraints.** Generate `1000+` graphs with `2 ≤ n ≤ 12` (oracle is exponential-ish, keep `n` small). Ensure reachability via a random spanning tree plus extra edges.

**Hint.** Random spanning tree: for `v` in `1..n-1`, add edge from `random(0..v-1)` to `v`. Then sprinkle extra random edges. On mismatch, print `n`, the edge list, and both `idom` arrays.

Provide starter code in all three languages (the Python skeleton is in `professional.md` §12.3).

- **Evaluation:** runs clean on a correct implementation; deliberately break `EVAL` (drop path compression) and confirm the tester catches a mismatch.

---

### Task 12 — Lengauer-Tarjan with balanced linking (`O(E·α(V))`)

**Problem.** Upgrade the simple Lengauer-Tarjan to the **sophisticated** version: add `size`-based balanced linking in `LINK` so the amortized bound improves from `O(E log V)` to `O(E·α(V))`.

**Constraints.** `1 ≤ n ≤ 5·10⁵`, `1 ≤ m ≤ 2·10⁶`. Must still match the simple version on differential tests.

**Hint.** Maintain `size[]`, `child[]`, and re-rooted `label[]`; in `LINK(v, w)`, attach the smaller tree under the larger, walking and relabeling along the spine. Follow Lengauer-Tarjan (1979) §4 "sophisticated EVAL/LINK."

Provide starter code in all three languages with the sophisticated `LINK`/`EVAL`; benchmark against Task 7 on a large graph.

- **Evaluation:** identical `idom` to Task 7; measurably better scaling on deep/wide adversarial graphs.

---

### Task 13 — Iterated dominance frontier and φ-placement

**Problem.** Given a CFG, `idom[]`, and a set of definition blocks `D_x` for a variable `x`, compute the **iterated dominance frontier** `DF⁺(D_x ∪ {r})` — the exact set of blocks needing a φ-function for `x`.

**Constraints.** `1 ≤ n ≤ 10⁵`. Use a worklist over `DF` (Task 8).

**Hint.** Worklist = `D_x`. Pop `b`; for each `w ∈ DF(b)` not yet a φ-site, mark it and add `w` to the worklist (its φ is a new definition). Repeat to fixpoint.

Provide starter code in all three languages that takes `DF` (from Task 8) and `D_x`, and returns the φ-placement set.

- **Evaluation:** correct minimal φ sites; matches a brute-force reaching-definitions placement on small CFGs.

---

### Task 14 — Strong articulation points (directed 2-connectivity)

**Problem.** In a **strongly connected** directed graph, a vertex is a **strong articulation point** if removing it makes the graph not strongly connected. Compute all of them using dominator trees of `G` (rooted at any `s`) and of the **reverse** graph (rooted at `s`).

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ m ≤ 5·10⁵`. Linear-time via the Italiano-Georgiadis result.

**Hint.** A vertex `v ≠ s` is a strong articulation point iff it is a non-trivial dominator (`idom[w] = v` for some `w`) in the dominator tree of `G` **or** of the reverse graph; `s` itself is an SAP iff it has ≥ 2 dominator-tree children in either. Combine both trees' non-trivial dominators.

Provide starter code in all three languages that runs the dominator algorithm twice (forward and reversed) and unions the non-trivial dominators.

- **Evaluation:** matches a brute force that removes each vertex and re-tests strong connectivity on small graphs.

---

### Task 15 — Incremental dominator update on edge insertion

**Problem.** Maintain `idom[]` under a stream of edge **insertions** without full rebuilds. When inserting `(u, v)`, update only the `idom`s that can change (which can only move **up** toward the root).

**Constraints.** `1 ≤ n ≤ 10⁴`, up to `10⁴` insertions. Each update should touch far less than the whole tree on average.

**Hint.** If `u` is unreachable, ignore until reachable. Otherwise the new edge can lower `idom[v]` (and descendants) to `ncd(idom[v], u)`. Recompute affected `idom`s by taking nearest common dominators along the changed subtree; verify against a full rebuild after each insertion.

Provide starter code in all three languages: start from a base `idom`, apply one insertion with the `ncd`-based patch, and assert equality with a full Lengauer-Tarjan rebuild.

- **Evaluation:** patched `idom` equals a from-scratch rebuild after every insertion; average work per insertion well below `O(n)` on random sequences.

---

## Benchmark Task

> Compare dominator computation across all 3 languages and both algorithms (iterative dataflow vs Lengauer-Tarjan).

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func randomCFG(n int) [][2]int {
	var edges [][2]int
	for v := 1; v < n; v++ {
		edges = append(edges, [2]int{rand.Intn(v), v}) // spanning tree -> reachable
	}
	for i := 0; i < n; i++ {
		u, v := rand.Intn(n), rand.Intn(n-1)+1
		if u != v {
			edges = append(edges, [2]int{u, v})
		}
	}
	return edges
}

func main() {
	for _, n := range []int{1000, 10000, 100000} {
		edges := randomCFG(n)
		start := time.Now()
		_ = computeIdom(n, edges, 0) // Lengauer-Tarjan from interview.md Challenge 1
		fmt.Printf("n=%7d: %.2f ms\n", n, float64(time.Since(start).Microseconds())/1000.0)
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        Random rng = new Random(1);
        for (int n : new int[]{1000, 10000, 100000}) {
            List<int[]> edges = new ArrayList<>();
            for (int v = 1; v < n; v++) edges.add(new int[]{rng.nextInt(v), v});
            for (int i = 0; i < n; i++) {
                int u = rng.nextInt(n), v = rng.nextInt(n - 1) + 1;
                if (u != v) edges.add(new int[]{u, v});
            }
            int[][] arr = edges.toArray(new int[0][]);
            long start = System.nanoTime();
            new DominatorTree().computeIdom(n, arr, 0); // interview.md Challenge 1
            System.out.printf("n=%7d: %.2f ms%n", n, (System.nanoTime() - start) / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random
import time
# from interview.md Challenge 1: compute_idom(n, edges, r)


def random_cfg(n):
    edges = [(random.randint(0, v - 1), v) for v in range(1, n)]
    for _ in range(n):
        u, v = random.randint(0, n - 1), random.randint(1, n - 1)
        if u != v:
            edges.append((u, v))
    return edges


if __name__ == "__main__":
    for n in (1000, 10_000, 100_000):
        edges = random_cfg(n)
        start = time.perf_counter()
        compute_idom(n, edges, 0)
        print(f"n={n:>7}: {(time.perf_counter() - start) * 1000:.2f} ms")
```
