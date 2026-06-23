# Parallel Graph Algorithms — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — level-synchronous BFS (frontier-by-frontier), work `O(V + E)` and span `O(D · log n)` for diameter `D`, the direction-optimizing (push/pull) heuristic, and a first parallel connected-components pass
- [Parallel Reduce and Map — Senior](../04-parallel-reduce-and-map/senior.md) — monoids, **semirings** `(⊕, ⊗)`, and generalized matrix products: `(∨, ∧)` for reachability, `(min, +)` for shortest paths — the algebra the linear-algebraic view of graphs is built on
- [Models of Parallel Computation: PRAM and Work–Span — Senior](../01-models-pram-work-span/senior.md) — `T₁`/`T∞`, Brent's theorem, the classes `NC` / `P-complete`, and why some problems admit polylog span while others are inherently sequential

## Table of Contents

1. [What Senior-Level Parallel-Graph Theory Is About](#what-senior-level-parallel-graph-theory-is-about)
2. [Pointer Jumping and List Ranking: The Fundamental Technique](#pointer-jumping-and-list-ranking-the-fundamental-technique)
3. [Parallel Connected Components: Shiloach–Vishkin and Its Descendants](#parallel-connected-components-shiloachvishkin-and-its-descendants)
4. [Parallel Minimum Spanning Tree: Borůvka Is Naturally Parallel](#parallel-minimum-spanning-tree-borvka-is-naturally-parallel)
5. [Parallel SSSP: The Span Problem and Delta-Stepping](#parallel-sssp-the-span-problem-and-delta-stepping)
6. [Graphs as Linear Algebra: The GraphBLAS View](#graphs-as-linear-algebra-the-graphblas-view)
7. [The Hardness: P-Complete Graph Problems Resist Parallelism](#the-hardness-p-complete-graph-problems-resist-parallelism)
8. [Worked Piece: BFS as SpMV over the (∨, ∧) Semiring](#worked-piece-bfs-as-spmv-over-the--semiring)
9. [Decision Framework](#decision-framework)
10. [Research Pointers](#research-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Parallel-Graph Theory Is About

The middle level establishes parallel BFS as an *algorithm*: maintain a frontier, expand all of its vertices' edges in parallel, deduplicate into the next frontier, repeat for `D` rounds. It gives the cost — work `O(V + E)`, span `O(D · log n)` — and the one essential optimization, Scott Beamer's **direction-optimizing BFS** (switch between top-down "push" and bottom-up "pull" as the frontier swells and shrinks). It even sketches connected components by label propagation. That is the "here is the canonical traversal and how to parallelize it" level.

Senior-level theory makes a stronger and less comfortable claim: **graph algorithms split sharply into a "parallel-friendly" class and an "inherently sequential" class, and the line between them is one of the deepest facts in the field.** BFS, connected components, minimum spanning tree, and list ranking fall on the friendly side — they admit polylogarithmic or near-polylog span via a small kit of techniques. Lexicographic DFS, maximum flow, and the lex-first maximal independent set fall on the hard side — they are `P-complete`, conjectured to have *no* polylog-span algorithm at all. The senior obligation is to know *which* technique parallelizes the friendly ones, *why* it works, and *why* the hard ones resist. Six threads run through this view:

1. **Pointer jumping (path doubling) is the master technique.** Wyllie's list-ranking algorithm ranks a linked list in `O(log n)` span by repeatedly replacing each node's successor pointer with its successor's successor — *doubling* the reach each round. This single "follow-and-double" idea is the engine behind parallel connected components, tree contraction, and the Euler-tour technique. It is to parallel *graphs* what scan is to parallel *sequences*.
2. **Connected components is `O(log n)`-span via hooking + jumping.** Shiloach and Vishkin (1982) interleave *hooking* (point each tree at a neighbor's root) with *pointer jumping* (shortcut every node toward its root) to converge a forest to flat star-trees in `O(log n)` rounds. The Awerbuch–Shiloach refinement and modern label-propagation/Afforest variants are practical descendants.
3. **MST is naturally parallel via Borůvka.** Borůvka's algorithm (1926) selects, for *every* component at once, its minimum outgoing edge and contracts — halving the component count each round, so `O(log n)` rounds. Each round is a parallel reduce (min-edge per component, a `(min)` reduction — see [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)) plus a contraction. MST was *born* parallel.
4. **SSSP is the hard one of the "easy" set, and delta-stepping is the answer.** Dijkstra is *inherently sequential* (it settles vertices one at a time in priority order); Bellman–Ford is parallel but does `O(V·E)` work. Meyer and Sanders's **delta-stepping** buckets vertices by `distance/Δ` and relaxes a whole bucket in parallel — a *tunable* knob `Δ` interpolating between Dijkstra's low work and Bellman–Ford's low span.
5. **Graphs are sparse linear algebra.** BFS is repeated sparse matrix–vector multiply (SpMV) of the adjacency matrix over the `(∨, ∧)` semiring; SSSP is SpMV over `(min, +)`; the frontier is a *sparse vector*. This **GraphBLAS** formulation (Kepner–Gilbert) unifies graph algorithms as semiring matrix ops and exposes the parallelism cleanly — it is the [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) semiring idea applied to whole graphs.
6. **Some graph problems are `P-complete` — you cannot expect polylog span.** Lexicographic DFS, maximum flow, and the lexicographically-first MIS are `P-complete`: a polylog-span algorithm for any of them would collapse `NC = P`. This is the parallel analogue of "NP-complete" — a complexity *barrier* that tells you to stop searching for a fast parallel algorithm and look for an approximate, randomized, or restructured one instead.

The unifying senior stance: **parallel graph algorithms are a contest between two forces — the doubling/contraction techniques that buy polylog span, and the `P-completeness` barrier that forbids it for the genuinely sequential problems.** Knowing which side a problem sits on, and which technique applies, is the whole skill. The work below develops each thread and ties it to the semiring algebra of [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) and the `NC`/`P-complete` classification of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md).

---

## Pointer Jumping and List Ranking: The Fundamental Technique

The single most important technique in parallel graph algorithms is **pointer jumping** (also called *path doubling* or *shortcutting*): in one parallel step, every node replaces its pointer to a successor with a pointer to its successor's successor. After `t` steps a node's pointer has leapt `2ᵗ` positions ahead. This is the *exact* graph analogue of the step-doubling in a Hillis–Steele scan — reach doubles every round, so `log n` rounds suffice to span any chain of `n` nodes.

### The list-ranking problem

**List ranking** is the canonical test case: given a linked list (each node knows only its immediate successor, the list scattered arbitrarily in memory), compute for every node its *distance to the end of the list* (its rank). Sequentially this is a trivial `O(n)` walk — but that walk is *purely sequential*, each step depending on the last, so it is the archetype of a computation that *looks* unparallelizable. List ranking is the "hello world" of parallel graph algorithms precisely because beating the sequential walk requires the doubling idea, and once you have it the same idea unlocks trees and general graphs.

### Wyllie's algorithm

Wyllie's algorithm (James C. Wyllie, 1979) ranks a list in `O(log n)` span by pointer jumping over *both* the successor pointers *and* an accumulating distance:

```text
WYLLIE-LIST-RANK(next[], rank[]):
  # rank[i] will become the number of hops from i to the list tail
  in parallel for each node i:
    rank[i] = (next[i] == NIL) ? 0 : 1      # one hop to the immediate successor (0 at tail)

  repeat ⌈log₂ n⌉ times:
    in parallel for each node i with next[i] ≠ NIL:
      rank[i] = rank[i] + rank[next[i]]     # accumulate the successor's running rank
      next[i] = next[next[i]]               # JUMP: point at the successor's successor
```

Each round, every node folds in its successor's current rank and then leaps past it. Because the reachable distance doubles each round, after `⌈log₂ n⌉` rounds every node points directly at `NIL` and `rank[i]` holds the true distance to the tail.

```text
   list:  a → b → c → d → e → NIL          ranks should be  4 3 2 1 0

   init:  a:1  b:1  c:1  d:1  e:0     next: a→b b→c c→d d→e e→NIL
   r1:    a:2  b:2  c:2  d:1  e:0     next: a→c b→d c→e d→NIL e→NIL   (jumped 2)
   r2:    a:4  b:3  c:2  d:1  e:0     next: a→e b→NIL c→NIL d→NIL ... (jumped 4)
   r3:    a:4  b:3  c:2  d:1  e:0     (all settled — done in ⌈log₂ 5⌉ = 3 rounds)
```

**Complexity.** Span `T∞ = O(log n)` (the round count). Work `T₁ = O(n log n)` — every one of the `n` nodes does work in every one of the `log n` rounds. This is the catch: Wyllie is **span-optimal but not work-optimal**. It does a `log n` factor more work than the sequential `O(n)` walk, the same work-inflation that afflicts the Hillis–Steele scan, and for the same reason — *every* element is active in *every* doubling round.

### Work-efficient list ranking: Cole–Vishkin

Wyllie's `O(n log n)` work is wasteful, and closing the gap to `O(n)` work *while keeping* `O(log n)` span was a landmark. The work-efficient solution is **randomized contraction** (a list-specific case of the general "shrink the problem geometrically, then expand the answer back" strategy) and **Cole–Vishkin deterministic coin-tossing** (Cole & Vishkin, 1986), which achieves `O(n)` work and `O(log n)` span deterministically via a clever `O(log* n)`-round symmetry-breaking that 3-colours the list so a constant fraction of nodes can be spliced out and the list contracted. The recursive structure is: *contract* the list to a constant fraction of its size (splicing out an independent set of nodes), *recurse* on the smaller list, then *expand* — restore the spliced nodes and fix up their ranks. `O(log n)` contraction levels, each `O(1)` span and geometrically shrinking work, gives `O(n)` total work and `O(log n)` span.

> **Why list ranking is the keystone.** The reason this one toy problem matters so much: *trees reduce to list ranking* via the **Euler tour**. Replace each tree edge with two directed arcs, link them into a single cycle (an Euler tour of the tree), and list-rank that cycle — now subtree sizes, vertex depths, pre/post-order numbers, and lowest-common-ancestor preprocessing all fall out of *one* list-ranking call. So "rank a list in `O(log n)` span, `O(n)` work" is really "do tree computations in `O(log n)` span" — and tree contraction, in turn, is a building block for connected components and for evaluating expression trees in parallel. Pointer jumping is the load-bearing primitive; list ranking is where you learn it.

---

## Parallel Connected Components: Shiloach–Vishkin and Its Descendants

Computing connected components — partition the vertices so two share a label iff a path connects them — is the showcase application of pointer jumping. The sequential algorithm (BFS/DFS from each unvisited vertex, or a union-find sweep over edges) is `O(V + E)` but inherently traversal-ordered. The parallel algorithm abandons traversal entirely and instead *grows and flattens a forest of "pointer trees"* until each tree is a flat star rooted at a component representative.

### The Shiloach–Vishkin algorithm (1982)

Shiloach and Vishkin's connected-components algorithm represents the partition as a forest: each vertex `v` has a parent pointer `P[v]`, and the *root* of `v`'s tree is its component's representative. The algorithm interleaves two operations until convergence:

- **Hooking.** For each edge `(u, v)`, if `u` and `v` are in *different* trees, *hook* one root onto the other — set the parent of one component's root to the other's root, merging the two trees. To break symmetry and guarantee progress, hooking is conditioned (e.g. always hook the larger-numbered root onto the smaller, or use a "conditional hooking" rule that hooks a root onto a *strictly smaller* neighbor root, plus a "stagnant" rule that catches roots that no conditional hook moved).
- **Pointer jumping (shortcutting).** For *every* vertex in parallel, `P[v] ← P[P[v]]` — shortcut each vertex halfway to its root. Repeated jumping flattens every tree toward a depth-1 star in `O(log n)` rounds, exactly as in list ranking.

The genius is the *interleaving*: hooking merges components (reducing their count) while jumping flattens the trees so that the *next* round's hooks see shallow trees and roots are cheap to find. Shiloach–Vishkin proves that this converges in `O(log n)` rounds with `O((V + E) log n)` work on a CRCW PRAM — the doubling of pointer-jumping bounds the round count, and each round is `O(V + E)` parallel work over the edges and vertices.

```text
   one SV round:
     HOOK:    for each edge (u,v) in parallel:  conditionally set P[root(u)] = root(v)
     JUMP:    for each vertex v in parallel:     P[v] = P[P[v]]
   repeat until no parent pointer changes  →  O(log n) rounds
```

### Awerbuch–Shiloach and the modern descendants

- **Awerbuch–Shiloach (1987)** simplifies the original into a cleaner *unconditional + conditional hooking* pair with a single shortcut step per round, and proves the same `O(log n)`-round / `O((V+E) log n)`-work bound with a more transparent correctness argument. It is the version most often presented and implemented.
- **Label propagation** is the practical workhorse: initialize `label[v] = v`, then repeatedly set each vertex's label to the minimum label among itself and its neighbors, until stable. It is trivially parallel (each round is an independent reduce over each vertex's neighborhood) but can take up to `O(D)` rounds (the diameter) to propagate a label across a long path — fast on low-diameter graphs, slow on chains, and lacking SV's `O(log n)` guarantee.
- **Afforest** (Sutton, Ben-Nun, Barak, 2018) is the state-of-the-art practical algorithm: it runs union-find but *samples* a subset of edges first to find the (usually single) giant component cheaply via a few **pointer-jumping (path-compressing)** passes, then processes only the remaining edges against that dominant component. It exploits the empirical fact that real graphs have one giant component, turning the worst-case `O(log n)`-round structure into near-linear practical work. The path-compression *is* pointer jumping reappearing inside union-find.

> **The throughline.** Every fast parallel connected-components algorithm is *hooking (merge components) + pointer jumping (flatten the merge forest)*, differing only in the symmetry-breaking rule and how much they exploit real-graph structure. The `O(log n)` round count is the doubling guarantee of §2 applied to the parent-pointer forest; the practical speed comes from path compression (pointer jumping under another name) and from the giant-component shortcut. This is the same pattern as MST's Borůvka contraction in §4 — *merge in parallel, shrink, repeat* — and indeed connected components is "MST without the weights."

---

## Parallel Minimum Spanning Tree: Borůvka Is Naturally Parallel

Of the three classical MST algorithms, two resist parallelism and one was *built* for it. Prim's grows a single tree one vertex at a time in priority order — sequential, like Dijkstra. Kruskal's sorts all edges and adds them one at a time — the sort parallelizes but the sequential union-find sweep does not. **Borůvka's algorithm** (Otakar Borůvka, 1926 — the oldest MST algorithm, predating both) is, by contrast, *embarrassingly* parallel in its structure.

### Borůvka's algorithm

Borůvka proceeds in *rounds*, and in each round operates on *all* components simultaneously:

```text
BORŮVKA-MST(V, E):
  components = {each vertex its own component}
  MST = ∅
  while more than one component remains:
    # STEP 1 — every component picks its minimum outgoing edge, all in parallel
    in parallel for each component C:
      min_edge[C] = the lightest edge with exactly one endpoint in C
    # STEP 2 — add all chosen edges to the MST (ties broken consistently to avoid cycles)
    MST = MST ∪ { min_edge[C] : all C }
    # STEP 3 — contract: merge components joined by chosen edges
    components = CONTRACT(components, chosen edges)
```

The correctness rests on the **cut property**: the minimum-weight edge crossing any cut (here, the cut isolating component `C`) is in *some* MST. Because every component picks its own minimum outgoing edge independently and in parallel, each round adds a *batch* of provably-safe MST edges at once — not one edge at a time.

### Why it parallelizes

The structural payoff: **each round at least halves the number of components.** Every surviving component picks an outgoing edge, so every component merges with at least one other — the component count drops by at least a factor of two. Therefore Borůvka terminates in at most `⌈log₂ V⌉` rounds. Each round is two parallel primitives:

- **Step 1 is a parallel reduce.** "The minimum outgoing edge of each component" is a **segmented `(min)` reduction** — group edges by component and reduce each group with the `min`-monoid. This is *exactly* the per-key reduce-by-min of [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md): `O(log n)` span, `O(E)` work, perfectly load-balanced regardless of component-size skew.
- **Step 3 is a parallel contraction.** Merging components joined by the chosen edges is a connected-components computation on the *graph of chosen edges* — and the chosen edges form a forest of "Borůvka trees," so relabeling vertices to their new component is pointer jumping / list ranking (§2, §3) over those trees. Contraction is itself `O(log n)` span.

So Borůvka is `O(log V)` rounds × `O(log V)`-span-per-round = `O(log² V)` span, with `O((V + E) log V)` work — placing MST squarely in `NC²`. Each round is a **min-reduce plus a contraction**, the two primitives developed above. This is the "link to ../03 reduction" made precise: the min-edge selection per component *is* a segmented reduce, and recognizing it as such is what gives the round its `O(log n)` span and its load balance.

> **The senior reframe.** MST is "connected components, but choose the lightest merging edge." Connected components hooks components together along *any* edge; Borůvka hooks them along the *minimum* edge (a reduce per component) and records that edge in the tree. Both are *merge-in-parallel-then-contract* loops with `O(log n)` rounds, and both lean on pointer jumping for the contraction. The practical fast parallel MST algorithms (Bader–Cong's parallel Borůvka, and the filtering variants that drop edges that cannot be in the MST before each round) are all Borůvka with engineering to cut the per-round work — exactly as Afforest is connected-components with engineering.

---

## Parallel SSSP: The Span Problem and Delta-Stepping

Single-source shortest paths is the hard member of the "tractable" family, and understanding *why* sharpens the whole picture. The difficulty is a **span problem**, and it comes from Dijkstra.

### Why Dijkstra is inherently sequential

Dijkstra's algorithm settles vertices one at a time, always picking the *unsettled vertex of minimum tentative distance*. That "minimum-first" discipline is what makes it work-optimal (`O(E + V log V)`) — each edge is relaxed once, after its tail is settled. But it is also a *strict total order on vertex settlement*: you cannot settle vertex `v` until you are sure no shorter path through a not-yet-settled vertex exists, which requires settling all closer vertices first. This is a sequential dependency chain of length `V`. Dijkstra has essentially *no* parallelism within its settling order; its span is `Θ(V)` in the worst case. The priority-queue discipline that makes it efficient is exactly what makes it serial.

At the opposite extreme, **Bellman–Ford** relaxes *all* edges in parallel for `V − 1` rounds. It is gloriously parallel within each round (every edge relaxed independently, the relaxation `dist[v] = min(dist[v], dist[u] + w)` being a `(min, +)` operation) and has span `O(V · log n)` — but it does `O(V · E)` work, a factor of `V` more than Dijkstra. So SSSP presents a stark **work–span tradeoff**: Dijkstra is work-optimal and span-terrible; Bellman–Ford is span-good and work-terrible. The senior question is whether you can get *both* — and `Δ`-stepping is the practical answer.

### Delta-stepping (Meyer–Sanders)

Ulrich Meyer and Peter Sanders's **delta-stepping** (1998/2003) interpolates between Dijkstra and Bellman–Ford with a single tunable parameter `Δ`. The idea: instead of one strict priority order (Dijkstra) or none (Bellman–Ford), group tentative distances into **buckets** of width `Δ` — bucket `k` holds vertices with tentative distance in `[k·Δ, (k+1)·Δ)` — and process buckets in order, but settle a *whole bucket in parallel*.

The subtlety is that relaxing a vertex can insert *into the current bucket* (a light edge keeps you in the same range), so each bucket must be drained to a fixpoint. The fix is to split edges by weight:

- **Light edges** (`weight ≤ Δ`) can re-insert into the current bucket, so the current bucket is relaxed *repeatedly* — each pass relaxes all light edges out of the bucket's current members in parallel, possibly re-adding vertices to the same bucket — until the bucket is empty.
- **Heavy edges** (`weight > Δ`) always land in a *later* bucket, so they are relaxed *once*, after the current bucket is finally settled (deferred, to avoid wasted work).

```text
DELTA-STEPPING(s, Δ):
  buckets[ dist[v]/Δ ]  hold vertices by tentative distance
  dist[s] = 0; place s in bucket 0
  for k = 0, 1, 2, … (in order):
    R = ∅                                  # remembered, for deferred heavy relaxation
    while bucket[k] not empty:             # drain light edges to a fixpoint
      Cur = bucket[k];  bucket[k] = ∅
      R = R ∪ Cur
      in parallel relax all LIGHT edges out of Cur     # may re-fill bucket[k]
    in parallel relax all HEAVY edges out of R         # one deferred pass
```

`Δ` is the knob: **`Δ → ∞` collapses to Bellman–Ford** (one giant bucket, everything relaxed every round — max parallelism, max work), and **`Δ → 0` (one bucket per distinct distance) collapses to Dijkstra** (strict priority order — min work, no parallelism). A moderate `Δ` (often tuned to `≈ 1/max-degree` or the average edge weight) settles many vertices per bucket *in parallel* while doing only a small constant factor more relaxations than Dijkstra. On graphs with bounded degree and random edge weights, delta-stepping achieves near-linear work with polylogarithmic-ish span — the sweet spot that made it the basis of practical parallel SSSP (it is the SSSP kernel of the Graph500 / GAP benchmarks).

### The breakthroughs beyond delta-stepping

Delta-stepping is a heuristic — its bounds depend on graph structure and on tuning `Δ`, and it is not provably work-efficient with low span on *all* graphs. Closing that has been an active research frontier:

- **Radius-stepping** (Blelloch, Gu, Sun, Tangwongsan, 2016) gives provable work–span bounds (`O(m log n)` work, low-`polylog` span on bounded-radius graphs) by stepping in *graph radius* rather than fixed `Δ`-bands.
- **The 2023 sorting-barrier breakthrough.** A celebrated 2023 result (Duan, Mao, and collaborators) broke the long-standing `O(m + n log n)` "sorting barrier" for directed SSSP with a deterministic `O(m · log^{2/3} n)` algorithm — the first asymptotic improvement on Dijkstra-with-Fibonacci-heaps for sparse graphs in decades. It restructures the settling order to avoid the full priority-queue sort, which is exactly the sequential bottleneck delta-stepping attacks heuristically, and it has reinvigorated the search for *provably* work-efficient low-span SSSP.

> **The senior takeaway on SSSP.** Shortest paths is `(min, +)` relaxation (the tropical semiring of [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)) over the graph, and the *only* hard question is the *order* of relaxations: Dijkstra's optimal order is a sequential chain; doing everything (Bellman–Ford) wastes work; delta-stepping's bucketed order trades a tunable bit of extra work for parallelism. SSSP sits *just* inside the tractable family — it is in `NC` (you can compute it via `O(log² n)` rounds of `(min,+)` matrix squaring, the §6 / §8 trick) but *work-efficient* low-span SSSP is genuinely hard, which is why it remains a live research area while BFS, CC, and MST are textbook-settled.

---

## Graphs as Linear Algebra: The GraphBLAS View

The deepest *unifying* idea in parallel graph algorithms is that **graph algorithms are sparse linear algebra over semirings.** This is the [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) semiring view — a generalized matrix product `(A ⊗ B)[i][j] = ⊕_k (A[i][k] ⊗ B[k][j])` parameterized by a semiring `(⊕, ⊗)` — applied with `A` the **adjacency matrix** of the graph. The Kepner–Gilbert program (*Graph Algorithms in the Language of Linear Algebra*, 2011) and the resulting **GraphBLAS** standard build an entire graph-algorithm library on exactly this footing.

### BFS is repeated matrix–vector multiply

Let `A` be the `n × n` adjacency matrix (`A[i][j] = 1` iff edge `i → j`), and let the current BFS frontier be a **sparse boolean vector** `f` (`f[i] = 1` iff `i` is in the frontier). One step of BFS — "find all vertices reachable in one hop from the frontier" — is the matrix–vector product over the **boolean `(∨, ∧)` semiring**:

```text
   next[j]  =  ⋁_i  ( f[i] ∧ A[i][j] )           # is ANY frontier vertex i adjacent to j?
            =  (Aᵀ ⊗ f)[j]   over the (∨, ∧) semiring
```

`next[j]` is true iff *some* frontier vertex `i` has an edge to `j`. Masking out already-visited vertices (a GraphBLAS *masked* operation — apply the SpMV only where the visited-set is false) yields the next frontier. **BFS is just repeated `(∨, ∧)` SpMV of the adjacency matrix against the frontier vector, with a visited mask** — run until the frontier empties. This is worked end-to-end in §8.

### One algebra, many algorithms

Swap the semiring and the *same* SpMV machinery computes a different graph algorithm:

| Semiring `(⊕, ⊗)` | SpMV `Aᵀ ⊗ f` computes | Graph algorithm |
|---|---|---|
| `(∨, ∧)` — boolean | "is any frontier vertex adjacent to `j`?" | **BFS / reachability** |
| `(min, +)` — tropical | "min over `i` of `dist[i] + w(i,j)`" | **SSSP relaxation** (Bellman–Ford / delta-stepping step) |
| `(min, ×)` or `(max, ×)` | "best multiplicative path weight" | **most-reliable path**, max-probability |
| `(+, ×)` — real | "number / weighted count of paths" | **path counting, PageRank step, BFS-with-multiplicity** |
| `(max, min)` | "widest bottleneck to `j`" | **maximum-capacity / bottleneck path** |

The frontier as a *sparse vector* is the load-bearing detail: an active BFS frontier touches few vertices, so `f` is sparse, and **sparse-matrix × sparse-vector (SpMSpV)** does work proportional to the edges *out of the frontier* — exactly `O(V + E)` summed over all BFS levels, matching the direct algorithm. The direction-optimizing push/pull switch of Beamer's BFS even has a clean linear-algebraic reading: **push** is `Aᵀ ⊗ f` (multiply *from* the sparse frontier), **pull** is scanning unvisited rows of `A` against `f` (multiply *into* the unvisited set) — the two are the row-major vs column-major orientations of the *same* SpMV, and choosing between them by frontier density is choosing the cheaper traversal of the sparse product.

> **Why the linear-algebra view wins.** Three payoffs. (1) **Unification** — BFS, SSSP, path counting, PageRank, and reachability are *one* SpMV kernel parameterized by a semiring; you implement the kernel once and get a shelf of algorithms (the §6 of the reduce file applied to whole graphs). (2) **Parallelism is exposed, not hidden** — SpMV is a textbook-parallel kernel (a per-row segmented `⊕`-reduce of `⊗`-products, see [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)), so the parallelism is *in the algebra* rather than buried in pointer-chasing traversal code. (3) **Hardware maturity** — decades of sparse-linear-algebra engineering (cache blocking, format choice CSR/CSC/DCSC, load balancing) transfer directly to graphs. The cost is that the algebra hides constant factors and the masking/format bookkeeping; GraphBLAS (and its reference SuiteSparse:GraphBLAS) exists to provide a tuned, portable kernel so you write graph algorithms as a few lines of masked SpMV.

---

## The Hardness: P-Complete Graph Problems Resist Parallelism

The senior must also know the *negative* results — the graph problems that are conjectured to have **no** fast parallel algorithm. The relevant complexity class is `NC` (problems solvable in `polylog(n)` span with `poly(n)` processors — "efficiently parallelizable") versus `P` (problems solvable in polynomial sequential time). The open question `NC =? P` is the parallel analogue of `P =? NP`, and the hardest problems in `P` for parallelization are the **`P-complete`** ones: a problem is `P-complete` if it is in `P` *and* every problem in `P` reduces to it under `NC` (log-space) reductions. If *any* `P-complete` problem were in `NC`, then `NC = P` — every polynomial-time problem would parallelize. Almost no one believes that, so:

> **`P-complete` is the "inherently sequential" verdict.** A `P-complete` problem is one for which a `polylog`-span algorithm is as unlikely as `P = NP`-style collapses. It is the signal to *stop* looking for a fast exact parallel algorithm and instead approximate, randomize, restrict the input, or accept the sequential bound.

Several important graph problems are `P-complete`:

- **Lexicographic DFS.** Ordinary reachability and BFS are in `NC`, but computing the *specific* depth-first traversal order that a sequential DFS produces — the **lexicographically-first DFS** — is `P-complete` (Reif, 1985). DFS's defining behavior is "dive as deep as possible before backtracking," and that deep recursion is a long sequential dependency chain that resists parallelization. This is a sharp and surprising contrast: **BFS parallelizes beautifully (frontier-at-a-time), DFS's traversal order does not.** (One can compute *a* DFS forest in `randomized NC`, but the *lex-first* order — the order with the specific tie-breaking — is `P-complete`.)
- **Maximum flow.** The max-flow value (and a max flow) is `P-complete`. The augmenting-path / push-relabel structure is sequential at its core — each augmentation depends on the residual graph the previous one produced — and no `NC` algorithm is known. (Approximate and special-case parallel flow algorithms exist, but exact general max flow resists.)
- **Lexicographically-first maximal independent set (lex-first MIS).** *Some* maximal independent set is computable in `NC` — Luby's celebrated randomized algorithm (1986) finds *a* maximal independent set in `O(log n)` span by random priority + parallel removal — but the *lexicographically-first* MIS (the one a greedy sequential scan produces) is `P-complete`. This is the canonical lesson: **the parallel-friendly version of a problem is often a *different, relaxed* version of the sequential one.** You give up "the specific answer the sequential greedy gives" to gain "*an* equally-valid answer, fast."

The recurring pattern across all three is **the lexicographically-first / greedy-order curse**: insisting on the *exact* output of a sequential greedy or depth-first process imposes a sequential dependency that is `P-complete`. The way out is almost always to *relax the specification* — accept *any* maximal independent set (Luby) rather than the lex-first one, accept *a* spanning forest rather than a specific DFS tree, accept an *approximate* flow. This mirrors the `NC`/`P` story of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md): the classification tells you *whether* to search for a fast parallel algorithm at all, and `P-completeness` is the "don't bother — relax the problem instead" verdict.

> **The contrast, sharpened.** The "nice" parallel graph problems — BFS, connected components, MST, list ranking — share a structure that *admits* doubling or contraction: their answers are determined by *global* properties (reachability, the minimum crossing edge, distance to tail) that many local parallel decisions converge to, regardless of order. The "hard" ones — lex-DFS, max flow, lex-MIS — pin down an answer by a *specific sequential order* of local greedy choices, and that order is the dependency chain `P-completeness` formalizes. Senior judgment is recognizing which kind you face *before* you spend a week trying to parallelize a `P-complete` problem.

---

## Worked Piece: BFS as SpMV over the (∨, ∧) Semiring

To make the linear-algebraic view concrete, run BFS end-to-end as repeated masked sparse matrix–vector products, then read off its work, span, and the parallelism the algebra exposes — the way the reduce file traces `(min,+)` through one round of shortest paths.

### The setup

Take a small directed graph on vertices `{0,1,2,3,4}` with edges `0→1, 0→2, 1→3, 2→3, 3→4`. Its adjacency matrix `A` (`A[i][j] = 1` iff `i → j`) and its transpose `Aᵀ` (which we multiply against the frontier):

```text
        to: 0 1 2 3 4              Aᵀ[j][i] = 1 iff edge i→j
   A =  0 [ 0 1 1 0 0 ]      We compute next = Aᵀ ⊗ f over (∨, ∧):
        1 [ 0 0 0 1 0 ]        next[j] = ⋁_i ( Aᵀ[j][i] ∧ f[i] )
        2 [ 0 0 0 1 0 ]                 = ⋁_i ( A[i][j]  ∧ f[i] )   # "any in-frontier i with i→j?"
        3 [ 0 0 0 0 1 ]
        4 [ 0 0 0 0 0 ]
```

BFS from source `s = 0`. The state is a **sparse boolean frontier vector** `f` and a **visited mask** `visited`.

### The frontier expansion as a semiring SpMV

Each BFS level is: `next = (Aᵀ ⊗ f)` over `(∨, ∧)`, then mask off visited vertices, then fold the survivors into `visited`.

```text
   level 0:  f = {0}              visited = {0}
             next = Aᵀ ⊗ f  =  ⋁ over i∈{0} of A[0][·]  =  {1, 2}
             mask: remove visited → {1,2};  visited = {0,1,2}

   level 1:  f = {1, 2}           visited = {0,1,2}
             next = A[1][·] ∨ A[2][·]  =  {3} ∨ {3}  =  {3}     # de-dup is FREE: ∨ idempotent
             mask: {3} \ visited = {3};  visited = {0,1,2,3}

   level 2:  f = {3}              visited = {0,1,2,3}
             next = A[3][·]  =  {4};  mask → {4};  visited = {0,1,2,3,4}

   level 3:  f = {4}              next = A[4][·] = ∅  →  frontier empty, BFS done.
```

**Read the semiring at work.** The `⊗ = ∧` is the *map* step: "does frontier vertex `i` reach `j`?" The `⊕ = ∨` is the *reduce* step: "does *any* such `i` exist?" — and because `∨` is **idempotent**, two frontier vertices both pointing at `j` (vertices 1 and 2 both → 3) collapse to a single `1` *for free*: the duplicate-elimination that a hand-written BFS does with a `if not visited` check is *built into the boolean reduce*. The visited *mask* is a GraphBLAS masked-assignment, applied elementwise.

### Complexity, read off the algebra

- **Per level.** `next = Aᵀ ⊗ f` over `(∨, ∧)` is a **sparse matrix × sparse vector (SpMSpV)**: for each frontier vertex `i` (the nonzeros of `f`), scan its out-edges (row `i` of `A`) and `∨`-reduce into `next`. Work per level = `O(Σ_{i ∈ frontier} deg(i))` — exactly the edges leaving the frontier. Summed over all levels, every edge is touched once: total work `T₁ = O(V + E)`, identical to direct BFS. No work is wasted by the algebraic phrasing.
- **Span.** Each SpMSpV is a parallel map (`∧` over all frontier out-edges, `O(1)` span) followed by a per-target `∨`-reduce (a segmented `(∨)`-reduce, `O(log n)` span — the reduce machinery of [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)). With `D` levels (the diameter), total span `T∞ = O(D · log n)` — *exactly* the middle-level bound, now *derived* as `D` rounds of an `O(log n)`-span semiring reduce rather than asserted.
- **Why this is the payoff.** *Nothing in the kernel is BFS-specific.* Swap `(∨, ∧)` for `(min, +)` and the *same* SpMV loop becomes Bellman–Ford SSSP — `next[j] = min_i (dist[i] + w(i,j))` — and the `D`-round structure becomes the relaxation rounds (which delta-stepping then re-orders for efficiency, §5). Swap in `(+, ×)` and it counts paths / does a PageRank power iteration. One masked-SpMV kernel, an algebra as the parameter, is a shelf of graph algorithms — the GraphBLAS thesis made concrete, and the direct realization of the semiring map-reduce from [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md).

### The push/pull duality in one line

The direction-optimizing switch is now algebraic: **push** computes `next = Aᵀ ⊗ f` by iterating the *nonzeros of the sparse frontier* `f` and scattering along their out-edges — cheap when `f` is *small*. **Pull** computes the same product by iterating the *unvisited* target vertices `j` and checking whether *any* in-neighbor is in `f` — cheap when `f` is *large* (most targets find a frontier in-neighbor immediately and stop early). Same `(∨, ∧)` product, two access orders (row-major vs column-major of `A`); Beamer's heuristic picks the cheaper one by frontier density each level. The algebra makes the duality obvious — it is the standard SpMV "by rows vs by columns" choice — where the imperative phrasing made it an ad-hoc trick.

---

## Decision Framework

When you must parallelize a graph computation, classify it first, then pick the technique:

1. **Is it inherently sequential? Check for `P-completeness` first.** If the task demands the *exact* output of a sequential greedy or depth-first order — *lexicographically-first* DFS, *the* specific MIS a greedy scan yields, exact max flow — it is likely `P-complete`: *stop* hunting for a polylog-span algorithm and **relax the spec** (accept *any* maximal independent set via Luby, *a* spanning forest, an *approximate* flow). The `NC`/`P` classification of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md) is the gate.
2. **Traversal / reachability? Use level-synchronous BFS, not DFS.** BFS parallelizes (frontier-at-a-time, `O(V+E)` work, `O(D log n)` span); DFS's traversal order does not. Add Beamer's **direction-optimizing** push/pull switch (cheap when the frontier is small/large respectively). For very high-diameter graphs, BFS's `O(D)` round count hurts — consider the linear-algebraic batched approach or a different decomposition.
3. **Connected components? Hooking + pointer jumping (Shiloach–Vishkin / Awerbuch–Shiloach), or Afforest in practice.** `O(log n)` rounds of merge-then-flatten. On real (giant-component) graphs, **Afforest** (sampled union-find with path compression) is fastest. **Label propagation** is simplest but `O(D)` rounds.
4. **MST? Borůvka — it is naturally parallel.** `O(log V)` rounds, each a **segmented `(min)`-reduce** (lightest edge per component — see [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)) plus a **pointer-jumping contraction**. Not Prim (sequential, like Dijkstra) and not the sequential part of Kruskal.
5. **SSSP? Delta-stepping, tuned by `Δ`.** Dijkstra is work-optimal but `Θ(V)`-span (sequential settling); Bellman–Ford is parallel but `O(V·E)` work. **Delta-stepping** buckets by `distance/Δ` and relaxes light/heavy edges to interpolate — tune `Δ` to the degree/weight distribution. Watch the recent provably-efficient SSSP results (radius-stepping; the 2023 sorting-barrier algorithm) if you need guarantees.
6. **A "sequential-looking" pointer chase? Reach for pointer jumping / list ranking.** Distance-to-end, subtree sizes, depths, Euler-tour computations — all are `O(log n)`-span via **Wyllie** (`O(n log n)` work) or work-efficient **Cole–Vishkin** (`O(n)` work). Trees reduce to list ranking via the Euler tour.
7. **Want one kernel for many algorithms? Go linear-algebraic (GraphBLAS).** Express the algorithm as masked **SpMV over a semiring**: `(∨, ∧)` = BFS/reachability, `(min, +)` = SSSP relaxation, `(+, ×)` = path counting/PageRank. The frontier is a sparse vector; the parallelism is in the algebra. Use a tuned library (SuiteSparse:GraphBLAS) rather than hand-rolling the SpMV.

---

## Research Pointers

- **Wyllie, J. C. (1979).** *The Complexity of Parallel Computations.* PhD thesis, Cornell. The original `O(log n)`-span, `O(n log n)`-work pointer-jumping list-ranking algorithm.
- **Cole, R., & Vishkin, U. (1986).** "Deterministic coin tossing with applications to optimal parallel list ranking." *Information and Control.* `O(n)`-work, `O(log n)`-span deterministic list ranking via `O(log* n)` symmetry-breaking.
- **Shiloach, Y., & Vishkin, U. (1982).** "An O(log n) parallel connectivity algorithm." *Journal of Algorithms.* The hooking + pointer-jumping connected-components algorithm.
- **Awerbuch, B., & Shiloach, Y. (1987).** "New connectivity and MSF algorithms for shuffle-exchange network and PRAM." *IEEE Trans. Computers.* The cleaner unconditional/conditional-hooking variant.
- **Sutton, M., Ben-Nun, T., & Barak, A. (2018).** "Optimizing Parallel Graph Connectivity Computation via Subgraph Sampling" (**Afforest**). *IPDPS.* The state-of-the-art practical connected-components algorithm exploiting the giant component.
- **Borůvka, O. (1926).** "O jistém problému minimálním." The original (and oldest) MST algorithm — round-based, naturally parallel. See **Bader, D. A., & Cong, G. (2006)**, "Fast shared-memory algorithms for computing the minimum spanning forest," *JPDC*, for the modern parallel Borůvka.
- **Meyer, U., & Sanders, P. (2003).** "Δ-stepping: a parallelizable shortest path algorithm." *Journal of Algorithms.* The tunable bucket-based SSSP interpolating Dijkstra and Bellman–Ford.
- **Blelloch, G. E., Gu, Y., Sun, Y., & Tangwongsan, K. (2016).** "Parallel Shortest Paths Using Radius Stepping." *SPAA.* Provable work–span bounds for parallel SSSP.
- **Duan, R., Mao, J., et al. (2023).** "Breaking the Sorting Barrier for Directed Single-Source Shortest Paths." The `O(m·log^{2/3} n)` deterministic SSSP that beats Dijkstra's sorting bound on sparse graphs.
- **Beamer, S., Asanović, K., & Patterson, D. (2012).** "Direction-Optimizing Breadth-First Search." *SC.* The push/pull hybrid BFS.
- **Kepner, J., & Gilbert, J. (eds.) (2011).** *Graph Algorithms in the Language of Linear Algebra.* SIAM. The semiring/SpMV foundation; and the **GraphBLAS** standard (Kepner et al., 2016) with SuiteSparse:GraphBLAS (Davis).
- **Reif, J. H. (1985).** "Depth-first search is inherently sequential." *Information Processing Letters.* The `P-completeness` of lexicographically-first DFS.
- **Luby, M. (1986).** "A simple parallel algorithm for the maximal independent set problem." *SIAM J. Computing.* The `O(log n)`-span randomized MIS — *a* MIS in `NC`, even though *lex-first* MIS is `P-complete`.
- **Greenlaw, R., Hoover, H. J., & Ruzzo, W. L. (1995).** *Limits to Parallel Computation: P-Completeness Theory.* Oxford. The catalogue of `P-complete` problems, including lex-DFS, max flow, and lex-first MIS.

---

## Key Takeaways

- **Pointer jumping (path doubling) is the master technique.** Wyllie's list ranking ranks a list in `O(log n)` span by repeatedly pointing each node at its successor's successor — reach doubles per round, the graph analogue of a scan's step-doubling. It is `O(n log n)`-work (span-optimal, not work-optimal); **Cole–Vishkin** closes it to `O(n)` work via deterministic coin-tossing. Trees reduce to list ranking via the Euler tour, so this one technique unlocks subtree sizes, depths, and LCA in `O(log n)` span.
- **Connected components is `O(log n)`-span via hooking + pointer jumping.** **Shiloach–Vishkin (1982)** interleaves hooking (merge components) and shortcutting (flatten the forest); **Awerbuch–Shiloach** simplifies it; **label propagation** is simple but `O(D)`-round; **Afforest** is the practical state of the art, exploiting the giant component with path-compressing union-find.
- **MST was born parallel: Borůvka.** Every component picks its **minimum outgoing edge** (a segmented `(min)`-reduce, [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md)) and contracts — halving the component count each round, so `O(log V)` rounds. Each round is a **min-reduce + a pointer-jumping contraction**: MST is "connected components, choosing the lightest merging edge."
- **SSSP is the hard member of the easy family, and delta-stepping is the answer.** Dijkstra is work-optimal but `Θ(V)`-span (sequential settling order); Bellman–Ford is parallel but `O(V·E)`-work. **Meyer–Sanders delta-stepping** buckets by `distance/Δ` and relaxes light/heavy edges, with `Δ` tuning between the two extremes. Provably work-efficient low-span SSSP (radius-stepping; the 2023 sorting-barrier result) is still a live research frontier.
- **Graphs are sparse linear algebra (GraphBLAS).** BFS = repeated masked SpMV `Aᵀ ⊗ f` over the `(∨, ∧)` semiring against a sparse frontier vector; SSSP = the same over `(min, +)`; path counting = `(+, ×)`. One kernel, an algebra as the parameter — the [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) semiring idea applied to whole graphs, with parallelism exposed in the algebra and push/pull falling out as row-vs-column SpMV.
- **Some graph problems are `P-complete` — don't expect polylog span.** Lexicographically-first DFS (Reif 1985), maximum flow, and lex-first MIS are inherently sequential: a polylog-span algorithm would collapse `NC = P`. The curse is insisting on the *exact* output of a sequential greedy/DFS order; the escape is to **relax the spec** (Luby's *any* MIS, *a* spanning forest, an *approximate* flow). Classify with the `NC`/`P` theory of [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md) before investing in parallelization.

---

> **See also:** [`./middle.md`](./middle.md) for level-synchronous BFS, the `O(V+E)` / `O(D log n)` bounds, direction-optimizing push/pull, and a first connected-components pass · [`./professional.md`](./professional.md) for production graph-engine engineering (CSR/CSC layout, load balancing, GPU traversal, GraphBLAS in practice) · [`../04-parallel-reduce-and-map/senior.md`](../04-parallel-reduce-and-map/senior.md) for monoids, semirings, and the generalized matrix product that makes BFS/SSSP one SpMV kernel · [`../01-models-pram-work-span/senior.md`](../01-models-pram-work-span/senior.md) for `NC`, `P-completeness`, work–span, and why some problems resist parallelism
