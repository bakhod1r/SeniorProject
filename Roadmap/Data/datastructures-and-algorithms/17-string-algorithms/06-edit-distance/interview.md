# Edit Distance — Interview Preparation

Edit distance is one of the most-asked string/DP interview topics because it layers cleanly: the one-line idea (*"minimum inserts/deletes/substitutions to turn A into B, an `O(nm)` DP"*), then traceback to recover the **alignment**, then approximate matching (*"is the distance ≤ k?"*, *"find the pattern in text within k edits"*), then the contrast with LCS, and finally the production angle (fuzzy search, Myers, banding). This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Distance between two strings | DP table `dp[n][m]` | `O(nm)` time, `O(nm)` space |
| Distance, save memory (number only) | two-row DP | `O(nm)` time, `O(min(n,m))` space |
| Recover the edits / alignment | traceback from `(n,m)` | `O(n+m)` after the fill |
| Alignment with linear memory | Hirschberg | `O(nm)` time, `O(min(n,m))` space |
| Is distance ≤ k? (small k) | banded / Ukkonen | `O(kn)` |
| Find pattern in text within k edits | approx. matching (top row = 0) | `O(kn)` banded |
| Best global similarity alignment | Needleman-Wunsch | `O(nm)` |
| Best local (region) alignment | Smith-Waterman | `O(nm)` |
| Swaps cost 1 (typos) | Damerau-Levenshtein | `O(nm)` |
| Fastest practical kernel | Myers bit-parallel | `O(nm/w)` |
| Indel-only distance | `n + m − 2·LCS` | `O(nm)` |

Core recurrence:

```text
dp[i][0] = i ; dp[0][j] = j
dp[i][j] = dp[i-1][j-1]                          if A[i-1]==B[j-1]   (free match)
         = 1 + min(dp[i-1][j-1],  # substitute
                   dp[i-1][j],    # delete
                   dp[i][j-1])    # insert         otherwise
answer = dp[n][m]
```

Key facts to say out loud:
- **It's an alignment / shortest-path-in-a-grid problem**: the table is a DAG, the answer is the corner, traceback is path reconstruction.
- **Distance ≤ k ⇒ the optimal path stays in a band `|i−j| ≤ k`** ⇒ banding gives `O(kn)`.
- **Plain Levenshtein charges 2 for a swap**; Damerau fixes it.
- **It's a metric** (triangle inequality) — that's what BK-trees use.
- **Exact subquadratic is impossible under SETH**; speedups need structure (small `d`, words, approximation).

---

## Junior Questions (10 Q&A)

### J1. What is edit distance?
The minimum number of single-character edits — insert, delete, substitute — that transform one string into another. With each edit costing 1, it is the **Levenshtein distance**. Example: `kitten → sitting` is 3.

### J2. What are the base cases of the DP?
`dp[0][j] = j` (turn the empty string into `B`'s first `j` chars by `j` inserts) and `dp[i][0] = i` (turn `A`'s first `i` chars into empty by `i` deletes).

### J3. Why does the recurrence take a `min` of three things?
The last alignment column is either a match/substitution (diagonal `dp[i-1][j-1]`), a delete of `A`'s last char (`dp[i-1][j]+1`), or an insert of `B`'s last char (`dp[i][j-1]+1`). The minimum picks the cheapest way to finish.

### J4. When is a substitution free?
When the two characters are equal — then `dp[i][j] = dp[i-1][j-1]` with no `+1`. A match is the free diagonal move.

### J5. What is the time and space complexity?
`O(n·m)` time to fill the table, `O(n·m)` space for the full table, or `O(min(n,m))` space if you only need the number (two-row trick).

### J6. How do you recover the actual edits, not just the count?
**Traceback**: start at the bottom-right cell and step to whichever predecessor produced its value (diagonal for match/sub, up for delete, left for insert), collecting operations, then reverse them. It is `O(n+m)` and needs the full table.

### J7. What is the edit distance between a string and the empty string?
Its length — you delete (or insert) every character.

