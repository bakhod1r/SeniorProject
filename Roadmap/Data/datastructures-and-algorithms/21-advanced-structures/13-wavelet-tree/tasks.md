# Wavelet Tree — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Convention: half-open ranges `[l, r)`, inclusive value bounds `[lo, hi]`, `quantile` `k` is 0-indexed. Always coordinate-compress when values are not already a small dense alphabet.
> Reuse the `WaveletTree` (pointer, `junior.md`) or `WaveletMatrix` (flat, `senior.md`) as your base.

---

## Beginner Tasks

**Task 1: Build a wavelet tree and implement `access`.**
Given a sequence `S` over alphabet `[0, σ)`, build the tree (recursive alphabet split, one prefix-rank bitvector per node) and implement `access(i)` returning `S[i]`. Verify by checking `access(i) == S[i]` for all `i`.

#### Go
```go
package main

func main() {
	// S := []int{3, 1, 4, 1, 5, 2, 6, 3}; sigma := 8
	// wt := New(S, sigma)
	// for i := range S { if wt.Access(i) != S[i] { panic("mismatch") } }
	// implement here
}
```

#### Java
```java
public class Task1 {
    public static void main(String[] args) {
        // int[] s = {3,1,4,1,5,2,6,3}; WaveletTree wt = new WaveletTree(s, 8);
        // for (int i = 0; i < s.length; i++) assert wt.access(i) == s[i];
        // implement here
    }
}
```

#### Python
```python
def main():
    # S = [3,1,4,1,5,2,6,3]; wt = WaveletTree(S, 8)
    # assert all(wt.access(i) == S[i] for i in range(len(S)))
    pass

if __name__ == "__main__":
    main()
```

- **Constraints:** `O(n log σ)` build, `O(log σ)` access. Test σ = 1, σ = 2, n = 1.
- **Expected Output:** No mismatches.
- **Evaluation:** correct bit/rank navigation; leaf value recovery; edge cases.

**Task 2: Implement `rank_c(i)`.**
Add `rank_c(c, i)` returning the count of symbol `c` in `S[0..i)`. Validate against a brute-force prefix count for every `(c, i)` on a random sequence.
- Provide starter code in all 3 languages.
- Constraints: `O(log σ)` per call. Test `rank_c(c, 0) == 0` and `rank_c(c, n) ==` total count of `c`.

**Task 3: Implement `quantile(l, r, k)` (range k-th smallest).**
Add `quantile(l, r, k)` returning the k-th smallest (0-indexed) value in `S[l..r)`. Validate against `sorted(S[l:r])[k]` on random ranges.
- Constraints: `O(log σ)` per query; require `0 <= k < r − l`.
- Constraints: handle `k=0` (min) and `k=r−l−1` (max).

**Task 4: Range median.**
Using your `quantile`, add `median(l, r)` returning the lower median `quantile(l, r, (r−l−1)//2)` (or upper, your choice — document it). Test against `sorted(S[l:r])`.
- Constraints: `O(log σ)`. Test even and odd window lengths.

**Task 5: Coordinate compression wrapper.**
Wrap your wavelet tree so it accepts **arbitrary integers** (possibly negative, large, sparse): sort distinct values, map to `[0, m)`, build over the compressed sequence, and translate `quantile`/`access` answers back to original values. Test with values like `[-5, 1000000, -5, 42, 42, 7]`.
- Constraints: keep the inverse map; queries still `O(log σ)` with σ = #distinct.

---

## Intermediate Tasks

**Task 6: Implement `select_c(j)` (bottom-up).**
Add `select_c(c, j)` returning the position of the j-th (1-indexed) occurrence of `c`, or -1 if fewer than `j` exist. Descend to `c`'s leaf recording the path, then climb using `select0`/`select1` (binary search on the prefix array is acceptable). Verify `rank_c(select_c(c, j) + 1) == j` for all valid `j`.
- Provide starter code in all 3 languages.
- Constraints: `O(log σ · log n)` acceptable here; document the cost.

**Task 7: Range count `[lo, hi]` via `countLess`.**
Implement `countLess(l, r, x)` = number of elements in `S[l..r)` strictly less than `x` (single `O(log σ)` descent that adds whole left-subtree counts when the threshold routes right). Then `rangeCount(l, r, lo, hi) = countLess(l, r, hi+1) − countLess(l, r, lo)`. Validate against brute force.
- Constraints: `O(log σ)` per query. Test `lo == hi`, full range, empty value range.

**Task 8: Wavelet matrix (flat) implementation.**
Reimplement the structure as a **wavelet matrix**: one bit-packed bitvector per level plus `z[level]` zero counts; navigation `0 → rank0`, `1 → z[level] + rank1`. Port `access`, `quantile`, and `countLess`. Verify it returns identical answers to your pointer-tree on random inputs, then benchmark the speed difference.
- Constraints: bit-packed 64-bit words; O(1) `rank` via word popcount prefix sums.

**Task 9: `quantile` plus frequency in one pass.**
Extend `quantile` to also return how many times the k-th smallest value occurs in `[l, r)` (the carried range width `r − l` at the leaf). Return `(value, frequency)`. Validate both against brute force.
- Constraints: no extra asymptotic cost over `quantile`.

**Task 10: 2D points-in-rectangle counting.**
Given points `(x, y)` with distinct `x`, sort by `x`, build a wavelet tree over the `y`-sequence (coordinate-compressed). Implement `countRect(x1, x2, y1, y2)` = number of points with `x ∈ [x1, x2)` (already index range after sorting) and `y ∈ [y1, y2]` using `rangeCount`. Validate against brute force on random point sets.
- Constraints: `O(log σ)` per rectangle query after the `O(n log n)` build/sort.

