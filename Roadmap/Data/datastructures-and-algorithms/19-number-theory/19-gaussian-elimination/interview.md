# Gaussian Elimination (Solving Linear Systems) — Interview Preparation

Gaussian elimination is a perennial interview topic because it rewards one crisp mental model — *"row-reduce the augmented matrix `[A|b]` to echelon form, then back-substitute"* — and then probes whether you can (a) keep it numerically stable with **partial pivoting**, (b) make it **exact** over `Z/pZ` by dividing through the modular inverse, (c) recognize **GF(2) XOR systems** and the bitset speedup, and (d) read off **rank** to decide no-solution vs unique vs infinitely-many. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Solve `A·x = b` over the reals | Gaussian elimination + partial pivoting + back substitution | `O(n³)` |
| Solve `A·x = b` over `Z/pZ` | Same, divide by pivot's modular inverse (sibling `06`) | `O(n³)` |
| Solve XOR system (GF(2)) | Bitset elimination, XOR rows | `O(n³ / 64)` |
| Determinant | Signed product of pivots | `O(n³)` (sibling `18`) |
| Rank / # independent equations | Count non-zero pivot rows | `O(n³)` (sibling `19`) |
| Matrix inverse | Gauss-Jordan `[A|I] → [I|A⁻¹]` (RREF) | `O(n³)` |
| No solution? | Row `0 … 0 | c`, `c ≠ 0` (inconsistent) | — |
| Infinitely many? | Pivot missing in a column (free variable) | `|F|^{n−r}` over finite `F` |

Core algorithm:

```text
solve(A, b):
    m = [A | b]                               # augment
    for col in 0 .. n-1:                       # forward elimination
        p = argmax_{r>=col} |m[r][col]|        # partial pivot (reals)
        if |m[p][col]| ~ 0: SINGULAR
        swap rows col, p
        for r > col: m[r] -= (m[r][col]/m[col][col]) * m[col]
    back-substitute from last pivot row upward
# O(n^3); over Z/pZ divide = multiply by modular inverse; over GF(2) use XOR.
```

Key facts:
- **Row operations** (swap, scale, add-multiple) never change the solution set.
- **Pivot** for stability over floats (largest magnitude); any non-zero pivot over a field.
- **REF** is enough to back-substitute; **RREF** reads the answer directly and computes inverses.
- **Rank** decides solvability (Rouché–Capelli): `rank(A) = rank([A|b])` ⟺ consistent.

---

## Junior Questions (12 Q&A)

### J1. What does Gaussian elimination do?
It solves a linear system `A·x = b` by applying row operations to the augmented matrix `[A|b]` until it is upper-triangular (row-echelon form), then reading off the unknowns by back substitution from the bottom row upward.

### J2. What is the augmented matrix?
The coefficient matrix `A` with the right-hand side `b` glued on as an extra final column. Every row operation acts on the whole row, including that `b` column.

### J3. What are the three legal row operations?
(1) Swap two rows, (2) multiply a row by a non-zero constant, (3) add a multiple of one row to another. None of them changes the set of solutions.

### J4. What is a pivot?
The leading non-zero entry of a row, used to eliminate the entries below it (and, in RREF, above it) in that column. You divide by the pivot, so it must be non-zero.

### J5. What is back substitution?
After forward elimination leaves an upper-triangular system, the last row has one unknown — solve it, substitute into the row above (now one unknown), and climb upward solving one variable per row.

### J6. Why might you swap rows during elimination?
If the current pivot is zero you *cannot* divide by it, so you swap in a lower row with a non-zero entry in that column. Over the reals you also swap in the largest-magnitude entry for numerical stability (partial pivoting).

### J7. What is the time complexity?
`O(n³)` for an `n × n` system: forward elimination dominates (each of `n` columns eliminates `~n` rows over `~n` columns). Back substitution is only `O(n²)`.

### J8. What is row-echelon form (REF)?
An upper-triangular shape where each pivot is to the right of the pivot above it and everything below a pivot is zero. It is what you reach after forward elimination, ready for back substitution.

### J9. What is the difference between REF and RREF?
RREF additionally scales every pivot to `1` and zeros out the entries *above* each pivot. In RREF the solution is read off directly without back substitution, and it is how you compute a matrix inverse.

### J10. How do you know a system has no solution?
If elimination produces a row `0 0 … 0 | c` with `c ≠ 0`, it says `0 = c`, which is impossible — the system is inconsistent and has no solution.

### J11. What is a free variable?
An unknown whose column has no pivot. It can take any value, and each choice gives a different solution — so the system has infinitely many solutions (over an infinite field).

