# Bucket Sort — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Bucket Sort and when would you use it? | Distribution sort: scatter into k buckets, sort each, gather; use for uniformly distributed floats in [0, 1) or hash-bucketing |
| 2 | What is the average and worst-case time complexity? | Average O(n + k), achieving O(n) when k ≈ n and input is uniform; worst O(n²) when all elements land in one bucket |
| 3 | How is Bucket Sort different from Counting Sort? | Counting Sort = special case where each bucket holds one value (a counter); Bucket Sort = each bucket holds a range of values requiring inner sort |
| 4 | How is Bucket Sort different from Radix Sort? | Radix Sort = chained Bucket Sort across digits; Bucket Sort does one bucketing pass; Radix does `d` passes (one per digit) |
| 5 | Is Bucket Sort stable? | Yes if the inner sort is stable (e.g., Insertion Sort). Unstable if you use Quick Sort or Heap Sort inside |
| 6 | What space does it use? | O(n + k) — `k` bucket headers plus total `n` elements across buckets |
| 7 | What is the boundary off-by-one in textbook implementations? | `floor(k * x)` returns `k` when `x = 1.0` — must clamp to `k - 1` |
| 8 | Can Bucket Sort sort negative numbers? | Yes, shift the input by `-min` first, or use a mapping function that accepts negatives |
| 9 | Why does Bucket Sort beat Ω(n log n)? | It is not a comparison sort — it uses arithmetic on keys to place them directly into buckets |
| 10 | What's a "fat bucket"? | A bucket that absorbed disproportionately many elements due to skewed input or bad mapping; the cause of O(n²) worst case |

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | How do you choose `k`? | Set `k ≈ n` for the expected linear-time bound; trade-off is memory (`k` bucket headers) vs. expected per-bucket size |
| 2 | What inner sort do you use and why? | Insertion Sort for tiny buckets (≤ 16) since it has lower constants than TimSort; library sort for larger buckets to avoid O(n²) under skew |
| 3 | What happens with skewed input? | Buckets become unbalanced; the largest bucket dominates runtime; degrade gracefully via adaptive inner sort or sample-based boundaries |
| 4 | How does sample-then-partition work? | Sample a fraction of input, sort it, pick quantile boundaries → buckets are balanced regardless of underlying distribution |
| 5 | How would you sort strings by Bucket Sort? | Use the first character (or hash) as the mapping function; recursive bucket sort on the suffix within each bucket — leads to MSD Radix Sort |
| 6 | Compare Bucket Sort to TimSort. | TimSort: comparison sort, O(n log n) worst, adaptive to runs; Bucket Sort: distribution sort, O(n) expected on uniform, no guarantee on arbitrary input |
| 7 | How does Bucket Sort relate to hash join? | Hash join scatters records of both tables into buckets by hash of the join key; then joins within each bucket — same scatter-sort-merge pattern |
| 8 | Why is Bucket Sort cache-friendly? | Scatter writes touch `k` cache lines; if `k` fits in L2/L3, writes are local; inner sorts operate on small contiguous bucket arrays |
| 9 | Bucket Sort vs Radix Sort for 32-bit integers? | Radix Sort wins: 4 passes of 256 buckets each beat one pass of n buckets in memory and cache efficiency |
| 10 | When does Bucket Sort fail and what do you do? | All elements collide in one bucket → fall back to comparison sort; detect via histogram of bucket sizes, abort if skew ratio > threshold |

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Design a distributed sort over 1 TB on 100 nodes. | TeraSort: sample → quantile boundaries → scatter (Map) → per-bucket sort (Reduce) → concatenate; address skew with salting or sample-based partition |
| 2 | How do you handle skew in distributed Bucket Sort? | Sample-based boundaries, salting hot keys (key → key+"_0", key+"_1"), two-stage partition, speculative execution for stragglers |
| 3 | Walk through Spark's `repartitionAndSortWithinPartitions`. | Single shuffle that scatters with a RangePartitioner and sorts within each partition; sample-based boundaries; per-partition TimSort |
| 4 | Bucket Sort on GPU — what's different? | Sample sort: parallel scatter via prefix sum, bitonic inner sort across warps, coalesced memory access; > 500 M keys/sec |
| 5 | When would you choose external Bucket Sort over external Merge Sort? | When distribution is known/sample-able and you have RAM for k bucket buffers; Bucket Sort needs fewer passes (1 vs log_k(N/M)) |
| 6 | How do you observe and alert on Bucket Sort in production? | Metric: `max_bucket_size / avg_bucket_size`; alert if > 5×; tracing tag `sort.skew_ratio` |
| 7 | What's the network cost of distributed Bucket Sort? | One shuffle, O(N / num_workers) bytes per worker; compress shuffle data to reduce bandwidth |
| 8 | How do you choose the number of partitions in Spark? | `numPartitions = max(num_executors * cores, target_partition_size_mb / 128)`; balance parallelism vs. partition overhead |
| 9 | LSM-tree compaction — relation to Bucket Sort? | SSTables are pre-sorted runs; compaction is a `k`-way merge but range-partition on keys before merge is a Bucket Sort variant |
| 10 | Bucket Sort vs Sort-Merge Join in databases? | Sort-Merge Join = sort both tables (often by Bucket/Hash partition) then merge; Hash Join = bucket-scatter both tables, join within buckets |

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove Bucket Sort runs in expected O(n) for uniform input. | Bucket sizes follow Binomial(n, 1/n); E[n_i²] = 2 - 1/n; total expected work = O(n) + n × E[n_0²] = O(n) |
| 2 | What's the cross-bucket invariant that makes gather a free concatenation? | For all p < q, every element in B_p ≤ every element in B_q; follows from monotonicity of mapping function f |
| 3 | Why is Bucket Sort not subject to the Ω(n log n) lower bound? | The lower bound applies to comparison sorts; Bucket Sort uses key arithmetic (mapping function), not comparisons |
| 4 | Construct an adversarial input for Bucket Sort. | Pick any bucket index `j`; choose `n` distinct keys with `f(x) = j`; all elements land in B_j; inner Insertion Sort gives O(n²) |
| 5 | What is the work-span profile? | Work O(n) expected; Span O(log² n) with parallel scatter and bitonic inner sort; Parallelism O(n / log² n) |
| 6 | What is the I/O complexity of external Bucket Sort? | O(N/B) with constant ~6: scatter (2 I/O), inner sort (2 I/O), gather (2 I/O); each block touched 6 times |
| 7 | Prove Bucket Sort is optimal for uniform-distributed input. | Information-theoretic lower bound = Ω(n) (must read each key); Bucket Sort matches in expectation; therefore optimal up to constants |
| 8 | Compare cache I/O of Bucket Sort vs Merge Sort. | Bucket Sort O(N/B); Merge Sort O((N/B) log(N/M)); Bucket Sort better when distribution is known |
| 9 | When is Bucket Sort information-theoretically optimal? | When input is drawn from a known continuous distribution F and `f(x) = floor(k * F(x))`, Bucket Sort runs in Θ(n) expected, matching the Ω(n) lower bound |
| 10 | Randomized mapping function — how does it harden the worst case? | An adversary cannot predict the mapping; the probability of constructing a fat-bucket input is exponentially small in the random seed |

