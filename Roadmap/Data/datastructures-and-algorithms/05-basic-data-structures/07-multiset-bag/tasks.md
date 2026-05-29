# Multiset / Bag — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.

## Beginner Tasks

### Task 1: Character Frequency Counter

Implement `char_frequency(s)` that returns a map/dict from each character to its count in `s`.

**Input:** `"banana"`
**Output:** `{b: 1, a: 3, n: 2}`

**Hint:** Iterate the string and increment per character.

#### Go

```go
func charFrequency(s string) map[rune]int {
	freq := map[rune]int{}
	for _, r := range s {
		freq[r]++
	}
	return freq
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public static Map<Character, Integer> charFrequency(String s) {
    Map<Character, Integer> freq = new HashMap<>();
    for (char c : s.toCharArray()) freq.merge(c, 1, Integer::sum);
    return freq;
}
```

#### Python

```python
from collections import Counter

def char_frequency(s: str) -> dict[str, int]:
    return dict(Counter(s))
```

### Task 2: Anagram Detection

Given two strings, return `true` iff one is an anagram of the other.

**Input:** `"listen"`, `"silent"`
**Output:** `true`

**Hint:** Two strings are anagrams iff their character multisets are equal.

#### Go

```go
func isAnagram(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[rune]int{}
	for _, r := range a {
		counts[r]++
	}
	for _, r := range b {
		counts[r]--
		if counts[r] < 0 {
			return false
		}
	}
	return true
}
```

#### Java

```java
public static boolean isAnagram(String a, String b) {
    if (a.length() != b.length()) return false;
    int[] counts = new int[26];
    for (int i = 0; i < a.length(); i++) {
        counts[a.charAt(i) - 'a']++;
        counts[b.charAt(i) - 'a']--;
    }
    for (int c : counts) if (c != 0) return false;
    return true;
}
```

#### Python

```python
from collections import Counter

def is_anagram(a: str, b: str) -> bool:
    return Counter(a) == Counter(b)
```

### Task 3: First Non-Repeating Character

Return the **index** of the first character in `s` whose count is exactly 1. Return `-1` if no such character exists.

**Input:** `"leetcode"`
**Output:** `0` (the 'l').

**Hint:** Count pass, then linear scan.

#### Go

```go
func firstUnique(s string) int {
	counts := map[rune]int{}
	for _, r := range s {
		counts[r]++
	}
	for i, r := range s {
		if counts[r] == 1 {
			return i
		}
	}
	return -1
}
```

#### Java

```java
public static int firstUnique(String s) {
    int[] counts = new int[26];
    for (char c : s.toCharArray()) counts[c - 'a']++;
    for (int i = 0; i < s.length(); i++) {
        if (counts[s.charAt(i) - 'a'] == 1) return i;
    }
    return -1;
}
```

#### Python

```python
from collections import Counter

def first_unique(s: str) -> int:
    counts = Counter(s)
    for i, ch in enumerate(s):
        if counts[ch] == 1:
            return i
    return -1
```

### Task 4: Multiset Equality

Implement `multiset_equal(a, b)` for two lists of integers without sorting them.

**Input:** `[3,1,3,2]`, `[2,3,1,3]`
**Output:** `true`

**Hint:** Build two counters and compare.

#### Go

```go
func multisetEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[int]int{}
	for _, v := range a {
		counts[v]++
	}
	for _, v := range b {
		counts[v]--
		if counts[v] < 0 {
			return false
		}
	}
	return true
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public static boolean multisetEqual(int[] a, int[] b) {
    if (a.length != b.length) return false;
    Map<Integer, Integer> counts = new HashMap<>();
    for (int v : a) counts.merge(v, 1, Integer::sum);
    for (int v : b) {
        int next = counts.getOrDefault(v, 0) - 1;
        if (next < 0) return false;
        counts.put(v, next);
    }
    return true;
}
```

#### Python

```python
from collections import Counter

def multiset_equal(a: list[int], b: list[int]) -> bool:
    return Counter(a) == Counter(b)
```

### Task 5: Total vs Distinct

Implement two helpers: `total(counter)` returns the sum of counts; `distinct(counter)` returns the number of keys with count > 0.

**Input:** `{a:3, b:0, c:2}`
**Output:** `total = 5`, `distinct = 2`

