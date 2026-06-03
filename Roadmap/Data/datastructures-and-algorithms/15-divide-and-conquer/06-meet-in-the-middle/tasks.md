# Meet in the Middle (MITM) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the split-and-combine logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle (enumerate all `2^n` subsets) on small inputs before trusting the MITM result.**

---

## Beginner Tasks (5)

### Task 1 — Enumerate all subset sums of one half

**Problem.** Implement `subsetSums(items)` that returns all `2^m` subset sums of `items` (including the empty subset, sum `0`). Build the list **incrementally** (each item doubles the list) for `O(2^m)` total work.

**Input / Output spec.**
- Read `m`, then `m` integers.
- Print the `2^m` subset sums in any order, space-separated.

**Constraints.**
- `0 ≤ m ≤ 20`, values up to `10^9`.
- Must use 64-bit sums.

**Hint.** Start with `out = [0]`; for each `x`, append `s + x` for every current `s`.

**Starter — Go.**
```go
package main

import "fmt"

func subsetSums(items []int64) []int64 {
	// TODO: incremental doubling, include empty subset (sum 0)
	return nil
}

func main() {
	var m int
	fmt.Scan(&m)
	items := make([]int64, m)
	for i := range items {
		fmt.Scan(&items[i])
	}
	sums := subsetSums(items)
	for i, v := range sums {
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
    static long[] subsetSums(long[] items) {
        // TODO
        return null;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int m = sc.nextInt();
        long[] items = new long[m];
        for (int i = 0; i < m; i++) items[i] = sc.nextLong();
        long[] sums = subsetSums(items);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < sums.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(sums[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def subset_sums(items):
    # TODO
    return []


def main():
    data = iter(sys.stdin.read().split())
    m = int(next(data))
    items = [int(next(data)) for _ in range(m)]
    print(" ".join(map(str, subset_sums(items))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns exactly `2^m` values (assert the count).
- Includes the empty subset (`0`).
- `O(2^m)` incremental build, not `O(2^m · m)`.

---

### Task 2 — Subset sum exists (MITM detection)

**Problem.** Given an array (`n ≤ 40`) and a target `S`, decide whether some subset sums to exactly `S`. Use MITM: enumerate halves, hash one, probe with the other.

**Input / Output spec.**
- Read `n`, `S`, then `n` integers.
- Print `YES` or `NO`.

**Constraints.** `1 ≤ n ≤ 40`, values and `S` up to `10^12`.

**Hint.** Split at `n/2`. Put left sums in a hash set; for each right sum `b`, check whether `S − b` is present. Remember the empty subset.

**Reference oracle (Python) — use this to validate.**
```python
def brute_exists(arr, S):
    n = len(arr)
    for mask in range(1 << n):
        s = sum(arr[i] for i in range(n) if mask & (1 << i))
        if s == S:
            return True
    return False
```

**Evaluation criteria.**
- `S = 0` returns `YES` (empty subset).
- Matches `brute_exists` for `n ≤ 18`.
- `O(2^(n/2))` average via hashing.

---

### Task 3 — Max subset sum ≤ capacity (knapsack, huge weights)

**Problem.** Given `n ≤ 40` weights (each up to `10^12`) and a capacity `C`, find the maximum subset sum that does **not exceed** `C`. (This is 0/1 knapsack where the value equals the weight, with weights too large for an `O(n·C)` table.)

**Input / Output spec.**
- Read `n`, `C`, then `n` weights.
- Print the maximum achievable sum `≤ C`.

**Constraints.** `1 ≤ n ≤ 40`, weights and `C` up to `10^12`.

**Hint.** Enumerate halves. Sort the right list. For each left sum `a ≤ C`, binary-search the largest `b ≤ C − a`; track `max(a + b)`.

**Worked check.** `weights = [15, 34, 4, 12, 5, 2], C = 20` → best subset sum not exceeding 20 (e.g. `{15, 5} = 20`).

**Evaluation criteria.**
- Never exceeds `C`.
- Matches a brute-force max for `n ≤ 18`.
- `O(2^(n/2) · n)`.

---

### Task 4 — Count subsets summing to exactly S

**Problem.** Given `n ≤ 40` integers and a target `S`, count how many subsets sum to exactly `S` (subsets are distinguished by which indices they use, so duplicates count separately).

**Input / Output spec.**
- Read `n`, `S`, then `n` integers.
- Print the count.

**Constraints.** `1 ≤ n ≤ 40`, values up to `10^9`.

**Hint.** Build a **frequency map** of left sums (`value → count`). For each right sum `b`, add `freqLeft[S − b]`. Do **not** use a plain `set` — it would collapse duplicate sums and undercount.

**Reference oracle (Python).**
```python
def brute_count_exact(arr, S):
    n = len(arr)
    cnt = 0
    for mask in range(1 << n):
        if sum(arr[i] for i in range(n) if mask & (1 << i)) == S:
            cnt += 1
    return cnt
