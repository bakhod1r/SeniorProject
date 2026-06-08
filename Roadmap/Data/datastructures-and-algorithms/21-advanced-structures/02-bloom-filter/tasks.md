# Bloom Filter — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Each task lists constraints, expected behavior, and how you'll be evaluated. Always verify the core invariant after every task: **a "no" must always be correct (no false negatives).**

---

## Beginner Tasks

### Task 1 — Implement a fixed-size Bloom filter from scratch

Implement a Bloom filter with a given `m` (bits) and `k` (hash functions). Provide `add(item)` and `mightContain(item)`. Use double hashing (`g_i = h1 + i·h2 mod m`) to derive the `k` indices from two base hashes. Pack bits into 64-bit words (or a `bytearray`), not one boolean per bit.

#### Go

```go
package main

type Bloom struct {
	// bits []uint64; m, k uint64
}

func NewBloom(m, k uint64) *Bloom    { /* implement */ return nil }
func (b *Bloom) Add(data []byte)     { /* implement */ }
func (b *Bloom) MightContain(data []byte) bool { /* implement */ return false }

func main() {
	// b := NewBloom(64, 3); b.Add([]byte("hi")); print(b.MightContain([]byte("hi")))
}
```

#### Java

```java
public class Task1 {
    static class Bloom {
        Bloom(int m, int k) { /* implement */ }
        void add(String s) { /* implement */ }
        boolean mightContain(String s) { /* implement */ return false; }
    }
    public static void main(String[] args) {
        // Bloom b = new Bloom(64, 3); b.add("hi"); System.out.println(b.mightContain("hi"));
    }
}
```

#### Python

```python
class Bloom:
    def __init__(self, m, k):
        ...  # implement
    def add(self, item):
        ...  # implement
    def might_contain(self, item):
        ...  # implement

if __name__ == "__main__":
    pass  # b = Bloom(64, 3); b.add("hi"); print(b.might_contain("hi"))
```

- **Constraints:** `O(k)` per op; bits packed into words; deterministic hashing.
- **Expected:** `mightContain` returns `True` for every added item.
- **Evaluation:** correctness, bit-packing, double hashing.

### Task 2 — Add `from(n, p)` constructor with sizing math

Add a constructor that computes `m = ceil(−n·ln p / (ln 2)²)` and `k = round((m/n)·ln 2)` from a target item count `n` and FPR `p`. Print the chosen `m` and `k`.

- **Constraints:** `k ≥ 1`; reject `p ≤ 0` or `p ≥ 1`.
- **Expected:** for `n=1000, p=0.01` → roughly `m≈9586, k≈7`.
- **Evaluation:** formula correctness, input validation.

### Task 3 — Verify the no-false-negative property empirically

Insert `n = 50,000` distinct strings. Then query all `n` of them and assert that **every** query returns `True`. Print the count of false negatives (must be `0`).

- **Constraints:** use distinct items; assert zero false negatives.
- **Expected:** `falseNegatives = 0` on every run.
- **Evaluation:** correct invariant verification.

### Task 4 — Measure the observed false-positive rate

After inserting `n` items, query `n` *never-inserted* items and compute the fraction that return `True`. Compare this observed FPR to the analytic `p = (1 − e^(−kn/m))^k`. Print both.

- **Constraints:** disjoint insert/test sets; report 4 decimals.
- **Expected:** observed FPR within ~20% of analytic for `n ≥ 10,000`.
- **Evaluation:** measurement correctness, closeness to theory.

### Task 5 — Early-exit query

Modify `mightContain` to count how many of the `k` bits it inspects before deciding. Show that for non-members it usually inspects far fewer than `k` bits (returns on the first `0`).

- **Constraints:** return on first `0` bit; track inspected-bit count.
- **Expected:** average inspected bits for non-members ≪ `k`.
- **Evaluation:** early-exit logic, instrumentation.

---

## Intermediate Tasks

### Task 6 — Union two Bloom filters

Implement `union(a, b)` that returns a new filter equal to the bitwise OR of two filters with identical `m`, `k`, and hash seeds. Verify that the union answers "present" for every item inserted into either source filter.

- **Constraints:** reject filters with mismatched `m`/`k`; OR the bit arrays.
- **Expected:** union contains every item of both inputs (no false negatives).
- **Evaluation:** correct OR merge, parameter check.

### Task 7 — Counting Bloom filter with delete

Replace each bit with a 4-bit counter (pack two counters per byte, or use a `uint8` array). `add` increments the `k` counters; `delete` decrements them; "set" means counter `> 0`. Demonstrate that after `add(x); add(y); delete(x)`, querying `y` still returns `True` (no false negative from deletion).

