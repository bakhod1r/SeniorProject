# Karatsuba Multiplication (Fast Big-Integer Multiply) — Interview Preparation

Karatsuba is a favourite interview topic because it rewards a single crisp insight — *"replace four half-size products with three using `(a+b)(c+d)`"* — and then tests whether you can (a) derive the recurrence `T(n)=3T(n/2)+O(n)=O(n^{1.585})`, (b) implement the split/recombine cleanly with correct shifts, (c) handle carries and the `a+b` overflow, and (d) place it in the wider ladder of schoolbook → Karatsuba → Toom-Cook → FFT with realistic crossover thresholds. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer | Complexity |
|----------|--------|------------|
| Schoolbook multiply of `n`-digit numbers | digit-by-digit convolution | `O(n²)` |
| Karatsuba | 3 products via `(a+b)(c+d)` | `O(n^{log₂3}) ≈ O(n^{1.585})` |
| Naive divide & conquer (4 products) | no improvement | `O(n²)` |
| Toom-3 | split 3, 5 products | `O(n^{log₃5}) ≈ O(n^{1.465})` |
| Toom-k | split `k`, `2k−1` products | `O(n^{log_k(2k−1)})` |
| FFT / NTT multiply | roots-of-unity convolution | `O(n log n)` |
| **Karatsuba on tiny inputs** | **slower than schoolbook — use a cutoff** | — |

The three terms:

```text
split:    x = a·B + b,   y = c·B + d        (B = base^half)
z2 = a·c                        (high,   ·B²)
z0 = b·d                        (low,    ·B⁰)
z1 = (a+b)(c+d) − z2 − z0       (middle, ·B¹)  = a·d + b·c
result = z2·B² + z1·B + z0
```

Core algorithm:

```text
karatsuba(x, y):
    if small(x) or small(y): return x * y        # schoolbook base case
    half = max(len)/2
    a,b = high(x),low(x);  c,d = high(y),low(y)
    z2 = karatsuba(a, c)
    z0 = karatsuba(b, d)
    z1 = karatsuba(a+b, c+d) - z2 - z0           # the saved product
    return z2 * B^2 + z1 * B + z0                 # O(n^1.585)
```

Key facts:
- **Three** half-size products, not four — that is the whole trick.
- Recurrence `T(n)=3T(n/2)+O(n)`, master-theorem Case 1 → `O(n^{log₂3})`.
- `(a+b)` can be one digit/limb longer than a half — leave headroom.
- Integers = polynomial multiply + **carry propagation**.
- Below the crossover (~20–40 limbs), schoolbook wins.

---

## Junior Questions (12 Q&A)

### J1. What problem does Karatsuba solve, and why?
Multiplying two large `n`-digit integers. Schoolbook multiplication is `O(n²)`, which is too slow for very large numbers. Karatsuba does it in `O(n^{1.585})` by divide and conquer, replacing four half-size multiplications with three.

### J2. What is the schoolbook complexity and why?
`O(n²)`: every one of the `n` digits of one number multiplies every one of the `n` digits of the other, then the partial products are shifted and added. That is `n × n` single-digit multiplies.

### J3. How does Karatsuba split the numbers?
For operands of length `2n`, pick base `B = base^n` and write `x = a·B + b`, `y = c·B + d`, where `a, c` are the high halves and `b, d` are the low halves.

### J4. What are z0, z1, z2?
The three coefficients of the product `x·y = z2·B² + z1·B + z0`, where `z2 = a·c` (high), `z0 = b·d` (low), and `z1 = a·d + b·c` (the middle/cross term).

### J5. What is the key trick?
Instead of computing `a·d` and `b·c` separately (two products), compute one product `(a+b)(c+d) = z2 + z1 + z0`, then recover `z1 = (a+b)(c+d) − z2 − z0`. This uses three multiplications total instead of four.

### J6. What is the recurrence and what does it solve to?
`T(n) = 3T(n/2) + O(n)`. By the master theorem (Case 1) it solves to `O(n^{log₂3}) ≈ O(n^{1.585})`.

### J7. Why is the exponent `log₂3`?
Each call makes 3 recursive calls on half-size inputs. With `a = 3` recursive calls and `b = 2` (halving), the master-theorem critical exponent is `log_b a = log₂3 ≈ 1.585`, and the linear combine work is smaller, so that exponent dominates.

### J8. Why is the naive (four-product) version no faster?
`T(n) = 4T(n/2) + O(n)` has `log₂4 = 2`, so it is `O(n²)` — the same as schoolbook. Only by dropping to three products do you beat `O(n²)`.

### J9. How do you recombine the three products?
`result = z2·B² + z1·B + z0`. Multiplying by `B` or `B²` is a shift (appending zeros), then you add the shifted blocks together.

### J10. Why is there a base case / cutoff?
For small numbers, Karatsuba's overhead (extra additions, recursion) makes it slower than schoolbook. Below a threshold (~20–40 limbs) you fall back to schoolbook multiplication.

