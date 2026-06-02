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
9. Construction Complexity and the Counting-Sort Build
10. The Laplacian, Incidence Matrix, and Algebraic Encodings
11. Reference Implementations — CSR Builder and Incidence Matrix
12. Worked Example — The Counting-Sort CSR Build, Step by Step
13. Comparison (asymptotics + constants)
14. Open Problems and Research Directions
15. Summary

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

## 9. Construction Complexity and the Counting-Sort Build

Building a representation is itself an algorithm with its own optimality story; the dominant building block is the **counting-sort prefix-sum** that produces CSR.

### 9.1 CSR construction is `Θ(n + m)` and optimal

**Theorem 9.1.** Given an edge list `L` of `m` edges over `n` vertices, CSR can be built in `Θ(n + m)` time and `Θ(n + m)` auxiliary space, and this is asymptotically optimal.

*Proof.* The build is three linear passes: (1) a degree-count pass over `L` writing into `offset[u+1]`, costing `Θ(m)`; (2) a prefix-sum pass over `offset`, costing `Θ(n)`; (3) a placement pass over `L` writing each target into the slot named by a moving `cursor`, costing `Θ(m)`. Total `Θ(n + m)`. Optimality: any construction must read all `m` edges (else it cannot know the graph) and must write `Θ(n)` offsets and `Θ(m)` targets, so `Ω(n + m)` is a lower bound. ∎

This is exactly the **counting-sort** schema: the degree array is the histogram, the prefix sum converts counts into start offsets, and the placement pass is the stable scatter. CSR construction *is* a counting sort of edges keyed by source vertex; stability of the scatter is what guarantees each vertex's neighbor block is contiguous and that a second key (e.g. target id) preserved from a pre-sorted edge list yields **sorted CSR** with no extra sort.

### 9.2 Radix vs comparison sort of edges

To obtain sorted-neighbor CSR (required for `Θ(log d)` `hasEdge` and for gap compression), neighbors within each block must be ordered. Two routes:

- **Comparison sort each block:** `Σ_u O(d_u log d_u) ≤ O(m log Δ)` where `Δ = max degree`. Simple, cache-poor across blocks.
- **Two-pass radix on `(source, target)`:** sort edges by `target` then stably by `source` (LSD radix), `Θ(n + m)` with `O(1)` radix passes for fixed-width ids. This is the standard high-throughput build — both keys are bounded integers, so no comparison sort is needed at all.

**Corollary 9.2.** Sorted CSR is constructible in `Θ(n + m)` time via double counting sort, dominating the `Θ(m log Δ)` per-block comparison approach asymptotically and (because of sequential memory access) in constant factors.

### 9.3 Parallel construction

The degree-count and placement passes parallelize with per-thread local histograms merged by a parallel prefix sum (`Θ((n + m)/p + log p)` on `p` processors in the PRAM/work-span model: work `Θ(n + m)`, span `Θ(log(n + m))`). This is why CSR is the canonical format for GPU and many-core graph frameworks — the build itself is embarrassingly parallel except for the logarithmic-span scan.

---

## 10. The Laplacian, Incidence Matrix, and Algebraic Encodings

Beyond the four data-structure encodings, a graph has **algebraic** matrix encodings that are themselves representations — the ones spectral graph theory and many max-flow / matching algorithms actually consume.

### 10.1 Incidence matrix

**Definition 10.1.** The incidence matrix `B ∈ ℝ^{n×m}` of a directed graph assigns to edge `e = (u, v)` a column with `B[u][e] = −1`, `B[v][e] = +1`, and `0` elsewhere. For an undirected graph the unsigned incidence matrix has two `1`s per column.

`B` uses `Θ(nm)` space dense, but is itself sparse with exactly `2m` nonzeros, so its sparse storage is `Θ(m)` — equivalent to an edge list with orientation. It is the natural input for flow conservation: `B x = 0` expresses Kirchhoff's current law, and the cycle space / cut space of `G` are the null space and row space of `B`.

### 10.2 Graph Laplacian