---

## Coding Challenge (3 Languages)

### Challenge: Sort Floats in [0, 1) Using Bucket Sort

> Implement Bucket Sort assuming uniformly distributed input. Use `n` buckets and Insertion Sort as the inner sort. Return a new sorted array. Handle the boundary `x = 1.0` correctly. Must pass all test cases including empty array, single element, all equal, and reverse-sorted input.

#### Go

```go
package main

import "fmt"

func BucketSort(arr []float64) []float64 {
    n := len(arr)
    if n <= 1 {
        return arr
    }
    buckets := make([][]float64, n)
    for _, x := range arr {
        idx := int(float64(n) * x)
        if idx >= n {
            idx = n - 1
        }
        buckets[idx] = append(buckets[idx], x)
    }
    for i := range buckets {
        insertionSort(buckets[i])
    }
    out := make([]float64, 0, n)
    for _, b := range buckets {
        out = append(out, b...)
    }
    return out
}

func insertionSort(a []float64) {
    for i := 1; i < len(a); i++ {
        x := a[i]
        j := i - 1
        for j >= 0 && a[j] > x {
            a[j+1] = a[j]
            j--
        }
        a[j+1] = x
    }
}

func main() {
    in := []float64{0.42, 0.32, 0.23, 0.52, 0.25, 0.47, 0.51}
    fmt.Println(BucketSort(in)) // [0.23 0.25 0.32 0.42 0.47 0.51 0.52]
}
```

#### Java