### J12 (analysis). Why must the pivot be non-zero?
Because elimination divides each lower row by the pivot (computing the factor `m[r][col]/m[col][col]`). A zero pivot causes division by zero; a tiny float pivot causes huge rounding errors. Pivoting (swapping a non-zero / largest entry in) avoids both.

---

## Middle Questions (12 Q&A)

### M1. Why is partial pivoting necessary over the reals?
Dividing by a tiny pivot creates huge multipliers that wipe out significant digits to rounding (catastrophic cancellation). Partial pivoting swaps the largest-magnitude entry in the column into the pivot position, keeping multipliers `≤ 1` and the computation backward-stable.

### M2. What is the difference between partial and full pivoting?
Partial pivoting searches only the current column (below the pivot) for the largest magnitude — `O(n²)` total extra work. Full pivoting searches the whole remaining submatrix and swaps both a row and a column (tracking the column permutation). Full is more stable but costlier and rarely needed.

### M3. How do you solve a system over `Z/pZ` exactly?
Run the same elimination, but "divide by the pivot" means multiply by its **modular inverse** `pivot⁻¹ mod p` (Fermat `pivot^{p−2}` for prime `p`, or extended Euclid — siblings `04`, `06`). There is no rounding, so the result is exact mod `p`, and any non-zero pivot works.

### M4. Why does GF(2) elimination use XOR?
GF(2) is `Z/2Z`: addition is XOR, multiplication is AND, and the only non-zero element `1` is its own inverse. So "add a multiple of the pivot row" becomes "XOR the pivot row in", and a whole row is a bit vector you can XOR word-by-word.

### M5. What speedup do bitsets give for GF(2)?
A 64× constant-factor speedup: pack each row into 64-bit words and XOR whole words at once, turning the inner row operation from `O(n)` element ops into `O(n/64)` word ops. Total cost `O(n³ / 64)`.

### M6. How do you detect no solution vs infinitely many?
After elimination: a row `0 … 0 | c` with `c ≠ 0` means **no solution**. Otherwise, if every column has a pivot (`rank = n unknowns`) the solution is **unique**; if some column lacks a pivot, those are **free variables** and there are **infinitely many** solutions.

### M7. State the Rouché–Capelli theorem.
`A·x = b` is consistent iff `rank(A) = rank([A|b])`. When consistent, the solution set has dimension `n − rank(A)`: unique if that rank equals the number of unknowns, otherwise infinitely many (free variables).

### M8. How do you count solutions over a finite field?
If consistent with rank `r` and `n` unknowns over `Z/pZ`, there are exactly `p^{n−r}` solutions (each of the `n−r` free variables ranges over all `p` field elements). Over GF(2) that is `2^{n−r}`.

### M9. How is this related to computing a determinant?
Gaussian elimination *is* an LU factorization. The determinant is the signed product of the pivots: `det(A) = (−1)^{#swaps} · ∏ pivots`. So the same `O(n³)` elimination gives the determinant (sibling `18`).

### M10. What is the connection to the XOR basis?
The XOR-basis / linear-basis trick (sibling `18-bit-manipulation`) is online Gaussian elimination over GF(2): you keep one reduced basis vector per distinct leading bit. Inserting a vector is one elimination step; querying whether a value is representable is back substitution.

### M11. Why prefer LU factorization when you have many right-hand sides?
Factor `A = LU` once in `O(n³)`, then each new `b` is solved by forward + back substitution in `O(n²)`. For `k` right-hand sides this is `O(n³ + k n²)` versus `O(k n³)` for re-eliminating each time.

### M12 (analysis). Why is solving `A·x=b` preferable to computing `A⁻¹·b`?
Computing the inverse is both slower (extra constant factor) and less numerically stable than a direct solve. You should only form `A⁻¹` if the inverse itself is the deliverable; to solve a system, eliminate directly.

---

## Senior Questions (10 Q&A)

### S1. Pivoting makes elimination stable — so why can the answer still be wrong?
Pivoting bounds the *backward* (algorithm-induced) error by controlling the growth factor. The *forward* error is governed by the matrix's **condition number** `κ(A) = ‖A‖·‖A⁻¹‖`, intrinsic to `A`. If `κ ≈ 10^16` in `double`, you lose ~16 digits regardless of pivoting — the matrix is effectively singular.

