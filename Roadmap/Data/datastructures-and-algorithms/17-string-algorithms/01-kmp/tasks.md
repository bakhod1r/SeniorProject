# Knuth-Morris-Pratt (KMP) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the prefix-function / KMP logic and validate against the evaluation criteria.
> **Always test against a brute-force naive matcher on small inputs before trusting the KMP result.**

---

## Beginner Tasks (5)

### Task 1 — Build the prefix function

**Problem.** Implement `buildLPS(p)` returning the prefix-function array where `lps[i]` is the longest proper prefix of `p[0..i]` that is also a suffix.

**Input / Output spec.**
- Read a string `p` (one line).
- Print the `lps` array, space-separated.

**Constraints.**
- `1 ≤ |p| ≤ 10^6`, lowercase ASCII letters.
- Must run in `O(|p|)` (no nested re-scanning).

**Hint.** Maintain a running `len = lps[i-1]`; on mismatch fall back to `lps[len-1]` while `len > 0`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func buildLPS(p string) []int {
	// TODO: O(n) prefix function
	return nil
}

func main() {
	r := bufio.NewReader(os.Stdin)
	var p string
	fmt.Fscan(r, &p)
	for i, v := range buildLPS(p) {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(v)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int[] buildLPS(String p) {
        // TODO: O(n) prefix function
        return new int[0];
    }
    public static void main(String[] args) {
        String p = new Scanner(System.in).next();
        int[] lps = buildLPS(p);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lps.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(lps[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
def build_lps(p):
    # TODO: O(n) prefix function
    return []


if __name__ == "__main__":
    p = input().strip()
    print(*build_lps(p))
```

**Evaluation.** For `p = "ababaca"` expect `0 0 1 2 3 0 1`. Compare against an `O(n²)` brute-force border check on random short strings.

---

### Task 2 — First occurrence index

**Problem.** Return the index of the first occurrence of `p` in `t`, or `-1` if absent (the classic `strstr`/LeetCode 28).

**Input / Output spec.** Read `t` then `p`; print the index or `-1`.

**Constraints.** `1 ≤ |t|, |p| ≤ 10^6`, lowercase ASCII. Must be `O(|t| + |p|)`.

**Hint.** Run the KMP matcher; return `i - m + 1` the first time `j == m`.

**Starter — Go.**
```go
func indexOf(t, p string) int {
	// TODO: KMP, return first start index or -1
	return -1
}
```

**Starter — Java.**
```java
static int indexOf(String t, String p) {
    // TODO: KMP, return first start index or -1
    return -1;
}
```

**Starter — Python.**
```python
def index_of(t, p):
    # TODO: KMP, return first start index or -1
    return -1
```

**Evaluation.** `indexOf("hello", "ll") == 2`; `indexOf("aaaaa", "bba") == -1`; matches Go `strings.Index`, Java `indexOf`, Python `str.find` on random inputs.

---

### Task 3 — Count overlapping occurrences

**Problem.** Count how many times `p` appears in `t`, counting overlaps.

**Input / Output spec.** Read `t` then `p`; print the count.

**Constraints.** `1 ≤ |t|, |p| ≤ 10^6`. Overlaps count (e.g. `"aa"` in `"aaaa"` is 3).

**Hint.** On each `j == m`, increment the counter and set `j = lps[j-1]`.

**Starter — Go.**
```go
func countOccurrences(t, p string) int {
	// TODO: KMP with overlap counting
	return 0
}
```

**Starter — Java.**
```java
static int countOccurrences(String t, String p) {
    // TODO: KMP with overlap counting
    return 0;
}
```

**Starter — Python.**
```python
def count_occurrences(t, p):
    # TODO: KMP with overlap counting
    return 0
```

**Evaluation.** `count("aaaa", "aa") == 3`; `count("abababab", "abab") == 3`. Compare to a sliding-window brute force.

---

### Task 4 — Longest border (happy prefix)

**Problem.** Return the longest *proper* prefix of `s` that is also a suffix (LeetCode 1392). Return the string (or empty).

**Input / Output spec.** Read `s`; print the longest happy prefix or an empty line.

**Constraints.** `1 ≤ |s| ≤ 10^6`. Must be `O(|s|)`.

**Hint.** It is `s[0 : lps[|s|-1]]`.

**Starter — Go.**
```go
func longestHappyPrefix(s string) string {
	// TODO: return s[:lps[len(s)-1]]
	return ""
}
```

**Starter — Java.**
```java
static String longestHappyPrefix(String s) {
    // TODO: return s.substring(0, lps[s.length()-1])
    return "";
}
```

**Starter — Python.**
```python
def longest_happy_prefix(s):
    # TODO: return s[:lps[-1]]
    return ""
```

**Evaluation.** `longestHappyPrefix("level") == "l"`; `longestHappyPrefix("ababab") == "abab"`; `longestHappyPrefix("abc") == ""`.

---

### Task 5 — Naive matcher oracle

**Problem.** Implement the `O(nm)` naive matcher returning all overlapping start indices. You will use this as the correctness oracle for every later task.

**Input / Output spec.** Read `t` then `p`; print all start indices space-separated (or empty line).

**Constraints.** `1 ≤ |t|, |p| ≤ 2000` (small; this is the slow oracle).

**Hint.** For each offset `s`, compare `t[s:s+m]` to `p`.

**Starter — Python.**
```python
def naive(t, p):
    m = len(p)
    return [s for s in range(len(t) - m + 1) if t[s:s + m] == p]


if __name__ == "__main__":
    t, p = input().strip(), input().strip()
    print(*naive(t, p))
```

(Write the Go and Java equivalents; they are short.)

**Evaluation.** Must agree with your KMP search from Task 2/3 on thousands of random small-alphabet strings.

---

## Intermediate Tasks (5)

### Task 6 — Smallest period

**Problem.** Given `s`, output its smallest period `p = |s| - lps[|s|-1]`, and whether `s` is a clean repetition (`|s| % p == 0`).

**Input / Output spec.** Read `s`; print `p` and `true`/`false`.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Build `lps`, take `p = n - lps[n-1]`, test `n % p == 0`.

**Starter — Go.**
```go
func smallestPeriod(s string) (int, bool) {
	// TODO: return period and isCleanRepetition
	return len(s), false
}
```

**Starter — Java.**
```java
static int[] smallestPeriod(String s) {
    // TODO: return {period, isClean?1:0}
    return new int[]{s.length(), 0};
}
```

**Starter — Python.**
```python
def smallest_period(s):
    # TODO: return (period, is_clean)
    return (len(s), False)
```

**Evaluation.** `"abcabcabc" → (3, True)`; `"abcab" → (3, False)`; `"aaaa" → (1, True)`.

---

### Task 7 — Repeated substring pattern (LeetCode 459)

**Problem.** Return `true` iff `s` is some substring repeated ≥ 2 times.

**Input / Output spec.** Read `s`; print `true`/`false`.

**Constraints.** `1 ≤ |s| ≤ 10^4`.

**Hint.** `period = n - lps[n-1]`; answer `period < n and n % period == 0`.

**Starter — Go.**
```go
func repeatedSubstringPattern(s string) bool {
	// TODO
	return false
}
```

**Starter — Java.**
```java
static boolean repeatedSubstringPattern(String s) {
    // TODO
    return false;
}
```

**Starter — Python.**
```python
def repeated_substring_pattern(s):
    # TODO
    return False
```

**Evaluation.** `"abab" → true`, `"aba" → false`, `"abcabcabcabc" → true`.

---

### Task 8 — Search via the `P # T` trick

**Problem.** Find all occurrences of `p` in `t` using *only* the prefix-function builder applied to `p + '#' + t` (no separate matcher). Choose a sentinel guaranteed absent from both.

**Input / Output spec.** Read `t` then `p`; print all start indices.

**Constraints.** `1 ≤ |t|, |p| ≤ 10^6`; inputs are lowercase letters (so `#` is safe).

**Hint.** Build `lps` of `S = p + "#" + t`; wherever `lps[i] == |p|`, the match starts at `i - 2|p|` in `t`.

**Starter — Python.**
```python
def search_concat(t, p, sep="#"):
    # TODO: build lps of p+sep+t, collect i where lps[i]==len(p)
    return []
```

(Provide Go and Java versions following the same structure.)

**Evaluation.** Must produce the same indices as Task 2/5 on random inputs.

---

### Task 9 — Streaming matcher (chunked input)

**Problem.** Implement a stateful matcher that accepts the text in arbitrary chunks and reports all match offsets, where a match may **span chunk boundaries**. The carry state must persist between `feed` calls.

**Input / Output spec.** First line: `p`. Remaining lines: text chunks (concatenate logically). Print all absolute match start offsets.

**Constraints.** Total text up to `10^7` bytes; do not buffer past text beyond `lps`.

**Hint.** Keep `j` and a global offset as fields; never reset `j` between chunks.

**Starter — Java.**
```java
class StreamMatcher {
    final char[] pat; final int[] lps; int j = 0; long off = 0;
    StreamMatcher(String p) {
        pat = p.toCharArray();
        lps = new int[pat.length];
        // TODO: build lps
    }
    java.util.List<Long> feed(String chunk) {
        // TODO: scan chunk, emit absolute start offsets, keep j/off across calls
        return new java.util.ArrayList<>();
    }
}
```

(Provide Go struct with `Feed` and Python class with `feed`.)

**Evaluation.** Feeding `"xxab"` then `"cabyy"` with `p = "abcab"` must report offset 2 (the match crosses the boundary). One-chunk and byte-by-byte feeds must agree.

---

### Task 10 — Count occurrences of each prefix

**Problem.** For string `s`, output for each prefix length `k` (1..n) how many times the prefix `s[0..k-1]` occurs as a substring of `s`.

**Input / Output spec.** Read `s`; print `n` integers (count for each prefix length).

**Constraints.** `1 ≤ |s| ≤ 10^5`.

**Hint.** Initialize `cnt[lps[i]]++` for all `i`; then for `k` from `n` down to 1, add `cnt[k]` to `cnt[lps[k-1]]`; finally add 1 to each prefix for itself.

**Starter — Python.**
```python
def prefix_occurrence_counts(s):
    n = len(s)
    lps = build_lps(s)
    cnt = [0] * (n + 1)
    # TODO: tally lps, propagate down border chain, add self-count
    return cnt[1:]
```

(Provide Go and Java versions.)

**Evaluation.** For `"aaa"`: prefix `"a"` occurs 3×, `"aa"` 2×, `"aaa"` 1× → `[3, 2, 1]`.

---

## Advanced Tasks (5)

### Task 11 — Shortest string with both s and reverse(s) as prefix-suffix

**Problem.** Given `s`, find the shortest string `w` that has `s` as a prefix and a given suffix `q` as a suffix, with maximal overlap (concatenate `s` and `q` sharing the longest border of `q` within `s`). Use the prefix function of `q + '#' + s`.

**Input / Output spec.** Read `s` and `q`; print the merged shortest superstring.

**Constraints.** `1 ≤ |s|, |q| ≤ 10^6`, lowercase.

**Hint.** Overlap = `lps[last]` of `q + "#" + s`; append `q[overlap:]` to `s`.

**Starter — Go.**
```go
func shortestMerge(s, q string) string {
	// TODO: prefix function of q+"#"+s; overlap=lps[len-1]; return s + q[overlap:]
	return s + q
}
```

(Provide Java and Python versions.)

**Evaluation.** `shortestMerge("abcab", "cabd") == "abcabd"` (overlap "cab").

---

### Task 12 — Minimum characters to prepend to make a palindrome

**Problem.** Find the minimum characters to add at the *front* of `s` to make it a palindrome. Classic KMP application: build `lps` of `s + '#' + reverse(s)`; answer is `|s| - lps[last]`.

**Input / Output spec.** Read `s`; print the minimum number of prepended characters.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** The longest palindromic prefix has length `lps[last]` of `s + "#" + reverse(s)`.

**Starter — Python.**
```python
def min_prepend_for_palindrome(s):
    rev = s[::-1]
    comb = s + "#" + rev
    lps = build_lps(comb)
    return len(s) - lps[-1]


print(min_prepend_for_palindrome("aacecaaa"))  # 0
print(min_prepend_for_palindrome("abcd"))      # 3
```

(Provide Go and Java versions.)

**Evaluation.** `"aacecaaa" → 0`, `"abcd" → 3`, `"a" → 0`.

---

### Task 13 — KMP automaton transition table

**Problem.** Build the explicit DFA transition table `δ[state][c]` for pattern `p` over alphabet `Σ`, then search `t` using only table lookups (no inner `while`).

**Input / Output spec.** Read alphabet size `|Σ|` (chars `a..`), `p`, `t`; print all match start indices.

**Constraints.** `|Σ| ≤ 26`, `|p| ≤ 10^4`, `|t| ≤ 10^6`.

**Hint.** `δ[state][c] = state+1` if `c==p[state]`; else `δ[lps[state-1]][c]` (state 0 → 0). Build rows in increasing state order.

**Starter — Java.**
```java
static int[][] buildAutomaton(String p, int sigma) {
    int m = p.length();
    int[][] d = new int[m + 1][sigma];
    int[] lps = buildLPS(p);
    // TODO: fill transitions using lps
    return d;
}
```

(Provide Go and Python versions plus the table-driven search.)

**Evaluation.** Searching with the automaton must equal the failure-link matcher on random inputs; verify per-character work is a single lookup.

---

### Task 14 — 2D pattern search (rows via KMP)

**Problem.** Given an `R × C` text grid and an `r × c` pattern grid, find all top-left positions where the pattern occurs. Reduce each pattern row to a hashed/ID symbol, run KMP column-wise. (Simplified: assume `c == C` so you match whole rows; KMP over row-IDs.)

**Input / Output spec.** Read the two grids; print all matching top-left row indices.

**Constraints.** `R ≤ 1000`, `C ≤ 1000`, pattern fits inside.

**Hint.** Map each distinct row string to an integer ID, then KMP-match the sequence of pattern-row IDs against the sequence of text-row IDs.

**Starter — Python.**
```python
def search_2d_rows(text_rows, pat_rows):
    # map rows to ids, then KMP over the id sequences
    ids = {}
    def rid(r): return ids.setdefault(r, len(ids))
    t_ids = [rid(r) for r in text_rows]
    p_ids = [rid(r) for r in pat_rows]
    # TODO: KMP over integer sequences t_ids, p_ids -> match row indices
    return []
```

(Provide Go and Java versions; the KMP must operate on integer arrays, not strings.)

**Evaluation.** Construct a grid with a known repeated row block and confirm all top-left rows are found; compare to a brute-force row-block scan.

---

### Task 15 — Distinct substrings via prefix function (per-prefix)

**Problem.** Incrementally compute the number of distinct substrings of `s` as each character is appended, using the prefix function of the reversed growing prefix. For each new character, add `len - max_border` new distinct substrings, where `max_border` is the largest prefix-function value over `reverse(current_prefix)`.

**Input / Output spec.** Read `s`; print the count of distinct substrings of the whole string.

**Constraints.** `1 ≤ |s| ≤ 2000` (the `O(n²)` prefix-function approach).

**Hint.** Appending `c` to a string of length `L` adds `(L+1) - max(prefix_function(reverse(s' )))` distinct substrings, where `s'` is the new prefix.

**Starter — Python.**
```python
def count_distinct_substrings(s):
    total = 0
    cur = ""
    for c in s:
        cur = c + cur          # prepend to reuse reversed-prefix-function trick
        pi = build_lps(cur)
        total += len(cur) - (max(pi) if pi else 0)
    return total


print(count_distinct_substrings("aba"))  # 5: a, b, ab, ba, aba
```

(Provide Go and Java versions.)

**Evaluation.** `"aba" → 5`; `"aaa" → 3` (a, aa, aaa); compare to a brute-force set of all substrings on small strings.

---

## Evaluation Criteria (all tasks)

| Criterion | Requirement |
|-----------|-------------|
| Correctness | Matches the naive oracle / known answers on all provided and random tests. |
| Complexity | Beginner/Intermediate must be `O(n + m)` (or as stated); no hidden quadratic. |
| Overlap handling | Counting/search tasks must use `j = lps[j-1]` after a match, not `j = 0`. |
| Index correctness | Match start is `i - m + 1`; no off-by-one. |
| Edge cases | Empty pattern/text, pattern longer than text, single char, all-same chars handled. |
| Three languages | Working Go, Java, and Python solutions for every task. |

---

## Progression Guide

1. **Beginner (1–5):** master `buildLPS` and the matcher; build your naive oracle first.
2. **Intermediate (6–10):** harvest the byproducts — period, repeated-pattern, `P#T`, streaming, prefix counts.
3. **Advanced (11–15):** compose KMP into larger algorithms — palindrome prepend, automaton table, 2D search, distinct substrings.

Test every solution against the Task 5 naive oracle on thousands of random small-alphabet strings before submitting. A single overlap or off-by-one bug is the most common failure; differential testing catches it immediately.
