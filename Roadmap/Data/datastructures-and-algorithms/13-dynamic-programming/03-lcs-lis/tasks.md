# Longest Common Subsequence (LCS) and Longest Increasing Subsequence (LIS) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the DP/patience logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs, and for reconstruction tasks verify the output is a valid (common / increasing) subsequence of the claimed length.**

---

## Beginner Tasks (5)

### Task 1 — LCS length (full table)

**Problem.** Implement `lcsLength(X, Y)` returning the length of the longest common subsequence using the `O(nm)` DP table.

**Input / Output spec.**
- Read `X` on one line, `Y` on the next.
- Print the single integer LCS length.

**Constraints.**
- `0 ≤ |X|, |Y| ≤ 2000`. ASCII characters.

**Hint.** Match → `dp[i-1][j-1]+1`; mismatch → `max(dp[i-1][j], dp[i][j-1])`. Index strings as `X[i-1]`, `Y[j-1]`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func lcsLength(X, Y string) int {
	// TODO: fill (n+1)x(m+1) table, return dp[n][m]
	return 0
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Scan()
	X := sc.Text()
	sc.Scan()
	Y := sc.Text()
	fmt.Println(lcsLength(X, Y))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int lcsLength(String X, String Y) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String X = sc.nextLine(), Y = sc.nextLine();
        System.out.println(lcsLength(X, Y));
    }
}
```

**Starter — Python.**
```python
import sys


def lcs_length(X, Y):
    # TODO
    return 0


def main():
    data = sys.stdin.read().split("\n")
    print(lcs_length(data[0], data[1]))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct length, verified by hand on a `4×4` example.
- `dp[0][*] = dp[*][0] = 0`.
- `O(nm)` time.

---

### Task 2 — LIS length, O(n²) DP

**Problem.** Implement `lisDP(a)` returning the length of the longest *strictly* increasing subsequence with the `O(n²)` DP.

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print the LIS length.

**Constraints.** `0 ≤ n ≤ 2000`, values fit in 32-bit.

**Hint.** `dp[i] = 1 + max(dp[j] for j<i if a[j]<a[i])`. Answer is `max(dp)` (or 0 if empty).

**Reference oracle (Python).**
```python
def lis_brute(a):
    from itertools import combinations
    best = 0
    for r in range(len(a), 0, -1):
        for idx in combinations(range(len(a)), r):
            vals = [a[i] for i in idx]
            if all(vals[i] < vals[i + 1] for i in range(len(vals) - 1)):
                return r
    return 0
```

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func lisDP(a []int) int {
	// TODO: dp[i] = 1 + max(dp[j] : j<i, a[j]<a[i]); return max
	return 0
}

func main() {
	rd := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(rd, &n)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(rd, &a[i])
	}
	fmt.Println(lisDP(a))
}
```

**Starter — Python.**
```python
import sys


def lis_dp(a):
    # TODO
    return 0


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    a = [int(x) for x in data[1:1 + n]]
    print(lis_dp(a))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Empty array returns 0.
- Matches `lis_brute` for `n ≤ 12`.
- `O(n²)`.

---

### Task 3 — LIS length, O(n log n) patience

**Problem.** Implement `lisFast(a)` returning the strict LIS length in `O(n log n)` using the patience / binary-search method.

**Input / Output spec.**
- Read `n`, then `n` integers. Print the LIS length.

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** Maintain a sorted `tails` array; for each `x`, find the leftmost `tails[p] >= x` (lower_bound). Append if none, else overwrite. Answer is `len(tails)`.

**Worked check.** `[10,9,2,5,3,7,101,18] → 4`. `[7,7,7] → 1` (strict). `[]→0`.

**Evaluation criteria.**
- Agrees with Task 2 (`lisDP`) on all small inputs.
- Runs `n = 10^6` in well under a second.
- `[7,7,7]` returns 1 (strict, not 3).

---

### Task 4 — Longest non-decreasing subsequence

**Problem.** Implement `lndsLength(a)` returning the longest *non-decreasing* subsequence length (equal neighbors allowed).

**Input / Output spec.**
- Read `n`, then `n` integers. Print the length.

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** Identical to Task 3 but use the leftmost `tails[p] > x` (upper_bound / `bisect_right`) so equal values extend a run.

**Worked check.** `[7,7,7] → 3` (vs strict 1). `[1,2,2,3] → 4`.

**Evaluation criteria.**
- `[7,7,7]` returns 3.
- Differs from strict LIS exactly on inputs with duplicates.
- `O(n log n)`.

---

