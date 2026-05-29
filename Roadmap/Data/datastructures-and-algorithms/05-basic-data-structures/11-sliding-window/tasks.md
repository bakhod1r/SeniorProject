# Sliding Window — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python** (in that order).
> Each task includes the problem statement, constraints, expected output, and reference solution.

---

## Beginner Tasks

### Task 1 — Max Sum of K Consecutive

Given an integer array `a` and integer `k`, return the maximum sum of any contiguous subarray of length `k`.
**Constraints:** `1 <= k <= len(a) <= 10^5`.
**Example:** `a = [2, 1, 5, 1, 3, 2]`, `k = 3` → `9`.

#### Go

```go
func maxSumK(a []int, k int) int {
    s := 0
    for i := 0; i < k; i++ { s += a[i] }
    best := s
    for r := k; r < len(a); r++ {
        s += a[r] - a[r-k]
        if s > best { best = s }
    }
    return best
}
```

#### Java

```java
static int maxSumK(int[] a, int k) {
    int s = 0;
    for (int i = 0; i < k; i++) s += a[i];
    int best = s;
    for (int r = k; r < a.length; r++) {
        s += a[r] - a[r - k];
        if (s > best) best = s;
    }
    return best;
}
```

#### Python

```python
def max_sum_k(a: list[int], k: int) -> int:
    s = sum(a[:k]); best = s
    for r in range(k, len(a)):
        s += a[r] - a[r - k]
        best = max(best, s)
    return best
```

---

### Task 2 — Average of Every K-Window

Return a list of averages of every length-`k` contiguous window.
**Example:** `[1, 12, -5, -6, 50, 3], k = 4` → `[0.5, 12.75, 10.5]`.

#### Go

```go
func averages(a []int, k int) []float64 {
    res := make([]float64, 0, len(a)-k+1)
    s := 0
    for i := 0; i < k; i++ { s += a[i] }
    res = append(res, float64(s)/float64(k))
    for r := k; r < len(a); r++ {
        s += a[r] - a[r-k]
        res = append(res, float64(s)/float64(k))
    }
    return res
}
```

#### Java

```java
static double[] averages(int[] a, int k) {
    double[] res = new double[a.length - k + 1];
    int s = 0;
    for (int i = 0; i < k; i++) s += a[i];
    res[0] = (double) s / k;
    for (int r = k; r < a.length; r++) {
        s += a[r] - a[r - k];
        res[r - k + 1] = (double) s / k;
    }
    return res;
}
```

#### Python

```python
def averages(a: list[int], k: int) -> list[float]:
    s = sum(a[:k]); out = [s / k]
    for r in range(k, len(a)):
        s += a[r] - a[r - k]
        out.append(s / k)
    return out
```

---

### Task 3 — Longest Substring Without Repeating Characters

Length of the longest substring with all distinct characters.
**Example:** `"abcabcbb"` → `3`.

#### Go

```go
func longestUnique(s string) int {
    cnt := make(map[byte]int)
    l, best := 0, 0
    for r := 0; r < len(s); r++ {
        cnt[s[r]]++
        for cnt[s[r]] > 1 {
            cnt[s[l]]--
            l++
        }
        if r-l+1 > best { best = r - l + 1 }
    }
    return best
}
```

#### Java

```java
static int longestUnique(String s) {
    int[] cnt = new int[128];
    int l = 0, best = 0;
    for (int r = 0; r < s.length(); r++) {
        cnt[s.charAt(r)]++;
        while (cnt[s.charAt(r)] > 1) cnt[s.charAt(l++)]--;
        best = Math.max(best, r - l + 1);
    }
    return best;
}
```

#### Python

```python
def longest_unique(s: str) -> int:
    cnt: dict[str, int] = {}
    l = best = 0
    for r, c in enumerate(s):
        cnt[c] = cnt.get(c, 0) + 1
        while cnt[c] > 1:
            cnt[s[l]] -= 1
            l += 1
        best = max(best, r - l + 1)
    return best
```

---

### Task 4 — Count Subarrays with Sum Exactly K (positive ints)

Count contiguous subarrays whose sum is exactly `K`. **All elements are positive.**
**Example:** `a = [1, 1, 1, 1], K = 2` → `3`.

