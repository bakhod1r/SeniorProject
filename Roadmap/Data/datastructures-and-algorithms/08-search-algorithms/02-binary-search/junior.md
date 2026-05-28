# Binary Search — Junior Level

> **Read time: ~35 minutes** · **Audience:** First-year CS students, bootcamp grads, anyone who has just learned arrays and loops.

Binary Search is the **single most important O(log n) algorithm** you will ever learn. It is the algorithm that makes dictionaries usable, that makes databases fast, that makes `git bisect` find a bad commit out of ten thousand in fourteen tries, and that powers practically every "find an item in a sorted list" operation on the planet. If you understand it deeply, a vast amount of computer science suddenly clicks into place.

This document teaches you binary search **so thoroughly** that you will never write an off-by-one bug, never wonder whether the upper bound should be `<` or `<=`, and never confuse "find first" with "find last". We will cover the iterative form, the recursive form, the lower-bound and upper-bound variants, the "find first true" template that solves an entire family of LeetCode problems, the integer-overflow trap that famously broke Java's `Arrays.binarySearch` for nine years, and the visual mental model that makes all of it obvious.

---

## Table of Contents

1. [Introduction — Halve the Search Space](#introduction)
2. [Prerequisites — Sorted Data is REQUIRED](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — lo, hi, mid, three branches](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — "Find First True" Template](#patterns)
11. [Error Handling — Integer Overflow in `mid`](#errors)
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
## 1. Introduction — Halve the Search Space

You are looking up the word **"merengue"** in a paper dictionary that has 1,200 pages. You do **not** start at page 1 and read every entry. Instead, you flip to roughly the middle — page 600 — and you see the word "lemur". Lemur comes alphabetically **before** merengue, so you instantly know merengue is in pages 601–1,200. You discard the entire first half. You flip to roughly the middle of the remaining half — page 900 — and see "navy". Navy comes **after** merengue, so you discard pages 900–1,200. Now you only have pages 601–899. You repeat.

Each flip **halves** the number of pages you still have to consider. After:

- 1 flip: 600 pages remain
- 2 flips: 300 pages
- 3 flips: 150 pages
- 4 flips: 75
- ...
- 10 flips: ~1 page

Even with 1,200 pages, you find any word in **at most ⌈log₂(1200)⌉ = 11 flips**. That is binary search. Compare with the brute-force "read every page" approach (linear search), which takes up to 1,200 flips. Binary search is **109× faster** on this input. On 1 billion entries, linear search takes a billion comparisons; binary search takes 30. The gap grows without bound as data grows.

Binary search is the embodiment of the **divide-and-conquer** principle: cut the problem in half, recurse on the half that still contains the answer, and discard the rest. It works on *any* totally ordered, sequentially indexable data — a sorted array, a sorted slice of a file, a B-tree leaf node, a sorted view over a database column.

The catch — and it is non-negotiable — is that **the data MUST be sorted** in the order your comparison expects. If the data is not sorted, binary search gives wrong answers silently, with no error and no warning. Always confirm sortedness before using binary search; this is the single most common production bug.

---

<a name="prerequisites"></a>
## 2. Prerequisites — Sorted Data is REQUIRED

Before binary search applies, you must have:

1. **A sorted sequence.** Ascending order is conventional; descending works if you flip your comparisons. The sort order must be consistent with the comparison you use to navigate (`<`, `==`, `>`).
2. **Random access to elements by index in O(1).** Arrays, slices, and `ArrayList` work. Linked lists do **not** — walking to position `mid` in a linked list costs O(n), erasing the asymptotic advantage. (See `tasks.md` for the "binary search on a linked list" technique that uses skip-pointers, but for plain singly-linked lists, prefer linear search.)
3. **A total order.** For every pair `(a, b)`, exactly one of `a < b`, `a == b`, `a > b` holds. Floating-point `NaN` violates this — comparisons with `NaN` always return false, which can make binary search loop forever or return garbage. Filter out `NaN` first, or use a custom comparator that defines a total order.

If your data is **not** sorted, your options are:
- **Sort it first** (O(n log n)) and then search (O(log n)). Worth it only if you do many searches.
- **Use a hash table** (O(1) average lookup, O(n) build). Worth it for exact-match lookups when you don't need range queries or sorted iteration.
- **Use linear search** (O(n)). Fine for small `n` (under ~50 elements) or one-off searches.

**Rule of thumb:** Build a sorted array once, search it many times → binary search wins. Insert/delete frequently → use a balanced BST (`TreeMap`, `std::map`) or skip list, which give O(log n) for both.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Search space** | The contiguous range `[lo, hi]` of indices that *might* contain the target. Shrinks each iteration. |
| **`lo` (low)** | The lowest index still under consideration. Starts at 0. |
| **`hi` (high)** | The highest index still under consideration. Starts at `n - 1` (inclusive) or `n` (exclusive), depending on the variant. |
| **`mid` (middle)** | The index halfway between `lo` and `hi`, computed as `lo + (hi - lo) / 2` to avoid integer overflow. |
| **Target** | The value you are searching for. |
| **Predicate** | A function `f(index) -> bool` that is monotonic across the array (false…false true…true). Binary search finds the boundary. |
| **`lower_bound`** | The smallest index whose element is `>= target`. C++ STL standard term. Equivalent to Python `bisect.bisect_left`. |
| **`upper_bound`** | The smallest index whose element is `> target`. Python `bisect.bisect_right`. |
| **Insertion point** | Where `target` would be inserted to keep the array sorted. Same as `lower_bound` (or `upper_bound` if you place duplicates after). |
| **Off-by-one error** | The most common binary search bug: search loops too many or too few times due to `<` vs `<=` mistakes. |
| **Loop invariant** | A property that holds before, during, and after every iteration. The standard invariant is "if the target exists, it is within `[lo, hi]`". |
| **Monotonic predicate** | A boolean function over indices that flips from false to true exactly once. Binary search finds the flip point. |
| **Parametric search** | Binary search over the *answer space* (e.g., search over possible speeds for "Koko eating bananas") rather than over array indices. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — `lo`, `hi`, `mid`, three branches

### 4.1 The state: a window `[lo, hi]`

Binary search maintains a window of indices `[lo, hi]` that is guaranteed to contain the target if it exists at all. Initially `lo = 0` and `hi = n - 1` (using inclusive bounds). Each iteration, you compute `mid` and inspect `arr[mid]`, then **shrink** the window by reassigning `lo` or `hi`.

### 4.2 The midpoint

```
mid = lo + (hi - lo) / 2
```

We use `lo + (hi - lo) / 2` rather than `(lo + hi) / 2` because `lo + hi` can **overflow** a 32-bit signed integer when `lo + hi > 2^31 - 1`. This bug existed in `java.util.Arrays.binarySearch` from JDK 1.2 (1998) until 2006, when Joshua Bloch publicly disclosed it on the official Google Research blog. The fix:

```
// Buggy on huge arrays:
int mid = (lo + hi) / 2;

// Safe:
int mid = lo + (hi - lo) / 2;
// Or, in Java 8+:
int mid = (lo + hi) >>> 1;   // unsigned right shift treats overflow correctly
```

In Python this is a non-issue because `int` is arbitrary precision. In Go, slice indices are `int` (typically 64-bit on modern hardware), so the bug requires arrays larger than 4 EB to trigger — but the safe form is still good hygiene.

### 4.3 Three branches

After computing `mid`, compare `arr[mid]` to `target`:

| Comparison | Action | Reason |
|---|---|---|
| `arr[mid] == target` | Return `mid` | Found it. |
| `arr[mid] < target` | `lo = mid + 1` | Target is in the right half. Discard `arr[mid]` and everything left of it. |
| `arr[mid] > target` | `hi = mid - 1` | Target is in the left half. Discard `arr[mid]` and everything right of it. |

If the loop exits without returning, the target is not present. Conventionally, return `-1` (Java, Go) or the insertion point (Python's `bisect`).

### 4.4 The loop condition: `lo <= hi` vs `lo < hi`

Two equivalent styles:

**Style A — inclusive `[lo, hi]`, loop while `lo <= hi`:**

```
lo = 0
hi = n - 1
while lo <= hi:
    mid = lo + (hi - lo) // 2
    ...
```

**Style B — half-open `[lo, hi)`, loop while `lo < hi`:**

```
lo = 0
hi = n
while lo < hi:
    mid = lo + (hi - lo) // 2
    ...
```

**Pick one and stick with it.** Mixing styles is the #1 source of off-by-one bugs. This document standardizes on **Style A (inclusive)** for finding an exact match, and **Style B (half-open)** for `lower_bound` / `upper_bound` / "find first true".

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Best case** | O(1) — target is at `mid` on the first try |
| **Average case** | O(log n) |
| **Worst case** | O(log n) |
| **Space (iterative)** | O(1) — three integer variables |
| **Space (recursive)** | O(log n) — recursion stack depth |
| **Comparisons (worst)** | ⌈log₂(n + 1)⌉ — provably tight |
| **Cache behavior** | O(log n) cache misses for large arrays — see `professional.md` for Eytzinger layout |
| **Requires sorted input** | YES |

For `n = 1,000,000`: ~20 comparisons. For `n = 1,000,000,000`: ~30 comparisons. The logarithm is base 2.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Dictionary lookup
The opening example. You don't read a dictionary cover to cover; you flip and bisect. Same algorithm.

### 6.2 Guess the number
*"I'm thinking of a number between 1 and 100. Each guess, I'll tell you 'higher', 'lower', or 'correct'."*
Optimal strategy: guess 50. If higher, guess 75. If lower, guess 25. After 7 guesses you have the answer (`⌈log₂(100)⌉ = 7`). This is binary search where the "array" is the integer range and the comparison is the user's feedback.

### 6.3 Bisecting a Git history
`git bisect` finds the commit that introduced a bug. You mark a known good commit and a known bad commit; Git checks out the middle commit, you test, and tell Git "good" or "bad". Git halves the range each step. With 10,000 commits between good and bad, you only test ~14 of them. We cover this in `senior.md`.

### 6.4 Phone book (when those existed)
Open to the middle, see what name is there, decide which half. Same as the dictionary.

### 6.5 The blacksmith calibrating a pressure gauge
Apply too much pressure → reading high, back off. Apply too little → reading low, push more. Each adjustment is half the previous one. This is **binary search on a continuous range**, used in physics simulation and root-finding (the *bisection method* for finding zeros of continuous functions).

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros
- **Logarithmic time.** O(log n) is one of the fastest non-constant complexities possible.
- **Tiny memory footprint.** Iterative version uses three integers regardless of `n`.
- **Cache-friendly for small arrays.** A million-element int array fits in L2 cache on modern CPUs; binary search runs purely from cache after the first few iterations.
- **Predictable performance.** Worst case equals average case (within ±1 comparison). No pathological inputs.
- **Easy to verify.** Loop invariant `target ∈ [lo, hi] if it exists` is simple to prove.
- **Foundation for higher algorithms.** Binary search on the answer (parametric search), exponential search, ternary search, fractional cascading, and B-tree node search all build on it.

### Cons
- **Requires sorted input.** Sorting costs O(n log n) up front, which dominates if you only do a few searches.
- **Useless on unsorted or partially sorted data.** Silent wrong answers — no error.
- **Off-by-one bugs are notoriously easy.** Even Joshua Bloch's textbook implementation had a bug for nine years.
- **Cache-unfriendly on huge arrays.** For arrays larger than L3 cache (~30 MB), each iteration jumps to an unpredictable address. B-trees and Eytzinger layouts beat sorted arrays here.
- **Doesn't beat hash tables for exact-match lookup.** O(log n) is fast but O(1) is faster. Use a hash map if you don't need ordering, range queries, or stable iteration order.
- **Insertion is O(n) on a sorted array.** Adding an element requires shifting half the array on average. Use a `TreeMap` / B-tree / skip list if you insert frequently.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Search for `target = 23` in `[3, 7, 11, 15, 19, 23, 27, 31, 35, 39]` (n = 10).

```
Initial: lo=0, hi=9
Array:   [3, 7, 11, 15, 19, 23, 27, 31, 35, 39]
Indices:  0  1   2   3   4   5   6   7   8   9
```

**Iteration 1.**
```
mid = 0 + (9 - 0) / 2 = 4
arr[4] = 19
19 < 23  →  lo = mid + 1 = 5
```
Window: `[5, 9]`.

**Iteration 2.**
```
mid = 5 + (9 - 5) / 2 = 7
arr[7] = 31
31 > 23  →  hi = mid - 1 = 6
```
Window: `[5, 6]`.

**Iteration 3.**
```
mid = 5 + (6 - 5) / 2 = 5
arr[5] = 23
23 == 23  →  return 5
```
Found! Total comparisons: 3. Linear search would have taken 6.

---

Now search for `target = 22` (not present):

```
Iter 1: lo=0, hi=9, mid=4, arr[4]=19, 19<22, lo=5
Iter 2: lo=5, hi=9, mid=7, arr[7]=31, 31>22, hi=6
Iter 3: lo=5, hi=6, mid=5, arr[5]=23, 23>22, hi=4
Loop exits: lo=5 > hi=4. Return -1.
```

The "would-be insertion point" is `lo = 5`, which is where 22 would go to keep the array sorted. This is why Python's `bisect.bisect_left([3,7,11,15,19,23,27,31,35,39], 22) == 5`.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Iterative classic binary search

**Go:**
```go
package binsearch

// BinarySearch returns the index of target in a sorted slice, or -1 if absent.
// The slice MUST be sorted in ascending order.
func BinarySearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
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

**Java:**
```java
public final class BinarySearch {
    private BinarySearch() {}

    /**
     * Returns the index of target, or -1 if absent.
     * Array MUST be sorted ascending.
     */
    public static int search(int[] arr, int target) {
        int lo = 0, hi = arr.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;   // overflow-safe
            if (arr[mid] == target) return mid;
            if (arr[mid] < target) lo = mid + 1;
            else                   hi = mid - 1;
        }
        return -1;
    }
}
```

**Python:**
```python
def binary_search(arr: list[int], target: int) -> int:
    """Return index of target, or -1 if absent. arr MUST be sorted ascending."""
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2          # Python int is arbitrary-precision, no overflow
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### 9.2 Recursive binary search

**Go:**
```go
func BinarySearchRec(arr []int, target int) int {
    return rec(arr, target, 0, len(arr)-1)
}
func rec(arr []int, target, lo, hi int) int {
    if lo > hi {
        return -1
    }
    mid := lo + (hi-lo)/2
    switch {
    case arr[mid] == target:
        return mid
    case arr[mid] < target:
        return rec(arr, target, mid+1, hi)
    default:
        return rec(arr, target, lo, mid-1)
    }
}
```

**Java:**
```java
public static int searchRec(int[] arr, int target) {
    return rec(arr, target, 0, arr.length - 1);
}
private static int rec(int[] arr, int target, int lo, int hi) {
    if (lo > hi) return -1;
    int mid = lo + (hi - lo) / 2;
    if (arr[mid] == target) return mid;
    if (arr[mid] < target)  return rec(arr, target, mid + 1, hi);
    return rec(arr, target, lo, mid - 1);
}
```

**Python:**
```python
def binary_search_rec(arr: list[int], target: int) -> int:
    def rec(lo: int, hi: int) -> int:
        if lo > hi:
            return -1
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            return rec(mid + 1, hi)
        return rec(lo, mid - 1)
    return rec(0, len(arr) - 1)
```

> **Note:** For arrays of size > 1,000,000 the recursive version uses ~20 stack frames — fine. But **prefer iterative** for production code; the recursion adds zero performance benefit and forfeits O(1) space.

### 9.3 Find first occurrence (leftmost equal)

When the array has duplicates and you want the **smallest index** with `arr[i] == target`:

**Go:**
```go
func FindFirst(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    result := -1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            result = mid       // record candidate, keep looking left
            hi = mid - 1
        } else if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return result
}
```

**Java:**
```java
public static int findFirst(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1, result = -1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) {
            result = mid;
            hi = mid - 1;            // keep searching left
        } else if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}
```

**Python:**
```python
def find_first(arr, target):
    lo, hi, result = 0, len(arr) - 1, -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            result = mid
            hi = mid - 1                 # keep searching left
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return result
```

### 9.4 Find last occurrence (rightmost equal)

Symmetric: when `arr[mid] == target`, move `lo = mid + 1`.

**Go:**
```go
func FindLast(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    result := -1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            result = mid
            lo = mid + 1       // keep searching right
        } else if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return result
}
```

**Java:**
```java
public static int findLast(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1, result = -1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) {
            result = mid;
            lo = mid + 1;
        } else if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}
```

**Python:**
```python
def find_last(arr, target):
    lo, hi, result = 0, len(arr) - 1, -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            result = mid
            lo = mid + 1
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return result
```

### 9.5 Insertion point (`lower_bound`)

The smallest index `i` such that `arr[i] >= target`. Returns `len(arr)` if every element is `< target`.

**Go:**
```go
func LowerBound(arr []int, target int) int {
    lo, hi := 0, len(arr)             // half-open [lo, hi)
    for lo < hi {
        mid := lo + (hi-lo)/2
        if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    return lo
}
```

**Java:**
```java
public static int lowerBound(int[] arr, int target) {
    int lo = 0, hi = arr.length;       // half-open
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] < target) lo = mid + 1;
        else                   hi = mid;
    }
    return lo;
}
```

**Python:**
```python
from bisect import bisect_left
# Python ships it:
idx = bisect_left(arr, target)

# Or hand-rolled:
def lower_bound(arr, target):
    lo, hi = 0, len(arr)
    while lo < hi:
        mid = (lo + hi) // 2
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo
```

`upper_bound` is identical except `<=` replaces `<`. With these two primitives you can do `find_first = lower_bound`, `find_last = upper_bound - 1` (when present), `count_equal = upper_bound - lower_bound`.

---

<a name="patterns"></a>
## 10. Coding Patterns — "Find First True" Template

A huge number of binary-search problems reduce to: *given a monotonic boolean predicate `p(i)` over indices `[0..n)`, find the smallest `i` where `p(i)` is true.*

A predicate is **monotonic** if `p(i) = true` implies `p(j) = true` for all `j >= i`. The boolean sequence looks like `false, false, ..., false, true, true, ..., true`. Binary search finds the boundary.

### Template (Python):
```python
def find_first_true(lo: int, hi: int, predicate) -> int:
    """Smallest i in [lo, hi) where predicate(i) is True. Returns hi if never true."""
    while lo < hi:
        mid = (lo + hi) // 2
        if predicate(mid):
            hi = mid          # mid satisfies — try smaller
        else:
            lo = mid + 1      # mid does not — must go larger
    return lo
```

### Template (Go):
```go
func FindFirstTrue(lo, hi int, pred func(int) bool) int {
    for lo < hi {
        mid := lo + (hi-lo)/2
        if pred(mid) {
            hi = mid
        } else {
            lo = mid + 1
        }
    }
    return lo
}
```

### Template (Java):
```java
public static int findFirstTrue(int lo, int hi, IntPredicate p) {
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (p.test(mid)) hi = mid;
        else             lo = mid + 1;
    }
    return lo;
}
```

### Examples this template solves:

- **`lower_bound`**: `predicate(i) = arr[i] >= target`.
- **`upper_bound`**: `predicate(i) = arr[i] > target`.
- **First occurrence of element**: `lower_bound`, then check if `arr[result] == target`.
- **Search insert position** (LeetCode 35): exactly `lower_bound`.
- **Square root** (binary search on integers `[0..x]`, predicate `mid*mid > x`).
- **Koko eating bananas** (LeetCode 875): predicate "can Koko finish at speed `k` in `h` hours?".
- **Capacity to ship packages** (LeetCode 1011): predicate "can we ship in `d` days with capacity `c`?".

Memorize this template; it is one of the highest-leverage 12 lines of code in coding interviews. We cover all of these in `interview.md`.

---

<a name="errors"></a>
## 11. Error Handling — Integer Overflow in `mid`

The bug:
```
mid = (lo + hi) / 2          // BAD if lo + hi exceeds INT_MAX
```

When `lo + hi` overflows a 32-bit signed `int`, the result becomes a large negative number, and `(negative) / 2` is also negative. `arr[negative]` then either crashes (Java throws `ArrayIndexOutOfBoundsException`) or reads garbage memory (C/C++ undefined behavior). 

The fix:
```
mid = lo + (hi - lo) / 2     // SAFE: hi - lo is always non-negative and ≤ INT_MAX
```

Or in Java/C++ specifically:
```java
mid = (lo + hi) >>> 1;       // unsigned right shift; treats overflow as positive
```

In Go, slice indices are platform `int` (64-bit on amd64/arm64). Overflow requires arrays of >2^62 elements — impossible in current memory. Still, **always write the safe form**; it costs nothing and protects you when the code gets ported to int32 contexts (e.g., compiled to JS via gopherjs, or run on a 32-bit embedded target).

In Python, arbitrary-precision integers eliminate the bug entirely. But: if you write the same code in another language later, the safe form is a habit you want.

### Other error cases:

| Error | Cause | Mitigation |
|---|---|---|
| `arr is null` (Java) | Forgot null check | `Objects.requireNonNull(arr)` at top |
| `arr is empty` | Length 0 input | First iteration: `lo=0, hi=-1`, loop body skipped, returns `-1`. Works correctly. |
| `arr not sorted` | Caller's responsibility | Optional debug-only check `assert isSorted(arr)`; add a `sortedSearch` wrapper that asserts in dev builds. |
| `NaN in array` | Floating-point input | Filter before searching, or use a comparator that defines a total order on NaN. |
| `Comparator inconsistent` | Custom comparator violates total order | Implement `Comparable.compareTo` or `Comparator.compare` correctly: trichotomy and transitivity. |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Use the language's built-in.** `Arrays.binarySearch` (Java), `slices.BinarySearch` (Go 1.21+), `bisect_left` (Python), `std::lower_bound` (C++) are battle-tested and JIT-optimized. Only roll your own when you need a custom predicate.

2. **Prefer iterative over recursive.** Saves O(log n) stack space, avoids stack overflow on adversarial input, plays nicely with tail-call-impaired runtimes (JVM, Go).

3. **Branch-free comparisons help on modern CPUs.** Instead of `if arr[mid] < target { lo = mid + 1 } else { hi = mid }`, you can write conditional moves.

4. **For tiny arrays (n < 20), use linear search.** Branch prediction loves linear scans, while binary search has unpredictable jumps. The crossover is platform-specific; benchmark.

5. **For huge arrays (n > 10⁶), consider Eytzinger layout** (`professional.md`). It rearranges the array to improve cache locality, often 2–3× faster.

6. **Avoid `(lo + hi) / 2`.** Use `lo + (hi - lo) / 2`. Always.

7. **For unbounded data**, use **exponential search** first (double the upper bound until you exceed the target), then binary search the resulting range. See `middle.md`.

8. **Don't binary search a `LinkedList`.** Random access is O(n), making each iteration O(n) — total O(n log n), worse than linear search.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Document the precondition.** Every binary-search function should have a comment or docstring saying "input MUST be sorted ascending".
- **Pick one bound style** (inclusive `[lo, hi]` or half-open `[lo, hi)`) per file. Don't mix.
- **Test edge cases relentlessly.** Empty array, single element, target before all elements, target after all elements, target equal to every element, target with many duplicates.
- **Prefer the "find first true" template** for new problems. Once you internalize it, almost every variant becomes a one-line predicate change.
- **Don't reinvent.** `bisect`, `Arrays.binarySearch`, and `slices.BinarySearchFunc` exist for a reason.
- **Return the insertion point**, not just `-1`, when meaningful. Callers can decide whether to insert. (Java's `Arrays.binarySearch` returns `-(insertion_point) - 1` — clever but error-prone; Python's `bisect` returns the insertion point directly.)
- **For float ranges**, set a precision threshold instead of `lo == hi`. See `tasks.md` task 8.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty array | `[]`, target = anything | `-1` (or insertion point 0) |
| Single element, match | `[7]`, target = 7 | `0` |
| Single element, no match | `[7]`, target = 5 | `-1` (insertion 0) |
| Single element, no match (greater) | `[7]`, target = 9 | `-1` (insertion 1) |
| Target less than all | `[3,5,7]`, target = 1 | `-1` (insertion 0) |
| Target greater than all | `[3,5,7]`, target = 9 | `-1` (insertion 3) |
| Target equals first | `[3,5,7]`, target = 3 | `0` |
| Target equals last | `[3,5,7]`, target = 7 | `2` |
| All duplicates, match | `[5,5,5,5]`, target = 5, find_first | `0` |
| All duplicates, match | `[5,5,5,5]`, target = 5, find_last | `3` |
| Duplicates, missing | `[5,5,5,5]`, target = 4 | `-1` (insertion 0) |
| Two elements | `[3, 7]`, target = 5 | `-1` (insertion 1) |
| Negative values | `[-9,-3,0,4]`, target = -3 | `1` |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Off-by-one on `hi`.** Initializing `hi = len(arr)` but then using `arr[hi]` inside the loop → `IndexOutOfBounds`. If you use half-open bounds, never read `arr[hi]`.
2. **Wrong loop condition.** `while lo < hi` with inclusive bounds skips the last element. `while lo <= hi` with half-open bounds goes one past the end.
3. **`mid` not advancing.** When `arr[mid] != target`, you must do `lo = mid + 1` or `hi = mid - 1`, not `lo = mid` or `hi = mid` — otherwise the loop runs forever when `lo == hi == mid`.
4. **Integer overflow in `mid`.** `(lo + hi) / 2` can overflow. Always use `lo + (hi - lo) / 2`.
5. **Using binary search on unsorted data.** Returns nondeterministic garbage with no error.
6. **Using binary search on a linked list.** Each `mid` access is O(n); total complexity becomes O(n log n).
7. **Floating-point comparison with `==`.** `if arr[mid] == target` rarely works for floats due to rounding error. Use `abs(arr[mid] - target) < epsilon`.
8. **Not handling duplicates correctly.** Vanilla binary search returns *some* match; if you need the first or last, use those variants.
9. **Confusing return value semantics.** Java returns `-(insertion) - 1`; Python returns insertion point directly; Go returns `(index, found)`. Read the docs.
10. **Stack overflow on recursive variants.** Adversarial input (huge `n` and unfavorable bounds) can blow the recursion stack. Iterative is safer.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
SETUP
    lo = 0
    hi = n - 1               (inclusive)        OR    hi = n  (half-open)

LOOP
    while lo <= hi           (inclusive)        OR    while lo < hi  (half-open)
        mid = lo + (hi - lo) / 2
        if found:    return mid
        if too low:  lo = mid + 1
        if too high: hi = mid - 1               OR    hi = mid  (half-open)

NOT FOUND
    return -1                (or `lo` for insertion point)

VARIANTS
    Find first equal     →  on equal, hi = mid - 1, record mid
    Find last equal      →  on equal, lo = mid + 1, record mid
    Lower bound (>=t)    →  on arr[mid] >= t, hi = mid (half-open)
    Upper bound (>t)     →  on arr[mid] >  t, hi = mid (half-open)

COMPLEXITY
    Time:   O(log n)
    Space:  O(1) iter, O(log n) rec
    Comparisons: ⌈log₂(n+1)⌉
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the array as horizontal cells, shows the `lo`, `mid`, `hi` pointers above, greys out eliminated regions, and color-codes the comparison outcome (red for "mid too small", red for "mid too large", green for "found"). A speed slider, custom input field, and target field let you experiment. Stats display the iteration count, comparisons made, the theoretical `⌈log₂(n)⌉` bound, and the current window size.

Walking through a 30-element search step by step on the animation cements the mental model in a way that reading code cannot.

---

<a name="summary"></a>
## 18. Summary

- Binary search finds an element in a **sorted** array in O(log n) time and O(1) iterative space by halving the search window each step.
- Maintain a window `[lo, hi]`. Compute `mid = lo + (hi - lo) / 2`. Compare `arr[mid]` to target; shrink to the half that still might contain it.
- The "find first true" template (`while lo < hi: if pred(mid): hi=mid else: lo=mid+1`) generalizes to dozens of problems including `lower_bound`, `upper_bound`, parametric search, and root-finding.
- Off-by-one bugs and integer overflow are the two classic pitfalls. Pick a bound style and stick to it; always write `lo + (hi - lo) / 2`.
- Use the language's built-in (`bisect`, `Arrays.binarySearch`, `slices.BinarySearch`) when possible.
- Binary search beats hash tables for range queries, sorted iteration, and ordered structures (B-tree, skip list); hash tables beat binary search for unordered exact-match lookup.

Master this algorithm and you will see it everywhere — in `git bisect`, in B-tree page lookups, in event ordering by timestamp, in finding the right TLS certificate by hostname, in sorted snapshots of distributed key-value stores. It is the spine of practical computer science.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Knuth**, *The Art of Computer Programming, Volume 3: Sorting and Searching*, Section 6.2.1. The definitive treatment, including tight comparison-count proofs.
- **Bentley**, *Programming Pearls*, Chapter 4 ("Writing Correct Programs"). The most-quoted essay on why binary search is hard to write correctly.
- **Bloch**, "Extra, Extra — Read All About It: Nearly All Binary Searches and Mergesorts are Broken" (Google Research blog, 2006). The integer-overflow disclosure.
- **Sedgewick & Wayne**, *Algorithms*, 4th ed., Section 1.1 and Section 3.1. Practical implementations and analysis.
- **CLRS**, *Introduction to Algorithms*, Section 2.3.5 (binary search) and Section 12.3 (BST search, related). The textbook proof of correctness.
- **LeetCode** — problems 33, 34, 35, 69, 153, 162, 374, 410, 875, 1011, 4. Practice the patterns until the template is automatic.
- Continue with `middle.md` for `bisect_left/right`, exponential search, ternary search, and parametric search.
