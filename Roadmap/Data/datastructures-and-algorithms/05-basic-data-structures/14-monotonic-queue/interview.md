# Monotonic Queue — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a monotonic queue? | A deque whose contents are kept in monotone order (front-to-back) by a maintenance rule on push. |
| 2 | What problem does it solve? | Sliding window maximum / minimum in `O(n)` total time, vs `O(n * k)` brute force. |
| 3 | Decreasing deque or increasing deque for window max? | Decreasing — front holds the max. |
| 4 | Why store indices instead of values? | To detect when an element slides out of the window (front pop on `index < i - k + 1`). |
| 5 | What is the time complexity per element? | `O(1)` amortized. Worst-case for a single operation is `O(k)`. |
| 6 | What is the space complexity? | `O(k)` — deque holds at most `k` indices. |
| 7 | When do you pop from the front? | When the front index is no longer inside the current window (`< i - k + 1`). |
| 8 | When do you pop from the back? | When the back element's value is smaller than the incoming value (for window max). |
| 9 | Write the template for sliding window max. | See template in [junior.md](./junior.md). |
| 10 | What happens if the input is sorted increasing? | Each push triggers a flush of the deque from the back; the deque always holds exactly 1 index. |
| 11 | What happens if the input is sorted decreasing? | No back-pops happen; the deque grows to `k` then expires from the front one per step. |
| 12 | Difference between a deque and a queue? | A deque supports push/pop at both ends; a queue only supports push at the back and pop at the front. |
| 13 | Why does the brute-force approach fail at scale? | `O(n * k)` is too slow for typical `n, k = 10^5, 10^3` -> `10^8` ops. |
| 14 | What does "monotonic" mean? | A sequence that is entirely non-decreasing or entirely non-increasing. |
| 15 | When do you record the answer? | After processing index `i` if `i >= k - 1` — the first full window ends at index `k - 1`. |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Compare monotonic queue with monotonic stack. | Stack pops only from the top (no expiration), used for next-greater problems. Deque pops from both ends, needed when elements leave a window. |
| 2 | When is a monotonic deque the wrong tool? | When the access pattern is not a sliding window (e.g., random RMQ on a static array) — use sparse table or segment tree instead. |
| 3 | Compare monotonic deque vs heap for sliding window max. | Heap gives `O(n log k)` with lazy deletion; deque gives `O(n)`. Deque wins. |
| 4 | Compare monotonic deque vs segment tree. | Segment tree supports point updates and arbitrary range queries (`O(log n)`); deque supports only sliding windows (`O(1)` amortized). |
| 5 | What DP recurrence shape suggests a monotonic deque? | `f(i) = max_{j in [i-k, i-1]} f(j) + something(i)`. |
| 6 | How is Jump Game VI solved with a monotonic deque? | DP `f[i] = nums[i] + max f[j] for j in [i-k, i-1]`. Track max via decreasing deque on `f`. |
| 7 | Why use `<=` vs `<` in the back-pop? | Strict `<` keeps tied indices in the deque; `<=` drops older ties. For DP, `<=` is usually correct because the newer index lives longer. |
| 8 | How would you find the sum of (window_max - window_min) over all windows? | Run two deques in parallel (one decreasing for max, one increasing for min), sum the differences. |
| 9 | What if the window is time-based, not count-based? | Replace the expiration predicate from `index < i - k + 1` to `timestamp < now - window_ms`. |
| 10 | How does the constrained subsequence sum problem use a monotonic deque? | `f[i] = nums[i] + max(0, max f[j] for j in [i-k, i-1])`. Answer = max over all `f[i]`. |
| 11 | Can you build a monotonic deque that supports both max and min queries? | Yes — maintain two deques in parallel. Each is `O(1)` amortized per push. |
| 12 | What is convex hull trick and how does it relate? | A monotonic-deque-shaped structure maintaining a lower envelope of lines for DP optimization. Same push-back-with-maintenance pattern. |
| 13 | What is 0-1 BFS? Does it use a monotonic deque? | Shortest path on a 0/1-weighted graph using a deque (front-push for 0-edges, back-push for 1-edges). Not monotonic per se but uses deque mechanics. |
| 14 | How do you handle multiple test cases without re-allocating? | Reuse the same deque object, calling `clear()` between cases. |
| 15 | What library type would you use? | Go: `[]int` as slice or `container/list`. Java: `ArrayDeque<Integer>`. Python: `collections.deque`. |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How would you implement a rolling-max metric over the last 60 seconds in a high-throughput service? | Time-based monotonic deque keyed on (timestamp, value); front-pop on `timestamp < now - 60s`. Pre-allocated ring buffer for the deque storage. |
| 2 | How would you parallelize the sliding window max algorithm? | Block decomposition with prefix/suffix max per block. `O(n)` work, `O(log P)` span. |
| 3 | What happens to amortization in a streaming setting with bursty input? | Amortization still holds globally; individual events can have `O(k)` worst-case latency. For hard real-time, cap per-event work and defer. |
| 4 | How do you do sliding window max across a sharded stream? | Per-key, per-partition deque at the leaf; final reduce is a stateless `max` per key. |
| 5 | What memory bound does a time-based monotonic deque have? | Bounded by max events in the window, which is `max_event_rate * window_duration`. Use this for capacity planning. |
| 6 | How does the deque interact with garbage collection? | Per-event allocation kills throughput. Use `ArrayDeque` (Java), `collections.deque` (Python), or pre-allocated ring buffer (Go) to keep the working set static. |
| 7 | How do you make the deque thread-safe? | Either: shard by key so each thread owns its own deque, or wrap with a mutex (only acceptable for low-contention paths). Never share unsynced. |
| 8 | What observability signals would you expose? | `deque_size` gauge, `pushes_total`, `pops_front_total`, `pops_back_total`, `op_latency` histogram. Alert on size growing unboundedly. |
| 9 | What if the window does not fit in memory? | Approximation: time-bucketed coarsening (max per bucket) or hierarchical deques. Be explicit that the answer is approximate. |
| 10 | How does Flink expose this pattern? | `AggregateFunction` with monotonic-deque accumulator. Merging two windows is non-trivial; prefer reduce-by-leaf with a stateless max reducer. |
| 11 | When would you choose a monotonic deque over a token bucket for rate limiting? | When the limit is on a rolling extreme (max payload, max concurrency) rather than a rate (requests / second). |
| 12 | Lower bound for sliding window max? | `Omega(n)` to emit `n - k + 1` outputs. Monotonic deque achieves it. |
| 13 | Why does monotonic deque beat `O(n log k)` heap-based approach? | It does *less* work — only tracks values that can still become the max in some future window. Heaps over-solve by maintaining a full sorted structure. |

