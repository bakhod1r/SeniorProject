# Slope Trick — Junior Level

> **One-line summary:** When a DP keeps a *cost function* `f(x)` at each step, and that function is always **convex and piecewise-linear** (made of straight segments whose slopes only increase as `x` grows), you do not need to store the whole function. You only need to store the **points where the slope changes** (the *breakpoints*) plus the current minimum value. Slope Trick maintains this compact representation with two priority queues — a **left heap** holding breakpoints to the left of the minimum and a **right heap** holding those to the right — and updates it in `O(log n)` per step. The flagship use is "minimum total cost to make an array non-decreasing", solvable in `O(n log n)`.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Imagine a dynamic-programming problem where the *state* at step `i` is not a single number but an entire **function**: "if the value I commit to at position `i` is `x`, the minimum total cost so far is `f_i(x)`." You want, at the very end, `min_x f_n(x)` — the cheapest way to finish. Storing `f_i` as a full table is too much; `x` can range over millions of values, and you have `n` steps.

The crucial observation that makes such DPs tractable: in a surprisingly large family of problems, **every `f_i` is convex and piecewise-linear**. "Piecewise-linear" means the graph of `f_i` is made of straight line segments joined end to end. "Convex" means it bends only *upward* — as you sweep `x` from left to right, the slope of those segments never decreases. A convex piecewise-linear function looks like a valley: it comes down at some slope, flattens out (possibly), and goes back up, with the slope getting bigger and bigger.

The whole point of Slope Trick is that such a function is completely described by three cheap things:

1. The **minimum value** `minVal` (how low the valley floor is).
2. The list of **breakpoints to the left of the minimum** — the `x` positions where the slope changes, on the descending side.
3. The list of **breakpoints to the right of the minimum** — the `x` positions where the slope changes, on the ascending side.

Because the slopes change by a fixed step (usually `1`) at each breakpoint in the classic problems, you do not even need to store the slopes — just the breakpoint positions, with multiplicity. The natural containers are two **priority queues (heaps)**: a **max-heap on the left** (its top is the rightmost left-breakpoint, i.e. where the minimum region begins) and a **min-heap on the right** (its top is the leftmost right-breakpoint, where the minimum region ends).

The magic is that the DP transitions you actually need — "add a penalty `|x − a|`", "add a one-sided penalty", "let earlier values relax", "shift the whole function" — each correspond to a *tiny* heap operation: push a value, pop a value, add a lazy offset. Each costs `O(log n)`, so an `n`-step DP runs in `O(n log n)`. That is Slope Trick: **a convex function carried implicitly as two heaps of breakpoints**.

This topic sits in the DP-optimization family right next to **Convex Hull Trick / Li Chao** (sibling `10`). Both exploit convexity, but they optimize *different shapes*: CHT speeds up a transition that is a **minimum over straight lines** (`dp[i] = min_j(m_j·x + b_j)`), whereas Slope Trick maintains a **single convex function that mutates step by step**. We compare them carefully throughout these files.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **The equation of a line and its slope** — `y = m·x + b`; what "slope" means (rise over run).
- **Piecewise functions** — a function defined by different formulas on different intervals.
- **Absolute value** — `|x − a|` is a V-shaped function with its point at `x = a`.
- **Priority queues / heaps** — a min-heap returns the smallest element; a max-heap the largest; push and pop are `O(log n)`.
- **Basic dynamic programming** — carrying a state forward across steps.
- **Big-O notation** — `O(n²)`, `O(n log n)`.

Optional but helpful:

- A glance at **convexity** (a function whose slope is non-decreasing).
- Familiarity with the classic problem "make an array non-decreasing / non-increasing with minimum cost".

---

## Glossary

