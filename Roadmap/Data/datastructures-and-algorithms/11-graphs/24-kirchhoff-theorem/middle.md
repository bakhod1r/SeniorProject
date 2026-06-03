# Kirchhoff's Theorem — Middle Level

> **One-line summary:** Beyond "build the Laplacian, take a cofactor," the middle level explains *why any cofactor works* and *why the eigenvalue product divided by n gives the same number*, then extends the theorem to weighted spanning-tree sums, directed arborescences (Tutte), modular determinants for astronomically large counts, and effective resistance in electrical networks.

---

## Table of Contents

1. [Recap and Framing](#recap-and-framing)
2. [Why Any Cofactor Gives the Same Answer](#why-any-cofactor-gives-the-same-answer)
3. [The Eigenvalue Form](#the-eigenvalue-form)
4. [Comparison: Matrix-Tree vs Brute Force vs Prüfer](#comparison-matrix-tree-vs-brute-force-vs-prüfer)
5. [Advanced Pattern — Weighted Spanning-Tree Count](#advanced-pattern--weighted-spanning-tree-count)
6. [Advanced Pattern — Directed Arborescences (Tutte)](#advanced-pattern--directed-arborescences-tutte)
7. [Advanced Pattern — Modular Determinant for Huge Counts](#advanced-pattern--modular-determinant-for-huge-counts)
8. [Advanced Pattern — Effective Resistance](#advanced-pattern--effective-resistance)
9. [Code: Modular Determinant Version (Go / Java / Python)](#code-modular-determinant-version)
10. [Performance Analysis](#performance-analysis)
11. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
12. [Best Practices](#best-practices)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Recap and Framing

At the junior level we learned the recipe: build the Laplacian `L = D − A`, delete one row and the matching column, take the determinant — that is the number of spanning trees. We also saw the eigenvalue form `(1/n)·∏λᵢ` and Cayley's `n^(n−2)`.

The middle level answers the questions a thoughtful engineer asks next:

1. *Why* does deleting **any** row/column give the same number? (Linear-algebra reason, not magic.)
2. *Why* does the eigenvalue product over `n` equal the same count?
3. How do I extend the theorem to **weighted** graphs and **directed** graphs?
4. The count for a 30-vertex graph overflows every integer type — how do I compute it **modulo a prime**?
5. The Laplacian also computes **effective resistance** in an electrical network — how, and why is that the same matrix?

We carry the verified `O(V³)` determinant from junior level and make its arithmetic exact and modular.

---

## Why Any Cofactor Gives the Same Answer

The Laplacian `L` has a special structure: **every row sums to 0 and every column sums to 0.** Call the all-ones vector `𝟙`. Then `L·𝟙 = 0` (rows sum to zero) and `𝟙ᵀ·L = 0` (columns sum to zero). So `𝟙` is a right *and* left null vector, and `det(L) = 0`.

Now consider the **adjugate (classical adjoint)** matrix `adj(L)`, whose `(i, j)` entry is the signed `(j, i)` cofactor. A standard identity gives `L · adj(L) = det(L) · I = 0`. Because the null space of `L` is exactly the span of `𝟙` (for a connected graph the rank is `n − 1`), every column of `adj(L)` must be a multiple of `𝟙`. By the symmetric argument on rows, every row of `adj(L)` is a multiple of `𝟙ᵀ`. The only matrices that are simultaneously "all columns ∝ 𝟙" and "all rows ∝ 𝟙ᵀ" are **constant matrices**: `adj(L) = c · J`, where `J` is all-ones.

Each entry of `adj(L)` is `± (a cofactor of L)`. Since they are all equal to the same constant `c`, **every cofactor of `L` has the same absolute value.** That common value is the spanning-tree count. This is exactly why the theorem says "any cofactor" — the algebra forces them to agree, you are not free to get a different answer.

The sign bookkeeping (why the signs line up so the cofactors are equal and positive) is handled cleanly by the Cauchy–Binet proof in `professional.md`. For the middle level, the null-space argument is the intuition worth carrying.

---

## The Eigenvalue Form

`L` is a real **symmetric, positive-semidefinite** matrix (it equals `B·Bᵀ` for an incidence matrix `B`, so all eigenvalues are `≥ 0`). Order its eigenvalues:

```
0 = λ₀ ≤ λ₁ ≤ λ₂ ≤ … ≤ λ_{n−1}.
```

The smallest, `λ₀`, is always `0` with eigenvector `𝟙`. For a **connected** graph exactly one eigenvalue is zero (the multiplicity of the zero eigenvalue equals the number of connected components — this is why a disconnected graph has count 0).

**Claim.** `number of spanning trees = (1/n) · λ₁ · λ₂ · … · λ_{n−1}`.

**Why.** The product of *all* `n` eigenvalues is `det(L) = 0` (because `λ₀ = 0`), which is useless. But the spanning-tree count `τ(G)` equals any cofactor, and there is a clean spectral identity:

```
sum of all (n) principal cofactors = sum of products of the eigenvalues taken (n−1) at a time
                                    = λ₁λ₂…λ_{n−1}      (the only nonzero such product, since λ₀ = 0).
```

Each principal cofactor equals `τ(G)` and there are `n` of them, so their sum is `n·τ(G)`. Therefore `n·τ(G) = λ₁λ₂…λ_{n−1}`, giving the formula. This view is powerful for graphs whose Laplacian spectrum is known in closed form — for example the complete graph `K_n` has eigenvalues `0` and `n` (with multiplicity `n−1`), so

```
τ(K_n) = (1/n) · n^(n−1) = n^(n−2)   — Cayley's formula, again.
```

The cycle `C_n`, the hypercube `Q_d`, complete bipartite `K_{a,b}`, and many product graphs have known spectra, yielding instant closed-form tree counts.

### Worked eigenvalue example — the cycle `C_4`

The cycle `C_4` (vertices `0–1–2–3–0`) has Laplacian eigenvalues `2 − 2cos(2πk/4)` for `k = 0,1,2,3`, i.e. `0, 2, 4, 2`. The non-zero ones are `{2, 4, 2}`, so

```
τ(C_4) = (1/4) · (2 · 4 · 2) = 16/4 = 4.
```

Indeed a 4-cycle has exactly 4 spanning trees — drop any one of its 4 edges. The general cycle `C_n` has eigenvalues `2 − 2cos(2πk/n)`, and the product of the nonzero ones over `n` collapses to exactly `n`, recovering "a cycle has `n` spanning trees" with no determinant at all.

### Closed-form spectra worth memorizing

| Graph | Nonzero Laplacian eigenvalues | `τ` |
|-------|-------------------------------|-----|
| `K_n` | `n` (mult. `n−1`) | `n^{n−2}` |
| `C_n` (cycle) | `2 − 2cos(2πk/n)`, `k=1..n−1` | `n` |
| `K_{a,b}` | `a` (mult `b−1`), `b` (mult `a−1`), `a+b` (once) | `a^{b−1} b^{a−1}` |
| Hypercube `Q_d` | `2k` with multiplicity `C(d,k)`, `k=1..d` | `2^{2^d − d − 1} · ∏_{k=1}^d k^{C(d,k)}` |
| Path `P_n` | `2 − 2cos(πk/n)`, `k=1..n−1` | `1` |

These let you sanity-check any implementation instantly without brute force.

---

## Comparison: Matrix-Tree vs Brute Force vs Prüfer

| Approach | Works on | Time | Output | Notes |
|----------|----------|------|--------|-------|
| **Brute-force enumeration** | Any graph | `O(C(m, n−1) · m·α)` — exponential | Count *and* a list of trees | Only viable for `n ≤ ~10`. Use it to *test* the others. |
| **Matrix-Tree (Kirchhoff)** | Any (multi-)graph, weighted, directed | `O(V³)` | Exact count (or weighted sum) | The general workhorse. Needs exact/modular arithmetic for big counts. |
| **Prüfer code / Cayley** | Complete graph `K_n` (and labeled-tree families) | `O(1)` formula `n^(n−2)` | Count, via bijection | See sibling `25-prufer-code`. Only the complete-graph special case; not general. |
| **Spectral (eigenvalue) form** | Graphs with known spectrum | `O(V³)` to compute eigenvalues, or `O(1)` if spectrum is known | Exact count | Best when the spectrum is closed-form (`K_n`, `C_n`, hypercube, products). |

**Rule of thumb:**

- Need the count for an *arbitrary* graph? → Matrix-Tree.
- Graph is the complete graph (or a structured family with a known Prüfer-style bijection)? → the formula, instantly.
- Graph has a closed-form spectrum? → eigenvalue product, no determinant needed.
- `n` tiny and you also want the actual trees? → brute force.

---

## Advanced Pattern — Weighted Spanning-Tree Count

In a **weighted** graph, define the *weight of a spanning tree* as the **product** of its edge weights. The weighted Matrix-Tree Theorem computes the **sum over all spanning trees of these products**:

```
Σ_{T spanning tree}  ∏_{e ∈ T} w(e)  =  any cofactor of the weighted Laplacian.
```

The weighted Laplacian is built the same way, using weights instead of unit counts:

- `L[i][i] = Σ_{j} w(i, j)` (sum of weights of edges incident to `i`),
- `L[i][j] = −w(i, j)` for `i ≠ j`.

Setting all weights to `1` recovers the unweighted count. This is exactly how electrical networks (next section) and statistical-physics partition functions are computed: the "weight" is a conductance or a Boltzmann factor.

**Worked check (triangle with weights `a, b, c`).** Spanning trees are the three edge-pairs, so the sum is `ab + bc + ca`. With `a=2, b=3, c=5` that is `6 + 15 + 10 = 31` — which our code reproduces exactly.

```python
from fractions import Fraction

def weighted_count(n, wedges):
    L = [[Fraction(0)] * n for _ in range(n)]
    for u, v, w in wedges:
        if u == v:
            continue
        L[u][u] += w; L[v][v] += w
        L[u][v] -= w; L[v][u] -= w
    M = [row[:-1] for row in L[:-1]]      # reduced Laplacian
    return det_fraction(M)                # exact rational determinant
```

Using `Fraction` keeps the answer exact even when weights are fractional.

---

## Advanced Pattern — Directed Arborescences (Tutte)

For a **directed** graph, the analogue counts **arborescences**: directed spanning trees in which every edge points toward (or away from) a fixed **root**. **Tutte's theorem** (the directed Matrix-Tree theorem) says:

> The number of arborescences **rooted at `r`** (edges oriented toward `r`, i.e. every non-root vertex has exactly one outgoing edge on a path to `r`) equals the cofactor obtained by deleting row `r` and column `r` from the **out-degree Laplacian** `L_out`, where
>
> - `L_out[i][i] = out-degree of i`,
> - `L_out[i][j] = −(number of arcs i → j)`.

For arborescences oriented **away** from the root, use the **in-degree Laplacian** (diagonal = in-degree, off-diagonal `−(#arcs i→j)`) and delete the root's row/column. The key differences from the undirected case:

- The matrix is **not symmetric** — you must use the correct (in vs out) degree on the diagonal for the orientation you want.
- The answer **depends on the root** in general (unlike the undirected cofactor, which is root-independent).
- A bidirected graph (every undirected edge replaced by two opposite arcs) reduces, for any root, back to the undirected spanning-tree count.

**Verified example.** A bidirected triangle has 3 arborescences rooted at each vertex — matching the undirected triangle's 3 spanning trees, confirmed against brute force in our tests.

**Worked trace (toward root 0).** Take the bidirected triangle with arcs in both directions on `{0,1,2}`. Out-degree of each vertex is 2, so

```
L^out = [  2  -1  -1 ]
        [ -1   2  -1 ]
        [ -1  -1   2 ]
```

Delete row/col 0 (the root): `[[2,−1],[−1,2]]`, determinant `4 − 1 = 3`. Three arborescences point toward vertex 0 — each non-root vertex picks one of its two outgoing arcs such that both paths reach 0 acyclically. The asymmetry only shows up when the digraph is *not* bidirected: give vertex 1 only the arc `1→0` (remove `1→2`) and the count toward 0 changes while the count toward 2 may drop to 0 if some vertex can no longer reach the root.

```python
def count_arborescences(n, arcs, root):
    """Arborescences oriented toward `root`: out-degree Laplacian, delete root row/col."""
    L = [[0] * n for _ in range(n)]
    for u, v in arcs:
        if u == v:
            continue
        L[u][u] += 1       # out-degree of u
        L[u][v] -= 1
    idx = [i for i in range(n) if i != root]
    M = [[L[i][j] for j in idx] for i in idx]
    return det_int(M)
```

---

## Advanced Pattern — Modular Determinant for Huge Counts

Spanning-tree counts grow explosively. `K_20` has `20^18 ≈ 2.6 × 10^23` trees — beyond `int64`. Two exact options:

1. **Big integers** (Python's native `int`, Java `BigInteger`, Go `math/big`) with the **Bareiss fraction-free** algorithm so every intermediate stays an exact integer. `O(V³)` multiplications on growing big integers — see `professional.md`.
2. **Compute the answer modulo a prime `p`** (commonly `p = 1e9 + 7`). This is the competitive-programming standard: the determinant via Gaussian elimination, using **modular inverse** for division. `O(V³)` machine-word operations — the fastest exact-enough option when the problem asks for "answer mod p."

For the modular version, division `a / b` becomes `a · b^(p−2) mod p` (Fermat's little theorem). Care: if a pivot is `0 mod p`, swap rows; only declare singular when an entire column is zero mod `p`.

**Big counts beyond a single prime.** If you need the *true* large integer but mod-p is faster, compute the determinant modulo several primes and reconstruct with the **Chinese Remainder Theorem (CRT)** — covered in `senior.md` under large-scale computation.

---

## Advanced Pattern — Effective Resistance

Kirchhoff studied the Laplacian because it *is* the matrix of an electrical network: treat each edge as a unit (or weighted) resistor. The **effective resistance** `R(s, t)` between two nodes — the resistance an ohmmeter would read — is computed from the Laplacian's **pseudoinverse** `L⁺`:

```
R(s, t) = L⁺[s][s] + L⁺[t][t] − 2·L⁺[s][t].
```

There is a gorgeous bridge to tree counting (the *weighted Matrix-Tree theorem* in disguise):

```
R(s, t) = (number of spanning forests with s, t in different components)  /  (number of spanning trees).
```

So the same Laplacian both *counts* spanning trees (via a cofactor) and *measures* resistance (via its pseudoinverse). Effective resistance underlies network-reliability metrics, graph sparsification, and random-walk hitting times — all explored further in `senior.md`. The intuition Kirchhoff had in 1847: grounding one node (deleting its row/column) is exactly what makes the circuit's equations solvable, and the determinant of the grounded system counts the spanning trees.

---

## Code: Modular Determinant Version

We compute the spanning-tree count **modulo `p = 1,000,000,007`** so it works for arbitrarily large graphs. Division uses the modular inverse. All three print `K5 = 125` and `K20 mod p = 12845056` (which equals `20^18 mod p`, verified).

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func power(a, b, mod int64) int64 {
	a %= mod
	res := int64(1)
	for b > 0 {
		if b&1 == 1 {
			res = res * a % mod
		}
		a = a * a % mod
		b >>= 1
	}
	return res
}

func inv(a int64) int64 { return power(a, MOD-2, MOD) }

// countSpanningTreesMod returns the spanning-tree count mod p.
func countSpanningTreesMod(n int, edges [][2]int) int64 {
	L := make([][]int64, n)
	for i := range L {
		L[i] = make([]int64, n)
	}
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		L[u][u] = (L[u][u] + 1) % MOD
		L[v][v] = (L[v][v] + 1) % MOD
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
		iv := inv(A[i][i])
		for r := i + 1; r < m; r++ {
			f := A[r][i] * iv % MOD
			if f != 0 {
				for c := i; c < m; c++ {
					A[r][c] = (A[r][c] - f*A[i][c]%MOD + MOD) % MOD
				}
			}
		}
	}
	return det % MOD
}

func main() {
	complete := func(n int) [][2]int {
		var e [][2]int
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				e = append(e, [2]int{i, j})
			}
		}
		return e
	}
	fmt.Println("K5  =", countSpanningTreesMod(5, complete(5)))   // 125
	fmt.Println("K20 =", countSpanningTreesMod(20, complete(20))) // 12845056
}
```

#### Java

```java
import java.util.*;

public class KirchhoffMod {
    static final long MOD = 1_000_000_007L;

    static long power(long a, long b) {
        a %= MOD; long r = 1;
        while (b > 0) {
            if ((b & 1) == 1) r = r * a % MOD;
            a = a * a % MOD; b >>= 1;
        }
        return r;
    }
    static long inv(long a) { return power(a, MOD - 2); }

    static long countSpanningTreesMod(int n, int[][] edges) {
        long[][] L = new long[n][n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            L[u][u] = (L[u][u] + 1) % MOD;
            L[v][v] = (L[v][v] + 1) % MOD;
            L[u][v] = (L[u][v] - 1 + MOD) % MOD;
            L[v][u] = (L[v][u] - 1 + MOD) % MOD;
        }
        int m = n - 1;
        long[][] A = new long[m][m];
        for (int i = 0; i < m; i++) A[i] = Arrays.copyOf(L[i], m);

        long det = 1;
        for (int i = 0; i < m; i++) {
            int p = i;
            while (p < m && A[p][i] == 0) p++;
            if (p == m) return 0;
            if (p != i) { long[] t = A[i]; A[i] = A[p]; A[p] = t; det = (MOD - det) % MOD; }
            det = det * A[i][i] % MOD;
            long iv = inv(A[i][i]);
            for (int r = i + 1; r < m; r++) {
                long f = A[r][i] * iv % MOD;
                if (f != 0)
                    for (int c = i; c < m; c++)
                        A[r][c] = (A[r][c] - f * A[i][c] % MOD + MOD) % MOD;
            }
        }
        return det % MOD;
    }

    static int[][] complete(int n) {
        List<int[]> e = new ArrayList<>();
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                e.add(new int[]{i, j});
        return e.toArray(new int[0][]);
    }

    public static void main(String[] args) {
        System.out.println("K5  = " + countSpanningTreesMod(5, complete(5)));   // 125
        System.out.println("K20 = " + countSpanningTreesMod(20, complete(20))); // 12845056
    }
}
```

#### Python

```python
MOD = 1_000_000_007

def count_spanning_trees_mod(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] = (L[u][u] + 1) % MOD
        L[v][v] = (L[v][v] + 1) % MOD
        L[u][v] = (L[u][v] - 1) % MOD
        L[v][u] = (L[v][u] - 1) % MOD

    m = n - 1
    A = [row[:m] for row in L[:m]]
    det = 1
    for i in range(m):
        p = i
        while p < m and A[p][i] == 0:
            p += 1
        if p == m:
            return 0
        if p != i:
            A[i], A[p] = A[p], A[i]
            det = (-det) % MOD
        det = det * A[i][i] % MOD
        iv = pow(A[i][i], MOD - 2, MOD)         # modular inverse (Fermat)
        for r in range(i + 1, m):
            f = A[r][i] * iv % MOD
            if f:
                row_i, row_r = A[i], A[r]
                for c in range(i, m):
                    row_r[c] = (row_r[c] - f * row_i[c]) % MOD
    return det % MOD


if __name__ == "__main__":
    complete = lambda k: [(i, j) for i in range(k) for j in range(i + 1, k)]
    print("K5  =", count_spanning_trees_mod(5, complete(5)))    # 125
    print("K20 =", count_spanning_trees_mod(20, complete(20)))  # 12845056
```

**What it does:** counts spanning trees modulo a prime, using modular inverse for the pivot division — exact for arbitrarily large true counts.
**Run:** `go run main.go` | `javac KirchhoffMod.java && java KirchhoffMod` | `python kirchhoff_mod.py`

---

## Performance Analysis

| Variant | Arithmetic | Time | Notes |
|---------|-----------|------|-------|
| Float Gaussian elimination | `float64` | `O(V³)` machine ops | Fast but inexact for large counts; rounding error grows. |
| Modular Gaussian elimination | `int mod p` | `O(V³)` machine ops | Each op is `O(1)`; modular inverse is `O(log p)` but called only once per pivot row → `O(V·log p)` extra. The practical default for large graphs. |
| Bareiss (fraction-free) over `int64` | exact integer | `O(V³)` ops | Stays integer without overflow *only* if the final count fits in `int64`. |
| Bareiss over big integers | exact big-int | `O(V³ · M(b))` | `M(b)` = cost of multiplying `b`-bit numbers; `b` grows to `O(V·log V)` bits. The price of the exact huge answer. |
| Eigenvalue product | float | `O(V³)` | Needs a symmetric eigensolver; numerically delicate near the zero eigenvalue. |

**Key takeaways:**

- The determinant is always the `O(V³)` bottleneck; building the Laplacian (`O(m + V²)`) is cheap by comparison.
- The modular invariant keeps every number bounded by `p`, so memory is `O(V²)` machine words regardless of how large the true count is.
- Avoid recomputing modular inverses inside the inner loop: compute `iv = inverse(pivot)` once per row, then multiply.
- For *dense* graphs the Laplacian is dense anyway, so `O(V³)` is unavoidable; sparse-matrix tricks help only for the eigenvalue route on sparse graphs.

---

## Edge Cases & Pitfalls

- **Disconnected graph** → count `0`; both the determinant and the eigenvalue form return `0` (a second zero eigenvalue appears).
- **Negative entries mod p** → always normalize with `(x % MOD + MOD) % MOD`; an unnormalized negative breaks later comparisons to `0`.
- **Pivot `0 mod p` by coincidence** → swap rows; do **not** conclude singular until the whole sub-column is zero mod `p`. (A nonzero true value can be `0 mod p` for a bad prime — use a different prime, or CRT.)
- **Directed graphs** → use in- vs out-degree Laplacian deliberately; the answer depends on the root and on orientation. Mixing them silently gives wrong counts.
- **Weighted graphs with fractional weights** → use exact `Fraction`/rational arithmetic, not floats, or the "sum of products" loses precision.
- **Single prime not enough for the true big count** → use big integers (Bareiss) or multi-prime CRT.
- **Self-loops in the directed case** → still ignored; they add to neither in- nor out-degree for arborescence purposes.

---

## Best Practices

- Default to the **modular** determinant for any graph where the count might exceed `int64` (anything past `~K_15`).
- Keep a **brute-force** counter and a small suite of known answers (`triangle=3`, `K_4=16`, `K_5=125`, `K_n=n^(n−2)`) as regression tests.
- For weighted sums, decide between **exact rationals** and **mod p** up front based on what the problem asks.
- For directed counting, write down explicitly: "arborescences toward root `r`, out-degree Laplacian, delete row/col `r`." Ambiguity here is the #1 source of wrong answers.
- When using the eigenvalue form, guard the near-zero eigenvalue — round it to exactly `0` before multiplying, or you will divide noise into the product.
- Verify the modular result against a second prime occasionally; agreement is strong evidence of correctness.
- Memoize closed-form spectra for structured graphs (`K_n`, `C_n`, `K_{a,b}`) so you skip the `O(V³)` determinant when the graph is recognizably structured.
- When counting arborescences, double-check orientation by testing on a bidirected graph first: the per-root counts must all equal the undirected `τ(G)`.

---

## Cheat Sheet

```
Unweighted count   = det(reduced L),         L = D − A
Weighted sum       = det(reduced weighted L), L[i][i]=Σw, L[i][j]=−w(i,j)
                     → Σ_T ∏_{e∈T} w(e)
Arborescences →r   = cofactor(r,r) of out-degree Laplacian   (Tutte)
Eigenvalue form    = (1/n)·λ₁λ₂…λ_{n−1}       (λ₀ = 0)
Cayley             = τ(K_n) = (1/n)·n^(n−1) = n^(n−2)
Effective resist.  = L⁺[s][s]+L⁺[t][t]−2L⁺[s][t]
Modular division   = a · b^(p−2) mod p        (Fermat)
Huge true count    = Bareiss big-int  OR  multi-prime CRT
```

| Question | Tool |
|----------|------|
| Count, arbitrary graph | Matrix-Tree, `O(V³)` |
| Count mod p (huge) | Modular Gaussian elimination |
| Exact huge count | Bareiss big-int or CRT |
| Weighted tree sum | Weighted Laplacian cofactor |
| Directed (rooted) | Tutte / out-degree Laplacian |
| Resistance | Laplacian pseudoinverse |
| Complete graph | `n^(n−2)` directly |

---

## Summary

The middle level upgrades the recipe into understanding. The "any cofactor" freedom is forced by the null-space structure of the Laplacian: `adj(L)` must be a constant matrix, so all cofactors are equal. The eigenvalue form `(1/n)∏λᵢ` follows because the sum of all `n` principal cofactors equals the product of nonzero eigenvalues, and each cofactor is the tree count. From there the theorem generalizes cleanly: weighted graphs give a *sum of products of edge weights*; directed graphs give *arborescences* via Tutte's out-/in-degree Laplacian; huge counts demand *modular* (or Bareiss/CRT) arithmetic; and the very same Laplacian computes *effective resistance* through its pseudoinverse — the electrical origin Kirchhoff started from. The `O(V³)` determinant remains the engine; everything else is choosing the right matrix and the right arithmetic.

---

## Further Reading

- *Algebraic Graph Theory* (Biggs), Ch. 6–7 — Laplacian spectrum and the Matrix-Tree theorem.
- Tutte, *Graph Theory* — the directed Matrix-Tree theorem (arborescences).
- Doyle & Snell, *Random Walks and Electric Networks* — effective resistance and spanning trees.
- Spielman, lecture notes on spectral graph theory — Laplacian eigenvalues and applications.
- CP-Algorithms — "Kirchhoff theorem" and "Matrix determinant mod p."
- Sibling `25-prufer-code` — bijective Cayley proof; sibling `10-mst-kruskal-prim` — minimum spanning tree.
