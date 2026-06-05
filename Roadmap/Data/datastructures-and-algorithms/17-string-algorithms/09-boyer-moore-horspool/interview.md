# Boyer-Moore-Horspool — Interview Preparation

Horspool is a favourite interview topic because it rewards one crisp insight — *"keep only the bad-character shift keyed on the text char aligned with the pattern's last position, drop the good-suffix rule"* — and then tests whether you can (a) build the single shift table correctly (excluding the last char), (b) write the uniform match/mismatch loop, (c) recognize the Sunday variant's bigger jump, (d) reason about the `O(nm)` worst case vs the sub-linear average, and (e) contrast it cleanly with full Boyer-Moore (sibling `08`) and KMP (sibling `01`). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Build the Horspool shift table | exclude last char; default `m` | `O(m + sigma)` |
| Shift on match or mismatch | `shift[T[i + m - 1]]` (window-last char) | `O(1)` per step |
| Compare direction | right-to-left from `j = m-1` | — |
| Search (average, large alphabet) | sub-linear in comparisons | `Θ(n/m)`-ish |
| Search (worst case) | `P=a^m`, `T=a^n` | `O(nm)` |
| Sunday shift key | char *past* window `T[i + m]`, default `m+1` | `O(1)` per step |
| Need guaranteed `O(n+m)` | KMP (`01`) or full BM with Galil (`08`) | `O(n+m)` |
| Count occurrences | shift after each match too | `O(occ)` added |

Build rules (the part people get wrong):

```text
HORSPOOL:  for j = 0..m-2:  shift[P[j]] = m - 1 - j   default m   (exclude last char)
SUNDAY:    for j = 0..m-1:  shift[P[j]] = m - j       default m+1 (include last char)
```

Core algorithm:

```text
build shift table from P
i = 0
while i <= n - m:
    j = m - 1
    while j >= 0 and T[i+j] == P[j]: j -= 1   # right-to-left
    if j < 0: report match at i
    i += shift[T[i + m - 1]]                   # SAME shift on match or mismatch
```

Key facts:
- **Drops the good-suffix rule** → tiny code, `O(nm)` worst case.
- **One `O(sigma)` table**, keyed on the window-**last** character.
- Excluding the last char guarantees `shift >= 1` (no infinite loop).
- Average case tracks full Boyer-Moore for large alphabets; degrades on small alphabets (DNA).

---

## Junior Questions (12 Q&A)

### J1. What does Horspool simplify compared to Boyer-Moore?
It keeps a single **bad-character shift** and **drops the good-suffix rule** entirely. The bad-character shift is itself simplified: it always uses the text character aligned with the pattern's **last position**, not the actual mismatched character.

### J2. Which character decides the shift?
The text character aligned with the window's **last position**, `T[i + m - 1]`. The shift is `shift[T[i + m - 1]]`, regardless of where the mismatch occurred.

### J3. How do you build the shift table?
Default every character to `m`. Then for `j = 0..m-2` (excluding the last character), set `shift[P[j]] = m - 1 - j`. Later assignments overwrite earlier ones, so the rightmost occurrence wins.

### J4. Why exclude the last character when building the table?
If you included it, `shift[P[m-1]] = m-1-(m-1) = 0`. A zero shift means the loop never advances → infinite loop. Excluding it guarantees every shift is at least `1`.

### J5. Is the shift the same on a match and a mismatch?
Yes. Both cases shift by `shift[T[i + m - 1]]`. That uniformity is why the loop body needs no special case and the code is so short.

### J6. Which direction does Horspool compare?
Right-to-left: it starts at `j = m-1` and decrements. Most windows mismatch at that last character immediately, enabling a quick shift.

### J7. What is the time complexity?
Preprocessing is `O(m + sigma)`. Average search is sub-linear in characters examined (great for large alphabets). Worst case is `O(nm)`.

### J8. What is the space complexity?
`O(sigma)` for the single shift table (e.g. 256 entries for bytes), plus `O(1)` working space.

### J9. What shift does a character absent from the pattern get?
The default `m` — you can slide the whole window past it, since it cannot align with any pattern position in the current window.

### J10. What is the worst-case input?
`P = "aaaa"` and `T = "aaaaaaaa"`: every shift is `1` and every window compares all `m` characters → `O(nm)`.

