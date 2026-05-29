# Prefix Sums & Difference Arrays — Practice Tasks

> Solve every task in Go, Java, and Python. Reference implementations follow each task.

## Beginner Tasks

### Task 1 — Build a 1D Prefix Sum

Implement `buildPrefix(a)` returning a length-`n+1` array with `prefix[0] = 0`.

#### Go

```go
func BuildPrefix(a []int) []int {
	p := make([]int, len(a)+1)
	for i, v := range a {
		p[i+1] = p[i] + v
	}
	return p
}
```

#### Java

```java
public static long[] buildPrefix(int[] a) {
    long[] p = new long[a.length + 1];
    for (int i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i];
    return p;
}
```

#### Python

```python
def build_prefix(a):
    p = [0] * (len(a) + 1)
    for i, v in enumerate(a):
        p[i + 1] = p[i] + v
    return p
```

**Constraints:** `0 <= n <= 1e6`. Use 64-bit ints in Go/Java; Python ints are unbounded.

---

### Task 2 — Range Sum Query (Immutable)

Build an API `RangeSum.query(l, r)` returning the inclusive sum of `a[l..r]` in O(1).

#### Go

```go
type RangeSum struct{ p []int }

func NewRangeSum(a []int) *RangeSum {
	p := make([]int, len(a)+1)
	for i, v := range a {
		p[i+1] = p[i] + v
	}
	return &RangeSum{p: p}
}

func (r *RangeSum) Query(l, hi int) int { return r.p[hi+1] - r.p[l] }
```

#### Java

```java
public class RangeSum {
    private final long[] p;
    public RangeSum(int[] a) {
        p = new long[a.length + 1];
        for (int i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i];
    }
    public long query(int l, int r) { return p[r + 1] - p[l]; }
}
```

#### Python

```python
class RangeSum:
    def __init__(self, a):
        self.p = [0] * (len(a) + 1)
        for i, v in enumerate(a):
            self.p[i + 1] = self.p[i] + v
    def query(self, l, r):
        return self.p[r + 1] - self.p[l]
```

---

### Task 3 — Equilibrium Index

Find any index `i` such that the sum of `a[0..i-1]` equals the sum of `a[i+1..n-1]`. Return `-1` if none exists.

#### Go

```go
func Equilibrium(a []int) int {
	total := 0
	for _, v := range a {
		total += v
	}
	left := 0
	for i, v := range a {
		// right = total - left - v
		if left == total-left-v {
			return i
		}
		left += v
	}
	return -1
}
```

#### Java

```java
public static int equilibrium(int[] a) {
    long total = 0;
    for (int v : a) total += v;
    long left = 0;
    for (int i = 0; i < a.length; i++) {
        if (left == total - left - a[i]) return i;
        left += a[i];
    }
    return -1;
}
```

#### Python

```python
def equilibrium(a):
    total = sum(a)
    left = 0
    for i, v in enumerate(a):
        if left == total - left - v:
            return i
        left += v
    return -1
```

---

### Task 4 — Apply Range Updates Then Print

Given `n`, an initial all-zero array, and a list of `(l, r, v)` updates each adding `v` to `a[l..r]`, return the final array. Use a difference array.

#### Go

```go
func ApplyUpdates(n int, updates [][3]int) []int {
	diff := make([]int, n+1)
	for _, u := range updates {
		diff[u[0]] += u[2]
		diff[u[1]+1] -= u[2]
	}
	a := make([]int, n)
	cur := 0
	for i := 0; i < n; i++ {
		cur += diff[i]
		a[i] = cur
	}
	return a
}
```

#### Java

```java
public static int[] applyUpdates(int n, int[][] updates) {
    int[] diff = new int[n + 1];
    for (int[] u : updates) { diff[u[0]] += u[2]; diff[u[1] + 1] -= u[2]; }
    int[] a = new int[n];
    int cur = 0;
    for (int i = 0; i < n; i++) { cur += diff[i]; a[i] = cur; }
    return a;
}
```

