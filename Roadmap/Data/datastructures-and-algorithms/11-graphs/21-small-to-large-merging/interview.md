# Small-to-Large Merging — Interview Preparation

Small-to-large merging (a.k.a. set-merging, the "sack" technique, or DSU on tree) is a favourite of competitive-programming-flavoured interviews because it separates candidates who *memorised* tree DFS from those who understand *amortized analysis*. The whole algorithm is one size check, yet the reason it is fast — each element moves `O(log N)` times because its container at least doubles — is a genuine insight. This file is a question bank sorted by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Setting | Time | Space | Note |
|---------|------|-------|------|
| Naive merge (no size check) | O(N²) | O(N) | Bamboo tree is the killer case. |
| Small-to-large (hash set/map) | **O(N log N)** | O(N) | `O(1)` per move × `N log N` moves. |
| Small-to-large (ordered map) | **O(N log² N)** | O(N) | `O(log N)` per ordered insert. |
| DSU on tree (keep heavy child) | **O(N log N)** | O(N) | No per-merge log; array counter. |
| One subtree query | amortized O(1) | — | Offline only. |

The two load-bearing facts:

```text
1. Doubling: when you merge smaller into larger, the moved element's
   container at least doubles -> moved <= log2(N) times.
2. Light edges: each root-to-node path has <= log2(N) light edges,
   because descending a light edge at least halves the subtree size.
```

The core merge step:

```text
if size(cur) < size(child):
    swap(cur, child)     # cur is now the larger
for x in child:          # iterate the SMALLER
    cur.add(x)
```

The DSU-on-tree skeleton:

```text
dfs(u, keep):
    for light child c: dfs(c, keep=false)
    if heavy child h:  dfs(h, keep=true)   # retain h's data
    add(u); for each light child: add its whole subtree (Euler range)
    answer queries for u
    if not keep: remove subtree(u)
```

---

## Junior Questions (12 Q&A)

### J1. What is small-to-large merging?
It is a technique for combining collections efficiently: whenever you merge two collections, you always move the elements of the *smaller* one into the *larger* one (and swap handles so the larger survives). This one rule turns a naive `O(N²)` repeated-merge into `O(N log N)`, because each element can only be moved into a container at least twice its previous size, and that can happen at most `log₂ N` times.

### J2. Why must we merge the smaller into the larger and not the reverse?
If you merge the larger into the smaller, you copy many elements into a tiny container; an adversary can build a chain (bamboo tree) where this costs `1 + 2 + … + N = O(N²)`. Merging smaller into larger guarantees each element's container at least doubles on every move, capping moves at `log₂ N` per element.

### J3. Why is each element moved at most O(log N) times?
Every time an element `x` is moved, it was in the smaller of two operands. The merged container has size `≥ 2 × (smaller)`, so `x`'s container at least doubles. Starting from size 1 and never exceeding `N`, doubling can happen at most `log₂ N` times. Hence `x` moves `≤ log₂ N` times, and total moves `≤ N log₂ N`.

### J4. What problem does it classically solve?
Offline subtree aggregation: for every node, compute some summary over its entire subtree — number of distinct colors, the most frequent color, the sum of values, the size of a set union, etc. You DFS in post-order and merge children's summaries smaller-into-larger.

### J5. What data structure do you merge?
Any mergeable summary: a hash set (for distinct counts), a hash map `value → count` (for frequencies/mode), a running sum, or a custom monoid. Use hash-based containers for `O(N log N)`; ordered maps give `O(N log² N)` but allow ordered queries.

### J6. What is the difference between the hash version and the ordered-map version?
The hash version inserts in `O(1)`, so `N log N` moves cost `O(N log N)`. The ordered map (`std::map`, `TreeMap`) inserts in `O(log N)`, so the same `N log N` moves cost `O(N log² N)`. Choose hash unless you need sorted/order-statistic queries.

