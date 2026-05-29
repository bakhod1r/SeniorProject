# Interpolation Search — Junior Level

> **Read time: ~30 minutes** · **Audience:** Engineers comfortable with binary search who want to know how a smarter midpoint guess can drop the comparison count from `log n` to `log log n` on the right data — and why the "right data" caveat is the whole story.

Interpolation Search is the answer to a question binary search never asks: *given that the data is sorted, why guess the middle?* When you flip open a dictionary looking for **"zebra"**, you do not start in the middle around "M". You flip to roughly 95% of the way through — because you know the alphabet is **uniformly distributed** and "Z" sits near the end. That intuition, formalized as a linear-interpolation formula, gives interpolation search its trademark **O(log log n)** average case on uniform data. It is the algorithm of choice inside SSTable indexes, scientific time-series lookups, and any sorted column whose distribution statistics suggest uniformity.

This document teaches you interpolation search **so thoroughly** that you will recognize the formula on sight, never miss the division-by-zero edge case, know exactly when to fall back to binary search (and how to do it safely), and understand why a 5-line modification of binary search can be either dramatically faster or catastrophically slower than the original depending on the input distribution.

---

## Table of Contents

1. [Introduction — Guessing Smarter Than the Middle](#introduction)
2. [Prerequisites — Sorted, Numeric, and Distribution-Aware](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — The Interpolation Formula](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — Hybrid Fallback to Binary](#patterns)
11. [Error Handling — Division by Zero and Overflow](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Guessing Smarter Than the Middle

You are looking up the word **"zebra"** in a paper dictionary. Binary search would have you flip to page 600 of 1,200 — landing somewhere in the M's. But you already know "Z" is the last letter of a 26-letter alphabet. You estimate: "Z" is letter 26 of 26, so the page should be around `26/26 × 1200 = 1200`. You flip to page 1,190, see "yacht", flip ahead a few pages — found "zebra" in **two** flips. Binary search would have taken eleven.

That's interpolation search. Instead of cutting the search space in half, you **estimate** where the target should be based on its value relative to the endpoints, and probe there. The mental model is **linear interpolation**: pretend the array is a perfectly straight line of values, and ask "if this line goes from `arr[lo]` to `arr[hi]`, where would `target` sit?"

The formula:

```
pos = lo + ((target - arr[lo]) * (hi - lo)) / (arr[hi] - arr[lo])
```

Read it left to right: starting at `lo`, advance by a **fraction** of the window `(hi - lo)` proportional to how far `target` is between `arr[lo]` and `arr[hi]`. If target is 30% of the way from `arr[lo]` to `arr[hi]` in value, probe 30% of the way from `lo` to `hi` in index.

When the data is roughly **uniformly distributed**, this guess lands extremely close to the true position. The recurrence `T(n) = T(√n) + O(1)` solves to `O(log log n)` — for a billion elements, ~5 probes instead of binary's 30.

The catch — and it is a serious one — is that this assumes the **values grow linearly with index**. If the distribution is exponential, clustered, or heavy-tailed, the interpolation formula sends you to completely wrong positions, and the algorithm degrades to **O(n)** in the worst case. Real production implementations always pair interpolation search with a **bounded-iteration fallback** to binary search — exactly what LevelDB, RocksDB, and PostgreSQL B-tree page-probe heuristics do.

So: interpolation search is a precision tool. Used on the right data, it is shockingly fast. Used on the wrong data without a fallback, it is shockingly slow. The rest of this document teaches you to tell which is which.

---

<a name="prerequisites"></a>
## 2. Prerequisites — Sorted, Numeric, and Distribution-Aware

Before interpolation search applies, you must have:

1. **A sorted sequence** — same prerequisite as binary search. Ascending is conventional.
2. **Random access in O(1).** Same as binary search. Arrays / slices / `ArrayList` work; linked lists don't.
3. **Numerically comparable keys with a meaningful arithmetic distance.** This is the big new requirement. `(target - arr[lo])` must make sense and produce a number. Integers, floats, fixed-width timestamps work. Strings, UUIDs, opaque blobs **don't** — there is no useful linear interpolation between "alpha" and "omega" (you can interpolate on the character codes, but that almost never matches the natural sort order well enough).
4. **An approximately uniform distribution.** If the data is wildly skewed, you give up the asymptotic advantage and may underperform binary search.

If your data is **not numerically interpolatable** (e.g., strings, custom comparators), use binary search — interpolation does not apply.

If your data is **sorted but non-uniform**, you have three options:
- **Use binary search.** Guaranteed O(log n).
- **Use interpolation search with a bounded-iteration fallback** to binary. Best of both worlds, slight constant overhead.
- **Transform the keys** to a more uniform space (e.g., compute a hash that preserves order — order-preserving hashing is a real technique used in distributed indexes).

**Rule of thumb:** Use interpolation search when you have a million-plus numeric keys with a known-uniform distribution and lookup latency matters. Otherwise default to binary search.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Interpolation** | Estimating a value between two known points by assuming a linear (or polynomial) relationship. |
| **Linear interpolation** | The simplest interpolation: draw a straight line between two points, read off the target's position. The basis of vanilla interpolation search. |
| **Probe** | A single inspection of `arr[pos]` followed by a comparison with target. Equivalent to "iteration" in binary search. |
| **Position estimate** | The index `pos` predicted by the interpolation formula. May overshoot or undershoot the true location. |
| **Uniform distribution** | Values increase by roughly equal increments per index. The ideal input for interpolation search. |
| **Skewed distribution** | Values cluster non-uniformly: power-law, exponential, or bimodal. The worst case for interpolation search. |
| **Distribution sensitivity** | The property that performance depends heavily on input shape. Binary search has no distribution sensitivity; interpolation does. |
| **Hybrid search** | An algorithm that starts with interpolation and falls back to binary after K bad probes. |
| **O(log log n)** | The expected probe count on uniform data. For n = 10⁹, this is ~5. Sometimes called "doubly logarithmic". |
| **Pathological input** | A sorted but adversarial distribution (e.g., `1, 2, 4, 8, 16, …, 2^n`) that forces O(n) probes. |
| **Division-by-zero guard** | The check `arr[lo] == arr[hi]` that must precede the interpolation formula to avoid a runtime error when the window contains all equal values. |
| **Overflow guard** | Using 64-bit arithmetic (or rearranging the formula) so that `(target - arr[lo]) * (hi - lo)` does not exceed 32-bit limits. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — The Interpolation Formula

### 4.1 The intuition: a straight-line model

Imagine plotting `arr[i]` vs `i` on a graph. For a perfectly uniform array — e.g., `arr[i] = 10 * i` — the plot is a straight line. If the target value is `350`, you draw a horizontal line at `y = 350`, find where it crosses the data line, and that's your `pos`. Mathematically that's:

```
pos = lo + ((target - arr[lo]) / (arr[hi] - arr[lo])) * (hi - lo)
```

The bracketed fraction is "where is the target between `arr[lo]` and `arr[hi]`, as a number in [0, 1]?". Multiplying by `(hi - lo)` translates that fraction into an index offset from `lo`.

### 4.2 The formula in integer arithmetic

In integer code, we rearrange to multiply before dividing so we don't lose precision:

```
pos = lo + ((target - arr[lo]) * (hi - lo)) / (arr[hi] - arr[lo])
```

This is the canonical form you will see in every textbook. The numerator can grow large — for `target - arr[lo]` and `hi - lo` both near `2^31`, the product overflows 32-bit signed math. Use 64-bit or rearrange (see §11).

### 4.3 The three-branch comparison

After computing `pos` and reading `arr[pos]`:

| Comparison | Action | Reason |
|---|---|---|
| `arr[pos] == target` | Return `pos` | Found. |
| `arr[pos] < target` | `lo = pos + 1` | Target is to the right of `pos`. |
| `arr[pos] > target` | `hi = pos - 1` | Target is to the left of `pos`. |

Notice this is **identical** to binary search after the probe. The only difference is *which index* you probed.

### 4.4 The loop condition

Most implementations use **inclusive bounds** `[lo, hi]` with a slight twist:

```
while lo <= hi and arr[lo] <= target <= arr[hi]:
    ...
```

The second condition is a **fast-fail**: if the target is outside the value range covered by the current window, it can't be present, and we stop early. (Binary search doesn't need this — it doesn't compare values to endpoints — but it's an essentially free check here.)

### 4.5 Edge case: `arr[lo] == arr[hi]`

If every element in `[lo, hi]` is equal (or just the endpoints happen to match), the denominator `arr[hi] - arr[lo]` is zero. Division by zero crashes. **Always guard:**

```
if arr[lo] == arr[hi]:
    return lo if arr[lo] == target else -1
```

This guard is **the most commonly forgotten line** in interpolation-search implementations. Without it, your code passes basic tests and crashes on duplicates in production.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Best case** | O(1) — interpolation lands directly on target |
| **Average case (uniform data)** | O(log log n) |
| **Average case (general)** | O(log n) — degrades toward binary on mildly skewed data |
| **Worst case** | O(n) — pathological distributions force linear scan |
| **Space (iterative)** | O(1) |
| **Space (recursive)** | O(log log n) average, O(n) worst |
| **Probes (uniform, average)** | `⌈log₂ log₂ n⌉ + O(1)` |
| **Cache behavior** | Worse than binary search on adversarial probes; comparable on uniform |
| **Requires sorted input** | YES, and ideally uniform |

For `n = 1,000,000,000` uniform data: **~5 probes** vs binary's 30. For `n = 1,000,000,000` adversarial data: **~10⁹ probes** vs binary's 30. The variance is the algorithm's defining characteristic.

### Why O(log log n)?

A single probe on uniform data lands within `O(√n)` of the true position on average — provable by computing the variance of the predicted `pos`. So one probe reduces the window from `n` to `√n`. The recurrence:

```
T(n) = T(√n) + O(1)
```

solving by substitution `n = 2^(2^k)`: each level halves the exponent's exponent, so `k = log₂ log₂ n` levels. Total probes: `O(log log n)`.

This is one of the few naturally occurring `log log` complexities in computer science (alongside van Emde Boas trees and certain priority queues).

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Dictionary lookup, smarter
The opening example. You don't open the dictionary in the middle when looking up "zebra"; you open near the end. You estimate from the alphabet's distribution.

### 6.2 Phone book skim
Looking for "Williams" in a phone book of all American surnames, you flip to about 80% of the way through, because you know "W" is near the end of the alphabet but you also know surnames cluster heavily at "Smith" / "Johnson" / "Williams". A skilled human is doing **distribution-aware interpolation** every time they search a printed reference.

### 6.3 Scrubbing a video timeline
You want frame at timestamp 47 minutes in a 60-minute video. You drag the scrubber to 47/60 = ~78% across the timeline. Players use interpolation indexing internally when seeking to a timestamp inside an MP4 — the moov box's stts (sample-to-time) table is interpolated to land near the right sample.

### 6.4 Finding a flight in a sorted departure board
"What time is the 18:30 flight to Tokyo?" Looking at a departure board sorted by time, you don't start at the top — you skip down to roughly 75% if the board covers 06:00–22:00. You interpolated.

### 6.5 Probing a sensor log for a specific timestamp
A 24-hour temperature log has one sample per second = 86,400 entries. You want the temperature at 14:00:00. Index `≈ 14*3600 = 50,400`. You go straight there. No bisection — interpolation. This is exactly how time-series databases (Prometheus, InfluxDB) optimize point lookups when the timestamps are sequentially sampled.

### 6.6 Library Dewey Decimal
Books are numbered 000–999. To find book 743, you walk to roughly 74% along the shelf. Same idea.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros
- **O(log log n) on uniform data.** For very large arrays this is dramatically faster than binary search.
- **Drop-in replacement for binary search** when the data is numeric and uniform — same API, same prerequisites.
- **Tiny memory footprint.** Three integers, like binary search.
- **Foundation for higher techniques.** Multi-point interpolation, polynomial-fit search, and learned index structures (RMI, ALEX) all generalize the same idea.
- **Natural fit for time-series and ID-sequenced data** — both of which are pervasive in real systems.

### Cons
- **Distribution-sensitive.** Performance falls off a cliff on non-uniform data. O(n) is a real possibility, not just a theoretical worst case.
- **Requires numeric keys.** Strings, bytes, or composite keys don't interpolate cleanly.
- **Arithmetic cost per probe.** Multiplication and division per probe vs. binary search's shift; on a tight inner loop this matters.
- **Overflow-prone.** `(target - arr[lo]) * (hi - lo)` overflows 32-bit signed integers easily.
- **Division-by-zero pitfall.** Forget the equal-endpoints guard, get a runtime crash.
- **No predictable worst-case.** Regulatory or real-time systems (audio buffers, trading kernels, brake controllers) can't risk O(n).
- **Cache behavior is harder to reason about.** Probes can be anywhere in the window, not predictably halving.

The cons are why production code that uses interpolation search **always** wraps it with a fallback — typically: try interpolation for K probes, then switch to binary for the rest.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Search for `target = 33` in uniform array `[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]` (n = 10).

```
Initial: lo=0, hi=9
Array:   [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
Indices:   0   1   2   3   4   5   6   7   8   9
```

**Probe 1.**
```
pos = 0 + ((33 - 10) * (9 - 0)) / (100 - 10)
    = 0 + (23 * 9) / 90
    = 0 + 207 / 90
    = 0 + 2
    = 2
arr[2] = 30
30 < 33  →  lo = pos + 1 = 3
```
Window: `[3, 9]`.

**Probe 2.**
```
pos = 3 + ((33 - 40) * (9 - 3)) / (100 - 40)
```
Wait — `target - arr[lo] = 33 - 40 = -7`. The formula produces a *negative* value, and `pos = 3 + (-7 * 6) / 60 = 3 + (-42)/60 = 3 + 0 = 3` (integer-truncated). `arr[3] = 40`. `40 > 33` → `hi = 2`.

Now `lo = 3 > hi = 2`, so the window is empty and we return -1. **Target 33 is not in the array.** Total probes: 2.

Compare with binary search:
```
Probe 1: mid=4, arr[4]=50, 50>33, hi=3
Probe 2: mid=1, arr[1]=20, 20<33, lo=2
Probe 3: mid=2, arr[2]=30, 30<33, lo=3
Probe 4: mid=3, arr[3]=40, 40>33, hi=2
Loop exit, return -1
```
Binary used 4 probes, interpolation used 2. On larger arrays the gap grows.

---

Now consider a **pathological input**: `[1, 2, 4, 8, 16, 32, 64, 128, 256, 512]` (powers of 2 — exponential growth). Search for `target = 256`:

```
Probe 1: pos = 0 + ((256-1) * 9) / (512-1) = (255*9)/511 = 2295/511 = 4
         arr[4] = 16. 16 < 256, lo = 5.
Probe 2: pos = 5 + ((256-32) * 4) / (512-32) = (224*4)/480 = 896/480 = 1
         pos = 5 + 1 = 6. arr[6] = 64. 64 < 256, lo = 7.
Probe 3: pos = 7 + ((256-128) * 2) / (512-128) = (128*2)/384 = 256/384 = 0
         pos = 7. arr[7] = 128. 128 < 256, lo = 8.
Probe 4: pos = 8 + ((256-256) * 1) / (512-256) = 8 + 0 = 8
         arr[8] = 256. Found! Return 8.
```
4 probes — interpolation is barely faster than binary search (which would take ~4 probes too). For longer power-of-2 sequences, the gap grows in **binary's favor**: interpolation drifts to O(n).

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Vanilla interpolation search

**Go:**
```go
package interp

// InterpolationSearch returns the index of target in a sorted slice, or -1.
// Slice MUST be sorted ascending and numeric. Best for uniform distributions.
func InterpolationSearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi && target >= arr[lo] && target <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo
            }
            return -1
        }
        // Use 64-bit math to avoid overflow on (target-arr[lo])*(hi-lo).
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        switch {
        case arr[pos] == target:
            return pos
        case arr[pos] < target:
            lo = pos + 1
        default:
            hi = pos - 1
        }
    }
    return -1
}
```

**Java:**
```java
public final class InterpolationSearch {
    private InterpolationSearch() {}

    /**
     * Returns the index of target, or -1 if absent.
     * Array MUST be sorted ascending. Best on uniform distributions.
     */
    public static int search(int[] arr, int target) {
        int lo = 0, hi = arr.length - 1;
        while (lo <= hi && target >= arr[lo] && target <= arr[hi]) {
            if (arr[lo] == arr[hi]) {
                return arr[lo] == target ? lo : -1;
            }
            // 64-bit math avoids overflow on (target - arr[lo]) * (hi - lo).
            long num  = (long)(target - arr[lo]) * (long)(hi - lo);
            long den  = arr[hi] - arr[lo];
            int  pos  = lo + (int)(num / den);
            if (arr[pos] == target) return pos;
            if (arr[pos] < target)  lo = pos + 1;
            else                    hi = pos - 1;
        }
        return -1;
    }
}
```

**Python:**
```python
def interpolation_search(arr: list[int], target: int) -> int:
    """Return index of target, or -1. arr MUST be sorted ascending."""
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        # Python int is arbitrary-precision, no overflow concern.
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[pos] == target:
            return pos
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return -1
```

### 9.2 Recursive interpolation search

**Go:**
```go
func InterpolationSearchRec(arr []int, target int) int {
    return rec(arr, target, 0, len(arr)-1)
}
func rec(arr []int, target, lo, hi int) int {
    if lo > hi || target < arr[lo] || target > arr[hi] {
        return -1
    }
    if arr[lo] == arr[hi] {
        if arr[lo] == target {
            return lo
        }
        return -1
    }
    pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
    switch {
    case arr[pos] == target:
        return pos
    case arr[pos] < target:
        return rec(arr, target, pos+1, hi)
    default:
        return rec(arr, target, lo, pos-1)
    }
}
```

**Java:**
```java
public static int searchRec(int[] arr, int target) {
    return rec(arr, target, 0, arr.length - 1);
}
private static int rec(int[] arr, int target, int lo, int hi) {
    if (lo > hi || target < arr[lo] || target > arr[hi]) return -1;
    if (arr[lo] == arr[hi]) return arr[lo] == target ? lo : -1;
    long num = (long)(target - arr[lo]) * (hi - lo);
    long den = arr[hi] - arr[lo];
    int  pos = lo + (int)(num / den);
    if (arr[pos] == target) return pos;
    if (arr[pos] < target)  return rec(arr, target, pos + 1, hi);
    return rec(arr, target, lo, pos - 1);
}
```

**Python:**
```python
def interpolation_search_rec(arr: list[int], target: int) -> int:
    def rec(lo: int, hi: int) -> int:
        if lo > hi or target < arr[lo] or target > arr[hi]:
            return -1
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[pos] == target:
            return pos
        if arr[pos] < target:
            return rec(pos + 1, hi)
        return rec(lo, pos - 1)
    return rec(0, len(arr) - 1)
```

> **Note:** Iterative is preferred for production. The recursive form is here for completeness; on adversarial input the stack can grow to O(n).

### 9.3 Find first occurrence with interpolation

If the array has duplicates and you want the leftmost index of `target`:

**Go:**
```go
func InterpolationFindFirst(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    result := -1
    for lo <= hi && target >= arr[lo] && target <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo
            }
            return result
        }
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if arr[pos] == target {
            result = pos
            hi = pos - 1     // keep searching left
        } else if arr[pos] < target {
            lo = pos + 1
        } else {
            hi = pos - 1
        }
    }
    return result
}
```

**Java:**
```java
public static int findFirst(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1, result = -1;
    while (lo <= hi && target >= arr[lo] && target <= arr[hi]) {
        if (arr[lo] == arr[hi]) {
            return arr[lo] == target ? lo : result;
        }
        long num = (long)(target - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (arr[pos] == target) {
            result = pos;
            hi = pos - 1;        // keep searching left
        } else if (arr[pos] < target) {
            lo = pos + 1;
        } else {
            hi = pos - 1;
        }
    }
    return result;
}
```

**Python:**
```python
def interpolation_find_first(arr, target):
    lo, hi, result = 0, len(arr) - 1, -1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else result
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[pos] == target:
            result = pos
            hi = pos - 1
        elif arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return result
```

---

<a name="patterns"></a>
## 10. Coding Patterns — Hybrid Fallback to Binary

The single most important production pattern: **bounded interpolation followed by binary search**. After K probes (typically 4–8) where interpolation has not converged, switch to binary. This guarantees O(log n) worst case while preserving O(log log n) average case on uniform data.

### Template (Python):

```python
def hybrid_interpolation_search(arr, target, max_interp=8):
    """Try interpolation for max_interp probes, then fall back to binary."""
    lo, hi = 0, len(arr) - 1
    probes = 0
    while lo <= hi and arr[lo] <= target <= arr[hi] and probes < max_interp:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        probes += 1
        if arr[pos] == target:
            return pos
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    # Binary search the remaining window.
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

### Template (Go):

```go
func HybridSearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    const maxInterp = 8
    probes := 0
    for lo <= hi && target >= arr[lo] && target <= arr[hi] && probes < maxInterp {
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo
            }
            return -1
        }
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        probes++
        switch {
        case arr[pos] == target:
            return pos
        case arr[pos] < target:
            lo = pos + 1
        default:
            hi = pos - 1
        }
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        switch {
        case arr[mid] == target:
            return mid
        case arr[mid] < target:
            lo = mid + 1
        default:
            hi = mid - 1
        }
    }
    return -1
}
```

### Template (Java):

```java
public static int hybridSearch(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1;
    int probes = 0;
    final int MAX_INTERP = 8;
    while (lo <= hi && target >= arr[lo] && target <= arr[hi] && probes < MAX_INTERP) {
        if (arr[lo] == arr[hi]) return arr[lo] == target ? lo : -1;
        long num = (long)(target - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        probes++;
        if (arr[pos] == target) return pos;
        if (arr[pos] < target) lo = pos + 1;
        else                   hi = pos - 1;
    }
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else                   hi = mid - 1;
    }
    return -1;
}
```

### Why this pattern matters:

This is the **only** form of interpolation search that should ever appear in production. It's what LevelDB / RocksDB use in their block-index interpolation lookups: try interpolation for a handful of probes, then bail to binary if the data turns out to be non-uniform within that block. The constant overhead is negligible; the worst-case guarantee is restored.

Memorize the template. The fallback boundary (`MAX_INTERP = 8`) is a tuneable constant — pick based on benchmarks on your specific data.

---

<a name="errors"></a>
## 11. Error Handling — Division by Zero and Overflow

### 11.1 Division by zero: `arr[lo] == arr[hi]`

The fatal case: every element in the current window is equal. The denominator `arr[hi] - arr[lo] = 0`. The fix:

```
if arr[lo] == arr[hi]:
    return lo if arr[lo] == target else -1
