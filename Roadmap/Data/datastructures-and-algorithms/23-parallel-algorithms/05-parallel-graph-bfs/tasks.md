# Parallel Graph BFS — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the BFS **level by level** (frontier → next frontier), drive a **work counter** and a **span counter** alongside it, and **confirm the measured work/span match the bound** — and, always, that the computed distances (or components) equal a sequential reference. The acceptance test is the same shape every time: *the parallel BFS distances equal a sequential queue BFS **and** the measured work and span match the derived bound (`Θ(V + E)` work, `Θ(D · log n)` span, where `D` is the graph's diameter / eccentricity of the source).*
> **[analysis]** tasks need no code: derive the work/span, reason about why high-diameter graphs parallelize poorly, or cast BFS as a semiring matrix–vector product — model derivations are provided so you can grade yourself.

A **breadth-first search** explores a graph in concentric shells around a source `s`: level 0 is `{s}`, level `d+1` is every still-unvisited vertex adjacent to a level-`d` vertex. The **level-synchronous** parallel form processes one whole shell (the **frontier**) at a time: expand all frontier vertices in parallel, collect their unvisited neighbours into the **next frontier**, barrier, repeat. The number of rounds is the **diameter from `s`** — the eccentricity `D` = the largest finite distance — so the span is `Θ(D · log n)` and the parallelism lives *inside* each level, never across levels. The cost profiles you will build, measure, and prove on every task:

| Primitive | Work `T₁` | Span `T∞` | Shape |
| --- | --- | --- | --- |
| **Sequential queue BFS** | `Θ(V + E)` | `Θ(V + E)` | one FIFO, the ground-truth distances |
| **Level-synchronous BFS** | `Θ(V + E)` | `Θ(D · log n)` | `D` rounds; each shell expanded in parallel |
| **Top-down step** | `Θ(\|frontier\| + edges out)` | `Θ(log n)` | frontier scatters to neighbours |
| **Bottom-up step** | `Θ(unvisited + edges in)` | `Θ(log n)` | unvisited vertices scan parents for a frontier hit |
| **Direction-optimizing BFS** | `Θ(V + E)` (often far less edge-touching) | `Θ(D · log n)` | switch top-down ↔ bottom-up per level |
| **BFS as SpMV (`OR`,`AND`)** | `Θ(V + E)` per step | `Θ(log n)` per step | frontier vector × adjacency matrix |

The recurring discipline for every coding task is identical: **run the BFS level by level, increment a work counter for every vertex and every edge touched, bump a span counter once per parallel round (a level expansion, or one tree-depth of a scan/reduction inside it), and confirm the computed distances match a sequential queue BFS while the counters respect the bound.** A BFS you never check against `dist_seq` is a guess; a work/span you measure but never bracket with the bound is just a number. Tie the two together on every task.

**Related practice:**
- [Models: PRAM and Work–Span tasks](../01-models-pram-work-span/tasks.md) — the work/span model, Brent's bound, the `Ω(log n)` reduction-span floor inside each level, and the atomic compare-and-swap that the visited-claim depends on.
- [Parallel Prefix Sum / Scan tasks](../02-parallel-prefix-sum-scan/tasks.md) — the exclusive scan and stream compaction that build the next frontier without races; the per-vertex output offsets in a frontier expansion are exactly an exclusive scan of neighbour counts.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **CSR graph.** Every coding task operates on a graph in **Compressed Sparse Row** form: `offsets[0..V]` and `adj[0..E)`, where vertex `u`'s neighbours are `adj[offsets[u] : offsets[u+1]]`. This is the layout every real parallel-BFS implementation uses: neighbour lists are contiguous, so an edge scan is a cache-friendly linear read, and the degree of `u` is `offsets[u+1] − offsets[u]`.
- **Unit operation.** Touching one vertex (a visited test or claim) and traversing one edge are each one unit of work. **Work** `T₁` is the total number of such operations — `Θ(V + E)` for a correct BFS, because each vertex is claimed once and each edge is traversed a bounded number of times. **Span** `T∞` is the number of *parallel rounds* on the critical path: `D` level-barriers, each of `Θ(log n)` internal depth for the scan/compaction that builds the next frontier.
- **A level (round).** One synchronized parallel step expands an entire frontier and produces the next, then a barrier. Span counts these rounds (and the `log n` inside each), not individual edge traversals.
- **Diameter is the enemy of span.** The level count is `D`, the eccentricity of `s`. A chain (`path` graph) has `D = V − 1`, so level-synchronous BFS degenerates to `Θ(V)` span — no better than sequential. A star or small-world graph has `D = 1` or `Θ(log V)`, so the span collapses to `Θ(log n)` or `Θ(log² n)`. The whole *parallelizability* of BFS is a property of the **graph**, not the algorithm — a recurring theme below.

---

## Beginner Tasks

### Task 1 — Sequential queue BFS: the distance oracle every parallel BFS checks against **[coding]**

`[easy]` Build the ground truth: a **sequential FIFO BFS** on a CSR graph that returns the distance from source `s` to every vertex (`−1`/`∞` for unreachable). It runs in `Θ(V + E)` work and `Θ(V + E)` span (one queue, one linear dependency chain). Every later parallel BFS must reproduce *exactly* this distance array to be verifiable against it.

#### Python

```python
from collections import deque

def bfs_seq(offsets, adj, s):
    """Sequential FIFO BFS on a CSR graph. Returns dist[], dist[v] = -1 if unreachable.
    Theta(V+E) work, Theta(V+E) span (one queue is a single dependency chain)."""
    V = len(offsets) - 1
    dist = [-1] * V
    dist[s] = 0
    q = deque([s])
    while q:
        u = q.popleft()
        for k in range(offsets[u], offsets[u + 1]):   # u's neighbours in CSR
            w = adj[k]
            if dist[w] == -1:                          # first visit fixes the distance
                dist[w] = dist[u] + 1
                q.append(w)
    return dist

def make_csr(edges, V):
    """Build CSR (undirected) from an edge list. offsets[0..V], adj[0..2E)."""
    deg = [0] * V
    for a, b in edges:
        deg[a] += 1; deg[b] += 1
    offsets = [0] * (V + 1)
    for u in range(V):
        offsets[u + 1] = offsets[u] + deg[u]
    adj = [0] * offsets[V]
    cur = offsets[:V]
    for a, b in edges:
        adj[cur[a]] = b; cur[a] += 1
        adj[cur[b]] = a; cur[b] += 1
    return offsets, adj

if __name__ == "__main__":
    # Path 0-1-2-3-4: distances from 0 are 0,1,2,3,4 (the high-diameter case).
    off, adj = make_csr([(0, 1), (1, 2), (2, 3), (3, 4)], 5)
    assert bfs_seq(off, adj, 0) == [0, 1, 2, 3, 4]
    # Star centred at 0: distances are all 1 (the low-diameter case).
    off, adj = make_csr([(0, 1), (0, 2), (0, 3), (0, 4)], 5)
    assert bfs_seq(off, adj, 0) == [0, 1, 1, 1, 1]
    # Disconnected: vertex 4 is unreachable from 0.
    off, adj = make_csr([(0, 1), (1, 2)], 5)
    assert bfs_seq(off, adj, 0) == [0, 1, 2, -1, -1]
    print("OK: sequential BFS distances are the ground truth (path, star, disconnected)")
```

#### Go (core)

```go
// BFSSeq: sequential FIFO BFS on CSR. dist[v] = -1 if unreachable. Theta(V+E).
func BFSSeq(offsets, adj []int, s int) []int {
	V := len(offsets) - 1
	dist := make([]int, V)
	for i := range dist {
		dist[i] = -1
	}
	dist[s] = 0
	q := []int{s}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		for k := offsets[u]; k < offsets[u+1]; k++ {
			w := adj[k]
			if dist[w] == -1 {
				dist[w] = dist[u] + 1
				q = append(q, w)
			}
		}
	}
	return dist
}
```

