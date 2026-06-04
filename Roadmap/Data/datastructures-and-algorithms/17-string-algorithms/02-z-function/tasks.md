# The Z-Function (Z-Array) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Z-function logic and validate against the evaluation criteria.
> **Always test against a naive-Z oracle (and naive substring search) on small inputs before trusting the linear-time result.**

## How to Use These Tasks

Work the Beginner tasks first to cement the box computation and the matching trick, then the Intermediate tasks for the conversions and applications, and finally the Advanced tasks for production-grade concerns (streaming, collision-proofing, batched borders). Every counting/matching task references a naive oracle; run it on small random inputs over a 2–3 symbol alphabet before trusting your linear version on large inputs — small alphabets maximize box reuse and exercise the tricky copy/extend branches. Pin two conventions across all tasks: `r` exclusive (so the clamp is `min(r - i, z[i - l])`) and a separator that is absent from the data (or an integer sentinel for arbitrary bytes). Getting those two right eliminates the majority of bugs you will otherwise chase.

---

## Beginner Tasks (5)

### Task 1 — Build the Z-array

**Problem.** Implement `zFunction(s)` that returns the Z-array of `s` in `O(n)` using the `[l, r]` Z-box. Use `r` exclusive and the clamp `min(r - i, z[i - l])`. Set `z[0] = 0`.

**Input / Output spec.**
- Read the string `s` on one line.
- Print `z[0] z[1] … z[n-1]` space-separated.

**Constraints.**
- `0 ≤ |s| ≤ 10^6`, lowercase ASCII.
- Must be `O(n)`; no nested re-scan from index 0.

