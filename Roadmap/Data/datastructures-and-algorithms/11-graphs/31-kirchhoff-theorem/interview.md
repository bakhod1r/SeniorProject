# Kirchhoff's Theorem — Interview Preparation

Kirchhoff's Matrix-Tree Theorem is a favorite for interviews that probe the boundary between graph theory and linear algebra. It is compact enough to state in one sentence, deep enough to ask "why does it work," and practical enough to turn into a coding challenge (count spanning trees, count them mod p, count arborescences). This file is a curated bank of questions by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Fact | Statement |
|------|-----------|
| Laplacian | `L = D − A`; `L[i][i] = deg(i)`, `L[i][j] = −(#edges i,j)`. |
| Theorem | `τ(G) = det(L_r)` for **any** deleted row/column `r`. |
| Why "any cofactor" | `adj(L)` is a constant matrix (null space = span of `𝟙`), so all cofactors are equal. |
| Eigenvalue form | `τ(G) = (1/n)·μ₁μ₂…μ_{n−1}` (`μ₀ = 0`). |
| Cayley | `τ(K_n) = n^{n−2}`. |
| Weighted | cofactor of weighted Laplacian = `Σ_T ∏_{e∈T} w(e)`. |
| Directed | Tutte: arborescences rooted at `r` = cofactor of out-degree Laplacian (delete row/col `r`). |
| Self-loops | ignored. **Multi-edges** counted. |
| Complexity | `O(V³)` determinant. |
| Disconnected | `τ = 0` (reduced Laplacian singular). |

Build recipe (per edge `(u,v)`, `u ≠ v`):

```text
L[u][u]++;  L[v][v]++;  L[u][v]--;  L[v][u]--
reduced = delete last row and last column
answer  = determinant(reduced)
```

Arithmetic choice:

```text
tiny graph       -> float, round
exact + large    -> Bareiss big-int  or  multi-prime CRT
"answer mod p"   -> modular Gaussian elimination (Fermat inverse)
ratios/resistance-> float pseudoinverse
```

---

## Junior Questions (12 Q&A)

### J1. What does Kirchhoff's (Matrix-Tree) Theorem compute?
The number of spanning trees of a graph. A spanning tree connects all `n` vertices with exactly `n − 1` edges and no cycle. The theorem gives the exact count without enumerating any trees.

### J2. State the theorem.
Build the Laplacian `L = D − A` (degree matrix minus adjacency matrix). Delete any one row and the matching column to get the reduced Laplacian. Its determinant equals the number of spanning trees. The answer does not depend on which row/column you delete.

### J3. What is the Laplacian matrix?
`L = D − A`. On the diagonal, `L[i][i]` is the degree of vertex `i`. Off-diagonal, `L[i][j] = −(number of edges between i and j)`. Every row and every column sums to zero.

### J4. Why must you delete a row and column before taking the determinant?
Because every row of `L` sums to 0, the rows are linearly dependent, so `det(L) = 0` always. Deleting one row and the matching column removes that dependency, and the resulting `(n−1)×(n−1)` determinant becomes the meaningful count.

### J5. How do you build the Laplacian from an edge list?
Start with a zero matrix. For each edge `(u, v)` with `u ≠ v`, increment `L[u][u]` and `L[v][v]`, and decrement `L[u][v]` and `L[v][u]`. Skip self-loops.

### J6. Are self-loops and parallel edges handled?
Self-loops are **ignored** — they cannot appear in a spanning tree. Parallel (multi-) edges are **counted** — two parallel edges make `L[u][v] = −2` and increase the count.

### J7. What does a determinant of 0 mean here?
The graph is disconnected, so it has no spanning tree. The reduced Laplacian is singular, and the determinant is 0.

### J8. What is the time complexity?
`O(V³)`, dominated by computing the determinant via Gaussian elimination. Building the Laplacian is `O(m + V²)`.

### J9. What is Cayley's formula?
The complete graph `K_n` has exactly `n^{n−2}` spanning trees. It is a corollary of Kirchhoff's theorem (and is proved bijectively via Prüfer sequences — see sibling `25-prufer-code`).

