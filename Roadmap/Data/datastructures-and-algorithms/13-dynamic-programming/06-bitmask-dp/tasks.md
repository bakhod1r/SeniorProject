# Bitmask DP (DP over Subsets) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the bitmask-DP logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle (permutations / all matchings / all partitions) on small `n` before trusting the bitmask-DP result.**

---

## Beginner Tasks (5)

### Task 1 — Bit operation toolkit

**Problem.** Implement five functions over an integer `mask` and item index `i`: `has(mask, i)` (membership), `add(mask, i)`, `remove(mask, i)`, `toggle(mask, i)`, and `count(mask)` (popcount). These are the verbs every later task uses.

**Input / Output spec.**
- Read `n` (number of items), then `mask`, then `i`.
- Print: `has`, `add`, `remove`, `toggle`, `count`, one per line.

**Constraints.**
- `1 ≤ n ≤ 30`, `0 ≤ mask < 2^n`, `0 ≤ i < n`.

**Hint.** `has = mask & (1 << i)`; `add = mask | (1 << i)`; `remove = mask & ~(1 << i)`; `toggle = mask ^ (1 << i)`; popcount via the language's built-in.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func has(mask, i int) bool   { /* TODO */ return false }
func add(mask, i int) int    { /* TODO */ return 0 }
func remove(mask, i int) int { /* TODO */ return 0 }
func toggle(mask, i int) int { /* TODO */ return 0 }
func count(mask int) int     { return bits.OnesCount(uint(mask)) }

func main() {
	var n, mask, i int
	fmt.Scan(&n, &mask, &i)
	fmt.Println(has(mask, i))
	fmt.Println(add(mask, i))
	fmt.Println(remove(mask, i))
	fmt.Println(toggle(mask, i))
	fmt.Println(count(mask))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean has(int mask, int i)   { /* TODO */ return false; }
    static int add(int mask, int i)       { /* TODO */ return 0; }
    static int remove(int mask, int i)    { /* TODO */ return 0; }
    static int toggle(int mask, int i)    { /* TODO */ return 0; }
    static int count(int mask)            { return Integer.bitCount(mask); }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), mask = sc.nextInt(), i = sc.nextInt();
        System.out.println(has(mask, i));
        System.out.println(add(mask, i));
        System.out.println(remove(mask, i));
        System.out.println(toggle(mask, i));
        System.out.println(count(mask));
    }
}
```

**Starter — Python.**
```python
import sys


def has(mask, i):
    # TODO
    return False


def add(mask, i):
    # TODO
    return 0


def remove(mask, i):
    # TODO
    return 0


def toggle(mask, i):
    # TODO
    return 0


def count(mask):
    return bin(mask).count("1")


def main():
    n, mask, i = map(int, sys.stdin.read().split())
    print(has(mask, i))
    print(add(mask, i))
    print(remove(mask, i))
    print(toggle(mask, i))
    print(count(mask))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- All five operations correct, verified by hand on a 4-bit example.
- Uses shifts (`1 << i`), never `mask & i`.
- Popcount via the built-in.

---

### Task 2 — Iterate the set bits of a mask

**Problem.** Given `mask`, print the indices of its set bits in increasing order, using the clear-lowest-bit idiom (`mask & (mask - 1)`) and trailing-zeros, not a `0..n` scan.

**Input / Output spec.**
- Read `mask`. Print the set-bit indices space-separated (empty line if `mask = 0`).

**Constraints.** `0 ≤ mask < 2^31`.

**Hint.** Loop: `i = trailing_zeros(mask); print i; mask &= mask - 1` until `mask == 0`.

**Evaluation criteria.**
- For `mask = 13 (1101)` prints `0 2 3`.
- Uses bit peeling, not a linear scan.
- Handles `mask = 0` (no output).

---

### Task 3 — Held-Karp TSP (tour cost)

**Problem.** Given an `n × n` distance matrix, return the minimum cost of a tour starting/ending at city `0` and visiting every city once. Use `dp[mask][last]`.

