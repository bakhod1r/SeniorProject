# Manacher's Algorithm (All Palindromic Substrings in O(n)) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Manacher logic and validate against the evaluation criteria.
> **Always test against a brute-force center-expansion oracle on small inputs before trusting the linear result.**

---

## Beginner Tasks (5)

### Task 1 — Build the `#`-transform

**Problem.** Implement `transform(s)` that returns the string `t = "#" + "#".join(s) + "#"`. For `s = "abc"`, `t = "#a#b#c#"`, of length `2|s| + 1`.

**Input / Output spec.**
- Read `s` (one line).
- Print `t`.

**Constraints.**
- `0 ≤ |s| ≤ 10^5`, lowercase letters only (so `#` cannot collide).

**Hint.** The output length is always odd: `2n + 1`. Even indices hold `#`, odd indices hold characters of `s`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func transform(s string) string {
	// TODO: insert '#' between every char and at both ends
	_ = strings.Builder{}
	return ""
}

func main() {
	r := bufio.NewReader(os.Stdin)
	var s string
	fmt.Fscan(r, &s)
	fmt.Println(transform(s))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static String transform(String s) {
        // TODO
        return "";
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.hasNext() ? sc.next() : "";
        System.out.println(transform(s));
    }
}
```

**Starter — Python.**
```python
import sys


def transform(s):
    # TODO: return "#" + "#".join(s) + "#"
    return ""


def main():
    s = sys.stdin.readline().strip()
    print(transform(s))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output length is exactly `2|s| + 1`.
- `transform("")` returns `"#"`.
- Even positions are `#`, odd positions are the original characters.

---

### Task 2 — Compute the radius array

**Problem.** Implement `manacher(s)` returning the radius array `p[]` over the transformed string. Use the box `[l, r]` and the capped mirror initialization.

**Input / Output spec.**
- Read `s`.
- Print `p[0], …, p[2n]` space-separated.

**Constraints.** `0 ≤ |s| ≤ 10^5`.

**Hint.** Core loop: `if i < r: p[i] = min(r-i, p[2*c-i])`, then expand while `t[i-p[i]-1] == t[i+p[i]+1]`, then update `c, r` if `i + p[i] > r`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_radii(s):
    t = "#" + "#".join(s) + "#"
    n = len(t)
    p = [0] * n
    for i in range(n):
        rad = 0
        while i - rad - 1 >= 0 and i + rad + 1 < n and t[i - rad - 1] == t[i + rad + 1]:
            rad += 1
        p[i] = rad
    return p
```

**Evaluation criteria.**
- Matches `brute_radii` on random small strings.
- `O(n)` (no nested re-scan; expansions amortized).
- Handles `s = ""` (returns `[0]`).

---

### Task 3 — Longest palindromic substring

**Problem.** Given `s`, output the longest palindromic substring (any one on ties). Use the radius array.

**Input / Output spec.**
- Read `s`. Print the longest palindrome.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Find `argmax p[i]`; length `= p[i]`, start `= (i - p[i]) / 2`, slice `s[start:start+length]`.

**Worked check.** `"babad"` → `"bab"` or `"aba"`; `"cbbd"` → `"bb"`; `"forgeeksskeegfor"` → `"geeksskeeg"`.

**Evaluation criteria.**
- Returns a substring of `s` that is an actual palindrome of maximal length.
- Matches the center-expansion oracle's *length* on random strings.
- Runs in `O(n)`; handles `"aaaa…"` without quadratic blowup.

---

### Task 4 — Count all palindromic substrings

**Problem.** Given `s`, output the number of palindromic substrings counting each occurrence (LeetCode 647). This is `Σ ⌈p[i] / 2⌉`.

**Input / Output spec.**
- Read `s`. Print the count.

**Constraints.** `1 ≤ |s| ≤ 10^6`. Use a 64-bit accumulator.

**Hint.** Each center contributes `(p[i] + 1) // 2`. For `"aaa"` the answer is 6; for `"abc"` it is 3.

