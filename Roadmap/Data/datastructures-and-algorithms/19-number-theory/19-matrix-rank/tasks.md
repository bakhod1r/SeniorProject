# Matrix Rank — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the row-reduction-and-count-pivots logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs** — for rank, verify `rank(A) == rank(Aᵀ)` and `rank + nullity == n`; for GF(2) solution counts, enumerate all `2^n` assignments for small `n`.

---

## How to Use These Tasks

Work top to bottom: Beginner tasks build the core `rank` routine over the reals and GF(2); Intermediate tasks layer on the field variants (Z/pZ), solvability, and solution counting; Advanced tasks cover production concerns (exactness, streaming, numerical stability, codes). The Benchmark task ties the fields together empirically. For every task:

1. **Implement in all three languages** (Go, Java, Python) with identical outputs on the same seeded inputs.
2. **Validate against the listed oracle or invariant** before trusting large inputs.
3. **Pin constants** (`EPS`, `MOD`) and **name the field** you are over.

The recurring invariants that catch almost every bug:

- `rank(A) == rank(Aᵀ)` — row rank equals column rank; catches asymmetric pivot bugs.
- `rank ≤ min(m, n)` — a rank exceeding either dimension is impossible.
- `rank + nullity == n` — rank-nullity; verify by constructing the null space.
- GF(2) solution counts are `0` or a power of 2 (`2^{n−rank}`).

---

## Beginner Tasks (5)

### Task 1 — Rank of a real matrix

**Problem.** Implement `rank(A)` for an `m × n` real matrix using Gaussian elimination with a tolerance `eps = 1e-9`. Count the nonzero pivots; a row that reduces below `eps` everywhere is a zero (dependent) row and does not count.

**Input / Output spec.**
- Read `m`, `n`, then `A` (`m` rows of `n` reals).
- Print the single integer rank.

**Constraints.**
- `1 ≤ m, n ≤ 200`.
- Use partial pivoting (pick the largest-magnitude pivot candidate).

**Hint.** Maintain a `rowPivot` counter; advance it **only** when a pivot is found, never on a skipped column. Eliminate from `col` onward. The single most common bug here is advancing `rowPivot` on a column that had no pivot — guard against it by incrementing only inside the "pivot found" branch.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

const EPS = 1e-9

func rank(mat [][]float64) int {
	// TODO: row-reduce with partial pivoting; count pivots
	_ = math.Abs
	return 0
}

func main() {
	var m, n int
	fmt.Scan(&m, &n)
	a := make([][]float64, m)
	for i := range a {
		a[i] = make([]float64, n)
		for j := range a[i] {
			fmt.Scan(&a[i][j])
		}
	}
	fmt.Println(rank(a))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final double EPS = 1e-9;

    static int rank(double[][] mat) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int m = sc.nextInt(), n = sc.nextInt();
        double[][] a = new double[m][n];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < n; j++) a[i][j] = sc.nextDouble();
        System.out.println(rank(a));
    }
}
```

**Starter — Python.**
```python
import sys

EPS = 1e-9


def rank(mat):
    # TODO
    return 0


def main():
    data = iter(sys.stdin.read().split())
    m, n = int(next(data)), int(next(data))
    a = [[float(next(data)) for _ in range(n)] for _ in range(m)]
    print(rank(a))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct rank on a known case (`[[1,2,3],[2,4,6],[0,1,1]] → 2`).
- Zero matrix → `0`; identity → `n`.
- `rank(A) == rank(Aᵀ)` on random inputs.

---

### Task 2 — Test linear independence

**Problem.** Given `k` vectors of length `n`, decide whether they are linearly independent. Stack them as rows and return `true` iff the rank equals `k`.

**Input / Output spec.**
- Read `k`, `n`, then the `k` vectors.
- Print `INDEPENDENT` or `DEPENDENT`.

**Constraints.** `1 ≤ k, n ≤ 200`, real entries.

