# Big Integer (Arbitrary-Precision) Arithmetic — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a precise spec or starter code. Implement the limb-array logic yourself — **do not** reach for `big.Int` / `BigInteger` / Python `int` *except* as a correctness oracle in tests.
> **Always validate against the language's native bignum on random inputs, and round-trip `parse(format(x)) == x`, before trusting your implementation.**

---

## Beginner Tasks (5)

### Task 1 — Parse and format base-`10^9` limbs

**Problem.** Implement `fromString(s) -> limbs` and `toString(limbs) -> s` for non-negative decimals using base `B = 10^9`, little-endian. `fromString` chunks the string from the right into groups of 9 digits; `toString` prints the top limb plain and pads every lower limb to 9 digits.

**Input / Output spec.**
- `fromString("1000000005")` → `[5, 1]`
- `toString([5, 1])` → `"1000000005"`
- `fromString("007")` → `[7]`; `toString([0])` → `"0"`

**Constraints.** Strings up to `10^5` digits; strip leading zeros; zero is `[0]`.

**Hint.** `int(s[-9:])` is the next limb; `f"{limb:09d}"` pads lower limbs.

**Starter — Go.**
```go
package main

import "fmt"

const Base = 1_000_000_000

func fromString(s string) []int64 { /* TODO */ return nil }
func toString(a []int64) string   { /* TODO */ return "" }

func main() {
	fmt.Println(fromString("1000000005")) // [5 1]
	fmt.Println(toString([]int64{5, 1}))  // 1000000005
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final long BASE = 1_000_000_000L;
    static long[] fromString(String s) { /* TODO */ return null; }
    static String toString(long[] a)   { /* TODO */ return ""; }
    public static void main(String[] a) {
        System.out.println(Arrays.toString(fromString("1000000005")));
        System.out.println(toString(new long[]{5, 1}));
    }
}
```

**Starter — Python.**
```python
BASE = 10 ** 9
def from_string(s): ...   # TODO
def to_string(a): ...     # TODO
if __name__ == "__main__":
    print(from_string("1000000005"))  # [5, 1]
    print(to_string([5, 1]))          # 1000000005
```

- **Evaluation:** round-trip on random strings; correct zero/leading-zero handling.

### Task 2 — Add two non-negative bignums

**Problem.** Implement `add(a, b)` on little-endian base-`10^9` limb arrays with carry propagation. Handle different lengths and the final carry.

**Constraints.** Up to `10^5` limbs each; result normalized.

**Hint.** Treat out-of-range limbs as 0; append the final carry if non-zero.

- **Evaluation:** compare `toString(add(fromString(x), fromString(y)))` against native addition for 10⁴ random pairs.

### Task 3 — Subtract (assume `a ≥ b`)

**Problem.** Implement `sub(a, b)` with borrow propagation, returning the normalized difference. You may assume `a ≥ b`.

**Constraints.** Validate `a ≥ b` with a comparison helper first; document behavior if violated.

**Hint.** `d = a[i] − b[i] − borrow`; if `d < 0`, `d += B`, `borrow = 1`.

- **Evaluation:** check `sub(add(a,b), b) == a` for random `a, b`.

### Task 4 — Compare two bignums

**Problem.** Implement `cmp(a, b) -> {-1, 0, +1}` without subtracting: compare normalized lengths, then limbs from most-significant down.

**Constraints.** Inputs are normalized (no leading zero limbs).

**Hint.** Length decides first; ties go top-down limb by limb.

- **Evaluation:** agree with native integer comparison on random pairs, including equal values.

### Task 5 — Multiply a bignum by a small int

**Problem.** Implement `mulSmall(a, k)` where `0 ≤ k < B`, in `O(n)`. This is the workhorse for factorials.

**Constraints.** `k` fits one limb; carry may exceed one limb at the top — flush it fully.

**Hint.** `cur = limb*k + carry`; push `cur % B`; carry `cur / B`; after the loop, keep flushing carry while non-zero.

- **Evaluation:** compare against `toString` of the full multiply and against native `int(x) * k`.

---

## Intermediate Tasks (5)

### Task 6 — Schoolbook multiplication

