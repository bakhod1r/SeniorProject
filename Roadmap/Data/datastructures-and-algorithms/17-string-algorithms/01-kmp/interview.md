# Knuth-Morris-Pratt (KMP) — Interview Preparation

KMP is a perennial interview favorite because it tests one crisp insight — *"on a mismatch, slide the pattern by the longest border instead of restarting"* — and then probes whether you can (a) build the prefix function correctly in `O(m)`, (b) justify the `O(n+m)` bound with an amortized argument, (c) recognize the byproducts (period, borders, repeated-substring detection), and (d) avoid the classic traps (overlap counting, off-by-one on the match index, confusing KMP's "no re-read" with Boyer-Moore's "skip"). This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Find first / all occurrences | KMP search with failure links | `O(n + m)` |
| Build failure function | prefix function (`lps`) | `O(m)` |
| Count occurrences (overlapping) | KMP search, `count++; j = lps[j-1]` | `O(n + m)` |
| Smallest period of `s` | `L - lps[L-1]` (clean iff divides `L`) | `O(m)` |
| Longest border / happy prefix | `lps[L-1]` | `O(m)` |
| Repeated-substring-pattern | `period < L and L % period == 0` | `O(m)` |
| Search via builder only | prefix function of `P # T`, find value `== m` | `O(n + m)` |
| **Count *simple* paths / fuzzy match** | **not KMP** (different problem) | — |

Core algorithm:

```text
buildLPS(P):                         kmpSearch(T, P):
  lps[0]=0; len=0                      lps=buildLPS(P); j=0
  for i in 1..m-1:                     for i in 0..n-1:
    while len>0 and P[i]!=P[len]:        while j>0 and T[i]!=P[j]: j=lps[j-1]
      len=lps[len-1]                     if T[i]==P[j]: j++
    if P[i]==P[len]: len++               if j==m: report i-m+1; j=lps[j-1]
    lps[i]=len
```

Key facts:
- `lps[i]` = longest proper prefix of `P[0..i]` that is also a suffix (a *border*).
- The text index never moves backward → `O(n)` search.
- After a match, `j = lps[j-1]` (not 0) to catch overlaps.
- Smallest period `= m - lps[m-1]`; it is a clean repetition iff that divides `m`.

---

## Junior Questions (12 Q&A)

### J1. What does `lps[i]` represent?
The length of the longest *proper* prefix of `P[0..i]` that is also a suffix of `P[0..i]` — equivalently the longest border of that prefix. "Proper" means it cannot be the whole substring.

### J2. Why is the naive matcher slow?
After a partial match it shifts by one and restarts comparing from the start of the pattern, re-reading text it already examined. On inputs like `T = "aaaa…ab"`, `P = "aa…ab"` this is `O(nm)`.

### J3. What is KMP's time complexity?
`O(n + m)`: `O(m)` to build the prefix function and `O(n)` to scan the text. It holds on every input — no adversarial worst case.

### J4. Why does the search never move the text index backward?
On a mismatch KMP changes only `j` (how much of the pattern matched) via `j = lps[j-1]`; the text index `i` only ever advances. Already-matched text is never re-read as a fresh comparison.

### J5. What is `lps[0]` and why?
`0`. A single character has no proper prefix, so its longest border is the empty string.

### J6. How do you find overlapping matches?
After reaching `j == m`, set `j = lps[j-1]` instead of `j = 0`. This keeps the matched suffix as state so overlapping occurrences (e.g. `"aa"` in `"aaa"`) are found.

### J7. What is the match *start* index when `j` first equals `m`?
`i - m + 1`, where `i` is the current text index. A common bug is reporting `i`.

### J8. Is KMP for one pattern or many?
One. For many patterns, generalize to Aho-Corasick, which builds one automaton with KMP-style failure links over all patterns.

### J9. Does KMP skip characters like Boyer-Moore?
No. KMP never *skips* text; it only avoids *re-reading*. Boyer-Moore matches from the right and can skip whole blocks (sublinear average).

