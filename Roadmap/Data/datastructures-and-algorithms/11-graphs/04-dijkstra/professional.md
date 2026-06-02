# Dijkstra's Algorithm — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Correctness Proof — The Settled-Vertex Invariant
3. Complexity by Priority-Queue Choice
4. Δ-Stepping and Parallel Bounds
5. Lower Bounds and Optimality of Comparison-Based SSSP
6. Cache Behavior
7. Average-Case Analysis
8. Space-Time Trade-offs
9. Comparison with Alternatives
10. Open Problems and Recent Results
11. Summary

---

## 1. Formal Definition

Let `G = (V, E)` be a directed graph with a weight function `w : E → ℝ≥0` (non-negative reals). Fix a source `s ∈ V`. The **shortest-path distance** is

```text
δ(s, v) = min { w(p) : p is a path from s to v },   where w(p) = Σ_{e ∈ p} w(e),
```

with `δ(s, v) = ∞` if no path exists, and `δ(s, s) = 0`.

**Definition 1.1 (Tentative distance).** Dijkstra maintains an array `d : V → ℝ≥0 ∪ {∞}` with `d[s] = 0`, `d[v] = ∞` otherwise. At all times `d[v] ≥ δ(s, v)` (`d[v]` is an *over*-estimate; never below the truth).

**Definition 1.2 (Relaxation).**
```text
RELAX(u, v):  if d[u] + w(u, v) < d[v] then d[v] ← d[u] + w(u, v); π[v] ← u
```
where `π` is the predecessor array.

**Definition 1.3 (Settled set).** A set `S ⊆ V` of vertices for which `d[v] = δ(s, v)` has been proven. Dijkstra grows `S` one vertex per iteration.

**Algorithm (Dijkstra 1959).**
```text
DIJKSTRA(G, w, s):
  for each v in V: d[v] ← ∞; π[v] ← nil
  d[s] ← 0; S ← ∅; Q ← V  (min-priority queue keyed by d)
  while Q ≠ ∅:
    u ← EXTRACT-MIN(Q)
    S ← S ∪ {u}
    for each (u, v) in E:
      RELAX(u, v)            # may trigger DECREASE-KEY(Q, v)
```

**Proposition 1.4 (Upper-bound invariant).** Throughout execution, `d[v] ≥ δ(s, v)` for all `v`. *Proof.* Initially true. `RELAX` sets `d[v]` to `d[u] + w(u,v)`, which is the length of *some* `s→v` walk (the best-known `s→u` route extended by edge `(u,v)`), hence `≥ δ(s,v)`. ∎

This invariant is the floor; the correctness theorem (Section 2) supplies the matching ceiling on settled vertices.

---

## 2. Correctness Proof — The Settled-Vertex Invariant

We follow the CLRS exchange-argument style.

**Theorem 2.1.** When `DIJKSTRA` runs on `G = (V, E)` with `w ≥ 0` from source `s`, then upon termination `d[v] = δ(s, v)` for all `v ∈ V`.

The theorem follows from a loop invariant on the `EXTRACT-MIN` step.

**Lemma 2.2 (Settling lemma).** Each time a vertex `u` is extracted from `Q` (added to `S`), `d[u] = δ(s, u)`.

**Proof.** By contradiction. Let `u` be the **first** vertex extracted with `d[u] > δ(s, u)`. Note `u ≠ s` (since `d[s] = 0 = δ(s,s)`, and `s` is extracted first). Because `d[u] > δ(s,u) ≥ 0`, there exists a real shortest path `p` from `s` to `u`, and `δ(s,u) < ∞`, so `p` exists.

Consider the moment just before `u` is extracted. Path `p` starts in `S` (it contains `s ∈ S`) and ends at `u ∉ S`. Let `y` be the **first** vertex on `p` that is *not* in `S`, and let `x ∈ S` be its predecessor on `p` (`x` may equal `s`). Split `p` as `s ⇝ x → y ⇝ u`.

We make three observations.

1. **`x` is correctly settled:** `x` was extracted before `u`, and `u` is the *first* mis-settled vertex, so `d[x] = δ(s, x)`.