### J11. How is the Sunday variant different?
Sunday keys the shift on the character **one past** the window (`T[i + m]`) instead of the last-window char, includes the last char in the table, and can shift up to `m + 1`.

### J12 (analysis). Why is Horspool fast on average?
On a large alphabet, most windows mismatch at the last character and shift far (often by `~m`), so the number of windows is about `n/m` — far fewer than `n`.

---

## Middle Questions (12 Q&A)

### M1. Prove the shift never skips a match.
If `P` occurred at some `i'` strictly inside the skipped gap, the window-last char `c = T[i+m-1]` would align with a pattern position `ℓ ≤ m-2` where `P[ℓ] = c`. That forces `shift[c] ≤ m-1-ℓ`, contradicting the assumption that `i'` lay within `shift[c]` of `i`. So no such `i'` exists. (Full proof in `professional.md`.)

### M2. Why is the shift the same on match and mismatch, and is that correct?
The safety proof only uses `c = T[i+m-1]`, never whether the window matched. On a match we have already reported the occurrence and just need a safe non-zero advance; `shift[c]` provides exactly that. So one rule is correct in both branches.

### M3. How does Horspool differ from the full Boyer-Moore bad-character rule?
Full Boyer-Moore keys on the *actual mismatched* character and its position (a richer 2-D table). Horspool keys uniformly on the window-last character (a 1-D table). Less information, sometimes smaller shifts, but far simpler.

### M4. Build the Sunday table — what changes?
Loop the full `j = 0..m-1` (include the last char), use `shift[P[j]] = m - j`, and default to `m + 1`. The minimum value is `1` (at `j = m-1`), so no exclusion is needed.

### M5. When does Sunday beat Horspool?
Sunday's max shift is `m + 1` (vs `m`) and it looks one char beyond the window, so its average jump is slightly larger — a small throughput edge on medium patterns and large alphabets. Horspool is marginally simpler (no past-window bounds check).

### M6. Why does the average case degrade on small alphabets?
On DNA (`sigma = 4`), almost every character occurs in any longer pattern, so shifts shrink toward `1` and comparisons lengthen. The expected shift `≈ m(1 - (m-1)/(2σ))` drops as `σ` shrinks.

### M7. What is the expected shift, roughly?
For `σ ≫ m`, `E[shift] ≈ m` (jump nearly the whole pattern). The correction term `(m-1)/(2σ)` grows as `σ` shrinks, lowering the expected shift.

### M8. How do you find all occurrences, not just the first?
After reporting a match, shift by the same `shift[T[i + m - 1]]` and continue. This is safe — it never skips an overlapping occurrence.

### M9. How does Horspool compare to KMP?
KMP (sibling `01`) scans left-to-right, never skips text, and guarantees `O(n+m)`. Horspool scans right-to-left, skips text (sub-linear average), but is `O(nm)` worst case. Opposite trade-offs.

### M10. How do you handle Unicode text?
Search the **UTF-8 byte stream** with the ordinary 256-entry byte table. UTF-8 is self-synchronizing, so a byte-level match is a true code-point match. Avoid a code-point-keyed table.

### M11. What is the right table type for a huge alphabet?
A hash map keyed only on the characters that occur in the pattern, with the default (`m` or `m+1`) applied on a miss. Size is `O(distinct chars in P)`, independent of `sigma`.

### M12 (analysis). Why does dropping the good-suffix rule cause the `O(nm)` worst case?
The good-suffix rule (with Galil) remembers matched suffixes and shifts by the pattern's period, bounding the work to `O(n+m)`. Without it, Horspool re-compares the entire window each time, so adversarial all-same-char inputs force quadratic work.

---

## Senior Questions (10 Q&A)

### S1. Where are Horspool/Sunday used in real systems?
In `memmem`/`strstr`-style primitives (often as the fast common-case half of a hybrid with a linear fallback like Two-Way), editor/browser "find in page", and bulk log/signature scanning. Their appeal is the simplicity-to-speed ratio.

### S2. How do you defend against the `O(nm)` worst case on untrusted input?
Use a hybrid: run Horspool for speed but fall back to a guaranteed-linear algorithm (Two-Way or KMP) when a comparison budget (`> c·n`) is exceeded, or use a linear algorithm unconditionally on untrusted paths. Add input policy (length caps, rate limits).