**Hint.** Reuse `rank` from Task 1. Independent iff `rank == k`. If `k > n`, they are automatically dependent.

**Evaluation criteria.**
- `[[1,0],[0,1]]` → INDEPENDENT; `[[1,2],[2,4]]` → DEPENDENT.
- `k > n` always DEPENDENT.
- Matches a hand check on small cases.

**Why this works.** Linear independence is *defined* by "rank equals count": if all `k` rows survive as pivots, none was a combination of the others. The `k > n` shortcut follows from `rank ≤ min(k, n) ≤ n < k`, so the rank can never reach `k`. This task is the practical entry point to the entire "rank measures independence" theme.

---

### Task 3 — Dimension of a span

**Problem.** Given vectors, output the dimension of the space they span (= their rank).

**Input / Output spec.**
- Read `k`, `n`, then the `k` vectors.
- Print the dimension.

**Constraints.** `1 ≤ k, n ≤ 200`.

**Hint.** The dimension of the span is exactly the rank — no extra work beyond Task 1.

**Worked check.** Three vectors in 3D where one is the sum of the other two span a 2D plane → dimension 2. Concretely, `{(1,0,0), (0,1,0), (1,1,0)}` all lie in the `z = 0` plane, so their span is 2-dimensional even though there are three vectors — the rank is 2.

**Evaluation criteria.**
- Span of `{[1,0,0],[0,1,0],[1,1,0]}` → 2 (all lie in the `z=0` plane).
- Span of standard basis vectors → `n`.
- Equals rank of the stacked matrix.

**Connection.** Span dimension, rank, and the count of independent vectors are three names for one quantity. This task and Task 2 differ only in what they print — both compute the rank of the stacked matrix. Recognizing this unification is the conceptual payoff of the beginner tier.

---

### Task 4 — Rank over GF(2) (XOR basis)

**Problem.** Given a list of integers (each a GF(2) vector as a bitmask), output the rank over GF(2), i.e. the size of the XOR basis.

**Input / Output spec.**
- Read `k`, then `k` non-negative integers.
- Print the GF(2) rank.

**Constraints.** `1 ≤ k ≤ 10^5`, values fit in 64 bits.

**Hint.** Insert each value into a basis: reduce it by XOR-ing out basis vectors with matching leading bits; if nonzero remains, add it. The rank is the basis size.

**Reference oracle (Python) — use to validate.**
```python
def gf2_rank_oracle(rows):
    basis = []
    for r in rows:
        cur = r
        for b in basis:
            cur = min(cur, cur ^ b)
        if cur:
            basis.append(cur)
    return len(basis)
# gf2_rank_oracle([0b110, 0b011, 0b101]) == 2
```

**Evaluation criteria.**
- `[0b110, 0b011, 0b101]` → 2; `[1, 2, 4]` → 3.
- Duplicates and zeros do not increase the rank.
- `O(k · bits)` time.

---

### Task 5 — Is a square matrix invertible?

**Problem.** Given a square `n × n` matrix, print `INVERTIBLE` iff its rank is `n` (full rank), else `SINGULAR`. Work over `Z/pZ` for an exact answer (`p = 10^9 + 7`).

**Input / Output spec.**
- Read `n`, then the matrix (integers, reduce mod `p`).
- Print `INVERTIBLE` or `SINGULAR`.

**Constraints.** `1 ≤ n ≤ 200`, `p = 10^9 + 7`.

**Hint.** Compute the rank mod `p` with the modular inverse for division. Full rank (`== n`) means invertible. Working over `Z/pZ` gives an exact yes/no with no floating-point ambiguity — the reason competitive and cryptographic code prefers a prime field for invertibility tests.

**Evaluation criteria.**
- Identity → INVERTIBLE; a matrix with two equal rows → SINGULAR.
- Exact over `Z/pZ` (no floating point).
- Matches a determinant-based check on small matrices.

---

## Intermediate Tasks (5)