### J7. Is small-to-large online or offline?
The clean form is offline — you process the whole tree in one DFS and you must know all queries up front (you attach each query to its node). For online subtree queries you would use an Euler tour with a Fenwick/segment tree instead.

### J8. What is a subtree?
A node together with all of its descendants. A subtree query asks something about that set, answered for every node.

### J9. How do you avoid copying when merging?
Swap the *references/handles* of the two containers (`O(1)`) so the larger is treated as the destination, then iterate over the smaller and insert. Never copy the larger container.

### J10. What goes wrong if you forget the size check?
The algorithm is still *correct* but becomes `O(N²)` on a bad tree — a classic "correct but Time Limit Exceeded" bug. Always compare sizes before merging.

### J11. Where do you add a node's own value?
Exactly once, typically after merging all children's summaries into the surviving container. Adding it to every child or twice causes over-counting.

### J12. Name a related technique for tree problems.
DSU on tree (the optimized form, keeps the heavy child's data), Euler tour + Fenwick (online subtree sums), **14-heavy-light-decomposition** (online path queries), and **15-centroid-decomposition** (path/distance problems).

---

## Middle Questions (12 Q&A)

### M1. What is "DSU on tree" and how does it differ from naive small-to-large?
DSU on tree (the "sack") keeps a single *global* structure. At each node it retains the heavy child's contribution in place (never removing it) and only re-adds the *light* children's subtrees. Naive small-to-large instead builds and merges a separate container per node. DSU on tree avoids the per-merge cost entirely and is `O(N log N)` with no second log, using a cache-friendly flat array.

### M2. Why is DSU on tree O(N log N) with no second log?
It performs `add`/`remove` of individual nodes, each `O(1)` with an array counter — there is no insertion into an ordered structure, so no `O(log N)` per op. A node is added once per light edge above it, and there are `≤ log₂ N` light edges per root path, giving `≤ N log₂ N` total adds.

### M3. What is a heavy child / heavy edge?
The heavy child of a node is the child with the largest subtree; the edge to it is heavy, others are light. The whole optimization rests on choosing heavy = largest subtree.

### M4. Why are there at most log N light edges on any root-to-node path?
Descending a light edge means going to a non-heavy child, whose subtree is no larger than the heavy child's, hence at most half the parent's subtree. Each light edge at least halves the subtree size; from `N` down to `1` you can halve at most `log₂ N` times.

### M5. How do you implement "add the whole subtree of a light child" efficiently?
Precompute an Euler tour with `tin[v]` and `tout[v]`. The subtree of `v` is the contiguous range `[tin[v], tout[v])` in the `order[]` array, so you add it with a flat loop. Re-running a DFS per add would blow up the constant factor.

### M6. How do you maintain "distinct count" under add/remove in O(1)?
Keep a `cnt[value]` array and a `distinct` counter. Increment `distinct` when a value goes from 0→1 on add; decrement when it goes 1→0 on remove.

### M7. How do you maintain the mode (most frequent value) under add/remove?
Keep `cnt[value]` plus `cntOfCount[k]` = number of values with count `k`, and a `maxCount`. On add, move the value's count up and bump `maxCount` if exceeded. On remove, if you emptied the bucket equal to `maxCount`, decrement `maxCount`.

### M8. When is small-to-large the wrong tool?
For online subtree updates/queries (use Euler tour + Fenwick), for path queries (use HLD), for distance/path-counting across the tree (use centroid decomposition), or when `N` exceeds single-machine memory (use sketches in a distributed engine).

### M9. Compare DSU on tree with Mo's algorithm on an Euler tour.
Both answer offline subtree distinct/frequency queries. DSU on tree is `O(N log N)` and answers *every* node; Mo's is `O((N+Q)√N)` and answers an arbitrary set of `Q` subtree-range queries. DSU on tree is faster when you want all subtrees; Mo's is more flexible for arbitrary ranges including non-subtree ranges.

### M10. What is the best case for DSU on tree?
A chain (bamboo). It has one heavy path and zero light edges below the root, so each node is added once: `O(N)`. Ironically, the same chain is the worst case for the *un-checked* naive merge.

### M11. How does small-to-large relate to Union-Find?
It is exactly *union by size*: when you union two DSU sets, attaching the smaller under the larger gives the same `O(log N)`-moves amortization. DSU on tree applies that schedule along the tree's heavy/light structure.

### M12. Can the merge form be parallelized?
The naive per-node form yes — distinct subtrees are independent until they join, so you can compute child summaries in parallel and merge at the join smaller-into-larger. The DSU-on-tree global-counter form is sequential because it mutates one shared structure in strict post-order.

---

## Senior Questions (10 Q&A)

### S1. You must answer subtree-distinct for 10⁸ nodes. What changes?
At 10⁸ you exceed comfortable single-node RAM (Euler arrays alone are several GB). Switch to Euler-tour linearization plus a distributed engine with HyperLogLog sketches per range for *approximate* distinct counts, or hierarchical pre-aggregation. Small-to-large is a single-machine `N ≤ ~10⁷` technique.

### S2. How do you keep the heavy-child invariant from silently degrading to O(N²)?
Instrument the `add` counter and assert it stays `≤ N⌈log₂ N⌉`. Unit-test heavy-child selection on a chain (should be `O(N)`) and a star/complete tree. A wrong heavy child does not crash; it just runs `O(N²)`, so an automated invariant check is the only reliable guard.

### S3. What is the memory profile and how do you bound it?
Naive per-node maps: peak `O(N)` data plus 3–8× hash overhead times the number of live maps on the stack. DSU on tree: one global `cnt[]` of size `O(U)` plus six Euler arrays of size `N`. Prefer DSU on tree at scale and compress values to a dense `[0, U)` range so `cnt[]` is an array, not a map.

### S4. How do you protect against stack overflow?
Recursion depth equals tree height, which is `N` for a chain. Convert the size/Euler precomputation to an explicit-stack iterative pass, and if depth is extreme, the main DFS too. This is mandatory at `N ≥ 10⁶`.

### S5. When would you choose segment-tree merging over DSU on tree?
When you need *order statistics or value-range queries* per subtree (k-th smallest, count in `[l, r]`), not just counts or mode. Segment-tree merging gives those in `O(N log U)` time and space at the cost of more memory.

### S6. How do you make tree analytics serve fast reads?
Precompute the DSU-on-tree pass as a batch (e.g., nightly), materialize `node → {distinct, mode, …}` into a columnar table or cache, and serve reads in `O(1)`. Recompute on schedule or on a "tree changed" event. If updates are frequent, that is the signal to move to an online structure.

### S7. How do light/heavy structure here relate to HLD and centroid decomposition?
DSU on tree uses only the *light-edge count* (`≤ log N`). HLD uses the explicit heavy-path partition for online *path* queries. Centroid decomposition uses a different recursive split for *distance/path* problems. They share the "halving" intuition but solve different query shapes.

### S8. What observability do you add to a batch small-to-large job?
Total `add` count (the `O(N log N)` budget check), peak distinct/maxCount sanity bounds, per-stage wall-clock (load vs DSU vs persist), RSS high-water mark, and a determinism diff against a golden run.

### S9. How would you parallelize on a multi-core machine?
Use the naive per-subtree form: fan out the root's children to workers, each computes its subtree's summary independently, then merge results smaller-into-larger at the join. Give each worker its own containers — never share the global counter, which would force locking the hottest array.

### S10. The aggregate is a sum (invertible). Do you still use small-to-large?
No. For invertible additive aggregates, an Euler-tour prefix sum is `O(N)`, trivially parallel, and supports online point updates with a Fenwick tree. Reserve small-to-large/DSU-on-tree for *non-invertible* aggregates like distinct count and mode.

---

## Professional / Theory Questions (8 Q&A)

### P1. State and prove the O(N log N) merge bound.
Charge each insertion to the inserted element `x`. Each time `x` is inserted it was in the smaller operand, so its container at least doubles: `|S_{i+1}| ≥ 2|S_i|`, giving `|S_i| ≥ 2^i`. Since `|S| ≤ N`, `x` is inserted `≤ log₂ N` times. Summed over `N` elements: `≤ N log₂ N` insertions.

### P2. Prove the DSU-on-tree O(N log N) bound.
A node `w` is added once for each light edge on its root path plus once for itself: `1 + L(w)` times. Total adds `= N + Σ_w L(w)`. Since each light edge halves the subtree size, `L(w) ≤ log₂ N`, so total adds `≤ N(1 + log₂ N) = O(N log N)`. Removes `≤` adds.

### P3. Are these bounds tight?
Yes. On a balanced/complete tree, `Θ(N)` nodes have `Θ(log N)` light edges, realizing `Θ(N log N)`. The element-distinctness lower bound shows reporting per-subtree distinct counts needs `Ω(N log N)` in the comparison model, so the technique is optimal up to constants.

### P4. Why does the ordered-map version cost N log² N?
The same `N log N` element moves occur, but each insertion into an ordered structure of size `≤ N` costs `O(log N)`, multiplying to `O(N log² N)`. DSU on tree replaces ordered insertions with `O(1)` array increments, removing the second log.

### P5. How does segment-tree merging achieve O(N log U)?
Merging two value-indexed segment trees only touches nodes present in both; each touched node is destroyed once. Total nodes ever created is `O(N log U)` (each insertion creates `O(log U)` nodes), so total merge work equals total creation = `O(N log U)`.

### P6. How are the "doubling" and "light-edge halving" facts related?
They are the same geometric fact in two directions. Doubling caps how often an element moves *up* a merge tree; halving caps how often a node sits in a light subtree on the way *down* the rooted tree. Both yield the `log N` factor.

### P7. What is the best, average, and worst case?
Best: chain → `O(N)` (zero light edges). Worst: complete binary tree → `Θ(N log N)`. Average (random tree): `Θ(N log N)`; the `L(w) ≤ log N` bound holds regardless of shape, so the analysis is robust.

### P8. Can small-to-large run exactly on a DAG?
No. On a DAG with shared subtrees the merge double-counts shared elements. You need either a tree decomposition or approximate sketch-based merging (HLL) that tolerates the overlap, restoring near-linear time at the cost of accuracy.

---

## Behavioral Questions (5)

### B1. Tell me about a time you optimized a slow batch job.
Frame: a nightly rollup that was `O(N²)` due to merging summaries the wrong way; you spotted the missing size check, added smaller-into-larger, cut runtime from hours to minutes. Emphasize you *measured* before and after and added a regression test on a worst-case (chain) input.

### B2. Describe debugging a problem that only appeared at scale.
Frame: code correct on test data, hung in production. Root cause: heavy-child chosen wrong, silently `O(N²)`. You added an invariant assertion (`add` count `≤ N log N`) so the next such regression fails fast in CI rather than in prod.

### B3. How do you decide between a clever algorithm and a simpler one?
Frame: you chose DSU on tree only after confirming the queries were offline, subtree-shaped, and non-invertible; otherwise you would have used a simpler Euler-tour Fenwick. Emphasize matching the tool to the four constraints rather than reaching for the fanciest technique.

### B4. Tell me about explaining a complex idea to a teammate.
Frame: you explained the `O(log N)` moves bound using the "coin moving to a jar at least twice as big" analogy, which made the amortization click without heavy notation.

### B5. A reviewer disagreed with your approach. What happened?
Frame: a reviewer wanted an online structure; you walked through the offline nature of the requirement and the memory win of the global counter, agreed to add a fallback path for future online needs, and documented the trade-off in the design doc.

---

## Coding Challenges

### Challenge 1 — Count distinct colors in each subtree

> **Statement.** Rooted tree (root `1`), each node has a color. For every node output the number of distinct colors in its subtree.
> **Constraints.** `N ≤ 2·10⁵`. Must be `O(N log N)`.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	mx := 0
	for i := range color {
		fmt.Fscan(rd, &color[i])
		if color[i] > mx { mx = color[i] }
	}
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b)
		a--; b--
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] {
			if v == p { continue }
			size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v }
		}
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, mx+1); d := 0; ans := make([]int, n)
	add := func(u int) { if cnt[color[u]] == 0 { d++ }; cnt[color[u]]++ }
	rem := func(u int) { cnt[color[u]]--; if cnt[color[u]] == 0 { d-- } }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		ans[u] = d
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) } }
	}
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class C1 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order, cnt, ans;
    static int t = 0, d = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ if(cnt[color[u]]==0) d++; cnt[color[u]]++; }
    static void rem(int u){ cnt[color[u]]--; if(cnt[color[u]]==0) d--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=d;
        if(!keep) for(int k=tin[u];k<tout[u];k++) rem(order[k]);
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n];
        tin=new int[n]; tout=new int[n]; order=new int[n]; ans=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new int[mx+1];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(int v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); st={"d":0}; ans=[0]*n
    def add(u):
        if cnt[color[u]]==0: st["d"]+=1
        cnt[color[u]]+=1
    def rem(u):
        cnt[color[u]]-=1
        if cnt[color[u]]==0: st["d"]-=1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=st["d"]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

