# Fast Fourier Transform (FFT) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the FFT/NTT logic and validate against the evaluation criteria.
> **Always test against a brute-force schoolbook `O(n²)` convolution oracle on small inputs before trusting the FFT result.**

---

## Beginner Tasks (5)

### Task 1 — Recursive FFT

**Problem.** Implement the recursive radix-2 Cooley-Tukey FFT `fft(a, invert)` that transforms a complex array in place. `len(a)` is a power of two. For `invert=true`, use conjugate roots and divide the final result by `n`.

**Input / Output spec.**
- Read `n` (a power of two), then `n` real numbers as the coefficients (imaginary parts 0).
- Print the forward DFT values, real and imaginary parts to 3 decimals.

**Constraints.**
- `1 ≤ n ≤ 1024`, `n` a power of two.
- Use the principal root `ω_n = e^{2πi/n}`.

**Hint.** Split `a[0::2]` (even) and `a[1::2]` (odd), recurse, then combine with the butterfly `a[k] = E[k] + ω^k·O[k]`, `a[k+n/2] = E[k] − ω^k·O[k]`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
	"math/cmplx"
)

func fft(a []complex128, invert bool) {
	// TODO: base case n==1; split even/odd; recurse; butterfly combine
}

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]complex128, n)
	for i := 0; i < n; i++ {
		var x float64
		fmt.Scan(&x)
		a[i] = complex(x, 0)
	}
	fft(a, false)
	for _, v := range a {
		fmt.Printf("%.3f %.3f\n", real(v), imag(v))
	}
	_ = math.Pi
	_ = cmplx.Exp
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static void fft(double[] re, double[] im, boolean invert) {
        // TODO: recursive radix-2 FFT
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        double[] re = new double[n], im = new double[n];
        for (int i = 0; i < n; i++) re[i] = sc.nextDouble();
        fft(re, im, false);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++)
            sb.append(String.format("%.3f %.3f%n", re[i], im[i]));
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import cmath

def fft(a, invert=False):
    # TODO: recursive radix-2 FFT
    pass

if __name__ == "__main__":
    n = int(input())
    a = [complex(float(x), 0) for x in input().split()]
    fft(a)
    for v in a:
        print(f"{v.real:.3f} {v.imag:.3f}")
```

**Evaluation.** `IFFT(FFT(a))` must return `a` within `1e-6`. Compare the forward transform against a direct `O(n²)` DFT.

---

### Task 2 — Direct DFT oracle (`O(n²)`)

**Problem.** Implement the naive `O(n²)` DFT `â_k = Σ_j a_j e^{2πijk/n}`. This is your correctness oracle for Task 1.

**I/O spec.** Same as Task 1, but compute directly with a double loop.

**Constraints.** `1 ≤ n ≤ 256`.

**Hint.** Two nested loops over `k` and `j`; accumulate `a_j · cmath.exp(2πi·j·k/n)`.

**Starter — Python.**
```python
import cmath

def dft(a):
    n = len(a)
    out = [0j] * n
    for k in range(n):
        # TODO: out[k] = sum_j a[j] * exp(2*pi*i*j*k/n)
        pass
    return out
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
	"math/cmplx"
)

func dft(a []complex128) []complex128 {
	n := len(a)
	out := make([]complex128, n)
	for k := 0; k < n; k++ {
		// TODO: out[k] = Σ_j a[j] * exp(2πi·j·k/n)
		_ = math.Pi
		_ = cmplx.Exp
	}
	return out
}

