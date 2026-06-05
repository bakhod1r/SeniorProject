# Segment Tree Beats — Hands-On Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Work in order; each builds on the previous. Always test against an O(n) brute force on thousands of random op sequences — the strict-`max2` merge and the break condition are the two reflexes you are building.

---

## Beginner Tasks

**Task 1 — Build the trio and verify the merge.**
Implement `build` and `merge` for a node storing `sum, max1, max2 (strict), cnt`. Write a function that, given a small subarray, computes the trio by brute force and compares it against the merged tree node.

#### Go
```go
package main

type Node struct{ sum, max1, max2, cnt int64 }

// merge combines L and R into parent. Keep max2 strict.
func merge(L, R Node) Node {
	// implement here
	return Node{}
}

func main() {
	// build [5,2,5,1,5], assert root: sum=18, max1=5, max2=2, cnt=3
}
```

#### Java
```java
public class Task1 {
    static long[] sum, max1, max2, cnt;
    static void merge(int v) {
        // implement here — keep max2 strict
    }
    public static void main(String[] args) {
        // build [5,2,5,1,5], assert root trio
    }
}
```

#### Python
```python
def merge(L, R):
    # L, R are dicts/tuples (sum, max1, max2, cnt); return parent. Keep max2 strict.
    pass

if __name__ == "__main__":
    # build [5,2,5,1,5], assert root: sum=18, max1=5, max2=2, cnt=3
    pass
```
- **Constraints:** `max2` must be the exact strict second maximum (`-∞` if all equal).
- **Expected:** root of `[5,2,5,1,5]` → `sum=18, max1=5, max2=2, cnt=3`.
- **Evaluation:** correctness of all three merge cases (tie, L bigger, R bigger).

**Task 2 — Range max and range sum queries (no chmin yet).**
On top of Task 1, implement `queryMax(l, r)` and `querySum(l, r)`. Verify against brute force on 1000 random arrays/ranges.
- Constraints: O(log n) per query.
- Expected: matches brute-force max/sum exactly.

**Task 3 — `applyChmin` helper and the break condition.**
Implement `applyChmin(v, x)` (precondition `max2 < x < max1`) and a top-level `chmin` that ONLY handles the break (`x >= max1`) and tag (`x > max2` on a fully-covered node) cases — assert (or skip) when recursion would be needed. Test on inputs where every chmin resolves at the root.
- Constraints: O(1) tag apply; correct break short-circuit.
- Expected: capping `[5,2,5,1,5]` at 3 gives sum 12, max1 3 at the root in O(1).

**Task 4 — Full chmin with recursion.**
Add the recurse branch (push-down, recurse both children, merge) so chmin works for any `x`. Verify against brute force on 5000 random op sequences with `n ≤ 50`.
- Constraints: amortized O(log n) per op (max+sum variant).
- Expected: identical to brute force on every query.

**Task 5 — chmax tree (mirror).**
Implement the symmetric structure with `min1, min2 (strict), cnt_min` supporting `chmax(l, r, x)` and range sum/min queries.
- Constraints: break `x <= min1`, tag `min1 < x < min2`.
- Expected: matches brute force `max(a_i, x)`.

---

## Intermediate Tasks

**Task 6 — chmin + chmax + sum in one tree.**
Maintain the full sextet `sum, max1, max2, cnt_max, min1, min2, cnt_min` and support both chmin and chmax with range sum. Handle the coincidence cases (when `applyChmin` lowers an element that is also the minimum).
- Constraints: patch min-fields in `applyChmin` and max-fields in `applyChmax`.
- Expected: matches brute force on interleaved chmin/chmax/sum sequences.

**Task 7 — Range-add + range-chmin + range-sum.**
Implement the two-component tag (`addAll`, `addMax`) tree from `middle.md §6`. A range-add is `applyTag(v, +v, 0)`; a chmin to `x` is `applyTag(v, 0, x-max1)`.
- Constraints: push-down gives `addMax` only to the child carrying the maximum; cache segment size `sz[v]`.
- Expected: matches a brute force replaying add/chmin/sum.

**Task 8 — Range-add + range-chmin + range-max + range-min.**
Extend Task 7 to also answer range-min queries, tracking the min-trio under the add tags (`addAll` shifts min too; `addMax` does not affect min unless min == max).
- Constraints: correct min maintenance under both tags.
- Expected: matches brute force on all four query types.

**Task 9 — Count of changed elements.**
Augment chmin to also return how many elements were actually lowered during a `chmin(l, r, x)` call. (Hint: in the tag case, exactly `cnt` change; sum these across tag applications.)
- Constraints: O(log n)-ish reporting integrated into the recursion.
- Expected: equals the brute-force count of `a_i > x` in `[l, r]`.

