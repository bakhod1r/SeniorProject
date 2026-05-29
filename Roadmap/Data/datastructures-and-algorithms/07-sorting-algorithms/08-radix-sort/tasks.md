# Radix Sort — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.

## Beginner Tasks

**Task 1:** Implement LSD Radix Sort for non-negative integers in base 10. Verify with `[170, 45, 75, 90, 802, 24, 2, 66]` → `[2, 24, 45, 66, 75, 90, 170, 802]`.

#### Go

```go
package main

func RadixSortBase10(arr []int) {
    // TODO: implement
}

func main() {
    data := []int{170, 45, 75, 90, 802, 24, 2, 66}
    RadixSortBase10(data)
    // print
}
```

#### Java

```java
public class Task1 {
    public static void sort(int[] arr) {
        // TODO: implement
    }
    public static void main(String[] args) {
        int[] data = {170, 45, 75, 90, 802, 24, 2, 66};
        sort(data);
    }
}
```

#### Python

```python
def radix_sort_base10(arr):
    # TODO: implement
    pass

if __name__ == "__main__":
    data = [170, 45, 75, 90, 802, 24, 2, 66]
    radix_sort_base10(data)
    print(data)
```

- **Constraints:** correct O(d·(n+k)), stable, tested with empty/single/duplicate/all-equal inputs.
- **Expected Output:** `[2, 24, 45, 66, 75, 90, 170, 802]`
- **Evaluation:** correctness, stability, edge cases.

---

**Task 2:** Implement byte-radix LSD (base 256) for `uint32` keys. Verify with random input by comparing to language built-in sort.

#### Go

```go
package main

func RadixSortBase256(arr []uint32) {
    // TODO: 4 passes, shift by 0/8/16/24, mask 0xFF, double-buffered
}

func main() {
    // generate random uint32 values, sort, compare against sort.Slice
}
```

#### Java

```java
public class Task2 {
    public static void sortBase256(int[] arr) {
        // TODO: 4 passes, shift by 0/8/16/24, mask 0xFF, use >>> for unsigned shift
    }
    public static void main(String[] args) {
        // generate random ints, sort, compare against Arrays.sort
    }
}
```

#### Python

```python
def radix_sort_base256(arr):
    # TODO: 4 passes, shifts (0,8,16,24), mask 0xFF
    pass

if __name__ == "__main__":
    import random
    data = [random.randint(0, 2**32 - 1) for _ in range(1000)]
    radix_sort_base256(data)
    assert data == sorted(data)
```

- **Hint:** Use bit-shift (`v >> shift`) and mask (`& 0xFF`) for digit extraction; 4 passes total.
- **Constraints:** 4 passes for 32-bit, double-buffered (no allocation per pass).

---

**Task 3:** Write a test that asserts stability of your LSD Radix Sort. Use input pairs `[(key, original_idx)]` and confirm ties preserve original index order.

#### Go

```go
type Pair struct{ Key, Idx int }

func TestStability(t *testing.T) {
    pairs := []Pair{{3, 0}, {1, 1}, {3, 2}, {1, 3}}
    // TODO: extract keys, sort indirectly, verify pairs[0].Idx==1, pairs[1].Idx==3, etc.
}
```

#### Java

```java
import java.util.*;

public class Task3 {
    record Pair(int key, int idx) {}

    public static void testStability() {
        List<Pair> pairs = List.of(new Pair(3, 0), new Pair(1, 1),
                                   new Pair(3, 2), new Pair(1, 3));
        // TODO: sort by key using your stable radix; assert ties preserve idx order
    }
}
```

#### Python

```python
def test_stability():
    pairs = [(3, 0), (1, 1), (3, 2), (1, 3)]
    # TODO: implement stable_sort_by_key from middle.md
    # Sort by pairs[i][0], verify ties preserve original index order
    expected = [(1, 1), (1, 3), (3, 0), (3, 2)]
    # assert sorted == expected
```

- **Hint:** Sort `[(3, 0), (1, 1), (3, 2), (1, 3)]` by `key`; expected `[(1, 1), (1, 3), (3, 0), (3, 2)]`.

---

