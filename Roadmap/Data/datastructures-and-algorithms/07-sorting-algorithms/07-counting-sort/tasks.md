# Counting Sort — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python** (in that exact order).
> Counting Sort is a **non-comparison** sort: never call `<` on two input elements.

---

## Beginner Tasks

### Task 1: Stable Counting Sort From Scratch

Implement `counting_sort(arr, k)` returning a new sorted array. Use the canonical **tally → prefix-sum → right-to-left placement** scheme. Do NOT use any built-in sort or compare two input elements.

#### Go

```go
package main

import "fmt"

// CountingSort sorts arr ascending and stably.
// Precondition: every element is in [0, k).
// Time: O(n + k). Space: O(n + k).
func CountingSort(arr []int, k int) []int {
    // TODO:
    // 1. allocate count[k], output[n]
    // 2. for v in arr: count[v]++
    // 3. for i in 1..k-1: count[i] += count[i-1]
    // 4. for i = n-1 down to 0:
    //        v = arr[i]; count[v]--; output[count[v]] = v
    return nil
}

func main() {
    fmt.Println(CountingSort([]int{3, 0, 4, 1, 7, 2}, 8)) // expected: [0 1 2 3 4 7]
}
```

#### Java

```java
import java.util.Arrays;

public class Task1 {
    public static int[] countingSort(int[] arr, int k) {
        // TODO: implement as in the Go version
        return new int[0];
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(countingSort(new int[]{3, 0, 4, 1, 7, 2}, 8)));
        // expected: [0, 1, 2, 3, 4, 7]
    }
}
```

#### Python

```python
def counting_sort(arr, k):
    """Sort arr ascending and stably. Pre: every element in [0, k).
    Time: O(n + k). Space: O(n + k)."""
    # TODO: implement
    pass


if __name__ == "__main__":
    print(counting_sort([3, 0, 4, 1, 7, 2], 8))  # expected: [0, 1, 2, 3, 4, 7]
```

- **Constraints:** `1 <= n <= 10^5`, `0 <= v < k <= 10^4`. O(n + k) time, O(n + k) space.
- **Expected output:** the sorted array; original input unmodified.
- **Tests:** empty array, single element, all equal, already sorted, reverse sorted.
- **Evaluation:** correctness, stability test on `[(2,"a"), (2,"b")]`, complexity match.

---

### Task 2: Counting Sort With Auto-Detected Range

Write `counting_sort_auto(arr)` that does **not** require `k` from the caller. Scan once to find `min` and `max`, then use the offset variant `count[v - min]`.

#### Go

```go
package main

import "fmt"

// CountingSortAuto handles any integer range, including negatives.
// Returns an empty slice for nil/empty input.
func CountingSortAuto(arr []int) []int {
    // TODO: find min/max in one pass, then standard Counting Sort with offset
    return nil
}

func main() {
    fmt.Println(CountingSortAuto([]int{-3, 7, -3, 0, 7, 2, -5})) // expected: [-5 -3 -3 0 2 7 7]
}
```

#### Java

```java
import java.util.Arrays;

public class Task2 {
    public static int[] countingSortAuto(int[] arr) {
        // TODO: find min/max in one pass, then standard Counting Sort with offset
        return new int[0];
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(countingSortAuto(new int[]{-3, 7, -3, 0, 7, 2, -5})));
    }
}
```

#### Python

```python
def counting_sort_auto(arr):
    """Handles any integer range, including negatives. O(n + (max-min+1))."""
    # TODO: find min/max, then standard Counting Sort with offset
    pass


if __name__ == "__main__":
    print(counting_sort_auto([-3, 7, -3, 0, 7, 2, -5]))  # expected: [-5, -3, -3, 0, 2, 7, 7]
```

- **Constraints:** must handle negative values, empty array, single element.
- **Expected output:** sorted array.
- **Evaluation:** correctness on `[]`, `[42]`, all-negative, mixed-sign, all-equal.

---

### Task 3: Sort Characters in a String

Sort the characters of a string ascending using Counting Sort over the ASCII alphabet (`k = 128` for plain ASCII, `k = 256` for extended).

#### Go

```go
package main

import "fmt"

// SortChars returns a new string with characters sorted ascending.
// O(n + 128) — linear in the string length.
func SortChars(s string) string {
    // TODO: count[128]; tally each byte; reconstruct by emitting count[v] copies
    return ""
}

func main() {
    fmt.Println(SortChars("hello world")) // expected: " dehllloorw"
}
```

#### Java

```java
public class Task3 {
    public static String sortChars(String s) {
        // TODO: int[] count = new int[128]; tally; rebuild via StringBuilder
        return "";
    }

    public static void main(String[] args) {
        System.out.println(sortChars("hello world")); // expected: " dehllloorw"
    }
}
```