func main() { _ = dft }
```

**Starter — Java.**
```java
public class Task2 {
    static double[][] dft(double[] re, double[] im) {
        int n = re.length;
        double[] outRe = new double[n], outIm = new double[n];
        for (int k = 0; k < n; k++) {
            // TODO: outRe[k]/outIm[k] = Σ_j (re[j]+i·im[j]) * (cos+ i·sin)(2π·j·k/n)
        }
        return new double[][]{outRe, outIm};
    }
    public static void main(String[] args) { }
}
```

**Evaluation.** `dft(a)` must equal `fft(a)` from Task 1 within `1e-6` for random inputs.

---

### Task 3 — Pad to power of two

**Problem.** Implement `next_pow2(x)` returning the smallest power of two `≥ x`, and a helper that zero-pads two coefficient arrays so the FFT product has no wrap-around (`n = next_pow2(len(a)+len(b)−1)`).

**I/O spec.** Read `len(a)` and `len(b)`; print `n`.

**Constraints.** `1 ≤ len ≤ 10⁶`.

**Hint.** Loop `n = 1; while n < x: n <<= 1`.

**Starter — Go.**
```go
package main

import "fmt"

func nextPow2(x int) int {
	// TODO
	return 0
}

func main() {
	var la, lb int
	fmt.Scan(&la, &lb)
	fmt.Println(nextPow2(la + lb - 1))
}
```

**Evaluation.** `nextPow2(1)=1`, `nextPow2(5)=8`, `nextPow2(1024)=1024`, `nextPow2(1025)=2048`.

---

### Task 4 — Schoolbook convolution oracle

**Problem.** Implement `multiply_schoolbook(a, b)` in `O(n²)` that returns the coefficients of `A(x)·B(x)`. You will diff every FFT result against this.

**I/O spec.** Read `len(a)`, then `a`; read `len(b)`, then `b`. Print the product coefficients.

**Constraints.** `1 ≤ len ≤ 1000`; entries fit in 64-bit after summation.

**Hint.** `res[i+j] += a[i]*b[j]`.

**Starter — Java.**
```java
public class Task4 {
    static long[] multiplySchoolbook(int[] a, int[] b) {
        // TODO: res[i+j] += a[i]*b[j]
        return null;
    }
    public static void main(String[] args) {
        // read input, call, print
    }
}
```

**Evaluation.** `[1,2,3]·[4,5,6] = [4,13,28,27,18]`.

---

### Task 5 — FFT polynomial multiply

**Problem.** Combine Tasks 1 and 3 into `multiply(a, b)` returning the integer product coefficients via FFT (round at the end).

**I/O spec.** Read both arrays; print product coefficients (length `len(a)+len(b)−1`).

**Constraints.** `1 ≤ len ≤ 10⁵`, coefficients `|a_i| ≤ 1000`.

**Hint.** Forward-FFT both, multiply pointwise, inverse-FFT, `round(real(·))`.

**Starter — Python.**
```python
def multiply(a, b):
    # TODO: pad, fft both, pointwise multiply, inverse fft, round
    pass
```

**Evaluation.** Must match `multiply_schoolbook` on 1000 random small inputs.

---

## Intermediate Tasks (5)

### Task 6 — Iterative in-place FFT with bit-reversal

**Problem.** Replace the recursive FFT with the iterative in-place version: a bit-reversal permutation followed by `log n` butterfly passes. Same signature `fft(a, invert)`.

**I/O spec.** Same as Task 1.

**Constraints.** `1 ≤ n ≤ 2²⁰`.

**Hint.** Bit-reversal loop:
```
for i in 1..n-1:
    bit = n>>1
    while j & bit: j ^= bit; bit >>= 1
    j ^= bit
    if i < j: swap(a[i], a[j])
