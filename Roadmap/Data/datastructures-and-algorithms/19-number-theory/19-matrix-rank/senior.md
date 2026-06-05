# Matrix Rank — Senior Level

> Computing a rank is a one-line idea — count the pivots. Making it *correct and fast in production* is where the real work lives: choosing a tolerance that survives ill-conditioning over the reals, picking primes so the mod-`p` rank equals the true rank, squeezing GF(2) rank to billions of word-ops with bitsets, handling sparse and streaming inputs, and verifying the result when you cannot enumerate it. Every one of those is a correctness or performance incident waiting to happen.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Floating-Point Rank: Tolerance and Conditioning](#2-floating-point-rank-tolerance-and-conditioning)
3. [Exact Rank over Z/pZ: Prime Selection and Lifting](#3-exact-rank-over-zpz-prime-selection-and-lifting)
4. [GF(2) at Scale: Bitsets, Blocking, Streaming](#4-gf2-at-scale-bitsets-blocking-streaming)
5. [Sparse and Structured Matrices](#5-sparse-and-structured-matrices)
6. [Rank-Driven Decisions in Systems](#6-rank-driven-decisions-in-systems)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how do I count pivots" but "what field am I actually over, what breaks at scale, and how do I know my rank is right?" Rank computation shows up in three production guises that share one elimination engine:

1. **Numerical rank over the reals** — "how many effectively-independent features / sensors / constraints are there?" The answer depends on a tolerance, and ill-conditioning makes it genuinely ambiguous; the robust tool is the SVD.
2. **Exact rank over a finite field** — "is this system solvable, how many solutions, how big is the XOR basis?" Computed mod `p` or over GF(2), exact, but prime choice and overflow matter.
3. **Rank of huge sparse / structured systems** — coding theory, cryptanalysis, combinatorial designs — where dense `O(n³)` is infeasible and you exploit bitsets, sparsity, or streaming.

All three reduce to: *row-reduce in the right arithmetic, count surviving pivots*. The senior decisions are: how to define "zero" robustly, how to keep the arithmetic exact and overflow-free, how to make the `O(n³)` elimination fast (or avoid it via sparsity), and how to verify a number you cannot eyeball.

What unites them — and separates senior from junior treatment — is that the *value* of the rank is rarely the whole answer. Production code wants the **null space** (degrees of freedom), the **consistency verdict** (solvable or not, and why), the **confidence** (is the numerical rank well-defined?), and often the result **incrementally** as data streams in. The rank is the hub; these are the spokes, and the elimination produces all of them in one pass if you capture them.

This document treats those decisions in production terms.

The thread tying all three together: a transition matrix of independent constraints, reduced and pivot-counted, with the field and zero-definition chosen to match the problem's exactness needs.

### 1.1 The one decision that governs everything

Across all three guises, a single question dominates correctness: **what counts as zero?** Over `GF(2)` and `ℤ/pℤ` it is exact and the answer is never in doubt. Over `ℝ` it is a tolerance, and the tolerance is where ill-conditioning, units, and noise all conspire to make the rank ambiguous. Every senior failure mode in Section 9 traces back to either this zero-definition or to its companion, **how you divide** (modular inverse vs real division vs nothing in GF(2)). Master those two and the elimination skeleton — identical everywhere — does the rest. The rest of this document is, in effect, an extended treatment of "what is zero, in production."

### 1.2 A decision flow for picking the method

```
Is the problem exact (XOR / parity / integer)?
  ├─ XOR / parity / binary code  → GF(2): bitset, M4RI, or online XOR basis
  ├─ exact integer, single modulus ok → Z/pZ: large random prime (+ second to verify)
  └─ exact rational, no luck allowed   → Bareiss or Smith normal form
Is the problem numeric (measurements / features)?
  ├─ robustness matters       → SVD numerical rank (or RRQR)
  └─ speed matters, well-conditioned → partial-pivot elimination, relative eps
Is it streaming / unbounded?   → online linear/XOR basis
Is it secretly a tensor / non-negative-rank problem? → STOP: NP-hard
```

This flow is the senior summary in operational form; the sections below justify each branch.

---

## 2. Floating-Point Rank: Tolerance and Conditioning

### 2.1 Why a single `eps` is fragile

The naive rule "entry is zero if `|x| < 1e-9`" fails for two reasons. First, the threshold must scale with the **magnitude** of the data: a matrix of entries around `1e6` accumulates rounding around `1e-3·||A||`, so an absolute `1e-9` is meaningless. Use a **relative** tolerance, typically `eps_rel = max(m, n) · machine_eps · ||A||`, where `||A||` is a matrix norm (e.g. the largest absolute entry, or the largest pivot seen). Second, the pivot you divide by must be *large*; dividing by a tiny pivot amplifies every earlier rounding error.

### 2.2 Partial (and full) pivoting

**Partial pivoting** — at each step swap in the row with the largest absolute entry in the current column — is mandatory for floating-point rank. It keeps pivots as large as possible, bounding error growth. **Full pivoting** (search both rows and columns for the largest entry, a.k.a. rank-revealing pivoting) is more robust still and is what rank-revealing QR / LU use, at extra cost. For rank specifically, the magnitude of the *smallest accepted pivot* relative to the largest is the practical "is this still independent?" signal.

### 2.2b The pivot-growth bound

Partial pivoting bounds the multipliers (`|factor| ≤ 1`) but does *not* bound the *growth* of entries during elimination — in the worst case (Wilkinson's example) entries can grow by `2^{n-1}`, swamping the relative tolerance and corrupting the rank. In practice this is rare, but it is the theoretical reason partial pivoting is not a complete guarantee. Full pivoting bounds growth polynomially; rank-revealing QR avoids growth entirely via orthogonality. For a rank computation on a matrix you do not control, monitoring the maximum entry magnitude during elimination (and switching to QR/SVD if it blows up) is the defensive senior move.

### 2.3 Conditioning and the SVD as ground truth

A matrix can be *mathematically* full rank yet *numerically* rank-deficient: its columns are nearly dependent (small but nonzero pivots). The principled definition of **numerical rank** is the number of **singular values** above a threshold:

```
numerical_rank(A, tol) = #{ i : σ_i > tol },   tol = max(m,n) · machine_eps · σ_max
```

The SVD is the gold standard because singular values are the true "sizes" of the independent directions, immune to the elimination order. Gaussian-elimination rank with partial pivoting usually agrees, but on adversarial / ill-conditioned matrices it can be off by one; when correctness over noisy data matters (signal processing, ML, control), compute the rank from the SVD, not from elimination. The trade-off: SVD costs more (`~ O(n³)` with a larger constant) but is the robust answer.

### 2.4 The gap statistic

A practical heuristic: sort the pivots (or singular values) by magnitude and look for the largest **gap**. If pivots are `[12.3, 4.1, 3.8, 1e-13, 4e-14]`, the cliff between `3.8` and `1e-13` reveals rank 3 unambiguously. A *gradual* decay (`[10, 3, 1, 0.3, 0.1, 0.03]`) means the rank is genuinely ill-defined and you must decide a tolerance by domain knowledge — there is no algorithmic escape from an ambiguous matrix.

### 2.5 Scaling, equilibration, and why preprocessing matters

Two columns measured in different units (say meters vs millimeters) make a matrix artificially ill-conditioned: one column's entries are `1000×` the other's, so a fixed tolerance treats them asymmetrically. **Equilibration** — rescaling rows and columns so each has comparable norm (e.g. unit max-abs) before elimination — restores a meaningful tolerance and often recovers the correct rank that raw elimination would miss. The senior instinct: a "wrong" numerical rank is frequently a *units* problem, not an algorithm problem. Always ask whether the columns are commensurable before trusting a tolerance.

A concrete tolerance default that works well in practice: `eps = max(m, n) · 2.22e-16 · σ_max` (or `||A||_max` if no SVD), which adapts to both the matrix size and its magnitude. Hard-coding `1e-9` is the single most common numerical-rank bug.

### 2.6 Rank-revealing QR as a middle ground

Between cheap-but-fragile elimination and expensive-but-robust SVD sits **rank-revealing QR (RRQR)** with column pivoting: it computes `A P = Q R` where the diagonal of `R` decreases in magnitude and a sharp drop reveals the rank. RRQR is cheaper than the full SVD (no iterative singular-value computation) and far more reliable than naive Gaussian elimination, because the orthogonal `Q` does not amplify error. For production numerical rank where SVD is too slow but elimination is too fragile, RRQR is the pragmatic choice — it is what LAPACK's `xGEQP3` provides, and the magnitude of the smallest "accepted" `R` diagonal is the natural rank-confidence signal.

---

## 3. Exact Rank over Z/pZ: Prime Selection and Lifting

### 3.0 Why exact rank is the common case in competitive and crypto settings

Outside numerical computing, most rank questions are *exact*: counting solutions to an integer or XOR system, sizing a code, testing exact independence. For these, floating point is simply wrong — `1/3` is not representable, rounding accumulates, and the answer must be an exact integer. The finite-field route (`GF(2)` or `ℤ/pℤ`) is not a performance choice but a *correctness* one. The senior reflex: if the problem says "how many solutions" or "is this exactly dependent," reach for a finite field, never the reals. The reals are for *measurements*; finite fields are for *combinatorics and algebra*.

### 3.1 The rank can drop mod a bad prime

The rank over the **rationals** equals the largest order of a nonzero minor. Mod `p`, a minor that was nonzero over Q can become `0` if `p` divides it, so `rank_p(A) ≤ rank_Q(A)`, with equality for all but finitely many "unlucky" primes (those dividing the relevant minors). Consequence: a single fixed small prime can *under-report* the true rank.

### 3.2 Mitigations

- **Large random prime.** Pick a random prime near `2^31` or `2^61`. The probability it divides a fixed nonzero minor is `≤ (log of the minor)/p`, astronomically small. One large random prime almost always gives the true rational rank.
- **Two independent primes.** Compute mod `p₁` and `p₂`; if they agree, accept (a wrong-low answer would require the *same* unlucky coincidence for both). This is a cheap Monte-Carlo verification.
- **`2^61 − 1` Mersenne** arithmetic gives fast reductions and a huge prime in one.

### 3.3 Overflow budget

With a 31-bit prime and `int64`, a product of two reduced residues is `< 2^62`, safe; accumulate with reduction each step (or defer with a `__int128` accumulator and a proven term bound). With a 62-bit prime you need 128-bit products (`__int128` in C/Go-asm, `BigInteger`/`Math.multiplyHigh` in Java, native big ints in Python). Pick the prime size to match your available multiply width.

**Inverse caching.** The naive mistake is recomputing `pivot^(p−2) mod p` (an `O(log p)` modular exponentiation) for *every cell* of the pivot row's elimination. Compute it **once per pivot row** and reuse it across the whole row's eliminations: the inverse cost drops from `O(n² log p)` to `O(n log p)` total, negligible against the `O(n³)` body. Alternatively, batch-invert all pivots at the end with **Montgomery's trick** (one inversion plus `O(n)` multiplications for `n` inverses) when the access pattern allows. This is the single most common constant-factor regression in mod-`p` rank code.

### 3.4 When you need the rank over Q exactly

For provably-exact rational rank without modular luck, run **fraction-free Gaussian elimination** (Bareiss): it keeps entries as exact integers (the intermediate determinants), avoiding fractions and avoiding modular ambiguity, at the cost of entries growing in bit-length. For most purposes a large random prime (Section 3.2) is faster and correct with overwhelming probability; Bareiss is the deterministic fallback when "overwhelming probability" is not acceptable.

### 3.5 The Smith normal form: the complete rank profile

The most complete exact answer is the **Smith normal form (SNF)**: integer row/column operations reduce `A` to `diag(d₁, d₂, …, d_r, 0, …, 0)` with `d₁ | d₂ | ⋯ | d_r` (the invariant factors). The rank over `ℚ` is `r`; the rank mod a prime `p` is the number of `dᵢ` not divisible by `p`. So the SNF tells you the rank over **every** field at once — `rank_ℚ`, `rank_{GF(p)}` for all `p` — in a single computation. It is the deterministic gold standard when you need rank across multiple moduli (e.g. CRT-based exact solving), at the cost of being slower than a single modular elimination. Libraries (PARI/GP, SageMath, Flint) compute SNF efficiently; reach for it when "which primes are unlucky?" is itself the question.

### 3.6 CRT for exact rational solving (beyond rank)

Once the rank is known, *solving* `A x = b` exactly over `ℚ` for large integer systems is done by **CRT lifting**: solve mod several primes, reconstruct each rational coordinate via rational reconstruction (extended Euclid on the residue and modulus). The rank computation is the gatekeeper — it determines the free variables and whether the system is consistent — before the per-coordinate CRT reconstruction runs. This is the standard exact-linear-algebra pipeline (used in computer-algebra systems): modular rank → modular solve per prime → CRT/rational-reconstruction lift, each stage embarrassingly parallel across primes.

---

## 4. GF(2) at Scale: Bitsets, Blocking, Streaming

### 4.1 The bitset multiply

Over GF(2), a row is a bit-vector; elimination XORs rows. Packing rows into `uint64` words processes 64 columns per XOR instruction — the famous word-parallel speedup turning `O(n²m)` into `O(n²m / w)` with `w = 64` (or 256/512 with SIMD AVX2/AVX-512). For large coding-theory and cryptanalysis matrices (thousands to millions of columns), this is the difference between feasible and not.

### 4.1b Memory layout for the bitset multiply

Store each row as a contiguous `uint64[]` of `⌈n/64⌉` words. The pivot column `c` lives in word `c/64`, bit `c%64`; testing it is a mask-and-shift, eliminating it is `row[w] ^= pivot[w]` across all words `w` (or only words `≥ c/64`, since lower words are already cleared). Keep rows **64-bit aligned** and iterate words contiguously so the CPU streams cache lines — the elimination is memory-bound, so layout dominates. A common pitfall is storing rows as `bool[]` or `int[]`: that wastes 8–64× memory and forfeits the word-parallel XOR entirely, silently turning an `O(n³/64)` algorithm back into `O(n³)`.

### 4.2 The Method of Four Russians (M4RI)

Beyond plain bitsets, the **Method of Four Russians for Inversion (M4RI)** precomputes all XOR combinations of `k` pivot rows into a table and applies them in blocks, achieving `O(n³ / log n)` over GF(2) — a genuine asymptotic improvement, not just a constant. Production GF(2) linear-algebra libraries (M4RI, FFLAS-FFPACK) implement this; for the largest systems (e.g. the linear-algebra step of the quadratic sieve / number field sieve in factoring), **block Wiedemann / block Lanczos** iterative methods compute rank/nullspace of *sparse* GF(2) systems without dense fill-in.

### 4.2b M4RI vs bitset: when each wins

The plain bitset (`k = 1` Four Russians) wins for moderate sizes where the `2^k` table-building overhead of M4RI does not pay off; M4RI's `O(n³/log n)` advantage materializes only for large `n` (thousands+) where the `log n` factor is meaningful and the table cost amortizes. Production libraries crossover automatically. The practical rule: hand-rolled bitset elimination for `n` up to a few thousand, a tuned library (M4RI/FFLAS-FFPACK) beyond — and never bit-at-a-time once `n` exceeds a few hundred.

### 4.3 Streaming / online rank (XOR basis)

The XOR-basis insertion processes one row at a time, keeping only the basis (`rank` vectors). This is an **online** algorithm: vectors arrive in a stream, you maintain the current rank in `O(rank)` per insert and `O(rank²)` space — no need to materialize the whole matrix. This is exactly the senior pattern for "how many independent constraints have I seen so far?" over an unbounded stream, and it is the same structure as the linear/XOR basis of sibling `18-bit-manipulation`.

### 4.4 Choosing the GF(2) representation

- **Dense, ≤ a few thousand columns:** bitset rows (`uint64[]`), M4RI if a library is available.
- **Sparse, large:** block Lanczos / Wiedemann (iterative, sparse-friendly).
- **Streaming / unknown size:** XOR basis (online, store only the basis).

### 4.5 The factoring connection (why GF(2) rank is industrial)

The linear-algebra step of integer factorization (quadratic sieve, number field sieve) builds a giant **sparse** GF(2) matrix whose rows are exponent-parity vectors of smooth numbers; finding a **dependency** (a nonzero null-space vector) yields a congruence `x² ≡ y² (mod N)` and hence a factor. These matrices have millions of rows but only ~20 nonzeros each, so dense elimination is hopeless — **block Lanczos / Wiedemann** compute the nullspace (and implicitly the rank) using only sparse mat-vec products. This is not a toy: it is the bottleneck that determines how large an RSA modulus can be factored, and it is *the* reason fast sparse GF(2) linear algebra is a heavily engineered field. The same nullspace-via-rank machinery you learned at junior level scales, with the right data structures, to record factorizations.

### 4.6 SIMD and GPU bitset elimination

Beyond `uint64` words, vector instructions widen the parallelism: AVX2 XORs 256 bits per instruction, AVX-512 does 512, and GPUs process thousands of bit-lanes concurrently. For a dense GF(2) rank on a large matrix, a GPU bitset kernel (each thread owning a slice of columns, XOR-ing the pivot row's slice) achieves throughput orders of magnitude above scalar code. The pivot-selection step (finding a row with a 1 in the current column) is the sequential bottleneck; it is amortized by processing many eliminations per pivot. The senior takeaway: GF(2) rank is **memory-bandwidth bound** at scale, so the representation (packed, aligned, vectorizable) matters more than the asymptotic exponent for realistic sizes.

---

## 5. Sparse and Structured Matrices

### 5.0 What "sparse" buys and costs

A matrix with `nnz` nonzeros (often `nnz ≪ mn`) is cheap to *store* (`O(nnz)`) but elimination can densify it. The two regimes diverge sharply: if fill-in stays bounded (good ordering, banded structure), sparse-direct rank is `O(nnz · bandwidth)`, far below `O(n³)`. If fill-in explodes (arrowhead, random sparsity), you must abandon direct elimination for **iterative** methods that touch the matrix only through `A·v` products. The senior decision hinges on a single question answered by a *symbolic* analysis pass (which entries *would* fill in, computed without arithmetic): bounded fill-in → sparse-direct; unbounded → iterative. Never run dense elimination on a sparse matrix without this analysis.

### 5.1 Why dense elimination is wrong for sparse inputs

Dense `O(n³)` elimination on a sparse matrix wastes work and, worse, suffers **fill-in**: zeros become nonzeros as elimination proceeds, blowing up memory. For sparse rank:

- **Reorder** rows/columns (minimum-degree, nested dissection) to limit fill-in.
- Over GF(2)/finite fields, use **structured Gaussian elimination** (remove singleton rows/columns first) then switch to iterative **Wiedemann/Lanczos** for the dense core.
- For the *numerical* sparse case, sparse QR / sparse LU from libraries (SuiteSparse) give a rank estimate.

### 5.2 Structured matrices

Special structure can collapse the cost: a **circulant** or **Toeplitz** matrix's rank relates to a gcd of polynomials (FFT-friendly); a **Vandermonde** matrix is full rank iff its nodes are distinct; a **block-diagonal** matrix's rank is the sum of block ranks. Recognizing structure before throwing `O(n³)` at it is a senior instinct — the rank may have a closed form.

### 5.2b Updating rank incrementally

Many systems add rows/columns over time rather than recomputing from scratch. A **rank-1 update** `A → A + uvᵀ` changes the rank by at most ±1; appending a row raises the rank by 1 iff the row is independent of the existing row space (exactly the online-basis test). Maintaining a rank-revealing factorization (QR or the linear basis) lets each update cost `O(rank·n)` instead of a full `O(n³)` recomputation — essential for streaming constraint systems, online feature selection, and network coding (Section 6.3). The principle: rank is *monotone* under appending rows (never decreases) and bounded-change under rank-1 updates, so incremental maintenance is both possible and cheap.

### 5.3 Rank of a tensor / higher structure

Beware: **matrix rank is easy** (`O(n³)`), but **tensor rank** (the analogous notion for 3D arrays) is **NP-hard**. If a problem is "really" about a tensor or about *non-negative* rank (every factor non-negative — also NP-hard), the friendly `O(n³)` elimination does not apply. Knowing this boundary prevents reaching for elimination on a problem that secretly is not matrix rank.

### 5.4 Fill-in: a worked cautionary picture

Consider an "arrowhead" sparse matrix: dense first row and first column, identity elsewhere. It has only `~3n` nonzeros, yet naive elimination using the `(1,1)` pivot first fills in the *entire* trailing `(n-1)×(n-1)` block — `O(n²)` nonzeros from `O(n)`, a catastrophic blow-up. Reordering to eliminate the dense row/column **last** (a minimum-degree heuristic) keeps it sparse throughout. This single example is why sparse-direct methods invest heavily in ordering: the *order* of pivot selection, irrelevant to the rank value, is decisive for whether the computation fits in memory. For rank specifically, structured Gaussian elimination first removes all singleton rows/columns (forced pivots with no fill-in), shrinking to a dense core that iterative methods then finish.

### 5.5 When structure gives the rank for free

- **Vandermonde** (rows `[1, xᵢ, xᵢ², …]`): full rank iff the nodes `xᵢ` are distinct — an `O(n)` distinctness check, no elimination.
- **Circulant** (each row a cyclic shift): rank `= n − (\#common roots of the generating polynomial and `xⁿ − 1`)`, computable via gcd/FFT.
- **Block-diagonal:** rank is the sum of block ranks — parallelize across blocks.
- **Rank-1 update** `A + uvᵀ`: rank changes by at most 1 from `rank(A)` — useful for incremental updates without full recomputation.
- **Kronecker product** `A ⊗ B`: `rank(A ⊗ B) = rank(A)·rank(B)` — exploit factorization rather than forming the huge product.

Recognizing structure before invoking `O(n³)` elimination is a senior reflex: the rank may have a closed form or a far cheaper specialized computation.

---

## 6. Rank-Driven Decisions in Systems

### 6.0 The three outcomes, with actionable error surfaces

The senior difference between a textbook rank check and a production one is *what you return on each outcome*, not just the boolean. Infeasible should surface the contradicting constraint; underdetermined should surface the degrees of freedom (the null-space basis), not just the count. A bare "no solution" or "infinitely many" is far less useful to the caller than "constraints 3 and 7 contradict" or "parameters x₂ and x₅ are free; here are the two independent solution directions." Rank-nullity gives you these objects essentially for free during the same elimination — capture them.

### 6.1 Solvability and uniqueness at the API boundary

A service that "solves linear constraints" should return one of three outcomes, each a rank comparison (Rouché-Capelli):

- `rank(A) < rank([A|b])` → **infeasible**; surface *which* constraint is contradictory (the new pivot's source row).
- `rank(A) == rank([A|b]) == n` → **unique**; return the solution.
- `rank(A) == rank([A|b]) < n` → **underdetermined**; return a particular solution plus a basis of the `n − rank`-dimensional null space (the degrees of freedom). Over GF(2), report `2^(n − rank)` solution count.

### 6.2 Error-correcting codes

A linear `[n, k]` code is defined by a generator matrix of **rank `k`** (the message dimension) and a parity-check matrix `H` of rank `n − k`. The code's **minimum distance** relates to the smallest number of *linearly dependent* columns of `H`. Rank computations over GF(2) (or GF(q)) decide: is this a valid code (generator full row rank?), how many codewords (`2^k`), and syndrome decoding solves `H x = s` whose solution structure is again rank/nullity. This is a core production use of finite-field rank.

### 6.3 Random linear network coding

In **network coding**, intermediate nodes forward *random linear combinations* of received packets over `GF(q)`; a receiver can decode iff the coefficient matrix of the combinations it has collected reaches **full rank `k`** (the number of original packets). The receiver tracks the rank online (XOR/linear basis) and signals "done" the instant the rank hits `k` — every packet that fails to raise the rank was an "innovative-less" duplicate combination. This is real-time rank monitoring over a finite field at line rate, and the probability that `k` random combinations over `GF(q)` are full rank is `∏_{i=0}^{k-1}(1 − q^{i-k})`, close to 1 for `q = 256`. Rank, computed incrementally, is literally the decode-readiness signal.

### 6.3 Independence testing and feature/constraint deduplication

"Are these constraints / features / equations redundant?" is a rank query: redundancy count `= (#rows) − rank`. In optimization (LP/QP), redundant constraints waste solver time and can cause degeneracy; computing the constraint-matrix rank and dropping dependent rows is a standard preprocessing step. The streaming XOR/linear basis (Section 4.3) does this online.

### 6.4 Dimension of a span / model identifiability

In statistics and control, **identifiability** asks whether parameters are uniquely determined — a rank condition on a design / observability matrix. Rank `< full` means non-identifiable parameters (a null-space direction along which the model is unchanged). Reporting the null space (the `n − rank` directions) tells the user *which* parameter combinations are unidentifiable — far more actionable than just "rank-deficient."

### 6.5 Controllability and observability (control systems)

For a linear system `ẋ = Ax + Bu`, the **controllability matrix** `[B, AB, A²B, …, Aⁿ⁻¹B]` has full rank `n` iff the system is fully controllable; the **observability matrix** `[C; CA; CA²; …; CAⁿ⁻¹]` has full rank `n` iff the state is fully observable. These are pure rank conditions, and the *deficiency* `n − rank` is the dimension of the uncontrollable / unobservable subspace — exactly the part of the state you cannot steer or measure. Engineers compute these ranks (numerically, with a tolerance, since `A` is real) to decide sensor/actuator placement. A rank-deficient observability matrix means adding sensors elsewhere will not help along the unobservable directions — the null space pinpoints where the blind spot is.

### 6.6 Detecting collinearity in regression

In a linear regression `y = Xβ`, **multicollinearity** (near-dependent feature columns) makes `XᵀX` nearly singular, inflating coefficient variance. The numerical rank of `X` (or the condition number / smallest singular value) diagnoses it: `rank(X) < (\#features)` means perfect collinearity (some features are exact linear combinations of others) and the design is unidentifiable; near-rank-deficiency means unstable estimates. The standard fix — dropping or combining collinear features, or ridge regularization — is guided by *which* columns the rank computation flags as dependent. This is the most common everyday encounter with rank deficiency in data science, and it is the senior reason "compute the rank of the design matrix" is a routine preprocessing diagnostic.

---

## 7. Code Examples

The three examples below each embody one senior concern: relative tolerance (Go), prime verification (Java), and online/streaming rank (Python).

### 7.1 Go — relative-tolerance real rank with partial pivoting

```go
package main

import (
	"fmt"
	"math"
)

func rankReal(mat [][]float64) int {
	m := len(mat)
	if m == 0 {
		return 0
	}
	n := len(mat[0])
	// relative tolerance scaled by the largest absolute entry
	var norm float64
	for i := range mat {
		for j := range mat[i] {
			norm = math.Max(norm, math.Abs(mat[i][j]))
		}
	}
	eps := float64(maxInt(m, n)) * 2.220446049250313e-16 * norm
	if eps == 0 {
		return 0 // all-zero matrix
	}
	rowPivot := 0
	for col := 0; col < n && rowPivot < m; col++ {
		sel := rowPivot
		for r := rowPivot + 1; r < m; r++ {
			if math.Abs(mat[r][col]) > math.Abs(mat[sel][col]) {
				sel = r
			}
		}
		if math.Abs(mat[sel][col]) <= eps {
			continue
		}
		mat[rowPivot], mat[sel] = mat[sel], mat[rowPivot]
		for r := rowPivot + 1; r < m; r++ {
			f := mat[r][col] / mat[rowPivot][col]
			for c := col; c < n; c++ {
				mat[r][c] -= f * mat[rowPivot][c]
			}
		}
		rowPivot++
	}
	return rowPivot
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	A := [][]float64{{1, 2, 3}, {2, 4, 6.0000000001}, {1, 1, 1}}
	fmt.Println("numerical rank:", rankReal(A))
}
```

### 7.2 Java — exact rank over two primes (Monte-Carlo verification)

```java
public class RankTwoPrimes {
    static long power(long a, long e, long mod) {
        long r = 1; a %= mod;
        while (e > 0) { if ((e & 1) == 1) r = r * a % mod; a = a * a % mod; e >>= 1; }
        return r;
    }

    static int rankModP(long[][] in, long p) {
        int m = in.length, n = in[0].length, rp = 0;
        long[][] a = new long[m][];
        for (int i = 0; i < m; i++) { a[i] = in[i].clone(); for (int j = 0; j < n; j++) a[i][j] %= p; }
        for (int col = 0; col < n && rp < m; col++) {
            int sel = -1;
            for (int r = rp; r < m; r++) if (a[r][col] != 0) { sel = r; break; }
            if (sel < 0) continue;
            long[] t = a[rp]; a[rp] = a[sel]; a[sel] = t;
            long inv = power(a[rp][col], p - 2, p);
            for (int r = 0; r < m; r++) {
                if (r == rp || a[r][col] == 0) continue;
                long f = a[r][col] * inv % p;
                for (int c = col; c < n; c++)
                    a[r][c] = ((a[r][c] - f * a[rp][c]) % p + p) % p;
            }
            rp++;
        }
        return rp;
    }

    public static void main(String[] args) {
        long[][] A = {{1, 2, 3}, {2, 4, 6}, {0, 1, 1}};
        int r1 = rankModP(A, 1_000_000_007L), r2 = rankModP(A, 998_244_353L);
        System.out.println(r1 == r2 ? ("rank = " + r1) : "ambiguous: re-run with another prime");
    }
}
```

### 7.2b Notes on the code above

The Go example computes a **relative** tolerance from the matrix's max-abs entry, so multiplying the whole matrix by `10⁶` does not change the reported rank — the fix for the units/scaling fragility of Section 2.5. The Java example runs **two primes** and only accepts when they agree, the Monte-Carlo guard against unlucky primes (Section 3.2). The Python example is **online**: it maintains the rank as vectors stream in, returning whether each insertion was innovative — the structure used for network coding and constraint deduplication. Three files, three fields, three production concerns, one shared "reduce and count" core.

### 7.3 Python — streaming GF(2) rank (online XOR basis)

```python
class XorBasis:
    """Maintains the GF(2) rank of a stream of vectors (as integers)."""

    def __init__(self):
        self.basis = []  # one vector per occupied leading-bit position

    def insert(self, x: int) -> bool:
        cur = x
        for b in self.basis:
            cur = min(cur, cur ^ b)
        if cur:
            self.basis.append(cur)
            self.basis.sort(reverse=True)
            return True   # increased the rank
        return False      # dependent; rank unchanged

    @property
    def rank(self) -> int:
        return len(self.basis)


if __name__ == "__main__":
    xb = XorBasis()
    stream = [0b110, 0b011, 0b101, 0b001]
    for v in stream:
        added = xb.insert(v)
        print(f"insert {v:04b}: rank now {xb.rank} ({'new' if added else 'dependent'})")
    # 0b101 = 0b110 ^ 0b011 -> dependent; final rank 3 (110, 011, 001 independent)
```

---

## 8. Observability and Testing

A rank is opaque — one wrong integer looks like any other. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force on small matrices | Enumerate dependence / count GF(2) solutions for `n ≤ 6`; compare. |
| Two-prime agreement (Z/pZ) | A wrong-low rank needs both primes unlucky — practically impossible. |
| SVD cross-check (reals) | Numerical rank from singular values vs elimination rank. |
| `rank ≤ min(m, n)` invariant | A rank exceeding either dimension is a bug. |
| Rank-nullity: `rank + nullity == n` | Compute the null space and confirm its dimension is `n − rank`. |
| Transpose invariance: `rank(A) == rank(Aᵀ)` | Row rank = column rank; a strong property test. |
| GF(2) solution count `2^(n−rank)` | Enumerate all `2^n` assignments for small `n`, count solutions, compare. |
| Determinism across languages | Same input → identical Go/Java/Python rank. |

The single most valuable test is **transpose invariance** combined with the **brute-force oracle**: `rank(A) == rank(Aᵀ)` catches asymmetric bugs in pivot handling, and the oracle catches off-by-one and field-arithmetic mistakes. Transpose invariance is uniquely powerful because row-reduction code naturally treats rows and columns asymmetrically (it pivots on rows), so a bug in pivot-row advancement or column skipping will usually break `rank(A) == rank(Aᵀ)` while leaving the simpler `rank ≤ min` invariant intact — it probes exactly the part of the code most likely to be wrong.

### 8.1 A property-test battery

```text
for random small matrix A (entries in a chosen field):
    assert rank(A) <= min(rows, cols)
    assert rank(A) == rank(transpose(A))         # row rank == column rank
    assert rank(A) + nullspace_dim(A) == cols    # rank-nullity
    assert rank(A) == bruteforce_rank(A)         # oracle
for GF(2) systems:
    consistent ⇒ (#solutions by enumeration) == 2 ** (cols - rank(A))
```

### 8.2 Production guardrails

For a service computing ranks: log the **smallest accepted pivot magnitude** alongside each real-valued rank so an ambiguous (ill-conditioned) result stands out; validate input dimensions (rectangular, all rows equal length); for finite-field ranks, assert entries are reduced into `[0, p)` before elimination; and for GF(2), assert the bitset width covers the column count.

### 8.3 A worked verification scenario

Suppose a service returns `rank = 7` for a `10 × 12` integer matrix. The cheap checks fire in order: (1) `7 ≤ min(10, 12) = 10` ✓; (2) recompute over a second prime — also `7` ✓ (a wrong-low would need both primes unlucky); (3) `rank(Aᵀ)` — also `7`, confirming row rank = column rank ✓; (4) build a null-space basis of size `12 − 7 = 5` and verify `A wᵢ = 0` for each ✓. All four pass independently, giving high confidence in a number no human can eyeball. If check (2) had disagreed (say one prime gave `6`), the guardrail would flag `AMBIGUOUS` and escalate to a third prime or Smith normal form — never silently return a possibly-unlucky `6`. This layered, cheap-to-expensive verification is the senior discipline that turns an opaque integer into a trustworthy result.

### 8.4 Cross-language and cross-field determinism

Because the rank value is canonical (Section 3.2 of `professional.md`: the pivot-column set is invariant), the same input must yield the same rank in Go, Java, and Python — a strong regression test. Over `ℝ`, determinism additionally requires the *same tolerance and pivot strategy* in all three implementations (floating-point results are otherwise platform-sensitive); pinning `eps` and using identical partial-pivoting makes the real-valued rank reproducible too. A divergence across languages on the same seeded input is almost always a tolerance or pivot-order mismatch, not a deep bug — check those first.

---

## 9. Failure Modes

### 9.1 Tolerance too small/large (reals)

A fixed absolute `eps` over- or under-counts depending on data magnitude. Mitigation: relative tolerance scaled by `||A||`; partial pivoting; SVD for adversarial cases. A worked symptom: a matrix of GPS coordinates (entries `~10⁷`) computed with `eps = 1e-9` reports *full* rank even for genuinely collinear data, because the rounding residue (`~10⁻³·||A|| ≈ 10⁴`) dwarfs the absolute `eps` — every residue looks "nonzero." The relative tolerance `max(m,n)·machine_eps·||A||` rescales the threshold to the data and fixes it.

### 9.2 Unlucky prime (Z/pZ)

A small fixed prime dividing a minor reports rank too low. Mitigation: large random prime, or two primes with agreement check, or Bareiss for deterministic exactness. The trap is that the wrong-low rank is *internally consistent* — every invariant (`rank ≤ min`, transpose-equality, rank-nullity over `GF(p)`) holds, because the matrix really does have that rank *over `GF(p)`*; it is only wrong relative to the intended field `ℚ`. Only a second prime (or SNF) exposes the discrepancy, which is why two-prime agreement is the non-negotiable guard for exact integer rank.

### 9.3 Overflow in modular elimination

`a*b` overflowing before reduction, or a 62-bit prime without 128-bit products. Mitigation: match prime size to multiply width; reduce in the inner loop or use a 128-bit accumulator with a proven bound. In Go and Java this is especially insidious because `int64` overflow wraps *silently* (no exception), producing a plausible wrong rank; the fix is to cast operands to a wider type (or use a prime small enough that the product fits) before the multiply, and to unit-test with a near-`p` prime that maximizes product magnitude.

### 9.4 Fill-in on sparse matrices

Dense elimination on a sparse input explodes memory. Mitigation: reordering to limit fill-in; structured Gaussian elimination then iterative Wiedemann/Lanczos. Run a symbolic fill-in analysis first to choose between sparse-direct and iterative (Section 5.0).

### 9.5 Counting against rows instead of columns

`2^(n − rank)` and nullity use `n` = number of **columns/unknowns**; using row count is a classic off-by-dimension bug. Mitigation: name the dimension explicitly; verify with the rank-nullity invariant. A quick GF(2) guard: the solution count must be `0` or a power of 2 (`= 2^{n−rank}`); a non-power-of-2 count is an immediate red flag that the wrong dimension entered the exponent.

### 9.6 Mistaking ill-conditioning for a clean rank

Reporting an exact integer rank for a matrix whose pivots decay gradually hides genuine ambiguity. Mitigation: report the pivot/singular-value gap; let the caller set a domain tolerance.

### 9.7 Wrong field, wrong answer

Computing rank over the reals for a problem that is inherently GF(2) (an XOR puzzle) gives a different number — real-rank and GF(2)-rank of the same 0/1 matrix can differ. Mitigation: pin the field to the problem semantics (XOR ⇒ GF(2), exact integers ⇒ Z/pZ, measurements ⇒ reals).

### 9.8 Reaching for matrix rank on a tensor / non-negative-rank problem

Those are NP-hard and *not* solved by `O(n³)` elimination. Mitigation: recognize the boundary (Section 5.3) before applying the easy algorithm.

### 9.9 Forgetting the consistency check before counting solutions

Computing `2^(n − rank(A))` without first confirming `rank(A) == rank([A|b])` reports a positive solution count for an *inconsistent* system (which actually has zero solutions). Symptom: a "solution count" that never validates against an actual solve. Mitigation: always compute the augmented rank too; the count is `0` the moment the augmented rank exceeds `rank(A)`.

### 9.10 Mutating the caller's matrix

Elimination is in-place and destroys the input. A caller who computes the rank and then tries to *use* the original matrix gets a garbage (reduced) matrix instead. Symptom: downstream code that "worked yesterday" breaks after a rank call is added. Mitigation: copy the matrix before reducing (or document loudly that the input is consumed). This is a recurring integration bug precisely because the rank function looks read-only from its signature.

### 9.11 Pivot-magnitude starvation over the reals

Without partial pivoting, a tiny-but-nonzero pivot gets divided into, and the resulting huge multipliers amplify every prior rounding error — the rank can come out wrong *and* the reduced matrix is numerically meaningless. Symptom: rank that changes when rows are permuted. Mitigation: partial (or full) pivoting, mandatory for any floating-point rank; the permutation-invariance test (Section 8) catches violations.

---

## 10. Summary

- **Rank = count of surviving pivots**, but production correctness lives in *what counts as zero* and *what field you are over*.
- **Reals:** use a **relative tolerance** scaled by `||A||`, **partial pivoting**, and treat the **SVD numerical rank** (singular values above threshold) as ground truth for ill-conditioned data. Watch for gradual pivot decay — an honestly ambiguous rank.
- **Z/pZ:** exact, but a bad prime under-reports rank; use a **large random prime** (or **two primes** with an agreement check), and match prime size to your multiply width to avoid overflow. **Bareiss** (fraction-free) is the deterministic exact-over-Q fallback.
- **GF(2):** XOR/AND arithmetic; **bitsets** give a `w`-fold speedup, **M4RI** an `O(n³/log n)` asymptotic one, **block Lanczos/Wiedemann** handle huge sparse systems, and the **online XOR basis** computes rank over a stream — all the same notion as the linear basis of sibling `18`.
- **Sparse / structured:** dense `O(n³)` causes fill-in; reorder, use structured elimination, or recognize closed-form structure (Vandermonde, circulant, block-diagonal). Tensor rank and non-negative rank are **NP-hard** — not this algorithm.
- **Rank drives system decisions:** solvability and uniqueness (Rouché-Capelli), error-correcting code parameters (`[n,k]`, `2^k` codewords), constraint/feature deduplication, and identifiability — all rank/nullity queries.
- **Verify** with transpose invariance (`rank(A)=rank(Aᵀ)`), rank-nullity, two-prime agreement, SVD cross-check, and a brute-force oracle on small inputs.

### Operational checklist before shipping a rank computation

1. **Field pinned** to problem semantics (XOR ⇒ GF(2), exact integer ⇒ Z/pZ, measurements ⇒ reals)?
2. **Zero-definition** correct: exact for finite fields, *relative* tolerance + partial pivoting for reals?
3. **Division** correct: modular inverse mod `p` (cached per pivot row), real division (large pivot), or none (GF(2))?
4. **Overflow** bounded: prime size matched to multiply width?
5. **Input not mutated** unexpectedly (copy if the caller still needs it)?
6. **Verification** wired: `rank(A)=rank(Aᵀ)`, `rank ≤ min(m,n)`, `rank+nullity=n`, two-prime agreement, brute-force oracle on small inputs?
7. **Solution counting** guarded by a consistency check (`rank(A)=rank([A|b])`) and counting against **columns**?
8. **Scale** addressed: bitsets/M4RI for large GF(2), iterative methods for sparse, structure exploited where present?

If all eight hold, the rank is trustworthy.

### Decision summary

- **Noisy real data, robustness matters** → SVD numerical rank (or partial-pivot elimination with relative `eps` for speed).
- **Exact rank, competitive / cryptographic** → Z/pZ with a large random prime; two primes to verify.
- **XOR / coding / GF(2)** → bitset elimination or M4RI; sparse → block Lanczos/Wiedemann; streaming → online XOR basis.
- **Solvability / how-many-solutions** → Rouché-Capelli rank comparison; GF(2) count `2^(n − rank)`.
- **Sparse large** → reorder + structured elimination + iterative methods, never dense `O(n³)`.
- **Tensor / non-negative rank** → stop; NP-hard, wrong tool.
- **Incremental / streaming updates** → maintain a rank-revealing factorization or online basis; `O(rank·n)` per update, never full recomputation.
- **Across multiple moduli (exact rational)** → Smith normal form (the complete cross-prime rank profile), or random-prime with an agreement check.

### A final word on ambiguity

The deepest senior lesson is that rank is *exact* over finite fields and *sometimes genuinely undefined* over the reals. When a real matrix's singular values decay gradually with no gap, there is no correct integer rank — only a tolerance-dependent choice. The mature response is not to tune `eps` until you get a number you like, but to **report the ambiguity** (the gap, the smallest accepted singular value) and let the domain decide. Pretending an ill-conditioned matrix has a crisp rank is the most insidious failure mode because it produces a plausible, deterministic, *wrong* answer. Exactness lives in `GF(2)` and `ℤ/pℤ`; over `ℝ`, honesty about ambiguity is the senior skill.

References to study further: SVD and numerical rank (Golub & Van Loan, *Matrix Computations*); Bareiss fraction-free elimination; the Method of Four Russians and M4RI; block Wiedemann / Lanczos for sparse finite-field linear algebra (the factoring linear-algebra step); rank-revealing QR/LU; SuiteSparse for sparse rank; and sibling topics `17-gaussian-elimination`, `06-extended-euclidean-modular-inverse`, `02-modular-arithmetic`, and `18-bit-manipulation` (XOR basis).
