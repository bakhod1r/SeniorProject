# Matrix Determinant — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the determinant logic and validate against the evaluation criteria.
> **Always test against a cofactor-expansion oracle on small matrices (n ≤ 8) before trusting the O(n^3) elimination result.**

---

## Beginner Tasks (5)

### Task 1 — 2×2 and 3×3 determinant by hand formula

**Problem.** Implement `det2(a, b, c, d) = a·d − b·c` and `det3(matrix)` using Sarrus / cofactor expansion for a `3×3`. No elimination — just the closed formulas.

**Input / Output spec.**
- Read a flag (`2` or `3`), then the entries of the matrix row by row.
- Print the single determinant value.

**Constraints.**
- Entries are integers in `[−10^4, 10^4]`. Results fit in `int64`.

**Hint.** `det3([[a,b,c],[d,e,f],[g,h,i]]) = a(ei−fh) − b(di−fg) + c(dh−eg)`. Mind the alternating signs `+ − +`.

**Starter — Go.**
```go
package main

import "fmt"

func det2(a, b, c, d int64) int64 {
	// TODO: a*d - b*c
	return 0
}

func det3(m [][]int64) int64 {
	// TODO: cofactor expansion along row 0
	return 0
}

func main() {
	var flag int
	fmt.Scan(&flag)
	if flag == 2 {
		var a, b, c, d int64
		fmt.Scan(&a, &b, &c, &d)
		fmt.Println(det2(a, b, c, d))
	} else {
		m := make([][]int64, 3)
		for i := range m {
			m[i] = make([]int64, 3)
			for j := range m[i] {
				fmt.Scan(&m[i][j])
			}
		}
		fmt.Println(det3(m))
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long det2(long a, long b, long c, long d) {
        // TODO
        return 0;
    }

    static long det3(long[][] m) {
        // TODO: cofactor expansion along row 0
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int flag = sc.nextInt();
        if (flag == 2) {
            System.out.println(det2(sc.nextLong(), sc.nextLong(), sc.nextLong(), sc.nextLong()));
        } else {
            long[][] m = new long[3][3];
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++) m[i][j] = sc.nextLong();
            System.out.println(det3(m));
        }
    }
}
```

**Starter — Python.**
```python
import sys


def det2(a, b, c, d):
    # TODO
    return 0


def det3(m):
    # TODO: cofactor expansion along row 0
    return 0


def main():
    data = iter(sys.stdin.read().split())
    flag = int(next(data))
    if flag == 2:
        a, b, c, d = (int(next(data)) for _ in range(4))
        print(det2(a, b, c, d))
    else:
        m = [[int(next(data)) for _ in range(3)] for _ in range(3)]
        print(det3(m))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `det2(1,2,3,4) = −2`; `det3([[2,1,1],[4,3,3],[8,7,9]]) = 4`.
- Correct alternating signs in the `3×3`.
- Verified against a hand calculation.

---

### Task 2 — Determinant via Gaussian elimination (float)

**Problem.** Given an `n×n` real matrix, compute `det(A)` using Gaussian elimination with partial pivoting. Return the product of pivots times the swap sign.

**Input / Output spec.**
- Read `n`, then the matrix (`n` rows of `n` reals).
- Print `det(A)` to 4 decimal places.

**Constraints.** `1 ≤ n ≤ 500`, entries are real.

**Hint.** Copy the input (elimination is destructive). Pick the largest-magnitude pivot in each column; flip the running sign on each swap; multiply pivots into `det`; eliminate below with row-adds (no det change).

**Reference oracle (Python) — use this to validate.**
```python
def det_cofactor(a):
    n = len(a)
    if n == 1:
        return a[0][0]
    return sum(((-1) ** j) * a[0][j] *
               det_cofactor([row[:j] + row[j + 1:] for row in a[1:]])
               for j in range(n))
