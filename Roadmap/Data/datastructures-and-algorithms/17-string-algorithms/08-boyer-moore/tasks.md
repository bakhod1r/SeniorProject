# Boyer-Moore String Matching — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Boyer-Moore logic (right-to-left scan, bad-character and/or good-suffix shifts) and validate against the evaluation criteria.
> **Always test against a naive `O(nm)` search oracle on small inputs — especially small alphabets with dense overlaps — before trusting the Boyer-Moore result.**

---

## Beginner Tasks (5)

### Task 1 — Build the last-occurrence (bad-character) table

**Problem.** Implement `buildLast(p)` returning a size-256 array where `last[c]` is the rightmost index of byte `c` in `p`, or `-1` if `c` does not occur. This is the bad-character preprocessing step.

**Input / Output spec.**
- Read the pattern string `p`.
- Print `last[c]` for every byte value `c` that occurs in `p`, as `c index` pairs (one per line, in increasing `c`).

**Constraints.**
- `1 ≤ |p| ≤ 10^4`, byte alphabet (`σ = 256`).
- Absent characters map to `-1`.

**Hint.** Initialize all entries to `-1`, then scan `p` left to right writing `last[p[i]] = i`; the last write wins, giving the rightmost occurrence.

**Starter — Go.**
```go
package main

import "fmt"

const SIGMA = 256

func buildLast(p string) [SIGMA]int {
	// TODO: init to -1, then last[p[i]] = i for the rightmost occurrence
	var last [SIGMA]int
	return last
}

func main() {
	var p string
	fmt.Scan(&p)
	last := buildLast(p)
	for c := 0; c < SIGMA; c++ {
		if last[c] != -1 {
			fmt.Printf("%d %d\n", c, last[c])
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static final int SIGMA = 256;

    static int[] buildLast(String p) {
        // TODO
        return new int[SIGMA];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String p = sc.next();
        int[] last = buildLast(p);
        StringBuilder sb = new StringBuilder();
        for (int c = 0; c < SIGMA; c++)
            if (last[c] != -1) sb.append(c).append(' ').append(last[c]).append('\n');
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys

SIGMA = 256


def build_last(p):
    # TODO
    return [-1] * SIGMA


def main():
    p = sys.stdin.readline().strip()
    last = build_last(p)
    for c in range(SIGMA):
        if last[c] != -1:
            print(c, last[c])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- All entries default to `-1`.
- `last[c]` is the **rightmost** index of `c`, verified on a string with repeated characters (e.g. `"abcabc"` → `a:3, b:4, c:5`).
- `O(m + σ)` time.

---

### Task 2 — Bad-character-only first occurrence

**Problem.** Given text `T` and pattern `P`, return the first index where `P` occurs in `T` (or `-1`), using only the bad-character rule and a right-to-left scan. Remember to clamp the shift to at least 1.

**Input / Output spec.**
- Read `T`, then `P` (each on its own line).
- Print the first match index, or `-1`.

**Constraints.** `0 ≤ |T| ≤ 10^6`, `0 ≤ |P| ≤ 10^4`.

**Hint.** `shift = max(1, j - last[T[s+j]])`. Use `s <= n - m` so the last window is checked.

**Reference oracle (Python) — use this to validate.**
```python
def naive_first(t, p):
    n, m = len(t), len(p)
    if m == 0:
        return 0
    for s in range(n - m + 1):
        if t[s:s + m] == p:
            return s
    return -1
