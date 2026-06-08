# Persistent Segment Tree — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Theme: build persistent versions via path copying, query any version, and master the range k-th application.
> Reference: [`junior.md`](./junior.md) (mechanism), [`middle.md`](./middle.md) (k-th), [`senior.md`](./senior.md) (arenas).

---

## Beginner Tasks

**Task 1: Build a persistent sum segment tree and prove old versions survive.**
Implement a pointer-based persistent **sum** segment tree with `New(arr)`, `Update(ver, idx, delta) -> newVer`, and `Query(ver, l, r)`. After `Update`, the old version's queries must return the **pre-update** answers.

#### Go
```go
package main

type Node struct{ val int64; left, right *Node }

type PST struct{ n int; roots []*Node }

func New(arr []int64) *PST            { /* build v0, return PST */ return nil }
func (p *PST) Update(ver, idx int, d int64) int { /* path copy, append root */ return 0 }
func (p *PST) Query(ver, l, r int) int64        { /* query from roots[ver] */ return 0 }

func main() {
	p := New([]int64{5, 2, 7, 1})
	v1 := p.Update(0, 1, +4)
	// expect: Query(0,0,1)=7, Query(v1,0,1)=11
	_ = v1
}
```

#### Java
```java
public class Task1 {
    static final class Node { long val; Node left, right; }
    // New(long[]), update(ver,idx,delta)->newVer, query(ver,l,r)
    public static void main(String[] args) {
        // build [5,2,7,1]; v1 = update(0,1,+4)
        // assert query(0,0,1)==7 && query(v1,0,1)==11
    }
}
```

#### Python
```python
class Node:
    __slots__ = ("val", "left", "right")
    def __init__(self, val=0, left=None, right=None):
        self.val, self.left, self.right = val, left, right

class PST:
    def __init__(self, arr): ...
    def update(self, ver, idx, delta): ...   # returns new version index
    def query(self, ver, l, r): ...

if __name__ == "__main__":
    p = PST([5, 2, 7, 1])
    v1 = p.update(0, 1, +4)
    assert p.query(0, 0, 1) == 7 and p.query(v1, 0, 1) == 11
```

- **Constraints:** O(log n) per update/query; O(log n) new nodes per version.
- **Expected Output:** old version 7, new version 11.
- **Evaluation:** immutability (old version unchanged), correct path copying.

---

**Task 2: Count nodes created and verify the `⌈log₂ n⌉+1` bound.**
Extend Task 1 to count how many *new* nodes each `Update` allocates. For `n = 8`, every point update must allocate exactly `4` nodes (`log₂8 + 1`). Print the count per update.

- Provide starter code in all 3 languages.
- **Constraints:** count must equal `⌈log₂ n⌉ + 1` for any single point update.
- **Expected Output:** `4` for `n=8`, `5` for `n=16`.

---

**Task 3: Snapshot-and-restore demo.**
Build version 0, perform 5 updates producing versions 1–5, then query a fixed range `(l, r)` on **all 6 versions** and print the 6 answers. Confirm each version reflects only the updates up to and including it.

- Provide starter code in all 3 languages.
- **Constraints:** O(1) version selection; O(log n) per query.
- **Expected Output:** a monotone (for non-negative deltas) sequence of range sums.

---

**Task 4: Lazy-empty version 0.**
Implement an arena-based persistent count tree where version 0 is a **single empty sentinel** (index 0), and subtrees that are all-zero are shared. Insert `n` elements (one per version) and verify total node count is `O(m log n)` with **no** `2n` initial nodes.

- Provide starter code in all 3 languages.
- **Constraints:** version 0 must cost O(1) nodes.
- **Expected Output:** total nodes ≈ `m·⌈log₂ D⌉`, not `2D + m·log D`.

---

**Task 5: Brute-force validator.**
Write a brute-force reference: keep the array per version in a list, recompute range sums by looping. Run 1000 random `(update / query)` operations and assert the persistent tree matches the brute force on every version.

