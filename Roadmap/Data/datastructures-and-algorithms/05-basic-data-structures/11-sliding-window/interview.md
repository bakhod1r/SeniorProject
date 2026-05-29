# Sliding Window — Interview Preparation

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Coding Challenge — Minimum Window Substring](#coding-challenge--minimum-window-substring)

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a sliding window? | Contiguous range `[l, r]` with maintained aggregate state; expand right, possibly shrink left. |
| 2 | What two flavors are there? | Fixed-size (width `k` constant) and variable-size (width changes based on invariant). |
| 3 | Why is sliding window `O(n)` and not `O(n*k)`? | Each step does `O(1)` work — add new element, remove old element — instead of recomputing from scratch. |
| 4 | Give one fixed-size example. | Max sum of `k` consecutive elements; first negative number in each `k`-window. |
| 5 | Give one variable-size example. | Longest substring without repeating characters; smallest subarray with sum ≥ S. |
| 6 | When do you record the answer — before or after updating the state? | After updating, so the answer reflects the current window. |
| 7 | Why `while` and not `if` for shrinking? | Removing one element may not be enough to restore the invariant — keep shrinking until it holds. |
| 8 | What is the "window state"? | The aggregate kept up to date as the window moves — a sum, a frequency map, a set, a max. |
| 9 | What state do you use for "all distinct chars"? | A hash set or a frequency map (counter). |
| 10 | What state do you use for sum problems? | A running integer sum. |
| 11 | Can you slide a window with `k > n`? | No — guard up front, return error or 0. |
| 12 | What is the difference between sliding window and two pointers? | Sliding window keeps a maintained aggregate over a contiguous range; two pointers usually compare two specific positions. |
| 13 | What is the difference between sliding window and prefix sum? | Sliding window streams; prefix sum precomputes once and answers arbitrary range queries. |
| 14 | Why does "sum ≤ K" sliding window fail with negative numbers? | The shrink invariant assumes removing elements reduces the sum — negatives break this monotonicity. |
| 15 | What is the most common bug? | Recording the answer before fully updating the state, or shrinking with `if` instead of `while`. |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How would you find the longest substring with at most `k` distinct characters? | Variable window, counter + `distinct` integer, shrink while `distinct > k`. |
| 2 | What is the trick for "minimum window substring"? | Track `matched` integer — number of distinct chars whose required count is met — and shrink while `matched == required`. |
| 3 | How do you solve sliding window max in `O(n)`? | Monotonic decreasing deque of indices; pop expired front, pop smaller back, front is the max. |
| 4 | How would you solve "exactly k distinct chars" with sliding window? | "At most `k`" minus "at most `k - 1`" — two passes of the same algorithm. |
| 5 | When should you use prefix sum instead of sliding window? | When numbers can be negative and the constraint is on a sum; when you need many ad-hoc range queries; when the array is static. |
| 6 | When the longest-vs-shortest distinction matters. | Longest: record after the shrink loop (window is valid). Shortest: record inside the shrink loop (every step is valid for the "contains" template). |
| 7 | What state do you use for "longest substring same letter after k flips"? | Counter + running max frequency; invariant is `windowLen - maxFreq <= k`. |
| 8 | How do you handle empty target / target longer than source in min-window? | Guard early — return `""` or `0`. |
| 9 | Why is `matched` better than comparing entire counters every step? | `matched` is `O(1)` to maintain; counter comparison is `O(alphabet)` per step. |
| 10 | In a hot loop with ASCII strings, would you use a hash map? | No — use `int[128]` indexed by char code; 3-5x faster, no hashing overhead. |
| 11 | What is the invariant for "fruit into baskets" (LC 904)? | At most 2 distinct types in the window; longest such window. |
| 12 | How would you find all anagrams of `p` in `s`? | Fixed-size window of length `|p|`, compare 26-int counter to target counter on each slide. |
| 13 | What goes wrong if you forget to delete zero-count entries from the counter map? | `len(map)` overestimates distinct count and the invariant becomes wrong. |
| 14 | Why does the variable-window template require monotonicity? | Without it, shrinking might skip past a valid window and miss the answer. |
| 15 | What state would you use for "median in every window of size k"? | Two heaps (or a balanced BST / sorted multiset) — sliding window with `O(log k)` per step instead of `O(1)`. |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How would you implement an API rate limiter with a sliding window? | Sliding-window counter: track current and previous fixed buckets, linearly interpolate previous bucket's contribution. |
| 2 | What is the difference between tumbling, hopping, and sliding windows in stream processing? | Tumbling: fixed, non-overlapping. Hopping: fixed, overlapping with stride. Sliding: per-event in theory, hopping in most implementations. |
| 3 | How do watermarks interact with sliding windows? | Watermark is the "no events older than this" guarantee; window emits when watermark passes its right edge. |
| 4 | What aggregate functions are mergeable across shards? | `sum`, `count`, `max`, `min`, t-digest (quantiles), HyperLogLog (distinct), Count-Min (heavy hitters). Median and exact distinct are NOT mergeable. |
| 5 | How would you compute p99 latency over the last 5 minutes? | Per-second HDR histogram bucket; ring of 300 buckets; merge on query — or t-digest sliding aggregation. |
| 6 | What goes wrong with a single global mutex on a sliding-window service at high QPS? | Lock contention caps throughput; stripe locks per key prefix or shard the state. |
| 7 | How do you handle late events in a sliding-window aggregator? | Allowed-lateness buffer, emit corrections, or just discard and monitor `late_event_count`. |
| 8 | How do you persist sliding-window state for crash recovery? | Periodic checkpoints to durable store; replay last `W` from the source-of-truth log. |
| 9 | What memory do you need for exact distinct count in a sliding window of size W? | `Theta(W)` — exact requires storing every element. Use HyperLogLog for polylog approximate. |
| 10 | What is the right TTL for inactive keys in a windowed service? | Slightly larger than the window — typically `2W` to `5W` to avoid evicting active keys. |
| 11 | How do you scale sliding-window rate limiting across many gateway instances? | Two-tier: per-instance limits absorb bursts; coarse aggregation enforces global limit. |
| 12 | Why is event time preferred over processing time? | Survives clock skew, retries, out-of-order arrival. Processing time silently lies under load. |
| 13 | How would you build sliding-window anomaly detection? | Welford's online mean/std-dev with constant-time add and remove; z-score threshold; EWMA for cheap alternative. |

---

## Coding Challenge — Minimum Window Substring

> **Problem.** Given two strings `s` and `t`, return the smallest substring of `s` that contains every character of `t` (including multiplicities). Return `""` if no such substring exists.
>
> **Example.**
> `s = "ADOBECODEBANC"`, `t = "ABC"` → `"BANC"`.
>
> **Constraints.**
> - `1 <= |s|, |t| <= 10^5`.
> - Both strings consist of printable ASCII characters.
>
> **Approach.** Variable-size sliding window. Maintain `need` = `Counter(t)`, `have` = current window counts, `matched` = number of distinct characters whose required count is met. Expand `right`; once `matched == len(need)`, shrink `left` while still valid and track the smallest such window. `O(|s| + |t|)` time, `O(alphabet)` space.

### Go

```go
package main

import (
    "fmt"
    "math"
)

func minWindow(s, t string) string {
    if len(s) < len(t) || len(t) == 0 {
        return ""
    }

    need := make(map[byte]int)
    for i := 0; i < len(t); i++ {
        need[t[i]]++
    }
    required := len(need)

    have := make(map[byte]int)
    matched := 0

    bestLen := math.MaxInt
    bestL := 0
    l := 0

    for r := 0; r < len(s); r++ {
        c := s[r]
        have[c]++
        if need[c] > 0 && have[c] == need[c] {
            matched++
        }

        for matched == required {
            if r-l+1 < bestLen {
                bestLen = r - l + 1
                bestL = l
            }
            left := s[l]
            have[left]--
            if need[left] > 0 && have[left] < need[left] {
                matched--
            }
            l++
        }
    }

    if bestLen == math.MaxInt {
        return ""
    }
    return s[bestL : bestL+bestLen]
}

func main() {
    fmt.Println(minWindow("ADOBECODEBANC", "ABC")) // BANC
    fmt.Println(minWindow("a", "a"))               // a
    fmt.Println(minWindow("a", "aa"))              // ""
}
```

### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Solution {

    public static String minWindow(String s, String t) {
        if (s.length() < t.length() || t.isEmpty()) return "";

        Map<Character, Integer> need = new HashMap<>();
        for (char c : t.toCharArray()) {
            need.merge(c, 1, Integer::sum);
        }
        int required = need.size();

        Map<Character, Integer> have = new HashMap<>();
        int matched = 0;

        int bestLen = Integer.MAX_VALUE;
        int bestL = 0;
        int l = 0;

        for (int r = 0; r < s.length(); r++) {
            char c = s.charAt(r);
            have.merge(c, 1, Integer::sum);
            if (need.containsKey(c)
                && have.get(c).intValue() == need.get(c).intValue()) {
                matched++;
            }

            while (matched == required) {
                if (r - l + 1 < bestLen) {
                    bestLen = r - l + 1;
                    bestL = l;
                }
                char left = s.charAt(l);
                have.merge(left, -1, Integer::sum);
                if (need.containsKey(left)
                    && have.get(left) < need.get(left)) {
                    matched--;
                }
                l++;
            }
        }
        return bestLen == Integer.MAX_VALUE
            ? ""
            : s.substring(bestL, bestL + bestLen);
    }

    public static void main(String[] args) {
        System.out.println(minWindow("ADOBECODEBANC", "ABC")); // BANC
        System.out.println(minWindow("a", "a"));               // a
        System.out.println(minWindow("a", "aa"));              // (empty)
    }
}
```

### Python

```python
from collections import Counter