**Reference oracle (Python).**
```python
def brute_count(s):
    n = len(s)
    total = 0
    for a in range(n):
        for b in range(a, n):
            w = s[a:b + 1]
            if w == w[::-1]:
                total += 1
    return total
```

**Evaluation criteria.**
- Matches `brute_count` for `|s| ≤ 200`.
- `"aaa" → 6`, `"abc" → 3`.
- 64-bit accumulation (no overflow on `"a" * 100000`).

---

### Task 5 — Per-center odd-palindrome length

**Problem.** For each original index `i`, output the length of the longest **odd** palindrome centered at `s[i]`. This is `p[2i + 1]` from the radius array.

**Input / Output spec.**
- Read `s`. Print `len[0], …, len[n-1]` space-separated.

**Constraints.** `1 ≤ |s| ≤ 10^5`.

**Hint.** Real characters sit at odd transformed indices `2i + 1`; their `p[]` value is the odd-palindrome length centered there (always odd).

**Worked check.** `"racecar"` → `[1, 1, 1, 7, 1, 1, 1]` (the whole string is centered at index 3).

**Evaluation criteria.**
- Every output value is odd.
- Matches brute center-expansion on the odd case.
- `O(n)`.

---

## Intermediate Tasks (5)

### Task 6 — Sentinel-wrapped Manacher (no bounds checks)

**Problem.** Reimplement Manacher with `t = "^#...#$"` using two distinct sentinels so the inner expansion loop performs **no** explicit bounds check. Return the radius array (over the inner positions).

**Constraints.** `1 ≤ |s| ≤ 10^6`, lowercase letters.

**Hint.** Choose `^`, `#`, `$` all outside the alphabet. The boundary comparison fails automatically, so the `while` can be just `while t[i-p[i]-1] == t[i+p[i]+1]`.

**Evaluation criteria.**
- No index bounds checks in the inner loop.
- Radii match the plain (`#`-only) version after accounting for the leading sentinel offset.
- `O(n)`.

---

### Task 7 — Palindrome range queries

**Problem.** Given `s` and `Q` queries `(a, b)`, answer for each whether `s[a..b]` is a palindrome, using the radius array. The transformed center of `[a, b]` is `a + b + 1`; it is a palindrome iff `p[a + b + 1] ≥ b - a + 1`.

**Input / Output spec.**
- Read `s`, then `Q`, then `Q` pairs `(a, b)`.
- Print `YES`/`NO` per query.

**Constraints.** `1 ≤ |s| ≤ 10^5`, `1 ≤ Q ≤ 10^5`, `0 ≤ a ≤ b < |s|`.

**Hint.** Precompute `p[]` once in `O(n)`, then each query is `O(1)`.

**Reference oracle (Python).**
```python
def brute_is_pal(s, a, b):
    w = s[a:b + 1]
    return w == w[::-1]
```

**Evaluation criteria.**
- Matches `brute_is_pal` on all queries for small `s`.
- Precompute `O(n)`, query `O(1)`.
- Correct center formula `a + b + 1`.

---

### Task 8 — Longest palindromic prefix

**Problem.** Given `s`, output the longest palindrome that is a **prefix** of `s` (starts at index 0). Use the radius array.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Scan `p[]` for centers `i` with `(i - p[i]) / 2 == 0` (start at original index 0) and take the largest `p[i]`. Useful for the "shortest palindrome by prepending" trick (LeetCode 214).

**Worked check.** `"aacecaaa"` → longest palindromic prefix is `"aacecaa"` (length 7).

**Evaluation criteria.**
- Returns a palindrome that is a prefix of `s`, of maximal length.
- Matches a brute check (expand only prefixes) for small `s`.
- `O(n)`.

---

### Task 9 — Count palindromes of length at least L

**Problem.** Given `s` and a threshold `L`, count palindromic substrings of length `≥ L` (each occurrence). Derive the per-center contribution from `p[i]`.