- Provide starter code in all 3 languages.
- **Constraints:** random `n ∈ [1, 50]`, random deltas.
- **Evaluation:** 100% agreement; catches mutation-of-shared-node bugs.

---

## Intermediate Tasks

**Task 6: Range k-th smallest (the flagship).**
Implement the full pipeline: coordinate compression, `n+1` prefix count-versions, and `kth(l, r, k)` in O(log n). Solve the sample `a=[3,1,4,1,5]` with queries `(2,4,2),(1,5,3),(1,5,1),(3,5,2)` → `1 3 1 4`.

- Provide starter code in all 3 languages.
- **Constraints:** build O(n log n), each query O(log n), one descent over two roots.
- **Evaluation:** correctness vs sorting each sub-array.

---

**Task 7: Number of elements ≤ x in `a[l..r]`.**
Reuse the prefix versions from Task 6. Implement `countLE(l, r, x)` that returns how many elements of `a[l..r]` are ≤ x, in O(log n), by summing left counts where the node's value range ⊆ `(-∞, x]`.

- Provide starter code in all 3 languages.
- **Constraints:** O(log n) per query; handle x below min and above max.
- **Expected Output:** for `a=[3,1,4,1,5]`, `countLE(1,5,3)=3`.

---

**Task 8: Count of values in `[x, y]` for `a[l..r]`.**
Implement `countInRange(l, r, x, y)` = number of `a[l..r]` elements with value in `[x, y]`. Express it as a standard range query on the **difference** of `version[r]` and `version[l−1]`.

- Provide starter code in all 3 languages.
- **Constraints:** O(log n) per query.
- **Expected Output:** `countInRange(1,5,1,3)=3` for `a=[3,1,4,1,5]`.

---

**Task 9: Time-travel range sum.**
Build a persistent **sum** tree where each of `m` updates is an event. Answer `sumAsOf(t, l, r)` = sum of `a[l..r]` as of version `t`. Verify against a per-version brute force.

- Provide starter code in all 3 languages.
- **Constraints:** O(log n) per query; O(1) version pick.
- **Evaluation:** correct historical answers for arbitrary `t`.

---

**Task 10: Immutability stress test.**
Snapshot query results from version `t`, then perform 100 further updates, then re-query version `t`. Assert every result is **unchanged**. Then deliberately introduce a mutating bug (write into a shared node) and confirm your test catches it.

- Provide starter code in all 3 languages.
- **Constraints:** must detect shared-node mutation.
- **Evaluation:** test fails on the buggy version, passes on the correct one.

---

## Advanced Tasks

**Task 11: Arena-backed k-th with `int32` children.**
Reimplement Task 6 using a node arena (parallel `cnt[]`, `lc[]`, `rc[]` arrays of `int32`, index 0 = empty sentinel). Compare memory and build time against the pointer version for `n = 10^5`.

- Provide starter code in all 3 languages.
- **Constraints:** no per-node heap objects; lazy-empty version 0.
- **Evaluation:** correct k-th; report nodes used and bytes.

---

**Task 12: Forced-online k-th.**
Read queries where each `(l, r, k)` is XORed with the previous answer (`l ^= last`, etc.). Decode online, answer immediately. Demonstrate why Mo's algorithm cannot solve this but the persistent tree can.

- Provide starter code in all 3 languages.
- **Constraints:** must answer each query before reading the next.
- **Evaluation:** correctness under the forced-online protocol.

---

**Task 13: Range distinct count via persistence.**
Build a persistent tree over **positions**: scanning left to right, when reaching position `i` with value `v`, do `−1` at the previous occurrence of `v` and `+1` at `i`. Then `distinct(l, r) = query(version[r], l, r)` counts +1 positions in `[l, r]`. Validate against a set-based brute force.

