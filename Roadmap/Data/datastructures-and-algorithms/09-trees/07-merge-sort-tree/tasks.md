# Merge Sort Tree — Practice Tasks

> All tasks should be solved in **Go**, **Java**, and **Python**. Each comes with constraints, expected output, and (where useful) a reference solution or solution sketch. Build on the `MergeSortTree` from `junior.md`/`interview.md`; translations between languages are mechanical.

The tasks are graded: **Beginner** (build and basic queries), **Intermediate** (k-th smallest, bands, offline comparison), **Advanced** (fractional cascading, rebuild strategies, alternatives). A benchmark task closes the set.

---

## Beginner Tasks

**Task 1 — Build the merge sort tree from scratch.**
Implement `Build(a)` that constructs a flat `4n`-node tree where each node holds the sorted list of its index range, built by merging children (no calling a library sort on each node). Verify the root equals `sorted(a)` and every leaf is a single element.

- **Constraints:** `O(n log n)` build via linear merges; allocate `4n` nodes; handle `n = 0` and `n = 1`.
- **Expected Output:** for `a = [2,6,4,1,9,3]`, root list `= [1,2,3,4,6,9]`.
- **Evaluation:** correct merge (not re-sort), correct allocation, edge cases.

#### Go
```go
package main

func main() {
	// implement Build(a) and print the root's sorted list
}
```

#### Java
```java
public class Task1 {
    public static void main(String[] args) {
        // implement build and print the root's sorted list
    }
}
```

#### Python
```python
def main():
    # implement build and print the root's sorted list
    pass

if __name__ == "__main__":
    main()
```

---

**Task 2 — `countLE(l, r, k)`.**
Implement the count of indices `i ∈ [l, r]` with `A[i] ≤ k`. Cross-check against an `O(n)` brute-force scan on random arrays of length 50, including duplicate-heavy arrays.

- **Constraints:** use `upperBound` (`bisect_right`) so ties with `k` count; `O(log² n)` per query.
- **Expected Output:** `countLE(1, 4, 5) == 2` for `a = [2,6,4,1,9,3]`.
- **Evaluation:** correctness vs brute force across all `(l, r, k)` on small arrays.

**Reference (Python):**
```python
def brute_count_le(a, l, r, k):
    return sum(1 for i in range(l, r + 1) if a[i] <= k)

import random
for _ in range(200):
    a = [random.randint(0, 9) for _ in range(random.randint(1, 50))]
    t = MergeSortTree(a)
    for _ in range(50):
        l = random.randrange(len(a)); r = random.randint(l, len(a) - 1)
        k = random.randint(-1, 10)
        assert t.count_le(l, r, k) == brute_count_le(a, l, r, k)
print("countLE OK")
```

---

**Task 3 — `countInBand(l, r, a, b)`.**
Count indices `i ∈ [l, r]` with `a ≤ A[i] ≤ b`, using `countLE(l,r,b) − countLE(l,r,a−1)`. Test that `countInBand(0, 5, 3, 6) == 3` for `a = [2,6,4,1,9,3]` (elements `6, 4, 3`).

- **Constraints:** guard `a > b` (return 0); avoid underflow when `a` is the minimum value.
- **Expected Output:** `3` for the sample.
- **Evaluation:** correct subtraction, tie handling at both ends, brute-force cross-check.

---

**Task 4 — Count strictly-less-than and strictly-greater-than.**
Add `countLT(l, r, k)` (count `< k`) and `countGT(l, r, k)` (count `> k`). Express each via `lowerBound` / `upperBound` and a range-length subtraction: `countGT = (r − l + 1) − countLE(l, r, k)`.

- **Constraints:** must distinguish `≤`/`<`/`>` correctly on arrays full of duplicates.
- **Expected Output:** for `a = [5,5,5,5]`, `countLT(0,3,5)==0`, `countLE(0,3,5)==4`, `countGT(0,3,5)==0`.
- **Evaluation:** correctness across the three predicates with ties.

---

**Task 5 — Single-element and empty edge cases.**
Write tests that exercise `n = 0` (all queries return 0), `n = 1`, `l > r` (return 0), `k` below all values (0), and `k` ≥ max (`r − l + 1`). Confirm no out-of-bounds and no crashes.

- **Constraints:** the constructor must not crash on `n = 0`; queries must not recurse on `l > r`.
- **Expected Output:** every edge case returns the documented value.
- **Evaluation:** robustness; allocate `4 * max(1, n)`.

---

## Intermediate Tasks

