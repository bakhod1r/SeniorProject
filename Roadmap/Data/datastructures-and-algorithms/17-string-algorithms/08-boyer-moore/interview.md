# Boyer-Moore String Matching — Interview Preparation

Boyer-Moore is a favourite interview topic because it rewards two crisp insights — *"scan the pattern right to left"* and *"on a mismatch, jump forward by the larger of two precomputed shifts"* — and then tests whether you can (a) build the bad-character last-occurrence table, (b) explain the good-suffix rule's two cases, (c) know why the average case is sublinear and the worst case `O(nm)` (and how Galil's rule fixes it), and (d) contrast it cleanly with KMP (sibling `01-kmp`, left-to-right, guaranteed linear). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Where to start each window comparison | right-to-left scan from `j = m-1` | — |
| Shift after mismatch at `j`, bad char `c` | `max(1, j - last[c], gs[j+1])` | `O(1)` per mismatch |
| Build bad-character table | last-occurrence over `P` | `O(m + σ)` |
| Build good-suffix table | two border passes | `O(m)` |
| Average-case search | sublinear (skips characters) | `O(n / min(m, σ))` |
| Worst-case search (plain) | repetitive small-alphabet input | `O(nm)` |
| Worst-case search (Galil's rule) | cap re-comparisons | `O(n)` |
| Simplified bad-character-only variant | Horspool (sibling `09`) | sublinear avg |
| Left-to-right, never-look-back alternative | KMP (sibling `01`) | `O(n + m)` |

Core algorithm:

```text
build last[c]  (O(m + σ))  and  gs[]  (O(m))
s = 0
while s <= n - m:
    j = m - 1
    while j >= 0 and P[j] == T[s+j]:  j -= 1      # scan RIGHT TO LEFT
    if j < 0:  report match at s;  s += gs[0]
    else:      s += max(1, j - last[T[s+j]], gs[j+1])   # max of two shifts
```

Key facts:
- **Scan right to left** — the defining feature vs KMP's left-to-right.
- **Two heuristics, take the max** — bad-character and good-suffix.
- Bad char **absent** from `P` → jump the full `j + 1`.
- **Sublinear average**, `O(nm)` worst without Galil, `O(n)` with it.
- Clamp the shift to **at least 1** (bad-character shift can be `≤ 0`).

---

## Junior Questions (12 Q&A)

### J1. In which direction does Boyer-Moore compare the pattern?
**Right to left.** It aligns `P` under `T` at shift `s` and starts comparing at the last pattern character `P[m-1]` against `T[s+m-1]`, moving leftward. This is the single most important difference from the naive algorithm and KMP, which both compare left to right.

### J2. What is the bad-character rule?
On a mismatch at pattern index `j` with text character `c = T[s+j]`, slide `P` so `c` aligns with its **rightmost occurrence** in `P`. The shift is `j - last[c]`. If `c` is not in `P` at all (`last[c] = -1`), jump the whole pattern past it: shift `= j + 1`.

### J3. What is the last-occurrence table?
A table `last[c]` giving the largest index where character `c` appears in `P`, or `-1` if absent. It is built in one pass over `P` and lets the bad-character shift be computed in `O(1)`.

### J4. What is the good-suffix rule, briefly?
When a suffix of `P` matched before the mismatch, slide `P` so another occurrence of that matched suffix (or the longest pattern prefix equal to a suffix of it) re-aligns with the text. It is the *second* shift candidate.

### J5. How do you combine the two rules?
Compute both shifts and slide by the **maximum** (clamped to at least 1). A larger safe jump finishes the search faster, and both rules are individually proven never to skip a real occurrence.

### J6. Why is Boyer-Moore often called sublinear?
Because a mismatch on the last pattern character — especially when that text character is absent from `P` — can jump the pattern forward by nearly `m`. So it can find a match while examining far **fewer than `n`** characters, unlike `O(n)` algorithms that touch every character.

### J7. What is the preprocessing cost?
`O(m + σ)`: `O(σ)` to initialize the bad-character table plus `O(m)` to scan the pattern, and `O(m)` for the good-suffix table. Here `σ` is the alphabet size.

### J8. What is the worst-case time?
`O(nm)` for the plain algorithm (e.g. text `"aaaa…"`, pattern `"aaa"`). Galil's rule reduces it to `O(n)`.

### J9. Why must you clamp the shift to at least 1?
The bad-character shift `j - last[c]` can be zero or negative when `c` occurs in `P` to the *right* of the mismatch. Without `max(1, ·)` the position `s` would not advance and the loop would never terminate.

### J10. How is Boyer-Moore different from KMP?
KMP scans **left to right**, never re-reads a text character, and is `O(n+m)` always. Boyer-Moore scans **right to left**, *skips* characters, is sublinear on average, but `O(nm)` worst case without Galil. KMP: "never look back." Boyer-Moore: "look at as little as possible."

### J11. What is Horspool?
A simplified Boyer-Moore that drops the good-suffix rule and uses only a bad-character table keyed on the text byte aligned with the pattern's last position (sibling `09`). It is simpler, very fast in practice, and underpins much of real `grep`.

### J12 (analysis). Why does a large alphabet make Boyer-Moore faster?
With a large alphabet, a probed text character is more likely to be **absent** from the pattern, so the bad-character rule jumps the full pattern length after a single comparison. Bigger alphabet → bigger expected jumps → fewer characters examined.

---

## Middle Questions (12 Q&A)

### M1. Prove the bad-character shift never skips a match.
For any shift `s'` with `s < s' < s + (j - last[c])`, the pattern index aligned under the bad text position `s+j` is `i = s+j-s'`, which satisfies `last[c] < i < j`. Since `last[c]` is the rightmost occurrence of `c`, `P[i] ≠ c`, so no occurrence can exist at `s'`. Advancing by `j - last[c]` therefore skips only non-matches.

### M2. Describe the two cases of the good-suffix rule.
**Case 1:** the matched suffix `u` re-occurs elsewhere in `P` (preceded by a different character); slide so that interior copy aligns with the matched text. **Case 2:** `u` does not re-occur, so align the longest **prefix** of `P` that equals a **suffix** of `u`. Both are safe.

### M3. How is the good-suffix table built in O(m)?
Two linear passes over a border (suffix-border) array: the first pass records Case 1 shifts as it computes suffix borders (KMP-style amortized chain walking), the second pass fills the remaining positions with Case 2 (prefix-equals-suffix) shifts.

### M4. Why take the maximum of the two shifts rather than the sum?
Each rule certifies an interval of shifts starting at `s+1` as occurrence-free. Their union is occurrence-free up to `s + max(bc, gs)`. You cannot add them — beyond the max, an occurrence might exist. The maximum is the largest *provably* safe jump.

### M5. What input forces the O(nm) worst case?
Highly repetitive, small-alphabet input such as `T = "a"*n`, `P = "a"*m` (or `P = "b" + "a"*(m-1)`). Each alignment scans almost all `m` characters and shifts by only 1, giving `Θ(nm)`.

### M6. What does Galil's rule do?
It remembers the boundary up to which the next alignment is guaranteed to match (because the matched suffix overlaps the new window) and skips re-comparing that overlap. This caps total comparisons at `O(n)`, making the worst case linear.

### M7. What shift do you use after a full match?
`gs[0] = m - r`, where `r` is the length of the longest proper border of `P` (longest proper prefix that is also a suffix). This correctly finds overlapping occurrences like `"aa"` in `"aaaa"`.

### M8. When does the bad-character rule give a useless (non-positive) shift?
When the bad character occurs in `P` to the right of the mismatch (`last[c] > j`), so `j - last[c] ≤ 0`. Then you rely on the good-suffix rule and the `max(1, ·)` clamp.

### M9. How does Horspool differ from full Boyer-Moore?
Horspool keeps only a bad-character table keyed on the byte aligned with the pattern's *last* position (ignoring which interior position mismatched) and drops the good-suffix rule entirely. Simpler, slightly weaker on repeated-suffix patterns, but a common production default.

### M10. Why is Boyer-Moore weak on binary/DNA alphabets?
With a tiny alphabet, almost every text character appears in the pattern, so `last[c]` is usually close to `j` and jumps are tiny — approaching `O(nm)`. KMP or bit-parallel methods (Shift-Or, BNDM) are better there.

### M11. Why does the right-to-left scan enable big jumps?
Because the *last* pattern character is compared against a fresh text character first; if it does not even occur in `P`, the entire alignment is hopeless and the pattern can leap past it. Scanning left-to-right would not surface that information early.

### M12 (analysis). What is the expected shift per alignment for a large alphabet?
`Θ(min(m, σ))`. For `σ ≥ m`, the probed character is usually absent from `P`, giving an expected shift of `Θ(m)`, hence an expected `O(n/m)` characters examined — sublinear.

---

## Senior Questions (10 Q&A)

### S1. Why do many production searchers use Horspool or Two-Way instead of full Boyer-Moore?
Horspool is simpler, more cache-friendly, and nearly as fast on real data; the good-suffix rule mainly helps on patterns with repeated suffixes. Two-Way (Crochemore-Perrin) gives `O(n)` worst case with `O(1)` space and **no `σ`-sized table**, which is why glibc `memmem` uses it. The full good-suffix BM is seminal but rarely the production choice.

### S2. How is GNU grep so fast?
It combines Boyer-Moore-Horspool skipping with a SIMD `memchr` scan for a well-chosen (rarest) guard byte of the pattern, so it avoids even looking at most input bytes, then verifies only at candidate positions. Skipping plus prefetch-friendly SIMD scanning beats touching every byte.

### S3. How would you size the bad-character table for Unicode text?
Search over the **UTF-8 byte stream** (`σ = 256`, flat array), not code points (a flat array of 1.1M entries is absurd). UTF-8 is self-synchronizing, so a byte-level match of a valid UTF-8 pattern lands on a code-point boundary. Alternatively use a hash-map table keyed on runes.

### S4. When does Boyer-Moore lose to a simple SIMD scan?
For very short patterns (≤ ~3 chars), where the maximum jump is tiny and preprocessing is not amortized, a SIMD `memchr`/`memcmp` scan reading memory linearly wins. This is why `memmem` and Go's `Index` special-case short needles.

### S5. How do you guarantee linear worst-case time?
Implement Galil's rule (cap re-comparisons → `O(n)`), or use a different linear algorithm (KMP, Two-Way) for untrusted input. Cole (1994) proved good-suffix BM with Galil makes at most `3n` comparisons when the pattern is absent.

### S6. What is the multi-pattern generalization of Boyer-Moore?
**Commentz-Walter**: build a reverse trie of all patterns and apply BM-style bad-character/good-suffix shifts against it. It is the skipping counterpart to **Aho-Corasick** (the KMP-style, guaranteed-linear multi-pattern automaton used in IDS like Snort).

### S7. Why can Boyer-Moore be cache-unfriendly on huge texts?
Its big forward jumps touch one byte per window and hop over memory, which hardware prefetchers handle worse than a linear scan. On out-of-cache, disk-backed data a SIMD linear scan with a guard byte can outperform raw skipping. Measure on representative data.

### S8. How do you test a Boyer-Moore implementation?
Property-test against a naive oracle on **small alphabets** (2-4 symbols) so overlaps and good-suffix paths are stressed; assert identical index lists. Add empty-pattern, pattern-longer-than-text, overlapping-match, and worst-case (`"a"*N`) cases. Instrument comparison counts to confirm sublinearity and the `O(n)` Galil bound.

### S9. What bit-parallel alternatives exist for short patterns?
**Shift-Or** (`O(n⌈m/w⌉)`, branchless) and **BNDM** (Backward Nondeterministic DAWG Matching — a bit-parallel backward scan fusing BM-style skipping with word operations). For `m ≤ 64` these are often the fastest, and they handle small alphabets where BM stalls.

### S10 (analysis). Is Boyer-Moore optimal?
On both axes, essentially yes. Yao (1979) proved any matcher needs `Ω((n/m) log_σ m)` average character examinations on random text, which BM-Horspool/BNDM match. With Galil's rule, BM achieves the `O(n)` worst-case optimum with a tight constant (Cole's `≤ 3n`). It is both average-case optimal and worst-case linear.

