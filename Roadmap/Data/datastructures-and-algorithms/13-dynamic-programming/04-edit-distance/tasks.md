# Edit Distance (Levenshtein) and String Alignment — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the dynamic-programming logic and validate against the evaluation criteria.
> **Always validate against a brute-force recursive oracle on small strings, and (for any task that produces an edit script) apply the script back to `A` and assert it reconstructs `B`.**

---

## Beginner Tasks (5)

### Task 1 — Levenshtein distance (full table)

**Problem.** Implement `editDistance(a, b)` returning the minimum number of insert/delete/substitute operations (each cost 1) to turn `a` into `b`, using the full `(n+1) × (m+1)` DP table.

**Input / Output spec.**
- Read `a` on the first line, `b` on the second line.
- Print the single integer distance.

**Constraints.**
- `0 ≤ |a|, |b| ≤ 2000`, ASCII characters.

**Hint.** Base cases `dp[i][0] = i`, `dp[0][j] = j`. Interior: free diagonal on match, else `1 + min(diag, up, left)`. Remember `dp[i][j]` compares `a[i-1]` and `b[j-1]`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func editDistance(a, b string) int {
	// TODO: build (n+1)x(m+1) table, fill base cases, then the recurrence
	return 0
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
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


def edit_distance(a: str, b: str) -> int:
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

**Worked check.** For `A = "horse"`, `B = "ros"` the table corner is `3`. Trace the base column `0,1,2,3,4,5` (delete each of `horse`) and base row `0,1,2,3` (insert each of `ros`) to confirm your seeding before filling the interior.

**Evaluation criteria.**
- `editDistance("kitten","sitting") == 3`, `editDistance("","abc") == 3`, `editDistance("abc","abc") == 0`.
- Correct base row/column.
- `O(nm)` time.

---

### Task 2 — Two-row Levenshtein (linear space)

**Problem.** Implement the same distance using only two rows (`O(min(n,m))` space). Orient so the shorter string drives the inner dimension.

**Input / Output spec.** Same I/O as Task 1.

**Constraints.** `0 ≤ |a|, |b| ≤ 50000`.

**Hint.** Keep `prev` and `cur` rows. `cur[0] = i`. After each row, `prev = cur`. Swap `a, b` if `|a| < |b|`.

**Reference oracle (Python) — validate against this.**
```python
def brute_levenshtein(a, b):
    from functools import lru_cache

    @lru_cache(maxsize=None)
    def rec(i, j):
        if i == 0:
            return j
        if j == 0:
            return i
        if a[i - 1] == b[j - 1]:
            return rec(i - 1, j - 1)
        return 1 + min(rec(i - 1, j - 1), rec(i - 1, j), rec(i, j - 1))

    return rec(len(a), len(b))
```

**Evaluation criteria.**
- Matches `brute_levenshtein` for random short strings.
- Uses `O(min(n,m))` memory (no full table).
- Handles empty strings.

---

### Task 3 — Edit script reconstruction

**Problem.** Implement `editScript(a, b)` returning the list of operations (`match`, `sub`, `del`, `ins`) in forward order that achieves the minimum distance. Then implement `apply(a, ops)` that replays the script and must produce `b`.

**Input / Output spec.**
- Read `a`, `b`. Print one operation per line, then the reconstructed string (which must equal `b`).

**Constraints.** `0 ≤ |a|, |b| ≤ 1000`.

**Hint.** Fill the full table, then trace back from `(n,m)` to `(0,0)`. Reverse the recorded ops. `apply` walks the ops: `match`/`sub` consume one char of `a` and emit one of `b`; `del` consumes from `a`; `ins` emits to `b`.

**Worked check.** `editScript("horse","ros")` yields, e.g., `sub h->r, del o, sub r->o, match s, del e` (distance 3). Applying it to `horse` must give `ros`.

**Operation semantics for `apply`.**

| Op | Consumes from `a`? | Emits to output? |
|----|--------------------|------------------|
| `match c` | yes (`c`) | yes (`c`) |
| `sub x->y` | yes (`x`) | yes (`y`) |
| `del x` | yes (`x`) | no |
| `ins y` | no | yes (`y`) |

After replaying all ops, the consumed characters must exactly cover `a` and the emitted characters must exactly spell `b`.

**Evaluation criteria.**
- The number of paid operations equals the Task 1 distance.
- `apply(a, editScript(a, b)) == b` for all test pairs (the load-bearing assertion).
- Handles empty strings and identical strings (empty/all-match scripts).

---

### Task 4 — Distance from/to empty and the bounds

**Problem.** Implement `editDistance` and add asserts that verify the bounds `abs(len(a)-len(b)) <= d <= max(len(a),len(b))` and `d(a,"") == len(a)`, `d("",b) == len(b)`.

**Input / Output spec.** Read `a`, `b`. Print `d`, then `OK` if all bounds hold, else `FAIL`.

**Constraints.** `0 ≤ |a|, |b| ≤ 2000`.

**Hint.** The lower bound is the length difference (each op changes length by ≤ 1). The upper bound is substituting the overlap and inserting/deleting the rest.

**Evaluation criteria.**
- Bounds hold for all random pairs.
- `d(a,"")` and `d("",b)` equal the respective lengths.
- Prints `OK` for every valid input.

---

### Task 5 — Symmetry check

**Problem.** Verify empirically that unit-cost Levenshtein is symmetric: `editDistance(a, b) == editDistance(b, a)` for all inputs.

**Input / Output spec.** Read `a`, `b`. Print `editDistance(a,b)`, `editDistance(b,a)`, and `SYMMETRIC` or `ASYMMETRIC`.

**Constraints.** `0 ≤ |a|, |b| ≤ 2000`.

**Hint.** They must always be equal because every operation has an equal-cost inverse. If your implementation reports asymmetry, you have a bug (often in the base cases or the delete/insert neighbors).

**Evaluation criteria.**
- Always prints `SYMMETRIC`.
- Works for empty, identical, and disjoint strings.

---

## Intermediate Tasks (5)

### Task 6 — Damerau-Levenshtein (OSA)

**Problem.** Implement the Optimal String Alignment distance: Levenshtein plus an adjacent-transposition operation (cost 1). `teh → the` must be 1.

**Input / Output spec.** Read `a`, `b`. Print the OSA distance.

**Constraints.** `0 ≤ |a|, |b| ≤ 2000`.

**Hint.** Add, for `i,j ≥ 2` with `a[i-1]==b[j-2]` and `a[i-2]==b[j-1]`, the option `dp[i-2][j-2] + 1`.

**Reference oracle (Python).**
```python
def brute_osa(a, b):
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
```

**Evaluation criteria.**
- `osa("teh","the") == 1`, `osa("ca","abc") == 3` (the OSA quirk vs true DL = 2).
- Matches `brute_osa`.
- A comment documents that OSA ≠ true Damerau-Levenshtein.

---

### Task 7 — Weighted edit distance

**Problem.** Implement `weightedDistance(a, b, costSub, costDel, costIns)` where the three are functions (or maps) giving per-operation costs. Default to keyboard-adjacency: substituting between adjacent QWERTY keys costs 1, non-adjacent costs 2, indels cost 2.

**Input / Output spec.** Read `a`, `b`. Print the weighted distance under the supplied cost model.

**Constraints.** `0 ≤ |a|, |b| ≤ 1000`, all costs in `[0, 100]`.

**Hint.** Same recurrence with `dp[i-1][j-1]+costSub(a[i-1],b[j-1])`, `dp[i-1][j]+costDel(a[i-1])`, `dp[i][j-1]+costIns(b[j-1])`. `costSub(x,x)=0`.

**Evaluation criteria.**
- With unit costs it equals plain Levenshtein.
- An adjacent-key substitution is cheaper than a distant-key one.
- A comment notes that arbitrary asymmetric costs may break the metric (so no BK-tree indexing).

---

### Task 8 — Banded distance ("is it ≤ k?")

**Problem.** Implement `bounded(a, b, k)` returning the distance if `≤ k`, else `-1`, computing only the diagonal band `|i-j| ≤ k` with early exit. Pre-screen on length difference.

**Input / Output spec.** Read `a`, `b`, `k`. Print the bounded distance or `-1`.

**Constraints.** `0 ≤ k ≤ 200`, strings up to `10^6`.

**Hint.** `if abs(n-m) > k: return -1`. Treat out-of-band neighbors as `+∞`. After each row, if its minimum exceeds `k`, return `-1`.

**Reference oracle (Python).**
```python
def brute_bounded(a, b, k):
    INF = float("inf")
    n, m = len(a), len(b)
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    d = prev[m]
    return d if d <= k else -1
```

**Evaluation criteria.**
- Matches `brute_bounded` (returns the true distance when `≤ k`, else `-1`).
- Cost is `O(k·min(n,m))`, verified by instrumenting the cell count.
- Correctly rejects via the length pre-screen when `|n-m| > k`.

---

### Task 9 — Longest Common Subsequence as edit distance

**Problem.** Implement LCS length two ways and verify they agree: (a) the LCS DP, (b) via edit distance with **only insert/delete** allowed (no substitution), using the identity `lcs = (n + m - d_insdel) / 2`.

**Input / Output spec.** Read `a`, `b`. Print the LCS length from both methods; they must match.

**Constraints.** `0 ≤ |a|, |b| ≤ 2000`.

**Hint.** Insert/delete-only edit distance `d` satisfies `d = n + m - 2·lcs`. So `lcs = (n + m - d) / 2`. The insert/delete-only recurrence drops the substitute term: on mismatch, `dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1])`.

**Evaluation criteria.**
- Both methods give the same LCS length for all pairs.
- LCS of identical strings equals the length; LCS with no common char is 0.
- A comment explains the `d = n + m - 2·lcs` relationship.

---

### Task 10 — Incremental distance as the user types

**Problem.** Implement an object/struct that holds a fixed dictionary word `w` and supports `push(c)` (append a character to the query) and `distance()` returning the current Levenshtein distance from the growing query to `w`. Each `push` must be `O(|w|)`, not a full recompute.

**Input / Output spec.** Read `w`, then a sequence of characters. After each `push`, print the current distance.

**Constraints.** `|w| ≤ 5000`, query length ≤ `5000`.

**Hint.** The query is a prefix that grows. Each new character adds one column (if `w` is the rows) computed from the previous column in `O(|w|)`. Keep the last column as state.

**Evaluation criteria.**
- After pushing all of query `q`, `distance()` equals `editDistance(q, w)` from Task 1.
- Each `push` is `O(|w|)`.
- Matches a full recompute at every prefix on small inputs.

---

## Advanced Tasks (5)

### Task 11 — Hirschberg linear-space alignment

**Problem.** Implement Hirschberg's algorithm: return an optimal alignment `(a', b')` (with `-` gaps) using `O(min(n,m))` working space and `O(nm)` time.

**Input / Output spec.** Read `a`, `b`. Print the two aligned strings on two lines. The number of differing/gap columns must equal the Levenshtein distance.

**Constraints.** `0 ≤ |a|, |b| ≤ 20000` (full table would be too large to store comfortably for the upper range).

**Hint.** Forward rolling-row scores to the middle row, backward rolling-row scores from the bottom; split at the column `j*` minimizing their sum; recurse on both halves; concatenate. Base cases: one side length ≤ 1.

**Evaluation criteria.**
- The alignment's cost equals the two-row Levenshtein distance.
- Working space is `O(min(n,m))` (no full table allocated).
- Removing gaps from `a'` recovers `a`, from `b'` recovers `b`.

---

### Task 12 — Fuzzy dictionary search with verification

**Problem.** Given a dictionary (list of words) and a query, return all words within Levenshtein distance `k`. Use a length pre-screen plus banded verification. Compare results against a brute linear scan with full DP.

**Input / Output spec.** Read the dictionary size `D`, then `D` words, then the query and `k`. Print all matching words with their distances, sorted by distance then lexicographically.

**Constraints.** `1 ≤ D ≤ 10^5`, `0 ≤ k ≤ 3`, words up to length 40.

**Hint.** Skip any word with `abs(len(w)-len(q)) > k` before running banded DP. The banded verification is Task 8.

**Evaluation criteria.**
- Returns exactly the same set as the brute linear scan.
- Pre-screen rejects the majority of words (instrument the rejection ratio).
- Sorted output is deterministic.

---

### Task 13 — BK-tree index

**Problem.** Build a BK-tree over a dictionary keyed by Levenshtein distance, and answer "all words within distance `k` of the query" by descending only into children whose edge label is in `[d-k, d+k]`.

**Input / Output spec.** Read `D` words, build the tree, then read queries `(q, k)` and print matches.

**Constraints.** `1 ≤ D ≤ 10^5`, `0 ≤ k ≤ 3`.

**Hint.** Each node holds a word and a map `{distance → child}`. The triangle inequality guarantees no match lies outside `[d-k, d+k]`. This only works because Levenshtein is a metric (do not use weighted asymmetric costs here).

**Evaluation criteria.**
- Returns exactly the same set as a brute linear scan.
- Visits far fewer nodes than the dictionary size on average (instrument node visits).
- A comment states the metric requirement and why weighted costs may break it.

---

### Task 14 — Needleman-Wunsch global alignment with a scoring matrix

**Problem.** Implement Needleman-Wunsch: given a substitution score function `s(x,y)` and a linear gap penalty `g`, compute the maximum global alignment score and one optimal alignment. Verify that with `s(x,x)=0, s(x,y)=-1, g=-1` the score equals `-Levenshtein(a,b)`.

**Input / Output spec.** Read `a`, `b`. Print the alignment score and the two aligned rows.

**Constraints.** `0 ≤ |a|, |b| ≤ 2000`.

**Hint.** `H[i][j] = max(H[i-1][j-1]+s(a,b), H[i-1][j]+g, H[i][j-1]+g)`; base rows are multiples of `g`. Trace back from `(n,m)`.

**Evaluation criteria.**
- With unit-cost scoring, `score == -Levenshtein(a,b)`.
- The recovered alignment achieves the reported score.
- Handles a non-trivial scoring matrix (e.g., match +2, mismatch -1, gap -2).

---

### Task 15 — Decide the right algorithm

**Problem.** Implement `classify(n, m, need, k)` returning one of `FULL_DP`, `TWO_ROW`, `HIRSCHBERG`, `BANDED`, `UKKONEN_ND`, or `INTRACTABLE`, where `need` is one of `distance`, `script`, `threshold`, `simple_paths`. Justify each rule.

**Constraints / cases to handle.**
- `need = distance`, large `n·m` → `TWO_ROW` (linear space).
- `need = script`, memory tight → `HIRSCHBERG`.
- `need = script`, memory fine → `FULL_DP`.
- `need = threshold` with small `k` → `BANDED`.
- `need = distance`, distance known to be small → `UKKONEN_ND`.
- `need = simple_paths` (counting distinct optimal *simple-path* alignments under arbitrary constraints, NP-style) → `INTRACTABLE`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is conflating "I need the alignment" with "I can afford the full table" — Hirschberg exists precisely for the tight-memory script case.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- Justification references the right complexity (`O(nm)`, `O(min(n,m))` space, `O(k·min(n,m))`, `O(nd)`).
- The `INTRACTABLE` branch explains why (no polynomial algorithm under the stated constraints).

---

## Benchmark Task

### Task B — Full table vs two-row vs banded crossover

**Problem.** Empirically compare three implementations on random string pairs of length `V`:

- **(a) Full table:** `O(V²)` time, `O(V²)` memory.
- **(b) Two-row:** `O(V²)` time, `O(V)` memory.
- **(c) Banded (k):** `O(k·V)` time when the true distance is `≤ k`.

Measure wall-clock time and peak memory for `V ∈ {100, 1000, 5000, 20000}` and `k ∈ {2, 10}`. Report a table and identify where the full table becomes infeasible (memory) and where banding dominates (small `k`).

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_pair(v: int, edits: int, seed: int):
    r = random.Random(seed)
    a = "".join(r.choice("ACGT") for _ in range(v))
    b = list(a)
    for _ in range(edits):
        i = r.randrange(len(b))
        b[i] = r.choice("ACGT")
    return a, "".join(b)


def full_table(a, b):
    # TODO: O(V^2) time and memory
    return 0


def two_row(a, b):
    # TODO: O(V^2) time, O(V) memory
    return 0


def banded(a, b, k):
    # TODO: O(k*V) time with early exit; return distance or None
    return 0


def bench(fn, *args) -> float:
    start = time.perf_counter()
    fn(*args)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("V       full_ms     tworow_ms    banded(k=2)_ms")
    for v in [100, 1000, 5000, 20000]:
        a, b = gen_pair(v, edits=2, seed=42)
        rb_two = [bench(two_row, a, b) for _ in range(3)]
        rb_band = [bench(banded, a, b, 2) for _ in range(3)]
        if v <= 5000:  # full table feasible
            rb_full = [bench(full_table, a, b) for _ in range(3)]
            print(f"{v:<7d} {mean_ms(rb_full):<11.2f} {mean_ms(rb_two):<12.2f} {mean_ms(rb_band):<12.2f}")
        else:
            print(f"{v:<7d} {'(skipped)':<11} {mean_ms(rb_two):<12.2f} {mean_ms(rb_band):<12.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same string pair across Go, Java, and Python.
- Full table and two-row return identical distances; banded matches when the distance ≤ k.
- Two-row stays flat in memory while full table grows quadratically (becomes infeasible by `V = 20000`).
- Banded with small `k` is dramatically faster than both when the pair is near-identical.
- Report includes the mean across at least 3 runs and does not time string generation.

---

## General Guidance for All Tasks

- **Validate against the brute-force oracle first.** Every task ships with (or references) a slow recursive / full-DP oracle. Run it on small strings, diff, and only then trust the optimized version on large inputs.
- **Apply the edit script.** For any task that produces operations, replay them on `a` and assert you get `b`. This single check catches recurrence, traceback, and labeling bugs at once.
- **Mind the off-by-one.** Cell `dp[i][j]` compares `a[i-1]` and `b[j-1]`; the table is `(n+1) × (m+1)`.
- **Get the base cases right.** `dp[i][0] = i`, `dp[0][j] = j`. The most common beginner bug is leaving them at zero.
- **Pick the algorithm by what you need.** Distance only → two rows. Script + tight memory → Hirschberg. Threshold → banded. Small distance → Ukkonen `O(nd)`.
- **Pre-screen on length.** `abs(len(a)-len(b))` is a free lower bound on the distance; use it to reject before any DP.
- **Normalize Unicode consistently.** Compare code points (runes), not bytes, and apply the same normalization (NFC) to both strings.

### Difficulty progression

The tasks are ordered to build the concept stack incrementally:

1. **Beginner (1–5)** cement the table, the two-row optimization, the edit script, the bounds, and symmetry — the invariants every later task depends on.
2. **Intermediate (6–10)** add the practical variants: transpositions (Damerau/OSA), weighted costs, threshold banding, the LCS relationship, and online/incremental recomputation.
3. **Advanced (11–15)** are the production-grade pieces: linear-space alignment (Hirschberg), dictionary-scale fuzzy search with pre-screening, the BK-tree metric index, scored alignment (Needleman-Wunsch), and the meta-skill of choosing the right algorithm.
4. **Benchmark (B)** ties it together by measuring the real crossover between the full table, two rows, and banding — turning the asymptotic claims into wall-clock numbers.

### A shared test harness recommendation

Build one brute-force recursive oracle and one "apply the edit script" checker, then reuse them across every task. The oracle validates any distance function on small inputs; the script checker validates any traceback by asserting `apply(a, ops) == b`. Together they catch the off-by-one, base-case, and labeling bugs that account for nearly every real defect — far more efficiently than writing bespoke assertions per task.

### Cross-language parity

Because every task is implemented three times, treat the three implementations as a built-in differential test: run all three on the same seeded inputs and assert identical output. Divergence almost always reveals a language-specific trap — Go's `len(s)` counting bytes (use `[]rune`), Java `char` vs Unicode code points, or Python's arbitrary-precision integers masking an overflow that Go/Java would expose. Catching these early is exactly why the three-language requirement exists.

A practical setup: write a tiny driver per language that reads the same line-based input format, and a shell script that pipes a battery of seeded cases through all three binaries and `diff`s the outputs. Any non-empty `diff` is a bug in at least one implementation — usually the off-by-one or the Unicode handling. This harness pays for itself the first time it catches a discrepancy you would otherwise have shipped.

Finally, keep the inputs deterministic: seed the RNG explicitly and document the seed, so a failing case is reproducible across machines and across the three languages without flakiness.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