### Task 6 — Rank over Z/pZ with modular inverse

**Problem.** Implement `rankModP(A, p)` over the field `Z/pZ`, using the modular inverse of the pivot to eliminate. Return the exact rank.

**Constraints.** `1 ≤ m, n ≤ 300`, `p` prime, entries reduced mod `p`.

**Hint.** Zero test is `x % p == 0`. Divide by multiplying with `pivot^(p−2) mod p` (Fermat) or the extended Euclidean inverse (sibling `06`). Cache the pivot inverse once per pivot row.

**Reference oracle (Python).**
```python
def rank_mod_p_oracle(mat, p):
    mat = [[x % p for x in row] for row in mat]
    m, n, rp = len(mat), len(mat[0]), 0
    for col in range(n):
        if rp >= m:
            break
        sel = next((r for r in range(rp, m) if mat[r][col]), None)
        if sel is None:
            continue
        mat[rp], mat[sel] = mat[sel], mat[rp]
        inv = pow(mat[rp][col], p - 2, p)
        for r in range(m):
            if r != rp and mat[r][col]:
                f = mat[r][col] * inv % p
                for c in range(col, n):
                    mat[r][c] = (mat[r][c] - f * mat[rp][c]) % p
        rp += 1
    return rp
```

**Evaluation criteria.**
- Matches the oracle on random matrices.
- Exact (no rounding); division uses the modular inverse.
- Demonstrates an "unlucky prime" case where a small `p` under-reports the rank (e.g. `[[1,0],[0,p]]` mod `p`).

---

### Task 7 — Rank of the augmented matrix and solvability (Rouché-Capelli)

**Problem.** Given `A` (`m × n`) and `b` (`m`), classify the system `A x = b` as `NO_SOLUTION`, `UNIQUE`, or `INFINITE` using rank comparison. Work over the reals with a tolerance (or over `Z/pZ` for exactness).

**Constraints.** `1 ≤ m, n ≤ 200`.

**Hint.** Compute `rank(A)` and `rank([A | b])`. If they differ → `NO_SOLUTION`. If equal and `== n` → `UNIQUE`. If equal and `< n` → `INFINITE`.

**Reference oracle (Python).**
```python
def classify(A, b, rank_fn):
    augmented = [row + [b[i]] for i, row in enumerate(A)]
    n = len(A[0])
    ra, rab = rank_fn(A), rank_fn(augmented)
    if ra < rab:
        return "NO_SOLUTION"
    return "UNIQUE" if ra == n else "INFINITE"
```

**Evaluation criteria.**
- Inconsistent system (`x = 1` and `x = 2`) → NO_SOLUTION.
- Square full-rank system → UNIQUE.
- Underdetermined consistent system → INFINITE.
- Matches a direct Gaussian-elimination solve on small cases.

---

### Task 8 — Count solutions of a GF(2) system (2^(n−rank))

**Problem.** Given a GF(2) system `A x = b` (`A` is `m × n`), output the number of solutions mod `10^9 + 7`. Return `0` if inconsistent; otherwise `2^(n − rank)`.

**Constraints.** `1 ≤ m, n ≤ 1000` (use bitsets / big-int rows).

**Hint.** Augment each row with the `b` bit. Row-reduce over GF(2) (XOR). After reduction, if any row is all-zero on the left but `1` on the right → inconsistent → `0`. Else `2^(n − rank)` where `rank` is the number of pivots.

**Reference oracle (Python) — brute force for small `n`.**
```python
def brute_count_gf2(A, b, n):
    from itertools import product
    count = 0
    for x in product([0, 1], repeat=n):
        if all(sum(A[i][j] & x[j] for j in range(n)) % 2 == b[i] for i in range(len(A))):
            count += 1
    return count
```

**Evaluation criteria.**
- Matches `brute_count_gf2` for `n ≤ 16`.
- Inconsistent systems return `0`.
- Uses `n` (columns/unknowns), not `m`, in the exponent.
- `O(n²m / 64)` with bitsets.