#### Go

```go
func countSumExactly(a []int, K int) int {
    l, s, count := 0, 0, 0
    rightCount := 0
    for r := 0; r < len(a); r++ {
        s += a[r]
        for s > K {
            s -= a[l]; l++; rightCount = 0
        }
        if s == K { count++ }
        _ = rightCount
    }
    // For "at most K" technique it would be a difference; this is a direct check.
    return count
}
```

#### Java

```java
static int countSumExactly(int[] a, int K) {
    int l = 0, s = 0, count = 0;
    for (int r = 0; r < a.length; r++) {
        s += a[r];
        while (s > K) s -= a[l++];
        if (s == K) count++;
    }
    return count;
}
```

#### Python

```python
def count_sum_exactly(a: list[int], K: int) -> int:
    l = s = count = 0
    for r in range(len(a)):
        s += a[r]
        while s > K:
            s -= a[l]; l += 1
        if s == K:
            count += 1
    return count
```

> Note: only correct for positive integers. With negatives use prefix sum + hash map.

---

### Task 5 — Smallest Subarray with Sum >= S (positive ints)

Return the minimum length of any contiguous subarray with sum at least `S`, or `0` if none.
**Example:** `a = [2, 3, 1, 2, 4, 3], S = 7` → `2` (`[4, 3]`).

#### Go

```go
func minLenSumAtLeast(a []int, S int) int {
    l, s := 0, 0
    best := -1
    for r := 0; r < len(a); r++ {
        s += a[r]
        for s >= S {
            if best == -1 || r-l+1 < best { best = r - l + 1 }
            s -= a[l]; l++
        }
    }
    if best == -1 { return 0 }
    return best
}
```

#### Java

```java
static int minLenSumAtLeast(int[] a, int S) {
    int l = 0, s = 0, best = -1;
    for (int r = 0; r < a.length; r++) {
        s += a[r];
        while (s >= S) {
            if (best == -1 || r - l + 1 < best) best = r - l + 1;
            s -= a[l++];
        }
    }
    return best == -1 ? 0 : best;
}
```

#### Python

```python
def min_len_sum_at_least(a: list[int], S: int) -> int:
    l = s = 0
    best = -1
    for r in range(len(a)):
        s += a[r]
        while s >= S:
            if best == -1 or r - l + 1 < best:
                best = r - l + 1
            s -= a[l]; l += 1
    return 0 if best == -1 else best
```

---

## Intermediate Tasks

### Task 6 — Longest Substring with At Most K Distinct Characters

**Example:** `"eceba", k = 2` → `3` (`"ece"`).

#### Go

```go
func longestAtMostKDistinct(s string, k int) int {
    cnt := make(map[byte]int)
    distinct, l, best := 0, 0, 0
    for r := 0; r < len(s); r++ {
        if cnt[s[r]] == 0 { distinct++ }
        cnt[s[r]]++
        for distinct > k {
            cnt[s[l]]--
            if cnt[s[l]] == 0 { distinct-- }
            l++
        }
        if r-l+1 > best { best = r - l + 1 }
    }
    return best
}
```

#### Java

```java
static int longestAtMostKDistinct(String s, int k) {
    int[] cnt = new int[128];
    int distinct = 0, l = 0, best = 0;
    for (int r = 0; r < s.length(); r++) {
        if (cnt[s.charAt(r)]++ == 0) distinct++;
        while (distinct > k) {
            if (--cnt[s.charAt(l++)] == 0) distinct--;
        }
        best = Math.max(best, r - l + 1);
    }
    return best;
}
```

#### Python

```python
def longest_at_most_k_distinct(s: str, k: int) -> int:
    cnt: dict[str, int] = {}
    distinct = l = best = 0
    for r, c in enumerate(s):
        if cnt.get(c, 0) == 0: distinct += 1
        cnt[c] = cnt.get(c, 0) + 1
        while distinct > k:
            cnt[s[l]] -= 1
            if cnt[s[l]] == 0: distinct -= 1
            l += 1
        best = max(best, r - l + 1)
    return best
```

---

### Task 7 — Max Consecutive Ones with K Flips (LC 1004)