#### Python

```python
def sort_chars(s):
    """Counting Sort over ASCII. O(n + 128)."""
    # TODO: count = [0] * 128; tally; rebuild by emitting count[v] copies
    pass


if __name__ == "__main__":
    print(sort_chars("hello world"))  # expected: " dehllloorw"
```

- **Constraints:** `1 <= len(s) <= 10^6`; assume only ASCII (`ord(c) < 128`).
- **Expected output:** sorted string.
- **Evaluation:** correctness on empty string, all-same characters, mixed case, presence of spaces and punctuation.

---

### Task 4: Histogram (Phase 1 Only)

Implement `histogram(arr)` that returns just the count array — the first phase of Counting Sort. This is the building block for analytics, anomaly detection, and rate limits.

#### Go

```go
package main

import "fmt"

// Histogram returns a map[value]count over arr.
// For unknown range, returning a map (not []int) sidesteps the k question.
func Histogram(arr []int) map[int]int {
    // TODO: walk arr, increment m[v]
    return nil
}

func main() {
    fmt.Println(Histogram([]int{1, 2, 2, 3, 3, 3})) // expected: map[1:1 2:2 3:3]
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Task4 {
    public static Map<Integer, Integer> histogram(int[] arr) {
        // TODO: build HashMap<Integer, Integer> counting occurrences
        return new HashMap<>();
    }

    public static void main(String[] args) {
        System.out.println(histogram(new int[]{1, 2, 2, 3, 3, 3})); // {1=1, 2=2, 3=3}
    }
}
```

#### Python

```python
def histogram(arr):
    """Return {value: count} for arr."""
    # TODO: build a dict (or use collections.Counter, but match by hand first)
    pass


if __name__ == "__main__":
    print(histogram([1, 2, 2, 3, 3, 3]))  # expected: {1: 1, 2: 2, 3: 3}
```

- **Constraints:** O(n) time, O(unique) space.
- **Expected output:** mapping value→count.
- **Evaluation:** empty input returns empty mapping; large array (10^6 elements) completes in linear time.

---

### Task 5: Count Occurrences of a Single Value

Given `arr` and `target`, return how many times `target` appears. Use the Phase-1 idea (no full sort needed). Compare against the obvious `O(n)` count loop and show they have the same complexity.

#### Go

```go
package main

import "fmt"

// CountOccurrences uses the counting-sort tally idea, but only for a single key.
func CountOccurrences(arr []int, target int) int {
    // TODO: single pass; if arr[i] == target increment result
    return 0
}

func main() {
    fmt.Println(CountOccurrences([]int{1, 2, 3, 2, 4, 2, 5}, 2)) // expected: 3
}
```

#### Java

```java
public class Task5 {
    public static int countOccurrences(int[] arr, int target) {
        // TODO: linear scan
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(countOccurrences(new int[]{1, 2, 3, 2, 4, 2, 5}, 2)); // 3
    }
}
```

#### Python

```python
def count_occurrences(arr, target):
    """Return number of times `target` appears in `arr`."""
    # TODO: linear scan or use arr.count(target)
    pass


if __name__ == "__main__":
    print(count_occurrences([1, 2, 3, 2, 4, 2, 5], 2))  # expected: 3
```

- **Constraints:** O(n) time, O(1) extra space.
- **Expected output:** integer count.
- **Evaluation:** correctness on target absent, target at boundaries, all-target array.

---

## Intermediate Tasks

### Task 6: Counting Sort for Records (Stable, Out-of-Place)

Sort an array of `Record { key int, name string }` stably by `key`. Verify stability: for input `[(2,"a"), (1,"b"), (2,"c"), (1,"d")]` the output must be `[(1,"b"), (1,"d"), (2,"a"), (2,"c")]`.

#### Go

```go
package main

import "fmt"

type Record struct {
    Key  int
    Name string
}

// CountingSortRecords sorts records stably by Key in [0, k).
func CountingSortRecords(arr []Record, k int) []Record {
    // TODO: count[k]; output[n]; prefix sum; right-to-left placement
    //       output[count[v]] = arr[i] (copy the whole record)
    return nil
}

func main() {
    rs := []Record{{2, "a"}, {1, "b"}, {2, "c"}, {1, "d"}}
    for _, r := range CountingSortRecords(rs, 3) {
        fmt.Printf("(%d,%s) ", r.Key, r.Name)
    } // expected: (1,b) (1,d) (2,a) (2,c)
    fmt.Println()
}
```

#### Java