#### Python

```python
def apply_updates(n, updates):
    diff = [0] * (n + 1)
    for l, r, v in updates:
        diff[l] += v
        diff[r + 1] -= v
    a, cur = [0] * n, 0
    for i in range(n):
        cur += diff[i]
        a[i] = cur
    return a
```

---

### Task 5 — Range XOR Query

Build a prefix-XOR array and answer queries `xor(a[l..r])` in O(1).

#### Go

```go
func BuildPrefixXOR(a []int) []int {
	p := make([]int, len(a)+1)
	for i, v := range a {
		p[i+1] = p[i] ^ v
	}
	return p
}
func RangeXOR(p []int, l, r int) int { return p[r+1] ^ p[l] }
```

#### Java

```java
public static int[] buildPrefixXor(int[] a) {
    int[] p = new int[a.length + 1];
    for (int i = 0; i < a.length; i++) p[i + 1] = p[i] ^ a[i];
    return p;
}
public static int rangeXor(int[] p, int l, int r) { return p[r + 1] ^ p[l]; }
```

#### Python

```python
def build_prefix_xor(a):
    p = [0] * (len(a) + 1)
    for i, v in enumerate(a):
        p[i + 1] = p[i] ^ v
    return p

def range_xor(p, l, r):
    return p[r + 1] ^ p[l]
```

---

## Intermediate Tasks

### Task 6 — Subarray Sum Equals K (count)

Return the number of contiguous subarrays summing to `k`. Handle negative values.

#### Go

```go
func SubarraySumK(a []int, k int) int {
	seen := map[int]int{0: 1}
	cnt, run := 0, 0
	for _, v := range a {
		run += v
		cnt += seen[run-k]
		seen[run]++
	}
	return cnt
}
```

#### Java

```java
public static int subarraySumK(int[] a, int k) {
    java.util.Map<Integer, Integer> seen = new java.util.HashMap<>();
    seen.put(0, 1);
    int cnt = 0, run = 0;
    for (int v : a) {
        run += v;
        cnt += seen.getOrDefault(run - k, 0);
        seen.merge(run, 1, Integer::sum);
    }
    return cnt;
}
```

#### Python

```python
from collections import defaultdict

def subarray_sum_k(a, k):
    seen = defaultdict(int); seen[0] = 1
    cnt = run = 0
    for v in a:
        run += v
        cnt += seen[run - k]
        seen[run] += 1
    return cnt
```

---

### Task 7 — Subarrays Divisible by K

Return the number of contiguous subarrays whose sum is divisible by `k`.

#### Go

```go
func SubarraysDivByK(a []int, k int) int {
	freq := map[int]int{0: 1}
	cnt, run := 0, 0
	for _, v := range a {
		run = ((run+v)%k + k) % k
		cnt += freq[run]
		freq[run]++
	}
	return cnt
}
```

#### Java

```java
public static int subarraysDivByK(int[] a, int k) {
    java.util.Map<Integer, Integer> freq = new java.util.HashMap<>();
    freq.put(0, 1);
    int cnt = 0, run = 0;
    for (int v : a) {
        run = ((run + v) % k + k) % k;
        cnt += freq.getOrDefault(run, 0);
        freq.merge(run, 1, Integer::sum);
    }
    return cnt;
}
```

#### Python

```python
from collections import defaultdict

def subarrays_div_by_k(a, k):
    freq = defaultdict(int); freq[0] = 1
    cnt = run = 0
    for v in a:
        run = (run + v) % k
        cnt += freq[run]
        freq[run] += 1
    return cnt
```

---

### Task 8 — Car Pooling

You drive a van of capacity `cap`. Each trip is `(passengers, from, to)`. Return whether you can ever satisfy every trip without exceeding capacity. (Range update on a passenger timeline.)

#### Go