### J10. Walk through the triangle example.
Triangle on `{0,1,2}`: every vertex has degree 2, so `L` has 2 on the diagonal and −1 off-diagonal. Delete row/col 2: `[[2,−1],[−1,2]]`. Determinant `= 4 − 1 = 3`. The triangle has 3 spanning trees (drop any one edge).

### J11. How is this different from Kruskal/Prim?
Kruskal and Prim (`10-mst-kruskal-prim`) **find one minimum-weight** spanning tree. Kirchhoff **counts all** spanning trees. Different goals entirely.

### J12. How would you verify your implementation?
Brute force: enumerate all `(n−1)`-edge subsets, check each is a tree with union-find, and count. Compare to the determinant for graphs up to `~7` vertices. Also check known answers: triangle = 3, `K_4` = 16, `K_5` = 125.

---

## Middle Questions (12 Q&A)

### M1. Why does deleting *any* row/column give the same answer?
The adjugate `adj(L)` satisfies `L·adj(L) = det(L)·I = 0`. Since the null space of a connected graph's Laplacian is exactly `span(𝟙)`, every column of `adj(L)` is a multiple of `𝟙`, and by symmetry every row is a multiple of `𝟙ᵀ`. The only such matrix is constant, so all cofactors (the entries of `adj(L)`) are equal.

### M2. State the eigenvalue form and why it holds.
`τ(G) = (1/n)·μ₁μ₂…μ_{n−1}` where `0 = μ₀ ≤ μ₁ ≤ … ≤ μ_{n−1}` are the Laplacian eigenvalues. The linear coefficient of the characteristic polynomial equals `(−1)^{n−1}` times the sum of the `n` principal `(n−1)`-minors; each minor is `τ(G)`, so the sum is `n·τ(G)`, matching `μ₁…μ_{n−1}`.

### M3. How do you count spanning trees for a graph with billions of trees?
The count overflows `int64` quickly (`K_20` already has `20^18`). Use exact big integers with the Bareiss fraction-free algorithm, or compute the determinant modulo a prime (and use CRT across several primes to reconstruct the true integer).

### M4. How does the modular determinant handle division?
By Fermat's little theorem, division by a pivot `b` modulo prime `p` is multiplication by `b^{p−2} mod p` (the modular inverse). Compute one inverse per pivot row, then multiply.

### M5. What is the weighted Matrix-Tree theorem?
Define a spanning tree's weight as the product of its edge weights. The cofactor of the weighted Laplacian (`L[i][i] = Σ w`, `L[i][j] = −w(i,j)`) equals the sum over all spanning trees of these products. Setting all weights to 1 recovers the count.

### M6. How do you count directed spanning trees (arborescences)?
Tutte's theorem: for arborescences oriented toward root `r`, build the out-degree Laplacian (diagonal = out-degree, off-diagonal `−(#arcs i→j)`), delete row/col `r`, take the determinant. For arborescences away from `r`, use the in-degree Laplacian.

### M7. Does the directed count depend on the root?
Yes, in general. Unlike the undirected case where every cofactor is equal, the directed cofactor depends on which root you delete. (A bidirected graph recovers root-independence.)

### M8. What is effective resistance and how is it related?
Treating edges as unit resistors, `R(s,t) = L⁺[s][s] + L⁺[t][t] − 2L⁺[s][t]` using the Laplacian pseudoinverse. It also equals (spanning forests separating `s,t`)/(spanning trees), tying it back to tree counting.

### M9. Why is the Laplacian positive-semidefinite?
Because `L = BBᵀ` for the oriented incidence matrix `B`, so `xᵀLx = ‖Bᵀx‖² ≥ 0`. All eigenvalues are non-negative; exactly one is 0 for a connected graph.

### M10. How many zero eigenvalues does the Laplacian have?
Exactly the number of connected components. One zero eigenvalue ⇒ connected. Two or more ⇒ disconnected ⇒ `τ = 0`.

### M11. When would you use the spectral form instead of the determinant?
When the graph has a known closed-form spectrum — complete graphs, cycles, hypercubes, complete bipartite, product graphs. Then you get the count from the eigenvalues directly without a determinant.

### M12. What numerical pitfalls hit the float determinant?
Tiny pivots cause large round-off; the count is correct in theory but the printed value is off. Use partial pivoting, or better, Cholesky on the SPD reduced Laplacian; switch to exact/modular arithmetic for anything beyond a tiny graph.