---

### Task 9 — Nullity and a null-space basis

**Problem.** Given an `m × n` matrix over `Z/pZ`, output the nullity (`n − rank`) and a basis of the null space (the `n − rank` independent solutions of `A x = 0`).

**Constraints.** `1 ≤ m, n ≤ 200`, `p = 10^9 + 7`.

**Hint.** Reduce to reduced row-echelon form. Pivot columns give pivot variables; free columns give free variables. For each free column, set it to 1 (others to 0) and solve the pivot variables → one basis vector. There are `n − rank` of them.

**Evaluation criteria.**
- Nullity equals `n − rank` (rank-nullity invariant).
- Each returned basis vector `w` satisfies `A w == 0` (mod `p`).
- The basis vectors are independent (their rank is `n − rank`).

**Worked check.** For `A = [[1,2,0,1],[0,0,1,1]]` over `Z/pZ`, pivots are in columns 0 and 2 (`rank = 2`), free columns are 1 and 3 (`nullity = 2`). Setting free `(x₁,x₃)=(1,0)` gives `(−2,1,0,0)`; `(0,1)` gives `(−1,0,−1,1)` (entries taken mod `p`). Verify each satisfies `A w ≡ 0` and that the two are independent. This is the constructive side of the rank-nullity theorem: the free columns *generate* the null space.

---

### Task 10 — Rank via bitset GF(2) elimination (dense)

**Problem.** Given a dense GF(2) matrix with up to a few thousand columns, compute its rank using **word-packed bitset** elimination (`uint64` words), `O(n²m / 64)`.

**Constraints.** `1 ≤ m ≤ 5000`, `1 ≤ n ≤ 5000`.

**Hint.** Store each row as an array of `uint64` words. To eliminate, XOR the pivot row's words into other rows that have a 1 in the pivot column. In Python, a single big integer per row already gives a free bitset (`row ^= pivot`).

**Evaluation criteria.**
- Matches the bit-at-a-time GF(2) rank on small inputs.
- Runs `n = 4000` in well under a second (bitset speedup).
- Correct pivot-column detection via word/bit indexing.

---

## Advanced Tasks (5)

### Task 11 — Exact rational rank via two primes

**Problem.** Compute the rank of an integer matrix over the rationals by computing the rank mod two large primes and accepting only if they agree (Monte-Carlo verification). If they disagree, report `AMBIGUOUS` and suggest a third prime.

**Constraints.** `1 ≤ m, n ≤ 300`, entries up to `10^9` in absolute value.

**Hint.** `rank_GF(p) ≤ rank_Q`, equal for all but unlucky primes. Two independent large primes agreeing gives overwhelming confidence the value is the true rational rank.

**Evaluation criteria.**
- Both primes agree on well-conditioned integer matrices.
- A crafted "unlucky small prime" case (a minor divisible by the prime) demonstrates the under-report, fixed by the large primes.
- Reports the common rank when the two agree.

---

### Task 12 — Online (streaming) rank

**Problem.** Implement an `XorBasis` (GF(2)) or general-field `Basis` that supports `insert(vector)` returning whether the rank increased, and a `rank` query — all without storing the full matrix. Vectors arrive one at a time.

**Constraints.** Up to `10^6` inserts; vectors fit in 64 bits (GF(2)) or length `≤ 100` (general field).

**Hint.** On insert, reduce the incoming vector by the current basis; if anything survives, add it (rank++). `O(rank)` per insert (GF(2)) or `O(rank·n)` (general field), `O(rank²)` space.

**Evaluation criteria.**
- `insert` returns `true` exactly when the vector is independent of all prior ones.
- Final rank equals the batch rank of all inserted vectors.
- Handles `10^6` GF(2) inserts efficiently.

---

### Task 13 — Numerical rank via tolerance and the gap statistic