| Term | Meaning |
|------|---------|
| **Convex function** | A function that bends only upward; its slope never decreases as `x` increases. A valley shape. |
| **Piecewise-linear (PL)** | A function made of straight line segments joined at breakpoints. |
| **Breakpoint** | An `x` where the slope of the PL function changes. |
| **Slope Trick** | Maintaining a convex PL function implicitly by its breakpoints (in two heaps) plus its minimum value. |
| **Left heap (`L`)** | A **max-heap** of breakpoints to the left of (and at the left edge of) the minimum region. Its top is the argmin's left boundary. |
| **Right heap (`R`)** | A **min-heap** of breakpoints to the right of the minimum region. Its top is the argmin's right boundary. |
| **`minVal`** | The minimum value of the current function `f` (the valley floor height). |
| **`add |x − a|`** | The core operation: add a V-shaped penalty centered at `a` to the current function. |
| **One-sided penalty** | `(x − a)_+ = max(x − a, 0)` or `(a − x)_+ = max(a − x, 0)`; a penalty that only kicks in on one side. |
| **Prefix-min / relaxation** | Replacing `f(x)` with `min_{y ≤ x} f(y)` (lets the value "slide right freely"); flattens the right side. |
| **Lazy offset / shift** | A pending `+c` added to every breakpoint in a heap, applied without touching each element (used when the function shifts horizontally). |
| **Argmin region** | The flat interval `[L.top, R.top]` where `f` attains its minimum (it can be a single point). |

---

## Core Concepts

### 1. A Convex PL Function = `minVal` + Two Heaps of Breakpoints

Picture a convex piecewise-linear function as a valley. To its left the slope is negative (going down), reaches `0` at the bottom (a flat valley floor, possibly a single point), then becomes positive (going up). At each breakpoint the slope increases by some integer step — in the classic problems, by exactly `1`.

So the function is determined by:

- `minVal` — the height of the valley floor,
- the breakpoints on the **descending** side (left of the floor), and
- the breakpoints on the **ascending** side (right of the floor).

We keep the left breakpoints in a **max-heap `L`** (so `L.top()` is the *rightmost* left-breakpoint = the left edge of the floor) and the right breakpoints in a **min-heap `R`** (so `R.top()` is the *leftmost* right-breakpoint = the right edge of the floor). The flat minimum region is exactly `[L.top(), R.top()]`.

If each slope step is `1`, then the segment immediately left of the floor has slope `−1`, the one before that `−2`, and so on; a breakpoint that appears `k` times in `L` means the slope changes by `k` there. The heaps store breakpoints *with multiplicity* — a repeated value just sits in the heap multiple times.

### 2. The Core Operation: `add |x − a|`

Adding `|x − a|` to a convex function keeps it convex (a V is convex, and the sum of convex functions is convex). The V has slope `−1` left of `a` and `+1` right of `a`. The effect on our representation is beautifully simple:

- Push `a` into the **left** heap `L` and `a` into the **right** heap `R` — the new breakpoint sits on both sides of `a`.
- But this might place a value into the wrong heap (if `a` is left of the current floor, it should not also be a right-breakpoint). To fix it, after pushing we **rebalance**: if `L.top() > R.top()`, the heaps overlap incorrectly; pop both tops, the amount they cross by adds to `minVal`, and push them back swapped.

The classic recipe for `add |x − a|` (covered in detail in [`middle.md`](./middle.md)) is:

```
push a into L; push a into R
if L.top() > R.top():
    l = L.pop(); r = R.pop()
    minVal += l - r        // the V lifted the floor by this much
    push r into L; push l into R
```

### 3. One-Sided Penalties

Sometimes you only want to penalize on *one* side: `(x − a)_+ = max(x − a, 0)` (penalize when `x` exceeds `a`) or `(a − x)_+ = max(a − x, 0)` (penalize when `x` is below `a`). These add a single breakpoint to one heap only, with a possible rebalance. They are the building blocks for asymmetric costs (e.g. "going up is free but going down costs").

### 4. Prefix-Minimum Relaxation

The operation `f(x) ← min_{y ≤ x} f(y)` makes the value free to "slide to the right": once the function has reached its minimum, everything to the right is pulled down to that minimum, erasing the ascending side. In the representation, this just means **clearing the right heap `R`** (delete all right-breakpoints). The mirror operation `min_{y ≥ x} f(y)` clears the left heap. This is exactly what the "make non-decreasing" DP needs: after committing a value, later positions may be anything `≥` it, so the right side flattens.

### 5. Shifting the Function (Lazy Tags)

Some transitions shift the function horizontally: `f(x) ← f(x − c)` (move right by `c`) or widen the floor. Rather than touch every breakpoint, attach a **lazy offset** to each heap: a single number added to (or subtracted from) every value when read. This keeps shifts `O(1)`. The non-decreasing problem does not need shifts, but the "make *strictly* increasing" variant and many scheduling problems do.