### Task 5 — LCS reconstruction (return the actual string)

**Problem.** Implement `lcs(X, Y)` returning one actual longest common subsequence string (not just the length) via traceback.

**Input / Output spec.**
- Read `X`, then `Y`. Print one LCS string (may be empty).

**Constraints.** `0 ≤ |X|, |Y| ≤ 2000`.

**Hint.** Fill the table, then walk from `dp[n][m]`: diagonal + emit on match, else move toward the larger neighbor. Reverse the collected characters.

**Evaluation criteria.**
- The returned string is a subsequence of both `X` and `Y`.
- Its length equals `lcsLength(X, Y)` from Task 1.
- Empty inputs → empty string.

---

## Intermediate Tasks (5)

### Task 6 — LCS length in O(min(n,m)) space

**Problem.** Implement `lcsLenTwoRow(X, Y)` computing the LCS length using only two rows of `O(min(n,m))` width.

**Constraints.** `0 ≤ |X|, |Y| ≤ 50000` (length only; the full table would be too large).

**Hint.** Orient so the shorter string indexes the columns. Keep `prev` and `cur` rows; swap (and reset) each outer iteration.

**Starter — Python.**
```python
def lcs_len_two_row(X, Y):
    if len(Y) > len(X):
        X, Y = Y, X
    m = len(Y)
    prev = [0] * (m + 1)
    cur = [0] * (m + 1)
    for i in range(1, len(X) + 1):
        for j in range(1, m + 1):
            # TODO: match -> prev[j-1]+1 ; else max(prev[j], cur[j-1])
            pass
        prev, cur = cur, [0] * (m + 1)
    return prev[m]
```

**Starter — Java.**
```java
public class Task6 {
    static int lcsLenTwoRow(String X, String Y) {
        if (Y.length() > X.length()) { String t = X; X = Y; Y = t; }
        int m = Y.length();
        int[] prev = new int[m + 1], cur = new int[m + 1];
        for (int i = 1; i <= X.length(); i++) {
            for (int j = 1; j <= m; j++) {
                // TODO
            }
            int[] tmp = prev; prev = cur; cur = tmp;
            java.util.Arrays.fill(cur, 0);
        }
        return prev[m];
    }
}
```

**Evaluation criteria.**
- Matches the full-table Task 1 length on all inputs.
- Peak memory is `O(min(n,m))`, not `O(nm)`.
- Handles `|X| ≫ |Y|` correctly.

---

### Task 7 — LIS reconstruction in O(n log n)

**Problem.** Implement `lisReconstruct(a)` returning one actual strict LIS (the subsequence) in `O(n log n)` using `tails_idx` + `parent` pointers.

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** When placing `a[i]` at position `p`: `parent[i] = tails_idx[p-1]` (or -1 if `p==0`), then set `tails_idx[p] = i`. Walk `parent` from `tails_idx[last]`, reverse.

**Reference oracle (Python).**
```python
def lis_brute_seq(a):
    from itertools import combinations
    for r in range(len(a), 0, -1):
        for idx in combinations(range(len(a)), r):
            vals = [a[i] for i in idx]
            if all(vals[k] < vals[k + 1] for k in range(len(vals) - 1)):
                return vals
    return []
```

**Evaluation criteria.**
- Output is strictly increasing.
- Its length equals `lisFast(a)` from Task 3.
- Matches the *length* of `lis_brute_seq` for small `n` (the exact sequence may differ on ties).

---

### Task 8 — LCS of two permutations via LIS

**Problem.** Given two arrays `X`, `Y` that are permutations of the same `n` distinct integers, compute their LCS length in `O(n log n)` via the reduction.

**Constraints.** `1 ≤ n ≤ 10^6`, distinct values.

**Hint.** Build `posInY`; relabel `X` to `B[i] = posInY[X[i]]`; the LIS of `B` is the LCS length. Verify against the `O(nm)` LCS on small `n`.

**Reference check (Python).**
```python
def lcs_dense(X, Y):
    n, m = len(X), len(Y)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = dp[i-1][j-1]+1 if X[i-1]==Y[j-1] else max(dp[i-1][j], dp[i][j-1])
    return dp[n][m]
```

**Evaluation criteria.**
- Matches `lcs_dense` on random small permutations.
- `O(n log n)` — handles `n = 10^6`.
- Correct on the identity permutation (`X == Y` → length `n`).

---

### Task 9 — Longest common substring (contiguous)

**Problem.** Implement `longestCommonSubstring(X, Y)` returning the length and one actual contiguous common substring.

**Constraints.** `0 ≤ |X|, |Y| ≤ 3000`.

