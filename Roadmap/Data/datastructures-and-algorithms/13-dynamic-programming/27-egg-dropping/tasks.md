# Egg Dropping Puzzle (DP Minimax) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec or starter code in all three languages. Implement the DP / dual / closed-form logic and validate against the evaluation criteria.
> **Always test against a brute-force recursion oracle on small inputs before trusting a fast method on large `n`.**

---

## Beginner Tasks (5)

### Task 1 — One-egg and base cases

**Problem.** Implement `eggDropBase(k, n)` that returns the correct answer for the easy regimes only: `n == 0 → 0`, `k == 1 → n`, `n == 1 and k >= 1 → 1`. For all other inputs return `-1` (handled by later tasks). This forces you to nail the base cases before the recurrence.

**Input / Output spec.**
- Read `k`, then `n`.
- Print a single integer.

**Constraints.** `0 ≤ k ≤ 100`, `0 ≤ n ≤ 1000`.

**Hint.** `dp[1][f] = f` (linear scan), `dp[e][0] = 0` (nothing to test), `dp[e][1] = 1` (one drop). These three are where most bugs live.

**Starter — Go.**
```go
package main

import "fmt"

func eggDropBase(k, n int) int {
	// TODO: handle n==0, k==1, n==1; else return -1
	return -1
}

func main() {
	var k, n int
	fmt.Scan(&k, &n)
	fmt.Println(eggDropBase(k, n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int eggDropBase(int k, int n) {
        // TODO
        return -1;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int k = sc.nextInt(), n = sc.nextInt();
        System.out.println(eggDropBase(k, n));
    }
}
```

**Starter — Python.**
```python
import sys


def egg_drop_base(k: int, n: int) -> int:
    # TODO
    return -1


def main():
    k, n = map(int, sys.stdin.read().split())
    print(egg_drop_base(k, n))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `eggDropBase(1, 100) == 100`, `eggDropBase(5, 0) == 0`, `eggDropBase(3, 1) == 1`.
- Returns `-1` only for the not-yet-handled cases.

---

### Task 2 — Classic minimax table

**Problem.** Implement the classic `O(k·n²)` DP `dp[e][f] = 1 + min_x max(dp[e-1][x-1], dp[e][f-x])` and return `dp[k][n]`.

**Input / Output spec.**
- Read `k`, then `n`. Print `dp[k][n]`.

**Constraints.** `1 ≤ k ≤ 100`, `0 ≤ n ≤ 2000`.

**Hint.** Initialize `dp[1][f] = f`, `dp[e][0] = 0`, `dp[e][1] = 1`. The inner loop scans `x` from `1` to `f`; below a drop at `x` is `x-1` floors, above is `f-x`.

**Reference oracle (Python) — use this to validate.**
```python
from functools import lru_cache


def brute(k, n):
    @lru_cache(maxsize=None)
    def solve(e, f):
        if f == 0:
            return 0
        if e == 1:
            return f
        return 1 + min(max(solve(e - 1, x - 1), solve(e, f - x))
                       for x in range(1, f + 1))
    return solve(k, n)