### 6. Min vs Max (Concave Variant)

Everything above maintains a function for a **minimization** DP, where `f` is **convex**. If your DP maximizes and the carried function is **concave**, mirror the whole thing (negate, or flip every min/max and heap direction). Convexity is mandatory — Slope Trick simply does not apply to a function that is not convex (or concave). This is the single most important precondition.

---

## Big-O Summary

Let `n` be the number of DP steps (e.g. array length). Each step performs a constant number of heap operations.

| Operation | Cost | Notes |
|-----------|------|-------|
| `add |x − a|` | `O(log n)` | 2 pushes + at most 1 rebalance (2 pops, 2 pushes) |
| One-sided penalty `(x−a)_+` / `(a−x)_+` | `O(log n)` | 1 push + at most 1 rebalance |
| Prefix-min relaxation (clear one side) | `O(1)` amortized | clear a heap (or stop pushing into it) |
| Shift by `c` (lazy tag) | `O(1)` | adjust a single offset |
| Read `minVal` | `O(1)` | the maintained minimum |
| Read the argmin position | `O(1)` | `L.top()` (or `R.top()`) |
| **Whole DP (`n` steps)** | **`O(n log n)`** | vs `O(n · range)` or `O(n²)` naive |

The headline: a DP that would otherwise need an `O(range)` table per step (or an `O(n²)` double loop) collapses to `O(n log n)`, because the convex function is carried as a logarithmic-cost heap pair.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Convex PL cost function | The total fuel cost as a function of a thermostat setpoint: too low or too high both cost more, with a comfortable cheapest zone in the middle. |
| `minVal` (valley floor) | The cheapest possible bill if you could pick the perfect setpoint. |
| Breakpoints | The temperatures where the pricing tier changes (each extra degree away costs one more unit). |
| Left heap / right heap | Two sorted piles of "tier boundaries", one for the cold side, one for the hot side; you only ever look at the innermost boundary of each. |
| `add |x − a|` | A new tenant arrives who is happiest at temperature `a` and complains (costs one unit) for each degree away — folding their preference into the shared bill. |
| Prefix-min relaxation | A rule like "you may always overshoot upward for free" — so the hot-side penalties vanish. |
| Lazy shift | Relabeling every boundary by the same offset without walking the pile, because the whole comfort zone moved. |

Where the analogy breaks: real pricing tiers need not be convex, but Slope Trick *requires* convexity — if penalties could make some middle temperature cheaper than its neighbors in a non-convex way, the two-heap trick collapses.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Turns an `O(n·range)` or `O(n²)` function-valued DP into `O(n log n)`. | Requires the carried function to be **convex (or concave)** PL — a hard precondition. |
| Tiny code: two heaps, a `minVal`, maybe two lazy offsets. | The convexity must be *proved*, not assumed; it is easy to apply where it does not hold. |
| Each transition is a couple of heap operations — easy to reason about. | The set of supported operations is fixed (|x−a|, one-sided, prefix-min, shift); arbitrary edits break it. |
| Memory is `O(n)` (just the breakpoints), independent of the value range. | Reconstructing the *actual chosen values* (not just the cost) needs extra bookkeeping. |
| Integer-exact: no floating point anywhere in the classic problems. | Off-by-one between "non-decreasing" and "strictly increasing" is a classic trap. |

**When to use:** a 1D DP whose state is a convex PL cost function, updated step by step with `|x−a|`-style penalties, prefix-min relaxations, and shifts — especially "make sequence monotone with minimum cost", equalization, and certain scheduling problems, with large `n` (`10⁵`–`10⁶`).

**When NOT to use:** the carried function is not convex; the transition cannot be expressed via the supported operations; the problem is better served by Convex Hull Trick (a min over *lines*, not a single mutating function), or by ordinary `O(n·range)` DP when the range is small.

---

## Step-by-Step Walkthrough

Let us solve, by hand, the canonical problem on a tiny array.

**Problem (min steps to non-decreasing).** Given `a = [3, 1, 2]`, choose a non-decreasing array `b` (`b_1 ≤ b_2 ≤ b_3`) minimizing `Σ |a_i − b_i|`. The answer is the famous "Codeforces 713C / slope-trick" cost (here for the *non-decreasing* variant).