**Hint.** Match → `dp[i-1][j-1]+1`; **mismatch → 0** (reset). Track the global max cell and its end index. Answer is **not** the corner.

**Worked check.** `("ABABC","BABCA") → (4,"BABC")`. `("ABC","DEF") → (0,"")`.

**Evaluation criteria.**
- Returns the max-cell length, not the corner.
- The returned substring is contiguous in both inputs.
- Distinguished from LCS: `("ABCBDAB","BDCAB")` substring ≤ subsequence.

---

### Task 10 — Count the number of LIS

**Problem.** Implement `countLIS(a)` returning a pair `(length, count)` where `count` is the number of distinct longest strictly increasing subsequences.

**Constraints.** `1 ≤ n ≤ 10^5`. Count may be large — return it modulo `10^9 + 7`.

**Hint.** For each index track `len[i]` (LIS ending at `i`) and `cnt[i]`. A Fenwick tree keyed by compressed value storing `(maxLen, summedCount)` gives `O(n log n)`; the `O(n²)` DP also works for `n ≤ 5000`.

**Worked check.** `[1,3,5,4,7] → (4, 2)` (`1,3,5,7` and `1,3,4,7`). `[2,2,2] → (1, 3)`.

**Evaluation criteria.**
- Correct `(length, count)` on the worked checks.
- Matches a brute-force enumeration for `n ≤ 12`.
- Count reduced mod `10^9 + 7`.

---

## Advanced Tasks (5)

### Task 11 — Hirschberg's linear-space LCS reconstruction

**Problem.** Implement `hirschberg(X, Y)` returning one actual LCS in `O(nm)` time and `O(min(n,m))` space (no full table).

**Constraints.** `0 ≤ |X|, |Y| ≤ 20000`.

**Hint.** Split `X` at the midpoint. Compute the forward LCS-length row of the first half vs `Y`, and the backward row of the reversed second half vs reversed `Y`. Find the split column `j*` maximizing `forward[j] + backward[m-j]`; recurse on the two quadrants and concatenate.

**Evaluation criteria.**
- The returned string is a common subsequence of both, of length `lcsLength(X, Y)`.
- Peak auxiliary memory is `O(min(n,m))` (two rows + recursion), not `O(nm)`.
- Matches the full-table traceback length on all inputs.

---

### Task 12 — Hunt–Szymanski sparse LCS

**Problem.** Implement `lcsSparse(X, Y)` computing the LCS length in `O((r + n) log n)` where `r` is the number of matching pairs, using per-symbol position lists fed into a patience LIS.

**Constraints.** `0 ≤ |X|, |Y| ≤ 10^5`; works best when symbols are mostly unique.

**Hint.** For each symbol, store the sorted list of its positions in `Y`. Scan `X`; for each `X[i]`, insert that symbol's `Y`-positions in **decreasing** order into the `tails` LIS structure (decreasing order prevents one `X` element from matching itself twice in a single increasing run). The LIS length is the LCS length.

**Evaluation criteria.**
- Matches the dense `O(nm)` LCS length on all inputs.
- On mostly-unique inputs, measurably faster than the dense DP.
- Document why positions are inserted in decreasing order.

---

### Task 13 — Myers diff length (edit distance via LCS)

**Problem.** Implement `editDistanceIndels(X, Y)` = the minimum number of single-character insertions and deletions to turn `X` into `Y`, using the identity `d = n + m − 2·lcs(X, Y)`.

**Constraints.** `0 ≤ |X|, |Y| ≤ 5000`.

**Hint.** Compute `lcs` (any method), then apply the formula. Optionally also reconstruct the edit script from the LCS traceback (matched chars are kept; unmatched `X` chars are deletions; unmatched `Y` chars are insertions).

**Worked check.** `("ABC","ABC") → 0`. `("ABC","AXC") → 2` (delete B, insert X). `("","ABC") → 3`.

**Evaluation criteria.**
- `d = n + m − 2·lcs` matches a direct indel-only edit DP.
- Applying the reconstructed script to `X` yields `Y`.
- Handles empty inputs.

---

### Task 14 — Maximum-sum increasing subsequence

**Problem.** Implement `maxSumIS(a)` returning the maximum *sum* over all strictly increasing subsequences (not the longest — the heaviest).

**Constraints.** `1 ≤ n ≤ 10^5`, values may be negative.

**Hint.** `best[i] = a[i] + max(best[j] for j<i if a[j]<a[i], else 0)`. The `O(n²)` DP is direct; for `O(n log n)` use a Fenwick tree keyed by compressed value storing prefix-max of `best`.

