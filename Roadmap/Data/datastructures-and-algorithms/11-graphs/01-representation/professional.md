# Graph Representation — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Space Complexity — Proofs
3. Operation Complexity per Representation
4. Cache Behavior and Memory Layout
5. Lower Bounds for Adjacency Queries
6. Succinct and Compressed Graph Representations
7. Average vs Worst Case on Real Graphs
8. Space–Time Trade-offs
9. Comparison (asymptotics + constants)
10. Open Problems and Research Directions
11. Summary

---

## 1. Formal Definitions

**Definition 1.1 (Graph).** A graph is a pair `G = (V, E)` where `V` is a finite set of vertices, `|V| = n`, and `E ⊆ V × V` is a set (or multiset, for multigraphs) of edges, `|E| = m`. For an **undirected** graph, `E` is a set of unordered pairs `{u, v}`; for a **directed** graph (digraph), `E` is a set of ordered pairs `(u, v)`. A **weighted** graph adds a function `w : E → ℝ`.

Without loss of generality assume `V = {0, 1, …, n−1}` (relabel via a bijection if vertices carry other identities).

**Definition 1.2 (Adjacency matrix).** The adjacency matrix of `G` is `A ∈ {0,1}^{n×n}` (or `ℝ^{n×n}` for weighted) defined by
```
A[u][v] = 1   if (u, v) ∈ E,   else 0.
```
For undirected `G`, `A` is symmetric: `A = Aᵀ`. The matrix is a representation of the **characteristic function** of `E`: `A` *is* the indicator `𝟙_E : V × V → {0,1}` laid out as a table.

**Definition 1.3 (Adjacency list).** The adjacency-list representation is a function `Adj : V → Seq(V)` where `Adj(u)` is a sequence (list) containing exactly the out-neighbors `{v : (u, v) ∈ E}`, with multiplicity equal to edge multiplicity. Concretely it is an array of `n` sequences whose total length is `Σ_u |Adj(u)| = m` (directed) or `2m` (undirected, each edge stored at both endpoints).

**Definition 1.4 (Edge list).** The edge-list representation is a sequence `L ∈ Seq(V × V)` (or `Seq(V × V × ℝ)` weighted) containing each edge once. `|L| = m`.

**Definition 1.5 (CSR — Compressed Sparse Row).** CSR represents `Adj` with two arrays:
```
offset ∈ ℤ^{n+1},  offset[0] = 0,  offset[u+1] = offset[u] + |Adj(u)|
target ∈ V^{m'},   where m' = m (directed) or 2m (undirected)
```
such that `Adj(u) = target[offset[u] : offset[u+1]]`. CSR is precisely the **prefix-sum encoding** of the degree sequence together with the concatenation of all neighbor lists.

**Proposition 1.6 (Equivalence).** All four representations are information-theoretically equivalent for a fixed labelled graph: each can be reconstructed from any other. The matrix→list direction loses nothing for simple graphs but *cannot* encode parallel edges in `{0,1}` form (it requires a count matrix `A ∈ ℤ_{≥0}^{n×n}`).

---

## 2. Space Complexity — Proofs

**Theorem 2.1 (Matrix space).** The adjacency matrix uses `Θ(n²)` space, independent of `m`.

*Proof.* The matrix has exactly `n²` cells, each storing a fixed-width value (1 bit for unweighted, `w` bits for weighted). Total `n² · O(1) = Θ(n²)`. Crucially the bound does not depend on `m`: an empty graph and a complete graph both occupy `n²` cells. ∎

**Theorem 2.2 (List / CSR space).** The adjacency list and CSR use `Θ(n + m)` space (directed) or `Θ(n + 2m) = Θ(n + m)` (undirected).

*Proof.* The list stores `n` headers plus `Σ_u |Adj(u)|` neighbor entries. By the **handshake / degree-sum identity**,
```
Σ_{u∈V} outdeg(u) = m   (directed),       Σ_{u∈V} deg(u) = 2m   (undirected),
```
so the neighbor entries number `m` (or `2m`). Adding the `n` headers gives `Θ(n + m)`. CSR stores `n+1` offsets plus `m'` targets, also `Θ(n + m)`. ∎

