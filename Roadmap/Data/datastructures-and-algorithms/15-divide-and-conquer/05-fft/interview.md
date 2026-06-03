# Fast Fourier Transform (FFT) — Interview Preparation

FFT is a favourite interview topic because it rewards a few crisp insights — *"a polynomial has two representations, and multiplication is `O(n)` in value form"*, *"the roots of unity halve via `(ω_n^k)² = ω_{n/2}^k`"*, and *"convolution in time = pointwise product in frequency"* — and then tests whether you can (a) make it `O(n log n)` with divide and conquer, (b) keep it correct with padding and the `1/n` inverse scaling, (c) recognize convolution problems in disguise, and (d) know when floating-point FFT fails and the exact **NTT** is required. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Evaluate poly at `n` roots of unity | FFT | `O(n log n)` |
| Multiply two polynomials | 2× FFT + pointwise + IFFT | `O(n log n)` |
| Multiply two big integers | digit convolution + carry | `O(n log n)` |
| Exact modular convolution | **NTT** (integers mod prime) | `O(n log n)` |
| Arbitrary modulus convolution | multi-prime NTT + CRT | `O(n log n)` |
| String matching (wildcards) | sum-of-squares as convolutions | `O((N+m) log(N+m))` |
| Karatsuba multiply (sibling `04`) | divide & conquer, 3 sub-mults | `O(n^1.585)` |
| Schoolbook multiply | every coefficient pair | `O(n²)` |

Core algorithm (recursive radix-2):

```text
FFT(a, invert):                       # len(a) is a power of two
    if len(a) == 1: return
    E = FFT(a[0::2]);  O = FFT(a[1::2])
    ω = e^{±2πi/n}                     # − sign for inverse
    for k in 0 .. n/2-1:
        t = ω^k · O[k]
        a[k]       = E[k] + t          # butterfly +
        a[k+n/2]   = E[k] − t          # butterfly −
    # inverse: divide whole result by n at the end
```

Key facts:
- A degree-`<n` polynomial ↔ `n` coefficients ↔ values at `n` points.
- **Roots of unity:** `ω_n = e^{2πi/n}`; halving `(ω_n^k)² = ω_{n/2}^k`; cancellation `ω_n^{k+n/2} = −ω_n^k`.
- **Convolution theorem:** `DFT(a∗b) = DFT(a) ⊙ DFT(b)`.
- Pad to a power of two `≥ len(a)+len(b)−1` (else cyclic wrap-around).
- Inverse = same FFT with conjugate roots, then ÷`n`.
- Complex FFT is *approximate* — round at the end; use **NTT** for exact.

---

## Junior Questions (12 Q&A)

### J1. What are the two representations of a polynomial, and why do they matter?
**Coefficient form** (`[a₀,…,a_{n-1}]`) and **point-value form** (values at `n` distinct points). Multiplication is `O(n²)` in coefficient form but only `O(n)` in value form (pointwise). FFT moves between the two in `O(n log n)`, so you multiply in `O(n log n)` overall.

### J2. What does the FFT actually compute?
The Discrete Fourier Transform: it evaluates a polynomial at the `n` complex roots of unity, `â_k = A(ω_n^k)`. The naive evaluation is `O(n²)`; FFT does it in `O(n log n)` by divide and conquer.

### J3. What is a root of unity?
A complex number `ω` with `ωⁿ = 1`. The principal `n`-th root is `ω_n = e^{2πi/n}`; its powers are `n` points evenly spaced on the unit circle. FFT uses them as evaluation points because of their self-similar structure.

### J4. Why split the coefficients into even and odd indices?
Because of the halving property `(ω_n^k)² = ω_{n/2}^k`: evaluating `A` at the `n`-th roots reduces to evaluating two half-size polynomials (even-indexed and odd-indexed coefficients) at the `(n/2)`-th roots, which is two subproblems of half the size.

### J5. What is a butterfly?
The `O(1)` combine step: given `E_k`, `O_k`, and twiddle `ω_n^k`, it produces two outputs `â_k = E_k + ω_n^k·O_k` and `â_{k+n/2} = E_k − ω_n^k·O_k`. There are `n/2` of them per level.

### J6. What is the time complexity of FFT and why?
`O(n log n)`. The recurrence is `T(n) = 2T(n/2) + O(n)` — two half-size FFTs plus an `O(n)` combine — which solves to `O(n log n)` (same as merge sort).

