# Interpolation Search — Practice Tasks

> 15 graded practice problems with full Go / Java / Python solutions. Each task starts with a **problem statement**, gives **constraints**, then provides three implementations. Difficulty grows from "warmup" to "this is hard". Focus areas: vanilla interpolation, overflow-safe variants, hybrid fallback, float timestamps, finding first/last occurrence, distribution detection, and benchmarking.

---

## Task 1 — Classic Interpolation Search

**Problem.** Given a sorted array `arr[]` and target `t`, return the index of `t`, or `-1` if absent.

**Constraints.** `1 <= n <= 10^6`; distinct integer values; data approximately uniform.

**Go:**
```go
func interpSearch(arr []int, t int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == t { return lo }
            return -1
        }
        pos := lo + (t-arr[lo])*(hi-lo)/(arr[hi]-arr[lo])
        if arr[pos] == t { return pos }
        if arr[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    return -1
}
```

**Java:**
```java
int interpSearch(int[] arr, int t) {
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        if (arr[lo] == arr[hi]) return arr[lo] == t ? lo : -1;
        int pos = lo + (t - arr[lo]) * (hi - lo) / (arr[hi] - arr[lo]);
        if (arr[pos] == t) return pos;
        if (arr[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    return -1;
}
```

**Python:**
```python
def interp_search(arr, t):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == t else -1
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        if arr[pos] == t: return pos
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    return -1
```

---

## Task 2 — Overflow-Safe Interpolation Search

**Problem.** Same as Task 1, but values can be up to `INT_MAX = 2^31 - 1` and the array can have up to `2^31 - 1` elements. The naive multiplication overflows 32-bit arithmetic. Fix by using 64-bit math.

**Go:**
```go
func interpSearchSafe(arr []int, t int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == t { return lo }
            return -1
        }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if arr[pos] == t { return pos }
        if arr[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    return -1
}
```

**Java:**
```java
int interpSearchSafe(int[] arr, int t) {
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        if (arr[lo] == arr[hi]) return arr[lo] == t ? lo : -1;
        long num = (long)(t - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (arr[pos] == t) return pos;
        if (arr[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    return -1;
}
```

**Python:**
```python
def interp_search_safe(arr, t):
    # Python int is arbitrary precision; no overflow possible.
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == t else -1
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        if arr[pos] == t: return pos
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    return -1
```

---

## Task 3 — Hybrid Interpolation+Binary

**Problem.** Implement interpolation search with a binary-search fallback after `K = 8` probes. Guarantees O(log n) worst case.

**Go:**
```go
func hybridSearch(arr []int, t int) int {
    const maxInterp = 8
    lo, hi := 0, len(arr)-1
    probes := 0
    for lo <= hi && t >= arr[lo] && t <= arr[hi] && probes < maxInterp {
        if arr[lo] == arr[hi] {
            if arr[lo] == t { return lo }
            return -1
        }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        probes++
        if arr[pos] == t { return pos }
        if arr[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == t { return mid }
        if arr[mid] < t { lo = mid + 1 } else { hi = mid - 1 }
    }
    return -1
}
```

**Java:**
```java
int hybridSearch(int[] arr, int t) {
    final int MAX = 8;
    int lo = 0, hi = arr.length - 1, p = 0;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi] && p < MAX) {
        if (arr[lo] == arr[hi]) return arr[lo] == t ? lo : -1;
        long num = (long)(t - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        p++;
        if (arr[pos] == t) return pos;
        if (arr[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == t) return mid;
        if (arr[mid] < t) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
}
```

**Python:**
```python
def hybrid_search(arr, t, max_interp=8):
    lo, hi, probes = 0, len(arr) - 1, 0
    while lo <= hi and arr[lo] <= t <= arr[hi] and probes < max_interp:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == t else -1
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        probes += 1
        if arr[pos] == t: return pos
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == t: return mid
        if arr[mid] < t: lo = mid + 1
        else: hi = mid - 1
    return -1
```

---

## Task 4 — Find First Occurrence

**Problem.** Sorted array with duplicates. Return the smallest `i` with `arr[i] == t`, or `-1`.

