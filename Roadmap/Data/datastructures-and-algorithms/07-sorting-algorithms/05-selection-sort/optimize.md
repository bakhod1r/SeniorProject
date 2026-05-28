# Selection Sort — Optimize

> 12 optimization exercises with before/after code in Go, Java, and Python. Selection Sort is **always O(n²)** in comparisons (the standard variant has no best-case improvement), but you can still tune writes, cache behavior, branch prediction, and parallelism.

---

## 1. Skip Self-Swap (Save Writes on Flash / EEPROM)

### Before (Python)
```python
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]   # always swaps
    return arr
```

### After
```python
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        if min_idx != i:                              # guard
            arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr
```
**Win:** Up to `n-1` skipped swaps on already-sorted input. Negligible for RAM, but for **flash-backed arrays** (e.g., embedded EEPROM with 100k erase cycles per page) this is the difference between days and years of device lifetime. Selection Sort's tagline — "minimum writes among standard sorts" — only holds with this guard.

---

## 2. Bidirectional Selection Sort (Find Min and Max in One Pass)

### Before
```python
for i in range(n - 1):
    min_idx = i
    for j in range(i + 1, n):
        if arr[j] < arr[min_idx]:
            min_idx = j
    arr[i], arr[min_idx] = arr[min_idx], arr[i]
```

### After (Go)
```go
func BidirectionalSelectionSort(a []int) {
    lo, hi := 0, len(a)-1
    for lo < hi {
        minIdx, maxIdx := lo, lo
        for j := lo; j <= hi; j++ {
            if a[j] < a[minIdx] { minIdx = j }
            if a[j] > a[maxIdx] { maxIdx = j }
        }
        // place min at lo
        if minIdx != lo {
            a[lo], a[minIdx] = a[minIdx], a[lo]
            if maxIdx == lo { maxIdx = minIdx }   // fix tracker after swap
        }
        // place max at hi
        if maxIdx != hi {
            a[hi], a[maxIdx] = a[maxIdx], a[hi]
        }
        lo++; hi--
    }
}
```
**Win:** Halves the number of outer passes from `n-1` to `n/2`. Comparisons stay at `~n²/2` (each j is checked against both min and max), but **branch density per cache line doubles**, so the CPU front-end is better fed. Real benchmarks show ~25–40% speedup on randomized integer arrays of size 1k–100k.

---

## 3. Early Exit If Already Sorted

### Before
Standard Selection Sort runs `n-1` full passes regardless of input.

### After (Java)
```java
public static void selectionSortEarlyExit(int[] a) {
    for (int i = 0; i < a.length - 1; i++) {
        int minIdx = i;
        boolean inOrder = true;
        for (int j = i + 1; j < a.length; j++) {
            if (a[j] < a[minIdx]) minIdx = j;
            if (j > i + 1 && a[j] < a[j - 1]) inOrder = false;
        }
        if (minIdx != i) a[i] = swap(a, i, minIdx);
        if (inOrder && minIdx == i) return;     // suffix is sorted; nothing left to do
    }
}
```
**Win (and caveat):** This is **not** a true Selection Sort optimization — Selection Sort by definition has no best case. Adding sortedness detection costs an extra branch per inner iteration. Worth it only if (a) you frequently sort almost-sorted data and (b) you cannot switch to Insertion Sort (which is naturally adaptive). For random input the extra branch is **a small loss**.

> **Honest verdict:** in 95% of cases, if you want adaptivity, use Insertion Sort instead.

---

## 4. Recursive vs Iterative (Why Iteration Wins)

### Before — Recursive (Python)
```python
def selection_sort_rec(arr, start=0):
    if start >= len(arr) - 1: return
    min_idx = start
    for j in range(start + 1, len(arr)):
        if arr[j] < arr[min_idx]: min_idx = j
    if min_idx != start:
        arr[start], arr[min_idx] = arr[min_idx], arr[start]
    selection_sort_rec(arr, start + 1)
```