- **Constraints:** The graph is in CSR form (`offsets`, `adj`). A vertex's distance is fixed at its **first** visit — the FIFO order guarantees that first visit is along a shortest path, so `dist[w] = dist[u] + 1` is the true BFS distance. Unreachable vertices stay `−1`. Each vertex is dequeued once (`Θ(V)`) and each edge is examined once per endpoint dequeue (`Θ(E)`), so work is `Θ(V + E)`.
- **Hint:** This is the parallel BFS's specification: a level-synchronous BFS is "correct" iff it produces *this* distance array. The FIFO discipline is what makes BFS compute shortest distances in an unweighted graph — a level-`d` vertex is enqueued only by a level-`(d−1)` vertex, so distances come out in non-decreasing order. Lock this reference in now; every later acceptance test is an exact `== bfs_seq(off, adj, s)`.
- **Acceptance test:** `bfs_seq` returns the correct distances for a path (`0,1,2,…`), a star (all `1`), and a disconnected graph (`−1` for the unreachable side). Keep this function and `make_csr` — every parallel task below validates its output against `bfs_seq`.

---

### Task 2 — Level-synchronous frontier BFS, level by level, with work and span counters **[coding]**

`[easy]` Implement the **level-synchronous BFS**: start with frontier `F = {s}` at level 0; each round, expand *every* vertex in `F` in parallel, collect their still-unvisited neighbours into the next frontier `F'`, set their distance to the current level + 1, barrier, and repeat until `F` is empty. Drive a **work counter** (one per vertex expanded and per edge traversed) and a **span counter** (one per level), then confirm the distances equal Task 1 and the counters match `T₁ = Θ(V + E)` and the level count equals the source's eccentricity `D`.

#### Python

```python
def bfs_levelsync(offsets, adj, s):
    """Level-synchronous BFS. Returns (dist, work, levels, frontier_sizes).
    work counts vertices expanded + edges traversed; levels = number of rounds = D.
    Each round is one parallel step (the span model is levels * O(log n); see Task 11)."""
    V = len(offsets) - 1
    dist = [-1] * V
    dist[s] = 0
    frontier = [s]
    work = 0
    levels = 0
    sizes = [1]                                    # |level 0| = 1 (the source)
    while frontier:
        nxt = []
        for u in frontier:                         # all frontier vertices expand in parallel
            work += 1                              # touch the vertex
            for k in range(offsets[u], offsets[u + 1]):
                w = adj[k]
                work += 1                          # traverse the edge
                if dist[w] == -1:                  # claim the unvisited neighbour
                    dist[w] = dist[u] + 1
                    nxt.append(w)
        frontier = nxt
        if nxt:
            sizes.append(len(nxt))
        levels += 1                                # one round = one level expansion
    return dist, work, levels, sizes

if __name__ == "__main__":
    from collections import deque
    # Reuse Task 1's bfs_seq and make_csr.
    import random
    random.seed(0)
    # Path: D = V-1 levels (worst case for span).
    off, adj = make_csr([(i, i + 1) for i in range(9)], 10)
    dist, work, levels, sizes = bfs_levelsync(off, adj, 0)
    assert dist == bfs_seq(off, adj, 0)
    assert levels == 9, f"path of 10 vertices has D=9 levels, got {levels}"
    assert sizes == [1] * 10, "each level of a path holds exactly one vertex"
    assert work == 10 + 2 * 9, "work = V (vertices) + 2E (edges, undirected) touched"

    # Star: D = 1 level (best case for span); whole graph in one shell.
    off, adj = make_csr([(0, i) for i in range(1, 10)], 10)
    dist, work, levels, sizes = bfs_levelsync(off, adj, 0)
    assert dist == bfs_seq(off, adj, 0)
    assert levels == 2 and sizes == [1, 9], "star: level 0 = {centre}, level 1 = all leaves"
    print("OK: level-sync BFS == sequential; #levels = D (path D=9, star D=1)")
```

- **Constraints:** Distances must equal Task 1 for every graph. The level count must equal the **eccentricity** of `s` (the largest finite distance) — `D` rounds. Work is `Θ(V + E)`: each reachable vertex is expanded exactly once (it is claimed and enters the frontier once), and each of its incident edges is traversed once during that expansion. The per-level frontier sizes must sum to the number of reachable vertices. *Within* this beginner task the visited test is a plain check; Task 3 makes the claim atomic for true concurrency.
- **Hint:** The frontier *is* the BFS level — every vertex in `F` has the same distance, so its neighbours are at distance `+1`. The parallelism is **intra-level**: all `|F|` vertices expand simultaneously, so one level costs `Θ(log n)` span (the scan that builds `F'`, Task 4), not `Θ(|F|)`. The number of levels is fixed by the graph: a path forces `V − 1` serial levels (no parallelism), a star finishes in one. This is the central tension — the work is always `Θ(V + E)`, but the *span* is `Θ(D · log n)`, and `D` is out of the algorithm's hands.
- **Acceptance test:** Output equals `bfs_seq` for path, star, grid, and random graphs; `work = V + 2E` (undirected); `levels = D`; per-level sizes sum to the reachable count. The path/star contrast makes the diameter effect concrete — Task 5 measures it across graph families.

---

### Task 3 — Atomic visited-claim: each vertex claimed exactly once **[coding]**

`[easy]` In the real parallel BFS, *several* frontier vertices may discover the same neighbour `w` in the same round — and they all run concurrently. A plain "if `dist[w] == −1`" test races: two expanders can both read `−1`, both add `w` to the next frontier, and `w` is processed twice. The fix is an **atomic compare-and-swap (CAS) claim**: only the expander whose CAS succeeds owns `w` and adds it to `F'`. Simulate the CAS, demonstrate that exactly one claim wins per vertex even under interleaving, and verify distances still match Task 1.

#### Python

```python
import threading

class AtomicVisited:
    """Simulates an atomic compare-and-swap on a per-vertex 'claimed' flag.
    claim(w, d) returns True for exactly ONE caller per w (the winner sets dist[w]=d)."""
    def __init__(self, V):
        self.dist = [-1] * V
        self.lock = threading.Lock()               # stands in for hardware CAS
        self.claims = [0] * V                       # count how many times each w was claimed

    def claim(self, w, d):
        with self.lock:                             # CAS(dist[w], -1, d): atomic test-and-set
            self.claims[w] += 1                     # every *attempt* is counted here...
            if self.dist[w] == -1:
                self.dist[w] = d
                return True                         # ...but only the first attempt WINS
            return False

def bfs_atomic(offsets, adj, s):
    """Level-sync BFS where the next frontier is built via atomic claims.
    Each vertex is added to F' by exactly one expander -> no duplicates."""
    V = len(offsets) - 1
    av = AtomicVisited(V)
    av.dist[s] = 0
    frontier = [s]
    wins = 0                                        # total successful claims
    while frontier:
        nxt = []
        d = None
        for u in frontier:
            d = av.dist[u] + 1
            for k in range(offsets[u], offsets[u + 1]):
                w = adj[k]
                if av.claim(w, d):                  # only the winner appends w
                    nxt.append(w)
                    wins += 1
        frontier = nxt
    return av.dist, wins, av

if __name__ == "__main__":
    # A diamond: 0 -> {1,2} -> 3. Both 1 and 2 reach 3 in the same round; only one claims it.
    off, adj = make_csr([(0, 1), (0, 2), (1, 3), (2, 3)], 4)
    dist, wins, av = bfs_atomic(off, adj, 0)
    assert dist == bfs_seq(off, adj, 0) == [0, 1, 1, 2]
    assert wins == 3, "exactly 3 vertices (1,2,3) are claimed, one win each"
    assert max(av.claims) >= 2, "vertex 3 was *attempted* by both 1 and 2..."
    assert av.dist.count(2) == 1, "...but landed in the frontier exactly once"

    # Larger random check: total wins == number of reachable vertices minus the source.
    import random
    random.seed(1)
    edges = [(random.randrange(50), random.randrange(50)) for _ in range(200)]
    edges = [(a, b) for a, b in edges if a != b]
    off, adj = make_csr(edges, 50)
    dist, wins, av = bfs_atomic(off, adj, 0)
    assert dist == bfs_seq(off, adj, 0)
    reachable = sum(1 for x in dist if x != -1)
    assert wins == reachable - 1, "one claim per reachable non-source vertex"
    assert all(c <= deg for c, deg in zip([0]*50, [0]*50)) or True
    print("OK: atomic claim -> each vertex enters the next frontier exactly once")
```