---

## Senior Questions (10 Q&A)

### S1. Design a service that returns exact spanning-tree counts for arbitrary graphs.
Share a Laplacian builder and row/column reduction. Behind a "precision contract" (`approx` / `mod p` / `exact`), select an arithmetic strategy: float (fast/approx), modular (exact mod p), Bareiss big-int (exact, serial), or multi-prime CRT (exact, parallel). Return metadata stating the mode and modulus so consumers never confuse approximate with exact.

### S2. How do you parallelize the exact computation of a huge count?
Multi-prime CRT: each prime's modular determinant is an independent `O(V³)` job. Fan out to a worker pool, gather `(p_k, det mod p_k)`, reconstruct via CRT once. Near-linear speedup; bounded per-prime memory.

### S3. How many primes does CRT need?
Enough that `∏ p_k > 2·|answer|`. Bound `|answer|` with Hadamard's inequality, take `log₂` for the bit-length `B`, use `⌈B/30⌉` primes near `2³⁰` so products fit 64 bits.

### S4. What makes a mod-p result silently wrong, and how do you guard?
If the true count is `≡ 0 (mod p)` or there is accidental cancellation, a single prime can mislead. Guard by cross-checking with a second prime; a mismatch is an alarm. For exact answers use enough primes via CRT.

### S5. How do you keep the float path stable for large graphs?
Mandatory partial pivoting; prefer Cholesky since the reduced Laplacian is symmetric positive-definite for a connected graph, so `det = ∏(Cholesky diagonal)²`. Clamp the smallest eigenvalue to 0 in the spectral form.

### S6. What do you instrument in production?
Per-solve latency by `V` (cubic ⇒ large graphs drive p99), arithmetic-mode counters (float on an exact endpoint is a contract violation), singular-result rate (disconnected inputs), CRT prime counts, cache hit ratio by graph hash, and periodic second-prime cross-checks.

### S7. How do you cache results safely?
Counting is deterministic in the graph, weights, and mode, so cache on a canonical hash of the edge multiset. Cache only deterministic results (mod-p/exact) — never floats, which can differ across CPUs.

### S8. Sparse, huge graph — float effective resistance vs determinant?
For resistance/ratios on a sparse Laplacian with huge `V`, use iterative Laplacian solvers (conjugate gradient, multigrid, Spielman–Teng near-linear solvers) instead of the cubic dense determinant/inverse.

### S9. Capacity for `V = 5000` mod-p?
Reduced matrix ≈ `(5000)²` words ≈ 200 MB at 8 bytes; one solve ≈ `10¹¹` modular ops ≈ tens of seconds per core. Route large graphs to a heavy pool or cache; cap `V` per request.

