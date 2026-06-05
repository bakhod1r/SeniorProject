# Gaussian Elimination (Solving Linear Systems) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the elimination logic and validate against the evaluation criteria.
> **Always verify the residual — `A·x ≈ b` (reals, within a tolerance) or `A·x ≡ b mod p` (fields) — on small inputs before trusting the solver.**

---

## Beginner Tasks (5)

### Task 1 — Forward elimination to row-echelon form

**Problem.** Implement `forward_eliminate(m)` that takes an `n × (n+1)` augmented matrix of reals and reduces it to row-echelon form using **partial pivoting** (swap the largest-magnitude entry in each column into the pivot position). Do not back-substitute yet.

**Input / Output spec.**
- Read `n`, then `n` rows of `n+1` floats (the augmented matrix `[A | b]`).
- Print the row-echelon matrix, one row per line, values space-separated, 4 decimals.

**Constraints.**
- `1 ≤ n ≤ 100`. Treat `|pivot| < 1e-12` as singular and print `SINGULAR`.

**Hint.** For each column `col`, find `argmax_{r≥col} |m[r][col]|`, swap it to row `col`, then for `r > col` do `m[r] -= (m[r][col]/m[col][col]) · m[col]`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
)

func forwardEliminate(m [][]float64) bool {
	n := len(m)
	for col := 0; col < n; col++ {
		// TODO: partial pivot, swap, eliminate below
		_ = col
		_ = math.Abs
	}
	return true
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(reader, &n)
	m := make([][]float64, n)
	for i := range m {
		m[i] = make([]float64, n+1)
		for j := range m[i] {
			fmt.Fscan(reader, &m[i][j])
		}
	}
	if !forwardEliminate(m) {
		fmt.Println("SINGULAR")
		return
	}
	for _, row := range m {
		for j, v := range row {
			if j > 0 {
				fmt.Print(" ")
			}
			fmt.Printf("%.4f", v)
		}
		fmt.Println()
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean forwardEliminate(double[][] m) {
        int n = m.length;
        for (int col = 0; col < n; col++) {
            // TODO: partial pivot, swap, eliminate below
        }
        return true;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        double[][] m = new double[n][n + 1];
        for (int i = 0; i < n; i++)
            for (int j = 0; j <= n; j++) m[i][j] = sc.nextDouble();
        if (!forwardEliminate(m)) { System.out.println("SINGULAR"); return; }
        StringBuilder sb = new StringBuilder();
        for (double[] row : m) {
            for (int j = 0; j <= n; j++) {
                if (j > 0) sb.append(' ');
                sb.append(String.format("%.4f", row[j]));
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys

EPS = 1e-12


def forward_eliminate(m):
    n = len(m)
    for col in range(n):
        # TODO: partial pivot, swap, eliminate below
        pass
    return True


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    m = [[float(next(data)) for _ in range(n + 1)] for _ in range(n)]
    if not forward_eliminate(m):
        print("SINGULAR")
        return
    print("\n".join(" ".join(f"{v:.4f}" for v in row) for row in m))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct partial pivoting (largest magnitude swapped in).
- Zeros below every pivot; upper-triangular result.
- `SINGULAR` reported when a column has no usable pivot.

---

### Task 2 — Back substitution

**Problem.** Given an `n × (n+1)` matrix already in row-echelon form (upper triangular, non-zero diagonal), implement `back_substitute(m)` returning the solution vector `x`.

**Input / Output spec.**
- Read `n`, then the REF augmented matrix.
- Print `x[0] … x[n-1]` space-separated, 4 decimals.

**Constraints.** `1 ≤ n ≤ 100`, all diagonal entries non-zero.

**Hint.** Loop `i` from `n-1` down to `0`: `x[i] = (m[i][n] - Σ_{c>i} m[i][c]·x[c]) / m[i][i]`.

**Evaluation criteria.**
- Matches hand calculation on the `3×3` example (`x = [2,3,-1]`).
- `O(n²)`.
- Combined with Task 1, solves any non-singular real system.

---

### Task 3 — Full real solver with residual check

**Problem.** Combine Tasks 1 and 2 into `solve(A, b)` that returns `x` or `None`/`null` if singular. Then implement `residual(A, x, b)` returning `max_i |Σ_j A[i][j]·x[j] − b[i]|` and assert it is `< 1e-9` for solvable systems.

**Input / Output spec.**
- Read `n`, `A` (`n × n`), `b`.
- Print `x` (4 decimals) and the residual.

**Constraints.** `1 ≤ n ≤ 200`, well-conditioned `A`.

**Hint.** Augment, forward-eliminate with partial pivoting, back-substitute, then compute the residual as a correctness oracle.

**Evaluation criteria.**
- Residual `< 1e-9` on well-conditioned inputs.
- Correctly reports singular systems.
- Same answer across Go, Java, Python.

---

### Task 4 — Mod-p solver (unique solution)

**Problem.** Implement `solve_mod_p(A, b)` over `Z/pZ` with `p = 10^9 + 7`, returning the unique solution mod `p` or reporting "no unique solution". Divide by pivots using the modular inverse (`pivot^{p-2} mod p`).

**Input / Output spec.**
- Read `n`, `A`, `b` (integers, may be negative).
- Print `x[0] … x[n-1]` mod `p`, or `NO_UNIQUE`.

**Constraints.** `1 ≤ n ≤ 200`, entries fit in `int64`.

**Hint.** Normalize entries to `[0, p)` first. Any non-zero pivot works (no magnitude pivoting). Reduce after every multiply to avoid overflow.

**Worked check.** For `A = [[2,1],[1,3]], b = [5,10]`: the exact rational solution is `x = (1, 3)`; over `Z/pZ` you should get `[1, 3]`.

**Evaluation criteria.**
- Exact result mod `p` (verify `A·x ≡ b mod p`).
- `NO_UNIQUE` when the matrix is singular mod `p`.
- No overflow (64-bit products before `% p`).

---

### Task 5 — GF(2) solver with integer-bitset rows

**Problem.** Implement `solve_gf2(rows, n)` where each row is an `(n+1)`-bit integer (bit `c` = coefficient of `x_c`, bit `n` = right-hand side). Return any satisfying 0/1 assignment, or "no solution". Use XOR for row operations.

**Input / Output spec.**
- Read `n`, `numRows`, then `numRows` integers (each a packed row).
- Print the assignment `x[0] … x[n-1]`, or `NO_SOLUTION`.

**Constraints.** `1 ≤ n ≤ 60` (fits in one 64-bit word), `numRows ≤ 10^4`.

**Hint.** For each column, find a row with a `1` there, XOR it into every other row with a `1` there, record the pivot row. After elimination, an all-zero coefficient row with `b = 1` means no solution; free variables default to `0`.

**Evaluation criteria.**
- Correct XOR elimination and pivot tracking.
- Detects inconsistency (`0 = 1`).
- Matches a brute-force `2^n` enumeration for small `n`.

---

## Intermediate Tasks (5)

### Task 6 — Classify: no solution / unique / infinitely many (reals)

**Problem.** Given an `m × n` real system `[A | b]`, classify it as `NO_SOLUTION`, `UNIQUE`, or `INFINITE`, and output the **rank** and the number of **free variables**. Use a tolerance `eps` for zero tests.

**Input / Output spec.**
- Read `m`, `n`, the `m × n` matrix `A`, then `b`.
- Print the classification, `rank`, and `free = n − rank` (only meaningful when consistent).

**Constraints.** `1 ≤ m, n ≤ 100`.

**Hint.** Track `where[col]` (the pivot row of each column). After RREF, scan for an inconsistent row (`all coeffs ~0` but `b` not). Then `rank = #pivots`; unique iff `rank == n`; else infinite.

**Reference oracle (Python) — compare against numpy.**
```python
import numpy as np


def oracle(A, b):
    A = np.array(A, float); b = np.array(b, float)
    ra = np.linalg.matrix_rank(A)
    rab = np.linalg.matrix_rank(np.column_stack([A, b]))
    if ra != rab:
        return "NO_SOLUTION"
    return "UNIQUE" if ra == A.shape[1] else "INFINITE"
```

**Evaluation criteria.**
- Matches the Rouché–Capelli verdict on random and crafted systems.
- Correct rank and free-variable count.
- Agrees with the numpy oracle.

---

### Task 7 — Matrix inverse via Gauss-Jordan

**Problem.** Implement `inverse(A)` over the reals returning `A⁻¹`, or `None` if singular. Augment `A` with the identity `[A | I]` and row-reduce to `[I | A⁻¹]` (full RREF with partial pivoting).

**Input / Output spec.**
- Read `n`, then `A` (`n × n`).
- Print `A⁻¹` (4 decimals) or `SINGULAR`.

**Constraints.** `1 ≤ n ≤ 100`, well-conditioned `A`.

**Hint.** Build the `n × 2n` augmented matrix. Reduce each pivot to `1` and clear its column everywhere. The right half becomes the inverse. Verify `A · A⁻¹ ≈ I`.

**Evaluation criteria.**
- `A · A⁻¹` is the identity within `1e-9`.
- `SINGULAR` for non-invertible `A`.
- `O(n³)`.

---

### Task 8 — Mod-p inverse via Gauss-Jordan

**Problem.** Implement `inverse_mod_p(A)` over `Z/pZ` (prime `p = 10^9 + 7`), returning `A⁻¹ mod p` or "singular". Same Gauss-Jordan structure as Task 7, but exact, dividing by the modular inverse.

**Constraints.** `1 ≤ n ≤ 150`.

**Hint.** Augment `[A | I]` mod `p`, eliminate using the pivot's modular inverse, read the right half. Verify `A · A⁻¹ ≡ I mod p`.

**Evaluation criteria.**
- `A · A⁻¹ ≡ I (mod p)` exactly.
- Reports singular when `det(A) ≡ 0 mod p`.
- No overflow.

---

### Task 9 — Determinant via elimination

**Problem.** Implement `determinant(A)` for an `n × n` real matrix as the signed product of pivots: `det = (−1)^{#swaps} · ∏ diagonal pivots` after forward elimination with partial pivoting. (See sibling `18-matrix-determinant`.)

**Constraints.** `1 ≤ n ≤ 200`. Return `0.0` if singular.

**Hint.** Track the swap parity. Each row swap flips the sign; add-multiple operations leave the determinant unchanged. After triangularization, multiply the diagonal by the sign.

**Reference oracle (Python).**
```python
import numpy as np


def oracle_det(A):
    return float(np.linalg.det(np.array(A, float)))
```

**Evaluation criteria.**
- Matches numpy `det` within a relative tolerance on random matrices.
- Correct sign (test on a known swap-inducing matrix).
- `det = 0` for singular matrices.

---

### Task 10 — Solve over `Z/pZ` with free variables (general solution)

**Problem.** Given an `m × n` system over `Z/pZ` that may be under-determined, return either `NO_SOLUTION` or a **particular solution** (free variables set to `0`) together with a basis of the homogeneous null space (one vector per free variable). Count solutions as `p^{n−rank}`.

**Constraints.** `1 ≤ m, n ≤ 100`, prime `p = 998244353`.

**Hint.** RREF tracking `where[col]`. Particular solution: set free vars to `0`, read each basic var from its pivot row. Null-space basis: for each free column `f`, set `x_f = 1`, others free to `0`, and solve for the basic vars.

**Evaluation criteria.**
- `NO_SOLUTION` when inconsistent.
- Particular solution satisfies `A·x ≡ b`; each null-space vector satisfies `A·v ≡ 0`.
- Reports `p^{n−rank}` as the solution count.

---

## Advanced Tasks (5)

### Task 11 — CRT-combined exact rational solve

**Problem.** Solve `A·x = b` for an integer matrix exactly over the rationals. Solve mod two coprime primes, CRT-combine the residues, and use rational reconstruction (continued fractions, sibling `16`) to recover each `x_i = num/den`. Output reduced fractions.

**Constraints.** `1 ≤ n ≤ 40`, integer entries with `|·| ≤ 1000`; answer numerators/denominators bounded so reconstruction succeeds.

**Hint.** Run `solve_mod_p` under `p₁ = 10^9+7` and `p₂ = 998244353`, CRT to get each coordinate mod `p₁·p₂`, then reconstruct the fraction with the half-GCD / continued-fraction bound `|num|, |den| < √(P/2)`.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t  # in [0, p1*p2)
```

**Evaluation criteria.**
- Recovers exact fractions for systems with a known rational solution.
- Each modular run agrees with `(true) mod pᵢ`.
- Reconstructed fractions are in lowest terms and satisfy `A·x = b` exactly.

---

### Task 12 — Fraction-free (Bareiss) integer determinant

**Problem.** Implement Bareiss fraction-free elimination to compute the **exact integer determinant** of an `n × n` integer matrix without floating point and without fractions. Compare against the modular determinant under a large prime.

**Constraints.** `1 ≤ n ≤ 60`, integer entries `|·| ≤ 1000`. Use big integers (Go `math/big`, Java `BigInteger`, Python native int).

**Hint.** Bareiss update: `m[i][j] = (m[k][k]·m[i][j] − m[i][k]·m[k][j]) / prevPivot`, with `prevPivot` starting at `1`. The division is always exact. The final pivot is the determinant (up to swap sign).

**Evaluation criteria.**
- Exact determinant for matrices where the true value is known (e.g. Vandermonde).
- Agrees with the mod-p determinant reduced mod `p`.
- No overflow (big integers) and exact divisions throughout.

---

### Task 13 — GF(2) system at scale with multi-word bitsets

**Problem.** Solve a GF(2) XOR system with `n` up to `2000` variables by packing each row into an array of 64-bit words and XORing word-by-word. Report a solution or `NO_SOLUTION`, and the number of free variables.

**Constraints.** `1 ≤ n ≤ 2000`, `numRows ≤ 4000`.

**Hint.** Each row is `⌈(n+1)/64⌉` words. The pivot test reads bit `col`; the elimination XORs whole word arrays. This is the `O(n³/64)` solve. Use `[]uint64` (Go), `long[]` / `BitSet` (Java), or Python big ints.

**Degree / sanity check.** Verify `A·x ≡ b` over GF(2) by recomputing each equation's XOR; assert it equals the stored `b` bit for every row.

**Evaluation criteria.**
- Handles `n = 2000` within a fraction of a second.
- Correct word-parallel XOR (matches a single-bit reference for small `n`).
- Correct free-variable count and inconsistency detection.

---

### Task 14 — LU factorization with multi-RHS reuse

**Problem.** Implement `lu_decompose(A)` returning `PA = LU` (in place, with a permutation array and swap parity), then `lu_solve(LU, perm, b)` answering each right-hand side in `O(n²)`. Solve a batch of `Q` right-hand sides sharing one `A`.

**Constraints.** `1 ≤ n ≤ 300`, `1 ≤ Q ≤ 1000`.

**Hint.** Store the multipliers in the lower triangle of the factored matrix. `lu_solve` does forward substitution with `L` (unit diagonal) then back substitution with `U`. Determinant falls out as `sign · ∏ U[i][i]`.

**Evaluation criteria.**
- Factor once (`O(n³)`); each solve `O(n²)`.
- All `Q` solutions match an independent per-RHS Gaussian solve.
- Determinant from the factorization matches Task 9.

---

### Task 15 — Decide the right tool / field for a system

**Problem.** Given a problem description with `(type, n, sparsity, field, conditioning)`, implement `classify_method(problem)` returning one of `REAL_PARTIAL_PIVOT`, `CHOLESKY`, `MOD_P`, `GF2_BITSET`, `BAREISS_EXACT`, `SPARSE_DIRECT`, `ITERATIVE`, or `SVD_REGULARIZE`, with a one-line justification.

**Constraints / cases to handle.**
- Dense real, well-conditioned, unique → `REAL_PARTIAL_PIVOT`.
- Symmetric positive-definite → `CHOLESKY`.
- Exact answer mod prime → `MOD_P`; exact integer determinant → `BAREISS_EXACT`.
- XOR/boolean equations → `GF2_BITSET`.
- Huge sparse → `SPARSE_DIRECT` or `ITERATIVE`.
- Severely ill-conditioned / least-squares / rank-deficient → `SVD_REGULARIZE`.

**Hint.** Encode the decision rules from `senior.md` (§decision summary). The trap is treating an exact problem with floats (rounding) or an ill-conditioned one as if pivoting could save it.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- Justification cites the right complexity and the failure mode avoided (rounding, fill-in, conditioning, overflow).
- References the matching sibling topic where relevant (`14`, `18`, `19`, `18-bit-manipulation`).

---

## Benchmark Task

### Task B — Dense vs bitset GF(2), and float vs mod-p timing

**Problem.** Empirically compare solver variants on random systems of fixed size `n`:

- **(a) Real solver** (`double`, partial pivoting) — `O(n³)`.
- **(b) Mod-p solver** (`Z/pZ`, modular inverse) — `O(n³)`.
- **(c) GF(2) single-bit** elimination (boolean array per row) — `O(n³)`.
- **(d) GF(2) bitset** elimination (packed 64-bit words) — `O(n³/64)`.

Measure wall-clock time for `n ∈ {50, 100, 200, 500}` (skip variants that get too slow) and report a table. Confirm (d) is roughly 64× faster than (c).

**Starter — Python.**
```python
import random
import time
from typing import List

MOD = 1_000_000_007


def gen_real(n, seed):
    r = random.Random(seed)
    A = [[r.uniform(-1, 1) for _ in range(n)] for _ in range(n)]
    b = [r.uniform(-1, 1) for _ in range(n)]
    return A, b


def gen_gf2(n, seed):
    r = random.Random(seed)
    # each row a packed (n+1)-bit integer
    return [r.getrandbits(n + 1) for _ in range(n)]


def solve_real(A, b):
    # TODO: partial pivoting, O(n^3)
    return [0.0] * len(A)


def solve_gf2_bits(rows, n):
    # TODO: per-bit boolean elimination, O(n^3)
    return [0] * n


def solve_gf2_bitset(rows, n):
    # TODO: integer-word XOR elimination, O(n^3/64)
    return [0] * n


def bench(fn, *args) -> float:
    start = time.perf_counter()
    fn(*args)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n      real_ms     gf2_bits_ms   gf2_bitset_ms")
    for n in [50, 100, 200, 500]:
        A, b = gen_real(n, 7)
        rows = gen_gf2(n, 7)
        rr = [bench(solve_real, [r[:] for r in A], b[:]) for _ in range(3)]
        rg = [bench(solve_gf2_bitset, rows[:], n) for _ in range(3)]
        if n <= 200:
            rb = [bench(solve_gf2_bits, rows[:], n) for _ in range(3)]
            print(f"{n:<6d} {mean_ms(rr):<11.2f} {mean_ms(rb):<13.2f} {mean_ms(rg):<.2f}")
        else:
            print(f"{n:<6d} {mean_ms(rr):<11.2f} {'(skipped)':<13} {mean_ms(rg):<.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same system across Go, Java, and Python.
- The bitset GF(2) solver (d) is roughly 64× faster than the per-bit version (c).
- Real and mod-p solvers scale as `O(n³)`; report the measured constants.
- Report includes the mean across at least 3 runs and excludes generation/cloning time.
- Writeup: a short note on which field is cheapest per element and why (bit-parallelism, modular reduction cost, float FLOPs).

---

## General Guidance for All Tasks

- **Always verify the residual first.** `A·x ≈ b` (reals, within `eps`) or `A·x ≡ b mod p` (fields). It catches the overwhelming majority of bugs.
- **Pivot by field.** Largest magnitude for floats (stability); any non-zero for `Z/pZ` and GF(2) (correctness only).
- **Use `eps`, not `== 0`, for floats.** Exact-zero comparisons misclassify rank and consistency after float arithmetic.
- **Mind overflow in mod-p.** Normalize entries to `[0, p)`, use 64-bit products, and reduce after every multiply; for large `p` use 128-bit or Montgomery (sibling `14`).
- **Divide by the modular inverse, not by `1/pivot`,** over `Z/pZ` (siblings `04`, `06`). Over GF(2) the only inverse is `1`, so just XOR.
- **Track `where[col]`** to report rank, free variables, and the general solution (Rouché–Capelli).
- **Factor once, solve many.** For multiple right-hand sides, compute `A = LU` once and reuse (`O(n²)` per `b`); never invert to solve.
- **Use bitsets for GF(2)** — the 64× word-parallel XOR is the difference between feasible and not at scale.
- **Get `A^0`/the identity case right per field.** The pivot of a `1×1` system, the empty system, and the identity matrix are the cheap edge cases that catch off-by-one and base-case bugs.
- **Distinguish the three verdicts cleanly.** No solution (inconsistent row `0…0|c`, `c≠0`), unique (rank = unknowns), infinitely many (a free column). Conflating "no solution" with "infinitely many" is the most common classification bug.

### Suggested progression

1. **Beginner (Tasks 1–5):** master the mechanics — forward elimination, back substitution, the full real solver, then the two exact fields (mod-p, GF(2)).
2. **Intermediate (Tasks 6–10):** classification by rank, inverses (real and mod-p), determinant, free-variable general solutions, and the real-valued (Markov-style) variant.
3. **Advanced (Tasks 11–15):** exact rational solving via CRT + reconstruction, fraction-free Bareiss determinants, GF(2) at scale with multi-word bitsets, LU reuse across many right-hand sides, and the meta-skill of choosing the right method/field.

Do not skip the residual check at any level — it is the single habit that separates a solver you can trust from one you merely hope works.

### Bugs the test cases are designed to catch

| Test input | Bug it exposes |
|------------|----------------|
| `k = 0` / `1×1` system | wrong base case, off-by-one in loops |
| Matrix needing a pivot swap (zero on the diagonal) | missing pivot search / division by zero |
| Hilbert / near-singular matrix | no condition awareness; returning noise as if exact |
| Singular matrix (duplicate row) | failure to detect "no unique solution" |
| Inconsistent system (`0 = c`) | missing the consistency scan |
| Rank-deficient consistent system | wrong free-variable count; reporting unique when infinite |
| Negative entries (mod-p) | unnormalized residues differing across languages |
| Large `p` (near `2^62`) | overflow before the modular reduction |
| Wide GF(2) system (`n > 64`) | single-word assumption; multi-word XOR bugs |

Build each of these into your test suite. A solver that passes all of them on randomized instances — verified by the residual — is production-grade; one validated only on the worked `3×3` example is not.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