### J8. How is edit distance different from Hamming distance?
Hamming counts only substitutions and requires equal-length strings (no inserts/deletes). Edit distance allows all three operations and handles different lengths.

### J9. Is the table 0-indexed or 1-indexed?
The table is `(n+1) × (m+1)` and 1-indexed over prefix lengths; character `i` of the prefix is `A[i-1]` in 0-based string indexing. Mixing these up is the most common bug.

### J10 (analysis). Why can't you just use plain recursion?
The naive recursive formula recomputes the same subproblems exponentially many times. Memoization or the bottom-up table reduces it to `O(nm)`.

---

## Middle Questions (10 Q&A)

### M1. Explain edit distance as a shortest path.
Build a grid where node `(i,j)` has a diagonal edge (cost 0 if chars match, else 1 = substitute), a down edge (cost 1 = delete), and a right edge (cost 1 = insert). Edit distance is the shortest path from `(0,0)` to `(n,m)`. The DP is just relaxing this DAG; traceback is path reconstruction.

### M2. What's the difference between global and local alignment?
Global (Needleman-Wunsch) aligns both strings end to end. Local (Smith-Waterman) finds the single best-matching *region* by clamping cell scores at 0 and taking the maximum cell anywhere, with traceback stopping at the first 0.

### M3. What are affine gap penalties and why do they matter?
A run of `L` consecutive indels costs `gap_open + L·gap_extend` rather than `L·gap`, modeling a contiguous insertion/deletion as one event. Gotoh's algorithm computes this in `O(nm)` using three DP layers (match-state, gap-in-A, gap-in-B). It gives more natural diffs and biological alignments.

### M4. How do you handle transpositions like `teh → the`?
Damerau-Levenshtein adds a transposition operation at cost 1, with an extra recurrence case `dp[i-2][j-2]+1` when the last two characters are swapped. Plain Levenshtein would charge 2.

### M5. The strings are huge but you expect them to be very similar. How do you speed up?
Band the DP: if the distance is `≤ k`, the optimal path stays within `|i−j| ≤ k`, so fill only that diagonal stripe in `O(kn)`. If `k` is unknown, double it (Ukkonen): try `k = 1,2,4,…` until the banded answer fits — giving `O(nd)` where `d` is the true distance.

### M6. How do you check "is the edit distance ≤ k?" efficiently?
First reject if `|n − m| > k` (length gap alone exceeds the budget). Then fill only the band `|i−j| ≤ k`; if `dp[n][m] > k`, report "> k". `O(kn)`.

### M7. How do you find where a pattern occurs in a text within k edits?
Set the DP's top row to all zeros (`dp[0][j] = 0`) so the pattern can start at any text position for free. Then every text column `j` with `dp[m][j] ≤ k` is the end of an approximate match. Band it for `O(kn)`.

### M8. You need the alignment but can't afford `O(nm)` memory. What do you do?
Hirschberg's algorithm: find the column where the optimal path crosses the middle row (using two linear-space half-DPs), then recurse on the two sub-rectangles. `O(nm)` time, `O(min(n,m))` space.

### M9. How does edit distance relate to LCS?
With only inserts and deletes (no substitution), the distance is `n + m − 2·LCS(A,B)`: matched characters are the longest common subsequence, and everything else is inserted or deleted. Levenshtein additionally allows cost-1 substitutions, so `levenshtein ≤ indel_distance`.

### M10 (analysis). Why is the DP table "1-Lipschitz" and why is that useful?
Adjacent cells differ by at most 1. This lets Myers' algorithm store the ±1/0 differences between neighbors as bitmasks (2 bits/cell), packing `w` cells per machine word and computing a whole column in `O(⌈m/w⌉)` operations.

---

## Senior Questions (8 Q&A)

