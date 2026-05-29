# Radix Sort — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Radix Sort and how does it differ from Quick Sort? | Non-comparison sort; processes one digit at a time; uses stable inner sort (Counting Sort); achieves O(d·(n+k)) |
| 2 | What's the time and space complexity of LSD Radix Sort? | Time: O(d·(n+k)); Space: O(n+k); not in-place |
| 3 | Why does the inner sort have to be stable? | Otherwise relative order from earlier passes is lost, breaking the induction; final result is wrong |
| 4 | Difference between LSD and MSD Radix Sort? | LSD: right-to-left, iterative, for fixed-width keys. MSD: left-to-right, recursive, for variable-length strings |
| 5 | What does "radix" mean in this context? | The base — the number of distinct digit values (10 for decimal, 256 for byte radix) |
| 6 | When would you choose Radix Sort over Merge Sort? | Large arrays of fixed-width integers; stability needed; cache-friendly linear scans; batch workload |
| 7 | What's the relationship between Radix Sort and Counting Sort? | Counting Sort is the standard stable inner subroutine of Radix Sort, called once per digit |
| 8 | Can Radix Sort sort negative numbers as-is? | No — two's complement makes negatives sort as large unsigned values; must flip sign bit first |

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Why doesn't the Ω(n log n) comparison lower bound apply to Radix Sort? | Lower bound assumes only comparison operations; Radix uses digit extraction + array indexing — different computational model |
| 2 | How do you choose the radix `k`? | Trade-off: smaller k = more passes (`d = ceil(w/log₂ k)`); larger k = bigger count table. Byte radix (k=256) hits the cache sweet spot |
| 3 | How would you sort 32-bit signed integers with Radix? | Flip the sign bit (`v ^ 0x80000000`), sort as unsigned, flip back. Treats `INT_MIN` as smallest |
| 4 | How would you sort floats with Radix? | IEEE-754 bit transform: positive → flip sign bit; negative → flip all bits. Sort as unsigned. Reverse transform after |
| 5 | What's the space cost of LSD Radix Sort and how can you reduce it? | O(n + k). Reduce with in-place variant (American Flag Sort / PARADIS) but with more swaps and harder parallelization |
| 6 | How is Radix Sort used to build suffix arrays? | DC3, SA-IS algorithms partition suffixes into groups, sort by triplet using radix → linear-time suffix array construction |
| 7 | When does MSD beat LSD? | Variable-length strings; sparse digit distributions; when early termination on small buckets matters |
| 8 | Why is double-buffering important in production Radix Sort? | Skips the `copy(out, in)` per pass; pre-allocated buffers ping-pong; ~30% speedup |
| 9 | How would you parallelize Radix Sort? | MSD: bucket-per-thread (naturally parallel). LSD: per-pass histogram parallel (reduce), scatter is harder — software write-combining helps |
| 10 | When is hybrid Radix + Insertion Sort better than pure Radix? | For sub-arrays of n < 24-32: Insertion Sort beats Radix due to lower constants and no allocation |

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Design a sort pipeline for 1 TB of int64 keys with 16 GB RAM | External Radix: one MSD partition pass (256 bucket files, 2N I/O) + in-memory radix per bucket. Total ~3-4N I/O |
| 2 | How does TeraSort work? | Sample → quantile boundaries → range-partition (each key → one of k partitions) → per-partition local sort (external radix) → concatenate |
| 3 | Why is GPU Radix Sort faster than CPU? | Thousands of threads for histogram + scatter; coalesced memory access; wide shared-memory buckets; no warp divergence (no comparisons) |
| 4 | What's the cache effect of choosing k = 256 vs k = 65536? | k=256 → 1 KB count table fits in L1. k=65536 → 256 KB exceeds L2, causes thrashing. Smaller k wins despite more passes |
| 5 | How do you handle skewed key distributions in distributed Radix? | Sample input first; range-partition by quantiles, not by hash. Re-sample if distribution shifts mid-job |
| 6 | What's "software write-combining" in Radix Sort? | Thread-local per-bucket buffers of 1 cache line; flush full lines to output; reduces scattered store traffic 2-3× |
| 7 | When would you NOT use Radix Sort in production? | Small arrays (<100); custom comparators; online incremental sort; variable-width data without preprocessing; memory-constrained |
| 8 | Compare Radix Sort I/O complexity to External Merge Sort | Both O((N/B)·log_{M/B}(N/B)). Radix wins constants when key width is fixed; Merge wins when comparator is custom |

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove LSD Radix Sort is correct | Induction on pass count: after pass j, array sorted by last j digits. Stable inner sort is critical for the inductive step |
| 2 | Prove Radix Sort beats the comparison lower bound | Comparison lower bound uses decision tree model. Radix uses cell-probe (digit-extract + index). Different model → different bound (Ω(n)) |
| 3 | Derive the I/O complexity for external Radix Sort | Two-phase: partition O(N/B), recurse log_{M/B}(N/M) levels → O((N/B)·log_{M/B}(N/B)) — matches external sort lower bound |
| 4 | What's the work-span complexity of parallel LSD Radix? | Work O(d·(n+k)); span O(d·log n). Achieves linear speedup up to p = n/log n processors |
| 5 | When does the Ω(n) lower bound for integer sort apply? | When keys are bounded-width and operations are word-RAM (not just comparisons). Radix achieves it for d, k constant |
| 6 | Why isn't Radix Sort cache-oblivious? | Requires choosing k based on cache size. Cache-oblivious analog (funnel sort) is comparison-based |