**Hint:** Iterate values; skip zeros for `distinct`.

#### Go

```go
func total(c map[string]int) int {
	s := 0
	for _, v := range c {
		s += v
	}
	return s
}

func distinct(c map[string]int) int {
	d := 0
	for _, v := range c {
		if v > 0 {
			d++
		}
	}
	return d
}
```

#### Java

```java
public static int total(Map<String, Integer> c) {
    return c.values().stream().mapToInt(Integer::intValue).sum();
}

public static int distinct(Map<String, Integer> c) {
    return (int) c.values().stream().filter(v -> v > 0).count();
}
```

#### Python

```python
def total(c: dict[str, int]) -> int:
    return sum(c.values())

def distinct(c: dict[str, int]) -> int:
    return sum(1 for v in c.values() if v > 0)
```

---

## Intermediate Tasks

### Task 6: Group Anagrams

Group a list of strings such that all anagrams land in the same group.

**Input:** `["eat","tea","tan","ate","nat","bat"]`
**Output:** `[["eat","tea","ate"],["tan","nat"],["bat"]]`

**Hint:** Use the sorted string or a frozenset of `Counter.items()` as the signature.

#### Go

```go
import "sort"

func groupAnagrams(strs []string) [][]string {
	groups := map[string][]string{}
	for _, s := range strs {
		runes := []rune(s)
		sort.Slice(runes, func(i, j int) bool { return runes[i] < runes[j] })
		key := string(runes)
		groups[key] = append(groups[key], s)
	}
	out := make([][]string, 0, len(groups))
	for _, g := range groups {
		out = append(out, g)
	}
	return out
}
```

#### Java

```java
import java.util.*;

public static List<List<String>> groupAnagrams(String[] strs) {
    Map<String, List<String>> groups = new HashMap<>();
    for (String s : strs) {
        char[] chars = s.toCharArray();
        Arrays.sort(chars);
        groups.computeIfAbsent(new String(chars), k -> new ArrayList<>()).add(s);
    }
    return new ArrayList<>(groups.values());
}
```

#### Python

```python
from collections import defaultdict

def group_anagrams(strs: list[str]) -> list[list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for s in strs:
        groups["".join(sorted(s))].append(s)
    return list(groups.values())
```

### Task 7: Find All Anagrams in a String

Return all start indices of `p`'s anagrams in `s`.

**Input:** `s = "cbaebabacd"`, `p = "abc"`
**Output:** `[0, 6]`

**Hint:** Sliding window of size `len(p)` with two counters and a matched key count. See middle.md for the full pattern.

#### Go

(See middle.md for full implementation of the sliding-window approach.)

#### Java

(See middle.md.)

#### Python

```python
from collections import Counter

def find_anagrams(s: str, p: str) -> list[int]:
    if len(s) < len(p):
        return []
    need = Counter(p)
    have: Counter[str] = Counter()
    matched = 0
    result: list[int] = []
    for r, ch in enumerate(s):
        have[ch] += 1
        if have[ch] == need[ch]:
            matched += 1
        if r >= len(p):
            left = s[r - len(p)]
            if have[left] == need[left]:
                matched -= 1
            have[left] -= 1
        if matched == len(need):
            result.append(r - len(p) + 1)
    return result
```

### Task 8: Longest Substring with At Most K Distinct Characters

Return the length of the longest substring of `s` with at most `k` distinct characters.

**Input:** `s = "eceba"`, `k = 2`
**Output:** `3` (`"ece"`)

**Hint:** Sliding window with a multiset; shrink until distinct <= k.

#### Go

```go
func lengthOfLongestSubstringKDistinct(s string, k int) int {
	counts := map[byte]int{}
	best, l := 0, 0
	for r := 0; r < len(s); r++ {
		counts[s[r]]++
		for len(counts) > k {
			counts[s[l]]--
			if counts[s[l]] == 0 {
				delete(counts, s[l])
			}
			l++
		}
		if r-l+1 > best {
			best = r - l + 1
		}
	}
	return best
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public static int lengthOfLongestSubstringKDistinct(String s, int k) {
    Map<Character, Integer> counts = new HashMap<>();
    int best = 0, l = 0;
    for (int r = 0; r < s.length(); r++) {
        counts.merge(s.charAt(r), 1, Integer::sum);
        while (counts.size() > k) {
            char c = s.charAt(l++);
            if (counts.merge(c, -1, Integer::sum) == 0) counts.remove(c);
        }
        best = Math.max(best, r - l + 1);
    }
    return best;
}
```

