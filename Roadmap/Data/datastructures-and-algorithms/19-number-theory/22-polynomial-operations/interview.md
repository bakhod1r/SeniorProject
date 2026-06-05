# Polynomial Operations (over a Field, especially mod p) — Interview Preparation

Polynomial arithmetic is a recurring interview and contest topic because it rewards a few crisp ideas — *"multiplying polynomials is convolving coefficient arrays"*, *"Horner evaluates in `O(n)`"*, *"`n+1` distinct points determine a unique degree-`≤ n` polynomial"* — and then tests whether you can (a) keep arithmetic correct and overflow-free mod a prime, (b) divide and take remainders over a field, (c) interpolate (Lagrange/Newton), (d) run the Euclidean GCD on polynomials, and (e) recognize when degrees are large enough to need NTT (`15-ntt`) instead of schoolbook. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|------------|
| Add / subtract / scale | element-wise mod `p` | `O(n)` |
| Multiply | schoolbook convolution | `O(n²)` |
| Multiply (large degree) | NTT (`15-ntt`) | `O(n log n)` |
| Evaluate at a point | Horner | `O(n)` |
| Evaluate at `n` points | multipoint (subproduct tree) | `O(n log² n)` |
| Divide / remainder | long division (needs prime) | `O(n²)` (`O(n log n)` fast) |
| Interpolate `n+1` points | Lagrange / Newton | `O(n²)` (`O(n log² n)` fast) |
| GCD of two polynomials | Euclidean algorithm | `O(n²)` (`O(n log² n)` Half-GCD) |
| Series inverse/log/exp/sqrt mod `x^n` | Newton iteration | `O(n log n)` |

Core convolution (multiply):

```text
mul(P, Q):
    r = zeros(len(P)+len(Q)-1)
    for i in 0..len(P)-1:
        for j in 0..len(Q)-1:
            r[i+j] = (r[i+j] + P[i]*Q[j]) mod p
    return r
```

Core Horner (evaluate):

```text
eval(P, x0):
    acc = 0
    for i from high to 0:  acc = (acc*x0 + P[i]) mod p
    return acc
```

Key facts:
- **Multiplication = convolution.** `(P·Q)[k] = Σ_{i+j=k} P[i]·Q[j]`; product length `len(P)+len(Q)−1`.
- **Division/GCD/interpolation need a *prime* modulus** so inverses exist.
- **`n+1` distinct points → unique degree-`≤ n` polynomial** (Vandermonde nonsingular).
- **Newton interpolation is incremental** (`O(n)` per new point); Lagrange is best for a single-point value.

---

## Junior Questions (12 Q&A)

### J1. How do you represent a polynomial in code?
As a coefficient array: index `i` holds the coefficient of `x^i`. `[3, 5, 2]` means `3 + 5x + 2x²`. The `x`'s are implicit in the positions.

### J2. What is the degree, and what is the product's degree?
The degree is the largest `i` with a nonzero coefficient. Over a field, `deg(P·Q) = deg P + deg Q`, so the product array has length `len(P) + len(Q) − 1`.

### J3. How do you add two polynomials?
Element-wise: pad the shorter to the longer length, then `(P+Q)[i] = (P[i] + Q[i]) mod p`. It is `O(n)`.

### J4. How does schoolbook multiplication work?
It is a convolution: `(P·Q)[k] = Σ_{i+j=k} P[i]·Q[j]`. A double loop spreads each term of `P` over all terms of `Q`, accumulating into slot `i+j`. Cost `O(n·m)`.

### J5. Why do we work modulo a prime?
Coefficients (especially products) grow and overflow; reducing mod `p` keeps them in `[0, p)` and exact (no floating-point error). A prime is needed when later operations divide by a coefficient, since only then does every nonzero element have an inverse.

### J6. What is Horner's rule and why use it?
It evaluates `P(x0)` as nested multiplication: `acc = acc·x0 + P[i]` walking coefficients high→low. That is `n` multiplies and `n` adds — `O(n)`, optimal, and avoids recomputing powers of `x0`.

### J7. What is the length of `P·Q` for degrees 4 and 3?
Degrees `4` and `3` → product degree `7` → array length `8` (`4+1` + `3+1` − 1).