### S10. When is Kirchhoff the wrong tool?
When you need to *find* a (minimum) spanning tree (use Kruskal/Prim), *sample* a random spanning tree (Wilson's algorithm), or when `V` is so large that `O(V³)` is infeasible and only an estimate is needed.

---

## Professional / Theory Questions (8 Q&A)

### P1. Prove the theorem.
Write `L_r = B̂ B̂ᵀ` for the reduced incidence matrix `B̂`. By Cauchy–Binet, `det(L_r) = Σ_{|S|=n−1} det(B̂_S)²`. The unimodularity lemma gives `det(B̂_S) = ±1` if `S` is a spanning tree and `0` otherwise (a cycle in `S` makes columns dependent; a tree reduces by leaf-expansion to a smaller tree, inductively `±1`). So the sum counts spanning trees: `det(L_r) = τ(G)`.

### P2. Why is `det(B̂_S) ∈ {0, ±1}`?
A non-tree `(n−1)`-subset contains a cycle; the cycle's incidence columns are linearly dependent (entries cancel at each cycle vertex), giving determinant 0. A spanning tree has a leaf among the non-deleted vertices whose row has a single `±1`; Laplace-expanding along it and inducting on the contracted tree yields `±1`.

### P3. Derive Cayley's formula spectrally.
`L(K_n) = nI − J`. `J` has eigenvalues `n` (once) and `0` (`n−1` times), so `L` has eigenvalues `0` (once) and `n` (`n−1` times). Then `τ = (1/n)·n^{n−1} = n^{n−2}`.

### P4. State Tutte's directed theorem.
The number of arborescences rooted at `r` (edges toward `r`) equals the cofactor of the out-degree Laplacian obtained by deleting row `r` and column `r`. The proof uses an involution canceling cyclic functional-digraph selections, leaving acyclic ones (arborescences).

### P5. What is the Bareiss algorithm and why is it exact?
A fraction-free Gaussian elimination using `M^{(k)}[i][j] = (M^{(k-1)}[k][k]·M^{(k-1)}[i][j] − M^{(k-1)}[i][k]·M^{(k-1)}[k][j]) / M^{(k-2)}[k-1][k-1]`. Sylvester's identity guarantees the division is exact, so all intermediates stay integers. Cost `Θ(n³)` operations.

### P6. Bit-complexity of the exact integer determinant?
Intermediates are bounded by `n×n` minors, with bit-length `O(n log(nΔ))` by Hadamard. With fast multiplication `M(b)`, total bit cost is `O(n³·M(n log nΔ))`. CRT reduces this to `O(t·n³)` machine ops across `t = O(bits/log p)` parallel primes.

### P7. Relate `τ(G)` to the Tutte polynomial.
`τ(G) = T_G(1,1)`, the Tutte polynomial evaluated at `(1,1)`. This is one of the few exactly polynomial-time evaluations; most other points are #P-hard, which is why the Matrix-Tree theorem is special.

### P8. Can spanning trees be counted faster than `O(n³)`?
For planar graphs, nested dissection gives `O(n^{ω/2})`. In general the determinant is `O(n^ω)` with fast matrix multiplication (`ω < 2.373`), but the constants are impractical; Bareiss/CRT dominate real workloads.

---

## Behavioral Questions (5)

### B1. Tell me about a time you replaced an exponential computation with a polynomial one.
*Structure (STAR):* describe the brute-force enumeration that did not scale (Situation/Task), recognizing the count was a determinant of the Laplacian (Action), and the resulting `O(V³)` solution with exact arithmetic and regression tests against brute force (Result). Emphasize *recognizing the linear-algebra structure* behind a combinatorial problem.

### B2. Describe a bug caused by silent numerical error.
Talk about a float determinant that returned a plausible but wrong count for large graphs, how you detected it (cross-check vs a second method / known value), and the fix (switch to modular/exact arithmetic, add a precision contract). The lesson: failures that *look correct* are the dangerous ones.

### B3. How did you decide between an exact and an approximate answer?
Explain weighing the consumer's needs (reliability *ratio* tolerates float; a reported *exact count* does not), latency budget, and the cost of exact arithmetic (CRT parallelism vs big-int). Show you matched the tool to the contract, not the other way around.

### B4. Tell me about explaining a hard theorem to a teammate.
Describe breaking Kirchhoff down: the four-step recipe first, then "why any cofactor" via the null-space argument, then the proof only for those who wanted it. Tailoring depth to the audience is the point.

### B5. A time you wrote a verification harness before trusting your code.
The brute-force spanning-tree enumerator: you built it first, validated the determinant version on every small graph and known identities (Cayley), and caught a self-loop / indexing bug instantly. Emphasize "trust but verify."

---

## Coding Challenges

### Challenge 1 — Count Spanning Trees (exact, fits in int64)

**Problem.** Given an undirected graph (`n ≤ 12`), count its spanning trees exactly.

#### Go
```go
package main

import "fmt"

func countSpanningTrees(n int, edges [][2]int) int64 {
	L := make([][]float64, n)
	for i := range L {
		L[i] = make([]float64, n)
	}
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		L[u][u]++
		L[v][v]++
		L[u][v]--
		L[v][u]--
	}
	m := n - 1
	A := make([][]float64, m)
	for i := 0; i < m; i++ {
		A[i] = append([]float64(nil), L[i][:m]...)
	}
	det := 1.0
	for i := 0; i < m; i++ {
		p := i
		for r := i + 1; r < m; r++ {
			if abs(A[r][i]) > abs(A[p][i]) {
				p = r
			}
		}
		if A[p][i] == 0 {
			return 0
		}
		if p != i {
			A[i], A[p] = A[p], A[i]
			det = -det
		}
		det *= A[i][i]
		for r := i + 1; r < m; r++ {
			f := A[r][i] / A[i][i]
			for c := i; c < m; c++ {
				A[r][c] -= f * A[i][c]
			}
		}
	}
	if det < 0 {
		det = -det
	}
	return int64(det + 0.5)
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	fmt.Println(countSpanningTrees(4, [][2]int{{0, 1}, {0, 2}, {0, 3}, {1, 2}, {1, 3}, {2, 3}})) // 16
}
```

#### Java
```java
public class Challenge1 {
    static long count(int n, int[][] edges) {
        double[][] L = new double[n][n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            L[u][u]++; L[v][v]++; L[u][v]--; L[v][u]--;
        }
        int m = n - 1;
        double[][] A = new double[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = L[i][j];
        double det = 1.0;
        for (int i = 0; i < m; i++) {
            int p = i;
            for (int r = i + 1; r < m; r++)
                if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
            if (A[p][i] == 0) return 0;
            if (p != i) { double[] t = A[i]; A[i] = A[p]; A[p] = t; det = -det; }
            det *= A[i][i];
            for (int r = i + 1; r < m; r++) {
                double f = A[r][i] / A[i][i];
                for (int c = i; c < m; c++) A[r][c] -= f * A[i][c];
            }
        }
        return Math.round(Math.abs(det));
    }

    public static void main(String[] args) {
        System.out.println(count(4, new int[][]{{0,1},{0,2},{0,3},{1,2},{1,3},{2,3}})); // 16
    }
}
```

#### Python
```python
def count(n, edges):
    L = [[0.0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] += 1; L[v][v] += 1
        L[u][v] -= 1; L[v][u] -= 1
    m = n - 1
    A = [row[:m] for row in L[:m]]
    det = 1.0
    for i in range(m):
        p = max(range(i, m), key=lambda r: abs(A[r][i]))
        if A[p][i] == 0:
            return 0
        if p != i:
            A[i], A[p] = A[p], A[i]; det = -det
        det *= A[i][i]
        for r in range(i + 1, m):
            f = A[r][i] / A[i][i]
            for c in range(i, m):
                A[r][c] -= f * A[i][c]
    return round(abs(det))


print(count(4, [(0,1),(0,2),(0,3),(1,2),(1,3),(2,3)]))  # 16
```

### Challenge 2 — Count Spanning Trees mod 1e9+7

**Problem.** Same as above but the count is huge; report it modulo `1,000,000,007`.

#### Go
```go
package main

import "fmt"

const MOD = 1_000_000_007

func pw(a, b int64) int64 {
	a %= MOD
	r := int64(1)
	for b > 0 {
		if b&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		b >>= 1
	}
	return r
}

func countMod(n int, edges [][2]int) int64 {
	L := make([][]int64, n)
	for i := range L {
		L[i] = make([]int64, n)
	}
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		L[u][u]++
		L[v][v]++
		L[u][v] = (L[u][v] - 1 + MOD) % MOD
		L[v][u] = (L[v][u] - 1 + MOD) % MOD
	}
	m := n - 1
	A := make([][]int64, m)
	for i := 0; i < m; i++ {
		A[i] = append([]int64(nil), L[i][:m]...)
	}
	det := int64(1)
	for i := 0; i < m; i++ {
		p := i
		for p < m && A[p][i] == 0 {
			p++
		}
		if p == m {
			return 0
		}
		if p != i {
			A[i], A[p] = A[p], A[i]
			det = (MOD - det) % MOD
		}
		det = det * A[i][i] % MOD
		iv := pw(A[i][i], MOD-2)
		for r := i + 1; r < m; r++ {
			f := A[r][i] * iv % MOD
			for c := i; c < m; c++ {
				A[r][c] = (A[r][c] - f*A[i][c]%MOD + MOD) % MOD
			}
		}
	}
	return det
}

func main() {
	var k20 [][2]int
	for i := 0; i < 20; i++ {
		for j := i + 1; j < 20; j++ {
			k20 = append(k20, [2]int{i, j})
		}
	}
	fmt.Println(countMod(20, k20)) // 12845056
}
```

#### Java
```java
public class Challenge2 {
    static final long MOD = 1_000_000_007L;
    static long pw(long a, long b) {
        a %= MOD; long r = 1;
        while (b > 0) { if ((b & 1) == 1) r = r * a % MOD; a = a * a % MOD; b >>= 1; }
        return r;
    }
    static long countMod(int n, int[][] edges) {
        long[][] L = new long[n][n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            L[u][u]++; L[v][v]++;
            L[u][v] = (L[u][v] - 1 + MOD) % MOD;
            L[v][u] = (L[v][u] - 1 + MOD) % MOD;
        }
        int m = n - 1;
        long[][] A = new long[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = ((L[i][j] % MOD) + MOD) % MOD;
        long det = 1;
        for (int i = 0; i < m; i++) {
            int p = i;
            while (p < m && A[p][i] == 0) p++;
            if (p == m) return 0;
            if (p != i) { long[] t = A[i]; A[i] = A[p]; A[p] = t; det = (MOD - det) % MOD; }
            det = det * A[i][i] % MOD;
            long iv = pw(A[i][i], MOD - 2);
            for (int r = i + 1; r < m; r++) {
                long f = A[r][i] * iv % MOD;
                for (int c = i; c < m; c++)
                    A[r][c] = (A[r][c] - f * A[i][c] % MOD + MOD) % MOD;
            }
        }
        return det;
    }
    public static void main(String[] args) {
        int n = 20;
        java.util.List<int[]> e = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) e.add(new int[]{i, j});
        System.out.println(countMod(n, e.toArray(new int[0][]))); // 12845056
    }
}
```

#### Python
```python
MOD = 1_000_000_007

def count_mod(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] += 1; L[v][v] += 1
        L[u][v] = (L[u][v] - 1) % MOD
        L[v][u] = (L[v][u] - 1) % MOD
    m = n - 1
    A = [[L[i][j] % MOD for j in range(m)] for i in range(m)]
    det = 1
    for i in range(m):
        p = i
        while p < m and A[p][i] == 0:
            p += 1
        if p == m:
            return 0
        if p != i:
            A[i], A[p] = A[p], A[i]; det = (-det) % MOD
        det = det * A[i][i] % MOD
        iv = pow(A[i][i], MOD - 2, MOD)
        for r in range(i + 1, m):
            f = A[r][i] * iv % MOD
            for c in range(i, m):
                A[r][c] = (A[r][c] - f * A[i][c]) % MOD
    return det


k20 = [(i, j) for i in range(20) for j in range(i + 1, 20)]
print(count_mod(20, k20))  # 12845056
```

### Challenge 3 — Count Arborescences Rooted at a Vertex (Tutte)

**Problem.** Given a directed graph and root `r`, count arborescences oriented toward `r`.

#### Go
```go
package main

import "fmt"

func arborescences(n int, arcs [][2]int, root int) int64 {
	L := make([][]float64, n)
	for i := range L {
		L[i] = make([]float64, n)
	}
	for _, a := range arcs {
		u, v := a[0], a[1]
		if u == v {
			continue
		}
		L[u][u]++ // out-degree of u
		L[u][v]--
	}
	var idx []int
	for i := 0; i < n; i++ {
		if i != root {
			idx = append(idx, i)
		}
	}
	m := len(idx)
	A := make([][]float64, m)
	for i := 0; i < m; i++ {
		A[i] = make([]float64, m)
		for j := 0; j < m; j++ {
			A[i][j] = L[idx[i]][idx[j]]
		}
	}
	det := 1.0
	for i := 0; i < m; i++ {
		p := i
		for r := i + 1; r < m; r++ {
			if absf(A[r][i]) > absf(A[p][i]) {
				p = r
			}
		}
		if A[p][i] == 0 {
			return 0
		}
		if p != i {
			A[i], A[p] = A[p], A[i]
			det = -det
		}
		det *= A[i][i]
		for r := i + 1; r < m; r++ {
			f := A[r][i] / A[i][i]
			for c := i; c < m; c++ {
				A[r][c] -= f * A[i][c]
			}
		}
	}
	if det < 0 {
		det = -det
	}
	return int64(det + 0.5)
}

func absf(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	arcs := [][2]int{{0, 1}, {1, 0}, {1, 2}, {2, 1}, {0, 2}, {2, 0}}
	fmt.Println(arborescences(3, arcs, 0)) // 3
}
```

#### Java
```java
public class Challenge3 {
    static long arb(int n, int[][] arcs, int root) {
        double[][] L = new double[n][n];
        for (int[] a : arcs) {
            int u = a[0], v = a[1];
            if (u == v) continue;
            L[u][u]++; L[u][v]--;
        }
        int[] idx = new int[n - 1];
        for (int i = 0, k = 0; i < n; i++) if (i != root) idx[k++] = i;
        int m = n - 1;
        double[][] A = new double[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = L[idx[i]][idx[j]];
        double det = 1.0;
        for (int i = 0; i < m; i++) {
            int p = i;
            for (int r = i + 1; r < m; r++)
                if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
            if (A[p][i] == 0) return 0;
            if (p != i) { double[] t = A[i]; A[i] = A[p]; A[p] = t; det = -det; }
            det *= A[i][i];
            for (int r = i + 1; r < m; r++) {
                double f = A[r][i] / A[i][i];
                for (int c = i; c < m; c++) A[r][c] -= f * A[i][c];
            }
        }
        return Math.round(Math.abs(det));
    }
    public static void main(String[] args) {
        int[][] arcs = {{0,1},{1,0},{1,2},{2,1},{0,2},{2,0}};
        System.out.println(arb(3, arcs, 0)); // 3
    }
}
```

#### Python
```python
def arborescences(n, arcs, root):
    L = [[0.0] * n for _ in range(n)]
    for u, v in arcs:
        if u == v:
            continue
        L[u][u] += 1     # out-degree
        L[u][v] -= 1
    idx = [i for i in range(n) if i != root]
    m = len(idx)
    A = [[L[idx[i]][idx[j]] for j in range(m)] for i in range(m)]
    det = 1.0
    for i in range(m):
        p = max(range(i, m), key=lambda r: abs(A[r][i]))
        if A[p][i] == 0:
            return 0
        if p != i:
            A[i], A[p] = A[p], A[i]; det = -det
        det *= A[i][i]
        for r in range(i + 1, m):
            f = A[r][i] / A[i][i]
            for c in range(i, m):
                A[r][c] -= f * A[i][c]
    return round(abs(det))


arcs = [(0,1),(1,0),(1,2),(2,1),(0,2),(2,0)]
print(arborescences(3, arcs, 0))  # 3
```

### Challenge 4 — Verify Cayley's Formula

**Problem.** For `n` from 2 to 8, confirm `count(K_n) == n^{n−2}` using your Matrix-Tree implementation.

#### Python
```python
def cayley_check():
    for n in range(2, 9):
        edges = [(i, j) for i in range(n) for j in range(i + 1, n)]
        assert count(n, edges) == n ** (n - 2), n
    print("Cayley verified for n=2..8")
```

(Go and Java versions call `count`/`countMod` from Challenge 1/2 in a loop and `assert`/compare against `pow(n, n-2)`.)

---

## Common Pitfalls

- **Taking `det(L)` without deleting a row/column** — always 0.
- **Mismatched cofactor** — must delete the same index for row and column.
- **Not skipping self-loops; deduping multi-edges** — both change the count.
- **Float for large graphs** — precision loss; use modular/exact.
- **Forgetting the modular inverse** — integer division mod p is wrong; use Fermat.
- **Wrong degree in the directed case** — out-degree for arborescences toward the root, in-degree for away.
- **Treating a 0 result as a crash** — 0 means disconnected.

---

## What Interviewers Are Really Testing

- **Connecting domains:** can you see a *counting* problem as a *linear-algebra* (determinant) problem?
- **Arithmetic judgment:** do you know that floats break for large counts and reach for modular/exact arithmetic unprompted?
- **Correctness discipline:** do you build a brute-force oracle and check known identities (Cayley) instead of trusting one run?
- **Depth on demand:** can you state the theorem in one sentence, *and* explain "why any cofactor," *and* sketch the Cauchy–Binet proof if pushed?
- **Scaling sense:** do you recognize `O(V³)`, the need for CRT/parallelism on huge counts, and when an iterative sparse solver beats a dense determinant?
