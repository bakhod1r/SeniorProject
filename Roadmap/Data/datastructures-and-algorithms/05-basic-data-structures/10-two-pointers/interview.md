# Two Pointers — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is the two-pointer technique? | Two coordinated indices over a sequence; reduces nested O(n^2) to O(n) |
| 2 | Name the three variants. | Converging (opposite ends), slow/fast (same direction), merge-style (two arrays) |
| 3 | What is the time complexity of valid-palindrome with two pointers? | O(n); each pointer moves at most n/2 steps |
| 4 | What is the space complexity? | O(1) extra; both pointers are just integers |
| 5 | Why does two-sum on a sorted array work with two pointers? | If sum < target only the left side can grow; if sum > target only the right side can shrink |
| 6 | What if the array is not sorted — can you still use two pointers for two-sum? | Sort it first (O(n log n)) OR use a hash set (O(n) avg) |
| 7 | When does sorting break two-sum? | When the problem requires original indices — sorting loses them; use a hash map |
| 8 | What is the difference between converging and slow/fast? | Converging starts at both ends and moves inward; slow/fast starts at 0 and both move forward, slow conditionally |
| 9 | What is Floyd's tortoise and hare? | Slow/fast in a linked list; slow moves 1, fast moves 2; meeting detects a cycle |
| 10 | How do you find the middle of a linked list in one pass? | Slow x1, fast x2; when fast hits end, slow is at midpoint |
| 11 | Why must at least one pointer move every iteration? | Otherwise the loop never terminates |
| 12 | What loop bound is correct for converging: `l < r` or `l <= r`? | `l < r` for pair problems; otherwise you pair an index with itself |
| 13 | Write the skeleton of slow/fast for removeDuplicates. | `slow=1; for fast in 1..n: if nums[fast]!=nums[slow-1]: nums[slow]=nums[fast]; slow++` |
| 14 | What is the time complexity of merging two sorted arrays of size m and n? | O(m + n) |
| 15 | Can two pointers run on a linked list? | Yes — slow/fast variant especially; converging is awkward without random access |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Compare two pointers vs sliding window. | Two pointers: pair from opposite ends, sorted data. Sliding window: contiguous range, often unsorted with a frequency map |
| 2 | Compare two pointers vs binary search. | Linear scan vs bisection; two pointers does not need random access; binary search needs sorted random-access data |
| 3 | Explain "container with most water" greedy move. | Move the shorter wall: width shrinks but the bounded height only increases when we discard the smaller side |
| 4 | How do you dedup 3-sum? | After sorting, skip equal neighbors on the fixed index AND on both pointers after a hit |
| 5 | Why does Dutch flag's `>1` branch NOT advance `mid`? | The value swapped from `hi` has not been inspected; it could be 0, 1, or 2 |
| 6 | What is the invariant of Dutch flag? | `[0..lo-1]` all 0s; `[lo..mid-1]` all 1s; `[hi+1..n-1]` all 2s; `[mid..hi]` unsorted |
| 7 | How does "move zeros to end" preserve relative order of non-zero elements? | Slow/fast writes non-zero values in order, then fills the rest with zeros |
| 8 | Can you use two pointers to find a subarray with sum = target? | Only with non-negative values (so the sum is monotone in window length); otherwise use prefix sum + hash |
| 9 | What is the trick for `isSubsequence(s, t)`? | Two pointers, advance both on match, advance `t` on mismatch; subsequence iff `i == len(s)` at end |
| 10 | When is the merge-style two-pointer comparison-optimal? | Always; merging two sorted sequences requires `n-1` comparisons in the worst case, which two pointers achieves |
| 11 | What is the relationship between two pointers and merge sort? | The merge step in merge sort IS variant C of two pointers |
| 12 | Give an example where two pointers fails because the data lacks monotonicity. | Two-sum on unsorted array; the sum-direction argument breaks |
| 13 | What is "expand around center" for palindromic substrings? | Outer loop over center positions; inner two-pointer expanding `l--, r++` while characters match |
| 14 | Explain trapping rain water with two pointers. | Track `left_max`, `right_max`; move the side with smaller max; water above the moved cell is `max - height[cell]` |
| 15 | Why is two pointers inherently sequential? | Each step depends on the previous comparison's outcome — a length-n data-dependency chain |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Where does two pointers appear in production database engines? | Sort-merge join inner loop; LSM compaction merges sorted SSTables; merge phase of external mergesort |
| 2 | How do you generalize merge-style two pointers to k sources? | k-way merge with a min-heap; O(N log k) total |
| 3 | What additional concerns appear when merging k distributed sorted streams? | Prefetching, per-stream batch size, backpressure, timeout handling for slow producers |
| 4 | Why is a buffered scanner (start/end pointers over a read buffer) a two-pointer pattern? | `start` is the slow/write cursor; `end` advances on each read; tokens are slices `[start, end)` |
| 5 | What is the memory advantage of in-place two pointers in a streaming pipeline? | Zero per-element allocation, no GC pressure; constant extra memory |
| 6 | When should you reach for sliding window instead of two pointers in a real system? | Contiguous-range aggregates (e.g., rolling sums, percentiles) where the window grows and shrinks based on a frequency-map invariant |
| 7 | How do you observe correctness of a two-pointer loop in production without per-iteration logging? | Aggregate counters: tokens emitted, ties resolved, drain leftover counts; alert if drain is unexpectedly large |
| 8 | How does two pointers compare with hash join for the equi-join operation? | Sort-merge: O((m+n) log (m+n)) prep + O(m+n) merge, sequential I/O. Hash join: O(m+n) avg but random I/O on probe; sort-merge wins on already-sorted/large data |
| 9 | What goes wrong if a single stream stalls in a k-way merge? | The min-heap can never advance past that stream's head — the whole merge stalls; use per-stream timeout |
| 10 | What is the parallel-computing limitation of two pointers? | Critical path equals the work; span = work = Theta(n); no asymptotic parallel speedup |
| 11 | How do you partition a two-pointer compaction across multiple cores? | Chunk the input range, partition independently in each chunk, then concatenate; not strictly correct for converging variants |
| 12 | What hardware behavior makes two pointers fast in practice? | Sequential memory access -> prefetcher predicts loads; tight inner loop -> branch prediction works; small loop body fits in I-cache |
| 13 | Describe a real-world failure caused by forgetting to drain leftovers in merge. | Logs cut off after the shorter source ends, dropping all later events from the longer source |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove correctness of two-sum on sorted array with loop invariants. | Invariant `I`: any valid (i*, j*) satisfies `l <= i* and j* <= r`. Show initialization, maintenance (3 cases), and termination via `phi = r - l` |
| 2 | Show the amortized argument for total O(n) work. | Define potential `phi = r - l` (or `i + j`); `phi` is non-negative integer, strictly decreases (or increases) per iteration; total iterations bounded by `n` |
| 3 | Prove the merge of two sorted sequences requires at least `n - 1` comparisons. | Adversary argument: alternating output forces a comparison between every adjacent A-B pair in the output |
| 4 | Is two pointers comparison-optimal for sorted two-sum? | No. The decision lower bound is Omega(log n), achieved by binary search; two pointers is Theta(n) |
| 5 | Then why prefer two pointers in practice? | Sequential cache behavior, no random access required, optimal for bulk-output and stream workloads |

