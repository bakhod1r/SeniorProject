# Monotonic Stack -- Interview Preparation

## Junior Questions (1-15)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a monotonic stack? | Stack with values strictly increasing or decreasing from bottom to top. |
| 2 | What does "next greater element" mean? | First element to the right strictly larger than the current. |
| 3 | Why store indices, not values? | Preserves position -- needed for widths, distances, recovering the original value. |
| 4 | What is the time complexity of the standard monotonic-stack scan? | O(n) amortized. |
| 5 | Why is it O(n) when there is a nested while loop? | Each index is pushed once and popped at most once -- total ops <= 2n. |
| 6 | Increasing vs decreasing -- when do you pick each? | Decreasing for "next greater"; increasing for "next smaller." |
| 7 | What is the "next greater element" code template? | The eight-line scan from junior.md. |
| 8 | Difference between strict (`<`) and non-strict (`<=`) pop conditions? | Strict ignores ties; non-strict treats equal elements as resolving each other. |
| 9 | How do you handle indices left on the stack after the loop? | They have no answer; assign -1 or the sentinel value. |
| 10 | Daily temperatures problem -- what does the stack store? | Indices of days whose warmer-day count is still pending. |
| 11 | How do you compute "previous greater element" instead of "next"? | Same template, scan right-to-left, or read the new top of the stack after popping in a left-to-right scan. |
| 12 | Why use a sentinel for largest-rectangle-in-histogram? | A virtual height-0 bar at the end drains the stack, avoiding duplicated post-loop logic. |
| 13 | What is the space complexity of the monotonic-stack scan? | O(n) -- at most n indices on the stack. |
| 14 | Can you use a monotonic stack to find the maximum element of an array? | Yes, but it is wasteful -- a single linear scan with a max variable is simpler. Use it when each element needs an answer. |
| 15 | What goes wrong if you store values instead of indices? | You lose positional info; cannot compute widths or wait-counts. |

---

## Middle Questions (16-30)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 16 | Explain the largest-rectangle-in-histogram algorithm in one minute. | Increasing stack; pop when current bar shorter; width = i - newTop - 1; track max area; sentinel 0 at end. |
| 17 | How would you solve LeetCode 85 (maximal rectangle in binary matrix)? | Per row, compute heights; apply LRH to each row; track global max. |
| 18 | Walk through LeetCode 907 (sum of subarray minimums). | Compute previous-smaller and next-smaller for each i; contribution = a[i] * left * right; sum mod 1e9+7. Use strict on one side, non-strict on the other to break ties. |
| 19 | When does the monotonic-stack technique NOT apply? | When you need pop from both ends (sliding window) -- use a monotonic deque (topic 14). |
| 20 | Explain LeetCode 503 (next greater element II, circular). | Concatenate the array with itself logically (iterate 2n times), use modulo for indexing. |
| 21 | Solve LeetCode 42 (trapping rain water) with a monotonic stack. | Decreasing stack; on each pop, water above is bounded by min(left, right) - middle, multiplied by width. |
| 22 | Why does the monotonic-stack solution to LRH need to consider the case stack-is-empty after pop? | If the popped bar was the smallest so far, it extends to index 0 -- width = i, not i - top - 1. |
| 23 | How would you parallelize a monotonic-stack scan? | Per-row in matrix problems is embarrassingly parallel; the single-array scan resists parallelism. |
| 24 | What is the difference between a monotonic stack and a Cartesian tree? | The Cartesian tree is the data structure; the monotonic-stack scan is one O(n) algorithm to build it. |
| 25 | When should you avoid a monotonic stack? | If you only need a global aggregate (max, sum), a simple linear scan is enough -- no stack needed. |
| 26 | How do you avoid stack overflow on huge inputs in Python? | Use an explicit list as the stack -- never recursion. Pre-size if the input length is known. |
| 27 | Explain LeetCode 402 (remove k digits to get smallest number). | Increasing stack of digits; while k > 0 and top > new digit, pop; build result; trim leading zeros. |
| 28 | What is the "stock span" problem and its monotonic-stack solution? | For each day, count consecutive prior days with price <= today's; decreasing stack with non-strict pop. |
| 29 | Why does the histogram problem use **increasing** when "next smaller" uses increasing too -- isn't that just one problem? | Yes -- LRH internally computes next-smaller-on-both-sides in one fused pass; the increasing-stack invariant is exactly what gives both boundaries. |
| 30 | Test cases you'd write for any monotonic-stack solution? | Empty array, single element, all equal, strictly sorted ascending, strictly sorted descending, big-but-random. |

---

