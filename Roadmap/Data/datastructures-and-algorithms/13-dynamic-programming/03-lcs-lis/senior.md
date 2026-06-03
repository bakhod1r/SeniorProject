# Longest Common Subsequence (LCS) and Longest Increasing Subsequence (LIS) — Senior Level

> On a small input LCS/LIS is never the bottleneck — but the moment you must `diff` two 100k-line files in bounded memory, align megabase DNA sequences, or compute LIS over a stream of millions, every detail (memory footprint, the `O(nm)` blowup, Hirschberg's linear-space reconstruction, sparse-match shortcuts, the strict-vs-non-decreasing contract) becomes a correctness or capacity incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [The Memory Wall and Hirschberg's Algorithm](#2-the-memory-wall-and-hirschbergs-algorithm) — memory budget, pitfalls
3. [LCS in Real Diff Tools](#3-lcs-in-real-diff-tools) — Myers, patience/histogram, line hashing
4. [Large-Input LIS](#4-large-input-lis) — streaming, BIT variants, 2D chains, count-of-LIS
5. [Sparse-Match LCS: Hunt–Szymanski](#5-sparse-match-lcs-huntszymanski) — routing by match density
6. [Variant Engineering: Strict, Weighted, Banded](#6-variant-engineering-strict-weighted-banded) — affine gaps
7. [Code Examples](#7-code-examples) — Hirschberg, streaming LIS, Fenwick count
8. [Observability and Testing](#8-observability-and-testing) — reconstruct-and-verify, diff round-trip
9. [Failure Modes](#9-failure-modes) — the eleven production traps
10. [Summary](#10-summary) — decision table

---

## 1. Introduction

At senior level the question is no longer "what is the recurrence" but "what system am I shipping, and what breaks at scale?" LCS and LIS appear in production in three recurring guises that share their DP core:

1. **Diff / version control** — LCS of two line sequences drives `git diff`, code review, three-way merge, and document comparison. Inputs are large (tens of thousands of lines), memory is bounded, and the output (the *edit script*) matters more than the length.
2. **Bioinformatics alignment** — LCS-flavoured DP aligns DNA/protein sequences of length 10⁴–10⁶; the `O(nm)` table is infeasible to store, forcing linear-space (Hirschberg / Myers) reconstruction and banded restrictions.
3. **Trend / scheduling analytics** — LIS over long numeric streams (longest improving run, box stacking, activity ordering), where `O(n log n)` and a single pass matter.

All three reduce to: *build the DP, but never materialize the full `O(nm)` table when `n·m` is large; reconstruct the answer in linear space; and exploit sparsity when matches are rare.* This document treats those production decisions.

The senior-level mental shift is from "I know the recurrence" to "I know which of five LCS algorithms to deploy, and why." The five — full table, two-row, Hirschberg, Hunt–Szymanski, Myers — are not interchangeable: each is optimal for a specific input shape (size, similarity, match density, whether you need the witness or just the length). Picking wrong is not a bug per se, but it is the difference between a diff that returns in milliseconds and one that OOMs or times out. The same applies to LIS: patience for length/speed, Fenwick/segment tree for weighted and counting variants, streaming when only the running length is needed.

---

## 2. The Memory Wall and Hirschberg's Algorithm

### 2.1 Why the `O(nm)` table is the problem

A `100 000 × 100 000` LCS table holds 10¹⁰ cells. At 4 bytes each that is 40 GB — impossible to keep in RAM. The two-row optimization (`middle.md`) gives the *length* in `O(min(n,m))` space, but throws away the table needed for the standard `O(n+m)` traceback. The production question is: **how do you reconstruct the actual LCS / edit script without the full table?** The answer is Hirschberg's divide-and-conquer.

### 2.2 Hirschberg's algorithm

Hirschberg (1975) computes the LCS (or its alignment) in `O(nm)` time but only `O(min(n,m))` space. The idea:

1. Split `X` in half at row `i = n/2`.
2. Compute the LCS-length row of `X[0..i)` vs all prefixes of `Y` (forward DP, one row).
3. Compute the LCS-length row of the *reversed* `X[i..n)` vs the *reversed* prefixes of `Y` (backward DP, one row).
4. The optimal split point `j*` in `Y` is the column maximizing `forward[j] + backward[m-j]`. This is where the LCS "crosses" the midline of `X`.
5. **Recurse** on the two quadrants: `(X[0..i), Y[0..j*))` and `(X[i..n), Y[j*..m))`. Concatenate the reconstructed pieces.

Each level does `O(nm)` work, and the work halves per level, so total time is `O(nm) + O(nm/2) + … = O(nm)`. Space is `O(m)` for the two rows plus `O(log n)` recursion stack — i.e. `O(min(n,m))` if you orient so `Y` is the shorter string. This is the algorithm real aligners (and many `diff` implementations) use to stay within memory.

The key invariant that makes step 4 correct: the optimal LCS, viewed as a path through the alignment grid, must cross the horizontal midline `i = n/2` at *some* column `j*`. The forward DP measures the best alignment of the top half ending at each column; the backward DP measures the best alignment of the bottom half starting at each column; their sum at `j*` is the best alignment that crosses there, and maximizing over `j*` finds the true crossing. This is a clean instance of the "meet in the middle" technique applied to a DP — and it is *why* divide-and-conquer recovers the path without storing the whole table.

### 2.3 When to reach for Hirschberg

| Situation | Approach |
|-----------|----------|
| Small inputs, memory ample | Full table + traceback (simplest) |
| Need length only | Two-row DP, `O(min(n,m))` space |
| Need the alignment, inputs large | **Hirschberg**, `O(nm)` time, `O(min(n,m))` space |
| Matches are sparse (mostly-unique lines) | Hunt–Szymanski / Myers (Section 5) |
| Very similar inputs (small edit distance) | Myers' `O(nd)` diff (`d` = edit count) |

Hirschberg trades a constant factor of time (it recomputes rows on recursion, roughly 2×) for an asymptotic memory win — almost always the right trade when `n·m` exceeds available RAM.

### 2.4 A concrete memory budget

Suppose you must align two 200,000-line files. The dense table is `2·10^5 × 2·10^5 = 4·10^{10}` cells; at 4 bytes that is 160 GB — out of the question. Hirschberg keeps two rows of `2·10^5` ints (`~1.6 MB` total) plus an `O(log n) ≈ 18`-frame recursion stack. That is a `10^5×` memory reduction for roughly `2×` the time. The decision rule is mechanical:

```
estimated_table_bytes = (n+1) * (m+1) * sizeof(cell)
if estimated_table_bytes > memory_budget * safety_factor:
    use Hirschberg (or Myers if inputs are likely similar)
else:
    use full table + traceback (simplest, fastest constant)
```

Wire this threshold into the service; do not let a single large diff OOM the process. Log the chosen path so you can tune `safety_factor` from real traffic.

### 2.5 Hirschberg pitfalls

- **Base cases.** The recursion must terminate cleanly at `len(X) ≤ 1` or `len(Y) == 0`; a missing single-character base case causes infinite recursion or wrong output. Test `("A","A")`, `("A","B")`, `("", "X")` explicitly.
- **Reversal correctness.** The backward pass reverses *both* the second half of `X` and the suffix of `Y`; an off-by-one in the reversal silently shifts the split column and yields a shorter (but plausible) result. Cross-check the reconstructed length against the two-row DP length on every input in testing.
- **Tie-breaking at the split.** Multiple columns may maximize `f(j) + g(j)`; any choice is correct for the *length*, but different choices yield different (equally optimal) LCS strings. If you need a deterministic witness across languages, pin the tie-break (e.g. smallest `j*`).

---

## 3. LCS in Real Diff Tools

### 3.1 `diff` is LCS reconstruction

The classic Unix `diff` and `git diff` compute the LCS of the two files' *line* sequences (each line hashed to an integer). Lines in the LCS are "unchanged"; lines in `X` but not the LCS are "deletions"; lines in `Y` but not the LCS are "insertions." The reconstructed alignment *is* the diff. So everything about LCS reconstruction (Section 2) is load-bearing for diff quality and memory.

### 3.2 Myers' algorithm: diff by edit distance

Plain `O(nm)` LCS is wasteful when files are *similar* (small number of edits `d`). **Myers' diff algorithm** (1986), the default in Git, runs in `O(nd)` time and `O(n)` space, where `d` is the size of the minimal edit script. It searches the edit graph along diagonals, expanding only as far as needed. For typical code changes (`d ≪ n`) this is dramatically faster than `O(nm)`. Myers and LCS are duals: minimizing insertions+deletions is the same as maximizing the common subsequence (`LCS = (n + m − d) / 2`).

### 3.3 Practical diff refinements

Real diff tools go beyond raw LCS for human readability:

- **Line hashing.** Hash each line to an `int`; compare hashes (with collision fallback) instead of strings — turns string LCS into integer LCS and enables the sparse methods.
- **Anchor / unique-line matching (patience diff).** Git's `--patience` matches *unique* common lines first (an LIS on their positions — exactly the permutation reduction from `middle.md`!), then recurses between anchors. This produces cleaner, more intuitive hunks than greedy LCS.
- **Histogram diff.** A refinement of patience that handles repeated lines better; the current Git default in many configs.
- **Whitespace / token normalization** before hashing.

Patience diff is the most striking production appearance of the LCS↔LIS reduction: the "unique common lines" form two permutations, and the longest set of them in consistent order is an LIS.

### 3.4 Worked patience-diff anchoring

Suppose two file versions share lines, with line IDs (hashes) shown. Unique lines common to both:

```
old: [a, b, X, c, Y, d]   unique-common: X (pos 2 in old), Y (pos 4 in old)
new: [a, b, Y, e, X, f]   unique-common: Y (pos 2 in new), X (pos 4 in new)
```

Map each unique-common line to its `(old_pos, new_pos)`: `X → (2, 4)`, `Y → (4, 2)`. Order by `old_pos`: `X(4), Y(2)` in new-positions `[4, 2]`. The LIS of `[4, 2]` is length 1 — so only *one* unique line can serve as a consistent anchor (here `X` or `Y`, not both, because they were reordered). Patience diff anchors on that single line and recurses on the segments around it, producing a diff that reflects the reorder cleanly rather than a confusing greedy interleave. This is exactly the LCS-of-permutations-via-LIS computation from `middle.md`, applied to line hashes.

### 3.5 Why hashing lines matters

String comparison per cell is `O(line length)`; hashing each line to a 64-bit int once (`O(total bytes)`) makes every subsequent comparison `O(1)`. For files with long lines this is a large constant-factor win, and it is *required* to feed the integer-based sparse algorithms (Hunt–Szymanski operates on symbol equality, cheapest as integer equality). Handle hash collisions by falling back to a full string compare on equal hashes — collisions are astronomically rare with a good 64-bit hash but must not cause a wrong diff.

### 3.6 Three-way merge builds on LCS

A three-way merge (`git merge`) compares a *base* version against two *derived* versions, each via LCS/diff against the base. Lines unchanged in both derivatives are kept; lines changed in exactly one are taken from that one; lines changed in *both* (overlapping hunks) are conflicts. The entire merge machinery sits on top of two LCS computations against the common ancestor. So LCS quality (clean hunks via patience/histogram) directly affects merge-conflict frequency and readability — a poor LCS produces spurious conflicts. This is why diff algorithm choice is a user-visible quality lever, not just a performance knob.

### 3.7 Word-level and semantic diff

Beyond line diff, code-review and document tools often diff at the *word* or *token* level within a changed line, and increasingly at the *syntax-tree* level (structural diff). All remain LCS at their core — the alphabet changes from lines to words to AST nodes, and the equality test changes accordingly, but the recurrence and reconstruction are identical. The senior insight: LCS is *alphabet-agnostic*; choosing the right granularity (line/word/token/node) is a product decision layered on the same algorithm.

---

## 4. Large-Input LIS

### 4.1 Streaming and memory

The patience LIS is already a single left-to-right pass with `O(n)` auxiliary space (the `tails` array, plus `parent`/`tails_idx` if you reconstruct). For **length-only** over a stream you need just `tails` — `O(L)` space where `L` is the current LIS length, often `≪ n`. This makes length-only LIS effectively streaming-friendly: you never need the whole array in memory if values arrive online and you only want the running LIS length.

### 4.2 Reconstruction needs the data

Reconstruction is *not* streaming: `parent[i]` references input indices, so you must retain the array (or enough of it) to walk pointers back. For truly huge inputs where you need the subsequence, store `parent` and `tails_idx` (both `O(n)` ints) and the array; that is unavoidable.

If the data does not fit in memory but you still need the witness, a two-pass scheme works: pass one computes the LIS *length* and the index `tails_idx[L-1]` of the last element of some optimal run (streaming, `O(L)` memory); pass two re-reads the data to recover predecessors. This trades a second I/O scan for bounded memory — the standard external-memory pattern when reconstruction is required on data exceeding RAM.

### 4.3 BIT / segment-tree LIS for weighted or constrained variants

The patience trick handles plain LIS. For variants — **maximum-sum increasing subsequence**, **count of LIS**, **LIS with values from a large/coordinate-compressed domain**, or **2D LIS (longest chain)** — the clean general tool is a **Fenwick tree (BIT) or segment tree** keyed by (compressed) value, storing the best DP value achievable with a given last element. Each element does an `O(log n)` prefix-max query and point update, giving `O(n log n)` for the whole family. Coordinate-compress values first so the tree is `O(n)` wide.

### 4.4 Number of LIS

A frequent senior interview/production extension: count *how many* distinct LIS exist. Maintain, alongside each `dp[i]` (length ending at `i`), a `cnt[i]` (number of such subsequences). With a BIT keyed by value you track both the max length and the summed count at that length in `O(n log n)`. The plain patience method does not directly give counts; the BIT formulation does.

**Worked count.** `A = [1, 3, 5, 4, 7]`. LIS length is 4, achieved by `1,3,5,7` *and* `1,3,4,7` — so the count is 2. The BIT-based DP, querying the strictly-smaller-value prefix for `(maxLen, summedCount)` at each element, produces `(4, 2)`. The `Java` implementation in Section 7.3 does exactly this. Note the count can overflow 64-bit on adversarial inputs (e.g. many equal-length chains), so reduce mod a prime when the exact value is not contractually required.

### 4.5 2D LIS / longest chain (envelope and box stacking)

Many production "ordering" problems are LIS in two (or more) dimensions: **box stacking** (each box must be strictly smaller in *both* width and height than the one below), **Russian-doll envelopes**, and **activity chains**. The technique:

1. Sort by the first dimension ascending; for ties, sort the second dimension *descending* (so equal-first-dimension items cannot chain, enforcing strictness).
2. Run LIS on the second dimension of the sorted list.

The descending tie-break is the subtle part: without it, two items with the same width could falsely chain. After sorting, a strictly increasing run in the second dimension is a valid 2D chain, so the `O(n log n)` patience LIS applies directly. This reduction — sort to linearize one dimension, LIS the other — generalizes to `k` dimensions via repeated reduction or a `(k-1)`-dimensional BIT, though the constant grows.

### 4.6 Memory and cache for large LIS

The patience LIS touches `tails` (size `≤ L`) and, for reconstruction, `parent`/`tails_idx` (size `n`). For `n = 10^8` ints, `parent` alone is 400 MB+ — if you only need the *length*, drop `parent` and keep just `tails` (`O(L)`, often kilobytes). The single biggest memory mistake at scale is retaining reconstruction state when only the length is wanted. For the value-keyed BIT variants, coordinate-compress first so the tree width is `n` rather than the value range.

---

## 5. Sparse-Match LCS: Hunt–Szymanski

When the two sequences share few matching positions (e.g. mostly-unique lines in source files), the dense `O(nm)` table wastes work on cells that can never matter. **Hunt–Szymanski** (1977) runs in `O((r + n) log n)` where `r` is the number of **matching pairs** `(i, j)` with `X[i] == Y[j]`. When `r ≪ nm` (sparse matches), this crushes `O(nm)`.

The mechanism: for each symbol, precompute the sorted list of its positions in `Y`. Walk `X`; for each `X[i]`, consider its matching `Y`-positions *in decreasing order* and feed them into a **patience-style LIS** structure over `Y`-positions. The LCS length is the resulting LIS length — again the LCS↔LIS reduction, generalized from permutations to arbitrary strings via per-symbol position lists. This is why `middle.md`'s reduction is not a curiosity: it is the theoretical core of the fastest practical LCS for sparse, diff-like inputs.

| Method | Time | Best when |
|--------|------|-----------|
| Full DP | `O(nm)` | small inputs, dense matches |
| Hirschberg | `O(nm)` time, `O(min)` space | large inputs, need alignment, dense |
| Hunt–Szymanski | `O((r+n) log n)` | sparse matches (mostly-unique symbols) |
| Myers | `O(nd)` | small edit distance `d` |

Choosing among these is the senior-level LCS decision; there is no single best — it depends on input shape (size, similarity, match density).

### 5.1 Worked Hunt–Szymanski intuition

`X = "abcabc"`, `Y = "cba"`. Per-symbol `Y`-positions: `a→[1]`, `b→[1... ]` — actually `Y = c(0) b(1) a(2)`, so `a→[2]`, `b→[1]`, `c→[0]`. Scan `X = a,b,c,a,b,c`, emitting each symbol's `Y`-positions (single position each, distinct symbols here) into the patience LIS:

```
a -> 2     tails=[2]
b -> 1     tails=[1]
c -> 0     tails=[0]
a -> 2     tails=[0,2]
b -> 1     tails=[0,1]
c -> 0     tails=[0]... (0 replaces 0, no change) -> tails=[0,1]
```

LIS length 2 → LCS length 2 (e.g. `"ba"` or `"ca"`). Here the match count `r` is small (6 matches), so this beats the `6×3 = 18`-cell dense DP. On files where most lines are unique, `r ≈ n` and Hunt–Szymanski is near-linear, while dense stays `O(nm)`. The decreasing-order insertion (when a symbol repeats in `Y`) is what keeps a single `X` element from matching itself twice — covered formally in `professional.md` §8.2.

### 5.2 Routing decision in code

```
matches = count_matching_pairs(X, Y)          # cheap with per-symbol position lists
if matches < 0.1 * n * m:        route = HUNT_SZYMANSKI   # sparse
elif likely_similar(X, Y):       route = MYERS            # small edit distance
elif table_fits_memory(n, m):    route = FULL_TABLE       # simplest
else:                            route = HIRSCHBERG       # memory-bound, dense
```

This router, fed by cheap pre-scans (match density, length similarity, memory budget), turns "which LCS algorithm" from a guess into a measured decision. Log the chosen route per request; a "dense" route on data you expected to be sparse is a signal your assumptions (or the data) shifted.

---

## 6. Variant Engineering: Strict, Weighted, Banded

### 6.1 The strict/non-decreasing contract is an API decision

`>=` vs `>` is not a micro-detail; it is a *contract*. Document explicitly whether your LIS is strictly increasing or non-decreasing, because callers depend on it (a "longest non-decreasing run" of sensor readings is a different number from "strictly increasing"). Bake it into the function name (`lisStrict`, `lndsLength`) or a flag, and test both.

A real example where the choice flips the answer dramatically: a stock-price series with long flat stretches. "Longest strictly increasing run" might be 3 (genuine rises), while "longest non-decreasing run" might be 40 (counting flat days). Shipping the wrong one is a *correctness* bug visible to users, not a rounding issue — which is why it deserves a named, tested contract rather than a silent `bisect_left` buried in a helper.

### 6.2 Banded LCS for near-diagonal alignments

When you know the alignment stays near the diagonal (similar-length, similar-content sequences — common in bioinformatics and version diffs), restrict the DP to a **band** of width `w` around the diagonal: `|i − j| ≤ w`. Cost drops to `O(n·w)` time and space. If the optimal alignment escapes the band you widen and retry (or detect via boundary hits). This is standard in sequence aligners (banded Needleman–Wunsch / Smith–Waterman).

### 6.3 Weighted / scored variants

Real alignment uses match/mismatch/gap *scores* (Needleman–Wunsch global alignment, Smith–Waterman local alignment) rather than the unit-cost LCS. The recurrence generalizes: instead of `+1` on match and `max` on mismatch, you add a substitution score and subtract gap penalties. LCS is the special case of unit match score, zero mismatch contribution, zero gap penalty. Senior engineers should recognize LCS as the simplest member of this scored-alignment family, and reach for the scored version when biology or domain weights matter.

### 6.4 Worked banded LCS

Align `X` and `Y`, both length 8, where you expect at most 1 net indel. Use band width `w = 1`, computing only cells with `|i − j| ≤ 1`:

```
        j=0 j=1 j=2 j=3 ...
i=0      ·   ·   -   -          (cells beyond |i-j|=1 are not computed)
i=1      ·   ·   ·   -
i=2      -   ·   ·   ·
i=3      -   -   ·   ·
...
```

Cost is `O(n·w) = O(8·3) = 24` cells instead of `64`. If the true alignment needs more than `w` net indels, a boundary cell of the band will carry the optimum and you detect the band is too narrow (the reconstructed alignment hits the band edge). The retry policy: double `w` and recompute until the optimal path stays interior, giving `O(n·d)` total where `d` is the true indel count — converging to Myers' bound. This is the standard adaptive-band strategy in production aligners.

### 6.5 Gap penalties change the recurrence shape

Unit-cost LCS treats every gap independently. Real alignment often uses **affine gap penalties** (`open` cost + `extend` cost per additional gap character), because a single long indel is biologically cheaper than many scattered ones. Affine gaps require *three* DP layers (match state, X-gap state, Y-gap state) — the Gotoh algorithm — still `O(nm)` but with a 3× constant. The senior takeaway: the moment requirements mention "prefer contiguous gaps" or "weighted edits," LCS is insufficient and you move up the alignment hierarchy (unit LCS → Levenshtein → Needleman–Wunsch → Gotoh affine). Choosing the *simplest* model that captures the requirement avoids needless constant-factor cost.

---

## 7. Code Examples

### 7.1 Python — Hirschberg's linear-space LCS reconstruction

```python
def _lcs_len_row(X, Y):
    """Last row of the LCS-length DP of X vs Y, in O(len(Y)) space."""
    prev = [0] * (len(Y) + 1)
    for i in range(len(X)):
        cur = [0] * (len(Y) + 1)
        for j in range(len(Y)):
            if X[i] == Y[j]:
                cur[j + 1] = prev[j] + 1
            else:
                cur[j + 1] = max(prev[j + 1], cur[j])
        prev = cur
    return prev


def hirschberg(X, Y):
    """Return one LCS of X and Y using O(min(len)) space, O(nm) time."""
    if len(X) == 0 or len(Y) == 0:
        return ""
    if len(X) == 1:
        return X if X in Y else ""
    mid = len(X) // 2
    scoreL = _lcs_len_row(X[:mid], Y)               # forward
    scoreR = _lcs_len_row(X[mid:][::-1], Y[::-1])   # backward
    # find split column j* in Y maximizing scoreL[j] + scoreR[m-j]
    m = len(Y)
    best_j, best_val = 0, -1
    for j in range(m + 1):
        v = scoreL[j] + scoreR[m - j]
        if v > best_val:
            best_val, best_j = v, j
    return hirschberg(X[:mid], Y[:best_j]) + hirschberg(X[mid:], Y[best_j:])


if __name__ == "__main__":
    print(hirschberg("AGCAT", "GAC"))  # an LCS of length 2, e.g. "AC"
```

### 7.2 Go — patience LIS over a large stream (length only, O(L) memory)

```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

// lisLength streams ints and returns the LIS length using O(L) memory.
func lisLength(next func() (int, bool)) int {
	tails := []int{}
	for {
		x, ok := next()
		if !ok {
			break
		}
		p := sort.SearchInts(tails, x) // strict
		if p == len(tails) {
			tails = append(tails, x)
		} else {
			tails[p] = x
		}
	}
	return len(tails)
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Split(bufio.ScanWords)
	next := func() (int, bool) {
		if !sc.Scan() {
			return 0, false
		}
		var v int
		fmt.Sscan(sc.Text(), &v)
		return v, true
	}
	fmt.Println(lisLength(next))
}
```

### 7.3 Java — Fenwick-tree LIS supporting count-of-LIS

```java
import java.util.*;

public class LisCount {
    // Returns {lisLength, numberOfLIS} in O(n log n) via a BIT over compressed values.
    static long[] lisWithCount(int[] a) {
        int n = a.length;
        if (n == 0) return new long[]{0, 0};
        int[] sorted = a.clone();
        Arrays.sort(sorted);
        // coordinate compress (distinct)
        Map<Integer, Integer> rank = new HashMap<>();
        int r = 0;
        for (int v : sorted) if (!rank.containsKey(v)) rank.put(v, ++r);

        int[] bestLen = new int[r + 1];   // BIT of max length over prefix
        long[] bestCnt = new long[r + 1]; // BIT of count at that max length
        int gLen = 0; long gCnt = 0;
        for (int x : a) {
            int idx = rank.get(x);
            // query prefix [1, idx-1] for best (len, cnt) of strictly smaller values
            int qLen = 0; long qCnt = 0;
            for (int i = idx - 1; i > 0; i -= i & (-i)) {
                if (bestLen[i] > qLen) { qLen = bestLen[i]; qCnt = bestCnt[i]; }
                else if (bestLen[i] == qLen) qCnt += bestCnt[i];
            }
            int curLen = qLen + 1;
            long curCnt = (qLen == 0) ? 1 : qCnt;
            // point update at idx
            for (int i = idx; i <= r; i += i & (-i)) {
                if (bestLen[i] < curLen) { bestLen[i] = curLen; bestCnt[i] = curCnt; }
                else if (bestLen[i] == curLen) bestCnt[i] += curCnt;
            }
            if (curLen > gLen) { gLen = curLen; gCnt = curCnt; }
            else if (curLen == gLen) gCnt += curCnt;
        }
        return new long[]{gLen, gCnt};
    }

    public static void main(String[] args) {
        long[] r = lisWithCount(new int[]{1, 3, 5, 4, 7});
        System.out.println("len=" + r[0] + " count=" + r[1]); // len=4 count=2 (1,3,5,7 and 1,3,4,7)
    }
}
```

---

## 8. Observability and Testing

An LCS/LIS result is opaque — a wrong length looks like any other number. Build verification in.

| Check | Why |
|-------|-----|
| Brute-force oracle (`O(2^n)`) on `n ≤ 12` | Catches recurrence and traceback bugs. |
| `LCS(X, "") == 0`, `LIS([]) == 0` | Base cases. |
| Reconstructed LCS *is* a subsequence of both | Validate the output, not just the length. |
| Reconstructed LIS is actually increasing (or non-decreasing) and has the claimed length | Catches `tails`/parent bugs. |
| `LCS(X, Y) == LCS(Y, X)` (length symmetry) | Property test. |
| Hirschberg output length == two-row DP length | Cross-check the linear-space path against the simple one. |
| Strict vs non-decreasing both tested on arrays with duplicates | The `>=`/`>` contract. |
| Permutation reduction == direct LCS on permutation inputs | Validates the `O(n log n)` shortcut. |

The single most valuable test: **reconstruct, then verify the reconstruction is a valid common subsequence (LCS) or valid increasing subsequence (LIS) of the claimed length.** Length-only tests miss traceback bugs entirely.

A second high-value test is the **diff round-trip**: take the reconstructed LCS, derive the edit script (kept = LCS chars, deleted = unmatched `X`, inserted = unmatched `Y`), apply it to `X`, and assert the result equals `Y`. A diff that does not round-trip is broken regardless of its length being correct — this is the production-grade correctness criterion, far stronger than a length check.

### 8.1 A property-test battery

```text
for random small X, Y (len <= 12):
    L, sub = lcs(X, Y)
    assert len(sub) == L
    assert is_subsequence(sub, X) and is_subsequence(sub, Y)
    assert L == lcs_brute(X, Y)
    assert L == lcs(Y, X)[0]                     # symmetry
for random small array a:
    L, sub = lis(a)
    assert len(sub) == L
    assert all(sub[i] < sub[i+1] for i in range(L-1))   # strict
    assert L == lis_brute(a)
```

### 8.2 Production guardrails

For a diff/alignment service: validate input sizes against a memory budget and *route* to Hirschberg or Myers above a threshold; assert the reconstructed alignment, when applied to `X`, reproduces `Y` (for diffs, apply the edit script and compare); log the chosen algorithm and the `(n, m, matches, edit-distance)` shape so anomalies (e.g. a "similar" pair that triggered the dense path) stand out.

---

## 9. Failure Modes

### 9.1 The `O(nm)` memory blowup

Materializing the full table for two large inputs OOMs. Mitigation: two-row DP for length, Hirschberg for reconstruction, banding when alignment is near-diagonal.

### 9.2 Lost traceback after space optimization

Engineer optimizes to two rows for memory, then discovers they still need the actual subsequence and the table is gone. Mitigation: choose Hirschberg up front when reconstruction in linear space is required; do not retrofit.

### 9.3 Wrong LIS variant in production

`>=` vs `>` silently returns a different (still-plausible) number. Mitigation: name the contract, test arrays with duplicates, and assert the reconstructed subsequence satisfies the intended relation.

### 9.4 Reading `tails` as the LIS

`tails` is not a valid subsequence; using it as the answer ships a wrong sequence whose *length* happens to be right. Mitigation: always reconstruct via parent pointers, and verify the output is increasing.

### 9.5 Dense DP on sparse, diff-like input

Running `O(nm)` on two 100k-line files with mostly-unique lines is slow when Hunt–Szymanski / Myers would be near-linear. Mitigation: detect match density / similarity and route to the sparse or edit-distance algorithm.

### 9.6 Substring/subsequence confusion in code

Reusing the LCS recurrence for a "longest common contiguous run" requirement (or vice versa) gives a confidently wrong answer. Mitigation: separate, well-named functions; substring resets to 0 on mismatch and reads the max cell.

### 9.7 Patience diff vs raw LCS hunk quality

Shipping raw greedy-LCS diffs produces ugly, misaligned hunks on code with repeated boilerplate lines. Mitigation: use patience/histogram diff (anchor on unique lines = LIS) for human-facing diffs.

### 9.8 Integer overflow in count-of-LIS

The number of LIS can be astronomically large. Mitigation: count modulo a prime if the exact value is not required, or use big integers; document which.

### 9.9 Quadratic LIS on large input

Shipping the `O(n²)` LIS DP (because it was simplest to write) on a million-element array runs `10^{12}` operations and times out. Mitigation: use the patience `O(n log n)` method for any `n` beyond a few thousand; keep the `O(n²)` DP only for the rare case where you need every per-index `dp` value for a downstream query.

### 9.10 Forgetting the band can be too narrow

Banded LCS with a fixed `w` silently returns a *suboptimal* alignment when the true alignment needs more than `w` net indels — and it looks plausible. Mitigation: detect band-boundary hits and adaptively widen (Section 6.4); never ship a fixed band without the retry loop unless the indel bound is guaranteed.

### 9.11 Non-deterministic witness across languages

The Go, Java, and Python implementations agree on the *length* but may return different LCS/LIS *strings* due to tie-break differences (`≥` vs `>`, smallest vs largest split column). Mitigation: pin the same tie-break in all three; otherwise cross-language tests that compare the witness (not just the length) flake.

---

## 10. Summary

- The enemy at scale is the **`O(nm)` table**. Two-row DP gives length in `O(min(n,m))` space; **Hirschberg** reconstructs the actual LCS in `O(nm)` time and `O(min(n,m))` space via midline divide-and-conquer — the algorithm real aligners and many diff tools use.
- **Diff is LCS reconstruction.** `git diff` minimizes an edit script (Myers' `O(nd)`, fast when files are similar); patience/histogram diff anchors on *unique common lines*, which is literally the **LCS↔LIS reduction** producing cleaner hunks.
- **Sparse-match LCS (Hunt–Szymanski, `O((r+n) log n)`)** is the fastest practical LCS for mostly-unique inputs, and it is built on the same per-symbol-position LIS idea — the reduction is the theoretical core, not a curiosity.
- **LIS** is single-pass `O(n log n)`; length-only is streaming-friendly (`O(L)` memory), but reconstruction and variants (count-of-LIS, max-sum, 2D chains) need parent pointers or a **Fenwick/segment tree** over compressed values.
- **Variant engineering matters:** strict vs non-decreasing is an API contract; banding cuts near-diagonal alignments to `O(nw)`; scored alignment (Needleman–Wunsch / Smith–Waterman) generalizes LCS for biology.
- **Always reconstruct-and-verify**, not just length-check; route by input shape (size, similarity, match density) to the right algorithm.
- **The alphabet is flexible** (Section 3.7): LCS is alphabet-agnostic — line, word, token, or AST-node — so the same engine drives line diff, word diff, and structural diff. Choosing granularity is a product decision; choosing the *algorithm* (full/two-row/Hirschberg/Hunt–Szymanski/Myers) is a performance-and-memory decision driven by input shape.
- **Three-way merge** (Section 3.6) is two LCS computations against a base; diff quality directly drives merge-conflict frequency, making the algorithm choice user-visible, not just a performance knob.

### Decision summary

- **Small inputs** → full table + traceback.
- **Length only** → two-row DP (`O(min)` space).
- **Large inputs, need alignment** → Hirschberg.
- **Similar inputs (small `d`)** → Myers `O(nd)`.
- **Sparse / mostly-unique matches** → Hunt–Szymanski (or patience diff for humans).
- **Near-diagonal alignment** → banded DP `O(nw)`.
- **LIS at scale** → patience `O(n log n)`; BIT/segment tree for weighted/count variants.
- **Two permutations** → LCS via LIS, `O(n log n)`.

### When NOT to use LCS/LIS

A senior must also recognize the anti-patterns:

- **Approximate similarity at massive scale.** If you only need a *similarity score* between millions of document pairs, exact LCS is overkill — use MinHash/SimHash or n-gram Jaccard, which are sublinear and parallel-friendly. LCS is for the *exact alignment*, not a cheap score.
- **Contiguous matching.** If the requirement is "longest shared contiguous block," that is longest common *substring* (suffix automaton, `O(n+m)`), not LCS. Using LCS here is both wrong and slower than the right tool.
- **Streaming with reconstruction at unbounded scale.** If data does not fit and you need the witness, the two-pass external scheme (Section 4.2) applies; if even that is infeasible, reconsider whether an approximate or windowed answer suffices.
- **Weighted edits / substitutions.** If "replace" is a first-class cheap operation, use Levenshtein/Needleman–Wunsch, not LCS (Section 6.5).

Knowing the boundary — where LCS/LIS stops being the right tool — is as much a senior skill as knowing the algorithms themselves.

### Production checklist

Before shipping an LCS/LIS feature, confirm:

- [ ] Memory budget check routes large inputs away from the dense table.
- [ ] The strict vs non-decreasing (LIS) and subsequence vs substring (LCS) contract is named and tested with duplicate/edge inputs.
- [ ] Reconstruction is verified by re-checking the output is a valid common/increasing subsequence; diffs round-trip (apply script to `X`, get `Y`).
- [ ] Length-only paths drop reconstruction state (no `parent`/full table) to save memory.
- [ ] Diff hunks use patience/histogram for human readability where it matters.
- [ ] Count-of-LIS/LCS reduce mod a prime (or use big integers) to avoid overflow.
- [ ] Cross-language implementations pin the same tie-break if the witness (not just length) is compared.

References: Hirschberg (1975) linear-space LCS; Hunt–Szymanski (1977) sparse LCS; Myers (1986) `O(nd)` diff; patience/histogram diff (Git); Needleman–Wunsch, Smith–Waterman, and Gotoh (affine gaps) alignment; Fenwick-tree LIS variants; box-stacking / Russian-doll envelope as 2D LIS. Sibling topics: `04-edit-distance`, `01-introduction-to-dp`, and `string-algorithms`.