```

**Evaluation criteria.**
- `n = 1` returns `A[0][0]`.
- Matches `det_cofactor` (within `1e-6`) for `n ≤ 8`.
- Singular matrices (duplicate row) return ≈ `0`. `O(n^3)`.

---

### Task 3 — Detect a singular matrix

**Problem.** Given an `n×n` matrix, output `SINGULAR` if `det(A) = 0` (rows linearly dependent) and `INVERTIBLE` otherwise. Use exact arithmetic (Bareiss or mod `p`) so the verdict is reliable.

**Input / Output spec.**
- Read `n`, then the integer matrix.
- Print `SINGULAR` or `INVERTIBLE`.

**Constraints.** `1 ≤ n ≤ 200`, integer entries.

**Hint.** During elimination, if some column has no nonzero pivot at or below the diagonal, the matrix is singular. Prefer exact arithmetic — a float `det` near `0` is unreliable for this verdict.

**Worked check.** A matrix with two identical rows (or a zero row) is singular. The identity matrix is invertible (`det = 1`).

**Evaluation criteria.**
- Duplicate-row and zero-row matrices report `SINGULAR`.
- The identity reports `INVERTIBLE`.
- Uses exact arithmetic, not a float threshold.

---

### Task 4 — Determinant of a triangular matrix

**Problem.** Given an upper-triangular (or lower-triangular) `n×n` matrix, return its determinant directly as the product of the diagonal — no elimination needed.

**Input / Output spec.**
- Read `n`, then the matrix.
- Print the product of the diagonal entries.

**Constraints.** `1 ≤ n ≤ 1000`, integer entries; the product fits in `int64` for the given tests.

**Hint.** `det(triangular) = ∏ A[i][i]`. This is the base case that the whole elimination method exploits — once `A` is triangular, the answer is immediate.

**Evaluation criteria.**
- Correct product for an explicit triangular matrix.
- Matches the general elimination determinant for triangular inputs.
- `O(n)` after confirming triangular structure.

---

### Task 4b — Determinant of a permutation matrix

**Problem.** Given a permutation `p` of `{0, …, n−1}`, build the permutation matrix `P` (`P[i][p[i]] = 1`, else `0`) and return `det(P)`, which is the sign of the permutation (`+1` or `−1`).

**Input / Output spec.**
- Read `n`, then the permutation `p[0..n−1]`.
- Print `+1` or `−1`.

**Constraints.** `1 ≤ n ≤ 1000`, `p` is a valid permutation.

**Hint.** `det(P) = (−1)^{number of transpositions}`. Count inversions, or count the parity of the number of swaps needed to sort `p`, or run elimination and read the swap sign. The determinant of a permutation matrix is exactly `sgn(p)`.

**Evaluation criteria.**
- Identity permutation → `+1`.
- A single transposition → `−1`.
- Matches `det` computed by elimination on the built matrix.

---

### Task 5 — Determinant scales: `det(cA) = c^n · det(A)`

**Problem.** Given `A` (`n×n`), a scalar `c`, and the precomputed `det(A)`, verify the property `det(c·A) = c^n · det(A)` by computing both sides and comparing (exact integer arithmetic).

**Input / Output spec.**
- Read `n`, `c`, then `A`.
- Print `det(A)`, `det(cA)`, and `OK` if `det(cA) == c^n · det(A)`, else `MISMATCH`.

**Constraints.** `1 ≤ n ≤ 50`, small integer `c`, integer entries; use big integers if needed.

**Hint.** Multiply every entry of `A` by `c` to form `cA`, compute both determinants via Bareiss, and check `det(cA) == pow(c, n) · det(A)`.

**Evaluation criteria.**
- The property holds for several random matrices and scalars.
- Uses exact arithmetic (no float rounding).
- Correctly raises `c` to the power `n` (not `n−1`).

---

## Intermediate Tasks (5)

### Task 6 — Determinant mod p (finite field)

**Problem.** Given an `n×n` integer matrix and a prime `p`, compute `det(A) mod p` exactly using `Z/pZ` elimination with modular-inverse pivots.

**Constraints.** `1 ≤ n ≤ 500`, `p` prime (e.g. `10^9 + 7`), entries any integers.

**Hint.** Reduce entries mod `p` first. Pivoting needs only a nonzero entry. Divide by the pivot = multiply by `pow(pivot, p−2, p)` (Fermat). Flip the sign mod `p` with `det = (p − det) % p` on each swap.

**Reference oracle (Python).**
```python
def det_cofactor_mod(a, p):
    n = len(a)
    if n == 1:
        return a[0][0] % p
    return sum(((-1) ** j) * a[0][j] *
               det_cofactor_mod([row[:j] + row[j + 1:] for row in a[1:]], p)
               for j in range(n)) % p
