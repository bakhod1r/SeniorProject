# Intro Sort — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task includes starter code and explicit constraints. Verify your implementation against the test inputs provided.

---

## Beginner Tasks

### Task 1: Quick Sort with median-of-three pivot

Implement a *vanilla* Quick Sort that uses median-of-three pivot selection. This is the Quick Sort layer that Intro Sort will eventually wrap. Do NOT add the depth limit or insertion cutoff in this task — keep them for Tasks 2 and 3.

#### Go

```go
package main

import "fmt"

func QuickSort(arr []int) {
	if len(arr) < 2 {
		return
	}
	quicksort(arr, 0, len(arr)-1)
}

func quicksort(arr []int, lo, hi int) {
	// implement here using median-of-three pivot
}

func main() {
	a := []int{7, 2, 1, 6, 8, 5, 3, 4}
	QuickSort(a)
	fmt.Println(a) // [1 2 3 4 5 6 7 8]
}
```

#### Java

```java
public class Task1 {
    public static void sort(int[] arr) {
        if (arr.length < 2) return;
        quicksort(arr, 0, arr.length - 1);
    }

    private static void quicksort(int[] arr, int lo, int hi) {
        // implement here using median-of-three pivot
    }

    public static void main(String[] args) {
        int[] a = {7, 2, 1, 6, 8, 5, 3, 4};
        sort(a);
        System.out.println(java.util.Arrays.toString(a));
    }
}
```

#### Python

```python
def quick_sort(arr):
    if len(arr) < 2:
        return
    _quicksort(arr, 0, len(arr) - 1)


def _quicksort(arr, lo, hi):
    # implement here using median-of-three pivot
    pass


if __name__ == "__main__":
    a = [7, 2, 1, 6, 8, 5, 3, 4]
    quick_sort(a)
    print(a)  # [1, 2, 3, 4, 5, 6, 7, 8]
```

- **Constraints:** `O(n log n)` average, `O(n²)` worst on a true adversary (still acceptable in this task — we will fix this in Task 2).
- **Expected output:** sorted array.
- **Evaluation:** correctness on `[]`, `[1]`, `[1,1,1,1]`, sorted ascending, sorted descending, random of size 1000.

---

### Task 2: Add a depth-limit counter and switch to Heap Sort when exceeded

Extend Task 1 by passing a `depth` argument that starts at `2·⌊log₂ n⌋` and decrements by one before each recursive call. When `depth == 0`, hand the current range off to a Heap Sort routine (you write it). Verify your implementation never returns control to Quick Sort after Heap Sort runs.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

func IntroQuickHeap(arr []int) {
	n := len(arr)
	if n < 2 {
		return
	}
	depthLimit := 2 * (bits.Len(uint(n)) - 1)
	loop(arr, 0, n-1, depthLimit)
}

func loop(arr []int, lo, hi, depth int) {
	// if depth == 0 -> heap sort on arr[lo..hi]; return
	// else partition + recurse with depth-1
}

func heapSort(arr []int, lo, hi int) {
	// implement
}

func main() {
	a := []int{7, 2, 1, 6, 8, 5, 3, 4}
	IntroQuickHeap(a)
	fmt.Println(a)
}
```

#### Java

```java
public class Task2 {
    public static void sort(int[] arr) {
        int n = arr.length;
        if (n < 2) return;
        int depthLimit = 2 * (31 - Integer.numberOfLeadingZeros(n));
        loop(arr, 0, n - 1, depthLimit);
    }

    private static void loop(int[] arr, int lo, int hi, int depth) {
        // implement: switch to heap sort if depth == 0
    }

    private static void heapSort(int[] arr, int lo, int hi) {
        // implement
    }

    public static void main(String[] args) {
        int[] a = {7, 2, 1, 6, 8, 5, 3, 4};
        sort(a);
        System.out.println(java.util.Arrays.toString(a));
    }
}
```

#### Python

```python
import math


def intro_quick_heap(arr):
    n = len(arr)
    if n < 2:
        return
    depth_limit = 2 * int(math.log2(n))
    _loop(arr, 0, n - 1, depth_limit)


