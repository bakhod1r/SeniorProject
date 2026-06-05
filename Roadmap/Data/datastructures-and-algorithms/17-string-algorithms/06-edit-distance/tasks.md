# Edit Distance — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise I/O spec, constraints, hints, and starter code in all three languages.
> **Always validate your optimized solutions (banded, Myers, Hirschberg, fuzzy index) against the plain `O(nm)` DP on small inputs before trusting them.**

---

## Beginner Tasks (5)

### Task 1 — Plain edit distance (number only)

**Problem.** Compute the Levenshtein distance between two strings `A` and `B` using the full `O(nm)` DP table. Insert, delete, and substitute each cost 1.

**Input / Output spec.**
- Read line 1 = `A`, line 2 = `B`.
- Print a single integer: the edit distance.

**Constraints.** `0 ≤ |A|, |B| ≤ 2000`. ASCII input.

**Hint.** Base cases `dp[i][0]=i`, `dp[0][j]=j`. Match is the free diagonal move; otherwise `1 + min(diag, up, left)`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func editDistance(a, b string) int {
	// TODO: fill the (n+1)x(m+1) DP table, return dp[n][m]
	return 0
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Scan()
	a := sc.Text()
	sc.Scan()
	b := sc.Text()
	fmt.Println(editDistance(a, b))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int editDistance(String a, String b) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String a = sc.hasNextLine() ? sc.nextLine() : "";
        String b = sc.hasNextLine() ? sc.nextLine() : "";
        System.out.println(editDistance(a, b));
    }
}
```

**Starter — Python.**
```python
import sys


def edit_distance(a, b):
    # TODO
    return 0


def main():
    data = sys.stdin.read().split("\n")
    a = data[0] if len(data) > 0 else ""
    b = data[1] if len(data) > 1 else ""
    print(edit_distance(a, b))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `("kitten","sitting") → 3`, `("","abc") → 3`, `("abc","abc") → 0`.
- Correct base cases.
- `O(nm)` time.

---

### Task 2 — Two-row memory optimization

**Problem.** Compute the edit distance using only two rows (`O(min(n,m))` space). Output the number only (no alignment).

**Input / Output spec.** Same as Task 1.

**Constraints.** `0 ≤ |A|, |B| ≤ 100000` (so the full table would be too big).

**Hint.** Swap so the shorter string indexes the row. Keep `prev` and `cur` rows; `cur[0] = i`.

**Evaluation criteria.**
- Matches Task 1 for small inputs.
- Uses `O(min(n,m))` extra space (verify it does not allocate the full table).
- Handles `|A|·|B|` that would overflow a 2D array.

---

### Task 3 — Reconstruct the alignment

**Problem.** Print the distance and the two aligned strings (with `-` for gaps) recovered by traceback.

**Input / Output spec.**
- Read `A` and `B`.
- Print the distance, then the aligned `A`, then the aligned `B`.

**Constraints.** `0 ≤ |A|, |B| ≤ 1000`.

**Hint.** Fill the full table, then walk back from `(n,m)`: diagonal = match/sub, up = delete (gap in B), left = insert (gap in A). Reverse at the end.

**Worked check.** For `("kitten","sitting")`, one valid alignment is:
```
kitten-
sitting   (2 subs + 1 insert = distance 3)
```

**Evaluation criteria.**
- Aligned rows have equal length and no `(-, -)` column.
- The number of mismatched/gap columns equals the distance.
- Matches a hand alignment on small inputs.

---

### Task 4 — One edit away

**Problem.** Given two strings, output `true` if they are at most one edit apart, `false` otherwise — in `O(n)` without a DP table.

**Input / Output spec.** Read `A` and `B`; print `true` or `false`.

**Constraints.** `0 ≤ |A|, |B| ≤ 100000`.

**Hint.** If `||A|−|B|| > 1` it's false. Walk both; on the first mismatch, advance both if lengths are equal (sub) or only the longer (indel); a second mismatch fails.

