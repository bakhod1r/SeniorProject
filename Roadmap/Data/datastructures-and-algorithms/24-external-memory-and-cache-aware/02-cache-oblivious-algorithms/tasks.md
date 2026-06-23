# Cache-Oblivious Algorithms — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the **block-cache I/O simulator** `(M, B)`, drive a **recursive, cache-oblivious** algorithm through it — *the algorithm never reads `M` or `B`* — and **count block transfers (I/Os)**. The acceptance test is always the same: *the measured I/O count matches the derived cache-oblivious bound across the tested sizes, with no `M`/`B` passed to the algorithm.*
> **[analysis]** tasks need no code: derive an I/O recurrence, solve it, or explain a layout from first principles — model derivations are provided so you can grade yourself.

A **cache-oblivious** algorithm achieves the optimal external-memory I/O bound **without knowing the cache parameters `M` (memory size) or `B` (block size)**. It is written once, parameter-free — typically as a balanced divide-and-conquer recursion — and the recursion's own geometry guarantees that *some* level of the recursion has subproblems of size `Θ(M)` or `Θ(B)`, so the algorithm is automatically tuned for **every** cache in the memory hierarchy (L1, L2, L3, RAM, disk) simultaneously. This is the central magic: one program, optimal at every level, no tuning constants.

The model is the **ideal-cache model** — the I/O model of the sibling topic, plus three idealizations that make the analysis clean:

- **`M`** — internal memory size in records; **`B`** — block (cache-line) size in records; one I/O transfers `B` consecutive records.
- **Optimal (offline) replacement.** The ideal cache evicts the block whose next use is farthest in the future (Belady). A real LRU cache is within a factor of `2` of this, so an oblivious bound proven under optimal replacement holds asymptotically under LRU too.
- **Full associativity.** Any block may live in any cache slot.
- **Tall-cache assumption.** `M ≥ B²` ("the cache is taller than it is wide"). A `√M × √M` submatrix then fits in cache with room for its rows' blocks. Most oblivious matrix bounds need this; state it when you use it.

The four landmark cache-oblivious bounds you will implement, measure, and prove:

| Problem | Cache-oblivious I/O bound | Mechanism |
| --- | --- | --- |
| **Matrix transpose** | `Θ(n²/B)` | recursive quadrant split; base tile fits a block |
| **Matrix multiply** | `Θ(n³/(B√M))` | 8-way recursive split; base tile fits in `M` |
| **Search (vEB layout)** | `Θ(log_B N)` | van Emde Boas recursive tree layout |
| **Sort (funnelsort)** | `Θ((N/B)·log_{M/B}(N/B))` | `k`-funnel lazy multiway merging |

The recurring discipline for every coding task is the same as for the I/O model: **instrument the cost, replay the workload, count the transfers — but here the algorithm is forbidden to look at `M` or `B`, and you confirm the count *still* matches the optimal bound for every `(M, B)` you test.** A cache-oblivious bound you never replay against a simulator is just a hope; a transfer count you cannot derive from the recurrence is just a number. Tie the two together on every task, and — crucially — confirm the *same* parameter-free code hits the bound across a *range* of `(M, B)`.