**Worked check.** `[1,101,2,3,100] → 106` (`1+2+3+100`). `[3,4,5,10] → 22`.

**Evaluation criteria.**
- Maximizes sum, not length (the two differ on the worked check).
- Matches the `O(n²)` DP on small inputs.
- Handles negatives.

---

### Task 15 — Classify the right algorithm

**Problem.** Write `classify(problem)` that, given `(kind, n, m, similarity, distinctSymbols)`, returns one of `LCS_FULL`, `LCS_TWO_ROW`, `HIRSCHBERG`, `LCS_VIA_LIS`, `HUNT_SZYMANSKI`, `MYERS`, `LIS_DP`, `LIS_PATIENCE`, or `LONGEST_COMMON_SUBSTRING`, with justification.

**Cases to handle.**
- LCS, small `n,m`, need string → `LCS_FULL`.
- LCS, length only, large → `LCS_TWO_ROW`.
- LCS, need string, large, memory-bound → `HIRSCHBERG`.
- LCS of two distinct-symbol permutations → `LCS_VIA_LIS`.
- LCS, sparse/mostly-unique matches → `HUNT_SZYMANSKI`.
- Diff of similar inputs (small edit distance) → `MYERS`.
- LIS, small `n` → `LIS_DP`.
- LIS, large `n` → `LIS_PATIENCE`.
- Contiguous common run → `LONGEST_COMMON_SUBSTRING`.

**Hint.** Encode the decision rules from `senior.md`. The contiguous case is the trap (use the substring recurrence, not LCS).

**Evaluation criteria.**
- Correctly classifies all nine canonical cases.
- Justification cites the right complexity (`O(nm)`, `O(n log n)`, `O(nd)`, `O((r+n) log n)`).
- The substring branch explicitly notes the reset-on-mismatch recurrence.

---

## Benchmark Task

### Task B — LIS `O(n²)` vs `O(n log n)` crossover

**Problem.** Empirically find the `n` at which the patience LIS overtakes the `O(n²)` DP. Implement both on a random array (fixed seed) and measure wall-clock time across `n ∈ {100, 1000, 5000, 10^4, 10^5, 10^6}` (run the `O(n²)` only where it finishes in reasonable time).

**Starter — Python.**
```python
import random
import time
from bisect import bisect_left
from typing import List


def gen_array(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(0, 10**9) for _ in range(n)]


def lis_dp(a):
    # TODO: O(n^2) DP
    return 0


def lis_fast(a):
    # TODO: O(n log n) patience
    return 0


def bench(fn, a) -> float:
    start = time.perf_counter()
    fn(a)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n            dp_ms            fast_ms")
    for n in [100, 1000, 5000, 10_000, 100_000, 1_000_000]:
        a = gen_array(n, 42)
        rb = [bench(lis_fast, a[:]) for _ in range(3)]
        if n <= 10_000:
            ra = [bench(lis_dp, a[:]) for _ in range(3)]
            print(f"{n:<12d} {mean_ms(ra):<16.2f} {mean_ms(rb):<14.2f}")
        else:
            print(f"{n:<12d} {'(skipped)':<16} {mean_ms(rb):<14.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same array across Go, Java, and Python.
- The `O(n²)` DP wins or ties for tiny `n`; patience wins decisively for large `n`. Report the crossover.
- Patience completes `n = 10^6` in well under a second; the `O(n²)` DP is infeasible there.
- Report includes the mean across at least 3 runs and does not time array generation.
- Writeup: a short note on the measured crossover vs theory (`n² ≈ n log n` is never literally equal; the constant factors decide, typically `n` in the low thousands).

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Run it on small inputs and diff before trusting the fast version.
- **For reconstruction tasks, verify the output.** Check the LCS is a subsequence of both inputs; check the LIS is actually increasing — and that the length matches the length-only computation.
- **Pin the strict/non-decreasing contract.** `lower_bound`/`bisect_left` = strict; `upper_bound`/`bisect_right` = non-decreasing. Test both with duplicate-containing inputs.
- **Never read the LIS off `tails`.** It tracks lengths; reconstruct via parent pointers.
- **Index strings carefully.** `dp[i][j]` is the prefix length; the characters are `X[i-1]`, `Y[j-1]`.
- **Keep subsequence and substring code separate.** Substring resets on mismatch and reads the max cell; LCS carries the max and reads the corner.
- **Mind memory.** Use two-row DP for length, Hirschberg for linear-space reconstruction; do not materialize `O(nm)` when inputs are large.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