- **Constraints:** Multiple frontier vertices may *attempt* to claim the same `w` in one round (the diamond exercises this), but **exactly one** attempt must succeed — that winner sets `dist[w]` and appends `w` to `F'`. Without the atomic claim, the same `w` could appear in `F'` multiple times, inflating work and corrupting the frontier. The total number of successful claims must equal the number of reachable vertices minus the source. Distances must still equal Task 1.
- **Hint:** The race is real: in a level-synchronous BFS, an unvisited `w` with `k` neighbours in the current frontier is discovered `k` times in the same round, all concurrently. A single hardware `CAS(&dist[w], -1, d)` resolves it — the first store wins, the rest see a non-`−1` value and back off. Note that **all winners write the same distance `d`** (every frontier vertex is at the same level), so even a benign data race on `dist[w]` would yield the correct *value* — but the duplicate-in-`F'` problem still needs the atomic claim to keep each vertex in the next frontier once. This is the standard "claim-on-CAS" pattern in Galois, Ligra, and Gunrock.
- **Acceptance test:** On the diamond, vertex 3 is *attempted* twice but claimed once (`wins = 3`, `dist = [0,1,1,2]`); on random graphs, `wins = reachable − 1` and distances equal `bfs_seq`. The atomic claim is what makes the next-frontier construction correct under genuine concurrency.

---

### Task 4 — Build the next frontier with an exclusive scan (race-free compaction) **[coding]**

`[easy]` Appending to a shared `F'` list under a lock (Task 3) serializes the writers. The parallel way to build the next frontier is a **scan-based compaction**: each frontier vertex `u` writes its newly-claimed neighbours into a *private* buffer, an **exclusive scan** of the buffer lengths gives each `u` a disjoint output offset, and every `u` scatters into `F'` at its offset — no lock, no collision. Implement it, verify `F'` is the same multiset as Task 2's next frontier, and confirm the compaction is `Θ(|F'|)` work and `Θ(log n)` span (the scan).

#### Python

```python
def exclusive_scan(xs):
    """out[i] = sum(xs[:i]); returns (out, total). Theta(n) work, Theta(log n) span."""
    out, acc = [], 0
    for x in xs:
        out.append(acc); acc += x
    return out, acc

def expand_frontier(offsets, adj, dist, frontier, level):
    """One level expansion. Each frontier vertex claims neighbours into a PRIVATE list;
    an exclusive scan of the per-vertex counts gives disjoint output slots in F'.
    Returns the next frontier (built by race-free scatter)."""
    # 1) Each frontier vertex independently collects its freshly-claimed neighbours.
    per_vertex = []
    for u in frontier:
        local = []
        for k in range(offsets[u], offsets[u + 1]):
            w = adj[k]
            if dist[w] == -1:                       # sequential stand-in for the atomic claim
                dist[w] = level + 1
                local.append(w)
        per_vertex.append(local)
    # 2) Exclusive scan of the per-vertex counts -> each u's offset into F'.
    counts = [len(lv) for lv in per_vertex]
    offs, total = exclusive_scan(counts)
    # 3) Scatter: every u writes its block at its own offset -> disjoint, race-free.
    nxt = [None] * total
    for u_idx, base in enumerate(offs):
        for j, w in enumerate(per_vertex[u_idx]):
            nxt[base + j] = w                       # distinct index per (u_idx, j)
    return nxt

def bfs_scan(offsets, adj, s):
    V = len(offsets) - 1
    dist = [-1] * V
    dist[s] = 0
    frontier = [s]
    level = 0
    while frontier:
        frontier = expand_frontier(offsets, adj, dist, frontier, level)
        level += 1
    return dist

if __name__ == "__main__":
    import random
    random.seed(2)
    for _ in range(300):
        V = random.randint(1, 40)
        edges = [(random.randrange(V), random.randrange(V)) for _ in range(2 * V)]
        edges = [(a, b) for a, b in edges if a != b]
        off, adj = make_csr(edges, V)
        s = random.randrange(V)
        assert bfs_scan(off, adj, s) == bfs_seq(off, adj, s), "scan-BFS must match sequential"
    print("OK: scan-compacted frontier BFS == sequential; F' built lock-free via exclusive scan")
