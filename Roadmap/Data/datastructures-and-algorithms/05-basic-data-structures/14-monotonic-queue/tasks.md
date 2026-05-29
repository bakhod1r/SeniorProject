# Monotonic Queue — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.

## Beginner Tasks

### Task 1: Sliding Window Maximum

> Given an array `a` and a window size `k`, output the max of every window of size `k`.

#### Go

```go
package main

import "fmt"

func maxWindow(a []int, k int) []int {
	if k <= 0 || len(a) < k {
		return nil
	}
	out := make([]int, 0, len(a)-k+1)
	dq := []int{}
	for i, x := range a {
		if len(dq) > 0 && dq[0] < i-k+1 {
			dq = dq[1:]
		}
		for len(dq) > 0 && a[dq[len(dq)-1]] < x {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
		if i >= k-1 {
			out = append(out, a[dq[0]])
		}
	}
	return out
}

func main() {
	fmt.Println(maxWindow([]int{1, 3, -1, -3, 5, 3, 6, 7}, 3)) // [3 3 5 5 6 7]
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Arrays;

public class Task1 {
    public static int[] maxWindow(int[] a, int k) {
        if (k <= 0 || a.length < k) return new int[0];
        int[] out = new int[a.length - k + 1];
        Deque<Integer> dq = new ArrayDeque<>();
        int idx = 0;
        for (int i = 0; i < a.length; i++) {
            if (!dq.isEmpty() && dq.peekFirst() < i - k + 1) dq.pollFirst();
            while (!dq.isEmpty() && a[dq.peekLast()] < a[i]) dq.pollLast();
            dq.offerLast(i);
            if (i >= k - 1) out[idx++] = a[dq.peekFirst()];
        }
        return out;
    }
    public static void main(String[] args) {
        System.out.println(Arrays.toString(maxWindow(new int[]{1,3,-1,-3,5,3,6,7}, 3)));
    }
}
```

#### Python

```python
from collections import deque

def max_window(a, k):
    if k <= 0 or len(a) < k:
        return []
    out, dq = [], deque()
    for i, x in enumerate(a):
        if dq and dq[0] < i - k + 1:
            dq.popleft()
        while dq and a[dq[-1]] < x:
            dq.pop()
        dq.append(i)
        if i >= k - 1:
            out.append(a[dq[0]])
    return out

print(max_window([1, 3, -1, -3, 5, 3, 6, 7], 3))  # [3, 3, 5, 5, 6, 7]
```

- **Constraints:** `1 <= len(a) <= 10^5`, `1 <= k <= len(a)`. Required `O(n)`.
- **Expected output:** array of window maxima.
- **Evaluation:** correctness on `k = 1`, `k = n`, all-equal input, strictly increasing input, strictly decreasing input.

---

### Task 2: Sliding Window Minimum

Implement `minWindow(a, k)` returning the min of every window of size `k`. Identical pattern, increasing deque.

#### Go

```go
func minWindow(a []int, k int) []int {
	dq := []int{}
	out := []int{}
	for i, x := range a {
		if len(dq) > 0 && dq[0] < i-k+1 {
			dq = dq[1:]
		}
		for len(dq) > 0 && a[dq[len(dq)-1]] > x {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
		if i >= k-1 {
			out = append(out, a[dq[0]])
		}
	}
	return out
}
```

#### Java

```java
public static int[] minWindow(int[] a, int k) {
    int[] out = new int[Math.max(0, a.length - k + 1)];
    Deque<Integer> dq = new ArrayDeque<>();
    int idx = 0;
    for (int i = 0; i < a.length; i++) {
        if (!dq.isEmpty() && dq.peekFirst() < i - k + 1) dq.pollFirst();
        while (!dq.isEmpty() && a[dq.peekLast()] > a[i]) dq.pollLast();
        dq.offerLast(i);
        if (i >= k - 1) out[idx++] = a[dq.peekFirst()];
    }
    return out;
}
```

#### Python

```python
def min_window(a, k):
    dq, out = deque(), []
    for i, x in enumerate(a):
        if dq and dq[0] < i - k + 1:
            dq.popleft()
        while dq and a[dq[-1]] > x:
            dq.pop()
        dq.append(i)
        if i >= k - 1:
            out.append(a[dq[0]])
    return out
```

- Test on `[2, 1, 5, 3, 6, 4, 8]`, `k = 3` -> `[1, 1, 3, 3, 4]`.

---

### Task 3: Window Range (max - min)

For each window of size `k`, return `max - min`. Run two deques in parallel.

