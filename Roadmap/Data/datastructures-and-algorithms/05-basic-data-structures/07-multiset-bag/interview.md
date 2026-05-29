# Multiset / Bag — Interview Preparation

## How to Use This File

40+ questions tiered by level (Junior, Middle, Senior), then a full multi-language coding challenge: **Top-K Frequent Elements**. The questions move from "define the ADT" to "design a streaming heavy hitters service" — sample the level you are interviewing for and one tier above.

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a multiset and how does it differ from a set? | Counts per element; set ~ multiset with counts capped at 1. |
| 2 | What does `size()` return on a multiset, and how does it differ from `distinct()`? | Sum of counts vs. number of unique keys. |
| 3 | What is the time complexity of `add`, `remove`, `count` on a hash multiset? | All O(1) average; O(n) worst on hash collision. |
| 4 | Name three real-world examples that are naturally multisets. | Grocery cart, ballot box, word frequency. |
| 5 | Why must we remove a key when its count reaches 0? | Avoid memory leak in long-running counters; preserves equality semantics. |
| 6 | Implement `Counter(s) == Counter(t)` for anagram detection. | Build two counters and compare. |
| 7 | What is the underlying data structure of `collections.Counter`? | A `dict` subclass with extra helpers. |
| 8 | How is a multiset represented mathematically? | A function `f : U -> N_0`. |
| 9 | What happens if you try to `remove` an element with count 0? | No-op (or returns false); never go negative. |
| 10 | What is the result of `Counter("aab") + Counter("abc")`? | `Counter({'a': 3, 'b': 2, 'c': 1})`. |
| 11 | When would you choose a multiset over a plain list? | When order does not matter and count queries dominate. |
| 12 | What does `Counter.most_common(3)` return? | Top-3 (element, count) pairs sorted by count desc. |
| 13 | Difference between `Counter.subtract` and the `-` operator? | `subtract` allows negative counts; `-` drops non-positive results. |
| 14 | What is the most common bug when iterating a multiset? | Confusing distinct iteration with with-duplicates iteration. |
| 15 | How would you turn a multiset back into a list? | Iterate yielding each element `count(x)` times. |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | When does a hash multiset degrade to O(n)? | Adversarial collisions; tree-treeified bucket in Java 8+ caps at O(log n). |
| 2 | How do you find all anagrams of `p` in `s` in O(n)? | Sliding window of size `len(p)` with two counters and a `matched` count. |
| 3 | Why does `std::multiset<int>::erase(5)` surprise people? | It removes ALL occurrences. Use `erase(find(5))` for one. |
| 4 | Solve "minimum window substring" — outline the algorithm. | Two counters: need and have, plus matched-key count. O(n). |
| 5 | What is the sliding-window median problem and which structure fits? | Two sorted multisets balanced as low and high halves. |
| 6 | Implement multiset difference. What is the time complexity? | O(distinct(A) + distinct(B)) — iterate keys, max(A-B, 0). |
| 7 | When to use TreeMultiset over HashMultiset? | Need sorted iteration, range queries, floor/ceiling. |
| 8 | What is the cost of `Counter.most_common(k)` for an n-distinct counter? | O(n log k) via heap. O(n) full sort for `most_common()`. |
| 9 | Implement "first unique character in a string" with a counter. | Counter pass, then find first index with count 1. |
| 10 | Compare hash multiset to dense `int[K]` for a 26-letter alphabet. | Dense array wins on both speed and memory; no hashing. |
| 11 | Why does `Counter() + Counter()` drop zeros but `Counter.update` does not? | Operator semantics; `update` is in-place additive. |
| 12 | How do you check if a multiset A is a sub-multiset of B? | For every key in A, `A[k] <= B[k]`. |
| 13 | Implement multiset intersection. Use case in algorithms? | `min(A[k], B[k])` for shared keys. Common subsequence of multisets. |
| 14 | Show how to detect rearrangement of two arrays in O(n). | Equality of multisets / sorted arrays. |
| 15 | What is the complexity of "group anagrams" with multiset signatures? | O(N * K) where N = number of strings, K = avg length. |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Design a counter service for "number of likes per post" at 1M ops/sec. | Local aggregation, Redis `HINCRBY`, sharding strategy. |
| 2 | What is Count-Min Sketch and when do you reach for it? | Sub-linear approximate frequency; always over-estimates; eps/delta tuning. |
| 3 | Explain Misra-Gries. Why does it use exactly k-1 counters? | Stream heavy hitters; pigeonhole — k-1 counters cannot all be hit by one decrement round simultaneously. |
| 4 | Top-K trending hashtags on a sharded firehose — pitfall? | Local top-K union misses globally hot but per-shard-cold items; oversample. |
| 5 | When is `LongAdder` preferable to `AtomicLong`? | Under high contention — strips count across cells. |
| 6 | How does Redis `HINCRBY` differ from a `GET + INCR + SET` flow? | Atomic single-op; no race; no round-trip pair. |
| 7 | Walk through a CRDT G-Counter for a distributed view counter. | Vector of per-node counts; merge = element-wise max. |
| 8 | What does PN-Counter buy you over G-Counter? | Decrements via a paired grow-only "negative" counter. |
| 9 | How would you provide an eventually-consistent "cart contents" multiset? | OR-Set or PN-Counter per SKU with reservation token if non-negativity matters. |
| 10 | Trade-offs of exact vs. approximate counting under memory pressure. | Linear memory for exact; sub-linear sketch with bounded error. |
| 11 | Detect when your hash multiset is the bottleneck. | Profile bucket chains, GC time, CPU on hashing; consider open addressing. |
| 12 | Real-time top-1000 keywords with 100B events — your stack? | Sharded local Counter + flush to Redis sorted set; periodic batch to OLAP. |
| 13 | How do you observe "lingering zero-count keys" in production? | Track distinct-keys metric independently from sum-of-counts. |