**Task 4:** Implement Counting Sort as a standalone function and call it from your Radix Sort as the inner subroutine. Verify the two-level structure works.

- **Constraints:** Counting Sort must be stable (right-to-left placement).
- **Why this matters:** Reinforces the separation: Counting Sort is a standalone primitive; Radix Sort just calls it d times.

---

**Task 5:** Generate 1,000 random ints in `[0, 10^6]`, sort with your Radix Sort, compare to language-builtin sort. Assert equal outputs.

- **Constraints:** Use seeded RNG so tests are reproducible.

---

## Intermediate Tasks

**Task 6:** Implement Radix Sort for **signed `int32`** values. Handle negatives by flipping the sign bit before sort and flipping back after.

#### Go

```go
package main

func RadixSortSigned(arr []int32) {
    // Flip sign bit, sort as uint32, flip back
    // TODO
}
```

#### Java

```java
public class Task6 {
    public static void sortSigned(int[] arr) {
        // Flip sign bit (XOR with Integer.MIN_VALUE)
        // TODO
    }
}
```

#### Python

```python
def radix_sort_signed(arr):
    # Use (v ^ 0x80000000) trick
    # TODO
    pass
```

- **Constraints:** Must handle `INT_MIN`, negatives, zero, and positives.
- **Expected Output:** Correctly sorted output including negative values.

---

**Task 7:** Implement **MSD Radix Sort** for strings. Test with `["she", "sells", "seashells", "by", "the", "seashore"]` → sorted lexicographically.

#### Go

```go
package main

func MSDStringSort(arr []string) {
    aux := make([]string, len(arr))
    msdRecurse(arr, aux, 0, len(arr)-1, 0)
}

func msdRecurse(arr, aux []string, lo, hi, d int) {
    // TODO: recursive MSD; sentinel bucket for d >= len(s)
}
```

#### Java

```java
public class Task7 {
    public static void msdSort(String[] arr) {
        String[] aux = new String[arr.length];
        msd(arr, aux, 0, arr.length - 1, 0);
    }

    private static void msd(String[] arr, String[] aux, int lo, int hi, int d) {
        // TODO: recursive MSD; bucket 0 = end-of-string
    }
}
```

#### Python

```python
def msd_string_sort(strings):
    aux = [None] * len(strings)
    _msd(strings, aux, 0, len(strings), 0)

def _msd(arr, aux, lo, hi, d):
    # TODO: recursive MSD with end-of-string sentinel
    pass
```

- **Hint:** Use a sentinel for end-of-string (so shorter strings sort before their prefix-matched longer counterparts).
- **Constraints:** Recursive on each bucket; insertion-sort cutoff for buckets ≤ 24.

---

**Task 8:** Sort `n = 1,000,000` random IPv4 addresses (as strings `"a.b.c.d"`) using Radix Sort on the parsed `uint32` value. Output must be in numeric IP order.

#### Go

```go
func SortIPs(ips []string) []string {
    nums := make([]uint32, len(ips))
    for i, ip := range ips { nums[i] = ipToUint32(ip) }
    RadixSortBase256(nums) // from Task 2
    out := make([]string, len(nums))
    for i, n := range nums { out[i] = uint32ToIP(n) }
    return out
}

func ipToUint32(ip string) uint32 { /* TODO */ return 0 }
func uint32ToIP(v uint32) string  { /* TODO */ return "" }
```

#### Java

```java
public class Task8 {
    public static String[] sortIPs(String[] ips) {
        long[] nums = new long[ips.length];
        for (int i = 0; i < ips.length; i++) nums[i] = ipToLong(ips[i]);
        // sort nums with radix
        String[] out = new String[ips.length];
        for (int i = 0; i < nums.length; i++) out[i] = longToIp(nums[i]);
        return out;
    }
    static long ipToLong(String ip) { /* TODO */ return 0; }
    static String longToIp(long v) { /* TODO */ return ""; }
}
```

#### Python

