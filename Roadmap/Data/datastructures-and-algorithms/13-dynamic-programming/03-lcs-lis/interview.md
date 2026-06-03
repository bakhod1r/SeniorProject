# Longest Common Subsequence (LCS) and Longest Increasing Subsequence (LIS) — Interview Preparation

LCS and LIS are perennial interview favourites because they reward a single crisp recurrence and then test whether you can (a) reconstruct the actual subsequence, not just its length, (b) optimize LIS from `O(n²)` to `O(n log n)` with patience/binary search and *explain why it works*, (c) recognize the strict-vs-non-decreasing and subsequence-vs-substring distinctions, and (d) know the LCS↔LIS reduction for permutations. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| LCS length of `X`, `Y` | `O(nm)` DP table | `O(nm)` |
| Actual LCS string | traceback from corner | `O(nm)` time |
| LCS reconstruction, linear space | Hirschberg | `O(nm)` time, `O(min)` space |
| LIS length (simple) | `O(n²)` DP | `O(n²)` |
| LIS length / subsequence (fast) | patience + binary search | `O(n log n)` |
| Longest non-decreasing subsequence | patience with `upper_bound` | `O(n log n)` |
| LCS of two permutations | reduce to LIS | `O(n log n)` |
| Longest common **substring** | reset-on-mismatch DP | `O(nm)` |
| Diff / edit script (indels) | LCS, `d = n+m−2·lcs` | `O(nm)` or `O(nd)` Myers |

Core recurrences:

```text
LCS:  match  -> dp[i][j] = dp[i-1][j-1] + 1
      mismatch -> dp[i][j] = max(dp[i-1][j], dp[i][j-1])
      answer = dp[n][m]

LIS:  dp[i] = 1 + max(dp[j] : j<i, a[j]<a[i])    (O(n^2))
      patience: keep sorted tails[]; lower_bound for strict, upper_bound for non-decreasing
      answer = len(tails)

Substring (contiguous): match -> dp[i][j]=dp[i-1][j-1]+1 ; mismatch -> dp[i][j]=0 ; answer = max cell
```

Key facts:
- **Subsequence allows gaps; substring is contiguous.**
- LIS `tails` gives the **length**, not the subsequence — reconstruct with parent pointers.
- `lower_bound` (`>=`) → strict LIS; `upper_bound` (`>`) → non-decreasing.
- LCS is dual to indel edit distance: `lcs = (n + m − d) / 2`.

---

## Junior Questions (12 Q&A)

### J1. What is a subsequence, and how does it differ from a substring?
A subsequence keeps elements in order but **allows gaps** (`ACE` from `ABCDE`). A substring is **contiguous** (`BCD` from `ABCDE`). Every substring is a subsequence; not vice versa.

### J2. What does `dp[i][j]` mean in the LCS table?
The length of the LCS of the first `i` characters of `X` and the first `j` characters of `Y`. The full answer is `dp[n][m]`, the bottom-right corner.

### J3. State the LCS recurrence.
If `X[i-1] == Y[j-1]`: `dp[i][j] = dp[i-1][j-1] + 1` (match extends the diagonal). Else `dp[i][j] = max(dp[i-1][j], dp[i][j-1])` (drop one last character). Base: row 0 and column 0 are all 0.

### J4. How do you recover the actual LCS, not just its length?
Traceback from `dp[n][m]`: on a match move diagonally and emit the character; on a mismatch move toward the larger of the up/left neighbor. Reverse the collected characters at the end.

### J5. What is the LIS, with an example?
The longest subsequence of one array whose values strictly increase. For `[10,9,2,5,3,7,101,18]`, an LIS is `[2,3,7,101]`, length 4.

### J6. Give the `O(n²)` LIS recurrence.
`dp[i]` = longest increasing subsequence ending at `i` = `1 + max(dp[j] for j<i if a[j]<a[i])`, or 1 if none. Answer is `max(dp)`.