**Definition 10.2.** With degree matrix `D = diag(deg(v))` and adjacency matrix `A`, the **Laplacian** is `L = D − A`. Equivalently `L = B Bᵀ` for the signed incidence matrix — the same graph in two encodings.

Key facts that make `L` a *representation* rather than a derived object:
- `L` is symmetric positive semidefinite; its eigenvalues `0 = λ₁ ≤ λ₂ ≤ … ≤ λₙ` encode connectivity. The multiplicity of eigenvalue `0` equals the number of connected components (Proposition: `ker L` is spanned by component indicator vectors).
- The **algebraic connectivity** `λ₂` (Fiedler value) lower-bounds edge expansion (Cheeger's inequality `λ₂/2 ≤ h(G) ≤ √(2λ₂)`), which is exactly what spectral partitioners optimize to minimize the cross-partition edge ratio that dominates distributed-graph cost.
- **Matrix-Tree Theorem (Kirchhoff):** the number of spanning trees equals any cofactor of `L`, i.e. `(1/n)∏_{i=2}^{n} λᵢ`. A purely structural count read off the spectral encoding.

### 10.3 Why the encoding choice is algorithmic

| Consumer | Wants encoding | Reason |
|---|---|---|
| BFS/DFS, traversal | CSR / adjacency list | neighbor enumeration `Θ(d)` |
| Floyd–Warshall, transitive closure | dense / bit matrix | `Θ(n³)` triple loop is matrix-shaped |
| Spectral clustering, effective resistance | Laplacian (sparse `L`) | eigenvectors / linear solves on `L` |
| Max-flow (electrical / IPM) | incidence `B`, Laplacian | flow conservation `B x = 0`, `L = B Bᵀ` solves |
| Kruskal, Bellman–Ford | edge list / sparse incidence | scan all edges once per round |

Fast Laplacian solvers (Spielman–Teng `Õ(m)` SDD solvers; Koutis–Miller–Peng) made the Laplacian a *computational* representation, not just an analytical one — near-linear-time linear-system solves over `L` underlie modern max-flow, sampling, and clustering algorithms. The representation you store dictates which of these worlds you can enter without an `Θ(n + m)` (or worse) conversion.

---

## 11. Reference Implementations — CSR Builder and Incidence Matrix

The proofs in §9 (Θ(n+m) counting-sort build) and §10 (incidence matrix `B`, Laplacian `L = D − A = B Bᵀ`) are easiest to trust as runnable code. Below: a CSR builder that *is* a counting sort keyed on source, and a sparse incidence-matrix construction from the same edge list, in all three languages.

### 11.1 The CSR memory layout being built

```text
edges (source-keyed):  (0,1) (0,3) (1,2) (1,3) (2,0) (3,2)
n = 4,  m = 6

degree histogram:      deg = [2, 2, 1, 1]          # out-degree of 0,1,2,3
prefix sum (offset):   offset = [0, 2, 4, 5, 6]     # offset[u]..offset[u+1] = block of u
scatter targets:       target = [ 1, 3 | 2, 3 | 0 | 2 ]
                                  └u0┘  └u1┘ └u2┘ └u3┘

  offset:  index  0   1   2   3   4
                  +---+---+---+---+---+
                  | 0 | 2 | 4 | 5 | 6 |
                  +---+---+---+---+---+
                    |   |   |   |   |
   target:  index   0   2   4   5   (= start of each vertex's neighbor block)
                  +---+---+---+---+---+---+
                  | 1 | 3 | 2 | 3 | 0 | 2 |
                  +---+---+---+---+---+---+
                   \_u0_/ \_u1_/ u2  u3
```

`Adj(u) = target[offset[u] : offset[u+1]]` is a contiguous slice — the property that gives the optimal `Θ(m/B)` scan cache cost of §4.

### 11.2 Go — counting-sort CSR build plus sparse incidence matrix

```go
package graph

// BuildCSR turns a directed edge list into CSR in Θ(n+m): degree histogram,
// prefix sum, stable scatter — the three passes of Theorem 9.1.
func BuildCSR(n int, edges [][2]int) (offset, target []int) {
	offset = make([]int, n+1)
	for _, e := range edges { // pass 1: degree histogram into offset[u+1]
		offset[e[0]+1]++
	}
	for u := 1; u <= n; u++ { // pass 2: prefix sum -> start offsets
		offset[u] += offset[u-1]
	}
	target = make([]int, len(edges))
	cursor := make([]int, n) // moving write head per vertex
	copy(cursor, offset[:n])
	for _, e := range edges { // pass 3: stable scatter
		u := e[0]
		target[cursor[u]] = e[1]
		cursor[u]++
	}
	return offset, target
}

// IncidenceColumn is one column of the signed incidence matrix B (Def 10.1):
// edge e=(u,v) contributes -1 at row u and +1 at row v. Stored sparsely as
// (row, value) pairs — total storage Θ(m), with exactly 2m nonzeros.
type IncidenceColumn struct {
	Tail, Head int // -1 at Tail, +1 at Head
}

func BuildIncidence(edges [][2]int) []IncidenceColumn {
	cols := make([]IncidenceColumn, len(edges))
	for i, e := range edges {
		cols[i] = IncidenceColumn{Tail: e[0], Head: e[1]}
	}
	return cols
}

// LaplacianAction computes y = L x = (D - A) x for the *undirected* graph of
// `edges`, using only the sparse edge list — no n×n matrix materialized.
// This is the workhorse primitive fed to a conjugate-gradient / SDD solver.
func LaplacianAction(n int, edges [][2]int, x []float64) []float64 {
	y := make([]float64, n)
	for _, e := range edges {
		u, v := e[0], e[1]
		// (D-A) contribution of edge {u,v}: y_u += x_u - x_v ; y_v += x_v - x_u
		y[u] += x[u] - x[v]
		y[v] += x[v] - x[u]
	}
	return y
}
```

`LaplacianAction` makes the §10.3 point concrete: a near-linear SDD solver never forms `L`; it only needs `x ↦ Lx`, which is one pass over the edge list — `Θ(m)` per iteration.

### 11.3 Java — the same build with primitive arrays (no boxing)

```java
import java.util.Arrays;

public final class CSRBuilder {
    public final int[] offset; // length n+1
    public final int[] target; // length m

    public CSRBuilder(int n, int[][] edges) {
        offset = new int[n + 1];
        for (int[] e : edges) offset[e[0] + 1]++;           // pass 1: histogram
        for (int u = 1; u <= n; u++) offset[u] += offset[u - 1]; // pass 2: prefix sum
        target = new int[edges.length];
        int[] cursor = Arrays.copyOf(offset, n);            // moving write heads
        for (int[] e : edges) target[cursor[e[0]]++] = e[1]; // pass 3: scatter
    }

    public int degree(int u) { return offset[u + 1] - offset[u]; } // Θ(1)

    // y = L x for the undirected graph, edge-list form (no n×n matrix).
    public static double[] laplacianAction(int n, int[][] edges, double[] x) {
        double[] y = new double[n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            y[u] += x[u] - x[v];
            y[v] += x[v] - x[u];
        }
        return y;
    }
}
```

Using primitive `int[]` rather than `List<Integer>` is the difference between the ~4 B/edge and ~16 B/edge lines of §11.2 below — the single most consequential representation choice in the JVM.

### 11.4 Python — `array`-backed CSR and a SciPy-style incidence triple

```python
from array import array
from typing import List, Tuple


def build_csr(n: int, edges: List[Tuple[int, int]]) -> Tuple[array, array]:
    """Θ(n+m) counting-sort CSR build, returning ('i' = int32) arrays."""
    offset = array("i", [0]) * (n + 1)
    for u, _ in edges:            # pass 1: degree histogram
        offset[u + 1] += 1
    for u in range(1, n + 1):     # pass 2: prefix sum
        offset[u] += offset[u - 1]
    target = array("i", [0]) * len(edges)
    cursor = array("i", offset[:n])  # moving write heads
    for u, v in edges:            # pass 3: stable scatter
        target[cursor[u]] = v
        cursor[u] += 1
    return offset, target


def incidence_coo(edges: List[Tuple[int, int]]) -> Tuple[List[int], List[int], List[int]]:
    """Signed incidence matrix B in COO triples (row, col=edge index, value).
    Exactly 2m nonzeros (Def 10.1); feed to scipy.sparse.coo_matrix."""
    rows, cols, vals = [], [], []
    for e_idx, (u, v) in enumerate(edges):
        rows += [u, v]
        cols += [e_idx, e_idx]
        vals += [-1, +1]
    return rows, cols, vals
```

The `array("i", ...)` storage is C-contiguous int32, so it carries the same ~4 B/edge cost as the Go/Java versions — Python's per-object boxing is sidestepped exactly as a primitive Java array sidesteps `Integer` boxing.

### 11.5 Building the transpose `Gᵀ` (in-neighbors) in `Θ(n+m)`

A directed CSR gives out-neighbors `Adj(u)` cheaply but in-neighbors `{w : (w,u) ∈ E}` only by scanning the whole `target[]` — `Θ(m)`. Algorithms that need both directions (Kosaraju's second pass, in-degree-driven Kahn topological sort, reverse BFS) store a second CSR for the transpose `Gᵀ`, where every edge `(u,v)` becomes `(v,u)`. The transpose is itself a counting sort, now keyed on the *target*:

```go
// Transpose builds the in-neighbor CSR from an out-neighbor CSR in Θ(n+m).
func Transpose(n int, offset, target []int) (tOffset, tTarget []int) {
	tOffset = make([]int, n+1)
	for _, v := range target { // pass 1: in-degree histogram (count edges INTO v)
		tOffset[v+1]++
	}
	for u := 1; u <= n; u++ { // pass 2: prefix sum
		tOffset[u] += tOffset[u-1]
	}
	tTarget = make([]int, len(target))
	cursor := make([]int, n)
	copy(cursor, tOffset[:n])
	for u := 0; u < n; u++ { // pass 3: scatter each (u -> v) as (v -> u)
		for k := offset[u]; k < offset[u+1]; k++ {
			v := target[k]
			tTarget[cursor[v]] = u
			cursor[v]++
		}
	}
	return tOffset, tTarget
}
```

This is the same three-pass schema as §11.2, with the histogram counting in-degrees instead of out-degrees. The cost is one extra `Θ(n+m)` build and one extra ~4 B/edge of storage — the standard price for `O(d)` in-neighbor enumeration. Spectral and undirected algorithms avoid this entirely because an undirected CSR already stores each edge at both endpoints, so `Gᵀ = G`.

---

## 12. Worked Example — The Counting-Sort CSR Build, Step by Step

Trace `BuildCSR` on the §11.1 edge list to see the three passes mutate the arrays. Edges (already grouped by source for readability, though the algorithm does not require pre-grouping):

```text
edges = [ (0,1), (0,3), (1,2), (1,3), (2,0), (3,2) ]   n = 4, m = 6
```

**Pass 1 — degree histogram into `offset[u+1]`.** Start `offset = [0,0,0,0,0]`. Each edge increments the slot one past its source:

```text
(0,1): offset[1]++  -> [0,1,0,0,0]
(0,3): offset[1]++  -> [0,2,0,0,0]
(1,2): offset[2]++  -> [0,2,1,0,0]
(1,3): offset[2]++  -> [0,2,2,0,0]
(2,0): offset[3]++  -> [0,2,2,1,0]
(3,2): offset[4]++  -> [0,2,2,1,1]
```

`offset[u+1]` now holds `deg(u)`: vertex 0 has 2, vertex 1 has 2, vertex 2 has 1, vertex 3 has 1. Sum = 6 = m, confirming the degree-sum identity of Theorem 2.2.

**Pass 2 — prefix sum converts counts to start offsets.**

```text
offset[1] += offset[0]:  [0,2,2,1,1]   (2+0)
offset[2] += offset[1]:  [0,2,4,1,1]   (2+2)
offset[3] += offset[2]:  [0,2,4,5,1]   (1+4)
offset[4] += offset[3]:  [0,2,4,5,6]   (1+5)
```

Now `offset[u]` is where vertex `u`'s neighbor block begins, and `offset[u+1]` where it ends. `offset[4] = 6 = m` — the cheap integrity check used at load time in `senior.md` §13.

**Pass 3 — stable scatter.** Copy `cursor = offset[:4] = [0,2,4,5]`. Each edge writes its target at `cursor[source]`, then bumps the cursor:

```text
(0,1): target[cursor[0]=0]=1; cursor=[1,2,4,5]  target=[1,_,_,_,_,_]
(0,3): target[cursor[0]=1]=3; cursor=[2,2,4,5]  target=[1,3,_,_,_,_]
(1,2): target[cursor[1]=2]=2; cursor=[2,3,4,5]  target=[1,3,2,_,_,_]
(1,3): target[cursor[1]=3]=3; cursor=[2,4,4,5]  target=[1,3,2,3,_,_]
(2,0): target[cursor[2]=4]=0; cursor=[2,4,5,5]  target=[1,3,2,3,0,_]
(3,2): target[cursor[3]=5]=2; cursor=[2,4,5,6]  target=[1,3,2,3,0,2]
```

Final `offset=[0,2,4,5,6]`, `target=[1,3,2,3,0,2]`. Reading back: `Adj(0)=target[0:2]={1,3}`, `Adj(1)=target[2:4]={2,3}`, `Adj(2)=target[4:5]={0}`, `Adj(3)=target[5:6]={2}` — exactly the input. Three linear passes, no comparisons, `Θ(n+m)`.

**Sorted-CSR for free.** Because the scatter is *stable* (cursor advances monotonically), if the edge list were pre-sorted by `(source, target)` the neighbor blocks come out sorted with no extra work — the Corollary 9.2 double-radix observation. Here `Adj(0)={1,3}` and `Adj(1)={2,3}` happen to be ascending already because the input was emitted in that order; a stable scatter preserves it.

---

## 13. Comparison (asymptotics + constants)

### 13.1 Asymptotic summary

| Representation | Space | `hasEdge` | `neighbors` | `addEdge` | all-edges |
|---|---|---|---|---|---|
| Adjacency matrix | `Θ(n²)` | `Θ(1)` | `Θ(n)` | `Θ(1)` | `Θ(n²)` |
| Adjacency list | `Θ(n+m)` | `Θ(d)` | `Θ(d)` | `O(1)` am. | `Θ(n+m)` |
| Sorted CSR | `Θ(n+m)` | `Θ(log d)` | `Θ(d)` | `Θ(n+m)` | `Θ(n+m)` |
| Edge list | `Θ(m)` | `Θ(m)` | `Θ(m)` | `O(1)` am. | `Θ(m)` |
| Bit matrix | `Θ(n²)` bits | `Θ(1)` | `Θ(n/w)` | `Θ(1)` | `Θ(n²/w)` |
| Compressed CSR | `Θ(m·H)` | `Θ(log d)`+dec | `Θ(d)`+dec | rebuild | `Θ(m)`+dec |

### 13.2 Concrete bytes-per-edge constants (32-bit ids, modern hardware)

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

### 13.3 Decision rule distilled

The whole representation question collapses to three questions, answered top to bottom:

1. **Is the graph dense (`m = Θ(n²)`)?** If yes, the bit matrix is both space-optimal and `O(1)`-query — use it, and exploit word-parallel row ops (§6.1) for closure/triangle kernels. If no, continue.
2. **Will you mutate it after building?** If writes are frequent and reads must see them immediately, use a per-vertex adjacency structure (hash set if you also need `O(1)` expected `hasEdge`). If it is build-once-read-many, continue.
3. **Is it read-mostly and traversal-heavy?** Then sorted CSR: optimal scan locality (§4.1), `Θ(1)` degree, `Θ(log d)` `hasEdge`, and the gateway to the gap+varint compression and zero-copy `mmap` load discussed at the senior level.

Edge list survives only as an *interchange* format (input to a builder, scan-once algorithms like Kruskal/Bellman–Ford); it is never the right *serving* representation because every point query is `Θ(m)`. The algebraic encodings (incidence `B`, Laplacian `L`) are not alternatives but *additional* views you build when a spectral or flow algorithm demands them — kept sparse at `Θ(m)` (§10–§11).

---

## 14. Open Problems and Research Directions

1. **Dynamic succinct graphs.** Maintaining a near-entropy representation under edge insertions/deletions with `o(log n)` query and update remains open for general graphs; current dynamic structures pay polylog overhead.

2. **Optimal cache-oblivious traversal layout.** Finding a vertex ordering that minimizes cache misses for arbitrary traversals is related to minimum-bandwidth/minimum-linear-arrangement, both NP-hard; the gap between heuristics (RCM, BFS order) and the optimum is not well characterized.

3. **Worst-case `O(1)` `hasEdge` in `o(n²)` for sparse-but-not-planar graphs.** Per-vertex hashing gives `O(1)` *expected*; a deterministic `O(1)` worst-case structure in `O(m)` space for general sparse graphs is not known.

4. **Compression matching graph entropy with fast queries.** WebGraph achieves remarkable ratios empirically but a representation provably matching the graph's entropy `H` while supporting `O(1)` neighbor access is open for general (non-planar, non-separable) graphs.

5. **Distributed partitioning with provable cut guarantees.** Streaming/online vertex-cut partitioners with worst-case approximation guarantees on replication factor for adversarial power-law inputs remain an active area.

6. **GPU-friendly dynamic CSR.** Maintaining CSR (or a CSR variant) under batched updates on GPUs without full rebuild, while preserving coalesced memory access, is actively researched (e.g. Hornet, faimGraph).

---

## 15. Summary

- A graph `G=(V,E)` is the labelled object; matrix, list, edge-list, and CSR are four **information-equivalent** encodings of the same edge set, differing only in which operations are cheap.
- **Space:** matrix `Θ(n²)` (density-independent), list/CSR `Θ(n+m)`, edge list `Θ(m)`. The degree-sum identity (`Σ deg = 2m`) is the one fact behind the list/CSR space bound.
- **Queries:** the matrix alone gives `Θ(1)` `hasEdge` but pays `Θ(n)` to enumerate neighbors; lists and CSR pay `Θ(d)` for `hasEdge` but enumerate neighbors optimally in `Θ(d)`.
- **Lower bound:** `O(1)` worst-case `hasEdge` provably forces `Ω(n²)` bits (a counting argument over `2^{\binom{n}{2}}` graphs), so the matrix is space-optimal among constant-query structures, and you cannot have both `O(1)` query and `o(n²)` space deterministically on dense graphs.
- **Cache:** CSR achieves the optimal `Θ(m/B)` cache misses for a full scan; pointer lists and boxed elements ruin the constant; vertex relabelling recovers locality.
- **Compression:** succinct (`k²`-tree, planar separators) and entropy-coded (WebGraph, gap+varint) representations approach the information-theoretic minimum, reaching `1–3 bits/edge` on web graphs versus `32 bits/edge` for primitive CSR.
- **Construction:** CSR is built in `Θ(n + m)` by a counting sort of edges keyed on source (degree histogram → prefix sum → stable scatter); sorted CSR comes for free from a double radix pass, and the whole build parallelizes to `Θ(log(n+m))` span.
- **Algebraic encodings:** the incidence matrix `B` (sparse `Θ(m)`) and the Laplacian `L = D − A = B Bᵀ` are themselves representations — `λ₂` bounds expansion (Cheeger), `ker L` counts components, cofactors count spanning trees (Matrix-Tree), and near-linear SDD solvers make `L` a *computational* encoding feeding modern max-flow and spectral clustering.

Canonical references: CLRS Ch. 22 (representations), Blandford–Blelloch–Kash (compact representations of separable graphs), Boldi–Vigna (WebGraph), Brisaboa–Ladra–Navarro (`k²`-trees), Aggarwal–Vitter (the external-memory model underlying the cache analysis), Spielman–Teng (near-linear SDD/Laplacian solvers), and Chung's *Spectral Graph Theory* for the Laplacian.
