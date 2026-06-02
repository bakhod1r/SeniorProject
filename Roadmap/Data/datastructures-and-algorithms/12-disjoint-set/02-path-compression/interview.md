# Path Compression — Interview Preparation

Path compression is a high-signal interview topic: it is small enough to write on a whiteboard in three lines, it powers Union-Find (which shows up constantly in graph problems), and it has a few precise "gotchas" — the three variants, the difference between *compression alone* and *compression plus rank*, the inverse-Ackermann bound, and the stack-overflow trap — that separate a candidate who memorized `find` from one who understands it. This file is a graded question bank plus coding challenges with runnable Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Find strategy | Code idea | Passes | Recursion | Amortized (with union by rank) |
|---------------|-----------|--------|-----------|--------------------------------|
| Naive | walk to root, no rewrite | 1 | no | O(log n) (rank keeps height log) |
| Full compression | `parent[x] = find(parent[x])` | 2 | yes | O(α(n)) |
| Path halving | `parent[x] = parent[parent[x]]; x = parent[x]` | 1 | no | O(α(n)) |
| Path splitting | `next = parent[x]; parent[x] = parent[parent[x]]; x = next` | 1 | no | O(α(n)) |

```text
Naive find, arbitrary union ............ O(n) worst case
Compression alone, arbitrary union ..... O(log n) amortized
Compression alone, union by size ....... O(log n / log log n) amortized
Compression + union by rank/size ....... O(α(n)) amortized  (≈ constant, α ≤ 4)
```

Invariants: root iff `parent[r] == r`; init `parent[i] = i`; compression only ever re-points a node to an **ancestor**, so it never changes which group a node belongs to.

---

## Junior Questions (12 Q&A)

### J1. What problem does path compression solve?
A naive `find` walks from a node up to its root by following `parent[]` pointers. If the tree is a long chain, that walk is `O(height)`, which can be `O(n)`. Repeated finds on a tall tree make Union-Find slow. Path compression flattens the tree during `find` so that future finds on the same nodes are near-instant.

### J2. State the full path compression find in one line.
`find(x): if parent[x] != x: parent[x] = find(parent[x]); return parent[x]`. As the recursion unwinds, every node on the path is re-pointed directly to the root.

### J3. What does "re-pointing to the root" actually do to the array?
It overwrites `parent[v]` for each visited node `v` with the root's index. After `find`, those nodes hang directly off the root, so their depth becomes 1.

### J4. Name the three classic compression variants.
Full path compression (re-point every node on the path to the root), path halving (point each node to its grandparent, skipping every other node), and path splitting (point every node on the path to its grandparent, advancing one node at a time).

### J5. Which variants are iterative and which is recursive?
Full compression is naturally recursive (or done with an explicit two-pass loop). Path halving and path splitting are iterative single-pass loops with no recursion.

### J6. Why might recursion be a problem here?
On a very deep, near-linear tree the first `find` recurses to a depth equal to the chain length. For millions of nodes that overflows the call stack. Iterative halving or splitting avoids this entirely.

### J7. After one full `find(x)`, what does the path look like?
Perfectly flat: every node that was on the path now points directly at the root, depth 1.

### J8. After one halving `find(x)`, is the path flat?
No — it is roughly halved. Each node points to its former grandparent. Over repeated finds the tree converges to flat.

### J9. Does compression change which group a node belongs to?
No. Compression only re-points nodes to their own ancestors, so the root reachable from any node is unchanged. The partition into groups is preserved.

### J10. What is the time complexity of compression alone?
With arbitrary union, compression alone gives amortized `O(log n)` per find — a big improvement over `O(n)`. Combined with union by rank/size it improves to `O(α(n))`.

### J11. What is `α(n)`?
The inverse Ackermann function. It grows so slowly that `α(n) ≤ 4` for any input that can physically exist, so it is effectively a small constant.

### J12. Do you need union by rank to use compression?
No — compression works alone and gives `O(log n)`. But you almost always pair it with union by rank/size to reach the optimal `O(α(n))`.