### J11. Does it work for polynomials too?
Yes — identically. A number in base `B` is a polynomial evaluated at `B`. Polynomial Karatsuba is the same algorithm; the only difference is integers need carry propagation and polynomials do not.

### J12 (analysis). Roughly how much faster is Karatsuba for 10,000-digit numbers?
Schoolbook is `10000² = 10⁸` digit-multiplies; Karatsuba is `~10000^{1.585} ≈ 4×10⁶`. That is roughly a 25× reduction in the dominant operation count, and the gap widens with size.

---

## Middle Questions (12 Q&A)

### M1. Derive the three-product identity.
`(aB+b)(cB+d) = acB² + (ad+bc)B + bd`. Let `z2 = ac`, `z0 = bd`. Note `(a+b)(c+d) = ac + ad + bc + bd = z2 + (ad+bc) + z0`, so `ad+bc = (a+b)(c+d) − z2 − z0`. That gives the middle coefficient with one extra product, three total.

### M2. What is the alternative `(a−b)(c−d)` form, and why use it?
Evaluating the product polynomial at `{0,1,−1}` gives `z1 = [(a+b)(c+d) − (a−b)(c−d)]/2`. Using `(a−b)(c−d)` keeps operands the same length as a half (subtraction does not grow length the way `a+b` can), at the cost of signed intermediates.

### M3. Why is integer Karatsuba harder than polynomial Karatsuba?
Carry propagation. Polynomial coefficients can be any size and sit in their slot; integer "coefficients" must stay in `[0, B)`, so overlapping additions during recombination carry into higher positions. The fix is to compute coefficients first, then run a single carry-normalization pass.

### M4. What is the `a+b` overflow issue?
Two `n`-digit halves sum to up to `n+1` digits, so `(a+b)(c+d)` is up to `2n+2` digits, not `2n`. If you size the middle buffer at `2n` and truncate, you drop the top — a classic bug. Reserve one extra limb of headroom.

### M5. Solve the recurrence with a recursion tree.
Level `i` has `3^i` nodes of size `n/2^i` doing `O(n/2^i)` work, so `O(n)(3/2)^i` per level. Summing over `log₂ n` levels, the geometric series (ratio `3/2 > 1`) is dominated by the leaves: `O(n·(3/2)^{log₂n}) = O(n·n^{log₂3−1}) = O(n^{log₂3})`.

### M6. What is Toom-Cook, and how does Toom-3 relate to Karatsuba?
Karatsuba is Toom-2 (split 2, 3 products). Toom-3 splits into 3 parts, treats each operand as a degree-2 polynomial, multiplies to a degree-4 product (5 coefficients), evaluates at 5 points, multiplies, and interpolates — 5 products. Its complexity is `O(n^{log₃5}) ≈ O(n^{1.465})`.

### M7. Why not split into arbitrarily many Toom parts?
The exponent `log_k(2k−1) → 1` as `k → ∞`, but the interpolation matrix grows, inflating the linear-combine constant and the bookkeeping (exact divisions). Past a point, FFT (`O(n log n)`) beats all Toom variants, so libraries use only a few Toom levels.

### M8. What is the evaluate–multiply–interpolate scheme?
A degree-`d` product polynomial is determined by its values at `d+1` points. So: evaluate both inputs at enough points, multiply pointwise, then interpolate the product's coefficients. Karatsuba (3 points), Toom-k (`2k−1` points), and FFT (roots of unity) are all instances.

### M9. Where do the crossover thresholds sit, and who decides them?
Schoolbook→Karatsuba around 20–40 limbs, Karatsuba→Toom-3 around 100–300, Toom→FFT in the thousands — but these are machine-specific and *measured*. GMP ships a benchmarking `tune` program that emits per-CPU thresholds.

### M10. How does Karatsuba compare with FFT?
FFT is asymptotically faster (`O(n log n)`), but its large constant (transforms, complex/modular arithmetic) makes it slower than Karatsuba/Toom below thousands of limbs. Karatsuba owns the small-to-medium band; FFT owns the huge band.

### M11. What is the space complexity?
`O(n)` for the result and temporaries if buffers are reused; recursion depth is `O(log n)`. A naive implementation that allocates fresh arrays at every level churns `O(n^{1.585})` allocations — production code uses a single scratch arena.

### M12 (analysis). For what size does Karatsuba beat schoolbook in practice?
Asymptotically always (above `n=1`), but practically only above the crossover (~20–40 limbs) where its larger constant is amortized. Below that, schoolbook's tiny, cache-friendly constant wins despite the worse exponent.

---

## Senior Questions (10 Q&A)

### S1. How would you implement Karatsuba on machine-word limbs?
Use base `B = 2^32` or `2^64`, store limbs little-endian, sign separate. Split high/low as array slices, compute the three products recursively (dispatching to schoolbook below the cutoff), recover `z1` by subtraction, and recombine by writing blocks at limb offsets `0`, `half`, `2·half` with a carry pass. With 64-bit limbs the limb product is 128 bits, so use a wide-multiply primitive or 32-bit limbs.

