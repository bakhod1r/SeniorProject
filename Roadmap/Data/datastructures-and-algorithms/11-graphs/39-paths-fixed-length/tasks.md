# Paths of Fixed Length (Matrix Exponentiation on Graphs) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the matrix-exponentiation logic and validate against the evaluation criteria.
> **Always test against a brute-force layered-DP oracle on small inputs before trusting the matrix-power result.**

---

## Beginner Tasks (5)

### Task 1 — Single matrix multiply mod p

**Problem.** Implement `multiply(A, B, mod)` for two `n × n` integer matrices that returns `C` with `C[i][j] = (Σ_t A[i][t]·B[t][j]) mod p`. Reduce after every accumulation so nothing overflows 64-bit integers.

**Input / Output spec.**
- Read `n`, then `A` (`n` rows of `n` ints), then `B`.
- Print `C` row by row, space-separated.

**Constraints.**
- `1 ≤ n ≤ 100`, entries already in `[0, p)`, `p = 10^9 + 7`.
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
	var n int
	fmt.Scan(&n)
	read := func() [][]int64 {
		m := make([][]int64, n)
		for i := range m {
			m[i] = make([]int64, n)
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
        int n = sc.nextInt();
        long[][] a = read(sc, n), b = read(sc, n);
        long[][] c = multiply(a, b);
        StringBuilder sb = new StringBuilder();
        for (long[] row : c) {
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(' ');
                sb.append(row[j]);
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }

    static long[][] read(Scanner sc, int n) {
        long[][] m = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) m[i][j] = sc.nextLong();
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
    n = int(next(data))
    read = lambda: [[int(next(data)) for _ in range(n)] for _ in range(n)]
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

### Task 2 — Count walks of length k from one source

**Problem.** Given an adjacency matrix `A` (`n × n`, 0/1), a source `s`, and a length `k`, output the vector `v` where `v[j]` = number of walks of length exactly `k` from `s` to `j`, mod `10^9 + 7`. Use matrix exponentiation.

**Input / Output spec.**
- Read `n`, `k`, `s`, then the matrix `A`.
- Print `v[0], …, v[n-1]` space-separated.

**Constraints.** `1 ≤ n ≤ 80`, `0 ≤ k ≤ 10^18`, `0 ≤ s < n`.

**Hint.** Compute `A^k` with binary exponentiation, then read row `s`. Remember `A^0 = I`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_walks(A, s, k):
    n = len(A)
    dp = [0] * n
    dp[s] = 1
    for _ in range(k):
        nx = [0] * n
        for u in range(n):
            if dp[u]:
                for v in range(n):
                    nx[v] = (nx[v] + dp[u] * A[u][v]) % (10**9 + 7)
        dp = nx
    return dp
```

**Evaluation criteria.**
- `k = 0` returns the indicator at `s` (the identity row).
- Matches `brute_walks` above for small `k`.
- `O(n³ log k)`.

---

### Task 3 — Closed walks of length k

**Problem.** Given `A` and `k`, compute the total number of closed walks of length `k` (walks that return to their starting vertex), mod `10^9 + 7`. This is the **trace** of `A^k`: `Σ_i (A^k)[i][i]`.

**Input / Output spec.**
- Read `n`, `k`, then `A`.
- Print the single number `trace(A^k) mod p`.

**Constraints.** `1 ≤ n ≤ 100`, `0 ≤ k ≤ 10^18`.

**Hint.** You only need the diagonal of `A^k`; still compute the full power, then sum the diagonal.

**Worked check.** For the directed triangle `0→1→2→0`, `tr(A³) = 3` (the single 3-cycle, counted once per starting vertex). For a bipartite graph, `tr(A^k) = 0` for every *odd* `k` — a useful built-in sanity assertion.

**Evaluation criteria.**
- For `k = 3` on a triangle graph, the trace counts directed triangles (each contributes its rotations).
- For a bipartite graph and odd `k`, the trace is `0`.
- Matches brute force for small `k`.

---

### Task 4 — Reachability in exactly k steps (Boolean)

**Problem.** Given `A` (0/1) and `k`, output a 0/1 matrix `R` where `R[i][j] = 1` iff there exists a walk of length exactly `k` from `i` to `j`. Use the Boolean semiring (`OR`, `AND`).

**Input / Output spec.**
- Read `n`, `k`, then `A`.
- Print `R` row by row.

**Constraints.** `1 ≤ n ≤ 100`, `0 ≤ k ≤ 10^18`.

**Hint.** The Boolean identity has `true` on the diagonal, `false` off-diagonal. Replace `+` with `OR`, `×` with `AND`. (Equivalently, compute the counting power and threshold `>0`, but the Boolean version avoids overflow entirely.)

**Evaluation criteria.**
- Correct Boolean identity used for `k = 0`.
- Matches the counting result thresholded at `>0`.

---

### Task 5 — Fibonacci by matrix power

**Problem.** Compute `F(n) mod 10^9 + 7` using the `2×2` companion matrix `T = [[1,1],[1,0]]`, where `F(0)=0, F(1)=1`. Read `n` (up to `10^18`).

**Input / Output spec.**
- Read `n`. Print `F(n) mod p`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** `(F(n+1), F(n))ᵀ = T^n (F(1), F(0))ᵀ`. Read `F(n)` off `T^n`. Handle `n = 0` separately.

**Evaluation criteria.**
- `F(10) = 55`, `F(0) = 0`, `F(1) = 1`.
- `O(log n)`; instant for `n = 10^18`.
- Matches the iterative Fibonacci for small `n`.

---

## Intermediate Tasks (5)

### Task 6 — Walks of length AT MOST k (augmented matrix)

**Problem.** Given `A` (0/1), a source `s`, and `k`, count the number of walks of length **between 0 and k** from `s` to a fixed target `t`, mod `10^9 + 7`. Use the augmented-matrix construction (add a sink vertex with a self-loop that accumulates the running total), not a loop over `0..k`.

**Constraints.** `1 ≤ n ≤ 80`, `0 ≤ k ≤ 10^18`.

**Hint.** Build `B` of size `(n+1)×(n+1)`: copy `A` in the top-left, put a `1` from `t` (or from every vertex, depending on your accumulation design) into the sink column, and `B[n][n] = 1`. Read the accumulated entry of `B^{k+1}`. Verify the construction against `Σ_{L=0}^{k} (A^L)[s][t]` for small `k`.

**Evaluation criteria.**
- Matches the explicit sum `Σ_{L=0}^{k} (A^L)[s][t]` for small `k`.
- Single matrix power, `O(n³ log k)`.

---

### Task 7 — Shortest path with exactly k edges (min-plus)

**Problem.** Given a weighted graph (`n × n`, `INF` = no edge), a source `s`, target `t`, and `k`, find the minimum total weight of a walk using exactly `k` edges from `s` to `t`. Output `-1` if none exists. Use min-plus matrix power.

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ k ≤ 10^18`, weights in `[1, 10^6]`.

**Hint.** Min-plus identity: `0` on the diagonal, `INF` off-diagonal. Use `INF = MAX/4` and skip `INF` entries before adding to dodge overflow.

**Reference oracle (Python).**
```python
def brute_shortest_k(W, s, t, k):
    INF = float("inf")
    n = len(W)
    dist = [INF] * n
    dist[s] = 0
    for _ in range(k):
        nd = [INF] * n
        for u in range(n):
            if dist[u] == INF:
                continue
            for v in range(n):
                if W[u][v] != INF:
                    nd[v] = min(nd[v], dist[u] + W[u][v])
        dist = nd
    return dist[t]
```

**Evaluation criteria.**
- Returns `-1` when no exact-`k`-edge walk exists.
- Matches `brute_shortest_k` for small `k`.
- Correct even when a cheaper walk uses fewer edges (must use *exactly* `k`).

---

### Task 8 — Count length-k binary strings avoiding "11"

**Problem.** Count binary strings of length `k` that do **not** contain the substring `11`, mod `10^9 + 7`. Model as a 2-state automaton (state = "last char was 0" vs "last char was 1") and use matrix exponentiation.

**Constraints.** `1 ≤ k ≤ 10^18`.

**Hint.** Transition matrix `T` where `T[a][b]` = number of next-characters that take state `a` to state `b` without forming `11`. The answer is the sum over valid end-states of `(T^{k-1} · start)`. The count is the `(k+2)`-th Fibonacci number — verify against that closed form.

**Reference oracle (Python).**
```python
def brute_avoid_11(k):
    from itertools import product
    count = 0
    for bits in product("01", repeat=k):
        if "11" not in "".join(bits):
            count += 1
    return count
# brute_avoid_11(3) == 5
```

**Evaluation criteria.**
- `k = 1 → 2`, `k = 2 → 3`, `k = 3 → 5` (Fibonacci shape).
- Matches `brute_avoid_11` for `k ≤ 12`.
- Runs in `O(log k)` (the matrix is `2×2`).

---

### Task 9 — Generic linear recurrence solver

**Problem.** Implement `nthTerm(coeffs, init, n)` that returns `f(n) mod 10^9 + 7` for the order-`r` recurrence `f(n) = Σ_{i=1}^{r} coeffs[i-1]·f(n-i)` with initial values `init[0..r-1]`. Use the companion matrix.

**Constraints.** `1 ≤ r ≤ 50`, `0 ≤ n ≤ 10^18`, coefficients and initials in `[0, p)`.

**Hint.** Top row of `T` is `coeffs`; subdiagonal is `1`s. `f(n)` is read off `T^{n-(r-1)}` applied to the reversed initial vector. Handle `n < r` directly.

**Evaluation criteria.**
- Reproduces Fibonacci (`coeffs=[1,1]`), Tribonacci (`[1,1,1]`), and a custom order-4 recurrence.
- Matches a slow `O(n·r)` iterative computation for small `n`.
- `O(r³ log n)`.

---

### Task 10 — Markov chain k-step distribution

**Problem.** Given a row-stochastic transition matrix `P` (real-valued), an initial distribution `π₀`, and `k`, compute the distribution `π_k = π₀ P^k`. Use real-valued matrix exponentiation.

**Constraints.** `1 ≤ n ≤ 50`, `1 ≤ k ≤ 10^6`, rows of `P` sum to 1.

**Hint.** Use the real `(+, ×)` semiring (no modulus). After powering, verify each row of `P^k` still sums to ≈ 1; renormalize if drift is significant.

**Evaluation criteria.**
- `π_k` sums to ≈ 1 (within `1e-6`).
- For large `k`, `π_k` approaches the stationary distribution (compare against solving `πP = π`).
- Matches a step-by-step `k`-iteration for small `k`.

---

## Advanced Tasks (5)

### Task 11 — CRT-combined exact count across two primes

**Problem.** Compute the exact number of walks of length `k` from `s` to `t` when the answer may exceed `10^9 + 7`. Run matrix exponentiation under two coprime primes (`10^9 + 7` and `998244353`) and reconstruct the value modulo their product via CRT.

**Constraints.** `1 ≤ n ≤ 60`, `0 ≤ k ≤ 10^18`. Guarantee the true answer fits below `p₁·p₂`.

**Hint.** Run the identical matrix power twice (once per prime), then apply the two-prime CRT formula. The two runs are independent and can be parallelized.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    # find x with x ≡ r1 (mod p1), x ≡ r2 (mod p2)
    inv = pow(p1, -1, p2)            # p1^{-1} mod p2
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t               # in [0, p1*p2)
```

**Evaluation criteria.**
- Recovers values larger than a single prime for small graphs where the true count is known.
- Both modular runs agree with `(true answer) mod pᵢ`.
- `crt2` output matches the exact integer count when it fits below `p₁·p₂`.

---

### Task 12 — Longest walk of exactly k edges (max-plus)

**Problem.** Given a weighted DAG-or-general graph and `k`, find the maximum total weight over all walks of exactly `k` edges from `s` to `t`. Output `-INF` (or `-1`) if none exists. Use the max-plus semiring.

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ k ≤ 10^18`, weights in `[1, 10^6]`.

**Hint.** Max-plus identity: `0` on the diagonal, `−INF` off-diagonal. Replace `min` with `max`. Note this finds longest *walks* (loops allowed), not longest *simple paths* (which is NP-hard).

**Evaluation criteria.**
- Correctly handles graphs where looping increases weight within the `k`-edge budget.
- Matches a brute-force layered max-DP for small `k`.
- Documents the walk-vs-simple-path distinction in a comment.

---

### Task 13 — Cached power ladder for many k queries

**Problem.** Given a fixed graph `A` and `Q` queries each asking for `(s, t, k)` (walk count mod `p`), answer all queries efficiently by precomputing the binary-power ladder `A^{2^0}, A^{2^1}, …, A^{2^{60}}` once, then composing per query.

**Constraints.** `1 ≤ n ≤ 60`, `1 ≤ Q ≤ 10^5`, each `k ≤ 10^18`.

**Hint.** Precompute is `O(n³ · 60)`. Per query: multiply the cached powers whose bits are set in `k` into a running matrix (or, better, multiply a source row-vector through the cached powers in `O(n² · popcount(k))`).

**Evaluation criteria.**
- Precompute done exactly once, reused across all queries.
- Per-query cost is `O(n² · popcount(k))` using vector-times-matrix (not a fresh full power per query).
- Matches per-query independent matrix exponentiation.

---

### Task 14 — Count length-k paths on a knight's graph (large board)

**Problem.** On an `R × C` board (`R·C ≤ 64`), count knight move-sequences of length `k` from `s` to `t`, mod `10^9 + 7`. Build the `(R·C)×(R·C)` knight adjacency matrix and power it.

**Constraints.** `R·C ≤ 64`, `0 ≤ k ≤ 10^18`.

**Hint.** Precompute the 8 knight offsets; an edge exists when both target coordinates are in-bounds. The matrix is up to `64×64`; `O(64³ log k)` is fast.

**Degree sanity check.** On a standard `8×8` board, a knight on a corner has degree 2, on an edge-adjacent square degree 3 or 4, and near the center degree 8. Summing all cell degrees gives `336` directed knight moves on an `8×8` board; assert this after building the adjacency matrix to catch in-bounds bugs.

**Evaluation criteria.**
- Matches BFS-layer enumeration for small `k`.
- Handles `k = 0` (identity), `k = 1` (direct knight moves).
- Correct in-bounds edge construction (corner degree 2, total directed moves 336 on `8×8`).

---

### Task 15 — Detect when matrix exponentiation is the wrong tool

**Problem.** You are given a problem statement and must decide whether matrix exponentiation applies. Implement a function `classify(problem)` (or write a short analysis) that, given the constraints `(n, k, query_type)`, returns one of: `MATRIX_EXP`, `LAYERED_DP`, `FLOYD_WARSHALL`, `KITAMASA`, or `INTRACTABLE` (simple-path counting). Justify each decision.

**Constraints / cases to handle.**
- Large `k`, small `n`, walk count → `MATRIX_EXP`.
- Small `k` (`≤ 1000`), single source → `LAYERED_DP`.
- All-pairs shortest, no edge-count constraint → `FLOYD_WARSHALL`.
- Single term of a large-order recurrence → `KITAMASA`.
- Simple-path counting of length `k` → `INTRACTABLE` (#P-hard).

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. The intractable case is the trap: simple paths are #P-hard, so matrix power is wrong.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INTRACTABLE` branch explicitly cites the walks-vs-simple-paths #P-hardness.
- Justification references the right complexity (`O(V³ log k)`, `O(V²k)`, `O(V³)`, `O(r² log k)`).

---

## Benchmark Task

### Task B — Layered DP vs Matrix Exponentiation crossover

**Problem.** Empirically find the `k` at which matrix exponentiation overtakes layered DP for a fixed `V`. Implement three workloads on a random `V × V` 0/1 graph (fixed seed):

- **(a) Layered DP, single source:** apply the vector-times-matrix recurrence `k` times — `O(V²·k)`.
- **(b) Matrix exponentiation, single source:** compute `A^k` then read row `s` — `O(V³ log k)`.
- **(c) Matrix exponentiation, all pairs:** compute `A^k` (same cost as (b), but reusable for any `(s,t)`).

Measure wall-clock time for `V = 100` across `k ∈ {10, 100, 1000, 10^4, 10^6, 10^9}` (use a huge `k` only for the matrix methods). Report a table and identify the crossover `k`.

**Starter — Python.**
```python
import random
import time
from typing import List

MOD = 1_000_000_007


def gen_graph(v: int, seed: int) -> List[List[int]]:
    r = random.Random(seed)
    return [[r.randint(0, 1) for _ in range(v)] for _ in range(v)]


def layered_dp(A, s, k):
    # TODO: dp vector of length V; apply recurrence k times; O(V^2 * k)
    return [0] * len(A)


def mat_mul(a, b):
    # TODO: O(V^3) mod MOD, zero-skip, i,t,j order
    return [[0] * len(a) for _ in range(len(a))]


def mat_pow(a, k):
    # TODO: binary exponentiation, O(V^3 log k)
    return a


def bench_layered(A, s, k) -> float:
    start = time.perf_counter()
    layered_dp(A, s, k)
    return time.perf_counter() - start


def bench_matexp(A, k) -> float:
    start = time.perf_counter()
    mat_pow(A, k)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    V = 100
    A = gen_graph(V, 42)
    print("k            layered_dp_ms      matexp_ms")
    for k in [10, 100, 1000, 10_000, 1_000_000, 1_000_000_000]:
        rb = [bench_matexp([row[:] for row in A], k) for _ in range(3)]
        # layered DP only for k that finish in reasonable time
        if k <= 1_000_000:
            ra = [bench_layered(A, 0, k) for _ in range(3)]
            print(f"{k:<12d} {mean_ms(ra):<18.2f} {mean_ms(rb):<14.2f}")
        else:
            print(f"{k:<12d} {'(skipped)':<18} {mean_ms(rb):<14.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same graph across Go, Java, and Python.
- Layered DP (a) wins for small `k`; matrix exponentiation (b) wins for large `k`. Report the crossover `k`.
- Matrix methods complete for `k = 10^9` in well under a second at `V = 100`; layered DP is infeasible there.
- Report includes the mean across at least 3 runs and does not time graph generation or array cloning.
- Writeup: a short note on the measured crossover `k` and how it compares to the theoretical crossover (`V·log k ≈ k`, i.e. roughly `k ≈ V` for the single-source case).

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every counting/shortest task above ships with (or references) a slow layered-DP oracle. Run it on small `V` and small `k`, diff entrywise, and only then trust the matrix-power version on large `k`.
- **Pin the modulus and the `INF` sentinel as named constants.** Use `MOD = 10^9 + 7` and `INF = MAX/4`; never inline magic numbers.
- **Get `A^0 = I` right.** The most common beginner bug is returning `A` (or zeros) for `k = 0`. The identity is per-semiring: `1` on the diagonal for counting, `0` on the diagonal / `INF` off for min-plus.
- **Count edges, not vertices.** "Length `k`" means `k` edges and `k+1` vertices. Translate human-specified "stops" carefully (Senior §10.8).
- **Mind overflow.** In Go/Java cast to 64-bit before multiplying, then reduce mod `p`. In min-plus, skip `INF` operands before adding.
- **Never use these for simple-path counting.** Matrix power counts walks (repeats allowed). Simple-path counting of length `k` is #P-hard — if a task secretly asks for that, the correct answer is "intractable" (Task 15).
- **Reuse the `multiply`/`matPow` pair.** Most bugs live in `multiply`; write it once, test it hard, and parameterize the rest by semiring.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