```

**Evaluation criteria.**
- Matches `det_cofactor_mod` for `n ≤ 7`.
- Returns `0` for singular-mod-`p` matrices.
- `O(n^3)`; no overflow (64-bit product before `% p`).

---

### Task 7 — Exact integer determinant via Bareiss

**Problem.** Given an `n×n` integer matrix, compute the exact integer `det(A)` using fraction-free Bareiss elimination. No fractions, no modulus.

**Constraints.** `1 ≤ n ≤ 200`, entries in `[−10^6, 10^6]`. Use big integers (Python native; Go/Java `BigInteger` or `__int128` for the transient).

**Hint.** Update `m[r][k] = (m[r][k]·m[c][c] − m[r][c]·m[c][k]) / prevPivot`, exact integer division. Track the swap sign; initialize `prevPivot = 1`; the answer is `sign · m[n-1][n-1]`.

**Reference oracle (Python).** Use `det_cofactor` from Task 2 for `n ≤ 8`.

**Evaluation criteria.**
- Matches the cofactor oracle exactly for `n ≤ 8`.
- No fractions appear; every intermediate is an integer.
- Handles negative determinants and the singular case (`0`).

---

### Task 8 — Count spanning trees (Kirchhoff matrix-tree)

**Problem.** Given an undirected graph (`n` vertices, edge list), count its spanning trees mod `10^9 + 7`. Build the Laplacian `L = D − A`, delete one row and the same column, and take the determinant of the `(n−1)×(n−1)` minor.

**Constraints.** `1 ≤ n ≤ 300`, simple connected graph.

**Hint.** For each edge `(u,v)`: `L[u][u]++`, `L[v][v]++`, `L[u][v]--`, `L[v][u]--`. Delete the last row/column, then take the determinant mod `p` (reuse Task 6).

**Reference oracle (Python).**
```python
def brute_spanning_trees(n, edges):
    from itertools import combinations
    es = list(edges)
    count = 0
    for comb in combinations(es, n - 1):  # try every (n-1)-edge subset
        parent = list(range(n))
        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        ok = True
        for u, v in comb:
            ru, rv = find(u), find(v)
            if ru == rv:
                ok = False
                break
            parent[ru] = rv
        if ok:
            count += 1
    return count
```

**Evaluation criteria.**
- Triangle (`n=3`) → `3`; `K4` → `16 = 4^2`; `K_n` → `n^{n-2}` (Cayley).
- Matches `brute_spanning_trees` for small graphs.
- `O(n^3)` determinant.

---

### Task 9 — Verify `det(AB) = det(A)·det(B)`

**Problem.** Given two `n×n` integer matrices `A` and `B`, compute `det(A)`, `det(B)`, and `det(AB)` exactly, and confirm `det(AB) == det(A)·det(B)`.

**Constraints.** `1 ≤ n ≤ 60`, integer entries; big integers if needed.

**Hint.** Multiply `A·B` (triple loop), then run Bareiss on all three. The multiplicative law is a strong end-to-end test of your determinant implementation.

**Evaluation criteria.**
- The identity holds for several random `A, B`.
- Also verify the false sibling: `det(A+B) ≠ det(A)+det(B)` in general (print both to show the difference).
- Exact arithmetic; no rounding.

---

### Task 9b — Determinant of a tridiagonal matrix via recurrence

**Problem.** A tridiagonal matrix has nonzero entries only on the main diagonal (`b_i`), the superdiagonal (`c_i`), and the subdiagonal (`a_i`). Compute its determinant in `O(n)` using the continuant recurrence `D_i = b_i·D_{i-1} − a_i·c_{i-1}·D_{i-2}`, with `D_0 = 1`, `D_{-1} = 0`.

**Input / Output spec.**
- Read `n`, then the three diagonals (`b[0..n−1]`, `a[1..n−1]`, `c[0..n−2]`).
- Print the determinant (mod `10^9 + 7` if large).

**Constraints.** `1 ≤ n ≤ 10^5`, integer entries.

**Hint.** This is the special structured case where you do *not* need `O(n^3)` elimination — the band structure gives a linear recurrence (a continuant). Verify against general elimination for small `n`.

**Evaluation criteria.**
- Matches general elimination for `n ≤ 8`.
- Runs in `O(n)` for `n = 10^5`.
- Handles the base cases `D_0 = 1`, `D_1 = b_0`.

---

### Task 10 — Solve a 2×2 / 3×3 system with Cramer's rule

**Problem.** Given a small system `Ax = b` (`n ∈ {2,3}`), solve it with Cramer's rule: `x_i = det(A_i)/det(A)`, where `A_i` is `A` with column `i` replaced by `b`. Return `NO_UNIQUE_SOLUTION` if `det(A) = 0`.

**Constraints.** `n ∈ {2, 3}`, integer entries; output the solution as exact fractions or floats.

**Hint.** Compute `det(A)` once; for each `i`, form `A_i` and compute `det(A_i)`. Note Cramer's rule is `O(n^4)` in general — fine for tiny `n`, but never use it as a large-scale solver.

**Evaluation criteria.**
- Correct unique solution for non-singular systems.
- Reports `NO_UNIQUE_SOLUTION` when `det(A) = 0`.
- Matches a direct Gaussian-elimination solve.

---

## Advanced Tasks (5)

### Task 11 — Exact integer determinant via CRT over multiple primes

**Problem.** Compute the exact integer `det(A)` when the value may exceed a single prime. Run the determinant mod several coprime primes, size the prime set from the Hadamard bound, and reconstruct via CRT, taking the balanced representative for the sign.

**Constraints.** `1 ≤ n ≤ 100`, entries in `[−10^9, 10^9]`.

**Hint.** Compute the Hadamard bound `∏ ‖row_i‖_2` to estimate how many ~`2^31` primes you need so `∏ p > 2·bound`. Run `det_mod_p` per prime, CRT-combine, then if the result exceeds `∏p / 2` subtract `∏p`.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t  # in [0, p1*p2)
```