### Challenge 2 — Sum of the most-frequent values in each subtree (Codeforces 600E style)

> **Statement.** Each node has a color. For every node, find the sum of all colors that appear the maximum number of times in its subtree.
> **Constraints.** `N ≤ 10⁵`. Use a global `cnt[color]`, `sumByFreq[f]` = sum of colors whose count is `f`, and a running `maxFreq`.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var (
	adj                 [][]int
	color               []int
	sz, heavy           []int
	tin, tout, order    []int
	cnt                 []int64
	sumByFreq           []int64
	maxFreq             int
	ans                 []int64
	timer               int
)

func size(u, p int) {
	sz[u] = 1; heavy[u] = -1; tin[u] = timer; order[timer] = u; timer++
	best := 0
	for _, v := range adj[u] {
		if v == p { continue }
		size(v, u); sz[u] += sz[v]
		if sz[v] > best { best = sz[v]; heavy[u] = v }
	}
	tout[u] = timer
}
func add(u int) {
	c := color[u]
	sumByFreq[cnt[c]] -= int64(c)
	cnt[c]++
	sumByFreq[cnt[c]] += int64(c)
	if int(cnt[c]) > maxFreq { maxFreq = int(cnt[c]) }
}
func rem(u int) {
	c := color[u]
	sumByFreq[cnt[c]] -= int64(c)
	if int(cnt[c]) == maxFreq && sumByFreq[cnt[c]] == 0 { maxFreq-- }
	cnt[c]--
	sumByFreq[cnt[c]] += int64(c)
}
func dfs(u, p int, keep bool) {
	for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
	if heavy[u] != -1 { dfs(heavy[u], u, true) }
	add(u)
	for _, v := range adj[u] {
		if v != p && v != heavy[u] {
			for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
		}
	}
	ans[u] = sumByFreq[maxFreq]
	if !keep {
		for k := tin[u]; k < tout[u]; k++ { rem(order[k]) }
		maxFreq = 0
	}
}

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color = make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b)
		a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz = make([]int, n); heavy = make([]int, n)
	tin = make([]int, n); tout = make([]int, n); order = make([]int, n)
	cnt = make([]int64, mx+1); sumByFreq = make([]int64, n+1); ans = make([]int64, n)
	size(0, -1)
	dfs(0, -1, false)
	w := bufio.NewWriter(os.Stdout); defer w.Flush()
	for _, a := range ans { fmt.Fprintf(w, "%d ", a) }
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class C2 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order;
    static long[] cnt, sumByFreq, ans; static int maxFreq = 0, t = 0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ int c=color[u]; sumByFreq[(int)cnt[c]]-=c; cnt[c]++; sumByFreq[(int)cnt[c]]+=c;
        if((int)cnt[c]>maxFreq) maxFreq=(int)cnt[c]; }
    static void rem(int u){ int c=color[u]; sumByFreq[(int)cnt[c]]-=c;
        if((int)cnt[c]==maxFreq && sumByFreq[(int)cnt[c]]==0) maxFreq--; cnt[c]--; sumByFreq[(int)cnt[c]]+=c; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        ans[u]=sumByFreq[maxFreq];
        if(!keep){ for(int k=tin[u];k<tout[u];k++) rem(order[k]); maxFreq=0; }
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new long[mx+1]; sumByFreq=new long[n+1]; ans=new long[n];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        StringBuilder sb=new StringBuilder(); for(long v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p = 0; n = int(data[p]); p += 1
    color = [int(data[p+i]) for i in range(n)]; p += n
    adj = [[] for _ in range(n)]
    for _ in range(n-1):
        a = int(data[p])-1; b = int(data[p+1])-1; p += 2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); sumByFreq=[0]*(n+1); ans=[0]*n; state={"mx":0}
    def add(u):
        c=color[u]; sumByFreq[cnt[c]]-=c; cnt[c]+=1; sumByFreq[cnt[c]]+=c
        if cnt[c]>state["mx"]: state["mx"]=cnt[c]
    def rem(u):
        c=color[u]; sumByFreq[cnt[c]]-=c
        if cnt[c]==state["mx"] and sumByFreq[cnt[c]]==0: state["mx"]-=1
        cnt[c]-=1; sumByFreq[cnt[c]]+=c
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        ans[u]=sumByFreq[state["mx"]]
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
            state["mx"]=0
    dfs(0,-1,False)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

### Challenge 3 — Naive small-to-large set merge (no Euler, functional)

> **Statement.** Same distinct-count problem but write the *naive* small-to-large (one set per node, merge up). Demonstrates the `O(N log N)` set-merge form.

#### Go

```go
package main

import "fmt"

var adj [][]int
var color, ans []int

func dfs(u, p int) map[int]bool {
	cur := map[int]bool{}
	for _, v := range adj[u] {
		if v == p { continue }
		ch := dfs(v, u)
		if len(cur) < len(ch) { cur, ch = ch, cur }
		for x := range ch { cur[x] = true }
	}
	cur[color[u]] = true
	ans[u] = len(cur)
	return cur
}

func main() {
	var n int
	fmt.Scan(&n)
	color = make([]int, n)
	for i := range color { fmt.Scan(&color[i]) }
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Scan(&a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	ans = make([]int, n)
	dfs(0, -1)
	for _, a := range ans { fmt.Printf("%d ", a) }
}
```

#### Java

```java
import java.util.*;

public class C3 {
    static List<List<Integer>> adj; static int[] color, ans;
    static Set<Integer> dfs(int u,int p){
        Set<Integer> cur=new HashSet<>();
        for(int v:adj.get(u)){ if(v==p) continue;
            Set<Integer> ch=dfs(v,u);
            if(cur.size()<ch.size()){ Set<Integer> t=cur; cur=ch; ch=t; }
            cur.addAll(ch); }
        cur.add(color[u]); ans[u]=cur.size(); return cur;
    }
    public static void main(String[] a){
        Scanner sc=new Scanner(System.in);
        int n=sc.nextInt();
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; ans=new int[n];
        for(int i=0;i<n;i++) color[i]=sc.nextInt();
        for(int i=0;i<n-1;i++){ int x=sc.nextInt()-1,y=sc.nextInt()-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        dfs(0,-1);
        StringBuilder sb=new StringBuilder(); for(int v:ans) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p=0; n=int(data[p]); p+=1
    color=[int(data[p+i]) for i in range(n)]; p+=n
    adj=[[] for _ in range(n)]
    for _ in range(n-1):
        a=int(data[p])-1; b=int(data[p+1])-1; p+=2
        adj[a].append(b); adj[b].append(a)
    ans=[0]*n
    def dfs(u, par):
        cur=set()
        for v in adj[u]:
            if v==par: continue
            ch=dfs(v,u)
            if len(cur)<len(ch): cur,ch=ch,cur
            cur|=ch
        cur.add(color[u]); ans[u]=len(cur); return cur
    dfs(0,-1)
    sys.stdout.write(" ".join(map(str,ans)))

main()
```

### Challenge 4 — Number of subtrees where all colors are distinct

> **Statement.** Count how many nodes `u` have the property that *every* color in `subtree(u)` is unique (no duplicates). Equivalently `distinct(u) == size(u)`.
> **Hint.** Run the distinct-count DSU on tree; compare to subtree size.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	color := make([]int, n)
	mx := 0
	for i := range color { fmt.Fscan(rd, &color[i]); if color[i] > mx { mx = color[i] } }
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(rd, &a, &b); a--; b--
		adj[a] = append(adj[a], b); adj[b] = append(adj[b], a)
	}
	sz := make([]int, n); heavy := make([]int, n)
	tin := make([]int, n); tout := make([]int, n); order := make([]int, n)
	t := 0
	var size func(u, p int)
	size = func(u, p int) {
		sz[u] = 1; heavy[u] = -1; tin[u] = t; order[t] = u; t++
		best := 0
		for _, v := range adj[u] { if v == p { continue }; size(v, u); sz[u] += sz[v]
			if sz[v] > best { best = sz[v]; heavy[u] = v } }
		tout[u] = t
	}
	size(0, -1)
	cnt := make([]int, mx+1); d := 0
	good := 0
	add := func(u int) { if cnt[color[u]] == 0 { d++ }; cnt[color[u]]++ }
	rem := func(u int) { cnt[color[u]]--; if cnt[color[u]] == 0 { d-- } }
	var dfs func(u, p int, keep bool)
	dfs = func(u, p int, keep bool) {
		for _, v := range adj[u] { if v != p && v != heavy[u] { dfs(v, u, false) } }
		if heavy[u] != -1 { dfs(heavy[u], u, true) }
		add(u)
		for _, v := range adj[u] {
			if v != p && v != heavy[u] {
				for k := tin[v]; k < tout[v]; k++ { add(order[k]) }
			}
		}
		if d == sz[u] { good++ }
		if !keep { for k := tin[u]; k < tout[u]; k++ { rem(order[k]) } }
	}
	dfs(0, -1, false)
	fmt.Println(good)
}
```

#### Java

```java
import java.util.*;
import java.io.*;

