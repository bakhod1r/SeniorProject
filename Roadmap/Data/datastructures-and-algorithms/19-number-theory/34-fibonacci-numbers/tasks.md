# Fibonacci Numbers — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages.
> **Always test against a brute-force `O(n)` loop oracle on small `n` before trusting a fast method on huge `n`.**

---

## Beginner Tasks (5)

### Task 1 — Bottom-up Fibonacci loop

**Problem.** Implement `fib(n)` returning `F(n)` (exact, no modulus) using the two-variable bottom-up loop. `F(0)=0, F(1)=1`.

**Input / Output spec.**
- Read `n`. Print `F(n)`.

**Constraints.** `0 ≤ n ≤ 90` (so the exact value fits in `int64`).

**Hint.** Keep `a = F(i-1)`, `b = F(i)`; each step `a, b = b, a + b`. Handle `n < 2` directly.

**Starter — Go.**
```go
package main

import "fmt"

func fib(n int) int64 {
	// TODO: two-variable loop, O(n) time O(1) space
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(fib(n))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task1 {
    static long fib(int n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(fib(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
def fib(n):
    # TODO: two-variable loop
    return 0


if __name__ == "__main__":
    print(fib(int(input())))
```

**Evaluation criteria.**
- `F(0)=0, F(1)=1, F(10)=55, F(20)=6765, F(90)=2880067194370816120`.
- `O(n)` time, `O(1)` space (no array).
- Correct base cases.

---

### Task 2 — Naive recursion vs memoization

**Problem.** Implement both `fib_naive(n)` (direct recursion) and `fib_memo(n)` (memoized). Count and print the number of function calls each makes for `n = 30`, demonstrating the exponential-vs-linear difference.

**Input / Output spec.**
- Read `n`. Print `F(n)`, the naive call count, and the memoized call count.

**Constraints.** `0 ≤ n ≤ 35` (keep the naive version feasible).

**Hint.** The naive call count is `2·F(n+1) − 1`. Memoization makes it `O(n)`. Use a global/instance counter or a cache size.

**Evaluation criteria.**
- Both return the same `F(n)`.
- Naive call count matches `2·F(n+1) − 1`.
- Memoized count is `O(n)` (about `2n − 1` calls).

---

### Task 3 — Modular Fibonacci loop

**Problem.** Compute `F(n) mod m` using the loop, reducing every step. The modulus may be **any** positive integer (not necessarily prime).

**Input / Output spec.**
- Read `n`, `m`. Print `F(n) mod m`.

**Constraints.** `0 ≤ n ≤ 10^7`, `1 ≤ m ≤ 10^9`.

**Hint.** `b = (a + b) % m` each step. No division is needed, so any `m` works.

**Reference oracle (Python).**
```python
def fib_mod_loop(n, m):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, (a + b) % m
    return a % m
```

**Evaluation criteria.**
- `F(10) mod 7 = 6`, `F(100) mod 10 = 5`.
- Works for composite `m` (e.g. `m = 12`).
- `O(n)`; never forms the full number.

---

### Task 4 — Fibonacci table and prefix sum

**Problem.** Given `n`, build the array `F(0..n)` and also compute the prefix sum `S(n) = Σ_{i=0}^{n} F(i)`. Verify `S(n) = F(n+2) − 1`.

**Input / Output spec.**
- Read `n`. Print the array `F(0..n)` and `S(n)`.

**Constraints.** `0 ≤ n ≤ 90`.

**Hint.** Fill the array bottom-up. Confirm `S(n)` two ways: summing the array, and `F(n+2) − 1`.

**Evaluation criteria.**
- Array matches `0,1,1,2,3,5,8,…`.
- `S(5) = 12 = F(7) − 1 = 13 − 1`.
- Both prefix-sum computations agree.

---

### Task 5 — Detect overflow

**Problem.** Find the largest `n` for which `F(n)` fits in a signed 32-bit integer, and the largest for signed 64-bit, by computing iteratively and checking for overflow/wraparound (in Go/Java) or comparing against the limit (in Python).

**Input / Output spec.**
- Print the two thresholds.

