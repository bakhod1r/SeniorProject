# Matrix Rank — Interview Preparation

Matrix rank is a favourite interview topic because it rewards a single crisp insight — *"the rank is the number of nonzero pivots after row reduction"* — and then tests whether you can (a) compute it correctly over the right field (reals with a tolerance, Z/pZ exactly, GF(2) with XOR/bitsets), (b) connect it to **rank-nullity** and **solvability** (Rouché-Capelli), (c) count solutions of a GF(2) system as **`2^(n−rank)`**, and (d) recognize that GF(2) rank is exactly the size of an **XOR basis** (sibling `18-bit-manipulation`). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Rank of a matrix | row-reduce, count pivots | `O(n²m)` |
| Rank over Z/pZ (exact) | elimination with modular inverse | `O(n²m)` |
| Rank over GF(2) | XOR elimination / bitsets | `O(n²m / 64)` |
| GF(2) rank = XOR-basis size | greedy basis insertion | `O(n · bits)` |
| Independence of `k` vectors | rank of stacked vectors | independent iff rank == k |
| Dimension of a span | rank | `O(n²m)` |
| Is `A x = b` solvable? | `rank(A) == rank([A|b])` (Rouché-Capelli) | `O(n²m)` |
| #solutions of GF(2) system | `2^(n − rank)` if consistent, else 0 | `O(n²m)` |
| Nullity (free variables) | `n − rank` (rank-nullity) | — |

Field table (the elimination is identical; only "what is zero" and "how to divide" change):

```text
field      zero test       divide by pivot        notes
reals      |x| < eps       real division          use partial pivoting
Z/pZ       x % p == 0      multiply by inverse    inverse via Fermat / ext-Euclid
GF(2)      x == 0          nothing (1^{-1}=1)     XOR rows; bitset-fast
```

Core algorithm:

```text
rank(A):
    rowPivot = 0
    for col in 0..n-1:
        find row r >= rowPivot with nonzero (|.|>=eps) entry in col
        if none: continue
        swap r to rowPivot; eliminate col from other rows
        rowPivot += 1
    return rowPivot          # = rank ; O(n^2 m)
```

Key facts:
- **rank ≤ min(m, n)**; **row rank = column rank**.
- **rank-nullity:** `rank + nullity = n` (columns), so `nullity = n − rank`.
- **Rouché-Capelli:** solvable iff `rank(A) == rank([A|b])`; unique iff that rank `== n`.
- **GF(2) solution count:** `2^(n − rank)` when consistent.

---

## Junior Questions (12 Q&A)

### J1. What is the rank of a matrix?
The number of **linearly independent rows** — equivalently the number of independent columns, equivalently the number of nonzero **pivots** after Gaussian elimination. It is the dimension of the row space (and the column space).

### J2. How do you compute it?
Run Gaussian elimination (row reduction) and **count the pivots**. Every row that reduces to all zeros was dependent and does not count. No new algorithm is needed — it falls out of the elimination you already know (sibling `17`).

### J3. What is a pivot?
The first nonzero entry of a row in row-echelon form. Each pivot claims a column and marks one independent row, so the number of pivots equals the rank.

### J4. Why does a dependent row become a zero row?
Because it is a combination of the pivot rows; once you subtract those off during elimination, nothing is left. A zero row contributes no new independent direction, so it does not increase the rank.

### J5. What is the maximum possible rank of an `m × n` matrix?
`min(m, n)`. You cannot have more independent rows than rows, nor more than columns (since row rank = column rank).

### J6. What does "full rank" mean?
Rank equals `min(m, n)` — no redundancy. For a square matrix, full rank means it is invertible (nonzero determinant).

### J7. What is the rank of the zero matrix?
`0`. Every column is skipped (no nonzero pivot), so no pivots are found.

### J8. Why do you need a tolerance over real numbers?
Floating-point arithmetic rounds, so an entry that should be exactly `0` may come out as `1e-16`. You compare `|x| < eps` against a small tolerance instead of `== 0`, otherwise rounding noise is mistaken for a real pivot.

### J9. Does row rank equal column rank?
Yes, always. The number of independent rows equals the number of independent columns for every matrix. So "rank" is unambiguous.

### J10. What is the time complexity of computing rank?
`O(n² m)` — for a square `n × n` matrix that is `O(n³)`, the same cost as Gaussian elimination for solving a system.

