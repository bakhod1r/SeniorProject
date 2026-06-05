# Boyer-Moore-Horspool (and Sunday) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Horspool/Sunday logic and validate against the evaluation criteria.
> **Always test against a brute-force naive search oracle on small inputs (especially small alphabets, where matches are frequent) before trusting the skip-based result.**

---

## Beginner Tasks (5)

### Task 1 — Build the Horspool shift table

**Problem.** Implement `buildShift(pattern)` returning a length-256 array where `shift[c] = m` by default, and for `j = 0..m-2` (excluding the last character), `shift[P[j]] = m - 1 - j`. The rightmost occurrence must win.

**Input / Output spec.**
- Read the pattern string.
- Print `shift[c]` for `c` in `{'a'..'z'}` (or for each distinct pattern char), space-separated.

**Constraints.**
- Byte/ASCII alphabet, `1 <= m <= 1000`.
- Must exclude the last character (loop `j` to `m-2`).

**Hint.** Initialize all 256 entries to `m`, then overwrite while scanning `P[0..m-2]`.

**Starter — Go.**
```go
package main

import "fmt"

func buildShift(pattern string) [256]int {
	// TODO: default m; for j=0..m-2 set shift[pattern[j]] = m-1-j
	var shift [256]int
	return shift
}

func main() {
	var p string
	fmt.Scan(&p)
	s := buildShift(p)
	fmt.Println(s['T'], s['E'], s['H'])
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int[] buildShift(String pattern) {
        // TODO
        return new int[256];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String p = sc.next();
        int[] s = buildShift(p);
        System.out.println(s['T'] + " " + s['E'] + " " + s['H']);
    }
}
```

**Starter — Python.**
```python
import sys


def build_shift(pattern):
    # TODO: default m; exclude last char
    return [len(pattern)] * 256


def main():
    p = sys.stdin.readline().strip()
    s = build_shift(p)
    print(s[ord('T')], s[ord('E')], s[ord('H')])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `buildShift("TEETH")` gives `shift['T']=1`, `shift['E']=2`, `shift['H']=5`.
- Last character is excluded (no zero entries).
- Rightmost occurrence wins for repeated characters.

---

### Task 2 — Horspool first-occurrence search

**Problem.** Given `text` and `pattern`, return the index of the first occurrence, or `-1`. Use the single shift table and a right-to-left compare, shifting by `shift[T[i+m-1]]` on match or mismatch.

**Input / Output spec.**
- Read `text`, then `pattern`.
- Print the 0-based index, or `-1`.

**Constraints.** `0 <= m <= n <= 10^6`, byte/ASCII alphabet.

**Hint.** Guard `m == 0` and `m > n`. Use `i <= n - m` for the loop.

**Reference oracle (Python) — use this to validate.**
```python
def naive_first(text, pattern):
    n, m = len(text), len(pattern)
    if m == 0:
        return 0
    for i in range(n - m + 1):
        if text[i:i + m] == pattern:
            return i
    return -1
