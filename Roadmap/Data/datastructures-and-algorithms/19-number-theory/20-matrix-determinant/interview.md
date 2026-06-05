# Matrix Determinant — Interview Preparation

The determinant is a favourite interview topic because it rewards one crisp insight — *"reduce to upper-triangular, the determinant is the product of pivots with a sign flip per row swap, in `O(n^3)`"* — and then tests whether you can (a) explain why the textbook cofactor formula is `O(n!)` and unusable, (b) pick the right arithmetic (float vs `Z/pZ` vs Bareiss) for the constraints, (c) keep exact integer answers from overflowing (Bareiss / CRT), and (d) recognize the determinant behind invertibility, Cramer's rule, and spanning-tree counting (matrix-tree). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `det` of `n×n`, real inputs | Gaussian elimination (float) + partial pivoting | `O(n^3)` |
| `det` exact mod a prime `p` | elimination over `Z/pZ` (modular-inverse pivots) | `O(n^3)` |
| `det` exact integer | Bareiss (fraction-free) | `O(n^3)` ops |
| `det` exact integer, huge value | mod several primes + CRT | `O(n^3)` per prime |
| Is `A` invertible? | `det(A) ≠ 0` | `O(n^3)` |
| Count spanning trees | matrix-tree: `det` of Laplacian minor | `O(n^3)` |
| `2×2` / `3×3` by hand | `ad−bc` / Sarrus | `O(1)` |
| **Cofactor / Leibniz** | **`O(n!)` — definition, not algorithm** | — |

The three exact/inexact arithmetics (the elimination skeleton is identical; only the "divide by pivot" and zero-test change):

```text
arithmetic   divide-by-pivot         zero test          answer
float        / pivot                 |pivot| < eps      approximate (rounding)
Z/pZ         × inverse(pivot) mod p  pivot == 0         exact mod p
Bareiss      (exact integer update)  pivot == 0         exact integer (no fractions)
```

Core algorithm:

```text
det(A):
    sign = +1; det = 1
    for c in 0..n-1:
        pivot = nonzero entry at/below (c,c); if none -> return 0   # singular
        if pivot row != c: swap rows, sign = -sign
        det *= A[c][c]
        eliminate below (row-adds, no det change)
    return sign * det          # O(n^3)
```

Key facts:
- **Row-add preserves `det`; row-swap negates it; row-scale by `c` multiplies by `c`.**
- Triangular `det` = product of diagonal; `det(I) = 1`; `det([[a]]) = a`.
- `det(AB) = det(A)·det(B)`, but `det(A+B) ≠ det(A)+det(B)`.
- `det = 0` ⇔ singular ⇔ rows dependent. Hadamard bounds `|det| ≤ (B√n)^n`.

---

## Junior Questions (12 Q&A)

### J1. What is a determinant?
A single number computed from a *square* matrix. It tells you whether the matrix is invertible (`det = 0` ⇔ singular) and the signed factor by which it scales area/volume. For `2×2`, `det = ad − bc`.

### J2. How do you compute a `2×2` and `3×3` determinant by hand?
`2×2`: `det[[a,b],[c,d]] = ad − bc`. `3×3` (Sarrus / cofactor expansion): `a(ei−fh) − b(di−fg) + c(dh−eg)` for `[[a,b,c],[d,e,f],[g,h,i]]`, noting the alternating `+ − +` signs.

### J3. What is cofactor (Laplace) expansion, and why is it slow?
Expand along a row: `det = Σ_j (−1)^{i+j} A[i][j] M_{ij}`, where `M_{ij}` is the minor (determinant with row `i`, column `j` deleted). It is recursive — each `n×n` calls `n` determinants of size `n−1` — giving `O(n!)`, which is hopeless past `n ≈ 12`.

### J4. What is the fast way to compute a determinant?
Gaussian elimination: reduce to upper-triangular, then the determinant is the product of the diagonal (the pivots), with one sign flip per row swap. This is `O(n^3)`.

### J5. How does each row operation change the determinant?
Swapping two rows multiplies `det` by `−1`; adding a multiple of one row to another leaves `det` unchanged; scaling a row by `c` multiplies `det` by `c`.

### J6. Why is the determinant of a triangular matrix the product of its diagonal?
In the Leibniz sum, only the identity permutation gives a nonzero term — any other permutation must pick an entry below the diagonal, which is zero. So only `∏ A[i][i]` survives.

### J7. What does `det = 0` mean?
The matrix is singular: not invertible, its rows (and columns) are linearly dependent, and it maps space onto a lower-dimensional set (zero volume).