### J11. How is rank related to invertibility?
A square `n × n` matrix is invertible **iff** its rank is `n` (full rank). If the rank is less than `n` it is singular (not invertible, determinant zero).

### J12 (analysis). How do you test whether 3 vectors are linearly independent?
Stack them as the rows of a matrix and compute the rank. They are independent **iff** the rank equals 3. If the rank is less, at least one is a combination of the others.

---

## Middle Questions (12 Q&A)

### M1. Prove informally that #pivots = rank.
Elementary row operations preserve the row space (and its dimension). After reduction, the nonzero rows are independent (each pivot column isolates one row) and they span the row space, so their count is the dimension = rank. The full proof is in `professional.md`.

### M2. How do you compute rank over Z/pZ exactly?
Reduce entries mod a prime `p`. Test zero as `x % p == 0`. To eliminate, divide by the pivot using its **modular inverse** (`pivot^(p−2) mod p` by Fermat, or the extended Euclidean algorithm, sibling `06`). The result is exact — no rounding.

### M3. How do you compute rank over GF(2)?
Arithmetic is XOR (add) and AND (multiply). Find a row with a 1 in the current column, then XOR it into every other row that also has a 1 there. No inverses, no tolerance. Pack rows into machine words (bitsets) for a ~64× speedup.

### M4. Why is GF(2) rank the same as XOR-basis size?
Inserting numbers into an XOR basis (reduce each by XOR-ing out leading bits, keep if anything survives) *is* GF(2) Gaussian elimination done one row at a time. The number of basis vectors kept equals the GF(2) rank.

### M5. State the rank-nullity theorem.
`rank(A) + nullity(A) = n`, where `n` is the number of **columns** and nullity is the dimension of the null space (`{x : A x = 0}`). So `nullity = n − rank` is the number of free variables.

### M6. How does rank decide whether `A x = b` is solvable?
Rouché-Capelli: the system is solvable **iff** `rank(A) == rank([A | b])` (the augmented matrix). If gluing `b` on raises the rank, `b` is outside the column space and there is no solution.

### M7. When does a solvable system have a unique solution vs many?
If `rank(A) == rank([A|b]) == n`, the solution is **unique** (no free variables). If that common rank is `< n`, there are `n − rank` free variables, so infinitely many solutions (over an infinite field) or `field^(n−rank)` over a finite field.

### M8. How many solutions does a consistent GF(2) system have?
Exactly `2^(n − rank(A))`. There are `n − rank` free variables, each independently 0 or 1, giving `2^(n−rank)` combinations. Over GF(q) it is `q^(n−rank)`.

### M9. Can the rank of the same integer matrix differ over different fields?
Yes. `rank_GF(p) ≤ rank_Q`, and it can be strictly smaller if `p` divides a relevant minor. Example: `[[1,0],[0,p]]` has rank 2 over Q but rank 1 mod `p`. Use a large random prime to avoid unlucky cases.

### M10. What is the difference between full rank and rank-deficient?
Full rank: `rank == min(m, n)`, no redundancy. Rank-deficient: `rank < min(m, n)`, at least one dependent row/column. A square rank-deficient matrix is singular.

### M11. How do you find the dimension of the span of a set of vectors?
It is exactly their rank: stack them as rows and row-reduce. No extra work beyond computing the rank.

### M12 (analysis). Why use partial pivoting over the reals?
It picks the largest-magnitude candidate as the pivot, which keeps pivots large (avoiding division by a tiny number that amplifies rounding error) and improves the reliability of the zero-vs-nonzero decision. It is essentially mandatory for numerical rank.

---

## Senior Questions (10 Q&A)

### S1. How do you define rank robustly for noisy real data?
Use the **numerical rank**: the number of singular values (from the SVD) above a threshold `tol = max(m,n)·machine_eps·σ_max`. The SVD is order-independent and robust; elimination with a relative tolerance usually agrees but can be off by one on ill-conditioned matrices.

### S2. Your mod-`p` rank looks too low. What happened and how do you fix it?
The prime is "unlucky" — it divides a minor, dropping the rank. Fix by using a large random prime (negligible chance of dividing a fixed minor), or compute mod two primes and accept only if they agree, or use fraction-free (Bareiss) elimination for deterministic exactness over Q.