```

**Evaluation criteria.**
- `dp[2][100] == 14`, `dp[1][100] == 100`, `dp[3][100] == 9`.
- Matches `brute` for all `k ≤ 6`, `n ≤ 60`.
- `O(k·n²)`.

---

### Task 3 — Two eggs closed form

**Problem.** With exactly `2` eggs, return the minimum guaranteed trials as the smallest `t` with `t(t+1)/2 ≥ n`. Must run in `O(1)` (plus an integer sqrt and correction).

**Input / Output spec.**
- Read `n`. Print the answer.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Hint.** `t = ⌈(-1 + √(1 + 8n)) / 2⌉`. Use integer sqrt; correct with a `while t*(t+1)/2 < n: t += 1` and a decrement check to dodge floating-point rounding.

**Worked check.** `n = 100 → 14` (since `13·14/2 = 91 < 100 ≤ 105 = 14·15/2`); `n = 10 → 4`; `n = 1 → 1`; `n = 0 → 0`.

**Evaluation criteria.**
- Matches the trials dual `egg_drop_fast(2, n)` for all `n ≤ 10^6`.
- Exact at boundaries (`n = t(t+1)/2` and `n = t(t+1)/2 + 1`).
- No floating-point off-by-one for large `n`.

---

### Task 4 — Trials dual (floors from trials)

**Problem.** Implement `g(e, t)` via `g(e, t) = g(e-1, t-1) + g(e, t-1) + 1` and use it to compute the minimum trials: the smallest `t` with `g(k, t) ≥ n`. Use a rolling 1D array.

**Input / Output spec.**
- Read `k`, `n`. Print the minimum trials.

**Constraints.** `1 ≤ k ≤ 64`, `0 ≤ n ≤ 10^18`.

**Hint.** Iterate the egg index from high to low so each `g[e]` reads the *previous* trial's values. Cap `g[e]` at `n` to avoid overflow.

**Evaluation criteria.**
- `egg_drop_fast(2, 100) == 14`, `egg_drop_fast(1, 100) == 100`.
- Matches the classic table (Task 2) for all `k ≤ 6`, `n ≤ 2000`.
- `O(k·t*)`; instant for `n = 10^18`.

---

### Task 5 — Optimal first drop

**Problem.** Given `k` eggs and `n` floors, return the optimal first-drop floor — the `x` minimizing `1 + max(dp[e-1][x-1], dp[e][f-x])` at the top level. For `2` eggs / `100` floors this is `14`.

**Input / Output spec.**
- Read `k`, `n`. Print the optimal first-drop floor.

**Constraints.** `1 ≤ k ≤ 50`, `1 ≤ n ≤ 2000`.

**Hint.** Either scan `x` in the classic table and return the argmin, or compute `g(k-1, t*-1) + 1` from the dual. Both must agree.

**Evaluation criteria.**
- For `2` eggs and `100` floors, returns `14`.
- The two methods (table argmin vs `g(k-1, t*-1)+1`) agree for all tested inputs.
- The returned `x` indeed achieves `dp[k][n]` when plugged into the recurrence.

---

## Intermediate Tasks (5)

### Task 6 — Binomial closed form

**Problem.** Compute the minimum trials as the smallest `t` with `Σ_{i=1}^{k} C(t, i) ≥ n`. Build the binomials incrementally (`C(t, i) = C(t, i-1)·(t-i+1)/i`) and cap the running sum at `n`.

**Constraints.** `1 ≤ k ≤ 64`, `0 ≤ n ≤ 10^18`.

**Hint.** For each `t`, accumulate terms `i = 1..k`, breaking the instant the sum reaches `n` (so it never overflows). The result must match the trials dual.

**Evaluation criteria.**
- Matches `egg_drop_fast` (Task 4) for all tested `(k, n)`.
- No overflow even for `k = 2`, `n = 10^18` (sum capped at `n`).
- `O(k·t*)`.

---

### Task 7 — Convex binary-search speedup

**Problem.** Implement the classic table but replace the inner `O(n)` scan over `x` with a binary search exploiting the unimodality of `max(dp[e-1][x-1], dp[e][f-x])` in `x`. Achieve `O(k·n·log n)`.

**Constraints.** `1 ≤ k ≤ 100`, `0 ≤ n ≤ 20000`.

**Hint.** `dp[e-1][x-1]` is non-decreasing and `dp[e][f-x]` is non-increasing in `x`; their `max` is a valley. Binary-search the crossover where the break-branch starts to exceed the survive-branch, then check the two candidate `x` around it.

**Evaluation criteria.**
- Produces identical results to the plain `O(k·n²)` table (Task 2) on all tested inputs.
- Measurably faster than the plain table for `n ≥ 5000`.
- Correctly handles ties at the crossover.

---

### Task 8 — Reconstruct the full strategy spine

**Problem.** Return the list of first-drop floors along the "all survive" spine of the optimal strategy. For `2` eggs / `100` floors: `[14, 27, 39, 50, 60, 69, 77, 84, 90, 95, 99, 100]`.

**Constraints.** `1 ≤ k ≤ 50`, `1 ≤ n ≤ 10^9`.

**Hint.** Compute `t* = minTrials(k, n)`. At each step the drop is `coverable(eggs-1, trials-1, n) + 1` above the current range floor; on survive, climb to it and decrement the trial budget.

**Reference oracle (Python).**
```python
def brute_spine(k, n):
    # follow optimal drops assuming every egg survives
    from functools import lru_cache

    @lru_cache(maxsize=None)
    def dp(e, f):
        if f == 0:
            return 0
        if e == 1:
            return f
        return 1 + min(max(dp(e - 1, x - 1), dp(e, f - x)) for x in range(1, f + 1))

    spine, base, eggs, f = [], 0, k, n
    while f > 0:
        # pick smallest optimal x
        best = min(range(1, f + 1),
                   key=lambda x: (1 + max(dp(eggs - 1, x - 1), dp(eggs, f - x)), x))
        spine.append(base + best)
        base += best
        f -= best  # survive -> floors above
    return spine