def _loop(arr, lo, hi, depth):
    # implement
    pass


def _heap_sort(arr, lo, hi):
    # implement
    pass


if __name__ == "__main__":
    a = [7, 2, 1, 6, 8, 5, 3, 4]
    intro_quick_heap(a)
    print(a)
```

- **Constraints:** Heap Sort must be terminal — once it runs on a range, no further partitioning happens on that range.
- **Expected output:** sorted array, even on adversarial input.
- **Evaluation:** sort `[1,2,3,...,1000]` and verify the depth never exceeds `2·⌊log₂ 1000⌋ + 2 = 20`.

---

### Task 3: Add Insertion Sort cutoff at threshold `T`

Extend Task 2 with a constant cutoff `T = 16`. When the current range has `hi - lo ≤ T`, finish it with Insertion Sort instead of partitioning. Insertion Sort here should sort only `arr[lo..hi]`.

#### Go

```go
package main

const cutoff = 16

func loop(arr []int, lo, hi, depth int) {
	for hi-lo > cutoff {
		if depth == 0 {
			heapSort(arr, lo, hi)
			return
		}
		depth--
		// partition + tail-iterate
	}
	insertionSort(arr, lo, hi)
}

func insertionSort(arr []int, lo, hi int) {
	// implement
}
```

#### Java

```java
private static final int CUTOFF = 16;

private static void loop(int[] arr, int lo, int hi, int depth) {
    while (hi - lo > CUTOFF) {
        if (depth == 0) {
            heapSort(arr, lo, hi);
            return;
        }
        depth--;
        // partition + tail-iterate
    }
    insertionSort(arr, lo, hi);
}

private static void insertionSort(int[] arr, int lo, int hi) {
    // implement
}
```

#### Python

```python
CUTOFF = 16


def _loop(arr, lo, hi, depth):
    while hi - lo > CUTOFF:
        if depth == 0:
            _heap_sort(arr, lo, hi)
            return
        depth -= 1
        # partition + tail-iterate

    _insertion_sort(arr, lo, hi)


def _insertion_sort(arr, lo, hi):
    # implement
    pass
```

- **Constraints:** Verify your Insertion Sort respects the `lo`/`hi` range — do not access `arr[0]` if `lo > 0`.
- **Expected output:** sorted array; check on small (n=8) and large (n=10000) inputs.
- **Evaluation:** time the change vs Task 2 on `n=10^5` random data — expect ~10–15% speedup from the cutoff alone.

---

### Task 4: Full Intro Sort combining all three layers

Combine Tasks 1–3 into a single `IntroSort` function: median-of-three pivot, depth-limited Heap Sort fallback, Insertion Sort cutoff. Add the tail-recursion-by-iteration trick (recurse on one side, iterate by rewriting `hi` or `lo` on the other) so stack depth stays `O(log n)` regardless of partition balance.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

const introCutoff = 16

func IntroSort(arr []int) {
	n := len(arr)
	if n < 2 {
		return
	}
	introsort(arr, 0, n-1, 2*(bits.Len(uint(n))-1))
}

func introsort(arr []int, lo, hi, depth int) {
	// for ... { if depth == 0 -> heap; partition; recurse on right; iterate left }
	// insertionSort(arr, lo, hi)
}

func main() {
	a := []int{7, 2, 1, 6, 8, 5, 3, 4}
	IntroSort(a)
	fmt.Println(a)
}
```

#### Java

```java
import java.util.Arrays;

public class IntroSortFull {
    static final int CUTOFF = 16;

    public static void sort(int[] arr) {
        int n = arr.length;
        if (n < 2) return;
        introsort(arr, 0, n - 1, 2 * (31 - Integer.numberOfLeadingZeros(n)));
    }

    private static void introsort(int[] arr, int lo, int hi, int depth) {
        // implement
    }

    public static void main(String[] args) {
        int[] a = {7, 2, 1, 6, 8, 5, 3, 4};
        sort(a);
        System.out.println(Arrays.toString(a));
    }
}
```

#### Python