```

**Evaluation criteria.**
- Matches `naive_first` on random small strings.
- Clamps the shift (no infinite loop when the bad char is right of the mismatch).
- Returns `-1` when `P` is absent or `|P| > |T|`.

---

### Task 3 — Count comparisons (demonstrate sublinearity)

**Problem.** Instrument the bad-character Boyer-Moore to count the number of character comparisons performed while searching for all occurrences of `P` in `T`. Print both the comparison count and the match count.

**Input / Output spec.**
- Read `T`, then `P`.
- Print `comparisons matches` on one line.

**Constraints.** `1 ≤ |T| ≤ 10^5`, `1 ≤ |P| ≤ 100`.

**Hint.** Increment a counter inside the inner comparison loop. On large-alphabet text the count should be well below `|T|` — that is the sublinear behaviour.

**Worked check.** For `T = "the lazy dog" * 1000`, `P = "lazy"`, Boyer-Moore touches far fewer than `|T|` characters because most windows are rejected after a single right-end comparison. Compare with a naive counter to see the difference.

**Evaluation criteria.**
- Comparison count is `< |T|` on a large-alphabet text where matches are sparse.
- Match count agrees with a naive search.
- Counter wraps the actual `P[j] == T[s+j]` test.

---

### Task 4 — Empty and boundary cases

**Problem.** Make your Boyer-Moore searcher robust to boundary inputs: empty pattern, empty text, pattern longer than text, pattern equal to text, single-character pattern. Define and document the empty-pattern convention (return 0).

**Input / Output spec.**
- Read `T`, then `P`.
- Print the first match index, or `-1`.

**Constraints.** `0 ≤ |T|, |P| ≤ 10^4`.

**Hint.** Guard `m == 0` (return 0) and `m > n` (return `-1`) *before* building tables or entering the loop.

**Evaluation criteria.**
- `P = ""` returns `0`.
- `|P| > |T|` returns `-1` without indexing out of range.
- `P == T` returns `0`.
- Single-character `P` works (degenerates to a scan).

---

### Task 5 — All occurrences with overlaps

**Problem.** Return all start indices where `P` occurs in `T`, counting overlapping occurrences (e.g. `"aa"` in `"aaaa"` → `[0, 1, 2]`). Use the bad-character rule plus shift-by-1 after a match.

**Input / Output spec.**
- Read `T`, then `P`.
- Print the match indices, space-separated (empty line if none).

**Constraints.** `1 ≤ |T| ≤ 10^6`, `1 ≤ |P| ≤ 10^4`.

**Hint.** After reporting a match, advance `s` by 1 (or by `gs[0]` if you implement the good-suffix rule) so overlapping matches are not missed.

**Evaluation criteria.**
- `"aaaa"` / `"aa"` → `[0, 1, 2]`.
- Matches a naive all-occurrences oracle on random strings.
- Overlaps handled correctly.

---

## Intermediate Tasks (5)

### Task 6 — Build the good-suffix table

**Problem.** Implement `buildGoodSuffix(p)` returning the shift array such that, after a mismatch at pattern index `j`, the good-suffix shift is `gs[j+1]`, and `gs[0]` is the continue-shift after a full match. Use the two-pass border construction.

**Constraints.** `1 ≤ |p| ≤ 10^4`.

**Hint.** Pass 1 computes suffix borders and records Case 1 (re-occurrence) shifts; Pass 2 fills the rest with Case 2 (prefix-equals-suffix) shifts. Both are `O(m)`.

**Reference check (Python).**
```python
# For p = "GCAGAGAG", a correct good-suffix table makes the full searcher
# match the naive oracle on every text. Validate end-to-end, not the array
# in isolation (the indexing convention varies between references).
```

**Evaluation criteria.**
- `gs[0]` equals `m - (longest proper border length)` (e.g. `"aa"` → `gs[0] = 1`).
- Used end-to-end, the full searcher matches the naive oracle.
- `O(m)` construction.

**Starter — Python.**
```python
def build_good_suffix(p):
    m = len(p)
    border = [0] * (m + 1)
    shift = [0] * (m + 1)
    i, j = m, m + 1
    border[i] = j
    while i > 0:
        while j <= m and p[i - 1] != p[j - 1]:
            if shift[j] == 0:
                shift[j] = j - i
            j = border[j]
        i -= 1
        j -= 1
        border[i] = j
    j = border[0]
    for i in range(m + 1):
        if shift[i] == 0:
            shift[i] = j
        if i == j:
            j = border[j]
    return shift


if __name__ == "__main__":
    print(build_good_suffix("ABAB"))  # gs[0] must be 2 (m - border length 2)
```

---

### Task 7 — Full Boyer-Moore (max of both shifts)

**Problem.** Implement the full Boyer-Moore searcher combining the bad-character and good-suffix rules, taking `max(1, bc, gs)` on each mismatch and `gs[0]` after a full match. Return all occurrences.

**Constraints.** `0 ≤ |T| ≤ 10^6`, `0 ≤ |P| ≤ 10^4`.

**Hint.** `bc = j - last[T[s+j]]`; `gs = gs_table[j+1]`; `s += max(1, max(bc, gs))`.

**Reference oracle (Python).**
```python
def naive_all(t, p):
    n, m = len(t), len(p)
    if m == 0:
        return list(range(n + 1))
    return [s for s in range(n - m + 1) if t[s:s + m] == p]