```java
import java.util.Arrays;

class Record {
    int key;
    String name;
    Record(int k, String n) { key = k; name = n; }
    public String toString() { return "(" + key + "," + name + ")"; }
}

public class Task6 {
    public static Record[] countingSortRecords(Record[] arr, int k) {
        // TODO: int[] count = new int[k]; Record[] output = new Record[arr.length]; ...
        return new Record[0];
    }

    public static void main(String[] args) {
        Record[] rs = {new Record(2, "a"), new Record(1, "b"),
                       new Record(2, "c"), new Record(1, "d")};
        System.out.println(Arrays.toString(countingSortRecords(rs, 3)));
        // expected: [(1,b), (1,d), (2,a), (2,c)]
    }
}
```

#### Python

```python
from dataclasses import dataclass
from typing import List

@dataclass
class Record:
    key: int
    name: str

def counting_sort_records(arr: List[Record], k: int) -> List[Record]:
    """Stable sort by key in [0, k). Preserves payload order for equal keys."""
    # TODO: count[k]; output[n]; prefix sum; right-to-left placement
    pass


if __name__ == "__main__":
    rs = [Record(2, "a"), Record(1, "b"), Record(2, "c"), Record(1, "d")]
    for r in counting_sort_records(rs, 3):
        print(r)
    # expected: Record(key=1, name='b'), Record(key=1, name='d'),
    #           Record(key=2, name='a'), Record(key=2, name='c')
```

- **Constraints:** O(n + k) time, O(n + k) space, **stable** (this is the contract).
- **Expected output:** records sorted by key with original relative order preserved among equal keys.
- **Evaluation:** stability assertion, no payload lost, complexity correct.

---

### Task 7: Counting Sort For Negative Integers (Offset Variant)

Implement `counting_sort_signed(arr)` that handles any signed integer range using the `value - min` offset trick. Same complexity as the unsigned form, but the effective `k = max - min + 1`.

#### Go

```go
package main

import "fmt"

// CountingSortSigned sorts arr ascending; works for any signed-int range.
// Time: O(n + (max-min+1)). Space: O(n + (max-min+1)).
func CountingSortSigned(arr []int) []int {
    // TODO: find min/max; allocate count of size (max-min+1);
    //       tally with count[v-min]++; prefix-sum; right-to-left placement
    return nil
}

func main() {
    fmt.Println(CountingSortSigned([]int{-5, 3, -2, 0, -2, 3, 1})) // expected: [-5 -2 -2 0 1 3 3]
}
```

#### Java

```java
import java.util.Arrays;

public class Task7 {
    public static int[] countingSortSigned(int[] arr) {
        // TODO: same as above
        return new int[0];
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            countingSortSigned(new int[]{-5, 3, -2, 0, -2, 3, 1})));
    }
}
```

#### Python

```python
def counting_sort_signed(arr):
    """Sort any signed-int array using the offset variant. O(n + (max-min+1))."""
    # TODO
    pass


if __name__ == "__main__":
    print(counting_sort_signed([-5, 3, -2, 0, -2, 3, 1]))
    # expected: [-5, -2, -2, 0, 1, 3, 3]
```

- **Constraints:** `1 <= n <= 10^5`, `-10^4 <= v <= 10^4`.
- **Expected output:** sorted array.
- **Evaluation:** correctness on all-negative, all-positive, mixed; verify O(n + (max-min+1)) memory.

---

### Task 8: Counting Sort As Inner Pass Of LSD Radix Sort

Implement LSD Radix Sort for non-negative integers using **your stable Counting Sort** as the per-digit pass. Base 10 first, then generalise to base 256. The point: prove that without stability, Radix Sort breaks.

#### Go

```go
package main

import "fmt"

// CountingSortByDigit sorts arr stably by the digit at position exp
// in the given base. This is the inner pass of LSD Radix Sort.
func CountingSortByDigit(arr []int, exp, base int) []int {
    // TODO: digit = (v / exp) % base; standard Counting Sort over [0, base)
    return nil
}

func RadixSortLSD(arr []int, base int) []int {
    // TODO:
    // 1. mx := max(arr)
    // 2. for exp := 1; mx/exp > 0; exp *= base { arr = CountingSortByDigit(arr, exp, base) }
    return arr
}

func main() {
    fmt.Println(RadixSortLSD([]int{170, 45, 75, 90, 802, 24, 2, 66}, 10))
    // expected: [2 24 45 66 75 90 170 802]
}
```

#### Java

```java
import java.util.Arrays;

public class Task8 {
    public static int[] countingSortByDigit(int[] arr, int exp, int base) {
        // TODO
        return new int[0];
    }

    public static int[] radixSortLSD(int[] arr, int base) {
        // TODO: loop exp = 1, base, base^2, ... while mx/exp > 0
        return arr;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            radixSortLSD(new int[]{170, 45, 75, 90, 802, 24, 2, 66}, 10)));
    }
}
```

#### Python