**Hint.** Seed `z[i]` with the clamped copy, then extend with a `while` loop, then grow the box when `i + z[i] > r`. The single most common bug is seeding the extend loop from `0` instead of the clamped copy — that destroys the linear bound. The second most common is the clamp polarity (`r - i` for exclusive `r`, not `r - i + 1`).

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func zFunction(s string) []int {
	// TODO: box [l, r), clamp min(r-i, z[i-l]), extend, grow box
	return nil
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	s, _ := reader.ReadString('\n')
	s = strings.TrimRight(s, "\r\n")
	z := zFunction(s)
	sb := make([]string, len(z))
	for i, v := range z {
		sb[i] = fmt.Sprint(v)
	}
	fmt.Println(strings.Join(sb, " "))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int[] zFunction(String s) {
        // TODO
        return new int[0];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.hasNextLine() ? sc.nextLine() : "";
        int[] z = zFunction(s);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < z.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(z[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def z_function(s):
    # TODO
    return []


def main():
    s = sys.stdin.readline().rstrip("\r\n")
    print(" ".join(map(str, z_function(s))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Matches a naive-Z oracle entrywise on random small strings.
- `z[0] == 0`; `0 <= z[i] <= n - i` for all `i`.
- `O(n)` (no inner restart from 0); `r` is monotonic.

---

### Task 2 — Naive-Z oracle and equivalence check

**Problem.** Implement `zNaive(s)` (the `O(n²)` definition) and a function that asserts `zFunction(s) == zNaive(s)` over many random strings over a 2–3 symbol alphabet.

**Input / Output spec.**
- No input; run an internal randomized check and print `OK` (or the failing string).

**Constraints.** Test lengths `0..40`, at least `1000` random trials.

**Hint.** Small alphabets maximize box reuse and exercise the tricky copy/extend branches — the best stress test.

**Reference oracle (Python).**
```python
def z_naive(s):
    n = len(s)
    z = [0] * n
    for i in range(1, n):
        L = 0
        while i + L < n and s[L] == s[i + L]:
            L += 1
        z[i] = L
    return z
```

**Evaluation criteria.**
- Prints `OK` for all trials, or the first counterexample.
- Uses a small alphabet to maximize coverage.
- The linear and naive versions agree on every trial.

---

### Task 3 — Substring search via Z

**Problem.** Given a pattern `p` and text `t`, print all 0-based start positions where `p` occurs in `t`, using one Z-pass over `p + sep + t`.

**Input / Output spec.**
- Read `p` on line 1, `t` on line 2.
- Print all match positions space-separated (empty line if none).

**Constraints.** `1 ≤ |p| ≤ |t| ≤ 10^6`. Choose a separator absent from both (e.g. `\x01`).

**Hint.** Report `i - (|p| + 1)` for each text-region `i` with `z[i] == |p|`. Test overlapping cases explicitly: `p = "aa"`, `t = "aaaa"` must yield `[0, 1, 2]`. A scanner that advances by `|p|` after a match would miss the overlaps — the per-index Z test does not.

**Reference oracle (Python).**
```python
def naive_find(p, t):
    m = len(p)
    return [i for i in range(len(t) - m + 1) if t[i:i + m] == p]
```

**Evaluation criteria.**
- Matches `naive_find` on random small `(p, t)`.
- Handles overlapping matches (`p="aa"`, `t="aaaa"` → `[0,1,2]`).
- `O(|p| + |t|)`; separator absence asserted.

---

### Task 4 — Detect a border of a given length

**Problem.** Given `s` and an integer `b`, print `YES` if `s` has a border of length `b` (a proper prefix that is also a proper suffix), else `NO`. Use the Z-array.

**Input / Output spec.**
- Read `s`, then `b`.
- Print `YES` or `NO`.

**Constraints.** `1 ≤ |s| ≤ 10^6`, `1 ≤ b < |s|`.

**Hint.** A border of length `b` exists iff `z[n - b] == b`.

**Evaluation criteria.**
- Correct for `s = "abcab"`, `b = 2` → `YES` (`"ab"`).
- Correct for `b = |s|` rejected (border must be proper).
- Cross-checks against the direct prefix/suffix comparison.

---

### Task 5 — Smallest period

**Problem.** Print the smallest period `p` of `s` (shortest `p` with `p | n` and `s` equal to its length-`p` prefix repeated). If `s` is primitive, print `|s|`.

**Input / Output spec.**
- Read `s`. Print the smallest period.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Smallest `p < n` with `n % p == 0` and `z[p] == n - p`; else `n`.

**Worked check.** `"abcabcabc" → 3`, `"aaaa" → 1`, `"abcd" → 4`, `"abab" → 2`.

**Evaluation criteria.**
- Matches the worked examples.
- Returns `n` for primitive strings.
- `O(n)` (one Z-pass plus a divisor scan).

---

## Intermediate Tasks (5)

### Task 6 — Count occurrences (single pass)

**Problem.** Given `p` and `t`, print the number of occurrences of `p` in `t` and the first occurrence position (or `-1`), using exactly one Z-pass.

**Constraints.** `1 ≤ |p| ≤ |t| ≤ 10^6`.

**Hint.** Tally `z[i] == m` in the text region; record the first such `i - (m+1)`.

**Evaluation criteria.**
- `p="aba", t="ababa"` → count `2`, first `0`.
- `p="xyz", t="ababa"` → count `0`, first `-1`.
- Matches a naive count for small inputs.

---

### Task 7 — Count distinct substrings via incremental Z

**Problem.** Count distinct non-empty substrings of `s`. Grow `s` one character at a time (prepending), and at each step add `currentLength - maxZ` where `maxZ` is the max Z-value of the current reversed string.

**Constraints.** `1 ≤ |s| ≤ 2000` (the algorithm is `O(n²)`).

**Hint.** Prepend the new character so that suffixes become prefixes of the growing string; recompute Z each step.

**Reference oracle (Python).**
```python
def distinct_brute(s):
    seen = set()
    for i in range(len(s)):
        for j in range(i + 1, len(s) + 1):
            seen.add(s[i:j])
    return len(seen)
# distinct_brute("abab") == 7
```

**Evaluation criteria.**
- `"aaa" → 3`, `"abab" → 7`.
- Matches `distinct_brute` for `|s| ≤ 12`.
- `O(n²)`.

---

### Task 8 — Z → prefix function conversion

**Problem.** Given the Z-array of `s`, produce the KMP prefix function `π` in `O(n)` **without re-reading `s`**.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** For each `i` with `z[i] = L`, walk `j = L-1` down to `0` setting `π[i+j] = j+1` until an already-set cell is hit. Walking *downward* (largest offset first) plus stopping at the first already-set cell is what keeps it `O(n)` and prevents overwriting a longer border with a shorter one — borders are nested, so the early-stop is safe.

**Reference (Python) — verify against a direct prefix function.**
```python
def prefix_function(s):
    n = len(s)
    pi = [0] * n
    for i in range(1, n):
        j = pi[i - 1]
        while j > 0 and s[i] != s[j]:
            j = pi[j - 1]
        if s[i] == s[j]:
            j += 1
        pi[i] = j
    return pi
```

**Evaluation criteria.**
- `z_to_prefix(z_function(s)) == prefix_function(s)` for random small `s`.
- Operates only on the index array, never on `s`.
- `O(n)` total (each `π` cell written once).

---

### Task 9 — Prefix function → Z conversion

**Problem.** Given the prefix function `π` of `s`, produce the Z-array in `O(n)` **without re-reading `s`**.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** For each `i` with `π[i] = L > 0`, seed `z[i - L + 1] = max(…, L)`; then propagate each block's partial overlaps forward (`z[i + j] = z[i] - j` until a larger value is present), skipping covered blocks with `i += z[i]`.

**Evaluation criteria.**
- `prefix_to_z(prefix_function(s)) == z_function(s)` for random small `s`.
- Operates only on the index array.
- `O(n)`.

---

### Task 10 — Compressibility test

**Problem.** Given `s`, print the compression ratio as `n / p` where `p` is the smallest exact-tiling period, i.e. how many copies of the smallest cell make up `s`. Print `1` for a primitive string.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** A buffer tiles as `n/p` copies of a length-`p` cell iff `p | n` and `z[p] == n - p`. Use the smallest such `p`.

**Evaluation criteria.**
- `"abcabcabc" → 3`, `"aaaa" → 4`, `"abcd" → 1`.
- Matches a brute-force "is `s` k copies of `s[:p]`" check.
- `O(n)`.

---

## Advanced Tasks (5)

### Task 11 — Separator-free streaming match (low memory)

**Problem.** Match `p` in `t` **without materializing** `p + sep + t`. Precompute the Z-array of `p` only (`O(|p|)` space), then scan `t` maintaining an `[l, r]` box, copying from the pattern's Z-array inside the box and extending by comparing text against pattern characters. Report all match positions.

**Constraints.** `1 ≤ |p| ≤ |t| ≤ 10^7`. Extra space must be `O(|p|)`, not `O(|t|)`.

**Hint.** Conceptually you run Z over `p + t` but keep the box in text coordinates and index `p` and `t` separately, capping the match at `|p|`. The cap is enforced by a `break` when the running length reaches `|p|` — there is no "next pattern character" to compare, which is precisely the role the separator played in the concatenation version. Verify your result is identical to the concatenation matcher on random inputs.

**Evaluation criteria.**
- Matches the concatenation-based search on random `(p, t)`.
- Extra memory is `O(|p|)` (verify no `O(|t|)` array beyond the text itself).
- `O(|p| + |t|)`; works on arbitrary bytes (no separator collision possible).

---

### Task 12 — Collision-proof matching with an integer sentinel

**Problem.** Match `p` in `t` over **arbitrary byte data** (any byte may occur) by mapping characters to integers and appending a sentinel value (`-1`) that cannot occur. Run Z over the integer array.

**Constraints.** `1 ≤ |p| ≤ |t| ≤ 10^6`, bytes in `[0, 255]`.

**Hint.** Build `int[] s = p ++ [-1] ++ t`; the sentinel is structurally outside the value range, so no real byte equals it.

**Evaluation criteria.**
- Correct even when `t` contains the byte you might otherwise have used as a separator.
- Matches naive search on random binary inputs including all-byte alphabets.
- `O(|p| + |t|)`.

---

### Task 13 — All borders of a string

**Problem.** Print the lengths of **all** borders of `s` (every proper prefix that is also a suffix), in increasing order. Use the Z-array.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** `b` is a border length iff `z[n - b] == b`. Equivalently, every `i` with `i + z[i] == n` yields border length `n - i`. Collect and sort.

**Worked check.** For `"abacaba"`, borders are lengths `1` (`"a"`) and `3` (`"aba"`).

**Evaluation criteria.**
- Matches the KMP border chain (`π[n-1], π[π[n-1]-1], …`).
- Output sorted ascending; excludes the trivial full-length "border".
- `O(n)`.

---

### Task 14 — Longest substring occurring at the start and elsewhere

**Problem.** Find the length of the longest substring of `s` that is both a prefix of `s` and occurs again at some later, non-overlapping or overlapping position. Use the Z-array.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** The answer is `max(z[i])` over `i ≥ 1` — the longest prefix that reappears starting anywhere later. Report `0` if no prefix reappears.

**Worked check.** `"aabcaab"` → `3` (`"aab"` reappears at index 4); `"abcdef"` → `0`.

**Evaluation criteria.**
- Returns the max Z-value over `i ≥ 1`.
- `0` when no prefix reappears.
- Cross-checks against a brute-force longest-repeated-prefix scan for small `s`.

---

### Task 15 — Decide whether the Z-function is the right tool

**Problem.** Given a problem description with parameters `(num_patterns, num_queries, text_fixed, match_type)`, implement `classify(...)` returning one of: `Z_OR_KMP`, `AHO_CORASICK`, `SUFFIX_STRUCTURE`, `EDIT_DISTANCE`, or `Z_PERIOD`. Justify each.

**Constraints / cases to handle.**
- Single pattern, single exact search, varying text → `Z_OR_KMP`.
- Many patterns at once → `AHO_CORASICK` (sibling `05`).
- Many queries on a fixed text / arbitrary substring compares → `SUFFIX_STRUCTURE` (siblings `04`/`12`).
- Approximate / fuzzy matching → `EDIT_DISTANCE` (sibling `06`).
- Period / border / compressibility of one string → `Z_PERIOD`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is using Z for many-query or many-pattern workloads where a preprocessed structure dominates.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- Justification references the right complexity (`O(n+m)`, `O(total + matches)`, `O(m log n)`, etc.).
- Notes that Z is exact, single-pattern, prefix-oriented.

---

## Benchmark Task

### Task B — Naive Z vs Box Z crossover

**Problem.** Empirically show where the box Z-function beats the naive `O(n²)` Z. Implement both and time them on three string families at increasing lengths:

- **(a) random** over a 26-letter alphabet (mismatches come fast),
- **(b) all-identical** (`"aaaa…a"` — naive worst case),
- **(c) periodic** (`"abab…"`).

Measure wall-clock time for `n ∈ {100, 1000, 10^4, 10^5}` (skip naive for the largest on families (b)/(c)). Report a table and identify where naive becomes infeasible.

**Starter — Python.**
```python
import random
import time


def z_naive(s):
    n = len(s)
    z = [0] * n
    for i in range(1, n):
        L = 0
        while i + L < n and s[L] == s[i + L]:
            L += 1
        z[i] = L
    return z


def z_box(s):
    # TODO: linear box version
    return [0] * len(s)


def gen(kind, n, seed=1):
    r = random.Random(seed)
    if kind == "random":
        return "".join(r.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(n))
    if kind == "same":
        return "a" * n
    if kind == "periodic":
        return ("ab" * ((n // 2) + 1))[:n]
    raise ValueError(kind)


def bench(fn, s):
    start = time.perf_counter()
    fn(s)
    return (time.perf_counter() - start) * 1000.0


def main():
    print("kind      n       naive_ms    box_ms")
    for kind in ["random", "same", "periodic"]:
        for n in [100, 1000, 10_000, 100_000]:
            s = gen(kind, n)
            b = bench(z_box, s)
            if kind == "random" or n <= 10_000:
                a = bench(z_naive, s)
                print(f"{kind:<9} {n:<7} {a:<11.2f} {b:<10.2f}")
            else:
                print(f"{kind:<9} {n:<7} {'(skipped)':<11} {b:<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same strings across Go, Java, and Python.
- On the **random** family, naive and box are both near-linear (mismatches end the inner loop quickly).
- On **all-identical** and **periodic**, naive blows up quadratically while box stays linear — report the `n` where naive becomes infeasible.
- Report the mean across at least 3 runs and do not time string generation.
- Writeup: a short note explaining why the box version stays linear (the monotone `r` pointer) on the repetitive families.

---

## General Guidance for All Tasks

- **Always validate against the naive-Z oracle first.** Compare entrywise on small random strings over a tiny alphabet before trusting the box version on large inputs.
- **Pick one `r` convention and one separator policy as named constants.** Exclusive `r` → clamp `min(r - i, z[i - l])`. For matching, use a separator absent from the data, or an integer sentinel for arbitrary bytes.
- **Get `z[0]` right.** By convention `z[0] = 0`; downstream code (borders, periods, matching) relies on it.
- **Seed the extend loop with the clamped copy, not 0.** Restarting from `0` destroys the `O(n)` guarantee on repetitive inputs.
- **Grow the box.** Update `l, r` whenever `i + z[i] > r`; forgetting this degrades the algorithm toward `O(n²)`.
- **Mind boundaries.** Guard `i + z[i] < n` before comparing; handle empty pattern/text explicitly.
- **Use Z for exact single-pattern / prefix tasks.** For many patterns, many queries on a fixed text, or fuzzy matching, prefer Aho-Corasick, suffix structures, or edit distance respectively (Task 15).
- **Build one `z_function`, reuse it.** Every task above should call a single, well-tested Z routine; never re-implement the box loop inside each task.
- **Add a comparison-count assertion** for any hand-rolled Z: the total comparisons must stay `≤ 2·len(s)`. This catches the "extend from 0" and "forgot to grow the box" regressions instantly on repetitive inputs.
- **Run differential tests across the three languages** on seeded inputs; divergence pinpoints a language-specific bug (signedness, `char` vs `byte`, Java UTF-16 surrogates).
- **Test the degenerate families explicitly:** `a^n` (all same), `(ab)^n` (periodic), `a^n b` (one trailing mismatch), and the empty string. These pin both correctness and the linear bound.

## Self-Assessment Rubric

After completing a tier, you should be able to answer these without looking:

- **Beginner:** Why does `r` only move forward? What does the `min(r - i, z[i - l])` clamp prevent? Why is a separator needed for matching, and what value is safe? How do you read a border off the Z-array?
- **Intermediate:** How do the Z ↔ prefix-function conversions work without re-reading the string, and why are they `O(n)`? What is the difference between "has period `p`" and "tiles exactly into period-`p` cells"? How does incremental Z count distinct substrings?
- **Advanced:** How does the separator-free streaming matcher achieve `O(m)` space? Why is an integer sentinel collision-proof where a character separator is not? How do you carry box state across streamed chunks? When is a suffix structure the right tool instead of Z?

If any answer is shaky, revisit the corresponding worked example in `junior.md`, `middle.md`, `senior.md`, or `professional.md` before moving on.

## Common Pitfalls Across Tasks

1. **Clamp polarity.** Mixing inclusive and exclusive `r` reads one unverified character. Pick exclusive `r` and the `min(r - i, z[i - l])` clamp everywhere.
2. **Separator collision.** A separator present in the data silently corrupts matches. Assert absence or use an integer sentinel.
3. **Seeding the extend loop from 0.** Re-comparing from the prefix start instead of the clamped copy turns `O(n)` into `O(n²)` on repetitive inputs.
4. **Forgetting to grow the box.** Without the `i + z[i] > r` update, later positions lose reuse and the run degrades.
5. **Byte vs character indices.** For non-ASCII, decide whether positions are byte or code-point offsets and be consistent.
6. **Empty inputs.** Handle empty pattern/text explicitly; decide the empty-pattern convention and document it.
7. **`int32` boundary.** For very large inputs, ensure the index type holds the concatenation length (or stream without it).
8. **Stale buffer reuse.** If you reuse a `z` buffer across calls, overwrite every index for the current length; never read stale entries from a previous longer run.
9. **Overlapping vs non-overlapping matches.** The Z matcher reports overlapping occurrences natively; do not advance the scan pointer by `m` after a hit (that drops overlaps).

## A Worked Reference: Z-array of "aabxaayaab"

Use this as a hand-checkable anchor while implementing Task 1:

```
index : 0 1 2 3 4 5 6 7 8 9
char  : a a b x a a y a a b
z     : 0 1 0 0 2 1 0 3 1 0
```

Trace the box: it jumps to `[1,2)` at i=1, `[4,6)` at i=4, and `[7,10)` at i=7; positions 5, 8, 9 are resolved by copying (inside the box) rather than from-scratch comparison. If your implementation produces this exact array, the box logic is almost certainly correct; if any entry differs, compare against the naive oracle to localize the bug.

## A Worked Reference: Matching "ab" in "ababa"

For Tasks 3 and 6, the concatenation `s = "ab#ababa"` gives:

```
index : 0 1 2 3 4 5 6 7
char  : a b # a b a b a
z     : 0 0 0 2 0 2 0 1
```

Text-region hits (`z[i] == 2`) are at `i = 3` and `i = 5`, mapping to text positions `0` and `2`. The non-hit `z[7] = 1` correctly rejects the trailing partial overlap. Reproduce this and your matcher's offset arithmetic (`i - (m+1)`) is verified.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