---

## Coding Challenge — Top-K Frequent Elements

> Given an integer array `nums` and integer `k`, return the `k` most frequent elements. You may return the answer in any order. It is guaranteed that the answer is unique.
>
> Constraints:
> - `1 <= nums.length <= 1e5`
> - `-1e4 <= nums[i] <= 1e4`
> - `1 <= k <= distinct count of nums`
> - Required: **better than O(n log n)** time.

**Approach.** Build a `Counter` (O(n)), then either:
- **Heap variant (O(n log k))**: maintain a min-heap of size k of `(count, element)`.
- **Bucket sort variant (O(n))**: `buckets[count]` is the list of elements with that count. Walk from `n` down to 1.

Both are widely accepted; the bucket version is the one that strictly beats `n log n`.

### Go

```go
package main

import "fmt"

func topKFrequent(nums []int, k int) []int {
	counts := make(map[int]int)
	for _, v := range nums {
		counts[v]++
	}

	// buckets[i] holds elements that appear exactly i times.
	buckets := make([][]int, len(nums)+1)
	for v, c := range counts {
		buckets[c] = append(buckets[c], v)
	}

	result := make([]int, 0, k)
	for i := len(buckets) - 1; i >= 0 && len(result) < k; i-- {
		for _, v := range buckets[i] {
			result = append(result, v)
			if len(result) == k {
				break
			}
		}
	}
	return result
}

func main() {
	fmt.Println(topKFrequent([]int{1, 1, 1, 2, 2, 3}, 2)) // [1 2]
	fmt.Println(topKFrequent([]int{1}, 1))                // [1]
	fmt.Println(topKFrequent([]int{4, 1, -1, 2, -1, 2, 3}, 2)) // [-1 2]
}
```

### Java

```java
import java.util.*;

public class TopKFrequent {
    public static int[] topKFrequent(int[] nums, int k) {
        Map<Integer, Integer> counts = new HashMap<>();
        for (int v : nums) counts.merge(v, 1, Integer::sum);

        List<List<Integer>> buckets = new ArrayList<>(nums.length + 1);
        for (int i = 0; i <= nums.length; i++) buckets.add(new ArrayList<>());
        counts.forEach((v, c) -> buckets.get(c).add(v));

        int[] result = new int[k];
        int idx = 0;
        for (int i = buckets.size() - 1; i >= 0 && idx < k; i--) {
            for (int v : buckets.get(i)) {
                if (idx == k) break;
                result[idx++] = v;
            }
        }
        return result;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(topKFrequent(new int[]{1, 1, 1, 2, 2, 3}, 2))); // [1, 2]
        System.out.println(Arrays.toString(topKFrequent(new int[]{1}, 1)));                // [1]
        System.out.println(Arrays.toString(topKFrequent(new int[]{4, 1, -1, 2, -1, 2, 3}, 2))); // [-1, 2]
    }
}
```

### Python