We carry `f_i(x)` = minimum cost to process the first `i` elements such that `b_i = x`, but maintained convexly. The transition from `f_{i-1}` to `f_i` is:

1. **Relax** so the value can stay the same or rise: `g(x) = min_{y ≤ x} f_{i-1}(y)` — clears the right heap (later `b` may be `≥` earlier `b`).
2. **Add the penalty** `|x − a_i|` for matching this element.

Start: `f_0 ≡ 0`, an empty function. `L` and `R` empty, `minVal = 0`.

**Process `a_1 = 3`.** Relax (no-op on an empty function). Add `|x − 3|`:
- Push `3` into `L` and `3` into `R`. `L.top() = 3`, `R.top() = 3`, no overlap.
- `minVal` stays `0`. The valley floor is at `x = 3`, value `0`.
- Heaps: `L = [3]`, `R = [3]`.

**Process `a_2 = 1`.** Relax (clear `R`, since later values may exceed): `R = []`. Now the function is non-increasing then flat (slope `−1` left of `3`, then `0` for `x ≥ 3`). Add `|x − 1|`:
- Push `1` into `L` and `1` into `R`. Now `L = [3, 1]` (max-heap top `3`), `R = [1]`.
- Check overlap: `L.top() = 3 > R.top() = 1`. Overlap! Pop both: `l = 3`, `r = 1`.
- `minVal += l − r = 3 − 1 = 2`. Push swapped: `1` into `L`, `3` into `R`.
- Heaps: `L = [1, 1]` (top `1`), `R = [3]`. `minVal = 2`.
- Interpretation: the cheapest is to set `b_1 = b_2 = 1` (lower the `3` down to `1`, cost `2`), valley floor at `x = 1`, cost `2`. Correct so far: `b = [1, 1, ...]` costs `|3−1| = 2`.

**Process `a_3 = 2`.** Relax (clear `R`): `R = []`. Add `|x − 2|`:
- Push `2` into `L` and `2` into `R`. `L = [1, 1, 2]` (top `2`), `R = [2]`.
- Check overlap: `L.top() = 2 = R.top() = 2`, no strict overlap.
- `minVal` stays `2`.

**Answer:** `minVal = 2`. Check by brute force: choose `b = [1,1,2]` → cost `|3−1|+|1−1|+|2−2| = 2 + 0 + 0 = 2`. Optimal. The Slope Trick carried the entire convex cost surface through three steps using only pushes, one rebalance, and a `minVal` increment.

This walkthrough shows the **two-line transition** of the non-decreasing problem: *clear the right heap (relax), then add `|x − a_i|`*. The minimum value accumulates exactly the optimal cost. The code below makes this precise and validates it against a brute-force oracle.

---

## Code Examples

### Example: Minimum Cost to Make an Array Non-Decreasing

We maintain `f(x)` implicitly. Because we *relax* (clear the right heap) before each `add |x − a_i|`, the right heap stays empty and we only ever need the **left max-heap** plus `minVal`. The transition for each `a_i` becomes: push `a_i`; if the new top exceeds `a_i`, pull it down and pay the difference. We include the brute-force oracle so the columns always match.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

// maxHeap is a max-heap of int64.
type maxHeap []int64

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i] > h[j] } // max on top
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(int64)) }
func (h *maxHeap) Pop() interface{} {
	old := *h
	n := len(old)
	v := old[n-1]
	*h = old[:n-1]
	return v
}

// minCostNonDecreasing returns the minimum sum of |a_i - b_i| over
// all non-decreasing b. Slope Trick with a single left max-heap.
func minCostNonDecreasing(a []int64) int64 {
	L := &maxHeap{}
	heap.Init(L)
	var cost int64 = 0
	for _, v := range a {
		heap.Push(L, v)
		if (*L)[0] > v { // the new top is above a_i: pull it down to v
			top := heap.Pop(L).(int64)
			cost += top - v
			heap.Push(L, v)
		}
	}
	return cost
}