```

**Evaluation criteria.**
- Uses a frequency map (handles duplicate sums with multiplicity).
- Matches `brute_count_exact` for `n ≤ 18`, including arrays with repeated values.
- `O(2^(n/2))` average.

---

### Task 5 — Partition into two equal-sum subsets

**Problem.** Given `n ≤ 40` positive integers, decide whether they can be split into two subsets of equal sum. (Equivalent to: does some subset sum to `total / 2`?)

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print `YES` or `NO`.

**Constraints.** `1 ≤ n ≤ 40`, values up to `10^12`.

**Hint.** If `total` is odd, answer `NO`. Otherwise run subset-sum detection (Task 2) with `S = total / 2`.

**Evaluation criteria.**
- Odd total → `NO` immediately.
- Matches brute force for `n ≤ 18`.
- Reuses the Task 2 MITM detection.

---

## Intermediate Tasks (5)

### Task 6 — Count subsets with sum ≤ S (two-pointer)

**Problem.** Given `n ≤ 44` integers and a bound `S`, count how many subsets have sum `≤ S`. Use MITM with the sort-both + two-pointer suffix count (not a loop over all subsets).

**Constraints.** `1 ≤ n ≤ 44`, values up to `10^9`, `S` up to `10^11`.

**Hint.** Sort both half-lists. Pointer `i` ascends over `left`, `j` descends over `right`. When `left[i] + right[j] ≤ S`, add `j + 1` (all `right[0..j]` qualify) and advance `i`.

**Reference oracle (Python).**
```python
def brute_count_leq(arr, S):
    n = len(arr)
    cnt = 0
    for mask in range(1 << n):
        if sum(arr[i] for i in range(n) if mask & (1 << i)) <= S:
            cnt += 1
    return cnt
```

**Evaluation criteria.**
- Includes the empty subset.
- Matches `brute_count_leq` for `n ≤ 18`.
- `O(2^(n/2))` after the sort (no per-subset loop).

---

### Task 7 — Subset sum closest to target

**Problem.** Given `n ≤ 40` integers and a target `S`, find the subset sum that minimizes `|sum − S|`. Output that closest sum.

**Constraints.** `1 ≤ n ≤ 40`, values and `S` up to `10^9` (may be negative).

**Hint.** Sort the right list. For each left sum `a`, binary-search `right` for the value nearest `S − a`; check both the predecessor and successor; track the best `|a + b − S|`.

**Reference oracle (Python).**
```python
def brute_closest(arr, S):
    n = len(arr)
    best = None
    for mask in range(1 << n):
        s = sum(arr[i] for i in range(n) if mask & (1 << i))
        if best is None or abs(s - S) < abs(best - S):
            best = s
    return best
```

**Evaluation criteria.**
- Checks both binary-search neighbors (predecessor and successor).
- Matches `brute_closest` for `n ≤ 18`.
- Handles negative values.

---

### Task 8 — 4-Sum to zero (count tuples)

**Problem.** Given four arrays `A, B, C, D` of length `N`, count tuples `(i, j, k, l)` with `A[i] + B[j] + C[k] + D[l] = 0`. Use MITM (split into two pairs).

**Constraints.** `1 ≤ N ≤ 500`, values up to `10^8`.

**Hint.** Enumerate all `A[i] + B[j]` into a frequency map (`N²` entries). For each `C[k] + D[l]`, add `freq[−(C[k] + D[l])]`. Total `O(N²)`.

**Reference oracle (Python).**
```python
def brute_four_sum(A, B, C, D):
    cnt = 0
    for a in A:
        for b in B:
            for c in C:
                for d in D:
                    if a + b + c + d == 0:
                        cnt += 1
    return cnt
# O(N^4) — use only for small N to validate.
```

**Evaluation criteria.**
- Matches `brute_four_sum` for `N ≤ 12`.
- `O(N²)` time and space.
- 64-bit sums (no overflow on `A[i] + B[j]`).

---

### Task 9 — Discrete logarithm (baby-step giant-step)

**Problem.** Given a prime `p`, base `a`, and target `b`, find the smallest `x ≥ 0` with `a^x ≡ b (mod p)`, or `-1` if none. Implement baby-step giant-step in `O(√p)`.

**Constraints.** `2 ≤ p ≤ 10^9` (prime), `gcd(a, p) = 1`.

**Hint.** `m = ⌈√p⌉`. Baby steps: store `b·a^j → j` for `j = 0..m−1`. Giant steps: compute `a^(i·m)` for `i = 0..m`, look up in the table; a hit gives `x = i·m − j`. Include `i = 0`.

**Reference oracle (Python).**
```python
def brute_discrete_log(a, b, p):
    cur = 1 % p
    for x in range(p):
        if cur == b % p:
            return x
        cur = cur * a % p
    return -1