### S2. How do you manage memory so Karatsuba is fast, not GC-bound?
Preallocate a single `O(n)` scratch arena and pass disjoint slices down the recursion instead of allocating per level. Write `z0` and `z2` directly into their result positions and compute `z1` in scratch. This is why GMP's `mpn_mul` takes a caller-provided scratch buffer.

### S3. How do you tune the crossover threshold?
Measure. Benchmark schoolbook vs Karatsuba across sizes on the target CPU and pick where the curves cross; it depends on multiply latency, cache, and how optimized each routine is. Hard-coding another machine's threshold can make Karatsuba slower than schoolbook in its own band.

### S4. Describe the GMP-style hybrid multiply.
A size dispatcher: schoolbook → Karatsuba (Toom-2) → Toom-3 → Toom-4 → … → FFT (Schönhage-Strassen). Each level recurses into the dispatcher, so sub-multiplies pick their own best algorithm. Squaring has a parallel, cheaper tower. All governed by tuned thresholds.

### S5. What are the main carry/overflow failure modes?
Truncated middle product (drop the `(a+b)(c+d)` carry-out limb), lost recombination carry (stopping after one limb instead of propagating), limb-accumulator overflow (64-bit `res+x*y+carry` overflowing — use 128-bit), and sign slips in the `(a−b)(c−d)` variant. All pass small tests and fail on all-ones carry-stress inputs.

### S6. How do you test a fast multiply for correctness?
Differential testing against a schoolbook oracle (or native `*`) across a wide range of sizes including odd and unequal lengths, plus deliberate all-ones carry-stress inputs that force maximal carry chains. Also check commutativity, identity, and cross-validate Toom vs Karatsuba. Run in CI on every commit.

### S7. Why is squaring special-cased?
`x²` has coinciding cross terms, so it is cheaper than a general product (schoolbook squaring is `~n²/2`). Modular exponentiation (RSA) squares far more often than it multiplies, so a dedicated squaring path (and its own thresholds) is a major real-world win.

### S8. How do unbalanced operands (`n × m`, `m ≪ n`) change things?
The balanced split wastes work on the tiny operand. Libraries use unbalanced Toom variants (Toom-2.5, Toom-3.5) or split the large operand into `m`-sized blocks each multiplied by the small one. Tuning thus has two dimensions: size and ratio.

### S9. When is Karatsuba the wrong choice?
Below the crossover (schoolbook wins), and far above it (Toom/FFT win). Also when only a small fixed-width multiply is needed (just use the hardware instruction), or when constant-time behavior is required for secrets and the data-dependent crossover branch would leak timing.

### S10 (analysis). Why does the exponent improve from 2 to 1.585 with exactly one saved multiply?
The recurrence branching factor sets the exponent via `log_b a`. Four products give `log₂4 = 2`; three give `log₂3 ≈ 1.585`. The `O(n)` combine work is asymptotically smaller than both, so the recursion's branching factor alone determines the exponent — dropping one product changes `a` from 4 to 3.

---

## Professional Questions (8 Q&A)

### P1. Prove that three multiplications is optimal for a 2-way split.
The map `(a,b),(c,d) ↦ (ac, ad+bc, bd)` is a bilinear map of **rank 3**: Karatsuba achieves 3 (upper bound), and a dimension-counting argument shows two products cannot span the three independent output forms `ac, ad+bc, bd` (lower bound). So no balanced 2-way scheme beats `3T(n/2)`; improvement requires a different split (Toom) or domain (FFT).

### P2. Derive the Toom-k complexity.
Split into `k` parts → degree-`(k−1)` polynomials → product of degree `2k−2` with `2k−1` coefficients → evaluate at `2k−1` points, `2k−1` recursive products. Recurrence `T(n)=(2k−1)T(n/k)+Θ(n)`, master-theorem Case 1 → `Θ(n^{log_k(2k−1)})`. As `k→∞`, `log_k(2k−1) = ln(2k−1)/ln k → 1`.

### P3. Why does increasing `k` not help indefinitely?
The exponent tends to 1, but the interpolation matrix has `(2k−1)²` entries of growing magnitude with more exact divisions, inflating the `Θ(n)` constant. The constant blows up before the exponent gain pays off, and FFT (`O(n log n)`) dominates beyond moderate `k`.

### P4. Explain the integer/polynomial correspondence formally.
With coefficients in `[0,B)`, `P(B)=x`, `Q(B)=y`, the substitution `t↦B` is a ring homomorphism, so `(PQ)(B)=xy`. The convolution coefficients `r_l = Σ_{i+j=l} a_i c_j` are exact over `ℤ` but may exceed `B`; a single linear carry pass `limb_l = r_l mod B`, `carry += ⌊r_l/B⌋` canonicalizes them. All asymptotic content is in the carry-free convolution.

