# Monotonic Queue (Monotonic Deque) — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [What Does "Monotonic" Mean?](#what-does-monotonic-mean)
5. [The Sliding Window Maximum Problem](#the-sliding-window-maximum-problem)
6. [Brute Force vs Monotonic Deque](#brute-force-vs-monotonic-deque)
7. [Core Invariant](#core-invariant)
8. [Operations Walkthrough](#operations-walkthrough)
9. [Why Store Indices, Not Values](#why-store-indices-not-values)
10. [Full Implementation — Sliding Window Maximum](#full-implementation--sliding-window-maximum)
11. [Sliding Window Minimum](#sliding-window-minimum)
12. [Amortized O(n) Argument](#amortized-on-argument)
13. [Common Mistakes](#common-mistakes)
14. [Edge Cases](#edge-cases)
15. [Cheat Sheet](#cheat-sheet)
16. [Visual Animation](#visual-animation)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

A **monotonic queue** (more accurately a **monotonic deque**) is a double-ended queue whose contents are kept in monotonic order — either strictly/weakly increasing or decreasing from front to back. It is not a new data structure on its own; it is a *technique* layered on top of an ordinary deque (see [09-deque](../09-deque/junior.md)).

The technique solves the **sliding window maximum/minimum** problem in O(n) total time — beating the obvious O(n*k) brute force — and it underpins several dynamic-programming optimizations. If sliding window (see [11-sliding-window](../11-sliding-window/junior.md)) is the "pattern", the monotonic deque is the data structure that makes the inner aggregation step constant amortized.

---

## Prerequisites

- **Required:** Arrays and basic loops in Go/Java/Python
- **Required:** Familiarity with deque operations: push_front, push_back, pop_front, pop_back — covered in [09-deque](../09-deque/junior.md)
- **Required:** Sliding window mental model — covered in [11-sliding-window](../11-sliding-window/junior.md)
- **Helpful:** Knowing the difference between amortized and worst-case time
- **Helpful:** Monotonic stack (next-greater-element style problems) — see [13-monotonic-stack](../13-monotonic-stack/junior.md)

---

## Glossary

| Term | Definition |
|------|-----------|
| **Deque** | Double-ended queue supporting O(1) insert/remove at both ends |
| **Monotonic** | Sequence that is entirely non-decreasing or entirely non-increasing |
| **Monotonic queue** | A deque whose contents are kept monotonic by a maintenance rule on push |
| **Window** | A contiguous range `a[l..r]` of an array that slides as we scan |
| **Sliding window max** | Max value within the current window; classic monotonic-deque problem |
| **Expiration** | When the leftmost element of the window moves past an index we stored |
| **Amortized O(1)** | Average cost per operation across the whole run, even if some single ops cost more |

---

## What Does "Monotonic" Mean?

A sequence is **monotonically increasing** if each element is greater than or equal to the previous one:

```text
[1, 3, 3, 7, 9]   <-- non-decreasing (weak monotonic increase)
[1, 3, 5, 7, 9]   <-- strictly increasing
```

It is **monotonically decreasing** if each element is less than or equal to the previous one:

```text
[9, 7, 5, 3, 1]   <-- strictly decreasing
[9, 9, 7, 3, 1]   <-- non-increasing
```

A **monotonic deque** keeps these properties from front to back by popping any element from the back that would break the invariant when a new value is pushed.

```text
Decreasing deque (front to back):  [9, 7, 3, 1]
Push 5:   pop 3 (5 > 3), pop 1 (5 > 1), then push 5
Result:                            [9, 7, 5]
```

This sounds wasteful — we throw work away — but every element is touched at most twice (one push, one pop), so total work is linear.

---

## The Sliding Window Maximum Problem

> Given an array `a` of length `n` and a window size `k`, output the maximum of every window `a[i..i+k-1]` for `i = 0..n-k`.

Example:

```text
a = [1, 3, -1, -3, 5, 3, 6, 7]
k = 3

window [1, 3, -1]  -> max = 3
window [3, -1, -3] -> max = 3
window [-1, -3, 5] -> max = 5
window [-3, 5, 3]  -> max = 5
window [5, 3, 6]   -> max = 6
window [3, 6, 7]   -> max = 7

answer = [3, 3, 5, 5, 6, 7]
```

---

## Brute Force vs Monotonic Deque

**Brute force** — for each of `n - k + 1` windows, scan all `k` elements:

```text
total work = (n - k + 1) * k = O(n * k)
```

For `n = 10^6, k = 10^3`, that is `10^9` operations — too slow.

**Monotonic deque** — each index is pushed at most once and popped at most once:

```text
total work = O(n)
```

Same `n = 10^6, k = 10^3` finishes in ~`10^6` operations.

| Approach | Time | Space | Notes |
|----------|------|-------|-------|
| Brute force per window | O(n * k) | O(1) | Re-scans the window from scratch |
| Heap of size k | O(n log k) | O(k) | Lazy delete or position tracking needed |
| Sparse table | O(n log n) build, O(1) query | O(n log n) | Only for fixed array; not sliding |
| **Monotonic deque** | **O(n)** | **O(k)** | Best for sliding window |

---

## Core Invariant

For **sliding window maximum** we maintain a **decreasing monotonic deque**:

> `a[dq.front()] >= a[dq.next()] >= ... >= a[dq.back()]`

The front is always the index of the current window's maximum.

For **sliding window minimum** we maintain an **increasing monotonic deque**:

> `a[dq.front()] <= a[dq.next()] <= ... <= a[dq.back()]`

The front is always the index of the current window's minimum.

Mnemonic:

```text
Want max -> Decreasing deque -> front is biggest
Want min -> Increasing deque -> front is smallest
```

---

## Operations Walkthrough

Three things happen per step `i`:

1. **Expire** elements that have slid out of the window from the front.
2. **Maintain monotonicity** by popping from the back anything smaller (for max) than `a[i]`.
3. **Push** the new index `i` to the back.
4. **Record** `a[dq.front()]` as the window-`i` answer (once `i >= k - 1`).

Trace on `a = [1, 3, -1, -3, 5, 3, 6, 7]`, `k = 3`:

```text
i=0, a[i]=1:  expire none. back-pop none. push 0.  dq=[0]              (no answer yet)
i=1, a[i]=3:  expire none. a[0]=1 < 3 -> pop 0. push 1.  dq=[1]        (no answer yet)
i=2, a[i]=-1: expire none. -1 < a[1]=3 -> no back-pop. push 2. dq=[1,2] ans[0]=a[1]=3
i=3, a[i]=-3: expire none (front=1 >= i-k+1=1). -3 < a[2]=-1 ok. push 3. dq=[1,2,3] ans[1]=a[1]=3
i=4, a[i]=5:  expire 1? i-k+1=2, front=1 < 2 -> pop_front. dq=[2,3].
              a[3]=-3<5 pop_back. dq=[2]. a[2]=-1<5 pop_back. dq=[].
              push 4. dq=[4]. ans[2]=a[4]=5
i=5, a[i]=3:  expire none. a[4]=5>3 ok. push 5. dq=[4,5]. ans[3]=a[4]=5
i=6, a[i]=6:  expire none. a[5]=3<6 pop. dq=[4]. a[4]=5<6 pop. dq=[]. push 6. dq=[6]. ans[4]=a[6]=6
i=7, a[i]=7:  expire none. a[6]=6<7 pop. dq=[]. push 7. dq=[7]. ans[5]=a[7]=7
```

Final: `ans = [3, 3, 5, 5, 6, 7]` — matches the expected output.

---

## Why Store Indices, Not Values

The deque stores **indices** into `a`, not the values themselves. The reason is the expiration step:

> "If `dq.front() < i - k + 1`, pop_front."

We need to know **when** an element entered the deque to decide whether it has slid out of the window. The value alone cannot tell us that — two elements with value 5 sitting in the deque could be from different positions.

Even if duplicates were forbidden, storing indices is cheaper conceptually: comparing `dq.front() < i - k + 1` is an integer compare, while value-based expiration would force you to maintain a parallel "when was this pushed" structure.

**Rule:** Always push the index. Read the value via `a[dq.front()]`.

---

## Full Implementation — Sliding Window Maximum

### Go

```go
package main

import (
	"container/list"
	"fmt"
)

// SlidingWindowMax returns the maximum of every window of size k in a.
// Uses a decreasing monotonic deque storing indices.
// Time:  O(n) amortized (each index pushed and popped at most once).
// Space: O(k) for the deque + O(n - k + 1) for output.
func SlidingWindowMax(a []int, k int) []int {
	if k <= 0 || len(a) < k {
		return nil
	}

	// We use a slice as a deque: dq[0] is front, dq[len-1] is back.
	// container/list could be used too but a slice is faster for ints.
	dq := make([]int, 0, k)
	out := make([]int, 0, len(a)-k+1)

	for i, x := range a {
		// 1. Expire indices that have slid out of the window.
		if len(dq) > 0 && dq[0] < i-k+1 {
			dq = dq[1:]
		}

		// 2. Maintain decreasing invariant: drop anything from back that is < x.
		for len(dq) > 0 && a[dq[len(dq)-1]] < x {
			dq = dq[:len(dq)-1]
		}

		// 3. Push the new index.
		dq = append(dq, i)

		// 4. Record the window max once we have a full window.
		if i >= k-1 {
			out = append(out, a[dq[0]])
		}
	}
	return out
}

// Demonstration of using container/list as a deque (less idiomatic for ints,
// but useful if you need a real linked list).
func slidingWindowMaxList(a []int, k int) []int {
	dq := list.New()
	out := make([]int, 0)
	for i, x := range a {
		if dq.Len() > 0 && dq.Front().Value.(int) < i-k+1 {
			dq.Remove(dq.Front())
		}
		for dq.Len() > 0 && a[dq.Back().Value.(int)] < x {
			dq.Remove(dq.Back())
		}
		dq.PushBack(i)
		if i >= k-1 {
			out = append(out, a[dq.Front().Value.(int)])
		}
	}
	return out
}

func main() {
	a := []int{1, 3, -1, -3, 5, 3, 6, 7}
	fmt.Println(SlidingWindowMax(a, 3))    // [3 3 5 5 6 7]
	fmt.Println(slidingWindowMaxList(a, 3)) // [3 3 5 5 6 7]
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Arrays;

public class SlidingWindowMax {

    /**
     * Returns the maximum of every window of size k in a.
     * Uses a decreasing monotonic deque storing indices.
     * Time:  O(n) amortized.
     * Space: O(k) for the deque.
     */
    public static int[] slidingWindowMax(int[] a, int k) {
        if (a == null || a.length == 0 || k <= 0 || a.length < k) {
            return new int[0];
        }

        // ArrayDeque is a circular buffer — faster than LinkedList for this use.
        Deque<Integer> dq = new ArrayDeque<>();
        int[] out = new int[a.length - k + 1];
        int idx = 0;

        for (int i = 0; i < a.length; i++) {
            // 1. Expire indices that have slid out of the window.
            if (!dq.isEmpty() && dq.peekFirst() < i - k + 1) {
                dq.pollFirst();
            }

            // 2. Maintain decreasing invariant.
            while (!dq.isEmpty() && a[dq.peekLast()] < a[i]) {
                dq.pollLast();
            }

            // 3. Push the new index.
            dq.offerLast(i);

            // 4. Record the window max.
            if (i >= k - 1) {
                out[idx++] = a[dq.peekFirst()];
            }
        }
        return out;
    }

    public static void main(String[] args) {
        int[] a = {1, 3, -1, -3, 5, 3, 6, 7};
        System.out.println(Arrays.toString(slidingWindowMax(a, 3)));
        // [3, 3, 5, 5, 6, 7]
    }
}
```

### Python

```python
"""Sliding window maximum using a monotonic deque."""

from collections import deque


def sliding_window_max(a: list[int], k: int) -> list[int]:
    """Return the maximum of every window of size k in a.

    Uses a decreasing monotonic deque that stores indices.

    Time:  O(n) amortized — each index is pushed once and popped at most once.
    Space: O(k) for the deque + O(n - k + 1) for the output list.
    """
    if not a or k <= 0 or len(a) < k:
        return []

    dq: deque[int] = deque()
    out: list[int] = []

    for i, x in enumerate(a):
        # 1. Expire indices that have slid out of the window.
        if dq and dq[0] < i - k + 1:
            dq.popleft()

        # 2. Maintain decreasing invariant: pop from back anything smaller than x.
        while dq and a[dq[-1]] < x:
            dq.pop()

        # 3. Push the new index.
        dq.append(i)

        # 4. Record the window max once we have a full window.
        if i >= k - 1:
            out.append(a[dq[0]])

    return out


if __name__ == "__main__":
    a = [1, 3, -1, -3, 5, 3, 6, 7]
    print(sliding_window_max(a, 3))  # [3, 3, 5, 5, 6, 7]
```

**What it does:** Scans the array once, keeping a decreasing deque of indices. The front of the deque is always the index of the current window's maximum.
**Run:** `go run main.go` | `javac SlidingWindowMax.java && java SlidingWindowMax` | `python sliding_window_max.py`

---

## Sliding Window Minimum

The minimum problem is the **mirror image** — flip the comparison and use an **increasing** deque.

### Go

```go
package main

import "fmt"

func SlidingWindowMin(a []int, k int) []int {
	if k <= 0 || len(a) < k {
		return nil
	}
	dq := make([]int, 0, k)
	out := make([]int, 0, len(a)-k+1)

	for i, x := range a {
		if len(dq) > 0 && dq[0] < i-k+1 {
			dq = dq[1:]
		}
		// Increasing invariant: drop from back anything LARGER than x.
		for len(dq) > 0 && a[dq[len(dq)-1]] > x {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
		if i >= k-1 {
			out = append(out, a[dq[0]])
		}
	}
	return out
}

func main() {
	a := []int{1, 3, -1, -3, 5, 3, 6, 7}
	fmt.Println(SlidingWindowMin(a, 3)) // [-1 -3 -3 -3 3 3]
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Arrays;

public class SlidingWindowMin {
    public static int[] slidingWindowMin(int[] a, int k) {
        if (a == null || a.length == 0 || k <= 0 || a.length < k) return new int[0];
        Deque<Integer> dq = new ArrayDeque<>();
        int[] out = new int[a.length - k + 1];
        int idx = 0;
        for (int i = 0; i < a.length; i++) {
            if (!dq.isEmpty() && dq.peekFirst() < i - k + 1) dq.pollFirst();
            while (!dq.isEmpty() && a[dq.peekLast()] > a[i]) dq.pollLast();
            dq.offerLast(i);
            if (i >= k - 1) out[idx++] = a[dq.peekFirst()];
        }
        return out;
    }

    public static void main(String[] args) {
        int[] a = {1, 3, -1, -3, 5, 3, 6, 7};
        System.out.println(Arrays.toString(slidingWindowMin(a, 3)));
        // [-1, -3, -3, -3, 3, 3]
    }
}
```

### Python

```python
from collections import deque


def sliding_window_min(a: list[int], k: int) -> list[int]:
    if not a or k <= 0 or len(a) < k:
        return []
    dq: deque[int] = deque()
    out: list[int] = []
    for i, x in enumerate(a):
        if dq and dq[0] < i - k + 1:
            dq.popleft()
        # Increasing invariant: pop from back anything LARGER than x.
        while dq and a[dq[-1]] > x:
            dq.pop()
        dq.append(i)
        if i >= k - 1:
            out.append(a[dq[0]])
    return out


if __name__ == "__main__":
    print(sliding_window_min([1, 3, -1, -3, 5, 3, 6, 7], 3))
    # [-1, -3, -3, -3, 3, 3]
```

The only changes from the max version:
- Comparison `< x` becomes `> x` in the back-pop loop.
- Invariant is increasing instead of decreasing.

---

## Amortized O(n) Argument

> **Claim:** Sliding window max with a monotonic deque runs in O(n) total time over `n` indices.

The inner `while` loop can pop many items in a single iteration of the outer `for`. So a single outer step is not O(1). But:

- Each index `i` is **pushed exactly once** in the outer loop.
- Each index is **popped at most once** — either from the front (expiration) or from the back (monotonicity break).
- Once popped, an index never comes back.

So across the whole run, the total number of pushes is `n` and the total number of pops is at most `n`. Total work = O(n). Divide by `n` outer iterations: **amortized O(1) per iteration**.

This is the same "credit scheme" argument used for dynamic array push and union-find with path compression. See [aggregate method in professional.md](./professional.md) for a formal version.

---

## Common Mistakes

| Mistake | Why It Is Wrong | Fix |
|---------|----------------|-----|
| Storing values instead of indices | Cannot detect when an element slides out of the window | Always push `i`, read `a[dq.front()]` |
| Forgetting the expiration step | Front may reference an index that left the window long ago | Pop_front before reading the answer |
| Recording the answer at every `i` | First `k - 1` indices do not form a complete window | Guard with `if i >= k - 1` |
| Using `<=` vs `<` carelessly | Affects whether ties stay in the deque — wrong for some DP variants | Default to strict `<` for max; use `<=` only when you must drop equals |
| Implementing with a plain queue + linear scan for max | Degrades to O(n * k) | Use a deque with the maintenance rule |
| Increasing deque when you wanted max | Front holds the minimum, not the maximum | Match invariant to operation: decreasing -> max, increasing -> min |
| `LinkedList` in Java for the deque | Much slower than `ArrayDeque` due to allocation overhead | Use `ArrayDeque` |
| Using `list.pop(0)` in Python | O(n) — defeats the whole optimization | Use `collections.deque` and `popleft()` |
| Allocating a new deque per window | Defeats amortization | One deque shared across all iterations |

---

## Edge Cases

- **`k = 1`** — every window is a single element; answer equals the array. Our code handles this correctly (the back-pop loop will pop the previous element when a new one arrives, but the answer is recorded before the next push).
- **`k = n`** — only one window; the algorithm still runs in O(n) and produces a single-element answer.
- **`k > n`** — no full window exists; return empty.
- **All-equal array** — with strict `<`, no back-pops happen; the deque just grows then expires. With `<=`, the deque stays size 1.
- **Strictly increasing array** — every new element causes the entire deque to be back-popped (one big "flush") and the deque always has size 1.
- **Strictly decreasing array** — no back-pops ever; deque grows to size `k` and the front expires one by one.
- **Negative numbers** — no special handling needed; comparisons work on signed integers.
- **Empty array or `k <= 0`** — return empty without crashing.

---

## Cheat Sheet

| Operation | Cost | Notes |
|-----------|------|-------|
| Push to back (with maintenance) | O(1) amortized | Worst-case O(k) in a single call |
| Pop from front (expiration) | O(1) worst-case | Only one element can expire per step |
| Peek front | O(1) | Returns the current window extremum |
| Total to process `n` elements | O(n) | Each index pushed once and popped at most once |
| Extra space | O(k) | Deque holds at most `k` indices |

```text
# Template — sliding window max
dq = empty deque of indices
for i in 0..n-1:
    if dq not empty and dq.front() < i - k + 1:
        dq.pop_front()
    while dq not empty and a[dq.back()] < a[i]:
        dq.pop_back()
    dq.push_back(i)
    if i >= k - 1:
        answer[i - k + 1] = a[dq.front()]
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation shows:
> - The input array with the current window `[l..r]` bracketed
> - The monotonic deque below as a horizontal strip of `(index, value)` cells
> - **Green** flashes on push, **red** flashes on back-pop (monotonicity break), **purple** flashes on front-pop (expiration)
> - Live counters for current window, deque size, total pushes, total pops
> - Step / Play / Pause / Reset controls and adjustable speed

---

## Summary

A monotonic deque keeps its contents in monotone order from front to back. For sliding window **maximum** use a **decreasing** deque (front = max); for sliding window **minimum** use an **increasing** deque (front = min). Store **indices**, not values, so you can expire elements that slid out of the window. Each index is pushed once and popped at most once, giving total work O(n) — a strict win over the O(n * k) brute force.

Once you understand the pattern on the canonical sliding-window problem, the same shape appears in DP problems where a recurrence references the max or min of a bounded look-back range. See [middle.md](./middle.md) for those uses.

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — Chapter 17 (Amortized Analysis), aggregate method
- Leetcode 239 — *Sliding Window Maximum* (canonical exercise)
- Leetcode 1696 — *Jump Game VI* (DP optimization with monotonic deque)
- Leetcode 1425 — *Constrained Subsequence Sum* (DP + monotonic deque)
- Go: `container/list` (linked list deque), or use a slice as a circular buffer
- Java: `java.util.ArrayDeque` (preferred over `LinkedList` for performance)
- Python: `collections.deque` — O(1) append and popleft
- cp-algorithms.com — *Minimum stack / Minimum queue* article (companion read)