---

## Coding Challenge — Container With Most Water

> **Problem.** Given an integer array `heights` of length `n`, where `heights[i]` is the height of a vertical line at index `i`, find two lines that, together with the x-axis, form a container holding the most water. Return the maximum amount of water it can store.
>
> Formally, maximize `min(heights[i], heights[j]) * (j - i)` over all `0 <= i < j < n`.

**Approach.** Converging two pointers. At every step, the area is `min(h[l], h[r]) * (r - l)`. Moving the **taller** wall inward shrinks the width without raising the height bound — area can only go down. So we must move the **shorter** wall inward. Track the maximum area seen.

**Time:** O(n). **Space:** O(1).

**Invariant.** The optimum `(l*, r*)` satisfies `l <= l* < r* <= r`. Justification: when `h[l] < h[r]`, every pair `(l, k)` for `k < r` has width `k - l < r - l` AND bounded height `<= h[l]`, so its area `<= h[l] * (r - l)`, which is the current area we just considered. So `l` cannot be part of a strictly-better answer; discarding it is safe.

#### Go

```go
package main

import "fmt"

// MaxArea returns the largest area of a container formed by two of the
// vertical lines in heights.
// Time: O(n). Space: O(1).
func MaxArea(heights []int) int {
    l, r := 0, len(heights)-1
    best := 0
    for l < r {
        width := r - l
        var h int
        if heights[l] < heights[r] {
            h = heights[l]
            l++ // discard the shorter wall
        } else {
            h = heights[r]
            r--
        }
        if area := width * h; area > best {
            best = area
        }
    }
    return best
}

func main() {
    fmt.Println(MaxArea([]int{1, 8, 6, 2, 5, 4, 8, 3, 7})) // 49
    fmt.Println(MaxArea([]int{1, 1}))                       // 1
    fmt.Println(MaxArea([]int{4, 3, 2, 1, 4}))              // 16
}
```

