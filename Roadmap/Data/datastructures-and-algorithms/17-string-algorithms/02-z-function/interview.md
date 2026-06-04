# The Z-Function (Z-Array) — Interview Preparation

The Z-function is a favourite interview topic because it rewards a single crisp insight — *"`z[i]` is the longest prefix of `s` that reappears starting at `i`, and the `[l,r]` box makes the whole array `O(n)`"* — and then tests whether you can (a) explain the box copy-vs-extend logic, (b) turn it into linear-time pattern matching via `p + sep + t`, (c) derive periods and borders from it, (d) convert between Z and the KMP prefix function, and (e) avoid the classic separator and off-by-one traps. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Longest prefix matched starting at `i` | `z[i]` | `O(n)` to build all |
| Does `p` occur in `t`? | Z of `p + sep + t`, find `z[i] == |p|` | `O(n + m)` |
| Occurrence position in `t` | `i - (|p| + 1)` | `O(1)` per hit |
| Is there a border of length `b`? | `z[n - b] == b` | `O(1)` after build |
| Smallest period | smallest `i` with `i + z[i] == n` | `O(n)` |
| Count distinct substrings | incremental Z on reversed prefixes | `O(n²)` |
| Z ↔ prefix function | linear conversion | `O(n)` |
| **Arbitrary substring compare** | **not Z — use suffix array** | — |

Core algorithm:

```text
zFunction(s):
    z[0] = 0; l = r = 0           # r exclusive
    for i in 1..n-1:
        if i < r: z[i] = min(r - i, z[i - l])    # copy inside box
        while i+z[i] < n and s[z[i]] == s[i+z[i]]: z[i]++   # extend
        if i + z[i] > r: l, r = i, i + z[i]       # grow box
    return z
# O(n): r only ever moves forward
```

Key facts:
- `z[i]` = longest common prefix of `s` and the suffix `s[i:]`.
- `z[0] = 0` by convention; the interesting values are `z[1..n-1]`.
- The `[l, r)` box certifies `s[l..r-1] == s[0..r-l-1]`; `r` is monotonic.
- Matching: separator caps text-region Z at `m`, so `z[i] == m` is an exact hit.
- Period `p` ⇔ border `n - p` ⇔ `z[n-p] == p` (or `i + z[i] == n` for period `i`).

---

## Junior Questions (12 Q&A)

### J1. What does `z[i]` represent?
The length of the longest substring starting at index `i` that is also a prefix of `s`. Equivalently, the longest common prefix between `s` and its suffix `s[i:]`. If `s = "aabaab"`, then `z[3] = 3` because `"aab"` (starting at 3) matches the prefix `"aab"`.

### J2. What is `z[0]`?
By convention `z[0] = 0`. The whole-string-matches-itself value (`n`) is not useful and is left out so downstream code does not accidentally treat the full string as a "match".

### J3. Why is the naive Z-function `O(n²)`?
It compares from scratch at every position. On `"aaaa…a"` each position matches almost to the end, so each of the `n` positions costs `O(n)` comparisons — `O(n²)` total.

### J4. What is the Z-box?
The interval `[l, r)` of the rightmost prefix-occurrence found so far: `s[l..r-1]` equals a prefix `s[0..r-l-1]`. It is a "free preview" of the prefix that later positions inside it can reuse.

### J5. When do we copy versus extend?
If the new index `i` is inside the box (`i < r`), copy `z[i] = min(z[i - l], r - i)`. If the copy reaches the box edge (or `i` is outside the box), extend by comparing characters explicitly.

### J6. Why the `min(z[i - l], r - i)` clamp?
Because the box only certifies characters up to `r - 1`. The mirror value `z[i - l]` is trustworthy only as far as the box reaches; beyond `r` we have not verified anything at `i`, so we clamp and then extend by real comparison.