// bruteForce: O(n * V^2) DP oracle over a small value range.
func bruteForce(a []int64) int64 {
	// values are small in tests; clamp to [0, 50]
	const V = 60
	prev := make([]int64, V)
	for x := 0; x < V; x++ {
		prev[x] = abs64(a[0] - int64(x))
	}
	for i := 1; i < len(a); i++ {
		cur := make([]int64, V)
		best := int64(1 << 60)
		for x := 0; x < V; x++ {
			if prev[x] < best {
				best = prev[x] // best over y <= x (non-decreasing)
			}
			cur[x] = best + abs64(a[i]-int64(x))
		}
		prev = cur
	}
	ans := int64(1 << 60)
	for _, v := range prev {
		if v < ans {
			ans = v
		}
	}
	return ans
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	tests := [][]int64{{3, 1, 2}, {5, 4, 3, 2, 1}, {1, 2, 3}, {2, 2, 1, 1, 1}}
	for _, t := range tests {
		fmt.Printf("a=%v  slope=%d  brute=%d\n", t, minCostNonDecreasing(t), bruteForce(t))
	}
}
```

#### Java

```java
import java.util.*;

public class SlopeTrick {
    // Minimum sum of |a_i - b_i| over non-decreasing b. Single left max-heap.
    static long minCostNonDecreasing(long[] a) {
        PriorityQueue<Long> L = new PriorityQueue<>(Collections.reverseOrder()); // max-heap
        long cost = 0;
        for (long v : a) {
            L.add(v);
            if (L.peek() > v) {       // top above a_i: pull it down
                long top = L.poll();
                cost += top - v;
                L.add(v);
            }
        }
        return cost;
    }

    // O(n * V) DP oracle over a small value range.
    static long bruteForce(long[] a) {
        final int V = 60;
        long[] prev = new long[V];
        for (int x = 0; x < V; x++) prev[x] = Math.abs(a[0] - x);
        for (int i = 1; i < a.length; i++) {
            long[] cur = new long[V];
            long best = Long.MAX_VALUE / 4;
            for (int x = 0; x < V; x++) {
                best = Math.min(best, prev[x]);   // min over y <= x
                cur[x] = best + Math.abs(a[i] - x);
            }
            prev = cur;
        }
        long ans = Long.MAX_VALUE / 4;
        for (long v : prev) ans = Math.min(ans, v);
        return ans;
    }

    public static void main(String[] args) {
        long[][] tests = {{3, 1, 2}, {5, 4, 3, 2, 1}, {1, 2, 3}, {2, 2, 1, 1, 1}};
        for (long[] t : tests)
            System.out.println("a=" + Arrays.toString(t)
                + " slope=" + minCostNonDecreasing(t)
                + " brute=" + bruteForce(t));
    }
}
```

#### Python

```python
import heapq


def min_cost_non_decreasing(a):
    """Minimum sum of |a_i - b_i| over non-decreasing b.
    Slope Trick with a single left max-heap (stored as negatives)."""
    L = []          # max-heap via negation
    cost = 0
    for v in a:
        heapq.heappush(L, -v)
        if -L[0] > v:               # current top above a_i
            top = -heapq.heappop(L)
            cost += top - v
            heapq.heappush(L, -v)
    return cost


def brute_force(a):
    """O(n * V) DP oracle over a small value range."""
    V = 60
    prev = [abs(a[0] - x) for x in range(V)]
    for i in range(1, len(a)):
        cur = [0] * V
        best = float("inf")
        for x in range(V):
            best = min(best, prev[x])   # min over y <= x
            cur[x] = best + abs(a[i] - x)
        prev = cur
    return min(prev)


if __name__ == "__main__":
    tests = [[3, 1, 2], [5, 4, 3, 2, 1], [1, 2, 3], [2, 2, 1, 1, 1]]
    for t in tests:
        print(f"a={t} slope={min_cost_non_decreasing(t)} brute={brute_force(t)}")
```

**What it does:** runs the Slope Trick non-decreasing DP and the brute-force `O(n·range)` oracle on several arrays; the `slope` and `brute` columns always agree.
**Run:** `go run main.go` | `javac SlopeTrick.java && java SlopeTrick` | `python slope.py`

---

## Coding Patterns

### Pattern 1: The Brute-Force Oracle (test against this first)

**Intent:** Before trusting any Slope Trick code, compute the same answer with a slow but obviously-correct `O(n·range)` DP and verify they agree on random small inputs.

```python
def brute_force(a):
    V = 60
    prev = [abs(a[0] - x) for x in range(V)]
    for i in range(1, len(a)):
        best = float("inf")
        cur = []
        for x in range(V):
            best = min(best, prev[x])      # non-decreasing relaxation
            cur.append(best + abs(a[i] - x))
        prev = cur
    return min(prev)