### J7. What does the `tails` array hold in the fast LIS?
`tails[k]` = the smallest possible tail value of any increasing subsequence of length `k+1` seen so far. It stays sorted, so binary search applies, and `len(tails)` is the LIS length.

### J8. Why is the fast LIS `O(n log n)`?
Each of the `n` elements does one binary search (`O(log n)`) into the sorted `tails` array plus one `O(1)` update.

### J9. Can you read the LIS directly off the `tails` array?
No. `tails` tracks lengths, and its values may come from incompatible positions. You need parent pointers to reconstruct the actual subsequence.

### J10. What is the difference between strict and non-decreasing LIS?
Strict requires `a < b < c`; non-decreasing allows equal neighbors (`a ≤ b ≤ c`). In code, strict uses `lower_bound` (`>=`), non-decreasing uses `upper_bound` (`>`).

### J11. What is the time complexity of LCS, and what dominates?
`O(nm)` — the product of the two lengths, one constant-time computation per table cell.

### J12 (analysis). Why does a match add 1 to the *diagonal* cell specifically?
Because a matched character uses up the last position of *both* prefixes, leaving the subproblem `(i-1, j-1)`. Adding it to the up or left cell would double-count or misalign positions.

---

## Middle Questions (12 Q&A)

### M1. Prove the LCS recurrence's match case.
If `X[i-1]=Y[j-1]=c`, some optimal LCS ends in `c` (else append `c` to get a longer one — contradiction). Removing that `c` leaves an LCS of `(i-1, j-1)`, so `dp[i][j] = dp[i-1][j-1] + 1`.

### M2. How do you reduce LCS space to `O(min(n,m))`?
Keep only two rows (previous and current), since each cell needs only the row above and the current row. Make the shorter string index the columns. This gives the length but loses the traceback table.

### M3. If two-row DP loses the traceback, how do you still reconstruct in linear space?
Hirschberg's algorithm: split `X` at its midpoint, compute forward and backward LCS-length rows, find the column where they sum to the max, and recurse on the two quadrants. `O(nm)` time, `O(min(n,m))` space.

### M4. Walk through why `tails` stays sorted.
If `tails[k] ≥ tails[k+1]`, the length-`(k+2)` subsequence achieving `tails[k+1]` has a second-to-last element smaller than `tails[k]`, giving a length-`(k+1)` subsequence with a smaller tail — contradicting that `tails[k]` is minimal. So `tails` is strictly increasing.

### M5. How do you reconstruct the actual LIS in `O(n log n)`?
Store `tails_idx[p]` = input index at `tails[p]`, and `parent[i] = tails_idx[p-1]` when placing `a[i]` at position `p`. Walk `parent` from `tails_idx[last]` backward, then reverse.

### M6. Explain the LCS↔LIS reduction for permutations.
For two distinct-symbol permutations, map each symbol to its position in `Y`, then scan `X` emitting those positions to form `B`. The LIS of `B` equals the LCS of `X` and `Y`. An increasing run in `B` is a set of symbols in both `X`-order and `Y`-order.

### M7. Why does the permutation reduction fail for general strings with repeats?
The position map becomes multivalued when a symbol repeats in `Y`. The general fix (Hunt–Szymanski) uses the list of positions in decreasing order, giving `O((r+n) log n)` where `r` is the match count.

### M8. Contrast the LCS and longest-common-substring recurrences.
Both add 1 to the diagonal on a match. On a mismatch, LCS carries `max(up, left)`; substring **resets to 0** (contiguity broken). LCS answer is the corner; substring answer is the max cell anywhere.

### M9. How is LCS related to edit distance?
For insertions and deletions only, the minimum edit script size is `d = n + m − 2·lcs`. Maximizing the common subsequence minimizes the edits, which is why `diff` is LCS reconstruction.

### M10. When is the `O(n²)` LIS preferable to `O(n log n)`?
When `n` is small, or when you need the per-index `dp` values for a richer query (e.g. max-sum increasing subsequence, count of LIS) that the plain patience method does not directly expose.

