# Gaussian Elimination (Solving Linear Systems) — Middle Level

> **Focus:** Why **partial pivoting** is mandatory for floats, how the *same* elimination becomes **exact** over `Z/pZ` (dividing by the pivot's modular inverse), how **GF(2) XOR systems** run 64× faster with bitsets, and how **rank** decides whether a system has zero, one, or infinitely many solutions (the free-variable story).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Rank, Free Variables, and Solution Counting](#rank-free-variables-and-solution-counting)
6. [Modular and GF(2) Variants](#modular-and-gf2-variants)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was the procedure: augment, eliminate to row-echelon form, back-substitute. At middle level you start making the engineering choices that decide whether the solve is *correct* and *fast*:

- Over the reals, why does naive elimination give garbage, and how exactly does **partial pivoting** fix it? When is **full pivoting** worth its extra cost?
- Over `Z/pZ`, why is there no rounding at all, and how do you "divide" by a pivot when division is not an operation — by multiplying by the **modular inverse** (siblings `02-modular-arithmetic`, `06-extended-euclidean-modular-inverse`)?
- Over **GF(2)**, why does the entire system collapse into XOR of bit-rows, and how do **bitsets** give a 64× speedup that turns thousand-variable XOR systems into milliseconds?
- After elimination, how do you read off **rank**, detect **no solution** vs **infinitely many**, and parameterize the solution space with **free variables**?

These questions separate "I can hand-solve a `3×3`" from "I can ship a robust linear solver for the field my problem lives in."

---

## Deeper Concepts

### Elimination as repeated row operations, restated

Let `m = [A | b]` be the augmented matrix. Forward elimination is the loop:

```
row = 0
for col in 0 .. n-1:
    pick a pivot row p >= row with m[p][col] != 0   (largest |.| for floats)
    if none: column has no pivot -> free variable; continue (don't advance row)
    swap rows row and p
    for r != row (or only r > row for REF):
        factor = m[r][col] / m[row][col]
        m[r] -= factor * m[row]
    row += 1
```

Two design decisions hide here. First, **REF vs RREF**: if you only eliminate *below* the pivot (`r > row`) you get REF and finish with back substitution; if you eliminate *above too* (`r != row`) and scale pivots to `1`, you get RREF and read the answer directly. Second, **pivot selection**: over floats you want the largest magnitude; over a field (`Z/pZ`, GF(2)) any non-zero entry works equally well.

### Why floats need pivoting: catastrophic error

Consider:

```
[ 1e-18   1 | 1 ]
[   1     1 | 2 ]
```

Without pivoting, the pivot is `1e-18`. The factor to eliminate row 1 is `1 / 1e-18 = 1e18`. Row 1 becomes `[0, 1 - 1e18, 2 - 1e18]`. In `double`, `1 - 1e18` rounds to `-1e18` and `2 - 1e18` rounds to `-1e18` — the `1` and `2` are *lost* to rounding. Back substitution then gives `x₁ = 1`, `x₀ = 0`, badly wrong (true answer ≈ `x₀ = 1, x₁ = 1`).

**Partial pivoting** swaps the larger `1` into the pivot position first. The factor becomes `1e-18`, the tiny entry never divides, and no significant digits are lost. The rule: *never divide by a small number when a larger one is available in the column.*

### Partial vs full pivoting

- **Partial pivoting** searches the current *column* (below the pivot) for the largest magnitude and swaps that row up. `O(n)` extra work per column, `O(n²)` total. This is the standard, almost always sufficient, choice.
- **Full pivoting** searches the entire remaining *submatrix* for the largest magnitude and swaps both a row and a column (tracking the column permutation so you can unscramble `x` at the end). `O((n-col)²)` search per step, `O(n³)` total search. More stable in pathological cases but rarely needed; the column bookkeeping is error-prone.

Partial pivoting bounds the growth factor well in practice; full pivoting bounds it provably better but costs more. Default to partial.

### The growth factor and conditioning (preview)

Pivoting controls the **growth factor** — how large entries get during elimination. Large growth means lost precision. A separate issue is **conditioning**: even with perfect pivoting, an *ill-conditioned* matrix (nearly singular) amplifies input error no matter what. Conditioning is intrinsic to `A`; pivoting only controls the algorithm's added error. Senior level treats both quantitatively.

---

## Comparison with Alternatives

### Gaussian elimination vs other linear-system methods

| Method | Cost | Best for |
|--------|------|----------|
| **Gaussian elimination / LU** | `O(n³)` | dense general systems; reuse LU for many right-hand sides |
| Cramer's rule | `O(n · n!)` or `O(n⁴)` | never in practice — only theoretical / `2×2` by hand |
| Cholesky factorization | `O(n³/3)` | symmetric positive-definite `A` (half the work, no pivoting needed) |
| Iterative (CG, GMRES) | `O(n·nnz)` per iter | huge *sparse* systems where `O(n³)` is infeasible |
| Direct inverse then multiply | `O(n³)` + unstable | almost never — solving is cheaper and more stable than inverting |

**Key takeaway:** for a single dense system, Gaussian elimination *is* the answer. Do not compute `A⁻¹` and multiply — solving directly is both faster and more accurate. Use Cholesky if `A` is symmetric positive-definite, and switch to iterative methods only when `A` is large and sparse.

### Reals vs `Z/pZ` vs GF(2)

| Field | Arithmetic | Pivoting | Exactness | Speed trick |
|-------|-----------|----------|-----------|-------------|
| Reals (`double`) | float `+ - × /` | largest magnitude (stability) | approximate | BLAS/SIMD |
| `Z/pZ`, `p` prime | mod `p`, divide = `× inverse` | any non-zero entry | **exact** | Montgomery mult (sibling `14`) |
| GF(2) = `Z/2Z` | XOR (`+`), AND (`×`) | any `1` entry | **exact** | **bitsets** (64× / word) |

Over a field there is no rounding, so pivoting is *only* about finding a non-zero pivot, never about magnitude. This is why competitive-programming Gaussian elimination over `Z/pZ` is bulletproof while float elimination needs care.

### REF + back substitution vs full RREF

| Approach | What it does | Cost | When to use |
|----------|-------------|------|-------------|
| REF + back substitution | eliminate *below* pivots only, then climb | `(2/3)n³ + O(n²)` | solving a system (the default) |
| Gauss-Jordan (RREF) | eliminate above *and* below, scale pivots to 1 | `≈ n³` | matrix inverse, reading solutions directly |

Both reach the same answer; RREF does more work (clears above each pivot too) but needs no back-substitution pass and directly exposes the inverse when you augment with the identity `[A | I] → [I | A⁻¹]`. For a one-off solve, prefer REF + back substitution; when you need the inverse or the explicit general solution, use RREF.

---

## Advanced Patterns

### Pattern: Mod-p elimination (exact, divide by modular inverse)

Over `Z/pZ` you cannot write `m[r] / m[row]`. Instead multiply by the **modular inverse** of the pivot. For prime `p`, `pivot⁻¹ = pivot^(p-2) mod p` (Fermat, sibling `04`) or via the extended Euclidean algorithm (sibling `06`).

#### Go

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

func inv(a int64) int64 { return power(((a%MOD)+MOD)%MOD, MOD-2, MOD) }

// solveModP returns (x, true) for a unique solution of A·x=b over Z/pZ.
func solveModP(A [][]int64, b []int64) ([]int64, bool) {
	n := len(A)
	m := make([][]int64, n)
	for i := 0; i < n; i++ {
		m[i] = make([]int64, n+1)
		copy(m[i], A[i])
		m[i][n] = b[i]
		for c := range m[i] {
			m[i][c] = ((m[i][c] % MOD) + MOD) % MOD
		}
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
			return nil, false // singular: no unique solution
		}
		m[col], m[piv] = m[piv], m[col]
		iv := inv(m[col][col])
		for r := 0; r < n; r++ { // RREF: eliminate above and below
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
	b := []int64{5, 10}
	x, ok := solveModP(A, b)
	fmt.Println(ok, x) // unique solution mod p
}
```

#### Java

```java
public class GaussModP {
    static final long MOD = 1_000_000_007L;

    static long power(long a, long e) {
        long r = 1; a %= MOD;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % MOD;
            a = a * a % MOD;
            e >>= 1;
        }
        return r;
    }
    static long inv(long a) { return power(((a % MOD) + MOD) % MOD, MOD - 2); }

    static long[] solveModP(long[][] A, long[] b) {
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
        long[] b = {5, 10};
        System.out.println(java.util.Arrays.toString(solveModP(A, b)));
    }
}
```

#### Python

```python
MOD = 1_000_000_007


def inv(a):
    return pow(a % MOD, MOD - 2, MOD)  # Fermat inverse, p prime


def solve_mod_p(A, b):
    """Unique solution of A·x = b over Z/pZ, or None if singular."""
    n = len(A)
    m = [[A[i][j] % MOD for j in range(n)] + [b[i] % MOD] for i in range(n)]
    for col in range(n):
        piv = next((r for r in range(col, n) if m[r][col] != 0), None)
        if piv is None:
            return None  # singular
        m[col], m[piv] = m[piv], m[col]
        iv = inv(m[col][col])
        for r in range(n):  # RREF: eliminate above and below
            if r == col or m[r][col] == 0:
                continue
            f = m[r][col] * iv % MOD
            for c in range(col, n + 1):
                m[r][c] = (m[r][c] - f * m[col][c]) % MOD
    return [m[i][n] * inv(m[i][i]) % MOD for i in range(n)]


if __name__ == "__main__":
    A = [[2, 1], [1, 3]]
    b = [5, 10]
    print(solve_mod_p(A, b))
```

### Pattern: GF(2) XOR system with bitsets

In GF(2), a row is just a bit vector; "add row `j` to row `i`" is `row[i] ^= row[j]`. Pack each row (including the `b` bit) into one or more 64-bit integers and XOR whole words at once. This is the single biggest practical speedup in this whole topic.

```python
def solve_gf2(rows, n):
    """rows: list of integers, bit c set = coefficient of x_c; bit n = b.
       Returns a solution list of 0/1, or None if inconsistent."""
    m = rows[:]                      # each row is an (n+1)-bit integer
    where = [-1] * n                 # which row is the pivot for column c
    r = 0
    for col in range(n):
        piv = next((i for i in range(r, len(m)) if (m[i] >> col) & 1), None)
        if piv is None:
            continue                 # free variable
        m[r], m[piv] = m[piv], m[r]
        for i in range(len(m)):      # eliminate column col everywhere
            if i != r and (m[i] >> col) & 1:
                m[i] ^= m[r]         # XOR whole row in O(1) word ops
        where[col] = r
        r += 1
    # consistency: any all-zero coefficient row with b=1 -> no solution
    for i in range(len(m)):
        coeffs = m[i] & ((1 << n) - 1)
        if coeffs == 0 and (m[i] >> n) & 1:
            return None
    x = [0] * n
    for col in range(n):
        if where[col] != -1:
            x[col] = (m[where[col]] >> n) & 1
    return x
```

The XOR `m[i] ^= m[r]` is `O(1)` in Python (big ints) and `O((n+1)/64)` machine-word XORs in Go/Java — hence the `O(n³ / 64)` total. Use `std::bitset` in C++, `BitSet`/`long[]` in Java, `big.Int` or `[]uint64` in Go.

---

## Rank, Free Variables, and Solution Counting

After elimination, the **rank** `r` is the number of pivot rows. With `n` unknowns and a consistent system:

- `r == n` → **unique** solution.
- `r < n` and consistent → **infinitely many**; the `n - r` columns without pivots are **free variables**. Over `Z/pZ` there are exactly `p^(n-r)` solutions; over GF(2), `2^(n-r)`.
- **Inconsistent** (a row `0 … 0 | nonzero`) → **no solution**, regardless of rank.

**Reading the general solution.** Set each free variable to a parameter. Each pivot row then expresses its pivot variable in terms of the free ones. A particular solution sets all free variables to `0`; the homogeneous part spans the null space.

```mermaid
graph TD
    E[Eliminate to echelon form] --> C{Inconsistent row<br/>0..0 | c, c!=0 ?}
    C -->|yes| N[NO SOLUTION]
    C -->|no| R{rank r == n ?}
    R -->|yes| U[UNIQUE solution]
    R -->|no| F["INFINITELY MANY:<br/>n - r free variables"]
```

This is the algorithmic content of the **Rouché–Capelli theorem**: a system is consistent iff `rank(A) == rank([A|b])`, and unique iff that common rank equals the number of unknowns. The proof is in [`professional.md`](./professional.md). Computing `rank(A)` alone is sibling `19-matrix-rank`; the determinant `≠ 0` test for the square unique case is sibling `18-matrix-determinant`.

---

## Modular and GF(2) Variants

### Why mod-p is exact

Every operation is integer arithmetic mod a prime `p`; there is no rounding because `Z/pZ` is a **field** with finitely many elements. The only subtlety is "division": to divide by the pivot you multiply by its modular inverse. Because `p` is prime, every non-zero element is invertible, so **any** non-zero pivot works — no magnitude pivoting needed. (If `p` is *not* prime, only elements coprime to `p` are invertible; you would need a non-zero pivot coprime to `p`, or work modulo prime power factors and recombine via CRT, sibling `05`.)

### Why GF(2) is special

GF(2) is `Z/2Z`: the only elements are `0` and `1`, addition is XOR, multiplication is AND, and the only invertible element is `1` (its own inverse). So elimination needs no inverse computation at all — find any row with a `1` in the pivot column, then XOR it into every other row that has a `1` there. Because a whole row is a bit vector, the XOR vectorizes over machine words. XOR systems appear in: linear feedback shift registers, Gaussian elimination over Boolean equations, the **XOR-basis / linear-basis** trick (sibling `18-bit-manipulation`, "binary trie / XOR basis"), Nim-like games, and lights-out puzzles.

### Connection to the XOR basis

The XOR-basis structure from `18-bit-manipulation` is exactly Gaussian elimination over GF(2) on a set of vectors: you maintain a reduced set of basis rows, each with a distinct leading bit. Inserting a new vector is "reduce it against the current basis, then add it if non-zero" — one column-elimination step. Querying "can value `v` be formed?" is back substitution. So the XOR basis *is* online GF(2) row reduction.

---

## Code Examples

### Rank and solution-count classification over the reals

This routine eliminates with partial pivoting, then classifies the system.

#### Python

```python
EPS = 1e-9


def classify(A, b):
    """Return ('none'|'unique'|'infinite', maybe-solution)."""
    n, mcols = len(A), len(A[0])
    m = [list(map(float, A[i])) + [float(b[i])] for i in range(n)]
    where = [-1] * mcols  # pivot row for each column
    row = 0
    for col in range(mcols):
        piv = max(range(row, n), key=lambda r: abs(m[r][col]), default=row)
        if row >= n or abs(m[piv][col]) < EPS:
            continue  # no pivot in this column -> free variable
        m[row], m[piv] = m[piv], m[row]
        for r in range(n):
            if r != row and abs(m[r][col]) > EPS:
                f = m[r][col] / m[row][col]
                for c in range(col, mcols + 1):
                    m[r][c] -= f * m[row][c]
        where[col] = row
        row += 1
    # inconsistency check
    for r in range(n):
        if all(abs(m[r][c]) < EPS for c in range(mcols)) and abs(m[r][mcols]) > EPS:
            return ("none", None)
    rank = sum(1 for w in where if w != -1)
    if rank < mcols:
        return ("infinite", None)
    x = [0.0] * mcols
    for c in range(mcols):
        if where[c] != -1:
            x[c] = m[where[c]][mcols] / m[where[c]][c]
    return ("unique", x)


if __name__ == "__main__":
    print(classify([[1, 1], [2, 2]], [2, 5])[0])  # none (parallel, inconsistent)
    print(classify([[1, 1], [1, -1]], [2, 0])[0])  # unique
    print(classify([[1, 1], [2, 2]], [2, 4])[0])  # infinite
```

The Go and Java versions follow the same structure as the junior solver, adding the `where[]` pivot-tracking array and the inconsistency scan; the mod-p and GF(2) code above are the field variants of this same skeleton.

### Worked example: reading a general solution with a free variable

Take the consistent rank-deficient system over the reals:

```
[ 1  2  1 | 4 ]      (x + 2y + z = 4)
[ 2  4  3 | 9 ]      (2x + 4y + 3z = 9)
```

Eliminate column 0 (pivot row 0): `R1 ← R1 − 2·R0 = [0, 0, 1 | 1]`. Column 1 has no pivot at or below row 1 (the entry is `0`), so `y` is a **free variable**; advance to column 2, pivot at row 1 (value `1`). Clear above: `R0 ← R0 − R1 = [1, 2, 0 | 3]`. RREF:

```
[ 1  2  0 | 3 ]      (x + 2y = 3)
[ 0  0  1 | 1 ]      (z = 1)
```

`rank = 2`, unknowns `= 3`, so `3 − 2 = 1` free variable (`y`). The general solution: set `y = t` (any value), then `x = 3 − 2t`, `z = 1`. Particular solution (`t = 0`): `(3, 0, 1)`. Homogeneous direction (`A·v = 0`): `(−2, 1, 0)`. So the full solution set is `(3, 0, 1) + t·(−2, 1, 0)`. Over `Z/pZ` there are exactly `p` solutions (one per value of `t`); over GF(2), `2`. This is the free-variable machinery every solver must implement, and it is what the `where[]` array in the code above tracks.

### Worked example: why the largest pivot matters numerically

Compare two pivot choices on `[[0.001, 1 | 1], [1, 1 | 2]]` in low-precision arithmetic. Picking the small `0.001` first gives multiplier `1000`, and `R1`'s entries become `1 − 1000` and `2 − 1000` — the original `1` and `2` are swamped. Picking the larger `1` first (partial pivoting) gives multiplier `0.001`, and nothing is lost. Same matrix, same solution, but only the second order preserves accuracy. The rule is mechanical: in each column, swap the largest-magnitude entry into the pivot before eliminating.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Tiny float pivot | Division amplifies rounding to garbage. | Partial pivoting; treat `|pivot| < eps` as zero. |
| `== 0` float comparison | Misclassifies rank / consistency. | Compare against a tolerance `eps`, never literal `0`. |
| Mod-p non-prime modulus | Pivot may not be invertible. | Require `p` prime, or factor and use CRT (sibling `05`). |
| Negative residue (Go/Java) | `%` returns negative. | Normalize with `((x % p) + p) % p`. |
| GF(2) inconsistency missed | Reported a solution when none exists. | Scan for all-zero coefficient rows with `b = 1`. |
| Free variables ignored | Returned one solution as if unique. | Track `where[]`; if `rank < unknowns`, report infinite. |
| Overflow before mod | `f * m[col][c]` overflows. | Use 64-bit; reduce after each multiply. |

---

## Performance Analysis

| `n` | Float/mod-p `O(n³)` | GF(2) bitset `O(n³/64)` |
|-----|---------------------|--------------------------|
| 100 | 10⁶ ops — instant | ~1.6×10⁴ word-ops — instant |
| 500 | 1.25×10⁸ — ~0.1 s | ~2×10⁶ — instant |
| 1000 | 10⁹ — ~1 s (mod-p) | ~1.6×10⁷ — instant |
| 4000 | 6.4×10¹⁰ — minutes | ~10⁹ — ~1 s |

The float/mod-p cost is dominated by the triple loop. The GF(2) bitset variant divides the inner row-XOR by the word width (64), so it stays feasible to several thousand variables. For mod-p with `p` fixed, **Montgomery multiplication** (sibling `14`) shaves the per-multiply constant. For floats, the inner elimination loop maps directly onto SIMD/BLAS (`dgemm`-style updates).

```python
# The hot loop is the rank-1 update m[r] -= f * m[row].
# Vectorize it: in numpy, m[r, col:] -= f * m[row, col:] is one SIMD call.
# In GF(2): m[i] ^= m[row] is one (or few) machine-word XORs.
```

The single biggest constant-factor win per field: **bitsets for GF(2)**, **SIMD/BLAS for reals**, **Montgomery for mod-p**.

---

## Best Practices

- **Pick pivoting by field:** largest magnitude for floats (stability); any non-zero for `Z/pZ`/GF(2) (correctness only).
- **Use `eps` for floats, exact `!= 0` for fields.** Never mix the two.
- **Track `where[]`** (pivot row per column) so you can report rank, free variables, and read the general solution.
- **Prefer LU once, solve many** when there are multiple right-hand sides for the same `A` — factor `A = LU` once (`O(n³)`), then each solve is `O(n²)`.
- **Use bitsets for GF(2)** — it is the difference between feasible and not at scale.
- **Verify the residual** (`A·x ≈ b` for floats, `A·x ≡ b mod p` for fields) on small instances.
- **Require a prime modulus** for the mod-`p` variant, or be explicit about handling composite moduli via CRT.

### Common Mistakes at This Level

1. **Magnitude-pivoting over a field.** Searching for the largest entry mod `p` is meaningless — residues have no order. Over a field, swap in *any* non-zero entry; only floats need the largest.
2. **Forgetting the inconsistency scan.** After elimination you must check for a row `0 … 0 | c` with `c ≠ 0`; without it you will return a bogus "solution" for an unsolvable system.
3. **Counting pivots wrong.** Free columns are skipped *without* advancing the pivot row; mis-handling this off-by-one corrupts the rank and the free-variable count.
4. **Mixing REF and RREF expectations.** Back substitution needs REF (zeros below pivots); reading the answer directly or computing an inverse needs RREF (zeros above too, pivots scaled to 1).
5. **GF(2) without packing.** Element-by-element XOR is correct but throws away the 64× word-parallel speedup that makes large systems feasible.
6. **Unnormalized negative residues.** `((x % p) + p) % p` after every subtraction in Go/Java, or your answers go negative and diverge from Python.

### Choosing the field for a problem

A quick decision guide you can apply in seconds:

| The problem asks for… | Field | Why |
|-----------------------|-------|-----|
| A physical/engineering quantity, approximate OK | reals (`double`) | float is fast; pivot for stability |
| An answer "modulo a prime" | `Z/pZ` | exact, no rounding, divide by inverse |
| An exact integer or fraction | `ℚ` via mod-p + reconstruction, or Bareiss | recover exact value |
| A boolean / XOR / parity condition | GF(2) | XOR + bitsets, 64× fast |
| Counting structures mod a prime | `Z/pZ` | exact counts; free-variable count gives `p^{n−r}` |

Picking the wrong field is the most expensive early mistake: solving an exact problem with floats invites rounding errors, while solving a float problem over `Z/pZ` answers a different question entirely.

### Worked GF(2) trace (lights-out flavor)

Solve `x₀ ⊕ x₂ = 1`, `x₀ ⊕ x₁ = 0`, `x₁ ⊕ x₂ = 1` over GF(2):

```
[ 1 0 1 | 1 ]
[ 1 1 0 | 0 ]
[ 0 1 1 | 1 ]
```

Pivot col 0 = row 0; XOR R0 into R1: `R1 = [0, 1, 1 | 1]`. Pivot col 1 = row 1; XOR R1 into R2: `R2 = [0, 0, 0 | 0]`. Consistent (last row `0 = 0`), rank 2, one free variable (`x₂`). With `x₂ = 0`: `x₁ = 1`, `x₀ = 1`. With `x₂ = 1`: `x₁ = 0`, `x₀ = 0`. Two solutions (`2^{3−2} = 2`), exactly the kind of multi-solution answer lights-out puzzles produce — every move was an XOR, no inverse needed.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - Selecting the **pivot** in each column and the row **swap** that brings it into place
> - The **elimination** of every entry below (and, in RREF mode, above) the pivot
> - Advancing the pivot column and watching the staircase of zeros grow
> - **Back substitution** reading off each unknown, with an editable matrix to try mod-p / GF(2) style integer systems

---

## Summary

Over the reals, **partial pivoting** is non-negotiable: dividing by a tiny pivot loses significant digits to rounding, so always swap the largest-magnitude entry into the pivot position (full pivoting is stronger but rarely worth its column-bookkeeping cost). Over `Z/pZ` with prime `p`, the identical elimination is **exact** — there is no rounding, and you "divide" by a pivot by multiplying by its **modular inverse** (siblings `02`, `06`); any non-zero pivot works. Over **GF(2)** the system is pure XOR: pack rows into machine words and XOR them, for an `O(n³ / 64)` solve — the same structure as the XOR basis in `18-bit-manipulation`. After elimination, **rank** decides everything: `rank == unknowns` and consistent gives a unique solution, fewer pivots gives **free variables** (infinitely many — `p^(n-r)` over `Z/pZ`), and an inconsistent `0 = c` row gives no solution. That is the algorithmic face of the Rouché–Capelli theorem, with the determinant and rank tools formalized in siblings `18` and `19`. Master the field-specific pivoting and the rank/free-variable bookkeeping and one elimination skeleton solves real, modular, and bitwise systems alike.