Max number of consecutive 1s if you may flip at most `k` zeros.

#### Go

```go
func longestOnesK(a []int, k int) int {
    l, zeros, best := 0, 0, 0
    for r := 0; r < len(a); r++ {
        if a[r] == 0 { zeros++ }
        for zeros > k {
            if a[l] == 0 { zeros-- }
            l++
        }
        if r-l+1 > best { best = r - l + 1 }
    }
    return best
}
```

#### Java

```java
static int longestOnesK(int[] a, int k) {
    int l = 0, zeros = 0, best = 0;
    for (int r = 0; r < a.length; r++) {
        if (a[r] == 0) zeros++;
        while (zeros > k) {
            if (a[l++] == 0) zeros--;
        }
        best = Math.max(best, r - l + 1);
    }
    return best;
}
```

#### Python

```python
def longest_ones_k(a: list[int], k: int) -> int:
    l = zeros = best = 0
    for r, v in enumerate(a):
        if v == 0: zeros += 1
        while zeros > k:
            if a[l] == 0: zeros -= 1
            l += 1
        best = max(best, r - l + 1)
    return best
```

---

### Task 8 — Permutation in String (LC 567)

Return true if any permutation of `t` is a substring of `s`.

#### Go

```go
func checkInclusion(t, s string) bool {
    if len(t) > len(s) { return false }
    var need, have [26]int
    for i := 0; i < len(t); i++ {
        need[t[i]-'a']++
        have[s[i]-'a']++
    }
    if need == have { return true }
    for r := len(t); r < len(s); r++ {
        have[s[r]-'a']++
        have[s[r-len(t)]-'a']--
        if need == have { return true }
    }
    return false
}
```

#### Java

```java
static boolean checkInclusion(String t, String s) {
    if (t.length() > s.length()) return false;
    int[] need = new int[26], have = new int[26];
    for (int i = 0; i < t.length(); i++) {
        need[t.charAt(i) - 'a']++;
        have[s.charAt(i) - 'a']++;
    }
    if (java.util.Arrays.equals(need, have)) return true;
    for (int r = t.length(); r < s.length(); r++) {
        have[s.charAt(r) - 'a']++;
        have[s.charAt(r - t.length()) - 'a']--;
        if (java.util.Arrays.equals(need, have)) return true;
    }
    return false;
}
```

#### Python

```python
def check_inclusion(t: str, s: str) -> bool:
    if len(t) > len(s): return False
    need = [0] * 26
    have = [0] * 26
    for i in range(len(t)):
        need[ord(t[i]) - ord('a')] += 1
        have[ord(s[i]) - ord('a')] += 1
    if need == have: return True
    for r in range(len(t), len(s)):
        have[ord(s[r]) - ord('a')] += 1
        have[ord(s[r - len(t)]) - ord('a')] -= 1
        if need == have: return True
    return False
```

---

### Task 9 — Longest Repeating Char Replacement (LC 424)

Longest substring where you can change at most `k` characters to make it all the same letter.

#### Go

```go
func characterReplacement(s string, k int) int {
    var cnt [26]int
    l, maxFreq, best := 0, 0, 0
    for r := 0; r < len(s); r++ {
        cnt[s[r]-'A']++
        if cnt[s[r]-'A'] > maxFreq { maxFreq = cnt[s[r]-'A'] }
        if r-l+1-maxFreq > k {
            cnt[s[l]-'A']--
            l++
        }
        if r-l+1 > best { best = r - l + 1 }
    }
    return best
}
```

#### Java

```java
static int characterReplacement(String s, int k) {
    int[] cnt = new int[26];
    int l = 0, maxFreq = 0, best = 0;
    for (int r = 0; r < s.length(); r++) {
        cnt[s.charAt(r) - 'A']++;
        maxFreq = Math.max(maxFreq, cnt[s.charAt(r) - 'A']);
        if (r - l + 1 - maxFreq > k) cnt[s.charAt(l++) - 'A']--;
        best = Math.max(best, r - l + 1);
    }
    return best;
}
```

#### Python

