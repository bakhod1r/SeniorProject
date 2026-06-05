# Polynomial Operations (over a Field, especially mod p) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the polynomial logic and validate against the evaluation criteria.
> **Always use a prime modulus (`998244353`) so inverses exist, and test multiply/division against a schoolbook oracle on small inputs before trusting fast code.**

---

## Beginner Tasks (5)

### Task 1 — Add and scale polynomials mod p

**Problem.** Implement `add(A, B, p)` and `scale(A, c, p)` for coefficient arrays over `F_p`. `add` pads the shorter array with zeros; `scale` multiplies every coefficient by `c`. Reduce mod `p` after each operation.

**Input / Output spec.**
- Read `n`, then `A` (`n` ints); read `m`, then `B` (`m` ints); read scalar `c`.
- Print `add(A, B)` then `scale(A, c)`, each space-separated.

**Constraints.** `1 ≤ n, m ≤ 10^5`, entries in `[0, p)`, `p = 10^9 + 7`.

**Hint.** Treat missing indices as `0`. Subtraction (if you add it) must normalize non-negative.

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func add(a, b []int64) []int64 {
	// TODO: pad shorter, add element-wise mod MOD
	return nil
}

func scale(a []int64, c int64) []int64 {
	// TODO: multiply each coeff by c mod MOD
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
	var c int64
	fmt.Scan(&c)
	for _, v := range add(a, b) {
		fmt.Print(v, " ")
	}
	fmt.Println()
	for _, v := range scale(a, c) {
		fmt.Print(v, " ")
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final long MOD = 1_000_000_007L;

    static long[] add(long[] a, long[] b) {
        // TODO
        return null;
    }

    static long[] scale(long[] a, long c) {
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
        long c = sc.nextLong();
        System.out.println(Arrays.toString(add(a, b)));
        System.out.println(Arrays.toString(scale(a, c)));
    }
}
```

**Starter — Python.**
```python
import sys

MOD = 1_000_000_007


def add(a, b):
    # TODO
    return []


def scale(a, c):
    # TODO
    return []


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    a = [int(next(data)) for _ in range(n)]
    m = int(next(data))
    b = [int(next(data)) for _ in range(m)]
    c = int(next(data))
    print(*add(a, b))
    print(*scale(a, c))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct element-wise add with padding.
- `scale` reduces mod `p`.
- No overflow (64-bit before `% MOD`).

---

### Task 2 — Schoolbook multiplication mod p

**Problem.** Implement `multiply(A, B, p)` returning the convolution `(A·B)[k] = Σ_{i+j=k} A[i]·B[j] mod p`. Output length is `len(A)+len(B)−1`.

**Input / Output spec.**
- Read `n`, `A`, then `m`, `B`.
- Print the product coefficients, space-separated.

**Constraints.** `1 ≤ n, m ≤ 2000`, `p = 998244353`.

**Hint.** Double loop, `i, j`; reduce after each accumulation; skip `A[i] == 0`.

**Reference oracle (Python).**
```python
def brute_mul(a, b, mod=998244353):
    r = [0] * (len(a) + len(b) - 1)
    for i in range(len(a)):
        for j in range(len(b)):
            r[i + j] = (r[i + j] + a[i] * b[j]) % mod
    return r
```

**Evaluation criteria.**
- Matches `brute_mul` and direct hand expansion on a `2×2` example.
- Correct product length `n+m−1`.
- `O(n·m)`.

---

### Task 3 — Horner evaluation at a point

**Problem.** Given `A` and a point `x0`, compute `A(x0) mod p` using Horner's rule.

**Input / Output spec.**
- Read `n`, `A`, then `x0`. Print `A(x0) mod p`.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ x0 < p`, `p = 998244353`.

**Hint.** `acc = 0`; for `i` from high to low: `acc = (acc*x0 + A[i]) % p`.

**Worked check.** For `A = [3, 5, 2]` (`3+5x+2x²`) and `x0 = 2`, the answer is `21`. For any `A`, `A(0) = A[0]`.

**Evaluation criteria.**
- `A(0)` equals the constant term.
- Matches the naive `Σ A[i]·x0^i mod p` for small inputs.
- `O(n)` — no recomputing powers of `x0`.

---

### Task 4 — Formal derivative

**Problem.** Given `A`, output its formal derivative `A'` where `A'[i−1] = i·A[i] mod p`.

**Input / Output spec.**
- Read `n`, `A`. Print `A'` (length `n−1`, or `[0]` if `n ≤ 1`).

**Constraints.** `1 ≤ n ≤ 10^5`, `p = 998244353`.

**Hint.** `A'[i-1] = (i * A[i]) % p` for `i ≥ 1`. The constant term drops out.

**Worked check.** For `A = [3, 5, 2]` (`3+5x+2x²`), `A' = [5, 4]` (`5 + 4x`).

**Evaluation criteria.**
- Constant polynomial → derivative `[0]`.
- `A'[i-1] = i·A[i]` reduced mod `p`.
- `O(n)`.

---

### Task 5 — Evaluate at multiple points (naive Horner loop)

**Problem.** Given `A` and a list of query points `xs`, output `A(x) mod p` for each `x` using Horner once per point.

**Input / Output spec.**
- Read `n`, `A`, then `q`, then `q` query points.
- Print the `q` answers, space-separated.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ q ≤ 2000`, `p = 998244353`.

**Hint.** Reuse your Task 3 Horner. Total cost `O(n·q)`. (For large `n` and `q`, multipoint evaluation is `O(n log² n)` — see Task 13.)

**Evaluation criteria.**
- Each answer matches a single Horner evaluation.
- Handles `q` points without recomputing the polynomial.
- `O(n·q)`.

---

## Intermediate Tasks (5)

### Task 6 — Long division with remainder

**Problem.** Given `A` and `B` (`B ≠ 0`) over `F_p`, output `(Q, R)` with `A = B·Q + R`, `deg R < deg B`. The modulus is prime so `lc(B)` is invertible.

**Input / Output spec.**
- Read `A`, then `B`. Print `Q` on one line, `R` on the next.

**Constraints.** `1 ≤ len(A), len(B) ≤ 2000`, `p = 998244353`.

**Hint.** Compute `modinv(B[-1])` via Fermat (`pow(b, p-2, p)`). For `k` from `deg A − deg B` down to `0`, set quotient coefficient and subtract a scaled shift of `B` from the running remainder.

**Reference oracle (Python).**
```python
def verify_divmod(A, B, Q, R, mod=998244353):
    # check A == B*Q + R and deg R < deg B
    prod = brute_mul(B, Q, mod)
    while len(prod) < max(len(A), len(R)):
        prod.append(0)
    s = [(prod[i] + (R[i] if i < len(R) else 0)) % mod for i in range(len(prod))]
    a = [(A[i] if i < len(A) else 0) % mod for i in range(len(prod))]
    return s == a and (len(R) < len(B) or all(c == 0 for c in R))
```

**Evaluation criteria.**
- `A == B·Q + R` and `deg R < deg B` (use the oracle).
- Returns `Q = [0], R = A` when `deg A < deg B`.
- `O(n·m)`.

---

### Task 7 — Lagrange interpolation: value at a point

**Problem.** Given `n+1` points with distinct `x_i` and a target `x*`, compute `P(x*) mod p` for the unique degree-`≤ n` interpolant.

**Input / Output spec.**
- Read `k` (= number of points), then `k` pairs `(x_i, y_i)`, then `x*`. Print `P(x*) mod p`.

**Constraints.** `1 ≤ k ≤ 2000`, distinct `x_i`, `p = 998244353`.

**Hint.** `P(x*) = Σ_i y_i · Π_{j≠i}(x* − x_j)/(x_i − x_j)`. Compute each term's numerator and denominator products, then `num · modinv(den)`.

**Worked check.** Points on `x²+1`: `(0,1),(1,2),(2,5)`; `P(3) = 10`. Evaluating at any input node returns that node's `y_i`.

**Evaluation criteria.**
- Re-evaluating at an input `x_i` returns `y_i`.
- Matches the known polynomial on test cases.
- Asserts distinct `x_i`.

---

### Task 8 — Newton divided differences (incremental)

**Problem.** Build the Newton form (divided-difference coefficients) for `n+1` points, then support evaluating `P(x)` and **adding a new point** in `O(n)`.

**Input / Output spec.**
- Read points, build coefficients; read a target `x` and print `P(x)`; then read a new point, add it, and print the updated `P(x)` at the same target.

**Constraints.** `1 ≤ k ≤ 2000`, distinct `x_i`, `p = 998244353`.

**Hint.** `c[i]` is `f[x_0,…,x_i]`. Build the table in `O(n²)`. Evaluate with the nested form `acc = acc·(x − x_i) + c[i]` over the `x_i` high→low. Adding a point appends one `c` and one node.

**Evaluation criteria.**
- Matches Lagrange on the same points.
- Adding a point costs `O(n)`, not a full rebuild.
- Re-evaluation at input nodes recovers `y_i`.

---

### Task 9 — Polynomial GCD (monic)

**Problem.** Given `A` and `B` over `F_p`, output their monic GCD via the Euclidean algorithm.

**Input / Output spec.**
- Read `A`, then `B`. Print the monic GCD.

**Constraints.** `1 ≤ len(A), len(B) ≤ 2000`, `p = 998244353`.

**Hint.** `while B ≠ 0: (A, B) = (B, A mod B)`; then divide by the leading coefficient to make monic. Reuse the Task 6 remainder.

**Worked check.** `A = (x−1)(x−2) = x²−3x+2`, `B = (x−1)(x−3) = x²−4x+3` → monic GCD `x − 1`. `gcd(A, A) = monic(A)`.

**Evaluation criteria.**
- Result is monic and divides both inputs.
- Matches a brute-force common-factor check on small inputs.
- Terminates (remainder degree strictly decreases).

---

### Task 10 — Square-free detection via gcd(P, P')

**Problem.** Decide whether `P` is square-free (no repeated factor) by testing whether `gcd(P, P')` is a nonzero constant. Output `SQUARE_FREE` or `HAS_REPEATED_FACTOR`.

**Input / Output spec.**
- Read `P`. Print the verdict.

**Constraints.** `1 ≤ len(P) ≤ 2000`, `p = 998244353`, and `p > deg P` (so the derivative criterion is valid).

**Hint.** Compute `P'` (Task 4), then `gcd(P, P')` (Task 9). If the GCD has degree 0 (a constant), `P` is square-free; otherwise it has a repeated factor.

**Worked check.** `(x−1)² = x²−2x+1` → `HAS_REPEATED_FACTOR`. `(x−1)(x−2)` → `SQUARE_FREE`.

**Evaluation criteria.**
- Correct on `(x−1)²` (repeated) and `(x−1)(x−2)` (square-free).
- Uses the `gcd(P, P')` criterion, not factorization.
- Documents the `p > deg P` requirement in a comment.

---

## Advanced Tasks (5)

### Task 11 — NTT-based multiplication for large degree

**Problem.** Multiply two polynomials of degree up to `2·10^5` over `F_p` (`p = 998244353`) in `O(n log n)` using the Number-Theoretic Transform.

**Constraints.** `1 ≤ len(A), len(B) ≤ 2·10^5`, `p = 998244353`.

**Hint.** Pad to a power of two `≥ deg(A)+deg(B)+1`. Forward-NTT both, multiply pointwise, inverse-NTT (remember to scale by the inverse of the length). The primitive root is `3` for `998244353`. See sibling `15-ntt` for the transform details.

**Evaluation criteria.**
- Matches schoolbook `brute_mul` (Task 2 oracle) on random inputs up to length ~2000.
- Correct inverse-transform scaling (no all-coefficients-times-`n` bug).
- Runs in well under a second for length `2·10^5`.
- Pads to the next power of two, not a non-power-of-two length.

---

### Task 12 — Series inverse mod x^n via Newton iteration

**Problem.** Given `A` with `A(0) ≠ 0`, compute `B` with `A·B ≡ 1 (mod x^n)`, using Newton's doubling iteration on top of your multiply.

**Constraints.** `1 ≤ n ≤ 10^5`, `A[0] ≠ 0`, `p = 998244353`.

**Hint.** Start `B = [modinv(A[0])]`. Double precision: `B ← B·(2 − A·B) mod x^{2t}`. Truncate to `x^n` at the end. Use NTT multiply (Task 11) for `O(n log n)`.

**Reference oracle (Python).**
```python
def verify_inverse(A, B, n, mod=998244353):
    prod = brute_mul(A[:n], B[:n], mod)[:n]
    return prod[0] % mod == 1 and all(c % mod == 0 for c in prod[1:])
```

**Evaluation criteria.**
- `A·B ≡ 1 (mod x^n)` (use the oracle).
- Fails fast / asserts when `A[0] == 0`.
- `O(n log n)` with NTT multiply; `log₂ n` doubling steps.

---

### Task 13 — Multipoint evaluation (subproduct tree)

**Problem.** Evaluate `P` (degree `< n`) at `n` arbitrary points in `O(n log² n)` using a subproduct tree, instead of `O(n²)` Horner-per-point.

**Constraints.** `1 ≤ n ≤ 5·10^4`, distinct or repeated points allowed, `p = 998244353`.

**Hint.** Build a tree whose leaves are `(x − x_i)` and internal nodes are products of children (root = `Π(x − x_i)`). Recursively take `P mod (left subtree)` and `P mod (right subtree)` down the tree; at each leaf the remaining constant is `P(x_i)`. Uses fast multiply and fast division.

**Evaluation criteria.**
- Matches naive Horner-per-point (Task 5) for small `n`.
- `O(n log² n)` — does not degrade to `O(n²)`.
- Correct for repeated query points.

---

### Task 14 — Fast interpolation from n points

**Problem.** Given `n` points with distinct `x_i`, recover the coefficient array of the unique degree-`< n` interpolant in `O(n log² n)`.

**Constraints.** `1 ≤ n ≤ 5·10^4`, distinct `x_i`, `p = 998244353`.

**Hint.** Build the subproduct tree (Task 13). Compute the master polynomial `M = Π(x − x_i)` and its derivative `M'`; multipoint-evaluate `M'` at the nodes to get the Lagrange denominators `d_i = M'(x_i)`. Then combine `y_i / d_i` bottom-up through the tree.

**Evaluation criteria.**
- Re-evaluating the recovered polynomial at the input nodes returns the `y_i`.
- Matches `O(n²)` Lagrange/Newton on small inputs.
- `O(n log² n)`.

---

### Task 15 — Decide the right polynomial tool

**Problem.** Given a problem's parameters `(operation, degree n, query_count, modulus_prime?)`, return one of: `SCHOOLBOOK`, `NTT`, `KARATSUBA`, `NEWTON_SERIES`, `SUBPRODUCT_TREE`, or `NEEDS_PRIME_MODULUS`. Justify each decision.

**Constraints / cases to handle.**
- Multiply, small `n` (≤ ~2000) → `SCHOOLBOOK`.
- Multiply, medium `n` → `KARATSUBA`.
- Multiply, large `n`, prime modulus → `NTT`.
- Series inverse/log/exp/sqrt → `NEWTON_SERIES`.
- Multipoint eval / interpolation of many points → `SUBPRODUCT_TREE`.
- Division/GCD/interpolation requested over a *composite* modulus → `NEEDS_PRIME_MODULUS`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is the composite-modulus case: division needs inverses, which require a prime.

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `NEEDS_PRIME_MODULUS` branch explicitly cites that inverses (hence division/GCD/interpolation) require a field.
- Justification references the right complexity (`O(n²)`, `O(n^1.585)`, `O(n log n)`, `O(n log² n)`).

---

## Benchmark Task

### Task B — Schoolbook vs NTT crossover

**Problem.** Empirically find the degree `n` at which NTT multiplication overtakes schoolbook for polynomials over `F_p`. Implement two multipliers and time them:

- **(a) Schoolbook:** `O(n²)` convolution with zero-skip.
- **(b) NTT:** `O(n log n)` (Task 11).

Measure wall-clock time for `n ∈ {64, 256, 1024, 4096, 16384, 65536}` on random coefficient arrays (fixed seed). Report a table and identify the crossover `n`.

**Starter — Python.**
```python
import random
import time
from typing import List

MOD = 998244353


def gen_poly(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randrange(MOD) for _ in range(n)]


def schoolbook(a, b):
    # TODO: O(n^2) convolution mod MOD, zero-skip
    return [0] * (len(a) + len(b) - 1)


def ntt_mul(a, b):
    # TODO: O(n log n) NTT-based multiply mod MOD
    return [0] * (len(a) + len(b) - 1)


def bench(fn, a, b) -> float:
    start = time.perf_counter()
    fn(a, b)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n        schoolbook_ms      ntt_ms")
    for n in [64, 256, 1024, 4096, 16384, 65536]:
        a = gen_poly(n, 1)
        b = gen_poly(n, 2)
        ntt_runs = [bench(ntt_mul, a[:], b[:]) for _ in range(3)]
        if n <= 4096:
            sb_runs = [bench(schoolbook, a[:], b[:]) for _ in range(3)]
            print(f"{n:<8d} {mean_ms(sb_runs):<18.2f} {mean_ms(ntt_runs):<10.2f}")
        else:
            print(f"{n:<8d} {'(skipped)':<18} {mean_ms(ntt_runs):<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same polynomials across Go, Java, and Python.
- Schoolbook (a) wins for small `n`; NTT (b) wins for large `n`. Report the crossover `n`.
- NTT completes for `n = 65536` in well under a second; schoolbook is infeasible there.
- Both multipliers agree on outputs for `n` up to ~2000.
- Report includes the mean across at least 3 runs and does not time generation or cloning.

---

### Task B2 — Newton-series round-trip stress test

**Problem.** Validate a series-operation library by round-trip identities on random inputs: for random `A` with the right constant term, check `A·inverse(A) ≡ 1`, `exp(log(A)) ≡ A` (with `A(0) = 1`), and `sqrt(A)² ≡ A` (with `A(0)` a quadratic residue), all mod `x^n`.

**Constraints.** `1 ≤ n ≤ 10^4`, `p = 998244353`.

**Hint.** Generate `A` with the required constant term, run the operation, and verify the identity coefficient-by-coefficient. A single failing coefficient localizes the bug (e.g. a missing inverse-transform scaling shows every coefficient off by a factor of the transform length).

**Evaluation criteria.**
- All three round-trips hold for random inputs at several `n`.
- The harness reports the first failing coefficient index when an identity breaks.
- Runs in `O(n log n)` per check with NTT multiply.
- Cross-language identical results on the same seed.

---

## General Guidance for All Tasks

- **Always use a prime modulus.** `998244353` if NTT may follow; `10^9 + 7` otherwise. Division, GCD, and interpolation all require modular inverses, which exist for every nonzero element only over a field.
- **Pin the modulus as a named constant.** Never inline magic numbers.
- **Get the product length right.** `len(A·B) = len(A) + len(B) − 1`; off-by-one here leaves a stray trailing zero.
- **Normalize / trim trailing zeros** before reading the degree, especially after subtraction in division and GCD.
- **Mind overflow.** In Go/Java cast to 64-bit before multiplying, then reduce; normalize subtraction non-negative.
- **Validate against the schoolbook oracle.** Every multiply/division/interpolation task above ships with (or references) a slow oracle; diff coefficient-by-coefficient on small inputs before trusting fast code on large inputs.
- **Watch series preconditions.** Inverse needs `A(0) ≠ 0`; `exp` needs `A(0) = 0`; `log` needs `A(0) = 1`; `sqrt` needs `A(0)` a quadratic residue.
- **Round-trip to self-verify.** When no external oracle exists at scale, check identities like `A·A^{-1} ≡ 1`, `exp(log A) ≡ A`, and `B·Q + R ≡ A`; a broken identity pinpoints the failing operation.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