### S3. How do you dispatch by pattern length?
`memchr`/byte-scan for `m=1`; a tight brute-force for `m <= 2..3` (skip the table build); Horspool/Sunday for the medium range; a linear-worst-case algorithm for large or adversarial input.

### S4. What is the rescue for small alphabets?
A `q`-gram Horspool: key the shift on the last `q` bytes treated as a single super-symbol, effectively enlarging the alphabet to `sigma^q` and restoring larger skips. Common in genomic search.

### S5. What are the recurring production bugs?
Including the last char (infinite loop), unmasked signed bytes (negative index — mask `& 0xFF`), Sunday reading `T[i+m]` past the end (out of bounds), per-call table rebuilds (latency), and code-point-keyed Unicode tables.

### S6. How do you verify correctness?
Property-test against a naive oracle over a *small* alphabet (so matches are frequent), plus targeted tests: last-char-unique pattern (infinite-loop regression), Sunday end-of-text, signed-byte inputs, and adversarial `a^m`/`a^n`. Cross-language determinism is another check.

### S7. What metrics signal trouble in production?
Average shift and comparisons-per-byte. A drop in average shift toward `1` or a spike in comparisons-per-byte indicates adversarial or small-alphabet input that should trigger the linear fallback.

### S8. Why prefer Horspool over full Boyer-Moore in a library?
Maintainability under correctness pressure: the good-suffix preprocessing is the part most likely to harbor a bug, and it adds a second table. "Horspool + Two-Way fallback" is easier to audit and just as fast in the common case.

### S9. How much memory does the table use, and how do you trim it?
`O(sigma)` — about 1 KB for an `int[256]` byte table (or use `int16[256]` if `m < 32768`). For huge alphabets use a map keyed on occurring characters; trim to `int[128]` for guaranteed-ASCII input.

### S10 (analysis). Is Horspool optimal in any sense?
Yes, on the average: its expected `Θ(n/m)` comparisons for large alphabets is within a `log_σ m` factor of Yao's comparison lower bound `Θ(n log_σ m / m)`. It is *worst-case* suboptimal (`O(nm)` vs achievable `O(n+m)`) — the deliberate design trade for simplicity.

---

## Professional Questions (8 Q&A)

### P1. Design a `memmem` replacement for a high-throughput log scanner.
Dispatch on `m`: `memchr` for `m=1`, brute for tiny `m`, Horspool/Sunday for medium, and Two-Way for large or untrusted input. Build the byte table once per pattern; search the UTF-8 byte stream. Emit average-shift and comparisons-per-byte metrics; fall back to Two-Way if the budget is exceeded. Cap pattern length on untrusted APIs.

### P2. The input is DNA (`sigma = 4`). Horspool is barely faster than naive. What now?
Skips collapse on small alphabets. Switch to a `q`-gram Horspool (key on the last 2-3 bases as a super-symbol over an effective `4^q` alphabet) to restore larger jumps, or use KMP/Two-Way for a guaranteed linear bound. Benchmark — the right answer is data-dependent.

### P3. How do you bound the worst case without losing average speed?
A hybrid: instrument the hot loop with a comparison counter and a budget of `O(n)`; if exceeded, switch to a guaranteed-linear algorithm (Two-Way/KMP) for the remainder. This preserves Horspool's average speed while capping worst-case CPU — the standard glibc pattern.

### P4. How do you debug "search returns not-found but the substring is present"?
A wrong shift table silently skips matches. Diff against a naive oracle on the exact input. Check the three suspects: last-char exclusion (Horspool) / inclusion (Sunday), the shift formula (`m-1-j` vs `m-j`), and the default (`m` vs `m+1`). Verify `i <= n-m` and the `& 0xFF` masking.

### P5. When is Horspool the wrong choice entirely?
When you need a guaranteed `O(n+m)` (use KMP/Two-Way/full BM), when matching many patterns at once (use Aho-Corasick/Commentz-Walter), on tiny alphabets without a `q`-gram fix, or for `m=1` (use `memchr`).

### P6. How do you make one pattern fast across many texts?
Build the shift table once and reuse it (immutable, shared); preprocessing is `O(m + sigma)` and should be amortized, not repeated per call. The search itself carries no per-call setup beyond the table reference.