---

## Coding Challenge (3 Languages)

### Challenge: Sliding Window Maximum

> Given an integer array `nums` and a sliding window of size `k`, return an array of the maximum value in each window as the window moves left to right.
>
> Constraints:
> - `1 <= nums.length <= 10^5`
> - `1 <= k <= nums.length`
> - `-10^4 <= nums[i] <= 10^4`
>
> Required: `O(n)` time, `O(k)` space.

#### Go

```go
package main

import "fmt"

// maxSlidingWindow returns the maximum of every contiguous window of size k.
// Time:  O(n) — each index pushed once and popped at most once.
// Space: O(k) for the deque.
func maxSlidingWindow(nums []int, k int) []int {
	if len(nums) == 0 || k <= 0 {
		return nil
	}
	out := make([]int, 0, len(nums)-k+1)
	dq := make([]int, 0, k) // indices, decreasing in nums value

	for i, x := range nums {
		// Expire front if it left the window.
		if len(dq) > 0 && dq[0] < i-k+1 {
			dq = dq[1:]
		}
		// Drop back while smaller than current.
		for len(dq) > 0 && nums[dq[len(dq)-1]] < x {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
		if i >= k-1 {
			out = append(out, nums[dq[0]])
		}
	}
	return out
}

func main() {
	// nums = [1,3,-1,-3,5,3,6,7], k = 3 -> [3,3,5,5,6,7]
	fmt.Println(maxSlidingWindow([]int{1, 3, -1, -3, 5, 3, 6, 7}, 3))
	// nums = [1], k = 1 -> [1]
	fmt.Println(maxSlidingWindow([]int{1}, 1))
	// nums = [9,11], k = 2 -> [11]
	fmt.Println(maxSlidingWindow([]int{9, 11}, 2))
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Arrays;

public class SlidingWindowMaximum {

    /**
     * Returns the maximum of every contiguous window of size k.
     * Time:  O(n)
     * Space: O(k)
     */
    public static int[] maxSlidingWindow(int[] nums, int k) {
        if (nums == null || nums.length == 0 || k <= 0) return new int[0];
        int n = nums.length;
        int[] out = new int[n - k + 1];
        int idx = 0;
        Deque<Integer> dq = new ArrayDeque<>(k);

        for (int i = 0; i < n; i++) {
            if (!dq.isEmpty() && dq.peekFirst() < i - k + 1) {
                dq.pollFirst();
            }
            while (!dq.isEmpty() && nums[dq.peekLast()] < nums[i]) {
                dq.pollLast();
            }
            dq.offerLast(i);
            if (i >= k - 1) {
                out[idx++] = nums[dq.peekFirst()];
            }
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            maxSlidingWindow(new int[]{1, 3, -1, -3, 5, 3, 6, 7}, 3)));
        // [3, 3, 5, 5, 6, 7]
        System.out.println(Arrays.toString(maxSlidingWindow(new int[]{1}, 1)));
        // [1]
        System.out.println(Arrays.toString(maxSlidingWindow(new int[]{9, 11}, 2)));
        // [11]
    }
}
```