### S2. How do you recover an exact integer/rational answer, not just mod p?
Solve under several coprime primes and reconstruct with CRT/Garner (siblings `05`, `15`); the answer must fit below the product of primes (bound its magnitude via Hadamard's inequality). For rationals, solve mod a large prime and apply rational reconstruction via continued fractions (sibling `16`). Or use fraction-free Bareiss elimination to stay exact in the integers.

### S3. What is fraction-free (Bareiss) elimination and when do you use it?
Bareiss keeps every intermediate an exact integer (each is a minor of `A`), dividing exactly by the previous pivot so fractions never appear and entry growth stays polynomial. Use it for exact integer determinants and rational systems, and over rings that are not fields (composite moduli).

### S4. The modulus is composite. What breaks and how do you fix it?
`Z/mZ` is not a field, so a non-zero pivot may be non-invertible (a zero divisor), stalling elimination. Fix by factoring `m = ∏ pᵢ^{eᵢ}`, solving modulo each prime power, and recombining via CRT (sibling `05`); or use Bareiss elimination which avoids inverses entirely.

### S5. Your matrix is 50,000 × 50,000 and sparse. What do you do?
Do not run dense `O(n³)` elimination — fill-in densifies it. Use a sparse direct solver with a fill-reducing ordering (minimum-degree, nested dissection; SuiteSparse/SuperLU), or switch to a preconditioned iterative method (CG for SPD, GMRES for general) at `O(iterations · nnz)`.

### S6. How do you make a float solve more accurate without higher precision throughout?
**Iterative refinement**: compute the residual `r = b − A·x̂` (ideally in higher precision), solve `A·δ = r` reusing the existing LU factorization (`O(n²)`), and update `x̂ ← x̂ + δ`. A few rounds recover digits lost to rounding for moderately ill-conditioned systems.

### S7. How do you speed up the mod-p inner loop?
For a fixed prime `p`, replace the expensive `%` with **Montgomery multiplication** (sibling `14`) or Barrett reduction — a large constant-factor win since the elimination does millions of modular multiplies. Also reduce after each multiply to avoid overflow, or use 128-bit accumulators.

### S8. When is float Gaussian elimination the wrong tool entirely?
When you need an exact answer (use `Z/pZ`/Bareiss); when `A` is symmetric positive-definite (use Cholesky, half the work, no pivoting); for least-squares or rank-deficient systems (use QR or SVD, more stable); for severely ill-conditioned systems (regularize or truncate SVD).

### S9. How do you verify a solver when you cannot eyeball the answer?
Check the residual `‖A·x − b‖` (float) or `A·x ≡ b mod p` (field) — the single best check. Add property tests: identity system returns `b`, rank-consistency (`rank(A) = rank([A|b])`), free-variable count equals `n − rank`, determinant sign matches swap parity, and cross-language determinism for the exact variants.

### S10 (analysis). Why is the determinant the signed product of pivots?
The determinant is multilinear and alternating: row swaps multiply it by `−1` (hence the sign), adding a multiple of one row to another leaves it unchanged, and a triangular matrix's determinant is its diagonal product. Elimination uses only those operations to reach upper-triangular `U`, so `det(A) = (−1)^{swaps} ∏ Uᵢᵢ`.

---

## Professional Questions (8 Q&A)

### P1. Design a service that solves many systems sharing one matrix `A`.
Factor `A = PLU` once at ingest (`O(n³)`), store `L`, `U`, and the permutation `P`. Each request supplies a `b` and is answered with forward + back substitution in `O(n²)`. Never re-eliminate per request and never invert. For exact answers, run modular factorizations under chosen primes and CRT-combine; the per-prime work is independent and parallelizable.

### P2. You need an exact rational solution. Walk through the pipeline.
Solve `A·x ≡ b` modulo a large prime `p` (exact mod-p elimination). Recover each rational coordinate `num/den` from its residue via **rational reconstruction** (continued fractions, sibling `16`), valid when `|num|, |den| < √(p/2)`. If the bound is too tight, use multiple primes + CRT first, then reconstruct. Alternatively run Bareiss for a direct exact-integer solution of the scaled system.

### P3. A GF(2) system has `n = 200,000` (e.g. the linear-algebra phase of a sieve factorization). How?
Plain bitset XOR is `O(n³/64)` — still too much at `2×10⁵`. Use block bit-parallel methods (Method of Four Russians, the M4RI library) which precompute combinations of basis rows in blocks for better-than-`n³/64` performance, and exploit the extreme sparsity of sieve matrices with structured/sparse GF(2) solvers (block Lanczos / Wiedemann).

### P4. How do you debug "the solver returns garbage" in production (float)?
Compute and log the residual `‖A·x − b‖`; a large residual means a real bug (missed augmented-column update, sign error, no pivoting). Log the smallest pivot magnitude and a condition-number estimate; a tiny pivot or `κ ≈ 10^16` means the matrix is near-singular and the answer is untrustworthy — not a code bug but a data/ formulation problem requiring regularization or higher precision.

### P5. When does the determinant/rank route (siblings 18, 19) matter for a solver?
The square unique-solution test is `det(A) ≠ 0` — computed by the *same* elimination (signed pivot product, sibling `18`). For non-square or singular systems, you cannot use `det`; instead compute `rank(A)` and `rank([A|b])` (sibling `19`) and apply Rouché–Capelli to classify the system. The solver and these two siblings are one elimination with different readouts.

### P6. How would you parallelize a large dense factorization?
Use **blocked LU** (LAPACK `dgetrf` style): partition into tiles and cast the bulk of work as matrix-matrix multiply (`dgemm`), which is cache-efficient, SIMD-friendly, and parallelizes across cores/GPUs. The panel factorization is sequential but small; the trailing-submatrix update is the parallel hotspot. For exact answers, parallelize across CRT primes (each an independent factorization).

### P7. Explain the link between Gaussian elimination and LU/Cholesky/QR.
Gaussian elimination with pivoting *is* `PA = LU`. For symmetric positive-definite `A`, the symmetric version is **Cholesky** `A = LLᵀ` (half the work, no pivoting). **QR** (`A = QR`, orthogonal `Q`) is a different, more stable factorization used for least-squares and rank-deficient problems where elimination's normal-equations approach loses accuracy.

### P8 (analysis). Why does composite-modulus elimination need CRT, but prime-modulus does not?
For prime `p`, `Z/pZ` is a field — every non-zero element is invertible, so any non-zero pivot can divide. For composite `m`, `Z/mZ` has zero divisors: a non-zero pivot may not be invertible, and the field-based proofs (solution-set invariance, RREF) can fail. Splitting `m` into prime-power factors restores fields on each component; CRT (sibling `05`) recombines the per-factor solutions into one mod `m`.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose between a direct and an iterative solver.
Look for: recognizing the system was large and sparse, profiling that dense `O(n³)` (or fill-in) was the bottleneck, switching to a preconditioned iterative method (CG/GMRES) or a sparse direct solver, and measuring the speedup. Strong answers mention checking the residual to confirm correctness and discussing conditioning / preconditioner choice.

### B2. A teammate's float solver returns wildly wrong answers on some inputs. How do you help?
Calmly separate two causes: (1) a *bug* — check the residual `‖A·x−b‖`; if large, look for a missing pivot or an un-updated augmented column; (2) *ill-conditioning* — if the residual is small but the answer is wrong, the matrix is near-singular (`κ` huge) and no algorithm fix helps; the right move is regularization, higher precision, or reformulating the problem. Frame it as diagnosis, not blame.

### B3. Design a feature that exactly solves a small integer linear system for a scheduling constraint engine.
Use exact arithmetic, not float: solve over `Z/pZ` for a large prime (or Bareiss for direct integers), classify via rank (unique / none / infinite), and for rationals apply rational reconstruction (sibling `16`). Discuss validating the modulus is prime, handling the infinite-solution case (return a parameterized family or pick a canonical solution), and verifying `A·x ≡ b`.

### B4. How would you explain Gaussian elimination to a junior engineer?
Start from the spreadsheet analogy: each row is an equation, the last column the target. Show "cancel a variable by subtracting a scaled row" turning the grid into a staircase (echelon form), then climbing back up to read each unknown (back substitution). Lead with the two gotchas: pivot on the largest entry so floats do not blow up, and over `Z/pZ` you divide by multiplying by the modular inverse.

### B5. Your exact mod-p solver gives different answers on two machines. How do you investigate?
Exact modular arithmetic must be deterministic, so a difference signals overflow (a product overflowing `int64` before `% p`) or a non-normalized negative residue (`%` differing in sign across languages/configs). Check the modulus is prime, reduce after every multiply, normalize with `((x%p)+p)%p`, and add a cross-language determinism test on seeded inputs.

---

## Coding Challenges

### Challenge 1: Solve a Real Linear System (partial pivoting)

**Problem.** Given an `n × n` matrix `A` and vector `b` (reals), return the solution `x` of `A·x = b`, or report "singular". Use Gaussian elimination with partial pivoting.

**Example.**
```text
A = [[2,1,-1],[-3,-1,2],[-2,1,2]], b = [8,-11,-3]  ->  x = [2, 3, -1]
```

**Constraints.** `1 ≤ n ≤ 500`, well-conditioned `A`.

**Optimal.** Gaussian elimination, `O(n³)`.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func solve(A [][]float64, b []float64) ([]float64, bool) {
	n := len(A)
	m := make([][]float64, n)
	for i := 0; i < n; i++ {
		m[i] = append(append([]float64{}, A[i]...), b[i])
	}
	for col := 0; col < n; col++ {
		piv := col
		for r := col + 1; r < n; r++ {
			if math.Abs(m[r][col]) > math.Abs(m[piv][col]) {
				piv = r
			}
		}
		if math.Abs(m[piv][col]) < 1e-12 {
			return nil, false
		}
		m[col], m[piv] = m[piv], m[col]
		for r := col + 1; r < n; r++ {
			f := m[r][col] / m[col][col]
			for c := col; c <= n; c++ {
				m[r][c] -= f * m[col][c]
			}
		}
	}
	x := make([]float64, n)
	for i := n - 1; i >= 0; i-- {
		s := m[i][n]
		for c := i + 1; c < n; c++ {
			s -= m[i][c] * x[c]
		}
		x[i] = s / m[i][i]
	}
	return x, true
}

func main() {
	A := [][]float64{{2, 1, -1}, {-3, -1, 2}, {-2, 1, 2}}
	x, ok := solve(A, []float64{8, -11, -3})
	fmt.Println(ok, x) // true [2 3 -1]
}
```

**Java.**
```java
public class SolveReal {
    static double[] solve(double[][] A, double[] b) {
        int n = A.length;
        double[][] m = new double[n][n + 1];
        for (int i = 0; i < n; i++) {
            System.arraycopy(A[i], 0, m[i], 0, n);
            m[i][n] = b[i];
        }
        for (int col = 0; col < n; col++) {
            int piv = col;
            for (int r = col + 1; r < n; r++)
                if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
            if (Math.abs(m[piv][col]) < 1e-12) return null;
            double[] t = m[col]; m[col] = m[piv]; m[piv] = t;
            for (int r = col + 1; r < n; r++) {
                double f = m[r][col] / m[col][col];
                for (int c = col; c <= n; c++) m[r][c] -= f * m[col][c];
            }
        }
        double[] x = new double[n];
        for (int i = n - 1; i >= 0; i--) {
            double s = m[i][n];
            for (int c = i + 1; c < n; c++) s -= m[i][c] * x[c];
            x[i] = s / m[i][i];
        }
        return x;
    }

    public static void main(String[] args) {
        double[][] A = {{2, 1, -1}, {-3, -1, 2}, {-2, 1, 2}};
        System.out.println(java.util.Arrays.toString(solve(A, new double[]{8, -11, -3})));
    }
}
```

**Python.**
```python
def solve(A, b):
    n = len(A)
    m = [list(map(float, A[i])) + [float(b[i])] for i in range(n)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            return None
        m[col], m[piv] = m[piv], m[col]
        for r in range(col + 1, n):
            f = m[r][col] / m[col][col]
            for c in range(col, n + 1):
                m[r][c] -= f * m[col][c]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (m[i][n] - sum(m[i][c] * x[c] for c in range(i + 1, n))) / m[i][i]
    return x


if __name__ == "__main__":
    A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]]
    print(solve(A, [8, -11, -3]))  # [2.0, 3.0, -1.0]