**Task 10 — HDU 5306 driver.**
Wire your chmin+max+sum tree to the I/O format of the interview challenge (`0 l r x`, `1 l r`, `2 l r`) and stress-test against brute force on `n=40, q=2000` random ops, then time it on `n=10⁶, q=10⁶` synthetic input.
- Constraints: fast I/O; 64-bit sums.
- Expected: correct outputs; runs within ~1–2 s in Go/Java for the large case.

---

## Advanced Tasks

**Task 11 — Historic maximum.**
Implement range-add + range-chmin with a query for the **historic maximum** `H_i = max over time of a_i`, using the max-plus lazy 4-tuple sketched in `professional.md §7`.
- Constraints: track running maxima of the add tags; correct push-down composition.
- Expected: matches a brute force that records, per index, the max ever seen.

**Task 12 — Potential-function instrumentation.**
Instrument your chmin+sum tree to count total nodes visited and to compute the potential `Φ = Σ_v d(v)` (distinct values per node) before/after each op. Empirically confirm that recurse-heavy ops decrease Φ and that total visits stay within `O((n+q) log² n)`.
- Constraints: report a table of (op#, visits, ΔΦ).
- Expected: visits correlate with Φ drops; no op-sequence blows the amortized total.

**Task 13 — Adversarial stress generator.**
Write a generator that tries to maximize total recursion (e.g., repeatedly create many distinct high values then chmin just below the second-max). Measure how close real runtime gets to the `log²` worst case versus random inputs.
- Constraints: report visits/op distribution.
- Expected: adversarial input is measurably (but not catastrophically) slower than random.

**Task 14 — Sqrt-decomposition competitor.**
Implement chmin + sum with sqrt decomposition (block `max1/cnt` + block cap tag; rebuild boundary blocks). Benchmark against your Beats tree across `n = 10³ … 10⁶`. Identify the crossover `n` where Beats overtakes sqrt.
- Constraints: O(√n) per op for sqrt; correct boundary-block rebuilds.
- Expected: a crossover table; Beats wins for large `n`, sqrt is competitive/simpler for small `n`.

**Task 15 — Generic value type.**
Refactor the chmin+sum tree to work over a generic ordered, additive value type (e.g., `int64` vs a fixed-point type), parameterizing the `NEG` sentinel and arithmetic. Keep the three-way condition intact.
- Constraints: no behavioral change; clean abstraction of `min/max/add`.
- Expected: passes the Task 4 brute-force suite unchanged with the generic type.

---

## Benchmark Task

> Compare chmin+sum throughput across all 3 languages on random op sequences.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{10000, 100000, 1000000}
	for _, n := range sizes {
		a := make([]int64, n)
		for i := range a {
			a[i] = int64(rand.Intn(1 << 30))
		}
		b := NewBeats(a) // from your Task 4 / interview implementation
		start := time.Now()
		for i := 0; i < n; i++ {
			l := rand.Intn(n)
			r := l + rand.Intn(n-l)
			if rand.Intn(2) == 0 {
				b.chmin(1, 0, n-1, l, r, int64(rand.Intn(1<<30)))
			} else {
				_ = b.qsum(1, 0, n-1, l, r)
			}
		}
		fmt.Printf("n=%8d: %v for %d ops\n", n, time.Since(start), n)
	}
}
```

#### Java
```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {10000, 100000, 1000000};
        Random rnd = new Random(1);
        for (int n : sizes) {
            long[] a = new long[n];
            for (int i = 0; i < n; i++) a[i] = rnd.nextInt(1 << 30);
            // build your Beats tree from a
            long start = System.nanoTime();
            for (int i = 0; i < n; i++) {
                int l = rnd.nextInt(n);
                int r = l + rnd.nextInt(n - l);
                // if (rnd.nextBoolean()) chmin(1,0,n-1,l,r,rnd.nextInt(1<<30));
                // else qsum(1,0,n-1,l,r);
            }
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%8d: %.1f ms for %d ops%n", n, elapsed / 1_000_000.0, n);
        }
    }
}
```

#### Python
```python
import random, time

def main():
    for n in (10_000, 100_000, 1_000_000):
        a = [random.randrange(1 << 30) for _ in range(n)]
        # build your Beats tree from a (use PyPy for n=10**6)
        start = time.time()
        for _ in range(n):
            l = random.randrange(n)
            r = random.randrange(l, n)
            # if random.random() < 0.5: chmin(l, r, random.randrange(1 << 30))
            # else: query_sum(l, r)
        print(f"n={n:>8}: {(time.time()-start)*1000:.1f} ms for {n} ops")

if __name__ == "__main__":
    main()
```

> Expected shape: Go/Java handle `n=10⁶` in well under a couple of seconds; CPython is typically 10–30× slower — use PyPy for the largest case. Confirm the amortized behavior: doubling `n` should roughly multiply time by a bit more than 2 (the extra `log` factors), not by `n`.