### P5. How does FFT emerge as the limit of the evaluate-interpolate scheme?
Choose the evaluation points to be `N`-th roots of unity. Then evaluation = DFT and interpolation = inverse DFT, each computable in `O(n log n)` by Cooley-Tukey. The convolution theorem `P·Q = DFT^{-1}(DFT P ⊙ DFT Q)` gives `O(n log n)` multiplication. Karatsuba/Toom evaluate at a fixed few points; FFT evaluates at `Θ(n)` cleverly chosen points cheaply.

### P6. What is the best known complexity for integer multiplication?
`O(n log n)` bit complexity, by Harvey–van der Hoeven (2019), conjectured optimal. The classic Schönhage-Strassen achieves `O(n log n log log n)`. No superlinear lower bound is known, so whether `o(n log n)` is possible is open. Karatsuba (`n^{1.585}`) and Toom (`n^{log_k(2k−1)}`) are the practical mid-range methods below FFT sizes.

### P7. Design a production big-integer multiply.
A size-dispatched tower over limb arrays: schoolbook (asm/tight loop) for tiny, Karatsuba for small, Toom-3/4 for large, FFT/NTT for huge — with per-CPU tuned thresholds and a parallel squaring tower. Use a single scratch arena (no per-level allocation), handle sign separately, normalize carries in one pass, and differentially test against a schoolbook oracle with carry-stress inputs in CI.

### P8 (analysis). Why must NTT (not floating-point FFT) be used for exact integer multiply?
Floating-point FFT accumulates rounding error; for exact integer results you need the coefficients exact. Number-Theoretic Transform works modulo a prime with a root of unity, keeping all arithmetic exact, then the carry pass finishes. Multiple primes + CRT recover coefficients larger than one prime's range.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a quadratic algorithm with a sub-quadratic one.
Look for a concrete story: a big-number or convolution workload where `O(n²)` dominated a profile, the divide-and-conquer insight (split + reuse a saved product), the measured speedup, and — crucially — the correctness check against the old slow version on random and edge-case inputs.

### B2. A teammate's Karatsuba passes small tests but fails on large inputs. How do you debug it?
This smells like a dropped carry or truncated middle product (`(a+b)(c+d)` overflowing a half). Reproduce with all-ones inputs that force maximal carries, diff against a schoolbook oracle limb by limb, and check the middle buffer has `+2` headroom and the recombination carry propagates fully.

### B3. Design the multiply routine for a new big-integer library. What do you prioritize?
A correct schoolbook base case and a schoolbook oracle first; then Karatsuba with a measured crossover; then Toom and FFT as size grows. Prioritize buffer reuse (no per-call allocation), per-CPU threshold tuning, a parallel squaring path, and a CI differential test harness with carry-stress cases. Mention constant-time variants if crypto is a use case.

### B4. How would you explain Karatsuba to a junior engineer?
Use the bundle-deal analogy: instead of buying four items (four products), buy the two endpoints (`a·c`, `b·d`) and one combined bundle (`(a+b)(c+d)`), then subtract to recover the middle item for free. Then show the recurrence and that saving one multiply drops the exponent from 2 to 1.585. Lead with the two gotchas: carries and the small-input cutoff.

### B5. Your cryptographic multiply is leaking timing. What is wrong and how do you fix it?
Data-dependent control flow: a crossover branch or early-out normalization whose path depends on secret operand values leaks timing. Fix by making the base case constant-time and the control flow uniform regardless of operand content when inputs are secret, even at some performance cost.

---

## Coding Challenges

### Challenge 1: Karatsuba on Non-Negative Integers

**Problem.** Implement `karatsuba(x, y)` for two non-negative integers using the three-product trick, with a small-input fallback. Return the exact product.

**Example.**
```text
karatsuba(1234, 5678) -> 7006652
karatsuba(0, 999)     -> 0
```

**Constraints.** Arbitrary precision; recursion must use exactly three sub-multiplications.

**Optimal.** `O(n^{log₂3})`.

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func karatsuba(x, y *big.Int) *big.Int {
	if x.BitLen() <= 64 || y.BitLen() <= 64 {
		return new(big.Int).Mul(x, y)
	}
	n := x.BitLen()
	if y.BitLen() > n {
		n = y.BitLen()
	}
	half := n / 2
	mask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), uint(half)), big.NewInt(1))

	b := new(big.Int).And(x, mask)
	a := new(big.Int).Rsh(x, uint(half))
	d := new(big.Int).And(y, mask)
	c := new(big.Int).Rsh(y, uint(half))

	z2 := karatsuba(a, c)
	z0 := karatsuba(b, d)
	z1 := karatsuba(new(big.Int).Add(a, b), new(big.Int).Add(c, d))
	z1.Sub(z1, z2)
	z1.Sub(z1, z0)

	res := new(big.Int).Lsh(z2, uint(2*half))
	res.Add(res, new(big.Int).Lsh(z1, uint(half)))
	res.Add(res, z0)
	return res
}