---

## Professional Questions (8 Q&A)

### P1. Design a library `indexOf(text, pattern)` for arbitrary byte data.
Dispatch by needle length and alphabet: for `m ≤ 2-3`, SIMD `memchr`/`memcmp`; for small alphabets, KMP/BNDM; otherwise Boyer-Moore-Horspool with a bad-character table, optionally guarded by a SIMD scan on the pattern's rarest byte. Cache the tables in a compiled-pattern object for reuse. Guard untrusted input with Galil's rule or a comparison budget.

### P2. Your matcher is a DoS vector under untrusted input. What happened and how do you fix it?
An attacker supplies repetitive small-alphabet `(T, P)` (e.g. `"a"*n`, `"a"*m`) hitting the plain BM `O(nm)` worst case. Fix: implement Galil's rule for an `O(n)` guarantee, or switch to a linear algorithm (Two-Way/KMP) for untrusted patterns, and impose a per-query comparison budget with a timeout.

### P3. How do you handle case-insensitive or normalized search?
Normalize both text and pattern (case-fold, Unicode NFC/NFD) *before* building the tables, or fold characters in the comparison and the table keys. For Unicode, fold to a canonical byte form and search the byte stream. Document that the reported indices are in the normalized space if normalization changes lengths.

### P4. The good-suffix table is dropping matches in production. How do you debug?
Diff against a naive oracle on thousands of random small-alphabet strings where overlaps are dense; this surfaces the classic bugs: using `gs[j]` instead of `gs[j+1]` after a mismatch at `j`, forgetting the Case 2 (prefix) pass, or shifting by `m` instead of `gs[0]` after a full match (missing overlaps).

