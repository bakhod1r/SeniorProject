# Prefix Sums & Difference Arrays — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a prefix sum? | Running total; `prefix[i] = a[0] + ... + a[i-1]`; one-time O(n) build |
| 2 | How do you get the range sum in O(1) after building the prefix? | `prefix[r+1] - prefix[l]`; explain why `r+1` and not `r` |
| 3 | Why store `prefix[0] = 0`? | Sentinel removes the special case when `l == 0` |
| 4 | What is the space cost of a prefix-sum array? | O(n) — one extra slot beyond the input |
| 5 | What is a difference array? | Stores `a[i] - a[i-1]`; range-update tool |
| 6 | How does a difference array let you do range updates in O(1)? | `diff[l] += v; diff[r+1] -= v`; reconstruct with a prefix sum |
| 7 | After many diff updates, how do you read element `a[i]`? | Take the prefix sum of `diff` up to `i`; O(n) reconstruct then O(1) lookup |
| 8 | Why use 64-bit integers for prefix sums? | Sums grow fast — easy to overflow 32-bit even with mid-sized arrays |
| 9 | If you only ever query one range, is prefix sum worth it? | No — direct loop is O(n) too; prefix sum wins only after multiple queries |
| 10 | What is the typical bug when computing range sum? | Off-by-one: `prefix[r] - prefix[l]` instead of `prefix[r+1] - prefix[l]` |
| 11 | Does prefix sum support range updates well? | No — every update costs O(n) to rebuild |
| 12 | Does difference array support point queries well? | Not until you reconstruct; then it is O(1) |
| 13 | What is the running total of `[2, 4, 1, 3]`? | `[0, 2, 6, 7, 10]` |
| 14 | How would you find the equilibrium index of an array? | Build prefix sum; for each i check `prefix[i] == total - prefix[i+1]` |
| 15 | Why is the difference array allocated with size n+1? | The right-boundary update `diff[r+1]` needs a valid index when `r == n-1` |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | When do you choose prefix sum vs Fenwick tree? | Static reads -> prefix; mixed updates and queries -> Fenwick (O(log n) both) |
| 2 | When does sliding window beat prefix sum + hash map? | Non-negative values + inequality on sum (`<= K`, `>= K`) -> sliding window |
| 3 | Why does prefix XOR work? | XOR has an inverse (itself): `(a ^ b) ^ a = b` |
| 4 | Why does prefix min NOT work for range queries? | Min has no inverse; cannot recover the per-range min from two prefix values |
| 5 | Write the 2D prefix-sum recurrence. | `P[i+1][j+1] = a[i][j] + P[i+1][j] + P[i][j+1] - P[i][j]` |
| 6 | Write the rectangle-sum formula in 2D. | `P[r2+1][c2+1] - P[r1][c2+1] - P[r2+1][c1] + P[r1][c1]` |
| 7 | Why are there four corners in 2D — inclusion-exclusion? | Yes — add top-right and bottom-left, subtract top-left twice means add it once more |
| 8 | Range update on a 2D submatrix — how many point updates on the diff? | Four: `+v` at `(r1, c1)` and `(r2+1, c2+1)`; `-v` at `(r1, c2+1)` and `(r2+1, c1)` |
| 9 | Why is the abelian-group property required for prefix-sum range queries? | Need an inverse to "subtract off" the left prefix |
| 10 | What is the time/space of a sparse table for range min queries? | O(n log n) build, O(1) query, O(n log n) space |
| 11 | Solve "Subarray Sum Equals K" in O(n). | Prefix sum + hash map of counts; look up `prefix[r+1] - K` |
| 12 | Solve "Subarray Sum Divisible by K" in O(n). | Prefix sum mod K + hash map; normalize negative residues |
| 13 | Difference between exclusive and inclusive scan? | Exclusive: `prefix[0] = 0`; inclusive: `prefix[0] = a[0]`. Convention A in this roadmap is exclusive |
| 14 | Will prefix product work if the array contains zero? | Only with care — segment around zeros or use modular inverses on a prime field |
| 15 | When does a 1D prefix sum beat a Fenwick tree even on dynamic data? | Never on truly dynamic — but for batched / offline updates followed by mass queries, yes |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is an integral image and where is it used? | Summed-area table; OpenCV `cv::integral`; Viola-Jones face detection; HOG features |
| 2 | How does Prometheus `rate(metric[5m])` work internally? | Subtracts counter values across the window, divides by elapsed time; detects and handles counter resets |
| 3 | How do you handle late-arriving data in a cumulative materialized view? | Partition-level re-aggregation; mark partitions dirty; or move to two-tier storage with live tail |
| 4 | What is the cost of `SUM(x) OVER (ORDER BY t)` in a SQL warehouse? | O(n) over the partition; engines use single-pass streaming; non-invertible windows (MIN/MAX) need deque algorithms |
| 5 | Explain a G-Counter CRDT. How is it like a prefix sum? | Each node maintains a local counter; total is the sum across nodes; cumulative semantics under eventual consistency |
| 6 | What goes wrong with cumulative tables and hot partitions? | Date-keyed cumulative tables get hammered on the latest partition; mitigate with hash prefix or replicas |
| 7 | When does floating-point drift bite a prefix sum? | Long sequences of summed floats lose precision — use Kahan summation or fixed-point integers |
| 8 | Why does `AVG()` rollup need to store `(sum, count)` instead of just `avg`? | Averages are not associative across blocks; pairs are, then merged at query time |
| 9 | How does a 3D prefix sum differ from 2D? | Eight-corner inclusion-exclusion; memory grows cubically; often block-decomposed |
| 10 | When should you replace a materialized cumulative table with a Fenwick-style structure? | When backdated writes are frequent and partition-level refresh is too coarse |
| 11 | What is the trade-off in Druid's roll-up tables? | Pre-aggregation reduces query work but loses fidelity; can't recover original rows |
| 12 | Why is the Viola-Jones cascade fast? | Integral image -> O(1) per Haar feature; cascade rejects most windows after a few features |
| 13 | How would you design a distributed range-sum service over time-series data? | Shard by time; per-shard prefix; coordinator merges; cache hot ranges |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove that range queries via subtraction require a group structure. | The Inverse-Required Lemma: if `f(P_{r+1}, P_l) = a_l*...*a_r` for all sequences then every `x` admits an inverse |
| 2 | State the Fredman-Saks lower bound for dynamic partial sums. | Any data structure with O(t_u) update and O(t_q) query satisfies `t_u + t_q = Omega(log n)` in the cell-probe model |
| 3 | Compare Hillis-Steele scan and Blelloch scan. | Hillis-Steele: O(log n) depth, O(n log n) work; Blelloch: O(log n) depth, O(n) work; Blelloch is work-efficient |
| 4 | What is the I/O complexity of building a prefix sum in the external-memory model? | O(n/B) block transfers — sequential, optimal |
| 5 | Why is parallel prefix sum a building block for sort and stream compaction? | Used in radix-sort bucket placement and in computing output positions in compaction kernels |
| 6 | Give an example of an abelian group used in number theory for prefix-product queries. | Multiplicative group of nonzero residues mod a prime; modular inverses via Fermat's little theorem |