### M11. How do you count the number of distinct LIS?
Track, per index, both the longest length ending there and the number of ways. A Fenwick/segment tree over compressed values gives `O(n log n)`. The plain patience method gives length only.

### M12 (analysis). What is the expected LIS length of a random permutation of `n` elements?
Approximately `2√n` (Baik–Deift–Johansson / Vershik–Kerov). This is the order-theoretic backdrop connecting LIS to Young tableaux and the RSK correspondence.

---

## Senior Questions (10 Q&A)

### S1. You must diff two 100k-line files in bounded memory. How?
Hash lines to integers, then run LCS. Avoid the `O(nm)` table: use Myers' `O(nd)` diff (fast when files are similar) or Hirschberg for linear-space reconstruction. For mostly-unique lines, Hunt–Szymanski / patience diff is near-linear.

### S2. Why is patience diff considered higher quality than greedy LCS?
It first matches *unique* common lines (an LIS on their positions — the permutation reduction), anchoring the diff at unambiguous points, then recurses between anchors. This produces cleaner, more human-intuitive hunks than greedy LCS, especially with repeated boilerplate.

### S3. How does Myers' diff relate to LCS?
Myers minimizes the indel edit script in `O(nd)` time (`d` = edit count). Since `d = n + m − 2·lcs`, minimizing edits is maximizing the common subsequence — they are duals. Git uses Myers by default.

### S4. How would you handle LIS over a stream of millions of values?
Length-only patience LIS is a single pass with `O(L)` memory (just `tails`), so it streams. Reconstruction is *not* streaming — `parent` references input indices, so you must retain the data.

### S5. How do you support weighted/constrained LIS variants?
Use a Fenwick or segment tree keyed by coordinate-compressed value, storing the best DP value with a given last element; each element does an `O(log n)` prefix-max query and point update. This handles max-sum increasing subsequence, count-of-LIS, and 2D chains uniformly.

### S6. Can LCS be made subquadratic in general?
Not in the worst case (conditionally): a truly subquadratic LCS would refute SETH. Speedups exist only under structure — Hunt–Szymanski for sparse matches, Myers for small edit distance, the reduction for permutations. None beats `O(nm)` on adversarial dense input.

### S7. How do you verify an LCS/LIS implementation when inputs are large?
Keep a brute-force oracle for `n ≤ 12`. Crucially, **reconstruct and verify**: check the returned LCS is actually a subsequence of both inputs (and of the claimed length), and the returned LIS is actually increasing. Cross-check Hirschberg's length against the two-row DP.

### S8. What is the banded-DP optimization for LCS, and when does it apply?
When the optimal alignment stays near the diagonal (similar-length, similar-content inputs), restrict the DP to `|i−j| ≤ w`, giving `O(nw)`. If the alignment escapes the band, widen and retry. Standard in sequence aligners.

### S9. How does LCS generalize to scored sequence alignment?
Needleman–Wunsch (global) and Smith–Waterman (local) replace the unit `+1` match and plain `max` with match/mismatch substitution scores and gap penalties. LCS is the special case: match score 1, no mismatch contribution, no gap penalty.

### S10 (analysis). Why is the strict-vs-non-decreasing choice an API contract, not a detail?
The two return different numbers on inputs with duplicates ("longest strictly increasing" vs "longest non-decreasing run"). Callers depend on which one you compute, so it must be named, documented, and tested with duplicate-containing inputs.

---

## Professional Questions (8 Q&A)

### P1. Design a document-comparison service supporting millions of diffs.
Hash lines/tokens to ints. Route by input shape: small → full-table LCS; similar (small `d`) → Myers `O(nd)`; mostly-unique → patience/histogram diff; large needing alignment → Hirschberg for linear space. Cache line-hash tables; validate the reconstructed script reproduces the target. Log `(n, m, matches, d)` per request for anomaly detection.