```python
def character_replacement(s: str, k: int) -> int:
    cnt = [0] * 26
    l = max_freq = best = 0
    for r, c in enumerate(s):
        cnt[ord(c) - ord('A')] += 1
        max_freq = max(max_freq, cnt[ord(c) - ord('A')])
        if r - l + 1 - max_freq > k:
            cnt[ord(s[l]) - ord('A')] -= 1
            l += 1
        best = max(best, r - l + 1)
    return best
```

---

### Task 10 — Fruit Into Baskets (LC 904)

Longest subarray with at most 2 distinct values.

#### Go

```go
func totalFruit(a []int) int {
    cnt := make(map[int]int)
    l, best := 0, 0
    for r := 0; r < len(a); r++ {
        cnt[a[r]]++
        for len(cnt) > 2 {
            cnt[a[l]]--
            if cnt[a[l]] == 0 { delete(cnt, a[l]) }
            l++
        }
        if r-l+1 > best { best = r - l + 1 }
    }
    return best
}
```

#### Java

```java
static int totalFruit(int[] a) {
    java.util.HashMap<Integer, Integer> cnt = new java.util.HashMap<>();
    int l = 0, best = 0;
    for (int r = 0; r < a.length; r++) {
        cnt.merge(a[r], 1, Integer::sum);
        while (cnt.size() > 2) {
            cnt.merge(a[l], -1, Integer::sum);
            if (cnt.get(a[l]) == 0) cnt.remove(a[l]);
            l++;
        }
        best = Math.max(best, r - l + 1);
    }
    return best;
}
```

#### Python

```python
def total_fruit(a: list[int]) -> int:
    cnt: dict[int, int] = {}
    l = best = 0
    for r, v in enumerate(a):
        cnt[v] = cnt.get(v, 0) + 1
        while len(cnt) > 2:
            cnt[a[l]] -= 1
            if cnt[a[l]] == 0: del cnt[a[l]]
            l += 1
        best = max(best, r - l + 1)
    return best
```

---

## Advanced Tasks

### Task 11 — Sliding Window Maximum (LC 239)

Return the max of every length-`k` window. Use a monotonic deque (see [14-monotonic-queue](../14-monotonic-queue/junior.md)).

#### Go

```go
func maxSlidingWindow(a []int, k int) []int {
    res := []int{}
    dq := []int{} // indices, values monotonically decreasing
    for r := 0; r < len(a); r++ {
        for len(dq) > 0 && a[dq[len(dq)-1]] <= a[r] {
            dq = dq[:len(dq)-1]
        }
        dq = append(dq, r)
        if dq[0] <= r-k { dq = dq[1:] }
        if r >= k-1 { res = append(res, a[dq[0]]) }
    }
    return res
}
```

#### Java

```java
static int[] maxSlidingWindow(int[] a, int k) {
    int n = a.length;
    int[] res = new int[n - k + 1];
    java.util.Deque<Integer> dq = new java.util.ArrayDeque<>();
    for (int r = 0; r < n; r++) {
        while (!dq.isEmpty() && a[dq.peekLast()] <= a[r]) dq.pollLast();
        dq.offerLast(r);
        if (dq.peekFirst() <= r - k) dq.pollFirst();
        if (r >= k - 1) res[r - k + 1] = a[dq.peekFirst()];
    }
    return res;
}
```

#### Python

```python
from collections import deque

def max_sliding_window(a: list[int], k: int) -> list[int]:
    dq: deque[int] = deque()
    res = []
    for r, v in enumerate(a):
        while dq and a[dq[-1]] <= v:
            dq.pop()
        dq.append(r)
        if dq[0] <= r - k:
            dq.popleft()
        if r >= k - 1:
            res.append(a[dq[0]])
    return res
```

---

### Task 12 — Minimum Window Substring (LC 76)

Smallest substring of `s` containing every character of `t` (with multiplicity). See [interview.md](./interview.md) for the full solution.

---

### Task 13 — Subarrays with Exactly K Different Integers (LC 992)

Use the trick: `exactly K = atMost(K) - atMost(K - 1)`.

#### Go