#### Java

```java
public class Solution {

    /**
     * Largest area of a container formed by two of the vertical lines.
     * Time: O(n). Space: O(1).
     */
    public static int maxArea(int[] heights) {
        int l = 0, r = heights.length - 1;
        int best = 0;
        while (l < r) {
            int width = r - l;
            int h;
            if (heights[l] < heights[r]) {
                h = heights[l];
                l++; // discard the shorter wall
            } else {
                h = heights[r];
                r--;
            }
            int area = width * h;
            if (area > best) best = area;
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(maxArea(new int[]{1, 8, 6, 2, 5, 4, 8, 3, 7})); // 49
        System.out.println(maxArea(new int[]{1, 1}));                      // 1
        System.out.println(maxArea(new int[]{4, 3, 2, 1, 4}));             // 16
    }
}
```

#### Python

```python
def max_area(heights: list[int]) -> int:
    """
    Largest area of a container formed by two of the vertical lines.
    Time: O(n). Space: O(1).
    """
    l, r = 0, len(heights) - 1
    best = 0
    while l < r:
        width = r - l
        if heights[l] < heights[r]:
            h = heights[l]
            l += 1   # discard the shorter wall
        else:
            h = heights[r]
            r -= 1
        area = width * h
        if area > best:
            best = area
    return best


if __name__ == "__main__":
    print(max_area([1, 8, 6, 2, 5, 4, 8, 3, 7]))  # 49
    print(max_area([1, 1]))                       # 1
    print(max_area([4, 3, 2, 1, 4]))              # 16
```

### Edge Cases the Interviewer Will Probe

| Input | Expected | Pitfall |
|-------|----------|---------|
| `[1, 1]` | 1 | Smallest valid input |
| `[1]` | 0 (or error) | No pair possible — depends on contract |
| `[]` | 0 (or error) | Empty array |
| `[4, 3, 2, 1, 4]` | 16 | Plateau values; both walls equal — does the answer depend on which one moves? (it does not, but you should explain why) |
| All equal heights | `(n - 1) * h` | Best pair is always the endpoints |
| Strictly increasing | `(n - 1) * heights[0]` | Bounded by the first (shortest) element |

### Follow-Ups the Interviewer May Ask

1. **What if you have to return the indices, not just the area?** Track `(best, best_l, best_r)` together.
2. **What if `n` is huge and the array is streamed?** You cannot use converging pointers (no random access from the right). You would need O(n) extra memory to buffer, or accept an approximate answer.
3. **Can you parallelize this?** The data dependency chain makes the converging variant un-parallelizable; you would split the array into chunks, find the best within each, then combine (which is incorrect because the optimum pair can span chunks). A correct parallel version requires more care.
4. **What is the relation to "trapping rain water"?** Same input format, different output. Trapping rain water also has a two-pointer solution (move the side with the smaller `max-so-far`) and an alternative monotonic-stack solution (see topic 13).
5. **Could you do it with a stack or DP instead?** Yes, but both are O(n) space and conceptually heavier. Two pointers is the textbook answer because it is `O(1)` space.

The interviewer is checking that you can name the greedy invariant ("move the shorter side"), justify why it preserves the optimum, write the loop cleanly, and identify the edge cases without prompting.