```

---

### Challenge 2: Solve a System over `Z/pZ`

**Problem.** Given `A` (`n × n`) and `b` over `Z/pZ` with prime `p = 10^9 + 7`, return the unique solution `x` mod `p`, or report "no unique solution". Divide by pivots using the modular inverse.

**Example.**
```text
A = [[2,1],[1,3]], b = [5,10], p = 1e9+7  ->  unique x mod p
```

**Constraints.** `1 ≤ n ≤ 300`, entries in `[0, p)`.

**Optimal.** Mod-p Gaussian elimination, `O(n³)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func power(a, e int64) int64 {
	r := int64(1)
	a %= MOD
	for e > 0 {
		if e&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		e >>= 1
	}
	return r
}
func inv(a int64) int64 { return power(((a%MOD)+MOD)%MOD, MOD-2) }

func solveModP(A [][]int64, b []int64) ([]int64, bool) {
	n := len(A)
	m := make([][]int64, n)
	for i := 0; i < n; i++ {
		m[i] = make([]int64, n+1)
		for j := 0; j < n; j++ {
			m[i][j] = ((A[i][j] % MOD) + MOD) % MOD
		}
		m[i][n] = ((b[i] % MOD) + MOD) % MOD
	}
	for col := 0; col < n; col++ {
		piv := -1
		for r := col; r < n; r++ {
			if m[r][col] != 0 {
				piv = r
				break
			}
		}
		if piv == -1 {
			return nil, false
		}
		m[col], m[piv] = m[piv], m[col]
		iv := inv(m[col][col])
		for r := 0; r < n; r++ {
			if r == col || m[r][col] == 0 {
				continue
			}
			f := m[r][col] * iv % MOD
			for c := col; c <= n; c++ {
				m[r][c] = ((m[r][c]-f*m[col][c])%MOD + MOD) % MOD
			}
		}
	}
	x := make([]int64, n)
	for i := 0; i < n; i++ {
		x[i] = m[i][n] * inv(m[i][i]) % MOD
	}
	return x, true
}