### J8. How do you avoid overflow in the product mod p?
Use 64-bit products and reduce after every accumulation: `r[i+j] = (r[i+j] + P[i]*Q[j]) % p`. In Go/Java cast to `long`/`int64` before multiplying.

### J9. What does the constant term `P[0]` equal?
`P(0)` — evaluating the polynomial at `x = 0` leaves only the constant term.

### J10. How do you handle subtraction mod p going negative?
Normalize: `((a − b) % p + p) % p` in Go/Java. Python's `%` already returns a non-negative result.

### J11. Why strip trailing zeros?
`[3, 0, 0]` is degree 0, not degree 2. Stripping (normalizing) keeps the degree honest so division and interpolation index correctly.

### J12 (analysis). What is the time complexity of schoolbook multiply, and what speeds it up?
`O(n²)`. Karatsuba (`15-divide-and-conquer/04-karatsuba`) gives `O(n^1.585)`; FFT/NTT (`15-divide-and-conquer/05-fft`, `15-ntt`) give `O(n log n)`. All compute the same convolution faster.

---

## Middle Questions (12 Q&A)

### M1. State the polynomial division algorithm.
For `A, B` with `B ≠ 0` there are unique `Q, R` with `A = B·Q + R` and `deg R < deg B`. Each long-division step multiplies by the inverse of `B`'s leading coefficient and subtracts a scaled shift of `B`, cancelling one leading term of the running remainder.

### M2. Why must the modulus be prime for division?
The division step divides by `lc(B)`. Over `F_p` with prime `p`, every nonzero element has a modular inverse, so this is always possible. Over a composite modulus some leading coefficients are non-invertible and division fails.

### M3. How does the factor theorem connect evaluation and division?
`(x − α) | P` iff `P(α) = 0`. Dividing `P` by `(x − α)` leaves remainder `P(α)` — that one-step division is exactly Horner's rule.

### M4. State the interpolation uniqueness fact.
Given `n+1` points with distinct `x_i`, there is a unique polynomial of degree `≤ n` through them. Two such polynomials would differ by a degree-`≤ n` polynomial with `n+1` roots, which must be zero.

### M5. Lagrange vs Newton interpolation — when to use each?
Lagrange is explicit (`P = Σ y_i L_i`) and great for evaluating at one point without building coefficients. Newton (divided differences) is incremental: adding a new point is `O(n)`, no rebuild — better for streaming data. Both give the same polynomial.

### M6. How do you compute polynomial GCD?
Euclidean algorithm with polynomial remainders: `while B ≠ 0: (A, B) = (B, A mod B)`, then make the result monic. It terminates because the remainder degree strictly decreases each step.

### M7. What is the formal derivative and one use?
`P'[i−1] = i·P[i] mod p` — the power rule applied coefficient-wise, `O(n)`. Used in square-free testing: `gcd(P, P') ≠ 1` signals a repeated root.

### M8. Where does NTT plug into all of this?
Anywhere you multiply. Swapping the `O(n²)` schoolbook multiply for the `O(n log n)` NTT (`15-ntt`) upgrades division, interpolation, and GCD (which call multiply internally) to near-linear or `O(n log² n)`.

### M9. What is a divided difference?
A coefficient in the Newton form: `f[x_i] = y_i`, and `f[x_i,…,x_{i+k}] = (f[x_{i+1},…] − f[x_i,…]) / (x_{i+k} − x_i)`. The Newton interpolant is `Σ_k f[x_0,…,x_k]·Π_{j<k}(x − x_j)`.

### M10. How do you make a GCD result canonical?
Divide by its leading coefficient to make it **monic**. GCDs are unique only up to a nonzero scalar, so monic normalization gives a comparable canonical form.

### M11. What can go wrong with interpolation nodes?
Duplicate `x_i` cause division by `x_i − x_j = 0`. Always require distinct nodes and assert it before interpolating.

### M12 (analysis). Why does polynomial Euclid terminate?
Each step replaces `(A, B)` with `(B, A mod B)`, and `deg(A mod B) < deg B` strictly. The second argument's degree strictly decreases, reaching the zero polynomial in at most `deg B + 1` steps.