```go
func CarPooling(trips [][3]int, cap int) bool {
	diff := make([]int, 1001)
	for _, t := range trips {
		diff[t[1]] += t[0]
		diff[t[2]] -= t[0]
	}
	cur := 0
	for _, d := range diff {
		cur += d
		if cur > cap {
			return false
		}
	}
	return true
}
```

#### Java

```java
public static boolean carPooling(int[][] trips, int cap) {
    int[] diff = new int[1001];
    for (int[] t : trips) { diff[t[1]] += t[0]; diff[t[2]] -= t[0]; }
    int cur = 0;
    for (int d : diff) { cur += d; if (cur > cap) return false; }
    return true;
}
```

#### Python

```python
def car_pooling(trips, cap):
    diff = [0] * 1001
    for p, f, t in trips:
        diff[f] += p
        diff[t] -= p
    cur = 0
    for d in diff:
        cur += d
        if cur > cap:
            return False
    return True
```

---

### Task 9 — 2D Submatrix Sum Query

Build a 2D prefix array and answer rectangle-sum queries in O(1).

#### Go

```go
func Build2D(a [][]int) [][]int {
	R, C := len(a), len(a[0])
	p := make([][]int, R+1)
	for i := range p {
		p[i] = make([]int, C+1)
	}
	for i := 0; i < R; i++ {
		for j := 0; j < C; j++ {
			p[i+1][j+1] = a[i][j] + p[i+1][j] + p[i][j+1] - p[i][j]
		}
	}
	return p
}
func Rect(p [][]int, r1, c1, r2, c2 int) int {
	return p[r2+1][c2+1] - p[r1][c2+1] - p[r2+1][c1] + p[r1][c1]
}
```

#### Java

```java
public static long[][] build2D(int[][] a) {
    int R = a.length, C = a[0].length;
    long[][] p = new long[R + 1][C + 1];
    for (int i = 0; i < R; i++)
        for (int j = 0; j < C; j++)
            p[i+1][j+1] = a[i][j] + p[i+1][j] + p[i][j+1] - p[i][j];
    return p;
}
public static long rect(long[][] p, int r1, int c1, int r2, int c2) {
    return p[r2+1][c2+1] - p[r1][c2+1] - p[r2+1][c1] + p[r1][c1];
}
```

#### Python

```python
def build_2d(a):
    R, C = len(a), len(a[0])
    p = [[0] * (C + 1) for _ in range(R + 1)]
    for i in range(R):
        for j in range(C):
            p[i+1][j+1] = a[i][j] + p[i+1][j] + p[i][j+1] - p[i][j]
    return p

def rect(p, r1, c1, r2, c2):
    return p[r2+1][c2+1] - p[r1][c2+1] - p[r2+1][c1] + p[r1][c1]
```

---

### Task 10 — Longest Subarray with Sum K

Return the length of the longest contiguous subarray with sum exactly `k`. Use a hash map of first-seen prefix sums.

#### Go

```go
func LongestSubarraySumK(a []int, k int) int {
	first := map[int]int{0: -1}
	run, best := 0, 0
	for i, v := range a {
		run += v
		if idx, ok := first[run-k]; ok {
			if i-idx > best {
				best = i - idx
			}
		}
		if _, ok := first[run]; !ok {
			first[run] = i
		}
	}
	return best
}
```

#### Java

```java
public static int longestSubarraySumK(int[] a, int k) {
    java.util.Map<Integer, Integer> first = new java.util.HashMap<>();
    first.put(0, -1);
    int run = 0, best = 0;
    for (int i = 0; i < a.length; i++) {
        run += a[i];
        if (first.containsKey(run - k)) best = Math.max(best, i - first.get(run - k));
        first.putIfAbsent(run, i);
    }
    return best;
}
```

#### Python

```python
def longest_subarray_sum_k(a, k):
    first = {0: -1}
    run = best = 0
    for i, v in enumerate(a):
        run += v
        if run - k in first:
            best = max(best, i - first[run - k])
        first.setdefault(run, i)
    return best
```