```

**Evaluation criteria.**
- Matches `naive_all` on thousands of random small-alphabet strings.
- Correct overlaps via `gs[0]`.
- Larger average shift than the bad-character-only version on repeated-suffix patterns.

---

### Task 8 — Horspool variant

**Problem.** Implement the Horspool simplification (sibling `09`): a single bad-character table keyed on the text byte aligned with the pattern's **last** position, no good-suffix rule. Return the first occurrence.

**Constraints.** `0 ≤ |T| ≤ 10^6`, `1 ≤ |P| ≤ 10^4`.

**Hint.** `shift[c] = m` for all `c`, then `shift[p[i]] = m - 1 - i` for `i` in `0..m-2` (exclude the last char). On mismatch, `s += shift[T[s+m-1]]`.

**Evaluation criteria.**
- Matches the naive oracle.
- The shift table excludes the last pattern character (so `shift[p[m-1]]` reflects an interior occurrence or `m`).
- Simpler than full BM, still sublinear on large alphabets.

---

### Task 9 — Galil's rule (linear worst case)

**Problem.** Add Galil's rule to your full Boyer-Moore so that, on repetitive small-alphabet input, the total number of character comparisons is `O(n)` rather than `O(nm)`. Verify by counting comparisons on `T = "a"*N`, `P = "a"*m`.

**Constraints.** `1 ≤ |T| ≤ 10^5`, `1 ≤ |P| ≤ 10^3`, small alphabet for the worst case.

**Hint.** After a full match (and certain good-suffix shifts), remember the overlap boundary `memory` up to which the next alignment is guaranteed to match; stop the leftward scan there instead of re-comparing the overlap.

**Reference oracle.** Compare comparison counts: without Galil the count on `"a"*N` / `"a"*m` is `≈ N*m`; with Galil it is `O(N)`.

**Evaluation criteria.**
- Same match indices as the non-Galil version (correctness preserved).
- Comparison count on `"a"*N` / `"a"*m` is linear in `N`, not `N*m`.
- Documents the `memory` boundary logic in a comment.

---

### Task 10 — Case-insensitive search

**Problem.** Implement case-insensitive Boyer-Moore: matches should ignore ASCII letter case. Return all occurrences (case-insensitive) of `P` in `T`.

**Constraints.** `0 ≤ |T| ≤ 10^6`, `1 ≤ |P| ≤ 10^4`, ASCII.

**Hint.** Fold both `T` and `P` to lower case before building the table and comparing, or fold each character in the comparison and in the table keys. Report indices in the original text coordinates.

**Evaluation criteria.**
- `"Example"` is found in `"see the EXAMPLE here"`.
- Indices are in the original text's coordinate space.
- Matches a naive case-insensitive oracle.

---

## Advanced Tasks (5)

### Task 11 — UTF-8 byte-level search

**Problem.** Search for a (possibly multi-byte) UTF-8 pattern in UTF-8 text by running Boyer-Moore over the raw **byte** stream (`σ = 256`). Report match offsets in bytes. Confirm matches land on code-point boundaries.

**Constraints.** `0 ≤ |T| ≤ 10^6` bytes, valid UTF-8.

**Hint.** UTF-8 is self-synchronizing: a valid multi-byte pattern can only match starting at a lead byte, so a byte-level match is automatically on a boundary. No code-point decoding needed for correctness.

**Evaluation criteria.**
- Finds a multi-byte pattern (e.g. an accented word) at the correct byte offset.
- No false match starting inside a multi-byte sequence.
- Uses a flat `[256]` bad-character table.

---

### Task 12 — Strategy dispatcher (when BM is the wrong tool)

**Problem.** Implement `search(t, p)` that picks a strategy by needle length and alphabet size: short needle (`m ≤ 2`) → stdlib/naive scan; tiny alphabet (`≤ 4` distinct symbols) → KMP or stdlib; otherwise Boyer-Moore-Horspool. Return the first occurrence. Justify each branch in comments.

**Constraints.** `0 ≤ |T| ≤ 10^6`, `0 ≤ |P| ≤ 10^4`.

**Hint.** Compute `distinct = len(set(p))`. Boyer-Moore's jumps are tiny for short needles and small alphabets, where simpler scans win.

**Evaluation criteria.**
- Correctly classifies and routes all three cases.
- All branches return the same index as a naive oracle.
- Comments cite the reason (jump size vs preprocessing cost).

---

### Task 13 — Chunked parallel search of a large file

**Problem.** Search a large text for `P` by splitting it into overlapping chunks of size `chunk + (m-1)` (overlap by `m-1` so boundary-spanning matches are not lost), running Boyer-Moore per chunk, and merging/deduping results. Simulate parallelism with goroutines/threads/processes.

**Constraints.** `|T|` up to `10^7`, `1 ≤ |P| ≤ 10^4`.

**Hint.** Chunk `i` covers `[i*chunk, i*chunk + chunk + m - 1)`. Convert local match indices to global, then dedupe at the boundaries.

**Evaluation criteria.**
- No match lost at chunk boundaries (the `m-1` overlap is correct).
- Results equal a single-threaded full search after dedupe.
- The bad-character/good-suffix tables are built once and shared read-only.

---

### Task 14 — Rarest-byte guard scan (grep-style)

**Problem.** Implement the grep optimization: pick the **rarest** byte of `P` (by a supplied or assumed frequency model), scan `T` for that guard byte's positions, and only run the right-to-left verification where the guard aligns. Return all occurrences.

**Constraints.** `0 ≤ |T| ≤ 10^7`, `1 ≤ |P| ≤ 10^4`.

**Hint.** Choose the pattern position `g` holding the rarest byte. Use the language's fast byte-find (`bytes.IndexByte` / `String.indexOf(int)` / `bytes.find`) to locate candidates of that byte, then align the window so `P[g]` sits there and verify.

**Evaluation criteria.**
- Matches the full searcher's output.
- Uses the fast byte-find primitive to skip most positions.
- Choosing a common guard byte (e.g. space) is shown to be slower — include a note.

---

### Task 15 — Worst-case benchmark and Galil verification

**Problem.** Empirically demonstrate the `O(nm)` worst case of plain Boyer-Moore and the `O(n)` behaviour with Galil's rule. Build `T = "a"*N` and `P = "a"*m`, count comparisons for both implementations across growing `N`, and report a table.

**Constraints.** `N` up to `10^5`, `m` up to `10^3`.

**Starter — Python.**
```python
def bm_plain_comparisons(t, p):
    # TODO: full BM WITHOUT Galil; count P[j]==T[s+j] tests
    return 0


