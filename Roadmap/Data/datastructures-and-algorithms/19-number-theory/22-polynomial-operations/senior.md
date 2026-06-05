# Polynomial Operations (over a Field, especially mod p) — Senior Level

> Polynomial arithmetic is rarely the bottleneck at small degree — but the moment degree reaches tens of thousands, the coefficients must be exact modulo a prime, or you need a series inverse/log/exp/sqrt, every detail (which prime, NTT vs numeric FFT, Newton-iteration precision doubling, memory layout, and how you test an opaque coefficient vector) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [NTT-Backed Multiply for Big Degree](#2-ntt-backed-multiply-for-big-degree)
3. [Exact mod-p vs Numeric FFT](#3-exact-mod-p-vs-numeric-fft)
4. [Fast Division and Multipoint Evaluation](#4-fast-division-and-multipoint-evaluation)
5. [Newton Iteration: Inverse, Log, Exp, Sqrt](#5-newton-iteration-inverse-log-exp-sqrt)
6. [Memory and Layout](#6-memory-and-layout)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At senior level the question is no longer "how do I multiply two polynomials" but "what is the scaling regime, and what breaks when I push it?". Production polynomial work over `F_p` shows up in three regimes that share one engine — fast convolution:

1. **Large-degree exact convolution** — multiply polynomials of degree `10^5`–`10^6` exactly mod a prime. This is the NTT (sibling `15-ntt`); everything else is built on it.
2. **Power-series operations** — inverse `1/A(x)`, `log A(x)`, `exp A(x)`, `sqrt A(x)` modulo `x^n`, computed by Newton iteration with **precision doubling**. These power generating-function combinatorics.
3. **Higher-level algorithms** — fast division (via series inverse of the reversed polynomial), multipoint evaluation and interpolation (subproduct tree), and fast GCD (Half-GCD), all reducing to `O(n log n)` or `O(n log² n)` calls to the NTT.

The senior-level decisions are: which prime (and whether one prime is enough); exact NTT vs numeric FFT (precision vs speed); how to keep Newton iterations correct (the doubling invariant); how to lay out memory to avoid GC churn and cache misses; and how to verify an answer that is just an opaque vector of residues.

A useful framing: at this scale a polynomial is no longer "a small array you eyeball" but "a million-dimensional vector you can only validate by invariants." Every design choice below — exactness, preconditions, oracle tests, layout — exists to make that opaque vector trustworthy and fast. The junior/middle algorithms are still *correct* at scale; they are simply too slow, and the senior job is to replace each `O(n²)` step with its NTT-backed `O(n log n)` or `O(n log² n)` equivalent without changing the answer.

---

## 2. NTT-Backed Multiply for Big Degree

### 2.1 Why NTT, not schoolbook

Schoolbook multiply is `O(n²)`; at `n = 10^5` that is `10^{10}` operations — seconds to minutes. The **Number-Theoretic Transform** (sibling `15-ntt`) computes the same convolution in `O(n log n)` by evaluating both polynomials at the `2^k`-th roots of unity in `F_p`, multiplying pointwise, and interpolating back via the inverse transform. At `n = 10^5` this is ~`1.7·10^6` butterfly operations — milliseconds.

The NTT requires a prime of the form `p = c·2^k + 1` so that a primitive `2^k`-th root of unity exists mod `p`. The canonical choice is `998244353 = 119·2^23 + 1`, which supports transforms up to length `2^23 ≈ 8.4·10^6`. Multiplication of two polynomials becomes: pad both to a power of two `≥ deg(A)+deg(B)+1`, forward-NTT each, pointwise multiply, inverse-NTT.

The mechanics, kept here at survey level (full treatment in sibling `15-ntt`):

- **Roots of unity in `F_p`.** Let `g` be a primitive root mod `p` (for `998244353`, `g = 3`). Then `ω = g^{(p−1)/N}` has order exactly `N = 2^k`, playing the role the complex `e^{2πi/N}` plays in the FFT. The forward transform evaluates the polynomial at `ω^0, ω^1, …, ω^{N−1}`.
- **Butterfly recursion.** The transform splits even- and odd-indexed coefficients (Cooley-Tukey), combining with twiddle factors `ω^j` — identical structure to FFT but with modular arithmetic instead of complex multiplies, so it is exact.
- **Inverse transform.** Run the same butterflies with `ω^{−1}` (the modular inverse of `ω`), then multiply every coefficient by `N^{−1} mod p`. **Forgetting that final `N^{−1}` scaling is the single most common NTT bug** — it leaves every output coefficient inflated by exactly `N`.
- **One operand reused.** If you convolve the same `A` against many `B`'s, forward-transform `A` once and cache it; only the per-`B` forward transform, the pointwise multiply, and the inverse transform repeat.

### 2.2 The whole stack reduces to NTT

Once you have `O(n log n)` multiply, every other operation reduces to it:

| Operation | Reduction to multiply | Cost |
|-----------|----------------------|------|
| Series inverse mod `x^n` | Newton iteration, each step 2–3 multiplies | `O(n log n)` |
| Division `A / B` | reverse coefficients, series-invert `B`, multiply | `O(n log n)` |
| Log / exp / sqrt mod `x^n` | Newton iteration on the defining ODE | `O(n log n)` |
| Multipoint eval (`n` points) | subproduct tree of multiplies + remainders | `O(n log² n)` |
| Interpolation (`n` points) | subproduct tree + multipoint eval of derivative | `O(n log² n)` |
| GCD (Half-GCD) | recursive, multiply-bound | `O(n log² n)` |

The `O(n log² n)` ones carry an extra `log n` from the recursion tree depth times an `O(n log n)` multiply at each level.

### 2.3 Choosing the multiply primitive by degree

The asymptotic winner is not always the practical winner; constant factors decide the crossover:

| Degree regime | Best multiply | Why |
|---------------|---------------|-----|
| ≤ ~64 | schoolbook | tiny; recursion/transform overhead dominates |
| ~64 – ~2000 | Karatsuba (`15-divide-and-conquer/04-karatsuba`) | `O(n^1.585)`, no transform setup, cache-friendly |
| ≥ ~2000, mod a friendly prime | NTT (`15-ntt`) | `O(n log n)`, exact |
| ≥ ~2000, exact integer, big coeffs | multi-prime NTT + CRT | exact beyond one prime's range |
| no modulus, bounded magnitude | numeric FFT | only if `n·M² < 2^53` |

The crossovers are implementation- and hardware-specific; measure them with the benchmark in [`tasks.md`](./tasks.md) rather than hard-coding a threshold. A robust library dispatches on degree: schoolbook below a tuned cutoff, NTT above it, with Karatsuba as an optional middle tier.

---

## 3. Exact mod-p vs Numeric FFT

A central senior decision: convolve over `F_p` with NTT, or over the complex numbers with floating-point FFT?

| Aspect | NTT (mod p) | Numeric FFT (complex `double`) |
|--------|-------------|-------------------------------|
| Exactness | **exact** integer residues | approximate; rounding error |
| Modulus constraint | needs NTT-friendly prime | none |
| Coefficient size | any (mod `p`) | error grows with `n` and coefficient magnitude |
| Large products without mod | needs CRT across primes | round to nearest integer if it fits `double` mantissa (53 bits) |
| Typical use | competitive programming, crypto, exact combinatorics | signal processing, big-integer multiply when error is provably bounded |

**When the problem says "mod `p`", use NTT** — it is exact and avoids all rounding analysis. **When you need an exact integer product whose coefficients exceed one prime's range**, run NTT under several NTT-friendly primes and recombine with CRT (sibling `06-crt` / `17-garner-algorithm`); the number of primes needed is `≈ ceil(log2(max coefficient) / 30)`. Numeric FFT is the right tool only when there is no modulus and you can prove the rounding error stays below `0.5` so rounding recovers the exact integer — a precision budget that fails for large `n` with large coefficients.

A subtle exact-FFT pitfall: convolving two arrays of magnitude `M` and length `n` produces values up to `n·M²`; for `n·M² > 2^53` the `double` mantissa cannot represent the result exactly and rounding to the nearest integer is wrong. NTT has no such ceiling (only the transform-length ceiling `2^k`).

---

## 4. Fast Division and Multipoint Evaluation

### 4.1 Division via reversed series inverse

To divide `A` (degree `n`) by `B` (degree `m`), getting quotient `Q` (degree `n−m`): reverse both polynomials (`rev(P)[i] = P[deg−i]`), because the quotient's coefficients appear in the leading part of `rev(A) · rev(B)^{-1} mod x^{n−m+1}`. Concretely:

```
rev(A) ≡ rev(B) · rev(Q)  (mod x^{n-m+1})
rev(Q) ≡ rev(A) · rev(B)^{-1}  (mod x^{n-m+1})
```

So compute the series inverse of `rev(B)` modulo `x^{n−m+1}` (Newton, Section 5), multiply by `rev(A)`, take the low `n−m+1` coefficients, reverse to get `Q`, then `R = A − B·Q`. Total `O(n log n)`. This is the standard fast-division kernel and the reason series inverse is the most important Newton operation.

### 4.2 Multipoint evaluation (subproduct tree)

Evaluating `P` at `n` points naively is `O(n²)` (Horner per point). The fast method builds a **subproduct tree**: leaves are `(x − x_i)`, internal nodes are products of their children, the root is `Π(x − x_i)`. Then push `P mod (subtree product)` down the tree; at each leaf the remaining constant is `P(x_i)`. Each level costs `O(n log n)` (multiplies and remainders), and there are `O(log n)` levels, so `O(n log² n)`. Fast interpolation is the transpose: build the same tree, evaluate the derivative of the master polynomial at the nodes for the Lagrange denominators, then combine bottom-up.

These are the production replacements for the `O(n²)` Lagrange/Newton of `middle.md` when `n` is large.

---

## 5. Newton Iteration: Inverse, Log, Exp, Sqrt (Survey)

Newton's method solves `f(g) = 0` for a power series `g` by iterating `g ← g − f(g)/f'(g)`, **doubling the number of correct coefficients each step**. Starting from a correct constant term and working modulo `x^1, x^2, x^4, …, x^n`, the total cost is dominated by the last (largest) step, giving `O(n log n)` overall — a geometric series of NTT-multiply costs.

### 5.1 Series inverse — `B(x)` with `B·B^{-1} ≡ 1 (mod x^n)`

Requires `B(0) ≠ 0` (invertible constant term). Newton step doubling precision from `x^t` to `x^{2t}`:

```
g_{2t} = g_t · (2 − B · g_t)  (mod x^{2t})
```

Start `g_1 = B[0]^{-1}`. This is the kernel for fast division (Section 4.1).

### 5.2 Logarithm — `log B(x) (mod x^n)`, requires `B(0) = 1`

Use `log B = ∫ (B' / B) dx`. Compute the derivative `B'`, multiply by the series inverse `B^{-1}`, then formally integrate (dividing coefficient `i−1` by `i`). One inverse + one multiply + `O(n)` integrate = `O(n log n)`. The integral needs `i` to be invertible mod `p`, so `p > n` is required.

### 5.3 Exponential — `exp B(x) (mod x^n)`, requires `B(0) = 0`

Newton on `f(g) = log g − B`:

```
g_{2t} = g_t · (1 + B − log g_t)  (mod x^{2t})
```

Start `g_1 = 1`. Each step computes a `log` (itself an inverse + multiply), so `exp` is the most expensive of the four but still `O(n log n)`. Generating-function applications (e.g. EGF of set partitions, labeled structures) lean heavily on `exp`.

### 5.4 Square root — `sqrt B(x) (mod x^n)`, requires `B(0)` a quadratic residue

Newton on `f(g) = g² − B`:

```
g_{2t} = (g_t + B · g_t^{-1}) / 2  (mod x^{2t})
```

Start `g_1` = a modular square root of `B[0]` (via Tonelli-Shanks, related to sibling `13-primitive-root-discrete-root`). Needs the inverse of `2 mod p` (fine for odd `p`) and `B[0]` to be a QR mod `p`.

### 5.4b Practical engineering of the Newton loop

The mathematics of doubling is clean, but several engineering details decide whether the implementation is fast and correct:

- **Grow precision exactly to `x^n`, not past it.** At the final step, `2t` may overshoot `n`; truncate the inputs and the output to `x^n` so you never NTT a length larger than necessary. Overshooting silently doubles the cost of the most expensive step.
- **Allocate scratch once at full length.** All earlier steps fit inside the final-precision buffers. Sizing buffers to the largest precision and reusing slices avoids per-step allocation and the GC churn it causes in a hot loop.
- **Reuse the cached transform where possible.** In the inverse iteration `g ← g·(2 − B·g)`, the factor `B` is fixed; precomputing its forward transform once (padded to the largest length you will need) saves one NTT per step.
- **Stop early when the constant term suffices.** For `n = 1` the answer is just the modular inverse / square root of the constant term — no iteration. Special-case it to avoid a degenerate loop.
- **Validate the precondition before iterating, not after.** Checking `B(0) ≠ 0` (inverse), `B(0) = 1` (log), `B(0) = 0` (exp), or `B(0)` a QR (sqrt) up front turns a silent garbage result into a clear error.

### 5.5 The doubling invariant and convergence

The correctness guarantee (proved in [`professional.md`](./professional.md)): if `g_t ≡ true (mod x^t)`, the Newton step produces `g_{2t} ≡ true (mod x^{2t})` — the error, which is divisible by `x^t`, gets squared and so becomes divisible by `x^{2t}`. This quadratic convergence in the `x`-adic valuation is why `log₂ n` steps suffice, and why each step only needs to work modulo twice the previous precision (so the early steps are cheap and the cost telescopes to that of the final full-length multiply).

---

## 5.6 Applications: generating functions and combinatorics

The power-series operations exist because they answer real counting and modeling questions, almost all of which reduce to **generating functions** — encoding a sequence `a_0, a_1, a_2, …` as the coefficients of a power series `A(x) = Σ a_n x^n` and manipulating it algebraically.

- **Product = convolution = combining structures.** If `A(x)` counts objects of one kind by size and `B(x)` counts another, `A(x)·B(x)` counts pairs by total size: `[x^n](A·B) = Σ_{i+j=n} a_i b_j`. This is the entire reason NTT-fast multiply matters in combinatorics — "count the ways to split `n` into one object of each kind" is a single convolution.
- **`1/(1−x)` and series inverse.** The geometric series `1/(1−x) = 1 + x + x² + …` turns "prefix sums" and "choose any number of copies" into a series inverse. More generally `A(x)^{−1}` (Section 5.1) answers "invert a counting recurrence", e.g. recovering the number of compositions from a building-block generating function.
- **`exp` and labeled structures.** The exponential formula says: if `C(x)` is the EGF (exponential generating function) of connected labeled structures, `exp(C(x))` is the EGF of arbitrary (possibly disconnected) collections of them. Set partitions, permutations by cycle type, labeled forests, and many `e^{…}` identities are single `exp` calls (Section 5.3).
- **`log` and inclusion of connected components.** Conversely, `log(F(x))` extracts the connected part from a structure's full EGF — the inverse of the exponential formula.
- **`sqrt` and Catalan-like families.** Generating functions satisfying a quadratic (e.g. the Catalan GF `C(x) = (1 − sqrt(1 − 4x))/(2x)`) are computed with the series square root (Section 5.4); sibling `25-catalan-numbers` is the canonical example.
- **NTT convolution at scale.** Counting problems where `n` reaches `10^5`–`10^6` (subset-sum-by-count, polynomial-multiplication-of-histograms, fast subset convolution building blocks) are infeasible with `O(n²)` and routine with NTT. The senior skill is recognizing the convolution hiding inside a counting recurrence and reaching for the right power-series primitive.

The throughline: every operation in Section 5 is a tool for *manipulating an entire infinite sequence at once* via its generating function, and the cost of doing so is the cost of the underlying NTT multiply.

---

## 6. Memory and Layout

- **Flat contiguous arrays** (`int64[]` / `[]int64` / list) indexed by power; avoid arrays-of-arrays for the coefficient vector.
- **Power-of-two padding for NTT**: round up to the next `2^k ≥ deg sum + 1`. Reuse scratch buffers of that size across calls to dodge per-call allocation and GC churn.
- **In-place NTT**: the butterfly transform runs in place; only the inverse-transform scaling needs the modular inverse of the length.
- **Truncate aggressively**: series operations work modulo `x^n` — never carry coefficients beyond `n`, or you waste an NTT length doubling.
- **Memory budget**: a length-`2^k` `int64` buffer is `8·2^k` bytes — 64 MB at `2^23`. Newton iteration needs a few such scratch buffers; preallocate them sized to the final precision, not per-step.
- **CRT path**: if recombining across `m` primes, you hold `m` residue arrays; stream the CRT reconstruction coefficient-by-coefficient rather than materializing all big integers at once.
- **Bit-reversal table reuse**: the in-place NTT permutes indices in bit-reversed order. Precompute the bit-reversal permutation once per transform length and reuse it across all transforms of that length, rather than recomputing per call.
- **Avoid arrays-of-arrays for the subproduct tree**: store tree nodes in a flat structure (or a contiguous arena) so the recursive multiply/remainder passes stay cache-friendly; pointer-chasing per node is a measurable slowdown at large `n`.

### 6.1 A worked memory budget

Suppose you multiply two degree-`5·10^5` polynomials mod `998244353`. The padded length is the next power of two `≥ 10^6 + 1`, i.e. `2^20 ≈ 1.05·10^6`. Each `int64` buffer is `8·2^20 ≈ 8.4 MB`. The NTT needs the two operand buffers plus a scratch (twiddle/transform) buffer, so plan for `~3–4` such buffers, roughly `25–34 MB`. If you also run a multi-prime CRT across three primes, triple the residue storage (`~25 MB`) plus a small reconstruction buffer. The lesson: at these sizes memory is dominated by a handful of length-`2^k` `int64` arrays — preallocate them, reuse them, and never allocate inside the Newton or tree recursion.

---

## 6.5 The CRT pipeline for exact integer products

When the answer is an exact integer (not "mod `p`") and its coefficients can exceed a single NTT-friendly prime's range, the standard production technique is a **multi-prime + CRT** pipeline:

1. Pick several NTT-friendly primes `p_1, p_2, p_3` (e.g. `998244353`, `985661441`, `754974721`), each `≈ 2^30`, so their product exceeds the maximum possible coefficient.
2. Run the *same* NTT multiplication independently under each prime, getting residue vectors `r^{(1)}, r^{(2)}, r^{(3)}`.
3. For each coefficient index `k`, reconstruct the true value from `(r^{(1)}_k, r^{(2)}_k, r^{(3)}_k)` via the Chinese Remainder Theorem (sibling `06-crt`), or Garner's algorithm (sibling `17-garner-algorithm`) which reconstructs in mixed-radix form without big-integer division.

```
coeff mod p_1 ─┐
coeff mod p_2 ─┼─ CRT / Garner ─→ exact coeff (mod p_1·p_2·p_3)
coeff mod p_3 ─┘
```

How many primes? Convolving two length-`n` arrays of magnitude `< M` yields coefficients `< n·M²`. Choose `m` primes with `Π p_i > n·M²`; with `≈ 2^30` primes that is `m = ceil(log2(n·M²) / 30)`. The three runs are embarrassingly parallel — each prime is an independent NTT job — and only the final coefficient-wise CRT joins them. This is exactly how big-integer multiplication libraries and exact polynomial-product solvers avoid the `2^53` precision ceiling of numeric FFT.

## 6.6 The operation-reduction map

A senior mental model worth internalizing: **everything is NTT plus glue.** The dependency chain is:

```
NTT multiply  ──►  series inverse (Newton)  ──►  division (reverse + inverse)
      │                    │
      │                    └──►  log (= ∫ B'/B)  ──►  exp (Newton on log)  ──►  sqrt (Newton)
      │
      └──►  subproduct tree  ──►  multipoint evaluation  ──►  fast interpolation
                                          │
                                          └──►  Half-GCD (fast polynomial GCD)
```

When you optimize the multiply primitive, the entire tree above gets faster automatically — which is why "make multiply fast" (i.e. NTT) is the single highest-leverage decision in a polynomial library. Conversely, when something is slow, profile the multiply first: it is almost always the dominant cost in every box.

---

## 7. Code Examples

### 7.1 Series inverse mod x^n via Newton (Python, schoolbook multiply for clarity)

```python
MOD = 998244353


def modinv(a):
    return pow(a, MOD - 2, MOD)


def mul_trunc(a, b, n):
    """(a*b) mod x^n, schoolbook; swap for NTT at large n."""
    r = [0] * n
    for i in range(min(len(a), n)):
        if a[i]:
            for j in range(min(len(b), n - i)):
                r[i + j] = (r[i + j] + a[i] * b[j]) % MOD
    return r


def series_inverse(b, n):
    """g with b*g ≡ 1 (mod x^n); requires b[0] != 0."""
    assert b[0] % MOD != 0, "constant term must be invertible"
    g = [modinv(b[0])]
    t = 1
    while t < n:
        t *= 2
        # g = g*(2 - b*g) mod x^t
        bg = mul_trunc(b[:t], g, t)
        two_minus = [(-x) % MOD for x in bg]
        two_minus[0] = (two_minus[0] + 2) % MOD
        g = mul_trunc(g, two_minus, t)
    return g[:n]


if __name__ == "__main__":
    # inverse of (1 - x) is 1 + x + x^2 + ... mod x^5
    b = [1, MOD - 1]            # 1 - x
    print(series_inverse(b, 5))  # [1, 1, 1, 1, 1]
```

### 7.2 Series log mod x^n (Go, schoolbook for clarity)

```go
package main

import "fmt"

const MOD = 998244353

func power(a, e int64) int64 {
	a %= MOD
	var r int64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		e >>= 1
	}
	return r
}
func modinv(a int64) int64 { return power(a, MOD-2) }

func mulTrunc(a, b []int64, n int) []int64 {
	r := make([]int64, n)
	for i := 0; i < len(a) && i < n; i++ {
		if a[i] == 0 {
			continue
		}
		for j := 0; j < len(b) && i+j < n; j++ {
			r[i+j] = (r[i+j] + a[i]*b[j]) % MOD
		}
	}
	return r
}

func seriesInverse(b []int64, n int) []int64 {
	g := []int64{modinv(b[0])}
	for t := 1; t < n; {
		t *= 2
		bg := mulTrunc(b, g, t)
		tm := make([]int64, t)
		for i := range bg {
			tm[i] = (MOD - bg[i]) % MOD
		}
		tm[0] = (tm[0] + 2) % MOD
		g = mulTrunc(g, tm, t)
	}
	return g[:n]
}

// seriesLog: log B mod x^n, requires B[0]==1. log B = ∫ B'/B.
func seriesLog(b []int64, n int) []int64 {
	deriv := make([]int64, n)
	for i := 1; i < len(b) && i < n; i++ {
		deriv[i-1] = int64(i) % MOD * b[i] % MOD
	}
	inv := seriesInverse(b, n)
	q := mulTrunc(deriv, inv, n) // B'/B
	res := make([]int64, n)
	for i := 0; i+1 < n; i++ {
		res[i+1] = q[i] * modinv(int64(i+1)) % MOD // integrate
	}
	return res
}

func main() {
	// B = 1 - x ; log(1-x) = -x - x^2/2 - x^3/3 - ...
	b := []int64{1, MOD - 1}
	fmt.Println(seriesLog(b, 5))
}
```

### 7.3 Reverse-and-invert fast division skeleton (Java, schoolbook multiply)

```java
import java.util.*;

public class FastDivide {
    static final long MOD = 998244353L;

    static long power(long a, long e) {
        a %= MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        return r;
    }
    static long modinv(long a) { return power(a, MOD - 2); }

    static long[] mulTrunc(long[] a, long[] b, int n) {
        long[] r = new long[n];
        for (int i = 0; i < a.length && i < n; i++) {
            if (a[i] == 0) continue;
            for (int j = 0; j < b.length && i + j < n; j++)
                r[i + j] = (r[i + j] + a[i] * b[j]) % MOD;
        }
        return r;
    }

    static long[] seriesInverse(long[] b, int n) {
        long[] g = {modinv(b[0])};
        for (int t = 1; t < n; ) {
            t *= 2;
            long[] bg = mulTrunc(b, g, t);
            long[] tm = new long[t];
            for (int i = 0; i < bg.length; i++) tm[i] = (MOD - bg[i]) % MOD;
            tm[0] = (tm[0] + 2) % MOD;
            g = mulTrunc(g, tm, t);
        }
        return Arrays.copyOf(g, n);
    }

    static long[] rev(long[] p) {
        long[] r = new long[p.length];
        for (int i = 0; i < p.length; i++) r[i] = p[p.length - 1 - i];
        return r;
    }

    // quotient of A / B using reversed-series inverse; O(n log n) with NTT mul.
    static long[] quotient(long[] a, long[] b) {
        int dq = a.length - b.length;        // degree of quotient
        if (dq < 0) return new long[]{0};
        long[] ra = rev(a), rb = rev(b);
        long[] rbInv = seriesInverse(rb, dq + 1);
        long[] rq = mulTrunc(ra, rbInv, dq + 1);
        return rev(Arrays.copyOf(rq, dq + 1));
    }

    public static void main(String[] args) {
        // (x^3 + 1) / (x + 1) = x^2 - x + 1
        long[] A = {1, 0, 0, 1};
        long[] B = {1, 1};
        System.out.println(Arrays.toString(quotient(A, B))); // [1, MOD-1, 1]
    }
}
```

---

## 8. Observability and Testing

A coefficient vector is opaque — one wrong residue looks like any other number. Build checks in from day one.

| Check | Why |
|-------|-----|
| Schoolbook oracle for multiply/divide | Compare NTT-multiply against `O(n²)` on small `n`; catches transform/scaling bugs. |
| Round-trip: `A · A^{-1} ≡ 1 (mod x^n)` | Validates series inverse. |
| Round-trip: `exp(log A) ≡ A`, `sqrt(A)² ≡ A` | Validates log/exp/sqrt against each other. |
| Division identity `A == B·Q + R`, `deg R < deg B` | Validates fast division. |
| Interpolation re-evaluation | The recovered polynomial must hit every input `(x_i, y_i)`. |
| Degree sanity | `deg(P·Q) == deg P + deg Q`; a mismatch signals truncation/padding bugs. |
| Cross-language determinism | Same prime, same inputs → identical residue vectors in Go/Java/Python. |
| Linearity spot-check | `(A + B)·C == A·C + B·C` over random inputs; catches accumulation bugs. |
| Transform round-trip | `inverse-NTT(forward-NTT(A)) == A`; isolates transform bugs from multiply bugs. |
| Multi-prime agreement | Each prime's residue vector equals the true product reduced mod that prime; a single disagreeing prime localizes the failing NTT. |

The most valuable single test is the **schoolbook oracle**: a brute-force `O(n²)` multiply (and `O(n²)` division) that you run on random small polynomials and diff coefficient-by-coefficient against the fast path. It catches the dominant bug classes: wrong NTT length, missing inverse-transform scaling, off-by-one in degree, and forgotten reductions. Run it on a few hundred random instances with `n ≤ 64` on every CI build; it is cheap and catches almost everything before it reaches production scale, where the same bug would only manifest as one wrong residue in a million-coefficient vector that no human can eyeball.

### 8.0 A debugging checklist for a wrong coefficient

When a result is wrong, walk this list in order — it resolves the vast majority of incidents quickly:

1. **All coefficients off by a constant factor of `N`?** → missing inverse-transform scaling (`N^{−1}`).
2. **Result correct on small `n` but wrong at large `n`?** → numeric FFT precision overflow (`n·M² > 2^53`); switch to NTT or multi-prime.
3. **Garbage everywhere?** → non-power-of-two NTT length, or a non-NTT-friendly prime with no suitable root of unity.
4. **One trailing coefficient wrong, degree off by one?** → product length should be `len(A)+len(B)−1`; check padding/truncation.
5. **Crash or all-zero in a series op?** → constant-term precondition violated (inverse `≠0`, exp `=0`, log `=1`, sqrt QR).
6. **Negative residues in output?** → forgot to normalize `(a − b) mod p` non-negative (Go/Java).
7. **`gcd`/interpolation produces nonsense over a composite modulus?** → modulus is not prime; inverses do not exist.

### 8.1 Property-test battery

```text
for random A, B over F_p, random n:
    assert ntt_mul(A, B) == schoolbook_mul(A, B)
    assert mul_trunc(A, series_inverse(A, n), n) == [1, 0, ..., 0]   # A[0] != 0
    assert exp(log(A, n), n) == A_truncated                          # A[0] == 1
    assert mul_trunc(sqrt(A,n), sqrt(A,n), n) == A_truncated         # A[0] a QR
    Q, R = divmod(A, B); assert add(mul(B, Q), R) == A and deg(R) < deg(B)
```

---

## 9. Failure Modes

### 9.1 Wrong prime for NTT
Using `10^9+7` (which is **not** of the form `c·2^k+1` with large `k`) for an NTT silently fails — there is no large power-of-two root of unity. Use `998244353` (or another NTT-friendly prime). Mitigation: assert the prime supports the required transform length.

### 9.2 Numeric FFT precision overflow
Convolving large coefficients with `double` FFT past `n·M² > 2^53` rounds wrong. Mitigation: bound the precision budget, or switch to NTT + CRT for exact products.

### 9.3 Series operation with the wrong constant term
Inverse needs `A(0) ≠ 0`; `exp` needs `A(0) = 0`; `log` needs `A(0) = 1`; `sqrt` needs `A(0)` a quadratic residue. Violating these gives garbage or a crash. Mitigation: validate `A[0]` up front and document the precondition.

### 9.4 Integral / interpolation over too-small a prime
The formal integral divides by `i+1`; interpolation divides by node differences. If `p ≤ degree` or `p ≤ n`, some divisor is `≡ 0 (mod p)` and has no inverse. Mitigation: ensure `p` exceeds all degrees/indices, or pick a large prime.

### 9.5 Forgotten truncation
Carrying coefficients past `x^n` in a series operation wastes an NTT length doubling and can blow memory. Mitigation: truncate to `x^n` after every step.

### 9.6 Missing inverse-transform scaling
The inverse NTT must multiply by the modular inverse of the length; forgetting it scales the whole result by `n`. Mitigation: oracle test against schoolbook; the all-coefficients-scaled-by-`n` signature is unmistakable.

### 9.7 Non-power-of-two NTT length
The radix-2 NTT needs a length that is a power of two `≥ deg sum + 1`; rounding down or to a non-power-of-two corrupts the transform. Mitigation: always round *up* to the next power of two.

### 9.8 Transform length exceeds the prime's `2^k` capacity
`998244353` supports lengths up to `2^23`. A product needing length `> 2^23` has no primitive root of that order, so the NTT cannot run. Mitigation: split into smaller convolutions and combine, or use a prime supporting a larger power of two, or a CRT of several primes whose combined transform length suffices. Always assert `requiredLength ≤ 2^k` for the chosen prime before transforming.

### 9.9 Reusing a stale cached transform
If you cache `forward-NTT(A)` to reuse across many `B`'s but the cache was computed at a *shorter* padded length than a later product requires, the pointwise multiply silently aliases coefficients (cyclic wraparound). Mitigation: key the cache by padded length, or always pad to the maximum length any query will need.

---

## 10. Summary

- **NTT is the engine.** Large-degree exact convolution mod an NTT-friendly prime (`998244353 = 119·2^23+1`) is `O(n log n)` (sibling `15-ntt`); every higher-level operation reduces to it.
- **Exact vs numeric.** When the problem says "mod `p`", use NTT — exact, no rounding analysis. For exact integer products exceeding one prime, run NTT under several primes and CRT-recombine (`06-crt`/`17-garner-algorithm`). Numeric FFT only when there is no modulus and the `2^53` precision budget provably holds.
- **Fast division** reverses the polynomials and series-inverts the divisor, `O(n log n)`. **Multipoint evaluation** and **interpolation** use a subproduct tree, `O(n log² n)` — the production replacements for `middle.md`'s `O(n²)` Lagrange/Newton.
- **Newton iteration** computes series inverse/log/exp/sqrt mod `x^n` by **precision doubling**: each step squares the error (doubling correct coefficients), so `log₂ n` steps cost `O(n log n)` total. Mind the constant-term preconditions (inverse: `≠0`; exp: `=0`; log: `=1`; sqrt: QR).
- **Memory:** flat power-of-two-padded buffers, in-place NTT, aggressive truncation to `x^n`, preallocated scratch sized to final precision.
- **Testing:** keep a schoolbook oracle and round-trip property tests (`A·A^{-1}≡1`, `exp(log A)≡A`, `B·Q+R≡A`); they catch the dominant bugs — wrong prime, missing scaling, lost truncation, off-by-one degree.

### Decision summary

- **Multiply, deg ≤ few thousand** → schoolbook (simpler, small constant).
- **Multiply, deg large, mod p** → NTT (`15-ntt`).
- **Multiply, exact integer, big coefficients, no modulus** → multi-prime NTT + CRT (or numeric FFT only if precision budget holds).
- **Division / inverse / log / exp / sqrt at scale** → Newton iteration on top of NTT.
- **Many evaluation/interpolation points** → subproduct tree, `O(n log² n)`.
- **Polynomial GCD at scale** → Half-GCD, `O(n log² n)`.
- **Same operand multiplied against many** → cache its forward transform, reuse across products.
- **Transform length needed exceeds the prime's `2^k`** → switch primes, split the convolution, or CRT across primes with larger combined capacity.
- **Combinatorial counting recurrence with large `n`** → recognize the hidden convolution and apply the matching power-series primitive (product, inverse, exp, log, sqrt) on top of NTT.

### Engineering takeaways

- **Optimize the multiply, get everything else for free.** Inverse, division, log, exp, sqrt, multipoint eval, interpolation, and GCD all bottom out in the multiply primitive.
- **Validate by invariants, never by inspection.** Round-trips (`A·A^{-1}≡1`, `exp(log A)≡A`, `B·Q+R≡A`) and the schoolbook oracle are the only practical correctness signals at scale.
- **Preallocate, truncate, reuse.** Memory at scale is a handful of length-`2^k` `int64` buffers; allocating inside the Newton or tree recursion is the common latency regression.
- **Dispatch by degree.** A production library picks schoolbook below a tuned cutoff and NTT above it; do not force one primitive for all sizes.
- **Keep a prime registry.** Store several NTT-friendly primes with their `2^k` capacities and primitive roots, so the CRT pipeline and capacity checks are table lookups, not ad-hoc constants.

Correctness proofs (division-algorithm uniqueness, interpolation uniqueness, GCD correctness, Newton doubling convergence, complexity) are in [`professional.md`](./professional.md). The base arithmetic (representation, schoolbook multiply, Horner) is in [`junior.md`](./junior.md), and division/interpolation/GCD at textbook scale are in [`middle.md`](./middle.md). Foundational siblings: `15-ntt`, `06-crt`, `17-garner-algorithm`, `13-primitive-root-discrete-root`, `07-extended-euclidean-modular-inverse`, and `15-divide-and-conquer/{04-karatsuba,05-fft}`.

References to study further: von zur Gathen & Gerhard, *Modern Computer Algebra* (Newton iteration, fast division, Half-GCD); the NTT and convolution chapters of sibling `15-ntt`; and the analytic-combinatorics view of generating functions (Flajolet-Sedgewick, *Analytic Combinatorics*) for where `exp`/`log`/`sqrt` of series come from.