---

## Senior Questions (10 Q&A)

### S1. When do you switch from schoolbook to NTT, and which prime?
When degrees exceed a few thousand (where `O(n²)` becomes the bottleneck). Use an NTT-friendly prime `p = c·2^k + 1`, canonically `998244353 = 119·2^23 + 1`, which supports transforms up to length `2^23`.

### S2. Exact NTT vs numeric FFT — how do you decide?
If the problem specifies "mod `p`", use NTT — exact, no rounding. For an exact integer product whose coefficients exceed one prime, run NTT under several primes and CRT-recombine. Numeric `double` FFT is acceptable only with no modulus and a provable precision budget (values `< 2^53` so rounding recovers the exact integer).

### S3. How do you do fast polynomial division?
Reverse both polynomials, compute the series inverse of `rev(B)` modulo `x^{n−m+1}` (Newton), multiply by `rev(A)`, take the low coefficients, reverse to get `Q`, then `R = A − B·Q`. Total `O(n log n)`.

### S4. Explain Newton iteration for the series inverse.
To get `g` with `B·g ≡ 1 (mod x^n)`, start `g = B[0]^{-1}` and double precision: `g ← g·(2 − B·g) (mod x^{2t})`. Each step squares the error (which is divisible by `x^t`), so it becomes divisible by `x^{2t}` — quadratic convergence in `log₂ n` steps, `O(n log n)` total.

### S5. What are the constant-term preconditions for series inverse/log/exp/sqrt?
Inverse needs `A(0) ≠ 0`; `log` needs `A(0) = 1`; `exp` needs `A(0) = 0`; `sqrt` needs `A(0)` to be a quadratic residue mod `p`. Violating these gives garbage or a crash.

### S6. How do you evaluate a polynomial at many points fast?
Build a subproduct tree (leaves `(x − x_i)`, internal nodes products), then push `P mod (subtree)` down the tree; each leaf yields `P(x_i)`. `O(n log² n)`. Naive Horner-per-point is `O(n²)`.

### S7. How do you verify an NTT-multiply implementation?
Diff it against a schoolbook `O(n²)` oracle on random small inputs. The common bug signatures: all coefficients scaled by `n` (forgot inverse-transform scaling), garbage (non-power-of-two length or wrong root of unity), off-by-one degree (wrong padding).

### S8. Why does the formal integral require `p > n`?
The integral divides coefficient `i` by `i+1`. If `p ≤ degree+1`, some `i+1 ≡ 0 (mod p)` has no inverse. Ensuring `p` exceeds all degrees/indices keeps every divisor invertible — the same reason interpolation needs distinct, invertible node differences.

### S9. How does CRT extend exact products beyond one prime?
Run the same NTT multiplication under several coprime NTT-friendly primes, then reconstruct each coefficient via CRT (`06-crt` / Garner `17-garner-algorithm`). The number of primes is about `ceil(log2(max coefficient)/30)`. The runs are independent and parallelizable.

### S10 (analysis). Why does Newton's doubling give `O(M(n))` not `O(n·M(n))`?
Because the cost telescopes: step at precision `t` costs `O(M(t))`, and `Σ M(2^i)` for `i = 0..log n` is `O(M(n))` since `M(2t) ≥ 2M(t)` (super-additive). The final full-length step dominates. Incrementing precision by 1 each step would be `O(n·M(n))` — the doubling is essential.

---

## Professional Questions (8 Q&A)

### P1. Design a service computing convolutions of large coefficient vectors mod p at scale.
Use NTT as the multiply primitive (`998244353`). Preallocate power-of-two scratch buffers; run the NTT in place. For products exceeding one prime, shard across CRT primes (independent jobs). Cache the forward transform of any operand reused across many products. Validate every release against a schoolbook oracle on small inputs.

### P2. The product coefficients exceed `10^9+7`. How do you get the exact value?
Multiply under several NTT-friendly primes and CRT-recombine coefficient-by-coefficient. Estimate the max coefficient magnitude (`≤ n · maxA · maxB`) to choose the number of primes. Stream the CRT reconstruction to avoid materializing all big integers at once.

