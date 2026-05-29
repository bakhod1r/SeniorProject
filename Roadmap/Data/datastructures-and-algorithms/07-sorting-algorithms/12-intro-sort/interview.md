# Intro Sort — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Intro Sort? | Hybrid sort: starts as Quick Sort, switches to Heap Sort on deep recursion, finishes with Insertion Sort on small partitions. Guarantees `O(n log n)` worst case. |
| 2 | What is its time complexity? | `O(n log n)` best, average, and worst — the depth-limited Heap Sort fallback eliminates Quick Sort's `O(n²)` worst case. |
| 3 | Is Intro Sort stable? | No — both Quick Sort partition and Heap Sort sift-down can reorder equal-keyed elements. Use Merge Sort or Tim Sort if stability is required. |
| 4 | Is Intro Sort in-place? | Yes — only the `O(log n)` recursion stack; no auxiliary array like Merge Sort. |

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Why did Musser introduce Intro Sort in 1997? | To fix Quick Sort's embarrassing `O(n²)` worst case on adversarial input while preserving its excellent average-case performance — i.e., remove the algorithmic-complexity DoS surface without sacrificing speed. |
| 2 | What is the depth-limit formula, and why `2·⌊log₂ n⌋`? | The optimum balanced Quick Sort recurses `⌈log₂ n⌉` levels; doubling that gives slack for a few bad pivots before declaring failure. Any constant `c ≥ 1` preserves `O(n log n)`; `2` is conservative and rarely fires on real data. |
| 3 | What happens when the depth limit is hit? | The current sub-range is handed off to Heap Sort, which guarantees `O(n log n)` on that range. Heap Sort must be terminal — do not recurse back into Intro Sort, or the bound breaks. |
| 4 | Why fall back to Insertion Sort on small partitions (~16 elements)? | Insertion Sort has the lowest constant factor: no recursion, sequential memory access, branch-predictor-friendly. Below ~16 elements it beats Quick Sort and Heap Sort in wall-clock time despite its `O(n²)` asymptotic. |

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What pivot strategy does Intro Sort use, and why does it matter? | Median-of-three (`median(arr[lo], arr[mid], arr[hi])`) is standard in libstdc++. For very large `n` use the ninther (median of three medians-of-three). Better pivots mean the depth limit fires less often, which directly affects p99 latency since Heap Sort is ~3× slower per item than partition. |
| 2 | How does pdqsort improve on the original Intro Sort? | Adds (a) branchless block partition (`~30%` speedup on random data via predictable branches), (b) pattern detection for already-sorted/reverse/constant runs giving `O(n)` adaptivity, (c) adversarial randomization that swaps a random element when a partition is too unbalanced, breaking killer permutations before they trigger the heap fallback. |
| 3 | Why do C++ STL (`std::sort`) and .NET (`Array.Sort`) both use Intro Sort? | Both standards mandate `O(n log n)` worst case for the default unstable sort; both want Quick Sort's average-case speed and in-place memory profile; both predate pdqsort (2016). Newer languages — Rust, Go 1.19+ — have moved to pdqsort. |
| 4 | Compare Intro Sort and Tim Sort. | Intro Sort: unstable, in-place (`O(log n)`), not adaptive, optimal on random data. Tim Sort: stable, needs `O(n)` extra memory, highly adaptive to runs, optimal on partially-sorted data. Tim Sort wins for object arrays and real-world data with runs (Python `sorted()`, Java `Arrays.sort(Object[])`); Intro Sort wins for primitive arrays of random data with no stability requirement. |

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove that Intro Sort's worst case is `O(n log n)`. | Three-region argument. (1) Partition work: each level costs `O(n)`; depth capped at `2 log₂ n`, total `O(n log n)`. (2) Heap fallbacks: ranges are disjoint with sizes summing to `≤ n`, so `Σ m_i log m_i ≤ n log n`. (3) Insertion Sort: each range size `≤ c` constant, total `O(n·c) = O(n)`. Sum: `O(n log n)`. QED. |
| 2 | Derive the expected number of Heap Sort fallbacks on uniformly random input. | `Pr[depth > c log₂ n] ≤ n^{-(c-1)}` for random pivots. With `c = 2`, the probability is `O(1/n)`, so expected fallbacks per sort is `O(1)`. Intro Sort matches Quick Sort's average comparison count `≈ 1.39 n log₂ n` to second order. |
| 3 | What is Introselect, and how does it relate? | Musser's `k`-th-smallest analogue: Quickselect with a BFPRT (median-of-medians) fallback when depth is exhausted. Guarantees `O(n)` worst case for selection. Used by C++ `std::nth_element`. Same introspection idea — watch yourself, switch to a worst-case-bounded sibling on failure. |
| 4 | Why doesn't Intro Sort match the cache-optimal sort bound? | Partition splits exactly in half rather than into `M/B` pieces (cache size / block size), so I/O complexity is `O((n/B) log₂(n/B))` — a factor of `log₂(M/B)` worse than the Aggarwal–Vitter lower bound `O((n/B) log_{M/B}(n/B))`. Cache-oblivious Funnelsort matches the lower bound but has prohibitive constants for in-memory use. |

