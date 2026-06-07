# t-digest & Streaming Quantiles — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> For each task: write the code, test against an exact (sort-based) baseline on small data, and note the time/space complexity.

## Beginner Tasks

**Task 1:** Implement an exact quantile function `exactQuantile(values, q)` that sorts the input and returns the value at rank `q·n`. This is your **ground-truth oracle** — every later task is validated against it.

#### Go

```go
package main

import "sort"

func exactQuantile(values []float64, q float64) float64 {
	a := append([]float64{}, values...)
	sort.Float64s(a)
	idx := int(q * float64(len(a)-1))
	return a[idx]
}

func main() {
	// test with [1..100], p50 should be ~50
}
```

#### Java

```java
import java.util.Arrays;

public class Task1 {
    static double exactQuantile(double[] values, double q) {
        double[] a = values.clone();
        Arrays.sort(a);
        int idx = (int) (q * (a.length - 1));
        return a[idx];
    }

    public static void main(String[] args) {
        // test with [1..100], p50 should be ~50
    }
}
```

#### Python

```python
def exact_quantile(values, q):
    a = sorted(values)
    idx = int(q * (len(a) - 1))
    return a[idx]

if __name__ == "__main__":
    # test with range(1, 101), p50 should be ~50
    pass
```

- **Constraints:** must work for empty input (return NaN/None), single value, and duplicates.
- **Expected Output:** for `[1..100]`, `p50 ≈ 50`, `p99 ≈ 99`.
- **Evaluation:** correctness vs. hand-checked values.

**Task 2:** Implement a single **centroid** type with a `merge(value)` method that updates the running `(mean, count)` by weighted average. Verify that merging values `[10, 20, 30]` into one centroid gives `mean = 20, count = 3`.

**Task 3:** Build a **naive bounded summary**: keep at most `K` centroids, each holding at most `M` values; when a value arrives, fold it into the nearest non-full centroid or start a new one. Compare its p50/p99 against `exactQuantile` on `[1..1000]`.

**Task 4:** Implement the **cumulative-rank sweep**: given a sorted list of `(mean, count)` centroids and a target quantile `q`, return the index of the centroid whose cumulative range contains rank `q·n`. Test on a hand-built centroid list.

**Task 5:** Implement **quantile interpolation**: given the straddling centroids from Task 4, return the interpolated value (straight line between centroid centers). Verify your p50 on `[1..1000]` is within 1% of exact.

## Intermediate Tasks

**Task 6:** Implement a full **`q(1−q)` size-limit t-digest** with `add(x)` and `quantile(q)` (as in `junior.md`). On a stream of 100,000 standard-normal values, report the absolute rank error at p50, p90, p99, and p999. Confirm the **error shrinks toward the tails**.

**Task 7:** Replace the `q(1−q)` size rule with the **arcsin scale function** `k1(q) = (δ/2π)·arcsin(2q−1)` and the constraint `k1(q_right) − k1(q_left) ≤ 1`. Compare tail error to Task 6 at the same compression.

**Task 8:** Add **`min`/`max` tracking** so that `quantile(0.0)` and `quantile(1.0)` return the exact extremes. Feed a stream containing one huge outlier and confirm the max is preserved (not smoothed into a centroid mean).

**Task 9:** Implement **buffered batch insertion**: collect values into a buffer of size `B`, and only sort + re-cluster when the buffer fills. Benchmark throughput (values/sec) against the one-at-a-time version from Task 6.

**Task 10:** Implement **`merge(other)`** by concatenating centroid lists, sorting by mean, and re-clustering under the size rule. Build two digests from disjoint halves of `[1..10000]`, merge them, and confirm the merged p99 matches a digest built from the whole range.

## Advanced Tasks

**Task 11:** Demonstrate the **"averaging percentiles is wrong" pitfall** empirically. Create two streams with very different traffic volumes and distributions; compute (a) the average of their per-stream p99s and (b) the p99 of their merged digest. Quantify how far the average is from the correct merged answer.

**Task 12:** Implement a **time-windowed quantile store**: keep one digest per 1-second interval, and answer "p99 over the last N seconds" by merging the relevant interval digests at query time. Verify against an exact computation over the same window.

**Task 13:** Implement **serialization/deserialization** of a digest (centroid array + `n` + `min` + `max`) to a compact byte buffer and back. Round-trip a digest and confirm its quantiles are unchanged. Report the serialized size for compression 100.

**Task 14:** Build a **comparison harness** that, on the same 1,000,000-value stream, reports memory and rank error for: (a) exact sort, (b) a fixed 50-bucket histogram, (c) t-digest at compression 100. Tabulate tail accuracy per kilobyte.

**Task 15:** Construct an **adversarial input** (e.g. strictly increasing or carefully ordered values) that degrades t-digest accuracy more than random order does. Measure the worst-case rank error you can induce and explain why this is the empirical (not provable) weakness discussed in `professional.md`.

## Benchmark Task

> Compare insertion throughput and final memory across all 3 languages, building a t-digest from a large stream.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		td := New(100) // your t-digest from Task 6/7
		start := time.Now()
		for i := 0; i < n; i++ {
			td.Add(rand.NormFloat64())
		}
		elapsed := time.Since(start)
		fmt.Printf("n=%8d: %6.1f ms, p99 ~ %.3f\n",
			n, float64(elapsed.Milliseconds()), td.Quantile(0.99))
	}
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        Random r = new Random();
        for (int n : sizes) {
            TDigest td = new TDigest(100); // your t-digest
            long start = System.nanoTime();
            for (int i = 0; i < n; i++) td.add(r.nextGaussian());
            long ms = (System.nanoTime() - start) / 1_000_000;
            System.out.printf("n=%8d: %6d ms, p99 ~ %.3f%n", n, ms, td.quantile(0.99));
        }
    }
}
```

#### Python

```python
import random, time

for n in [1000, 10000, 100000, 1000000]:
    td = TDigest(100)  # your t-digest
    start = time.time()
    for _ in range(n):
        td.add(random.gauss(0, 1))
    ms = (time.time() - start) * 1000
    print(f"n={n:>8}: {ms:7.1f} ms, p99 ~ {td.quantile(0.99):.3f}")
```

- **Expected behavior:** time grows roughly linearly with `n`, but the **centroid count (memory) stays flat** near the compression value. The p99 estimate stabilizes quickly and barely moves as `n` grows.
- **Evaluation:** report values/sec for each language and confirm memory independence from `n`.
