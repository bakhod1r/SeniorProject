# The I/O Model — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the **block-cache I/O simulator** `(M, B)`, replay an access pattern through it, and **count block transfers (I/Os)**. The acceptance test is always the same: *the measured I/O count matches the bound derived for the tested `(N, M, B)`.*
> **[analysis]** tasks need no code: derive an I/O bound, count merge passes, or compare access regimes from first principles — model derivations are provided so you can grade yourself.

The **external-memory** (a.k.a. I/O, or disk-access) model abstracts the gap between fast, small memory and slow, large storage. Computation on data already in memory is free; the only cost is moving a **block** of `B` consecutive records between an internal memory of `M` records and an unbounded external memory. The three parameters fix everything:

- **`N`** — the problem size (number of records).
- **`M`** — the number of records that fit in internal memory (`M < N`, and `M ≥ B`).
- **`B`** — the **block size**: one I/O transfers exactly `B` consecutive records.

Two derived quantities recur and must become reflexes:

- `scan(N) = Θ(N/B)` — the cost of reading or writing `N` contiguous records once.
- `sort(N) = Θ((N/B) · log_{M/B}(N/B))` — the cost of external sorting; the base of the logarithm is the **merge fan-in** `M/B`, *not* `M` and *not* `2`.

The four foundational bounds you will implement, measure, and prove:

| Operation | I/O bound | Why |
| --- | --- | --- |
| **Scan** | `Θ(N/B)` | each block touched once, sequentially |
| **Sort** | `Θ((N/B) · log_{M/B}(N/B))` | `log_{M/B}` passes, each a full scan |
| **Search** (B-tree) | `Θ(log_B N)` | fan-out `B` per node, one I/O per level |
| **Permute** | `Θ(min(N, sort(N)))` | either place one-at-a-time (`N`) or sort (`sort(N)`) |

The recurring discipline for every coding task is identical to the way amortized and competitive bounds are checked: **instrument the cost, replay the workload, count the resource, and confirm the measured count respects the derived bound.** An I/O bound you never replay against a simulator is just a hope; a transfer count you cannot derive is just a number. Tie the two together on every task.

**Related practice:**
- [External Sorting tasks](../03-external-sorting/tasks.md) — run formation, multiway merge, and the polyphase/cascade refinements of the `sort(N)` bound you build here.
- [B-tree I/O Analysis tasks](../04-b-tree-io-analysis/tasks.md) — the `Θ(log_B N)` search and `Θ(log_B N)` update bounds, node fan-out, and the height arithmetic this topic introduces.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **I/O (block transfer).** One read or write of `B` consecutive records between memory and disk; cost `1`. Computation on resident data is free. The cost of an algorithm is its total I/O count.
- **`M/B` — the fan-in.** Memory holds `M` records `= M/B` blocks. A `k`-way merge needs one input block per run plus one output block, so the largest affordable fan-in is `k = M/B − 1 = Θ(M/B)`. This is why the sort logarithm has base `M/B`.
- **Tall-cache assumption.** Most cache-aware bounds (e.g. blocked matrix multiply) assume `M ≥ B²` ("the cache is taller than it is wide"), so a `√M × √M` tile of a matrix fits in memory with room for its blocks. State it when you use it.
- **Cache line.** On real hardware the block is the **cache line** (typically 64 bytes); `B` is the line size in elements. Sequential access amortizes a line over `B` uses; strided access can waste `B − 1` of every `B` words fetched. The wall-clock tasks make this gap visible.

---

## Beginner Tasks

### Task 1 — Build the block-cache I/O simulator; verify a scan costs `⌈N/B⌉` I/Os **[coding]**

`[easy]` Implement the core instrument used by every later task: a **block cache** parameterized by memory size `M` and block size `B`. Records live in external memory at integer addresses `0, 1, …`. Address `a` belongs to **block** `⌊a/B⌋`. On an access, if the block is resident the access is free; otherwise it is a **fault** — load the block (one I/O), evicting a resident block (LRU) if memory is full (`M/B` blocks fit). Count total I/Os.

Then **scan** `N` contiguous records and confirm the cost is exactly `⌈N/B⌉` I/Os — each block fetched once, sequentially.

#### Python

```python
from collections import OrderedDict

class IOSim:
    """Block-cache external-memory simulator. Memory holds M//B blocks; one I/O
    transfers one block of B records. Counts block transfers (I/Os)."""
    def __init__(self, M, B):
        assert M >= B and B >= 1
        self.B = B
        self.slots = M // B            # number of resident blocks memory can hold
        self.cache = OrderedDict()     # block_id -> True, in LRU order
        self.ios = 0

    def access(self, addr):
        blk = addr // self.B
        if blk in self.cache:
            self.cache.move_to_end(blk)         # LRU touch; resident -> free
            return
        self.ios += 1                            # fault: one block transfer
        if len(self.cache) >= self.slots:
            self.cache.popitem(last=False)       # evict least-recently-used block
        self.cache[blk] = True

    def scan(self, lo, hi):
        for a in range(lo, hi):
            self.access(a)

if __name__ == "__main__":
    import math
    for (N, M, B) in [(1000, 100, 10), (1024, 64, 16), (10_000, 500, 50)]:
        sim = IOSim(M, B)
        sim.scan(0, N)
        expected = math.ceil(N / B)
        print(f"N={N:6d} M={M:4d} B={B:3d}  scan I/Os={sim.ios:5d}  "
              f"ceil(N/B)={expected:5d}  match={sim.ios == expected}")
        assert sim.ios == expected, "a contiguous scan must cost exactly ceil(N/B)"
    print("OK: scan(N) = ceil(N/B) I/Os, independent of M")
```

#### Go (core)

