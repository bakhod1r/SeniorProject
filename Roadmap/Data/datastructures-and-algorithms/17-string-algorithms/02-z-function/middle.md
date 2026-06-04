# The Z-Function (Z-Array) — Middle Level

> **Focus:** The `[l, r]` Z-box computation in full detail (the two cases and the clamp), pattern matching via concatenation with a separator, period and border detection through Z, the Z ↔ prefix-function conversion, and how Z stacks up against KMP, Rabin-Karp, and suffix structures.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Z-box Computation, Case by Case](#the-z-box-computation-case-by-case)
4. [Pattern Matching via Concatenation](#pattern-matching-via-concatenation)
5. [Periods and Borders via Z](#periods-and-borders-via-z)
6. [Z ↔ Prefix-Function Conversion](#z--prefix-function-conversion)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: `z[i]` is the longest common prefix between `s` and its suffix at `i`, and the Z-box makes the whole array `O(n)`. At middle level you start asking the engineering questions that decide whether your solution is correct *and* fast:

- Exactly when do we **copy** `z[i - l]` and when must we **extend** by explicit comparison, and why does the `min` clamp prevent reading characters we have not verified?
- How does the separator in `p + # + t` guarantee correctness, and what happens if you pick a bad separator?
- How do periods and borders fall out of the Z-array, and how does that relate to the KMP prefix function?
- How do you **convert** between the Z-array and the prefix function in linear time, and when would you bother?
- When is Z the right tool versus KMP, Rabin-Karp (sibling `03-rabin-karp`), or a suffix array (sibling `04-suffix-arrays`)?

These are the questions that separate "I memorized the Z loop" from "I can choose and adapt the right linear-time string tool."

A recurring theme below is that the Z-function is rarely the *whole* solution — it is a primitive you compose. Matching composes it with a concatenation; period detection composes it with a divisor scan; the prefix-function conversion composes it with a second array pass. Learning the compositions matters as much as learning the loop, because real problems arrive phrased in terms of borders, periods, repetitions, or occurrences, and your job is to recognize which Z-composition answers them.

---

## Deeper Concepts

### The invariant that makes it work

The whole algorithm rests on one invariant about the box `[l, r]`:

```
At all times, s[l .. r-1] == s[0 .. r-l-1]      (r exclusive)
```

In words: the substring inside the current box is *identical* to a prefix of `s` of the same length. This is precisely why, when a new index `i` lands inside the box, the prefix character that `s[i]` corresponds to is `s[i - l]`, and the Z-value computed earlier at `i - l` is reusable.

This invariant is maintained automatically: we only ever set `r = i + z[i]` after computing `z[i]`, and by the definition of `z[i]` the segment `s[i..i+z[i]-1]` *equals* the prefix `s[0..z[i]-1]`. So the new box is, by construction, a verified prefix occurrence. There is no separate step to "establish" the invariant — it falls out of how `z[i]` is defined and when we update the box.

The box is always the **rightmost** such verified interval — the one whose `r` is largest. We keep it rightmost because that maximizes how much free information later positions can reuse. This rightmost-box choice is what guarantees `r` only moves forward, which is the source of the linear bound (proved in [`professional.md`](./professional.md)).

Why *rightmost* and not, say, the longest box? Because the value to a future position `i` is "does the box cover `i`", and only the rightmost box can cover the largest range of upcoming positions. A box that ended earlier would force more positions into the from-scratch case. By always keeping the box with the largest `r`, we maximize reuse and — crucially — make `r` monotonic, which is exactly the property the amortized analysis charges against. So "rightmost box" is not an arbitrary bookkeeping choice; it is the precise invariant that buys linear time.

One more consequence of the invariant: the box is always a *suffix-prefix* witness. When we set `r = i + z[i]`, we are recording that "the prefix of length `z[i]` reappears starting at `i`". Every later query reuses this witness. The algorithm is therefore best understood not as "scanning for matches" but as "incrementally discovering and reusing the rightmost place the prefix reappears". That reframing — discovery plus reuse — is the conceptual leap from the naive `O(n²)` scan to the linear box version.

### Why "copy" is only a starting point, not the answer

A subtle point that trips many people up: when `i` is inside the box, `z[i - l]` is *not always* the final answer. It is only guaranteed correct **up to the box edge**. If `z[i - l]` would reach past `r`, we cannot trust it beyond `r` because we have not actually compared those characters at position `i` yet. That is exactly what the `min(z[i - l], r - i)` clamp encodes:

- If `z[i - l] < r - i`: the matched region from `i - l` ends *strictly inside* the box, so we can copy it wholesale — `z[i] = z[i - l]`, no comparison needed.
- If `z[i - l] >= r - i`: the matched region reaches (or would exceed) the box edge, so we copy up to the edge and then **try to extend** by explicit comparison past `r`.

---

## The Z-box Computation, Case by Case

Let us be fully explicit about the three situations the loop body handles at index `i`.

**Situation 1 — `i` is outside the box (`i >= r`).** No free information. Start `z[i] = 0` and compare from scratch: while `i + z[i] < n` and `s[z[i]] == s[i + z[i]]`, increment. This is the only situation where we begin the comparison at offset `0`.

**Situation 2 — `i` inside the box and the copy stays strictly inside (`z[i - l] < r - i`).** The matched run from the mirror position `i - l` ends before the box edge, so the same run must occur at `i` (the box equals a prefix). Set `z[i] = z[i - l]` and do **no** comparisons. We also know `s[i + z[i]] != s[z[i]]` because that mismatch was already established at the mirror position — so we could not extend even if we tried.

**Situation 3 — `i` inside the box and the copy hits the edge (`z[i - l] >= r - i`).** We know the match holds at least up to the box edge `r`, so set `z[i] = r - i`, then **extend**: while `i + z[i] < n` and `s[z[i]] == s[i + z[i]]`, increment. The extension may push past `r`.

In code, Situations 2 and 3 are merged by the clamp `z[i] = min(z[i - l], r - i)` followed unconditionally by the extend loop (which simply does nothing in Situation 2 because the next characters already mismatch). After computing `z[i]`, if `i + z[i] > r` we move the box: `l = i, r = i + z[i]`.

### Why merging the situations is safe

The merge works because the extend loop is *self-limiting*. In Situation 2 (copy ends strictly inside), the first character it would compare is the one that already mismatched at the mirror position — so it stops immediately, costing one wasted comparison and leaving `z[i] = z[i - l]` intact. In Situation 3 (copy reaches the edge), the extend loop does the genuine work past `r`. Writing the two situations as one clamp-then-extend block is therefore both correct and concise; the only "cost" is the single redundant comparison in Situation 2, which does not affect the linear bound (it is one of the at-most-`n` failing comparisons in the amortized analysis). This is why nearly every reference implementation uses the merged form rather than branching explicitly on `z[i - l]` vs `r - i`.

### The mirror, visualized

Think of the box `s[l..r-1]` as a copy of the prefix `s[0..r-l-1]`. When you stand at `i` inside the box, you are standing at offset `i - l` into that copy — and offset `i - l` into the copy is the same as offset `i - l` into the actual prefix. So the Z-value computed earlier at the prefix position `i - l` describes how the prefix continues there, which (up to the box edge) is exactly how the suffix at `i` continues. That correspondence — *position `i` in the box mirrors position `i - l` in the prefix* — is the single mental model that makes the copy step intuitive.

### A trace highlighting all three situations

`s = "aaabaab"` (length 7), `r` exclusive:

```
index : 0 1 2 3 4 5 6
char  : a a a b a a b
```

- `i=1` (Sit. 1, `i >= r=0`): extend `a=a`, `a=a`, `a≠b`? `s[2]='a'`=`s[3]='b'`? no → `z[1]=2`. Box → `l=1, r=3`.
- `i=2` (`i<r=3`): `z[i-l]=z[1]=2`, `r-i=1`. `min=1`. Hits edge (Sit. 3): extend from 1: `s[1]='a'`=`s[3]='b'`? no → `z[2]=1`. `i+z=3` not `> r=3`, box stays.
- `i=3` (Sit. 1): `s[0]='a'`=`s[3]='b'`? no → `z[3]=0`.
- `i=4` (Sit. 1): `a=a, a=a, a≠b`→ `z[4]=2`. Box → `l=4, r=6`.
- `i=5` (`i<r=6`): `z[i-l]=z[1]=2`, `r-i=1`. `min=1`, hits edge: extend `s[1]='a'`=`s[6]='b'`? no → `z[5]=1`.
- `i=6` (`i<r=6`? `6<6` no → Sit. 1): `s[0]='a'`=`s[6]='b'`? no → `z[6]=0`.

```
z     : 0 2 1 0 2 1 0
```

---

## Pattern Matching via Concatenation

The Z-function matching trick is elegant and worth fully understanding.

To find pattern `p` (length `m`) in text `t` (length `nt`):

1. Choose a **separator** `sep` that appears in neither `p` nor `t`.
2. Build `s = p + sep + t` (length `m + 1 + nt`).
3. Compute the Z-array of `s`.
4. For every index `i` in the text region (`i >= m + 1`), if `z[i] == m`, then `p` occurs in `t` starting at `i - (m + 1)`.

**Why `z[i] == m` means a match.** `z[i]` is the longest common prefix of `s` and the suffix at `i`. The prefix of `s` *starts* with `p`. So if `z[i] == m`, the `m` characters at position `i` equal the first `m` characters of `s`, which are exactly `p`. It cannot be more than `m` for an index in the text region, because the prefix's `(m)`-th character is the separator, which by construction does not occur in the text — so the match is forced to stop at exactly `m`.

**Why the separator is essential.** Without it, `s = p + t` and a "prefix match" could begin in `p` and continue into `t`, conflating the two. The separator is a hard wall: any common-prefix run starting in the text and reaching length `m+1` would require matching the separator, which is impossible. This caps text-region Z-values at `m` and makes `z[i] == m` an exact, unambiguous occurrence signal.

**Choosing the separator.** It must be a symbol that appears in neither `p` nor `t`. For restricted alphabets (lowercase letters, digits) a punctuation character works; for arbitrary data, no character is safe and you should map to integers with a sentinel value or use the separator-free variant (covered in `senior.md`). Picking a "probably rare" character is a latent bug — the rigorous choices are an out-of-alphabet symbol or an integer sentinel.

This gives **O(n + m)** matching — the same asymptotic complexity as KMP — with the simple, separator-based formulation.

### Worked matching trace

Let `p = "ab"`, `t = "ababa"`, separator `#`. Then `s = "ab#ababa"`:

```
index : 0 1 2 3 4 5 6 7
char  : a b # a b a b a
z     : 0 0 0 2 0 2 0 1
```

Pattern length `m = 2`. Scan the text region (`i ≥ 3`): `z[3] = 2 = m` → match at `3 − 3 = 0`; `z[5] = 2 = m` → match at `5 − 3 = 2`. `z[7] = 1 < m`, correctly not a match (only `"a"` overlaps at the tail). So `p` occurs at positions `0` and `2` in `t` — overlapping-adjacent, which the per-index test handles natively. Notice `z[3]` and `z[5]` could not exceed `2`: extending would require matching the prefix's third character, which is the separator `#`, absent from the text.

### What if the pattern occurs zero times?

If `p` never occurs, simply no text-region index reaches `z[i] = m`; the scan returns an empty list. There is no special case to handle — the absence of a hit *is* the "not found" answer. This uniformity (every position tested independently, hits collected) is what makes the Z matcher so easy to get right compared to pointer-advancing scanners that must carefully handle the no-match advance.

---

## Periods and Borders via Z

A **border** of `s` is a string that is both a proper prefix and a proper suffix. A **period** `p` satisfies `s[i] == s[i + p]` for all valid `i`. Borders and periods are dual: `s` of length `n` has a border of length `b` iff it has a period `n - b`.

**Borders from Z.** A suffix of length `b` (starting at index `n - b`) equals the prefix of length `b` exactly when `z[n - b] == b`. So the set of border lengths is `{ b : z[n - b] == b, 1 <= b < n }`. Equivalently, an index `i` with `i + z[i] == n` means the suffix at `i` matches the prefix and runs to the end — so `s` has a border of length `z[i] = n - i`, i.e. a period of length `i`. The two phrasings (`z[n-b] == b` and `i + z[i] == n`) are the same condition with `i = n - b`; use whichever is more convenient for the scan direction you prefer.

**Smallest period.** Scan `i` from `1` upward; the first `i` with `i + z[i] == n` (or `i` dividing `n` cleanly, depending on whether you require the period to tile the string) gives the smallest period. If no such `i < n`, the string is "primitive" and its smallest period is `n` itself.

Be precise about which "period" the problem wants. The weakest notion (`i + z[i] == n`) allows a partial trailing cell: `"abcab"` has period `3` because `s[i] = s[i+3]` where defined, even though `3 ∤ 5`. The stronger "exact tiling" notion additionally requires `i | n`, so the string is an exact whole number of copies. Storage/compression tasks usually want exact tiling; pure border/period reasoning often accepts the weaker notion. Reading the requirement carefully here avoids a subtle off-by-one in which strings you accept.

**Relationship to the prefix function.** The KMP prefix function `π[n-1]` directly gives the longest border length, so periods are usually computed via KMP (sibling `01-kmp`). The Z-array gives the same information through `z[i] + i == n`; both are linear. The conversion below makes the equivalence concrete.

### Worked period/border example

Take `s = "abcabcab"` (length 8):

```
index : 0 1 2 3 4 5 6 7
char  : a b c a b c a b
z     : 0 0 0 5 0 0 2 0
```

Indices with `i + z[i] == n = 8`: `i = 3` (`3 + 5 = 8`, border length `5`, namely `"abcab"`) and `i = 6` (`6 + 2 = 8`, border length `2`, namely `"ab"`). The smallest such `i` is `3`, so the smallest period is `3` — and indeed `s` is `"abc"` repeated (with a partial tail `"ab"`). Since `3 ∤ 8`, `s` does *not* tile exactly into copies of `"abc"`; it has period `3` but is not a clean repetition. Contrast `"abcabc"` (length 6): there `i = 3` gives `z[3] = 3`, `3 + 3 = 6 = n`, and `3 | 6`, so it tiles into two `"abc"` copies exactly.

### Borders form a chain

The border lengths you read off (`5` and `2` above) are *nested*: the shorter border `"ab"` is itself a border of the longer border `"abcab"`. This nesting is why iterating the prefix function (`π[n-1]`, then `π` of that, …) enumerates exactly the same border-length set that `i + z[i] == n` produces. The two routes to the borders agree because they describe the same combinatorial object from the forward (Z) and backward (π) viewpoints.

---

## Z ↔ Prefix-Function Conversion

The **prefix function** `π[i]` (KMP) is the length of the longest proper border of `s[0..i]` — equivalently, the longest prefix that is also a suffix of that prefix. The Z-array and `π` carry the same structural information about prefix repetitions, and you can convert between them in `O(n)` without re-scanning the string.

### Prefix function → Z

Given `π`, build `z` by walking `π` and recording, for each starting offset, the longest reach:

```
z[0] = 0
for i in 1..n-1:
    if π[i] > 0:
        z[i - π[i] + 1] = max(z[i - π[i] + 1], π[i])
# then a forward pass propagates partial reaches
```

Then a left-to-right fill propagates overlap. The intuition: a border of length `π[i]` ending at `i` means a prefix of that length reappears starting at `i - π[i] + 1`.

### Z → prefix function

Given `z`, build `π` by marking, for each match block, where it reaches:

```
for i in 1..n-1:
    for j in z[i]-1 down to 0 (until already set):
        π[i + j] = j + 1
```

A direct `O(n)` version avoids the inner loop by using the monotone reach, shown in code below.

Both conversion directions share a theme with the Z-box itself: each output cell is written at most once, and an early-stop (the `break` when a cell is already set) keeps the total work linear. If you understand why the Z-box is `O(n)`, the same "touch each cell once" accounting explains why the conversions are `O(n)` — they are the same amortization idea applied to index arrays instead of characters.

### Why bother converting?

- Some libraries/algorithms are written against one representation; converting lets you reuse them.
- It is a favorite interview question because it tests whether you truly understand both definitions.
- Period/border logic is sometimes cleaner in one representation than the other.
- It is a strong self-test: if your conversion round-trips (`z → π → z` recovers the original `z`), you have almost certainly understood both definitions correctly. A failing round-trip pinpoints a misunderstanding fast.

### Conversion correctness check

The cheapest validation of a conversion is the round-trip plus a direct cross-check: for random small strings `s`, assert `z_to_prefix(z_function(s)) == prefix_function(s)` and `prefix_to_z(prefix_function(s)) == z_function(s)`. Because both directions operate only on integer arrays, the test is fast and exhaustive over short strings — run it over every string of length `≤ 12` on a 2-symbol alphabet for total confidence.

---

## Comparison with Alternatives

### Z vs KMP prefix function

| Aspect | Z-function | KMP prefix function |
|--------|-----------|---------------------|
| Definition direction | forward: suffix-vs-prefix at `i` | backward: longest border ending at `i` |
| Build time | `O(n)` | `O(n)` |
| Matching | `z` of `p + sep + t`, look for `z[i] == m` | automaton-style scan with failure links |
| Extra memory for matching | needs concatenation | none (streams over text) |
| Intuition | very direct | requires the border/failure idea |
| Streaming text | awkward (needs the join) | natural (process text char by char) |

Both are linear; Z is often easier to derive, KMP streams more naturally. A good way to remember the difference: KMP answers "if I'm `k` characters into a partial match and the next character fails, how far back can I fall to keep matching?" (a backward, failure-link view), while Z answers "starting fresh at position `i`, how far does this agree with the start?" (a forward, from-the-prefix view). They are dual descriptions of the same overlap structure, which is exactly why the conversions exist.

### Z vs Rabin-Karp (sibling `03-rabin-karp`)

| Aspect | Z-function | Rabin-Karp |
|--------|-----------|------------|
| Worst case | `O(n + m)` guaranteed | `O(nm)` worst (hash collisions) |
| Average | `O(n + m)` | `O(n + m)` |
| Multiple patterns | one at a time | natural (hash set of patterns) |
| Determinism | exact | probabilistic unless verified |

In short: for a single in-memory exact match, pick whichever of Z or KMP your codebase already has; for streaming, lean KMP; for clarity in prefix-overlap reasoning, lean Z.

### Z vs suffix array / automaton (siblings `04`, `12`)

| Aspect | Z-function | Suffix structures |
|--------|-----------|-------------------|
| Build | `O(n)` | `O(n)` to `O(n log n)` |
| Single pattern search | `O(n + m)` | `O(m log n)` or `O(m)` after build |
| Many queries on fixed text | rebuild each time | build once, query cheaply |
| Arbitrary substring compares | no | yes |

**Rule of thumb:** one pattern, one pass → Z (or KMP). Many queries on a static text → suffix structure. Many patterns at once → Aho-Corasick (sibling `05-aho-corasick`).

### A note on the "same information" claim

When we say Z and the prefix function "carry the same information", we mean it precisely: there are `O(n)` algorithms converting each into the other *without re-reading the string* (shown in code above). That is a strong statement — it implies neither array can encode anything about prefix structure that the other cannot. The practical upshot is that any algorithm phrased in terms of one can be re-phrased in terms of the other, so you never need both: compute whichever is more natural for the problem and convert if a library demands the other form. Border/period problems are slightly cleaner in `π`; suffix-vs-prefix overlap problems are cleaner in `z`.

---

## Code Examples

### Z ↔ prefix function conversion (both directions)

#### Go

```go
package main

import "fmt"

func zFunction(s string) []int {
	n := len(s)
	z := make([]int, n)
	l, r := 0, 0
	for i := 1; i < n; i++ {
		if i < r {
			z[i] = min(r-i, z[i-l])
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

// prefix function (KMP) for comparison/conversion
func prefixFunction(s string) []int {
	n := len(s)
	pi := make([]int, n)
	for i := 1; i < n; i++ {
		j := pi[i-1]
		for j > 0 && s[i] != s[j] {
			j = pi[j-1]
		}
		if s[i] == s[j] {
			j++
		}
		pi[i] = j
	}
	return pi
}

// Z -> prefix function in O(n)
func zToPrefix(z []int) []int {
	n := len(z)
	pi := make([]int, n)
	for i := 1; i < n; i++ {
		for j := z[i] - 1; j >= 0; j-- {
			if pi[i+j] > 0 {
				break
			}
			pi[i+j] = j + 1
		}
	}
	return pi
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	s := "aabaab"
	z := zFunction(s)
	fmt.Println("z      :", z)
	fmt.Println("pi(kmp):", prefixFunction(s))
	fmt.Println("z->pi  :", zToPrefix(z))
}
```

#### Java

```java
import java.util.Arrays;

public class ZConvert {
    static int[] zFunction(String s) {
        int n = s.length();
        int[] z = new int[n];
        int l = 0, r = 0;
        for (int i = 1; i < n; i++) {
            if (i < r) z[i] = Math.min(r - i, z[i - l]);
            while (i + z[i] < n && s.charAt(z[i]) == s.charAt(i + z[i])) z[i]++;
            if (i + z[i] > r) { l = i; r = i + z[i]; }
        }
        return z;
    }

    static int[] prefixFunction(String s) {
        int n = s.length();
        int[] pi = new int[n];
        for (int i = 1; i < n; i++) {
            int j = pi[i - 1];
            while (j > 0 && s.charAt(i) != s.charAt(j)) j = pi[j - 1];
            if (s.charAt(i) == s.charAt(j)) j++;
            pi[i] = j;
        }
        return pi;
    }

    static int[] zToPrefix(int[] z) {
        int n = z.length;
        int[] pi = new int[n];
        for (int i = 1; i < n; i++) {
            for (int j = z[i] - 1; j >= 0; j--) {
                if (pi[i + j] > 0) break;
                pi[i + j] = j + 1;
            }
        }
        return pi;
    }

    public static void main(String[] args) {
        String s = "aabaab";
        int[] z = zFunction(s);
        System.out.println("z      : " + Arrays.toString(z));
        System.out.println("pi(kmp): " + Arrays.toString(prefixFunction(s)));
        System.out.println("z->pi  : " + Arrays.toString(zToPrefix(z)));
    }
}
```

#### Python

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


def z_to_prefix(z):
    n = len(z)
    pi = [0] * n
    for i in range(1, n):
        for j in range(z[i] - 1, -1, -1):
            if pi[i + j] > 0:
                break
            pi[i + j] = j + 1
    return pi


if __name__ == "__main__":
    s = "aabaab"
    z = z_function(s)
    print("z      :", z)
    print("pi(kmp):", prefix_function(s))
    print("z->pi  :", z_to_prefix(z))
```

### Pattern matching helper (all languages share the idea)

```python
def find_occurrences(pattern, text, sep="\x01"):
    assert sep not in pattern and sep not in text, "separator collides with data"
    s = pattern + sep + text
    z = z_function(s)
    m = len(pattern)
    return [i - (m + 1) for i in range(m + 1, len(s)) if z[i] == m]
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Wrong clamp polarity | `min(r - i + 1, …)` with exclusive `r` reads one char too far. | Match the clamp to your `r` convention; exclusive `r` → `min(r - i, …)`. |
| Separator collides with data | False or missing matches. | Assert separator absent; use a control char like `\x01` or a sentinel value. |
| Extending from `0` instead of copied value | Linear guarantee lost → `O(n²)`. | Always seed `z[i]` with the clamped copy, then extend. |
| Forgetting to grow the box | Later positions get no reuse; slow. | Update `l, r` whenever `i + z[i] > r`. |
| Period scan off-by-one | Reports `n` or `0` as period incorrectly. | Use the explicit `i + z[i] == n` test; handle the primitive case. |
| Conversion overwrites set values | `z->pi` clobbers an earlier larger border. | Break out when `pi[i + j] > 0` (already set by a longer reach). |

---

## Performance Analysis

| String | Naive Z | Box Z | Why |
|--------|---------|-------|-----|
| `"abcdef…"` (no repeats) | `O(n)` | `O(n)` | Each position mismatches immediately either way. |
| `"aaaa…a"` (all same) | `O(n²)` | `O(n)` | Naive re-walks; box copies most values, `r` sweeps once. |
| `"abab…ab"` (periodic) | `O(n²)` | `O(n)` | Heavy reuse inside the box. |
| Random text | `~O(n)` | `O(n)` | Mismatches come fast; box rarely needed. |

The linear bound holds because the **number of successful explicit comparisons across the whole run is at most `n`** — each one advances `r`, and `r` never retreats. Failed comparisons number at most one per index. So total work is `O(n)` regardless of the string's structure.

A common confusion: "but `z[1]` alone can be huge — doesn't that make it slow?" Yes, `z[1]` can be `n − 1`, costing `n − 1` comparisons in that single iteration. But those comparisons advance `r` all the way to `n`, so *every later position* finds itself inside the box and copies for free. The cost is paid *once*, by the iteration that extends the box, not repeatedly. That redistribution of cost — concentrated in box-growing steps, free everywhere else — is the essence of the amortized argument.

```python
# quick empirical check that box-Z matches naive-Z on random strings
import random, string

def z_naive(s):
    n = len(s); z = [0]*n
    for i in range(1, n):
        L = 0
        while i + L < n and s[L] == s[i+L]:
            L += 1
        z[i] = L
    return z

for _ in range(1000):
    s = "".join(random.choice("ab") for _ in range(random.randint(0, 30)))
    assert z_function(s) == z_naive(s)
print("box-Z matches naive-Z on 1000 random strings")
```

---

## Best Practices

- **Pick one `r` convention** (exclusive is cleaner) and write the clamp to match; document it.
- **Always test against the naive oracle** on random small strings — it catches every off-by-one.
- **Use a guaranteed-unique separator** for matching; assert it is absent from the inputs.
- **Build matching/period helpers on top of one well-tested `z_function`**, never copy-paste the loop.
- **Prefer KMP when you must stream the text** char by char; prefer Z when the concatenation is cheap and you find the definition clearer.
- **Convert rather than recompute** when you already have one of `z`/`π` and need the other.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The current index `i` and the `[l, r]` Z-box window over the string.
> - Whether the step is a **copy** (`z[i] = min(z[i - l], r - i)`) or an **extend** (explicit comparisons past `r`).
> - The box growing as longer matches are discovered, and `r` marching only forward.
> - The completed `z[i]` value written under each position.

---

## Summary

At this level you should be able to (1) explain the copy-vs-extend decision and the `min` clamp, (2) write the `p + sep + t` matcher and justify the separator, (3) read borders and periods off `i + z[i] == n`, and (4) convert between Z and the prefix function in linear time. The animation and the worked traces above are the fastest way to make those four reflexes solid.

The `O(n)` Z-function rests on one invariant: the box `s[l..r-1]` always equals a prefix, so a new index inside the box can **copy** `z[i - l]` — but only up to the box edge, which is what the `min(z[i - l], r - i)` clamp enforces. Three situations cover every case: outside the box (compare from scratch), inside with the copy ending strictly inside (copy, no comparison), and inside reaching the edge (copy to the edge, then extend). Pattern matching falls out by running Z on `p + sep + t` and reading off indices where `z[i] == m`, the separator being a hard wall that makes the signal exact. Borders and periods come from `z[i] + i == n`, the same information the KMP prefix function carries — and the two representations convert into each other in linear time. Choose Z for a single clear-cut pass, KMP for streaming, hashing (`03-rabin-karp`) or suffix structures (`04`, `12`) when the problem shape demands them.

The single most useful habit at this level: whenever you face a string problem mentioning *occurrences*, *borders*, *periods*, *repetitions*, or *prefix overlaps*, ask "is this one Z-pass (possibly on a cleverly constructed input) away from solved?" Often it is — and recognizing the reduction is the skill the worked examples above are meant to build.