**Evaluation criteria.**
- `("pale","ple")→true`, `("pales","pale")→true`, `("pale","bake")→false`, `("abc","abc")→true`.
- `O(n)` time, `O(1)` extra space.

---

### Task 5 — Hamming vs edit distance

**Problem.** Given two equal-length strings, print both the Hamming distance (count of mismatched positions) and the Levenshtein distance. Demonstrate when they differ.

**Input / Output spec.** Read `A` and `B` (equal length guaranteed for Hamming); print `hamming edit`.

**Constraints.** `|A| = |B| ≤ 5000`.

**Hint.** Hamming is a single `O(n)` loop counting `A[i] != B[i]`. Levenshtein is the `O(nm)` DP. For a cyclic shift like `("abcd","dabc")` they differ a lot.

**Evaluation criteria.**
- For `("abcd","abce")`: hamming 1, edit 1.
- For `("abcd","dabc")`: hamming 4, edit 2 (one delete + one insert).
- Correct explanation that Hamming forbids indels.

---

## Intermediate Tasks (5)

### Task 6 — Banded distance check (`≤ k`)

**Problem.** Given `A`, `B`, and `k`, output the edit distance if it is `≤ k`, else output `-1`. Fill only the diagonal band `|i−j| ≤ k`; reject early if `||A|−|B|| > k`.

**Input / Output spec.** Read `A`, `B`, then integer `k` on the third line; print the distance or `-1`.

**Constraints.** `0 ≤ |A|, |B| ≤ 10^6`, `0 ≤ k ≤ 100`.

**Hint.** Band width is `2k+1`. Use `INF = k+1` outside the band. Validate against the full DP for small inputs.

**Reference oracle (Python).**
```python
def full_edit(a, b):
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
    return dp[n][m]
```

**Evaluation criteria.**
- Returns `-1` exactly when the true distance exceeds `k`.
- Matches `full_edit` (capped at `k`) on small inputs.
- `O(kn)` time; works for million-char strings when `k` is small.

---

### Task 7 — Damerau-Levenshtein (OSA) with transpositions

**Problem.** Compute the Optimal String Alignment (restricted Damerau) distance, where an adjacent transposition costs 1.

**Input / Output spec.** Read `A` and `B`; print the OSA distance.

**Constraints.** `0 ≤ |A|, |B| ≤ 2000`.

**Hint.** Add the case `dp[i-2][j-2]+1` when `i,j ≥ 2`, `A[i-1]=B[j-2]`, `A[i-2]=B[j-1]`.

**Evaluation criteria.**
- `("teh","the") → 1` (transposition), whereas plain Levenshtein gives 2.
- `("ca","abc") → 3` (OSA cannot re-edit the transposed pair) — note the difference from true DL.
- Matches plain Levenshtein when no transpositions help.

---

### Task 8 — Needleman-Wunsch global alignment

**Problem.** Given two strings and scores `(match, mismatch, gap)`, compute the optimal global alignment score and print the alignment.

**Input / Output spec.** Read `A`, `B`, then three integers `match mismatch gap`; print the score and the two aligned rows.

**Constraints.** `0 ≤ |A|, |B| ≤ 1000`.

**Hint.** `max` instead of `min`; `H[i][0]=i*gap`, `H[0][j]=j*gap`. Traceback prefers the move achieving the max.

**Evaluation criteria.**
- With `match=0, mismatch=-1, gap=-1`, `|score|` equals the Levenshtein distance.
- Aligned rows are consistent (equal length, no `(-,-)`).
- Handles negative scores correctly.

---

### Task 9 — Smith-Waterman local alignment

**Problem.** Given two strings and scores, find the best *local* alignment score (best matching region) and print the aligned segment pair.

**Input / Output spec.** Read `A`, `B`, then `match mismatch gap`; print the best score and the two aligned segments.