```

This is far too slow for the real input (the value range may be huge), but it is the gold standard for correctness on small random tests.

### Pattern 2: The `add |x − a|` Primitive

**Intent:** The reusable two-heap operation that folds a V-shaped penalty into the carried convex function.

```text
push a into L (max-heap)
push a into R (min-heap)
if L.top() > R.top():
    l = L.pop(); r = R.pop()
    minVal += l - r
    push r into L; push l into R
```

For the *non-decreasing* problem we relax first (clear `R`), so `R` stays empty and this simplifies to "push `a` into `L`; if `L.top() > a`, pop it, pay `top − a`, push `a`."

### Pattern 3: Relax = Clear One Heap

**Intent:** Implement `f(x) ← min_{y ≤ x} f(y)` (value may rise freely) by deleting all right-breakpoints.

```text
non-decreasing transition for a_i:
    clear R              # later b may be >= current b
    add |x - a_i|
```

```mermaid
graph TD
    A["f_(i-1)(x): convex valley<br/>(L max-heap, R min-heap, minVal)"] -->|relax: clear R| B["min over y<=x of f<br/>(right side flattened)"]
    B -->|add |x - a_i|| C["push a_i to L and R<br/>rebalance if L.top > R.top"]
    C --> D["f_i(x): new convex valley<br/>minVal updated"]
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong (too large) cost | Used a min-heap where a max-heap was needed for `L` (or vice versa). | `L` is a **max-heap** (rightmost left-breakpoint on top); `R` is a **min-heap**. |
| Off-by-one between non-decreasing and strictly increasing | Forgot the `b_i ≥ b_{i-1} + 1` shift for the strict variant. | Subtract `i` (or add an index offset) to reduce strict to non-strict; see [`middle.md`](./middle.md). |
| Negative or wrong `minVal` | Rebalanced without adding `l − r` to `minVal`. | Every time the tops cross, `minVal += L.top − R.top` *before* swapping. |
| Overflow | Summed costs exceed 32-bit. | Use `int64` / `long`; costs can reach `n · maxValue`. |
| Pushed into a heap you already cleared | Relaxed (cleared `R`) but then read `R.top()` on an empty heap. | Guard empty heaps; in the non-decreasing problem only `L` is used after relaxation. |
| Applied Slope Trick to a non-convex function | The carried function is not convex. | Prove convexity first; Slope Trick is invalid otherwise. |

---

## Performance Tips

- **Use the language's built-in heap** (`container/heap`, `PriorityQueue`, `heapq`) — they are well-tuned and `O(log n)`.
- **In Python, store negatives** in `heapq` to get a max-heap, rather than wrapping in a class.
- **Collapse to a single heap when you relax every step** — the non-decreasing problem never needs `R` after the clear, halving the work.
- **Read `minVal` directly** — never recompute the minimum by scanning; it is maintained incrementally.
- **Avoid per-element shifts** — when the function moves horizontally, use a lazy offset (one integer), not a loop over the heap.
- **Reserve heap capacity** up front if you know `n`, to avoid reallocations in the hot loop.

---

## Best Practices

- Always write and run the brute-force oracle (Pattern 1) on random small inputs before trusting the fast version.
- State your convention in a comment: "`L` = max-heap of left breakpoints, `R` = min-heap of right breakpoints, `minVal` = current minimum."
- Keep `add |x − a|`, the relaxation, and the shift as small, separately testable helpers.
- For the strictly-increasing variant, transform `a_i ← a_i − i` *before* running the non-decreasing routine, and document why.
- Use `int64`/`long` for `minVal` and all breakpoints; costs accumulate.
- Prove (or at least sketch) that the carried function is convex before reaching for Slope Trick — this is the precondition that everything depends on.

---

## Edge Cases & Pitfalls

