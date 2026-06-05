# Number-Theoretic Transform (NTT) — Interview Preparation

NTT is a favourite advanced-interview topic because it rewards a single crisp insight — *"NTT is FFT in `Z/pZ`: replace `e^{2πi/n}` with `ω = g^{(p-1)/n} mod p` and get exact convolution mod a prime"* — and then tests whether you can (a) explain why a special **NTT-friendly prime** `p = c·2^k + 1` is required, (b) write the **iterative** transform and its **inverse** (the `n^{-1}` scaling), (c) handle an **arbitrary modulus** via **multiple NTT primes + CRT**, and (d) avoid the silent traps (under-padding, missing scale, too few CRT primes). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions. The butterfly itself is shared with `15-divide-and-conquer/05-fft`.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Multiply polynomials mod a friendly prime | single NTT | `O(n log n)` |
| Multiply mod arbitrary `M` (e.g. `10^9+7`) | 3-prime NTT + CRT | `O(n log n)` |
| Big-integer multiply | NTT on digit arrays + carry | `O(n log n)` |
| Count pairs / shifts via convolution | NTT | `O(n log n)` |
| Build `n`-th root from `(p, g)` | `ω = g^{(p-1)/n} mod p` | `O(log p)` |
| Inverse transform | forward with `ω^{-1}`, then `× n^{-1}` | `O(n log n)` |

```text
NTT essentials
  friendly prime : p = c·2^k + 1   (998244353 = 119·2^23+1, g = 3)
  n-th root      : ω = g^((p-1)/n) mod p ,  needs n | (p-1) , n = 2^L ≤ 2^k
  halving prop   : ω^(n/2) = -1 (mod p)
  forward NTT    : â[t] = Σ a[m] ω^(tm)
  inverse NTT    : a[m] = n^{-1} Σ â[t] ω^(-tm)
  multiply       : pad to n ≥ len(a)+len(b)-1 (power of 2);
                   NTT(a), NTT(b); pointwise; INTT; trim
  arbitrary M    : run under p1,p2,p3 ; CRT each coeff ; reduce mod M
  CRT bound      : Πp_r > n · max|a| · max|b|
```

Key facts:
- **Exact** integer arithmetic mod `p` — zero floating-point rounding (the FFT failure mode NTT eliminates).
- `n` must be a **power of two** and `≥ len(a)+len(b)−1` (else cyclic wraparound).
- Forget the `n^{-1}` scaling → every coefficient is `n×` too large.
- Non-friendly modulus → **multiple primes + CRT** (sibling `05-crt`, `15-garner-algorithm`).

---

## Junior Questions (10 Q&A)

### J1. What is the NTT in one sentence?
The Number-Theoretic Transform is the FFT performed in the finite field `Z/pZ` instead of with complex numbers: it replaces the complex root of unity `e^{2πi/n}` with a primitive `n`-th root of unity `ω` in `Z/pZ`, giving **exact** convolution mod `p` with no rounding error.

### J2. What problem does NTT solve?
Polynomial multiplication, equivalently convolution of integer arrays, in `O(n log n)` instead of the schoolbook `O(n²)` — and exactly modulo a prime, which FFT cannot guarantee because of floating-point rounding.

### J3. Why can't you just use FFT for an exact modular answer?
FFT uses `double` complex arithmetic, so the output coefficients come out with rounding error (e.g. `41999.9999998`) and must be rounded. For large coefficients or large `n`, that rounding can be off by `1` and silently corrupt the exact mod-`p` result. NTT stays in integers, so nothing rounds.

### J4. What is an NTT-friendly prime?
A prime of the form `p = c·2^k + 1`, so `p − 1 = c·2^k` is divisible by `2^k`. This guarantees `Z/pZ` contains a primitive `2^k`-th root of unity, which the power-of-two butterfly needs. The classic one is `998244353 = 119·2^23 + 1` with primitive root `g = 3`.

### J5. How do you get the `n`-th root of unity `ω`?
From a primitive root `g` of the prime: `ω = g^{(p-1)/n} mod p`, valid when `n | (p − 1)`. Then `ω^n ≡ 1` (Fermat) and `ω` has order exactly `n`.

### J6. What are the three steps of an NTT-based multiply?
Evaluate (forward-transform both inputs), multiply pointwise, interpolate (inverse-transform). A product of polynomials in coefficient space becomes a cheap pointwise product in evaluation space.

### J7. Why pad to a power of two?
The butterfly halves the size repeatedly, so `n` must be `2^L`. Also `n` must be at least `len(a) + len(b) − 1` so the linear convolution does not wrap around cyclically.

### J8. What is the inverse transform?
The same transform run with `ω^{-1}` instead of `ω`, followed by multiplying every entry by `n^{-1} mod p`. That `n^{-1}` is the modular version of FFT's "divide by `n`".

