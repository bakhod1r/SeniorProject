# Quickselect and the k-th Order Statistic — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Convention: "k-th smallest" is 1-based in prose; convert to a 0-based index in code.

## Beginner Tasks

**Task 1:** Implement Quickselect from scratch (iterative, random pivot, Lomuto partition) to return the k-th smallest element (1-based k). No library selection functions.

#### Go

```go
package main

import "fmt"

func kthSmallest(arr []int, k int) int {
	// TODO: convert k (1-based) to a 0-based index, then partition and
	// recurse/loop into only the side containing it. Use a random pivot.
	return 0
}

func main() {
	fmt.Println(kthSmallest([]int{7, 2, 1, 6, 8, 5, 3}, 3)) // expect 3
}
```

#### Java

```java
public class Task1 {
    static int kthSmallest(int[] arr, int k) {
        // TODO: implement Quickselect (iterative, random pivot)
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(kthSmallest(new int[]{7, 2, 1, 6, 8, 5, 3}, 3)); // 3
    }
}
```

#### Python

```python
def kth_smallest(arr, k):
    # TODO: implement Quickselect (iterative, random pivot)
    pass

if __name__ == "__main__":
    print(kth_smallest([7, 2, 1, 6, 8, 5, 3], 3))  # 3
```

- **Constraints:** expected O(n); O(1) extra space (iterative); validate `1 <= k <= n`.
- **Expected Output:** `3`
- **Evaluation:** correctness, random-pivot usage, edge cases (single element, k at both ends).

**Task 2:** Find the **median** of an array using Quickselect. For even-length arrays, return the average of the two middle order statistics (the (n/2)-th and (n/2 + 1)-th smallest).
- Provide starter code in all 3 languages.
- Constraints: do **not** fully sort; expected O(n). Return a float for the even case.

**Task 3:** Find the **minimum and maximum** of an array. First do it with two Quickselect calls (k=1 and k=n), then write an optimal version using `⌈3n/2⌉ − 2` comparisons (pair up elements). Compare comparison counts.
- Constraints: count and print the number of comparisons for both versions.

**Task 4:** Implement **unordered top-k smallest**: after a single Quickselect at rank k, return `arr[:k]` (the k smallest, any order). Verify the partition invariant by asserting `max(arr[:k]) <= min(arr[k:])`.
- Constraints: expected O(n); must not sort the whole array.

**Task 5:** Add input validation and the 0-based/1-based conversion explicitly. Reject `k < 1`, `k > n`, and empty arrays with a clear error/exception. Add a test that proves Quickselect does **not** mutate the caller's array when you pass a copy.
- Constraints: provide a brute-force "sort then index" oracle and assert both agree on 100 random inputs.

## Intermediate Tasks

**Task 6:** Implement **3-way (Dutch National Flag) Quickselect** that stays O(n) on arrays with many duplicates. When k falls inside the equal region, return immediately. Provide starter code in all 3 languages.
- Constraints: test on `[4,4,4,4,4]`, `[4,4,1,4,2,4,3]`; confirm linear behavior (count partitions).

**Task 7:** Implement **partial sort**: return the k smallest elements **in ascending order**. Provide two implementations — (a) Quickselect then sort the front k (O(n + k log k)); (b) a bounded max-heap of size k (O(n log k)). Compare their runtimes for small k and large k.

**Task 8:** Implement **streaming top-k** over an iterator/stream you cannot fully buffer, using a bounded min-heap of size k. It must use O(k) memory and one pass. Test that it produces the same top-k as sorting the full (small) input.

**Task 9:** Demonstrate the **O(n²) worst case**: write a deterministic first-element-pivot Quickselect, feed it already-sorted input, and count comparisons for n = 100, 1000, 10000. Plot/print that comparisons grow ~n². Then show a random-pivot version stays ~linear on the same input.

**Task 10:** Implement **introselect**: random/median-of-three pivot Quickselect that tracks recursion depth and switches to median-of-medians once depth exceeds `2·⌊log2 n⌋`. Add a counter for how often the fallback fires and verify it is rare on random input.

## Advanced Tasks

**Task 11:** Implement **median-of-medians (BFPRT)** selection with guaranteed worst-case O(n). Use groups of 5. Verify correctness against a sort-based oracle on 1000 random inputs, then count comparisons and confirm they grow linearly (and compare the constant to randomized Quickselect). Provide starter code in all 3 languages.

**Task 12:** Implement the **weighted median**: given values with positive weights, find the value `x` such that the total weight of items `< x` is `< W/2` and the total weight of items `> x` is `<= W/2` (W = sum of weights). Adapt Quickselect's partition to accumulate weights and recurse into the correct side. Expected O(n).

**Task 13:** Implement a **distributed median by count-and-narrow**: simulate M shards (M arrays). Each round, broadcast a candidate value, have each shard count how many of its elements are below it, sum the counts, and binary-search the candidate over the value range until the exact global median is pinned. Report the number of rounds and total per-shard passes.