```

**Evaluation criteria.**
- Matches `brute_spine` for all `k ≤ 5`, `n ≤ 200`.
- The spine for `2`/`100` is exactly the 12-floor list above.
- No materialization of an `O(k·n)` table for large `n` (use the dual).

---

### Task 9 — Strategy simulator (gold-standard validator)

**Problem.** Implement `simulate(k, n)` that, for the reconstructed optimal strategy, walks the decision tree for **every** possible critical floor `T ∈ {0, …, n}`, counts the drops used, and returns the maximum over all `T`. It must equal `minTrials(k, n)` and never use more than `k` breaks on any path.

**Constraints.** `1 ≤ k ≤ 8`, `0 ≤ n ≤ 500` (small enough to enumerate all `T`).

**Hint.** Recurse on the active range `(lo, hi]` with the current egg count: at each level the optimal balanced drop splits the range; on break go down (one fewer egg), on survive go up. Track the worst-case depth.

**Evaluation criteria.**
- `simulate(2, 100) == 14`, `simulate(3, 50) == minTrials(3, 50)`.
- Asserts no root-to-leaf path exceeds `k` breaks.
- Confirms every `T ∈ {0..n}` is uniquely determined.

---

### Task 10 — Egg-capping optimization

**Problem.** Implement `minTrialsCapped(k, n)` that first replaces `k` with `min(k, ⌈log₂(n+1)⌉)` (eggs beyond the binary-search bound are useless), then runs the trials dual. Demonstrate it returns the same answer far faster when `k` is huge.

**Constraints.** `1 ≤ k ≤ 10^9`, `0 ≤ n ≤ 10^18`.

**Hint.** `⌈log₂(n+1)⌉` is the smallest `c` with `2^c ≥ n + 1`. With at least that many eggs the answer is exactly `c` (binary search).

**Evaluation criteria.**
- `minTrialsCapped(10^9, 1000) == minTrials(min(10^9, 10), 1000)`.
- For `k ≥ ⌈log₂(n+1)⌉`, returns `⌈log₂(n+1)⌉`.
- Runs in `O(k_capped · t*)` regardless of the raw `k`.

---

## Advanced Tasks (5)

### Task 11 — Monotone-argmin `O(k·n)` table

**Problem.** Implement the classic table in `O(k·n)` by exploiting that the optimal first drop `x*(e, f)` is non-decreasing in `f` (Monge / Knuth-Yao structure). Sweep `f` upward, advancing a pointer `x*` monotonically instead of rescanning.

**Constraints.** `1 ≤ k ≤ 100`, `0 ≤ n ≤ 200000`.

**Hint.** For fixed `e`, maintain `x*` as a running pointer; as `f` increases, `x*` only moves forward. The total advance of `x*` across all `f` is `O(n)`, giving `O(k·n)` overall.

**Evaluation criteria.**
- Identical results to the plain table (Task 2) on all tested inputs.
- Measurably faster than the `O(k·n·log n)` binary-search version (Task 7) for large `n`.
- Document the monotonicity assumption in a comment.

---

### Task 12 — Egg-trials-floors surface explorer

**Problem.** Implement two query functions: `marginalEgg(e, t) = g(e, t) - g(e-1, t)` (must equal `C(t, e)`) and `marginalTrial(e, t) = g(e, t) - g(e, t-1)` (must equal `g(e-1, t-1) + 1`). Verify the identities numerically.

**Constraints.** `1 ≤ e ≤ 20`, `1 ≤ t ≤ 60`.

**Hint.** Compute `g` via the dual; compute `C(t, e)` incrementally. The two must match exactly, demonstrating the differential structure of Pascal's triangle (Professional §9).

**Evaluation criteria.**
- `marginalEgg(e, t) == C(t, e)` for all tested `(e, t)`.
- `marginalTrial(e, t) == coverable(e-1, t-1) + 1` for all tested `(e, t)`.
- Includes a short note on diminishing returns (`C(t, e) → 0` once `e > t`).

---

### Task 13 — Batch query service with cached dual

**Problem.** Given a fixed maximum `(K, N)` and `Q` queries each asking `minTrials(k, n)` with `k ≤ K`, `n ≤ N`, answer all queries efficiently by precomputing the dual table `g(e, t)` for `e ≤ K` up to enough trials, then answering each query by a comparison-scan.

**Constraints.** `1 ≤ K ≤ 64`, `1 ≤ N ≤ 10^18`, `1 ≤ Q ≤ 10^5`.

**Hint.** Precompute `g(e, t)` (capped at `N`) until `g(K, t) ≥ N`; store rows. Each query `(k, n)` is the smallest `t` with the stored `g(k, t) ≥ n` — a binary search over the precomputed column.

**Evaluation criteria.**
- Precompute done exactly once, reused across all queries.
- Each query is `O(log t*)` (binary search into the cached table), not a fresh dual run.
- Matches per-query independent `minTrials` for all queries.

---

### Task 14 — Noisy threshold detection (when the model breaks)

**Problem.** You are told eggs sometimes survive a drop above `T` with probability `p` (sensor noise). Write a short analysis function `classify(p)` that returns `"USE_MINIMAX_DP"` if `p == 0` (clean threshold) and `"USE_STATISTICAL_METHOD"` otherwise, with a one-line justification. This task is about *recognizing the model boundary*, not solving the noisy case.

**Constraints.** `0.0 ≤ p ≤ 1.0`.

**Hint.** The minimax DP assumes a deterministic sharp threshold. Any `p > 0` destroys the "break ⇒ strictly above `T`" invariant, so the binary outcome is no longer reliable and the worst-case guarantee is void.

**Evaluation criteria.**
- `classify(0.0) == "USE_MINIMAX_DP"`.
- `classify(0.01) == "USE_STATISTICAL_METHOD"`.
- The justification explicitly cites that noise breaks the deterministic-threshold assumption.

---

### Task 15 — Method selector

**Problem.** Implement `selectMethod(k, n)` returning one of `"CLASSIC_TABLE"`, `"CONVEX_TABLE"`, `"MONOTONE_TABLE"`, `"TRIALS_DUAL"`, `"K2_CLOSED_FORM"`, or `"BINARY_SEARCH"`, encoding the constraint-driven decision rules from `senior.md`. Justify each branch.

**Constraints / cases to handle.**
- `k = 2` (any `n`) → `K2_CLOSED_FORM`.
- `k ≥ ⌈log₂(n+1)⌉` → `BINARY_SEARCH`.
- Large `n` (`> 10^6`), general `k` → `TRIALS_DUAL`.
- Small `n` (`≤ 5000`), need full table → `CLASSIC_TABLE` (or `MONOTONE_TABLE` / `CONVEX_TABLE` for medium `n`).

**Hint.** Encode the table from `senior.md` §2. The trap is using the quadratic table for large `n`.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The large-`n` branch never selects `CLASSIC_TABLE`.
- Justification references the right complexity (`O(k·n²)`, `O(k·n·log n)`, `O(k·n)`, `O(k·log n)`, `O(1)`, `O(log n)`).

---

## Benchmark Task

### Task B — Classic table vs trials dual crossover

**Problem.** Empirically find the `n` at which the trials dual decisively beats the classic table for fixed `k = 2`. Implement two workloads on the same `(k, n)` inputs:

- **(a) Classic table:** `O(k·n²)` fill, return `dp[k][n]`.
- **(b) Trials dual:** `O(k·t*)` loop, return the smallest `t` with `g(k, t) ≥ n`.

Measure wall-clock time for `k = 2` across `n ∈ {100, 1000, 10^4, 10^5, 10^6, 10^9}` (run the table only where feasible). Report a table and identify the crossover.

**Starter — Python.**
```python
import time
from typing import Tuple


