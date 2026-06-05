# Paths of Fixed Length (Matrix Exponentiation on Graphs) — Senior Level

> Matrix exponentiation is rarely the bottleneck on a small graph — but the moment `k` is astronomically large, the graph encodes a real state space, or the counts must be exact modulo a prime, every detail (overflow, modulus choice, semiring identity, cache behaviour, numerical stability of the Markov variant) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Large-k Analytics and Closed Forms](#2-large-k-analytics-and-closed-forms)
3. [Modular Arithmetic Pipelines](#3-modular-arithmetic-pipelines)
4. [State-Space Modeling: DP on Layered Graphs](#4-state-space-modeling-dp-on-layered-graphs)
5. [Markov Chains and Step Distributions](#5-markov-chains-and-step-distributions)
6. [Semiring Engineering at Scale](#6-semiring-engineering-at-scale)
7. [Performance Engineering of Matrix Multiply](#7-performance-engineering-of-matrix-multiply)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does `A^k` count walks" but "what system am I actually modeling, and what breaks when I scale it?". Matrix exponentiation on graphs shows up in three guises that look different but share one engine:

1. **Counting under a huge length constraint** — "how many `k`-step sequences are valid", where `k` can be `10^18`. The graph is a small automaton; the answer is exact mod a prime.
2. **Optimization with a fixed number of stages** — "cheapest schedule using exactly `k` transitions", solved in the min-plus semiring.
3. **Probabilistic evolution** — "distribution of a Markov chain after `k` steps", solved in the real `(+, ×)` semiring with stochastic matrices.

All three reduce to: *build a transition matrix of dimension equal to the state count, raise it to the `k`-th power in the right semiring, read an entry or contract against an initial vector.* The senior-level decisions are: how to keep the dimension small, how to keep the arithmetic exact and overflow-free, how to make the `V³` multiply fast, and how to verify the result when `k` is too large to brute-force.

This document treats those four decisions in production terms.

---

## 2. Large-k Analytics and Closed Forms

### 2.1 Why `log k` is the whole point

Binary exponentiation does `⌊log₂ k⌋ + popcount(k)` matrix multiplies. For `k = 10^18`, that is about 60 squarings plus up to 60 conditional multiplies — at most ~120 matrix multiplies. The cost is dominated by `V³`, *independent of `k`* beyond the logarithmic factor. This is the only known general technique that evaluates a length-`k` walk count without `k` being a feasibility constraint.

### 2.2 Eigenvalues: the analytic alternative

If `A` is diagonalizable, `A = S Λ S⁻¹` with `Λ = diag(λ₁, …, λ_V)`, then `A^k = S Λ^k S⁻¹`, and each entry of `A^k` is a linear combination of `λᵢ^k`:

```
(A^k)[i][j] = Σ_r c_{ijr} · λ_r^k
```

This is the **spectral** view. For walk counting it explains *growth rate*: the number of length-`k` walks grows like `λ_max^k`, where `λ_max` is the spectral radius (Perron-Frobenius eigenvalue for a strongly connected graph). The closed form is exact over the reals but **dangerous for exact integer counts**: eigenvalues are usually irrational, so you cannot use floating point and expect an exact mod-`p` count. Use eigenvalues for asymptotic analysis and growth-rate reasoning; use modular matrix exponentiation for exact counts.

### 2.3 Asymptotic growth and the dominant term

For a strongly connected aperiodic graph, `(A^k)[i][j] ≈ C · λ_max^k` for a constant `C` depending on `i, j`. This tells you:

- The number of length-`k` walks roughly multiplies by `λ_max` per step.
- If `λ_max > 1`, counts explode (hence the need for `mod p`).
- If `λ_max < 1` (only possible for sub-stochastic / weighted matrices), counts decay.

This growth-rate reasoning is invaluable for sanity checks: if your computed count is not growing roughly geometrically, you likely have a bug.

### 2.3b Pre-filtering with periodicity

Before powering, detect the graph's **period** `d` (the gcd of cycle lengths in each strongly connected component, computed by BFS layering in `O(V + E)`). For a periodic graph, `(A^k)[i][j]` is forced to `0` unless `k` matches the right residue class mod `d`. For a batch of huge-`k` queries this resolves many of them in `O(1)` modular comparisons without any `V³` work — and immediately answers questions like "is there an odd-length closed walk?" (no, for bipartite graphs, where `d = 2`). This is a cheap, high-value optimization that the textbook presentation usually omits.

### 2.4 Minimal polynomial / Kitamasa for single sequences

When you only need *one* entry of `A^k` (e.g., a single recurrence value `F_k`), the full `V³ log k` is overkill. The **Kitamasa method** and the Cayley-Hamilton-based polynomial reduction compute the `k`-th term of an order-`r` linear recurrence in `O(r² log k)` (or `O(r log r log k)` with FFT), beating the `O(r³ log k)` matrix power. This matters when `r` is large (hundreds) and only one term is wanted. The matrix view and the polynomial view are two faces of the same Cayley-Hamilton coin.

---

## 3. Modular Arithmetic Pipelines

### 3.1 Overflow budget

In the counting semiring with `int64` and modulus `p < 2^31` (e.g. `10^9 + 7`), the product `a[i][t] * b[t][j]` of two reduced residues is `< 2^62`, which fits in `int64`. The accumulation `c += product` can overflow if you defer the `% p`. Two safe strategies:

- **Reduce every step:** `c = (c + a*b) % p`. Always safe, a division per inner-loop iteration.
- **Defer with a 128-bit accumulator (or `__int128` / unsigned long math):** accumulate several products before reducing. Faster, but you must bound how many products fit before overflow (`floor((2^63 - 1) / (p-1)²)` terms for signed `int64`).

### 3.2 Choosing the modulus

| Modulus | Use |
|---------|-----|
| `10^9 + 7`, `998244353` | The problem dictates it; `998244353` is NTT-friendly if you later need polynomial tricks. |
| Multiple coprime primes + CRT | When the true answer might exceed a single 30-bit prime's information and you want to recover a larger value via the Chinese Remainder Theorem. |
| A power of two (`2^64` implicit) | When the problem wants the answer mod `2^64` — natural `uint64` wraparound, no explicit reduction. |

If the problem wants the **exact** (non-modular) count and it is huge, you must use big integers; the cost of each multiply then includes the big-integer multiplication cost, which is no longer `O(1)` per entry.

### 3.3 Negative residues

In Go and Java, `%` can return a negative result for negative operands. Walk counts are non-negative, so this only bites when subtracting (e.g., inclusion-exclusion over walk counts). Normalize with `((x % p) + p) % p`.

### 3.4 CRT pipeline for large exact answers

When you need an answer larger than a single prime can represent but still exact, run the same matrix power under several primes `p₁, p₂, …` and reconstruct via CRT. This is embarrassingly parallel: each prime is an independent matrix-exponentiation job.

```
answer mod p₁ ─┐
answer mod p₂ ─┼─ CRT ─→ answer mod (p₁ p₂ p₃ …)
answer mod p₃ ─┘
```

---

## 4. State-Space Modeling: DP on Layered Graphs

### 4.1 The core trick: states are vertices

The most powerful senior use of fixed-length matrix exponentiation is **DP with a huge number of identical layers**. If your DP has:

- a *fixed, small* set of states `S` (say `|S| ≤ 100`),
- a *layer-independent* transition (the same rule applies at every step),
- a *huge* number of layers `k`,

then the layer transition is a constant matrix `T` of size `|S| × |S|`, and the answer after `k` layers is `T^k` applied to the initial state vector. The `k` layers collapse from `O(|S|² k)` DP into `O(|S|³ log k)`.

### 4.2 Worked modeling example: tilings / forbidden patterns

"Count length-`k` strings over an alphabet that avoid a forbidden substring" is solved with an Aho-Corasick-style automaton: states are "longest matched prefix of the forbidden pattern", transitions are characters, and the matrix counts accepted walks. `T[s][s']` = number of characters that move state `s` to state `s'` without completing the forbidden pattern. Then `(T^k)[start][·]` summed over non-dead states is the count of valid length-`k` strings.

### 4.3 When layers differ: product of distinct matrices

If transitions vary by layer (e.g., a different rule on even vs odd steps), you lose the single-power shortcut but can still batch: if the pattern of matrices is periodic with period `m`, compute the product `P = T_{m-1} ⋯ T_1 T_0` once, then raise `P` to `k/m`. This recovers `O(|S|³ (m + log(k/m)))`.

### 4.4 Keeping the dimension small

The matrix is `|S| × |S|` and the cost is cubic in `|S|`, so **state minimization is the lever**. Merge equivalent states (DFA minimization), drop unreachable states, and exploit symmetry. Halving the state count is an 8× speedup.

### 4.5 A concrete modeling checklist

When you suspect a problem is "huge-`k` layered DP → matrix power", run this checklist:

1. **Identify the state.** What minimal information about the prefix determines the future? That set is `S`. If it depends on the *step index* in a non-periodic way, the matrix is not constant and the technique does not directly apply.
2. **Bound `|S|`.** If `|S|` is small (≤ a few hundred) and `k` is large, matrix power wins. If `|S|` is exponential (e.g. a visited-set), you are likely in the #P-hard simple-path regime — stop.
3. **Write the transition as a matrix.** `T[s][s']` = number (or weight, or 0/1) of single-step transitions from `s` to `s'`. This must not depend on the layer index.
4. **Choose the semiring.** Counting → `(+,×)`; cheapest → min-plus; feasibility → Boolean; probability → real `(+,×)`.
5. **Set the initial/terminal contraction.** Left-multiply by the initial state vector, read or sum the appropriate terminal entries.
6. **Verify against layered DP** for small `k`. This catches transition-matrix transcription errors, which are the dominant bug class in modeling.

The discipline of writing the transition as an explicit matrix often *reveals* whether the state is truly fixed-dimension — if you cannot write `T` without referencing the step index or an unbounded history, matrix exponentiation is the wrong tool.

---

## 5. Markov Chains and Step Distributions

### 5.1 `P^k` is the `k`-step transition matrix

For a Markov chain with row-stochastic transition matrix `P` (`Σ_j P[i][j] = 1`), `(P^k)[i][j]` is the probability of being in state `j` after exactly `k` steps starting from `i`. The initial distribution `π₀` (a row vector) evolves as `π_k = π₀ P^k`. Binary exponentiation gives the `k`-step distribution for huge `k` in `O(|S|³ log k)`.

### 5.2 Numerical stability vs exactness

Markov matrices are real-valued, so you are back in floating point. Two concerns:

- **Drift:** repeated multiplication of stochastic matrices accumulates rounding; row sums slowly drift from `1`. Renormalize rows periodically if `k` is large.
- **Catastrophic cancellation:** rare for non-negative stochastic matrices, but watch for it if you subtract.

If you need the *stationary* distribution rather than a finite-`k` step, do not power to a huge `k` — solve `π P = π` directly (eigenvector for eigenvalue 1) or iterate to convergence; that is cheaper and avoids drift.

### 5.3 Absorbing chains and expected steps

For absorbing Markov chains, the fundamental matrix `N = (I − Q)⁻¹` (where `Q` is the transient-to-transient block) gives expected visit counts and absorption times in closed form — no powering needed. Use matrix exponentiation only when you genuinely need the distribution at a *specific finite* `k`.

### 5.4 PageRank connection

PageRank is the stationary distribution of a Markov chain (the "random surfer"). The power-iteration that computes it is exactly `π₀ P^k` for increasing `k` until convergence — fixed-length walk counting in the probabilistic semiring, stopped at convergence rather than a prescribed `k`.

### 5.5 When to power vs when to solve

A frequent senior mistake is powering a stochastic matrix to an enormous `k` to approximate the stationary distribution. That is wasteful and drift-prone. Decision rule:

- **Finite, specific `k`** (e.g. "distribution after exactly 7 steps") → matrix power `P^k`, `O(|S|³ log k)`.
- **`k → ∞` / stationary** → solve the linear system `π(P − I) = 0` with `Σπ = 1` directly (`O(|S|³)` once), or run power iteration to a tolerance (which self-terminates at the mixing time, usually `≪ k`).
- **Expected hitting / absorption times** → use the fundamental matrix `N = (I − Q)^{-1}`, no powering at all.

Matrix exponentiation is the right hammer only when the *exact step count* is part of the question. The convergence-based and closed-form alternatives are cheaper whenever the count is "large" or "infinite" in spirit rather than a hard constraint — the same distinction that separates min-plus power from Floyd-Warshall on the optimization side.

---

## 6. Semiring Engineering at Scale

### 6.1 The abstraction boundary

A production matrix-power library should be parameterized by the semiring: a triple `(add, mul, zero, one)`. The power skeleton never changes; only the element type and the two operations do. This lets one tested `matPow` serve counting, shortest-path, longest-path, reachability, and probability.

| Semiring | add | mul | zero (`0̄`) | one (`1̄`) | application |
|----------|-----|-----|-----------|-----------|-------------|
| Counting mod p | `(+) mod p` | `(×) mod p` | 0 | 1 | exact walk counts |
| Min-plus | `min` | `+` | `+∞` | 0 | shortest exact-`k` walk (cf. `06-floyd-warshall`) |
| Max-plus | `max` | `+` | `−∞` | 0 | longest exact-`k` walk |
| Boolean | `OR` | `AND` | false | true | reachability in `k` steps |
| Probability | `+` | `×` | 0.0 | 1.0 | Markov `k`-step distribution |
| Top-2 / k-best | merge-keep-best-k | combine | empty | {0} | `k` shortest exact-length walks |

### 6.2 The identity matrix is per-semiring

The recurring senior bug: reusing the counting identity (zeros off-diagonal) for min-plus, where off-diagonal must be `+∞`. Encapsulate the identity inside the semiring definition so it can never be mismatched.

### 6.3 Max-plus and cycle hazards

Max-plus "longest walk of exactly `k` edges" is well-defined even with positive cycles (you simply traverse the cycle as many times as `k` allows). But "longest *simple* path" is NP-hard and *not* what max-plus power gives — same walks-vs-simple-paths caveat as counting. Be explicit about which you are computing.

### 6.4 The k-best (top-`t`) semiring

A more exotic but production-relevant semiring carries, in each cell, the `t` smallest walk weights rather than just the single minimum. The `⊕` merges two sorted lists keeping the `t` best; `⊗` adds an edge weight to each and re-merges. This computes the `t` shortest walks of exactly `k` edges between every pair — useful for "give me the 3 cheapest 5-leg itineraries". The element type is a bounded sorted list of size `t`, so each semiring op is `O(t)` (or `O(t log t)`), inflating the multiply to `O(V³ t)` per step. Beyond a small `t` this is expensive; for large `t` switch to an explicit `k`-shortest-walk algorithm. The point: the semiring abstraction stretches surprisingly far, but the element-op cost is part of the budget.

### 6.5 Choosing the data layout per semiring

- **Counting mod p:** flat `int64` array, `V*V` contiguous; reduce in the inner loop.
- **Min/max-plus:** flat `int64` with `INF = MAX/4` sentinel; branch (or `min`/`max` intrinsics) instead of multiply.
- **Boolean:** pack rows as bitsets (`uint64` words); the inner `AND`/`OR` then processes 64 entries per instruction, a 64× constant-factor win — the single biggest practical optimization for reachability.
- **Probability:** `double` flat array; hand to BLAS GEMM for large `V`.

---

## 7. Performance Engineering of Matrix Multiply

### 7.1 The `V³` constant dominates

`log k` is at most ~60. The real cost is the `V³` multiply, executed ~`2 log k` times. Every constant-factor win in `multiply` multiplies through:

- **Loop order `i, t, j`** (not `i, j, t`): keeps `b[t][·]` row-contiguous, turning a cache-miss-per-`j` into a streamed read.
- **Zero-skip:** `if a[i][t] == 0: continue` — big win on sparse automata matrices.
- **Flat arrays:** store the matrix as a single `V*V` slice/array, index `i*V + j`. Avoids pointer-chasing per row.
- **Blocking/tiling:** for `V` in the hundreds, tile the `i, j, t` loops to L1/L2 to cut cache misses.
- **SIMD / BLAS:** for the real-valued (probability) semiring, hand off to optimized GEMM (numpy `@`, OpenBLAS). Not applicable to min-plus (no hardware min-plus GEMM), though specialized tropical-GEMM libraries exist.

### 7.2 Parallelism

Matrix multiply is embarrassingly parallel across output rows. For large `V`, split rows across threads/goroutines. The CRT pipeline (Section 3.4) parallelizes across primes. Binary exponentiation itself is sequential (each squaring depends on the last), so parallelism lives *inside* the multiply, not across the power loop.

### 7.3 Memory

Each `V × V` `int64` matrix is `8 V²` bytes — 80 KB for `V = 100`, 8 MB for `V = 1000`. Preallocate two scratch matrices and ping-pong between them inside `multiply` to avoid per-call allocation and GC churn.

### 7.4 Caching the power ladder for batched queries

When many queries share one graph but differ in `k`, precompute the squaring ladder `A^{2^0}, A^{2^1}, …, A^{2^{60}}` *once* (`O(V³ · 60)`), store it, and answer each query by multiplying together the ladder entries whose bits are set in that query's `k`. Even better, if each query also fixes a source `s`, push a *row vector* through the ladder in `O(V² · popcount(k))` instead of doing full `V³` matrix products — an order-of-magnitude win per query. This is Task 13 in [`tasks.md`](./tasks.md). The ladder is read-only after construction, so it is trivially shareable across threads and request handlers; do not rebuild it per request (a classic memory and latency regression at scale).

---

## 8. Code Examples

### 8.1 Go — semiring-parameterized matrix power (counting + min-plus)

```go
package main

import (
	"fmt"
	"math"
)

const MOD = 1_000_000_007
const INF = math.MaxInt64 / 4

// Semiring captures the two operations and their identities.
type Semiring struct {
	add  func(a, b int64) int64
	mul  func(a, b int64) int64
	zero int64
	one  int64
}

var Counting = Semiring{
	add:  func(a, b int64) int64 { return (a + b) % MOD },
	mul:  func(a, b int64) int64 { return (a * b) % MOD },
	zero: 0,
	one:  1,
}

var MinPlus = Semiring{
	add:  func(a, b int64) int64 { if a < b { return a }; return b },
	mul:  func(a, b int64) int64 { if a >= INF || b >= INF { return INF }; return a + b },
	zero: INF,
	one:  0,
}

func mul(a, b [][]int64, s Semiring) [][]int64 {
	n := len(a)
	c := make([][]int64, n)
	for i := range c {
		c[i] = make([]int64, n)
		for j := range c[i] {
			c[i][j] = s.zero
		}
		for t := 0; t < n; t++ {
			if a[i][t] == s.zero {
				continue
			}
			for j := 0; j < n; j++ {
				c[i][j] = s.add(c[i][j], s.mul(a[i][t], b[t][j]))
			}
		}
	}
	return c
}

func identity(n int, s Semiring) [][]int64 {
	id := make([][]int64, n)
	for i := range id {
		id[i] = make([]int64, n)
		for j := range id[i] {
			if i == j {
				id[i][j] = s.one
			} else {
				id[i][j] = s.zero
			}
		}
	}
	return id
}

func matPow(a [][]int64, k int64, s Semiring) [][]int64 {
	result := identity(len(a), s)
	for k > 0 {
		if k&1 == 1 {
			result = mul(result, a, s)
		}
		a = mul(a, a, s)
		k >>= 1
	}
	return result
}

func main() {
	A := [][]int64{{0, 1, 1}, {0, 0, 1}, {1, 0, 0}}
	fmt.Println("count walks len 3, 0->0:", matPow(A, 3, Counting)[0][0])

	W := [][]int64{{INF, 2, 5}, {INF, INF, 1}, {4, INF, INF}}
	fmt.Println("shortest 3-edge walk 0->2:", matPow(W, 3, MinPlus)[0][2])
}
```

### 8.2 Java — CRT-ready modular power (single prime shown)

```java
public class ModularWalks {
    final long mod;
    ModularWalks(long mod) { this.mod = mod; }

    long[][] mul(long[][] a, long[][] b) {
        int n = a.length;
        long[][] c = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int t = 0; t < n; t++) {
                if (a[i][t] == 0) continue;
                long ait = a[i][t];
                for (int j = 0; j < n; j++)
                    c[i][j] = (c[i][j] + ait * b[t][j]) % mod;
            }
        return c;
    }

    long[][] pow(long[][] a, long k) {
        int n = a.length;
        long[][] r = new long[n][n];
        for (int i = 0; i < n; i++) r[i][i] = 1 % mod;
        while (k > 0) {
            if ((k & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            k >>= 1;
        }
        return r;
    }

    public static void main(String[] args) {
        long[][] A = {{0, 1, 1}, {0, 0, 1}, {1, 0, 0}};
        // Run under several primes and CRT-combine for a larger exact answer.
        long[] primes = {1_000_000_007L, 998_244_353L};
        for (long p : primes) {
            long[][] Ak = new ModularWalks(p).pow(A, 3);
            System.out.println("mod " + p + ": walks len3 0->0 = " + Ak[0][0]);
        }
    }
}
```

### 8.3 Python — Markov k-step distribution (probability semiring)

```python
def mat_mul_real(a, b):
    n, p = len(a), len(b[0])
    m = len(b)
    c = [[0.0] * p for _ in range(n)]
    for i in range(n):
        for t in range(m):
            ait = a[i][t]
            if ait == 0.0:
                continue
            bt = b[t]
            ci = c[i]
            for j in range(p):
                ci[j] += ait * bt[j]
    return c


def identity_real(n):
    return [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]


def mat_pow_real(a, k):
    result = identity_real(len(a))
    while k > 0:
        if k & 1:
            result = mat_mul_real(result, a)
        a = mat_mul_real(a, a)
        k >>= 1
    return result


def k_step_distribution(P, pi0, k):
    Pk = mat_pow_real(P, k)
    # row vector pi0 times Pk
    n = len(P)
    return [sum(pi0[i] * Pk[i][j] for i in range(n)) for j in range(n)]


if __name__ == "__main__":
    P = [
        [0.9, 0.1],
        [0.5, 0.5],
    ]
    pi0 = [1.0, 0.0]
    print("dist after 10 steps:", k_step_distribution(P, pi0, 10))
    print("dist after 10000 steps (≈ stationary):", k_step_distribution(P, pi0, 10_000))
```

---

## 9. Observability and Testing

A matrix-power result is opaque — one wrong entry looks like any other large number. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force oracle on small `V` and small `k` | Catches off-by-one (length = edges) and identity bugs. |
| Geometric-growth sanity | Counts should grow ≈ `λ_max^k`; non-geometric growth signals a bug. |
| Row-sum invariant (Markov) | Each row of `P^k` must sum to ~1.0; drift exposes numerical error. |
| `A^0 == I` test | Confirms the base case and the power-loop accumulator. |
| `A^a · A^b == A^{a+b}` | Property test for the multiply and the power loop. |
| Semiring identity test | `A · I == A` and `I · A == A` in the chosen semiring. |
| Determinism across languages | Same seed, same modulus → identical Go/Java/Python outputs. |

The single most valuable test is the **brute-force oracle**: a layered DP that recomputes `A^k` the slow way for `V ≤ 6, k ≤ 8`, compared entrywise. It catches the overwhelming majority of bugs.

### 9.1 A property-test battery

In a real codebase, encode these as randomized property tests run on every CI build:

```text
for random small graph G, random k in [0, 8]:
    assert matpow(G, 0) == I
    assert matpow(G, 1) == G
    assert matpow(G, k) == bruteforce_layered(G, k)        # the oracle
    assert matpow(G, a) · matpow(G, b) == matpow(G, a+b)   # homomorphism
    assert matpow(G, k) · I == matpow(G, k)                # identity law
for the chosen semiring:
    assert identity has 1̄ on diagonal, 0̄ off-diagonal
```

These six invariants, run on a few hundred random instances, give high confidence. The `A^a · A^b == A^{a+b}` test is especially good at catching a broken `multiply` that happens to be correct only for the squaring path (a surprisingly common partial bug).

### 9.2 Production guardrails

For a service answering walk-count queries at scale, add: a **magnitude estimate** (`λ_max^k`) logged alongside each result so an anomalous answer stands out; an **input validator** asserting the matrix is square and entries are in `[0, p)`; and a **period pre-filter** that returns `0` instantly for residue-mismatched `(i, j, k)` triples (Section 2.3b), both speeding up and sanity-checking the common zero case.

---

## 10. Failure Modes

### 10.1 Silent overflow

Forgetting the modulus, or letting `a*b` overflow before reduction, yields plausible-looking but wrong numbers. Mitigation: reduce in the inner loop or use a 128-bit accumulator with a proven term bound.

### 10.2 Wrong semiring identity

Min-plus power with the counting identity (zeros off-diagonal) returns shortest distances that are uniformly too small (a 0-cost "free" diagonal jump leaks in). Mitigation: encapsulate identity in the semiring.

### 10.3 Walks mistaken for simple paths

Someone uses `(A^k)[i][j]` to answer a *simple path* question. The count is wrong (too large) because walks revisit vertices. Counting simple paths of length `k` is #P-hard — there is no fast fix. Mitigation: state the walk/path distinction in code comments and in the problem analysis. See `professional.md` for the hardness argument.

### 10.4 Dimension explosion

Modeling a DP as a matrix when the state count is large (thousands) makes `V³` infeasible. Mitigation: minimize states; if the recurrence is order-`r` with `r` large and only one term is needed, switch to Kitamasa (`O(r² log k)`).

### 10.5 Floating-point for exact counts

Using eigenvalues or `double` to get an exact integer count fails: irrational eigenvalues and rounding destroy exactness. Mitigation: exact counts → integer matrix mod `p`; eigenvalues only for asymptotics.

### 10.6 Markov drift at huge `k`

Powering a stochastic matrix to `k = 10^9` accumulates rounding; rows drift off `1`. Mitigation: renormalize periodically, or solve for the stationary distribution directly if `k` is effectively "infinite".

### 10.7 Rebuilding the power ladder per request

In a batched service, recomputing `A^k` from scratch for every query (instead of caching the squaring ladder) wastes `O(V³ log k)` per request and allocates fresh matrices each time. Symptoms: latency that scales with `log k` per query and GC pressure. Mitigation: build the ladder once at startup, share it read-only (Section 7.4).

### 10.8 Off-by-one between "length" and "stops"

A subtle modeling bug: business requirements often say "exactly 5 stops", which usually means 5 *intermediate* vertices and therefore `6` edges, not `5`. Always pin down whether the constraint counts edges, intermediate vertices, or total vertices, and translate to the matrix exponent explicitly. This off-by-one survives all the algebraic tests (the math is correct for *some* `k`) and only surfaces against real expected outputs — another reason the brute-force oracle must be fed the same human-specified inputs, not a re-derived `k`.

---

## 11. Summary

- Binary exponentiation makes length-`k` walk problems `O(V³ log k)` — the `log k` is the entire reason `k = 10^18` is trivial.
- Eigenvalues give the *growth rate* (`λ_max^k`) and asymptotics but **not** exact integer counts; for exactness use integer matrices mod a prime, and CRT across several primes when the answer exceeds one prime's range.
- The most powerful senior use is **layered-DP collapse**: a small, layer-independent transition matrix powered to `k` turns an `O(|S|² k)` DP into `O(|S|³ log k)`. Keep the state count small — cost is cubic in it.
- The probability semiring turns the same engine into Markov `k`-step distributions (and, at convergence, PageRank); watch for floating-point drift and prefer direct stationary solving when `k → ∞`.
- Parameterize by semiring: one tested `matPow` serves counting, min-plus shortest (cf. `06-floyd-warshall`), max-plus longest, boolean reachability, probability, and k-best. The identity matrix belongs to the semiring — never mismatch it.
- Performance lives inside the `V³` multiply: cache-friendly `i,t,j` order, zero-skip, flat arrays, blocking, and BLAS for the real-valued case. Parallelize across output rows and across CRT primes.
- Always keep a brute-force oracle; it catches the length-off-by-one, the identity mistake, and the modulus mistake that together account for nearly every real bug.

### Decision summary

- **Large `k`, small `V`, counting** → modular matrix power (`O(V³ log k)`); CRT across primes for exact large values.
- **Large `k`, optimization with fixed edge count** → min/max-plus power; for unconstrained, drop to Floyd-Warshall / Dijkstra.
- **Single recurrence term, large order** → Kitamasa (`O(r² log k)`).
- **Probabilistic, finite `k`** → real matrix power; for `k → ∞` solve the stationary distribution directly.
- **Reachability, many vertices** → bitset Boolean multiply.
- **Batched queries on one graph** → cache the squaring ladder once, push row vectors through it.
- **Simple-path counting** → stop; #P-hard, wrong tool.

References to study further: Kitamasa / Cayley-Hamilton recurrence reduction, Perron-Frobenius theory for `λ_max`, Aho-Corasick automaton path counting, absorbing Markov chain fundamental matrix, tropical (min-plus) linear algebra, the transfer-matrix method (Flajolet-Sedgewick), and sibling topics `06-floyd-warshall`, `01-representation`, and `10-matrix-exponentiation` (in `19-number-theory`).
