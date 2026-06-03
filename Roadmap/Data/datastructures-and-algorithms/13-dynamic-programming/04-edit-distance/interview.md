# Edit Distance (Levenshtein) and String Alignment — Interview Preparation

Edit distance is a favourite interview topic because it rewards one crisp insight — *"`dp[i][j]` is the edit distance between the first `i` characters of `A` and the first `j` characters of `B`"* — and then tests whether you can (a) write the four-case recurrence and base cases without bugs, (b) reduce memory to two rows, (c) recover the actual edit script by traceback, and (d) recognize the variants (Damerau transpositions, weighted costs, banded threshold, Hirschberg, the Needleman-Wunsch/Smith-Waterman connection). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Edit distance of `A`, `B` | full DP table, read `dp[n][m]` | `O(nm)` time, `O(nm)` space |
| Distance only, low memory | two-row rolling DP | `O(nm)` time, `O(min(n,m))` space |
| Recover the edit script | traceback / back-pointers | `O(n+m)` after the fill |
| Distance + script, low memory | Hirschberg divide-and-conquer | `O(nm)` time, `O(min(n,m))` space |
| "Is distance ≤ k?" | banded (Ukkonen) DP | `O(k·min(n,m))` time |
| Exact distance, small `d` | Ukkonen / Myers `O(nd)` | `O(nd)` |
| Adjacent swaps count as 1 | Damerau-Levenshtein (OSA) | `O(nm)` |
| Weighted / keyboard costs | cost functions in the `min` | `O(nm)` |
| Biological alignment | Needleman-Wunsch (global) / Smith-Waterman (local) | `O(nm)` |

Core recurrence:

```text
dp[0][j] = j ; dp[i][0] = i
if A[i-1] == B[j-1]:
    dp[i][j] = dp[i-1][j-1]                                  # match, free
else:
    dp[i][j] = 1 + min(dp[i-1][j-1],  # substitute
                       dp[i-1][j],    # delete from A
                       dp[i][j-1])    # insert into A
answer = dp[n][m]
```

Key facts:
- **Length means characters**; `dp[i][j]` compares `A[i-1]` and `B[j-1]` (off-by-one!).
- Base cases: empty-to-`B` costs `m` inserts; `A`-to-empty costs `n` deletes.
- Levenshtein is a **metric** (triangle inequality holds) — unit costs only.
- `||A|−|B|| ≤ d ≤ max(|A|,|B|)`. Use the lower bound to pre-screen.
- Damerau adds one transposition case; OSA is the simple `O(nm)` variant.

---

## Junior Questions (12 Q&A)

### J1. What does `dp[i][j]` represent?
The edit distance between the first `i` characters of `A` and the first `j` characters of `B`. The final answer is `dp[n][m]`, the bottom-right cell. The `+1` in each table dimension lets us represent empty prefixes (`i = 0` or `j = 0`).

### J2. What are the three edit operations in Levenshtein distance?
Insert one character, delete one character, and substitute one character for another — each costing `1`. A match (characters already equal) costs `0`.

### J3. What are the base cases?
`dp[0][j] = j` (insert all `j` characters of `B` into an empty string), `dp[i][0] = i` (delete all `i` characters of `A`), and `dp[0][0] = 0`.

### J4. Write the recurrence for an interior cell.
If `A[i-1] == B[j-1]`, then `dp[i][j] = dp[i-1][j-1]` (free match). Otherwise `dp[i][j] = 1 + min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1])` — substitute, delete, insert respectively.

### J5. Why is the diagonal neighbor a substitution (or match)?
`dp[i-1][j-1]` is the cost of aligning the prefixes without the last characters. If those last characters match, no extra cost; if they differ, one substitution lines them up. Either way it is a diagonal step.

### J6. Which neighbor is a delete and which is an insert?
`dp[i-1][j]` (the cell directly above) is a delete from `A`. `dp[i][j-1]` (the cell to the left) is an insert into `A`. A handy mnemonic: up shrinks `A`, left grows `A` toward `B`.

### J7. What is the time and space complexity?
`O(nm)` time (each of the `(n+1)(m+1)` cells is `O(1)` work) and `O(nm)` space for the full table.