**Constraints.** `1 ≤ |s| ≤ 10^6`, `1 ≤ L ≤ |s|`. 64-bit count.

**Hint.** Per center, the palindrome lengths are `p[i], p[i]-2, …`; keep those `≥ L`. The count is `(p[i] - L) // 2 + 1` when `p[i] ≥ L`, else 0.

**Reference oracle (Python).**
```python
def brute_count_ge(s, L):
    n = len(s)
    total = 0
    for a in range(n):
        for b in range(a, n):
            if b - a + 1 >= L:
                w = s[a:b + 1]
                if w == w[::-1]:
                    total += 1
    return total
```

**Evaluation criteria.**
- Matches `brute_count_ge` for `|s| ≤ 200`.
- `L = 1` reproduces the total count of Task 4.
- 64-bit accumulation.

---

### Task 10 — All maximal palindromes (positions and substrings)

**Problem.** Given `s`, output every center's maximal palindrome as `(start, length, substring)`, skipping empty ones (`p[i] == 0`). Demonstrates substring recovery.

**Constraints.** `1 ≤ |s| ≤ 10^4` (output can be large).

**Hint.** For transformed center `i` with `p[i] > 0`: `start = (i - p[i]) / 2`, `length = p[i]`, `substring = s[start:start+length]`.

**Worked check.** `"abba"` produces (among others) `(1, 2, "bb")` and `(0, 4, "abba")`.

**Evaluation criteria.**
- Every reported substring is an actual palindrome and an actual substring of `s`.
- `start` and `length` are consistent with the substring.
- Output matches a brute center-expansion enumeration of maximal palindromes.

---

## Advanced Tasks (5)

### Task 11 — Unicode-correct Manacher (code points)

**Problem.** Implement Manacher over **code points** (runes), not bytes, so multibyte characters are not split. Return the longest palindromic substring for arbitrary Unicode input.

**Constraints.** `1 ≤ |s| ≤ 10^5` code points; input may contain non-ASCII.

**Hint.** Go: `[]rune(s)`. Java: `s.codePoints().toArray()` (surrogate-safe). Python: `str` is already code points. Map runes to an int array, run Manacher over ints with a negative sentinel.

**Evaluation criteria.**
- `"été"`-style inputs are handled per character, not per byte.
- Recovered substring is built from the same code-point units (no split characters).
- Matches an ASCII run when the input is ASCII.

---

### Task 12 — Two-array Manacher (no transform)

**Problem.** Implement Manacher *without* building `t`: maintain `d1[i]` (odd palindrome radius at `i`) and `d2[i]` (even palindrome radius centered between `i-1` and `i`) directly on `s`. Halves the working memory.

**Constraints.** `1 ≤ |s| ≤ 10^7`.

**Hint.** Two near-identical passes with their own box pointers. `d1` and `d2` are exactly the odd/even slices of the transformed `p[]`. Recompute the longest palindrome from `d1`/`d2` and verify it equals the transform-based answer.

**Evaluation criteria.**
- No transformed string `t` is allocated.
- Longest-palindrome length matches the transform-based implementation.
- Memory use is ~half the transform version (one array of length `n`, not `2n+1`).

---

### Task 13 — Palindromic substring count, distinct vs all

**Problem.** For a string `s`, output **both** the count of all palindromic-substring occurrences (Manacher, `Σ⌈p/2⌉`) and the count of **distinct** palindromic substrings. For the distinct count you must NOT use Manacher's `p[]` alone — implement (or describe and implement) a hashing-based or eertree-based deduplication.

**Constraints.** `1 ≤ |s| ≤ 10^5`.

**Hint.** Manacher gives the all-occurrence count for free. For distinct, collect each maximal palindrome's nested set into a hash set (small inputs) or build an eertree (sibling `14`) and count `#nodes - 2`. Compare the two numbers; for `"aaa"` they are 6 and 3.

