# Count-Min Sketch — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a precise spec (and starter code where useful). Implement the Count-Min Sketch logic and validate against the evaluation criteria.
> **Always check your output against a brute-force exact counter (hash map / `Counter`) on small inputs, and confirm the estimate is NEVER below the true count and stays within `eps·N` for nearly all keys.**

---

## Beginner Tasks (5)

### Task 1 — Minimal Count-Min Sketch

**Problem.** Implement a `CountMinSketch(d, w)` with `add(key, c)` (increment one cell per row) and `estimate(key)` (min across rows). Use double hashing (`h_i = a + i·b`) so you need only two base hashes.

**Input / Output spec.**
- Construct with explicit `d` and `w`.
- `add` adds weight `c` (default 1) to one cell per row.
- `estimate` returns the minimum of the `d` cells the key maps to.

**Constraints.** Use exactly `d·w` counters; do not store keys. Normalize any negative modulo to a valid column index.

**Hint.** Keep `b` odd (`| 1`) so the row steps cover distinct columns.

**Starter — Go.**
```go
type CMS struct{ d, w int; t [][]uint64 }
func NewCMS(d, w int) *CMS { /* TODO allocate grid */ return nil }
func (c *CMS) Add(key string, cnt uint64) { /* TODO one cell per row */ }
func (c *CMS) Estimate(key string) uint64 { /* TODO min across rows */ return 0 }
```

**Starter — Java.**
```java
class CMS {
    int d, w; long[][] t;
    CMS(int d, int w) { /* TODO */ }
    void add(String key, long c) { /* TODO */ }
    long estimate(String key) { /* TODO */ return 0; }
}
```

**Starter — Python.**
```python
class CMS:
    def __init__(self, d, w): ...        # TODO grid
    def add(self, key, c=1): ...         # TODO one cell per row
    def estimate(self, key): ...         # TODO min across rows
```

- **Expected Output:** for stream `["a","a","b"]`, `estimate("a") == 2`, `estimate("b") == 1`, `estimate("z") <= small`.
- **Evaluation:** correctness, never-undercount property, `O(d)` per op.

---

### Task 2 — Size the grid from `eps` and `delta`

**Problem.** Add a constructor `fromError(eps, delta)` that sets `w = ceil(e/eps)`, `d = ceil(ln(1/delta))`. Print the resulting `d`, `w`, and total cells.

**Constraints.** Use the natural log and Euler's number from the standard library.

- **Expected Output:** `fromError(0.001, 0.01)` → `d=5, w=2719, cells=13595`.
- **Evaluation:** correct formulas; matches the table in `middle.md`.

---

### Task 3 — Compare against an exact counter

**Problem.** Build a CMS and an exact hash map over the same stream of 1000 items drawn from 20 distinct keys with skewed frequencies. For each distinct key, print `true`, `estimate`, and `overcount = estimate - true`.

**Constraints.** Assert `estimate >= true` for **every** key (fail loudly if not). Report the maximum overcount and compare it to `eps·N`.

- **Expected Output:** all overcounts `>= 0`; max overcount `<= eps·N` for a well-sized grid.
- **Evaluation:** demonstrates overcount-only and the error bound empirically.

---

### Task 4 — Weighted updates

**Problem.** Extend `add(key, c)` to accept arbitrary positive weights (e.g., byte counts per flow). Feed `[("a",10),("b",3),("a",5)]` and verify `estimate("a") == 15`, `estimate("b") == 3`.

**Constraints.** Use 64-bit counters to avoid overflow on large weights.

- **Expected Output:** `a → 15`, `b → 3`.
- **Evaluation:** correct weighted accumulation; no overflow.

---

### Task 5 — Empty and unseen keys

**Problem.** Query a freshly-constructed sketch (no updates) and a never-inserted key after some updates. Confirm the empty-sketch query returns 0 and document when an unseen key can return a small nonzero overcount.

