# Floyd-Warshall Algorithm — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition
2. Correctness Proof — the Intermediate-Set DP Invariant
3. In-Place Optimization Correctness Proof
4. Complexity — O(V³) Time, O(V²) Space
5. Closed Semirings and Kleene's Algorithm (Min-Plus Semiring)
6. Cache-Blocked Complexity
7. Average-Case and Path-Counting Analysis
8. Space-Time Trade-offs
9. Comparison with Alternatives (asymptotics + constants)
10. Open Problems — Subcubic APSP
11. Worked k-Step Trace and Matrix Evolution
12. Reference Implementations
    - 12.1 Go — blocked/tiled Floyd-Warshall
    - 12.2 Java — path reconstruction via the next-matrix
    - 12.3 Python — bitset transitive closure
13. Summary

---

## 1. Formal Definition

Let `G = (V, E, w)` be a finite directed graph with vertex set `V = {0, 1, …, n-1}` and weight function `w : E → ℝ`. Extend `w` to a complete weight matrix `W ∈ (ℝ ∪ {∞})^{n×n}`:

```text
W[i][j] = 0           if i = j
        = w(i, j)      if (i, j) ∈ E
        = +∞           otherwise
```

(If parallel edges exist, take `W[i][j] = min` of their weights.)

**Definition 1.1 (Shortest-path distance).** For `i, j ∈ V`, let `δ(i, j)` be the infimum of `w(P)` over all walks `P` from `i` to `j`, where `w(P)` is the sum of edge weights. If a negative-weight cycle is reachable on some `i ⇝ j` walk, `δ(i, j) = -∞`.

**Definition 1.2 (Restricted distance).** For `k ∈ {0, 1, …, n}`, let

```text
d_k(i, j) = min weight of an i→j walk whose intermediate vertices all lie in {0, …, k-1}.
```

A vertex is *intermediate* if it is neither the source `i` nor the destination `j`. By convention `d_0(i, j) = W[i][j]` (no intermediates permitted) and the target quantity is `d_n(i, j) = δ(i, j)` when no negative cycle is reachable.

**Definition 1.3 (Floyd-Warshall recurrence).**

```text
d_{k+1}(i, j) = min( d_k(i, j),  d_k(i, k) + d_k(k, j) ).
```

The algorithm evaluates this recurrence for `k = 0, …, n-1`, collapsing the `k` index onto a single matrix `D`.

---

## 2. Correctness Proof — the Intermediate-Set DP Invariant

We prove that the recurrence computes `d_k` correctly by induction on `k`. Assume throughout that `G` contains **no negative-weight cycle** (we handle detection in §3.4); under that assumption every shortest walk may be taken to be a **simple path** on its intermediate vertices.

**Theorem 2.1.** For all `k ∈ {0, …, n}` and all `i, j ∈ V`, the value `d_k(i, j)` defined by the recurrence equals the minimum weight of any `i→j` walk whose intermediate vertices lie in `S_k = {0, …, k-1}`.

**Proof.** Induction on `k`.

*Base case `k = 0`.* `S_0 = ∅`, so the only admissible walks are the empty walk (`i = j`, weight 0) and single edges `i → j` (weight `W[i][j]`). This is exactly `d_0 = W`. ✓

*Inductive step.* Assume the claim for `k`; prove it for `k+1`. Fix `i, j`. Let `P*` be a minimum-weight `i→j` walk with intermediates in `S_{k+1} = S_k ∪ {k}`. Two cases:

1. **`P*` does not use vertex `k` as an intermediate.** Then all intermediates of `P*` lie in `S_k`, so by the inductive hypothesis its weight is `≥ d_k(i, j)`. Conversely `d_k(i, j)` is achievable with intermediates in `S_k ⊆ S_{k+1}`. Hence the optimum equals `d_k(i, j)`.