### After — Iterative
```python
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]: min_idx = j
        if min_idx != i:
            arr[i], arr[min_idx] = arr[min_idx], arr[i]
```
**Win:** Iterative is faster (no frame setup, better register allocation) and safe for any `n`. Recursive Selection Sort hits `RecursionError` at `n > 1000` in CPython (default limit) and risks stack overflow in JVM/Go for large arrays. Recursion adds **zero algorithmic value** here — there's no divide-and-conquer; the recursive call simply replaces a `for` loop with a frame. Use iteration always.

---

## 5. Stable Variant Trade-offs (Shifting vs Swapping)

### Before — Unstable (standard, n-1 swaps)
```python
arr[i], arr[min_idx] = arr[min_idx], arr[i]
```

### After — Stable (shift; O(n²) writes)
```python
v = arr[min_idx]
arr[i+1:min_idx+1] = arr[i:min_idx]   # shift block one right
arr[i] = v
```
**Win/Loss:**
- ✓ Stable: equal keys preserve input order
- ✗ Writes go from `~n` to `~n²/2` — **destroys the only reason to use Selection Sort**

**Recommendation:** if you need a stable O(n²) sort, use **Insertion Sort** (also stable, also O(n²), but adaptive — runs in O(n) on nearly-sorted input). The "stable Selection Sort" pattern is almost never the right answer; it appears in exam questions, not production.

---

## 6. Cache-Friendly Linear Scan

### Before (struct-of-arrays misuse)
```go
type Record struct {
    Key   int
    Blob  [1024]byte   // huge payload
}
records := make([]Record, 100_000)
// SelectionSort over records → each comparison touches 1 KB
```

### After (sort indirect via key array)
```go
keys := make([]int, len(records))
for i, r := range records { keys[i] = r.Key }
indices := make([]int, len(records))
for i := range indices { indices[i] = i }
// Selection Sort on `keys` — touches 8 bytes per element
selectionSortByKey(keys, indices)
// Optionally permute records once at the end (n-1 swaps of large structs)
permute(records, indices)
```
**Win:** Comparisons hit a hot `keys` array (~800 KB for 100k records, fits in L2 of modern CPUs). The original sorted 100 MB of payload directly — every `arr[j] < arr[min_idx]` was a cache miss. Speedup on real workloads: 5–20×.

> Lesson: Selection Sort's `n²` comparisons are **comparison-bound**, so the cost of one comparison dominates. Make comparisons cheap and cache-resident.

---

## 7. Branch-Prediction-Friendly Min Tracking

### Before
```python
for j in range(i + 1, n):
    if arr[j] < arr[min_idx]:
        min_idx = j
```
On random data the branch is 50/50, wrecking the predictor.

### After (branchless, Go)
```go
for j := i + 1; j < len(a); j++ {
    less := 0
    if a[j] < a[minIdx] { less = 1 }     // compiler emits CMOV on amd64
    minIdx = j*less + minIdx*(1-less)
}
```
Or in C-ish style with explicit conditional move (Java/JIT often does this automatically when the branch is unpredictable):
```c
min_idx = (a[j] < a[min_idx]) ? j : min_idx;
```
**Win:** Eliminates the unpredictable branch. On Skylake+ amd64, branchless min-find is ~1.5× faster on random input. **Caveat:** if data is highly biased (e.g., min is always near the start), the branch is well predicted and branchless can be slower because both branches always execute. Benchmark before adopting.

---

## 8. Write-Counting Wrapper (Detect Wear-Leveling Hotspots)

### Before
```python
arr[i], arr[min_idx] = arr[min_idx], arr[i]
```

### After (Java — instrumented array)
```java
public class WriteCountingArray {
    private final int[] data;
    public long writes = 0;
    public final long[] perIndexWrites;

    public WriteCountingArray(int[] init) {
        this.data = init.clone();
        this.perIndexWrites = new long[init.length];
    }
    public int get(int i) { return data[i]; }
    public void set(int i, int v) {
        if (data[i] != v) {           // skip silent writes
            data[i] = v;
            writes++;
            perIndexWrites[i]++;
        }
    }
}
// Selection Sort using get/set and you can audit writes per index after.
```
**Win:** For embedded firmware on EEPROM/NOR flash, this is a debugging tool that surfaces wear-leveling problems before deployment. After running your sort across realistic inputs, verify `max(perIndexWrites) - min(perIndexWrites)` is small — Selection Sort with the self-swap skip should give roughly uniform writes.