public class C4 {
    static List<List<Integer>> adj; static int[] color, sz, heavy, tin, tout, order, cnt;
    static int t=0, d=0, good=0;
    static void size(int u,int p){ sz[u]=1; heavy[u]=-1; tin[u]=t; order[t]=u; t++;
        int best=0; for(int v:adj.get(u)){ if(v==p) continue; size(v,u); sz[u]+=sz[v];
            if(sz[v]>best){best=sz[v];heavy[u]=v;} } tout[u]=t; }
    static void add(int u){ if(cnt[color[u]]==0) d++; cnt[color[u]]++; }
    static void rem(int u){ cnt[color[u]]--; if(cnt[color[u]]==0) d--; }
    static void dfs(int u,int p,boolean keep){
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) dfs(v,u,false);
        if(heavy[u]!=-1) dfs(heavy[u],u,true);
        add(u);
        for(int v:adj.get(u)) if(v!=p&&v!=heavy[u]) for(int k=tin[v];k<tout[v];k++) add(order[k]);
        if(d==sz[u]) good++;
        if(!keep) for(int k=tin[u];k<tout[u];k++) rem(order[k]);
    }
    public static void main(String[] a) throws IOException {
        StreamTokenizer st=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n=(int)st.nval;
        adj=new ArrayList<>(); for(int i=0;i<n;i++) adj.add(new ArrayList<>());
        color=new int[n]; sz=new int[n]; heavy=new int[n]; tin=new int[n]; tout=new int[n]; order=new int[n];
        int mx=0; for(int i=0;i<n;i++){ st.nextToken(); color[i]=(int)st.nval; if(color[i]>mx) mx=color[i]; }
        cnt=new int[mx+1];
        for(int i=0;i<n-1;i++){ st.nextToken(); int x=(int)st.nval-1; st.nextToken(); int y=(int)st.nval-1;
            adj.get(x).add(y); adj.get(y).add(x); }
        size(0,-1); dfs(0,-1,false);
        System.out.println(good);
    }
}
```

#### Python

```python
import sys
from sys import setrecursionlimit

