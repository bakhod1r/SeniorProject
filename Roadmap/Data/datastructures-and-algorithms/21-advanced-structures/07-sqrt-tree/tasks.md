# Sqrt Tree — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Build your own working knowledge by writing the code; compare against the reference implementations in `junior.md` Section 9 and `interview.md`. If your code is slow at scale, profile and iterate.
>
> The recurring theme: Sqrt Tree gives **O(1) range queries for any associative op** (including non-idempotent sum/product/xor) after **O(n log log n)** build, with **O(√n)** point updates. Every task should be validated against a brute-force loop.

---

## Beginner Tasks

### Task 1 — Range sum Sqrt Tree from scratch

Implement a Sqrt Tree over `op = sum` supporting `query(l, r) = arr[l] + ... + arr[r]` in O(1) after O(n log log n) build.

- **Constraints:** static array; inclusive `[l, r]`; validate `0 ≤ l ≤ r < n`.
- **Test:** `arr = [1,3,2,7,9,11,6,4,5,1,8,2,10,3,7,5]`; `query(2,13)` → 68; `query(0,15)` → 84; `query(7,7)` → 4.
- **Evaluation:** brute-force every `(l, r)` pair and assert equality.

#### Go

```go
package main

func main() {
	// implement SqrtTree with op = func(a,b int) int { return a+b }
	// validate query(l,r) == sum(arr[l:r+1]) for all l<=r
}
```

#### Java

```java
public class Task1 {
    public static void main(String[] args) {
        // implement SqrtTree with op = Integer::sum; validate vs brute force
    }
}
```

#### Python

```python
def main():
    # implement SqrtTree(arr, lambda a,b: a+b); validate vs sum(arr[l:r+1])
    pass

if __name__ == "__main__":
    main()
```

Reference: `junior.md` Section 9 (full Go/Java/Python) and `interview.md` coding challenge.

---

### Task 2 — Range min Sqrt Tree (idempotent op)

Same structure, but `op = min`. Confirm the *identical* code works just by swapping the op — the whole point of an op-agnostic structure.

- **Constraints:** static; inclusive ranges.
- **Test:** `arr = [3,1,4,1,5,9,2,6]`; `query(0,7)` → 1; `query(4,5)` → 5; `query(6,7)` → 2.
- **Reflect:** for min/max/gcd a *sparse table* is simpler and equally fast (O(1)); note in a comment that Sqrt Tree's unique value is the *non-idempotent* case.

Provide starter code in all 3 languages (copy Task 1, pass `min` instead of `+`).

---

### Task 3 — Range xor Sqrt Tree (non-idempotent — sparse table can't)

Implement with `op = xor`. This is a non-idempotent op, so a sparse table would give wrong answers; Sqrt Tree is correct.

- **Constraints:** static; inclusive ranges.
- **Test:** `arr = [5,7,2,9,4,8,1,6]`; verify `query(l, r)` equals the running xor of `arr[l..r]` for several ranges (e.g. `query(1,4)` = 7^2^9^4 = 8).
- **Evaluation:** brute force the xor for all `(l, r)` and assert equality.
- **In a comment:** explain *why* a sparse table fails here (overlapping windows double-xor, and `x^x=0 ≠ x`).

Provide starter code in all 3 languages.

---

### Task 4 — Single-element and two-element edge cases

Harden your Task 1 implementation against boundary inputs.

- **Test cases:**
  - `arr = [42]`, `query(0, 0)` → 42 (n = 1, no layers built).
  - `arr = [10, 20]`, `query(0, 1)` → 30; `query(1, 1)` → 20.
  - `arr = [5, 5, 5, 5]`, `query(1, 3)` → 15.
  - `arr = [-3, -1, -9, 4]` with `op = min`, `query(0, 3)` → -9.
- **Constraints:** must not crash on `n = 0` or `n = 1`; `query(l, l)` must short-circuit to `arr[l]`.
- **Evaluation:** all of the above pass; add an assertion that querying `l == r` returns `arr[l]` without descending layers.

Provide starter code in all 3 languages.

---

### Task 5 — Build-table inspector

Augment your Sqrt Tree to print, for the top layer, the prefix array, suffix array, and the between table. This makes the three-piece query trick concrete.

- **Test:** on `arr = [1,3,2,7,9,11,6,4,5,1,8,2,10,3,7,5]` with `op = sum`, print the top-layer prefix, suffix, and the 4×4 between table; confirm they match the tables in `junior.md` Section 8 (between[0][3] = 84, etc.).
- **Constraints:** read-only inspection; do not change query behavior.
- **Evaluation:** printed tables match the worked walkthrough.

Provide starter code in all 3 languages.

---

## Intermediate Tasks

### Task 6 — Generic op via a function parameter