**Constraints.** `0 ≤ |A|, |B| ≤ 1000`.

**Hint.** Clamp each cell at `0`; the answer is the maximum cell anywhere; traceback starts there and stops at the first `0`.

**Evaluation criteria.**
- Finds the highest-scoring substring pair, ignoring poorly-matching flanks.
- A zero matrix (all-negative) yields an empty alignment with score 0.
- Matches a brute-force over all substring pairs for tiny inputs.

---

### Task 10 — Approximate substring matching (pattern in text within k)

**Problem.** Given a pattern `P` and text `T` and budget `k`, output all end positions `j` in `T` where `P` occurs with at most `k` edits.

**Input / Output spec.** Read `P`, `T`, then integer `k`; print the matching end positions (1-based), space-separated.

**Constraints.** `1 ≤ |P| ≤ 1000`, `1 ≤ |T| ≤ 10^6`, `0 ≤ k ≤ 50`.

**Hint.** Set the top row to all zeros (`dp[0][j]=0`) so the pattern may start anywhere; report every column `j` with `dp[|P|][j] ≤ k`. Band for `O(k|T|)`.

**Reference oracle (Python).**
```python
def approx_match_brute(p, t, k):
    m = len(p)
    ends = []
    for j in range(1, len(t) + 1):
        # try every start; report if some window within k
        best = min(full_edit(p, t[s:j]) for s in range(0, j)) if j else m
        if best <= k:
            ends.append(j)
    return ends  # slow oracle; relies on full_edit from Task 6
```

**Evaluation criteria.**
- Reports all and only positions where `P` fits within `k` edits.
- Matches the slow oracle for small inputs.
- Banded version is `O(k|T|)`.

---

## Advanced Tasks (5)

### Task 11 — Hirschberg linear-space alignment

**Problem.** Produce the full optimal alignment of two strings in `O(min(n,m))` space using Hirschberg's divide-and-conquer.

**Input / Output spec.** Read `A` and `B`; print the distance and the two aligned rows.

**Constraints.** `0 ≤ |A|, |B| ≤ 50000` (so the full `O(nm)` table is infeasible in memory).

**Hint.** Forward two-row DP gives `L[j]` for the top half; backward two-row DP gives `R[j]` for the bottom half; split at the column `j*` minimizing `L[j]+R[j]`; recurse on the two rectangles. Handle base cases (one string empty or length 1).

**Evaluation criteria.**
- Same distance and a valid alignment as the full DP on small inputs.
- Verified `O(min(n,m))` space (no full table allocated).
- Correct handling of recursion base cases.

---

### Task 12 — Myers bit-parallel edit distance

**Problem.** Implement Myers' bit-vector edit distance for a pattern of length `≤ 64` against a text, returning the distance between the two strings.

**Input / Output spec.** Read `A` (text) and `B` (pattern, `|B| ≤ 64`); print the edit distance.

**Constraints.** `0 ≤ |A| ≤ 10^6`, `1 ≤ |B| ≤ 64`.

**Hint.** Precompute `Eq[ch]` = bitmask of positions in `B` equal to `ch`. Maintain `Pv`, `Mv`, and a running score; each text char does the AND/OR/XOR/`+`/shift update. Mask to `|B|` bits.

**Evaluation criteria.**
- Matches the plain `O(nm)` DP on thousands of random pairs (differential test).
- Handles `|B|=64` exactly (boundary of the word).
- `O(|A|)` time for `|B| ≤ 64`.

---

### Task 13 — Gotoh affine-gap alignment

**Problem.** Compute the optimal global alignment under affine gap penalties: a gap of length `L` costs `gap_open + L·gap_extend`. Print the score and the alignment.

**Input / Output spec.** Read `A`, `B`, then `match mismatch gap_open gap_extend`; print the score and aligned rows.

**Constraints.** `0 ≤ |A|, |B| ≤ 1000`.