**Go:**
```go
func interpFindFirst(arr []int, t int) int {
    lo, hi, ans := 0, len(arr)-1, -1
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == t { return lo }
            return ans
        }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        switch {
        case arr[pos] == t:
            ans = pos
            hi = pos - 1
        case arr[pos] < t:
            lo = pos + 1
        default:
            hi = pos - 1
        }
    }
    return ans
}
```

**Java:**
```java
int interpFindFirst(int[] arr, int t) {
    int lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        if (arr[lo] == arr[hi]) return arr[lo] == t ? lo : ans;
        long num = (long)(t - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (arr[pos] == t) { ans = pos; hi = pos - 1; }
        else if (arr[pos] < t) lo = pos + 1;
        else                   hi = pos - 1;
    }
    return ans;
}
```

**Python:**
```python
def interp_find_first(arr, t):
    lo, hi, ans = 0, len(arr) - 1, -1
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == t else ans
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        if arr[pos] == t:
            ans = pos
            hi = pos - 1
        elif arr[pos] < t:
            lo = pos + 1
        else:
            hi = pos - 1
    return ans
```

---

## Task 5 — Find Last Occurrence

**Problem.** Sorted array with duplicates. Return the largest `i` with `arr[i] == t`, or `-1`.

**Go:**
```go
func interpFindLast(arr []int, t int) int {
    lo, hi, ans := 0, len(arr)-1, -1
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == t { return hi }
            return ans
        }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        switch {
        case arr[pos] == t:
            ans = pos
            lo = pos + 1     // keep searching right
        case arr[pos] < t:
            lo = pos + 1
        default:
            hi = pos - 1
        }
    }
    return ans
}
```

**Java:**
```java
int interpFindLast(int[] arr, int t) {
    int lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        if (arr[lo] == arr[hi]) return arr[lo] == t ? hi : ans;
        long num = (long)(t - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (arr[pos] == t) { ans = pos; lo = pos + 1; }
        else if (arr[pos] < t) lo = pos + 1;
        else                   hi = pos - 1;
    }
    return ans;
}
```

**Python:**
```python
def interp_find_last(arr, t):
    lo, hi, ans = 0, len(arr) - 1, -1
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        if arr[lo] == arr[hi]:
            return hi if arr[lo] == t else ans
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        if arr[pos] == t:
            ans = pos
            lo = pos + 1
        elif arr[pos] < t:
            lo = pos + 1
        else:
            hi = pos - 1
    return ans
```

---

## Task 6 — Floating-Point Timestamp Lookup

**Problem.** Given a sorted array of `float64` timestamps and a query `t`, find the index of `t` within ±1e-9 tolerance.

**Go:**
```go
func timestampSearch(ts []float64, t float64) int {
    const eps = 1e-9
    lo, hi := 0, len(ts)-1
    for lo <= hi && ts[lo]-eps <= t && t <= ts[hi]+eps {
        if math.Abs(ts[hi]-ts[lo]) < eps {
            if math.Abs(ts[lo]-t) < eps { return lo }
            return -1
        }
        ratio := (t - ts[lo]) / (ts[hi] - ts[lo])
        pos := lo + int(ratio*float64(hi-lo))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        if math.Abs(ts[pos]-t) < eps { return pos }
        if ts[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    return -1
}
```

**Java:**
```java
int timestampSearch(double[] ts, double t) {
    final double eps = 1e-9;
    int lo = 0, hi = ts.length - 1;
    while (lo <= hi && ts[lo] - eps <= t && t <= ts[hi] + eps) {
        if (Math.abs(ts[hi] - ts[lo]) < eps)
            return Math.abs(ts[lo] - t) < eps ? lo : -1;
        double ratio = (t - ts[lo]) / (ts[hi] - ts[lo]);
        int pos = lo + (int)(ratio * (hi - lo));
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (Math.abs(ts[pos] - t) < eps) return pos;
        if (ts[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    return -1;
}
```