func main() {
	A := [][]int64{{2, 1}, {1, 3}}
	x, ok := solveModP(A, []int64{5, 10})
	fmt.Println(ok, x)
}
```

**Java.**
```java
public class SolveModP {
    static final long MOD = 1_000_000_007L;
    static long power(long a, long e) {
        long r = 1; a %= MOD;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        return r;
    }
    static long inv(long a) { return power(((a % MOD) + MOD) % MOD, MOD - 2); }

    static long[] solve(long[][] A, long[] b) {
        int n = A.length;
        long[][] m = new long[n][n + 1];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) m[i][j] = ((A[i][j] % MOD) + MOD) % MOD;
            m[i][n] = ((b[i] % MOD) + MOD) % MOD;
        }
        for (int col = 0; col < n; col++) {
            int piv = -1;
            for (int r = col; r < n; r++) if (m[r][col] != 0) { piv = r; break; }
            if (piv == -1) return null;
            long[] t = m[col]; m[col] = m[piv]; m[piv] = t;
            long iv = inv(m[col][col]);
            for (int r = 0; r < n; r++) {
                if (r == col || m[r][col] == 0) continue;
                long f = m[r][col] * iv % MOD;
                for (int c = col; c <= n; c++)
                    m[r][c] = ((m[r][c] - f * m[col][c]) % MOD + MOD) % MOD;
            }
        }
        long[] x = new long[n];
        for (int i = 0; i < n; i++) x[i] = m[i][n] * inv(m[i][i]) % MOD;
        return x;
    }

    public static void main(String[] args) {
        long[][] A = {{2, 1}, {1, 3}};
        System.out.println(java.util.Arrays.toString(solve(A, new long[]{5, 10})));
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def inv(a):
    return pow(a % MOD, MOD - 2, MOD)


def solve_mod_p(A, b):
    n = len(A)
    m = [[A[i][j] % MOD for j in range(n)] + [b[i] % MOD] for i in range(n)]
    for col in range(n):
        piv = next((r for r in range(col, n) if m[r][col] != 0), None)
        if piv is None:
            return None
        m[col], m[piv] = m[piv], m[col]
        iv = inv(m[col][col])
        for r in range(n):
            if r == col or m[r][col] == 0:
                continue
            f = m[r][col] * iv % MOD
            for c in range(col, n + 1):
                m[r][c] = (m[r][c] - f * m[col][c]) % MOD
    return [m[i][n] * inv(m[i][i]) % MOD for i in range(n)]


if __name__ == "__main__":
    print(solve_mod_p([[2, 1], [1, 3]], [5, 10]))
```

---

### Challenge 3: Solve a GF(2) XOR System (bitsets)

**Problem.** Given `n` boolean unknowns and equations of the form `x_{i1} ⊕ x_{i2} ⊕ … = b`, find any assignment satisfying all equations, or report "no solution". Each equation is encoded as an integer whose bit `c` marks coefficient of `x_c` and whose bit `n` is the right-hand side `b`.

**Example.**
```text
n = 3; rows = [0b1011, 0b0110]   # (x0 ⊕ x1 = 1), (x1 ⊕ x2 = 0)  ->  a satisfying x
```

**Optimal.** GF(2) elimination with XOR, `O(n³ / 64)` with bitset rows.

**Go.**
```go
package main

import "fmt"

// rows: each is an (n+1)-bit value; bit c = coeff of x_c, bit n = b.
func solveGF2(rows []uint64, n int) ([]int, bool) {
	m := append([]uint64{}, rows...)
	where := make([]int, n)
	for i := range where {
		where[i] = -1
	}
	r := 0
	for col := 0; col < n; col++ {
		piv := -1
		for i := r; i < len(m); i++ {
			if (m[i]>>uint(col))&1 == 1 {
				piv = i
				break
			}
		}
		if piv == -1 {
			continue
		}
		m[r], m[piv] = m[piv], m[r]
		for i := 0; i < len(m); i++ {
			if i != r && (m[i]>>uint(col))&1 == 1 {
				m[i] ^= m[r] // XOR whole row
			}
		}
		where[col] = r
		r++
	}
	for i := 0; i < len(m); i++ {
		coeffs := m[i] & ((uint64(1) << uint(n)) - 1)
		if coeffs == 0 && (m[i]>>uint(n))&1 == 1 {
			return nil, false // 0 = 1
		}
	}
	x := make([]int, n)
	for col := 0; col < n; col++ {
		if where[col] != -1 {
			x[col] = int((m[where[col]] >> uint(n)) & 1)
		}
	}
	return x, true
}

func main() {
	x, ok := solveGF2([]uint64{0b1011, 0b0110}, 3)
	fmt.Println(ok, x)
}
```

**Java.**
```java
public class SolveGF2 {
    static int[] solve(long[] rows, int n) {
        long[] m = rows.clone();
        int[] where = new int[n];
        java.util.Arrays.fill(where, -1);
        int r = 0;
        for (int col = 0; col < n; col++) {
            int piv = -1;
            for (int i = r; i < m.length; i++)
                if (((m[i] >> col) & 1) == 1) { piv = i; break; }
            if (piv == -1) continue;
            long t = m[r]; m[r] = m[piv]; m[piv] = t;
            for (int i = 0; i < m.length; i++)
                if (i != r && ((m[i] >> col) & 1) == 1) m[i] ^= m[r];
            where[col] = r++;
        }
        for (long row : m) {
            long coeffs = row & ((1L << n) - 1);
            if (coeffs == 0 && ((row >> n) & 1) == 1) return null; // inconsistent
        }
        int[] x = new int[n];
        for (int col = 0; col < n; col++)
            if (where[col] != -1) x[col] = (int) ((m[where[col]] >> n) & 1);
        return x;
    }

    public static void main(String[] args) {
        System.out.println(java.util.Arrays.toString(solve(new long[]{0b1011, 0b0110}, 3)));
    }
}
```

**Python.**
```python
def solve_gf2(rows, n):
    m = rows[:]
    where = [-1] * n
    r = 0
    for col in range(n):
        piv = next((i for i in range(r, len(m)) if (m[i] >> col) & 1), None)
        if piv is None:
            continue
        m[r], m[piv] = m[piv], m[r]
        for i in range(len(m)):
            if i != r and (m[i] >> col) & 1:
                m[i] ^= m[r]
        where[col] = r
        r += 1
    for row in m:
        if (row & ((1 << n) - 1)) == 0 and (row >> n) & 1:
            return None  # inconsistent
    x = [0] * n
    for col in range(n):
        if where[col] != -1:
            x[col] = (m[where[col]] >> n) & 1
    return x


if __name__ == "__main__":
    print(solve_gf2([0b1011, 0b0110], 3))
```

---

### Challenge 4: Rank and Count Solutions over `Z/pZ`

**Problem.** Given `A` (`m × n`) and `b` over `Z/pZ` (prime `p`), classify the system as `NO_SOLUTION`, `UNIQUE`, or report the number of solutions `p^{n−rank}` when there are infinitely many (free variables). Output the rank too.

**Approach.** Eliminate to RREF tracking pivot columns; if a row has all-zero coefficients but non-zero `b`, it is inconsistent. Otherwise `solutions = p^{n − rank}` (mod a big number, or symbolically).

**Python.**
```python
MOD = 1_000_000_007


def classify(A, b, p=MOD):
    m, n = len(A), len(A[0])
    mat = [[A[i][j] % p for j in range(n)] + [b[i] % p] for i in range(m)]
    where = [-1] * n
    row = 0
    for col in range(n):
        piv = next((r for r in range(row, m) if mat[r][col] != 0), None)
        if piv is None:
            continue
        mat[row], mat[piv] = mat[piv], mat[row]
        iv = pow(mat[row][col], p - 2, p)
        for r in range(m):
            if r != row and mat[r][col] != 0:
                f = mat[r][col] * iv % p
                for c in range(col, n + 1):
                    mat[r][c] = (mat[r][c] - f * mat[row][c]) % p
        where[col] = row
        row += 1
    for r in range(m):
        if all(mat[r][c] == 0 for c in range(n)) and mat[r][n] != 0:
            return ("NO_SOLUTION", 0, sum(1 for w in where if w != -1))
    rank = sum(1 for w in where if w != -1)
    if rank == n:
        return ("UNIQUE", 1, rank)
    return ("INFINITE", pow(p, n - rank, p), rank)  # p^(n-rank) solutions


if __name__ == "__main__":
    print(classify([[1, 1, 1], [0, 1, 2]], [6, 5]))   # INFINITE, free var
    print(classify([[1, 1], [1, -1]], [2, 0]))         # UNIQUE
    print(classify([[1, 1], [2, 2]], [2, 5]))          # NO_SOLUTION
```

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func power(a, e int64) int64 {
	r := int64(1)
	a %= MOD
	for e > 0 {
		if e&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		e >>= 1
	}
	return r
}

func classify(A [][]int64, b []int64) (string, int64, int) {
	m, n := len(A), len(A[0])
	mat := make([][]int64, m)
	for i := 0; i < m; i++ {
		mat[i] = make([]int64, n+1)
		for j := 0; j < n; j++ {
			mat[i][j] = ((A[i][j] % MOD) + MOD) % MOD
		}
		mat[i][n] = ((b[i] % MOD) + MOD) % MOD
	}
	where := make([]int, n)
	for i := range where {
		where[i] = -1
	}
	row := 0
	for col := 0; col < n && row < m; col++ {
		piv := -1
		for r := row; r < m; r++ {
			if mat[r][col] != 0 {
				piv = r
				break
			}
		}
		if piv == -1 {
			continue
		}
		mat[row], mat[piv] = mat[piv], mat[row]
		iv := power(mat[row][col], MOD-2)
		for r := 0; r < m; r++ {
			if r != row && mat[r][col] != 0 {
				f := mat[r][col] * iv % MOD
				for c := col; c <= n; c++ {
					mat[r][c] = ((mat[r][c]-f*mat[row][c])%MOD + MOD) % MOD
				}
			}
		}
		where[col] = row
		row++
	}
	rank := 0
	for _, w := range where {
		if w != -1 {
			rank++
		}
	}
	for r := 0; r < m; r++ {
		allZero := true
		for c := 0; c < n; c++ {
			if mat[r][c] != 0 {
				allZero = false
				break
			}
		}
		if allZero && mat[r][n] != 0 {
			return "NO_SOLUTION", 0, rank
		}
	}
	if rank == n {
		return "UNIQUE", 1, rank
	}
	return "INFINITE", power(MOD, int64(n-rank)), rank
}

func main() {
	fmt.Println(classify([][]int64{{1, 1, 1}, {0, 1, 2}}, []int64{6, 5}))
}
```

**Java.**
```java
public class RankClassify {
    static final long MOD = 1_000_000_007L;
    static long power(long a, long e) {
        long r = 1; a %= MOD;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        return r;
    }

    static String classify(long[][] A, long[] b) {
        int m = A.length, n = A[0].length;
        long[][] mat = new long[m][n + 1];
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) mat[i][j] = ((A[i][j] % MOD) + MOD) % MOD;
            mat[i][n] = ((b[i] % MOD) + MOD) % MOD;
        }
        int[] where = new int[n];
        java.util.Arrays.fill(where, -1);
        int row = 0;
        for (int col = 0; col < n && row < m; col++) {
            int piv = -1;
            for (int r = row; r < m; r++) if (mat[r][col] != 0) { piv = r; break; }
            if (piv == -1) continue;
            long[] t = mat[row]; mat[row] = mat[piv]; mat[piv] = t;
            long iv = power(mat[row][col], MOD - 2);
            for (int r = 0; r < m; r++) {
                if (r != row && mat[r][col] != 0) {
                    long f = mat[r][col] * iv % MOD;
                    for (int c = col; c <= n; c++)
                        mat[r][c] = ((mat[r][c] - f * mat[row][c]) % MOD + MOD) % MOD;
                }
            }
            where[col] = row++;
        }
        int rank = 0;
        for (int w : where) if (w != -1) rank++;
        for (int r = 0; r < m; r++) {
            boolean allZero = true;
            for (int c = 0; c < n; c++) if (mat[r][c] != 0) { allZero = false; break; }
            if (allZero && mat[r][n] != 0) return "NO_SOLUTION rank=" + rank;
        }
        if (rank == n) return "UNIQUE rank=" + rank;
        return "INFINITE solutions=" + power(MOD, n - rank) + " rank=" + rank;
    }

    public static void main(String[] args) {
        System.out.println(classify(new long[][]{{1, 1, 1}, {0, 1, 2}}, new long[]{6, 5}));
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Augment `[A|b]`, row-reduce to echelon form with partial pivoting, back-substitute — `O(n³)`."*
- Immediately flag the field: **reals** (pivot for stability), **`Z/pZ`** (divide via modular inverse, exact), **GF(2)** (XOR + bitsets, 64× fast).
- When asked about solvability, reach for **rank** and **Rouché–Capelli**: consistent ⟺ `rank(A) = rank([A|b])`; unique ⟺ rank = #unknowns; else free variables.
- Mention the **determinant = signed product of pivots** and the link to siblings `18-matrix-determinant` and `19-matrix-rank` — one elimination, multiple readouts.
- Always offer to verify the **residual** `A·x ≈ b` (float) or `A·x ≡ b mod p` (field) on small inputs.