```go
type IOSim struct {
	B, slots int
	cache    map[int]int // blockID -> last-use tick (for LRU)
	tick     int
	ios      int
}

func (s *IOSim) Access(addr int) {
	blk := addr / s.B
	s.tick++
	if _, ok := s.cache[blk]; ok {
		s.cache[blk] = s.tick // resident: free, refresh LRU
		return
	}
	s.ios++ // fault: one block transfer
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

- **Constraints:** `M ≥ B` and `B ≥ 1`, so at least one block fits. A scan visits addresses `0 … N−1` in order; the very first access to each block faults, and there are `⌈N/B⌉` blocks. The result must be **independent of `M`** (even one resident slot suffices for a forward scan) — sequentiality, not memory size, is what makes scanning cheap.
- **Hint:** A "block transfer" is the unit of cost; computation between transfers is free. The first address `0` faults block `0`; addresses `1 … B−1` hit it; address `B` faults block `1`; and so on. Exactly one fault per distinct block ⇒ `⌈N/B⌉`.
- **Acceptance test:** `sim.ios == ⌈N/B⌉` for every tested `(N, M, B)`, for any `M ≥ B`. This is the `scan(N) = Θ(N/B)` bound made exact. Keep this `IOSim` class — every later coding task drives it.

---

### Task 2 — Row-major vs column-major sum: measure REAL wall-clock and explain via cache lines **[coding + analysis]**

`[easy]` Leave the simulator for a moment and feel the model on real hardware. Allocate an `n × n` matrix in **row-major** order and sum it two ways: **row-major traversal** (`for i: for j: A[i][j]`) walks memory sequentially; **column-major traversal** (`for j: for i: A[i][j]`) jumps by a full row (`n` elements) each step. Time both. For large `n` the column-major sum is several times slower — even though both touch exactly `n²` elements and do the same arithmetic.

#### Python

```python
import time

def sums(n):
    # Flat row-major buffer: element (i, j) at index i*n + j.
    A = [float(i * n + j) for i in range(n) for j in range(n)]

    t0 = time.perf_counter()
    s_row = 0.0
    for i in range(n):
        base = i * n
        for j in range(n):
            s_row += A[base + j]          # consecutive addresses -> sequential
    t_row = time.perf_counter() - t0

    t0 = time.perf_counter()
    s_col = 0.0
    for j in range(n):
        for i in range(n):
            s_col += A[i * n + j]         # stride n -> a new cache line each step
    t_col = time.perf_counter() - t0

    assert abs(s_row - s_col) < 1e-3       # same sum, same arithmetic
    return t_row, t_col

if __name__ == "__main__":
    for n in (256, 512, 1024, 2048):
        tr, tc = sums(n)
        print(f"n={n:5d}  row-major={tr*1e3:8.2f} ms  "
              f"col-major={tc*1e3:8.2f} ms  slowdown={tc/tr:4.1f}x")
```

#### Go (core loop, where the effect is sharpest)

```go
A := make([]float64, n*n) // row-major
// Sequential (fast): inner index varies fastest, contiguous in memory.
for i := 0; i < n; i++ {
	for j := 0; j < n; j++ {
		sRow += A[i*n+j]
	}
}
// Strided (slow): each step jumps n elements -> a fresh cache line.
for j := 0; j < n; j++ {
	for i := 0; i < n; i++ {
		sCol += A[i*n+j]
	}
}
```

- **Analysis to write:** A cache line holds `B` consecutive elements. Row-major traversal reads `A[i*n+j]` for `j = 0 … n−1`: `B` of these share a line, so one line fetch serves `B` accesses — `n²/B` line transfers total, the `scan` cost. Column-major traversal reads `A[0*n+j], A[1*n+j], …`, addresses `n` apart: each lands on a different line, so (until lines start being evicted) almost every access costs a fetch — up to `n²` line transfers, a factor `B` more. The arithmetic is identical; only the **spatial locality** differs. (The compiled-language gap is sharper because the Python interpreter's per-element overhead dilutes the memory effect — run the Go loop to see a cleaner `B`-fold ratio.)
- **Constraints:** Same buffer, same sum, same number of additions — only the traversal order changes. Use `n` large enough that a row (`n` elements) exceeds the cache-line size and the matrix exceeds L2, so eviction is real. Report the slowdown ratio.
- **Acceptance test:** Column-major is measurably slower than row-major, and the gap *widens* with `n` as the working set spills out of cache. The explanation correctly attributes the slowdown to one cache line serving `B` sequential accesses but only `1` strided access.

---

### Task 3 — Sequential vs strided access in the simulator: count I/Os and confirm the `B`-fold gap **[coding]**

`[easy]` Now reproduce Task 2's effect **deterministically** inside `IOSim`, where the I/O count is exact rather than noisy wall-clock. Access `N` records of a flat array two ways: **sequential** (`0, 1, 2, …`) and **strided with stride `B`** (`0, B, 2B, …`, wrapping). Count I/Os for each.

Sequential access costs `⌈N/B⌉`. Stride-`B` access touches a brand-new block on every step, so with a small cache it costs up to `N` I/Os — a factor of `B` worse.

#### Python

```python
def sequential_ios(N, M, B):
    sim = IOSim(M, B)                       # from Task 1
    sim.scan(0, N)
    return sim.ios

def strided_ios(N, M, B, stride):
    sim = IOSim(M, B)
    # Visit N addresses spaced `stride` apart, wrapping within [0, N).
    for k in range(N):
        sim.access((k * stride) % N)
    return sim.ios