**Evaluation criteria.**
- All-occurrence count matches Task 4.
- Distinct count matches a brute set-of-substrings enumeration for `|s| ≤ 300`.
- The writeup explicitly notes that Manacher alone cannot give distinct counts.

---

### Task 14 — Shortest palindrome by prepending (LeetCode 214)

**Problem.** Given `s`, find the shortest palindrome you can form by prepending characters to the front of `s`. Use the longest palindromic *prefix* from Manacher.

**Constraints.** `1 ≤ |s| ≤ 10^5`.

**Hint.** Let `L` be the length of the longest palindromic prefix of `s` (Task 8). The answer is `reverse(s[L:]) + s`. Verify the result is a palindrome and contains `s` as a suffix.

**Worked check.** `"aacecaaa"` → `"aaacecaaa"`; `"abcd"` → `"dcbabcd"`.

**Evaluation criteria.**
- Output is a palindrome with `s` as a suffix.
- Output is the shortest such palindrome.
- Uses the Manacher palindromic-prefix length, not an `O(n²)` scan.

---

### Task 15 — Decide the right palindrome tool

**Problem.** Given a problem statement summarized as `(query_type, needs_distinct, needs_range, online)`, implement `classify(...)` returning one of: `MANACHER`, `EERTREE`, `HASHING`, `CENTER_EXPANSION`, or `DP_SUBSEQUENCE`. Justify each.

**Constraints / cases to handle.**
- Longest palindrome / all-occurrence count, large `n` → `MANACHER`.
- Distinct palindromes / per-prefix distinct count / online → `EERTREE`.
- Arbitrary "is `s[a..b]` a palindrome?" or approximate → `HASHING`.
- Tiny input, simplest code → `CENTER_EXPANSION`.
- Palindromic **subsequence** (non-contiguous) → `DP_SUBSEQUENCE` (a different `O(n²)` DP).

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The `DP_SUBSEQUENCE` case is the trap: subsequence palindromes are NOT what Manacher solves.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `EERTREE` branch cites the all-vs-distinct distinction.
- The `DP_SUBSEQUENCE` branch cites substring-vs-subsequence.
- Justification references the right complexity (`O(n)`, `O(n)`, `O(1)`/query, `O(n²)`).

---

## Benchmark Task

### Task B — Center expansion vs Manacher crossover

**Problem.** Empirically compare the `O(n²)` center-expansion baseline against `O(n)` Manacher for the longest-palindrome problem on two input families:

- **(a) Random strings** over a small alphabet (where center expansion rarely expands far).
- **(b) Repetitive strings** `"a" * n` (the worst case for center expansion).

Measure wall-clock time for both algorithms across `n ∈ {10^3, 10^4, 10^5, 10^6}` (use Manacher only for the largest sizes on family (b)). Report a table and identify where Manacher decisively wins.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_random(n: int, seed: int) -> str:
    r = random.Random(seed)
    return "".join(r.choice("ab") for _ in range(n))


def gen_repeat(n: int) -> str:
    return "a" * n


def center_expansion(s: str) -> int:
    # TODO: O(n^2) longest-palindrome length
    return 0


def manacher_len(s: str) -> int:
    # TODO: O(n) longest-palindrome length via radius array
    return 0