**Python:**
```python
def timestamp_search(ts, t, eps=1e-9):
    lo, hi = 0, len(ts) - 1
    while lo <= hi and ts[lo] - eps <= t <= ts[hi] + eps:
        if abs(ts[hi] - ts[lo]) < eps:
            return lo if abs(ts[lo] - t) < eps else -1
        ratio = (t - ts[lo]) / (ts[hi] - ts[lo])
        pos = lo + int(ratio * (hi - lo))
        pos = max(lo, min(hi, pos))
        if abs(ts[pos] - t) < eps:
            return pos
        if ts[pos] < t: lo = pos + 1
        else: hi = pos - 1
    return -1
```

---

## Task 7 — Count Probes Diagnostic

**Problem.** Run interpolation search and return both the result and the number of probes used. Useful to validate distribution assumptions.

**Go:**
```go
func interpProbes(arr []int, t int) (int, int) {
    lo, hi, probes := 0, len(arr)-1, 0
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        probes++
        if arr[lo] == arr[hi] {
            if arr[lo] == t { return lo, probes }
            return -1, probes
        }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if arr[pos] == t { return pos, probes }
        if arr[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    return -1, probes
}
```

**Java:**
```java
int[] interpProbes(int[] arr, int t) {
    int lo = 0, hi = arr.length - 1, p = 0;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        p++;
        if (arr[lo] == arr[hi]) return new int[]{arr[lo] == t ? lo : -1, p};
        long num = (long)(t - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (arr[pos] == t) return new int[]{pos, p};
        if (arr[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    return new int[]{-1, p};
}
```

**Python:**
```python
def interp_probes(arr, t):
    lo, hi, probes = 0, len(arr) - 1, 0
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        probes += 1
        if arr[lo] == arr[hi]:
            return (lo if arr[lo] == t else -1), probes
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        if arr[pos] == t: return pos, probes
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    return -1, probes
```

---

## Task 8 — Distribution Detector

**Problem.** Given a sorted array, return `True` if vanilla interpolation search is likely to perform well — i.e., the distribution looks approximately uniform. Use successive-gap variance.

**Go:**
```go
func looksUniform(arr []int) bool {
    n := len(arr)
    if n < 10 { return false }
    var sum float64
    for i := 0; i < n-1; i++ {
        sum += float64(arr[i+1] - arr[i])
    }
    mean := sum / float64(n-1)
    if mean == 0 { return true }
    var varSum float64
    for i := 0; i < n-1; i++ {
        d := float64(arr[i+1]-arr[i]) - mean
        varSum += d * d
    }
    stddev := math.Sqrt(varSum / float64(n-1))
    return stddev/mean < 2.0
}
```

**Java:**
```java
boolean looksUniform(int[] arr) {
    int n = arr.length;
    if (n < 10) return false;
    double sum = 0;
    for (int i = 0; i < n - 1; i++) sum += arr[i + 1] - arr[i];
    double mean = sum / (n - 1);
    if (mean == 0) return true;
    double varSum = 0;
    for (int i = 0; i < n - 1; i++) {
        double d = (arr[i + 1] - arr[i]) - mean;
        varSum += d * d;
    }
    double stddev = Math.sqrt(varSum / (n - 1));
    return stddev / mean < 2.0;
}
```

**Python:**
```python
def looks_uniform(arr, threshold=2.0):
    n = len(arr)
    if n < 10: return False
    gaps = [arr[i + 1] - arr[i] for i in range(n - 1)]
    mean = sum(gaps) / (n - 1)
    if mean == 0: return True
    var = sum((g - mean) ** 2 for g in gaps) / (n - 1)
    return (var ** 0.5) / mean < threshold
```

---

## Task 9 — Adaptive Dispatch

**Problem.** Build an `adaptive_search(arr, t)` that uses `looksUniform` to decide between binary and hybrid interpolation. Build-time cost amortized over many queries.

**Go:**
```go
type Searcher struct {
    arr []int
    uniform bool
}

func NewSearcher(arr []int) *Searcher {
    return &Searcher{arr: arr, uniform: looksUniform(arr)}
}

func (s *Searcher) Find(t int) int {
    if s.uniform {
        return hybridSearch(s.arr, t)
    }
    return binarySearch(s.arr, t)
}

func binarySearch(arr []int, t int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == t { return mid }
        if arr[mid] < t { lo = mid + 1 } else { hi = mid - 1 }
    }
    return -1
}
```