**Evaluation criteria.**
- Recovers determinants larger than a single prime where the true value is known (compare to Bareiss).
- Correct sign via the balanced representative.
- Enough primes chosen (`∏ p > 2·Hadamard`).

---

### Task 12 — Stable float log-determinant (slogdet)

**Problem.** For a real `n×n` matrix whose determinant may overflow/underflow a `double`, return `(sign, log|det|)` instead of the raw value. Materialize `det = sign·exp(log|det|)` only when it fits.

**Constraints.** `1 ≤ n ≤ 1000`, entries real; some test matrices have determinants outside `double` range.

**Hint.** During elimination, accumulate `logabs += log|pivot|` and flip `sign` for each negative pivot and each row swap. Return `(0, −∞)` for singular.

**Evaluation criteria.**
- For well-scaled matrices, `sign·exp(log|det|)` matches the direct determinant within `1e-6`.
- Does not overflow for a matrix with determinant `> 10^308`.
- Correct sign tracking (swaps and negative pivots).

---

### Task 13 — Hadamard bound and arithmetic selection

**Problem.** Given an integer matrix, compute the Hadamard bound on `|det(A)|`, then *automatically choose* the arithmetic: if the bound fits in `int64`, use native Bareiss; otherwise report how many `~2^31` CRT primes are required and use big-integer Bareiss or CRT.

**Constraints.** `1 ≤ n ≤ 150`, entries in `[−10^9, 10^9]`.

**Hint.** Hadamard: `|det| ≤ ∏ sqrt(Σ_j A[i][j]^2)`. Compare its bit-length to 63 (signed `int64`); if it exceeds, `numPrimes = ceil((bits + 1) / 31)`.

**Evaluation criteria.**
- Correct Hadamard bound (an upper bound on the actual `|det|`).
- Chooses native arithmetic when safe and CRT/big-int when not.
- The chosen path produces the correct exact determinant.

---

### Task 14 — Weighted spanning-tree count (weighted matrix-tree)

**Problem.** Given a weighted undirected graph, compute the sum over all spanning trees of the product of their edge weights (the *weighted* spanning-tree count), mod `10^9 + 7`. Use the weighted Laplacian.

**Constraints.** `1 ≤ n ≤ 200`, integer weights in `[1, 10^9]`.

**Hint.** Weighted Laplacian: `L[u][u] += w`, `L[v][v] += w`, `L[u][v] -= w`, `L[v][u] -= w` for edge `(u,v,w)`. Delete a row/column and take the determinant mod `p`. Unit weights recover the ordinary tree count (Task 8).

**Degree sanity check.** With all weights `1`, the weighted count equals the plain spanning-tree count. For `K_n` with unit weights, the answer is `n^{n-2}`.

**Evaluation criteria.**
- Unit weights reproduce Task 8's counts.
- Correct weighted sum for a small graph verified by brute force over spanning trees.
- `O(n^3)` determinant mod `p`.

---

### Task 15 — Decide when the determinant is the wrong tool