### S1. Design fuzzy autocomplete over a 5-million-word dictionary at keystroke latency.
Filter-then-verify. Build an offline index (SymSpell deletion map for `k ≤ 2`, or a Levenshtein-automaton-over-trie, or a BK-tree). Per keystroke: produce a small candidate set from the index (no DP against all words), then run a **banded** edit-distance verify only on candidates, then rank by distance and frequency. Cap `k` at 2 and add a length prefilter.

### S2. How does a BK-tree work and why is it correct?
A BK-tree partitions strings by integer edit distance to a parent. To find all words within `k` of a query `q`, compute `d = d(q, node)`, report if `d ≤ k`, and only descend into child edges labeled `[d−k, d+k]`. Correctness follows from the **triangle inequality**: any word within `k` of `q` must have distance to the node within `[d−k, d+k]`, so other subtrees are safely pruned. It requires a true metric (unit Levenshtein, not OSA Damerau).

### S3. Explain Myers' bit-parallel edit distance.
It exploits that adjacent table cells differ by ±1 or 0, storing per-column the bitmasks of vertical +1 and −1 differences. Each new text column is computed via bitwise ops and one carry-propagating addition (the add realizes the cell `min` for all `w` rows at once). For a pattern of `m ≤ 64` it processes each text char in `O(1)` words, giving `O(n)`; longer patterns use multi-word vectors for `O(n·⌈m/w⌉)`. It's the fastest practical kernel; validate it against the plain DP.

### S4. When is local alignment (Smith-Waterman) the right choice over global?
When you want the best-matching *substring region* rather than an end-to-end alignment — e.g. finding a gene fragment in a chromosome, or a quoted passage inside a long document. Clamp negative scores to 0 and take the max cell.

### S5. What's the lower bound for exact edit distance, and what does it imply?
Under SETH, there is no `O(n^{2−δ})` exact algorithm (Backurs-Indyk 2015, via a reduction from Orthogonal Vectors). So all speedups need structure: small distance (Ukkonen `O(nd)`), word-parallelism (Myers, constant factor), or approximation (subquadratic constant-factor approximations exist). Do not promise a general subquadratic exact algorithm.

### S6. How do you verify a fuzzy-search index in production?
A brute-force recall oracle: for a sample of queries, scan the whole corpus for the true within-`k` set and assert the index returns all of them. Plus differential tests of Myers/banded versus the plain DP, a triangle-inequality assertion for BK-trees, and latency percentiles (p95/p99), since candidate-set blowups create heavy tails.

### S7. How would you make verification per-candidate as cheap as possible?
Length-difference prefilter (`|n−m| > k ⇒ reject`), strip common prefix/suffix (zero-cost), band with budget `k`, and bail out the moment the band's minimum exceeds `k` (Ukkonen cutoff). Optionally banded-Myers for `O(n·⌈k/w⌉)`.

### S8 (analysis). Why does plain Levenshtein hurt user-facing typo correction, and what's the fix?
Keyboard swaps (`teh→the`, `recieve→receive`) are single human errors but Levenshtein scores them 2, so a `k=1` budget drops the right suggestion. Use Damerau (OSA) distance so transpositions cost 1. Note OSA is not a metric, so if you also index with a BK-tree, use true Damerau or unit Levenshtein.

---

## Professional Questions (6 Q&A)

### P1. Prove edit distance satisfies the triangle inequality.
Take optimal edit sequences `S₁: x→y` and `S₂: y→z`. Their concatenation `S₂∘S₁` transforms `x→z` at cost `d(x,y)+d(y,z)`. Since `d(x,z)` is the minimum over all `x→z` sequences, `d(x,z) ≤ d(x,y)+d(y,z)`. (Plus symmetry from invertible operations and identity from cost-0 sequences making it a full metric.)

### P2. How does Hirschberg achieve linear space, and why is it correct?
It computes, in two-row linear space, the forward distance from the top-left to every cell of the middle row, and the backward distance from the bottom-right to every cell of the middle row. The optimal path crosses the middle row at the column `j*` minimizing `forward[j] + backward[j]`. It then recurses on the top-left and bottom-right rectangles. Correct because any alignment splits at the middle row into independently-optimal halves; `O(nm)` time by geometric area shrinkage, `O(m)` space.