### J9. What is the time complexity?
`O(n log n)` for each transform (same as FFT), `O(n)` for the pointwise step. A full multiply (two forward, one inverse, one pointwise) is `O(n log n)`, with `n` rounded up to the next power of two `≥ len(a)+len(b)−1`.

### J10 (analysis). Why is the result exact while FFT's is approximate?
Every NTT operation is integer arithmetic mod `p`, which is exact and has no representation error. FFT operates in `C` with finite-precision floating point, accumulating rounding that must be corrected by rounding the output — a step that can fail.

---

## Middle Questions (10 Q&A)

### M1. Write the iterative NTT structure.
Permute the array into bit-reversed order, then run `log n` butterfly stages bottom-up. Stage with half-size `len/2` uses root `wlen = g^{(p-1)/len}`; the inner butterfly is `(u + w·v, u − w·v) mod p` with `w` stepping through powers of `wlen`. The butterfly is the same as FFT (`05-fft`); only the arithmetic is modular.

### M2. What is the bit-reversal permutation and why is it needed?
It reorders index `i` to `rev(i)` (the `L`-bit reversal of `i`). The recursion's even/odd splitting, done once up front, leaves the leaves in bit-reversed order; the iterative version applies that permutation so the bottom-up butterflies operate on the right pairs in place with `O(1)` extra space.

### M3. How do you multiply mod an arbitrary modulus like `10^9 + 7`?
`10^9 + 7` is not NTT-friendly (only one factor of two in `10^9 + 6`). Run the convolution under several friendly primes (e.g. `998244353, 985661441, 469762049`), CRT-combine each output coefficient to the exact integer, then reduce mod `10^9 + 7`. Pointer: sibling `05-crt`, `15-garner-algorithm`.

### M4. How many CRT primes do you need?
Enough that their product exceeds the largest true coefficient `max_k c[k] = n · max|a| · max|b|`. For `M ≈ 10^9` and `n ≈ 10^5`, `max c[k] < 10^{23}`; three primes near `10^9` give `> 10^{27}`, which is safe. Two primes (`~10^{18}`) fail for large `n` — and fail silently.

### M5. What goes wrong if you under-pad `n`?
You get the **cyclic** convolution of period `n` instead of the linear one: high-degree coefficients wrap around and add onto low-degree ones. No crash, just a wrong answer. Always pad to `n ≥ len(a)+len(b)−1`, rounded up to a power of two.

### M6. How do you build the inverse root `ω^{-1}`?
By Fermat, `ω^{-1} = pow(ω, p-2, p)`. Equivalently use `g^{-1} = g^{p-2}` as the base primitive root for inverse stages, so `wlen_inv = (g^{-1})^{(p-1)/len}`.

### M7. Why does the inverse need the `n^{-1}` scaling, mathematically?
The transform is a Vandermonde matrix `V` with `V[t][m] = ω^{tm}`; its inverse is `V^{-1}[m][t] = n^{-1} ω^{-tm}`. The `n^{-1}` comes from the orthogonality identity `Σ_t ω^{td} = n·[n | d]`, which produces a factor of `n` that must be divided out. (Proof in `professional.md`.)

### M8. Which `(p, g)` pairs should you memorize?
`998244353` with `g = 3` (supports `n ≤ 2^23`) is the must-know. For the CRT set, `985661441 (g=3)` and `469762049 (g=3)`. For larger `n`, `469762049` (`2^26`) or `2013265921` (`g=31`, `2^27`, but `> 2^30` so products need care).

### M9. How do you test an NTT implementation?
Against a schoolbook `O(n²)` convolution oracle on random small arrays, under each prime and the CRT-combined result. Also: round-trip `intt(ntt(a)) == a`, multiply-by-unit `multiply(a, [1]) == a`, and a CRT-bound assertion `Πp_r > n·max|a|·max|b|`.

### M10 (analysis). What is the convolution theorem over `Z/pZ`?
`NTT(a ⊛ b) = NTT(a) ∘ NTT(b)`, where `⊛` is cyclic convolution and `∘` is pointwise product. It holds verbatim mod `p` because the proof uses only `ω^n = 1` and the geometric-series cancellation, both valid in the finite field. Padding makes the cyclic convolution equal the linear one.

---

## Senior Questions (8 Q&A)

### S1. How do you choose the NTT prime?
By the 2-adic valuation `k` of `p − 1`: `2^k` must be `≥` the max transform length. Prefer `p < 2^31` so a butterfly product of two residues stays `< 2^62` (inside `int64`), avoiding 128-bit math. Keep a known primitive root `g` so you do not compute it at runtime (sibling `12`).

### S2. CRT vs coefficient splitting — when each?
For exact arbitrary-modulus convolution: **3-prime NTT + CRT** is integer-only, deterministic, parallelizable — the senior default. **Complex-FFT coefficient splitting** reuses an FFT toolchain and can use fewer transforms, but risks floating-point rounding at scale. Choose CRT when exactness and reproducibility matter; splitting only with a vetted FP error budget.

