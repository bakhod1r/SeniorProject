# Two Pointers — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing the Variant](#choosing-the-variant)
3. [Invariant Analysis — The Heart of Correctness](#invariant-analysis--the-heart-of-correctness)
4. [Two Pointers vs Sliding Window](#two-pointers-vs-sliding-window)
5. [Two Pointers vs Binary Search](#two-pointers-vs-binary-search)
6. [Template Forms](#template-forms)
7. [Classic Problem Catalog](#classic-problem-catalog)
8. [Worked Example — 3-Sum](#worked-example--3-sum)
9. [Worked Example — Container With Most Water](#worked-example--container-with-most-water)
10. [Worked Example — Sort Colors (Dutch Flag)](#worked-example--sort-colors-dutch-flag)
11. [Common Pitfalls at Middle Level](#common-pitfalls-at-middle-level)
12. [Summary](#summary)

---

## Introduction

At the junior level you learned three two-pointer skeletons. At the middle level you should be able to look at a problem, **classify which variant applies**, **name the invariant** that makes the algorithm correct, and **defend the choice** over alternatives like sliding window, binary search, or hashing.

The hard part is not writing the loop — it is justifying *why advancing the left pointer is safe* after a failed comparison. That justification is always some monotonic property of the input. If you cannot articulate the monotonicity, two pointers is probably the wrong tool.

---

## Choosing the Variant

A short decision flowchart:

```text
1. Is the input a single sorted (or symmetric) sequence
   and the answer involves PAIRS from opposite ends?
        -> Variant A: converging pointers.

2. Is the task to MODIFY a single array in place
   (partition, compact, filter, dedup, segregate)?
        -> Variant B: slow/fast pointers.

3. Are there TWO sorted sequences and the task is to
   merge / intersect / subtract / compare them element by element?
        -> Variant C: merge-style two pointers.

4. None of the above but there is monotonic structure
   over contiguous subarrays?
        -> Sliding window (see topic 11).

5. Random access into a sorted space, bisecting on a predicate?
        -> Binary search (see section 08).
```

When the problem is "find a pair / triplet / subarray with property X," the very first reflex should be:

1. Can I sort the array (does ordering preserve the answer)?
2. After sorting, is there a monotone "if pair fails on left, no need to check rightward"?
3. If yes -> two pointers. If the predicate operates on a **contiguous window** rather than two endpoints, sliding window. If the predicate is **purely monotone over the whole range**, binary search.

---

## Invariant Analysis — The Heart of Correctness

A two-pointer algorithm is correct iff at every step you can write down two things:

1. **The invariant** — a property of the input that holds before and after every iteration.
2. **The justification for advancing exactly one side** — why the discarded slice cannot contain a better answer.

### Example — Two-Sum on Sorted Array

**Invariant:** any valid answer `(i*, j*)` satisfies `l <= i* < j* <= r`.

**Justification on `sum < target`:** the only way to grow the sum without changing `r` is to push `l` rightward. But also, the pair `(l, anything <= r)` is bounded by `nums[l] + nums[r]` which is `< target`. So **no pair involving the current `l` can ever reach `target`**. Discarding `l` is safe.

**Symmetric justification on `sum > target`:** no pair involving the current `r` can reach `target` (every smaller `nums[i] < nums[l]` is even further off).

### Example — Container With Most Water

**Invariant:** the optimal `(l*, r*)` satisfies `l <= l* < r* <= r`.

**Justification:** the area is `min(h[l], h[r]) * (r - l)`. If we move the **taller** side inward, `r - l` shrinks **and** the height bound (the shorter side) is unchanged or smaller — area can only go down. So moving the taller side is **never useful**; we must move the shorter side. The discarded position cannot beat the current area paired with any other index, because the shorter side bounds them all.

### Example — RemoveDuplicates

**Invariant:** `nums[0..slow-1]` is the unique-prefix of `nums[0..fast-1]`, in sorted order.

**Inductive step:** if `nums[fast] == nums[slow-1]`, the prefix is already correct (do nothing). Otherwise the value is new (sorted -> strictly greater), so writing it at `nums[slow]` and incrementing `slow` preserves the invariant.

Every time you encounter a new two-pointer problem, write down the invariant **before** coding. If you cannot, the pointer movement is probably wrong.

---

## Two Pointers vs Sliding Window

Sliding window (topic 11) is often described as "two pointers in disguise" — but the patterns differ in **focus** and **correctness argument**.

| Aspect | Two pointers (converging or merge) | Sliding window |
|--------|-------------------------------------|----------------|
| Pointer roles | Independent — each makes a decision based on a comparison | Both bound a **contiguous window**; right expands, left shrinks |
| Typical question | "Find a pair/triple satisfying P" | "Find the longest/shortest contiguous subarray satisfying P" |
| Movement rule | Move the pointer whose side is "worse" | Right keeps moving; left moves only when window invariant breaks |
| Input | Often sorted | Order matters but no sort required |
| Auxiliary structure | Usually none | Often a hash map or counter (frequency of window contents) |
| Classic problem | 2-sum on sorted array | Longest substring without repeating characters |

The slow/fast variant is, technically, **the same shape** as a sliding window — both pointers move forward. The distinction is intent: slow/fast **writes** to the array to compact it; sliding window **reads** from the array to track a moving range.

**Rule of thumb:** if the problem asks about a contiguous subarray or substring, think **sliding window** first. If it asks about a **pair** or about **partitioning in place**, think **two pointers**.

---

## Two Pointers vs Binary Search

Both exploit some kind of monotonic structure, but on different axes.

| Aspect | Two pointers | Binary search |
|--------|--------------|---------------|
| Search strategy | Walk linearly from both ends | Bisect the search space |
| Time | O(n) | O(log n) |
| Requires | Some monotone relationship between pointer positions and the predicate | Sorted input, or a monotone predicate over the answer space |
| Random access | Helpful but not required (works on linked lists) | Mandatory |
| Cache behavior | Excellent — sequential | Poor — jumps around |
| Output | Often the **pair/triplet** itself | Often the **index/value** matching a predicate |

For two-sum on a sorted array, you can solve it **two ways**:

- Two pointers: O(n), one pass, no extra data.
- For each `i`, binary search for `target - nums[i]` in `nums[i+1..n-1]`: O(n log n).

Two pointers wins on raw speed and cache behavior, but binary search wins when you cannot iterate the full array (e.g., the data is a sorted file with random access, or you only need to test existence of a few candidates). At senior level, binary-search-on-answer (topic 08 in the search section) sometimes **uses** two pointers as a feasibility check inside `check(mid)`.

---

## Template Forms

### Converging Template

```text
function converge(arr, target):
    l, r = 0, n - 1
    while l < r:
        s = combine(arr[l], arr[r])    # sum, product, area, ...
        if predicate_satisfied(s, target):
            record_or_return(l, r)
            l += 1; r -= 1             # or break, problem-dependent
        elif need_larger(s, target):
            l += 1
        else:
            r -= 1
```

Key properties: **exactly one pointer moves each iteration**, and the loop terminates because `r - l` strictly decreases.

### Slow / Fast Template

```text
function partition(arr, keep):
    slow = 0
    for fast in range(n):
        if keep(arr, fast, slow):
            arr[slow] = arr[fast]   # or swap(arr, slow, fast) to preserve discarded
            slow += 1
    return slow                     # length of the kept prefix
```

Slow advances **at most** once per fast step; fast always advances. Total work `O(n)`.

### Merge-Style Template

```text
function merge_walk(A, B):
    i = j = 0
    while i < len(A) and j < len(B):
        if A[i] < B[j]:
            emit_left(A[i]); i += 1
        elif A[i] > B[j]:
            emit_right(B[j]); j += 1
        else:
            emit_match(A[i], B[j]); i += 1; j += 1   # or i += 1, problem-dependent
    while i < len(A): emit_left(A[i]);  i += 1
    while j < len(B): emit_right(B[j]); j += 1
```

`i + j` increases by exactly 1 (or 2 on a match), and is bounded by `|A| + |B|` -> `O(n + m)`.

### Dutch-Flag (Three Pointers) Template

```text
function dutch_flag(arr):
    lo = 0
    mid = 0
    hi = n - 1
    while mid <= hi:
        if arr[mid] < 1: swap(lo, mid); lo += 1; mid += 1
        elif arr[mid] > 1: swap(mid, hi); hi -= 1   # do NOT advance mid
        else: mid += 1
```

A useful generalization: three regions (`<1`, `==1`, `>1`) maintained by three pointers, all in one pass. Notice that on the `>1` branch we **do not** advance `mid`, because the swapped-in value still needs inspection.

---

## Classic Problem Catalog

### Converging Variant

| Problem | Move rule | Twist |
|---------|-----------|-------|
| Two-sum on sorted array | Standard | Direct |
| 3-sum | Fix `i`, two-pointer on `i+1..n-1`; sort first | Skip duplicates on all three positions |
| 4-sum | Fix `i, j`, two-pointer on rest | Same dedup pattern; O(n^3) |
| Container with most water | Move shorter side | Greedy correctness depends on width-x-height geometry |
| Trapping rain water (two-pointer alt) | Move side with smaller max | See topic 13 for monotonic-stack alternative |
| Valid palindrome (clean) | Compare and step | Trivial |
| Valid palindrome (alphanumeric only) | Skip non-alpha on each side first | Be careful: skip loops must not cross |
| Reverse string in place | Swap and step | Trivial |
| Palindromic substring (expand-around-center) | Start `l=r=i`, then `l=i,r=i+1` | Outer loop over centers, two-pointer inside |
| Pair with difference k | Sort, two pointer with one slow start | Symmetric difference test |
| Sort array by parity | Converging swap | One pass |

### Slow / Fast Variant

| Problem | Slow advances on | Twist |
|---------|-----------------|-------|
| Remove duplicates (sorted) | `nums[fast] != nums[slow-1]` | Standard |
| Remove duplicates allowing 2 copies | `nums[fast] != nums[slow-2]` | Generalization |
| Move zeros to end | `nums[fast] != 0` | Swap if you want O(1) writes |
| Partition by predicate | `pred(nums[fast])` | E.g., Lomuto pivot scheme in quicksort |
| Sort colors (Dutch flag) | Three regions | See template above |
| Floyd cycle detection | slow x1, fast x2 | Detect cycle in O(1) extra space |
| Find middle of linked list | slow x1, fast x2 | When fast hits end, slow is at midpoint |
| Detect cycle start node | Floyd phase 2 | Math: distance argument |

### Merge-Style Variant

| Problem | Equal-case rule | Twist |
|---------|-----------------|-------|
| Merge two sorted arrays | Output both, advance both | Drain leftovers |
| Intersect sorted arrays | Output once, advance both | Skip duplicates if set semantics |
| Is-subsequence(s, t) | On match advance both | Always advance `t` |
| Union of sorted arrays | Output once, advance both | Same as intersect but emit everything |
| Smallest common element | On match return | Advance smaller side |
| Merge sorted linked lists | Same algorithm with `.next` | Often introduced in linked-lists topic |
| K-way merge | Min-heap over k pointers | Generalization (see senior.md) |

### Mixed / Advanced

| Problem | Pattern |
|---------|---------|
| Trapping rain water | Converging with left_max / right_max |
| Subarray sum target (positive values only) | Sliding window (not two pointers) |
| Subarray sum target (any sign) | Prefix sum + hash (not two pointers) |
| Longest substring without repeats | Sliding window |
| Minimum window substring | Sliding window |
| Closest 3-sum | 3-sum variant; track best diff |
| Smaller pairs count | Sort + converging, count `r - l` on each hit |

---

## Worked Example — 3-Sum

**Problem:** Find all unique triplets `(a, b, c)` in `nums` with `a + b + c == 0`.

**Approach:**

1. Sort the array. This makes both the two-pointer sweep and duplicate-skipping possible.
2. For each `i` in `0..n-3`: run two-pointer on `nums[i+1..n-1]` searching for `-nums[i]`.
3. Skip duplicate `nums[i]` values to avoid duplicate triplets.
4. After recording a triplet, also skip duplicate `nums[l]` and `nums[r]`.

```text
Total time: O(n^2)
- Sort: O(n log n)
- Outer loop n iterations
- Inner two-pointer: O(n)
- 3-sum total: dominated by O(n^2)
```

#### Go

```go
package twopointers

import "sort"

// ThreeSum returns all unique triplets in nums that sum to 0.
// Time: O(n^2). Space: O(1) extra (excluding output).
func ThreeSum(nums []int) [][]int {
    sort.Ints(nums)
    var result [][]int
    n := len(nums)

    for i := 0; i < n-2; i++ {
        if nums[i] > 0 {
            break // all remaining sums are positive
        }
        if i > 0 && nums[i] == nums[i-1] {
            continue // skip duplicate first element
        }
        l, r := i+1, n-1
        for l < r {
            sum := nums[i] + nums[l] + nums[r]
            switch {
            case sum == 0:
                result = append(result, []int{nums[i], nums[l], nums[r]})
                l++
                r--
                for l < r && nums[l] == nums[l-1] {
                    l++ // skip duplicate left
                }
                for l < r && nums[r] == nums[r+1] {
                    r-- // skip duplicate right
                }
            case sum < 0:
                l++
            default:
                r--
            }
        }
    }
    return result
}
```

#### Java

```java
import java.util.*;

public class ThreeSum {
    public static List<List<Integer>> threeSum(int[] nums) {
        Arrays.sort(nums);
        List<List<Integer>> result = new ArrayList<>();
        int n = nums.length;
        for (int i = 0; i < n - 2; i++) {
            if (nums[i] > 0) break;
            if (i > 0 && nums[i] == nums[i - 1]) continue;
            int l = i + 1, r = n - 1;
            while (l < r) {
                int sum = nums[i] + nums[l] + nums[r];
                if (sum == 0) {
                    result.add(List.of(nums[i], nums[l], nums[r]));
                    l++; r--;
                    while (l < r && nums[l] == nums[l - 1]) l++;
                    while (l < r && nums[r] == nums[r + 1]) r--;
                } else if (sum < 0) {
                    l++;
                } else {
                    r--;
                }
            }
        }
        return result;
    }
}
```

#### Python

```python
def three_sum(nums: list[int]) -> list[list[int]]:
    """Return all unique triplets in nums that sum to 0. Time: O(n^2)."""
    nums.sort()
    result: list[list[int]] = []
    n = len(nums)
    for i in range(n - 2):
        if nums[i] > 0:
            break
        if i > 0 and nums[i] == nums[i - 1]:
            continue
        l, r = i + 1, n - 1
        while l < r:
            s = nums[i] + nums[l] + nums[r]
            if s == 0:
                result.append([nums[i], nums[l], nums[r]])
                l += 1
                r -= 1
                while l < r and nums[l] == nums[l - 1]:
                    l += 1
                while l < r and nums[r] == nums[r + 1]:
                    r -= 1
            elif s < 0:
                l += 1
            else:
                r -= 1
    return result
```

The dedup steps are subtle — drop one and you will report `[-1, -1, 2]` multiple times for `nums = [-1, -1, -1, 0, 1, 2, 2]`.

---

## Worked Example — Container With Most Water

**Problem:** Given heights `h[0..n-1]`, pick two indices `(i, j)` maximizing `min(h[i], h[j]) * (j - i)`.

**Approach:** Converging pointers, **move the shorter side**.

**Invariant + justification:** the optimum lies in `[l, r]`. When `h[l] < h[r]`, no pair `(l, k)` for any `k < r` can beat the current area: the width `k - l < r - l` and the bounding height is still `<= h[l]`. So `l` is provably dominated and can be discarded.

```text
Each iteration: O(1) work, one pointer moves -> O(n) total.
```

#### Go

```go
package twopointers

// MaxArea returns the maximum container area for heights h.
// Time: O(n). Space: O(1).
func MaxArea(h []int) int {
    l, r := 0, len(h)-1
    best := 0
    for l < r {
        width := r - l
        var height int
        if h[l] < h[r] {
            height = h[l]
            l++ // move the shorter side
        } else {
            height = h[r]
            r--
        }
        if area := width * height; area > best {
            best = area
        }
    }
    return best
}
```

#### Java

```java
public class MaxArea {
    public static int maxArea(int[] h) {
        int l = 0, r = h.length - 1, best = 0;
        while (l < r) {
            int width = r - l;
            int height;
            if (h[l] < h[r]) {
                height = h[l];
                l++;
            } else {
                height = h[r];
                r--;
            }
            best = Math.max(best, width * height);
        }
        return best;
    }
}
```

#### Python

```python
def max_area(h: list[int]) -> int:
    """Container With Most Water. Time: O(n). Space: O(1)."""
    l, r = 0, len(h) - 1
    best = 0
    while l < r:
        width = r - l
        if h[l] < h[r]:
            height = h[l]
            l += 1
        else:
            height = h[r]
            r -= 1
        best = max(best, width * height)
    return best
```

---

## Worked Example — Sort Colors (Dutch Flag)

**Problem:** `nums` contains only `0`, `1`, `2`. Sort it in place in one pass.

**Approach:** Three pointers — `lo` (boundary of 0s), `mid` (current), `hi` (boundary of 2s).

**Invariants:**
- `nums[0..lo-1]` are all 0.
- `nums[lo..mid-1]` are all 1.
- `nums[hi+1..n-1]` are all 2.
- `nums[mid..hi]` is the unsorted region.

#### Go

```go
package twopointers

// SortColors sorts an array of {0,1,2} in one pass.
// Time: O(n). Space: O(1).
func SortColors(nums []int) {
    lo, mid, hi := 0, 0, len(nums)-1
    for mid <= hi {
        switch nums[mid] {
        case 0:
            nums[lo], nums[mid] = nums[mid], nums[lo]
            lo++
            mid++
        case 1:
            mid++
        case 2:
            nums[mid], nums[hi] = nums[hi], nums[mid]
            hi-- // mid does NOT advance; new value is unverified
        }
    }
}
```

#### Java

```java
public class SortColors {
    public static void sortColors(int[] nums) {
        int lo = 0, mid = 0, hi = nums.length - 1;
        while (mid <= hi) {
            if (nums[mid] == 0) {
                int t = nums[lo]; nums[lo] = nums[mid]; nums[mid] = t;
                lo++; mid++;
            } else if (nums[mid] == 1) {
                mid++;
            } else { // 2
                int t = nums[mid]; nums[mid] = nums[hi]; nums[hi] = t;
                hi--;
            }
        }
    }
}
```

#### Python

```python
def sort_colors(nums: list[int]) -> None:
    """One-pass sort of an array of {0,1,2}. Time: O(n). Space: O(1)."""
    lo, mid, hi = 0, 0, len(nums) - 1
    while mid <= hi:
        if nums[mid] == 0:
            nums[lo], nums[mid] = nums[mid], nums[lo]
            lo += 1
            mid += 1
        elif nums[mid] == 1:
            mid += 1
        else:  # 2
            nums[mid], nums[hi] = nums[hi], nums[mid]
            hi -= 1
```

The subtle part: in the `==2` case `mid` does **not** advance, because the value swapped from the back is unverified — it could be `0`, `1`, or another `2`.

---

## Common Pitfalls at Middle Level

| Pitfall | Diagnosis |
|---------|-----------|
| Sorting destroys the original index mapping | If the problem asks for **original indices**, do not use two pointers — use a hash map |
| 3-sum returns duplicate triplets | Forgot one of the three dedup skips (`i`, `l`, `r`) |
| Moving both pointers on a mismatch | Wastes information — usually one side is proven safe to discard |
| Using `l <= r` for pair problems | Allows pairing an index with itself |
| Two-pointer on unsorted data without justification | Without a monotone predicate, the algorithm is unsound |
| Mixing slow/fast with converging idea | Slow only moves conditionally — never "step both inward" |
| Forgetting to drain leftovers in merge | Loses elements at the end of one input |
| In Dutch flag, advancing `mid` after a swap with `hi` | The swapped value has not been classified yet |
| Using `int` sum where overflow is possible | 32-bit sum of two large ints can wrap; use 64-bit |

---

## Summary

At the middle level you should be able to:

- **Classify** a new problem into converging / slow-fast / merge in seconds.
- Write down the **loop invariant** before you write the loop.
- Justify **why advancing exactly one side is safe** by naming the monotonic property of the input.
- Distinguish two pointers from sliding window (window vs pair) and from binary search (linear vs logarithmic; sequential vs random access).
- Recognize the cases that defeat two pointers: unsorted data without sort, predicates without monotonicity, and problems requiring random access into the answer space.

Mastery shows up as **fluency**: when you read a problem statement and the pointers' starting positions, move rules, and termination condition appear in your head before you write a line of code.