### J7. Why is the algorithm `O(n)`?
The right pointer `r` only ever moves forward and is bounded by `n`. Every successful comparison pushes `r` one step right, so there are at most `n` successful comparisons total, plus at most one failing comparison per position — `O(n)` overall.

### J8. How do you find a pattern with the Z-function?
Build `s = p + sep + t` with a separator absent from both, compute `z`, and report every text-region index `i` with `z[i] == |p|`. The match in `t` is at `i - (|p| + 1)`.

### J9. Why is the separator needed?
It is a hard wall: a common-prefix run from the text can never match the separator, so the Z-value in the text region is capped at `|p|`. That makes `z[i] == |p|` an exact, unambiguous occurrence signal.

### J10. What is a border, and how does Z find it?
A border is a string that is both a proper prefix and a proper suffix. `s` has a border of length `b` iff `z[n - b] == b` (the suffix of length `b` matches the prefix of length `b`).

### J11. What is the time and space cost to build the array?
`O(n)` time and `O(n)` space (the output array). Space is optimal because the array itself has `n` entries.

### J12 (analysis). How does Z relate to KMP?
Both are linear-time prefix tools. Z looks forward ("how far does the suffix at `i` match the prefix?"); KMP's prefix function looks backward ("longest border ending at `i`"). They carry the same information and convert into each other in `O(n)`.

---

## Middle Questions (12 Q&A)

### M1. Prove the algorithm computes `z[i]` correctly inside the box.
If `i < r`, the mirror index is `k = i - l`, and the box guarantees `s[i..r-1]` equals the prefix segment `s[k..]` mirrored. If `z[k] < r - i`, the match ends inside the box and `z[i] = z[k]` exactly (the breaking mismatch is also inside, so it cannot extend). If `z[k] >= r - i`, we know the match holds to the box edge and must extend by explicit comparison past `r`. Hence `z[i] = min(z[k], r - i)` then extend.

### M2. Why does `r` only move forward?
We update `r = i + z[i]` only when `i + z[i] > r`, which is strictly increasing. Since `z[i] <= n - i`, `r <= n`. Monotone and bounded ⇒ at most `n` total advances ⇒ linear time.

### M3. How do you compute the smallest period from Z?
Scan `i` from `1`; the first `i` with `i + z[i] == n` means the suffix at `i` matches the prefix to the end, giving border `n - i` and period `i`. If you require exact tiling, also check `i | n`. If none, the period is `n`.

### M4. How does Z-matching achieve `O(n + m)`?
One Z-pass over `s = p + sep + t` of length `m + 1 + nt` is `O(m + nt)`, and scanning for `z[i] == m` is linear. So matching is `O(n + m)`, the same as KMP.

### M5. Convert a Z-array to the prefix function. Sketch the idea.
For each `i` with `z[i] = L`, the prefix block of length `L` reappears at `i`, so positions `i, i+1, …, i+L-1` get borders `1, 2, …, L`. Walk `j` from `L-1` down to `0` setting `π[i+j] = j+1` until you hit an already-set (longer) value. `O(n)` because each `π` entry is written once.

### M6. Convert the prefix function to a Z-array. Sketch the idea.
For each `i` with `π[i] = L > 0`, a border of length `L` ends at `i`, so the match starts at `i - L + 1`: set `z[i - L + 1] = max(…, L)`. Then propagate each block's partial overlaps forward (`z[i + j] = z[i] - j` until a larger value is present). `O(n)`.

### M7. What is the difference between a walk-style "copy" with `r` inclusive vs exclusive?
With `r` *exclusive* the clamp is `min(r - i, z[i - l])`; with `r` *inclusive* it is `min(r - i + 1, z[i - l])`. Mixing them is the classic off-by-one. Pick one and document it.

### M8. When is Z better than Rabin-Karp?
Z is `O(n + m)` worst-case and deterministic; Rabin-Karp is `O(n + m)` average but `O(nm)` worst-case (hash collisions) and probabilistic unless verified. For a single pattern with worst-case guarantees, Z (or KMP) wins. Rabin-Karp shines for multiple patterns via a hash set.

