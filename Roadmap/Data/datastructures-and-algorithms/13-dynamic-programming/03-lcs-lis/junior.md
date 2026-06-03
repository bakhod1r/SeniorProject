# Longest Common Subsequence (LCS) and Longest Increasing Subsequence (LIS) — Junior Level

> **One-line summary:** **LCS** finds the longest sequence of characters that appears (in order, but not necessarily contiguously) in *both* of two strings, computed with an `O(nm)` DP table. **LIS** finds the longest run of values in a single array that strictly increases left to right, computed in `O(n²)` DP or `O(n log n)` with binary search. Both are dynamic-programming classics, and both can *reconstruct* the actual subsequence, not just its length.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Two of the most-loved dynamic-programming problems in all of computer science share a single word: **subsequence**. A *subsequence* is what you get by deleting zero or more elements from a sequence **without reordering** the ones you keep. From `ABCDE` you can extract `ACE`, `BD`, `ABCDE`, or the empty string — but never `ECA`, because that reorders.

The two problems are:

- **Longest Common Subsequence (LCS):** given *two* sequences, find the longest subsequence present in *both*. For `ABCBDAB` and `BDCAB`, one LCS is `BCAB` (length 4). LCS is the engine behind `diff`, `git`, DNA alignment, and "spot the difference between two files."
- **Longest Increasing Subsequence (LIS):** given *one* sequence of numbers, find the longest subsequence whose values strictly increase. For `[10, 9, 2, 5, 3, 7, 101, 18]`, one LIS is `[2, 3, 7, 101]` (length 4). LIS shows up in patience sorting, box-stacking, scheduling, and "how long is the longest improving trend?"

> **LCS:** longest subsequence common to *two* sequences. **LIS:** longest *increasing* subsequence of *one* sequence.

These two problems are cousins, not twins. They look different, but there is a beautiful bridge between them: **the LCS of two *permutations* of the same elements is exactly an LIS** of a cleverly relabelled array. That reduction (covered in `middle.md`) lets you solve a special case of LCS in `O(n log n)` instead of `O(n²)` — a genuinely surprising connection that this topic will make concrete.

A crucial vocabulary warning from minute one: a **subsequence** is *not* a **substring**. A substring must be contiguous (`BCB` is a substring of `ABCBDAB`); a subsequence may skip around (`BCAB` is a subsequence but not a substring). The "longest common *substring*" problem is a different, also-DP problem we contrast at the end. Mixing the two up is the single most common beginner error here.

Everything in this file is exact integer DP — no floating point, no randomness. You fill a table, you read an answer, and (with a little extra bookkeeping) you walk *backward* through the table to recover the actual winning subsequence. That backtracking step is what turns "the length is 4" into "here is the actual sequence `BCAB`," and it is where most of the subtlety lives.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Strings and arrays** — indexing, slicing, iterating with nested loops.
- **2D arrays / grids** — the LCS table is a `(n+1) × (m+1)` grid you fill cell by cell.
- **Recursion and the idea of overlapping subproblems** — why memoizing a recursive solution turns exponential brute force into polynomial DP. (See sibling `01-introduction-to-dp`.)
- **Big-O notation** — `O(nm)`, `O(n²)`, `O(n log n)`.
- **Binary search** on a sorted array — the heart of the fast LIS. (See `15-searching` / `binary-search-patterns`.)

Optional but helpful:

- A glance at **edit distance** (Levenshtein), since LCS is its close relative (sibling `04-edit-distance`).
- Familiarity with the **two-pointer** idea, which helps when reading the LCS reconstruction loop.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Subsequence** | What remains after deleting some elements **without reordering**. `ACE` is a subsequence of `ABCDE`. |
| **Substring / subarray** | A **contiguous** slice. `BCD` is a substring of `ABCDE`; `BD` is *not*. |
| **Common subsequence** | A sequence that is a subsequence of **both** input sequences. |
| **LCS** | A *longest* common subsequence. There may be several of the same maximum length. |
| **Increasing subsequence** | A subsequence whose values strictly increase (`a < b < c`). |
| **Non-decreasing subsequence** | Allows equal consecutive values (`a ≤ b ≤ c`); the "longest non-decreasing" variant. |
| **LIS** | A *longest* increasing subsequence. |
| **DP table** | The grid `dp[i][j]` storing the answer to a subproblem (here, LCS of the first `i` and first `j` characters). |
| **Reconstruction / traceback** | Walking backward through the DP table to recover the actual subsequence, not just its length. |
| **Patience sorting** | The card-game-inspired procedure that yields LIS *length* in `O(n log n)`. |
| **Tails array** | In fast LIS, `tails[len]` = the smallest possible tail value of any increasing subsequence of length `len+1`. |