**Hint.** Three DP layers `M`, `X` (gap in B), `Y` (gap in A). `X[i][j] = max(M[i-1][j] - (open+extend), X[i-1][j] - extend)`; symmetric for `Y`; answer is `max(M,X,Y)` at the corner. Traceback must track which layer you are in.

**Evaluation criteria.**
- A long contiguous gap costs less than the same number of scattered gaps (vs flat-gap NW).
- Score matches a brute-force over all alignments for tiny inputs.
- Correct layer-aware traceback.

---

### Task 14 — BK-tree fuzzy dictionary

**Problem.** Build a BK-tree over a word list, then answer queries "all words within `k` of `q`". Use the triangle inequality to prune.

**Input / Output spec.** Read `N` words, then `Q` queries each `q k`; for each, print the matching words sorted by distance then lexicographically.

**Constraints.** `1 ≤ N ≤ 10^5`, `1 ≤ Q ≤ 10^4`, `0 ≤ k ≤ 3`.

**Hint.** Insert by descending child-edges labeled by integer distance. Search descends only edges in `[d−k, d+k]`. Use unit Levenshtein (a true metric).

**Evaluation criteria.**
- Returns exactly the brute-force within-`k` set for each query (recall = 100%).
- Visits far fewer than `N` nodes for small `k` (instrument node visits).
- Correct pruning window `[d−k, d+k]`.

---

### Task 15 — SymSpell deletion index (k = 2)

**Problem.** Build a SymSpell-style deletion index for `k ≤ 2` and answer fuzzy lookups via hash lookups plus verification.

**Input / Output spec.** Read `N` dictionary words, then `Q` queries; for each query print all dictionary words within edit distance 2, sorted by distance.

**Constraints.** `1 ≤ N ≤ 10^5`, `1 ≤ Q ≤ 10^4`, word length `≤ 20`.

**Hint.** Offline: for each word, generate all strings reachable by deleting up to 2 characters; map each variant → originals. Query: generate the query's delete-2 variants, union the mapped originals, then verify each candidate with a real edit-distance computation (`≤ 2`).

**Evaluation criteria.**
- 100% recall versus a brute-force within-2 scan.
- Lookup uses only hash hits + verification (no scan of the whole dictionary).
- Documents the memory/speed trade-off versus the BK-tree.

---

## Extension Tasks (4)

These four extend the core set into related variants and the production fuzzy-search prefilter. Difficulty is noted per task.

### Task 16 — Indel distance via LCS *(Intermediate)*

**Problem.** Compute the *indel distance* (insertions and deletions only, no substitutions) using the relation `d_id(A,B) = |A| + |B| − 2·LCS(A,B)`. Output the indel distance and the LCS length.

**Input / Output spec.** Read `A` and `B`; print `indel_distance lcs_length`.

**Constraints.** `0 ≤ |A|, |B| ≤ 3000`.

**Hint.** Compute `LCS` with the standard `O(nm)` DP (`dp[i][j] = dp[i-1][j-1]+1` on match, else `max(dp[i-1][j], dp[i][j-1])`). Then `d_id = n + m − 2·LCS`. This is strictly `≥` the Levenshtein distance, since a substitution can replace a delete+insert pair (see `professional.md` §11).

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func lcs(a, b string) int {
	n, m := len(a), len(b)
	prev := make([]int, m+1)
	for i := 1; i <= n; i++ {
		cur := make([]int, m+1)
		for j := 1; j <= m; j++ {
			if a[i-1] == b[j-1] {
				cur[j] = prev[j-1] + 1
			} else if prev[j] >= cur[j-1] {
				cur[j] = prev[j]
			} else {
				cur[j] = cur[j-1]
			}
		}
		prev = cur
	}
	return prev[m]
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Scan()
	a := sc.Text()
	sc.Scan()
	b := sc.Text()
	l := lcs(a, b)
	fmt.Println(len(a)+len(b)-2*l, l)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task16 {
    static int lcs(String a, String b) {
        int n = a.length(), m = b.length();
        int[] prev = new int[m + 1];
        for (int i = 1; i <= n; i++) {
            int[] cur = new int[m + 1];
            for (int j = 1; j <= m; j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1))
                    cur[j] = prev[j - 1] + 1;
                else
                    cur[j] = Math.max(prev[j], cur[j - 1]);
            }
            prev = cur;
        }
        return prev[m];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String a = sc.hasNextLine() ? sc.nextLine() : "";
        String b = sc.hasNextLine() ? sc.nextLine() : "";
        int l = lcs(a, b);
        System.out.println((a.length() + b.length() - 2 * l) + " " + l);
    }
}
```

**Starter — Python.**
```python
import sys