def min_window(s: str, t: str) -> str:
    """Smallest substring of s containing every char of t (with multiplicity)."""
    if len(s) < len(t) or not t:
        return ""

    need = Counter(t)
    have: Counter = Counter()
    required = len(need)
    matched = 0

    best_len = float("inf")
    best_l = 0
    l = 0

    for r, c in enumerate(s):
        have[c] += 1
        if c in need and have[c] == need[c]:
            matched += 1

        while matched == required:
            if r - l + 1 < best_len:
                best_len = r - l + 1
                best_l = l
            left = s[l]
            have[left] -= 1
            if left in need and have[left] < need[left]:
                matched -= 1
            l += 1

    return "" if best_len == float("inf") else s[best_l:best_l + best_len]


if __name__ == "__main__":
    print(min_window("ADOBECODEBANC", "ABC"))  # BANC
    print(min_window("a", "a"))                # a
    print(min_window("a", "aa"))               # ""
```

### Discussion points the interviewer will probe

- **Complexity.** Time `O(|s| + |t|)` — each pointer moves at most `|s|` times, all map ops are `O(1)` average. Space `O(|s| + |t|)` worst case for the maps; `O(alphabet)` if you use fixed-size arrays.
- **Why `matched`?** Comparing the entire `have` map to `need` on every step would cost `O(alphabet)`. Tracking `matched` makes the check `O(1)`.
- **Why `int[128]` over hash map?** For ASCII the alphabet is tiny — direct array indexing is faster and avoids allocator pressure in hot loops. Show both, mention the optimization.
- **Edge cases.** Empty `t`, `t` longer than `s`, `t` with duplicates (`"aabbc"`), `s == t`, no valid window. Test each.
- **Follow-ups the interviewer will ask.**
  - "What if you can't use extra memory?" → Hard with multiplicity; without multiplicity a 26-bit mask works.
  - "Stream version: characters arrive one at a time?" → Same algorithm; emit best so far on demand.
  - "What if you need ALL minimum windows, not just one?" → Track length; collect every window of that length.
  - "Parallelize across chunks?" → Hard (sequential dependence). Chunk + boundary fixup of width `|t|`.