### J10. What is a border of a string?
A string that is simultaneously a proper prefix and a proper suffix. The empty string is a border of every nonempty string. `lps[L-1]` is the longest border of the whole string.

### J11. How do you get the smallest period from `lps`?
`period = L - lps[L-1]`. If `L % period == 0`, the string is a clean repetition of its first `period` characters.

### J12. What if the pattern is empty?
Conventionally it matches everywhere (at every position including the end). Decide and document; many implementations special-case it.

---

## Mid-Level Questions (10 Q&A)

### M1. Walk through building `lps` for `"aabaaab"`.
`a a b a a a b` → `lps = [0,1,0,1,2,2,3]`. At `i=5` (`s='a'`), `len` was 2 (`s[2]='b'` mismatch... actually `len=2`, compare `s[5]='a'` vs `s[2]='b'` mismatch → `len=lps[1]=1`, `s[5]='a'` vs `s[1]='a'` match → `len=2`), giving `lps[5]=2`; at `i=6` (`'b'`), `s[6]='b'` vs `s[2]='b'` match → `len=3`.

### M2. Prove the construction is `O(m)`.
`len` rises by at most 1 per position (≤ `m-1` total rises) and every `while` pass strictly decreases it. A quantity that rises ≤ `m-1` times and only falls one-or-more per `while` pass can fall ≤ `m-1` times total, so the inner loop runs `O(m)` times across the whole build. (Potential argument with `Φ = len`.)

### M3. Explain the `P # T` trick.
Build the prefix function of `P + '#' + T` with a sentinel `#` absent from both. No border exceeds `m`. Wherever the value equals `m`, the pattern ends there, giving a match. It reuses the builder as a searcher but uses `O(n+m)` extra memory.

### M4. How do you count occurrences of each prefix of a string?
Tally `cnt[lps[i]]` over all `i`, then propagate down the border chain (`cnt[lps[k-1]] += cnt[k]` for `k` high→low) and add 1 per prefix. This counts how many times each prefix appears as a substring.

### M5. KMP vs Z-function?
Equivalent power (`O(n+m)`), interconvertible in linear time. `lps` reads "longest border ending here"; `Z` reads "longest prefix-match starting here." KMP's failure links generalize to automata/Aho-Corasick; Z is often considered simpler for one-off matching.

### M6. KMP vs Rabin-Karp?
KMP is deterministic and collision-free, `O(n+m)` always. Rabin-Karp uses rolling hashes — great for many equal-length patterns or 2D search — but is `O(nm)` worst case on collisions and incorrect if you skip verification.

### M7. KMP vs Boyer-Moore?
Boyer-Moore is sublinear on average (skips via bad-character/good-suffix from the right) and is what `grep` often uses, but can degrade without the good-suffix rule. KMP's `O(n+m)` is unconditional and streams cleanly.

### M8. What is the KMP automaton and when is it worth it?
A DFA with `m+1` states and transition `δ[state][char]`, removing the inner `while` (one lookup per char). Worth `O(m·|Σ|)` memory only for small alphabets; impractical for Unicode.

### M9. Why `j = lps[j-1]` and not `lps[j]` on mismatch?
`j` is a *length*; the last matched index is `j-1`. The longest border of the matched prefix `P[0..j-1]` is `lps[j-1]`. Using `lps[j]` reads beyond the matched region and is wrong.

### M10. How does KMP handle streaming input?
The only carry state is the integer `j` plus the immutable `lps`. Feed the text in chunks without resetting `j`; matches can span chunk boundaries. No lookback buffer is needed.

---

## Senior Questions (8 Q&A)

### S1. When would you NOT use KMP in production?
When a tuned library `indexOf`/`memmem` (SIMD prefilter) suffices on non-adversarial text — it is often several times faster. Also when matching many patterns (use Aho-Corasick) or when Boyer-Moore's average skipping wins for long patterns over large alphabets.

