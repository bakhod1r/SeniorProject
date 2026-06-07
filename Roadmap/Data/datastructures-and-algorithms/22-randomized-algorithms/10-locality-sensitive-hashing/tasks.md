# Locality-Sensitive Hashing (LSH) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Always validate against a **brute-force nearest-neighbor oracle** on small data before trusting LSH at scale.

## Beginner Tasks

**Task 1:** Implement a brute-force nearest-neighbor oracle: given a list of vectors and a query, return the id of the vector with the highest cosine similarity. This is your correctness baseline for every later task.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func cosine(a, b []float64) float64 {
	var dot, na, nb float64
	for i := range a {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

func bruteNN(items [][]float64, q []float64) (int, float64) {
	best, bestSim := -1, -2.0
	for i, x := range items {
		if s := cosine(q, x); s > bestSim {
			bestSim, best = s, i
		}
	}
	return best, bestSim
}

func main() {
	items := [][]float64{{1, 0}, {0, 1}, {0.9, 0.1}}
	id, s := bruteNN(items, []float64{0.95, 0.05})
	fmt.Println(id, s) // expect 0 or 2
}
```

#### Java

```java
public class Task1 {
    static double cosine(double[] a, double[] b) {
        double dot = 0, na = 0, nb = 0;
        for (int i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    static int bruteNN(double[][] items, double[] q) {
        int best = -1; double bestSim = -2;
        for (int i = 0; i < items.length; i++) {
            double s = cosine(q, items[i]);
            if (s > bestSim) { bestSim = s; best = i; }
        }
        return best;
    }

    public static void main(String[] args) {
        double[][] items = {{1,0},{0,1},{0.9,0.1}};
        System.out.println(bruteNN(items, new double[]{0.95,0.05}));
    }
}
```

#### Python

```python
import math


def cosine(a, b):
    dot = sum(p * q for p, q in zip(a, b))
    na = math.sqrt(sum(p * p for p in a))
    nb = math.sqrt(sum(q * q for q in b))
    return dot / (na * nb)


def brute_nn(items, q):
    best, best_sim = -1, -2.0
    for i, x in enumerate(items):
        s = cosine(q, x)
        if s > best_sim:
            best_sim, best = s, i
    return best, best_sim


if __name__ == "__main__":
    items = [[1, 0], [0, 1], [0.9, 0.1]]
    print(brute_nn(items, [0.95, 0.05]))
```

- **Constraints:** handle the zero vector (define similarity 0 or skip). Reject mismatched dimensions.
- **Expected Output:** the index of the most-similar vector (`0` or `2` above).
- **Evaluation:** correctness on identical, orthogonal, and near-duplicate vectors.

**Task 2:** Implement a single random-hyperplane hash bit: given a vector `x` and a random normal `r`, return `1` if `x·r ≥ 0` else `0`. Provide starter code in all 3 languages.
- Constraints: use a fixed seed so the plane is reproducible; verify two near-parallel vectors usually share the bit.

**Task 3:** Build an `m`-bit hyperplane signature and store vectors in a dictionary keyed by the full signature. Implement a query that returns all items in the query's bucket. Verify a near-duplicate shares the query's bucket for small `m`.
- Constraints: generate the `m` planes once; never regenerate per query.

**Task 4:** Empirically confirm `P[same bit] = 1 - θ/π`: for several fixed angles `θ`, generate two unit vectors at that angle, draw many random planes, and report the observed fraction of agreeing bits. It should track `1 - θ/π`.

**Task 5:** Implement `estimate_cosine_from_signature(sigA, sigB)` that estimates the angle as `θ̂ = π · (fraction of differing bits)` and converts to cosine `cos(θ̂)`. Compare against exact cosine for several pairs with `m = 256` bits.

## Intermediate Tasks

**Task 6:** Implement **banded LSH** over hyperplane signatures: split the `k`-bit signature into `b` bands of `r` bits, hash each band into its own table, and a query unions candidate ids across all bands. Provide starter code in all 3 languages.
- Constraints: `k = b·r`; de-duplicate candidate ids; re-rank by exact cosine.

**Task 7:** Implement the **S-curve** `P = 1 - (1 - p^r)^b` and print a table of `P` vs `p ∈ {0.1,…,0.9}` for `(b,r) = (5,4)`, `(10,2)`, and `(2,10)`. Identify which configuration has the highest threshold.

**Task 8:** Write a **threshold picker**: given a budget `k` and a target threshold `t`, return the `(b, r)` with `b·r = k` minimizing `|(1/b)^{1/r} - t|`. Verify it returns `(8, 16)` for `k = 128, t = 0.8`.

**Task 9:** Implement **multiple hash tables (`L`)**: build `L` independent banded indexes and union candidates across all of them. Measure how recall improves with `L` against the brute-force oracle on random data.

**Task 10:** Implement the **p-stable (Euclidean) hash** `h(x) = floor((a·x + c)/w)` with Gaussian `a`, uniform `c ∈ [0,w)`, and tunable width `w`. Build an LSH index for L2 distance and verify nearby points usually share a bucket while far points do not.

## Advanced Tasks

**Task 11:** Implement **multi-probe LSH** for hyperplane bits: for a query, generate a probe sequence that flips the *least-confident* bits first (smallest `|x·r|`), and gather candidates from the probed buckets. Show that with fewer tables, multi-probe matches the recall of plain LSH with more tables. Provide starter code in all 3 languages.
- Constraints: cap the number of probes per query; report recall vs probe budget.

**Task 12:** Build an end-to-end **near-duplicate detector** using MinHash-LSH banding (reuse signatures from [`../02-minhash`](../02-minhash)): shingle short documents, MinHash to signatures, band into candidates, then confirm with exact Jaccard and report clusters with `J ≥ 0.7`.

**Task 13:** **Measure recall vs selectivity:** over random high-dimensional data with known true neighbors, sweep `(b, r, L)` and plot (or tabulate) recall@10 against candidates/N. Identify the cheapest configuration achieving recall ≥ 0.95.

**Task 14:** Make the index **incremental and concurrent**: support `insert(id, vec)`, `delete(id)` via tombstones, and concurrent `query`, guarded by a read/write lock. Verify tombstoned ids never appear in candidate sets and that a compaction pass physically removes them.

**Task 15:** Implement and verify the **O(N^ρ) intuition empirically**: for a fixed family, estimate `p₁, p₂` from sampled near/far pairs, compute `ρ = ln p₁/ln p₂`, then measure how the candidate-count grows as `N` grows (it should scale roughly like `N^ρ`, sublinearly). Report the fitted exponent.

## Benchmark Task

> Compare query latency and recall across all 3 languages as `N` grows (LSH should stay sublinear).

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	d := 64
	for _, n := range []int{1000, 10000, 100000} {
		idx := NewLSH(8, 8, d, 1) // your banded LSH (k = 64 bits)
		rng := rand.New(rand.NewSource(7))
		for i := 0; i < n; i++ {
			v := make([]float64, d)
			for j := range v {
				v[j] = rng.NormFloat64()
			}
			idx.Add(i, v)
		}
		q := make([]float64, d)
		for j := range q {
			q[j] = rng.NormFloat64()
		}
		start := time.Now()
		for i := 0; i < 1000; i++ {
			idx.Query(q)
		}
		fmt.Printf("N=%7d: %.3f ms/query\n", n, float64(time.Since(start).Microseconds())/1000000.0)
	}
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int d = 64;
        for (int n : new int[]{1000, 10000, 100000}) {
            LSH idx = new LSH(8, 8, d, 1); // your banded LSH
            Random rng = new Random(7);
            for (int i = 0; i < n; i++) {
                double[] v = new double[d];
                for (int j = 0; j < d; j++) v[j] = rng.nextGaussian();
                idx.add(i, v);
            }
            double[] q = new double[d];
            for (int j = 0; j < d; j++) q[j] = rng.nextGaussian();
            long start = System.nanoTime();
            for (int i = 0; i < 1000; i++) idx.query(q);
            System.out.printf("N=%7d: %.3f ms/query%n", n, (System.nanoTime() - start) / 1000.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import random
import timeit


def build(n, d):
    idx = LSH(b=8, r=8, d=d, seed=1)  # your banded LSH
    rng = random.Random(7)
    for i in range(n):
        idx.add(i, [rng.gauss(0, 1) for _ in range(d)])
    q = [rng.gauss(0, 1) for _ in range(d)]
    return idx, q


for n in [1000, 10000, 100000]:
    idx, q = build(n, 64)
    t = timeit.timeit(lambda: idx.query(q), number=200)
    print(f"N={n:7d}: {t / 200 * 1000:.3f} ms/query")
```

> **Expected:** query time grows far slower than linearly in `N` (sublinear), confirming the LSH advantage — the query touches only its buckets, not all `N` items. Compare against a brute-force scan to confirm both the speedup and the recall trade-off.
