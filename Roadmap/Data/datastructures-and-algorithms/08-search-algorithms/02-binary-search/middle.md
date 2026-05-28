# Binary Search — Middle Level

> **Audience:** Engineers comfortable with iterative binary search who want the variant family used in real libraries and competitive programming. Prerequisite: `junior.md`.

This document covers the **family of search algorithms built around the bisection idea**: `bisect_left` vs `bisect_right`, find-first/find-last patterns, **binary search on the answer** (parametric search) which is the single most powerful trick in modern algorithmic interviews, **exponential search** for unbounded streams, **ternary search** for unimodal functions, **interpolation search** for uniformly distributed data, the **fractional cascading** concept used in computational geometry, and a clear-eyed comparison with hash-table lookup so you know which to reach for.

---

## Table of Contents

1. [`bisect_left` vs `bisect_right`](#bisect)
2. [Find First / Find Last Patterns](#first-last)
3. [Binary Search on the Answer (Parametric Search)](#parametric)
4. [Exponential Search for Unbounded Data](#exponential)
5. [Ternary Search for Unimodal Functions](#ternary)
6. [Interpolation Search](#interpolation)
7. [Fractional Cascading — the Concept](#fractional)
8. [Comparison with Hash Table Lookup](#vs-hash)

---

<a name="bisect"></a>
## 1. `bisect_left` vs `bisect_right`

The Python `bisect` module exposes two primitives:

- `bisect_left(a, x)` — leftmost insertion position that keeps `a` sorted. If `x` is already present, returns the index **before** the run of equal elements.
- `bisect_right(a, x)` — rightmost insertion position. Returns the index **after** the run of equals.

```python
>>> from bisect import bisect_left, bisect_right
>>> a = [1, 3, 3, 3, 5, 7]
>>> bisect_left(a, 3)
1
>>> bisect_right(a, 3)
4
```

Why two? Because they are the two natural boundaries of the "equal" run, and **everything you need for sorted-array operations is a combination of them**:

| Operation | Expression |
|---|---|
| First index of `x` (or `-1`) | `i = bisect_left(a, x); i if i < len(a) and a[i] == x else -1` |
| Last index of `x` (or `-1`) | `i = bisect_right(a, x) - 1; i if i >= 0 and a[i] == x else -1` |
| Count of `x` in `a` | `bisect_right(a, x) - bisect_left(a, x)` |
| Number of elements `< x` | `bisect_left(a, x)` |
| Number of elements `<= x` | `bisect_right(a, x)` |
| Predecessor (largest `<= x`) | `a[bisect_right(a, x) - 1]` if non-empty |
| Successor (smallest `> x`) | `a[bisect_right(a, x)]` if in range |
| Insert keeping sort | `insort_left(a, x)` or `insort_right(a, x)` |

In **C++** these are `std::lower_bound` and `std::upper_bound`. In **Java** there is only `Arrays.binarySearch`, which returns *some* index of `x` if present (no guarantee which) or `-(insertion_point) - 1` if absent — to get true `lower_bound` semantics you implement it yourself or use the `TreeMap.ceilingKey` family.

In **Go 1.21+**: `slices.BinarySearch` returns `(index, found)`; if not found, `index` is the insertion point (lower-bound semantics).

### Implementation

```python
def bisect_left(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x:                # strict less-than
            lo = mid + 1
        else:
            hi = mid
    return lo

def bisect_right(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] <= x:               # less-than-or-equal
            lo = mid + 1
        else:
            hi = mid
    return lo
```

The **only** difference is `<` vs `<=`. Everything else is identical. Internalize this and you will never confuse them again.

---

<a name="first-last"></a>
## 2. Find First / Find Last Patterns

A standard interview question: *"Given a sorted array with possible duplicates and a target, return the first and last index of the target."* (LeetCode 34.)

### Solution via `bisect`:

```python
def search_range(a, target):
    lo = bisect_left(a, target)
    hi = bisect_right(a, target) - 1
    if lo > hi:                     # not present
        return [-1, -1]
    return [lo, hi]
```

### Solution via raw binary search (Go):
```go
func SearchRange(a []int, target int) [2]int {
    first := lowerBound(a, target)
    if first == len(a) || a[first] != target {
        return [2]int{-1, -1}
    }
    last := lowerBound(a, target+1) - 1
    return [2]int{first, last}
}
```

The trick: `last_occurrence(t) == lower_bound(t+1) - 1` when `t` is an integer. For floats, you need a real `upper_bound`.

### Solution via "modified binary search" (Java):
```java
public int[] searchRange(int[] nums, int target) {
    int first = findBound(nums, target, true);
    if (first == -1) return new int[]{-1, -1};
    int last  = findBound(nums, target, false);
    return new int[]{first, last};
}
private int findBound(int[] a, int target, boolean leftMost) {
    int lo = 0, hi = a.length - 1, result = -1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (a[mid] == target) {
            result = mid;
            if (leftMost) hi = mid - 1;
            else          lo = mid + 1;
        } else if (a[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}
```

Both first and last calls run O(log n); total O(log n).

### Why these patterns matter:

In a real production system — say, a time-series database — you constantly do "give me all events in `[t1, t2]`". You compute `bisect_left(events, t1)` and `bisect_right(events, t2)`, then slice between them. The whole range query is two binary searches plus a copy. This is how **Prometheus**, **InfluxDB**, and **TimescaleDB** internally locate time slices in their compressed chunks.

---

<a name="parametric"></a>
## 3. Binary Search on the Answer (Parametric Search)

This is the highest-leverage extension of binary search. The idea: instead of searching over array indices, **search over the space of possible answers**.

### When does it apply?

You have a problem where:
1. The answer is a single integer (or float) in some known range `[lo, hi]`.
2. You can build a **predicate** `feasible(x): bool` that is **monotonic** — if a value `x` works, every larger value also works (or every smaller, depending on direction).
3. `feasible(x)` is much cheaper to evaluate than to enumerate every `x`.

Then: binary search over `x` to find the boundary between "infeasible" and "feasible".

### Canonical example: Koko Eating Bananas (LeetCode 875)

> Koko has `piles` of bananas and `h` hours. In one hour she eats `min(pile, k)` bananas from one pile. Find the minimum eating speed `k` so she finishes in `h` hours.

The answer is some `k ∈ [1, max(piles)]`. The predicate "can she finish at speed `k` in `h` hours?" is **monotonic in `k`** — if she can do it at speed 5, she can certainly do it at speed 10. So we binary-search the smallest `k` where `canFinish(k)` is true.

```python
def min_eating_speed(piles, h):
    def hours_needed(k):
        return sum((p + k - 1) // k for p in piles)   # ceil(p/k)

    lo, hi = 1, max(piles)
    while lo < hi:
        mid = (lo + hi) // 2
        if hours_needed(mid) <= h:
            hi = mid                  # mid is feasible, try smaller
        else:
            lo = mid + 1              # mid too slow
    return lo
```

The predicate evaluation is O(n). Binary search makes O(log(max_pile)) calls. Total: O(n log(max_pile)) instead of O(n × max_pile) for the brute force.

### Other parametric-search problems:

- **Capacity to ship packages within D days** (LC 1011) — binary search on the truck capacity.
- **Split array largest sum** (LC 410) — binary search on the maximum subarray sum.
- **Minimum number of days to make m bouquets** (LC 1482) — binary search on days.
- **Find the smallest divisor given a threshold** (LC 1283).
- **Allocate books / Painters partition** — classic Indian interview problem.
- **Square root** — binary search the integer `r` such that `r*r <= x < (r+1)*(r+1)`.
- **Aggressive cows** (SPOJ classic) — place `k` cows in stalls maximizing the minimum distance.
- **Median of two sorted arrays** (LC 4) — binary search the partition point.
- **K-th smallest in a multiplication table** (LC 668) — binary search on the value, count how many entries are `<= mid`.

### The pattern:

```python
def parametric_search(lo, hi, feasible):
    while lo < hi:
        mid = (lo + hi) // 2
        if feasible(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo
```

This is **identical** to the "find first true" template from `junior.md`. The only difference is what `lo` and `hi` represent — array indices vs. answer values. Once you see it, parametric search problems become trivial: identify the monotonic predicate, write it, plug into the template.

### Float version

When the answer is a real number (e.g., "minimum time to traverse a graph"), you bisect with a precision threshold:

```python
def parametric_float(lo, hi, feasible, eps=1e-9):
    for _ in range(100):              # 100 iters → ~1e-30 precision
        mid = (lo + hi) / 2
        if feasible(mid):
            hi = mid
        else:
            lo = mid
    return lo
```

A fixed iteration count avoids floating-point edge cases where `lo` and `hi` never quite converge. 100 iterations on `[0, 10^9]` shrinks the range to `~10^9 / 2^100 ≈ 10^{-21}` — way past `double` precision.

---

<a name="exponential"></a>
## 4. Exponential Search for Unbounded Data

Suppose your data is sorted but you **don't know its length** — for example, a streaming source, or a sorted file you don't want to `stat`. Plain binary search needs `hi = n - 1` upfront.

**Exponential search (Bentley & Yao, 1976):**

1. Start with `bound = 1`.
2. While `arr[bound] < target`, double `bound` (1, 2, 4, 8, 16, ...).
3. Once `arr[bound] >= target`, binary-search the range `[bound/2, min(bound, n-1)]`.

### Implementation (Python):

```python
def exponential_search(arr, target):
    if not arr:
        return -1
    if arr[0] == target:
        return 0
    n = len(arr)
    bound = 1
    while bound < n and arr[bound] < target:
        bound *= 2
    lo = bound // 2
    hi = min(bound, n - 1)
    # Standard binary search on [lo, hi]
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### Complexity

If the target is at position `k`:
- Doubling phase: O(log k) — we double until we exceed `k`.
- Binary search phase: O(log k) — the range `[bound/2, bound]` has size ~`k`.
- **Total: O(log k)**, *not* O(log n).

This is **better than plain binary search when `k << n`** — you find a near-the-front element in O(log k), independent of total length. It is also strictly necessary when `n` is unknown or unbounded.

### Use cases

- **Searching infinite/unbounded sorted streams.** "Find the first occurrence of an event after time T in this append-only log."
- **`bisect`-style insertion in a sorted file** without doing a full size query.
- **Galloping search** — inside merge-sort variants (Java's TimSort uses this) to find where one run's prefix fits in another.

---

<a name="ternary"></a>
## 5. Ternary Search for Unimodal Functions

**Binary search assumes monotonicity.** What if the function is **unimodal** instead — strictly increasing then strictly decreasing (or vice versa) with a single peak (or valley)?

Example: a parabola, a function `f(x) = sin(x)` on `[0, π]`, the height of a thrown ball over time, the load on a server through the day.

Ternary search finds the maximum (or minimum) of a unimodal function in O(log n) calls.

### The idea

Pick two points `m1, m2` that divide `[lo, hi]` into three equal parts:

```
m1 = lo + (hi - lo) / 3
m2 = hi - (hi - lo) / 3
```

Compare `f(m1)` and `f(m2)`:
- If `f(m1) < f(m2)`: the peak is to the right of `m1`. Set `lo = m1 + 1`.
- If `f(m1) > f(m2)`: the peak is to the left of `m2`. Set `hi = m2 - 1`.
- If equal: peak is between them. Either move works.

Each iteration shrinks the range to 2/3 of the previous size, so the iteration count is `log_{3/2}(n) ≈ 1.71 × log_2(n)` — slower constant than binary search but solves a problem binary search cannot.

### Integer ternary search (Python):

```python
def ternary_search_max(lo, hi, f):
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if f(m1) < f(m2):
            lo = m1 + 1
        else:
            hi = m2 - 1
    # Linear scan the last 1–3 candidates
    return max(range(lo, hi + 1), key=f)
```

### Float ternary search:

```python
def ternary_search_max_float(lo, hi, f, eps=1e-9):
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
```

### When to use ternary search

- Optimization on continuous unimodal functions: maximizing a parabola, finding the optimal angle of a projectile.
- Computational geometry: finding the closest point on a convex polygon to a line.
- Some game-theory problems where the cost function has a single optimum.
- Robotics / control: tuning a single parameter where the cost-vs-parameter curve is convex.

### Caveat

Ternary search **requires strict unimodality**. A flat region in the middle (where `f(m1) == f(m2)` not just numerically but exactly) can confuse the algorithm. For non-unimodal functions (multiple local maxima), use gradient-free optimizers (Nelder-Mead, simulated annealing) instead.

---

<a name="interpolation"></a>
## 6. Interpolation Search

Binary search always picks the middle. **Interpolation search** picks an *educated guess* based on the value distribution. If you're looking up "Williams" in a phone book, you don't open to the middle (which is around 'M'); you open about 80% of the way through. That's interpolation.

### The formula

Instead of `mid = (lo + hi) / 2`, use:

```
mid = lo + ((target - arr[lo]) / (arr[hi] - arr[lo])) * (hi - lo)
```

This linearly interpolates where the target *should* be if the data were uniformly distributed.

### Implementation (Python):

```python
def interpolation_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        mid = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### Complexity

- **Average case** on **uniformly distributed** data: O(log log n). For 1 billion elements, ~5 comparisons instead of ~30 for binary search.
- **Worst case** on adversarial data (exponentially clustered): O(n). Worse than binary search.

### When to use

- Sorted data with **known uniform-ish distribution**: timestamps generated at regular intervals, hash codes, sequence numbers.
- Disk-resident data where each comparison costs a seek and you want to minimize comparisons aggressively.

### When NOT to use

- Data with skewed or unknown distribution.
- Small arrays (the arithmetic for interpolation costs more than the saved comparisons).
- When you need **predictable** worst-case performance (regulatory or real-time constraints).

In practice, **binary search wins** on most workloads because the overhead of the interpolation arithmetic (multiplication, division) is more than the cost of a single extra comparison, and modern branch prediction handles binary search well. Interpolation is a niche optimization for specific datasets.

---

<a name="fractional"></a>
## 7. Fractional Cascading — the Concept

**Problem:** You have `k` sorted arrays `A_1, A_2, ..., A_k` each of size `n`. You want to find a target `x` in *every* one of them.

**Naive approach:** Run binary search `k` times. Total: O(k log n).

**Fractional cascading (Chazelle & Guibas, 1986):** Preprocess the arrays so that searching all `k` together costs O(log n + k) — only **one** logarithmic factor.

### The idea (sketch)

You augment each `A_i` with a "bridge" that points into `A_{i+1}`. Specifically, you merge a fraction (typically 1/2) of `A_{i+1}`'s elements into `A_i`, so that once you locate `x` in `A_i`, you have a near-direct pointer to its position in `A_{i+1}` — only a constant amount of extra work to refine. Each subsequent array costs O(1) instead of O(log n).

### Where it's used

- **Computational geometry:** point location in planar subdivisions, range trees, segment trees with cascading.
- **Geographic information systems:** layered map queries.
- **Database index intersection:** when a query touches multiple sorted indexes.

### Why you should know it exists

You will rarely implement fractional cascading by hand — the constants are large and the bookkeeping is painful. But knowing it exists tells you **the multi-array binary search lower bound is not what you might think**. If you find yourself doing many binary searches into many sorted lists for the same key, look up fractional cascading or one of its modern variants (BWT, wavelet trees) before writing the naive O(k log n) solution.

For most production code, the simpler approach is to **merge the arrays into one** sorted list with origin tags. This costs O(kn) memory but each query is one O(log(kn)) search.

---

<a name="vs-hash"></a>
## 8. Comparison with Hash Table Lookup

| Property | Binary Search (sorted array) | Hash Table |
|---|---|---|
| **Lookup time** | O(log n) | O(1) average, O(n) worst |
| **Insert / delete** | O(n) — shift elements | O(1) average |
| **Memory** | O(n) compact, no overhead | O(n) + load-factor overhead (~30–80%) |
| **Range queries** (`x ∈ [a, b]`) | O(log n) — two bisects | O(n) — must scan |
| **Predecessor / successor** | O(log n) | O(n) without auxiliary structure |
| **Ordered iteration** | O(n) — already sorted | O(n) — must sort |
| **K-th element** | O(1) — direct index | O(n) without auxiliary structure |
| **Cache behavior** | Predictable, cache-friendly for small n | Random access, unfriendly above L2 |
| **Worst-case guarantee** | O(log n) deterministic | O(n) without rehashing |
| **Vulnerability to adversarial input** | None | Hash collision DoS attacks |
| **Memory overhead** | None (array as-is) | ~30–80% (open addressing) or 2× (chaining) |
| **Equality with custom comparator** | Yes — comparator decides | Yes — `equals` and `hashCode` must agree |
| **Approximate match** (closest, range) | Yes — `lower_bound` | No, native; need ranges or LSH |

### When binary search wins:
- You need range queries (`give me events between t1 and t2`).
- You need ordered iteration (`give me the next 10 in sort order`).
- You need predecessor/successor queries.
- You can tolerate O(n) inserts (bulk-loaded data).
- You need deterministic worst-case performance.
- You need k-th order statistics in O(1).
- Memory is tight (no hash overhead).
- The data is naturally already sorted (logs by timestamp, IDs).

### When hash table wins:
- You only need exact-match lookups.
- You insert / delete frequently.
- O(1) is required (high QPS, real-time SLA).
- You don't care about ordering.

### When **B-tree / skip list / TreeMap** beats both:
- You need both ordered queries **and** frequent inserts. Binary search is O(n) for insert (bad); hash is O(n) for range (bad). A balanced tree gives O(log n) for both.

### Real-world combinations:

- **Database indexes** typically use **B-trees** because they need both range and update support.
- **Compressed sorted files** (Parquet, ORC) use **binary search inside row-group footers** because they are read-heavy and rarely updated.
- **Caches** use **hash tables** for fast key→value lookup.
- **LRU caches** combine a hash table (for lookup) and a linked list (for ordering).
- **TimescaleDB chunks** use **binary search on time** to locate the right chunk, then range-scan within it.

The lesson: **binary search isn't a replacement for hash tables** — they answer different questions. Choose by query workload, not by reflex.

---

## Cheat Sheet — Algorithm Selection

```
Question                                    Best tool
---------                                   ----------
Exact lookup, no ordering needed            Hash table (O(1))
Exact lookup, sorted, read-only             Binary search (O(log n))
Exact lookup, sorted, frequent insert       BST / B-tree / skip list
Range query [a, b]                          Binary search (lower+upper bound)
First/last occurrence of duplicate          bisect_left / bisect_right
Optimum of unimodal function                Ternary search
Search in unbounded stream                  Exponential search
Search in many sorted arrays for same key   Fractional cascading (or merge first)
Distribution-uniform sorted data, fast lookup  Interpolation search
Search the answer (capacity, speed, etc.)   Parametric binary search
```

---

## Further Reading

- **Bentley & Yao**, "An Almost Optimal Algorithm for Unbounded Searching" (1976). The exponential search paper.
- **Chazelle & Guibas**, "Fractional Cascading" (1986). The original paper.
- **Knuth TAOCP v3**, Section 6.2.1 — interpolation search analysis.
- Continue with `senior.md` for production usage in B-trees, databases, `git bisect`, and distributed indexes.