---

## Core Concepts

### 1. What a Subsequence Is (and Is Not)

Pick a sequence and cross out any elements you like; read the survivors left to right without reshuffling. That is a subsequence. The order of the kept elements is locked to their original order. This single rule — *keep order, allow gaps* — is what makes both LCS and LIS dynamic-programming problems rather than simple scans.

```
Sequence:     A  B  C  B  D  A  B
Keep:         A     C     D     B   →  subsequence "ACDB"
NOT allowed:  read them as "B C A" (reordering) — that is not a subsequence
```

### 2. LCS: The Recurrence

Let `X` have length `n` and `Y` have length `m`. Define `dp[i][j]` = the length of the LCS of the first `i` characters of `X` and the first `j` characters of `Y`. Then:

```
dp[0][j] = 0                       (empty X has no common subsequence)
dp[i][0] = 0                       (empty Y has no common subsequence)

if X[i-1] == Y[j-1]:
    dp[i][j] = dp[i-1][j-1] + 1    (match: extend the diagonal subproblem)
else:
    dp[i][j] = max(dp[i-1][j],     (drop X's last char)
                   dp[i][j-1])     (drop Y's last char)
```

The intuition: if the last characters match, that character *must* be usable as the last character of an LCS, so we add 1 to the LCS of everything before it. If they do not match, at least one of the two last characters is not in the LCS, so we try dropping each and keep the better result. The answer is `dp[n][m]`, the bottom-right cell.

### 3. LCS: Reconstruction (Traceback)

`dp[n][m]` tells you the *length*. To recover the actual subsequence, start at the bottom-right cell and walk backward:

```
i = n, j = m, result = ""
while i > 0 and j > 0:
    if X[i-1] == Y[j-1]:
        result = X[i-1] + result   # this char is in the LCS
        i -= 1; j -= 1             # move diagonally
    elif dp[i-1][j] >= dp[i][j-1]:
        i -= 1                     # came from above
    else:
        j -= 1                     # came from the left
```

Each diagonal move on a match prepends one character; the non-match moves follow whichever neighbor produced the maximum. The path you trace *is* the LCS, read in reverse.

### 4. LIS: The `O(n²)` DP

Let `dp[i]` = the length of the longest increasing subsequence that **ends at index `i`**. Then:

```
dp[i] = 1 + max( dp[j] )  over all j < i with a[j] < a[i]   (or 1 if none)
answer = max over all i of dp[i]
```

For each element you look back at every earlier element that is smaller and could precede it, take the best such chain, and add yourself. The maximum over all ending positions is the LIS length. This is `O(n²)` because of the nested look-back.

### 5. LIS: The `O(n log n)` Patience Method

Keep an array `tails`, where `tails[k]` is the **smallest possible tail value** of any increasing subsequence of length `k+1` seen so far. Process the array left to right; for each value `x`:

```
find the leftmost position p in tails where tails[p] >= x   (binary search)
if no such position:  append x  (x extends the longest run by one)
else:                 tails[p] = x  (x gives a length-(p+1) run a smaller tail)
LIS length = len(tails)
```

`tails` is always sorted, so the search is binary — hence `O(n log n)`. Note: `tails` is **not** itself a valid LIS (its values can come from incompatible positions); it only tracks *lengths*. To recover the actual subsequence you keep extra "parent" pointers (shown in `middle.md`). For the **non-decreasing** variant, search for the leftmost `tails[p] > x` instead of `>= x`.