- **Constraints:** saturate counters at 15 (don't overflow/underflow); guard against decrementing below 0.
- **Expected:** deletes don't break other items' membership.
- **Evaluation:** counter logic, deletion safety. (Cross-ref: `23-counting-bloom-filter`.)

### Task 8 — Bloom filter vs hash set: memory and speed

Insert 1,000,000 URLs into both a Bloom filter (sized for 1% FPR) and a `set`/`HashSet`/`map`. Report the memory used by each and the query throughput of each. Quantify the memory saving.

- **Constraints:** measure actual bytes where the language allows; same item set.
- **Expected:** Bloom uses ~10×–50× less memory.
- **Evaluation:** fair measurement, correct reporting.

### Task 9 — Tune FPR vs bits-per-element

For `bits/element ∈ {4, 6, 8, 10, 12, 14}`, build a filter, insert `n` items, and measure the observed FPR. Tabulate `bits/elem → observed FPR` and confirm each extra bit multiplies FPR by roughly `0.6185`.

- **Constraints:** keep `n` fixed; recompute `k` optimally per `m`.
- **Expected:** FPR falls geometrically (~×0.62 per bit).
- **Evaluation:** correct sweep, geometric trend.

### Task 10 — Blocked (cache-line) Bloom filter

Implement a blocked Bloom filter: the first hash selects a 512-bit block; the remaining `k` bits are set within that single block. Confirm each operation touches exactly one block, and compare its FPR to a standard filter of the same total `m`.

- **Constraints:** block size = 512 bits; all `k` bits inside one block.
- **Expected:** one block per op; FPR slightly higher than standard for same `m`.
- **Evaluation:** blocking correctness, FPR comparison. (Cross-ref: `senior.md`.)

---

## Advanced Tasks

### Task 11 — Scalable Bloom filter

Implement a scalable Bloom filter: a list of sub-filters where, on filling the current one to target load, you append a new larger filter with a tighter FPR (`p·r^i`, `r = 0.9`). `mightContain` checks all sub-filters; `add` goes to the newest. Insert 10× the initial design `n` and confirm the global FPR stays below the target.

- **Constraints:** geometric size growth; tightening per-slice FPR.
- **Expected:** overall FPR ≤ target despite massive overfill.
- **Evaluation:** growth logic, compounded-FPR bound. (Cross-ref: `senior.md`.)

### Task 12 — LSM-style per-SSTable Bloom filters

Simulate an LSM read path: create several "SSTables," each a set of keys with its own Bloom filter. Implement `get(key)` that checks each SSTable's filter and only "reads" (scans the real key set of) the tables whose filter says "maybe." Count how many disk reads the filters saved on a workload that is 90% absent keys.

- **Constraints:** per-SSTable filter; skip files on filter "no".
- **Expected:** ~90% of would-be reads avoided for absent keys.
- **Evaluation:** correct skip logic, read-saving metric. (Cross-ref: `04-lsm-tree`.)

### Task 13 — Concurrent (lock-light) Bloom filter

Make inserts thread-safe using atomic OR / CAS per word (no global lock), since bits only go `0→1`. Run many goroutines/threads inserting concurrently, then verify from a single thread that all inserted items return `True`.

- **Constraints:** atomic bit-set; no data races (run with `-race` / thread sanitizer).
- **Expected:** zero false negatives under concurrency.
- **Evaluation:** correctness under contention, race-freedom.

### Task 14 — Estimate cardinality from a Bloom filter

Given a filled Bloom filter with known `m` and `k`, estimate the number of inserted distinct items from the count of set bits `X` using `n̂ = −(m/k)·ln(1 − X/m)`. Compare your estimate to the true `n` across several fills.

- **Constraints:** count set bits efficiently (popcount); apply the inversion formula.
- **Expected:** estimate within a few percent of true `n` (away from saturation).
- **Evaluation:** popcount usage, formula correctness, accuracy.

### Task 15 — Web-crawler URL dedup

Build a URL-dedup component for a crawler: before "fetching," check the Bloom filter; if "new," fetch and record. Feed a stream with many repeats and measure (a) duplicate fetches avoided and (b) unique URLs wrongly skipped due to false positives. Tune `m, k` so wrongly-skipped stays under 0.5%.

- **Constraints:** stream processing; track both metrics.
- **Expected:** near-100% duplicate suppression, <0.5% wrongful skips.
- **Evaluation:** dedup effectiveness, FPR control, realistic design.

---

## Benchmark Task

> Compare insert and query throughput, and observed FPR, across all 3 languages for a filter sized at `n = 1,000,000`, `p = 0.01`.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	n := 1000000
	// b := New(n, 0.01)   // your sized constructor
	start := time.Now()
	for i := 0; i < n; i++ {
		// b.Add(fmt.Sprintf("k-%d", i))
		_ = i
	}
	fmt.Printf("inserts of %d in %v\n", n, time.Since(start))
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int n = 1_000_000;
        // Bloom b = new Bloom(n, 0.01);
        long start = System.nanoTime();
        for (int i = 0; i < n; i++) {
            // b.add("k-" + i);
        }
        System.out.printf("inserts of %d in %d ms%n", n, (System.nanoTime() - start) / 1_000_000);
    }
}
```

#### Python

```python
import time

n = 1_000_000
# b = Bloom(n, 0.01)
start = time.perf_counter()
for i in range(n):
    # b.add(f"k-{i}")
    pass
print(f"inserts of {n} in {time.perf_counter() - start:.3f}s")
```

Report a table of `language → insert ms → query ms → observed FPR`. Note where each language's hashing/allocation dominates, and whether the observed FPR matches the analytic ~1%.