#### Go

```go
func windowRange(a []int, k int) []int {
	dqMax, dqMin := []int{}, []int{}
	out := []int{}
	for i, x := range a {
		if len(dqMax) > 0 && dqMax[0] < i-k+1 { dqMax = dqMax[1:] }
		if len(dqMin) > 0 && dqMin[0] < i-k+1 { dqMin = dqMin[1:] }
		for len(dqMax) > 0 && a[dqMax[len(dqMax)-1]] < x { dqMax = dqMax[:len(dqMax)-1] }
		for len(dqMin) > 0 && a[dqMin[len(dqMin)-1]] > x { dqMin = dqMin[:len(dqMin)-1] }
		dqMax = append(dqMax, i)
		dqMin = append(dqMin, i)
		if i >= k-1 {
			out = append(out, a[dqMax[0]]-a[dqMin[0]])
		}
	}
	return out
}
```

#### Java

```java
public static int[] windowRange(int[] a, int k) {
    Deque<Integer> dqMax = new ArrayDeque<>(), dqMin = new ArrayDeque<>();
    int[] out = new int[a.length - k + 1];
    int idx = 0;
    for (int i = 0; i < a.length; i++) {
        if (!dqMax.isEmpty() && dqMax.peekFirst() < i - k + 1) dqMax.pollFirst();
        if (!dqMin.isEmpty() && dqMin.peekFirst() < i - k + 1) dqMin.pollFirst();
        while (!dqMax.isEmpty() && a[dqMax.peekLast()] < a[i]) dqMax.pollLast();
        while (!dqMin.isEmpty() && a[dqMin.peekLast()] > a[i]) dqMin.pollLast();
        dqMax.offerLast(i);
        dqMin.offerLast(i);
        if (i >= k - 1) out[idx++] = a[dqMax.peekFirst()] - a[dqMin.peekFirst()];
    }
    return out;
}
```

#### Python

```python
def window_range(a, k):
    dq_max, dq_min, out = deque(), deque(), []
    for i, x in enumerate(a):
        if dq_max and dq_max[0] < i - k + 1: dq_max.popleft()
        if dq_min and dq_min[0] < i - k + 1: dq_min.popleft()
        while dq_max and a[dq_max[-1]] < x: dq_max.pop()
        while dq_min and a[dq_min[-1]] > x: dq_min.pop()
        dq_max.append(i)
        dq_min.append(i)
        if i >= k - 1:
            out.append(a[dq_max[0]] - a[dq_min[0]])
    return out
```

- **Constraints:** O(n) total.

---

### Task 4: First Negative in Window

For each window of size `k`, output the first negative number, or 0 if no negative exists. Use a single deque storing only negative indices (no monotonicity needed — just expiration).

- Solve in 3 languages. Constraints: O(n).
- Test: `[-8, 2, 3, -6, 10]`, `k = 2` -> `[-8, 0, -6, -6]`.

---

### Task 5: K-th Window Max

Given `a`, `k`, return the maximum of just the `q`-th window (0-indexed). Use the monotonic-deque template, stop after the `q`-th window is fully processed.

- Solve in 3 languages. O(q + k) time, O(k) space.

---

## Intermediate Tasks

### Task 6: Jump Game VI

> You start at index 0 of `nums`. At each step you may move 1 to `k` positions forward. Maximize the sum of values along your path, ending at `n - 1`.

Use DP with a monotonic deque: `f[i] = nums[i] + max f[j] for j in [i-k, i-1]`.

#### Go

```go
func maxResult(nums []int, k int) int {
	f := make([]int, len(nums))
	f[0] = nums[0]
	dq := []int{0}
	for i := 1; i < len(nums); i++ {
		if dq[0] < i-k { dq = dq[1:] }
		f[i] = nums[i] + f[dq[0]]
		for len(dq) > 0 && f[dq[len(dq)-1]] <= f[i] {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
	}
	return f[len(nums)-1]
}
```

#### Java

```java
public static int maxResult(int[] nums, int k) {
    int n = nums.length;
    int[] f = new int[n];
    f[0] = nums[0];
    Deque<Integer> dq = new ArrayDeque<>();
    dq.offerLast(0);
    for (int i = 1; i < n; i++) {
        if (dq.peekFirst() < i - k) dq.pollFirst();
        f[i] = nums[i] + f[dq.peekFirst()];
        while (!dq.isEmpty() && f[dq.peekLast()] <= f[i]) dq.pollLast();
        dq.offerLast(i);
    }
    return f[n - 1];
}
```