### P3. Explain Ukkonen's `O(nd)` algorithm conceptually.
Instead of values, track for each diagonal the farthest-reaching row achievable with a given edit budget, sliding freely through matching characters ("snakes"). At budget `e` only diagonals in `[−e, e]` are live (diagonal confinement), so wave `e` does `O(e)` work plus monotone snake advancement bounded by `n`. Total `O(nd)`; doubling handles unknown `d`.

### P4. Why is OSA Damerau not a metric but true Damerau is?
OSA forbids editing a transposed substring again, which can block a shortcut that the composed path `x→y→z` would need, violating the triangle inequality. True Damerau-Levenshtein allows arbitrary further edits (using a last-occurrence table) and restores metricity. This matters for any metric-space index built on the distance.

### P5. How do you align two whole chromosomes (gigabases)?
You do not run `O(nm)` globally. Seed-and-extend: index the reference (suffix array / FM-index), find exact or near-exact anchor matches, chain them, and run **banded affine** (Gotoh) alignment only in the gaps between anchors, often SIMD-vectorized or via WFA (`O(nd)`-style). The whole pipeline is filter-then-verify at genomic scale.

### P6 (analysis). Contrast the recurrences of LCS and edit distance.
Both fill an `O(nm)` grid with a three-way choice. LCS *rewards* a match (`+1` on the diagonal when chars equal) and otherwise takes `max(up, left)` — no substitution move. Edit distance *penalizes* and adds the cost-1 diagonal substitution move. Indel-only edit distance equals `n + m − 2·LCS`. Same grid structure, same quadratic SETH barrier, differing only in how the diagonal is priced.

---

## Behavioral / System-Design Questions (4 short)

### B1. Tell me about optimizing a slow string-comparison feature.
Look for: profiling that showed quadratic edit distance dominating, the realization that matches were near-duplicates (small `d`), and a switch to banded/Ukkonen or a filter-then-verify index, with a measured latency drop and a recall oracle to prove correctness was preserved.

### B2. A teammate's spell-checker misses obvious swaps. How do you respond?
Diagnose: plain Levenshtein scores `teh→the` as 2, so a `k=1` budget drops it. Recommend Damerau (OSA) distance, note the metric caveat if a BK-tree is involved, and add a test with common swap typos. Frame it as a teaching moment, with a tiny worked example.

### B3. Design "did you mean…?" for a search box.
Filter-then-verify: an index (SymSpell/automaton) for candidates, banded Damerau verify, rank by distance then query frequency/popularity. Discuss capping `k`, Unicode normalization, latency tails from short queries, and A/B-testing suggestion quality.

### B4. How would you explain edit distance to a junior engineer?
Use the copy-editor analogy: the fewest keystrokes (insert/delete/replace) to fix one word into another. Show the grid fill, then traceback as "retracing your route to see which turns you took." Lead with the two gotchas: it counts character edits (not semantics), and swaps cost 2 unless you use Damerau.

---

## Coding Challenges

### Challenge 1: Edit Distance + Reconstructed Edit Script

**Problem.** Given two strings, return the Levenshtein distance and the list of operations (e.g. `MATCH`, `SUB a->b`, `DEL a`, `INS b`) that transform `A` into `B`.

**Example.** `A="sunday", B="saturday"` → distance 3, ops include `MATCH s`, `INS a`, `INS t`, `MATCH u`, `SUB n->r`, `MATCH d`, `MATCH a`, `MATCH y`.

**Approach.** Fill the DP table, then trace back recording each move. `O(nm)` time/space.

