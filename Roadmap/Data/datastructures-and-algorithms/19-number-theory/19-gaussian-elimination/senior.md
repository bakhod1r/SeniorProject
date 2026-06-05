# Gaussian Elimination (Solving Linear Systems) — Senior Level

> Gaussian elimination is textbook-simple until it meets reality: floating-point conditioning that silently destroys digits, systems too large or too sparse for `O(n³)`, exact modular pipelines where a non-prime modulus or an overflow corrupts the answer, and GF(2) systems where a 64× bitset speedup is the difference between feasible and not. At senior level every one of these — stability, scale, exactness, and the test strategy that catches them — is a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Numerical Stability and Conditioning](#2-numerical-stability-and-conditioning)
3. [Exact vs Floating-Point Solving](#3-exact-vs-floating-point-solving)
4. [Sparse and Large Systems](#4-sparse-and-large-systems)
5. [GF(2) and Modular Engineering at Scale](#5-gf2-and-modular-engineering-at-scale)
6. [LU Factorization and Reuse](#6-lu-factorization-and-reuse)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does elimination work" but "what field am I actually solving over, and what breaks when I scale or stress it?". Gaussian elimination shows up in three guises that share one engine:

1. **Numerical solving over the reals** — physics, optimization, least squares, computer graphics. The enemy is rounding; the levers are pivoting, conditioning, and iterative refinement.
2. **Exact solving over `Z/pZ`** — competitive programming, cryptography, exact rank/determinant, counting. The enemy is overflow and non-prime moduli; the lever is careful modular arithmetic and CRT.
3. **GF(2) / XOR solving** — coding theory, linear feedback, XOR bases, lights-out. The enemy is `O(n³)` on large `n`; the lever is bitset word-parallelism.

All three reduce to: *build the augmented matrix, pick pivots, eliminate, read the result.* The senior decisions are: how to keep the float answer accurate (or know it is not), how to keep the exact answer exact and overflow-free, how to make the `O(n³)` (or `O(n³/64)`) fast enough, and how to verify a result you cannot eyeball.

A useful framing: the *junior* skill is running the elimination; the *senior* skill is knowing which of a dozen variants to run and how to tell when it has gone wrong. The elimination loop is twenty lines; the surrounding judgment — field choice, pivoting strategy, overflow discipline, conditioning awareness, factorization reuse, and verification — is what makes a solver trustworthy in production. This document is organized around those judgment calls, not the loop itself.

---

## 2. Numerical Stability and Conditioning

### 2.1 Pivoting controls algorithm error, not data error

Two distinct things degrade a float solve:

- **Growth factor** — how large intermediate entries become during elimination. Large growth means catastrophic cancellation. **Partial pivoting** keeps the multipliers `≤ 1` in magnitude, bounding growth well in practice (worst-case `2^(n-1)`, but pathological). **Full pivoting** bounds it provably better at extra cost.
- **Condition number** `κ(A) = ‖A‖·‖A⁻¹‖` — intrinsic to the matrix. If `κ(A) ≈ 10^k`, you lose about `k` decimal digits *regardless of pivoting*. A matrix with `κ ≈ 10^16` in `double` is effectively singular: the answer is noise.

Pivoting fixes the first; nothing fixes the second except higher precision or reformulating the problem. The senior reflex: estimate `κ(A)` (or at least watch the smallest pivot) and report when the answer is untrustworthy.

### 2.2 Iterative refinement

After computing an approximate `x̂`, compute the residual `r = b - A·x̂` (in higher precision if possible), solve `A·δ = r` reusing the existing LU factorization (`O(n²)`), and update `x̂ ← x̂ + δ`. A few rounds recover digits lost to rounding for moderately ill-conditioned systems — cheap insurance because the factorization is reused.

The subtle requirement: the residual `r = b − A·x̂` must be computed in *higher* precision than the solve, otherwise it is itself dominated by rounding and carries no corrective signal. Classic mixed-precision iterative refinement factors and solves in single precision but accumulates the residual in double; modern GPU solvers exploit exactly this (fast low-precision factorization, high-precision residual) to get double-precision accuracy at low-precision speed. The technique only helps when `κ(A)` is moderate; for a severely ill-conditioned matrix it stalls (failure mode `§9.9b`).

### 2.3 Scaling / equilibration

Rows or columns with wildly different magnitudes distort pivot selection (a "large" entry may just be in big units). **Equilibration** rescales rows/columns to comparable norms before elimination so partial pivoting picks genuinely stable pivots. Track the scaling to unscramble the solution.

Concretely: if one equation is measured in meters and another in millimeters, the millimeter row's coefficients are `1000×` larger, and partial pivoting will wrongly favor it as "the largest" even though it carries no more information. Row-equilibration divides each row by its largest-magnitude entry (or its norm) first, so pivot selection compares apples to apples. The scaling factors are recorded and undone at the end. Equilibration is cheap (`O(n²)`) and turns partial pivoting from "largest raw number" into "largest *relative* coefficient", which is what stability actually requires.

### 2.4 When float elimination is the wrong tool

- **Exact answer required** (rational, integer, modular) → use `Z/pZ` arithmetic, not float.
- **Symmetric positive-definite `A`** → Cholesky (`O(n³/3)`, no pivoting, more stable).
- **Least squares / rank-deficient** → QR or SVD, which are more stable than normal-equations + elimination.
- **Severely ill-conditioned** → regularization (Tikhonov) or SVD truncation; raw elimination just amplifies noise.

### 2.5 Case study: the Hilbert matrix

The `n×n` Hilbert matrix `H[i][j] = 1/(i+j+1)` is the textbook ill-conditioned example: `κ(H₁₀) ≈ 10¹³`. Solving `H·x = b` for a known `x` in `double`:

- With partial pivoting, the *residual* `‖H·x̂ − b‖` is tiny (`~10⁻¹⁶`) — the algorithm is backward stable.
- But the *forward error* `‖x̂ − x‖/‖x‖` is `~10⁻³` — about 13 digits lost, exactly `κ(H)·u`.

This is the crisp demonstration that a small residual does **not** imply a correct answer when `κ` is large. The senior takeaway: log both the residual *and* a condition estimate. A small residual with a huge `κ` means "the algorithm did its job, but the problem itself cannot be solved accurately in this precision" — escalate to higher precision, exact arithmetic, or a reformulation, do not silently return noise.

### 2.6 Estimating the condition number cheaply

Computing `κ(A) = ‖A‖·‖A⁻¹‖` exactly needs `A⁻¹`, which defeats the purpose. Production code uses a **condition estimator** (LAPACK `dgecon`): given the `LU` factors already computed, it estimates `‖A⁻¹‖` by solving a few triangular systems against cleverly chosen right-hand sides — `O(n²)` extra work on top of the `O(n³)` factorization. The cheapest proxy is the ratio `|largest pivot| / |smallest pivot|` of `U`; a huge ratio flags near-singularity. Neither is exact, but both reliably catch the dangerous regime where the answer is untrustworthy.

---

## 3. Exact vs Floating-Point Solving

### 3.1 The exactness dividend of `Z/pZ`

Over a prime field there is *no* rounding, no growth factor, no conditioning. Every intermediate is an exact residue. This is why exact rank, exact determinant (sibling `18`), and exact solutions come for free over `Z/pZ`. The price: you only learn the answer *mod p*. For a genuinely integer/rational answer:

- **Single prime, answer fits** — read it directly.
- **Answer may exceed `p`** — solve under several coprime primes and reconstruct via **CRT** (sibling `05`, `15-garner-algorithm`). Each prime is an independent, parallelizable elimination.
- **Rational answer** — solve mod a large prime and use **rational reconstruction** (continued fractions, sibling `16`) to recover `num/den` from the residue.

### 3.2 Overflow discipline

With `int64` and `p < 2^31`, a product of two residues is `< 2^62` — safe — but a deferred accumulation can overflow. Reduce after each multiply, or use a 128-bit accumulator with a proven term bound. For `p` near `2^62`, even a single product overflows `int64`; use `__int128`, `unsigned`, or **Montgomery / Barrett reduction** (sibling `14`).

The precise term bound for deferred reduction: with residues in `[0, p)`, each product is `< p²`, so you may accumulate up to `⌊(2^63 − 1)/(p−1)²⌋` products in a signed `int64` before a forced `% p`. For `p = 10^9+7` that is essentially one product, so reduce every step; for a small `p` (say `< 2^15`) you can batch many products between reductions, a measurable speedup in the hot inner loop. Knowing this bound is the difference between a correct fast solver and one that silently overflows on adversarial inputs.

### 3.3 Non-prime moduli

If the modulus is composite, not every non-zero element is invertible, so the pivot must be **coprime** to `m`, and a row might have *no* invertible entry even though it is non-zero. Two robust strategies:

- **Factor `m = ∏ pᵢ^eᵢ`**, solve modulo each prime power, recombine via CRT (sibling `05`).
- **Fraction-free (Bareiss) elimination** — stay in the integers, never divide, keeping entries bounded; division becomes exact integer division. This avoids inverses entirely and is the method of choice for exact integer determinants and rational systems (links to sibling `18`).

### 3.4 Bareiss (fraction-free) elimination — the exact-integer route

Standard elimination introduces fractions. **Bareiss** uses the identity that each computed entry is an exact integer (a minor of the original matrix), so you can divide exactly by the previous pivot without ever leaving the integers. Entry growth is polynomial, not exponential, making it the practical exact-integer solver and the basis for exact determinants.

### 3.5 Worked multi-prime pipeline

Suppose a `30×30` integer system has a solution whose largest coordinate could be as big as `10^25` (estimate via Hadamard's bound on the determinant). A single `30`-bit prime (`p ≈ 10^9`) recovers only `x mod p` — far too little. Pipeline:

1. Pick primes `p₁ = 10^9+7`, `p₂ = 998244353`, `p₃ = 10^9+9`, … until `∏ pᵢ > 2·10^25`.
2. Solve `A·x ≡ b` exactly modulo each `pᵢ` (independent jobs — distribute across cores).
3. For each coordinate, CRT/Garner-combine the residues `(x mod p₁, x mod p₂, …)` into `x mod ∏pᵢ`.
4. Map the result into the symmetric range `(−∏pᵢ/2, ∏pᵢ/2]` to recover the signed integer.

Because the per-prime solves are exact and independent, the pipeline is both correct and embarrassingly parallel. For a *rational* answer, stop at one large prime and apply rational reconstruction instead (sibling `16`). The magnitude estimate in step 1 decides how many primes you need — under-provision and the CRT result wraps around silently, the classic bug.

### 3.6 Rational reconstruction in one paragraph

Given `r = x mod p` for an unknown rational `x = num/den` with `|num|, |den| < √(p/2)`, run the extended Euclidean algorithm on `(p, r)` and stop when the remainder drops below `√(p/2)`; that remainder is `num` and the accumulated coefficient is `den`. This recovers exact fractions from a single modular solve — the bridge from "exact mod p" to "exact over ℚ" — and is the engine behind exact rational linear-system solving when entries are small but the LU fractions would otherwise explode. It connects this topic directly to continued fractions (sibling `16`).

---

## 4. Sparse and Large Systems

### 4.1 Fill-in

Dense `O(n³)` elimination is infeasible for `n` in the tens of thousands. Sparse systems (few non-zeros per row) suffer **fill-in**: elimination creates non-zeros where there were zeros, densifying the matrix. The whole game of sparse direct solvers is **ordering** the elimination to minimize fill-in:

- **Minimum-degree** and **nested-dissection** orderings reorder rows/columns to keep the factors sparse.
- Specialized libraries (SuiteSparse, UMFPACK, SuperLU) implement this; do not hand-roll a sparse solver.

### 4.2 When to abandon direct elimination

For very large sparse systems, switch to **iterative** methods:

- **Conjugate gradient (CG)** for symmetric positive-definite `A` — `O(iterations × nnz)`.
- **GMRES / BiCGStab** for general `A`.
- **Preconditioning** (incomplete LU, multigrid) accelerates convergence dramatically.

Iterative methods never form the factors, so they avoid fill-in entirely — the right tool when `n` is huge and `A` is sparse.

### 4.3 Blocking and parallelism for dense large `n`

Dense `O(n³)` elimination is the classic **blocked LU** (LAPACK `dgetrf`): partition into tiles, cast the bulk of work as matrix-matrix multiply (`dgemm`), which is cache- and SIMD-friendly and parallelizes across cores/GPUs. For a from-scratch implementation, the rank-1 update `m[r][c] -= f·m[row][c]` is the inner loop to vectorize; loop order and contiguous (flat) storage matter as much as the algorithm.

### 4.4 Worked fill-in example

Consider an "arrow" sparse matrix: dense first row and first column, diagonal elsewhere.

```
[ * * * * ]      eliminating column 0 with the dense
[ * *     ]      pivot row 0 adds nonzeros into every
[ *   *   ]      other row's tail -> the whole matrix
[ *     * ]      fills in (becomes dense).
```

Eliminating column 0 subtracts multiples of the dense pivot row 0 from rows 1–3, creating nonzeros in their previously-empty tail columns — the matrix densifies completely, and the `O(nnz)` sparsity advantage evaporates. **Reordering** so the dense row/column is eliminated *last* (a trivial "minimum-degree"-style reorder) keeps the factors sparse. This tiny example is the whole motivation for fill-reducing orderings: the *order* of elimination, not the algorithm, decides whether a sparse solve stays cheap. Production sparse solvers spend most of their cleverness here.

---

## 5. GF(2) and Modular Engineering at Scale

### 5.1 GF(2) bitset solving

Over GF(2) a row is a bit vector; elimination is XOR. Packing rows into `uint64[]` words and XORing word-by-word gives the famous `O(n³ / 64)` solve. For `n` in the low thousands this turns an infeasible dense solve into milliseconds. This underpins:

- **XOR-basis / linear basis** (sibling `18-bit-manipulation`) — online GF(2) reduction maintaining one basis row per leading bit.
- **Coding theory** — syndrome decoding, parity-check solving.
- **Lights-out / switch puzzles**, **Nim-variant analysis**, **integer factorization** (the linear-algebra phase of the quadratic sieve / GNFS solves a giant GF(2) system).

### 5.2 Block bit-parallelism beyond one word

The "Method of Four Russians" (M4RI library) precomputes combinations of basis rows in blocks, achieving better than `O(n³/64)` asymptotically — relevant when GF(2) systems hit `n ≈ 10⁵` (as in factorization). For typical problems the plain bitset XOR is enough.

**The factorization connection.** In the quadratic sieve and the general number field sieve (the algorithms behind RSA-modulus factoring), the final step collects relations into a giant GF(2) matrix (rows = relations, columns = primes in the factor base) and finds a non-trivial null-space vector — a subset of relations whose product is a perfect square. That null-space search *is* GF(2) Gaussian elimination at `n ≈ 10⁶`–`10⁷`. Because the matrix is sparse, production solvers use **block Lanczos** or **block Wiedemann** (which never densify) rather than dense bitset elimination; dense M4RI is the right tool only up to `n ≈ 10⁵`. This is the most computationally heavy real-world instance of "solve a linear system over GF(2)".

### 5.3 Montgomery for hot mod-p loops

When `p` is fixed and the inner loop does millions of modular multiplies, **Montgomery multiplication** (sibling `14`) replaces the expensive `%` with shifts and multiplies, a large constant-factor win. Barrett reduction is the alternative when `p` is known at runtime.

The payoff scales with the cube: a `300×300` mod-p solve does `≈ (2/3)·300³ ≈ 1.8×10⁷` modular multiplies, and replacing a hardware division (tens of cycles) with a Montgomery multiply (a few cycles) can cut the wall-clock several-fold. The catch is the conversion overhead — values must enter and leave Montgomery form — so it pays off only when the *same* matrix undergoes many multiplies, which is exactly the elimination case. Precompute the inverse of each pivot once (not per elimination target) so the inner loop multiplies by a cached residue rather than recomputing `pivot⁻¹` every time; recomputing the inverse inside the inner loop is a common and costly mod-p performance bug.

### 5.4 CRT pipeline for exact large answers

```
solve mod p1 ─┐
solve mod p2 ─┼─ CRT / Garner (sibling 05, 15) ─→ exact answer mod (p1·p2·…)
solve mod p3 ─┘
```

Each modular solve is independent and embarrassingly parallel. Choose enough primes so their product exceeds the (bounded) magnitude of the true answer; bound that magnitude via Hadamard's inequality on the determinant for the denominator, and the entries for the numerator.

---

## 6. LU Factorization and Reuse

Gaussian elimination *is* the computation of `PA = LU`: `P` records the pivot row swaps, `L` the elimination multipliers (unit lower triangular), `U` the resulting upper-triangular matrix.

### 6.1 Solve many right-hand sides cheaply

Factor once (`O(n³)`), then each new `b` is solved by forward substitution `Ly = Pb` and back substitution `Ux = y`, each `O(n²)`. This is why you **never re-eliminate per right-hand side** and **never invert** `A`: with `k` right-hand sides, LU-reuse is `O(n³ + k n²)` versus `O(k n³)` for re-elimination.

### 6.2 Determinant and inverse from LU

`det(A) = (sign of P) · ∏ Uᵢᵢ` (sibling `18-matrix-determinant`). The inverse is `n` solves against the columns of `I` — but for solving `A·x = b`, never compute the inverse; solve directly.

### 6.3 Updating a factorization

When `A` changes by a low-rank update (one row/column edited), the **Sherman-Morrison / Woodbury** formulas update the solution in `O(n²)` without refactoring — important in optimization inner loops (simplex, interior-point) where the basis changes incrementally.

### 6.4 Where elimination shows up in production systems

| Domain | The system being solved | Field / method |
|--------|-------------------------|----------------|
| Computer graphics / physics | rigid-body dynamics, FEM stiffness `K·u = f` | reals; sparse direct or CG |
| Optimization (LP/QP) | KKT system at each interior-point iteration | reals; refactor or low-rank update |
| Circuit simulation (SPICE) | modified nodal analysis `G·v = i` | reals; sparse LU with fill-reducing ordering |
| Cryptanalysis / factoring | relation matrix null space | GF(2); block Lanczos/Wiedemann |
| Coding theory | syndrome / parity-check decoding | GF(2); bitset elimination |
| Competitive programming | counting, recurrences, XOR puzzles | `Z/pZ` or GF(2); exact |
| Computer algebra systems | exact rational/integer solving, determinants | `ℚ`; Bareiss + modular/CRT |

The same `O(n³)` (or `O(n³/64)`) skeleton serves all of them; the engineering differs in the *field* (reals vs `Z/pZ` vs GF(2)), the *structure* (dense vs sparse), and the *reuse pattern* (one-shot vs refactor-per-iteration vs cached LU). Recognizing which combination a problem demands is the senior skill this topic trains.

### 6.5 The refactor-vs-update decision in an optimization loop

Interior-point and simplex solvers repeatedly solve systems whose matrix changes only slightly between iterations. The decision tree: if the change is **low rank** (a few rows/columns), apply Sherman-Morrison/Woodbury for an `O(n²)` update; if the change is **structured** (a single basis swap in simplex), use a product-form or LU-update scheme; only **refactor from scratch** (`O(n³)`) when accumulated updates have degraded numerical stability (a periodic "reinversion" every few hundred iterations). Getting this cadence right is the difference between a solver that scales and one that recomputes everything every step — the optimization analogue of "factor once, solve many".

---

## 7. Code Examples

### 7.1 Go — LU factorization with partial pivoting, then multi-RHS solve

```go
package main

import (
	"fmt"
	"math"
)

// luDecompose computes PA = LU in place. perm holds the row permutation,
// sign tracks swap parity (for determinant). Returns false if singular.
func luDecompose(a [][]float64) (perm []int, sign float64, ok bool) {
	n := len(a)
	perm = make([]int, n)
	for i := range perm {
		perm[i] = i
	}
	sign = 1
	for col := 0; col < n; col++ {
		piv := col
		for r := col + 1; r < n; r++ {
			if math.Abs(a[r][col]) > math.Abs(a[piv][col]) {
				piv = r
			}
		}
		if math.Abs(a[piv][col]) < 1e-12 {
			return perm, sign, false
		}
		if piv != col {
			a[col], a[piv] = a[piv], a[col]
			perm[col], perm[piv] = perm[piv], perm[col]
			sign = -sign
		}
		for r := col + 1; r < n; r++ {
			a[r][col] /= a[col][col] // store multiplier in L part
			for c := col + 1; c < n; c++ {
				a[r][c] -= a[r][col] * a[col][c]
			}
		}
	}
	return perm, sign, true
}

// luSolve solves A·x = b using the factored matrix (O(n^2)).
func luSolve(lu [][]float64, perm []int, b []float64) []float64 {
	n := len(lu)
	y := make([]float64, n)
	for i := 0; i < n; i++ {
		y[i] = b[perm[i]]
		for j := 0; j < i; j++ {
			y[i] -= lu[i][j] * y[j]
		}
	}
	x := make([]float64, n)
	for i := n - 1; i >= 0; i-- {
		x[i] = y[i]
		for j := i + 1; j < n; j++ {
			x[i] -= lu[i][j] * x[j]
		}
		x[i] /= lu[i][i]
	}
	return x
}

func main() {
	A := [][]float64{{2, 1, -1}, {-3, -1, 2}, {-2, 1, 2}}
	perm, _, ok := luDecompose(A)
	fmt.Println("factored ok:", ok)
	fmt.Println(luSolve(A, perm, []float64{8, -11, -3})) // ~[2 3 -1]
	fmt.Println(luSolve(A, perm, []float64{0, 0, 0}))     // reuse same LU
}
```

### 7.2 Java — exact mod-p solve with rank/consistency classification

```java
public class GaussModPRank {
    static final long MOD = 998_244_353L;
    static long power(long a, long e) {
        long r = 1; a %= MOD;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        return r;
    }
    static long inv(long a) { return power(((a % MOD) + MOD) % MOD, MOD - 2); }

    // Returns rank; fills sol if consistent; sets inconsistent flag via sol==null.
    static long[] solve(long[][] A, long[] b) {
        int n = A.length, mc = A[0].length;
        long[][] m = new long[n][mc + 1];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < mc; j++) m[i][j] = ((A[i][j] % MOD) + MOD) % MOD;
            m[i][mc] = ((b[i] % MOD) + MOD) % MOD;
        }
        int[] where = new int[mc];
        java.util.Arrays.fill(where, -1);
        int row = 0;
        for (int col = 0; col < mc && row < n; col++) {
            int piv = -1;
            for (int r = row; r < n; r++) if (m[r][col] != 0) { piv = r; break; }
            if (piv == -1) continue;
            long[] t = m[row]; m[row] = m[piv]; m[piv] = t;
            long iv = inv(m[row][col]);
            for (int r = 0; r < n; r++) {
                if (r == row || m[r][col] == 0) continue;
                long f = m[r][col] * iv % MOD;
                for (int c = col; c <= mc; c++)
                    m[r][c] = ((m[r][c] - f * m[row][c]) % MOD + MOD) % MOD;
            }
            where[col] = row++;
        }
        for (int r = row; r < n; r++) if (m[r][mc] != 0) return null; // inconsistent
        long[] x = new long[mc];
        for (int c = 0; c < mc; c++)
            if (where[c] != -1) x[c] = m[where[c]][mc] * inv(m[where[c]][c]) % MOD;
        return x; // free variables left as 0 (one particular solution)
    }

    public static void main(String[] args) {
        long[][] A = {{1, 1, 1}, {0, 1, 2}};
        long[] b = {6, 5};
        long[] x = solve(A, b);
        System.out.println(x == null ? "no solution" : java.util.Arrays.toString(x));
    }
}
```

### 7.3 Python — GF(2) solver with bitset rows and free-variable enumeration count

```python
def solve_gf2(rows, n):
    """rows: ints (bit c = coeff of x_c, bit n = b). Returns (solution, num_solutions)
       or (None, 0) if inconsistent. num_solutions = 2^(free vars)."""
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
    for i in range(len(m)):
        if (m[i] & ((1 << n) - 1)) == 0 and (m[i] >> n) & 1:
            return None, 0  # 0 = 1 -> inconsistent
    x = [0] * n
    free = 0
    for col in range(n):
        if where[col] == -1:
            free += 1
        else:
            x[col] = (m[where[col]] >> n) & 1
    return x, 1 << free


if __name__ == "__main__":
    # x0 ^ x1 = 1 ; x1 ^ x2 = 0  (n=3); rows encode coeffs + b at bit 3
    rows = [0b1011, 0b0110]  # (x0+x1=1), (x1+x2=0)
    sol, count = solve_gf2(rows, 3)
    print(sol, count)  # a particular solution, and 2^(free) total
```

---

## 8. Observability and Testing

A linear-solver result is opaque — one wrong entry looks like any other number. Build in checks.

| Check | Why |
|-------|-----|
| Residual `‖A·x − b‖` (float) / `A·x ≡ b mod p` (field) | The single most valuable correctness check. |
| Smallest pivot magnitude (float) | Near-zero pivot flags near-singular / untrustworthy result. |
| Condition-number estimate `κ(A)` | Warns when the answer has lost most of its digits. |
| Compare against a reference solver (numpy / LAPACK) | Catches algorithmic bugs on random instances. |
| Rank agreement `rank(A) == rank([A|b])` | Rouché–Capelli consistency test. |
| Determinant sign vs swap parity | Validates the pivoting bookkeeping (sibling `18`). |
| Cross-language determinism (mod-p, GF(2)) | Same input → identical exact output in Go/Java/Python. |

### 8.1 A property-test battery

```text
for random A, b over the chosen field:
    x = solve(A, b)
    assert residual(A, x, b) ~ 0                  # the oracle
    assert solve(I, b) == b                        # identity system
    if A invertible: assert unique solution
    construct rank-deficient A: assert free-var count == n - rank
    construct inconsistent system: assert "no solution"
for mod-p: assert agreement across two primes via CRT recovers known integer answer
```

The **residual check** catches the overwhelming majority of bugs: a wrong pivot, a missed augmented-column update, a sign error, or an inverse mistake all show up as a non-zero residual.

### 8.2 Production guardrails

For a service solving systems at scale: log the **smallest pivot** and a **condition estimate** alongside each float result so anomalous answers stand out; assert the matrix is the expected shape; for mod-p, validate the modulus is prime (or document the composite handling); for GF(2), assert row width matches `n+1`.

### 8.3 Test matrices to keep in the suite

A robust test battery for a linear solver covers these canonical inputs:

- **Identity and permutation matrices** — `solve(I, b) == b`; permutations test the swap bookkeeping.
- **Known-inverse matrices** (e.g. tridiagonal, triangular) — exact expected output.
- **Hilbert matrix** (`§2.5`) — exercises the ill-conditioning path and the condition estimate.
- **Singular matrix** (a zero row, or a row that is a multiple of another) — must report no unique solution / correct rank.
- **Inconsistent system** (parallel-line `2x+2y=5` vs `x+y=2`) — must report no solution.
- **Rank-deficient consistent system** — must report the right free-variable count and a valid particular solution.
- **Random well-conditioned matrices** — compared entrywise against a reference solver (numpy / LAPACK) with a residual tolerance.
- **Random mod-p / GF(2) systems** — cross-checked for determinism across Go/Java/Python on the same seed, and verified by `A·x ≡ b`.

Each input targets a specific code path (pivoting, rank, consistency, free variables, field arithmetic). A solver that passes all of them on hundreds of randomized instances is trustworthy; one tested only on a single `3×3` is not.

### 8.4 The residual as a universal oracle

The deepest reason the residual check is so powerful: it is **field-agnostic and algorithm-agnostic**. Whether you used LU, Gauss-Jordan, Bareiss, or a bitset XOR solver, the contract is identical — `A·x` must equal `b` (within `eps` over the reals, exactly over a field). It catches every transcription bug (a missed augmented-column update), every sign error, every wrong inverse, and every overflow, because all of those produce an `x` that fails to satisfy the original equations. Compute it on every test and, in `debug` builds, on every production solve cheap enough to afford it.

---

## 9. Failure Modes

### 9.1 No pivoting → catastrophic float error
A tiny pivot divides, losing all significant digits. Mitigation: always partial-pivot; treat `|pivot| < eps` as singular; consider iterative refinement.

### 9.2 Ill-conditioning silently ruins the answer
Even perfect pivoting cannot save `κ(A) ≈ 10^16` in `double` — the answer is noise. Mitigation: estimate `κ`; use higher precision, SVD, or regularization; report untrustworthy results rather than returning them blindly.

### 9.3 Float `== 0` comparison misclassifies rank/consistency
Exact-zero tests on float-arithmetic outputs misjudge whether a pivot exists. Mitigation: use a tolerance `eps`; for exact rank, use `Z/pZ`.

### 9.4 Overflow in the mod-p inner loop
`f * m[row][c]` overflows `int64` for large `p`, or a deferred accumulation overflows. Mitigation: reduce per multiply; use 128-bit or Montgomery for `p` near `2^62`.

### 9.5 Non-prime modulus breaks inversion
A pivot non-invertible mod composite `m` stalls elimination or gives wrong answers. Mitigation: factor and CRT (sibling `05`), or use fraction-free Bareiss elimination.

### 9.6 Re-eliminating per right-hand side
Solving `k` systems with the same `A` by re-running elimination is `O(k n³)`. Mitigation: factor `A = LU` once, reuse for `O(n²)` per `b`.

### 9.7 Computing `A⁻¹` to solve `A·x = b`
Inverting then multiplying is slower and less accurate than a direct solve. Mitigation: solve directly; only form the inverse if the inverse itself is the deliverable.

### 9.8 Dense elimination on a large sparse system
`O(n³)` and fill-in blow up memory and time. Mitigation: fill-reducing ordering + sparse direct solver, or switch to preconditioned iterative methods (CG/GMRES).

### 9.9 GF(2) without bitsets at scale
Element-by-element GF(2) elimination is `O(n³)` and needlessly slow. Mitigation: pack rows into words and XOR; use M4RI for `n ≈ 10⁵`.

### 9.9b Iterative refinement misapplied to an ill-conditioned system
Iterative refinement recovers digits lost to *rounding* in a moderately conditioned system, but it cannot fix an intrinsically ill-conditioned one (`κ` huge) — the refinement steps themselves are computed in the same poisoned precision and stop improving. Symptom: the residual shrinks but the answer does not converge to the true `x`. Mitigation: use extended precision for the residual computation, or accept that the problem needs SVD/regularization, not refinement.

### 9.10 Under-provisioned CRT silently wraps
Solving an exact integer system mod too few primes recovers a value mod `∏pᵢ` that wraps around when the true answer exceeds `∏pᵢ/2`, producing a plausible but wrong integer. Symptom: the answer changes when you add another prime. Mitigation: bound the answer's magnitude (Hadamard on the determinant for denominators, on entries for numerators) and provision enough primes with margin; assert stability by re-running with one extra prime.

### 9.11 Non-normalized residues across languages
Go and Java `%` can return negative values; Python's does not. A mod-p solver that forgets `((x % p) + p) % p` produces negative residues that diverge across languages and break equality tests. Symptom: cross-language determinism tests fail on inputs that involve subtraction. Mitigation: normalize after every subtraction; add a determinism test on seeded inputs.

### 9.12 Treating an exact problem with floats
Solving an integer/rational system in `double` and rounding the result is a silent correctness bug — rounding can flip a `2.9999999` that should be `3`, or produce a non-integer where the true answer is integral. Symptom: off-by-tiny answers on problems with known exact solutions. Mitigation: if the problem is exact, solve over `Z/pZ` or with Bareiss — never float-then-round.

---

## 10. Summary

- **Pivoting controls algorithm error; conditioning is intrinsic data error.** Partial pivoting bounds growth and is the default; full pivoting is stronger but costlier; nothing but precision/reformulation fixes an ill-conditioned `κ(A)`. Estimate `κ` and watch the smallest pivot.
- **Exactness lives in `Z/pZ` and GF(2).** No rounding, no conditioning — divide by multiplying by the modular inverse (siblings `02`, `06`), any non-zero pivot works. For answers exceeding one prime, solve under several primes and recombine via CRT/Garner (siblings `05`, `15`); for integers use fraction-free Bareiss to avoid inverses entirely.
- **Overflow is the mod-p enemy.** Reduce per multiply; use 128-bit, Montgomery, or Barrett (sibling `14`) for large `p`.
- **GF(2) = XOR + bitsets.** The `O(n³ / 64)` word-parallel solve underpins XOR bases (sibling `18-bit-manipulation`), coding theory, and the linear-algebra phase of factorization; M4RI pushes it further.
- **Sparse/large systems abandon dense elimination.** Fill-reducing orderings + sparse direct solvers, or preconditioned iterative methods (CG/GMRES) when `A` is huge and sparse; blocked LU + BLAS for dense large `n`.
- **Factor once, solve many.** Gaussian elimination is `PA = LU`; reuse the factorization (`O(n²)` per right-hand side) and never invert to solve. Determinant is the signed pivot product (sibling `18`).
- **Always verify the residual.** `A·x ≈ b` (float) or `A·x ≡ b mod p` (field) catches almost every bug; add rank-consistency and cross-language determinism tests.

### Decision summary

- **Dense, real, well-conditioned** → partial-pivot Gaussian elimination / LU; reuse LU for many RHS.
- **Symmetric positive-definite** → Cholesky (cheaper, no pivoting).
- **Exact answer (integer/rational/modular)** → `Z/pZ` elimination + CRT/Bareiss/rational reconstruction.
- **GF(2) / XOR system** → bitset elimination (`O(n³/64)`); XOR basis for online insertion.
- **Large sparse** → sparse direct (fill-reducing) or preconditioned iterative.
- **Ill-conditioned / least-squares / rank-deficient** → QR or SVD, possibly regularized.

### The one mental checklist

Before writing a single line of a linear solver, answer four questions in order:

1. **What field?** Reals (float), `Z/pZ` (exact mod a prime), `ℚ` (exact rational), or GF(2) (XOR). This decides the arithmetic and the pivoting rule.
2. **Dense or sparse?** Dense → `O(n³)` elimination/LU. Large and sparse → fill-reducing direct solver or iterative.
3. **One right-hand side or many?** Many → factor `A = LU` once, reuse `O(n²)` per solve. Never invert to solve.
4. **How will I verify it?** The residual `A·x ≈ b` (float) or `A·x ≡ b mod p` (field), plus a condition estimate over the reals. No solver ships without this check.

Getting these four right is more than half the battle; the elimination loop itself is the easy part. The senior failure modes — silent ill-conditioning, overflow, under-provisioned CRT, float-then-round on an exact problem — all trace back to skipping one of these questions. The algorithm is timeless and simple; the judgment about *which variant, over which field, verified how* is the engineering.

References to study further: Trefethen & Bau, *Numerical Linear Algebra* (pivoting, conditioning, stability); Golub & Van Loan, *Matrix Computations* (LU, Cholesky, sparse, blocking); Bareiss fraction-free elimination; the M4RI library for GF(2); SuiteSparse/SuperLU for sparse; and sibling topics `02-modular-arithmetic`, `05-crt`, `06-extended-euclidean-modular-inverse`, `14-montgomery-multiplication`, `15-garner-algorithm`, `16-continued-fractions`, `18-matrix-determinant`, `19-matrix-rank`, and `18-bit-manipulation` (XOR basis).
