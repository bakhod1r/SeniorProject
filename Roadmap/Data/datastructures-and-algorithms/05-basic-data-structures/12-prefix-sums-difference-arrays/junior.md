# Prefix Sums & Difference Arrays — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Running-Total Intuition](#the-running-total-intuition)
3. [What is a Prefix Sum?](#what-is-a-prefix-sum)
4. [Range-Sum Query in O(1)](#range-sum-query-in-o1)
5. [Off-by-One: The Indexing Convention](#off-by-one-the-indexing-convention)
6. [Visual Diagrams](#visual-diagrams)
7. [Code Examples — 1D Prefix Sum](#code-examples--1d-prefix-sum)
   - [Go](#go-implementation)
   - [Java](#java-implementation)
   - [Python](#python-implementation)
8. [Pattern 1 — Subarray Sum Equals K](#pattern-1--subarray-sum-equals-k)
9. [What is a Difference Array?](#what-is-a-difference-array)
10. [Pattern 2 — Range Updates with Difference Arrays](#pattern-2--range-updates-with-difference-arrays)
11. [Big-O Summary](#big-o-summary)
12. [Real-World Analogies](#real-world-analogies)
13. [Pros and Cons](#pros-and-cons)
14. [Common Mistakes](#common-mistakes)
15. [Cheat Sheet](#cheat-sheet)
16. [Visual Animation](#visual-animation)
17. [Summary](#summary)

---

## Introduction

A **prefix sum** is one of those tiny techniques that feels obvious once you see it, then turns out to solve dozens of problems. It is a precomputed running total of an array. After spending O(n) once to build it, you can answer any "what is the sum of elements between index l and r?" question in **O(1)** — no loop required.

Its mirror twin is the **difference array**. Where prefix sums let you read a range fast, difference arrays let you *write* to a range fast. Add +5 to every element from index 3 to index 9? One operation, O(1), no loop. Then a single pass reconstructs the final array.

Together, these two techniques are the foundation for many array problems and a stepping stone toward more powerful structures like Fenwick trees and segment trees.

---

## The Running-Total Intuition

Imagine you are tracking the temperature each day for a week:

```
Day:        Mon  Tue  Wed  Thu  Fri  Sat  Sun
Temp (a):   21   23   19   25   28   24   20
```

Someone asks: "What was the total temperature from Tuesday to Friday?" You add `23 + 19 + 25 + 28 = 95`. Four additions. Easy.

But what if a thousand such questions arrive? You would repeat similar work over and over. A smarter approach: build a **running total** once.

```
Day:        Mon  Tue  Wed  Thu  Fri  Sat  Sun
Temp (a):   21   23   19   25   28   24   20
Total(p):   21   44   63   88   116  140  160
```

Now `Tue..Fri` is just `116 - 21 = 95`. One subtraction. The running total turned every future query into constant-time arithmetic.

That running total is a **prefix sum**.

---

## What is a Prefix Sum?

Formally: given an array `a` of length `n`, the prefix-sum array `prefix` has length `n + 1` and is defined as:

```text
prefix[0] = 0
prefix[i] = a[0] + a[1] + ... + a[i-1]    for i = 1..n
```

So `prefix[i]` is the sum of the first `i` elements (the first `i` elements before index `i`). Note that `prefix[0] = 0` — this is a deliberate **sentinel** that makes the math symmetric and avoids special-casing the empty prefix.

Example with `a = [3, 1, 4, 1, 5, 9, 2, 6]`:

```text
i:        0  1  2  3  4  5  6  7  8
prefix:   0  3  4  8  9  14 23 25 31
                  ^                ^
                  |                |
                  prefix[3] = 3+1+4 = 8
                                  prefix[8] = total sum = 31
```

---

## Range-Sum Query in O(1)

The whole point: once `prefix` is built, the sum of any subarray `a[l..r]` (inclusive on both ends) is:

```text
sum(a[l..r]) = prefix[r+1] - prefix[l]
```

Why? `prefix[r+1]` is everything from `a[0]` through `a[r]`. Subtracting `prefix[l]` removes `a[0]` through `a[l-1]`, leaving exactly `a[l] + a[l+1] + ... + a[r]`.

Example: `sum(a[2..5])` for `a = [3, 1, 4, 1, 5, 9, 2, 6]`:

```text
prefix[6] - prefix[2] = 23 - 4 = 19
Check: a[2] + a[3] + a[4] + a[5] = 4 + 1 + 5 + 9 = 19   OK
```

The build costs O(n) and uses O(n) extra memory. After that, every range query is O(1) regardless of how wide the range is.

---

## Off-by-One: The Indexing Convention

The single most common bug is mixing up `prefix[i]` vs `prefix[i+1]`. Two conventions are common in textbooks:

**Convention A (used here):** `prefix` has length `n + 1`, `prefix[0] = 0`, and `sum(a[l..r]) = prefix[r+1] - prefix[l]`.

**Convention B:** `prefix` has length `n`, `prefix[i] = a[0] + ... + a[i]`, and `sum(a[l..r]) = prefix[r] - prefix[l-1]` (with a special case for `l == 0`).

Convention A is strictly better because it eliminates the special case. Always favor it. The mantra: **`prefix` has one extra slot**.

---

## Visual Diagrams

The shaded region below visualizes the subtraction:

```text
Index:        0    1    2    3    4    5    6    7
Array a:    [ 3 ][ 1 ][ 4 ][ 1 ][ 5 ][ 9 ][ 2 ][ 6 ]

Want sum of a[2..5]:
                      |<------- this region ------>|
                      [ 4 ][ 1 ][ 5 ][ 9 ]

prefix[6]  covers:   [ 3 ][ 1 ][ 4 ][ 1 ][ 5 ][ 9 ]   = 23
prefix[2]  covers:   [ 3 ][ 1 ]                       = 4
prefix[6] - prefix[2] removes the leading [3][1]      = 19
```

---

## Code Examples — 1D Prefix Sum

### Go Implementation

```go
package prefix

// BuildPrefix returns prefix[] such that prefix[i] = a[0]+...+a[i-1].
// Length is len(a) + 1 with prefix[0] = 0.
// Time: O(n).  Space: O(n).
func BuildPrefix(a []int) []int {
	n := len(a)
	prefix := make([]int, n+1) // prefix[0] = 0 by default
	for i := 0; i < n; i++ {
		prefix[i+1] = prefix[i] + a[i]
	}
	return prefix
}

// RangeSum returns sum of a[l..r] inclusive in O(1).
// Precondition: 0 <= l <= r < len(a).
func RangeSum(prefix []int, l, r int) int {
	return prefix[r+1] - prefix[l]
}

// Usage:
// a := []int{3, 1, 4, 1, 5, 9, 2, 6}
// p := BuildPrefix(a)
// fmt.Println(RangeSum(p, 2, 5))  // 19
```

### Java Implementation

```java
public class PrefixSum {

    /**
     * Builds prefix[] of length n+1 where prefix[i] = a[0] + ... + a[i-1].
     * Uses long to guard against overflow on large sums.
     * Time: O(n). Space: O(n).
     */
    public static long[] buildPrefix(int[] a) {
        int n = a.length;
        long[] prefix = new long[n + 1]; // prefix[0] = 0 by default
        for (int i = 0; i < n; i++) {
            prefix[i + 1] = prefix[i] + a[i];
        }
        return prefix;
    }

    /**
     * Returns sum of a[l..r] inclusive in O(1).
     * Precondition: 0 <= l <= r < a.length
     */
    public static long rangeSum(long[] prefix, int l, int r) {
        return prefix[r + 1] - prefix[l];
    }

    public static void main(String[] args) {
        int[] a = {3, 1, 4, 1, 5, 9, 2, 6};
        long[] p = buildPrefix(a);
        System.out.println(rangeSum(p, 2, 5)); // 19
    }
}
```

### Python Implementation

```python
"""1D prefix sums with O(1) range queries."""

from typing import List


def build_prefix(a: List[int]) -> List[int]:
    """Return prefix[] of length n+1 with prefix[i] = a[0] + ... + a[i-1].

    Time: O(n). Space: O(n).
    """
    n = len(a)
    prefix = [0] * (n + 1)
    for i in range(n):
        prefix[i + 1] = prefix[i] + a[i]
    return prefix


def range_sum(prefix: List[int], l: int, r: int) -> int:
    """Return sum of a[l..r] inclusive in O(1).

    Precondition: 0 <= l <= r < len(a)
    """
    return prefix[r + 1] - prefix[l]


if __name__ == "__main__":
    a = [3, 1, 4, 1, 5, 9, 2, 6]
    p = build_prefix(a)
    print(range_sum(p, 2, 5))  # 19
```

**What it does:** Builds the running-total array in a single pass, then answers any range-sum query with one subtraction.

---

## Pattern 1 — Subarray Sum Equals K

A classic interview problem: given an array of integers and a target `k`, count how many contiguous subarrays sum to `k`.

Brute force: try every `(l, r)` pair — O(n^2). Better: prefix sums plus a hash map of counts.

**Key insight:** the subarray `a[l..r]` sums to `k` exactly when `prefix[r+1] - prefix[l] == k`, i.e. `prefix[l] == prefix[r+1] - k`. While scanning `r`, count how many previous prefix values equal `prefix[r+1] - k`.

#### Go

```go
package prefix

// SubarraySumK returns the number of contiguous subarrays summing to k.
// Time: O(n). Space: O(n).
func SubarraySumK(a []int, k int) int {
	count := 0
	running := 0
	seen := map[int]int{0: 1} // prefix=0 has been seen once (empty prefix)
	for _, v := range a {
		running += v
		if c, ok := seen[running-k]; ok {
			count += c
		}
		seen[running]++
	}
	return count
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class SubarraySum {
    /** Counts contiguous subarrays summing to k. Time: O(n). */
    public static int subarraySumK(int[] a, int k) {
        int count = 0, running = 0;
        Map<Integer, Integer> seen = new HashMap<>();
        seen.put(0, 1); // empty prefix
        for (int v : a) {
            running += v;
            count += seen.getOrDefault(running - k, 0);
            seen.merge(running, 1, Integer::sum);
        }
        return count;
    }
}
```

#### Python

```python
from collections import defaultdict
from typing import List


def subarray_sum_k(a: List[int], k: int) -> int:
    """Count contiguous subarrays summing to k. Time: O(n)."""
    count = 0
    running = 0
    seen = defaultdict(int)
    seen[0] = 1  # empty prefix
    for v in a:
        running += v
        count += seen[running - k]
        seen[running] += 1
    return count
```

**Why a hash map and not sliding window?** Sliding window requires the running sum to grow monotonically when you extend the right end and shrink it when you advance the left. With negative numbers (or zero target), that monotonicity breaks. The hash map of prefix counts handles all cases uniformly.

---

## What is a Difference Array?

A **difference array** is the inverse of a prefix sum. Given `a`, define:

```text
diff[0] = a[0]
diff[i] = a[i] - a[i-1]    for i = 1..n-1
```

So `diff` stores how each element differs from its predecessor. Reconstructing `a` is the prefix sum of `diff`:

```text
a[i] = diff[0] + diff[1] + ... + diff[i]
```

The magic: adding a value `v` to every element of `a[l..r]` can be done by **two updates on `diff`**.

```text
add v to a[l..r]   <=>   diff[l] += v ;  diff[r+1] -= v
```

Why? After the change, the difference between `a[l]` and `a[l-1]` increases by `v` (so `diff[l] += v`), and the difference between `a[r+1]` and `a[r]` decreases by `v` (so `diff[r+1] -= v`). Every element inside `[l..r]` is shifted up by `v` exactly once when we reconstruct.

---

## Pattern 2 — Range Updates with Difference Arrays

When you face many range-update operations followed by a single read of the final state (offline updates), difference arrays shine. Each update is O(1); the final reconstruction is O(n).

#### Go

```go
package prefix

// ApplyRangeUpdates takes initial array a and a list of (l, r, v) updates,
// each adding v to every a[l..r]. Returns the final array.
// Time: O(n + u) where u = number of updates.
func ApplyRangeUpdates(a []int, updates [][3]int) []int {
	n := len(a)
	diff := make([]int, n+1) // extra slot so diff[r+1] is always valid
	for _, u := range updates {
		l, r, v := u[0], u[1], u[2]
		diff[l] += v
		diff[r+1] -= v
	}
	// Reconstruct: a[i] += running prefix of diff[0..i].
	running := 0
	result := make([]int, n)
	for i := 0; i < n; i++ {
		running += diff[i]
		result[i] = a[i] + running
	}
	return result
}
```

#### Java

```java
public class DifferenceArray {
    /**
     * Applies many range +v updates to a, returns final array.
     * Each update is O(1); reconstruction is O(n).
     * updates[k] = {l, r, v}.
     */
    public static int[] applyRangeUpdates(int[] a, int[][] updates) {
        int n = a.length;
        int[] diff = new int[n + 1]; // sentinel slot at index n
        for (int[] u : updates) {
            int l = u[0], r = u[1], v = u[2];
            diff[l] += v;
            diff[r + 1] -= v;
        }
        int[] result = new int[n];
        int running = 0;
        for (int i = 0; i < n; i++) {
            running += diff[i];
            result[i] = a[i] + running;
        }
        return result;
    }
}
```

#### Python

```python
from typing import List, Tuple


def apply_range_updates(a: List[int], updates: List[Tuple[int, int, int]]) -> List[int]:
    """Apply many (l, r, v) range +v updates, return final array.

    Each update: O(1). Reconstruction: O(n).
    """
    n = len(a)
    diff = [0] * (n + 1)  # sentinel slot avoids bounds check
    for l, r, v in updates:
        diff[l] += v
        diff[r + 1] -= v
    result = [0] * n
    running = 0
    for i in range(n):
        running += diff[i]
        result[i] = a[i] + running
    return result
```

Typical use case: a list of concert ticket sales each booking a range of seats. Recording each booking is a single O(1) diff update; after all bookings, one pass produces the seat-occupancy array.

---

## Big-O Summary

| Operation | Prefix Sum | Difference Array |
|-----------|-----------|------------------|
| Build / Reconstruct | O(n) | O(n) |
| Range sum query | **O(1)** | O(n) (must reconstruct) |
| Range update (`+v` to `a[l..r]`) | O(n) | **O(1)** |
| Point query | O(1) | O(n) until reconstructed |
| Space | O(n) | O(n) |

The structures are **dual**: prefix sums are read-fast, write-slow; difference arrays are write-fast, read-slow. Pick the one matching your access pattern.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Prefix sum** | A running bank balance — to know how much you spent between two dates, subtract the older balance from the newer one |
| **Difference array** | Daily deposits and withdrawals — easy to record each transaction, but to know today's balance you must replay them all |
| **Build cost** | One-time setup, like indexing a book — expensive once, cheap forever after |
| **Range query** | Looking up the index of a topic — instant, because someone built the index for you |

> Where analogies break: bank balances are 1D; real array indices may be 2D (matrix queries) or even 3D (voxel sums). The principle generalizes; the analogy does not.

---

## Pros and Cons

| Pros | Cons |
|------|------|
| O(1) range-sum queries after O(n) precompute | Static — does not handle frequent updates (use Fenwick or segment tree) |
| Tiny, cache-friendly code | O(n) extra memory for the prefix array |
| Works in 1D, 2D, 3D (and higher) | Off-by-one errors are common |
| Composes with hash maps for subarray problems | Only works with operations forming a group (sum, XOR) — not with min/max |
| Difference array gives O(1) range updates | Difference array is single-shot — interleaved updates and queries are slow |

**When to use:**
- Many range queries on a static array.
- Many range updates followed by a final read.

**When NOT to use:**
- Frequent interleaved updates and queries — reach for a Fenwick tree (see `09-trees/fenwick-tree`) or segment tree (see `09-trees/segment-tree`).
- Range min/max queries — use a sparse table (see `09-trees/sparse-table-rmq`) for static input.
- The data does not fit in memory — see streaming approximations in `senior.md`.

---

## Common Mistakes

| Mistake | Why It Is Wrong | Fix |
|---------|-----------------|-----|
| Using `prefix[r] - prefix[l]` instead of `prefix[r+1] - prefix[l]` | Off-by-one — drops the last element from the sum | Stick to the `length n+1` convention with `prefix[0] = 0` |
| Forgetting the sentinel `prefix[0] = 0` | Special-case for `l == 0` makes code ugly and bug-prone | Always allocate one extra slot |
| Allocating `diff` of length `n` instead of `n+1` | `diff[r+1]` overflows the buffer when `r == n-1` | Always allocate one extra slot for the right sentinel |
| Storing 32-bit sums for big inputs | Integer overflow corrupts the running total silently | Use `int64` / `long` / Python big ints |
| Using prefix sums with frequent updates | Every update rebuilds the prefix in O(n) — total cost O(nq) | Use Fenwick / segment tree instead |
| Trying prefix min/max | Min has no inverse — you cannot "subtract" the prefix to isolate a range | Use a sparse table (static) or segment tree (dynamic) |
| Building a difference array, then reading mid-stream | Each read costs O(n) until you reconstruct | Either commit to offline updates or use a Fenwick tree |
| Misplacing the 2D diff corners | Forgetting the `+v` at one corner or `-v` at another | Memorize the four-corner pattern — see `middle.md` |

---

## Cheat Sheet

| Pattern | Formula | Complexity |
|---------|---------|------------|
| Build prefix | `prefix[i+1] = prefix[i] + a[i]` | O(n) once |
| Range sum | `prefix[r+1] - prefix[l]` | O(1) per query |
| Range XOR | `prefix_xor[r+1] ^ prefix_xor[l]` | O(1) per query |
| Range update +v | `diff[l] += v; diff[r+1] -= v` | O(1) per update |
| Reconstruct after diff | `a[i] += sum(diff[0..i])` | O(n) once |
| Subarray sum == k | hash map of prefix counts | O(n) |
| Count subarrays with sum % k == 0 | hash map of `prefix % k` counts | O(n) |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The top row shows the input array `a[]`.
> - The bottom row shows the prefix array `prefix[]`.
> - Click any two indices `l` and `r` to highlight `prefix[r+1] - prefix[l]` and the corresponding subarray.
> - Toggle to **Difference Array mode** to see range updates propagate through `diff[]` and the reconstructed `a[]`.
> - Stats panel tracks operations performed and big-O badges.

---

## Summary

Prefix sums turn O(n) range-sum queries into O(1) at the cost of a one-time O(n) precompute. Difference arrays do the reverse: O(1) range updates at the cost of an O(n) final reconstruction. Both rely on the same algebraic property: **addition has an inverse (subtraction)**. The technique extends to XOR (its own inverse) and any operation forming a group, but breaks for min/max because they have no inverse — those need a sparse table or segment tree instead.

Master the off-by-one convention `prefix[r+1] - prefix[l]` with `prefix[0] = 0`, internalize the four-line `diff[l] += v; diff[r+1] -= v` update, and you have unlocked a surprising number of array problems that look hard at first glance.

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — sections on dynamic programming setup often introduce prefix sums in passing.
- *Competitive Programming Handbook* (Antti Laaksonen), chapters on range queries.
- LeetCode tag `prefix-sum` — hundreds of practice problems.
- See `middle.md` for 2D prefix sums and the composability constraint.
- See `09-trees/fenwick-tree` and `09-trees/segment-tree` for the dynamic alternatives.