### J7. How do you multiply two polynomials with FFT?
Pad both to a power of two `≥ len(a)+len(b)−1`, FFT each (coefficients → values), multiply the values pointwise in `O(n)`, then inverse-FFT (values → coefficients). Round to integers if inputs were integers.

### J8. What is the inverse FFT?
It converts value form back to coefficient form. It is the same algorithm using the conjugate roots `ω_n^{−k}` and dividing the result by `n`.

### J9. Why must you pad to a power of two?
Radix-2 Cooley-Tukey only works when `n` is a power of two (each level halves cleanly). You must also pad to at least `len(a)+len(b)−1` so the product fits without wrap-around.

### J10. Why are the answers slightly off from integers?
Complex FFT uses floating-point (`double`) arithmetic, which has rounding error. For integer inputs, round each output to the nearest integer at the end. Never compare floats with `==`.

### J11. What is convolution and how does it relate to FFT?
Convolution `c_t = Σ a_j b_{t−j}` produces the coefficients of the product polynomial. The convolution theorem says it equals a pointwise product in the DFT domain — which is exactly why FFT multiplies fast.

### J12 (analysis). How does FFT compare to Karatsuba?
Both are divide-and-conquer multiplication. Karatsuba is `O(n^1.585)` (3 half-size multiplies); FFT is `O(n log n)` (2 half-size transforms + linear combine). FFT is asymptotically faster but has a larger constant, so Karatsuba wins for medium `n`.

---

## Middle Questions (12 Q&A)

### M1. Derive the Cooley-Tukey recurrence.
Split `â_k = Σ_j a_j ω_n^{jk}` by parity: `â_k = Σ_m a_{2m}(ω_n²)^{mk} + ω_n^k Σ_m a_{2m+1}(ω_n²)^{mk}`. Since `ω_n² = ω_{n/2}`, the two sums are `(n/2)`-DFTs `E_k`, `O_k`, giving `â_k = E_k + ω_n^k O_k`. Using `ω_n^{k+n/2} = −ω_n^k` gives `â_{k+n/2} = E_k − ω_n^k O_k`.

### M2. What is the bit-reversal permutation and why is it needed?
The iterative in-place FFT processes leaves bottom-up. The recursion places coefficient `a_j` at the position with `j`'s bits reversed. So you first permute the array into bit-reversed order, then run `log n` butterfly passes in place. It eliminates recursion and per-level allocation.

### M3. How do you multiply two big integers with FFT?
Treat the digits (in some base `B`) as polynomial coefficients, convolve via FFT to get the product polynomial, then propagate carries: for each position, `carry = z[i] / B; z[i] %= B; z[i+1] += carry`.

### M4. What is the NTT and when do you use it?
The Number-Theoretic Transform: FFT done in `ℤ_p` (integers mod a prime), replacing `e^{2πi/n}` with a primitive `n`-th root `g^{(p−1)/n} mod p`. It is **exact** (no rounding). Use it when you need exact integer/modular convolution.

### M5. What makes a prime "NTT-friendly"?
It has the form `p = c·2^k + 1`, so `2^k | (p−1)`, allowing transform lengths up to `2^k`. Example: `998244353 = 119·2²³ + 1` with primitive root `g = 3`.

### M6. Why does the inverse need a `1/n` factor?
The DFT matrix `F` (entries `ω_n^{jk}`) has inverse `(1/n)·conj(F)`, because `Σ_k ω_n^{k(ℓ−j)} = n·[j=ℓ]` (orthogonality). So inverse FFT runs the transform with conjugate roots and divides by `n`.

### M7. Cyclic vs linear convolution — what's the difference?
The DFT computes cyclic convolution (indices mod `n`). To get the true polynomial product (linear convolution), pad so `n ≥ len(a)+len(b)−1`; then the wrapped terms are zero and cyclic = linear. Under-padding aliases high terms onto low ones.

### M8. How do you avoid floating-point overflow of precision?
Keep `n·C²·log n·ε` below `0.5` (where `C` is the max coefficient). If exceeded, split each coefficient into high/low halves (extra transforms) or switch to NTT for exactness.

### M9. Can you compute `A²` faster than two transforms?
Yes: FFT `A` once, square the values pointwise, then inverse-FFT. One forward transform instead of two.

### M10. How does FFT enable fast string matching?
Encode characters numerically and express the mismatch count at each shift as a sum of correlations (`Σ f(P[j])·g(T[s+j])`). A correlation is a convolution with one sequence reversed, computable by FFT, giving `O((N+m) log(N+m))`.

