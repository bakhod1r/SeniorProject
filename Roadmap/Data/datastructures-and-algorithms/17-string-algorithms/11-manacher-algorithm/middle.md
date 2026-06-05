# Manacher's Algorithm (All Palindromic Substrings in O(n)) — Middle Level

> **Focus:** Why the `#`-transform unifies odd and even palindromes, how the mirror initialization inside the box `[l, r]` makes each center cheap, how to recover substrings and count *all* palindromic substrings from the radius array, and how Manacher compares with center expansion, hashing, and the eertree.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The `#`-Transform in Detail](#the--transform-in-detail)
4. [The Mirror Initialization and Why It Is Capped](#the-mirror-initialization-and-why-it-is-capped)
5. [Recovering Substrings and Positions](#recovering-substrings-and-positions)
6. [Counting All Palindromic Substrings](#counting-all-palindromic-substrings)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Advanced Patterns](#advanced-patterns)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the message was: *insert separators, run one scan, copy radii from the mirror, expand past the box.* At middle level you start asking the engineering questions that decide whether your implementation is correct *and* genuinely linear:

- Why does the `#`-transform make the radius in `t` equal to the palindrome length in `s` — exactly, with no off-by-one?
- Why must the mirror copy be **capped** at `r - i`, and what goes wrong if you forget?
- How do you recover the actual substring and its original position from a transformed center and radius?
- Why does counting *all* palindromic substrings reduce to `Σ ⌈p[i]/2⌉`, and how does that differ from counting *distinct* ones?
- When is Manacher the right tool versus polynomial hashing, the eertree, or plain center expansion?

These are the questions that separate "I memorized the loop" from "I can derive, debug, and adapt the algorithm."

A second theme is *reuse*. Manacher computes one array; from it you answer the longest-palindrome, count, per-center-profile, palindromic-prefix, and centered-range-query problems by simple arithmetic. Recognizing that these are all the same underlying computation — and that the eertree and hashing answer the *different* questions (distinct palindromes, arbitrary range queries) — is the mark of someone who can reach for the right tool rather than forcing one to fit.

---

## Deeper Concepts

### The radius array is the whole answer

Manacher produces one array `p[]` over the transformed string `t`. Every palindromic-substring question is a one-line read of `p[]`:

| Question | Read of `p[]` |
|----------|---------------|
| Longest palindrome length | `max p[i]` |
| Where it starts in `s` | `(argmax_i p[i] - max p[i]) / 2` |
| Longest palindrome **length at center `i`** | `p[i]` (in transformed coordinates) |
| Count of all palindromic substrings | `Σ_i ⌈p[i]/2⌉` |
| Is `s[a..b]` a palindrome (single query) | check the relevant center's `p` reaches it |

So the algorithm's job is purely to compute `p[]` in `O(n)`. Everything downstream is arithmetic. This separation is worth internalizing: there is exactly one non-trivial computation (the radius array), and a family of trivial reads. Bugs almost never live in the reads; they live in the radius computation — specifically the mirror cap and the box update. Concentrate your testing there.

### The two pointers that make it linear

Manacher maintains a single *box* — the palindrome with the rightmost right edge seen so far — described by its center `c` and right edge `r` (and implicitly left edge `l = 2c - r`). The center index `i` of the scan only moves forward. The right edge `r` only moves forward. Because both monotone pointers only advance, and expansion only happens at the frontier `r`, the **total** expansion work over the entire run is `O(n)`. This is the same amortized-pointer argument that powers KMP and the two-pointer sliding window — see the rigorous proof in `professional.md`.

A useful mental model: think of `r` as a "frontier of verified symmetry." Everything to the left of `r` has been settled (its palindromic structure is known via the box). When a new center `i` lands inside `[l, r]`, the mirror lets us reuse that settled structure for free. The only time we do *new* work is when expansion pushes past `r` — and each unit of new work advances `r` by one, so the frontier marches steadily rightward at most `2n` total steps. This is why a loop that *looks* nested (a `for` over centers containing a `while` expansion) is actually linear: the inner `while` is bounded globally, not per center.

---

## The `#`-Transform in Detail

Define the transform: between every pair of adjacent characters of `s`, and at both ends, insert a separator `#`:

```
s = "aba"      ->  t = "#a#b#a#"     (len 7  = 2*3 + 1)
s = "abba"     ->  t = "#a#b#b#a#"   (len 9  = 2*4 + 1)
s = ""         ->  t = "#"           (len 1)
```

Two structural facts make the transform work:

1. **`t` always has odd length `2n + 1`**, and *every* maximal palindrome in `t` is odd-length (centered on a single position of `t`). There are `2n + 1` centers — one per position of `t` — which is exactly the `2n - 1` real centers of `s` plus the two boundary `#`s.

2. **The radius in `t` equals the palindrome length in `s`.** If the palindrome in `t` centered at `i` has radius `p[i]` (counting matched characters on each side, excluding the center), then the corresponding substring of `s` has length exactly `p[i]`. The proof is a counting argument on how many real characters vs separators fall inside the radius (full bijection in `professional.md`). The convenient consequence: **you never convert radius-to-length — they are equal.**

The mapping back to `s`:

```
transformed center i, radius p[i]
original substring length  = p[i]
original substring start   = (i - p[i]) / 2
original substring end     = start + p[i] - 1   (inclusive)
```

Why `(i - p[i]) / 2`? In `t`, real characters of `s` sit at odd indices `1, 3, 5, …`. The left edge of the palindrome in `t` is at `i - p[i]`, which is a `#` (even index). The real character just to its right is at `i - p[i] + 1`, mapping to original index `(i - p[i]) / 2`. Memorize this formula — it is the single most error-prone line.

### Sentinel variant

A common production tweak wraps `t` with distinct sentinels so the expansion never needs explicit bounds checks:

```
t = "^#a#b#b#a#$"
```

`^` and `$` are characters guaranteed not to appear in `s`, so `t[left] == t[right]` automatically fails at the boundaries and the loop stops without an index check. This trades a tiny bit of memory for cleaner, faster inner-loop code.

---

## The Mirror Initialization and Why It Is Capped

When the scan reaches center `i` and `i < r` (we are still inside the current box), the mirror of `i` across the box center `c` is

```
i' = 2*c - i      (equivalently l + r - i)
```

Everything strictly inside `[l, r]` is symmetric about `c`, so the neighborhood of `i` mirrors the neighborhood of `i'`. Therefore the palindrome at `i` is **at least as long** as the part of the palindrome at `i'` that stays inside the box. Two cases:

- **The mirror palindrome fits entirely inside the box** (`p[i'] < r - i`): then `p[i] = p[i']` exactly — no expansion needed. The symmetry guarantees it, and it cannot be longer because going further would contradict the box being maximal at `i'`.
- **The mirror palindrome reaches or exceeds the box's left edge** (`p[i'] >= r - i`): then we only *know* the palindrome at `i` reaches the box edge `r`; beyond `r` is unexplored, so we initialize `p[i] = r - i` and must **attempt to expand** further.

The unified initialization captures both:

```
p[i] = min(r - i, p[i'])
```

**What goes wrong without the cap.** If you set `p[i] = p[i']` blindly and the mirror palindrome stuck out past the box's left edge, you would claim a palindrome at `i` extending past `r` *without verifying it* — and the characters past `r` might not match. The cap restricts the free copy to the verified region and forces explicit expansion beyond it. This single `min` is the correctness keystone of the whole algorithm.

After initialization, expand:

```
while t[i - p[i] - 1] == t[i + p[i] + 1]:
    p[i] += 1
if i + p[i] > r:
    c, r = i, i + p[i]    # the box advances; r never moves backward
```

When `i >= r` (the new center is at or past the box), there is no mirror to copy from, so we start `p[i] = 0` and expand from scratch — this is what pushes `r` forward into new territory.

### A worked mirror example

Take `t = #a#b#a#b#a#` (from `s = "ababa"`) and suppose the scan has established the box around the central `a`: `c = 5`, `r = 10`, `l = 0` (the whole `ababa` is a palindrome). Now process `i = 7` (a `#`):

- Mirror `i' = 2*5 - 7 = 3` (a `#` on the left half).
- Suppose `p[3] = 1`. Then `p[7] = min(r - i, p[3]) = min(3, 1) = 1`. The mirror palindrome fits strictly inside the box (`1 < 3`), so by the symmetry guarantee `p[7] = 1` exactly — the first expansion test fails and we move on. No real work.

Now process `i = 9` (the `#` near the right end):

- Mirror `i' = 2*5 - 9 = 1`, `p[1] = 1`. `p[9] = min(r - i, p[1]) = min(1, 1) = 1`. Here the mirror reaches the box edge exactly (`1 = r - i`), so `p[9] = 1` is only a lower bound — we must try to expand. The expansion at offset 2 goes out of bounds, confirming `p[9] = 1`.

This is the two-case distinction in miniature: `i = 7` copies for free; `i = 9` copies then must verify beyond the box. Across the whole scan, only the second kind ever does real expansion work, which is why the total is linear.

---

## Recovering Substrings and Positions

The radius array stores lengths; recovering actual substrings is pure indexing. For a transformed center `i`:

```python
length = p[i]
start  = (i - p[i]) // 2          # start index in the ORIGINAL string s
substring = s[start:start + length]
```

To list *all* maximal palindromes (one per center, the longest at that center):

```python
def all_maximal_palindromes(s):
    p, _ = manacher(s)
    out = []
    for i in range(len(p)):
        if p[i] > 0:
            start = (i - p[i]) // 2
            out.append((start, p[i], s[start:start + p[i]]))
    return out   # (start, length, substring) per center with a nonempty palindrome
```

Note this returns the *maximal* palindrome per center. Every shorter palindrome sharing that center is nested inside it (e.g. `abcba` contains `bcb` contains `c`), which is exactly what the counting formula exploits next.

---

## Counting All Palindromic Substrings

A palindrome of radius `p[i]` (in `t`) centered at `i` contains a *nest* of shorter palindromes sharing the same center: radii `p[i], p[i]-2, p[i]-4, …` correspond to real palindromic substrings of `s`. The number of original palindromes centered at transformed position `i` is

```
⌈ p[i] / 2 ⌉  =  (p[i] + 1) // 2
```

Summing over all centers gives the total count of palindromic substrings (counting each occurrence):

```python
def count_palindromic_substrings(s):
    p, _ = manacher(s)
    return sum((x + 1) // 2 for x in p)
```

**Why `⌈p[i]/2⌉`?** A `#`-center (even index in `t`) has even `p[i]` and contributes `p[i]/2` even-length palindromes; a real-character center (odd index) has odd `p[i]` and contributes `(p[i]+1)/2` odd-length palindromes (including the single character itself). The ceiling-halving handles both uniformly. Worked check on `"aaa"`: `t = "#a#a#a#"`, `p = [0,1,2,3,2,1,0]`, sum of `⌈p/2⌉ = 0+1+1+2+1+1+0 = 6`, and indeed `"aaa"` has palindromic substrings `a, a, a, aa, aa, aaa` = 6.

**All vs distinct.** This counts every *occurrence*. The three `a`s above count as three. If you want *distinct* palindromic substrings (`a`, `aa`, `aaa` = 3), Manacher alone does not give it — that is the eertree's specialty (sibling `14`). Manacher's count is the LeetCode-647 "Palindromic Substrings" quantity.

**Why the per-center contribution is a simple count.** The palindromes sharing a center are *nested*: at a center of radius `p[i]`, the palindromes are `t[i±0], t[i±1], …, t[i±p[i]]` restricted to the right parity. They form a chain, each contained in the next, so their number is fully determined by `p[i]` — no enumeration needed. This nesting is exactly why a single number `⌈p[i]/2⌉` captures the whole center's contribution, and it is the structural reason the total count is computable in `O(n)` despite there being `Θ(n²)` occurrences in the worst case.

---

## Comparison with Alternatives

### Center expansion vs Manacher

| Approach | Time | Space | Good when |
|----------|------|-------|-----------|
| Center expansion | `O(n²)` worst (`O(n²)` on `aaaa…`) | `O(1)` | tiny strings, one-off, code-golf simplicity |
| **Manacher** | `O(n)` | `O(n)` | longest palindrome / full profile / count, large `n` |
| DP table `isPal[a][b]` | `O(n²)` time & space | `O(n²)` | when you also need arbitrary range palindrome queries |
| Polynomial hashing + binary search | `O(n log n)` | `O(n)` | when you want per-center via hashing, or palindrome range checks |
| Eertree (sibling `14`) | `O(n)` | `O(n·σ)` or `O(n)` with map | **distinct** palindromes, palindrome counts per prefix, richer structure |

### Manacher vs hashing

Polynomial hashing builds a forward hash and a reverse hash; then "is `s[a..b]` a palindrome?" is an `O(1)` comparison, and the per-center longest palindrome can be found by binary searching the radius (`O(log n)` per center, `O(n log n)` total). Hashing is more flexible for arbitrary range queries but has a small probability of collision (mitigated by double hashing) and is asymptotically slower for the pure longest-palindrome task. Manacher is exact and linear but specialized to the per-center palindromic profile.

### Manacher vs eertree (sibling `14`)

| Aspect | Manacher | Eertree (palindromic tree) |
|--------|----------|----------------------------|
| Output | radius array `p[]` (per center) | a tree node per **distinct** palindrome |
| Time | `O(n)` | `O(n)` (amortized, with the suffix-link trick) |
| Counts **all** occurrences | yes (`Σ⌈p/2⌉`) | yes, via occurrence counts |
| Counts **distinct** palindromes | no | yes (number of nodes − 2) |
| Number of distinct palindromes | not directly | exactly (a string has ≤ `n` distinct palindromes) |
| Online (append one char) | the original Manacher is online; the array form is offline | inherently online |
| Memory | one int array | a node per distinct palindrome with links |
| Best for | longest palindrome, all-occurrence count, per-center | distinct palindromes, per-prefix palindrome counts, palindromic factorization |

Rule of thumb: **longest palindrome or all-occurrence count → Manacher; distinct palindromes or palindromic structure per prefix → eertree.** Both are linear; they answer different questions.

---

## Advanced Patterns

### Pattern: Sentinel-wrapped Manacher (no bounds checks)

Wrap `t` so the boundary comparison fails naturally:

```python
def manacher_sentinel(s):
    t = "^#" + "#".join(s) + "#$" if s else "^$"
    n = len(t)
    p = [0] * n
    c = r = 0
    for i in range(1, n - 1):           # skip the sentinels
        if i < r:
            p[i] = min(r - i, p[2 * c - i])
        while t[i - p[i] - 1] == t[i + p[i] + 1]:  # sentinels stop it; no bounds check
            p[i] += 1
        if i + p[i] > r:
            c, r = i, i + p[i]
    return p, t
```

### Pattern: Separate odd/even radius arrays (no transform)

Some prefer two arrays — `d1[i]` for odd palindromes centered at `i`, `d2[i]` for even palindromes centered between `i-1` and `i` — running two Manacher passes on the raw string. This avoids building `t` (saving the 2× memory) at the cost of two near-identical loops. It is mathematically equivalent to the `#`-transform: `d1`/`d2` are just the odd/even slices of `p[]`. Use whichever you can write bug-free.

### Pattern: Longest palindromic prefix / suffix

A palindromic *prefix* of `s` is a palindrome whose start in `s` is `0`. Scan `p[]` for the center whose palindrome starts at original index `0` (i.e. `(i - p[i]) / 2 == 0`) and is longest. Useful in string-doubling tricks (e.g. shortest palindrome by prepending characters, LeetCode 214).

```python
def longest_palindromic_prefix(s):
    p, _ = manacher(s)
    best = 0
    for i in range(len(p)):
        if (i - p[i]) // 2 == 0 and (i - p[i]) % 2 == 0:  # starts at original index 0
            best = max(best, p[i])
    return s[:best]
```

### Pattern: Palindrome range query from the radius array

A range `s[a..b]` is a palindrome iff the palindrome centered at the transformed center `a + b + 1` reaches both ends, i.e. `p[a + b + 1] >= b - a + 1`. This turns Manacher's per-center array into an `O(1)` range-palindrome oracle (after the `O(n)` preprocessing), useful when the queries happen to be *centered* — though for arbitrary ranges, hashing is the more natural `O(1)` tool.

```python
def is_palindrome_range(p, a, b):
    return p[a + b + 1] >= b - a + 1
```

### Pattern: Counting odd vs even palindromes separately

Split the count by center parity: `Σ_{i odd} ⌈p[i]/2⌉` counts odd-length palindromes (real-character centers), `Σ_{i even} ⌈p[i]/2⌉` counts even-length ones (`#`-centers). Both come from the same single radius array — no second pass.

---

## Code Examples

### Full toolkit: radius array, longest, count — one module

This factors the core scan so the three downstream queries reuse it.

#### Go

```go
package main

import (
	"fmt"
	"strings"
)

func manacher(s string) []int {
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
	return p
}

func longest(s string) string {
	if s == "" {
		return ""
	}
	p := manacher(s)
	bestLen, bestC := 0, 0
	for i, v := range p {
		if v > bestLen {
			bestLen, bestC = v, i
		}
	}
	start := (bestC - bestLen) / 2
	return s[start : start+bestLen]
}

func countPalindromes(s string) int64 {
	var total int64
	for _, v := range manacher(s) {
		total += int64((v + 1) / 2)
	}
	return total
}

func main() {
	fmt.Println(longest("babad"))         // bab
	fmt.Println(countPalindromes("aaa"))  // 6
	fmt.Println(countPalindromes("abc"))  // 3
}
```

#### Java

```java
public class ManacherKit {
    static int[] manacher(String s) {
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
        return p;
    }

    static String longest(String s) {
        if (s.isEmpty()) return "";
        int[] p = manacher(s);
        int bestLen = 0, bestC = 0;
        for (int i = 0; i < p.length; i++)
            if (p[i] > bestLen) { bestLen = p[i]; bestC = i; }
        int start = (bestC - bestLen) / 2;
        return s.substring(start, start + bestLen);
    }

    static long countPalindromes(String s) {
        long total = 0;
        for (int v : manacher(s)) total += (v + 1) / 2;
        return total;
    }

    public static void main(String[] args) {
        System.out.println(longest("babad"));        // bab
        System.out.println(countPalindromes("aaa")); // 6
        System.out.println(countPalindromes("abc")); // 3
    }
}
```

#### Python

```python
def manacher(s):
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
    return p


def longest(s):
    if not s:
        return ""
    p = manacher(s)
    best_len = max(p)
    best_c = p.index(best_len)
    start = (best_c - best_len) // 2
    return s[start:start + best_len]


def count_palindromes(s):
    return sum((v + 1) // 2 for v in manacher(s))


if __name__ == "__main__":
    print(longest("babad"))         # bab
    print(count_palindromes("aaa")) # 6
    print(count_palindromes("abc")) # 3
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Missing `min(r - i, …)` cap | Radii claim past-box palindromes; wrong answers. | Always cap the mirror copy before expanding. |
| No bounds check / no sentinel | Index out of range in the expansion loop. | Guard both indices, or wrap `t` with `^`/`$` sentinels. |
| Wrong recovery formula | Off-by-one start; substring shifted by one. | `start = (center - radius) / 2`; verify on `abba`. |
| Counting distinct via Manacher | Over- or under-counts; conceptually wrong tool. | Use the eertree (sibling `14`) for distinct counts. |
| 32-bit overflow on count | Total exceeds 2³¹ for large `n`. | Accumulate in 64-bit. |
| Box not updated | Later mirror reuse copies stale radii. | Update `c, r` whenever `i + p[i] > r`. |

---

## Performance Analysis

| `n` (string length) | Center expansion `O(n²)` | Manacher `O(n)` |
|---------------------|--------------------------|-----------------|
| 10³ | ~10⁶ ops — instant | ~2×10³ ops — instant |
| 10⁵ | ~10¹⁰ ops — seconds, often too slow | ~2×10⁵ ops — instant |
| 10⁶ | ~10¹² ops — minutes, infeasible | ~2×10⁶ ops — milliseconds |
| 10⁷ | infeasible | ~2×10⁷ ops — well under a second |

The `O(n²)` baseline is dominated by pathological inputs like `aaaa…`, where every center expands the full length. Manacher's mirror reuse caps total expansion at `O(n)` regardless of input, so it is uniformly fast.

```python
import time

def benchmark(n):
    s = "a" * n   # worst case for center expansion
    start = time.perf_counter()
    manacher(s)
    return time.perf_counter() - start

# Typical: n = 10**6 -> a few tens of ms in CPython.
```

The dominant constant factor is the transformed-string length `2n + 1`; using a `char`/`byte` array instead of repeated string indexing, and sentinels to drop bounds checks, are the two biggest practical wins.

---

## Best Practices

- **Compute `p[]` once** and answer all three queries (longest, count, profile) by reading it — never re-scan.
- **Cap the mirror copy** with `min(r - i, p[mirror])` every single time; it is the correctness keystone.
- **Keep the recovery formula** `start = (center - radius) / 2` in a comment beside the code; verify it on `abba` in a test.
- **Use sentinels** for production code to eliminate bounds checks and a class of off-by-one bugs.
- **Choose the right tool:** Manacher for all-occurrence / longest; eertree for distinct palindromes and per-prefix structure.
- **Always validate against the center-expansion oracle** on random small strings before trusting Manacher on large inputs.
- **Update the box every iteration** after expansion (`if i + p[i] > r`); a stale box silently corrupts later mirror copies.
- **Accumulate counts in 64-bit** — the all-occurrence count reaches `n(n+1)/2`.

### A common debugging session

If Manacher returns a wrong longest length, check in this order: (1) is the mirror copy capped? (2) is the box updated after every expansion? (3) is the recovery formula `(center - radius)/2` matched to your layout? (4) is the transform length exactly `2n+1`? Reproduce the failing input on the center-expansion oracle and diff the per-center radii — the first index where they disagree localizes the bug, almost always to the cap or the box update.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The `#`-transform building `t` from the editable input string.
> - The box `[l, r]`, the current center `i`, and the mirror `i'` drawn together.
> - The mirror copy `p[i] = min(r - i, p[i'])` and the subsequent expansion, with `r` advancing only forward.
> - The radius array filling cell by cell, and the running count `Σ ⌈p[i]/2⌉` updating live.

---

## Summary

Manacher's linear-time algorithm rests on two pillars. The **`#`-transform** makes `t` odd-length so every palindrome is odd and a single case suffices, and — by a clean counting argument — the radius in `t` *equals* the palindrome length in `s`, so recovery is just `start = (center - radius) / 2`. The **capped mirror initialization** inside the box `[l, r]` copies `p[i] = min(r - i, p[i'])` from the mirror `i' = 2c - i`, doing real expansion only beyond the verified frontier `r`; since `r` only moves forward, total work is `O(n)`. From the radius array you read off the longest palindrome (`max p[i]`), the count of *all* palindromic substrings (`Σ ⌈p[i]/2⌉`), and the per-center profile. For **distinct** palindromes and richer per-prefix palindromic structure, reach for the eertree (sibling `14`); for arbitrary range palindrome queries, polynomial hashing is the flexible alternative. Master the cap and the recovery formula and Manacher becomes a reliable, reusable linear-time palindrome engine.

The two ideas to carry forward are the **cap** (`min(r - i, …)`, the line that makes the algorithm both correct and linear) and the **reuse** (one radius array, many answers). Internalize those and you will not only implement Manacher without bugs but also recognize instantly when a problem is *not* a Manacher problem — when it asks for distinct palindromes, subsequence palindromes, or arbitrary range checks — and route it to the eertree, a DP, or hashing instead.

### Quick reference

| Goal | One-liner from `p[]` |
|------|----------------------|
| Longest palindrome length | `max(p)` |
| Longest palindrome start in `s` | `(argmax(p) - max(p)) / 2` |
| Count all palindromic substrings | `sum((v + 1) // 2 for v in p)` |
| Odd-palindrome length at `s[i]` | `p[2*i + 1]` |
| Is `s[a..b]` a palindrome | `p[a + b + 1] >= b - a + 1` |
| Longest palindromic prefix | `max(p[i] for i if (i - p[i]) // 2 == 0)` |

Every entry is `O(1)` (or `O(n)` to scan) after the single `O(n)` radius computation — the reuse principle made concrete.
