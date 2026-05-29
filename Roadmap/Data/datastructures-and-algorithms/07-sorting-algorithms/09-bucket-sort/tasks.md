# Bucket Sort — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.

## Beginner Tasks

**Task 1:** Implement Bucket Sort from scratch for an array of floats in `[0, 1)`. Use `n` buckets and Insertion Sort as the inner sort. Handle the boundary `x = 1.0` correctly (clamp to bucket `n-1`).

#### Go

```go
package main

func BucketSort(arr []float64) []float64 {
    // TODO: implement
    return arr
}

func main() {
    in := []float64{0.42, 0.32, 0.23, 0.52, 0.25, 0.47, 0.51}
    _ = in
}
```

#### Java

```java
public class Task1 {
    public static double[] bucketSort(double[] arr) {
        // TODO: implement
        return arr;
    }
    public static void main(String[] args) {}
}
```

#### Python

```python
def bucket_sort(arr):
    # TODO: implement
    return arr

if __name__ == "__main__":
    bucket_sort([0.42, 0.32, 0.23, 0.52, 0.25, 0.47, 0.51])
```

- **Constraints:** O(n + k) average time; pass test cases for empty, single, all-equal, descending, and boundary-1.0 inputs.
- **Expected Output:** `[0.23, 0.25, 0.32, 0.42, 0.47, 0.51, 0.52]`.
- **Evaluation:** correctness, boundary clamp, average complexity justified in a docstring.

---

**Task 2:** Implement Bucket Sort for integers in a known range `[lo, hi]`. The mapping function is `idx = (x - lo) * k / (hi - lo + 1)`. Use `k = n` buckets.

#### Go

```go
func BucketSortInts(arr []int, lo, hi int) []int { return nil }
```

#### Java

```java
public static int[] bucketSortInts(int[] arr, int lo, int hi) { return arr; }
```

#### Python

```python
def bucket_sort_ints(arr, lo, hi): return arr
```

- **Constraints:** integer mapping, no floating-point unless necessary; handle negative values.
- **Expected:** sorts `[42, 32, 23, 52, 25, 47, 51, 10, 99, 1]` within `[0, 100]` correctly.

---

**Task 3:** Write a function that returns the histogram (bucket counts) of input floats in `[0, 1)` for `k = 10` buckets. This is the scatter phase only — no inner sort, no gather.

#### Go

```go
func Histogram(arr []float64, k int) []int {
    // TODO
    return nil
}
```

#### Java

```java
public static int[] histogram(double[] arr, int k) { return new int[k]; }
```

#### Python

```python
def histogram(arr, k):
    # TODO
    return [0] * k
```

```text
Input:  [0.05, 0.15, 0.25, 0.12, 0.18, 0.0, 0.95]
Output: [2, 2, 2, 0, 0, 0, 0, 0, 0, 1]    (count per bucket)
```

- **Constraints:** O(n) time, O(k) space.
- **Use case:** building a histogram for distribution profiling; foundation for two-pass Bucket Sort.

---

**Task 4:** Detect skew. Given an input array and a bucket count `k`, return the ratio `max_bucket_size / avg_bucket_size`. Return 1.0 for a perfectly uniform input, larger for skewed input.

#### Go

```go
func SkewRatio(arr []float64, k int) float64 { return 1.0 }
```

#### Java

```java
public static double skewRatio(double[] arr, int k) { return 1.0; }
```

#### Python

```python
def skew_ratio(arr, k):
    return 1.0
```

- **Constraints:** O(n + k) time.
- **Test:** uniform input → ratio close to 1; all-equal input → ratio close to `k`.
- **Production use:** alert when `skew_ratio > 5` during a live sort.

---

**Task 5:** Implement Bucket Sort using **linked lists** as the bucket type. Insert each element in sorted order during scatter (combines scatter and inner sort). Avoid using a separate sort function.

#### Go

```go
type Node struct {
    Val  float64
    Next *Node
}

func BucketSortLinked(arr []float64) []float64 {
    // TODO: scatter into linked lists, inserting in sorted order
    return arr
}
```

#### Java