```python
import math

CUTOFF = 16


def intro_sort(arr):
    n = len(arr)
    if n < 2:
        return
    _introsort(arr, 0, n - 1, 2 * int(math.log2(n)))


def _introsort(arr, lo, hi, depth):
    # implement
    pass


if __name__ == "__main__":
    a = [7, 2, 1, 6, 8, 5, 3, 4]
    intro_sort(a)
    print(a)
```

- **Constraints:** Stack depth must be `O(log n)` even on adversarial input. Test by sorting `n = 10^6` items and asserting `sys.getrecursionlimit()` is not approached.
- **Expected output:** sorted; match `sorted(input)` on 100 random tests of sizes `{10, 100, 1000, 10000}`.
- **Evaluation:** correctness across all distributions; depth instrumentation in tests.

---

### Task 5: Verify `O(n log n)` worst case on adversarial input

Construct an input that would degrade plain Quick Sort (using `arr[lo]` as pivot) to `O(n²)` — e.g., a strictly ascending array `[1, 2, 3, ..., n]`. Run BOTH plain Quick Sort and your Task-4 Intro Sort on it for `n ∈ {10^3, 10^4, 10^5}`. Time both. Verify Intro Sort scales linearly with `n log n` while plain Quick Sort scales with `n²`.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func plainQuickFirstPivot(arr []int, lo, hi int) {
	// quick sort using arr[lo] as pivot — adversarial-vulnerable
}

func benchmark() {
	for _, n := range []int{1_000, 10_000, 100_000} {
		data := make([]int, n)
		for i := range data {
			data[i] = i // sorted ascending — adversarial for first-pivot Quick Sort
		}
		copyA := append([]int{}, data...)
		copyB := append([]int{}, data...)

		t1 := time.Now()
		plainQuickFirstPivot(copyA, 0, n-1)
		d1 := time.Since(t1)

		t2 := time.Now()
		IntroSort(copyB)
		d2 := time.Since(t2)

		fmt.Printf("n=%6d  plainQS=%9v  introsort=%9v  speedup=%.1fx\n",
			n, d1, d2, float64(d1)/float64(d2))
	}
}

func main() {
	benchmark()
}
```

#### Java

```java
public class Task5 {
    static void plainQuickFirstPivot(int[] arr, int lo, int hi) {
        // adversarial-vulnerable Quick Sort using arr[lo] as pivot
    }

    public static void main(String[] args) {
        for (int n : new int[]{1_000, 10_000, 100_000}) {
            int[] a = new int[n], b = new int[n];
            for (int i = 0; i < n; i++) { a[i] = i; b[i] = i; }

            long t1 = System.nanoTime();
            plainQuickFirstPivot(a, 0, n - 1);
            long d1 = System.nanoTime() - t1;

            long t2 = System.nanoTime();
            IntroSortFull.sort(b);
            long d2 = System.nanoTime() - t2;

            System.out.printf("n=%6d  plainQS=%9.3f ms  introsort=%9.3f ms  speedup=%.1fx%n",
                    n, d1 / 1e6, d2 / 1e6, (double) d1 / d2);
        }
    }
}
```

#### Python

```python
import time
import sys

sys.setrecursionlimit(1_000_000)


def plain_quick_first_pivot(arr, lo, hi):
    # Adversarial-vulnerable Quick Sort using arr[lo] as pivot
    pass


def benchmark():
    for n in [1_000, 10_000, 100_000]:
        data = list(range(n))  # sorted ascending — adversarial
        a, b = list(data), list(data)

        t1 = time.perf_counter()
        plain_quick_first_pivot(a, 0, n - 1)
        d1 = time.perf_counter() - t1

        t2 = time.perf_counter()
        intro_sort(b)
        d2 = time.perf_counter() - t2

        print(f"n={n:>6}  plainQS={d1*1000:>9.3f} ms  introsort={d2*1000:>9.3f} ms  speedup={d1/d2:.1f}x")


if __name__ == "__main__":
    benchmark()