```python
def sort_ips(ips):
    def ip_to_int(s):
        parts = s.split('.')
        return (int(parts[0]) << 24) | (int(parts[1]) << 16) | (int(parts[2]) << 8) | int(parts[3])
    def int_to_ip(v):
        return f"{(v>>24)&0xFF}.{(v>>16)&0xFF}.{(v>>8)&0xFF}.{v&0xFF}"
    nums = [ip_to_int(ip) for ip in ips]
    radix_sort_base256(nums)
    return [int_to_ip(n) for n in nums]
```

- **Hint:** Parse → sort uint32s → format back to "a.b.c.d".

---

**Task 9:** Implement **double-buffered LSD Radix Sort** that does NOT do `copy(arr, output)` after each pass. Instead, ping-pong two pre-allocated buffers and only copy at the end if needed.

#### Go

```go
func RadixSortDoubleBuffer(arr []uint32) {
    n := len(arr)
    buf := make([]uint32, n)
    src, dst := arr, buf
    for shift := uint(0); shift < 32; shift += 8 {
        // histogram → prefix sum → place src→dst → swap src and dst
        // TODO
        src, dst = dst, src
    }
    if &src[0] != &arr[0] { copy(arr, src) }
}
```

#### Java

```java
public class Task9 {
    public static void sortDoubleBuf(int[] arr) {
        int n = arr.length;
        int[] buf = new int[n];
        int[] src = arr, dst = buf;
        for (int shift = 0; shift < 32; shift += 8) {
            // TODO: histogram + scatter from src to dst
            int[] tmp = src; src = dst; dst = tmp;
        }
        if (src != arr) System.arraycopy(src, 0, arr, 0, n);
    }
}
```

#### Python

```python
def radix_sort_double_buffer(arr):
    n = len(arr)
    buf = [0] * n
    src, dst = arr, buf
    for shift in (0, 8, 16, 24):
        # TODO: histogram + scatter from src to dst
        src, dst = dst, src
    if src is not arr:
        arr[:] = src
```

- **Constraints:** Same correctness as Task 2 but measurably faster (benchmark to confirm).

---

**Task 10:** Implement **Radix Sort for floats** (`float32`). Use the IEEE-754 bit transform: positives flip sign bit; negatives flip all bits. Reverse transform after sorting.

#### Go

```go
import "math"

func RadixSortFloat32(arr []float32) {
    keys := make([]uint32, len(arr))
    for i, v := range arr {
        b := math.Float32bits(v)
        if b&0x80000000 != 0 { keys[i] = ^b }   // negative
        else                  { keys[i] = b | 0x80000000 }
    }
    RadixSortBase256(keys)
    for i, k := range keys {
        if k&0x80000000 != 0 { arr[i] = math.Float32frombits(k & 0x7FFFFFFF) }
        else                  { arr[i] = math.Float32frombits(^k) }
    }
}
```

#### Java

```java
public class Task10 {
    public static void sortFloats(float[] arr) {
        int[] keys = new int[arr.length];
        for (int i = 0; i < arr.length; i++) {
            int b = Float.floatToRawIntBits(arr[i]);
            keys[i] = ((b & 0x80000000) != 0) ? ~b : (b | 0x80000000);
        }
        // sort keys with byte radix
        for (int i = 0; i < arr.length; i++) {
            int k = keys[i];
            arr[i] = ((k & 0x80000000) != 0)
                ? Float.intBitsToFloat(k & 0x7FFFFFFF)
                : Float.intBitsToFloat(~k);
        }
    }
}
```

#### Python

```python
import struct

def radix_sort_float32(arr):
    def f_to_key(f):
        b = struct.unpack('I', struct.pack('f', f))[0]
        return (~b & 0xFFFFFFFF) if (b & 0x80000000) else (b | 0x80000000)
    def key_to_f(k):
        if k & 0x80000000:
            return struct.unpack('f', struct.pack('I', k & 0x7FFFFFFF))[0]
        return struct.unpack('f', struct.pack('I', (~k) & 0xFFFFFFFF))[0]
    keys = [f_to_key(v) for v in arr]
    radix_sort_base256(keys)
    arr[:] = [key_to_f(k) for k in keys]
```

- **Constraints:** Correctly handles negative floats, positive floats, zero, and small/large magnitudes.
- **Hint:** `math.Float32bits` in Go, `Float.floatToRawIntBits` in Java, `struct.unpack` in Python.

---