2. **`P*` uses vertex `k` as an intermediate.** Because there is no negative cycle, we may assume `P*` is simple on its intermediates, so it passes through `k` **exactly once**. Split `P* = P_1 · P_2` at that occurrence, where `P_1 : i ⇝ k` and `P_2 : k ⇝ j`. All intermediates of `P_1` and `P_2` lie in `S_{k+1} \ {k} = S_k` (the only occurrence of `k` is the split point, which is an *endpoint* of each sub-walk, not an intermediate). By the inductive hypothesis, `w(P_1) ≥ d_k(i, k)` and `w(P_2) ≥ d_k(k, j)`, and both bounds are achievable. Hence the optimum over case 2 equals `d_k(i, k) + d_k(k, j)`.

Taking the minimum over the two cases yields precisely

```text
d_{k+1}(i, j) = min( d_k(i, j),  d_k(i, k) + d_k(k, j) ),
```

which is the recurrence. ∎

**Corollary 2.2.** After the loop completes (`k = n`), `D[i][j] = d_n(i, j) = δ(i, j)` for all `i, j`, since `S_n = V` allows every vertex as an intermediate.

The crux is the *exactly once* argument in case 2: simplicity on intermediates (guaranteed by the absence of negative cycles) is what lets us split at the single occurrence of `k` and apply the hypothesis to two `S_k`-restricted sub-walks.

---

## 3. In-Place Optimization Correctness Proof

The implemented algorithm does not keep separate `d_k` and `d_{k+1}` arrays; it overwrites a single matrix `D`:

```text
for k in 0..n-1:
  for i in 0..n-1:
    for j in 0..n-1:
      D[i][j] = min( D[i][j], D[i][k] + D[k][j] )
```

We must show this in-place update computes the same values as the layered recurrence, even though `D[i][k]` and `D[k][j]` may already be partially updated during the `k`-th pass.

### 3.1 The pivot row and column are invariant during pass `k`

**Lemma 3.1.** During the iteration with fixed `k`, the entries `D[k][j]` (pivot row) and `D[i][k]` (pivot column) are never changed.

**Proof.** Consider any update to `D[k][j]` (i.e. `i = k`): it would set `D[k][j] = min(D[k][j], D[k][k] + D[k][j])`. We claim `D[k][k] = 0` throughout (given no negative cycle): `D[k][k]` starts at `0` and an update could only make it `min(0, D[k][m] + D[m][k])` for prior `m`; that value is `≥ 0` precisely because there is no negative cycle through `k`. Hence `D[k][k] + D[k][j] = D[k][j]`, so the `min` leaves `D[k][j]` unchanged. The pivot column `D[i][k]` is symmetric. ∎

### 3.2 In-place values never undershoot the layered values

**Lemma 3.2.** At every point during pass `k`, every entry `D[i][j]` satisfies `d_{k+1}(i, j) ≤ D[i][j] ≤ d_k(i, j)`.

**Proof sketch.** Every value stored in `D` corresponds to the weight of some *actual* walk with intermediates in `S_{k+1}`, so it is `≥ d_{k+1}(i,j)` (lower bound: no value can be smaller than the true restricted optimum). The upper bound holds because the only update applied is the `S_{k+1}` relaxation, which can only *decrease* entries from their `d_k` value. Monotonic decrease plus a valid lower bound pins each entry between the two layers. ∎

### 3.3 Conclusion

**Theorem 3.3.** After pass `k`, `D[i][j] = d_{k+1}(i, j)` for all `i, j`.

**Proof.** By Lemma 3.1 the relaxation reads the *correct, unmodified* pivot-row and pivot-column values `D[i][k] = d_k(i, k)` and `D[k][j] = d_k(k, j)` (these equal both their pre-pass and post-pass values, since they do not change). By Lemma 3.2, `D[i][j]` before the relaxation is sandwiched, and the relaxation `min(D[i][j], d_k(i,k) + d_k(k,j))` reaches exactly `d_{k+1}(i, j)`. Whether `D[i][j]` had already been touched by an earlier `(i, j)` in this pass is irrelevant: the relaxation is idempotent and the operands are pivot-row/column values that are fixed. Induction over `k` gives correctness. ∎

This is why **no double buffering is needed** and why the loop order (`k` outermost) is essential: Lemma 3.1 requires that the *entire* pivot row and column for `k` be settled relative to `d_k` before any `k+1` relaxation begins.