---

## Coding Challenge (3 Languages)

### Challenge: Implement Intro Sort end-to-end

> Implement Intro Sort with all three switches: Quick Sort (median-of-three pivot), Heap Sort fallback when recursion depth reaches `2·⌊log₂ n⌋`, and Insertion Sort cutoff at 16. Verify it sorts both random and adversarial input in guaranteed `O(n log n)`.
>
> Requirements:
> - `IntroSort(arr)` — sorts in place ascending.
> - Track and expose the maximum recursion depth reached (for testing).
> - Track whether the Heap Sort fallback ever fired (for testing).
> - Sort `[7, 2, 1, 6, 8, 5, 3, 4]` correctly.
> - Sort a 10,000-element "killer" array (descending, then a final small value) within `O(n log n)` — recursion depth must stay `≤ 2·log₂ n + 2`.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

const insertionCutoff = 16

type Stats struct {
	MaxDepth     int
	HeapFallback bool
}

func IntroSort(arr []int) Stats {
	s := &Stats{}
	n := len(arr)
	if n < 2 {
		return *s
	}
	depthLimit := 2 * (bits.Len(uint(n)) - 1)
	introsort(arr, 0, n-1, depthLimit, 0, s)
	return *s
}

func introsort(arr []int, lo, hi, depth, current int, s *Stats) {
	if current > s.MaxDepth {
		s.MaxDepth = current
	}
	for hi-lo > insertionCutoff {
		if depth == 0 {
			s.HeapFallback = true
			heapSort(arr, lo, hi)
			return
		}
		depth--
		p := partition(arr, lo, hi)
		introsort(arr, p+1, hi, depth, current+1, s) // recurse right
		hi = p - 1                                   // iterate left
	}
	insertionSort(arr, lo, hi)
}

func partition(arr []int, lo, hi int) int {
	mid := lo + (hi-lo)/2
	medianOfThree(arr, lo, mid, hi)
	pivot := arr[hi-1]
	i, j := lo, hi-1
	for {
		for i++; arr[i] < pivot; i++ {
		}
		for j--; arr[j] > pivot; j-- {
		}
		if i >= j {
			break
		}
		arr[i], arr[j] = arr[j], arr[i]
	}
	arr[i], arr[hi-1] = arr[hi-1], arr[i]
	return i
}

func medianOfThree(arr []int, lo, mid, hi int) {
	if arr[mid] < arr[lo] {
		arr[lo], arr[mid] = arr[mid], arr[lo]
	}
	if arr[hi] < arr[lo] {
		arr[lo], arr[hi] = arr[hi], arr[lo]
	}
	if arr[hi] < arr[mid] {
		arr[mid], arr[hi] = arr[hi], arr[mid]
	}
	arr[mid], arr[hi-1] = arr[hi-1], arr[mid]
}

func insertionSort(arr []int, lo, hi int) {
	for i := lo + 1; i <= hi; i++ {
		v := arr[i]
		j := i - 1
		for j >= lo && arr[j] > v {
			arr[j+1] = arr[j]
			j--
		}
		arr[j+1] = v
	}
}

func heapSort(arr []int, lo, hi int) {
	n := hi - lo + 1
	for i := n/2 - 1; i >= 0; i-- {
		siftDown(arr, lo, i, n)
	}
	for end := n - 1; end > 0; end-- {
		arr[lo], arr[lo+end] = arr[lo+end], arr[lo]
		siftDown(arr, lo, 0, end)
	}
}