```python
def counting_sort_by_digit(arr, exp, base):
    """Stable sort by digit at position exp in `base`."""
    # TODO
    pass

def radix_sort_lsd(arr, base=10):
    """LSD Radix Sort built on top of counting_sort_by_digit."""
    # TODO
    pass


if __name__ == "__main__":
    print(radix_sort_lsd([170, 45, 75, 90, 802, 24, 2, 66]))
    # expected: [2, 24, 45, 66, 75, 90, 170, 802]
```

- **Constraints:** non-negative integers; verify against the language's built-in sort.
- **Expected output:** sorted array equal to `sorted(arr)`.
- **Evaluation:** swap your stable Counting Sort for the naïve `emit count[v]` form and confirm Radix Sort breaks — file this observation in a comment.

---

### Task 9: In-Place Unstable Counting Sort

Write `counting_sort_inplace(arr, k)` that sorts `arr` in-place using only an `O(k)` count array (no separate output). This is faster and saves memory but **loses stability** — document why in a comment.

#### Go

```go
package main

import "fmt"

// CountingSortInplace mutates arr to be sorted ascending in O(n + k) time and
// O(k) extra space. NOT stable — only safe when elements carry no payload.
func CountingSortInplace(arr []int, k int) {
    // TODO:
    // 1. count[k]; for v in arr: count[v]++
    // 2. idx := 0; for v in 0..k-1: for j in 0..count[v]-1: arr[idx] = v; idx++
}

func main() {
    a := []int{3, 0, 4, 1, 7, 2, 4, 0}
    CountingSortInplace(a, 8)
    fmt.Println(a) // expected: [0 0 1 2 3 4 4 7]
}
```

#### Java

```java
import java.util.Arrays;

public class Task9 {
    public static void countingSortInplace(int[] arr, int k) {
        // TODO: same algorithm
    }

    public static void main(String[] args) {
        int[] a = {3, 0, 4, 1, 7, 2, 4, 0};
        countingSortInplace(a, 8);
        System.out.println(Arrays.toString(a)); // [0, 0, 1, 2, 3, 4, 4, 7]
    }
}
```

#### Python

```python
def counting_sort_inplace(arr, k):
    """Sort arr in place. O(n + k) time, O(k) space, NOT stable.
    Only valid when arr holds raw ints (no payloads)."""
    # TODO
    pass


if __name__ == "__main__":
    a = [3, 0, 4, 1, 7, 2, 4, 0]
    counting_sort_inplace(a, 8)
    print(a)  # expected: [0, 0, 1, 2, 3, 4, 4, 7]
```

- **Constraints:** must mutate `arr`, must not allocate an output array of size `n`.
- **Expected output:** `arr` becomes sorted.
- **Evaluation:** confirm O(k) auxiliary memory; demonstrate (in tests) that the in-place form CANNOT carry record payloads stably.

---

### Task 10: Maximum Gap (Leetcode 164)

Given an unsorted integer array, find the maximum difference between two successive elements in its sorted form. Solve in **O(n)** without a comparison sort. Use Counting Sort over the value range (or Bucket Sort if range is huge).

#### Go

```go
package main

import "fmt"

// MaximumGap returns the largest gap between consecutive elements in sorted(arr).
// Must run in O(n).
func MaximumGap(arr []int) int {
    if len(arr) < 2 {
        return 0
    }
    // TODO: Counting Sort variant — find min/max, allocate count[max-min+1],
    //       sort, then single pass to compute max(arr[i+1] - arr[i]).
    return 0
}

func main() {
    fmt.Println(MaximumGap([]int{3, 6, 9, 1})) // expected: 3 (between 3 and 6, or 6 and 9)
}
```

#### Java

```java
public class Task10 {
    public static int maximumGap(int[] arr) {
        if (arr.length < 2) return 0;
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(maximumGap(new int[]{3, 6, 9, 1})); // 3
    }
}
```

#### Python

```python
def maximum_gap(arr):
    """LeetCode 164. O(n) max successive gap via non-comparison sort."""
    if len(arr) < 2:
        return 0
    # TODO
    pass


if __name__ == "__main__":
    print(maximum_gap([3, 6, 9, 1]))  # expected: 3
```

- **Constraints:** **O(n)** time. O(n + k) space allowed.
- **Expected output:** integer gap.
- **Evaluation:** correctness on `[]`, `[7]`, sorted, reverse, all-equal (gap = 0).

---

## Advanced Tasks

### Task 11: Parallel Counting Sort With Prefix-Sum Partitioning

Implement parallel Counting Sort with `W` workers. Three phases:

1. Partition input into `W` slices; each worker tallies into a local `count[k]`.
2. Sum local counts into a global count; prefix-sum it.
3. Each worker scatters its slice into **disjoint** output ranges (no locks needed because the partition prefix sums tell each worker exactly where its keys live).