**Problem.** Implement full `mul(a, b)` in `O(n·m)`, accumulating `a[i]*b[j]` into result position `i+j` with carry propagation, then normalize.

**Constraints.** Result length `len(a)+len(b)`; ensure no limb-product overflow (`B ≤ 10^9`).

**Hint.** Inner loop carries; remember the final `res[i+len(b)] += carry`.

- **Evaluation:** differential test vs native multiply on 10⁴ random pairs up to ~50 limbs.

### Task 7 — Karatsuba multiplication with cutoff

**Problem.** Implement `karatsuba(a, b)` that splits into high/low halves, computes `z0, z2, z1=(aL+aH)(bL+bH)−z2−z0`, combines with limb shifts, and falls back to schoolbook below a cutoff (e.g. 16–32 limbs).

**Constraints.** Must equal schoolbook on all inputs; tune the cutoff by benchmarking.

**Hint.** `shift(x, k)` prepends `k` zero limbs (multiply by `B^k`); combine `z2·B^{2h} + z1·B^h + z0`.

**Starter — Python.**
```python
B, CUT = 10 ** 9, 16
def kara(a, b):
    if len(a) < CUT or len(b) < CUT:
        return schoolbook(a, b)
    n = max(len(a), len(b)); h = n // 2
    # TODO: split, three recursive products, combine
    ...
```

- **Evaluation:** `kara(a,b) == schoolbook(a,b)` for many random sizes spanning the cutoff.

### Task 8 — Division by a single limb + decimal conversion

**Problem.** Implement `divmodSmall(a, k) -> (quotient, remainder)` sweeping from the top limb down. Use it to convert a base-`10^9` bignum to a base-10 string by repeatedly dividing by 10 (or directly via `toString`), and to convert a decimal string to limbs by repeated `*10 + digit` with `mulSmall`/`add`.

**Constraints.** `k ≥ 1`; quotient normalized; remainder `< k`.

**Hint.** `cur = rem*B + a[i]`; `q[i] = cur/k`; `rem = cur%k`.

- **Evaluation:** `from_string(to_string(x)) == x`; cross-check digit count of `2^1000`.

### Task 9 — Signed bignum wrapper

**Problem.** Wrap your unsigned magnitude in a `(sign, magnitude)` type and implement signed `add` and `sub` (route by sign, comparing magnitudes when signs differ). Enforce canonical zero (`sign = 0`, never `−0`).

**Constraints.** Cover all sign combinations; normalize results.

**Hint.** `a − b = a + (−b)`; the result's sign is the larger magnitude's sign.

- **Evaluation:** match native signed `+`/`−` on random signed pairs (including results that cross zero).

### Task 10 — Power of two and modular check

**Problem.** Compute `2^N` as a bignum (repeated `mulSmall(_, 2)` or repeated doubling via `add`), and verify properties: digit count of `2^N` is `floor(N·log10(2)) + 1`, and `2^N mod 9` cycles. Print `2^100` and its digit count.

**Constraints.** `N` up to `10^5`.

**Hint.** Doubling is `add(a, a)`; the digit count is a quick sanity oracle.

- **Evaluation:** digit count formula matches; `to_string(2^100)` matches native.

---

## Advanced Tasks (5)

### Task 11 — Full long division (Knuth Algorithm D)

**Problem.** Implement `divmod(u, v) -> (q, r)` for multi-limb divisor `v` using Knuth's Algorithm D: normalize so `v`'s top limb `≥ B/2`, estimate each quotient digit from the top two limbs, correct (at most +2), multiply-subtract, add-back on underflow, de-normalize the remainder.

**Constraints.** `v ≠ 0`; `0 ≤ r < v`; `u = q·v + r`.

**Hint.** Scale factor `d = B/(v_top+1)`; the estimate satisfies `q ≤ q̂ ≤ q+2`.

- **Evaluation:** `q*v + r == u` and `0 ≤ r < v` for random `u, v`; cross-check with native `divmod`.

### Task 12 — Barrett or Montgomery modular reduction