### P5. When is full Boyer-Moore the wrong choice, and what replaces it?
Short patterns → SIMD scan; small/binary alphabets → KMP or Shift-Or/BNDM; need `O(1)` space + `O(n)` → Two-Way; many patterns → Aho-Corasick/Commentz-Walter; streaming without random access → KMP/Two-Way. Full BM wins for long patterns over large alphabets when average speed dominates.

### P6. How would you parallelize searching a huge file?
Split the file into overlapping chunks of size `chunk + (m-1)` (overlap by `m-1` so matches spanning boundaries are not lost), run BM independently per chunk across workers, then merge and dedupe results at the boundaries. The tables are read-only and shared.

### P7. How do UTF-8 and self-synchronization interact with byte-level Boyer-Moore?
UTF-8 continuation bytes are distinguishable from lead bytes, so a valid multi-byte UTF-8 pattern can only match starting at a lead byte. A byte-level BM match of such a pattern is automatically on a code-point boundary, so you can search bytes directly and report byte offsets (convert to character offsets if the API requires).

### P8 (analysis). Why does the extended per-position bad-character table cost O(mσ), and is it worth it?
`bcr[c][j]` stores, for each character `c` and position `j`, the rightmost occurrence of `c` strictly left of `j` — that is `σ × m` entries. It guarantees a positive shift (avoiding the non-positive last-occurrence case), but the classic `O(σ)` last-occurrence table plus the good-suffix rule and the `max(1, ·)` clamp recover the same shifts with far less memory, so the extended table is rarely worth it.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you sped up a hot search path.
Look for a concrete story: a profile showing a naive `O(nm)` `contains`/`indexOf` dominating, the insight to switch to Boyer-Moore-Horspool (or a SIMD scan for short needles), the measured speedup, and the correctness check against the old implementation on random inputs including overlaps and empty cases.