```
Then `for len = 2..n (×2)`: butterflies of block size `len` using `ω_len`.

**Starter — Go.**
```go
func fft(a []complex128, invert bool) {
	n := len(a)
	// TODO 1: bit-reversal permutation
	// TODO 2: for length := 2; length <= n; length <<= 1 { butterflies }
	// TODO 3: if invert, divide each entry by n
	_ = n
}
```

**Evaluation.** Identical results to Task 1 (within `1e-6`) but no recursion; should run on `n=2²⁰` quickly.

---

### Task 7 — Big-integer multiplication

**Problem.** Multiply two non-negative integers given as decimal strings using FFT convolution of digits + carry propagation. Return the product as a string with no leading zeros.

**I/O spec.** Read two strings `x`, `y`; print `x·y`.

**Constraints.** `1 ≤ |x|, |y| ≤ 10⁶` digits.

**Hint.** Little-endian digits as coefficients; after convolution do `c[i+1] += c[i]/10; c[i] %= 10`. Use base `10⁴` to reduce `n` and improve precision.

**Starter — Java.**
```java
public class Task7 {
    static String mulBig(String x, String y) {
        // TODO: digits -> multiply (FFT) -> carry -> string
        return null;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(mulBig(sc.next(), sc.next()));
    }
}
```

**Evaluation.** `"123456789" · "987654321" = "121932631112635269"`. Cross-check against `BigInteger`/`int`/Python big ints.

---

### Task 8 — NTT exact convolution

**Problem.** Implement the NTT (`p = 998244353`, `g = 3`) and `convolve(a, b)` returning exact coefficients mod `p`.

**I/O spec.** Read both arrays; print product mod `p`.

**Constraints.** `1 ≤ len ≤ 2²⁰`, entries in `[0, p)`.

**Hint.** Replace `ω_len = e^{2πi/len}` with `pow(g, (p−1)/len, p)`; inverse root `pow(ω_len, p−2, p)`; final scale `pow(n, p−2, p)`. Guard subtraction: `(u − v + p) % p`.

**Starter — Python.**
```python
MOD, G = 998244353, 3

def ntt(a, invert=False):
    # TODO: bit-reversal + butterflies in modular arithmetic
    pass

def convolve(a, b):
    # TODO: pad, ntt both, pointwise mod-multiply, inverse ntt
    pass
```

**Evaluation.** Must match `multiply_schoolbook` reduced mod `p`. Exact — no rounding.

---

### Task 9 — String matching via FFT

**Problem.** Given a text `T` and pattern `P` over a small alphabet (no wildcards first), count exact occurrences of `P` in `T` using FFT. Encode each character `c` as a unit complex number `e^{2πi·c/Σ}` (or use a sum-of-squared-differences correlation), reverse the pattern, and convolve so that a perfect match at shift `s` yields the maximal correlation value.

**I/O spec.** Read `T` and `P`; print all starting indices where `P` matches.

**Constraints.** `1 ≤ |P| ≤ |T| ≤ 10⁵`, alphabet size `≤ 26`.

**Hint.** Match score at shift `s` is `Σ_j (P[j] − T[s+j])²`; expand into `Σ P² − 2 Σ P·T + Σ T²`. The cross term `Σ_j P[j]·T[s+j]` is a correlation = convolution of `T` with reversed `P`. A score of `0` means an exact match.

**Starter — Go.**
```go
func matchFFT(text, pattern string) []int {
	// TODO: build numeric arrays, reverse pattern, FFT-convolve,
	// compute sum-of-squared-difference score per shift, collect zeros
	return nil
}
```

**Evaluation.** Must match a naive `O(N·m)` matcher on random inputs. Bonus: support a wildcard character `?` by zeroing its contribution.

---

### Task 10 — Polynomial squaring (one transform)

**Problem.** Implement `square(a)` that computes `A(x)²` using a single forward FFT (square the values pointwise) and one inverse FFT.

**I/O spec.** Read `a`; print coefficients of `a²`.

**Constraints.** `1 ≤ len ≤ 10⁵`.

**Hint.** `fft(fa); fa[i] *= fa[i]; fft(fa, invert=True)` — only one forward transform needed.

**Starter — Python.**
```python
def square(a):
    # TODO: pad to >= 2*len(a)-1; one forward fft; square values; inverse fft
    pass