```

**Evaluation criteria.**
- Matches `naive_first` on random small inputs.
- Handles empty pattern and `m > n`.
- Examines fewer characters than naive on large-alphabet text (instrument a counter).

---

### Task 3 — Count all occurrences (overlapping)

**Problem.** Count every occurrence (including overlapping) of `pattern` in `text` using Horspool. After a match, shift by the same `shift[T[i+m-1]]`.

**Input / Output spec.**
- Read `text`, then `pattern`.
- Print the count.

**Constraints.** `1 <= m <= n <= 10^6`.

**Hint.** Increment a counter when `j < 0`; do not reset the table between matches.

**Worked check.** `count("aaaa", "aa") = 3` (positions 0, 1, 2). `count("abxabcabcaby", "abc") = 2`.

**Evaluation criteria.**
- Correct overlapping count (`"aaaa"`/`"aa"` → 3).
- Matches a naive all-occurrences oracle for small inputs.
- Shifts after a match without skipping overlaps.

---

### Task 4 — Sunday first-occurrence search

**Problem.** Implement the Sunday variant: key the shift on the character one past the window (`T[i+m]`), include the last char in the table (`shift[P[j]] = m - j`, `j=0..m-1`), default `m+1`. Return the first match or `-1`.

**Input / Output spec.**
- Read `text`, then `pattern`.
- Print the 0-based index, or `-1`.

**Constraints.** `0 <= m <= n <= 10^6`.

**Hint.** Check `i + m < n` before reading `T[i+m]`; at the very last window there is no char past it.

**Evaluation criteria.**
- Matches the Horspool result (same positions) on all test inputs.
- Correct bounds handling at the end of the text (no out-of-bounds read).
- Default `m+1` applied for absent characters.

---

### Task 5 — Compare against the naive oracle

**Problem.** Write a randomized differential test: generate many random `(text, pattern)` pairs over a small alphabet (e.g. `{a, b}`), run both Horspool and the naive search, and assert identical first-occurrence results.

**Input / Output spec.**
- No input; run `N` random trials and print `OK` or the first failing case.

**Constraints.** `N >= 10000`, alphabet size 2-3 (to make matches frequent and edge cases dense).

**Hint.** Small alphabets stress the algorithm: short shifts, frequent matches, repeated chars. This is where bugs surface.

**Evaluation criteria.**
- Prints `OK` for `N >= 10000` trials.
- Uses a tiny alphabet so collisions/edge cases are common.
- Includes degenerate cases (empty pattern, `m > n`, `m == n`).

---

### Task 5b — Build the Sunday shift table

**Problem.** Implement `buildSunday(pattern)` returning a length-256 array where `shift[c] = m + 1` by default, and for `j = 0..m-1` (including the last character), `shift[P[j]] = m - j`. The rightmost occurrence must win. This is the table that powers the Sunday variant, and the differences from the Horspool table (Task 1) are exactly three: the loop includes the last character, the formula is `m - j` (not `m - 1 - j`), and the default is `m + 1` (not `m`).

**Input / Output spec.**
- Read the pattern string.
- Print `shift[c]` for the characters `'T'`, `'E'`, `'H'`, space-separated.

**Constraints.**
- Byte/ASCII alphabet, `1 <= m <= 1000`.
- Include the last character (loop `j` to `m-1`); the `m - j` formula keeps every entry `>= 1`, so no exclusion is needed.

**Hint.** Initialize all 256 entries to `m + 1`, then overwrite while scanning `P[0..m-1]`. Because Sunday keys on the character *past* the window, including the last character is safe (it cannot produce a zero shift the way Horspool's would).

**Starter — Go.**
```go
package main

import "fmt"

func buildSunday(pattern string) [256]int {
	m := len(pattern)
	var shift [256]int
	// TODO: default m+1; for j=0..m-1 set shift[pattern[j]] = m-j
	_ = m
	return shift
}