**Corollary 2.3.** For sparse graphs (`m = O(n)`), list/CSR use `Θ(n)` space versus the matrix's `Θ(n²)` — a factor-`n` improvement. For dense graphs (`m = Θ(n²)`) all three are `Θ(n²)`, and the matrix's constant factor is the smallest (one bit per potential edge versus a word per actual edge).

**Theorem 2.4 (Edge-list space).** The edge list uses `Θ(m)` space and, notably, does *not* charge `Θ(n)` for isolated vertices — an edge list cannot represent an isolated vertex at all without a separate vertex count.

---

## 3. Operation Complexity per Representation

Let `d = deg(u)` (or `outdeg(u)`). The following table is exact, not merely asymptotic in spirit.

| Operation | Matrix | List | CSR | Edge list |
|---|---|---|---|---|
| `hasEdge(u, v)` | `Θ(1)` | `Θ(d)` | `Θ(d)`; `Θ(log d)` if sorted | `Θ(m)` |
| `neighbors(u)` (enumerate) | `Θ(n)` | `Θ(d)` | `Θ(d)` | `Θ(m)` |
| `addEdge(u, v)` | `Θ(1)` | `Θ(1)` amortized | `Θ(n + m)` rebuild | `Θ(1)` amortized |
| `removeEdge(u, v)` | `Θ(1)` | `Θ(d)` | `Θ(n + m)` rebuild | `Θ(m)` |
| `deg(u)` | `Θ(n)` (scan row) | `Θ(1)` (list length) | `Θ(1)` (`offset[u+1]−offset[u]`) | `Θ(m)` |
| iterate all edges | `Θ(n²)` | `Θ(n + m)` | `Θ(n + m)` | `Θ(m)` |

**Proof sketch for `hasEdge` on the matrix.** A single array index `A[u][v]` is `Θ(1)` under the RAM model with unit-cost array access. ∎

**Proof sketch for `neighbors` on the matrix.** To enumerate the neighbors of `u` you must inspect all `n` cells of row `u`, because the representation gives no information about *which* cells are nonzero without reading them. Hence `Θ(n)`, even when `d ≪ n`. This `Θ(n)` versus `Θ(d)` gap is the precise reason adjacency lists dominate sparse-graph traversal: a full traversal is `Θ(n²)` on a matrix but `Θ(n + m)` on a list. ∎

**On `deg(u)` in CSR being `Θ(1)`:** the prefix-sum structure gives degree as a single subtraction `offset[u+1] − offset[u]`. This is a genuine advantage of CSR over a plain matrix (which needs a `Θ(n)` row scan) and over a plain object list (which needs the stored length, also `Θ(1)`, but with object overhead).

---

## 4. Cache Behavior and Memory Layout

Asymptotics treat every memory access as unit cost; real performance is governed by the **external-memory / cache model** with block size `B` (cache line, ~64 bytes ≈ 16 `int32`).

**Adjacency matrix.** Iterating a row is sequential (`Θ(n/B)` cache misses per row, optimal for a row scan), but the matrix occupies `Θ(n²)` memory, so for large `n` it thrashes the cache and TLB. Column access (needed for in-neighbors of a row-major matrix) strides by `n` and incurs a miss per element — `Θ(n)` misses. Store both `A` and `Aᵀ` if you need both directions.

**Pointer-based adjacency list.** `Adj(u)` for different `u` live in scattered heap allocations. Walking all neighbor lists incurs `Θ(n + m/B)` misses in the best case but with terrible constants because each `Adj(u)` access is a fresh, likely-uncached allocation. Boxed element types (Java `Integer`) add a second indirection per element — a miss per edge.

**CSR.** `target[]` is one contiguous array; a full traversal reads it sequentially with `Θ(m/B)` misses — asymptotically the same as the list but with the *optimal constant*. `offset[]` is also sequential. This is why CSR is the representation of choice for cache-bound graph kernels (PageRank, BFS at scale).