# O(p) — use only for small p to validate.
```

**Evaluation criteria.**
- Round-trips: `pow(a, answer, p) == b % p` when an answer exists.
- Matches `brute_discrete_log` for small `p`.
- `O(√p)` time and space.

---

### Task 10 — Bidirectional BFS shortest path

**Problem.** Given an unweighted graph (adjacency list) and two vertices `s, t`, return the shortest-path length via bidirectional BFS. Return `-1` if unreachable.

**Constraints.** `1 ≤ V ≤ 2·10^5`, graph may be large; `s ≠ t` generally.

**Hint.** Run two BFS frontiers (forward from `s`, backward from `t`). Always expand the **smaller** frontier. When a newly discovered node is in the other side's visited set, return `df[u] + 1 + db[v]` (or the meeting distance). For directed graphs, use reverse adjacency for the backward side.

**Reference oracle (Python).**
```python
from collections import deque


def bfs_dist(adj, s, t):
    if s == t:
        return 0
    dist = {s: 0}
    q = deque([s])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if v not in dist:
                dist[v] = dist[u] + 1
                if v == t:
                    return dist[v]
                q.append(v)
    return -1
```

**Evaluation criteria.**
- Matches plain BFS distance on random graphs.
- Expands the smaller frontier each round.
- Returns `0` for `s == t`, `-1` for unreachable.

---

## Advanced Tasks (5)

### Task 11 — Schroeppel-Shamir low-memory subset sum

**Problem.** Solve subset-sum detection for `n ≤ 50` using only `O(2^(n/4))` memory, by splitting into four quarters and **generating** the two half-lists in sorted order via heaps (Schroeppel-Shamir), then two-pointer over the streamed sequences.

**Constraints.** `1 ≤ n ≤ 50`, values up to `10^15`.

**Hint.** Each half-sum is `qSum1 + qSum2` over two quarters. Use a min-heap to emit these sums in ascending order without materializing all `2^(n/2)` of them. Do the same for the other half (descending), and two-pointer to find `a + b = S`.

**Evaluation criteria.**
- Peak memory is `O(2^(n/4))`, not `O(2^(n/2))` (verify with a memory profiler).
- Matches naive MITM detection on the same inputs.
- Correctly handles the empty subset in each quarter.

---

### Task 12 — Reconstruct the chosen subset

**Problem.** Extend subset-sum detection to **report the actual subset** (list of chosen indices) that sums to `S`, or report none. Store the generating bitmask alongside each subset sum.

**Constraints.** `1 ≤ n ≤ 40`, values up to `10^12`.

**Hint.** Enumerate each half as `(sum, mask)` pairs. Sort the left pairs by sum. For each right `(b, maskR)`, binary-search left for `S − b`; on a hit, decode `maskL` (left indices) and `maskR` (right indices, offset by `mid`) into the chosen index list.

**Evaluation criteria.**
- The reported subset actually sums to `S` (verify by re-summing).
- Returns "none" correctly when no subset works.
- Sort keyed strictly on the sum (mask rides along).

---

### Task 13 — Max subset sum ≤ C with item-count limit

**Problem.** Given `n ≤ 40` weights, a capacity `C`, and a limit `K`, find the maximum subset sum `≤ C` using **at most `K` items**. Combine MITM with a per-popcount constraint.

**Constraints.** `1 ≤ n ≤ 40`, `0 ≤ K ≤ n`, weights and `C` up to `10^12`.

**Hint.** Enumerate each half as `(sum, popcount)` pairs. For the right half, bucket sums by popcount and keep, for each popcount, a sorted list. For each left `(a, pcL)`, you may use up to `K − pcL` items on the right; query the right buckets with popcount `≤ K − pcL` for the largest `b ≤ C − a`. Precompute per-popcount prefix maxima.

**Evaluation criteria.**
- Respects both the capacity `C` and the item limit `K`.
- Matches a brute-force search for `n ≤ 18`.
- Documents how the popcount buckets are queried.

---

### Task 14 — Count subsets summing to S, modulo a prime

**Problem.** Count subsets of `n ≤ 46` integers summing to exactly `S`, returning the count **modulo `10^9 + 7`** (the count itself may be large). Use MITM with frequency maps.

**Constraints.** `1 ≤ n ≤ 46`, values up to `10^9`.

**Hint.** Build the left frequency map (`value → count mod p`). For each right sum `b`, add `freqLeft[S − b]` to the answer, reducing mod `p`. The number of subsets can exceed `2^46`, so reduce as you go.

**Evaluation criteria.**
- Reduces the count mod `10^9 + 7`.
- Matches a brute-force modular count for `n ≤ 18`.
- Uses a frequency map (multiplicities preserved before reduction).

---

### Task 15 — Decide when MITM is the wrong tool

**Problem.** Given a problem's constraints `(n, W, query_type)`, implement `classify(n, W, query_type)` returning one of: `BRUTE_FORCE`, `MITM`, `DP`, `BRANCH_AND_BOUND`, or `INFEASIBLE`. Justify each decision.

**Constraints / cases to handle.**
- `n ≤ 20` → `BRUTE_FORCE`.
- `W ≤ 10^7` (any `n`) → `DP` (`O(n·W)`).
- Huge `W`, `n ≤ 45`, decision/counting → `MITM`.
- Huge `W`, optimization, good bounds → `BRANCH_AND_BOUND`.
- `n ≥ 60` (and huge `W`) → `INFEASIBLE` (memory wall).

**Hint.** Encode the decision rules from `senior.md` §3–4. The key discriminator is the magnitude of `W` and whether a worst-case guarantee is needed.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INFEASIBLE` branch cites the `O(2^(n/2))` memory wall.
- Justification references the right complexity (`O(2^(n/2))`, `O(n·W)`, `O(2^n)` pruned).