def bm_galil_comparisons(t, p):
    # TODO: full BM WITH Galil's memory boundary; count comparisons
    return 0


def main():
    for N in [1000, 5000, 10000, 50000]:
        m = 100
        t = "a" * N
        p = "a" * m
        plain = bm_plain_comparisons(t, p)
        galil = bm_galil_comparisons(t, p)
        print(f"N={N:<7d} plain={plain:<12d} galil={galil:<10d} ratio={plain/max(1,galil):.1f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Plain comparison count grows like `N*m`; Galil count grows like `N`.
- Both report the same match indices.
- The reported `plain/galil` ratio grows with `m`, confirming the asymptotic gap.
- Same seed/inputs produce identical counts across Go, Java, and Python.

---

## Benchmark Task

### Task B — Boyer-Moore vs KMP vs naive crossover

**Problem.** Empirically compare Boyer-Moore (full), KMP (sibling `01`), and naive search on (a) large-alphabet random text and (b) small-alphabet repetitive text, measuring wall-clock time and characters examined for several pattern lengths.

**Starter — Python.**
```python
import random
import time

MOD = 1_000_000_007


def gen_text(n, sigma, seed):
    r = random.Random(seed)
    return "".join(chr(97 + r.randrange(sigma)) for _ in range(n))


def naive_search(t, p):
    n, m = len(t), len(p)
    return [s for s in range(n - m + 1) if t[s:s + m] == p]


def bm_search(t, p):
    # TODO: full Boyer-Moore (reuse your Task 7 implementation)
    return []


def kmp_search(t, p):
    # TODO: KMP for contrast (sibling 01-kmp)
    return []


def bench(fn, t, p):
    start = time.perf_counter()
    fn(t, p)
    return (time.perf_counter() - start) * 1000.0


def main():
    print("sigma  m     naive_ms   kmp_ms     bm_ms")
    for sigma in (4, 26):
        t = gen_text(200_000, sigma, 42)
        for m in (4, 16, 64):
            p = t[1000:1000 + m]  # guaranteed to occur
            na = bench(naive_search, t, p)
            km = bench(kmp_search, t, p)
            bm = bench(bm_search, t, p)
            print(f"{sigma:<6d} {m:<5d} {na:<10.2f} {km:<10.2f} {bm:<10.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same text across Go, Java, and Python.
- On **large alphabet + long pattern**, Boyer-Moore beats KMP and naive (sublinear, fewer characters examined).
- On **small alphabet** (`σ = 4`), KMP is competitive or better; plain BM may degrade.
- Report includes the mean across at least 3 runs and does not time text generation.
- Writeup: a short note on how alphabet size and pattern length shift the winner, tying back to the expected-shift `Θ(min(m, σ))` result.

---

## General Guidance for All Tasks

- **Always validate against the naive oracle first.** Run it on small alphabets (2-4 symbols) so overlaps and good-suffix paths are stressed, diff index lists, and only then trust Boyer-Moore on large inputs.
- **Clamp the shift to at least 1.** The bad-character shift `j - last[c]` can be `≤ 0` when the bad character is right of the mismatch; always `s += max(1, bc, gs)`.
- **Use `s <= n - m`**, not `s < n - m`, so the final window is checked.
- **Store the rightmost occurrence** in the bad-character table; overwrite during a left-to-right pass so the last write wins.
- **After a full match, shift by `gs[0]`** (not `m`) to catch overlapping occurrences.
- **Size the table to the alphabet:** flat `[256]` for bytes, hash map for Unicode (or search the UTF-8 byte stream).
- **Add Galil's rule** only when a hard `O(n)` worst case is required; for typical data the plain algorithm is already sublinear.
- **Know when BM is wrong:** short patterns and tiny alphabets favour SIMD scans or KMP — Task 12 makes this explicit.

### Suggested progression

| Stage | Tasks | What you should be able to do afterward |
|-------|-------|------------------------------------------|
| Foundations | 1, 2, 4 | Build the last-occurrence table and a correct bad-character searcher with clamped shifts and boundary handling. |
| Both rules | 5, 6, 7 | Construct the good-suffix table and combine both shifts via `max`, handling overlaps with `gs[0]`. |
| Variants | 8, 10, 11 | Implement Horspool, case-insensitive, and UTF-8 byte-level search. |
| Guarantees | 9, 15 | Add Galil's rule and demonstrate the `O(nm)` → `O(n)` improvement empirically. |
| Production | 12, 13, 14, B | Dispatch by alphabet/length, parallelize chunked search, use a rarest-byte guard, and benchmark against KMP. |

### Self-check before submitting any task

1. Does it match the naive oracle on 10,000 random small-alphabet strings (dense overlaps)?
2. Does it handle empty pattern, empty text, and `m > n` without crashing?
3. Are all shifts clamped to at least 1 (no infinite loop)?
4. Does it use `s <= n - m` (final window checked)?
5. For all-occurrences tasks, does it find overlaps (`"aa"` in `"aaaa"` → 3)?
6. Do Go, Java, and Python produce identical output on the same inputs?

### Common pitfalls these tasks deliberately exercise

- **Off-by-one in `gs` indexing** (Tasks 6, 7): after a mismatch at `j`, the good-suffix shift is `gs[j+1]`, and the post-match shift is `gs[0]`.
- **Non-positive bad-character shift** (Tasks 2, 5): when the bad character is right of the mismatch, `j - last[c] ≤ 0`; the `max(1, ·)` clamp is mandatory.
- **Missed overlaps** (Tasks 5, 7): advancing by `m` instead of `gs[0]`/1 after a match drops overlapping occurrences.
- **Worst-case blow-up** (Task 9): plain BM on `"a"*N` / `"a"*m` is `O(nm)`; Galil's rule restores `O(n)`.
- **Wrong table size for Unicode** (Task 11): a flat code-point table is absurd; search UTF-8 bytes with `σ = 256`.
- **Wrong tool for the input** (Task 12): short needles and tiny alphabets are where BM loses to SIMD/KMP.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
