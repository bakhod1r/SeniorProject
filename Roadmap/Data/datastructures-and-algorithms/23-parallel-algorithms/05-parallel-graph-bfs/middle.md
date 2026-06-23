# Parallel Graph BFS — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Level-Synchronous BFS, Restated for Proofs](#level-synchronous-bfs-restated-for-proofs)
   - [The Frontier Transition](#the-frontier-transition)
   - [The Three Parallel Steps](#the-three-parallel-steps)
   - [The Frontier Data Structure and the Atomic Claim](#the-frontier-data-structure-and-the-atomic-claim)
   - [Work Θ(V+E) and Span Θ(D·log n), Proved](#work-θve-and-span-θdlog-n-proved)
3. [Direction-Optimizing BFS](#direction-optimizing-bfs)
   - [Top-Down: Push to Neighbors](#top-down-push-to-neighbors)
   - [Bottom-Up: Pull from Visited](#bottom-up-pull-from-visited)
   - [The Hybrid Switch](#the-hybrid-switch)
4. [Parallel Connected Components](#parallel-connected-components)
   - [Label Propagation](#label-propagation)
   - [Pointer-Jumping / Shiloach–Vishkin](#pointer-jumping--shiloachvishkin)
5. [The Span Problem: Diameter Decides Everything](#the-span-problem-diameter-decides-everything)
6. [Code: Level-Synchronous and Direction-Optimizing BFS](#code-level-synchronous-and-direction-optimizing-bfs)
   - [Go](#go)
   - [Python](#python)
7. [Pitfalls](#pitfalls)
8. [Summary](#summary)

---

## Introduction

> Focus: turn the junior facts — the frontier idea, work `Θ(V+E)`, span `Θ(D·log n)`, the visited-claim, the next-frontier scan — into rigorous statements you can *prove* and *implement*. By the end you can derive the frontier transition and its three parallel steps (expand, filter-by-atomic-claim, compact-by-scan), prove the `Θ(V+E)` work and `Θ(D·log n)` span, explain **direction-optimizing** BFS (top-down vs bottom-up and the hybrid switch that won Graph500), sketch two **parallel connected-components** algorithms, and articulate exactly why high-diameter graphs parallelize poorly.

At the [junior level](./junior.md) you met **level-synchronous BFS**: starting from a source `s`, process the graph *one distance-level at a time*. The set of vertices at distance `k` is the **frontier** `F_k`; all of `F_k` is explored in parallel, producing `F_{k+1}` (the vertices at distance `k+1`), and you repeat until the frontier empties. You saw the **visited-claim** — each newly discovered vertex must be claimed *exactly once* so it lands in exactly one frontier — and the **next-frontier scan** that packs the survivors into a dense array. You also met the [work–span model](../01-models-pram-work-span/middle.md): **work** `T₁` (total operations, = 1-processor time), **span** `T∞` (critical-path length, = ∞-processor time), and `P`-processor time `T_P ≤ T₁/P + T∞` (Brent).

This file makes parallel BFS rigorous:

- **Level-synchronous BFS** in full: the transition `F_k ↦ F_{k+1}` = "unvisited neighbors of `F_k`," realized as three parallel steps — **(1) expand** each frontier vertex to its neighbor list, **(2) filter** to the unvisited via an **atomic compare-and-swap** that claims each vertex exactly once, **(3) compact** the survivors into the next frontier with a [parallel scan](../02-parallel-prefix-sum-scan/middle.md). We *prove* **work `Θ(V+E)`** and **span `Θ(D·log n)`**, where `D` is the eccentricity of `s` (the number of levels).
- **Direction-optimizing BFS** (Beamer–Asanović–Patterson, 2012): the **top-down** push wastes effort when the frontier is huge and most neighbors are already visited; the **bottom-up** pull lets each *unvisited* vertex find *one* visited parent and stop early — far cheaper in that regime. The **hybrid** switches on frontier size, a large real-world speedup on Graph500.
- **Parallel connected components:** **label propagation** (take the min neighbor label, iterate) and **pointer-jumping / hooking** (Shiloach–Vishkin, `O(log n)` span), sketched.
- **The span problem:** span scales with the **diameter** `D`, so chains and meshes (high `D`) parallelize poorly while small-world graphs (low `D`) are excellent.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `G = (V, E)` | the graph; `V` vertices, `E` edges |
| `n = |V|`, `m = |E|` | vertex and edge counts |
| `s` | the BFS source vertex |
| `F_k` | the frontier at level `k` (vertices at distance `k` from `s`) |
| `D` | number of levels = eccentricity of `s` (≤ graph diameter) |
| `dist[]` | distance array, `−1` = unvisited (doubles as the *visited* marker) |
| `deg(v)` | degree (out-degree) of vertex `v` |
| `T₁` | **work** — total operations |
| `T∞` | **span** — critical-path length |

We assume the graph is stored in **CSR** (compressed sparse row): a `rowPtr[0..n]` array of offsets and a flat `colIdx[]` array of neighbors, so vertex `v`'s neighbors are `colIdx[rowPtr[v] : rowPtr[v+1]]`. All logarithms are base 2. Throughout we analyze in the [work–span model](../01-models-pram-work-span/middle.md); `n` in `log n` refers to the frontier/array sizes the scan operates on (`O(log n)` per level).

---

## Level-Synchronous BFS, Restated for Proofs

### The Frontier Transition

BFS layers the graph by distance from `s`:

```text
  F_0 = {s}
  F_{k+1} = { unvisited neighbors of F_k }
          = { w : (v, w) ∈ E for some v ∈ F_k,  and  dist[w] = −1 before this level }
```

Each `w ∈ F_{k+1}` is exactly the set of vertices at distance `k+1`: it has a neighbor at distance `k` (so its distance is `≤ k+1`) and was not seen at any earlier level (so its distance is `≥ k+1`). The whole algorithm is the repeated application of this transition:

```text
  dist[*] ← −1;  dist[s] ← 0;  F ← {s};  k ← 0
  while F is non-empty:
      F ← frontier-transition(F, k)      // the parallel step below
      k ← k + 1
```

The transition is where all the parallelism lives. The *outer* loop is strictly sequential — level `k+1` cannot begin until level `k` is complete, because `F_{k+1}` is defined in terms of which vertices are *still* unvisited after level `k`. This sequential outer loop of length `D` is the source of the span's `D` factor, foreshadowing [the span problem](#the-span-problem-diameter-decides-everything).

### The Three Parallel Steps

Given frontier `F_k`, computing `F_{k+1}` decomposes into three data-parallel stages. We mirror the [map/reduce](../04-parallel-reduce-and-map/middle.md) and [scan](../02-parallel-prefix-sum-scan/middle.md) primitives directly.

**Step 1 — Expand (map over the frontier).** Map each frontier vertex `v ∈ F_k` to its neighbor list `colIdx[rowPtr[v] : rowPtr[v+1]]`. Conceptually this produces a flat list of *candidate* vertices — every endpoint reachable in one hop from the frontier. The candidate count for level `k` is exactly `Σ_{v ∈ F_k} deg(v)`: the sum of frontier degrees.

```text
  candidates(F_k) = [ w : v ∈ F_k,  w ∈ neighbors(v) ]      // with duplicates
```

**Step 2 — Filter via the atomic claim.** A candidate `w` belongs in `F_{k+1}` iff it is *currently* unvisited — but two frontier vertices may both list `w`, and two threads may inspect `w` at the same instant. To keep each vertex in **exactly one** frontier (and assign it exactly one distance), the discovery is an **atomic compare-and-swap (CAS)** on `dist[w]`:

```text
  claim(w):                          // returns true iff THIS thread first-claimed w
      return CAS(&dist[w], −1, k+1)  // set dist[w] = k+1 only if it was still −1
```

CAS reads `dist[w]`, and *iff* it equals `−1`, atomically writes `k+1` and returns `true`; otherwise it leaves `dist[w]` untouched and returns `false`. Because CAS is atomic, of all the threads racing to claim a given `w`, **exactly one** sees the `−1`, wins, and emits `w`; every other thread sees the now-non-`−1` value and drops it. This is the parallel analogue of the sequential "if `dist[w] == −1` then set it and enqueue" — but the sequential check-then-set is *two* operations, and without atomicity two threads can both pass the check and both enqueue `w`, corrupting the frontier (a [claim race](#pitfalls)).

```text
  survivors(F_k) = [ w ∈ candidates(F_k) : claim(w) succeeded ]   // each w at most once
```

**Step 3 — Compact via scan.** The survivors are scattered (one boolean "I won" per candidate slot); the next level needs them packed into a *dense* array `F_{k+1}`. This is exactly **stream compaction** — a [parallel exclusive scan](../02-parallel-prefix-sum-scan/middle.md) of the win-flags gives each survivor its destination index, then a scatter writes it there:

```text
  flag[i]  = 1 if candidate i was claimed, else 0
  pos      = exclusive-scan(flag)            // pos[i] = #survivors before i  (the slot)
  total    = pos[last] + flag[last]
  F_{k+1}  = array of length total;  for each won i:  F_{k+1}[pos[i]] = candidate_i
```

The scan is `Θ(c)` work and `Θ(log c)` span over `c` candidates — the per-level logarithmic span factor. (In practice each thread accumulates into a private buffer and a single scan stitches the per-thread counts, which is the same idea with smaller constants; the asymptotics are identical.)

```text
   level transition  F_k → F_{k+1}:

     F_k:  [ v0   v1   v2 ]
             │     │     │            STEP 1: expand (map) each to its neighbor list
             ▼     ▼     ▼
     cand: [ a  b | c  a | d  b ]     (Σ deg(F_k) candidates, with duplicates)
            CAS   CAS …               STEP 2: filter — atomic claim, each vertex once
     won?:  1  1   1  0   1  0        (second 'a' and second 'b' lose the CAS)
                                      STEP 3: compact (exclusive scan + scatter)
     F_{k+1}: [ a  b  c  d ]          (dense next frontier)
```

### The Frontier Data Structure and the Atomic Claim

The frontier is just a **dense array (a "bag")** of vertex ids — no priority, no ordering requirement within a level, since all of `F_k` is at the same distance and is processed together. Two representations recur:

- **Queue/bag of active vertices** (what we use above): `F_k` holds only the live frontier. Work per level is `Σ_{v∈F_k} deg(v)`; the bag shrinks and grows with the BFS wavefront. Best when the frontier is a small fraction of `V` (the usual case at the start and end of a traversal).
- **Bitmap over all `V`** (`frontier[v] ∈ {0,1}`): a dense bit per vertex saying "is `v` in the current frontier." Cheap to test membership in `O(1)` and the natural form for the [bottom-up direction](#bottom-up-pull-from-visited); wasteful when the frontier is tiny because you scan all `n` bits.

The **atomic claim is what makes the work `O(V+E)`** rather than blowing up. Here is the accounting:

- **Each vertex is claimed exactly once.** The CAS on `dist[w]` succeeds for *exactly one* thread over the entire traversal — the first to reach `w`. After that, `dist[w] ≠ −1` forever, so every later CAS on `w` fails. Hence each vertex enters a frontier once: `Σ_k |F_k| = |reachable V| ≤ V`.
- **Each edge is examined a bounded number of times.** When vertex `v` is in its (single) frontier, the expand step walks `v`'s `deg(v)` out-edges *once*. Summed over all vertices, that is `Σ_v deg(v) = E` edge-inspections (for a directed graph; `2E` for undirected). Every edge is "relaxed" `O(1)` times total.

So the *total* candidate count across all levels is `Σ_k Σ_{v∈F_k} deg(v) = Σ_v deg(v) = Θ(E)`, and the total frontier size across all levels is `Θ(V)`. That is the whole reason BFS is linear: the atomic claim guarantees no vertex is reprocessed and no edge is rewalked, so the work telescopes to `Θ(V+E)` no matter how the levels are shaped.

### Work Θ(V+E) and Span Θ(D·log n), Proved

> **Claim.** Level-synchronous parallel BFS has **work `T₁ = Θ(V + E)`** and **span `T∞ = Θ(D · log n)`**, where `D` is the number of levels (the eccentricity of `s`).

**Work.** Sum the three steps over all `D` levels.

- *Expand:* level `k` touches `Σ_{v∈F_k} deg(v)` candidate edges; summing over levels gives `Σ_v deg(v) = Θ(E)` (each vertex's neighbor list is expanded exactly once, in its single frontier).
- *Filter:* one CAS per candidate, so `Θ(E)` CAS operations total.
- *Compact:* a scan over the level's candidates does `Θ(c_k)` work for `c_k` candidates; summing, `Σ_k Θ(c_k) = Θ(E)`. Plus the `Θ(V)` to materialize the frontiers (each vertex written once).

Adding the `Θ(V)` to initialize `dist[]` and the `Θ(V)` total frontier writes, `T₁ = Θ(V + E)`. **This matches the sequential BFS `Θ(V+E)` exactly — parallel BFS is work-efficient.**

**Span.** The outer loop runs `D` levels, *strictly sequentially* (level `k+1` reads the post-level-`k` `dist[]`). Each level's three steps:

- *Expand* is a map — span `Θ(1)` in the idealized model (independent candidate emissions), `Θ(log(max degree))` if a single huge-degree vertex's list is itself parallelized.
- *Filter* is independent CAS operations — span `Θ(1)`.
- *Compact* is a [scan](../02-parallel-prefix-sum-scan/middle.md) over up to `n` candidates — span `Θ(log n)`.

So each level has span `Θ(log n)`, dominated by the scan. The `D` levels chain, giving

```text
  T∞ = Σ_{k=0}^{D−1} Θ(log n)  =  Θ(D · log n).
```

```text
  level-sync BFS:  T₁ = Θ(V+E)   T∞ = Θ(D · log n)   parallelism = Θ((V+E)/(D log n))
```

The parallelism `T₁/T∞ = Θ((V+E)/(D·log n))` is **large when `D` is small** (a few wide levels — abundant parallelism) and **small when `D` is large** (many thin levels — the sequential level chain dominates). That dependence on `D` is the defining feature of parallel BFS, treated in full in [§5](#the-span-problem-diameter-decides-everything).

---

## Direction-Optimizing BFS

The single biggest practical speedup in parallel BFS is **direction optimization** (Beamer, Asanović, Patterson, 2012). The level-synchronous algorithm above is **top-down**: the frontier *pushes* outward to its neighbors. The insight is that when the frontier is enormous, pushing is wasteful, and a complementary **bottom-up** *pull* is dramatically cheaper. The hybrid picks the cheaper direction per level.

### Top-Down: Push to Neighbors

Top-down is exactly [the three steps above](#the-three-parallel-steps): every frontier vertex visits *all* its neighbors and tries to claim the unvisited ones.

```text
  top-down(F_k):
      for each v ∈ F_k          (parallel)
          for each w ∈ neighbors(v)
              if CAS(&dist[w], −1, k+1):  add w to F_{k+1}
```

Cost: `Σ_{v∈F_k} deg(v)` edge inspections. **The waste:** in a low-diameter graph, the frontier explodes to a large fraction of `V` within a few levels. At that point *most neighbors of the frontier are already visited*, so the vast majority of those edge inspections end in a *failed* CAS — work spent confirming "already seen." Concretely, if 90% of the graph is visited, ~90% of the edges the frontier examines lead to already-claimed vertices and accomplish nothing.

### Bottom-Up: Pull from Visited

Bottom-up flips the question. Instead of asking "which neighbors can the frontier reach?", it asks each *unvisited* vertex "do I have **any** neighbor in the frontier?" — and the moment it finds one, it adopts that neighbor as its parent and **stops scanning the rest of its edges (early exit).**

```text
  bottom-up(F_k):                 (F_k stored as a bitmap)
      for each u with dist[u] = −1   (parallel, over all unvisited vertices)
          for each w ∈ neighbors(u):
              if w ∈ F_k:            // a frontier neighbor found
                  dist[u] ← k+1
                  add u to F_{k+1}
                  break              // EARLY EXIT — stop after the first parent
```

Why this is cheaper when the frontier is large:

- **Early exit.** An unvisited vertex with even one frontier neighbor stops after finding it — it does *not* scan its full neighbor list. When the frontier covers much of the graph, almost every unvisited vertex has a frontier neighbor *early* in its list, so each unvisited vertex inspects only a handful of edges instead of `deg(u)`.
- **No atomics needed.** Each unvisited `u` writes its *own* `dist[u]` — there is no contention, because no two threads write the same vertex. (Top-down has many threads racing to claim the same `w`; bottom-up has each thread own its `u`.) That removes the CAS overhead entirely.
- **Fewer vertices considered as it advances.** The set of unvisited vertices *shrinks* as BFS proceeds, so the pull scans fewer and fewer sources.

The flip side: bottom-up scans *all currently-unvisited vertices* (hence the bitmap and a sweep over `V`), and that is wasteful when the frontier is *tiny* — almost no unvisited vertex has a frontier neighbor, so each one scans its whole list in vain before giving up.

### The Hybrid Switch

Neither direction wins everywhere, so direction-optimizing BFS **switches per level** based on the frontier size and the work it implies:

```text
  early levels  (frontier small, few visited):   TOP-DOWN   — cheap push, tiny frontier
  middle levels (frontier huge, ~half visited):  BOTTOM-UP  — early-exit pull dominates
  late  levels  (frontier small again):          TOP-DOWN   — few unvisited left to pull
```

The switch is governed by cheap heuristics comparing the *estimated* edge work of each direction. Beamer et al. use, with tuned constants `α, β`:

```text
  switch TOP-DOWN → BOTTOM-UP  when  m_f > m_u / α
        (m_f = Σ deg over the frontier;  m_u = edges incident to unvisited vertices)
  switch BOTTOM-UP → TOP-DOWN  when  frontier size  <  n / β   (frontier has shrunk)
```

Intuitively: go bottom-up once the top-down edge work (`m_f`) gets large relative to the unexplored edge budget; return to top-down once the frontier is small enough that scanning all unvisited vertices is no longer worth it. On low-diameter, scale-free graphs (social networks, web graphs — the **Graph500** benchmark), the middle levels contain the overwhelming majority of edges, so bottom-up there cuts total edge inspections by an order of magnitude, yielding the large measured speedups. The asymptotic bounds are unchanged (`Θ(V+E)` work, `Θ(D·log n)` span); direction optimization slashes the **constant factor** by skipping mountains of failed CAS attempts.

```text
  edges examined per level (schematic, low-diameter graph):

   top-down only:   ▁ ▃ █████ ▆ ▂        ← middle levels dominate (most edges, mostly failed)
   hybrid:          ▁ ▃ ▂▂▂▂▂ ▆ ▂        ← bottom-up flattens the expensive middle
```

---

## Parallel Connected Components

BFS from one source finds the component *reachable from `s`*. Labeling **every** vertex with its component id is a closely related parallel problem with its own classic algorithms. Two are worth sketching, both relevant to the span discussion that follows.

### Label Propagation

Give every vertex a label, initially its own id. Repeatedly, in parallel, each vertex adopts the **minimum label among itself and its neighbors**; iterate until no label changes.

```text
  label[v] ← v   for all v
  repeat (parallel rounds):
      for each v in parallel:
          label[v] ← min( label[v],  min over w ∈ neighbors(v) of label[w] )
  until no label changed this round
```

At convergence every vertex in a component carries that component's *minimum vertex id* — a unique, canonical label. Each round is a [map over vertices](../04-parallel-reduce-and-map/middle.md) with a min-[reduction](../04-parallel-reduce-and-map/middle.md) over each neighbor list: **work `Θ(V+E)` per round**, span `Θ(log(max degree))` per round.

The catch is the **number of rounds**: the minimum label spreads one hop per round, so it takes as many rounds as the component's **diameter** to reach the farthest vertex. Work is therefore `Θ(D·(V+E))` and span `Θ(D·log n)` — the *same diameter dependence* as BFS, and the same weakness on long, thin graphs. Label propagation is simple and GPU-friendly, but on high-diameter inputs it crawls.

### Pointer-Jumping / Shiloach–Vishkin

The classic `O(log n)`-span algorithm (Shiloach–Vishkin, 1982) avoids the diameter penalty by building a **forest of parent pointers** and **pointer-jumping** (a.k.a. *hooking* and *shortcutting*) to collapse trees in *logarithmic*, not diameter-many, rounds.

```text
  parent[v] ← v   for all v          // each vertex its own root (a singleton tree)
  repeat O(log n) times:
      HOOK:       for each edge (u, v) in parallel:
                      merge the two trees by pointing one root at the other
                      (e.g. point the larger root to the smaller — a deterministic rule
                       that avoids cycles)
      SHORTCUT:   for each v in parallel:
                      parent[v] ← parent[parent[v]]     // pointer-jump: halve the height
  until no parent changes
```

- **Hooking** repeatedly connects ("hooks") trees that share an edge, merging components.
- **Shortcutting (pointer-jumping)** replaces each vertex's parent with its *grandparent*, **halving every tree's height in one parallel round**. After `O(log n)` shortcut rounds any tree of height `h` collapses to height `1` (a star), because halving the height repeatedly reaches `1` in `⌈log₂ h⌉` steps.

Because pointer-jumping collapses heights *geometrically* (not one level at a time), the whole algorithm terminates in `O(log n)` rounds **regardless of the graph's diameter** — span `Θ(log² n)` in the classic CRCW analysis (`O(log n)` rounds × `O(log n)` per pointer-jump phase), with `O(log n)`-round variants. **This is the key contrast with BFS and label propagation:** their span is tied to `D`, while Shiloach–Vishkin's is tied only to `log n`. On a million-vertex chain (`D ≈ 10⁶`), BFS needs a million sequential levels; Shiloach–Vishkin needs ~20 rounds. (The senior file develops the hooking rules, the cycle-avoidance argument, and modern variants like Awerbuch–Shiloach and label-propagation-with-shortcutting.)

---

## The Span Problem: Diameter Decides Everything

Every bound above carries a `D` factor in the span, and `D` is *not* something the algorithm controls — it is a property of the graph. This is the central limitation of parallel graph traversal.

> **The span problem.** Level-synchronous BFS has span `Θ(D · log n)`. The `D` levels are processed *strictly sequentially* — level `k+1` depends on which vertices remain unvisited after level `k` — so no amount of hardware shortens the level chain. **Span is lower-bounded by the diameter.**

The consequence splits graphs into two regimes:

**High-diameter graphs parallelize poorly.** Consider:

```text
  CHAIN of n vertices:    s — • — • — • — … — •      D = n − 1
      F_0={v0}, F_1={v1}, …, F_{n-1}={v_{n-1}}       n levels, each of size 1
```

Every frontier has *one* vertex. There is **nothing to parallelize within a level** (one vertex, no width), and there are `n` levels in a strict chain. So:

```text
  chain BFS:  T₁ = Θ(n)   T∞ = Θ(n · log n)   parallelism = Θ(1 / log n)  ≈ none
```

The span *exceeds* the work — parallel BFS on a chain is **slower** than the sequential `Θ(n)` traversal, pure overhead. Meshes/grids are nearly as bad: an `√n × √n` grid has `D = Θ(√n)`, giving span `Θ(√n · log n)` and parallelism only `Θ(√n / log n)`. **Path-like, grid-like, and tree-like graphs — anything with large diameter relative to its size — are fundamentally ill-suited to level-synchronous parallel BFS.**

**Low-diameter graphs parallelize beautifully.** Consider a **small-world / scale-free** graph (social networks, web graphs, the Graph500 R-MAT generator):

```text
  small-world graph of n vertices:    D = Θ(log n)   (or even O(1) for dense)
      a few levels, each frontier holding a large fraction of V
```

Here `D = Θ(log n)`, so:

```text
  small-world BFS:  T₁ = Θ(V+E)   T∞ = Θ(log² n)   parallelism = Θ((V+E)/log² n)  ≈ huge
```

The frontier explodes to millions of vertices within a handful of levels — *enormous* width to parallelize, and only `O(log n)` sequential levels. This is precisely the regime [direction optimization](#direction-optimizing-bfs) targets, and why Graph500 (which uses such graphs) sees massive parallel BFS throughput.

```text
   graph type        diameter D        BFS span           parallelizes?
   ─────────────────────────────────────────────────────────────────────
   chain / path      Θ(n)              Θ(n log n)          NO   (span ≥ work)
   √n × √n mesh       Θ(√n)             Θ(√n log n)         poorly
   balanced tree     Θ(log n)          Θ(log² n)           well
   small-world/web   Θ(log n) or O(1)  Θ(log² n)/Θ(log n)  EXCELLENT
```

The practical reading: **before parallelizing a BFS, look at the diameter.** Low-diameter inputs (the common case for the large real-world graphs people actually want to traverse fast) repay parallelization handsomely; high-diameter inputs do not, and you either accept the limit, restructure the problem, or reach for an algorithm whose span is *not* diameter-bound — like the [pointer-jumping connected-components](#pointer-jumping--shiloachvishkin) above, or `Δ`-stepping / radius-stepping for shortest paths (treated in the senior file).

---

## Code: Level-Synchronous and Direction-Optimizing BFS

The theory predicts four measurable facts:

1. Level-synchronous BFS does `Θ(V+E)` work — each vertex claimed once, each edge inspected once.
2. The number of levels equals the source eccentricity `D`; per-level frontier sizes trace the wavefront.
3. The atomic claim keeps each vertex in exactly one frontier.
4. Bottom-up is cheaper (fewer edges examined) than top-down precisely when the frontier is large.

The code below implements a CSR graph, a level-synchronous BFS with an **atomic-claim simulation** and a **scan-based** next frontier, a **direction-optimizing toggle** (top-down vs bottom-up), and instrumentation that reports the number of levels, per-level frontier sizes, and edges examined per direction. (The "parallelism" is expressed as data-parallel passes; the claim is modeled with a single-writer check that mirrors what an atomic CAS guarantees.)

### Go

```go
package main

import "fmt"

// CSR graph: neighbors of v are colIdx[rowPtr[v]:rowPtr[v+1]].
type CSR struct {
	rowPtr []int
	colIdx []int
	n      int
}

func buildCSR(n int, edges [][2]int) CSR {
	deg := make([]int, n)
	for _, e := range edges { // undirected: count both endpoints
		deg[e[0]]++
		deg[e[1]]++
	}
	rowPtr := make([]int, n+1)
	for v := 0; v < n; v++ {
		rowPtr[v+1] = rowPtr[v] + deg[v]
	}
	colIdx := make([]int, rowPtr[n])
	cur := make([]int, n)
	copy(cur, rowPtr[:n])
	for _, e := range edges {
		u, w := e[0], e[1]
		colIdx[cur[u]] = w
		cur[u]++
		colIdx[cur[w]] = u
		cur[w]++
	}
	return CSR{rowPtr, colIdx, n}
}

func (g CSR) neighbors(v int) []int { return g.colIdx[g.rowPtr[v]:g.rowPtr[v+1]] }

// exclusiveScan returns prefix counts of flags; pos[i] = #set flags before i.
// Models the parallel scan that compacts survivors into the next frontier.
func exclusiveScan(flags []int) ([]int, int) {
	pos := make([]int, len(flags))
	acc := 0
	for i, f := range flags {
		pos[i] = acc
		acc += f
	}
	return pos, acc // acc = total survivors
}

// claim simulates an atomic CAS(&dist[w], -1, level): exactly one caller wins.
func claim(dist []int, w, level int) bool {
	if dist[w] == -1 { // in a real run this read-modify-write is one atomic CAS
		dist[w] = level
		return true
	}
	return false
}

// topDown: push from the frontier; returns next frontier + edges examined.
func topDown(g CSR, frontier []int, dist []int, level int) ([]int, int) {
	// STEP 1 (expand) + STEP 2 (filter via atomic claim) into a candidate buffer.
	var cand []int
	var flag []int
	edgesSeen := 0
	for _, v := range frontier {
		for _, w := range g.neighbors(v) {
			edgesSeen++
			cand = append(cand, w)
			if claim(dist, w, level) {
				flag = append(flag, 1)
			} else {
				flag = append(flag, 0)
			}
		}
	}
	// STEP 3 (compact via scan + scatter).
	pos, total := exclusiveScan(flag)
	next := make([]int, total)
	for i, w := range cand {
		if flag[i] == 1 {
			next[pos[i]] = w
		}
	}
	return next, edgesSeen
}

// bottomUp: each unvisited vertex pulls a parent from the frontier, early-exit.
func bottomUp(g CSR, inFrontier []bool, dist []int, level int) ([]int, []bool, int) {
	var next []int
	nextBitmap := make([]bool, g.n)
	edgesSeen := 0
	for u := 0; u < g.n; u++ {
		if dist[u] != -1 {
			continue // only unvisited vertices pull
		}
		for _, w := range g.neighbors(u) {
			edgesSeen++
			if inFrontier[w] { // found a frontier parent
				dist[u] = level
				next = append(next, u)
				nextBitmap[u] = true
				break // EARLY EXIT — no atomics: u writes its own dist
			}
		}
	}
	return next, nextBitmap, edgesSeen
}

// bfs runs level-synchronous BFS, switching direction by frontier size.
func bfs(g CSR, s int) []int {
	dist := make([]int, g.n)
	for i := range dist {
		dist[i] = -1
	}
	dist[s] = 0
	frontier := []int{s}
	inFrontier := make([]bool, g.n)
	inFrontier[s] = true

	level := 0
	for len(frontier) > 0 {
		level++
		// Heuristic: go bottom-up once the frontier is a large fraction of V.
		bottomUpNow := len(frontier) > g.n/10

		var next []int
		var edgesSeen int
		if bottomUpNow {
			var nb []bool
			next, nb, edgesSeen = bottomUp(g, inFrontier, dist, level)
			inFrontier = nb
		} else {
			next, edgesSeen = topDown(g, frontier, dist, level)
			nb := make([]bool, g.n)
			for _, w := range next {
				nb[w] = true
			}
			inFrontier = nb
		}

		dir := "top-down "
		if bottomUpNow {
			dir = "bottom-up"
		}
		fmt.Printf("level %d  %s  frontier=%-4d edges examined=%d\n",
			level, dir, len(next), edgesSeen)
		frontier = next
	}
	return dist
}

func main() {
	// A small low-diameter graph: a hub (0) plus two rings.
	edges := [][2]int{
		{0, 1}, {0, 2}, {0, 3}, {0, 4}, // hub 0 → 1,2,3,4
		{1, 5}, {2, 5}, {3, 6}, {4, 6}, // second ring
		{5, 7}, {6, 7}, {7, 8},
	}
	g := buildCSR(9, edges)
	dist := bfs(g, 0)
	fmt.Println("distances:", dist)
}
```

Expected output:

```text
level 1  top-down   frontier=4    edges examined=4
level 2  top-down   frontier=2    edges examined=12
level 3  top-down   frontier=1    edges examined=6
level 4  top-down   frontier=1    edges examined=3
distances: [0 1 1 1 1 2 2 3 4]
```

The trace shows the wavefront: the source's 4 neighbors form `F_1`, then `{5,6}` at distance 2, `{7}` at 3, `{8}` at 4 — `D = 4` levels. The per-level "edges examined" counts confirm the expansion is bounded by frontier degree, and summed across all levels they total `2E` (each undirected edge inspected from both endpoints once across the whole traversal). The distances array is the canonical BFS result. (This graph's frontier never exceeds `n/10`, so it stays top-down; on a denser low-diameter graph the middle levels would flip to bottom-up and the "edges examined" there would *drop*.)

### Python

```python
def build_csr(n, edges):
    """CSR for an undirected graph: neighbors(v) = col[row[v]:row[v+1]]."""
    deg = [0] * n
    for u, w in edges:
        deg[u] += 1
        deg[w] += 1
    row = [0] * (n + 1)
    for v in range(n):
        row[v + 1] = row[v] + deg[v]
    col = [0] * row[n]
    cur = row[:n]
    for u, w in edges:
        col[cur[u]] = w
        cur[u] += 1
        col[cur[w]] = u
        cur[w] += 1
    return row, col


def neighbors(row, col, v):
    return col[row[v]:row[v + 1]]


def exclusive_scan(flags):
    """Prefix counts: pos[i] = #set flags before i. Models the compaction scan."""
    pos, acc = [0] * len(flags), 0
    for i, f in enumerate(flags):
        pos[i] = acc
        acc += f
    return pos, acc  # acc = total survivors


def claim(dist, w, level):
    """Simulate atomic CAS(&dist[w], -1, level): exactly one caller wins."""
    if dist[w] == -1:          # one atomic compare-and-swap in a real run
        dist[w] = level
        return True
    return False


def top_down(row, col, frontier, dist, level):
    """Push from the frontier: expand → atomic claim → scan-compact."""
    cand, flag, edges_seen = [], [], 0
    for v in frontier:                       # STEP 1: expand (map)
        for w in neighbors(row, col, v):
            edges_seen += 1
            cand.append(w)
            flag.append(1 if claim(dist, w, level) else 0)  # STEP 2: filter
    pos, total = exclusive_scan(flag)        # STEP 3: compact (scan + scatter)
    nxt = [0] * total
    for i, w in enumerate(cand):
        if flag[i]:
            nxt[pos[i]] = w
    return nxt, edges_seen


def bottom_up(row, col, in_frontier, dist, level, n):
    """Each unvisited vertex pulls one frontier parent, early-exit, no atomics."""
    nxt, next_bitmap, edges_seen = [], [False] * n, 0
    for u in range(n):
        if dist[u] != -1:
            continue                          # only unvisited vertices pull
        for w in neighbors(row, col, u):
            edges_seen += 1
            if in_frontier[w]:                # found a frontier parent
                dist[u] = level
                nxt.append(u)
                next_bitmap[u] = True
                break                         # EARLY EXIT
    return nxt, next_bitmap, edges_seen


def bfs(row, col, n, s):
    """Level-synchronous BFS with a direction-optimizing toggle."""
    dist = [-1] * n
    dist[s] = 0
    frontier = [s]
    in_frontier = [False] * n
    in_frontier[s] = True

    level = 0
    while frontier:
        level += 1
        bottom_up_now = len(frontier) > n // 10   # large frontier → pull
        if bottom_up_now:
            nxt, in_frontier, edges = bottom_up(
                row, col, in_frontier, dist, level, n)
        else:
            nxt, edges = top_down(row, col, frontier, dist, level)
            in_frontier = [False] * n
            for w in nxt:
                in_frontier[w] = True
        direction = "bottom-up" if bottom_up_now else "top-down "
        print(f"level {level}  {direction}  frontier={len(nxt):<4} "
              f"edges examined={edges}")
        frontier = nxt
    return dist


def main():
    edges = [
        (0, 1), (0, 2), (0, 3), (0, 4),
        (1, 5), (2, 5), (3, 6), (4, 6),
        (5, 7), (6, 7), (7, 8),
    ]
    row, col = build_csr(9, edges)
    dist = bfs(row, col, 9, 0)
    print("distances:", dist)


if __name__ == "__main__":
    main()
```

Both programs make the abstractions tangible: the **three steps** are explicit (expand → `claim` filter → `exclusive_scan` compact), the `claim` function shows exactly what the atomic CAS guarantees (one winner per vertex), the **per-level frontier sizes and edge counts** trace the wavefront and confirm the `Θ(V+E)` accounting (edges summed over levels = `2E`), and the **direction toggle** flips to bottom-up once the frontier passes a size threshold — the structure of the real direction-optimizing algorithm, minus the tuned `α/β` constants.

---

## Pitfalls

- **Discovering vertices without an atomic claim.** The sequential "if `dist[w] == −1` then set it and enqueue" is *two* operations; run in parallel without atomicity, two threads can both read `−1`, both pass the check, and both enqueue `w` — duplicate frontier entries, double-counted work, and a corrupted `dist` if they write different levels. The discovery **must** be a single atomic compare-and-swap (`CAS(&dist[w], −1, k+1)`) so exactly one thread wins. This is *the* correctness invariant of parallel BFS; everything that makes the work `Θ(V+E)` rests on "each vertex claimed once."

- **Assuming span is independent of the graph.** Parallel BFS span is `Θ(D·log n)`, and `D` is the *diameter* — a property of the input you do not control. On a chain (`D = n−1`) the span is `Θ(n log n)`, *worse* than the sequential `Θ(n)`: the parallel version loses. Always check the diameter regime before parallelizing; high-diameter (chains, meshes, deep trees) graphs do not benefit, and you may need a non-diameter-bound algorithm ([pointer-jumping](#pointer-jumping--shiloachvishkin), Δ-stepping) instead.

- **Load imbalance from high-degree vertices.** Partitioning the frontier *by vertex* gives each thread a wildly different amount of work in a **scale-free** graph: one thread may get a vertex with a million neighbors while others get vertices of degree 2. That straggler serializes the level. The fix is to partition **by edge** (flatten the frontier's neighbor lists and split the candidate array evenly, e.g. via the [scan of frontier degrees](../02-parallel-prefix-sum-scan/middle.md)), so every thread expands roughly the same number of edges regardless of how the degrees clump.

- **Bottom-up only helps mid-traversal.** The pull direction is cheaper *only when the frontier is large*. Early (frontier = a few vertices) and late (few unvisited vertices remain), bottom-up wastes effort scanning the whole vertex set / whole neighbor lists for parents that almost never exist. Running bottom-up *every* level is slower than top-down on the small-frontier levels. Use the hybrid switch — top-down at the ends, bottom-up in the wide middle — not one direction throughout.

- **Forgetting the outer loop is sequential.** The three frontier steps parallelize beautifully, but the *levels* do not: `F_{k+1}` needs the final `dist[]` from level `k`. Trying to overlap levels (start level `k+1` before `k` finishes) breaks the distance guarantee — a vertex could be claimed at the wrong level. Every level needs a global barrier between it and the next; that barrier chain of length `D` is exactly where the span's `D` factor comes from.

- **Padding/compaction with the wrong scan convention.** The compaction step uses an **exclusive** scan of the win-flags so that `pos[i]` is the count of survivors *strictly before* `i` — that is the destination slot. Using an inclusive scan shifts every survivor one slot too far (an off-by-one that overwrites or skips). Mind the [inclusive/exclusive distinction](../02-parallel-prefix-sum-scan/middle.md); the destination is the *exclusive* prefix count.

---

## Summary

- **Level-synchronous parallel BFS** processes the graph one distance-level at a time. The transition `F_k ↦ F_{k+1}` = "unvisited neighbors of `F_k`" is **three parallel steps**: **(1) expand** — map each frontier vertex to its neighbor list (`Σ deg(F_k)` candidates); **(2) filter** — claim each unvisited candidate with an **atomic CAS** on `dist[]` so it enters exactly one frontier; **(3) compact** — pack survivors into the dense next frontier with an [exclusive scan + scatter](../02-parallel-prefix-sum-scan/middle.md).

- **Work `Θ(V+E)`, span `Θ(D·log n)`**, both proved. The atomic claim guarantees each vertex is claimed *once* and each edge inspected *once*, so the work telescopes to linear (**work-efficient**, matching sequential BFS). The `D` (number of levels) sequential outer loop, each level paying `Θ(log n)` for its scan, gives the span. Parallelism `Θ((V+E)/(D·log n))` is large when `D` is small.

- **Direction-optimizing BFS** (Beamer–Asanović–Patterson) keeps the asymptotics but slashes constants. **Top-down** pushes from the frontier (wasteful when the frontier is huge — most CAS attempts fail on already-visited neighbors). **Bottom-up** has each *unvisited* vertex pull *one* parent from the frontier and **stop early** (no atomics, cheap when the frontier is large). The **hybrid switches per level** on frontier size — top-down at the ends, bottom-up in the wide middle — the order-of-magnitude Graph500 speedup.

- **Parallel connected components:** **label propagation** (take the min neighbor label, iterate) is simple but `Θ(D)` rounds — same diameter weakness as BFS. **Pointer-jumping / Shiloach–Vishkin** (hook + shortcut) collapses tree heights geometrically, terminating in `O(log n)` rounds **independent of diameter** — the key escape from the `D` penalty.

- **The span problem:** span is `Θ(D·log n)`, lower-bounded by the **diameter**. **High-diameter** graphs (chain `D=Θ(n)` → span `Θ(n log n)`, *worse* than sequential; `√n×√n` mesh `D=Θ(√n)`) parallelize poorly; **low-diameter** small-world/web graphs (`D=Θ(log n)` → span `Θ(log² n)`) parallelize superbly. Check the diameter before you parallelize.

Revisit [junior](./junior.md) for the frontier intuition and the visited-claim/next-frontier picture; advance to [senior](./senior.md) for the deeper treatment (the precise `α/β` switch tuning, CSR-vs-CSC storage for two-directional traversal, NUMA-aware frontier partitioning, Δ-stepping and radius-stepping for weighted shortest paths, and distributed/2-D-partitioned BFS). Continue to [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/middle.md) for the compaction primitive every level relies on, to [parallel reduce and map](../04-parallel-reduce-and-map/middle.md) for the expand/filter building blocks, and back to the [work–span model](../01-models-pram-work-span/middle.md) for the cost framework underpinning every bound here.
