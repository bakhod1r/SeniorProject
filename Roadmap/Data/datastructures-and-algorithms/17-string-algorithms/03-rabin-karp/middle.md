# Rabin-Karp (Rolling-Hash String Matching) — Middle Level

> **Focus:** How to choose the base and modulus so collisions are rare, why **double hashing** crushes the false-positive rate, why verification keeps the algorithm correct, and how the *same* rolling-hash skeleton extends to **multi-pattern set matching** and **2D grid search** — plus when KMP or the Z-algorithm is the better tool.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Choosing the Base and Modulus](#choosing-the-base-and-modulus)
4. [Double Hashing](#double-hashing)
5. [Verification and Collision Handling](#verification-and-collision-handling)
6. [Multi-Pattern Set Matching](#multi-pattern-set-matching)
7. [2D Rabin-Karp](#2d-rabin-karp)
8. [Comparison with KMP and Z](#comparison-with-kmp-and-z)
9. [Prefix-Hash Applications](#prefix-hash-applications)
10. [Advanced Patterns](#advanced-patterns)
11. [Code Examples](#code-examples)
12. [Error Handling](#error-handling)
13. [Performance Analysis](#performance-analysis)
14. [Best Practices](#best-practices)
15. [Visual Animation](#visual-animation)
16. [Summary](#summary)

---

## Introduction

At junior level the message was a single mechanism: a polynomial hash that rolls in `O(1)`, compared against the pattern hash, with verification on hits. At middle level you start asking the engineering questions that decide whether the solution is correct *and* fast in practice:

- What base and modulus actually keep collisions near `1/p`, and why does primality matter?
- How does **double hashing** take the collision probability from `~1/p` to `~1/p²` — effectively zero?
- Why is verification not optional, and what is the precise relationship between "expected `O(n+m)`" and "worst case `O(n·m)`"?
- How do you search for **many** patterns of the same length at once without re-scanning the text per pattern?
- How does the one-dimensional roll generalize to a **two-dimensional** roll for grid/image pattern search?
- When should you reach for KMP or Z instead, and what does Rabin-Karp give you that they do not?

These are the questions that separate "I can code the basic matcher" from "I can pick and tune the right hashing scheme for the problem in front of me."

A useful framing: at junior level the rolling hash is *the algorithm*; at middle level it is a *reusable component* you parameterize (base, modulus, single vs double), compose (sets for multi-pattern, two passes for 2D, prefix arrays for substring queries), and place correctly against alternatives (KMP, Z, Aho-Corasick, suffix structures). The mechanics never change — `O(1)` roll plus verify — but the surrounding decisions determine whether your solution is correct, fast, and the right tool at all. The rest of this document works through each of those decisions in turn, with runnable code in Go, Java, and Python.

---

## Deeper Concepts

### The polynomial hash, restated precisely

For a string `s[0..m-1]` over character codes `s[i]`, define

```
H(s) = ( Σ_{i=0}^{m-1} s[i] · b^{m-1-i} ) mod p
```

So the *leftmost* character has the *highest* power. This convention makes the roll clean: when the window advances, the leftmost character (highest power `b^{m-1}`) is the one removed.

### The roll, derived

Let `H_i = H(T[i..i+m-1])`. We want `H_{i+1} = H(T[i+1..i+m])`. Subtract the leading term, multiply the rest by `b` (shifting all powers up by one), and add the new last character:

```
H_{i+1} = ( ( H_i − T[i]·b^{m-1} ) · b + T[i+m] ) mod p
```

The only precomputed constant is `b^{m-1} mod p`. Everything else is two multiplies, one subtract, one add, one reduce — `O(1)`.

### Prefix hashes — an alternative that supports random access

Instead of rolling, precompute prefix hashes `pre[k] = H(T[0..k-1])`. Then the hash of any substring `T[l..r]` is

```
hashSub(l, r) = ( pre[r+1] − pre[l]·b^{r-l+1} ) mod p
```

This gives the hash of *any* substring in `O(1)` after `O(n)` preprocessing — essential for "count distinct substrings" and "longest duplicate substring" (see `interview.md`). The rolling form is the special case where you only ever need consecutive equal-length windows.

A practical note: building the power table `pow[0..n]` (with `pow[k] = pow[k-1]·b mod p`) alongside the prefix array is what makes the substring formula `O(1)` rather than `O(log L)` per query. Always precompute both `pre[]` and `pow[]` together in the same `O(n)` pass; computing `b^{r-l+1}` on demand inside a query loop is a frequent and silent performance regression.

---

## Choosing the Base and Modulus

The collision probability of a single comparison is roughly `1/p` for a random hash, so the modulus `p` directly controls correctness cost. Guidelines:

- **Modulus `p`: a large prime.** Common choices are `1_000_000_007` or `1_000_000_009` (just under `2^30`). For stronger guarantees use a 61-bit Mersenne prime `2^61 − 1`, which keeps products inside 64 bits with a fast reduction. Primality matters because it makes the hash a polynomial over a field `Z_p`, which by the **Schwartz-Zippel / polynomial-root argument** bounds collisions at `m/p` for a random base (two distinct length-`m` strings collide only if a degree-`<m` polynomial vanishes at the base).
- **Base `b`: larger than the alphabet, ideally random.** It must exceed the maximum character code (so each character is a distinct "digit"); 256 or 257 works for bytes, 31/131/137 are popular for lowercase text. For adversarial safety pick `b` **randomly** in `[256, p)` at runtime (see `senior.md` on hash flooding).
- **Offset character codes by 1.** Map `'a' → 1` not `0`, so that `"a"`, `"aa"`, `"aaa"` get distinct hashes and leading characters cannot vanish.

| Choice | Collision rate | Notes |
|--------|----------------|-------|
| `p = 101` (toy) | ~1% | Teaching only; constant spurious hits. |
| `p ≈ 10^9 + 7` | ~`10^{-9}` per compare | Good default; fits in 64-bit products. |
| `p = 2^61 − 1` | ~`4·10^{-19}` per compare | Strong; needs 128-bit or careful mulmod. |
| Two independent `(b, p)` | ~`p^{-2}` | Double hashing — effectively collision-free. |

---

## Double Hashing

A single 30-bit modulus gives a per-comparison collision probability around `10^{-9}`. Over a text with `n ≈ 10^9` windows (or many comparisons across many queries), the **birthday-style** accumulation can make a collision likely. The fix is to compute **two independent hashes** — different `(base, modulus)` pairs — and treat two strings as equal only if *both* hashes agree.

If the two hashes are independent, the joint collision probability is `~ (1/p₁)·(1/p₂)`. With two ~`10^9` primes that is `~10^{-18}` — for all practical purposes zero. Represent the pair as a single 64-bit key `(h1 << 32) | h2` so set lookups and comparisons stay `O(1)`.

```
hashPair(s) = ( H_{b1,p1}(s), H_{b2,p2}(s) )
equal(a, b) ⟺ a.h1 == b.h1 AND a.h2 == b.h2
```

Double hashing does **not** remove the need to verify if you require guaranteed correctness — but in competitive programming it is often used *in place of* verification, because the residual probability is negligible. In production code that must never be wrong, keep the verification step; in throwaway contest code, double hashing alone is usually accepted.

---

## Verification and Collision Handling

Verification is the bridge from "probably correct" to "definitely correct." The logic at each window:

1. Compare `winHash` to `patHash`. If unequal → definitely not a match, skip.
2. If equal → it is a **candidate**. Compare characters directly.
   - Match → report.
   - Mismatch → it was a **spurious hit** (collision); discard and continue.

The cost analysis: let `c` be the number of spurious hits. Total time is `O(n + (matches + c)·m)`. With a good hash, `E[c] ≈ (n − m)/p`, which for `p ≈ 10^9` is effectively 0. So expected time is `O(n + m + matches·m)` — and if you only need the *count* or *first* match it is `O(n + m)`. The worst case `O(n·m)` arises exactly when `c = Θ(n)`, which an adversary can engineer against a *fixed* hash but not against a *randomized* one.

---

## Multi-Pattern Set Matching

Suppose you have `k` patterns, **all of the same length `m`**, and want to find which (if any) occur at each text position. Naively running Rabin-Karp `k` times costs `O(k·n)`. Better: hash all `k` patterns once into a **hash set** (or hash map from hash → pattern), then roll a single window across the text and, at each position, look up the window hash in the set in `O(1)` expected.

```
1. For each pattern, compute its hash → insert into set S (store the pattern too, for verification).
2. Roll one window across T.
3. At each position, if winHash ∈ S → verify against the matching pattern(s) → report.
```

This is **expected `O(n + k·m)`** — one text scan regardless of `k`. (Patterns of *different* lengths need one set per distinct length, or the Aho-Corasick automaton, which is the proper multi-length multi-pattern tool — see sibling `04-aho-corasick`.) Store the full pattern alongside its hash so verification can resolve which pattern matched and reject collisions.

One subtlety: as `k` grows, the chance that *some* window collides with *some* pattern grows linearly in `k` (a union bound over the `k` targets). So the effective collision pressure is `~ n·k·(m−1)/p`, and the modulus should be chosen with `k` in mind — another argument for a 61-bit modulus or double hashing once `k` is in the thousands. The full analysis is in `professional.md`.

---

## 2D Rabin-Karp

To find an `r × c` pattern grid inside an `R × C` text grid, apply the rolling hash **twice**:

1. **Hash every horizontal window of width `c`.** For each row, compute the rolling hash of each length-`c` horizontal segment. This collapses each row into a sequence of "column-strip hashes." Cost: `O(R·C)`.
2. **Hash vertically over those row-hashes.** Treat each column of row-hashes as a 1D string and roll a height-`r` window down it, using a *second* base. A 2D match occurs where the combined vertical-of-horizontal hash equals the pattern's combined hash.

The pattern grid is reduced to a single hash the same way (hash its rows, then hash that column of hashes). The total cost is **expected `O(R·C + r·c)`** — linear in the grid size — versus `O(R·C·r·c)` for naive 2D matching. Verification on a 2D hash hit compares the full `r × c` subgrid. The key insight: a 2D rolling hash is just a 1D rolling hash whose "characters" are themselves 1D rolling hashes.

### Why two different bases for 2D

The horizontal pass uses base `b_1` and the vertical pass uses base `b_2`. Using the *same* base for both would conflate a horizontal shift with a vertical shift — two different grids could then collide simply because their row-hash sequences are rotations of each other. Independent bases make the combined hash a genuine bivariate polynomial evaluation `G(b_2, b_1)`, whose collision bound is `~((r−1)+(c−1))/p` (see `professional.md`). In code, this means precomputing two high powers: `b_1^{c−1}` for the horizontal roll and `b_2^{r−1}` for the vertical roll.

### 2D worked sketch

For a `2×2` pattern in a `3×3` grid: first build `rowHash[i][j]` for each of the 3 rows and the 2 horizontal positions, then for each of the 2 column positions roll a height-2 window down the 3 row-hashes (2 vertical positions). That is `3·2` row hashes + `2·2` combined hashes = a handful of `O(1)` rolls, all linear in the grid. Each combined-hash hit triggers a full `2×2` subgrid verification.

---

## Comparison with KMP and Z

| Property | Rabin-Karp | KMP (`01-kmp`) | Z-algorithm (`02-z-algorithm`) |
|----------|-----------|----------------|-------------------------------|
| Time (typical) | expected `O(n + m)` | worst-case `O(n + m)` | worst-case `O(n + m)` |
| Time (adversarial) | `O(n·m)` unless randomized | `O(n + m)` always | `O(n + m)` always |
| Preprocessing | hash pattern, `O(m)` | failure function, `O(m)` | Z-array of `P#T`, `O(m)` |
| Extra space | `O(1)` | `O(m)` | `O(n + m)` |
| Multi-pattern (equal length) | **natural** — hash a set, one scan | needs Aho-Corasick | awkward |
| 2D / grid search | **natural** — roll twice | hard | hard |
| Substring-pair comparison | **`O(1)` via prefix hashes** | not supported | not supported |
| Correctness risk | must verify (lossy hash) | exact, no verification | exact, no verification |

**Use Rabin-Karp** when you need multi-pattern equal-length search, 2D matching, or `O(1)` substring comparisons, or when its simplicity wins. **Use KMP/Z** when you need a hard worst-case linear guarantee on adversarial input with a single pattern.

### A closer look at the trade-off

KMP and Z preprocess the *pattern* into a structure (failure function / Z-array) that lets them never re-examine a text character — giving a deterministic `O(n+m)` with no verification and no probability of error. Rabin-Karp preprocesses the pattern into a single *number* and accepts a tiny error probability (eliminated by verification) in exchange for the ability to compare *any* string to that number in `O(1)`. That difference — a number versus an automaton — is exactly why Rabin-Karp generalizes to sets of patterns (a set of numbers), to 2D (a number-of-numbers), and to arbitrary substring queries (prefix-hash arithmetic), while KMP/Z, built around a single linear scan, do not. Neither is "better"; they occupy different points on the generality-versus-guarantee axis.

### What about suffix structures?

Suffix automata and suffix arrays (`05-suffix-structures`) subsume many hashing applications (distinct substrings, longest duplicate) *exactly* and often in `O(n)`. The hashing route trades a log factor and a controllable error probability for dramatically simpler code and lower constant factors. For one-off problems and contests, hashing usually wins on implementation time; for a library that must be exact and is built once, the suffix structure may be worth the complexity.

---

## Prefix-Hash Applications

The prefix-hash form (Section "Deeper Concepts") supports `O(1)` hashing of *any* substring, which unlocks several problems that pure rolling cannot:

### Longest common extension (LCE)

Given two indices `i` and `j`, how far do the suffixes starting there agree? Binary search the length `L`: the answer is at least `L` iff `hashSub(i, i+L−1) == hashSub(j, j+L−1)`. Each probe is `O(1)`, so an LCE query is `O(log n)` after `O(n)` preprocessing. LCE is a building block for suffix comparison, palindrome detection, and string-periodicity tests.

### Longest duplicate substring

Binary search the answer length `L`. For each candidate `L`, hash every length-`L` window (rolling, or via prefix hashes) and insert into a set; if any hash repeats, a duplicate of length `L` exists, so try longer, else shorter. Total `O(n log n)` expected. Verification (or double hashing) guards against a false "duplicate" from a collision. This is the canonical "binary search + hashing" pattern (see `interview.md` Challenge 3).

### Counting distinct substrings of a fixed length

Roll a length-`L` window across the string, insert each hash into a set, and return the set size. With a 61-bit modulus or double hashing the collision probability is negligible, giving an `O(n)` expected count per length. Summing over all `L` gives total distinct substrings in `O(n²)` expected (the suffix automaton does this exactly in `O(n)` — the hashing route trades a factor for simplicity).

### Palindrome checks

Build a forward prefix hash and a *reverse* prefix hash. A substring `T[l..r]` is a palindrome iff its forward hash equals the reverse hash of the same range. Each check is `O(1)`, enabling fast palindrome-counting and longest-palindromic-substring binary searches.

---

## Advanced Patterns

### Pattern: Anchored multi-length search via per-length sets

When patterns have a few distinct lengths `L_1, …, L_t`, maintain one rolling hash *per distinct length* and one set of pattern hashes per length. A single forward pass updates all `t` rolling hashes (each `O(1)`), so total cost is `O(t·n + Σ|P|)`. This stays attractive while `t` is small; once lengths are many and varied, Aho-Corasick (`04-aho-corasick`) is the right tool.

### Pattern: Sliding-window deduplication

To detect near-duplicate windows in a stream (e.g. repeated log lines, shingled document fingerprints), roll a hash over each length-`w` window and record seen hashes in a bounded LRU set. A repeated hash flags a candidate duplicate to verify. This is the kernel of shingling-based similarity detection.

### Pattern: Hash-then-verify as a general filter

Generalize the Rabin-Karp discipline: whenever an expensive equality test can be preceded by a cheap hash compare, use the hash as a *filter* and the full test as *verification*. Database join probes, content-addressable stores, and memoization keys all follow this shape. The rolling property is what makes the filter cheap when the keys are sliding windows.

### Pattern: Combining with binary search on the answer

Many "find the longest/shortest X with property P" string problems become `O(n log n)` by binary searching the length and using a rolling/prefix hash to test property `P` in `O(n)` per length. Longest duplicate substring, longest common substring of two strings, and longest repeated-with-gap substring all fit this template.

---

## Code Examples

### Example: Double-Hash Rabin-Karp with Verification

#### Go

```go
package main

import "fmt"

const (
	b1, p1 = 131, 1_000_000_007
	b2, p2 = 137, 998_244_353
)

func hashPair(s string) (int64, int64) {
	var h1, h2 int64
	for i := 0; i < len(s); i++ {
		h1 = (h1*b1 + int64(s[i]+1)) % p1
		h2 = (h2*b2 + int64(s[i]+1)) % p2
	}
	return h1, h2
}

func search(txt, pat string) []int {
	n, m := len(txt), len(pat)
	var res []int
	if m == 0 || m > n {
		return res
	}
	ph1, ph2 := hashPair(pat)
	var hp1, hp2 int64 = 1, 1
	for i := 0; i < m-1; i++ {
		hp1 = hp1 * b1 % p1
		hp2 = hp2 * b2 % p2
	}
	w1, w2 := hashPair(txt[:m])
	for i := 0; i+m <= n; i++ {
		if w1 == ph1 && w2 == ph2 && txt[i:i+m] == pat {
			res = append(res, i)
		}
		if i+m < n {
			w1 = ((w1-int64(txt[i]+1)*hp1%p1+p1)%p1*b1 + int64(txt[i+m]+1)) % p1
			w2 = ((w2-int64(txt[i]+1)*hp2%p2+p2)%p2*b2 + int64(txt[i+m]+1)) % p2
		}
	}
	return res
}

func main() {
	fmt.Println(search("abracadabra", "abra")) // [0 7]
}
```

#### Java

```java
import java.util.*;

public class DoubleHashRK {
    static final long B1 = 131, P1 = 1_000_000_007L;
    static final long B2 = 137, P2 = 998_244_353L;

    static long[] hashPair(String s) {
        long h1 = 0, h2 = 0;
        for (int i = 0; i < s.length(); i++) {
            int c = s.charAt(i) + 1;
            h1 = (h1 * B1 + c) % P1;
            h2 = (h2 * B2 + c) % P2;
        }
        return new long[]{h1, h2};
    }

    static List<Integer> search(String txt, String pat) {
        int n = txt.length(), m = pat.length();
        List<Integer> res = new ArrayList<>();
        if (m == 0 || m > n) return res;
        long[] ph = hashPair(pat);
        long hp1 = 1, hp2 = 1;
        for (int i = 0; i < m - 1; i++) { hp1 = hp1 * B1 % P1; hp2 = hp2 * B2 % P2; }
        long[] w = hashPair(txt.substring(0, m));
        for (int i = 0; i + m <= n; i++) {
            if (w[0] == ph[0] && w[1] == ph[1] && txt.regionMatches(i, pat, 0, m)) res.add(i);
            if (i + m < n) {
                int out = txt.charAt(i) + 1, in = txt.charAt(i + m) + 1;
                w[0] = ((w[0] - out * hp1 % P1 + P1) % P1 * B1 + in) % P1;
                w[1] = ((w[1] - out * hp2 % P2 + P2) % P2 * B2 + in) % P2;
            }
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(search("abracadabra", "abra")); // [0, 7]
    }
}
```

#### Python

```python
B1, P1 = 131, 1_000_000_007
B2, P2 = 137, 998_244_353


def hash_pair(s):
    h1 = h2 = 0
    for ch in s:
        c = ord(ch) + 1
        h1 = (h1 * B1 + c) % P1
        h2 = (h2 * B2 + c) % P2
    return h1, h2


def search(txt, pat):
    n, m = len(txt), len(pat)
    res = []
    if m == 0 or m > n:
        return res
    ph1, ph2 = hash_pair(pat)
    hp1, hp2 = pow(B1, m - 1, P1), pow(B2, m - 1, P2)
    w1, w2 = hash_pair(txt[:m])
    for i in range(n - m + 1):
        if w1 == ph1 and w2 == ph2 and txt[i:i + m] == pat:
            res.append(i)
        if i + m < n:
            out, inn = ord(txt[i]) + 1, ord(txt[i + m]) + 1
            w1 = ((w1 - out * hp1) * B1 + inn) % P1
            w2 = ((w2 - out * hp2) * B2 + inn) % P2
    return res


if __name__ == "__main__":
    print(search("abracadabra", "abra"))  # [0, 7]
```

**What it does:** maintains two independent rolling hashes; a position is a candidate only if both match, and even then characters are verified.
**Run:** `go run main.go` | `javac DoubleHashRK.java && java DoubleHashRK` | `python dh.py`

### Example: Multi-Pattern Set Matching (Python)

```python
def multi_search(txt, patterns):
    """All patterns share length m. Returns {pattern: [start indices]}."""
    m = len(patterns[0])
    table = {}
    for p in patterns:
        table.setdefault(hash_pair(p), []).append(p)
    n = len(txt)
    result = {p: [] for p in patterns}
    if m > n:
        return result
    hp1, hp2 = pow(B1, m - 1, P1), pow(B2, m - 1, P2)
    w1, w2 = hash_pair(txt[:m])
    for i in range(n - m + 1):
        cands = table.get((w1, w2))
        if cands:
            for p in cands:                  # verify each candidate
                if txt[i:i + m] == p:
                    result[p].append(i)
        if i + m < n:
            out, inn = ord(txt[i]) + 1, ord(txt[i + m]) + 1
            w1 = ((w1 - out * hp1) * B1 + inn) % P1
            w2 = ((w2 - out * hp2) * B2 + inn) % P2
    return result
```

---

## Worked Comparison: Where the Time Goes

Consider searching a 1 MB text (`n = 10^6`) for a 100-character pattern (`m = 100`), with `p = 10^9 + 7`.

- **Naive:** up to `(n−m+1)·m ≈ 10^8` character comparisons. On real (non-adversarial) English text it is far faster because mismatches happen early, but the worst case is `10^8`.
- **Rabin-Karp:** one `O(m)` pattern hash (100 ops), one `O(m)` first-window hash (100 ops), then `~10^6` rolls at a constant ~5 arithmetic ops each (`~5·10^6` ops), plus verification only on hits. Expected spurious hits `≈ (n−m)·(m−1)/p ≈ 10^6·100/10^9 ≈ 0.1` — essentially none. So total ≈ `5·10^6` operations, dominated entirely by the roll.
- **KMP:** `O(m)` failure function plus `O(n)` scan — also `~10^6` steps, with a slightly larger per-step constant but no verification and a hard worst-case guarantee.

The lesson: Rabin-Karp's cost is the roll, not the verification, *as long as the modulus is large*. Shrinking `p` to `101` would push expected spurious hits to `~10^4`, each costing `O(m)` — `~10^6` extra ops — visibly slowing the search. This is the quantitative argument for a large prime.

---

## Step-by-Step: A Collision and Its Rejection

To see verification earn its keep, force a collision with a deliberately tiny modulus `p = 7`, base `b = 10`. Search `P = "12"` in `T = "75"` (treating digits as their numeric codes for clarity).

```
hash("12") = (1·10 + 2) mod 7 = 12 mod 7 = 5
hash("75") = (7·10 + 5) mod 7 = 75 mod 7 = 5
```

The hashes are equal (`5 == 5`) — a **hash hit** — yet `"12" ≠ "75"`. With a tiny modulus, distinct strings collide easily. Verification compares `"75"` to `"12"` character by character, finds them different, and **rejects** the candidate. No false match is reported. Replace `p = 7` with `10^9 + 7` and this particular collision disappears, but the *structural* guarantee — verification rejects every collision — holds for *any* modulus. That is why correctness never depends on the modulus, only speed does.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Two hashes correlated | Same base or same modulus for both. | Use *distinct* `(base, modulus)` pairs; ideally distinct primes. |
| Collisions despite large `p` | Birthday effect across many comparisons. | Switch to double hashing or keep verification. |
| Multi-pattern misses some | Patterns of differing length in one set. | One set per length, or use Aho-Corasick. |
| 2D search wrong | Reused the same base for rows and columns ambiguously. | Use independent bases for the horizontal and vertical passes. |
| Negative residue | Subtraction underflow before reduce. | `(h - x % p + p) % p`. |
| Slow multi-pattern | Re-scanning text per pattern. | Hash all patterns into one set, single text scan. |

---

## Performance Analysis

- **Single pattern:** expected `O(n + m)`, worst `O(n·m)`. The expectation holds because `E[spurious hits] ≈ (n−m)/p ≈ 0` for large `p`.
- **Double hashing:** doubles the constant factor of each roll (two hashes instead of one) but reduces collision probability to `~p^{-2}`; verification then almost never fires.
- **Multi-pattern (equal length `m`, `k` patterns):** `O(n + k·m)` expected — one scan. The set lookup is `O(1)` expected.
- **2D (`R×C` text, `r×c` pattern):** `O(R·C + r·c)` expected. The first pass is `O(R·C)`, the second is `O(R·C)` over the row-hash grid.
- **Cache behavior:** the roll touches only two characters per step, so it is extremely cache-friendly; the verification, when it fires, is a contiguous scan.
- **Constant factors:** each roll is ~2 multiplies, 1 subtract, 1 add, and 1–2 reductions. Double hashing doubles this; a 61-bit Mersenne hash adds a few shift/mask ops for the fold. Against KMP (1 array read + 1 compare + occasional failure-jump per character), Rabin-Karp's per-step constant is slightly higher, but its scan pattern is simpler and branch-light.

### Comparing the variants quantitatively

| Variant | Per-roll ops | Collision rate | Verify cost |
|---------|--------------|----------------|-------------|
| Single 30-bit hash | ~5 | `~10^{-9}` | `O(m)` per hit |
| Double 30-bit hash | ~10 | `~10^{-18}` | rarely fires |
| Single 61-bit hash | ~8 (with fold) | `~4·10^{-19}` | rarely fires |
| Naive (no hash) | — | — | every window is a full compare |

The takeaway: spending 2× per-roll cost on double hashing buys ~`10^9`× fewer collisions — almost always worth it when many strings are compared, and the verification cost then becomes negligible.

---

## Choosing the Right Variant: A Decision Guide

| Situation | Variant | Reasoning |
|-----------|---------|-----------|
| One pattern, trusted input, just need correctness | single 30-bit hash + verify | simplest; verification guarantees exactness |
| One pattern, many comparisons or untrusted input | random base + verify, or 61-bit hash | avoids flooding and birthday collisions |
| Contest, speed over rigor | double 30-bit hash, skip verify | residual error `~p^{-2}` accepted |
| `k` patterns, equal length | hash set of patterns, single scan | `O(n + k·m)` |
| Patterns of a few distinct lengths | one rolling hash + set per length | linear in lengths × `n` |
| Many varied-length patterns | switch to Aho-Corasick | collision-free, length-independent |
| 2D / image / grid | 2D Rabin-Karp (roll twice) | `O(R·C)` |
| Many substring-equality queries | prefix hashes | `O(1)` per query after `O(n)` |
| Binary-search-on-length problems | rolling/prefix hash per length | `O(n log n)` family |

The single most important branch is **verify vs Monte-Carlo**: keep verification whenever a wrong answer is unacceptable; drop it only with a strong (double or 61-bit) hash and an explicit, tiny error budget.

---

## Frequently Asked Middle-Level Questions

**Why does the leftmost character get the highest power?** So that the character *removed* during a roll is the one carrying `b^{m-1}` — making the rolling update a clean "subtract the top term, shift, add the bottom term." The opposite convention also works but makes the update formula uglier.

**Can I skip recomputing `b^{m-1}` per pattern?** Yes if all patterns share length `m`: compute it once. If lengths vary, you need one high power per length (cache them).

**Is double hashing the same as a 64-bit hash?** Conceptually similar in collision rate, but two independent 30-bit hashes are usually faster than one true 64-bit `mulmod` in languages without `__int128`, and they keep every product inside 64 bits without special handling. A single `2^{61}−1` hash is the cleaner choice when 128-bit multiply is cheap.

**Why not just use the language's built-in substring search?** For a single short pattern it is usually faster (tuned two-way algorithm). Reach for Rabin-Karp when the *shape* of the problem is multi-pattern, 2D, or substring-equality queries — that is where the rolling hash's flexibility pays off.

**Does the alphabet size matter?** The base must exceed the maximum character code so each symbol is a distinct digit; beyond that, a larger alphabet does not change the asymptotics, only the constant in the collision bound (`(m−1)/p` is alphabet-independent given a random base).

**Can I roll backward?** Yes — the same algebra runs in reverse: to move the window from `T[i..i+m-1]` to `T[i-1..i+m-2]`, subtract the trailing character, divide by the base (multiply by `b^{-1} mod p`), and add the new leading character times `b^{m-1}`. The backward roll needs a modular inverse, so the forward roll is preferred; bidirectional scans usually just keep two independent forward hashes.

**Why offset character codes by 1?** Without the offset, a character mapped to code `0` contributes nothing, so `"\0abc"` and `"abc"` (different lengths) or `"a"` and `"aa"` can hash alike in edge cases. Mapping every symbol to `{1, …, |Σ|}` guarantees distinct-length all-same-char strings get distinct hashes and leading symbols never vanish.

**How do I pick between one 61-bit hash and two 30-bit hashes?** If your language has a cheap 128-bit multiply (C/C++/Rust `__int128`, or Go `bits.Mul64`), the single 61-bit hash is simpler and faster. If not (or in contest Java), two 30-bit hashes keep every product inside a native 64-bit word with no special handling, at the cost of a second roll per step.

---

## Best Practices

- Default to a large prime modulus near `10^9`; upgrade to double hashing or `2^61 − 1` when correctness pressure is high.
- Offset character codes by 1 so distinct-length all-same-char strings never collide trivially.
- Keep verification in production code; rely on double-hash-only correctness solely in throwaway contexts.
- For multi-pattern, store the pattern next to its hash so verification can resolve which one matched.
- For 2D, decompose explicitly into a horizontal pass then a vertical pass — do not try to write one fused quadruple loop.
- Benchmark against KMP/Z; if the input is single-pattern and adversarial, prefer those.
- Precompute both the prefix-hash array and the power array in one `O(n)` pass when you need substring queries; never exponentiate per query.
- For multi-pattern and binary-search-on-length problems, scale the modulus with the *number of comparisons* (favor 61-bit or double hashing), not merely with the string length.
- Decide verify-vs-Monte-Carlo explicitly and document it; the choice is the single biggest correctness lever in the whole technique.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates the window sliding across the text, the rolling hash updating as the leading character leaves and the trailing character enters, the hash-vs-pattern comparison, and the verification step on a hash hit. Edit the text and pattern to watch collisions and confirmed matches play out.

---

## Summary

At middle level, mastery of Rabin-Karp means treating the rolling hash as a tunable, composable component rather than a fixed recipe — choosing parameters from collision math, composing it into sets and grids, and placing it correctly against KMP, Z, Aho-Corasick, and suffix structures.

The correctness and speed of Rabin-Karp live in three middle-level decisions. **First**, the base and modulus: a large prime keeps the per-comparison collision rate near `1/p`, and a random base defeats adversaries. **Second**, double hashing: two independent hashes drive collisions to `~p^{-2}`, effectively eliminating spurious hits — though verification stays in code that must never be wrong. **Third**, the rolling-hash skeleton generalizes: hash a *set* of equal-length patterns for one-scan multi-pattern search, and roll *twice* (horizontal then vertical) for 2D grid matching. Against KMP and Z, Rabin-Karp trades a worst-case guarantee for unmatched flexibility — multi-pattern, 2D, and `O(1)` substring comparison via prefix hashes. Choose it when that flexibility is what the problem needs.

The next file, `senior.md`, takes these decisions into production: defending against hash flooding with a randomized base, keeping 64-bit arithmetic exact, and reusing the very same rolling hash as the engine of fingerprinting and content-defined chunking.

The file after that, `professional.md`, proves the collision bound and expected-time analysis that justify every parameter choice made here, including why a prime field is required and why verification — not the modulus — is what guarantees correctness.