### J8. What is the edit distance between a string and itself?
Zero — every character matches along the diagonal, so the optimal path is all free matches.

### J9. What is the distance between `""` and a length-`m` string?
`m` — you must insert all `m` characters. This is exactly the base row.

### J10. Why does the table have size `(n+1) × (m+1)` instead of `n × m`?
The extra row and column represent the *empty* prefix of each string, which is where the base cases live and where the recurrence bottoms out.

### J11. Is edit distance symmetric? Is `d(A,B) == d(B,A)`?
Yes for unit-cost Levenshtein, because every operation has an equal-cost inverse (insert reverses delete, substitution reverses itself). The *distance* is symmetric; the *edit script* directions (insert vs delete) swap.

### J12 (analysis). Why is the naive recursion exponential and the DP polynomial?
The recursion recomputes the same `(i, j)` subproblem along exponentially many paths (overlapping subproblems). Memoizing the `(n+1)(m+1)` distinct subproblems — or filling them bottom-up — collapses the work to `O(nm)`.

---

## Middle Questions (12 Q&A)

### M1. Prove the recurrence is correct.
Induction on `i + j`. The optimal alignment's last column is a match/substitution (diagonal), a deletion (up), or an insertion (left). Removing that column leaves an optimal alignment of shorter prefixes (optimal substructure), whose cost is the corresponding DP neighbor. Taking the min over the three exhausts the cases.

### M2. How do you reduce the space to `O(min(n,m))`?
Each row depends only on the previous row and the current row's left neighbor, so keep just two rows (or one row plus a saved diagonal). Orient the shorter string as the columns. You get the distance but **lose the traceback**.

### M3. How do you recover the actual edit script?
Traceback from `dp[n][m]` to `dp[0][0]`: at each cell pick a predecessor consistent with how the value was computed (diagonal match/substitute, up delete, left insert), record the operation, then reverse the list. It is `O(n+m)`. You need the full table or stored back-pointers.

### M4. A user typed `teh` for `the`. Levenshtein says 2; that feels wrong. Fix it.
Use **Damerau-Levenshtein**: add an adjacent-transposition operation (cost 1). The OSA variant adds one recurrence case: if `A[i-1]==B[j-2]` and `A[i-2]==B[j-1]`, also consider `dp[i-2][j-2] + 1`. Now `teh → the` is distance 1.

### M5. How do you weight operations (e.g., keyboard-aware costs)?
Replace the constant `1`s with cost functions: `dp[i][j] = min(dp[i-1][j-1]+cost_sub(a,b), dp[i-1][j]+cost_del(a), dp[i][j-1]+cost_ins(b))`. Useful for OCR/keyboard typo models and bioinformatics substitution matrices.

### M6. What does the LCS (longest common subsequence) have to do with this?
LCS is edit distance with only insert and delete allowed (no substitution). Drop the substitute term and matches stay free. The `diff` notion of changes (no in-place edits) is the LCS model; Myers' diff is LCS-based.

### M7. How do you answer "is the distance ≤ k?" without filling the whole table?
Banded DP: only compute cells with `|i-j| ≤ k` (cells outside have value > k and cannot lie on a cheap path), and early-exit if a whole row's minimum exceeds `k`. This is `O(k·min(n,m))`.

### M8. Why can you pre-screen with the length difference?
Each operation changes the length by at most 1, so `d(A,B) ≥ ||A|−|B||`. If `||A|−|B|| > k`, the distance already exceeds `k` and you can reject without any DP.

### M9. What is the difference between OSA and true Damerau-Levenshtein?
OSA forbids editing any substring more than once, so it can overestimate (e.g., `CA → ABC` is 2 truly but OSA says 3). True Damerau-Levenshtein allows arbitrary edits between transposed characters and needs extra bookkeeping. OSA is the common, simpler, `O(nm)` choice.

### M10. How does Hirschberg get linear space *with* the alignment?
Divide-and-conquer: a forward rolling-row DP to the middle row and a backward one from the bottom; their sum is minimized at the column `j*` where the optimal alignment crosses the middle. Recurse on the two halves. `O(nm)` time, `O(min(n,m))` space.