def main():
    setrecursionlimit(1 << 20)
    data = sys.stdin.buffer.read().split()
    p=0; n=int(data[p]); p+=1
    color=[int(data[p+i]) for i in range(n)]; p+=n
    adj=[[] for _ in range(n)]
    for _ in range(n-1):
        a=int(data[p])-1; b=int(data[p+1])-1; p+=2
        adj[a].append(b); adj[b].append(a)
    sz=[0]*n; heavy=[-1]*n; tin=[0]*n; tout=[0]*n; order=[0]*n; t=[0]
    def size(u, par):
        sz[u]=1; tin[u]=t[0]; order[t[0]]=u; t[0]+=1; best=0
        for v in adj[u]:
            if v==par: continue
            size(v,u); sz[u]+=sz[v]
            if sz[v]>best: best=sz[v]; heavy[u]=v
        tout[u]=t[0]
    size(0,-1)
    cnt=[0]*(max(color)+1); st={"d":0,"good":0}
    def add(u):
        if cnt[color[u]]==0: st["d"]+=1
        cnt[color[u]]+=1
    def rem(u):
        cnt[color[u]]-=1
        if cnt[color[u]]==0: st["d"]-=1
    def dfs(u, par, keep):
        for v in adj[u]:
            if v!=par and v!=heavy[u]: dfs(v,u,False)
        if heavy[u]!=-1: dfs(heavy[u],u,True)
        add(u)
        for v in adj[u]:
            if v!=par and v!=heavy[u]:
                for k in range(tin[v],tout[v]): add(order[k])
        if st["d"]==sz[u]: st["good"]+=1
        if not keep:
            for k in range(tin[u],tout[u]): rem(order[k])
    dfs(0,-1,False)
    print(st["good"])