---

## Middle Questions (12 Q&A)

### M1. Walk through path halving step by step on chain `0→1→2→3→4`.
`parent = [1,2,3,4,4]`. `find(0)`: set `parent[0] = parent[parent[0]] = parent[1] = 2`, move `x=2`; set `parent[2] = parent[3] = 4`, move `x=4`; `parent[4]==4` stop. Result `parent = [2,2,4,4,4]` — depth roughly halved.

### M2. What is the exact difference between halving and splitting?
Both re-point a node to its grandparent. Halving then advances to the **new** parent (the grandparent), so it touches every other node. Splitting advances to the **old** parent (saved in a temp), so it re-points every node on the path. Same asymptotics, slightly different flattening pattern.

### M3. Why do halving and splitting give the same asymptotics as full compression even though they never reach a flat tree in one pass?
Because the amortized analysis depends only on the fact that every compression write moves a node strictly closer to the root, reducing the forest's potential. Whether you flatten fully in one shot or progressively, the total work over a sequence is bounded the same way.

### M4. How does compression interact with rank?
Compression makes the true height smaller than what `rank` records, but it does not decrease `rank`. So after compression, `rank` is only an **upper bound** on height, not the exact height. That is fine: rank is used only to decide which root hangs under which during union.

### M5. Does compression invalidate union by *size*?
No. Size counts elements, and re-pointing a node within its tree does not change how many elements the tree has. Size stays exact, unlike rank which becomes an upper bound.

### M6. When would you deliberately skip compression?
For a persistent or rollback DSU. Compression rewrites many parents per find, which would make snapshots expensive or undo logs explode. There you use union by rank only with a read-only find, accepting `O(log n)`.

### M7. Write the explicit two-pass full compression without recursion.
Pass 1: walk up to find `root`. Pass 2: walk the path again, setting each node's parent to `root`. This gives the fully-flat result of recursion with `O(1)` extra space and no stack risk.

### M8. Why does compression alone with union-by-size give `O(log n / log log n)` rather than `α(n)`?
Because you need the *joint* interaction of balanced union and compression to reach inverse-Ackermann. Either ingredient alone caps out around a logarithmic-ish bound; only together do they reach `α(n)`.

### M9. In Kruskal's MST, where does compression help?
Each edge does two finds. Compression keeps those finds near-constant, so the DSU work is effectively linear and the runtime is dominated by sorting the edges, `O(E log E)`.

### M10. Show a cycle-detection use.
For each edge `(u, v)`: if `find(u) == find(v)` the edge closes a cycle; otherwise `union(u, v)`. Compression keeps each find fast.

### M11. What does `union` return in a well-designed DSU, and why?
A boolean indicating whether two distinct roots were actually merged. Callers like Kruskal and cycle detection rely on this to know whether the edge was used or closed a cycle.

### M12. Why is the *first* find on a deep node still expensive even with compression?
You cannot flatten a path you have not walked. The first find must traverse the full depth; compression only makes the *subsequent* finds cheap.

---

## Senior Questions (10 Q&A)

### S1. Why is path compression awkward for a persistent DSU?
Persistence via path copying allocates new nodes for changes. Compression rewrites an arbitrary number of nodes on the find-path (up to `O(n)`), so a single query would copy `O(n)` nodes, destroying the `O(log n)`-per-version space guarantee. Persistent DSUs drop compression and use union by rank with read-only find.

### S2. Why does a rollback DSU omit compression?
Rollback undoes the last union. Without compression each union changes exactly one parent pointer, so undo is `O(1)`. With compression a single find rewrites many parents, and the undo log would have to record and restore all of them — defeating the purpose.

### S3. In a concurrent DSU, why is path splitting preferred?
Each splitting write re-points a node to its grandparent, which is always a current ancestor, and it is a single-word write. Lost or stale writes under races only cost flattening progress, never correctness. Full compression must compute the root first, and that root can go stale under a concurrent union, risking a non-ancestor write.

