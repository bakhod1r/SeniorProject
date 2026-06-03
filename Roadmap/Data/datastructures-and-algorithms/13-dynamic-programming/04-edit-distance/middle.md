# Edit Distance (Levenshtein) and String Alignment — Middle Level

> **Focus:** Reconstructing the actual edit script (not just the number), weighting operations with custom costs, adding adjacent-transpositions (Damerau-Levenshtein), shrinking memory to two rows, computing only a diagonal band when the distance is small (Ukkonen), and knowing which variant to reach for.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Reconstructing the Edit Script](#reconstructing-the-edit-script)
4. [Weighted and Custom Operation Costs](#weighted-and-custom-operation-costs)
5. [Damerau-Levenshtein: Adding Transpositions](#damerau-levenshtein-adding-transpositions)
6. [Space Optimization: Two Rows](#space-optimization-two-rows)
7. [Banded DP (Ukkonen) When Distance Is Small](#banded-dp-ukkonen-when-distance-is-small)
8. [Comparison with Alternatives](#comparison-with-alternatives)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the message was a single table: `dp[i][j]` is the edit distance between two prefixes, filled with a four-case recurrence in `O(nm)`. At middle level you start asking the engineering questions that decide whether your solution is *useful* and *fast enough*:

- I have the distance — but how do I get the **actual edits** (the diff) out of the table?
- Real typos are not all equal. How do I make a substitution cost less than an insert, or make `m↔n` cheaper than `m↔z`?
- A swap like `teh → the` is one human mistake but Levenshtein charges **two**. How do I add **transpositions**?
- The full table is `O(nm)` memory. How do I cut it to **two rows** — and what do I lose?
- When I only care whether the distance is `≤ k`, can I avoid filling the whole table?

These questions separate "I can compute Levenshtein" from "I can ship a spell-checker, a diff tool, or a fuzzy-matcher that scales."

---

## Deeper Concepts

### The recurrence, restated with explicit costs

Let `cost_sub(x, y)` be the cost of substituting `x` with `y` (`0` if `x == y`), `cost_del(x)` the cost of deleting `x`, and `cost_ins(y)` the cost of inserting `y`. The general recurrence is:

```
dp[i][j] = min(
    dp[i-1][j-1] + cost_sub(A[i-1], B[j-1]),   # match or substitute
    dp[i-1][j]   + cost_del(A[i-1]),           # delete from A
    dp[i][j-1]   + cost_ins(B[j-1])            # insert into A
)
```

Plain Levenshtein is the special case `cost_sub = 1` (or `0` on equality), `cost_del = cost_ins = 1`. Everything in this file is a controlled variation on this one formula, plus an extra case for transpositions.

### Alignment as a path in a grid

Filling the table is equivalent to finding a cheapest **path** from the top-left corner `(0,0)` to the bottom-right `(n,m)`, where each cell move costs the corresponding operation:

- a **diagonal** move `(i-1,j-1) → (i,j)` is a match (cost 0) or substitute (cost > 0),
- a **down** move `(i-1,j) → (i,j)` is a delete,
- a **right** move `(i,j-1) → (i,j)` is an insert.

This "alignment = shortest path in a DAG" view is the bridge to Dijkstra/A\*-style optimizations and to the bioinformatics aligners (Needleman-Wunsch is literally this; Smith-Waterman clamps negative scores to zero for *local* alignment). The professional file proves the equivalence; here it is the mental model that makes traceback obvious.

### Why each cell needs only three neighbors

Look again at the recurrence: `dp[i][j]` reads `dp[i-1][j-1]`, `dp[i-1][j]`, and `dp[i][j-1]`. Those are the cell **above-left**, **above**, and **left**. No cell ever reads a value to its right or below, which is exactly why a row-major fill (top to bottom, left to right) always has every dependency ready. This locality is also what enables the two-row optimization (you only need the previous row plus the current row's left neighbor) and the banded restriction (a cell's neighbors are all within one step, so an optimal sub-`k` path cannot "jump" outside the band).

### The three derived quantities

From the same table you can read off three useful things without extra work: the **distance** (`dp[n][m]`), the **edit script** (by traceback), and the **alignment** (the script rendered as two gap-padded rows). Many bugs come from conflating these — e.g., computing the right distance with a two-row DP and then trying to traceback, which is impossible because the intermediate rows were discarded. Decide which of the three you need *before* choosing the algorithm.

---

## Reconstructing the Edit Script

The distance is `dp[n][m]`. To recover *which* operations achieve it, **trace back** from the corner to `(0,0)`, at each step choosing a predecessor consistent with how `dp[i][j]` was computed:

```
at (i,j):
    if i>0 and j>0 and A[i-1]==B[j-1] and dp[i][j]==dp[i-1][j-1]:
        record MATCH A[i-1]; go to (i-1,j-1)
    elif i>0 and j>0 and dp[i][j]==dp[i-1][j-1]+cost_sub:
        record SUBSTITUTE A[i-1]->B[j-1]; go to (i-1,j-1)
    elif i>0 and dp[i][j]==dp[i-1][j]+cost_del:
        record DELETE A[i-1]; go to (i-1,j)
    else:   # j>0
        record INSERT B[j-1]; go to (i,j-1)
```

Reverse the recorded list to read the operations in forward order. The traceback is `O(n + m)` because each step decreases `i + j` by at least one.

**Two ways to traceback.** (1) **Recompute from the stored table** as above — needs the full `O(nm)` table in memory. (2) **Store back-pointers** (a parent direction per cell) during the fill — same memory, but the traceback decision is `O(1)` per cell with no re-derivation. If memory is tight and you still need the script, use **Hirschberg** (linear space *with* alignment, in `senior.md`).

**Non-uniqueness.** When two predecessors tie, the choice is arbitrary; different tie-break rules yield different but equally optimal scripts (e.g., "prefer deletes before inserts" produces left-aligned gaps, useful for stable diffs).

---

## Weighted and Custom Operation Costs

Unit costs are rarely realistic. Examples where weights matter:

- **Keyboard-aware spell-check:** substituting `a` for `s` (adjacent keys) should cost less than `a` for `p`.
- **OCR correction:** confusing `0↔O` or `1↔l` is cheap; confusing `m↔w` less so.
- **Bioinformatics:** a substitution matrix (BLOSUM/PAM) assigns biologically meaningful costs to amino-acid swaps; gaps (insert/delete) often cost more than substitutions.
- **Asymmetric costs:** in some applications inserting is cheaper than deleting (or vice versa).

You plug the cost functions into the recurrence. Two cautions:

1. **Metric properties may break.** With arbitrary costs the result is still a well-defined minimum-cost transformation, but it may no longer satisfy the **triangle inequality** or **symmetry**, so it is no longer a true distance *metric*. (Proof of when Levenshtein *is* a metric: `professional.md`.) If you rely on metric properties (e.g., for a BK-tree index), keep costs symmetric and ensure `cost_sub(x,y) ≤ cost_del(x) + cost_ins(y)`.
2. **Affine gaps need more state.** If a *run* of insertions should cost "open + extend" (cheaper per character after the first), the simple recurrence is not enough; you need the **Gotoh** algorithm with three matrices (one each for match/gap-in-A/gap-in-B). That is a senior/professional topic but worth knowing the name.

---

## Damerau-Levenshtein: Adding Transpositions

A very common human error is **transposing** two adjacent characters: `teh → the`, `recieve → receive`. Plain Levenshtein scores `teh → the` as **2** (two substitutions), but it is really **one** mistake. **Damerau-Levenshtein** adds a fourth operation — swap of two adjacent characters — for cost 1.

The **optimal string alignment (OSA)** variant adds one extra case to the recurrence:

```
if i>1 and j>1 and A[i-1]==B[j-2] and A[i-2]==B[j-1]:
    dp[i][j] = min(dp[i][j], dp[i-2][j-2] + 1)   # transpose the last two
```

This is the version most people implement; it is simple and `O(nm)`. **Caveat:** OSA forbids editing a substring more than once, so it can overestimate on adversarial inputs (e.g., `CA → ABC`). The **true Damerau-Levenshtein** (which allows arbitrary edits between transposed characters) needs an extra alphabet-indexed bookkeeping array and is more involved; for spell-check, OSA is almost always what you want.

```
plain Levenshtein("teh","the")        = 2
Damerau/OSA("teh","the")              = 1   # one adjacent transposition
```

**Worked OSA cell.** For `teh → the`, the interesting cell is `dp[3][3]` (whole strings). The usual recurrence would give `2`. But `A[2]='h' == B[1]='h'` and `A[1]='e' == B[2]='e'` — the adjacent pair is swapped — so the transposition case fires: `dp[3][3] = min(2, dp[1][1] + 1) = min(2, 0 + 1) = 1`. The `dp[1][1]` term is the cost of aligning the prefixes `t` and `t` (a free match, `0`), and the `+1` pays for the single swap. This is why a swapped-letter typo costs `1` instead of `2`.

Common transposition typos OSA handles for cost 1: `recieve → receive`, `teh → the`, `adn → and`, `ot → to`.

---

## Space Optimization: Two Rows

Each cell of row `i` depends only on row `i-1` (cells `[j-1]` and `[j]`) and on the current row's left neighbor `[j-1]`. So you never need more than **two rows** at a time:

```
prev = [0,1,2,...,m]          # row i-1, starts as the base row
for i in 1..n:
    cur[0] = i
    for j in 1..m:
        cur[j] = match ? prev[j-1] : 1 + min(prev[j-1], prev[j], cur[j-1])
    prev = cur
answer = prev[m]
```

This is `O(nm)` time but only **`O(m)` space** (or `O(min(n,m))` if you orient the shorter string as the columns). You can even shrink to **one row** with a single saved "diagonal" scalar. The trade-off: you **lose the traceback** — with only two rows you cannot reconstruct the edit script. If you need both linear space *and* the script, use **Hirschberg's algorithm** (`senior.md`), which recovers the alignment in `O(nm)` time and `O(min(n,m))` space via divide-and-conquer.

---

## Banded DP (Ukkonen) When Distance Is Small

In spell-check and fuzzy search you typically only care about candidates within a small threshold `k` (e.g., distance ≤ 2). Key observation: any cell `(i, j)` with `|i − j| > k` must hold a value `> k` (you need at least `|i − j|` inserts/deletes to bridge the length gap), so it can never lie on an optimal path of cost `≤ k`. Therefore you only need to compute a **diagonal band** of width `2k + 1`:

```
for i in 1..n:
    lo = max(1, i - k)
    hi = min(m, i + k)
    for j in lo..hi:
        ... usual recurrence, treating out-of-band neighbors as +∞ ...
    if min value in row i > k:
        return "distance > k"   # early exit
```

This is **Ukkonen's banded algorithm**, running in `O(k · min(n, m))` time and `O(k)` space — a huge win when `k ≪ n`. Combine it with the cheap pre-screen `if |n − m| > k: reject`. Ukkonen also gave an `O(nd)` variant where `d` is the *actual* distance, found by trying increasing thresholds (related to Myers' `O(nd)` diff algorithm used by `git`).

### Choosing the right space-time trade-off

A decision flow when you sit down to implement:

1. **Do you need the actual edits, or just the number?** Just the number → two rows, `O(min(n,m))` space, done.
2. **Need the edits and the strings fit in memory?** Full table + traceback — simplest to get right.
3. **Need the edits but memory is tight (long sequences)?** Hirschberg (`senior.md`) — linear space, full alignment.
4. **Only care whether the distance is within a small `k`?** Banded DP + length pre-screen, `O(k·min(n,m))`.
5. **Distance is small but unknown?** Ukkonen doubling / Myers `O(nd)`.

Picking wrong is rarely *incorrect*, but it can be wildly inefficient: filling a full `O(nm)` table just to answer "is this within 1 edit?" wastes almost all the work a band would have skipped.

```
full DP:    O(n*m)
banded:     O(k*min(n,m))     when you only need "is distance ≤ k?"
```

---

## Comparison with Alternatives

### Levenshtein variants side by side

| Variant | Extra operation | Recurrence change | Use |
|---------|-----------------|-------------------|-----|
| Levenshtein | none | insert / delete / substitute, cost 1 | general edit distance, spell-check |
| Damerau-Levenshtein (OSA) | adjacent transposition | one extra `dp[i-2][j-2]+1` case | typo correction (swapped letters) |
| Weighted Levenshtein | costs vary | `cost_*` functions in the `min` | keyboard/OCR/bio-aware matching |
| Longest Common Subsequence | only insert/delete (no substitute) | drop the substitute term | diff (no in-place edits), similarity |
| Hamming distance | substitute only (equal lengths) | no insert/delete | fixed-length codes, exact-position diff |

### Algorithm choices for the same problem

| Need | Tool | Cost |
|------|------|------|
| Distance only | two-row DP | `O(nm)` time, `O(min(n,m))` space |
| Distance + edit script | full table or back-pointers | `O(nm)` time and space |
| Distance + script, low memory | Hirschberg | `O(nm)` time, `O(min(n,m))` space |
| "Is distance ≤ k?" | banded (Ukkonen) | `O(k·min(n,m))` time, `O(k)` space |
| Distance when it is small | Ukkonen `O(nd)` / Myers diff | `O(nd)` |
| One query vs huge dictionary | BK-tree / trie + bounded DP | sublinear in dictionary size (see `senior.md`) |

The lesson: **pick by what you need from the answer (number vs script) and by how small the distance/threshold is.** A spell-checker that only needs "≤ 2" should never fill the full `O(nm)` table.

---

## Code Examples

### Edit distance with full edit-script reconstruction

#### Go

```go
package main

import "fmt"

type Op struct {
	Kind string // "match", "sub", "del", "ins"
	A, B byte
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

func editScript(a, b string) (int, []Op) {
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
	// traceback
	var ops []Op
	i, j := n, m
	for i > 0 || j > 0 {
		if i > 0 && j > 0 && a[i-1] == b[j-1] && dp[i][j] == dp[i-1][j-1] {
			ops = append(ops, Op{"match", a[i-1], b[j-1]})
			i, j = i-1, j-1
		} else if i > 0 && j > 0 && dp[i][j] == dp[i-1][j-1]+1 {
			ops = append(ops, Op{"sub", a[i-1], b[j-1]})
			i, j = i-1, j-1
		} else if i > 0 && dp[i][j] == dp[i-1][j]+1 {
			ops = append(ops, Op{"del", a[i-1], 0})
			i--
		} else {
			ops = append(ops, Op{"ins", 0, b[j-1]})
			j--
		}
	}
	// reverse
	for l, r := 0, len(ops)-1; l < r; l, r = l+1, r-1 {
		ops[l], ops[r] = ops[r], ops[l]
	}
	return dp[n][m], ops
}

func main() {
	d, ops := editScript("horse", "ros")
	fmt.Println("distance:", d)
	for _, op := range ops {
		fmt.Printf("  %-5s a=%q b=%q\n", op.Kind, string(op.A), string(op.B))
	}
}
```

#### Java

```java
import java.util.*;

public class EditScript {
    record Op(String kind, char a, char b) {}

    static int min3(int a, int b, int c) { return Math.min(a, Math.min(b, c)); }

    static Map.Entry<Integer, List<Op>> editScript(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) dp[i][0] = i;
        for (int j = 0; j <= m; j++) dp[0][j] = j;
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) dp[i][j] = dp[i - 1][j - 1];
                else dp[i][j] = 1 + min3(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
            }
        List<Op> ops = new ArrayList<>();
        int i = n, j = m;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a.charAt(i - 1) == b.charAt(j - 1)
                    && dp[i][j] == dp[i - 1][j - 1]) {
                ops.add(new Op("match", a.charAt(i - 1), b.charAt(j - 1))); i--; j--;
            } else if (i > 0 && j > 0 && dp[i][j] == dp[i - 1][j - 1] + 1) {
                ops.add(new Op("sub", a.charAt(i - 1), b.charAt(j - 1))); i--; j--;
            } else if (i > 0 && dp[i][j] == dp[i - 1][j] + 1) {
                ops.add(new Op("del", a.charAt(i - 1), '\0')); i--;
            } else {
                ops.add(new Op("ins", '\0', b.charAt(j - 1))); j--;
            }
        }
        Collections.reverse(ops);
        return Map.entry(dp[n][m], ops);
    }

    public static void main(String[] args) {
        var res = editScript("horse", "ros");
        System.out.println("distance: " + res.getKey());
        for (Op op : res.getValue())
            System.out.printf("  %-5s a='%s' b='%s'%n", op.kind(),
                op.a() == '\0' ? "" : op.a(), op.b() == '\0' ? "" : op.b());
    }
}
```

#### Python

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
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            ops.append(("match", a[i - 1], b[j - 1])); i, j = i - 1, j - 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append(("sub", a[i - 1], b[j - 1])); i, j = i - 1, j - 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(("del", a[i - 1], None)); i -= 1
        else:
            ops.append(("ins", None, b[j - 1])); j -= 1
    ops.reverse()
    return dp[n][m], ops


if __name__ == "__main__":
    d, ops = edit_script("horse", "ros")
    print("distance:", d)
    for kind, ca, cb in ops:
        print(f"  {kind:<5} a={ca!r} b={cb!r}")
```

### Damerau-Levenshtein (OSA) and two-row Levenshtein

#### Python

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
            dp[i][j] = min(
                dp[i - 1][j] + 1,        # delete
                dp[i][j - 1] + 1,        # insert
                dp[i - 1][j - 1] + cost, # substitute / match
            )
            if (i > 1 and j > 1
                    and a[i - 1] == b[j - 2]
                    and a[i - 2] == b[j - 1]):
                dp[i][j] = min(dp[i][j], dp[i - 2][j - 2] + 1)  # transposition
    return dp[n][m]


def levenshtein_two_rows(a: str, b: str) -> int:
    if len(a) < len(b):            # keep the inner dimension small
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
    print(damerau_osa("teh", "the"))            # 1
    print(damerau_osa("ca", "abc"))             # OSA quirk: 3 (true DL is 2)
    print(levenshtein_two_rows("kitten", "sitting"))  # 3
```

### Banded (Ukkonen) "is distance ≤ k?"

#### Python

```python
INF = float("inf")


def bounded_edit_distance(a: str, b: str, k: int):
    """Return the edit distance if it is <= k, else None (early-exit banded DP)."""
    n, m = len(a), len(b)
    if abs(n - m) > k:
        return None                       # length gap alone exceeds k
    prev = [j if j <= k else INF for j in range(m + 1)]
    for i in range(1, n + 1):
        cur = [INF] * (m + 1)
        cur[0] = i if i <= k else INF
        lo, hi = max(1, i - k), min(m, i + k)
        row_min = cur[0]
        for j in range(lo, hi + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            row_min = min(row_min, cur[j])
        if row_min > k:
            return None                   # no path of cost <= k can remain
        prev = cur
    d = prev[m]
    return d if d <= k else None


if __name__ == "__main__":
    print(bounded_edit_distance("kitten", "sitting", 3))  # 3
    print(bounded_edit_distance("kitten", "sitting", 1))  # None
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Traceback with only two rows | No way to recover the path | Keep the full table, store back-pointers, or use Hirschberg. |
| Transposition indices out of range | Accessing `dp[i-2]`/`B[j-2]` when `i,j < 2` | Guard with `i > 1 and j > 1`. |
| Weighted costs break BK-tree | Triangle inequality violated | Ensure `cost_sub(x,y) ≤ cost_del(x)+cost_ins(y)` and symmetry. |
| Banded false negative | Band too narrow for the real distance | The band is correct only for the threshold `k`; widen `k` (or use unbanded) for the true distance. |
| Affine gaps with simple DP | "Open + extend" cost not modeled | Use Gotoh's three-matrix algorithm, not the single recurrence. |
| OSA overcounts vs true DL | Substring edited twice forbidden | Document the OSA limitation or implement true Damerau-Levenshtein. |

---

## Performance Analysis

| `n × m` | Full DP cells | Full DP memory (int32) | Two-row memory | Banded (k=2) cells |
|---------|---------------|------------------------|----------------|--------------------|
| 100 × 100 | 10 000 | 40 KB | 0.4 KB | ~500 |
| 1 000 × 1 000 | 1 000 000 | 4 MB | 4 KB | ~5 000 |
| 10 000 × 10 000 | 10⁸ | 400 MB | 40 KB | ~50 000 |
| 100 000 × 100 000 | 10¹⁰ | 40 GB (infeasible) | 400 KB | ~500 000 |

Two observations dominate practice:

1. **Memory, not time, kills you first.** A full table for two 100k strings is 40 GB; the two-row trick makes it 400 KB. Always use rolling rows unless you need the script.
2. **The band collapses cost when `k` is small.** For near-duplicate detection (`k ≤ 2`), banded DP is hundreds of times faster than the full table because it skips almost every cell.

The constant-factor wins are the same as any tight DP loop: contiguous row access, `int32` cells if values fit, and a length-difference pre-screen before any allocation.

---

## Best Practices

- **Decide the output first.** Need only the number? Two rows. Need the script *and* low memory? Hirschberg. Need "≤ k"? Banded.
- **Pre-screen on length:** if `|n − m| > k`, the distance already exceeds `k` — reject for free.
- **Keep the inner dimension small:** orient so the shorter string drives the rolling row.
- **Pair weights with metric checks:** if any index/BK-tree relies on the triangle inequality, enforce symmetric, sub-additive costs.
- **Prefer OSA Damerau** for spell-check unless you have a proven need for the true (full) Damerau-Levenshtein.
- **Test the script, not just the distance:** apply the recovered operations to `A` and assert you get `B`. This catches traceback bugs the distance alone hides.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The three neighbors each cell reads (diagonal, up, left) and which one wins.
> - Match cells (free) colored distinctly from substitute/insert/delete cells.
> - The traceback path lighting up from the bottom-right corner to `(0,0)`, emitting the edit script.
> - A toggle to watch only the diagonal band when a threshold `k` is set.

---

## Summary

Once you have the `O(nm)` table, the engineering begins. **Traceback** turns the distance into a real edit script in `O(n+m)` by stepping from the corner back to the origin. **Weighted costs** make the recurrence model keyboard layouts, OCR confusions, or biological substitution matrices — but arbitrary costs can break the metric properties that indexes rely on. **Damerau-Levenshtein (OSA)** adds adjacent transpositions for one extra recurrence case, matching real typos. The **two-row trick** drops memory to `O(min(n,m))` at the cost of the script; **Hirschberg** (next file) recovers the script in linear space too. And when you only need "is the distance ≤ k?", the **banded (Ukkonen)** algorithm computes a diagonal stripe in `O(k·min(n,m))` and exits early. Choose the variant by what you need from the answer and by how small the threshold is — never fill the whole table when a band or two rows will do.