**Constraints.** None — this is a discovery task.

**Hint.** `F(46) = 1836311903` fits int32; `F(47) = 2971215073` does not. `F(92)` fits int64; `F(93)` does not. In Go/Java, detect overflow by checking that the sum did not decrease.

**Evaluation criteria.**
- Reports `n = 46` (int32) and `n = 92` (int64).
- Explains *why* (Fibonacci grows like `φ^n`).
- The Python version compares against `2^31 − 1` and `2^63 − 1`.

---

## Intermediate Tasks (5)

### Task 6 — Fast doubling (recursive)

**Problem.** Implement `fib(n)` returning `F(n) mod 10^9 + 7` using the fast-doubling identities `F(2k) = F(k)(2F(k+1) − F(k))` and `F(2k+1) = F(k)² + F(k+1)²`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** Recurse on `n >> 1` to get `(F(k), F(k+1))`, apply the identities, and branch on the parity of `n`. **Normalize the subtraction** `2b − a` to a non-negative residue.

**Reference oracle (Python).**
```python
def fib_loop(n, m=10**9 + 7):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, (a + b) % m
    return a
```

**Evaluation criteria.**
- `F(10)=55, F(20)=6765, F(100) mod 10^9+7 = 687995182`.
- Matches `fib_loop` for `n ≤ 2000`.
- `O(log n)`; instant for `n = 10^18`.

---

### Task 7 — Fast doubling (iterative, no recursion stack)

**Problem.** Reimplement Task 6 iteratively by scanning the bits of `n` from most-significant to least-significant, maintaining `(F(k), F(k+1))`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** For each bit: double the pair via the identities, then if the bit is 1, advance one Fibonacci step. No recursion — `O(1)` extra space beyond the pair.

**Evaluation criteria.**
- Identical outputs to the recursive version (Task 6).
- No recursion (verify with a deep `n`).
- `O(log n)`.

---

### Task 8 — Matrix exponentiation

**Problem.** Compute `F(n) mod 10^9 + 7` using the `2×2` matrix `[[1,1],[1,0]]` and binary exponentiation. Read `F(n)` from entry `[0][1]` of `M^n`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** `M^0 = I` (start `result = I`). Reduce mod `p` in every multiply. Verify `M^n = [[F(n+1),F(n)],[F(n),F(n-1)]]`.

**Evaluation criteria.**
- Matches the fast-doubling solution on the same inputs.
- Correct `M^0 = I` base case (test `n = 0 → 0`).
- `O(log n)`.

---

### Task 9 — Pisano period

**Problem.** Implement `pisano(m)` returning the Pisano period of `F(n) mod m` (the smallest `k > 0` with `F(k) ≡ 0` and `F(k+1) ≡ 1 mod m`).

**Constraints.** `1 ≤ m ≤ 10^6`.

**Hint.** Iterate the modular recurrence until the pair `(0, 1)` returns; bound the search by `6m`. Verify `pisano(2)=3`, `pisano(5)=20`, `pisano(10)=60`.

**Reference oracle (Python).**
```python
def pisano(m):
    a, b = 0, 1
    for i in range(1, 6 * m + 1):
        a, b = b, (a + b) % m
        if (a, b) == (0, 1):
            return i
```

**Evaluation criteria.**
- `pisano(2)=3, pisano(3)=8, pisano(5)=20, pisano(10)=60`.
- Search bounded by `6m`.
- Multiplicativity check: `pisano(10) == lcm(pisano(2), pisano(5))`.

---

### Task 10 — Batched modular queries via Pisano period

**Problem.** Given a fixed modulus `m` and `Q` queries `n_i` (each up to `10^18`), answer all `F(n_i) mod m` using a single tabulated Pisano period.

**Constraints.** `1 ≤ m ≤ 10^6`, `1 ≤ Q ≤ 10^5`.

**Hint.** Compute `π(m)` once, build the period table once (`O(π(m))`), then answer each query as `table[n_i mod π(m)]` in `O(1)`.

**Evaluation criteria.**
- Period and table built exactly once.
- Each query `O(1)` after preprocessing.
- Matches per-query fast doubling for all queries.

