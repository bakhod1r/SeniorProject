# Suffix Arrays (and the LCP Array) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the suffix-array / LCP logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle (naive sort of full suffixes, direct pairwise LCP) on small inputs before trusting the fast version on large input — especially over a tiny alphabet, which is the hardest case.**

---

## Beginner Tasks (5)

### Task 1 — Naive suffix array (the oracle)

**Problem.** Implement `naiveSA(s)` that returns the suffix array by sorting all suffixes with ordinary string comparison. This is your correctness oracle for every later task.

**Input / Output spec.**
- Read `s` (a line of text).
- Print the suffix array as space-separated indices.

**Constraints.** `1 ≤ n ≤ 2000` (slow `O(n² log n)` is fine here).

**Hint.** Sort `range(n)` with a key/comparator that compares `s[i:]` lexicographically.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"strings"
)

func naiveSA(s string) []int {
	n := len(s)
	sa := make([]int, n)
	for i := range sa {
		sa[i] = i
	}
	sort.Slice(sa, func(i, j int) bool {
		return s[sa[i]:] < s[sa[j]:] // TODO: confirm full-suffix comparison
	})
	return sa
}

func main() {
	r := bufio.NewReader(os.Stdin)
	line, _ := r.ReadString('\n')
	s := strings.TrimRight(line, "\n")
	sa := naiveSA(s)
	parts := make([]string, len(sa))
	for i, v := range sa {
		parts[i] = fmt.Sprint(v)
	}
	fmt.Println(strings.Join(parts, " "))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int[] naiveSA(String s) {
        int n = s.length();
        Integer[] sa = new Integer[n];
        for (int i = 0; i < n; i++) sa[i] = i;
        Arrays.sort(sa, (a, b) -> s.substring(a).compareTo(s.substring(b)));
        int[] out = new int[n];
        for (int i = 0; i < n; i++) out[i] = sa[i];
        return out;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.nextLine();
        StringBuilder sb = new StringBuilder();
        for (int v : naiveSA(s)) sb.append(v).append(' ');
        System.out.println(sb.toString().trim());
    }
}
```

**Starter — Python.**
```python
import sys


def naive_sa(s):
    return sorted(range(len(s)), key=lambda i: s[i:])  # TODO: confirm