### 6. Substring vs Subsequence (the contrast)

Longest Common **Substring** requires a *contiguous* match and uses a different recurrence:

```
if X[i-1] == Y[j-1]:  dp[i][j] = dp[i-1][j-1] + 1
else:                 dp[i][j] = 0       # contiguity broken → reset to 0
answer = max cell anywhere in the table   (not the corner)
```

The reset-to-zero on mismatch (instead of carrying the max forward) is the entire difference. The answer is the maximum cell *anywhere*, not the bottom-right corner. Keep these two recurrences mentally separate.

---

## Big-O Summary

| Problem / Operation | Time | Space | Notes |
|---------------------|------|-------|-------|
| LCS length (full table) | **O(nm)** | O(nm) | Fill the `(n+1)×(m+1)` grid. |
| LCS length, space-optimized | O(nm) | **O(min(n,m))** | Keep two rows (or one) — see middle. |
| LCS reconstruction (from full table) | O(n+m) | O(nm) | Traceback walk after the fill. |
| LCS reconstruction, linear space | O(nm) | O(min(n,m)) | Hirschberg's divide-and-conquer — see senior. |
| LIS length, DP | **O(n²)** | O(n) | Nested look-back. |
| LIS length, patience / binary search | **O(n log n)** | O(n) | The standard fast method. |
| LIS reconstruction | O(n log n) | O(n) | Parent pointers + the `tails` index. |
| Longest common substring | O(nm) | O(nm) or O(min) | Different recurrence; answer is the max cell. |
| LCS of two permutations via LIS | **O(n log n)** | O(n) | The reduction (middle). |

The headline numbers: **LCS is `O(nm)`** (product of the two lengths), and **LIS is `O(n log n)`** with the patience method. Reconstruction adds only linear overhead.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| LCS | Two friends each wrote a to-do list. The LCS is the longest set of shared tasks **in the same relative order** both happened to write down. |
| LCS in `diff` / `git` | Comparing two versions of a file: the LCS is the lines that stayed the same; everything else is shown as an *insertion* or *deletion*. |
| LCS in DNA | Aligning two gene sequences: the LCS measures how much genetic material is shared in order. |
| LIS | Stacking boxes: the longest tower where each box is strictly smaller than the one below it, taken in the order they arrive. |
| LIS patience piles | Dealing cards into piles where each card goes onto the leftmost pile whose top is `≥` it; the number of piles equals the LIS length. |
| Subsequence vs substring | A subsequence is words you can pick out of a sentence *in order*; a substring is an unbroken phrase you quote verbatim. |

Where the analogies break: real `diff` tools tune LCS for *human-readable* hunks (they prefer grouping changes), and real DNA aligners weight matches/mismatches with biology-specific scores — both go beyond plain LCS. The pure problems ignore those refinements.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| LCS gives an exact, optimal alignment in polynomial `O(nm)` time. | `O(nm)` time **and** space is heavy for two very long inputs (e.g. two 100k-line files → 10^10 cells). |
| LCS reconstruction recovers the actual shared sequence, powering `diff`/`git`. | Naive reconstruction needs the whole `O(nm)` table in memory. |
| LIS in `O(n log n)` is fast and short to code once you know the pattern. | The fast LIS `tails` array does **not** hold a valid subsequence — recovering it needs extra pointers. |
| Both are classic, well-understood, and interview-frequent. | Easy to confuse subsequence (gaps allowed) with substring (contiguous). |
| Hirschberg's trick brings LCS reconstruction down to `O(min(n,m))` space. | Strict vs non-decreasing LIS is a one-character bug magnet (`>=` vs `>`). |

**When to use LCS:** measuring similarity between two ordered sequences, building a `diff`, aligning DNA/protein sequences, plagiarism/version comparison.

**When to use LIS:** longest improving trend, patience sorting, box/envelope stacking, scheduling with ordering constraints, and (via the reduction) LCS of permutations.