---

## Advanced Tasks (5)

### Task 11 — Exact big-integer Fibonacci

**Problem.** Compute the **exact** `F(n)` (no modulus) for `n` up to `10^5` using fast doubling with arbitrary-precision integers. Print the number of decimal digits and the first/last few digits.

**Constraints.** `0 ≤ n ≤ 10^5`.

**Hint.** Use `big.Int` (Go), `BigInteger` (Java), native ints (Python). The fast-doubling identities work unchanged without a modulus. Expect `F(10^5)` to have ~20,899 digits.

**Evaluation criteria.**
- `F(1000)` has 209 digits; `F(10000)` has 2090 digits.
- Digit count matches `⌊0.6942·n − 1.16⌋ / log₂(10) + 1`.
- `O(M(n))` (only `O(log n)` big multiplies).

---

### Task 12 — CRT for an exact value from modular runs

**Problem.** Compute the exact `F(n)` (for moderate `n`) by running modular fast doubling under two coprime moduli (`10^9 + 7` and `998244353`) and reconstructing via CRT. Verify against the bignum value.

**Constraints.** `0 ≤ n` such that `F(n) < p₁·p₂ ≈ 10^18`.

**Hint.** Two-prime CRT: `inv = p1^{-1} mod p2`, `t = ((r2 − r1)·inv) mod p2`, `x = r1 + p1·t`. The two modular runs are independent.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t
```

**Evaluation criteria.**
- Recovers the exact value when `F(n) < p₁·p₂`.
- Each modular run agrees with `(exact) mod pᵢ`.
- CRT output matches the bignum `F(n)`.

---

### Task 13 — Verify Fibonacci identities

**Problem.** Empirically verify, for all small indices, the identities: Cassini `F(n+1)F(n-1) − F(n)² = (−1)^n`, sum `Σ_{i=0}^{n} F(i) = F(n+2) − 1`, sum-of-squares `Σ F(i)² = F(n)F(n+1)`, and the gcd property `gcd(F(m), F(n)) = F(gcd(m,n))`.

**Constraints.** Indices up to 40.

**Hint.** Use exact (bignum) Fibonacci. Each identity is a one-line assertion in a loop.

**Evaluation criteria.**
- All four identities hold for the tested ranges.
- The gcd property is checked over all pairs `(m, n)` up to 40.
- Cassini's sign alternates correctly.

---

### Task 14 — Lucas numbers via shared machinery

**Problem.** Compute `L(n) mod 10^9 + 7` (Lucas numbers: `L(0)=2, L(1)=1`, same recurrence) for huge `n`, and verify `L(n) = F(n-1) + F(n+1)` and `L(n)·F(n) = F(2n)`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** Lucas shares Fibonacci's matrix and fast-doubling identities with a different seed. Easiest: compute `(F(n), F(n+1))` by fast doubling and use `L(n) = 2F(n+1) − F(n)` (= `F(n-1) + F(n+1)`).

**Reference oracle (Python).**
```python
def lucas_loop(n, m=10**9 + 7):
    a, b = 2, 1  # L(0), L(1)
    for _ in range(n):
        a, b = b, (a + b) % m
    return a
