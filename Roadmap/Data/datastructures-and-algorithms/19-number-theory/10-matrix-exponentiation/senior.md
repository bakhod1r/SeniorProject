# Matrix Exponentiation for Linear Recurrences — Senior Level

> Powering a `2×2` Fibonacci matrix is a one-liner — but the moment `n` reaches `10^18`, the order `k` grows to the hundreds, the entries must be exact modulo a prime (or several primes via CRT), and the code runs in a hot production loop, every detail (overflow budget, small-matrix layout, when to abandon the matrix for Kitamasa, never touching floating point, testing against a slow oracle) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Overflow and Modular Pipelines](#2-overflow-and-modular-pipelines)
3. [Matrix-Multiply Cost and Small-Matrix Optimization](#3-matrix-multiply-cost-and-small-matrix-optimization)
4. [When k Is Large: Kitamasa and Cayley-Hamilton](#4-when-k-is-large-kitamasa-and-cayley-hamilton)
5. [Numerical Pitfalls: Avoid Floats](#5-numerical-pitfalls-avoid-floats)
6. [Huge n and Big-Integer Exactness](#6-huge-n-and-big-integer-exactness)
7. [Code Examples](#7-code-examples)
8. [When Matrix Exponentiation Beats the Alternatives](#8-when-matrix-exponentiation-beats-the-alternatives)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how do I build the companion matrix" but "what breaks when I scale this, and which tool is actually right?". Matrix exponentiation for recurrences shows up in three production guises that share one engine:

1. **Single huge-index evaluation** — "compute `f(10^18) mod p`" for a fixed small-order recurrence. The matrix is `k × k`, the answer is exact mod a prime.
2. **Many queries on one recurrence** — answer thousands of `(n_i)` queries; the squaring ladder of `M` can be cached once.
3. **Large-order recurrence** — order `k` in the hundreds (e.g. from a generating-function denominator), where the `k³` matrix multiply becomes the bottleneck and Kitamasa's `O(k² log n)` is the right call.

All three reduce to: *build a transition matrix of dimension equal to the recurrence order, raise it to the `n`-th power over `ℤ_p`, read or contract against the initial state.* The senior decisions are: keep the dimension minimal, keep the arithmetic exact and overflow-free, make the multiply fast (or abandon it for Kitamasa), never let a float near an exact count, and verify when `n` is too large to loop.

This document treats those decisions in production terms. The graph cousin (counting walks of length `k` via `A^k`) is `11-graphs/32-paths-fixed-length`; the algebra is identical, only the interpretation differs.

---

## 2. Overflow and Modular Pipelines

### 2.1 Overflow budget

In the counting semiring with `int64` and modulus `p < 2^31` (e.g. `10^9 + 7`), the product `a[i][t] * b[t][j]` of two reduced residues is `< 2^62`, which fits in `int64`. The accumulation `c += product` can overflow if you defer the `% p`. Two safe strategies:

- **Reduce every step:** `c = (c + a*b) % p`. Always safe, a division per inner-loop iteration. The default.
- **Defer with a 128-bit accumulator (or `__int128` / unsigned math):** accumulate several products before reducing. Faster, but you must bound how many products fit before overflow — `floor((2^63 - 1) / (p-1)²)` terms for signed `int64`. For `p = 10^9+7` and `k`-term sums this is a meaningful constant only when `k` is large.

For a `2×2` Fibonacci matrix the inner sum is only 2 terms, so deferring buys almost nothing; the simple "reduce every step" is correct and fast. The deferral matters at order `k` in the tens or hundreds.

### 2.2 Choosing the modulus

| Modulus | Use |
|---------|-----|
| `10^9 + 7`, `998244353` | The problem dictates it; `998244353` is NTT-friendly if you later switch to Kitamasa with FFT/NTT polynomial multiply. |
| Multiple coprime primes + CRT | When the true (non-modular) term exceeds a single 30-bit prime's range and you want to recover a larger exact value. |
| A power of two (`2^64` implicit) | When the problem wants the answer mod `2^64` — natural `uint64` wraparound, no explicit reduction. |

### 2.3 Negative residues

If the recurrence has **negative coefficients** (e.g. `f(n) = 3 f(n-1) − 2 f(n-2)`), the product `a*b` can be negative, and in Go and Java `%` returns a negative result for negative operands. Normalize with `((x % p) + p) % p`. This is a real bug source for recurrences that subtract — Fibonacci never hits it, but characteristic-polynomial-derived matrices often do.

### 2.4 CRT pipeline for large exact answers

When you need the exact (non-modular) term and it exceeds one prime, run the same matrix power under several primes `p₁, p₂, …` and reconstruct via CRT. This is embarrassingly parallel: each prime is an independent matrix-exponentiation job. Estimate how many primes you need from the growth rate: the term has roughly `n · log₂(λ_max)` bits, where `λ_max` is the dominant characteristic root (Section 6).

### 2.5 `mulmod` when the modulus exceeds 32 bits

The "`a*b` fits in `int64`" argument relies on `p < 2^31` so that `(p-1)² < 2^62`. The moment the modulus is a *large* 64-bit prime (say `p ≈ 4·10^18`, common when the problem wants a near-`2^62` modulus), `a*b` overflows `int64` *before* you can reduce it, silently corrupting every entry. You then need a real `mulmod` that computes `(a·b) mod p` without an intermediate overflow. Three portable options:

- **128-bit intermediate** — compute the product in a 128-bit type, then reduce. Cleanest where the language or compiler offers it (`__int128` in C/C++, `math/bits.Mul64` + `Div64` in Go, `Math.multiplyHigh`/`BigInteger` in Java, native bignums in Python).
- **Russian-peasant (`O(log b)` add-mod)** — accumulate `a` into the result `b` times by doubling, reducing at each step. Portable everywhere, but `O(log p)` per multiply, which inside a `d³` loop is costly.
- **`long double` Barrett/Montgomery trick** — fast but fiddly and platform-dependent; reserve for hot paths after profiling.

Below, each `mulmod` is the building block that replaces the bare `a*b % p` inside the matrix multiply when `p` is large:

```go
import "math/bits"

// mulmod computes (a*b) mod m for any a,b < m < 2^63, no overflow.
func mulmod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b) // full 128-bit product
	_, rem := bits.Div64(hi%m, lo, m)
	return rem
}
```

```java
// Java 9+: Math.multiplyHigh gives the high 64 bits; combine via 128-bit logic.
// Simplest portable version uses BigInteger for the wide product (slower but safe).
import java.math.BigInteger;

static long mulmod(long a, long b, long m) {
    return BigInteger.valueOf(a)
                     .multiply(BigInteger.valueOf(b))
                     .mod(BigInteger.valueOf(m))
                     .longValue();
}
```

```python
def mulmod(a: int, b: int, m: int) -> int:
    # Python ints are arbitrary precision, so a*b never overflows;
    # this exists only to mirror the Go/Java signatures and document intent.
    return (a * b) % m
```

The asymmetry is instructive: Python gets `mulmod` for free (arbitrary-precision ints), Go has a clean intrinsic (`math/bits`), and Java's portable path detours through `BigInteger` unless you hand-roll the 128-bit arithmetic. For a `2×2` matrix the per-multiply count is tiny so even the `BigInteger` route is acceptable; for large `d` it becomes a real bottleneck and you would switch to a primitive 128-bit `mulmod`.

A practical decision rule: if `p < 2^31` use the bare `a*b % p` (fastest, always correct); if `2^31 ≤ p < 2^63` you *must* use a `mulmod`. The boundary is easy to misjudge — a modulus given as `9_223_372_036_854_775_783` (a large 64-bit prime) looks like just another constant but silently breaks the bare-product code. Make the modulus size an explicit, reviewed decision rather than an accident of which constant the problem handed you.

---

## 3. Matrix-Multiply Cost and Small-Matrix Optimization

### 3.1 The `k³` constant dominates

`log n` is at most ~60. The real cost is the `k³` multiply, executed ~`2 log n` times. Every constant-factor win in `multiply` multiplies through:

- **Loop order `i, t, j`** (not `i, j, t`): keeps `b[t][·]` row-contiguous, turning a cache-miss-per-`j` into a streamed read.
- **Zero-skip:** `if a[i][t] == 0: continue`. Companion matrices are sparse (top row + sub-diagonal), so early powers skip a lot — though powers densify quickly.
- **Flat arrays:** store the matrix as a single `k*k` slice/array, index `i*k + j`. Avoids pointer-chasing per row.

### 3.2 Hard-coded small matrices

For the ubiquitous `2×2` (Fibonacci-family) and `3×3` (tribonacci) cases, **unroll the multiply** into explicit scalar expressions and use fixed-size stack arrays. This eliminates loop overhead, bounds checks, and heap allocation entirely. A hand-unrolled `2×2` modular multiply is several times faster than the generic triple loop and allocates nothing — worth it when `fib(n) mod p` is called millions of times.

```go
// 2x2 modular multiply, fully unrolled, zero allocation.
func mul2(a, b [4]int64) [4]int64 {
	return [4]int64{
		(a[0]*b[0] + a[1]*b[2]) % MOD,
		(a[0]*b[1] + a[1]*b[3]) % MOD,
		(a[2]*b[0] + a[3]*b[2]) % MOD,
		(a[2]*b[1] + a[3]*b[3]) % MOD,
	}
}
```

### 3.3 Memory and buffer reuse

Each `k × k` `int64` matrix is `8 k²` bytes — 32 bytes for `2×2`, 80 KB for `k = 100`. For larger `k`, preallocate two scratch matrices and ping-pong between them inside `multiply` to avoid per-call allocation and GC churn. For `2×2` the matrix fits in registers, so this is moot.

### 3.4 Caching the power ladder for batched queries

When many queries share one recurrence but differ in `n`, precompute the squaring ladder `M^{2^0}, M^{2^1}, …, M^{2^{60}}` *once* (`O(k³ · 60)`), store it read-only, and answer each query by multiplying the ladder entries whose bits are set in that query's `n`. Even better, push the *initial state vector* through the ladder in `O(k² · popcount(n))` instead of full `k³` matrix products — an order-of-magnitude win per query. Do not rebuild the ladder per request (a classic latency and GC regression at scale).

### 3.5 Reducing the dimension before you optimize the multiply

The cheapest `k³` is the one you never run. Before tuning the inner loop, ask whether the matrix can be *smaller*, because shaving the dimension from `k` to `k-1` cuts the per-multiply cost by `((k-1)/k)³` — a structural win that no cache trick matches. Concrete reductions:

- **Drop trailing zero coefficients.** If `f(n) = c_1 f(n-1) + … + c_m f(n-m)` with `c_{m+1} = … = c_k = 0`, the true order is `m`, not `k`. Model the order-`m` recurrence and the matrix is `m × m`.
- **Collapse a redundant augmentation.** A constant-term augmentation adds a dimension; if the problem only needs the term mod `p` and the constant is `0`, drop the augmented row entirely.
- **Exploit a known closed form for part of the state.** If a sub-block of the state evolves independently (e.g. a geometric `r^n` factor), compute it separately with scalar binary exponentiation and keep it out of the matrix.
- **Prefer the minimal recurrence.** A sequence may satisfy a high-order recurrence by accident while obeying a lower-order *minimal* one (its minimal polynomial). Finding the minimal recurrence (Berlekamp–Massey, see `professional.md`) can collapse a `k=200` matrix to `k=12`, turning a multi-second job into microseconds.

### 3.6 Cache-friendly multiply: a worked layout

For mid-sized `k` (tens to low hundreds) the matrix no longer fits in registers and memory layout dominates. The canonical fix is the `i, t, j` loop order over a **flat** array `m[i*k + j]`:

```text
for i in 0..k:
    for t in 0..k:
        a_it = A[i*k + t]
        if a_it == 0: continue          # zero-skip (companion matrices start sparse)
        row_b = B[t*k : t*k + k]         # contiguous row of B
        row_c = C[i*k : i*k + k]
        for j in 0..k:
            row_c[j] = (row_c[j] + a_it * row_b[j]) % MOD
```

The inner `j` loop streams two *contiguous* rows (`B[t][·]` and `C[i][·]`), so the hardware prefetcher keeps both in L1; the `i, j, t` order, by contrast, would stride down a *column* of `B` and thrash the cache. The zero-skip helps only for the early powers — companion matrices densify after a few squarings — but those early powers are also where the base matrix is smallest, so it is still worth the cheap branch.

---

## 4. When k Is Large: Kitamasa and Cayley-Hamilton

### 4.1 The idea

When you need only a *single* term `f(n)` of an order-`k` recurrence (not the whole matrix), the `O(k³ log n)` matrix power is wasteful. By the **Cayley-Hamilton theorem**, the companion matrix `M` satisfies its own characteristic polynomial `χ(x)` of degree `k`, so `M^n` lies in the `k`-dimensional algebra spanned by `I, M, …, M^{k-1}`. It is therefore determined by `k` scalars (a degree-`<k` polynomial), not `k²` matrix entries.

### 4.2 Kitamasa complexity

The **Kitamasa method** computes `x^n mod χ(x)` by *polynomial* binary exponentiation: `O(log n)` polynomial multiplications and reductions, each of degree `< k`. Schoolbook polynomial multiply is `O(k²)`, giving `O(k² log n)` — a factor of `k` faster than the matrix. With FFT/NTT multiply (when `p` is NTT-friendly like `998244353`), each step is `O(k log k)`, giving `O(k log k log n)`.

| Need | Best tool | Cost |
|------|-----------|------|
| Full matrix `M^n` (e.g. need a window of terms) | matrix power | `O(k³ log n)` |
| One term, small `k` (≤ ~64) | matrix power (simpler) | `O(k³ log n)` |
| One term, large `k` | Kitamasa | `O(k² log n)` |
| One term, very large `k`, NTT-friendly `p` | Kitamasa + NTT | `O(k log k log n)` |

### 4.3 The crossover

The crossover is around `k ≈ 64`: below it the matrix power's cache behavior and simplicity often beat Kitamasa's polynomial bookkeeping; above it the `k`-factor saving dominates. For everyday recurrences (order 2–10), always use the matrix — Kitamasa's overhead is not worth it. Reach for Kitamasa only when profiling shows the `k³` multiply is the bottleneck on a high-order recurrence. The full derivation is in `professional.md`.

---

## 5. Numerical Pitfalls: Avoid Floats

### 5.1 Binet's formula is a trap for exact answers

Fibonacci has the closed form `F_n = (φ^n − ψ^n)/√5` with `φ = (1+√5)/2`. It is tempting to compute `F_n` directly in floating point. **Do not** for exact results: `φ` is irrational, `double` has ~53 bits of mantissa, and `φ^n` loses all precision well before `n = 80`. Worse, you cannot reduce an irrational mod `p`. Binet is for *asymptotics and growth-rate reasoning only*; exact terms require integer matrix exponentiation over `ℤ_p`.

### 5.2 The general principle

Any eigenvalue / spectral closed form for a recurrence involves the characteristic roots, which are generally irrational algebraic numbers. Floating-point evaluation gives an approximation, not an exact integer, and the error compounds with `n`. The senior rule: **exact recurrence terms ⇒ integer matrix (or Kitamasa) mod a prime; floats only for order-of-magnitude estimates.**

### 5.3 Where floats are legitimate

Floats are fine when the recurrence is genuinely real-valued and you want an approximation — e.g. a probabilistic recurrence, or estimating `log F_n ≈ n log φ` to decide how many CRT primes you need. They are never acceptable for an exact mod-`p` answer.

---

## 6. Huge n and Big-Integer Exactness

### 6.1 The `log n` advantage assumes `O(1)` arithmetic

Over `ℤ_p` with fixed-width `p`, each scalar op is `O(1)`, so the power is `O(k³ log n)`. But if the problem wants the **exact** (non-modular) term and `n` is large, the term itself has `Θ(n log λ_max)` digits. Big-integer multiplication is then not `O(1)` per entry — it costs `O(M(digits))` — and `log n` no longer dominates. This is precisely why competitive and production problems specify a modulus: it keeps every scalar op `O(1)`.

### 6.2 Estimating magnitude

The dominant characteristic root `λ_max` sets the growth rate: `f(n) ≈ C · λ_max^n`. So `log₂ f(n) ≈ n log₂ λ_max + O(1)`. For Fibonacci, `λ_max = φ ≈ 1.618`, so `F_n` has about `0.694 n` bits. Use this to choose the number of CRT primes when an exact large value is required.

### 6.3 `n` as a big integer

When `n` itself does not fit in 64 bits (rare, but it happens when `n` is given mod something or is a product), binary exponentiation still works — iterate over the bits of `n` as a big integer. Each bit is one squaring; the count of bits is `O(log n)`, unchanged. The squaring/multiply on the *matrix* is still `O(k³)` per bit.

---

## 7. Code Examples

### 7.1 Go — order-`k` recurrence with negative-coefficient normalization

```go
package main

import "fmt"

const MOD = 1_000_000_007

func norm(x int64) int64 { return ((x % MOD) + MOD) % MOD }

func mul(a, b [][]int64) [][]int64 {
	n := len(a)
	c := make([][]int64, n)
	for i := range c {
		c[i] = make([]int64, n)
		for t := 0; t < n; t++ {
			if a[i][t] == 0 {
				continue
			}
			for j := 0; j < n; j++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func matPow(a [][]int64, n int64) [][]int64 {
	sz := len(a)
	r := make([][]int64, sz)
	for i := range r {
		r[i] = make([]int64, sz)
		r[i][i] = 1
	}
	for n > 0 {
		if n&1 == 1 {
			r = mul(r, a)
		}
		a = mul(a, a)
		n >>= 1
	}
	return r
}

// f(n) = 3 f(n-1) - 2 f(n-2), f(0)=1, f(1)=3  ->  f(n) = 2^n + 1 pattern check
func main() {
	coeffs := []int64{norm(3), norm(-2)} // negative coefficient normalized
	init := []int64{1, 3}
	k := len(coeffs)
	M := [][]int64{{coeffs[0], coeffs[1]}, {1, 0}}
	var n int64 = 5
	Mn := matPow(M, n-int64(k-1))
	state := [][]int64{{init[1]}, {init[0]}}
	fmt.Println(mul(Mn, state)[0][0] % MOD) // f(5)
}
```

### 7.2 Java — cached squaring ladder for many n queries

```java
import java.util.*;

public class CachedLadder {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        int n = a.length;
        long[][] c = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int t = 0; t < n; t++) {
                if (a[i][t] == 0) continue;
                long ait = a[i][t];
                for (int j = 0; j < n; j++)
                    c[i][j] = (c[i][j] + ait * b[t][j]) % MOD;
            }
        return c;
    }

    // Precompute M^(2^b) for b = 0..60.
    static List<long[][]> ladder(long[][] M, int bits) {
        List<long[][]> L = new ArrayList<>();
        long[][] cur = M;
        for (int b = 0; b < bits; b++) {
            L.add(cur);
            cur = mul(cur, cur);
        }
        return L;
    }

    // Answer one query: f(n) via vector pushed through the cached ladder.
    static long query(List<long[][]> L, long[] init, long n) {
        int k = init.length;
        // state column (f(k-1),...,f(0))
        long[][] state = new long[k][1];
        for (int i = 0; i < k; i++) state[i][0] = init[k - 1 - i];
        long e = n - (k - 1);
        for (int b = 0; e > 0; b++, e >>= 1)
            if ((e & 1) == 1) state = mul(L.get(b), state);
        return state[0][0] % MOD;
    }

    public static void main(String[] args) {
        long[][] M = {{1, 1}, {1, 0}}; // Fibonacci
        List<long[][]> L = ladder(M, 61);
        long[] init = {0, 1};
        for (long n : new long[]{10, 20, 1_000_000_000_000L})
            System.out.println("F(" + n + ") = " + query(L, init, n));
    }
}
```

### 7.3 Python — magnitude estimate to pick CRT prime count

```python
import math

PHI = (1 + 5 ** 0.5) / 2


def fib_bits(n):
    """Approximate number of bits in F_n (for CRT prime budgeting only)."""
    if n <= 1:
        return 1
    return max(1, int(n * math.log2(PHI) - 0.5 * math.log2(5)))


def primes_needed(n, prime_bits=30):
    return fib_bits(n) // prime_bits + 1


if __name__ == "__main__":
    for n in (100, 1000, 10**6):
        print(f"F_{n}: ~{fib_bits(n)} bits, needs ~{primes_needed(n)} CRT primes")
    # Reminder: never compute the exact value via float Binet — this is only
    # a SIZE estimate. The actual digits come from integer matrix power per prime.
```

### 7.4 Testing against a brute-force oracle (all three languages)

The single highest-value safeguard is a slow `O(n)` reference and a loop that diffs it against the matrix path for every small `n`. This is the test that actually catches the exponent off-by-one and the reversed state vector — the bugs that survive every algebraic property check.

```go
// fibLoop is the trusted O(n) oracle.
func fibLoop(n int64) int64 {
	a, b := int64(0), int64(1)
	for i := int64(0); i < n; i++ {
		a, b = b, (a+b)%MOD
	}
	return a
}

// crossCheck panics on the first disagreement; call it at startup / in tests.
func crossCheck() {
	for n := int64(0); n <= 2000; n++ {
		if fib(n) != fibLoop(n) { // fib = matrix path from junior.md
			panic(fmt.Sprintf("mismatch at n=%d: matrix=%d loop=%d", n, fib(n), fibLoop(n)))
		}
	}
}
```

```java
static long fibLoop(long n) {        // trusted O(n) oracle
    long a = 0, b = 1;
    for (long i = 0; i < n; i++) {
        long t = (a + b) % MOD;
        a = b;
        b = t;
    }
    return a;
}

static void crossCheck() {           // diff matrix path vs oracle
    for (long n = 0; n <= 2000; n++) {
        long m = fib(n);             // matrix path
        long l = fibLoop(n);
        if (m != l)
            throw new AssertionError("mismatch at n=" + n + ": " + m + " != " + l);
    }
}
```

```python
def fib_loop(n, mod=10**9 + 7):      # trusted O(n) oracle
    a, b = 0, 1
    for _ in range(n):
        a, b = b, (a + b) % mod
    return a


def cross_check():                   # diff matrix path vs oracle
    for n in range(2001):
        m, l = fib(n), fib_loop(n)   # fib = matrix path
        assert m == l, f"mismatch at n={n}: {m} != {l}"
```

Run `crossCheck` once at process start (or as a unit test) before trusting the matrix path on `n = 10^18`. For a *general* solver, replace `fibLoop` with the order-`k` loop `for i in k..n: f[i] = Σ c_j f[i-j] mod p` and diff `nthTerm(coeffs, init, n)` against it — the same pattern catches the augmentation bugs too.

---

## 8. When Matrix Exponentiation Beats the Alternatives

A senior is expected to *choose*, not reflexively reach for the matrix. Here is the decision in production terms, with the reasoning behind each branch.

| Situation | Best tool | Why |
|-----------|-----------|-----|
| Small `n` (≤ ~10^6), any order | Plain DP loop, `O(k·n)` | No `k³` overhead per step; simpler and often faster in wall-clock. The matrix wins only once `n` is large enough that `k³ log n < k·n`. |
| Large `n`, small order `k` (≤ ~64), term mod `p` | **Matrix power**, `O(k³ log n)` | The sweet spot. Simple, cache-cheap, easy to verify. Unroll `2×2`/`3×3`. |
| Large `n`, large order `k`, one term | Kitamasa, `O(k² log n)` | The `k`-factor saving dominates above the crossover; Cayley-Hamilton justifies it. |
| Closed form exists and is float-safe | Direct formula, `O(1)` | Rare for exact integer answers — Binet is *not* float-safe (Section 5). |
| Sequence obeys an unknown low-order recurrence | Berlekamp–Massey → matrix/Kitamasa | Recover the minimal recurrence first; it may collapse the dimension dramatically. |

The crossover where the matrix overtakes the loop is roughly where `k³ log n ≈ k·n`, i.e. `n ≈ k² log n`. For Fibonacci (`k = 2`) that is around `n ≈ 100`; for `k = 50` it is around `n ≈ 10^5`. Below the crossover, *the loop is the senior choice* — fewer moving parts, no exponent off-by-one, trivially correct. Reaching for matrix exponentiation when a 30-line loop would do is a real anti-pattern that adds bug surface for no measurable gain. The matrix earns its complexity only when `n` is genuinely astronomical or the same recurrence is queried at many large indices (where the cached ladder of Section 3.4 amortizes the build).

A second axis is *what you need from the answer*. If you need a whole **window** of consecutive terms (e.g. `f(n), f(n-1), …`), the full matrix `M^n` gives them all at once and beats Kitamasa even at large `k`. If you need a **single** term, Kitamasa's polynomial view avoids materializing the `k²` matrix entries. Match the tool to the shape of the output, not just to `n` and `k`.

---

## 9. Observability and Testing

A matrix-power term is opaque — one wrong digit looks like any other large number. Build checks in from day one.

| Check | Why |
|-------|-----|
| Naive `O(n)` loop oracle on small `n` | Catches the exponent off-by-one, the reversed state vector, and the identity bug. |
| `M^0 == I` test | Confirms the base case and the power-loop accumulator. |
| `M^a · M^b == M^{a+b}` | Property test for the multiply and the power loop. |
| Geometric-growth sanity | Terms should grow ≈ `λ_max^n`; non-geometric growth signals a bug. |
| Known closed-form spot checks | `F_10 = 55`, `F_20 = 6765`, tribonacci small values, etc. |
| Negative-coefficient normalization | If coefficients can be negative, assert all entries stay in `[0, p)`. |
| Determinism across languages | Same modulus → identical Go/Java/Python outputs. |

The single most valuable test is the **naive-loop oracle**: recompute `f(n)` the slow way for `n ≤ 1000` and compare. It catches the overwhelming majority of bugs, especially the exponent and state-layout errors that survive every algebraic check.

```text
for the recurrence under test:
    assert matpow(M, 0) == I
    assert nth_term(coeffs, init, n) == loop(coeffs, init, n)  for n in 0..1000   # the oracle
    assert matpow(M, a) · matpow(M, b) == matpow(M, a+b)        # homomorphism
    assert all 0 <= entry < p                                   # residue invariant
```

---

## 10. Failure Modes

### 10.1 Silent overflow
Forgetting the modulus, or letting `a*b` overflow before reduction, yields plausible but wrong numbers. Mitigation: reduce in the inner loop, or use a 128-bit accumulator with a proven term bound.

### 10.2 Negative-residue corruption
Recurrences with negative coefficients produce negative intermediate products; `%` is negative in Go/Java, poisoning later steps. Mitigation: `((x % p) + p) % p` after every signed operation.

### 10.3 Wrong augmentation for inhomogeneous terms
Using the plain companion matrix for `f(n) = a f(n-1) + b` drops the constant entirely. Mitigation: augment with a self-looping `1` row that carries the constant (see `middle.md`); test against the loop, which would immediately diverge.

### 10.4 Float contamination
Using Binet / eigenvalues / `double` to get an exact term fails: irrational roots and rounding destroy exactness past small `n`. Mitigation: exact terms → integer matrix mod `p`; floats only for magnitude estimates.

### 10.5 Dimension blow-up at large order
Modeling an order-`k` recurrence with `k` in the hundreds makes `k³` per multiply expensive. Mitigation: switch to Kitamasa (`O(k² log n)`), or minimize the order if some coefficients are zero/redundant.

### 10.6 Exponent off-by-one
The most insidious bug: using `M^n` where the state layout requires `M^{n-(k-1)}`, or reading the wrong result entry. It is algebraically "correct for *some* index" so it passes the homomorphism test and only fails against the oracle's human-specified `n`. Mitigation: always feed the oracle the same `n` and diff.

### 10.7 Rebuilding the ladder per query
In a batched service, recomputing `M^n` from scratch per query wastes `O(k³ log n)` each time and allocates fresh matrices. Mitigation: build the squaring ladder once at startup, share it read-only, push the state vector through it per query (Section 3.4).

### 10.8 Large-modulus product overflow
With a near-`2^62` modulus, the product `a*b` of two residues overflows `int64` *before* the `% p`, silently corrupting entries even though the modulus "fits". This is distinct from 10.1 (a forgotten modulus): here the modulus is applied, but too late. Mitigation: use a real `mulmod` (128-bit intermediate, Section 2.5) instead of the bare `a*b % p` everywhere inside the multiply. Python is immune; Go and Java are not.

---

## 11. Summary

- Binary exponentiation makes `f(n)` for an order-`k` recurrence `O(k³ log n)` — the `log n` is the entire reason `n = 10^18` is trivial.
- **Overflow** is controlled by reducing mod `p` in the inner loop; **negative coefficients** need explicit residue normalization, a bug Fibonacci hides but characteristic-polynomial matrices expose.
- The **`k³` multiply** is the cost center: cache-friendly `i,t,j` order, zero-skip on sparse companion matrices, flat arrays, and **hard-unrolled `2×2`/`3×3`** multiplies for the common small cases.
- When the **order `k` is large** and only one term is needed, abandon the matrix for **Kitamasa** (`O(k² log n)`, or `O(k log k log n)` with NTT), justified by Cayley-Hamilton. Crossover ≈ `k = 64`.
- **Never use floating-point** (Binet, eigenvalues) for an exact term — irrational roots and rounding destroy correctness; floats are only for magnitude estimates and CRT prime budgeting.
- For **exact (non-modular) huge terms**, the value has `Θ(n log λ_max)` bits; use CRT across enough primes (each an independent, parallel matrix-exponentiation job) and estimate the count from the growth rate.
- Always keep a **naive-loop oracle**; it catches the exponent off-by-one, the reversed state vector, the missing modulus, and the bad augmentation that together account for nearly every real bug.

### Decision summary

- **Large `n`, small order `k`, exact mod `p`** → matrix power (`O(k³ log n)`); unroll the `2×2`/`3×3` multiply.
- **Many `n` queries, one recurrence** → cache the squaring ladder once, push the state vector through it.
- **Large order `k`, single term** → Kitamasa (`O(k² log n)`); NTT variant for NTT-friendly `p`.
- **Constant / prefix-sum term** → augment the matrix (`middle.md`).
- **Exact non-modular huge term** → CRT across primes, count chosen from the growth rate.
- **Need a float estimate only** → Binet / `λ_max^n`; never for exact answers.
- **Large modulus near `2^62`** → replace `a*b % p` with a 128-bit `mulmod` (Section 2.5); the bare product overflows before reduction.
- **Small `n` (below the `n ≈ k² log n` crossover)** → a plain `O(k·n)` DP loop; do not pay the matrix's complexity for no gain.

### The two rules that prevent most incidents

If you remember nothing else from this document, remember these. **First, keep an oracle.** A 10-line `O(n)` loop, diffed against the matrix path for every `n` up to a few thousand at startup or in CI, catches the exponent off-by-one, the reversed state vector, the missing modulus, and the wrong augmentation — which together are the overwhelming majority of real bugs. The matrix path is opaque (every wrong large number looks plausible), so the oracle is not optional. **Second, keep the arithmetic exact.** Integers mod `p` only; never a float for an exact term, and a real `mulmod` once the modulus is large. Everything else in this document — cache layout, the squaring ladder, Kitamasa, dimension reduction — is performance. These two are correctness, and correctness is the part that pages you at 3 a.m.

References to study further: Kitamasa / Cayley-Hamilton recurrence reduction, NTT for polynomial multiply (`998244353`), Binet's formula and the golden ratio, CRT reconstruction, and sibling topics `11-graphs/32-paths-fixed-length` (the graph angle) and the scalar binary-exponentiation / modular-arithmetic topics in `19-number-theory`.