### M11. Is the answer unique?
No. When predecessors tie in the traceback, multiple optimal edit scripts exist. Any minimum-cost script is correct; tie-break rules (e.g., prefer deletes first) make the output deterministic.

### M12 (analysis). What are the tight bounds on the distance?
`||A|−|B|| ≤ d(A,B) ≤ max(|A|,|B|)`. Lower bound from length change per operation; upper bound from substituting the overlap and inserting/deleting the rest.

---

## Senior Questions (10 Q&A)

### S1. You must align two 100k-character strings and also output the alignment. How?
Hirschberg's algorithm: `O(nm)` time but `O(min(n,m))` space, recovering the full alignment via the midpoint-split divide-and-conquer. The full `O(nm)` table would need ~40 GB and is infeasible.

### S2. How do you scale spell-check across a million-word dictionary?
Do not run DP against every word (`O(D·nm)`). Use indexing: a **fuzzy trie** that shares DP rows across common prefixes and prunes subtrees whose row exceeds `k`; **Levenshtein automata** (Lucene) for repeated queries; or **SymSpell** deletion indexes for very small `k`. Separate cheap candidate generation from exact banded verification.

### S3. When is a BK-tree appropriate, and what does it require?
A BK-tree indexes by exact distance and prunes children using the triangle inequality, so it requires the distance to be a true **metric**. Plain Levenshtein qualifies; arbitrary weighted costs may not. If your costs are asymmetric or super-additive, the BK-tree silently drops valid matches.

### S4. How does `git diff` avoid the `O(nm)` table?
It uses **Myers' O(nd) algorithm**, exploring the alignment grid along diagonals only as far as the actual number of differences `d` requires. For near-identical files (`d` small) this is far faster than quadratic. It is the LCS specialization of Ukkonen's `O(nd)`.

### S5. Explain the Needleman-Wunsch / Smith-Waterman connection.
Needleman-Wunsch is global sequence alignment — the edit-distance DP with a similarity scoring matrix and gap penalties (max instead of min). Smith-Waterman is *local* alignment: clamp negative cell scores to 0 and trace back from the maximum cell to find the best-matching substring. Both are the same DP with richer costs.

### S6. What are affine gap penalties and why do they need a different algorithm?
A run of gaps should cost "open + extend" (cheaper per character after the first), which the single recurrence cannot express because it must remember whether the previous column was a gap. **Gotoh's** algorithm uses three matrices (match-state, gap-in-A, gap-in-B) and stays `O(nm)`.

### S7. How do you verify an edit-distance implementation when inputs are large?
Apply the recovered edit script to `A` and assert it produces `B` (validates recurrence + traceback). Property-test symmetry, identity, the bounds `||A|−|B|| ≤ d ≤ max`, the triangle inequality (if indexing), and that banded equals full when `d ≤ k`. Compare against a brute recursive oracle on tiny strings.