### S2. What Unicode pitfalls bite KMP?
Byte-level KMP on UTF-8 is correct (self-synchronizing) and fast; rune/grapheme-level needs decoding/normalization. Java's `charAt` returns UTF-16 code *units*, so astral-plane code points (emoji) are surrogate pairs and `charAt`-based KMP can match half a pair — use `codePoints()` or bytes.

### S3. How do you test a KMP implementation?
Differential testing against a naive oracle and the library matcher over random small-alphabet strings; property checks (every reported index is a real match; `0 ≤ lps[i] ≤ i`); streaming equivalence (one chunk vs byte-by-byte); adversarial timing test (`"a"*10^6` vs `"a"*1000+"b"`) to catch quadratic regressions.

### S4. Derive the worst-case comparison count.
KMP does at most `2n − 1` comparisons in the search: each text character yields one advancing/final comparison, and fall-backs are amortized against prior advances. The strong failure function (true KMP vs Morris–Pratt) shaves redundant fall-backs further.

### S5. Explain border/period duality.
`s` has a border of length `b` iff it has period `p = L − b`. So the longest border (`lps[L-1]`) gives the smallest period `L − lps[L-1]`. This is the basis of repeated-substring detection.

### S6. Where does Fine–Wilf come in?
If `s` has periods `p` and `q` with `L ≥ p + q − gcd(p,q)`, it also has period `gcd(p,q)`. It governs how multiple periods interact and underlies fast all-periodicity (runs) algorithms; the period KMP exposes is consistent with it.

### S7. How does Aho-Corasick relate to KMP?
It is KMP generalized to a trie of many patterns: a node's failure link points to the longest proper suffix of its path that is another pattern's prefix — the multi-pattern analog of `lps[j-1]`. One automaton, one `O(n + Σm + matches)` scan.

### S8. What metrics/limits would you add around a KMP service?
Cap pattern/text size at trust boundaries (the `lps` array scales with pattern length); emit matches-found, bytes-scanned, chunks-processed; log the matching granularity (byte vs rune); use a 64-bit global offset for long streams.

---

## Behavioral Prompts

- *"Tell me about a time you optimized a slow algorithm."* Frame: profiled an `O(nm)` log-scanner, identified re-reading on mismatch, switched to KMP (or a library SIMD search after benchmarking), measured the latency drop. Emphasize **measuring before and after**.
- *"Describe debugging a subtle correctness bug."* The overlap-counting bug (`j=0` vs `j=lps[j-1]`) found only by differential testing against the naive oracle — a great story about test harnesses catching off-by-one logic.
- *"When did you choose the 'boring' solution over the clever one?"* Choosing the standard-library matcher over hand-rolled KMP because benchmarks showed SIMD won on real data and the worst case was not adversarial — judgment over cleverness.
- *"Explain a complex concept to a non-expert."* Explain the failure link with the "lost-your-place-reading" analogy; gauge whether you can teach, not just code.

---

## Coding Challenges

### Challenge 1 — Substring Search (return all start indices)

**Problem.** Given text `T` and pattern `P`, return all starting indices where `P` occurs in `T` (overlaps allowed). If `P` is empty, return an empty list.

#### Go
```go
package main

import "fmt"

func buildLPS(p string) []int {
	lps := make([]int, len(p))
	l := 0
	for i := 1; i < len(p); i++ {
		for l > 0 && p[i] != p[l] {
			l = lps[l-1]
		}
		if p[i] == p[l] {
			l++
		}
		lps[i] = l
	}
	return lps
}

func search(t, p string) []int {
	if p == "" {
		return []int{}
	}
	lps := buildLPS(p)
	res := []int{}
	j := 0
	for i := 0; i < len(t); i++ {
		for j > 0 && t[i] != p[j] {
			j = lps[j-1]
		}
		if t[i] == p[j] {
			j++
		}
		if j == len(p) {
			res = append(res, i-len(p)+1)
			j = lps[j-1]
		}
	}
	return res
}

func main() { fmt.Println(search("abxabcabcaby", "abcaby")) } // [6]
```