func siftDown(arr []int, base, root, n int) {
	for {
		left := 2*root + 1
		if left >= n {
			return
		}
		largest := left
		if right := left + 1; right < n && arr[base+right] > arr[base+left] {
			largest = right
		}
		if arr[base+root] >= arr[base+largest] {
			return
		}
		arr[base+root], arr[base+largest] = arr[base+largest], arr[base+root]
		root = largest
	}
}

func main() {
	a := []int{7, 2, 1, 6, 8, 5, 3, 4}
	stats := IntroSort(a)
	fmt.Println(a, "stats:", stats) // [1 2 3 4 5 6 7 8]
}
```

#### Java

```java
import java.util.Arrays;

public class IntroSort {
    private static final int INSERTION_CUTOFF = 16;

    public static class Stats {
        public int maxDepth = 0;
        public boolean heapFallback = false;
        @Override public String toString() {
            return "maxDepth=" + maxDepth + ", heapFallback=" + heapFallback;
        }
    }

    public static Stats sort(int[] arr) {
        Stats s = new Stats();
        int n = arr.length;
        if (n < 2) return s;
        int depthLimit = 2 * (31 - Integer.numberOfLeadingZeros(n));
        introsort(arr, 0, n - 1, depthLimit, 0, s);
        return s;
    }

    private static void introsort(int[] a, int lo, int hi, int depth, int current, Stats s) {
        if (current > s.maxDepth) s.maxDepth = current;
        while (hi - lo > INSERTION_CUTOFF) {
            if (depth == 0) {
                s.heapFallback = true;
                heapSort(a, lo, hi);
                return;
            }
            depth--;
            int p = partition(a, lo, hi);
            introsort(a, p + 1, hi, depth, current + 1, s);
            hi = p - 1;
        }
        insertionSort(a, lo, hi);
    }

    private static int partition(int[] a, int lo, int hi) {
        int mid = lo + (hi - lo) / 2;
        medianOfThree(a, lo, mid, hi);
        int pivot = a[hi - 1];
        int i = lo, j = hi - 1;
        while (true) {
            while (a[++i] < pivot) {}
            while (a[--j] > pivot) {}
            if (i >= j) break;
            int t = a[i]; a[i] = a[j]; a[j] = t;
        }
        int t = a[i]; a[i] = a[hi - 1]; a[hi - 1] = t;
        return i;
    }

    private static void medianOfThree(int[] a, int lo, int mid, int hi) {
        if (a[mid] < a[lo]) { int t = a[lo]; a[lo] = a[mid]; a[mid] = t; }
        if (a[hi]  < a[lo]) { int t = a[lo]; a[lo] = a[hi];  a[hi]  = t; }
        if (a[hi]  < a[mid]){ int t = a[mid];a[mid]= a[hi];  a[hi]  = t; }
        int t = a[mid]; a[mid] = a[hi - 1]; a[hi - 1] = t;
    }

    private static void insertionSort(int[] a, int lo, int hi) {
        for (int i = lo + 1; i <= hi; i++) {
            int v = a[i], j = i - 1;
            while (j >= lo && a[j] > v) { a[j + 1] = a[j]; j--; }
            a[j + 1] = v;
        }
    }

    private static void heapSort(int[] a, int lo, int hi) {
        int n = hi - lo + 1;
        for (int i = n / 2 - 1; i >= 0; i--) siftDown(a, lo, i, n);
        for (int end = n - 1; end > 0; end--) {
            int t = a[lo]; a[lo] = a[lo + end]; a[lo + end] = t;
            siftDown(a, lo, 0, end);
        }
    }

    private static void siftDown(int[] a, int base, int root, int n) {
        while (true) {
            int left = 2 * root + 1;
            if (left >= n) return;
            int largest = left;
            int right = left + 1;
            if (right < n && a[base + right] > a[base + left]) largest = right;
            if (a[base + root] >= a[base + largest]) return;
            int t = a[base + root]; a[base + root] = a[base + largest]; a[base + largest] = t;
            root = largest;
        }
    }

