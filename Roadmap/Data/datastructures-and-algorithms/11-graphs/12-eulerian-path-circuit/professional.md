# Eulerian Path & Circuit — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Euler's Theorem — Necessity and Sufficiency (Undirected)
3. The Directed Analogue
4. Hierholzer's Algorithm — Correctness and O(E) Proof
5. The BEST Theorem — Counting Eulerian Circuits
6. Cache Behavior and Memory Layout
7. Average-Case and Randomized Aspects
8. Space–Time Trade-offs
9. Comparison: Eulerian (P) vs Hamiltonian (NP-complete)
10. Open Problems and Research Directions
11. Summary

---

## 1. Formal Definitions

Let `G = (V, E)` be a graph, possibly a multigraph (parallel edges allowed) and possibly with self-loops. We treat `E` as a multiset.

**Definition 1.1 (Walk, trail, closed walk).** A *walk* is an alternating sequence `v₀ e₁ v₁ e₂ … eₘ vₘ` where edge `eᵢ` joins `vᵢ₋₁` and `vᵢ`. A *trail* is a walk in which no edge repeats (vertices may repeat). A walk is *closed* if `v₀ = vₘ`.

**Definition 1.2 (Eulerian trail / circuit).** An *Eulerian trail* is a trail that uses every edge of `G` exactly once. An *Eulerian circuit* (or *Eulerian tour*) is a closed Eulerian trail. `G` is *Eulerian* if it has an Eulerian circuit, and *semi-Eulerian* if it has an Eulerian trail but no Eulerian circuit.

**Definition 1.3 (Degree).** For undirected `G`, `deg(v)` is the number of edge-endpoints incident to `v`; a self-loop at `v` contributes `2`. For directed `G`, `out(v)` and `in(v)` count arcs leaving and entering `v`; a directed self-loop contributes `1` to each.

**Definition 1.4 (Connected for Euler).** Let `V⁺ = { v : v has at least one incident edge }`. We say `G` is *connected for Euler purposes* if the subgraph induced by `V⁺` is connected (undirected) or strongly connected (directed). Isolated vertices in `V \ V⁺` are irrelevant.

**Proposition 1.5 (Handshake lemma).** `Σ_{v∈V} deg(v) = 2|E|`. Consequently the number of odd-degree vertices is even. In the directed case `Σ out(v) = Σ in(v) = |E|`, so `Σ (out(v) − in(v)) = 0`.

---

## 2. Euler's Theorem — Necessity and Sufficiency (Undirected)

**Theorem 2.1 (Euler 1736; Hierholzer 1873).** Let `G` be connected for Euler purposes. Then:
1. `G` has an Eulerian **circuit** iff every vertex has even degree.
2. `G` has an Eulerian **trail** (open) iff exactly two vertices have odd degree; the trail's endpoints are precisely those two vertices.

### 2.1 Necessity (circuit)

Suppose `C` is an Eulerian circuit. Fix a vertex `v` and traverse `C`. Each maximal visit to `v` enters along one edge and leaves along another, consuming two distinct incident edges. Because `C` is closed and uses every incident edge of `v` exactly once, the incident edges of `v` partition perfectly into such in/out pairs. Hence `deg(v)` is even. (A self-loop at `v` is traversed as a single edge contributing `2` to the degree and `2` to the count consumed — consistent.) ∎

### 2.2 Necessity (open trail)

Suppose `T` is an open Eulerian trail from `s` to `t`, `s ≠ t`. For any internal vertex `v ∉ {s, t}`, the same pairing argument gives even degree. At `s`, the first edge departs without a prior arrival, so `s`'s edges pair up except one — `deg(s)` is odd. Symmetrically `deg(t)` is odd. No other vertex can be odd. ∎

### 2.3 Sufficiency (circuit) — constructive

Assume `G` connected for Euler and all degrees even. We prove an Eulerian circuit exists by induction on `|E|`, mirroring Hierholzer.

**Base.** `|E| = 0`: the empty closed walk at any vertex is vacuously Eulerian.