#### Java
```java
import java.util.*;

public class Challenge1 {
    static int[] buildLPS(String p) {
        int[] lps = new int[p.length()];
        int l = 0;
        for (int i = 1; i < p.length(); i++) {
            while (l > 0 && p.charAt(i) != p.charAt(l)) l = lps[l - 1];
            if (p.charAt(i) == p.charAt(l)) l++;
            lps[i] = l;
        }
        return lps;
    }
    static List<Integer> search(String t, String p) {
        List<Integer> res = new ArrayList<>();
        if (p.isEmpty()) return res;
        int[] lps = buildLPS(p);
        int j = 0;
        for (int i = 0; i < t.length(); i++) {
            while (j > 0 && t.charAt(i) != p.charAt(j)) j = lps[j - 1];
            if (t.charAt(i) == p.charAt(j)) j++;
            if (j == p.length()) { res.add(i - p.length() + 1); j = lps[j - 1]; }
        }
        return res;
    }
    public static void main(String[] a) { System.out.println(search("abxabcabcaby", "abcaby")); } // [6]
}
```

#### Python
```python
def build_lps(p):
    lps = [0] * len(p)
    l = 0
    for i in range(1, len(p)):
        while l > 0 and p[i] != p[l]:
            l = lps[l - 1]
        if p[i] == p[l]:
            l += 1
        lps[i] = l
    return lps


def search(t, p):
    if not p:
        return []
    lps = build_lps(p)
    res, j = [], 0
    for i in range(len(t)):
        while j > 0 and t[i] != p[j]:
            j = lps[j - 1]
        if t[i] == p[j]:
            j += 1
        if j == len(p):
            res.append(i - len(p) + 1)
            j = lps[j - 1]
    return res


print(search("abxabcabcaby", "abcaby"))  # [6]
```

### Challenge 2 — Count Occurrences (overlapping)

**Problem.** Return the number of times `P` occurs in `T`, counting overlaps. Example: `count("aaaaa", "aa") == 4`.

#### Go
```go
func count(t, p string) int {
	if p == "" {
		return 0
	}
	lps := buildLPS(p) // reuse from Challenge 1
	c, j := 0, 0
	for i := 0; i < len(t); i++ {
		for j > 0 && t[i] != p[j] {
			j = lps[j-1]
		}
		if t[i] == p[j] {
			j++
		}
		if j == len(p) {
			c++
			j = lps[j-1]
		}
	}
	return c
}
```

#### Java
```java
static int count(String t, String p) {
    if (p.isEmpty()) return 0;
    int[] lps = buildLPS(p);
    int c = 0, j = 0;
    for (int i = 0; i < t.length(); i++) {
        while (j > 0 && t.charAt(i) != p.charAt(j)) j = lps[j - 1];
        if (t.charAt(i) == p.charAt(j)) j++;
        if (j == p.length()) { c++; j = lps[j - 1]; }
    }
    return c;
}
```

#### Python
```python
def count(t, p):
    if not p:
        return 0
    lps = build_lps(p)
    c = j = 0
    for ch in t:
        while j > 0 and ch != p[j]:
            j = lps[j - 1]
        if ch == p[j]:
            j += 1
        if j == len(p):
            c += 1
            j = lps[j - 1]
    return c


print(count("aaaaa", "aa"))  # 4
```

### Challenge 3 — Shortest Period (smallest repeating unit length)

**Problem.** Return the length of the smallest string `w` such that `s` is a prefix of `w` repeated. Equivalently the smallest period. Example: `period("abcabca") == 3`, `period("aba") == 2`.

#### Go
```go
func period(s string) int {
	if s == "" {
		return 0
	}
	lps := buildLPS(s)
	return len(s) - lps[len(s)-1]
}
```

#### Java
```java
static int period(String s) {
    if (s.isEmpty()) return 0;
    int[] lps = buildLPS(s);
    return s.length() - lps[s.length() - 1];
}
```

#### Python
```python
def period(s):
    if not s:
        return 0
    lps = build_lps(s)
    return len(s) - lps[-1]


print(period("abcabca"), period("aba"))  # 3 2
```

