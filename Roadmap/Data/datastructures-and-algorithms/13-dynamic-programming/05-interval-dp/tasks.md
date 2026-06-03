# Interval DP (DP over Ranges `[i..j]`) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the interval-DP logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle (enumerate all parenthesizations / orderings) on small inputs before trusting the interval-DP result.**
> **Always fill the `dp` table by increasing interval length — never plain ascending `i, j`.**

---

## Beginner Tasks (5)

### Task 1 — Fill an interval table base case

**Problem.** Given `n`, allocate an `n × n` table `dp` and correctly initialize the length-1 base cases for matrix chain: `dp[i][i] = 0` for all `i`. Print the diagonal to confirm. This isolates the base-case step before any transitions.

**Input / Output spec.**
- Read `n`.
- Print `dp[0][0] dp[1][1] … dp[n-1][n-1]` space-separated (all zeros).

**Constraints.** `1 ≤ n ≤ 100`.

**Hint.** A 2D array of zeros already has `dp[i][i] = 0`, but write the loop explicitly to document intent.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	dp := make([][]int64, n)
	for i := range dp {
		dp[i] = make([]int64, n)
	}
	// TODO: set dp[i][i] = 0 explicitly (base case)
	for i := 0; i < n; i++ {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(dp[i][i])
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[][] dp = new long[n][n];
        // TODO: set dp[i][i] = 0 explicitly (base case)
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(' ');
            sb.append(dp[i][i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    dp = [[0] * n for _ in range(n)]
    # TODO: set dp[i][i] = 0 explicitly (base case)
    print(" ".join(str(dp[i][i]) for i in range(n)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Table allocated `n × n`; diagonal all zeros.
- Base case written explicitly (documents the length-1 intent).

---

### Task 2 — Matrix chain multiplication

**Problem.** Given `dims` of length `n+1` (so `n` matrices, `M_t` is `dims[t] × dims[t+1]`), output the minimum scalar multiplications. Use split-point interval DP filled by increasing length.

**Input / Output spec.**
- Read `m = n+1`, then `m` integers `dims`.
- Print the single number `dp[0][n-1]`.

**Constraints.** `2 ≤ m ≤ 500`, `1 ≤ dims[t] ≤ 500`. Use 64-bit accumulators.

**Hint.** `dp[i][j] = min_{k=i}^{j-1} dp[i][k]+dp[k+1][j]+dims[i]·dims[k+1]·dims[j+1]`; start `length` at 2.

**Reference oracle (Python) — use this to validate.**
```python
from functools import lru_cache

def brute_matrix_chain(dims):
    n = len(dims) - 1

    @lru_cache(maxsize=None)
    def solve(i, j):
        if i == j:
            return 0
        return min(solve(i, k) + solve(k + 1, j)
                   + dims[i] * dims[k + 1] * dims[j + 1]
                   for k in range(i, j))

    return solve(0, n - 1)
```

**Evaluation criteria.**
- `dims=[10,30,5,60] → 4500`.
- Matches `brute_matrix_chain` for small `n`.
- `O(n³)` time, fill by increasing length.

---

### Task 3 — Minimum cost to merge adjacent stone piles

**Problem.** Given `n` pile weights, merging two adjacent piles costs their sum. Merge all into one; output the minimum total cost. Use prefix sums for the range-sum cost.

**Input / Output spec.**
- Read `n`, then `n` weights.
- Print the minimum total merge cost.

**Constraints.** `1 ≤ n ≤ 500`, `1 ≤ weight ≤ 1000`.

**Hint.** `dp[i][j] = min_{k} dp[i][k]+dp[k+1][j]+sum(i..j)`. Hoist `sum(i..j)` out of the `k` loop. `n ≤ 1` → cost 0.

**Worked check.** `[4,1,1,4]` → `18`. `[1,2,3]` → `9` (merge `1,2` cost 3, then `3,3` cost 6).

**Evaluation criteria.**
- Uses prefix sums (no `O(n)` recompute inside the `k` loop).
- Matches a brute-force "merge all adjacent orders" oracle for small `n`.
- `O(n³)` time, `O(n²)` space.

---

### Task 4 — Maximum coins (burst balloons)

**Problem.** Given balloon values `nums`, bursting balloon `k` with current neighbors `L, R` earns `L·nums[k]·R`. Maximize total coins. Use the last-element interval DP on the padded array.

**Input / Output spec.**
- Read `n`, then `n` values.
- Print the maximum coins.

**Constraints.** `1 ≤ n ≤ 300`, `0 ≤ value ≤ 100`.

**Hint.** Pad with `1` on both ends; `dp[i][j]` covers the open range `(i, j)`; `k` (burst last) runs `i+1 .. j-1`; `dp[i][j] = max_k dp[i][k]+dp[k][j]+a[i]·a[k]·a[j]`.

**Reference oracle (Python).**
```python
def brute_burst(nums):
    from functools import lru_cache
    arr = tuple(nums)

    @lru_cache(maxsize=None)
    def solve(state):
        if not state:
            return 0
        best = 0
        for i in range(len(state)):
            left = state[i - 1] if i > 0 else 1
            right = state[i + 1] if i + 1 < len(state) else 1
            gain = left * state[i] * right
            rest = state[:i] + state[i + 1:]
            best = max(best, gain + solve(rest))
        return best

    return solve(arr)
# brute_burst([3,1,5,8]) == 167
```

**Evaluation criteria.**
- `[3,1,5,8] → 167`, `[1,5] → 10`.
- Matches `brute_burst` for `n ≤ 8`.
- Correct open-range bounds and sentinel padding.

---

### Task 5 — Palindrome substring table

**Problem.** Given a string `s`, compute the boolean table `pal[i][j]` = whether `s[i..j]` is a palindrome, using interval DP filled by increasing length. Output the number of palindromic substrings (count of `true` entries with `i ≤ j`).

**Input / Output spec.**
- Read `s`.
- Print the count of palindromic substrings.

**Constraints.** `1 ≤ len(s) ≤ 1000`.

**Hint.** `pal[i][j] = (s[i]==s[j]) and (j-i<2 or pal[i+1][j-1])`. Fill by length so `pal[i+1][j-1]` is ready.

**Worked check.** `"aaa"` has 6 palindromic substrings: `a,a,a,aa,aa,aaa`.

**Evaluation criteria.**
- `"aaa" → 6`, `"abc" → 3`.
- Fill order is by increasing length (reads the inner range).
- `O(n²)` time and space.

---

## Intermediate Tasks (5)

### Task 6 — Optimal binary search tree

**Problem.** Given sorted keys with access frequencies `freq[0..n-1]`, build a BST minimizing the expected access cost `Σ freq[t]·(depth(t)+1)`. Output the minimum cost. Use split-point interval DP with root = `k`.

**Input / Output spec.**
- Read `n`, then `n` frequencies.
- Print the minimum expected cost.

**Constraints.** `1 ≤ n ≤ 500`, `1 ≤ freq ≤ 10⁵`. Use 64-bit.

**Hint.** `dp[i][j] = min_{k=i}^{j} dp[i][k-1]+dp[k+1][j]+freqSum(i..j)` with empty-subtree base `dp[i][i-1]=0`. Use prefix sums for `freqSum`.

**Reference oracle (Python).**
```python
from functools import lru_cache

def brute_obst(freq):
    n = len(freq)

    @lru_cache(maxsize=None)
    def solve(i, j):
        if i > j:
            return 0
        s = sum(freq[i:j + 1])
        return min(solve(i, k - 1) + solve(k + 1, j) + s
                   for k in range(i, j + 1))

    return solve(0, n - 1)
```

**Evaluation criteria.**
- Matches `brute_obst` for small `n`.
- Uses prefix sums for `freqSum`.
- `O(n³)` time (Knuth `O(n²)` is a bonus, see Task 11).

---

### Task 7 — Reconstruct the matrix-chain parenthesization

**Problem.** Extend Task 2 to also output the optimal parenthesization (as a fully-parenthesized string like `((M0 M1) M2)`). Store the winning split per cell and walk it.

**Input / Output spec.**
- Read `dims`.
- Print the minimum cost on line 1, the parenthesization on line 2.

**Constraints.** `2 ≤ len(dims) ≤ 200`.

**Hint.** Maintain `split[i][j] = k` whenever `dp[i][j]` improves. Then `build(i,j)` returns `"Mi"` if `i==j`, else `"(" + build(i,split) + " " + build(split+1,j) + ")"`.

**Evaluation criteria.**
- Reconstructed string's implied cost equals `dp[0][n-1]` (round-trip check).
- `dims=[10,30,5,60]` → cost `4500`, parens `((M0 M1) M2)`.
- Reconstruction is `O(n)` after the `O(n³)` fill.

---

### Task 8 — Minimum cuts for palindrome partitioning

**Problem.** Given `s`, partition into palindromic substrings with the minimum number of cuts. Output that minimum. Build the palindrome interval table, then a linear cut DP.

**Input / Output spec.**
- Read `s`.
- Print the minimum number of cuts.

**Constraints.** `1 ≤ len(s) ≤ 2000`.

**Hint.** `pal[i][j]` by interval DP, then `cuts[j] = 0` if `pal[0][j]` else `min_{i} cuts[i-1]+1` over all `i` with `pal[i][j]`. Total `O(n²)`.

**Reference oracle (Python).**
```python
def brute_min_cut(s):
    n = len(s)
    from functools import lru_cache

    def is_pal(i, j):
        while i < j:
            if s[i] != s[j]:
                return False
            i += 1; j -= 1
        return True

    @lru_cache(maxsize=None)
    def solve(i):
        if i == n:
            return -1  # so the last segment adds 0 cuts
        best = float("inf")
        for j in range(i, n):
            if is_pal(i, j):
                best = min(best, 1 + solve(j + 1))
        return best

    return solve(0)
```

**Evaluation criteria.**
- `"aab" → 1`, `"abccba" → 0`, single char → 0.
- Matches `brute_min_cut` for `len(s) ≤ 12`.
- `O(n²)` overall.

---

### Task 9 — Stone game (two-player, take from either end)

**Problem.** Two players alternately take a stone pile from **either end** of the row; each grabs the value. Both play optimally to maximize their own total. Output (player1 total − player2 total) for the first player. Use interval DP.

**Input / Output spec.**
- Read `n`, then `n` values.
- Print the score difference (player1 − player2) under optimal play.

**Constraints.** `1 ≤ n ≤ 1000`, values may be negative.

**Hint.** `dp[i][j]` = best score difference the current player can achieve on `[i..j]`. `dp[i][j] = max(values[i] - dp[i+1][j], values[j] - dp[i][j-1])`. Base `dp[i][i] = values[i]`. Fill by increasing length.

**Reference oracle (Python).**
```python
from functools import lru_cache

def brute_stone_game(v):
    n = len(v)

    @lru_cache(maxsize=None)
    def solve(i, j):
        if i > j:
            return 0
        return max(v[i] - solve(i + 1, j), v[j] - solve(i, j - 1))

    return solve(0, n - 1)
```

**Evaluation criteria.**
- Matches `brute_stone_game` for small `n`.
- `[1,5,2] → 2`? verify against the oracle.
- `O(n²)` time and space.

---

### Task 10 — Minimum score triangulation of a polygon

**Problem.** Given a convex polygon with vertex values `v[0..n-1]`, triangulate it; each triangle `(i,k,j)` scores `v[i]·v[k]·v[j]`. Output the minimum total score over all triangulations. (A clean split-point interval DP.)

**Input / Output spec.**
- Read `n`, then `n` vertex values.
- Print the minimum triangulation score.

**Constraints.** `3 ≤ n ≤ 100`, `1 ≤ v ≤ 100`.

**Hint.** `dp[i][j]` = min score to triangulate the polygon spanned by vertices `i..j` (with edge `i–j`). `dp[i][j] = min_{i<k<j} dp[i][k]+dp[k][j]+v[i]·v[k]·v[j]`; base `dp[i][i+1]=0`. Fill by increasing `j-i`.

**Reference oracle (Python).**
```python
from functools import lru_cache

def brute_triangulation(v):
    n = len(v)

    @lru_cache(maxsize=None)
    def solve(i, j):
        if j - i < 2:
            return 0
        return min(solve(i, k) + solve(k, j) + v[i] * v[k] * v[j]
                   for k in range(i + 1, j))

    return solve(0, n - 1)
```

**Evaluation criteria.**
- `[1,2,3] → 6`, `[3,7,4,5] → 144`.
- Matches `brute_triangulation` for small `n`.
- `O(n³)` time.

---

## Advanced Tasks (5)

### Task 11 — Knuth-optimized optimal BST (O(n²))

**Problem.** Re-solve Task 6 in `O(n²)` using Knuth's optimization: track the optimal split `opt[i][j]` and restrict the `k` loop to `[opt[i][j-1], opt[i+1][j]]`. Verify the answer matches the `O(n³)` version.

**Constraints.** `1 ≤ n ≤ 3000`, `1 ≤ freq ≤ 10⁵`.

**Hint.** Initialize `opt[i][i] = i` and `dp[i][i] = freq[i]`. Fill by increasing length; for each `[i..j]` scan only the monotone window. **Cross-check** against the `O(n³)` baseline on random small inputs — if they ever differ, the QI precondition is violated.

**Evaluation criteria.**
- Identical answers to the `O(n³)` version on thousands of random small instances.
- `opt[i][j]` is monotone: `opt[i][j-1] ≤ opt[i][j] ≤ opt[i+1][j]` (assert it).
- Runs `n = 3000` in well under a second (the `O(n²)` win).

---

### Task 12 — Remove boxes (3D interval DP)

**Problem.** Boxes in a row with colors. Remove a maximal contiguous block of `c` same-colored boxes for `c²` points (remaining boxes close up). Maximize total points. Use the 3D state `dp[i][j][carry]`.

**Input / Output spec.**
- Read `n`, then `n` colors.
- Print the maximum score.

**Constraints.** `1 ≤ n ≤ 100`, colors in `[1, n]`.

**Hint.** `dp[i][j][c]` = best score for `[i..j]` with `c` boxes of color `box[i]` attached on the left. Either remove `box[i]` with its carry now (`(c+1)² + dp[i+1][j][0]`), or save it to merge with a later same-colored box `m` (`dp[i+1][m-1][0] + dp[m][j][c+1]`). Top-down memo with leading-run collapse keeps it tractable. `O(n⁴)`.

**Reference oracle (Python).**
```python
from functools import lru_cache

def brute_remove_boxes(boxes):
    # exponential brute force; only for n <= ~8
    def solve(arr):
        if not arr:
            return 0
        best = 0
        i = 0
        while i < len(arr):
            j = i
            while j + 1 < len(arr) and arr[j + 1] == arr[i]:
                j += 1
            run = j - i + 1
            rest = arr[:i] + arr[j + 1:]
            best = max(best, run * run + solve(rest))
            i = j + 1
        return best
    return solve(tuple(boxes))
```

**Evaluation criteria.**
- `[1,3,2,2,2,3,4,3,1] → 23`.
- Matches `brute_remove_boxes` for `n ≤ 8`.
- Uses the 3D state and documents why 2D fails.

---

### Task 13 — Generalized stone merging (merge exactly K adjacent at a time)

**Problem.** `n` piles; each move merges exactly `K` **consecutive** piles into one at a cost equal to their sum. Merge everything into one pile (possible only if `(n-1) mod (K-1) == 0`) minimizing total cost; output `-1` if impossible. (LeetCode 1000 generalization.)

**Constraints.** `1 ≤ n ≤ 30` (or up to 100 with care), `2 ≤ K ≤ n`, `1 ≤ weight ≤ 100`.

**Hint.** `dp[i][j]` = min cost to merge `[i..j]` into the fewest possible piles. Use a step of `K-1` in the split loop: `dp[i][j] = min_{k=i, k+=K-1} dp[i][k]+dp[k+1][j]`, and add `sum(i..j)` when the range can collapse to a single pile (`(j-i) mod (K-1) == 0`). Feasibility: `(n-1) mod (K-1) == 0`.

**Evaluation criteria.**
- `K=2, [4,1,1,4] → 18` (reduces to ordinary stone merging).
- Returns `-1` when `(n-1) mod (K-1) != 0`.
- Matches a brute-force merge-order oracle for small `n`.

---

### Task 14 — Verify the quadrangle inequality for a cost function

**Problem.** Implement `check_qi(w, n)` that, given a cost function `w(i, j)` over intervals of a length-`n` instance, tests the quadrangle inequality `w(a,c)+w(b,d) ≤ w(a,d)+w(b,c)` for all `a ≤ b ≤ c ≤ d` and monotonicity. Report whether Knuth's optimization is applicable. Run it on the range-sum cost (should pass) and a deliberately non-QI cost (should fail).

**Constraints.** `1 ≤ n ≤ 60` (the `O(n⁴)` check is fine at this size).

**Hint.** Brute-force all quadruples `a ≤ b ≤ c ≤ d`. A range-sum cost satisfies QI with equality; a cost like `w(i,j) = (j-i)²` may violate it — test both. This is a *diagnostic* tool you would run before trusting a Knuth-optimized solver.

**Evaluation criteria.**
- Correctly reports QI=true for range-sum costs.
- Correctly reports QI=false for a chosen non-QI cost.
- Also checks monotonicity `w(b,c) ≤ w(a,d)` for `[b,c] ⊆ [a,d]`.

---

### Task 15 — Classify the right tool for an interval-flavored problem

**Problem.** Given a problem's structural description, decide the right technique. Implement `classify(description)` returning one of: `INTERVAL_DP`, `KNUTH_OPT`, `DC_OPT`, `HUFFMAN_GREEDY`, `BITMASK_DP`, or `LINEAR_DP`. Justify each.

**Cases to handle.**
- Cheapest parenthesization / merge of **adjacent** elements → `INTERVAL_DP` (`O(n³)`).
- Same, with an endpoint-only cost satisfying QI → `KNUTH_OPT` (`O(n²)`).
- Partition a sequence into exactly `m` segments, monotone optimal cut → `DC_OPT` (`O(nm log n)`).
- Merge **any two** piles (not adjacent), min cost → `HUFFMAN_GREEDY` (`O(n log n)`).
- Optimum over arbitrary **subsets** (e.g., visited sets) → `BITMASK_DP` (`O(2ⁿ …)`).
- Optimum extends a **prefix** one element at a time → `LINEAR_DP` (`O(n)`/`O(n²)`).

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. The traps: adjacency-required (interval) vs any-two (Huffman); contiguous range (interval) vs arbitrary subset (bitmask).

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `HUFFMAN_GREEDY` and `BITMASK_DP` branches explicitly state why interval DP does *not* apply.
- Justification cites the right complexity for each.

---

## Benchmark Task

### Task B — Baseline O(n³) vs Knuth O(n²) crossover

**Problem.** Empirically measure where Knuth's optimization overtakes the `O(n³)` baseline for optimal BST. Implement three workloads on random frequency arrays (fixed seed):

- **(a) Baseline interval DP:** `O(n³)`, scan all splits per cell.
- **(b) Knuth-optimized:** `O(n²)`, scan the monotone split window.
- **(c) Correctness cross-check:** assert (a) and (b) agree.

Measure wall-clock for `n ∈ {50, 100, 200, 400, 800, 1600}` and report a table.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_freq(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(1, 1000) for _ in range(n)]


def prefix_sums(freq):
    p = [0]
    for f in freq:
        p.append(p[-1] + f)
    return p


def baseline_obst(freq) -> int:
    # TODO: O(n^3) interval DP, fill by increasing length
    return 0


def knuth_obst(freq) -> int:
    # TODO: O(n^2) with monotone opt[i][j] window
    return 0


def bench(fn, freq) -> float:
    start = time.perf_counter()
    fn(freq)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n      baseline_ms     knuth_ms     agree")
    for n in [50, 100, 200, 400, 800, 1600]:
        freq = gen_freq(n, 42)
        # baseline only for n that finish in reasonable time
        if n <= 800:
            rb = [bench(baseline_obst, freq) for _ in range(3)]
            base_ans = baseline_obst(freq)
        else:
            rb = None
            base_ans = None
        rk = [bench(knuth_obst, freq) for _ in range(3)]
        knuth_ans = knuth_obst(freq)
        agree = (base_ans is None) or (base_ans == knuth_ans)
        base_str = f"{mean_ms(rb):.2f}" if rb else "(skipped)"
        print(f"{n:<6d} {base_str:<15} {mean_ms(rk):<12.2f} {agree}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same frequency array across Go, Java, and Python.
- Baseline (a) and Knuth (b) always agree (the QI cross-check).
- Knuth (b) scales as `O(n²)`; baseline (a) as `O(n³)` — report the crossover and the speedup at `n = 800`.
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: a short note on the measured crossover and how it compares to the theoretical `O(n³)` vs `O(n²)` curves.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every task above ships with (or references) a slow oracle. Run it on small `n`, diff entrywise / by value, and only then trust the interval-DP version on larger inputs.
- **Fill by increasing interval length.** The most common bug is plain ascending `i, j`, which reads uncomputed cells. Use `j = i + length - 1` with `length` ascending.
- **Initialize cells to `±∞` before a min/max loop.** Leaving them at `0` makes `min` always pick `0` (wrong, too small).
- **Hoist range-sum costs with prefix sums.** Recomputing `sum(i..j)` inside the `k` loop turns `O(n³)` into `O(n⁴)`.
- **Pick split-point vs last-element framing deliberately.** Burst/remove problems need last-element (the last operation's neighbors are the stable boundaries); matrix chain / merging / BST need split-point.
- **Mind overflow.** Matrix products and accumulated costs can exceed 32-bit; use `int64`/`long`. Python is automatic.
- **Verify QI before using Knuth.** Applying the monotone window without the quadrangle inequality silently returns suboptimal answers — cross-check against the `O(n³)` baseline.
- **Add a 3rd state dimension only when the merge cost depends on external context** (removing boxes); confirm the 2D version is actually wrong first.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
