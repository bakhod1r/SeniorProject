# Big Integer (Arbitrary-Precision) Arithmetic — Interview Preparation

Big-integer arithmetic is a recurring interview theme because it sits at the intersection of *low-level mechanics* (carries, borrows, base choice, overflow) and *algorithmic depth* (Karatsuba's three-product trick, FFT/NTT convolution, division). Interviewers use it to probe whether you understand what `BigInteger`/`big.Int`/Python `int` actually do, whether you can implement add/multiply correctly with limb arrays, whether you know the Karatsuba recurrence cold, and — at senior level — whether you grasp the cryptographic constant-time hazards. This file is a tiered question bank (junior → professional), behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer | Complexity |
|----------|--------|------------|
| Store a big number | little-endian limb array, base `10^9` or `2^32` | — |
| Add / subtract | one carry / borrow pass | `O(n)` |
| Schoolbook multiply | every limb × every limb into pos `i+j` | `O(n²)` |
| Karatsuba multiply | 3 half-size products | `O(n^1.585)` |
| Toom-3 multiply | 5 third-size products | `O(n^1.465)` |
| FFT/NTT multiply | convolution via transform | `O(n log n)` |
| Long division | Knuth Algorithm D, quotient estimate | `O(n·m)` |
| Why a big base? | fewer limbs, fewer iterations | constant-factor |
| Base limit | `limb·limb` must fit native wide type | — |

Karatsuba identity (memorize it):

```text
a = a_H·B^h + a_L,   b = b_H·B^h + b_L
z2 = a_H·b_H
z0 = a_L·b_L
z1 = (a_H+a_L)(b_H+b_L) - z2 - z0      # = a_H·b_L + a_L·b_H  (one mul, not two)
a·b = z2·B^(2h) + z1·B^h + z0
T(n) = 3T(n/2) + O(n) = O(n^log2(3)) = O(n^1.585)
```

Key facts:
- Limbs are **little-endian**; `x = Σ d[i]·B^i`.
- Carry in add is `0/1`; the result can grow by one limb.
- **Normalize** (drop leading-zero limbs) after sub/mul/div.
- Pick the **largest base** with `B·B` fitting a native wide type (`10^9`, `2^32`).
- Floating-point FFT can give a **wrong digit** silently → use **NTT** for exactness.
- For **secret** data (RSA/ECC) the general bignum leaks via timing → use **constant-time** code.

---

## Junior Questions (12 Q&A)

### J1. What is a big integer and why do we need it?
An arbitrary-precision integer stored as an array of limbs instead of a single machine word, so it never overflows. Needed whenever a value can exceed 64 bits: factorials, large Fibonacci, RSA-sized numbers, exact combinatorics.

### J2. What is a "limb"?
One element of the digit array, holding a digit in a large base (e.g. a value in `[0, 10^9)` for base `10^9`). Each limb packs many decimal digits, so the array is short and arithmetic is fast.

### J3. Why store limbs little-endian (least significant at index 0)?
So carries (addition) and borrows (subtraction) flow naturally from low index to high — matching how you sweep columns right-to-left on paper. It also makes appending a final carry trivial.

### J4. How does addition with carry work?
Limb by limb: `s = a[i] + b[i] + carry`; keep `digit = s % B`; pass `carry = s / B` to the next position. Append a final carry limb if non-zero — that's why a sum can be one limb longer.

### J5. How does subtraction with borrow work?
Limb by limb assuming `a ≥ b`: `d = a[i] − b[i] − borrow`; if `d < 0`, add `B` and set `borrow = 1`. Then normalize. If `a < b`, compute `b − a` and flip the sign.

### J6. What is schoolbook multiplication and its complexity?
Multiply every limb of `a` by every limb of `b`, adding `a[i]·b[j]` into result position `i+j`, then propagate carries. It does `n·m` limb multiplications, so `O(n²)` for equal sizes.

### J7. How do you choose the base `B`?
Pick the largest `B` such that `B·B` (a limb-times-limb product) still fits a native wide type. With 64-bit words, `10^9` works (`10^18 < 2^63`) and is decimal-friendly; `2^32` enables mask/shift instead of `%`/`/`.

### J8. What is normalization and why do it?
Stripping leading (most-significant) zero limbs so the array length reliably reflects magnitude. Without it, comparison-by-length breaks and `0` may be stored inconsistently. Always keep at least one limb `[0]`.

### J9. How do you compare two big integers?
Normalize, then compare lengths (more limbs = larger); if equal, compare limbs from the most-significant down to the first difference.

### J10. How do you represent the number zero?
As a single limb `[0]` with sign `0` — never an empty array and never `−0`. Every operation must collapse all-zero results to this canonical form.

### J11. How do you handle negative numbers?
Sign-magnitude: store a sign flag plus an unsigned magnitude. Implement unsigned add/sub/mul first, then route by sign (e.g. `+a + −b` becomes a magnitude subtraction).

### J12 (analysis). Why is a big base better than base 10?
Fewer limbs for the same number means fewer loop iterations and fewer cache lines. Base `10^9` holds nine decimal digits per limb, so add/multiply do ~9× less work than base 10.

---

## Middle Questions (12 Q&A)

### M1. Derive the Karatsuba identity.
Split `a = a_H B^h + a_L`, `b = b_H B^h + b_L`. The product needs `a_H b_H`, `a_L b_L`, and `a_H b_L + a_L b_H`. Note `(a_H+a_L)(b_H+b_L) = a_H b_H + (a_H b_L + a_L b_H) + a_L b_L`, so the middle term `= (a_H+a_L)(b_H+b_L) − a_H b_H − a_L b_L`. Three products instead of four.

### M2. What is Karatsuba's recurrence and solution?
`T(n) = 3T(n/2) + O(n)`. By the Master Theorem (`a=3,b=2`), `T(n) = O(n^{log₂3}) = O(n^1.585)`.

### M3. Why does Karatsuba have a crossover threshold?
Its extra additions, allocations, and recursion overhead make it slower than schoolbook for small `n`. Below a tuned cutoff (~20–80 limbs) libraries fall back to schoolbook.

### M4. What is Toom-Cook and its complexity?
A generalization: Toom-`k` splits into `k` parts and uses `2k−1` products of size `n/k` via evaluate–interpolate. Toom-3 is `O(n^{log₃5}) ≈ O(n^1.465)`. Diminishing returns and costlier interpolation push it above a larger threshold.

### M5. How does long division of big integers work?
Knuth's Algorithm D: normalize so the divisor's top limb is `≥ B/2`, estimate each quotient digit from the top two limbs, correct down by at most 2, multiply-subtract, add-back if it went negative. Cost `O(n·m)`.

### M6. How do you convert a bignum to a decimal string?
Repeatedly divide by `10^9` (or `10`) by a single limb, collecting remainders as decimal chunks — zero-padding all but the top chunk. Naive is `O(n²)`; divide-and-conquer makes it `O(M(n) log n)`.

### M7. How do you compute `a mod m` fast when reused often?
Avoid full division: precompute with **Barrett reduction** (one precomputed reciprocal, two multiplies per reduction) or use **Montgomery reduction** (shifts/adds, no division) — the basis of fast modular exponentiation.

### M8. Why is squaring cheaper than general multiply?
The cross terms `a_i a_j` and `a_j a_i` are equal, so you compute the off-diagonal products once and double them — about half the limb multiplications of a general multiply.

### M9. When should you NOT use a big integer?
When the value provably fits `int64`, or when you only need the answer modulo a small number — then modular arithmetic in machine words is far faster (`02-modular-arithmetic`).

### M10. How do the language built-ins compare?
Python `int`, Java `BigInteger`, Go `big.Int` are all arbitrary-precision and auto-select schoolbook/Karatsuba/Toom (and FFT in some). `BigInteger` and Python `int` are immutable; `big.Int` is mutable with a destination receiver.

### M11. What's the gotcha with negative `%` across languages?
Go/Java `%` can return a negative remainder (truncated division); Python `%` follows the divisor's sign (floored). A hand-rolled bignum must pick one convention and document it, or results disagree across ports.

### M12 (analysis). Why does multiplying via polynomials lead to FFT?
A product of limb arrays is the **convolution** of the limb sequences. Convolution = pointwise multiply in the transform domain, and the FFT computes the transform in `O(n log n)`, so multiplication becomes `O(n log n)`.

---

## Senior Questions (10 Q&A)

### S1. Explain the multiplication ladder a production library uses.
By operand size: schoolbook (tiny) → Karatsuba (small) → Toom-3/4 (medium) → FFT/NTT or Schönhage–Strassen (huge). Thresholds are machine-tuned to cache size and multiply-instruction cost.

### S2. FFT vs NTT for big-integer multiplication — which and why?
FFT uses complex doubles (fast but accumulates rounding error — can give a wrong digit). NTT works modulo a prime field — exact, slightly slower. For exactness at large sizes, use NTT, with **multiple primes + Garner/CRT** (`17-garner-algorithm`) to cover large coefficients.

### S3. Why is `math/big`/`BigInteger` unsafe for cryptographic secrets?
They optimize for throughput: normalization leaks magnitude via length, square-and-multiply branches on exponent bits, comparisons early-exit, and table lookups depend on data — all **timing side channels** that leak secret bits. Crypto needs fixed-width, branchless, constant-time code.

### S4. What makes code "constant-time"?
No secret-dependent branches, no secret-dependent memory access, fixed-width data. Conditionals become branchless masked selects (`r = b ^ (mask & (a^b))`), reduction uses Montgomery (no value-dependent division), and powering uses a Montgomery ladder so every bit does identical work.

### S5. How does memory hierarchy affect big multiplication?
Million-limb operands exceed cache, so multiplication becomes bandwidth-bound. Schoolbook is cache-friendly but op-heavy; FFT is op-light but has poor butterfly locality at scale. Wins: in-place transforms, wide `2^64` limbs (fewer cache lines), arena/pool allocation to avoid GC thrash.

### S6. Immutable vs mutable bignum API — trade-offs?
Immutable (`BigInteger`, Python `int`): clean, thread-safe, but allocates per op (GC pressure). Mutable (`big.Int`): fewer allocations via destination receiver, but you must handle aliasing (`z.Mul(z, z)`) safely.

### S7. How do you keep a hot bignum loop from thrashing the GC?
Use mutable receivers / scratch reuse, accumulate in place, pool buffers, and for products of many factors use **binary splitting** so multiplies stay balanced (fast multiply on equal-size operands) instead of giant×tiny.

### S8. How do multiple NTT primes get combined?
Compute the convolution modulo each prime independently; each output coefficient is then known by its residues, and **Garner's algorithm / CRT** reconstructs the true coefficient in `[0, ∏ p_i)` — choose primes so `∏ p_i > N·B²`.

### S9. What is the aliasing hazard and how do you handle it?
When destination and source share storage (`z = z·z`), writing partial results corrupts inputs still being read. Fix: compute into scratch, then copy to the destination; document which methods are alias-safe.

### S10 (design). How would you test a hand-rolled bignum?
Differential/property testing against the language built-in: generate thousands of random pairs, check `mine(a op b) == native(a op b)` for add/sub/mul/div/mod, plus round-trip `parse(format(x)) == x` and identities like `(a·b)/b == a`.

---

## Professional Questions (8 Q&A)

### P1. Prove schoolbook multiply is correct.
`val(a)·val(b) = Σ_k (Σ_{i+j=k} a_i b_j) B^k` — the acyclic convolution. The double loop accumulates exactly `Σ_{i+j=k} a_i b_j` into position `k`, and carry propagation re-normalizes columns into `[0,B)` while preserving column sums. Hence `val(c) = val(a)val(b)`.

### P2. State and solve the Karatsuba and Toom-`k` recurrences.
Karatsuba: `T(n)=3T(n/2)+Θ(n) ⇒ Θ(n^{log₂3})`. Toom-`k`: `T(n)=(2k−1)T(n/k)+Θ(n) ⇒ Θ(n^{log_k(2k−1)})`. Both Master Theorem case 1, since the exponent exceeds 1 and the combine cost is linear.

### P3. Why does the Toom exponent approach 1, and what's the catch?
`log_k(2k−1) → 1` as `k → ∞`, suggesting near-linear multiplication. But the interpolation step's constant (coefficient sizes, number of additions) grows with `k`, so no fixed `k` reaches linear — the limit is realized only by letting the point count grow, i.e. the FFT.

### P4. Prove FFT-based multiplication is `O(n log n)`.
Multiplication reduces to convolution of length `N=Θ(n)`. Cooley–Tukey computes the DFT via `T(N)=2T(N/2)+Θ(N)=Θ(N log N)` (Master Theorem case 2). Transform both, multiply pointwise (`O(N)`), inverse-transform, carry-propagate (`O(n)`) ⇒ `O(n log n)`.

### P5. State the FFT exactness condition.
Worst-case rounding error scales like `N·B²·log N·ε` (`ε ≈ 2^{-53}` for doubles). Correct rounding to the integer coefficient needs error `< 1/2`, i.e. `N·B²·log N < 2^{52}/c`. Beyond that, shrink `B` or use exact NTT.

### P6. State the multiplication lower-bound landscape.
Trivial `Ω(n)` (must read/write `Θ(n)` data). Upper bounds: `n²` → Karatsuba `n^{1.585}` → Toom → Schönhage–Strassen `O(n log n log log n)` → Fürer → Harvey–van der Hoeven `O(n log n)` (2019). Conjectured matching lower bound `Ω(n log n)`; no unconditional super-linear bound is known in the general RAM model.

### P7. Prove the quotient-digit estimate bound in Algorithm D.
After normalizing so `v_{n-1} ≥ ⌊B/2⌋`, the estimate `q̂ = ⌊(u_{j+n}B + u_{j+n-1})/v_{n-1}⌋` (capped at `B−1`) satisfies `q ≤ q̂ ≤ q+2` (Knuth TAOCP 4.3.1, Thm B). A two-limb refinement and at most one add-back correct it to the exact digit; total `Θ(mn)`.

### P8. Why is the last squaring asymptotically the whole cost of `a^e`?
Intermediate at step `k` has `~n·2^k` limbs; total `Σ_k M(n·2^k)`. For `M(x)=x^α` (`α≥1`) this geometric series is dominated by its last term `M(nb)`, so `a^e` costs `Θ(M(nb))` — early small multiplies are negligible. Motivates binary splitting for balanced operands.

---

## Behavioral / Design Prompts

- *"Walk me through deciding whether to use the built-in bignum or roll your own."* Default to the built-in (correct, fast, tested); roll your own only to learn, to hit a special constraint (constant-time crypto), or to satisfy a no-library competition rule.
- *"A bignum-heavy service has high GC pauses. How do you diagnose and fix?"* Profile per-op allocation; switch to mutable receivers / buffer pools / binary splitting; verify with `gc_pause_p99` before/after.
- *"You inherited modular exponentiation built on `math/big` for RSA signing. What's wrong?"* It is not constant-time — leaks the private exponent via timing; replace with a vetted constant-time library, add timing-leak tests to CI.
- *"How do you test a number-theory library you can't fully prove by hand?"* Property-based / differential testing against a trusted oracle plus algebraic identities and round-trips.

---

## Coding Challenges (3 Languages Each)

### Challenge 1 — Add Two Big Numbers Given as Strings

> Given two non-negative integers as decimal strings, return their sum as a string. Do not use the language's bignum type. (LeetCode 415 "Add Strings", generalized.)

#### Go

```go
package main

import (
	"fmt"
	"strings"
)

func addStrings(a, b string) string {
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
		sb.WriteByte(byte('0' + s%10))
		carry = s / 10
	}
	r := []byte(sb.String())
	for l, h := 0, len(r)-1; l < h; l, h = l+1, h-1 {
		r[l], r[h] = r[h], r[l]
	}
	return string(r)
}

func main() {
	fmt.Println(addStrings("923456", "88999")) // 1012455
}
```

#### Java

```java
public class AddStrings {
    static String addStrings(String a, String b) {
        int i = a.length() - 1, j = b.length() - 1, carry = 0;
        StringBuilder sb = new StringBuilder();
        while (i >= 0 || j >= 0 || carry > 0) {
            int s = carry;
            if (i >= 0) s += a.charAt(i--) - '0';
            if (j >= 0) s += b.charAt(j--) - '0';
            sb.append((char) ('0' + s % 10));
            carry = s / 10;
        }
        return sb.reverse().toString();
    }

    public static void main(String[] args) {
        System.out.println(addStrings("923456", "88999")); // 1012455
    }
}
```

#### Python

```python
def add_strings(a, b):
    i, j, carry, out = len(a) - 1, len(b) - 1, 0, []
    while i >= 0 or j >= 0 or carry:
        s = carry
        if i >= 0:
            s += ord(a[i]) - 48; i -= 1
        if j >= 0:
            s += ord(b[j]) - 48; j -= 1
        out.append(chr(48 + s % 10))
        carry = s // 10
    return "".join(reversed(out))


if __name__ == "__main__":
    print(add_strings("923456", "88999"))  # 1012455
```

### Challenge 2 — Multiply Two Big Numbers Given as Strings (Schoolbook)

> Multiply two non-negative integers given as strings; no bignum type. (LeetCode 43 "Multiply Strings".)

#### Go

```go
package main

import "fmt"

func multiply(a, b string) string {
	if a == "0" || b == "0" {
		return "0"
	}
	n, m := len(a), len(b)
	res := make([]int, n+m)
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			mul := int(a[i]-'0') * int(b[j]-'0')
			p1, p2 := i+j, i+j+1
			sum := mul + res[p2]
			res[p2] = sum % 10
			res[p1] += sum / 10
		}
	}
	start := 0
	for start < len(res)-1 && res[start] == 0 {
		start++
	}
	out := make([]byte, 0, len(res)-start)
	for _, d := range res[start:] {
		out = append(out, byte('0'+d))
	}
	return string(out)
}

func main() {
	fmt.Println(multiply("1234", "5678")) // 7006652
}
```

#### Java

```java
public class MultiplyStrings {
    static String multiply(String a, String b) {
        if (a.equals("0") || b.equals("0")) return "0";
        int n = a.length(), m = b.length();
        int[] res = new int[n + m];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                int mul = (a.charAt(i) - '0') * (b.charAt(j) - '0');
                int p1 = i + j, p2 = i + j + 1;
                int sum = mul + res[p2];
                res[p2] = sum % 10;
                res[p1] += sum / 10;
            }
        }
        StringBuilder sb = new StringBuilder();
        for (int d : res) {
            if (!(sb.length() == 0 && d == 0)) sb.append(d);
        }
        return sb.length() == 0 ? "0" : sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(multiply("1234", "5678")); // 7006652
    }
}
```

#### Python

```python
def multiply(a, b):
    if a == "0" or b == "0":
        return "0"
    n, m = len(a), len(b)
    res = [0] * (n + m)
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            mul = (ord(a[i]) - 48) * (ord(b[j]) - 48)
            p1, p2 = i + j, i + j + 1
            s = mul + res[p2]
            res[p2] = s % 10
            res[p1] += s // 10
    out = "".join(map(str, res)).lstrip("0")
    return out or "0"


if __name__ == "__main__":
    print(multiply("1234", "5678"))  # 7006652
```

### Challenge 3 — Karatsuba Multiply on Limb Arrays

> Implement Karatsuba multiplication of two non-negative big integers stored as base-`10^9` little-endian limb arrays, with a schoolbook fallback. Validate the product against the schoolbook result.

#### Go

```go
package main

import "fmt"

const B = 1_000_000_000
const Cut = 16

func norm(a []int64) []int64 {
	for len(a) > 1 && a[len(a)-1] == 0 {
		a = a[:len(a)-1]
	}
	return a
}
func add(a, b []int64) []int64 {
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	r := make([]int64, 0, n+1)
	var c int64
	for i := 0; i < n; i++ {
		s := c
		if i < len(a) {
			s += a[i]
		}
		if i < len(b) {
			s += b[i]
		}
		r = append(r, s%B)
		c = s / B
	}
	if c > 0 {
		r = append(r, c)
	}
	return norm(r)
}
func sub(a, b []int64) []int64 {
	r := make([]int64, len(a))
	var bo int64
	for i := 0; i < len(a); i++ {
		d := a[i] - bo
		if i < len(b) {
			d -= b[i]
		}
		if d < 0 {
			d += B
			bo = 1
		} else {
			bo = 0
		}
		r[i] = d
	}
	return norm(r)
}
func shift(a []int64, k int) []int64 { return norm(append(make([]int64, k), a...)) }
func sb(a, b []int64) []int64 {
	r := make([]int64, len(a)+len(b))
	for i := range a {
		var c int64
		for j := range b {
			cur := r[i+j] + a[i]*b[j] + c
			r[i+j] = cur % B
			c = cur / B
		}
		r[i+len(b)] += c
	}
	return norm(r)
}
func kara(a, b []int64) []int64 {
	if len(a) < Cut || len(b) < Cut {
		return sb(a, b)
	}
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	h := n / 2
	split := func(x []int64) ([]int64, []int64) {
		if len(x) <= h {
			return norm(append([]int64{}, x...)), []int64{0}
		}
		return norm(append([]int64{}, x[:h]...)), norm(append([]int64{}, x[h:]...))
	}
	aL, aH := split(a)
	bL, bH := split(b)
	z0 := kara(aL, bL)
	z2 := kara(aH, bH)
	z1 := sub(sub(kara(add(aL, aH), add(bL, bH)), z2), z0)
	return add(add(shift(z2, 2*h), shift(z1, h)), z0)
}

func main() {
	a := make([]int64, 40)
	b := make([]int64, 40)
	for i := range a {
		a[i] = int64(i*7%B) + 1
		b[i] = int64(i*13%B) + 1
	}
	fmt.Println(fmt.Sprint(kara(a, b)) == fmt.Sprint(sb(a, b))) // true
}
```

#### Java

```java
import java.util.Arrays;

public class KaratsubaLimbs {
    static final long B = 1_000_000_000L;
    static final int CUT = 16;

    static long[] norm(long[] a) { int n = a.length; while (n > 1 && a[n-1]==0) n--; return Arrays.copyOf(a,n); }
    static long[] add(long[] a, long[] b) {
        int n = Math.max(a.length,b.length); long[] r = new long[n+1]; long c=0;
        for (int i=0;i<n;i++){ long s=c+(i<a.length?a[i]:0)+(i<b.length?b[i]:0); r[i]=s%B; c=s/B; }
        r[n]=c; return norm(r);
    }
    static long[] sub(long[] a, long[] b) {
        long[] r=new long[a.length]; long bo=0;
        for(int i=0;i<a.length;i++){ long d=a[i]-bo-(i<b.length?b[i]:0); if(d<0){d+=B;bo=1;}else bo=0; r[i]=d; }
        return norm(r);
    }
    static long[] shift(long[] a,int k){ long[] r=new long[a.length+k]; System.arraycopy(a,0,r,k,a.length); return norm(r); }
    static long[] sb(long[] a, long[] b) {
        long[] r=new long[a.length+b.length];
        for(int i=0;i<a.length;i++){ long c=0; for(int j=0;j<b.length;j++){ long cur=r[i+j]+a[i]*b[j]+c; r[i+j]=cur%B; c=cur/B; } r[i+b.length]+=c; }
        return norm(r);
    }
    static long[] kara(long[] a, long[] b) {
        if (a.length<CUT||b.length<CUT) return sb(a,b);
        int n=Math.max(a.length,b.length), h=n/2;
        long[] aL=norm(Arrays.copyOfRange(a,0,Math.min(h,a.length)));
        long[] aH=a.length>h?norm(Arrays.copyOfRange(a,h,a.length)):new long[]{0};
        long[] bL=norm(Arrays.copyOfRange(b,0,Math.min(h,b.length)));
        long[] bH=b.length>h?norm(Arrays.copyOfRange(b,h,b.length)):new long[]{0};
        long[] z0=kara(aL,bL), z2=kara(aH,bH);
        long[] z1=sub(sub(kara(add(aL,aH),add(bL,bH)),z2),z0);
        return add(add(shift(z2,2*h),shift(z1,h)),z0);
    }

    public static void main(String[] args) {
        long[] a=new long[40], b=new long[40];
        for(int i=0;i<40;i++){ a[i]=(i*7L)%B+1; b[i]=(i*13L)%B+1; }
        System.out.println(Arrays.equals(kara(a,b), sb(a,b))); // true
    }
}
```

#### Python

```python
B, CUT = 10 ** 9, 16


def norm(a):
    while len(a) > 1 and a[-1] == 0:
        a.pop()
    return a


def add(a, b):
    r, c = [], 0
    for i in range(max(len(a), len(b))):
        s = c + (a[i] if i < len(a) else 0) + (b[i] if i < len(b) else 0)
        r.append(s % B); c = s // B
    if c:
        r.append(c)
    return norm(r)


def sub(a, b):
    r, bo = [], 0
    for i in range(len(a)):
        d = a[i] - bo - (b[i] if i < len(b) else 0)
        if d < 0:
            d += B; bo = 1
        else:
            bo = 0
        r.append(d)
    return norm(r)


def shift(a, k):
    return norm([0] * k + a[:])


def sb(a, b):
    r = [0] * (len(a) + len(b))
    for i in range(len(a)):
        c = 0
        for j in range(len(b)):
            cur = r[i + j] + a[i] * b[j] + c
            r[i + j] = cur % B; c = cur // B
        r[i + len(b)] += c
    return norm(r)


def kara(a, b):
    if len(a) < CUT or len(b) < CUT:
        return sb(a, b)
    n = max(len(a), len(b)); h = n // 2
    a_l, a_h = norm(a[:h]), norm(a[h:]) if len(a) > h else [0]
    b_l, b_h = norm(b[:h]), norm(b[h:]) if len(b) > h else [0]
    z0, z2 = kara(a_l, b_l), kara(a_h, b_h)
    z1 = sub(sub(kara(add(a_l, a_h), add(b_l, b_h)), z2), z0)
    return add(add(shift(z2, 2 * h), shift(z1, h)), z0)


if __name__ == "__main__":
    a = [(i * 7) % B + 1 for i in range(40)]
    b = [(i * 13) % B + 1 for i in range(40)]
    print(kara(a, b) == sb(a, b))  # True
```

### Challenge 4 — Factorial of N as a Decimal String

> Compute `N!` exactly and return it as a decimal string, multiplying a bignum by a small int each step (no bignum type). Verify `length of 100! == 158` digits.

#### Go

```go
package main

import "fmt"

const Base = 1_000_000_000

func mulSmall(a []int64, k int64) []int64 {
	var carry int64
	res := make([]int64, 0, len(a)+2)
	for _, limb := range a {
		cur := limb*k + carry
		res = append(res, cur%Base)
		carry = cur / Base
	}
	for carry > 0 {
		res = append(res, carry%Base)
		carry /= Base
	}
	return res
}

func factorial(n int) string {
	a := []int64{1}
	for k := int64(2); k <= int64(n); k++ {
		a = mulSmall(a, k)
	}
	s := fmt.Sprintf("%d", a[len(a)-1])
	for i := len(a) - 2; i >= 0; i-- {
		s += fmt.Sprintf("%09d", a[i])
	}
	return s
}

func main() {
	f := factorial(100)
	fmt.Println(len(f)) // 158
}
```

#### Java

```java
import java.util.*;

public class Factorial {
    static final long BASE = 1_000_000_000L;

    static List<Long> mulSmall(List<Long> a, long k) {
        long carry = 0;
        List<Long> res = new ArrayList<>();
        for (long limb : a) { long cur = limb * k + carry; res.add(cur % BASE); carry = cur / BASE; }
        while (carry > 0) { res.add(carry % BASE); carry /= BASE; }
        return res;
    }

    static String factorial(int n) {
        List<Long> a = new ArrayList<>(List.of(1L));
        for (long k = 2; k <= n; k++) a = mulSmall(a, k);
        StringBuilder sb = new StringBuilder(Long.toString(a.get(a.size() - 1)));
        for (int i = a.size() - 2; i >= 0; i--) sb.append(String.format("%09d", a.get(i)));
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(factorial(100).length()); // 158
    }
}
```

#### Python

```python
BASE = 10 ** 9


def mul_small(a, k):
    res, carry = [], 0
    for limb in a:
        cur = limb * k + carry
        res.append(cur % BASE); carry = cur // BASE
    while carry:
        res.append(carry % BASE); carry //= BASE
    return res


def factorial(n):
    a = [1]
    for k in range(2, n + 1):
        a = mul_small(a, k)
    s = str(a[-1]) + "".join(f"{limb:09d}" for limb in reversed(a[:-1]))
    return s


if __name__ == "__main__":
    print(len(factorial(100)))  # 158
```

---

## Final Tips

- Memorize the **Karatsuba identity** and its `O(n^1.585)` recurrence — it's the single most-asked depth question.
- For implementation rounds, **base 10 with string digits** (LeetCode 415/43) is the common ask; base `10^9` limbs is the "show me you know real bignums" follow-up.
- Always state and handle: **final carry**, **normalization**, **zero**, **different lengths**.
- If secrets are involved, immediately raise **constant-time** concerns — it signals senior-level awareness.
- When asked "how would `BigInteger` do this faster," answer with the **ladder** (schoolbook → Karatsuba → Toom → FFT/NTT).