#### Go

```go
package main

import (
    "fmt"
    "sync"
)

// ParallelCountingSort sorts arr stably using `workers` goroutines.
// Pre: every element is in [0, k).
func ParallelCountingSort(arr []int, k, workers int) []int {
    n := len(arr)
    if n == 0 {
        return arr
    }
    // TODO Phase 1: chunk arr into `workers` slices; each goroutine fills a local count.
    // TODO Phase 2: sum local counts into global; prefix-sum globally;
    //               per-worker prefix sums tell each worker where to write.
    // TODO Phase 3: each worker scatters its slice right-to-left, with stable per-bucket placement.
    var _ sync.WaitGroup
    return nil
}

func main() {
    arr := []int{4, 2, 2, 8, 3, 3, 1, 0, 5, 6, 7, 4, 2}
    fmt.Println(ParallelCountingSort(arr, 9, 4))
}
```

#### Java

```java
import java.util.concurrent.*;
import java.util.Arrays;

public class Task11 {
    public static int[] parallelCountingSort(int[] arr, int k, int workers)
            throws InterruptedException {
        // TODO: split into `workers` chunks; ExecutorService for Phase 1 (local counts);
        //       single-threaded Phase 2 (combine + prefix sum);
        //       ExecutorService for Phase 3 (scatter into disjoint regions).
        return new int[0];
    }

    public static void main(String[] args) throws InterruptedException {
        int[] arr = {4, 2, 2, 8, 3, 3, 1, 0, 5, 6, 7, 4, 2};
        System.out.println(Arrays.toString(parallelCountingSort(arr, 9, 4)));
    }
}
```

#### Python

```python
from multiprocessing import Pool
from typing import List

def _local_count(args):
    chunk, k = args
    count = [0] * k
    for v in chunk:
        count[v] += 1
    return count

def parallel_counting_sort(arr: List[int], k: int, workers: int) -> List[int]:
    """Multi-process Counting Sort. Use multiprocessing (not threading) to dodge the GIL."""
    # TODO Phase 1: split arr into `workers` chunks; pool.map(_local_count, ...)
    # TODO Phase 2: combine local counts -> global; prefix sum globally
    # TODO Phase 3: scatter via per-chunk write offsets
    pass


if __name__ == "__main__":
    arr = [4, 2, 2, 8, 3, 3, 1, 0, 5, 6, 7, 4, 2]
    print(parallel_counting_sort(arr, 9, 4))
```

- **Constraints:** `n` up to 10^7. Benchmark on `workers in {1, 2, 4, 8}`; speedup should be near-linear up to memory-bandwidth saturation.
- **Expected output:** sorted array equal to the single-threaded result.
- **Evaluation:** correctness, no data races (Go race detector), speedup ≥ 3× on 8 cores for `k = 1000`.

---

### Task 12: Cache-Conscious Counting Sort For Large k

When `k > L3_cache_size`, every `count[v]++` is a cache miss. Implement a two-level Counting Sort: first sort by the high bits (small `k`), then within each bucket sort by the low bits. This is the same idea Radix Sort uses for cache efficiency.

#### Go

```go
package main

import "fmt"

// CountingSortTwoLevel sorts ints in [0, kHi*kLo) by first bucketing on high
// (value/kLo), then refining within each bucket on (value%kLo).
// Memory traffic: O((n + kHi) + sum_bucket(n_b + kLo))
func CountingSortTwoLevel(arr []int, kHi, kLo int) []int {
    // TODO Phase A: Counting Sort by hi = v / kLo into `kHi` buckets.
    // TODO Phase B: for each bucket, Counting Sort by lo = v % kLo into `kLo` slots.
    // TODO Phase C: concatenate buckets.
    return nil
}

func main() {
    // Sort 16-bit values using 256x256 split (each pass has tiny count array)
    fmt.Println(CountingSortTwoLevel([]int{40000, 12, 65535, 100, 256, 257}, 256, 256))
}
```

#### Java

```java
import java.util.Arrays;

public class Task12 {
    public static int[] countingSortTwoLevel(int[] arr, int kHi, int kLo) {
        // TODO
        return new int[0];
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            countingSortTwoLevel(new int[]{40000, 12, 65535, 100, 256, 257}, 256, 256)));
    }
}
```

#### Python

```python
def counting_sort_two_level(arr, k_hi, k_lo):
    """Two-level Counting Sort. Useful when full k > L3 cache size."""
    # TODO
    pass


if __name__ == "__main__":
    print(counting_sort_two_level([40000, 12, 65535, 100, 256, 257], 256, 256))
```