```java
public class Task5 {
    static class Node { double val; Node next; Node(double v){val=v;} }
    public static double[] bucketSortLinked(double[] arr) { return arr; }
}
```

#### Python

```python
class Node:
    __slots__ = ("val", "next")
    def __init__(self, val, nxt=None):
        self.val = val
        self.next = nxt

def bucket_sort_linked(arr):
    # TODO
    return arr
```

- **Constraints:** O(n²) worst case (single bucket), O(n) average for uniform input.
- **Hint:** for each element, walk the bucket's linked list to find the insertion point.

---

## Intermediate Tasks

**Task 6:** Implement Bucket Sort with **adaptive inner sort**: use Insertion Sort when bucket size ≤ 16, else the language library sort. Benchmark against the pure-Insertion-Sort variant for skewed input.

#### Go

```go
func AdaptiveBucketSort(arr []float64) []float64 { return arr }
```

#### Java

```java
public static double[] adaptiveBucketSort(double[] arr) { return arr; }
```

#### Python

```python
def adaptive_bucket_sort(arr): return arr
```

- **Constraints:** measure and report the speedup on skewed input where one bucket holds 50% of elements.

---

**Task 7:** Implement **sample-based Bucket Sort**: sample 1% of input (at least `8k` elements), pick boundaries at sample quantiles, then scatter using binary search on boundaries.

#### Go

```go
func SampledBucketSort(arr []int) []int { return nil }
```

#### Java

```java
public static int[] sampledBucketSort(int[] arr) { return arr; }
```

#### Python

```python
def sampled_bucket_sort(arr): return arr
```

- **Constraints:** O(n) average time even for skewed input; sample size at least `8k`.
- **Test:** compare against fixed-width Bucket Sort on a heavily skewed input (e.g., Beta(0.5, 5) distribution).

---

**Task 8:** Sort strings by Bucket Sort using the first character as the bucket index (26 buckets for lowercase a–z). Use the library sort within each bucket.

#### Go

```go
func BucketSortStrings(arr []string) []string { return arr }
```

#### Java

```java
public static String[] bucketSortStrings(String[] arr) { return arr; }
```

#### Python

```python
def bucket_sort_strings(arr): return arr
```

- **Constraints:** stable across calls; handle non-alphabetic characters by routing to an "other" bucket.
- **Test:** sort `["apple", "banana", "cherry", "avocado", "blueberry"]` → expected `["apple", "avocado", "banana", "blueberry", "cherry"]`.

---

**Task 9:** Parallel Bucket Sort. Sort each bucket on its own thread / goroutine. Compare runtime against single-threaded Bucket Sort for `n = 10⁶`.

#### Go

```go
import "sync"
func ParallelBucketSort(arr []float64) []float64 { return nil }
```

#### Java

```java
import java.util.concurrent.*;
public static double[] parallelBucketSort(double[] arr) throws Exception { return arr; }
```

#### Python

```python
from concurrent.futures import ThreadPoolExecutor
def parallel_bucket_sort(arr): return arr
```

- **Constraints:** measure speedup; expect 3–5× on 8 cores for uniform input.
- **Hint:** use a `wait_group` (Go), `ExecutorService` (Java), or `ThreadPoolExecutor` (Python) to coordinate workers.

---

**Task 10:** Implement Bucket Sort that detects skew online: if the largest bucket exceeds `5 × avg`, abort and fall back to library Merge Sort / TimSort. Report which path the algorithm took.

#### Go

```go
func DefensiveBucketSort(arr []float64) ([]float64, string) {
    // returns (sorted, path) where path ∈ {"bucket", "fallback"}
    return arr, "bucket"
}
```

#### Java

```java
public class DefensiveBucketSort {
    public record Result(double[] sorted, String path) {}
    public static Result sort(double[] arr) { return new Result(arr, "bucket"); }
}
```

#### Python

```python
def defensive_bucket_sort(arr):
    # returns (sorted, path) where path is "bucket" or "fallback"
    return arr, "bucket"
```

- **Constraints:** must detect skew before the inner sort starts.
- **Use case:** defensive sorting in production where input distribution is unknown.
- **Hint:** compute the histogram first, then decide.

---

## Advanced Tasks

