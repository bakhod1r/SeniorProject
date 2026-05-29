# Sliding Window — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Window Metaphor](#the-window-metaphor)
4. [Glossary](#glossary)
5. [Two Flavors of Sliding Window](#two-flavors-of-sliding-window)
6. [Fixed-Size Window Template](#fixed-size-window-template)
7. [Variable-Size Window Template](#variable-size-window-template)
8. [Worked Example 1 — Max Sum of k Consecutive](#worked-example-1--max-sum-of-k-consecutive)
9. [Worked Example 2 — Longest Substring Without Repeating Characters](#worked-example-2--longest-substring-without-repeating-characters)
10. [Why It Is O(n)](#why-it-is-on)
11. [Sliding Window vs Two Pointers](#sliding-window-vs-two-pointers)
12. [Window State Structures](#window-state-structures)
13. [Big-O Summary](#big-o-summary)
14. [Common Mistakes](#common-mistakes)
15. [Edge Cases](#edge-cases)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)

---

## Introduction

> Focus: "What is a sliding window?" and "How do I write one?"

The **sliding window** is a problem-solving technique — not a data structure on its own — that turns many `O(n*k)` or `O(n^2)` brute-force scans into clean `O(n)` algorithms. It works on **contiguous** segments of an array or string: a "window" defined by two indices `[left, right]` that slides across the input while you maintain some summary state (a sum, a frequency map, a max, a count).

The technique appears in every coding interview, in production rate limiters, in stream-processing engines, and in observability systems. Once you internalize the two templates below, dozens of problems collapse into the same shape.

---

## Prerequisites

- **Required:** Arrays and strings — indexing, iteration, length.
- **Required:** Basic loops (`for`, `while`) in Go, Java, or Python.
- **Required:** Hash maps / dictionaries — you will need them as "window state" structures (see [topic 05-hash-tables](../05-hash-tables/junior.md)).
- **Helpful:** Two-pointers technique — sliding window is a structured specialization of it (see [topic 10-two-pointers](../10-two-pointers/junior.md)).
- **Helpful:** Big-O notation basics — to appreciate why the technique is fast.

---

## The Window Metaphor

Imagine you are walking past a long wall covered in numbers, looking through a small rectangular window of width `k`. As you take a step to the right:

1. One new number scrolls into view on the right.
2. One old number scrolls out of view on the left.
3. The numbers in the middle stay where they were.

If you keep a running total of what is inside the window, you do **not** need to re-sum all `k` numbers. You add the new one, subtract the old one, and you are done — `O(1)` work per step. Over `n` steps, total work is `O(n)`.

That is the entire idea. The "variable" flavor below is just a window whose width changes, but the same expand/shrink discipline applies: each element enters the window at most once and leaves at most once.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Window** | A contiguous range `[left, right]` of an array or string currently under consideration. |
| **Window state** | Aggregate data about the window — sum, count, frequency map, set, max — kept up to date as the window moves. |
| **Fixed-size window** | A window whose width is always exactly `k`. Both `left` and `right` advance together by 1 each step. |
| **Variable-size window** | A window whose width grows and shrinks based on a problem invariant (e.g., "no duplicate chars"). |
| **Invariant** | A condition the window must always satisfy. When violated, you shrink from the left until it holds again. |
| **Expand** | Move `right` to the right, including a new element into the window state. |
| **Shrink / contract** | Move `left` to the right, excluding an element from the window state. |
| **Amortized O(1)** | Each step may do variable work, but the total over `n` steps is `O(n)`, so per-step is `O(1)` on average. |

---

## Two Flavors of Sliding Window

Every sliding-window problem you will meet falls into one of two shapes.

### Flavor 1 — Fixed-Size Window (width = k)

You are told a window width `k`. Both pointers move in lockstep: when `right` advances by 1, `left` also advances by 1. The width never changes after the first `k` elements have been loaded.

**Typical question shapes:**
- "Find the maximum sum of any `k` consecutive elements."
- "Find the average of every window of size `k`."
- "Find the first negative number in every window of size `k`."
- "Return the maximum element in every window of size `k`." (uses a monotonic deque — see [topic 14-monotonic-queue](../14-monotonic-queue/junior.md)).

### Flavor 2 — Variable-Size Window (grow / shrink)

The window width is whatever makes the **invariant** true. Typical invariants:
- "No character appears twice."
- "At most `k` distinct characters."
- "Sum is at most `S`."
- "All characters of target string are present."

**Typical question shapes:**
- "Longest substring with all distinct characters."
- "Smallest substring that contains every character of target T."
- "Longest subarray with sum at most `K` (positive numbers)."
- "Longest substring with at most `k` distinct characters."

The two templates below are the entire pattern. Memorize them.

---

## Fixed-Size Window Template

```text
function fixedWindow(a, k):
    initialize window state over a[0..k-1]
    record answer for window [0..k-1]

    for r in k..n-1:
        add    a[r]       to window state    # element scrolls in
        remove a[r-k]     from window state   # element scrolls out
        record answer for window [r-k+1..r]
```

Two things to notice:

1. The first `k` elements are loaded once. After that, **every iteration does the same two operations**: add one, remove one.
2. You record the answer at the **end** of each step, after the state is fully updated for the new window position.

---

## Variable-Size Window Template

```text
function variableWindow(a):
    l = 0
    initialize empty window state
    best = (whatever sentinel — 0, infinity, etc.)

    for r in 0..n-1:
        add a[r] to window state

        while invariant is violated:
            remove a[l] from window state
            l += 1

        # now [l..r] is the largest valid window ending at r
        update best using (r - l + 1) or the current state
```

Notice that `l` never moves backwards. Over the whole loop, `l` advances at most `n` times and `r` advances exactly `n` times — total `2n` pointer moves, giving the `O(n)` bound.

---

## Worked Example 1 — Max Sum of k Consecutive

**Problem.** Given an array of integers and an integer `k`, find the maximum sum of any contiguous subarray of length `k`.

**Brute force.** Try every starting index, sum `k` elements — `O(n*k)`.

**Sliding window.** Sum the first `k` elements. For each subsequent index `r`, add `a[r]`, subtract `a[r-k]`, update best — `O(n)`.

### Go

```go
package slidingwindow

import "errors"

// MaxSumK returns the maximum sum of any contiguous subarray of length k.
// Time:  O(n).
// Space: O(1).
func MaxSumK(a []int, k int) (int, error) {
    n := len(a)
    if k <= 0 || k > n {
        return 0, errors.New("invalid window size")
    }

    // Step 1: build the sum of the first window [0..k-1].
    windowSum := 0
    for i := 0; i < k; i++ {
        windowSum += a[i]
    }
    best := windowSum

    // Step 2: slide the window forward one position at a time.
    // Add the new right element, subtract the old left element.
    for r := k; r < n; r++ {
        windowSum += a[r] - a[r-k]
        if windowSum > best {
            best = windowSum
        }
    }
    return best, nil
}
```

### Java

```java
public class MaxSumK {

    /**
     * Returns the maximum sum of any contiguous subarray of length k.
     * Time:  O(n).
     * Space: O(1).
     */
    public static int maxSumK(int[] a, int k) {
        int n = a.length;
        if (k <= 0 || k > n) {
            throw new IllegalArgumentException("invalid window size");
        }

        // Step 1: sum the first window.
        int windowSum = 0;
        for (int i = 0; i < k; i++) {
            windowSum += a[i];
        }
        int best = windowSum;

        // Step 2: slide — each step is O(1).
        for (int r = k; r < n; r++) {
            windowSum += a[r] - a[r - k];
            if (windowSum > best) {
                best = windowSum;
            }
        }
        return best;
    }

    public static void main(String[] args) {
        int[] a = {2, 1, 5, 1, 3, 2};
        System.out.println(maxSumK(a, 3)); // 9 (5 + 1 + 3)
    }
}
```

### Python

```python
def max_sum_k(a: list[int], k: int) -> int:
    """
    Return the maximum sum of any contiguous subarray of length k.
    Time:  O(n).
    Space: O(1).
    """
    n = len(a)
    if k <= 0 or k > n:
        raise ValueError("invalid window size")

    # Step 1: prime the window with the first k elements.
    window_sum = sum(a[:k])
    best = window_sum

    # Step 2: slide — O(1) per step.
    for r in range(k, n):
        window_sum += a[r] - a[r - k]
        if window_sum > best:
            best = window_sum
    return best


if __name__ == "__main__":
    print(max_sum_k([2, 1, 5, 1, 3, 2], 3))  # 9
```

**Trace** on `[2, 1, 5, 1, 3, 2], k = 3`:

| step | window | sum | best |
|------|--------|-----|------|
| init | `[2, 1, 5]` | 8 | 8 |
| r=3 | `[1, 5, 1]` | 8 - 2 + 1 = 7 | 8 |
| r=4 | `[5, 1, 3]` | 7 - 1 + 3 = 9 | 9 |
| r=5 | `[1, 3, 2]` | 9 - 5 + 2 = 6 | 9 |

Answer: `9`.

---

## Worked Example 2 — Longest Substring Without Repeating Characters

**Problem.** Given a string `s`, find the length of the longest substring with all distinct characters.

**Brute force.** For every pair `(l, r)`, check if `s[l..r]` has all distinct characters — `O(n^3)` or `O(n^2)` with a set.

**Sliding window (variable).** Maintain a set or count map of characters in the window. When `s[r]` is already in the set, shrink from the left until it is gone. At every step record `r - l + 1` as a candidate answer.

### Go

```go
package slidingwindow

// LongestUnique returns the length of the longest substring of s
// in which every character appears at most once.
// Time:  O(n) — each character enters and leaves the window at most once.
// Space: O(min(n, alphabet)).
func LongestUnique(s string) int {
    count := make(map[byte]int) // character -> occurrences in current window
    best := 0
    l := 0

    for r := 0; r < len(s); r++ {
        count[s[r]]++

        // Invariant: every character in [l..r] appears exactly once.
        // If s[r] now appears twice, shrink from the left until the
        // duplicate is removed.
        for count[s[r]] > 1 {
            count[s[l]]--
            l++
        }

        if r-l+1 > best {
            best = r - l + 1
        }
    }
    return best
}
```

### Java

```java
import java.util.HashMap;
import java.util.Map;

public class LongestUnique {

    /**
     * Returns the length of the longest substring with all distinct characters.
     * Time:  O(n). Space: O(min(n, alphabet)).
     */
    public static int longestUnique(String s) {
        Map<Character, Integer> count = new HashMap<>();
        int best = 0;
        int l = 0;

        for (int r = 0; r < s.length(); r++) {
            char c = s.charAt(r);
            count.merge(c, 1, Integer::sum);

            // Shrink from the left until c appears only once in [l..r].
            while (count.get(c) > 1) {
                char left = s.charAt(l);
                count.merge(left, -1, Integer::sum);
                if (count.get(left) == 0) count.remove(left);
                l++;
            }

            best = Math.max(best, r - l + 1);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(longestUnique("abcabcbb")); // 3 ("abc")
        System.out.println(longestUnique("bbbbb"));    // 1 ("b")
        System.out.println(longestUnique("pwwkew"));   // 3 ("wke")
    }
}
```

### Python

```python
def longest_unique(s: str) -> int:
    """
    Length of the longest substring of s with all distinct characters.
    Time:  O(n). Space: O(min(n, alphabet)).
    """
    count: dict[str, int] = {}
    best = 0
    l = 0

    for r, ch in enumerate(s):
        count[ch] = count.get(ch, 0) + 1

        # Invariant: every character in s[l..r] appears at most once.
        while count[ch] > 1:
            left = s[l]
            count[left] -= 1
            if count[left] == 0:
                del count[left]
            l += 1

        if r - l + 1 > best:
            best = r - l + 1
    return best


if __name__ == "__main__":
    print(longest_unique("abcabcbb"))  # 3
    print(longest_unique("bbbbb"))     # 1
    print(longest_unique("pwwkew"))    # 3
```

**Trace** on `"pwwkew"`:

| r | char | count | shrink? | l | window | best |
|---|------|-------|---------|---|--------|------|
| 0 | p | `{p:1}` | no | 0 | `p` | 1 |
| 1 | w | `{p:1, w:1}` | no | 0 | `pw` | 2 |
| 2 | w | `{p:1, w:2}` | yes, until `w:1` | 2 | `w` | 2 |
| 3 | k | `{w:1, k:1}` | no | 2 | `wk` | 2 |
| 4 | e | `{w:1, k:1, e:1}` | no | 2 | `wke` | 3 |
| 5 | w | `{w:2, k:1, e:1}` | yes, until `w:1` | 3 | `kew` | 3 |

Answer: `3`.

---

## Why It Is O(n)

The killer property of sliding window is the **amortized** argument:

- `right` advances exactly `n` times — once per iteration of the outer loop.
- `left` advances **at most** `n` times in total — it can never go backwards, and it can never pass `right`.
- Each "add" and each "remove" on the window state takes `O(1)` (hash map insert/delete, integer add/subtract, set membership).

Total work: at most `2n` pointer moves, each doing `O(1)` state maintenance, giving `O(n)` total. Even though the inner `while` loop in the variable-size template *looks* like it could blow up, it cannot — `left` has only `n` total moves to spend across the entire run of the algorithm.

This is the **same kind of argument** used to prove dynamic arrays amortize to `O(1)` per push (see [topic 01-array](../01-array/professional.md)).

---

## Sliding Window vs Two Pointers

These two patterns are close cousins. Both use a `left` and a `right` index walking over an array. The differences:

| Aspect | Two Pointers | Sliding Window |
|--------|--------------|----------------|
| Pointers form | Endpoints of a comparison (often both ends of a sorted array) | Endpoints of a **contiguous window** |
| Movement | Often `left++` and `right--` (converging) or independent | Always `right++` then **maybe** `left++` (diverging window, then catching up) |
| State kept | Often none — just the two values | A summary of everything between the pointers (sum, freq map, max) |
| Classic problem | Pair sum in sorted array | Longest substring no repeat |

Rule of thumb: if the problem asks about a **contiguous subarray/substring** and you need to track something about the entire range, reach for sliding window. If it asks about pairs/triples or two specific positions, reach for two pointers. Topic [10-two-pointers](../10-two-pointers/junior.md) covers the converging pattern; this topic covers the expanding/contracting one.

---

## Window State Structures

The "window state" is whatever lets you answer the question in `O(1)` per step. Pick one to match the problem:

| Problem asks about... | Use as state | Why |
|------------------------|--------------|-----|
| Sum or average | Integer sum | Add/subtract in `O(1)`. |
| Distinct elements | Hash set | `add` / `remove` / `contains` in `O(1)`. |
| Frequency of each element | Hash map (counter) | Detects duplicates and "all of target present". |
| Max or min in window | Monotonic deque | See [14-monotonic-queue](../14-monotonic-queue/junior.md). |
| Multiset / bag matching | Counter + matched count | See [07-multiset-bag](../07-multiset-bag/junior.md). |

Hash maps are by far the most common — see [05-hash-tables](../05-hash-tables/junior.md) for how they hit `O(1)` average. For range-sum problems where the window size is fixed, an integer is enough; for range-sum problems on **arbitrary** ranges that change, prefer prefix sums (see [12-prefix-sums-difference-arrays](../12-prefix-sums-difference-arrays/junior.md)).

---

## Big-O Summary

| Operation | Time | Space |
|-----------|------|-------|
| Fixed-size window — full pass | O(n) | O(1) if state is sum; O(k) if state is set/map |
| Variable-size window — full pass | O(n) amortized | O(min(n, alphabet)) for character problems |
| Per-step state update | O(1) | — |
| Brute force baseline | O(n*k) or O(n^2) | O(1) |

---

## Common Mistakes

| Mistake | Why It Breaks |
|---------|---------------|
| Recording the answer **before** updating the state | The answer reflects the previous window, not the current one. |
| Forgetting to shrink while the invariant still holds | The window has a stale violating element; later answers are wrong. |
| Shrinking with `if` instead of `while` | Removing one element may not be enough to restore the invariant. |
| Mixing fixed and variable templates | E.g., trying to shrink in a fixed-size pass — width stops being `k`. |
| Using sliding window with **negative numbers** for "sum ≤ K" | The monotone shrink property breaks; use prefix sum + hash map instead. |
| Forgetting to handle `k > n` or empty input | Off-by-one or index-out-of-bounds. |
| Not removing zero-count entries from a frequency map | "Distinct count" reads the map size, which becomes wrong. |
| Adding to the count map after the duplicate check | The character is "outside the window" mentally but inside the count, breaks the invariant. |

---

## Edge Cases

- **Empty input.** Return `0` (or whatever the problem says — be explicit).
- **`k = 0`** (fixed). Usually invalid; reject or return `0`.
- **`k > n`** (fixed). Usually invalid; reject or return what makes sense (sum of all? max possible?).
- **All identical elements.** Variable-window "no repeats" must return `1`, not `n`.
- **All distinct elements.** Variable-window "no repeats" must return `n`.
- **One element.** Both templates must handle `n = 1` without skipping the init.
- **Negative numbers in sum problems.** Be very careful — many invariants assume monotonicity.

---

## Cheat Sheet

| Pattern | Init | Loop body | When to use |
|---------|------|-----------|-------------|
| Fixed sum | `s = sum(a[0..k-1])` | `s += a[r] - a[r-k]`; update best | Window width is known and constant |
| Fixed max/min | Build monotonic deque on `a[0..k-1]` | push `a[r]`, pop expired front | Window width is known and you need an extreme |
| Variable no-repeat | `count = {}`, `l = 0` | `count[a[r]]++`; `while count[a[r]] > 1: shrink` | Maximum / minimum window satisfying an invariant |
| Variable sum ≤ K (pos.) | `s = 0`, `l = 0` | `s += a[r]`; `while s > K: s -= a[l]; l++` | Monotone constraints on positive numbers |
| Variable "contains target" | freq target, matched = 0 | maintain `matched`; shrink when oversized | Minimum window substring |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive sliding-window visualizer.
>
> Choose between two demos:
> - **Fixed-size max-sum** — pick `k`, step through, watch the window scroll right.
> - **Longest substring without repeats** — watch `left` shrink whenever a duplicate enters.
>
> The animation highlights the window in blue, shows the live window state (sum or frequency map), and logs every expand/shrink step.

---

## Summary

The sliding window technique converts many `O(n*k)` and `O(n^2)` brute forces over **contiguous** array/string ranges into `O(n)` one-pass algorithms by maintaining a small piece of "window state" and updating it incrementally as the window moves. Two templates cover almost every problem: fixed-size (both pointers move together) and variable-size (right expands, left shrinks while an invariant is violated). The amortized argument — each element enters and leaves at most once — is what gives you the linear bound. Master the two templates, pick the right state structure (sum, set, frequency map, monotonic deque), and you will solve dozens of interview problems with the same code skeleton.