### S8. Is there a subquadratic exact algorithm?
Not in general: Backurs-Indyk (2015) showed an `O(n^{2−δ})` exact algorithm would refute the **Strong Exponential Time Hypothesis (SETH)**. You can do better only for small distance (`O(nd)`), with constant-factor approximation in near-linear time, or with bit-parallelism (Myers' bit-vector, a `w`-fold speedup).

### S9. How do you handle Unicode correctly?
Normalize both strings identically (e.g., NFC) and compare code points (`[]rune` in Go; Python `str` is already code points), not UTF-8 bytes — otherwise an accented character counts as multiple edits and inconsistent normalization yields spurious distances.

### S10 (analysis). Why is banded DP correct for threshold queries?
Any cell on a path of total cost `≤ k` satisfies `|i−j| ≤ k` (since `dp[i][j] ≥ |i−j|`), so the optimal sub-`k` path never leaves the band. Cells outside the band have true value `> k` and are safely treated as `+∞`. Thus the band decides `d ≤ k` correctly; it does *not* give the exact distance when `d > k`.

---

## Professional Questions (8 Q&A)

### P1. Design a low-latency "did you mean?" service over a static dictionary.
Precompute a Levenshtein automaton per query+threshold (or a DAWG of the dictionary intersected with the automaton), or a SymSpell deletion index for `k ≤ 2`. Pipeline: cheap candidate generation (deletion variants / n-gram filter) → exact banded verification on survivors → rank by distance and frequency. Cap `k` to bound tail latency; normalize Unicode consistently.

### P2. The dictionary uses weighted, keyboard-aware costs. Can you still BK-tree index it?
Only if the weighted distance is a metric: symmetric (`w_ins=w_del`, `w_sub` symmetric), positive, and sub-additive (`w_sub(x,y) ≤ w_del(x)+w_ins(y)`). If any condition fails, the triangle inequality breaks and the BK-tree returns incomplete results — use trie/automaton search, which does not assume a metric.

### P3. Memory is blowing up aligning long sequences. Walk me through the fix.
If only the distance is needed → two-row DP (`O(min(n,m))` space). If the alignment is needed → Hirschberg (`O(min(n,m))` space, `O(nm)` time). If the distance is known to be small → banded (`O(k)` space) or Ukkonen `O(nd)`. For huge genomic databases, seed-and-extend (BLAST/minimap2) localizes where full DP runs.

### P4. How do you debug "the distance is right but the diff looks wrong"?
The distance and the script are computed separately; a wrong script with the right number means a traceback bug. Reconstruct: apply the script to `A` and check it yields `B`. Check tie-break consistency (delete-vs-insert order), and verify back-pointer directions match the recurrence neighbors.

### P5. When is min/max scored alignment (NW/SW) the wrong tool?
When you actually want a *metric* distance for indexing (scores are not distances), when the application needs unit-cost Levenshtein semantics, or when affine gaps are required but you used a single matrix (use Gotoh). Also, Smith-Waterman finds the best *local* region, not a global transformation — using it where you need end-to-end alignment is a modeling error.

### P6. How would you parallelize edit distance / a batch of fuzzy queries?
The DP has anti-diagonal parallelism: all cells on a given anti-diagonal `i+j = const` are independent and can be computed in parallel (wavefront). For a batch of queries against one dictionary, the queries are independent — shard across workers; the automaton/index is read-only and shareable. Bit-parallelism (Myers) packs the column into machine words for a within-cell speedup.

### P7. Explain how OCR or DNA substitution matrices plug into the same algorithm.
They are just the `cost_sub(c, c')` (or scoring `s(c,c')`) function: cheap for likely confusions (`0↔O`, similar amino acids), expensive for unlikely ones. The recurrence and its correctness are unchanged because the proof only uses additivity of costs, not unit costs.

### P8 (analysis). Why is `O(min(n,m))` space optimal for outputting an alignment?
An alignment has length `Θ(n+m)`, so merely writing it is `Ω(n+m)`. Hirschberg achieves `O(min(n,m))` working space plus the output, which is optimal up to the unavoidable output size. The distance alone needs only `O(min(n,m))` (two rows) — you cannot do better than storing one rolling row.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you optimized a quadratic algorithm under a memory or latency budget.
Look for a concrete story: a profile showing `O(nm)` memory or per-query DP dominating, the chosen fix (two-row, Hirschberg, banding, or an index), and a measured improvement, plus the verification (applying the script, comparing to the slow version) that kept it correct.

### B2. A teammate shipped a fuzzy-search that misses valid matches at distance 2. How do you handle it?
Likely a too-narrow band, a BK-tree over non-metric weighted costs, or an over-aggressive pre-screen. Reproduce against a brute linear scan with full DP on a small dictionary, identify the pruning that drops the match, and explain the metric requirement calmly — frame it as a teaching moment about the band-as-contract and metric assumptions.

### B3. Design a feature that suggests corrections as the user types.
Incremental edit distance: reuse the previous DP column when one character is appended (each new character extends the table by one column, `O(n)` work). Pair with a trie/automaton index for the dictionary, debounce keystrokes, cap `k`, and rank by distance + word frequency. Discuss Unicode normalization and latency budgets.

### B4. How would you explain edit distance to a junior engineer?
Start with the typo analogy: how many single-character keystrokes to fix `sitten` into `sitting`? Then the table: each cell asks "how far apart are these two prefixes?" and copies cheaply from three neighbors. Lead with the two gotchas: off-by-one between string and table indices, and that there can be more than one optimal edit script.

### B5. Your alignment job is OOM-killing on large inputs. How do you investigate?
Check whether you allocate the full `O(nm)` table (40 GB for two 100k strings) when you only need the distance — switch to two rows. If you need the alignment, switch to Hirschberg. Confirm you are not cloning the table per call; profile allocations. If the distance is small, band it.

---

## Coding Challenges

### Challenge 1: Levenshtein Distance (full DP)

**Problem.** Given strings `A` and `B`, return the minimum number of insert/delete/substitute operations to transform `A` into `B`.

**Example.**
```text
A = "kitten", B = "sitting"  ->  3
A = "horse",  B = "ros"      ->  3
A = "",       B = "abc"      ->  3
```

**Constraints.** `0 ≤ |A|, |B| ≤ 5000`.

**Optimal.** `O(nm)` DP (two-row form shown to save memory).

**Go.**
```go
package main

import "fmt"

func editDistance(a, b string) int {
	if len(a) < len(b) {
		a, b = b, a
	}
	m := len(b)
	prev := make([]int, m+1)
	for j := 0; j <= m; j++ {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur := make([]int, m+1)
		cur[0] = i
		for j := 1; j <= m; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, min(cur[j-1]+1, prev[j-1]+cost))
		}
		prev = cur
	}
	return prev[m]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println(editDistance("kitten", "sitting")) // 3
	fmt.Println(editDistance("horse", "ros"))      // 3
	fmt.Println(editDistance("", "abc"))           // 3
}
```

**Java.**
```java
public class Levenshtein {
    static int editDistance(String a, String b) {
        if (a.length() < b.length()) { String t = a; a = b; b = t; }
        int m = b.length();
        int[] prev = new int[m + 1];
        for (int j = 0; j <= m; j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            int[] cur = new int[m + 1];
            cur[0] = i;
            for (int j = 1; j <= m; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, Math.min(cur[j - 1] + 1, prev[j - 1] + cost));
            }
            prev = cur;
        }
        return prev[m];
    }

    public static void main(String[] args) {
        System.out.println(editDistance("kitten", "sitting")); // 3
        System.out.println(editDistance("horse", "ros"));      // 3
        System.out.println(editDistance("", "abc"));           // 3
    }
}
```

**Python.**
```python
def edit_distance(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    m = len(b)
    prev = list(range(m + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[m]


if __name__ == "__main__":
    print(edit_distance("kitten", "sitting"))  # 3
    print(edit_distance("horse", "ros"))       # 3
    print(edit_distance("", "abc"))            # 3
```

---

### Challenge 2: Recover the Edit Script

**Problem.** Given `A` and `B`, return the list of operations (match / substitute / delete / insert) that transforms `A` into `B` with minimum cost, in forward order.

**Example.**
```text
A = "horse", B = "ros"
  sub h->r, del o, sub r->o, match s, del e   (distance 3)
```

**Optimal.** Full DP `O(nm)`, then `O(n+m)` traceback.

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

func editScript(a, b string) []string {
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := 0; i <= n; i++ {
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
			ops = append(ops, fmt.Sprintf("match %c", a[i-1]))
			i, j = i-1, j-1
		case i > 0 && j > 0 && dp[i][j] == dp[i-1][j-1]+1:
			ops = append(ops, fmt.Sprintf("sub %c->%c", a[i-1], b[j-1]))
			i, j = i-1, j-1
		case i > 0 && dp[i][j] == dp[i-1][j]+1:
			ops = append(ops, fmt.Sprintf("del %c", a[i-1]))
			i--
		default:
			ops = append(ops, fmt.Sprintf("ins %c", b[j-1]))
			j--
		}
	}
	for l, r := 0, len(ops)-1; l < r; l, r = l+1, r-1 {
		ops[l], ops[r] = ops[r], ops[l]
	}
	return ops
}