**Task 14:** Implement **Floyd–Rivest selection**: sample a small subset, use it to choose two pivots that tightly bracket the target rank, partition into three regions, and recurse into the (usually tiny) middle region. Empirically compare its comparison count for the median against plain Quickselect (target: closer to ~1.5n).

**Task 15:** Build a **selection microservice** API: `kth(dataset_id, k)` and `topk(dataset_id, k)`. It must (a) snapshot/copy the dataset before selecting so concurrent reads are safe, (b) use introselect for a worst-case guarantee, (c) enforce an input-size cap and a per-call timeout, and (d) expose metrics (p99 latency, fallback rate, max depth). Provide starter code in all 3 languages.

## Benchmark Task

> Compare performance across all 3 languages: time finding the **median** via Quickselect vs full sort, for growing n.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
	"time"
)

func medianQuickselect(a []int) int {
	lo, hi, k := 0, len(a)-1, (len(a)-1)/2
	for lo < hi {
		p := partition(a, lo, hi)
		if p == k {
			break
		} else if k < p {
			hi = p - 1
		} else {
			lo = p + 1
		}
	}
	return a[k]
}

func partition(a []int, lo, hi int) int {
	idx := lo + rand.Intn(hi-lo+1)
	a[idx], a[hi] = a[hi], a[idx]
	pivot, i := a[hi], lo-1
	for j := lo; j < hi; j++ {
		if a[j] < pivot {
			i++
			a[i], a[j] = a[j], a[i]
		}
	}
	a[i+1], a[hi] = a[hi], a[i+1]
	return i + 1
}

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		data := make([]int, n)
		for i := range data {
			data[i] = rand.Intn(1 << 30)
		}
		qs := append([]int(nil), data...)
		start := time.Now()
		medianQuickselect(qs)
		tQS := time.Since(start)

		st := append([]int(nil), data...)
		start = time.Now()
		sort.Ints(st)
		_ = st[(n-1)/2]
		tSort := time.Since(start)

		fmt.Printf("n=%8d  quickselect=%8v  sort=%8v\n", n, tQS, tSort)
	}
}
```

#### Java

```java
import java.util.Arrays;
import java.util.Random;

public class Benchmark {
    static final Random RNG = new Random();

    static int medianQuickselect(int[] a) {
        int lo = 0, hi = a.length - 1, k = (a.length - 1) / 2;
        while (lo < hi) {
            int p = partition(a, lo, hi);
            if (p == k) break;
            else if (k < p) hi = p - 1;
            else lo = p + 1;
        }
        return a[k];
    }

    static int partition(int[] a, int lo, int hi) {
        int idx = lo + RNG.nextInt(hi - lo + 1), t = a[idx];
        a[idx] = a[hi]; a[hi] = t;
        int pivot = a[hi], i = lo - 1;
        for (int j = lo; j < hi; j++)
            if (a[j] < pivot) { i++; int s = a[i]; a[i] = a[j]; a[j] = s; }
        int s = a[i + 1]; a[i + 1] = a[hi]; a[hi] = s;
        return i + 1;
    }

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = RNG.nextInt(1 << 30);

            int[] qs = data.clone();
            long s = System.nanoTime();
            medianQuickselect(qs);
            long tQS = System.nanoTime() - s;

            int[] st = data.clone();
            s = System.nanoTime();
            Arrays.sort(st);
            long tSort = System.nanoTime() - s;

            System.out.printf("n=%8d  quickselect=%6.2f ms  sort=%6.2f ms%n",
                n, tQS / 1e6, tSort / 1e6);
        }
    }
}
```

#### Python

```python
import random, timeit

def median_quickselect(a):
    lo, hi, k = 0, len(a) - 1, (len(a) - 1) // 2
    while lo < hi:
        p = partition(a, lo, hi)
        if p == k: break
        elif k < p: hi = p - 1
        else: lo = p + 1
    return a[k]

def partition(a, lo, hi):
    idx = random.randint(lo, hi)
    a[idx], a[hi] = a[hi], a[idx]
    pivot, i = a[hi], lo - 1
    for j in range(lo, hi):
        if a[j] < pivot:
            i += 1
            a[i], a[j] = a[j], a[i]
    a[i + 1], a[hi] = a[hi], a[i + 1]
    return i + 1

for n in [1_000, 10_000, 100_000, 1_000_000]:
    data = [random.randrange(1 << 30) for _ in range(n)]
    tQS = timeit.timeit(lambda: median_quickselect(data[:]), number=3) / 3
    tSort = timeit.timeit(lambda: sorted(data)[(n - 1) // 2], number=3) / 3
    print(f"n={n:>8}  quickselect={tQS*1000:7.2f} ms  sort={tSort*1000:7.2f} ms")
```

**Expectation:** Quickselect's O(n) should pull ahead of the O(n log n) sort as n grows (note: Python's built-in `sorted` is C-optimized, so the crossover appears later there than in Go/Java).