## Advanced Tasks

**Task 11:** Implement **hybrid Radix + Insertion Sort**: switch to Insertion Sort when sub-array size drops below 32. Benchmark vs pure Radix on `n = 10^6` random ints.

- **Constraints:** Must show measurable speedup (>20%) over pure Radix on the same input.

---

**Task 12:** Implement **parallel MSD Radix Sort** using goroutines (Go) / `ExecutorService` (Java) / `multiprocessing` (Python). Spawn one task per bucket. Benchmark on 8-core machine vs sequential.

#### Go

```go
import "sync"

const PARALLEL_CUTOFF = 50_000

func ParallelMSD(arr []uint32) {
    var wg sync.WaitGroup
    msdPar(arr, 0, len(arr), 24, &wg)
    wg.Wait()
}

func msdPar(arr []uint32, lo, hi int, shift uint, wg *sync.WaitGroup) {
    // TODO: histogram → scatter → for each bucket, spawn goroutine if size > cutoff
}
```

#### Java

```java
import java.util.concurrent.*;

public class Task12 {
    static ExecutorService pool = Executors.newWorkStealingPool();
    static final int CUTOFF = 50_000;

    public static void parallelMSD(int[] arr) {
        ForkJoinPool.commonPool().invoke(new MSDTask(arr, 0, arr.length, 24));
    }

    static class MSDTask extends RecursiveAction {
        // TODO: implement
        int[] arr; int lo, hi, shift;
        MSDTask(int[] a, int l, int h, int s){arr=a;lo=l;hi=h;shift=s;}
        @Override protected void compute() { /* TODO */ }
    }
}
```

#### Python

```python
from concurrent.futures import ProcessPoolExecutor
import os

CUTOFF = 50_000

def parallel_msd(arr):
    # Note: Python's GIL limits threading; use processes for true parallelism
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
        # TODO: partition once, dispatch each bucket as a task
        pass
```

- **Constraints:** Use a threshold (`n > 50_000`) below which sub-buckets run sequentially to avoid task-spawn overhead.
- **Expected:** 3-5× speedup on 8 cores for `n = 10^7`.

---

**Task 13:** Implement **external Radix Sort**: input is a binary file of `int64` values larger than RAM (simulate by setting a small in-memory limit, e.g. 100k records). Partition into 256 bucket files (by top byte), recurse if any bucket > limit, finally concatenate.

- **Constraints:** Must handle a 10× memory-limit input correctly. Cleanup temp files.

---

**Task 14:** Implement **Radix Sort with software write-combining**: thread-local per-bucket buffers of one cache line (8 `int64` keys). When a buffer fills, copy the line to the output. Measure cache-miss reduction with `perf` (Linux).

- **Constraints:** Must show fewer cache misses than naive scatter. Pure correctness alone isn't enough — write-combining is a performance optimization.

---

**Task 15:** Build a **TeraSort-style distributed sort**:
1. Sample 0.1% of input → quantile boundaries.
2. Partition each input record to one of `p` partitions by quantile.
3. Each partition sorted locally using your byte-radix LSD.
4. Concatenate partitions.

Test with synthetic data of size 100M records on a 4-machine simulated cluster (use 4 goroutines / threads to simulate nodes).

- **Constraints:** Must produce same output as a global sort. Time should beat a single-threaded sort by ≥ 3× on 4 nodes.

---

## Benchmark Task

> Compare performance across all 3 languages.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "time"
)

// Put your byte-radix LSD here:
func RadixSortU32(arr []uint32) {
    // implement (see middle.md Example 1)
}

func main() {
    sizes := []int{10_000, 100_000, 1_000_000, 10_000_000}
    rng := rand.New(rand.NewSource(42))
    for _, n := range sizes {
        data := make([]uint32, n)
        for i := range data {
            data[i] = rng.Uint32()
        }
        radix := append([]uint32(nil), data...)
        t1 := time.Now()
        RadixSortU32(radix)
        rt := time.Since(t1)

        native := append([]uint32(nil), data...)
        t2 := time.Now()
        sort.Slice(native, func(i, j int) bool { return native[i] < native[j] })
        nt := time.Since(t2)

        fmt.Printf("n=%9d  radix=%9.2fms  pdqsort=%9.2fms  speedup=%.2fx\n",
            n, float64(rt.Microseconds())/1000.0,
            float64(nt.Microseconds())/1000.0,
            float64(nt)/float64(rt))
    }
}
```

#### Java

```java
import java.util.Arrays;
import java.util.Random;