func main() {
	fmt.Println(karatsuba(big.NewInt(1234), big.NewInt(5678))) // 7006652
	fmt.Println(karatsuba(big.NewInt(0), big.NewInt(999)))     // 0
}
```

**Java.**
```java
import java.math.BigInteger;

public class Challenge1 {
    static BigInteger karatsuba(BigInteger x, BigInteger y) {
        if (x.bitLength() <= 64 || y.bitLength() <= 64) return x.multiply(y);
        int half = Math.max(x.bitLength(), y.bitLength()) / 2;
        BigInteger m = BigInteger.ONE.shiftLeft(half);
        BigInteger b = x.mod(m), a = x.shiftRight(half);
        BigInteger d = y.mod(m), c = y.shiftRight(half);
        BigInteger z2 = karatsuba(a, c);
        BigInteger z0 = karatsuba(b, d);
        BigInteger z1 = karatsuba(a.add(b), c.add(d)).subtract(z2).subtract(z0);
        return z2.shiftLeft(2 * half).add(z1.shiftLeft(half)).add(z0);
    }

    public static void main(String[] args) {
        System.out.println(karatsuba(BigInteger.valueOf(1234), BigInteger.valueOf(5678))); // 7006652
        System.out.println(karatsuba(BigInteger.ZERO, BigInteger.valueOf(999)));          // 0
    }
}
```

**Python.**
```python
def karatsuba(x: int, y: int) -> int:
    if x < (1 << 64) or y < (1 << 64):
        return x * y
    half = max(x.bit_length(), y.bit_length()) // 2
    mask = (1 << half) - 1
    b, a = x & mask, x >> half
    d, c = y & mask, y >> half
    z2 = karatsuba(a, c)
    z0 = karatsuba(b, d)
    z1 = karatsuba(a + b, c + d) - z2 - z0
    return (z2 << (2 * half)) + (z1 << half) + z0


if __name__ == "__main__":
    print(karatsuba(1234, 5678))  # 7006652
    print(karatsuba(0, 999))      # 0
```

---

### Challenge 2: Karatsuba on Digit Strings

**Problem.** Multiply two non-negative integers given as **decimal strings** (no built-in big-int multiply on the whole numbers) using Karatsuba on the string digits, returning the product as a string. You may convert small chunks with the language's int.

**Example.**
```text
"1234" × "5678" -> "7006652"
"99"   × "99"   -> "9801"
```

**Approach.** Pad to equal even length, split into high/low decimal halves, recurse with three products, recombine with decimal shifts (appending zeros) and string/long addition.

**Go.**
```go
package main

import (
	"fmt"
	"strconv"
	"strings"
)

func addStr(a, b string) string {
	i, j := len(a)-1, len(b)-1
	carry := 0
	var sb strings.Builder
	for i >= 0 || j >= 0 || carry > 0 {
		s := carry
		if i >= 0 {
			s += int(a[i] - '0')
			i--
		}
		if j >= 0 {
			s += int(b[j] - '0')
			j--
		}
		sb.WriteByte(byte(s%10) + '0')
		carry = s / 10
	}
	r := []byte(sb.String())
	for l, h := 0, len(r)-1; l < h; l, h = l+1, h-1 {
		r[l], r[h] = r[h], r[l]
	}
	return strings.TrimLeft(string(r), "0")
}

func subStr(a, b string) string { // a >= b
	i, j := len(a)-1, len(b)-1
	borrow := 0
	res := make([]byte, len(a))
	for k := len(a) - 1; k >= 0; k-- {
		d := int(a[i]-'0') - borrow
		if j >= 0 {
			d -= int(b[j] - '0')
			j--
		}
		if d < 0 {
			d += 10
			borrow = 1
		} else {
			borrow = 0
		}
		res[k] = byte(d) + '0'
		i--
	}
	s := strings.TrimLeft(string(res), "0")
	if s == "" {
		return "0"
	}
	return s
}

func shift(a string, k int) string {
	if a == "0" {
		return "0"
	}
	return a + strings.Repeat("0", k)
}

func karatsuba(x, y string) string {
	x = strings.TrimLeft(x, "0")
	y = strings.TrimLeft(y, "0")
	if x == "" {
		x = "0"
	}
	if y == "" {
		y = "0"
	}
	if len(x) <= 4 || len(y) <= 4 {
		xi, _ := strconv.Atoi(x)
		yi, _ := strconv.Atoi(y)
		return strconv.Itoa(xi * yi)
	}
	n := len(x)
	if len(y) > n {
		n = len(y)
	}
	half := n / 2
	for len(x) < n {
		x = "0" + x
	}
	for len(y) < n {
		y = "0" + y
	}
	a, b := x[:n-half], x[n-half:]
	c, d := y[:n-half], y[n-half:]

	z2 := karatsuba(a, c)
	z0 := karatsuba(b, d)
	z1 := subStr(subStr(karatsuba(addStr(a, b), addStr(c, d)), z2), z0)

	res := addStr(shift(z2, 2*half), shift(z1, half))
	return addStr(res, z0)
}

