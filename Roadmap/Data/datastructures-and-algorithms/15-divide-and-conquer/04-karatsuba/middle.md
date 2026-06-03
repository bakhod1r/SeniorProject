# Karatsuba Multiplication (Fast Big-Integer Multiply) — Middle Level

> **Focus:** the full derivation of the 3-multiplication identity, why carry propagation makes integers harder than polynomials, the Toom-Cook generalization (Toom-3 and beyond), where the crossover thresholds sit, and how Karatsuba compares with both schoolbook and FFT.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deriving the Three-Multiplication Identity](#deriving-the-three-multiplication-identity)
3. [Carry Propagation: Integers vs Polynomials](#carry-propagation-integers-vs-polynomials)
4. [The Recurrence in Detail](#the-recurrence-in-detail)
5. [Comparison with Alternatives](#comparison-with-alternatives)
6. [Toom-Cook Generalization](#toom-cook-generalization)
7. [Crossover Thresholds](#crossover-thresholds)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was one identity: `z1 = (a+b)(c+d) − z2 − z0` saves a multiplication. At middle level you start asking the engineering questions that decide whether your implementation is correct *and* competitive:

- *Why* exactly three products, and where does the `(a+b)(c+d)` form come from — is it the only way?
- Polynomials and integers run the same recurrence; what does carry propagation add, and why is it the bug magnet?
- The recurrence `T(n)=3T(n/2)+O(n)` gives `O(n^{1.585})` — but what is the hidden constant, and why is schoolbook faster for small `n`?
- How does Toom-3 push the exponent down to `≈1.465`, and why not just keep splitting into more parts?
- Where do real libraries (GMP, Java `BigInteger`, Python `int`) put the schoolbook→Karatsuba→Toom→FFT thresholds, and why there?

These are the questions that separate "I memorized the identity" from "I can build, tune, and reason about a multiplication routine."

---

## Deriving the Three-Multiplication Identity

### The setup

Split each `2n`-digit operand at base `B = 10^n` (or `2^n` in binary):

```
x = a·B + b
y = c·B + d
```

The product expands to a degree-2 expression in `B`:

```
x·y = a·c·B²  +  (a·d + b·c)·B  +  b·d
    =   z2·B²  +        z1·B     +   z0
```

There are three coefficients to find: `z2`, `z1`, `z0`. The naive route computes `z1 = a·d + b·c` directly, costing the two products `a·d` and `b·c` on top of `z2 = a·c` and `z0 = b·d` — four products.

### The interpolation viewpoint

Think of `P(B) = x` and `Q(B) = y` as linear polynomials `P(t) = a·t + b`, `Q(t) = c·t + d`. Their product `R(t) = P(t)·Q(t) = z2·t² + z1·t + z0` is a **degree-2 polynomial**, so it is determined by its values at **3 points**. Evaluate at `t = ∞, 0, 1`:

```
R(∞) = z2            = a·c                        (leading coefficient)
R(0)  = z0           = b·d
R(1)  = z2 + z1 + z0 = (a+b)(c+d)
```

Three evaluations → three products `a·c`, `b·d`, `(a+b)(c+d)`. Then solve the tiny linear system for the unknown `z1`:

```
z1 = R(1) − R(∞) − R(0) = (a+b)(c+d) − a·c − b·d
```

This is the **evaluate–multiply–interpolate** structure that *all* fast multiplication shares (Toom-Cook and FFT are the same idea with more points). Karatsuba is the `degree-1 split / 3-point` instance.

### Why three is optimal for a 2-way split

A degree-2 product has 3 coefficients, and each coefficient carries one bilinear "unit" of information. You cannot determine 3 unknowns with fewer than 3 multiplications (this is a bilinear-complexity lower bound for the 2×2 case). So 3 is not just clever — it is **optimal** for splitting in two. The four-product version simply computes a redundant pair (`a·d` and `b·c` separately) when only their *sum* `z1` is needed.

### Alternative evaluation points

You can pick different points and get equivalent identities. A common variant uses `t = 0, 1, −1`:

```
R(0)  = z0
R(1)  = z2 + z1 + z0 = (a+b)(c+d)
R(−1) = z2 − z1 + z0 = (a−b)(c−d)
```

from which `z1 = (R(1) − R(−1))/2` and `z2 = (R(1) + R(−1))/2 − R(0)`. This `(a−b)(c−d)` form keeps operands smaller (the subtraction does not grow the length the way `a+b` can), which some implementations prefer; it introduces signed intermediates instead. Both are "Karatsuba" — three products, different bookkeeping.

---

## Carry Propagation: Integers vs Polynomials

### The clean case: polynomials

For polynomials, the coefficients `z2, z1, z0` are themselves polynomials (or scalars), and there is **no carry** — a coefficient may be arbitrarily large and simply sits in its slot. The recombination

```
R(t) = z2·t^{2n} + z1·t^n + z0
```

is just placing each block at the right offset and adding overlapping coefficients. Polynomial Karatsuba is therefore the "pure" algorithm; correctness is immediate from the identity.

### The messy case: integers

For integers, each "coefficient" is a number in `[0, B)`, and adding overlapping blocks can exceed `B`, producing a **carry** that must propagate to the next limb. Three things go wrong if you are careless:

1. **`a+b` and `c+d` overflow a half.** Two `n`-digit halves sum to at most `n+1` digits. The middle product `(a+b)(c+d)` is therefore up to `2n+2` digits, not `2n`. Reserve one extra limb of headroom.
2. **`z1` can be larger than a single block.** When you add `z1·B` into the result, `z1` spans two block positions and overlaps both `z2·B²` and `z0`. The addition at the overlap can carry.
3. **Subtraction `z1 = p − z2 − z0` stays non-negative** (since `p = z2 + z1 + z0 ≥ z2 + z0`), but the *intermediate* `p − z2` is fine; just keep enough width.

The discipline: do the polynomial-style combination first (treating blocks as big integers), then run a single **carry-normalization pass** from least-significant limb upward, propagating any limb `≥ B`. This separation — *compute coefficients, then normalize carries* — is the cleanest way to keep integer Karatsuba correct.

### A worked carry example

Multiply `x = 99, y = 99` with `B = 10` (`a=9,b=9,c=9,d=9`):

```
z2 = 9·9 = 81
z0 = 9·9 = 81
p  = (9+9)(9+9) = 18·18 = 324
z1 = 324 − 81 − 81 = 162        # note z1 = 162 > B, will carry
result = z2·100 + z1·10 + z0
       = 8100 + 1620 + 81 = 9801   # = 99·99 ✓
```

`z1 = 162` overflows a single base-10 slot; the recombination addition handles it, and the final normalize yields `9801`. Dropping that carry would give a wrong answer — this is the integer-only failure mode polynomials never have.

---

## The Recurrence in Detail

Karatsuba does **3** recursive multiplications of half-size inputs plus `O(n)` linear work (the additions `a+b`, `c+d`, the subtractions for `z1`, the shifts, and carry propagation):

```
T(n) = 3·T(n/2) + c·n
```

### Solving by the recursion tree

At depth `i` there are `3^i` subproblems, each of size `n / 2^i`, each doing `c·(n/2^i)` linear work:

```
work at depth i = 3^i · c · (n / 2^i) = c·n · (3/2)^i
```

Summing over depths `0 … log₂ n`:

```
T(n) = c·n · Σ_{i=0}^{log₂ n} (3/2)^i
```

The geometric series with ratio `3/2 > 1` is dominated by its last term, `(3/2)^{log₂ n} = n^{log₂(3/2)} = n^{log₂3 − 1}`. Multiplying by the `c·n` prefactor:

```
T(n) = Θ(n · n^{log₂3 − 1}) = Θ(n^{log₂3}) ≈ Θ(n^{1.585})
```

### Master theorem shortcut

With `a = 3, b = 2, f(n) = O(n)`: compare `f(n) = n^1` against `n^{log_b a} = n^{log₂3} ≈ n^{1.585}`. Since `1 < 1.585`, we are in **Case 1** of the master theorem, so `T(n) = Θ(n^{log₂3})`. The leaf work dominates because the branching factor `3` outruns the halving `2`.

### Contrast with the naive split

The four-product split gives `T(n) = 4T(n/2) + O(n)`. Here `a=4, b=2`, so `log_b a = log₂4 = 2`, and `T(n) = Θ(n²)` — no better than schoolbook. **Saving exactly one of the four multiplications is what moves the exponent from `2` to `1.585`.**

---

## Comparison with Alternatives

### Schoolbook vs Karatsuba vs FFT

| Method | Time | Crossover (typical) | Good when |
|--------|------|---------------------|-----------|
| Schoolbook | `O(n²)` | — | smallest inputs (below ~20–40 limbs) |
| **Karatsuba** | `O(n^{1.585})` | ~20–40 limbs | medium inputs (hundreds–thousands of limbs) |
| Toom-3 | `O(n^{1.465})` | ~100–300 limbs | large inputs |
| Toom-4 / higher | `O(n^{log_k(2k−1)})` | larger still | very large |
| FFT / NTT | `O(n log n)` | thousands of limbs | huge inputs |

Concrete operation counts (single-digit multiplies, rough):

| `n` (digits) | Schoolbook `n²` | Karatsuba `n^{1.585}` | Winner |
|--------------|-----------------|------------------------|--------|
| 8 | 64 | ~30 (but high constant) | schoolbook |
| 64 | 4 096 | ~970 | tie-ish (constant matters) |
| 1 000 | 1 000 000 | ~57 000 | Karatsuba |
| 100 000 | 10¹⁰ | ~9 000 000 | Karatsuba |
| 10 000 000 | 10¹⁴ | ~3.7 × 10¹¹ | FFT (`n log n` ≈ 2 × 10⁸) |

The lesson: for **small `n`**, schoolbook's tiny constant wins; for **medium `n`**, Karatsuba; for **huge `n`**, Toom and then FFT. No single algorithm is best everywhere — which is exactly why production libraries layer them.

### Why not always use FFT?

FFT is asymptotically `O(n log n)` but carries a large constant (complex/modular arithmetic, bit-reversal, multiple transform passes) and, for floating-point FFT, rounding concerns. Below thousands of limbs, that overhead makes FFT *slower* than Karatsuba/Toom in practice. The crossover is high.

---

## Toom-Cook Generalization

Karatsuba is **Toom-2**: split into 2 parts, evaluate at 3 points, 3 products. **Toom-Cook** generalizes: split each operand into `k` parts of size `n/k`, treat each as a degree-`(k−1)` polynomial, multiply the two to get a degree-`(2k−2)` polynomial with `2k−1` coefficients, so evaluate at `2k−1` points → `2k−1` products.

| Variant | Split `k` | Products `2k−1` | Exponent `log_k(2k−1)` | Approx |
|---------|-----------|------------------|-------------------------|--------|
| Karatsuba (Toom-2) | 2 | 3 | `log₂3` | 1.585 |
| **Toom-3** | 3 | 5 | `log₃5` | 1.465 |
| Toom-4 | 4 | 7 | `log₄7` | 1.404 |
| Toom-`k` | `k` | `2k−1` | `log_k(2k−1)` | → 1 |

### Toom-3 in outline

Split `x = a₂·B² + a₁·B + a₀`, `y = c₂·B² + c₁·B + c₀`. The product polynomial `R(t)` has degree 4 (5 coefficients `r₀…r₄`). Evaluate `P(t)·Q(t)` at five points (commonly `t = 0, 1, −1, 2, ∞`):

```
R(0)  = a₀·c₀
R(1)  = (a₀+a₁+a₂)(c₀+c₁+c₂)
R(−1) = (a₀−a₁+a₂)(c₀−c₁+c₂)
R(2)  = (a₀+2a₁+4a₂)(c₀+2c₁+4c₂)
R(∞)  = a₂·c₂
```

Five products, then **interpolate** to recover `r₀…r₄` by solving a fixed 5×5 linear system (with small constant entries; the inverse is precomputed and involves exact divisions by small constants like 2, 3, 6). Recombine `R(t) = Σ rᵢ·B^i` with carry propagation as usual.

### Why not split into very many parts?

As `k` grows, the exponent `log_k(2k−1) → 1`, which sounds great. But:

1. The **interpolation matrix gets bigger and its constants larger**, inflating the `O(n)` combination work and the hidden constant.
2. **Numerical / divisibility bookkeeping** (the exact divisions during interpolation) becomes intricate and error-prone.
3. Past a point, **FFT (`O(n log n)`) simply beats all Toom-`k`**.

So in practice libraries use only a few Toom variants (Toom-2.5, Toom-3, Toom-4, Toom-6.5, Toom-8.5 in GMP) before switching to FFT. Toom is the *bridge* between Karatsuba and FFT.

---

## Crossover Thresholds

A real multiply is a **dispatcher** that picks an algorithm by operand size:

```text
multiply(x, y):
    n = size in limbs
    if n < KARATSUBA_CUTOFF:   return schoolbook(x, y)     # ~20–40 limbs
    if n < TOOM3_CUTOFF:       return karatsuba(x, y)      # ~100–300 limbs
    if n < TOOM4_CUTOFF:       return toom3(x, y)
    if n < FFT_CUTOFF:         return toom4(x, y)
    return fft_multiply(x, y)                              # thousands of limbs
```

The cutoffs are **machine- and implementation-specific** and are *measured*, not derived — GMP literally ships per-CPU tuned thresholds generated by a benchmarking program (`tune/`). The exact values depend on cache sizes, multiply latency, and the quality of each routine. The principle: pick the algorithm whose (constant × asymptotic) cost is lowest at that size, and the crossovers are where two cost curves intersect.

For reference orders of magnitude (vary widely by platform):

| Threshold | Typical range (limbs) |
|-----------|------------------------|
| Schoolbook → Karatsuba | ~10–40 |
| Karatsuba → Toom-3 | ~100–300 |
| Toom-3 → Toom-4 | ~300–1000 |
| Toom → FFT | thousands+ |

---

## Code Examples

### Limb-array Karatsuba with a schoolbook cutoff (counting digits in base `2^32`)

This shows the dispatcher + recombination structure on explicit limb arrays, the form a real library uses (sign/full normalization details in [`senior.md`](./senior.md)).

#### Go

```go
package main

import "fmt"

const KARA_CUTOFF = 32 // below this many limbs, use schoolbook

// schoolbook multiplies two little-endian base-2^32 limb arrays.
func schoolbook(x, y []uint64) []uint64 {
	res := make([]uint64, len(x)+len(y))
	for i := 0; i < len(x); i++ {
		var carry uint64
		for j := 0; j < len(y); j++ {
			cur := res[i+j] + x[i]*y[j] + carry
			res[i+j] = cur & 0xFFFFFFFF
			carry = cur >> 32
		}
		res[i+len(y)] += carry
	}
	return normalize(res)
}

func normalize(a []uint64) []uint64 {
	var carry uint64
	for i := range a {
		cur := a[i] + carry
		a[i] = cur & 0xFFFFFFFF
		carry = cur >> 32
	}
	for len(a) > 1 && a[len(a)-1] == 0 {
		a = a[:len(a)-1]
	}
	return a
}

func add(a, b []uint64) []uint64 {
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	res := make([]uint64, n+1)
	var carry uint64
	for i := 0; i < n; i++ {
		var av, bv uint64
		if i < len(a) {
			av = a[i]
		}
		if i < len(b) {
			bv = b[i]
		}
		cur := av + bv + carry
		res[i] = cur & 0xFFFFFFFF
		carry = cur >> 32
	}
	res[n] = carry
	return normalize(res)
}

func sub(a, b []uint64) []uint64 { // assumes a >= b
	res := make([]uint64, len(a))
	var borrow int64
	for i := 0; i < len(a); i++ {
		var bv uint64
		if i < len(b) {
			bv = b[i]
		}
		cur := int64(a[i]) - int64(bv) - borrow
		if cur < 0 {
			cur += 1 << 32
			borrow = 1
		} else {
			borrow = 0
		}
		res[i] = uint64(cur)
	}
	return normalize(res)
}

func shiftLimbs(a []uint64, k int) []uint64 {
	res := make([]uint64, len(a)+k)
	copy(res[k:], a)
	return res
}

func karatsuba(x, y []uint64) []uint64 {
	if len(x) < KARA_CUTOFF || len(y) < KARA_CUTOFF {
		return schoolbook(x, y)
	}
	half := len(x)
	if len(y) > half {
		half = len(y)
	}
	half /= 2

	lo := func(a []uint64) []uint64 {
		if len(a) <= half {
			return append([]uint64{}, a...)
		}
		return append([]uint64{}, a[:half]...)
	}
	hi := func(a []uint64) []uint64 {
		if len(a) <= half {
			return []uint64{0}
		}
		return append([]uint64{}, a[half:]...)
	}

	b, a := lo(x), hi(x)
	d, c := lo(y), hi(y)

	z2 := karatsuba(a, c)
	z0 := karatsuba(b, d)
	z1 := sub(sub(karatsuba(add(a, b), add(c, d)), z2), z0)

	// result = z2<<(2*half) + z1<<half + z0
	res := add(shiftLimbs(z2, 2*half), shiftLimbs(z1, half))
	return add(res, z0)
}

func main() {
	x := []uint64{0x9ABCDEF0, 0x12345678} // little-endian
	y := []uint64{0x11111111, 0x22222222}
	fmt.Println(karatsuba(x, y))
}
```

#### Java

```java
import java.math.BigInteger;

public class KaratsubaLimbs {
    static final int CUTOFF = 32; // bit-length-based for brevity

    // Illustrative limb-free version using BigInteger for the small parts,
    // showing the dispatch + 3-product structure.
    static BigInteger multiply(BigInteger x, BigInteger y) {
        if (x.bitLength() < CUTOFF || y.bitLength() < CUTOFF) {
            return x.multiply(y); // base case
        }
        int half = Math.max(x.bitLength(), y.bitLength()) / 2;
        BigInteger b = x.mod(BigInteger.ONE.shiftLeft(half));
        BigInteger a = x.shiftRight(half);
        BigInteger d = y.mod(BigInteger.ONE.shiftLeft(half));
        BigInteger c = y.shiftRight(half);

        BigInteger z2 = multiply(a, c);
        BigInteger z0 = multiply(b, d);
        BigInteger z1 = multiply(a.add(b), c.add(d)).subtract(z2).subtract(z0);

        return z2.shiftLeft(2 * half).add(z1.shiftLeft(half)).add(z0);
    }

    public static void main(String[] args) {
        BigInteger x = new BigInteger("123456789ABCDEF0", 16);
        BigInteger y = new BigInteger("2222222211111111", 16);
        System.out.println(multiply(x, y).equals(x.multiply(y)));
    }
}
```

#### Python

```python
CUTOFF = 32  # bit length below which we use the built-in multiply


def karatsuba(x: int, y: int) -> int:
    if x.bit_length() < CUTOFF or y.bit_length() < CUTOFF:
        return x * y  # base case
    half = max(x.bit_length(), y.bit_length()) // 2
    mask = (1 << half) - 1
    b, a = x & mask, x >> half
    d, c = y & mask, y >> half

    z2 = karatsuba(a, c)
    z0 = karatsuba(b, d)
    z1 = karatsuba(a + b, c + d) - z2 - z0  # the saved product

    return (z2 << (2 * half)) + (z1 << half) + z0


if __name__ == "__main__":
    import random
    for _ in range(1000):  # property test against the oracle
        x = random.getrandbits(random.randint(1, 400))
        y = random.getrandbits(random.randint(1, 400))
        assert karatsuba(x, y) == x * y
    print("all random tests passed")
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `a+b` overflows a half-limb | Middle product truncated → wrong `z1`. | Allocate one extra limb of headroom for the sums. |
| Dropped carry in recombination | High digits silently corrupt. | Run a full carry-normalization pass after combining. |
| Subtraction `p − z2 − z0` goes negative | Borrow underflow on limb arrays. | The math guarantees `≥ 0`; ensure your `sub` assumes `a ≥ b` and the inputs satisfy it. |
| Wrong shift offset | Result off by a factor of `B`. | Shift by exactly `half` and `2·half` limbs. |
| Missing base case | Infinite recursion / stack overflow. | Dispatch to schoolbook below the cutoff. |
| Unequal operand lengths | Mismatched split points. | Split both at the same `half`; pad shorter operand with zero limbs. |
| Toom interpolation division error | Non-exact division during interpolation. | Use the exact integer division by the known small constants; the result is provably integral. |

---

## Performance Analysis

| `n` (limbs) | Schoolbook `~n²` | Karatsuba `~n^{1.585}` (with ~3× constant) | Practical winner |
|-------------|------------------|---------------------------------------------|------------------|
| 16 | 256 | ~700 | schoolbook |
| 32 | 1 024 | ~2 100 | schoolbook (near crossover) |
| 64 | 4 096 | ~6 300 | ~crossover |
| 256 | 65 536 | ~50 000 | Karatsuba |
| 1 024 | 1 048 576 | ~440 000 | Karatsuba |
| 4 096 | 16 777 216 | ~3 900 000 | Karatsuba / Toom |

The table shows *why* the cutoff exists: Karatsuba's per-call overhead (three sums, two subtractions, carry passes, recursion) gives it a larger constant, so for small `n` the `n²` schoolbook is genuinely faster despite the worse exponent. The crossover is where the curves meet — measure it, do not guess.

```python
import time, random

def bench(n_bits):
    x = random.getrandbits(n_bits)
    y = random.getrandbits(n_bits)
    t0 = time.perf_counter()
    karatsuba(x, y)
    return time.perf_counter() - t0
# Sweep n_bits to find where karatsuba overtakes the schoolbook oracle.
```

The single biggest constant-factor win is a well-tuned **cutoff**, followed by **buffer reuse** to avoid per-call allocation, and the `(a−b)(c−d)` evaluation variant when it keeps operands shorter.

---

## Best Practices

- **Pick `n`-aware:** small `n` → schoolbook; medium → Karatsuba; large → Toom; huge → FFT. The dispatcher *is* the algorithm in production.
- **Tune the cutoff by measurement**, not theory; it is platform-dependent.
- **Separate coefficient computation from carry normalization** — compute `z0,z1,z2` as if polynomials, then normalize carries in one pass.
- **Reserve headroom** for `a+b`, `c+d` (one extra limb) and for `z1` spanning two block positions.
- **Always test against a schoolbook / native-multiply oracle** on many random sizes, including odd lengths and zeros.
- **Reuse scratch buffers** in the recursion to dodge allocation churn; this matters more than micro-optimizing the inner loop.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The split of `x, y` into halves and the three products `z2`, `z0`, `(a+b)(c+d)`.
> - The subtraction recovering `z1`, with `z2` and `z0` removed from the sum-product.
> - The recombination `z2·B² + z1·B + z0` with the shift offsets drawn explicitly.

---

## Summary

The three-multiplication identity is the `degree-1 split, evaluate-at-3-points, interpolate` instance of the universal evaluate–multiply–interpolate scheme: a degree-2 product polynomial is fixed by its values at `∞, 0, 1`, giving the products `a·c`, `b·d`, `(a+b)(c+d)` and the recovered `z1 = (a+b)(c+d) − a·c − b·d`. Three is optimal for a 2-way split. Polynomials run this cleanly; integers add **carry propagation**, which is the dominant bug source — the cure is to compute coefficients first and normalize carries in a single pass. The recurrence `T(n)=3T(n/2)+O(n)` solves to `O(n^{1.585})` because the branching factor 3 outruns the halving 2 (master-theorem Case 1). **Toom-Cook** generalizes to a `k`-way split with `2k−1` products and exponent `log_k(2k−1)` — Toom-3 reaches `≈1.465` — but rising interpolation overhead and eventual **FFT (`O(n log n)`)** dominance keep libraries to just a few Toom levels. Real multiplication is a size-dispatched layering of schoolbook → Karatsuba → Toom → FFT, with crossover thresholds tuned per machine.