**Problem.** For a real matrix, compute the numerical rank with a **relative** tolerance `eps = max(m,n)·machine_eps·||A||`. Additionally report the magnitude of the smallest accepted pivot and the largest skipped one (the "gap"), flagging `ILL_CONDITIONED` if there is no clear gap.

**Constraints.** `1 ≤ m, n ≤ 300`.

**Hint.** Track the absolute pivot magnitudes. A large gap between the smallest accepted and largest rejected pivot means the rank is well-defined; a gradual decay means it is ambiguous.

**Evaluation criteria.**
- A clearly rank-2 matrix with tiny noise reports rank 2 with a large gap.
- A matrix with gradually decaying pivots reports `ILL_CONDITIONED`.
- The relative tolerance scales correctly with entry magnitude (multiplying the matrix by `10^6` does not change the rank).

---

### Task 14 — Minimum distance of a linear code (rank of column subsets)

**Problem.** Given a parity-check matrix `H` over GF(2) (`(n−k) × n`), the minimum distance `d` of the code equals the smallest number of columns of `H` that are linearly **dependent**. Compute `d` for small codes by searching column subsets of increasing size and testing GF(2) rank.

**Constraints.** `n ≤ 24`, `(n−k) ≤ 16`.

**Hint.** For `d = 1`: a zero column. For `d = t`: the smallest `t` such that some `t` columns are dependent (their rank `< t`). Search subsets by size; the first dependent subset's size is `d`.

**Degree/structure sanity check.** A code with no zero columns and no two equal columns has `d ≥ 3` (a single-error-correcting Hamming-like code). Assert this when columns are distinct and nonzero.

**Evaluation criteria.**
- For the `[7,4]` Hamming code, `d = 3`.
- Detects `d = 1` (zero column) and `d = 2` (two equal columns) correctly.
- Uses GF(2) rank of column subsets as the dependence test.

**Worked Hamming check.** With `H` columns being the binary representations of `1..7`, no column is zero (`d ≥ 2`), all columns are distinct (`d ≥ 3`), but columns `001, 010, 011` are dependent (`011 = 001 ⊕ 010`), so `d = 3`. A distance-3 code corrects `⌊(3−1)/2⌋ = 1` error. This task makes the abstract "rank of column subsets" concrete: minimum distance is the smallest dependent column count, a pure GF(2) rank query.

---

### Task 15 — Decide whether matrix rank is the right tool

**Problem.** Given a problem description and constraints, classify the right approach: `MATRIX_RANK` (easy elimination), `GF2_BITSET` (XOR system at scale), `SVD_NUMERICAL` (noisy real data), `STREAMING_BASIS` (online), or `INTRACTABLE` (tensor rank / non-negative rank — NP-hard). Justify each.

**Constraints / cases to handle.**
- Exact rank of an integer matrix → `MATRIX_RANK` (over `Z/pZ`).
- Huge XOR/coding system → `GF2_BITSET`.
- Rank of noisy sensor data → `SVD_NUMERICAL`.
- Rank over an unbounded stream of vectors → `STREAMING_BASIS`.
- Rank of a 3D tensor or non-negative rank → `INTRACTABLE`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The intractable trap: tensor rank and non-negative rank are NP-hard — matrix elimination does not apply.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INTRACTABLE` branch explicitly cites tensor / non-negative rank NP-hardness.
- Justification references the right complexity (`O(n³)`, `O(n³/64)`, SVD cost, online `O(rank)`).

**Why this matters.** The most expensive mistake is applying the friendly `O(n³)` elimination to a problem that is secretly NP-hard (tensor or non-negative rank) — you get a wrong answer with no error. The second most expensive is using the reals for an exact (GF(2)/Z/pZ) problem, getting a *different* rank. This classification task trains the reflex of matching the tool to the field and the structure before writing any elimination code.

---

## Benchmark Task

### Task B — Field comparison: reals vs Z/pZ vs GF(2) bitset

**Problem.** Empirically compare the cost of computing rank over the three fields on the same random 0/1 matrix (fixed seed). Implement:

- **(a) Real elimination** with partial pivoting — `O(n³)`, floating-point.
- **(b) Z/pZ elimination** with modular inverse — `O(n³)` × inverse cost.
- **(c) GF(2) bitset elimination** — `O(n³/64)` (Python big-int rows give an implicit bitset).

Measure wall-clock time for `n ∈ {100, 300, 600, 1000}` and report a table. Note where the GF(2) bitset pulls ahead and whether the three agree on the rank value for a 0/1 matrix (they may differ — real vs GF(2) rank!).

**Starter — Python.**
```python
import random
import time
from typing import List