**Theorem 4.1 (Locality of CSR scan).** A complete edge traversal over CSR incurs `⌈(n+1)/B⌉ + ⌈m'/B⌉` cache misses, which is information-theoretically optimal up to the additive offset term, since any representation must read `Θ(m)` words to enumerate `Θ(m)` edges and the reads are perfectly sequential.

**Vertex relabelling and locality.** Reordering vertex ids so that neighbors are numerically close (BFS order, Reverse Cuthill–McKee, or a space-filling curve for spatial graphs) increases the chance that `target[k]` and the subsequently dereferenced `offset[target[k]]` share a cache line. This is a constant-factor optimization that routinely yields 2–5× on real traversals — pure constants, invisible to Big-O, decisive in practice.

---

## 5. Lower Bounds for Adjacency Queries

**Theorem 5.1 (Adjacency-query trade-off).** Any data structure that answers `hasEdge(u, v)` in `O(1)` time on a general graph must use `Ω(n²)` bits in the worst case.

*Proof (counting).* There are `2^{\binom{n}{2}}` distinct simple undirected graphs on `n` labelled vertices. A structure that distinguishes all of them must have at least that many states, hence `≥ \binom{n}{2} = Ω(n²)` bits of memory. If `hasEdge` is `O(1)` for *arbitrary* `(u, v)` with no preprocessing of the query, the structure must already encode every potential edge's status — `Ω(n²)` bits. The adjacency matrix (one bit per pair, `\binom{n}{2}` bits undirected) is therefore **space-optimal among `O(1)`-query structures**. ∎

**Corollary 5.2.** You cannot simultaneously achieve `O(1)` `hasEdge` *and* `o(n²)` space for dense graphs. Sparse graphs evade this only because the *graph itself* carries `o(n²)` bits of information (`Θ(m log n)` to name the edges), so an adjacency list's `Θ(m log n)`-bit footprint is near the information-theoretic minimum — but it pays `Θ(d)` per `hasEdge`, not `O(1)`.

**Theorem 5.3 (Information-theoretic lower bound on storage).** Representing an arbitrary simple graph on `n` vertices requires `⌈log₂ 2^{\binom{n}{2}}⌉ = \binom{n}{2} = Θ(n²)` bits in the worst case (the dense regime). For graphs known to have `m` edges, the bound is `log₂ \binom{\binom{n}{2}}{m} = Θ(m log(n²/m))` bits, which an adjacency list approaches up to the `log n` per-id factor and which succinct structures (§6) approach to within `o(m)` lower-order terms.

---

## 6. Succinct and Compressed Graph Representations

A **succinct** data structure uses space equal to the information-theoretic lower bound plus a lower-order term, while still supporting fast queries.

### 6.1 Bit-packed adjacency matrix
For unweighted graphs, store `A` as a bitset: `n²` bits = `n²/8` bytes. Row operations become bitwise-OR/AND over `⌈n/64⌉` machine words, giving a `64×` constant-factor speedup for transitive closure and triangle counting (the classic `O(n³/w)` Floyd-Warshall / boolean-matrix-multiply trick).

### 6.2 CSR with gap + varint encoding
Sort each `Adj(u)` ascending, store first-differences (gaps), and encode gaps with a byte-aligned variable-length code (varint, or Elias-γ/δ). On web and social graphs, exploiting **locality** (neighbors have nearby ids) and **similarity** (adjacent vertices share neighbor sets) drops storage to `1–4 bits/edge`. The WebGraph framework (Boldi–Vigna) further uses **reference compression** (encode `Adj(u)` as a delta against `Adj(u−k)`), reaching `≈ 2–3 bits/edge` on web crawls.

### 6.3 Succinct planar and separable graphs
For graphs with an `O(√n)` separator (e.g. planar graphs), there exist representations using `O(n)` bits that support `O(1)`-time adjacency and neighbor queries — succinct in the strong sense (Blandford–Blelloch–Kash; Blelloch–Farzan). A planar graph on `n` vertices is encodable in `≈ 4n` bits (close to the `≈ 3.58n`-bit lower bound from counting planar graphs).