### M9. How do you count distinct substrings with Z?
Grow the string one character at a time; at each step the number of new distinct substrings is `currentLength - maxZ`, where `maxZ` is the max Z-value of the reversed current string. Summing gives `O(n²)`. Suffix automata do it in `O(n)`, but the Z version is the simplest to verify.

### M10. Why can Z compare a suffix to the prefix but not two arbitrary substrings?
`z[i]` is defined relative to *the prefix* of `s`. To compare two arbitrary substrings you need a structure like a suffix array with LCP, or a suffix automaton — Z only answers the prefix-vs-suffix question.

### M11. What happens at the boundary in `p + sep + t` if you forget the separator?
A text run that begins like `p` could keep matching `p`'s continuation that lives in `t`, so `z[i]` could exceed `m` and the cap `z[i] <= m` fails. You would get wrong matches. The separator restores the cap.

### M12 (analysis). What is the worst case for the box version, and why is it still linear?
`"aaaa…a"` maximizes copying and box growth, but because `r` sweeps from `0` to `n` exactly once and each successful comparison advances it, the total comparisons stay `O(n)`. The naive version is `O(n²)` on the same input; the box version is not.

---

## Senior Questions (10 Q&A)

### S1. How would you match a pattern in a multi-gigabyte text without doubling memory?
Avoid materializing `p + sep + t`. Precompute the Z-array of `p` only (`O(m)` space), then stream `t` maintaining an `[l, r]` box, copying from the pattern's Z-array inside the box and extending by comparing text against pattern characters. Space `O(m)`, time `O(m + |t|)`, and the box state can carry across streamed chunks (retain the last `m-1` bytes).

### S2. The text is arbitrary binary with no safe separator. What do you do?
Use an integer-array representation with a sentinel value (e.g. `-1`) that cannot occur in the data, or use the separator-free streaming variant from S1. Never assume a particular byte is "rare enough" — that is a silent correctness bug and, with attacker-chosen input, a vulnerability.

### S3. Bytes or code points for Unicode matching?
Default to byte-level Z on UTF-8 for *exact* matching: UTF-8 is prefix-free, so byte equality equals string equality, and it is fast. Switch to a code-point integer array only when you must report character offsets or compare under Unicode normalization (NFC/NFD). Never mix byte and rune indices.

### S4. How do you verify a Z-function implementation?
Compare against a naive-Z oracle entrywise on thousands of random short strings over a tiny alphabet (small alphabets maximize box reuse and exercise the copy/extend branches). Add invariants: `z[0] == 0`, `0 <= z[i] <= n - i`, `r` monotonic, and a matching cross-check against naive substring search.

### S5. When would you choose KMP over Z and vice versa?
Both are `O(n + m)`. Prefer KMP when you must stream the text character by character and dislike the concatenation. Prefer Z when its forward definition makes the surrounding logic clearer (you already need prefix overlaps) and the concatenation is cheap. The complexity is identical; the choice is ergonomic.

### S6. How do you test for compressibility / repetition with Z?
A buffer is `n/p` copies of a length-`p` cell iff `p | n` and `z[p] == n - p`. This `O(n)` test is used in deduplication and protocol framing. The smallest period is found by scanning for the first `i` with `i + z[i] == n`.

### S7. What is the off-by-one that survives small tests?
The clamp polarity: `min(r - i + 1, …)` with an *exclusive* `r` reads one unverified character. It often passes on short or non-repetitive strings and fails on `"aaaa…"`-style inputs. Guard with the invariant `z[i] <= n - i` and the naive oracle.

### S8. How do you handle empty pattern or empty text?
Decide and document conventions: an empty pattern conventionally matches at every position (or you reject it); an empty text yields no matches. Guard `m == 0` and `n == 0` explicitly to avoid reading `z[0]` or computing `i - (m+1)` with `m = 0`.

