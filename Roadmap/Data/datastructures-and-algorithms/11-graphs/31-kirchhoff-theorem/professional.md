# Kirchhoff's Theorem — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions — Incidence, Adjacency, Degree, Laplacian
2. The Matrix-Tree Theorem (statement)
3. Proof via Cauchy–Binet on the Reduced Incidence Matrix
4. The Eigenvalue Formula
5. Cayley's Formula as a Corollary
6. The Directed Analogue — Tutte's Theorem
7. Complexity of the Exact Determinant — Bareiss and mod-p
8. Cache Behavior and Average-Case Analysis
9. Space–Time Trade-offs
10. Comparison with Alternatives
11. Open Problems and Summary
12. Reference Code (Bareiss / mod-p, Go / Java / Python)

---

## 1. Formal Definitions — Incidence, Adjacency, Degree, Laplacian

Let `G = (V, E)` be a finite undirected multigraph with `V = {1, …, n}` and `m = |E|` edges. Self-loops are excluded (they do not occur in any spanning tree); parallel edges are permitted.

**Definition 1.1 (Adjacency matrix).** `A ∈ ℤ^{n×n}` with `A[i][j] =` the number of edges between `i` and `j` (and `A[i][i] = 0`).

**Definition 1.2 (Degree matrix).** `D ∈ ℤ^{n×n}` diagonal with `D[i][i] = deg(i) = Σ_j A[i][j]`.

**Definition 1.3 (Laplacian).** `L = D − A`. Thus `L[i][i] = deg(i)` and `L[i][j] = −A[i][j]` for `i ≠ j`. Each row and column of `L` sums to 0, so `L 𝟙 = 0` and `𝟙ᵀ L = 0` where `𝟙 = (1,…,1)ᵀ`.

**Definition 1.4 (Oriented incidence matrix).** Fix an arbitrary orientation of each edge. The incidence matrix `B ∈ ℤ^{n×m}` has, for edge `e` oriented from `tail(e)` to `head(e)`:

```
B[v][e] = +1   if v = head(e)
        = −1   if v = tail(e)
        =  0   otherwise.
```

**Lemma 1.5 (Factorization).** `L = B Bᵀ`, independent of the chosen orientation.

*Proof.* `(B Bᵀ)[i][j] = Σ_e B[i][e] B[j][e]`. For `i = j`: each edge incident to `i` contributes `(±1)² = 1`, summing to `deg(i)`. For `i ≠ j`: an edge between `i` and `j` contributes `(+1)(−1) = −1`; non-incident edges contribute 0. The sum is `−A[i][j]`. Hence `B Bᵀ = D − A = L`. ∎

A consequence: `L` is **symmetric positive-semidefinite**, since `xᵀ L x = ‖Bᵀ x‖² ≥ 0`. Its eigenvalues are real and non-negative.

**Definition 1.6 (Reduced Laplacian).** Delete row `r` and column `r` from `L` to obtain `L_r ∈ ℤ^{(n−1)×(n−1)}`. Deleting the corresponding row of `B` gives the **reduced incidence matrix** `B_r ∈ ℤ^{(n−1)×m}`, and `L_r = B_r B_rᵀ`.

**Definition 1.7 (Spanning tree).** A subset `T ⊆ E` with `|T| = n − 1` that is connected and acyclic. `τ(G)` denotes the number of spanning trees.

---

## 2. The Matrix-Tree Theorem (statement)

**Theorem 2.1 (Kirchhoff 1847).** For any connected multigraph `G` on `n ≥ 1` vertices and any `r ∈ {1, …, n}`,

```
τ(G) = det(L_r).
```

Equivalently, every `(n−1)×(n−1)` principal minor of `L` equals `τ(G)`, and more strongly every cofactor of `L` (signed minor) equals `τ(G)`; the signs conspire so that all cofactors are equal. If `G` is disconnected, `τ(G) = det(L_r) = 0`.

---

## 3. Proof via Cauchy–Binet on the Reduced Incidence Matrix

We prove `det(L_r) = τ(G)` for `r = n` (relabel otherwise). Write `B̂ = B_n` for the reduced incidence matrix (rows indexed by `1..n−1`, columns by `E`). Then `L_n = B̂ B̂ᵀ`.

**Theorem 3.1 (Cauchy–Binet).** For `B̂ ∈ ℝ^{(n−1)×m}` with `m ≥ n−1`,