### M11. What is the role of the convolution theorem?
It is the foundation: `DFT(a∗b) = DFT(a) ⊙ DFT(b)`. It lets you replace an `O(n²)` convolution with two forward transforms, an `O(n)` pointwise product, and one inverse transform — all `O(n log n)`.

### M12 (analysis). Where is the FFT-vs-Karatsuba crossover, and why?
Karatsuba (`n^1.585`) beats FFT (`n log n`) for medium `n` because FFT has a larger constant (complex arithmetic, padding to power of two, precision overhead). Libraries like GMP switch schoolbook → Karatsuba → Toom-Cook → FFT at empirically tuned size thresholds.

---

## Senior Questions (10 Q&A)

### S1. How would you convolve modulo a non-NTT-friendly prime like 10⁹+7?
Run the NTT under 2–3 NTT-friendly primes (e.g. `998244353`, `1004535809`, `985661441`), reconstruct the true integer coefficient via CRT (it is `< p₁p₂p₃`), then reduce mod `10⁹+7`. Alternatively, use complex FFT with coefficient splitting.

### S2. When is plain complex FFT unsafe, and what do you do?
When `n·C²·log n·ε ≳ 0.5` (large `n` or large coefficients), rounding can flip a coefficient by ±1. Mitigate by splitting coefficients into smaller pieces (base `√MOD`) or by using NTT, which is exact.

### S3. How do you handle non-power-of-two lengths efficiently?
Pad to the next power of two (simple, ≤2× waste), or use mixed-radix / split-radix FFTs (factors of 3, 5) as FFTW does, or Bluestein's algorithm to compute an arbitrary-length DFT as a padded convolution (useful for prime `n`).

### S4. How do you test an FFT implementation?
Differential testing against a schoolbook `O(n²)` oracle on thousands of random small inputs; a round-trip identity `IFFT(FFT(a)) == a` (within tolerance / exactly for NTT); algebraic properties (commutativity, `[1]` is identity); and a known answer like `[1,1]^∗k` = Pascal's row `k`.

### S5. Why is the iterative in-place FFT preferred in production?
Same `O(n log n)`, but no recursion frames and no per-level array allocation; it is cache-friendly and allocation-free, typically 2–4× faster. Bit-reversal permutation enables the in-place bottom-up passes.

### S6. How does FFT relate to integer multiplication complexity bounds?
FFT-based methods give `O(n log n log log n)` (Schönhage–Strassen) and, since 2019, `O(n log n)` (Harvey–van der Hoeven) for `n`-bit integer multiplication — the conjectured optimum — versus schoolbook `O(n²)` and Karatsuba `O(n^1.585)`.

### S7. What numerical precautions matter for large-`n` complex FFT?
Precompute root tables (more accurate and faster than per-butterfly `exp`); track the max `|x − round(x)|` as telemetry; prefer NTT when exactness is required; consider higher precision (long double / quad) only as a last resort before splitting/NTT.

### S8. How would you parallelize an FFT?
Butterflies within a level are independent, so vectorize with SIMD and parallelize across blocks; for very large transforms use the four-step/six-step algorithm to restructure memory access (cache/GPU). cuFFT and FFTW exploit exactly this.

### S9. Why can't FFT count *simple* matches or do max-convolution easily?
The convolution theorem needs a ring with a fast transform (`+`, `×`). Max-plus "convolution" lacks additive inverses, so there is no FFT analogue; the best known is barely subquadratic. FFT is fast precisely because `(+, ×)` has roots of unity.

### S10. When would you choose Karatsuba over FFT in production?
For medium operand sizes where FFT's constant factor and precision handling outweigh the asymptotic win, and when you want exact integer arithmetic without NTT machinery. Karatsuba is simpler, exact, and has no padding/precision pitfalls.

---

## Behavioral / Communication Prompts

- **Explain FFT to a non-specialist.** Use the "sheet music vs waveform" analogy: a polynomial has two encodings, and multiplication is trivial in the second one. The FFT is the fast translator between them.
- **A teammate's FFT gives answers off by exactly `n`.** How do you diagnose it? (Missing or double `1/n` inverse scaling — walk through isolating with a round-trip test.)
- **Justify NTT over FFT to a reviewer who says "just round the doubles".** Explain the precision budget `n·C²·log n·ε` and show an input where rounding flips a coefficient.
- **Trade-off discussion:** when would you *not* reach for FFT? (Tiny inputs, non-convolution problems, exactness needs without modular arithmetic.)
- **Incident write-up:** describe debugging a wrap-around (aliasing) bug caused by insufficient padding, and the test that would have caught it.