### S4. Sketch a lock-free splitting find.
Loop at `x`: load `p = parent[x]`; if `p == x` return `x`; load `gp = parent[p]`; `CAS(parent[x], p, gp)`; set `x = gp`. The CAS only lands if `parent[x]` is still `p`; on failure you re-read and continue. Correct because `gp` is always an ancestor when the CAS succeeds.

### S5. Can you serve `find` from a read replica?
Not with compression — compression writes, so a read-only replica cannot run it, and paths never flatten. Either flatten on the primary then serve read-only finds, or keep the DSU single-homed.

### S6. How do you make compression snapshot-friendly?
Run a flatten phase during ingest (finds with compression), then freeze to read-only find mode. After flattening, read-only finds are already near-`O(1)` because trees are flat, and the structure is safe to snapshot.

### S7. What metric tells you compression is working?
Average find-path length over time. It should trend toward ~1. If it stays high, you are either missing union by rank or silently dropping compression (e.g., on a replica).

### S8. How do massive distributed graphs do connectivity without per-node compression?
They use label propagation (e.g., Spark GraphX connected components): iteratively broadcast the minimum label to neighbors until convergence. There is no per-node parent compression; it is a bulk-parallel min-broadcast.

### S9. What is the failure mode of recursive full compression in production?
Stack overflow. A near-linear tree forms (often because union by rank was accidentally disabled), and the first recursive find recurses to depth `n`. Always use iterative variants where depth is unbounded.

### S10. Why can you not just decrease rank when compression shrinks a tree?
Correctly recomputing the true height after compression would itself cost a tree traversal per find, erasing the speedup. Leaving rank as an upper bound is cheap and harmless to the balance argument.

---

## Professional Questions (8 Q&A)

### P1. State Tarjan's theorem precisely.
A sequence of `m ≥ n` union and find operations on `n` elements using union by rank and path compression runs in `O(m · α(m, n))` total time, i.e., `Θ(α(n))` amortized per operation (Tarjan, JACM 1975).

### P2. Is the `α(n)` bound tight?
Yes. Tarjan (1979) and Fredman–Saks (1989) proved an `Ω(m · α(m, n))` lower bound in the pointer-machine / cell-probe model. So you cannot beat inverse Ackermann for the general online problem; the factor is intrinsic.

### P3. Define the inverse Ackermann function used here.
With `A_0(x) = x+1` and `A_{k+1}(x) = A_k^{(x+1)}(x)`, define `α(n) = min{ k : A_k(1) ≥ n }`. Since `A_4(1)` exceeds the number of atoms in the universe, `α(n) ≤ 4` for all realistic `n`.

### P4. Outline the proof structure of Tarjan's theorem.
Use union by rank to ensure ranks are sparse and strictly increasing up any path; note compression does not change ranks. Partition ranks into `α(n)` Ackermann "levels." Charge each find `O(α(n))` directly plus a charge to each compressed node; a node is charged only a bounded number of times per level before being promoted. Summing over levels and nodes gives `O((m+n) α(n))`.

### P5. Why do all three compression variants give the same bound?
The proof never uses which ancestor a node is re-pointed to — only that each compression write moves the node strictly closer to the root (promoting it through Ackermann levels). Full, halving, and splitting all satisfy this. Tarjan & van Leeuwen (1984) proved every variant × union-discipline combination.

### P6. Distinguish the three regimes: O(log n), O(log n / log log n), O(α(n)).
Compression alone with arbitrary union: `Θ(log n)`. Compression alone with union by size (finds analyzed separately): `Θ(log n / log log n)`. Compression + union by rank analyzed jointly: `Θ(α(n))`. Neither ingredient alone reaches inverse-Ackermann.

### P7. How does compression affect cache behavior?
A pre-compression find on a depth-`d` scattered node incurs `Θ(d)` dependent cache misses. After compression the node points directly at the root: `O(1)` misses. Compression collapses a chain of dependent misses into a single load — often the dominant real-world speedup.