```java
import java.util.*;

public class BucketSortChallenge {
    public static double[] bucketSort(double[] arr) {
        int n = arr.length;
        if (n <= 1) return arr;
        List<List<Double>> buckets = new ArrayList<>(n);
        for (int i = 0; i < n; i++) buckets.add(new ArrayList<>());
        for (double x : arr) {
            int idx = (int)(n * x);
            if (idx >= n) idx = n - 1;
            buckets.get(idx).add(x);
        }
        for (List<Double> b : buckets) insertionSort(b);
        double[] out = new double[n];
        int pos = 0;
        for (List<Double> b : buckets) for (double v : b) out[pos++] = v;
        return out;
    }

    private static void insertionSort(List<Double> a) {
        for (int i = 1; i < a.size(); i++) {
            double x = a.get(i);
            int j = i - 1;
            while (j >= 0 && a.get(j) > x) {
                a.set(j + 1, a.get(j));
                j--;
            }
            a.set(j + 1, x);
        }
    }

    public static void main(String[] args) {
        double[] in = {0.42, 0.32, 0.23, 0.52, 0.25, 0.47, 0.51};
        System.out.println(Arrays.toString(bucketSort(in)));
    }
}
```

#### Python

```python
def bucket_sort(arr):
    n = len(arr)
    if n <= 1:
        return arr
    buckets = [[] for _ in range(n)]
    for x in arr:
        idx = int(n * x)
        if idx >= n:
            idx = n - 1
        buckets[idx].append(x)
    for b in buckets:
        for i in range(1, len(b)):
            key = b[i]
            j = i - 1
            while j >= 0 and b[j] > key:
                b[j + 1] = b[j]
                j -= 1
            b[j + 1] = key
    out = []
    for b in buckets:
        out.extend(b)
    return out

if __name__ == "__main__":
    print(bucket_sort([0.42, 0.32, 0.23, 0.52, 0.25, 0.47, 0.51]))
```

### Test Cases

```text
Input                                            Expected
[]                                               []
[0.5]                                            [0.5]
[0.3, 0.3, 0.3]                                  [0.3, 0.3, 0.3]
[0.9, 0.8, 0.7, 0.6, 0.5]                        [0.5, 0.6, 0.7, 0.8, 0.9]
[0.42, 0.32, 0.23, 0.52, 0.25, 0.47, 0.51]       [0.23, 0.25, 0.32, 0.42, 0.47, 0.51, 0.52]
[0.0, 0.99999, 1.0 - 1e-9]                        sorted ascending; index clamps for x near 1.0
```

### Evaluation Rubric

| Criterion | Weight |
|-----------|--------|
| Correctness on all test cases | 40% |
| Boundary handling (`x = 1.0`, empty, single, all equal) | 20% |
| Stable inner sort (Insertion Sort) | 15% |
| O(n) average complexity properly justified | 15% |
| Code clarity and idiomatic per-language style | 10% |

### Follow-Up Questions the Interviewer May Ask

1. "Now sort integers in `[lo, hi]` with the same approach." — adapt the mapping function: `idx = (x - lo) * k / (hi - lo + 1)`.
2. "What if the input is skewed?" — pivot to sample-based boundaries (see middle.md Pattern 1).
3. "How would you parallelize this on 8 cores?" — assign each bucket to a worker; show goroutine / ExecutorService / ThreadPool code.
4. "Prove the expected O(n) bound." — show the Binomial calculation and `E[n_0²] = 2 - 1/n`.
5. "What if buckets are linked lists instead of arrays?" — insert in sorted order during scatter, eliminating a separate inner sort pass.
6. "Compare to Counting Sort and Radix Sort." — explain the three-way taxonomy: Counting (one value per bucket), Bucket (range per bucket), Radix (iterated bucketing).
7. "What metric would you alert on in production?" — `max_bucket_size / avg_bucket_size` ratio; alert if > 5×.
8. "Describe TeraSort." — sample → boundaries → scatter (Map) → per-bucket sort (Reduce) → concatenate.

---

## Bonus Challenge: Find the Maximum Gap in Sorted Order

> **Problem:** Given an unsorted array of integers, find the largest difference between consecutive elements **after** sorting, without actually sorting in O(n log n). Achieve O(n) using Bucket Sort.
>
> **Key insight:** if you have `n` elements in range `[min, max]` and you create `n - 1` buckets each of width `(max - min) / (n - 1)`, the **Pigeonhole Principle** says at least one bucket is empty. Therefore the maximum gap must span across two adjacent non-empty buckets — and you only need to track each bucket's min and max.