    public static void main(String[] args) {
        int[] a = {7, 2, 1, 6, 8, 5, 3, 4};
        Stats s = sort(a);
        System.out.println(Arrays.toString(a) + " " + s);
    }
}
```

#### Python

```python
import math

INSERTION_CUTOFF = 16


class Stats:
    def __init__(self):
        self.max_depth = 0
        self.heap_fallback = False

    def __repr__(self):
        return f"Stats(max_depth={self.max_depth}, heap_fallback={self.heap_fallback})"


def intro_sort(arr):
    s = Stats()
    n = len(arr)
    if n < 2:
        return s
    depth_limit = 2 * int(math.log2(n))
    _introsort(arr, 0, n - 1, depth_limit, 0, s)
    return s


def _introsort(arr, lo, hi, depth, current, s):
    if current > s.max_depth:
        s.max_depth = current
    while hi - lo > INSERTION_CUTOFF:
        if depth == 0:
            s.heap_fallback = True
            _heap_sort(arr, lo, hi)
            return
        depth -= 1
        p = _partition(arr, lo, hi)
        _introsort(arr, p + 1, hi, depth, current + 1, s)
        hi = p - 1
    _insertion_sort(arr, lo, hi)


def _partition(arr, lo, hi):
    mid = (lo + hi) // 2
    _median_of_three(arr, lo, mid, hi)
    pivot = arr[hi - 1]
    i, j = lo, hi - 1
    while True:
        i += 1
        while arr[i] < pivot:
            i += 1
        j -= 1
        while arr[j] > pivot:
            j -= 1
        if i >= j:
            break
        arr[i], arr[j] = arr[j], arr[i]
    arr[i], arr[hi - 1] = arr[hi - 1], arr[i]
    return i


def _median_of_three(arr, lo, mid, hi):
    if arr[mid] < arr[lo]:
        arr[lo], arr[mid] = arr[mid], arr[lo]
    if arr[hi] < arr[lo]:
        arr[lo], arr[hi] = arr[hi], arr[lo]
    if arr[hi] < arr[mid]:
        arr[mid], arr[hi] = arr[hi], arr[mid]
    arr[mid], arr[hi - 1] = arr[hi - 1], arr[mid]


def _insertion_sort(arr, lo, hi):
    for i in range(lo + 1, hi + 1):
        v = arr[i]
        j = i - 1
        while j >= lo and arr[j] > v:
            arr[j + 1] = arr[j]
            j -= 1
        arr[j + 1] = v