---

## Coding Challenges

### Challenge 1 — Polynomial multiplication via FFT

**Problem.** Given coefficient arrays `a` and `b` of two integer polynomials, return the coefficients of `A(x)·B(x)`.

**Approach.** Pad to a power of two `≥ len(a)+len(b)−1`, run FFT on both, multiply pointwise, inverse FFT, round.

#### Go
```go
package main

import (
	"fmt"
	"math"
	"math/cmplx"
)

func fft(a []complex128, inv bool) {
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
	for l := 2; l <= n; l <<= 1 {
		ang := 2 * math.Pi / float64(l)
		if inv {
			ang = -ang
		}
		wl := cmplx.Exp(complex(0, ang))
		for i := 0; i < n; i += l {
			w := complex(1, 0)
			for k := 0; k < l/2; k++ {
				u, v := a[i+k], a[i+k+l/2]*w
				a[i+k], a[i+k+l/2] = u+v, u-v
				w *= wl
			}
		}
	}
	if inv {
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
	out := make([]int, need)
	for i := 0; i < need; i++ {
		out[i] = int(math.Round(real(fa[i])))
	}
	return out
}

func main() {
	fmt.Println(multiply([]int{1, 2, 3}, []int{4, 5, 6})) // [4 13 28 27 18]
}
```

#### Java
```java
import java.util.*;

public class Challenge1 {
    static void fft(double[] re, double[] im, boolean inv) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t;
                         t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (int l = 2; l <= n; l <<= 1) {
            double ang = 2 * Math.PI / l * (inv ? -1 : 1);
            double cr = Math.cos(ang), ci = Math.sin(ang);
            for (int i = 0; i < n; i += l) {
                double wr = 1, wi = 0;
                for (int k = 0; k < l / 2; k++) {
                    int p = i + k + l / 2;
                    double vr = re[p] * wr - im[p] * wi;
                    double vi = re[p] * wi + im[p] * wr;
                    re[p] = re[i + k] - vr; im[p] = im[i + k] - vi;
                    re[i + k] += vr; im[i + k] += vi;
                    double nr = wr * cr - wi * ci;
                    wi = wr * ci + wi * cr; wr = nr;
                }
            }
        }
        if (inv) for (int i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
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
        System.out.println(Arrays.toString(multiply(new int[]{1,2,3}, new int[]{4,5,6})));
    }
}
```

#### Python
```python
import cmath

def fft(a, inv=False):
    n = len(a); j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit: j ^= bit; bit >>= 1
        j ^= bit
        if i < j: a[i], a[j] = a[j], a[i]
    l = 2
    while l <= n:
        ang = 2 * cmath.pi / l * (-1 if inv else 1)
        wl = cmath.exp(1j * ang)
        for i in range(0, n, l):
            w = 1 + 0j
            for k in range(l // 2):
                u = a[i + k]; v = a[i + k + l // 2] * w
                a[i + k] = u + v; a[i + k + l // 2] = u - v
                w *= wl
        l <<= 1
    if inv:
        for i in range(n): a[i] /= n

def multiply(a, b):
    need = len(a) + len(b) - 1; n = 1
    while n < need: n <<= 1
    fa = [complex(x) for x in a] + [0j] * (n - len(a))
    fb = [complex(x) for x in b] + [0j] * (n - len(b))
    fft(fa); fft(fb)
    fc = [fa[i] * fb[i] for i in range(n)]
    fft(fc, inv=True)
    return [round(fc[i].real) for i in range(need)]

if __name__ == "__main__":
    print(multiply([1, 2, 3], [4, 5, 6]))   # [4, 13, 28, 27, 18]
```

---

### Challenge 2 — Big-integer multiplication via convolution

**Problem.** Multiply two non-negative integers given as decimal strings. Use FFT/convolution on the digits, then propagate carries.

#### Go
```go
package main

import (
	"fmt"
	"strings"
)

// reuse multiply() from Challenge 1 (FFT convolution of int slices)

func mulBig(x, y string) string {
	a := make([]int, len(x))
	b := make([]int, len(y))
	for i := 0; i < len(x); i++ {
		a[i] = int(x[len(x)-1-i] - '0') // little-endian digits
	}
	for i := 0; i < len(y); i++ {
		b[i] = int(y[len(y)-1-i] - '0')
	}
	c := multiply(a, b) // from Challenge 1
	carry := 0
	for i := 0; i < len(c); i++ {
		c[i] += carry
		carry = c[i] / 10
		c[i] %= 10
	}
	for carry > 0 {
		c = append(c, carry%10)
		carry /= 10
	}
	var sb strings.Builder
	i := len(c) - 1
	for i > 0 && c[i] == 0 {
		i--
	}
	for ; i >= 0; i-- {
		sb.WriteByte(byte('0' + c[i]))
	}
	return sb.String()
}

func main() {
	fmt.Println(mulBig("123456789", "987654321")) // 121932631112635269
}
```