---

## Coding Challenge 1 — LSD Radix Sort from Scratch

> Implement LSD Radix Sort for non-negative integers. Must be stable. No library calls.

#### Go

```go
package main

import "fmt"

func RadixSort(arr []int) {
    if len(arr) <= 1 {
        return
    }
    maxVal := arr[0]
    for _, v := range arr {
        if v > maxVal {
            maxVal = v
        }
    }
    output := make([]int, len(arr))
    for exp := 1; maxVal/exp > 0; exp *= 10 {
        var count [10]int
        for _, v := range arr {
            count[(v/exp)%10]++
        }
        for i := 1; i < 10; i++ {
            count[i] += count[i-1]
        }
        for i := len(arr) - 1; i >= 0; i-- {
            d := (arr[i] / exp) % 10
            count[d]--
            output[count[d]] = arr[i]
        }
        copy(arr, output)
    }
}

func main() {
    data := []int{170, 45, 75, 90, 802, 24, 2, 66}
    RadixSort(data)
    fmt.Println(data) // [2 24 45 66 75 90 170 802]
}
```

#### Java

```java
import java.util.Arrays;

public class RadixSortChallenge {
    public static void sort(int[] arr) {
        if (arr.length <= 1) return;
        int max = arr[0];
        for (int v : arr) if (v > max) max = v;
        int[] output = new int[arr.length];
        for (int exp = 1; max / exp > 0; exp *= 10) {
            int[] count = new int[10];
            for (int v : arr) count[(v / exp) % 10]++;
            for (int i = 1; i < 10; i++) count[i] += count[i - 1];
            for (int i = arr.length - 1; i >= 0; i--) {
                int d = (arr[i] / exp) % 10;
                output[--count[d]] = arr[i];
            }
            System.arraycopy(output, 0, arr, 0, arr.length);
        }
    }

    public static void main(String[] args) {
        int[] data = {170, 45, 75, 90, 802, 24, 2, 66};
        sort(data);
        System.out.println(Arrays.toString(data));
    }
}
```

#### Python

```python
def radix_sort(arr):
    if len(arr) <= 1:
        return
    max_val = max(arr)
    output = [0] * len(arr)
    exp = 1
    while max_val // exp > 0:
        count = [0] * 10
        for v in arr:
            count[(v // exp) % 10] += 1
        for i in range(1, 10):
            count[i] += count[i - 1]
        for i in range(len(arr) - 1, -1, -1):
            d = (arr[i] // exp) % 10
            count[d] -= 1
            output[count[d]] = arr[i]
        arr[:] = output
        exp *= 10

if __name__ == "__main__":
    data = [170, 45, 75, 90, 802, 24, 2, 66]
    radix_sort(data)
    print(data)
```

---

## Coding Challenge 2 — Sort IPv4 Addresses

> Given a list of IPv4 addresses as strings like `"192.168.1.1"`, sort them in ascending order. Use Radix Sort.

**Hint:** Parse each IP into a `uint32` (`a.b.c.d` → `a<<24 | b<<16 | c<<8 | d`), radix-sort the integers, format back.

#### Go

```go
package main

import (
    "fmt"
    "strconv"
    "strings"
)

func IPToUint32(ip string) uint32 {
    parts := strings.Split(ip, ".")
    var v uint32
    for _, p := range parts {
        n, _ := strconv.Atoi(p)
        v = v<<8 | uint32(n)
    }
    return v
}

func Uint32ToIP(v uint32) string {
    return fmt.Sprintf("%d.%d.%d.%d",
        (v>>24)&0xFF, (v>>16)&0xFF, (v>>8)&0xFF, v&0xFF)
}

func RadixSortUint32(arr []uint32) {
    n := len(arr)
    if n <= 1 {
        return
    }
    buf := make([]uint32, n)
    for shift := uint(0); shift < 32; shift += 8 {
        var count [256]int
        for _, v := range arr {
            count[(v>>shift)&0xFF]++
        }
        sum := 0
        for i := 0; i < 256; i++ {
            count[i], sum = sum, sum+count[i]
        }
        for _, v := range arr {
            d := (v >> shift) & 0xFF
            buf[count[d]] = v
            count[d]++
        }
        copy(arr, buf)
    }
}

func SortIPs(ips []string) []string {
    nums := make([]uint32, len(ips))
    for i, ip := range ips {
        nums[i] = IPToUint32(ip)
    }
    RadixSortUint32(nums)
    out := make([]string, len(nums))
    for i, n := range nums {
        out[i] = Uint32ToIP(n)
    }
    return out
}

func main() {
    ips := []string{"192.168.1.1", "10.0.0.1", "172.16.0.5", "8.8.8.8", "192.168.1.10"}
    fmt.Println(SortIPs(ips))
}
```