### S3. How do you speed up the inner butterfly?
The `% p` (modular reduction) dominates. Use **Montgomery** (sibling `14-montgomery-multiplication`) or **Barrett** reduction to replace division with multiply-shift, keeping residues in Montgomery form across the whole transform. Also **precompute the twiddle table** once per size instead of exponentiating per stage.

### S4. How do you handle `n` exceeding a prime's `2^k` ceiling?
Switch to a higher-valuation prime (e.g. `469762049` at `2^26`, `2013265921` at `2^27`), or split the inputs into blocks and convolve block-wise then combine. Always assert `n ≤ 2^k`; otherwise `(p-1)/n` is not an integer exponent and the "root" has the wrong order, producing garbage.

### S5. How do you avoid overflow in the 3-prime CRT?
The product of three ~`10^9` primes is `> 10^{27}`, overflowing `int64`. Use **Garner's** incremental mixed-radix CRT (sibling `15-garner-algorithm`), which builds the answer in pieces and reduces mod the target `M` without forming the giant product, or use big integers / 128-bit intermediates.

### S6. What are the silent failure modes of NTT?
Under-padding (cyclic wraparound), missing `n^{-1}` scaling (`n×` too large), wrong/too-small prime (wrong-order root), too few CRT primes (reconstruction wraps), un-reduced/negative inputs, and reusing `ω` instead of `ω^{-1}` in the inverse. All produce wrong answers without crashing — guard each with an assertion and the schoolbook oracle.

### S7. How does NTT relate to FFT and to big-integer multiplication?
Same `O(n log n)` Cooley-Tukey butterfly (`05-fft`); NTT trades `C`'s "any root exists" convenience for exactness, at the cost of needing `n | (p−1)`. Integer multiplication reduces to convolution of digit vectors, so NTT (recursively, over suitable rings) underlies Schönhage-Strassen-style fast big-int multiply (sibling `27-bigint-arithmetic`).

### S8 (analysis). Why does a primitive `n`-th root exist only when `n | (p − 1)`?
`Z/pZ*` is cyclic of order `p − 1`. In a cyclic group of order `m`, an element of order `d` exists iff `d | m`. With `m = p − 1`, an order-`n` element exists iff `n | (p − 1)`, and it is `g^{(p-1)/n}`. Power-of-two `n` therefore needs `2^k | (p−1)`, the definition of an NTT-friendly prime.

---

## Professional Questions (6 Q&A)

### P1. Design a library function `convolve(a, b, M)` for any modulus `M`.
If `M` is NTT-friendly, single NTT. Otherwise pick a prime set whose product exceeds `n·max|a|·max|b|` (default three near-`10^9` primes), run independent NTTs per prime (parallelizable), CRT-combine each coefficient via Garner, reduce mod `M`. Validate inputs into `[0, p)`, assert the CRT bound, expose a schoolbook fallback for tiny `n` and as a test oracle.

### P2. Your NTT multiply gives wrong answers only on large inputs. Diagnose.
Almost certainly one of: under-padding (small cases fit, large ones wrap) — check `n ≥ len(a)+len(b)−1`; or too few CRT primes (`Πp_r` exceeded by `max c[k]` only at large `n`) — recompute the `n·B²` bound; or exceeding the prime's `2^k` ceiling. Reproduce against the schoolbook oracle at the smallest failing size and bisect.

### P3. How do you make NTT reproducible across machines and languages?
Use integer-only NTT (no `double` anywhere) with the same prime set and CRT; integer arithmetic mod `p` is deterministic, so Go/Java/Python produce identical coefficients on identical inputs. This is a key reason to prefer NTT+CRT over FFT-splitting for cross-platform exactness.

### P4. Where does NTT appear inside larger algorithms?
Polynomial inverse, division, multipoint evaluation/interpolation, and exp/log of power series (sibling `20-polynomial-operations`) all call NTT as their multiply primitive; big-integer multiplication (`27-bigint-arithmetic`); string matching and counting reduce to convolution; and Kitamasa-with-NTT computes a single linear-recurrence term in `O(r log r log k)` (cross-ref `15-divide-and-conquer` and matrix-exponentiation topics).

### P5. When is NTT the wrong tool?
Tiny `n` (schoolbook `O(n²)` wins below the crossover); approximate real-valued convolution where rounding is acceptable (complex FFT is simpler); or when the modulus is non-friendly *and* you cannot afford the 3× multi-prime overhead and have a vetted FFT-splitting path. Also when you actually need a real DFT spectrum, not a modular convolution.