main()
```

---

## Common Pitfalls

- **Missing the size check** — correct output, `O(N²)` runtime. The #1 mistake.
- **Copying instead of swapping handles** — each merge becomes `O(size)`.
- **Wrong heavy child** — silently degrades to `O(N²)`; never crashes.
- **Re-DFS to add a subtree** — use Euler `[tin, tout)` ranges instead.
- **Forgetting to reset `maxFreq`/`maxCount` after a non-kept subtree** — mode answers leak across siblings.
- **`cnt` array too small** — size it to `maxColor + 1` or compress values.
- **Recursion depth on chains** — raise limits / iterate.
- **Adding own value twice** — over-counts distinct/mode.

---

## What Interviewers Are Really Testing

- **Do you know *why* it is `O(N log N)`?** Reciting the rule is junior; explaining the doubling argument is the bar.
- **Can you distinguish the two forms?** Naive merge (`O(N log N)` / `O(N log² N)`) vs DSU on tree (`O(N log N)`, no second log). Knowing the second-log distinction signals real understanding.
- **Do you choose the right tool?** Offline + subtree + non-invertible → small-to-large; otherwise Euler+Fenwick, HLD, or centroid decomposition.
- **Can you implement add/remove invariants cleanly?** Distinct via 0↔1 transitions, mode via `cntOfCount`/`sumByFreq` buckets.
- **Do you guard the heavy-child invariant?** Senior candidates instrument the `add` count and test the chain case.
- **Do you reason about memory and recursion at scale?** Global counter over per-node maps, iterative DFS on deep trees.