func main() {
	var p string
	fmt.Scan(&p)
	s := buildSunday(p)
	fmt.Println(s['T'], s['E'], s['H'])
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5b {
    static int[] buildSunday(String pattern) {
        int m = pattern.length();
        int[] shift = new int[256];
        // TODO: fill m+1; for j=0..m-1 set shift[pattern.charAt(j)] = m-j
        return shift;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String p = sc.next();
        int[] s = buildSunday(p);
        System.out.println(s['T'] + " " + s['E'] + " " + s['H']);
    }
}
```

**Starter — Python.**
```python
import sys


def build_sunday(pattern):
    m = len(pattern)
    shift = [m + 1] * 256
    # TODO: for j in range(m): shift[ord(pattern[j])] = m - j
    return shift


def main():
    p = sys.stdin.readline().strip()
    s = build_sunday(p)
    print(s[ord('T')], s[ord('E')], s[ord('H')])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `buildSunday("TEETH")` gives `shift['T']=2`, `shift['E']=3`, `shift['H']=1` (rightmost `T` at index 3 → `5-3`; rightmost `E` at index 2 → `5-2`; `H` at index 4 → `5-4`).
- Every entry is `>= 1` (no exclusion needed; the `m - j` formula guarantees it).
- Default is `m + 1` for characters absent from the pattern.

---

## Intermediate Tasks (5)

### Task 6 — Case-insensitive Horspool

**Problem.** Search case-insensitively: a match ignores ASCII letter case. Normalize the pattern when building the table and normalize each compared/looked-up text character consistently.

**Input / Output spec.**
- Read `text`, then `pattern`.
- Print the first 0-based index of a case-insensitive match, or `-1`.

**Constraints.** ASCII letters; `1 <= m <= n <= 10^6`.

**Hint.** Lowercase both the pattern (table build) and the text characters used in the compare *and* the shift lookup. Inconsistent normalization breaks the shift/compare alignment.

**Evaluation criteria.**
- `"Hello"` matches `"hello"` and `"HELLO"`.
- Shift lookup and compare use the same normalization.
- Matches a naive case-insensitive oracle for small inputs.

---

### Task 7 — Horspool over raw bytes (UTF-8 safe)

**Problem.** Implement Horspool over `bytes` so that Unicode text searched as UTF-8 bytes returns correct byte offsets. Use a `[256]` byte table.

**Input / Output spec.**
- Read a UTF-8 `text` and `pattern`.
- Print the byte offset of the first occurrence, or `-1`.

**Constraints.** Valid UTF-8; `1 <= m <= n` in bytes.

**Hint.** Encode both strings to UTF-8 and run byte-level Horspool. UTF-8 self-synchronization guarantees a byte match is a true code-point match. Mask signed bytes with `& 0xFF` in Go/Java.

**Reference oracle (Python).**
```python
def naive_bytes(text: bytes, pattern: bytes) -> int:
    n, m = len(text), len(pattern)
    for i in range(n - m + 1):
        if text[i:i + m] == pattern:
            return i
    return -1
```

**Evaluation criteria.**
- Correct byte offset for multi-byte patterns (e.g. `"café"`).
- No out-of-range table index (bytes masked to `[0, 256)`).
- Matches `naive_bytes`.

---

### Task 8 — Construct and verify the O(nm) worst case

**Problem.** Build the adversarial input `P = "a" * m`, `T = "a" * n`, run Horspool with a comparison counter, and report the total comparisons. Confirm it is `Θ(nm)` (every shift is 1, every window compares all `m` chars).

**Input / Output spec.**
- Read `n` and `m` (`m <= n`).
- Print the total character comparisons performed.

**Constraints.** `1 <= m <= n <= 5000` (keep the quadratic feasible).

**Hint.** Expect comparisons `≈ m * (n - m + 1)`. Instrument the inner loop.

**Evaluation criteria.**
- Reports comparisons close to `m * (n - m + 1)`.
- Demonstrates every shift equals 1 for this input.
- A short note explaining this is the cost of dropping the good-suffix rule.

---

### Task 9 — q-gram Horspool for a small alphabet

**Problem.** On a small alphabet (e.g. DNA `{A,C,G,T}`), implement a `q`-gram Horspool that keys the shift on the last `q` characters of the window treated as a single super-symbol (base-`sigma` encoding), restoring larger skips.

**Input / Output spec.**
- Read `q`, then `text`, then `pattern` over `{A,C,G,T}`.
- Print the first match index, or `-1`.

**Constraints.** `2 <= q <= 4`, `q <= m <= n <= 10^6`, alphabet size 4.

**Hint.** Encode the last `q` bases at positions `m-q..m-1` as a key in `[0, 4^q)`. Build a table of size `4^q` over the pattern's `q`-grams, excluding the final `q`-gram (analogous to excluding the last char). Compare against plain Horspool's larger shift table.

**Evaluation criteria.**
- Produces the same matches as plain Horspool / naive.
- Average shift is measurably larger than plain Horspool on DNA.
- Correct handling of the final-`q`-gram exclusion.

---

### Task 10 — Hybrid search with a comparison budget

**Problem.** Implement `search(text, pattern)` that runs Horspool but switches to a guaranteed-linear fallback (naive is acceptable for this task; KMP/Two-Way preferred) once the comparison count exceeds `c * n` for a constant `c` (e.g. `c = 4`). This caps the worst case.

**Input / Output spec.**
- Read `text`, then `pattern`.
- Print the first match index, or `-1`.

**Constraints.** `1 <= m <= n <= 10^6`; must remain correct on the `a^m`/`a^n` adversary.

**Hint.** Count comparisons in the hot loop. On exceeding the budget, hand off the remaining text (from the current `i`) to the fallback. Verify the fallback continues from the correct position.

**Evaluation criteria.**
- Matches plain Horspool on benign inputs.
- Stays linear-ish on `a^m`/`a^n` (comparisons bounded by `O(n)`).
- Fallback resumes from the correct offset (no missed matches).

---

### Task 10b — Last-character guard speedup

**Problem.** Implement a guarded Horspool first-occurrence search that, before entering the right-to-left inner compare, tests whether the window's last character equals the pattern's last character. Only on a hit does it run the full inner loop; otherwise it shifts immediately. Instrument a counter of how many windows enter the inner loop, and confirm the guard skips the inner loop for the vast majority of windows on large-alphabet text.

**Input / Output spec.**
- Read `text`, then `pattern`.
- Print two values: the first match index (or `-1`), and the number of windows that entered the full inner compare.

**Constraints.** `1 <= m <= n <= 10^6`, byte/ASCII alphabet.

**Hint.** The guard does not change the asymptotics — it converts the common-case window into a single comparison plus a table lookup. On a large alphabet the last-character test fails for most windows, so the inner-loop-entry counter should be far below the number of windows. Make sure the shift is still keyed on `T[i+m-1]` whether or not the guard passed.

**Starter — Go.**
```go
package main

import "fmt"

func guardedHorspool(text, p string) (int, int) {
	n, m := len(text), len(p)
	if m == 0 {
		return 0, 0
	}
	if m > n {
		return -1, 0
	}
	var shift [256]int
	for c := range shift {
		shift[c] = m
	}
	for j := 0; j < m-1; j++ {
		shift[p[j]] = m - 1 - j
	}
	last := p[m-1]
	entered := 0
	i := 0
	for i <= n-m {
		c := text[i+m-1]
		if c == last { // TODO: only then run the inner compare; count entries
			entered++
			j := m - 2
			for j >= 0 && text[i+j] == p[j] {
				j--
			}
			if j < 0 {
				return i, entered
			}
		}
		i += shift[c]
	}
	return -1, entered
}

func main() {
	fmt.Println(guardedHorspool("abxabcabcaby", "abc"))
}
```

**Starter — Java.**
```java
public class Task10b {
    static int[] guardedHorspool(String text, String p) {
        int n = text.length(), m = p.length();
        if (m == 0) return new int[]{0, 0};
        if (m > n) return new int[]{-1, 0};
        int[] shift = new int[256];
        java.util.Arrays.fill(shift, m);
        for (int j = 0; j < m - 1; j++) shift[p.charAt(j) & 0xFF] = m - 1 - j;
        char last = p.charAt(m - 1);
        int entered = 0, i = 0;
        while (i <= n - m) {
            char c = text.charAt(i + m - 1);
            if (c == last) { // TODO: guarded inner compare; count entries
                entered++;
                int j = m - 2;
                while (j >= 0 && text.charAt(i + j) == p.charAt(j)) j--;
                if (j < 0) return new int[]{i, entered};
            }
            i += shift[c & 0xFF];
        }
        return new int[]{-1, entered};
    }

    public static void main(String[] args) {
        int[] r = guardedHorspool("abxabcabcaby", "abc");
        System.out.println(r[0] + " " + r[1]);
    }
}
```

**Starter — Python.**
```python
def guarded_horspool(text, p):
    n, m = len(text), len(p)
    if m == 0:
        return 0, 0
    if m > n:
        return -1, 0
    shift = [m] * 256
    for j in range(m - 1):
        shift[ord(p[j])] = m - 1 - j
    last = p[-1]
    entered = 0
    i = 0
    while i <= n - m:
        c = text[i + m - 1]
        if c == last:                      # TODO: guarded inner compare; count entries
            entered += 1
            j = m - 2
            while j >= 0 and text[i + j] == p[j]:
                j -= 1
            if j < 0:
                return i, entered
        i += shift[ord(c)]
    return -1, entered


if __name__ == "__main__":
    print(guarded_horspool("abxabcabcaby", "abc"))
```

**Evaluation criteria.**
- Returns the same match index as plain Horspool (Task 2) on all inputs.
- On large-alphabet text the inner-loop-entry count is far below the number of windows (most windows fail the last-char guard and shift immediately).
- The shift remains keyed on `T[i+m-1]` regardless of whether the guard passed.

---

## Advanced Tasks (5)

### Task 11 — Streaming Horspool over chunks

**Problem.** Search a pattern across a text delivered in fixed-size chunks (you cannot hold the whole text in memory). Maintain a small carry-over buffer of the last `m-1` bytes so matches spanning a chunk boundary are found.

**Input / Output spec.**
- Read `pattern`, then a stream of chunks.
- Print all global (absolute) match offsets.

**Constraints.** `1 <= m <= 10^4`, chunk size `>= m`, total text up to `10^9` bytes.

**Hint.** Concatenate the carry-over (`m-1` bytes) with the new chunk, run Horspool on the join, then update the carry-over to the new last `m-1` bytes. Track a global offset for absolute positions. Be careful not to double-report boundary matches.

**Evaluation criteria.**
- Finds matches that straddle chunk boundaries.
- No double-counting at boundaries.
- Matches a single-pass Horspool over the concatenated text.

---

### Task 12 — Multi-pattern via repeated Horspool vs Aho-Corasick

**Problem.** Given `K` patterns and one text, report all occurrences of every pattern. Implement two approaches: (a) run Horspool once per pattern; (b) build an Aho-Corasick automaton. Compare timings and discuss when each wins.

**Input / Output spec.**
- Read `K`, the `K` patterns, then `text`.
- Print `(pattern_index, position)` pairs.

**Constraints.** `1 <= K <= 10^4`, total pattern length up to `10^6`, `n <= 10^7`.

**Hint.** Repeated Horspool is `O(K * search)` — fine for small `K`; Aho-Corasick is `O(n + totalPatternLen + occ)` — better for large `K`. Note Horspool does not share work across patterns.

**Evaluation criteria.**
- Both approaches report identical occurrence sets.
- Timing crossover identified (small `K` favors Horspool; large `K` favors Aho-Corasick).
- A short note on why single-pattern Horspool does not compose.

---

### Task 13 — Dispatch by pattern length

**Problem.** Implement a production-style `search` that dispatches on `m`: `m=1` uses a single-byte scan (`memchr`-like); `m<=3` uses brute force (no table build); medium `m` uses Horspool; large `m` (or a flag for untrusted input) uses a linear-worst-case algorithm.

**Input / Output spec.**
- Read `text`, `pattern`, and an `untrusted` flag.
- Print the first match index, or `-1`.

**Constraints.** `0 <= m <= n <= 10^7`.

**Hint.** Justify each threshold: the `O(sigma)` table build is wasted for tiny `m`; large/untrusted patterns need the worst-case guarantee. Measure the crossover empirically.

**Evaluation criteria.**
- Correct for all `m` including 0 and 1.
- Each branch chosen for a documented reason.
- Untrusted flag forces the linear path (no `O(nm)` risk).

---

### Task 14 — Compare Horspool, Sunday, and KMP empirically

**Problem.** On a fixed seeded text, measure comparisons-per-byte and wall-clock for Horspool, Sunday, and KMP (sibling `01`) across alphabet sizes `{2, 4, 26, 256}` and pattern lengths `{4, 16, 64}`. Produce a table and identify where each wins.

**Input / Output spec.**
- No input; print a table of (alphabet, m, algorithm, comparisons/byte, ms).

**Constraints.** `n = 10^6`, same seed across Go/Java/Python.

**Hint.** Expect Horspool/Sunday to dominate on large alphabets and longer patterns, KMP to be flat (it never skips), and Horspool/Sunday to degrade toward KMP on small alphabets. Sunday slightly ahead of Horspool on large alphabets.

**Evaluation criteria.**
- Same seed → same text across all three languages.
- Table shows the alphabet-size and pattern-length trends.
- Writeup: where Horspool beats KMP and where it does not.

---

### Task 15 — Decide when Horspool is the wrong tool

**Problem.** Implement `classify(m, sigma, untrusted, num_patterns)` returning one of `MEMCHR`, `BRUTE`, `HORSPOOL`, `SUNDAY`, `QGRAM_HORSPOOL`, `LINEAR_GUARANTEED` (KMP/Two-Way), or `AHO_CORASICK`, with a justification for each decision.

**Constraints / cases to handle.**
- `m == 1` → `MEMCHR`.
- `m <= 3` → `BRUTE` (skip the table build).
- Medium `m`, large `sigma`, trusted, single pattern → `HORSPOOL` (or `SUNDAY`).
- Small `sigma` (DNA) → `QGRAM_HORSPOOL` (or `LINEAR_GUARANTEED`).
- `untrusted` true → `LINEAR_GUARANTEED` (defend `O(nm)`).
- `num_patterns` large → `AHO_CORASICK`.

**Hint.** Encode the dispatch rules from `senior.md`. The trap cases are untrusted input (DoS risk) and small alphabets (skips collapse).

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The `LINEAR_GUARANTEED` branch cites the `O(nm)` DoS risk on untrusted input.
- Justification references the right complexity (`O(m+sigma)` preprocess, `O(nm)` worst, `Θ(n/m)` average).

---

### Task 15b — Verify the zero-shift invariant on every table

**Problem.** Write a `validateTable` routine that, given any shift table (Horspool dense, Sunday dense, or `q`-gram map), asserts the **zero-shift invariant**: every entry that the search will ever look up is `>= 1`. Then build deliberately-buggy tables (Horspool that wrongly *includes* the last character; a `q`-gram table that wrongly *includes* the final `q`-gram) and confirm the validator catches each one *at construction time*, before any search hangs.

**Input / Output spec.**
- No input. Build one correct and one buggy table of each kind, run `validateTable`, and print `PASS`/`FAIL` per table with the offending key on failure.

**Constraints.** Cover Horspool, Sunday, and at least one `q`-gram (`q = 2..4`) table. The buggy variants must reproduce the real off-by-one bugs from `senior.md` Section 9.2 and 9.12.

**Hint.** For a *dense* byte table, the invariant is `min(table) >= 1`. For a *map* table, it is `all(v >= 1 for v in table.values())` — but you must also ensure the lookup default (the value used on a miss) is `>= 1`. The buggy Horspool sets `shift[P[m-1]] = 0` when the last character is unique; the buggy `q`-gram sets `shift[final q-gram] = 0`. This single post-build assertion is the cheapest possible guard against the most common infinite-loop bug in the whole topic.

**Starter — Go.**
```go
package main

import "fmt"

func validateDense(shift [256]int) (bool, int) {
	for c, v := range shift {
		if v < 1 { // TODO: zero-shift invariant violated
			return false, c
		}
	}
	return true, -1
}

// buggyHorspool INCLUDES the last char (the real bug) -> may produce shift 0.
func buggyHorspool(p string) [256]int {
	m := len(p)
	var s [256]int
	for c := range s {
		s[c] = m
	}
	for j := 0; j < m; j++ { // BUG: should be j < m-1
		s[p[j]] = m - 1 - j
	}
	return s
}

func main() {
	ok, c := validateDense(buggyHorspool("abcd")) // last char 'd' unique -> shift 0
	fmt.Println(ok, c)                            // expect: false, 'd'
}
```

**Starter — Java.**
```java
public class Task15b {
    static int[] validateDense(int[] shift) { // returns {okFlag, offendingKey}
        for (int c = 0; c < shift.length; c++) {
            if (shift[c] < 1) return new int[]{0, c}; // TODO: invariant violated
        }
        return new int[]{1, -1};
    }

    static int[] buggyHorspool(String p) {
        int m = p.length();
        int[] s = new int[256];
        java.util.Arrays.fill(s, m);
        for (int j = 0; j < m; j++) s[p.charAt(j) & 0xFF] = m - 1 - j; // BUG: j < m-1
        return s;
    }

    public static void main(String[] args) {
        int[] r = validateDense(buggyHorspool("abcd"));
        System.out.println((r[0] == 1) + " " + r[1]); // expect: false 100 ('d')
    }
}
```

**Starter — Python.**
```python
def validate_dense(shift):
    for c, v in enumerate(shift):
        if v < 1:                       # TODO: zero-shift invariant violated
            return False, c
    return True, -1


def validate_map(table, default):
    if default < 1:
        return False, "default"
    for k, v in table.items():
        if v < 1:
            return False, k
    return True, None


def buggy_horspool(p):
    m = len(p)
    s = [m] * 256
    for j in range(m):                  # BUG: should be range(m-1)
        s[ord(p[j])] = m - 1 - j
    return s


if __name__ == "__main__":
    ok, c = validate_dense(buggy_horspool("abcd"))  # unique last char -> shift 0
    print(ok, chr(c) if c >= 0 else None)           # expect: False d
```

**Evaluation criteria.**
- `validateTable` returns `True` for correctly built Horspool, Sunday, and `q`-gram tables.
- It returns `False` with the offending key for the buggy include-the-last-char Horspool and include-the-final-`q`-gram `q`-gram tables.
- The map validator also checks the lookup default (`m` for Horspool, `m + 1` for Sunday) is `>= 1`.
- The validator runs at construction time, turning a runtime infinite loop into a build-time failure.

---

## Benchmark Task

### Task B — Horspool vs naive crossover by alphabet size

**Problem.** Empirically measure how Horspool's advantage over naive search depends on alphabet size. On a fixed seeded text of length `n`, search a pattern of length `m` and report comparisons-per-byte for both naive and Horspool, across alphabet sizes `{2, 4, 10, 26, 256}`.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_text(n: int, sigma: int, seed: int) -> str:
    r = random.Random(seed)
    alphabet = "".join(chr(ord('a') + i) for i in range(min(sigma, 26)))
    if sigma > 26:
        alphabet = "".join(chr(i) for i in range(sigma))
    return "".join(r.choice(alphabet) for _ in range(n))


def naive_count_compares(text, pattern) -> int:
    n, m = len(text), len(pattern)
    cmps = 0
    for i in range(n - m + 1):
        j = 0
        while j < m and text[i + j] == pattern[j]:
            j += 1
            cmps += 1
        cmps += 1
    return cmps


def horspool_count_compares(text, pattern) -> int:
    # TODO: run Horspool, counting every character comparison
    return 0


def main() -> None:
    n, m = 200_000, 8
    print("sigma   naive_cpb   horspool_cpb")
    for sigma in [2, 4, 10, 26, 256]:
        text = gen_text(n, sigma, 42)
        pat = text[n // 2: n // 2 + m]
        nc = naive_count_compares(text, pat) / n
        hc = horspool_count_compares(text, pat) / n
        print(f"{sigma:<7d} {nc:<11.3f} {hc:<12.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same text across Go, Java, and Python.
- Horspool's comparisons-per-byte drops sharply as `sigma` grows; naive stays roughly flat.
- On `sigma = 2`, Horspool is close to naive; on `sigma = 256`, Horspool is far below `1` comparison/byte.
- Writeup: relate the measured trend to `E[shift] ≈ m(1 - (m-1)/(2 sigma))` from `professional.md`.

---

## General Guidance for All Tasks

- **Always validate against the naive oracle first.** Use a small alphabet (2-3 symbols) so matches and edge cases are frequent; diff every position and only then trust the skip-based version on large inputs.
- **Get the table build right.** Horspool **excludes** the last character (`shift[P[j]] = m-1-j`, `j=0..m-2`); Sunday **includes** it (`shift[P[j]] = m-j`, `j=0..m-1`, default `m+1`). This single line is the most common bug.
- **Guarantee a positive shift.** The exclusion (Horspool) and the `m-j` formula (Sunday) both keep shifts `>= 1`; a zero shift is an infinite loop.
- **Key on the right character.** Horspool uses `T[i+m-1]` (window-last); Sunday uses `T[i+m]` (one past the window, with a bounds check).
- **Mask signed bytes.** In Go/Java, index the table with `byte & 0xFF`; in Python use `ord(c)` and a 256-entry list.
- **Respect the worst case.** Horspool/Sunday are `O(nm)`; on untrusted input add a comparison-budget fallback to a linear algorithm. Never promise `O(n+m)`.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