```

**Evaluation.** `square([1,1,1]) = [1,2,3,2,1]`. Must match `multiply(a, a)`.

---

## Advanced Tasks (5)

### Task 11 — Multi-prime NTT + CRT for arbitrary modulus

**Problem.** Convolve two integer arrays modulo an arbitrary `M` (e.g. `10⁹+7`, which is NOT NTT-friendly). Run the NTT under three NTT-friendly primes, reconstruct the true coefficient via CRT, then reduce mod `M`.

**I/O spec.** Read `M`, then both arrays; print the convolution mod `M`.

**Constraints.** `1 ≤ len ≤ 2¹⁸`, entries `< M`, coefficients can reach `n·M² ≈ 10²⁴`.

**Hint.** Use primes `998244353`, `985661441`, `1004535809` (all `g=3`). After three NTTs, CRT-combine the three residues into the true integer (which is `< p₁p₂p₃ ≈ 10²⁷`), then `% M`. Watch for overflow — use 128-bit or big-int for the CRT step.

**Starter — Java.**
```java
public class Task11 {
    static final long[] PRIMES = {998244353L, 985661441L, 1004535809L};
    static long[] convolveMod(long[] a, long[] b, long M) {
        // TODO: NTT under each prime, CRT-combine, reduce mod M
        return null;
    }
}
```

**Evaluation.** Match `multiply_schoolbook` reduced mod `M` for large random inputs where single-prime NTT would overflow.

---

### Task 12 — Count pairs / triples with a target sum

**Problem.** Given an array of non-negative integers (`≤ V`), count ordered pairs summing to each `s` (convolve the frequency vector with itself), then extend to ordered triples summing to each `s` (convolve three times).

**I/O spec.** Read the array and `V`; print pair counts and triple counts per sum.

**Constraints.** `1 ≤ n ≤ 10⁵`, `0 ≤ V ≤ 10⁵`.

**Hint.** `f[v]` = frequency of value `v`. Pairs: `f ∗ f`. Triples: `f ∗ f ∗ f`. Watch the growing degree (`3V`); use NTT if counts exceed double's precision.

**Starter — Python.**
```python
def pair_and_triple_sums(vals, V):
    # TODO: build f; return (f*f) and (f*f*f)
    pass
```

**Evaluation.** Cross-check small cases against a brute-force triple loop.

---

### Task 13 — Coefficient-splitting FFT for large coefficients

**Problem.** Implement an FFT convolution that stays exact for large coefficients (up to `~10⁹`) by splitting each coefficient into high/low halves in base `2¹⁵`, doing the necessary sub-convolutions, and recombining. Compute the result mod a given prime.

**I/O spec.** Read both arrays and `MOD`; print convolution mod `MOD`.

**Constraints.** `1 ≤ len ≤ 2¹⁷`, entries `< MOD ≤ ~10⁹`.

**Hint.** Write `a = a_hi·B + a_lo`, `B = 2¹⁵`. Then `a·b = a_hi b_hi B² + (a_hi b_lo + a_lo b_hi) B + a_lo b_lo`. Compute the three (or four) convolutions with complex FFT, each within precision, and recombine mod `MOD`.

**Starter — Go.**
```go
func convolveSplit(a, b []int64, mod int64) []int64 {
	// TODO: split into hi/lo, 3-4 FFT convolutions, recombine mod
	return nil
}
```

**Evaluation.** Match NTT (Task 8/11) results exactly; demonstrate it handles coefficients where plain complex FFT would lose precision.

---

### Task 14 — Online / streaming convolution (overlap-add filter)

**Problem.** Filter a long input stream `x` (length `N`) with a short kernel `h` (length `m`) using the **overlap-add** method: process `x` in blocks, FFT-convolve each block with `h`, and add overlapping tails. Achieve `O(N log m)` instead of `O(N·m)`.

**I/O spec.** Read `h`, then stream `x`; print the filtered output (linear convolution `x ∗ h`).

**Constraints.** `1 ≤ m ≤ 10³`, `1 ≤ N ≤ 10⁷`.

**Hint.** Block length `L`, transform size `≥ L + m − 1` (power of two). Convolve each block with `h`; the last `m−1` samples of each block's output overlap into the next block — add them.

**Starter — Python.**
```python
def overlap_add(x, h, block=1024):
    # TODO: precompute FFT(h) padded; for each block, FFT-convolve, add tails
    pass