**Task 11:** External Bucket Sort. Sort an input file of integers larger than RAM. Scatter to `k` bucket files on disk; sort each bucket file in memory; concatenate output.

#### Go

```go
func ExternalBucketSort(inputPath, outputPath string, k int, chunkSize int) error {
    return nil
}
```

#### Java

```java
public static void externalBucketSort(String input, String output, int k, int chunkSize) {}
```

#### Python

```python
def external_bucket_sort(input_path, output_path, k, chunk_size):
    pass
```

- **Constraints:** memory budget ≤ `chunkSize` ints at any time; total I/O ≤ 6 × input size.
- **Test:** sort a file of 10 M integers using a 1 MB memory budget.

---

**Task 12:** Distributed-style Sample Sort simulation. Simulate `numWorkers` workers: sample, compute boundaries, scatter into per-worker buckets, sort each in parallel, gather. Measure load imbalance.

#### Go

```go
type SortStats struct { MaxBucket, AvgBucket float64; SkewRatio float64 }
func SampleSortDistributed(arr []int, numWorkers int) ([]int, SortStats) {
    return arr, SortStats{}
}
```

#### Java

```java
public record SortStats(double maxBucket, double avgBucket, double skewRatio) {}
public static int[] sampleSortDistributed(int[] arr, int numWorkers, SortStats[] stats) {
    return arr;
}
```

#### Python

```python
def sample_sort_distributed(arr, num_workers):
    # returns (sorted, {"max_bucket": ..., "avg_bucket": ..., "skew_ratio": ...})
    return arr, {"max_bucket": 0, "avg_bucket": 0, "skew_ratio": 1.0}
```

- **Constraints:** report `max_bucket / avg_bucket` ratio as a skew metric.
- **Hint:** mimic TeraSort's structure on a single machine using threads.

---

**Task 13:** GPU-style two-pass Bucket Sort. First pass: count occurrences per bucket. Second pass: write each element directly to its target slot using prefix-sum offsets. No dynamic allocation per bucket.

#### Go

```go
func TwoPassBucketSort(arr []float64, k int) []float64 {
    // Pass 1: counts per bucket
    // Pass 2: prefix sum gives output offsets
    // Pass 3: scatter elements into preallocated output slice
    return arr
}
```

#### Java

```java
public static double[] twoPassBucketSort(double[] arr, int k) { return arr; }
```

#### Python

```python
def two_pass_bucket_sort(arr, k):
    # 1: counts
    # 2: prefix sum -> offsets
    # 3: scatter into out[]
    return arr
```

- **Constraints:** O(n + k) time, O(n + k) space, single output array.
- **Hint:** prefix sum gives the start offset of each bucket in the output; sort each contiguous range in place.

---

**Task 14:** Streaming Bucket Sort with periodic rebalance. Accept a stream of values; maintain `k` buckets; every `T` seconds, re-sample and adjust boundaries to keep buckets balanced. Emit sorted output every `T` seconds.

#### Go

```go
type StreamingBucketSort struct { /* ... */ }
func New(k int, windowSeconds int) *StreamingBucketSort { return &StreamingBucketSort{} }
func (s *StreamingBucketSort) Push(x float64) {}
func (s *StreamingBucketSort) Flush() []float64 { return nil }
```

#### Java

```java
public class StreamingBucketSort {
    public StreamingBucketSort(int k, int windowSeconds) {}
    public void push(double x) {}
    public double[] flush() { return new double[0]; }
}
```

#### Python

```python
class StreamingBucketSort:
    def __init__(self, k, window_seconds): pass
    def push(self, x): pass
    def flush(self): return []
```

- **Constraints:** O(n) per window; rebalance does not lose data.
- **Use case:** real-time analytics, time-window quantile estimation.

---

**Task 15:** Hybrid Bucket Sort + Radix Sort. For 32-bit unsigned integer input, use the top 8 bits as bucket index (`k = 256`), then sort each bucket with LSD Radix Sort on the remaining 24 bits.

#### Go

```go
func HybridBucketRadix(arr []uint32) []uint32 { return arr }
```

#### Java

```java
public static int[] hybridBucketRadix(int[] arr) { return arr; }
```

#### Python

