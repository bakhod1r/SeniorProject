# Linear Search — Optimization Exercises

12 exercises that take the naive O(n) linear search and squeeze out performance through algorithmic, micro-architectural, or systems-level techniques. Each exercise is paired with a measurable benchmark target.

## Table of Contents

1. [Sentinel to Skip Bound Check](#1-sentinel-to-skip-bound-check)
2. [Early-Exit on Found](#2-early-exit-on-found)
3. [Parallel Search Across Chunks](#3-parallel-search-across-chunks)
4. [SIMD Vectorized Comparison](#4-simd-vectorized-comparison)
5. [Branch-Free Comparison](#5-branch-free-comparison)
6. [Cache-Line Aware Iteration](#6-cache-line-aware-iteration)
7. [Bloom Filter Pre-Check for Rare Values](#7-bloom-filter-pre-check-for-rare-values)
8. [Use the Language Built-In](#8-use-the-language-built-in)
9. [Jump Search (sqrt(n) Hybrid)](#9-jump-search-sqrtn-hybrid)
10. [Self-Organizing List (Move-to-Front)](#10-self-organizing-list-move-to-front)
11. [Switch to Binary Search if Sorted](#11-switch-to-binary-search-if-sorted)
12. [Aho-Corasick for Multi-Pattern Search](#12-aho-corasick-for-multi-pattern-search)
13. [Summary Table](#summary-table)

---

## 1. Sentinel to Skip Bound Check

### Naive
```python
def search(arr, target):
    i = 0
    while i < len(arr) and arr[i] != target:   # ← two comparisons per iter
        i += 1
    return i if i < len(arr) else -1
```

### Optimized
```python
def sentinel_search(arr, target):
    n = len(arr)
    if n == 0: return -1
    last = arr[n-1]
    arr[n-1] = target          # place sentinel
    i = 0
    while arr[i] != target:    # ← one comparison per iter
        i += 1
    arr[n-1] = last            # restore
    if i < n - 1 or last == target:
        return i
    return -1
```

### Speedup Target
~5-15% on tight integer loops. Larger savings in environments with bad branch prediction.

### Caveat
Mutates the array temporarily. Not thread-safe without locking. Modern CPUs already make the bounds check cheap; this technique is more impactful in embedded / DSP code.

---

## 2. Early-Exit on Found

### Naive
```python
def search(arr, target):
    found = -1
    for i, v in enumerate(arr):
        if v == target:
            found = i           # ← keeps scanning
    return found
```

### Optimized
```python
def search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i            # ← stop now
    return -1
```

### Speedup Target
~2× on average (n/2 vs n comparisons). Dramatic for cases where target is near the front.

### Caveat
Only correct if you want the **first** match. For "find all," you must scan to the end.

---

## 3. Parallel Search Across Chunks

### Naive
Single-threaded scan of `n` elements.

### Optimized — Go
```go
import (
    "context"
    "sync"
    "sync/atomic"
)

func ParallelSearch(arr []int, target int, workers int) int {
    n := len(arr)
    var found atomic.Int64
    found.Store(-1)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    var wg sync.WaitGroup
    chunk := (n + workers - 1) / workers
    for w := 0; w < workers; w++ {
        wg.Add(1)
        start := w * chunk
        end := start + chunk
        if end > n { end = n }
        go func(lo, hi int) {
            defer wg.Done()
            for i := lo; i < hi; i++ {
                select {
                case <-ctx.Done(): return
                default:
                }
                if arr[i] == target {
                    for {
                        cur := found.Load()
                        if cur != -1 && cur < int64(i) { return }
                        if found.CompareAndSwap(cur, int64(i)) {
                            cancel()
                            return
                        }
                    }
                }
            }
        }(start, end)
    }
    wg.Wait()
    return int(found.Load())
}
```

### Speedup Target
~`workers`× up to memory bandwidth saturation (typically 4-8× for `int32` arrays).

### Caveat
Worth it only when `n` × per-element cost > thread spawn cost (~tens of microseconds). For small arrays, parallel is **slower** than serial.

---

## 4. SIMD Vectorized Comparison

### Naive
Scalar one-element-at-a-time compare.

### Optimized — Go (using `bytes.IndexByte` for byte-array case)
```go
import "bytes"

// Built-in: hand-tuned assembly using AVX2/SSE on x86, NEON on ARM.
idx := bytes.IndexByte(haystack, byte('x'))
```

### Optimized — C with AVX2 intrinsics
```c
#include <immintrin.h>

int simd_search_int32(const int32_t* arr, size_t n, int32_t target) {
    __m256i tgt = _mm256_set1_epi32(target);
    size_t i = 0;
    for (; i + 8 <= n; i += 8) {
        __m256i v   = _mm256_loadu_si256((const __m256i*)(arr + i));
        __m256i cmp = _mm256_cmpeq_epi32(v, tgt);
        int     m   = _mm256_movemask_epi8(cmp);
        if (m) return (int)i + __builtin_ctz(m) / 4;
    }
    for (; i < n; i++) if (arr[i] == target) return (int)i;
    return -1;
}
```

### Optimized — Python (NumPy)
```python
import numpy as np

def numpy_search(arr_np, target):
    matches = np.where(arr_np == target)[0]
    return int(matches[0]) if len(matches) else -1
```

### Speedup Target
4-8× on x86 with AVX2; 8-16× with AVX-512. NumPy's vectorization gives Python ~50× speedup over pure-Python loops.

### Caveat
Always falls back to scalar tail loop. Alignment matters. Auto-vectorization by compilers is unreliable for anything beyond simple loops.

---

## 5. Branch-Free Comparison

### Naive (branchy)
```c
for (size_t i = 0; i < n; i++) {
    if (arr[i] == target) return (int)i;   // ← unpredictable branch when target is rare
}
return -1;
```

### Optimized (branch-free)
```c
int branchless_search(const int* arr, size_t n, int target) {
    int found = -1;
    for (size_t i = 0; i < n; i++) {
        int eq = (arr[i] == target);   // 0 or 1
        // If eq, set found to i (only the first time, due to ternary).
        found = (found == -1 && eq) ? (int)i : found;
    }
    return found;
}
```

### Speedup Target
**Slower** in average case (always scans the whole array), but **constant-time** — useful for cryptographic comparison where timing leaks are unacceptable.

### Caveat
Don't use for general-purpose search. Use only when timing-channel resistance is required (password verification, MAC validation).

---

## 6. Cache-Line Aware Iteration

### Naive (Array-of-Structs)
```c
typedef struct { char name[60]; int age; int id; } Person;  // 68 bytes, padded to 72 typically.
Person people[N];

int find_age(Person* p, size_t n, int target) {
    for (size_t i = 0; i < n; i++) {
        if (p[i].age == target) return (int)i;
    }
    return -1;
}
// Each iteration touches 64-72 bytes, only 4 of which (age) are needed.
// 1 cache line per element — bandwidth-bound.
```

### Optimized (Struct-of-Arrays)
```c
struct PeopleSoA {
    char (*names)[60];   // separate
    int* ages;           // contiguous → 16 ages per cache line
    int* ids;
};

int find_age_soa(struct PeopleSoA* p, size_t n, int target) {
    for (size_t i = 0; i < n; i++) {
        if (p->ages[i] == target) return (int)i;
    }
    return -1;
}
// 16 elements per cache line → 16× more cache-efficient.
```

### Speedup Target
4-16× depending on struct size and hot-field ratio. Key insight behind ECS architectures in game engines.

### Caveat
SoA layout is more complex to maintain (parallel arrays must stay in sync). Tradeoff against code clarity and locality of related fields.

---

## 7. Bloom Filter Pre-Check for Rare Values

### Naive
```python
def search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
```

If `target` is **rarely present** (say, 1% of queries find a match), 99% of queries scan the whole array fruitlessly.

### Optimized
```python
class BloomFilteredArray:
    def __init__(self, arr, m_bits=10000, k_hashes=7):
        self.arr = arr
        self.bits = bytearray(m_bits // 8)
        self.k = k_hashes
        for v in arr:
            for h in self._hashes(v):
                self.bits[h // 8] |= (1 << (h % 8))

    def _hashes(self, v):
        # In real code, use mmh3 or xxhash with k different seeds.
        import hashlib
        for i in range(self.k):
            h = int(hashlib.md5(f"{i}-{v}".encode()).hexdigest(), 16)
            yield h % (len(self.bits) * 8)

    def search(self, target):
        for h in self._hashes(target):
            if not (self.bits[h // 8] & (1 << (h % 8))):
                return -1   # definitely absent
        # Possibly present — fall back to linear scan
        for i, v in enumerate(self.arr):
            if v == target:
                return i
        return -1   # false positive from Bloom
```

### Speedup Target
~10-100× when miss rate is high (most queries return -1 in O(k) instead of O(n)).

### Caveat
- One-time O(n) build cost.
- Extra O(m) memory.
- Not worth it if hits are common (you'd scan anyway).
- Bloom filter requires updating when array changes.

---

## 8. Use the Language Built-In

### Naive
```python
def my_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
```

### Optimized
```python
try:
    idx = arr.index(target)   # implemented in C
except ValueError:
    idx = -1
```

```go
import "slices"
idx := slices.Index(arr, target)   // SIMD-tuned for many types
```

```java
int idx = list.indexOf(target);
```

### Speedup Target
~50× in Python (avoids the interpreter loop), ~2-8× in Go/Java (uses SIMD for byte arrays).

### Caveat
You lose flexibility: built-ins use `==` / `equals`. For custom predicates, you still hand-roll.

---

## 9. Jump Search (sqrt(n) Hybrid)

### Naive
Linear scan: O(n).

### Optimized (only on **sorted** arrays)
```python
import math

def jump_search(arr, target):
    n = len(arr)
    step = int(math.sqrt(n))
    prev = 0
    while prev < n and arr[min(step, n) - 1] < target:
        prev = step
        step += int(math.sqrt(n))
        if prev >= n:
            return -1
    # Linear scan within the block
    while prev < min(step, n) and arr[prev] < target:
        prev += 1
    if prev < n and arr[prev] == target:
        return prev
    return -1
```

### Speedup Target
O(√n) — much better than linear's O(n), worse than binary's O(log n).

### When It Wins
- Cache-friendly: large jumps make better use of prefetching than binary search's bisecting jumps.
- Useful on sorted data where reading is much cheaper than seeking (e.g., on disk or tape).
- Practical on huge sorted arrays where binary search's pointer-jumping kills the cache.

### Caveat
Requires sorted data. Almost always beaten by binary search in RAM-resident scenarios. Mostly a curiosity; **interpolation search** (O(log log n) on uniform data) is more useful.

---

## 10. Self-Organizing List (Move-to-Front)

### Naive
```python
arr = [...]   # static order

def search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
```

### Optimized
```python
class MTFList:
    def __init__(self, items):
        self.items = list(items)

    def search(self, target):
        for i, v in enumerate(self.items):
            if v == target:
                # Move to front
                self.items.pop(i)
                self.items.insert(0, target)
                return 0
        return -1
```

### Speedup Target
- Uniform access: no improvement.
- Zipf-distributed access (top 20% of keys = 80% of queries): up to 5× speedup.
- Hot-key access (one key dominates): converges to O(1) after warmup.

### Caveat
- Mutation breaks thread safety without locking.
- Adversarial workloads can trigger constant rearrangement (worst case O(n²)).
- Counter-intuitive contract: search has side effects.

---

## 11. Switch to Binary Search if Sorted

### Naive
```python
sorted_arr = [...]   # static, sorted

def linear(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
```

### Optimized
```python
import bisect

def binary(arr, target):
    i = bisect.bisect_left(arr, target)
    if i < len(arr) and arr[i] == target:
        return i
    return -1
```

### Speedup Target
- n = 1,000: 100× faster.
- n = 1,000,000: 50,000× faster.

### When It Doesn't Apply
- Array isn't sorted (sorting first costs O(n log n) — only worthwhile for many queries).
- Array is small (n < ~32) — linear's cache friendliness wins.
- Predicate isn't equality (binary search needs an ordering).

### Sorted-Array Maintenance
If the array changes frequently, keeping it sorted costs O(n) per insert. If reads dominate, sort once and binary-search. If writes dominate, switch to a balanced BST or skip list (O(log n) inserts).

---

## 12. Aho-Corasick for Multi-Pattern Search

### Naive
```python
def find_any(text, patterns):
    for p in patterns:
        idx = text.find(p)
        if idx != -1:
            return (p, idx)
    return None
# Cost: O(|text| × |patterns|)
```

### Optimized
```python
import ahocorasick   # pip install pyahocorasick

def build_ac(patterns):
    ac = ahocorasick.Automaton()
    for p in patterns:
        ac.add_word(p, p)
    ac.make_automaton()
    return ac

def find_any_ac(text, ac):
    for end_idx, pattern in ac.iter(text):
        return (pattern, end_idx - len(pattern) + 1)
    return None
# Cost: O(|text| + sum(|patterns|) + matches), one pass through text.
```

### Speedup Target
~`|patterns|`× — finding 100 patterns in a 1 MB text drops from 100 ms to 1 ms.

### Use Cases
- IDS / IPS: scan packets for thousands of attack signatures.
- Spam filters: match against millions of known phrases.
- Lexers: tokenize source code with hundreds of keywords.
- Bioinformatics: search DNA for many gene sequences.

### Caveat
- Building the automaton is O(sum of pattern lengths).
- Memory grows with patterns + alphabet.
- Overkill for 1-2 patterns — use Boyer-Moore or built-in `find`.

---

## Summary Table

| # | Technique | Wins When | Speedup | Complexity Cost |
|---|-----------|-----------|---------|-----------------|
| 1 | Sentinel | Tight integer loops, mutable buffer | 5-15% | Mutates array, low |
| 2 | Early exit | Always (for "find first") | Up to 2× | None |
| 3 | Parallel | Large n, multi-core | Up to `p`× | Coordination, threads |
| 4 | SIMD | Hot loops, primitive types | 4-16× | Platform-specific |
| 5 | Branch-free | Crypto / constant-time required | **Slower** | Always full scan |
| 6 | SoA layout | Single-field search on big structs | 4-16× | Refactor data layout |
| 7 | Bloom filter | High miss rate | 10-100× | O(n) build, extra mem |
| 8 | Built-in | General use | 2-50× | None |
| 9 | Jump search | Huge sorted arrays, slow seeks | √n / n | Requires sorted |
| 10 | MTF | Skewed access pattern | Up to N× | Mutation, side effects |
| 11 | Binary search | Sorted, frequent queries | log n / n | Requires sorted |
| 12 | Aho-Corasick | Multi-pattern search | `|patterns|`× | Build cost, memory |

### Decision Flowchart

```
Need to find target in collection
        │
        ├─ n < 32 ?
        │     └─ YES → naive linear search (cache wins)
        │
        ├─ Is data sorted?
        │     └─ YES → binary search (#11)
        │
        ├─ Repeated queries on same data?
        │     └─ YES → build hash set / index (one-time O(n) cost)
        │
        ├─ Multiple patterns to find at once?
        │     └─ YES → Aho-Corasick (#12)
        │
        ├─ Most queries miss (target absent)?
        │     └─ YES → Bloom filter pre-check (#7)
        │
        ├─ Hot loop, primitives, room for SIMD?
        │     └─ YES → SIMD (#4) or use built-in (#8)
        │
        ├─ Multi-core idle and n very large?
        │     └─ YES → parallel (#3)
        │
        └─ Otherwise → naive linear with early-exit (#2)
```

The takeaway: **most "linear search optimizations" are really just choosing a different algorithm.** Pure linear search optimization (sentinel, SIMD, parallel) gets you constant-factor speedups. Algorithmic switches (binary, hash, Aho-Corasick) get you asymptotic improvements. Always profile first; then choose the smallest hammer that solves your problem.