### S9. Is the Z-function safe against denial-of-service via crafted input?
Yes — it has no `O(n²)` pathological input (unlike naive matching), so its runtime is `O(n)` regardless of the data. The remaining hazard is the separator collision, which you neutralize with an integer sentinel or the separator-free variant.

### S10 (analysis). Prove the `2n` comparison bound.
Each iteration has at most one *failing* comparison (the extend loop stops at the first mismatch) — at most `n` failures. Each *successful* comparison advances `i + z[i]` and ultimately the monotone `r` by one; `r` rises from `0` to at most `n`, so at most `n` successes. Total `<= 2n` comparisons, hence `O(n)`.

---

## Professional Questions (8 Q&A)

### P1. Design a single-pattern search service over a fixed large corpus.
If the pattern varies per query and the corpus is fixed, Z (which is built per `p + sep + t`) rebuilds work each query — instead build a suffix structure (`04`/`12`) once for the corpus and answer each query in `O(m)`. Z is the right tool when the *text* varies per query (e.g. scanning a stream) or when you need a one-shot match without preprocessing.

### P2. How do you make matching collision-proof for untrusted input?
Represent input as integer arrays and append a sentinel outside the value range; or use the separator-free streaming algorithm. Both make a cross-boundary match structurally impossible, removing the collision class of bugs entirely.

### P3. Your Z-array uses too much memory at scale. What levers exist?
Use `int32` (or `int16` for `n < 32768`) instead of 64-bit indices; avoid materializing the concatenation via the streaming variant (`O(m)` space); reuse a single scratch array across queries; and chunk texts that approach the `int32` index limit.

### P4. How do you debug "the matcher returns wrong positions"?
Cross-check against naive substring search on the exact failing input. Check the usual suspects: separator collision (does the separator occur in the data?), clamp off-by-one (inclusive vs exclusive `r`), byte-vs-rune index confusion for non-ASCII, and the `i - (m+1)` offset. Assert `z[i] <= n - i` to catch over-reads.

### P5. When is Z the wrong tool entirely?
For approximate/fuzzy matching (use edit distance, sibling `06`), for many patterns at once (Aho-Corasick, sibling `05`), for repeated arbitrary-substring queries on a static text (suffix array/automaton), or when you need streaming and find the concatenation awkward (KMP). Z is exact, single-pattern, prefix-oriented.

### P6. How do you parallelize a batch of independent pattern searches?
Each `(p_i, t_i)` Z-match is independent, so distribute queries across workers. The Z-pass itself is inherently sequential (the box state is serial), so parallelism lives across queries, not within a single Z computation.

### P7. Explain the Z ↔ prefix-function equivalence to a colleague.
`z[i] = L` says a prefix block reappears at `i`, which means positions `i..i+L-1` each have a border (lengths `1..L`); the prefix function records the longest such border at each position. Conversely a border of length `L` ending at `i` means the prefix matches starting at `i - L + 1`, giving a Z-value there. Both encode the same prefix-repetition structure and convert in `O(n)` without re-reading the string.

### P8 (analysis). Why is `O(n + m)` matching optimal?
In the comparison model, certifying presence or absence of `p` in `t` may require examining every character of both — `Ω(n + m)`. Z-matching attains `O(n + m)`, so it is optimal up to constants; no algorithm can asymptotically beat it for exact single-pattern search.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a quadratic string scan with a linear algorithm.
Look for a concrete story: a naive substring/overlap scan that became a bottleneck on large or repetitive inputs, the insight that the prefix-overlap question is exactly the Z-function, the switch to `O(n)`, and a measured speedup. Strong answers mention validating against the old slow version on the same inputs.

### B2. A teammate's matcher fails on certain customer data. How do you investigate?
Suspect the separator collision first: ask whether the chosen separator can appear in customer data. Reproduce with the exact input, cross-check against naive search, and propose the int-sentinel or separator-free variant as the durable fix. Frame it as hardening against arbitrary input, not blame.