### S3. You must compute the rank of a GF(2) matrix with 100,000 columns. How?
Bitset elimination (`uint64` words, `O(n³/64)`), or the **Method of Four Russians (M4RI)** for `O(n³/log n)`. If the matrix is sparse, use iterative **block Lanczos / Wiedemann** to avoid fill-in. If vectors stream in, maintain an **online XOR basis**.

### S4. How do you compute rank without materializing the whole matrix?
Stream rows into an **XOR/linear basis** (GF(2) or general field): insert each row, reducing by the current basis; keep it iff it adds a new independent direction. The rank is the basis size at any moment — `O(rank)` per insert, `O(rank²)` space.

### S5. How does rank relate to error-correcting codes?
A linear `[n,k]` code has a generator matrix of rank `k` (so `2^k` codewords over GF(2)) and a parity-check matrix `H` of rank `n−k` with the code `= Null(H)`. Syndrome decoding solves `H x = s`; its solution structure is pure rank-nullity / Rouché-Capelli.

### S6. When is `O(n³)` elimination the wrong approach?
On **sparse** matrices it causes catastrophic fill-in — reorder and use iterative methods. On **structured** matrices (Vandermonde, circulant) the rank may have a closed form. And for **tensor rank** or **non-negative rank**, elimination does not apply at all — those are NP-hard.

### S7. How do you verify a rank computation you cannot eyeball?
Property tests: `rank(A) == rank(Aᵀ)` (row rank = column rank), `rank ≤ min(m,n)`, `rank + nullity == n` (compute the null space), two-prime agreement over Z/pZ, SVD cross-check over reals, and a brute-force oracle on small matrices.

### S8. How do you count GF(2) solutions correctly, including off-by-one traps?
After confirming consistency (`rank(A) == rank([A|b])`), the count is `2^(n − rank)` where `n` is the number of **unknowns (columns)**, never the number of equations (rows). Using row count is the classic bug; verify with the rank-nullity invariant.

### S9. What is the overflow risk in modular rank, and how do you avoid it?
With a 31-bit prime and `int64`, products of residues fit in `< 2^62`; reduce each step. With a 62-bit prime you need 128-bit products. Cache the pivot's modular inverse once per pivot row rather than recomputing per cell.

### S10 (analysis). Why can a 0/1 matrix have different real and GF(2) ranks?
Over GF(2), `1 + 1 = 0`, so combinations that are nonzero over the reals can cancel. Example: rows `110`, `011`, `101` — over GF(2) the third is the XOR of the first two (rank 2), but over the reals all three are independent (rank 3). The field's arithmetic, not the entries, determines the rank.

---

## Professional Questions (8 Q&A)