- **Single element** — the cost is `0` (set `b_1 = a_1`); the heap holds one breakpoint, `minVal = 0`.
- **Already non-decreasing input** — the answer is `0`; no rebalance ever fires.
- **Strictly decreasing input** — every step rebalances; the answer is the full "flatten to a constant" cost.
- **Duplicates in `a`** — handled naturally; equal breakpoints just sit in the heap multiple times.
- **Large value range** — irrelevant to Slope Trick (memory is `O(n)`), but it is what *kills* the naive `O(n·range)` DP.
- **Strict vs non-strict** — `b_i ≤ b_{i+1}` (non-decreasing) vs `b_i < b_{i+1}` (strictly increasing) need different preprocessing; mixing them is a top bug.
- **Empty array** — define the cost as `0`; guard before touching the heaps.

---

## Common Mistakes

1. **Wrong heap direction** — `L` must be a max-heap and `R` a min-heap; swapping them silently produces wrong answers.
2. **Forgetting to add `l − r` to `minVal`** on a rebalance — the cost then under-counts.
3. **Applying Slope Trick to a non-convex function** — the two-heap representation is only valid for convex (or concave) PL functions.
4. **Confusing non-decreasing with strictly increasing** — forgetting the `−i` transform.
5. **Recomputing the minimum by scanning** instead of reading the maintained `minVal`.
6. **Integer overflow** — costs reach `n · maxValue`; use 64-bit.
7. **Reading an empty heap** after a relaxation cleared it.

---

## Cheat Sheet

| Operation | Effect on representation | Cost |
|-----------|--------------------------|------|
| `add |x − a|` | push `a` to `L` and `R`; rebalance if `L.top > R.top`, add cross to `minVal` | `O(log n)` |
| `(x − a)_+` (penalize above `a`) | push to one side only; rebalance | `O(log n)` |
| `(a − x)_+` (penalize below `a`) | push to the other side; rebalance | `O(log n)` |
| Relax `min_{y ≤ x} f` | clear `R` | `O(1)` amortized |
| Relax `min_{y ≥ x} f` | clear `L` | `O(1)` amortized |
| Shift right by `c` | add lazy offset to both heaps | `O(1)` |
| Read minimum | `minVal` | `O(1)` |

Non-decreasing problem (single heap):

```
for each a_i:
    clear R (relax)           # later b may be larger
    push a_i into L
    if L.top() > a_i:
        cost += L.pop() - a_i
        push a_i into L
answer = cost
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The convex piecewise-linear function `f(x)` drawn as a **polyline** (a valley).
> - The **left heap** and **right heap** of breakpoints shown as two stacks, with their tops marking the flat minimum region.
> - The running **`minVal`** (valley floor height).
> - An **`add |x − a|`** step pushing breakpoints and rebalancing.
> - A **prefix-min** step flattening the right side (clearing the right heap).
> - Step / Play / Pause / Reset controls to watch the function mutate.

---

## Summary

Slope Trick maintains a **convex piecewise-linear cost function** through the steps of a DP without ever storing the whole function — only its **minimum value** and its **breakpoints**, split into a left max-heap and a right min-heap. The handful of transitions you need — `add |x − a|`, one-sided penalties, prefix-min relaxation (clearing a heap), and lazy shifts — each cost `O(log n)`, so an `n`-step DP runs in `O(n log n)`. The canonical application is "minimum total cost to make an array non-decreasing", where each step is just *relax (clear the right heap) then add `|x − a_i|`*, accumulating the optimal cost in `minVal`. The non-negotiable precondition is **convexity**: the trick is exact for convex (or, mirrored, concave) functions and invalid otherwise. The two rules to never forget: keep `L` a max-heap and `R` a min-heap, and always validate against a brute-force `O(n·range)` DP oracle on small inputs.

---

## Further Reading

- Codeforces blog — "Slope Trick: Explanation and Examples" (kostia244 / zscoder).
- Codeforces 713C "Sonya and Problem Without a Legend" — the strictly-increasing variant.
- USACO Guide — "Slope Trick" module (Platinum).
- *Competitive Programmer's Handbook* (Laaksonen) — convex functions and DP optimization.
- Sibling topic `10-convex-hull-trick-li-chao` — minimizing over **lines** (a different convex transition shape).

---

Next step: [`middle.md`](./middle.md) — the full operation catalog (`|x−a|`, one-sided, prefix-min, shift), lazy tags, and when each applies.