MOD = 1_000_000_007


def gen01(n: int, seed: int) -> List[List[int]]:
    r = random.Random(seed)
    return [[r.randint(0, 1) for _ in range(n)] for _ in range(n)]


def rank_real(mat):
    # TODO: partial-pivot float elimination, eps tolerance
    return 0


def rank_mod_p(mat, p=MOD):
    # TODO: modular elimination with Fermat inverse
    return 0


def rank_gf2(mat):
    # TODO: pack each row into one big int; XOR-eliminate
    rows = [sum((mat[i][j] & 1) << j for j in range(len(mat))) for i in range(len(mat))]
    basis = []
    for r in rows:
        cur = r
        for b in basis:
            cur = min(cur, cur ^ b)
        if cur:
            basis.append(cur)
    return len(basis)


def bench(fn, mat) -> float:
    start = time.perf_counter()
    fn([row[:] for row in mat])
    return time.perf_counter() - start


def main() -> None:
    print("n      real_ms    modp_ms    gf2_ms")
    for n in [100, 300, 600, 1000]:
        A = gen01(n, 42)
        tr = bench(rank_real, A) * 1000
        tm = bench(rank_mod_p, A) * 1000
        tg = bench(rank_gf2, A) * 1000
        print(f"{n:<6d} {tr:<10.2f} {tm:<10.2f} {tg:<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same matrix across Go, Java, and Python.
- GF(2) bitset is the fastest for large `n`; report the crossover.
- Note whether real-rank and GF(2)-rank of the same 0/1 matrix differ (they can — GF(2) cancellation).
- Report includes the mean across at least 3 runs and does not time matrix generation.
- Writeup: a short note on why GF(2) bitset wins (word-parallel XOR) and why field choice changes the rank value.

---

## General Guidance for All Tasks

- **Always validate with invariants.** `rank(A) == rank(Aᵀ)`, `rank ≤ min(m, n)`, and `rank + nullity == n` (columns). For GF(2) counts, enumerate all `2^n` assignments on small `n`.
- **Pin the field and the constants.** Name `EPS = 1e-9`, `MOD = 10^9 + 7`; never inline magic numbers. State which field each task is over.
- **Advance the pivot row only on success.** The most common bug is incrementing `rowPivot` on a column with no pivot. Only count a pivot when one is actually found.
- **Over reals, partial-pivot and use a tolerance.** Never compare floats with `==`; pick the largest-magnitude pivot.
- **Over Z/pZ, divide via the modular inverse.** Real division is invalid mod `p`. Cache the pivot inverse per row.
- **Over GF(2), use XOR and bitsets.** The XOR-basis insertion *is* the elimination; Python big ints are free bitsets.
- **Count solutions against columns.** `2^(n − rank)` (GF(2)) and nullity use `n` = number of unknowns (columns), never rows.
- **Never use matrix elimination for tensor or non-negative rank.** Those are NP-hard (Task 15).

- **Match the file set to your goal.** Beginner tasks fix the core `rank` routine; Intermediate adds the field/solvability layer; Advanced covers exactness, streaming, stability, and codes. Do not skip the oracle validation step — it is where the subtle field-arithmetic and off-by-dimension bugs surface.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