def lcs(a, b):
    n, m = len(a), len(b)
    prev = [0] * (m + 1)
    for i in range(1, n + 1):
        cur = [0] * (m + 1)
        ai = a[i - 1]
        for j in range(1, m + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1] + 1
            else:
                cur[j] = prev[j] if prev[j] >= cur[j - 1] else cur[j - 1]
        prev = cur
    return prev[m]


def main():
    data = sys.stdin.read().split("\n")
    a = data[0] if len(data) > 0 else ""
    b = data[1] if len(data) > 1 else ""
    l = lcs(a, b)
    print(len(a) + len(b) - 2 * l, l)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `("AGCAT","GAC") → indel 4, lcs 2` (see `professional.md` Example 11.3).
- `("abc","abc") → indel 0, lcs 3`.
- Indel distance is always `≥` the Levenshtein distance from Task 1.

---

### Task 17 — q-gram prefilter for fuzzy search *(Intermediate)*

**Problem.** Build a `q`-gram (length-`q` substring) inverted index over a word list, and for each query return only words sharing at least `T` common `q`-grams with the query — a *necessary condition* for small edit distance — then verify with the banded DP. This is the prefilter behind `pg_trgm` and many search engines.

**Input / Output spec.** Read integers `q` and `k`, then `N` dictionary words, then `Q` queries; for each query print the words within edit distance `k`, sorted by distance then lexicographically.

**Constraints.** `1 ≤ N ≤ 10^5`, `1 ≤ Q ≤ 10^4`, `2 ≤ q ≤ 3`, `0 ≤ k ≤ 2`.

**Hint.** A word of length `L` has `L − q + 1` positional `q`-grams. If `d(A,B) ≤ k`, then `A` and `B` share at least `max(|A|,|B|) − q + 1 − q·k` common `q`-grams (each edit destroys at most `q` `q`-grams). Use that bound as the threshold `T`, union the candidate words from the postings of the query's `q`-grams, then verify each with the banded distance from Task 6. Pad words with a sentinel so short words still produce `q`-grams.

**Evaluation criteria.**
- 100% recall versus a brute-force within-`k` scan (the `q`-gram bound must never exclude a true match).
- Candidate set is far smaller than `N` for typical queries (instrument the count).
- Correct threshold `T = max(|A|,|B|) − q + 1 − q·k` (a too-high `T` drops valid matches).

---

### Task 18 — Weighted edit distance with a cost table *(Intermediate)*

**Problem.** Compute edit distance under arbitrary per-operation costs: `cost_ins(c)`, `cost_del(c)`, and `cost_sub(x,y)` (with `cost_sub(x,x)=0`). Output the minimum total cost.

**Input / Output spec.** Read `A`, `B`, then a line `ins del` (uniform insert/delete costs) and a line `sub` (uniform substitution cost). Print the minimum weighted cost as an integer.

**Constraints.** `0 ≤ |A|, |B| ≤ 2000`. `0 ≤ ins, del, sub ≤ 100`.