def _heap_sort(arr, lo, hi):
    n = hi - lo + 1
    for i in range(n // 2 - 1, -1, -1):
        _sift_down(arr, lo, i, n)
    for end in range(n - 1, 0, -1):
        arr[lo], arr[lo + end] = arr[lo + end], arr[lo]
        _sift_down(arr, lo, 0, end)


def _sift_down(arr, base, root, n):
    while True:
        left = 2 * root + 1
        if left >= n:
            return
        largest = left
        right = left + 1
        if right < n and arr[base + right] > arr[base + left]:
            largest = right
        if arr[base + root] >= arr[base + largest]:
            return
        arr[base + root], arr[base + largest] = arr[base + largest], arr[base + root]
        root = largest


if __name__ == "__main__":
    a = [7, 2, 1, 6, 8, 5, 3, 4]
    stats = intro_sort(a)
    print(a, stats)
```

**Analysis:**
- **Time:** `O(n log n)` best/avg/worst — depth-limited heap fallback caps the worst case.
- **Space:** `O(log n)` — recursion stack only.
- **Stability:** Not stable — partition and sift-down both reorder equal keys.
- **Verification trick:** the `Stats` struct lets you assert in tests that `stats.MaxDepth <= 2*math.Log2(n) + 2`. Sorting a "killer" sequence designed to force always-pivot-equals-first should still satisfy this — that is the Heap-fallback guarantee in action.

**Follow-up question:** "Why decrement `depth` *before* the recursive call rather than after?" Answer: the depth budget is "remaining levels of Quick Sort allowed." Decrementing before guarantees that the child call sees a budget one smaller than the parent's, which is the invariant the proof relies on. Decrementing after would let the recursion go one level deeper than the formula promises.

---

## Behavioural & System-Design Follow-Ups

| # | Question | Expected Answer |
|---|----------|-----------------|
| 1 | Tell me about a time you debugged a slow sort in production. | Example: discovered `Comparator<T>` boxing in Java; switched to primitive sort and dropped p99 from 80 ms to 12 ms. |
| 2 | A payment API sorts request batches. How do you defend against an attacker who sends adversarial input? | Switch from naïve Quick Sort to Intro Sort or pdqsort (kills `O(n²)`), cap input size, optionally hash sort keys with an HMAC the attacker cannot predict. |
| 3 | When would you choose Heap Sort *over* Intro Sort? | Hard-real-time path needing deterministic low variance — Heap Sort's p999 is its average; Intro Sort's p999 spikes on adversarial input. |
| 4 | Walk me through the choice of insertion-sort cutoff. | Benchmark cutoff values `{8, 16, 24, 32}` on representative data; pick the value that minimises wall-clock time. libstdc++ uses 16; .NET uses 16; Java's Dual-Pivot uses 47 (different design). |
| 5 | How would you parallelize Intro Sort? | Fork-join after each partition; threshold per task (~10k items) to amortise scheduling overhead; expect 3–5× speedup on 8 cores due to load imbalance from unbalanced partitions. |
| 6 | Defend choosing Tim Sort over Intro Sort for an object array. | Tim Sort is stable (required for many APIs that sort by multiple keys via consecutive sorts), adaptive (real data has runs), and `O(n)` extra memory is acceptable when the objects themselves are `O(n)` references. |
| 7 | The Heap Sort fallback fires 30% of the time in production. What do you do? | Inspect the input — likely (a) attacker probing or (b) the pivot rule is poorly matched (e.g., median-of-three on data that defeats it). Switch to ninther pivot or to pdqsort. |

---

## Deep-Dive Answers (Top 5)

### 1. "Walk me through Intro Sort step by step."

> Intro Sort is a hybrid that wraps Quick Sort in a guard. At each recursive call you check three things in order: (a) is the range small enough — say `≤ 16` — to hand off to Insertion Sort? (b) has the recursion depth budget reached zero — meaning we have already recursed `2·⌊log₂ n⌋` levels and Quick Sort is clearly degenerating? If so, finish this range with Heap Sort, which guarantees `O(n log n)`. (c) Otherwise, pick a pivot via median-of-three, partition, then recurse on one side and iterate on the other (the tail-recursion-by-iteration trick caps stack depth at `O(log n)` even on unbalanced partitions). The depth budget is decremented before each recursion, so it strictly tracks how many more Quick Sort levels are allowed.
>
> Total cost: partitions across `≤ 2 log n` levels at `O(n)` per level = `O(n log n)`; any heap fallbacks operate on disjoint ranges whose sizes sum to `≤ n`, contributing at most `n log n`; the insertion-sort cleanup is `O(n)` because each range is bounded by the constant cutoff.

### 2. "Why is the depth limit specifically `2·⌊log₂ n⌋` and not `log₂ n` or `5 log₂ n`?"

> Mathematically any constant factor `c ≥ 1` preserves the `O(n log n)` worst case — only the constant in front of `n log n` changes. The actual choice is a tuning knob. A *smaller* limit (e.g., `1.5 log n`) bails out to Heap Sort faster — safer for adversarial inputs but slower on benign ones because Heap Sort has worse constants per element than partition. A *larger* limit (e.g., `4 log n`) lets Quick Sort keep trying after several bad pivots — faster when median-of-three eventually recovers, slower when it doesn't.
>
> Musser's original `2` is the empirically-good middle. On uniformly random inputs the probability of ever exceeding `2 log n` depth is `O(1/n)`, so on real data the fallback essentially never fires; on adversarial input it fires after `2 log n` levels and the disjoint-ranges argument bounds the total damage.

### 3. "How does pdqsort improve on Intro Sort?"

> Four things:
>
> 1. **Block partition.** Instead of `if (a[i] < pivot) swap(...)` inside the partition loop, pdqsort scans a block of ~64 elements computing offsets into two side buffers, then does the swaps in one branch-free batch. The CPU branch predictor stops mispredicting on every other element. Real-world speedup on random data: ~30%.
> 2. **Pattern detection.** Before partitioning, check whether the range is already sorted (or reverse-sorted, or all-equal). If so, return immediately (or after a single reverse). This gives `O(n)` on already-sorted input — what Intro Sort lacks but Tim Sort has.
> 3. **Adversarial randomization.** After partition, if the smaller side is `< n/8` of the range, swap a random element into the pivot position before the next pivot pick. This breaks killer permutations without paying the cost of random pivots on benign input.
> 4. **Tuned cutoffs.** Different insertion-sort cutoffs for different situations; tuned per-architecture.
>
> Pdqsort is used by Rust `slice::sort_unstable` and Go 1.19+ `slices.Sort`. Intro Sort survives in C++ `std::sort` and .NET `Array.Sort` mostly for historical reasons.

### 4. "Compare Intro Sort with Tim Sort."

| Dimension | Intro Sort | Tim Sort |
|-----------|------------|----------|
| Stable? | No | **Yes** |
| Extra memory | `O(log n)` stack | `O(n)` for merge buffer |
| Adaptive? | No | **Yes** — detects runs, `O(n)` on sorted input |
| Worst case | `O(n log n)` | `O(n log n)` |
| Best case | `O(n log n)` | **`O(n)`** |
| Best for | Primitive arrays, random data | Object arrays, real-world data with runs |
| Used by | C++ `std::sort`, .NET `Array.Sort` | Python `sorted()`, Java `Arrays.sort(Object[])` |
| Cache behavior | **Excellent** (in-place, sequential) | Good (merging touches consecutive runs) |

> The trade-off is **in-place vs adaptive**. Tim Sort spends `O(n)` memory to gain stability and adaptivity; Intro Sort spends a slot in your `std::sort` call to gain in-place behavior and slightly better cache utilization. For sorting `int[]` of random values, Intro Sort wins. For sorting `List<Person>` by name where the list already came partially sorted by recency, Tim Sort wins by 5–10×.

### 5. "Prove that Intro Sort's worst case is `O(n log n)`."

> Decompose the total work into three disjoint regions:
>
> **Region 1 — Partition work before the depth limit fires.** Every element participates in at most one partition per recursion level. The depth is capped at `d = 2 log₂ n` levels. Per-level partition cost is `O(n)`. Total: `O(n) · 2 log₂ n = O(n log n)`.
>
> **Region 2 — Heap Sort fallbacks.** When the depth limit fires on a range of size `m`, Heap Sort costs `O(m log m)`. All fallback ranges are **disjoint** (each is a leaf of the recursion tree), so `Σ m_i ≤ n`. By Jensen's inequality or just `m_i ≤ n`: `Σ m_i log m_i ≤ log n · Σ m_i ≤ n log n`. Total: `O(n log n)`.
>
> **Region 3 — Insertion Sort.** Runs only on ranges of size `≤ c` (the cutoff constant, typically 16). Cost per range is `O(c²)`. Number of leaf ranges is `O(n/c)`. Total: `O(n/c · c²) = O(n·c) = O(n)`.
>
> **Sum:** `O(n log n) + O(n log n) + O(n) = O(n log n)`. QED. The bound holds for *every* input — no probabilistic assumption needed. This is the entire reason Intro Sort exists.

---

## Quick Self-Check

After this section you should be able to:

- [ ] Write Intro Sort from scratch in Go, Java, and Python within 20 minutes.
- [ ] State the depth-limit formula and explain why `2·⌊log₂ n⌋` (not `log₂ n`, not `n`).
- [ ] Explain why the Heap Sort fallback must be terminal (no recursion back into Intro Sort).
- [ ] List the three switches and their thresholds (cutoff `≈ 16`, depth `2 log₂ n`).
- [ ] Compare Intro Sort vs Pdqsort vs Tim Sort along stability, adaptivity, and memory axes.
- [ ] Identify which production sorts use Intro Sort (`std::sort`, `.NET Array.Sort`) and which have moved on (Rust, Go 1.19+ use pdqsort; Python, Java objects use Tim Sort).
- [ ] Prove the `O(n log n)` worst case via the three-region argument.
- [ ] Recognize that Intro Sort is *unstable* and reach for Tim Sort or Merge Sort when stability is required.
- [ ] Describe how an attacker could exploit naïve Quick Sort and explain why Intro Sort closes that vector.
- [ ] Defend a pivot-strategy choice (median-of-three vs ninther vs random) given the input distribution.