### J8. Does a determinant exist for non-square matrices?
No. The determinant is defined only for square `n×n` matrices.

### J9. What is the determinant of the identity matrix?
`det(I) = 1`. It is the normalization that pins down the determinant uniquely.

### J10. What is the geometric meaning of the determinant?
`|det|` is the area (2D) or volume (3D, and `n`-volume in general) of the parallelepiped spanned by the rows. The sign indicates whether orientation was preserved (+) or flipped (−).

### J11. Why do we need partial pivoting in the float version?
Dividing by a tiny pivot amplifies rounding error. Partial pivoting swaps the largest-magnitude entry in the column into the pivot position, keeping the computation numerically stable.

### J12 (analysis). Why is `O(n^3)` so much better than `O(n!)`?
At `n = 20`, `n^3 = 8000` but `20! ≈ 2.4×10^18`. Factorial growth is unusable beyond `n ≈ 12`, while cubic stays fast into the thousands. Elimination is the only practical method.

---

## Middle Questions (12 Q&A)

### M1. Prove that elimination computes the determinant.
Each row operation is left-multiplication by an elementary matrix `E` with known `det(E)` (swap `−1`, row-add `1`, scale `c`). Elimination gives `E_m⋯E_1 A = U`, so `det(U) = (∏ det E_t)·det(A) = (−1)^s det(A)` with `s` swaps. `U` is triangular, so `det(U) = ∏ U[i][i]`, giving `det(A) = (−1)^s ∏ U[i][i]`.

### M2. How do you compute a determinant exactly modulo a prime?
Run the same elimination over `Z/pZ`: pivoting needs only a nonzero entry, and "divide by the pivot" means multiply by its modular inverse `pivot^{p−2} mod p` (Fermat). Numbers stay in `[0, p)`, so the result is exact mod `p`.