---

## Benchmark Task

### Task B — Brute force vs MITM crossover

**Problem.** Empirically find the `n` at which MITM overtakes brute force for subset-sum detection. Implement two workloads on a random array (fixed seed) with huge weights:

- **(a) Brute force:** enumerate all `2^n` subsets — `O(2^n · n)`.
- **(b) MITM:** enumerate halves, hash one, probe with the other — `O(2^(n/2))`.

Measure wall-clock time for `n ∈ {16, 20, 24, 28, 32, 36, 40}` (use brute force only for `n` that finish quickly). Report a table and identify the crossover `n`.

**Starter — Python.**
```python
import random
import time
from typing import List

MOD = 1_000_000_007


def gen_array(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(1, 10**12) for _ in range(n)]


def brute_exists(arr, S):
    # TODO: enumerate all 2^n subsets; O(2^n · n)
    return False


def subset_sums(items):
    # TODO: incremental doubling; O(2^m)
    return [0]


def mitm_exists(arr, S):
    # TODO: split, hash left, probe right; O(2^(n/2))
    return False


def bench_brute(arr, S) -> float:
    start = time.perf_counter()
    brute_exists(arr, S)
    return time.perf_counter() - start


def bench_mitm(arr, S) -> float:
    start = time.perf_counter()
    mitm_exists(arr, S)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n     brute_ms        mitm_ms")
    for n in [16, 20, 24, 28, 32, 36, 40]:
        arr = gen_array(n, 42)
        S = sum(arr) // 3
        rb = [bench_mitm(arr, S) for _ in range(3)]
        if n <= 28:
            ra = [bench_brute(arr, S) for _ in range(3)]
            print(f"{n:<5d} {mean_ms(ra):<15.2f} {mean_ms(rb):<10.2f}")
        else:
            print(f"{n:<5d} {'(skipped)':<15} {mean_ms(rb):<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same array across Go, Java, and Python.
- Brute force (a) wins or ties for tiny `n`; MITM (b) wins for large `n`. Report the crossover.
- MITM completes `n = 40` in well under a second; brute force is infeasible there.
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: a short note on the measured crossover `n` vs the theoretical one (where `2^(n/2)·n ≈ 2^n`, i.e. roughly `n/2 ≈ log₂(n)` overhead crossover — in practice around `n ≈ 24–30`).

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every counting/detection task above ships with (or references) a slow `2^n` oracle. Run it on small `n` (≤ 18), diff, and only then trust the MITM version on large `n`.
- **Include the empty subset.** Sum `0` is a valid subset; dropping it is the most common beginner bug.
- **Split evenly.** `⌈n/2⌉` and `⌊n/2⌋`; an unbalanced split wastes the speedup.
- **Use 64-bit sums.** In Go/Java cast to `int64`/`long` before adding; subset sums of big numbers overflow `int32`.
- **For counting, use a frequency map, not a `set`.** A `set` collapses duplicate sums and undercounts subsets.
- **Pick the combine to match the query.** Hashing for existence, sort + binary search for closest/≤-S, sort + two-pointer for counting.
- **Know the memory wall.** `2^(n/2)` int64 entries; `n = 50` is ~268 MB per half, `n = 60` is ~8 GB (infeasible). Stay under `n ≈ 50`, or use Schroeppel-Shamir (Task 11).
- **Choose MITM only when it fits.** Small weights → DP; tiny `n` → brute force; optimization with bounds → branch-and-bound.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.