### B3. Design a feature that detects whether an uploaded file is a redundant repetition of a small block.
Compute the Z-array and test `z[p] == n - p` with `p | n` for candidate cell sizes (or just find the smallest period via `i + z[i] == n`). Discuss byte-level operation, memory for large files (`int32` array, streaming), and reporting the compression ratio `n/p`.

### B4. How would you explain the Z-box to a junior engineer?
Use the "photocopy of the avenue" analogy: the box is a copy of part of the prefix you already verified; a new side street overlapping the copy reads its answer off the copy (copy step) instead of re-walking, and only walks for itself past the edge of the copy (extend step). Emphasize the two gotchas first: the clamp off-by-one and the matching separator.

### B5. Your matching job is slow on some inputs but fast on others. How do you diagnose?
Confirm you did not break the linear guarantee: are you extending from the copied value (not from `0`), and are you growing the box on `i + z[i] > r`? If either is missing, the algorithm degrades toward `O(n²)` on repetitive inputs. Add a test asserting `r` is monotonic and that the comparison count is `O(n)`.

---

## Coding Challenges

### Challenge 1: Substring Search via Z

**Problem.** Given a pattern `p` and text `t`, return all start positions (0-based) where `p` occurs in `t`, using one Z-pass over `p + sep + t`.

**Example.**
```text
p = "ab", t = "abcabxabab"  ->  [0, 3, 6, 8]
p = "aa", t = "aaaa"        ->  [0, 1, 2]
```

**Constraints.** `1 ≤ |p| ≤ |t| ≤ 10^6`. Use a separator absent from both.

**Optimal.** Z-function, `O(|p| + |t|)`.

**Go.**
```go
package main

import "fmt"

func zFunction(s []byte) []int {
	n := len(s)
	z := make([]int, n)
	l, r := 0, 0
	for i := 1; i < n; i++ {
		if i < r {
			z[i] = minInt(r-i, z[i-l])
		}
		for i+z[i] < n && s[z[i]] == s[i+z[i]] {
			z[i]++
		}
		if i+z[i] > r {
			l, r = i, i+z[i]
		}
	}
	return z
}

func search(p, t string) []int {
	s := []byte(p + "\x01" + t)
	z := zFunction(s)
	m := len(p)
	var out []int
	for i := m + 1; i < len(s); i++ {
		if z[i] == m {
			out = append(out, i-(m+1))
		}
	}
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println(search("ab", "abcabxabab")) // [0 3 6 8]
	fmt.Println(search("aa", "aaaa"))       // [0 1 2]
}
```

**Java.**
```java
import java.util.*;

public class ZSearch {
    static int[] zFunction(char[] s) {
        int n = s.length;
        int[] z = new int[n];
        int l = 0, r = 0;
        for (int i = 1; i < n; i++) {
            if (i < r) z[i] = Math.min(r - i, z[i - l]);
            while (i + z[i] < n && s[z[i]] == s[i + z[i]]) z[i]++;
            if (i + z[i] > r) { l = i; r = i + z[i]; }
        }
        return z;
    }

    static List<Integer> search(String p, String t) {
        char[] s = (p + "" + t).toCharArray();
        int[] z = zFunction(s);
        int m = p.length();
        List<Integer> out = new ArrayList<>();
        for (int i = m + 1; i < s.length; i++)
            if (z[i] == m) out.add(i - (m + 1));
        return out;
    }

    public static void main(String[] args) {
        System.out.println(search("ab", "abcabxabab")); // [0, 3, 6, 8]
        System.out.println(search("aa", "aaaa"));        // [0, 1, 2]
    }
}
```

