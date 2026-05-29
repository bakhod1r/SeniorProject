# Monotonic Stack -- Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing the Invariant](#choosing-the-invariant)
3. [Strict vs Non-Strict Comparisons](#strict-vs-non-strict-comparisons)
4. [Direction of Scan](#direction-of-scan)
5. [Sentinels -- Why and How](#sentinels----why-and-how)
6. [Indices vs Values](#indices-vs-values)
7. [Classic Problem Catalog](#classic-problem-catalog)
8. [Code Examples](#code-examples)
9. [Comparison with Monotonic Queue](#comparison-with-monotonic-queue)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Summary](#summary)

---

## Introduction

> Focus: "Which flavor do I pick, and why?"

At junior level the monotonic stack is a template. At middle level it is a **family** of small variations -- and the engineering question is which variation to pick for the problem at hand. The four design decisions you make are:

1. Should the stack hold **increasing** or **decreasing** values?
2. Should pop be triggered by `<`, `<=`, `>`, or `>=`?
3. Do I scan **left to right** or **right to left**?
4. What do I record at the moment I pop -- an index, a width, an area, a count?

The body of this document goes through each decision in turn, then catalogs the standard problems and shows how each one is just a permutation of those four answers.

---

## Choosing the Invariant

The mantra: **the stack holds indices whose answer is still unknown.** As soon as the current element answers an old question, you pop the old index and record its result.

| What you want | Stack invariant | Reasoning |
|---------------|-----------------|-----------|
| First larger element to the right | Decreasing | A newly-arrived larger value resolves every smaller pending index below it. |
| First smaller element to the right | Increasing | A newly-arrived smaller value resolves every larger pending index below it. |
| First larger element to the left | Decreasing (scan L->R, top after push = answer for next i) | After popping all `<=` indices, the top is the previous greater. |
| First smaller element to the left | Increasing (scan L->R) | Same idea, dual. |
| Largest rectangle | Increasing | Each bar is "resolved" when a strictly shorter one arrives -- the popped bar's rectangle is bounded by the new top and the current index. |
| Subarray minimum contribution | Increasing | Each element's "I am the minimum" range is bounded by the previous and next smaller. |
| Lexicographically smallest after deletions | Either, depends on direction of pop | "Remove k digits" pops larger digits to make room for smaller ones. |

The invariant is not arbitrary -- it is forced by what you call "the answer." Reverse it and the algorithm computes the opposite question.

---

## Strict vs Non-Strict Comparisons

A common interview pitfall. Consider the array `[3, 3, 3]` and the question "next greater **or equal** element to the right."

With strict `<` in the pop condition (decreasing stack), nothing ever gets popped because no later element is strictly greater. With non-strict `<=`, the second `3` resolves the first `3`'s answer (and so on). Choose deliberately.

| Problem variant | Use this |
|-----------------|----------|
| Next strictly greater | strict pop: `a[i] > a[top]` |
| Next greater or equal | non-strict: `a[i] >= a[top]` |
| Next strictly smaller | strict: `a[i] < a[top]` |
| Next smaller or equal | non-strict: `a[i] <= a[top]` |

A subtle special case: in "sum of subarray minimums," to avoid counting the same subarray twice (when there are duplicates) we use a strict comparison on one side and non-strict on the other. That breaks ties consistently.

---

## Direction of Scan

| Direction | Resolves | When to use |
|-----------|----------|-------------|
| Left to right | "next" answers (to the right of each index) | Most problems. |
| Right to left | "previous" answers (to the left) | When you need to know each element's left boundary. |

Often you need both -- compute next-smaller in one L->R pass, then previous-smaller in one R->L pass. The two arrays together let you handle "sum of subarray minimums" or "for each element, how wide is the window where it dominates."

For the largest-rectangle-in-histogram, the single-pass increasing-stack trick fuses both boundaries into one scan, which is why that solution is so elegant.

---

## Sentinels -- Why and How

A **sentinel** is a virtual value placed at the boundary of the array to remove edge-case code. Two common sentinels:

- **Leading -infinity** (or a value smaller than any possible array value), pushed onto the stack before the scan starts. Guarantees the stack is never empty -- you can write `stack.top()` without an `isEmpty` check.
- **Trailing -infinity** (for increasing stacks) or **+infinity** (for decreasing stacks), processed after the real array. Guarantees the stack drains by the end of the loop.

For largest-rectangle-in-histogram the trailing height-0 bar is precisely a sentinel. Without it the post-loop code must replicate the inner pop logic to drain leftover bars -- duplication that is famously bug-prone in interviews.

```text
With sentinel:
    for i in 0..n:                       # one extra step
        cur = (i == n) ? 0 : h[i]
        while stack and h[top] > cur: pop and compute
        push i

Without sentinel:
    for i in 0..n-1: ...
    while stack:                          # duplicated draining logic
        top = stack.pop()
        width = stack.isEmpty() ? n : n - stack.peek() - 1
        ...
```

The sentinel halves the surface area for bugs.

---

## Indices vs Values

| Stored on stack | When to use |
|-----------------|-------------|
| **Indices** | Default. Lets you compute distances (`i - j`), widths (`right - left - 1`), and recover values via `a[index]`. |
| **Values** | Only when distances do not matter -- e.g., LeetCode 496 "next greater element I," where the result is a list of values keyed by value. Even then, indices are simpler. |
| **(index, value)** | When the array is being mutated during the scan, or when values come from a derived computation. Slight memory cost. |

The default is always indices.

---

## Classic Problem Catalog

Each row below maps to a one-line tweak of the template.

| # | Problem | Direction | Invariant | Pop trigger | Record on pop |
|---|---------|-----------|-----------|-------------|---------------|
| 1 | LeetCode 496 / 503 -- Next greater element | L->R (twice for 503) | Decreasing | `<` | value or index |
| 2 | LeetCode 503 -- Next greater (circular) | L->R, iterate 2n times | Decreasing | `<` | value |
| 3 | Next smaller / previous smaller | L->R / R->L | Increasing | `<` / `>` | index |
| 4 | LeetCode 739 -- Daily temperatures | L->R | Decreasing | `<` | `i - j` |
| 5 | LeetCode 84 -- Largest rectangle in histogram | L->R + sentinel 0 | Increasing | `>` | `h[top] * width` |
| 6 | LeetCode 85 -- Maximal rectangle (binary matrix) | Row-by-row, apply 84 | Increasing | `>` | per-row area |
| 7 | LeetCode 42 -- Trapping rain water | L->R | Decreasing | `<` | bounded water |
| 8 | Stock span problem | L->R | Decreasing | `<=` | span count |
| 9 | LeetCode 907 -- Sum of subarray minimums | Both passes | Increasing | strict + non-strict for tie-break | contribution |
| 10 | LeetCode 402 -- Remove K digits | L->R | Increasing | `>` and `k > 0` | dropped digit |
| 11 | LeetCode 316 -- Remove duplicate letters | L->R | Increasing (with set) | `>` if char still available later | drop char |
| 12 | Sliding window maximum (LC 239) | L->R | Decreasing | `<=` + window expiry | see `14-monotonic-queue` |

Items 11 and 12 are where the monotonic-stack idea generalizes into more advanced territory; item 12 is the entry point to monotonic queues, where you also pop from the **front** when the window slides past an index.

---

## Code Examples

### Previous smaller and next smaller in two passes

This builds the two boundary arrays that many problems require.

#### Go

```go
package main

import "fmt"

// PrevAndNextSmaller returns, for each index, the index of the previous
// strictly smaller element (-1 if none) and the next strictly smaller
// element (n if none).
func PrevAndNextSmaller(a []int) (prev, next []int) {
    n := len(a)
    prev = make([]int, n)
    next = make([]int, n)
    for i := range prev {
        prev[i] = -1
        next[i] = n
    }

    stack := make([]int, 0, n) // indices, values increasing bottom -> top
    for i := 0; i < n; i++ {
        for len(stack) > 0 && a[stack[len(stack)-1]] >= a[i] {
            top := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            next[top] = i
        }
        if len(stack) > 0 {
            prev[i] = stack[len(stack)-1]
        }
        stack = append(stack, i)
    }
    return prev, next
}

func main() {
    a := []int{3, 1, 4, 1, 5, 9, 2, 6}
    p, n := PrevAndNextSmaller(a)
    fmt.Println(p) // [-1 -1 1 1 3 4 3 6]
    fmt.Println(n) // [1 8 3 6 6 6 8 8]
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;

public class PrevNextSmaller {

    /**
     * One-pass computation of previous and next strictly smaller indices.
     * prev[i] = j with j < i and a[j] < a[i] (largest such j) -- or -1
     * next[i] = j with j > i and a[j] < a[i] (smallest such j) -- or n
     */
    public static int[][] prevAndNextSmaller(int[] a) {
        int n = a.length;
        int[] prev = new int[n];
        int[] next = new int[n];
        Arrays.fill(prev, -1);
        Arrays.fill(next, n);

        Deque<Integer> stack = new ArrayDeque<>(); // indices, increasing values
        for (int i = 0; i < n; i++) {
            while (!stack.isEmpty() && a[stack.peek()] >= a[i]) {
                next[stack.pop()] = i;
            }
            if (!stack.isEmpty()) prev[i] = stack.peek();
            stack.push(i);
        }
        return new int[][]{prev, next};
    }

    public static void main(String[] args) {
        int[] a = {3, 1, 4, 1, 5, 9, 2, 6};
        int[][] r = prevAndNextSmaller(a);
        System.out.println(Arrays.toString(r[0]));
        System.out.println(Arrays.toString(r[1]));
    }
}
```

#### Python

```python
"""Previous and next strictly smaller indices in one pass."""

from typing import List, Tuple


def prev_and_next_smaller(a: List[int]) -> Tuple[List[int], List[int]]:
    """
    Returns (prev, next) where prev[i] is the index of the previous strictly
    smaller element (-1 if none) and next[i] is the next strictly smaller
    (n if none). Uses an increasing monotonic stack.
    Time: O(n). Space: O(n).
    """
    n = len(a)
    prev = [-1] * n
    nxt = [n] * n
    stack: list[int] = []

    for i in range(n):
        while stack and a[stack[-1]] >= a[i]:
            nxt[stack.pop()] = i
        if stack:
            prev[i] = stack[-1]
        stack.append(i)

    return prev, nxt


if __name__ == "__main__":
    a = [3, 1, 4, 1, 5, 9, 2, 6]
    p, n = prev_and_next_smaller(a)
    print(p)  # [-1, -1, 1, 1, 3, 4, 3, 6]
    print(n)  # [1, 8, 3, 6, 6, 6, 8, 8]
```

### Sum of subarray minimums (LeetCode 907)

Given an array, sum over all contiguous subarrays of the minimum of the subarray. We compute each element's contribution: `a[i] * count_of_subarrays_where_a[i]_is_min`. The count is `(i - prev_smaller) * (next_smaller - i)`. To avoid double-counting on ties, one side uses strict, the other non-strict.

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

// SumSubarrayMins computes sum over all contiguous subarrays of the minimum.
// Time: O(n). Space: O(n).
func SumSubarrayMins(a []int) int {
    n := len(a)
    // For each i, contribution = a[i] * (i - prev) * (next - i)
    // Use strict-less-than for previous, non-strict for next to break ties.
    prev := make([]int, n)
    next := make([]int, n)
    for i := range prev {
        prev[i] = -1
        next[i] = n
    }

    stack := make([]int, 0, n)
    for i := 0; i < n; i++ {
        for len(stack) > 0 && a[stack[len(stack)-1]] > a[i] {
            next[stack[len(stack)-1]] = i
            stack = stack[:len(stack)-1]
        }
        if len(stack) > 0 {
            prev[i] = stack[len(stack)-1]
        }
        stack = append(stack, i)
    }

    total := 0
    for i := 0; i < n; i++ {
        left := i - prev[i]
        right := next[i] - i
        total = (total + a[i]*left*right) % MOD
    }
    return total
}

func main() {
    fmt.Println(SumSubarrayMins([]int{3, 1, 2, 4})) // 17
}
```

#### Java

```java
public class SumSubarrayMins {

    private static final int MOD = 1_000_000_007;

    public static int sum(int[] a) {
        int n = a.length;
        int[] prev = new int[n];
        int[] next = new int[n];
        java.util.Arrays.fill(prev, -1);
        java.util.Arrays.fill(next, n);

        java.util.Deque<Integer> stack = new java.util.ArrayDeque<>();
        for (int i = 0; i < n; i++) {
            while (!stack.isEmpty() && a[stack.peek()] > a[i]) {
                next[stack.pop()] = i;
            }
            if (!stack.isEmpty()) prev[i] = stack.peek();
            stack.push(i);
        }

        long total = 0;
        for (int i = 0; i < n; i++) {
            long left = i - prev[i];
            long right = next[i] - i;
            total = (total + (long) a[i] * left % MOD * right) % MOD;
        }
        return (int) total;
    }

    public static void main(String[] args) {
        System.out.println(sum(new int[]{3, 1, 2, 4})); // 17
    }
}
```

#### Python

```python
"""Sum of subarray minimums -- LeetCode 907."""

from typing import List

MOD = 10**9 + 7


def sum_subarray_mins(a: List[int]) -> int:
    """
    Sum, over all contiguous subarrays, of the minimum of the subarray.
    Strict '>' for previous-smaller, non-strict implied by symmetry for next.
    Time: O(n). Space: O(n).
    """
    n = len(a)
    prev = [-1] * n
    nxt = [n] * n
    stack: list[int] = []

    for i in range(n):
        while stack and a[stack[-1]] > a[i]:
            nxt[stack.pop()] = i
        if stack:
            prev[i] = stack[-1]
        stack.append(i)

    total = 0
    for i in range(n):
        left = i - prev[i]
        right = nxt[i] - i
        total = (total + a[i] * left * right) % MOD
    return total


if __name__ == "__main__":
    print(sum_subarray_mins([3, 1, 2, 4]))  # 17
```

---

## Comparison with Monotonic Queue

The next topic (14-monotonic-queue) extends this idea to a deque. The crucial difference:

| Property | Monotonic stack | Monotonic queue (deque) |
|----------|-----------------|--------------------------|
| Ends used | Push and pop **back only** | Push back, pop **front and back** |
| Pops from back | To preserve invariant during push | Same |
| Pops from front | Never | When the front index falls out of the active window |
| Typical problem | "Next/previous greater/smaller" -- one-shot per index | Sliding window maximum/minimum -- index expires |
| One-pass linear time? | Yes | Yes |

A monotonic stack assumes that once an index is "settled," it is never relevant again. A monotonic queue handles the case where settled indices can still be the window's maximum -- until they fall out of the window. If you find yourself wanting to also remove from the bottom, you've grown out of a stack and need a deque.

The sliding-window-maximum algorithm itself lives in 14-monotonic-queue.

---

## Performance Analysis

The amortized analysis is identical to junior level: each index is pushed once and popped at most once, so total stack work is O(n). But two production wrinkles matter at middle level.

**Allocation strategy.** Pre-size the stack to `n` to avoid repeated growth. In Go: `make([]int, 0, n)`. In Java: `new ArrayDeque<>(n)`. In Python the list grows in amortized O(1) anyway.

**Recursion vs explicit stack.** Some monotonic-stack-shaped problems (Cartesian-tree construction, for instance) are tempting to write recursively. On adversarial inputs (sorted arrays, n ~ 10^6) recursion depth blows the call stack. Explicit stacks survive any size.

```text
For all monotonic-stack problems:
    T(n) = O(n)    -- amortized, by aggregate method
    S(n) = O(n)    -- at most n indices on the stack at once
```

---

## Best Practices

- **Always store indices**, not values. The cost is zero; the gain is positional information.
- **Always use a sentinel** when the post-loop draining adds non-trivial code -- it usually halves the bug surface.
- **Pre-size the stack** to the input length in Go and Java; in Python the list grows fine on its own.
- **Decide tie-breaking** (strict vs non-strict) by writing the small input by hand. Don't guess.
- **Name your variant.** When reviewing code, write a one-line comment: `// monotonic increasing stack of indices, drained at end via height-0 sentinel`. The comment is the bug shield.
- **Test the four canonical edge cases**: empty array, single element, all equal, strictly sorted. Together they catch ~90% of monotonic-stack bugs.

---

## Pattern Recognition Heuristics

Reading a problem statement and recognizing "monotonic stack" is a skill in itself. The most reliable triggers:

- "For each index, find the nearest [larger / smaller] element."
- "How long can a value remain [the maximum / the minimum] in a moving region?"
- "Compute the largest rectangle / area / window where some monotone property holds."
- "Remove K elements to obtain the lexicographically smallest / largest sequence."
- "Sum of [minimums / maximums] over all subarrays."

When you see two or more of those phrases together, the monotonic-stack template almost certainly applies. The remaining question is which axis assignments (invariant, strictness, direction, payload) to use.

A useful sanity check: write the naive O(n^2) loop first. If the inner loop can be characterized as "advance while values violate property P," the monotonic-stack reduction applies. The structural pattern is "each element is *finalized* by the first later element that breaks the invariant" -- if you cannot phrase the problem that way, the technique probably does not fit.

---

## When the Monotonic Stack Is Not Enough

The technique solves "one-shot per index" problems beautifully but stops working when:

- **Indices can become irrelevant before being popped** (sliding-window expiration) -- use a monotonic deque (topic 14).
- **Updates intermix with queries** (mutate the array, then ask "nearest greater") -- use a segment tree or balanced BST.
- **Many overlapping range queries** rather than per-index queries -- preprocess with sparse-table RMQ or Cartesian tree + LCA (see senior.md, professional.md).
- **The answer depends on a non-monotone aggregate** (e.g., median) -- the stack's invariant cannot encode the question.
- **Streaming with answers required within latency** even when no resolution is found -- the stack will hold pending indices forever; introduce a timeout.

Recognizing these limits avoids the trap of forcing the pattern onto a problem where it gives the wrong shape. The next chapter (14) handles the most common extension -- popping from the front -- explicitly.

---

## Summary

The monotonic stack at middle level is a deliberate choice across four axes: invariant, strictness, direction, and payload. Once you have read the problem and answered those four questions, the code writes itself.

Memorize the catalog. Most "hard" array problems involving "for each element, the first one to its left/right satisfying P" reduce to picking one row from the table.

If your problem also involves index expiration (sliding windows), step up to monotonic queues -- the conceptual pattern is the same but you also pop from the front.
</content>
</invoke>