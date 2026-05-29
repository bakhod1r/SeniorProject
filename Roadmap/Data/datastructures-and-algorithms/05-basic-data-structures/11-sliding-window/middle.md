# Sliding Window — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing Fixed vs Variable](#choosing-fixed-vs-variable)
3. [Catalog of Window-State Structures](#catalog-of-window-state-structures)
4. [Comparison with Two Pointers](#comparison-with-two-pointers)
5. [Comparison with Prefix Sums](#comparison-with-prefix-sums)
6. [Classic Problem Catalog](#classic-problem-catalog)
7. [Pattern: Frequency-Map Window](#pattern-frequency-map-window)
8. [Pattern: Counter-with-Matched Window](#pattern-counter-with-matched-window)
9. [Pattern: At-Most-K-Distinct](#pattern-at-most-k-distinct)
10. [Pattern: Window with Monotonic Deque](#pattern-window-with-monotonic-deque)
11. [Code Examples](#code-examples)
12. [Performance Considerations](#performance-considerations)
13. [Best Practices](#best-practices)
14. [Visual Animation](#visual-animation)
15. [Summary](#summary)

---

## Introduction

> Focus: "Which flavor and which state?" and "When is sliding window the wrong tool?"

At the junior level, you know the two templates and can write `max-sum-k` and `longest-substring-no-repeat` from memory. At the middle level the harder questions are:

- The problem doesn't say "window" — how do I recognize one?
- I picked the variable template — what should my window state be?
- Should I use a sliding window or a prefix sum or a two-pointer pass?
- My pointer is moving correctly but my answer is off — what invariant am I breaking?

This level is about pattern-matching, structure choice, and trade-offs against related techniques.

---

## Choosing Fixed vs Variable

Run the input through this decision tree:

```text
Does the problem specify an exact window width k?
  YES -> FIXED-SIZE template.
         Window state grows once at the start, then is updated in lockstep.

  NO  -> Does the problem ask for the longest/shortest/some-extreme
         contiguous range satisfying a CONDITION?
         YES -> VARIABLE-SIZE template.
                Expand right while you can, shrink left while you must.

         NO  -> Probably NOT a sliding-window problem.
                Consider: prefix sums, hash maps, DP, two pointers.
```

Two subtleties of the variable template:

1. **Direction of the answer**. If you want the **longest** valid window, you record `r - l + 1` *after* the shrink loop (because the window is then valid). If you want the **shortest** valid window, you record `r - l + 1` *inside* the shrink loop (because every shrink step still gives a valid window if the invariant is "contains all of target", and we want the smallest such window).
2. **Monotonicity**. The variable template only works if the invariant is **monotone**: adding to the window can only make the invariant "more violated", and removing can only make it "less violated". For "sum ≤ K" with all positive numbers, this holds. For "sum ≤ K" with mixed-sign numbers, it does not — you must fall back to prefix sums plus a sorted map.

---

## Catalog of Window-State Structures

The "window state" is what you maintain between iterations. The right choice is the difference between an `O(n)` solution and a wrong one.

| State | Operations needed | Cost per op | Use case |
|-------|-------------------|-------------|----------|
| Integer sum | add, subtract | O(1) | Range sum, average, weighted count |
| Hash set | add, remove, contains | O(1) avg | "All distinct in window" |
| Hash map (counter) | inc, dec, lookup, size | O(1) avg | Frequency counts, "at most k distinct" |
| Monotonic deque | push, pop-front, pop-back | O(1) amortized | Sliding window max/min — see [14-monotonic-queue](../14-monotonic-queue/junior.md) |
| Two counters + matched | inc, dec, comparisons | O(1) | "Contains all of target" |
| Sorted map / multiset | insert, erase, min/max | O(log k) | Median in window, k-th order statistic |
| Bitmap (fixed alphabet) | set, clear, popcount | O(1) | "All 26 letters present" |

Most interview problems hit only the first five. If you reach for a sorted map, double-check you couldn't get away with a counter and a "matched" integer.

---

## Comparison with Two Pointers

Sliding window is a **specialization** of two pointers with extra structure:

| | Generic two pointers | Sliding window |
|---|----------------------|----------------|
| Pointers | Can move in any direction (often converging) | `right` only moves forward; `left` only moves forward |
| Range meaning | Often a pair `(a[l], a[r])` to evaluate | A contiguous range `[l..r]` you summarize |
| Internal state | Usually none | Always a maintained aggregate |
| Classic problem | Two-sum on sorted array | Longest substring no repeat |
| Invariant style | Equality / target match | Monotone constraint on window aggregate |

**Heuristic.** If you find yourself maintaining a `count` map or a sum that you update every step, you are doing sliding window even if you started by saying "two pointers". The vocabulary is fuzzy; the templates are not.

See [10-two-pointers](../10-two-pointers/middle.md) for the converging variant, which complements this one. The two are taught together because they look similar but are used for different problem shapes.

---

## Comparison with Prefix Sums

Both techniques attack range problems on arrays. They are not interchangeable.

| | Sliding window | Prefix sums |
|---|----------------|-------------|
| Range shape | Contiguous, walks left-to-right | Any range `[l..r]`, queries in arbitrary order |
| Per-query cost | O(1) amortized while you stream | O(1) after O(n) precompute |
| Modifications | Inherently streaming | Static (or use a Fenwick tree / segment tree) |
| Handles negatives in "sum ≤ K"? | No — shrink invariant breaks | Yes — combine with a hash map of seen prefixes |
| Tracks distinct elements / characters? | Yes (with a set/counter) | No — prefix sums only compose under addition |
| Memory | O(1) + state | O(n) prefix array |

**When to choose prefix sums** instead of sliding window:

- You will be asked many range-sum queries on the **same** array.
- Numbers can be negative and the constraint is on a sum.
- You need to count subarrays whose sum equals a target (use hash map of prefix counts).

**When to choose sliding window** instead of prefix sums:

- The constraint is on something prefix sums can't compose: distinct counts, max element, character matching.
- Numbers are non-negative and the constraint is monotone.
- The problem is naturally streaming or online.

The two often coexist in one codebase: a stream processor might use prefix sums on stable historic data and sliding window on the live tail.

See [12-prefix-sums-difference-arrays](../12-prefix-sums-difference-arrays/middle.md) for the full prefix-sum treatment.

---

## Classic Problem Catalog

Here is a working list of interview problems and the right approach for each.

### Fixed-size

| Problem | Window state | Notes |
|---------|--------------|-------|
| Max sum of `k` consecutive | Integer sum | The canonical fixed example. |
| Average of every `k`-window | Integer sum / k | Same code, divide at the end. |
| First negative in every `k`-window | Deque of indices of negatives | Pop when `front < r - k + 1`. |
| Sliding window maximum (LC 239) | Monotonic decreasing deque | Cross-link to [14-monotonic-queue](../14-monotonic-queue/junior.md). |
| Sliding window minimum | Monotonic increasing deque | Mirror of the above. |
| Permutation in string (LC 567) | Two count arrays of size 26 | Compare arrays in O(26) = O(1). |
| Find all anagrams in string (LC 438) | Count array of size 26 + matched | Slide and re-check matched count. |
| Maximum points from cards | Sum of first `k` + sum of last `k` window | Reframe: smallest window of middle `n - k`. |

### Variable-size — longest

| Problem | Invariant | State |
|---------|-----------|-------|
| Longest substring no repeat (LC 3) | Each char appears ≤ 1 time | Counter (or set) |
| Longest substring with at most `k` distinct (LC 340) | `distinctCount <= k` | Counter + distinct counter |
| Fruit into baskets (LC 904) | At most 2 distinct types | Counter, alphabet of types |
| Longest substring same letter after `k` flips (LC 424) | `windowLen - maxFreq <= k` | Counter + running max freq |
| Longest subarray sum ≤ S (positive) | Sum ≤ S | Integer sum |
| Max consecutive ones with at most `k` zeros flipped (LC 1004) | `zerosInWindow <= k` | Integer counter |

### Variable-size — shortest

| Problem | Invariant | State |
|---------|-----------|-------|
| Minimum window substring (LC 76) | Window contains every required count of target chars | Counter target + matched count |
| Smallest subarray with sum ≥ S (positive) | Sum ≥ S | Integer sum |
| Shortest substring containing every distinct char (LC 76 variant) | All distinct chars of input present | Counter + matched |

### Where sliding window is the WRONG tool

| Problem | Why not sliding window | What to use instead |
|---------|------------------------|----------------------|
| Subarray sum equals K (LC 560) | Numbers may be negative — invariant non-monotone | Prefix sum + hash map |
| Longest valid parentheses | Not a monotone range invariant | Stack |
| Maximum subarray (Kadane) | Range that can include any prefix — no shrink condition | Linear DP |
| Range sum with updates | Mutations break "amortized once" | Fenwick / segment tree |
| Top-k elements in window | Need order statistics, not just min/max | Sorted multiset + lazy deletion |

---

## Pattern: Frequency-Map Window

For "distinct chars" or "anagram" problems, the state is a counter `count[ch] -> times in window`.

```text
init count = empty
l = 0
for r in 0..n-1:
    count[a[r]] += 1
    while invariant_violated(count):
        count[a[l]] -= 1
        if count[a[l]] == 0: delete count[a[l]]
        l += 1
    update_answer(r - l + 1)
```

The classic mistake: not deleting zero-count entries. If you read `len(count)` as "distinct chars in window", a zero entry inflates it and you get wrong answers.

---

## Pattern: Counter-with-Matched Window

For "contains every char of target": maintain `need[ch] -> required count`, `have[ch] -> current count`, and `matched -> number of distinct chars whose required count is met`.

```text
need = Counter(target)
have = empty counter
matched = 0
l = 0
best = (infinity, l, r)
for r in 0..n-1:
    have[a[r]] += 1
    if a[r] in need and have[a[r]] == need[a[r]]:
        matched += 1
    while matched == len(need):
        # window is valid — try to shrink it
        if r - l + 1 < best.length: best = (length, l, r)
        have[a[l]] -= 1
        if a[l] in need and have[a[l]] < need[a[l]]:
            matched -= 1
        l += 1
```

`matched` is the key trick — comparing entire counter dictionaries every step would be `O(alphabet)` per step instead of `O(1)`. Track `matched` instead and adjust it incrementally.

---

## Pattern: At-Most-K-Distinct

When the invariant is "the window contains at most `k` distinct elements", track:

- `count` — `element -> times in window`.
- `distinct` — integer, `len(count)` minus zero-count entries.

```text
count = empty
distinct = 0
l = 0
for r in 0..n-1:
    if count[a[r]] == 0: distinct += 1
    count[a[r]] += 1
    while distinct > k:
        count[a[l]] -= 1
        if count[a[l]] == 0: distinct -= 1
        l += 1
    update_longest(r - l + 1)
```

A nice trick: **"exactly k distinct" = "at most k distinct" − "at most k−1 distinct"**. Two passes of the same algorithm give you the harder problem for free.

---

## Pattern: Window with Monotonic Deque

For sliding window max/min the state is a deque of indices whose values are monotonically decreasing (for max) or increasing (for min). This is *the* canonical use of [14-monotonic-queue](../14-monotonic-queue/junior.md) — do not re-derive it here. The interface is:

- On expand (`right++`): pop from the back while `a[back] <= a[r]`, then push `r`.
- On shrink (`left++`): if `front == l - 1`, pop the front (it has expired).
- Current max = `a[deque.front()]`.

This pattern shows up in: sliding window maximum (LC 239), constrained subsequence sum (LC 1425), shortest subarray with sum ≥ K (LC 862).

---

## Code Examples

### Minimum Window Substring (LC 76)

Find the smallest substring of `s` that contains every character of `t` with multiplicity.

#### Go

```go
package slidingwindow

import "math"

// MinWindow returns the smallest substring of s that contains every character
// of t (with multiplicities). Returns "" if no such window exists.
// Time: O(n + m).  Space: O(alphabet).
func MinWindow(s, t string) string {
    if len(s) < len(t) || len(t) == 0 {
        return ""
    }

    need := make(map[byte]int)
    for i := 0; i < len(t); i++ {
        need[t[i]]++
    }

    have := make(map[byte]int)
    matched := 0       // number of distinct chars whose required count is met
    required := len(need)

    bestLen := math.MaxInt
    bestL := 0
    l := 0

    for r := 0; r < len(s); r++ {
        c := s[r]
        have[c]++
        if need[c] > 0 && have[c] == need[c] {
            matched++
        }

        for matched == required {
            if r-l+1 < bestLen {
                bestLen = r - l + 1
                bestL = l
            }
            left := s[l]
            have[left]--
            if need[left] > 0 && have[left] < need[left] {
                matched--
            }
            l++
        }
    }

    if bestLen == math.MaxInt {
        return ""
    }
    return s[bestL : bestL+bestLen]
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class MinWindow {

    public static String minWindow(String s, String t) {
        if (s.length() < t.length() || t.isEmpty()) return "";

        Map<Character, Integer> need = new HashMap<>();
        for (char c : t.toCharArray()) {
            need.merge(c, 1, Integer::sum);
        }
        Map<Character, Integer> have = new HashMap<>();
        int matched = 0;
        int required = need.size();

        int bestLen = Integer.MAX_VALUE;
        int bestL = 0;
        int l = 0;

        for (int r = 0; r < s.length(); r++) {
            char c = s.charAt(r);
            have.merge(c, 1, Integer::sum);
            if (need.containsKey(c)
                && have.get(c).intValue() == need.get(c).intValue()) {
                matched++;
            }

            while (matched == required) {
                if (r - l + 1 < bestLen) {
                    bestLen = r - l + 1;
                    bestL = l;
                }
                char left = s.charAt(l);
                have.merge(left, -1, Integer::sum);
                if (need.containsKey(left)
                    && have.get(left) < need.get(left)) {
                    matched--;
                }
                l++;
            }
        }
        return bestLen == Integer.MAX_VALUE
            ? ""
            : s.substring(bestL, bestL + bestLen);
    }
}
```

#### Python

```python
from collections import Counter


def min_window(s: str, t: str) -> str:
    """Smallest substring of s containing every char of t (with multiplicity)."""
    if len(s) < len(t) or not t:
        return ""

    need = Counter(t)
    have: Counter = Counter()
    matched = 0
    required = len(need)

    best_len = float("inf")
    best_l = 0
    l = 0

    for r, c in enumerate(s):
        have[c] += 1
        if c in need and have[c] == need[c]:
            matched += 1

        while matched == required:
            if r - l + 1 < best_len:
                best_len = r - l + 1
                best_l = l
            left = s[l]
            have[left] -= 1
            if left in need and have[left] < need[left]:
                matched -= 1
            l += 1

    return "" if best_len == float("inf") else s[best_l:best_l + best_len]
```

---

## Performance Considerations

- **Hash map cost is real.** On hot paths, a hash map's hidden constants dominate. For character problems where the alphabet is small (ASCII, 26 letters), prefer an **int array of size 128** indexed by character — this can be 3-5x faster than a hash map.
- **Avoid building substrings inside the loop.** In Java and Python, `substring` / slicing copies. Track `(bestL, bestLen)` and slice once at the end.
- **Beware boxing.** In Java, `map.get(c).intValue() == map.get(c).intValue()` is fine but `==` on two boxed `Integer` instances above `127` is silently wrong. Always unbox.
- **Java `LinkedHashMap.merge`** is allocation-heavy; for tight loops prefer a primitive int array.
- **Python `Counter` vs `dict.get(k, 0) + 1`.** `Counter` is convenient but slower than a hand-rolled dict by ~30%. In an interview, prefer `Counter` for clarity.
- **Go `map[byte]int`.** Reasonably fast; for ASCII strings, `var count [128]int` beats it.
- **Allocations on the inner loop.** Languages with garbage collectors penalize every map probe in tight inner loops — preallocate when you know the alphabet size.

---

## Best Practices

- **Name your invariant.** Write a comment above the loop: `// invariant: window [l..r] satisfies <condition>`. Then your shrink condition becomes self-documenting.
- **Update state before checking invariant.** The wrong order is the single most common bug.
- **Use `while`, not `if`, to shrink.** One shrink step rarely suffices for the variable template.
- **Distinguish "longest" and "shortest" recording placement.** Longest records *after* shrink (window is then valid). Shortest records *inside* shrink (every step is still valid).
- **Handle empty target and target longer than source explicitly.** Both should return "" or 0 fast — do not let the algorithm produce garbage.
- **Prefer indices over substrings until the end.** Performance and simplicity both improve.
- **Test edge cases.** `n=0`, `n=1`, `k=n`, all-same, all-distinct, target with duplicates.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive sliding-window demo.
>
> Middle-level viewers should focus on:
> - When `left` advances vs when `right` advances.
> - How the window-state panel changes incrementally — adds on the right, removes on the left.
> - The total pointer movement counter — confirm it never exceeds `2n`.

---

## Summary

Middle-level mastery of sliding window is about three things: knowing which **flavor** to apply (fixed vs variable, longest vs shortest), choosing the right **state** structure (integer, set, counter, monotonic deque, counter+matched), and knowing when sliding window is the **wrong** tool (negatives in sum constraints, mutations, order statistics, non-monotone invariants — fall back to prefix sums, hash maps, or balanced BSTs). The classic catalog above covers ~90% of interview problems; the patterns underneath them are just three or four templates dressed up in different stories.
