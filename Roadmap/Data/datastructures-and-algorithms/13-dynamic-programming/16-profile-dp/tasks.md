# Profile DP / Broken Profile DP (Tiling a Grid with a Frontier Bitmask) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the profile-DP logic and validate against the evaluation criteria.
> **Always test against a brute-force backtracking oracle on small grids before trusting the profile-DP result. Anchor checks: `2 × n` = Fibonacci `F(n+1)`, `8 × 8` = 12988816, odd area = 0.**

---

## Beginner Tasks (5)

### Task 1 — Single broken-profile step (one cell transition)

**Problem.** Implement `step(dp, r, c, n, m)` that, given the current per-mask counts `dp` (length `2^m`) at cell `(r, c)`, returns the next-cell counts `ndp` by applying the three transitions: filled→advance, free→vertical, free→horizontal. Reduce mod `10^9 + 7`.

**Input / Output spec.**
- Read `n`, `m`, `r`, `c`, then `2^m` integers for `dp`.
- Print `ndp` as `2^m` space-separated integers.

**Constraints.**
- `1 ≤ m ≤ 12`, `0 ≤ r < n`, `0 ≤ c < m`, entries in `[0, p)`.

**Hint.** `bit = 1<<c`. If `mask & bit`: `ndp[mask ^ bit] += dp[mask]`. Else: vertical `ndp[mask|bit]` if `r+1<n`; horizontal `ndp[mask|(1<<(c+1))]` if `c+1<m` and right cell free.

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func step(dp []int64, r, c, n, m int) []int64 {
	// TODO: apply filled/vertical/horizontal transitions, mod MOD
	return nil
}