#### Go

```go
package main

import (
    "fmt"
    "math"
)

func MaximumGap(nums []int) int {
    n := len(nums)
    if n < 2 {
        return 0
    }
    mn, mx := nums[0], nums[0]
    for _, x := range nums {
        if x < mn { mn = x }
        if x > mx { mx = x }
    }
    if mn == mx {
        return 0
    }
    bucketCount := n - 1
    bucketSize := float64(mx-mn) / float64(bucketCount)
    type bucket struct {
        used    bool
        min, max int
    }
    buckets := make([]bucket, bucketCount+1)
    for _, x := range nums {
        idx := int(float64(x-mn) / bucketSize)
        if idx > bucketCount {
            idx = bucketCount
        }
        if !buckets[idx].used {
            buckets[idx] = bucket{true, x, x}
        } else {
            if x < buckets[idx].min { buckets[idx].min = x }
            if x > buckets[idx].max { buckets[idx].max = x }
        }
    }
    maxGap := 0
    prevMax := math.MinInt
    for _, b := range buckets {
        if !b.used { continue }
        if prevMax != math.MinInt && b.min-prevMax > maxGap {
            maxGap = b.min - prevMax
        }
        prevMax = b.max
    }
    return maxGap
}

func main() {
    fmt.Println(MaximumGap([]int{3, 6, 9, 1})) // 3
}
```

#### Java

```java
public class MaximumGap {
    public static int maximumGap(int[] nums) {
        int n = nums.length;
        if (n < 2) return 0;
        int mn = nums[0], mx = nums[0];
        for (int x : nums) {
            if (x < mn) mn = x;
            if (x > mx) mx = x;
        }
        if (mn == mx) return 0;
        int bucketCount = n - 1;
        double bucketSize = (double)(mx - mn) / bucketCount;
        int[] bMin = new int[bucketCount + 1];
        int[] bMax = new int[bucketCount + 1];
        boolean[] used = new boolean[bucketCount + 1];
        for (int x : nums) {
            int idx = (int)((x - mn) / bucketSize);
            if (idx > bucketCount) idx = bucketCount;
            if (!used[idx]) {
                used[idx] = true;
                bMin[idx] = bMax[idx] = x;
            } else {
                bMin[idx] = Math.min(bMin[idx], x);
                bMax[idx] = Math.max(bMax[idx], x);
            }
        }
        int maxGap = 0, prevMax = Integer.MIN_VALUE;
        for (int i = 0; i <= bucketCount; i++) {
            if (!used[i]) continue;
            if (prevMax != Integer.MIN_VALUE) {
                maxGap = Math.max(maxGap, bMin[i] - prevMax);
            }
            prevMax = bMax[i];
        }
        return maxGap;
    }

    public static void main(String[] args) {
        System.out.println(maximumGap(new int[]{3, 6, 9, 1}));
    }
}
```

#### Python

```python
def maximum_gap(nums):
    n = len(nums)
    if n < 2:
        return 0
    mn, mx = min(nums), max(nums)
    if mn == mx:
        return 0
    bucket_count = n - 1
    bucket_size = (mx - mn) / bucket_count
    buckets = [None] * (bucket_count + 1)
    for x in nums:
        idx = int((x - mn) / bucket_size)
        if idx > bucket_count:
            idx = bucket_count
        if buckets[idx] is None:
            buckets[idx] = [x, x]
        else:
            buckets[idx][0] = min(buckets[idx][0], x)
            buckets[idx][1] = max(buckets[idx][1], x)
    max_gap = 0
    prev_max = None
    for b in buckets:
        if b is None:
            continue
        if prev_max is not None:
            max_gap = max(max_gap, b[0] - prev_max)
        prev_max = b[1]
    return max_gap

if __name__ == "__main__":
    print(maximum_gap([3, 6, 9, 1]))  # 3
```

**Why this is a classic Bucket Sort interview problem:**
- The Pigeonhole Principle is what allows you to skip the inner sort entirely.
- Each bucket only needs `(min, max)` — O(1) state instead of a full list.
- Single pass to populate buckets + single pass to find the gap → strict O(n) time, O(n) space.
- Beats the obvious O(n log n) sort-then-scan approach.

This problem (LeetCode 164 — "Maximum Gap") is the most common production-flavored Bucket Sort interview question because it demonstrates an understanding of when distribution sort beats comparison sort.