**Problem.** Given a problem statement and constraints, decide whether to compute a determinant and which arithmetic, or whether a different tool is correct. Implement `classify(problem)` returning one of: `DET_FLOAT`, `DET_MOD_P`, `DET_BAREISS`, `DET_CRT`, `USE_RANK_OR_SVD`, or `SOLVE_DIRECTLY`. Justify each.

**Constraints / cases to handle.**
- Real inputs, approximate area/volume → `DET_FLOAT`.
- Exact answer mod a prime → `DET_MOD_P`.
- Exact integer, moderate magnitude → `DET_BAREISS`.
- Exact integer, huge magnitude → `DET_CRT`.
- "How close to singular / conditioning?" → `USE_RANK_OR_SVD` (determinant magnitude is a poor measure).
- "Solve `Ax = b` for large `n`" → `SOLVE_DIRECTLY` (don't compute `det`).

**Hint.** Encode the decision rules from `senior.md`. The traps: using `|det|` for conditioning, and computing a determinant to solve a system.

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `USE_RANK_OR_SVD` branch cites that `|det|` is a poor conditioning measure.
- Justification references the right complexity (`O(n^3)`, `O(n^3)` per prime, etc.).

---

## Benchmark Task

### Task B — Cofactor expansion vs Gaussian elimination crossover

**Problem.** Empirically find the `n` at which Gaussian elimination overtakes cofactor expansion. Implement two determinant routines on a random `n×n` matrix (fixed seed):

- **(a) Cofactor / Laplace expansion:** the recursive `O(n!)` method.
- **(b) Gaussian elimination:** the `O(n^3)` method (float or Bareiss).

Measure wall-clock time for `n ∈ {3, 5, 7, 9, 11, 13}` for (a) and `n ∈ {3, 10, 50, 100, 300}` for (b). Report a table and identify the `n` where cofactor expansion becomes infeasible.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_matrix(n: int, seed: int) -> List[List[int]]:
    r = random.Random(seed)
    return [[r.randint(-5, 5) for _ in range(n)] for _ in range(n)]


def det_cofactor(a):
    # TODO: O(n!) recursive expansion
    n = len(a)
    if n == 1:
        return a[0][0]
    return 0


def det_elim(a):
    # TODO: O(n^3) Bareiss or float elimination
    return 0


def bench(fn, A) -> float:
    start = time.perf_counter()
    fn([row[:] for row in A])
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n     cofactor_ms        elim_ms")
    for n in [3, 5, 7, 9, 11, 13]:
        A = gen_matrix(n, 42)
        re = [bench(det_elim, A) for _ in range(3)]
        if n <= 11:
            rc = [bench(det_cofactor, A) for _ in range(3)]
            print(f"{n:<5d} {mean_ms(rc):<18.3f} {mean_ms(re):<12.3f}")
        else:
            print(f"{n:<5d} {'(skipped)':<18} {mean_ms(re):<12.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same matrix across Go, Java, and Python.
- Cofactor (a) and elimination (b) agree on the exact value for small `n`.
- Cofactor becomes infeasible around `n ≈ 12`; elimination handles `n = 300` in well under a second.
- Report includes the mean across at least 3 runs and does not time matrix generation or cloning.
- Writeup: a short note on the measured crossover `n` versus the theoretical `n! vs n^3`.

---

## General Guidance for All Tasks

- **Always validate against the cofactor oracle first.** Every exact task ships with (or references) a slow `O(n!)` cofactor expansion. Run it on small `n`, diff, and only then trust the elimination version on large `n`.
- **Pick the arithmetic to match the requirement.** Float (approximate), `Z/pZ` (exact-bounded), Bareiss (exact-integer), CRT (exact-huge). Never use floats when an exact `det == 0` decision matters.
- **Track the swap sign in one place.** The single most common bug is a missing or misplaced sign flip. Property-test `det(swap(A)) == −det(A)`.
- **Always pivot.** Partial pivoting for floats (stability); any-nonzero pivot for `Z/pZ`/Bareiss (correctness). No pivot in a column ⇒ singular ⇒ `det = 0`.
- **Divide by modular inverse in `Z/pZ`,** never integer-divide. The Bareiss division is exact integer division (no remainder), so `//` / `/` is correct there.
- **Size exact arithmetic via Hadamard.** `|det| ≤ (B√n)^n` tells you whether `int64` suffices and how many CRT primes you need.
- **Copy the input.** Elimination is destructive; never mutate the caller's matrix.
- **Don't use `|det|` for conditioning** or compute a determinant to solve a linear system — both are senior-level traps (Task 15).

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