### P7. How do automata-based multi-pattern matchers relate to Horspool?
For many patterns, single-pattern Horspool does not compose well. Aho-Corasick builds a trie automaton scanning left-to-right in `O(n + total pattern length + occ)`; Commentz-Walter is the Boyer-Moore-style multi-pattern analogue with bad-character skips. Horspool is the single-pattern building block.

### P8 (analysis). Why does Sunday's max shift exceed Horspool's by exactly one?
Sunday keys on the char *past* the window (`T[i+m]`), which lies one position farther right than Horspool's window-last char (`T[i+m-1]`). When that char is absent from the pattern, the window can leap entirely past it — `m + 1` — versus Horspool's `m`. The safety proofs differ only in this off-by-one in the offset bound (`professional.md`, Thms 3.1 and 7.3).

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose a simpler algorithm over a "better" one.
Look for a story where the candidate picked Horspool (or similar) over full Boyer-Moore for maintainability, measured that the average case was adequate, and *consciously* accepted the worst-case risk — ideally adding a fallback or input cap to mitigate it. Strong answers cite the correctness audit cost of the more complex option.

### B2. A teammate's Horspool hangs on certain inputs. How do you help?
Calmly diagnose the infinite loop: almost certainly the last character was included in the table, producing a zero shift. Show the fix (loop `j` to `m-2`) and add the regression test (a pattern ending in a char that appears only at the end, searched in a text of that char). Frame it as a teaching moment.

### B3. Design a "find in page" feature for an editor.
Patterns are short and human-typed; latency per keystroke matters. Use Horspool/Sunday (simple, fast common case), with case-insensitive and whole-word options layered on top. Note short-pattern special-casing (`m<=2`) and that incremental search rebuilds the small table cheaply. Mention the average-case behavior is what users feel.

### B4. How would you explain Horspool to a junior engineer?
Use the bookshelf analogy: read the last letter of the window first; if it's wrong, consult a cheat-sheet that says how far to jump based on that one letter, then leap. Emphasize the two gotchas first: exclude the last char when building the table, and it is `O(nm)` worst case (not guaranteed linear).

### B5. Your search service is being hit with slow requests. How do you investigate?
Suspect the `O(nm)` worst case from adversarial input. Check the comparisons-per-byte and average-shift metrics; a collapse confirms it. Mitigate with a linear fallback (Two-Way/KMP) triggered by a comparison budget, plus pattern-length caps and rate limiting on the untrusted API.

---

## Coding Challenges

### Challenge 1: Horspool Search (first occurrence)

**Problem.** Given `text` and `pattern`, return the index of the first occurrence of `pattern` in `text`, or `-1`. Use Boyer-Moore-Horspool.

**Example.**
```text
horspool("TRUSTHARDTEETH", "TEETH") -> 9
horspool("abcabcabc", "cab")        -> 2
horspool("hello", "xyz")            -> -1
```

**Constraints.** Byte/ASCII alphabet; `0 <= m <= n <= 10^7`.

**Optimal.** Horspool, `O(m + sigma)` preprocess, sub-linear average, `O(nm)` worst.

**Go.**
```go
package main

import "fmt"

func horspool(text, pattern string) int {
	n, m := len(text), len(pattern)
	if m == 0 {
		return 0
	}
	if m > n {
		return -1
	}
	var shift [256]int
	for c := range shift {
		shift[c] = m
	}
	for j := 0; j < m-1; j++ {
		shift[pattern[j]] = m - 1 - j
	}
	i := 0
	for i <= n-m {
		j := m - 1
		for j >= 0 && text[i+j] == pattern[j] {
			j--
		}
		if j < 0 {
			return i
		}
		i += shift[text[i+m-1]]
	}
	return -1
}

func main() {
	fmt.Println(horspool("TRUSTHARDTEETH", "TEETH")) // 9
	fmt.Println(horspool("abcabcabc", "cab"))        // 2
	fmt.Println(horspool("hello", "xyz"))            // -1
}
```