### P2. The exact LCS of two genomes (10⁶ bp each) won't fit a `10¹²`-cell table. Options?
Hirschberg for linear-space exact LCS/alignment (`O(nm)` time, `O(min)` space); banded DP if sequences are similar (`O(nw)`); seed-and-extend heuristics (BLAST-style) when approximate is acceptable. Choose by required exactness and similarity.

### P3. How do you count the number of LIS modulo a prime for huge `n`?
Fenwick tree over compressed values storing `(maxLen, countAtThatLen mod p)`; each element queries the strictly-smaller prefix for the best length and summed count, then point-updates. `O(n log n)`. The count can be astronomically large, so reduce mod `p` (or use big integers if exact).

### P4. How would you debug "the diff looks wrong" in production?
Apply the reconstructed edit script to `X` and assert it yields `Y`; if not, the traceback or recurrence is buggy. Check the three usual suspects: off-by-one (`X[i-1]` vs `X[i]`), subsequence/substring confusion, and the strict/non-decreasing contract. For ugly-but-correct diffs, switch to patience/histogram for hunk quality.

### P5. When is the LCS↔LIS reduction the right tool in production?
When inputs are (near-)permutations of distinct symbols — e.g. matching *unique* lines in patience diff, or reconciling two orderings of distinct IDs. It turns `O(nm)` into `O(n log n)`. For repeated symbols, generalize to Hunt–Szymanski.

### P6. How do you parallelize a large batch of independent LCS/LIS jobs?
Each `(X, Y)` pair (or each array) is independent — distribute across workers. Within a single huge LCS, the anti-diagonals can be computed in parallel (cells on one anti-diagonal are independent), enabling wavefront parallelism; Hirschberg's two halves are also independent at each level.

### P7. How do automata / hashing connect to large-scale LCS?
Line/token hashing turns string LCS into integer LCS, enabling sparse methods. Suffix automata/trees give `O(n+m)` longest common *substring* (the contiguous cousin) — a different structure that exploits contiguity, which subsequence LCS cannot.

### P8 (analysis). Why does LIS have an `Ω(n log n)` lower bound while having an `O(n log n)` algorithm?
In the comparison model, computing LIS is at least as hard as element-distinctness-style problems, giving `Ω(n log n)`. The patience method matches it, so it is optimal. With bounded-integer keys, van-Emde-Boas-style structures can shave `log` factors, paralleling integer sorting.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n²)` algorithm with an `O(n log n)` one.
Look for a concrete LIS-style story: a quadratic scan that dominated a profile, the insight that a sorted auxiliary structure (`tails`) enabled binary search, the measured speedup, and the correctness check against the old version. Strong answers mention verifying the reconstructed subsequence, not just the length.

### B2. A teammate used the LCS recurrence for a "longest common contiguous run" feature and shipped wrong results. How do you handle it?
Explain subsequence vs substring calmly with a tiny example (`AB` is a common substring; `ACB` might be a longer common *subsequence*). Show the one-line fix (reset to 0 on mismatch, read the max cell). Frame it as a recurrence-choice teaching moment, not blame.

### B3. Design a feature that highlights the longest improving trend in a user's metrics.
This is LIS (or longest non-decreasing run, depending on the product definition). Discuss the strict-vs-non-decreasing contract explicitly, `O(n log n)` patience for speed, reconstruction via parent pointers to highlight the actual points, and streaming if data is live.

### B4. How would you explain LCS to a junior engineer?
Start from `diff`: the LCS is the lines two file versions share in order; everything else is an insertion or deletion. Then the recurrence: "if the last characters match, keep it and recurse on the rest; if not, try dropping each." Lead with the two gotchas: it counts *subsequences* (gaps allowed), and reconstruction means walking the table backward.

### B5. Your LIS service uses too much memory at scale. How do you investigate?
Check whether you keep the whole array when only the *length* is needed (length-only patience is `O(L)` memory). Confirm you are not materializing per-index `dp` for the simple query. For LCS, verify you are not holding the full `O(nm)` table when Hirschberg would do. Profile allocations; the fix is usually dropping unneeded reconstruction state.

---

## Coding Challenges

### Challenge 1: LCS Length and One Actual LCS

**Problem.** Given two strings `X` and `Y`, return the LCS length and one actual LCS string.

**Example.**
```text
X = "ABCBDAB", Y = "BDCAB"  ->  length 4, e.g. "BCAB"
X = "AGCAT",   Y = "GAC"    ->  length 2, e.g. "AC"
```

**Constraints.** `0 ≤ |X|, |Y| ≤ 2000`.

**Brute force.** Enumerate all subsequences of the shorter string — `O(2^min · ...)`, only for tiny inputs.

**Optimal.** `O(nm)` DP + traceback.

**Go.**
```go
package main