**Python.**
```python
def z_function(s):
    n = len(s)
    z = [0] * n
    l, r = 0, 0
    for i in range(1, n):
        if i < r:
            z[i] = min(r - i, z[i - l])
        while i + z[i] < n and s[z[i]] == s[i + z[i]]:
            z[i] += 1
        if i + z[i] > r:
            l, r = i, i + z[i]
    return z


def search(p, t, sep="\x01"):
    s = p + sep + t
    z = z_function(s)
    m = len(p)
    return [i - (m + 1) for i in range(m + 1, len(s)) if z[i] == m]


if __name__ == "__main__":
    print(search("ab", "abcabxabab"))  # [0, 3, 6, 8]
    print(search("aa", "aaaa"))        # [0, 1, 2]
```

---

### Challenge 2: Count Distinct Substrings

**Problem.** Count the number of distinct non-empty substrings of `s` using the Z-function incrementally.

**Example.**
```text
s = "aaa"  ->  3   ("a", "aa", "aaa")
s = "abab" ->  7   ("a","b","ab","ba","aba","bab","abab")
```

**Approach.** Build `s` one character at a time (prepending so suffixes map to prefixes of the reversed view). When the current length is `L`, the number of new distinct substrings is `L - maxZ`, where `maxZ` is the max Z-value of the current (reversed) string. `O(n²)`.

**Go.**
```go
package main

import "fmt"

func zFunction(s []byte) []int {
	n := len(s)
	z := make([]int, n)
	l, r := 0, 0
	for i := 1; i < n; i++ {
		if i < r {
			z[i] = minInt(r-i, z[i-l])
		}
		for i+z[i] < n && s[z[i]] == s[i+z[i]] {
			z[i]++
		}
		if i+z[i] > r {
			l, r = i, i+z[i]
		}
	}
	return z
}

func distinctSubstrings(s string) int64 {
	cur := []byte{}
	var total int64
	for k := 0; k < len(s); k++ {
		// prepend s[k] so new substrings are prefixes after reversing
		cur = append([]byte{s[k]}, cur...)
		z := zFunction(cur)
		maxZ := 0
		for _, v := range z {
			if v > maxZ {
				maxZ = v
			}
		}
		total += int64(len(cur) - maxZ)
	}
	return total
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println(distinctSubstrings("aaa"))  // 3
	fmt.Println(distinctSubstrings("abab")) // 7
}
```

**Java.**
```java
public class DistinctSubstrings {
    static int[] zFunction(char[] s) {
        int n = s.length;
        int[] z = new int[n];
        int l = 0, r = 0;
        for (int i = 1; i < n; i++) {
            if (i < r) z[i] = Math.min(r - i, z[i - l]);
            while (i + z[i] < n && s[z[i]] == s[i + z[i]]) z[i]++;
            if (i + z[i] > r) { l = i; r = i + z[i]; }
        }
        return z;
    }

    static long distinctSubstrings(String s) {
        StringBuilder cur = new StringBuilder();
        long total = 0;
        for (int k = 0; k < s.length(); k++) {
            cur.insert(0, s.charAt(k)); // prepend
            int[] z = zFunction(cur.toString().toCharArray());
            int maxZ = 0;
            for (int v : z) maxZ = Math.max(maxZ, v);
            total += cur.length() - maxZ;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(distinctSubstrings("aaa"));  // 3
        System.out.println(distinctSubstrings("abab")); // 7
    }
}
```

**Python.**
```python
def z_function(s):
    n = len(s)
    z = [0] * n
    l, r = 0, 0
    for i in range(1, n):
        if i < r:
            z[i] = min(r - i, z[i - l])
        while i + z[i] < n and s[z[i]] == s[i + z[i]]:
            z[i] += 1
        if i + z[i] > r:
            l, r = i, i + z[i]
    return z


def distinct_substrings(s):
    cur = ""
    total = 0
    for ch in s:
        cur = ch + cur  # prepend
        z = z_function(cur)
        max_z = max(z) if z else 0
        total += len(cur) - max_z
    return total


if __name__ == "__main__":
    print(distinct_substrings("aaa"))   # 3
    print(distinct_substrings("abab"))  # 7
```