**Inductive step.** Pick any vertex `v₀` with an incident edge. Greedily extend a trail from `v₀`, never reusing an edge. **Claim:** this trail can only terminate at `v₀`. Indeed, whenever the trail enters a vertex `u ≠ v₀`, it has used an odd number of `u`'s edges (one to enter, plus an even number from prior complete passes), and since `deg(u)` is even, an unused edge remains to leave by. So the trail cannot stick at `u ≠ v₀`; it terminates only when it returns to `v₀` with no unused incident edge there — producing a closed trail (cycle) `C`.

Delete `C`'s edges from `G` to get `G'`. Every vertex's degree dropped by an even amount (edges removed in in/out pairs along `C`), so `G'` is still even. By induction each connected component of `G'` (restricted to its edge-bearing vertices) has an Eulerian circuit. By the connectivity of `G`, each nonempty component of `G'` shares at least one vertex with `C`. Splice each component's circuit into `C` at a shared vertex. The result is a single closed trail using every edge of `G` — an Eulerian circuit. ∎

### 2.4 Sufficiency (open trail)

Given exactly two odd vertices `s, t`, add an auxiliary edge `{s, t}`. Now all degrees are even and the graph is still connected, so by 2.3 it has an Eulerian circuit. Remove the auxiliary edge from the circuit; the circuit opens into an Eulerian trail from `s` to `t`. ∎

This auxiliary-edge reduction is why path-finding code can simply start Hierholzer at an odd vertex.

---

## 3. The Directed Analogue

**Theorem 3.1.** Let directed `G` be connected for Euler purposes (the edge-bearing vertices are strongly connected). Then:
1. `G` has an Eulerian **circuit** iff `in(v) = out(v)` for every vertex.
2. `G` has an Eulerian **trail** iff exactly one vertex `s` has `out(s) − in(s) = 1`, exactly one vertex `t` has `in(t) − out(t) = 1`, and every other vertex satisfies `in = out`; the trail runs from `s` to `t`.

**Proof of necessity.** Traverse an Eulerian circuit; each pass through `v` uses one in-arc and one out-arc, so the arcs at `v` pair into in/out couples and `in(v) = out(v)`. For an open trail, the start contributes an unmatched out-arc and the end an unmatched in-arc, giving the `±1` imbalances. ∎

**Proof of sufficiency.** Identical to the undirected constructive argument, with "leave by an unused edge" replaced by "leave by an unused out-arc." Balance `in(v) = out(v)` guarantees that on entering `v ≠ start` you always have an unused out-arc, so the greedy walk closes at the start; splicing assembles the full circuit. For the open trail, add an auxiliary arc `t → s` to balance, find a circuit, and delete the auxiliary arc. ∎

**Remark 3.2 (connectivity subtlety).** For the *circuit*, balance `in = out` everywhere plus *weak* connectivity of the edge-bearing vertices already implies *strong* connectivity, so a weak-connectivity check suffices in the balanced case. For the *open trail* one must be more careful; checking reachability from `s` and co-reachability to `t` is the safe formulation.

---

## 4. Hierholzer's Algorithm — Correctness and O(E) Proof

### 4.1 Pseudocode (iterative)

```text
HIERHOLZER(G, start):
  for all v: iter[v] := 0            # pointer into adj[v]
  stack := [start]; trail := []
  while stack not empty:
    v := stack.top()
    if iter[v] < deg_out(v):
      w := adj[v][ iter[v] ]; iter[v] += 1
      stack.push(w)                  # descend along an unused edge
    else:
      trail.append( stack.pop() )    # back out; record on the way up
  reverse(trail)
  return trail
```

(For undirected graphs, replace "unused edge" with an edge whose shared `used[edge_id]` flag is false, set on traversal.)

### 4.2 Correctness

**Invariant.** At all times the contents of `stack` (bottom to top) form a *trail* in `G` of currently-claimed edges, and `iter[v]` records exactly which of `v`'s edges have ever been claimed.