func main() {
	var n, m, r, c int
	fmt.Scan(&n, &m, &r, &c)
	full := 1 << m
	dp := make([]int64, full)
	for i := range dp {
		fmt.Scan(&dp[i])
	}
	ndp := step(dp, r, c, n, m)
	for i, v := range ndp {
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
    static final long MOD = 1_000_000_007L;

    static long[] step(long[] dp, int r, int c, int n, int m) {
        // TODO
        return null;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), m = sc.nextInt(), r = sc.nextInt(), c = sc.nextInt();
        int full = 1 << m;
        long[] dp = new long[full];
        for (int i = 0; i < full; i++) dp[i] = sc.nextLong();
        long[] ndp = step(dp, r, c, n, m);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < full; i++) {
            if (i > 0) sb.append(' ');
            sb.append(ndp[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys

MOD = 1_000_000_007


def step(dp, r, c, n, m):
    # TODO
    return []


def main():
    data = iter(sys.stdin.read().split())
    n, m, r, c = (int(next(data)) for _ in range(4))
    full = 1 << m
    dp = [int(next(data)) for _ in range(full)]
    ndp = step(dp, r, c, n, m)
    print(" ".join(map(str, ndp)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct three-case transition, verified on a `2×3` first cell (`dp[0]=1`, rest 0 → two outputs set).
- No overflow (reduce after each add).
- Bounds guards `r+1<n` and `c+1<m` respected.

---

### Task 2 — Count domino tilings of n × m

**Problem.** Count domino tilings of an `n × m` grid, mod `10^9 + 7`, using the broken-profile sweep. Rotate so `m = min(n, m)` and reject odd area.

**Input / Output spec.**
- Read `n`, `m`. Print the count mod `p`.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ min(n,m) ≤ 16`.

**Hint.** Roll a `2^m` array cell by cell; answer is `dp[0]` after all cells.

**Reference oracle (Python) — use this to validate.**
```python
def brute_tilings(n, m):
    filled = [[False] * m for _ in range(n)]
    def first_free():
        for r in range(n):
            for c in range(m):
                if not filled[r][c]:
                    return r, c
        return None
    def rec():
        cell = first_free()
        if cell is None:
            return 1
        r, c = cell
        total = 0
        if r + 1 < n and not filled[r + 1][c]:
            filled[r][c] = filled[r + 1][c] = True
            total += rec()
            filled[r][c] = filled[r + 1][c] = False
        if c + 1 < m and not filled[r][c + 1]:
            filled[r][c] = filled[r][c + 1] = True
            total += rec()
            filled[r][c] = filled[r][c + 1] = False
        return total
    return rec()
```

**Evaluation criteria.**
- `2×3 → 3`, `2×4 → 5`, `8×8 → 12988816`.
- Matches `brute_tilings` for `n, m ≤ 6`.
- `O(n·m·2^m)`; rotates so `m` is the narrow dimension.

---

### Task 3 — 2 × n equals Fibonacci

**Problem.** Verify that your profile DP for a `2 × n` board returns `Fibonacci(n+1)` (with `F(1)=1, F(2)=1`). Read `n`, print both the profile-DP count and `F(n+1)` and confirm they match.

**Input / Output spec.**
- Read `n`. Print `count(2, n)` and `F(n+1)` mod `p` (they must be equal).

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Run `count_tilings(2, n)` and a simple iterative Fibonacci; assert equality.

**Worked check.** `n=1→1`, `n=2→2`, `n=3→3`, `n=4→5`, `n=5→8` (Fibonacci shape).

**Evaluation criteria.**
- The two values are equal for all tested `n`.
- Fibonacci computed iteratively mod `p`.
- Demonstrates the transfer-matrix `T = [[1,1],[1,0]]` intuition.

---

### Task 4 — Reject impossible boards

**Problem.** Given `n`, `m`, return the tiling count, but first short-circuit the impossible cases: odd area returns 0. Print a clear `0` for those and the real count otherwise.

**Input / Output spec.**
- Read `n`, `m`. Print the count (0 for odd area).

**Constraints.** `1 ≤ n, m ≤ 10^4` with `min(n,m) ≤ 14`.

**Hint.** `if (n*m) % 2 != 0: return 0` before allocating `2^m`.

**Evaluation criteria.**
- `1×1 → 0`, `3×3 → 0`, `1×2 → 1`, `1×3 → 0`.
- Odd-area check happens before allocation.
- Matches brute force for small grids.

---

### Task 5 — Tilings with blocked cells

**Problem.** Given an `n × m` grid where some cells are blocked (cannot be covered), count domino tilings of the *free* cells, mod `10^9 + 7`. A tiling must cover every free cell exactly once and never touch a blocked cell.

**Input / Output spec.**
- Read `n`, `m`, then `n` rows of `m` chars (`.` free, `#` blocked). Print the count.

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ min(n,m) ≤ 14`.

**Hint.** Treat a blocked cell as "already covered": when the sweep reaches it, advance (clear its bit) and never place a domino onto it. A vertical/horizontal landing on a blocked cell is illegal.

**Reference oracle (Python).**
```python
def brute_blocked(grid):
    n, m = len(grid), len(grid[0])
    filled = [[grid[r][c] == '#' for c in range(m)] for r in range(n)]
    def first_free():
        for r in range(n):
            for c in range(m):
                if not filled[r][c]:
                    return r, c
        return None
    def rec():
        cell = first_free()
        if cell is None:
            return 1
        r, c = cell
        total = 0
        if r + 1 < n and not filled[r + 1][c]:
            filled[r][c] = filled[r + 1][c] = True
            total += rec()
            filled[r][c] = filled[r + 1][c] = False
        if c + 1 < m and not filled[r][c + 1]:
            filled[r][c] = filled[r][c + 1] = True
            total += rec()
            filled[r][c] = filled[r][c + 1] = False
        return total
    return rec()
```

**Evaluation criteria.**
- Blocked cells are never covered by a domino.
- Matches `brute_blocked` for small grids.
- An odd number of free cells yields 0.

---

## Intermediate Tasks (5)

### Task 6 — Count grid independent sets

**Problem.** Count subsets of cells of an `n × m` grid with no two orthogonally adjacent cells selected, mod `10^9 + 7`. Use profile DP (bit `c` = "frontier cell in column `c` selected").

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ min(n,m) ≤ 16`.

**Hint.** At cell `(r,c)`: always allow skip (clear bit `c`); allow select only if up-neighbor (bit `c`) and left-neighbor (bit `c−1`) are unset. The answer **sums over all final masks** (every state is a valid endpoint).

**Reference oracle (Python).**
```python
def brute_indep(n, m):
    cells = [(r, c) for r in range(n) for c in range(m)]
    from itertools import product
    count = 0
    for choice in product([0, 1], repeat=len(cells)):
        sel = {cells[i] for i in range(len(cells)) if choice[i]}
        ok = True
        for (r, c) in sel:
            if (r + 1, c) in sel or (r, c + 1) in sel:
                ok = False
                break
        if ok:
            count += 1
    return count
# brute_indep(2,2) == 7 ; brute_indep(3,3) == 63
```

**Evaluation criteria.**
- `2×2 → 7`, `3×3 → 63`.
- Sums over all masks (not just `mask=0`).
- Matches `brute_indep` for `n·m ≤ 12`.

---

### Task 7 — Maximum-weight independent set on a grid

**Problem.** Given an `n × m` grid of non-negative weights, select non-adjacent cells maximizing total weight. Use profile DP with `max`-plus combine.

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ min(n,m) ≤ 16`, weights in `[0, 10^9]`.

**Hint.** Same skeleton as Task 6 but track the **maximum** total weight instead of summing counts; selecting `(r,c)` adds `weight[r][c]`. Use a sufficiently negative sentinel for unreachable masks.

**Evaluation criteria.**
- Matches a brute-force max over all independent subsets for small grids.
- Correctly forbids selecting adjacent cells.
- `O(n·m·2^m)`.

---

### Task 8 — Tilings for large n via transfer matrix

**Problem.** Given a tiny fixed `m` (`m ≤ 5`) and a huge `n` (up to `10^18`), count domino tilings of `n × m` mod `10^9 + 7` using transfer-matrix exponentiation.

**Constraints.** `1 ≤ m ≤ 5`, `1 ≤ n ≤ 10^18`.

**Hint.** Build `T[next][mask]` via a column recursion, then compute `(T^n)[0][0]` by binary exponentiation. Validate against the sweep for moderate `n`.

**Reference cross-check.** For `m=2`, `Z(2,n) = F(n+1)`; for any moderate `n`, the transfer-matrix result must equal the broken-profile sweep.

**Evaluation criteria.**
- `count(2, 8) == 34` (`F(9)`); matches the sweep for `n ≤ 100`.
- `O(8^m log n)`; instant for `n = 10^18`.
- Matrix built once; binary exponentiation correct.

---

### Task 9 — Tilings with L-trominoes

**Problem.** Count tilings of an `n × m` grid by L-trominoes (all 4 rotations), mod `10^9 + 7`. Return 0 if `n·m` is not divisible by 3.

**Constraints.** `1 ≤ n ≤ 12`, `1 ≤ m ≤ 12`, `min(n,m)` small.

**Hint.** Use a memoized recursion on `(pos, mask)` where the mask covers a 2-row band (`2m` bits), since an L-tromino spans at most 2 rows. At the first free cell, try each rotation that fits; advance and shift the window at row boundaries.

**Reference oracle (Python).**
```python
def brute_trominoes(n, m):
    SHAPES = [
        [(0, 0), (0, 1), (1, 0)],
        [(0, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (1, 1)],
        [(0, 0), (1, 0), (1, -1)],
    ]
    filled = [[False] * m for _ in range(n)]
    def first_free():
        for r in range(n):
            for c in range(m):
                if not filled[r][c]:
                    return r, c
        return None
    def rec():
        cell = first_free()
        if cell is None:
            return 1
        r, c = cell
        total = 0
        for shape in SHAPES:
            cells = [(r + dr, c + dc) for dr, dc in shape]
            if all(0 <= rr < n and 0 <= cc < m and not filled[rr][cc] for rr, cc in cells):
                for rr, cc in cells:
                    filled[rr][cc] = True
                total += rec()
                for rr, cc in cells:
                    filled[rr][cc] = False
        return total
    if (n * m) % 3 != 0:
        return 0
    return rec()
# brute_trominoes(2,3) == 2
```

**Evaluation criteria.**
- `2×3 → 2`, `3×2 → 2`; `n·m` not divisible by 3 → 0.
- Matches `brute_trominoes` for small grids.
- Frontier mask covers a 2-row band.

---

### Task 10 — Mixed dominoes and L-trominoes

**Problem.** Count tilings of an `n × m` grid using **both** dominoes (`1×2`) and L-trominoes, mod `10^9 + 7`. Any cell is covered by exactly one piece.

**Constraints.** `1 ≤ n ≤ 10`, `1 ≤ m ≤ 10`.

**Hint.** Union the transition sets of Task 2 (dominoes) and Task 9 (trominoes) at each free cell. Use the 2-row-band mask so both piece types fit.

**Evaluation criteria.**
- For `2×2`, count dominoes-only (2) plus any tromino placements (0, since trominoes can't tile a 4-cell board alone but can mix) — verify against a brute-force oracle that tries both piece types.
- Matches a combined brute-force oracle for small grids.
- Both piece types correctly enumerated at each free cell.

---

## Advanced Tasks (5)

### Task 11 — CRT-combined exact tiling count across two primes

**Problem.** Count domino tilings of `n × m` exactly when the true count may exceed `10^9 + 7`. Run the broken-profile sweep under two coprime primes (`10^9 + 7` and `998244353`) and reconstruct via CRT.

**Constraints.** `1 ≤ n ≤ 1000`, `min(n,m) ≤ 12`. Guarantee the true answer fits below `p₁·p₂`.

**Hint.** Run the identical sweep twice (once per prime), then apply two-prime CRT. The runs are independent and parallelizable.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t
```

**Evaluation criteria.**
- Recovers values larger than a single prime for small grids where the exact count is known (e.g. compare to Python big-int sweep without modulus).
- Both modular runs agree with `(exact) mod pᵢ`.
- `crt2` output matches the exact integer when it fits below `p₁·p₂`.

---

### Task 12 — Domino tilings with a per-column coloring constraint

**Problem.** Tile `n × m` with dominoes, but each horizontal domino must be one of `q` colors and no two horizontally adjacent (sharing a vertical edge) horizontal dominoes may share a color. Count colored tilings mod `10^9 + 7`. (A semiring/weighting extension of the basic count.)

**Constraints.** `1 ≤ n ≤ 100`, `min(n,m) ≤ 10`, `2 ≤ q ≤ 5`.

**Hint.** Multiply a weight factor into the transition when placing a colored horizontal domino, and extend the frontier to record the color of the most recent horizontal in each column so the adjacency-color constraint can be checked. This generalizes the additive transition to additive-with-multiplicative-weights.

**Evaluation criteria.**
- Reduces to the plain count when `q = 1` and the color constraint is dropped.
- Matches a brute-force colored-tiling oracle for small grids.
- Documents how the frontier was widened to carry color information.

---

### Task 13 — Cached transfer-matrix ladder for many large-n queries

**Problem.** Given a fixed tiny `m` and `Q` queries each asking for the tiling count of `n_q × m` (huge `n_q`), answer all queries efficiently by precomputing the transfer-matrix squaring ladder `T^{2^0}, T^{2^1}, …` once, then composing per query.

**Constraints.** `1 ≤ m ≤ 5`, `1 ≤ Q ≤ 10^5`, each `n_q ≤ 10^18`.

**Hint.** Precompute is `O(8^m · 60)`. Per query: multiply the ladder entries whose bits are set in `n_q` into a running matrix (start from identity), then read `[0][0]`. Even better, push the row vector `e_0` through the ladder in `O(4^m · popcount(n))` per query.

**Evaluation criteria.**
- Ladder built exactly once, reused across all queries.
- Per-query cost uses the cached ladder (not a fresh full power per query).
- Matches per-query independent transfer-matrix exponentiation.

---

### Task 14 — Profile DP on a board with forbidden cells and large n

**Problem.** Count domino tilings of an `n × m` grid where a *fixed periodic pattern* of cells is blocked every row (the same `m`-bit blocked-mask in every row), for astronomically large `n`. Build a transfer matrix that respects the per-row block pattern and exponentiate.

**Constraints.** `1 ≤ m ≤ 6`, `1 ≤ n ≤ 10^18`, a fixed `blocked` mask per row.

**Hint.** In the column recursion that builds `T`, skip blocked cells (treat them as pre-occupied so no piece covers them) — the per-row map is still fixed, so `(T^n)[start][start]` with the appropriate start mask gives the count. Define the start/end occupancy carefully given the blocked pattern.

**Evaluation criteria.**
- Reduces to the unblocked count when `blocked = 0`.
- Matches the broken-profile sweep (with the same per-row blocked cells) for moderate `n`.
- Correct handling of the block pattern in the row recursion.

---

### Task 15 — Decide when profile DP is the wrong tool

**Problem.** Given a problem statement, decide whether profile DP applies. Implement `classify(rows, cols, query_type, planar3d)` returning one of: `PROFILE_DP`, `TRANSFER_MATRIX`, `KASTELEYN_PFAFFIAN`, `BRUTE_FORCE`, or `INTRACTABLE`. Justify each.

**Constraints / cases to handle.**
- Small narrow dimension, moderate other, counting tilings → `PROFILE_DP`.
- Tiny narrow dimension, astronomically large other → `TRANSFER_MATRIX`.
- Both dimensions large, planar grid, domino tilings → `KASTELEYN_PFAFFIAN`.
- Tiny board overall → `BRUTE_FORCE` (oracle).
- Perfect matchings on 3D / non-planar graphs → `INTRACTABLE` (#P-complete).

**Hint.** Encode the decision rules from `middle.md`, `senior.md`, and `professional.md`. The intractable case is the trap: 3D / non-planar matching counting is #P-complete.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INTRACTABLE` branch explicitly cites #P-completeness of 3D/non-planar matching counting.
- Justification references the right complexity (`O(n·m·2^m)`, `O(8^m log n)`, `O((nm)^3)`).

---

## Benchmark Task

### Task B — Sweep vs transfer-matrix crossover

**Problem.** Empirically find the `n` at which transfer-matrix exponentiation overtakes the broken-profile sweep for a fixed tiny `m`. Implement two workloads on `m = 4`:

- **(a) Broken-profile sweep:** `O(n·m·2^m)`.
- **(b) Transfer-matrix exponentiation:** build `T` once (`O(8^m)`), then `(T^n)[0][0]` in `O(8^m log n)`.

Measure wall-clock time for `m = 4` across `n ∈ {10, 100, 1000, 10^4, 10^6, 10^9, 10^18}` (use huge `n` only for the matrix method). Report a table and identify the crossover `n`.

**Starter — Python.**
```python
import time
from typing import List

MOD = 1_000_000_007


def sweep(n: int, m: int) -> int:
    # TODO: broken-profile sweep, O(n*m*2^m)
    return 0


def build_T(m: int) -> List[List[int]]:
    # TODO: column recursion building T[next][mask]
    return []


def mat_pow_at00(T: List[List[int]], n: int) -> int:
    # TODO: binary exponentiation, return (T^n)[0][0]
    return 0


def bench_sweep(n: int, m: int) -> float:
    start = time.perf_counter()
    sweep(n, m)
    return time.perf_counter() - start


def bench_matexp(T: List[List[int]], n: int) -> float:
    start = time.perf_counter()
    mat_pow_at00(T, n)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    m = 4
    T = build_T(m)
    print("n              sweep_ms          matexp_ms")
    for n in [10, 100, 1000, 10_000, 1_000_000, 1_000_000_000, 10**18]:
        rb = [bench_matexp(T, n) for _ in range(3)]
        if n <= 1_000_000:
            ra = [bench_sweep(n, m) for _ in range(3)]
            print(f"{n:<14d} {mean_ms(ra):<17.2f} {mean_ms(rb):<14.4f}")
        else:
            print(f"{n:<14d} {'(skipped)':<17} {mean_ms(rb):<14.4f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same `m` produces the same `T` across Go, Java, and Python.
- Sweep (a) wins for small/moderate `n`; matrix exponentiation (b) wins for large `n`. Report the crossover.
- The matrix method completes for `n = 10^18` in well under a second at `m = 4`; the sweep is infeasible there.
- Report includes the mean across at least 3 runs and does not time matrix construction inside the per-`n` loop.
- Writeup: a short note on the measured crossover `n` and how it compares to the theoretical crossover (`n·m·2^m ≈ 8^m log n`).

---

## General Guidance for All Tasks

- **Always validate against the brute-force backtracking oracle first.** Run it on small grids, diff exactly, and only then trust the profile-DP version on large inputs.
- **Rotate so `m = min(rows, cols)`.** The cost is exponential in the narrow dimension; this one-line swap is the dominant correctness-of-performance decision.
- **Reject odd area immediately** (`(n*m) % 2 != 0 → 0` for dominoes; `% 3` for trominoes).
- **Get the final read right.** Domino tilings: answer is `dp[mask=0]` after all cells. Independent sets: sum over **all** masks.
- **Pin the modulus and sentinels as named constants.** `MOD = 10^9 + 7`; use a sufficiently negative sentinel for `max`-plus variants.
- **Mind overflow.** The domino transition is purely additive — reduce after each add. For weighted/colored variants, reduce after the multiply.
- **Reuse buffers.** Ping-pong two `2^m` arrays; do not allocate per cell.
- **Use the transfer matrix only for astronomically large `n` and tiny `m`.** Otherwise the linear sweep is simpler and faster.
- **Never use profile DP for 3D / non-planar matching counting.** That is #P-complete (Task 15).

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
