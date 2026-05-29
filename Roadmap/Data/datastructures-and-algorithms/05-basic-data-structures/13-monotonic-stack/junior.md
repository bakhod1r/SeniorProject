# Monotonic Stack -- Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [What "Monotonic" Means Here](#what-monotonic-means-here)
4. [The Two Flavors: Increasing vs Decreasing](#the-two-flavors-increasing-vs-decreasing)
5. [The Core Template -- Next Greater Element](#the-core-template----next-greater-element)
6. [Walking Through an Example](#walking-through-an-example)
7. [Why It Is O(n) Amortized](#why-it-is-on-amortized)
8. [Example 1 -- Next Greater Element](#example-1----next-greater-element)
9. [Example 2 -- Daily Temperatures](#example-2----daily-temperatures)
10. [Example 3 -- Largest Rectangle in Histogram](#example-3----largest-rectangle-in-histogram)
11. [Common Mistakes](#common-mistakes)
12. [Cheat Sheet](#cheat-sheet)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

A **monotonic stack** is a regular stack with one extra rule: every time you push a new element, you first pop everything on top that breaks the order. The result is a stack whose contents -- read from bottom to top -- are either strictly increasing or strictly decreasing.

That single rule is surprisingly powerful. It is the textbook answer to a whole family of problems:

- "For each item, what is the next larger item to its right?"
- "How many days until a warmer day?"
- "What is the largest rectangle that fits inside a histogram?"
- "For each element in an array, in how many subarrays is it the minimum?"

Without a monotonic stack these problems often look quadratic -- nested loops scanning forward or backward. The monotonic-stack trick collapses them into a single linear pass.

This page teaches the pattern from zero. We assume you already know what a plain stack is (see `04-stacks` for the basics) -- here we focus only on the **monotone invariant** and how to wield it.

---

## Prerequisites

- **Required:** Plain stack operations -- `push`, `pop`, `peek`, `isEmpty` (see `04-stacks`).
- **Required:** Array indexing and basic loops in Go / Java / Python.
- **Helpful:** Amortized analysis intuition ("each element is touched a constant number of times").
- **Helpful:** Familiarity with the "next greater element" problem statement.

---

## What "Monotonic" Means Here

A sequence is **monotonic** if it never changes direction. We say it is **monotonically increasing** if every next value is greater than the previous, and **monotonically decreasing** if every next value is smaller. When equality is allowed we usually say "non-strictly" -- but the version used in algorithms is most often **strict**.

A monotonic stack is a stack whose contents satisfy this property at all times. After each operation the invariant holds:

```text
Monotonically increasing stack (bottom -> top):
    bottom [ 1, 3, 5, 7 ] top      <-- valid: 1 < 3 < 5 < 7
    bottom [ 1, 3, 2, 7 ] top      <-- INVALID: 3 > 2

Monotonically decreasing stack (bottom -> top):
    bottom [ 9, 6, 4, 2 ] top      <-- valid: 9 > 6 > 4 > 2
```

The invariant is maintained by **popping** before each push. When we want to push value `x` onto an increasing stack and the current top is greater than or equal to `x`, we keep popping until the top is smaller -- then we push.

> Important: we usually store **indices**, not values. Indices give us both the position (so we can compute widths and distances) and -- via the original array -- the values themselves.

---

## The Two Flavors: Increasing vs Decreasing

The choice between increasing and decreasing is dictated by **what you want to find**.

| Goal | Stack invariant | Pop trigger |
|------|-----------------|-------------|
| Next greater element to the right | Decreasing | `a[i] > a[stack.top()]` -> pop |
| Next smaller element to the right | Increasing | `a[i] < a[stack.top()]` -> pop |
| Previous greater element to the left | Decreasing (scan L->R, keep top after pops) | `a[i] >= a[stack.top()]` -> pop |
| Previous smaller element to the left | Increasing (scan L->R) | `a[i] <= a[stack.top()]` -> pop |

The rule of thumb: **the stack always holds indices whose answer is still pending**. When the current element resolves one of those pending answers, we pop it.

### Strict vs non-strict

Whether you use `<` or `<=` matters. For "next strictly greater," use strict `>`. For "next greater **or equal**," use `>=` -- this changes behavior on duplicate values. Many off-by-one bugs in interviews come from picking the wrong one. When in doubt, write the answer for a tiny array with duplicates and trace it manually.

---

## The Core Template -- Next Greater Element

For an input array `a` of length `n`, we want `nextGreater[i]` -- the index of the first element to the right of `i` whose value is strictly larger than `a[i]`. If none exists, set it to `-1`.

```text
Initialize: stack S = [], nextGreater = [-1] * n

for i in 0..n-1:
    while S not empty AND a[S.top()] < a[i]:
        j = S.pop()
        nextGreater[j] = i
    S.push(i)

# any indices left on S have no greater element to their right
# (they already hold -1 from initialization)
```

This is the template. **Memorize it.** Almost every monotonic-stack problem is a small mutation of these eight lines:

1. Decide which direction to scan (left->right for "next", right->left for "previous").
2. Decide the pop condition (`<`, `<=`, `>`, or `>=`).
3. Decide what to record when an index is popped (just the index? the width? the area?).

Everything else follows.

---

## Walking Through an Example

Let `a = [3, 1, 4, 1, 5, 9, 2, 6]` and let's compute the next greater element for each index. We scan left to right with a **decreasing** stack (storing indices). Bracket notation shows the values for clarity.

```text
i=0  a[0]=3   S empty                 -> push 0      S=[0]   (vals=[3])
i=1  a[1]=1   a[top]=3 > 1, no pop    -> push 1      S=[0,1] (vals=[3,1])
i=2  a[2]=4   a[1]=1 < 4 -> pop 1, nextGreater[1]=2
              a[0]=3 < 4 -> pop 0, nextGreater[0]=2
              push 2                                 S=[2]   (vals=[4])
i=3  a[3]=1   a[top]=4 > 1, no pop    -> push 3      S=[2,3] (vals=[4,1])
i=4  a[4]=5   a[3]=1 < 5 -> pop 3, nextGreater[3]=4
              a[2]=4 < 5 -> pop 2, nextGreater[2]=4
              push 4                                 S=[4]   (vals=[5])
i=5  a[5]=9   a[4]=5 < 9 -> pop 4, nextGreater[4]=5
              push 5                                 S=[5]   (vals=[9])
i=6  a[6]=2   a[top]=9 > 2, no pop    -> push 6      S=[5,6] (vals=[9,2])
i=7  a[7]=6   a[6]=2 < 6 -> pop 6, nextGreater[6]=7
              a[top]=9 > 6, stop      -> push 7      S=[5,7] (vals=[9,6])

After scan: indices 5 and 7 remain on the stack -> nextGreater stays -1 for them.

Result: nextGreater = [2, 2, 4, 4, 5, -1, 7, -1]
```

Notice three things:
1. We always pop **before** pushing, so the invariant (decreasing values from bottom to top) is maintained.
2. The moment an index `j` is popped, its answer is fixed forever -- we never revisit it.
3. Indices left on the stack at the end are those with no greater element to their right.

---

## Why It Is O(n) Amortized

The inner `while` loop looks suspicious: could it run O(n) times for each `i`, giving O(n^2) total? No. Here is the argument every interviewer wants to hear.

**Claim:** the loop performs at most `2n` stack operations across the entire scan.

**Proof sketch:** every index `i` is pushed exactly once and popped at most once. So the total number of push operations is `n`, and the total number of pop operations is at most `n`. Together: at most `2n` operations. The amortized cost per index is therefore O(1), and the total work is O(n).

This is the **aggregate method** of amortized analysis. We do not bound the worst case of a single iteration; we bound the total cost across all iterations and divide.

The same argument works for every monotonic-stack problem in this document.

---

## Example 1 -- Next Greater Element

Given `nums = [2, 1, 2, 4, 3]`, return the next greater element to the right for each position (`-1` if none).

### Go

```go
package main

import "fmt"

// NextGreater returns the next strictly greater element to the right for
// each index. If none exists, the entry is -1.
// Time: O(n). Space: O(n) for the result + stack.
func NextGreater(nums []int) []int {
    n := len(nums)
    result := make([]int, n)
    for i := range result {
        result[i] = -1
    }
    stack := make([]int, 0, n) // stack of indices, values monotonically decreasing

    for i := 0; i < n; i++ {
        // Pop every index whose answer is now resolved.
        for len(stack) > 0 && nums[stack[len(stack)-1]] < nums[i] {
            top := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            result[top] = nums[i]
        }
        stack = append(stack, i)
    }
    return result
}

func main() {
    nums := []int{2, 1, 2, 4, 3}
    fmt.Println(NextGreater(nums)) // [4 2 4 -1 -1]
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;

public class NextGreaterElement {

    /**
     * For each index, return the next strictly greater value to the right
     * (-1 if none). Runs in O(n) time and O(n) extra space.
     */
    public static int[] nextGreater(int[] nums) {
        int n = nums.length;
        int[] result = new int[n];
        Arrays.fill(result, -1);
        Deque<Integer> stack = new ArrayDeque<>(); // holds indices, values decreasing

        for (int i = 0; i < n; i++) {
            while (!stack.isEmpty() && nums[stack.peek()] < nums[i]) {
                int top = stack.pop();
                result[top] = nums[i];
            }
            stack.push(i);
        }
        return result;
    }

    public static void main(String[] args) {
        int[] nums = {2, 1, 2, 4, 3};
        System.out.println(Arrays.toString(nextGreater(nums))); // [4, 2, 4, -1, -1]
    }
}
```

### Python

```python
"""Next greater element using a monotonic decreasing stack."""

from typing import List


def next_greater(nums: List[int]) -> List[int]:
    """
    For each index, return the next strictly greater value to the right.
    Returns -1 for indices with no such element.
    Time: O(n). Space: O(n).
    """
    n = len(nums)
    result = [-1] * n
    stack: list[int] = []  # indices; values stored monotonically decreasing

    for i in range(n):
        while stack and nums[stack[-1]] < nums[i]:
            top = stack.pop()
            result[top] = nums[i]
        stack.append(i)

    return result


if __name__ == "__main__":
    print(next_greater([2, 1, 2, 4, 3]))  # [4, 2, 4, -1, -1]
```

**What it does:** scans left to right, maintains a decreasing stack of indices, and resolves an index's answer the moment a larger element is seen.

---

## Example 2 -- Daily Temperatures

Given a list of daily temperatures, for each day return the number of days you must wait until a **warmer** temperature. If no warmer day exists, return 0 for that day.

Input: `[73, 74, 75, 71, 69, 72, 76, 73]`
Output: `[1, 1, 4, 2, 1, 1, 0, 0]`

The trick is identical -- "next greater element" -- but instead of recording the value, we record the index distance.

### Go

```go
package main

import "fmt"

// DailyTemperatures returns, for each day, the number of days until a warmer one.
// 0 means no warmer day exists.
// Time: O(n). Space: O(n).
func DailyTemperatures(temps []int) []int {
    n := len(temps)
    answer := make([]int, n)            // zero-initialized by Go
    stack := make([]int, 0, n)          // indices, decreasing temperatures

    for i := 0; i < n; i++ {
        for len(stack) > 0 && temps[stack[len(stack)-1]] < temps[i] {
            j := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            answer[j] = i - j           // days waited
        }
        stack = append(stack, i)
    }
    return answer
}

func main() {
    temps := []int{73, 74, 75, 71, 69, 72, 76, 73}
    fmt.Println(DailyTemperatures(temps)) // [1 1 4 2 1 1 0 0]
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;

public class DailyTemperatures {

    /**
     * Days to wait until a warmer temperature. 0 if no warmer day exists.
     * Single left-to-right pass with a decreasing monotonic stack of indices.
     */
    public static int[] dailyTemperatures(int[] temps) {
        int n = temps.length;
        int[] answer = new int[n];                  // zero-initialized
        Deque<Integer> stack = new ArrayDeque<>();

        for (int i = 0; i < n; i++) {
            while (!stack.isEmpty() && temps[stack.peek()] < temps[i]) {
                int j = stack.pop();
                answer[j] = i - j;                  // record the distance
            }
            stack.push(i);
        }
        return answer;
    }

    public static void main(String[] args) {
        int[] temps = {73, 74, 75, 71, 69, 72, 76, 73};
        System.out.println(Arrays.toString(dailyTemperatures(temps)));
        // [1, 1, 4, 2, 1, 1, 0, 0]
    }
}
```

### Python

```python
"""Daily temperatures -- classic monotonic-stack problem."""

from typing import List


def daily_temperatures(temps: List[int]) -> List[int]:
    """
    For each day, count the days until a strictly warmer day.
    Returns 0 for days with no warmer day after them.
    Time: O(n). Space: O(n).
    """
    n = len(temps)
    answer = [0] * n
    stack: list[int] = []  # indices, temperatures decreasing bottom -> top

    for i, t in enumerate(temps):
        while stack and temps[stack[-1]] < t:
            j = stack.pop()
            answer[j] = i - j
        stack.append(i)

    return answer


if __name__ == "__main__":
    print(daily_temperatures([73, 74, 75, 71, 69, 72, 76, 73]))
    # [1, 1, 4, 2, 1, 1, 0, 0]
```

The variation from Example 1 is one line: instead of `result[top] = nums[i]`, we write `answer[j] = i - j`. Same template, different payload.

---

## Example 3 -- Largest Rectangle in Histogram

This is the **archetype** monotonic-stack problem -- the one you should be ready to write under interview pressure.

**Problem.** Given non-negative bar heights `h[0..n-1]`, find the area of the largest axis-aligned rectangle that fits entirely inside the histogram.

**Idea.** For each bar `h[k]`, the largest rectangle that uses `h[k]` as its shortest bar extends:
- leftward until the first bar **strictly shorter** than `h[k]`,
- rightward until the first bar **strictly shorter** than `h[k]`.

If we knew those two boundaries for every bar, the answer would be `max over k of h[k] * (right[k] - left[k] - 1)`. Computing both boundaries is exactly the "previous smaller" and "next smaller" problems -- two monotonic-stack scans.

The clever single-pass version maintains an **increasing** stack. When we encounter a bar shorter than the top, we know we've just discovered the "next smaller" for that top, and the new top of the stack (after popping) is the "previous smaller." That gives us width directly.

```text
width = i - stack.peek() - 1     after popping the rectangle's pivot
area  = h[popped] * width
```

We add a sentinel by allowing `i = n` with implicit height 0, so the stack drains naturally at the end.

### Go

```go
package main

import "fmt"

// LargestRectangle returns the maximum area of a rectangle entirely inside
// the histogram defined by heights.
// Time: O(n). Space: O(n).
func LargestRectangle(heights []int) int {
    n := len(heights)
    stack := make([]int, 0, n+1) // indices; heights strictly increasing
    best := 0

    for i := 0; i <= n; i++ {
        // Treat the bar past the end as height 0 -- this drains the stack.
        cur := 0
        if i < n {
            cur = heights[i]
        }

        for len(stack) > 0 && heights[stack[len(stack)-1]] > cur {
            top := stack[len(stack)-1]
            stack = stack[:len(stack)-1]

            // Width = i - newTop - 1; if stack empty, width = i.
            width := i
            if len(stack) > 0 {
                width = i - stack[len(stack)-1] - 1
            }
            area := heights[top] * width
            if area > best {
                best = area
            }
        }
        stack = append(stack, i)
    }
    return best
}

func main() {
    h := []int{2, 1, 5, 6, 2, 3}
    fmt.Println(LargestRectangle(h)) // 10  (bars index 2 and 3: min height 5, width 2)
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class LargestRectangleHistogram {

    /**
     * Largest rectangle inside a histogram using a monotonic increasing stack.
     * Adds a virtual zero-height bar at the end to drain the stack.
     * Time: O(n). Space: O(n).
     */
    public static int largestRectangleArea(int[] heights) {
        int n = heights.length;
        Deque<Integer> stack = new ArrayDeque<>(); // indices; heights increasing
        int best = 0;

        for (int i = 0; i <= n; i++) {
            int cur = (i == n) ? 0 : heights[i];

            while (!stack.isEmpty() && heights[stack.peek()] > cur) {
                int top = stack.pop();
                int width = stack.isEmpty() ? i : i - stack.peek() - 1;
                int area = heights[top] * width;
                if (area > best) best = area;
            }
            stack.push(i);
        }
        return best;
    }

    public static void main(String[] args) {
        int[] h = {2, 1, 5, 6, 2, 3};
        System.out.println(largestRectangleArea(h)); // 10
    }
}
```

### Python

```python
"""Largest rectangle in a histogram -- monotonic-stack archetype."""

from typing import List


def largest_rectangle(heights: List[int]) -> int:
    """
    Find the area of the largest axis-aligned rectangle inside the histogram.
    Maintains an increasing stack of indices; a virtual bar of height 0 past
    the end drains the stack at the end.
    Time: O(n). Space: O(n).
    """
    n = len(heights)
    stack: list[int] = []
    best = 0

    for i in range(n + 1):
        cur = 0 if i == n else heights[i]
        while stack and heights[stack[-1]] > cur:
            top = stack.pop()
            width = i if not stack else i - stack[-1] - 1
            area = heights[top] * width
            if area > best:
                best = area
        stack.append(i)

    return best


if __name__ == "__main__":
    print(largest_rectangle([2, 1, 5, 6, 2, 3]))  # 10
```

**Trace on `[2, 1, 5, 6, 2, 3]`:**

```text
i=0 cur=2   stack=[]  -> push 0           stack=[0]      (heights [2])
i=1 cur=1   h[0]=2 > 1 -> pop 0, width=1, area=2*1=2; best=2
            push 1                          stack=[1]      (heights [1])
i=2 cur=5   h[1]=1 < 5 -> push 2            stack=[1,2]    (heights [1,5])
i=3 cur=6   h[2]=5 < 6 -> push 3            stack=[1,2,3]  (heights [1,5,6])
i=4 cur=2   h[3]=6 > 2 -> pop 3, width=4-2-1=1, area=6*1=6;   best=6
            h[2]=5 > 2 -> pop 2, width=4-1-1=2, area=5*2=10;  best=10
            push 4                          stack=[1,4]    (heights [1,2])
i=5 cur=3   h[4]=2 < 3 -> push 5            stack=[1,4,5]  (heights [1,2,3])
i=6 cur=0   h[5]=3 > 0 -> pop 5, width=6-4-1=1, area=3*1=3
            h[4]=2 > 0 -> pop 4, width=6-1-1=4, area=2*4=8
            h[1]=1 > 0 -> pop 1, width=6,    area=1*6=6
            push 6                          stack=[6]

Answer = 10.
```

---

## Common Mistakes

| Mistake | Why it breaks |
|---------|---------------|
| Storing **values** instead of indices | You lose the position information needed to compute distances and widths. |
| Wrong comparison operator (`<` vs `<=`) | Subtly changes behavior on duplicates -- breaks "next greater **or equal**" variants. |
| Forgetting to drain the stack after the scan | Indices remaining on the stack still need their answer recorded (often `-1` or sentinel area). |
| Scanning in the wrong direction | Left-to-right gives "next" answers; right-to-left gives "previous". Pick deliberately. |
| No sentinel for histogram problems | Without a virtual zero-bar at the end you must add an explicit draining loop -- easy to forget. |
| Using a recursion-based stack on huge inputs | A heap-allocated explicit stack avoids JVM/Go-runtime stack overflow on million-element arrays. |
| Treating the inner `while` as O(n) per iteration | It is O(n) amortized across the whole scan, not per index. |

---

## Cheat Sheet

| Pattern | Stack flavor | Pop trigger | Records on pop |
|---------|--------------|-------------|----------------|
| Next greater (right) | Decreasing | `a[i] > a[top]` | index `i` or `a[i]` |
| Next smaller (right) | Increasing | `a[i] < a[top]` | index `i` or `a[i]` |
| Previous greater (left) | Decreasing, scan L->R | `a[i] >= a[top]` | new top = answer |
| Previous smaller (left) | Increasing, scan L->R | `a[i] <= a[top]` | new top = answer |
| Daily temperatures | Decreasing | `t[i] > t[top]` | `i - top` |
| Largest rectangle | Increasing + sentinel 0 | `h[top] > h[i]` | width and area |

All variants share the same eight-line skeleton.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation renders the array as bars, shows the monotonic stack to the side as a vertical column, and steps through the algorithm:
> - **Pushes** flash green, **pops** flash red.
> - The current scan index is highlighted yellow.
> - In "histogram mode" the largest rectangle found so far is drawn on the bars.
> - Stats (steps, pushes, pops, current best) update live.

---

## Summary

A monotonic stack is a single rule: **after every push, the stack must be increasing or decreasing -- enforce it by popping first**. That tiny constraint solves the entire "next/previous greater/smaller" family of problems in O(n) time, including the famous largest-rectangle-in-histogram.

The whole pattern is captured in the **eight-line template**: scan, pop while the invariant would break, record an answer on each pop, push the current index. Memorize it. The trick to applying it is picking the right direction, the right strictness, and the right thing to record on each pop -- everything else is mechanical.

The next topic, **monotonic queue** (14), extends the same idea to a deque, which lets us also remove from the front -- exactly what is needed for sliding-window-maximum problems.

---

## Further Reading

- LeetCode 496, 503, 739, 84, 85, 907 -- the canonical monotonic-stack problems.
- *Introduction to Algorithms* (CLRS) -- amortized analysis (aggregate method).
- `04-stacks` for the stack basics this topic builds upon.
- `14-monotonic-queue` for the deque-extension of this pattern.

---

## Self-Check Quiz

Answer each before moving to the middle-level material. The answers should be reflexive after you finish this page.

1. What is the invariant of a "decreasing monotonic stack" -- and what does it imply when a new element arrives?
2. Why do we push **indices** instead of **values**?
3. If the array is strictly increasing, how big does the stack grow during a next-greater scan? What does that mean for the final answer array?
4. In the largest-rectangle algorithm, why is the sentinel "virtual height 0 past the end" useful?
5. Given the inner while loop can run O(n) times in a single iteration of the outer loop, why is the total runtime still O(n)?
6. Suppose two equal values are adjacent. What does strict pop do? What does non-strict pop do? Which one matches "next greater **or equal**" semantics?
7. For "daily temperatures," what value do you record on each pop, and why is that not the temperature itself?
8. If you scan an array right-to-left instead of left-to-right with the same stack and pop rules, which question does the algorithm answer?

If you struggled on any answer, re-read the corresponding section before continuing to `middle.md`.
</content>
</invoke>