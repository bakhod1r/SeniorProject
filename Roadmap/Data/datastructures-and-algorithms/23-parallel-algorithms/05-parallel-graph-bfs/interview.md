# Parallel Graph BFS — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Frontier: Races, Dedup & Compaction](#the-frontier-races-dedup--compaction)
3. [Direction Optimization](#direction-optimization)
4. [Beyond BFS: Connected Components & Linear Algebra](#beyond-bfs-connected-components--linear-algebra)
5. [Hardness: What Doesn't Parallelize](#hardness-what-doesnt-parallelize)
6. [Gotcha / Trick Questions](#gotcha--trick-questions)
7. [Rapid-Fire Q&A](#rapid-fire-qa)
8. [Common Mistakes](#common-mistakes)
9. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: "How do you parallelize BFS?" *(Medium)*

**Answer**: Run it **level-synchronously**. Serial BFS processes one vertex at a time off a FIFO queue; the parallel version processes an **entire BFS level (the frontier) at once**. All vertices at distance `d` from the source are independent of each other, so you expand them in parallel:

```
frontier = {source};  dist[source] = 0;  level = 0
while frontier not empty:
    next = ∅                                   # built in parallel
    for each u in frontier   in parallel:
        for each neighbor v of u:
            if claim(v):                        # atomic CAS on dist[v]
                dist[v] = level + 1
                add v to next                   # via scan/compaction
    frontier = next;  level += 1
```

- **Work**: `Θ(V + E)` — every vertex and every edge is touched once across all levels. **Work-optimal**, same as serial BFS.
- **Span**: `Θ(D · log n)`, where `D` is the **diameter** (number of BFS levels). There are `D` sequential level-barriers, and each level's frontier expansion + compaction costs `Θ(log n)` span.

The two hard parts are (1) **deduplicating** neighbor discovery across racing threads (Q5) and (2) **building the next frontier in parallel** via a scan (Q6).

### Q2: Why does the span depend on the diameter `D`? *(Medium)*

**Answer**: Because BFS is **inherently level-by-level** — you cannot discover level `d+1` until level `d` is fully expanded (a vertex's distance is `1 +` the distance of its discoverer). That imposes a **sequential chain of `D` global barriers**, one per level. Within a level, expansion is fully parallel (`Θ(log n)` span for the parallel-for + frontier compaction), but the `D` barriers lie on the critical path and **cannot be overlapped**.

So `span = D × Θ(log n) = Θ(D · log n)`. The number of vertices doesn't bound the span — the **number of levels** does. This is why graph *shape* matters more than graph *size* for BFS parallelism (Q14): a low-diameter graph (`D = O(log n)`, like a social network) gives span `Θ(log² n)` and enormous parallelism, while a long path (`D = n−1`) gives span `Θ(n log n)` — essentially serial.

---

## The Frontier: Races, Dedup & Compaction

### Q5: Two frontier vertices discover the same neighbor — how do you avoid processing it twice? *(Hard)*

**Answer**: With an **atomic claim** on the visited/distance array. When threads expanding two different frontier vertices both reach a common neighbor `v`, exactly **one** must "win" the right to set `dist[v]` and push `v` into the next frontier; the others must drop it. The standard primitive is an **atomic compare-and-swap (CAS)**:

```
claim(v):  return CAS(&dist[v], UNVISITED, level+1)   # true iff this thread won
```

CAS atomically checks `dist[v] == UNVISITED` and, if so, sets it — in one indivisible step. Only the winner gets `true` and adds `v` exactly once; losers get `false` and skip it. This guarantees each vertex enters the next frontier **at most once** and `dist[v]` is set to the correct BFS distance.

Without the atomic, two threads both read `UNVISITED`, both write, and both push `v` → **duplicates** (re-expanded, wasted work) and possibly a torn distance. A plain non-atomic check-then-set is the classic **read–modify–write race**. Note correctness of the *distance* is fine even with a benign race (all discoverers are at the same level, so they'd all write `level+1`), but you still need the atomic to **dedup the frontier**.

### Q6: How is the next frontier built in parallel without a lock? *(Hard)*

**Answer**: With a **parallel prefix-sum (scan) + compaction**, not a shared lock-protected queue. A global mutex-guarded queue serializes every insert and kills scalability. Instead:

1. Each thread (or each frontier vertex's expansion) collects the neighbors it **won** via CAS into a small thread-local buffer, and counts them: `c_i`.
2. **Exclusive scan** over the per-thread counts gives each thread a **unique, contiguous offset** `off_i = c_0 + … + c_{i−1}` into the output array.
3. Each thread **scatters** its won vertices to `next[off_i …]` — no two threads touch the same slot, so writes are race-free with **no locking**.

This is the same scan-based **stream compaction** used for filtering. It costs `Θ(log n)` span (the scan) and `Θ(frontier size)` work, keeping the whole level expansion work-efficient. See [Parallel Reduce and Map — Interview](../04-parallel-reduce-and-map/interview.md) and [Models, PRAM & Work–Span — Interview](../01-models-pram-work-span/interview.md) for the scan/compaction primitive.

---

## Direction Optimization

### Q7: What is top-down vs bottom-up BFS, and when does the hybrid switch? *(Hard)*

**Answer**: They are two ways to advance one level:

- **Top-down (push)** — the classic. For each vertex `u` **in the current frontier**, scan `u`'s out-edges and try to claim each unvisited neighbor. Cost ∝ **edges leaving the frontier**.
- **Bottom-up (pull)** — for each **unvisited** vertex `v`, scan `v`'s in-edges looking for *any* neighbor already in the frontier; if found, `v` joins the next level and **stops early** (no need to check the rest of its edges). Cost ∝ edges of unvisited vertices, but with **early termination**.

**Direction optimization** (Beamer, Asanović, Patterson, 2012) picks per level: when the frontier is **huge** — the "middle" levels of a low-diameter, scale-free graph, where most vertices are in the frontier at once — top-down redundantly checks countless edges to already-visited vertices, while bottom-up finds a frontier parent almost immediately and bails. The hybrid switches **top-down → bottom-up** when the frontier (or its edge count `m_f`) exceeds a threshold (heuristic: `m_f > m / α`), and switches back when the frontier shrinks again. This is the standard trick that wins **Graph500**; on a Kronecker/social graph it can cut edge inspections by an order of magnitude.

---

## Beyond BFS: Connected Components & Linear Algebra

### Q8: How do you compute connected components in parallel? *(Hard)*

**Answer**: Two classic approaches:

- **Label propagation** — initialize each vertex's label to its own id, then **iteratively** set each vertex's label to the minimum label among itself and its neighbors, in parallel, until no label changes (a fixpoint). Simple and fully data-parallel, but it can take up to `Θ(D)` rounds to converge (a label crawls one hop per round), so span is diameter-bound like BFS — bad for long chains.

- **Shiloach–Vishkin (1982)** — a **`Θ(log n)`-span** PRAM algorithm. It maintains a forest of "stars" (rooted trees) and alternates two operations: **hooking** (point one tree's root at a neighboring tree's root, breaking ties by id to avoid cycles) and **pointer jumping / shortcutting** (`parent[v] ← parent[parent[v]]`, which **halves tree height each round**). Pointer jumping is the key: it collapses any tree to depth 1 in `Θ(log n)` rounds regardless of diameter, so the whole algorithm finishes in `Θ(log n)` rounds → **span `Θ(log n)`**, independent of `D`. That diameter-independence is exactly why it beats label propagation and plain BFS-per-component for high-diameter graphs.

### Q9: How is BFS a sparse matrix–vector product over a semiring? *(Hard)*

**Answer**: Represent the frontier as a **boolean vector** `f` (`f[v] = 1` iff `v` is in the current frontier) and the graph as its **adjacency matrix** `A`. One level of BFS expansion is the **sparse matrix–vector product (SpMV)**:

```
f_next = Aᵀ ⊗ f      over the boolean semiring (OR, AND)
```

i.e. `f_next[v] = OR over u of (A[u][v] AND f[u])` — vertex `v` is in the next frontier iff **any** frontier vertex `u` has an edge to it. The `AND` is "is there an edge *and* is `u` active," the `OR` reduces over all such `u`. Mask out already-visited vertices each step to get the dedup'd frontier.

This is the **GraphBLAS** view: BFS, shortest paths (`(min, +)` tropical semiring), and PageRank (`(+, ×)`) are all the **same SpMV skeleton**, you just swap the `(⊕, ⊗)` semiring. The payoff: decades of optimized parallel sparse-linear-algebra kernels (load balancing, cache blocking, distribution) apply directly to graph traversal. See the semiring discussion in [Parallel Reduce and Map — Interview](../04-parallel-reduce-and-map/interview.md).

---

## Hardness: What Doesn't Parallelize

### Q10: Which graph problems *don't* parallelize well, and why? *(Hard)*

**Answer**: Problems that are **P-complete** are the canonical "inherently sequential" ones: they are in P, but are **not believed to be in NC** (no `polylog`-span, poly-work algorithm) unless `NC = P`. Being P-complete is, informally, evidence a problem **resists parallelization**. Two graph examples:

- **Lexicographically-first DFS** — computing the DFS tree/ordering that always takes the lowest-numbered unvisited neighbor. The forced tie-breaking makes each step depend on the entire prior traversal — a long dependency chain. (Plain reachability/BFS *is* parallel; it's the *lex-first DFS order* that's hard.)
- **Maximum flow** (and lex-first max flow / the classic max-flow as a P-complete problem). The augmenting-path structure is a deep sequential dependency.

Contrast with BFS reachability, connectivity, and MST, which **are** in NC. The interview point: *not every problem with a fast serial algorithm has a fast parallel one* — `P` ⊇ `NC`, and P-complete problems are the suspected boundary. So the right answer to "can we parallelize everything?" is **no, modulo `NC ≠ P`.**

---

## Gotcha / Trick Questions

### Q11: "Is parallel BFS work-efficient?" *(Medium)*

**Answer**: **Yes** — `Θ(V + E)` work, matching serial BFS. Each vertex is claimed once (CAS dedup) and each edge is inspected once across all levels, so the total work is linear in the graph size; the scan-based frontier compaction adds only `Θ(V)` more. The parallelism comes "for free" on the **span** axis (`Θ(D · log n)`), not by doing extra work. (Caveat: **direction-optimizing** bottom-up can *re-scan* in-edges of unvisited vertices, and top-down on a huge frontier inspects edges to already-visited vertices — so a *naive* single-direction BFS can waste edge inspections; the hybrid in Q7 is what keeps total edge work near `Θ(E)`.)

### Q12: "More cores always means faster BFS — right?" *(Hard)*

**Answer**: **No.** Three hard limits:

1. **Diameter caps the span.** Span is `Θ(D · log n)` with `D` sequential level barriers. Adding cores **cannot remove a barrier** — on a high-diameter graph (a path, a road network) BFS is nearly serial no matter how many cores you throw at it (Amdahl on the level structure).
2. **Memory-latency bound.** BFS is the textbook **irregular, pointer-chasing, low-arithmetic-intensity** workload: random access into the adjacency structure and the visited array, almost no compute per byte. It's limited by memory latency/bandwidth and atomic-contention on `dist[]`, not by core count.
3. **Load imbalance from skewed degrees.** Scale-free graphs have **huge-degree hubs**; if you partition the frontier by vertex, one thread expanding a million-edge hub stalls everyone at the level barrier. You must balance by **edges, not vertices** (e.g. CSR + edge-based partitioning) — otherwise extra cores sit idle.

So speedup is bounded by `min(P, work/span)` *and* by memory/contention/imbalance in practice. On a diameter-`D` graph, `work/span = Θ((V+E)/(D log n))` — that, not `P`, is often the ceiling.

### Q13: "Doesn't the visited-array race make BFS distances wrong?" *(Medium)*

**Answer**: The distance itself is **benign-racy but correct**, *if* you're careful: every vertex that discovers `v` in a given round is at the **same level** `d`, so they would all write `dist[v] = d+1` — concurrent writes of the *same value* don't corrupt it. What you **do** need the atomic for is **deduplication**: ensuring `v` is added to the next frontier **exactly once** (Q5). Skip the CAS and you re-expand `v` from every discoverer — an explosion of redundant work and possible duplicate frontier entries, not a wrong distance. (This benign-race property breaks for *weighted* shortest paths, where discoverers can offer different distances — there you genuinely need an atomic-min, which is why Δ-stepping/Dijkstra are harder than BFS.)

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Parallel BFS strategy? | **Level-synchronous** frontier expansion |
| 2 | BFS work? | `Θ(V + E)` — work-optimal |
| 3 | BFS span? | `Θ(D · log n)`, `D` = diameter |
| 4 | Why span ∝ diameter? | `D` sequential level barriers, un-overlappable |
| 5 | Dedup racing neighbor discovery? | **Atomic CAS** claim on `dist[]`/visited |
| 6 | Build next frontier in parallel? | **Scan + compaction** (no lock) |
| 7 | Top-down BFS cost ∝ ? | Edges **leaving** the frontier (push) |
| 8 | Bottom-up BFS cost ∝ ? | Unvisited vertices' in-edges, **early-exit** (pull) |
| 9 | When switch to bottom-up? | **Huge frontier** (`m_f > m/α`) — Beamer / Graph500 |
| 10 | Label propagation rounds? | Up to `Θ(D)` — diameter-bound |
| 11 | Shiloach–Vishkin span? | `Θ(log n)` via hooking + **pointer jumping** |
| 12 | Why SV beats BFS-CC? | Diameter-**independent** (`log n`, not `D`) |
| 13 | BFS as linear algebra? | **SpMV** `f_next = Aᵀf` over **(OR, AND)** semiring |
| 14 | Shortest-path semiring? | `(min, +)` tropical |
| 15 | P-complete = ? | In P, **not believed in NC** — resists parallelizing |
| 16 | P-complete graph examples? | **Lex-first DFS**, **max flow** |
| 17 | Worst graph shape for BFS span? | **High-diameter** (path, road network) |
| 18 | Best graph shape? | **Low-diameter** scale-free (`D = O(log n)`) |
| 19 | Partition frontier by ? | **Edges, not vertices** (degree skew) |
| 20 | BFS bottleneck on real HW? | **Memory latency** + atomic contention, not compute |

---

## Common Mistakes

1. **Quoting BFS span as `Θ(log n)`.** It's `Θ(D · log n)` — the **diameter** dominates; only within a level is it `log n`.
2. **Skipping the atomic claim.** A plain check-then-set is a read–modify–write race → duplicate frontier entries and re-expansion. Use **CAS**.
3. **Building the frontier with a global locked queue.** Serializes inserts. Use a **scan + compaction** for race-free, lock-free appends.
4. **Always going top-down.** On the giant middle frontier of a scale-free graph, top-down wastes edge checks; **switch to bottom-up** (direction optimization).
5. **Partitioning the frontier by vertex.** A high-degree hub stalls one thread at the level barrier — balance by **edges**.
6. **Claiming "more cores → faster" unconditionally.** Diameter caps span; BFS is memory-latency-bound and imbalance-prone.
7. **Thinking everything in P parallelizes.** **P-complete** problems (lex-DFS, max flow) resist NC unless `NC = P`.
8. **Confusing the benign distance race with a correctness bug.** Distance is correct (same-level writers); the atomic is for **dedup**, not the value — but weighted SSSP genuinely needs atomic-min.

---

## Tips & Summary

- **Open with the two numbers**: "Level-synchronous frontier BFS — **`Θ(V+E)` work**, **`Θ(D · log n)` span**." Then immediately explain the `D`: it's the count of sequential level barriers, which is why graph *shape* drives parallelism.
- **Name the two mechanisms**: **atomic CAS** to claim/dedup neighbors, and **scan-based compaction** to build the next frontier lock-free. These are the implementation crux of every question.
- **Have direction optimization ready**: top-down (push, cost ∝ frontier out-edges) vs bottom-up (pull, cost ∝ unvisited in-edges with early-exit); switch on a **huge frontier**. Cite **Beamer / Graph500** — it signals you know the real-world kernel.
- **Know one fast CC algorithm**: **Shiloach–Vishkin**, `Θ(log n)` span via **pointer jumping**, diameter-independent — the standard answer to "components in parallel."
- **Show the linear-algebra lens**: BFS is **SpMV over (OR, AND)**; swap the semiring for shortest paths `(min,+)` or PageRank `(+,×)`. That's the **GraphBLAS** unification.
- **Land the hardness point**: not everything in P is in NC — **P-complete** problems (lex-first DFS, max flow) are the suspected wall — and **high-diameter graphs** make even easy-to-parallelize BFS span-bound. See [./middle.md](./middle.md) and [Models, PRAM & Work–Span — Interview](../01-models-pram-work-span/interview.md).

**Related:** [Models, PRAM & Work–Span — Interview](../01-models-pram-work-span/interview.md) · [Parallel Reduce and Map — Interview](../04-parallel-reduce-and-map/interview.md) · [Parallel Graph BFS — Middle](./middle.md)