## Senior Questions (31-45)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 31 | How do you detect that a production workload is degrading a monotonic-stack pipeline? | Monitor max-depth and pop-to-push ratio; ratio near 0 indicates a strictly monotone stream and unbounded memory. |
| 32 | When would you switch from a monotonic stack to a monotonic queue? | When indices can become irrelevant before being popped naturally -- i.e., sliding window. |
| 33 | What is the connection between monotonic stacks and operator-precedence parsing? | Operator stack with monotone precedences; popping when a lower-precedence op arrives is the same template. |
| 34 | Describe how a query planner might use a monotonic stack. | Predicate pushdown, histogram bucket merging, materialized-view dominance -- all "for each X, find the nearest larger/smaller" problems over sorted metadata. |
| 35 | How would you make a monotonic-stack scan streaming-safe with bounded memory? | Cap the stack depth, drop the oldest pending answer, emit a metric. Or window-bound via a deque. |
| 36 | Can you implement a thread-safe monotonic stack? | Not naturally -- the invariant requires sequential processing. Shard by independent runs (per row/per region) instead. |
| 37 | What is the worst input for the monotonic stack in terms of P99 latency? | Strictly increasing input followed by a single huge dip -- the dip triggers one large pop burst, spiking tail latency. |
| 38 | When is monotonic stack a bad fit despite the problem looking right? | When the input is online and unbounded, or when "next" is defined within a moving window -- switch to deque or external memory. |
| 39 | What metrics would you emit to track a monotonic-stack pipeline in production? | max_depth, total_pops, pop_to_push_ratio, max_burst_size, per-request latency histogram. |
| 40 | Walk through the implementation of skyline computation using monotonic stacks. | Sweep events left-to-right; stack stores active heights monotonically; emit horizontal segments when the top changes. |

---

## Professional Questions (41-45)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 41 | Prove the monotonic-stack scan is O(n). | Aggregate method: each index is pushed and popped at most once -- total work 2n. |
| 42 | What is the connection between monotonic stacks and Cartesian trees? | The stack-based construction builds the Cartesian tree of the input in O(n); the stack always represents the right spine. |
| 43 | How does Cartesian tree + LCA give O(n) preprocessing / O(1) RMQ? | Build Cartesian tree (monotonic stack); reduce LCA to +-1 RMQ via Euler tour; block decomposition + sparse table. |
| 44 | Can you implement a persistent monotonic stack? | Yes, via a path-copy linked list; O(1) per op for pushes and pops, O(n) total memory, queryable across time. |
| 45 | What is the lower bound on the next-greater-element problem? | Omega(n) for output size; Omega(n - 1) comparisons in the worst case; monotonic-stack scan matches both. |

---

## Coding Challenge -- Largest Rectangle in Histogram

> Given non-negative bar heights `h[0..n-1]`, find the area of the largest axis-aligned rectangle that fits inside the histogram.
>
> Time: O(n). Space: O(n).
>
> Test:
> - `[2, 1, 5, 6, 2, 3]` -> 10
> - `[2, 4]` -> 4
> - `[]` -> 0
> - `[1, 1, 1, 1]` -> 4
> - `[5, 4, 3, 2, 1]` -> 9 (bar of height 3 spans width 3)

### Go

```go
package main

import "fmt"

// LargestRectangleArea returns the area of the largest rectangle entirely
// inside the histogram defined by heights. Uses an increasing monotonic
// stack of indices with a height-0 sentinel at the right end.
// Time: O(n). Space: O(n).
func LargestRectangleArea(heights []int) int {
    n := len(heights)
    stack := make([]int, 0, n+1)
    best := 0

    for i := 0; i <= n; i++ {
        // Virtual zero-height bar past the end drains the stack.
        cur := 0
        if i < n {
            cur = heights[i]
        }

        for len(stack) > 0 && heights[stack[len(stack)-1]] > cur {
            top := stack[len(stack)-1]
            stack = stack[:len(stack)-1]

            width := i
            if len(stack) > 0 {
                width = i - stack[len(stack)-1] - 1
            }
            if area := heights[top] * width; area > best {
                best = area
            }
        }
        stack = append(stack, i)
    }
    return best
}

func main() {
    tests := [][]int{
        {2, 1, 5, 6, 2, 3},
        {2, 4},
        {},
        {1, 1, 1, 1},
        {5, 4, 3, 2, 1},
    }
    for _, t := range tests {
        fmt.Printf("input=%v area=%d\n", t, LargestRectangleArea(t))
    }
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class LargestRectangleHistogram {

    /**
     * Largest rectangle in a histogram via monotonic increasing stack with
     * a sentinel zero-height bar past the right edge.
     *
     * Time: O(n) -- each index is pushed and popped at most once.
     * Space: O(n) -- worst-case stack holds all indices.
     */
    public static int largestRectangleArea(int[] heights) {
        int n = heights.length;
        Deque<Integer> stack = new ArrayDeque<>(n + 1);
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
        int[][] tests = {
            {2, 1, 5, 6, 2, 3},
            {2, 4},
            {},
            {1, 1, 1, 1},
            {5, 4, 3, 2, 1},
        };
        for (int[] t : tests) {
            System.out.printf("input=%s area=%d%n",
                java.util.Arrays.toString(t),
                largestRectangleArea(t));
        }
    }
}
```

### Python