### P6 (analysis). Prove the inverse NTT recovers the input.
Substitute the forward sum into the inverse and use root orthogonality `Σ_t ω^{t(m'-m)} = n·[m'≡m (mod n)]`: `n^{-1} Σ_t (Σ_{m'} a[m'] ω^{tm'}) ω^{-tm} = n^{-1} Σ_{m'} a[m'] · n·[m'=m] = a[m]`. The `n^{-1}·n = 1` is exactly why the inverse scales by `n^{-1}`. Full proof in `professional.md`.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing an `O(n²)` step with an `O(n log n)` one.
Look for a concrete story: a convolution/polynomial-multiply hot spot, a profile showing the quadratic loop dominating, the switch to NTT (or FFT), the modulus/exactness decision, and the measured speedup — plus a correctness check against the old `O(n²)` version on small inputs.

### B2. A teammate used complex FFT for an exact mod-`p` answer and shipped off-by-one coefficients. How do you respond?
Explain calmly that complex FFT rounds, and for large coefficients/`n` the rounding can flip a coefficient by `1`. Show that NTT (integer mod `p`) removes the entire class of bug, or that FFT needs a proven error bound and possibly coefficient splitting. Frame it as a teaching moment about exactness vs approximation, with a tiny reproducing case.

### B3. Design a service that multiplies huge polynomials mod an arbitrary user-supplied modulus.
3-prime NTT + CRT. Discuss: validating/reducing inputs, choosing the prime count from `n·B²`, parallelizing the per-prime transforms, Garner reconstruction to avoid big-int overhead, caching twiddle tables, and a schoolbook fallback for small inputs. Mention determinism as a selling point (reproducible across replicas).

### B4. How would you explain NTT to a junior who knows FFT?
"It's the exact same butterfly, but instead of the complex number `e^{2πi/n}` you use a special integer `ω = g^{(p-1)/n}` that behaves the same way mod a prime `p`. Because everything is integers mod `p`, there's no rounding — perfect for exact answers mod that prime. The only catch is `p` must be 'NTT-friendly': `p − 1` must be divisible by a big power of two." Lead with the two gotchas: pad to a power of two, and remember the `n^{-1}` scaling.

### B5. Your NTT job uses too much memory at scale. Investigate.
Each `int64` array of size `n` is `8n` bytes; check whether `n` ballooned past what padding requires, whether you allocate fresh buffers per multiply instead of reusing, and whether the 3-prime route holds three full transform sets simultaneously when it could stream them. Fix: reuse preallocated buffers, free per-prime arrays after CRT, cache twiddles read-only.

---

## Coding Challenges

### Challenge 1: Multiply Polynomials mod 998244353

**Problem.** Given coefficient arrays `a`, `b` (entries in `[0, p)`), return the coefficients of `A(x)·B(x)` mod `p = 998244353`. Length of result is `len(a) + len(b) − 1`.

**Example.**
```text
a = [1,2,3], b = [4,5,6]  ->  [4, 13, 28, 27, 18]
```

**Optimal.** Iterative NTT, `O(n log n)`.

**Go.**
```go
package main

import "fmt"

const MOD = 998244353
const G = 3

func power(a, e int64) int64 {
	a %= MOD
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
	fmt.Println(multiply([]int64{1, 2, 3}, []int64{4, 5, 6})) // [4 13 28 27 18]
}
```

**Java.**
```java
import java.util.*;

public class MulMod {
    static final long MOD = 998244353L, G = 3;

    static long power(long a, long e) {
        a %= MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
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
        for (int len = 2; len <= n; len <<= 1) {
            long wlen = power(G, (MOD - 1) / len);
            if (inv) wlen = power(wlen, MOD - 2);
            for (int i = 0; i < n; i += len) {
                long w = 1;
                for (int k = 0; k < len / 2; k++) {
                    long u = a[i + k], v = a[i + k + len / 2] * w % MOD;
                    a[i + k] = (u + v) % MOD;
                    a[i + k + len / 2] = (u - v + MOD) % MOD;
                    w = w * wlen % MOD;
                }
            }
        }
        if (inv) {
            long ninv = power(n, MOD - 2);
            for (int i = 0; i < n; i++) a[i] = a[i] * ninv % MOD;
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

**Python.**
```python
MOD = 998244353
G = 3


def power(a, e):
    a %= MOD; r = 1
    while e > 0:
        if e & 1:
            r = r * a % MOD
        a = a * a % MOD
        e >>= 1
    return r


