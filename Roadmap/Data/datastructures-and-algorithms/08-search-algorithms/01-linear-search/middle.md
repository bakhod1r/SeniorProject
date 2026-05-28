# Linear Search — Middle Level

## Table of Contents

1. [Overview](#overview)
2. [Sentinel Linear Search](#sentinel-linear-search)
3. [Bidirectional Linear Search](#bidirectional-linear-search)
4. [Linear vs Binary Search](#linear-vs-binary-search)
5. [When Linear Beats Binary](#when-linear-beats-binary)
6. [Parallel Linear Search](#parallel-linear-search)
7. [SIMD / Vectorized Linear Search](#simd-vectorized-linear-search)
8. [Self-Organizing Linear Search](#self-organizing-linear-search)
9. [Comparison Reduction Tricks](#comparison-reduction-tricks)
10. [Summary](#summary)

---

## Overview

Junior level introduced the canonical 5-line linear search. Middle level covers the **engineering refinements** that make it competitive — and sometimes faster than logarithmic alternatives — in real systems. Topics here:

- **Sentinel search** — eliminate one branch per iteration.
- **Bidirectional search** — halve the average comparisons.
- **Linear vs binary** — when each wins.
- **Parallel** — split across CPU cores.
- **SIMD** — compare 8 / 16 / 32 elements per CPU cycle.
- **Self-organizing** — adapt to access patterns.

If junior was "make it work," middle is "make it fast on the actual hardware you're deploying to."

---

## Sentinel Linear Search

### The Idea

A standard linear search has **two checks** per iteration of the inner loop:

```text
while i < n AND arr[i] != target:
    i++
```

The `i < n` check is a **bounds check** — protection against running off the end of the array. It must be re-evaluated every iteration, even though it's only `True` once (at the very end).

**Sentinel trick**: place a copy of the target at `arr[n]` (one past the end). Now the loop is **guaranteed** to terminate when it hits that copy. You can drop the bounds check:

```text
arr[n] = target   # sentinel
i = 0
while arr[i] != target:
    i++
# i is either the real index, or i == n meaning "not found"
```

The inner loop now has **one** comparison per iteration instead of **two**. CPUs love single-condition loops because they predict the branch better and can unroll more aggressively.

### Implementation (Go)

```go
// SentinelSearch requires the caller to provide capacity for one extra element.
// The arr slice is mutated temporarily but restored.
func SentinelSearch(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    // Save the last element, write target as sentinel.
    last := arr[n-1]
    arr[n-1] = target

    i := 0
    for arr[i] != target {
        i++
    }

    // Restore.
    arr[n-1] = last

    if i < n-1 || last == target {
        return i
    }
    return -1
}
```

Note: a **defensive** version makes a copy, but that defeats the point. In practice, sentinel search is used on buffers you own and have pre-sized with a slot for the sentinel.

### When Sentinel Helps

Modern CPUs have great branch predictors and out-of-order execution. The savings from removing one comparison per iteration are typically **5-15%** on cold caches, and even less on hot caches. The technique was a **big win** on early CPUs (1980s) where every cycle counted.

It still helps when:
- Comparison is cheap (integers).
- Loop body is otherwise empty (no I/O, no function call).
- You're searching very large arrays in tight loops.

It does **not** help when:
- Comparison is expensive (object equality, string equality).
- Array is small (loop overhead dominates).
- You can't safely modify the array.

---

## Bidirectional Linear Search

### The Idea

Search from **both ends** simultaneously. Two pointers, `lo` advancing forward, `hi` advancing backward. Stop when either finds the target, or they cross.

```text
arr = [a, b, c, d, e, f, g]
       lo →            ← hi
```

If the target is uniformly distributed, the average distance to a match is `n/4` from each end (vs `n/2` from one end). **Average comparisons drop by half.**

### Implementation (Python)

```python
def bidirectional_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        if arr[lo] == target:
            return lo
        if arr[hi] == target:
            return hi
        lo += 1
        hi -= 1
    return -1
```

### Caveats

1. **Two comparisons per iteration** — so you do twice the work per step but cover twice the ground. Net: same total comparisons in the worst case.
2. **Returns the lower-index match** when both ends find a match in the same iteration — make sure that's the contract you want.
3. **Cache effects**: scanning from both ends touches **two** cache lines per iteration instead of one. May actually be **slower** on long arrays due to prefetcher confusion.
4. **Better used when**: data is small enough to fit in L1, and you genuinely don't know which half the target is in.

In practice, bidirectional search is more of an **academic trick** than a production win. The cache penalty often outweighs the comparison savings.

---

## Linear vs Binary Search

| Property | Linear | Binary |
|----------|--------|--------|
| Time | O(n) | O(log n) |
| Space | O(1) | O(1) iterative, O(log n) recursive |
| Requires sorted? | No | Yes |
| Random access? | No (works on linked list) | Yes (needs `arr[mid]`) |
| Cache-friendly? | Excellent (sequential) | Moderate (jumps around) |
| Branch prediction? | Excellent | Poor (mid is data-dependent) |
| Overhead per step | 1 comparison | 1 comparison + arithmetic + jump |
| Code complexity | Trivial | Easy to get wrong (off-by-one, infinite loop) |

**Common misconception:** "Binary search is always faster." False — only **asymptotically**, and only on **large** arrays. For small `n`, the constant-factor cost of binary search (mid calculation, three-way compare, unpredictable branches) often loses to a tight linear scan.

---

## When Linear Beats Binary

Empirical benchmarks show linear search **wins** for `n ≤ ~16-32` on most modern x86_64 hardware. Reasons:

1. **Cache prefetching.** Linear access is the easiest pattern for the hardware prefetcher to recognize. Binary search's jump pattern can defeat the prefetcher.

2. **Branch prediction.** In a linear search where the target is rare, the "not equal" branch is taken nearly every iteration → near-perfect prediction. In binary search, the "go left vs go right" branch is data-dependent and effectively a coin flip → ~50% misprediction rate.

3. **SIMD vectorization.** Modern CPUs can compare 8 (AVX-256), 16 (AVX-512), or 32 (AVX-512 with byte ops) elements per instruction. A 32-element array is **one SIMD instruction**; binary search would need ~5 sequential comparisons.

4. **Loop unrolling.** Compilers aggressively unroll small linear loops. Binary search's recursive/iterative structure is harder to unroll.

5. **No mid calculation.** Each binary-search step does `(lo + hi) / 2` (or `lo + (hi - lo) / 2` to avoid overflow). Linear search just does `i++`.

### Concrete Crossover

Approximate crossovers on Intel Xeon (single thread, `int32` array, hot L1):

| Array size | Faster |
|------------|--------|
| n = 4 | Linear (5× faster) |
| n = 16 | Linear (2× faster) |
| n = 32 | Linear (~1.3× faster) |
| n = 64 | Binary (~1.5× faster) |
| n = 256 | Binary (~3× faster) |
| n = 1024 | Binary (~6× faster) |
| n = 1M | Binary (~30× faster) |

This is why hybrid sorts (TimSort, Pdqsort) drop into linear search for runs ≤ 32 — and why `std::lower_bound` in some libc++ implementations switches to linear scan below a threshold.

---

## Parallel Linear Search

### The Idea

Split the array into `p` chunks, search each chunk in parallel on `p` threads. First thread to find the target signals all others to stop.

```text
arr  = [_______ chunk 0 _______][_______ chunk 1 _______][_______ chunk 2 _______][_______ chunk 3 _______]
       thread 0                  thread 1                  thread 2                  thread 3
```

**Theoretical speedup:** O(n/p). With 8 threads, an O(n) search becomes O(n/8) — an 8× speedup in the worst case.

### Implementation Sketch (Go)

```go
import (
    "context"
    "sync"
)

func ParallelSearch(arr []int, target int, workers int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    chunkSize := (n + workers - 1) / workers

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    var (
        result = -1
        mu     sync.Mutex
        wg     sync.WaitGroup
    )

    for w := 0; w < workers; w++ {
        start := w * chunkSize
        end := start + chunkSize
        if end > n {
            end = n
        }
        wg.Add(1)
        go func(lo, hi int) {
            defer wg.Done()
            for i := lo; i < hi; i++ {
                select {
                case <-ctx.Done():
                    return
                default:
                }
                if arr[i] == target {
                    mu.Lock()
                    if result == -1 || i < result {
                        result = i
                    }
                    mu.Unlock()
                    cancel()
                    return
                }
            }
        }(start, end)
    }
    wg.Wait()
    return result
}
```

### When Parallel Wins

Worth it when:
- `n` is **very large** (millions of elements).
- The work per comparison is non-trivial.
- You have idle cores.

**Not worth it** for small `n` — thread creation overhead (microseconds) dwarfs the search cost (nanoseconds). Rule of thumb: only parallelize when serial search exceeds ~100 µs.

### First-Match Semantics

If you want the **leftmost** occurrence (the standard contract), workers must coordinate. The parallel version above returns "any match," then takes the minimum. If you genuinely need "first match always wins," each worker can early-exit if its lower bound exceeds the current best result.

---

## SIMD / Vectorized Linear Search

### The Idea

Modern CPUs have **vector instructions** that operate on multiple elements in one cycle. SSE2 (128-bit) handles 4 × int32. AVX2 (256-bit) handles 8 × int32. AVX-512 handles 16 × int32.

Instead of:

```text
for i in 0..n:
    if arr[i] == target: return i
```

Do:

```text
for i in 0..n step 8:
    vec = load 8 elements from arr[i..i+8]
    mask = compare vec == broadcast(target)
    if mask != 0:
        position = trailing zeros of mask
        return i + position
```

One **SIMD compare instruction** does 8 element comparisons. One **mask test** decides whether any matched. One **trailing-zero count** finds the position within the vector.

### Implementation (Go with `unsafe`/intrinsics-style — illustrative)

Go's standard library uses SIMD internally for `bytes.IndexByte` and `slices.Index` (since 1.21). You normally don't need to write SIMD by hand.

```go
// Conceptual pseudocode — actual SIMD is via assembly or compiler intrinsics.
import "github.com/klauspost/cpuid/v2"

func SIMDSearch(arr []int32, target int32) int {
    if cpuid.CPU.Supports(cpuid.AVX2) {
        // Use AVX2 path: 8 × int32 per instruction.
        return simdSearchAVX2(arr, target)
    }
    // Fallback.
    for i, v := range arr {
        if v == target { return i }
    }
    return -1
}
```

In **C with intrinsics**:

```c
#include <immintrin.h>

int simd_search(const int32_t* arr, size_t n, int32_t target) {
    __m256i tgt = _mm256_set1_epi32(target);
    size_t i = 0;
    for (; i + 8 <= n; i += 8) {
        __m256i v = _mm256_loadu_si256((const __m256i*)(arr + i));
        __m256i cmp = _mm256_cmpeq_epi32(v, tgt);
        int mask = _mm256_movemask_epi8(cmp);
        if (mask != 0) {
            // Find the byte position of the first set bit, divide by 4
            // (since each int32 occupies 4 bytes in the mask).
            return i + __builtin_ctz(mask) / 4;
        }
    }
    // Tail: handle remaining elements with scalar loop.
    for (; i < n; i++) {
        if (arr[i] == target) return (int)i;
    }
    return -1;
}
```

### Speedup

On L1-resident data, SIMD linear search is typically **4-8× faster** than scalar — the speedup roughly equals the SIMD width.

### Caveats

1. **Alignment matters.** Unaligned loads cost a cycle or two extra. Aligned loads are fastest.
2. **Tail handling.** The vector loop processes 8 (or 16) elements at a time. The remaining elements (n mod 8) need a scalar loop.
3. **Element type must match SIMD width.** SIMD on `int32` is straightforward; SIMD on heterogeneous structs requires gather instructions or restructuring.
4. **The first match within a vector** requires a `tzcnt` (trailing zero count) on the mask. Cheap on modern x86.
5. **Auto-vectorization is unreliable.** Compilers vectorize simple loops, but anything non-trivial (early exit, function calls inside the loop) often defeats them. For guaranteed SIMD, use intrinsics or assembly.

---

## Self-Organizing Linear Search

### The Idea

If certain values are queried more frequently, **move them toward the front** so future searches find them sooner. Classic strategies:

1. **Move-to-Front (MTF):** On each successful search, move the found element to position 0.
2. **Transpose:** On each success, swap with the previous element. Slower to adapt but more stable.
3. **Frequency Count:** Keep a count per element; sort by count periodically.

### Implementation (Move-to-Front)

```python
class SelfOrgList:
    def __init__(self, items):
        self.items = list(items)

    def search(self, target):
        for i, v in enumerate(self.items):
            if v == target:
                # Move to front
                self.items.insert(0, self.items.pop(i))
                return 0   # now at index 0
        return -1
```

### Use Cases

- **LRU caches** (move accessed item to head — same idea).
- **Dictionary attack defense** in password hashing (constant-time compare to mitigate the timing leak this would otherwise create).
- **Compression dictionaries** (LZ77, MTF transform in Burrows-Wheeler).

### Trade-Offs

- Wins when access pattern is **highly skewed** (Zipf distribution).
- Loses when access pattern is uniform — the moves cost more than they save.
- **Mutates the array** — not thread-safe without locks.

---

## Comparison Reduction Tricks

### Trick 1: Loop Unrolling

Process 4 (or 8) elements per iteration. Reduces loop overhead by `4×`.

```go
for i := 0; i+4 <= n; i += 4 {
    if arr[i+0] == target { return i + 0 }
    if arr[i+1] == target { return i + 1 }
    if arr[i+2] == target { return i + 2 }
    if arr[i+3] == target { return i + 3 }
}
for ; i < n; i++ { ... }   // tail
```

Modern compilers do this automatically with `-O2` or higher.

### Trick 2: Branch-Free Comparison

Instead of `if (arr[i] == target) return i`, accumulate matches into a bitmask. Useful in cryptographic constant-time code where branch behavior must not leak information about the target.

```c
int found = -1;
for (size_t i = 0; i < n; i++) {
    int eq = (arr[i] == target);
    found |= -eq & ((int)i + 1);   // sets found = i+1 on match
}
return found - 1;  // -1 if never matched
```

This always scans the whole array, so it's slower in the average case — but it's **constant-time**, which matters for security.

### Trick 3: Skip Lists / Jump Search

For sorted data, **jump search** combines linear and binary ideas: jump in steps of √n, then linear-scan within the block. O(√n) — between linear and binary.

---

## Summary

| Variant | When to Use | Speedup vs Naive |
|---------|------------|------------------|
| Sentinel | Tight inner loop, can mutate buffer | 5-15% |
| Bidirectional | Tiny arrays, target distribution unknown | ~2× best, ~1× worst |
| Parallel | Very large `n`, many cores | Up to `p×` |
| SIMD | Hot loop on `int32`/`int64`/`byte` arrays | 4-16× |
| Self-organizing | Skewed access pattern | Up to N× on hot keys |
| Loop unrolled | Cold-cache scan, simple comparisons | 1.5-2× |
| Branch-free | Crypto / constant-time required | Slower (correctness) |

Linear search is **not** a single algorithm — it's a family of techniques tuned to specific hardware and workload patterns. In production, you'll almost always use the language built-in (which uses SIMD under the hood). In contest code or interviews, you'll write the basic version. In systems work, you'll occasionally hand-tune one of the variants above.

Continue to [`senior.md`](./senior.md) for production usage and to [`professional.md`](./professional.md) for the formal analysis.