### 6.4 `k²`-tree
For very sparse graphs with clustered adjacency (web graphs), the **`k²`-tree** recursively partitions the adjacency matrix into `k²` submatrices, storing empty submatrices in `O(1)` and supporting both `hasEdge` and neighbor listing in `O(log_k n)` per result. It approaches the entropy of the matrix while still answering both forward and reverse adjacency.

---

## 7. Average vs Worst Case on Real Graphs

Worst-case bounds use `d ≤ n−1`, but real graphs are governed by their **degree distribution**.

**Power-law (scale-free) graphs.** Social and web graphs follow `P(deg = k) ∝ k^{−γ}` with `2 < γ < 3`. Consequences:

- Average degree `d̄ = 2m/n` is small (10–1000), so a *random* `neighbors(u)` is cheap.
- But the **maximum degree** is `Θ(n^{1/(γ−1)})` — a super-hub with degree in the millions. A `hasEdge(hub, v)` linear scan on the list is catastrophic; sort hub adjacency or keep a per-hub hash set.
- The degree-sum identity means hub neighbor lists hold a constant fraction of *all* edges; partitioning that puts a hub on one machine creates a hotspot (motivating vertex-cut partitioning).

**Random `G(n, p)` graphs.** Expected degree `np`; with high probability all degrees concentrate around `np` (Chernoff). Here matrix vs list is decided purely by `p`: list wins for `p = o(1)` (sparse), matrix's constant wins for `p = Θ(1)` (dense). The transition is around `m ≈ n` edges, i.e. `p ≈ 1/n`.

**Expected `hasEdge` cost.** On an adjacency list with degrees `{d_u}`, a uniformly random `hasEdge(u, ·)` costs `Θ(d_u)`; averaged over a uniform `u`, expected cost is `Θ(d̄) = Θ(m/n)`. For sparse graphs this is `Θ(1)` *on average* even though the worst case is `Θ(n)`.

---

## 8. Space–Time Trade-offs

The representations occupy distinct points on the space–query-time Pareto frontier:

| Structure | Space (bits) | `hasEdge` | `neighbors` | Pareto role |
|---|---|---|---|---|
| Bit matrix | `n²` | `O(1)` | `O(n)` | optimal-space `O(1)` query (dense) |
| Adjacency list | `Θ(m log n)` | `O(d)` | `O(d)` | near-optimal space (sparse), slow point query |
| Sorted CSR | `Θ(m log n)` | `O(log d)` | `O(d)` | adds binary-search point query at no asymptotic space cost |
| Hash-set per vertex | `Θ(m log n)` + const | `O(1)` exp. | `O(d)` | `O(1)` expected `hasEdge` and `O(d)` enumerate — the "best of both", at constant-factor space and randomization cost |
| Compressed CSR | `Θ(m · H)` (`H` = entropy, often `<4` bits) | `O(log d)` + decode | `O(d)` + decode | minimal space, decode-time penalty |
| `k²`-tree | near matrix-entropy | `O(log n)` | `O(log n)`/result | both directions, succinct |

**The fundamental tension (Theorem 5.1 restated):** `O(1)` worst-case `hasEdge` forces `Ω(n²)` space; escaping `Ω(n²)` forces either `ω(1)` query time (lists) or randomization (per-vertex hash sets give `O(1)` *expected*). There is no deterministic structure with `O(1)` worst-case `hasEdge` and `o(n²)` space for dense graphs.

---

## 9. Comparison (asymptotics + constants)

### 9.1 Asymptotic summary

| Representation | Space | `hasEdge` | `neighbors` | `addEdge` | all-edges |
|---|---|---|---|---|---|
| Adjacency matrix | `Θ(n²)` | `Θ(1)` | `Θ(n)` | `Θ(1)` | `Θ(n²)` |
| Adjacency list | `Θ(n+m)` | `Θ(d)` | `Θ(d)` | `O(1)` am. | `Θ(n+m)` |
| Sorted CSR | `Θ(n+m)` | `Θ(log d)` | `Θ(d)` | `Θ(n+m)` | `Θ(n+m)` |
| Edge list | `Θ(m)` | `Θ(m)` | `Θ(m)` | `O(1)` am. | `Θ(m)` |
| Bit matrix | `Θ(n²)` bits | `Θ(1)` | `Θ(n/w)` | `Θ(1)` | `Θ(n²/w)` |
| Compressed CSR | `Θ(m·H)` | `Θ(log d)`+dec | `Θ(d)`+dec | rebuild | `Θ(m)`+dec |