#### Python

```python
from collections import defaultdict

def length_of_longest_substring_k_distinct(s: str, k: int) -> int:
    counts: dict[str, int] = defaultdict(int)
    best = l = 0
    for r, ch in enumerate(s):
        counts[ch] += 1
        while len(counts) > k:
            counts[s[l]] -= 1
            if counts[s[l]] == 0:
                del counts[s[l]]
            l += 1
        best = max(best, r - l + 1)
    return best
```

### Task 9: Subarray Sum Equals K

Return the number of contiguous subarrays whose sum is exactly `k`.

**Input:** `nums = [1, 1, 1]`, `k = 2`
**Output:** `2`

**Hint:** Prefix sums with a counter of seen prefix sums.

#### Go

```go
func subarraySum(nums []int, k int) int {
	prefixCounts := map[int]int{0: 1}
	curSum, result := 0, 0
	for _, v := range nums {
		curSum += v
		if c, ok := prefixCounts[curSum-k]; ok {
			result += c
		}
		prefixCounts[curSum]++
	}
	return result
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public static int subarraySum(int[] nums, int k) {
    Map<Integer, Integer> prefixCounts = new HashMap<>();
    prefixCounts.put(0, 1);
    int curSum = 0, result = 0;
    for (int v : nums) {
        curSum += v;
        result += prefixCounts.getOrDefault(curSum - k, 0);
        prefixCounts.merge(curSum, 1, Integer::sum);
    }
    return result;
}
```

#### Python

```python
from collections import Counter

def subarray_sum(nums: list[int], k: int) -> int:
    prefix_counts: Counter[int] = Counter({0: 1})
    cur_sum = result = 0
    for v in nums:
        cur_sum += v
        result += prefix_counts[cur_sum - k]
        prefix_counts[cur_sum] += 1
    return result
```

### Task 10: Multiset Algebra Library

Implement `sum`, `diff`, `intersect`, `union` on two multisets. Verify with sample inputs.

**Input:** `A = {x:3, y:1}`, `B = {x:1, z:2}`
**Output:** `sum = {x:4, y:1, z:2}`, `diff = {x:2, y:1}`, `intersect = {x:1}`, `union = {x:3, y:1, z:2}`

**Hint:** See middle.md. In Python this is one-line per op using `Counter` operators.

#### Go

```go
type MS map[string]int

func (a MS) Union(b MS) MS {
	out := MS{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		if v > out[k] {
			out[k] = v
		}
	}
	return out
}
```

#### Java

```java
public static Map<String, Integer> union(Map<String, Integer> a, Map<String, Integer> b) {
    Map<String, Integer> out = new HashMap<>(a);
    b.forEach((k, v) -> out.merge(k, v, Math::max));
    return out;
}
```

#### Python

```python
# All four operators built into Counter:
a + b   # sum
a - b   # difference (drops <=0)
a & b   # intersection
a | b   # union
```

---

## Advanced Tasks

### Task 11: Top-K Frequent Elements (Bucket Sort)

Given `nums` and `k`, return the k most frequent elements in **O(n)** time.

**Input:** `[1,1,1,2,2,3]`, `k = 2`
**Output:** `[1, 2]`

**Hint:** Bucket sort by count. Full solution in interview.md.

### Task 12: Sliding-Window Median

Given an array `nums` and window size `k`, return the median of every window.

**Input:** `[1,3,-1,-3,5,3,6,7]`, `k = 3`
**Output:** `[1, -1, -1, 3, 5, 6]`

**Hint:** Two sorted multisets (low half, high half), rebalance on insert/remove. O(n log k).

#### Python

```python
from sortedcontainers import SortedList

def median_sliding_window(nums: list[int], k: int) -> list[float]:
    window = SortedList(nums[:k])
    result = []
    for i in range(k, len(nums) + 1):
        if k % 2:
            result.append(float(window[k // 2]))
        else:
            result.append((window[k // 2 - 1] + window[k // 2]) / 2)
        if i < len(nums):
            window.remove(nums[i - k])
            window.add(nums[i])
    return result
```