```

**Evaluation criteria.**
- `L(0)=2, L(1)=1, L(10)=123`.
- Matches `lucas_loop` for small `n`.
- The two identities hold mod `p`.

---

### Task 15 — Decide the right method

**Problem.** Given a Fibonacci-evaluation problem's parameters `(index n, modular-vs-exact, single-query-vs-batch, fixed-vs-varying modulus)`, implement `classify(...)` returning one of: `LOOP`, `FAST_DOUBLING`, `PISANO_BATCH`, `BIGINT`, `CRT`. Justify each with its complexity.

**Constraints / cases.**
- Small `n` (`≤ 10^6`), single → `LOOP` (`O(n)`).
- Large `n`, modular, single/varying `m` → `FAST_DOUBLING` (`O(log n)`).
- Large `n`, modular, many queries, fixed `m` → `PISANO_BATCH` (`O(π(m) + Q)`).
- Exact value, moderate `n` → `BIGINT` (`O(M(n))`).
- Exact value, parallel/bounded → `CRT`.

**Hint.** Encode the decision rules from `senior.md`. The fixed-vs-varying modulus distinction decides `PISANO_BATCH` vs `FAST_DOUBLING`.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Justification cites the right complexity.
- Distinguishes batch-with-fixed-`m` from per-query.

---

## Benchmark Task

### Task B — Loop vs Fast Doubling vs Matrix crossover

**Problem.** Empirically compare the three methods for `F(n) mod 10^9 + 7`:

- **(a) Loop:** `O(n)`.
- **(b) Matrix exponentiation:** `O(log n)`, ~8 mults/bit.
- **(c) Fast doubling:** `O(log n)`, ~3 mults/bit.

Measure wall-clock time across `n ∈ {100, 10^4, 10^6, 10^9, 10^18}` (use huge `n` only for the `O(log n)` methods). Report a table; confirm fast doubling beats the matrix by a constant factor, and both crush the loop for large `n`.

**Starter — Python.**
```python
import time

MOD = 1_000_000_007


def loop(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, (a + b) % MOD
    return a


def fast_doubling(n):
    def pair(k):
        if k == 0:
            return (0, 1)
        a, b = pair(k >> 1)
        c = a * ((2 * b - a) % MOD) % MOD
        d = (a * a + b * b) % MOD
        return (c, d) if k & 1 == 0 else (d, (c + d) % MOD)
    return pair(n)[0]


def mat(n):
    def mul(a, b):
        return [[sum(a[i][t] * b[t][j] for t in range(2)) % MOD
                 for j in range(2)] for i in range(2)]
    r, base = [[1, 0], [0, 1]], [[1, 1], [1, 0]]
    while n > 0:
        if n & 1:
            r = mul(r, base)
        base = mul(base, base)
        n >>= 1
    return r[0][1]


def bench(fn, n, reps=5):
    start = time.perf_counter()
    for _ in range(reps):
        fn(n)
    return (time.perf_counter() - start) / reps * 1000.0  # ms


def main():
    print(f"{'n':>12} {'loop_ms':>12} {'matrix_ms':>12} {'fastdbl_ms':>12}")
    for n in (100, 10_000, 1_000_000, 1_000_000_000, 10**18):
        fd = bench(fast_doubling, n)
        mt = bench(mat, n)
        if n <= 1_000_000:
            lp = bench(loop, n)
            print(f"{n:>12} {lp:>12.4f} {mt:>12.4f} {fd:>12.4f}")
        else:
            print(f"{n:>12} {'(skipped)':>12} {mt:>12.4f} {fd:>12.4f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same outputs across Go, Java, Python on the same inputs.
- Loop wins for tiny `n`; both `O(log n)` methods win for large `n`. Report the crossover.
- Fast doubling is measurably faster than the matrix (fewer multiplications per bit).
- Matrix and fast doubling complete `n = 10^18` in well under a millisecond; the loop is infeasible there.
- Report the mean across ≥ 3 runs; exclude setup time.

---

## General Guidance for All Tasks

- **Always validate against the naive `O(n)` loop oracle first.** Every task ships with or references a slow loop. Run it on small `n`, diff, and only then trust the fast method on large `n`.
- **Get the base cases right.** `F(0)=0, F(1)=1`. The most common beginner bug is an off-by-one or a wrong base case.
- **Reduce mod `m` inside the loop / identities.** Never form the giant number first. Normalize the subtraction `2F(k+1) − F(k)` with `((x % m) + m) % m`.
- **Mind overflow.** `F(47)` exceeds int32, `F(93)` exceeds int64. Use 64-bit, bignums, or a modulus. For `m` near `2^62`, use a `mulmod`.
- **The modulus need not be prime** — Fibonacci uses no division.
- **Never use Binet in floating point for exact values** — it breaks past `n ≈ 70`.
- **Prefer fast doubling** for plain Fibonacci at large `n`; the matrix is the general-recurrence tool.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs. The general linear-recurrence machinery is `19-number-theory/11-matrix-exponentiation`.