import "fmt"

func lcs(X, Y string) (int, string) {
	n, m := len(X), len(Y)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if X[i-1] == Y[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] >= dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}
	i, j := n, m
	buf := []byte{}
	for i > 0 && j > 0 {
		if X[i-1] == Y[j-1] {
			buf = append(buf, X[i-1])
			i--
			j--
		} else if dp[i-1][j] >= dp[i][j-1] {
			i--
		} else {
			j--
		}
	}
	for a, b := 0, len(buf)-1; a < b; a, b = a+1, b-1 {
		buf[a], buf[b] = buf[b], buf[a]
	}
	return dp[n][m], string(buf)
}

func main() {
	l, s := lcs("ABCBDAB", "BDCAB")
	fmt.Println(l, s) // 4 BCAB
}
```

**Java.**
```java
public class LcsFull {
    static Object[] lcs(String X, String Y) {
        int n = X.length(), m = Y.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                if (X.charAt(i - 1) == Y.charAt(j - 1))
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                else
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        StringBuilder sb = new StringBuilder();
        int i = n, j = m;
        while (i > 0 && j > 0) {
            if (X.charAt(i - 1) == Y.charAt(j - 1)) {
                sb.append(X.charAt(i - 1)); i--; j--;
            } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
            else j--;
        }
        return new Object[]{dp[n][m], sb.reverse().toString()};
    }