#### Java
```java
public class Challenge2 {
    // reuse multiply(int[],int[]) from Challenge1

    static String mulBig(String x, String y) {
        int[] a = new int[x.length()], b = new int[y.length()];
        for (int i = 0; i < x.length(); i++) a[i] = x.charAt(x.length() - 1 - i) - '0';
        for (int i = 0; i < y.length(); i++) b[i] = y.charAt(y.length() - 1 - i) - '0';
        long[] c = Challenge1.multiply(a, b);
        long carry = 0;
        StringBuilder digits = new StringBuilder();
        for (long v : c) {
            long cur = v + carry;
            digits.append(cur % 10);
            carry = cur / 10;
        }
        while (carry > 0) { digits.append(carry % 10); carry /= 10; }
        while (digits.length() > 1 && digits.charAt(digits.length() - 1) == '0')
            digits.deleteCharAt(digits.length() - 1);
        return digits.reverse().toString();
    }

    public static void main(String[] args) {
        System.out.println(mulBig("123456789", "987654321")); // 121932631112635269
    }
}
```

#### Python
```python
# reuse multiply() from Challenge 1

def mul_big(x, y):
    a = [int(d) for d in reversed(x)]
    b = [int(d) for d in reversed(y)]
    c = multiply(a, b)
    carry = 0
    out = []
    for v in c:
        cur = v + carry
        out.append(cur % 10)
        carry = cur // 10
    while carry:
        out.append(carry % 10)
        carry //= 10
    while len(out) > 1 and out[-1] == 0:
        out.pop()
    return "".join(str(d) for d in reversed(out))

if __name__ == "__main__":
    print(mul_big("123456789", "987654321"))   # 121932631112635269
```

---

### Challenge 3 — NTT convolution (exact, mod 998244353)

**Problem.** Convolve two integer arrays exactly modulo `p = 998244353`.

#### Go
```go
package main

import "fmt"

const MOD, G = 998244353, 3

func power(a, b int64) int64 {
	r := int64(1)
	a %= MOD
	for b > 0 {
		if b&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		b >>= 1
	}
	return r
}

func ntt(a []int64, inv bool) {
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
	for l := 2; l <= n; l <<= 1 {
		wl := power(G, (MOD-1)/int64(l))
		if inv {
			wl = power(wl, MOD-2)
		}
		for i := 0; i < n; i += l {
			w := int64(1)
			for k := 0; k < l/2; k++ {
				u := a[i+k]
				v := a[i+k+l/2] * w % MOD
				a[i+k] = (u + v) % MOD
				a[i+k+l/2] = (u - v + MOD) % MOD
				w = w * wl % MOD
			}
		}
	}
	if inv {
		ni := power(int64(n), MOD-2)
		for i := range a {
			a[i] = a[i] * ni % MOD
		}
	}
}

func convolve(a, b []int64) []int64 {
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
	fmt.Println(convolve([]int64{1, 2, 3}, []int64{4, 5, 6})) // [4 13 28 27 18]
}
```

#### Java
```java
import java.util.*;

public class Challenge3 {
    static final long MOD = 998244353, G = 3;
    static long power(long a, long b) {
        long r = 1; a %= MOD;
        while (b > 0) { if ((b & 1) == 1) r = r * a % MOD; a = a * a % MOD; b >>= 1; }
        return r;
    }
    static void ntt(long[] a, boolean inv) {
        int n = a.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { long t = a[i]; a[i] = a[j]; a[j] = t; }
        }
        for (int l = 2; l <= n; l <<= 1) {
            long wl = power(G, (MOD - 1) / l);
            if (inv) wl = power(wl, MOD - 2);
            for (int i = 0; i < n; i += l) {
                long w = 1;
                for (int k = 0; k < l / 2; k++) {
                    long u = a[i + k], v = a[i + k + l / 2] * w % MOD;
                    a[i + k] = (u + v) % MOD;
                    a[i + k + l / 2] = (u - v + MOD) % MOD;
                    w = w * wl % MOD;
                }
            }
        }
        if (inv) { long ni = power(n, MOD - 2);
            for (int i = 0; i < n; i++) a[i] = a[i] * ni % MOD; }
    }
    static long[] convolve(long[] a, long[] b) {
        int need = a.length + b.length - 1, n = 1;
        while (n < need) n <<= 1;
        long[] fa = Arrays.copyOf(a, n), fb = Arrays.copyOf(b, n);
        ntt(fa, false); ntt(fb, false);
        for (int i = 0; i < n; i++) fa[i] = fa[i] * fb[i] % MOD;
        ntt(fa, true);
        return Arrays.copyOf(fa, need);
    }
    public static void main(String[] args) {
        System.out.println(Arrays.toString(convolve(new long[]{1,2,3}, new long[]{4,5,6})));
    }
}
```