---

## 9. Batch Min-Find (SIMD-Ready Loop Shape)

### Before
```c
int min_idx = i;
for (int j = i + 1; j < n; j++) {
    if (a[j] < a[min_idx]) min_idx = j;
}
```
Loop-carried dependency on `min_idx` blocks vectorization.

### After (Java — break the dependency chain into chunks)
```java
public static int findMin(int[] a, int from, int to) {
    final int CHUNK = 8;
    int n = to - from;
    if (n < CHUNK) {
        int m = from;
        for (int j = from + 1; j < to; j++) if (a[j] < a[m]) m = j;
        return m;
    }
    // 8 partial mins, computed independently → autovectorizes
    int[] localIdx = new int[CHUNK];
    int[] localVal = new int[CHUNK];
    for (int k = 0; k < CHUNK; k++) {
        localIdx[k] = from + k;
        localVal[k] = a[from + k];
    }
    int j = from + CHUNK;
    for (; j + CHUNK <= to; j += CHUNK) {
        for (int k = 0; k < CHUNK; k++) {
            if (a[j + k] < localVal[k]) {
                localVal[k] = a[j + k];
                localIdx[k] = j + k;
            }
        }
    }
    // reduce
    int minIdx = localIdx[0];
    for (int k = 1; k < CHUNK; k++) if (localVal[k] < a[minIdx]) minIdx = localIdx[k];
    for (; j < to; j++) if (a[j] < a[minIdx]) minIdx = j;
    return minIdx;
}
```
**Win:** HotSpot's auto-vectorizer (and JDK 21+ Vector API) can pack 8 int compares into one AVX2 instruction. The original tight loop with a single `min_idx` cannot vectorize because each iteration depends on the previous min. Speedup: 2–4× on the inner scan for `n > 1000`.

---

## 10. Parallel Min-Find (Fork/Join)

### Before — Sequential
```java
int findMin(int[] a, int from, int to) {
    int m = from;
    for (int j = from + 1; j < to; j++) if (a[j] < a[m]) m = j;
    return m;
}
```

### After (Java fork/join)
```java
public class ParallelMinFinder extends RecursiveTask<Integer> {
    private static final int THRESHOLD = 16_384;
    final int[] a; final int from, to;
    ParallelMinFinder(int[] a, int from, int to) { this.a = a; this.from = from; this.to = to; }

    @Override protected Integer compute() {
        if (to - from <= THRESHOLD) {
            int m = from;
            for (int j = from + 1; j < to; j++) if (a[j] < a[m]) m = j;
            return m;
        }
        int mid = (from + to) >>> 1;
        ParallelMinFinder left = new ParallelMinFinder(a, from, mid);
        ParallelMinFinder right = new ParallelMinFinder(a, mid, to);
        left.fork();
        int rIdx = right.compute();
        int lIdx = left.join();
        return a[lIdx] <= a[rIdx] ? lIdx : rIdx;
    }
}
```
**Win/Caveat:** With `n = 10⁶` and 8 cores, the inner min-find is ~6× faster. But Selection Sort's outer loop is still serial — total speedup is bounded by `~6×` per pass × `n-1` passes, vs. switching to `Arrays.parallelSort` (parallel merge sort) which is **orders of magnitude** faster. Parallelizing Selection Sort is an academic exercise; in production, change algorithm.

---

## 11. Top-K via Partial Selection Sort (When You Don't Need Full Sort)

### Before — Sort everything to grab top 10
```python
sorted_data = sorted(data)
top10 = sorted_data[:10]
```
O(n log n) for n = 1M to get 10 elements.