**Input / Output spec.**
- Read `n`, then `n` rows of `n` integers (the matrix). Print the minimum tour cost.

**Constraints.** `1 ≤ n ≤ 16`, distances in `[0, 10^6]`.

**Hint.** Base `dp[1<<0][0] = 0`; recurrence extends by one city; final answer adds `dist[last][0]`. Initialise the rest to a large `INF`.

**Reference oracle (Python) — use this to validate.**
```python
from itertools import permutations


def tsp_brute(dist):
    n = len(dist)
    best = float("inf")
    for perm in permutations(range(1, n)):
        tour = [0] + list(perm) + [0]
        c = sum(dist[tour[i]][tour[i + 1]] for i in range(len(tour) - 1))
        best = min(best, c)
    return best
```

**Evaluation criteria.**
- Matches `tsp_brute` for `n ≤ 9`.
- `n = 1` returns `0`.
- `O(2^n · n^2)`.

---

### Task 4 — Assignment problem (`dp[mask]`)

**Problem.** Given an `n × n` cost matrix, assign each worker to a distinct job minimising total cost. Use a one-dimensional `dp[mask]` with worker index `= popcount(mask)`.

**Input / Output spec.**
- Read `n`, then the `n × n` cost matrix. Print the minimum total cost.

**Constraints.** `1 ≤ n ≤ 16`, costs in `[0, 10^6]`.

**Hint.** `dp[0] = 0`; for each `mask`, `i = popcount(mask)` is the next worker; try each unused job `j`. Answer is `dp[(1<<n)-1]`.

**Reference oracle (Python).**
```python
from itertools import permutations


def assign_brute(cost):
    n = len(cost)
    return min(sum(cost[i][p[i]] for i in range(n)) for p in permutations(range(n)))
```

**Evaluation criteria.**
- Matches `assign_brute` for `n ≤ 9`.
- One-dimensional `dp[mask]`; no separate worker dimension.
- `O(2^n · n)`.

---

### Task 5 — Iterate all submasks of a mask

**Problem.** Given `mask`, print all of its submasks in decreasing order, including `mask` itself and `0`, using the `sub = (sub - 1) & mask` idiom.

**Input / Output spec.**
- Read `mask`. Print each submask on its own line, from `mask` down to `0`.

**Constraints.** `0 ≤ mask < 2^20`.

**Hint.** `sub = mask; while sub > 0: print(sub); sub = (sub - 1) & mask`; then print `0`.

**Worked check.** For `mask = 5 (101)` the submasks are `5, 4, 1, 0`.

**Evaluation criteria.**
- Each submask printed exactly once, in decreasing order.
- Includes `mask` and `0`.
- Number of lines equals `2^popcount(mask)`.

---

## Intermediate Tasks (5)

### Task 6 — Count Hamiltonian paths

**Problem.** Given a directed adjacency matrix (`adj[i][j] ∈ {0,1}`), count Hamiltonian paths over all start/end vertices, mod `10^9 + 7`. Use `dp[mask][last]` with summation.

**Constraints.** `1 ≤ n ≤ 16`.

**Hint.** Base `dp[1<<s][s] = 1` for every `s`. Sum predecessors; answer `Σ_last dp[full][last]`.

**Reference oracle (Python).**
```python
from itertools import permutations


def count_ham_brute(adj):
    n = len(adj)
    cnt = 0
    for p in permutations(range(n)):
        if all(adj[p[i]][p[i + 1]] for i in range(n - 1)):
            cnt += 1
    return cnt
```

**Evaluation criteria.**
- For complete `K_n`, result is `n!`.
- Matches `count_ham_brute` for `n ≤ 8`.
- Counts reduced mod `10^9 + 7`.

---

### Task 7 — Shortest Hamiltonian path (no return)

**Problem.** Given an `n × n` distance matrix, find the minimum-cost path visiting every city exactly once, with **any** start and **any** end (no return to start). Use Held-Karp without the closing edge.

**Constraints.** `1 ≤ n ≤ 16`, distances in `[0, 10^6]`.