**Related practice:**
- [The I/O Model tasks](../01-the-io-model/tasks.md) — the `(M, B)` external-memory model, the `IOSim` block-cache simulator, and the cache-**aware** (blocked, `M`/`B`-tuned) versions of transpose, multiply, and search that these oblivious algorithms match without tuning.
- [External Sorting tasks](../03-external-sorting/tasks.md) — run formation and multiway merge, the cache-**aware** counterpart to funnelsort's `sort(N)` bound.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **Cache-oblivious vs cache-aware.** A cache-**aware** (or *blocked*) algorithm reads `M` and `B` and sizes its tiles to them (Task pairs in the I/O-model sibling). A cache-**oblivious** algorithm does not — it recurses to a constant base case and lets the hierarchy "find" the right level. The win: it is optimal at *all* levels at once and needs no per-machine tuning.
- **The recursion finds the level.** In a balanced recursion, subproblem sizes shrink geometrically: `n, n/2, n/4, …`. Somewhere there is a level where a subproblem first fits in cache (size `Θ(M)`) or in a block (size `Θ(B)`). Above that level the recursion only subdivides resident data (free); below it everything is one scan. The analysis hinges on identifying that level.
- **I/O recurrence.** Cache-oblivious cost is captured by a recurrence `Q(n)` for the I/O count, with a **base case** that switches from "recurse" to "the subproblem fits, charge a scan" once `n` is small enough (`n ≤ αM` or `n ≤ αB`). Solving `Q(n)` with that base case is the whole game.
- **Measured vs ideal cache.** The `IOSim` here uses LRU (as the sibling's does), not Belady. By the LRU-vs-OPT factor-`2` theorem the asymptotic bound is unaffected; expect measured constants within a small factor of the ideal-cache prediction.

---

## Beginner Tasks

### Task 1 — Reuse the `IOSim` block-cache simulator; confirm a recursive scan costs `⌈N/B⌉` **[coding]**

`[easy]` Every later task drives the same instrument you built (or will build) for [the I/O model](../01-the-io-model/tasks.md): a **block cache** parameterized by `M` and `B`, counting block transfers under LRU. Re-establish it here, then write a **recursive** (divide-and-conquer) array sum that splits `[lo, hi)` into two halves and recurses to a singleton base case. Because the recursion visits addresses left-to-right, it touches each block once: cost `⌈N/B⌉` — and *the recursion never reads `B`*.

The point of this warm-up: a parameter-free recursive traversal already matches the optimal scan bound for **every** `B`.

#### Python

```python
from collections import OrderedDict

class IOSim:
    """Block-cache external-memory simulator (LRU). Memory holds M//B blocks;
    one I/O transfers one block of B records. Counts block transfers (I/Os).
    The simulated ALGORITHM never sees M or B — only this harness does."""
    def __init__(self, M, B):
        assert M >= B and B >= 1
        self.B = B
        self.slots = M // B            # resident blocks memory can hold
        self.cache = OrderedDict()     # block_id -> True, in LRU order
        self.ios = 0

    def access(self, addr):
        blk = addr // self.B
        if blk in self.cache:
            self.cache.move_to_end(blk)          # LRU touch; resident -> free
            return
        self.ios += 1                            # fault: one block transfer
        if len(self.cache) >= self.slots:
            self.cache.popitem(last=False)       # evict least-recently-used block
        self.cache[blk] = True

def recursive_sum(sim, A, lo, hi):
    """Divide-and-conquer sum. Parameter-free: never reads sim.B or sim.slots."""
    if hi - lo == 1:
        sim.access(lo)                           # touch the single element's block
        return A[lo]
    mid = (lo + hi) // 2
    return recursive_sum(sim, A, lo, mid) + recursive_sum(sim, A, mid, hi)

if __name__ == "__main__":
    import math
    A = list(range(10_000))
    for (M, B) in [(100, 10), (1024, 64), (4096, 128)]:
        sim = IOSim(M, B)
        total = recursive_sum(sim, A, 0, len(A))
        expected = math.ceil(len(A) / B)
        assert total == sum(A)
        print(f"M={M:5d} B={B:4d}  recursive-sum I/Os={sim.ios:5d}  "
              f"ceil(N/B)={expected:5d}  match={sim.ios == expected}")
        assert sim.ios == expected, "recursive scan must cost exactly ceil(N/B)"
    print("OK: a parameter-free recursive scan = ceil(N/B) I/Os for every B")
```

#### Go (core)

```go
type IOSim struct {
	B, slots, ios int
	cache         map[int]int // blockID -> last-use tick
	tick          int
}

func (s *IOSim) Access(addr int) {
	blk := addr / s.B
	s.tick++
	if _, ok := s.cache[blk]; ok {
		s.cache[blk] = s.tick // resident: free, refresh LRU
		return
	}
	s.ios++
	if len(s.cache) >= s.slots {
		oldest, ot := -1, 1<<62
		for b, t := range s.cache {
			if t < ot {
				oldest, ot = b, t
			}
		}
		delete(s.cache, oldest)
	}
	s.cache[blk] = s.tick
}
```

- **Constraints:** The simulator (the harness) knows `M`, `B`; the **algorithm must not**. `recursive_sum` takes only the array and indices — no `B`, no slot count. The left-to-right recursion guarantees one fault per block.
- **Hint:** The recursion's leaves visit addresses `0, 1, …, N−1` in order. The first access to each block faults; subsequent accesses within the block hit. Exactly `⌈N/B⌉` distinct blocks ⇒ `⌈N/B⌉` faults — independent of `M` and never told `B`.
- **Acceptance test:** `sim.ios == ⌈N/B⌉` for **every** tested `(M, B)`, with the algorithm given neither parameter. This is the oblivious scan bound made exact. Keep this `IOSim` — every later task drives it.

---

### Task 2 — Recursive cache-oblivious matrix transpose; count I/Os, confirm `Θ(n²/B)` **[coding]**

`[easy]` Transpose an `n × n` row-major matrix `Bm[j][i] = A[i][j]`. The **naive** double loop accesses one of the two matrices against the grain (column stride `n ≥ B`), costing `Θ(n²)` I/Os. The **cache-oblivious** version recursively splits the larger dimension into halves and recurses; at the bottom, the active submatrices are small enough to fit in a block, so each block is touched once: `Θ(n²/B)` — *without the recursion ever reading `B`*.

Implement both through `IOSim` (one access per element read and written) and compare.

#### Python

```python
def naive_transpose_ios(sim, n, baseA, baseB):
    for i in range(n):
        for j in range(n):
            sim.access(baseA + i * n + j)        # read  A[i][j]  (sequential in A)
            sim.access(baseB + j * n + i)        # write Bm[j][i] (stride n in Bm)

def co_transpose(sim, n, baseA, baseB, ai, aj, bi, bj, rows, cols):
    """Recursively transpose a rows x cols block of A into Bm. Splits the LONGER
    side and recurses. Parameter-free: never reads sim.B."""
    if rows == 1 and cols == 1:
        sim.access(baseA + ai * n + aj)          # read A[ai][aj]
        sim.access(baseB + bi * n + bj)          # write Bm[bi][bj]
        return
    if rows >= cols:                             # split rows
        h = rows // 2
        co_transpose(sim, n, baseA, baseB, ai,     aj, bi,     bj, h,        cols)
        co_transpose(sim, n, baseA, baseB, ai + h, aj, bi, bj + h, rows - h, cols)
    else:                                        # split cols
        w = cols // 2
        co_transpose(sim, n, baseA, baseB, ai, aj,     bi,     bj, rows, w)
        co_transpose(sim, n, baseA, baseB, ai, aj + w, bi + w, bj, rows, cols - w)

if __name__ == "__main__":
    import math
    n = 128
    for (M, B) in [(1024, 16), (4096, 32), (16384, 64)]:
        s_naive = IOSim(M, B); naive_transpose_ios(s_naive, n, 0, n * n)
        s_co = IOSim(M, B)
        co_transpose(s_co, n, 0, n * n, 0, 0, 0, 0, n, n)
        ideal = 2 * math.ceil(n * n / B)         # each block of A and Bm touched ~once
        print(f"M={M:5d} B={B:3d}  naive={s_naive.ios:7d}  "
              f"oblivious={s_co.ios:7d}  ideal~2*ceil(n^2/B)={ideal:6d}  "
              f"speedup={s_naive.ios / s_co.ios:.1f}x")
        assert s_co.ios < s_naive.ios
        assert s_co.ios <= 4 * ideal             # within a small constant of optimal
    print("OK: oblivious transpose ~ Theta(n^2/B) for every (M,B), no B passed in")
```

- **Constraints:** Lay `A` and the output `Bm` in **disjoint** address ranges. The recursion splits the **longer** side (keeping subproblems near-square) and **must not read `B`** — it recurses to a `1 × 1` base. Assume a tall cache (`M ≥ B²`) so a near-square base submatrix fits a few blocks.
- **Hint:** Consider the recursion level where a submatrix first fits in `O(1)` blocks (side `Θ(√B)` if you stop at a `√B × √B` tile, or simply: once the active `rows × cols` region of *both* `A` and `Bm` fits in cache, every further access is free until the region is done). Above that level the recursion only subdivides; below it, each block is loaded once. Total `Θ(n²/B)`. The naive loop reloads a fresh block on nearly every strided write ⇒ `Θ(n²)`.
- **Acceptance test:** Oblivious I/Os `≈ 2⌈n²/B⌉` and stay within a small constant of optimal across **all** tested `(M, B)`; naive is `Θ(B)` times larger. The same `co_transpose` code — given no `B` — matches the blocked transpose of the I/O-model sibling.

---

### Task 3 — REAL wall-clock: naive vs recursive transpose on a large matrix **[coding + analysis]**

`[easy]` Leave the simulator and feel the effect on real hardware. Transpose a large `n × n` matrix two ways: the **naive** double loop (one matrix strided) and a **recursive** quadrant-splitting transpose. For large `n` the recursive version is several times faster — same `n²` element moves, same arithmetic — purely because it preserves spatial locality across the real cache hierarchy, *and it was never told the cache-line size or cache capacity*.

#### Python

```python
import time

def naive_transpose(A, Bm, n):
    for i in range(n):
        for j in range(n):
            Bm[j * n + i] = A[i * n + j]         # strided write -> fresh cache line

def rec_transpose(A, Bm, n, ai, aj, bi, bj, rows, cols):
    if rows * cols <= 256:                        # coarsen to a small base block
        for i in range(rows):
            for j in range(cols):
                Bm[(bi + j) * n + (bj + i)] = A[(ai + i) * n + (aj + j)]
        return
    if rows >= cols:
        h = rows // 2
        rec_transpose(A, Bm, n, ai, aj, bi, bj, h, cols)
        rec_transpose(A, Bm, n, ai + h, aj, bi, bj + h, rows - h, cols)
    else:
        w = cols // 2
        rec_transpose(A, Bm, n, ai, aj, bi, bj, rows, w)
        rec_transpose(A, Bm, n, ai, aj + w, bi + w, bj, rows, cols - w)

if __name__ == "__main__":
    import sys
    sys.setrecursionlimit(100000)
    for n in (512, 1024, 2048):
        A = [float(i) for i in range(n * n)]
        B1 = [0.0] * (n * n)
        B2 = [0.0] * (n * n)
        t0 = time.perf_counter(); naive_transpose(A, B1, n);    t_naive = time.perf_counter() - t0
        t0 = time.perf_counter()
        rec_transpose(A, B2, n, 0, 0, 0, 0, n, n);              t_rec = time.perf_counter() - t0
        assert B1 == B2
        print(f"n={n:5d}  naive={t_naive*1e3:8.1f} ms  recursive={t_rec*1e3:8.1f} ms  "
              f"speedup={t_naive / t_rec:4.1f}x")
```

#### Go (core loop, where the gap is sharpest)

```go
// Naive: strided writes to Bm fault a fresh cache line nearly every store.
for i := 0; i < n; i++ {
	for j := 0; j < n; j++ {
		Bm[j*n+i] = A[i*n+j]
	}
}
// Recursive: split the longer side to a small base block, preserving locality
// in BOTH A and Bm — without ever referencing the cache-line size.
```

- **Analysis to write:** The naive loop reads `A` sequentially but writes `Bm` with stride `n`: each store lands on a new cache line, so it pays up to `n²` line transfers — only the last `B` columns of a line are reused before eviction. The recursive transpose subdivides until the active sub-blocks of *both* `A` and `Bm` fit in cache; then both reads and writes hit lines already resident, so the whole matrix is moved in `Θ(n²/B)` line transfers. The recursion never names `B` — it just splits geometrically, and the hierarchy "finds" the level where a sub-block fits each cache. (Python's per-element overhead dilutes the ratio; the Go loop shows a cleaner gap.)
- **Constraints:** Same matrices, same element moves; only the traversal order differs. Use `n` large enough that a row (`n` elements) exceeds a cache line and the matrix exceeds L2, so eviction is real. The recursive base block must be coarsened (Task 11 studies this cutoff).
- **Acceptance test:** Recursive transpose is measurably faster than naive, and the gap **widens** with `n` as the working set spills out of cache. The explanation correctly attributes the win to the recursion preserving locality in both matrices without being told `B`.

---

### Task 4 — Naive vs recursive array reversal/scan: count I/Os, confirm parameter-free optimality **[coding]**

`[easy]` Reinforce the warm-up on a second access pattern. Reverse an array in place by swapping `A[i]` with `A[N−1−i]` — a *two-pointer* scan that converges from both ends. Implemented straightforwardly this is two simultaneous sequential scans (cost `Θ(N/B)`); a recursive variant that splits `[lo, hi)` and reverses halves achieves the same. Drive both through `IOSim` and confirm the I/O count is `Θ(N/B)` for every `(M, B)` — no `B` passed.

#### Python

```python
def iterative_reverse_ios(sim, N):
    """Two converging sequential scans: A[i] <-> A[N-1-i]."""
    i, j = 0, N - 1
    while i < j:
        sim.access(i)
        sim.access(j)
        i += 1
        j -= 1

def recursive_reverse_ios(sim, lo, hi):
    """Divide-and-conquer reverse: swap ends, recurse inward. Parameter-free."""
    if hi - lo <= 1:
        return
    sim.access(lo)
    sim.access(hi - 1)
    recursive_reverse_ios(sim, lo + 1, hi - 1)

if __name__ == "__main__":
    import math
    N = 8192
    for (M, B) in [(256, 16), (1024, 32), (4096, 64)]:
        s_it = IOSim(M, B); iterative_reverse_ios(s_it, N)
        s_rec = IOSim(M, B); recursive_reverse_ios(s_rec, lo=0, hi=N)
        # Two scans from opposite ends each touch N/(2B) blocks -> ~ N/B total.
        ideal = math.ceil(N / B)
        print(f"M={M:5d} B={B:3d}  iterative={s_it.ios:5d}  recursive={s_rec.ios:5d}  "
              f"ceil(N/B)={ideal:5d}")
        # Both are Theta(N/B); a tiny cache (M/B = 1 block) is the only way to inflate them.
        assert s_it.ios <= 3 * ideal
        assert s_rec.ios <= 3 * ideal
    print("OK: reversal is Theta(N/B), parameter-free, for every (M,B)")
```

- **Constraints:** The reversal touches two streams (front and back). With at least **two** block slots (`M/B ≥ 2`) both streams stay resident and the cost is `Θ(N/B)`. Neither implementation may read `B`. Note the degenerate `M/B = 1` case where the two streams evict each other — that boundary is the lesson.
- **Hint:** Front and back pointers each walk one block at a time. As long as the cache holds both active blocks, each block faults once: `N/(2B)` from the front plus `N/(2B)` from the back `= N/B`. The recursion gives the identical access multiset, so the same bound applies — geometry, not parameters, secures it.
- **Acceptance test:** Both versions cost `Θ(N/B)` (within a small constant of `⌈N/B⌉`) across all tested `(M, B)` with `M/B ≥ 2`, neither told `B`. A converging two-pointer scan is cache-oblivious-optimal for free.

---

## Intermediate Tasks

### Task 5 — Recursive cache-oblivious matrix multiply (8 subcalls); count I/Os **[coding]**

`[medium]` Multiply `C = A·B` for `n × n` matrices by **recursively splitting each matrix into four quadrants** and issuing the **8 sub-multiplications** of block matrix multiply (each `C` quadrant is the sum of two products). The recursion stops when a subproblem fits in memory (a constant base case). This parameter-free algorithm achieves `Θ(n³/(B√M))` I/Os — matching the cache-**aware** blocked multiply of the [I/O-model sibling](../01-the-io-model/tasks.md) **without reading `M` or `B`**. Drive it through `IOSim` and compare against the naive triple loop's `Θ(n³/B)`.

#### Python

```python
def naive_matmul_ios(sim, n, bA, bB, bC):
    for i in range(n):
        for j in range(n):
            for k in range(n):
                sim.access(bA + i * n + k)       # A[i][k]  sequential in k
                sim.access(bB + k * n + j)       # B[k][j]  STRIDE n -> fresh block
            sim.access(bC + i * n + j)           # write C[i][j]

def co_matmul(sim, n, bA, bB, bC, ar, ac, br, bc, cr, cc, sz):
    """Recursively multiply an sz x sz block: C[cr..][cc..] += A[ar..][ac..] * B[..].
    8-way quadrant recursion. Parameter-free: never reads sim.B or sim.slots."""
    if sz == 1:
        sim.access(bA + ar * n + ac)
        sim.access(bB + br * n + bc)
        sim.access(bC + cr * n + cc)             # accumulate one product term
        return
    h = sz // 2
    # C11 += A11*B11 + A12*B21 ; C12 += A11*B12 + A12*B22
    # C21 += A21*B11 + A22*B21 ; C22 += A21*B12 + A22*B22   (8 subcalls)
    co_matmul(sim, n, bA, bB, bC, ar,   ac,   br,   bc,   cr,   cc,   h)  # A11*B11
    co_matmul(sim, n, bA, bB, bC, ar,   ac+h, br+h, bc,   cr,   cc,   h)  # A12*B21
    co_matmul(sim, n, bA, bB, bC, ar,   ac,   br,   bc+h, cr,   cc+h, h)  # A11*B12
    co_matmul(sim, n, bA, bB, bC, ar,   ac+h, br+h, bc+h, cr,   cc+h, h)  # A12*B22
    co_matmul(sim, n, bA, bB, bC, ar+h, ac,   br,   bc,   cr+h, cc,   h)  # A21*B11
    co_matmul(sim, n, bA, bB, bC, ar+h, ac+h, br+h, bc,   cr+h, cc,   h)  # A22*B21
    co_matmul(sim, n, bA, bB, bC, ar+h, ac,   br,   bc+h, cr+h, cc+h, h)  # A21*B12
    co_matmul(sim, n, bA, bB, bC, ar+h, ac+h, br+h, bc+h, cr+h, cc+h, h)  # A22*B22

if __name__ == "__main__":
    import math
    n = 64                                       # power of two for clean quadrant splits
    bA, bB, bC = 0, n * n, 2 * n * n
    for (M, B) in [(256, 8), (1024, 16), (4096, 32)]:
        s_naive = IOSim(M, B); naive_matmul_ios(s_naive, n, bA, bB, bC)
        s_co = IOSim(M, B); co_matmul(s_co, n, bA, bB, bC, 0, 0, 0, 0, 0, 0, n)
        pred_naive = n**3 / B
        pred_co = n**3 / (B * math.sqrt(M))
        print(f"M={M:5d} B={B:3d}  naive={s_naive.ios:8d} (~n^3/B={pred_naive:.0f})  "
              f"oblivious={s_co.ios:8d} (~n^3/(B*sqrt M)={pred_co:.0f})  "
              f"speedup={s_naive.ios / s_co.ios:.1f}x")
        assert s_co.ios < s_naive.ios
    print("OK: 8-way recursive matmul ~ Theta(n^3/(B*sqrt M)) for every (M,B), no M/B passed")
```

- **Constraints:** `A`, `B`, `C` in disjoint address ranges; use `n` a power of two for clean halving. The recursion issues **exactly 8 subcalls** of half size and **must not read `M` or `B`** — it recurses to a `1 × 1` base. Assume a tall cache (`M ≥ B²`). The naive loop's `B[k][j]` strides by `n ≥ B`, faulting nearly every inner step.
- **Hint:** At the recursion level where a subproblem of side `s = Θ(√M)` first fits in cache (three `s × s` blocks `≤ M`), the entire sub-multiply runs with no further faults beyond loading those `Θ(s²/B)` blocks. There are `Θ((n/s)³)` such subproblems, each costing `Θ(s²/B)` I/Os ⇒ `Θ((n/s)³ · s²/B) = Θ(n³/(sB)) = Θ(n³/(B√M))`. The recursion *reaches* that level automatically — it never computes `s`.
- **Acceptance test:** Oblivious I/Os are `Θ(√M)` times fewer than naive across **all** tested `(M, B)`, matching `n³/(B√M)` to within a constant; the algorithm was given neither `M` nor `B`. Same bound as the blocked multiply, zero tuning.

---

### Task 6 — Derive and solve the I/O recurrence `Q(n) = 8Q(n/2) + Θ(n²/B)` **[analysis]**

`[medium]` Before trusting Task 5's measurement, derive its bound from the recursion. Set up the I/O recurrence for the 8-way recursive multiply, identify the base case (a subproblem fits in cache when `n² ≤ M`, i.e. side `n ≤ √M`), and solve.

> **No code.** Use this as the grading model.

**Model derivation.**

Let `Q(n)` be the number of I/Os to multiply two `n × n` matrices with the 8-way recursion under the ideal cache `(M, B)`, tall cache `M ≥ B²`.

*Base case.* Once a subproblem's three matrices fit in cache — three `n × n` blocks occupy `3n² ≤ M`, i.e. `n ≤ √(M/3) = Θ(√M)` — the *entire* sub-multiply touches only those resident blocks. Loading them costs `Θ(n²/B)` I/Os (each `n × n` matrix is `Θ(n²/B)` blocks under row-major, tall-cache layout), and nothing else faults. So

```
Q(n) = Θ(n² / B)           for  n ≤ √(M/3).
```

*Recursive case.* For larger `n`, the algorithm makes `8` subcalls of size `n/2`. Setting up the quadrant references and accumulating partial `C` blocks is a constant number of scans of the `n × n` operands — `Θ(n²/B)` I/Os of overhead per level. Hence

```
Q(n) = 8·Q(n/2) + Θ(n² / B)      for  n > √(M/3).
```

*Solve.* This is a classic divide-and-conquer recurrence. The recursion tree has branching factor `8` and the size halves each level, so a node at depth `d` handles size `n/2^d` and there are `8^d` nodes at that depth. The per-node work `Θ((n/2^d)²/B)` summed over the `8^d` nodes gives level cost

```
8^d · (n/2^d)² / B  =  (8/4)^d · n²/B  =  2^d · n²/B.
```

The level cost **doubles** with depth (geometrically increasing toward the leaves), so the sum is dominated by the **base level**, where `n/2^d = Θ(√M)`, i.e. `2^d = Θ(n/√M)`. The number of base-case subproblems is `8^d = Θ((n/√M)³)`, each costing `Θ(M/B)` I/Os (loading a `√M × √M` block triple):

```
Q(n) = Θ( (n/√M)³ · M/B ) = Θ( n³ / (M^{3/2}) · M / B ) = Θ( n³ / (B·√M) ).
```

So the 8-way oblivious multiply does `Θ(n³/(B√M))` I/Os — the same as the cache-aware blocked multiply, achieved without reading `M` or `B`. (Compare the naive triple loop: no reuse across the strided `B` column ⇒ `Θ(n³/B)`, a factor `√M` worse.)

- **Constraints:** State the base case `n² ≤ Θ(M)` (three operands), write `Q(n) = 8Q(n/2) + Θ(n²/B)`, show the recursion tree's level costs **increase** geometrically toward the leaves (so the base level dominates), and conclude `Θ(n³/(B√M))`. Note the tall-cache assumption where used.
- **Acceptance test:** The derivation pins the base case at side `Θ(√M)`, identifies leaf-dominated recursion (ratio `8/4 = 2 > 1` per level), and solves to `Θ(n³/(B√M))`, matching Task 5's measured `√M`-factor win over naive.

---

### Task 7 — Cache-AWARE tiled multiply: tune the tile to `B`/`√M` and compare **[coding + analysis]**

`[medium]` The oblivious multiply is optimal at every level without tuning, but a cache-**aware** *tiled* multiply — which **reads** `M`/`B` and sizes its tile to `√M` (and orders inner loops to match `B`) — can win a constant factor at the level it targets, because it eliminates the recursion's call overhead and packs tiles perfectly. Implement the tiled version, drive both through `IOSim`, compare I/O counts and (conceptually) overhead, and discuss when each wins.

#### Python

```python
import math

def tiled_matmul_ios(sim, n, bA, bB, bC, s):
    """Cache-AWARE: caller chooses tile side s ~ sqrt(M/3) from M, B."""
    for ii in range(0, n, s):
        for jj in range(0, n, s):
            for kk in range(0, n, s):
                for i in range(ii, min(ii + s, n)):
                    for j in range(jj, min(jj + s, n)):
                        for k in range(kk, min(kk + s, n)):
                            sim.access(bA + i * n + k)
                            sim.access(bB + k * n + j)
                        sim.access(bC + i * n + j)

if __name__ == "__main__":
    n = 64
    bA, bB, bC = 0, n * n, 2 * n * n
    for (M, B) in [(256, 8), (1024, 16), (4096, 32)]:
        s = max(1, int(math.isqrt(M // 3)))      # tuned tile: cache-AWARE
        s_tiled = IOSim(M, B); tiled_matmul_ios(s_tiled, n, bA, bB, bC, s)
        s_co = IOSim(M, B); co_matmul(s_co, n, bA, bB, bC, 0, 0, 0, 0, 0, 0, n)  # Task 5
        pred = n**3 / (B * math.sqrt(M))
        print(f"M={M:5d} B={B:3d}  tile s={s:2d}  tiled={s_tiled.ios:8d}  "
              f"oblivious={s_co.ios:8d}  pred~n^3/(B*sqrt M)={pred:.0f}  "
              f"tiled/oblivious={s_tiled.ios / s_co.ios:.2f}")
        # Both hit the same asymptotic bound; constants differ.
        assert s_tiled.ios <= 1.5 * pred * (1 if pred > 1 else 1) + n * n
    print("OK: tiled (aware) and recursive (oblivious) share Theta(n^3/(B sqrt M)); "
          "tiled tunes the constant, oblivious needs no tuning")
```

- **Analysis to write:** Both algorithms are `Θ(n³/(B√M))`. The cache-**aware** tiled version wins constants when (1) you *know* the exact level you are optimizing for (one machine, one cache level), so a perfectly sized `√M` tile beats the recursion's slightly-imperfect base blocks; and (2) recursion/call overhead is non-trivial, which a flat triple-tiled loop avoids. The cache-**oblivious** version wins when (1) you target the **whole hierarchy** at once (L1 *and* L2 *and* RAM — a single tile size cannot be optimal for all three, but the recursion is optimal at each); (2) the code must be **portable** across machines with unknown `M`/`B`; or (3) you face a *multi-level* or *unknown* cache (virtualized hardware, varied cache-line sizes). In practice, production BLAS uses *multi-level* tiling (aware, tuned per level) for the last constant factor; oblivious algorithms are the default when tuning is impractical. The deep point: *obliviousness costs at most a constant and buys optimality at every level simultaneously.*
- **Constraints:** The tiled version **reads `M`, `B`** to compute `s ≈ √(M/3)`; the oblivious version (Task 5) reads neither. Drive both through the same `IOSim`. Compare I/O counts and argue the overhead difference. Report the ratio across several `(M, B)`.
- **Acceptance test:** Both land at `Θ(n³/(B√M))`; the tiled version's I/O count is within a small constant of the oblivious one (often slightly fewer, by packing the targeted level perfectly). The write-up correctly identifies single-level-tuning and call-overhead as the aware win, and multi-level/portability/unknown-cache as the oblivious win.

---

### Task 8 — Confirm the *same* parameter-free code is optimal across a range of `(M, B)` **[coding]**

`[medium]` The defining property of a cache-oblivious algorithm is that **one** parameter-free program is optimal for **every** `(M, B)`. Make that property the experiment: take the oblivious transpose (Task 2) and multiply (Task 5) *unchanged*, sweep `(M, B)` across a hierarchy-like range, and verify each measured I/O count tracks its bound — with **no recompilation, no tuning constant, and no `M`/`B` ever passed to the algorithm**.

#### Python

```python
import math

def sweep_transpose(n):
    print(f"--- oblivious transpose, n={n} (algorithm sees no M,B) ---")
    print(f"{'M':>7} {'B':>5} {'measured':>10} {'~2*ceil(n^2/B)':>15} {'ratio':>7}")
    for (M, B) in [(256, 8), (1024, 16), (4096, 32), (16384, 64), (65536, 128)]:
        if M < B * B:                            # respect tall-cache where it matters
            continue
        sim = IOSim(M, B)
        co_transpose(sim, n, 0, n * n, 0, 0, 0, 0, n, n)     # Task 2, unchanged
        ideal = 2 * math.ceil(n * n / B)
        print(f"{M:>7} {B:>5} {sim.ios:>10} {ideal:>15} {sim.ios / ideal:>7.2f}")
        assert sim.ios <= 4 * ideal

def sweep_matmul(n):
    print(f"--- oblivious matmul, n={n} (algorithm sees no M,B) ---")
    print(f"{'M':>7} {'B':>5} {'measured':>10} {'~n^3/(B sqrt M)':>16} {'ratio':>7}")
    bA, bB, bC = 0, n * n, 2 * n * n
    for (M, B) in [(256, 8), (1024, 16), (4096, 32), (16384, 64)]:
        if M < B * B:
            continue
        sim = IOSim(M, B)
        co_matmul(sim, n, bA, bB, bC, 0, 0, 0, 0, 0, 0, n)   # Task 5, unchanged
        pred = n**3 / (B * math.sqrt(M))
        print(f"{M:>7} {B:>5} {sim.ios:>10} {pred:>16.0f} {sim.ios / pred:>7.2f}")

if __name__ == "__main__":
    sweep_transpose(128)
    sweep_matmul(64)
    print("\nOK: ONE parameter-free program tracks its bound at every (M,B) — "
          "the cache-oblivious property, demonstrated.")
```

- **Constraints:** The transpose and multiply routines are **byte-for-byte the same** as Tasks 2 and 5 — no overloads, no `B`-dependent base case, no tuning. Only the harness's `(M, B)` change between rows. Skip rows that violate the tall-cache assumption where the matrix bounds require it.
- **Hint:** A cache-**aware** algorithm tuned for one `(M, B)` would degrade (or need recompilation) at the others; the oblivious one's ratio-to-bound stays bounded by a constant across the whole sweep. That invariance — *not* the absolute count — is the property you are demonstrating.
- **Acceptance test:** Across the entire `(M, B)` sweep, each measured count stays within a small constant factor of its bound, with the identical program and no parameters passed. This is the cache-oblivious guarantee made empirical: write once, optimal everywhere.

---

## Advanced Tasks

### Task 9 — Van Emde Boas tree layout; I/O-counting search confirms `Θ(log_B N)` **[coding + analysis]**

`[hard]` A complete binary search tree stored in **BFS/level-order** (the heap layout `node i → children 2i+1, 2i+2`) costs `Θ(log₂ N)` I/Os to search: deep nodes are spread one-per-block, so each level fetches a fresh block. The **van Emde Boas (vEB) layout** instead stores the tree by **recursively splitting it at half its height**: a tree of height `h` becomes a *top* recursive subtree of height `h/2` whose every leaf points to one of `√N` *bottom* recursive subtrees of height `h/2`, each block laid out contiguously. A root-to-leaf search then crosses only `Θ(log_B N)` block boundaries — *with no knowledge of `B`*. Build both layouts, drive an I/O-counting search through `IOSim`, and confirm the gap across several `B`.

#### Python

```python
import math

def bfs_layout(N):
    """Level-order (heap) array positions for a complete BST of N nodes.
    sorted-key k (0..N-1) -> its address in the BFS array."""
    # Build by in-order assignment of sorted keys to a complete tree, addressed by BFS index.
    addr_of_node = {}                            # BFS node index -> array address (== index)
    # In BFS layout the array address IS the node index.
    return lambda node_idx: node_idx

def veb_layout(height):
    """Return a dict: BFS node index -> contiguous vEB address, for a complete tree
    of the given height (root height = number of levels). Recursive split at h/2."""
    addr = {}
    counter = [0]

    def recurse(node_idx, h, top_root_is_node):
        # Lay out a complete subtree of height h rooted at BFS index node_idx.
        if h == 1:
            addr[node_idx] = counter[0]; counter[0] += 1
            return
        top_h = h // 2
        bot_h = h - top_h
        # 1) Lay out the TOP subtree (height top_h) contiguously first.
        top_indices = _subtree_bfs_indices(node_idx, top_h)
        for idx in top_indices:
            addr[idx] = counter[0]; counter[0] += 1
        # 2) Then each BOTTOM subtree (one per leaf of the top) contiguously.
        for leaf in _leaves_at_depth(node_idx, top_h):
            # leaf's children roots the bottom subtree of height bot_h
            for child in (2 * leaf + 1, 2 * leaf + 2):
                recurse(child, bot_h, False)

    def _subtree_bfs_indices(root, levels):
        out, frontier = [], [root]
        for _ in range(levels):
            nxt = []
            for x in frontier:
                out.append(x); nxt += [2 * x + 1, 2 * x + 2]
            frontier = nxt
        return out[: (1 << levels) - 1]

    def _leaves_at_depth(root, depth):
        frontier = [root]
        for _ in range(depth - 1):
            frontier = [c for x in frontier for c in (2 * x + 1, 2 * x + 2)]
        return frontier

    recurse(0, height, True)
    return addr

def search_ios(sim, addr_fn, height, target_path):
    """Walk root->leaf, accessing each node's address. target_path is the sequence
    of BFS node indices on the search path (length = height). Parameter-free."""
    for node_idx in target_path:
        sim.access(addr_fn(node_idx))

if __name__ == "__main__":
    height = 16                                  # complete BST with 2^16 - 1 nodes
    N = (1 << height) - 1
    veb = veb_layout(height)
    veb_addr = lambda idx: veb[idx]
    bfs_addr = lambda idx: idx                   # BFS address == node index

    # A root-to-leaf path: keep going to the left child (BFS indices 0,1,3,7,...).
    path = []
    x = 0
    for _ in range(height):
        path.append(x); x = 2 * x + 1

    print(f"complete BST height={height}, N={N} nodes")
    print(f"{'B':>5} {'BFS I/Os':>9} {'log2 N':>7} {'vEB I/Os':>9} {'log_B N':>8} {'speedup':>8}")
    for B in (4, 16, 64, 256):
        M = 64 * B                               # cache holds 64 blocks (vEB never reads it)
        s_bfs = IOSim(M, B); search_ios(s_bfs, bfs_addr, height, path)
        s_veb = IOSim(M, B); search_ios(s_veb, veb_addr, height, path)
        logB = max(1, math.ceil(math.log(N, B)))
        print(f"{B:>5} {s_bfs.ios:>9} {height:>7} {s_veb.ios:>9} {logB:>8} "
              f"{s_bfs.ios / max(1, s_veb.ios):>7.1f}x")
        assert s_veb.ios <= s_bfs.ios            # vEB never worse
    print("\nOK: vEB search ~ Theta(log_B N) << BFS Theta(log2 N); same layout, every B")
```

- **Analysis to write:** Consider the level of the vEB recursion where each recursive subtree first fits in a single block — a subtree of height `Θ(log B)` (it has `Θ(B)` nodes, laid out contiguously). Because the layout recurses by **halving height**, the root-to-leaf path of length `log₂ N` is partitioned into `Θ(log₂ N / log₂ B) = Θ(log_B N)` such contiguous subtrees, and crossing each costs at most `O(1)` block fetches. So search is `Θ(log_B N)`. The BFS layout has no such contiguity: at depth `d` the `2^d` nodes are spread across `2^d` positions `≥ B` apart, so each of the last `Θ(log₂ N − log₂ B)` levels faults a fresh block ⇒ `Θ(log₂ N)`. The vEB layout achieves the B-tree's search bound **without knowing `B`** — the recursive height-halving makes *every* block size find a matching subtree level. This is why vEB layout underlies cache-oblivious B-trees and static search trees.
- **Constraints:** Build a **complete** BST (height a clean power-of-two-ish value). The vEB layout recursion **splits at half-height** and **must not read `B`**. The search routine only walks a precomputed root-to-leaf path of BFS indices, mapping each through the chosen address function. Compare BFS vs vEB across several `B` with **no relayout** between them — the *same* vEB array is searched for every `B`.
- **Acceptance test:** vEB search I/Os `≈ ⌈log_B N⌉` and BFS search I/Os `≈ log₂ N`, their ratio approaching `log₂ B`, across **all** tested `B` using the *one* vEB array. The recursive height-halving layout matches `Θ(log_B N)` for every block size without being told `B`.

---

### Task 10 — Funnelsort (or a 2-funnel): lazy multiway merge; count I/Os vs the sort bound **[coding]**

`[hard]` **Funnelsort** is the cache-oblivious optimal sort: it recursively sorts `N^{1/3}` segments of size `N^{2/3}`, then merges them with a **`k`-funnel** — a recursively laid-out, lazily-evaluated multiway merger whose buffer sizes form a `√k`-by-`√k` van-Emde-Boas-like structure. It achieves `Θ((N/B)·log_{M/B}(N/B))` I/Os — the optimal `sort(N)` bound — **without reading `M` or `B`**. Implement at minimum a **2-funnel** (binary lazy merge with recursively sized buffers) wired into the recursive sort, drive it through `IOSim`, and confirm the I/O count tracks the sort bound across `(M, B)`.

#### Python

```python
import math, random

def funnel_sort_ios(sim, A, lo, hi):
    """Cache-oblivious recursive sort using a binary funnel (2-merger) with
    recursively sized buffers. Parameter-free: never reads sim.B or sim.slots.
    Sorts A[lo:hi] in place (logic in memory); every disk touch goes through sim."""
    n = hi - lo
    if n <= 1:
        if n == 1:
            sim.access(lo)
        return
    if n <= 64:                                  # constant base case: a small scan-sort
        for a in range(lo, hi):
            sim.access(a)
        A[lo:hi] = sorted(A[lo:hi])
        for a in range(lo, hi):
            sim.access(a)
        return
    mid = lo + n // 2
    funnel_sort_ios(sim, A, lo, mid)             # recursively sort each half
    funnel_sort_ios(sim, A, mid, hi)
    # ---- 2-funnel merge: stream both sorted halves through block-sized buffers. ----
    # Reading each half sequentially and writing the merged output sequentially
    # transfers each record O(1) times -> Theta(n/B) I/Os for this merge.
    left = A[lo:mid]
    right = A[mid:hi]
    for a in range(lo, mid):
        sim.access(a)                            # read left half (buffered, sequential)
    for a in range(mid, hi):
        sim.access(a)                            # read right half
    import heapq
    merged = list(heapq.merge(left, right))
    for off, v in enumerate(merged):
        A[lo + off] = v
        sim.access(lo + off)                     # write merged output (sequential)

if __name__ == "__main__":
    random.seed(0)
    print(f"{'N':>6} {'M':>6} {'B':>4} {'measured':>9} "
          f"{'~sort(N)=2N/B*(1+P)':>20} {'ratio':>6}")
    for (N, M, B) in [(4096, 256, 16), (8192, 512, 32), (16384, 1024, 64)]:
        A = [random.randint(0, 10**9) for _ in range(N)]
        gold = sorted(A)
        sim = IOSim(M, B)
        funnel_sort_ios(sim, A, 0, N)
        assert A == gold, "funnelsort must produce a sorted array"
        k = max(2, M // B - 1)
        R0 = math.ceil(N / M)
        P = max(0, math.ceil(math.log(R0, k))) if R0 > 1 else 0
        predicted = (2 * math.ceil(N / B)) * (1 + P)
        # Binary-funnel constant is larger than optimal k-funnel; allow generous slack.
        print(f"{N:>6} {M:>6} {B:>4} {sim.ios:>9} {predicted:>20} "
              f"{sim.ios / predicted:>6.2f}")
        assert sim.ios <= 8 * predicted          # within a (binary-merge) constant of sort(N)
    print("OK: funnel sort ~ Theta((N/B) log(N/B)) for every (M,B), no M/B passed")
```

- **Analysis to write:** The full `k`-funnel's power is that its buffer sizes are laid out recursively (van-Emde-Boas style), so at the recursion level where a sub-funnel fits in cache it merges `Θ(M^{2/3})` streams with only `Θ(scan)` I/Os, giving the optimal `Θ((N/B)·log_{M/B}(N/B))` — *the same fan-in `M/B` benefit as cache-aware external merge sort, but with no parameter read*. The **binary** funnel implemented here is a simplified stand-in: each merge level is a full scan in and out (`Θ(n/B)`), and the recursion has `Θ(log₂ N)` levels, so this 2-funnel costs `Θ((N/B)·log₂ N)` — correct in form but with the binary (not `M/B`) base, hence the generous constant slack. The optimal funnelsort recovers the `M/B` base by merging `√N`-way at each level via the recursively-buffered funnel; replacing the `heapq.merge` with a true `k`-funnel is the upgrade that tightens the constant to the `log_{M/B}` bound. Either way, **the merge buffers are sized by the recursion, never by `M` or `B`** — that is what makes it oblivious.
- **Constraints:** The sort and merge are **parameter-free** (no `M`/`B`). Every disk read and write goes through `sim.access` so the count is honest. The output must be **sorted** (correctness precedes any I/O claim). A constant base case (coarsened, Task 11) avoids singleton-recursion overhead.
- **Acceptance test:** The output is sorted, and the measured I/O count tracks the `sort(N)` bound (within a binary-merge constant) across **all** tested `(M, B)`, with no parameters passed to the algorithm. The buffer/recursion geometry — not `M`/`B` — secures the bound.

---

### Task 11 — Base-case coarsening: tune the recursion cutoff, measure the constant-factor effect **[coding + analysis]**

`[hard]` A pure cache-oblivious recursion to a `1`-element base case pays heavy *recursion overhead* (function calls, index arithmetic) that, while not changing the asymptotic I/O bound, inflates the **constant factor** and wall-clock time. The standard fix is **base-case coarsening**: stop recursing at a small constant size `c` and run a tight iterative kernel on the base block. Sweep the cutoff `c` for the oblivious transpose and matrix multiply, measure both **I/Os** (should stay `Θ(n²/B)` / `Θ(n³/(B√M))` for any small `c`) and **wall-clock** (should improve then plateau), and find the sweet spot.

#### Python

```python
import time, math

def co_transpose_cutoff(sim, n, baseA, baseB, ai, aj, bi, bj, rows, cols, c):
    """Oblivious transpose with a coarsened base block of side <= c. Still parameter-free
    in M,B; c is a CONSTANT, not a cache parameter."""
    if rows <= c and cols <= c:                  # iterative kernel on the small block
        for i in range(rows):
            for j in range(cols):
                sim.access(baseA + (ai + i) * n + (aj + j))
                sim.access(baseB + (bj + j) * n + (bi + i))
        return
    if rows >= cols:
        h = rows // 2
        co_transpose_cutoff(sim, n, baseA, baseB, ai, aj, bi, bj, h, cols, c)
        co_transpose_cutoff(sim, n, baseA, baseB, ai + h, aj, bi, bj + h, rows - h, cols, c)
    else:
        w = cols // 2
        co_transpose_cutoff(sim, n, baseA, baseB, ai, aj, bi, bj, rows, w, c)
        co_transpose_cutoff(sim, n, baseA, baseB, ai, aj + w, bi + w, bj, rows, cols - w, c)

if __name__ == "__main__":
    n, M, B = 256, 4096, 32
    ideal = 2 * math.ceil(n * n / B)
    print(f"oblivious transpose  n={n} M={M} B={B}  (ideal ~ {ideal} I/Os)")
    print(f"{'cutoff c':>9} {'I/Os':>8} {'I/O ratio':>10} {'wall (ms)':>10}")
    A = [float(i) for i in range(n * n)]
    Bm = [0.0] * (n * n)

    def rec_real(ai, aj, bi, bj, rows, cols, c):
        if rows <= c and cols <= c:
            for i in range(rows):
                for j in range(cols):
                    Bm[(bj + j) * n + (bi + i)] = A[(ai + i) * n + (aj + j)]
            return
        if rows >= cols:
            h = rows // 2
            rec_real(ai, aj, bi, bj, h, cols, c)
            rec_real(ai + h, aj, bi, bj + h, rows - h, cols, c)
        else:
            w = cols // 2
            rec_real(ai, aj, bi, bj, rows, w, c)
            rec_real(ai, aj + w, bi + w, bj, rows, cols - w, c)

    for c in (1, 2, 4, 8, 16, 32, 64):
        sim = IOSim(M, B)
        co_transpose_cutoff(sim, n, 0, n * n, 0, 0, 0, 0, n, n, c)
        t0 = time.perf_counter(); rec_real(0, 0, 0, 0, n, n, c); t = time.perf_counter() - t0
        print(f"{c:>9} {sim.ios:>8} {sim.ios / ideal:>10.2f} {t * 1e3:>10.2f}")
    print("\nI/O count stays ~Theta(n^2/B) for all small c; wall-clock improves "
          "as recursion overhead falls, then plateaus near c ~ block-fit size.")
```

- **Analysis to write:** Coarsening the base case from `1` to a constant `c` changes the I/O count by at most a **constant factor**: the asymptotic argument only needs the recursion to reach a level where a subproblem fits in a block/cache, and any `c = O(√B)` still resolves below that level, so `Θ(n²/B)` (transpose) and `Θ(n³/(B√M))` (multiply) are preserved. What coarsening *does* improve is the **leading constant and the real running time**: a `1`-element base case makes `Θ(n²)` recursive calls whose per-call overhead dwarfs the actual memory move; a kernel over a `c × c` block amortizes call overhead across `c²` element moves and lets the compiler vectorize the tight loop. The wall-clock curve falls as `c` rises (less overhead) then **plateaus or rises** once `c` grows past the cache-fit point (the base block stops fitting nicely, or the kernel itself starts thrashing). The sweet spot is `c` near the block/L1-fit size — *but note this is a constant, chosen once, not a cache parameter the algorithm reads at runtime, so the algorithm remains cache-oblivious.* This is the practical reconciliation: oblivious for the asymptotics and portability, a fixed coarsening constant for the leading factor.
- **Constraints:** The cutoff `c` is a **fixed constant**, not derived from `M` or `B` at runtime — the algorithm stays oblivious. Measure both I/Os (via `IOSim`) and real wall-clock (via a plain array kernel). Sweep `c` across a range spanning below and above the block-fit size.
- **Acceptance test:** The I/O count stays within a constant of the ideal `Θ(n²/B)` for **every** small `c` (asymptotics unaffected), while wall-clock **decreases** as `c` grows from `1` then **plateaus/rises** past the block-fit point. The chosen `c` is a constant, so the algorithm remains cache-oblivious — coarsening tunes the constant, not the bound.

---

### Task 12 — Cache-oblivious vs cache-aware across a *simulated multi-level* hierarchy **[coding + analysis]**

`[hard]` The headline advantage of obliviousness is optimality at **every** level of a *multi-level* hierarchy simultaneously — something a single cache-aware tile size cannot achieve. Simulate a **two-level** hierarchy (an L1-like small/fast cache inside an L2-like larger/slower cache, each with its own `(M, B)`), drive the oblivious transpose/multiply through *both* counters at once, and compare against a cache-aware algorithm tuned for **only one** level — showing the aware version is suboptimal at the *other* level while the oblivious one is optimal at both.

#### Python

```python
import math

class TwoLevelSim:
    """Two independent block-cache counters: a fast inner cache (M1,B1) and a
    larger outer cache (M2,B2). Every access is charged to BOTH levels.
    The ALGORITHM sees neither pair of parameters."""
    def __init__(self, M1, B1, M2, B2):
        self.l1 = IOSim(M1, B1)
        self.l2 = IOSim(M2, B2)
    def access(self, addr):
        self.l1.access(addr)
        self.l2.access(addr)

def tiled_transpose_ios(sim, n, baseA, baseB, t):
    """Cache-AWARE transpose tuned to ONE tile size t."""
    for ii in range(0, n, t):
        for jj in range(0, n, t):
            for i in range(ii, min(ii + t, n)):
                for j in range(jj, min(jj + t, n)):
                    sim.access(baseA + i * n + j)
                    sim.access(baseB + j * n + i)

if __name__ == "__main__":
    n = 128
    # L1: tiny fast cache; L2: larger cache. Different B at each level.
    M1, B1 = 256, 8
    M2, B2 = 8192, 64
    ideal1 = 2 * math.ceil(n * n / B1)
    ideal2 = 2 * math.ceil(n * n / B2)

    # Oblivious: ONE parameter-free program (Task 2), charged to both levels.
    sim_co = TwoLevelSim(M1, B1, M2, B2)
    co_transpose(sim_co, n, 0, n * n, 0, 0, 0, 0, n, n)        # Task 2, unchanged

    # Aware-for-L1: tile sized to L1 (t ~ sqrt(M1)). Good at L1, may waste at L2.
    t1 = max(1, int(math.isqrt(M1 // 2)))
    sim_a1 = TwoLevelSim(M1, B1, M2, B2); tiled_transpose_ios(sim_a1, n, 0, n * n, t1)
    # Aware-for-L2: tile sized to L2. Good at L2, poor at L1.
    t2 = max(1, int(math.isqrt(M2 // 2)))
    sim_a2 = TwoLevelSim(M1, B1, M2, B2); tiled_transpose_ios(sim_a2, n, 0, n * n, t2)

    print(f"n={n}  L1=(M{M1},B{B1})  L2=(M{M2},B{B2})")
    print(f"{'algorithm':>16} {'L1 I/Os':>9} {'L1 ideal':>9} {'L2 I/Os':>9} {'L2 ideal':>9}")
    print(f"{'oblivious':>16} {sim_co.l1.ios:>9} {ideal1:>9} {sim_co.l2.ios:>9} {ideal2:>9}")
    print(f"{'aware-for-L1':>16} {sim_a1.l1.ios:>9} {ideal1:>9} {sim_a1.l2.ios:>9} {ideal2:>9}")
    print(f"{'aware-for-L2':>16} {sim_a2.l1.ios:>9} {ideal1:>9} {sim_a2.l2.ios:>9} {ideal2:>9}")
    # The oblivious program is near-optimal at BOTH levels at once.
    assert sim_co.l1.ios <= 4 * ideal1 and sim_co.l2.ios <= 4 * ideal2
    print("\nOK: one oblivious program is near-optimal at L1 AND L2; "
          "each aware tiling is optimal at its own level but worse at the other.")
```

- **Analysis to write:** A cache-aware algorithm picks **one** tile size `t`. Tuned to L1 (`t ≈ √M₁`), it is optimal at L1 but its tile is far smaller than `√M₂`, so at L2 it under-uses the larger cache and pays more L2 transfers than necessary. Tuned to L2, the tile overflows L1 and thrashes the fast cache. There is no single `t` optimal at both levels because the optimal tile sizes differ (`√M₁ ≠ √M₂`). The cache-**oblivious** recursion, by contrast, contains subproblems of *every* size as it descends, so it automatically has a level that fits L1 *and* a level that fits L2 — it is optimal at **both** simultaneously, with one parameter-free program. This is precisely why cache-oblivious algorithms matter on real machines with `≥ 3` cache levels plus TLB plus disk: tuning one level pessimizes others, while obliviousness wins them all at a constant-factor cost. (Production numerical libraries answer with *multi-level* tiling — aware, hand-tuned per level — when the last constant factor justifies the engineering; oblivious algorithms are the portable default.)
- **Constraints:** Charge every access to **both** level counters via `TwoLevelSim`. The oblivious routine is unchanged from Task 2 (no parameters). Build two aware tilings, each tuned to one level, and show each is worse than oblivious at the *other* level. Use distinct `B` at the two levels to make the mismatch concrete.
- **Acceptance test:** The oblivious program is within a small constant of the ideal at **both** L1 and L2 simultaneously; the L1-tuned aware version is good at L1 but worse at L2 (and vice versa). One parameter-free program dominates the multi-level hierarchy — the core justification for cache-obliviousness.

---

## Synthesis Task

> Tie the four cache-oblivious bounds together: build the simulator, drive each parameter-free recursion through it, count I/Os, derive the recurrence, and confirm every measured count matches its optimal bound — `transpose`, `multiply`, `vEB search`, `funnelsort` — *with no `M`/`B` ever passed to the algorithm, across a range of `(M, B)`.*

`[capstone]` Carry the **ideal-cache model** end to end: a recursive scan, recursive transpose, 8-way recursive multiply, vEB-layout search, and a funnel sort — each measured against its bound across several `(M, B)`, plus the real-hardware experiment and the multi-level argument that justify obliviousness.

1. **Simulator + recursive scan [coding].** Reuse `IOSim(M, B)` (Task 1); confirm a parameter-free recursive scan costs `⌈N/B⌉` for any `M ≥ B`.

2. **Transpose [coding + analysis].** Recursive cache-oblivious transpose at `Θ(n²/B)` (Task 2), confirmed across `(M, B)`; the real-hardware naive-vs-recursive gap (Task 3) explained via cache lines.

3. **Multiply [coding + analysis].** 8-way recursive multiply at `Θ(n³/(B√M))` (Task 5); derive and solve `Q(n) = 8Q(n/2) + Θ(n²/B)` with base case `n² ≤ M` (Task 6); compare against the cache-aware tiled multiply and state when each wins (Task 7).

4. **Search [coding + analysis].** vEB layout search at `Θ(log_B N)` versus the BFS layout's `Θ(log₂ N)` (Task 9), confirmed across several `B` with no relayout.

5. **Sort [coding + analysis].** Funnelsort (or a 2-funnel) tracking the `sort(N)` bound `Θ((N/B)·log_{M/B}(N/B))` (Task 10), with base-case coarsening tuning the constant (Task 11) and the multi-level hierarchy argument closing the case for obliviousness (Task 12).

Reference harness in **Python** (combines the pieces):

```python
import math

def co_bounds(n, M, B):
    """Predicted cache-oblivious I/O bounds for the four primitives."""
    transpose = 2 * math.ceil(n * n / B)
    multiply = n**3 / (B * math.sqrt(M))
    search = max(1, math.ceil(math.log(n, B)))            # vEB: log_B N
    k = max(2, M // B - 1)
    R0 = math.ceil(n / M)
    P = max(0, math.ceil(math.log(R0, k))) if R0 > 1 else 0
    sort = (2 * math.ceil(n / B)) * (1 + P)              # funnelsort: Theta(sort(N))
    return transpose, multiply, search, sort

if __name__ == "__main__":
    print(f"{'n':>8} {'M':>8} {'B':>5} {'transpose':>10} {'multiply':>12} "
          f"{'search log_B':>13} {'sort':>10}")
    for (n, M, B) in [(128, 1024, 16), (256, 4096, 32), (512, 16384, 64), (1024, 65536, 128)]:
        if M < B * B:
            continue
        tr, mul, se, so = co_bounds(n, M, B)
        print(f"{n:>8} {M:>8} {B:>5} {tr:>10} {mul:>12.0f} {se:>13} {so:>10}")
        assert se <= math.ceil(math.log2(n))            # log_B N <= log2 N
        assert mul <= n**3 / B                           # oblivious <= naive
    print("\ntranspose Theta(n^2/B); multiply Theta(n^3/(B sqrt M)); "
          "search Theta(log_B N); sort Theta((N/B) log_{M/B}(N/B)) — all parameter-free.")
```

- **Analysis answer:** A recursive scan is `Θ(N/B)` — the geometry visits each block once. Transpose is `Θ(n²/B)` — the quadrant recursion reaches a level where sub-blocks fit a block. Multiply is `Θ(n³/(B√M))` — the 8-way recursion's leaf level fits a `√M × √M` triple, solving `Q(n) = 8Q(n/2) + Θ(n²/B)` to a leaf-dominated `Θ(n³/(B√M))`. vEB-layout search is `Θ(log_B N)` — height-halving partitions the root-leaf path into `Θ(log_B N)` contiguous subtrees, beating the BFS layout's `Θ(log₂ N)` by `log₂ B`. Funnelsort is `Θ((N/B)·log_{M/B}(N/B))` — the recursively-buffered `k`-funnel recovers the `M/B` fan-in base. **Every one is parameter-free**, so a single program is optimal at every level of the hierarchy at once — at a constant-factor cost over hand-tuned cache-aware tiling, and with no per-machine tuning. The real-hardware and multi-level experiments show *why*: the recursion preserves locality the strided naive loop destroys, and contains a fitting subproblem for L1, L2, and RAM simultaneously.
- **Acceptance test:** Every measured I/O count matches its bound across the tested `(M, B)`, with no `M`/`B` passed to any algorithm: recursive scan `= ⌈N/B⌉`; transpose `≈ 2⌈n²/B⌉`; multiply `Θ(√M)`-times below naive and within a constant of `n³/(B√M)`; vEB search `≈ ⌈log_B N⌉ ≤ log₂ N`; funnelsort sorted and within a (binary-merge) constant of `sort(N)`. The wall-clock transpose and the two-level hierarchy experiments both exhibit the locality and multi-level wins. The write-up places the four primitives on the cache-oblivious map — **`scan(N) < log_B N`** in growth, **`sort(N)` and `multiply` the dominant costs** — mirroring the whole discipline: *write one parameter-free recursion, drive it through the simulator, count the transfers, derive the recurrence, and confirm the measured count matches the optimal bound at every `(M, B)`.*

---

## Where to go next

- Build the cache-**aware** counterparts — the `(M, B)`-tuned blocked transpose, blocked multiply, B-tree search, and external merge sort — and the `IOSim` they all drive, in [the I/O-model tasks](../01-the-io-model/tasks.md); the oblivious algorithms here match each one without tuning.
- Push the `sort(N)` bound through run formation, multiway and polyphase merge, and double buffering — the cache-aware face of funnelsort — in the [external-sorting tasks](../03-external-sorting/tasks.md).
- For the conceptual treatment of the ideal-cache model, the tall-cache assumption, the recursion-finds-the-level argument, the vEB layout, funnelsort, and the cache-oblivious B-tree, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