    public static void main(String[] args) {
        Object[] r = lcs("ABCBDAB", "BDCAB");
        System.out.println(r[0] + " " + r[1]); // 4 BCAB
    }
}
```

**Python.**
```python
def lcs(X, Y):
    n, m = len(X), len(Y)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if X[i - 1] == Y[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    i, j, out = n, m, []
    while i > 0 and j > 0:
        if X[i - 1] == Y[j - 1]:
            out.append(X[i - 1]); i -= 1; j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    return dp[n][m], "".join(reversed(out))


if __name__ == "__main__":
    print(lcs("ABCBDAB", "BDCAB"))  # (4, 'BCAB')
```

---

### Challenge 2: LIS Length and Subsequence in O(n log n)

**Problem.** Given an integer array, return the length of the longest *strictly* increasing subsequence and one actual such subsequence.

**Example.**
```text
[10,9,2,5,3,7,101,18] -> length 4, e.g. [2,3,7,101]
```

**Constraints.** `0 ≤ n ≤ 10^6`.

**Optimal.** Patience + binary search with parent pointers, `O(n log n)`.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func lis(a []int) (int, []int) {
	n := len(a)
	if n == 0 {
		return 0, nil
	}
	tails, tailsIdx := []int{}, []int{}
	parent := make([]int, n)
	for i := range parent {
		parent[i] = -1
	}
	for i, x := range a {
		p := sort.SearchInts(tails, x) // strict
		if p > 0 {
			parent[i] = tailsIdx[p-1]
		}
		if p == len(tails) {
			tails = append(tails, x)
			tailsIdx = append(tailsIdx, i)
		} else {
			tails[p] = x
			tailsIdx[p] = i
		}
	}
	res := []int{}
	for k := tailsIdx[len(tailsIdx)-1]; k != -1; k = parent[k] {
		res = append(res, a[k])
	}
	for l, r := 0, len(res)-1; l < r; l, r = l+1, r-1 {
		res[l], res[r] = res[r], res[l]
	}
	return len(tails), res
}

func main() {
	l, s := lis([]int{10, 9, 2, 5, 3, 7, 101, 18})
	fmt.Println(l, s) // 4 [2 3 7 101]
}
```

**Java.**
```java
import java.util.*;

public class LisFull {
    static Object[] lis(int[] a) {
        int n = a.length;
        if (n == 0) return new Object[]{0, new ArrayList<>()};
        List<Integer> tails = new ArrayList<>(), tailsIdx = new ArrayList<>();
        int[] parent = new int[n];
        Arrays.fill(parent, -1);
        for (int i = 0; i < n; i++) {
            int lo = 0, hi = tails.size();
            while (lo < hi) {
                int mid = (lo + hi) >>> 1;
                if (tails.get(mid) < a[i]) lo = mid + 1; else hi = mid;
            }
            if (lo > 0) parent[i] = tailsIdx.get(lo - 1);
            if (lo == tails.size()) { tails.add(a[i]); tailsIdx.add(i); }
            else { tails.set(lo, a[i]); tailsIdx.set(lo, i); }
        }
        LinkedList<Integer> res = new LinkedList<>();
        for (int k = tailsIdx.get(tailsIdx.size() - 1); k != -1; k = parent[k])
            res.addFirst(a[k]);
        return new Object[]{tails.size(), res};
    }

    public static void main(String[] args) {
        Object[] r = lis(new int[]{10, 9, 2, 5, 3, 7, 101, 18});
        System.out.println(r[0] + " " + r[1]); // 4 [2, 3, 7, 101]
    }
}
```

**Python.**
```python
from bisect import bisect_left


def lis(a):
    n = len(a)
    if n == 0:
        return 0, []
    tails, tails_idx, parent = [], [], [-1] * n
    for i, x in enumerate(a):
        p = bisect_left(tails, x)
        if p > 0:
            parent[i] = tails_idx[p - 1]
        if p == len(tails):
            tails.append(x); tails_idx.append(i)
        else:
            tails[p] = x; tails_idx[p] = i
    res, k = [], tails_idx[-1]
    while k != -1:
        res.append(a[k]); k = parent[k]
    return len(tails), res[::-1]


if __name__ == "__main__":
    print(lis([10, 9, 2, 5, 3, 7, 101, 18]))  # (4, [2, 3, 7, 101])
```

---

### Challenge 3: LCS of Two Permutations via LIS

**Problem.** Given two arrays that are permutations of the same `n` distinct values, return their LCS length in `O(n log n)` using the reduction.

**Example.**
```text
X = [3,1,2,4,5], Y = [1,2,3,4,5]  ->  4   (subsequence 1,2,4,5)
```

**Approach.** Map each value to its position in `Y`, relabel `X`, run LIS.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func lcsPerm(X, Y []int) int {
	posInY := make(map[int]int, len(Y))
	for i, v := range Y {
		posInY[v] = i
	}
	b := make([]int, 0, len(X))
	for _, v := range X {
		if p, ok := posInY[v]; ok {
			b = append(b, p)
		}
	}
	tails := []int{}
	for _, x := range b {
		p := sort.SearchInts(tails, x)
		if p == len(tails) {
			tails = append(tails, x)
		} else {
			tails[p] = x
		}
	}
	return len(tails)
}

func main() {
	fmt.Println(lcsPerm([]int{3, 1, 2, 4, 5}, []int{1, 2, 3, 4, 5})) // 4
}
```

**Java.**
```java
import java.util.*;

public class LcsPermInt {
    static int lcsPerm(int[] X, int[] Y) {
        Map<Integer, Integer> posInY = new HashMap<>();
        for (int i = 0; i < Y.length; i++) posInY.put(Y[i], i);
        List<Integer> tails = new ArrayList<>();
        for (int v : X) {
            if (!posInY.containsKey(v)) continue;
            int x = posInY.get(v), lo = 0, hi = tails.size();
            while (lo < hi) {
                int mid = (lo + hi) >>> 1;
                if (tails.get(mid) < x) lo = mid + 1; else hi = mid;
            }
            if (lo == tails.size()) tails.add(x); else tails.set(lo, x);
        }
        return tails.size();
    }

    public static void main(String[] args) {
        System.out.println(lcsPerm(new int[]{3, 1, 2, 4, 5}, new int[]{1, 2, 3, 4, 5})); // 4
    }
}
```

**Python.**
```python
from bisect import bisect_left


def lcs_perm(X, Y):
    pos_in_y = {v: i for i, v in enumerate(Y)}
    b = [pos_in_y[v] for v in X if v in pos_in_y]
    tails = []
    for x in b:
        p = bisect_left(tails, x)
        if p == len(tails):
            tails.append(x)
        else:
            tails[p] = x
    return len(tails)


if __name__ == "__main__":
    print(lcs_perm([3, 1, 2, 4, 5], [1, 2, 3, 4, 5]))  # 4
```

---

### Challenge 4: Longest Common Substring (the contiguous contrast)

**Problem.** Given two strings, return the length of their longest *contiguous* common substring and one such substring.

**Example.**
```text
X = "ABABC", Y = "BABCA"  ->  length 4, "BABC"
```

**Approach.** Reset-on-mismatch DP; track the max cell. Space-optimizable to two rows.

**Python.**
```python
def longest_common_substring(X, Y):
    n, m = len(X), len(Y)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    best, end_i = 0, 0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if X[i - 1] == Y[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
                if dp[i][j] > best:
                    best, end_i = dp[i][j], i
            # else dp stays 0 (contiguity reset)
    return best, X[end_i - best:end_i]


if __name__ == "__main__":
    print(longest_common_substring("ABABC", "BABCA"))  # (4, 'BABC')
```

**Go.**
```go
package main

import "fmt"

func longestCommonSubstring(X, Y string) (int, string) {
	n, m := len(X), len(Y)
	prev := make([]int, m+1)
	cur := make([]int, m+1)
	best, endI := 0, 0
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if X[i-1] == Y[j-1] {
				cur[j] = prev[j-1] + 1
				if cur[j] > best {
					best, endI = cur[j], i
				}
			} else {
				cur[j] = 0
			}
		}
		prev, cur = cur, prev
		for j := range cur {
			cur[j] = 0
		}
	}
	return best, X[endI-best : endI]
}