func main() {
	fmt.Println(karatsuba("1234", "5678")) // 7006652
	fmt.Println(karatsuba("99", "99"))     // 9801
}
```

**Java.**
```java
import java.math.BigInteger;

public class Challenge2 {
    // String front-end; uses BigInteger only at the small base case for brevity.
    static String karatsuba(String x, String y) {
        x = strip(x); y = strip(y);
        if (x.length() <= 4 || y.length() <= 4) {
            return String.valueOf(Long.parseLong(x) * Long.parseLong(y));
        }
        int n = Math.max(x.length(), y.length());
        int half = n / 2;
        x = pad(x, n); y = pad(y, n);
        String a = x.substring(0, n - half), b = x.substring(n - half);
        String c = y.substring(0, n - half), d = y.substring(n - half);

        BigInteger z2 = new BigInteger(karatsuba(a, c));
        BigInteger z0 = new BigInteger(karatsuba(b, d));
        BigInteger ab = new BigInteger(addStr(a, b));
        BigInteger cd = new BigInteger(addStr(c, d));
        BigInteger z1 = new BigInteger(karatsuba(ab.toString(), cd.toString()))
                            .subtract(z2).subtract(z0);

        BigInteger B = BigInteger.TEN.pow(half);
        return z2.multiply(B).multiply(B).add(z1.multiply(B)).add(z0).toString();
    }

    static String addStr(String a, String b) {
        return new BigInteger(a).add(new BigInteger(b)).toString();
    }
    static String strip(String s) { s = s.replaceFirst("^0+", ""); return s.isEmpty() ? "0" : s; }
    static String pad(String s, int n) { StringBuilder sb = new StringBuilder(s); while (sb.length() < n) sb.insert(0, '0'); return sb.toString(); }

    public static void main(String[] args) {
        System.out.println(karatsuba("1234", "5678")); // 7006652
        System.out.println(karatsuba("99", "99"));     // 9801
    }
}
```

**Python.**
```python
def karatsuba_str(x: str, y: str) -> str:
    x = x.lstrip("0") or "0"
    y = y.lstrip("0") or "0"
    if len(x) <= 4 or len(y) <= 4:
        return str(int(x) * int(y))
    n = max(len(x), len(y))
    half = n // 2
    x, y = x.zfill(n), y.zfill(n)
    a, b = x[: n - half], x[n - half:]
    c, d = y[: n - half], y[n - half:]

    z2 = int(karatsuba_str(a, c))
    z0 = int(karatsuba_str(b, d))
    ab = str(int(a) + int(b))
    cd = str(int(c) + int(d))
    z1 = int(karatsuba_str(ab, cd)) - z2 - z0

    B = 10 ** half
    return str(z2 * B * B + z1 * B + z0)


if __name__ == "__main__":
    print(karatsuba_str("1234", "5678"))  # 7006652
    print(karatsuba_str("99", "99"))      # 9801
```

---

### Challenge 3: Polynomial Multiplication via Karatsuba

**Problem.** Multiply two polynomials given as coefficient arrays (index = degree) using Karatsuba, returning the convolution. No carries (coefficients can be any integer).

**Example.**
```text
(1 + 2x) × (3 + 4x) = 3 + 10x + 8x²  ->  [3, 10, 8]
```

**Approach.** Split each polynomial at the middle degree, recurse on three half-degree products, recombine by adding shifted coefficient blocks.

**Go.**
```go
package main

import "fmt"

func polyAdd(a, b []int64) []int64 {
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	r := make([]int64, n)
	for i := 0; i < n; i++ {
		if i < len(a) {
			r[i] += a[i]
		}
		if i < len(b) {
			r[i] += b[i]
		}
	}
	return r
}

func polyKaratsuba(p, q []int64) []int64 {
	n := len(p)
	if len(q) > n {
		n = len(q)
	}
	if n <= 2 {
		res := make([]int64, len(p)+len(q)-1)
		for i := range p {
			for j := range q {
				res[i+j] += p[i] * q[j]
			}
		}
		return res
	}
	half := n / 2
	get := func(a []int64, lo, hi int) []int64 {
		out := []int64{}
		for i := lo; i < hi; i++ {
			if i < len(a) {
				out = append(out, a[i])
			} else {
				out = append(out, 0)
			}
		}
		return out
	}
	b, a := get(p, 0, half), get(p, half, n)
	d, c := get(q, 0, half), get(q, half, n)

	z2 := polyKaratsuba(a, c)
	z0 := polyKaratsuba(b, d)
	z1 := polyKaratsuba(polyAdd(a, b), polyAdd(c, d))
	for i := range z2 {
		z1[i] -= z2[i]
	}
	for i := range z0 {
		z1[i] -= z0[i]
	}

	res := make([]int64, len(p)+len(q)-1)
	for i := range z0 {
		res[i] += z0[i]
	}
	for i := range z1 {
		res[i+half] += z1[i]
	}
	for i := range z2 {
		res[i+2*half] += z2[i]
	}
	return res
}