### P3. You must interpolate millions of points. What do you use?
Not `O(n²)` Lagrange/Newton — use the fast `O(n log² n)` interpolation: build a subproduct tree of `(x − x_i)`, multipoint-evaluate the derivative of the master polynomial for the Lagrange denominators, then combine bottom-up. The multiply primitive is NTT.

### P4. How do you debug "the polynomial product is wrong" in production?
Run the schoolbook oracle on the exact small inputs and diff coefficient-by-coefficient. Check the usual suspects: missing inverse-transform scaling (all coefficients off by a factor of `n`), non-power-of-two NTT length, wrong (non-NTT-friendly) prime, off-by-one product length, forgotten reduction. Add a `deg(P·Q) == deg P + deg Q` assertion.

### P5. When is interpolation the wrong tool?
When nodes are not distinct (division by zero), when the prime is too small (`p ≤ n`, node differences non-invertible), or when you actually need a *different-degree* fit (least squares / regression) rather than exact interpolation. Exact interpolation forces degree `≤ n`; if the data is noisy you want a lower-degree approximation instead.

### P6. How do you parallelize a batch of polynomial multiplications?
Each product is independent — distribute across workers. For a single huge product, the forward NTTs of the two operands are independent of each other, and the CRT-prime variants are fully independent jobs. The inverse transform is the only serial join point.

### P7. How do polynomials connect to generating functions and combinatorics?
Coefficients of a product polynomial are convolutions of the factors' coefficients — exactly how generating functions count combined structures. Series `exp`/`log` handle labeled (exponential generating function) structures; `1/(1−x)` style inverses sum geometric families. NTT makes these `O(n log n)`, turning combinatorial counting into fast convolution.

### P8 (analysis). Why is every fast polynomial operation `O(M(n))` or `O(M(n) log n)`?
Multiplication cost `M(n)` is the primitive. Newton iteration makes inverse/division/log/exp/sqrt `O(M(n))` (geometric-series collapse). Subproduct-tree algorithms (multipoint eval, interpolation, Half-GCD) add one `log n` factor from the recursion depth times a per-level multiply. So improving `M(n)` (e.g. schoolbook → NTT) improves the entire tower at once.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n²)` algorithm with an `O(n log n)` one.
Look for a concrete story: a convolution or interpolation that was the profiled bottleneck, the recognition that it was "really" a polynomial multiply, the switch to NTT, the correctness check against the old schoolbook version, and the measured speedup. Strong answers mention the prime choice and the oracle test, not just the asymptotic win.

### B2. A teammate used a composite modulus and division silently broke. How do you handle it?
Explain calmly that division/GCD/interpolation need modular inverses, which exist for *every* nonzero element only when the modulus is prime. Show a tiny failure (e.g. `2` has no inverse mod `6`). Switch to a prime (`998244353` if NTT may follow). Frame it as a teaching moment about why `F_p` must be a field.

### B3. Design a secret-sharing or error-correcting feature using polynomials.
Both rest on interpolation: Shamir's secret sharing hides a secret as `P(0)` and distributes points `(i, P(i))`; any `t` of them reconstruct `P` (degree `< t`) by interpolation, fewer reveal nothing. Reed-Solomon encodes data as a polynomial's values at many points; the `n+1`-points-determine-degree-`n` fact gives error correction. Discuss the prime/field choice and evaluation-point selection.

### B4. How would you explain polynomial multiplication to a junior engineer?
Use the "long multiplication without carries" analogy: each coefficient of one times each of the other, summed into place columns by `i+j`. Then `(P·Q)[k] = Σ_{i+j=k} P[i]·Q[j]`. Lead with the two gotchas: reduce mod `p` to avoid overflow, and the product array is `len(P)+len(Q)−1` long. Mention FFT/NTT as "the fast way to do this same sum."

### B5. Your polynomial service is using too much memory at scale. How do you investigate?
Each length-`2^k` `int64` buffer is `8·2^k` bytes (64 MB at `2^23`). Check whether you over-pad the NTT length (round *up* to the next power of two, not higher), whether scratch buffers are reused or reallocated per call (GC churn), and whether you truncate series to `x^n` rather than carrying full length. Profile allocations; the fix is buffer reuse plus aggressive truncation.

---

## Coding Challenges

### Challenge 1: Multiply Two Polynomials mod p

**Problem.** Given two coefficient arrays `A` and `B` over `F_p` (`p = 998244353`), return their product `A·B` mod `p`.

**Example.**
```text
A = [3, 5, 2], B = [4, 1]  ->  [12, 23, 13, 2]
```

**Constraints.** `1 ≤ len(A), len(B) ≤ 2000` (schoolbook fine; for larger, use NTT).

**Optimal here.** Schoolbook convolution, `O(n·m)`.

**Go.**
```go
package main