func main() {
	for _, op := range editScript("horse", "ros") {
		fmt.Println(op)
	}
}
```

**Java.**
```java
import java.util.*;

public class EditScript {
    static int min3(int a, int b, int c) { return Math.min(a, Math.min(b, c)); }

    static List<String> editScript(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) dp[i][0] = i;
        for (int j = 0; j <= m; j++) dp[0][j] = j;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                dp[i][j] = a.charAt(i - 1) == b.charAt(j - 1)
                    ? dp[i - 1][j - 1]
                    : 1 + min3(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        List<String> ops = new ArrayList<>();
        int i = n, j = m;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a.charAt(i - 1) == b.charAt(j - 1)
                    && dp[i][j] == dp[i - 1][j - 1]) {
                ops.add("match " + a.charAt(i - 1)); i--; j--;
            } else if (i > 0 && j > 0 && dp[i][j] == dp[i - 1][j - 1] + 1) {
                ops.add("sub " + a.charAt(i - 1) + "->" + b.charAt(j - 1)); i--; j--;
            } else if (i > 0 && dp[i][j] == dp[i - 1][j] + 1) {
                ops.add("del " + a.charAt(i - 1)); i--;
            } else {
                ops.add("ins " + b.charAt(j - 1)); j--;
            }
        }
        Collections.reverse(ops);
        return ops;
    }

    public static void main(String[] args) {
        editScript("horse", "ros").forEach(System.out::println);
    }
}
```

**Python.**
```python
def edit_script(a: str, b: str):
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
                dp[i][j] = 1 + min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            ops.append(f"match {a[i - 1]}"); i, j = i - 1, j - 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append(f"sub {a[i - 1]}->{b[j - 1]}"); i, j = i - 1, j - 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(f"del {a[i - 1]}"); i -= 1
        else:
            ops.append(f"ins {b[j - 1]}"); j -= 1
    ops.reverse()
    return ops