**Problem.** Implement fast `mod m` for a fixed modulus reused many times. Either **Barrett** (precompute `μ = floor(B^{2k}/m)`, reduce with two multiplies and a subtract) or **Montgomery** (transform to the Montgomery domain; cross-link `16-montgomery-multiplication`). Compare its speed to full long division.

**Constraints.** Reduction must equal `a % m` exactly; precompute the constant once.

**Hint.** Barrett: `q̂ = (a·μ) >> (2k·log₂B)`; `r = a − q̂·m`; correct with at most two subtractions.

- **Evaluation:** matches `a % m` on random `a`; benchmark vs Task 11 division.

### Task 13 — Modular exponentiation on bignums

**Problem.** Implement `modPow(base, exp, mod)` via square-and-multiply on your bignum (cross-link `29-binary-exponentiation`), using Task 6/7 multiply and Task 11/12 reduction. Note where a **constant-time** version would differ (always-multiply + conditional select).

**Constraints.** Large `mod` (hundreds of digits); result `< mod`.

**Hint.** Scan exponent bits MSB→LSB: square, and multiply when the bit is 1; reduce after each.

- **Evaluation:** match native `pow(base, exp, mod)`; comment on side-channel differences vs constant-time.

### Task 14 — FFT or NTT multiplication

**Problem.** Implement large-number multiplication via convolution: either an iterative **NTT** over a prime `p = c·2^k+1` (exact; cross-link `15-ntt`) or a **complex FFT** (handle rounding). Multiply two ~10⁴-limb numbers and confirm against Karatsuba.

**Constraints.** Use a base small enough to avoid coefficient overflow (single-prime: `N·B² < p`); carry-propagate the convolution output.

**Hint.** Treat limbs as polynomial coefficients; `C = invNTT(NTT(A) ⊙ NTT(B))`; then resolve carries.

- **Evaluation:** `fft_mul(a,b) == karatsuba(a,b)` on large random inputs; benchmark the `O(n log n)` advantage.

### Task 15 — Differential test harness + benchmark

**Problem.** Build a property-based harness that, for thousands of random inputs, checks your add/sub/mul/div/mod against the native bignum, plus identities `(a·b)/b == a`, `a − b + b == a`, `a mod m < m`. Then benchmark schoolbook vs Karatsuba (vs FFT if done) across sizes.

**Constraints.** Cover edge cases: zero, single limb, very different lengths, powers of `B`.

**Hint.** Generate random digit strings, parse to limbs, run your op, compare `toString` to the native result.

- **Evaluation:** zero mismatches across all properties; benchmark table shows the expected `O(n²)` vs `O(n^1.585)` scaling.

---

## Benchmark Task

> Compare multiplication performance across all 3 languages (using each language's native bignum, which internally selects the algorithm ladder).

#### Go

```go
package main

import (
	"fmt"
	"math/big"
	"math/rand"
	"time"
)

func randBig(bits int) *big.Int { return new(big.Int).Rand(rand.New(rand.NewSource(1)), new(big.Int).Lsh(big.NewInt(1), uint(bits))) }

func main() {
	for _, bits := range []int{1024, 8192, 65536, 524288} {
		a, b := randBig(bits), randBig(bits)
		start := time.Now()
		for i := 0; i < 50; i++ {
			new(big.Int).Mul(a, b)
		}
		fmt.Printf("bits=%7d: %.3f ms\n", bits, float64(time.Since(start).Microseconds())/50.0/1000)
	}
}
```

#### Java

```java
import java.math.BigInteger;
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        Random rng = new Random(1);
        for (int bits : new int[]{1024, 8192, 65536, 524288}) {
            BigInteger a = new BigInteger(bits, rng), b = new BigInteger(bits, rng);
            long start = System.nanoTime();
            for (int i = 0; i < 50; i++) a.multiply(b);
            System.out.printf("bits=%7d: %.3f ms%n", bits, (System.nanoTime() - start) / 50.0 / 1e6);
        }
    }
}
```

#### Python

```python
import random, timeit

for bits in [1024, 8192, 65536, 524288]:
    a = random.getrandbits(bits)
    b = random.getrandbits(bits)
    t = timeit.timeit(lambda: a * b, number=50)
    print(f"bits={bits:>7}: {t / 50 * 1000:.3f} ms")
```