**Java:**
```java
public class AdaptiveSearcher {
    private final int[] arr;
    private final boolean uniform;
    public AdaptiveSearcher(int[] arr) {
        this.arr = arr;
        this.uniform = looksUniform(arr);
    }
    public int find(int t) {
        return uniform ? hybridSearch(arr, t) : binarySearch(arr, t);
    }
    private int binarySearch(int[] a, int t) {
        int lo = 0, hi = a.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (a[mid] == t) return mid;
            if (a[mid] < t) lo = mid + 1; else hi = mid - 1;
        }
        return -1;
    }
}
```

**Python:**
```python
class AdaptiveSearcher:
    def __init__(self, arr):
        self.arr = arr
        self.uniform = looks_uniform(arr)
    def find(self, t):
        if self.uniform:
            return hybrid_search(self.arr, t)
        return self._binary(t)
    def _binary(self, t):
        a = self.arr
        lo, hi = 0, len(a) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if a[mid] == t: return mid
            if a[mid] < t: lo = mid + 1
            else: hi = mid - 1
        return -1
```

---

## Task 10 — Interpolation + Sequential Scan

**Problem.** After computing `pos`, scan ±W neighbors linearly before recursing. Often faster than recursing on small windows. Use `W = 16`.

**Python:**
```python
def interp_plus_scan(arr, t, W=16):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == t else -1
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        a = max(lo, pos - W)
        b = min(hi, pos + W)
        for i in range(a, b + 1):
            if arr[i] == t:
                return i
            if arr[i] > t:
                hi = i - 1
                break
        else:
            lo = b + 1
            continue
        if a > lo:
            lo = a
        else:
            return -1 if hi < lo else -1
    return -1
```

**Go:**
```go
func interpPlusScan(arr []int, t int, W int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == t { return lo }
            return -1
        }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        a := pos - W
        if a < lo { a = lo }
        b := pos + W
        if b > hi { b = hi }
        broke := false
        for i := a; i <= b; i++ {
            if arr[i] == t { return i }
            if arr[i] > t { hi = i - 1; broke = true; break }
        }
        if !broke {
            lo = b + 1
        } else if a > lo {
            lo = a
        }
    }
    return -1
}
```

**Java:**
```java
int interpPlusScan(int[] arr, int t, int W) {
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        if (arr[lo] == arr[hi]) return arr[lo] == t ? lo : -1;
        long num = (long)(t - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        int a = Math.max(lo, pos - W);
        int b = Math.min(hi, pos + W);
        boolean broke = false;
        for (int i = a; i <= b; i++) {
            if (arr[i] == t) return i;
            if (arr[i] > t) { hi = i - 1; broke = true; break; }
        }
        if (!broke) lo = b + 1;
        else if (a > lo) lo = a;
    }
    return -1;
}
```

---

## Task 11 — Compare Interpolation vs Binary on Different Distributions

**Problem.** Write a benchmark that runs both algorithms on uniform, log-normal, and power-of-2 inputs and reports average probes.

**Python:**
```python
import random, math

def bench_probes(arr, num_queries=1000):
    bin_p = interp_p = 0
    for _ in range(num_queries):
        t = arr[random.randint(0, len(arr) - 1)]
        bin_p += _bin_probes(arr, t)
        interp_p += _interp_probes(arr, t)
    return bin_p / num_queries, interp_p / num_queries

def _bin_probes(arr, t):
    lo, hi, p = 0, len(arr) - 1, 0
    while lo <= hi:
        p += 1
        mid = (lo + hi) // 2
        if arr[mid] == t: return p
        if arr[mid] < t: lo = mid + 1
        else: hi = mid - 1
    return p

def _interp_probes(arr, t):
    lo, hi, p = 0, len(arr) - 1, 0
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        p += 1
        if arr[lo] == arr[hi]: return p
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        if arr[pos] == t: return p
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    return p

# Sample runs:
# Uniform:     bin~14, interp~3
# Log-normal:  bin~14, interp~7
# Powers of 2: bin~5,  interp~10
def run_demo():
    print("Uniform:    ", bench_probes(list(range(10_000))))
    print("Log-normal: ", bench_probes(sorted(int(math.exp(random.gauss(0, 1)) * 1000) for _ in range(10_000))))
    print("Powers of 2:", bench_probes([1 << i for i in range(20)]))
```