---

### Challenge 3: Shortest Period of a String

**Problem.** Given `s`, return its smallest period `p` (the shortest `p` such that `s` is `s[0..p-1]` repeated, tiling `s` exactly). If `s` is primitive, return `|s|`.

**Example.**
```text
"abcabcabc" -> 3
"aaaa"      -> 1
"abcd"      -> 4
"abab"      -> 2
```

**Approach.** Compute Z. The smallest `p` with `p | n` and `z[p] == n - p` is the smallest exact-tiling period.

**Go.**
```go
package main

import "fmt"

func zFunction(s []byte) []int {
	n := len(s)
	z := make([]int, n)
	l, r := 0, 0
	for i := 1; i < n; i++ {
		if i < r {
			z[i] = minInt(r-i, z[i-l])
		}
		for i+z[i] < n && s[z[i]] == s[i+z[i]] {
			z[i]++
		}
		if i+z[i] > r {
			l, r = i, i+z[i]
		}
	}
	return z
}

func shortestPeriod(s string) int {
	n := len(s)
	z := zFunction([]byte(s))
	for p := 1; p < n; p++ {
		if n%p == 0 && z[p] == n-p {
			return p
		}
	}
	return n
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println(shortestPeriod("abcabcabc")) // 3
	fmt.Println(shortestPeriod("aaaa"))       // 1
	fmt.Println(shortestPeriod("abcd"))       // 4
	fmt.Println(shortestPeriod("abab"))       // 2
}
```

**Java.**
```java
public class ShortestPeriod {
    static int[] zFunction(char[] s) {
        int n = s.length;
        int[] z = new int[n];
        int l = 0, r = 0;
        for (int i = 1; i < n; i++) {
            if (i < r) z[i] = Math.min(r - i, z[i - l]);
            while (i + z[i] < n && s[z[i]] == s[i + z[i]]) z[i]++;
            if (i + z[i] > r) { l = i; r = i + z[i]; }
        }
        return z;
    }

    static int shortestPeriod(String s) {
        int n = s.length();
        int[] z = zFunction(s.toCharArray());
        for (int p = 1; p < n; p++)
            if (n % p == 0 && z[p] == n - p) return p;
        return n;
    }

    public static void main(String[] args) {
        System.out.println(shortestPeriod("abcabcabc")); // 3
        System.out.println(shortestPeriod("aaaa"));        // 1
        System.out.println(shortestPeriod("abcd"));        // 4
        System.out.println(shortestPeriod("abab"));        // 2
    }
}
```

**Python.**
```python
def z_function(s):
    n = len(s)
    z = [0] * n
    l, r = 0, 0
    for i in range(1, n):
        if i < r:
            z[i] = min(r - i, z[i - l])
        while i + z[i] < n and s[z[i]] == s[i + z[i]]:
            z[i] += 1
        if i + z[i] > r:
            l, r = i, i + z[i]
    return z


def shortest_period(s):
    n = len(s)
    z = z_function(s)
    for p in range(1, n):
        if n % p == 0 and z[p] == n - p:
            return p
    return n


if __name__ == "__main__":
    print(shortest_period("abcabcabc"))  # 3
    print(shortest_period("aaaa"))        # 1
    print(shortest_period("abcd"))        # 4
    print(shortest_period("abab"))        # 2
```

---

### Challenge 4: String Matching with One Z Pass (count occurrences)

**Problem.** Given `p` and `t`, return the *number* of occurrences of `p` in `t` using exactly one Z-function pass over the concatenation, and also return the position of the first occurrence (or `-1`).

**Example.**
```text
p = "aba", t = "ababa"  -> count = 2, first = 0  (positions 0 and 2)
p = "xyz", t = "ababa"  -> count = 0, first = -1
```