```

- **Constraints:** Plain QS may hit Python's recursion limit at `n=10^5`; that itself is the demonstration.
- **Expected observation:** Intro Sort roughly 100–1000× faster on `n = 10^5` adversarial input. Plain QS hits `O(n²)`; Intro Sort hits the Heap Sort fallback and stays `O(n log n)`.

---

## Intermediate Tasks

### Task 6: Tune the insertion-sort cutoff (16, 32, 64)

Parameterize the cutoff. Run Intro Sort with cutoff `∈ {8, 16, 24, 32, 48, 64}` on `n = 10^5` random integers, 100 trials each. Plot or print mean and stddev wall-clock time. Identify the optimum on your machine and explain why it differs from libstdc++'s default of 16.

- Solve in 3 languages.
- Hint: optimum tends to be 12–24 on modern CPUs; differs by L1-cache size and pipeline depth.

---

### Task 7: Median-of-three vs ninther vs random pivot

Implement three pivot strategies as pluggable functions and run Intro Sort with each on `n = 10^6` items across five input distributions: uniform random, sorted ascending, sorted descending, all-equal, and a Musser-style "killer" sequence.

- Track (a) wall-clock time, (b) number of partitions, (c) number of Heap Sort fallbacks.
- Solve in 3 languages.
- Expected: median-of-three wins on most inputs; ninther wins on `n > 10^5`; random beats both only on adversarial input.

---

### Task 8: 3-way (Dutch National Flag) partition variant

Replace the 2-way partition with Dijkstra's 3-way partition (`< pivot`, `== pivot`, `> pivot`). Equal elements skip recursion entirely. Measure speedup on inputs with many duplicates: `n = 10^6` with only `{1, 5, 10, 100, 1000}` distinct values.

#### Go

```go
func partition3(arr []int, lo, hi int) (int, int) {
	pivot := arr[lo]
	lt, gt := lo, hi
	i := lo + 1
	for i <= gt {
		switch {
		case arr[i] < pivot:
			arr[lt], arr[i] = arr[i], arr[lt]
			lt++
			i++
		case arr[i] > pivot:
			arr[i], arr[gt] = arr[gt], arr[i]
			gt--
		default:
			i++
		}
	}
	return lt, gt
}

func intro3way(arr []int, lo, hi, depth int) {
	// recurse only on [lo..lt-1] and [gt+1..hi]; skip the equal-pivot run entirely
}
```

#### Java

```java
static int[] partition3(int[] a, int lo, int hi) {
    int pivot = a[lo];
    int lt = lo, gt = hi, i = lo + 1;
    while (i <= gt) {
        if (a[i] < pivot) {
            int t = a[lt]; a[lt] = a[i]; a[i] = t;
            lt++; i++;
        } else if (a[i] > pivot) {
            int t = a[i]; a[i] = a[gt]; a[gt] = t;
            gt--;
        } else {
            i++;
        }
    }
    return new int[]{lt, gt};
}
```

#### Python

```python
def partition3(arr, lo, hi):
    pivot = arr[lo]
    lt, gt = lo, hi
    i = lo + 1
    while i <= gt:
        if arr[i] < pivot:
            arr[lt], arr[i] = arr[i], arr[lt]
            lt += 1
            i += 1
        elif arr[i] > pivot:
            arr[i], arr[gt] = arr[gt], arr[i]
            gt -= 1
        else:
            i += 1
    return lt, gt
```

- **Constraints:** Verify that all-equal input runs in `O(n)`, not `O(n log n)`.
- **Expected observation:** 10–50× speedup vs 2-way partition when the data has only a few distinct values.

---

### Task 9: Instrument depth and insertion-fallback counts

Add four counters to your Intro Sort: `max_recursion_depth`, `partition_count`, `heap_fallback_count`, `insertion_fallback_count`. Export them after each sort. On `n = 10^6` random input, verify:

- `max_recursion_depth ≤ 2·⌊log₂ n⌋ = 40`.
- `heap_fallback_count == 0` with overwhelming probability (`O(1/n)` expected).
- `insertion_fallback_count` ≈ `n / cutoff = 62500`.

#### Go

```go
type Counters struct {
	MaxRecursionDepth     int
	PartitionCount        int
	HeapFallbackCount     int
	InsertionFallbackCount int
}