### After (Python — partial Selection Sort)
```python
def top_k_smallest(arr, k):
    n = len(arr)
    a = list(arr)
    for i in range(min(k, n - 1)):
        min_idx = i
        for j in range(i + 1, n):
            if a[j] < a[min_idx]:
                min_idx = j
        if min_idx != i:
            a[i], a[min_idx] = a[min_idx], a[i]
    return a[:k]
```
**Win:** O(n·k) instead of O(n log n). For `k = 10, n = 10⁶`: ~10M ops vs ~20M ops — about 2× faster, and uses **zero auxiliary memory**. Crossover with `heapq.nsmallest` (which is O(n log k)) is around k ≈ log₂(n); below that, partial Selection Sort wins.

> Real use: streaming top-k on embedded devices where heap allocation is expensive or forbidden.

---

## 12. Heap-Based Selection (Generalize to Heap Sort)

### Before — Plain Selection Sort, O(n²)
```python
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]: min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
```
The "find the min" step costs O(n) per pass.

### After — Heap Sort, O(n log n)
```python
import heapq
def heap_sort(arr):
    h = list(arr)
    heapq.heapify(h)              # O(n)
    return [heapq.heappop(h) for _ in range(len(h))]   # n × O(log n)
```
Or in-place max-heap (Java):
```java
public static void heapSort(int[] a) {
    int n = a.length;
    for (int i = n / 2 - 1; i >= 0; i--) siftDown(a, i, n);    // O(n) build
    for (int i = n - 1; i > 0; i--) {
        int t = a[0]; a[0] = a[i]; a[i] = t;
        siftDown(a, 0, i);
    }
}
```
**Win:** **Heap Sort is Selection Sort with a smarter "find min" step.** Both pick the minimum and place it at the front; Heap Sort does it in O(log n) using a binary heap instead of O(n) linear scan. Total: O(n log n) instead of O(n²). Same write count (n-1 swap-outs from the root), same in-place property, no extra memory. **If you're tempted to use Selection Sort and your `n > ~30`, use Heap Sort instead.**

---

## Summary Table

| # | Optimization | Speedup / Benefit | Cost |
|---|--------------|-------------------|------|
| 1 | Skip self-swap | Up to `n-1` writes saved | One branch per pass |
| 2 | Bidirectional | ~25–40% fewer passes | More complex inner loop |
| 3 | Early exit | Wins on sorted input only | Extra branch per inner iter (loss on random) |
| 4 | Iterative | Faster, no stack risk | None — always do this |
| 5 | Stable shift | Stability | **Loses the only advantage of Selection Sort** |
| 6 | Indirect via keys | 5–20× on big-payload sorts | One extra permute pass |
| 7 | Branchless min | ~1.5× on random data | Slower on biased input |
| 8 | Write counter | Debugging visibility | Instrumentation overhead |
| 9 | Batched min (SIMD) | 2–4× on inner scan | Code complexity |
| 10 | Parallel min-find | ~k× per pass on k cores | Outer loop still serial — bad ROI |
| 11 | Top-k partial | O(n·k) vs O(n log n) | Only useful for small k |
| 12 | Heap-based (Heap Sort) | O(n log n) vs O(n²) | Slightly more complex code |

---

## Meta-Conclusion

Selection Sort has **two and a half** legitimate optimizations:
1. **Self-swap skip** (#1) — always do this; the write savings define the algorithm's identity.
2. **Indirect sorting via keys** (#6) — applies to any comparison sort but matters here because Selection Sort is comparison-bound.
2.5 **Bidirectional** (#2) — meaningful constant-factor win but doesn't change Big-O.

Every other "optimization" either:
- Generalizes to a better algorithm (Heap Sort #12, partial selection #11),
- Makes the algorithm worse for its intended use case (stable variant #5 destroys write economy),
- Is a micro-tweak with mixed real-world impact (#3, #7, #9, #10).

**The biggest optimization is choosing a different algorithm.** Selection Sort earns its place only when minimizing **writes** is the primary constraint (flash/EEPROM, network round-trips per swap, expensive serialized state) — and even then, you should benchmark against **cycle sort** (theoretically minimum writes, but more complex).