#### Python

```python
"""Sliding window maximum — O(n) using a monotonic deque."""

from collections import deque


def max_sliding_window(nums: list[int], k: int) -> list[int]:
    """Return the maximum value of every window of size k.

    Time:  O(n) — each index is pushed and popped at most once.
    Space: O(k) for the deque.
    """
    if not nums or k <= 0:
        return []
    out: list[int] = []
    dq: deque[int] = deque()  # indices, decreasing in nums value
    for i, x in enumerate(nums):
        if dq and dq[0] < i - k + 1:
            dq.popleft()
        while dq and nums[dq[-1]] < x:
            dq.pop()
        dq.append(i)
        if i >= k - 1:
            out.append(nums[dq[0]])
    return out


if __name__ == "__main__":
    print(max_sliding_window([1, 3, -1, -3, 5, 3, 6, 7], 3))  # [3, 3, 5, 5, 6, 7]
    print(max_sliding_window([1], 1))                          # [1]
    print(max_sliding_window([9, 11], 2))                      # [11]
```

**Walkthrough to give the interviewer:**

> "I keep a deque of indices, decreasing in the value they point into `nums`. The front of the deque always holds the index of the current window's max. On each new element I first expire the front if it left the window, then drop from the back any indices whose value is dominated by the new one — those can never be the max again. Push the new index, record the front as the answer if the window is full. Each index is pushed once and popped at most once, so total work is `O(n)`."

**Follow-up the interviewer may ask:**

> *"What if I asked for the minimum instead?"* — Use an increasing deque; flip the back-pop comparison to `>`.
>
> *"What if I asked for the second-largest?"* — A single deque does not give you the second-largest. Use a two-heap approach or a sorted multiset with lazy deletion.
>
> *"What if `k` changes between queries?"* — Static array, varying `k` -> use a sparse table, not a deque.
>
> *"Can you do it in O(1) memory?"* — No. The output alone is `n - k + 1` values; just storing it is `O(n - k)`. The working set is `O(k)`, which is minimal for any window-aware algorithm.