**Task 6 — K-th smallest in a range (binary search on the answer).**
Implement `kthSmallest(l, r, k)` returning the `k`-th smallest value (1-indexed) in `A[l..r]`. Coordinate-compress the distinct values and binary-search for the smallest value `v` with `countLE(l, r, v) ≥ k`.

- **Constraints:** `O(log³ n)` is acceptable; compress values first.
- **Expected Output:** for `a = [2,6,4,1,9,3]`, `kthSmallest(0, 5, 1) == 1`, `kthSmallest(0, 5, 4) == 4`, `kthSmallest(1, 4, 2) == 4` (range `[6,4,1,9]` sorted `[1,4,6,9]`, 2nd is 4).
- **Evaluation:** correctness vs brute-force `sorted(a[l:r+1])[k-1]`.

**Reference sketch (Python):**
```python
def kth_smallest(t, a, l, r, k):
    vals = sorted(set(a))
    lo, hi = 0, len(vals) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if t.count_le(l, r, vals[mid]) >= k:
            hi = mid
        else:
            lo = mid + 1
    return vals[lo]
```

---

**Task 7 — LeetCode 315 style: count smaller after self.**
Given `nums`, return `counts[i]` = number of `j > i` with `nums[j] < nums[i]`. Solve with a merge sort tree: `counts[i] = countLT(i+1, n-1, nums[i])`.

- **Constraints:** `O(n log² n)` total; handle the empty suffix (`i = n-1` → 0).
- **Expected Output:** `nums = [5,2,6,1]` → `[2,1,1,0]`.
- **Evaluation:** matches the brute-force `O(n²)` reference.

---

**Task 8 — Offline BIT sweep vs merge sort tree.**
Implement the **offline** count-≤-k solution (sort queries by `k`, sweep a Fenwick keyed by index) and compare its answers and wall time against the merge sort tree on the same `(l, r, k)` query set.

- **Constraints:** BIT sweep is `O((n + q) log n)`; produce identical answers.
- **Expected Output:** answer vectors equal; print both timings.
- **Evaluation:** correctness parity + a short note on which was faster and why (offline drops a `log`, smaller constant).

---

**Task 9 — Count-in-band stress test with negatives and duplicates.**
Build a randomized property test: random arrays with negative values and many duplicates, random `[l, r]` and `[a, b]` bands, asserting `countInBand` matches brute force. Include `a = b`, `a > b`, and `b` ≥ max.

- **Constraints:** no underflow on `a − 1`; correct tie handling at both band ends.
- **Expected Output:** thousands of random cases pass.
- **Evaluation:** the test catches `lowerBound`/`upperBound` swaps and off-by-one band bugs.

---

**Task 10 — Hybrid block-scan variant (drop bottom levels).**
Build a merge sort tree that stores sorted lists only at nodes covering ≥ `B` elements; for sub-`B` ranges, scan the raw array. Measure the memory saved versus the full tree and the query-time cost of the scans.

- **Constraints:** correctness identical to the full tree; tune `B` (e.g., `B = 32`).
- **Expected Output:** report memory (cells stored) and query time for `B ∈ {1, 16, 32, 64}`.
- **Evaluation:** correct hybrid query; a table of the memory/time trade-off.

---

## Advanced Tasks

**Task 11 — Fractional cascading.**
Augment the merge sort tree with bridge pointers (`Lbridge`, `Rbridge`) so that a `countLE` query does **one** binary search at the root and `O(1)` hops thereafter, achieving `O(log n)` per query. Verify answers match the plain tree and measure the speedup at `n = 10^5`.

- **Constraints:** build remains `O(n log n)`; query becomes `O(log n)`; answers identical to plain tree.
- **Expected Output:** identical answer vector; query time noticeably lower than plain `O(log² n)`.
- **Evaluation:** correct bridges, correct rank reconstruction along the path, measured speedup.

---

**Task 12 — Seal-and-build partitioned service.**
Simulate an append-mostly system: a small mutable "live" buffer plus immutable per-partition merge sort trees. On a "seal" event, build a tree for the live buffer and clear it. A `countLE` over a window spanning sealed + live answers the sealed part via trees and scans the live tail.

- **Constraints:** sealed trees immutable; live scan `O(live size)`; correct combination.
- **Expected Output:** queries over mixed windows match a brute-force over the whole logical array.
- **Evaluation:** correct partition routing and result combination; atomic swap of the published tree set.

---

**Task 13 — Delta-log hybrid (LSM-style).**
Keep an immutable merge sort tree plus a delta buffer of recent inserts/deletes. A `countLE` answers `tree.countLE(...)` then corrects with a linear scan of the delta buffer. When the buffer exceeds a threshold, rebuild (fold deltas in) and clear it.

