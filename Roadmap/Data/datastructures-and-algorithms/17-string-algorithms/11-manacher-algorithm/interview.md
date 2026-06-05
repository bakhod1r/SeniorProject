# Manacher's Algorithm (All Palindromic Substrings in O(n)) — Interview Preparation

Manacher is a favourite interview topic because it rewards one crisp insight — *"reuse the palindrome you already found via its mirror inside the current box"* — and then tests whether you can (a) make it linear with the box `[l, r]` and the only-forward `r`, (b) keep it uniform with the `#`-transform, (c) recover substrings and counts from the radius array, and (d) avoid the trap of confusing *all* palindromic substrings with *distinct* ones (the eertree's job). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Longest palindromic substring | Manacher `p[]`, `max p[i]` | `O(n)` |
| Count **all** palindromic substrings | Manacher, `Σ⌈p[i]/2⌉` | `O(n)` |
| Palindrome length at each center | Manacher, `p[i]` directly | `O(n)` |
| Is `s[a..b]` a palindrome (one query) | hashing fwd+rev | `O(1)` after `O(n)` prep |
| Count / enumerate **distinct** palindromes | eertree (sibling `14`) | `O(n)` |
| Per-prefix #distinct palindromes (online) | eertree | `O(n)` |
| Longest palindrome, simplest code | center expansion | `O(n²)` |

Core algorithm:

```text
manacher(s):
    t = "#" + "#".join(s) + "#"
    p = [0]*len(t);  c = r = 0
    for i in range(len(t)):
        if i < r: p[i] = min(r - i, p[2*c - i])   # mirror reuse, capped
        while sides match: p[i] += 1               # expand past box
        if i + p[i] > r: c, r = i, i + p[i]        # r only moves forward
    return p
```

Key facts:
- **The `#`-transform** makes `t` odd-length so every palindrome is odd; one uniform case.
- **Radius in `t` = palindrome length in `s`**; start `= (center - radius) / 2`.
- The **cap** `min(r - i, p[mirror])` is the correctness keystone — never drop it.
- Counting **all** occurrences uses `Σ⌈p/2⌉`; **distinct** needs the eertree.
- The count can be `Θ(n²)` in magnitude → use 64-bit.

---

## Junior Questions (12 Q&A)

### J1. What problem does Manacher solve?
It finds, for every center of a string, the radius of the longest palindrome centered there, in linear `O(n)` time. From that radius array you read the longest palindromic substring and the count of all palindromic substrings.

### J2. What is the center-expansion baseline and its complexity?
For each of the `2n − 1` centers, expand two pointers outward while characters match. It is `O(n²)` worst case (e.g. `aaaa…`), and it is the correct, simple oracle to test Manacher against.

### J3. Why insert `#` separators?
Palindromes are odd or even length, which needs two cases. Inserting `#` between every character (and at the ends) makes `t` odd-length and makes *every* palindrome odd-length, so one uniform scan handles both. `abba` → `#a#b#b#a#`.

### J4. What does `p[i]` mean in the transformed string?
`p[i]` is the radius (matched characters on each side) of the longest palindrome centered at `i` in `t`. Conveniently, that radius **equals** the length of the corresponding palindrome in the original `s`.

### J5. What is the "box" `[l, r]`?
The palindrome with the rightmost right edge `r` seen so far, with center `c` and left edge `l = 2c − r`. It is the region where we already know the string is symmetric, enabling the mirror reuse.

### J6. What is the mirror of position `i`?
`i' = 2c − i = l + r − i`, the reflection of `i` across the box center `c`. Inside the box, the string near `i` mirrors the string near `i'`, so `p[i]` can be initialized from `p[i']`.

### J7. Why is the mirror copy capped with `min(r − i, …)`?
Because beyond the box edge `r` the string is unverified. The mirror palindrome might extend past the box; copying it blindly would claim a palindrome we have not checked. The cap restricts the free copy to the verified region.

### J8. How do you recover the longest palindrome from `p[]`?
Find `i` maximizing `p[i]`. Its length is `p[i]`, and its start in `s` is `(i − p[i]) / 2`. Slice `s[start : start + length]`.

### J9. Why is Manacher `O(n)` and not `O(n²)`?
The right edge `r` of the box only ever moves forward and is bounded by the string length. Every real expansion pushes `r` forward, so the total expansion work across the whole scan is `O(n)`.

### J10. How do you count all palindromic substrings?
Sum `⌈p[i] / 2⌉` (i.e. `(p[i] + 1) // 2`) over all centers. Each center of radius `p[i]` contains that many nested palindromes.

### J11. Does Manacher count distinct palindromes?
No. It counts every occurrence. `"aaa"` gives 6 (three `a`, two `aa`, one `aaa`), not 3 distinct. For distinct palindromes use the eertree (sibling `14`).

### J12 (analysis). What happens on the input `aaaa…a`?
Center expansion degrades to `O(n²)` because every center expands the full length. Manacher still runs in `O(n)`: the mirror reuse copies most radii and `r` advances monotonically. This input is the classic illustration of why Manacher exists.

---

## Middle Questions (12 Q&A)

### M1. Prove that the radius in `t` equals the palindrome length in `s`.
Inside the radius window of `t`, separators sit at even indices and real characters at odd indices, alternating. Counting the real characters inside a window of radius `p[i]` gives exactly `p[i]`. So the corresponding `s`-palindrome has length `p[i]`. (Full bijection in `professional.md`.)

### M2. Why must you take `min(r − i, p[mirror])` rather than just `p[mirror]`?
If the mirror palindrome extends past the box's left edge, the symmetric region for `i` extends past `r`, which is unexplored. Copying `p[mirror]` directly would assert an unverified palindrome. The cap confines the copy to `[l, r]`; expansion then verifies anything beyond.

### M3. When does Manacher actually expand versus just copy?
It expands only when the initialized radius reaches the box edge (`p[i'] ≥ r − i`, so `p[i]` is capped at `r − i`). If the mirror palindrome fits strictly inside the box, the copy is exact and the first expansion test fails immediately.

### M4. How do you handle odd and even palindromes without the transform?
Maintain two arrays: `d1[i]` for odd palindromes centered at `i`, `d2[i]` for even palindromes centered between `i−1` and `i`, with two near-identical Manacher passes. It is equivalent to the `#`-transform (the odd/even slices of `p[]`) and saves the 2× memory of `t`.

### M5. How do you recover a palindrome's original position?
For transformed center `i` and radius `p[i]`: length `= p[i]`, start `= (i − p[i]) / 2`, end `= start + p[i] − 1`. Real characters sit at odd `t`-indices; the left edge `i − p[i]` is a `#`, and the first real character maps to `(i − p[i]) / 2`.

### M6. Why `⌈p[i]/2⌉` palindromes per center?
A real-character center (odd `i`) has odd `p[i]` and contributes odd-length palindromes `1, 3, …, p[i]` → `(p[i]+1)/2`. A `#`-center (even `i`) has even `p[i]` and contributes even-length palindromes `2, 4, …, p[i]` → `p[i]/2`. Both equal `⌈p[i]/2⌉`.

### M7. Compare Manacher with polynomial hashing.
Hashing (forward + reverse) answers "is `s[a..b]` a palindrome?" in `O(1)` and finds per-center radii by binary search in `O(n log n)`. It is more flexible for arbitrary range and approximate queries but probabilistic (collision risk) and slower for the pure longest-palindrome task. Manacher is exact and linear.

### M8. Compare Manacher with the eertree.
Both are `O(n)`. Manacher gives a per-center radius array (longest, all-occurrence count). The eertree gives a node per *distinct* palindrome (distinct counts, per-prefix structure, online). Longest/all → Manacher; distinct/structure → eertree.

### M9. How do you avoid bounds checks in the inner loop?
Wrap `t` with two distinct sentinels `^ … $` (outside the alphabet). The boundary comparison `t[left] == t[right]` then fails automatically at the ends, so the expansion loop needs no explicit index check.

### M10. What is the longest palindromic prefix, and why is it useful?
The longest palindrome whose start in `s` is index 0. Scan `p[]` for centers with `(i − p[i]) / 2 == 0`. It powers tricks like "shortest palindrome by prepending characters" (LeetCode 214).

### M11. What can overflow, and how do you prevent it?
The count of all palindromic substrings is `Θ(n²)` in magnitude (e.g. `n(n+1)/2` for `a^n`). A 32-bit counter overflows for large `n`; accumulate in 64-bit, or reduce mod a prime if the problem asks.

### M12 (analysis). Why is the algorithm linear despite a `while` loop that can run many times?
Amortization: every successful expansion advances `r` by one, and `r` only moves forward and is bounded by `2n`. So the total number of successful expansions across all centers is `O(n)`, regardless of per-center distribution.

---

## Senior Questions (10 Q&A)

### S1. How do you make Manacher Unicode-correct?
Run over code points (runes), not bytes. In Go convert to `[]rune`; in Java use `s.codePoints().toArray()` to avoid splitting surrogate pairs; Python 3 `str` is already code points. For user-facing features, segment grapheme clusters and NFC-normalize first.

### S2. The input might contain `#`. How do you fix the transform?
Map characters to integers and use a negative sentinel (e.g. `-1`) for the separator, running Manacher over an `int[]`. This is alphabet-agnostic. Alternatively pick a separator provably absent from the known alphabet.

### S3. When would you choose the eertree over Manacher?
When you need *distinct* palindromic substrings, their occurrence counts, the number of distinct palindromes per prefix, or an online (per-append) structure. Manacher cannot give distinct counts directly; the eertree is built for it and is also linear.

### S4. When is hashing the better choice?
For arbitrary "is `s[a..b]` a palindrome?" range queries (`O(1)` each), or for approximate / k-mismatch palindromes where exact matching does not apply. Use double hashing to drive collision probability negligibly low.

### S5. How do you reduce Manacher's memory on huge inputs?
Use the two-array (`d1`/`d2`) form to avoid building `t` (saving 2× memory), store radii as `int32` (radii never exceed `n`), and map to a compact integer alphabet (`uint8` if ≤ 256 symbols). Keep arrays flat and contiguous for cache locality.

### S6. How do you verify correctness when you cannot eyeball the radius array?
Property tests against a center-expansion oracle on small random strings over a tiny alphabet: longest length matches, total count matches, reverse-string symmetry holds, every recovered substring is an actual palindrome and an actual substring, and `p[i] ≤ min(i, N−1−i)`.

### S7. Is Manacher online or offline?
The original 1975 formulation is online (processes characters left to right; after each append it knows the longest palindromic suffix). The array form most people memorize is offline. Use the online form for streaming suffix-palindrome questions; use the eertree for streaming *distinct*-palindrome tracking.

### S8. How do you count palindromes of length at least L?
Per center, the palindrome lengths are `p[i], p[i]−2, …`; keep those `≥ L`. The contribution is `(p[i] − L) // 2 + 1` when `p[i] ≥ L`, else 0. Derive carefully and unit-test against the brute oracle.

### S9. What is the relationship between center parity and palindrome parity?
In `t`, odd-index centers are real characters → odd-length `s`-palindromes; even-index centers are `#` → even-length `s`-palindromes. The center's parity records which family a palindrome belongs to.

### S10 (analysis). Why does the cap depend on `r − i` specifically?
`r − i` is the distance from the current center `i` to the right edge of the verified box. Inside that distance the string is known symmetric (via the mirror); beyond `r` it is unverified. So the free copy can be trusted up to `r − i` and no further.

---

## Professional Questions (8 Q&A)

### P1. Design a service that returns the longest palindrome in arbitrarily large uploaded documents.
Stream the document into a code-point array (handling encoding and normalization), run Manacher once (`O(n)`), and return the longest substring with byte offsets mapped back from code-point indices. Reuse a preallocated scratch buffer across requests; use `int32` radii; cap memory with the two-array form for very large inputs.

### P2. How do you count all palindromic substrings exactly when the count exceeds 64 bits?
The count is `≤ n(n+1)/2`. For `n` up to ~`6×10^9` it still fits in 64-bit unsigned; beyond that (or if the problem wants the exact value for astronomically long inputs) use arbitrary-precision integers for the accumulator, while the scan stays `O(n)`. If the problem wants it modulo a prime, reduce as you sum.

### P3. Your Manacher is correct on tests but wrong in production on one customer's data. How do you debug?
Suspect encoding first: their data is likely Unicode and you ran over bytes, splitting code points. Reproduce with their exact input, run over code points, and diff against the center-expansion oracle on a small slice. Also check the separator did not collide with their alphabet.

### P4. When is Manacher the wrong tool entirely?
When the question is about *distinct* palindromes (eertree), *subsequence* palindromes (a different DP, `O(n²)`), arbitrary *range* palindrome queries (hashing), or *approximate* palindromes (hashing / specialized algorithms). State the all-vs-distinct and substring-vs-subsequence distinctions explicitly.

### P5. How would you parallelize palindrome analysis across many documents?
Manacher itself is inherently sequential (the box pointer carries state), so parallelize *across* documents — each document is an independent `O(n)` job — rather than within one. Shard the corpus across workers; aggregate per-document counts and longest results centrally.

### P6. How do you implement "shortest palindrome by prepending characters"?
Find the longest palindromic *prefix* of `s` via Manacher (the longest palindrome starting at index 0). Prepend the reverse of the remaining suffix. The palindromic-prefix length comes directly from scanning `p[]` for centers with start `0`.

### P7. How does the `#`-transform interact with the radius array's parity?
Centers at even `t`-indices (`#`) always have even `p[i]` (even-length `s`-palindromes); centers at odd `t`-indices (real characters) always have odd `p[i]`. This parity invariant is a free internal consistency check: assert it in tests to catch transform/indexing bugs.

### P8 (analysis). Prove the linear-time bound rigorously.
Charge each successful expansion to the advance of `r`. The initialization clamp guarantees expansion only probes positions strictly past `r`; each success pushes `r` forward by one. Since `r` is monotone non-decreasing and bounded by `2n`, total successful expansions are `≤ 2n`. Adding `O(1)` per-center overhead gives `O(n)`. (Detailed proof in `professional.md`.)

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing an `O(n²)` algorithm with a linear one.
Look for a concrete story: a palindrome or symmetry task where the input grew, a profile showing the quadratic expansion dominating on repetitive inputs, the insight that previously-found palindromes could be reused via the mirror, and the measured speedup, with correctness validated against the old slow version.

### B2. A teammate used Manacher's `Σ⌈p/2⌉` to report *distinct* palindromes and shipped a wrong count. How do you handle it?
Explain the all-vs-distinct distinction calmly with a tiny example (`"aaa"` → 6 occurrences but 3 distinct). Note that distinct counts need the eertree, which is also linear, so there is a clean fix. Frame it as a teaching moment about choosing the right structure.

### B3. Design a feature that highlights palindromic phrases in user text live as they type.
This wants an online structure. Use Manacher's online form (or the eertree) to maintain the longest palindromic suffix after each keystroke. Discuss normalization, grapheme clusters for user-visible characters, and debouncing so the scan runs on a stable buffer.

### B4. How would you explain Manacher to a junior engineer?
Start from the mirror-hall analogy: inside a region you have already verified as symmetric, the spot at `i` must look like its reflection `i'`, so copy the answer instead of re-checking. Then introduce the `#`-transform as "spacers so every palindrome has a clear single middle." Lead with the two gotchas: cap the copy, and it counts all occurrences not distinct.

### B5. Your palindrome job uses too much memory at scale. How do you investigate?
Check whether `t` (length `2n+1`) is being built when the two-array form would avoid it; whether radii are `int64` when `int32` suffices; whether the alphabet could be mapped to one byte; and whether scratch buffers are reused across calls rather than reallocated. Profile allocations; the fix is usually the two-array form plus buffer reuse.

---

## Coding Challenges

### Challenge 1: Longest Palindromic Substring

**Problem.** Given a string `s`, return the longest substring of `s` that is a palindrome. Any longest one is acceptable on ties.

**Example.**
```text
"babad" -> "bab" (or "aba")
"cbbd"  -> "bb"
"abba"  -> "abba"
```

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Brute force.** Center expansion, `O(n²)` — too slow for large repetitive inputs.

**Optimal.** Manacher, `O(n)`.

**Go.**
```go
package main

import (
	"fmt"
	"strings"
)

func manacher(s string) ([]int, string) {
	var b strings.Builder
	b.WriteByte('#')
	for i := 0; i < len(s); i++ {
		b.WriteByte(s[i])
		b.WriteByte('#')
	}
	t := b.String()
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
	return p, t
}

func longestPalindrome(s string) string {
	if s == "" {
		return ""
	}
	p, _ := manacher(s)
	bestLen, bestC := 0, 0
	for i, v := range p {
		if v > bestLen {
			bestLen, bestC = v, i
		}
	}
	start := (bestC - bestLen) / 2
	return s[start : start+bestLen]
}

func main() {
	fmt.Println(longestPalindrome("babad")) // bab
	fmt.Println(longestPalindrome("cbbd"))  // bb
	fmt.Println(longestPalindrome("abba"))  // abba
}
```

**Java.**
```java
public class LongestPalindrome {
    static String longest(String s) {
        if (s.isEmpty()) return "";
        StringBuilder b = new StringBuilder("#");
        for (int i = 0; i < s.length(); i++) b.append(s.charAt(i)).append('#');
        char[] t = b.toString().toCharArray();
        int n = t.length;
        int[] p = new int[n];
        int c = 0, r = 0, bestLen = 0, bestC = 0;
        for (int i = 0; i < n; i++) {
            if (i < r) p[i] = Math.min(r - i, p[2 * c - i]);
            while (i - p[i] - 1 >= 0 && i + p[i] + 1 < n
                    && t[i - p[i] - 1] == t[i + p[i] + 1]) p[i]++;
            if (i + p[i] > r) { c = i; r = i + p[i]; }
            if (p[i] > bestLen) { bestLen = p[i]; bestC = i; }
        }
        int start = (bestC - bestLen) / 2;
        return s.substring(start, start + bestLen);
    }

    public static void main(String[] args) {
        System.out.println(longest("babad")); // bab
        System.out.println(longest("cbbd"));  // bb
        System.out.println(longest("abba"));  // abba
    }
}
```

**Python.**
```python
def longest_palindrome(s):
    if not s:
        return ""
    t = "#" + "#".join(s) + "#"
    n = len(t)
    p = [0] * n
    c = r = best_len = best_c = 0
    for i in range(n):
        if i < r:
            p[i] = min(r - i, p[2 * c - i])
        while (i - p[i] - 1 >= 0 and i + p[i] + 1 < n
               and t[i - p[i] - 1] == t[i + p[i] + 1]):
            p[i] += 1
        if i + p[i] > r:
            c, r = i, i + p[i]
        if p[i] > best_len:
            best_len, best_c = p[i], i
    start = (best_c - best_len) // 2
    return s[start:start + best_len]


if __name__ == "__main__":
    print(longest_palindrome("babad"))  # bab
    print(longest_palindrome("cbbd"))   # bb
    print(longest_palindrome("abba"))   # abba
```

---

### Challenge 2: Count Palindromic Substrings

**Problem.** Given `s`, return the number of palindromic substrings (counting each occurrence). LeetCode 647.

**Example.**
```text
"abc" -> 3   (a, b, c)
"aaa" -> 6   (a, a, a, aa, aa, aaa)
```

**Constraints.** `1 ≤ |s| ≤ 10^6`. Count fits in 64-bit.

**Optimal.** Manacher, sum `⌈p[i]/2⌉`, `O(n)`.

**Go.**
```go
package main

import (
	"fmt"
	"strings"
)

func countPalindromes(s string) int64 {
	var b strings.Builder
	b.WriteByte('#')
	for i := 0; i < len(s); i++ {
		b.WriteByte(s[i])
		b.WriteByte('#')
	}
	t := b.String()
	n := len(t)
	p := make([]int, n)
	c, r := 0, 0
	var total int64
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
		total += int64((p[i] + 1) / 2)
	}
	return total
}

func main() {
	fmt.Println(countPalindromes("abc")) // 3
	fmt.Println(countPalindromes("aaa")) // 6
}
```

**Java.**
```java
public class CountPalindromes {
    static long count(String s) {
        StringBuilder b = new StringBuilder("#");
        for (int i = 0; i < s.length(); i++) b.append(s.charAt(i)).append('#');
        char[] t = b.toString().toCharArray();
        int n = t.length;
        int[] p = new int[n];
        int c = 0, r = 0;
        long total = 0;
        for (int i = 0; i < n; i++) {
            if (i < r) p[i] = Math.min(r - i, p[2 * c - i]);
            while (i - p[i] - 1 >= 0 && i + p[i] + 1 < n
                    && t[i - p[i] - 1] == t[i + p[i] + 1]) p[i]++;
            if (i + p[i] > r) { c = i; r = i + p[i]; }
            total += (p[i] + 1) / 2;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(count("abc")); // 3
        System.out.println(count("aaa")); // 6
    }
}
```

**Python.**
```python
def count_palindromes(s):
    t = "#" + "#".join(s) + "#"
    n = len(t)
    p = [0] * n
    c = r = 0
    total = 0
    for i in range(n):
        if i < r:
            p[i] = min(r - i, p[2 * c - i])
        while (i - p[i] - 1 >= 0 and i + p[i] + 1 < n
               and t[i - p[i] - 1] == t[i + p[i] + 1]):
            p[i] += 1
        if i + p[i] > r:
            c, r = i, i + p[i]
        total += (p[i] + 1) // 2
    return total


if __name__ == "__main__":
    print(count_palindromes("abc"))  # 3
    print(count_palindromes("aaa"))  # 6
```

---

### Challenge 3: Longest Palindrome Length via Manacher (per-center profile)

**Problem.** Given `s`, return an array `best[i]` for each original index `i` giving the length of the longest **odd** palindrome centered at `s[i]`. (Demonstrates reading the per-center profile directly from `p[]`.)

**Approach.** Real characters of `s` sit at odd `t`-indices `2i + 1`; the odd-palindrome length centered at `s[i]` is `p[2i + 1]`.

**Go.**
```go
package main

import (
	"fmt"
	"strings"
)

func oddCenterLengths(s string) []int {
	var b strings.Builder
	b.WriteByte('#')
	for i := 0; i < len(s); i++ {
		b.WriteByte(s[i])
		b.WriteByte('#')
	}
	t := b.String()
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
	out := make([]int, len(s))
	for i := range s {
		out[i] = p[2*i+1] // odd palindrome length centered at s[i]
	}
	return out
}

func main() {
	fmt.Println(oddCenterLengths("racecar")) // [1 1 1 7 1 1 1]
}
```

**Java.**
```java
import java.util.Arrays;

public class CenterProfile {
    static int[] oddCenterLengths(String s) {
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
        int[] out = new int[s.length()];
        for (int i = 0; i < s.length(); i++) out[i] = p[2 * i + 1];
        return out;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(oddCenterLengths("racecar")));
    }
}
```

**Python.**
```python
def odd_center_lengths(s):
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
    return [p[2 * i + 1] for i in range(len(s))]


if __name__ == "__main__":
    print(odd_center_lengths("racecar"))  # [1, 1, 1, 7, 1, 1, 1]
```

---

### Challenge 4: Palindrome Queries — is s[a..b] a palindrome?

**Problem.** Given `s` and `Q` queries `(a, b)`, answer for each whether `s[a..b]` is a palindrome. (Contrast tool: Manacher gives per-center radii; here we use the radius array to answer range queries by checking the center's reach. We show the hashing alternative too, which is the more natural fit for arbitrary ranges.)

**Approach (Manacher).** `s[a..b]` is a palindrome iff the palindrome centered at the transformed center `a + b + 1` (in `t`) reaches both ends, i.e. `p[a + b + 1] ≥ b - a + 1`. The transformed center of original range `[a, b]` is `a + b + 1`; its required radius is the range length `b - a + 1`.

**Go.**
```go
package main

import (
	"fmt"
	"strings"
)

type PalQuery struct{ p []int }

func newPalQuery(s string) *PalQuery {
	var b strings.Builder
	b.WriteByte('#')
	for i := 0; i < len(s); i++ {
		b.WriteByte(s[i])
		b.WriteByte('#')
	}
	t := b.String()
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
	return &PalQuery{p}
}

func (q *PalQuery) isPalindrome(a, b int) bool {
	center := a + b + 1 // transformed center of original [a,b]
	return q.p[center] >= b-a+1
}

func main() {
	q := newPalQuery("abacaba")
	fmt.Println(q.isPalindrome(0, 6)) // true  (whole string)
	fmt.Println(q.isPalindrome(0, 2)) // true  (aba)
	fmt.Println(q.isPalindrome(0, 1)) // false (ab)
}
```

**Java.**
```java
public class PalindromeQueries {
    final int[] p;

    PalindromeQueries(String s) {
        StringBuilder b = new StringBuilder("#");
        for (int i = 0; i < s.length(); i++) b.append(s.charAt(i)).append('#');
        char[] t = b.toString().toCharArray();
        int n = t.length;
        p = new int[n];
        int c = 0, r = 0;
        for (int i = 0; i < n; i++) {
            if (i < r) p[i] = Math.min(r - i, p[2 * c - i]);
            while (i - p[i] - 1 >= 0 && i + p[i] + 1 < n
                    && t[i - p[i] - 1] == t[i + p[i] + 1]) p[i]++;
            if (i + p[i] > r) { c = i; r = i + p[i]; }
        }
    }

    boolean isPalindrome(int a, int b) {
        int center = a + b + 1;
        return p[center] >= b - a + 1;
    }

    public static void main(String[] args) {
        PalindromeQueries q = new PalindromeQueries("abacaba");
        System.out.println(q.isPalindrome(0, 6)); // true
        System.out.println(q.isPalindrome(0, 2)); // true
        System.out.println(q.isPalindrome(0, 1)); // false
    }
}
```

**Python.**
```python
class PalindromeQueries:
    def __init__(self, s):
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
        self.p = p

    def is_palindrome(self, a, b):
        center = a + b + 1            # transformed center of original [a, b]
        return self.p[center] >= b - a + 1


if __name__ == "__main__":
    q = PalindromeQueries("abacaba")
    print(q.is_palindrome(0, 6))  # True
    print(q.is_palindrome(0, 2))  # True
    print(q.is_palindrome(0, 1))  # False
```

---

## Final Tips

- Lead with the one-liner: *"`p[i]` is the radius of the longest palindrome at each center; the mirror inside the box `[l, r]` initializes it, so the scan is `O(n)`."*
- Immediately flag the two gotchas: **cap the mirror copy** with `min(r − i, …)`, and Manacher counts **all occurrences, not distinct** palindromes.
- For distinct palindromes or per-prefix structure, reach for the **eertree** (sibling `14`); for arbitrary range or approximate queries, reach for **hashing**.
- Remember the recovery formula: original `start = (center − radius) / 2`, `length = radius`.
- Always offer to verify against a brute-force center-expansion oracle on small inputs.