### P8. Is there a linear-time DSU?
For the general online problem, no — `Ω(m α(m,n))` is a lower bound. But Gabow & Tarjan (1985) gave an `O(m)` algorithm for the special offline case where the union tree is known in advance. Structure can beat the general bound; arbitrary interleavings cannot.

---

## Behavioral / System-Design Questions (5)

### B1. Tell me about a time you chose Union-Find for a problem.
Look for a structured story: the problem (connectivity, MST, deduplicating equivalence classes), why DSU beat alternatives (BFS/DFS recomputation, a hash-based grouping), and the specific choice of compression variant and union rule. Strong answers mention measuring average path length or runtime, and the trade-off considered (e.g., dropping compression for rollback).

### B2. Design an incremental connectivity service (unions stream in, queries ask "connected?").
DSU with iterative halving + union by rank in-process. Discuss bounding memory (`8n` bytes), what happens when the element set exceeds one machine (shard with local-only compression, or coordinator-side DSU), durability (snapshot a flattened forest), and observability (average path length, component count).

### B3. You need to support "undo the last union." How does that change your design?
Drop path compression; use union by rank only with a read-only find. Each union changes exactly one parent and at most one rank, logged for `O(1)` rollback. Explain that compression would make the undo log explode. This is the offline dynamic-connectivity pattern.

### B4. A teammate added recursive full compression and prod crashed. What happened and how do you fix it?
A deep near-linear tree formed (likely union by rank was disabled or union order was adversarial), and the first recursive find overflowed the stack. Fix: switch to iterative halving/splitting (or explicit two-pass), and verify union by rank is actually active so trees stay shallow. Add a metric for max path length.

### B5. How would you validate a DSU implementation under review?
Property-test against a brute-force connectivity oracle on random operation sequences; assert that two elements report the same root iff a reference union-find says they are connected. Check the partition invariant after every op, confirm `union` returns the merge boolean correctly, and confirm finds never increase any node's depth.

---

## Coding Challenges

### Challenge 1: Implement iterative path-halving find

**Problem.** Implement a DSU with `union` (by rank) and an **iterative path-halving** `find`. No recursion allowed. Support `connected(a, b)`.

**Why halving.** It is the production default: one pass, no stack risk.

**Go.**

```go
package main

import "fmt"

type DSU struct {
	parent, rank []int
}

func NewDSU(n int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &DSU{parent: p, rank: make([]int, n)}
}

func (d *DSU) Find(x int) int { // iterative path halving
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]]
		x = d.parent[x]
	}
	return x
}

func (d *DSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return false
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
	return true
}

func (d *DSU) Connected(a, b int) bool { return d.Find(a) == d.Find(b) }

func main() {
	d := NewDSU(5)
	d.Union(0, 1)
	d.Union(1, 2)
	fmt.Println(d.Connected(0, 2)) // true
	fmt.Println(d.Connected(0, 3)) // false
}
```

**Java.**

```java
public class DSU {
    private final int[] parent, rank;

    public DSU(int n) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    public int find(int x) {            // iterative path halving
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

    public boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
        return true;
    }

    public boolean connected(int a, int b) { return find(a) == find(b); }

    public static void main(String[] args) {
        DSU d = new DSU(5);
        d.union(0, 1);
        d.union(1, 2);
        System.out.println(d.connected(0, 2)); // true
        System.out.println(d.connected(0, 3)); // false
    }
}
```

**Python.**

```python
class DSU:
    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:        # iterative path halving
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        return True

    def connected(self, a: int, b: int) -> bool:
        return self.find(a) == self.find(b)


if __name__ == "__main__":
    d = DSU(5)
    d.union(0, 1)
    d.union(1, 2)
    print(d.connected(0, 2))  # True
    print(d.connected(0, 3))  # False
```

**Follow-up.** Rewrite `find` as path splitting; state how the resulting `parent[]` differs after one call.

---

### Challenge 2: Count pointer rewrites done by compression

**Problem.** Instrument `find` to return both the root and the number of `parent[]` writes the compression performed. Build a chain of `n` nodes, run `find` on the deepest node under each variant, and report the write counts. This makes the variant differences concrete.