**Hint.** Initialise `dp[1<<s][s] = 0` for every `s` (any start). Answer is `min over last of dp[full][last]` — do not add a return edge.

**Reference oracle (Python).**
```python
from itertools import permutations


def shortest_ham_path_brute(dist):
    n = len(dist)
    best = float("inf")
    for p in permutations(range(n)):
        c = sum(dist[p[i]][p[i + 1]] for i in range(n - 1))
        best = min(best, c)
    return best
```

**Evaluation criteria.**
- Any-start, any-end (no return edge).
- Matches `shortest_ham_path_brute` for `n ≤ 9`.
- `O(2^n · n^2)`.

---

### Task 8 — Partition into K equal-sum subsets

**Problem.** Given `nums` and `k`, decide whether the array can be split into `k` non-empty subsets of equal sum. Use `dp[mask]` tracking the remainder toward the current bucket's target.

**Constraints.** `1 ≤ k ≤ n ≤ 16`, `nums[i] ≥ 1`.

**Hint.** If `sum % k != 0`, impossible. Target `= sum / k`. `dp[mask]` = used amount in the current (in-progress) bucket modulo target; a reachable `dp[full] == 0` means success.

**Reference oracle (Python).**
```python
def can_partition_brute(nums, k):
    # backtracking over buckets; correct but slow for large n
    total = sum(nums)
    if total % k:
        return False
    target = total // k
    nums.sort(reverse=True)
    buckets = [0] * k

    def back(i):
        if i == len(nums):
            return True
        for b in range(k):
            if buckets[b] + nums[i] <= target:
                buckets[b] += nums[i]
                if back(i + 1):
                    return True
                buckets[b] -= nums[i]
            if buckets[b] == 0:
                break
        return False

    return back(0)
```

**Evaluation criteria.**
- `nums=[4,3,2,3,5,2,1], k=4 → True`.
- Matches the backtracking oracle for small `n`.
- `O(2^n · n)`.

---

### Task 9 — Minimum number of groups (submask partition, O(3^n))

**Problem.** Given `n` items and a predicate `good[sub]` marking which subsets form a single valid group, find the minimum number of valid groups that exactly partition all items (or report impossible). Use submask enumeration.

**Constraints.** `1 ≤ n ≤ 16`. `good` is given as a boolean array of length `2^n`.

**Hint.** `dp[mask]` = fewest valid groups partitioning `mask`. `dp[mask] = min over submask sub of mask with good[sub] of dp[mask ^ sub] + 1`. `dp[0] = 0`. Overall `O(3^n)`.

**Evaluation criteria.**
- Returns the correct minimum count, or `INF`/`-1` if no partition exists.
- Uses the `sub = (sub - 1) & mask` idiom.
- `O(3^n)` total work.

---

### Task 10 — Set cover (minimum subsets to cover the universe)

**Problem.** Given a universe of `m` elements and a list of sets (each a bitmask over the `m` elements), find the minimum number of sets whose union is the full universe. Use `dp[coveredMask]`.

**Constraints.** `1 ≤ m ≤ 16`, up to `100` sets.

**Hint.** `dp[covered]` = fewest sets to reach the covered mask. For each `covered` and each set `S`, relax `dp[covered | S] = min(dp[covered | S], dp[covered] + 1)`. Answer `dp[(1<<m)-1]`. `O(2^m · #sets)`.

**Reference oracle (Python).**
```python
def set_cover_brute(m, sets):
    from itertools import combinations
    full = (1 << m) - 1
    for r in range(len(sets) + 1):
        for combo in combinations(sets, r):
            cov = 0
            for s in combo:
                cov |= s
            if cov == full:
                return r
    return -1
```

**Evaluation criteria.**
- Matches `set_cover_brute` on small instances.
- Returns `-1` (or `INF`) if the universe cannot be covered.
- `O(2^m · #sets)`.

---

## Advanced Tasks (5)

### Task 11 — Held-Karp with path reconstruction

**Problem.** Solve TSP (tour) and also **output the actual tour** (the sequence of cities), not just the cost. Store a parent pointer alongside `dp` and backtrack from the full mask.