(Go and Java solutions follow the same recipe — manage two TreeMultisets or balanced BSTs; full multi-page implementations omitted here.)

### Task 13: Minimum Window Substring

Return the smallest substring of `s` containing every character of `t` (with multiplicity).

**Input:** `s = "ADOBECODEBANC"`, `t = "ABC"`
**Output:** `"BANC"`

**Hint:** Two counters (`need`, `have`) plus a `matched` integer for matched keys. O(n).

#### Python

```python
from collections import Counter

def min_window(s: str, t: str) -> str:
    if not t or not s:
        return ""
    need = Counter(t)
    have: Counter[str] = Counter()
    matched, required = 0, len(need)
    best = (float("inf"), 0, 0)
    l = 0
    for r, ch in enumerate(s):
        have[ch] += 1
        if have[ch] == need[ch]:
            matched += 1
        while matched == required:
            if r - l + 1 < best[0]:
                best = (r - l + 1, l, r)
            have[s[l]] -= 1
            if have[s[l]] < need[s[l]]:
                matched -= 1
            l += 1
    return "" if best[0] == float("inf") else s[best[1]:best[2] + 1]
```

(Go and Java mirror this with explicit maps and the same `matched` invariant.)

### Task 14: Misra-Gries Heavy Hitters

Implement Misra-Gries with parameter `k`: after streaming all items, return every element appearing more than `N/k` times (after a verification pass).

**Input:** stream of 1M ints, k = 10
**Output:** every value with > 100K occurrences.

**Hint:** Maintain at most `k-1` candidate counters; on a miss when full, decrement all. Then verify by re-streaming.

(Full implementations in senior.md.)

### Task 15: Distributed Counter with Sharded HINCRBY

Design (pseudocode + skeleton client code) a multi-worker view-counter that:
1. Buffers per-key counts in memory for at most 1 second.
2. Flushes a single pipelined `HINCRBY` per key per worker.
3. Reads the global value with a single `HGET` (or `HGETALL` for small hashes).

**Input:** 100 workers, 10M events/sec aggregate.
**Output:** per-key counts in Redis within ~1 second of each event.

**Hint:** Local `map[string]int64` flushed by a goroutine/thread every second; one pipelined Redis call per flush. Watch out for memory growth on workers — bound the local map size and force-flush on hitting the cap.

---

## Benchmark Task

Compare hand-rolled `map[T]int` vs. the language's idiomatic library counter on a stream of 1M random integers drawn from a Zipf distribution. Report wall-clock time and peak memory.

### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	n := 1_000_000
	data := make([]int, n)
	for i := range data {
		data[i] = rand.Intn(10_000)
	}
	start := time.Now()
	counts := map[int]int{}
	for _, v := range data {
		counts[v]++
	}
	fmt.Printf("Go map[int]int: %.3f ms, distinct=%d\n",
		float64(time.Since(start).Microseconds())/1000, len(counts))
}
```

### Java

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

public class Bench {
    public static void main(String[] args) {
        int n = 1_000_000;
        int[] data = new int[n];
        Random r = new Random(0);
        for (int i = 0; i < n; i++) data[i] = r.nextInt(10_000);
        long start = System.nanoTime();
        Map<Integer, Integer> counts = new HashMap<>();
        for (int v : data) counts.merge(v, 1, Integer::sum);
        long elapsed = System.nanoTime() - start;
        System.out.printf("Java HashMap: %.3f ms, distinct=%d%n",
            elapsed / 1_000_000.0, counts.size());
    }
}
```

### Python

```python
import random, time
from collections import Counter

random.seed(0)
n = 1_000_000
data = [random.randrange(10_000) for _ in range(n)]

start = time.perf_counter()
counts = Counter(data)
elapsed = (time.perf_counter() - start) * 1000
print(f"Python Counter: {elapsed:.3f} ms, distinct={len(counts)}")
```

Expect: Python's C-implemented `Counter` ~2-3x faster than a hand-rolled `for v in data: counts[v] += 1` loop. Go and Java map increments are already optimal for this workload. Zipf distributions stress the hash hot-key path — useful to confirm that hash spreading is doing its job.