**Lemma 4.1 (every claimed edge appears once in the output).** Each edge is claimed at most once: an edge is claimed only when `iter[v]` advances past it, and `iter[v]` is monotincreasing. When a vertex is popped, the suffix of the trail beyond it is already finalized. A standard argument (induction on pops) shows the reversed `trail` lists vertices so that consecutive pairs correspond exactly to the claimed edges, each exactly once.

**Lemma 4.2 (closure for balanced graphs).** If the graph satisfies the degree/balance + connectivity conditions, then when the algorithm terminates `stack` is empty and `|trail| = |E| + 1`. *Sketch:* Whenever the top vertex `v ≠ start` has been entered, balance guarantees an unclaimed out-edge, so `v` is not popped until all its out-edges are claimed; connectivity guarantees no edge is stranded. The pop order produces the splices implicitly: when descent dead-ends and we pop back to a vertex with remaining edges, the subsequent descent is exactly the spliced sub-cycle. Hence all `|E|` edges are claimed and the trail has `|E| + 1` vertices.

**Theorem 4.3 (correctness).** `HIERHOLZER` returns an Eulerian trail iff the conditions of Theorems 2.1 / 3.1 hold and `start` is a valid start vertex; otherwise `|trail| ≠ |E| + 1`, which the caller checks to reject. ∎

### 4.3 Complexity

**Theorem 4.4.** `HIERHOLZER` runs in `Θ(V + E)` time and `Θ(V + E)` space.

**Proof.** Building adjacency and degree arrays is `Θ(V + E)`. In the main loop, every iteration either advances some `iter[v]` (a *push*) or pops a vertex. There are at most `|E|` pushes total, because `iter[v]` advances at most `deg_out(v)` times and `Σ deg_out(v) = |E|`. The number of pops equals the number of pushes plus one (for `start`), so at most `|E| + 1`. Each push/pop is `O(1)` (amortized for dynamic arrays). Thus the loop is `Θ(E)`, and total is `Θ(V + E)`. The stack and trail hold at most `|E| + 1` entries: `Θ(V + E)` space. The reversal is `Θ(E)`. ∎

The constant is tiny — essentially one comparison, one pointer bump, and one array append per edge. This linearity is what cleanly separates Eulerian construction from the exponential Hamiltonian search (§9).

---

## 5. The BEST Theorem — Counting Eulerian Circuits

Deciding existence and building *one* circuit is easy. **Counting** Eulerian circuits is a striking case where directed and undirected diverge sharply.

**Theorem 5.1 (BEST theorem — de Bruijn, van Aardenne-Ehrenfest, Smith, Tutte).** Let `G` be a connected directed graph with `in(v) = out(v)` for all `v`. The number of Eulerian circuits is

```
ec(G) = tw(G) · Π_{v ∈ V} ( out(v) − 1 )!
```

where `tw(G)` is the number of **arborescences** (directed spanning trees) rooted at any fixed vertex `w`. The count `tw(G)` is independent of the chosen root `w` for an Eulerian digraph, and is computable as a cofactor of the **Laplacian** of `G` via the **Matrix-Tree Theorem** (a determinant). Hence the number of Eulerian circuits in a directed graph is computable in **polynomial time** (`O(V³)` for the determinant).

This is remarkable: for *directed* graphs, counting Euler tours — a #P-flavored task in general — collapses to a determinant. See sibling topic *24-kirchhoff-theorem* for the Matrix-Tree Theorem.

**Contrast (undirected).** Counting Eulerian circuits of an *undirected* graph is **#P-complete** (Brightwell & Winkler, 2005). The clean BEST formula has no undirected analogue. So directedness, which barely changes the *existence* test, completely changes the *counting* complexity.

**Corollary 5.2.** The number of de Bruijn sequences `B(k, n)` equals `(k!)^{k^{n-1}} / k^{n}` — derivable by applying BEST to the de Bruijn graph, whose arborescence count and out-degrees are uniform.

---

## 6. Cache Behavior and Memory Layout

Hierholzer's access pattern is determined by the graph, not the algorithm, so locality depends entirely on adjacency layout.