#### Java

```java
import java.util.*;

public class SortIPs {
    static long ipToLong(String ip) {
        String[] p = ip.split("\\.");
        long v = 0;
        for (String s : p) v = (v << 8) | Long.parseLong(s);
        return v;
    }

    static String longToIp(long v) {
        return ((v >> 24) & 0xFF) + "." + ((v >> 16) & 0xFF) + "."
             + ((v >> 8) & 0xFF) + "." + (v & 0xFF);
    }

    static void radixSort(long[] arr) {
        int n = arr.length;
        long[] buf = new long[n];
        for (int shift = 0; shift < 32; shift += 8) {
            int[] count = new int[256];
            for (long v : arr) count[(int) ((v >> shift) & 0xFF)]++;
            int sum = 0;
            for (int i = 0; i < 256; i++) {
                int c = count[i]; count[i] = sum; sum += c;
            }
            for (long v : arr) {
                int d = (int) ((v >> shift) & 0xFF);
                buf[count[d]++] = v;
            }
            System.arraycopy(buf, 0, arr, 0, n);
        }
    }

    public static void main(String[] args) {
        String[] ips = {"192.168.1.1", "10.0.0.1", "172.16.0.5", "8.8.8.8", "192.168.1.10"};
        long[] nums = Arrays.stream(ips).mapToLong(SortIPs::ipToLong).toArray();
        radixSort(nums);
        Arrays.stream(nums).mapToObj(SortIPs::longToIp).forEach(System.out::println);
    }
}
```

#### Python

```python
def ip_to_int(ip):
    parts = ip.split(".")
    v = 0
    for p in parts:
        v = (v << 8) | int(p)
    return v

def int_to_ip(v):
    return f"{(v>>24)&0xFF}.{(v>>16)&0xFF}.{(v>>8)&0xFF}.{v&0xFF}"

def radix_sort_u32(arr):
    n = len(arr)
    buf = [0] * n
    for shift in (0, 8, 16, 24):
        count = [0] * 256
        for v in arr:
            count[(v >> shift) & 0xFF] += 1
        s = 0
        for i in range(256):
            count[i], s = s, s + count[i]
        for v in arr:
            d = (v >> shift) & 0xFF
            buf[count[d]] = v
            count[d] += 1
        arr[:] = buf

def sort_ips(ips):
    nums = [ip_to_int(ip) for ip in ips]
    radix_sort_u32(nums)
    return [int_to_ip(n) for n in nums]

if __name__ == "__main__":
    ips = ["192.168.1.1", "10.0.0.1", "172.16.0.5", "8.8.8.8", "192.168.1.10"]
    print(sort_ips(ips))
```

---

## Coding Challenge 3 — Sort Strings of Equal Length

> Given n strings all of length m over ASCII, sort them using LSD Radix Sort. Time should be O(n · m).

#### Python

```python
def lsd_string_sort(strings, m):
    """LSD radix sort for n strings of equal length m. O(n*m) time."""
    R = 256
    n = len(strings)
    aux = [None] * n
    for d in range(m - 1, -1, -1):
        count = [0] * (R + 1)
        for s in strings:
            count[ord(s[d]) + 1] += 1
        for r in range(R):
            count[r + 1] += count[r]
        for s in strings:
            c = ord(s[d])
            aux[count[c]] = s
            count[c] += 1
        strings[:] = aux

if __name__ == "__main__":
    words = ["dab", "add", "cab", "fad", "fee", "bad", "dad", "bee", "fed", "bed", "ebb", "ace"]
    lsd_string_sort(words, 3)
    print(words)
```

---

## Quick-Fire Conceptual Questions

1. **If `d = 1` and `k = n`, what algorithm does Radix Sort degenerate to?** Counting Sort.
2. **Can Radix Sort be done in-place?** Yes — American Flag Sort and PARADIS, but with more swaps and harder parallelization.
3. **What's the smallest input where Radix Sort beats Insertion Sort?** Empirically around n = 50-100, depending on key width.
4. **Why doesn't Python's `sorted()` use Radix?** Python uses TimSort for generality — it must handle arbitrary comparators, not just integers.
5. **How does `cub::DeviceRadixSort` differ from CPU Radix?** Thousands of threads in parallel, coalesced memory access, per-block histograms then global scan, ~10× faster than CPU.
6. **Is Radix Sort online or offline?** Offline — must see all keys before starting. Use a sorted structure (skip list, B-tree) for online.
7. **Can Radix Sort be made adaptive (faster on nearly-sorted input)?** Not naturally; TimSort and Pdqsort are adaptive instead.
8. **What's the difference between Radix Sort and Bucket Sort?** Bucket Sort distributes by value range into buckets (one pass), then sorts within. Radix Sort processes one digit at a time across multiple passes.