- **Constraints:** must reduce cache misses vs naive single-level Counting Sort on `k = 65536`.
- **Expected output:** sorted array equal to `sorted(arr)`.
- **Evaluation:** benchmark vs single-level Counting Sort on `n = 10^6`, `k = 65536`; explain the cache-miss reduction.

---

### Task 13: Streaming Counting Sort

Input is a stream of ints arriving over time; you cannot store all of them. Maintain `count[k]` online and, on demand, emit the current top-`m` most-frequent values. Bounded memory: `O(k)`, not `O(n)`.

#### Go

```go
package main

import "fmt"

type StreamingCount struct {
    k     int
    count []int
    n     int
}

// NewStreamingCount allocates a fixed-size counter for keys in [0, k).
func NewStreamingCount(k int) *StreamingCount {
    return &StreamingCount{k: k, count: make([]int, k)}
}

// Add records one observation of value v.
func (s *StreamingCount) Add(v int) {
    // TODO: s.count[v]++; s.n++
}

// TopM returns the m most-frequent values in count order (descending).
// Ties broken by smaller value first (stable).
func (s *StreamingCount) TopM(m int) []int {
    // TODO: scan count once; partial selection (heap of size m) is allowed.
    return nil
}

func main() {
    s := NewStreamingCount(10)
    for _, v := range []int{3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5} {
        s.Add(v)
    }
    fmt.Println(s.TopM(3)) // expected: [5 1 3] (5 appears 3×, 1 and 3 appear 2× each)
}
```

#### Java

```java
import java.util.*;

public class Task13 {
    static class StreamingCount {
        int k;
        int[] count;
        long n;

        StreamingCount(int k) { this.k = k; this.count = new int[k]; }

        void add(int v) {
            // TODO
        }

        int[] topM(int m) {
            // TODO
            return new int[0];
        }
    }

    public static void main(String[] args) {
        StreamingCount s = new StreamingCount(10);
        int[] stream = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5};
        for (int v : stream) s.add(v);
        System.out.println(Arrays.toString(s.topM(3))); // [5, 1, 3]
    }
}
```

#### Python

```python
import heapq

class StreamingCount:
    def __init__(self, k):
        self.k = k
        self.count = [0] * k
        self.n = 0

    def add(self, v):
        # TODO
        pass

    def top_m(self, m):
        """Return the m most-frequent values, descending by count, ties by value asc."""
        # TODO: heap of size m over (count, -value) pairs
        return []


if __name__ == "__main__":
    s = StreamingCount(10)
    for v in [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]:
        s.add(v)
    print(s.top_m(3))  # expected: [5, 1, 3]
```

- **Constraints:** `add` must be O(1); `top_m` is O(k log m). Memory is O(k) regardless of stream length.
- **Expected output:** correct top-m values, ties broken by smaller value first.
- **Evaluation:** correctness on empty stream, m > unique-count, all-equal stream.

---

### Task 14: Stability Test Harness

Write a generic test that any Counting Sort implementation must pass: given a list of `(key, payload)` records, sort by `key` and verify that for every group of equal keys, the payload order matches the input order.

#### Go

```go
package main

import "fmt"

type Rec struct {
    Key int
    Tag int // monotonically increasing original index
}

// IsStable returns true if `sorted` is the result of a stable sort of `input` by Key.
// It must reject any permutation that puts an earlier-tagged record after a
// later-tagged one within the same Key group.
func IsStable(input, sorted []Rec) bool {
    // TODO: walk `sorted`; for each adjacent pair with equal Key,
    //       assert prev.Tag < curr.Tag.
    return false
}

func main() {
    in := []Rec{{2, 0}, {1, 1}, {2, 2}, {1, 3}}
    sorted := []Rec{{1, 1}, {1, 3}, {2, 0}, {2, 2}}
    fmt.Println(IsStable(in, sorted)) // expected: true

    unstable := []Rec{{1, 3}, {1, 1}, {2, 0}, {2, 2}}
    fmt.Println(IsStable(in, unstable)) // expected: false
}
```

#### Java

```java
import java.util.*;

public class Task14 {
    static class Rec {
        int key, tag;
        Rec(int k, int t) { key = k; tag = t; }
    }

    public static boolean isStable(List<Rec> input, List<Rec> sorted) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        List<Rec> in = List.of(new Rec(2, 0), new Rec(1, 1), new Rec(2, 2), new Rec(1, 3));
        List<Rec> good = List.of(new Rec(1, 1), new Rec(1, 3), new Rec(2, 0), new Rec(2, 2));
        List<Rec> bad  = List.of(new Rec(1, 3), new Rec(1, 1), new Rec(2, 0), new Rec(2, 2));
        System.out.println(isStable(in, good)); // true
        System.out.println(isStable(in, bad));  // false
    }
}
```

#### Python