**Constraints.** `1 ≤ n ≤ 16`.

**Hint.** Keep `parent[mask][last]` = the `prev` that achieved the minimum. After finding the best closing `last`, walk back: repeatedly `prev = parent[mask][last]; mask = mask ^ (1<<last); last = prev` until the mask is `{0}`.

**Evaluation criteria.**
- The reconstructed tour's summed cost equals the reported optimum.
- The tour starts and ends at `0` and visits every city once.
- Matches a brute-force best permutation for `n ≤ 9`.

---

### Task 12 — Exact Hamiltonian path count via CRT across two primes

**Problem.** Count Hamiltonian paths exactly when the count may exceed `10^9 + 7`. Run the counting DP under `10^9 + 7` and `998244353`, then reconstruct via CRT.

**Constraints.** `1 ≤ n ≤ 14`. The true count fits below `p₁·p₂`.

**Hint.** Run the identical `dp[mask][last]` count twice, once per prime. Combine the two residues with the two-prime CRT formula.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t
```

**Evaluation criteria.**
- Recovers counts larger than a single prime (e.g. `n!` for complete graphs).
- Both modular runs agree with `(true count) mod pᵢ`.
- `crt2` output equals the exact integer when below `p₁·p₂`.

---

### Task 13 — Broken-profile DP: count domino tilings

**Problem.** Count the ways to tile an `m × k` board with `1×2` dominoes, where `m` (the narrow dimension) is the profile width. Process column by column carrying a profile mask of protruding cells.

**Constraints.** `1 ≤ m ≤ 12`, `1 ≤ k ≤ 1000`. Answer mod `10^9 + 7`.

**Hint.** State = profile mask of which cells in the current column stick into the next. For each incoming profile, recursively fill the column placing horizontal dominoes (protrude right) and vertical dominoes (consume two rows). Cost `O(k · 2^m · transitions)`, memory `O(2^m)`.

**Worked check.** `count_tilings(2, 3) = 3`; `count_tilings(4, 4) = 36`; `count_tilings(3, 1) = 0` (odd cells).

**Evaluation criteria.**
- Correct counts for the worked checks above.
- Uses the narrow dimension as the mask width.
- Memory is `O(2^m)`, independent of `k`.

---

### Task 14 — Job scheduling: minimum makespan on identical machines

**Problem.** Given `n` jobs with durations and `M` identical machines, assign jobs to machines minimising the makespan (the maximum machine load). Model machine loads with a submask partition DP.

**Constraints.** `1 ≤ n ≤ 16`, `1 ≤ M ≤ n`.

**Hint.** Precompute `load[mask]` = total duration of the jobs in `mask`. Then `dp[m][mask]` = min makespan assigning `mask`'s jobs to `m` machines; `dp[m][mask] = min over submask sub of mask of max(dp[m-1][mask ^ sub], load[sub])`. Submask enumeration → `O(M · 3^n)`.

**Evaluation criteria.**
- Matches a brute-force assignment (try all `M^n` machine choices) for small `n`.
- Correctly minimises the maximum load, not the total.
- Uses submask enumeration; documents the `O(M · 3^n)` cost.

---

### Task 15 — Decide whether bitmask DP applies

**Problem.** Given a problem's parameters `(n, query_type, has_polynomial_structure)`, classify the right approach as one of: `BITMASK_DP`, `BRANCH_AND_BOUND`, `MEET_IN_THE_MIDDLE`, `HUNGARIAN`, `HEURISTIC`, or `INTRACTABLE`. Justify each decision and cite the complexity.

**Constraints / cases to handle.**
- Small `n` (≤ 18), subset state, exact → `BITMASK_DP` (`O(2^n · n^2)` or `O(2^n · n)`).
- `n` in the 20s–40s, exact, good lower bound → `BRANCH_AND_BOUND`.
- Splits into two independent halves, `n` up to ~40 → `MEET_IN_THE_MIDDLE` (`~2^{n/2}`).
- Min-cost matching, large `n` → `HUNGARIAN` (`O(n^3)`).
- Huge `n`, approximate acceptable → `HEURISTIC` (Christofides / Lin-Kernighan).
- State needs unbounded history / `n` huge, exact required, no structure → `INTRACTABLE`.

**Hint.** Encode the decision rules from `senior.md`. The trap is forcing `2^n` where a polynomial algorithm (Hungarian) or a heuristic fits.

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `INTRACTABLE` branch cites the `2^n` wall / NP-hardness.
- Justification references the right complexity for each branch.

---

## Benchmark Task

### Task B — Held-Karp vs brute force crossover

**Problem.** Empirically find the `n` at which Held-Karp overtakes brute-force permutation TSP. Implement two workloads on a random symmetric distance matrix (fixed seed):

- **(a) Brute force:** try all `(n−1)!` tours — `O(n!)`.
- **(b) Held-Karp:** `dp[mask][last]` — `O(2^n · n^2)`.

Measure wall-clock time for `n ∈ {6, 8, 10, 11, 12, 14, 16}` (run brute force only where it finishes in reasonable time). Report a table and identify the crossover `n`.

**Starter — Python.**
```python
import random
import time
from itertools import permutations
from typing import List