```python
from collections import Counter

def top_k_frequent(nums: list[int], k: int) -> list[int]:
    counts = Counter(nums)
    buckets: list[list[int]] = [[] for _ in range(len(nums) + 1)]
    for v, c in counts.items():
        buckets[c].append(v)

    result: list[int] = []
    for i in range(len(buckets) - 1, -1, -1):
        for v in buckets[i]:
            result.append(v)
            if len(result) == k:
                return result
    return result


if __name__ == "__main__":
    print(top_k_frequent([1, 1, 1, 2, 2, 3], 2))         # [1, 2]
    print(top_k_frequent([1], 1))                         # [1]
    print(top_k_frequent([4, 1, -1, 2, -1, 2, 3], 2))     # [-1, 2]
```

**Why bucket sort works.** A count is bounded by `n = len(nums)`, so there are at most `n + 1` distinct count values. Place each `(value, count)` into `buckets[count]`. Walking from `n` down to `0` and collecting elements until we have `k` is one pass over the buckets plus one pass over elements — total O(n).

**Discussion points** (good to volunteer in the interview):
- The heap solution is O(n log k) and is the right answer when k is small and constant.
- The bucket-sort solution is O(n) but uses O(n) extra space; in interviews, mention both, code one.
- For distributed top-k, the local-top-k union has false negatives (an item ranked 11th in every shard but 1st globally) — mitigate with `c*k` oversampling per shard. This pivot to the senior question often follows.
- "What if the array does not fit in memory?" — pivot to Misra-Gries / Space-Saving sketch.

**Common mistakes to call out:**
- Sorting the counter map by value (O(n log n)) when the question requires better.
- Using a max-heap of size n then popping k — that is O(n + k log n), worse than the heap-of-size-k variant.
- Forgetting that `most_common` itself is O(n log k); fine if you cite it, bad if you handwave.

---

## Follow-up Questions to Anticipate

After you ship the top-k solution, interviewers commonly drill in three directions. Have a one-sentence answer ready for each.

### Streaming Variant

> "What if the array does not fit in memory and elements arrive one by one?"

Answer: switch from exact counting to **Misra-Gries** with `k * c` counters where `c >= log N`. Memory is O(k log N) and bounded heavy hitters are guaranteed; verify candidates with a second pass over a recent sample if the live stream allows replay. Also mention **Space-Saving** (Metwally 2005) as the modern improvement that maintains stricter error bounds for the top-k specifically.

### Distributed Variant

> "What if the stream is sharded across 100 servers?"

Answer: each shard maintains a local top-`c * k` (with `c >= log N` to avoid the missing-global-favorite bug), and a coordinator merges per-shard candidate lists. Provide intuition for why local top-k alone is unsafe: an element ranked just below the cutoff on every shard but globally first slips through. Oversampling fixes this with high probability.

### Skewed Distributions

> "What changes if the input is heavily Zipfian (one element dominates)?"

Answer: counters become hot — single-key contention dominates. Use `LongAdder`-style striping or per-thread local counters with periodic merges. The Counter itself is unchanged, but the concurrency wrapper around it now matters more than the data structure.

---

## Second Coding Challenge — Valid Anagram (Junior Warm-up)

> Given two strings `s` and `t`, return `true` iff `t` is an anagram of `s`.
>
> Constraints: `1 <= s.length, t.length <= 5 * 10^4`. Strings consist of lowercase English letters.

### Approach

Two equivalent paths:
1. Sort both strings, compare. O(n log n) time, O(1) space (or O(n) for non-mutable strings).
2. Build a multiset (counter) of `s`, decrement for `t`, check none go negative. O(n) time, O(1) space for a 26-letter alphabet (dense `int[26]` array).

The dense-array variant is the recommended interview answer because it is strictly O(n) and O(1) for a fixed alphabet.

### Go

```go
package main

import "fmt"

func isAnagram(s, t string) bool {
	if len(s) != len(t) {
		return false
	}
	var counts [26]int
	for i := 0; i < len(s); i++ {
		counts[s[i]-'a']++
		counts[t[i]-'a']--
	}
	for _, c := range counts {
		if c != 0 {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(isAnagram("anagram", "nagaram")) // true
	fmt.Println(isAnagram("rat", "car"))         // false
}
```

### Java

```java
public class ValidAnagram {
    public static boolean isAnagram(String s, String t) {
        if (s.length() != t.length()) return false;
        int[] counts = new int[26];
        for (int i = 0; i < s.length(); i++) {
            counts[s.charAt(i) - 'a']++;
            counts[t.charAt(i) - 'a']--;
        }
        for (int c : counts) if (c != 0) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isAnagram("anagram", "nagaram")); // true
        System.out.println(isAnagram("rat", "car"));         // false
    }
}
```

### Python