```python
from dataclasses import dataclass
from typing import List

@dataclass
class Rec:
    key: int
    tag: int

def is_stable(input_arr: List[Rec], sorted_arr: List[Rec]) -> bool:
    """Verify sorted_arr is a stable sort of input_arr by key.
    Within each key group, tags must appear in strictly increasing order."""
    # TODO
    pass


if __name__ == "__main__":
    inp  = [Rec(2, 0), Rec(1, 1), Rec(2, 2), Rec(1, 3)]
    good = [Rec(1, 1), Rec(1, 3), Rec(2, 0), Rec(2, 2)]
    bad  = [Rec(1, 3), Rec(1, 1), Rec(2, 0), Rec(2, 2)]
    print(is_stable(inp, good))  # expected: True
    print(is_stable(inp, bad))   # expected: False
```

- **Constraints:** O(n) verification; no comparisons between non-equal keys.
- **Expected output:** boolean.
- **Evaluation:** correct rejection of any tag-inversion within a key group; correct acceptance of the trivial single-element and empty cases.

---

### Task 15: Crossover Benchmark — Counting Sort vs Std Sort Across k

Find the empirical crossover where Counting Sort starts losing to your language's built-in sort. Run a grid over `n in [10^3, 10^4, 10^5, 10^6]` and `k in [10, 100, 10^3, 10^4, 10^5, 10^6, 10^7]`. Plot the winner for each cell.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "time"
)

func crossover(countingSort func([]int, int) []int) {
    rng := rand.New(rand.NewSource(42))
    ns := []int{1_000, 10_000, 100_000, 1_000_000}
    ks := []int{10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000}

    for _, n := range ns {
        for _, k := range ks {
            data := make([]int, n)
            for i := range data { data[i] = rng.Intn(k) }

            cpy := append([]int{}, data...)
            t := time.Now()
            _ = countingSort(cpy, k)
            tC := time.Since(t)

            cpy2 := append([]int{}, data...)
            t = time.Now()
            sort.Ints(cpy2)
            tQ := time.Since(t)

            winner := "Counting"
            if tQ < tC { winner = "Quick" }
            fmt.Printf("n=%7d k=%9d  C=%7.2fms  Q=%7.2fms  -> %s\n",
                n, k, float64(tC.Microseconds())/1000, float64(tQ.Microseconds())/1000, winner)
        }
    }
}

func main() {
    // TODO: pass your Task 1 CountingSort as the function arg
    // crossover(CountingSort)
}
```

#### Java

```java
import java.util.Arrays;
import java.util.Random;
import java.util.function.BiFunction;

public class Task15 {
    public static void crossover(BiFunction<int[], Integer, int[]> countingSort) {
        Random rng = new Random(42);
        int[] ns = {1_000, 10_000, 100_000, 1_000_000};
        int[] ks = {10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000};

        for (int n : ns) {
            for (int k : ks) {
                int[] data = new int[n];
                for (int i = 0; i < n; i++) data[i] = rng.nextInt(k);

                int[] cpy = data.clone();
                long t = System.nanoTime();
                countingSort.apply(cpy, k);
                double tC = (System.nanoTime() - t) / 1e6;

                int[] cpy2 = data.clone();
                t = System.nanoTime();
                Arrays.sort(cpy2);
                double tQ = (System.nanoTime() - t) / 1e6;

                String winner = tC < tQ ? "Counting" : "Quick";
                System.out.printf("n=%7d k=%9d  C=%7.2fms  Q=%7.2fms  -> %s%n",
                    n, k, tC, tQ, winner);
            }
        }
    }

    public static void main(String[] args) {
        // TODO: pass Task1::countingSort
        // crossover(Task1::countingSort);
    }
}
```

#### Python

```python
import random
import timeit

def crossover(counting_sort_fn):
    random.seed(42)
    for n in [1_000, 10_000, 100_000, 1_000_000]:
        for k in [10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]:
            data = [random.randint(0, k - 1) for _ in range(n)]
            t_c = timeit.timeit(lambda: counting_sort_fn(data[:], k), number=3) / 3
            t_q = timeit.timeit(lambda: sorted(data), number=3) / 3
            winner = "Counting" if t_c < t_q else "Quick"
            print(f"n={n:>7} k={k:>9}  C={t_c*1000:7.2f}ms  Q={t_q*1000:7.2f}ms  -> {winner}")


if __name__ == "__main__":
    # crossover(counting_sort)  # from Task 1
    pass