```python
def hybrid_bucket_radix(arr):
    # 1: bucket by top 8 bits
    # 2: LSD radix sort each bucket on remaining 24 bits
    # 3: concatenate
    return arr
```

- **Constraints:** O(n) total time for any 32-bit integer input.
- **Test:** sort 10 M random 32-bit integers; compare runtime against a pure Radix Sort and a pure Bucket Sort.
- **Hint:** this is the basis of MSD-then-LSD radix sort and beats both pure variants on cache.

---

## Benchmark Task

> Compare performance across all 3 languages.
> Generate three input distributions:
> 1. **Uniform** — `rand.Float64()` for n elements.
> 2. **Skewed** — `rand.Float64() * rand.Float64()` (Beta-like distribution clustered near 0).
> 3. **Pre-sorted** — `i / n` for `i = 0..n-1`.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func main() {
    sizes := []int{10000, 100000, 1000000}
    for _, n := range sizes {
        uni := make([]float64, n)
        for i := range uni { uni[i] = rand.Float64() }
        skew := make([]float64, n)
        for i := range skew { skew[i] = rand.Float64() * rand.Float64() }
        srt := make([]float64, n)
        for i := range srt { srt[i] = float64(i) / float64(n) }

        for _, c := range []struct {
            name string
            data []float64
        }{{"uniform", uni}, {"skewed", skew}, {"sorted", srt}} {
            start := time.Now()
            for i := 0; i < 5; i++ {
                tmp := make([]float64, n)
                copy(tmp, c.data)
                BucketSort(tmp)
            }
            elapsed := time.Since(start) / 5
            fmt.Printf("n=%7d %-8s: %.3f ms\n", n, c.name,
                float64(elapsed.Microseconds())/1000.0)
        }
    }
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {10_000, 100_000, 1_000_000};
        Random rng = new Random(42);
        for (int n : sizes) {
            double[] uni = new double[n];
            for (int i = 0; i < n; i++) uni[i] = rng.nextDouble();
            double[] skew = new double[n];
            for (int i = 0; i < n; i++) skew[i] = rng.nextDouble() * rng.nextDouble();
            double[] sorted = new double[n];
            for (int i = 0; i < n; i++) sorted[i] = (double) i / n;

            String[] names = {"uniform", "skewed", "sorted"};
            double[][] data = {uni, skew, sorted};
            for (int k = 0; k < 3; k++) {
                long start = System.nanoTime();
                for (int i = 0; i < 5; i++) BucketSortChallenge.bucketSort(data[k].clone());
                long elapsed = (System.nanoTime() - start) / 5;
                System.out.printf("n=%7d %-8s: %.3f ms%n",
                    n, names[k], elapsed / 1_000_000.0);
            }
        }
    }
}
```

#### Python

```python
import random, timeit

random.seed(42)
for n in [10_000, 100_000, 1_000_000]:
    uni = [random.random() for _ in range(n)]
    skew = [random.random() * random.random() for _ in range(n)]
    srt = [i / n for i in range(n)]
    for name, data in [("uniform", uni), ("skewed", skew), ("sorted", srt)]:
        t = timeit.timeit(lambda: bucket_sort(list(data)), number=5) / 5
        print(f"n={n:>7} {name:<8}: {t * 1000:.3f} ms")
```

**Expected results:**
- Uniform: O(n) — best case, linear scaling.
- Skewed: O(n log n) or worse — fat buckets pay for inner sort.
- Pre-sorted: O(n log n) — already-sorted does not help vanilla Bucket Sort (each bucket still receives `n/k` elements; inner sort is fast on already-sorted small input).

Report: the **skew penalty ratio** (`skew_time / uniform_time`) — this is the production-relevant metric.

---

## Submission Checklist

- [ ] All 15 tasks implemented in Go, Java, Python.
- [ ] Each task has a docstring stating time and space complexity.
- [ ] Edge cases tested: empty, single, all-equal, descending, boundary value.
- [ ] Benchmark numbers reported as `(n, distribution, time)` tuples.
- [ ] Code idiomatic per language (Go: avoid panics in library functions; Java: handle exceptions; Python: type hints).
- [ ] No external dependencies beyond the standard library.