func IntroSortInstrumented(arr []int) Counters {
	c := &Counters{}
	// ... pass c through recursive calls
	return *c
}
```

- Solve in 3 languages.
- **Evaluation:** assertions on the three predicted values above.

---

### Task 10: Benchmark against `std::sort` / `Arrays.sort` / `sorted()`

Compare your hand-rolled Intro Sort against each language's standard library sort. For `n ∈ {10^3, 10^4, 10^5, 10^6}` and three distributions (random, sorted, reverse-sorted), measure mean and p99 latency over 100 runs.

- Solve in 3 languages.
- Expected: stdlib beats you by 1.5–3× because of (a) JIT/AOT specialization, (b) better tuning, (c) in Go/Rust, pdqsort improvements. Your goal: stay within 3× and identify the gap source.
- Hint: in Go, `sort.Ints` is pdqsort since 1.19 — not pure Intro Sort.

---

## Advanced Tasks

### Task 11: Pdqsort branchless block partition

Implement the pdqsort-style block partition: scan 64 elements at a time, compute offset arrays of "items to send left" and "items to send right" without any conditional branches inside the inner loop, then perform the swaps in a tight, predicted loop. Compare branch mispredict rate (use `perf stat -e branch-misses` on Linux) against the naïve partition.

#### Go (sketch)

```go
const blockSize = 64

func partitionBlock(arr []int, lo, hi int, pivot int) int {
	// Maintain two offset buffers; fill them branchlessly with
	// offsets[k] = (arr[lo+k] < pivot ? 1 : 0) accumulated.
	// Then swap pairs (left_off[i], right_off[i]) at the end.
}
```

- **Constraints:** Inner loop must be branchless — use arithmetic, not `if`.
- **Expected:** ~30% throughput improvement on random input; branch misprediction rate drops from ~50% (partition with random data) to ~1%.

---

### Task 12: Branch-predictor-friendly Intro Sort variant

Rewrite the entire Intro Sort to minimize hard-to-predict branches:

1. Replace `if (a[i] < pivot) swap(...)` with branchless conditional move equivalents.
2. Replace the per-call `if (depth == 0)` branch with a function-pointer table indexed by `depth == 0`.
3. Unroll the insertion-sort inner loop by 4.

Compare branch-miss rate, IPC, and wall-clock time against vanilla Intro Sort.

- Solve in 3 languages where supported (Go has limited branchless primitives; Java's JIT often does the work for you; Python is too high-level — use NumPy/Cython for a fair comparison).
- Expected: 15–25% speedup on random data; less on adversarial.

---

### Task 13: Parallel Intro Sort via Cilk-style partitioning

Implement a parallel Intro Sort using fork-join parallelism:

- After each partition, fork the larger half to a worker thread (Go: goroutine; Java: `ForkJoinPool`; Python: `concurrent.futures.ProcessPoolExecutor`).
- Below a threshold (~10k items per task), revert to sequential Intro Sort.
- Use a thread-local depth counter — depth limits are per-task.

#### Go

```go
package main

import (
	"math/bits"
	"sync"
)

const parThreshold = 10_000

func ParallelIntroSort(arr []int) {
	n := len(arr)
	if n < 2 {
		return
	}
	depthLimit := 2 * (bits.Len(uint(n)) - 1)
	var wg sync.WaitGroup
	wg.Add(1)
	parLoop(arr, 0, n-1, depthLimit, &wg)
	wg.Wait()
}

func parLoop(arr []int, lo, hi, depth int, wg *sync.WaitGroup) {
	defer wg.Done()
	// if range > parThreshold and depth > 0, fork the larger half
}

func main() {
	a := make([]int, 1_000_000)
	for i := range a {
		a[i] = len(a) - i
	}
	ParallelIntroSort(a)
}
```

#### Java

```java
import java.util.concurrent.RecursiveAction;
import java.util.concurrent.ForkJoinPool;

public class ParallelIntroSort {
    static final int PAR_THRESHOLD = 10_000;

    static class Task extends RecursiveAction {
        int[] arr;
        int lo, hi, depth;