```

This single line prevents:
- `IntegerDivisionByZeroException` (Java).
- `panic: runtime error: integer divide by zero` (Go).
- `ZeroDivisionError` (Python).

In **floating-point** code, `0.0 / 0.0` returns `NaN`, which silently produces `pos = NaN`, which then cascades — perhaps to an out-of-range array access or an infinite loop. Equally bad. Guard regardless of type.

### 11.2 Integer overflow: `(target - arr[lo]) * (hi - lo)`

For `target = 2^30`, `arr[lo] = -2^30`, `hi - lo = 2^20`:
- `target - arr[lo] = 2^31` → **already overflows 32-bit signed**.
- Multiplied by `(hi - lo) = 2^20` → vastly overflows.

In Java / Go / C++ (signed 32-bit `int`), this produces undefined or wraparound behavior. The fix:

**Java:** cast operands to `long` *before* the multiplication:
```java
long num = (long)(target - arr[lo]) * (long)(hi - lo);
```

**Go:** cast to `int64`:
```go
pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
```

**Python:** no fix needed; arbitrary precision.

**C/C++:** use `int64_t` or `long long`.

### 11.3 Other error cases

| Error | Cause | Mitigation |
|---|---|---|
| `arr is null` (Java) | Forgot null check | `Objects.requireNonNull(arr)` |
| `arr is empty` | Length 0 | First iteration: `lo=0, hi=-1`, loop skipped, returns -1. Safe. |
| `arr not sorted` | Caller's responsibility | Optional debug `assert isSorted(arr)`. |
| `target < arr[0]` or `target > arr[n-1]` | Out of range | The `target >= arr[lo] && target <= arr[hi]` guard catches this in O(1). |
| `Floating-point NaN in arr` | Bad input | Filter before searching. NaN violates total order and breaks comparisons. |
| `pos < lo or pos > hi` after formula | Skewed distribution causes overshoot | Clamp: `pos = max(lo, min(hi, pos))`. |
| Infinite loop | Skewed data + bug in fallback condition | Use hybrid pattern with `probes < MAX_INTERP` cap. |

### 11.4 Clamping the probe position

Even with overflow guards, `pos` can land outside `[lo, hi]` on pathological data (e.g., when `target` lies on one of the endpoints exactly but the formula produces `pos = lo - 1`). Clamp defensively:

```python
pos = max(lo, min(hi, pos))
```

This adds one comparison per probe but bulletproofs the index. Many production implementations do this.

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Use the hybrid fallback pattern.** Pure interpolation in production is a liability. Always cap with a binary fallback after K probes.

2. **Profile your distribution first.** Interpolation only wins on uniform data. If you don't know your distribution, measure: plot value vs index for a sample. If it's a straight line, interpolation wins. If it's curved, stay with binary.

3. **Use 64-bit arithmetic everywhere.** The overflow risk is too high to skip; the speed cost is negligible.

4. **For small arrays (n < 1000), use binary search.** Interpolation's arithmetic overhead dominates its asymptotic advantage at small sizes.

5. **Beware of inner-loop division cost.** Modern CPUs make `imul` (multiplication) ~3 cycles but `idiv` (integer division) ~20–40 cycles. Each interpolation probe is ~10× the CPU cost of a binary probe. You break even only when you save many probes.

6. **Consider clamping `pos`** to `[lo+1, hi-1]` to guarantee the window shrinks each iteration. This trades a tiny constant slowdown for an O(log n) worst-case bound.

7. **For floating-point keys**, prefer the float formula (no overflow, no integer truncation). Use `double` precision.

8. **For huge arrays on disk**, interpolation can save real I/O. A SSTable index lookup at 100 µs per probe makes the difference between 5 probes (interpolation) and 30 probes (binary) very real — 0.5 ms vs 3 ms per query.

9. **For non-uniform data with known statistics** (e.g., known to be log-normal), use a **transformed key**: interpolate on `log(value)` instead of `value` directly. This is the principle behind **learned index structures** (Kraska et al., 2018) — train a model to predict position from value, then bisect a small residual range.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Document the distribution assumption.** Every interpolation search function should have a comment: "Assumes approximately uniform distribution; falls back to binary after K probes."
- **Always include a fallback.** Pure interpolation belongs in textbooks. Hybrid is the only production form.
- **Always guard `arr[lo] == arr[hi]`.** It's a one-line check; skip it and your code crashes on the first duplicate cluster.
- **Always use 64-bit arithmetic** in static-typed languages.
- **Always clamp `pos`** if you want a hard O(log n) ceiling.
- **Don't use interpolation search on non-numeric data.** Strings, UUIDs, structs — use binary search.
- **Don't use interpolation search when the worst case must be bounded** (real-time systems, regulatory environments).
- **Benchmark on your actual data**, not on synthetic uniform inputs. Real-world distributions often disappoint.
- **Test pathological inputs** explicitly: powers of 2, all-equal arrays, target-at-endpoints, single-element arrays, empty arrays.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty array | `[]`, target = anything | `-1` |
| Single element, match | `[7]`, target = 7 | `0` |
| Single element, no match | `[7]`, target = 5 | `-1` |
| All elements equal, match | `[5,5,5,5]`, target = 5 | `0` (or any index) |
| All elements equal, no match | `[5,5,5,5]`, target = 7 | `-1` (range check fails) |
| Target less than `arr[0]` | `[10,20,30]`, target = 5 | `-1` (fast-fail) |
| Target greater than `arr[n-1]` | `[10,20,30]`, target = 50 | `-1` (fast-fail) |
| Target equals first element | `[10,20,30]`, target = 10 | `0` |
| Target equals last element | `[10,20,30]`, target = 30 | `2` |
| Uniform data | `[10,20,30,...,1000]`, target = 500 | `49` in ~1–2 probes |
| Exponential data (pathological) | `[1,2,4,8,...,2^k]`, target = `2^k` | Found, but in O(k) = O(log n) probes |
| Negative values | `[-9,-3,0,4]`, target = -3 | `1` |
| Floating-point | `[0.1, 0.5, 1.7, 3.4]`, target = 1.7 | `2` (use float-safe formula) |
| Overflow risk | `target = INT_MAX`, `arr[0] = INT_MIN` | Use 64-bit arithmetic |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Forgetting the `arr[lo] == arr[hi]` guard.** Crashes on duplicates or repeated values in the window.
2. **32-bit overflow on `(target - arr[lo]) * (hi - lo)`.** Cast to 64-bit, always.
3. **Off-by-one on `pos + 1` / `pos - 1`.** Same trap as binary search's `mid + 1`. If you write `lo = pos` instead, the loop can hang on `lo == pos == hi`.
4. **Missing the range fast-fail `arr[lo] <= target <= arr[hi]`.** Without it, the algorithm wastes probes on out-of-range targets.
5. **Using interpolation search on strings or composite keys.** The arithmetic doesn't apply.
6. **No fallback to binary on bad probes.** Pathological inputs can degrade to O(n).
7. **Assuming O(log log n) without checking distribution.** Skewed data falls back to O(log n) at best, O(n) at worst.
8. **Computing `pos` in floating-point without clamping.** A tiny rounding error can produce `pos = hi + 1`, indexing out of bounds.
9. **Using recursion on large arrays.** O(n) worst-case depth → stack overflow.
10. **Benchmarking only on uniform random data.** Real workloads are rarely uniform; measure on actual data.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
THE FORMULA
    pos = lo + ((target - arr[lo]) * (hi - lo)) / (arr[hi] - arr[lo])

SETUP
    lo = 0
    hi = n - 1

LOOP
    while lo <= hi AND arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:                 (guard against /0)
            return lo if arr[lo] == target else -1
        pos = lo + ((target-arr[lo]) * (hi-lo)) / (arr[hi]-arr[lo])
              [use 64-bit math!]
        if arr[pos] == target: return pos
        if arr[pos] < target:  lo = pos + 1
        else:                  hi = pos - 1

NOT FOUND
    return -1

OVERFLOW SAFETY
    Cast (target-arr[lo]) and (hi-lo) to int64 before multiplying.

HYBRID FALLBACK (PRODUCTION)
    After K probes (K ≈ 4-8), switch to binary search on the remaining window.
    Guarantees O(log n) worst case.

COMPLEXITY
    Best:    O(1)
    Average: O(log log n) on uniform data
    Worst:   O(n) on pathological distributions
    Space:   O(1) iterative
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the array as horizontal cells, draws the **interpolation line** from `(lo, arr[lo])` to `(hi, arr[hi])`, and shows graphically where `pos` lands by intersecting the horizontal "target" line with the data line. A toggle lets you switch between **uniform** and **skewed** input to see the dramatic difference in probe count. Stats track probes vs. the theoretical `⌈log₂ log₂ n⌉` bound, plus a side-by-side comparison with binary search's `⌈log₂ n⌉`.

Watching the interpolation line snap to the right place in one or two probes on uniform data — and then meander all over a skewed array — is the fastest way to internalize why distribution matters.

---

<a name="summary"></a>
## 18. Summary

- Interpolation search predicts the target's position from the value distribution using **linear interpolation** between the window endpoints. The formula is `pos = lo + ((target - arr[lo]) * (hi - lo)) / (arr[hi] - arr[lo])`.
- Average case is **O(log log n)** on uniformly distributed data — dramatic for billion-element arrays. Worst case is **O(n)** on pathological distributions (powers of 2, exponential growth).
- Required guards: `arr[lo] == arr[hi]` to avoid division by zero; 64-bit arithmetic to avoid multiplication overflow; range check `arr[lo] <= target <= arr[hi]` for fast-fail.
- **Production code always uses the hybrid pattern**: try interpolation for K probes, fall back to binary search. This guarantees O(log n) worst case while preserving O(log log n) average.
- Best fit for **numeric, sorted, uniformly distributed** data: timestamps, sequence numbers, sensor readings, sequential IDs. Wrong tool for strings, composite keys, or skewed distributions.
- Real systems using interpolation search: LevelDB / RocksDB SSTable indexes, scientific time-series lookups, some PostgreSQL B-tree page-probe heuristics, network packet sequence-number lookups.

When the data shape is right, interpolation search is one of the few sublinear algorithms that beats binary search asymptotically. When it isn't, the fallback pattern keeps you out of trouble. Master both and you have a tool that's strictly superior to binary search on the right workload.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Peterson**, "Addressing for Random-Access Storage" (1957). The original interpolation search idea, applied to disk addressing.
- **Perl, Itai, & Avni**, "Interpolation Search — A Log Log N Search" (CACM, 1978). The first rigorous O(log log n) analysis on uniform inputs.
- **Knuth**, *The Art of Computer Programming, Volume 3: Sorting and Searching*, §6.2.1, exercises 22–24. Comparison-count derivation and the recurrence for log log n.
- **Mehlhorn & Tsakalidis**, "Dynamic Interpolation Search" (1993). Self-adjusting variant that maintains O(log log n) under insertions.
- **Kraska et al.**, "The Case for Learned Index Structures" (SIGMOD 2018). Modern generalization: train a neural model to predict position, fall back to local binary search. The intellectual descendant of interpolation search.
- **LevelDB source code**, `db/table_cache.cc` and SSTable block format. Real-world interpolation in a production key-value store.
- Continue with `middle.md` for hybrid implementations, variants, and benchmarking methodology.
