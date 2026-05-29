# Monotonic Queue — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing the Direction](#choosing-the-direction)
3. [Strict vs Non-Strict Comparison](#strict-vs-non-strict-comparison)
4. [Monotonic Queue vs Monotonic Stack](#monotonic-queue-vs-monotonic-stack)
5. [Monotonic Queue vs Sparse Table / Segment Tree](#monotonic-queue-vs-sparse-table--segment-tree)
6. [DP Optimization Pattern](#dp-optimization-pattern)
7. [Case Study: Jump Game VI](#case-study-jump-game-vi)
8. [Case Study: Constrained Subsequence Sum](#case-study-constrained-subsequence-sum)
9. [Case Study: Largest Sum Subarray of Length at Most K](#case-study-largest-sum-subarray-of-length-at-most-k)
10. [Variants and Adjacencies](#variants-and-adjacencies)
11. [Mistakes That Survive the Junior Level](#mistakes-that-survive-the-junior-level)
12. [Summary](#summary)

---

## Introduction

> Focus: "Why does the invariant work, and when do I reach for this technique over alternatives?"

At the junior level you saw the sliding window max template. At the middle level the question is *recognition*: which problems collapse onto a monotonic deque? The answer is any problem whose inner aggregate is "min/max of the last k elements of something" — including a large class of DP recurrences.

This document covers the recognition triggers, comparisons to neighbouring techniques (monotonic stack, sparse table, segment tree, heap), and three worked DP case studies.

---

## Choosing the Direction

The decision is mechanical once you remember the rule:

| Goal | Deque type | Back-pop rule | Front holds |
|------|-----------|---------------|-------------|
| Window **maximum** | Decreasing | Pop while `a[back] < x` | Maximum |
| Window **minimum** | Increasing | Pop while `a[back] > x` | Minimum |
| Window **argmax** for a key `f(i)` | Decreasing on `f` | Pop while `f(back) < f(i)` | Index of max-`f` |

The "direction" is the direction of the invariant from front to back. The front is always the extremum.

If the problem is asking for the max over a range and you find yourself reaching for an *increasing* deque, you have the direction inverted.

---

## Strict vs Non-Strict Comparison

Most exercises do not care whether you write `<` or `<=` in the back-pop loop for the simple max/min problem — the answer is the same. But two situations make it matter:

1. **DP correctness on ties.** Consider `f(i) = max_{j in [i-k, i-1]} f(j) + a[i]`. If `f(j1) == f(j2)` and `j1 < j2`, dropping `j1` (using `<=`) prefers the *newer* index, which stays in the window longer. Dropping nothing on ties (using strict `<`) keeps both, which costs more memory but can be required if you later need to know *which* index produced the max.

2. **Index-sensitive answers.** If the problem asks for the first or last index of the max, the choice of `<` vs `<=` decides which one you produce.

**Rule of thumb:** Default to **strict `<`** (drop only smaller). Switch to `<=` if you have a clear reason — usually to keep the deque smaller when you know any tied index will give the same answer.

---

## Monotonic Queue vs Monotonic Stack

Both maintain a monotone sequence, but they live in different problem shapes.

| Aspect | Monotonic Stack | Monotonic Queue (Deque) |
|--------|-----------------|------------------------|
| Pop ends | Top only | Both ends |
| Expiration? | Never — elements stay until popped by a comparison | Yes — front pops when index leaves the window |
| Typical problem | Next greater/smaller element, largest rectangle in histogram, stock span | Sliding window max/min, DP on bounded look-back |
| Window? | No — entire prefix is "live" | Yes — `k`-element window |
| Data | Each element pushed/popped exactly once | Same — but front pops are time-driven, not comparison-driven |
| Topic link | [13-monotonic-stack](../13-monotonic-stack/middle.md) | This document |

**Mental test:** If the problem says "for each index, find the next index where ... " (no window), reach for a monotonic stack. If it says "for each window of size k, ..." or "for each index, look back at most k positions", reach for a monotonic deque.

A monotonic stack is a strict subset of a monotonic deque: a deque that never uses front-pop *is* a stack. The deque generalizes the stack to support a sliding lower bound on indices.

---

## Monotonic Queue vs Sparse Table / Segment Tree

If the **array is static** and you have many queries, alternatives exist:

| Structure | Build | Query (range max/min) | Update | Best for |
|-----------|-------|----------------------|--------|---------|
| Brute scan | - | O(k) | - | One-off, tiny k |
| Monotonic deque | - | O(n) total over a sliding scan | - | Sliding window; single linear pass |
| Sparse table | O(n log n) | O(1) | Not supported | Many random RMQ on a static array |
| Segment tree | O(n) | O(log n) | O(log n) | Mixed updates and queries |
| Fenwick / BIT | O(n) | O(log n) for prefix | O(log n) | Prefix sums (not max/min directly) |

**Choose monotonic deque when:**
- The queries are over a single forward (or backward) sweep
- The window slides one position per step
- You do not need to answer random RMQ later

**Choose sparse table when:**
- The array is static
- You will issue many arbitrary range queries
- Total work `O(n log n + Q)` is acceptable

**Choose segment tree when:**
- The array supports point updates between queries
- You need queries over arbitrary ranges, not a moving window

A monotonic deque is the cheapest option *if and only if* the access pattern is a sliding window. Outside that pattern it is the wrong tool.

---

## DP Optimization Pattern

Many DP recurrences have the shape:

```text
f(i) = a[i] + max_{j in [i - k, i - 1]} f(j)
```

A naive evaluation is O(n * k) — for each `i`, scan the previous `k` values for the max. Monotonic deque collapses this to O(n).

**Recipe:**

1. Maintain a decreasing deque of indices `j` keyed on `f(j)`.
2. Before computing `f(i)`:
   - Expire from the front: while `dq.front() < i - k`, pop_front.
   - The current max is `f(dq.front())`.
3. Compute `f(i) = a[i] + f(dq.front())` (or whatever the recurrence demands).
4. Push `i` after maintaining monotonicity: while `f(dq.back()) <= f(i)`, pop_back. Then `dq.push_back(i)`.

The deque stores indices into `f`, not into `a` — the key being tracked is the DP value, not the array value.

**Why this works:** The recurrence asks "what is the maximum of `f` over the last `k` indices?" — exactly the sliding-window-max question. The lookback `k` is the window size.

**When it fails:** If the recurrence depends on `j` in more ways than just `f(j)` (e.g., `f(j) + c(i, j)` with a non-trivial `c`), the monotonic deque may not suffice — you may need **convex hull trick** (CHT) or **divide-and-conquer optimization**. See [professional.md](./professional.md) for the CHT link.

---

## Case Study: Jump Game VI

> *Leetcode 1696.* You are at index 0 of `nums`. At each step you may jump 1 to `k` positions forward. Maximize the sum of values you land on, ending at the last index.

Recurrence:

```text
f(i) = nums[i] + max_{j in [i - k, i - 1]} f(j)
f(0) = nums[0]
```

Naive O(n * k). With a monotonic deque the inner max becomes O(1) amortized.

### Go

```go
package main

import "fmt"

func maxResult(nums []int, k int) int {
	n := len(nums)
	f := make([]int, n)
	f[0] = nums[0]
	dq := []int{0} // indices into f, decreasing in f-value

	for i := 1; i < n; i++ {
		// Expire indices that are out of the [i-k, i-1] window.
		if dq[0] < i-k {
			dq = dq[1:]
		}
		// Compute f(i) using the current front (max f in window).
		f[i] = nums[i] + f[dq[0]]
		// Maintain decreasing invariant on f.
		for len(dq) > 0 && f[dq[len(dq)-1]] <= f[i] {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
	}
	return f[n-1]
}

func main() {
	fmt.Println(maxResult([]int{1, -1, -2, 4, -7, 3}, 2)) // 7
	fmt.Println(maxResult([]int{10, -5, -2, 4, 0, 3}, 3)) // 17
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class JumpGameVI {
    public static int maxResult(int[] nums, int k) {
        int n = nums.length;
        int[] f = new int[n];
        f[0] = nums[0];
        Deque<Integer> dq = new ArrayDeque<>();
        dq.offerLast(0);

        for (int i = 1; i < n; i++) {
            if (dq.peekFirst() < i - k) dq.pollFirst();
            f[i] = nums[i] + f[dq.peekFirst()];
            while (!dq.isEmpty() && f[dq.peekLast()] <= f[i]) {
                dq.pollLast();
            }
            dq.offerLast(i);
        }
        return f[n - 1];
    }

    public static void main(String[] args) {
        System.out.println(maxResult(new int[]{1, -1, -2, 4, -7, 3}, 2)); // 7
    }
}
```

### Python

```python
from collections import deque


def max_result(nums: list[int], k: int) -> int:
    n = len(nums)
    f = [0] * n
    f[0] = nums[0]
    dq: deque[int] = deque([0])
    for i in range(1, n):
        if dq[0] < i - k:
            dq.popleft()
        f[i] = nums[i] + f[dq[0]]
        while dq and f[dq[-1]] <= f[i]:
            dq.pop()
        dq.append(i)
    return f[-1]


if __name__ == "__main__":
    print(max_result([1, -1, -2, 4, -7, 3], 2))   # 7
    print(max_result([10, -5, -2, 4, 0, 3], 3))   # 17
```

Notice the use of `<=` in the back-pop loop. We are happy to drop older indices with equal `f` because we want the newest (it stays in the window longest), which is harmless for correctness here.

---

## Case Study: Constrained Subsequence Sum

> *Leetcode 1425.* Pick a subsequence of `nums` such that consecutive picks are at most `k` positions apart. Maximize the sum.

Recurrence:

```text
f(i) = nums[i] + max(0, max_{j in [i - k, i - 1]} f(j))
answer = max over i of f(i)
```

The `max(0, ...)` term means we can always start fresh, never carrying a negative tail.

### Go

```go
package main

import "fmt"

func constrainedSubsetSum(nums []int, k int) int {
	n := len(nums)
	f := make([]int, n)
	dq := []int{}
	best := -1 << 31

	for i := 0; i < n; i++ {
		if len(dq) > 0 && dq[0] < i-k {
			dq = dq[1:]
		}
		prev := 0
		if len(dq) > 0 {
			prev = f[dq[0]]
		}
		f[i] = nums[i] + maxInt(0, prev)
		if f[i] > best {
			best = f[i]
		}
		for len(dq) > 0 && f[dq[len(dq)-1]] <= f[i] {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
	}
	return best
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	fmt.Println(constrainedSubsetSum([]int{10, 2, -10, 5, 20}, 2))  // 37
	fmt.Println(constrainedSubsetSum([]int{-1, -2, -3}, 1))         // -1
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class ConstrainedSubsetSum {
    public static int constrainedSubsetSum(int[] nums, int k) {
        int n = nums.length;
        int[] f = new int[n];
        Deque<Integer> dq = new ArrayDeque<>();
        int best = Integer.MIN_VALUE;

        for (int i = 0; i < n; i++) {
            if (!dq.isEmpty() && dq.peekFirst() < i - k) dq.pollFirst();
            int prev = dq.isEmpty() ? 0 : Math.max(0, f[dq.peekFirst()]);
            f[i] = nums[i] + prev;
            best = Math.max(best, f[i]);
            while (!dq.isEmpty() && f[dq.peekLast()] <= f[i]) dq.pollLast();
            dq.offerLast(i);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(constrainedSubsetSum(new int[]{10, 2, -10, 5, 20}, 2)); // 37
    }
}
```

### Python

```python
from collections import deque


def constrained_subset_sum(nums: list[int], k: int) -> int:
    n = len(nums)
    f = [0] * n
    dq: deque[int] = deque()
    best = float("-inf")
    for i in range(n):
        if dq and dq[0] < i - k:
            dq.popleft()
        prev = max(0, f[dq[0]]) if dq else 0
        f[i] = nums[i] + prev
        best = max(best, f[i])
        while dq and f[dq[-1]] <= f[i]:
            dq.pop()
        dq.append(i)
    return int(best)


if __name__ == "__main__":
    print(constrained_subset_sum([10, 2, -10, 5, 20], 2))  # 37
    print(constrained_subset_sum([-1, -2, -3], 1))         # -1
```

The pattern is identical to Jump Game VI; only the recurrence body changes (`max(0, ...)`).

---

## Case Study: Largest Sum Subarray of Length at Most K

> Given `a` and `k`, find the largest sum of any contiguous subarray whose length is between 1 and `k`.

Use prefix sums `P[i] = a[0] + ... + a[i-1]`. Then `sum(a[j..i-1]) = P[i] - P[j]`. We want, for each `i`, the **smallest** `P[j]` for `j in [i - k, i - 1]`. That is sliding window **minimum** on `P`.

### Go

```go
package main

import "fmt"

func maxSubarraySumLenAtMostK(a []int, k int) int {
	n := len(a)
	P := make([]int, n+1)
	for i := 0; i < n; i++ {
		P[i+1] = P[i] + a[i]
	}

	dq := []int{0} // indices into P, increasing in P-value
	best := -1 << 31
	for i := 1; i <= n; i++ {
		// Expire indices j < i - k (subarray length = i - j > k).
		for len(dq) > 0 && dq[0] < i-k {
			dq = dq[1:]
		}
		if len(dq) > 0 {
			if P[i]-P[dq[0]] > best {
				best = P[i] - P[dq[0]]
			}
		}
		for len(dq) > 0 && P[dq[len(dq)-1]] >= P[i] {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
	}
	return best
}

func main() {
	fmt.Println(maxSubarraySumLenAtMostK([]int{-2, 1, -3, 4, -1, 2, 1, -5, 4}, 4)) // 6
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class MaxSubarrayLenAtMostK {
    public static int solve(int[] a, int k) {
        int n = a.length;
        int[] P = new int[n + 1];
        for (int i = 0; i < n; i++) P[i + 1] = P[i] + a[i];
        Deque<Integer> dq = new ArrayDeque<>();
        dq.offerLast(0);
        int best = Integer.MIN_VALUE;
        for (int i = 1; i <= n; i++) {
            while (!dq.isEmpty() && dq.peekFirst() < i - k) dq.pollFirst();
            if (!dq.isEmpty()) best = Math.max(best, P[i] - P[dq.peekFirst()]);
            while (!dq.isEmpty() && P[dq.peekLast()] >= P[i]) dq.pollLast();
            dq.offerLast(i);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(solve(new int[]{-2, 1, -3, 4, -1, 2, 1, -5, 4}, 4)); // 6
    }
}
```

### Python

```python
from collections import deque


def max_subarray_len_at_most_k(a: list[int], k: int) -> int:
    n = len(a)
    P = [0] * (n + 1)
    for i in range(n):
        P[i + 1] = P[i] + a[i]
    dq: deque[int] = deque([0])
    best = float("-inf")
    for i in range(1, n + 1):
        while dq and dq[0] < i - k:
            dq.popleft()
        if dq:
            best = max(best, P[i] - P[dq[0]])
        while dq and P[dq[-1]] >= P[i]:
            dq.pop()
        dq.append(i)
    return int(best)


if __name__ == "__main__":
    print(max_subarray_len_at_most_k([-2, 1, -3, 4, -1, 2, 1, -5, 4], 4))  # 6
```

This is the bridge between **prefix sums** (see [12-prefix-sums-difference-arrays](../12-prefix-sums-difference-arrays/middle.md)) and **monotonic deque** — many subarray problems combine the two.

---

## Variants and Adjacencies

- **Sum of (window max - window min) over all windows of size k.** Run two deques in parallel, one increasing and one decreasing. Add `a[front_dec] - a[front_inc]` to a running sum per window. O(n).
- **Maximum of `a[i] + b[j]` where `|i - j| <= k`.** Sliding window max on `a` indexed by `j` and a single pass over `b`. O(n).
- **Sliding window k-th largest.** Monotonic deque does *not* solve this — use a balanced BST, indexed set, or two heaps with lazy deletion.
- **Convex hull trick (CHT).** A monotonic-deque-shaped structure where elements are *lines* and the maintenance rule is "remove lines that are dominated by their neighbors." Used for DP recurrences of the form `f(i) = min_j (f(j) + a*x + b)` where the slope and intercept depend on `j`. See [13-dynamic-programming/10-convex-hull-trick](../../13-dynamic-programming/10-convex-hull-trick-li-chao/junior.md) when it lands. Same amortization idea, different invariant.
- **0-1 BFS.** Shortest path on a graph with edge weights 0 or 1 uses a deque: 0-weight edges push to the front, 1-weight edges push to the back. Not technically a *monotonic* deque, but the deque-of-indices machinery is the same. See [11-graphs/22-zero-one-bfs](../../11-graphs/22-zero-one-bfs/junior.md).
- **Streaming aggregates.** Real-time systems that need a rolling max/min over the most recent `k` events use a monotonic deque keyed on timestamp; see [senior.md](./senior.md).

---

## Mistakes That Survive the Junior Level

| Mistake | Diagnosis | Fix |
|--------|-----------|-----|
| Building a fresh deque for each window | Misread "sliding" as "independent" | Reuse one deque across the whole pass |
| Comparing values in front-pop instead of indices | Confusion between front-pop (time) and back-pop (value) | Front-pop uses index vs window left; back-pop uses value comparison |
| Using a heap for sliding window max | Works but is O(n log k); also need lazy deletion for correctness | Use a deque for O(n) |
| Mutating the array during the scan | Breaks the invariant since `a[dq.back()]` would change | Treat input as read-only |
| Skipping the `if i >= k - 1` guard | Writes garbage for the first `k - 1` positions | Add the guard |
| Treating the deque as a circular buffer with fixed size `k` | Deque size can exceed `k` only when invariant violations exist — but is usually `<= k`; fixed-size buffers risk wraparound bugs | Use a true dynamic deque |
| Wrong invariant on argmin / argmax of a derived key | Pushed `a[i]` but compared `f[i]` (or vice versa) | Decide once which key the deque tracks and use it consistently |
| Re-computing the prefix-sum during expiration | Wasted O(n) on top of the deque pass | Precompute `P` once before the sliding pass |

---

## Summary

At middle level the monotonic deque is no longer "the sliding window max trick" — it is a general technique for collapsing an inner `max`/`min` over a bounded look-back range from O(k) to O(1) amortized. Recognize the shape `f(i) = ... + max_{j in [i - k, i - 1]} f(j)` and you have a candidate.

Compared to other tools: it is faster than a heap, simpler than a segment tree, and tighter than a sparse table — but only when access follows a single forward sweep with a sliding window. Outside that, prefer the more general structure.

For static random-access RMQ, jump to sparse tables. For point updates with range queries, jump to a segment tree. For DP recurrences whose inner term is a linear function of `j`, jump to convex hull trick. The monotonic deque is the elegant minimum-overhead solution for the sliding-window subset of these problems.
