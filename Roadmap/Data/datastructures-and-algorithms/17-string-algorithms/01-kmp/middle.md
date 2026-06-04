# Knuth-Morris-Pratt (KMP) — Intermediate Level

> **One-line summary:** This level goes deep on *how and why* the prefix function is built in `O(m)`, the `P # T` concatenation trick that reuses the builder as a searcher, period/border detection from a single `lps` array, overlap-aware occurrence counting, and the KMP automaton — closing with a precise comparison against the Z-function, Rabin-Karp, and Boyer-Moore.

---

## Table of Contents

1. [Recap and Notation](#recap-and-notation)
2. [The Prefix Function, Constructed Carefully](#the-prefix-function-constructed-carefully)
3. [Why the Construction Is O(m)](#why-the-construction-is-om)
4. [The Pattern # Text Trick](#the-pattern--text-trick)
5. [Borders and the Border Chain](#borders-and-the-border-chain)
6. [Periods of a String](#periods-of-a-string)
7. [Counting Occurrences and Overlaps](#counting-occurrences-and-overlaps)
8. [The KMP Automaton](#the-kmp-automaton)
9. [Prefix-Function Applications](#prefix-function-applications)
10. [Code Examples](#code-examples)
11. [Comparisons: Z-function, Rabin-Karp, Boyer-Moore](#comparisons-z-function-rabin-karp-boyer-moore)
12. [Worked Example: Tracing a Search](#worked-example-tracing-a-search-end-to-end)
13. [Deriving lps Without Recomputation](#deriving-lps-without-recomputation-why-the-chain-works)
14. [Direct Matcher vs Concatenation Trick](#choosing-between-the-direct-matcher-and-the-concatenation-trick)
15. [Edge Cases](#edge-cases)
16. [Common Intermediate Pitfalls](#common-intermediate-pitfalls)
17. [Practice Checklist](#practice-checklist)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Recap and Notation

> **Where this fits:** the junior file established *what* the prefix function is and *how* the matcher uses it. This file answers the deeper *why* (the `O(m)` construction), then mines the prefix function for everything it can do — periods, borders, counting, the concatenation trick, and the automaton — before placing KMP among its siblings. If a concept here feels rushed, the proofs are in `professional.md`.

We search for a pattern `P` (length `m`) inside a text `T` (length `n`). Indices are 0-based. We write `P[a..b]` for the inclusive substring. The **prefix function** of any string `s` of length `L` is an integer array `π` (we also call it `lps`) defined by:

```
π[i] = the length of the longest PROPER prefix of s[0..i]
       that is also a SUFFIX of s[0..i]
```

"Proper" means strictly shorter than the substring itself, so `π[i] < i+1` always. A prefix that is also a suffix is called a **border**, so `π[i]` is the length of the **longest border** of `s[0..i]`. Everything KMP does — searching, period detection, compression, counting — is a thin wrapper around this array. The junior file introduced it; here we dissect the construction, prove its time bound informally, and harvest its many applications.

A small reference table for `s = "abacaba"`:

```
i:     0    1    2    3    4    5    6
s[i]:  a    b    a    c    a    b    a
π[i]:  0    0    1    0    1    2    3
```

- `π[2] = 1`: `"aba"` has border `"a"`.
- `π[5] = 2`: `"abacab"` has border `"ab"`.
- `π[6] = 3`: `"abacaba"` has border `"aba"`.

---

## The Prefix Function, Constructed Carefully

A naive prefix function checks, for each `i`, every candidate border length from `i` down to `0` and verifies it by comparing characters — that is `O(m³)` (or `O(m²)` with care). KMP computes it in `O(m)` using two facts that let us build `π[i]` from `π[i-1]` instead of from scratch.

**Fact A — borders grow by at most one.** When we move from `s[0..i-1]` to `s[0..i]`, the longest border can grow by at most a single character: `π[i] ≤ π[i-1] + 1`. Why? A border of `s[0..i]` of length `L`, with its last character chopped off, is a border of `s[0..i-1]` of length `L-1`. So if `s[0..i]` had a border longer than `π[i-1] + 1`, then `s[0..i-1]` would have one longer than `π[i-1]`, contradicting that `π[i-1]` is the longest.

**Fact B — extend or fall back.** Let `len = π[i-1]`. The character that would *extend* the previous longest border is `s[len]` (the character right after that border's prefix). 

- If `s[i] == s[len]`, the border extends: `π[i] = len + 1`.
- If `s[i] != s[len]`, the length-`len` border cannot extend. We must try the **next shorter border** of `s[0..i-1]`, which (crucially) is `π[len-1]` — the longest border of the border. We set `len = π[len-1]` and retry, repeating until either we match or `len` reaches 0.

That recursive fall-back to `π[len-1]` is the heart of the algorithm. The borders of `s[0..i-1]`, in decreasing length, are exactly `len, π[len-1], π[π[len-1]-1], …` — the **border chain** discussed below.

```
function prefix_function(s):
    L = len(s)
    pi = array of L zeros
    for i in 1 .. L-1:
        len = pi[i-1]
        while len > 0 and s[i] != s[len]:
            len = pi[len-1]
        if s[i] == s[len]:
            len += 1
        pi[i] = len
    return pi
```

---

## Why the Construction Is O(m)

The inner `while` loop makes the construction *look* quadratic, but it is amortized linear. Track the variable `len`:

- Across the whole `for` loop, `len` is **incremented** at most once per iteration (`len += 1`), so it increases at most `m - 1` times total.
- Every pass through the `while` loop **decreases** `len` (since `π[len-1] < len`). 
- `len` starts at 0 and never goes negative.

A counter that rises by at most `m-1` total and only ever drops one-or-more per `while` iteration can drop at most `m-1` times total. Therefore the `while` body executes `O(m)` times *over the entire run*, not per iteration. Combined with the `O(m)` outer loop, the construction is **`O(m)`**. This is a classic **potential / amortized** argument; the rigorous version (with the potential function `Φ = len`) is in [`professional.md`](./professional.md).

The same accounting explains why the *search* is `O(n)`: in the matcher, `j` rises by at most one per text character (≤ `n` increments) and the fall-back `j = lps[j-1]` only decreases it, so the search's inner loop runs `O(n)` times total.

A quick way to *feel* the bound: run the construction on `"aaaa"`. At each `i`, `len` extends by one (no fall-backs), so the inner `while` never executes — total work is exactly `O(m)`. Now run it on `"abababab"`: occasional single fall-backs occur, but `len` never falls more than it has risen. The pathological-looking nested loop is, in aggregate, a straight line of work. This is the same insight that makes the whole algorithm worst-case linear, and it is worth internalizing before moving to the proof in `professional.md`.

---

## The Pattern # Text Trick

A beautiful consequence: you do not even need a separate matcher. Build the prefix function of the single string

```
S = P + '#' + T
```

where `#` is a **sentinel** that occurs in neither `P` nor `T`. Compute `π` over all of `S`. Because the sentinel can never be matched, no border can be longer than `m = len(P)`. Wherever `π[i] == m`, the longest border of `S[0..i]` is the entire pattern — which means `P` *ends* at position `i` in `S`. Translating back to text coordinates:

```
match starts at  i - (m + 1) - (m - 1) = i - 2m   in T
```

(because `T` begins at offset `m+1` in `S`, and a match ending at `S`-index `i` starts `m-1` earlier).

```
function search_via_concat(P, T, sep='#'):
    S = P + sep + T
    pi = prefix_function(S)
    m = len(P)
    result = []
    for i in (m+1) .. len(S)-1:
        if pi[i] == m:
            result.append(i - 2*m)   # start index in T
    return result
```

This trick is conceptually elegant and great for proofs and contests, but it uses `O(n + m)` *extra* memory for the `π` array of the concatenation, whereas the direct matcher uses only `O(m)`. The Z-function (sibling `02`) uses the same `P # T` idea with its own array.

---

## Borders and the Border Chain

A **border** of `s` is a string that is simultaneously a proper prefix and a proper suffix. The empty string is a border of everything (length 0). The set of all border lengths of `s` (length `L`) is exactly the **border chain**:

```
π[L-1],  π[π[L-1]-1],  π[π[π[L-1]-1]-1],  …,  0
```

Each step takes the longest border of the current border. So from `π` alone you can enumerate *every* border of the whole string in `O(number of borders)` time. For `s = "abacaba"` with `π[6] = 3`: borders are length `3` (`"aba"`), then `π[2] = 1` (`"a"`), then `π[0] = 0` (empty). So `"abacaba"` has borders `"aba"`, `"a"`, and `""`.

Borders matter because **every period corresponds to a border and vice versa** (next section), and because they describe the self-overlap structure that drives KMP's shifts.

A useful mental picture: each border length is one possible "fall-back landing spot" the matcher can jump to. The border chain is the ordered list of all such landing spots, longest first. When a mismatch occurs the matcher tries them in that order until one extends — which is exactly walking the chain via `lps[len-1]`. So the abstract notion "set of all borders" and the concrete code "repeatedly assign `j = lps[j-1]`" are the same object viewed two ways. Internalizing this equivalence is the single biggest conceptual jump from junior to intermediate KMP understanding.

---

## Periods of a String

A string `s` of length `L` has **period** `p` if `s[i] == s[i+p]` for all valid `i` — equivalently, `s` is a prefix of an infinite repetition of `s[0..p-1]`. The fundamental link:

> `s` has a border of length `b` **iff** `s` has period `p = L - b`.

So the **longest** border gives the **smallest** period:

```
smallest_period(s) = L - π[L-1]
```

If `L % smallest_period == 0`, the string is a clean repetition of its period block (e.g. `"abcabcabc"`, `L = 9`, `π[8] = 6`, period `= 3`, and `9 % 3 == 0`). If it does *not* divide `L`, the period is still the smallest shift but the string is not a whole-number repetition (e.g. `"abcab"`, `L = 5`, `π[4] = 2`, period `= 3`, but `5 % 3 ≠ 0`).

To see why `period = L - longest_border`: the longest border overlaps the start and end of the string by `b` characters, so shifting the string by `L - b` aligns it with itself — that shift *is* the period. A long border means a small period (lots of self-overlap); a zero border (`π[L-1] = 0`) means period `L` (no overlap, no repetition). This is the border/period duality, proved rigorously in `professional.md` (Theorem 4).

This single formula answers a swarm of problems: "is this string a repetition of a smaller block?", "what is the shortest repeating unit?", and LeetCode 459 "Repeated Substring Pattern". The string is a non-trivial repetition iff `period < L` and `L % period == 0`.

```
function is_repetition(s):
    L = len(s)
    pi = prefix_function(s)
    period = L - pi[L-1]
    return period < L and L % period == 0
```

---

## Counting Occurrences and Overlaps

To **count** (not just locate) occurrences, run the normal matcher and increment a counter every time `j` reaches `m`, then continue with `j = lps[j-1]`. Because we fall back rather than reset, overlapping matches are counted: `"aa"` occurs twice in `"aaa"` (positions 0 and 1).

There is also a slick offline counting application of the prefix function alone. Define `cnt[len]` = number of positions `i` with `π[i] == len`. Then by propagating counts down the border chain (`cnt[π[len-1]] += cnt[len]` for `len` from high to low, plus one for each prefix itself), you can compute, for every prefix length, **how many times that prefix appears as a substring of the whole string** — a standard "number of occurrences of each prefix" technique. It is used to compress strings and analyze repetition structure.

---

## The KMP Automaton

KMP is secretly a **deterministic finite automaton (DFA)** with states `0, 1, …, m`. State `j` means "the longest suffix of the text read so far that is also a prefix of `P` has length `j`." State `m` is accepting (a full match). The transition function `δ(j, c)` answers "if I am in state `j` and read character `c`, what state am I in next?"

```
δ(j, c):
    if j < m and c == P[j]:  return j + 1          # advance
    if j == 0:               return 0              # nowhere to fall back
    return δ(lps[j-1], c)                          # follow failure link
```

Precomputing the full table costs `O(m · |Σ|)` time and space (Σ is the alphabet). The payoff: the search becomes a flat loop with **no inner `while`** — every text character triggers exactly one table lookup, so the per-character work is truly constant, which can matter for tight streaming loops. The trade-off is the memory: for a 4-letter DNA alphabet the table is tiny, but for full Unicode it is impractical and you keep the failure-link version.

```
function build_automaton(P, alphabet):
    m = len(P)
    lps = prefix_function(P)
    delta = table[m+1][|alphabet|]
    for state in 0 .. m:
        for c in alphabet:
            if state < m and c == P[state]:
                delta[state][c] = state + 1
            elif state == 0:
                delta[state][c] = 0
            else:
                delta[state][c] = delta[lps[state-1]][c]
    return delta
```

The automaton viewpoint also generalizes directly to **Aho-Corasick** (sibling `05`), which builds one big automaton with failure links over *many* patterns at once.

---

## Prefix-Function Applications

| Application | How `π` is used |
|-------------|-----------------|
| Substring search | Run the matcher; report `i - m + 1` when `j == m`. |
| Count occurrences (overlap) | Same matcher; `count++; j = lps[j-1]`. |
| Smallest period | `L - π[L-1]` (whole repetition iff it divides `L`). |
| Longest border | `π[L-1]`. |
| All borders | Walk the border chain `π[L-1], π[π[L-1]-1], …, 0`. |
| Repeated-substring-pattern | `period < L and L % period == 0`. |
| Search via builder only | `P # T`, find `π[i] == m`. |
| Count occurrences of each prefix | Propagate `cnt[]` down the border chain. |
| Build matching automaton | `δ` table from `lps` and the alphabet. |

---

## Code Examples

### Prefix function, period, repeated-pattern, and counting in three languages

#### Go

```go
package main

import "fmt"

func prefixFunction(s string) []int {
	n := len(s)
	pi := make([]int, n)
	for i := 1; i < n; i++ {
		l := pi[i-1]
		for l > 0 && s[i] != s[l] {
			l = pi[l-1]
		}
		if s[i] == s[l] {
			l++
		}
		pi[i] = l
	}
	return pi
}

func smallestPeriod(s string) int {
	n := len(s)
	if n == 0 {
		return 0
	}
	pi := prefixFunction(s)
	return n - pi[n-1]
}

func isRepetition(s string) bool {
	n := len(s)
	p := smallestPeriod(s)
	return p < n && n%p == 0
}

func countOccurrences(t, p string) int {
	if len(p) == 0 {
		return 0
	}
	pi := prefixFunction(p)
	count, j := 0, 0
	for i := 0; i < len(t); i++ {
		for j > 0 && t[i] != p[j] {
			j = pi[j-1]
		}
		if t[i] == p[j] {
			j++
		}
		if j == len(p) {
			count++
			j = pi[j-1]
		}
	}
	return count
}

func main() {
	fmt.Println(prefixFunction("abacaba")) // [0 0 1 0 1 2 3]
	fmt.Println(smallestPeriod("abcabcabc")) // 3
	fmt.Println(isRepetition("abcabcabc"))    // true
	fmt.Println(countOccurrences("aaaaa", "aa")) // 4
}
```

#### Java

```java
import java.util.*;

public class KMPMiddle {
    static int[] prefixFunction(String s) {
        int n = s.length();
        int[] pi = new int[n];
        for (int i = 1; i < n; i++) {
            int l = pi[i - 1];
            while (l > 0 && s.charAt(i) != s.charAt(l)) l = pi[l - 1];
            if (s.charAt(i) == s.charAt(l)) l++;
            pi[i] = l;
        }
        return pi;
    }

    static int smallestPeriod(String s) {
        int n = s.length();
        if (n == 0) return 0;
        int[] pi = prefixFunction(s);
        return n - pi[n - 1];
    }

    static boolean isRepetition(String s) {
        int n = s.length(), p = smallestPeriod(s);
        return p < n && n % p == 0;
    }

    static int countOccurrences(String t, String p) {
        if (p.isEmpty()) return 0;
        int[] pi = prefixFunction(p);
        int count = 0, j = 0;
        for (int i = 0; i < t.length(); i++) {
            while (j > 0 && t.charAt(i) != p.charAt(j)) j = pi[j - 1];
            if (t.charAt(i) == p.charAt(j)) j++;
            if (j == p.length()) { count++; j = pi[j - 1]; }
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(prefixFunction("abacaba"))); // [0,0,1,0,1,2,3]
        System.out.println(smallestPeriod("abcabcabc")); // 3
        System.out.println(isRepetition("abcabcabc"));    // true
        System.out.println(countOccurrences("aaaaa", "aa")); // 4
    }
}
```

#### Python

```python
def prefix_function(s: str) -> list[int]:
    n = len(s)
    pi = [0] * n
    for i in range(1, n):
        l = pi[i - 1]
        while l > 0 and s[i] != s[l]:
            l = pi[l - 1]
        if s[i] == s[l]:
            l += 1
        pi[i] = l
    return pi


def smallest_period(s: str) -> int:
    n = len(s)
    if n == 0:
        return 0
    pi = prefix_function(s)
    return n - pi[n - 1]


def is_repetition(s: str) -> bool:
    n = len(s)
    p = smallest_period(s)
    return p < n and n % p == 0


def count_occurrences(t: str, p: str) -> int:
    if not p:
        return 0
    pi = prefix_function(p)
    count = j = 0
    for ch in t:
        while j > 0 and ch != p[j]:
            j = pi[j - 1]
        if ch == p[j]:
            j += 1
        if j == len(p):
            count += 1
            j = pi[j - 1]
    return count


if __name__ == "__main__":
    print(prefix_function("abacaba"))      # [0, 0, 1, 0, 1, 2, 3]
    print(smallest_period("abcabcabc"))    # 3
    print(is_repetition("abcabcabc"))      # True
    print(count_occurrences("aaaaa", "aa"))  # 4
```

---

## Comparisons: Z-function, Rabin-Karp, Boyer-Moore

| Algorithm | Core idea | Worst case | Practical strength | Sibling |
|-----------|-----------|-----------|--------------------|---------|
| **KMP** | Prefix function / failure links; never re-read text. | **O(n + m)** | Streaming, guaranteed linear, period/border tools. | this topic |
| **Z-function** | `Z[i]` = longest substring from `i` matching a prefix. | O(n + m) | Same power as KMP; some find it cleaner; great for `P#T`. | `02-z-function` |
| **Rabin-Karp** | Rolling hash; compare hashes, verify on collision. | O(nm) worst (hash collisions); O(n + m) expected. | Multiple patterns of equal length, 2D search, plagiarism. | `03-rabin-karp` |
| **Boyer-Moore** | Match from the *right*; bad-character + good-suffix skip. | O(nm) worst (rare); sublinear average. | Long patterns over large alphabets; the fastest in practice for `grep`-like search. | `08-boyer-moore` |

All four solve exact single-pattern (or, for Rabin-Karp, multi-equal-length) matching, but they occupy different niches: KMP and Z guarantee linearity, Rabin-Karp trades determinism for multi-pattern/2D flexibility, and Boyer-Moore trades worst-case for blazing average speed. Knowing *which* to reach for is the mark of fluency.

Key contrasts:

- **KMP vs Z-function.** They are duals: both achieve `O(n+m)` and both can search via `P # T`. The prefix function reads "longest border ending here"; the Z-function reads "longest prefix-match starting here." Convert between them in linear time. Choose by familiarity; KMP's failure links extend naturally to Aho-Corasick.
- **KMP vs Rabin-Karp.** KMP is deterministic and collision-free; Rabin-Karp can be faster when you search for *many* equal-length patterns simultaneously or in 2D, but a forgotten verification step makes it incorrect on hash collisions.
- **KMP vs Boyer-Moore.** KMP *never skips* text — it only avoids re-reading. Boyer-Moore can skip whole blocks of text (sublinear average) by matching from the right, which is why `grep` and many libraries use Boyer-Moore-Horspool. But Boyer-Moore's worst case can degrade without the good-suffix rule, while KMP's `O(n+m)` is unconditional.

---

## Worked Example: Tracing a Search End to End

Let `P = "aabaa"` (so `lps = [0,1,0,1,2]`) and `T = "aabaabaaa"`. Trace the matcher:

```
i=0 'a': j=0, T[0]==P[0] → j=1
i=1 'a': T[1]='a' vs P[1]='a' → j=2
i=2 'b': T[2]='b' vs P[2]='b' → j=3
i=3 'a': T[3]='a' vs P[3]='a' → j=4
i=4 'a': T[4]='a' vs P[4]='a' → j=5 == m → MATCH at 0; j=lps[4]=2
i=5 'b': T[5]='b' vs P[2]='b' → j=3
i=6 'a': T[6]='a' vs P[3]='a' → j=4
i=7 'a': T[7]='a' vs P[4]='a' → j=5 == m → MATCH at 3; j=lps[4]=2
i=8 'a': T[8]='a' vs P[2]='b' → mismatch, j=lps[1]=1;
         T[8]='a' vs P[1]='a' → j=2
end: matches at indices 0 and 3 (overlapping)
```

Two overlapping matches, found because after each hit we set `j = lps[4] = 2` rather than 0 — the suffix `"aa"` of the first match is the prefix `"aa"` of the next. The text index `i` advanced `0 → 8` exactly once; no character was re-read as a fresh comparison. This is the linear guarantee made concrete.

---

## Deriving `lps` Without Recomputation: Why the Chain Works

A common point of confusion is *why* the fall-back is `lps[len-1]` and not, say, `lps[len]` or a fresh scan. The reason is the **border-of-a-border** structure. When the current candidate border of length `len` fails to extend (`P[i] != P[len]`), the only shorter prefixes of `P` that could still be borders of `P[0..i-1]` are precisely the borders of that length-`len` border — and the longest of *those* is `lps[len-1]`. There is no border of `P[0..i-1]` with length strictly between `lps[len-1]` and `len`, so we lose nothing by jumping directly. Skipping straight down this chain is what keeps the construction linear; a fresh scan at each step would be quadratic.

Concretely, for `P = "aabaa"` at `i=4` building `lps[4]`: `len = lps[3] = 1`, `P[4]='a' == P[1]='a'` → extend to 2. Had they mismatched, the next candidate would be `lps[0] = 0`, never some intermediate value. The chain `1 → 0` enumerates every viable border length in order.

---

## Choosing Between the Direct Matcher and the Concatenation Trick

Both find all occurrences in `O(n + m)`, but they differ operationally:

| Aspect | Direct matcher | `P # T` trick |
|--------|----------------|---------------|
| Extra memory | `O(m)` (just `lps` of `P`) | `O(n + m)` (`lps` of the whole `S`) |
| Streaming-friendly | Yes — carries one integer | No — needs the full concatenation |
| Conceptual simplicity | Two functions (build + scan) | One function (build only) |
| Best for | Production, streams, large texts | Proofs, contests, when you already have a Z/prefix builder |
| Sentinel needed | No | Yes (must be absent from both) |

In practice the direct matcher is the production default; the concatenation trick shines when you want to reuse a single, well-tested prefix-function (or Z-function) routine for everything and memory is not a constraint.

---

## Edge Cases

- **Sentinel collision** in the `P # T` trick — if `#` appears in `T`, a "border" may cross the separator and corrupt results. Pick a sentinel outside both alphabets.
- **Period that does not divide length** — `smallest_period("abcab") = 3` but `5 % 3 != 0`, so it is *not* a clean repetition; report accordingly.
- **Empty string** — `prefix_function("")` returns `[]`; `smallest_period("")` is conventionally 0; guard before indexing `π[n-1]`.
- **Single character** — `π = [0]`, period = 1, not a repetition (period equals length).
- **Automaton over a huge alphabet** — do not materialize `δ`; keep the failure-link search.

---

## Common Intermediate Pitfalls

- **Using `lps[j]` instead of `lps[j-1]`** on a mismatch. `j` is a length; the last matched index is `j-1`. Reading `lps[j]` looks at an unmatched position and produces a wrong, often too-large, fall-back.
- **Forgetting the `j % p == 0` check** for repetitions. A small period (`period < L`) only means a border exists; it is a *clean* repetition only if the period divides the length. `"abcab"` has period 3 but is not `"abc"` repeated.
- **Reusing a stale `lps`** when the pattern changes. The `lps` belongs to one specific pattern; recompute it when the pattern changes (but not per text — that is the senior-level waste).
- **Sentinel inside the alphabet.** In `P # T`, if `#` can occur in the data, borders cross the separator and the trick reports phantom matches. Pick a value provably outside both alphabets (or use a numeric sentinel for integer sequences).
- **Counting non-overlapping when overlapping is wanted (or vice versa).** Decide up front; `j = lps[j-1]` after a match gives overlapping counts, `j = 0` gives non-overlapping. State which you mean.

---

## Practice Checklist

- [ ] Build the prefix function by hand for `"aabaaab"` and verify against code.
- [ ] Implement search via the `P # T` trick and confirm it matches the direct matcher.
- [ ] Compute the smallest period of `"abcabcab"` and decide if it is a repetition.
- [ ] Count overlapping occurrences of `"aba"` in `"ababa"` (answer: 2).
- [ ] Build the KMP automaton table for `P = "aba"` over alphabet `{a, b}` and trace a search.
- [ ] Convert a prefix function to a Z-function and back; verify on random strings.
- [ ] Use the `P # T` trick to find a pattern and confirm zero phantom matches when `#` is truly absent.
- [ ] Trace the matcher on `"aabaa"` in `"aabaabaaa"` by hand and confirm two overlapping matches.

---

## Summary

The prefix function is built in amortized `O(m)` because the border length rises by at most one per position and only falls via the `π[len-1]` chain — total increments bound total decrements. From this one array flow all of KMP's powers: linear search via failure links, the `P # T` builder-only search, the border chain that enumerates every prefix-suffix overlap, the period formula `L - π[L-1]`, overlap-aware counting, and the precomputed DFA. Against its siblings, KMP guarantees `O(n+m)` like the Z-function, beats Rabin-Karp's hash fragility on worst case, and trades Boyer-Moore's sublinear-average skipping for an unconditional linear bound and natural extension to multi-pattern Aho-Corasick.

---

## Further Reading

- cp-algorithms.com — "Prefix function" (period, automaton, counting prefixes) and "Z-function".
- *Introduction to Algorithms* (CLRS) §32.4 — the KMP automaton and amortized analysis.
- Crochemore & Rytter — *Text Algorithms* — borders, periods, and the Fine–Wilf theorem context.
- Sibling `02-z-function`, `03-rabin-karp`, `08-boyer-moore`, `05-aho-corasick`.
- LeetCode 28 (Find the Index of the First Occurrence), 459 (Repeated Substring Pattern), 1392 (Longest Happy Prefix), 214 (Shortest Palindrome), 686 (Repeated String Match).
- Gusfield — *Algorithms on Strings, Trees, and Sequences* — the "fundamental preprocessing" view unifying prefix and Z functions.
- The repo `string-algorithms` skill — broader pattern-matching toolbox and when to pick each algorithm.