**Expected.** On a fresh chain `0→1→…→n-1`: full compression rewrites `n-1` nodes in one call; halving rewrites about `(n-1)/2`; splitting rewrites about `n-2`. (Exact counts depend on indexing; the point is full ≈ splitting in writes, halving ≈ half.)

**Go.**

```go
package main

import "fmt"

func buildChain(n int) []int {
	p := make([]int, n)
	for i := 0; i < n-1; i++ {
		p[i] = i + 1
	}
	p[n-1] = n - 1
	return p
}

func findFull(p []int, x int) (int, int) {
	if p[x] == x {
		return x, 0
	}
	root, w := findFull(p, p[x])
	if p[x] != root {
		p[x] = root
		w++
	}
	return root, w
}

func findHalving(p []int, x int) (int, int) {
	w := 0
	for p[x] != x {
		p[x] = p[p[x]]
		w++
		x = p[x]
	}
	return x, w
}

func findSplitting(p []int, x int) (int, int) {
	w := 0
	for p[x] != x {
		next := p[x]
		p[x] = p[p[x]]
		w++
		x = next
	}
	return x, w
}

func main() {
	n := 9
	for _, tc := range []struct {
		name string
		f    func([]int, int) (int, int)
	}{{"full", findFull}, {"halving", findHalving}, {"splitting", findSplitting}} {
		p := buildChain(n)
		root, w := tc.f(p, 0)
		fmt.Printf("%-10s root=%d writes=%d\n", tc.name, root, w)
	}
}
```

**Java.**

```java
public class CompressionWrites {
    static int[] buildChain(int n) {
        int[] p = new int[n];
        for (int i = 0; i < n - 1; i++) p[i] = i + 1;
        p[n - 1] = n - 1;
        return p;
    }

    static int writes;

    static int findFull(int[] p, int x) {
        if (p[x] == x) return x;
        int root = findFull(p, p[x]);
        if (p[x] != root) { p[x] = root; writes++; }
        return root;
    }

    static int findHalving(int[] p, int x) {
        while (p[x] != x) { p[x] = p[p[x]]; writes++; x = p[x]; }
        return x;
    }

    static int findSplitting(int[] p, int x) {
        while (p[x] != x) { int next = p[x]; p[x] = p[p[x]]; writes++; x = next; }
        return x;
    }

    public static void main(String[] args) {
        int n = 9;
        writes = 0; int[] a = buildChain(n);
        int r1 = findFull(a, 0);
        System.out.printf("full       root=%d writes=%d%n", r1, writes);
        writes = 0; int[] b = buildChain(n);
        int r2 = findHalving(b, 0);
        System.out.printf("halving    root=%d writes=%d%n", r2, writes);
        writes = 0; int[] c = buildChain(n);
        int r3 = findSplitting(c, 0);
        System.out.printf("splitting  root=%d writes=%d%n", r3, writes);
    }
}
```

**Python.**

```python
import sys


def build_chain(n):
    return list(range(1, n)) + [n - 1]


def find_full(p, x):
    if p[x] == x:
        return x, 0
    root, w = find_full(p, p[x])
    if p[x] != root:
        p[x] = root
        w += 1
    return root, w


def find_halving(p, x):
    w = 0
    while p[x] != x:
        p[x] = p[p[x]]
        w += 1
        x = p[x]
    return x, w


def find_splitting(p, x):
    w = 0
    while p[x] != x:
        nxt = p[x]
        p[x] = p[p[x]]
        w += 1
        x = nxt
    return x, w


if __name__ == "__main__":
    sys.setrecursionlimit(100000)
    n = 9
    for name, f in [("full", find_full), ("halving", find_halving), ("splitting", find_splitting)]:
        root, w = f(build_chain(n), 0)
        print(f"{name:<10} root={root} writes={w}")
```

**Follow-up.** Run a second `find(0)` after the first on the *same* compressed array under each variant; the write count should drop to near zero because the tree is already flat.

