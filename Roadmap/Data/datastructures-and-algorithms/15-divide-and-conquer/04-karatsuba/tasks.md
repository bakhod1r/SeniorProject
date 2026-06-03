# Karatsuba Multiplication (Fast Big-Integer Multiply) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Karatsuba / fast-multiplication logic and validate against the evaluation criteria.
> **Always test against a schoolbook (or native `*`) oracle on random AND all-ones carry-stress inputs before trusting the fast result.**

---

## Beginner Tasks (5)

### Task 1 — Schoolbook multiply on limb arrays

**Problem.** Implement `schoolbook(x, y)` for two little-endian limb arrays in base `2^32`. Return the normalized product limb array. This is the `O(n²)` oracle every later task validates against.

**Input / Output spec.**
- Read `nx`, then `nx` limbs of `x`; read `ny`, then `ny` limbs of `y`.
- Print the product limbs, low-to-high, space-separated.

**Constraints.**
- `1 ≤ nx, ny ≤ 200`, each limb in `[0, 2^32)`.
- Use a 64-bit (or 128-bit) accumulator so `res + x[i]*y[j] + carry` does not overflow.

**Hint.** Double loop `i, j`; accumulate into `res[i+j]`, carry `>> 32` into `res[i+j+1]`. Normalize at the end.

**Worked check.** `x = [0xFFFFFFFF]`, `y = [0xFFFFFFFF]` (i.e. `(2^32−1)²`): the product is `0xFFFFFFFE00000001`, which is limbs `[0x00000001, 0xFFFFFFFE]` low-to-high. This single all-ones case exercises the maximal carry and is a perfect first sanity check.

**Starter — Go.**
```go
package main

import "fmt"

func schoolbook(x, y []uint64) []uint64 {
	// TODO: res size len(x)+len(y); accumulate x[i]*y[j] with carry; normalize.
	return nil
}

func main() {
	var nx int
	fmt.Scan(&nx)
	x := make([]uint64, nx)
	for i := range x {
		fmt.Scan(&x[i])
	}
	var ny int
	fmt.Scan(&ny)
	y := make([]uint64, ny)
	for i := range y {
		fmt.Scan(&y[i])
	}
	for i, v := range schoolbook(x, y) {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(v)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long[] schoolbook(long[] x, long[] y) {
        // TODO
        return null;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int nx = sc.nextInt();
        long[] x = new long[nx];
        for (int i = 0; i < nx; i++) x[i] = sc.nextLong();
        int ny = sc.nextInt();
        long[] y = new long[ny];
        for (int i = 0; i < ny; i++) y[i] = sc.nextLong();
        long[] r = schoolbook(x, y);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < r.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(r[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def schoolbook(x, y):
    # TODO
    return []


def main():
    data = iter(sys.stdin.read().split())
    nx = int(next(data))
    x = [int(next(data)) for _ in range(nx)]
    ny = int(next(data))
    y = [int(next(data)) for _ in range(ny)]
    print(" ".join(map(str, schoolbook(x, y))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Matches the native big-int product when limbs are reassembled.
- No accumulator overflow.
- Normalized output (limbs `< 2^32`, no leading zeros).

---

### Task 2 — Karatsuba on non-negative integers

**Problem.** Implement `karatsuba(x, y)` for non-negative integers using exactly three recursive sub-multiplications and a small-input fallback. Return the exact product.

**Input / Output spec.**
- Read `x` and `y` as decimal integers (possibly very large).
- Print `x·y`.

**Constraints.** Arbitrary precision; recursion must perform exactly three sub-products.

**Hint.** Split at `half = max(bitlen)/2`. `z2 = kara(a,c)`, `z0 = kara(b,d)`, `z1 = kara(a+b, c+d) − z2 − z0`. Recombine `z2<<(2·half) + z1<<half + z0`. Fall back to native multiply below ~64 bits.

**Reference oracle (Python) — use this to validate.**
```python
def oracle(x, y):
    return x * y  # native; or schoolbook on limbs from Task 1