### 9.2 Concrete bytes-per-edge constants (32-bit ids, modern hardware)

```text
bit matrix         : n^2 / 8 bytes total          (≈ 0 if dense, huge if sparse)
weighted matrix    : 4 * n^2 bytes total
primitive CSR      : ~4 bytes / edge
primitive list     : ~4 bytes/edge + 24-48 B/vertex header + ~1.5x slack
boxed Java list    : ~16 bytes / edge (Integer boxing)
gap+varint CSR     : ~1-2 bytes / edge   (sorted neighbors, locality)
WebGraph (web)     : ~2-3 bits / edge
```

The 4×–32× spread between primitive CSR and boxed lists is invisible to asymptotic analysis yet decides whether a `4×10¹⁰`-edge graph fits in 160 GB or 640 GB.

---

## 10. Open Problems and Research Directions

1. **Dynamic succinct graphs.** Maintaining a near-entropy representation under edge insertions/deletions with `o(log n)` query and update remains open for general graphs; current dynamic structures pay polylog overhead.

2. **Optimal cache-oblivious traversal layout.** Finding a vertex ordering that minimizes cache misses for arbitrary traversals is related to minimum-bandwidth/minimum-linear-arrangement, both NP-hard; the gap between heuristics (RCM, BFS order) and the optimum is not well characterized.

3. **Worst-case `O(1)` `hasEdge` in `o(n²)` for sparse-but-not-planar graphs.** Per-vertex hashing gives `O(1)` *expected*; a deterministic `O(1)` worst-case structure in `O(m)` space for general sparse graphs is not known.

4. **Compression matching graph entropy with fast queries.** WebGraph achieves remarkable ratios empirically but a representation provably matching the graph's entropy `H` while supporting `O(1)` neighbor access is open for general (non-planar, non-separable) graphs.

5. **Distributed partitioning with provable cut guarantees.** Streaming/online vertex-cut partitioners with worst-case approximation guarantees on replication factor for adversarial power-law inputs remain an active area.

6. **GPU-friendly dynamic CSR.** Maintaining CSR (or a CSR variant) under batched updates on GPUs without full rebuild, while preserving coalesced memory access, is actively researched (e.g. Hornet, faimGraph).

---

## 11. Summary

- A graph `G=(V,E)` is the labelled object; matrix, list, edge-list, and CSR are four **information-equivalent** encodings of the same edge set, differing only in which operations are cheap.
- **Space:** matrix `Θ(n²)` (density-independent), list/CSR `Θ(n+m)`, edge list `Θ(m)`. The degree-sum identity (`Σ deg = 2m`) is the one fact behind the list/CSR space bound.
- **Queries:** the matrix alone gives `Θ(1)` `hasEdge` but pays `Θ(n)` to enumerate neighbors; lists and CSR pay `Θ(d)` for `hasEdge` but enumerate neighbors optimally in `Θ(d)`.
- **Lower bound:** `O(1)` worst-case `hasEdge` provably forces `Ω(n²)` bits (a counting argument over `2^{\binom{n}{2}}` graphs), so the matrix is space-optimal among constant-query structures, and you cannot have both `O(1)` query and `o(n²)` space deterministically on dense graphs.
- **Cache:** CSR achieves the optimal `Θ(m/B)` cache misses for a full scan; pointer lists and boxed elements ruin the constant; vertex relabelling recovers locality.
- **Compression:** succinct (`k²`-tree, planar separators) and entropy-coded (WebGraph, gap+varint) representations approach the information-theoretic minimum, reaching `1–3 bits/edge` on web graphs versus `32 bits/edge` for primitive CSR.

Canonical references: CLRS Ch. 22 (representations), Blandford–Blelloch–Kash (compact representations of separable graphs), Boldi–Vigna (WebGraph), Brisaboa–Ladra–Navarro (`k²`-trees), and Aggarwal–Vitter (the external-memory model underlying the cache analysis).