### 3.4 Negative-cycle detection

**Proposition 3.4.** After the algorithm, `G` has a negative cycle reachable from `i` (returning to `i`) **iff** `D[i][i] < 0`.

**Proof.** `D[i][i] = δ(i, i)` is the minimum weight of a closed walk at `i` using all vertices as intermediates. If some negative cycle is reachable from `i` and back, that closed walk has negative weight, so `D[i][i] < 0`. Conversely, `D[i][i] < 0` exhibits a negative-weight closed walk at `i`, which contains a negative-weight cycle. ∎

If any diagonal entry is negative, `δ` is `-∞` for affected pairs; a second `O(V³)` pass can propagate `-∞` to every pair `(i, j)` with a negative-cycle vertex `t` on some `i ⇝ t ⇝ j` route.

---

## 4. Complexity — O(V³) Time, O(V²) Space

**Time.** Three nested loops over `{0,…,n-1}`, with `O(1)` work (one addition, one comparison, one conditional store) per innermost iteration:

```text
T(n) = Σ_{k} Σ_{i} Σ_{j} Θ(1) = Θ(n³).
```

There is **no data-dependent early termination**: the bound is `Θ(n³)` in the best, average, and worst case alike. This is unlike Dijkstra or Bellman-Ford, whose running times depend on `E`.

**Space.** The in-place algorithm uses one `n × n` matrix: `Θ(n²)`. Path reconstruction adds a second `n × n` `next` (or `pred`) matrix: still `Θ(n²)`. The naive layered DP would use `Θ(n³)` (one matrix per `k`); §3 eliminates that.

**Word/RAM model.** Assuming `O(1)` arithmetic on machine words, the bounds above hold. With arbitrary-precision weights (path counts, big integers), multiply by the cost of the arithmetic.

---

## 5. Closed Semirings and Kleene's Algorithm (Min-Plus Semiring)

Floyd-Warshall is a special case of **Kleene's algorithm** for computing the closure of a matrix over a **closed semiring**.

**Definition 5.1 (Semiring).** A semiring `(S, ⊕, ⊗, 0̄, 1̄)` has a commutative monoid `(S, ⊕, 0̄)`, a monoid `(S, ⊗, 1̄)`, distributivity of `⊗` over `⊕`, and `0̄` absorbing under `⊗`. A *closed* semiring additionally supports a well-defined countable `⊕`-sum (a closure / star operation `a* = ⊕_{i≥0} a^i`).

**The min-plus (tropical) semiring** is `(ℝ ∪ {+∞}, min, +, +∞, 0)`:
- `⊕ = min` (combine alternative paths),
- `⊗ = +` (concatenate path weights),
- additive identity `0̄ = +∞`, multiplicative identity `1̄ = 0`.

Over this semiring, the shortest-path matrix is the **closure** `W*` of the weight matrix `W`, where `(W*)[i][j] = δ(i, j)`. The Floyd-Warshall recurrence is exactly Kleene's incremental closure, where the `k`-th pass folds in the star of the `k`-th pivot.

**Specializing the semiring** yields the variants from `middle.md`:

| Problem | Semiring `(S, ⊕, ⊗)` | `⊕` (combine) | `⊗` (extend) |
|---|---|---|---|
| Shortest path | min-plus (tropical) | `min` | `+` |
| Transitive closure | Boolean `({0,1}, ∨, ∧)` | `OR` | `AND` |
| Widest / bottleneck | max-min | `max` | `min` |
| Minimax | min-max | `min` | `max` |
| Most-reliable path | `([0,1], max, ×)` | `max` | `×` |
| Counting walks | `(ℕ, +, ×)` | `+` | `×` |

**Proposition 5.2.** For any closed semiring, Kleene's algorithm (the Floyd-Warshall triple loop with `(⊕, ⊗)` in place of `(min, +)`) computes the matrix closure `W*` in `Θ(n³)` semiring operations. Correctness follows from the same intermediate-set induction as §2, replacing `min` with `⊕` and `+` with `⊗` and using semiring distributivity in place of the additivity of path weights.