---

## Advanced Tasks

### Task 11 — Maximum r x c Submatrix Sum

Given a matrix and fixed dimensions `r, c`, find the maximum sum of any `r x c` submatrix using a 2D prefix sum.

#### Go

```go
func MaxRCSubmatrix(a [][]int, r, c int) int {
	p := Build2D(a) // from Task 9
	R, C := len(a), len(a[0])
	best := -1 << 31
	for i := 0; i+r <= R; i++ {
		for j := 0; j+c <= C; j++ {
			s := Rect(p, i, j, i+r-1, j+c-1)
			if s > best {
				best = s
			}
		}
	}
	return best
}
```

#### Java

```java
public static long maxRcSubmatrix(int[][] a, int r, int c) {
    long[][] p = build2D(a); // from Task 9
    int R = a.length, C = a[0].length;
    long best = Long.MIN_VALUE;
    for (int i = 0; i + r <= R; i++)
        for (int j = 0; j + c <= C; j++)
            best = Math.max(best, rect(p, i, j, i + r - 1, j + c - 1));
    return best;
}
```

#### Python

```python
def max_rc_submatrix(a, r, c):
    p = build_2d(a)  # from Task 9
    R, C = len(a), len(a[0])
    best = float('-inf')
    for i in range(R - r + 1):
        for j in range(C - c + 1):
            best = max(best, rect(p, i, j, i + r - 1, j + c - 1))
    return best
```

---

### Task 12 — Maximum Sum Submatrix (Any Size)

Find the maximum sum submatrix of any size in an `R x C` matrix. Reduce to 1D Kadane per row-pair.

#### Go

```go
func MaxSubmatrix(a [][]int) int {
	R, C := len(a), len(a[0])
	best := -1 << 31
	for r1 := 0; r1 < R; r1++ {
		col := make([]int, C)
		for r2 := r1; r2 < R; r2++ {
			for j := 0; j < C; j++ {
				col[j] += a[r2][j]
			}
			// Kadane on col
			cur, max := col[0], col[0]
			for j := 1; j < C; j++ {
				if cur+col[j] < col[j] {
					cur = col[j]
				} else {
					cur += col[j]
				}
				if cur > max {
					max = cur
				}
			}
			if max > best {
				best = max
			}
		}
	}
	return best
}
```

#### Java

```java
public static long maxSubmatrix(int[][] a) {
    int R = a.length, C = a[0].length;
    long best = Long.MIN_VALUE;
    for (int r1 = 0; r1 < R; r1++) {
        long[] col = new long[C];
        for (int r2 = r1; r2 < R; r2++) {
            for (int j = 0; j < C; j++) col[j] += a[r2][j];
            long cur = col[0], localBest = col[0];
            for (int j = 1; j < C; j++) {
                cur = Math.max(col[j], cur + col[j]);
                localBest = Math.max(localBest, cur);
            }
            best = Math.max(best, localBest);
        }
    }
    return best;
}
```

#### Python

```python
def max_submatrix(a):
    R, C = len(a), len(a[0])
    best = float('-inf')
    for r1 in range(R):
        col = [0] * C
        for r2 in range(r1, R):
            for j in range(C):
                col[j] += a[r2][j]
            cur = local_best = col[0]
            for j in range(1, C):
                cur = max(col[j], cur + col[j])
                local_best = max(local_best, cur)
            best = max(best, local_best)
    return best
```

---

### Task 13 — 2D Difference Array

Apply many `(r1, c1, r2, c2, v)` range-add updates to a 2D matrix and return the final matrix.

#### Go

