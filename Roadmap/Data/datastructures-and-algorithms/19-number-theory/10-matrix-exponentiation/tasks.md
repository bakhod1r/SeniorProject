# Matrix Exponentiation for Linear Recurrences — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the matrix-exponentiation logic and validate against the evaluation criteria.
> **Always test against a brute-force `O(n)` loop oracle on small `n` before trusting the matrix-power result on huge `n`.**

---

## Beginner Tasks (5)

### Task 1 — Single k×k matrix multiply mod p

**Problem.** Implement `multiply(A, B, mod)` for two `k × k` integer matrices that returns `C` with `C[i][j] = (Σ_t A[i][t]·B[t][j]) mod p`. Reduce after every accumulation so nothing overflows 64-bit integers.

**Input / Output spec.**
- Read `k`, then `A` (`k` rows of `k` ints), then `B`.
- Print `C` row by row, space-separated.

**Constraints.**
- `1 ≤ k ≤ 100`, entries already in `[0, p)`, `p = 10^9 + 7`.
- Must use 64-bit products before reducing.

**Hint.** Loop order `i, t, j` and skip `A[i][t] == 0`.

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func multiply(a, b [][]int64) [][]int64 {
	// TODO: triple loop, reduce mod MOD after each accumulation
	return nil
}

func main() {
	var k int
	fmt.Scan(&k)
	read := func() [][]int64 {
		m := make([][]int64, k)
		for i := range m {
			m[i] = make([]int64, k)
			for j := range m[i] {
				fmt.Scan(&m[i][j])
			}
		}
		return m
	}
	a, b := read(), read()
	c := multiply(a, b)
	for _, row := range c {
		for j, v := range row {
			if j > 0 {
				fmt.Print(" ")
			}
			fmt.Print(v)
		}
		fmt.Println()
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final long MOD = 1_000_000_007L;

    static long[][] multiply(long[][] a, long[][] b) {
        // TODO
        return null;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int k = sc.nextInt();
        long[][] a = read(sc, k), b = read(sc, k);
        long[][] c = multiply(a, b);
        StringBuilder sb = new StringBuilder();
        for (long[] row : c) {
            for (int j = 0; j < k; j++) {
                if (j > 0) sb.append(' ');
                sb.append(row[j]);
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }

    static long[][] read(Scanner sc, int k) {
        long[][] m = new long[k][k];
        for (int i = 0; i < k; i++)
            for (int j = 0; j < k; j++) m[i][j] = sc.nextLong();
        return m;
    }
}
```

**Starter — Python.**
```python
import sys

MOD = 1_000_000_007


def multiply(a, b):
    # TODO
    return []


def main():
    data = iter(sys.stdin.read().split())
    k = int(next(data))
    read = lambda: [[int(next(data)) for _ in range(k)] for _ in range(k)]
    a, b = read(), read()
    c = multiply(a, b)
    print("\n".join(" ".join(map(str, row)) for row in c))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct mod-`p` product, verified against a hand calculation on a `2×2`.
- No overflow (64-bit product before `% MOD`).
- Loop order `i, t, j`.

---

### Task 2 — Fibonacci by matrix power

**Problem.** Compute `F(n) mod 10^9 + 7` using the `2×2` companion matrix `M = [[1,1],[1,0]]`, where `F(0)=0, F(1)=1`. Read `n` (up to `10^18`).

**Input / Output spec.**
- Read `n`. Print `F(n) mod p`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** `M^n = [[F(n+1),F(n)],[F(n),F(n-1)]]`, so `F(n)` is at `[0][1]`. Remember `M^0 = I`. Handle `n = 0` correctly.

**Reference oracle (Python) — validate against this.**
```python
def fib_loop(n, mod=10**9 + 7):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, (a + b) % mod
    return a
```

**Evaluation criteria.**
- `F(10) = 55`, `F(0) = 0`, `F(1) = 1`, `F(20) = 6765`.
- `O(log n)`; instant for `n = 10^18`.
- Matches `fib_loop` for small `n`.

---

### Task 3 — Tribonacci nth term

**Problem.** Compute `T(n) mod 10^9 + 7` for `T(n) = T(n-1) + T(n-2) + T(n-3)`, `T(0)=0, T(1)=1, T(2)=1`. Build the `3×3` companion matrix.

**Input / Output spec.**
- Read `n`. Print `T(n) mod p`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** Companion matrix top row `(1,1,1)`, sub-diagonal `1`s. Initial state `(T(2),T(1),T(0))ᵀ = (1,1,0)ᵀ`. Read the top entry of `M^{n-2}·state`. Handle `n < 3` directly.

**Worked check.** `T(3) = 2`, `T(4) = 4`, `T(5) = 7`, `T(6) = 13`.

**Evaluation criteria.**
- Reproduces the small tribonacci values above.
- Matches a slow `O(n)` iteration for small `n`.
- `O(log n)` (the matrix is fixed `3×3`).

---

### Task 4 — Geometric-with-constant recurrence

**Problem.** Compute `f(n) mod 10^9 + 7` for `f(n) = a·f(n-1) + b` with given `a, b, f(0)`. Use the augmented `2×2` matrix `[[a,b],[0,1]]`.

**Input / Output spec.**
- Read `a`, `b`, `f0`, `n`. Print `f(n) mod p`.

**Constraints.** `0 ≤ a,b,f0 < p`, `0 ≤ n ≤ 10^18`.

**Hint.** State `(f(n),1)ᵀ`. `f(n) = (M^n)[0][0]·f0 + (M^n)[0][1]·1`. The bottom row `(0,1)` keeps the constant slot equal to `1`.

**Worked check.** `a=3, b=2, f0=0` gives `0, 2, 8, 26, 80, …`.

**Evaluation criteria.**
- Reproduces the sequence above for small `n`.
- Correct augmentation (constant carried via the self-loop row).
- `O(log n)`.

---

### Task 5 — Term n of an order-k recurrence (small k)

**Problem.** Implement `nthTerm(coeffs, init, n)` returning `f(n) mod 10^9 + 7` for `f(n) = Σ_{i=1}^{k} coeffs[i-1]·f(n-i)` with initial values `init[0..k-1]`. Use the companion matrix.

**Input / Output spec.**
- Read `k`, the `k` coefficients, the `k` initial values, then `n`. Print `f(n) mod p`.

**Constraints.** `1 ≤ k ≤ 10`, `0 ≤ n ≤ 10^18`, coefficients/initials in `[0, p)`.

**Hint.** Top row of `M` is `coeffs`; sub-diagonal `1`s. `f(n)` read off `M^{n-(k-1)}` applied to the reversed initial vector. Handle `n < k` directly.

**Evaluation criteria.**
- Reproduces Fibonacci (`coeffs=[1,1]`) and tribonacci (`[1,1,1]`).
- Matches a slow `O(n·k)` iterative computation for small `n`.
- `O(k³ log n)`.

---

## Intermediate Tasks (5)

### Task 6 — Prefix sum of a recurrence via augmentation

**Problem.** Given an order-2 recurrence `f(n) = c_1 f(n-1) + c_2 f(n-2)` with initial values, compute the running sum `S(n) = Σ_{m=0}^{n} f(m) mod 10^9 + 7` using a single augmented matrix power (not a loop over `0..n`).

**Constraints.** `0 ≤ n ≤ 10^18`, coefficients/initials in `[0,p)`.

**Hint.** State `(S(n), f(n), f(n-1))ᵀ`; matrix `[[1,c_1,c_2],[0,c_1,c_2],[0,1,0]]`. The top row carries the old sum forward (leading `1`) and adds the new term. Verify against `Σ_{m=0}^{n} f(m)` computed by a loop for small `n`.

**Reference oracle (Python).**
```python
def prefix_sum_loop(c1, c2, f0, f1, n, mod=10**9 + 7):
    seq = [f0 % mod, f1 % mod]
    while len(seq) <= n:
        seq.append((c1 * seq[-1] + c2 * seq[-2]) % mod)
    return sum(seq[:n + 1]) % mod
```

**Evaluation criteria.**
- Matches `prefix_sum_loop` for small `n`.
- Single matrix power, `O(log n)`.
- Correct augmentation (sum row plus companion block).

---

### Task 7 — Count length-n strings avoiding "11"

**Problem.** Count binary strings of length `n` that do **not** contain the substring `11`, mod `10^9 + 7`. Model as a 2-state transfer matrix and use matrix exponentiation.

**Constraints.** `1 ≤ n ≤ 10^18`.

**Hint.** Transfer matrix `T = [[1,1],[1,0]]` (from "last char 0" you may append `0`→state 0 or `1`→state 1; from "last char 1" only `0`→state 0). The answer is `F(n+2)` — verify against that. Sum over valid end-states of `T^{n-1}·start`.

**Reference oracle (Python).**
```python
def brute_avoid_11(n):
    from itertools import product
    return sum("11" not in "".join(b) for b in product("01", repeat=n))
# brute_avoid_11(3) == 5
```

**Evaluation criteria.**
- `n=1 → 2`, `n=2 → 3`, `n=3 → 5` (Fibonacci shape).
- Matches `brute_avoid_11` for `n ≤ 12`.
- Runs in `O(log n)`.

---

### Task 8 — Negative-coefficient recurrence

**Problem.** Compute `f(n) mod 10^9 + 7` for `f(n) = 3·f(n-1) − 2·f(n-2)` with `f(0)=1, f(1)=3`. Coefficients can be negative — normalize residues. (This sequence is `2^n + 1`: `1,3,5,9,17,…` wait — verify with the loop.)

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** Build the companion matrix with `c_1 = 3`, `c_2 = ((-2) % p + p) % p`. After every signed product, normalize with `((x%p)+p)%p`. Compare against the loop to confirm the normalization.

**Reference oracle (Python).**
```python
def loop_neg(n, mod=10**9 + 7):
    a, b = 1, 3  # f(0), f(1)
    if n == 0:
        return a
    for _ in range(n - 1):
        a, b = b, (3 * b - 2 * a) % mod
    return b
```

**Evaluation criteria.**
- Matches `loop_neg` for small `n`.
- All matrix entries stay in `[0, p)` (no negative residues leak).
- `O(log n)`.

---

### Task 9 — Generic linear recurrence solver (larger k)

**Problem.** Implement `nthTerm(coeffs, init, n)` for an order-`r` recurrence with up to `r = 50`. Use the companion matrix.

**Constraints.** `1 ≤ r ≤ 50`, `0 ≤ n ≤ 10^18`, coefficients/initials in `[0,p)`.

**Hint.** Same companion construction as Task 5; ensure the `O(r³)` multiply uses the zero-skip and `i,t,j` order so `r = 50` stays fast. Handle `n < r` directly.

**Evaluation criteria.**
- Reproduces Fibonacci, tribonacci, and a custom order-4 recurrence.
- Matches a slow `O(n·r)` iterative computation for small `n`.
- `O(r³ log n)`; `r = 50, n = 10^18` runs under a second.

---

### Task 10 — Many queries via cached power ladder

**Problem.** Given a fixed recurrence and `Q` queries each asking for `f(n_i) mod 10^9 + 7`, answer all efficiently by precomputing the squaring ladder `M^{2^0}, …, M^{2^{60}}` once, then composing per query.

**Constraints.** `1 ≤ k ≤ 10`, `1 ≤ Q ≤ 10^5`, each `n ≤ 10^18`.

**Hint.** Precompute is `O(k³·60)`. Per query: push the initial state vector through the cached powers whose bits are set in `n` — `O(k²·popcount(n))` per query, not a fresh full power.

**Evaluation criteria.**
- Precompute done exactly once, reused across all queries.
- Per-query cost is `O(k²·popcount(n))` (vector-times-matrix, not full power).
- Matches per-query independent matrix exponentiation.

---

## Advanced Tasks (5)

### Task 11 — CRT-combined exact term across two primes

**Problem.** Compute the **exact** `n`-th term of a recurrence when the value may exceed `10^9 + 7`. Run matrix exponentiation under two coprime primes (`10^9 + 7` and `998244353`) and reconstruct via CRT modulo their product.

**Constraints.** `1 ≤ k ≤ 10`, `0 ≤ n` such that the true term fits below `p₁·p₂`.

**Hint.** Run the identical matrix power twice (once per prime), then apply the two-prime CRT formula. The two runs are independent and parallelizable.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)            # p1^{-1} mod p2
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t               # in [0, p1*p2)
```

**Evaluation criteria.**
- Recovers values larger than a single prime for small recurrences where the true term is known.
- Both modular runs agree with `(true term) mod pᵢ`.
- `crt2` output matches the exact integer when it fits below `p₁·p₂`.

---

### Task 12 — Polynomial forcing term (augmentation)

**Problem.** Compute `f(n) mod 10^9 + 7` for `f(n) = f(n-1) + n` with `f(0) = 0` (so `f(n) = n(n+1)/2`, the triangular numbers). Solve it by **augmenting** the matrix to carry `n` and the constant `1` as extra state, not by the closed form.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** The forcing term `n` satisfies its own recurrence (`n = (n-1) + 1`). State `(f(n), n, 1)ᵀ`. Build the `3×3` matrix so that one step advances `f`, increments `n`, and preserves `1`. Verify against `n(n+1)/2 mod p`.

**Evaluation criteria.**
- Reproduces the triangular numbers for small `n`.
- Uses augmentation (no direct closed-form shortcut in the matrix path).
- `O(log n)`.

---

### Task 13 — Kitamasa for a single term (large order)

**Problem.** Given an order-`k` recurrence with `k` up to a few hundred and a single query `n`, compute `f(n) mod 998244353` using the **Kitamasa** method (polynomial exponentiation mod the characteristic polynomial) in `O(k² log n)`, and compare its output and timing against the `O(k³ log n)` matrix power.

**Constraints.** `1 ≤ k ≤ 300`, `0 ≤ n ≤ 10^18`.

**Hint.** Work in `ℤ_p[x]/(χ(x))` where `χ(x) = x^k − c_1 x^{k-1} − … − c_k`. Compute `x^n mod χ` by binary exponentiation of polynomials (`O(k²)` multiply + reduce per step). If `x^n ≡ Σ a_m x^m`, then `f(n) = Σ a_m f(m)`.

**Evaluation criteria.**
- Output matches the matrix-power solution on the same inputs.
- For large `k` (≥ 64), Kitamasa is measurably faster than the matrix power.
- Both handle `n < k` by returning the given initial value.

---

### Task 14 — Coupled recurrences (block matrix)

**Problem.** Two interleaved sequences satisfy `a(n) = a(n-1) + b(n-1)` and `b(n) = a(n-1) + 2·b(n-1)`, with `a(0)=1, b(0)=0`. Compute `a(n) mod 10^9 + 7` using a `2×2` matrix that advances the *pair* `(a,b)` together.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** State `(a(n), b(n))ᵀ`; matrix `[[1,1],[1,2]]`. This is the general "system of linear recurrences" case — the matrix advances the whole vector at once. Verify against a step-by-step loop.

**Reference oracle (Python).**
```python
def loop_pair(n, mod=10**9 + 7):
    a, b = 1, 0
    for _ in range(n):
        a, b = (a + b) % mod, (a + 2 * b) % mod
    return a
```

**Evaluation criteria.**
- Matches `loop_pair` for small `n`.
- Correct `2×2` system matrix (not a companion matrix — a coupled system).
- `O(log n)`.

---

### Task 15 — Decide the right tool

**Problem.** Given a recurrence-evaluation problem's parameters `(order k, index n, single-term-vs-window, exact-vs-modular)`, implement `classify(...)` (or write a short analysis) returning one of: `NAIVE_LOOP`, `MATRIX_POWER`, `KITAMASA`, `CRT_MATRIX`, or `NOT_LINEAR`. Justify each decision with the right complexity.

**Constraints / cases to handle.**
- Small `n` (`≤ 10^6`) → `NAIVE_LOOP` (`O(kn)`).
- Large `n`, small order, modular → `MATRIX_POWER` (`O(k³ log n)`).
- Large `n`, large order, single term → `KITAMASA` (`O(k² log n)`).
- Large `n`, exact non-modular value → `CRT_MATRIX` (matrix power per prime + CRT).
- Non-linear recurrence (e.g. `f(n)=f(n-1)²`) → `NOT_LINEAR` (matrix power does not apply).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The `NOT_LINEAR` case is the trap: matrix exponentiation requires a *fixed linear* state advance.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `NOT_LINEAR` branch explicitly states why a constant matrix cannot advance a non-linear recurrence.
- Justification references the right complexity (`O(kn)`, `O(k³ log n)`, `O(k² log n)`).

---

## Benchmark Task

### Task B — Naive loop vs Matrix Exponentiation crossover

**Problem.** Empirically find the `n` at which matrix exponentiation overtakes the naive loop for a fixed order `k`. Implement two workloads for Fibonacci-like order-`k` recurrences (fixed seed for coefficients):

- **(a) Naive loop:** apply the recurrence `n` times — `O(k·n)`.
- **(b) Matrix exponentiation:** build the companion matrix, power it — `O(k³ log n)`.

Measure wall-clock time for `k ∈ {2, 10, 50}` across `n ∈ {100, 10^4, 10^6, 10^9, 10^18}` (use huge `n` only for the matrix method). Report a table and identify the crossover `n`.

**Starter — Python.**
```python
import random
import time

MOD = 1_000_000_007


def gen_coeffs(k, seed):
    r = random.Random(seed)
    return [r.randint(0, 5) for _ in range(k)]


def naive_loop(coeffs, init, n):
    # TODO: O(k*n) iteration; return f(n) mod MOD
    return 0


def mat_mul(a, b):
    # TODO: O(k^3) mod MOD, zero-skip, i,t,j order
    return [[0] * len(a) for _ in range(len(a))]


def mat_pow(a, n):
    # TODO: binary exponentiation, O(k^3 log n)
    return a


def bench_loop(coeffs, init, n):
    start = time.perf_counter()
    naive_loop(coeffs, init, n)
    return time.perf_counter() - start


def bench_matexp(M, n):
    start = time.perf_counter()
    mat_pow([row[:] for row in M], n)
    return time.perf_counter() - start


def mean_ms(samples):
    return sum(samples) / len(samples) * 1000.0


def main():
    for k in (2, 10, 50):
        coeffs = gen_coeffs(k, 42)
        init = list(range(k))
        M = [[0] * k for _ in range(k)]
        M[0] = coeffs[:]
        for i in range(1, k):
            M[i][i - 1] = 1
        print(f"--- k = {k} ---")
        print("n            loop_ms        matexp_ms")
        for n in (100, 10_000, 1_000_000, 1_000_000_000, 10**18):
            rb = [bench_matexp(M, n) for _ in range(3)]
            if n <= 1_000_000:
                ra = [bench_loop(coeffs, init, n) for _ in range(3)]
                print(f"{n:<12d} {mean_ms(ra):<14.2f} {mean_ms(rb):<14.2f}")
            else:
                print(f"{n:<12d} {'(skipped)':<14} {mean_ms(rb):<14.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same coefficients across Go, Java, and Python.
- Naive loop (a) wins for small `n`; matrix exponentiation (b) wins for large `n`. Report the crossover `n`.
- Matrix method completes for `n = 10^18` in well under a second at `k = 50`; naive loop is infeasible there.
- Report includes the mean across at least 3 runs and does not time setup/cloning.
- Writeup: a short note on the measured crossover and how it compares to the theoretical one (`k³ log n ≈ k·n`, i.e. roughly `n ≈ k²·log n`).

---

## General Guidance for All Tasks

- **Always validate against the naive `O(n)` loop oracle first.** Every task above ships with (or references) a slow loop oracle. Run it on small `n`, diff, and only then trust the matrix-power version on large `n`.
- **Pin the modulus as a named constant.** Use `MOD = 10^9 + 7` (or `998244353` for Kitamasa/NTT); never inline magic numbers.
- **Get `M^0 = I` right.** The most common beginner bug is returning `M` (or zeros) for `n = 0`. Special-case `n < k` to return the given initial value.
- **Build the companion matrix from the recipe:** top row = coefficients, sub-diagonal = identity shift. Initial state is reversed: `(f(k-1), …, f(0))ᵀ`.
- **Augment for inhomogeneous parts.** Constants get a self-looping `1`; prefix sums get an accumulator row; polynomial forcing terms get the states of the polynomial.
- **Mind overflow and negative residues.** In Go/Java cast to 64-bit before multiplying, then reduce mod `p`; normalize negative residues with `((x%p)+p)%p` when coefficients can be negative.
- **Never use floating-point for exact terms.** Binet / eigenvalue closed forms involve irrational roots — use integer matrices mod `p`.
- **Reuse the `multiply`/`matPow` pair.** Most bugs live in `multiply`; write it once, test it hard, and parameterize the rest.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs. The graph cousin of this technique — `(A^k)[i][j]` counting walks of length `k` — is `11-graphs/32-paths-fixed-length`.

### Suggested Order of Attack

Work the Beginner tasks first to lock in the `multiply`/`matPow` pair and the `M^0 = I` base case (Tasks 1–5). Then the Intermediate tasks introduce the two ideas that separate a working solver from a fragile one: **augmentation** (constants, prefix sums, polynomial forcing — Tasks 6, 12) and **modular hygiene** (negative residues, caching — Tasks 8, 10). The Advanced tasks push on scale: CRT for exact large values (Task 11), Kitamasa for large order (Task 13), coupled systems and the Kronecker view (Task 14), and finally the meta-skill of choosing the right tool (Task 15). The Benchmark task closes the loop by measuring the crossover the theory predicts — the moment matrix exponentiation overtakes the naive loop. Throughout, the discipline is the same: **build the companion matrix from the recipe, test against the naive loop on small `n`, then trust it on huge `n`.**