### B2. A teammate's Boyer-Moore drops some matches. How do you help?
Stay constructive: reproduce with a naive oracle on small-alphabet random strings, then point to the usual culprits (good-suffix index off-by-one, missing Case 2 pass, wrong post-match shift). Frame it as "let's add a property test that would have caught this," not blame.

### B3. Design log scanning that finds a literal substring across terabytes of logs.
Memory-map or stream in chunks, use Boyer-Moore-Horspool with a SIMD guard on the rarest pattern byte (the grep approach), parallelize across chunks with `m-1` overlap, and budget comparisons to stay linear on adversarial lines. Discuss when a regex engine's literal-prefix extraction reduces to this same matcher.

### B4. Explain Boyer-Moore to a junior engineer.
Lead with the shelf analogy: glance at the *last* letter of each candidate word first; if it is a letter your target word doesn't contain, skip the whole word. Then show the two shift rules and "take the bigger jump." Emphasize the two gotchas first: scan **right to left**, and **clamp the shift to ≥ 1**.

### B5. Your search service's latency spikes on some inputs. How do you investigate?
Check for the `O(nm)` worst case (repetitive small-alphabet patterns); confirm whether Galil's rule is implemented. Look at average shift distance and comparisons-per-byte metrics for a regression (e.g. an accidental fallback to naive). Add a comparison budget/timeout so a pathological input cannot stall the service.