- **CSR (compressed sparse row) adjacency** — store all neighbors in one contiguous array with per-vertex offset boundaries. The `iter[v]` pointer then walks a contiguous block, giving sequential reads within a vertex's edges. This is the cache-optimal layout and the standard for large graphs.
- **Pointer-chased adjacency** (linked lists of edge structs) — poor locality; every edge hop is a potential cache miss. Avoid.
- **The stack and trail** are append-only contiguous arrays — cache-friendly.
- **`used[edge_id]`** (undirected) is a random-access bit/byte array; for graphs exceeding cache it incurs a miss per edge, but only once per edge.

**Proposition 6.1.** With CSR layout the cache-miss count is `Θ(E / B + V)` for cache-line size `B` words, because each edge is read once in near-sequential order. The `used[]` random accesses add at most `Θ(E)` misses in the worst case but typically far fewer due to spatial reuse.

For external-memory (graph exceeds RAM), the relevant model is I/O complexity; a well-ordered CSR on disk yields `Θ(E / B)` I/Os for the edge scan, near-optimal.

---

## 7. Average-Case and Randomized Aspects

### 7.1 Cost is input-shape-independent

Unlike comparison sorting or quicksort, Hierholzer performs *exactly* `|E|` edge-claims and `|E| + 1` pops regardless of input distribution. There is no "lucky" or "unlucky" input for the running time — it is `Θ(E)` deterministically. The only variation is in the *output trail*, which depends on adjacency order.

### 7.2 Random Eulerian circuits