### M3. Why does plain elimination fail over the integers, and what fixes it?
Dividing by pivots introduces fractions, and clearing them makes the numbers explode. The Bareiss algorithm uses the update `m[r][k] = (m[r][k]·pivot − m[r][c]·m[pivRow][k]) / prevPivot`, where the division is always exact, so every intermediate stays an integer (a minor's determinant).

### M4. Why is the Bareiss division always exact?
By Sylvester's identity, each Bareiss intermediate equals the determinant of a submatrix (a minor) of the original — hence an integer. The numerator is provably divisible by the previous pivot, so the division has no remainder.

### M5. State the key properties of the determinant.
Triangular = diagonal product; swap negates; row-add preserves; scale by `c` multiplies by `c`; multilinear in rows; `det(AB) = det(A)det(B)`; `det(Aᵀ) = det(A)`; `det = 0` ⇔ singular; `det(cA) = c^n det(A)`. Note `det(A+B) ≠ det(A)+det(B)`.

### M6. How do you detect a singular matrix during elimination?
If, at some column, no nonzero pivot exists at or below the diagonal, the matrix is singular and `det = 0` — stop early.

### M7. Why is `|det|` a bad measure of how close a matrix is to singular?
`0.1·I` has determinant `0.1^n` (tiny) yet is perfectly well-conditioned. Determinant magnitude conflates scaling with conditioning. Use the condition number or smallest singular value instead; reserve `det` for the exact-zero question.

### M8. How does the determinant relate to Cramer's rule?
Cramer's rule solves `Ax = b` via `x_i = det(A_i)/det(A)`, where `A_i` is `A` with column `i` replaced by `b`. It needs `det(A) ≠ 0` (invertibility) and is mostly of theoretical interest — `O(n)` determinants make it `O(n^4)`, far slower than solving by elimination.

### M9. How do you recover an exact integer determinant larger than one prime can hold?
Run the determinant mod several coprime primes and combine via CRT. Size the number of primes from the Hadamard bound (`∏ pᵢ > 2|det|`), then take the balanced representative to recover the sign.

### M10. What is Hadamard's bound and why does it matter?
`|det(A)| ≤ ∏ ‖row_i‖_2 ≤ (B√n)^n` for entries bounded by `B`. It bounds the bit-length of the answer, telling you whether `int64` suffices, how many CRT primes you need, and that Bareiss intermediates stay bounded.

### M11. How do you count spanning trees with a determinant?
Kirchhoff's matrix-tree theorem: build the Laplacian `L = D − A`, delete any one row and the same column, and take the determinant of the remaining `(n−1)×(n−1)` matrix. That determinant is the number of spanning trees.

### M12 (analysis). When would you choose Bareiss over mod-`p`+CRT, and vice versa?
Bareiss gives the exact integer directly in one run (good when you want no reconstruction, or `n` is small). Mod-`p`+CRT uses fixed-width arithmetic per prime and parallelizes across primes (good for large `n` where big-integer Bareiss is slow). Choose by whether you can bound the answer and afford reconstruction.

---

## Senior Questions (10 Q&A)

### S1. Walk through your decision for which determinant arithmetic to use.
Real inputs + approximate answer → float elimination with partial pivoting. Exact answer mod a prime → `Z/pZ` elimination. Exact integer, moderate → Bareiss with native ints (check the Hadamard transient). Exact integer, large → Bareiss with big integers or CRT over primes. If a branch depends on `det == 0`, never use floats.

### S2. Why can a mod-`p` determinant return `0` for a non-singular integer matrix?
If `p` divides the true determinant, then `A` is singular *modulo that prime*, so the mod-`p` result is `0` — correct for that modulus but not implying the integer determinant is `0`. A single `0 mod p` is inconclusive for integer singularity; confirm with another prime or Bareiss.

### S3. How do you avoid overflow when computing an exact float determinant for large `n`?
Accumulate the log-determinant: sum `log|pivot|` and track the sign separately (the `slogdet` pattern). Materialize `det = sign·exp(logabsdet)` only if it won't overflow. This is what LAPACK/SciPy `slogdet` does.

### S4. Bareiss keeps numbers integer and bounded — so why can it still overflow native ints?
The transient `m[r][k]·pivot − m[r][c]·m[pivRow][k]` is a product of two minors, roughly squaring the magnitude before the exact division brings it back down. The transient can exceed `int64` even when the final fits. Use `__int128`/big integers for the transient, or CRT.

### S5. How would you compute the determinant of a large sparse matrix (e.g., a graph Laplacian)?
Use sparse LU with a fill-reducing ordering (minimum degree, nested dissection) so fill-in stays low; the determinant is the product of the sparse `U` diagonal times the swap sign. Exploit block-triangular structure (`det = ∏ det(blocks)`) and use exact arithmetic (mod `p` + CRT) since the spanning-tree count is an exact integer.

### S6. How do you verify a determinant you can't recompute by hand?
Cofactor-expansion oracle on small `n`; property tests `det(AB)=det(A)det(B)`, `det(Aᵀ)=det(A)`, `det(swap(A))=−det(A)`, `det(I)=1`; cross-check Bareiss against mod-`p`+CRT; and assert the magnitude does not exceed the Hadamard bound.

### S7. What is the relationship between determinant and rank?
`det(A) = 0` ⇔ `rank(A) < n` for square `A`. Rank generalizes the determinant: it is the largest order of a nonzero minor. The determinant is the top-order minor (sibling `19-matrix-rank`).

### S8. When is the determinant the *wrong* tool?
For solving large linear systems (solve directly via elimination, don't compute `det`), for measuring near-singularity (use the condition number), and for testing invertibility of large float matrices (rounding makes `det == 0` unreliable). Also for integer-*matrix* invertibility you need `det = ±1` (a unit), not just `det ≠ 0`.

### S9. Explain `det(AB) = det(A)det(B)` and one consequence you rely on.
Fixing `B`, `det(AB)` is multilinear and alternating in the rows of `A`, so by the uniqueness of the determinant it equals `c·det(A)` with `c = det(B)`. A consequence: `det(A^{-1}) = 1/det(A)`, and the elimination pipeline is correct because it multiplies by elementary matrices of known determinant.

### S10 (analysis). How many CRT primes do you need for an exact integer determinant, and why?
Enough that `∏ pᵢ > 2·(Hadamard bound)`: the factor 2 covers the sign (balanced representative), and Hadamard bounds `|det|`. Concretely `m ≈ ceil((bit-bound + 1)/log2(min prime))`, plus one for safety. Each prime is an independent `O(n^3)` job.

---

## Professional Questions (8 Q&A)

### P1. Design a service that computes exact spanning-tree counts for large graphs.
Build the Laplacian, delete a row/column, and compute the determinant of the `(n−1)×(n−1)` minor exactly. For large sparse graphs, use sparse exact elimination mod several primes and CRT-combine; size the prime set from the Hadamard bound on the minor. Validate inputs (square, connected), log the bound, and cache nothing destructive (copy the matrix).

### P2. How do you compute an exact determinant when the value is astronomically large?
Estimate the size via Hadamard, choose enough coprime primes that `∏p > 2|det|`, run the mod-`p` determinant under each (parallel), and reconstruct via CRT/Garner (siblings `05-crt`, `15-garner-algorithm`). Take the balanced representative for the sign. Alternatively, Bareiss with big integers in a single run.

### P3. Your `1000×1000` integer determinant is too slow with big-integer Bareiss. What do you do?
Switch to mod-`p`+CRT so every operation is fixed-width `int64` (no big-integer slowdown), and parallelize across primes and across output rows of the multiply. Exploit structure (sparsity, block-triangular, symmetry/Cholesky). Size the prime count from Hadamard to avoid over-computing.

### P4. How do you debug "the determinant is wrong" in production?
Run the cofactor oracle on the same small inputs and diff. Check the three usual suspects: forgotten swap-sign flip, wrong `det(I)`/empty-matrix base case, and overflow/rounding (integer transient or float product). Verify `det(AB)=det(A)det(B)` and that `|det|` ≤ Hadamard. For mod-`p`, remember a `0` may be a bad-prime artifact.

### P5. When is the float determinant's singularity verdict untrustworthy, and what replaces it?
Always, near singularity: a true `0` rounds to `1e-15` and vice versa. Replace the `det == 0` test with exact arithmetic (mod `p`/Bareiss) for an exact verdict, or numerical rank via SVD with a principled tolerance for a robust verdict. Never threshold a float determinant.

### P6. How does Cramer's rule relate, and why is it rarely used in practice?
Cramer's rule expresses each solution component of `Ax=b` as a ratio of determinants `det(A_i)/det(A)`. It needs `n+1` determinants, so `O(n^4)` — far slower than the `O(n^3)` direct solve. It is valuable theoretically (closed form, symbolic work) but not as a numerical solver.

### P7. Explain the matrix-tree theorem's proof at a high level.
Orient edges to get the incidence matrix `B`; then `L = BBᵀ` and the deleted-row Laplacian minor is `B_i B_iᵀ`. By Cauchy-Binet, `det(B_i B_iᵀ) = Σ_S det(B_i[:,S])^2` over `(n−1)`-edge subsets `S`, and each square is `1` iff `S` is a spanning tree, else `0`. The sum therefore counts spanning trees.

### P8 (analysis). Can the determinant be computed faster than `O(n^3)`?
Yes, asymptotically: `O(n^ω)` with `ω < 2.372` via block recursion (determinant is asymptotically equivalent to matrix multiplication). In practice, for the `n` in graph/number-theory work, cache-tuned `O(n^3)` elimination wins; the subcubic algorithms bring constant-factor and numerical complications. The trivial lower bound is `Ω(n^2)` (reading the input).

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a slow exact computation with a faster, still-exact one.
Look for a story where an `O(n!)` cofactor expansion or a fraction-blowing integer elimination was the bottleneck, the insight that elimination (Bareiss or mod-`p`+CRT) gives the same exact answer in `O(n^3)`, and a measured speedup. Strong answers mention validating against the slow version and sizing arithmetic via the Hadamard bound.

### B2. A teammate used a float determinant to decide invertibility and shipped a bug. How do you handle it?
Explain calmly that float `det == 0` is unreliable near singularity (rounding), with a concrete example (`0.1·I` has tiny determinant but is invertible and well-conditioned). Recommend exact arithmetic for an exact verdict or SVD/condition number for a robust one. Frame it as a teaching moment about choosing arithmetic to match the decision.

### B3. Design a feature that counts the number of redundant network topologies (spanning trees).
This is the matrix-tree theorem: build the Laplacian, take any cofactor (delete a row/column), compute the determinant exactly. Discuss exact integer arithmetic (the count must be exact), sparsity of real network graphs, sizing via Hadamard, and Cayley's formula (`n^{n-2}` for the complete graph) as a sanity check.

### B4. How would you explain the determinant to a junior engineer?
Start with the `2×2` area picture: two arrows from the origin, `|det|` is the parallelogram area, `0` means they're collinear (flat, singular). Then "the fast algorithm is just elimination — make it triangular, multiply the diagonal, flip a sign on each swap". Lead with the two gotchas: it's `O(n^3)` not the `O(n!)` formula you learned, and exactness depends on the arithmetic you choose.

### B5. Your exact-determinant job is overflowing or running out of memory. How do you investigate?
Compute the Hadamard bound to see how many bits the answer needs; check whether you're using native ints where big integers (or the transient) are required. Confirm you copy the matrix once (not per step) and ping-pong buffers. If big-integer Bareiss is the cost, switch to mod-`p`+CRT (fixed-width per prime) and parallelize across primes.

---

## Coding Challenges

### Challenge 1: Determinant via Gaussian Elimination (float)

**Problem.** Given an `n×n` real matrix `A`, return `det(A)` using Gaussian elimination with partial pivoting.

**Example.**
```text
A = [[2,1,1],[4,3,3],[8,7,9]]  ->  4.0
A = [[1,2],[3,4]]              ->  -2.0
```

**Constraints.** `1 ≤ n ≤ 500`, entries are real.

**Approach.** Reduce to upper-triangular, multiply pivots, flip sign per swap. `O(n^3)`.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func determinant(a [][]float64) float64 {
	n := len(a)
	m := make([][]float64, n)
	for i := range m {
		m[i] = append([]float64(nil), a[i]...)
	}
	det := 1.0
	for c := 0; c < n; c++ {
		piv := c
		for r := c + 1; r < n; r++ {
			if math.Abs(m[r][c]) > math.Abs(m[piv][c]) {
				piv = r
			}
		}
		if math.Abs(m[piv][c]) < 1e-12 {
			return 0
		}
		if piv != c {
			m[c], m[piv] = m[piv], m[c]
			det = -det
		}
		det *= m[c][c]
		for r := c + 1; r < n; r++ {
			f := m[r][c] / m[c][c]
			for k := c; k < n; k++ {
				m[r][k] -= f * m[c][k]
			}
		}
	}
	return det
}

func main() {
	fmt.Printf("%.4f\n", determinant([][]float64{{2, 1, 1}, {4, 3, 3}, {8, 7, 9}})) // 4
	fmt.Printf("%.4f\n", determinant([][]float64{{1, 2}, {3, 4}}))                  // -2
}
```

**Java.**
```java
public class DetFloat {
    static double determinant(double[][] a) {
        int n = a.length;
        double[][] m = new double[n][];
        for (int i = 0; i < n; i++) m[i] = a[i].clone();
        double det = 1.0;
        for (int c = 0; c < n; c++) {
            int piv = c;
            for (int r = c + 1; r < n; r++)
                if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
            if (Math.abs(m[piv][c]) < 1e-12) return 0;
            if (piv != c) { double[] t = m[c]; m[c] = m[piv]; m[piv] = t; det = -det; }
            det *= m[c][c];
            for (int r = c + 1; r < n; r++) {
                double f = m[r][c] / m[c][c];
                for (int k = c; k < n; k++) m[r][k] -= f * m[c][k];
            }
        }
        return det;
    }

    public static void main(String[] args) {
        System.out.println(determinant(new double[][]{{2, 1, 1}, {4, 3, 3}, {8, 7, 9}})); // 4.0
        System.out.println(determinant(new double[][]{{1, 2}, {3, 4}}));                  // -2.0
    }
}
```

**Python.**
```python
def determinant(a):
    n = len(a)
    m = [row[:] for row in a]
    det = 1.0
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[piv][c]) < 1e-12:
            return 0.0
        if piv != c:
            m[c], m[piv] = m[piv], m[c]
            det = -det
        det *= m[c][c]
        for r in range(c + 1, n):
            f = m[r][c] / m[c][c]
            for k in range(c, n):
                m[r][k] -= f * m[c][k]
    return det


if __name__ == "__main__":
    print(determinant([[2, 1, 1], [4, 3, 3], [8, 7, 9]]))  # 4.0
    print(determinant([[1, 2], [3, 4]]))                    # -2.0
```

---

### Challenge 2: Determinant mod p (finite field)

**Problem.** Given an `n×n` integer matrix and a prime `p`, return `det(A) mod p` exactly using `Z/pZ` elimination.

**Example.**
```text
A = [[2,1,1],[4,3,3],[8,7,9]], p = 1_000_000_007  ->  4
```

**Constraints.** `1 ≤ n ≤ 500`, `p` prime, entries any integers.

**Approach.** Elimination over `Z/pZ`; divide by pivot = multiply by modular inverse (`pivot^{p−2} mod p`). `O(n^3)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func power(a, e, mod int64) int64 {
	r := int64(1)
	a %= mod
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func detModP(a [][]int64, mod int64) int64 {
	n := len(a)
	m := make([][]int64, n)
	for i := range m {
		m[i] = make([]int64, n)
		for j := range m[i] {
			m[i][j] = ((a[i][j] % mod) + mod) % mod
		}
	}
	det := int64(1)
	for c := 0; c < n; c++ {
		piv := -1
		for r := c; r < n; r++ {
			if m[r][c] != 0 {
				piv = r
				break
			}
		}
		if piv == -1 {
			return 0
		}
		if piv != c {
			m[c], m[piv] = m[piv], m[c]
			det = (mod - det) % mod
		}
		det = det * m[c][c] % mod
		inv := power(m[c][c], mod-2, mod)
		for r := c + 1; r < n; r++ {
			f := m[r][c] * inv % mod
			for k := c; k < n; k++ {
				m[r][k] = (m[r][k] - f*m[c][k]%mod + mod) % mod
			}
		}
	}
	return det
}

func main() {
	A := [][]int64{{2, 1, 1}, {4, 3, 3}, {8, 7, 9}}
	fmt.Println(detModP(A, MOD)) // 4
}
```

**Java.**
```java
public class DetModP {
    static long power(long a, long e, long mod) {
        long r = 1; a %= mod;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod; e >>= 1;
        }
        return r;
    }

    static long detModP(long[][] a, long mod) {
        int n = a.length;
        long[][] m = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) m[i][j] = ((a[i][j] % mod) + mod) % mod;
        long det = 1;
        for (int c = 0; c < n; c++) {
            int piv = -1;
            for (int r = c; r < n; r++) if (m[r][c] != 0) { piv = r; break; }
            if (piv == -1) return 0;
            if (piv != c) { long[] t = m[c]; m[c] = m[piv]; m[piv] = t; det = (mod - det) % mod; }
            det = det * m[c][c] % mod;
            long inv = power(m[c][c], mod - 2, mod);
            for (int r = c + 1; r < n; r++) {
                long f = m[r][c] * inv % mod;
                for (int k = c; k < n; k++)
                    m[r][k] = (m[r][k] - f * m[c][k] % mod + mod) % mod;
            }
        }
        return det;
    }

    public static void main(String[] args) {
        long[][] A = {{2, 1, 1}, {4, 3, 3}, {8, 7, 9}};
        System.out.println(detModP(A, 1_000_000_007L)); // 4
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def det_mod_p(a, mod=MOD):
    n = len(a)
    m = [[x % mod for x in row] for row in a]
    det = 1
    for c in range(n):
        piv = next((r for r in range(c, n) if m[r][c] != 0), -1)
        if piv == -1:
            return 0
        if piv != c:
            m[c], m[piv] = m[piv], m[c]
            det = (-det) % mod
        det = det * m[c][c] % mod
        inv = pow(m[c][c], mod - 2, mod)
        for r in range(c + 1, n):
            f = m[r][c] * inv % mod
            if f:
                rc, rr = m[c], m[r]
                for k in range(c, n):
                    rr[k] = (rr[k] - f * rc[k]) % mod
    return det


if __name__ == "__main__":
    print(det_mod_p([[2, 1, 1], [4, 3, 3], [8, 7, 9]]))  # 4
```

---

### Challenge 3: Exact Integer Determinant via Bareiss

**Problem.** Given an `n×n` integer matrix, return the exact integer `det(A)` using fraction-free Bareiss elimination (no fractions, no modulus).

**Example.**
```text
A = [[2,1,1],[4,3,3],[8,7,9]]  ->  4
A = [[6,1,1],[4,-2,5],[2,8,7]] ->  -306
```

**Constraints.** `1 ≤ n ≤ 200`; in Python use native big ints; in Go/Java use `__int128`/`BigInteger` if values can exceed `int64`.

**Approach.** Bareiss update divides exactly by the previous pivot; intermediates stay integer. `O(n^3)`.

**Go.**
```go
package main

import "fmt"

func detBareiss(a [][]int64) int64 {
	n := len(a)
	m := make([][]int64, n)
	for i := range m {
		m[i] = append([]int64(nil), a[i]...)
	}
	sign, prev := int64(1), int64(1)
	for c := 0; c < n; c++ {
		if m[c][c] == 0 {
			sw := -1
			for r := c + 1; r < n; r++ {
				if m[r][c] != 0 {
					sw = r
					break
				}
			}
			if sw == -1 {
				return 0
			}
			m[c], m[sw] = m[sw], m[c]
			sign = -sign
		}
		for r := c + 1; r < n; r++ {
			for k := c + 1; k < n; k++ {
				m[r][k] = (m[r][k]*m[c][c] - m[r][c]*m[c][k]) / prev
			}
			m[r][c] = 0
		}
		prev = m[c][c]
	}
	return sign * m[n-1][n-1]
}

func main() {
	fmt.Println(detBareiss([][]int64{{2, 1, 1}, {4, 3, 3}, {8, 7, 9}}))   // 4
	fmt.Println(detBareiss([][]int64{{6, 1, 1}, {4, -2, 5}, {2, 8, 7}})) // -306
}
```

**Java.**
```java
public class DetBareiss {
    static long detBareiss(long[][] a) {
        int n = a.length;
        long[][] m = new long[n][];
        for (int i = 0; i < n; i++) m[i] = a[i].clone();
        long sign = 1, prev = 1;
        for (int c = 0; c < n; c++) {
            if (m[c][c] == 0) {
                int sw = -1;
                for (int r = c + 1; r < n; r++) if (m[r][c] != 0) { sw = r; break; }
                if (sw == -1) return 0;
                long[] t = m[c]; m[c] = m[sw]; m[sw] = t; sign = -sign;
            }
            for (int r = c + 1; r < n; r++) {
                for (int k = c + 1; k < n; k++)
                    m[r][k] = (m[r][k] * m[c][c] - m[r][c] * m[c][k]) / prev;
                m[r][c] = 0;
            }
            prev = m[c][c];
        }
        return sign * m[n - 1][n - 1];
    }

    public static void main(String[] args) {
        System.out.println(detBareiss(new long[][]{{2, 1, 1}, {4, 3, 3}, {8, 7, 9}}));   // 4
        System.out.println(detBareiss(new long[][]{{6, 1, 1}, {4, -2, 5}, {2, 8, 7}})); // -306
    }
}
```

**Python.**
```python
def det_bareiss(a):
    n = len(a)
    m = [row[:] for row in a]  # Python ints are arbitrary precision
    sign, prev = 1, 1
    for c in range(n):
        if m[c][c] == 0:
            sw = next((r for r in range(c + 1, n) if m[r][c] != 0), -1)
            if sw == -1:
                return 0
            m[c], m[sw] = m[sw], m[c]
            sign = -sign
        for r in range(c + 1, n):
            for k in range(c + 1, n):
                m[r][k] = (m[r][k] * m[c][c] - m[r][c] * m[c][k]) // prev
            m[r][c] = 0
        prev = m[c][c]
    return sign * m[n - 1][n - 1]


if __name__ == "__main__":
    print(det_bareiss([[2, 1, 1], [4, 3, 3], [8, 7, 9]]))    # 4
    print(det_bareiss([[6, 1, 1], [4, -2, 5], [2, 8, 7]]))   # -306
```

---

### Challenge 4: Count Spanning Trees via Kirchhoff (Matrix-Tree)

**Problem.** Given an undirected graph (`n` vertices, edge list), count its spanning trees mod `10^9 + 7`. Build the Laplacian `L = D − A`, delete the last row and column, and take the determinant of the remaining `(n−1)×(n−1)` matrix mod `p`.

**Example.**
```text
n=3, edges=[(0,1),(1,2),(2,0)]  (a triangle)  ->  3 spanning trees
n=4, complete graph K4                         ->  16 = 4^(4-2)
```

**Constraints.** `1 ≤ n ≤ 300`, simple graph.

**Approach.** Laplacian minor determinant mod `p` (reuse Challenge 2's `detModP`). `O(n^3)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func power(a, e, mod int64) int64 {
	r := int64(1)
	a %= mod
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func detModP(m [][]int64, mod int64) int64 {
	n := len(m)
	det := int64(1)
	for c := 0; c < n; c++ {
		piv := -1
		for r := c; r < n; r++ {
			if m[r][c] != 0 {
				piv = r
				break
			}
		}
		if piv == -1 {
			return 0
		}
		if piv != c {
			m[c], m[piv] = m[piv], m[c]
			det = (mod - det) % mod
		}
		det = det * m[c][c] % mod
		inv := power(m[c][c], mod-2, mod)
		for r := c + 1; r < n; r++ {
			f := m[r][c] * inv % mod
			for k := c; k < n; k++ {
				m[r][k] = (m[r][k] - f*m[c][k]%mod + mod) % mod
			}
		}
	}
	return det
}

func countSpanningTrees(n int, edges [][2]int) int64 {
	L := make([][]int64, n)
	for i := range L {
		L[i] = make([]int64, n)
	}
	for _, e := range edges {
		u, v := e[0], e[1]
		L[u][u]++
		L[v][v]++
		L[u][v]--
		L[v][u]--
	}
	// delete last row & column -> (n-1)x(n-1) minor
	minor := make([][]int64, n-1)
	for i := 0; i < n-1; i++ {
		minor[i] = make([]int64, n-1)
		for j := 0; j < n-1; j++ {
			minor[i][j] = ((L[i][j] % MOD) + MOD) % MOD
		}
	}
	return detModP(minor, MOD)
}

func main() {
	fmt.Println(countSpanningTrees(3, [][2]int{{0, 1}, {1, 2}, {2, 0}}))                          // 3
	fmt.Println(countSpanningTrees(4, [][2]int{{0, 1}, {0, 2}, {0, 3}, {1, 2}, {1, 3}, {2, 3}})) // 16
}
```

**Java.**
```java
public class SpanningTrees {
    static final long MOD = 1_000_000_007L;

    static long power(long a, long e, long mod) {
        long r = 1; a %= mod;
        while (e > 0) { if ((e & 1) == 1) r = r * a % mod; a = a * a % mod; e >>= 1; }
        return r;
    }

    static long detModP(long[][] m, long mod) {
        int n = m.length;
        long det = 1;
        for (int c = 0; c < n; c++) {
            int piv = -1;
            for (int r = c; r < n; r++) if (m[r][c] != 0) { piv = r; break; }
            if (piv == -1) return 0;
            if (piv != c) { long[] t = m[c]; m[c] = m[piv]; m[piv] = t; det = (mod - det) % mod; }
            det = det * m[c][c] % mod;
            long inv = power(m[c][c], mod - 2, mod);
            for (int r = c + 1; r < n; r++) {
                long f = m[r][c] * inv % mod;
                for (int k = c; k < n; k++)
                    m[r][k] = (m[r][k] - f * m[c][k] % mod + mod) % mod;
            }
        }
        return det;
    }

    static long countSpanningTrees(int n, int[][] edges) {
        long[][] L = new long[n][n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            L[u][u]++; L[v][v]++; L[u][v]--; L[v][u]--;
        }
        long[][] minor = new long[n - 1][n - 1];
        for (int i = 0; i < n - 1; i++)
            for (int j = 0; j < n - 1; j++)
                minor[i][j] = ((L[i][j] % MOD) + MOD) % MOD;
        return detModP(minor, MOD);
    }

    public static void main(String[] args) {
        System.out.println(countSpanningTrees(3, new int[][]{{0, 1}, {1, 2}, {2, 0}})); // 3
        System.out.println(countSpanningTrees(4, new int[][]{
            {0, 1}, {0, 2}, {0, 3}, {1, 2}, {1, 3}, {2, 3}}));                          // 16
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def det_mod_p(m, mod=MOD):
    n = len(m)
    det = 1
    for c in range(n):
        piv = next((r for r in range(c, n) if m[r][c] != 0), -1)
        if piv == -1:
            return 0
        if piv != c:
            m[c], m[piv] = m[piv], m[c]
            det = (-det) % mod
        det = det * m[c][c] % mod
        inv = pow(m[c][c], mod - 2, mod)
        for r in range(c + 1, n):
            f = m[r][c] * inv % mod
            for k in range(c, n):
                m[r][k] = (m[r][k] - f * m[c][k]) % mod
    return det


def count_spanning_trees(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        L[u][u] += 1
        L[v][v] += 1
        L[u][v] -= 1
        L[v][u] -= 1
    minor = [[L[i][j] % MOD for j in range(n - 1)] for i in range(n - 1)]
    return det_mod_p(minor)


if __name__ == "__main__":
    print(count_spanning_trees(3, [(0, 1), (1, 2), (2, 0)]))  # 3
    print(count_spanning_trees(4, [(0, 1), (0, 2), (0, 3),
                                   (1, 2), (1, 3), (2, 3)]))   # 16 = 4^2
```

---

## Final Tips

- Lead with the one-liner: *"Reduce to upper-triangular; `det` is the product of pivots with a sign flip per row swap — `O(n^3)`. The cofactor formula is `O(n!)` and only for `2×2`/`3×3` by hand."*
- Immediately flag the arithmetic choice: **float** (approximate), **mod `p`** (exact-bounded), **Bareiss** (exact-integer, no fractions).
- For exact integer answers, mention **Hadamard's bound** (sizes overflow / number of CRT primes) and **Bareiss vs CRT** as the two exact paths.
- Know the **matrix-tree theorem**: spanning-tree count = determinant of a Laplacian cofactor; Cayley's `n^{n-2}` for `K_n` is the sanity check.
- Always offer to verify against a cofactor-expansion oracle on small matrices and the `det(AB)=det(A)det(B)` property.