```python
"""Largest rectangle in a histogram -- LeetCode 84."""

from typing import List


def largest_rectangle_area(heights: List[int]) -> int:
    """
    Maintains a monotonic increasing stack of indices. A virtual zero-height
    bar past the end drains the stack. When a bar of strictly lower height
    arrives, we pop the taller bars on top and compute the area each one
    bounds: the popped bar's height multiplied by the width spanning from
    the new top + 1 to the current index - 1.

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
    tests = [
        [2, 1, 5, 6, 2, 3],
        [2, 4],
        [],
        [1, 1, 1, 1],
        [5, 4, 3, 2, 1],
    ]
    for t in tests:
        print(f"input={t} area={largest_rectangle_area(t)}")
```

---

## Whiteboard Walkthrough -- Trapping Rain Water

A common follow-up to the largest-rectangle challenge. Given non-negative elevations, return the total trapped water.

**Idea.** Use a **decreasing** monotonic stack of indices. When a taller bar arrives we pop bars beneath it. For each popped bar (the "valley floor") the water above it is bounded by the previous taller bar (the new top) and the current bar.

```text
For input [0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1] -> 6
```

### Go

```go
package main

import "fmt"

func Trap(h []int) int {
    stack := []int{}; water := 0
    for i := 0; i < len(h); i++ {
        for len(stack) > 0 && h[stack[len(stack)-1]] < h[i] {
            mid := stack[len(stack)-1]; stack = stack[:len(stack)-1]
            if len(stack) == 0 { break }
            left := stack[len(stack)-1]
            bounded := h[left]; if h[i] < bounded { bounded = h[i] }
            water += (bounded - h[mid]) * (i - left - 1)
        }
        stack = append(stack, i)
    }
    return water
}

func main() {
    fmt.Println(Trap([]int{0,1,0,2,1,0,1,3,2,1,2,1})) // 6
}
```

### Java

```java
public class TrapRainWater {
    public static int trap(int[] h) {
        java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
        int water = 0;
        for (int i = 0; i < h.length; i++) {
            while (!st.isEmpty() && h[st.peek()] < h[i]) {
                int mid = st.pop();
                if (st.isEmpty()) break;
                int left = st.peek();
                water += (Math.min(h[left], h[i]) - h[mid]) * (i - left - 1);
            }
            st.push(i);
        }
        return water;
    }
    public static void main(String[] args) {
        System.out.println(trap(new int[]{0,1,0,2,1,0,1,3,2,1,2,1})); // 6
    }
}
```

### Python

```python
def trap(h):
    stack = []
    water = 0
    for i, v in enumerate(h):
        while stack and h[stack[-1]] < v:
            mid = stack.pop()
            if not stack:
                break
            left = stack[-1]
            water += (min(h[left], v) - h[mid]) * (i - left - 1)
        stack.append(i)
    return water

print(trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]))  # 6
```

---

## Mistakes Interviewers Watch For

| Mistake | What it tells the interviewer |
|---------|-------------------------------|
| Storing values, not indices | Candidate has memorized but not understood -- ask follow-up "what is the width of the rectangle?" |
| Forgetting the sentinel in largest-rectangle | Untested code; ask for the empty-array and strictly-increasing test cases. |
| Recursive monotonic-stack | Will OOM on large inputs; junior signal. |
| Treating amortized as worst case | "What is the worst-case time for a single iteration?" Correct answer: O(n). Total: O(n). |
| Picking wrong strictness for ties | Hand them `[2, 2, 2]` and ask for the trace. |
| No drain loop and no sentinel | The post-loop indices keep their default -1, which is sometimes right but sometimes wrong -- depends on the problem. |
| Pushing before the pop check | Breaks the invariant immediately. Should always pop-then-push. |

---

## How to Approach a New Monotonic-Stack Problem

A four-step recipe interviewers like to see verbalized:

1. **Identify the per-element question.** "For each i, the nearest j to the right with property P."
2. **Pick the invariant.** Decreasing for greater-related questions; increasing for smaller-related.
3. **Pick strictness.** Strict for "strictly greater"; non-strict if equal values should resolve each other.
4. **Decide what to record on pop.** Value? Index? Distance? Width-times-height?

If you can answer these four questions out loud before writing code, you will produce correct solutions and demonstrate clear thinking -- which is half of what the interviewer is grading.

---

## Quick-Recall Cheat Sheet

| Problem family | Stack | Pop trigger | Direction |
|----------------|-------|-------------|-----------|
| Next greater | Decreasing | `<` | L->R |
| Next smaller | Increasing | `>` | L->R |
| Previous greater | Decreasing | `<=` | L->R, read top after pops |
| Previous smaller | Increasing | `>=` | L->R, read top after pops |
| Daily temperatures | Decreasing | `<` | L->R, record `i - j` |
| Largest rectangle | Increasing | `>` | L->R, sentinel 0 at end |
| Trap rain water | Decreasing | `<` | L->R, water = bounded |
| Sum of minimums | Increasing | strict + non-strict | both passes |
| Remove K digits | Increasing | `>` and k>0 | L->R |
| Stock span | Decreasing | `<=` | L->R |

If you remember the table, you can reconstruct any solution under interview pressure.
</content>
</invoke>