---

## Coding Challenge (3 Languages)

### Challenge: Subarray Sum Equals K

> Given an integer array `nums` and an integer `k`, return the total number of contiguous subarrays whose sum equals `k`. The array can contain negative numbers, so sliding window does not apply. Target time complexity: O(n).
>
> Example: `nums = [1, 1, 1]`, `k = 2` -> output `2` (`[1,1]` at indices [0,1] and [1,2]).
>
> Example: `nums = [1, 2, 3]`, `k = 3` -> output `2` (`[3]` and `[1,2]`).

#### Go

```go
package main

import "fmt"

// SubarraySumK returns the number of contiguous subarrays summing to k.
// Approach: prefix sum + hash map of prefix-sum counts.
// Time: O(n). Space: O(n).
func SubarraySumK(nums []int, k int) int {
	// seen[s] = number of prefix-sum values that equal s so far.
	// Start with seen[0] = 1 to count the empty prefix.
	seen := map[int]int{0: 1}
	running := 0
	count := 0
	for _, v := range nums {
		running += v
		// We need: running - prefix_at_l == k, so prefix_at_l == running - k.
		if c, ok := seen[running-k]; ok {
			count += c
		}
		seen[running]++
	}
	return count
}

func main() {
	fmt.Println(SubarraySumK([]int{1, 1, 1}, 2))     // 2
	fmt.Println(SubarraySumK([]int{1, 2, 3}, 3))     // 2
	fmt.Println(SubarraySumK([]int{3, 4, 7, 2, -3, 1, 4, 2}, 7)) // 4
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Solution {
    /**
     * Number of contiguous subarrays summing to k.
     * Time: O(n). Space: O(n).
     */
    public static int subarraySumK(int[] nums, int k) {
        Map<Integer, Integer> seen = new HashMap<>();
        seen.put(0, 1); // empty prefix counts once
        int running = 0;
        int count = 0;
        for (int v : nums) {
            running += v;
            count += seen.getOrDefault(running - k, 0);
            seen.merge(running, 1, Integer::sum);
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(subarraySumK(new int[]{1, 1, 1}, 2));                         // 2
        System.out.println(subarraySumK(new int[]{1, 2, 3}, 3));                         // 2
        System.out.println(subarraySumK(new int[]{3, 4, 7, 2, -3, 1, 4, 2}, 7));         // 4
    }
}
```

#### Python

```python
from collections import defaultdict
from typing import List


def subarray_sum_k(nums: List[int], k: int) -> int:
    """Number of contiguous subarrays summing to k.

    Time: O(n). Space: O(n).
    Works with negatives because we never need monotonicity.
    """
    seen = defaultdict(int)
    seen[0] = 1  # empty prefix
    running = 0
    count = 0
    for v in nums:
        running += v
        count += seen[running - k]
        seen[running] += 1
    return count


if __name__ == "__main__":
    print(subarray_sum_k([1, 1, 1], 2))                       # 2
    print(subarray_sum_k([1, 2, 3], 3))                       # 2
    print(subarray_sum_k([3, 4, 7, 2, -3, 1, 4, 2], 7))       # 4
```

### Discussion Notes — what the interviewer is listening for

- **Why a hash map?** Because we need to count how many prior prefix sums equal `running - k`. Without the map, we would scan the prefix array per element — O(n^2).
- **Why `seen[0] = 1` initially?** It accounts for subarrays that start at index 0 (where the "left prefix" is the empty prefix, value 0).
- **Why not sliding window?** Sliding window requires the running sum to behave monotonically when expanding/shrinking the window. Negative numbers break this monotonicity.
- **Edge cases to mention**: empty array (return 0), single-element array equal to k (return 1), all-zero array with k = 0 (n choose 2 plus n subarrays).
- **Space**: O(n) for the hash map. Cannot be reduced without losing correctness for negatives.
- **Follow-up question often asked**: "Now find the longest subarray with sum k." Same map, store the first-seen index of each prefix sum and track `i - seen[running - k]`.