**Go:**
```go
func benchProbes(arr []int, numQueries int) (binAvg, interpAvg float64) {
    rng := rand.New(rand.NewSource(42))
    var binTotal, intTotal int
    for i := 0; i < numQueries; i++ {
        t := arr[rng.Intn(len(arr))]
        binTotal += binProbes(arr, t)
        intTotal += interpProbesCount(arr, t)
    }
    return float64(binTotal) / float64(numQueries), float64(intTotal) / float64(numQueries)
}
func binProbes(arr []int, t int) int {
    lo, hi, p := 0, len(arr)-1, 0
    for lo <= hi {
        p++
        mid := lo + (hi-lo)/2
        if arr[mid] == t { return p }
        if arr[mid] < t { lo = mid + 1 } else { hi = mid - 1 }
    }
    return p
}
func interpProbesCount(arr []int, t int) int {
    lo, hi, p := 0, len(arr)-1, 0
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        p++
        if arr[lo] == arr[hi] { return p }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if arr[pos] == t { return p }
        if arr[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    return p
}
```

**Java:**
```java
double[] benchProbes(int[] arr, int numQueries) {
    java.util.Random rng = new java.util.Random(42);
    int binTotal = 0, intTotal = 0;
    for (int i = 0; i < numQueries; i++) {
        int t = arr[rng.nextInt(arr.length)];
        binTotal += binProbes(arr, t);
        intTotal += interpProbesCount(arr, t);
    }
    return new double[]{(double)binTotal / numQueries, (double)intTotal / numQueries};
}
int binProbes(int[] a, int t) {
    int lo = 0, hi = a.length - 1, p = 0;
    while (lo <= hi) {
        p++;
        int mid = lo + (hi - lo) / 2;
        if (a[mid] == t) return p;
        if (a[mid] < t) lo = mid + 1; else hi = mid - 1;
    }
    return p;
}
int interpProbesCount(int[] a, int t) {
    int lo = 0, hi = a.length - 1, p = 0;
    while (lo <= hi && t >= a[lo] && t <= a[hi]) {
        p++;
        if (a[lo] == a[hi]) return p;
        long num = (long)(t - a[lo]) * (hi - lo);
        long den = a[hi] - a[lo];
        int pos = lo + (int)(num / den);
        if (a[pos] == t) return p;
        if (a[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    return p;
}
```

---

## Task 12 — Closest Value Lookup

**Problem.** Given a sorted array of numeric values and a query `t`, return the **index of the value closest to `t`** (not necessarily equal).

**Strategy:** run interpolation search to find the insertion point, then compare neighbors.

**Python:**
```python
def closest_index(arr, t):
    if not arr:
        return -1
    if t <= arr[0]: return 0
    if t >= arr[-1]: return len(arr) - 1
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        if arr[pos] == t:
            return pos
        if arr[pos] < t:
            lo = pos + 1
        else:
            hi = pos - 1
    # lo is the insertion point; compare neighbors.
    candidates = [i for i in (lo - 1, lo) if 0 <= i < len(arr)]
    return min(candidates, key=lambda i: abs(arr[i] - t))
```

**Go:**
```go
func closestIndex(arr []int, t int) int {
    if len(arr) == 0 { return -1 }
    if t <= arr[0] { return 0 }
    if t >= arr[len(arr)-1] { return len(arr) - 1 }
    lo, hi := 0, len(arr)-1
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        if arr[lo] == arr[hi] { return lo }
        pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        if arr[pos] == t { return pos }
        if arr[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    a, b := lo-1, lo
    if a < 0 { return b }
    if b >= len(arr) { return a }
    da := t - arr[a]; if da < 0 { da = -da }
    db := arr[b] - t; if db < 0 { db = -db }
    if da <= db { return a }
    return b
}
```