**When NOT to use:** if you need *contiguous* matches, use longest common *substring* (or suffix structures). If the inputs are enormous and you only need a similarity *score*, cheaper approximate methods may suffice.

---

## Step-by-Step Walkthrough

### LCS of `X = "AGCAT"` and `Y = "GAC"` by hand

We fill a `6 × 4` table (`dp[i][j]`, rows `i = 0..5`, columns `j = 0..3`). Row 0 and column 0 are all zeros (empty prefix). Indices into the strings are `X[i-1]`, `Y[j-1]`.

```
        j:   0   1(G) 2(A) 3(C)
      i: ""   0    0    0    0
   1 (A) A    0    0    1    1
   2 (G) G    0    1    1    1
   3 (C) C    0    1    1    2
   4 (A) A    0    1    2    2
   5 (T) T    0    1    2    2
```

How a few cells are computed:

- `dp[1][1]`: `X[0]='A'` vs `Y[0]='G'` — mismatch → `max(dp[0][1], dp[1][0]) = max(0,0) = 0`.
- `dp[1][2]`: `'A'` vs `'A'` — **match** → `dp[0][1] + 1 = 0 + 1 = 1`.
- `dp[2][1]`: `'G'` vs `'G'` — **match** → `dp[1][0] + 1 = 1`.
- `dp[3][3]`: `'C'` vs `'C'` — **match** → `dp[2][2] + 1 = 1 + 1 = 2`.
- `dp[4][2]`: `'A'` vs `'A'` — **match** → `dp[3][1] + 1 = 1 + 1 = 2`.

The answer is `dp[5][3] = 2`. The LCS length is 2.

**Traceback** from `dp[5][3]`:

```
(5,3) 'T' vs 'C' mismatch, dp[4][3]=2 ≥ dp[5][2]=2 → go up to (4,3)
(4,3) 'A' vs 'C' mismatch, dp[3][3]=2 ≥ dp[4][2]=2 → go up to (3,3)
(3,3) 'C' vs 'C' MATCH → take 'C', go diagonal to (2,2)
(2,2) 'G' vs 'A' mismatch, dp[1][2]=1 ≥ dp[2][1]=1 → go up to (1,2)
(1,2) 'A' vs 'A' MATCH → take 'A', go diagonal to (0,1)
stop (i=0)
```

Collected in reverse: `'C'`, then `'A'` → read forward the LCS is `"AC"`. Length 2. ✓

### LIS of `[10, 9, 2, 5, 3, 7, 101, 18]` with patience

Process left to right, maintaining `tails`:

```
x=10 : tails empty → append      tails = [10]
x=9  : 9 replaces 10 (leftmost ≥9) tails = [9]
x=2  : 2 replaces 9               tails = [2]
x=5  : 5 > all → append           tails = [2, 5]
x=3  : 3 replaces 5               tails = [2, 3]
x=7  : 7 > all → append           tails = [2, 3, 7]
x=101: 101 > all → append         tails = [2, 3, 7, 101]
x=18 : 18 replaces 101            tails = [2, 3, 7, 18]
```

`len(tails) = 4`, so the LIS length is 4. (The actual subsequence — e.g. `[2, 3, 7, 101]` — needs parent pointers, shown in `middle.md`; do **not** read it off `tails`, whose final state `[2,3,7,18]` is not the answer sequence.)

---

## Code Examples

### Example A: LCS length + reconstruction

#### Go

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
	// traceback
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
	// reverse buf
	for a, b := 0, len(buf)-1; a < b; a, b = a+1, b-1 {
		buf[a], buf[b] = buf[b], buf[a]
	}
	return dp[n][m], string(buf)
}

func main() {
	length, seq := lcs("AGCAT", "GAC")
	fmt.Println(length, seq) // 2 AC
}
```

#### Java

```java
public class LCS {
    static int[] dpLen = null;