func main() {
	l, s := longestCommonSubstring("ABABC", "BABCA")
	fmt.Println(l, s) // 4 BABC
}
```

**Java.**
```java
public class LongestCommonSubstring {
    static Object[] lcsub(String X, String Y) {
        int n = X.length(), m = Y.length();
        int[][] dp = new int[n + 1][m + 1];
        int best = 0, endI = 0;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                if (X.charAt(i - 1) == Y.charAt(j - 1)) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                    if (dp[i][j] > best) { best = dp[i][j]; endI = i; }
                }
        return new Object[]{best, X.substring(endI - best, endI)};
    }

    public static void main(String[] args) {
        Object[] r = lcsub("ABABC", "BABCA");
        System.out.println(r[0] + " " + r[1]); // 4 BABC
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"LCS is an `O(nm)` match-or-max table; LIS is `O(n log n)` via a sorted `tails` array and binary search."*
- Immediately flag the distinctions: **subsequence vs substring** and **strict vs non-decreasing**.
- When asked to reconstruct, mention **traceback** for LCS and **parent pointers** for LIS — never read `tails` directly.
- For LCS of permutations, reach for the **LIS reduction** (`O(n log n)`); for memory-bound reconstruction, mention **Hirschberg**.
- Always offer to verify by reconstructing and checking the output is a valid (common / increasing) subsequence of the claimed length.