**Java.**
```java
public class HorspoolSearch {
    static int horspool(String text, String pattern) {
        int n = text.length(), m = pattern.length();
        if (m == 0) return 0;
        if (m > n) return -1;
        int[] shift = new int[256];
        java.util.Arrays.fill(shift, m);
        for (int j = 0; j < m - 1; j++) shift[pattern.charAt(j) & 0xFF] = m - 1 - j;
        int i = 0;
        while (i <= n - m) {
            int j = m - 1;
            while (j >= 0 && text.charAt(i + j) == pattern.charAt(j)) j--;
            if (j < 0) return i;
            i += shift[text.charAt(i + m - 1) & 0xFF];
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(horspool("TRUSTHARDTEETH", "TEETH")); // 9
        System.out.println(horspool("abcabcabc", "cab"));        // 2
        System.out.println(horspool("hello", "xyz"));            // -1
    }
}
```

**Python.**
```python
def horspool(text, pattern):
    n, m = len(text), len(pattern)
    if m == 0:
        return 0
    if m > n:
        return -1
    shift = [m] * 256
    for j in range(m - 1):
        shift[ord(pattern[j])] = m - 1 - j
    i = 0
    while i <= n - m:
        j = m - 1
        while j >= 0 and text[i + j] == pattern[j]:
            j -= 1
        if j < 0:
            return i
        i += shift[ord(text[i + m - 1])]
    return -1


if __name__ == "__main__":
    print(horspool("TRUSTHARDTEETH", "TEETH"))  # 9
    print(horspool("abcabcabc", "cab"))         # 2
    print(horspool("hello", "xyz"))             # -1
```

---

### Challenge 2: Build the Shift Table

**Problem.** Given a pattern, return its Horspool shift table as a length-256 array (byte alphabet). Default entries are `m`; for `j = 0..m-2`, `shift[P[j]] = m - 1 - j`.

**Example.**
```text
buildShift("TEETH") -> shift['T']=1, shift['E']=2, all others 5 (m=5)
```

**Go.**
```go
package main

import "fmt"

func buildShift(pattern string) [256]int {
	m := len(pattern)
	var shift [256]int
	for c := range shift {
		shift[c] = m
	}
	for j := 0; j < m-1; j++ {
		shift[pattern[j]] = m - 1 - j
	}
	return shift
}

func main() {
	s := buildShift("TEETH")
	fmt.Println(s['T'], s['E'], s['H'], s['X']) // 1 2 5 5
}
```

**Java.**
```java
public class BuildShift {
    static int[] buildShift(String pattern) {
        int m = pattern.length();
        int[] shift = new int[256];
        java.util.Arrays.fill(shift, m);
        for (int j = 0; j < m - 1; j++) shift[pattern.charAt(j) & 0xFF] = m - 1 - j;
        return shift;
    }

    public static void main(String[] args) {
        int[] s = buildShift("TEETH");
        System.out.println(s['T'] + " " + s['E'] + " " + s['H'] + " " + s['X']); // 1 2 5 5
    }
}
```

**Python.**
```python
def build_shift(pattern):
    m = len(pattern)
    shift = [m] * 256
    for j in range(m - 1):
        shift[ord(pattern[j])] = m - 1 - j
    return shift


if __name__ == "__main__":
    s = build_shift("TEETH")
    print(s[ord('T')], s[ord('E')], s[ord('H')], s[ord('X')])  # 1 2 5 5
```

---

### Challenge 3: Sunday Variant Search

**Problem.** Implement substring search using the Sunday variant: key the shift on the character one past the window, include the last char in the table, default `m + 1`.

**Example.**
```text
sunday("TRUSTHARDTEETH", "TEETH") -> 9
```

**Go.**
```go
package main

import "fmt"

func sunday(text, pattern string) int {
	n, m := len(text), len(pattern)
	if m == 0 {
		return 0
	}
	if m > n {
		return -1
	}
	var shift [256]int
	for c := range shift {
		shift[c] = m + 1
	}
	for j := 0; j < m; j++ { // include last char
		shift[pattern[j]] = m - j
	}
	i := 0
	for i <= n-m {
		j := 0
		for j < m && text[i+j] == pattern[j] {
			j++
		}
		if j == m {
			return i
		}
		if i+m >= n {
			break
		}
		i += shift[text[i+m]]
	}
	return -1
}

func main() {
	fmt.Println(sunday("TRUSTHARDTEETH", "TEETH")) // 9
}
```