**Java:**
```java
int closestIndex(int[] arr, int t) {
    if (arr.length == 0) return -1;
    if (t <= arr[0]) return 0;
    if (t >= arr[arr.length - 1]) return arr.length - 1;
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        if (arr[lo] == arr[hi]) return lo;
        long num = (long)(t - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int pos = lo + (int)(num / den);
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (arr[pos] == t) return pos;
        if (arr[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    int a = lo - 1, b = lo;
    if (a < 0) return b;
    if (b >= arr.length) return a;
    return Math.abs(t - arr[a]) <= Math.abs(arr[b] - t) ? a : b;
}
```

---

## Task 13 — Interpolation Recursive (Demonstration)

**Problem.** Implement the recursive version. Useful for teaching but discouraged in production due to potential O(n) stack depth on adversarial inputs.

**Go:**
```go
func interpRec(arr []int, t int) int {
    return rec(arr, t, 0, len(arr)-1)
}
func rec(arr []int, t, lo, hi int) int {
    if lo > hi || t < arr[lo] || t > arr[hi] {
        return -1
    }
    if arr[lo] == arr[hi] {
        if arr[lo] == t { return lo }
        return -1
    }
    pos := lo + int(int64(t-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
    if arr[pos] == t { return pos }
    if arr[pos] < t { return rec(arr, t, pos+1, hi) }
    return rec(arr, t, lo, pos-1)
}
```

**Java:**
```java
int interpRec(int[] arr, int t) { return rec(arr, t, 0, arr.length - 1); }
int rec(int[] a, int t, int lo, int hi) {
    if (lo > hi || t < a[lo] || t > a[hi]) return -1;
    if (a[lo] == a[hi]) return a[lo] == t ? lo : -1;
    long num = (long)(t - a[lo]) * (hi - lo);
    long den = a[hi] - a[lo];
    int pos = lo + (int)(num / den);
    if (a[pos] == t) return pos;
    if (a[pos] < t)  return rec(a, t, pos + 1, hi);
    return rec(a, t, lo, pos - 1);
}
```

**Python:**
```python
def interp_rec(arr, t):
    def rec(lo, hi):
        if lo > hi or t < arr[lo] or t > arr[hi]:
            return -1
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == t else -1
        pos = lo + (t - arr[lo]) * (hi - lo) // (arr[hi] - arr[lo])
        if arr[pos] == t: return pos
        if arr[pos] < t:  return rec(pos + 1, hi)
        return rec(lo, pos - 1)
    return rec(0, len(arr) - 1)
```

---

## Task 14 — Three-Point Parabolic Interpolation (Stretch)

**Problem.** Implement parabolic interpolation that fits a quadratic through `(lo, arr[lo]), ((lo+hi)/2, arr[(lo+hi)/2]), (hi, arr[hi])` and solves for target. Useful for smoothly curved distributions.

**Python:**
```python
def parabolic_interp(arr, t):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        if hi - lo < 3:
            for i in range(lo, hi + 1):
                if arr[i] == t: return i
            return -1
        mid = (lo + hi) // 2
        x0, x1, x2 = lo, mid, hi
        y0, y1, y2 = arr[x0], arr[x1], arr[x2]
        denom = (y1 - y0) * (x2 - x0) - (y2 - y0) * (x1 - x0)
        if denom == 0:
            if arr[hi] == arr[lo]:
                pos = lo
            else:
                pos = lo + (t - y0) * (hi - lo) // (arr[hi] - arr[lo])
        else:
            pos = x0 + (t - y0) * (x1 - x0) * (x2 - x0) // denom
        pos = max(lo, min(hi, pos))
        if arr[pos] == t: return pos
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    return -1
```

**Go:**
```go
func parabolicInterp(arr []int, t int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi && t >= arr[lo] && t <= arr[hi] {
        if hi-lo < 3 {
            for i := lo; i <= hi; i++ {
                if arr[i] == t { return i }
            }
            return -1
        }
        mid := (lo + hi) / 2
        x0, x1, x2 := lo, mid, hi
        y0, y1, y2 := arr[x0], arr[x1], arr[x2]
        denom := (y1-y0)*(x2-x0) - (y2-y0)*(x1-x0)
        var pos int
        if denom == 0 {
            if arr[hi] == arr[lo] {
                pos = lo
            } else {
                pos = lo + (t-arr[lo])*(hi-lo)/(arr[hi]-arr[lo])
            }
        } else {
            pos = x0 + (t-y0)*(x1-x0)*(x2-x0)/denom
        }
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        if arr[pos] == t { return pos }
        if arr[pos] < t { lo = pos + 1 } else { hi = pos - 1 }
    }
    return -1
}
```