#### Python
```python
MOD, G = 998244353, 3
def power(a, b):
    r = 1; a %= MOD
    while b:
        if b & 1: r = r * a % MOD
        a = a * a % MOD; b >>= 1
    return r
def ntt(a, inv=False):
    n = len(a); j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit: j ^= bit; bit >>= 1
        j ^= bit
        if i < j: a[i], a[j] = a[j], a[i]
    l = 2
    while l <= n:
        wl = power(G, (MOD - 1) // l)
        if inv: wl = power(wl, MOD - 2)
        for i in range(0, n, l):
            w = 1
            for k in range(l // 2):
                u = a[i + k]; v = a[i + k + l // 2] * w % MOD
                a[i + k] = (u + v) % MOD
                a[i + k + l // 2] = (u - v) % MOD
                w = w * wl % MOD
        l <<= 1
    if inv:
        ni = power(n, MOD - 2)
        for i in range(n): a[i] = a[i] * ni % MOD
def convolve(a, b):
    need = len(a) + len(b) - 1; n = 1
    while n < need: n <<= 1
    fa = a + [0] * (n - len(a)); fb = b + [0] * (n - len(b))
    ntt(fa); ntt(fb)
    fc = [fa[i] * fb[i] % MOD for i in range(n)]
    ntt(fc, inv=True)
    return fc[:need]
if __name__ == "__main__":
    print(convolve([1, 2, 3], [4, 5, 6]))   # [4, 13, 28, 27, 18]
```

---

### Challenge 4 — Count pairs with a target sum via convolution

**Problem.** Given an array of non-negative integers with values `≤ V`, count, for every `s`, the number of ordered pairs `(i, j)` with `value[i] + value[j] = s`. Build a frequency vector `f` (`f[v]` = count of value `v`) and convolve `f` with itself: `(f ∗ f)[s]` is the answer.

#### Go
```go
package main

import "fmt"

// reuse multiply() from Challenge 1

func pairSums(vals []int, V int) []int {
	f := make([]int, V+1)
	for _, v := range vals {
		f[v]++
	}
	return multiply(f, f) // (f * f)[s] = #ordered pairs summing to s
}

func main() {
	fmt.Println(pairSums([]int{0, 1, 1, 2}, 2)) // counts per sum 0..4
}
```

#### Java
```java
public class Challenge4 {
    static long[] pairSums(int[] vals, int V) {
        int[] f = new int[V + 1];
        for (int v : vals) f[v]++;
        return Challenge1.multiply(f, f);
    }
    public static void main(String[] args) {
        long[] r = pairSums(new int[]{0, 1, 1, 2}, 2);
        System.out.println(java.util.Arrays.toString(r));
    }
}
```

#### Python
```python
# reuse multiply() from Challenge 1

def pair_sums(vals, V):
    f = [0] * (V + 1)
    for v in vals:
        f[v] += 1
    return multiply(f, f)   # (f*f)[s] = ordered pairs summing to s

if __name__ == "__main__":
    print(pair_sums([0, 1, 1, 2], 2))   # counts per sum 0..4
```

---

## Final Tips

- Lead with the **two-representations insight** and the **convolution theorem** — that's the "aha" interviewers want.
- State the recurrence `T(n)=2T(n/2)+O(n)=O(n log n)` and tie it to the halving property of roots of unity.
- Mention **padding to a power of two `≥ len(a)+len(b)−1`** and the **`1/n` inverse scaling** unprompted — they are the top two bugs.
- Know **when to switch to NTT** (exact/modular) and **when Karatsuba wins** (medium `n`).
- For coding rounds, the iterative in-place FFT/NTT is compact and fast; memorize the bit-reversal loop and the butterfly.