2. **`y` is correctly relaxed:** when `x` was added to `S`, edge `(x, y)` was relaxed, so
   ```text
   d[y] ≤ d[x] + w(x, y) = δ(s, x) + w(x, y) = δ(s, y),
   ```
   the last equality because `p` is a shortest path and its prefix `s ⇝ x → y` is a shortest path to `y` (a subpath of a shortest path is shortest). Combined with `d[y] ≥ δ(s, y)` (Prop. 1.4), we get `d[y] = δ(s, y)`.

3. **`y` is no farther than `u`:** since `y` precedes `u` on a non-negative-weight path,
   ```text
   δ(s, y) ≤ δ(s, u)         (the subpath s ⇝ y is no longer than s ⇝ u, as w ≥ 0).
   ```

Now both `u` and `y` are in `Q` at the extraction moment, and `u` was chosen as the minimum, so `d[u] ≤ d[y]`. Chaining everything:
```text
d[u] ≤ d[y] = δ(s, y) ≤ δ(s, u).
```
But combined with the assumption `d[u] > δ(s, u)` and `d[u] ≥ δ(s,u)`, this forces `d[u] ≤ δ(s,u) ≤ d[u]`, i.e. `d[u] = δ(s,u)` — contradicting `d[u] > δ(s,u)`. ∎

**Where non-negativity is essential.** Step 3 — `δ(s, y) ≤ δ(s, u)` because the prefix of a path is no longer than the whole — uses `w ≥ 0` directly. With a negative edge later on path `p`, the prefix to `y` could be *longer* than the full path to `u`, so a vertex with a larger tentative distance might still lie on the true shortest path. The greedy "extract the min and freeze it" decision becomes invalid; that is exactly why Dijkstra fails on negative edges and Bellman-Ford (which never freezes) is required.

**Corollary 2.3 (Monotone extraction).** The sequence of `d`-values at extraction time is non-decreasing. *Proof.* Each extracted `u` has `d[u] = δ(s,u)`; any vertex relaxed afterward through `u` gets `d ≥ d[u]` (non-negative edges). Hence later extractions cannot have smaller keys. ∎ This corollary justifies the **lazy stale-skip**: once a vertex is extracted at its final value, any later heap entry for it has a key `≥` that value and is safely skipped.

---

## 3. Complexity by Priority-Queue Choice

Each vertex is `EXTRACT-MIN`-ed once (`V` extractions). Each edge triggers at most one `DECREASE-KEY` / `INSERT` (`E` operations). The total time is

```text
T = V · T_extract + E · T_decrease  (+ V · T_insert).
```

| Priority queue | INSERT | EXTRACT-MIN | DECREASE-KEY | Total | Best regime |
| --- | --- | --- | --- | --- | --- |
| Array / linear scan | O(1) | O(V) | O(1) | **O(V² + E) = O(V²)** | dense (`E = Θ(V²)`) |
| Binary heap | O(log V) | O(log V) | O(log V) | **O((V + E) log V)** | sparse (`E = O(V)`) |
| d-ary heap | O(log_d V) | O(d · log_d V) | O(log_d V) | O(V·d·log_d V + E·log_d V) | tune `d ≈ E/V` |
| Fibonacci heap | O(1) am. | O(log V) am. | O(1) am. | **O(E + V log V)** | dense, theory |
| Binomial heap | O(1) am. | O(log V) | O(log V) | O((V + E) log V) | — |

**d-ary optimum.** Minimizing `V·d·log_d V + E·log_d V` over `d` gives `d ≈ max(2, E/V)`. For `E = Θ(V^{1+ε})` this yields `O(E · log_{E/V} V) = O(E / ε)`, linear when the graph is even moderately dense. This is why tuned 4-ary heaps win on road-network-density graphs.

**Fibonacci optimum.** With `O(1)` amortized `DECREASE-KEY` and `O(log V)` amortized `EXTRACT-MIN`, the `E` decrease-keys cost `O(E)` and the `V` extractions cost `O(V log V)`, giving the celebrated `O(E + V log V)` bound (Fredman & Tarjan 1987). For `E = ω(V)` this beats the binary heap's `O(E log V)`. In practice the large constants and pointer-chasing (see Section 6) usually negate the advantage for `V < 10^6`. See topic *10-heaps/03-fibonacci-heap*.

