# Prefix Sums & Difference Arrays — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing: Prefix Sum vs Difference Array](#choosing-prefix-sum-vs-difference-array)
3. [2D Prefix Sums (Integral Images)](#2d-prefix-sums-integral-images)
4. [2D Difference Arrays](#2d-difference-arrays)
5. [Composability — Why Only Groups Work](#composability--why-only-groups-work)
6. [Variants — XOR, Product, Modular](#variants--xor-product-modular)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Classic Problem Catalog](#classic-problem-catalog)
9. [Code Examples](#code-examples)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At the junior level, you saw prefix sums as a trick to answer range queries. At the middle level, the right question is: *when does this trick actually apply?* Prefix sums rely on a deep algebraic property — the operation must have an inverse. That single fact controls every variant (XOR works, min does not), every dimension (1D, 2D, 3D, with appropriate corners), and every dynamic alternative (Fenwick, segment tree, sparse table).

This level focuses on the **why** and the **trade-offs**: when prefix sums are correct, when difference arrays beat them, and when neither belongs in your toolbox.

---

## Choosing: Prefix Sum vs Difference Array

| Workload | Use prefix sum | Use difference array | Use neither |
|----------|---------------|---------------------|-------------|
| Many range queries, no updates | Yes | No | |
| Many range updates, single final read | No | Yes | |
| Interleaved updates and queries | No | No | Fenwick or segment tree |
| Range min/max queries (static) | No | No | Sparse table |
| Range min/max queries (dynamic) | No | No | Segment tree |
| Streaming / sums don't fit in memory | No | No | Sketches / sampling |

**Decision rule:** count how many *queries* (Q) versus *updates* (U) you will perform.
- If `U = 0`: prefix sum (O(n) precompute, O(1) per query).
- If `Q = 1` (single read at the end): difference array (O(1) per update, O(n) reconstruct).
- Otherwise (both `Q` and `U` large): O(log n) per operation with a Fenwick tree.

---

## 2D Prefix Sums (Integral Images)

Extending to a 2D matrix `a[r][c]` of size `R x C`:

```text
P[i+1][j+1] = a[i][j] + P[i][j+1] + P[i+1][j] - P[i][j]
```

Same sentinel idea: `P` is `(R+1) x (C+1)` with the first row and column all zeros. `P[i][j]` stores the sum of the submatrix `a[0..i-1][0..j-1]`.

The recurrence uses **inclusion-exclusion**: we want everything above-left, so we add the row above and the column to the left, then subtract the corner counted twice.

Then a rectangle sum `sum(r1..r2, c1..c2)` (inclusive on all sides) is:

```text
P[r2+1][c2+1] - P[r1][c2+1] - P[r2+1][c1] + P[r1][c1]
```

Again four corners by inclusion-exclusion.

### Use Cases for 2D Prefix Sums

| Use Case | How |
|----------|-----|
| Submatrix-sum queries | Direct application |
| Counting points in a rectangle | Build prefix on a 0/1 indicator grid |
| Computer vision — Haar features | Viola-Jones face detection (covered in `senior.md`) |
| Histogram of Oriented Gradients (HOG) | Per-cell sums via integral image |
| Image blurring (box filter) | Constant-time per-pixel box sum |
| Counting submatrices with property X | Often becomes a 1D prefix problem per row |

The technique is called an **integral image** or **summed-area table (SAT)** in computer vision — coined by Crow (1984) and popularized for face detection by Viola and Jones (2001).

```text
Matrix a (3x4):                 Prefix P (4x5):
   2  1  3  0                    0  0  0  0  0
   1  0  1  2                    0  2  3  6  6
   4  3  0  1                    0  3  4  8 10
                                 0  7 11 15 18

Sum of submatrix a[0..2][1..3]:
   P[3][4] - P[0][4] - P[3][1] + P[0][1]
   = 18 - 0 - 7 + 0 = 11
Check: 1+3+0 + 0+1+2 + 3+0+1 = 11   OK
```

---

## 2D Difference Arrays

Range update on a submatrix `a[r1..r2][c1..c2] += v` becomes **four point updates** on a 2D difference array `D` of size `(R+1) x (C+1)`:

```text
D[r1][c1]     += v
D[r1][c2+1]   -= v
D[r2+1][c1]   -= v
D[r2+1][c2+1] += v
```

Reconstruction: take a 2D prefix sum of `D`. The `+v` at the top-left corner propagates down and to the right; the `-v` at the right and bottom corners cancel that propagation outside the target rectangle; the `+v` at the bottom-right corner re-corrects the over-subtraction.

Use cases: heatmap aggregation across overlapping rectangles, image-stamping operations, batch terrain modifications in games.

The pattern is purely the inverse of the 2D prefix sum: each "+1" / "-1" / "+1" / "-1" in inclusion-exclusion at query time becomes a write at update time. This duality is not a coincidence — it falls out of the group structure described in the next section.

---

## Composability — Why Only Groups Work

The technique relies on one property: **the operation has an inverse**.

Formally, prefix-based queries require an **abelian group**: a set with an associative, commutative operation that has an identity and an inverse for every element.

| Operation | Inverse | Identity | Prefix Works? |
|-----------|---------|----------|---------------|
| Addition (sum) | Negation | 0 | Yes |
| XOR | XOR (self-inverse) | 0 | Yes |
| Multiplication on `R` | Reciprocal | 1 | Almost — fails at 0 |
| Multiplication mod prime `p` | Modular inverse | 1 | Yes for nonzero residues |
| Matrix multiplication | Matrix inverse | Identity matrix | Yes for invertible matrices |
| Min | None | +Infinity | **No** |
| Max | None | -Infinity | **No** |
| GCD | None | 0 | **No** |
| Bitwise AND / OR | None | all-1s / 0 | **No** |

If your operation lacks an inverse, `prefix[r+1]` "merged with" `prefix[l]` cannot be undone to isolate `a[l..r]`. Concretely, `min(a, b)` does not let you recover `a` from `min(a, b)` and `b`. The whole subtraction trick collapses.

**Alternatives for non-invertible operations:**
- Static input, range min/max: **sparse table** — O(n log n) build, O(1) query.
- Dynamic input, any associative semigroup: **segment tree** — O(n) build, O(log n) per query/update.
- Append-only, with rollback: **disjoint sparse table** or **persistent segment tree**.

Link: see `09-trees/sparse-table-rmq` and `09-trees/segment-tree` for these dynamic-DS alternatives.

---

## Variants — XOR, Product, Modular

### Prefix XOR

XOR is its own inverse: `x ^ x == 0`. So:

```text
prefix_xor[i+1] = prefix_xor[i] ^ a[i]
xor(a[l..r])    = prefix_xor[r+1] ^ prefix_xor[l]
```

Classic problem: "count subarrays with XOR equal to k". Same hash-map trick as sum-equals-K — replace `+` with `^` and `-` with `^` (since XOR is self-inverse).

### Prefix Product

Works in principle: `product(a[l..r]) = prefix[r+1] / prefix[l]`. But:
1. **If any `a[i] == 0`**, the prefix becomes 0 and you cannot divide.
2. **Floating-point** division accumulates error.
3. **Integer division** generally doesn't recover the exact product.

**Workaround 1:** Track the position of the most recent zero. For queries spanning a zero, return 0; otherwise use products on the non-zero segments.

**Workaround 2 (modular):** When working mod a prime `p`, every nonzero residue has a unique modular inverse, so `product(a[l..r]) = prefix[r+1] * inverse(prefix[l]) mod p`. Standard in competitive programming.

### Modular Prefix Sums

For very large sums where overflow is a concern, compute all prefix sums modulo some modulus `m`:

```text
prefix[i+1] = (prefix[i] + a[i]) mod m
sum(a[l..r]) mod m = (prefix[r+1] - prefix[l] + m) mod m
```

The `+ m` before the final `mod` handles the negative intermediate value when `prefix[r+1] < prefix[l]`.

### Prefix Min/Max — Asymmetric Special Case

You **can** compute one-sided prefix min/max:

```text
pmin[i+1] = min(pmin[i], a[i])    "min of a[0..i]"
```

What you **cannot** do is recover `min(a[l..r])` from `pmin[r+1]` and `pmin[l]`. Use a sparse table instead — O(1) query after O(n log n) build, using disjoint range merging.

---

## Comparison with Alternatives

| Attribute | Prefix Sum | Difference Array | Fenwick Tree | Segment Tree | Sparse Table |
|-----------|-----------|------------------|--------------|--------------|--------------|
| Range sum (static) | **O(1)** | O(n) | O(log n) | O(log n) | n/a |
| Point update | O(n) | O(n) | **O(log n)** | O(log n) | rebuild |
| Range update | O(n) | **O(1)** | O(log n)* | O(log n) | n/a |
| Range min/max (static) | n/a | n/a | n/a | O(log n) | **O(1)** |
| Range min/max (dynamic) | n/a | n/a | n/a | **O(log n)** | n/a |
| Build cost | O(n) | O(n) | O(n) | O(n) | O(n log n) |
| Space | O(n) | O(n) | O(n) | O(n) | O(n log n) |
| Implementation effort | Tiny | Tiny | Small | Medium | Small |
| Works for non-invertible ops? | No | No | No | Yes | Yes (static) |

*Fenwick tree supports range update + point query natively; range update + range query needs two Fenwicks.

**Decision tree:**

```text
Need range queries?
├── On static data with addition / XOR? -> prefix sum
├── On static data with min / max?       -> sparse table
├── On dynamic data, sum / XOR?         -> Fenwick tree
└── On dynamic data, anything else?      -> segment tree

Need range updates with a single final read?
└── -> difference array

Both updates and queries interleaved?
└── -> Fenwick (for sum) or segment tree (for anything else)
```

### Prefix Sum vs Sliding Window

For certain subarray problems both techniques apply, but they answer different questions:

| Aspect | Prefix Sum (+ hash map) | Sliding Window |
|--------|------------------------|----------------|
| Negative values allowed? | Yes | Often no (monotonicity broken) |
| Counts subarrays summing to K | Yes — uses prefix-difference equation | Only with all-positive values |
| Finds longest subarray with sum < K | Awkward | Natural |
| Finds at-most-K constraint | Awkward | Natural |
| Memory | O(n) for the map | O(1) |
| Online vs offline | Either | Online |

**Heuristic:** if your problem involves *equality* on a sum, reach for prefix sum + hash map. If it involves *inequality* (`<= K`, `>= K`) on a sum and the array is non-negative, reach for sliding window. See `11-sliding-window`.

---

## Classic Problem Catalog

| Problem | Approach | Why |
|---------|----------|-----|
| Range sum of an array | Prefix sum | Direct |
| Subarray sum equals K | Prefix sum + hash map | Equality on sum |
| Subarray sum divisible by K | Prefix sum mod K + hash map | `prefix[r+1] % K == prefix[l] % K` |
| Count subarrays with XOR == K | Prefix XOR + hash map | XOR is invertible |
| Maximum sum subarray (Kadane) | DP, not prefix | Negative values; classic Kadane is simpler |
| Equilibrium index | Prefix sum | Compare left and right halves |
| 2D rectangle sum | 2D prefix sum | Direct |
| Maximum submatrix sum | Compress rows + 1D Kadane | Reduces to 1D |
| Maximum r x c submatrix sum (fixed size) | 2D prefix sum | Each window in O(1) |
| Range +v updates, final array | Difference array | Updates outnumber queries |
| Car pooling / interval booking | Difference array | Intervals are range updates on a timeline |
| Counting subarrays with at most K odd numbers | Prefix count of odds + sliding window | Hybrid |
| Range update + range query (online) | Fenwick or segment tree | Beyond prefix sum |

---

## Code Examples

### 2D Prefix Sum — Submatrix Sum Query

#### Go

```go
package prefix2d

// Build2D returns the integral image P where
// P[i][j] = sum of a[0..i-1][0..j-1]. Dimensions: (R+1) x (C+1).
func Build2D(a [][]int) [][]int {
	R := len(a)
	if R == 0 {
		return [][]int{{0}}
	}
	C := len(a[0])
	P := make([][]int, R+1)
	for i := range P {
		P[i] = make([]int, C+1)
	}
	for i := 0; i < R; i++ {
		for j := 0; j < C; j++ {
			P[i+1][j+1] = a[i][j] + P[i+1][j] + P[i][j+1] - P[i][j]
		}
	}
	return P
}

// RectSum returns sum of submatrix a[r1..r2][c1..c2] inclusive in O(1).
func RectSum(P [][]int, r1, c1, r2, c2 int) int {
	return P[r2+1][c2+1] - P[r1][c2+1] - P[r2+1][c1] + P[r1][c1]
}
```

#### Java

```java
public class Prefix2D {
    /** Builds integral image. P[i][j] = sum of a[0..i-1][0..j-1]. */
    public static long[][] build2D(int[][] a) {
        int R = a.length, C = a[0].length;
        long[][] P = new long[R + 1][C + 1];
        for (int i = 0; i < R; i++)
            for (int j = 0; j < C; j++)
                P[i + 1][j + 1] = a[i][j] + P[i + 1][j] + P[i][j + 1] - P[i][j];
        return P;
    }

    /** Sum of submatrix a[r1..r2][c1..c2] inclusive in O(1). */
    public static long rectSum(long[][] P, int r1, int c1, int r2, int c2) {
        return P[r2 + 1][c2 + 1] - P[r1][c2 + 1] - P[r2 + 1][c1] + P[r1][c1];
    }
}
```

#### Python

```python
from typing import List


def build_2d(a: List[List[int]]) -> List[List[int]]:
    """Integral image: P[i][j] = sum of a[0..i-1][0..j-1]."""
    R, C = len(a), len(a[0])
    P = [[0] * (C + 1) for _ in range(R + 1)]
    for i in range(R):
        for j in range(C):
            P[i + 1][j + 1] = a[i][j] + P[i + 1][j] + P[i][j + 1] - P[i][j]
    return P


def rect_sum(P, r1, c1, r2, c2):
    """Sum of submatrix a[r1..r2][c1..c2] inclusive in O(1)."""
    return P[r2 + 1][c2 + 1] - P[r1][c2 + 1] - P[r2 + 1][c1] + P[r1][c1]
```

### Subarray Sum Divisible by K

#### Go

```go
// SubarraysDivByK counts subarrays whose sum is divisible by k.
// Uses prefix sum mod k.  Time: O(n).
func SubarraysDivByK(a []int, k int) int {
	count := 0
	running := 0
	freq := map[int]int{0: 1}
	for _, v := range a {
		running = ((running+v)%k + k) % k // normalize to [0, k)
		count += freq[running]
		freq[running]++
	}
	return count
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class SubarraysDivByK {
    public static int subarraysDivByK(int[] a, int k) {
        Map<Integer, Integer> freq = new HashMap<>();
        freq.put(0, 1);
        int count = 0, running = 0;
        for (int v : a) {
            running = ((running + v) % k + k) % k;
            count += freq.getOrDefault(running, 0);
            freq.merge(running, 1, Integer::sum);
        }
        return count;
    }
}
```

#### Python

```python
from collections import defaultdict


def subarrays_div_by_k(a, k):
    freq = defaultdict(int)
    freq[0] = 1
    running = 0
    count = 0
    for v in a:
        running = (running + v) % k
        count += freq[running]
        freq[running] += 1
    return count
```

---

## Performance Analysis

Practical numbers on a typical laptop (n = number of elements, q = number of queries):

| Scenario | Prefix Sum | Fenwick Tree | Segment Tree |
|----------|-----------|--------------|--------------|
| n = 10^6, q = 10^6 range sums, no updates | ~5 ms build + ~5 ms queries | ~30 ms build + ~30 ms queries | ~40 ms build + ~50 ms queries |
| n = 10^6, q = 10^6 updates + queries mixed | unusable (O(nq)) | ~60 ms total | ~100 ms total |

Prefix sums win by a wide margin **when the workload is read-only**. The constant factor for `prefix[r+1] - prefix[l]` is essentially one subtraction. Both Fenwick and segment trees pay log-factor and cache-miss overhead.

The crossover point — where Fenwick beats prefix sum — happens roughly when `updates > queries / log n`. Past that, switch structures.

---

## Best Practices

- **Document the indexing convention** in a comment at the top of any prefix-sum function. Future-you will thank present-you.
- **Always use 64-bit integers** for sums unless you have analyzed the bound. The cost is negligible; the bug from a silent overflow is not.
- **Allocate one extra slot** for the prefix and the diff array. Sentinels eliminate boundary special cases.
- **Prefer immutable views** when the prefix array is shared: it is a read-only artifact and benefits from cache and concurrency-friendly access patterns.
- **Profile before generalizing to 2D / 3D**. Memory grows quadratically / cubically. Sometimes a row-wise 1D prefix sum is enough.
- **Reach for Fenwick / segment trees** as soon as updates appear in the workload. Do not bolt prefix sums onto a dynamic problem.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> Middle-level usage:
> - Toggle between **Prefix Mode** and **Diff Mode** to compare the two duals.
> - In Prefix Mode, picking `(l, r)` highlights `prefix[r+1] - prefix[l]` and the underlying subarray simultaneously.
> - In Diff Mode, a range `+v` update displays the two point updates on `diff[]` and the propagation back to `a[]`.
> - Stats panel tracks query/update count.

---

## Summary

At the middle level, prefix sums are not a trick — they are a consequence of the abelian-group structure of addition. That structure dictates exactly which variants work (XOR, modular multiplication) and which fail (min, max, GCD). Difference arrays are the dual: they trade fast queries for fast updates and apply whenever the same group structure exists.

The decision framework is concrete: count queries vs updates, ask whether your operation has an inverse, and pick prefix sum, diff array, Fenwick, segment tree, or sparse table accordingly. Get that decision right and the implementation is almost incidental.
