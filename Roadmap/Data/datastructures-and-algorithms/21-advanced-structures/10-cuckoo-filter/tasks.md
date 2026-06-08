# Cuckoo Filter — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Reuse the reference implementation from `junior.md` / `middle.md` as your starting point where helpful.

## Beginner Tasks

**Task 1:** Implement a basic cuckoo filter from scratch with 8-bit fingerprints and bucket size `b = 4`. Support `insert`, `lookup`, and `delete`. Reserve `0` as the empty-slot sentinel.

#### Go

```go
package main

type CuckooFilter struct {
	// buckets [][4]byte, numBuckets uint32
}

func New(numBuckets uint32) *CuckooFilter { /* implement */ return nil }
func (c *CuckooFilter) Insert(item string) bool { /* implement */ return false }
func (c *CuckooFilter) Lookup(item string) bool { /* implement */ return false }
func (c *CuckooFilter) Delete(item string) bool { /* implement */ return false }

func main() {
	// insert "a","b","c"; assert Lookup finds them; delete "b"; assert it's gone
}
```

#### Java

```java
public class Task1 {
    static class CuckooFilter {
        CuckooFilter(int numBuckets) { /* implement */ }
        boolean insert(String item) { return false; }
        boolean lookup(String item) { return false; }
        boolean delete(String item) { return false; }
    }
    public static void main(String[] args) {
        // insert "a","b","c"; assert lookup; delete "b"; assert gone
    }
}
```

#### Python

```python
class CuckooFilter:
    def __init__(self, num_buckets):
        pass  # implement

    def insert(self, item): ...
    def lookup(self, item): ...
    def delete(self, item): ...


if __name__ == "__main__":
    pass  # insert "a","b","c"; assert lookup; delete "b"; assert gone
```

- **Constraints:** lookup and delete must each touch only the two candidate buckets.
- **Expected Output:** all inserted items found; deleted item not found.
- **Evaluation:** correctness, sentinel handling, two-bucket access.

**Task 2:** Write a helper `fingerprint(item)` that returns a non-zero 8-bit value, and prove (with a small test) that it never returns `0`. Show the mapping for at least 10 distinct inputs.
- Provide starter code in all 3 languages.
- Constraints: deterministic for the same input; never `0`.

**Task 3:** Implement and unit-test the **XOR self-inverse property**: for many random `(i, fingerprint)` pairs, assert `alt(alt(i, f), f) == i`. Run at least 10,000 random trials.
- Constraints: bucket count must be a power of two; use `& (m-1)` masking.

**Task 4:** Add a `LoadFactor()` method returning `count / (numBuckets * b)`. Insert items until load reaches 0.5, 0.7, and 0.9, printing the load factor at each milestone.
- Constraints: track `count` on insert (and decrement on delete).

**Task 5:** Demonstrate **no false negatives**: insert 1,000 distinct items, then assert every one of them is found by `lookup`. Print "PASS" only if all are found.
- Constraints: filter must be sized large enough that no insert fails.

## Intermediate Tasks

**Task 6:** Implement the **kick-out / relocation chain** explicitly and instrument it: return the number of relocations performed for each insert. Plot (or print) the average relocations as load factor rises from 0.5 to 0.95.
- Provide starter code in all 3 languages.
- Constraints: cap at `MaxKicks = 500`; report inserts that fail.

**Task 7:** Make the fingerprint length configurable (`f` bits) and empirically measure the **false-positive rate**. For `f ∈ {6, 8, 10, 12}` with `b = 4`, insert 5,000 items, then query 50,000 never-inserted keys and report the measured FPR next to the theoretical `2b/2^f`.
- Constraints: results should be within a small factor of theory.

**Task 8:** Implement a `sizeFilter(n, eps, b)` helper that returns `(numBuckets, fingerprintBits)` for `n` items at target FPR `eps`, using `f = ceil(log2(2b/eps))` and a target load factor of 0.90 (rounding buckets up to a power of two). Verify the built filter hits roughly the target FPR.