---

## Advanced Tasks

**Task 11: FM-index backward search (substring count).**
Build the **BWT** of a text `T` (append a sentinel `$`, build the suffix array, take `BWT[i] = T[SA[i]−1]`), then build a wavelet tree over the BWT and the `C[]` table (`C[c]` = #chars `< c`). Implement `count(P)` returning the number of occurrences of pattern `P` in `T` via backward search:
`sp, ep = 0, n; for c in reversed(P): sp = C[c] + rank_c(sp); ep = C[c] + rank_c(ep)`; answer `max(0, ep − sp)`. Validate against a naive substring scan.
- Provide starter code in all 3 languages.
- Constraints: search `O(|P| log σ)`. Test patterns that are present, absent, and the empty pattern.

**Task 12: Huffman-shaped wavelet tree.**
Build the tree shaped by a **Huffman code** over symbol frequencies (frequent symbols get shorter root-to-leaf paths) instead of the balanced alphabet split. Keep `access`/`rank` correct (the path of a symbol is now its Huffman code). Measure total bitvector bits vs the balanced tree on a skewed sequence and confirm it approaches `n·H₀(S)`.
- Constraints: store the symbol→leaf mapping; `access` reconstructs the symbol from the path.

**Task 13: Succinct rank9 bitvector.**
Replace the per-node `int prefix[]` with a true succinct bitvector: 64-bit packed words + a two-level (superblock/block) rank index using only `o(n)` extra bits, with `rank1` in O(1) via hardware popcount. Plug it into your wavelet matrix and measure the memory drop (target: total ≈ `n log σ · (1 + ~0.3)` bits). Verify queries unchanged.
- Constraints: report bits-per-symbol before and after.

**Task 14: Offline vs online range-k-th comparison.**
Implement range k-th smallest **three** ways — wavelet tree, a merge sort tree (segment tree of sorted lists with answer binary search), and a persistent segment tree — and benchmark all three on the same `(n, σ, q)` workloads. Produce a table of query latency and memory. Confirm the wavelet tree's latency is **flat in n** while the merge sort tree grows with `log² n`.
- Constraints: identical inputs and queries across all three; report ns/query and bytes.

**Task 15: Streaming percentile dashboard.**
Simulate an append-only stream of quantized values. Periodically **seal** an immutable snapshot, build a wavelet matrix over it offline, and atomically swap it in for serving. Expose `percentile(l, r, p)` = `quantile(l, r, floor(p·(r−l)))` over row windows (e.g., p50/p95/p99). Drive it with a synthetic latency distribution and verify the percentiles against brute force on each snapshot.
- Constraints: queries `O(log σ)`; document the snapshot/rebuild lifecycle (LSM-like) and why updates are not in-place.

---

## Benchmark Task

> Compare wavelet-tree `quantile` performance across all 3 languages, and confirm latency is flat in `n` (it should depend on `log σ`, not `n`).

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sigma := 256
	for _, n := range []int{1000, 10000, 100000, 1000000} {
		data := make([]int, n)
		for i := range data {
			data[i] = rand.Intn(sigma)
		}
		// wt := newWaveletMatrix(data, sigma)   // your implementation
		const Q = 100000
		start := time.Now()
		acc := 0
		for q := 0; q < Q; q++ {
			l := rand.Intn(n)
			r := l + 1 + rand.Intn(n-l)
			k := rand.Intn(r - l)
			_ = l
			_ = r
			_ = k
			// acc += wt.quantile(l, r, k)
		}
		el := time.Since(start)
		fmt.Printf("n=%8d: %.1f ns/quantile (sink=%d)\n", n, float64(el.Nanoseconds())/Q, acc)
	}
}
```

#### Java
```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        Random rng = new Random(1);
        int sigma = 256;
        for (int n : new int[]{1000, 10000, 100000, 1000000}) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = rng.nextInt(sigma);
            // WaveletMatrix wt = new WaveletMatrix(data, sigma);
            final int Q = 100000; long acc = 0;
            long start = System.nanoTime();
            for (int q = 0; q < Q; q++) {
                int l = rng.nextInt(n);
                int r = l + 1 + rng.nextInt(n - l);
                int k = rng.nextInt(r - l);
                // acc += wt.quantile(l, r, k);
            }
            long el = System.nanoTime() - start;
            System.out.printf("n=%8d: %.1f ns/quantile (sink=%d)%n", n, el / 100000.0, acc);
        }
    }
}
```

#### Python
```python
import random
import time

def main():
    sigma = 256
    for n in (1000, 10000, 100000):
        data = [random.randrange(sigma) for _ in range(n)]
        # wt = WaveletMatrix(data, sigma)
        Q, acc = 20000, 0
        start = time.perf_counter()
        for _ in range(Q):
            l = random.randrange(n)
            r = l + 1 + random.randrange(n - l)
            k = random.randrange(r - l)
            # acc += wt.quantile(l, r, k)
        el = time.perf_counter() - start
        print(f"n={n:>8}: {el / Q * 1e9:.0f} ns/quantile (sink={acc})")

if __name__ == "__main__":
    main()
```

> **What to observe:** the ns/quantile column should be roughly **constant** across `n` (because cost is `O(log σ)` with σ fixed at 256). If it grows with `n`, you accidentally built a position-bound structure or your `rank` is doing a linear scan — fix the rank index. Then re-run with `sigma` = 16 vs 65536 to see the `log σ` dependence directly.
