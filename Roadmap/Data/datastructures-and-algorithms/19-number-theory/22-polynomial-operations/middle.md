# Polynomial Operations (over a Field, especially mod p) — Middle Level

> **Focus:** Long division and remainder mod `p`, interpolation (Lagrange and Newton divided differences), polynomial GCD via the Euclidean algorithm, the derivative, and where the fast-multiplication siblings (Karatsuba, FFT, NTT) plug in to make all of this `O(n log n)`-friendly.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Interpolation: Lagrange and Newton](#interpolation-lagrange-and-newton)
6. [Polynomial GCD via Euclid](#polynomial-gcd-via-euclid)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level you held a polynomial as a coefficient array and learned the three cheap operations (add/sub/scale), schoolbook multiply, and Horner evaluation. At middle level you graduate to the operations that *use division* and therefore genuinely need a **field** — the integers mod a prime `p`, where every nonzero element has a multiplicative inverse:

- **Long division and remainder** — given `A(x)` and `B(x)`, find quotient `Q(x)` and remainder `R(x)` with `A = B·Q + R` and `deg R < deg B`. This needs to divide by `B`'s leading coefficient, hence the field.
- **Interpolation** — recover the unique degree-`≤ n` polynomial passing through `n+1` given points, by **Lagrange** or **Newton divided differences**.
- **Polynomial GCD** — the Euclidean algorithm, identical in shape to integer GCD but with polynomial remainders.
- **Derivative** (and a note on the integral) — formal, coefficient-shifting operations.

A recurring theme: every one of these is built on multiply and evaluate, so the moment your degree gets large, you swap the `O(n²)` schoolbook multiply for the `O(n log n)` NTT (sibling `15-ntt`) or FFT (`15-divide-and-conquer/05-fft`) / Karatsuba (`15-divide-and-conquer/04-karatsuba`), and several of these algorithms drop from `O(n²)` to `O(n log n)` or `O(n log² n)`. We point out exactly where that swap happens.

The questions that separate "I can write a double loop" from "I can build a polynomial toolkit" are:

- When do I need a *prime* modulus, and what breaks if `p` is composite?
- Why is the interpolating polynomial through `n+1` distinct points **unique**?
- How is polynomial GCD the same algorithm as integer GCD, and why does it terminate?
- Where, precisely, does fast multiplication change the complexity of division and interpolation?

---

## Deeper Concepts

### F[x] is a Euclidean domain

The set of polynomials with coefficients in a field `F` (written `F[x]`) supports a **division algorithm**: for any `A, B` with `B ≠ 0` there exist unique `Q, R` with `A = B·Q + R` and `deg R < deg B`. The "size" used for the Euclidean property is the **degree**. This is exactly the structure that makes the Euclidean GCD algorithm work, mirroring the integers `Z` (where the size is absolute value). The formal statement and uniqueness proof live in [`professional.md`](./professional.md); here we use it operationally.

The catch: the division step repeatedly multiplies by the inverse of `B`'s leading coefficient. Inverses exist for *every* nonzero element only when `F` is a field — i.e. when `p` is **prime**. Over `Z/6Z` (composite), `2` and `3` have no inverse and division breaks. **Always use a prime modulus** for division, GCD, and interpolation.

### Long division, step by step

To divide `A` (degree `n`) by `B` (degree `m ≤ n`), monic-or-not:

```
R := A
Q := 0
inv_lead := modinv(B[m], p)          # inverse of B's leading coefficient
for k from n-m down to 0:
    coeff := R[m+k] * inv_lead mod p # the next quotient coefficient
    Q[k]  := coeff
    subtract coeff * x^k * B  from R # cancels R's current leading term
return (Q, R truncated to degree < m)
```

Each outer step kills one leading term of `R`, lowering its degree by at least one; after `n−m+1` steps `deg R < m`. The cost is `O((n−m+1)·m) = O(n·m)` — schoolbook. With fast multiplication and Newton iteration on the *reversed* polynomials, division drops to `O(n log n)` (surveyed in [`senior.md`](./senior.md)).

### Evaluation and roots

`P(x0) = 0` iff `(x − x0)` divides `P` (the **factor theorem**). So evaluation, division, and root-finding are intertwined: dividing `P` by `(x − x0)` gives remainder `P(x0)` — that single-step long division *is* Horner's rule in disguise. A degree-`n` polynomial has at most `n` roots in a field, the fact behind interpolation uniqueness.

### The formal derivative

The derivative is purely formal — no limits, just the power rule applied coefficient-wise:

```
P  = [a0, a1, a2, a3, …]
P' = [a1, 2·a2, 3·a3, …]    # P'[i-1] = i · P[i], mod p
```

It is `O(n)` and works over `F_p` (multiply each coefficient by its index mod `p`). The formal derivative is the engine behind **square-free factorization** (a polynomial shares a factor with its derivative iff it has a repeated root) and behind Newton iteration (senior level). The formal **integral** reverses it — `∫P [i+1] = P[i] / (i+1)` — which needs the inverse of `(i+1) mod p`, so it fails when `i+1 ≡ 0 (mod p)`; another reason `p` should exceed the degree.

---

## Comparison with Alternatives

### Lagrange vs Newton interpolation

| Aspect | Lagrange | Newton (divided differences) |
|--------|----------|------------------------------|
| Build cost | `O(n²)` | `O(n²)` |
| Evaluate at one new `x` | `O(n)` per point (with precomputed weights) | `O(n)` (Horner-like nested form) |
| Add a new data point | rebuild `O(n²)` | **incremental `O(n)`** — append one term |
| Coefficient extraction | `O(n²)` | `O(n²)` |
| Numerical stability (reals) | weights can be ill-conditioned | generally better |
| Conceptual clarity | very explicit basis polynomials | nested, recurrence-driven |

**Rule of thumb:** Newton when points arrive incrementally or you want the nested evaluation form; Lagrange when you have all points up front and especially when you only need the *value* at one or a few targets (the "Lagrange at a point" trick avoids building coefficients at all).

### Schoolbook vs fast multiplication (where it plugs in)

| Operation | Schoolbook | With FFT/NTT |
|-----------|-----------|--------------|
| Multiply two degree-`n` polys | `O(n²)` | `O(n log n)` (`15-ntt`) |
| Long division | `O(n²)` | `O(n log n)` (Newton on reversed poly, senior) |
| Multipoint evaluation (`n` points) | `O(n²)` | `O(n log² n)` (subproduct tree) |
| Interpolation (`n` points) | `O(n²)` | `O(n log² n)` |
| Polynomial GCD | `O(n²)` | `O(n log² n)` (Half-GCD, senior) |

The dividing line: below a few thousand coefficients, schoolbook is simpler and often faster (small constant). Above that, switch the multiply primitive to NTT and the higher-level algorithms inherit the speedup.

---

## Advanced Patterns

### Pattern: Polynomial long division mod p

The workhorse. Returns `(Q, R)` with `A = B·Q + R`, `deg R < deg B`.

#### Go

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

func modinv(a int64) int64 { return power(a, MOD-2) } // Fermat: a^(p-2)

func trim(p []int64) []int64 {
	for len(p) > 1 && p[len(p)-1] == 0 {
		p = p[:len(p)-1]
	}
	return p
}

// divmod returns quotient and remainder of A / B (mod p), deg R < deg B.
func divmod(a, b []int64) (q, r []int64) {
	a = trim(append([]int64{}, a...))
	b = trim(b)
	if len(a) < len(b) {
		return []int64{0}, a
	}
	r = append([]int64{}, a...)
	q = make([]int64, len(a)-len(b)+1)
	invLead := modinv(b[len(b)-1])
	for k := len(a) - len(b); k >= 0; k-- {
		coeff := r[k+len(b)-1] * invLead % MOD
		q[k] = coeff
		for j := 0; j < len(b); j++ {
			r[k+j] = (r[k+j] - coeff*b[j]%MOD + MOD) % MOD
		}
	}
	return trim(q), trim(r)
}

func main() {
	// (x^3 + 0x^2 + 0x + 1) / (x + 1) = x^2 - x + 1, remainder 0
	A := []int64{1, 0, 0, 1}
	B := []int64{1, 1}
	q, r := divmod(A, B)
	fmt.Println("Q =", q) // [1 MOD-1 1] i.e. 1 - x + x^2
	fmt.Println("R =", r) // [0]
}
```

#### Java

```java
import java.util.*;

public class PolyDiv {
    static final long MOD = 998244353L;

    static long power(long a, long e) {
        a %= MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        return r;
    }
    static long modinv(long a) { return power(a, MOD - 2); }

    static long[] trim(long[] p) {
        int len = p.length;
        while (len > 1 && p[len - 1] == 0) len--;
        return Arrays.copyOf(p, len);
    }

    static long[][] divmod(long[] a, long[] b) {
        a = trim(a); b = trim(b);
        if (a.length < b.length) return new long[][]{{0}, a};
        long[] r = a.clone();
        long[] q = new long[a.length - b.length + 1];
        long invLead = modinv(b[b.length - 1]);
        for (int k = a.length - b.length; k >= 0; k--) {
            long coeff = r[k + b.length - 1] * invLead % MOD;
            q[k] = coeff;
            for (int j = 0; j < b.length; j++)
                r[k + j] = (r[k + j] - coeff * b[j] % MOD + MOD) % MOD;
        }
        return new long[][]{trim(q), trim(r)};
    }

    public static void main(String[] args) {
        long[] A = {1, 0, 0, 1};
        long[] B = {1, 1};
        long[][] qr = divmod(A, B);
        System.out.println("Q = " + Arrays.toString(qr[0]));
        System.out.println("R = " + Arrays.toString(qr[1]));
    }
}
```

#### Python

```python
MOD = 998244353


def modinv(a):
    return pow(a, MOD - 2, MOD)        # Fermat's little theorem


def trim(p):
    while len(p) > 1 and p[-1] == 0:
        p.pop()
    return p


def divmod_poly(a, b):
    a = trim(a[:])
    b = trim(b[:])
    if len(a) < len(b):
        return [0], a
    r = a[:]
    q = [0] * (len(a) - len(b) + 1)
    inv_lead = modinv(b[-1])
    for k in range(len(a) - len(b), -1, -1):
        coeff = r[k + len(b) - 1] * inv_lead % MOD
        q[k] = coeff
        for j in range(len(b)):
            r[k + j] = (r[k + j] - coeff * b[j]) % MOD
    return trim(q), trim(r[:len(b) - 1] or [0])


if __name__ == "__main__":
    A = [1, 0, 0, 1]   # 1 + x^3
    B = [1, 1]         # 1 + x
    q, r = divmod_poly(A, B)
    print("Q =", q)    # 1 - x + x^2  ->  [1, MOD-1, 1]
    print("R =", r)    # [0]
```

### Pattern: Formal derivative

```python
def derivative(p, mod=MOD):
    if len(p) <= 1:
        return [0]
    return [(i * p[i]) % mod for i in range(1, len(p))]
```

`O(n)`. Use it for square-free testing: `gcd(P, P') ≠ 1` signals a repeated root.

---

## Interpolation: Lagrange and Newton

Given `n+1` points `(x_0, y_0), …, (x_n, y_n)` with **distinct** `x_i`, there is a **unique** polynomial of degree `≤ n` passing through all of them. (Uniqueness: two such polynomials differ by a degree-`≤ n` polynomial with `n+1` roots, forcing it to be zero — proof in `professional.md`.)

### Lagrange form

```
P(x) = Σ_{i=0}^{n}  y_i · L_i(x),   where   L_i(x) = Π_{j≠i} (x − x_j) / (x_i − x_j)
```

Each basis polynomial `L_i` is `1` at `x_i` and `0` at every other `x_j`. Building the full coefficient vector is `O(n²)`. If you only need the value at a single target `x*`, evaluate the formula directly in `O(n²)` (or `O(n)` with precomputed prefix/suffix products) without ever forming coefficients — the "Lagrange evaluation at a point" trick, common in competitive programming for summing polynomial series.

### Newton divided-differences form

```
P(x) = c_0 + c_1(x−x_0) + c_2(x−x_0)(x−x_1) + … + c_n Π_{j<n}(x−x_j)
```

The coefficients `c_i` are the **divided differences** `f[x_0, …, x_i]`, built by the recurrence:

```
f[x_i] = y_i
f[x_i, …, x_{i+k}] = (f[x_{i+1},…,x_{i+k}] − f[x_i,…,x_{i+k-1}]) / (x_{i+k} − x_i)
```

Building the table is `O(n²)`; evaluating the nested form is `O(n)`. The killer feature: adding a new point `(x_{n+1}, y_{n+1})` costs only `O(n)` — you append one divided difference and one term, no rebuild. That makes Newton the right choice for streaming/incremental data.

#### Lagrange interpolation — value at a target point (Python)

```python
MOD = 998244353


def modinv(a):
    return pow(a, MOD - 2, MOD)


def lagrange_eval(xs, ys, target):
    n = len(xs)
    result = 0
    for i in range(n):
        num = ys[i] % MOD
        den = 1
        for j in range(n):
            if j != i:
                num = num * ((target - xs[j]) % MOD) % MOD
                den = den * ((xs[i] - xs[j]) % MOD) % MOD
        result = (result + num * modinv(den)) % MOD
    return result


if __name__ == "__main__":
    # points lie on P(x) = x^2 + 1: (0,1),(1,2),(2,5)
    xs = [0, 1, 2]
    ys = [1, 2, 5]
    print(lagrange_eval(xs, ys, 3))  # P(3) = 10
```

#### Newton divided differences — coefficients and evaluation (Go)

```go
package main

import "fmt"

const MOD = 998244353

func power(a, e int64) int64 {
	a %= MOD
	if a < 0 {
		a += MOD
	}
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

// dividedDiff returns Newton coefficients c[i] for points (xs, ys).
func dividedDiff(xs, ys []int64) []int64 {
	n := len(xs)
	c := append([]int64{}, ys...)
	for i := range c {
		c[i] %= MOD
	}
	for k := 1; k < n; k++ {
		for i := n - 1; i >= k; i-- {
			num := (c[i] - c[i-1] + MOD) % MOD
			den := ((xs[i]-xs[i-k])%MOD + MOD) % MOD
			c[i] = num * modinv(den) % MOD
		}
	}
	return c
}

// newtonEval evaluates the Newton form at x (mod p).
func newtonEval(xs, c []int64, x int64) int64 {
	n := len(c)
	var acc int64 = 0
	for i := n - 1; i >= 0; i-- {
		acc = (acc*((x-xs[i])%MOD+MOD)%MOD + c[i]) % MOD
	}
	return acc
}

func main() {
	xs := []int64{0, 1, 2}
	ys := []int64{1, 2, 5} // P(x) = x^2 + 1
	c := dividedDiff(xs, ys)
	fmt.Println("Newton coeffs:", c)
	fmt.Println("P(3) =", newtonEval(xs, c, 3)) // 10
}
```

#### Newton divided differences (Java)

```java
import java.util.*;

public class NewtonInterp {
    static final long MOD = 998244353L;

    static long power(long a, long e) {
        a %= MOD; if (a < 0) a += MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        return r;
    }
    static long modinv(long a) { return power(a, MOD - 2); }

    static long[] dividedDiff(long[] xs, long[] ys) {
        int n = xs.length;
        long[] c = new long[n];
        for (int i = 0; i < n; i++) c[i] = ((ys[i] % MOD) + MOD) % MOD;
        for (int k = 1; k < n; k++)
            for (int i = n - 1; i >= k; i--) {
                long num = (c[i] - c[i - 1] + MOD) % MOD;
                long den = ((xs[i] - xs[i - k]) % MOD + MOD) % MOD;
                c[i] = num * modinv(den) % MOD;
            }
        return c;
    }

    static long newtonEval(long[] xs, long[] c, long x) {
        long acc = 0;
        for (int i = c.length - 1; i >= 0; i--)
            acc = (acc * (((x - xs[i]) % MOD + MOD) % MOD) % MOD + c[i]) % MOD;
        return acc;
    }

    public static void main(String[] args) {
        long[] xs = {0, 1, 2};
        long[] ys = {1, 2, 5};
        long[] c = dividedDiff(xs, ys);
        System.out.println("Newton coeffs: " + Arrays.toString(c));
        System.out.println("P(3) = " + newtonEval(xs, c, 3)); // 10
    }
}
```

---

## Polynomial GCD via Euclid

The greatest common divisor of two polynomials is the highest-degree polynomial dividing both. The Euclidean algorithm is identical in shape to the integer version (sibling `01-gcd-lcm`), replacing integer remainder with **polynomial remainder**:

```
gcd(A, B):
    while B ≠ 0:
        A, B = B, A mod B      # polynomial remainder via long division
    return A  (usually normalized to monic)
```

Each step strictly lowers the degree of the remainder, so it terminates in `O(n)` division steps, each `O(n²)` schoolbook → `O(n³)` worst case naively, but `O(n²)` with careful degree bookkeeping (the remainder degrees telescope). Fast Half-GCD brings this to `O(n log² n)` (senior). Applications: testing common roots, square-free factorization (`gcd(P, P')`), simplifying rational functions, and the extended version computes the Bézout polynomials `U, V` with `U·A + V·B = gcd` — the polynomial analogue of the extended Euclidean algorithm (sibling `07-extended-euclidean-modular-inverse`).

#### Polynomial GCD (Python)

```python
MOD = 998244353


def modinv(a):
    return pow(a, MOD - 2, MOD)


def trim(p):
    while len(p) > 1 and p[-1] == 0:
        p.pop()
    return p


def divmod_poly(a, b):
    a, b = trim(a[:]), trim(b[:])
    if len(a) < len(b):
        return [0], a
    r = a[:]
    q = [0] * (len(a) - len(b) + 1)
    inv = modinv(b[-1])
    for k in range(len(a) - len(b), -1, -1):
        coeff = r[k + len(b) - 1] * inv % MOD
        q[k] = coeff
        for j in range(len(b)):
            r[k + j] = (r[k + j] - coeff * b[j]) % MOD
    return trim(q), trim(r[:len(b) - 1] or [0])


def make_monic(p):
    inv = modinv(p[-1])
    return [c * inv % MOD for c in p]


def poly_gcd(a, b):
    a, b = trim(a[:]), trim(b[:])
    while not (len(b) == 1 and b[0] == 0):
        _, r = divmod_poly(a, b)
        a, b = b, r
    return make_monic(a) if a[-1] != 0 else a


if __name__ == "__main__":
    # (x-1)(x-2) = x^2 -3x +2  and  (x-1)(x-3) = x^2 -4x +3 ; gcd = x-1
    A = [2, MOD - 3, 1]
    B = [3, MOD - 4, 1]
    print("gcd =", poly_gcd(A, B))  # monic x - 1 -> [MOD-1, 1]
```

---

## Code Examples

### Reusable polynomial toolkit (Python)

This consolidates the operations so the same `mul`/`divmod` primitives serve interpolation and GCD; swapping `mul` for an NTT-backed version (sibling `15-ntt`) upgrades everything to `O(n log n)`.

```python
MOD = 998244353


def modinv(a):
    return pow(a, MOD - 2, MOD)


def poly_add(p, q):
    n = max(len(p), len(q))
    return [((p[i] if i < len(p) else 0) + (q[i] if i < len(q) else 0)) % MOD
            for i in range(n)]


def poly_mul(p, q):                       # swap for NTT when degree is large
    if not p or not q:
        return [0]
    r = [0] * (len(p) + len(q) - 1)
    for i, pi in enumerate(p):
        if pi:
            for j, qj in enumerate(q):
                r[i + j] = (r[i + j] + pi * qj) % MOD
    return r


def poly_deriv(p):
    return [i * p[i] % MOD for i in range(1, len(p))] or [0]
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Composite modulus | `modinv` fails; division produces nonsense. | Use a prime `p`; inverses then always exist. |
| Dividing by zero polynomial | Infinite loop / divide-by-zero in `divmod`. | Guard `B ≠ 0` before division. |
| Duplicate interpolation nodes | `x_i − x_j = 0`, division by zero. | Require distinct `x_i`; assert before interpolating. |
| Remainder degree not reduced | Forgot to truncate `R` below `deg B`. | Slice `R` to length `deg B`; normalize. |
| Negative coefficients | `(a − b) mod p` left negative (Go/Java). | Add `p` before final `% p`. |
| Integral hits `i+1 ≡ 0 (mod p)` | No inverse of `i+1`. | Ensure `p > degree`; or avoid integral over small `p`. |
| GCD not normalized | Returns a non-monic associate; comparisons fail. | Divide by leading coefficient to make monic. |

---

## Performance Analysis

| Operation | Schoolbook | Fast (FFT/NTT-backed) |
|-----------|-----------|------------------------|
| Multiply (deg `n`) | `O(n²)` | `O(n log n)` |
| Long division | `O(n·m)` | `O(n log n)` |
| Lagrange (full coeffs) | `O(n²)` | `O(n log² n)` |
| Newton build / eval | `O(n²)` / `O(n)` | `O(n log² n)` build |
| Multipoint eval (`n` pts) | `O(n²)` | `O(n log² n)` |
| Polynomial GCD | `O(n²)` | `O(n log² n)` Half-GCD |

```python
import time, random

def bench_mul(n):
    p = [random.randrange(MOD) for _ in range(n)]
    q = [random.randrange(MOD) for _ in range(n)]
    t = time.perf_counter()
    poly_mul(p, q)
    return time.perf_counter() - t
# n=2000 schoolbook ~ a few hundred ms in CPython; NTT would be milliseconds.
```

The single biggest constant-factor win in schoolbook multiply/division is skipping zero terms and keeping the inner loop tight; the single biggest *asymptotic* win is replacing `poly_mul` with NTT once degrees exceed a few thousand. Interpolation and GCD then inherit the speedup because they call `mul`/`divmod` internally.

---

## Best Practices

- **Use a prime modulus** (`998244353` if NTT may follow). Division, GCD, interpolation all require inverses.
- **Always normalize / trim** trailing zeros; read degree only after trimming.
- **Assert distinct nodes** before interpolation; equal `x_i` means division by zero.
- **Prefer Newton** for incremental points, **Lagrange-at-a-point** when you only need a value.
- **Factor out `mul` and `divmod`** so swapping in NTT upgrades the whole toolkit at once.
- **Make GCD monic** so results are canonical and comparable.
- **Test interpolation** by re-evaluating at the input nodes — you must recover the `y_i` exactly.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level relevant parts of the animation:
> - The schoolbook multiply as convolution, useful for understanding the remainder-subtraction step of long division (each division step subtracts a scaled shift of `B`).
> - Horner evaluation, the same nested form used by Newton's interpolation evaluation.
> - Editable polynomials so you can watch how changing one coefficient ripples through the product.

---

## Summary

Middle-level polynomial work is the field-dependent layer: **long division** (`A = B·Q + R`, `deg R < deg B`) needs to invert leading coefficients, so the modulus must be **prime**. **Interpolation** recovers the unique degree-`≤ n` polynomial through `n+1` distinct points — Lagrange (explicit basis, great for a single-point value) or Newton divided differences (incremental, `O(n)` to add a point). **Polynomial GCD** is the integer Euclidean algorithm with polynomial remainders, terminating because degrees strictly decrease, and underpins square-free testing via `gcd(P, P')`. The **formal derivative** is a coefficient shift, `O(n)`. Every algorithm here is built on multiply and divide, so swapping the `O(n²)` schoolbook multiply for the `O(n log n)` NTT (sibling `15-ntt`, with Karatsuba/FFT in `15-divide-and-conquer`) upgrades division, interpolation, and GCD to near-linear or `O(n log² n)`. The correctness arguments — division-algorithm existence/uniqueness, interpolation uniqueness, GCD termination — are proved in [`professional.md`](./professional.md), and the big-degree machinery (NTT-backed multiply, Newton iteration for inverse/log/exp/sqrt) is surveyed in [`senior.md`](./senior.md).