**Why both `log V` and `log E` appear.** Some texts write `O(E log V)`, others `O(E log E)`. Since the graph is simple, `E ≤ V²`, so `log E ≤ 2 log V`; the two bounds are equal up to a constant. The lazy heap holds up to `E` entries, so `O(E log E) = O(E log V)`.

---

## 4. Δ-Stepping and Parallel Bounds

**Definition 4.1 (Δ-stepping, Meyer & Sanders 2003).** Partition tentative distances into buckets `B_i = [iΔ, (i+1)Δ)`. Process buckets in order; within a bucket, relax all **light** edges (`w ≤ Δ`) in parallel, re-inserting any vertex pulled back into the current bucket, until the bucket is stable; then relax **heavy** edges (`w > Δ`).

**Theorem 4.2 (Sequential work).** Δ-stepping performs `O(V + E + (light-edge reinsertions))` relaxations. For random edge weights uniform in `[0,1]` with maximum degree `d` and shortest-path weight `L`, the expected work is `O(V + E + d·L/Δ)` and the expected number of phases is `O((L/Δ) · log(V) / log log V)`.

**Theorem 4.3 (Parallel bound).** On a PRAM, with `Δ = Θ(1/d)`, Δ-stepping runs in `O(d · L · log V)` expected span (parallel depth) and `O(V + E)` expected work for graphs with random weights and bounded degree.

**Limiting cases.**
- `Δ → 0` collapses to Dijkstra: each bucket holds the single minimum-key vertex; minimal redundant work, no parallelism (span `Θ(V)`).
- `Δ → ∞` collapses to Bellman-Ford: one giant bucket; maximal parallelism, up to `O(VE)` work.

`Δ` is the knob trading the `Ω(V)` sequential depth of Dijkstra against the `O(VE)` work of Bellman-Ford. No work-efficient, polylog-depth SSSP for *arbitrary* non-negative weights was known until recent advances (Section 10).

---

## 5. Lower Bounds and Optimality of Comparison-Based SSSP

**Theorem 5.1 (Sorting lower bound).** Any comparison-based SSSP algorithm that outputs vertices in order of distance must perform `Ω(V log V)` comparisons in the worst case.

**Proof sketch.** Build a star: source `s` with edges `s → v_i` of weight `a_i`. The distances are exactly the `a_i`, and emitting them in settled order sorts the `a_i`. Sorting `V` numbers needs `Ω(V log V)` comparisons in the comparison model. Since Dijkstra extracts vertices in non-decreasing distance order (Corollary 2.3), it sorts, hence `Ω(V log V)`. ∎

This makes the Fibonacci-heap bound `O(E + V log V)` **optimal** among comparison-based algorithms that produce a sorted distance order, when `E = O(V log V)`. The `V log V` term is unavoidable *if* you insist on extracting in sorted order.

**Escaping the bound.** The `Ω(V log V)` barrier applies only to comparison-based, sorted-order algorithms.
- **Integer weights** in `[0, C]`: Thorup's algorithm (1999) solves *undirected* SSSP in `O(V + E)` time on the word RAM, using a hierarchical bucketing (component tree) that avoids sorting. This breaks the comparison lower bound by exploiting the integer structure of the keys.
- **Bounded weights:** Dial's algorithm uses `C+1` buckets for integer weights in `[0, C]`, giving `O(E + V·C)` — linear when `C` is small.
- Radix-heap and related structures give `O(E + V log C)` for integer weights.

So the lower bound is a statement about a *model*, not about shortest paths intrinsically.

---

## 6. Cache Behavior

Dijkstra's inner loop has three memory-access patterns, all hostile to caches on large graphs:

1. **Heap operations** touch a `Θ(log V)`-length root-to-leaf path; for `V > L2/entry_size` each level is a cache miss — `Θ(log(V/B))` misses per heap op (`B` = cache-line keys).
2. **Adjacency traversal** (`for (u,v) in E`) is sequential *within* a vertex's edge list (cache-friendly with CSR layout) but jumps between vertices.
3. **`d[v]` updates** are random access into a `Θ(V)` array — essentially one cache miss per relaxation once `V` exceeds cache.