This semiring abstraction is the deep reason one triple loop solves so many problems: they are all the same closure computation in different algebras.

---

## 6. Cache-Blocked Complexity

In the external-memory (I/O) model with cache size `M` and block (line) size `B`, naive Floyd-Warshall has poor locality once `n² > M`: each pass streams the whole matrix, giving `Θ(n³ / B)` cache misses (no temporal reuse across passes).

**Blocked Floyd-Warshall** partitions the matrix into `(n/β) × (n/β)` tiles of side `β` with `β² ≤ M` (or, for cache-obliviousness, recursively). Each tile's `β³` updates touch `Θ(β²)` data reused `β` times.

**Proposition 6.1.** Blocked Floyd-Warshall (Venkataraman, Sahni & Mukhopadhyaya 2003) with tile side `β = Θ(√M)` incurs

```text
Θ( n³ / (B √M) )
```

cache misses, an `Θ(√M)` improvement over the naive `Θ(n³ / B)`. A cache-oblivious recursive divide-and-conquer formulation (Park, Penner & Prasanna 2004) achieves the same `Θ(n³ / (B√M))` bound without knowing `M` or `B`.

The work stays `Θ(n³)`; only the memory-traffic constant improves — but on modern hardware that constant dominates wall-clock time for `n` beyond a few hundred.

---

## 7. Average-Case and Path-Counting Analysis

### 7.1 No average-case speedup
Because the triple loop is oblivious to edge presence and weights, the running time is `Θ(n³)` for **every** input — there is no average-case improvement of the leading term. (Contrast Dijkstra, whose cost depends on `E`.) The only input-dependent savings are micro-optimizations: skipping a row when `D[i][k] = ∞` removes `O(n)` work per such `(i, k)` but does not change the asymptotic class.

### 7.2 Counting shortest paths
Augment with a count matrix `C`, initialized `C[i][j] = 1` for edges and the diagonal, `0` otherwise. On relaxation:

```text
if D[i][k] + D[k][j] <  D[i][j]:  D[i][j] = D[i][k]+D[k][j];  C[i][j] = C[i][k]*C[k][j]
if D[i][k] + D[k][j] == D[i][j]:  C[i][j] += C[i][k]*C[k][j]
```

`C[i][j]` then counts distinct shortest `i→j` paths. Counts can be exponential in `n`, so use modular arithmetic for a fixed-width answer. Correctness follows from the same intermediate-set induction, with `C` accumulating over the disjoint "uses `k`" / "does not use `k`" decompositions.

### 7.3 Walks of fixed length
For counting walks (not shortest paths) of exactly `L` edges, Floyd-Warshall is the wrong tool; that is min-plus / `(+,×)` matrix **power** `W^L` via fast exponentiation in `O(n³ log L)` (see cp-algorithms "Number of paths of fixed length / shortest paths of fixed length"). Floyd-Warshall computes the *closure* (unbounded length), not a fixed power.

---

## 8. Space-Time Trade-offs

| Variant | Time | Space | Notes |
|---|---|---|---|
| Layered 3D DP | `Θ(n³)` | `Θ(n³)` | Pedagogical only; never implement. |
| In-place 2D | `Θ(n³)` | `Θ(n²)` | Standard. |
| In-place + `next` matrix | `Θ(n³)` | `Θ(n²)` (×2 constant) | Adds path reconstruction. |
| Blocked / cache-oblivious | `Θ(n³)` work, `Θ(n³/(B√M))` I/O | `Θ(n²)` | Same work, far less memory traffic. |
| Bitset transitive closure | `Θ(n³ / w)` (word size `w`) | `Θ(n² / w)` | Pack boolean rows; ~64× constant speedup. |
| Distance + count | `Θ(n³)` | `Θ(n²)` (×2) | Number of shortest paths. |

The `Θ(n³)` time is invariant across all classical variants; the levers are the **space** (3D → 2D) and the **constant factor** (blocking, bitsets, SIMD min-plus).

---

## 9. Comparison with Alternatives (asymptotics + constants)