**Go.**
```go
package main

import "fmt"

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}

func editScript(a, b string) (int, []string) {
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
		dp[i][0] = i
	}
	for j := 0; j <= m; j++ {
		dp[0][j] = j
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1]
			} else {
				dp[i][j] = 1 + min3(dp[i-1][j-1], dp[i-1][j], dp[i][j-1])
			}
		}
	}
	var ops []string
	i, j := n, m
	for i > 0 || j > 0 {
		switch {
		case i > 0 && j > 0 && a[i-1] == b[j-1] && dp[i][j] == dp[i-1][j-1]:
			ops = append(ops, fmt.Sprintf("MATCH %c", a[i-1])); i--; j--
		case i > 0 && j > 0 && dp[i][j] == dp[i-1][j-1]+1:
			ops = append(ops, fmt.Sprintf("SUB %c->%c", a[i-1], b[j-1])); i--; j--
		case i > 0 && dp[i][j] == dp[i-1][j]+1:
			ops = append(ops, fmt.Sprintf("DEL %c", a[i-1])); i--
		default:
			ops = append(ops, fmt.Sprintf("INS %c", b[j-1])); j--
		}
	}
	for l, r := 0, len(ops)-1; l < r; l, r = l+1, r-1 {
		ops[l], ops[r] = ops[r], ops[l]
	}
	return dp[n][m], ops
}

func main() {
	d, ops := editScript("sunday", "saturday")
	fmt.Println("distance =", d)
	fmt.Println(ops)
}
```

**Java.**
```java
import java.util.*;

public class EditScript {
    static int min3(int a, int b, int c) { return Math.min(a, Math.min(b, c)); }

    public static void main(String[] args) {
        String a = "sunday", b = "saturday";
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) dp[i][0] = i;
        for (int j = 0; j <= m; j++) dp[0][j] = j;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                dp[i][j] = a.charAt(i - 1) == b.charAt(j - 1)
                        ? dp[i - 1][j - 1]
                        : 1 + min3(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        System.out.println("distance = " + dp[n][m]);
        List<String> ops = new ArrayList<>();
        int i = n, j = m;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a.charAt(i - 1) == b.charAt(j - 1) && dp[i][j] == dp[i - 1][j - 1]) {
                ops.add("MATCH " + a.charAt(i - 1)); i--; j--;
            } else if (i > 0 && j > 0 && dp[i][j] == dp[i - 1][j - 1] + 1) {
                ops.add("SUB " + a.charAt(i - 1) + "->" + b.charAt(j - 1)); i--; j--;
            } else if (i > 0 && dp[i][j] == dp[i - 1][j] + 1) {
                ops.add("DEL " + a.charAt(i - 1)); i--;
            } else {
                ops.add("INS " + b.charAt(j - 1)); j--;
            }
        }
        Collections.reverse(ops);
        System.out.println(ops);
    }
}
```

**Python.**
```python
def edit_script(a, b):
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = dp[i - 1][j - 1] if a[i - 1] == b[j - 1] \
                else 1 + min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            ops.append(f"MATCH {a[i-1]}"); i, j = i - 1, j - 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append(f"SUB {a[i-1]}->{b[j-1]}"); i, j = i - 1, j - 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(f"DEL {a[i-1]}"); i -= 1
        else:
            ops.append(f"INS {b[j-1]}"); j -= 1
    ops.reverse()
    return dp[n][m], ops


if __name__ == "__main__":
    print(edit_script("sunday", "saturday"))
```

---

### Challenge 2: One Edit Away

**Problem.** Given two strings, return `true` if they are zero or one edit (insert, delete, or substitute) apart. Do it in `O(n)` without a full DP table.

**Example.** `("pale","ple")→true (delete a)`, `("pales","pale")→true (delete s)`, `("pale","bake")→false (two subs)`.

**Approach.** If lengths differ by more than 1, return false. Walk both strings; on the first mismatch, if lengths equal skip both (substitution), else skip the longer (indel); allow exactly one such fix.