```

**Evaluation criteria.**
- Exactly three recursive multiplications per non-base call.
- Matches the oracle on random inputs of widely varying sizes.
- Handles `x = 0` or `y = 0` → `0`.

---

### Task 3 — Verify the three-product identity

**Problem.** Given `a, b, c, d`, compute `z2 = a·c`, `z0 = b·d`, and `z1` **two ways**: directly as `a·d + b·c`, and via the Karatsuba trick `(a+b)(c+d) − z2 − z0`. Assert they are equal and print `z2, z1, z0`.

**Input / Output spec.**
- Read `a b c d`.
- Print `z2 z1 z0`, then `OK` if both `z1` computations agree.

**Constraints.** `0 ≤ a,b,c,d < 10^18`.

**Hint.** This is the core algebraic check `(a+b)(c+d) = z2 + z1 + z0`. Use 128-bit or big-int to avoid overflow in the products.

**Worked check.** `a=12, b=34, c=56, d=78`: `z2=672`, `z0=2652`, `(a+b)(c+d)=46·134=6164`, `z1=6164−672−2652=2840 = 12·78+34·56`. ✓

**Evaluation criteria.**
- Both `z1` formulas always agree.
- No overflow (use wide types).
- Reconstructed `z2·B²+z1·B+z0` equals the true product for a chosen base.

---

### Task 4 — Crossover dispatcher (schoolbook ↔ Karatsuba)

**Problem.** Implement `multiply(x, y)` that calls schoolbook below `CUTOFF` limbs and Karatsuba above it. The cutoff is a named constant.

**Input / Output spec.**
- Read `x`, `y` (large decimals). Print `x·y`.

**Constraints.** `CUTOFF` between 8 and 64 limbs; arbitrary-precision inputs.

**Hint.** Dispatch on limb count. Below `CUTOFF`, use the Task-1 schoolbook (or native). Above, do the three-product split, recursing back into `multiply` (not directly into Karatsuba) so sub-calls also dispatch.

**Evaluation criteria.**
- Correct dispatch by size; recursion re-enters the dispatcher.
- Matches the oracle for sizes straddling the cutoff (`CUTOFF−1`, `CUTOFF`, `CUTOFF+1`).
- Cutoff is a single named constant, not inlined.

---

### Task 5 — Polynomial multiply via Karatsuba (no carries)

**Problem.** Multiply two polynomials given as coefficient arrays (index = degree) using Karatsuba. Coefficients are arbitrary integers; there is **no** carry propagation.

**Input / Output spec.**
- Read `np`, then `np` coefficients of `P`; read `nq`, then `nq` coefficients of `Q`.
- Print the `np+nq−1` product coefficients, low-degree first.

**Constraints.** `1 ≤ np, nq ≤ 1000`, coefficients in `[−10^9, 10^9]`.

**Hint.** Split at the middle degree, recurse on three half-degree products, recombine by adding shifted coefficient blocks: `z0` at offset 0, `z1` at offset `half`, `z2` at offset `2·half`. Base case: direct `O(n²)` convolution for small degree.

**Reference oracle (Python).**
```python
def poly_oracle(p, q):
    res = [0] * (len(p) + len(q) - 1)
    for i, pi in enumerate(p):
        for j, qj in enumerate(q):
            res[i + j] += pi * qj
    return res
```

**Evaluation criteria.**
- `(1+2x)(3+4x) = 3 + 10x + 8x²` → `[3, 10, 8]`.
- Matches `poly_oracle` for random polynomials.
- No carries; coefficients may be large/negative.

---

## Intermediate Tasks (5)

### Task 6 — Karatsuba on decimal digit strings

**Problem.** Multiply two non-negative integers given as decimal **strings** (do not convert the whole numbers with the native multiply) using Karatsuba on the digits. Return the product string.

**Constraints.** Up to `10^5` digits each.

**Hint.** Pad to a common length, split into decimal high/low halves, recurse with three products, recombine with decimal shifts (appending zeros) and string addition/subtraction. Use the native int only on small chunks at the base case.

**Reference oracle (Python).**
```python
def oracle_str(x, y):
    return str(int(x) * int(y))