**Java.**
```java
public class SundaySearch {
    static int sunday(String text, String pattern) {
        int n = text.length(), m = pattern.length();
        if (m == 0) return 0;
        if (m > n) return -1;
        int[] shift = new int[256];
        java.util.Arrays.fill(shift, m + 1);
        for (int j = 0; j < m; j++) shift[pattern.charAt(j) & 0xFF] = m - j;
        int i = 0;
        while (i <= n - m) {
            int j = 0;
            while (j < m && text.charAt(i + j) == pattern.charAt(j)) j++;
            if (j == m) return i;
            if (i + m >= n) break;
            i += shift[text.charAt(i + m) & 0xFF];
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(sunday("TRUSTHARDTEETH", "TEETH")); // 9
    }
}
```

**Python.**
```python
def sunday(text, pattern):
    n, m = len(text), len(pattern)
    if m == 0:
        return 0
    if m > n:
        return -1
    shift = [m + 1] * 256
    for j in range(m):              # include last char
        shift[ord(pattern[j])] = m - j
    i = 0
    while i <= n - m:
        j = 0
        while j < m and text[i + j] == pattern[j]:
            j += 1
        if j == m:
            return i
        if i + m >= n:
            break
        i += shift[ord(text[i + m])]
    return -1


if __name__ == "__main__":
    print(sunday("TRUSTHARDTEETH", "TEETH"))  # 9
```

---

### Challenge 4: Count All Occurrences (overlapping)

**Problem.** Count every occurrence (including overlapping) of `pattern` in `text` using Horspool.

**Example.**
```text
countAll("aaaa", "aa") -> 3   (positions 0,1,2)
```

**Python.**
```python
def count_all(text, pattern):
    n, m = len(text), len(pattern)
    if m == 0 or m > n:
        return 0
    shift = [m] * 256
    for j in range(m - 1):
        shift[ord(pattern[j])] = m - 1 - j
    count, i = 0, 0
    while i <= n - m:
        j = m - 1
        while j >= 0 and text[i + j] == pattern[j]:
            j -= 1
        if j < 0:
            count += 1
        i += shift[ord(text[i + m - 1])]
    return count


if __name__ == "__main__":
    print(count_all("aaaa", "aa"))                 # 3
    print(count_all("abxabcabcaby", "abc"))        # 2
```

**Go.**
```go
package main

import "fmt"

func countAll(text, pattern string) int {
	n, m := len(text), len(pattern)
	if m == 0 || m > n {
		return 0
	}
	var shift [256]int
	for c := range shift {
		shift[c] = m
	}
	for j := 0; j < m-1; j++ {
		shift[pattern[j]] = m - 1 - j
	}
	count, i := 0, 0
	for i <= n-m {
		j := m - 1
		for j >= 0 && text[i+j] == pattern[j] {
			j--
		}
		if j < 0 {
			count++
		}
		i += shift[text[i+m-1]]
	}
	return count
}

func main() {
	fmt.Println(countAll("aaaa", "aa"))          // 3
	fmt.Println(countAll("abxabcabcaby", "abc")) // 2
}
```

**Java.**
```java
public class CountAll {
    static int countAll(String text, String pattern) {
        int n = text.length(), m = pattern.length();
        if (m == 0 || m > n) return 0;
        int[] shift = new int[256];
        java.util.Arrays.fill(shift, m);
        for (int j = 0; j < m - 1; j++) shift[pattern.charAt(j) & 0xFF] = m - 1 - j;
        int count = 0, i = 0;
        while (i <= n - m) {
            int j = m - 1;
            while (j >= 0 && text.charAt(i + j) == pattern.charAt(j)) j--;
            if (j < 0) count++;
            i += shift[text.charAt(i + m - 1) & 0xFF];
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countAll("aaaa", "aa"));          // 3
        System.out.println(countAll("abxabcabcaby", "abc")); // 2
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Horspool keeps only the bad-character shift on the window-last char and drops the good-suffix rule; one `O(sigma)` table, a tiny uniform loop, near-Boyer-Moore average, `O(nm)` worst."*
- Immediately flag the build gotcha: **exclude the last character** (Horspool) so the shift is always positive.
- If asked for a slightly bigger jump, reach for **Sunday** (key on the char past the window, include the last char, default `m+1`).
- For worst-case guarantees, mention **KMP (`01`)** or **full Boyer-Moore with Galil (`08`)**, and the hybrid-with-fallback production pattern.
- Always offer to verify against a naive oracle on a small alphabet where matches are frequent.