**Go.**
```go
package main

import "fmt"

func oneEditAway(a, b string) bool {
	if len(a) < len(b) {
		a, b = b, a // a is the longer (or equal)
	}
	if len(a)-len(b) > 1 {
		return false
	}
	i, j, foundDiff := 0, 0, false
	for i < len(a) && j < len(b) {
		if a[i] != b[j] {
			if foundDiff {
				return false
			}
			foundDiff = true
			if len(a) == len(b) {
				j++ // substitution: advance both
			}
		} else {
			j++
		}
		i++
	}
	return true
}

func main() {
	fmt.Println(oneEditAway("pale", "ple"))  // true
	fmt.Println(oneEditAway("pales", "pale")) // true
	fmt.Println(oneEditAway("pale", "bake"))  // false
}
```

**Java.**
```java
public class OneEditAway {
    static boolean oneEditAway(String a, String b) {
        if (a.length() < b.length()) { String t = a; a = b; b = t; }
        if (a.length() - b.length() > 1) return false;
        int i = 0, j = 0; boolean found = false;
        while (i < a.length() && j < b.length()) {
            if (a.charAt(i) != b.charAt(j)) {
                if (found) return false;
                found = true;
                if (a.length() == b.length()) j++;
            } else {
                j++;
            }
            i++;
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(oneEditAway("pale", "ple"));   // true
        System.out.println(oneEditAway("pales", "pale")); // true
        System.out.println(oneEditAway("pale", "bake"));  // false
    }
}
```

**Python.**
```python
def one_edit_away(a, b):
    if len(a) < len(b):
        a, b = b, a
    if len(a) - len(b) > 1:
        return False
    i = j = 0
    found = False
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            if found:
                return False
            found = True
            if len(a) == len(b):
                j += 1
        else:
            j += 1
        i += 1
    return True


if __name__ == "__main__":
    print(one_edit_away("pale", "ple"))    # True
    print(one_edit_away("pales", "pale"))  # True
    print(one_edit_away("pale", "bake"))   # False
```

---

### Challenge 3: Fuzzy Match Within k (Banded)

**Problem.** Given a query and a list of words, return all words whose Levenshtein distance from the query is at most `k`. Use a banded DP with an early length-gap reject.

**Approach.** For each word, reject if `|len diff| > k`, else run the banded DP (`O(kn)`) and keep it if `≤ k`.

**Python.**
```python
def bounded(a, b, k):
    n, m = len(a), len(b)
    if abs(n - m) > k:
        return None
    INF = k + 1
    prev = [j if j <= k else INF for j in range(m + 1)]
    for i in range(1, n + 1):
        cur = [INF] * (m + 1)
        lo, hi = max(1, i - k), min(m, i + k)
        if lo - 1 == 0 and i <= k:
            cur[0] = i
        for j in range(lo, hi + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1)
        prev = cur
    return prev[m] if prev[m] <= k else None


def fuzzy_match(query, words, k):
    out = []
    for w in words:
        d = bounded(query, w, k)
        if d is not None:
            out.append((w, d))
    out.sort(key=lambda p: p[1])
    return out


if __name__ == "__main__":
    print(fuzzy_match("recieve", ["receive", "relieve", "deceive", "cat"], 2))
```

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func bounded(a, b string, k int) (int, bool) {
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

func abs(x int) int     { if x < 0 { return -x }; return x }
func mini(a, b int) int { if a < b { return a }; return b }
func maxi(a, b int) int { if a > b { return a }; return b }

func main() {
	q := "recieve"
	words := []string{"receive", "relieve", "deceive", "cat"}
	type res struct {
		w string
		d int
	}
	var out []res
	for _, w := range words {
		if d, ok := bounded(q, w, 2); ok {
			out = append(out, res{w, d})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].d < out[j].d })
	fmt.Println(out)
}
```

**Java.**
```java
import java.util.*;