Refactor so the op is injected at construction (`func(a,b) -> c` in each language) rather than hard-coded. Demonstrate the same instance class answering sum, product (mod 1e9+7), gcd, and bitwise-OR on the same array.

- **Constraints:** zero structural change between ops — only the injected function differs.
- **Test:** on `arr = [2,3,5,7,11,13]`: sum `query(0,5)` = 41; product mod 1e9+7 `query(0,5)` = 30030; gcd `query(0,5)` = 1; OR `query(0,5)` = 15.
- **Evaluation:** all four op instances pass brute-force checks.

Provide starter code in all 3 languages.

---

### Task 7 — Point update in O(√n)

Add `update(i, v)` that sets `arr[i] = v` and rebuilds only `i`'s block at each layer (prefix/suffix + the affected between row/column), achieving O(√n).

- **Reference:** `senior.md` Section 11 (update path code in all three languages).
- **Test:** `arr = [1,3,2,7,9,11,6,4,5,1,8,2,10,3,7,5]`, op = sum. `query(2,13)` → 68. After `update(6, 100)`: `query(2,13)` → 162; `query(5,6)` → 111.
- **Constraints:** must NOT do a full O(n log log n) rebuild; only `i`'s block per layer.
- **Evaluation:** after a sequence of random updates, every range query still matches brute force.

Provide starter code in all 3 languages.

---

### Task 8 — Range matrix product

Store 2×2 matrices (mod 1e9+7) and pass matrix multiply as the op. Answer `query(l, r)` = product of matrices `l..r` in O(1).

- **Reference:** `middle.md` Section 8.2 (matrix multiply in all three languages).
- **Test:** build over `n` Fibonacci transition matrices `[[1,1],[1,0]]`; `query(0, k-1)` should yield the matrix encoding `F(k+1), F(k)`. Spot-check against direct multiplication for k = 1..10.
- **Constraints:** matrix multiply is associative but NOT idempotent — emphasize this is a Sqrt-Tree-only O(1) use case.
- **Evaluation:** matches brute-force matrix-chain product for random ranges.

Provide starter code in all 3 languages.

---

### Task 9 — Benchmark vs segment tree

Implement a standard segment tree (range sum + point update) and benchmark query throughput against your Sqrt Tree at `n = 10^4, 10^5, 10^6` with 10^6 random range-sum queries.

- **Constraints:** identical query workload for both structures; warm up before timing.
- **Expected pattern:** Sqrt Tree's O(1) query overtakes the segment tree's O(log n) as `n` grows and the segment tree starts missing cache on its descent; at small `n` the segment tree's cheaper build may win end-to-end.
- **Deliverable:** a table of build time and per-query time for both, plus a one-paragraph explanation of the crossover (cache misses, build amortization).

Provide starter code in all 3 languages (timing harness as in the TEMPLATE benchmark block).

---

### Task 10 — Memory accounting

Instrument your Sqrt Tree to count the exact number of stored cells (prefix + suffix + between, summed over all layers) for `n = 16, 256, 4096, 10^6`.

- **Constraints:** count cells, not bytes; verify the between table is O(n) per layer, NOT O(n²).
- **Expected:** total cells ≈ `c · n · log log n` for a small constant `c` (~10–15). Plot or tabulate cells/n vs n; it should grow like `log log n` (very slowly), not like `log n`.
- **Evaluation:** confirm no layer's between table exceeds O(n); flag it loudly if it does (that's the classic O(n²) bug).

Provide starter code in all 3 languages.

---

## Advanced Tasks

### Task 11 — onLayer table for true O(1) query

Replace the recursive layer descent with an `onLayer[h]` lookup (`h = msb(l XOR r)`) so the separating layer is chosen in O(1), making the query worst-case O(1) rather than O(log log n).

- **Reference:** `professional.md` Section 6 (onLayer construction).
- **Constraints:** the query must perform a single table lookup to pick the layer, then the three-piece combine — no descent loop.
- **Test:** results identical to the descent version on random `(l, r)`; measure that query latency is flat regardless of range length.
- **Evaluation:** correctness vs brute force + a microbenchmark showing constant latency across range sizes.

Provide starter code in all 3 languages.

---

### Task 12 — Lazy batched updates

Extend Task 7: instead of rebuilding a block on every update, mark it dirty and rebuild once (O(√n)) at the next query that touches it. Show that a burst of `m` updates to one block costs O(√n), not O(m√n).

- **Reference:** `professional.md` Section 8.1 (amortization argument).
- **Constraints:** queries must trigger a flush of any dirty block they read before combining.
- **Test:** apply 1000 updates to indices within one block, then one query; assert only one block rebuild occurred (instrument a counter) and the answer is correct.
- **Evaluation:** correctness + the rebuild counter confirms coalescing.

Provide starter code in all 3 languages.

---