### Challenge 4 — Repeated Substring Pattern (LeetCode 459)

**Problem.** Return `true` iff `s` can be built by repeating a substring two or more times. Example: `"abab" → true`, `"aba" → false`, `"abcabcabc" → true`.

#### Go
```go
func repeatedSubstringPattern(s string) bool {
	n := len(s)
	if n < 2 {
		return false
	}
	lps := buildLPS(s)
	p := n - lps[n-1]
	return p < n && n%p == 0
}
```

#### Java
```java
static boolean repeatedSubstringPattern(String s) {
    int n = s.length();
    if (n < 2) return false;
    int[] lps = buildLPS(s);
    int p = n - lps[n - 1];
    return p < n && n % p == 0;
}
```

#### Python
```python
def repeated_substring_pattern(s):
    n = len(s)
    if n < 2:
        return False
    lps = build_lps(s)
    p = n - lps[-1]
    return p < n and n % p == 0


print(repeated_substring_pattern("abab"))       # True
print(repeated_substring_pattern("aba"))        # False
print(repeated_substring_pattern("abcabcabc"))  # True
```

### Challenge 5 — Shortest palindrome by prepending (LeetCode 214)

**Problem.** Find the shortest palindrome you can make by adding characters in front of `s`. Build `lps` of `s + '#' + reverse(s)`; the longest palindromic prefix has length `lps[last]`, so prepend the reverse of the remaining suffix.

#### Go
```go
func shortestPalindrome(s string) string {
	rev := reverse(s)
	comb := s + "#" + rev
	lps := buildLPS(comb)
	k := lps[len(lps)-1] // length of longest palindromic prefix
	return reverse(s[k:]) + s
}

func reverse(s string) string {
	b := []byte(s)
	for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
		b[i], b[j] = b[j], b[i]
	}
	return string(b)
}
```

#### Java
```java
static String shortestPalindrome(String s) {
    String rev = new StringBuilder(s).reverse().toString();
    String comb = s + "#" + rev;
    int[] lps = buildLPS(comb);
    int k = lps[lps.length - 1];
    return new StringBuilder(s.substring(k)).reverse().toString() + s;
}
```

#### Python
```python
def shortest_palindrome(s):
    comb = s + "#" + s[::-1]
    lps = build_lps(comb)
    k = lps[-1]
    return s[k:][::-1] + s


print(shortest_palindrome("aacecaaa"))  # "aaacecaaa"
print(shortest_palindrome("abcd"))      # "dcbabcd"
```

**Why it works.** `lps[last]` of `s + '#' + reverse(s)` is the longest prefix of `s` that is also a suffix of `reverse(s)` — i.e. the longest *palindromic prefix* of `s`. Whatever follows it must be mirrored in front. This is a classic "KMP in disguise" interview problem; recognizing the `P#T` shape is the whole trick.

---

## Rapid-Fire Trivia (one-liners interviewers like)

- *"What is `lps[lps.length-1]`?"* The length of the longest border of the whole string — and `length - that` is the smallest period.
- *"Can KMP run in less than `O(n)`?"* No — any exact matcher must read every text character in the worst case (`Ω(n)` lower bound).
- *"What is the worst-case comparison count?"* At most `2n − 1` with the strong failure function.
- *"Why a sentinel in `P#T`?"* So no border crosses the boundary; the sentinel must be absent from both strings.
- *"Does KMP do extra work on `"aaaa…"`?"* The build/search are still `O(m)`/`O(n)`; only *non-amortized* border-enumeration loops are quadratic on all-equal strings.
- *"KMP or Z-function in an interview?"* Either; they are equivalent. Pick the one you can write bug-free under pressure.
- *"What state does streaming KMP carry?"* One integer `j` (plus the immutable `lps`) — that is why it streams.

---

## Mock Interview Walkthrough (Substring Search)

A model 20-minute flow an interviewer expects:

1. **Clarify (1 min):** "Overlapping matches counted? Return first index or all? ASCII or Unicode? Can the pattern be empty?" Asking these signals seniority.
2. **Naive baseline (2 min):** State the `O(nm)` brute force and *why* it is slow (re-reading after partial matches). This motivates KMP.
3. **Insight (3 min):** "On a mismatch after matching a prefix, the matched text equals that prefix, so I can shift by the longest border without rewinding the text." Define `lps`.
4. **Build `lps` (5 min):** Code the prefix function; trace it on a small example aloud to catch the fall-back logic.
5. **Search (4 min):** Code the matcher; emphasize `i` never moves backward and the `j = lps[j-1]` fall-back.
6. **Complexity (2 min):** `O(n+m)` with the amortized rise-vs-fall argument.
7. **Test (3 min):** Walk one example, mention edge cases (empty pattern, overlaps, pattern longer than text) and that you would diff against a naive oracle.

Candidates who skip step 1 or 7 lose points even with correct code; the algorithm is necessary but not sufficient.

---

## Whiteboard Tips

- **State the invariant out loud:** "`j` = length of the longest pattern prefix that is a suffix of the text read so far." It makes the fall-back step obviously correct.
- **Build `lps` on a small example first** (`"abab"` or `"aabaa"`) so the interviewer sees you understand borders before you write the matcher.
- **Defend `O(n+m)` with the amortized argument** — `len`/`j` falls at most as often as it rises. Interviewers love this.
- **Mention the byproducts** (period, repeated-pattern) — it signals depth beyond memorized code.
- **Name the alternatives** (Z-function, Rabin-Karp, Boyer-Moore, Aho-Corasick) and one-line each trade-off.
- **Watch the two bugs:** `i - m + 1` for the start index, and `j = lps[j-1]` (not `0`) after a match.

---

## Summary

KMP interviews reward the failure-link insight plus disciplined execution: build the prefix function in amortized `O(m)`, scan the text once in `O(n)` without rewinding, and reuse `lps` for periods, borders, and repeated-substring detection. Be ready to prove the linear bound with the rise-vs-fall amortized argument, to contrast KMP with the Z-function, Rabin-Karp, Boyer-Moore, and Aho-Corasick, and to dodge the overlap and off-by-one traps. The four challenges here — search, overlapping count, shortest period, repeated-substring-pattern — are the canonical set; if you can write all three language versions of each from memory and explain the invariant, you are ready.

---

## Further Reading

- LeetCode 28 (Find the Index of the First Occurrence in a String), 459 (Repeated Substring Pattern), 1392 (Longest Happy Prefix), 686 (Repeated String Match).
- cp-algorithms.com — "Prefix function. Knuth-Morris-Pratt."
- *Introduction to Algorithms* (CLRS) §32.4.
- Sibling `02-z-function`, `03-rabin-karp`, `08-boyer-moore`, `05-aho-corasick`.
- The `string-algorithms` repo skill for the broader pattern-matching toolbox.
- Gusfield — *Algorithms on Strings, Trees, and Sequences* (prefix/Z-function unification).
- Sibling files `junior.md` (intuition), `middle.md` (applications), `professional.md` (proofs) in this topic.

---

## Final Checklist Before the Interview

- [ ] Can write `buildLPS` from memory in Go, Java, and Python without looking.
- [ ] Can write the matcher and explain why `i` never moves backward.
- [ ] Can state and defend the `O(n+m)` amortized argument in two sentences.
- [ ] Know the four canonical problems: search, overlapping count, shortest period, repeated-substring-pattern.
- [ ] Recognize the `P#T` shape in disguised problems (shortest palindrome, min prepend).
- [ ] Can name the trade-offs vs Z-function, Rabin-Karp, Boyer-Moore, and Aho-Corasick in one line each.
- [ ] Remember the two killer bugs: start index `i - m + 1`, and `j = lps[j-1]` (not 0) after a match.

If every box is checked, you can handle KMP at any level the interview throws at you — from "find the substring" to "prove it is linear" to "now make it streaming."