```

**Evaluation criteria.**
- `"99"·"99" = "9801"` (verifies a carry case).
- Matches `oracle_str` on random digit strings.
- No leading zeros in the output (except the single `"0"`).

---

### Task 7 — Limb-level Karatsuba with explicit carry handling

**Problem.** Implement Karatsuba on little-endian base-`2^32` limb arrays, doing carry propagation yourself (no big-int reassembly for the combine). Provide `add`, `sub`, `shiftLimbs`, `normalize`, and the three-product recursion.

**Constraints.** Operands up to 4000 limbs.

**Hint.** Reserve one extra limb for `a+b`, `c+d`. Compute `z0, z2` into their result offsets, `z1` in scratch, then add `z1` at offset `half` with a full carry propagation pass. `sub` assumes `a ≥ b` (the math guarantees `(a+b)(c+d) ≥ z2 + z0`).

**Carry-stress check.** Multiply all-ones operands (`limbs = [0xFFFFFFFF]*k`) to force maximal carry chains; compare against schoolbook.

**Evaluation criteria.**
- Matches schoolbook (Task 1) on random and all-ones inputs.
- Correct handling of the `a+b` carry-out limb.
- Recombination carry propagates past a single limb.

---

### Task 8 — Toom-3 multiplication

**Problem.** Implement Toom-3: split each operand into 3 parts, evaluate the product polynomial at 5 points (`0, 1, −1, 2, ∞`), multiply (5 sub-products), and interpolate the 5 coefficients, then recombine with carries.

**Constraints.** Operands up to 6000 limbs; use exact integer interpolation.

**Hint.** With sub-parts `a0,a1,a2` and `c0,c1,c2`:
```
w0 = a0·c0;  w∞ = a2·c2
w1 = (a0+a1+a2)(c0+c1+c2)
wm1 = (a0−a1+a2)(c0−c1+c2)
w2 = (a0+2a1+4a2)(c0+2c1+4c2)
```
Interpolate `r0=w0`, `r4=w∞`, and recover `r1,r2,r3` by a fixed sequence of `±` and exact divisions by 2 and 3. Sub-products may use Karatsuba.

**Evaluation criteria.**
- Matches schoolbook / native on random and carry-stress inputs.
- Uses exactly 5 sub-products.
- Interpolation divisions are exact (zero remainder); assert this in debug.
- Empirically faster than Karatsuba above its own crossover.

---

### Task 9 — Squaring special-case

**Problem.** Implement `square(x)` using Karatsuba's structure but exploiting `a = c`, `b = d` so only three *squarings* (and the symmetric cross term) are needed. Compare its speed against `multiply(x, x)`.

**Constraints.** Operands up to 4000 limbs.

**Hint.** For `x = aB + b`: `x² = a²·B² + 2ab·B + b²`, where `2ab = (a+b)² − a² − b²`. So three squarings `a²`, `b²`, `(a+b)²` recover the middle term. Recurse with `square`, not `multiply`.

**Evaluation criteria.**
- `square(x) == x*x` on random and carry-stress inputs.
- Uses three recursive squarings (not general multiplies).
- Measurably faster than `multiply(x, x)` above the crossover.

---

### Task 10 — Crossover benchmark (schoolbook vs Karatsuba vs Toom-3)

**Problem.** Empirically find the sizes at which Karatsuba overtakes schoolbook, and Toom-3 overtakes Karatsuba, for your implementation on a fixed machine. Benchmark all three across a sweep of operand sizes (fixed seed) and report a table.

**Constraints.** Sizes from ~4 to ~10,000 limbs; at least 5 runs per size, report the mean; do not time input generation.

**Hint.** Generate random limb arrays with a seeded RNG (same seed across languages). Time each method per size. The crossover is where two timing curves intersect.

**Starter — Python.**
```python
import random
import time

BASE = 1 << 32


def gen(n, seed):
    r = random.Random(seed)
    return [r.getrandbits(32) for _ in range(n)]


def schoolbook(x, y):
    # TODO: O(n^2) limb multiply with carry, normalize
    return [0]


def karatsuba(x, y):
    # TODO: 3-product split, dispatch to schoolbook below CUTOFF
    return [0]


def toom3(x, y):
    # TODO: 5-product split with interpolation
    return [0]


def bench(fn, x, y, runs=5):
    best = float("inf")
    for _ in range(runs):
        t0 = time.perf_counter()
        fn(x, y)
        best = min(best, time.perf_counter() - t0)
    return best * 1000.0  # ms