- Provide starter code in all 3 languages.
- **Constraints:** build O(n log n); each query O(log n); online.
- **Expected Output:** `distinct(1,5)` for `a=[1,2,1,3,2]` is `3`.

---

**Task 14: Version retention ring.**
Implement a sliding window of the last `W` versions: after each new version, drop references to versions older than `W` so their exclusive nodes can be reclaimed. Measure that memory stabilizes (in a GC language) instead of growing unbounded over 10^6 updates.

- Provide starter code in all 3 languages.
- **Constraints:** bounded memory `O(W log n)`; correct queries within the window.
- **Evaluation:** memory plateau; out-of-window queries rejected.

---

**Task 15: K-th with point updates (heavier structure).**
Support `setValue(i, v)` (change `a[i]`) interleaved with `kth(l, r, k)`. Use a Fenwick tree indexed by position, each cell holding a (small, mergeable) persistent/ordinary count tree, giving O(log²n) per operation. Benchmark against the static persistent solution.

- Provide starter code in all 3 languages.
- **Constraints:** O(log²n) per update/query.
- **Evaluation:** correctness with updates; document the complexity jump from O(log n) to O(log²n).

---

## Benchmark Task

> Compare build and query performance across all 3 languages on the range-k-th pipeline.

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
			a[i] = rand.Intn(n)
		}
		start := time.Now()
		// build n+1 prefix versions of the count tree here
		buildElapsed := time.Since(start)

		q := 100000
		start = time.Now()
		for i := 0; i < q; i++ {
			l := rand.Intn(n) + 1
			r := l + rand.Intn(n-l+1)
			k := rand.Intn(r-l+1) + 1
			_ = l
			_ = r
			_ = k
			// kth(roots[l-1], roots[r], 0, D-1, k)
		}
		queryElapsed := time.Since(start)
		fmt.Printf("n=%7d build=%6.1f ms  %d queries=%6.1f ms\n",
			n, float64(buildElapsed.Milliseconds()), q, float64(queryElapsed.Milliseconds()))
	}
}
```

#### Java
```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000};
        Random rng = new Random(42);
        for (int n : sizes) {
            int[] a = new int[n];
            for (int i = 0; i < n; i++) a[i] = rng.nextInt(n);

            long t0 = System.nanoTime();
            // build n+1 prefix versions
            long buildMs = (System.nanoTime() - t0) / 1_000_000;

            int q = 100_000;
            t0 = System.nanoTime();
            for (int i = 0; i < q; i++) {
                int l = rng.nextInt(n) + 1;
                int r = l + rng.nextInt(n - l + 1);
                int k = rng.nextInt(r - l + 1) + 1;
                // kth(roots[l-1], roots[r], 0, D-1, k)
            }
            long queryMs = (System.nanoTime() - t0) / 1_000_000;
            System.out.printf("n=%7d build=%5d ms  %d queries=%5d ms%n", n, buildMs, q, queryMs);
        }
    }
}
```

#### Python
```python
import random, time


def benchmark():
    for n in (1000, 10000, 100000):
        a = [random.randrange(n) for _ in range(n)]
        t0 = time.perf_counter()
        # build n+1 prefix versions
        build_ms = (time.perf_counter() - t0) * 1000

        q = 100_000
        t0 = time.perf_counter()
        for _ in range(q):
            l = random.randint(1, n)
            r = random.randint(l, n)
            k = random.randint(1, r - l + 1)
            # kth(roots[l-1], roots[r], 0, D-1, k)
        query_ms = (time.perf_counter() - t0) * 1000
        print(f"n={n:>7} build={build_ms:7.1f} ms  {q} queries={query_ms:7.1f} ms")


if __name__ == "__main__":
    benchmark()
```

**Expected trends:** build scales ~`n log n`; per-query time is flat `~log n` (so total query time scales with `q`, not `n`). Go/Java with arenas should beat the pointer version on large `n`; Python is slower in absolute terms — switch to an arena and consider a wavelet tree if memory-bound.