func main() {
	fmt.Println(polyKaratsuba([]int64{1, 2}, []int64{3, 4})) // [3 10 8]
}
```

**Java.**
```java
import java.util.Arrays;

public class Challenge3 {
    static long[] add(long[] a, long[] b) {
        int n = Math.max(a.length, b.length);
        long[] r = new long[n];
        for (int i = 0; i < n; i++) {
            if (i < a.length) r[i] += a[i];
            if (i < b.length) r[i] += b[i];
        }
        return r;
    }

    static long[] slice(long[] a, int lo, int hi) {
        long[] out = new long[hi - lo];
        for (int i = lo; i < hi; i++) out[i - lo] = (i < a.length) ? a[i] : 0;
        return out;
    }

    static long[] karatsuba(long[] p, long[] q) {
        int n = Math.max(p.length, q.length);
        if (n <= 2) {
            long[] res = new long[p.length + q.length - 1];
            for (int i = 0; i < p.length; i++)
                for (int j = 0; j < q.length; j++)
                    res[i + j] += p[i] * q[j];
            return res;
        }
        int half = n / 2;
        long[] b = slice(p, 0, half), a = slice(p, half, n);
        long[] d = slice(q, 0, half), c = slice(q, half, n);
        long[] z2 = karatsuba(a, c);
        long[] z0 = karatsuba(b, d);
        long[] z1 = karatsuba(add(a, b), add(c, d));
        for (int i = 0; i < z2.length; i++) z1[i] -= z2[i];
        for (int i = 0; i < z0.length; i++) z1[i] -= z0[i];

        long[] res = new long[p.length + q.length - 1];
        for (int i = 0; i < z0.length; i++) res[i] += z0[i];
        for (int i = 0; i < z1.length; i++) res[i + half] += z1[i];
        for (int i = 0; i < z2.length; i++) res[i + 2 * half] += z2[i];
        return res;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(karatsuba(new long[]{1, 2}, new long[]{3, 4}))); // [3, 10, 8]
    }
}
```

**Python.**
```python
def poly_add(a, b):
    n = max(len(a), len(b))
    r = [0] * n
    for i in range(len(a)):
        r[i] += a[i]
    for i in range(len(b)):
        r[i] += b[i]
    return r


def poly_karatsuba(p, q):
    n = max(len(p), len(q))
    if n <= 2:
        res = [0] * (len(p) + len(q) - 1)
        for i, pi in enumerate(p):
            for j, qj in enumerate(q):
                res[i + j] += pi * qj
        return res
    half = n // 2
    sl = lambda a, lo, hi: [a[i] if i < len(a) else 0 for i in range(lo, hi)]
    b, a = sl(p, 0, half), sl(p, half, n)
    d, c = sl(q, 0, half), sl(q, half, n)
    z2 = poly_karatsuba(a, c)
    z0 = poly_karatsuba(b, d)
    z1 = poly_karatsuba(poly_add(a, b), poly_add(c, d))
    for i in range(len(z2)):
        z1[i] -= z2[i]
    for i in range(len(z0)):
        z1[i] -= z0[i]
    res = [0] * (len(p) + len(q) - 1)
    for i in range(len(z0)):
        res[i] += z0[i]
    for i in range(len(z1)):
        res[i + half] += z1[i]
    for i in range(len(z2)):
        res[i + 2 * half] += z2[i]
    return res


if __name__ == "__main__":
    print(poly_karatsuba([1, 2], [3, 4]))  # [3, 10, 8]
```

---

### Challenge 4: Crossover-Tuned Multiply (Schoolbook ↔ Karatsuba)

**Problem.** Implement a multiply that uses schoolbook below a cutoff and Karatsuba above it, on limb arrays (base `2^16` for simple overflow-free products). Verify it matches the native product.

**Approach.** A dispatcher keyed on limb count; below `CUTOFF`, the `O(n²)` schoolbook; above, the three-product split recursing into the dispatcher.

**Python.**
```python
BASE = 1 << 16
CUTOFF = 8  # limbs


def to_limbs(x):
    out = []
    while x:
        out.append(x & (BASE - 1))
        x >>= 16
    return out or [0]


def from_limbs(a):
    x = 0
    for limb in reversed(a):
        x = (x << 16) | limb
    return x


def normalize(a):
    carry = 0
    for i in range(len(a)):
        a[i] += carry
        carry = a[i] >> 16
        a[i] &= BASE - 1
    while carry:
        a.append(carry & (BASE - 1))
        carry >>= 16
    while len(a) > 1 and a[-1] == 0:
        a.pop()
    return a


def schoolbook(x, y):
    r = [0] * (len(x) + len(y))
    for i, xi in enumerate(x):
        for j, yj in enumerate(y):
            r[i + j] += xi * yj
    return normalize(r)