---

### Challenge 3: Number of connected components (Union-Find application)

**Problem.** Given `n` nodes and a list of undirected edges, return the number of connected components. Use a path-compressed DSU.

**Optimal.** Start with `n` components; each successful `union` reduces the count by one. `O((n + e) α(n))`.

**Go.**

```go
package main

import "fmt"

type DSU struct{ parent, rank []int }

func NewDSU(n int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &DSU{p, make([]int, n)}
}

func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]]
		x = d.parent[x]
	}
	return x
}

func (d *DSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return false
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
	return true
}

func countComponents(n int, edges [][2]int) int {
	d := NewDSU(n)
	count := n
	for _, e := range edges {
		if d.Union(e[0], e[1]) {
			count--
		}
	}
	return count
}

func main() {
	fmt.Println(countComponents(5, [][2]int{{0, 1}, {1, 2}, {3, 4}})) // 2
}
```

**Java.**

```java
import java.util.*;

public class CountComponents {
    int[] parent, rank;

    int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
        return true;
    }

    int countComponents(int n, int[][] edges) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        int count = n;
        for (int[] e : edges) if (union(e[0], e[1])) count--;
        return count;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {1, 2}, {3, 4}};
        System.out.println(new CountComponents().countComponents(5, edges)); // 2
    }
}
```

**Python.**

```python
def count_components(n, edges):
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    count = n
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]:
            rank[ra] += 1
        count -= 1
    return count


if __name__ == "__main__":
    print(count_components(5, [(0, 1), (1, 2), (3, 4)]))  # 2
```

**Follow-up.** Modify to also return the size of the largest component (track sizes with union by size instead of rank).

---

## Common Pitfalls in Interviews

- **Returning `x` instead of `parent[x]` from the recursive find.** After compression `parent[x]` is the root; returning the original `x` is wrong.
- **Forgetting to advance `x` in the iterative loop.** In halving you must `x = parent[x]` after re-pointing; in splitting you must advance to the saved old parent. Omit it and you loop forever or return the wrong node.
- **Confusing halving and splitting.** Halving advances to the new grandparent; splitting advances to the old parent. Be precise on the whiteboard.
- **Using recursive compression on huge inputs.** The interviewer may ask "what if the chain has 10 million nodes?" — the answer is iterative, to avoid stack overflow.
- **Claiming `O(α(n))` for compression alone.** Compression alone is `O(log n)`; you need union by rank for `O(α(n))`. Stating this distinction precisely is a strong signal.
- **Saying `α(n)` is "constant."** It is *effectively* constant (≤ 4) but provably non-constant; say "near-constant, inverse Ackermann."
- **Adding compression to a rollback/persistent DSU.** That breaks the undo/snapshot guarantees. Recognize when to *omit* compression.
- **Decreasing rank after compression.** Don't — rank stays an upper bound; recomputing true height would erase the speedup.

---

## What Interviewers Are Really Testing

A path-compression question is small, so it is a magnifying glass on depth of understanding. Interviewers check three things. First, **do you know the variants and their trade-offs?** Anyone can recite the recursive one-liner; the strong candidate knows that production code uses iterative halving or splitting precisely because the recursive version can overflow the stack, and can explain why splitting is the concurrency-safe choice. Second, **can you reason about amortized complexity carefully?** The chain of bounds — `O(n)` naive, `O(log n)` compression alone, `O(log n / log log n)` with union by size alone, `O(α(n))` jointly with union by rank — is a precise litmus test, and stating that neither ingredient alone reaches inverse-Ackermann shows real understanding. Third, **do you know when to turn compression off?** Recognizing that persistence, rollback, replication, and sharding all force you to drop compression in favor of a read-only find separates a candidate who memorized the optimization from one who understands its architectural cost. The best answers also connect the structure to where it is used — Kruskal's MST, cycle detection, offline LCA, connected components — and mention how they would validate the implementation (property-testing against a brute-force oracle) and monitor it in production (average path length trending toward 1).
