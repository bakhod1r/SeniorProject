# Number-Theoretic Transform (NTT) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise I/O spec, constraints, hints, and starter code in all three languages where useful.
> **Always test against a schoolbook `O(n²)` convolution oracle on small inputs before trusting the NTT result.**
> The butterfly structure is shared with `15-divide-and-conquer/05-fft`; the number-theory (friendly primes, roots, CRT) is the focus here.

---

## Beginner Tasks (5)

### Task 1 — Schoolbook convolution oracle

**Problem.** Implement `conv_bruteforce(a, b, mod)` returning `c` with `c[k] = (Σ_{i+j=k} a[i]·b[j]) mod p`. This is your correctness oracle for every later task.

**Input / Output spec.**
- Read `n`, array `a` (`n` ints), `m`, array `b` (`m` ints), all already in `[0, p)`.
- Print `c[0..n+m-2]` space-separated.

**Constraints.** `1 ≤ n, m ≤ 2000`, `p = 998244353`.

**Hint.** Double loop; reduce mod `p` after each accumulation; use 64-bit products.

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 998244353

func convBruteforce(a, b []int64) []int64 {
	// TODO: c[i+j] = (c[i+j] + a[i]*b[j]) % MOD
	return nil
}

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int64, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	var m int
	fmt.Scan(&m)
	b := make([]int64, m)
	for i := range b {
		fmt.Scan(&b[i])
	}
	c := convBruteforce(a, b)
	for i, v := range c {
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
    static final long MOD = 998244353L;

    static long[] convBruteforce(long[] a, long[] b) {
        // TODO
        return null;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextLong();
        int m = sc.nextInt();
        long[] b = new long[m];
        for (int i = 0; i < m; i++) b[i] = sc.nextLong();
        long[] c = convBruteforce(a, b);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < c.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(c[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys

MOD = 998244353


def conv_bruteforce(a, b):
    # TODO
    return []


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    a = [int(next(data)) for _ in range(n)]
    m = int(next(data))
    b = [int(next(data)) for _ in range(m)]
    print(" ".join(map(str, conv_bruteforce(a, b))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct mod-`p` convolution verified on a hand `2×2` example.
- 64-bit products before `% MOD`.
- Result length exactly `n + m − 1`.

---

### Task 2 — Build a primitive `n`-th root of unity

**Problem.** Given the NTT-friendly prime `p = 998244353` (primitive root `g = 3`) and a power-of-two `n` dividing `p − 1`, compute `ω = g^{(p-1)/n} mod p` and verify it has order exactly `n` (`ω^n ≡ 1` and `ω^{n/2} ≡ −1`).

**Input / Output spec.**
- Read `n` (a power of two, `≤ 2^23`).
- Print `ω`, then `ω^n mod p`, then `ω^{n/2} mod p`.

**Constraints.** `n = 2^L`, `1 ≤ L ≤ 23`.

**Hint.** Binary exponentiation for `g^e mod p`. Check `ω^{n/2} == p − 1` (which is `−1 mod p`).

**Evaluation criteria.**
- `ω^n ≡ 1`.
- `ω^{n/2} ≡ p − 1` (the halving property), for `n ≥ 2`.
- Matches `pow(3, (p-1)//n, p)`.

---

### Task 3 — Recursive NTT multiply mod 998244353

**Problem.** Implement polynomial multiplication mod `998244353` using a **recursive** NTT (clarity over speed). Output the product coefficients.

**Input / Output spec.**
- Read `n`, `a` (`n` ints), `m`, `b` (`m` ints).
- Print the `n + m − 1` product coefficients.

**Constraints.** `1 ≤ n, m ≤ 2^{16}`, entries in `[0, p)`.

**Hint.** Pad to the next power of two `≥ n + m − 1`. Forward-transform both with `ω = g^{(p-1)/size}`, pointwise-multiply, inverse-transform with `ω^{-1}`, scale by `size^{-1}`. See `junior.md` for the recursive template.

**Evaluation criteria.**
- Matches Task 1's oracle on random small inputs.
- Correct `size^{-1}` scaling (no `size×` inflation).
- `k = 1`-length inputs handled (base case).

---

### Task 4 — Iterative in-place NTT multiply

**Problem.** Re-implement Task 3 with the **iterative** in-place NTT (bit-reversal + butterfly stages). This is the version you ship.

**Input / Output spec.** Same as Task 3.

**Constraints.** `1 ≤ n, m ≤ 2^{20}`, entries in `[0, p)`.

**Hint.** Bit-reversal permutation first; then stages `len = 2, 4, …, size` with stage root `wlen = g^{(p-1)/len}` (inverse uses `wlen^{-1}`); `n^{-1}` scaling after the inverse pass. The butterfly is `(u + w·v, u − w·v) mod p`. See `middle.md`.

**Evaluation criteria.**
- Identical output to Task 3 (recursive) on the same inputs.
- Matches the oracle for small `n`.
- Runs in `O(size log size)`; handles `size = 2^{20}` in well under a second (compiled languages).

---

### Task 5 — Round-trip and unit tests

**Problem.** Verify your iterative NTT with two property checks: (a) `intt(ntt(a)) == a` for random `a` padded to a power of two; (b) `multiply(a, [1]) == a` (convolving with the unit polynomial is the identity).

**Input / Output spec.**
- Read `n`, array `a`.
- Print `OK` if both checks pass, else print the first mismatch index.

**Constraints.** `1 ≤ n ≤ 2^{16}`.

**Hint.** The round-trip catches a missing or wrong `n^{-1}` scaling and a swapped `ω`/`ω^{-1}`. The unit test catches padding/trim bugs.

**Worked check.** For `a = [1, 2, 3, 0]` and any NTT-friendly prime, `intt(ntt(a))` must return `[1, 2, 3, 0]` exactly. If it returns `[4, 8, 12, 0]` you forgot the `n^{-1}` scaling (here `n = 4`); if it returns a permutation, you used `ω` instead of `ω^{-1}` in the inverse stages.

**Evaluation criteria.**
- Round-trip equals the original array exactly.
- `multiply(a, [1])` returns `a` unchanged (after trim).
- Reports a clear mismatch index on failure.

---

## Intermediate Tasks (5)

### Task 6 — Polynomial squaring (one transform saved)

**Problem.** Compute `A(x)²` mod `998244353` using a single forward NTT and a pointwise square (instead of transforming a polynomial twice).

**Input / Output spec.**
- Read `n`, array `a`.
- Print the `2n − 1` coefficients of `A²`.

**Constraints.** `1 ≤ n ≤ 2^{19}`, entries in `[0, p)`.

**Hint.** `ntt(a)`, then `a[i] = a[i]·a[i] mod p`, then `intt`. Saves one of the two forward transforms.

**Evaluation criteria.**
- Matches `multiply(a, a)` and the oracle for small `n`.
- Uses exactly one forward + one inverse transform.

---

### Task 7 — Arbitrary-modulus convolution via 3-prime CRT

**Problem.** Convolve `a`, `b` (entries up to `10^9`) and reduce each coefficient mod an arbitrary `M` (not necessarily NTT-friendly). Use three friendly primes + CRT.

**Input / Output spec.**
- Read `M`, `n`, `a`, `m`, `b`.
- Print the `n + m − 1` coefficients of the convolution mod `M`.

**Constraints.** `1 ≤ n, m ≤ 10^5`, entries in `[0, 10^9)`, `2 ≤ M ≤ 10^{18}`.

**Hint.** Primes `{998244353, 985661441, 469762049}` (all `g = 3`). For each prime run the iterative NTT; CRT-combine each coefficient to the exact integer (`< Πp_r`), reduce mod `M`. Assert `Πp_r > n·max|a|·max|b|`. Use Garner / big integers to avoid 64-bit overflow in the product (sibling `15-garner-algorithm`).

**Reference CRT (Python).**
```python
def crt(residues, primes):
    x, mod = 0, 1
    for r, p in zip(residues, primes):
        inv = pow(mod % p, -1, p)
        t = (r - x) % p * inv % p
        x += mod * t
        mod *= p
    return x
```

**Worked check.** With `a = [10^9, 10^9]`, `b = [10^9, 10^9]`, `M = 10^9+7`: the true convolution is `[10^{18}, 2·10^{18}, 10^{18}]`. A single prime (`< 10^9`) cannot hold `2·10^{18}`, so the 1-prime result is wrong; the 3-prime CRT recovers the exact integers, then reduces mod `M` to `[10^{18} mod M, 2·10^{18} mod M, 10^{18} mod M]`. Use this as the smoke test before larger inputs.

**Evaluation criteria.**
- Matches the oracle (computed with big integers) reduced mod `M`.
- Correct even when a coefficient exceeds a single prime.
- The CRT-bound assertion is present and passes for the given constraints.

---

### Task 8 — Big-integer multiplication via NTT

**Problem.** Multiply two non-negative big integers given as decimal strings. Convolve their digit arrays with NTT, then carry-propagate base 10.

**Input / Output spec.**
- Read two decimal strings `x`, `y`.
- Print `x · y` as a decimal string (no leading zeros, `"0"` for zero).

**Constraints.** `1 ≤ len(x), len(y) ≤ 2·10^5`.

**Hint.** Digits are `< 10`, so the max coefficient `< n·81 < 998244353` — a single prime suffices, no CRT. Least-significant digit first; after the inverse NTT, propagate carries and strip leading zeros.

**Reference oracle (Python).** `assert big_mul(x, y) == str(int(x) * int(y))`.

**Evaluation criteria.**
- Matches `int(x) * int(y)` for random and edge inputs.
- Handles `"0"`, single digits, and very long inputs.
- No carry-propagation or leading-zero bugs.

---

### Task 9 — Count pairs with a given sum (self-convolution)

**Problem.** Given an array `x` with values in `[0, V)`, for every sum `s ∈ [0, 2V−2]` count ordered pairs `(i, j)` (including `i = j`) with `x[i] + x[j] = s`, mod `998244353`. Use a single NTT self-convolution of the frequency array.

**Input / Output spec.**
- Read `V`, then `len`, then the `len` values.
- Print counts for `s = 0 … 2V−2`.

**Constraints.** `1 ≤ V ≤ 2·10^5`, `1 ≤ len ≤ 2·10^5`, values in `[0, V)`.

**Hint.** Build `f[v]` = frequency of value `v`; `(f ⊛ f)[s]` = number of ordered pairs summing to `s`. To count **unordered** pairs `i < j`, subtract the diagonal (`x[i]+x[i]`) and halve.

**Evaluation criteria.**
- Matches a brute `O(len²)` pair count for small inputs.
- Correct treatment of `i = j` (ordered vs unordered as specified).
- `O(V log V)`.

---

### Task 10 — Forbidden-substring / DP convolution

**Problem.** You are given two probability-like integer arrays representing step distributions; compute the distribution of the **sum of two independent steps** mod `p` (a convolution), and also the distribution of the sum of `t` independent steps via repeated convolution (binary-exponentiation of convolution).

**Input / Output spec.**
- Read `p` (an NTT-friendly prime), the array `a` (one step's weights), and `t`.
- Print the weights of the `t`-fold convolution `a^{⊛ t}`.

**Constraints.** `len(a) ≤ 2·10^4`, `1 ≤ t ≤ 10^9`, `p` NTT-friendly.

**Hint.** `a^{⊛ t}` = convolution of `a` with itself `t` times; use binary exponentiation over the convolution operation (square = self-convolve, multiply = convolve with base). The result length grows; cap or take it mod a fixed range if the problem bounds the support.

**Evaluation criteria.**
- `t = 1` returns `a`; `t = 2` matches `multiply(a, a)`.
- Matches repeated single convolutions for small `t`.
- `O(L log L · log t)` where `L` is the (capped) support size.

---

## Advanced Tasks (5)

### Task 11 — Polynomial inverse mod `x^k`

**Problem.** Given `A(x)` with `A(0) ≠ 0`, compute `B(x) = A(x)^{-1} mod x^k` (the power-series inverse) mod `998244353`, using Newton iteration with NTT as the multiply primitive.

**Input / Output spec.**
- Read `k`, then the first `k` coefficients of `A`.
- Print the `k` coefficients of `B` with `A·B ≡ 1 (mod x^k)`.

**Constraints.** `1 ≤ k ≤ 2^{18}`, `A[0]` invertible mod `p`.

**Hint.** Newton: `B_{2m} = B_m·(2 − A·B_m) mod x^{2m}`, doubling precision each step. Each step is two NTT multiplies. Start with `B[0] = A[0]^{-1}`. See sibling `20-polynomial-operations`.

**Evaluation criteria.**
- `A·B ≡ 1 (mod x^k)` verified by an oracle multiply.
- `O(k log k)` total (the doubling geometric series).
- Correct base case `B[0] = inv(A[0])`.

---

### Task 12 — Choose primes for a target modulus and coefficient bound

**Problem.** Implement `choose_primes(n, B, M)` returning the smallest set of NTT-friendly primes from a provided list whose product exceeds `n·B²` (and supports transform length `≥` the padded size), so that 3-prime-style CRT convolution mod `M` is exact.

**Input / Output spec.**
- Read `n` (max array length), `B` (max coefficient), `M`.
- Print the chosen primes and their product, and assert `product > n·B²`.

**Constraints.** `1 ≤ n ≤ 10^6`, `1 ≤ B ≤ 10^{12}`, `2 ≤ M ≤ 10^{18}`.

**Hint.** Iterate the primes/roots table from `middle.md`; accumulate the product (big integers) until it exceeds `n·B²`; also require each chosen prime's `2^k ≥` padded `n`. Report how many primes were needed and why.

**Evaluation criteria.**
- Returns enough primes that `Πp_r > n·B²` (with margin for signed coefficients if specified).
- Rejects primes whose `2^k` ceiling is below the padded size.
- Explains the count via the `n·B²` bound (cross-ref `senior.md` §4.4, `professional.md` Thm 8.2).

---

### Task 13 — Montgomery / Barrett butterfly benchmark

**Problem.** Implement two versions of the inner butterfly's modular multiply — naive `% p` and Montgomery (or Barrett) reduction — and benchmark a size-`2^{20}` NTT for both. Report the speedup.

**Input / Output spec.**
- Read the transform size `n` (power of two).
- Print mean wall-clock time (ms) for the naive and the Montgomery NTT, over ≥ 3 runs, and the speedup ratio.

**Constraints.** `n` up to `2^{21}`; fixed seed for the random input.

**Hint.** Montgomery: keep residues in Montgomery form `a·R mod p` (`R = 2^{32}`), convert in/out at the boundaries, reduce products with the REDC multiply-add-shift. Validate both produce identical coefficients before timing. See sibling `14-montgomery-multiplication`.

**Evaluation criteria.**
- Both versions produce identical output (validated against each other and the naive version).
- Montgomery/Barrett is measurably faster on the hot path.
- Same seed → same input across Go, Java, Python; timing excludes input generation.

---

### Task 14 — CRT correctness stress test (detect under-provisioning)

**Problem.** Demonstrate the silent failure of using **too few** CRT primes. With a 2-prime CRT (product `~10^{18}`), construct inputs where the true coefficient exceeds the product and show the reconstruction wraps to a wrong value; then show the 3-prime version is correct.

**Input / Output spec.**
- Read `n`, `B` (so coefficients reach `~n·B²`).
- Print: the 2-prime reconstructed coefficient, the true coefficient, and whether they differ; then the 3-prime reconstructed coefficient and that it matches.

**Constraints.** Choose `n`, `B` so `n·B² > p1·p2` but `< p1·p2·p3`.

**Hint.** Use constant arrays (e.g. all `B`) so the middle coefficient is exactly `min(n,·)·B²` and easy to predict. The 2-prime result is `true_c mod (p1·p2)`, which differs when `true_c ≥ p1·p2`.

**Evaluation criteria.**
- Clearly exhibits the 2-prime wrap (reconstructed ≠ true).
- 3-prime reconstruction matches the true coefficient.
- Writeup ties the failure to `Πp_r > n·B²` (`professional.md` Thm 8.2).

---

### Task 15 — Decide the right convolution method

**Problem.** Implement `classify(n, M, exact, coeff_bound)` returning one of: `SCHOOLBOOK` (tiny `n`), `SINGLE_NTT` (friendly `M`), `MULTI_PRIME_CRT` (arbitrary `M`, exact, integers), `FFT_SPLIT` (arbitrary `M`, approximate-ok or FP toolchain), or `INFEASIBLE_SIZE` (`n` exceeds best prime's `2^k` without blocking). Justify each.

**Constraints / cases.**
- Tiny `n` (≤ ~64) → `SCHOOLBOOK`.
- `M` NTT-friendly → `SINGLE_NTT`.
- Arbitrary `M`, exactness required → `MULTI_PRIME_CRT`.
- Arbitrary `M`, FP acceptable / existing FFT path → `FFT_SPLIT`.
- Padded `n` > `2^{27}` (largest table prime) without block-convolution → `INFEASIBLE_SIZE`.

**Hint.** Encode the decision table from `middle.md` and `senior.md`. The friendly-prime check: `(M − 1)` divisible by a sufficient `2^k`. The size check: padded length `≤ 2^k` of the best available prime.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Friendly-prime test is correct (checks `2^k | M − 1`).
- Justification cites the correct complexity and the CRT bound where relevant.

---

### Task 16 — Multipoint evaluation via NTT (stretch)

**Problem.** Given a polynomial `A(x)` of degree `< d` and `m` evaluation points `x_0, …, x_{m-1}`, compute `A(x_i)` for all `i` mod `998244353` in `O((d + m) log²)` using the product-tree / remainder-tree algorithm, with NTT as the multiply primitive.

**Input / Output spec.**
- Read `d`, the `d` coefficients, `m`, the `m` points.
- Print `A(x_0), …, A(x_{m-1})`.

**Constraints.** `1 ≤ d, m ≤ 2^{16}`.

**Hint.** Build a binary product tree of the linear factors `(x − x_i)`; descend computing `A mod (subtree product)` via polynomial remainder (which uses NTT-based multiply and inverse). At the leaves, the remainder mod `(x − x_i)` is the constant `A(x_i)`. See sibling `20-polynomial-operations` for division/inverse. This is an advanced application; validate against naive `O(d·m)` Horner evaluation on small inputs.

**Evaluation criteria.**
- Matches Horner evaluation at every point for small `d, m`.
- Uses NTT multiply inside the remainder tree (not schoolbook).
- Correct base case (remainder mod a linear factor is the evaluation).

---

## Benchmark Task

### Task B — Schoolbook vs NTT crossover

**Problem.** Empirically find the input size `n` at which NTT overtakes schoolbook convolution mod `998244353`. Implement both, run on random arrays (fixed seed), and report a timing table.

**Workloads.**
- **(a) Schoolbook:** `O(n²)` double loop mod `p`.
- **(b) Iterative NTT multiply:** `O(n log n)`.

Measure wall-clock for `n ∈ {16, 64, 256, 1024, 4096, 16384, 65536}` (schoolbook only where it finishes quickly). Report the crossover `n`.

**Starter — Python.**
```python
import random
import time

MOD = 998244353


def gen(n, seed):
    r = random.Random(seed)
    return [r.randrange(MOD) for _ in range(n)]


def schoolbook(a, b):
    # TODO: O(n^2) mod MOD
    return [0] * (len(a) + len(b) - 1)


def ntt_multiply(a, b):
    # TODO: iterative NTT, O(n log n)
    return a


def bench(fn, *args, runs=3):
    best = []
    for _ in range(runs):
        t = time.perf_counter()
        fn(*[x[:] if isinstance(x, list) else x for x in args])
        best.append(time.perf_counter() - t)
    return sum(best) / len(best) * 1000.0


def main():
    print("n        schoolbook_ms   ntt_ms")
    for n in [16, 64, 256, 1024, 4096, 16384, 65536]:
        a, b = gen(n, 1), gen(n, 2)
        nm = bench(ntt_multiply, a, b)
        if n <= 4096:
            sm = bench(schoolbook, a, b)
            print(f"{n:<8d} {sm:<15.2f} {nm:<10.2f}")
        else:
            print(f"{n:<8d} {'(skipped)':<15} {nm:<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed → same arrays across Go, Java, Python.
- Schoolbook wins for tiny `n`; NTT wins for large `n`. Report the measured crossover.
- NTT completes `n = 65536` in well under a second (compiled languages); schoolbook is infeasible there.
- Report includes the mean across ≥ 3 runs and excludes array generation from timing.
- Writeup: measured crossover `n` vs the theoretical (`n` vs `log n`, typically a few hundred).

**Interpretation note.** The crossover depends on the language and the reduction strategy: interpreted Python crosses earlier (its per-operation overhead is large, so the `O(n²)` loop hurts sooner), while a compiled language with a tight schoolbook loop pushes the crossover higher (the small-`n` constant favors the simple loop). Report your environment alongside the number, and expect the NTT to dominate decisively once `n` exceeds ~`10³`.

---

## General Guidance for All Tasks

- **Always validate against the schoolbook oracle first.** Run it on small inputs (and under each CRT prime), diff coefficient-by-coefficient, then trust the NTT version on large inputs.
- **Pin `(MOD, G)` and the prime set as named constants.** Use the primes/roots table from `middle.md`; never inline magic primes.
- **Pad to a power of two `≥ len(a)+len(b)−1`.** Under-padding silently produces the cyclic (wrapped) convolution.
- **Never forget the `n^{-1}` scaling** after the inverse transform — the round-trip test (Task 5) catches it.
- **Use `ω^{-1}` in the inverse transform**, not `ω`. Build it via Fermat (`pow(ω, p-2)`).
- **Mind overflow.** Keep primes `< 2^31` so butterfly products fit `int64`; for the 3-prime CRT product (`> 10^{27}`), use Garner or big integers (`15-garner-algorithm`).
- **Choose the route by modulus:** friendly `M` → single NTT; non-friendly `M` → multi-prime + CRT; tiny `n` → schoolbook.
- **Verify the root at setup.** Assert `ω^{n/2} ≡ p − 1` (the halving property); a wrong `g` or an `n` beyond the prime's `2^k` ceiling fails this check instantly and cheaply.
- **Compute the prime count, do not guess it.** Accumulate the product until it exceeds `n·max|a|·max|b|`; under-provisioning fails silently only at large `n` (Task 14 demonstrates this trap).
- **Reuse the `ntt`/`multiply` pair.** Most bugs live in `ntt`; write it once, test it hard (round-trip, unit, oracle), and parameterize by `(p, g)`.

## Difficulty Ladder

The tasks build deliberately:

1. **Beginner (1–5):** the oracle, the root, recursive then iterative NTT, and the test harness — the irreducible toolkit. Do not proceed until Task 4 matches Task 1 and Task 5 passes.
2. **Intermediate (6–10):** real applications — squaring, arbitrary-modulus CRT, big-int multiply, pair counting, repeated convolution. These exercise the number-theory layer (friendly primes, CRT bound) on top of a correct transform.
3. **Advanced (11–16):** the polynomial-algebra and systems layer — Newton inverse, prime selection, Montgomery benchmarking, the CRT under-provisioning trap, method classification, and multipoint evaluation.

Tasks 7, 12, and 14 are the heart of the *number-theory* content (CRT, prime selection, the reconstruction bound); Tasks 4, 11, 13, and 16 are the *engineering* content (iterative transform, Newton doubling, fast reduction, product trees). A complete solution set demonstrates both, and every task ships a verifiable invariant (oracle match, round-trip, or CRT bound) so correctness is checkable, not assumed.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