**Task 9:** Implement **delete-if-present** semantics: a delete that first checks `lookup` and only removes the fingerprint if present. Write a test showing that deleting a never-inserted key does **not** disturb an existing member that shares a fingerprint+bucket.

**Task 10:** Implement an **overflow stash**: when an insert exceeds `MaxKicks`, store the fingerprint in a small auxiliary set instead of failing. `lookup` must also consult the stash. Drive the filter to 98% load and report stash size and that no inserted item is ever missed.

## Advanced Tasks

**Task 11:** Implement a **thread-safe** cuckoo filter using a read-write lock (many concurrent lookups, exclusive inserts/deletes). Run a benchmark with multiple reader threads and one writer thread; assert correctness (no false negatives) under contention.
- Provide starter code in all 3 languages.
- Constraints: relocation must be atomic with respect to lookups.

**Task 12:** Implement **persistence**: serialize the filter (`numBuckets`, `b`, `f`, and packed bucket bytes) to a byte array / file and reload it. Assert that a reloaded filter answers identically to the original for 10,000 queries.

**Task 13:** Implement **semi-sorted** buckets: store the `b` fingerprints of a bucket as a sorted multiset and encode it compactly to save ~1 bit per item. Measure the actual bits-per-item versus the naive layout at the same FPR.

**Task 14:** Build a **filter-before-store** demo: put a cuckoo filter in front of a slow "database" (a map with an artificial delay). Measure how many database calls the filter avoids for a workload that is 80% negative lookups, and confirm only false positives (rate ≈ `ε`) leak through.

**Task 15:** Implement a **space comparison harness**: for a fixed `n` and a sweep of target FPRs (`10%, 3%, 1%, 0.1%, 0.01%`), compute and print bits-per-item for (a) an optimal Bloom filter (`1.44·log2(1/ε)`) and (b) a cuckoo filter (`(log2(1/ε)+log2 2b)/α`). Identify the crossover FPR where cuckoo becomes smaller, and compare it to the theoretical ~3% (semi-sorted) / ~0.35% (standard).

## Benchmark Task

> Compare insert/lookup throughput across all 3 languages as the load factor rises.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	loads := []float64{0.5, 0.7, 0.85, 0.90, 0.95}
	for _, target := range loads {
		cf := New(1 << 16) // your constructor
		m := 1 << 16
		cap := int(target * float64(m*4))
		start := time.Now()
		ok := 0
		for i := 0; i < cap; i++ {
			if cf.Insert(fmt.Sprintf("k-%d", i)) {
				ok++
			}
		}
		elapsed := time.Since(start)
		fmt.Printf("load %.2f: inserted %d, %.1f ns/op\n",
			target, ok, float64(elapsed.Nanoseconds())/float64(cap))
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        double[] loads = {0.5, 0.7, 0.85, 0.90, 0.95};
        for (double target : loads) {
            CuckooFilter cf = new CuckooFilter(1 << 16); // your constructor
            int m = 1 << 16;
            int cap = (int) (target * m * 4);
            long start = System.nanoTime();
            int ok = 0;
            for (int i = 0; i < cap; i++) if (cf.insert("k-" + i)) ok++;
            long elapsed = System.nanoTime() - start;
            System.out.printf("load %.2f: inserted %d, %.1f ns/op%n",
                target, ok, (double) elapsed / cap);
        }
    }
}
```

#### Python

```python
import time

def main():
    for target in (0.5, 0.7, 0.85, 0.90, 0.95):
        cf = CuckooFilter(1 << 14)  # your constructor
        m = 1 << 14
        cap = int(target * m * 4)
        start = time.perf_counter()
        ok = sum(1 for i in range(cap) if cf.insert(f"k-{i}"))
        elapsed = time.perf_counter() - start
        print(f"load {target:.2f}: inserted {ok}, "
              f"{elapsed/cap*1e9:.1f} ns/op")

if __name__ == "__main__":
    main()
```

> **What to look for:** roughly flat per-op cost until ~85% load, then a visible climb toward 95% as relocation chains lengthen — the empirical signature of the cuckoo bounce and the orientability phase transition.
