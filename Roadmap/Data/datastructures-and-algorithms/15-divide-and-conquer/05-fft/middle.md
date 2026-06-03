# Fast Fourier Transform (FFT) — Middle Level

> **Focus:** Deriving Cooley-Tukey from the roots-of-unity halving property, turning the readable recursive FFT into a cache-friendly **iterative in-place** version with the bit-reversal permutation, building the full polynomial-multiply pipeline, and meeting the exact-integer cousin **NTT** — with a head-to-head against Karatsuba.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Iterative In-Place FFT and Bit-Reversal](#iterative-in-place-fft-and-bit-reversal)
6. [The Number-Theoretic Transform (NTT)](#the-number-theoretic-transform-ntt)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single pipeline: *evaluate at roots of unity, multiply pointwise, interpolate back.* At middle level you start asking the engineering questions that decide whether your FFT is correct *and* fast:

- *Why* does splitting even/odd indices work, and where exactly does the halving property `(ω_n^k)² = ω_{n/2}^k` enter the derivation?
- How do you replace the elegant-but-slow recursive FFT with a single-array **iterative in-place** version, and what is that mysterious **bit-reversal permutation**?
- How do you assemble a production polynomial multiply, including the padding, the pointwise step, and the final rounding?
- When floating point isn't good enough, how does the **NTT** give *exact* modular convolution with the same `O(n log n)` skeleton?
- How does FFT stack up against **Karatsuba** (sibling `04-karatsuba`), and where is the crossover?

These are the questions that separate "I copied an FFT" from "I can derive it, optimize it, and pick the right variant for the problem in front of me."

---

## Deeper Concepts

### The Cooley-Tukey derivation, restated

We want the DFT: `Â_k = Σ_{j=0}^{n-1} a_j · ω_n^{jk}` for every `k`, where `ω_n = e^{2πi/n}`. Split the sum by parity of `j` (`j = 2m` even, `j = 2m+1` odd):

```
Â_k = Σ_m a_{2m} · ω_n^{2mk}  +  Σ_m a_{2m+1} · ω_n^{(2m+1)k}
    = Σ_m a_{2m} · ω_n^{2mk}  +  ω_n^k · Σ_m a_{2m+1} · ω_n^{2mk}
```

Now use the **halving property** `ω_n^{2mk} = (ω_n²)^{mk} = ω_{n/2}^{mk}` (because `ω_n² = e^{2·2πi/n} = e^{2πi/(n/2)} = ω_{n/2}`):

```
Â_k = E_k  +  ω_n^k · O_k          where
E_k = Σ_m a_{2m}   · ω_{n/2}^{mk}  = DFT of the even coefficients
O_k = Σ_m a_{2m+1} · ω_{n/2}^{mk}  = DFT of the odd coefficients
```

`E` and `O` are size-`n/2` DFTs — recurse on each. The genius is that `E_k` and `O_k` are periodic with period `n/2`, so the **same** pair computes two outputs via the **cancellation property** `ω_n^{k+n/2} = −ω_n^k`:

```
Â_k        = E_k + ω_n^k · O_k        for k = 0 … n/2−1     (butterfly +)
Â_{k+n/2}  = E_k − ω_n^k · O_k        for k = 0 … n/2−1     (butterfly −)
```

That pair of lines is the **butterfly**. Each butterfly does one complex multiply and two adds, and there are `n/2` of them per level, so combining is `O(n)`. The recurrence is `T(n) = 2T(n/2) + O(n) = O(n log n)` — identical in shape to merge sort (sibling `01-merge-sort`).

### Why exactly the roots of unity?

Two properties make them the unique good choice:

1. **Halving (recursion).** `(ω_n^k)² = ω_{n/2}^k` — squaring the `n` points lands on the `n/2` points, so subproblems share the *same* evaluation points. Arbitrary points lose this self-similarity.
2. **Orthogonality (invertibility).** The roots satisfy `Σ_k ω_n^{k(j−ℓ)} = n·[j = ℓ]`. This is what makes the inverse DFT a clean `(1/n)·conjugate` formula instead of an expensive matrix inversion.

### The inverse FFT in one line

The DFT matrix `F` has entries `F[j][k] = ω_n^{jk}`. Its inverse is `F⁻¹[j][k] = (1/n)·ω_n^{−jk}` — the conjugate, scaled. So:

```
inverseFFT(â) = (1/n) · FFT(â  with ω replaced by ω⁻¹)
```

Two ways to implement the scaling: divide the *entire* result by `n` once at the end, OR divide by 2 at each of the `log n` levels (`2^{log n} = n`). Pick one; doing both double-scales.

### The recursion tree at a glance

For `n = 8` the divide step builds this tree (even indices left, odd right), and the combine runs bottom-up:

```
                 [a0 a1 a2 a3 a4 a5 a6 a7]
            even /                        \ odd
        [a0 a2 a4 a6]                 [a1 a3 a5 a7]
       /            \                /            \
   [a0 a4]       [a2 a6]         [a1 a5]       [a3 a7]
   /     \       /     \         /     \       /     \
 [a0]  [a4]   [a2]  [a6]      [a1]  [a5]    [a3]  [a7]   ← leaves (bit-reversed order)
```

The leaf order read left-to-right is `0,4,2,6,1,5,3,7` — exactly the **bit-reversal permutation** of `0..7`. The iterative FFT starts from this order and merges upward with butterflies, level by level. Three levels (`log₂ 8`), each doing `O(n)` butterfly work → `O(n log n)`.

---

## Comparison with Alternatives

| Method | Time | Exact? | Best for |
|--------|------|--------|----------|
| Schoolbook multiply | `O(n²)` | Yes (integers) | Tiny `n` (≤ ~32). |
| **Karatsuba** (sibling `04`) | `O(n^1.585)` | Yes (integers) | Medium `n`; no float worries; simple. |
| Toom-Cook (Toom-3) | `O(n^1.465)` | Yes | Medium-large; GMP threshold band. |
| **FFT (complex)** | `O(n log n)` | Approx (round at end) | Large `n`; float precision acceptable. |
| **NTT (modular)** | `O(n log n)` | **Exact mod p** | Large `n`; need exact result / modular answer. |

The practical reality used by libraries like GMP: **schoolbook → Karatsuba → Toom-Cook → FFT** as the operand size grows, switching at empirically tuned thresholds. Karatsuba beats FFT for medium sizes because of FFT's constant factor and the precision overhead; FFT wins decisively once `n` is large enough that `n log n ≪ n^1.585`.

> **Key contrast vs Karatsuba.** Both are divide-and-conquer. Karatsuba splits a number into high/low halves and does **3** half-size multiplies (instead of 4) → `O(n^1.585)`. FFT splits coefficients by even/odd parity and does **2** half-size transforms plus an `O(n)` combine → `O(n log n)`. FFT's deeper trick is changing *representation* (to value form) so the combine is linear, not just saving one of four multiplies.

A concrete sense of the gap: at `n = 2²⁰ ≈ 10⁶`, schoolbook does `~10¹²` ops, Karatsuba `~(10⁶)^{1.585} ≈ 6·10⁹`, and FFT `~n log₂ n ≈ 2·10⁷`. The asymptotics translate to roughly three orders of magnitude between Karatsuba and FFT at million-scale — which is exactly why big-number libraries graduate to FFT for their largest operands.

---

## Advanced Patterns

### Pattern: One forward FFT for squaring

To compute `A²`, transform `A` once and square the values, instead of transforming twice:

```python
fft(fa)                      # one forward transform
fa = [x * x for x in fa]     # square the values
fft(fa, invert=True)
```

### Pattern: Two real transforms in one complex FFT

Because real inputs have conjugate-symmetric DFTs, you can pack two real polynomials `A` and `B` into one complex array `A + iB`, run a single FFT, and unpack both spectra — roughly halving the forward-transform work. (Implementation is fiddly; libraries use it heavily.)

### Pattern: Convolution problems in disguise

Many problems are convolutions once you spot them:

- **Count pairs with a given sum.** With indicator arrays `f`, `g`, the convolution `(f * g)[s]` counts pairs `(i, j)` with `i + j = s`.
- **Polynomial of subset sums / generating functions.** Multiply generating functions to combine independent choices.
- **String matching with wildcards.** Encode matches as a sum-of-squared-differences convolution (see `senior.md`/`professional.md`).

### Pattern: Choosing the digit base for big integers

The base `B` trades transform length against per-coefficient magnitude. With `d` digits in base `10`, regrouping into base `10⁴` cuts the coefficient count (hence `n`) by ~4×, but each product term can reach `~n·(10⁴)²`. Pick `B` so the convolution coefficients stay within the FFT precision budget (or under the NTT prime). Common choices: `10⁴` for decimal-friendly output, `2¹⁶` for binary limbs.

### Pattern: Big-integer multiplication

Treat a number's digits (in some base `B`, e.g. `10⁴` or `2¹⁶`) as polynomial coefficients, convolve via FFT, then **propagate carries**:

```
digits of x  →  polynomial X
digits of y  →  polynomial Y
Z = X · Y (via FFT)            # may have entries ≥ B
carry: for each i, carry = Z[i] / B; Z[i] %= B; Z[i+1] += carry
```

---

## Iterative In-Place FFT and Bit-Reversal

The recursive FFT allocates new arrays at every level and recurses `O(log n)` deep. The **iterative in-place** version is faster, allocation-free, and cache-friendly. Two ideas make it work:

### 1. Bit-reversal permutation

The recursion repeatedly splits into even/odd halves. If you trace where coefficient `a_j` ends up at the leaves, it lands at the position whose binary representation is `j` **with its bits reversed**. So instead of recursing, you first permute the array into bit-reversed order, then combine bottom-up.

```
For n = 8 (3 bits):
index 1 = 001₂  →  100₂ = 4
index 3 = 011₂  →  110₂ = 6
index 6 = 110₂  →  011₂ = 3
```

### 2. Bottom-up butterfly passes

After the permutation, do `log n` passes. Pass with block length `len = 2, 4, 8, …, n` applies butterflies within each block using the `len`-th roots of unity:

```
for len = 2; len ≤ n; len <<= 1:
    w_len = ω_len  (or its conjugate if inverse)
    for each block start i in steps of len:
        w = 1
        for k in 0 .. len/2 - 1:
            u = a[i+k]
            v = a[i+k+len/2] * w        # butterfly
            a[i+k]         = u + v
            a[i+k+len/2]   = u - v
            w *= w_len
```

This is exactly the recursive butterfly, unrolled into nested loops, operating in place on a single array.

---

## The Number-Theoretic Transform (NTT)

Floating-point FFT carries rounding error. When you need **exact** integer convolution (especially modulo a prime), use the **NTT**: the *same* algorithm, but over the integers mod a prime `p`, replacing the complex root `ω_n = e^{2πi/n}` with a **primitive `n`-th root of unity modulo `p`**.

For this to exist, `n` must divide `p − 1`. So we pick **NTT-friendly primes** of the form `p = c·2^k + 1`, which have a large power-of-two factor in `p − 1`. The classic one:

```
p = 998244353 = 119 · 2²³ + 1        (primitive root g = 3)
```

The `n`-th root is `ω_n = g^{(p−1)/n} mod p`, and `ω_n^{−1}` and `n⁻¹` are computed by modular inverse (Fermat: `x⁻¹ = x^{p−2} mod p`). Everything else — butterflies, bit-reversal, the pipeline — is identical, but every operation is integer arithmetic mod `p`. The result is **exact**: no rounding, no precision ceiling.

**Tiny worked example.** Use `p = 17` (`= 2⁴ + 1`), `g = 3`, length `n = 4`. The 4th root of unity is `ω = 3^{(17−1)/4} = 3^4 = 81 ≡ 13 (mod 17)`. Sanity checks that mirror the complex roots:

```
ω⁰ = 1
ω¹ = 13
ω² = 13² = 169 ≡ 16 ≡ −1   ← cancellation: ω^{n/2} = −1, just like e^{πi} = −1
ω³ = ω²·ω ≡ −13 ≡ 4
ω⁴ = 13⁴ ≡ 1                ← back to start, order exactly 4
```

So `{1, 13, −1, 4}` plays the role of `{1, i, −1, −i}` in the complex case. The inverse uses `ω⁻¹ = 13^{15} mod 17 = 4` and `n⁻¹ = 4^{15} mod 17 = 13`. Running the NTT/inverse-NTT pipeline on `[1,2]·[3,4]` gives `[3,10,8,0]` exactly mod 17 — identical to the complex-FFT answer, but with zero rounding.

Trade-offs vs complex FFT:

- ✅ Exact; perfect for modular answers, hashing, big-integer mod arithmetic.
- ✅ Integer-only (no `double`), fully deterministic across platforms.
- ❌ Answer is mod `p`; for true integers you need `p > max coefficient`, or use multiple primes + CRT.
- ❌ Tied to NTT-friendly primes; arbitrary moduli need 2–3 primes and CRT recombination.

---

## Code Examples

### Example: Iterative In-Place FFT + Polynomial Multiply, and an NTT

#### Go

```go
package main

import (
	"fmt"
	"math"
	"math/cmplx"
)

// Iterative in-place radix-2 FFT. len(a) must be a power of two.
func fft(a []complex128, invert bool) {
	n := len(a)
	// bit-reversal permutation
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
		ang := 2 * math.Pi / float64(length)
		if invert {
			ang = -ang
		}
		wlen := cmplx.Exp(complex(0, ang))
		for i := 0; i < n; i += length {
			w := complex(1, 0)
			for k := 0; k < length/2; k++ {
				u := a[i+k]
				v := a[i+k+length/2] * w
				a[i+k] = u + v
				a[i+k+length/2] = u - v
				w *= wlen
			}
		}
	}
	if invert {
		for i := range a {
			a[i] /= complex(float64(n), 0)
		}
	}
}

func multiply(a, b []int) []int {
	need := len(a) + len(b) - 1
	n := 1
	for n < need {
		n <<= 1
	}
	fa := make([]complex128, n)
	fb := make([]complex128, n)
	for i, v := range a {
		fa[i] = complex(float64(v), 0)
	}
	for i, v := range b {
		fb[i] = complex(float64(v), 0)
	}
	fft(fa, false)
	fft(fb, false)
	for i := range fa {
		fa[i] *= fb[i]
	}
	fft(fa, true)
	res := make([]int, need)
	for i := 0; i < need; i++ {
		res[i] = int(math.Round(real(fa[i])))
	}
	return res
}

func main() {
	fmt.Println(multiply([]int{1, 2, 3}, []int{4, 5})) // [4 13 22 15]
}
```

#### Java

```java
import java.util.*;

public class IterFFT {
    static void fft(double[] re, double[] im, boolean invert) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {            // bit reversal
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                double tr = re[i]; re[i] = re[j]; re[j] = tr;
                double ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = 2 * Math.PI / len * (invert ? -1 : 1);
            double wlr = Math.cos(ang), wli = Math.sin(ang);
            for (int i = 0; i < n; i += len) {
                double wr = 1, wi = 0;
                for (int k = 0; k < len / 2; k++) {
                    double ur = re[i + k], ui = im[i + k];
                    int p = i + k + len / 2;
                    double vr = re[p] * wr - im[p] * wi;
                    double vi = re[p] * wi + im[p] * wr;
                    re[i + k] = ur + vr; im[i + k] = ui + vi;
                    re[p] = ur - vr;     im[p] = ui - vi;
                    double nwr = wr * wlr - wi * wli;
                    wi = wr * wli + wi * wlr; wr = nwr;
                }
            }
        }
        if (invert) for (int i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }

    static long[] multiply(int[] a, int[] b) {
        int need = a.length + b.length - 1, n = 1;
        while (n < need) n <<= 1;
        double[] re = new double[n], im = new double[n];
        double[] r2 = new double[n], i2 = new double[n];
        for (int i = 0; i < a.length; i++) re[i] = a[i];
        for (int i = 0; i < b.length; i++) r2[i] = b[i];
        fft(re, im, false); fft(r2, i2, false);
        for (int i = 0; i < n; i++) {
            double r = re[i] * r2[i] - im[i] * i2[i];
            double m = re[i] * i2[i] + im[i] * r2[i];
            re[i] = r; im[i] = m;
        }
        fft(re, im, true);
        long[] out = new long[need];
        for (int i = 0; i < need; i++) out[i] = Math.round(re[i]);
        return out;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(multiply(new int[]{1,2,3}, new int[]{4,5})));
        // [4, 13, 22, 15]
    }
}
```

#### Python

```python
# Iterative complex FFT + an exact NTT, side by side.
import cmath

def fft(a, invert=False):
    n = len(a)
    j = 0
    for i in range(1, n):                 # bit reversal
        bit = n >> 1
        while j & bit:
            j ^= bit; bit >>= 1
        j ^= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        ang = 2 * cmath.pi / length * (-1 if invert else 1)
        wlen = cmath.exp(1j * ang)
        i = 0
        while i < n:
            w = 1 + 0j
            for k in range(length // 2):
                u = a[i + k]
                v = a[i + k + length // 2] * w
                a[i + k] = u + v
                a[i + k + length // 2] = u - v
                w *= wlen
            i += length
        length <<= 1
    if invert:
        for i in range(n):
            a[i] /= n


MOD = 998244353
G = 3                                       # primitive root of MOD

def ntt(a, invert=False):
    n = len(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit; bit >>= 1
        j ^= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        # length-th root of unity mod p (or its inverse)
        w_len = pow(G, (MOD - 1) // length, MOD)
        if invert:
            w_len = pow(w_len, MOD - 2, MOD)
        i = 0
        while i < n:
            w = 1
            for k in range(length // 2):
                u = a[i + k]
                v = a[i + k + length // 2] * w % MOD
                a[i + k] = (u + v) % MOD
                a[i + k + length // 2] = (u - v) % MOD
                w = w * w_len % MOD
            i += length
        length <<= 1
    if invert:
        n_inv = pow(n, MOD - 2, MOD)
        for i in range(n):
            a[i] = a[i] * n_inv % MOD


def multiply_ntt(a, b):
    need = len(a) + len(b) - 1
    n = 1
    while n < need:
        n <<= 1
    fa = a + [0] * (n - len(a))
    fb = b + [0] * (n - len(b))
    ntt(fa); ntt(fb)
    fc = [fa[i] * fb[i] % MOD for i in range(n)]
    ntt(fc, invert=True)
    return fc[:need]


if __name__ == "__main__":
    print(multiply_ntt([1, 2, 3], [4, 5]))   # [4, 13, 22, 15]  (exact, mod p)
```

**What it does:** the iterative FFT permutes into bit-reversed order then runs `log n` butterfly passes in place; the NTT does the identical dance with a primitive root mod `998244353`, producing **exact** integer coefficients.
**Run:** `go run main.go` | `javac IterFFT.java && java IterFFT` | `python iterfft.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong output order | Bit-reversal loop wrong / missing. | Verify the permutation on `n=8` against `[0,4,2,6,1,5,3,7]`. |
| Result `n×` too large | Inverse scaling applied 0 or 2 times. | Divide by `n` exactly once (or `/2` per level, not both). |
| NTT returns wrong values | `n` does not divide `p−1`, or wrong primitive root. | Use NTT-friendly prime `998244353`, root `g=3`, `n` a power of two. |
| Negative NTT coefficients | `(u − v) mod p` went negative. | `(u − v + MOD) % MOD`. |
| Off-by-one length | Output must be `len(a)+len(b)−1`. | Slice the padded result. |
| Precision blows up | Coefficients/`n` too large for `double`. | Split coefficients or switch to NTT. |

---

## Performance Analysis

- **Recursive vs iterative.** Both are `O(n log n)`, but iterative avoids `O(log n)` array allocations per level and recursion frames; it is typically 2–4× faster and far more cache-friendly.
- **Root precomputation.** Computing `wlen` once per level (as above) is fine; precomputing a full root table avoids repeated `exp`/`cos` and is faster still.
- **Constant factor.** FFT does ~`n log n` complex multiplies; each complex multiply is 4 real multiplies + 2 adds. This constant is why Karatsuba wins for medium `n`.
- **NTT vs FFT cost.** NTT uses integer modular multiply (often with a fast reduction like Montgomery/Barrett); comparable to FFT but **exact**, and avoids the precision ceiling entirely.
- **Memory.** In-place: `O(n)` for the working array(s). No extra per-level buffers.

---

## Best Practices

- Implement the **iterative in-place** FFT for production; keep the recursive one only for teaching/clarity.
- Validate the bit-reversal permutation in isolation (it's the most error-prone part) before wiring up butterflies.
- Decide **FFT vs NTT** by the requirement: approximate/real → FFT; exact/modular → NTT. Don't use float FFT where exactness is required.
- For NTT, hardcode a known-good prime/root pair (`998244353`, `g=3`) and assert `n | (p−1)`.
- Always round (not truncate) complex-FFT real parts, and assert the rounding error margin during tests.
- Pad to the **smallest** power of two `≥ len(a)+len(b)−1`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The recursive **even/odd split** of the coefficient array into `log n` stages
> - The **butterfly** combine (`u + ω·v` / `u − ω·v`) at each stage, matching the iterative passes
> - The **bit-reversal permutation** that reorders leaves so the bottom-up version is in place
> - Step / Run / Reset controls to follow the `O(n log n)` divide-and-conquer

---

## Summary

**Mental model to carry forward.** FFT = "evaluate at clever points so the combine is linear"; the clever points are the roots of unity; the linear combine is the butterfly; the inverse is the same machine run backwards with a `1/n` scale. NTT is that exact same machine over `ℤ_p`. Karatsuba is a different machine (save one of four multiplies) that wins at medium sizes. Hold these four sentences and the rest is implementation detail.

Cooley-Tukey falls straight out of the roots-of-unity **halving property**: splitting the DFT sum by even/odd index yields two half-size DFTs combined by `O(n)` butterflies (`Â_k = E_k + ω^k O_k`, `Â_{k+n/2} = E_k − ω^k O_k`), giving `T(n)=2T(n/2)+O(n)=O(n log n)`. The recursive form is clearest; the **iterative in-place** form — bit-reversal permutation then `log n` butterfly passes — is what you ship. The full multiply pipeline pads to a power of two, runs two forward FFTs, multiplies pointwise in `O(n)`, and one inverse FFT. When floating point isn't exact enough, the **NTT** swaps `e^{2πi/n}` for a primitive `n`-th root modulo an NTT-friendly prime like `998244353`, giving exact modular convolution with the identical skeleton. Against **Karatsuba**, FFT wins asymptotically (`n log n` vs `n^1.585`) but only past a size threshold where its larger constant is amortized.
