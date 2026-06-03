# Fast Fourier Transform (FFT) — Senior Level

> FFT is rarely the bottleneck on a small input — but the moment `n` is large, the coefficients are big, or the result must be exact modulo a prime, every detail (floating-point error growth, FFT-vs-NTT choice, power-of-two padding, NTT-friendly prime selection, cache behaviour, testing against a schoolbook oracle) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Floating-Point Error Bounds](#2-floating-point-error-bounds)
3. [Choosing FFT vs NTT](#3-choosing-fft-vs-ntt)
4. [Padding, Sizes, and Layout](#4-padding-sizes-and-layout)
5. [NTT-Friendly Primes and Multi-Prime CRT](#5-ntt-friendly-primes-and-multi-prime-crt)
6. [Memory and Cache Engineering](#6-memory-and-cache-engineering)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Real-World Case Studies](#9b-real-world-case-studies)
10. [Failure Modes](#9-failure-modes)
11. [Summary](#10-summary)

> **Quick decision matrix.**
> - Exact integer / modular answer required → **NTT** (single prime if `p` > max coeff, else multi-prime + CRT).
> - Modulus is `998244353` or another `c·2^k+1` → NTT directly, no CRT.
> - Real-valued signal, rounding acceptable → **complex FFT** (use `rfft` symmetry).
> - Big coefficients in complex FFT (`n·C² ≳ 10¹⁵`) → split coefficients or switch to NTT.
> - Non-power-of-two / prime length → Bluestein or mixed-radix.
> - Reproducibility across platforms matters → NTT (integer, deterministic).

---

## 1. Introduction

At the senior level the question is no longer "why does FFT compute a convolution" but "what am I actually shipping, and what breaks when I scale it?". FFT shows up in three production guises that look different but share one engine:

1. **Large-operand multiplication** — big-integer libraries (GMP-style), polynomial arithmetic in computer-algebra systems, and cryptographic primitives, where `n` is the number of limbs/digits and exactness is mandatory.
2. **Exact combinatorial convolution** — counting under generating functions, modular answers (`mod 998244353`) in competitive/financial contexts, where any rounding error is a wrong answer.
3. **Signal/image processing** — spectra, filtering, compression, where the inputs are inherently real-valued and small rounding is acceptable.

The same code path serves all three; what differs is the *contract*: exactness (1, 2) versus tolerance (3), and modular (1) versus real (3). Getting the contract wrong — using float FFT where exactness is required, or NTT where a real signal only needs an approximation — is the most common senior-level mistake, and it does not show up on small test cases.

All three reduce to: *pad to a power of two, transform, multiply pointwise, inverse-transform.* The senior-level decisions are: **how to bound the floating-point error** (or eliminate it with NTT), **how to choose and combine NTT primes**, **how to pad without wasting 2×**, **how to make the transform cache-fast**, and **how to verify when the input is too large to brute-force**. This document treats those decisions in production terms. The recurring theme: the algorithm is textbook, but the *numeric and modular contracts* around it — what magnitudes are safe, which prime, how much padding, when to reconstruct via CRT — are where real systems succeed or silently corrupt data.

---

## 2. Floating-Point Error Bounds

Complex FFT uses IEEE-754 `double` (53-bit mantissa, ~15–16 decimal digits). Each butterfly adds rounding; over `log n` levels the error accumulates.

### 2.1 The error model

For an FFT of size `n` with input magnitude bounded by `M`, the standard worst-case bound on the absolute error of any output is roughly:

```
error ≲ c · M · n · log₂(n) · ε        where ε = 2⁻⁵³ ≈ 1.1e-16
```

with a small constant `c` (a few). For a *convolution* (two FFTs, pointwise, one IFFT) the relevant magnitude is the **product magnitude**. If both inputs have coefficients bounded by `C` and length `n`, the output coefficients are bounded by `n·C²`, and the accumulated error must stay below `0.5` to round correctly:

```
worst output ≈ n · C²
error ≈ const · n·C² · log n · ε  <  0.5     ← the safety condition
```

### 2.2 The practical safety rule

Rearranging gives a rule of thumb: complex FFT convolution is safe when

```
n · C² · log₂ n · ε  ≪  0.5
```

Concretely, with `ε ≈ 1.1e-16`, double-precision FFT comfortably handles coefficient products up to roughly `10¹⁵` of total magnitude. For 64-bit-style products (`C ≈ 10⁹`, `C² ≈ 10¹⁸`) plain complex FFT **overflows the precision budget** — you must split coefficients or use NTT.

### 2.2a A worked budget calculation

Suppose `n = 2¹⁸ ≈ 2.6·10⁵` and coefficients `C ≤ 1000` (e.g. digits in base `10³`). Then:

```
n · C² · log₂ n · ε  ≈  2.6e5 · 1e6 · 18 · 1.1e-16  ≈  5.2e-4  ≪  0.5    ✓ safe
```

Now raise the base so `C ≤ 10⁶` (base `10⁶`): `n` shrinks to `~1.3·10⁵`, but `C²` jumps to `10¹²`:

```
n · C² · log₂ n · ε  ≈  1.3e5 · 1e12 · 17 · 1.1e-16  ≈  0.24      ⚠ borderline
```

`0.24` is uncomfortably close to `0.5` — a slightly larger `n` or unlucky rounding could flip a coefficient. The lesson: a *smaller* base (more, smaller coefficients) trades transform length for precision headroom. Tune the base so the budget sits at least an order of magnitude under `0.5`, or move to NTT where the budget is irrelevant.

### 2.3 Coefficient splitting (the "two-FFT trick")

To extend precision, split each coefficient into a high and low part in base `√MOD` (or `2¹⁵`):

```
a = a_hi · B + a_lo
a·b = a_hi·b_hi·B² + (a_hi·b_lo + a_lo·b_hi)·B + a_lo·b_lo
```

Each piece has small magnitude, so the FFTs stay within the error budget. This costs ~3–4 transforms instead of 2 but keeps double precision usable for modular products up to `~10¹⁸`. Beyond that, NTT is cleaner.

### 2.4 Always measure the margin

Never trust the bound blindly — in tests, record the maximum `|x − round(x)|` over all outputs. A healthy FFT keeps it below ~`1e-3`; values creeping toward `0.5` are a warning that precision is about to fail for the next-larger input.

### 2.5 Error in iterated / nested transforms

Some algorithms convolve repeatedly — polynomial division and series `inverse`/`exp`/`log` via Newton iteration, or multipoint evaluation. Each FFT round injects fresh `O(ε)` error, and intermediate magnitudes can grow between rounds. Two consequences:

- The relevant `C` is the **largest intermediate** coefficient, not just the input's — a Newton step can transiently produce larger coefficients than either operand.
- Errors do *not* generally cancel across rounds; budget for the worst single round and verify the *final* round-trip, not just one transform.

For such pipelines NTT is strongly preferred: exact arithmetic removes the need to re-derive a precision budget at every Newton doubling, and guarantees the same answer regardless of how many rounds run.

### 2.6 Long double and quad precision

A stop-gap before splitting or NTT is to use `long double` (80-bit on x86, ~64-bit mantissa) or a software quad type, buying ~3–4 extra decimal digits of headroom. This is a small constant-factor slowdown and is *not* portable (`long double` is 64-bit on some platforms), so treat it as a tactical patch, not a strategy — if you genuinely need exactness, NTT is the principled answer.

---

## 3. Choosing FFT vs NTT

| Criterion | Complex FFT | NTT |
|-----------|-------------|-----|
| Exactness | Approximate (round at end) | **Exact** (mod `p`) |
| Arithmetic | `double` complex | integer mod `p` |
| Determinism across platforms | No (float rounding varies) | **Yes** |
| Answer domain | real/complex | integers mod `p` |
| Big products | needs coefficient splitting | needs `p > result` or multi-prime CRT |
| Typical use | DSP, real signals, "good enough" | competitive programming, crypto, exact big-int |

**Decision tree:**

```
Need exact integers / modular answer?
├── Yes → NTT
│         ├── single prime > max coefficient?  → one NTT
│         └── result exceeds any single prime?  → 2–3 NTTs + CRT
└── No (real signal, rounding OK) → complex FFT
                                    └── product magnitude > ~1e15? → split coefficients
```

Rule of thumb in competitive programming: if the problem says "modulo 998244353", that prime is *deliberately* NTT-friendly — use NTT directly. If it says "modulo 10⁹+7" (not NTT-friendly), use 3 NTT primes + CRT, or complex FFT with coefficient splitting.

### 3.1 The modulus-mismatch trap

A subtle correctness pitfall: you cannot convolve "mod `M`" by simply reducing inputs mod `M` and running an NTT under a *different* prime `p`. The NTT computes the true integer coefficients (then reduces mod its own prime `p`); if you reduced inputs mod `M` first, the true coefficients you recover are already wrong. The correct pipeline is: keep inputs as integers `< M`, run the NTT(s) to recover the **true** integer convolution (via CRT if it exceeds one prime), and reduce mod `M` **only at the very end**. Reducing mod `M` mid-pipeline corrupts the result whenever a true coefficient exceeds `M` — which it almost always does for `n·C²`.

---

## 4. Padding, Sizes, and Layout

### 4.1 Power-of-two padding

Radix-2 Cooley-Tukey requires `n = 2^m`. The product of degree-`d₁` and degree-`d₂` polynomials has degree `d₁ + d₂`, needing `d₁ + d₂ + 1` coefficients. So:

```
n = next_pow2(len(a) + len(b) - 1)
```

The worst case wastes nearly 2× (e.g. `len = 513` rounds to `1024`). Mitigations:

- **Mixed-radix / split-radix FFT** handles sizes with factors of 3, 5 (used by FFTW, cuFFT) to avoid the power-of-two cliff.
- **Bluestein's algorithm** computes a DFT of *arbitrary* length `n` by reducing it to a convolution of a padded power-of-two size — useful when `n` is prime.

For competitive use, power-of-two padding is almost always fine; the 2× constant is dwarfed by the `n²→n log n` win.

### 4.2 Cyclic vs linear convolution

The DFT computes a **cyclic** (circular) convolution of length `n`. To get the **linear** convolution (the true polynomial product), pad so that no wrap-around occurs: `n ≥ len(a) + len(b) − 1`. Under-padding silently aliases high-degree terms back onto low-degree ones — a subtle, hard-to-spot bug.

### 4.3 Real-input layout

For real inputs, the two-reals-in-one-complex-FFT trick and the half-spectrum (`rfft`) layout cut work roughly in half. Libraries expose `rfft`/`irfft`; a hand-rolled version packs `A + iB` and unpacks via conjugate symmetry `Â[n−k] = conj(Â[k])`. For multiplying two *real* integer polynomials, packing both into one complex array `A + iB`, transforming once, and unpacking is a standard ~2× win and is worth the fiddly index arithmetic in hot paths.

### 4.4 Cache-aware decompositions

Beyond a single power-of-two pass, very large FFTs (`n` not fitting in L2/L3) restructure the computation. The **four-step** algorithm factors `n = n₁·n₂`, treats the array as an `n₁×n₂` matrix, FFTs the columns, multiplies by twiddles, transposes, and FFTs the rows — turning one cache-thrashing pass into several cache-resident sub-FFTs. This is the same Cooley-Tukey identity applied at a coarse (matrix) granularity, and is how FFTW and GPU FFTs achieve near-peak bandwidth on multi-million-point transforms. You rarely hand-write this, but recognizing it explains why a library FFT vastly outperforms a textbook one at scale.

---

## 5. NTT-Friendly Primes and Multi-Prime CRT

An NTT of length `n` needs a primitive `n`-th root of unity mod `p`, which exists iff `n | (p − 1)`. **NTT-friendly primes** have `p = c·2^k + 1` with large `k`:

| Prime | Factorization | Max FFT size `2^k` | Primitive root `g` |
|-------|---------------|--------------------|--------------------|
| `998244353` | `119 · 2²³ + 1` | `2²³ ≈ 8.4M` | 3 |
| `985661441` | `235 · 2²² + 1` | `2²²` | 3 |
| `1004535809` | `479 · 2²¹ + 1` | `2²¹` | 3 |
| `2013265921` | `15 · 2²⁷ + 1` | `2²⁷` | 31 |

The `n`-th root is `ω = g^{(p−1)/n} mod p`.

### Multi-prime CRT for arbitrary moduli

To convolve modulo a non-NTT-friendly modulus `M` (e.g. `10⁹+7`), or to recover the true integer when coefficients exceed any single prime:

1. Run the NTT under several NTT-friendly primes `p₁, p₂, p₃`.
2. The true coefficient `x < p₁·p₂·p₃` is reconstructed via the **Chinese Remainder Theorem** from `(x mod p₁, x mod p₂, x mod p₃)`.
3. Reduce the reconstructed integer mod `M` at the end.

Three primes around `10⁹` give a product `> 10²⁷`, enough for coefficients up to `n · C²` for typical `n, C`. Two primes suffice if `n·C² < p₁·p₂`.

### 5.1 How many primes do I need?

Compute the worst-case coefficient bound `B = n · C²` where `C` is the max input coefficient and `n` the transform length. Pick the fewest NTT-friendly primes whose product exceeds `B`:

```
need r primes with  p₁·p₂·…·p_r  >  n · C²
```

For `n = 2²⁰`, `C < 10⁹`: `B ≈ 10⁶ · 10¹⁸ = 10²⁴`. Two `~10⁹` primes give `~10¹⁸` (insufficient); three give `~10²⁷ > 10²⁴` — so **three primes**. If the final answer is itself taken mod some `M`, you still must reconstruct the *true* coefficient first (which can be up to `B`), then reduce — you cannot skip primes just because `M` is small.

### 5.2 Verifying a candidate prime/root pair

Before trusting a hardcoded `(p, g)`: assert `p` is prime, assert `2^k | (p−1)` for your max length, and verify `g` is a primitive root by checking `g^{(p−1)/q} ≢ 1 (mod p)` for every prime factor `q` of `p−1`. Then `ω = g^{(p−1)/n}` must satisfy `ω^{n/2} ≡ −1` and `ω^n ≡ 1`. Bake these checks into a unit test so a typo in the prime is caught immediately rather than producing silently wrong convolutions.

---

## 6. Memory and Cache Engineering

- **In-place transform.** The iterative FFT runs in `O(n)` extra space (the working array). Avoid per-level allocations — they dominate runtime and trash the cache.
- **Precomputed root tables.** Store `ω^0 … ω^{n/2−1}` once. Recomputing `exp`/`pow` inside butterflies is both slow and (for FFT) less accurate than a precomputed table.
- **Bit-reversal cost.** The naive bit-reversal permutation has poor locality (scattered swaps). For very large `n`, cache-oblivious or radix-`r` permutations help; libraries often fuse the permutation into the first pass.
- **Memory bandwidth bound.** Large FFTs are bandwidth-limited, not compute-limited. Split-radix and the four-step / six-step algorithms restructure the access pattern to fit cache — this is what FFTW and cuFFT optimize.
- **SIMD / parallelism.** Butterflies at a given level are independent → vectorize with SIMD and parallelize across blocks. The transform is embarrassingly parallel within a pass.

### 6.1 Capacity planning

Back-of-envelope sizing for a convolution of two length-`m` inputs:

| Quantity | Estimate |
|----------|----------|
| Transform length `n` | `next_pow2(2m − 1)` — up to `~4m` worst case |
| Memory (complex FFT) | `~2 · n · 16` bytes (two `complex128` arrays) |
| Memory (NTT) | `~2 · n · 8` bytes (int64 arrays) |
| Butterfly multiplies | `(n/2) · log₂ n` |
| Wall time (rough) | tens of ns per butterfly → `n log n · const` |

Example: `m = 10⁶` → `n = 2²¹ ≈ 2.1·10⁶`, complex FFT needs `~67 MB` for the two work arrays, `~22·10⁶` butterfly multiplies per transform, ×4 transforms (2 fwd + pointwise + 1 inv) ≈ `10⁸` complex multiplies — sub-second on a modern core. NTT halves the memory and avoids precision concerns.

### 6.2 Profiling hot spots

When an FFT is slower than `n log n` predicts, the usual culprits (profile with the `profiling-techniques` skill) are: per-call allocation of work arrays (fix: reuse buffers), recomputing roots inside butterflies (fix: precompute a table), cache misses in the bit-reversal scatter (fix: fuse into the first pass or use a precomputed reversal table), and modular reductions in NTT (fix: Montgomery or Barrett reduction to replace the `%` with multiplies/shifts). Each of these is a constant-factor win, but together they often account for a 3–5× speedup over a naive implementation.

### 6.3 Montgomery reduction for NTT

The NTT inner loop is dominated by modular multiplies. The naive `a*b % p` uses a hardware division, which is slow. **Montgomery reduction** keeps numbers in a transformed domain where reduction is a multiply, a shift, and a conditional subtract — no division. **Barrett reduction** precomputes `⌊2^k/p⌋` and replaces the division with two multiplies. Either typically doubles NTT throughput. The cost is added complexity (entering/leaving the Montgomery domain), so apply it only in measured hot paths, behind a tested wrapper that round-trips correctly against plain `% p`.

---

## 7. Code Examples

### Example: Production NTT with assertions and a schoolbook oracle (Python), plus Go and Java NTT cores

#### Go

```go
package main

import "fmt"

const (
	MOD = 998244353
	G   = 3
)

func power(a, b, mod int64) int64 {
	res := int64(1)
	a %= mod
	for b > 0 {
		if b&1 == 1 {
			res = res * a % mod
		}
		a = a * a % mod
		b >>= 1
	}
	return res
}

func ntt(a []int64, invert bool) {
	n := len(a)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			a[i], a[j] = a[j], a[i]
		}
	}
	for length := 2; length <= n; length <<= 1 {
		wlen := power(G, (MOD-1)/int64(length), MOD)
		if invert {
			wlen = power(wlen, MOD-2, MOD) // modular inverse of the root
		}
		for i := 0; i < n; i += length {
			w := int64(1)
			for k := 0; k < length/2; k++ {
				u := a[i+k]
				v := a[i+k+length/2] * w % MOD
				a[i+k] = (u + v) % MOD
				a[i+k+length/2] = (u - v + MOD) % MOD
				w = w * wlen % MOD
			}
		}
	}
	if invert {
		nInv := power(int64(n), MOD-2, MOD)
		for i := range a {
			a[i] = a[i] * nInv % MOD
		}
	}
}

func multiply(a, b []int64) []int64 {
	need := len(a) + len(b) - 1
	n := 1
	for n < need {
		n <<= 1
	}
	fa := make([]int64, n)
	fb := make([]int64, n)
	copy(fa, a)
	copy(fb, b)
	ntt(fa, false)
	ntt(fb, false)
	for i := range fa {
		fa[i] = fa[i] * fb[i] % MOD
	}
	ntt(fa, true)
	return fa[:need]
}

func main() {
	fmt.Println(multiply([]int64{1, 2, 3}, []int64{4, 5, 6})) // exact mod p
}
```

#### Java

```java
import java.util.*;

public class NTT {
    static final long MOD = 998244353, G = 3;

    static long power(long a, long b) {
        long r = 1; a %= MOD;
        while (b > 0) { if ((b & 1) == 1) r = r * a % MOD; a = a * a % MOD; b >>= 1; }
        return r;
    }

    static void ntt(long[] a, boolean invert) {
        int n = a.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { long t = a[i]; a[i] = a[j]; a[j] = t; }
        }
        for (int len = 2; len <= n; len <<= 1) {
            long wlen = power(G, (MOD - 1) / len);
            if (invert) wlen = power(wlen, MOD - 2);
            for (int i = 0; i < n; i += len) {
                long w = 1;
                for (int k = 0; k < len / 2; k++) {
                    long u = a[i + k];
                    long v = a[i + k + len / 2] * w % MOD;
                    a[i + k] = (u + v) % MOD;
                    a[i + k + len / 2] = (u - v + MOD) % MOD;
                    w = w * wlen % MOD;
                }
            }
        }
        if (invert) {
            long nInv = power(n, MOD - 2);
            for (int i = 0; i < n; i++) a[i] = a[i] * nInv % MOD;
        }
    }

    static long[] multiply(long[] a, long[] b) {
        int need = a.length + b.length - 1, n = 1;
        while (n < need) n <<= 1;
        long[] fa = Arrays.copyOf(a, n), fb = Arrays.copyOf(b, n);
        ntt(fa, false); ntt(fb, false);
        for (int i = 0; i < n; i++) fa[i] = fa[i] * fb[i] % MOD;
        ntt(fa, true);
        return Arrays.copyOf(fa, need);
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(multiply(new long[]{1,2,3}, new long[]{4,5,6})));
    }
}
```

#### Python

```python
MOD = 998244353
G = 3

def power(a, b, mod=MOD):
    r = 1; a %= mod
    while b:
        if b & 1: r = r * a % mod
        a = a * a % mod; b >>= 1
    return r

def ntt(a, invert=False):
    n = len(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit: j ^= bit; bit >>= 1
        j ^= bit
        if i < j: a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        wlen = power(G, (MOD - 1) // length)
        if invert: wlen = power(wlen, MOD - 2)
        for i in range(0, n, length):
            w = 1
            for k in range(length // 2):
                u = a[i + k]
                v = a[i + k + length // 2] * w % MOD
                a[i + k] = (u + v) % MOD
                a[i + k + length // 2] = (u - v) % MOD
                w = w * wlen % MOD
        length <<= 1
    if invert:
        n_inv = power(n, MOD - 2)
        for i in range(n):
            a[i] = a[i] * n_inv % MOD

def multiply(a, b):
    need = len(a) + len(b) - 1
    n = 1
    while n < need: n <<= 1
    fa = a + [0] * (n - len(a)); fb = b + [0] * (n - len(b))
    ntt(fa); ntt(fb)
    fc = [fa[i] * fb[i] % MOD for i in range(n)]
    ntt(fc, invert=True)
    return fc[:need]

def schoolbook(a, b):                       # exact oracle, O(n^2)
    res = [0] * (len(a) + len(b) - 1)
    for i, av in enumerate(a):
        for j, bv in enumerate(b):
            res[i + j] = (res[i + j] + av * bv) % MOD
    return res

if __name__ == "__main__":
    import random
    for _ in range(1000):                   # differential test vs oracle
        a = [random.randrange(MOD) for _ in range(random.randint(1, 30))]
        b = [random.randrange(MOD) for _ in range(random.randint(1, 30))]
        assert multiply(a, b) == schoolbook(a, b)
    print("all NTT outputs match the schoolbook oracle")
```

**Run:** `go run main.go` | `javac NTT.java && java NTT` | `python ntt.py`

> The Python `main` runs a built-in differential fuzz against the schoolbook oracle. Wire the same loop into CI for the Go/Java cores; a single failing seed printed to the log is worth more than any amount of asymptotic reasoning when a convolution silently goes wrong in production.

---

## 8. Observability and Testing

- **Differential testing against the schoolbook oracle.** On thousands of random small inputs, assert `fft_multiply == schoolbook` (mod `p` for NTT). This catches padding, scaling, and butterfly bugs immediately.
- **Round-trip identity.** `inverseFFT(FFT(a)) == a` (within tolerance for FFT, exactly for NTT) tests the transform alone, isolated from the convolution.
- **Precision telemetry.** For complex FFT, log `max |x − round(x)|` per call. Alert when it exceeds, say, `0.1` — that's the early warning before a wrong rounding.
- **Property tests.** Convolution is commutative (`A*B == B*A`), associative, and bilinear; multiplying by `[1]` is identity; by `[0,…,1,…]` is a shift. Assert these (see sibling testing skills).
- **Known answers.** `[1,1]^∗k` gives binomial coefficients (row `k` of Pascal's triangle) — a cheap exact check.
- **Adversarial sizes.** Test at `n = 2^k` exactly *and* at `n = 2^k + 1` (forces padding to the next power), with maximal coefficients, to surface aliasing and precision-ceiling bugs that pass on benign inputs.
- **Cross-implementation diff.** Run the complex FFT and the NTT on the same integer inputs; they must agree (NTT reduced to integers). A divergence localizes the bug to one transform.

---

## 9. Failure Modes

| Failure | Symptom | Root cause | Mitigation |
|---------|---------|------------|------------|
| Wrap-around (aliasing) | High-degree coeffs wrong / fold onto low ones | Under-padded; got cyclic convolution | Pad to `≥ len(a)+len(b)−1`, then power-of-two. |
| Precision loss | A few coeffs off by ±1 after rounding | `n·C²` exceeds double's budget | Split coefficients or switch to NTT. |
| Scaling error | All coeffs `n×` too big/small | Inverse `1/n` applied wrong number of times | Scale exactly once. |
| NTT size error | Garbage output | `n ∤ (p−1)`; no root of that order | Use NTT-friendly prime; assert `n | (p−1)`. |
| Wrong modulus answer | Correct mod 998244353 but problem wants 10⁹+7 | Non-NTT-friendly target modulus | Multi-prime NTT + CRT, or coefficient-split FFT. |
| Negative coefficients | Out-of-range values | Missing `+MOD` after subtraction | `(u − v + MOD) % MOD`. |
| Stack overflow | Crash on huge input | Recursive FFT depth | Use iterative in-place FFT. |
| Slow despite `n log n` | High constant, GC churn | Per-level allocations, no root table | Precompute roots, reuse buffers, in-place. |
| Off-by-one output length | Trailing/missing coefficient | Result length must be `len(a)+len(b)−1` | Slice the padded array back to `need`. |
| Nondeterministic results | Same input, different float output across runs/platforms | `double` rounding order differs (parallel/SIMD) | Use NTT for reproducibility, or fix the reduction order. |

---

## 9b. Real-World Case Studies

**GMP / big-number libraries.** GNU MP multiplies multi-thousand-digit integers by graduating through schoolbook → Karatsuba → Toom-3/Toom-4 → FFT (Schönhage–Strassen) as operand size grows, with thresholds tuned per CPU. The FFT path uses NTT-style modular transforms to stay exact; the carry-propagation pass after convolution is fused for cache locality. Lesson: there is no single best multiplier — the right one depends on size, and FFT only earns its keep past a (large) threshold.

**Competitive programming.** Problems stating "modulo 998244353" are signalling NTT: the modulus is `119·2²³+1`, supporting transforms up to `2²³`. A typical solution convolves two polynomials of degree `~10⁵` in well under a second. When the modulus is `10⁹+7` (not NTT-friendly), the idiomatic fix is a triple-prime NTT plus CRT, or arbitrary-modulus NTT with coefficient splitting — both standard library snippets.

**Audio/DSP pipelines.** Real-time filters convolve a streaming signal with a fixed kernel using overlap-add: the kernel's FFT is precomputed once, each input block is transformed, multiplied, and inverse-transformed, with block tails added. Here `double` precision is more than adequate (audio is ~16–24 bits), so complex FFT is the right tool and NTT would be overkill. Lesson: match the transform to the exactness requirement — exact/modular → NTT, approximate real signals → complex FFT.

**Cryptography.** Lattice-based schemes (e.g. Kyber, Dilithium) perform polynomial multiplication in `ℤ_q[x]/(x^n+1)` using a **negacyclic NTT** with carefully chosen `q` and roots. The transform is the performance-critical inner loop, hand-vectorized with AVX2/NEON and Montgomery reduction. Lesson: at the extreme, the FFT/NTT *is* the hot path and every constant-factor optimization (reduction scheme, memory layout, SIMD width) matters.

---

## 10. Summary

### Pre-ship checklist

- [ ] Padded to `next_pow2(len(a)+len(b)−1)` — no aliasing.
- [ ] Inverse `1/n` (or `n⁻¹ mod p`) applied exactly once.
- [ ] Precision budget `n·C²·log n·ε < 0.5` verified, or NTT chosen.
- [ ] NTT prime/root pair asserted (`n | p−1`, `g` primitive, `ω^{n/2} ≡ −1`).
- [ ] Output sliced to `len(a)+len(b)−1`.
- [ ] Differential test vs schoolbook oracle + round-trip identity passing.
- [ ] Work buffers reused, roots precomputed (no per-call allocation in hot paths).
- [ ] For arbitrary modulus `M`: recover true coefficient (CRT) *then* reduce mod `M`.

Senior FFT work is about *guaranteeing correctness at scale*. The core engine — pad, transform, pointwise multiply, inverse-transform — never changes, but the production decisions do: **bound the floating-point error** (`~ n·C²·log n·ε < 0.5`) and split coefficients or move to NTT when it's exceeded; **choose FFT vs NTT** by whether exact/modular results are required; **pad to a power of two `≥ len(a)+len(b)−1`** to avoid cyclic-convolution aliasing; pick **NTT-friendly primes** (`998244353 = 119·2²³+1`, `g=3`) and combine **multiple primes via CRT** for arbitrary moduli; and engineer the transform **in place with precomputed roots** for cache efficiency. Above all, **test differentially against a schoolbook oracle** and a round-trip identity — they catch the padding, scaling, and butterfly bugs that the asymptotics hide.