import "fmt"

const MOD = 998244353

func mul(a, b []int64) []int64 {
	if len(a) == 0 || len(b) == 0 {
		return []int64{}
	}
	r := make([]int64, len(a)+len(b)-1)
	for i := 0; i < len(a); i++ {
		if a[i] == 0 {
			continue
		}
		for j := 0; j < len(b); j++ {
			r[i+j] = (r[i+j] + a[i]*b[j]) % MOD
		}
	}
	return r
}

func main() {
	fmt.Println(mul([]int64{3, 5, 2}, []int64{4, 1})) // [12 23 13 2]
}
```

**Java.**
```java
import java.util.*;

public class PolyMul {
    static final long MOD = 998244353L;

    static long[] mul(long[] a, long[] b) {
        if (a.length == 0 || b.length == 0) return new long[0];
        long[] r = new long[a.length + b.length - 1];
        for (int i = 0; i < a.length; i++) {
            if (a[i] == 0) continue;
            for (int j = 0; j < b.length; j++)
                r[i + j] = (r[i + j] + a[i] * b[j]) % MOD;
        }
        return r;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(mul(new long[]{3, 5, 2}, new long[]{4, 1})));
    }
}
```

**Python.**
```python
MOD = 998244353


def mul(a, b):
    if not a or not b:
        return []
    r = [0] * (len(a) + len(b) - 1)
    for i, ai in enumerate(a):
        if ai:
            for j, bj in enumerate(b):
                r[i + j] = (r[i + j] + ai * bj) % MOD
    return r


if __name__ == "__main__":
    print(mul([3, 5, 2], [4, 1]))  # [12, 23, 13, 2]
```

---

### Challenge 2: Polynomial Division with Remainder

**Problem.** Given `A` and `B` (`B ≠ 0`) over `F_p`, return `(Q, R)` with `A = B·Q + R` and `deg R < deg B`.

**Example.**
```text
A = 1 + x^3 = [1,0,0,1], B = 1 + x = [1,1]  ->  Q = [1, p-1, 1] (1 - x + x^2), R = [0]
```

**Constraints.** `1 ≤ len(A), len(B) ≤ 2000`. `p` prime so `lc(B)` is invertible.

**Optimal here.** Long division, `O(n·m)`.

**Go.**
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

func trim(p []int64) []int64 {
	for len(p) > 1 && p[len(p)-1] == 0 {
		p = p[:len(p)-1]
	}
	return p
}

func divmod(a, b []int64) (q, r []int64) {
	a = trim(append([]int64{}, a...))
	b = trim(b)
	if len(a) < len(b) {
		return []int64{0}, a
	}
	r = append([]int64{}, a...)
	q = make([]int64, len(a)-len(b)+1)
	inv := modinv(b[len(b)-1])
	for k := len(a) - len(b); k >= 0; k-- {
		c := r[k+len(b)-1] * inv % MOD
		q[k] = c
		for j := 0; j < len(b); j++ {
			r[k+j] = (r[k+j] - c*b[j]%MOD + MOD) % MOD
		}
	}
	return trim(q), trim(r[:len(b)-1])
}

func main() {
	q, r := divmod([]int64{1, 0, 0, 1}, []int64{1, 1})
	fmt.Println("Q =", q, "R =", r)
}
```