**Constraints.** Do not special-case unseen keys — the min over zero/low cells should handle it naturally.

- **Expected Output:** empty sketch → 0 for any key; unseen key after updates → 0 or a small overcount.
- **Evaluation:** correct handling of edge cases; clear explanation of the collision overcount.

---

## Intermediate Tasks (5)

### Task 6 — Conservative update (minimal increment)

**Problem.** Add `conservativeAdd(key, c)`: read the current estimate `m`, then raise each of the key's cells to `max(cell, m + c)`. On a skewed stream, compare the average overcount of plain vs conservative update over all distinct keys.

**Constraints.** Prove empirically that conservative never undercounts and that its overcount is `<=` plain's for every key.

- **Expected Output:** conservative average overcount noticeably lower than plain on Zipfian data.
- **Evaluation:** correctness of the `max` rule; measured bias reduction.

---

### Task 7 — Heavy hitters with a min-heap

**Problem.** Implement `topK(stream, k, eps, delta)` returning the `k` most frequent items using a CMS paired with a heap/map of top-`k` candidates (see `interview.md`). Sort the result by estimated frequency descending.

**Constraints.** Do not store all distinct keys — only the sketch plus at most `k` candidates.

- **Expected Output:** for `["a","b","a","c","a","b","a","d","b","a"]`, `k=2` → `["a","b"]`.
- **Evaluation:** correct top-`k`; no full key storage; handles ties reasonably.

---

### Task 8 — Mergeability

**Problem.** Split a stream into two halves, build a separate CMS over each (identical `d`, `w`, seeds), then `merge` them by element-wise addition. Verify every estimate equals that of a single CMS over the full stream.

**Constraints.** Merging requires identical shape and hash seeds; assert they match before merging.

- **Expected Output:** `merged.estimate(k) == full.estimate(k)` for all `k`.
- **Evaluation:** correct additive merge; demonstrates distributed-counting foundation.

---

### Task 9 — Count-Min-Mean estimator

**Problem.** Add `estimateCMM(key)`: for each row compute the de-biased residual `cell - (N - cell)/(w-1)`, take the **median** across rows, and clamp to `[0, estimate_min]`. Compare CM vs CMM error against exact counts, especially for low-frequency keys.

**Constraints.** Track total `N`. Use odd `d` (or average the two middle residuals) for a clean median.

- **Expected Output:** CMM error `<=` CM error on average for tail keys; CMM may dip below true (no strict upper bound).
- **Evaluation:** correct de-biasing; demonstrates the bias/guarantee trade-off.

---

### Task 10 — Hash quality test

**Problem.** Verify your `d` hash functions are effectively independent: for many random keys, count how often two distinct keys collide in *all* rows simultaneously, and compare to the expected `(1/w)^d`. Show that reusing one hash for all rows wildly inflates the all-row collision rate.

**Constraints.** Run with both proper double-hashing and a deliberately broken single-hash version.

- **Expected Output:** double-hashing ≈ `(1/w)^d`; single-hash ≈ `1/w` (much higher) — demonstrating why depth needs independence.
- **Evaluation:** correct measurement; clear contrast.

---

## Advanced Tasks (5)

### Task 11 — Decaying / windowed sketch

**Problem.** Add exponential decay: a `decay(gamma)` that multiplies every cell by `gamma < 1`, applied every `T` updates. Show that on an infinite-ish stream the effective `N` (and thus absolute error) stays bounded while recent items dominate the estimates.

**Constraints.** Counters may become fractional — choose integer rounding or float cells and document the choice.

- **Expected Output:** old items' estimates fade; recent items dominate; `N` plateaus.
- **Evaluation:** correct decay; bounded error on long streams.

---

### Task 12 — Range queries via a dyadic hierarchy