def bench(fn, s) -> float:
    start = time.perf_counter()
    fn(s)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("family      n          center_ms     manacher_ms")
    for fam, gen in (("random", lambda n: gen_random(n, 42)),
                     ("repeat", gen_repeat)):
        for n in [1_000, 10_000, 100_000, 1_000_000]:
            s = gen(n)
            mb = [bench(manacher_len, s) for _ in range(3)]
            if n <= 100_000:  # center expansion too slow beyond this on repeats
                ce = [bench(center_expansion, s) for _ in range(3)]
                print(f"{fam:<11} {n:<10} {mean_ms(ce):<13.2f} {mean_ms(mb):<.2f}")
            else:
                print(f"{fam:<11} {n:<10} {'(skipped)':<13} {mean_ms(mb):<.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same random graph/string across Go, Java, and Python.
- On family (b) (`"a"*n`), center expansion is quadratic and Manacher stays linear — the gap explodes with `n`.
- Manacher completes `n = 10^6` in well under a second; center expansion is infeasible on the repetitive family there.
- Report includes the mean across at least 3 runs and does not time string generation.
- Writeup: a short note on the measured crossover and why repetitive inputs are center expansion's worst case.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every counting/longest task above ships with (or references) a slow center-expansion oracle. Run it on small `n`, diff, and only then trust Manacher on large `n`.
- **Cap the mirror copy.** The single most important line is `p[i] = min(r - i, p[2*c - i])`. Dropping the cap passes many random tests but fails on overlapping palindromes.
- **Pin the recovery formula.** Original `start = (center - radius) / 2`, `length = radius`. Verify it on `"abba"` in a test.
- **Get `s == ""` right.** The transform of the empty string is `"#"`; `p = [0]`; the longest palindrome is `""`.
- **Mind overflow.** The all-occurrence count is `Θ(n²)` in magnitude — accumulate in 64-bit.
- **Handle Unicode** when the input is not guaranteed ASCII: run over code points, not bytes (Task 11).
- **Never use Manacher for distinct counts or subsequence palindromes.** Distinct → eertree (sibling `14`); subsequence → a separate `O(n²)` DP.
- **Reuse the core scan.** Most bugs live in the radius computation; write it once, test it hard, and read `p[]` for every downstream query.
- **Update the box every iteration.** After the expansion loop, `if i + p[i] > r: c, r = i, i + p[i]`. Forgetting this leaves a stale box that corrupts later mirror copies.
- **Use sentinels in production code.** Wrapping `t` with `^ … $` removes the inner-loop bounds checks and a class of off-by-one bugs.

## The Core Scan Reference (all three languages)

Every task above builds on the same radius-array computation. Keep this reference handy and parameterize the rest.

**Python.**
```python
def manacher(s):
    t = "#" + "#".join(s) + "#"
    n = len(t)
    p = [0] * n
    c = r = 0
    for i in range(n):
        if i < r:
            p[i] = min(r - i, p[2 * c - i])
        while (i - p[i] - 1 >= 0 and i + p[i] + 1 < n
               and t[i - p[i] - 1] == t[i + p[i] + 1]):
            p[i] += 1
        if i + p[i] > r:
            c, r = i, i + p[i]
    return p, t
```

**Go.**
```go
func manacher(s string) []int {
	t := "#"
	for i := 0; i < len(s); i++ {
		t += string(s[i]) + "#"
	}
	n := len(t)
	p := make([]int, n)
	c, r := 0, 0
	for i := 0; i < n; i++ {
		if i < r {
			if m := 2*c - i; r-i < p[m] {
				p[i] = r - i
			} else {
				p[i] = p[m]
			}
		}
		for i-p[i]-1 >= 0 && i+p[i]+1 < n && t[i-p[i]-1] == t[i+p[i]+1] {
			p[i]++
		}
		if i+p[i] > r {
			c, r = i, i+p[i]
		}
	}
	return p
}
```

**Java.**
```java
static int[] manacher(String s) {
    StringBuilder b = new StringBuilder("#");
    for (int i = 0; i < s.length(); i++) b.append(s.charAt(i)).append('#');
    char[] t = b.toString().toCharArray();
    int n = t.length;
    int[] p = new int[n];
    int c = 0, r = 0;
    for (int i = 0; i < n; i++) {
        if (i < r) p[i] = Math.min(r - i, p[2 * c - i]);
        while (i - p[i] - 1 >= 0 && i + p[i] + 1 < n
                && t[i - p[i] - 1] == t[i + p[i] + 1]) p[i]++;
        if (i + p[i] > r) { c = i; r = i + p[i]; }
    }
    return p;
}
```

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