---

## Coding Challenges

### Challenge 1: Full Boyer-Moore Search (all occurrences)

**Problem.** Given text `T` and pattern `P`, return all start indices where `P` occurs in `T`, using the full Boyer-Moore algorithm (bad-character + good-suffix, max shift). Handle overlapping occurrences.

**Example.**
```text
T = "abababab", P = "abab"  ->  [0, 2, 4]
T = "HERE IS A SIMPLE EXAMPLE", P = "EXAMPLE"  ->  [17]
```

**Constraints.** `0 ≤ |T| ≤ 10^6`, `0 ≤ |P| ≤ 10^4`, byte alphabet.

**Optimal.** `O(n + m + σ)` preprocessing + sublinear average search.

**Go.**
```go
package main

import "fmt"

const SIGMA = 256

func buildLast(p string) [SIGMA]int {
	var last [SIGMA]int
	for i := range last {
		last[i] = -1
	}
	for i := 0; i < len(p); i++ {
		last[p[i]] = i
	}
	return last
}

func buildGoodSuffix(p string) []int {
	m := len(p)
	border := make([]int, m+1)
	shift := make([]int, m+1)
	i, j := m, m+1
	border[i] = j
	for i > 0 {
		for j <= m && p[i-1] != p[j-1] {
			if shift[j] == 0 {
				shift[j] = j - i
			}
			j = border[j]
		}
		i--
		j--
		border[i] = j
	}
	j = border[0]
	for i = 0; i <= m; i++ {
		if shift[i] == 0 {
			shift[i] = j
		}
		if i == j {
			j = border[j]
		}
	}
	return shift
}

func search(t, p string) []int {
	res := []int{}
	n, m := len(t), len(p)
	if m == 0 || m > n {
		return res
	}
	last := buildLast(p)
	gs := buildGoodSuffix(p)
	s := 0
	for s <= n-m {
		j := m - 1
		for j >= 0 && p[j] == t[s+j] {
			j--
		}
		if j < 0 {
			res = append(res, s)
			s += gs[0]
		} else {
			bc := j - last[t[s+j]]
			sh := gs[j+1]
			if bc > sh {
				sh = bc
			}
			if sh < 1 {
				sh = 1
			}
			s += sh
		}
	}
	return res
}

func main() {
	fmt.Println(search("abababab", "abab"))                   // [0 2 4]
	fmt.Println(search("HERE IS A SIMPLE EXAMPLE", "EXAMPLE")) // [17]
}
```