**Hint.** The recurrence carries the costs: `dp[i][j] = min(dp[i-1][j-1] + (A[i-1]==B[j-1] ? 0 : sub), dp[i-1][j] + del, dp[i][j-1] + ins)`. Base cases `dp[i][0] = i·del`, `dp[0][j] = j·ins`. Note this is **not** a metric when `ins ≠ del` (see `professional.md` §9, Example 9.3) — so it must not be used to build a BK-tree.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func weighted(a, b string, ins, del, sub int) int {
	n, m := len(a), len(b)
	prev := make([]int, m+1)
	for j := 0; j <= m; j++ {
		prev[j] = j * ins
	}
	for i := 1; i <= n; i++ {
		cur := make([]int, m+1)
		cur[0] = i * del
		for j := 1; j <= m; j++ {
			s := sub
			if a[i-1] == b[j-1] {
				s = 0
			}
			cur[j] = min3(prev[j-1]+s, prev[j]+del, cur[j-1]+ins)
		}
		prev = cur
	}
	return prev[m]
}

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

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Scan()
	a := sc.Text()
	sc.Scan()
	b := sc.Text()
	sc.Scan()
	insDel := sc.Text()
	sc.Scan()
	subLine := sc.Text()
	var ins, del, sub int
	fmt.Sscan(insDel, &ins, &del)
	fmt.Sscan(subLine, &sub)
	fmt.Println(weighted(a, b, ins, del, sub))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task18 {
    static int weighted(String a, String b, int ins, int del, int sub) {
        int n = a.length(), m = b.length();
        int[] prev = new int[m + 1];
        for (int j = 0; j <= m; j++) prev[j] = j * ins;
        for (int i = 1; i <= n; i++) {
            int[] cur = new int[m + 1];
            cur[0] = i * del;
            for (int j = 1; j <= m; j++) {
                int s = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : sub;
                cur[j] = Math.min(prev[j - 1] + s, Math.min(prev[j] + del, cur[j - 1] + ins));
            }
            prev = cur;
        }
        return prev[m];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String a = sc.hasNextLine() ? sc.nextLine() : "";
        String b = sc.hasNextLine() ? sc.nextLine() : "";
        int ins = sc.nextInt(), del = sc.nextInt(), sub = sc.nextInt();
        System.out.println(weighted(a, b, ins, del, sub));
    }
}
```

**Starter — Python.**
```python
import sys


def weighted(a, b, ins, dele, sub):
    n, m = len(a), len(b)
    prev = [j * ins for j in range(m + 1)]
    for i in range(1, n + 1):
        cur = [i * dele] + [0] * m
        ai = a[i - 1]
        for j in range(1, m + 1):
            s = 0 if ai == b[j - 1] else sub
            cur[j] = min(prev[j - 1] + s, prev[j] + dele, cur[j - 1] + ins)
        prev = cur
    return prev[m]


def main():
    data = sys.stdin.read().split("\n")
    a = data[0] if len(data) > 0 else ""
    b = data[1] if len(data) > 1 else ""
    ins, dele = map(int, data[2].split())
    sub = int(data[3])
    print(weighted(a, b, ins, dele, sub))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- With `ins=del=sub=1` the result equals the plain Levenshtein distance from Task 1.
- With `del=3, ins=1`: `d("a","") = 3` but `d("","a") = 1` — asymmetry observed (not a metric).
- Base cases scale by the per-op costs (`dp[i][0] = i·del`).

---

### Task 19 — Banded Myers approximate search *(Advanced)*

**Problem.** Combine bit-parallel Myers with the "top row = 0" approximate-matching trick: slide a pattern `P` (`|P| ≤ 64`) across a text `T` and report every end position where `P` matches within `k` edits, using one machine-word column per text character. This is the production fuzzy-substring kernel.

**Input / Output spec.** Read `P`, `T`, then integer `k`; print the matching end positions (1-based), space-separated.

**Constraints.** `1 ≤ |P| ≤ 64`, `1 ≤ |T| ≤ 10^7`, `0 ≤ k ≤ 60`.