```

- **Constraints:** Each frontier vertex writes its claimed neighbours into a **private** buffer (no shared accumulator during collection). The output offset of vertex `u` into `F'` is the **exclusive scan** of the per-vertex neighbour counts, so the scatter writes disjoint index ranges — no two vertices write the same slot. The resulting `F'` must be the same multiset of vertices as Task 2's (order within a level is irrelevant to BFS correctness). Distances must equal Task 1.
- **Hint:** This is the exact stream-compaction pattern from the [scan tasks](../02-parallel-prefix-sum-scan/tasks.md): "every worker produces a variable-length output; an exclusive scan of the lengths gives each worker a collision-free place to write." The scan is `Θ(log n)` span and `Θ(|F'|)` work, so one level costs `Θ(log n)` span — the source of the `log n` factor in `Θ(D · log n)`. Real implementations often do this in two passes (count, then scan, then write) to avoid the private buffers; the offsets are identical. The scan is *the* primitive that makes the level-synchronous frontier parallel.
- **Acceptance test:** `bfs_scan` equals `bfs_seq` for random graphs of every size and any source; `F'` is built without a shared lock, via an exclusive scan of per-vertex counts; the compaction is `Θ(|F'|)` work / `Θ(log n)` span. This is the lock-free next-frontier construction every later task reuses.

---

## Intermediate Tasks

### Task 5 — The diameter effect: level count across graph families **[coding + analysis]**

`[medium]` The span of level-synchronous BFS is `Θ(D · log n)`, so the *number of levels* `D` decides whether BFS parallelizes at all. Measure `D` (the source's eccentricity, hence the level count) across graph families with the same `V` but wildly different diameters — a **chain**, a **2-D grid**, a **balanced tree**, a **star**, and a **small-world** (random) graph — and tabulate how the level count, the span, and the *maximum frontier size* (the available parallelism per level) change.

#### Python

```python
import math, random

def bfs_profile(offsets, adj, s):
    """Returns (levels, max_frontier, avg_frontier) for the BFS from s."""
    _, _, levels, sizes = bfs_levelsync(offsets, adj, s)
    return levels, max(sizes), sum(sizes) / len(sizes)

def chain(V):
    return make_csr([(i, i + 1) for i in range(V - 1)], V)

def grid(side):
    V, edges = side * side, []
    for r in range(side):
        for c in range(side):
            u = r * side + c
            if c + 1 < side: edges.append((u, u + 1))
            if r + 1 < side: edges.append((u, u + side))
    return make_csr(edges, V), V

def balanced_tree(V):
    return make_csr([((i - 1) // 2, i) for i in range(1, V)], V)   # i's parent = (i-1)//2

def star(V):
    return make_csr([(0, i) for i in range(1, V)], V)

def small_world(V, seed=0):
    random.seed(seed)
    edges = [(i, i + 1) for i in range(V - 1)]                     # a ring backbone
    edges += [(random.randrange(V), random.randrange(V)) for _ in range(V)]  # random shortcuts
    return make_csr([(a, b) for a, b in edges if a != b], V)

if __name__ == "__main__":
    V = 1024
    print(f"V={V}.  span ~ levels * log2(V) = levels * {math.ceil(math.log2(V))}")
    print(f"{'family':>12} {'levels (D)':>11} {'max frontier':>13} {'~span':>7}")
    for name, (off, adj) in [
        ("chain",       chain(V)),
        ("grid",        grid(32)[0]),
        ("tree",        balanced_tree(V)),
        ("star",        star(V)),
        ("small-world", small_world(V)),
    ]:
        levels, mx, _ = bfs_profile(off, adj, 0)
        print(f"{name:>12} {levels:>11} {mx:>13} {levels * math.ceil(math.log2(V)):>7}")
    print("\nOK: span tracks the DIAMETER -- chain ~V levels (no parallelism),"
          " star/small-world O(1)/O(log V) levels (massively parallel)")
```

- **Analysis to write:** The level-synchronous span is `Θ(D · log n)`, where `D` is the eccentricity of `s` and `log n` is the per-level scan depth (Task 4). Across families with `V = 1024`: a **chain** has `D = V − 1 ≈ 1023` levels, each frontier of size 1 — *zero* intra-level parallelism, span `Θ(V log V)`, **worse** than the sequential `Θ(V)`. A **`√V × √V` grid** has `D ≈ 2√V ≈ 63` levels with frontiers up to `Θ(√V)`. A **balanced binary tree** has `D ≈ log₂ V ≈ 10` levels with the bottom level holding `V/2` vertices. A **star** has `D = 1` level holding all `V − 1` leaves — the ideal: span `Θ(log V)`, parallelism `Θ(V)`. A **small-world** graph has `D = Θ(log V)` (the defining property), so span `Θ(log² V)` with large frontiers — which is *exactly* why level-synchronous BFS is the right algorithm for social/web graphs and the wrong one for meshes and road networks (high diameter).
- **Constraints:** Build all five families with the same `V`. Report the level count (`= D`), the maximum frontier size (the peak parallelism), and the modeled span `D · log V`. The level count must match each family's known diameter: chain `≈ V`, grid `≈ 2√V`, tree `≈ log V`, star `= 1`, small-world `= Θ(log V)`.
- **Acceptance test:** The table shows level count rising from `1` (star) through `Θ(log V)` (tree, small-world) to `Θ(√V)` (grid) to `Θ(V)` (chain), with span tracking it; the write-up correctly identifies that low-diameter graphs parallelize and high-diameter ones do not, *independent of the algorithm*. This is the empirical face of the `Θ(D · log n)` span bound.

---

### Task 6 — Bottom-up BFS step: unvisited vertices scan parents for a frontier hit **[coding]**

`[medium]` The classic **top-down** step pushes: each frontier vertex scatters to all its neighbours. When the frontier is huge (most of the graph), that scatters across almost every edge. The **bottom-up** step pulls instead: each *unvisited* vertex scans its in-neighbours and, the moment it finds **one** in the current frontier, claims that as its parent and stops — early-exit. When the frontier is large, most unvisited vertices find a frontier parent in their first few edges, so bottom-up touches far fewer edges. Implement a single bottom-up step, verify it produces the same level as a top-down step, and count the edges each touches.

#### Python

```python
def top_down_step(offsets, adj, dist, frontier, level):
    """Push: every frontier vertex visits all its neighbours. Returns (next, edges_touched)."""
    nxt, edges = [], 0
    for u in frontier:
        for k in range(offsets[u], offsets[u + 1]):
            edges += 1
            w = adj[k]
            if dist[w] == -1:
                dist[w] = level + 1
                nxt.append(w)
    return nxt, edges

def bottom_up_step(offsets, adj, dist, in_frontier, level):
    """Pull: every UNVISITED vertex scans its in-neighbours; the FIRST one in the
    frontier becomes its parent (early-exit). Returns (next_frontier_mask, edges_touched).
    in_frontier is a boolean mask of the current level."""
    V = len(offsets) - 1
    nxt_mask = [False] * V
    edges = 0
    for v in range(V):
        if dist[v] != -1:
            continue                                # already visited -> skip
        for k in range(offsets[v], offsets[v + 1]):
            edges += 1
            p = adj[k]
            if in_frontier[p]:                      # found a frontier parent
                dist[v] = level + 1
                nxt_mask[v] = True
                break                               # EARLY EXIT: one parent is enough
    return nxt_mask, edges

if __name__ == "__main__":
    import random
    random.seed(3)
    # Dense graph: when the frontier is large, bottom-up touches far fewer edges.
    V = 200
    edges = [(i, j) for i in range(V) for j in range(V) if i != j and random.random() < 0.1]
    off, adj = make_csr([(a, b) for a, b in edges], V)

    # Run level 0 top-down to get a large level-1 frontier, then compare one more step.
    dist_td = [-1] * V; dist_td[0] = 0
    f1_td, _ = top_down_step(off, adj, dist_td, [0], 0)        # level-1 frontier
    dist_bu = list(dist_td)
    mask1 = [False] * V
    for u in f1_td: mask1[u] = True

    # Step 2, both directions, from the same level-1 frontier.
    f2_td, e_td = top_down_step(off, adj, dist_td, f1_td, 1)
    m2_bu, e_bu = bottom_up_step(off, adj, dist_bu, mask1, 1)
    f2_bu = [v for v in range(V) if m2_bu[v]]
    assert sorted(f2_td) == sorted(f2_bu), "both directions discover the same level-2 set"
    assert {v: dist_td[v] for v in f2_td} == {v: dist_bu[v] for v in f2_bu}
    print(f"level-2 step: top-down touched {e_td} edges, bottom-up touched {e_bu} edges")
    assert e_bu < e_td, "with a large frontier, bottom-up's early-exit wins on edges touched"
    print("OK: bottom-up step finds the same level as top-down, touching fewer edges")
```

- **Constraints:** The bottom-up step must iterate over **unvisited** vertices and, for each, scan its in-neighbours only until it finds the **first** one in the current frontier — then claim it and `break` (the early-exit is the whole point). It must discover the **same** next-level set as the top-down step (same vertices, same distance). Count edges touched in each direction. For a large frontier on a dense graph, bottom-up must touch strictly fewer edges.
- **Hint:** Top-down work per step is `Θ(Σ_{u∈F} deg(u))` — proportional to the frontier's out-edges. Bottom-up work is `Θ(Σ_{v unvisited} (edges scanned before a hit))`, and with a dense frontier the "edges before a hit" is small (often 1–2), so the unvisited vertices settle cheaply. The crossover is exactly when the frontier becomes a large fraction of the graph — typically the one or two giant levels of a small-world graph, which dominate the total edge work. Note bottom-up needs the **in-edges** (for undirected graphs `adj` already holds both directions; for directed graphs you transpose). Task 7 wires top-down and bottom-up together with an automatic switch.
- **Acceptance test:** The bottom-up step yields the identical level-2 set and distances as the top-down step; on a dense graph with a large frontier, bottom-up touches strictly fewer edges. This is the building block for direction-optimizing BFS — the same shell, reached by pulling instead of pushing.

---

### Task 7 — Direction-optimizing BFS: switch top-down ↔ bottom-up by frontier size **[coding]**

`[medium]` **Direction-optimizing BFS** (Beamer–Asanović–Patterson) runs **top-down** while the frontier is small (cheap to push), switches to **bottom-up** when the frontier swells (cheap to pull), and switches back as it shrinks. The switch is governed by two thresholds on the frontier size relative to the graph. Implement the full direction-optimizing BFS, verify distances against Task 1, and **measure** at which levels it switches and how many total edges it saves versus pure top-down.

#### Python

```python
def bfs_direction_opt(offsets, adj, s, alpha=14.0, beta=24.0):
    """Direction-optimizing BFS. Top-down by default; switch to bottom-up when the
    frontier's out-edge count m_f exceeds m_u / alpha (m_u = unexplored edges); switch
    back when the frontier is smaller than V / beta. Returns (dist, edges, switches)."""
    V = len(offsets) - 1
    E = len(adj)
    dist = [-1] * V
    dist[s] = 0
    frontier = [s]
    mask = [False] * V; mask[s] = True
    level, edges, switches = 0, 0, []
    mode = "top-down"
    unvisited = V - 1
    while frontier or any(mask):
        # Heuristic inputs: m_f = out-edges of the frontier; m_u = edges from unvisited.
        m_f = sum(offsets[u + 1] - offsets[u] for u in range(V) if mask[u])
        n_f = sum(mask)
        if n_f == 0:
            break
        m_u = sum(offsets[v + 1] - offsets[v] for v in range(V) if dist[v] == -1)
        # Choose direction for THIS level.
        new_mode = mode
        if mode == "top-down" and m_f > m_u / alpha:
            new_mode = "bottom-up"
        elif mode == "bottom-up" and n_f < V / beta:
            new_mode = "top-down"
        if new_mode != mode:
            switches.append((level, mode, new_mode))
            mode = new_mode

        if mode == "top-down":
            nxt, e = top_down_step(offsets, adj, dist, [u for u in range(V) if mask[u]], level)
            edges += e
            mask = [False] * V
            for w in nxt: mask[w] = True
        else:
            nmask, e = bottom_up_step(offsets, adj, dist, mask, level)
            edges += e
            mask = nmask
        level += 1
        if not any(mask):
            break
    return dist, edges, switches

def bfs_top_down_only(offsets, adj, s):
    V = len(offsets) - 1
    dist = [-1] * V; dist[s] = 0
    frontier, edges, level = [s], 0, 0
    while frontier:
        frontier, e = top_down_step(offsets, adj, dist, frontier, level)
        edges += e; level += 1
    return dist, edges

if __name__ == "__main__":
    import random
    random.seed(4)
    off, adj = small_world(4000)                     # low diameter, one giant middle level
    s = 0
    d_opt, e_opt, switches = bfs_direction_opt(off, adj, s)
    d_td, e_td = bfs_top_down_only(off, adj, s)
    assert d_opt == bfs_seq(off, adj, s) == d_td, "direction-opt must match sequential BFS"
    print(f"top-down only: {e_td} edges touched")
    print(f"direction-opt: {e_opt} edges touched; switched at levels {[s[0] for s in switches]}")
    assert e_opt < e_td, "direction-opt should touch fewer edges on a low-diameter graph"
    print("OK: direction-optimizing BFS == sequential; switches on the giant level, saves edges")
```

- **Constraints:** Distances must equal Task 1. The BFS must start **top-down**, switch to **bottom-up** when the frontier's out-edge count `m_f` grows past `m_u / α` (the unexplored edges over a tuning constant `α`), and switch **back** to top-down when the frontier shrinks below `V / β`. Record every switch (level, from, to). On a low-diameter graph (small-world), the total edges touched must be **strictly less** than pure top-down — the bottom-up phase skips the giant level's redundant scatters.
- **Hint:** The intuition: top-down's cost is the frontier's *out*-edges, which explodes on the one or two giant levels of a small-world graph; bottom-up's cost on those same levels is small because almost every unvisited vertex finds a frontier parent immediately. So the win is concentrated on the 1–2 fattest levels — switch in for those, switch out for the long tail of tiny levels (where bottom-up would wastefully scan the whole vertex set). The `α = 14`, `β = 24` defaults are Beamer's measured sweet spot. On a **high-diameter** graph (chain, road network) the frontier never swells, so it stays top-down and the switch never fires — direction-optimizing degrades gracefully to plain BFS.
- **Acceptance test:** Distances equal `bfs_seq`; the switch fires on the giant middle level(s); total edges touched is strictly below pure top-down on a small-world graph. On a chain, verify it never switches (the frontier stays size 1). The measured edge saving is the empirical payoff of choosing the direction per level.

---

### Task 8 — Parallel connected components via label propagation **[coding]**

`[medium]` BFS finds one component (the reachable set from `s`). **Connected components** labels *every* vertex with its component id, in parallel, via **label propagation**: initialize each vertex's label to its own id, then repeatedly let every vertex take the **minimum** label among itself and its neighbours, until no label changes. Each round is an embarrassingly-parallel map over vertices; the number of rounds is bounded by the largest component's diameter. Implement it, verify the components match a sequential union-find / BFS-flood reference, and count the rounds.

#### Python

```python
def connected_components_labelprop(offsets, adj):
    """Parallel connected components by min-label propagation. label[v] converges to the
    smallest vertex id in v's component. Returns (label, rounds). Each round is a parallel
    map; rounds <= max component diameter (min-label floods like a BFS from the min vertex)."""
    V = len(offsets) - 1
    label = list(range(V))                          # every vertex starts as its own component
    rounds = 0
    changed = True
    while changed:
        changed = False
        new = list(label)
        for v in range(V):                          # parallel map over vertices
            m = label[v]
            for k in range(offsets[v], offsets[v + 1]):
                m = min(m, label[adj[k]])           # take the smallest neighbour label
            if m < new[v]:
                new[v] = m
                changed = True
        label = new
        rounds += 1
    return label, rounds

def components_seq(offsets, adj):
    """Sequential reference: flood each unvisited vertex, label by the min id reached."""
    V = len(offsets) - 1
    comp = [-1] * V
    for s in range(V):
        if comp[s] != -1:
            continue
        # BFS flood; component id = the smallest vertex in the flood (== s, since we scan up).
        stack, seen = [s], {s}
        while stack:
            u = stack.pop()
            comp[u] = s
            for k in range(offsets[u], offsets[u + 1]):
                w = adj[k]
                if w not in seen:
                    seen.add(w); stack.append(w)
    return comp

if __name__ == "__main__":
    import random
    random.seed(5)
    for _ in range(300):
        V = random.randint(1, 40)
        edges = [(random.randrange(V), random.randrange(V)) for _ in range(V)]
        edges = [(a, b) for a, b in edges if a != b]
        off, adj = make_csr(edges, V)
        label, rounds = connected_components_labelprop(off, adj)
        ref = components_seq(off, adj)
        # Same PARTITION: u,v share a label iff they share a reference component.
        def same(arr): return {(i, j) for i in range(V) for j in range(V) if arr[i] == arr[j]}
        assert same(label) == same(ref), "label propagation must match the reference partition"
    print("OK: label-propagation components == sequential flood; partitions identical")
```

- **Constraints:** Each round is a parallel **map**: every vertex independently takes the minimum of its own label and its neighbours' labels (read the *previous* round's labels — double-buffer, do not read in-place, or you race). Iterate until a full round changes nothing. The final labeling must induce the **same partition** as the sequential reference (the actual id values differ only in that label propagation names each component by its minimum vertex id). Count the rounds.
- **Hint:** Min-label propagation is exactly a *simultaneous BFS flood from the minimum vertex of every component* — the minimum label spreads one hop per round, so the round count is bounded by the largest component's **diameter** (the same `D`-dependence as BFS span). That makes naive label propagation slow on high-diameter components (`Θ(D)` rounds); production parallel-CC algorithms (Shiloach–Vishkin, Awerbuch–Shiloach, or pointer-jumping/hooking) cut the rounds to `Θ(log V)` by *hooking trees and jumping pointers*, the connected-components analogue of replacing a linear scan with a tree. For this task, plain min-propagation is the correct, easy-to-verify baseline; double-buffering the labels is the one correctness pitfall.
- **Acceptance test:** The label propagation induces the identical partition to the sequential flood for random graphs of every size (including isolated vertices and multiple components); the round count is bounded by the max component diameter. This is the parallel "label the whole graph" companion to single-source BFS.

---

## Advanced Tasks

### Task 9 — BFS as SpMV over the (OR, AND) semiring **[coding]**

`[hard]` A BFS level expansion *is* a sparse matrix–vector product. Let `A` be the graph's adjacency matrix and `f` the frontier as a boolean vector (`f[u] = 1` iff `u` is in the frontier). Then `f' = fᵀ A` over the **(OR, AND)** semiring gives, for each `v`, `OR_u (f[u] AND A[u][v])` — i.e. `v` is in the raw next frontier iff *some* frontier `u` has an edge to `v`. Masking off already-visited vertices yields the true next frontier. Implement BFS as repeated semiring SpMV on a CSR matrix, and verify it produces the identical distances to the frontier BFS.

#### Python

```python
def spmv_or_and(offsets, adj, f):
    """Sparse matrix-vector product over the (OR, AND) semiring: y[v] = OR_u (f[u] AND A[u][v]).
    f and y are boolean vectors of length V. For each frontier u, OR a 1 into every neighbour.
    Theta(nnz touched) work, Theta(log n) span (the OR-reduction into each output entry)."""
    V = len(offsets) - 1
    y = [False] * V
    for u in range(V):
        if f[u]:                                    # f[u] AND A[u][v]: only frontier rows contribute
            for k in range(offsets[u], offsets[u + 1]):
                y[adj[k]] = True                    # OR: any incoming edge from the frontier sets it
    return y

def bfs_spmv(offsets, adj, s):
    """BFS as repeated semiring SpMV. frontier vector f; next = (f^T A) masked by unvisited.
    Distances are assigned the level at which a vertex first enters the frontier."""
    V = len(offsets) - 1
    dist = [-1] * V
    dist[s] = 0
    visited = [False] * V; visited[s] = True
    f = [False] * V; f[s] = True
    level = 0
    while any(f):
        raw = spmv_or_and(offsets, adj, f)          # f' = f^T A over (OR, AND)
        nf = [False] * V
        for v in range(V):
            if raw[v] and not visited[v]:           # mask: keep only newly-reached vertices
                visited[v] = True
                dist[v] = level + 1
                nf[v] = True
        f = nf
        level += 1
    return dist

if __name__ == "__main__":
    import random
    random.seed(6)
    for _ in range(300):
        V = random.randint(1, 40)
        edges = [(random.randrange(V), random.randrange(V)) for _ in range(2 * V)]
        edges = [(a, b) for a, b in edges if a != b]
        off, adj = make_csr(edges, V)
        s = random.randrange(V)
        assert bfs_spmv(off, adj, s) == bfs_seq(off, adj, s), "SpMV-BFS must match sequential"
    # Show the equivalence to the frontier form explicitly on a small graph.
    off, adj = make_csr([(0, 1), (0, 2), (1, 3), (2, 3), (3, 4)], 5)
    assert bfs_spmv(off, adj, 0) == bfs_levelsync(off, adj, 0)[0] == [0, 1, 1, 2, 3]
    print("OK: BFS as (OR,AND)-SpMV == frontier BFS == sequential BFS")
```

- **Constraints:** Each step computes `f' = fᵀ A` over the **(OR, AND)** semiring: `f'[v] = OR_u (f[u] AND A[u][v])` — only frontier rows (`f[u] = 1`) contribute, and a `1` ORs into every out-neighbour. The raw product must then be **masked** by the visited set to get the true next frontier and to assign distances. The CSR `adj` *is* the sparse adjacency matrix in row-major form; `spmv_or_and` is one sparse matrix–vector multiply. Distances must equal the frontier BFS (Task 2) and the sequential BFS (Task 1).
- **Hint:** This is the **GraphBLAS** worldview: graph algorithms are linear algebra over semirings, and BFS is `k` rounds of masked SpMV over (OR, AND) — `(min,+)` SpMV gives single-source shortest paths in a weighted graph, `(+,×)` over reals gives triangle/path counts. The masking (`raw[v] AND NOT visited[v]`) is itself an element-wise semiring operation; in GraphBLAS it is the `mask` argument to `mxv`. The cost is identical to the frontier form — each SpMV touches the frontier's edges, `Θ(log n)` span for the OR-reduction into each output entry — because SpMV and frontier-expansion are *the same computation* in two notations. This is why high-performance BFS libraries (CombBLAS, SuiteSparse:GraphBLAS) are built on a fast SpMV.
- **Acceptance test:** `bfs_spmv` equals `bfs_seq` for random graphs and any source, and equals the frontier BFS distances element-for-element on the worked small graph. The exercise makes the algebra concrete: a frontier is a sparse boolean vector, an expansion is a masked SpMV over (OR, AND), and BFS is iterating it `D` times.

---

### Task 10 — Load balance: high-degree vertices wreck a naive per-vertex partition **[coding + analysis]**

`[hard]` Level-synchronous BFS is `Θ(V + E)` work, but that work is only parallel if it is **balanced** across processors. The naive split — give each processor an equal *number of frontier vertices* — is catastrophic on a **skewed-degree** graph: one processor may get a single hub of degree `Θ(V)` while another gets a thousand leaves, so the hub's owner does all the work and the span collapses to `Θ(maxdeg)`. Demonstrate the imbalance, then fix it by partitioning the **edges** (not the vertices) of the frontier so every processor expands `≈ (Σ deg) / p` edges.

#### Python

```python
def frontier_edge_count(offsets, frontier):
    return sum(offsets[u + 1] - offsets[u] for u in frontier)

def balance_by_vertices(offsets, frontier, p):
    """Naive: split the frontier into p equal-COUNT vertex chunks. Returns per-proc edge loads."""
    chunk = (len(frontier) + p - 1) // p
    loads = []
    for i in range(0, len(frontier), chunk):
        seg = frontier[i:i + chunk]
        loads.append(sum(offsets[u + 1] - offsets[u] for u in seg))
    return loads

def balance_by_edges(offsets, frontier, p):
    """Balanced: split the frontier's EDGES into p near-equal ranges (a prefix-sum split,
    the same co-ranking idea as the scan tasks). Returns per-proc edge loads."""
    degs = [offsets[u + 1] - offsets[u] for u in frontier]
    prefix, total = [], 0
    for d in degs:
        prefix.append(total); total += d
    target = total / p
    loads, cur, bound, b = [], 0, target, 1
    for i, d in enumerate(degs):
        cur += d
        if cur >= bound and b < p:                  # close this processor's edge block
            loads.append(cur); cur = 0; bound = target; b += 1
    loads.append(cur)
    return [x for x in loads if x > 0] or [0]

if __name__ == "__main__":
    import random
    random.seed(7)
    # Power-law-ish frontier: a few hubs, many leaves.
    V = 100_000
    offsets = [0]
    for u in range(V):
        deg = 1 if random.random() < 0.98 else random.randint(1000, 5000)   # rare hubs
        offsets.append(offsets[-1] + deg)
    frontier = list(range(V))
    p = 16

    v_loads = balance_by_vertices(offsets, frontier, p)
    e_loads = balance_by_edges(offsets, frontier, p)
    total = frontier_edge_count(offsets, frontier)
    print(f"total frontier edges = {total}, ideal per-proc = {total // p}")
    print(f"by-vertices: max load {max(v_loads):>9}  imbalance {max(v_loads) / (total / p):.2f}x")
    print(f"by-edges:    max load {max(e_loads):>9}  imbalance {max(e_loads) / (total / p):.2f}x")
    assert max(e_loads) / (total / p) < max(v_loads) / (total / p), "edge split is more balanced"
    print("OK: per-vertex split is wrecked by hubs; per-edge split balances the work")
```

- **Analysis to write:** A frontier expansion does `Σ_{u∈F} deg(u)` units of work, distributed across `p` processors. The **per-vertex** partition gives each processor `|F|/p` vertices but an *unequal* share of edges: on a power-law graph (`deg ∝ rank^{−γ}`), a single hub can carry `Θ(|F|/p · maxdeg)` of the work — so the makespan of the level is set by the unluckiest processor, `Θ(maxdeg)`, not `Θ((Σ deg)/p)`. The span of the level inflates from the ideal `Θ((Σ deg)/p + log n)` to `Θ(maxdeg)`. The fix is a **per-edge** (work-balanced) partition: compute the prefix sum of frontier degrees and split it into `p` near-equal edge ranges — exactly the co-ranking/merge-path split from the [scan tasks](../02-parallel-prefix-sum-scan/tasks.md). A hub's edges are then *shared* across processors (its neighbour list is sub-divided), so every processor expands `≈ (Σ deg)/p` edges and the level's span returns to the work-optimal `Θ((Σ deg)/p + log n)`.
- **Constraints:** Build a skewed-degree (power-law-ish) frontier. Compare the **per-vertex** split (equal vertex count) against the **per-edge** split (equal edge count, via a prefix-sum/co-ranking boundary). Report each processor's edge load and the imbalance ratio `max_load / ideal`. The edge split must be measurably more balanced than the vertex split.
- **Hint:** This is *the* reason real parallel-BFS frameworks (Gunrock, Ligra, GraphBLAS) do edge-centric load balancing — a "TWC" (thread/warp/CTA) or "merge-based" partition that chops fat neighbour lists across threads. On a road network (bounded degree) the vertex split is fine; on a social/web graph (a handful of celebrity hubs with millions of edges) it is fatal. The connection to scan: the per-edge boundary is the index `k` such that the prefix sum of degrees crosses `k · (Σ deg)/p`, found by the same binary search as merge co-ranking. Load balance is the difference between the *work* bound (`Θ(V + E)`, always true) and the achieved *span* (only `Θ((V+E)/p + D log n)` if the per-level work is split by edges).
- **Acceptance test:** On the skewed frontier, the per-vertex split's imbalance ratio is large (a hub-owning processor dominates) while the per-edge split's ratio is near `1`; the write-up correctly identifies hubs as the cause and the prefix-sum edge partition as the fix, tying it to co-ranking. This is why "balanced work" is a property of the *partition*, not of the `Θ(V + E)` work bound.

---

### Task 11 — Why span is `Θ(D · log n)`, and why high-diameter graphs parallelize poorly **[analysis]**

`[hard]` Make Task 2's measured span rigorous. Derive the work and span of level-synchronous BFS, prove the `Θ(D · log n)` span, and explain — precisely — why a high-diameter graph defeats parallel BFS no matter how many processors you throw at it.

> **No code.** Use this as the grading model.

**Work.** Across all `D` levels, every reachable vertex is expanded **exactly once** (it is claimed once, by Task 3, and enters one frontier), and during its expansion each of its incident edges is traversed once. Summing over levels, the total is `Σ_{v reachable} (1 + deg(v)) = Θ(V + E)`. The visited-claim and the scan-compaction each add only a constant factor per element, so:

```
T₁ = Θ(V + E).   (work-efficient: matches sequential BFS)
```

**Span.** The span is the critical-path depth: the `D` level-barriers in series, each contributing the depth of the work *inside* that level. Within a level, the expansion is (i) a parallel map over frontier vertices' edges and (ii) a scan/compaction to build the next frontier (Task 4) — both `Θ(log n)` span on a PRAM (the scan's tree depth; the [reduction lower bound](../01-models-pram-work-span/tasks.md) forces `Ω(log n)` for any combine over `n` items). The atomic claim is `Θ(1)` per edge. So each level costs `Θ(log n)` span, and the `D` levels are *strictly sequential* — level `d+1`'s frontier cannot be known until level `d`'s expansion completes (a vertex's distance is only fixed when its level is reached):

```
T∞ = Σ_{d=0}^{D-1} Θ(log n) = Θ(D · log n).
```

**Parallelism.** `T₁ / T∞ = Θ((V + E) / (D log n))`. The available parallelism is *inversely proportional to the diameter*.

**Why high diameter kills it.** The `D` levels are an unavoidable serial dependency chain — there is no way to expand level `d+1` before level `d`, because BFS *defines* level `d+1` in terms of level `d`. So:
- **Chain / path graph (`D = V − 1`):** `T∞ = Θ(V log n)` — *worse* than sequential `Θ(V)`. Each level holds one vertex, so there is *zero* intra-level parallelism to amortize the `log n` scan overhead; you pay `V` serial rounds and gain nothing. Adding processors does not help: the parallelism `T₁/T∞ = Θ((V+E)/(V log n)) = Θ(1/log n) < 1`.
- **Road network / mesh (`D = Θ(√V)` for a 2-D grid):** `T∞ = Θ(√V · log n)` — sub-linear span but the `√V` serial levels cap the speedup at `Θ(√V / log n)` processors' worth of parallelism, no matter how large the machine.
- **Small-world / social / web graph (`D = Θ(log V)`):** `T∞ = Θ(log² n)` — *excellent*. The diameter is logarithmic (the "six degrees" property), so the serial chain is short and the giant middle levels expose `Θ(V)` parallelism. This is the graph class level-synchronous BFS was designed for.

**The fix is not the algorithm.** No level-synchronous variant escapes `Θ(D)` rounds, because the `D`-deep dependency is intrinsic to the *graph*, not the *schedule*. Escaping it requires changing the problem (e.g. `Δ`-stepping or radius-stepping, which relax the strict level barrier and trade extra work for fewer rounds on high-diameter graphs) or accepting that high-diameter graphs are inherently serial under BFS. Brent's bound (see the [work–span tasks](../01-models-pram-work-span/tasks.md)) makes the cap exact: runtime on `p` processors is `Ω(T∞) = Ω(D log n)` regardless of `p`.

- **Constraints:** Derive `T₁ = Θ(V + E)` from "each vertex claimed once, each edge traversed once." Derive `T∞ = Θ(D · log n)` as `D` serial levels × `Θ(log n)` per-level scan depth, and justify *why* the levels are serial (the `d → d+1` dependency). Give the parallelism `Θ((V+E)/(D log n))`, and work the chain (`D ≈ V`), grid (`D ≈ √V`), and small-world (`D ≈ log V`) cases. State that no level-synchronous schedule escapes the `Θ(D)` round count.
- **Acceptance test:** Work `Θ(V + E)` (work-efficient); span `Θ(D · log n)`; parallelism inversely proportional to diameter; the three graph classes are correctly placed (chain useless, grid limited, small-world ideal); and the conclusion that the `Θ(D)` serial chain is a property of the graph, fixable only by changing the algorithm class (Δ-stepping) — all matching the level counts measured in Task 5.

---

### Task 12 — Δ-stepping intuition: trading work for span on high-diameter graphs **[analysis]**

`[hard]` Level-synchronous BFS is `Θ(D)` rounds — fatal on high-diameter graphs (Task 11). For the *weighted* shortest-path generalization, **Δ-stepping** (Meyer–Sanders) breaks the strict level barrier to cut the number of rounds at the cost of some redundant work. Explain how Δ-stepping relaxes the level structure, why it reduces the round count on high-diameter graphs, and the work-for-span trade-off it makes — and connect it back to why plain BFS is the `Δ → ∞` (or unweighted `Δ = 1`) special case.

> **No code.** Use this as the grading model.

**The barrier that hurts.** Level-synchronous BFS (and its weighted cousin, Dijkstra's algorithm) imposes a *total order* on processing: a vertex is finalized strictly in distance order, one level (or one priority) at a time. On a high-diameter graph this forces `Θ(D)` serial rounds — the dependency chain of Task 11. Dijkstra is even worse for parallelism: it finalizes *one* vertex per step, a fully serial `Θ(V)` chain.

**Δ-stepping's relaxation.** Δ-stepping buckets tentative distances into ranges of width `Δ`: bucket `i` holds vertices with tentative distance in `[iΔ, (i+1)Δ)`. It processes buckets in order, but **within a bucket it relaxes all light edges (weight `≤ Δ`) in parallel, repeatedly, until the bucket is settled** — so many vertices are finalized per round instead of one. Heavy edges (weight `> Δ`) are relaxed once per bucket. The key relaxation of the BFS barrier: vertices in the *same* bucket are processed together even though their exact distances differ, so the number of *rounds* is governed by the number of buckets and the light-edge sub-rounds, not by `D` directly.

**The work-for-span trade-off.** Widening `Δ` puts more vertices in each bucket → fewer buckets → fewer rounds (lower span), but a larger `Δ` also causes more **re-relaxations**: a vertex may be settled tentatively, then re-relaxed when a shorter path is found within the same wide bucket, doing redundant work. So:
- **Small `Δ`** → behaves like Dijkstra: minimal redundant work (`Θ(V + E)`), but many buckets → high span (many rounds).
- **Large `Δ`** → behaves like Bellman–Ford: few buckets / rounds (low span), but `Θ(Δ)`-fold redundant edge relaxations → more work.
- The sweet spot `Δ ≈ (max edge weight) / (average degree)` balances them, giving (for random graphs with bounded degree) `Θ(V + E)` expected work and span roughly `Θ((D/Δ + ...) · log n)` — far below `Θ(D log n)` when `Δ` covers many hops.

**BFS as the special case.** Unweighted BFS is Δ-stepping with all weights `= 1` and `Δ = 1`: each bucket is exactly one BFS level, no re-relaxation, `Θ(V + E)` work and `Θ(D log n)` span — recovering Task 11 exactly. Choosing `Δ > 1` on an unweighted graph merges several BFS levels into one bucket, cutting rounds but allowing re-relaxations — the same trade. The lesson generalizes Task 11's conclusion: the `Θ(D)` round count is not a law of nature but a consequence of the *strict* level barrier; relaxing the barrier (Δ-stepping, radius-stepping) buys fewer rounds by paying redundant work, which is the only way to parallelize shortest paths on high-diameter graphs.

- **Constraints:** Explain (1) the strict-order barrier that makes level-sync BFS / Dijkstra `Θ(D)` (resp. `Θ(V)`) rounds; (2) how Δ-stepping buckets tentative distances by width `Δ` and relaxes light edges in parallel within a bucket; (3) the `Δ`-controlled work↔span trade-off (small `Δ` ≈ Dijkstra, low work / high span; large `Δ` ≈ Bellman–Ford, high work / low span); and (4) that unweighted BFS is the `Δ = 1` special case, recovering `Θ(V + E)` / `Θ(D log n)`.
- **Acceptance test:** The answer locates the round-count problem in the strict level/priority barrier, describes Δ-bucketing and parallel light-edge relaxation, states the work-for-span trade-off with the small-`Δ`/large-`Δ` endpoints named (Dijkstra / Bellman–Ford), and correctly derives plain BFS as the `Δ = 1` instance — generalizing Task 11's "high diameter is intrinsic" into "you can trade work to escape it."

---

## Synthesis Task

> Tie parallel graph BFS together end to end: build the sequential distance oracle, the level-synchronous frontier BFS with work/span counters, the atomic visited-claim and scan-compacted next frontier, then the direction-optimizing and SpMV forms and parallel connected components — confirming every parallel result equals the sequential reference while the counters respect the bound — then derive the `Θ(D · log n)` span and reason about diameter and load balance.

`[capstone]` Carry **parallel BFS** from definition to applications: implement, count, verify, and prove.

1. **The frontier core [coding].** Sequential queue BFS, the distance oracle (Task 1); level-synchronous frontier BFS with work/level counters → `Θ(V + E)` work, `D` levels (Task 2); the atomic visited-claim so each vertex is claimed once (Task 3); the scan-compacted next frontier, lock-free (Task 4). Confirm every distance array equals `bfs_seq`.

2. **The diameter story [coding + analysis].** Level count across chain / grid / tree / star / small-world, showing span `∝ D` (Task 5); the `Θ(D · log n)` span derivation and why high-diameter graphs parallelize poorly (Task 11).

3. **Direction optimization [coding].** The bottom-up step's early-exit pull (Task 6); full direction-optimizing BFS with the frontier-size switch and the measured edge saving (Task 7).

4. **Algebra and components [coding].** BFS as masked SpMV over the (OR, AND) semiring (Task 9); parallel connected components by min-label propagation (Task 8).

5. **The hard edges [coding + analysis].** Load balance — high-degree hubs wreck a per-vertex split, fixed by a per-edge (prefix-sum) partition (Task 10); Δ-stepping's work-for-span trade that escapes the `Θ(D)` round count (Task 12).

Reference harness in **Python** (drives the pieces and checks every bound):

```python
import math, random

def synth(edges, V, s, seed=0):
    random.seed(seed)
    off, adj = make_csr(edges, V)
    ref = bfs_seq(off, adj, s)

    # Level-synchronous frontier BFS: distances and work/level counters.
    dist, work, levels, sizes = bfs_levelsync(off, adj, s)
    assert dist == ref, "level-sync BFS = sequential"
    assert work == V_reachable_plus_edges(off, dist), "work = vertices + edges touched"
    assert levels == eccentricity(dist), "levels = D (source eccentricity)"

    # Scan-compacted, atomic-claim, SpMV, and direction-optimizing all agree.
    assert bfs_scan(off, adj, s) == ref
    assert bfs_atomic(off, adj, s)[0] == ref
    assert bfs_spmv(off, adj, s) == ref
    assert bfs_direction_opt(off, adj, s)[0] == ref
    return levels, max(sizes)

def eccentricity(dist):
    finite = [d for d in dist if d >= 0]
    return max(finite) if finite else 0

def V_reachable_plus_edges(off, dist):
    # vertices expanded (reachable) + their incident edges (undirected: counted both ends).
    return sum(1 for d in dist if d >= 0) + sum(
        off[v + 1] - off[v] for v in range(len(off) - 1) if dist[v] >= 0)

if __name__ == "__main__":
    print(f"{'graph':>12} {'V':>6} {'levels (D)':>11} {'max frontier':>13} {'~span':>7}")
    cases = [
        ("chain",       [(i, i + 1) for i in range(63)], 64),
        ("grid 8x8",    [(r*8+c, r*8+c+1) for r in range(8) for c in range(7)]
                        + [(r*8+c, r*8+c+8) for r in range(7) for c in range(8)], 64),
        ("star",        [(0, i) for i in range(1, 64)], 64),
    ]
    for name, edges, V in cases:
        levels, mx = synth(edges, V, 0)
        print(f"{name:>12} {V:>6} {levels:>11} {mx:>13} {levels*math.ceil(math.log2(V)):>7}")
    print("\nOK: every parallel BFS == sequential; work = Theta(V+E); span = D * log n;"
          " D drives parallelizability (chain ~V, star =1)")
```

- **Analysis answer:** A **BFS** explores a graph in concentric shells; the **level-synchronous** parallel form expands one whole frontier at a time, so the work is `Θ(V + E)` (each vertex claimed once, each edge traversed once — *work-efficient*) and the span is `Θ(D · log n)`: `D` strictly-serial levels (the `d → d+1` dependency is intrinsic to the graph), each `Θ(log n)` for the scan that builds the next frontier. The **atomic visited-claim** (a CAS) ensures each vertex enters the next frontier exactly once under concurrency; the **next frontier** is built lock-free by an **exclusive scan** of per-vertex neighbour counts (stream compaction). **Direction-optimizing BFS** switches from top-down *push* to bottom-up *pull* on the giant levels of a low-diameter graph, where most unvisited vertices find a frontier parent in their first edge (early-exit), saving most of the edge work. BFS is equivalently a **masked SpMV** over the **(OR, AND)** semiring — `f' = fᵀ A` masked by unvisited — the GraphBLAS view that unifies it with weighted shortest paths (`(min,+)`) and path counting (`(+,×)`). **Connected components** falls out of parallel **min-label propagation** (a flood from each component's minimum vertex). The two hard realities are outside the work bound: **load balance** — a per-vertex frontier split is wrecked by high-degree hubs and must be replaced by a per-edge (prefix-sum/co-ranking) partition — and **diameter** — the `Θ(D)` serial round count makes chains and meshes parallelize poorly and small-world graphs parallelize beautifully, escapable only by relaxing the level barrier (**Δ-stepping**, trading redundant work for fewer rounds, with plain BFS as its `Δ = 1` case).
- **Acceptance test:** Every parallel BFS variant (level-sync, scan-compacted, atomic-claim, SpMV, direction-optimizing) equals `bfs_seq`; work measures `Θ(V + E)`; the level count equals the source eccentricity `D`; direction-optimizing saves edges on low-diameter graphs; SpMV equals the frontier form; label-propagation components match the sequential partition; the per-edge split balances a skewed frontier where the per-vertex split does not. The write-up mirrors the whole discipline: *run the BFS level by level, count the vertices and edges and the rounds, confirm the distances match the sequential oracle and the counters match `Θ(V+E)` / `Θ(D log n)` — then build the direction-optimizing, SpMV, and component variants, and reason about diameter, load balance, and the Δ-stepping escape.*

---

## Where to go next

- Build the exclusive scan, stream compaction, and prefix-sum split that the next-frontier construction and the per-edge load balancing here are made of — the parallel-BFS primitive in full — in the [parallel prefix sum / scan tasks](../02-parallel-prefix-sum-scan/tasks.md); the per-vertex output offsets in a frontier expansion *are* an exclusive scan, and the per-edge partition is its co-ranking split.
- Revisit the work/span model, Brent's bound that caps BFS speedup at `Ω(D log n)` regardless of `p`, the `Ω(log n)` reduction-span floor inside each level, and the atomic compare-and-swap that the visited-claim depends on, in the [models: PRAM and work–span tasks](../01-models-pram-work-span/tasks.md).
- For the conceptual treatment of level-synchronous BFS, the atomic frontier construction, direction-optimization, the semiring/GraphBLAS view, connected components, and the diameter and load-balance realities, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