**Java.**
```java
import java.util.*;

public class BMSearch {
    static final int SIGMA = 256;

    static int[] buildLast(String p) {
        int[] last = new int[SIGMA];
        Arrays.fill(last, -1);
        for (int i = 0; i < p.length(); i++) last[p.charAt(i)] = i;
        return last;
    }

    static int[] buildGoodSuffix(String p) {
        int m = p.length();
        int[] border = new int[m + 1], shift = new int[m + 1];
        int i = m, j = m + 1;
        border[i] = j;
        while (i > 0) {
            while (j <= m && p.charAt(i - 1) != p.charAt(j - 1)) {
                if (shift[j] == 0) shift[j] = j - i;
                j = border[j];
            }
            i--; j--;
            border[i] = j;
        }
        j = border[0];
        for (i = 0; i <= m; i++) {
            if (shift[i] == 0) shift[i] = j;
            if (i == j) j = border[j];
        }
        return shift;
    }

    static List<Integer> search(String t, String p) {
        List<Integer> res = new ArrayList<>();
        int n = t.length(), m = p.length();
        if (m == 0 || m > n) return res;
        int[] last = buildLast(p), gs = buildGoodSuffix(p);
        int s = 0;
        while (s <= n - m) {
            int j = m - 1;
            while (j >= 0 && p.charAt(j) == t.charAt(s + j)) j--;
            if (j < 0) {
                res.add(s);
                s += gs[0];
            } else {
                int bc = j - last[t.charAt(s + j)];
                s += Math.max(1, Math.max(bc, gs[j + 1]));
            }
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(search("abababab", "abab"));                   // [0,2,4]
        System.out.println(search("HERE IS A SIMPLE EXAMPLE", "EXAMPLE")); // [17]
    }
}
```

**Python.**
```python
SIGMA = 256


def build_last(p):
    last = [-1] * SIGMA
    for i, ch in enumerate(p):
        last[ord(ch)] = i
    return last


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


def search(t, p):
    res = []
    n, m = len(t), len(p)
    if m == 0 or m > n:
        return res
    last = build_last(p)
    gs = build_good_suffix(p)
    s = 0
    while s <= n - m:
        j = m - 1
        while j >= 0 and p[j] == t[s + j]:
            j -= 1
        if j < 0:
            res.append(s)
            s += gs[0]
        else:
            bc = j - last[ord(t[s + j])]
            s += max(1, bc, gs[j + 1])
    return res


if __name__ == "__main__":
    print(search("abababab", "abab"))                    # [0, 2, 4]
    print(search("HERE IS A SIMPLE EXAMPLE", "EXAMPLE"))  # [17]
```

---

### Challenge 2: Bad-Character-Only Version (first occurrence)

**Problem.** Implement a simplified Boyer-Moore using **only** the bad-character rule that returns the first index of `P` in `T`, or `-1`.

**Example.**
```text
T = "TRUSTHARDTOOTHBRUSHES", P = "TOOTH"  ->  10
```

**Optimal.** `O(m + σ)` preprocessing, sublinear average search.

**Go.**
```go
package main

import "fmt"

func bcIndex(t, p string) int {
	n, m := len(t), len(p)
	if m == 0 {
		return 0
	}
	if m > n {
		return -1
	}
	last := [256]int{}
	for i := range last {
		last[i] = -1
	}
	for i := 0; i < m; i++ {
		last[p[i]] = i
	}
	s := 0
	for s <= n-m {
		j := m - 1
		for j >= 0 && p[j] == t[s+j] {
			j--
		}
		if j < 0 {
			return s
		}
		sh := j - last[t[s+j]]
		if sh < 1 {
			sh = 1
		}
		s += sh
	}
	return -1
}

func main() {
	fmt.Println(bcIndex("TRUSTHARDTOOTHBRUSHES", "TOOTH")) // 10
	fmt.Println(bcIndex("abc", "xyz"))                     // -1
}
```

**Java.**
```java
import java.util.*;

public class BadCharOnly {
    static int bcIndex(String t, String p) {
        int n = t.length(), m = p.length();
        if (m == 0) return 0;
        if (m > n) return -1;
        int[] last = new int[256];
        Arrays.fill(last, -1);
        for (int i = 0; i < m; i++) last[p.charAt(i)] = i;
        int s = 0;
        while (s <= n - m) {
            int j = m - 1;
            while (j >= 0 && p.charAt(j) == t.charAt(s + j)) j--;
            if (j < 0) return s;
            s += Math.max(1, j - last[t.charAt(s + j)]);
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(bcIndex("TRUSTHARDTOOTHBRUSHES", "TOOTH")); // 10
        System.out.println(bcIndex("abc", "xyz"));                     // -1
    }
}
```