```go
func Apply2DUpdates(R, C int, ups [][5]int) [][]int {
	D := make([][]int, R+1)
	for i := range D {
		D[i] = make([]int, C+1)
	}
	for _, u := range ups {
		r1, c1, r2, c2, v := u[0], u[1], u[2], u[3], u[4]
		D[r1][c1] += v
		D[r1][c2+1] -= v
		D[r2+1][c1] -= v
		D[r2+1][c2+1] += v
	}
	out := make([][]int, R)
	for i := 0; i < R; i++ {
		out[i] = make([]int, C)
		for j := 0; j < C; j++ {
			if i > 0 {
				D[i][j] += D[i-1][j]
			}
			if j > 0 {
				D[i][j] += D[i][j-1]
			}
			if i > 0 && j > 0 {
				D[i][j] -= D[i-1][j-1]
			}
			out[i][j] = D[i][j]
		}
	}
	return out
}
```

#### Java

```java
public static int[][] apply2DUpdates(int R, int C, int[][] ups) {
    int[][] D = new int[R + 1][C + 1];
    for (int[] u : ups) {
        D[u[0]][u[1]] += u[4]; D[u[0]][u[3] + 1] -= u[4];
        D[u[2] + 1][u[1]] -= u[4]; D[u[2] + 1][u[3] + 1] += u[4];
    }
    int[][] out = new int[R][C];
    for (int i = 0; i < R; i++)
        for (int j = 0; j < C; j++) {
            if (i > 0) D[i][j] += D[i - 1][j];
            if (j > 0) D[i][j] += D[i][j - 1];
            if (i > 0 && j > 0) D[i][j] -= D[i - 1][j - 1];
            out[i][j] = D[i][j];
        }
    return out;
}
```

#### Python

```python
def apply_2d_updates(R, C, ups):
    D = [[0] * (C + 1) for _ in range(R + 1)]
    for r1, c1, r2, c2, v in ups:
        D[r1][c1] += v
        D[r1][c2 + 1] -= v
        D[r2 + 1][c1] -= v
        D[r2 + 1][c2 + 1] += v
    out = [[0] * C for _ in range(R)]
    for i in range(R):
        for j in range(C):
            if i > 0: D[i][j] += D[i - 1][j]
            if j > 0: D[i][j] += D[i][j - 1]
            if i > 0 and j > 0: D[i][j] -= D[i - 1][j - 1]
            out[i][j] = D[i][j]
    return out
```

---

### Task 14 — Count Submatrices Summing to Target

Given a matrix and target `T`, count submatrices whose sum equals `T`. Reduce to 1D subarray-sum-K per row-pair.

#### Go

```go
func NumSubmatrixSumTarget(a [][]int, T int) int {
	R, C := len(a), len(a[0])
	count := 0
	for r1 := 0; r1 < R; r1++ {
		col := make([]int, C)
		for r2 := r1; r2 < R; r2++ {
			for j := 0; j < C; j++ {
				col[j] += a[r2][j]
			}
			// subarray sum equals T on col
			seen := map[int]int{0: 1}
			run := 0
			for _, v := range col {
				run += v
				count += seen[run-T]
				seen[run]++
			}
		}
	}
	return count
}
```

#### Java

```java
public static int numSubmatrixSumTarget(int[][] a, int T) {
    int R = a.length, C = a[0].length, count = 0;
    for (int r1 = 0; r1 < R; r1++) {
        int[] col = new int[C];
        for (int r2 = r1; r2 < R; r2++) {
            for (int j = 0; j < C; j++) col[j] += a[r2][j];
            java.util.Map<Integer, Integer> seen = new java.util.HashMap<>();
            seen.put(0, 1);
            int run = 0;
            for (int v : col) {
                run += v;
                count += seen.getOrDefault(run - T, 0);
                seen.merge(run, 1, Integer::sum);
            }
        }
    }
    return count;
}
```

#### Python

```python
from collections import defaultdict

def num_submatrix_sum_target(a, T):
    R, C = len(a), len(a[0])
    count = 0
    for r1 in range(R):
        col = [0] * C
        for r2 in range(r1, R):
            for j in range(C):
                col[j] += a[r2][j]
            seen = defaultdict(int); seen[0] = 1
            run = 0
            for v in col:
                run += v
                count += seen[run - T]
                seen[run] += 1
    return count
```