public class FuzzyMatch {
    static Integer bounded(String a, String b, int k) {
        int n = a.length(), m = b.length();
        if (Math.abs(n - m) > k) return null;
        int INF = k + 1;
        int[] prev = new int[m + 1];
        for (int j = 0; j <= m; j++) prev[j] = j <= k ? j : INF;
        for (int i = 1; i <= n; i++) {
            int[] cur = new int[m + 1];
            Arrays.fill(cur, INF);
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
        String q = "recieve";
        String[] words = {"receive", "relieve", "deceive", "cat"};
        List<int[]> idx = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (String w : words) {
            Integer d = bounded(q, w, 2);
            if (d != null) { names.add(w); idx.add(new int[]{d}); }
        }
        // pair and sort by distance
        Integer[] order = new Integer[names.size()];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.comparingInt(i -> idx.get(i)[0]));
        for (int i : order) System.out.println(names.get(i) + " " + idx.get(i)[0]);
    }
}
```

---

### Challenge 4: LCS vs Edit Distance Contrast

**Problem.** Implement both LCS length and Levenshtein distance, and verify the identity `indel_distance = n + m − 2·LCS` (indel distance = Levenshtein with substitutions disallowed).

**Approach.** Two `O(nm)` DPs. LCS rewards matches; indel-distance allows only insert/delete. Confirm the relationship.

**Python.**
```python
def lcs_len(a, b):
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = dp[i - 1][j - 1] + 1 if a[i - 1] == b[j - 1] \
                else max(dp[i - 1][j], dp[i][j - 1])
    return dp[n][m]


def indel_distance(a, b):
    # Levenshtein with substitution disallowed (only insert/delete)
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1])  # no diagonal sub
    return dp[n][m]


if __name__ == "__main__":
    a, b = "AGCAT", "GAC"
    L = lcs_len(a, b)
    print("LCS =", L, "indel =", indel_distance(a, b),
          "formula =", len(a) + len(b) - 2 * L)
```

**Go.**
```go
package main

import "fmt"

func lcsLen(a, b string) int {
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] > dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}
	return dp[n][m]
}

func indelDistance(a, b string) int {
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
		dp[i][0] = i
	}
	for j := 0; j <= m; j++ {
		dp[0][j] = j
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1]
			} else if dp[i-1][j] < dp[i][j-1] {
				dp[i][j] = dp[i-1][j] + 1
			} else {
				dp[i][j] = dp[i][j-1] + 1
			}
		}
	}
	return dp[n][m]
}

func main() {
	a, b := "AGCAT", "GAC"
	L := lcsLen(a, b)
	fmt.Println("LCS =", L, "indel =", indelDistance(a, b), "formula =", len(a)+len(b)-2*L)
}
```

**Java.**
```java
public class LcsVsEdit {
    static int lcs(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                dp[i][j] = a.charAt(i - 1) == b.charAt(j - 1)
                        ? dp[i - 1][j - 1] + 1
                        : Math.max(dp[i - 1][j], dp[i][j - 1]);
        return dp[n][m];
    }

    static int indel(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) dp[i][0] = i;
        for (int j = 0; j <= m; j++) dp[0][j] = j;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                dp[i][j] = a.charAt(i - 1) == b.charAt(j - 1)
                        ? dp[i - 1][j - 1]
                        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1]);
        return dp[n][m];
    }

    public static void main(String[] args) {
        String a = "AGCAT", b = "GAC";
        int L = lcs(a, b);
        System.out.println("LCS = " + L + " indel = " + indel(a, b)
                + " formula = " + (a.length() + b.length() - 2 * L));
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Edit distance is the min inserts/deletes/subs to turn A into B; it's an `O(nm)` DP, and it's secretly a shortest path in a grid."*
- Immediately flag the two gotchas: **traceback needs the full table** and **swaps cost 2 unless you use Damerau**.
- If asked about scale, say **filter-then-verify**: an index (BK-tree / Levenshtein automaton / SymSpell) for candidates, banded DP to verify.
- For small distances mention **banding/Ukkonen `O(nd)`**; for the fastest kernel mention **Myers `O(nm/w)`**; for memory mention **Hirschberg `O(min(n,m))`**.
- Know the **LCS contrast** (`n+m−2·LCS`) and the **SETH** quadratic lower bound — they signal depth.
- Always offer to validate optimizations against the plain `O(nm)` DP on small inputs.