```
det(B̂ B̂ᵀ) = Σ_{S} det(B̂_S)²' ... more precisely:
det(B̂ B̂ᵀ) = Σ_{S ⊆ E, |S| = n−1} det(B̂_S) · det(B̂_Sᵀ) = Σ_{S} det(B̂_S)²,
```

where `B̂_S` is the `(n−1)×(n−1)` submatrix of `B̂` formed by the columns in `S`.

Thus

```
det(L_n) = Σ_{S ⊆ E, |S| = n−1} det(B̂_S)².      (★)
```

It remains to evaluate `det(B̂_S)` for each `(n−1)`-edge subset `S`. The decisive fact:

**Lemma 3.2 (Unimodularity of incidence minors).** For `S ⊆ E` with `|S| = n − 1`:

```
det(B̂_S) = ±1   if S is a spanning tree of G,
          =  0   otherwise.
```

*Proof.*

**(a) If `S` contains a cycle**, the columns of `B̂_S` corresponding to that cycle are linearly dependent: assign `+1`/`−1` coefficients according to traversal direction around the cycle and the incidence entries cancel at every vertex (each vertex on the cycle is the head of one cycle-edge and the tail of another). A dependent column set forces `det(B̂_S) = 0`. Any `(n−1)`-edge subset that is not a spanning tree must contain a cycle (it has `n−1` edges on `n` vertices but is not connected, hence has a component with at least as many edges as vertices, i.e. a cycle), so its determinant is 0.

**(b) If `S` is a spanning tree**, we show `det(B̂_S) = ±1` by induction on `n`. A tree has a leaf `ℓ ≠ n` (a vertex of degree 1 among the tree edges; such a leaf among `1..n−1` exists because a tree on `n` vertices has at least two leaves, and at most one of them is vertex `n`). The row of `B̂_S` for `ℓ` has exactly one nonzero entry, `±1`, in the column of `ℓ`'s unique tree edge. Laplace-expand `det(B̂_S)` along that row: the determinant equals `±1` times the determinant of the matrix with `ℓ`'s row and that edge's column removed — which is the reduced incidence determinant of the tree `S` with leaf `ℓ` contracted/removed, a spanning tree on `n−1` vertices. By induction this is `±1`. The base case `n = 1` gives the empty `0×0` determinant `= 1`. Hence `det(B̂_S) = ±1`. ∎

**Conclusion.** Substituting Lemma 3.2 into (★): every spanning tree contributes `(±1)² = 1`, every non-tree contributes `0². Therefore

```
det(L_n) = Σ_{S spanning tree} 1 = τ(G).   ∎
```

The argument used `r = n` only for notational convenience; relabeling shows `det(L_r) = τ(G)` for every `r`, proving root-independence directly.

### 3.1 Worked instance of the Cauchy–Binet sum

Take the triangle `G` on `{1,2,3}` with edges `e₁ = 12`, `e₂ = 23`, `e₃ = 13`, oriented `1→2`, `2→3`, `1→3`. The incidence matrix and its reduction (deleting vertex 3) are

```
      e₁  e₂  e₃                     e₁  e₂  e₃
B = 1[ −1   0  −1 ]        B̂ = B_3 = 1[ −1   0  −1 ]
    2[ +1  −1   0 ]                 2[ +1  −1   0 ]
    3[  0  +1  +1 ]