def add(a, b):
    n = max(len(a), len(b))
    r = [0] * n
    for i in range(len(a)):
        r[i] += a[i]
    for i in range(len(b)):
        r[i] += b[i]
    return normalize(r)


def multiply(x, y):
    if len(x) <= CUTOFF or len(y) <= CUTOFF:
        return schoolbook(x, y)
    half = max(len(x), len(y)) // 2
    b, a = x[:half] or [0], x[half:] or [0]
    d, c = y[:half] or [0], y[half:] or [0]
    z2 = multiply(a, c)
    z0 = multiply(b, d)
    z1 = from_limbs(multiply(add(a, b), add(c, d))) - from_limbs(z2) - from_limbs(z0)
    res = from_limbs(z0)
    res += from_limbs(z1) << (16 * half)
    res += from_limbs(z2) << (16 * 2 * half)
    return to_limbs(res)


if __name__ == "__main__":
    import random
    for _ in range(2000):
        x = random.getrandbits(random.randint(1, 600))
        y = random.getrandbits(random.randint(1, 600))
        assert from_limbs(multiply(to_limbs(x), to_limbs(y))) == x * y
    print("crossover multiply matches native on all random tests")
```

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
	"math/rand"
)

const CUTOFF = 8

func multiply(x, y *big.Int) *big.Int {
	lx, ly := (x.BitLen()+15)/16, (y.BitLen()+15)/16
	if lx <= CUTOFF || ly <= CUTOFF {
		return new(big.Int).Mul(x, y) // schoolbook-class base case
	}
	half := lx
	if ly > half {
		half = ly
	}
	half = (half / 2) * 16
	mask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), uint(half)), big.NewInt(1))
	b := new(big.Int).And(x, mask)
	a := new(big.Int).Rsh(x, uint(half))
	d := new(big.Int).And(y, mask)
	c := new(big.Int).Rsh(y, uint(half))
	z2 := multiply(a, c)
	z0 := multiply(b, d)
	z1 := new(big.Int).Sub(new(big.Int).Sub(multiply(new(big.Int).Add(a, b), new(big.Int).Add(c, d)), z2), z0)
	res := new(big.Int).Lsh(z2, uint(2*half))
	res.Add(res, new(big.Int).Lsh(z1, uint(half)))
	res.Add(res, z0)
	return res
}

func main() {
	for i := 0; i < 2000; i++ {
		x := new(big.Int).Rand(rand.New(rand.NewSource(int64(i))), new(big.Int).Lsh(big.NewInt(1), 600))
		y := new(big.Int).Rand(rand.New(rand.NewSource(int64(i+1))), new(big.Int).Lsh(big.NewInt(1), 600))
		if multiply(x, y).Cmp(new(big.Int).Mul(x, y)) != 0 {
			panic("mismatch")
		}
	}
	fmt.Println("crossover multiply matches native on all random tests")
}
```

**Java.**
```java
import java.math.BigInteger;
import java.util.Random;

public class Challenge4 {
    static final int CUTOFF = 8 * 16; // bits

    static BigInteger multiply(BigInteger x, BigInteger y) {
        if (x.bitLength() <= CUTOFF || y.bitLength() <= CUTOFF) {
            return x.multiply(y); // base case
        }
        int half = (Math.max(x.bitLength(), y.bitLength()) / 32) * 16;
        if (half == 0) half = 16;
        BigInteger m = BigInteger.ONE.shiftLeft(half);
        BigInteger b = x.mod(m), a = x.shiftRight(half);
        BigInteger d = y.mod(m), c = y.shiftRight(half);
        BigInteger z2 = multiply(a, c);
        BigInteger z0 = multiply(b, d);
        BigInteger z1 = multiply(a.add(b), c.add(d)).subtract(z2).subtract(z0);
        return z2.shiftLeft(2 * half).add(z1.shiftLeft(half)).add(z0);
    }

    public static void main(String[] args) {
        Random rnd = new Random(7);
        for (int i = 0; i < 2000; i++) {
            BigInteger x = new BigInteger(1 + rnd.nextInt(600), rnd);
            BigInteger y = new BigInteger(1 + rnd.nextInt(600), rnd);
            if (!multiply(x, y).equals(x.multiply(y))) throw new AssertionError("bug");
        }
        System.out.println("crossover multiply matches native on all random tests");
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Karatsuba replaces four half-size products with three via `(a+b)(c+d)`, giving `T(n)=3T(n/2)+O(n)=O(n^{1.585})`."*
- Immediately flag the two gotchas: **carry propagation** (and the `a+b` overflow) and the **small-input cutoff** (schoolbook wins below the crossover).
- If asked to go faster, mention the ladder: **Toom-Cook** (`n^{log_k(2k−1)}`) then **FFT/NTT** (`n log n`), with measured crossover thresholds (GMP).
- Note the polynomial/integer correspondence: same algorithm, integers just add a carry pass.
- Always offer to verify against a schoolbook oracle with **all-ones carry-stress** inputs, not just random ones.