def classic(k: int, n: int) -> int:
    dp = [[0] * (n + 1) for _ in range(k + 1)]
    for f in range(n + 1):
        dp[1][f] = f
    for e in range(1, k + 1):
        dp[e][0] = 0
        if n >= 1:
            dp[e][1] = 1
    for e in range(2, k + 1):
        for f in range(2, n + 1):
            best = f
            for x in range(1, f + 1):
                best = min(best, 1 + max(dp[e - 1][x - 1], dp[e][f - x]))
            dp[e][f] = best
    return dp[k][n]


def dual(k: int, n: int) -> int:
    if n == 0:
        return 0
    g = [0] * (k + 1)
    t = 0
    while g[k] < n:
        t += 1
        for e in range(k, 0, -1):
            g[e] = min(g[e - 1] + g[e] + 1, n)
    return t


def timed(fn, k, n) -> Tuple[int, float]:
    start = time.perf_counter()
    r = fn(k, n)
    return r, (time.perf_counter() - start) * 1000.0


def main() -> None:
    k = 2
    print("n            classic_ms      dual_ms     answer")
    for n in [100, 1000, 10_000, 100_000, 1_000_000, 1_000_000_000]:
        rd, td = timed(dual, k, n)
        if n <= 100_000:  # classic only where feasible
            rc, tc = timed(classic, k, n)
            assert rc == rd
            print(f"{n:<12d} {tc:<15.2f} {td:<11.4f} {rd}")
        else:
            print(f"{n:<12d} {'(skipped)':<15} {td:<11.4f} {rd}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Classic and dual agree wherever both run.
- The dual is faster for all `n` and the only feasible method for `n ≥ 10^6`.
- Matrix-free: the dual completes `k = 2, n = 10^9` in well under a millisecond.
- Report includes the mean across at least 3 runs and a note on the measured crossover vs theory (the table is `O(n²)`, the dual `O(√n)` for `k = 2`).

---

## Shared Test Fixtures

Use these known-good values to validate every task; they cover the base cases, the famous instance, and the egg-cap regime.

| `k` | `n` | `minTrials(k, n)` | Why it matters |
|-----|-----|-------------------|----------------|
| 1 | 100 | 100 | one egg = linear scan |
| 2 | 100 | 14 | the famous instance (`91 < 100 ≤ 105`) |
| 2 | 10 | 4 | small triangular-number boundary (`4·5/2 = 10`) |
| 3 | 100 | 9 | three-egg case (`C(9,1)+C(9,2)+C(9,3) = 129 ≥ 100`) |
| 7 | 100 | 7 | egg-cap: `7 = ⌈log₂ 101⌉`, binary-search regime |
| 5 | 0 | 0 | zero floors |
| 4 | 1 | 1 | one floor, one drop |
| 2 | 1 | 1 | boundary `t = 1` |

Two-egg strategy spine for `(2, 100)`: `[14, 27, 39, 50, 60, 69, 77, 84, 90, 95, 99, 100]` — 12 first-drop floors, each gap one smaller than the last.

Diminishing-returns sequence for `n = 100` as eggs grow: `100, 14, 9, 8, 8, 7, 7, …` (flattening at `⌈log₂ 101⌉ = 7`).

## General Guidance for All Tasks

- **Always validate against the brute-force recursion oracle first.** Run it on small `(k, n)`, diff, then trust the fast methods on large `n`.
- **Nail the base cases:** `dp[1][f] = f`, `dp[e][0] = 0`, `dp[e][1] = 1`. Most bugs live here.
- **It is `max`, never sum or average.** The adversary picks the worse branch; the guarantee is worst-case.
- **Count the split correctly:** below a drop at `x` is `x-1` floors, above is `f-x`, plus `1` for the drop.
- **Cap eggs at `⌈log₂(n+1)⌉`** and **cap `g` at `n`** to dodge wasted work and overflow.
- **Use the dual for large `n`.** The `O(k·n²)` table is for small `n` or when you need the full per-state table.
- **Don't confuse the answer with the critical floor.** The DP returns the number of trials, not `T`.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.

---

## Appendix: Reference Solutions Outline

For self-checking, here is the shape each core helper should take (Python; translate to Go/Java identically).

**The fast dual** (Tasks 4, 8, 10, 13, 15):
```python
def min_trials(k, n):
    if n == 0:
        return 0
    g = [0] * (k + 1)
    t = 0
    while g[k] < n:
        t += 1
        for e in range(k, 0, -1):          # high -> low egg index
            g[e] = min(g[e - 1] + g[e] + 1, n)
    return t
```

**The brute-force oracle** (validate Tasks 2, 5, 7, 8, 9, 11):
```python
from functools import lru_cache

def brute(k, n):
    @lru_cache(maxsize=None)
    def solve(e, f):
        if f == 0:
            return 0
        if e == 1:
            return f
        return 1 + min(max(solve(e - 1, x - 1), solve(e, f - x))
                       for x in range(1, f + 1))
    return solve(k, n)
```

**The egg cap** (Tasks 10, 13, 15):
```python
def cap_eggs(k, n):
    c = 0
    while (1 << c) - 1 < n:   # smallest c with 2^c - 1 >= n
        c += 1
    return min(k, c)
```

**The k=2 closed form** (Task 3):
```python
import math

def two(n):
    if n == 0:
        return 0
    t = (math.isqrt(1 + 8 * n) - 1) // 2
    while t * (t + 1) // 2 < n:
        t += 1
    return t
```

Build these four helpers first; every task above either calls one of them directly or validates against the brute-force oracle. The cross-method assertion `min_trials(k, n) == brute(k, n)` for all `k ≤ 6, n ≤ 60` is the single most important check — run it before submitting any task.

A final reminder of the invariant the whole topic rests on: **the answer is the worst-case trial count, the adversary picks break-or-survive, and you must guarantee success for every possible critical floor.** Sum or average anywhere and the guarantee is void.