public class BenchmarkTask {
    static void radixSort(int[] arr) {
        // implement (see middle.md Java Example)
    }

    public static void main(String[] args) {
        int[] sizes = {10_000, 100_000, 1_000_000, 10_000_000};
        Random rng = new Random(42);
        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = rng.nextInt() & 0x7FFFFFFF;

            int[] radixCopy = data.clone();
            long t1 = System.nanoTime();
            radixSort(radixCopy);
            long rt = System.nanoTime() - t1;

            int[] nativeCopy = data.clone();
            long t2 = System.nanoTime();
            Arrays.sort(nativeCopy);
            long nt = System.nanoTime() - t2;

            System.out.printf("n=%9d  radix=%9.2fms  arraysort=%9.2fms  speedup=%.2fx%n",
                n, rt / 1e6, nt / 1e6, (double) nt / rt);
        }
    }
}
```

#### Python

```python
import random
import timeit

def radix_sort_u32(arr):
    """Implement byte LSD radix sort (see middle.md Python example)."""
    # TODO: implement
    pass

def benchmark():
    sizes = [10_000, 100_000, 1_000_000]
    for n in sizes:
        random.seed(42)
        data = [random.randint(0, 2**31 - 1) for _ in range(n)]

        rt = timeit.timeit(lambda: radix_sort_u32(data.copy()), number=3) / 3
        nt = timeit.timeit(lambda: sorted(data), number=3) / 3

        print(f"n={n:>9}  radix={rt*1000:9.2f}ms  "
              f"timsort={nt*1000:9.2f}ms  "
              f"speedup={nt/rt:.2f}x")

if __name__ == "__main__":
    benchmark()
```

**Expected results (modern x86):**

| n | Go Radix vs Pdqsort | Java Radix vs Arrays.sort | Python Radix vs sorted() |
|---|--------------------:|---------------------------:|--------------------------:|
| 10⁴ | 0.5-1.0× | 0.5-1.0× | 0.01× (Python loop slow) |
| 10⁵ | 1.5-2.5× | 1.5-2.5× | 0.05× |
| 10⁶ | 2.0-3.0× | 2.0-3.0× | 0.1× |
| 10⁷ | 2.5-3.5× | 2.5-3.5× | not feasible (pure Python) |

Note: Pure-Python radix is much slower than C-implemented `sorted()`. For real Python speed, use NumPy `np.argsort` or compile with `numba`.

---

## Stretch Tasks

**Task S1:** Implement **3-way Radix Quicksort** (Bentley-Sedgewick) for variable-length strings. Compare to MSD.

**Task S2:** Use Radix Sort to build a **suffix array** of a 1 MB text file. Compare correctness with naive `sorted(suffixes)`.

**Task S3:** Implement Radix Sort using **SIMD intrinsics** (Go: `golang.org/x/sys`, Java: Vector API, Python: NumPy). Measure speedup.

**Task S4:** Write a Radix Sort that runs on a **GPU** via CUDA (Python via `cupy` or `pycuda`). Compare to CPU Radix on the same data.

**Task S5:** Build a **streaming partial radix sort**: given an unbounded stream of integers, maintain the top-1000 in sorted order using radix-style top-K. Cannot store all input.

---

## Solution Approach Notes

For each task, follow this checklist:

1. **Specify the key model.** Non-negative `uint32`? Signed `int32`? `float32`? String? Get this clear before writing code.
2. **Choose the radix.** Default: byte (k=256). Decimal (k=10) for clarity in tasks 1-3.
3. **Test edge cases:** empty array, single element, all equal, already sorted, reverse sorted, all zeros.
4. **Verify stability** with the `(key, idx)` pair test.
5. **Measure** — radix should beat language built-in by 2-3× for n ≥ 10⁵ on integer keys. If it doesn't, look for allocation in inner loop.