```go
func subarraysWithKDistinct(a []int, k int) int {
    return atMost(a, k) - atMost(a, k-1)
}

func atMost(a []int, k int) int {
    cnt := make(map[int]int)
    distinct, l, total := 0, 0, 0
    for r := 0; r < len(a); r++ {
        if cnt[a[r]] == 0 { distinct++ }
        cnt[a[r]]++
        for distinct > k {
            cnt[a[l]]--
            if cnt[a[l]] == 0 { distinct-- }
            l++
        }
        total += r - l + 1
    }
    return total
}
```

#### Java

```java
static int subarraysWithKDistinct(int[] a, int k) {
    return atMost(a, k) - atMost(a, k - 1);
}

static int atMost(int[] a, int k) {
    java.util.HashMap<Integer, Integer> cnt = new java.util.HashMap<>();
    int distinct = 0, l = 0, total = 0;
    for (int r = 0; r < a.length; r++) {
        if (cnt.merge(a[r], 1, Integer::sum) == 1) distinct++;
        while (distinct > k) {
            if (cnt.merge(a[l++], -1, Integer::sum) == 0) distinct--;
        }
        total += r - l + 1;
    }
    return total;
}
```

#### Python

```python
def subarrays_with_k_distinct(a: list[int], k: int) -> int:
    return at_most(a, k) - at_most(a, k - 1)

def at_most(a: list[int], k: int) -> int:
    cnt: dict[int, int] = {}
    distinct = l = total = 0
    for r, v in enumerate(a):
        if cnt.get(v, 0) == 0: distinct += 1
        cnt[v] = cnt.get(v, 0) + 1
        while distinct > k:
            cnt[a[l]] -= 1
            if cnt[a[l]] == 0: distinct -= 1
            l += 1
        total += r - l + 1
    return total
```

---

### Task 14 — Find All Anagrams in a String (LC 438)

Return all start indices of substrings of `s` that are anagrams of `p`.

#### Go

```go
func findAnagrams(s, p string) []int {
    res := []int{}
    if len(p) > len(s) { return res }
    var need, have [26]int
    for i := 0; i < len(p); i++ {
        need[p[i]-'a']++
        have[s[i]-'a']++
    }
    if need == have { res = append(res, 0) }
    for r := len(p); r < len(s); r++ {
        have[s[r]-'a']++
        have[s[r-len(p)]-'a']--
        if need == have { res = append(res, r-len(p)+1) }
    }
    return res
}
```

#### Java

```java
static java.util.List<Integer> findAnagrams(String s, String p) {
    java.util.List<Integer> res = new java.util.ArrayList<>();
    if (p.length() > s.length()) return res;
    int[] need = new int[26], have = new int[26];
    for (int i = 0; i < p.length(); i++) {
        need[p.charAt(i) - 'a']++;
        have[s.charAt(i) - 'a']++;
    }
    if (java.util.Arrays.equals(need, have)) res.add(0);
    for (int r = p.length(); r < s.length(); r++) {
        have[s.charAt(r) - 'a']++;
        have[s.charAt(r - p.length()) - 'a']--;
        if (java.util.Arrays.equals(need, have)) res.add(r - p.length() + 1);
    }
    return res;
}
```

#### Python

```python
def find_anagrams(s: str, p: str) -> list[int]:
    if len(p) > len(s): return []
    need = [0] * 26; have = [0] * 26
    res = []
    for i in range(len(p)):
        need[ord(p[i]) - ord('a')] += 1
        have[ord(s[i]) - ord('a')] += 1
    if need == have: res.append(0)
    for r in range(len(p), len(s)):
        have[ord(s[r]) - ord('a')] += 1
        have[ord(s[r - len(p)]) - ord('a')] -= 1
        if need == have: res.append(r - len(p) + 1)
    return res
```

---

### Task 15 — Sliding Window Rate Limiter

Implement an in-memory sliding-window rate limiter with the API:

```text
Limiter(window_seconds, limit)
limiter.allow(key, now) -> bool
```

Use the two-bucket interpolation approach from [senior.md](./senior.md). The reference solution is the `SlidingWindowLimiter` class shown there in all three languages — port it, then write a test that fires `2 * limit` requests within `window_seconds` and asserts approximately `limit` are accepted.

**Evaluation criteria.**