def main():
    print("n        schoolbook_ms   karatsuba_ms   toom3_ms")
    for n in [4, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]:
        x, y = gen(n, 1), gen(n, 2)
        sb = bench(schoolbook, x, y) if n <= 2048 else float("nan")
        ka = bench(karatsuba, x, y)
        tm = bench(toom3, x, y)
        print(f"{n:<8d} {sb:<15.3f} {ka:<14.3f} {tm:<.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed → same inputs across Go, Java, Python.
- Schoolbook wins for small `n`; Karatsuba in the middle; Toom-3 for large. Report both crossover sizes.
- Writeup compares measured crossovers to the theoretical curve intersections.

---

## Advanced Tasks (5)

### Task 11 — NTT-based multiply (the FFT rung)

**Problem.** Implement Number-Theoretic-Transform multiplication modulo an NTT-friendly prime (e.g. `998244353`, root `3`). Multiply two limb arrays (small base, e.g. `2^16`, so coefficients fit) via forward NTT, pointwise product, inverse NTT, then carry propagation.

**Constraints.** Operands up to `2^20` coefficients; use base `2^16` so convolution coefficients stay below the prime (or split / use CRT).

**Hint.** Pad to a power of two `≥ 2n−1`. Cooley-Tukey iterative NTT, pointwise multiply mod `p`, inverse NTT (multiply by `n^{-1}` and use the inverse root), then carry-normalize. For coefficients exceeding one prime, run two primes and CRT.

**Evaluation criteria.**
- Matches schoolbook / Karatsuba on random and carry-stress inputs.
- Correct `O(n log n)` transform; beats Toom-3 above the FFT crossover.
- Carry pass produces canonical limbs.

---

### Task 12 — Full hybrid multiply tower

**Problem.** Build a size-dispatched `multiply(x, y)` that selects schoolbook → Karatsuba → Toom-3 → NTT by limb count, with tuned (constant) thresholds, each level recursing into the dispatcher.

**Constraints.** Operands up to `2^20` limbs; thresholds as named constants.

**Hint.** `if n < K_THRESH: schoolbook; elif n < T_THRESH: karatsuba; elif n < FFT_THRESH: toom3; else: ntt`. Use the Task-10 benchmark to pick the thresholds for your machine.

**Evaluation criteria.**
- Correct across all size bands (differential vs native on a wide sweep).
- Each level re-enters the dispatcher (a Toom sub-product may dispatch to Karatsuba).
- Thresholds are tuned, named constants; document how they were measured.
- Overall faster than any single algorithm across the size range.

---

### Task 13 — The `(a−b)(c−d)` evaluation variant

**Problem.** Reimplement Karatsuba using the points `{0, 1, −1}`, computing `z1` from `(a+b)(c+d)` and `(a−b)(c−d)`: `z1 = [(a+b)(c+d) − (a−b)(c−d)]/2`. Handle the signs of `(a−b)`, `(c−d)` explicitly for unsigned limb arrays.

**Constraints.** Operands up to 4000 limbs.

**Hint.** Compute `|a−b|`, `|c−d|`, and a sign flag for each; the product `(a−b)(c−d)` takes the XOR of the flags. The `/2` is exact (the bracket is even). This variant keeps operands the same length as a half (no `a+b` carry-out growth), at the cost of signed bookkeeping.

**Evaluation criteria.**
- Matches schoolbook on random and carry-stress inputs.
- Correct sign handling when `a < b` xor `c < d`.
- Exact `/2` (zero remainder); assert in debug.

---

### Task 14 — Differential test harness with carry-stress generation

**Problem.** Build a reusable test harness that differentially tests any multiply implementation against a schoolbook oracle, covering: random sizes (incl. unequal and odd), all-ones operands, single-high-limb (power-of-base) operands, zero/one operands, and every crossover-boundary size `±1`.

**Constraints.** Must run in CI in under a few seconds; thousands of cases.

**Hint.** Parameterize the harness by the function under test. Generate all-ones inputs (`[0xFFFFFFFF]*k`) to force maximal carries — these catch the dropped-carry / truncated-middle-product bug that random inputs miss. Assert canonical normalization on every result.

**Evaluation criteria.**
- Catches a deliberately injected dropped-carry bug.
- Covers unequal/odd lengths, all-ones, powers of base, zeros, and crossover ±1.
- Same harness validates Karatsuba, Toom-3, and NTT implementations.

---

### Task 15 — Choose the right multiply algorithm

**Problem.** Implement `classify(n_limbs, ratio, exact_required)` (or a short analysis) that, given operand size, size ratio, and whether exact (vs floating-point) output is required, returns one of `SCHOOLBOOK`, `KARATSUBA`, `TOOM3`, `NTT`, or `FFT_FLOAT`, with justification.

**Constraints / cases to handle.**
- Tiny operands → `SCHOOLBOOK`.
- Small-to-medium (crypto sizes) → `KARATSUBA`.
- Large, balanced → `TOOM3`.
- Huge, exact integers → `NTT` (exact, modular).
- Huge, floating-point convolution acceptable → `FFT_FLOAT`.
- Very skewed ratio → note the unbalanced/blocked variant.

**Hint.** Encode the threshold logic from `middle.md` and `senior.md`. The trap is using floating-point FFT for *exact* integer results — that needs NTT to stay exact.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The exact-vs-float branch explicitly explains why NTT (not float FFT) is needed for exact integers.
- Skewed-ratio case notes balanced-split waste and the unbalanced remedy.

---

## Benchmark Task

### Task B — Karatsuba recursion-depth and allocation profile

**Problem.** Instrument a Karatsuba implementation to report, per top-level call: the recursion depth reached, the number of sub-multiplications performed, and the total bytes of temporary buffers allocated. Then compare a naive (allocate-per-level) implementation against a scratch-arena implementation.

**Starter — Python.**
```python
import random
import time

CUTOFF_BITS = 1024


class Stats:
    def __init__(self):
        self.depth = 0
        self.max_depth = 0
        self.submuls = 0
        self.alloc_bytes = 0


def karatsuba(x, y, st: Stats):
    st.depth += 1
    st.max_depth = max(st.max_depth, st.depth)
    if x.bit_length() < CUTOFF_BITS or y.bit_length() < CUTOFF_BITS:
        st.depth -= 1
        return x * y
    half = max(x.bit_length(), y.bit_length()) // 2
    st.alloc_bytes += 4 * (half // 8 + 1)  # rough: a,b,c,d temporaries
    mask = (1 << half) - 1
    b, a = x & mask, x >> half
    d, c = y & mask, y >> half
    st.submuls += 3
    z2 = karatsuba(a, c, st)
    z0 = karatsuba(b, d, st)
    z1 = karatsuba(a + b, c + d, st) - z2 - z0
    st.depth -= 1
    return (z2 << (2 * half)) + (z1 << half) + z0


def main():
    for bits in [2048, 8192, 32768, 131072]:
        x = random.getrandbits(bits)
        y = random.getrandbits(bits)
        st = Stats()
        t0 = time.perf_counter()
        got = karatsuba(x, y, st)
        dt = (time.perf_counter() - t0) * 1000
        assert got == x * y
        print(f"bits={bits:<7d} depth={st.max_depth:<3d} submuls={st.submuls:<6d} "
              f"alloc≈{st.alloc_bytes:<9d}B time={dt:.2f}ms")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Recursion depth ≈ `log₂(n / cutoff)`; sub-multiplication count grows like `3^depth`.
- The naive version's allocation total grows ~`O(n^{1.585})`; the scratch-arena version stays `O(n)`.
- Same seed → same inputs across Go, Java, Python.
- Writeup: how allocation strategy affects wall-clock time (GC/allocator pressure), and where the depth bottoms out at the cutoff.

**Extension.** Plot the sub-multiplication count against `n` on log-log axes; the slope should approach `log₂3 ≈ 1.585`, an empirical confirmation of the recurrence. Compare against a Toom-3 instrumentation whose slope approaches `log₃5 ≈ 1.465` — visually demonstrating the exponent improvement that motivates climbing the algorithm ladder.

---

## General Guidance for All Tasks

- **Always validate against the schoolbook oracle first.** Every task references a slow, obviously-correct multiply. Run it on small inputs, diff limb-by-limb, then trust the fast version on large inputs.
- **Add all-ones carry-stress inputs.** Random inputs often miss the dropped-carry / truncated-middle-product bug; `[0xFFFFFFFF]*k` forces it. This is the single most valuable extra test.
- **Pin the cutoff and base as named constants.** Use `CUTOFF`, `BASE`; never inline magic numbers. Document units (limbs/bits/digits).
- **Get the base case right.** A missing base case is the #1 cause of infinite recursion. Fall back to schoolbook below the cutoff.
- **Reserve headroom for `a+b`, `c+d`.** Their sum can be one limb longer than a half; the middle product spans `2·half + 2` limbs.
- **Separate convolution from carries.** Compute coefficients as if polynomials, then normalize carries in one pass.
- **Reuse buffers.** A scratch arena keeps allocation `O(n)`; per-level allocation churns `O(n^{1.585})` and is GC-bound.
- **Recurse into the dispatcher, not the algorithm.** A Toom-3 sub-product should re-enter `multiply` so it can itself pick schoolbook or Karatsuba based on its (smaller) size.
- **Use NTT, not floating-point FFT, for exact integers.** Floating-point rounding corrupts exact results; modular NTT (plus CRT for large coefficients) stays exact.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
