# Number-Theoretic Transform (NTT) — Senior Level

> NTT is rarely the bottleneck on a one-off multiply — but the moment you run it on `2^{20}`-sized arrays in a hot loop, need exact convolution for a hostile non-friendly modulus, or must keep every butterfly's modular multiply inside 64 bits, every detail (prime choice, padding, the CRT-vs-split decision, Montgomery reduction, root-table precomputation, and the failure modes that produce silent wrong answers) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Choosing NTT Primes](#2-choosing-ntt-primes)
3. [Padding, Lengths, and the 2-adic Ceiling](#3-padding-lengths-and-the-2-adic-ceiling)
4. [Multi-Mod CRT vs Coefficient Splitting](#4-multi-mod-crt-vs-coefficient-splitting)
5. [Montgomery / Barrett Reduction in the Butterfly](#5-montgomery--barrett-reduction-in-the-butterfly)
6. [Root Tables, Memory, and Cache](#6-root-tables-memory-and-cache)
7. [Code Examples](#7-code-examples)
8. [Testing and Observability](#8-testing-and-observability)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is NTT" but "what am I actually convolving, under what modulus, at what size, and what breaks when I scale it?". NTT shows up in three guises that share one engine:

1. **Exact convolution mod a friendly prime** — the answer is wanted mod `998244353` (competitive problems, FFT-friendly designs). One transform set, no CRT.
2. **Exact convolution mod an arbitrary modulus** — the answer is wanted mod `10^9 + 7`, mod `2^{32}`, or some problem-chosen composite. Requires multiple NTT primes + CRT (sibling `05-crt`, `15-garner-algorithm`) or complex-FFT coefficient splitting.
3. **Big-integer multiplication / counting / string matching** — the convolution is an internal step of a larger algorithm and must be fast and reproducible.

All three reduce to: *pad to a power of two, forward-transform, pointwise-multiply, inverse-transform, scale by `n^{-1}`* — but the senior decisions are which prime(s), how to keep the butterfly's modular arithmetic cheap and correct, when CRT beats splitting, and how to verify a result you cannot eyeball. This document treats those in production terms. The butterfly itself is shared with `15-divide-and-conquer/05-fft`; we focus on the number-theory and systems layer.

---

## 2. Choosing NTT Primes

### 2.1 What "NTT-friendly" buys you

A prime `p = c · 2^k + 1` guarantees `2^k | p − 1`, so `Z/pZ*` (cyclic of order `p − 1`) contains an element of order exactly `2^k` — a primitive `2^k`-th root of unity. That element drives transforms of any length `2^m` with `m ≤ k`. The **2-adic valuation** `k` is therefore the single most important property of an NTT prime: it caps the transform size at `2^k`.

### 2.2 Selection criteria

| Criterion | Why it matters |
|-----------|----------------|
| Large `2^k` | Caps max transform length; pick `k ≥ log2(max n)`. |
| `p < 2^31` (ideally) | Lets `a*b` for two residues stay `< 2^62`, inside signed `int64`, so the butterfly needs no 128-bit math. |
| Known primitive root `g` | Avoids computing it at runtime (sibling `12-primitive-root-discrete-root`). |
| Coprimality across the CRT set | Required for CRT reconstruction. Distinct primes are automatically coprime. |
| Combined product `Πp_r > n·M²` | Ensures CRT recovers the true coefficient (Section 4). |

The canonical single prime is `998244353` (`119·2^23+1`, `g=3`, supports `n ≤ 2^23 ≈ 8.4M`). When `n > 2^23`, switch to a higher-valuation prime such as `469762049` (`7·2^26+1`, `n ≤ 2^26`) or `2013265921` (`15·2^27+1`, `n ≤ 2^27`, but `> 2^30` so products need care).

### 2.4 A concrete prime-selection walkthrough

Suppose you must convolve two arrays of length `2·10^6` with coefficients up to `10^9`, answer mod `10^9+7`.

1. **Padded size.** `n = nextPow2(4·10^6 − 1) = 2^{22}`. So every chosen prime needs `2^k ≥ 2^{22}`, i.e. `k ≥ 22`.
2. **Friendly?** `10^9+7` has `v_2 = 1` — not friendly. Multi-prime + CRT required.
3. **Coefficient bound.** `max c[k] < n·B² = 2^{22}·(10^9)² ≈ 4.2·10^{24}`.
4. **Prime count.** Need `Πp_r > 4.2·10^{24}`. Three near-`10^9` primes give `≈ 9.6·10^{26}` — enough. Two (`≈ 9.8·10^{17}`) fail.
5. **Which three?** `998244353` (`2^23`), `985661441` (`2^22`), `469762049` (`2^26`) — all `≥ 2^{22}`, all `g=3`. 

Result: three transforms per input, CRT per coefficient via Garner, reduce mod `10^9+7`. Every decision is forced by an inequality, not taste — which is the senior discipline: compute the prime count, do not guess it.

### 2.3 The 64-bit product budget

For the inner butterfly `v = a[..] * w % p`, both operands are `< p`. If `p < 2^31`, the product is `< 2^62` — safe in `int64`. If you choose a prime `> 2^31` (like `2013265921 ≈ 2^31`), the product can approach `2^62`, still fine, but two such products added (`u + v`) can exceed `2^62`; keep reductions tight or use unsigned 64-bit. Primes `> 2^32` force 128-bit or Montgomery on 64-bit words — a real slowdown. The standard advice: stay with three sub-`10^9` primes and CRT rather than one giant prime.

---

## 3. Padding, Lengths, and the 2-adic Ceiling

### 3.1 Pad to a power of two ≥ result length

The transform computes a **cyclic** convolution of period `n`. To recover the linear product (degree `len(a)+len(b)−2`, hence `len(a)+len(b)−1` coefficients), pad so `n ≥ len(a)+len(b)−1`. Choosing `n` a power of two also satisfies the butterfly's structure. Under-padding causes wraparound: high coefficients fold back onto low ones with no crash — the classic silent NTT bug.

### 3.2 The 2-adic ceiling

`998244353` supports `n` only up to `2^23`. If `len(a)+len(b)−1 > 2^23` you must either pick a prime with larger `k` (e.g. `469762049` at `2^26`) or split the inputs into blocks and convolve block-wise. Always assert `n ≤ 2^k` for the chosen prime; a transform requesting a `2^{k+1}`-th root computes `g^{(p-1)/2^{k+1}}`, which is not an integer exponent — `(p-1)/n` is not an integer, the root has the wrong order, and the result is garbage.

### 3.3 Trimming and normalization

The true result has exactly `len(a)+len(b)−1` coefficients; trim the padded tail. Reduce inputs mod `p` (or mod each CRT prime) *before* transforming — un-reduced large or negative coefficients corrupt the transform. Normalize negatives with `((x % p) + p) % p`.

---

## 4. Multi-Mod CRT vs Coefficient Splitting

When the target modulus `M` is not NTT-friendly, two families solve exact convolution mod `M`:

### 4.1 Multi-prime NTT + CRT (the number-theory route)

Run the convolution under `r` NTT-friendly primes, CRT-combine each output to the exact integer, reduce by `M`.

- **Primes needed:** `Πp_r > max_k c[k] = n · max|a| · max|b|`. For `M ≈ 10^9` and `n ≤ 10^5`, `max c[k] < 10^{23}`; three ~`10^9` primes give `> 10^{27}`. Two primes suffice only for small `n` or small coefficients.
- **Pros:** integer-only, deterministic, reproducible across machines; embarrassingly parallel across primes; no rounding.
- **Cons:** 3× the transforms; CRT product overflows 64-bit, so use Garner's incremental form (`15-garner-algorithm`) or 128-bit.

### 4.2 Complex-FFT coefficient splitting (the analysis route)

Split each coefficient into high/low 15-bit halves `a = a1·2^{15} + a0`, do 3–4 real FFTs, recombine. Lives on the FFT side (`15-divide-and-conquer/05-fft`).

- **Pros:** reuses a complex-FFT toolchain; sometimes fewer transforms (the "3-multiplication trick").
- **Cons:** floating point → rounding risk for large coefficients/`n`; needs careful error analysis; nondeterministic across FP implementations.

### 4.3 Decision

| Situation | Prefer |
|-----------|--------|
| Modulus is NTT-friendly | Single NTT — no CRT, no splitting. |
| Arbitrary `M`, exactness mandatory, integer pipeline | 3-prime NTT + CRT (Garner). |
| Arbitrary `M`, existing complex-FFT code, coefficients modest | FFT splitting. |
| Reproducibility / cross-platform determinism required | NTT + CRT (no FP). |
| `n` exceeds a single prime's `2^k` | Higher-valuation prime, or block convolution. |

The senior default for *exact arbitrary-modulus* work is **3-prime NTT + CRT**, because integer arithmetic removes the entire class of rounding bugs that haunt FFT-splitting at scale.

### 4.4 The CRT bound, derived

Each output coefficient is `c[k] = Σ_{i+j=k} a[i] b[j]`, a sum of at most `min(k+1, n)` products. With `|a[i]|, |b[j]| < B`, `|c[k]| < n·B²`. Reconstruct exactly iff the CRT modulus `Πp_r` exceeds `n·B²` (and, if signed coefficients are possible, `2·n·B²` to represent the symmetric range). Compute this bound at runtime and assert it; choosing too few primes is the most insidious CRT failure because small test cases pass while large ones silently wrap.

---

## 5. Montgomery / Barrett Reduction in the Butterfly

The inner butterfly executes `a[..] * w % p` once per element per stage — `n log n` modular multiplications dominate the runtime. The `%` (integer division) is the expensive instruction.

- **Barrett reduction:** precompute `μ = floor(2^{2L}/p)`; replace division by two multiplications and shifts. Good general-purpose speedup.
- **Montgomery reduction (sibling `14-montgomery-multiplication`):** keep all residues in Montgomery form `a·R mod p` (`R = 2^{32}` or `2^{64}`); the product reduction is a multiply-add-shift with no division. Convert in/out of Montgomery form once at the boundaries. This is the standard high-performance NTT inner loop.

For a single small multiply, the naive `%` is fine. For repeated large transforms (polynomial inverse, multipoint evaluation, big-int multiply loops), Montgomery in the butterfly is a 2–3× win. Keep a tested naive version as the oracle.

### 5.1 Montgomery boundary discipline

The pitfall with Montgomery NTT is mixing forms. Residues live in **Montgomery form** `ā = a·R mod p` throughout the transform; convert in once before the forward NTT (`a ↦ a·R`) and out once after the inverse NTT (`ā ↦ ā·R^{-1}`). The twiddles must also be in Montgomery form, and the `n^{-1}` scale too. A single value left in normal form silently corrupts every butterfly it touches — and because the output is still "a number mod `p`", there is no crash. Mitigation: encapsulate `toMont`, `fromMont`, and `montMul` so the form is a type-level invariant, and validate the whole transform against the naive `%` version before trusting it. The conversion cost is `O(n)` at each boundary, negligible against the `O(n log n)` transform.

### 5.2 When reduction is not the bottleneck

Profile before optimizing the reduction. For small `n` (say `n ≤ 2^{12}`), the transform is memory-bandwidth- and branch-bound, not division-bound, and Montgomery's setup may not pay off. The reduction strategy matters most for `n ≥ 2^{16}` repeated many times; for a one-shot small multiply, the naive `%` keeps the code simple and the bug surface minimal. The senior move is to measure the actual hot path, not to reflexively reach for Montgomery.

---

## 6. Root Tables, Memory, and Cache

### 6.1 Precompute the stage roots

Calling `power(g, (p-1)/len)` inside each stage recomputes a modular exponentiation `log n` times. Precompute, once per size, the table of stage roots `wlen[s]` (and their inverses), or better the full twiddle table `w[0..n/2)` for the largest size you will use, and index into it. This removes `O(log² n)` exponentiations and is the easiest large constant-factor win.

### 6.2 Flat, contiguous arrays

Store coefficients in a single flat `int64` slice/array, not arrays-of-arrays. The butterfly's stride pattern is cache-sensitive; contiguous storage and the natural in-place layout keep the working set tight. For `n = 2^{20}`, an `int64` array is `8 MB` — fits in L2/L3 only partially, so stage ordering and prefetch matter.

### 6.3 Reuse buffers

In a hot path (e.g. a polynomial-inverse Newton iteration that doubles size each step), preallocate the largest buffers once and reuse across iterations; do not allocate per multiply. This dodges GC churn (Go/Java) and allocator pressure (Python lists/arrays).

### 6.4 Parallelism

Each prime in the CRT route is an independent transform set — distribute across cores. Within one transform, a single stage's blocks are independent and can be parallelized, though the stages themselves are sequential (each depends on the previous). For most problem sizes the per-prime parallelism is the cleaner win.

### 6.5 Streaming the CRT primes to cap memory

The naive 3-prime route holds three full transform sets at once: `3·2·n` arrays for the two inputs (`O(r·n)` memory). When `n` is large (`2^{22}` `int64` is `32 MB` per array), this balloons. A streaming variant processes one prime at a time: transform `a` and `b` mod `p_r`, pointwise-multiply, inverse-transform, and **immediately fold** that prime's residue vector into a running CRT accumulator (the Garner mixed-radix digits), then discard the prime's arrays. Peak memory drops to `O(n)` for the working transform plus `O(r·n)` small accumulator state (or `O(n)` big-int accumulators). The trade-off is that the per-prime transforms become sequential unless you parallelize the accumulator merge — usually acceptable, since memory pressure is the binding constraint at these sizes.

### 6.6 Cache behavior of the butterfly

The stage-`len` butterfly accesses `a[i+k]` and `a[i+k+len/2]`, a stride of `len/2`. For small `len` the two cells share a cache line; for large `len` they are far apart, so each butterfly touches two distinct lines. The early stages (small stride) are cache-friendly; the late stages (large stride) thrash. Mitigations used in high-performance NTT: process the array in cache-sized tiles, or use a "decimation-in-frequency" ordering that keeps strides small longer. For most problem sizes the simple in-place loop is adequate; the tiling only pays off at `n` in the millions, where the array exceeds L2.

---

## 7. Code Examples

### 7.1 Go — single-prime multiply with precomputed stage roots

```go
package main

import "fmt"

const MOD = 998244353
const G = 3

func power(a, e int64) int64 {
	a %= MOD
	if a < 0 {
		a += MOD
	}
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		e >>= 1
	}
	return r
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
		wlen := power(G, (MOD-1)/int64(length))
		if invert {
			wlen = power(wlen, MOD-2)
		}
		// precompute this stage's twiddles
		half := length / 2
		tw := make([]int64, half)
		tw[0] = 1
		for k := 1; k < half; k++ {
			tw[k] = tw[k-1] * wlen % MOD
		}
		for i := 0; i < n; i += length {
			for k := 0; k < half; k++ {
				u := a[i+k]
				v := a[i+k+half] * tw[k] % MOD
				a[i+k] = (u + v) % MOD
				a[i+k+half] = (u - v + MOD) % MOD
			}
		}
	}
	if invert {
		ninv := power(int64(n), MOD-2)
		for i := range a {
			a[i] = a[i] * ninv % MOD
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
	for i := 0; i < n; i++ {
		fa[i] = fa[i] * fb[i] % MOD
	}
	ntt(fa, true)
	return fa[:need]
}

func main() {
	fmt.Println(multiply([]int64{1, 2, 3, 4}, []int64{5, 6, 7}))
}
```

### 7.2 Java — Montgomery-style fast reduction sketch in the butterfly

```java
public class NttMontgomery {
    static final long MOD = 998244353L;
    static final long G = 3;

    // Barrett-style reduction constant for 31-bit modulus.
    static long mulmod(long a, long b) {
        return a * b % MOD; // baseline; swap in Montgomery for the hot path
    }

    static long power(long a, long e) {
        a %= MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = mulmod(r, a); a = mulmod(a, a); e >>= 1; }
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
            int half = len / 2;
            long[] tw = new long[half];
            tw[0] = 1;
            for (int k = 1; k < half; k++) tw[k] = mulmod(tw[k - 1], wlen);
            for (int i = 0; i < n; i += len)
                for (int k = 0; k < half; k++) {
                    long u = a[i + k];
                    long v = mulmod(a[i + k + half], tw[k]);
                    a[i + k] = (u + v) % MOD;
                    a[i + k + half] = (u - v + MOD) % MOD;
                }
        }
        if (invert) {
            long ninv = power(n, MOD - 2);
            for (int i = 0; i < n; i++) a[i] = mulmod(a[i], ninv);
        }
    }

    public static void main(String[] args) {
        long[] a = {1, 2, 3, 4}, b = {5, 6, 7};
        int need = a.length + b.length - 1, n = 1;
        while (n < need) n <<= 1;
        long[] fa = java.util.Arrays.copyOf(a, n), fb = java.util.Arrays.copyOf(b, n);
        ntt(fa, false); ntt(fb, false);
        for (int i = 0; i < n; i++) fa[i] = mulmod(fa[i], fb[i]);
        ntt(fa, true);
        System.out.println(java.util.Arrays.toString(java.util.Arrays.copyOf(fa, need)));
    }
}
```

### 7.3 Python — 3-prime CRT with Garner reconstruction (overflow-safe)

```python
PRIMES = [998244353, 985661441, 469762049]
G = 3


def power(a, e, mod):
    a %= mod; r = 1
    while e > 0:
        if e & 1:
            r = r * a % mod
        a = a * a % mod
        e >>= 1
    return r


def ntt(a, invert, mod):
    n = len(a); j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit; bit >>= 1
        j ^= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        wlen = power(G, (mod - 1) // length, mod)
        if invert:
            wlen = power(wlen, mod - 2, mod)
        for i in range(0, n, length):
            w = 1
            for k in range(length // 2):
                u = a[i + k]; v = a[i + k + length // 2] * w % mod
                a[i + k] = (u + v) % mod
                a[i + k + length // 2] = (u - v) % mod
                w = w * wlen % mod
        length <<= 1
    if invert:
        ninv = power(n, mod - 2, mod)
        for i in range(n):
            a[i] = a[i] * ninv % mod


def conv(a, b, mod):
    need = len(a) + len(b) - 1; n = 1
    while n < need:
        n <<= 1
    fa = [x % mod for x in a] + [0] * (n - len(a))
    fb = [x % mod for x in b] + [0] * (n - len(b))
    ntt(fa, False, mod); ntt(fb, False, mod)
    fc = [x * y % mod for x, y in zip(fa, fb)]
    ntt(fc, True, mod)
    return fc[:need]


def garner(residues, primes, M):
    # incremental CRT (Garner): build mixed-radix digits, reduce mod M at the end
    k = len(primes)
    coef = [0] * k
    for i in range(k):
        x = residues[i]
        prod = 1
        for j in range(i):
            x = (x - coef[j]) * pow(prod, -1, primes[i])  # not used; simplified below
            prod = prod * primes[j]
        coef[i] = residues[i] % primes[i]
    # straightforward exact CRT (Python big ints), then mod M
    x = 0; mod = 1
    for r, p in zip(residues, primes):
        inv = pow(mod % p, -1, p)
        t = (r - x) % p * inv % p
        x += mod * t
        mod *= p
    return x % M


def multiply_mod(a, b, M):
    parts = [conv(a, b, p) for p in PRIMES]
    return [garner([parts[r][k] for r in range(3)], PRIMES, M)
            for k in range(len(parts[0]))]


if __name__ == "__main__":
    M = 10**9 + 7
    a = [10**9] * 4
    b = [10**9] * 4
    print(multiply_mod(a, b, M))
```

---

## 8. Testing and Observability

An NTT result is opaque — one wrong coefficient looks like any other large number. Build checks in from day one.

| Check | Why |
|-------|-----|
| Schoolbook oracle on small random arrays | Catches padding, scaling, and root bugs. |
| `multiply(a, [1]) == a` | Identity: convolving with the unit polynomial. |
| Round-trip `intt(ntt(a)) == a` | Confirms inverse + `n^{-1}` scaling. |
| `multiply(a, b)` matches across all CRT primes vs schoolbook mod each | Isolates per-prime bugs. |
| CRT bound assertion `Πp_r > n·max|a|·max|b|` | Prevents silent wraparound at scale. |
| Cross-language determinism | Same inputs → identical integer outputs (NTT is FP-free). |
| Degree check: `len(result) == len(a)+len(b)−1` | Catches trimming/padding mistakes. |

The single most valuable test is the **schoolbook oracle** for `n ≤ 64`, compared coefficient-by-coefficient under each prime and under the CRT-combined modulus. Property tests to run in CI: round-trip identity, multiply-by-unit, associativity `(a*b)*c == a*(b*c)` on small sizes, and the CRT-bound guard on the largest expected inputs.

### 8.1 A property-test battery

In a real codebase, encode these as randomized property tests run on every CI build:

```text
for random small arrays a, b (len ≤ 32), random NTT prime p:
    assert ntt_multiply(a, b, p) == schoolbook(a, b, p)        # the oracle
    assert intt(ntt(a, p), p) == a                             # round-trip
    assert ntt_multiply(a, [1], p) == a                        # multiply by unit
    assert ntt_multiply(a, b, p) == ntt_multiply(b, a, p)      # commutativity
    assert mul(mul(a,b),c) == mul(a,mul(b,c))                  # associativity
for the multi-prime path, arbitrary M:
    assert convolve_mod(a, b, M) == [c % M for c in schoolbook_bigint(a, b)]
    assert prod(primes) > n * max(a) * max(b)                  # CRT-bound guard
```

These seven invariants, run on a few hundred random instances, give high confidence. The associativity test is especially good at catching a transform that is correct on the squaring path but wrong on the general multiply path, and the CRT-bound guard is the only test that reliably catches under-provisioned prime sets before they fail in production.

### 8.2 Production guardrails

For a service doing convolutions at scale: log the chosen `n`, prime set, and CRT bound alongside each call so an under-provisioned reconstruction stands out; validate that inputs are reduced into `[0, p)` before transforming; and keep the naive `%`-based butterfly available behind a flag to diff against the Montgomery hot path when a result is disputed. Emit a metric for `n` and `popcount`-style transform counts so a regression (e.g. an accidental re-transform per request, or a prime-set that grew) shows up on a dashboard rather than as a latency mystery.

---

## 9. Failure Modes

### 9.1 Under-padding → cyclic wraparound
`n < len(a)+len(b)−1` makes high coefficients fold onto low ones. No crash, wrong answer. Mitigation: assert `n ≥ result length`, round up to a power of two.

### 9.2 Wrong prime (not NTT-friendly, or `2^k` too small)
`(p−1)/n` not an integer → root of wrong order → garbage. Mitigation: assert `n ≤ 2^k` for the chosen prime; keep the primes/roots table.

### 9.3 Forgotten `n^{-1}` scaling
Every output coefficient is `n×` too large. Mitigation: scale exactly once after the inverse transform; the round-trip test catches it.

### 9.4 Too few CRT primes
True coefficient exceeds `Πp_r`; CRT reconstructs a wrapped (wrong) value. Passes small tests, fails large. Mitigation: compute and assert the `n·B²` bound at runtime.

### 9.5 64-bit overflow in CRT product or giant prime
Three ~`10^9` primes multiply to `> 10^{27}`, overflowing `int64`. A `> 2^32` prime overflows the butterfly product. Mitigation: Garner's incremental CRT (`15-garner-algorithm`) or big integers; keep primes `< 2^31`.

### 9.6 Un-reduced or negative inputs
Coefficients outside `[0, p)` corrupt the transform. Mitigation: reduce mod each prime, normalize negatives, before transforming.

### 9.7 Reusing `ω` instead of `ω^{-1}` in the inverse
Produces a permuted/scrambled output. Mitigation: invert the stage root (or use `inv(g)` as base) when `invert` is set; round-trip test catches it.

### 9.8 Floating point creeping in
Mixing `double` anywhere defeats the exactness that motivates NTT. Mitigation: integer-only types throughout; if you wanted FP, you wanted FFT (`05-fft`).

### 9.9 Rebuilding root tables per call
Recomputing twiddles every multiply wastes `O(n)` work and exponentiations. Mitigation: precompute once for the max size, reuse read-only.

### 9.10 Wrong primitive root for the prime
Using a `g` that is not actually a primitive root of `p` (e.g. copying a `(p, g)` pair wrong) yields a root `g^{(p-1)/n}` whose order is a proper divisor of `n`, so the transform is not invertible and the result is garbage. Mitigation: verify `g`'s order is `p − 1` once (sibling `12`), and assert `ω^{n/2} ≡ p − 1` (the halving property) at transform setup — a cheap `O(log n)` check that catches a wrong root immediately.

### 9.11 Mixing Montgomery and normal form
In a Montgomery NTT, a single value left in normal form corrupts every butterfly it feeds, with no crash. Mitigation: encapsulate the form (Section 5.1) and validate against the naive `%` transform before shipping.

---

## 10. Summary

- **Prime choice is the first decision.** Pick `p = c·2^k + 1` with `2^k ≥` max transform length and (ideally) `p < 2^31` so butterfly products stay in `int64`. `998244353` (`g=3`, `2^23`) is the default; use higher-valuation primes for larger `n`.
- **Pad to a power of two ≥ `len(a)+len(b)−1`.** Under-padding silently wraps; respect the prime's 2-adic ceiling `2^k`.
- **Arbitrary modulus: 3-prime NTT + CRT is the senior default** — integer-only, deterministic, parallelizable — over complex-FFT coefficient splitting, which risks rounding. Choose enough primes that `Πp_r > n·max|a|·max|b|`; reconstruct with Garner (`15-garner-algorithm`) to dodge 64-bit overflow.
- **The butterfly's modular multiply dominates;** Montgomery/Barrett reduction (sibling `14-montgomery-multiplication`) and precomputed twiddle tables are the main constant-factor wins. The butterfly structure itself is shared with `15-divide-and-conquer/05-fft`.
- **Memory and cache:** flat contiguous arrays, reused buffers, per-prime parallelism.
- **Test relentlessly:** schoolbook oracle, round-trip identity, multiply-by-unit, CRT-bound assertion, cross-language determinism. NTT is FP-free, so identical inputs must give identical integer outputs.
- **Failure modes are mostly silent** (wrong answer, no crash): under-padding, wrong prime, missing `n^{-1}`, too few CRT primes, overflow. Guard each with an explicit runtime assertion.

### Decision summary

- **Friendly modulus, any `n ≤ 2^k`** → single NTT, `O(n log n)`.
- **Arbitrary modulus, exactness, integers** → 3-prime NTT + CRT (Garner).
- **Arbitrary modulus, existing FFT code, small coefficients** → FFT coefficient splitting (`05-fft`).
- **`n > 2^k` of best prime** → higher-valuation prime (`469762049` at `2^26`, `2013265921` at `2^27`) or block convolution.
- **Hot path, large repeated transforms** → Montgomery butterfly + precomputed twiddles + reused buffers.
- **Memory-constrained multi-prime** → stream the primes one at a time, folding into a CRT accumulator (Section 6.5).
- **Non-power-of-two fixed length** → Bluestein over an NTT prime with a large enough 2-adic valuation.
- **Approximate real convolution, FP acceptable** → complex FFT (`05-fft`) may be simpler than NTT.

### Incident-response checklist

When an NTT-based result is wrong in production, work this list top to bottom — it is ordered by frequency:

1. **Reproduce at the smallest failing size** against the schoolbook oracle. Most bugs surface at `n ≤ 64`.
2. **Check padding:** is `n ≥ len(a)+len(b)−1`? Under-padding fails only at large inputs (cyclic wrap).
3. **Check the CRT bound:** is `Πp_r > n·max|a|·max|b|`? Too few primes fails only at large `n`.
4. **Check the `n^{-1}` scaling:** does the round-trip `intt(ntt(a)) == a` hold? A missing scale makes everything `n×` too big.
5. **Check the root:** does `ω^{n/2} ≡ p − 1`? A wrong `g` or exceeded `2^k` ceiling breaks this.
6. **Check input normalization:** are all coefficients in `[0, p)`? Negatives/over-`p` corrupt the transform.
7. **Check Montgomery form** (if used): diff against the naive `%` transform.

This ordering reflects that the silent, scale-dependent bugs (padding, CRT count) are both the most common and the hardest to catch in small tests — feed the oracle the *actual large* inputs, not a shrunk proxy.

References to study further: Montgomery and Barrett reduction (`14-montgomery-multiplication`), Garner's algorithm (`15-garner-algorithm`), primitive roots (`12-primitive-root-discrete-root`), the Cooley-Tukey butterfly (`15-divide-and-conquer/05-fft`), and CRT (`05-crt`).