**Proposition 6.1.** On a graph that does not fit in cache, the dominant cost is `Θ(E)` random `d[]` accesses plus `Θ((V+E) log(V/B))` heap-path misses — memory-bandwidth bound, not comparison bound.

**Mitigations.**
- **CSR (compressed sparse row)** layout for edges: contiguous edge lists, one base+offset per vertex.
- **d-ary heaps** with `d` sized to a cache line pack more children per miss.
- **Dirty-list reset** of `d[]` between queries: only restore the `O(settled)` touched entries instead of re-zeroing `Θ(V)` — turns per-query overhead from `Θ(V)` to `Θ(settled)`.
- **Cache-oblivious / external-memory** SSSP (Meyer-Zeh) for graphs exceeding RAM, achieving `O((V + E/B) · log(V/B))` I/Os.

The Fibonacci heap, despite its superior asymptotics, has the *worst* cache behavior (many small pointer-linked nodes), which is the main reason it loses to binary/4-ary heaps in benchmarks (Cherkassky-Goldberg-Radzik 1996).

---

## 7. Average-Case Analysis

**Theorem 7.1 (Expected heap size, lazy variant).** On a graph with random non-negative weights, the expected number of `DECREASE-KEY`-equivalent re-insertions per vertex is `O(log V)` for many natural random-graph models, so the lazy heap's expected size is `O(V log V) ⊆ O(E)` and the expected running time matches the `O((V+E) log V)` worst case up to constants.

**Theorem 7.2 (Random-edge-weight relaxations).** For the `G(n, p)` random graph with i.i.d. `Uniform[0,1]` edge weights, the expected number of edges that *successfully* relax (lower some `d[v]`) is `O(V log V)`, not `O(E)`: most edges are examined but do not improve any distance. This is why real Dijkstra often runs much faster than the worst-case bound — the inner `if nd < d[v]` usually fails.

**Hidden-paths model.** Under the "hidden paths" or "endpoint-independent" weight model (Karger-Koller-Phillips, Spira), all-pairs shortest paths via repeated Dijkstra runs in `O(V² log V)` expected time, beating the `O(V³)` of Floyd-Warshall, because the expected number of relaxations per source is `O(V log V)`.

---

## 8. Space-Time Trade-offs

| Representation / variant | Time | Extra space | Note |
| --- | --- | --- | --- |
| Lazy binary heap | O((V+E) log V) | O(E) heap entries | simplest, default |
| Eager indexed heap | O((V+E) log V) | O(V) heap + O(V) index | smaller heap, more bookkeeping |
| Array scan | O(V²) | O(V) | no heap; dense graphs |
| Fibonacci heap | O(E + V log V) | O(V) nodes, ~6 ptrs each | best asymptotics, worst constants |
| Dial's buckets (int `≤ C`) | O(E + VC) | O(C) buckets | great for small integer weights |
| Radix heap (int) | O(E + V log C) | O(log C) buckets | bridges Dial and binary heap |
| + predecessor array | +O(V) space | O(V) | path reconstruction |
| Bidirectional | ~½ explored | 2× distance/queue arrays | point-to-point only |

The predecessor array costs `O(V)` space and `O(1)` per relaxation, turning distance-only Dijkstra into a full shortest-path-tree computation; reconstruction is `O(path length)`. Storing *all* shortest-path predecessors (for counting/enumerating shortest paths) costs `O(E)` in the worst case.

---

## 9. Comparison with Alternatives

| Algorithm | Weights | Time | Space | Detects neg. cycle | Notes |
| --- | --- | --- | --- | --- | --- |
| Dijkstra (binary heap) | `≥ 0` | O((V+E) log V) | O(V+E) | n/a | SSSP, the default |
| Dijkstra (Fibonacci) | `≥ 0` | O(E + V log V) | O(V+E) | n/a | optimal comparison bound |
| Bellman-Ford | any | O(V·E) | O(V) | yes | SSSP with negatives |
| SPFA (queue BF) | any | O(V·E) worst, fast avg | O(V) | yes | heuristic Bellman-Ford |
| Dial's | int `[0,C]` | O(E + VC) | O(VC) | n/a | small integer weights |
| Thorup | int, undirected | O(V + E) | O(V+E) | n/a | breaks comparison bound |
| 0-1 BFS | `{0,1}` | O(V + E) | O(V) | n/a | deque, no heap |
| BFS | unit | O(V + E) | O(V) | n/a | Dijkstra's special case |
| Floyd-Warshall | any | O(V³) | O(V²) | yes | all-pairs, dense |
| Johnson | any | O(V·E + V² log V) | O(V²) | yes | all-pairs, sparse, reweighting |
| A* (admissible h) | `≥ 0` | O((V+E) log V) worst | O(V+E) | n/a | goal-directed; `h=0` ⇒ Dijkstra |

