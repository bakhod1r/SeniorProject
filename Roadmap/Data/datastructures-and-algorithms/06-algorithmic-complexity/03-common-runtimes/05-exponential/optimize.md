# Exponential Time O(2^n) — Optimization Exercises

## Table of Contents

- [Exercise 1: Fibonacci — Recursion to Memoization](#exercise-1-fibonacci-recursion-to-memoization)
- [Exercise 2: Fibonacci — Memoization to Iterative](#exercise-2-fibonacci-memoization-to-iterative)
- [Exercise 3: Climbing Stairs — Exponential to Linear](#exercise-3-climbing-stairs-exponential-to-linear)
- [Exercise 4: Subset Sum — Brute Force to DP](#exercise-4-subset-sum-brute-force-to-dp)
- [Exercise 5: Subset Sum — DP to Meet-in-the-Middle](#exercise-5-subset-sum-dp-to-meet-in-the-middle)
- [Exercise 6: Coin Change — Exponential to DP](#exercise-6-coin-change-exponential-to-dp)
- [Exercise 7: Word Break — Recursion to DP](#exercise-7-word-break-recursion-to-dp)
- [Exercise 8: Longest Common Subsequence — Exponential to DP](#exercise-8-longest-common-subsequence-exponential-to-dp)
- [Exercise 9: 0/1 Knapsack — Brute Force to DP](#exercise-9-01-knapsack-brute-force-to-dp)
- [Exercise 10: Edit Distance — Exponential to DP](#exercise-10-edit-distance-exponential-to-dp)
- [Exercise 11: Matrix Chain Multiplication](#exercise-11-matrix-chain-multiplication)
- [Exercise 12: Traveling Salesman — Factorial to Bitmask DP](#exercise-12-traveling-salesman-factorial-to-bitmask-dp)

---

## Exercise 1: Fibonacci — Recursion to Memoization

**Before: O(2^n)**

```go
func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}
```

```java
static int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}
```

```python
def fib(n):
    if n <= 1: return n
    return fib(n - 1) + fib(n - 2)
```

**After: O(n) with memoization**

```go
func fibMemo(n int) int {
    memo := make(map[int]int)
    var helper func(int) int
    helper = func(k int) int {
        if k <= 1 { return k }
        if v, ok := memo[k]; ok { return v }
        memo[k] = helper(k-1) + helper(k-2)
        return memo[k]
    }
    return helper(n)
}
```

```java
static long fibMemo(int n) {
    long[] memo = new long[n + 1];
    Arrays.fill(memo, -1);
    return helper(n, memo);
}

static long helper(int n, long[] memo) {
    if (n <= 1) return n;
    if (memo[n] != -1) return memo[n];
    memo[n] = helper(n - 1, memo) + helper(n - 2, memo);
    return memo[n];
}
```

```python
from functools import lru_cache

@lru_cache(maxsize=None)
def fib_memo(n):
    if n <= 1: return n
    return fib_memo(n - 1) + fib_memo(n - 2)
```

**Why it works:** The naive recursion recomputes fib(k) exponentially many times. Memoization stores each result once, reducing total calls from O(2^n) to O(n).

---

## Exercise 2: Fibonacci — Memoization to Iterative

**Before: O(n) time, O(n) space**

```python
@lru_cache(maxsize=None)
def fib_memo(n):
    if n <= 1: return n
    return fib_memo(n - 1) + fib_memo(n - 2)
```

**After: O(n) time, O(1) space**

```go
func fibIterative(n int) int {
    if n <= 1 { return n }
    a, b := 0, 1
    for i := 2; i <= n; i++ {
        a, b = b, a+b
    }
    return b
}
```

```java
static long fibIterative(int n) {
    if (n <= 1) return n;
    long a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        long temp = b;
        b = a + b;
        a = temp;
    }
    return b;
}
```

```python
def fib_iterative(n):
    if n <= 1: return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

**Why it works:** We only need the two most recent values at any point, so we can discard the rest. This reduces space from O(n) to O(1).

---

## Exercise 3: Climbing Stairs — Exponential to Linear

**Before: O(2^n)**

```python
def climb(n):
    if n <= 1: return 1
    return climb(n - 1) + climb(n - 2)
```

**After: O(n) time, O(1) space**

```go
func climbStairs(n int) int {
    if n <= 1 { return 1 }
    a, b := 1, 1
    for i := 2; i <= n; i++ {
        a, b = b, a+b
    }
    return b
}
```

```java
static int climbStairs(int n) {
    if (n <= 1) return 1;
    int a = 1, b = 1;
    for (int i = 2; i <= n; i++) {
        int temp = b; b = a + b; a = temp;
    }
    return b;
}
```

```python
def climb_stairs(n):
    if n <= 1: return 1
    a, b = 1, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

**Analysis:** Same structure as Fibonacci. The recurrence `f(n) = f(n-1) + f(n-2)` has overlapping subproblems that memoization eliminates.

---

## Exercise 4: Subset Sum — Brute Force to DP

**Before: O(2^n)**

```python
def subset_sum_brute(nums, target):
    n = len(nums)
    for mask in range(1 << n):
        if sum(nums[i] for i in range(n) if mask & (1 << i)) == target:
            return True
    return False
```

**After: O(n * target) with DP**

```go
func subsetSumDP(nums []int, target int) bool {
    dp := make([]bool, target+1)
    dp[0] = true
    for _, num := range nums {
        // Iterate backwards to avoid using same element twice
        for j := target; j >= num; j-- {
            if dp[j-num] {
                dp[j] = true
            }
        }
    }
    return dp[target]
}
```

```java
static boolean subsetSumDP(int[] nums, int target) {
    boolean[] dp = new boolean[target + 1];
    dp[0] = true;
    for (int num : nums) {
        for (int j = target; j >= num; j--) {
            if (dp[j - num]) dp[j] = true;
        }
    }
    return dp[target];
}
```

```python
def subset_sum_dp(nums, target):
    dp = [False] * (target + 1)
    dp[0] = True
    for num in nums:
        for j in range(target, num - 1, -1):
            if dp[j - num]:
                dp[j] = True
    return dp[target]
```

**Why it works:** Instead of enumerating all 2^n subsets, DP tracks which sums are achievable using a 1D boolean array. Each element either extends existing sums or doesn't. The backward iteration prevents counting the same element twice.

**Trade-off:** This is O(n * target), which is polynomial in n and target but **pseudo-polynomial** — if the target value is exponentially large relative to n, this is no better than brute force.

---

## Exercise 5: Subset Sum — DP to Meet-in-the-Middle

When the target is too large for DP but n is moderate (n <= 40), meet-in-the-middle is better.

**Before: O(2^n)**

**After: O(2^(n/2) * n)**

```go
package main

import (
    "fmt"
    "sort"
)

func allSubsetSums(nums []int) []int {
    n := len(nums)
    sums := make([]int, 0, 1<<n)
    for mask := 0; mask < (1 << n); mask++ {
        s := 0
        for i := 0; i < n; i++ {
            if mask&(1<<i) != 0 {
                s += nums[i]
            }
        }
        sums = append(sums, s)
    }
    return sums
}

func subsetSumMITM(nums []int, target int) bool {
    mid := len(nums) / 2
    left := allSubsetSums(nums[:mid])
    sort.Ints(left)
    for _, rs := range allSubsetSums(nums[mid:]) {
        need := target - rs
        i := sort.SearchInts(left, need)
        if i < len(left) && left[i] == need {
            return true
        }
    }
    return false
}

func main() {
    nums := make([]int, 36)
    for i := range nums {
        nums[i] = i + 1
    }
    fmt.Println(subsetSumMITM(nums, 333))
}
```

```java
import java.util.*;

public class MITMSubsetSum {
    static List<Long> allSubsetSums(int[] nums, int from, int to) {
        int len = to - from;
        List<Long> sums = new ArrayList<>(1 << len);
        for (int mask = 0; mask < (1 << len); mask++) {
            long s = 0;
            for (int i = 0; i < len; i++) {
                if ((mask & (1 << i)) != 0) s += nums[from + i];
            }
            sums.add(s);
        }
        return sums;
    }

    static boolean solve(int[] nums, long target) {
        int mid = nums.length / 2;
        List<Long> left = allSubsetSums(nums, 0, mid);
        Collections.sort(left);
        for (long rs : allSubsetSums(nums, mid, nums.length)) {
            long need = target - rs;
            int idx = Collections.binarySearch(left, need);
            if (idx >= 0) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        int[] nums = new int[36];
        for (int i = 0; i < 36; i++) nums[i] = i + 1;
        System.out.println(solve(nums, 333));
    }
}
```

```python
from bisect import bisect_left

def mitm_subset_sum(nums, target):
    mid = len(nums) // 2

    def all_sums(arr):
        sums = []
        for mask in range(1 << len(arr)):
            sums.append(sum(arr[i] for i in range(len(arr)) if mask & (1 << i)))
        return sums

    left = sorted(all_sums(nums[:mid]))
    for rs in all_sums(nums[mid:]):
        need = target - rs
        idx = bisect_left(left, need)
        if idx < len(left) and left[idx] == need:
            return True
    return False

nums = list(range(1, 37))
print(mitm_subset_sum(nums, 333))
```

**Comparison for n=36:**
- Brute force: 2^36 = ~69 billion operations — hours.
- Meet-in-the-middle: 2 * 2^18 = ~524K operations — milliseconds.

---

## Exercise 6: Coin Change — Exponential to DP

**Before: O(2^n) recursion**

```python
def coin_change_brute(coins, amount):
    if amount == 0: return 0
    if amount < 0: return float('inf')
    best = float('inf')
    for coin in coins:
        result = coin_change_brute(coins, amount - coin)
        if result != float('inf'):
            best = min(best, result + 1)
    return best
```

**After: O(n * amount) DP**

```go
func coinChange(coins []int, amount int) int {
    dp := make([]int, amount+1)
    for i := range dp {
        dp[i] = amount + 1 // "infinity"
    }
    dp[0] = 0
    for i := 1; i <= amount; i++ {
        for _, coin := range coins {
            if coin <= i && dp[i-coin]+1 < dp[i] {
                dp[i] = dp[i-coin] + 1
            }
        }
    }
    if dp[amount] > amount {
        return -1
    }
    return dp[amount]
}
```

```java
static int coinChange(int[] coins, int amount) {
    int[] dp = new int[amount + 1];
    Arrays.fill(dp, amount + 1);
    dp[0] = 0;
    for (int i = 1; i <= amount; i++) {
        for (int coin : coins) {
            if (coin <= i) dp[i] = Math.min(dp[i], dp[i - coin] + 1);
        }
    }
    return dp[amount] > amount ? -1 : dp[amount];
}
```

```python
def coin_change(coins, amount):
    dp = [float('inf')] * (amount + 1)
    dp[0] = 0
    for i in range(1, amount + 1):
        for coin in coins:
            if coin <= i:
                dp[i] = min(dp[i], dp[i - coin] + 1)
    return dp[amount] if dp[amount] != float('inf') else -1
```

---

## Exercise 7: Word Break — Recursion to DP

**Before: O(2^n)**

```python
def word_break_brute(s, word_dict):
    if not s: return True
    for i in range(1, len(s) + 1):
        if s[:i] in word_dict and word_break_brute(s[i:], word_dict):
            return True
    return False
```

**After: O(n^2) DP**

```go
func wordBreak(s string, wordDict []string) bool {
    words := make(map[string]bool)
    for _, w := range wordDict {
        words[w] = true
    }
    n := len(s)
    dp := make([]bool, n+1)
    dp[0] = true
    for i := 1; i <= n; i++ {
        for j := 0; j < i; j++ {
            if dp[j] && words[s[j:i]] {
                dp[i] = true
                break
            }
        }
    }
    return dp[n]
}
```

```java
static boolean wordBreak(String s, Set<String> wordDict) {
    int n = s.length();
    boolean[] dp = new boolean[n + 1];
    dp[0] = true;
    for (int i = 1; i <= n; i++) {
        for (int j = 0; j < i; j++) {
            if (dp[j] && wordDict.contains(s.substring(j, i))) {
                dp[i] = true;
                break;
            }
        }
    }
    return dp[n];
}
```

```python
def word_break(s, word_dict):
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(1, n + 1):
        for j in range(i):
            if dp[j] and s[j:i] in word_dict:
                dp[i] = True
                break
    return dp[n]
```

---

## Exercise 8: Longest Common Subsequence — Exponential to DP

**Before: O(2^(m+n))** — generate all subsequences of both strings and compare.

**After: O(m * n) DP**

```go
func lcs(a, b string) int {
    m, n := len(a), len(b)
    dp := make([][]int, m+1)
    for i := range dp {
        dp[i] = make([]int, n+1)
    }
    for i := 1; i <= m; i++ {
        for j := 1; j <= n; j++ {
            if a[i-1] == b[j-1] {
                dp[i][j] = dp[i-1][j-1] + 1
            } else {
                dp[i][j] = max(dp[i-1][j], dp[i][j-1])
            }
        }
    }
    return dp[m][n]
}

func max(a, b int) int {
    if a > b { return a }
    return b
}
```

```java
static int lcs(String a, String b) {
    int m = a.length(), n = b.length();
    int[][] dp = new int[m + 1][n + 1];
    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (a.charAt(i - 1) == b.charAt(j - 1)) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return dp[m][n];
}
```

```python
def lcs(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[m][n]
```

---

## Exercise 9: 0/1 Knapsack — Brute Force to DP

**Before: O(2^n) — try all subsets**

```python
def knapsack_brute(weights, values, capacity):
    n = len(weights)
    best = 0
    for mask in range(1 << n):
        w, v = 0, 0
        for i in range(n):
            if mask & (1 << i):
                w += weights[i]
                v += values[i]
        if w <= capacity:
            best = max(best, v)
    return best
```

**After: O(n * W) DP**

```go
func knapsack(weights, values []int, capacity int) int {
    n := len(weights)
    dp := make([]int, capacity+1)
    for i := 0; i < n; i++ {
        for w := capacity; w >= weights[i]; w-- {
            if dp[w-weights[i]]+values[i] > dp[w] {
                dp[w] = dp[w-weights[i]] + values[i]
            }
        }
    }
    return dp[capacity]
}
```

```java
static int knapsack(int[] weights, int[] values, int capacity) {
    int[] dp = new int[capacity + 1];
    for (int i = 0; i < weights.length; i++) {
        for (int w = capacity; w >= weights[i]; w--) {
            dp[w] = Math.max(dp[w], dp[w - weights[i]] + values[i]);
        }
    }
    return dp[capacity];
}
```

```python
def knapsack(weights, values, capacity):
    dp = [0] * (capacity + 1)
    for i in range(len(weights)):
        for w in range(capacity, weights[i] - 1, -1):
            dp[w] = max(dp[w], dp[w - weights[i]] + values[i])
    return dp[capacity]
```

**Key insight:** The 1D DP with backward iteration ensures each item is used at most once (0/1 constraint). Time: O(n * W), space: O(W).

---

## Exercise 10: Edit Distance — Exponential to DP

**Before: O(3^(m+n))** — at each step, try insert, delete, or replace.

**After: O(m * n)**

```go
func editDistance(a, b string) int {
    m, n := len(a), len(b)
    dp := make([][]int, m+1)
    for i := range dp {
        dp[i] = make([]int, n+1)
        dp[i][0] = i
    }
    for j := 0; j <= n; j++ {
        dp[0][j] = j
    }
    for i := 1; i <= m; i++ {
        for j := 1; j <= n; j++ {
            if a[i-1] == b[j-1] {
                dp[i][j] = dp[i-1][j-1]
            } else {
                dp[i][j] = 1 + min3(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
            }
        }
    }
    return dp[m][n]
}

func min3(a, b, c int) int {
    if a < b { if a < c { return a }; return c }
    if b < c { return b }; return c
}
```

```java
static int editDistance(String a, String b) {
    int m = a.length(), n = b.length();
    int[][] dp = new int[m + 1][n + 1];
    for (int i = 0; i <= m; i++) dp[i][0] = i;
    for (int j = 0; j <= n; j++) dp[0][j] = j;
    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (a.charAt(i - 1) == b.charAt(j - 1)) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j - 1],
                                Math.min(dp[i - 1][j], dp[i][j - 1]));
            }
        }
    }
    return dp[m][n];
}
```

```python
def edit_distance(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1): dp[i][0] = i
    for j in range(n + 1): dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1])
    return dp[m][n]
```

---

## Exercise 11: Matrix Chain Multiplication

**Before: O(2^n)** — try all possible parenthesizations (Catalan number of ways).

**After: O(n^3) DP**

```python
def matrix_chain_order(dims):
    """
    dims: list of dimensions. Matrix i has dimensions dims[i] x dims[i+1].
    Returns minimum number of scalar multiplications.
    """
    n = len(dims) - 1  # Number of matrices
    dp = [[0] * n for _ in range(n)]

    for length in range(2, n + 1):  # Chain length
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = float('inf')
            for k in range(i, j):
                cost = dp[i][k] + dp[k+1][j] + dims[i] * dims[k+1] * dims[j+1]
                dp[i][j] = min(dp[i][j], cost)

    return dp[0][n - 1]

# Matrices: 10x30, 30x5, 5x60
print(matrix_chain_order([10, 30, 5, 60]))  # 4500
```

---

## Exercise 12: Traveling Salesman — Factorial to Bitmask DP

**Before: O(n!)** — try all permutations of cities.

**After: O(2^n * n^2) with Held-Karp bitmask DP**

```go
package main

import (
    "fmt"
    "math"
)

func tsp(dist [][]int) int {
    n := len(dist)
    INF := math.MaxInt32
    // dp[mask][i] = min cost to visit cities in mask, ending at city i
    dp := make([][]int, 1<<n)
    for i := range dp {
        dp[i] = make([]int, n)
        for j := range dp[i] {
            dp[i][j] = INF
        }
    }
    dp[1][0] = 0 // Start at city 0

    for mask := 1; mask < (1 << n); mask++ {
        for u := 0; u < n; u++ {
            if dp[mask][u] == INF || mask&(1<<u) == 0 {
                continue
            }
            for v := 0; v < n; v++ {
                if mask&(1<<v) != 0 {
                    continue
                }
                newMask := mask | (1 << v)
                cost := dp[mask][u] + dist[u][v]
                if cost < dp[newMask][v] {
                    dp[newMask][v] = cost
                }
            }
        }
    }

    fullMask := (1 << n) - 1
    result := INF
    for u := 0; u < n; u++ {
        if dp[fullMask][u]+dist[u][0] < result {
            result = dp[fullMask][u] + dist[u][0]
        }
    }
    return result
}

func main() {
    dist := [][]int{
        {0, 10, 15, 20},
        {10, 0, 35, 25},
        {15, 35, 0, 30},
        {20, 25, 30, 0},
    }
    fmt.Printf("TSP min cost: %d\n", tsp(dist))
}
```

```java
public class TSP {
    static int tsp(int[][] dist) {
        int n = dist.length;
        int INF = Integer.MAX_VALUE / 2;
        int[][] dp = new int[1 << n][n];
        for (int[] row : dp) java.util.Arrays.fill(row, INF);
        dp[1][0] = 0;

        for (int mask = 1; mask < (1 << n); mask++) {
            for (int u = 0; u < n; u++) {
                if (dp[mask][u] == INF || (mask & (1 << u)) == 0) continue;
                for (int v = 0; v < n; v++) {
                    if ((mask & (1 << v)) != 0) continue;
                    int nm = mask | (1 << v);
                    dp[nm][v] = Math.min(dp[nm][v], dp[mask][u] + dist[u][v]);
                }
            }
        }

        int full = (1 << n) - 1;
        int result = INF;
        for (int u = 0; u < n; u++) {
            result = Math.min(result, dp[full][u] + dist[u][0]);
        }
        return result;
    }

    public static void main(String[] args) {
        int[][] dist = {{0,10,15,20},{10,0,35,25},{15,35,0,30},{20,25,30,0}};
        System.out.printf("TSP min cost: %d%n", tsp(dist));
    }
}
```

```python
def tsp(dist):
    n = len(dist)
    INF = float('inf')
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0

    for mask in range(1, 1 << n):
        for u in range(n):
            if dp[mask][u] == INF or not (mask & (1 << u)):
                continue
            for v in range(n):
                if mask & (1 << v):
                    continue
                new_mask = mask | (1 << v)
                dp[new_mask][v] = min(dp[new_mask][v], dp[mask][u] + dist[u][v])

    full = (1 << n) - 1
    return min(dp[full][u] + dist[u][0] for u in range(n))

dist = [[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]
print(f"TSP min cost: {tsp(dist)}")  # 80
```

**Comparison for n=20:**
- Brute force O(n!): 20! = ~2.4 * 10^18 operations — completely infeasible.
- Bitmask DP O(2^n * n^2): 2^20 * 400 = ~4.2 * 10^8 operations — feasible in seconds.

**Summary of optimizations:**

| Exercise | Before | After | Technique |
|----------|--------|-------|-----------|
| 1 | O(2^n) | O(n) | Memoization |
| 2 | O(n) space | O(1) space | Iterative |
| 3 | O(2^n) | O(n) | DP |
| 4 | O(2^n) | O(n*W) | DP |
| 5 | O(2^n) | O(2^(n/2)) | Meet-in-middle |
| 6 | O(2^n) | O(n*amount) | DP |
| 7 | O(2^n) | O(n^2) | DP |
| 8 | O(2^(m+n)) | O(m*n) | DP |
| 9 | O(2^n) | O(n*W) | DP |
| 10 | O(3^(m+n)) | O(m*n) | DP |
| 11 | O(2^n) | O(n^3) | DP |
| 12 | O(n!) | O(2^n*n^2) | Bitmask DP |