**Python.**
```python
def bc_index(t, p):
    n, m = len(t), len(p)
    if m == 0:
        return 0
    if m > n:
        return -1
    last = [-1] * 256
    for i, ch in enumerate(p):
        last[ord(ch)] = i
    s = 0
    while s <= n - m:
        j = m - 1
        while j >= 0 and p[j] == t[s + j]:
            j -= 1
        if j < 0:
            return s
        s += max(1, j - last[ord(t[s + j])])
    return -1


if __name__ == "__main__":
    print(bc_index("TRUSTHARDTOOTHBRUSHES", "TOOTH"))  # 10
    print(bc_index("abc", "xyz"))                      # -1
```

---

### Challenge 3: Count Occurrences (overlapping)

**Problem.** Count how many times `P` occurs in `T`, counting overlapping occurrences (e.g. `"aa"` in `"aaaa"` → 3). Use Boyer-Moore.

**Approach.** Run the full searcher but increment a counter on each match and continue with `gs[0]` (or shift-by-1) so overlaps are captured.

**Go.**
```go
package main

import "fmt"

func countOcc(t, p string) int {
	n, m := len(t), len(p)
	if m == 0 || m > n {
		return 0
	}
	last := [256]int{}
	for i := range last {
		last[i] = -1
	}
	for i := 0; i < m; i++ {
		last[p[i]] = i
	}
	count, s := 0, 0
	for s <= n-m {
		j := m - 1
		for j >= 0 && p[j] == t[s+j] {
			j--
		}
		if j < 0 {
			count++
			s++ // shift by 1 to catch overlaps
		} else {
			sh := j - last[t[s+j]]
			if sh < 1 {
				sh = 1
			}
			s += sh
		}
	}
	return count
}

func main() {
	fmt.Println(countOcc("aaaa", "aa")) // 3
	fmt.Println(countOcc("abcabcabc", "abc")) // 3
}
```

**Java.**
```java
import java.util.*;

public class CountOcc {
    static int countOcc(String t, String p) {
        int n = t.length(), m = p.length();
        if (m == 0 || m > n) return 0;
        int[] last = new int[256];
        Arrays.fill(last, -1);
        for (int i = 0; i < m; i++) last[p.charAt(i)] = i;
        int count = 0, s = 0;
        while (s <= n - m) {
            int j = m - 1;
            while (j >= 0 && p.charAt(j) == t.charAt(s + j)) j--;
            if (j < 0) {
                count++;
                s++;
            } else {
                s += Math.max(1, j - last[t.charAt(s + j)]);
            }
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countOcc("aaaa", "aa"));       // 3
        System.out.println(countOcc("abcabcabc", "abc")); // 3
    }
}
```

**Python.**
```python
def count_occ(t, p):
    n, m = len(t), len(p)
    if m == 0 or m > n:
        return 0
    last = [-1] * 256
    for i, ch in enumerate(p):
        last[ord(ch)] = i
    count = s = 0
    while s <= n - m:
        j = m - 1
        while j >= 0 and p[j] == t[s + j]:
            j -= 1
        if j < 0:
            count += 1
            s += 1  # overlaps
        else:
            s += max(1, j - last[ord(t[s + j])])
    return count


if __name__ == "__main__":
    print(count_occ("aaaa", "aa"))        # 3
    print(count_occ("abcabcabc", "abc"))  # 3
```

---

### Challenge 4: Explain Why Right-to-Left (analysis task)

**Problem.** Given a text and pattern, return the number of **character comparisons** Boyer-Moore (bad-character) performs, and contrast it with the naive count, to demonstrate why right-to-left scanning skips work. This is an instrumentation exercise often asked verbally.