- **Constraints:** bounded staleness via the threshold; correct correction sign for inserts vs deletes.
- **Expected Output:** queries match a brute force over (base + deltas) at all times.
- **Evaluation:** correct correction logic, rebuild trigger, and post-rebuild consistency.

---

**Task 14 — Compare four structures on k-th smallest.**
Implement k-th-smallest-in-range with (a) merge sort tree + binary-search-on-answer, (b) a persistent segment tree, (c) sqrt decomposition with sorted blocks, and (optionally) (d) a wavelet tree. On the same query set, verify identical answers and tabulate build time, query time, and memory.

- **Constraints:** identical answers across all implemented structures.
- **Expected Output:** a comparison table (build/query/memory) with a one-line recommendation per scenario.
- **Evaluation:** parity of answers; an honest trade-off discussion (online/offline, memory, k-th vs count).

---

**Task 15 — Updatable range-count via sqrt decomposition.**
Since the merge sort tree can't update, implement the standard substitute: sqrt decomposition with sorted blocks supporting `pointUpdate(i, v)` and `countLE(l, r, k)`. A point update re-sorts (or binary-inserts into) one block; a count binary-searches each fully-covered block and scans partial ends.

- **Constraints:** update `O(√n)` / `O(√n log √n)`; query `O(√n log √n)`; correct against a brute force under interleaved updates and queries.
- **Expected Output:** mixed update/query stream matches the brute-force reference.
- **Evaluation:** correct block rebuild on update; correct query combination; demonstrates the "merge sort tree with updates" alternative.

---

## Benchmark Task

> Compare performance across all 3 languages for build + `countLE` at scale.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000}
	for _, n := range sizes {
		a := make([]int, n)
		for i := range a {
			a[i] = rand.Intn(1_000_000)
		}
		start := time.Now()
		t := Build(a) // from your implementation
		build := time.Since(start)
		start = time.Now()
		var sink int
		for i := 0; i < 100000; i++ {
			l := rand.Intn(n)
			r := l + rand.Intn(n-l)
			sink += t.CountLE(l, r, rand.Intn(1_000_000))
		}
		fmt.Printf("n=%7d build=%v 100kq=%v sink=%d\n", n, build, time.Since(start), sink)
	}
}
```

#### Java
```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000};
        Random rng = new Random(1);
        for (int n : sizes) {
            int[] a = new int[n];
            for (int i = 0; i < n; i++) a[i] = rng.nextInt(1_000_000);
            long s = System.nanoTime();
            Solution t = new Solution(a); // your merge sort tree
            long build = System.nanoTime() - s;
            s = System.nanoTime();
            long sink = 0;
            for (int i = 0; i < 100000; i++) {
                int l = rng.nextInt(n);
                int r = l + rng.nextInt(n - l);
                sink += t.countLE(l, r, rng.nextInt(1_000_000));
            }
            System.out.printf("n=%7d build=%.1fms q=%.1fms sink=%d%n",
                n, build / 1e6, (System.nanoTime() - s) / 1e6, sink);
        }
    }
}
```

#### Python
```python
import random, time

for n in [1000, 10000, 100000]:
    a = [random.randrange(1_000_000) for _ in range(n)]
    s = time.perf_counter()
    t = MergeSortTree(a)
    build = time.perf_counter() - s
    s = time.perf_counter()
    sink = 0
    for _ in range(100000):
        l = random.randrange(n)
        r = l + (random.randrange(n - l) if n - l else 0)
        sink += t.count_le(l, r, random.randrange(1_000_000))
    print(f"n={n:>7} build={build*1000:.1f}ms q={(time.perf_counter()-s)*1000:.1f}ms sink={sink}")
```

**Report:** for each `n`, build time, 100k-query time, and resident memory. Confirm the query time grows roughly like `log² n` and the memory like `n log n`. Note where Python's interpreter overhead dominates and where coordinate compression would help.

---

## Wrap-up

After these tasks you will have:

- Built and stress-tested the static merge sort tree (`countLE`, band, `<`/`>`).
- Implemented k-th smallest by binary-searching the answer.
- Compared it against the **offline BIT sweep**, **persistent segment tree**, **sqrt decomposition**, and (optionally) the **wavelet tree**.
- Implemented **fractional cascading** to reach `O(log n)` queries.
- Practiced the **rebuild strategies** (seal-and-build, delta log) and the **updatable substitute** (sqrt decomposition) that make the static structure usable in real systems.

That covers the full operational range of the merge sort tree. Revisit `senior.md` for production trade-offs and `professional.md` for the proofs behind these implementations.