def ntt(a, invert):
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
        wlen = power(G, (MOD - 1) // length)
        if invert:
            wlen = power(wlen, MOD - 2)
        for i in range(0, n, length):
            w = 1
            for k in range(length // 2):
                u = a[i + k]; v = a[i + k + length // 2] * w % MOD
                a[i + k] = (u + v) % MOD
                a[i + k + length // 2] = (u - v) % MOD
                w = w * wlen % MOD
        length <<= 1
    if invert:
        ninv = power(n, MOD - 2)
        for i in range(n):
            a[i] = a[i] * ninv % MOD


def multiply(a, b):
    need = len(a) + len(b) - 1; n = 1
    while n < need:
        n <<= 1
    fa = a + [0] * (n - len(a)); fb = b + [0] * (n - len(b))
    ntt(fa, False); ntt(fb, False)
    fc = [x * y % MOD for x, y in zip(fa, fb)]
    ntt(fc, True)
    return fc[:need]


if __name__ == "__main__":
    print(multiply([1, 2, 3], [4, 5, 6]))  # [4, 13, 28, 27, 18]
```

---

### Challenge 2: Big-Integer Multiplication via NTT

**Problem.** Multiply two non-negative big integers given as decimal strings. Treat digits as polynomial coefficients (base 10), convolve via NTT, then carry-propagate.

**Approach.** Coefficients are single decimal digits (`< 10`), so the max coefficient `c[k] < n·81 < 998244353` for `n` up to millions — a single friendly prime suffices, no CRT. After the inverse NTT, propagate carries base 10.

**Python.**
```python
MOD = 998244353
G = 3


def power(a, e):
    a %= MOD; r = 1
    while e > 0:
        if e & 1:
            r = r * a % MOD
        a = a * a % MOD
        e >>= 1
    return r


def ntt(a, invert):
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
        wlen = power(G, (MOD - 1) // length)
        if invert:
            wlen = power(wlen, MOD - 2)
        for i in range(0, n, length):
            w = 1
            for k in range(length // 2):
                u = a[i + k]; v = a[i + k + length // 2] * w % MOD
                a[i + k] = (u + v) % MOD
                a[i + k + length // 2] = (u - v) % MOD
                w = w * wlen % MOD
        length <<= 1
    if invert:
        ninv = power(n, MOD - 2)
        for i in range(n):
            a[i] = a[i] * ninv % MOD


def conv(a, b):
    need = len(a) + len(b) - 1; n = 1
    while n < need:
        n <<= 1
    fa = a + [0] * (n - len(a)); fb = b + [0] * (n - len(b))
    ntt(fa, False); ntt(fb, False)
    fc = [x * y % MOD for x, y in zip(fa, fb)]
    ntt(fc, True)
    return fc[:need]


def big_mul(x: str, y: str) -> str:
    if x == "0" or y == "0":
        return "0"
    a = [int(c) for c in reversed(x)]  # least-significant first
    b = [int(c) for c in reversed(y)]
    c = conv(a, b)
    carry = 0
    out = []
    for v in c:
        v += carry
        out.append(v % 10)
        carry = v // 10
    while carry:
        out.append(carry % 10)
        carry //= 10
    while len(out) > 1 and out[-1] == 0:
        out.pop()
    return "".join(str(d) for d in reversed(out))


if __name__ == "__main__":
    print(big_mul("12345678901234567890", "98765432109876543210"))
    assert big_mul("12345678901234567890", "98765432109876543210") == \
        str(12345678901234567890 * 98765432109876543210)
    print("ok")
```

**Go.**
```go
package main

import (
	"fmt"
	"strconv"
)

const MOD = 998244353
const G = 3

func power(a, e int64) int64 {
	a %= MOD
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
		ninv := power(int64(n), MOD-2)
		for i := range a {
			a[i] = a[i] * ninv % MOD
		}
	}
}

func conv(a, b []int64) []int64 {
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

func bigMul(x, y string) string {
	if x == "0" || y == "0" {
		return "0"
	}
	a := make([]int64, len(x))
	b := make([]int64, len(y))
	for i := 0; i < len(x); i++ {
		a[i] = int64(x[len(x)-1-i] - '0')
	}
	for i := 0; i < len(y); i++ {
		b[i] = int64(y[len(y)-1-i] - '0')
	}
	c := conv(a, b)
	carry := int64(0)
	out := []int64{}
	for _, v := range c {
		v += carry
		out = append(out, v%10)
		carry = v / 10
	}
	for carry > 0 {
		out = append(out, carry%10)
		carry /= 10
	}
	for len(out) > 1 && out[len(out)-1] == 0 {
		out = out[:len(out)-1]
	}
	s := ""
	for i := len(out) - 1; i >= 0; i-- {
		s += strconv.FormatInt(out[i], 10)
	}
	return s
}

func main() {
	fmt.Println(bigMul("123456789", "987654321")) // 121932631112635269
}
```

**Java.**
```java
import java.util.*;

public class BigMulNtt {
    static final long MOD = 998244353L, G = 3;

    static long power(long a, long e) {
        a %= MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
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
        for (int len = 2; len <= n; len <<= 1) {
            long wlen = power(G, (MOD - 1) / len);
            if (inv) wlen = power(wlen, MOD - 2);
            for (int i = 0; i < n; i += len) {
                long w = 1;
                for (int k = 0; k < len / 2; k++) {
                    long u = a[i + k], v = a[i + k + len / 2] * w % MOD;
                    a[i + k] = (u + v) % MOD;
                    a[i + k + len / 2] = (u - v + MOD) % MOD;
                    w = w * wlen % MOD;
                }
            }
        }
        if (inv) { long ninv = power(n, MOD - 2); for (int i = 0; i < n; i++) a[i] = a[i] * ninv % MOD; }
    }

    static long[] conv(long[] a, long[] b) {
        int need = a.length + b.length - 1, n = 1;
        while (n < need) n <<= 1;
        long[] fa = Arrays.copyOf(a, n), fb = Arrays.copyOf(b, n);
        ntt(fa, false); ntt(fb, false);
        for (int i = 0; i < n; i++) fa[i] = fa[i] * fb[i] % MOD;
        ntt(fa, true);
        return Arrays.copyOf(fa, need);
    }

    static String bigMul(String x, String y) {
        if (x.equals("0") || y.equals("0")) return "0";
        long[] a = new long[x.length()], b = new long[y.length()];
        for (int i = 0; i < x.length(); i++) a[i] = x.charAt(x.length() - 1 - i) - '0';
        for (int i = 0; i < y.length(); i++) b[i] = y.charAt(y.length() - 1 - i) - '0';
        long[] c = conv(a, b);
        long carry = 0;
        StringBuilder sb = new StringBuilder();
        ArrayList<Long> out = new ArrayList<>();
        for (long v : c) { v += carry; out.add(v % 10); carry = v / 10; }
        while (carry > 0) { out.add(carry % 10); carry /= 10; }
        int e = out.size() - 1;
        while (e > 0 && out.get(e) == 0) e--;
        for (int i = e; i >= 0; i--) sb.append(out.get(i));
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(bigMul("123456789", "987654321")); // 121932631112635269
    }
}
```

---

### Challenge 3: Arbitrary-Modulus Convolution via 3-Prime CRT

**Problem.** Given arrays `a`, `b` (entries up to `10^9`) and an arbitrary modulus `M`, return the convolution of `a` and `b` reduced mod `M`. `M` need not be NTT-friendly.

**Approach.** Convolve under three friendly primes, CRT-combine each coefficient to the exact integer (`< Πp_r`), reduce mod `M`. The `conv` routine is Challenge 1's, parameterized by `(p, g)`.

**Python.**
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


def crt(residues, primes):
    x = 0; mod = 1
    for r, p in zip(residues, primes):
        inv = pow(mod % p, -1, p)
        t = (r - x) % p * inv % p
        x += mod * t
        mod *= p
    return x


def convolve_mod(a, b, M):
    parts = [conv(a, b, p) for p in PRIMES]
    return [crt([parts[r][k] for r in range(3)], PRIMES) % M
            for k in range(len(parts[0]))]


if __name__ == "__main__":
    M = 10**9 + 7
    a = [10**9, 10**9, 10**9]
    b = [10**9, 10**9]
    got = convolve_mod(a, b, M)
    # oracle
    exp = [0] * (len(a) + len(b) - 1)
    for i, ai in enumerate(a):
        for j, bj in enumerate(b):
            exp[i + j] += ai * bj
    assert got == [e % M for e in exp]
    print(got, "ok")
```

**Go (CRT via math/big for clarity).**
```go
package main

import (
	"fmt"
	"math/big"
)

var PRIMES = []int64{998244353, 985661441, 469762049}

const G = 3

func power(a, e, mod int64) int64 {
	a %= mod
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func ntt(a []int64, invert bool, mod int64) {
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
		wlen := power(G, (mod-1)/int64(length), mod)
		if invert {
			wlen = power(wlen, mod-2, mod)
		}
		for i := 0; i < n; i += length {
			w := int64(1)
			for k := 0; k < length/2; k++ {
				u := a[i+k]
				v := a[i+k+length/2] * w % mod
				a[i+k] = (u + v) % mod
				a[i+k+length/2] = (u - v + mod) % mod
				w = w * wlen % mod
			}
		}
	}
	if invert {
		ninv := power(int64(n), mod-2, mod)
		for i := range a {
			a[i] = a[i] * ninv % mod
		}
	}
}

func conv(a, b []int64, mod int64) []int64 {
	need := len(a) + len(b) - 1
	n := 1
	for n < need {
		n <<= 1
	}
	fa := make([]int64, n)
	fb := make([]int64, n)
	copy(fa, a)
	copy(fb, b)
	ntt(fa, false, mod)
	ntt(fb, false, mod)
	for i := 0; i < n; i++ {
		fa[i] = fa[i] * fb[i] % mod
	}
	ntt(fa, true, mod)
	return fa[:need]
}

func convolveMod(a, b []int64, M int64) []int64 {
	parts := make([][]int64, 3)
	for r := 0; r < 3; r++ {
		parts[r] = conv(a, b, PRIMES[r])
	}
	bigM := big.NewInt(M)
	res := make([]int64, len(parts[0]))
	for k := range parts[0] {
		x := big.NewInt(0)
		mod := big.NewInt(1)
		for r := 0; r < 3; r++ {
			pi := big.NewInt(PRIMES[r])
			ri := big.NewInt(parts[r][k])
			inv := new(big.Int).ModInverse(new(big.Int).Mod(mod, pi), pi)
			t := new(big.Int).Sub(ri, x)
			t.Mul(t, inv)
			t.Mod(t, pi)
			x.Add(x, new(big.Int).Mul(mod, t))
			mod.Mul(mod, pi)
		}
		res[k] = new(big.Int).Mod(x, bigM).Int64()
	}
	return res
}

func main() {
	M := int64(1_000_000_007)
	a := []int64{1_000_000_000, 1_000_000_000, 1_000_000_000}
	b := []int64{1_000_000_000, 1_000_000_000}
	fmt.Println(convolveMod(a, b, M))
}
```

**Java (CRT via BigInteger).**
```java
import java.math.BigInteger;
import java.util.*;

public class ConvCrt {
    static final long[] PRIMES = {998244353L, 985661441L, 469762049L};
    static final long G = 3;

    static long power(long a, long e, long mod) {
        a %= mod; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % mod; a = a * a % mod; e >>= 1; }
        return r;
    }

    static void ntt(long[] a, boolean inv, long mod) {
        int n = a.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { long t = a[i]; a[i] = a[j]; a[j] = t; }
        }
        for (int len = 2; len <= n; len <<= 1) {
            long wlen = power(G, (mod - 1) / len, mod);
            if (inv) wlen = power(wlen, mod - 2, mod);
            for (int i = 0; i < n; i += len) {
                long w = 1;
                for (int k = 0; k < len / 2; k++) {
                    long u = a[i + k], v = a[i + k + len / 2] * w % mod;
                    a[i + k] = (u + v) % mod;
                    a[i + k + len / 2] = (u - v + mod) % mod;
                    w = w * wlen % mod;
                }
            }
        }
        if (inv) { long ninv = power(n, mod - 2, mod); for (int i = 0; i < n; i++) a[i] = a[i] * ninv % mod; }
    }

    static long[] conv(long[] a, long[] b, long mod) {
        int need = a.length + b.length - 1, n = 1;
        while (n < need) n <<= 1;
        long[] fa = Arrays.copyOf(a, n), fb = Arrays.copyOf(b, n);
        ntt(fa, false, mod); ntt(fb, false, mod);
        for (int i = 0; i < n; i++) fa[i] = fa[i] * fb[i] % mod;
        ntt(fa, true, mod);
        return Arrays.copyOf(fa, need);
    }

    static long[] convolveMod(long[] a, long[] b, long M) {
        long[][] parts = new long[3][];
        for (int r = 0; r < 3; r++) {
            long p = PRIMES[r];
            long[] ar = new long[a.length], br = new long[b.length];
            for (int i = 0; i < a.length; i++) ar[i] = ((a[i] % p) + p) % p;
            for (int i = 0; i < b.length; i++) br[i] = ((b[i] % p) + p) % p;
            parts[r] = conv(ar, br, p);
        }
        BigInteger bm = BigInteger.valueOf(M);
        long[] out = new long[parts[0].length];
        for (int k = 0; k < out.length; k++) {
            BigInteger x = BigInteger.ZERO, mod = BigInteger.ONE;
            for (int r = 0; r < 3; r++) {
                BigInteger pi = BigInteger.valueOf(PRIMES[r]);
                BigInteger ri = BigInteger.valueOf(parts[r][k]);
                BigInteger invv = mod.mod(pi).modInverse(pi);
                BigInteger t = ri.subtract(x).multiply(invv).mod(pi);
                x = x.add(mod.multiply(t));
                mod = mod.multiply(pi);
            }
            out[k] = x.mod(bm).longValueExact();
        }
        return out;
    }

    public static void main(String[] args) {
        long M = 1_000_000_007L;
        long[] a = {1_000_000_000L, 1_000_000_000L, 1_000_000_000L};
        long[] b = {1_000_000_000L, 1_000_000_000L};
        System.out.println(Arrays.toString(convolveMod(a, b, M)));
    }
}
```

---

### Challenge 4: Count Pairs with a Given Sum via Convolution

**Problem.** Given an array of non-negative integers `x` with values in `[0, V)`, for every possible sum `s` count the number of **ordered** pairs `(i, j)` (including `i == j`) with `x[i] + x[j] = s`. Output the count for each `s ∈ [0, 2V−2]`, mod `998244353`.

**Approach.** Build the frequency array `f` where `f[v]` = how many elements equal `v`. The convolution `f ⊛ f` has `(f ⊛ f)[s] = Σ_{u+w=s} f[u]·f[w]` = number of ordered pairs summing to `s`. One NTT self-convolution does it in `O(V log V)`.

**Python.**
```python
MOD = 998244353
G = 3


def power(a, e):
    a %= MOD; r = 1
    while e > 0:
        if e & 1:
            r = r * a % MOD
        a = a * a % MOD
        e >>= 1
    return r


def ntt(a, invert):
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
        wlen = power(G, (MOD - 1) // length)
        if invert:
            wlen = power(wlen, MOD - 2)
        for i in range(0, n, length):
            w = 1
            for k in range(length // 2):
                u = a[i + k]; v = a[i + k + length // 2] * w % MOD
                a[i + k] = (u + v) % MOD
                a[i + k + length // 2] = (u - v) % MOD
                w = w * wlen % MOD
        length <<= 1
    if invert:
        ninv = power(n, MOD - 2)
        for i in range(n):
            a[i] = a[i] * ninv % MOD


def count_pair_sums(x, V):
    f = [0] * V
    for v in x:
        f[v] += 1
    need = 2 * V - 1
    n = 1
    while n < need:
        n <<= 1
    fa = f + [0] * (n - V)
    ntt(fa, False)
    fa = [v * v % MOD for v in fa]
    ntt(fa, True)
    return fa[:need]


if __name__ == "__main__":
    x = [1, 2, 2, 3]
    V = 4
    res = count_pair_sums(x, V)
    # brute oracle
    exp = [0] * (2 * V - 1)
    for i in range(len(x)):
        for j in range(len(x)):
            exp[x[i] + x[j]] += 1
    assert res == exp
    print(res, "ok")
```

**Go.**
```go
package main

import "fmt"

const MOD = 998244353
const G = 3

func power(a, e int64) int64 {
	a %= MOD
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
		ninv := power(int64(n), MOD-2)
		for i := range a {
			a[i] = a[i] * ninv % MOD
		}
	}
}

func countPairSums(x []int, V int) []int64 {
	f := make([]int64, V)
	for _, v := range x {
		f[v]++
	}
	need := 2*V - 1
	n := 1
	for n < need {
		n <<= 1
	}
	fa := make([]int64, n)
	copy(fa, f)
	ntt(fa, false)
	for i := range fa {
		fa[i] = fa[i] * fa[i] % MOD
	}
	ntt(fa, true)
	return fa[:need]
}

func main() {
	fmt.Println(countPairSums([]int{1, 2, 2, 3}, 4))
}
```

**Java.**
```java
import java.util.*;

public class PairSums {
    static final long MOD = 998244353L, G = 3;

    static long power(long a, long e) {
        a %= MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
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
        for (int len = 2; len <= n; len <<= 1) {
            long wlen = power(G, (MOD - 1) / len);
            if (inv) wlen = power(wlen, MOD - 2);
            for (int i = 0; i < n; i += len) {
                long w = 1;
                for (int k = 0; k < len / 2; k++) {
                    long u = a[i + k], v = a[i + k + len / 2] * w % MOD;
                    a[i + k] = (u + v) % MOD;
                    a[i + k + len / 2] = (u - v + MOD) % MOD;
                    w = w * wlen % MOD;
                }
            }
        }
        if (inv) { long ninv = power(n, MOD - 2); for (int i = 0; i < n; i++) a[i] = a[i] * ninv % MOD; }
    }

    static long[] countPairSums(int[] x, int V) {
        long[] f = new long[V];
        for (int v : x) f[v]++;
        int need = 2 * V - 1, n = 1;
        while (n < need) n <<= 1;
        long[] fa = Arrays.copyOf(f, n);
        ntt(fa, false);
        for (int i = 0; i < n; i++) fa[i] = fa[i] * fa[i] % MOD;
        ntt(fa, true);
        return Arrays.copyOf(fa, need);
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(countPairSums(new int[]{1, 2, 2, 3}, 4)));
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"NTT is FFT in `Z/pZ` — replace `e^{2πi/n}` with `ω = g^{(p-1)/n} mod p` for exact convolution mod a prime."*
- Immediately flag the requirements: an **NTT-friendly prime** `p = c·2^k + 1` (`998244353`, `g = 3`), **pad to a power of two**, and the **`n^{-1}` scaling** in the inverse.
- For a non-friendly modulus, reach for **multiple primes + CRT** (sibling `05-crt`, `15-garner-algorithm`); state the prime-count bound `Πp_r > n·max|a|·max|b|`.
- Do not re-derive the butterfly — cite `15-divide-and-conquer/05-fft` for the shared structure; emphasize the *number-theory* (root existence, friendly primes, CRT).
- Always offer to verify against a schoolbook `O(n²)` convolution oracle on small inputs.