**Approach.** Wrap the comparison in a counter. On a large alphabet, the Boyer-Moore count should be markedly below `n`, while the naive count is near `n*m` in the worst case.

**Python (reference + instrumentation).**
```python
def bm_comparisons(t, p):
    n, m = len(t), len(p)
    if m == 0 or m > n:
        return 0
    last = [-1] * 256
    for i, ch in enumerate(p):
        last[ord(ch)] = i
    comps, s = 0, 0
    while s <= n - m:
        j = m - 1
        while j >= 0:
            comps += 1
            if p[j] != t[s + j]:
                break
            j -= 1
        if j < 0:
            s += 1
        else:
            s += max(1, j - last[ord(t[s + j])])
    return comps


def naive_comparisons(t, p):
    n, m = len(t), len(p)
    comps = 0
    for s in range(n - m + 1):
        for j in range(m):
            comps += 1
            if t[s + j] != p[j]:
                break
    return comps


if __name__ == "__main__":
    t = "the quick brown fox jumps over the lazy dog" * 100
    p = "jumps"
    print("Boyer-Moore comparisons:", bm_comparisons(t, p))
    print("Naive comparisons:      ", naive_comparisons(t, p))
    # Boyer-Moore touches far fewer characters: the right-to-left
    # scan jumps past windows after a single mismatched last char.
```

**Go.**
```go
package main

import "fmt"

func bmComparisons(t, p string) int {
	n, m := len(t), len(p)
	if m == 0 || m > n {
		return 0
	}
	last := [256]int{}
	for i := range last {
		last[i] = -1
	}
	for i := 0; i < m; i++ {
		last[p[i]] = i
	}
	comps, s := 0, 0
	for s <= n-m {
		j := m - 1
		for j >= 0 {
			comps++
			if p[j] != t[s+j] {
				break
			}
			j--
		}
		if j < 0 {
			s++
		} else {
			sh := j - last[t[s+j]]
			if sh < 1 {
				sh = 1
			}
			s += sh
		}
	}
	return comps
}

func main() {
	t := ""
	for i := 0; i < 100; i++ {
		t += "the quick brown fox jumps over the lazy dog "
	}
	fmt.Println("Boyer-Moore comparisons:", bmComparisons(t, "jumps"))
}
```

**Java.**
```java
public class BMComparisons {
    static int bmComparisons(String t, String p) {
        int n = t.length(), m = p.length();
        if (m == 0 || m > n) return 0;
        int[] last = new int[256];
        java.util.Arrays.fill(last, -1);
        for (int i = 0; i < m; i++) last[p.charAt(i)] = i;
        int comps = 0, s = 0;
        while (s <= n - m) {
            int j = m - 1;
            while (j >= 0) {
                comps++;
                if (p.charAt(j) != t.charAt(s + j)) break;
                j--;
            }
            if (j < 0) s++;
            else s += Math.max(1, j - last[t.charAt(s + j)]);
        }
        return comps;
    }

    public static void main(String[] args) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 100; i++) sb.append("the quick brown fox jumps over the lazy dog ");
        System.out.println("Boyer-Moore comparisons: " + bmComparisons(sb.toString(), "jumps"));
    }
}
```

---

## Final Tips

- Lead with the two one-liners: *"scan the pattern right to left"* and *"on a mismatch jump by the max of the bad-character and good-suffix shifts."*
- Immediately flag the gotchas: **clamp the shift to ≥ 1**, and **use `gs[0]` after a full match** to catch overlaps.
- If asked about worst case, mention `O(nm)` plain and **Galil's rule** for `O(n)` (Cole's `≤ 3n` constant).
- Contrast with **KMP** (sibling `01`): left-to-right, never re-reads, guaranteed `O(n+m)`; and **Horspool** (sibling `09`): bad-character only, the production favourite.
- Note alphabet sensitivity: BM shines on **long patterns over large alphabets**, loses on **short patterns / small alphabets**.
- Always offer to verify against a naive oracle on small-alphabet random strings (dense overlaps).