```

The `|S| = 2` column subsets of `B̂` and their `2×2` determinants:

```
S = {e₁,e₂}: det[[−1,0],[1,−1]] = 1   (spanning tree 12,23)  → ±1
S = {e₁,e₃}: det[[−1,−1],[1,0]] = 1   (spanning tree 12,13)  → ±1
S = {e₂,e₃}: det[[0,−1],[−1,0]] = −1  (spanning tree 23,13)  → ±1
```

Each `S` here is a spanning tree, so each squared determinant is 1, and `det(L_3) = 1 + 1 + 1 = 3 = τ(G)`. This is exactly the `Σ det(B̂_S)²` of (★) made concrete. (For a graph with a 2-edge subset forming a multi-edge cycle, that subset's determinant would be 0 and drop out.)

### 3.2 The All-Minors generalization

A stronger statement (the **All-Minors Matrix-Tree Theorem**) evaluates *arbitrary* minors of `L`, not just principal ones. For row set `R` and column set `C` with `|R| = |C| = n − 1`, the minor `det(L[R, C])` is, up to a sign `(−1)^{ΣR + ΣC}`, the number of spanning **forests** with specified components — a result of great use in electrical-network theory, since off-diagonal minors of `L` encode currents. The principal case `R = C = {1,…,n}\{r}` recovers `τ(G)`. This generalization is what makes the directed proof in §6 go through and connects directly to effective resistance (a ratio of two such minors).

---

## 4. The Eigenvalue Formula

Let `0 = μ₀ ≤ μ₁ ≤ … ≤ μ_{n−1}` be the eigenvalues of `L`.

**Theorem 4.1.** `τ(G) = (1/n) · μ₁ μ₂ ⋯ μ_{n−1}`.

*Proof.* The characteristic polynomial `det(xI − L) = ∏_{k=0}^{n−1}(x − μ_k) = x ∏_{k=1}^{n−1}(x − μ_k)` since `μ₀ = 0`. The coefficient of `x¹` in `det(xI − L)` equals `(−1)^{n−1}` times the sum of all `(n−1)×(n−1)` principal minors of `L` (a standard fact: the coefficient of `x^k` in `det(xI − L)` is `(−1)^{n−k}` times the sum of the `(n−k)×(n−k)` principal minors). Each such principal minor is `det(L_r) = τ(G)` (Theorem 2.1), and there are `n` of them, so that coefficient is `(−1)^{n−1} · n · τ(G)`.

On the other hand, expanding `x ∏_{k=1}^{n−1}(x − μ_k)`, the coefficient of `x¹` is `∏_{k=1}^{n−1}(−μ_k) = (−1)^{n−1} μ₁⋯μ_{n−1}`. Equating: `(−1)^{n−1} n τ(G) = (−1)^{n−1} μ₁⋯μ_{n−1}`, hence `τ(G) = (1/n) μ₁⋯μ_{n−1}`. ∎

The multiplicity of the eigenvalue `0` equals the number of connected components; for disconnected `G` at least two eigenvalues vanish, so the product (and thus `τ`) is 0.

---

## 5. Cayley's Formula as a Corollary

**Theorem 5.1 (Cayley 1889).** `τ(K_n) = n^{n−2}`.

*Proof (spectral).* The Laplacian of `K_n` is `L = nI − J` where `J` is the all-ones matrix. `J` has eigenvalue `n` (eigenvector `𝟙`, multiplicity 1) and `0` (multiplicity `n−1`). Hence `L = nI − J` has eigenvalue `n − n = 0` (multiplicity 1) and `n − 0 = n` (multiplicity `n−1`). By Theorem 4.1:

```
τ(K_n) = (1/n) · n^{n−1} = n^{n−2}.   ∎
```

*Proof (cofactor).* `L_r = nI_{n−1} − J_{n−1}`. Using `det(nI − J) = (n − (n−1))·n^{n−2} = n^{n−2}` (eigenvalues of `J_{n−1}` are `n−1` once and `0` with multiplicity `n−2`, so `nI−J` has eigenvalues `1` and `n`): `det(L_r) = 1·n^{n−2} = n^{n−2}`. ∎

A purely combinatorial, bijective proof (Prüfer sequences) appears in the sibling topic `25-prufer-code`; it establishes a bijection between labeled trees on `n` vertices and sequences in `{1,…,n}^{n−2}`, of which there are exactly `n^{n−2}`.

---

## 6. The Directed Analogue — Tutte's Theorem

Let `G` be a directed multigraph (digraph) with arc multiplicities. An **arborescence rooted at `r` (in-tree)** is a spanning subgraph in which every vertex `≠ r` has out-degree exactly 1 within the subgraph and the unique directed paths all reach `r`; equivalently a spanning tree with all edges oriented toward `r`.

**Definition 6.1 (Directed/out Laplacian).** `L^{out}[i][i] = deg^{out}(i)`, `L^{out}[i][j] = −(#arcs i→j)` for `i ≠ j`.

**Theorem 6.2 (Tutte; directed Matrix-Tree).** The number of arborescences of `G` rooted at `r` with edges oriented toward `r` equals the cofactor obtained by deleting row `r` and column `r` from `L^{out}`:

```
arb_in(r) = det( L^{out} with row r and column r deleted ).
```

For arborescences oriented **away** from `r` (out-trees), use the **in-degree** Laplacian `L^{in}[i][i] = deg^{in}(i)`, `L^{in}[i][j] = −(#arcs i→j)`, and delete row/column `r`.

*Proof sketch.* `L^{out}` is no longer symmetric, so the Cauchy–Binet factorization `L = BBᵀ` does not apply verbatim. Instead one uses the **All-Minors Matrix-Tree** / a direct expansion: the cofactor expands as a signed sum over functional digraphs in which each non-root vertex selects one outgoing arc; cyclic selections cancel in pairs (an involution argument), leaving exactly the acyclic selections, which are precisely the arborescences toward `r`. The sign bookkeeping mirrors Lemma 3.2 but on the (now non-symmetric) reduced matrix. ∎

Unlike the undirected case, `arb_in(r)` **depends on `r`** in general. A bidirected graph (each undirected edge replaced by two opposite arcs) recovers `τ(G)` for every root.

### 6.1 The BEST theorem (Eulerian circuits) — a consequence

A celebrated corollary of the directed Matrix-Tree theorem is the **BEST theorem** (de Bruijn, van Aardenne-Ehrenfest, Smith, Tutte), which counts Eulerian circuits of a connected Eulerian digraph `G`:

```
ec(G) = arb(r) · ∏_{v} (deg^{out}(v) − 1)!,
```

where `arb(r)` is the number of arborescences rooted at any fixed `r` (the same for all `r` *in an Eulerian digraph*, where in-degree equals out-degree at every vertex). The arborescence count comes straight from Tutte's cofactor, so a single `O(V³)` determinant yields an exact Eulerian-circuit count — another exponential-looking quantity made polynomial by Kirchhoff-type algebra. This ties the topic to the sibling `12-eulerian-path-circuit`.

### 6.2 Root-independence in the Eulerian case

Why is `arb(r)` root-independent for Eulerian digraphs although the directed cofactor generally depends on `r`? Because in an Eulerian digraph `L^{out}` and `L^{in}` coincide as Laplacians with equal diagonal (in = out degree), and the Markov-chain interpretation (stationary distribution uniform on the strongly connected Eulerian graph) forces all root cofactors equal. The general digraph lacks this balance, so the dependence on `r` reappears.

---

## 7. Complexity of the Exact Determinant — Bareiss and mod-p

Computing `det(L_r)` for an integer matrix demands care: naïve fraction-based Gaussian elimination introduces rationals whose numerators/denominators blow up.

### 7.1 Bareiss fraction-free elimination

**Algorithm (Bareiss 1968).** Maintain integer entries via the recurrence

```
M^{(k)}[i][j] = ( M^{(k-1)}[k][k] · M^{(k-1)}[i][j] − M^{(k-1)}[i][k] · M^{(k-1)}[k][j] ) / M^{(k-2)}[k-1][k-1],
```

with `M^{(-1)}[·][·] := 1`. The division is **exact** at every step (a theorem of Bareiss, via Sylvester's identity for determinants of bordered minors), so all intermediates remain integers, and `det = ±M^{(n-2)}[n-1][n-1]`.

**Theorem 7.1 (Complexity).** Bareiss performs `Θ(n³)` arithmetic operations. The intermediate integers are bounded by `n×n` minors, hence by Hadamard's inequality have bit-length `O(n (log n + log ‖L‖_∞))`. With schoolbook big-integer multiply this is `O(n³ · (n log(nΔ))²)` bit operations in the worst case; with fast multiplication `M(b)`, it is `O(n³ · M(n log(nΔ)))`. For graphs where the final count fits a machine word, `int64`/`long` suffices and the cost is `Θ(n³)` machine ops.

### 7.2 Modular determinant

Pick a prime `p`. Run ordinary Gaussian elimination over `𝔽_p`, replacing division by the modular inverse (`a^{p−2} mod p`, Fermat). Cost: `Θ(n³)` modular multiplications, each `O(1)` if `p < 2^{31}` (products fit 64 bits); the `n` inverses cost `O(n log p)` total. Memory `O(n²)` words.

### 7.3 Multi-prime CRT for the exact large integer

By Hadamard, `|det(L_r)| ≤ ∏_i ‖row_i‖_2 ≤ (2Δ)^{n}` roughly, so its bit-length `B = O(n log(nΔ))`. Compute `det mod p_k` for primes `p_1, …, p_t` with `∏ p_k > 2|det|` (so `t = O(B / log p)`), then reconstruct via CRT. Total: `O(t · n³)` machine ops, **trivially parallel across the `t` primes**, and bounded memory per prime. This beats big-integer Bareiss in both speed and parallelism for large `n`.

### 7.4 Asymptotically faster determinants

Integer determinants can be computed in `O(n^ω)` operations where `ω < 2.372` is the matrix-multiplication exponent (via LU over a finite field or Storjohann's `O~(n^ω log‖A‖)` integer algorithms). These are galactic for typical sizes; Bareiss/CRT dominate practice.

---

## 8. Cache Behavior and Average-Case Analysis

### 8.1 Cache

Gaussian/Bareiss elimination on a dense `n×n` matrix touches `Θ(n³)` words with the classic triple loop. The trailing-submatrix update `A[i][j] -= f·A[k][j]` is a rank-1 update — the same memory pattern as `GEMM`. With `B`-word cache lines and a fast memory of `M` words, naïve row-major elimination incurs `Θ(n³ / B)` misses; **blocked (tiled) elimination** with tile size `Θ(√M)` reduces this to the I/O-optimal `Θ(n³ / (B√M))`, matching the Hong–Kung lower bound for matrix multiplication. In practice, calling an optimized BLAS-3 kernel for the trailing update yields order-of-magnitude speedups on large `n`.

### 8.2 Average-case

For an Erdős–Rényi random graph `G(n, q)` above the connectivity threshold (`q > (1+ε) ln n / n`), `G` is connected w.h.p. and `τ(G)` concentrates: `log τ(G) = (n−1) log(nq) − n + O(...)` w.h.p. by the spectral form (the bulk of `L`'s spectrum concentrates near `nq` by random-matrix results). The determinant computation cost is `Θ(n³)` regardless of `q` for a dense representation; the *count's magnitude* — not the runtime — is what varies.

### 8.3 Modular pivot statistics

In the **mod-p** elimination, a pivot is zero precisely when the running leading principal minor vanishes mod `p`. For a *generic* integer matrix and a random prime, `Pr[pivot ≡ 0]` is `≈ 1/p`, so over an `n×n` elimination the expected number of row swaps is `≈ n/p`, negligible for `p ≈ 2³⁰`. This is why a single well-chosen prime almost never needs a swap, and why a *spurious* singular result (true count not divisible by `p` but a leading minor is) is rare but non-zero — the justification for the second-prime cross-check in `senior.md`. For the Laplacian specifically, the structured zero row sums do **not** create extra zero pivots after reduction, because the reduced `L̂` is non-singular exactly when the graph is connected.

### 8.4 Why Bareiss avoids intermediate swell precisely

The naïve fraction-free idea — clear denominators by multiplying — produces entries that grow by a factor each step, reaching `‖L‖^{2^k}` (doubly exponential). Bareiss's exact division by the *previous pivot* is the content of **Sylvester's identity**: the `(k)`-th Bareiss entry equals a `(k+1)×(k+1)` connected minor of the original matrix, which by Hadamard is bounded *singly* exponentially (`‖L‖^{k+1}` up to combinatorial factors). Thus intermediates are bounded by the final determinant's magnitude class, not its square — the key reason Bareiss is the canonical exact-integer determinant. The bit-length stays `O(n log(nΔ))`, matching the size of the answer itself.

---

## 8b. Determinant Identities Used in Practice

Two rank-update identities recur when the Laplacian changes slightly:

**Matrix-determinant lemma.** For an invertible reduced Laplacian `L̂` and a rank-one update `L̂ + uvᵀ`:

```
det(L̂ + uvᵀ) = det(L̂) · (1 + vᵀ L̂⁻¹ u).
```

Adding or removing a single edge changes `L̂` by a rank-two symmetric update (two diagonal and two off-diagonal entries), so the new tree count is computable from the old one and `L̂⁻¹` in `O(n²)` — far cheaper than the `O(n³)` recompute. This is the basis of *dynamic* spanning-tree counting (open problem 3 below) and of the deletion–contraction identity `τ(G) = τ(G−e) + τ(G/e)` at the linear-algebra level.

---

## 9. Space–Time Trade-offs

| Method | Time (ops) | Intermediate magnitude | Memory | Exactness |
|--------|-----------|------------------------|--------|-----------|
| Float Gauss + partial pivot | `Θ(n³)` machine | bounded `float64` | `Θ(n²)` words | approximate (≤ ~15 digits) |
| Cholesky (SPD `L_r`) | `Θ(n³/3)` machine | bounded | `Θ(n²)` | approximate, more stable |
| mod-p Gauss | `Θ(n³)` machine | `< p` | `Θ(n²)` words | exact mod p |
| Bareiss (machine int) | `Θ(n³)` machine | up to det magnitude | `Θ(n²)` words | exact (if fits word) |
| Bareiss (big-int) | `Θ(n³ M(b))` | `b = O(n log nΔ)` bits | `Θ(n² · b)` bits | exact true integer |
| Multi-prime CRT | `Θ(t n³)`, parallel | `< p` per prime | `Θ(n²)` per prime | exact true integer |

The fundamental trade-off: **exactness of a huge integer costs either big-integer arithmetic (serial, memory-heavy) or many independent modular solves (parallel, bounded memory)**. CRT is the production sweet spot.

---

## 10. Comparison with Alternatives

| Task | Matrix-Tree | Alternative | Asymptotics |
|------|-------------|-------------|-------------|
| Count all spanning trees | `Θ(n³)` det | Enumeration | exponential — infeasible |
| Count for `K_n` / structured | `Θ(n³)` | Closed-form spectrum / `n^{n−2}` | `O(1)`–`O(log n)` |
| Uniform random spanning tree | normalizes distribution | Wilson's loop-erased walk | `O(mean hitting time)`, near-linear |
| Effective resistance (all pairs) | `L⁺` via `Θ(n³)` inverse | Sparse Laplacian solvers (Spielman–Teng) | `O~(m)` per solve |
| Min spanning tree | — | Kruskal/Prim (`10-mst-kruskal-prim`) | `O(m log n)` |
| Arborescence count | Tutte `Θ(n³)` | (no faster general method) | `Θ(n³)` |
| Single-edge update of `τ` | Matrix-determinant lemma `Θ(n²)` | full recompute | `Θ(n²)` vs `Θ(n³)` |
| Eulerian-circuit count | BEST + Tutte `Θ(n³)` | direct enumeration | exponential — infeasible |

The recurring theme: the determinant route turns an exponential *count* into a polynomial *algebraic* evaluation, and the only quantities with sub-cubic methods are *updates* (rank-one/-two perturbations) and *structured graphs* (closed-form spectra, planar separators).

---

## 11. Open Problems and Summary

### 11.1 Open / advanced directions

1. **Spanning-tree counting in `o(n^ω)`** for special graph classes — planar graphs admit nested-dissection determinant in `O(n^{ω/2})` ≈ `O(n^{1.18})` via separators; matching lower bounds are open.
2. **Counting spanning trees with constraints** (e.g. trees avoiding a forbidden set, degree-constrained) — most variants are #P-hard; the boundary of tractability is not fully mapped.
3. **Dynamic spanning-tree counting** under edge insertions/deletions — maintaining `det(L_r)` faster than recomputation; rank-one Laplacian updates allow `O(n²)` per update via the matrix-determinant lemma, but `o(n²)` is open in general.
4. **Numerically certified counts** — verifying a floating-point determinant equals the true integer with a provable bound, avoiding full exact arithmetic.
5. **Counting forests and the Tutte polynomial** — `τ(G)` is the value `T_G(1,1)` of the Tutte polynomial; computing other points is #P-hard, and the Matrix-Tree theorem is the rare exactly-tractable evaluation.

6. **Spanning trees with a degree constraint at one vertex** — generating-function refinements of the Laplacian (weighting incident edges by a formal variable) give the distribution of a chosen vertex's degree across spanning trees in `O(n³)`; multi-vertex joint distributions quickly become intractable.

7. **Random spanning-tree sampling vs counting** — Wilson's algorithm samples uniformly in near-linear expected time without ever computing `τ`. Whether *approximate counting* can match that near-linear cost for all graphs (it can for many via determinant estimation / random projections) is an active question bridging this topic and randomized linear algebra.

### 11.3 Historical and complexity placement

| Result | Author(s), year | Significance |
|--------|-----------------|--------------|
| Matrix-Tree theorem | Kirchhoff, 1847 | spanning-tree count = Laplacian cofactor |
| Labeled-tree count | Cayley, 1889 | `τ(K_n) = n^{n−2}` |
| Cauchy–Binet | Cauchy 1812 / Binet 1812 | the determinant-of-product identity powering the proof |
| Directed Matrix-Tree | Tutte, 1948 | arborescence count via out/in Laplacian |
| BEST theorem | de Bruijn–van A.E.–Smith–Tutte, 1951 | Eulerian-circuit count from arborescences |
| Fraction-free elimination | Bareiss, 1968 | exact integer determinant in `Θ(n³)` ops |
| Tutte-polynomial #P-hardness | Jaeger–Vertigan–Welsh, 1990 | most evaluations hard; `(1,1)` is special |

The Matrix-Tree theorem is the canonical example in computational complexity of a counting problem that *looks* #P-hard (counting an exponential set of objects) yet sits in **P** via a determinant — a structural accident that does not extend to most neighboring counting problems (perfect matchings of general graphs, proper colorings, independent sets), which are #P-hard.

### 11.2 Summary

- **Definitions.** `L = D − A = B Bᵀ` is symmetric positive-semidefinite with zero row/column sums; `B` is the oriented incidence matrix.
- **Theorem.** `τ(G) = det(L_r)` for any `r` (Theorem 2.1), proved by **Cauchy–Binet** `det(L_r) = Σ_S det(B̂_S)²` combined with the **unimodularity lemma** `det(B̂_S) ∈ {0, ±1}` (`±1` iff `S` is a spanning tree).
- **Spectral form.** `τ(G) = (1/n) μ₁⋯μ_{n−1}`, from the linear coefficient of the characteristic polynomial.
- **Cayley.** `τ(K_n) = n^{n−2}` via `L = nI − J` having eigenvalue `n` with multiplicity `n−1`.
- **Directed.** Tutte's theorem counts arborescences via the out-/in-degree Laplacian cofactor; the count depends on the root.
- **Complexity.** Bareiss gives an exact `Θ(n³)`-operation fraction-free determinant; mod-p is `Θ(n³)` machine ops; **multi-prime CRT** reconstructs the true large integer with bounded per-prime memory and full parallelism. Faster `O(n^ω)` and planar `O(n^{ω/2})` methods exist but are rarely practical.

Kirchhoff (1847) tied spanning trees to electrical networks; Cauchy–Binet supplies the modern proof; Cayley (1889) and Tutte give the complete-graph and directed corollaries; Bareiss (1968) made the determinant exactly integer. The result is the canonical example of a #P-hard-looking counting problem that is, in fact, polynomial.

---

## 12. Reference Code (Bareiss / mod-p)

Exact spanning-tree count via **Bareiss fraction-free** elimination with arbitrary-precision integers. Verified: `K6 = 1296`, `K20 = 262144000000000000000000 = 20^18`.

#### Go

```go
package main

import (
	"fmt"
	"math/big"
)

func bareissCount(n int, edges [][2]int) *big.Int {
	L := make([][]*big.Int, n)
	for i := range L {
		L[i] = make([]*big.Int, n)
		for j := range L[i] {
			L[i][j] = big.NewInt(0)
		}
	}
	one := big.NewInt(1)
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		L[u][u].Add(L[u][u], one)
		L[v][v].Add(L[v][v], one)
		L[u][v].Sub(L[u][v], one)
		L[v][u].Sub(L[v][u], one)
	}
	m := n - 1
	A := make([][]*big.Int, m)
	for i := 0; i < m; i++ {
		A[i] = make([]*big.Int, m)
		for j := 0; j < m; j++ {
			A[i][j] = new(big.Int).Set(L[i][j])
		}
	}
	sign := big.NewInt(1)
	prev := big.NewInt(1)
	for k := 0; k < m-1; k++ {
		if A[k][k].Sign() == 0 { // pivot swap
			sw := -1
			for i := k + 1; i < m; i++ {
				if A[i][k].Sign() != 0 {
					sw = i
					break
				}
			}
			if sw == -1 {
				return big.NewInt(0) // singular -> disconnected
			}
			A[k], A[sw] = A[sw], A[k]
			sign.Neg(sign)
		}
		for i := k + 1; i < m; i++ {
			for j := k + 1; j < m; j++ {
				t := new(big.Int).Mul(A[i][j], A[k][k])
				t.Sub(t, new(big.Int).Mul(A[i][k], A[k][j]))
				t.Quo(t, prev) // exact division (Bareiss)
				A[i][j] = t
			}
		}
		prev = A[k][k]
	}
	res := new(big.Int).Mul(sign, A[m-1][m-1])
	return res.Abs(res)
}

func complete(k int) [][2]int {
	var e [][2]int
	for i := 0; i < k; i++ {
		for j := i + 1; j < k; j++ {
			e = append(e, [2]int{i, j})
		}
	}
	return e
}

func main() {
	fmt.Println("K6  =", bareissCount(6, complete(6)))   // 1296
	fmt.Println("K20 =", bareissCount(20, complete(20))) // 20^18
}
```

#### Java

```java
import java.math.BigInteger;
import java.util.*;

public class Bareiss {
    static BigInteger bareissCount(int n, int[][] edges) {
        BigInteger[][] L = new BigInteger[n][n];
        for (BigInteger[] row : L) Arrays.fill(row, BigInteger.ZERO);
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            L[u][u] = L[u][u].add(BigInteger.ONE);
            L[v][v] = L[v][v].add(BigInteger.ONE);
            L[u][v] = L[u][v].subtract(BigInteger.ONE);
            L[v][u] = L[v][u].subtract(BigInteger.ONE);
        }
        int m = n - 1;
        BigInteger[][] A = new BigInteger[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = L[i][j];

        BigInteger sign = BigInteger.ONE, prev = BigInteger.ONE;
        for (int k = 0; k < m - 1; k++) {
            if (A[k][k].signum() == 0) {
                int sw = -1;
                for (int i = k + 1; i < m; i++)
                    if (A[i][k].signum() != 0) { sw = i; break; }
                if (sw == -1) return BigInteger.ZERO;
                BigInteger[] t = A[k]; A[k] = A[sw]; A[sw] = t;
                sign = sign.negate();
            }
            for (int i = k + 1; i < m; i++)
                for (int j = k + 1; j < m; j++)
                    A[i][j] = A[i][j].multiply(A[k][k])
                                     .subtract(A[i][k].multiply(A[k][j]))
                                     .divide(prev);     // exact (Bareiss)
            prev = A[k][k];
        }
        return sign.multiply(A[m - 1][m - 1]).abs();
    }

    static int[][] complete(int k) {
        List<int[]> e = new ArrayList<>();
        for (int i = 0; i < k; i++)
            for (int j = i + 1; j < k; j++) e.add(new int[]{i, j});
        return e.toArray(new int[0][]);
    }

    public static void main(String[] args) {
        System.out.println("K6  = " + bareissCount(6, complete(6)));   // 1296
        System.out.println("K20 = " + bareissCount(20, complete(20))); // 20^18
    }
}
```

#### Python

```python
def bareiss_count(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] += 1; L[v][v] += 1
        L[u][v] -= 1; L[v][u] -= 1

    m = n - 1
    A = [row[:m] for row in L[:m]]
    sign, prev = 1, 1
    for k in range(m - 1):
        if A[k][k] == 0:
            sw = next((i for i in range(k + 1, m) if A[i][k] != 0), -1)
            if sw == -1:
                return 0                       # singular -> disconnected
            A[k], A[sw] = A[sw], A[k]; sign = -sign
        for i in range(k + 1, m):
            for j in range(k + 1, m):
                A[i][j] = (A[i][j] * A[k][k] - A[i][k] * A[k][j]) // prev  # exact
        prev = A[k][k]
    return abs(sign * A[m - 1][m - 1])


if __name__ == "__main__":
    complete = lambda k: [(i, j) for i in range(k) for j in range(i + 1, k)]
    print("K6  =", bareiss_count(6, complete(6)))    # 1296
    print("K20 =", bareiss_count(20, complete(20)))  # 20**18
```

**What it does:** computes the spanning-tree count exactly as a big integer using Bareiss fraction-free elimination — no rationals, no precision loss.
**Run:** `go run main.go` | `javac Bareiss.java && java Bareiss` | `python bareiss.py`

### 12.1 Implementation notes

- **Pivot swaps in Bareiss** must still divide by the *previous pivot*; do not reset `prev` to 1 after a swap — the Sylvester identity tracks the previous *leading* pivot regardless of the row permutation, and the accumulated `sign` records parity.
- **Exact division `Quo`/`divide`** is mandatory; if your big-integer library's default division truncates, the result is silently wrong. The Bareiss invariant guarantees the remainder is exactly zero, so a non-zero remainder is an assertion-worthy bug.
- **`n = 1`** yields a `0×0` reduced matrix; return 1 (the empty product / empty tree). Guard before entering the loop.
- **Disconnected detection** falls out naturally: a fully-zero pivot column makes the determinant 0, matching `τ = 0`.
- **Choosing mod-p vs Bareiss vs CRT** at runtime: if the Hadamard bound on bit-length is below 63, `int64` Bareiss is fastest; otherwise prefer CRT (parallel) over big-int Bareiss (serial) for large `n`.

These five notes are the difference between a textbook snippet and a kernel you can trust in a counting service.