if __name__ == "__main__":
    for op in edit_script("horse", "ros"):
        print(op)
```

---

### Challenge 3: Damerau-Levenshtein (with transpositions)

**Problem.** Compute the edit distance allowing adjacent transpositions (cost 1), using the Optimal String Alignment recurrence. `teh → the` should be 1.

**Example.**
```text
"teh","the" -> 1   ; "ifsh","fish" -> 1 (transpose) ; "abcd","badc" -> 2
```

**Optimal.** `O(nm)`.

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

func damerauOSA(a, b string) int {
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := 0; i <= n; i++ {
		dp[i] = make([]int, m+1)
		dp[i][0] = i
	}
	for j := 0; j <= m; j++ {
		dp[0][j] = j
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			dp[i][j] = min3(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost)
			if i > 1 && j > 1 && a[i-1] == b[j-2] && a[i-2] == b[j-1] {
				if v := dp[i-2][j-2] + 1; v < dp[i][j] {
					dp[i][j] = v
				}
			}
		}
	}
	return dp[n][m]
}

func main() {
	fmt.Println(damerauOSA("teh", "the"))   // 1
	fmt.Println(damerauOSA("ifsh", "fish")) // 1
	fmt.Println(damerauOSA("abcd", "badc")) // 2
}
```

**Java.**
```java
public class DamerauOSA {
    static int min3(int a, int b, int c) { return Math.min(a, Math.min(b, c)); }

    static int damerau(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) dp[i][0] = i;
        for (int j = 0; j <= m; j++) dp[0][j] = j;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                dp[i][j] = min3(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a.charAt(i - 1) == b.charAt(j - 2)
                        && a.charAt(i - 2) == b.charAt(j - 1))
                    dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
            }
        return dp[n][m];
    }

    public static void main(String[] args) {
        System.out.println(damerau("teh", "the"));   // 1
        System.out.println(damerau("ifsh", "fish")); // 1
        System.out.println(damerau("abcd", "badc")); // 2
    }
}
```

**Python.**
```python
def damerau_osa(a: str, b: str) -> int:
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                dp[i][j] = min(dp[i][j], dp[i - 2][j - 2] + 1)
    return dp[n][m]


if __name__ == "__main__":
    print(damerau_osa("teh", "the"))    # 1
    print(damerau_osa("ifsh", "fish"))  # 1
    print(damerau_osa("abcd", "badc"))  # 2
```

---

### Challenge 4: Bounded Distance (banded, "is distance ≤ k?")

**Problem.** Given `A`, `B`, and `k`, return the edit distance if it is `≤ k`, else `-1`. Use a diagonal band of half-width `k` with early exit so the cost is `O(k·min(n,m))`.