- Correctness near bucket boundaries (no double-counting, no gap).
- Concurrency safety (Go: mutex; Java: synchronized; Python: lock).
- Memory bounded: keys evicted after `2 * window_seconds` of inactivity.
- Property test: total allowed in any `window_seconds` interval is `<= limit + small_error`.

---

## Benchmark Task

Compare sliding window vs brute force for "max sum of k consecutive" across sizes.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func bruteMaxK(a []int, k int) int {
    best := 0
    for i := 0; i+k <= len(a); i++ {
        s := 0
        for j := i; j < i+k; j++ { s += a[j] }
        if i == 0 || s > best { best = s }
    }
    return best
}

func slidingMaxK(a []int, k int) int {
    s := 0
    for i := 0; i < k; i++ { s += a[i] }
    best := s
    for r := k; r < len(a); r++ {
        s += a[r] - a[r-k]
        if s > best { best = s }
    }
    return best
}

func main() {
    sizes := []int{1_000, 10_000, 100_000, 1_000_000}
    k := 100
    rand.Seed(1)
    for _, n := range sizes {
        a := make([]int, n)
        for i := range a { a[i] = rand.Intn(1000) }

        start := time.Now()
        slidingMaxK(a, k)
        slidingMs := float64(time.Since(start).Microseconds()) / 1000.0

        start = time.Now()
        bruteMaxK(a, k)
        bruteMs := float64(time.Since(start).Microseconds()) / 1000.0

        fmt.Printf("n=%7d  sliding=%.3fms  brute=%.3fms  speedup=%.1fx\n",
            n, slidingMs, bruteMs, bruteMs/slidingMs)
    }
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    static int slidingMaxK(int[] a, int k) {
        int s = 0;
        for (int i = 0; i < k; i++) s += a[i];
        int best = s;
        for (int r = k; r < a.length; r++) {
            s += a[r] - a[r - k];
            if (s > best) best = s;
        }
        return best;
    }

    static int bruteMaxK(int[] a, int k) {
        int best = 0;
        for (int i = 0; i + k <= a.length; i++) {
            int s = 0;
            for (int j = i; j < i + k; j++) s += a[j];
            if (i == 0 || s > best) best = s;
        }
        return best;
    }

    public static void main(String[] args) {
        int[] sizes = {1_000, 10_000, 100_000, 1_000_000};
        int k = 100;
        Random rng = new Random(1);
        for (int n : sizes) {
            int[] a = new int[n];
            for (int i = 0; i < n; i++) a[i] = rng.nextInt(1000);

            long t0 = System.nanoTime();
            slidingMaxK(a, k);
            double slidingMs = (System.nanoTime() - t0) / 1e6;

            t0 = System.nanoTime();
            bruteMaxK(a, k);
            double bruteMs = (System.nanoTime() - t0) / 1e6;

            System.out.printf("n=%7d  sliding=%.3fms  brute=%.3fms  speedup=%.1fx%n",
                n, slidingMs, bruteMs, bruteMs / slidingMs);
        }
    }
}
```

#### Python

```python
import random
import time


def sliding_max_k(a: list[int], k: int) -> int:
    s = sum(a[:k]); best = s
    for r in range(k, len(a)):
        s += a[r] - a[r - k]
        if s > best: best = s
    return best


def brute_max_k(a: list[int], k: int) -> int:
    best = 0
    for i in range(len(a) - k + 1):
        s = sum(a[i:i + k])
        if i == 0 or s > best:
            best = s
    return best


if __name__ == "__main__":
    sizes = [1_000, 10_000, 100_000]
    k = 100
    random.seed(1)
    for n in sizes:
        a = [random.randint(0, 1000) for _ in range(n)]

        t0 = time.perf_counter()
        sliding_max_k(a, k)
        sliding_ms = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        brute_max_k(a, k)
        brute_ms = (time.perf_counter() - t0) * 1000

        print(f"n={n:>7}  sliding={sliding_ms:7.3f}ms  brute={brute_ms:8.3f}ms"
              f"  speedup={brute_ms / sliding_ms:.1f}x")
```

Expected: the speedup grows roughly linearly with `k`, confirming the `O(n*k) -> O(n)` improvement.