def main():
    s = sys.stdin.readline().rstrip("\n")
    print(" ".join(map(str, naive_sa(s))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `naiveSA("banana") == [5, 3, 1, 0, 4, 2]`.
- Output is a permutation of `0..n-1`.
- Used as the oracle in Tasks 2–15.

---

### Task 2 — Prefix-doubling suffix array

**Problem.** Implement `buildSA(s)` via prefix doubling (`O(n log² n)` with a comparison sort is acceptable). It must match `naiveSA` on all small inputs.

**Input / Output spec.**
- Read `s`. Print `SA` space-separated.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Sort by `(rank[i], rank[i+k])`, recompute ranks, double `k`, stop when all ranks are distinct.

**Evaluation criteria.**
- Matches `naiveSA` on random strings over a 2-symbol alphabet (the hard case).
- Stops early when `rank[SA[n-1]] == n-1`.
- `O(n log² n)` or better.

---

### Task 3 — Rank array (inverse of SA)

**Problem.** Given `SA`, build the rank array with `rank[SA[r]] = r`. Print it.

**Input / Output spec.**
- Read `n`, then `SA` (`n` ints). Print `rank` space-separated.

**Constraints.** `1 ≤ n ≤ 10⁶`.

**Hint.** One loop: `for r in range(n): rank[sa[r]] = r`.

**Worked check.** For `SA = [5,3,1,0,4,2]` (banana), `rank = [3,2,5,1,4,0]`.

**Evaluation criteria.**
- `rank` is the exact inverse permutation: `SA[rank[i]] == i` for all `i`.
- `O(n)`.

---

### Task 4 — Kasai LCP array

**Problem.** Given `s` and `SA`, build the LCP array with Kasai's `O(n)` algorithm. `LCP[r]` = longest common prefix of `SA[r-1]` and `SA[r]`; `LCP[0] = 0`.

**Input / Output spec.**
- Read `s`, then `SA`. Print `LCP` space-separated.

**Constraints.** `1 ≤ n ≤ 10⁶`.

**Hint.** Process positions in string order, carry `h`, decrement by at most 1. Bound `i+h < n` and `j+h < n`.

**Reference oracle (Python) — use this to validate.**
```python
def naive_lcp(s, sa):
    n = len(s)
    lcp = [0] * n
    for r in range(1, n):
        a, b = sa[r - 1], sa[r]
        h = 0
        while a + h < n and b + h < n and s[a + h] == s[b + h]:
            h += 1
        lcp[r] = h
    return lcp
```

**Evaluation criteria.**
- Matches `naive_lcp` for small `n`.
- For `"aaaa"`, `LCP = [0,1,2,3]`.
- Does NOT reset `h` to 0 each iteration (only `h--`); verify `O(n)` on a long `"aaaa…"`.

---

### Task 5 — Count distinct substrings

**Problem.** Given `s`, output the number of distinct non-empty substrings using `n(n+1)/2 − Σ LCP`.

**Input / Output spec.**
- Read `s`. Print the single 64-bit number.

**Constraints.** `1 ≤ n ≤ 10⁵`; answer fits in 64-bit.

**Hint.** Build `SA`, then `LCP`; compute `n(n+1)/2` in 64-bit, subtract `Σ LCP`.

**Worked check.** `"banana" → 15`, `"aaa" → 3`, `"abc" → 6`.

**Evaluation criteria.**
- Matches a brute `len(set of all substrings)` for `n ≤ 200`.
- Uses 64-bit for the total (overflows 32-bit past `n ≈ 65000`).
- `O(n log n)` overall.

---

## Intermediate Tasks (5)

### Task 6 — Pattern occurrence range by binary search

**Problem.** Given `s`, `SA`, and a pattern `p`, return the sorted list of all starting positions where `p` occurs in `s`. Use two binary searches to bracket the contiguous range.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ |p| ≤ n`, many queries possible.

**Hint.** `lo` = first rank with suffix-prefix `≥ p`; `hi` = first with prefix `> p`. Compare only the first `|p|` characters of each suffix. Positions are `SA[lo..hi-1]`.

**Reference oracle (Python).**
```python
def brute_occurrences(s, p):
    return [i for i in range(len(s) - len(p) + 1) if s[i:i + len(p)] == p]
```

**Evaluation criteria.**
- Matches `brute_occurrences` for random patterns.
- Returns empty for absent patterns.
- `O(|p| log n)` per query.

---

### Task 7 — Longest repeated substring

**Problem.** Given `s`, return the longest substring occurring at least twice (empty if none). Use `max(LCP)`.

**Constraints.** `1 ≤ n ≤ 10⁵`.

**Hint.** Track the argmax of `LCP[r]` for `r ≥ 1`; the answer is `s[SA[r*] : SA[r*]+LCP[r*]]`.

**Reference oracle (Python).**
```python
def brute_lrs(s):
    n = len(s)
    best = ""
    for i in range(n):
        for j in range(i + 1, n):
            h = 0
            while j + h < n and s[i + h] == s[j + h]:
                h += 1
            if h > len(best):
                best = s[i:i + h]
    return best
```

**Evaluation criteria.**
- Matches `brute_lrs` (by length) for `n ≤ 300`.
- `"banana" → "ana"`, `"abcd" → ""`.
- `O(n log n)`.

---

### Task 8 — Longest common substring of two strings

**Problem.** Given `A` and `B`, return the longest substring common to both. Concatenate `A # B` (separator absent from both, smaller than all chars), build `SA + LCP`, max LCP over opposite-side adjacent suffixes.

**Constraints.** `1 ≤ |A|, |B| ≤ 5·10⁴`.

**Hint.** A suffix is in `A` iff its start index `< len(A)`. Only count `LCP[r]` when `SA[r-1]` and `SA[r]` are on opposite sides.

**Reference oracle (Python).**
```python
def brute_lcs(a, b):
    best = ""
    for i in range(len(a)):
        for j in range(len(b)):
            h = 0
            while i + h < len(a) and j + h < len(b) and a[i + h] == b[j + h]:
                h += 1
            if h > len(best):
                best = a[i:i + h]
    return best
```

**Evaluation criteria.**
- Matches `brute_lcs` (by length) for small inputs.
- `("banana","ananas") → "anana"`; disjoint strings → `""`.
- Skips same-side adjacent pairs.

---

### Task 9 — O(n log n) suffix array with radix sort

**Problem.** Upgrade Task 2's prefix doubling to `O(n log n)` by replacing the comparison sort with a stable two-pass counting/radix sort on the `(rank, next-rank)` pairs.

**Constraints.** `1 ≤ n ≤ 2·10⁶`.

**Hint.** Sort stably by the second key first, then by the first key. Offset the empty second half to `0` and shift real ranks by `+1`. Stability is mandatory for correctness.

**Evaluation criteria.**
- Matches Task 2 / `naiveSA` on small inputs.
- Handles `n = 2·10⁶` in well under a second.
- Each round is `O(n)`; total `O(n log n)`.

---

### Task 10 — RMQ for arbitrary-pair LCP

**Problem.** Build a sparse-table RMQ over the LCP array so that `lcp(SA[a], SA[b]) = min(LCP[a+1..b])` is answered in `O(1)` after `O(n log n)` preprocessing. Support queries by two *positions* `i, j` (convert via `rank`).

**Constraints.** `1 ≤ n ≤ 10⁵`, up to `10⁵` queries.

**Hint.** RMQ over `LCP[1..n-1]`; for positions `i, j`, take `ra = rank[i], rb = rank[j]`, query `min(LCP[min+1 .. max])`.

**Reference oracle (Python).**
```python
def naive_lcp_pair(s, i, j):
    h = 0
    while i + h < len(s) and j + h < len(s) and s[i + h] == s[j + h]:
        h += 1
    return h
```

**Evaluation criteria.**
- Matches `naive_lcp_pair` for random position pairs.
- `O(1)` per query after `O(n log n)` build.
- Handles `i == j` (LCP = suffix length).

---

## Advanced Tasks (5)

### Task 11 — k-th smallest distinct substring

**Problem.** Given `s` and `k`, return the `k`-th lexicographically smallest *distinct* substring (1-indexed). Use `SA + LCP`: at rank `r`, suffix `SA[r]` contributes `(n − SA[r]) − LCP[r]` new substrings.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ k ≤` number of distinct substrings.

**Hint.** Walk ranks in order, accumulate `(n − SA[r]) − LCP[r]`; when the running count reaches `k`, the answer is a prefix of `s[SA[r]:]` of the right length.

**Evaluation criteria.**
- For `"banana"`, the sorted distinct substrings begin `a, an, ana, anan, anana, b, ...`; verify `k=1 → "a"`, `k=6 → "b"`.
- Matches a brute sorted-set approach for `n ≤ 200`.
- `O(n)` after `SA + LCP`.

---

### Task 12 — Number of occurrences of each query pattern

**Problem.** Given `s` and `Q` query patterns, return the count of occurrences of each in `s`. Build `SA` once; answer each query with the binary-search range width `hi − lo`.

**Constraints.** `1 ≤ n ≤ 10⁵`, `1 ≤ Q ≤ 10⁵`, total query length `≤ 10⁶`.

**Hint.** Precompute `SA` once. For each pattern, two binary searches give `[lo, hi)`; the count is `hi − lo`. Optionally use LCP to speed comparisons.

**Evaluation criteria.**
- Matches a brute substring count for small inputs.
- `SA` built once, reused across all queries.
- Per-query `O(|p| log n)`.

---

### Task 13 — Longest common substring of K strings

**Problem.** Given `K` strings, find the longest substring that appears in **all** of them. Build a generalized suffix array of `s_1 # s_2 # … # s_K` (distinct separators), then slide a window over the LCP array keeping the min LCP while the window covers all `K` color groups.

**Constraints.** `2 ≤ K ≤ 10`, total length `≤ 10⁵`.

**Hint.** Tag each suffix with the index of the string it belongs to (its "color"). Use a sliding window over sorted suffixes that contains at least one suffix from every color; the answer is the max over such windows of the window's minimum LCP. Use distinct separators so cross-string LCPs cannot run past a boundary.

**Evaluation criteria.**
- Correct for `K = 2` (matches Task 8) and `K ≥ 3`.
- Handles strings with no common substring (`""`).
- Sliding window is `O(total length)` after `SA + LCP`.

---

### Task 14 — Burrows-Wheeler Transform from the suffix array

**Problem.** Given `s` (append sentinel `$`), compute the BWT via `BWT[i] = s[SA[i]-1]` (wrap to `$` when `SA[i] == 0`), then implement the inverse BWT and verify it reconstructs `s`.

**Constraints.** `1 ≤ n ≤ 10⁵`. `$` is unique and smaller than all characters.

**Hint.** Forward: one pass over `SA`. Inverse: build the LF-mapping from the sorted first column and the last column (BWT), then walk it `n` times. Round-tripping is the correctness test.

**Degree sanity check.** The number of occurrences of each character is identical in `s`, in the BWT, and in the sorted first column — assert this after building the BWT to catch indexing bugs.

**Evaluation criteria.**
- `BWT("banana$")` via `SA = [6,5,3,1,0,4,2]` equals `"annb$aa"`.
- Inverse BWT reconstructs the original string exactly.
- Character histograms of `s` and `BWT` match.

---

### Task 15 — Decide the right string-index structure

**Problem.** Given a problem's constraints `(n, query_type, dynamic?)`, return one of: `SUFFIX_ARRAY`, `SUFFIX_ARRAY_PLUS_RMQ`, `FM_INDEX`, `SUFFIX_AUTOMATON`, `DIRECT_SCAN`. Justify each decision.

**Constraints / cases to handle.**
- Static text, substring search, memory-tight → `SUFFIX_ARRAY`.
- Static text, LCP of arbitrary suffix pairs / matching statistics → `SUFFIX_ARRAY_PLUS_RMQ`.
- Huge static corpus, compressed `O(m)` counting → `FM_INDEX`.
- Text grows online (append characters) → `SUFFIX_AUTOMATON`.
- Tiny `n`, one-off search → `DIRECT_SCAN` (or KMP, `01-kmp`).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The dynamic case is the trap: a suffix array is static and cannot be cheaply updated, so a growing string needs the suffix automaton (`12-suffix-automaton`).

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The dynamic branch explicitly cites the static-vs-online distinction.
- Justification references the right complexity (`O(n log n)` / `O(n)` build, `O(m log n)` / `O(m)` search).

---

## Benchmark Task

### Task B — Construction-method crossover

**Problem.** Empirically compare suffix-array construction methods on random strings (fixed seed). Implement:

- **(a) Naive** sort of full suffixes — `O(n² log n)`.
- **(b) Prefix doubling, comparison sort** — `O(n log² n)`.
- **(c) Prefix doubling, radix sort** — `O(n log n)`.

Measure wall-clock time for `n ∈ {10³, 10⁴, 10⁵, 10⁶}` over a 2-symbol alphabet (the hard case) and over a 26-symbol alphabet. Report a table and the crossover where each method becomes impractical.

**Starter — Python.**
```python
import random
import time


def gen(n, sigma, seed):
    r = random.Random(seed)
    alpha = "abcdefghijklmnopqrstuvwxyz"[:sigma]
    return "".join(r.choice(alpha) for _ in range(n))


def naive_sa(s):
    # TODO: O(n^2 log n) oracle
    return sorted(range(len(s)), key=lambda i: s[i:])


def doubling_cmp(s):
    # TODO: O(n log^2 n)
    return []


def doubling_radix(s):
    # TODO: O(n log n)
    return []


def bench(fn, s, reps=3):
    best = float("inf")
    for _ in range(reps):
        t = time.perf_counter()
        fn(s)
        best = min(best, time.perf_counter() - t)
    return best * 1000.0  # ms


def main():
    print("n        sigma  naive_ms   cmp_ms     radix_ms")
    for n in [1000, 10000, 100000, 1000000]:
        for sigma in [2, 26]:
            s = gen(n, sigma, 42)
            naive = bench(naive_sa, s) if n <= 10000 else float("nan")
            cmp_ = bench(doubling_cmp, s) if n <= 100000 else float("nan")
            radix = bench(doubling_radix, s)
            print(f"{n:<8d} {sigma:<6d} {naive:<10.2f} {cmp_:<10.2f} {radix:<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same string across Go, Java, and Python.
- Naive is feasible only for small `n`; radix doubling handles `n = 10⁶`.
- The 2-symbol alphabet is slower than 26-symbol for the doubling methods (more rounds before ranks separate) — report this.
- Report the mean across at least 3 runs and do not time string generation.
- Writeup: a short note on the measured crossover and how the small alphabet forces more doubling rounds.

---

### Task C — LCE-based palindrome length (stretch)

**Problem.** Given `s`, for each center, find the longest palindrome using **longest-common-extension** queries: build `SA + LCP + RMQ` of `s + '#' + reverse(s)`, then a palindrome around a center reduces to an LCE between a forward suffix and a reversed suffix, answered in `O(1)`. Report the longest palindromic substring.

**Constraints.** `1 ≤ n ≤ 5·10⁴`.

**Hint.** `LCE(i, j) = lcp(suffix i, suffix j) = min LCP[rank-range]`. Map center positions to one forward and one reversed suffix; the LCE gives the half-length. (Manacher, `11-manacher-algorithm`, is the direct `O(n)` alternative; this task is to practice the LCE/RMQ machinery.)

**Evaluation criteria.**
- Matches a brute `O(n²)` palindrome check for `n ≤ 500`.
- Uses `O(1)` LCE queries after `O(n log n)` build.
- Handles even- and odd-length palindromes.

---

## General Guidance for All Tasks

- **Always validate against the naive oracle first.** Build `SA` (`naive_sa`) and `LCP` (`naive_lcp`) the slow way for small `n` over a 2-symbol alphabet, diff entrywise, and only then trust the fast version on large input.
- **Build the inverse `rank` right after `SA`.** Kasai and many queries need it; recomputing suffixes instead is `O(n²)`.
- **Get Kasai's `h` right.** Decrement by at most 1, never reset to 0 — resetting silently goes quadratic while staying correct. Bound `i+h < n` and `j+h < n`.
- **Use 64-bit for the distinct-substring total.** `n(n+1)/2` overflows 32-bit past `n ≈ 65000`.
- **Pick a safe separator for concatenation tasks.** Use a character (e.g. `\x01`, or distinct separators for multi-string) absent from all inputs and smaller than every real character.
- **`LCP[r]` is adjacent-only.** For arbitrary suffix pairs use the RMQ range-minimum `min LCP[a+1..b]` (Task 10).
- **The suffix array is static.** If the text changes, rebuild — there is no cheap update (Task 15 trap; use the suffix automaton `12-suffix-automaton` for online growth).
- **Compress the alphabet for large inputs.** Remap characters to `0..σ-1` before radix doubling or SA-IS so counting-sort buckets stay small (relevant for Tasks 9, 14, and the benchmark).
- **Keep `multiply`-free hot loops tight.** Unlike matrix problems, suffix-array hot loops are sorts and scans; the wins are stable radix sort, contiguous arrays, and the early-stop on distinct ranks — profile before micro-optimizing.

### Common test harness shape (all languages)

```text
oracle  = naive_sa(s)              # Task 1
fast    = build_sa(s)              # Task 2 / 9
assert fast == oracle
assert sorted(fast) == range(len(s))           # permutation
lcp     = build_lcp(s, fast)       # Task 4
assert lcp == naive_lcp(s, fast)
assert distinct(s) == len({ s[i:j] for i in .. for j in .. })  # small n
```

Wire this harness once and run it over the fixture table plus a few hundred random `{a,b}` strings of length `≤ 30` on every change. It is the single most effective guard against regressions across the whole task set.

### Worked reference values (use as fixtures)

Pin these in your test suite; they exercise the common edge cases:

| Input | SA | LCP | distinct | longest repeated |
|-------|----|----|----------|-------------------|
| `"banana"` | `[5,3,1,0,4,2]` | `[0,1,3,0,0,2]` | 15 | `"ana"` |
| `"aaa"` | `[2,1,0]` | `[0,1,2]` | 3 | `"aa"` |
| `"abab"` | `[2,0,3,1]` | `[0,2,0,1]` | 7 | `"ab"` |
| `"abc"` | `[0,1,2]` | `[0,0,0]` | 6 | `""` |
| `"a"` | `[0]` | `[0]` | 1 | `""` |

Verify your `buildSA`, `buildLCP`, `distinctSubstrings`, and `longestRepeated` against all five before submitting any task. The `"aaa"` and `"abab"` rows are the most discriminating: `"aaa"` maximizes adjacent LCP (catches the Kasai `h`-reset bug), and `"abab"` exercises periodic tie-breaking in the rank recompute.

### Suggested implementation order

1. Task 1 (naive oracle) — your ground truth for everything else.
2. Tasks 2–4 (doubling SA, rank, Kasai LCP) — the core engine.
3. Task 5, 7 (distinct count, longest repeated) — LCP applications.
4. Task 6 (search) and Task 8 (LCS) — query and concatenation patterns.
5. Tasks 9–10 (radix doubling, RMQ) — performance and arbitrary-pair LCP.
6. Advanced 11–15 and stretch C — build on the verified engine.

Do not start the advanced tasks until Tasks 1–4 pass the fixture table above in all three languages; almost every advanced bug traces back to a subtle SA or LCP construction error that the fixtures would have caught.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