```

- **Constraints:** report wall-clock per cell; do 3 warmup runs before timing.
- **Expected observation:** Counting Sort wins while `k <= ~10·n`; loses once the count array spills out of L3 cache (typically `k > ~10^7`).
- **Evaluation:** correctness of crossover boundary (varies per machine); written analysis of *why* the crossover lives where it does.

---

## Benchmark Task

> Time Counting Sort across `n = [10, 100, 1_000, 10_000, 100_000]` with **50 iterations** per size, against the language's built-in sort. Hold `k = 1000` constant.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "time"
)

func benchmark(countingSort func([]int, int) []int) {
    rng := rand.New(rand.NewSource(42))
    sizes := []int{10, 100, 1_000, 10_000, 100_000}
    k := 1000
    const iters = 50

    for _, n := range sizes {
        data := make([]int, n)
        for i := range data { data[i] = rng.Intn(k) }

        // Counting Sort
        start := time.Now()
        for i := 0; i < iters; i++ {
            cpy := append([]int{}, data...)
            _ = countingSort(cpy, k)
        }
        tC := float64(time.Since(start).Microseconds()) / 1000.0 / float64(iters)

        // Pdqsort (sort.Ints)
        start = time.Now()
        for i := 0; i < iters; i++ {
            cpy := append([]int{}, data...)
            sort.Ints(cpy)
        }
        tQ := float64(time.Since(start).Microseconds()) / 1000.0 / float64(iters)

        fmt.Printf("n=%7d  Counting: %7.3f ms  std: %7.3f ms  ratio: %.2fx\n",
            n, tC, tQ, tQ/tC)
    }
}

func main() {
    // benchmark(CountingSort) // your Task 1 implementation
}
```

#### Java

```java
import java.util.Arrays;
import java.util.Random;
import java.util.function.BiFunction;

public class Benchmark {
    public static void run(BiFunction<int[], Integer, int[]> countingSort) {
        int[] sizes = {10, 100, 1_000, 10_000, 100_000};
        int k = 1000;
        final int iters = 50;
        Random rng = new Random(42);

        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = rng.nextInt(k);

            long start = System.nanoTime();
            for (int i = 0; i < iters; i++) {
                countingSort.apply(data.clone(), k);
            }
            double tC = (System.nanoTime() - start) / 1e6 / iters;

            start = System.nanoTime();
            for (int i = 0; i < iters; i++) {
                Arrays.sort(data.clone());
            }
            double tQ = (System.nanoTime() - start) / 1e6 / iters;

            System.out.printf("n=%7d  Counting: %7.3f ms  std: %7.3f ms  ratio: %.2fx%n",
                n, tC, tQ, tQ / tC);
        }
    }

    public static void main(String[] args) {
        // run(Task1::countingSort);
    }
}
```

#### Python

```python
import random
import timeit

def benchmark(counting_sort_fn):
    random.seed(42)
    k = 1000
    iters = 50
    for n in [10, 100, 1_000, 10_000, 100_000]:
        data = [random.randint(0, k - 1) for _ in range(n)]
        t_c = timeit.timeit(lambda: counting_sort_fn(data[:], k), number=iters) / iters
        t_q = timeit.timeit(lambda: sorted(data), number=iters) / iters
        print(f"n={n:>7}  Counting: {t_c*1000:7.3f} ms  "
              f"sorted(): {t_q*1000:7.3f} ms  ratio: {t_q/t_c:.2f}x")


if __name__ == "__main__":
    # benchmark(counting_sort)  # from Task 1
    pass
```

### Expected Output (approximate, modern laptop, k = 1000)

| n | Counting Sort | Built-in Sort | Ratio |
|---|---|---|---|
| 10 | ~0.001 ms | ~0.001 ms | ~1× (overhead dominates) |
| 100 | ~0.005 ms | ~0.010 ms | ~2× |
| 1,000 | ~0.05 ms | ~0.08 ms | ~1.6× |
| 10,000 | ~0.4 ms | ~1.2 ms | ~3× |
| 100,000 | ~4 ms | ~14 ms | ~3.5× |

For `k = 1000` (well inside L1 cache), Counting Sort consistently beats Pdqsort / Dual-Pivot Quick Sort by ~3× on mid-to-large inputs. Push `k` to `10^7` and Counting Sort starts losing as the count array spills out of L3.

---

## Evaluation Criteria

Each task is graded on:

1. **Correctness** — passes edge cases: empty, single, all-equal, sorted, reverse, negative (where applicable).
2. **Stability** — payload order preserved for equal keys (where the algorithm contract requires it).
3. **Complexity** — meets stated O(n + k) time and O(n + k) space (or O(k) for in-place variant).
4. **No comparisons** — verify with a debug counter that `<` is never called on two input elements.
5. **Idiomatic code** — Go slices, Java arrays, Python lists; no language-foreign patterns.
6. **Documentation** — preconditions (`0 <= v < k`), stability guarantee, complexity stated in comments/docstrings.
7. **Tests** — at least 5 input shapes per task; benchmark tasks must run with iters >= 50.