### P1. Design a service that classifies a linear system as infeasible / unique / underdetermined.
Build `[A|b]`, compute `rank(A)` and `rank([A|b])` once. If `rank(A) < rank([A|b])` → infeasible (surface the contradicting constraint = the new pivot's source row). If equal and `== n` → unique (return the solution). If equal and `< n` → underdetermined (return a particular solution plus a basis of the `n−rank`-dimensional null space; over GF(2) report `2^(n−rank)` count).

### P2. How do you guarantee an exact rational rank without modular luck?
Use **fraction-free (Bareiss) elimination**, which keeps exact integer entries (intermediate determinants) and avoids both fractions and modular ambiguity, at the cost of growing entry bit-lengths. Otherwise, a large random prime is correct with overwhelming probability and far faster.

### P3. Your numerical rank flips between runs on the same data. Why?
The matrix is **ill-conditioned**: its pivots/singular values decay gradually with no clear gap, so tiny perturbations or different pivot orders cross the tolerance. Report the smallest accepted pivot (or the singular-value gap); if the decay is gradual, the rank is genuinely ambiguous and must be resolved by domain knowledge, not the algorithm.

### P4. How do you debug "the GF(2) solution count is wrong"?
Check the usual suspects: counted against rows instead of columns (`2^(n−rank)` uses columns), forgot the consistency check (`rank(A) == rank([A|b])`), or a bitset width too small for the column count. Validate with brute force: enumerate all `2^n` assignments for small `n` and compare.

### P5. When is rank over GF(2) preferable to rank over Z/pZ?
When the problem is inherently XOR/parity-based — Lights Out, linear cryptanalysis, binary codes, Gaussian elimination over bits. GF(2) needs no modular inverses, no tolerance, and bitsets make it the fastest field. Use Z/pZ when the arithmetic is genuinely over larger residues.

### P6. How would you parallelize rank of many matrices, or a huge one?
Across matrices: embarrassingly parallel, one job each. For a single huge matrix: parallelize the elimination across rows being updated by the current pivot (each row update is independent), and for finite fields run two primes as independent jobs for verification. For huge sparse GF(2), block Lanczos parallelizes the matrix-vector products.

### P7. How does rank connect to identifiability in modeling?
A parameter-estimation problem is **identifiable** iff its design/observability matrix has full column rank. Rank-deficiency means there is a null-space direction along which parameters can vary without changing predictions — those parameter combinations are unidentifiable. Reporting the null-space basis tells the user *which* combinations are not determined.

### P8 (analysis). Why is matrix rank easy but tensor rank NP-hard?
Matrix elimination relies on a field with subtraction (the rank factorization `A = CB` uses cancellation) and a clean echelon normal form. Tensors have no analogue of row-echelon form and no efficient cancellation structure, so deciding tensor rank is NP-hard (Håstad). Non-negative matrix rank is also NP-hard because non-negativity removes the subtraction elimination needs.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you used a single computed quantity to answer several questions at once.
Look for a story where rank (or a similar invariant) simultaneously answered independence, span dimension, and solvability — one `O(n³)` computation reused for several downstream decisions, with a correctness check (transpose invariance, or a brute-force oracle) before shipping.

### B2. A teammate computed real-valued rank and got an unstable answer on near-dependent data. How do you help?
Explain conditioning calmly: the matrix is *nearly* rank-deficient, so the rank is genuinely ambiguous under a fixed tolerance. Recommend the SVD numerical rank with a relative threshold, partial pivoting, and reporting the singular-value gap so the team can see whether the rank is well-defined at all.

### B3. Design a feature that detects redundant business rules / constraints.
Encode each rule as a row over the appropriate field, compute the rank, and report `(#rules) − rank` redundant rules. Use an online XOR/linear basis so rules can be added incrementally; flag a new rule as redundant the moment it fails to increase the rank.

### B4. How would you explain matrix rank to a junior engineer?
Use the cookbook analogy: rank is how many genuinely different recipes remain after deleting every recipe that is just "an earlier one doubled" or "a mix of two earlier ones." Then show row reduction collapsing a duplicate row to zeros and counting the survivors. Lead with the two gotchas: count pivots (not columns), and over reals use a tolerance.

### B5. Your finite-field rank job sometimes returns a rank that is too low. Walk me through your investigation.
Suspect an unlucky prime first: re-run with a different large prime and see if the answer rises. Confirm entries are reduced into `[0, p)` and that division uses the modular inverse (not real division). Add a two-prime agreement guardrail so a wrong-low answer would require both primes to be unlucky simultaneously — practically impossible.

---

## Coding Challenges

### Challenge 1: Rank of a Matrix (over the reals)

**Problem.** Given an `m × n` real matrix, return its rank via Gaussian elimination with a tolerance.

**Example.**
```text
[[1,2,3],[2,4,6],[0,1,1]] -> rank 2   (row 2 = 2*row 1)
[[1,0],[0,1]]             -> rank 2
```

**Constraints.** `1 ≤ m, n ≤ 300`, entries are real.

**Optimal.** Gaussian elimination, `O(n²m)`.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

func rank(mat [][]float64) int {
	m := len(mat)
	if m == 0 {
		return 0
	}
	n := len(mat[0])
	rp := 0
	for col := 0; col < n && rp < m; col++ {
		sel := rp
		for r := rp + 1; r < m; r++ {
			if math.Abs(mat[r][col]) > math.Abs(mat[sel][col]) {
				sel = r
			}
		}
		if math.Abs(mat[sel][col]) < EPS {
			continue
		}
		mat[rp], mat[sel] = mat[sel], mat[rp]
		for r := 0; r < m; r++ {
			if r == rp {
				continue
			}
			f := mat[r][col] / mat[rp][col]
			for c := col; c < n; c++ {
				mat[r][c] -= f * mat[rp][c]
			}
		}
		rp++
	}
	return rp
}

func main() {
	A := [][]float64{{1, 2, 3}, {2, 4, 6}, {0, 1, 1}}
	fmt.Println(rank(A)) // 2
}
```

**Java.**
```java
public class RankReal {
    static final double EPS = 1e-9;

    static int rank(double[][] mat) {
        int m = mat.length;
        if (m == 0) return 0;
        int n = mat[0].length, rp = 0;
        for (int col = 0; col < n && rp < m; col++) {
            int sel = rp;
            for (int r = rp + 1; r < m; r++)
                if (Math.abs(mat[r][col]) > Math.abs(mat[sel][col])) sel = r;
            if (Math.abs(mat[sel][col]) < EPS) continue;
            double[] t = mat[rp]; mat[rp] = mat[sel]; mat[sel] = t;
            for (int r = 0; r < m; r++) {
                if (r == rp) continue;
                double f = mat[r][col] / mat[rp][col];
                for (int c = col; c < n; c++) mat[r][c] -= f * mat[rp][c];
            }
            rp++;
        }
        return rp;
    }

    public static void main(String[] args) {
        double[][] A = {{1, 2, 3}, {2, 4, 6}, {0, 1, 1}};
        System.out.println(rank(A)); // 2
    }
}
```

**Python.**
```python
EPS = 1e-9


def rank(mat):
    mat = [row[:] for row in mat]
    m = len(mat)
    if m == 0:
        return 0
    n = len(mat[0])
    rp = 0
    for col in range(n):
        if rp >= m:
            break
        sel = max(range(rp, m), key=lambda r: abs(mat[r][col]))
        if abs(mat[sel][col]) < EPS:
            continue
        mat[rp], mat[sel] = mat[sel], mat[rp]
        piv = mat[rp][col]
        for r in range(m):
            if r == rp:
                continue
            f = mat[r][col] / piv
            for c in range(col, n):
                mat[r][c] -= f * mat[rp][c]
        rp += 1
    return rp


if __name__ == "__main__":
    print(rank([[1, 2, 3], [2, 4, 6], [0, 1, 1]]))  # 2
```

---

### Challenge 2: Rank over Z/pZ (exact)

**Problem.** Given an integer matrix and a prime `p`, return the rank over the field `Z/pZ`. Use the modular inverse to divide.

**Example.**
```text
[[1,2,3],[2,4,6],[0,1,1]], p = 1e9+7 -> rank 2
```

**Constraints.** `1 ≤ m, n ≤ 300`, `p` prime, entries reduced mod `p`.

**Go.**
```go
package main

import "fmt"

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

func rankModP(mat [][]int64, p int64) int {
	m := len(mat)
	if m == 0 {
		return 0
	}
	n := len(mat[0])
	rp := 0
	for col := 0; col < n && rp < m; col++ {
		sel := -1
		for r := rp; r < m; r++ {
			if mat[r][col]%p != 0 {
				sel = r
				break
			}
		}
		if sel == -1 {
			continue
		}
		mat[rp], mat[sel] = mat[sel], mat[rp]
		inv := power(mat[rp][col], p-2, p)
		for r := 0; r < m; r++ {
			if r == rp || mat[r][col]%p == 0 {
				continue
			}
			f := mat[r][col] * inv % p
			for c := col; c < n; c++ {
				mat[r][c] = ((mat[r][c]-f*mat[rp][c])%p + p) % p
			}
		}
		rp++
	}
	return rp
}

func main() {
	A := [][]int64{{1, 2, 3}, {2, 4, 6}, {0, 1, 1}}
	fmt.Println(rankModP(A, 1_000_000_007)) // 2
}
```

**Java.**
```java
public class RankModP {
    static long power(long a, long e, long mod) {
        long r = 1; a %= mod;
        while (e > 0) { if ((e & 1) == 1) r = r * a % mod; a = a * a % mod; e >>= 1; }
        return r;
    }

    static int rankModP(long[][] mat, long p) {
        int m = mat.length;
        if (m == 0) return 0;
        int n = mat[0].length, rp = 0;
        for (int col = 0; col < n && rp < m; col++) {
            int sel = -1;
            for (int r = rp; r < m; r++) if (mat[r][col] % p != 0) { sel = r; break; }
            if (sel == -1) continue;
            long[] t = mat[rp]; mat[rp] = mat[sel]; mat[sel] = t;
            long inv = power(mat[rp][col], p - 2, p);
            for (int r = 0; r < m; r++) {
                if (r == rp || mat[r][col] % p == 0) continue;
                long f = mat[r][col] * inv % p;
                for (int c = col; c < n; c++)
                    mat[r][c] = ((mat[r][c] - f * mat[rp][c]) % p + p) % p;
            }
            rp++;
        }
        return rp;
    }

    public static void main(String[] args) {
        long[][] A = {{1, 2, 3}, {2, 4, 6}, {0, 1, 1}};
        System.out.println(rankModP(A, 1_000_000_007L)); // 2
    }
}
```

**Python.**
```python
def rank_mod_p(mat, p):
    mat = [row[:] for row in mat]
    m = len(mat)
    if m == 0:
        return 0
    n = len(mat[0])
    rp = 0
    for col in range(n):
        if rp >= m:
            break
        sel = next((r for r in range(rp, m) if mat[r][col] % p), None)
        if sel is None:
            continue
        mat[rp], mat[sel] = mat[sel], mat[rp]
        inv = pow(mat[rp][col], p - 2, p)
        for r in range(m):
            if r == rp or mat[r][col] % p == 0:
                continue
            f = mat[r][col] * inv % p
            for c in range(col, n):
                mat[r][c] = (mat[r][c] - f * mat[rp][c]) % p
        rp += 1
    return rp


if __name__ == "__main__":
    print(rank_mod_p([[1, 2, 3], [2, 4, 6], [0, 1, 1]], 1_000_000_007))  # 2
```

---

### Challenge 3: GF(2) Rank / XOR-Basis Size

**Problem.** Given a list of integers (each the bitmask of a vector over GF(2)), return the rank over GF(2) — equivalently the size of the XOR basis.

**Example.**
```text
[0b110, 0b011, 0b101] -> 2   (0b101 = 0b110 ^ 0b011)
[1, 2, 4]             -> 3   (all independent)
```

**Constraints.** `1 ≤ count ≤ 10^5`, vectors fit in 64 bits.

**Go.**
```go
package main

import "fmt"

func gf2Rank(rows []uint64) int {
	var basis []uint64
	for _, r := range rows {
		cur := r
		for _, b := range basis {
			if cur^b < cur {
				cur ^= b
			}
		}
		if cur != 0 {
			basis = append(basis, cur)
		}
	}
	return len(basis)
}

func main() {
	fmt.Println(gf2Rank([]uint64{0b110, 0b011, 0b101})) // 2
	fmt.Println(gf2Rank([]uint64{1, 2, 4}))             // 3
}
```

**Java.**
```java
import java.util.*;

public class GF2Rank {
    static int gf2Rank(long[] rows) {
        List<Long> basis = new ArrayList<>();
        for (long r : rows) {
            long cur = r;
            for (long b : basis) if ((cur ^ b) < cur) cur ^= b;
            if (cur != 0) basis.add(cur);
        }
        return basis.size();
    }

    public static void main(String[] args) {
        System.out.println(gf2Rank(new long[]{0b110, 0b011, 0b101})); // 2
        System.out.println(gf2Rank(new long[]{1, 2, 4}));             // 3
    }
}
```

**Python.**
```python
def gf2_rank(rows):
    basis = []
    for r in rows:
        cur = r
        for b in basis:
            cur = min(cur, cur ^ b)
        if cur:
            basis.append(cur)
            basis.sort(reverse=True)
    return len(basis)


if __name__ == "__main__":
    print(gf2_rank([0b110, 0b011, 0b101]))  # 2
    print(gf2_rank([1, 2, 4]))              # 3
```

---

### Challenge 4: Count Solutions of a GF(2) Linear System

**Problem.** Given an `m × n` GF(2) matrix `A` (as bitmasks) and a target vector `b` (a bitmask of length `m`), return the number of solutions `x ∈ GF(2)^n` to `A x = b`, modulo `10^9 + 7`. Return `0` if inconsistent.

**Approach.** Row-reduce the augmented system over GF(2). If a pivotless row has a `1` on the right-hand side → inconsistent → `0`. Otherwise the count is `2^(n − rank)`.

**Example.**
```text
A = [0b11, 0b01], b = [1, 1], n = 2  -> rank 2, consistent -> 2^0 = 1
```

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

// rows[i] holds A row i in bits 0..n-1 and b[i] in bit n (augmented).
func countSolutions(rows []uint64, n int) int64 {
	m := len(rows)
	rp := 0
	for col := 0; col < n && rp < m; col++ {
		sel := -1
		for r := rp; r < m; r++ {
			if rows[r]>>uint(col)&1 == 1 {
				sel = r
				break
			}
		}
		if sel == -1 {
			continue
		}
		rows[rp], rows[sel] = rows[sel], rows[rp]
		for r := 0; r < m; r++ {
			if r != rp && rows[r]>>uint(col)&1 == 1 {
				rows[r] ^= rows[rp]
			}
		}
		rp++
	}
	// consistency: any row that is 0 in cols 0..n-1 but 1 in the b bit (n) is contradictory
	for r := 0; r < m; r++ {
		lhs := rows[r] & ((uint64(1) << uint(n)) - 1)
		bbit := rows[r] >> uint(n) & 1
		if lhs == 0 && bbit == 1 {
			return 0
		}
	}
	res := int64(1)
	for i := 0; i < n-rp; i++ {
		res = res * 2 % MOD
	}
	return res
}

func main() {
	// x0 + x1 = 1 ; x1 = 1  -> unique
	rows := []uint64{0b1_11, 0b1_10} // bit2 = b, bits0..1 = A
	fmt.Println(countSolutions(rows, 2)) // 1
}
```

**Java.**
```java
public class CountGF2 {
    static final long MOD = 1_000_000_007L;

    static long countSolutions(long[] rows, int n) {
        int m = rows.length, rp = 0;
        for (int col = 0; col < n && rp < m; col++) {
            int sel = -1;
            for (int r = rp; r < m; r++)
                if (((rows[r] >> col) & 1) == 1) { sel = r; break; }
            if (sel == -1) continue;
            long t = rows[rp]; rows[rp] = rows[sel]; rows[sel] = t;
            for (int r = 0; r < m; r++)
                if (r != rp && ((rows[r] >> col) & 1) == 1) rows[r] ^= rows[rp];
            rp++;
        }
        long mask = (1L << n) - 1;
        for (int r = 0; r < m; r++) {
            long lhs = rows[r] & mask, b = (rows[r] >> n) & 1;
            if (lhs == 0 && b == 1) return 0;
        }
        long res = 1;
        for (int i = 0; i < n - rp; i++) res = res * 2 % MOD;
        return res;
    }

    public static void main(String[] args) {
        long[] rows = {0b1_11L, 0b1_10L};
        System.out.println(countSolutions(rows, 2)); // 1
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def count_solutions(rows, n):
    rows = rows[:]
    m = len(rows)
    rp = 0
    for col in range(n):
        if rp >= m:
            break
        sel = next((r for r in range(rp, m) if (rows[r] >> col) & 1), None)
        if sel is None:
            continue
        rows[rp], rows[sel] = rows[sel], rows[rp]
        for r in range(m):
            if r != rp and (rows[r] >> col) & 1:
                rows[r] ^= rows[rp]
        rp += 1
    mask = (1 << n) - 1
    for r in range(m):
        if (rows[r] & mask) == 0 and (rows[r] >> n) & 1:
            return 0          # inconsistent
    return pow(2, n - rp, MOD)


if __name__ == "__main__":
    # bit n is the rhs b; bits 0..n-1 are the A row
    rows = [0b1_11, 0b1_10]   # x0+x1=1 ; x1=1
    print(count_solutions(rows, 2))  # 1
```

---

## Final Tips

- Lead with the one-liner: *"the rank is the number of nonzero pivots after row reduction; compute it by Gaussian elimination in `O(n²m)`."*
- Immediately flag the field: **reals need a tolerance, Z/pZ needs a modular inverse, GF(2) is XOR (and bitset-fast)**.
- For solvability, reach for **Rouché-Capelli** (`rank(A) == rank([A|b])`) and for GF(2) counts use **`2^(n−rank)`**.
- Mention that **GF(2) rank = XOR-basis size** (sibling `18`) and that the basis can be maintained **online** over a stream.
- Always offer to verify: `rank(A) == rank(Aᵀ)`, `rank + nullity == n`, two-prime agreement, or a brute-force oracle on small inputs.