Sampling a *uniformly random* Eulerian circuit is more subtle. One method: sample a uniformly random arborescence (via Wilson's algorithm / loop-erased random walks, polynomial time), then apply the BEST-theorem bijection between (arborescence, local out-edge orderings) pairs and Eulerian circuits. This gives an exact uniform sampler for *directed* Eulerian circuits in polynomial time — another payoff of the BEST structure. No comparably clean uniform sampler is known for undirected Eulerian circuits, consistent with the #P-completeness of counting them.

### 7.3 Random de Bruijn-like graphs

For random regular digraphs satisfying balance, an Eulerian circuit almost surely exists once the graph is connected, and Hierholzer finds it in linear time; the interesting randomness is in the *number* of circuits (BEST), which concentrates around the `Π (out−1)!` factor scaled by the arborescence count.

---

## 8. Space–Time Trade-offs

| Representation | Existence test | Construct | Space | Notes |
|---|---|---|---|---|
| CSR adjacency + `iter[]` | `Θ(V+E)` | `Θ(V+E)` | `Θ(V+E)` | The standard; cache-optimal. |
| Linked-list adjacency w/ edge deletion | `Θ(V+E)` | `Θ(V+E)` | `Θ(V+E)` | `used[]` replaced by physical unlink; avoids the flag array but worse locality. |
| Recursive Hierholzer | `Θ(V+E)` | `Θ(V+E)` time | `Θ(E)` **stack** | Stack depth `O(E)` → overflow risk; same asymptotics, worse constants and safety. |
| Out-of-core CSR | `Θ(V+E)` I/O | `Θ(E/B)` I/O | `Θ(V)` RAM | For graphs beyond memory. |
| Fleury (bridge-avoiding) | — | `Θ(E·(V+E))` = `O(E²)` | `Θ(V+E)` | Each step recomputes bridges; never competitive. |

The dominant trade-off is **iterative vs recursive**: same `Θ(V+E)` asymptotics, but recursion risks `O(E)`-deep stack overflow. The other is **flag array vs physical edge deletion**: deletion frees you from `used[]` but hurts locality.

---

## 9. Comparison: Eulerian (P) vs Hamiltonian (NP-complete)

| | Eulerian circuit | Hamiltonian circuit |
|--|------------------|---------------------|
| Object covered once | each **edge** | each **vertex** |
| Existence | `Θ(V + E)` (degree/balance + connectivity) | **NP-complete** (Karp 1972) |
| Construction | `Θ(V + E)` (Hierholzer) | NP-hard; no poly algorithm known |
| Characterization | local degree condition (Theorem 2.1/3.1) | no known efficient characterization |
| Counting | directed: poly (BEST, §5); undirected: #P-complete | #P-complete |
| Optimization variant | Chinese Postman (poly via matching) | Travelling Salesman (NP-hard) |

**Why the asymmetry?** Eulerian existence has a *local certificate*: a vertex-by-vertex degree check (plus global connectivity) is necessary and sufficient. Hamiltonicity has **no known local certificate** — knowing each vertex's degree tells you almost nothing about whether a vertex-covering cycle exists. The matching-based duplication that makes Chinese Postman polynomial has no analogue that tames TSP. This single distinction — edges vs vertices — is among the cleanest illustrations of the P vs NP boundary in graph theory. The genome-assembly history (§ middle.md) is the practical embodiment: reframing assembly from a Hamiltonian path on an overlap graph to an Eulerian path on a de Bruijn graph moved it from intractable to linear-time. See *28-np-hard-tsp-hamiltonian*.

---

## 10. Open Problems and Research Directions

1. **Approximate counting of undirected Eulerian circuits.** Exact counting is #P-complete; whether there is an FPRAS (fully polynomial randomized approximation scheme) for all undirected graphs remains open, with positive results only for special classes.

2. **Uniform sampling (undirected).** A clean polynomial-time uniform sampler for undirected Eulerian circuits, paralleling the BEST-based directed sampler, is not known.

3. **Eulerian extension / Chinese Postman variants.** The *directed* and *mixed* (some edges directed, some not) Chinese Postman are harder: the mixed Chinese Postman problem is **NP-hard**, despite the undirected version being polynomial. Characterizing the boundary and finding good approximations is active.

4. **Dynamic Eulerian maintenance.** Maintaining an Eulerian trail under edge insertions/deletions in sublinear time per update (a dynamic-graph analogue of *30-online-bridges*) is largely open for general graphs.

5. **Parallel / distributed Euler tours.** Computing an Eulerian circuit in low-depth (NC) parallel models is subtle; the Euler-tour *technique* for trees is in NC, but constructing an Euler circuit of a general graph with optimal work and polylog depth is delicate.

6. **Counting in restricted models.** Faster-than-`O(V³)` arborescence counting (and hence BEST evaluation) for structured digraphs, leveraging fast matrix or determinant techniques.

---

## 11. Summary

- **Definitions.** An Eulerian trail uses every edge once; a circuit also closes. Self-loops count as degree 2 (undirected) or 1 in/1 out (directed); isolated vertices are ignored for connectivity.
- **Euler's theorem.** Undirected: circuit ⇔ all even; trail ⇔ exactly two odd. Both halves proven — necessity by the in/out pairing argument, sufficiency by Hierholzer's constructive cycle-splicing.
- **Directed analogue.** Replace parity with `in = out` balance (circuit) or a single `+1`/`−1` source/sink pair (trail), with (strong) connectivity of edge-bearing vertices.
- **Hierholzer.** Correct via the stack-trail invariant; runs in `Θ(V + E)` because total pushes equal `Σ out(v) = |E|`. The reject test is `|trail| = |E| + 1`.
- **BEST theorem.** Directed Eulerian circuits are *counted* in polynomial time as (arborescences) × `Π (out(v)−1)!`, a Matrix-Tree determinant; the undirected count is #P-complete — a sharp directed/undirected split.
- **Layout.** CSR adjacency gives cache-optimal `Θ(E/B + V)` misses; iterative beats recursive for stack safety at identical asymptotics.
- **P vs NP boundary.** Eulerian (edges) is in P with a local degree certificate; Hamiltonian (vertices) is NP-complete with none — the canonical "one word changes everything" example.

References: Euler (1736); Hierholzer (1873); van Aardenne-Ehrenfest & de Bruijn (1951) and Smith & Tutte (1941) for the BEST theorem; Brightwell & Winkler (2005) on #P-completeness of undirected counting; Karp (1972) for Hamiltonicity NP-completeness; Pevzner, Tang & Waterman (2001) for the assembly application; sibling topics *24-kirchhoff-theorem*, *28-np-hard-tsp-hamiltonian*.