INF = float("inf")


def gen_dist(n: int, seed: int) -> List[List[int]]:
    r = random.Random(seed)
    d = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            w = r.randint(1, 100)
            d[i][j] = d[j][i] = w
    return d


def tsp_brute(dist):
    n = len(dist)
    best = INF
    for p in permutations(range(1, n)):
        tour = [0] + list(p) + [0]
        best = min(best, sum(dist[tour[i]][tour[i + 1]] for i in range(len(tour) - 1)))
    return best


def tsp_heldkarp(dist):
    # TODO: dp[mask][last]; O(2^n * n^2)
    return 0


def bench(fn, dist) -> float:
    start = time.perf_counter()
    fn(dist)
    return time.perf_counter() - start


def main() -> None:
    print("n     brute_ms        heldkarp_ms")
    for n in [6, 8, 10, 11, 12, 14, 16]:
        dist = gen_dist(n, 42)
        rb = sum(bench(tsp_heldkarp, [r[:] for r in dist]) for _ in range(3)) / 3 * 1000
        if n <= 11:
            ra = sum(bench(tsp_brute, dist) for _ in range(3)) / 3 * 1000
            print(f"{n:<5d} {ra:<15.2f} {rb:<12.2f}")
        else:
            print(f"{n:<5d} {'(skipped)':<15} {rb:<12.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same matrix across Go, Java, and Python.
- Brute force (a) wins or ties for very small `n`; Held-Karp (b) wins as `n` grows and is the only feasible method past `n ≈ 12`.
- Both methods agree on the optimum where both run.
- Report includes the mean across at least 3 runs and does not time matrix generation.
- Writeup: the measured crossover `n`, compared to the theoretical `(n−1)! vs 2^n n^2` crossover (around `n ≈ 10–12`).

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Permutations for TSP/Hamiltonian, all matchings for assignment, all partitions for grouping. Run on small `n`, diff exactly, then trust the bitmask DP.
- **Pin `INF` and `MOD` as named constants.** Use `INF` large enough that `INF + maxEdge` never overflows, and `MOD = 10^9 + 7` for counts; never inline magic numbers.
- **Get the base case and membership test right.** `dp[1<<0][0] = 0` (or `dp[0] = 0`); membership is `mask & (1 << i)`, never `mask & i`.
- **Respect the `2^n` wall.** Validate `n ≤ NMAX` before allocating `2^n`; estimate `2^n · cellBytes` and fail fast rather than OOM.
- **Match the operator to the goal.** `min` for cheapest, `+` (mod p) for counting, `OR`/reachability for feasibility, `max` for longest.
- **Use the canonical idioms.** Submask loop `sub = (sub - 1) & mask`; bit peeling `mask &= mask - 1`; hardware popcount.
- **Tour vs path.** A tour adds the return edge `dist[last][0]`; a path does not. Mixing them is a classic silent bug.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