#### Python

```python
def max_result(nums, k):
    n = len(nums)
    f = [0] * n
    f[0] = nums[0]
    dq = deque([0])
    for i in range(1, n):
        if dq[0] < i - k:
            dq.popleft()
        f[i] = nums[i] + f[dq[0]]
        while dq and f[dq[-1]] <= f[i]:
            dq.pop()
        dq.append(i)
    return f[-1]
```

---

### Task 7: Constrained Subsequence Sum (Leetcode 1425)

> Pick a subsequence of `nums` such that consecutive picks are at most `k` apart. Maximize the sum.

Recurrence: `f[i] = nums[i] + max(0, max f[j] for j in [i-k, i-1])`. Answer is `max f`.

- Solve in 3 languages. O(n).

---

### Task 8: Largest Sum Subarray of Length at Most K

> Given `a` and `k`, find the largest sum of any contiguous subarray of length 1..k.

Prefix sums + sliding window min on `P`. For each `i`, answer candidate is `P[i] - min(P[j]) for j in [i-k, i-1]`.

- Solve in 3 languages. O(n).

---

### Task 9: Shortest Subarray with Sum at Least K (Leetcode 862)

> Given an integer array `nums` and integer `K`, return the length of the shortest contiguous subarray with sum `>= K`. Return -1 if none.

Use prefix sums and a monotonic deque of indices where prefix-sum values are increasing.

#### Go

```go
func shortestSubarray(nums []int, K int) int {
	n := len(nums)
	P := make([]int64, n+1)
	for i := 0; i < n; i++ {
		P[i+1] = P[i] + int64(nums[i])
	}
	dq := []int{}
	ans := n + 1
	for i := 0; i <= n; i++ {
		for len(dq) > 0 && P[i]-P[dq[0]] >= int64(K) {
			if i-dq[0] < ans { ans = i - dq[0] }
			dq = dq[1:]
		}
		for len(dq) > 0 && P[dq[len(dq)-1]] >= P[i] {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
	}
	if ans == n+1 { return -1 }
	return ans
}
```

#### Java

```java
public static int shortestSubarray(int[] nums, int K) {
    int n = nums.length;
    long[] P = new long[n + 1];
    for (int i = 0; i < n; i++) P[i + 1] = P[i] + nums[i];
    Deque<Integer> dq = new ArrayDeque<>();
    int ans = n + 1;
    for (int i = 0; i <= n; i++) {
        while (!dq.isEmpty() && P[i] - P[dq.peekFirst()] >= K) {
            ans = Math.min(ans, i - dq.pollFirst());
        }
        while (!dq.isEmpty() && P[dq.peekLast()] >= P[i]) dq.pollLast();
        dq.offerLast(i);
    }
    return ans == n + 1 ? -1 : ans;
}
```

#### Python

```python
def shortest_subarray(nums, K):
    n = len(nums)
    P = [0] * (n + 1)
    for i in range(n):
        P[i + 1] = P[i] + nums[i]
    dq, ans = deque(), n + 1
    for i in range(n + 1):
        while dq and P[i] - P[dq[0]] >= K:
            ans = min(ans, i - dq.popleft())
        while dq and P[dq[-1]] >= P[i]:
            dq.pop()
        dq.append(i)
    return -1 if ans == n + 1 else ans
```

---

### Task 10: Largest Rectangle in Histogram with Width Constraint

> Variant: find the largest rectangle whose width is at most `w`. Combine monotonic stack (for histogram) with monotonic deque (for the width cap).

- Solve in 3 languages.

---

## Advanced Tasks

### Task 11: 2D Sliding Window Maximum

> Given a matrix and a window size `(r, c)`, find the max in every `r x c` window.

Apply sliding window max along each row (window size `c`), then along each column of the row results (window size `r`). Two passes, total O(N * M).

- Solve in 3 languages.

---

### Task 12: Online Streaming Max with Time Expiration

> Implement a class `StreamingMax(window_ms)` with `add(timestamp, value)` and `current_max()`. Expire on time, not count.

- Solve in 3 languages. Each call O(1) amortized.

---

### Task 13: Convex Hull Trick — DP Optimization

> Solve a DP of the form `f(i) = min_j (f(j) + b_j * x_i + c_j)` where `b_j` is monotone decreasing and `x_i` is monotone increasing.

Use a monotonic deque of lines, maintaining the lower envelope.

- Solve in 3 languages. O(n) total.

---