```python
from collections import Counter

def is_anagram(s: str, t: str) -> bool:
    return Counter(s) == Counter(t)


if __name__ == "__main__":
    print(is_anagram("anagram", "nagaram"))  # True
    print(is_anagram("rat", "car"))          # False
```

The Python solution is one line because `Counter` equality already does the multiset comparison. The Go/Java versions use the dense-array trick: increment for `s`, decrement for `t`, in one pass. Any non-zero remaining count proves a mismatch.

---

## Third Coding Challenge — First Unique Character (Junior to Middle)

> Given a string `s`, return the index of the first character that appears exactly once. Return -1 if there is no such character.

### Approach

Two-pass multiset:
1. Count every character.
2. Linear scan; the first character whose count is 1 wins.

O(n) time, O(1) space for a fixed alphabet.

### Go

```go
package main

import "fmt"

func firstUniqChar(s string) int {
	var counts [26]int
	for i := 0; i < len(s); i++ {
		counts[s[i]-'a']++
	}
	for i := 0; i < len(s); i++ {
		if counts[s[i]-'a'] == 1 {
			return i
		}
	}
	return -1
}

func main() {
	fmt.Println(firstUniqChar("leetcode"))     // 0
	fmt.Println(firstUniqChar("loveleetcode")) // 2
	fmt.Println(firstUniqChar("aabb"))         // -1
}
```

### Java

```java
public class FirstUnique {
    public static int firstUniqChar(String s) {
        int[] counts = new int[26];
        for (char c : s.toCharArray()) counts[c - 'a']++;
        for (int i = 0; i < s.length(); i++) {
            if (counts[s.charAt(i) - 'a'] == 1) return i;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(firstUniqChar("leetcode"));     // 0
        System.out.println(firstUniqChar("loveleetcode")); // 2
        System.out.println(firstUniqChar("aabb"));         // -1
    }
}
```

### Python

```python
from collections import Counter

def first_uniq_char(s: str) -> int:
    counts = Counter(s)
    for i, ch in enumerate(s):
        if counts[ch] == 1:
            return i
    return -1


if __name__ == "__main__":
    print(first_uniq_char("leetcode"))      # 0
    print(first_uniq_char("loveleetcode"))  # 2
    print(first_uniq_char("aabb"))          # -1
```

**Common gotchas:** candidates often build the counter inside the scan loop (O(n^2)) or sort by count first (O(n log n)). The clean two-pass version is the canonical answer.

---

## Behavioral / Design Question

> "Walk me through how you would implement a 'most-played track in the last 24 hours' feature on a music platform."

A strong answer combines structural and operational layers:

1. **Data:** every play event written to an append-only log (Kafka / Kinesis).
2. **Counter:** a sharded Redis hash `plays:hour:{h}` per UTC hour, key = track id. Each play `HINCRBY`s the counter for the current hour bucket.
3. **Window:** a separate aggregator reads the 24 hourly hashes, sums them into a single sorted set keyed by track id, and exposes the top-N via `ZREVRANGE`.
4. **TTL:** each hour bucket expires after 25 hours — automatic cleanup.
5. **Cold path:** raw events also flow to OLAP (BigQuery / ClickHouse) for analytics and as a recovery source if Redis loses a shard.
6. **Approximation backstop:** for low-popularity tracks under tail of distribution, accept Count-Min Sketch instead of exact counts to bound memory.
7. **Top-k caching:** precompute the top-100 every 30 seconds, cache the JSON response. Serving cost is O(1), not O(distinct).

The interviewer will ask follow-ups on hot-key contention (sharded local counters before HINCRBY), failure handling (Kafka offsets ensure no double-count on replay), and observability (track flush-lag and hash-key cardinality as metrics).

---

## Lightning-Round Quick Recall

For interview warmup, drill these one-liners until they are instant:

| Prompt | One-line answer |
|--------|-----------------|
| Multiset = | `map<element, positive int count>` |
| Set vs multiset | Counts capped at 1 vs unbounded counts |
| `size()` vs `distinct()` | Sum of counts vs number of keys |
| Anagram check | Counter equality |
| Top-K time | O(n log k) with min-heap, O(n) with bucket sort |
| Misra-Gries memory | O(k) regardless of stream length |
| CMS error | Always over-estimates within eps*N w.p. 1-delta |
| Redis primitive | `HINCRBY hash field 1` |
| Counter pattern | Build counter, scan for predicate |
| Zero-count keys | Always delete to avoid memory leak |

Bring this mental table to the whiteboard and most counter-pattern questions become 10-minute solves.