### 9.1 All-pairs shortest path methods

| Method | Time | Negatives | Best regime |
|---|---|---|---|
| Floyd-Warshall | `Θ(V³)` | edges ✓, cycles detect | Dense, small V, simple. |
| `V ×` Dijkstra (binary heap) | `O(V E log V)` | ✗ | Sparse, non-negative. |
| `V ×` Dijkstra (Fibonacci heap) | `O(V² log V + V E)` | ✗ | Dense, non-negative (theory). |
| Johnson's | `O(V E + V E log V)` | ✓ (reweight) | Sparse with negatives. |
| `V ×` Bellman-Ford | `O(V² E)` | ✓ | Rarely optimal; baseline. |
| Min-plus matrix mult (naive) | `Θ(V³ log V)` | ✓ | Theoretical building block. |

For a sparse graph (`E = Θ(V)`), Johnson's `O(V² log V)` crushes Floyd-Warshall's `Θ(V³)`. For a dense graph (`E = Θ(V²)`), `V ×` Dijkstra is `O(V³ log V)` — *worse* than Floyd-Warshall by a log factor, plus Floyd-Warshall handles negatives and is simpler. This is the precise regime boundary.

### 9.2 Constant factors
Floyd-Warshall's inner loop is two arithmetic ops and a branch, fully predictable and vectorizable, on a contiguous matrix — one of the most cache-friendly `Θ(n³)` kernels in practice. A tuned blocked/SIMD implementation reaches a large fraction of memory bandwidth. Johnson's and `V ×` Dijkstra carry heap overhead and pointer-chasing, so for `V` up to a few thousand on dense graphs Floyd-Warshall often *wins wall-clock* despite the log-factor asymptotic disadvantage being on the other side.

---

## 10. Open Problems — Subcubic APSP

The `Θ(n³)` bound of Floyd-Warshall has resisted improvement to genuinely polynomial-factor-faster algorithms for general real-weighted graphs.

1. **The APSP conjecture.** It is conjectured that APSP requires `n^{3-o(1)}` time in the worst case (no `O(n^{3-ε})` truly subcubic algorithm for constant `ε > 0`). APSP is a central problem of **fine-grained complexity**: it is subcubic-equivalent to a cluster of problems (min-plus matrix product, negative triangle detection, second-shortest paths, replacement paths, radius/median), so a subcubic algorithm for any one would break all.

2. **Williams' bound.** Ryan Williams (2014) gave the first improvement over `n³ / polylog`, an APSP algorithm running in

```text
n³ / 2^{Ω(√(log n))}
```

time. This is *not* truly subcubic (it is `n^{3 - o(1)}`), but it beats every `n³ / log^c n` bound for fixed `c`. It uses circuit-complexity tools (the polynomial method, fast evaluation of low-degree polynomials) rather than algebraic matrix multiplication.

3. **Min-plus vs ring matrix product.** Ordinary matrix multiplication is `O(n^{ω})` with `ω < 2.372` (Williams, Alman–Vassilevska Williams, and successors). But min-plus (tropical) product, which APSP reduces to, has **no** known `O(n^{ω})` algorithm — the tropical semiring lacks subtraction, blocking Strassen-style cancellation. Whether min-plus product is truly subcubic is open and equivalent to subcubic APSP.

4. **Special cases that *are* faster.**
   - **Integer weights bounded by `M`:** APSP in `Õ(M^{ω} n^{ω})`-style bounds via (max,min) and rectangular matrix multiplication (Zwick); `Õ(n^{2.5})`-type results for small `M`.
   - **Unweighted / undirected:** Seidel's algorithm computes undirected unweighted APSP in `O(n^{ω} log n)` using real matrix multiplication and a parity trick — genuinely subcubic.
   - **Planar graphs:** `O(n²)` APSP exists, exploiting planar separators.

5. **Approximate APSP.** `(1+ε)`-approximate APSP admits truly subcubic algorithms via scaling + fast matrix multiplication, sidestepping the tropical barrier.

