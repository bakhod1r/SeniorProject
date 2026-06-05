# Number-Theoretic Transform (NTT) — Middle Level

> **Focus:** The iterative in-place NTT (bit-reversal + butterfly loop), the inverse transform, full polynomial multiply mod a friendly prime, and — the headline middle-level skill — convolution for an **arbitrary** modulus via multiple NTT primes recombined with CRT. A common primes/roots table is included.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Iterative NTT: Bit-Reversal + Butterfly](#iterative-ntt-bit-reversal--butterfly)
4. [The Inverse Transform](#the-inverse-transform)
5. [Common NTT Primes and Roots](#common-ntt-primes-and-roots)
6. [Arbitrary-Modulus Convolution via Multiple Primes + CRT](#arbitrary-modulus-convolution-via-multiple-primes--crt)
7. [Code Examples](#code-examples)
8. [Comparison with Alternatives](#comparison-with-alternatives)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: NTT is FFT done in `Z/pZ`, replacing the complex root of unity with a primitive `n`-th root `ω = g^{(p-1)/n} mod p`, giving exact convolution mod `p`. At middle level you start writing the version you actually ship and asking the engineering questions:

- The recursive NTT in `junior.md` allocates two arrays per level and is slow. How do you make it **iterative and in-place** — the standard competitive/production form?
- What is the **bit-reversal permutation** and why does the iterative butterfly need it? (The butterfly itself is derived in `15-divide-and-conquer/05-fft`; we reuse it.)
- The **inverse transform** is "forward with `ω^{-1}`, then scale by `n^{-1}`" — how do you implement and test that cleanly?
- Your problem demands the answer mod `10^9 + 7`, which is **not** NTT-friendly (`10^9 + 6 = 2 · 500000003`, only one factor of two). How do you still get exact convolution? The answer is **multiple NTT primes + CRT** (pointer to `05-crt` and `15-garner-algorithm`).
- Which `(p, g)` pairs should you keep in your toolkit, and how large an `n` does each support?

These are the questions that separate "I understand NTT" from "I can drop a tested NTT-based multiply into any modular convolution problem."

---

## Deeper Concepts

### The transform is a change of basis, and it is its own inverse up to scaling

The forward NTT maps the coefficient vector `a` to its evaluations `â[t] = A(ω^t) = Σ_m a[m] ω^{tm} (mod p)`. This is a linear map: a Vandermonde matrix `V` with `V[t][m] = ω^{tm}`. The inverse map is `V^{-1}`, and a one-line computation (using the geometric-series identity `Σ_t ω^{t(m-m')} = n·[m = m']`) shows

```
V^{-1}[m][t] = (1/n) · ω^{-tm}.
```

So the inverse transform is *the same butterfly* with `ω` replaced by `ω^{-1}`, followed by a global multiply by `n^{-1} mod p`. This is exactly the FFT structure (`05-fft`), with `1/n` becoming the modular inverse `n^{-1}`. Because `n` is a power of two and `p` is an odd prime, `n^{-1} mod p` always exists.

### Why pad to a power of two, and why "linear" not "cyclic"

The transform of size `n` computes a **cyclic** convolution of period `n`: index arithmetic wraps mod `n`. To recover the ordinary (linear) polynomial product, whose result has `len(a) + len(b) − 1` coefficients, you must pad both inputs with zeros so that `n ≥ len(a) + len(b) − 1`. If `n` is too small, high-degree terms wrap around and corrupt low-degree coefficients — the single most common "wrong answer, no crash" NTT bug. Rounding `n` up to a power of two also satisfies the butterfly's structural requirement.

### The convolution theorem over a finite field

The whole method rests on: `NTT(a ⊛ b) = NTT(a) ∘ NTT(b)`, where `⊛` is cyclic convolution and `∘` is pointwise product. This holds verbatim over `Z/pZ` once `ω` is a primitive `n`-th root of unity — the proof is identical to the complex case because it only uses `ω^n = 1` and the geometric-series cancellation, both of which hold mod `p`. The formal statement and proof are in [`professional.md`](./professional.md).

---

## Iterative NTT: Bit-Reversal + Butterfly

The recursive NTT splits even/odd indices at each level. The iterative version does the splitting *once*, up front, by permuting the array into **bit-reversed order**, then runs `log n` butterfly stages bottom-up. This is identical in shape to the iterative FFT in `15-divide-and-conquer/05-fft`; only the arithmetic (mod `p`, with `ω` instead of `e^{2πi/n}`) changes.

### Bit-reversal permutation

For `n = 2^L`, element at index `i` moves to index `rev(i)`, where `rev` reverses the `L` bits of `i`. Example for `n = 8` (`L = 3`):

```
index  binary   reversed   ->  rev(index)
0      000      000             0
1      001      100             4
2      010      010             2
3      011      110             6
4      100      001             1
5      101      101             5
6      110      011             3
7      111      111             7
```

After this permutation, the size-2 butterflies of stage 1 operate on adjacent pairs, stage 2 on groups of 4, and so on — exactly mirroring the recursion, but in place with `O(1)` extra space.

### The butterfly stages

For each stage with half-size `len/2`, the primitive `len`-th root `w_len = ω = g^{(p-1)/len}` drives the combine:

```
for len = 2, 4, 8, …, n:
    w_len = g^{(p-1)/len} mod p          # for inverse, use its modular inverse
    for each block of size len:
        w = 1
        for j in [0, len/2):
            u = a[block + j]
            v = a[block + j + len/2] * w mod p
            a[block + j]           = (u + v) mod p
            a[block + j + len/2]   = (u - v + p) mod p
            w = w * w_len mod p
```

That inner pair `(u + w·v, u − w·v)` is **the butterfly** — shared with FFT (see `05-fft`); we do not re-derive it. The only number-theory content is that `w_len` is a modular root and all arithmetic is mod `p`.

---

## The Inverse Transform

The inverse NTT reuses the exact same iterative routine with one change and one post-step:

1. **Change:** use `ω^{-1}` as the stage root instead of `ω`. Concretely, in the stage loop set `w_len = g^{(p-1)/len}` then replace it by `inv(w_len)` (or equivalently use root `g^{-1} = g^{p-2}` as the base primitive root for inverse stages).
2. **Post-step:** multiply every output entry by `n^{-1} mod p` (`= pow(n, p-2, p)`).

A clean trick used in the code below: pass an `invert` flag; when set, build each stage root from `inv(g)` and apply the `n^{-1}` scaling at the end. This keeps one routine for both directions, mirroring the FFT convention.

---

## Common NTT Primes and Roots

Keep these in your toolkit. Each is `p = c · 2^k + 1`, supporting transform length up to `2^k`. The listed `g` is a primitive root of `p` (a generator of `Z/pZ*`).

| Prime `p` | Factorization | `2^k` support | Primitive root `g` | Notes |
|-----------|---------------|---------------|---------------------|-------|
| `998244353` | `119 · 2^23 + 1` | `2^23 ≈ 8.4M` | `3` | The default competitive prime. |
| `985661441` | `235 · 2^22 + 1` | `2^22` | `3` | Common second prime. |
| `754974721` | `45 · 2^24 + 1` | `2^24` | `11` | Large 2-adic valuation. |
| `167772161` | `5 · 2^25 + 1` | `2^25` | `3` | Small, big `2^k`. |
| `469762049` | `7 · 2^26 + 1` | `2^26` | `3` | Largest power-of-two support here. |
| `1004535809` | `479 · 2^21 + 1` | `2^21` | `3` | Near `10^9`, NTT-friendly. |
| `2013265921` | `15 · 2^27 + 1` | `2^27` | `31` | `> 2^30`; watch 64-bit products. |

The classic **3-prime CRT set** for arbitrary-modulus convolution is `{998244353, 985661441, 469762049}` (or `{167772161, 469762049, 998244353}`) — three primes each near `10^9`, all with `g = 3`, giving a combined modulus `> 10^{27}`, enough to hold any product of two arrays whose entries and length keep each coefficient below `10^{27}`.

How big can a single coefficient of the true product be? Each `c[k] = Σ a[i] b[j]` sums at most `n` terms, each `< M²` for inputs bounded by `M`, so `c[k] < n · M²`. You need the combined CRT modulus to exceed `max_k c[k]`. For `M ≈ 10^9` and `n ≈ 10^5` that is `< 10^{23}`, comfortably under the 3-prime product.

---

## Arbitrary-Modulus Convolution via Multiple Primes + CRT

**Problem.** You must convolve mod `M`, but `M` is not NTT-friendly (e.g. `M = 10^9 + 7`, or `M = 2^{32}`, or some problem-specified composite). You cannot find a `2^k`-th root in `Z/MZ`.

**Solution.** Compute the convolution exactly *without any modulus* by running NTT under several NTT-friendly primes, then reconstruct each true coefficient with CRT, and only then reduce mod `M`.

The pipeline:

```
1. Reduce inputs mod each prime p_r (and also keep them for the final mod M).
2. For each prime p_r in {p_1, p_2, p_3}:
       c_r = ntt_convolution(a, b, p_r)      # exact mod p_r
3. For each output index k:
       true_c[k] = CRT(c_1[k] mod p_1, c_2[k] mod p_2, c_3[k] mod p_3)
                   # the unique value in [0, p_1 p_2 p_3) congruent to each c_r[k]
       answer[k] = true_c[k] mod M
```

Because the **true** integer coefficient is `< p_1 p_2 p_3`, CRT recovers it exactly; reducing afterward by `M` gives the desired modular answer. The number of primes is chosen so the product exceeds `max_k c[k] = n · M²` (see the bound above): two primes suffice when `M ≈ 10^9` *and* `n` is small; three primes are the safe default.

The CRT/Garner reconstruction details — including the numerically careful incremental "Garner" form that avoids big integers — live in sibling `05-crt` and `15-garner-algorithm`. Here we use a direct two-step CRT (combine `p_1, p_2`, then fold in `p_3`), which is enough and easy to test.

> **Why not just one giant prime?** A single 60+-bit NTT-friendly prime would need 128-bit modular multiplication for the butterfly (or Montgomery on 64-bit), which is slower and more error-prone. Three ~30-bit primes keep every product inside 64 bits and are embarrassingly parallel. The trade-off (1 transform set vs 3) is discussed in `senior.md`.

---

## Code Examples

### Iterative in-place NTT + multiply mod `998244353`

This is the version to ship. The butterfly mirrors `05-fft`; the arithmetic is modular.

#### Go

```go
package main

import "fmt"

const MOD = 998244353 // 119 * 2^23 + 1
const G = 3           // primitive root

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

func inv(a int64) int64 { return power(a, MOD-2) }

// In-place iterative NTT. invert=true performs the inverse transform.
func ntt(a []int64, invert bool) {
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
		// primitive length-th root (or its inverse)
		wlen := power(G, (MOD-1)/int64(length))
		if invert {
			wlen = inv(wlen)
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
		ninv := inv(int64(n))
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
	a := []int64{1, 2, 3} // 1 + 2x + 3x^2
	b := []int64{4, 5, 6} // 4 + 5x + 6x^2
	fmt.Println(multiply(a, b)) // [4 13 28 27 18]
}
```

#### Java

```java
import java.util.*;

public class NttMiddle {
    static final long MOD = 998244353L;
    static final long G = 3;

    static long power(long a, long e) {
        a %= MOD;
        if (a < 0) a += MOD;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % MOD;
            a = a * a % MOD;
            e >>= 1;
        }
        return r;
    }

    static long inv(long a) { return power(a, MOD - 2); }

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
            if (invert) wlen = inv(wlen);
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
            long ninv = inv(n);
            for (int i = 0; i < n; i++) a[i] = a[i] * ninv % MOD;
        }
    }

    static long[] multiply(long[] a, long[] b) {
        int need = a.length + b.length - 1;
        int n = 1;
        while (n < need) n <<= 1;
        long[] fa = Arrays.copyOf(a, n), fb = Arrays.copyOf(b, n);
        ntt(fa, false);
        ntt(fb, false);
        for (int i = 0; i < n; i++) fa[i] = fa[i] * fb[i] % MOD;
        ntt(fa, true);
        return Arrays.copyOf(fa, need);
    }

    public static void main(String[] args) {
        long[] a = {1, 2, 3}, b = {4, 5, 6};
        System.out.println(Arrays.toString(multiply(a, b))); // [4, 13, 28, 27, 18]
    }
}
```

#### Python

```python
MOD = 998244353
G = 3


def power(a, e):
    a %= MOD
    r = 1
    while e > 0:
        if e & 1:
            r = r * a % MOD
        a = a * a % MOD
        e >>= 1
    return r


def inv(a):
    return power(a, MOD - 2)


def ntt(a, invert):
    n = len(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        wlen = power(G, (MOD - 1) // length)
        if invert:
            wlen = inv(wlen)
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
        ninv = inv(n)
        for i in range(n):
            a[i] = a[i] * ninv % MOD


def multiply(a, b):
    need = len(a) + len(b) - 1
    n = 1
    while n < need:
        n <<= 1
    fa = a + [0] * (n - len(a))
    fb = b + [0] * (n - len(b))
    ntt(fa, False)
    ntt(fb, False)
    fc = [x * y % MOD for x, y in zip(fa, fb)]
    ntt(fc, True)
    return fc[:need]


if __name__ == "__main__":
    print(multiply([1, 2, 3], [4, 5, 6]))  # [4, 13, 28, 27, 18]
```

### Arbitrary-modulus convolution via 3 primes + CRT

This multiplies two arrays and returns the convolution mod an **arbitrary** `M` (here `10^9 + 7`) by running NTT under three friendly primes and CRT-combining. The per-prime NTT is the routine above, parameterized by `(p, g)`.

#### Python

```python
PRIMES = [998244353, 985661441, 469762049]  # all primitive root 3
G = 3


def power(a, e, mod):
    a %= mod
    r = 1
    while e > 0:
        if e & 1:
            r = r * a % mod
        a = a * a % mod
        e >>= 1
    return r


def ntt_mod(a, invert, mod):
    n = len(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
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
                u = a[i + k]
                v = a[i + k + length // 2] * w % mod
                a[i + k] = (u + v) % mod
                a[i + k + length // 2] = (u - v) % mod
                w = w * wlen % mod
        length <<= 1
    if invert:
        ninv = power(n, mod - 2, mod)
        for i in range(n):
            a[i] = a[i] * ninv % mod


def conv_mod(a, b, mod):
    need = len(a) + len(b) - 1
    n = 1
    while n < need:
        n <<= 1
    fa = a + [0] * (n - len(a))
    fb = b + [0] * (n - len(b))
    ntt_mod(fa, False, mod)
    ntt_mod(fb, False, mod)
    fc = [x * y % mod for x, y in zip(fa, fb)]
    ntt_mod(fc, True, mod)
    return fc[:need]


def crt3(r, p):
    # combine three residues r[i] mod p[i] into the value mod p0*p1*p2
    x = r[0]
    mod = p[0]
    for i in range(1, 3):
        # solve x + mod*t ≡ r[i] (mod p[i])
        inv = pow(mod % p[i], -1, p[i])
        t = ((r[i] - x) % p[i]) * inv % p[i]
        x += mod * t
        mod *= p[i]
    return x  # exact integer in [0, p0*p1*p2)


def multiply_arbitrary(a, b, M):
    parts = [conv_mod([x % p for x in a], [x % p for x in b], p) for p in PRIMES]
    out = []
    for k in range(len(parts[0])):
        true_c = crt3([parts[0][k], parts[1][k], parts[2][k]], PRIMES)
        out.append(true_c % M)
    return out


if __name__ == "__main__":
    M = 10**9 + 7
    a = [10**9, 10**9, 10**9]
    b = [10**9, 10**9]
    print(multiply_arbitrary(a, b, M))  # exact coefficients reduced mod 10^9+7
```

#### Go (CRT combine + per-prime convolution sketch)

```go
package main

import "fmt"

var PRIMES = []int64{998244353, 985661441, 469762049}

const G = 3

func powmod(a, e, mod int64) int64 {
	a %= mod
	if a < 0 {
		a += mod
	}
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

func nttMod(a []int64, invert bool, mod int64) {
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
		wlen := powmod(G, (mod-1)/int64(length), mod)
		if invert {
			wlen = powmod(wlen, mod-2, mod)
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
		ninv := powmod(int64(n), mod-2, mod)
		for i := range a {
			a[i] = a[i] * ninv % mod
		}
	}
}

func convMod(a, b []int64, mod int64) []int64 {
	need := len(a) + len(b) - 1
	n := 1
	for n < need {
		n <<= 1
	}
	fa := make([]int64, n)
	fb := make([]int64, n)
	copy(fa, a)
	copy(fb, b)
	nttMod(fa, false, mod)
	nttMod(fb, false, mod)
	for i := 0; i < n; i++ {
		fa[i] = fa[i] * fb[i] % mod
	}
	nttMod(fa, true, mod)
	return fa[:need]
}

// crt3 returns the exact value mod p0*p1*p2 then reduced by M (uses big-ish ints carefully).
func crt2(r1, p1, r2, p2 int64) (int64, int64) {
	inv := powmod(p1%p2, p2-2, p2)
	t := ((r2-r1)%p2 + p2) % p2 * inv % p2
	// value = r1 + p1*t ; new modulus = p1*p2 (may exceed int64 for 3 primes — see note)
	return r1 + p1*t, p1 * p2
}

func main() {
	// For three ~30-bit primes, p0*p1*p2 ~ 10^27 overflows int64; production code
	// uses math/big or 128-bit intermediates here. This sketch shows the structure;
	// see 15-garner-algorithm for the overflow-safe incremental form.
	a := []int64{2, 3}
	b := []int64{4, 5}
	fmt.Println(convMod(a, b, PRIMES[0])) // per-prime result
}
```

#### Java (CRT combine for two primes; extend to three via Garner)

```java
import java.math.BigInteger;
import java.util.*;

public class NttCrt {
    static final long[] PRIMES = {998244353L, 985661441L, 469762049L};
    static final long G = 3;

    static long powmod(long a, long e, long mod) {
        a %= mod; if (a < 0) a += mod;
        long r = 1;
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
            long wlen = powmod(G, (mod - 1) / len, mod);
            if (inv) wlen = powmod(wlen, mod - 2, mod);
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
        if (inv) {
            long ninv = powmod(n, mod - 2, mod);
            for (int i = 0; i < n; i++) a[i] = a[i] * ninv % mod;
        }
    }

    static long[] convMod(long[] a, long[] b, long mod) {
        int need = a.length + b.length - 1, n = 1;
        while (n < need) n <<= 1;
        long[] fa = Arrays.copyOf(a, n), fb = Arrays.copyOf(b, n);
        ntt(fa, false, mod); ntt(fb, false, mod);
        for (int i = 0; i < n; i++) fa[i] = fa[i] * fb[i] % mod;
        ntt(fa, true, mod);
        return Arrays.copyOf(fa, need);
    }

    static long[] multiplyArbitrary(long[] a, long[] b, long M) {
        long[][] parts = new long[3][];
        for (int r = 0; r < 3; r++) {
            long p = PRIMES[r];
            long[] ar = new long[a.length], br = new long[b.length];
            for (int i = 0; i < a.length; i++) ar[i] = ((a[i] % p) + p) % p;
            for (int i = 0; i < b.length; i++) br[i] = ((b[i] % p) + p) % p;
            parts[r] = convMod(ar, br, p);
        }
        BigInteger[] P = {BigInteger.valueOf(PRIMES[0]),
                          BigInteger.valueOf(PRIMES[1]),
                          BigInteger.valueOf(PRIMES[2])};
        BigInteger prod = P[0].multiply(P[1]).multiply(P[2]);
        BigInteger bm = BigInteger.valueOf(M);
        long[] out = new long[parts[0].length];
        for (int k = 0; k < out.length; k++) {
            // CRT via BigInteger for clarity (production: Garner, 15-garner-algorithm)
            BigInteger x = BigInteger.ZERO, mod = BigInteger.ONE;
            for (int r = 0; r < 3; r++) {
                BigInteger ri = BigInteger.valueOf(parts[r][k]);
                BigInteger pi = P[r];
                BigInteger invv = mod.modInverse(pi);
                BigInteger t = ri.subtract(x).multiply(invv).mod(pi);
                x = x.add(mod.multiply(t));
                mod = mod.multiply(pi);
            }
            out[k] = x.mod(prod).mod(bm).longValueExact();
        }
        return out;
    }

    public static void main(String[] args) {
        long M = 1_000_000_007L;
        long[] a = {1_000_000_000L, 1_000_000_000L};
        long[] b = {1_000_000_000L, 1_000_000_000L};
        System.out.println(Arrays.toString(multiplyArbitrary(a, b, M)));
    }
}
```

---

## Comparison with Alternatives

| Approach | Exactness | Speed | When to use |
|----------|-----------|-------|-------------|
| Schoolbook `O(n²)` | exact | slow | tiny `n` (≤ ~64), or as a test oracle |
| Complex FFT (`double`) | approximate (rounding) | `O(n log n)` | real-valued or coefficients small enough that rounding is safe |
| FFT with coefficient splitting (3 mults) | exact mod `M` | `O(n log n)`, large constant | arbitrary `M` without NTT primes, real-FFT toolchain |
| **NTT mod friendly `p`** | exact mod `p` | `O(n log n)` | answer wanted mod `998244353` (or any friendly prime) |
| **3-prime NTT + CRT** | exact mod arbitrary `M` | `O(n log n)`, 3× constant | answer wanted mod a non-friendly `M` (e.g. `10^9 + 7`) |

The decision rule: if the required modulus is NTT-friendly, single NTT. If not, 3-prime NTT + CRT (number-theory route) or complex-FFT-with-splitting (analysis route). NTT-CRT is deterministic and integer-only; FFT-splitting risks rounding. See `15-divide-and-conquer/05-fft` for the FFT side.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `n` not padded to a power of two | Bit-reversal/butterfly indexing breaks. | Round up to next power of two ≥ `len(a)+len(b)-1`. |
| `n` too small | Cyclic wraparound corrupts coefficients silently. | `n ≥ len(a) + len(b) − 1`. |
| Forgot `n^{-1}` scaling | All outputs `n×` too large. | Multiply by `inv(n)` exactly once after inverse NTT. |
| Used `ω` not `ω^{-1}` in inverse | Scrambled (permuted) output. | Inverse stages use `inv(wlen)`. |
| Negative residue after `u − v` | Output briefly negative. | `(u − v + mod) % mod`. |
| CRT product overflows 64-bit | 3-prime product `> 10^{27}` wraps. | Use big integers, 128-bit, or Garner (`15-garner-algorithm`). |
| Too few CRT primes | True coefficient exceeds `Πp_r`; CRT wrong. | Ensure `Πp_r > n · M²`; use 3 primes by default. |
| Non-friendly prime as the single modulus | No `2^k`-th root; transform is nonsense. | Use a friendly prime or the multi-prime route. |

---

## Performance Analysis

| Stage | Cost | Notes |
|-------|------|-------|
| Bit-reversal | `O(n)` | One pass; cache-friendly. |
| Each butterfly stage | `O(n)` | `log n` stages → `O(n log n)`. |
| Forward + forward + pointwise + inverse | `O(n log n)` | Three transforms total for a multiply. |
| Per-prime convolution (CRT route) | `O(n log n)` | Independent per prime; parallelizable. |
| CRT combine | `O(n)` per output (constant primes) | `O(n)` total for fixed prime count. |

Constant-factor wins (detailed in `senior.md`): precompute the stage roots `wlen` once per size into a table instead of `power(...)` per stage; use Montgomery or Barrett reduction (sibling `14-montgomery-multiplication`) to replace the `% mod` in the inner butterfly; keep arrays flat and contiguous. For `n = 2^20 ≈ 10^6`, a tuned single-prime NTT multiply runs in a few tens of milliseconds; the 3-prime CRT version is ~3× that plus the CRT pass.

```python
# rough cost model
def ntt_ops(n):
    import math
    stages = int(math.log2(n))
    return n * stages          # ~ n log n butterflies per transform

# a full multiply ≈ 3 * ntt_ops(n) + n pointwise + n inverse-scale
```

---

## Best Practices

- **Pad correctly:** `n = next_pow2(len(a) + len(b) − 1)`. This single line prevents the most common wrong-answer bug.
- **One routine, `invert` flag:** share the iterative transform for forward and inverse; apply `n^{-1}` only when inverting.
- **Pin `(MOD, G)` as named constants;** keep the primes/roots table handy and verify `2^k ≥ n` for your chosen prime.
- **Choose the route by modulus:** friendly `M` → single NTT; non-friendly `M` → 3-prime NTT + CRT (`05-crt`, `15-garner-algorithm`).
- **Test against the schoolbook oracle** on random small arrays for every prime and for the CRT-combined result.
- **Bound your coefficients:** confirm `Πp_r > n · max|a| · max|b|` before trusting the CRT reconstruction.
- **Reuse transforms:** to square a polynomial, transform once; to multiply many polynomials by a fixed one, transform the fixed one once.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The bit-reversal permutation of the input over a small NTT-friendly prime.
> - Each butterfly stage combining pairs with powers of the root `ω` (the shared FFT butterfly; see `05-fft`).
> - The pointwise product of the two transformed vectors.
> - The inverse transform with `ω^{-1}` and the final `n^{-1}` scaling that recovers exact coefficients.
> - Play / Pause / Step controls and editable input arrays.

---

## Summary

The shipping form of NTT is **iterative and in-place**: permute the input into bit-reversed order, then run `log n` butterfly stages whose root `wlen = g^{(p-1)/len}` drives the same combine as FFT (derived in `15-divide-and-conquer/05-fft`; not re-derived here). The **inverse** transform is the identical routine with `ω^{-1}` and a final multiply by `n^{-1} mod p`. A full polynomial multiply is forward-forward-pointwise-inverse, `O(n log n)`, exact mod a friendly prime such as `998244353` (`g = 3`). When the required modulus `M` is **not** NTT-friendly, run the convolution under several friendly primes and reconstruct each exact coefficient with **CRT** (pointer to `05-crt` and the overflow-safe `15-garner-algorithm`), choosing enough primes that `Πp_r > n · M²` before reducing by `M`. Keep the primes/roots table, always pad to a power of two, never forget the `n^{-1}` scaling, and test against a schoolbook oracle.
