# Lyndon Words & Duval's Algorithm — Middle Level

> **Focus:** how Duval's three-pointer scan actually achieves `O(n)` time and `O(1)` space, how to turn it into a smallest/largest cyclic rotation finder via `s + s`, how to *generate* all Lyndon words (FKM/Duval generation) and build de Bruijn sequences, and how these compare to Booth's algorithm and suffix-array approaches.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Generating Lyndon Words and de Bruijn Sequences](#generating-lyndon-words-and-de-bruijn-sequences)
6. [Necklaces, Bracelets, and Counting](#necklaces-bracelets-and-counting)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was two facts: a Lyndon word is strictly smaller than its rotations, and Duval factors any string into non-increasing Lyndon words in `O(n)`. At middle level you start asking the engineering questions that decide whether your solution is correct *and* fast:

- *Why* is Duval `O(n)` despite the inner loop that sometimes resets? Where does the amortization come from?
- How do the three pointers `i`, `j`, `k` encode "a run of equal Lyndon words plus a prefix of the next"?
- How do you adapt the factorization to find the **smallest** *and* **largest** cyclic rotation, and why does the straddling factor give the answer?
- How do you *generate* every Lyndon word up to length `n` in amortized `O(1)` per word (the FKM algorithm), and how does concatenating the right ones yield a **de Bruijn sequence**?
- When should you reach for Booth's algorithm or a suffix array instead?

These questions separate "I memorized the Duval snippet" from "I can adapt it, prove it terminates in linear time, and pick the right tool for a cyclic-string problem."

---

## Deeper Concepts

### The invariant behind the three pointers

Duval processes the string in outer rounds. Each round starts at index `i` and grows a candidate. The pointers mean:

```
i  = start of the segment still being factored
j  = look-ahead: the next character to read (j > i always)
k  = trailing pointer; (j - k) is the current period length being tested
```

The invariant maintained throughout the inner loop is:

> `s[i .. j)` is a sequence of zero or more **equal** Lyndon words of length `p = j - k`, followed by a **proper prefix** of one more copy of that same Lyndon word.

Three cases drive the loop when reading `s[j]` against `s[k]`:

1. **`s[j] == s[k]`** — the current period continues; advance both `j` and `k`. The candidate is still a power-of-a-Lyndon-word prefix.
2. **`s[j] > s[k]`** — the candidate can be *extended* into a longer Lyndon word; the whole `s[i..j]` becomes a fresh single Lyndon word, so reset `k = i` (period becomes `j - i + 1`) and advance `j`.
3. **`s[j] < s[k]`** — the run of equal Lyndon words is *finished*; emit them. Each completed factor has length `p = j - k`, and we output `⌊(k - i)/p⌋ + 1`... in code, we emit while `i <= k`, advancing `i += p` each time.

### Why `O(n)`: the amortization

The subtlety is that `j` only ever moves forward (it never backtracks), and `i` only ever moves forward. The inner loop advances `j` on every iteration. When a factor is emitted, `i` jumps forward by the factor length. The total forward motion of `j` across the whole run is bounded: `j` can be reset relative to `k`, but the *number of character reads* is `O(n)` because each emitted factor "pays for" the look-ahead that discovered it. Formally, the work in each outer round is proportional to the length consumed plus the look-ahead, and the look-ahead is charged to the next round — a standard amortized argument giving **`O(n)` total**, with only the three integer pointers as state (`O(1)` extra space).

### Worked invariant illustration

For `s = "aabaab"`, after consuming `"aab"` Duval is testing whether the candidate repeats. The pointers reach a state where `i = 0`, the period `p = 3`, and the segment `s[0..6) = "aabaab" = ("aab")²` — two equal Lyndon words `"aab"`. Since there is no larger trailing letter to extend the candidate (the string ends), Duval emits **two** factors `"aab"`, `"aab"`. The invariant `x^q · x'` held with `x = "aab"`, `q = 2`, `x'` empty — exactly the "run of equal Lyndon words" the three pointers encode. Contrast `s = "aabaac"`: the trailing `c` is larger, so the candidate extends and the whole string becomes one Lyndon word.

### Two equivalent Lyndon definitions, operationally

Recall a Lyndon word `w` satisfies both:

```
(A)  w  <  every proper rotation        (B)  w  <  every proper suffix
```

Duval relies on (B): comparing `s[j]` to `s[k]` is comparing the current character against the corresponding character of the period — effectively checking whether the suffix starting where the period restarts could be smaller than the candidate. When `s[j] < s[k]`, a smaller suffix has appeared, so the candidate's Lyndon-ness is "sealed" at the period boundary, and we emit.

### The straddling-factor rule for rotations

For the smallest cyclic rotation of `s` (length `n`), run Duval on `t = s + s`. The factorization of `t` produces Lyndon factors; the answer is the **start index of the last factor that begins at an index `< n`**. Equivalently, you track the most recent factor start `≤ n - 1` and stop once `i` reaches or passes `n`. The smallest rotation begins there because the Lyndon factor straddling position `n` is, by the theorem's ordering, the smallest aligned wrap-around block.

### Worked rotation trace

Take `s = "cba"` (`n = 3`), `t = "cbacba"`. Duval factors `t` as `c · b · acb · a` with factor starts `0, 1, 2, 5`. The last start `< n = 3` is `2` (the factor `"acb"`). So the smallest rotation begins at index `2`: `s[2:] + s[:2] = "a" + "cb" = "acb"`. Check by hand: rotations of `"cba"` are `cba, bac, acb`; the smallest is indeed `"acb"`. The straddling factor `"acb"` is itself Lyndon and is exactly the answer — the monotone non-increasing factor order guarantees that the deepest factor start before the midline is the best rotation point.

---

## Comparison with Alternatives

### Smallest rotation: Duval-on-`s+s` vs Booth vs suffix array

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| Brute force (compare all rotations) | `O(n²)` worst | `O(n)` | The baseline; `aaaa…ab` is the killer case. |
| **Duval on `s + s`** | `O(n)` | `O(n)` for `s+s`, `O(1)` extra logic | Cleanest linear method; reuses the factorization engine. |
| **Booth's algorithm** | `O(n)` | `O(n)` | Purpose-built least-rotation; KMP-style failure function. |
| Suffix array of `s + s` | `O(n)` or `O(n log n)` | `O(n)` | Overkill for just the least rotation, but reusable for many queries. |

For a one-shot least rotation, Duval-on-`s+s` and Booth are both `O(n)`; Duval wins on code reuse (you already have the factorizer). A suffix array (sibling `04-suffix-arrays`) is the right call only when you need many other suffix queries on the same string.

### Worst-case input intuition

The classic worst case for *brute-force* least rotation is a long run of one character followed by a larger one, e.g. `"aaaa…ab"`: comparing rotations pairwise re-scans the run repeatedly, giving `O(n²)`. Duval-on-`s+s` handles this in `O(n)` because equal characters merely advance the period pointer `k` without re-comparison, and the single larger character at the end resolves the whole candidate at once. Whenever you suspect adversarial periodic-ish input, the linear method is mandatory — and this is precisely the input you should benchmark against (Task B in `tasks.md`).

### Lyndon factorization vs suffix structures

| Need | Tool | Why |
|------|------|-----|
| Unique non-increasing Lyndon split | Duval | `O(n)`, `O(1)` space, streams output |
| Smallest rotation (one string) | Duval on `s+s` / Booth | linear, minimal overhead |
| Many rotation/substring queries | suffix array / suffix automaton | amortizes preprocessing |
| BWT construction | rotations sorted (relates to Lyndon) | `10-burrows-wheeler-transform` |
| Pattern search | KMP / Z-function | `01-kmp`, `02-z-function` |

### Largest rotation

The **largest** cyclic rotation is obtained the same way as the smallest, but with the comparison reversed. Two clean implementations:

1. **Invert the alphabet:** map each character `c → MAX_CHAR - c` (or negate the comparator), run the smallest-rotation routine, and the index it returns is the *largest* rotation of the original.
2. **Flip the inner comparison:** swap the roles of `<` and `>` in Duval's inner loop and the `<=` guard becomes `>=`. This produces the "co-Lyndon" factorization whose straddling factor gives the largest rotation.

Inverting the alphabet keeps one well-tested routine; flipping comparisons risks subtle bugs.

### Why inversion is correct

Mapping `c → MAX - c` reverses the total order: what was the smallest character becomes the largest and vice versa. Since lexicographic comparison is defined purely by the character order, reversing it turns "lexicographically smallest rotation" into "lexicographically largest rotation of the original." The rotation *structure* (which positions are rotations of which) is unaffected by the per-character map, so the index returned by the smallest-rotation routine on the inverted string is exactly the start of the largest rotation of the original string. Slice the *original* (not inverted) string at that index to get the answer.

---

## Advanced Patterns

### Pattern: Smallest cyclic rotation (index + string)

#### Go

```go
package main

import "fmt"

// leastRotation returns the starting index of the smallest cyclic rotation of s.
func leastRotation(s string) int {
	n := len(s)
	t := s + s
	i, ans := 0, 0
	for i < n {
		ans = i
		j, k := i+1, i
		for j < 2*n && t[k] <= t[j] {
			if t[k] < t[j] {
				k = i
			} else {
				k++
			}
			j++
		}
		for i <= k {
			i += j - k
		}
	}
	return ans
}

func main() {
	s := "bbaaccaadd"
	idx := leastRotation(s)
	fmt.Println("index:", idx)
	fmt.Println("rotation:", s[idx:]+s[:idx])
}
```

#### Java

```java
public class LeastRotation {
    static int leastRotation(String s) {
        int n = s.length();
        String t = s + s;
        int i = 0, ans = 0;
        while (i < n) {
            ans = i;
            int j = i + 1, k = i;
            while (j < 2 * n && t.charAt(k) <= t.charAt(j)) {
                if (t.charAt(k) < t.charAt(j)) k = i;
                else k++;
                j++;
            }
            while (i <= k) i += j - k;
        }
        return ans;
    }

    public static void main(String[] args) {
        String s = "bbaaccaadd";
        int idx = leastRotation(s);
        System.out.println("index: " + idx);
        System.out.println("rotation: " + s.substring(idx) + s.substring(0, idx));
    }
}
```

#### Python

```python
def least_rotation(s: str) -> int:
    """Return the start index of the lexicographically smallest rotation of s."""
    n = len(s)
    t = s + s
    i, ans = 0, 0
    while i < n:
        ans = i
        j, k = i + 1, i
        while j < 2 * n and t[k] <= t[j]:
            k = i if t[k] < t[j] else k + 1
            j += 1
        while i <= k:
            i += j - k
    return ans


if __name__ == "__main__":
    s = "bbaaccaadd"
    idx = least_rotation(s)
    print("index:", idx)
    print("rotation:", s[idx:] + s[:idx])
```

### Pattern: Largest rotation via alphabet inversion

#### Python

```python
def greatest_rotation(s: str) -> int:
    # invert the alphabet so "smallest under reversed order" = "largest"
    inv = "".join(chr(255 - ord(c)) for c in s)
    return least_rotation(inv)  # same index maps back to the original string
```

The returned index is the start of the *largest* rotation of `s`; build it with `s[idx:] + s[:idx]`.

---

## Generating Lyndon Words and de Bruijn Sequences

### FKM (Fredricksen-Kessler-Maiorana) / Duval generation

Beyond *factoring* a string, you can **generate** every Lyndon word over an alphabet of size `σ` up to length `n`, in lexicographic order, in **amortized `O(1)` per word**. The algorithm builds each next Lyndon word from the previous one:

```
GENERATE-LYNDON(n, sigma):
    w = [0]                         # start with the smallest single letter
    while w is non-empty:
        output w                    # w is a Lyndon word (if len divides target, see de Bruijn)
        # extend w to length n by repeating it, then strip trailing max letters
        m = len(w)
        w = (w repeated to length n)            # w[i] = w[i mod m]
        while w and w[-1] == sigma - 1:
            w.pop()                 # remove trailing maximal letters
        if w:
            w[-1] += 1              # increment the last non-maximal letter
```

Each generated `w` is a Lyndon word, and they come out in lexicographic order. This is the classic FKM enumeration; Duval gave the amortized-`O(1)` analysis.

### de Bruijn sequence from Lyndon words

A **de Bruijn sequence** `B(σ, k)` is a cyclic string over a `σ`-letter alphabet in which every length-`k` string appears exactly once as a (cyclic) substring. The FKM theorem says:

> Concatenating, in lexicographic order, all Lyndon words over the alphabet whose **length divides `k`**, yields a de Bruijn sequence `B(σ, k)`.

So generate Lyndon words up to length `k`, keep those whose length divides `k`, and concatenate them in order. The result has length `σᵏ` and is a de Bruijn sequence. This is one of the most elegant uses of Lyndon words.

### Code: generate Lyndon words and build a de Bruijn sequence

#### Python

```python
def lyndon_words(n: int, sigma: int) -> list[str]:
    """All Lyndon words of length <= n over alphabet {0..sigma-1}, lexicographic."""
    result = []
    w = [0]
    while w:
        result.append("".join(map(str, w)))
        m = len(w)
        # extend by repetition up to length n
        while len(w) < n:
            w.append(w[len(w) - m])
        # strip trailing maximal letters, then increment
        while w and w[-1] == sigma - 1:
            w.pop()
        if w:
            w[-1] += 1
    return result


def de_bruijn(sigma: int, k: int) -> str:
    """de Bruijn sequence B(sigma, k): concat Lyndon words whose length divides k."""
    seq = []
    for word in lyndon_words(k, sigma):
        if k % len(word) == 0:
            seq.append(word)
    return "".join(seq)


if __name__ == "__main__":
    print(lyndon_words(3, 2))   # ['0','001','01','011','1']
    print(de_bruijn(2, 3))      # 00010111  (length 2^3 = 8)
```

#### Go

```go
package main

import (
	"fmt"
	"strconv"
	"strings"
)

func lyndonWords(n, sigma int) []string {
	var result []string
	w := []int{0}
	for len(w) > 0 {
		var sb strings.Builder
		for _, c := range w {
			sb.WriteString(strconv.Itoa(c))
		}
		result = append(result, sb.String())
		m := len(w)
		for len(w) < n {
			w = append(w, w[len(w)-m])
		}
		for len(w) > 0 && w[len(w)-1] == sigma-1 {
			w = w[:len(w)-1]
		}
		if len(w) > 0 {
			w[len(w)-1]++
		}
	}
	return result
}

func deBruijn(sigma, k int) string {
	var sb strings.Builder
	for _, word := range lyndonWords(k, sigma) {
		if k%len(word) == 0 {
			sb.WriteString(word)
		}
	}
	return sb.String()
}

func main() {
	fmt.Println(lyndonWords(3, 2)) // [0 001 01 011 1]
	fmt.Println(deBruijn(2, 3))    // 00010111
}
```

#### Java

```java
import java.util.*;

public class LyndonGen {
    static List<int[]> lyndonRaw(int n, int sigma) {
        List<int[]> result = new ArrayList<>();
        List<Integer> w = new ArrayList<>();
        w.add(0);
        while (!w.isEmpty()) {
            int[] snap = new int[w.size()];
            for (int i = 0; i < w.size(); i++) snap[i] = w.get(i);
            result.add(snap);
            int m = w.size();
            while (w.size() < n) w.add(w.get(w.size() - m));
            while (!w.isEmpty() && w.get(w.size() - 1) == sigma - 1) w.remove(w.size() - 1);
            if (!w.isEmpty()) w.set(w.size() - 1, w.get(w.size() - 1) + 1);
        }
        return result;
    }

    static String deBruijn(int sigma, int k) {
        StringBuilder sb = new StringBuilder();
        for (int[] word : lyndonRaw(k, sigma)) {
            if (k % word.length == 0)
                for (int c : word) sb.append(c);
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(deBruijn(2, 3)); // 00010111
    }
}
```

---

## Necklaces, Bracelets, and Counting

A **necklace** is an equivalence class of strings under rotation; a **bracelet** additionally allows reflection. The smallest rotation is the canonical representative of a necklace, which is exactly why Duval-on-`s+s` gives a canonical form: two strings are rotation-equivalent iff they share the same smallest rotation.

There is a precise count of Lyndon words. The number of Lyndon words of length exactly `n` over a `σ`-letter alphabet is given by **Witt's formula** (a Möbius inversion):

```
L(σ, n) = (1/n) · Σ_{d | n}  μ(d) · σ^(n/d)
```

where `μ` is the Möbius function. This equals the number of *aperiodic* necklaces of length `n`. The total number of necklaces (including periodic ones) is the related **necklace-counting** formula `(1/n) Σ_{d|n} φ(d) σ^(n/d)` (Burnside/Pólya). These connect Lyndon words directly to enumerative combinatorics; the full derivation is in [`professional.md`](./professional.md).

A quick consequence: since every string has a unique Lyndon factorization, and de Bruijn sequences pack each length-`k` window exactly once, the counts line up — `Σ_{d | k} d · L(σ, d) = σᵏ`, the de Bruijn length.

### A worked count

For binary strings (`σ = 2`), the Lyndon-word counts of small length are `L(2,1)=2, L(2,2)=1, L(2,3)=2, L(2,4)=3`. Checking length 3 by hand: the length-3 binary Lyndon words are `001` and `011` (each strictly smaller than its rotations; `000` and `111` are constant/periodic, and `010, 100, 101, 110` are non-minimal rotations or periodic). That matches `L(2,3) = (1/3)(2³ − 2) = 2`. These small counts are the unit tests for any Witt-formula or generation implementation, and they tie directly to the necklace count: 2 aperiodic length-3 binary necklaces, plus the 2 constant ones, gives the standard necklace total.

---

## Code Examples

### Verifying a Lyndon factorization (oracle + checker)

This pairs Duval with a brute-force verifier, which is exactly how you should test.

#### Python

```python
def is_lyndon(w: str) -> bool:
    return all(w < w[i:] + w[:i] for i in range(1, len(w)))


def duval(s: str) -> list[str]:
    n, i, out = len(s), 0, []
    while i < n:
        j, k = i + 1, i
        while j < n and s[k] <= s[j]:
            k = i if s[k] < s[j] else k + 1
            j += 1
        while i <= k:
            out.append(s[i:i + j - k])
            i += j - k
    return out


def verify(s: str) -> bool:
    fac = duval(s)
    assert "".join(fac) == s, "factors must concatenate to s"
    assert all(is_lyndon(f) for f in fac), "every factor must be Lyndon"
    assert all(fac[t] >= fac[t + 1] for t in range(len(fac) - 1)), "non-increasing"
    return True


if __name__ == "__main__":
    for s in ["banana", "bbababaa", "aaaa", "abcabc", "zyx"]:
        print(s, duval(s), verify(s))
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Inner comparison swapped | Reset on `==` and extend on `<` produce garbage factors. | Reset `k = i` only on strict `s[k] < s[j]`; advance `k` on equality. |
| Reading past the end | `s[j]` out of range when `j == n` (or `2n`). | Guard `j < n` (resp. `j < 2n`) before the comparison. |
| Rotation index `≥ n` | Returned a `s+s` index without clamping. | The least-rotation start is always `< n`; track the last factor start `< n`. |
| Largest rotation reuses smallest code | Returns the smallest, not the largest. | Invert the alphabet or flip both comparisons consistently. |
| de Bruijn includes wrong words | Concatenated all Lyndon words, not just length-dividing-`k`. | Filter to `len(word)` divides `k`. |
| Empty alphabet / `sigma = 0` | Generation loops forever or crashes. | Require `sigma ≥ 1`; the single-letter word is the base case. |

---

## Performance Analysis

| Input size `n` | Duval factorization | Smallest rotation (`s+s`) | Brute-force rotation |
|----------------|---------------------|---------------------------|----------------------|
| 10³ | ~10³ char ops — instant | ~2·10³ — instant | ~10⁶ — instant |
| 10⁵ | ~10⁵ — instant | ~2·10⁵ — instant | ~10¹⁰ — too slow |
| 10⁶ | ~10⁶ — a few ms | ~2·10⁶ — a few ms | infeasible |
| 10⁷ | ~10⁷ — tens of ms | ~2·10⁷ — tens of ms | infeasible |

The linear methods scale to tens of millions of characters; brute force collapses past `~10⁴`. The dominant cost in Duval is one character comparison per step, so the constant factor is tiny — the biggest practical wins are avoiding substring construction in the inner loop and using byte arrays for ASCII.

```python
import time

def benchmark(n: int) -> float:
    s = ("ab" * (n // 2))  # periodic worst-ish case
    start = time.perf_counter()
    _ = least_rotation(s)
    return time.perf_counter() - start

# Typical: n = 10**6 -> a few milliseconds in CPython.
```

For generation, FKM/Duval emits each Lyndon word in amortized `O(1)`, so producing all `L` Lyndon words up to length `n` costs `O(L + total length)` — optimal up to output size.

---

## Best Practices

- **Reuse one factorizer.** Build `duval` once, then layer `least_rotation` and `greatest_rotation` on top via alphabet mapping.
- **Compare characters, never substrings,** inside the inner loop — the single most important performance rule.
- **Track the last factor start `< n`** for the rotation problem instead of scanning the whole `s + s` factorization afterward.
- **Filter Lyndon words by `len | k`** when building de Bruijn sequences; forgetting the divisibility filter is the classic bug.
- **Validate against brute force** (`is_lyndon`, non-increasing-order check) on random small strings in CI.
- **Pin the alphabet order** and document it; the entire result depends on it.
- **Benchmark on adversarial input** (`"a"*(n-1) + "b"`) so a substring-in-loop regression that destroys linearity is caught early.
- **Return indices, not copies,** for rotations — let the caller slice once; this keeps the hot path allocation-free.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The `i`, `j`, `k` pointers and the current period length `j - k` as Duval scans.
> - The growing candidate Lyndon factor and the exact step where factors are emitted.
> - A toggle into **smallest-rotation mode** showing the scan over `s + s` and the straddling factor that marks the answer index.

---

## Summary

Duval's algorithm is `O(n)` time and `O(1)` extra space because its `i` and `j` pointers only move forward and the look-ahead is amortized against the factors it discovers; the three pointers encode "a run of equal Lyndon words plus a prefix of the next," with the comparison `s[j]` vs `s[k]` choosing to extend, reset, or emit. Running Duval on `s + s` finds the **smallest cyclic rotation** in linear time (the factor straddling position `n`), and inverting the alphabet gives the **largest** rotation. The **FKM/Duval generation** algorithm enumerates all Lyndon words up to length `n` in amortized `O(1)` each, and concatenating those whose length divides `k` yields a **de Bruijn sequence** `B(σ, k)`. Lyndon words count *aperiodic necklaces* (Witt's formula), tying the algorithm to combinatorics on words. Choose Duval-on-`s+s` over Booth for code reuse, and over suffix arrays unless you need many other queries.
