# Matrix Determinant — Senior Level

> The determinant is one line of math and a minefield of production decisions: float elimination silently lies about singularity when the matrix is ill-conditioned; exact integer elimination overflows or drowns in fractions unless you use Bareiss or CRT-over-primes; mod-`p` is exact but can return `0` for a *non-singular* matrix that happens to be singular modulo that one prime; and sparse or structured matrices waste an `O(n^3)` dense pass. Every one of these is a real incident, not a textbook footnote.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Choosing the Arithmetic: A Decision Framework](#2-choosing-the-arithmetic-a-decision-framework)
3. [Float Determinants and Numerical Stability](#3-float-determinants-and-numerical-stability)
4. [Exact Integer Determinants: Bareiss, Overflow, and Hadamard](#4-exact-integer-determinants-bareiss-overflow-and-hadamard)
5. [Mod-p and CRT for Huge Values](#5-mod-p-and-crt-for-huge-values)
6. [Sparse and Structured Matrices](#6-sparse-and-structured-matrices)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is not "how do I compute a determinant" but "which determinant algorithm is correct for *this* data, *these* constraints, and *this* failure budget". The determinant shows up in three guises that share the `O(n^3)` elimination engine but demand different arithmetic:

1. **Numerical / geometric** — areas, volumes, Jacobians, orientation tests. Real-valued, floating point, and the enemy is *conditioning*, not speed.
2. **Exact combinatorial** — counting spanning trees (matrix-tree), exact integer linear algebra, cryptographic lattice work. The enemy is *number growth* (fractions and overflow).
3. **Modular** — exact-mod-`p` answers, or exact-integer answers reconstructed via CRT across primes. The enemy is *a bad prime* (one where the matrix becomes singular mod `p`).

All three reduce to: *reduce to triangular, multiply the pivots, flip the sign per swap.* The senior decisions are which number system to eliminate in, how to keep the arithmetic exact and overflow-free, how to detect and handle near-singular or exactly-singular matrices, and how to verify a result you cannot easily recompute by hand. This document treats those decisions in production terms.

The recurring theme is that **the algorithm is trivial; the arithmetic is where incidents live.** A determinant routine that "works on the examples" can silently:

- return `1e-13` for a singular matrix (float rounding) and pass a `!= 0` invertibility check;
- overflow `int64` in a Bareiss transient and return a plausible-but-wrong integer;
- return `0` for a non-singular matrix because the chosen prime divides the true determinant;
- waste minutes on a dense pass over a sparse graph Laplacian.

Each of these is a one-line oversight with a production-sized blast radius. The sections below are organized around preventing exactly these.

---

## 2. Choosing the Arithmetic: A Decision Framework

| Situation | Method | Why |
|-----------|--------|-----|
| Real inputs, approximate answer acceptable | float Gaussian elimination + partial pivoting | `O(n^3)`, stable enough with pivoting |
| Real inputs, need a reliable singularity verdict | rank/SVD or condition number, **not** `det` | `|det|` is a poor conditioning measure |
| Integer inputs, answer mod a prime `p` | `Z/pZ` elimination (modular-inverse pivots) | exact, bounded, `O(n^3)` |
| Integer inputs, exact value, moderate magnitude | Bareiss (fraction-free) with native ints | no fractions, stays integer; watch overflow |
| Integer inputs, exact value, large magnitude | Bareiss with big integers, **or** CRT over several primes | Hadamard bound sets the cost |
| Rational inputs | clear denominators → integer case, or exact rational arithmetic | reduce to integer determinant |
| Sparse / structured matrix | block / LU exploiting structure, or sparse LU | avoid a dense `O(n^3)` pass |

The single most consequential choice is **exact vs approximate**. If a downstream decision branches on `det == 0` (invertibility, spanning-tree count, linear dependence), floats are the wrong tool — rounding makes the equality meaningless. Use mod `p` or Bareiss.

### 2.1 A Worked Decision

Suppose a service receives a `200×200` integer matrix with entries up to `10^6` and must answer "is it invertible, and if so what is its exact determinant?". Walk the framework:

1. **Exact?** Yes — "invertible" branches on `det == 0`, so floats are out.
2. **Magnitude?** Hadamard: `|det| ≤ (10^6 · √200)^200`, about `(1.4×10^7)^200`, roughly `4700` bits. Far beyond `int64`.
3. **Path?** Big-integer Bareiss (one run, no reconstruction) *or* mod-`p` over `~152` primes near `2^31` plus CRT (fixed-width, parallel). For `n = 200`, the CRT path is usually faster because every operation is a native `int64` multiply, and the `152` prime-runs parallelize across cores.
4. **Verdict.** `det == 0` ⇔ singular; a single `0 mod p` is *inconclusive* (bad-prime), so the invertibility verdict must come from the *reconstructed* value (or from at least two primes both giving `0`).

This is the kind of reasoning the rest of the document equips you to do automatically.

---

## 3. Float Determinants and Numerical Stability

Floating point is the right tool when inputs are genuinely real (geometry, physics, Jacobians) and an approximate answer suffices. But "approximate" hides two distinct hazards: *stability* (does the algorithm amplify rounding?) and *interpretation* (does a near-zero result actually mean near-singular?). Partial pivoting handles the first; nothing handles the second except not asking floats the exact-zero question. This section separates the two carefully.

### 3.1 Partial pivoting is mandatory

Without pivoting, dividing by a tiny pivot amplifies rounding error catastrophically. **Partial pivoting** (swap the largest-magnitude entry in the current column to the pivot position) bounds the growth factor and is the standard. Complete pivoting (largest over the whole remaining submatrix) is more stable but rarely worth the cost.

### 3.2 The determinant overflows/underflows

The determinant is a *product* of `n` pivots; for large `n` it can overflow or underflow a `double` even when each pivot is moderate. The fix is to accumulate the **log-determinant**: sum `log|pivot|` and track the sign separately. Many libraries (LAPACK `getrf` + a log-sum, SciPy `slogdet`) return `(sign, logabsdet)` precisely for this reason.

```
slogdet:  sign = (-1)^{#swaps} · ∏ sign(pivot);   logabsdet = Σ log|pivot|
det = sign · exp(logabsdet)        # only materialize if it won't overflow
```

### 3.2b The LU connection and reusing the factorization

The float determinant is a free byproduct of an **LU factorization** (`PA = LU`): once you have `L`, `U`, and the permutation `P`, `det(A) = det(P)·∏ U[i][i] = (−1)^{#swaps}·∏ U[i][i]`. So if your code already solves `Ax = b` via LU (LAPACK `getrf`), the determinant costs only an `O(n)` diagonal pass — do not run a separate elimination. Conversely, if you *only* need the determinant, you still pay the full `O(n^3)` factorization; there is no shortcut that beats it for a general dense matrix. The practical rule: compute LU once, reuse it for solves, inverses, *and* the determinant.

### 3.3 `|det|` is not a conditioning measure

A diagonal matrix `0.1·I` of size `n` has determinant `0.1^n` — astronomically small — yet is perfectly well-conditioned (condition number `1`). Conversely a matrix can have determinant `1` and be nearly singular. **Never** use the magnitude of the determinant to judge how close a matrix is to singular; use the condition number (`κ = ‖A‖·‖A^{-1}‖`) or the smallest singular value. The determinant only answers the binary *exactly-singular* question, and even that unreliably in floating point.

### 3.4 When floats answer the singularity question wrong

A genuinely singular matrix often yields a tiny nonzero float determinant; a barely-nonsingular matrix may yield exactly `0` after rounding. If the singular/nonsingular verdict matters, do the elimination in exact arithmetic (mod `p` or Bareiss) or compute the numerical rank via SVD with a principled tolerance. This is the most common production mistake with float determinants.

### 3.5 Worked Scaling Pathology

Consider the diagonal matrix `A = 0.01 · I_{100}` (every diagonal entry `0.01`). Its determinant is `0.01^100 = 10^{-200}` — far below `double`'s smallest normal (`~10^{-308}` is representable but products underflow well before that for larger `n`). Yet `A` is *perfectly conditioned*: `κ(A) = 1`, every eigenvalue is `0.01`, and `A^{-1} = 100·I` is computed exactly. A naive "small determinant ⇒ near singular ⇒ reject" guard would wrongly reject a benign matrix. The `slogdet` form returns `(sign=+1, logabsdet = 100·ln(0.01) ≈ −460.5)` cleanly, never underflowing, and the conditioning question is answered separately by `κ`. This single example is why Sections 3.2–3.3 insist on `slogdet` and on divorcing `|det|` from conditioning.

### 3.6 Growth Factor and Pivoting Strategy

The numerical error of float elimination scales with the **growth factor** `ρ = max|m_{ij}^{(k)}| / max|a_{ij}|` — how large intermediate entries get relative to the input. Partial pivoting bounds `ρ ≤ 2^{n-1}` (rarely attained; in practice `ρ` is small). Complete pivoting bounds `ρ` polynomially but costs an `O(n^3)` search for the global max. For determinants, partial pivoting is the standard; switch to complete pivoting only if a known-pathological growth pattern (e.g. the Wilkinson matrix) appears. Rook pivoting is a cheaper middle ground. The takeaway: *always pivot*, default to partial, and monitor `ρ` if accuracy is suspect.

---

## 4. Exact Integer Determinants: Bareiss, Overflow, and Hadamard

When the answer must be an *exact integer* and no modulus is given — spanning-tree counts, lattice determinants, exact linear algebra — you face the number-growth problem head-on. Plain elimination produces fractions; clearing them explodes the magnitudes. Bareiss is the canonical fix, but it has its own overflow trap (the transient), and Hadamard's bound is the ruler that tells you which integer type to use. These three — algorithm, overflow, bound — are inseparable.

### 4.1 Why plain elimination fails over the integers

Plain Gaussian elimination divides by pivots, producing fractions. Even if the final determinant is a modest integer, intermediate fractions can have enormous numerators and denominators. Clearing them is wasteful and error-prone. **Bareiss** rewrites the update as

```
m[r][k] ← ( m[r][k]·pivot − m[r][pivCol]·m[pivRow][k] ) / prevPivot
```

where the division by `prevPivot` is **always exact** (Sylvester's identity, proved in `professional.md`). Every intermediate stays an integer equal to a minor's determinant, so the magnitudes are bounded by Hadamard's inequality rather than blowing up.

### 4.2 Hadamard's bound sizes the problem

For an `n×n` integer matrix with entries bounded by `B` in absolute value, Hadamard's inequality gives

```
|det(A)| ≤ ∏_i ‖row_i‖_2 ≤ (B√n)^n = n^{n/2} · B^n.
```

So the determinant has at most `~ (n/2)·log n + n·log B` bits. This number is what decides:

- whether the answer fits in `int64` (use native ints) or needs **big integers**;
- how many CRT primes you need (`Σ log pᵢ` must exceed the bit bound, with a factor of 2 for the sign).

Always compute the Hadamard bound first; it tells you which implementation path is safe.

**Worked Hadamard.** For `A = [[6,1,1],[4,−2,5],[2,8,7]]`, the row 2-norms are `√(36+1+1)=√38≈6.16`, `√(16+4+25)=√45≈6.71`, `√(4+64+49)=√117≈10.82`. Their product is `≈ 447`. So `|det(A)| ≤ 447`; the true value `−306` indeed satisfies `|−306| ≤ 447`. The bound has about `log2(447) ≈ 8.8` bits — trivially within `int64`, so native-integer Bareiss is safe here (no big integers, no CRT needed). Doubling the entries to `B = 2·10^9` would push the bound to `~(2×10^9·√3)^3 ≈ 4×10^{28}`, well past `int64`, flipping the decision to big-int Bareiss or CRT.

**When the bound is tight.** Hadamard's inequality is an *equality* exactly when the rows are mutually orthogonal (the parallelepiped is a rectangular box). So for matrices whose rows are far from orthogonal, the true `|det|` is much smaller than the bound — the bound is conservative, which is the safe direction (you never under-allocate primes or integer width). But you cannot *use* the gap: without computing the determinant you do not know how slack the bound is, so always size for the worst case the bound allows. A cheaper, often-tighter alternative is the column-norm version (`∏ ‖col_j‖_2`); take the min of the row-bound and column-bound for a slightly smaller, still-valid estimate.

### 4.3 Overflow in Bareiss with native integers

Even though Bareiss keeps values integer and bounded by Hadamard, that bound can exceed `int64` for moderate `n` and `B`. The intermediate `m[r][k]·pivot − m[r][pivCol]·m[pivRow][k]` is a *product of two minors*, roughly squaring the magnitude before the exact division brings it back down. So the transient can overflow even when the final fits. Mitigations: use `__int128` / `BigInteger` for the transient, or run mod several primes and CRT. Never assume native ints suffice without checking the Hadamard bound against the transient size.

### 4.4 Worked Transient-Overflow Scenario

Take `n = 4`, entries up to `B = 10^5`. The *final* determinant is bounded by Hadamard at `(10^5·2)^4 = (2×10^5)^4 = 1.6×10^{21}` — already past `int64`'s `~9.2×10^{18}`. But the Bareiss *transient* `m[r][k]·pivot − m[r][c]·m[pivRow][k]` multiplies two `(k+1)`-minors before the exact division: each minor can be `~(10^5·√3)^3 ≈ 5×10^{15}`, and their product is `~2.5×10^{31}` — vastly over `int64`, even over `__int128`'s `~1.7×10^{38}` headroom only barely. The lesson: do **not** assume native ints suffice from the final-answer bound alone; the transient roughly *squares* the intermediate magnitude. Either compute the transient in `BigInteger`/`__int128` with a checked Hadamard estimate, or sidestep entirely with mod-`p`+CRT where every value stays `< p < 2^31`.

### 4.5 Rational and structured inputs

Rational matrices: scale each row by the lcm of its denominators (multiplying the determinant by a known factor you divide out at the end), reducing to the integer case. Matrices with known structure (integer, symmetric, banded) can use specialized exact methods, but Bareiss is the robust default for a general exact integer determinant. For a matrix of fractions `p_ij/q_ij`, if you scale row `i` by `L_i = lcm_j q_ij`, the determinant is multiplied by `∏_i L_i`; compute the integer determinant of the scaled matrix via Bareiss and divide the result by `∏_i L_i` at the end (this final division is exact in `ℚ`).

---

## 5. Mod-p and CRT for Huge Values

Modular arithmetic is the workhorse for *exact* determinants at scale: every operation is a fixed-width `int64` multiply-and-reduce, with no rounding and no fraction growth. The price is one subtlety — a single prime sees only `det(A) mod p`, which loses information (a bad prime can collapse a nonzero determinant to `0`). The CRT pipeline buys back the full exact value by combining enough primes. This section covers both the hazard and the reconstruction.

### 5.1 Single-prime mod-`p` is exact but can be fooled

Elimination over `Z/pZ` gives `det(A) mod p` exactly. But beware: a matrix that is **non-singular over the integers** can be **singular modulo a particular `p`** (if `p` divides the true determinant). Then the mod-`p` computation returns `0`, which is correct *for that modulus* but does not mean the integer determinant is `0`. If you need the singular/nonsingular verdict over the integers, a single `0 mod p` is *inconclusive* — try another prime, or use Bareiss.

### 5.2 CRT pipeline for the exact value

The mod-`p` elimination is not merely "exact for that prime" — it is the building block of an exact-integer pipeline. The key fact (proved in `professional.md`, Proposition 9.1) is that reduction commutes with the determinant: `det(A) mod p = det(A mod p)`. So each prime gives a true residue of the same integer `det(A)`, and CRT stitches them back together.

To recover the exact integer determinant, run the mod-`p` elimination under several primes `p₁, …, p_m` whose product exceeds `2·(Hadamard bound)` (the factor 2 handles the sign via balanced/symmetric residues), then reconstruct via the Chinese Remainder Theorem (sibling `05-crt`, `15-garner-algorithm`):

```
det mod p₁ ─┐
det mod p₂ ─┼─ CRT ─→ det mod (p₁ p₂ … p_m) ─→ exact det (balanced representative)
det mod p₃ ─┘
```

Each prime is an **independent** `O(n^3)` job — embarrassingly parallel. This is usually faster and simpler than big-integer Bareiss for large `n`, because every operation is fixed-width `int64` arithmetic.

### 5.3 Choosing primes

Pick primes near `2^31` (so products fit `int64` before reduction) and coprime to each other (distinct primes are automatically coprime). NTT-friendly primes like `998244353` are convenient if you reuse them elsewhere. The number of primes is `ceil((bit bound + 1) / log2(min prime))`; size it from Hadamard, then add one for safety.

**Why near `2^31` and not larger?** Inside the elimination, the hot operation is `factor * m[c][k]`, a product of two reduced residues each `< p`. For that product to fit in a signed `int64` (`< 2^63`) before the `% p`, you need `p^2 < 2^63`, i.e. `p < 2^{31.5} ≈ 3×10^9`. Primes just under `2^31` (like `2_000_000_011`) give the most "value per prime" — `~31` bits — while staying safely within the squared-product budget. Going to `~2^62` primes would overflow the product and force a `__int128` or Montgomery multiplication, slowing every inner-loop step; near-`2^31` primes keep the inner loop in plain `int64`.

### 5.4 Recovering the sign

CRT gives a residue in `[0, ∏pᵢ)`. The true determinant may be negative, so map to the **balanced representative**: if the residue exceeds `∏pᵢ / 2`, subtract `∏pᵢ`. This works precisely because the Hadamard bound guarantees `|det| < ∏pᵢ / 2`.

### 5.5 Worked CRT Recovery

Suppose the true determinant is `det(A) = −306`, and we run mod `p₁ = 1009` and `p₂ = 1013` (product `1,022,117 > 2·306`):

```
−306 mod 1009 = 703
−306 mod 1013 = 707
```

CRT: find `x ≡ 703 (mod 1009)`, `x ≡ 707 (mod 1013)`. With `inv = 1009^{-1} mod 1013`, `t = (707 − 703)·inv mod 1013`, giving `x = 703 + 1009·t` in `[0, 1,022,117)`. The raw CRT result is `1,021,811`. Since `1,021,811 > 1,022,117/2 = 511,058`, subtract the product: `1,021,811 − 1,022,117 = −306`. ✓ The balanced representative recovers the negative sign exactly — which only works because `2·|det| = 612 < 1,022,117 = ∏pᵢ`. Had we used a single prime `1009`, we would have gotten `703` with no way to know it represents `−306`.

### 5.6 Garner vs Naive CRT for Many Primes

For two primes the explicit formula in Section 5.5 is fine, but with `~150` primes (the `n = 200` case of Section 2.1), **Garner's algorithm** (sibling `15-garner-algorithm`) reconstructs incrementally in mixed-radix form, avoiding a single giant modulus inverse and keeping each step in fixed-width arithmetic until the final big-integer assembly. It is the production reconstruction for large prime sets, numerically and computationally cleaner than computing `∏pᵢ` and one big inverse. Pair it with the balanced-representative step at the very end to recover the sign.

---

## 6. Sparse and Structured Matrices

The `O(n^3)` cost assumes a dense, structureless matrix. Real inputs are rarely that. Recognizing and exploiting structure — sparsity, block-triangularity, symmetry, bandedness — is often a bigger win than any constant-factor tuning of the dense loop, sometimes turning `O(n^3)` into `O(n)` or `O(n·band^2)`. The first step is always to *look* at the matrix before reaching for the generic routine.

Most determinants in number-theory and graph work are *not* dense random matrices — they are Laplacians, companion matrices, banded systems, or block-decomposable operators. Treating every one with a dense `O(n^3)` pass leaves large speedups on the table. This section covers the structural shortcuts.

### 6.1 Dense elimination wastes sparsity

A graph Laplacian (matrix-tree theorem) is usually sparse, but a naive dense `O(n^3)` elimination ignores that. Sparse LU with a fill-reducing ordering (minimum degree, nested dissection) can compute the determinant in far less than `O(n^3)` when fill-in is limited. The determinant is still the product of the (sparse) `U` diagonal times the permutation sign. The catch is **fill-in**: elimination creates new nonzeros, and a poor pivot order can densify a sparse matrix completely (turning the `O(n^3)` you tried to avoid right back on). A good fill-reducing ordering, computed once up front, is what makes sparse determinants pay off.

### 6.2 Block and triangular structure

- **Block-triangular** `A = [[B, C], [0, D]]` ⇒ `det(A) = det(B)·det(D)`. Detect block structure (e.g., via strongly connected components of the sparsity pattern) and recurse.
- **Already triangular / diagonal** ⇒ read off the diagonal product directly; skip elimination.
- **Symmetric positive definite** ⇒ Cholesky `A = LLᵀ` gives `det(A) = ∏ L[i][i]^2`, cheaper and more stable than LU.

### 6.3 The matrix-tree case specifically

For counting spanning trees you delete one row and column of the Laplacian and take the determinant of an `(n−1)×(n−1)` matrix. For large sparse graphs, use a sparse exact (mod `p` + CRT) determinant; the answer is an exact integer (the tree count), so floats are wrong. Hadamard on the Laplacian minor bounds the count's size and hence the number of CRT primes.

### 6.4 Worked Block-Triangular Shortcut

Suppose the sparsity pattern, after reordering by strongly connected components of the directed graph `i → j` iff `A[i][j] ≠ 0`, is block upper-triangular:

```
A = [ B  C ]      B is 3×3, D is 2×2, the lower-left block is all zeros
    [ 0  D ]
```

Then `det(A) = det(B)·det(D)` (a standard cofactor/Leibniz consequence: no permutation can pick a nonzero entry from the zero block without forcing a zero elsewhere). So a `5×5` determinant becomes a `3×3` times a `2×2` — and recursively, a matrix that decomposes into `k` blocks of size `s` costs `k·O(s^3)` instead of `O((ks)^3)`, a factor-`k^2` saving. Detecting the block structure is an `O(V+E)` Tarjan SCC pass on the sparsity pattern. This is the single highest-value structural optimization for the reducible matrices common in dependency/flow graphs.

### 6.5 Fast matrix multiplication

Asymptotically, the determinant can be computed in `O(n^ω)` (the matrix-multiplication exponent, `ω < 2.372`) via block recursion over a field. In practice, for the `n` that arise in graph/number-theory work, cache-tuned `O(n^3)` elimination wins; the subcubic algorithms matter only for very large dense matrices and bring numerical/implementation complications. Know they exist; reach for them rarely.

---

## 7. Code Examples

### 7.1 Go — slogdet (stable float log-determinant)

```go
package main

import (
	"fmt"
	"math"
)

// slogdet returns (sign, log|det|) to avoid overflow in the product of pivots.
func slogdet(a [][]float64) (float64, float64) {
	n := len(a)
	m := make([][]float64, n)
	for i := range m {
		m[i] = append([]float64(nil), a[i]...)
	}
	sign := 1.0
	logabs := 0.0
	for c := 0; c < n; c++ {
		piv := c
		for r := c + 1; r < n; r++ {
			if math.Abs(m[r][c]) > math.Abs(m[piv][c]) {
				piv = r
			}
		}
		if m[piv][c] == 0 {
			return 0, math.Inf(-1) // singular: det = 0, log|det| = -inf
		}
		if piv != c {
			m[c], m[piv] = m[piv], m[c]
			sign = -sign
		}
		p := m[c][c]
		if p < 0 {
			sign = -sign
		}
		logabs += math.Log(math.Abs(p))
		for r := c + 1; r < n; r++ {
			f := m[r][c] / p
			for k := c; k < n; k++ {
				m[r][k] -= f * m[c][k]
			}
		}
	}
	return sign, logabs
}

func main() {
	A := [][]float64{{2, 1, 1}, {4, 3, 3}, {8, 7, 9}}
	s, l := slogdet(A)
	fmt.Printf("sign=%.0f log|det|=%.6f det=%.4f\n", s, l, s*math.Exp(l)) // det=4
}
```

### 7.2 Java — exact integer determinant via CRT over two primes

```java
import java.math.BigInteger;

public class DetCRT {
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
            long inv = BigInteger.valueOf(m[c][c]).modInverse(BigInteger.valueOf(mod)).longValue();
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
        long p1 = 1_000_000_007L, p2 = 998_244_353L;
        BigInteger r1 = BigInteger.valueOf(detModP(A, p1));
        BigInteger r2 = BigInteger.valueOf(detModP(A, p2));
        BigInteger P1 = BigInteger.valueOf(p1), P2 = BigInteger.valueOf(p2);
        // CRT: x ≡ r1 (mod p1), x ≡ r2 (mod p2)
        BigInteger inv = P1.modInverse(P2);
        BigInteger t = r2.subtract(r1).multiply(inv).mod(P2);
        BigInteger x = r1.add(P1.multiply(t));            // in [0, p1*p2)
        BigInteger prod = P1.multiply(P2);
        if (x.compareTo(prod.shiftRight(1)) > 0) x = x.subtract(prod); // balanced
        System.out.println("exact det = " + x); // 4
    }
}
```

### 7.3 Python — Bareiss with overflow-proof big integers + Hadamard check

```python
from math import isqrt, prod


def hadamard_bound(a):
    # upper bound on |det|: product of row 2-norms (rounded up)
    b = 1
    for row in a:
        norm2 = sum(x * x for x in row)
        b *= isqrt(norm2) + 1
    return b


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
    A = [[2, 1, 1], [4, 3, 3], [8, 7, 9]]
    print("hadamard bound:", hadamard_bound(A))  # >= |det|
    print("exact det:", det_bareiss(A))          # 4
```

### 7.4 Performance Notes on the Three Implementations

| Method | Per-op cost | `n = 200` wall-clock (typical) | Bottleneck |
|--------|-------------|-------------------------------|------------|
| float elimination | `O(1)` double mul | ~5 ms | memory bandwidth, `V³` loop |
| mod-`p` (single prime) | `O(1)` int64 mul + reduce | ~10 ms | the `% p` per inner step |
| mod-`p` + CRT (`m` primes) | `m ×` single prime | `m × 10` ms (parallel: `~10` ms) | embarrassingly parallel across primes |
| Bareiss (native int) | `O(1)` int64 mul/div | ~12 ms | exact division per step |
| Bareiss (big-int) | `O(M(d))` per op | grows with digit length `d` | big-integer multiply |

The single biggest float win is the cache-friendly `i, c, k` loop order (stream `m[c][·]` row-contiguously) and operating on a flat `n²` array. For mod-`p`, batching reductions with a `__int128` accumulator (reduce every few products rather than every product) cuts the division count. For big-int Bareiss, the cost is dominated by the few largest intermediates near the bottom-right corner, where the minors are largest — which is precisely why mod-`p`+CRT (fixed-width throughout) often beats it for large `n`.

### 7.5 Memory and Buffer Reuse

Each `n × n` `int64` matrix is `8n²` bytes — `320 KB` for `n = 200`, `8 MB` for `n = 1000`. Copy the input *once* at the top of the determinant function (elimination is destructive) and eliminate in place; never allocate a fresh matrix per column. For CRT over `m` primes, reuse a single scratch matrix across primes (reduce the original mod each `p` into the scratch) rather than holding `m` copies. These are the same buffer-reuse disciplines that keep GC pressure and latency flat at scale.

---

## 8. Observability and Testing

A determinant is a single opaque number; a wrong one looks like any other number — there is no stack trace, no obviously malformed output, just a quietly incorrect integer or float. This makes determinants unusually dependent on *built-in* verification: oracles, property tests, and sanity bounds you run automatically rather than eyeball. Build checks in from day one.

| Check | Why |
|-------|-----|
| Cofactor-expansion oracle on small `n` | Catches sign and indexing bugs in elimination. |
| `det(A)·det(B) == det(AB)` | Property test for the whole pipeline. |
| `det(Aᵀ) == det(A)` | Confirms row/column symmetry of the implementation. |
| `det(I) == 1`, `det(diag) == ∏diag` | Base cases. |
| Two methods agree (Bareiss vs mod-`p`+CRT) | Cross-validate exact paths. |
| Hadamard bound vs computed magnitude | A result exceeding the bound is definitely wrong. |
| Permutation sign parity | `det` of a single row-swap of `I` is `−1`. |
| Singular sanity | A matrix with a duplicated row must give exactly `0` (in exact arithmetic). |

The single most valuable test is the **cofactor oracle** for `n ≤ 8` in exact arithmetic, compared against the elimination result on random matrices. It catches the swap-sign bug and the off-by-one in the elimination bounds that together account for most real defects.

### 8.1 A property-test battery

```text
for random small integer matrix A, B (n ≤ 6):
    assert det_bareiss(A) == det_cofactor(A)          # the oracle
    assert det_bareiss(A) == crt_combine(det_mod_p(A, p) for p in primes)
    assert det_bareiss(matmul(A, B)) == det_bareiss(A) * det_bareiss(B)
    assert det_bareiss(transpose(A)) == det_bareiss(A)
    assert det_bareiss(swap_two_rows(A)) == -det_bareiss(A)
    assert abs(det_bareiss(A)) <= hadamard_bound(A)
```

The `det(AB) = det(A)det(B)` test is especially good at catching a `multiply`-side bug that happens to be self-consistent within a single determinant.

### 8.3 Worked Cross-Validation

To trust an exact-integer determinant pipeline, run two independent methods and a property on one input:

```
A = [[6, 1, 1], [4, -2, 5], [2, 8, 7]]
det_bareiss(A)                    = -306
crt2(det_mod_p(A, 1_000_000_007),
     det_mod_p(A, 998_244_353))   = -306    (balanced representative)
det_cofactor(A)                   = -306    (the O(n!) oracle, n=3 ok)
hadamard_bound(A)                 = ~ 1100   (>= |−306|, sanity ok)
det(swap_rows(A, 0, 1))           = +306    (sign flip property)
```

All four exact methods agree on `−306`, the Hadamard bound comfortably exceeds it, and the swap flips the sign — five independent signals that the implementation is correct on this input. In CI, this battery runs on a few hundred random small matrices; a divergence between Bareiss and CRT instantly localizes the bug to one path.

### 8.4 Logging and Anomaly Detection

In a long-running service, attach to each result: the **Hadamard bound** (a result exceeding it is impossible — flag it), the **number of CRT primes used** (so you can audit whether the bound was sized correctly), and a **method tag** (float/mod-p/Bareiss/CRT). For mod-`p` results that come back `0`, log a `BAD_PRIME_POSSIBLE` marker rather than reporting "singular" outright, and trigger a second-prime confirmation. These three cheap annotations turn an opaque number into an auditable, self-checking artifact.

### 8.2 Production guardrails

For a service computing determinants (e.g., spanning-tree counts) at scale: log the **Hadamard bound** alongside each result so an anomalous magnitude stands out; validate that the input is **square** with entries in range; for mod-`p` results, note that a `0` is *inconclusive* for integer singularity and trigger a second-prime or Bareiss check before reporting "singular".

---

## 9. Failure Modes

Every failure below is a real, shipped bug pattern. They cluster into three families: **arithmetic-type mismatch** (using floats where exactness is needed, or native ints where the value overflows), **modular hazards** (the bad prime), and **structural waste** (dense passes, wrong minors). The mitigations are cheap; the symptoms are expensive and often silent.

### 9.1 Float singularity false verdict

A singular matrix yields a tiny nonzero float determinant (or vice versa). Mitigation: use exact arithmetic (mod `p`/Bareiss) when the singular/nonsingular branch matters; never threshold a float determinant to decide invertibility.

### 9.2 Determinant overflow/underflow in float

The product of `n` pivots overflows/underflows `double`. Mitigation: accumulate `log|det|` and track sign separately (`slogdet`).

### 9.3 Integer overflow in Bareiss transient

The transient product-of-two-minors exceeds `int64` even when the final fits. Mitigation: `__int128` / `BigInteger` for the transient, or CRT-over-primes. Always size against the Hadamard bound first.

### 9.4 Bad prime in mod-`p`

`p` divides the true determinant, so mod-`p` returns `0`, falsely suggesting singularity. Mitigation: for an integer-singularity verdict, confirm with a second prime or Bareiss; for an *exact value*, ensure your CRT prime product exceeds `2·Hadamard` so the reconstruction is unaffected.

### 9.5 Forgotten swap sign

A misplaced or missing sign flip gives `−det`. Mitigation: track the sign in exactly one place; property-test `det(swap(A)) == −det(A)`.

### 9.6 Mutating the caller's matrix

Elimination is destructive; eliminating in place corrupts the input. Mitigation: copy once at the top.

### 9.7 Using `|det|` as a conditioning measure

Branching on "is `|det|` small ⇒ near-singular" is wrong (`0.1·I` has tiny determinant but is perfectly conditioned). Mitigation: use the condition number or smallest singular value for conditioning; reserve the determinant for the exact-zero question.

### 9.8 Dense pass on a sparse Laplacian

Running dense `O(n^3)` on a large sparse matrix-tree Laplacian wastes time and memory. Mitigation: sparse LU with fill-reducing ordering, or exploit block-triangular structure (`det = ∏ det(blocks)`).

### 9.9 Wrong matrix-tree minor or unnormalized Laplacian

A subtle correctness bug in spanning-tree counting: using the *full* Laplacian determinant (always `0`, since rows sum to zero) instead of a *cofactor* (delete a row and column), or building `L = A − D` instead of `L = D − A`. Symptom: the count is always `0`, or off by a sign on the off-diagonals. Mitigation: assert `det(L) == 0` as a structural check (the full Laplacian *must* be singular), then take the `(n−1)×(n−1)` minor; verify against Cayley's `n^{n-2}` on a complete graph.

### 9.10 Worked Failure: the silent bad-prime

A reliability service counts spanning trees of a network and uses a single prime `p = 998244353`. For one particular graph the true count happens to be `998244353` itself (a multiple of `p`), so the mod-`p` determinant returns `0`. The service reports "the network has 0 spanning trees" — i.e. "disconnected" — and pages an on-call engineer. The graph was perfectly connected; the count was just a multiple of the prime. Mitigation: never report a structural verdict ("disconnected", "singular") from a single `0 mod p`; confirm with a second, unrelated prime, or compute the exact value via CRT/Bareiss. This is the bad-prime hazard (Section 5.1) manifesting as a production incident.

---

## 10. Summary

- **Elimination is the engine** (`O(n^3)`: product of pivots, sign per swap); the senior choices are *which arithmetic* and *how to verify*.
- **Float** is fast but inexact: mandatory partial pivoting, `slogdet` to dodge overflow, and never use `|det|` to judge conditioning or (unreliably) singularity.
- **Exact integer** needs **Bareiss** (fraction-free, integer intermediates bounded by Hadamard) — but watch the *transient* overflow; use big integers or CRT.
- **Mod-`p`** is exact and bounded; **CRT over several primes** (product > `2·Hadamard`) recovers the exact value, with the balanced representative giving the sign. A single `0 mod p` is inconclusive for integer singularity (bad-prime hazard).
- **Hadamard's bound** sizes everything: which integer type, how many CRT primes, whether a result is plausible.
- **Sparse/structured** matrices (Laplacians, block-triangular, SPD) should exploit structure — sparse LU, `det = ∏ det(blocks)`, Cholesky — instead of a dense pass.
- **Test relentlessly**: cofactor oracle, `det(AB)=det(A)det(B)`, `det(Aᵀ)=det(A)`, Bareiss-vs-CRT cross-check, Hadamard sanity.

### Decision summary

- **Real, approximate** → float elimination + partial pivoting (`slogdet` for large `n`).
- **Reliable singularity/conditioning verdict** → SVD / condition number / exact arithmetic, not `|det|`.
- **Exact mod `p`** → `Z/pZ` elimination (modular-inverse pivots).
- **Exact integer, moderate** → Bareiss with native ints (check Hadamard transient).
- **Exact integer, large** → Bareiss big-int, or CRT over primes (`∏p > 2·Hadamard`).
- **Spanning-tree count** → matrix-tree Laplacian minor, exact (mod `p` + CRT), sparse if large.
- **Sparse / block / SPD** → structure-aware factorization, not dense elimination.

### Quick Reference: which arithmetic, in one glance

| Symptom in requirements | Use |
|-------------------------|-----|
| "approximate area/volume/Jacobian" | float + partial pivoting (`slogdet` if large `n`) |
| "exact answer mod a prime" | `Z/pZ` elimination |
| "exact integer, fits in int64" | Bareiss (native) — check the transient |
| "exact integer, huge" | Bareiss big-int, or mod-`p`+CRT |
| "is it invertible?" (exact) | exact `det == 0` (two primes or Bareiss) |
| "how near-singular?" | condition number / SVD, NOT `det` |
| "count spanning trees" | matrix-tree minor, exact, sparse if large |
| "solve `Ax=b`" | direct LU solve, don't compute `det` |

References to study further: Bareiss (1968, *Sylvester's identity and multistep integer-preserving Gaussian elimination*), Hadamard's inequality, the Chinese Remainder Theorem and Garner's algorithm (siblings `05-crt`, `15-garner-algorithm`), LAPACK `getrf`/`slogdet`, Kirchhoff's matrix-tree theorem, and sibling topics `17-gaussian-elimination` and `19-matrix-rank`.