### Task 13 — Sharded Sqrt Tree

Split a large array into `K` contiguous shards, each with its own Sqrt Tree. Answer a range query `[l, r]` that spans shards by combining per-shard partial results with `op`.

- **Reference:** `senior.md` Section 10 (sharding design).
- **Constraints:** each per-shard sub-query is O(1) locally; the coordinator combines O(K) partials with `op` (correct because `op` is associative).
- **Test:** shard `arr` (n = 10^5) into K = 10 shards; verify cross-shard `query(l, r)` matches a single unsharded Sqrt Tree for random ranges.
- **Evaluation:** identical answers to the unsharded version.

Provide starter code in all 3 languages.

---

### Task 14 — Index-returning range min/max

Modify the op so `query(l, r)` returns the *index* achieving the min (or max), not the value. Store `(value, index)` and define `op((va,ia),(vb,ib)) = (va,ia) if va<=vb else (vb,ib)`.

- **Constraints:** ties broken by smallest index.
- **Test:** `arr = [3,1,4,1,5,9,2,6]`, range-min-index `query(0,7)` → 1 (first index of value 1); `query(2,7)` → 3.
- **Evaluation:** matches brute-force argmin over all ranges.

Provide starter code in all 3 languages.

---

### Task 15 — Crossover study: Sqrt Tree vs sparse table vs segment tree

For an **idempotent** op (range gcd), implement all three structures and find, empirically, the `(n, query-count)` region where each is fastest end-to-end (build + queries).

- **Constraints:** identical workloads; report build time, per-query time, and total memory for each at `n = 10^4, 10^5, 10^6, 10^7`.
- **Expected findings:** sparse table simplest and fast but heaviest memory (O(n log n)); Sqrt Tree lighter memory (O(n log log n)) with O(1) queries; segment tree cheapest build and memory but O(log n) queries. The right choice depends on memory budget and query count.
- **Deliverable:** a comparison table + a short recommendation paragraph per regime.

Provide starter code in all 3 languages.

---

## Benchmark Task

> Compare Sqrt Tree query performance across all 3 languages on a fixed workload (op = sum, n = 10^6, 2·10^6 random queries).

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	n := 1_000_000
	data := make([]int, n)
	for i := range data {
		data[i] = i % 1000
	}
	// st := New(data, func(a, b int) int { return a + b })
	start := time.Now()
	// run 2_000_000 random queries against st.Query
	elapsed := time.Since(start)
	fmt.Printf("Go: %.3f ms total\n", float64(elapsed.Milliseconds()))
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int n = 1_000_000;
        int[] data = new int[n];
        for (int i = 0; i < n; i++) data[i] = i % 1000;
        // SqrtTree st = new SqrtTree(data, Integer::sum);
        long start = System.nanoTime();
        // run 2_000_000 random queries against st.query
        long elapsed = System.nanoTime() - start;
        System.out.printf("Java: %.3f ms total%n", elapsed / 1_000_000.0);
    }
}
```

#### Python

```python
import time, random

def main():
    n = 1_000_000
    data = [i % 1000 for i in range(n)]
    # st = SqrtTree(data, lambda a, b: a + b)
    queries = [(random.randint(0, n - 1), 0) for _ in range(2_000_000)]
    queries = [(min(l, n - 1), random.randint(min(l, n - 1), n - 1)) for l, _ in queries]
    start = time.perf_counter()
    # for l, r in queries: st.query(l, r)
    print(f"Python: {(time.perf_counter() - start) * 1000:.3f} ms total")

if __name__ == "__main__":
    main()
```

---

## Self-check

After completing the tasks you should be able to:

- [ ] Implement a Sqrt Tree for range sum from a blank file, validated vs brute force.
- [ ] Swap the op (min, product, gcd, xor, matrix) with zero structural change.
- [ ] Explain why a sparse table fails for sum/product/xor and Sqrt Tree does not.
- [ ] Implement an O(√n) point update that rebuilds only the affected block per layer.
- [ ] State why the depth is log log n and the build is O(n log log n).
- [ ] Avoid the O(n²) between-table memory bug.
- [ ] Replace descent with an `onLayer` lookup for worst-case O(1) queries.
- [ ] Decide, with numbers, when Sqrt Tree beats a segment tree or a sparse table.

If any item is fuzzy, re-read the matching section of `junior.md` / `middle.md` / `senior.md` / `professional.md` and try the task again.

---

## Bonus — bring your own problem

Find a competitive-programming problem where a static, non-idempotent associative range query is the bottleneck and solve it with a Sqrt Tree:

- Range product / range xor over a fixed array with many queries.
- Range gcd on a very large array where a sparse table would exceed the memory limit.
- Range matrix product for batched linear-recurrence evaluation.

Solving 2–3 end-to-end locks in the pattern far better than reading alone.