**Hint.** Initialize `Pv = (1<<m)-1`, `Mv = 0`, `score = m`. For approximate *search* (not global distance), do **not** add a horizontal boundary cost per column — the pattern may start anywhere. After processing each text char, the maintained `score` is `min_s d(P, T[s..j])`; report `j` whenever `score ≤ k`. Validate against the banded DP from Task 10 (which solves the same problem at `O(k|T|)`).

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func myersSearch(p, t string, k int) []int {
	m := len(p)
	if m == 0 || m > 64 {
		return nil
	}
	var peq [256]uint64
	for i := 0; i < m; i++ {
		peq[p[i]] |= 1 << uint(i)
	}
	var pv uint64 = (1 << uint(m)) - 1
	var mv uint64 = 0
	score := m
	last := uint64(1) << uint(m-1)
	var out []int
	for j := 0; j < len(t); j++ {
		eq := peq[t[j]]
		xv := eq | mv
		xh := (((eq & pv) + pv) ^ pv) | eq
		ph := mv | ^(xh | pv)
		mh := pv & xh
		if ph&last != 0 {
			score++
		} else if mh&last != 0 {
			score--
		}
		ph = (ph << 1)
		mh = (mh << 1)
		pv = mh | ^(xv | ph)
		mv = ph & xv
		if score <= k {
			out = append(out, j+1)
		}
	}
	return out
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<26)
	sc.Scan()
	p := sc.Text()
	sc.Scan()
	tt := sc.Text()
	sc.Scan()
	var k int
	fmt.Sscan(sc.Text(), &k)
	for _, pos := range myersSearch(p, tt, k) {
		fmt.Printf("%d ", pos)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task19 {
    static List<Integer> myersSearch(String p, String t, int k) {
        int m = p.length();
        List<Integer> out = new ArrayList<>();
        if (m == 0 || m > 64) return out;
        long[] peq = new long[256];
        for (int i = 0; i < m; i++) peq[p.charAt(i) & 0xFF] |= 1L << i;
        long pv = (m == 64) ? -1L : (1L << m) - 1;
        long mv = 0;
        int score = m;
        long last = 1L << (m - 1);
        for (int j = 0; j < t.length(); j++) {
            long eq = peq[t.charAt(j) & 0xFF];
            long xv = eq | mv;
            long xh = (((eq & pv) + pv) ^ pv) | eq;
            long ph = mv | ~(xh | pv);
            long mh = pv & xh;
            if ((ph & last) != 0) score++;
            else if ((mh & last) != 0) score--;
            ph <<= 1;
            mh <<= 1;
            pv = mh | ~(xv | ph);
            mv = ph & xv;
            if (score <= k) out.add(j + 1);
        }
        return out;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String p = sc.nextLine();
        String t = sc.nextLine();
        int k = Integer.parseInt(sc.nextLine().trim());
        StringBuilder sb = new StringBuilder();
        for (int pos : myersSearch(p, t, k)) sb.append(pos).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

**Starter — Python.**
```python
import sys


def myers_search(p, t, k):
    m = len(p)
    if m == 0 or m > 64:
        return []
    peq = {}
    for i, ch in enumerate(p):
        peq[ch] = peq.get(ch, 0) | (1 << i)
    MASK = (1 << m) - 1
    pv = MASK
    mv = 0
    score = m
    last = 1 << (m - 1)
    out = []
    for j, ch in enumerate(t):
        eq = peq.get(ch, 0)
        xv = eq | mv
        xh = (((eq & pv) + pv) ^ pv) | eq
        ph = (mv | ~(xh | pv)) & MASK
        mh = pv & xh
        if ph & last:
            score += 1
        elif mh & last:
            score -= 1
        ph = (ph << 1) & MASK
        mh = (mh << 1) & MASK
        pv = (mh | ~(xv | ph)) & MASK
        mv = ph & xv
        if score <= k:
            out.append(j + 1)
    return out


def main():
    data = sys.stdin.read().split("\n")
    p = data[0] if len(data) > 0 else ""
    t = data[1] if len(data) > 1 else ""
    k = int(data[2]) if len(data) > 2 and data[2].strip() else 0
    print(" ".join(map(str, myers_search(p, t, k))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- For `P="ana", T="banana", k=1` reports the same end positions as the banded DP in Task 10.
- Matches the Task 10 banded oracle on thousands of random `(P, T, k)` triples (differential test).
- `O(|T|)` time for `|P| ≤ 64` regardless of `k`; handles `|P| = 64` (the word boundary) correctly.

---

## Benchmark Task

### Task B — Full DP vs banded vs Myers crossover

**Problem.** Empirically compare three edit-distance implementations on controlled inputs:

- **(a) Full `O(nm)` DP** (two-row, number only).
- **(b) Banded `O(kn)`** with a known small `k`.
- **(c) Myers bit-parallel `O(nm/w)`** (pattern `≤ 64`).

Generate pairs at varying similarity: (i) near-identical (small true distance), (ii) random (large distance). Measure wall-clock time for `|A|=|B| ∈ {1000, 10^4, 10^5}` and report a table; identify when banding wins and when it does not help.

**Starter — Python.**
```python
import random
import time


def gen_pair(n, distance, seed):
    r = random.Random(seed)
    a = "".join(r.choice("ACGT") for _ in range(n))
    b = list(a)
    for _ in range(distance):
        i = r.randrange(n)
        b[i] = r.choice("ACGT")
    return a, "".join(b)


def full_two_row(a, b):
    # TODO: O(nm) two-row distance
    return 0


def banded(a, b, k):
    # TODO: O(kn) banded distance, -1 if > k
    return 0


def myers(a, b):
    # TODO: O(nm/w) for |b| <= 64
    return 0


def bench(fn, *args, repeat=3):
    best = float("inf")
    for _ in range(repeat):
        s = time.perf_counter()
        fn(*args)
        best = min(best, time.perf_counter() - s)
    return best * 1000.0


def main():
    print("n        sim   full_ms   banded_ms   myers_ms")
    for n in (1000, 10_000, 100_000):
        for sim, dist in (("near", 5), ("far", n // 2)):
            a, b = gen_pair(n, dist, 42)
            # full and myers run on full strings; banded only meaningful for near
            print(n, sim, "...")  # fill with timings


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces identical pairs across Go, Java, and Python.
- Banded (b) dramatically beats full (a) for near-identical inputs and offers little for random inputs (where `k` is large).
- Myers (c) beats full (a) by a large constant factor when the pattern fits in a word.
- Report the mean over ≥ 3 runs; do not time input generation.
- Writeup: note the measured crossover and tie it to the theory (banding helps iff `d ≪ n`; Myers is a `~w×` constant-factor win, not asymptotic).

---

## General Guidance for All Tasks

- **Validate against the plain `O(nm)` DP first.** Every optimized variant (banded, Myers, Hirschberg, fuzzy index) must agree with the textbook DP on small inputs before you trust it on large ones.
- **Get the base cases right.** `dp[i][0]=i`, `dp[0][j]=j`. For approximate matching set the top row to `0`. For min-plus-style banding use `INF = k+1`.
- **Count edits, not vertices/indices.** The table is 1-indexed over prefix lengths; character `i` is `A[i-1]`.
- **Mind the metric vs non-metric distinction.** Use unit Levenshtein (or true Damerau) — not OSA — when building a BK-tree, since BK-trees require the triangle inequality.
- **Use the shorter string as the inner dimension** to minimize memory in two-row/banded variants.
- **Normalize text** (case-fold, Unicode NFC) consistently across index and query for fuzzy tasks.
- **Reject early** on a length gap (`||A|−|B|| > k`) and strip common prefix/suffix before banding.

Each task must be implemented and tested in **Go, Java, and Python**, producing identical outputs across all three on the same inputs.