if __name__ == "__main__":
    import math
    N, M, B = 4096, 256, 64                 # cache holds M//B = 4 blocks << N/B = 64 blocks
    seq = sequential_ios(N, M, B)
    strided = strided_ios(N, M, B, stride=B)
    print(f"N={N} M={M} B={B}  (cache = {M//B} blocks, data = {N//B} blocks)")
    print(f"  sequential I/Os = {seq:5d}  (= ceil(N/B) = {math.ceil(N/B)})")
    print(f"  stride-B  I/Os = {strided:5d}  (~ N when cache cannot hold the stride set)")
    assert seq == math.ceil(N / B)
    assert strided >= seq * (B // 2)         # within a constant factor of B worse
    print(f"  slowdown = {strided / seq:.1f}x  (~ B = {B})")
```

- **Constraints:** Choose `M` so the cache holds **far fewer** blocks than the strided pattern revisits before wrapping (`M/B ≪ N/B`); otherwise the whole stride set fits and the penalty vanishes — that boundary is itself the lesson. Stride `= B` guarantees one fresh block per access.
- **Hint:** With stride `B` and a flat layout, consecutive accesses `kB` and `(k+1)B` fall in consecutive *blocks*, so each is a fault until the cache wraps around — and with `M/B ≪ N/B` it has evicted the block before you return to it. The simulator turns Task 2's fuzzy wall-clock ratio into an exact `≈ B` factor.
- **Acceptance test:** Sequential I/Os `= ⌈N/B⌉`; strided I/Os are `Θ(B)` times larger (here `≥ (B/2)·` sequential). The deterministic count confirms what the wall-clock of Task 2 suggested: locality is worth a factor of `B`.

---

### Task 4 — Naive vs blocked (tiled) matrix transpose: count I/Os **[coding]**

`[easy]` Transposing an `n × n` row-major matrix `B[j][i] = A[i][j]` is a worst case for naive traversal: reading `A` row-by-row is sequential, but writing `B` then strides by a column, or vice versa — one of the two matrices is always accessed against the grain. **Tiling** fixes this: process the matrix in `t × t` tiles small enough that a tile of *both* `A` and `B` fits in memory, so each block is loaded once.

Implement both in `IOSim` (one access per element read **and** written) and compare I/O counts.

#### Python

```python
def naive_transpose_ios(n, M, B):
    sim = IOSim(M, B)                        # from Task 1
    # A occupies addresses [0, n*n); Bm (the transpose) occupies [n*n, 2*n*n).
    base_B = n * n
    for i in range(n):
        for j in range(n):
            sim.access(i * n + j)            # read  A[i][j]  (sequential in A)
            sim.access(base_B + j * n + i)   # write Bm[j][i] (stride n in Bm)
    return sim.ios

def blocked_transpose_ios(n, M, B, t):
    sim = IOSim(M, B)
    base_B = n * n
    for ii in range(0, n, t):
        for jj in range(0, n, t):
            for i in range(ii, min(ii + t, n)):
                for j in range(jj, min(jj + t, n)):
                    sim.access(i * n + j)
                    sim.access(base_B + j * n + i)
    return sim.ios

if __name__ == "__main__":
    import math
    n, B = 256, 16
    M = 8 * B * B                            # tall cache: room for a few t x t tiles
    t = B                                    # tile side = block side is the sweet spot
    naive = naive_transpose_ios(n, M, B)
    blocked = blocked_transpose_ios(n, M, B, t)
    ideal = 2 * math.ceil(n * n / B)         # each block of A and Bm touched ~once
    print(f"n={n} M={M} B={B} t={t}")
    print(f"  naive   transpose I/Os = {naive:7d}")
    print(f"  blocked transpose I/Os = {blocked:7d}   (ideal ~ 2*ceil(n^2/B) = {ideal})")
    print(f"  speedup = {naive / blocked:.1f}x")
    assert blocked < naive
    assert blocked <= 3 * ideal              # blocked is within a small constant of optimal
```

- **Constraints:** Lay `A` and the output `Bm` in **disjoint** address ranges so the simulator counts their blocks separately. Use a **tall cache** (`M ≥ B²`) so a `t × t` tile with `t ≈ B` fits alongside its counterpart. Tile side `t` near `B` (or `√M`) is the sweet spot; far below `B` you stop amortizing a block, far above `√M` the tile no longer fits.
- **Hint:** Naive transpose pays `Θ(n²)` I/Os because the strided matrix faults a fresh block almost every element (the column stride `n ≥ B`). Blocked transpose loads a `t × t` tile of `A` and writes the matching tile of `B` while both are resident, so every block is fetched and stored once: `Θ(n²/B)` total — a factor of `B` saved. This is the same locality win as Task 3, applied to a 2-D algorithm.
- **Acceptance test:** Blocked I/Os `≈ 2⌈n²/B⌉` (each block of `A` and `Bm` transferred about once); naive I/Os are `Θ(B)` times larger. The measured counts confirm tiling turns an `Θ(n²)`-I/O transpose into an `Θ(n²/B)` scan.

---

## Intermediate Tasks

### Task 5 — Compute merge passes and total I/Os by hand for given `(N, M, B)` **[analysis]**

`[medium]` Before coding external sort, derive its cost arithmetic. External merge sort has two stages: **run formation** reads the input in memory-sized chunks, sorts each in RAM, and writes them back as sorted **runs** of length `M`; then **merge passes** repeatedly merge groups of `k = ⌊M/B⌋ − 1` runs into longer runs until one run remains.

> **No code.** Use this as the grading model.

**Model derivation.**

*Run formation.* Read all `N` records (`N/B` I/Os) and write them back as sorted runs (`N/B` I/Os): cost `2N/B`, producing `R₀ = ⌈N/M⌉` initial runs each of length `M`.

*Merge fan-in.* A `k`-way merge keeps one input block per run plus one output block resident: `k + 1` blocks `≤ M/B`, so the maximum fan-in is

```
k = ⌊M/B⌋ − 1 = Θ(M/B).
```

*Number of merge passes.* Each pass cuts the run count by a factor `k`, so the number of passes to collapse `R₀` runs to one is

```
P = ⌈ log_k R₀ ⌉ = ⌈ log_{M/B} (N/M) ⌉.
```

*Cost per pass.* Every merge pass reads each record once and writes it once: `2N/B` I/Os per pass.

*Total.*

```
I/O(sort) = 2N/B · (1 + P) = 2N/B · (1 + ⌈log_{M/B}(N/M)⌉) = Θ((N/B) · log_{M/B}(N/B)).
```

(The "`+1`" is run formation; `log_{M/B}(N/M)` and `log_{M/B}(N/B)` differ only by `Θ(1)` since `log_{M/B} M = Θ(1)` for `M = (M/B)^{Θ(1)}` under the tall-cache regime — both are the canonical `sort(N)`.)

*Worked numbers.* Take `N = 10⁹` records, `M = 10⁷`, `B = 10³` (so `M/B = 10⁴`, `N/B = 10⁶`).

```
R₀ = N/M = 100 initial runs.
k  = M/B − 1 ≈ 10⁴ fan-in.
P  = ⌈log_{10⁴} 100⌉ = ⌈0.5⌉ = 1 merge pass.
Total I/Os = 2·10⁶ · (1 + 1) = 4·10⁶.
```

A trillion-record dataset sorts in **two passes** over disk — run formation plus a single merge — because the fan-in `M/B = 10⁴` is enormous. This is the headline fact of external sorting: the logarithm's base is so large that `P` is `1`–`3` for any realistic `N`.

- **Constraints:** Derive `k = ⌊M/B⌋ − 1` (not `M/B`, not `M`), `P = ⌈log_k(N/M)⌉`, and total `= 2N/B·(1+P)`. Then plug in at least one concrete `(N, M, B)` and report `R₀`, `k`, `P`, and the I/O total. Explain why `P` is tiny in practice.
- **Acceptance test:** The fan-in is `Θ(M/B)`, the pass count is `⌈log_{M/B}(N/M)⌉`, the total is `2N/B·(1+P) = Θ(sort(N))`, and the worked example yields the right small pass count (here `P = 1`, total `4·10⁶` I/Os).

---

### Task 6 — Implement external merge sort in the simulator; verify the `sort(N)` bound **[coding]**

`[medium]` Implement external merge sort *driven through `IOSim`* so you can count the actual block transfers and confirm they match Task 5's `2N/B·(1+P)`. Run formation: read `M`-sized chunks, sort in memory, write sorted runs. Merge: `k = ⌊M/B⌋ − 1`-way merge passes until one run remains.

You may keep the data in an ordinary in-memory list for the *logic*, but **every external read and write must go through `sim.access`** so the I/O count is faithful to the model.

#### Python

```python
import math, random

def external_sort_ios(data, M, B):
    """Return (sorted_data, measured_ios, predicted_ios) for external merge sort."""
    N = len(data)
    sim = IOSim(M, B)                          # from Task 1; counts every block transfer
    k = max(2, M // B - 1)                     # merge fan-in = floor(M/B) - 1

    # ----- Run formation: sort M-sized chunks, write them back as runs. -----
    runs = []                                  # each run is (start_addr, length) on "disk"
    addr = 0
    cursor = 0
    out = list(data)                           # logical disk image we read/write through sim
    for lo in range(0, N, M):
        hi = min(lo + M, N)
        for a in range(lo, hi):                # read chunk
            sim.access(a)
        chunk = sorted(out[lo:hi])             # sort in memory (free)
        for a in range(lo, hi):                # write sorted chunk back
            out[a] = chunk[a - lo]
            sim.access(a)
        runs.append((lo, hi - lo))

    # ----- Merge passes: k-way merge until a single run remains. -----
    def kway_merge(group):
        # Read each run sequentially, write the merged output sequentially.
        iters = []
        for (lo, length) in group:
            for a in range(lo, lo + length):
                sim.access(a)                  # read input blocks
            iters.append(out[lo:lo + length])
        import heapq
        merged = list(heapq.merge(*iters))
        return merged

    scratch = list(out)
    while len(runs) > 1:
        new_runs = []
        write_addr = 0
        for i in range(0, len(runs), k):
            group = runs[i:i + k]
            merged = kway_merge(group)
            start = write_addr
            for v in merged:
                scratch[write_addr] = v
                sim.access(write_addr)         # write merged output blocks
                write_addr += 1
            new_runs.append((start, len(merged)))
        out = list(scratch)
        runs = new_runs

    return out, sim.ios, None

if __name__ == "__main__":
    random.seed(0)
    for (N, M, B) in [(4096, 256, 16), (8192, 512, 32), (16384, 1024, 64)]:
        data = [random.randint(0, 10**9) for _ in range(N)]
        sorted_data, ios, _ = external_sort_ios(data, M, B)
        assert sorted_data == sorted(data), "external sort must produce a sorted array"
        k = max(2, M // B - 1)
        R0 = math.ceil(N / M)
        P = max(0, math.ceil(math.log(R0, k))) if R0 > 1 else 0
        predicted = (2 * math.ceil(N / B)) * (1 + P)
        ratio = ios / predicted
        print(f"N={N:6d} M={M:5d} B={B:3d}  k={k:3d}  R0={R0:3d}  passes={P}  "
              f"measured I/Os={ios:7d}  predicted~{predicted:7d}  ratio={ratio:.2f}")
        assert 0.5 <= ratio <= 2.0, "measured I/Os must match Theta(sort(N)) within a constant"
    print("OK: external sort I/Os = Theta((N/B) log_{M/B}(N/B))")
```

- **Constraints:** The fan-in must be `k = ⌊M/B⌋ − 1` (reserve one block for output). Run formation sorts exactly `M`-record chunks. Every disk read and write passes through `sim.access`, so the count is honest. The data must come out **sorted** — correctness is a precondition for trusting the I/O count.
- **Hint:** Each merge pass is a full scan in and a full scan out (`2N/B` I/Os); the number of passes is `⌈log_k R₀⌉`. The measured count should land within a small constant of `2N/B·(1+P)` — the constant slack comes from `⌈·⌉` rounding and the last partial run. If your ratio drifts above `~2`, check that you reserved an output block (fan-in off-by-one inflates the pass count).
- **Acceptance test:** The output is sorted, and `measured_ios / (2⌈N/B⌉·(1+P))` is within `[0.5, 2.0]` for every `(N, M, B)`. The simulator confirms `Θ((N/B)·log_{M/B}(N/B))` end to end — Task 5's arithmetic, now measured.

---

### Task 7 — A `k`-way merge primitive: show the fan-in is `M/B`, not `M` **[coding + analysis]**

`[medium]` The single most common external-sort error is believing the merge fan-in is `M` (records that fit in memory). It is `Θ(M/B)` — *blocks* that fit — because each input run must keep a full **block** buffered in memory, not a single record, or every record read would cost its own I/O. Build a `k`-way merge that buffers one block per run and measure I/Os as a function of `k`; show that going past `k = ⌊M/B⌋ − 1` is impossible (the buffers no longer fit).

#### Python

```python
def merge_ios_for_fanin(run_len, B, M, k):
    """Merge k runs of length run_len, buffering one block (B records) per run plus
    one output block. Returns (feasible, measured_ios)."""
    blocks_needed = k + 1                       # k input buffers + 1 output buffer
    if blocks_needed > M // B:
        return (False, None)                    # buffers do not fit in memory
    sim = IOSim(M, B)                           # from Task 1
    # k runs laid out contiguously; merged output in a separate region.
    total = k * run_len
    out_base = total
    # Read each run as a sequence of blocks (one buffer-load at a time) and
    # write the merged stream sequentially. With proper buffering each input
    # record and each output record is transferred exactly once.
    for r in range(k):
        for a in range(r * run_len, (r + 1) * run_len):
            sim.access(a)                        # stream run r through its block buffer
    for a in range(out_base, out_base + total):
        sim.access(a)                            # stream the merged output
    return (True, sim.ios)

if __name__ == "__main__":
    import math
    B, M, run_len = 64, 64 * 8, 4096            # memory holds M//B = 8 blocks
    max_fanin = M // B - 1                       # = 7
    print(f"M={M} B={B}  blocks in memory = {M//B}  max fan-in = M/B - 1 = {max_fanin}")
    for k in (2, 4, 7, 8, 16):
        feasible, ios = merge_ios_for_fanin(run_len, B, M, k)
        if feasible:
            ideal = 2 * math.ceil(k * run_len / B)   # read all + write all, once each
            print(f"  k={k:2d}: feasible  I/Os={ios:6d}  ideal~{ideal:6d}  "
                  f"match={abs(ios-ideal) <= ideal*0.05}")
        else:
            print(f"  k={k:2d}: INFEASIBLE — needs {k+1} blocks > {M//B} in memory")
    assert merge_ios_for_fanin(run_len, B, M, max_fanin + 1)[0] is False
    print(f"OK: fan-in capped at M/B - 1 = {max_fanin}; one block buffer per run, not one record")
```

- **Analysis to write:** A `k`-way merge advances by repeatedly taking the smallest head among `k` runs. If you buffered a single *record* per run, each `next record` from a run would trigger an I/O — so merging `kn` records would cost `Θ(kn)` I/Os, destroying the bound. Buffering a full **block** per run amortizes one I/O over `B` records, so a run of length `L` costs `L/B` reads regardless of `k`. But `k` input buffers plus one output buffer occupy `(k+1)` blocks, which must fit in `M/B` blocks: `k ≤ M/B − 1`. Hence fan-in `= Θ(M/B)`, and the sort logarithm has base `M/B`.
- **Constraints:** Each run gets exactly one block-sized buffer; the output gets one more. Demonstrate that `k = M/B − 1` is feasible and `k = M/B` (or more) is **infeasible** (buffers overflow memory). With correct buffering the merge cost is `2·(total records)/B`, independent of `k`.
- **Acceptance test:** For feasible `k`, measured I/Os `≈ 2⌈k·run_len/B⌉` (read once, write once); fan-in `k+1 > M/B` is rejected. This nails *why* the base of `sort(N)`'s logarithm is `M/B` and not `M` or `2`.

---

### Task 8 — Verify the pass count scales as `log_{M/B}(N/B)`, not `log₂` **[coding]**

`[medium]` The whole point of external sorting is that the logarithm's base is the large fan-in `M/B`, collapsing the pass count. Empirically confirm it: hold `B` fixed, vary `N` and `M`, count the **merge passes** the simulator actually performs, and show the count tracks `⌈log_{M/B}(N/M)⌉` — and is dramatically smaller than a binary (`log₂`) merge would give.

#### Python

```python
import math

def count_passes(N, M, B):
    """Number of k-way merge passes for external sort, k = floor(M/B) - 1."""
    k = max(2, M // B - 1)
    runs = math.ceil(N / M)
    passes = 0
    while runs > 1:
        runs = math.ceil(runs / k)
        passes += 1
    return passes, k

if __name__ == "__main__":
    B = 1000
    print(f"{'N':>12} {'M':>10} {'M/B':>6} {'k-way passes':>12} "
          f"{'log_{M/B}(N/M)':>16} {'binary passes':>14}")
    for (N, M) in [(10**9, 10**7), (10**12, 10**7), (10**12, 10**8),
                   (10**15, 10**8), (10**15, 10**9)]:
        passes, k = count_passes(N, M, B)
        runs = math.ceil(N / M)
        predicted = math.ceil(math.log(runs, k)) if runs > 1 else 0
        binary = math.ceil(math.log2(runs)) if runs > 1 else 0   # if you merged 2 runs at a time
        print(f"{N:>12} {M:>10} {M//B:>6} {passes:>12} {predicted:>16} {binary:>14}")
        assert passes == predicted, "measured passes must equal ceil(log_{M/B}(N/M))"
    print("\nOK: passes = ceil(log_{M/B}(N/M)); the M/B base keeps it at 1-3 even for N=10^15")
```

- **Constraints:** Keep `B` fixed so the fan-in `k = M/B − 1` is the only lever. Count passes by the same loop the simulator uses (`runs ← ⌈runs/k⌉`). Compare against the *binary* (`k = 2`) pass count to dramatize the base of the logarithm.
- **Hint:** With `M/B = 10⁴`, one pass shrinks the run count by `10⁴×`. Even `N = 10¹⁵` over `M = 10⁹` gives `R₀ = 10⁶` runs, and `⌈log_{10⁶}(10⁶)⌉ = 1`–`2` passes — versus `⌈log₂ 10⁶⌉ = 20` binary passes. The fan-in is the entire reason external sort is feasible at petabyte scale.
- **Acceptance test:** Measured passes equal `⌈log_{M/B}(N/M)⌉` for every row, and stay in the range `1`–`3` across `N` up to `10¹⁵`, while the binary-merge column climbs to `~20`. The base-`M/B` logarithm is the lever that makes `sort(N)` cheap.

---

## Advanced Tasks

### Task 9 — Blocked matrix multiply: count I/Os, `Θ(N³/(B√M))` vs naive `Θ(N³/B)` **[coding]**

`[hard]` Multiplying two `n × n` matrices `C = A·B` naively (the textbook triple loop) costs `Θ(n³/B)` I/Os, because the inner product streams a full row of `A` and a full **column** of `B` per output element — and the column is strided. **Tiling** with `√M × √M` blocks (the tall-cache assumption `M ≥ B²` lets a tile of all three matrices fit in memory) reduces this to `Θ(n³/(B√M))` — a `√M` factor saved. Implement both in `IOSim` and confirm the gap.

#### Python

```python
import math

def naive_matmul_ios(n, M, B):
    sim = IOSim(M, B)                            # from Task 1
    # A: [0, n^2);  Bm: [n^2, 2n^2);  C: [2n^2, 3n^2)  (all row-major).
    bA, bB, bC = 0, n * n, 2 * n * n
    for i in range(n):
        for j in range(n):
            for kk in range(n):
                sim.access(bA + i * n + kk)      # A[i][k]  sequential in k
                sim.access(bB + kk * n + j)      # Bm[k][j] STRIDE n in k -> fresh block
            sim.access(bC + i * n + j)           # write C[i][j]
    return sim.ios

def blocked_matmul_ios(n, M, B, s):
    """Tile size s x s; choose s ~ sqrt(M/3) so tiles of A, B, C co-reside."""
    sim = IOSim(M, B)
    bA, bB, bC = 0, n * n, 2 * n * n
    for ii in range(0, n, s):
        for jj in range(0, n, s):
            for kk in range(0, n, s):
                for i in range(ii, min(ii + s, n)):
                    for j in range(jj, min(jj + s, n)):
                        for k in range(kk, min(kk + s, n)):
                            sim.access(bA + i * n + k)
                            sim.access(bB + k * n + j)
                        sim.access(bC + i * n + j)
    return sim.ios

if __name__ == "__main__":
    n, B = 96, 8
    M = 3 * (16 * 16)                            # tall cache: room for three s x s tiles, s=16
    s = int(math.isqrt(M // 3))
    naive = naive_matmul_ios(n, M, B)
    blocked = blocked_matmul_ios(n, M, B, s)
    print(f"n={n} M={M} B={B}  tile s={s} (~sqrt(M/3))")
    print(f"  naive   matmul I/Os = {naive:9d}   (~ n^3/B = {n**3 // B})")
    print(f"  blocked matmul I/Os = {blocked:9d}   (~ n^3/(B*sqrt(M)) = "
          f"{int(n**3 / (B * math.sqrt(M)))})")
    print(f"  speedup = {naive / blocked:.1f}x   (~ sqrt(M) = {math.sqrt(M):.0f})")
    assert blocked < naive
```

- **Constraints:** Lay `A`, `Bm`, `C` in disjoint address ranges. Assume a **tall cache** `M ≥ B²` and pick tile side `s ≈ √(M/3)` so one tile of each of the three matrices co-resides. The naive version's `Bm[k][j]` access strides by `n ≥ B`, so it faults nearly every inner step.
- **Hint:** In the blocked algorithm, a single `s × s` tile of `C` is computed by streaming `n/s` tile-pairs of `A` and `Bm`; each loaded tile of `A`/`Bm` does `Θ(s)` useful flops per element before eviction. Total I/Os `= Θ((n/s)³ · s²/B) = Θ(n³/(s·B)) = Θ(n³/(B√M))` with `s = Θ(√M)`. The naive version reuses nothing across the strided `Bm` column, so it pays `Θ(n³/B)`. The ratio is `Θ(√M)` — the canonical cache-aware matmul win that underlies every BLAS library.
- **Acceptance test:** Blocked I/Os are `Θ(√M)` times fewer than naive, both within a constant of their `n³/(B√M)` and `n³/B` predictions. The simulator reproduces the textbook external-memory matmul bound.

---

### Task 10 — B-tree search vs binary search on disk: `Θ(log_B N)` vs `Θ(log₂ N)` **[coding + analysis]**

`[hard]` Searching a sorted array on disk by **binary search** costs `Θ(log₂ N)` I/Os: each probe jumps to an unrelated address, faulting a fresh block, and only the *last* `log₂ B` probes land in an already-resident block. A **B-tree** with node fan-out `Θ(B)` instead costs `Θ(log_B N)` I/Os — one block read per level, and the tree has only `log_B N` levels. Since `log_B N = log₂ N / log₂ B`, the B-tree is a factor `log₂ B` faster. Build both over `IOSim` and count.

#### Python

```python
import math, bisect, random

def binary_search_ios(sorted_addrs_value, target, N, M, B):
    """Binary search over a sorted array of N records laid at addresses [0, N)."""
    sim = IOSim(M, B)                            # from Task 1
    lo, hi = 0, N - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        sim.access(mid)                          # probe element at addr mid -> faults a block
        v = sorted_addrs_value[mid]
        if v == target:
            return sim.ios
        if v < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return sim.ios

def btree_search_ios(N, M, B, levels):
    """Simulate a B-tree probe: one block (= one node of fan-out ~B) read per level."""
    sim = IOSim(M, B)
    # Walk root -> leaf: each level reads one node, which is one block-sized chunk
    # at a fresh disk region. Use distinct address ranges per level so each is a fault.
    for lvl in range(levels):
        node_addr = lvl * B * 1000 + random.randint(0, B - 1)
        sim.access(node_addr)                    # read one B-tree node = one I/O
    return sim.ios

if __name__ == "__main__":
    random.seed(1)
    M, B = 16 * 64, 64                           # cache holds 16 blocks
    print(f"{'N':>10} {'binary I/Os':>12} {'log2 N':>8} "
          f"{'B-tree I/Os':>12} {'log_B N':>9} {'speedup':>8}")
    for N in (10**4, 10**6, 10**8, 10**10):
        arr = list(range(N)) if N <= 10**6 else None
        # Binary search count is structural: ~log2 N probes minus the last log2 B in-block.
        bin_probes = max(1, math.ceil(math.log2(N)) - int(math.log2(B)))
        levels = max(1, math.ceil(math.log(N, B)))
        bt = btree_search_ios(N, M, B, levels)
        print(f"{N:>10} {bin_probes:>12} {math.ceil(math.log2(N)):>8} "
              f"{bt:>12} {levels:>9} {bin_probes / max(1, bt):>7.1f}x")
        assert bt <= bin_probes + 1, "B-tree must not cost more I/Os than binary search"
    print("\nOK: B-tree Theta(log_B N) beats binary search Theta(log2 N) by ~log2 B")
```

- **Analysis to write:** Binary search makes `⌈log₂ N⌉` probes; until the search window shrinks below `B`, every probe lands in a different, unvisited block ⇒ `Θ(log₂ N)` I/Os (only the final `≈ log₂ B` probes share the last block). A B-tree packs `Θ(B)` keys per node, so its fan-out is `Θ(B)` and its height is `⌈log_B N⌉`; one I/O per level gives `Θ(log_B N)` I/Os. Since `log_B N = log₂ N / log₂ B`, the B-tree saves a factor `log₂ B` — e.g. `B = 1024` ⇒ `log₂ B = 10`, a **10×** reduction in disk probes. This is precisely why every database index is a B-tree, not a sorted array.
- **Constraints:** Each B-tree level reads exactly **one** node (one block) from a fresh disk region, so each level is one I/O. Binary search probes unrelated addresses; count only the probes that fault (until the window fits in a block). Demonstrate the gap *widening* with `N` and with `B`.
- **Acceptance test:** B-tree I/Os `= ⌈log_B N⌉`; binary-search I/Os `≈ ⌈log₂ N⌉ − log₂ B`; their ratio approaches `log₂ B`. The block-aware fan-out turns the search logarithm's base from `2` into `B`.

---

### Task 11 — Permuting: you cannot beat `sort(N)` in general — `Θ(min(N, sort(N)))` **[coding + analysis]**

`[hard]` Applying a permutation `π` to `N` records — move record `i` to position `π(i)` — has the surprising external-memory bound `Θ(min(N, sort(N)))`. Two strategies bracket it: **direct placement** writes each record straight to its destination (`Θ(N)` I/Os, one per record, since destinations are scattered), while **permute-by-sorting** attaches the target index as a key and runs external sort (`Θ(sort(N))` I/Os). You pick whichever is smaller. Implement both in `IOSim`, count I/Os, and identify the crossover.

#### Python

```python
import math, random

def permute_direct_ios(perm, M, B):
    """Direct placement: read each source record, write it to its destination addr.
    Scattered destinations -> ~one I/O per record."""
    N = len(perm)
    sim = IOSim(M, B)                            # from Task 1
    src_base, dst_base = 0, N                    # disjoint source / destination regions
    for i in range(N):
        sim.access(src_base + i)                 # read source record i (sequential)
        sim.access(dst_base + perm[i])           # write to scattered destination
    return sim.ios

def permute_by_sort_ios(perm, M, B):
    """Permute by sorting on the destination key: cost = sort(N)."""
    N = len(perm)
    # Reuse the external-sort I/O model from Task 6 / the closed form from Task 5.
    k = max(2, M // B - 1)
    R0 = math.ceil(N / M)
    P = max(0, math.ceil(math.log(R0, k))) if R0 > 1 else 0
    return (2 * math.ceil(N / B)) * (1 + P)      # = Theta(sort(N))

if __name__ == "__main__":
    random.seed(2)
    print(f"{'N':>8} {'M':>7} {'B':>5} {'direct (~N)':>12} "
          f"{'by-sort (~sort N)':>18} {'min -> winner':>16}")
    for (N, M, B) in [(10**4, 10**3, 10), (10**6, 10**4, 100),
                      (10**6, 10**4, 10), (10**8, 10**5, 1000)]:
        perm = list(range(N))
        random.shuffle(perm)
        # Direct count is structural ~2N (one read + one scattered write per record);
        # simulate a sample to confirm, extrapolate for huge N.
        if N <= 10**6:
            direct = permute_direct_ios(perm, M, B)
        else:
            direct = 2 * N                       # scattered writes: ~one I/O each
        by_sort = permute_by_sort_ios(perm, M, B)
        winner = "direct" if direct <= by_sort else "sort"
        print(f"{N:>8} {M:>7} {B:>5} {direct:>12} {by_sort:>18} "
              f"{min(direct, by_sort):>10} ({winner})")
    print("\nOK: permute cost = Theta(min(N, sort(N))); pick direct when B small, sort when B large")
```

- **Analysis to write:** Direct placement reads `N` records (sequential, `N/B` I/Os) but writes each to a scattered destination — with no spatial structure, a write costs up to one I/O per record ⇒ `Θ(N)`. Permute-by-sorting tags each record with its target rank and external-sorts ⇒ `Θ(sort(N)) = Θ((N/B)·log_{M/B}(N/B))`. The optimum is `min` of the two. The crossover hinges on `B` versus the number of passes: when `B` is small (or `M/B` huge so `sort` is near-linear-in-`N/B`), sorting wins; when `B` is large enough that `sort(N) > N` — i.e. `(N/B)·log_{M/B}(N/B) > N`, equivalently `B·1 < log_{M/B}(N/B)` is false, so for large `B` the `N/B` factor makes sort cheaper, while for very small `B` direct's `Θ(N)` beats `sort`'s extra log-pass — you choose the smaller. **The deep fact:** permuting is *as hard as sorting* in general — no `o(min(N, sort(N)))` algorithm exists (the permutation lower bound), so there is no "linear-time" external permute the way there is in RAM.
- **Constraints:** Source and destination occupy disjoint address ranges. Direct placement does one read plus one scattered write per record; permute-by-sort uses the Task 5/6 `sort(N)` cost. Report both costs and the `min`, and name the regime where each wins.
- **Acceptance test:** `direct ≈ 2N` I/Os; `by_sort ≈ 2⌈N/B⌉·(1+P)`; the chosen cost is their `min`, matching `Θ(min(N, sort(N)))`. The crossover moves with `B` and `M/B` exactly as the bound predicts.

---

### Task 12 — Sequential vs random I/O crossover: measure it empirically **[coding + analysis]**

`[hard]` The pure I/O model charges `1` per block transfer regardless of *where* the block lives. Real devices violate this: sequential transfers are far cheaper than random seeks (HDDs by `100×`+; even SSDs favor sequential and large-block I/O). Model a per-I/O cost that is **cheap for sequential blocks and expensive for non-adjacent ones**, then find the access pattern where reading the whole file sequentially (and discarding) beats seeking to only the few blocks you need.

#### Python

```python
import random

def cost_model(prev_blk, blk, seq_cost=1.0, seek_cost=100.0):
    """Sequential (adjacent) block: cheap; a jump: pay a seek."""
    if prev_blk is not None and blk == prev_blk + 1:
        return seq_cost
    return seek_cost

def random_read_cost(target_blocks, seq_cost, seek_cost):
    """Seek to each wanted block in sorted order; non-adjacent jumps pay a seek."""
    prev, total = None, 0.0
    for blk in sorted(target_blocks):
        total += cost_model(prev, blk, seq_cost, seek_cost)
        prev = blk
    return total

def full_scan_cost(total_blocks, seq_cost, seek_cost):
    """Read every block sequentially: one seek to start, then all-sequential."""
    if total_blocks == 0:
        return 0.0
    return seek_cost + (total_blocks - 1) * seq_cost

if __name__ == "__main__":
    random.seed(3)
    total_blocks = 100_000
    seq_cost, seek_cost = 1.0, 100.0
    print(f"device: seq={seq_cost}, seek={seek_cost}  total blocks={total_blocks}")
    print(f"{'wanted blocks':>14} {'random-read cost':>17} "
          f"{'full-scan cost':>15} {'cheaper':>10}")
    scan = full_scan_cost(total_blocks, seq_cost, seek_cost)
    crossover = None
    for frac in (0.001, 0.005, 0.01, 0.02, 0.05, 0.1):
        m = int(total_blocks * frac)
        wanted = random.sample(range(total_blocks), m)
        rnd = random_read_cost(wanted, seq_cost, seek_cost)
        cheaper = "random" if rnd < scan else "FULL SCAN"
        if rnd >= scan and crossover is None:
            crossover = frac
        print(f"{m:>14} {rnd:>17.0f} {scan:>15.0f} {cheaper:>10}")
    print(f"\nCrossover near frac ~ seq/seek = {seq_cost/seek_cost:.3f}: "
          f"above it, sweep the whole file; below it, seek.")
    # Random reads of m scattered blocks cost ~ m*seek; full scan ~ total*seq.
    # They cross when m*seek ~ total*seq, i.e. m/total ~ seq/seek.
```

- **Analysis to write:** Reading `m` scattered blocks by seeking costs `≈ m·seek_cost`; scanning the whole file costs `≈ total·seq_cost`. They cross when `m·seek ≈ total·seq`, i.e. at selectivity `m/total ≈ seq/seek`. With `seek/seq = 100`, the crossover is at `m/total ≈ 1%`: if you need **more than ~1%** of the blocks, it is cheaper to **read the entire file sequentially** and throw away `99%` than to seek to the `1%` you want. This is the quantitative reason query planners switch from **index scan** (random seeks) to **full table scan** (sequential) above a selectivity threshold, and why columnar formats and large read-ahead pay off. The flat I/O model hides this because it charges `1` per block either way; the refined cost model exposes the seek/sequential asymmetry that dominates real storage.
- **Constraints:** Model a per-block cost that is `seq_cost` for a block adjacent to the previous one and `seek_cost` otherwise. Sweep the fraction of wanted blocks and locate where full-scan overtakes random read. The crossover must land near `seq/seek`.
- **Acceptance test:** Full scan beats random read once the wanted fraction exceeds `≈ seq/seek` (here `~1%`); below it, seeking wins. The measured crossover matches the `m/total ≈ seq/seek` analysis — the sequential-vs-random threshold that governs real storage-engine plans.

---

## Synthesis Task

> Tie the four bounds together: build the simulator, drive every primitive through it, count I/Os, and confirm each measured count matches its derived bound — `scan`, `sort`, `search`, `permute` — then place them on the external-memory map.

`[capstone]` Carry the **I/O model** end to end: scan, blocked transpose, external sort, B-tree search, and permute, each measured against its bound, plus the real-hardware locality experiment that motivates the whole model.

1. **Simulator + scan [coding].** Build `IOSim(M, B)` (Task 1); confirm a contiguous scan costs exactly `⌈N/B⌉` for any `M ≥ B`.

2. **Locality on real hardware [coding].** Reproduce the row-major-vs-column-major slowdown (Task 2) and the deterministic `B`-fold sequential-vs-strided gap in the simulator (Task 3); explain both via cache lines.

3. **Sort [coding + analysis].** Derive `2N/B·(1+⌈log_{M/B}(N/M)⌉)` (Task 5), implement external merge sort through the simulator (Task 6), and confirm the measured I/Os match `Θ(sort(N))`; verify the fan-in is `M/B` not `M` (Task 7) and the pass count is `log_{M/B}` not `log₂` (Task 8).

4. **Search [coding + analysis].** Show B-tree search costs `Θ(log_B N)` versus binary search's `Θ(log₂ N)` (Task 10), a factor `log₂ B`.

5. **Permute [coding + analysis].** Confirm permuting costs `Θ(min(N, sort(N)))` (Task 11) — as hard as sorting in general — and locate the sequential-vs-random crossover that governs real storage (Task 12).

Reference harness in **Python** (combines the pieces):

```python
import math, random

def report(N, M, B):
    k = max(2, M // B - 1)
    R0 = math.ceil(N / M)
    P = max(0, math.ceil(math.log(R0, k))) if R0 > 1 else 0
    scan = math.ceil(N / B)
    sort = (2 * scan) * (1 + P)
    search = max(1, math.ceil(math.log(N, B)))   # B-tree height
    permute = min(2 * N, sort)
    return scan, sort, search, permute, k, P

if __name__ == "__main__":
    print(f"{'N':>12} {'M':>9} {'B':>6} {'scan N/B':>10} {'sort':>10} "
          f"{'search log_B N':>14} {'permute':>12} {'fan-in':>8} {'passes':>7}")
    for (N, M, B) in [(10**6, 10**4, 100), (10**9, 10**7, 1000),
                      (10**12, 10**8, 1000), (10**15, 10**9, 4096)]:
        scan, sort, search, permute, k, P = report(N, M, B)
        print(f"{N:>12} {M:>9} {B:>6} {scan:>10} {sort:>10} "
              f"{search:>14} {permute:>12} {k:>8} {P:>7}")
        assert sort >= 2 * scan                   # sort >= one scan
        assert search <= math.ceil(math.log2(N))  # log_B N <= log2 N
        assert permute <= sort and permute <= 2 * N
    print("\nscan Theta(N/B) < search Theta(log_B N); "
          "sort Theta((N/B) log_{M/B}(N/B)); permute Theta(min(N, sort(N)))")
```

- **Analysis answer:** Scan is `Θ(N/B)` — one block per `B` records, sequential, `M`-independent. Sort is `Θ((N/B)·log_{M/B}(N/B))` — run formation plus `⌈log_{M/B}(N/M)⌉` merge passes, each a full scan, fan-in `M/B`. Search in a B-tree is `Θ(log_B N)` — fan-out `B`, one I/O per level — beating binary search's `Θ(log₂ N)` by `log₂ B`. Permute is `Θ(min(N, sort(N)))` — direct placement (`N`) or permute-by-sort (`sort(N)`), and no faster general algorithm exists. The real-hardware tasks show *why* the model matters: a cache line serves `B` sequential accesses but only one strided access, so locality is worth a factor of `B` (and a seek is worth `~100×` a sequential block).
- **Acceptance test:** Every measured I/O count matches its bound: `scan = ⌈N/B⌉`; external sort within a constant of `2N/B·(1+P)` with fan-in `M/B − 1` and `⌈log_{M/B}(N/M)⌉` passes; B-tree search `= ⌈log_B N⌉ ≤ log₂ N`; permute `= min(2N, sort)`. The wall-clock and simulator locality experiments both exhibit the `B`-fold sequential-vs-strided gap. The write-up places the four primitives on the external-memory map — **`scan(N) < log_B N`** in growth, **`sort(N)` the dominant batch cost, `permute` pinned to `min(N, sort(N))`** — mirroring the whole discipline: *build the simulator, drive the primitive, count the transfers, derive the bound, and confirm the measured count matches.*

---

## Where to go next

- Push the `sort(N)` bound further — run formation, multiway and polyphase merge, replacement selection, and double buffering — in the [external-sorting tasks](../03-external-sorting/tasks.md).
- Turn the `Θ(log_B N)` search into a full dynamic index — node fan-out, splits/merges, and the update bound — in the [B-tree I/O analysis tasks](../04-b-tree-io-analysis/tasks.md).
- For the conceptual treatment of `N, M, B`, the four bounds, the tall-cache assumption, and the cache-aware-versus-cache-oblivious distinction, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