```

**Evaluation.** Identical to a direct `multiply(x, h)` (within rounding) but memory-bounded and streaming.

---

### Task 15 — Inverse / division of a power series (Newton's method)

**Problem.** Given a polynomial / power series `A(x)` with `A(0) ≠ 0`, compute its inverse `B(x)` modulo `x^k` such that `A·B ≡ 1 (mod x^k)`, using FFT/NTT and Newton iteration: `B_{2t} = B_t·(2 − A·B_t) mod x^{2t}`, doubling the precision each step.

**I/O spec.** Read `k` and `A`'s first `k` coefficients (mod `p`); print `B`'s first `k` coefficients.

**Constraints.** `1 ≤ k ≤ 2¹⁷`, modulus `998244353`.

**Hint.** Start `B = [A[0]⁻¹]`. Each Newton step doubles the known precision and costs one NTT convolution; total `O(k log k)` because the work geometric-sums. This is the building block for fast polynomial division and `exp`/`log` of series.

**Starter — Python.**
```python
def series_inverse(a, k):
    # TODO: Newton iteration B = B*(2 - A*B) mod x^len, doubling length
    pass
```

**Evaluation.** Verify `convolve(a, b)[:k]` equals `[1, 0, 0, …]` mod `p`.

---

## Testing Guidance (applies to all tasks)

- **Schoolbook oracle.** Diff every FFT/NTT result against the `O(n²)` schoolbook convolution (Task 4) on thousands of random small inputs.
- **Round-trip.** `IFFT(FFT(a)) ≈ a` (within `1e-6` for FFT, exactly for NTT) isolates transform bugs from convolution bugs.
- **Precision telemetry.** For complex FFT, log `max |x − round(x)|`; if it nears `0.5`, you are about to round wrong — split coefficients or use NTT.
- **Known answers.** `[1,1]^∗k` = row `k` of Pascal's triangle; `square([1,1,1]) = [1,2,3,2,1]`.
- **Edge cases.** Empty inputs, length 1, already-power-of-two lengths, negative coefficients, large coefficients near the precision ceiling.
- **Padding.** Always pad to `next_pow2(len(a)+len(b)−1)` to avoid cyclic wrap-around (aliasing).

---

## Suggested Order and Difficulty Progression

| Order | Task | Skill exercised |
|-------|------|-----------------|
| 1 | Task 2, 4 | Build the `O(n²)` oracles first — you need them to test everything else. |
| 2 | Task 1, 3, 5 | Recursive FFT + padding + the multiply pipeline. |
| 3 | Task 6, 10 | Iterative in-place FFT and the one-transform squaring trick. |
| 4 | Task 7, 8 | Big-integer multiply (carry) and the exact NTT. |
| 5 | Task 9 | String matching via correlation — the first non-obvious convolution. |
| 6 | Task 11, 12, 13 | Multi-prime CRT, combinatorial convolution, coefficient splitting. |
| 7 | Task 14, 15 | Streaming overlap-add and Newton-iteration series inverse. |

## Submission Checklist (per task)

- [ ] Solved in **all three** languages (Go, Java, Python).
- [ ] Diffed against the schoolbook oracle on random inputs.
- [ ] Padding to a power of two `≥ len(a)+len(b)−1` confirmed.
- [ ] Inverse scaling (`1/n` or `n⁻¹ mod p`) applied exactly once.
- [ ] For NTT: prime/root pair asserted valid (`n | p−1`).
- [ ] Edge cases (empty, length 1, negatives) handled.
- [ ] Complexity is `O(n log n)` — no accidental `O(n²)` inner loop.