The relationships worth memorizing: **BFS ⊂ 0-1 BFS ⊂ Dijkstra ⊂ A\*** (each generalizes the prior by relaxing the edge-weight or adding a heuristic), and **Dijkstra ⊂ Bellman-Ford** in capability but not in speed (BF handles negatives at the cost of `O(VE)`).

---

## 10. Open Problems and Recent Results

1. **Near-linear undirected SSSP with real weights.** Thorup (1999) achieved `O(V + E)` for *integer* undirected SSSP. Extending optimal linear-time results to general *real* weights and especially to *directed* graphs has been a long-standing target.

2. **Breaking the sorting barrier for directed real-weight SSSP (2025).** Duan, Mao, Mao, Shu, and Yin's result *"Breaking the Sorting Barrier for Directed Single-Source Shortest Paths"* gives a deterministic `O(E · log^{2/3} V)`-time algorithm for directed graphs with real non-negative weights in the comparison-addition model — asymptotically faster than Dijkstra's `O(E + V log V)` for sparse graphs. It sidesteps the `Ω(V log V)` sorting lower bound by *not* extracting vertices in fully sorted order, instead combining Bellman-Ford-style relaxation with a recursive frontier-shrinking technique. This is a genuine theoretical breakthrough on a 65-year-old problem; constants and practicality are still being explored.

3. **Parallel work-efficient SSSP.** Achieving `O(E)` work and polylog depth for arbitrary non-negative weights (closing the Δ-stepping work/depth gap) remains an active area, with recent progress on approximate and exact variants.

4. **Dynamic SSSP.** Maintaining shortest paths under edge insertions/deletions with sublinear update time, especially against an adaptive adversary, is open in several regimes.

5. **Optimality of CH / hub labeling.** Tight bounds on the label size achievable for hub labeling on road networks (related to highway dimension) connect Dijkstra-based preprocessing to structural graph parameters and are not fully resolved.

---

## 11. Summary

- **Definition & correctness.** Dijkstra greedily extracts the minimum-tentative vertex and freezes it. The settled-vertex invariant — proven by an exchange argument — holds **exactly because** every path prefix is no longer than the whole path, which requires `w ≥ 0`. Negative edges break the prefix-monotonicity step and the whole proof.
- **Complexity.** `O(V²)` with an array (dense), `O((V+E) log V)` with a binary/d-ary heap (sparse, the default), `O(E + V log V)` with a Fibonacci heap (optimal in the comparison model, poor constants).
- **Lower bound.** Sorted-order, comparison-based SSSP needs `Ω(V log V)`; integer-weight models (Thorup, Dial, radix heaps) escape it.
- **Parallel.** Δ-stepping interpolates between Dijkstra (`Δ→0`) and Bellman-Ford (`Δ→∞`); `Δ` trades depth for work.
- **Cache.** At scale the algorithm is memory-bandwidth bound; CSR layout, d-ary heaps, and dirty-list resets matter more than asymptotics.
- **Frontier.** The 2025 directed-real-weight `O(E log^{2/3} V)` result finally beats Dijkstra asymptotically on sparse graphs by abandoning strict sorted extraction.

Dijkstra (1959) gave the algorithm; Fredman & Tarjan (1987) gave the Fibonacci-heap bound; Thorup (1999) gave linear-time integer undirected SSSP; Meyer & Sanders (2003) gave Δ-stepping; CLRS Ch. 24 remains the canonical pedagogical treatment. A 65-year-old greedy algorithm whose optimal asymptotics were only recently improved — a rare longevity in algorithm design.