---

### Task 15 — Hillis-Steele Parallel Prefix (Sequential Simulation)

Implement Hillis-Steele scan sequentially (simulating parallel steps) and verify it produces the same result as a straight prefix sum.

#### Go

```go
func HillisSteele(a []int) []int {
	n := len(a)
	b := make([]int, n)
	copy(b, a)
	tmp := make([]int, n)
	for d := 1; d < n; d *= 2 {
		copy(tmp, b)
		for i := d; i < n; i++ {
			tmp[i] = b[i] + b[i-d]
		}
		copy(b, tmp)
	}
	return b // inclusive scan
}
```

#### Java

```java
public static int[] hillisSteele(int[] a) {
    int n = a.length;
    int[] b = a.clone();
    int[] tmp = new int[n];
    for (int d = 1; d < n; d *= 2) {
        System.arraycopy(b, 0, tmp, 0, n);
        for (int i = d; i < n; i++) tmp[i] = b[i] + b[i - d];
        System.arraycopy(tmp, 0, b, 0, n);
    }
    return b;
}
```

#### Python

```python
def hillis_steele(a):
    b = a[:]
    n = len(b)
    d = 1
    while d < n:
        tmp = b[:]
        for i in range(d, n):
            tmp[i] = b[i] + b[i - d]
        b = tmp
        d *= 2
    return b  # inclusive scan
```

---

## Benchmark Task

Compare a prefix-sum-based range-sum API against a naive per-query loop. Run the same workload in all three languages.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	rng := rand.New(rand.NewSource(42))
	sizes := []int{1000, 10000, 100000, 1000000}
	queries := 100000
	for _, n := range sizes {
		a := make([]int, n)
		for i := range a {
			a[i] = rng.Intn(1000)
		}
		p := make([]int, n+1)
		for i, v := range a {
			p[i+1] = p[i] + v
		}
		start := time.Now()
		for q := 0; q < queries; q++ {
			l := rng.Intn(n)
			r := l + rng.Intn(n-l)
			_ = p[r+1] - p[l]
		}
		fmt.Printf("prefix n=%d: %.3f ms\n", n, float64(time.Since(start).Milliseconds()))
	}
}
```

#### Java

```java
import java.util.Random;

public class Bench {
    public static void main(String[] args) {
        Random rng = new Random(42);
        int[] sizes = {1_000, 10_000, 100_000, 1_000_000};
        int queries = 100_000;
        for (int n : sizes) {
            int[] a = new int[n];
            for (int i = 0; i < n; i++) a[i] = rng.nextInt(1000);
            long[] p = new long[n + 1];
            for (int i = 0; i < n; i++) p[i + 1] = p[i] + a[i];
            long start = System.nanoTime();
            long sink = 0;
            for (int q = 0; q < queries; q++) {
                int l = rng.nextInt(n);
                int r = l + rng.nextInt(n - l);
                sink += p[r + 1] - p[l];
            }
            long ns = System.nanoTime() - start;
            System.out.printf("prefix n=%d: %.3f ms (sink=%d)%n", n, ns / 1e6, sink);
        }
    }
}
```

#### Python

```python
import random, time

random.seed(42)
sizes = [1_000, 10_000, 100_000, 1_000_000]
queries = 100_000
for n in sizes:
    a = [random.randrange(1000) for _ in range(n)]
    p = [0] * (n + 1)
    for i, v in enumerate(a):
        p[i + 1] = p[i] + v
    start = time.perf_counter()
    sink = 0
    for _ in range(queries):
        l = random.randrange(n)
        r = l + random.randrange(n - l)
        sink += p[r + 1] - p[l]
    print(f"prefix n={n}: {(time.perf_counter() - start) * 1000:.3f} ms (sink={sink})")
```

**Expected observation:** the per-query cost is constant regardless of `n`. The runtime should scale only with the number of queries, not the array length.