### Task 14: Sliding Window Median (NOT solvable with monotonic deque)

> Given `a` and `k`, return the median of every window of size `k`.

The point of this task is to recognize that monotonic deque does NOT work for medians. Implement with two heaps + lazy deletion. Discuss in your solution why a monotonic deque is wrong here.

- Solve in 3 languages. O(n log k).

---

### Task 15: Parallel Sliding Window Max (Block Decomposition)

> Implement sliding window max using block prefix/suffix max instead of a monotonic deque. The blocks should be of size `k`.

- Solve in 3 languages. O(n) work, ready for parallel block computation.
- Compare its runtime vs the monotonic-deque version on `n = 10^7`.

---

## Benchmark Task

> Compare the monotonic-deque sliding window max against the brute-force `O(n*k)` baseline.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func bruteMax(a []int, k int) []int {
	out := make([]int, 0, len(a)-k+1)
	for i := 0; i+k <= len(a); i++ {
		m := a[i]
		for j := i; j < i+k; j++ {
			if a[j] > m { m = a[j] }
		}
		out = append(out, m)
	}
	return out
}

func dequeMax(a []int, k int) []int {
	out := make([]int, 0, len(a)-k+1)
	dq := []int{}
	for i, x := range a {
		if len(dq) > 0 && dq[0] < i-k+1 { dq = dq[1:] }
		for len(dq) > 0 && a[dq[len(dq)-1]] < x { dq = dq[:len(dq)-1] }
		dq = append(dq, i)
		if i >= k-1 { out = append(out, a[dq[0]]) }
	}
	return out
}

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	k := 100
	for _, n := range sizes {
		data := make([]int, n)
		for i := range data { data[i] = i % 7 }
		t := time.Now()
		dequeMax(data, k)
		fmt.Printf("deque   n=%8d: %v\n", n, time.Since(t))
		if n <= 100000 {
			t = time.Now()
			bruteMax(data, k)
			fmt.Printf("brute   n=%8d: %v\n", n, time.Since(t))
		}
	}
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class Benchmark {
    static int[] bruteMax(int[] a, int k) {
        int[] out = new int[a.length - k + 1];
        for (int i = 0; i + k <= a.length; i++) {
            int m = a[i];
            for (int j = i; j < i + k; j++) if (a[j] > m) m = a[j];
            out[i] = m;
        }
        return out;
    }
    static int[] dequeMax(int[] a, int k) {
        int[] out = new int[a.length - k + 1];
        Deque<Integer> dq = new ArrayDeque<>();
        int idx = 0;
        for (int i = 0; i < a.length; i++) {
            if (!dq.isEmpty() && dq.peekFirst() < i - k + 1) dq.pollFirst();
            while (!dq.isEmpty() && a[dq.peekLast()] < a[i]) dq.pollLast();
            dq.offerLast(i);
            if (i >= k - 1) out[idx++] = a[dq.peekFirst()];
        }
        return out;
    }
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        int k = 100;
        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = i % 7;
            long t = System.nanoTime();
            dequeMax(data, k);
            System.out.printf("deque n=%8d: %.3f ms%n", n, (System.nanoTime() - t) / 1e6);
            if (n <= 100000) {
                t = System.nanoTime();
                bruteMax(data, k);
                System.out.printf("brute n=%8d: %.3f ms%n", n, (System.nanoTime() - t) / 1e6);
            }
        }
    }
}
```

#### Python

```python
import time
from collections import deque

def brute_max(a, k):
    return [max(a[i:i+k]) for i in range(len(a) - k + 1)]

def deque_max(a, k):
    dq, out = deque(), []
    for i, x in enumerate(a):
        if dq and dq[0] < i - k + 1: dq.popleft()
        while dq and a[dq[-1]] < x: dq.pop()
        dq.append(i)
        if i >= k - 1: out.append(a[dq[0]])
    return out

if __name__ == "__main__":
    k = 100
    for n in [1_000, 10_000, 100_000, 1_000_000]:
        data = [i % 7 for i in range(n)]
        t = time.perf_counter()
        deque_max(data, k)
        print(f"deque n={n:>8}: {(time.perf_counter() - t) * 1000:.3f} ms")
        if n <= 100_000:
            t = time.perf_counter()
            brute_max(data, k)
            print(f"brute n={n:>8}: {(time.perf_counter() - t) * 1000:.3f} ms")
```

**Expected observation:** Deque scales linearly with `n` regardless of `k`; brute force scales with `n * k` and quickly becomes impractical past `n = 10^5`.
