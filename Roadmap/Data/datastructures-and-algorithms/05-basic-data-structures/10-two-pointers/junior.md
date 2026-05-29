# Two Pointers — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Corridor Intuition](#the-corridor-intuition)
3. [What Problem Does It Solve?](#what-problem-does-it-solve)
4. [The Three Variants](#the-three-variants)
   - [Variant A: Opposite-Direction (Converging)](#variant-a-opposite-direction-converging)
   - [Variant B: Same-Direction (Slow / Fast)](#variant-b-same-direction-slow--fast)
   - [Variant C: Two-Sequence Merge-Style](#variant-c-two-sequence-merge-style)
5. [Why Is It O(n)?](#why-is-it-on)
6. [Big-O Summary](#big-o-summary)
7. [Full Implementations](#full-implementations)
   - [Two-Sum on Sorted Array](#two-sum-on-sorted-array)
   - [Valid Palindrome](#valid-palindrome)
   - [Remove Duplicates From Sorted Array](#remove-duplicates-from-sorted-array)
8. [Common Mistakes](#common-mistakes)
9. [Cheat Sheet](#cheat-sheet)
10. [Visual Animation](#visual-animation)
11. [Summary](#summary)

---

## Introduction

The **two-pointer** technique is one of the simplest yet most powerful algorithmic patterns in your toolkit. Instead of nesting two loops to compare every pair of elements (which costs `O(n^2)`), you maintain just **two indices** (the "pointers") into an array, string, or linked list and slide them in a coordinated way. The combined movement of both pointers is bounded by `O(n)` — so most pair-finding, partitioning, and merging tasks collapse from quadratic to linear time.

If you only learn one algorithmic pattern early in your career, learn this one. It appears in coding interviews, in production string parsers, in database join algorithms, and in the merge step of merge sort. It is the workhorse pattern behind dozens of "elegant one-pass" solutions.

---

## The Corridor Intuition

Picture a long hallway with numbered doors `0, 1, 2, ..., n-1`. Two people, **L** and **R**, stand at the ends — **L** at door `0` and **R** at door `n-1`. They walk toward each other along the corridor, peeking into each door they reach. At every step, **one and only one** of them takes a step inward based on what they see. When they meet in the middle, the search is over.

That is the **converging** variant of two pointers. Two more variants exist:

- **Same-direction**: both start at door `0`; one walks fast, the other slow, and the slow walker only advances when an interesting door is found.
- **Merge-style**: there are **two** corridors (two arrays), one person in each, advancing whichever side currently has the smaller value.

All three share one essential property: each pointer moves **at most n positions in total**, so the work is `O(n)` regardless of how many comparisons happen along the way.

---

## What Problem Does It Solve?

A huge class of array/string problems naively requires comparing or processing **pairs** of elements:

```text
For every i, for every j > i: check some condition on (arr[i], arr[j])
```

Written like that, the runtime is `O(n^2)`. For `n = 10^5`, that is `10^10` operations — too slow.

But many of those pair problems have a **monotonic structure** you can exploit: if the pair `(i, j)` already fails (or already succeeds) in a known direction, then one whole side of the search space is dead. Two pointers turn that observation into a single linear pass.

Examples that go from `O(n^2)` to `O(n)`:

- "Find two numbers in a sorted array that sum to target."
- "Is this string a palindrome?"
- "Remove duplicates from a sorted array, in place."
- "Merge two sorted arrays into one sorted array."
- "Sort an array containing only 0, 1, 2 (Dutch national flag)."
- "Container with most water — pick two heights that hold the most."

---

## The Three Variants

### Variant A: Opposite-Direction (Converging)

Two pointers start at the two ends. Each iteration, you decide which pointer to move based on a comparison.

```text
[ a b c d e f g h ]
  L                R
        ...
        L  R
```

**When to use:** the array (or string) is **sorted** (or symmetric, like a palindrome), and the answer depends on **pairs** drawn from opposite ends.

**Loop skeleton:**

```text
l = 0
r = n - 1
while l < r:
    if condition(arr[l], arr[r]) is good:
        record answer
        l += 1; r -= 1   # or break, depending on problem
    else if too small:
        l += 1            # need a larger value on the left
    else:
        r -= 1            # need a smaller value on the right
```

**Canonical problems:**

| Problem | Move rule |
|---------|-----------|
| Two-sum on sorted array | sum<target -> l++, sum>target -> r-- |
| Valid palindrome | mismatch -> false; match -> l++, r-- |
| Container with most water | move the **shorter** wall inward |
| Reverse string in place | swap(l, r); l++, r-- |
| 3-sum (after sorting) | fix one index, two-pointer on the rest |

### Variant B: Same-Direction (Slow / Fast)

Both pointers start at index `0`. The **fast** pointer scans every element. The **slow** pointer only advances when the fast pointer finds something worth keeping or writing.

```text
[ a b c d e f g h ]
  S F
  S   F
    S   F
```

**When to use:** you need to **partition** the array in place, **filter** in place, or **compact** elements so that all "kept" items sit at the front.

**Loop skeleton:**

```text
slow = 0
for fast in range(n):
    if keep(arr[fast]):
        arr[slow] = arr[fast]
        slow += 1
# the first `slow` elements are the kept ones
```

**Canonical problems:**

| Problem | Slow rule |
|---------|-----------|
| Remove duplicates from sorted array | move slow when `arr[fast] != arr[slow-1]` |
| Move all zeros to the end | move slow when `arr[fast] != 0` |
| Partition by predicate | move slow when predicate(arr[fast]) is true |
| Sort colors (Dutch flag) | two slow pointers — one for 0s, one for 2s |
| Floyd's cycle detection | slow moves 1, fast moves 2 — meeting detects cycle |

### Variant C: Two-Sequence Merge-Style

One pointer in each of two arrays. At each step, advance the pointer whose current element is smaller (or whichever you should consume).

```text
A: [ 1 4 7 9 ]      B: [ 2 3 8 10 ]
     i                   j
```

**When to use:** both inputs are sorted, and you need to **merge**, **intersect**, **subtract**, or **compare** them.

**Loop skeleton:**

```text
i = 0; j = 0
while i < len(A) and j < len(B):
    if A[i] < B[j]:
        # consume A[i]
        i += 1
    elif A[i] > B[j]:
        # consume B[j]
        j += 1
    else:
        # match
        i += 1; j += 1
# handle leftovers in A or B
```

**Canonical problems:**

| Problem | Action on equal |
|---------|-----------------|
| Merge two sorted arrays | append both, advance both |
| Intersection of sorted arrays | output once, advance both |
| `isSubsequence(s, t)` | advance both on match, advance `t` on mismatch |
| Union of sorted arrays | output once, advance both |

This variant scales naturally to **k-way merge** (covered at senior level), which is the same algorithm with a min-heap over k pointers.

---

## Why Is It O(n)?

The runtime claim rests on one observation:

> Across the entire algorithm, **each pointer moves at most n positions**. Therefore, the total work is at most `2n` pointer steps, plus `O(1)` work per step — i.e., `O(n)`.

For the **converging** variant: `l` only increases (from `0` toward `r`), `r` only decreases (from `n-1` toward `l`). Together they take at most `n` total inward steps before they meet.

For the **slow/fast** variant: `fast` makes exactly `n` steps; `slow` makes at most `n`.

For the **merge** variant: `i + j` increases by exactly `1` per iteration and is bounded by `len(A) + len(B)`.

This kind of argument is called an **amortized** or **aggregate** analysis: instead of bounding the work per iteration, you bound the total work across all iterations and divide by the number of input items.

---

## Big-O Summary

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Converging scan | O(n) | O(1) | One pass with two end pointers |
| Slow/fast partition | O(n) | O(1) | One pass; writes in place |
| Two-sequence merge | O(n + m) | O(1) extra (output excluded) | Both pointers advance monotonically |
| Cycle detection (Floyd) | O(n) | O(1) | Slow x1, fast x2 |
| 3-sum (sort + two-pointer) | O(n^2) | O(1) extra | Sort is O(n log n); outer loop is O(n); inner two-pointer is O(n) |

**Compare with brute force**:

| Problem | Brute force | Two pointers |
|---------|-------------|--------------|
| Two-sum on sorted array | O(n^2) | O(n) |
| 3-sum | O(n^3) | O(n^2) |
| Palindrome check | O(n) (same!) | O(n) |
| Merge sorted arrays | O((n+m) log(n+m)) | O(n+m) |
| Remove duplicates in place | O(n^2) (shifts) | O(n) |

---

## Full Implementations

### Two-Sum on Sorted Array

**Problem:** Given a sorted array `nums` and a target `t`, find two indices `(i, j)` with `i < j` such that `nums[i] + nums[j] == t`. Return `(-1, -1)` if none exists.

**Approach:** Converging pointers. If the current sum is too small, the only way to grow it is to advance `l` (since the array is sorted). If too large, retreat `r`. If equal, you are done.

#### Go

```go
package twopointers

// TwoSumSorted returns the indices (i, j) with i < j such that
// nums[i] + nums[j] == target, or (-1, -1) if none exists.
// Precondition: nums is sorted in non-decreasing order.
// Time: O(n). Space: O(1).
func TwoSumSorted(nums []int, target int) (int, int) {
    l, r := 0, len(nums)-1
    for l < r {
        sum := nums[l] + nums[r]
        if sum == target {
            return l, r
        }
        if sum < target {
            l++ // sum too small: pull the left side up
        } else {
            r-- // sum too large: pull the right side down
        }
    }
    return -1, -1
}

// Usage:
// i, j := TwoSumSorted([]int{1, 3, 4, 5, 7, 11}, 9)
// fmt.Println(i, j) // 2 4  -> nums[2]+nums[4] = 4+5 = 9
```

#### Java

```java
public class TwoSumSorted {

    /**
     * Returns indices [i, j] with i < j such that nums[i] + nums[j] == target,
     * or [-1, -1] if no such pair exists.
     * Precondition: nums is sorted in non-decreasing order.
     * Time: O(n). Space: O(1).
     */
    public static int[] twoSumSorted(int[] nums, int target) {
        int l = 0, r = nums.length - 1;
        while (l < r) {
            int sum = nums[l] + nums[r];
            if (sum == target) {
                return new int[]{l, r};
            } else if (sum < target) {
                l++; // sum too small: pull the left side up
            } else {
                r--; // sum too large: pull the right side down
            }
        }
        return new int[]{-1, -1};
    }

    // Usage:
    // int[] result = twoSumSorted(new int[]{1, 3, 4, 5, 7, 11}, 9);
    // System.out.println(result[0] + " " + result[1]); // 2 4
}
```

#### Python

```python
def two_sum_sorted(nums: list[int], target: int) -> tuple[int, int]:
    """
    Return indices (i, j) with i < j such that nums[i] + nums[j] == target,
    or (-1, -1) if no such pair exists.
    Precondition: nums is sorted in non-decreasing order.
    Time: O(n). Space: O(1).
    """
    l, r = 0, len(nums) - 1
    while l < r:
        s = nums[l] + nums[r]
        if s == target:
            return l, r
        if s < target:
            l += 1   # sum too small: pull the left side up
        else:
            r -= 1   # sum too large: pull the right side down
    return -1, -1


# Usage:
# i, j = two_sum_sorted([1, 3, 4, 5, 7, 11], 9)
# print(i, j)  # 2 4 -> nums[2]+nums[4] = 4+5 = 9
```

**Why it is correct:** at every step you have eliminated either the leftmost or rightmost element from contention. If `nums[l] + nums[r] < t`, then `nums[l]` paired with any element to its right would only be smaller or equal — none of them can reach `t`. So `nums[l]` is never part of the answer, and we discard it by moving `l` right. The symmetric argument applies when `sum > t`.

---

### Valid Palindrome

**Problem:** Return `true` if `s` reads the same forward and backward. For the simple version, treat all characters equally.

**Approach:** Converging pointers. Compare `s[l]` and `s[r]`; if they ever differ, return `false`. Otherwise step inward.

#### Go

```go
package twopointers

// IsPalindrome returns true if s reads the same forward and backward.
// Time: O(n). Space: O(1).
func IsPalindrome(s string) bool {
    l, r := 0, len(s)-1
    for l < r {
        if s[l] != s[r] {
            return false
        }
        l++
        r--
    }
    return true
}

// Usage:
// fmt.Println(IsPalindrome("racecar")) // true
// fmt.Println(IsPalindrome("hello"))   // false
```

#### Java

```java
public class Palindrome {

    /**
     * Returns true if s reads the same forward and backward.
     * Time: O(n). Space: O(1).
     */
    public static boolean isPalindrome(String s) {
        int l = 0, r = s.length() - 1;
        while (l < r) {
            if (s.charAt(l) != s.charAt(r)) {
                return false;
            }
            l++;
            r--;
        }
        return true;
    }

    // Usage:
    // System.out.println(isPalindrome("racecar")); // true
    // System.out.println(isPalindrome("hello"));   // false
}
```

#### Python

```python
def is_palindrome(s: str) -> bool:
    """
    Return True if s reads the same forward and backward.
    Time: O(n). Space: O(1).
    """
    l, r = 0, len(s) - 1
    while l < r:
        if s[l] != s[r]:
            return False
        l += 1
        r -= 1
    return True


# Usage:
# print(is_palindrome("racecar"))  # True
# print(is_palindrome("hello"))    # False
```

**Variation — alphanumeric only:** if the problem says "ignore non-alphanumeric and case," wrap the comparison: skip non-alphanumeric on each side and lowercase before comparing. The structure stays the same.

---

### Remove Duplicates From Sorted Array

**Problem:** Given a sorted array `nums`, modify it in place so each unique value appears exactly once, and return the new length `k`. The first `k` slots must contain the unique values in order; whatever is beyond `k` is irrelevant.

**Approach:** Slow/fast variant. `slow` is the write cursor — it points to where the next unique value will go. `fast` scans every element. When `nums[fast]` differs from `nums[slow-1]`, it is a new unique value, so we write it at `nums[slow]` and advance `slow`.

#### Go

```go
package twopointers

// RemoveDuplicates compacts a sorted array so each unique value appears once.
// Returns the new length k. nums[0..k-1] contains the unique values in order.
// Time: O(n). Space: O(1).
func RemoveDuplicates(nums []int) int {
    if len(nums) == 0 {
        return 0
    }
    slow := 1
    for fast := 1; fast < len(nums); fast++ {
        if nums[fast] != nums[slow-1] {
            nums[slow] = nums[fast]
            slow++
        }
    }
    return slow
}

// Usage:
// nums := []int{1, 1, 2, 3, 3, 4}
// k := RemoveDuplicates(nums)
// fmt.Println(k, nums[:k]) // 4 [1 2 3 4]
```

#### Java

```java
public class RemoveDuplicates {

    /**
     * Compacts a sorted array so each unique value appears once.
     * Returns the new length k. nums[0..k-1] holds the unique values in order.
     * Time: O(n). Space: O(1).
     */
    public static int removeDuplicates(int[] nums) {
        if (nums.length == 0) return 0;
        int slow = 1;
        for (int fast = 1; fast < nums.length; fast++) {
            if (nums[fast] != nums[slow - 1]) {
                nums[slow] = nums[fast];
                slow++;
            }
        }
        return slow;
    }

    // Usage:
    // int[] nums = {1, 1, 2, 3, 3, 4};
    // int k = removeDuplicates(nums);
    // System.out.println(k); // 4 ; nums[0..3] = {1, 2, 3, 4}
}
```

#### Python

```python
def remove_duplicates(nums: list[int]) -> int:
    """
    Compact a sorted list in place so each unique value appears once.
    Return the new length k. nums[:k] contains the unique values in order.
    Time: O(n). Space: O(1).
    """
    if not nums:
        return 0
    slow = 1
    for fast in range(1, len(nums)):
        if nums[fast] != nums[slow - 1]:
            nums[slow] = nums[fast]
            slow += 1
    return slow


# Usage:
# nums = [1, 1, 2, 3, 3, 4]
# k = remove_duplicates(nums)
# print(k, nums[:k])  # 4 [1, 2, 3, 4]
```

**Why it is correct:** the invariant is that `nums[0..slow-1]` always contains the distinct values seen so far, in sorted order. On each iteration, `nums[fast]` is either equal to `nums[slow-1]` (already represented — skip) or strictly greater (because the input is sorted — so it is a new value that must be written at `nums[slow]`).

---

## Common Mistakes

| Mistake | What goes wrong | Fix |
|---------|----------------|-----|
| Forgetting to advance a pointer | Infinite loop when neither pointer moves | At least one pointer must move every iteration |
| Wrong loop bound (`l <= r` vs `l < r`) | Off-by-one; pair with itself | For pair problems use `l < r` |
| Moving the wrong pointer | Wrong answer for "container with most water" | Move the **worse** side (shorter wall) inward |
| Assuming sorted input when it is not | Two-sum returns wrong indices | Sort first, or use a hash set instead |
| Missing tail elements in merge variant | Lose trailing items | After the main loop, drain whichever side has leftovers |
| 3-sum duplicates | Same triple reported many times | Skip equal neighbors on both pointers and the fixed index |
| Off-by-one when writing in place | Overwrites first element | Slow starts at 1 for "removeDuplicates" (the 0th item is always kept) |
| Treating slow/fast like converging | Both move together — defeats the partition | Slow only advances **conditionally** |

---

## Cheat Sheet

| Pattern | Start positions | Move rule | Use for |
|---------|----------------|-----------|---------|
| Converging | `l=0`, `r=n-1` | Move based on comparison vs target | Sorted-array pair problems, palindromes |
| Slow/fast | `slow=0`, `fast=0` | Fast always; slow when keep(fast) | In-place partition / filter / compact |
| Merge-style | `i=0`, `j=0` (two arrays) | Advance the smaller side | Merge / intersect / subsequence |
| Cycle detection (Floyd) | both at head | slow x1, fast x2 | Linked list / functional iteration cycles |

**Template invariant per variant:**

- Converging: "the answer, if it exists, must lie within `[l, r]`."
- Slow/fast: "`nums[0..slow-1]` is the correctly compacted prefix."
- Merge: "all elements before `i` in A and before `j` in B have been consumed."

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization of all three two-pointer variants on an array. You can switch the demo between two-sum, palindrome check, and removeDuplicates, change the input, and step through each pointer movement.

---

## Summary

| Concept | Key Point |
|---------|-----------|
| **Two pointers** | Two coordinated indices replace a nested `O(n^2)` loop |
| **Variant A — converging** | Move inward from both ends; needs sorted/symmetric data |
| **Variant B — slow/fast** | Fast scans, slow writes; in-place partition or filter |
| **Variant C — merge-style** | Two sequences, advance the smaller side |
| **Runtime** | `O(n)` because each pointer crosses the array at most once |
| **Invariant thinking** | At every step you can name what is true about the prefixes and suffixes |
| **Closely related** | Sliding window (topic 11), binary search (section 08), monotonic stack/queue (topics 13/14) |

Two pointers is your first "algorithmic super-tool": it turns a wide class of `O(n^2)` problems into clean linear-time solutions with constant extra space. Once you internalize the three skeletons above, you will start spotting them in problems where they were not obvious. Practice writing them without looking, and you will recognize the pattern within seconds of reading a problem statement.

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — Chapter 2 (merge) and Chapter 9 (selection); the merge subroutine is the canonical Variant C
- *Elements of Programming Interviews* — chapter on Arrays
- *Programming Pearls* by Jon Bentley — Column 2, "Aha! Algorithms"
- Topic 11 in this roadmap — Sliding Window (the closest cousin of two pointers)
- Topic 13 in this roadmap — Monotonic Stack (alternative approach to "trapping rain water")
- LeetCode tag "Two Pointers" — over 100 curated problems