**Java.**
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
        long inv = modinv(b[b.length - 1]);
        for (int k = a.length - b.length; k >= 0; k--) {
            long c = r[k + b.length - 1] * inv % MOD;
            q[k] = c;
            for (int j = 0; j < b.length; j++)
                r[k + j] = (r[k + j] - c * b[j] % MOD + MOD) % MOD;
        }
        return new long[][]{trim(q), trim(Arrays.copyOf(r, b.length - 1))};
    }

    public static void main(String[] args) {
        long[][] qr = divmod(new long[]{1, 0, 0, 1}, new long[]{1, 1});
        System.out.println("Q = " + Arrays.toString(qr[0]) + " R = " + Arrays.toString(qr[1]));
    }
}
```

**Python.**
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
        c = r[k + len(b) - 1] * inv % MOD
        q[k] = c
        for j in range(len(b)):
            r[k + j] = (r[k + j] - c * b[j]) % MOD
    return trim(q), trim(r[:len(b) - 1] or [0])


if __name__ == "__main__":
    print(divmod_poly([1, 0, 0, 1], [1, 1]))  # ([1, MOD-1, 1], [0])
```

---

### Challenge 3: Lagrange Interpolation

**Problem.** Given `n+1` points with distinct `x_i` and target `x*`, return `P(x*)` mod `p`, where `P` is the unique interpolating polynomial of degree `≤ n`.

**Example.**
```text
points on x^2+1: (0,1),(1,2),(2,5); target 3  ->  10
```

**Constraints.** `1 ≤ n+1 ≤ 2000`; distinct `x_i`.

**Optimal here.** Direct Lagrange evaluation at a point, `O(n²)`.

**Go.**
```go
package main

import "fmt"

const MOD = 998244353

func power(a, e int64) int64 {
	a = ((a % MOD) + MOD) % MOD
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

func lagrangeEval(xs, ys []int64, target int64) int64 {
	n := len(xs)
	var result int64 = 0
	for i := 0; i < n; i++ {
		num := ((ys[i] % MOD) + MOD) % MOD
		var den int64 = 1
		for j := 0; j < n; j++ {
			if j != i {
				num = num * (((target-xs[j])%MOD + MOD) % MOD) % MOD
				den = den * (((xs[i]-xs[j])%MOD + MOD) % MOD) % MOD
			}
		}
		result = (result + num*modinv(den)) % MOD
	}
	return result
}

func main() {
	fmt.Println(lagrangeEval([]int64{0, 1, 2}, []int64{1, 2, 5}, 3)) // 10
}
```

**Java.**
```java
public class Lagrange {
    static final long MOD = 998244353L;

    static long power(long a, long e) {
        a = ((a % MOD) + MOD) % MOD; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        return r;
    }
    static long modinv(long a) { return power(a, MOD - 2); }

    static long lagrangeEval(long[] xs, long[] ys, long target) {
        int n = xs.length;
        long result = 0;
        for (int i = 0; i < n; i++) {
            long num = ((ys[i] % MOD) + MOD) % MOD, den = 1;
            for (int j = 0; j < n; j++) {
                if (j != i) {
                    num = num * (((target - xs[j]) % MOD + MOD) % MOD) % MOD;
                    den = den * (((xs[i] - xs[j]) % MOD + MOD) % MOD) % MOD;
                }
            }
            result = (result + num * modinv(den)) % MOD;
        }
        return result;
    }

    public static void main(String[] args) {
        System.out.println(lagrangeEval(new long[]{0, 1, 2}, new long[]{1, 2, 5}, 3)); // 10
    }
}
```

**Python.**
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
    print(lagrange_eval([0, 1, 2], [1, 2, 5], 3))  # 10
```

---

### Challenge 4: Polynomial GCD

**Problem.** Given `A` and `B` over `F_p`, return their monic GCD via the Euclidean algorithm.

**Example.**
```text
A = (x-1)(x-2) = x^2-3x+2, B = (x-1)(x-3) = x^2-4x+3  ->  monic x - 1 = [p-1, 1]
```

**Constraints.** `1 ≤ len(A), len(B) ≤ 2000`.

**Optimal here.** Euclidean GCD with polynomial remainder, `O(n²)`.

**Python.**
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
        c = r[k + len(b) - 1] * inv % MOD
        q[k] = c
        for j in range(len(b)):
            r[k + j] = (r[k + j] - c * b[j]) % MOD
    return trim(q), trim(r[:len(b) - 1] or [0])


def monic(p):
    inv = modinv(p[-1])
    return [c * inv % MOD for c in p]


def poly_gcd(a, b):
    a, b = trim(a[:]), trim(b[:])
    while not (len(b) == 1 and b[0] == 0):
        _, r = divmod_poly(a, b)
        a, b = b, r
    return monic(a) if a[-1] != 0 else a


if __name__ == "__main__":
    A = [2, MOD - 3, 1]   # x^2 - 3x + 2
    B = [3, MOD - 4, 1]   # x^2 - 4x + 3
    print(poly_gcd(A, B))  # [MOD-1, 1]  ->  x - 1
```