**Problem.** Over a numeric domain of size `U = 2^L`, build `L+1` CMS levels (level `j` counts dyadic intervals of width `2^j`). Implement `rangeCount(lo, hi)` by decomposing `[lo, hi]` into `O(log U)` dyadic intervals and summing their min-estimates.

**Constraints.** Verify against an exact prefix-sum array on small `U`. Note the error grows to `~eps·N·log U`.

- **Expected Output:** approximate range counts within `~eps·N·log U` of exact.
- **Evaluation:** correct dyadic decomposition; error within the stated bound.

---

### Task 13 — Approximate quantiles from CMS

**Problem.** Using the dyadic structure from Task 12, implement `quantile(phi)` by binary-searching the value `x` where the estimated prefix count `rangeCount(0, x)` first reaches `phi·N`. Compare to exact quantiles.

**Constraints.** Account for the monotonic-but-noisy prefix sums; clamp/round as needed.

- **Expected Output:** estimated median/p95 close to exact on test data.
- **Evaluation:** correct binary search over prefix sums; reasonable accuracy.

---

### Task 14 — Thread-safe high-throughput sketch

**Problem.** Make the sketch safe under concurrent updates. Implement two strategies: (a) a single lock, and (b) per-worker local sketches merged periodically. Benchmark throughput of both under many concurrent producers.

**Constraints.** Strategy (b) must use **additive** updates so the periodic merge is correct.

- **Expected Output:** strategy (b) scales far better than (a) at high concurrency.
- **Evaluation:** correctness under concurrency; measured throughput contrast; correct merge.

---

### Task 15 — CMS vs Misra-Gries vs Space-Saving bake-off

**Problem.** On the same skewed stream, run a CMS+heap, a Misra-Gries (`22-randomized-algorithms/08`), and a Space-Saving (`22-randomized-algorithms/11`) summary with comparable memory. Report, for the top-10 keys: estimate vs true, error direction, and which structure best ranks the top-`k`.

**Constraints.** Match memory budgets as closely as possible; report space used by each.

- **Expected Output:** CMS overcounts, Misra-Gries undercounts, Space-Saving overcounts-but-ranks; a table of errors and a recommendation per use case.
- **Evaluation:** correct implementations; insightful comparison of error directions and ranking quality.

---

## Benchmark Task

> Compare update throughput across all 3 languages. Build a sketch sized from `eps=0.001, delta=0.01`, then time many updates of skewed keys.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	cms := NewCMS(5, 2719) // d, w from eps=0.001, delta=0.01
	keys := make([]string, 100000)
	for i := range keys {
		keys[i] = fmt.Sprintf("key-%d", rand.Intn(5000))
	}
	start := time.Now()
	for _, k := range keys {
		cms.Add(k, 1)
	}
	d := time.Since(start)
	fmt.Printf("100k updates: %v (%.0f ns/op)\n", d, float64(d.Nanoseconds())/100000)
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        CMS cms = new CMS(5, 2719);
        Random r = new Random();
        String[] keys = new String[100000];
        for (int i = 0; i < keys.length; i++) keys[i] = "key-" + r.nextInt(5000);
        long start = System.nanoTime();
        for (String k : keys) cms.add(k, 1);
        long ns = System.nanoTime() - start;
        System.out.printf("100k updates: %.0f ns/op%n", ns / 100000.0);
    }
}
```

#### Python

```python
import random
import time

cms = CMS(5, 2719)  # d, w from eps=0.001, delta=0.01
keys = [f"key-{random.randint(0, 5000)}" for _ in range(100_000)]
start = time.perf_counter()
for k in keys:
    cms.add(k, 1)
dur = time.perf_counter() - start
print(f"100k updates: {dur*1000:.1f} ms ({dur/100_000*1e9:.0f} ns/op)")
```

> **Observation to confirm:** update and query time are `O(d)` and independent of `N` and of the number of distinct keys. Memory stays flat at `d·w` counters. The only thing that grows with `N` is the *error magnitude* `eps·N` — never the time or the space.