        Task(int[] arr, int lo, int hi, int depth) {
            this.arr = arr; this.lo = lo; this.hi = hi; this.depth = depth;
        }

        @Override
        protected void compute() {
            // implement fork-join introsort
        }
    }

    public static void sort(int[] arr) {
        if (arr.length < 2) return;
        int depthLimit = 2 * (31 - Integer.numberOfLeadingZeros(arr.length));
        new ForkJoinPool().invoke(new Task(arr, 0, arr.length - 1, depthLimit));
    }
}
```

#### Python

```python
from concurrent.futures import ProcessPoolExecutor
import math

PAR_THRESHOLD = 10_000


def parallel_intro_sort(arr):
    # NOTE: Python GIL makes thread parallelism useless for CPU work.
    # Use ProcessPoolExecutor + numpy for genuine parallelism, or rewrite the hot loop in Cython.
    pass
```

- **Expected:** 3–5× speedup on 8 cores; load imbalance from unbalanced partitions caps it well below the ideal `8×`.
- **Discussion question:** Why does Java's `Arrays.parallelSort` use Merge Sort instead?

---

### Task 14: Cache-oblivious Intro Sort (sample-sort hybrid)

Implement a sample-sort variant that splits the input into `k = √n` buckets using `k - 1` sampled pivots, then runs Intro Sort within each bucket. Compare cache miss rate (use `perf stat -e cache-misses`) against vanilla Intro Sort on `n = 10^8` items.

- Solve in 3 languages.
- **Expected:** 2–3× speedup on data exceeding L3 cache; trade-off is `O(k)` extra memory for bucket boundaries.
- Reference: Frigo et al., *Cache-Oblivious Algorithms*, FOCS 1999.

---

### Task 15: Benchmark Intro Sort vs Tim Sort across 5 distributions

Implement a fair benchmark harness comparing your Intro Sort against your own Tim Sort (or `sorted()` in Python which IS Tim Sort) on:

1. Uniform random.
2. Sorted ascending.
3. Sorted descending.
4. 1000 random runs of length 100 concatenated (Tim Sort's sweet spot).
5. All elements equal.

For each: `n = 10^6`, 30 trials, report mean and p99. Plot speedup ratio. Identify the input where Tim Sort beats Intro Sort by the largest factor.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
	"time"
)

func benchAcrossDistributions(n int) {
	gens := map[string]func(int) []int{
		"uniform_random":     func(n int) []int { a := rand.Perm(n); return a },
		"sorted_ascending":   func(n int) []int { a := make([]int, n); for i := range a { a[i] = i }; return a },
		"sorted_descending":  func(n int) []int { a := make([]int, n); for i := range a { a[i] = n - i }; return a },
		"runs_of_100":        func(n int) []int { /* 100-element runs */ return nil },
		"all_equal":          func(n int) []int { a := make([]int, n); return a },
	}
	for name, gen := range gens {
		data := gen(n)
		introCopy := append([]int{}, data...)
		timCopy := append([]int{}, data...)

		t1 := time.Now()
		IntroSort(introCopy)
		d1 := time.Since(t1)

		t2 := time.Now()
		sort.SliceStable(timCopy, func(i, j int) bool { return timCopy[i] < timCopy[j] })
		d2 := time.Since(t2)

		fmt.Printf("%-20s  intro=%9v  tim=%9v  ratio=%.2fx\n", name, d1, d2, float64(d2)/float64(d1))
	}
}

func main() {
	benchAcrossDistributions(1_000_000)
}
```

#### Java

```java
import java.util.Arrays;

public class Task15 {
    public static void main(String[] args) {
        int n = 1_000_000;
        // build 5 distribution generators and benchmark each
        // Arrays.sort(int[])  uses Dual-Pivot Quicksort (Intro Sort family)
        // Arrays.sort(Object[]) uses Tim Sort
        // Compare two Integer[] arrays:
        //   - hand-rolled IntroSort (cast to int[])
        //   - Arrays.sort(Integer[]) (Tim Sort)
    }
}
```

#### Python