**Go.**
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

func trim(p []int64) []int64 {
	for len(p) > 1 && p[len(p)-1] == 0 {
		p = p[:len(p)-1]
	}
	return p
}

func divmod(a, b []int64) []int64 {
	a = trim(append([]int64{}, a...))
	b = trim(b)
	if len(a) < len(b) {
		return a
	}
	r := append([]int64{}, a...)
	inv := modinv(b[len(b)-1])
	for k := len(a) - len(b); k >= 0; k-- {
		c := r[k+len(b)-1] * inv % MOD
		for j := 0; j < len(b); j++ {
			r[k+j] = (r[k+j] - c*b[j]%MOD + MOD) % MOD
		}
	}
	return trim(r[:len(b)-1])
}

func monic(p []int64) []int64 {
	inv := modinv(p[len(p)-1])
	out := make([]int64, len(p))
	for i, c := range p {
		out[i] = c * inv % MOD
	}
	return out
}

func gcd(a, b []int64) []int64 {
	a, b = trim(a), trim(b)
	for !(len(b) == 1 && b[0] == 0) {
		a, b = b, divmod(a, b)
	}
	if a[len(a)-1] != 0 {
		return monic(a)
	}
	return a
}

func main() {
	A := []int64{2, MOD - 3, 1}
	B := []int64{3, MOD - 4, 1}
	fmt.Println(gcd(A, B)) // [MOD-1 1] -> x - 1
}
```

**Java.**
```java
import java.util.*;

public class PolyGcd {
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

    static long[] rem(long[] a, long[] b) {
        a = trim(a); b = trim(b);
        if (a.length < b.length) return a;
        long[] r = a.clone();
        long inv = modinv(b[b.length - 1]);
        for (int k = a.length - b.length; k >= 0; k--) {
            long c = r[k + b.length - 1] * inv % MOD;
            for (int j = 0; j < b.length; j++)
                r[k + j] = (r[k + j] - c * b[j] % MOD + MOD) % MOD;
        }
        return trim(Arrays.copyOf(r, b.length - 1));
    }

    static long[] monic(long[] p) {
        long inv = modinv(p[p.length - 1]);
        long[] out = new long[p.length];
        for (int i = 0; i < p.length; i++) out[i] = p[i] * inv % MOD;
        return out;
    }

    static long[] gcd(long[] a, long[] b) {
        a = trim(a); b = trim(b);
        while (!(b.length == 1 && b[0] == 0)) {
            long[] r = rem(a, b);
            a = b; b = r;
        }
        return (a[a.length - 1] != 0) ? monic(a) : a;
    }

    public static void main(String[] args) {
        long[] A = {2, MOD - 3, 1};
        long[] B = {3, MOD - 4, 1};
        System.out.println(Arrays.toString(gcd(A, B))); // [MOD-1, 1]
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Multiplying polynomials is convolving coefficient arrays; `(P·Q)[k] = Σ_{i+j=k} P[i]·Q[j]`."*
- Immediately flag the gotchas: **reduce mod a prime** (overflow + inverses) and the product length is **`len(P)+len(Q)−1`**.
- For division, GCD, and interpolation, stress that the modulus must be **prime** so inverses exist.
- State the interpolation fact crisply: *"`n+1` distinct points → unique degree-`≤ n` polynomial."*
- When degrees get large, name **NTT** (`15-ntt`) as the `O(n log n)` multiply, and mention **Newton iteration** for series inverse/log/exp/sqrt.
- Always offer to verify fast methods against a schoolbook oracle on small inputs.