Floyd-Warshall remains the practical champion for exact, dense, general-weight APSP precisely because the theoretical improvements (Williams') have enormous constants and the truly-subcubic results require special structure.

---

## 11. Worked k-Step Trace and Matrix Evolution

Concretely tracing the closure makes Lemma 3.1 (pivot row/column invariance) tangible. Take the 4-vertex directed graph with weight matrix `W` (rows = from, columns = to, `∞` for no edge, `0` on the diagonal):

```text
        to:  0    1    2    3
from 0:  [   0,   3,   ∞,   7 ]
from 1:  [   8,   0,   2,   ∞ ]
from 2:  [   5,   ∞,   0,   1 ]
from 3:  [   2,   ∞,   ∞,   0 ]
```

We compute `d_{k+1} = min(d_k, d_k(·,k) + d_k(k,·))` four times. Each table below is `D` *after* the pass for that `k`. The pivot row and column for the pass are framed with `|…|` to show they do not change during that pass (Lemma 3.1).

**Pass k = 0** (route through vertex 0; pivot = row 0 and column 0). Updated cells: `D[1][3] = D[1][0]+D[0][3] = 8+7 = 15`; `D[3][1] = D[3][0]+D[0][1] = 2+3 = 5`; `D[2][1] = D[2][0]+D[0][1] = 5+3 = 8`; `D[3][3]` stays 0.

```text
            k=0 pivot col
        to:  0    1    2    3
from 0: |   0|   3,   ∞,   7      <- pivot row 0 (unchanged)
from 1: |   8|   0,   2,  15
from 2: |   5|   8,   0,   1
from 3: |   2|   5,   ∞,   0
```

**Pass k = 1** (route through vertex 1). `D[0][2] = D[0][1]+D[1][2] = 3+2 = 5`; `D[3][2] = D[3][1]+D[1][2] = 5+2 = 7`; `D[2][2]` stays 0.

```text
        to:  0    1    2    3
from 0:     0,   3,   5,   7
from 1:  -- pivot row 1 (unchanged) ----
from 2:     5,   8,   0,   1
from 3:     2,   5,   7,   0
```

**Pass k = 2** (route through vertex 2). `D[0][3] = min(7, D[0][2]+D[2][3]) = min(7, 5+1) = 6`; `D[1][3] = min(15, D[1][2]+D[2][3]) = min(15, 2+1) = 3`; `D[3][3]` stays 0.

```text
        to:  0    1    2    3
from 0:     0,   3,   5,   6
from 1:     8,   0,   2,   3
from 2:  -- pivot row 2 (unchanged) ----
from 3:     2,   5,   7,   0
```

**Pass k = 3** (route through vertex 3). `D[2][0] = min(5, D[2][3]+D[3][0]) = min(5, 1+2) = 3`; `D[1][0] = min(8, D[1][3]+D[3][0]) = min(8, 3+2) = 5`; `D[0][0]` stays 0.

```text
        to:  0    1    2    3
from 0:     0,   3,   5,   6
from 1:     5,   0,   2,   3
from 2:     3,   6,   0,   1
from 3:     2,   5,   7,   0
```

This final matrix is `W* = δ`. Verify one entry by hand: `δ(1,0) = 5` realized by the walk `1 → 2 → 3 → 0` with weight `2 + 1 + 2 = 5`, beating the direct edge `1 → 0` of weight 8. The diagonal stayed `0` throughout, confirming Proposition 3.4 found no negative cycle.

The monotone-decrease picture (Lemma 3.2) is visible column by column: `D[1][3]` went `∞ → 15 → 3 → 3 → 3`, never rising; `D[2][0]` went `5 → 5 → 5 → 5 → 3`. No entry ever increased — every relaxation is a `min` that can only tighten.

---

## 12. Reference Implementations

All three implementations target the same `Θ(n³)` work with the constant-factor and reconstruction techniques discussed above. Code order is Go, Java, Python.

### 12.1 Go — blocked/tiled Floyd-Warshall

The blocked variant (Proposition 6.1) processes the matrix in `β × β` tiles in three dependency phases per pivot block, reusing each tile `β` times in cache before eviction.

```go
package main

import "fmt"

const INF = 1 << 30

// blockedFW computes APSP in place on a flat n*n matrix using tile side b.
// n must be a multiple of b (pad with INF rows/cols otherwise).
func blockedFW(dist []int, n, b int) {
	at := func(i, j int) int { return i*n + j }

	// relaxTile relaxes destination tile rooted at (di,dj) using pivots
	// drawn from k in [kk, kk+b). Reads tile (di,kk..) and (kk.., dj).
	relaxTile := func(di, dj, kk int) {
		for k := kk; k < kk+b; k++ {
			for i := di; i < di+b; i++ {
				dik := dist[at(i, k)]
				if dik >= INF {
					continue
				}
				krow := k * n
				irow := i * n
				for j := dj; j < dj+b; j++ {
					if v := dik + dist[krow+j]; v < dist[irow+j] {
						dist[irow+j] = v
					}
				}
			}
		}
	}

	blocks := n / b
	for bk := 0; bk < blocks; bk++ {
		kk := bk * b
		// Phase 1: the pivot diagonal tile depends only on itself.
		relaxTile(kk, kk, kk)
		// Phase 2: pivot row and pivot column tiles depend on the pivot tile.
		for bj := 0; bj < blocks; bj++ {
			if bj != bk {
				relaxTile(kk, bj*b, kk) // pivot row block
				relaxTile(bj*b, kk, kk) // pivot column block
			}
		}
		// Phase 3: every remaining tile depends on its row & column pivots.
		for bi := 0; bi < blocks; bi++ {
			if bi == bk {
				continue
			}
			for bj := 0; bj < blocks; bj++ {
				if bj != bk {
					relaxTile(bi*b, bj*b, kk)
				}
			}
		}
	}
}

func main() {
	n, b := 4, 2
	d := []int{
		0, 3, INF, 7,
		8, 0, 2, INF,
		5, INF, 0, 1,
		2, INF, INF, 0,
	}
	blockedFW(d, n, b)
	fmt.Println(d[1*n+0]) // 5  (1->2->3->0)
}
```

The three-phase ordering encodes the layer dependency made explicit: Phase 2 may begin only after Phase 1, and Phase 3 only after Phase 2, but all tiles *within* a phase are independent and parallelizable.

### 12.2 Java — path reconstruction via the next-matrix

To recover the actual path (not just its cost), keep a `next[i][j]` matrix: the first hop on a shortest `i→j` path. On each improving relaxation, inherit `next[i][j] = next[i][k]`.

```java
import java.util.*;

public final class FloydWarshallPaths {
    static final int INF = 1 << 30;

    // dist and next are n*n; next[i][j] = first vertex after i on a shortest i->j path, or -1.
    static void run(int[] dist, int[] next, int n) {
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                next[i * n + j] = (dist[i * n + j] < INF && i != j) ? j
                                : (i == j ? i : -1);
            }
        }
        for (int k = 0; k < n; k++) {
            int krow = k * n;
            for (int i = 0; i < n; i++) {
                int dik = dist[i * n + k];
                if (dik >= INF) continue;
                int irow = i * n;
                for (int j = 0; j < n; j++) {
                    int v = dik + dist[krow + j];
                    if (v < dist[irow + j]) {
                        dist[irow + j] = v;
                        next[irow + j] = next[irow + k]; // route i->...->k->...->j
                    }
                }
            }
        }
    }

    static List<Integer> path(int[] next, int n, int u, int v) {
        if (next[u * n + v] == -1) return Collections.emptyList();
        List<Integer> p = new ArrayList<>();
        p.add(u);
        while (u != v) {
            u = next[u * n + v];
            p.add(u);
        }
        return p;
    }

    public static void main(String[] args) {
        int n = 4;
        int[] dist = {
            0, 3, INF, 7,
            8, 0, 2, INF,
            5, INF, 0, 1,
            2, INF, INF, 0
        };
        int[] next = new int[n * n];
        run(dist, next, n);
        System.out.println(path(next, n, 1, 0)); // [1, 2, 3, 0]
    }
}
```

Reconstruction is `O(path length)` per query and the `next` matrix doubles memory but keeps both build and query within the `Θ(n²)` space class (Table in §8). After a negative cycle the `next` chain can loop forever, so reconstruction must be gated on `D[i][i] >= 0` (Proposition 3.4).

### 12.3 Python — bitset transitive closure

For pure reachability, pack each row of the Boolean matrix into a Python integer (an arbitrary-width bitset). The inner `j` loop collapses to one bitwise `OR` over the whole word, giving the `Θ(n³ / w)` constant-factor win from §8.

```python
def transitive_closure_bitset(adj):
    """adj: list of n integers; bit j of adj[i] set iff edge i->j exists.
    Returns reachability rows (i can reach itself by convention)."""
    n = len(adj)
    reach = [adj[i] | (1 << i) for i in range(n)]  # include self
    for k in range(n):
        bit_k = 1 << k
        row_k = reach[k]
        for i in range(n):
            # If i reaches k, then i reaches everything k reaches.
            if reach[i] & bit_k:
                reach[i] |= row_k
    return reach


def reaches(reach, i, j):
    return (reach[i] >> j) & 1 == 1


if __name__ == "__main__":
    # 0 -> 1 -> 2 -> 3 (a chain)
    adj = [
        0b0010,  # 0 -> 1
        0b0100,  # 1 -> 2
        0b1000,  # 2 -> 3
        0b0000,  # 3 -> (none)
    ]
    r = transitive_closure_bitset(adj)
    print(reaches(r, 0, 3))  # True (0 reaches 3 via the chain)
    print(reaches(r, 3, 0))  # False
```

The whole `for j` dimension vanishes into one machine-word `OR` per `(i, k)` pair: the dominant cost becomes `n²` word operations, each covering `w` columns, so the effective work is `Θ(n³ / w)` with `w` the word width (64 on a typical machine, or arbitrary for Python big-ints amortized at `n/64` words). This is the standard way to push transitive closure on `n` in the low thousands into the millisecond range, and is the Boolean-semiring specialization of Kleene's algorithm from §5.

---

## 13. Summary

- **Definition.** Floyd-Warshall computes the min-plus closure `W*` of the weight matrix; `δ(i,j) = (W*)[i][j]`.
- **Correctness.** Induction over the intermediate set `S_k = {0,…,k-1}`: the recurrence `d_{k+1}(i,j) = min(d_k(i,j), d_k(i,k)+d_k(k,j))` is exact because, absent negative cycles, a shortest walk uses `k` at most once and splits into two `S_k`-restricted sub-walks.
- **In-place.** Overwriting one matrix is correct because the pivot row/column `k` are invariant during pass `k` (`D[k][k]=0`), and entries decrease monotonically toward `d_{k+1}`. This forces `k` to be the outermost loop.
- **Complexity.** `Θ(V³)` time in all cases, `Θ(V²)` space; no average-case speedup.
- **Semirings.** It is Kleene's closure algorithm; swapping `(min,+)` for `(OR,AND)`, `(max,min)`, `(+,×)`, etc. yields closure, bottleneck, counting, and reliability variants.
- **Cache.** Blocked / cache-oblivious variants cut I/O to `Θ(n³/(B√M))` without changing the `Θ(n³)` work.
- **Negative cycles.** Detected by `D[i][i] < 0`; results are `-∞` on affected pairs.
- **Open problems.** APSP is conjectured to need `n^{3-o(1)}`; Williams' `n³/2^{Ω(√log n)}` is the best known general bound, and tropical (min-plus) matrix product has no known subcubic algorithm — the core obstacle.

Roy (1959), Warshall (1962, transitive closure), and Floyd (1962, shortest paths) introduced the method; CLRS Chapter 25 is the canonical reference; Kleene's closure framework (Aho–Hopcroft–Ullman) explains the semiring generality; Williams (2014) and fine-grained complexity frame the open questions. The algorithm is over sixty years old, fits in three lines, and remains optimal to within sub-polynomial factors for its problem — a rare standing in algorithm design.
