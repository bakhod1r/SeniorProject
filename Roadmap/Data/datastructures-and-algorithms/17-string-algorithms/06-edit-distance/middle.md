# Edit Distance — Sequence Alignment and Approximate Matching — Middle Level

> **Focus:** The string-algorithms toolbox *around* edit distance — global vs local alignment (Needleman-Wunsch, Smith-Waterman), affine gap penalties (Gotoh), the banded **Ukkonen O(nd)** algorithm for small distances and "find substrings within `k` edits", linear-space alignment (Hirschberg), and Damerau transpositions. The plain `O(nm)` DP and its proof live in the sibling `13-dynamic-programming/04-edit-distance` topic; here we go where that topic does not: alignment, traceback, and approximate string matching.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Edit Distance as Shortest Path in a Grid](#edit-distance-as-shortest-path-in-a-grid)
3. [Global Alignment: Needleman-Wunsch](#global-alignment-needleman-wunsch)
4. [Local Alignment: Smith-Waterman](#local-alignment-smith-waterman)
5. [Affine Gap Penalties: Gotoh](#affine-gap-penalties-gotoh)
6. [Damerau-Levenshtein: Transpositions](#damerau-levenshtein-transpositions)
7. [Banded Ukkonen O(nd) for Small Distances](#banded-ukkonen-ond-for-small-distances)
8. [Approximate String Matching: Substrings Within k Edits](#approximate-string-matching-substrings-within-k-edits)
9. [Linear-Space Alignment: Hirschberg](#linear-space-alignment-hirschberg)
10. [Comparison with Alternatives](#comparison-with-alternatives)
11. [Code Examples](#code-examples)
12. [Error Handling](#error-handling)
13. [Performance Analysis](#performance-analysis)
14. [Best Practices](#best-practices)
15. [Visual Animation](#visual-animation)
16. [Summary](#summary)

---

## Introduction

At junior level you learned to fill the `O(nm)` table, read the distance from the corner, and trace back the alignment. At middle level the questions become the ones a real text-processing or bioinformatics engineer asks:

- I want the *best alignment*, scored with rewards for matches and penalties for mismatches/gaps — not just a raw edit count. (Needleman-Wunsch.)
- I do not want to align the *whole* strings, only the **best-matching region** inside them. (Smith-Waterman.)
- A run of 10 missing characters is one biological event, not 10 independent ones — gap *opening* should cost more than gap *extension*. (Affine gaps / Gotoh.)
- A keyboard swap `teh→the` is one mistake; how do I make transpositions cost 1? (Damerau-Levenshtein.)
- I only care whether the distance is `≤ k`, and `k` is tiny relative to the strings. Can I beat `O(nm)`? (Ukkonen `O(nd)`, banded DP.)
- I need to find every place a pattern occurs in a long text **within `k` edits**. (Approximate string matching.)
- The full table needs `O(nm)` memory but I need the alignment of two megabyte strings. (Hirschberg's `O(min(n,m))` space.)

These are the questions that separate "I can compute Levenshtein" from "I can build a fuzzy search engine or a sequence aligner." We rely on the basic DP recurrence (see junior + the DP topic) and build the string toolbox on top of it.

> **Cross-reference.** The pure-DP perspective — recurrence correctness, weighted operation costs, two-row memory reduction, and the basic banded idea — is developed in `13-dynamic-programming/04-edit-distance`. This file deliberately does **not** re-derive that. It treats edit distance as a *string-alignment and approximate-matching* tool: scoring schemes, local alignment, affine gaps, the `O(nd)` diagonal algorithm, on-text matching, and linear-space traceback.

---

## Edit Distance as Shortest Path in a Grid

The single most useful reframing for everything that follows: build the **edit graph**. Make a grid of nodes `(i, j)` for `0 ≤ i ≤ n`, `0 ≤ j ≤ m`. From each node draw three directed edges:

- **diagonal** `(i-1, j-1) → (i, j)`: weight `0` if `A[i-1] == B[j-1]` (match), else `1` (substitute);
- **down** `(i-1, j) → (i, j)`: weight `1` (delete `A[i-1]`);
- **right** `(i, j-1) → (i, j)`: weight `1` (insert `B[j-1]`).

Then **edit distance is the shortest path from `(0,0)` to `(n,m)`** in this DAG. The DP table fill is exactly Dijkstra/topological-order relaxation on this grid, and traceback is shortest-path reconstruction. This view is not just pretty — it is what makes the `O(nd)` algorithm (a "BFS by distance level" on the grid) and Myers' diff (greedy longest-diagonal exploration) natural. Holding the grid-shortest-path picture is the key middle-level upgrade.

Two consequences worth internalizing:

- The optimal path is **monotone** (it only moves down/right/diagonally), so it never revisits a row or column — this bounds traceback to `O(n+m)`.
- A path that uses `d` non-diagonal (cost-1) edges has total cost `d`; "distance `≤ k`" means "a corner-to-corner path with at most `k` non-diagonal moves exists", and such a path stays within a **diagonal band** of width `2k+1` around the main diagonal. That is the entire idea behind banded/Ukkonen.

---

## Global Alignment: Needleman-Wunsch

**Needleman-Wunsch (1970)** is edit distance reframed as *maximizing a similarity score* over the full length of both strings (a **global** alignment — both strings used end to end). Instead of counting edits to minimize, you assign:

- `match` a positive reward (e.g. `+1`),
- `mismatch` a penalty (e.g. `−1`),
- `gap` (indel) a penalty (e.g. `−1`).

The recurrence is the same three-way choice, but with `max` and scores:

```
H[i][0] = i * gap ;  H[0][j] = j * gap
H[i][j] = max( H[i-1][j-1] + score(A[i-1], B[j-1]),   # diagonal: match/mismatch
               H[i-1][j]   + gap,                      # delete
               H[i][j-1]   + gap )                     # insert
```

The optimal global alignment score sits at `H[n][m]`, and traceback (preferring the move that achieved the max) reconstructs the alignment. Minimizing edit distance and maximizing this score are duals: with `match=0, mismatch=gap=-1`, the magnitude of the optimal score is exactly the edit distance. Needleman-Wunsch generalizes Levenshtein by letting `score(x,y)` be a full **substitution matrix** (e.g. BLOSUM/PAM in bioinformatics), so that "similar" substitutions cost less than "dissimilar" ones — a flexibility plain Levenshtein lacks.

---

## Local Alignment: Smith-Waterman

Often you do not want to align the *whole* of both strings — you want the **single best-matching region** between them (e.g. find a gene fragment inside a chromosome, or a quoted sentence inside a document). That is **local alignment**, solved by **Smith-Waterman (1981)** with two changes to Needleman-Wunsch:

1. **Clamp negatives to zero.** A cell never goes below `0`; a `0` means "start a fresh local alignment here."
2. **Answer is the maximum cell anywhere**, not the corner; traceback starts at that max cell and stops when it reaches a `0`.

```
H[i][j] = max( 0,
               H[i-1][j-1] + score(A[i-1], B[j-1]),
               H[i-1][j]   + gap,
               H[i][j-1]   + gap )
best = max over all (i,j) of H[i][j]   # the best local segment score
```

The clamp-to-zero is what lets the alignment "reset" and find a high-scoring island surrounded by junk. Smith-Waterman is the canonical tool for finding the most similar substring pair; it underlies sequence-database search (BLAST is a fast heuristic approximation of it). Same grid, same three moves — only the boundary/zero-clamp rules differ from global alignment.

| | Needleman-Wunsch | Smith-Waterman |
|--|------------------|----------------|
| Scope | Global (whole strings) | Local (best substring region) |
| Negative scores | Allowed | Clamped to `0` |
| Answer location | Corner `H[n][m]` | Max cell anywhere |
| Traceback start/stop | corner → origin | max cell → first `0` |

---

## Affine Gap Penalties: Gotoh

In real data, a *contiguous run* of inserts or deletes is usually one event (a dropped phrase, a DNA indel), so charging `gap_open + len·gap_extend` is more faithful than charging `len · gap`. This is an **affine gap penalty**, and computing it naively would need an `O(nm·(n+m))` recurrence. **Gotoh's algorithm (1982)** restores `O(nm)` by keeping **three** DP layers instead of one:

```
M[i][j] = best score ending with A[i-1] aligned to B[j-1] (match/mismatch)
X[i][j] = best score ending with a gap in B (deletion run in A)
Y[i][j] = best score ending with a gap in A (insertion run)

M[i][j] = score(A[i-1],B[j-1]) + max(M[i-1][j-1], X[i-1][j-1], Y[i-1][j-1])
X[i][j] = max( M[i-1][j] - (open+extend),   X[i-1][j] - extend )   # extend or open a deletion
Y[i][j] = max( M[i][j-1] - (open+extend),   Y[i][j-1] - extend )   # extend or open an insertion
answer  = max(M[n][m], X[n][m], Y[n][m])
```

The three states distinguish "I am currently inside a gap" from "I just made a diagonal move," so extending an existing gap costs only `extend` while *starting* one costs `open+extend`. Affine gaps are essential in bioinformatics and produce far more natural diffs in text (one big deleted block instead of many tiny ones). The price is a 3× constant on memory and time; the asymptotics stay `O(nm)`.

---

## Damerau-Levenshtein: Transpositions

Plain Levenshtein charges `2` for a swap of adjacent characters (`teh → the`): one delete and one insert (or two substitutions). **Damerau-Levenshtein** adds a fourth operation — **transposition of two adjacent characters** — at cost `1`, which models the single most common human/keyboard typo. The recurrence gains one case:

```
dp[i][j] = min(
    dp[i-1][j]   + 1,                          # delete
    dp[i][j-1]   + 1,                           # insert
    dp[i-1][j-1] + (A[i-1] != B[j-1]),          # match / substitute
    dp[i-2][j-2] + 1   IF i>1 and j>1
                       and A[i-1]==B[j-2]
                       and A[i-2]==B[j-1]        # transposition
)
```

The extra branch looks two cells back diagonally when the last two characters are swapped. Note there are two variants: the **restricted** (Optimal String Alignment) version above forbids editing a transposed substring again — simple and almost always what spell-checkers want — and the **true** Damerau-Levenshtein, which allows arbitrary edits of transposed regions and needs an extra alphabet-indexed table. For spell-check, use the restricted (OSA) form. *(The basic transposition mechanics also appear in the DP topic; here the point is that transpositions are part of the approximate-matching toolbox for typo-tolerant search.)*

---

## Banded Ukkonen O(nd) for Small Distances

When the true distance `d` is **small** relative to `n` (common in spell-check, near-duplicate detection, and version diffs where files barely changed), the full `O(nm)` table is wasteful: the optimal path hugs the main diagonal. **Ukkonen's algorithm** computes edit distance in `O(n·d)` (often written `O(nd)` where `d` is the answer), and `O((n−m)·d)` style bounds in refined forms — by only ever filling a **diagonal band**.

The key insight from the grid view: a corner-to-corner path of cost `≤ k` uses at most `k` non-diagonal moves, so it stays within `|i − j| ≤ k`, a band of width `2k+1`. So:

1. **Threshold version (`distance ≤ k?`):** fill only the band `|i − j| ≤ k`. Cells outside are provably worse than `k`. Cost `O(k · n)`. If `dp[n][m] > k`, report "> k".
2. **Unknown-`d` version (Ukkonen doubling):** you do not know `d` in advance. Try `k = 1, 2, 4, 8, …`, banding at each; stop when the banded answer `≤ k`. Because work doubles each round, the total is dominated by the last round, `O(n·d)`. This is exponential search over the threshold, giving an output-sensitive bound that is fast exactly when strings are similar.

Ukkonen's deeper formulation tracks, for each diagonal, the **farthest-reaching** point reachable with a given number of edits — a "front" of progress that advances by greedily sliding along matching diagonals. That farthest-reaching-diagonal idea is the same engine as Myers' `O(nd)` diff and is developed further in `senior.md`. For middle level, the practical takeaway is: **if you expect small distances, band the DP and you pay `O(nd)`, not `O(nm)`.**

---

## Approximate String Matching: Substrings Within k Edits

A distinct but closely related problem: given a short **pattern** `P` (length `m`) and a long **text** `T` (length `n`), find **all positions in `T` where `P` occurs with at most `k` edits** ("`k`-approximate matching"). The trick is one change to the alignment DP base case:

```
dp[0][j] = 0    for all j     # a match may START anywhere in the text (free)
dp[i][0] = i                  # the pattern still must be consumed
dp[i][j] = ...                # same three-way (or four-way) recurrence
```

Setting the top row to all zeros means "begin the pattern at any text column for free." Then **every text position `j` where `dp[m][j] ≤ k`** is the end of an approximate occurrence. This is `O(nm)` with the full table, but combined with **banding** (`O(k·n)`) it becomes the workhorse of `grep -E` fuzzy matching, `agrep`, and DNA read mapping. Reconstructing *where* the match starts uses the same traceback, stopping when you reach the all-zero top row.

This is the bridge from "edit distance between two whole strings" to "edit distance as a *search* primitive over text" — the defining string-algorithms application of the topic, and the reason it lives under `17-string-algorithms` and not only under dynamic programming.

---

## Linear-Space Alignment: Hirschberg

Traceback needs the path, and the path seemingly needs the whole `O(nm)` table — a problem for very long strings (the two-row trick gives the *number* in `O(min(n,m))` space but discards the path). **Hirschberg's algorithm (1975)** recovers the **full alignment in `O(min(n,m))` space** and still `O(nm)` time, using divide and conquer:

1. Split `A` at its midpoint row `i* = n/2`.
2. Compute, in linear space (two-row forward DP), the cost of aligning `A[0..i*)` to every prefix `B[0..j)` — call it `L[j]`.
3. Compute, in linear space (two-row backward DP), the cost of aligning `A[i*..n)` to every suffix `B[j..m)` — call it `R[j]`.
4. The optimal alignment crosses row `i*` at the column `j*` minimizing `L[j] + R[j]`. This is the **midpoint** of the optimal path.
5. Recurse on the top-left rectangle `(A[0..i*), B[0..j*))` and bottom-right rectangle `(A[i*..n), B[j*..m))`.

Each level of recursion does `O(nm)` total work but the work halves the *area* considered, so the total is still `O(nm)` time; space is `O(m)` because every step uses only two rows. Hirschberg is what lets you align megabyte strings (or whole-chromosome sequences) without `O(nm)` memory. It is the standard answer to "I need the alignment, not just the number, but I cannot afford the full table."

---

## Comparison with Alternatives

| Problem | Best tool | Complexity | Notes |
|---------|-----------|-----------|-------|
| Distance + alignment of whole strings | DP + traceback | `O(nm)` time, `O(nm)` space | classic |
| Distance/alignment, tight memory | Hirschberg | `O(nm)` time, `O(min(n,m))` space | divide and conquer |
| Distance number only | two-row DP | `O(nm)` time, `O(min(n,m))` space | no traceback |
| Distance when answer `d` is small | Ukkonen banded | `O(nd)` | output-sensitive |
| Best similarity, whole strings | Needleman-Wunsch | `O(nm)` | scoring + substitution matrix |
| Best matching *region* | Smith-Waterman | `O(nm)` | clamp to 0, max cell |
| Realistic gaps | Gotoh (affine) | `O(nm)`, 3× constant | gap open vs extend |
| Typo-tolerant (swaps cost 1) | Damerau-Levenshtein | `O(nm)` | +transposition case |
| Find pattern in text within `k` | approx. matching (banded) | `O(kn)` | top row = 0 |
| Only substitutions, equal length | Hamming | `O(n)` | no indels |
| Token/word similarity, sets | Jaccard / cosine | depends | not edit-based |

The decision tree: *Do you need the alignment or just the number? Whole strings or a region? Is the distance small? Are gaps contiguous events? Are swaps common? Are you searching a text or comparing two strings?* Each branch selects one of the above.

---

## Code Examples

### Needleman-Wunsch global alignment with traceback

#### Python

```python
def needleman_wunsch(a, b, match=1, mismatch=-1, gap=-1):
    n, m = len(a), len(b)
    H = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        H[i][0] = i * gap
    for j in range(1, m + 1):
        H[0][j] = j * gap
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s = match if a[i - 1] == b[j - 1] else mismatch
            H[i][j] = max(H[i - 1][j - 1] + s, H[i - 1][j] + gap, H[i][j - 1] + gap)
    # traceback
    ta, tb = [], []
    i, j = n, m
    while i > 0 or j > 0:
        s = match if (i > 0 and j > 0 and a[i - 1] == b[j - 1]) else mismatch
        if i > 0 and j > 0 and H[i][j] == H[i - 1][j - 1] + s:
            ta.append(a[i - 1]); tb.append(b[j - 1]); i -= 1; j -= 1
        elif i > 0 and H[i][j] == H[i - 1][j] + gap:
            ta.append(a[i - 1]); tb.append("-"); i -= 1
        else:
            ta.append("-"); tb.append(b[j - 1]); j -= 1
    return H[n][m], "".join(reversed(ta)), "".join(reversed(tb))


if __name__ == "__main__":
    score, x, y = needleman_wunsch("GATTACA", "GCATGCU")
    print("score =", score)
    print(x)
    print(y)
```

#### Go

```go
package main

import "fmt"

func max3(a, b, c int) int {
	m := a
	if b > m {
		m = b
	}
	if c > m {
		m = c
	}
	return m
}

func needlemanWunsch(a, b string, match, mismatch, gap int) (int, string, string) {
	n, m := len(a), len(b)
	H := make([][]int, n+1)
	for i := range H {
		H[i] = make([]int, m+1)
	}
	for i := 1; i <= n; i++ {
		H[i][0] = i * gap
	}
	for j := 1; j <= m; j++ {
		H[0][j] = j * gap
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			s := mismatch
			if a[i-1] == b[j-1] {
				s = match
			}
			H[i][j] = max3(H[i-1][j-1]+s, H[i-1][j]+gap, H[i][j-1]+gap)
		}
	}
	var ta, tb []byte
	i, j := n, m
	for i > 0 || j > 0 {
		s := mismatch
		if i > 0 && j > 0 && a[i-1] == b[j-1] {
			s = match
		}
		switch {
		case i > 0 && j > 0 && H[i][j] == H[i-1][j-1]+s:
			ta = append(ta, a[i-1]); tb = append(tb, b[j-1]); i--; j--
		case i > 0 && H[i][j] == H[i-1][j]+gap:
			ta = append(ta, a[i-1]); tb = append(tb, '-'); i--
		default:
			ta = append(ta, '-'); tb = append(tb, b[j-1]); j--
		}
	}
	rev := func(s []byte) string {
		for x, y := 0, len(s)-1; x < y; x, y = x+1, y-1 {
			s[x], s[y] = s[y], s[x]
		}
		return string(s)
	}
	return H[n][m], rev(ta), rev(tb)
}

func main() {
	score, x, y := needlemanWunsch("GATTACA", "GCATGCU", 1, -1, -1)
	fmt.Println("score =", score)
	fmt.Println(x)
	fmt.Println(y)
}
```

#### Java

```java
public class NeedlemanWunsch {
    static int max3(int a, int b, int c) { return Math.max(a, Math.max(b, c)); }

    public static void main(String[] args) {
        String a = "GATTACA", b = "GCATGCU";
        int match = 1, mismatch = -1, gap = -1;
        int n = a.length(), m = b.length();
        int[][] H = new int[n + 1][m + 1];
        for (int i = 1; i <= n; i++) H[i][0] = i * gap;
        for (int j = 1; j <= m; j++) H[0][j] = j * gap;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++) {
                int s = a.charAt(i - 1) == b.charAt(j - 1) ? match : mismatch;
                H[i][j] = max3(H[i - 1][j - 1] + s, H[i - 1][j] + gap, H[i][j - 1] + gap);
            }
        System.out.println("score = " + H[n][m]);
        StringBuilder ta = new StringBuilder(), tb = new StringBuilder();
        int i = n, j = m;
        while (i > 0 || j > 0) {
            int s = (i > 0 && j > 0 && a.charAt(i - 1) == b.charAt(j - 1)) ? match : mismatch;
            if (i > 0 && j > 0 && H[i][j] == H[i - 1][j - 1] + s) {
                ta.append(a.charAt(i - 1)); tb.append(b.charAt(j - 1)); i--; j--;
            } else if (i > 0 && H[i][j] == H[i - 1][j] + gap) {
                ta.append(a.charAt(i - 1)); tb.append('-'); i--;
            } else {
                ta.append('-'); tb.append(b.charAt(j - 1)); j--;
            }
        }
        System.out.println(ta.reverse());
        System.out.println(tb.reverse());
    }
}
```

### Banded distance check (`distance ≤ k?`)

#### Python

```python
def bounded_edit_distance(a, b, k):
    """Return edit distance if <= k, else None. Fills only the |i-j|<=k band."""
    n, m = len(a), len(b)
    if abs(n - m) > k:
        return None  # length gap alone exceeds the budget
    INF = k + 1
    prev = [0] * (m + 1)
    for j in range(m + 1):
        prev[j] = j if j <= k else INF
    for i in range(1, n + 1):
        cur = [INF] * (m + 1)
        lo, hi = max(1, i - k), min(m, i + k)
        cur[lo - 1] = i if (lo - 1 == 0 and i <= k) else INF
        for j in range(lo, hi + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1)
        prev = cur
    d = prev[m]
    return d if d <= k else None


if __name__ == "__main__":
    print(bounded_edit_distance("receive", "recieve", 2))  # 2
    print(bounded_edit_distance("receive", "xyzzy", 2))     # None (> 2)
```

#### Go

```go
package main

import "fmt"

func boundedEditDistance(a, b string, k int) (int, bool) {
	n, m := len(a), len(b)
	if abs(n-m) > k {
		return 0, false
	}
	INF := k + 1
	prev := make([]int, m+1)
	for j := 0; j <= m; j++ {
		if j <= k {
			prev[j] = j
		} else {
			prev[j] = INF
		}
	}
	for i := 1; i <= n; i++ {
		cur := make([]int, m+1)
		for j := range cur {
			cur[j] = INF
		}
		lo, hi := maxi(1, i-k), mini(m, i+k)
		if lo-1 == 0 && i <= k {
			cur[0] = i
		}
		for j := lo; j <= hi; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = mini(prev[j-1]+cost, mini(prev[j]+1, cur[j-1]+1))
		}
		prev = cur
	}
	if prev[m] <= k {
		return prev[m], true
	}
	return 0, false
}

func abs(x int) int    { if x < 0 { return -x }; return x }
func mini(a, b int) int { if a < b { return a }; return b }
func maxi(a, b int) int { if a > b { return a }; return b }

func main() {
	d, ok := boundedEditDistance("receive", "recieve", 2)
	fmt.Println(d, ok) // 2 true
	_, ok2 := boundedEditDistance("receive", "xyzzy", 2)
	fmt.Println(ok2) // false
}
```

#### Java

```java
public class BandedEditDistance {
    static Integer bounded(String a, String b, int k) {
        int n = a.length(), m = b.length();
        if (Math.abs(n - m) > k) return null;
        int INF = k + 1;
        int[] prev = new int[m + 1];
        for (int j = 0; j <= m; j++) prev[j] = j <= k ? j : INF;
        for (int i = 1; i <= n; i++) {
            int[] cur = new int[m + 1];
            java.util.Arrays.fill(cur, INF);
            int lo = Math.max(1, i - k), hi = Math.min(m, i + k);
            if (lo - 1 == 0 && i <= k) cur[0] = i;
            for (int j = lo; j <= hi; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(prev[j - 1] + cost, Math.min(prev[j] + 1, cur[j - 1] + 1));
            }
            prev = cur;
        }
        return prev[m] <= k ? prev[m] : null;
    }

    public static void main(String[] args) {
        System.out.println(bounded("receive", "recieve", 2)); // 2
        System.out.println(bounded("receive", "xyzzy", 2));    // null
    }
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Band too narrow | Banded answer is wrong because the true path left the band. | Band width must be `2k+1`; if `dp[n][m] > k` you can only report "> k", not a number. |
| Smith-Waterman with all-negative scores | Whole matrix clamps to 0; "best" is an empty alignment. | That is correct — it means no positive-scoring region; check your score scheme. |
| Gotoh mixing the three layers | Reading the answer from `M` only, missing a gap-ending optimum. | Answer is `max(M, X, Y)` at the corner. |
| Damerau OSA editing transposed region twice | Restricted variant double-counts. | Use OSA rules (no re-edit of a swapped pair) or the true DL table. |
| Approximate matching forgetting `dp[0][j]=0` | Pattern forced to start at text position 0. | Top row must be all zeros for "start anywhere." |
| Hirschberg midpoint off-by-one | Wrong split column merges/loses a character. | `j*` minimizes `L[j]+R[j]`; recurse on disjoint rectangles. |

---

## Performance Analysis

| `n`, `m` | Full `O(nm)` cells | Banded `O(kn)` (k=2) | Hirschberg space |
|----------|--------------------|-----------------------|------------------|
| 100, 100 | 10 000 | ~500 | ~100 ints |
| 1 000, 1 000 | 1 000 000 | ~5 000 | ~1 000 ints |
| 10⁶, 10⁶ | 10¹² (infeasible) | ~5·10⁶ (if `k` tiny) | ~10⁶ ints |

The lessons:

- For **similar** strings (small `d`), Ukkonen banding turns an infeasible `O(nm)` into a fast `O(nd)`. This is the single biggest practical win for spell-check and version diffs.
- For **dissimilar long** strings, `d` is large and banding does not help; you are stuck near `O(nm)` (and a quadratic *lower bound* under SETH — see `professional.md`).
- For **memory**, Hirschberg makes alignment of arbitrarily long strings feasible at `O(min(n,m))` space, trading a 2× time constant.
- **Smith-Waterman / Gotoh** are `O(nm)` with a small constant factor (3× for affine); they do not reduce asymptotics, they improve *answer quality*.

---

## Best Practices

- **Pick the right alignment mode first:** global (NW) for whole-string similarity, local (SW) for best-region, semi-global for "pattern anywhere in text."
- **Use affine gaps (Gotoh)** whenever contiguous indels are one logical event — it dramatically improves diffs and biological alignments.
- **Band when distances are small;** start with a threshold `k` and, if unknown, double it (Ukkonen). Bail out early on a length gap `|n−m| > k`.
- **Use Hirschberg** when you need the alignment but cannot afford `O(nm)` memory.
- **Choose Damerau (OSA)** for typo-tolerant search where swaps are common; plain Levenshtein otherwise.
- **Always validate** banded/Hirschberg outputs against the plain `O(nm)` DP on small inputs — these optimizations are bug-prone at the boundaries.
- **Reuse the substitution-matrix idea** (NW `score(x,y)`) instead of a flat mismatch cost when some substitutions are "closer" than others.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The animation highlights:
> - The DP grid filling under the three-way minimum, cell by cell.
> - The traceback path retraced from the corner, colored by operation (match / substitute / insert / delete).
> - How the optimal path stays inside a diagonal band when the distance is small — the geometric basis of Ukkonen `O(nd)`.
> - The reconstructed alignment built up from the traced operations.

---

## Summary

The middle-level upgrade is to stop thinking of edit distance as a single number and start thinking of it as **alignment = shortest path in the edit grid**. From that one picture the whole string toolbox follows: **Needleman-Wunsch** scores a global alignment with rewards/penalties (and substitution matrices); **Smith-Waterman** clamps to zero to find the best matching *region*; **Gotoh** adds three DP layers so contiguous gaps share an open cost (affine penalties); **Damerau-Levenshtein** adds a transposition case so swaps cost 1. When the distance `d` is small, the optimal path hugs the diagonal, so **Ukkonen's banded `O(nd)`** beats `O(nm)`; the same farthest-reaching-diagonal idea powers `k`-approximate **substring matching** (set the top row to zero to start the pattern anywhere). When memory is the constraint, **Hirschberg** recovers the full alignment in `O(min(n,m))` space via divide and conquer. The pure-DP recurrence is taken from the sibling `13-dynamic-programming/04-edit-distance`; everything here is the alignment, approximate-matching, and space/time engineering built on top of it.