**Example.**
```text
"kitten","sitting",k=3 -> 3 ; "kitten","sitting",k=1 -> -1
```

**Constraints.** `0 ≤ k ≤ 100`, strings up to `10^6`.

**Go.**
```go
package main

import "fmt"

const INF = 1 << 29

func boundedDistance(a, b string, k int) int {
	n, m := len(a), len(b)
	if abs(n-m) > k {
		return -1
	}
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
		if i <= k {
			cur[0] = i
		}
		lo, hi := maxInt(1, i-k), minInt(m, i+k)
		rowMin := cur[0]
		for j := lo; j <= hi; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = minInt(prev[j]+1, minInt(cur[j-1]+1, prev[j-1]+cost))
			if cur[j] < rowMin {
				rowMin = cur[j]
			}
		}
		if rowMin > k {
			return -1
		}
		prev = cur
	}
	if prev[m] <= k {
		return prev[m]
	}
	return -1
}

func abs(x int) int { if x < 0 { return -x }; return x }
func minInt(a, b int) int { if a < b { return a }; return b }
func maxInt(a, b int) int { if a > b { return a }; return b }

func main() {
	fmt.Println(boundedDistance("kitten", "sitting", 3)) // 3
	fmt.Println(boundedDistance("kitten", "sitting", 1)) // -1
}
```

**Java.**
```java
public class BoundedDistance {
    static final int INF = 1 << 29;

    static int bounded(String a, String b, int k) {
        int n = a.length(), m = b.length();
        if (Math.abs(n - m) > k) return -1;
        int[] prev = new int[m + 1];
        for (int j = 0; j <= m; j++) prev[j] = j <= k ? j : INF;
        for (int i = 1; i <= n; i++) {
            int[] cur = new int[m + 1];
            java.util.Arrays.fill(cur, INF);
            if (i <= k) cur[0] = i;
            int lo = Math.max(1, i - k), hi = Math.min(m, i + k);
            int rowMin = cur[0];
            for (int j = lo; j <= hi; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, Math.min(cur[j - 1] + 1, prev[j - 1] + cost));
                rowMin = Math.min(rowMin, cur[j]);
            }
            if (rowMin > k) return -1;
            prev = cur;
        }
        return prev[m] <= k ? prev[m] : -1;
    }

    public static void main(String[] args) {
        System.out.println(bounded("kitten", "sitting", 3)); // 3
        System.out.println(bounded("kitten", "sitting", 1)); // -1
    }
}
```

**Python.**
```python
INF = 1 << 29


def bounded_distance(a: str, b: str, k: int) -> int:
    n, m = len(a), len(b)
    if abs(n - m) > k:
        return -1
    prev = [j if j <= k else INF for j in range(m + 1)]
    for i in range(1, n + 1):
        cur = [INF] * (m + 1)
        if i <= k:
            cur[0] = i
        lo, hi = max(1, i - k), min(m, i + k)
        row_min = cur[0]
        for j in range(lo, hi + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            row_min = min(row_min, cur[j])
        if row_min > k:
            return -1
        prev = cur
    return prev[m] if prev[m] <= k else -1


if __name__ == "__main__":
    print(bounded_distance("kitten", "sitting", 3))  # 3
    print(bounded_distance("kitten", "sitting", 1))  # -1
```

---

## Final Tips

- Lead with the one-liner: *"`dp[i][j]` is the edit distance of the first `i` and first `j` characters; fill it with match (free diagonal) or `1 + min` of the three neighbors, answer at `dp[n][m]`."*
- Immediately flag the off-by-one: cell `dp[i][j]` compares `A[i-1]` and `B[j-1]`, and the table is `(n+1)×(m+1)`.
- If asked to save memory, mention **two rows** (distance only) and **Hirschberg** (alignment in linear space).
- If asked about typos/swaps, reach for **Damerau (OSA)**; for thresholds, reach for **banded / Ukkonen O(nd)**.
- Name the connections: **LCS** (no substitute), **Needleman-Wunsch/Smith-Waterman** (scored alignment), **Myers diff** (`git`), and the **SETH** quadratic lower bound.
- Always offer to verify by applying the recovered edit script and checking it rebuilds `B`.