    static Object[] lcs(String X, String Y) {
        int n = X.length(), m = Y.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                if (X.charAt(i - 1) == Y.charAt(j - 1)) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        int i = n, j = m;
        while (i > 0 && j > 0) {
            if (X.charAt(i - 1) == Y.charAt(j - 1)) {
                sb.append(X.charAt(i - 1));
                i--; j--;
            } else if (dp[i - 1][j] >= dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return new Object[]{dp[n][m], sb.reverse().toString()};
    }

    public static void main(String[] args) {
        Object[] r = lcs("AGCAT", "GAC");
        System.out.println(r[0] + " " + r[1]); // 2 AC
    }
}
```

#### Python

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
    # traceback
    i, j, out = n, m, []
    while i > 0 and j > 0:
        if X[i - 1] == Y[j - 1]:
            out.append(X[i - 1])
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    return dp[n][m], "".join(reversed(out))


if __name__ == "__main__":
    print(lcs("AGCAT", "GAC"))  # (2, 'AC')
```

**What it does:** fills the LCS table, then traces back to print both the length and one actual LCS.
**Run:** `go run main.go` | `javac LCS.java && java LCS` | `python lcs.py`

### Example B: LIS length — both methods

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

// O(n^2) DP
func lisDP(a []int) int {
	if len(a) == 0 {
		return 0
	}
	dp := make([]int, len(a))
	best := 1
	for i := range a {
		dp[i] = 1
		for j := 0; j < i; j++ {
			if a[j] < a[i] && dp[j]+1 > dp[i] {
				dp[i] = dp[j] + 1
			}
		}
		if dp[i] > best {
			best = dp[i]
		}
	}
	return best
}

// O(n log n) patience
func lisFast(a []int) int {
	tails := []int{}
	for _, x := range a {
		p := sort.SearchInts(tails, x) // leftmost index with tails[p] >= x
		if p == len(tails) {
			tails = append(tails, x)
		} else {
			tails[p] = x
		}
	}
	return len(tails)
}

func main() {
	a := []int{10, 9, 2, 5, 3, 7, 101, 18}
	fmt.Println(lisDP(a), lisFast(a)) // 4 4
}
```

#### Java

```java
import java.util.*;

public class LIS {
    static int lisDP(int[] a) {
        if (a.length == 0) return 0;
        int[] dp = new int[a.length];
        int best = 1;
        for (int i = 0; i < a.length; i++) {
            dp[i] = 1;
            for (int j = 0; j < i; j++) {
                if (a[j] < a[i]) dp[i] = Math.max(dp[i], dp[j] + 1);
            }
            best = Math.max(best, dp[i]);
        }
        return best;
    }

    static int lisFast(int[] a) {
        List<Integer> tails = new ArrayList<>();
        for (int x : a) {
            int lo = 0, hi = tails.size();
            while (lo < hi) {               // leftmost tails[p] >= x
                int mid = (lo + hi) >>> 1;
                if (tails.get(mid) < x) lo = mid + 1;
                else hi = mid;
            }
            if (lo == tails.size()) tails.add(x);
            else tails.set(lo, x);
        }
        return tails.size();
    }

    public static void main(String[] args) {
        int[] a = {10, 9, 2, 5, 3, 7, 101, 18};
        System.out.println(lisDP(a) + " " + lisFast(a)); // 4 4
    }
}
```

#### Python

```python
from bisect import bisect_left


def lis_dp(a):
    if not a:
        return 0
    dp = [1] * len(a)
    for i in range(len(a)):
        for j in range(i):
            if a[j] < a[i]:
                dp[i] = max(dp[i], dp[j] + 1)
    return max(dp)


def lis_fast(a):
    tails = []
    for x in a:
        p = bisect_left(tails, x)   # leftmost tails[p] >= x
        if p == len(tails):
            tails.append(x)
        else:
            tails[p] = x
    return len(tails)


if __name__ == "__main__":
    a = [10, 9, 2, 5, 3, 7, 101, 18]
    print(lis_dp(a), lis_fast(a))  # 4 4
```

**What it does:** computes the LIS length two ways and confirms they agree.
**Run:** `go run main.go` | `javac LIS.java && java LIS` | `python lis.py`

---

## Coding Patterns

### Pattern 1: Brute-Force Oracle (test against this)

**Intent:** before trusting the DP, compute the answer the slow, obvious way on tiny inputs.

```python
from itertools import combinations


def lcs_brute(X, Y):
    best = 0
    for r in range(min(len(X), len(Y)), 0, -1):
        for idx in combinations(range(len(X)), r):
            sub = "".join(X[i] for i in idx)
            if is_subsequence(sub, Y):
                return r
    return 0


def is_subsequence(s, t):
    it = iter(t)
    return all(c in it for c in s)
```

Exponential, but a perfect correctness oracle for `len(X), len(Y) ≤ 12`.

### Pattern 2: "End-at-`i`" DP framing for LIS

**Intent:** Many sequence DPs are clearest when `dp[i]` means "best answer that *ends exactly at* index `i`," then you take the max over all `i`. LIS is the canonical example.

### Pattern 3: Traceback by following the max

**Intent:** Whenever a DP took `max` of neighbors, reconstruction walks backward choosing whichever neighbor *was* the max. This same pattern reconstructs LCS, edit-distance scripts, and knapsack picks.

```mermaid
graph TD
    A[Two strings X, Y] -->|fill O(nm) table| B[dp table]
    B -->|read corner| C[LCS length]
    B -->|traceback from corner| D[actual LCS string]
    E[One array a] -->|O(n log n) patience| F[LIS length]
    F -->|parent pointers| G[actual LIS]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Off-by-one in table indices | Confusing `dp[i][j]` (1-based prefix) with `X[i]` (0-based char). | Always index the string as `X[i-1]`, `Y[j-1]`. |
| Empty-input crash | LIS of `[]` or LCS with an empty string. | Return 0 explicitly for empty inputs. |
| Wrong LIS variant | Used `>=` search for strictly increasing (or `>` for non-decreasing). | `bisect_left` (`>=`) for strict; `bisect_right` (`>`) for non-decreasing. |
| Reading `tails` as the LIS | The `tails` array is not a valid subsequence. | Use parent pointers to reconstruct (see middle). |
| Substring/subsequence mix-up | Used the LCS recurrence for a contiguous-match problem. | Substring resets `dp` to 0 on mismatch; answer is the max cell. |
| Reversed reconstruction | Forgot the traceback collects characters back to front. | Reverse the collected buffer before returning. |

---

## Performance Tips

- **Iterate the smaller string in the inner dimension** for LCS, and keep only two rows to cut space to `O(min(n,m))` (see `middle.md`).
- **Use binary search for LIS** (`O(n log n)`); the `O(n²)` DP is only worth it when `n` is tiny or you need the per-index `dp` values for some other reason.
- **Prefer `bisect`/`sort.Search`/manual binary search** over linear scans of `tails`.
- **Avoid string concatenation in a loop** during traceback; append to a buffer/list and reverse once at the end.
- **Reuse the table** across calls if you compare one fixed string against many others, when memory allows.

---

## Best Practices

- Always test the DP against the brute-force oracle (Pattern 1) on random small inputs.
- State up front whether you need the **length only** or the **actual subsequence** — reconstruction changes the memory story.
- Name the variant explicitly: *strict* increasing vs *non-decreasing*, *subsequence* vs *substring*.
- For LCS, decide early if you need linear space; if so, plan for Hirschberg (senior) rather than retrofitting.
- Write `multiply`-style core loops (the table fill) as small, separately testable functions; most bugs hide in the recurrence's `else` branch.

---

## Edge Cases & Pitfalls

- **Empty input(s).** LCS with an empty string is `0`; LIS of `[]` is `0`. Handle before allocating.
- **All-equal array for LIS.** Strict LIS of `[5,5,5]` is `1`; non-decreasing LIS is `3`. The `>=` vs `>` choice decides this.
- **No common characters.** LCS is `0` and the reconstructed string is empty — correct, not a bug.
- **Ties in the DP.** Several LCSs of the same length may exist; the traceback returns *one* of them, determined by your tie-break (`>=` vs `>`).
- **Single-element inputs.** LCS length is `0` or `1`; LIS length is `1`. Make sure base cases cover these.
- **Substring confusion.** "Longest common substring" needs the reset-to-0 recurrence and a max-anywhere read — do not reuse the LCS corner.
- **Large inputs.** Two very long strings make the `O(nm)` table huge; that is when space optimization and Hirschberg matter (senior).

---

## Common Mistakes

1. **Indexing the string with the table index** (`X[i]` instead of `X[i-1]`) — classic off-by-one.
2. **Reading the LIS off the `tails` array** — `tails` tracks lengths, not a real subsequence.
3. **Using `bisect_right` for strictly increasing LIS** — it allows duplicates and overcounts.
4. **Forgetting to reverse the LCS traceback** — you collect characters from the end backward.
5. **Confusing substring with subsequence** — the contiguous version is a *different* recurrence.
6. **Returning the wrong cell** — LCS answer is the corner `dp[n][m]`; longest *substring* is the max cell anywhere.
7. **Assuming the LCS is unique** — there can be many; your code returns one specific tie-break.

---

## Cheat Sheet

| Question | Tool | Key formula |
|----------|------|-------------|
| Length of LCS of `X`, `Y` | `O(nm)` DP | `dp[i][j]=dp[i-1][j-1]+1` on match, else `max(up,left)` |
| Actual LCS string | traceback | walk from `dp[n][m]`, diagonal on match |
| LIS length (simple) | `O(n²)` DP | `dp[i]=1+max(dp[j] : a[j]<a[i])` |
| LIS length (fast) | patience + binary search | maintain sorted `tails`; `len(tails)` |
| Longest non-decreasing | patience with `>` search | `bisect_right` instead of `bisect_left` |
| Longest common substring | reset-on-mismatch DP | `dp=0` on mismatch; answer = max cell |
| LCS of two permutations | reduce to LIS | relabel + LIS in `O(n log n)` (middle) |

Core algorithms:

```
LCS(X,Y):
    for i in 1..n: for j in 1..m:
        if X[i-1]==Y[j-1]: dp[i][j]=dp[i-1][j-1]+1
        else: dp[i][j]=max(dp[i-1][j], dp[i][j-1])
    return dp[n][m]            # O(nm)

LIS(a):                         # O(n log n)
    tails=[]
    for x in a:
        p = lower_bound(tails, x)   # >= x  (strict)
        if p==len(tails): tails.append(x)
        else: tails[p]=x
    return len(tails)
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - Filling the LCS DP table cell by cell, highlighting match (diagonal +1) vs mismatch (max of up/left)
> - The traceback path lighting up to reveal the actual LCS string
> - A second mode showing LIS **patience piles** growing as each value is placed, with the binary-search position highlighted
> - Step / Run / Reset controls to watch each decision

---

## Summary

LCS and LIS are the two gateway sequence-DP problems. **LCS** asks for the longest subsequence shared by two sequences: fill an `O(nm)` table with "match → diagonal +1, mismatch → max of neighbors," read the corner for the length, and trace back to recover the actual subsequence — the exact machinery behind `diff` and version control. **LIS** asks for the longest increasing run inside one array: the simple `O(n²)` DP looks back at smaller predecessors, while the `O(n log n)` patience method keeps a sorted `tails` array of best-possible tails and binary-searches each new value. Two rules to never forget: a *subsequence* allows gaps (a *substring* does not), and the `tails` array gives the LIS *length* but not the subsequence itself. Master the table fill, the traceback, and the strict-vs-non-decreasing distinction, and you have the foundation for edit distance, sequence alignment, and the elegant LCS-to-LIS reduction explored next.

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — Chapter 15, the LCS dynamic program and reconstruction.
- Sibling topic `01-introduction-to-dp` — overlapping subproblems and optimal substructure.
- Sibling topic `04-edit-distance` — the close cousin of LCS (Levenshtein distance).
- `binary-search-patterns` — the `lower_bound` used in fast LIS.
- cp-algorithms.com — "Longest increasing subsequence" and "Longest common subsequence".
- Hunt–Szymanski and Myers' diff algorithms — the LCS variants used in real `diff` tools (revisited in `senior.md`).