**Approach.** Single Z-pass over `p + sep + t`; tally and record the first `z[i] == m`.

**Go.**
```go
package main

import "fmt"

func zFunction(s []byte) []int {
	n := len(s)
	z := make([]int, n)
	l, r := 0, 0
	for i := 1; i < n; i++ {
		if i < r {
			z[i] = minInt(r-i, z[i-l])
		}
		for i+z[i] < n && s[z[i]] == s[i+z[i]] {
			z[i]++
		}
		if i+z[i] > r {
			l, r = i, i+z[i]
		}
	}
	return z
}

func matchOnePass(p, t string) (int, int) {
	s := []byte(p + "\x01" + t)
	z := zFunction(s)
	m := len(p)
	count, first := 0, -1
	for i := m + 1; i < len(s); i++ {
		if z[i] == m {
			count++
			if first == -1 {
				first = i - (m + 1)
			}
		}
	}
	return count, first
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println(matchOnePass("aba", "ababa")) // 2 0
	fmt.Println(matchOnePass("xyz", "ababa")) // 0 -1
}
```

**Java.**
```java
public class MatchOnePass {
    static int[] zFunction(char[] s) {
        int n = s.length;
        int[] z = new int[n];
        int l = 0, r = 0;
        for (int i = 1; i < n; i++) {
            if (i < r) z[i] = Math.min(r - i, z[i - l]);
            while (i + z[i] < n && s[z[i]] == s[i + z[i]]) z[i]++;
            if (i + z[i] > r) { l = i; r = i + z[i]; }
        }
        return z;
    }

    static int[] matchOnePass(String p, String t) {
        char[] s = (p + "" + t).toCharArray();
        int[] z = zFunction(s);
        int m = p.length(), count = 0, first = -1;
        for (int i = m + 1; i < s.length; i++) {
            if (z[i] == m) {
                count++;
                if (first == -1) first = i - (m + 1);
            }
        }
        return new int[]{count, first};
    }

    public static void main(String[] args) {
        int[] a = matchOnePass("aba", "ababa");
        System.out.println(a[0] + " " + a[1]); // 2 0
        int[] b = matchOnePass("xyz", "ababa");
        System.out.println(b[0] + " " + b[1]); // 0 -1
    }
}
```

**Python.**
```python
def z_function(s):
    n = len(s)
    z = [0] * n
    l, r = 0, 0
    for i in range(1, n):
        if i < r:
            z[i] = min(r - i, z[i - l])
        while i + z[i] < n and s[z[i]] == s[i + z[i]]:
            z[i] += 1
        if i + z[i] > r:
            l, r = i, i + z[i]
    return z


def match_one_pass(p, t, sep="\x01"):
    s = p + sep + t
    z = z_function(s)
    m = len(p)
    count, first = 0, -1
    for i in range(m + 1, len(s)):
        if z[i] == m:
            count += 1
            if first == -1:
                first = i - (m + 1)
    return count, first


if __name__ == "__main__":
    print(match_one_pass("aba", "ababa"))  # (2, 0)
    print(match_one_pass("xyz", "ababa"))  # (0, -1)
```

---

## Final Tips

- Lead with the one-liner: *"`z[i]` is the longest prefix of `s` reappearing at `i`; the `[l,r]` box makes the whole array `O(n)` because `r` only moves forward."*
- Immediately flag the two gotchas: the **clamp off-by-one** (inclusive vs exclusive `r`) and the **matching separator** that must be absent from the inputs.
- For matching, state the trick crisply: run Z on `p + sep + t`, report `z[i] == |p|` at `i - (|p| + 1)`.
- For periods/borders, recall `z[n-b] == b` (border) and `i + z[i] == n` (period `i`).
- If asked about KMP, mention the `O(n)` conversion both ways and that they carry the same information.
- Always offer to validate against a naive-Z oracle and naive substring search on small inputs.