**Java:**
```java
int parabolicInterp(int[] arr, int t) {
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi && t >= arr[lo] && t <= arr[hi]) {
        if (hi - lo < 3) {
            for (int i = lo; i <= hi; i++) if (arr[i] == t) return i;
            return -1;
        }
        int mid = (lo + hi) / 2;
        int x0 = lo, x1 = mid, x2 = hi;
        long y0 = arr[x0], y1 = arr[x1], y2 = arr[x2];
        long denom = (y1 - y0) * (x2 - x0) - (y2 - y0) * (x1 - x0);
        int pos;
        if (denom == 0) {
            if (arr[hi] == arr[lo]) pos = lo;
            else pos = lo + (int)((long)(t - arr[lo]) * (hi - lo) / (arr[hi] - arr[lo]));
        } else {
            pos = x0 + (int)((long)(t - y0) * (x1 - x0) * (x2 - x0) / denom);
        }
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (arr[pos] == t) return pos;
        if (arr[pos] < t) lo = pos + 1; else hi = pos - 1;
    }
    return -1;
}
```

---

## Task 15 — Streaming Interpolation Index

**Problem.** Build a class that holds a sorted array and supports `add(x)` (append; keep sorted by inserting) and `find(t)` (interpolation search). Discuss when interpolation pays off vs binary.

**Python:**
```python
from bisect import insort

class InterpIndex:
    def __init__(self):
        self.arr = []
    def add(self, x):
        insort(self.arr, x)        # O(n) due to shift
    def find(self, t):
        return hybrid_search(self.arr, t)
    def __len__(self):
        return len(self.arr)
```

**Go:**
```go
type InterpIndex struct {
    arr []int
}
func (ix *InterpIndex) Add(x int) {
    i := sort.SearchInts(ix.arr, x)
    ix.arr = append(ix.arr, 0)
    copy(ix.arr[i+1:], ix.arr[i:])
    ix.arr[i] = x
}
func (ix *InterpIndex) Find(t int) int {
    return hybridSearch(ix.arr, t)
}
func (ix *InterpIndex) Len() int {
    return len(ix.arr)
}
```

**Java:**
```java
public class InterpIndex {
    private int[] arr = new int[0];
    public void add(int x) {
        int pos = lowerBound(arr, x);
        int[] na = new int[arr.length + 1];
        System.arraycopy(arr, 0, na, 0, pos);
        na[pos] = x;
        System.arraycopy(arr, pos, na, pos + 1, arr.length - pos);
        arr = na;
    }
    public int find(int t) { return hybridSearch(arr, t); }
    public int size() { return arr.length; }
    private int lowerBound(int[] a, int x) {
        int lo = 0, hi = a.length;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (a[mid] < x) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
}
```

**Discussion.** Inserts are O(n) because of array-shifting. Reads are O(log log n) with the hybrid pattern. Interpolation pays off only if reads dominate writes by 100×+. For mixed workloads, a B-tree or skip list (O(log n) for both) is better. This pattern is correct for **build-once-query-often** scenarios: static lookup tables, geographic data, scientific reference tables.

---

## Self-Check

After completing these tasks, you should be able to:

- [ ] Write classic interpolation search from memory in any of Go / Java / Python.
- [ ] Handle the equal-endpoints, value-range, and overflow edge cases without prompting.
- [ ] Explain the formula, derive O(log log n), and explain the O(n) worst case.
- [ ] Implement the hybrid pattern and explain why production uses it.
- [ ] Choose between binary and interpolation given a distribution description.
- [ ] Detect a non-uniform distribution at runtime.
- [ ] Adapt the algorithm to floating-point timestamps with epsilon tolerance.
- [ ] Find first / last occurrence of duplicates using interpolation.
- [ ] Benchmark probe counts to validate distribution assumptions.

If any of these feel uncertain, revisit `junior.md` or `middle.md` and redo the task without looking at the solution.