```python
import time
import random


def bench_across_distributions(n=1_000_000):
    gens = {
        "uniform_random":   lambda n: random.sample(range(n), n),
        "sorted_ascending": lambda n: list(range(n)),
        "sorted_descending": lambda n: list(range(n, 0, -1)),
        "runs_of_100":      lambda n: [v for _ in range(n // 100) for v in sorted(random.sample(range(1000), 100))],
        "all_equal":        lambda n: [7] * n,
    }
    for name, gen in gens.items():
        data = gen(n)
        a, b = list(data), list(data)

        t1 = time.perf_counter()
        intro_sort(a)
        d1 = time.perf_counter() - t1

        t2 = time.perf_counter()
        b.sort()  # Python's list.sort is Tim Sort
        d2 = time.perf_counter() - t2

        print(f"{name:<20}  intro={d1*1000:>8.2f} ms  tim={d2*1000:>8.2f} ms  ratio={d2/d1:.2f}x")


if __name__ == "__main__":
    bench_across_distributions()
```

- **Expected observations:**
  - `uniform_random`: Intro Sort beats Tim Sort by 1.2–1.5×.
  - `sorted_ascending`, `sorted_descending`: Tim Sort beats Intro Sort by **20–50×** — runs detection short-circuits to `O(n)`.
  - `runs_of_100`: Tim Sort wins by 5–10× — designed for exactly this case.
  - `all_equal`: Tim Sort wins if it detects a single run; with 3-way Intro Sort the gap shrinks.

---

## Benchmark Task

> Compare your Intro Sort against the standard library across n sizes on uniform random data.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
	"time"
)

func main() {
	for _, n := range []int{1_000, 10_000, 100_000, 1_000_000, 10_000_000} {
		data := rand.Perm(n)
		introCopy := append([]int{}, data...)
		stdCopy := append([]int{}, data...)

		t1 := time.Now()
		IntroSort(introCopy)
		d1 := time.Since(t1)

		t2 := time.Now()
		sort.Ints(stdCopy) // pdqsort since Go 1.19
		d2 := time.Since(t2)

		fmt.Printf("n=%9d  intro=%10v  std=%10v  ratio=%.2fx\n",
			n, d1, d2, float64(d1)/float64(d2))
	}
}
```

#### Java

```java
import java.util.Arrays;
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        Random rng = new Random(42);
        for (int n : new int[]{1_000, 10_000, 100_000, 1_000_000, 10_000_000}) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = rng.nextInt();
            int[] intro = data.clone(), std = data.clone();

            long t1 = System.nanoTime();
            IntroSortFull.sort(intro);
            long d1 = System.nanoTime() - t1;

            long t2 = System.nanoTime();
            Arrays.sort(std); // Dual-Pivot Quicksort
            long d2 = System.nanoTime() - t2;

            System.out.printf("n=%9d  intro=%10.2f ms  std=%10.2f ms  ratio=%.2fx%n",
                    n, d1 / 1e6, d2 / 1e6, (double) d1 / d2);
        }
    }
}
```

#### Python

```python
import time
import random


def benchmark():
    for n in [1_000, 10_000, 100_000, 1_000_000]:
        data = random.sample(range(n * 10), n)
        intro_copy = list(data)
        std_copy = list(data)

        t1 = time.perf_counter()
        intro_sort(intro_copy)
        d1 = time.perf_counter() - t1

        t2 = time.perf_counter()
        std_copy.sort()  # Tim Sort
        d2 = time.perf_counter() - t2

        print(f"n={n:>9}  intro={d1*1000:>10.2f} ms  std={d2*1000:>10.2f} ms  ratio={d1/d2:.2f}x")


if __name__ == "__main__":
    benchmark()
```

**Expected observation:** The standard library will outperform a textbook Intro Sort by 1.5–3× thanks to:

- JIT/AOT specialization for primitive types (Java, Go);
- Pdqsort's branchless block partition (Go 1.19+);
- Tim Sort's run detection on partially-sorted segments (Python);
- Hand-tuned cutoffs and pivot strategies refined over a decade of production use.

Your hand-rolled Intro Sort matches the asymptotic bound but loses a constant-factor race. That is fine — the point of writing it is to *understand* what `std::sort` does, not to beat it.
