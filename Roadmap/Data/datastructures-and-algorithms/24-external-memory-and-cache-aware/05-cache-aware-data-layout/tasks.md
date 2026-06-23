# Cache-Aware Data Layout — Practice Tasks

> Coding tasks are solved in **one** language with the full reference solution; a short snippet in the other language is provided where it clarifies the port. The primary language here is **Go** — it gives clean, repeatable **wall-clock** measurements with no interpreter overhead between you and the cache, and `go test -bench` is the natural harness. **Python** appears for the analysis-friendly tasks and where **NumPy** lets you contrast a vectorized (SIMD-backed) layout against a scalar one. Where marked **[measure]**, the whole point is to **time two layouts of the same computation** and confirm the predicted-faster one *is* measurably faster — these effects live entirely in the **constant factor**, so measuring is not optional, it is the lesson.
> **[analysis]** tasks need no code: compute a layout's waste, derive a working-set size, or explain a coherence event from first principles — model answers are provided so you can grade yourself.

Cache-aware data layout is the discipline of arranging data in memory so that the hardware's **cache hierarchy** works *for* you instead of against you. Every modern CPU moves memory in **cache lines** (typically 64 bytes), not individual words; it speculatively **prefetches** sequential lines; and it keeps per-core caches **coherent** at cache-line granularity. None of this changes the asymptotic complexity of an algorithm — it changes the constant factor, often by `5–50×`. The layout decisions that matter:

- **Spatial locality / cache lines.** A line of `B` bytes is fetched as a unit. Touch one byte, pay for the whole line. Lay data out so the bytes you touch together *travel* together.
- **AoS vs SoA.** *Array of Structs* keeps each record's fields adjacent; *Struct of Arrays* keeps each field's values adjacent across records. Scanning one field of millions of records is a streaming win for SoA — no wasted line bytes.
- **Tiling / blocking.** Restructure nested loops so the working set of the inner loops fits in L1/L2, turning capacity misses into hits.
- **False sharing.** Two cores writing *different* variables that share one cache line ping-pong the line between caches via the coherence protocol — invisible in the source, catastrophic in throughput. **Padding** to separate lines fixes it.
- **Prefetching.** Sequential, predictable strides let the hardware prefetcher hide latency; pointer-chasing defeats it.
- **Implicit / Eytzinger layouts.** Store a tree in BFS order in a flat array so a search is branch-free and prefetch-friendly, beating a textbook sorted-array binary search.
- **Columnar / SIMD.** A column store places one attribute contiguously, so a filter-and-aggregate streams one column and vectorizes cleanly.

| Technique | What it fixes | Mechanism |
| --- | --- | --- |
| **SoA over AoS** | wasted line bytes on a one-field scan | only the touched field travels in lines |
| **Loop tiling** | capacity misses in nested loops | working set sized to L1/L2 |
| **Padding** | false sharing across cores | each hot counter on its own line |
| **Eytzinger layout** | strided, branchy binary search | branch-free, prefetchable, line-dense |
| **Morton/Z-order** | poor 2-D locality of row-major | nearby cells nearby in memory |
| **Columnar + SIMD** | per-row overhead in a scan | one attribute streamed, vectorized |

The recurring discipline: **predict which layout the cache hierarchy should prefer, measure both, and confirm the prediction — then explain the gap in terms of cache lines, coherence traffic, or the prefetcher.** A speedup you cannot explain via the hierarchy is a coincidence you cannot reproduce; an explanation you never measured is a story. Tie the two together on every task: *the predicted-faster layout is measurably faster, and you can say which hardware mechanism produced the gap.*

**Related practice:**
- [The I/O Model tasks](../01-the-io-model/tasks.md) — the `(M, B)` external-memory model and the block-cache `IOSim`; the same `scan` vs `stride` and tiling logic, one level down the hierarchy (RAM↔disk instead of cache↔RAM).
- [Cache-Oblivious Algorithms tasks](../02-cache-oblivious-algorithms/tasks.md) — recursive transpose/multiply/search that hit the optimal bound at *every* cache level without reading `B` or `M`; the parameter-free counterpart to the cache-*aware* tiling you tune by hand here.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the quantities and method used throughout:
- **Cache line `B`.** The unit of transfer between memory levels, almost always **64 bytes** on x86-64 and ARM64. `B/sizeof(elem)` consecutive elements share a line; sequential access amortizes one miss over that many uses.
- **Working set vs cache capacity.** Effects only appear once the data exceeds the level you are studying. To see an L1 effect, exceed L1 (`~32 KB`); to see an L2/L3 effect, exceed that. A measurement on data that fits in L1 shows nothing — *make the array big*.
- **How to measure honestly.** Warm up once (allocate + touch every page) before timing; repeat and take the **median**; **consume the result** (sum it, store it) so the compiler cannot eliminate the loop; and pin the data size, the arithmetic, and the element count across both layouts so *only the layout* differs. In Go, prefer `testing.B`; outside it, take a median of several `time.Now()` deltas and print `ns/op`.
- **The number to report.** Always print the **ratio** (slowdown/speedup) alongside both absolute timings, then state the mechanism: cache lines (spatial locality), coherence (false sharing), or the prefetcher (stride predictability).

---

## Beginner Tasks

### Task 1 — Array vs linked-list traversal at equal `N`: measure the gap, explain via cache lines **[measure + analysis]**

`[easy]` Sum `N` integers stored two ways: a contiguous **slice** (`[]int`) and a **linked list** of heap-allocated nodes. Same `N`, same additions, same total. For large `N` the array is several times faster — purely because the array streams whole cache lines the prefetcher can see coming, while the list *pointer-chases* to scattered addresses, paying a near-full-line miss per node with no prefetch.

#### Go

```go
package layout

import "testing"

type node struct {
	val  int
	next *node
}

func buildList(n int) *node {
	var head *node
	for i := n - 1; i >= 0; i-- {
		head = &node{val: i, next: head} // separate heap allocs -> scattered addresses
	}
	return head
}

func buildSlice(n int) []int {
	a := make([]int, n)
	for i := range a {
		a[i] = i
	}
	return a
}

var sink int // consume results so nothing is optimized away

func BenchmarkSliceSum(b *testing.B) {
	a := buildSlice(1 << 22) // 4M ints = 32 MB, well past L2
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s := 0
		for _, v := range a {
			s += v
		}
		sink = s
	}
}

func BenchmarkListSum(b *testing.B) {
	head := buildList(1 << 22)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s := 0
		for p := head; p != nil; p = p.next {
			s += p.val
		}
		sink = s
	}
}
```

Run with `go test -bench 'Sum' -benchmem`. To make the list's penalty even starker, shuffle the node order before linking so successive nodes are far apart in memory.

#### Python (quick port)

```python
import time

def sum_list_vs_array(n):
    arr = list(range(n))                 # CPython list: array of pointers, but contiguous
    # linked list via tuples (val, next)
    head = None
    for i in range(n - 1, -1, -1):
        head = (i, head)
    t0 = time.perf_counter(); s1 = sum(arr); t_arr = time.perf_counter() - t0
    t0 = time.perf_counter()
    s2, p = 0, head
    while p is not None:
        s2 += p[0]; p = p[1]
    t_list = time.perf_counter() - t0
    assert s1 == s2
    return t_arr, t_list
```

- **Analysis to write:** A `[]int` is one contiguous block; `8` ints share a 64-byte line, so one miss serves `8` additions, and the stride-1 pattern triggers the hardware prefetcher to load the *next* line before you ask. The linked list stores each node at an unrelated heap address; following `next` is a data-dependent load the prefetcher cannot anticipate, so each node typically costs a full cache miss (and on a shuffled list, often a TLB miss too). The arithmetic is identical — the array wins on **spatial locality + prefetch**, the two mechanisms the list defeats.
- **Constraints:** Same `N` for both; `N` large enough that the data exceeds L2 (use `≥ 2^22` ints). Consume the sums. Report the ratio.
- **Acceptance test:** The slice sum is measurably faster than the list sum, and the gap **widens** as `N` grows past each cache level. You can explain it as: contiguous lines + prefetch (array) versus unpredictable pointer-chasing misses (list).

---

### Task 2 — Row-major vs column-major matrix sum: measure and explain **[measure + analysis]**

`[easy]` Allocate an `n × n` matrix as a flat row-major slice (`A[i*n+j]`) and sum it two ways: **row-major traversal** (`i` outer, `j` inner) walks memory sequentially; **column-major traversal** (`j` outer, `i` inner) jumps a full row (`n` elements) per step. Same `n²` elements, same arithmetic. For large `n` the column-major sum is several times slower.

#### Go

```go
func sumRowMajor(a []float64, n int) float64 {
	s := 0.0
	for i := 0; i < n; i++ {
		base := i * n
		for j := 0; j < n; j++ {
			s += a[base+j] // consecutive addresses -> sequential, prefetched
		}
	}
	return s
}

func sumColMajor(a []float64, n int) float64 {
	s := 0.0
	for j := 0; j < n; j++ {
		for i := 0; i < n; i++ {
			s += a[i*n+j] // stride n -> a fresh cache line nearly every step
		}
	}
	return s
}
```

Drive both from a `testing.B` over `n = 2048` (a 32 MB matrix) and assert the sums match before comparing times.

- **Analysis to write:** A 64-byte line holds `8` `float64`s. Row-major reads `A[i*n+j]` for consecutive `j`, so one line fetch serves `8` adds → `n²/8` line transfers, fully prefetched. Column-major reads addresses `n` apart, so each access lands on a different line; until lines start evicting, almost every access is a fresh miss → up to `8×` the line traffic, and the irregular-from-the-line's-view stride gives the prefetcher nothing to chase down the column. Only the traversal order differs; the slowdown is spatial locality, valued at a factor near `B/sizeof(elem) = 8`.
- **Constraints:** Same buffer, same sum; `n` large enough that one row exceeds a line and the matrix exceeds L2. Report the slowdown ratio.
- **Acceptance test:** Column-major is measurably slower, the gap widens with `n`, and the explanation attributes it to one line serving `8` sequential accesses but only `1` strided one. (This is the cache-level twin of the disk-level [I/O-model row/column task](../01-the-io-model/tasks.md).)

---

### Task 3 — AoS vs SoA: sum one field of millions of records, report the speedup **[measure + analysis]**

`[easy]` You have `N` records, each with several fields, but a hot path that sums **one** field. Lay the data out **AoS** (one slice of multi-field structs) and **SoA** (one slice per field). Sum the hot field both ways. SoA is several times faster: the AoS scan drags every record's *other* fields through cache lines it never uses, while the SoA scan touches only the field it needs — every byte of every line is useful.

#### Go

```go
type ParticleAoS struct {
	X, Y, Z    float64 // position (hot: we only sum X)
	VX, VY, VZ float64 // velocity (cold for this scan)
	Mass       float64
	ID         int64
} // 64 bytes -> exactly one cache line per record

type ParticlesSoA struct {
	X          []float64
	Y, Z       []float64
	VX, VY, VZ []float64
	Mass       []float64
	ID         []int64
}

func sumXAoS(p []ParticleAoS) float64 {
	s := 0.0
	for i := range p {
		s += p[i].X // pulls the whole 64-byte record into cache; uses 8 of 64 bytes
	}
	return s
}

func sumXSoA(x []float64) float64 {
	s := 0.0
	for _, v := range x {
		s += v // contiguous X values; every line byte is useful
	}
	return s
}
```

Benchmark over `N = 10_000_000`. For AoS the line utilization is `8/64 = 12.5%`; for SoA it is `100%`, predicting roughly an `8×` reduction in line traffic.

- **Analysis to write:** Each AoS record here is 64 bytes — exactly one line. Summing `X` touches `8` useful bytes and wastes the other `56`, so the scan moves `N` full lines to read `N×8` useful bytes. SoA stores all `X` values contiguously; `8` of them share a line, so the scan moves `N/8` lines — an `8×` reduction in memory traffic (and the prefetcher loves the dense stream). The win equals the inverse of AoS's line utilization for the hot field. Caveat: if the hot path used *all* fields of each record together (e.g. a physics step touching X,Y,Z,VX,…), AoS would be competitive — SoA wins specifically when you scan **few fields across many records**.
- **Constraints:** `N ≥ 10⁷` so the data dwarfs L2. Same values, same sum. Report the ratio and the predicted `8×` from line utilization.
- **Acceptance test:** SoA's one-field sum is measurably faster than AoS's, by a factor approaching `sizeof(record)/sizeof(field)`, and you can state it as line-utilization: SoA wastes no line bytes on a single-field scan.

---

### Task 4 — Compute AoS waste `(d − f)/d` for given field layouts **[analysis]**

`[easy]` Quantify *before* you measure. For a scan that reads `f` bytes of useful field data per record out of a record of size `d` bytes (the relevant working unit per cache line, when records pack into lines), the fraction of fetched bytes **wasted** by an AoS scan is `(d − f)/d`, and the SoA speedup ceiling is `d/f`. Compute these for several layouts and order them by how badly they want SoA.

> **No code.** Use this as the grading model.

**Model answer.** Let `d` = bytes of a record that ride into cache when you touch it, and `f` = bytes you actually use on the hot scan. An AoS scan fetches `d` bytes per useful `f`, so:

```
wasted fraction = (d − f) / d        useful fraction = f / d        SoA ceiling = d / f
```

| Record | `d` (bytes) | hot field `f` | wasted `(d−f)/d` | SoA ceiling `d/f` |
| --- | --- | --- | --- | --- |
| `Particle{X,Y,Z,VX,VY,VZ,Mass,ID}` | 64 | sum `X` (8) | `56/64 = 87.5%` | `8×` |
| `{key int64, payload [56]byte}` | 64 | scan `key` (8) | `87.5%` | `8×` |
| `{a,b int32}` | 8 | sum `a` (4) | `50%` | `2×` |
| `{x,y,z float64}` (read all 3) | 24 | use all (24) | `0%` | `1×` (AoS fine) |
| `{flag bool, big [120]byte}` | 128 (2 lines) | scan `flag` (1) | `99.2%` | up to `128×` |

*Reading.* The bigger the record and the smaller the hot field, the more lopsided the win — a 1-byte flag in a 128-byte record wastes `99.2%` of fetched bytes, so SoA (or just splitting the flag into its own array) can be two orders of magnitude faster on that scan. Conversely, when the hot path uses the *whole* record (the `{x,y,z}` row, all three read together), `f = d`, waste is `0`, and AoS is already optimal — SoA would only add indexing overhead. The metric tells you *whether* to bother before you spend a benchmark.

- **Constraints:** For each layout state `d`, `f`, the wasted fraction `(d−f)/d`, and the SoA ceiling `d/f`. Note the boundary case `f = d` where AoS is already optimal.
- **Acceptance test:** Each row's waste and ceiling are computed correctly; the layouts are ordered by SoA benefit; you correctly flag the all-fields-used case as *not* wanting SoA. The measured Task 3 speedup should not exceed the `d/f` ceiling.

---

## Intermediate Tasks

### Task 5 — Naive vs tiled matrix multiply: tune the tile to L1/L2, find the sweet spot **[measure + analysis]**

`[medium]` Multiply `C = A·B` for `n × n` `float64` matrices with the textbook `ijk` triple loop, then with a **tiled** (`blocked`) version that processes `t × t` tiles small enough that the active tiles of `A`, `B`, and `C` co-reside in L1/L2. Sweep the tile size `t`, measure wall-clock, and find the sweet spot. The tiled version is several times faster for large `n`; relate the win to the external-memory bound `Θ(n³/(B√M))` one level down (here `M` ≈ a cache level's capacity, `B` ≈ the line).

#### Go

```go
func matmulNaive(a, b, c []float64, n int) {
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			s := 0.0
			for k := 0; k < n; k++ {
				s += a[i*n+k] * b[k*n+j] // b strides by n -> a fresh line each k
			}
			c[i*n+j] = s
		}
	}
}

func matmulTiled(a, b, c []float64, n, t int) {
	for ii := 0; ii < n; ii += t {
		for kk := 0; kk < n; kk += t {
			for jj := 0; jj < n; jj += t {
				iMax := min(ii+t, n)
				kMax := min(kk+t, n)
				jMax := min(jj+t, n)
				for i := ii; i < iMax; i++ {
					for k := kk; k < kMax; k++ {
						aik := a[i*n+k] // hoist; reused across the j-tile
						for j := jj; j < jMax; j++ {
							c[i*n+j] += aik * b[k*n+j] // both c-row and b-row stream sequentially
						}
					}
				}
			}
		}
	}
}
```

Note the `ikj` order inside the tile: it makes both `c[i*n+j]` and `b[k*n+j]` sweep sequential rows (line-friendly), whereas naive `ijk` strides `b` by `n`. Sweep `t ∈ {8, 16, 32, 48, 64, 96, 128}` for `n = 1024` and print `ns/op` per `t`.

- **Analysis to write:** Naive `ijk` reuses nothing across `b`'s strided column: each inner step faults a fresh line, so the scan moves `Θ(n³)` lines from the cache's view → `Θ(n³/B)` transfers at that level. Tiling makes a `t × t` block of each matrix resident; each loaded tile element does `Θ(t)` useful multiplies before eviction, so transfers drop to `Θ(n³/(t·B))`. The optimum tile is the largest with three tiles resident: `3t² · 8 ≤ M_level`, i.e. `t ≈ √(M_level/24)` — a few tens of elements for L1 (`~32 KB`), larger for L2. That is exactly the external-memory `Θ(n³/(B√M))` bound applied one level up the hierarchy. Too small a `t` under-amortizes the line; too large a `t` spills the tile and reverts to capacity misses — hence a clear **sweet spot**, typically `t ≈ 32–64` for `float64` on L1/L2.
- **Constraints:** Verify `C` matches the naive result before comparing times. Sweep `t` and report `ns/op` for each; identify the minimum. Use `n ≥ 1024` so the full matrices exceed L2.
- **Acceptance test:** The best tiled `t` is measurably faster than naive, the `ns/op`-vs-`t` curve dips then rises (a sweet spot near `√(cache/24)` elements), and you can map the win to `Θ(n³/(B√M))` — the cache-*aware* analogue of the recursive multiply in the [cache-oblivious tasks](../02-cache-oblivious-algorithms/tasks.md), which reaches the same bound with no `t` to tune.

---

### Task 6 — False sharing: padded vs unpadded per-thread counters, measure the scaling collapse **[measure + analysis]**

`[medium]` Spawn `P` goroutines, each hammering its *own* counter. Lay the counters two ways: a tight `[]int64` (adjacent counters share a 64-byte line) versus an array of cache-line-**padded** structs (each counter on its own line). The unpadded version barely scales — sometimes runs *slower* with more cores — because the cores' writes to *different* counters that share a line force the coherence protocol to bounce that line between caches on every increment. Padding eliminates the sharing and restores linear scaling.

#### Go

```go
import (
	"sync"
	"testing"
)

const iters = 50_000_000

// Unpadded: P counters packed in one slice; 8 of them share a 64-byte line.
func runUnpadded(p int) {
	counts := make([]int64, p)
	var wg sync.WaitGroup
	for t := 0; t < p; t++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				counts[id]++ // false sharing: line ping-pongs between cores
			}
		}(t)
	}
	wg.Wait()
}

// Padded: each counter sits alone on its own 64-byte cache line.
type paddedCounter struct {
	v   int64
	_   [56]byte // pad to 64 bytes so no two counters share a line
}

func runPadded(p int) {
	counts := make([]paddedCounter, p)
	var wg sync.WaitGroup
	for t := 0; t < p; t++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				counts[id].v++ // each core owns its line: no coherence traffic
			}
		}(t)
	}
	wg.Wait()
}

func BenchmarkUnpadded(b *testing.B) {
	for i := 0; i < b.N; i++ {
		runUnpadded(8)
	}
}
func BenchmarkPadded(b *testing.B) {
	for i := 0; i < b.N; i++ {
		runPadded(8)
	}
}
```

Run on a multi-core machine with `GOMAXPROCS ≥ P`. Try `P ∈ {1, 2, 4, 8}` and watch how the unpadded version fails to speed up (or regresses) as `P` rises, while the padded version scales near-linearly.

#### Go (idiomatic padding)

```go
// Go 1.19+: use the standard cache-line guard so intent is explicit.
import "golang.org/x/sys/cpu"

type guardedCounter struct {
	_ cpu.CacheLinePad
	v int64
	_ cpu.CacheLinePad
}
```

- **Analysis to write:** Each core has a private L1/L2 cache; the MESI/MOESI coherence protocol keeps lines consistent at **line granularity**, not variable granularity. When core 0 writes `counts[0]` and core 1 writes `counts[1]` and both live in one line, each write invalidates the *other* core's copy of the whole line — so every increment triggers a cross-core invalidate + refetch, serializing what looks like independent work. This is **false** sharing: the variables are logically disjoint, the *line* is shared. Padding each counter to its own line removes the conflict; the cores never invalidate each other and throughput scales with `P`. The fix is invisible in the algorithm — it lives entirely in the byte layout.
- **Constraints:** Each goroutine writes only its own counter (no real contention). The only difference is the padding. Measure across `P = 1…8`; report throughput (or time) per `P` for both layouts and the scaling curve.
- **Acceptance test:** Unpadded throughput stays roughly flat or regresses as `P` grows; padded throughput scales near-linearly; the two diverge sharply by `P = 4–8`. You can explain the collapse as coherence-protocol line-bouncing and the fix as one-counter-per-line padding.

---

### Task 7 — Hot/cold field splitting: split a struct, measure the hot-scan improvement **[measure + analysis]**

`[medium]` A common record mixes a small **hot** field scanned constantly with a large **cold** payload touched rarely. Packed AoS, the cold payload dilutes every line of the hot scan. **Field splitting** moves the cold payload to a parallel array (keyed by index), shrinking the hot record so more hot fields fit per line. Build a "monolithic" record and a "split" version, scan the hot field, and measure the improvement.

#### Go

```go
type Monolithic struct {
	Key     int64     // hot: scanned every query
	Payload [120]byte // cold: fetched only on a match
} // 128 bytes -> 2 cache lines per record; a Key scan wastes ~99% of fetched bytes

// Split: hot keys packed tightly; cold payloads parked in a parallel array.
type Split struct {
	Keys     []int64    // hot: 8 keys per 64-byte line
	Payloads [][120]byte // cold: touched only on the rare match
}

func scanKeysMono(recs []Monolithic, target int64) int {
	for i := range recs {
		if recs[i].Key == target { // each compare drags 128 cold bytes through cache
			return i
		}
	}
	return -1
}

func scanKeysSplit(s *Split, target int64) int {
	for i, k := range s.Keys {
		if k == target { // dense key stream: 8 keys per line, payload never fetched
			return i
		}
	}
	return -1
}
```

Benchmark a *failing* (full) scan over `N = 5_000_000` records so the whole array is traversed. The split key array is `~16×` smaller in bytes than the monolithic array's key-bearing lines, predicting a large hot-scan speedup.

- **Analysis to write:** In the monolithic layout, each `Key` comparison fetches the record's whole 128-byte (2-line) footprint; the hot scan moves `2N` lines to read `N` keys, with line utilization `8/128 ≈ 6%`. Splitting parks the 120-byte payload elsewhere and packs keys `8` per line; the hot scan now moves `N/8` lines at `100%` utilization — a `~16×` reduction in lines fetched. The cold payload is only pulled in on the rare match (one record), so the split pays nothing for it on the common path. This is the AoS-waste metric (Task 4) turned into a refactor: shrink the hot record by evicting cold fields, and the scan's line traffic drops by the utilization ratio.
- **Constraints:** Identical keys and lookups in both layouts; the cold payload must be present (real bytes), just relocated. Force a full scan (search for an absent key) so the whole structure is traversed. Report the ratio.
- **Acceptance test:** The split hot-scan is measurably faster, by a factor approaching the line-utilization improvement (`record_size / hot_field_packing`). You can explain it as: a smaller hot record packs more hot fields per line and never drags the cold payload into the hot path.

---

## Advanced Tasks

### Task 8 — Eytzinger (BFS/implicit) layout for binary search vs sorted-array search **[measure + analysis]**

`[hard]` A textbook binary search over a **sorted array** probes addresses that halve the window each step — scattered, unpredictable jumps that defeat the prefetcher and branch on every step. The **Eytzinger layout** stores the same keys in **BFS / level order** in a flat array (`node k → children 2k, 2k+1`, 1-indexed), so the search walks `k = 1, 2k(+b), …` — the next two candidate children are *adjacent in memory*, the access pattern is **prefetchable**, and the descent can be made **branch-free** (compute the child index from a comparison without a mispredicting branch). Build both, search a large key set, and measure.

#### Go

```go
// Build the Eytzinger array from a sorted slice via an in-order fill.
func buildEytzinger(sorted []int64) []int64 {
	n := len(sorted)
	e := make([]int64, n+1) // 1-indexed; e[0] is a sentinel
	idx := 0
	var fill func(k int)
	fill = func(k int) {
		if k <= n {
			fill(2 * k)           // left subtree
			e[k] = sorted[idx]    // visit in-order -> sorted keys land in BFS slots
			idx++
			fill(2*k + 1)         // right subtree
		}
	}
	fill(1)
	return e
}

// Branch-free Eytzinger search with software prefetch of the next level.
func searchEytzinger(e []int64, n int, x int64) bool {
	k := 1
	for k <= n {
		// prefetch both possible grandchildren lines (hint; see note below)
		b := 0
		if e[k] < x {
			b = 1
		}
		k = 2*k + b // branchless: descend left (b=0) or right (b=1)
	}
	// On exit, recover the last node where we went left -> the candidate.
	k >>= ffsTrailingOnes(k) // shift out trailing 1s recorded by the descent
	return k != 0 && e[k] == x
}

func searchSorted(a []int64, x int64) bool {
	lo, hi := 0, len(a)
	for lo < hi {
		mid := int(uint(lo+hi) >> 1)
		if a[mid] < x {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo < len(a) && a[lo] == x
}
```

`ffsTrailingOnes(k)` returns the number of trailing `1` bits (`bits.TrailingZeros(^uint(k))`), which undoes the left/right history encoded in `k` to find the predecessor candidate. Benchmark both over a sorted set of `N = 4_000_000` int64 keys against a batch of random lookups; compare `ns/op`.

#### Go (software prefetch hint)

```go
// Go has no intrinsic prefetch; in C/C++ you would write, at the top of the loop:
//   __builtin_prefetch(&e[k*2*PREFETCH_DEPTH]);
// to pull a future level's line in early. The Eytzinger layout makes that future
// address computable from k alone — the whole reason the layout prefetches well.
```

- **Analysis to write:** Sorted-array binary search probes `a[n/2], a[n/4 or 3n/4], …` — each on a different, far-apart line, and the *next* address depends on the comparison result, so the prefetcher cannot run ahead and the branch is ~50% mispredicted near the top. Eytzinger stores keys so that level `L` of the implicit tree occupies a contiguous run; the search visits `k, 2k(+b), 4k(+…)`, and crucially the two children `2k` and `2k+1` are adjacent — once a level is small enough to sit within a few lines, the descent stops missing, and you can **prefetch** the line for a level two or three deep because its index is `k·2^depth`, computable now. Making the descent **branch-free** (index arithmetic instead of an `if`) removes the misprediction stall. Net: fewer effective cache misses (line-dense, prefetched) and no branch penalty, for a measurable speedup over the canonical binary search on the same keys.
- **Constraints:** Both structures hold the *same* keys; verify the two searches agree on every query. The Eytzinger search must be **branch-free** in its descent (no data-dependent `if` choosing the child). `N` large enough to exceed L2. Report `ns/op` over a batch of random and present/absent lookups.
- **Acceptance test:** Eytzinger search is measurably faster (commonly `1.5–3×`) than sorted-array binary search on the same keys, and you can explain it via line density + prefetchable addresses + branch-free descent. (Compare the *implicit* vEB layout in the [cache-oblivious tasks](../02-cache-oblivious-algorithms/tasks.md), which optimizes the *block-transfer* count `Θ(log_B N)` at every level rather than the constant factor at one.)

---

### Task 9 — Z-order (Morton) layout: measure 2-D tiled-traversal locality vs row-major **[measure + analysis]**

`[hard]` Row-major storage gives good locality only along rows; a 2-D access pattern that moves in **both** dimensions (a tiled traversal, a stencil, a quadtree query) jumps a full row every time it steps in `y`. The **Morton / Z-order** layout interleaves the bits of `(x, y)` into a single index, so cells that are near in 2-D space are near in memory along a space-filling Z-curve — a `t × t` neighborhood occupies a near-contiguous run. Store an `n × n` grid both ways, run a **block/tiled traversal** (visit every cell, tile by tile), and measure the locality difference.

#### Go

```go
// Interleave the low 16 bits of x and y into a 32-bit Morton code.
func morton(x, y uint32) uint32 {
	return part1by1(x) | (part1by1(y) << 1)
}

func part1by1(v uint32) uint32 {
	v &= 0x0000ffff
	v = (v | (v << 8)) & 0x00ff00ff
	v = (v | (v << 4)) & 0x0f0f0f0f
	v = (v | (v << 2)) & 0x33333333
	v = (v | (v << 1)) & 0x55555555
	return v
}

// Tiled traversal: visit cells tile-by-tile (the access pattern that hammers
// row-major locality but suits Z-order).
func tiledSumRowMajor(grid []float64, n, t int) float64 {
	s := 0.0
	for ty := 0; ty < n; ty += t {
		for tx := 0; tx < n; tx += t {
			for y := ty; y < ty+t; y++ {
				for x := tx; x < tx+t; x++ {
					s += grid[y*n+x] // within a tile, each new y jumps a full row
				}
			}
		}
	}
	return s
}

func tiledSumMorton(grid []float64, n, t int) float64 {
	s := 0.0
	for ty := 0; ty < n; ty += t {
		for tx := 0; tx < n; tx += t {
			for y := ty; y < ty+t; y++ {
				for x := tx; x < tx+t; x++ {
					s += grid[morton(uint32(x), uint32(y))] // tile cells cluster on the Z-curve
				}
			}
		}
	}
	return s
}
```

Build both grids (the Morton grid filled by `gridM[morton(x,y)] = value(x,y)`), then run the *same* tiled traversal over each with `t = 16` on `n = 4096`. Verify the sums match, then compare times. (Compute the Morton code by table lookup if the bit-twiddling dominates, to isolate the memory effect.)

- **Analysis to write:** In row-major, a `t × t` tile spans `t` separate row-segments `n` elements apart; stepping `y` within the tile costs a fresh line (and the tile's `t` rows can't all stay resident for large `n`), so the tiled traversal pays poor locality in `y`. In Morton order, the bit-interleaving maps a `2^k × 2^k` aligned block to a *contiguous* index range, so a tile is a near-linear sweep of memory — one line serves several neighboring cells in both `x` and `y`, and the prefetcher follows the Z-curve. The traversal touches the same cells in the same logical order; only the storage layout changes the line traffic. Caveat: Morton helps the *2-D-local* access pattern; a pure row sweep is actually slightly *worse* in Morton (the code computation and the curve's row discontinuities cost), so the layout is a trade you make when access is genuinely 2-D.
- **Constraints:** Same cell values, same traversal order, verified equal sums. The traversal must move in both dimensions (tiled or stencil), not a pure row scan. Isolate the memory effect from the `morton()` arithmetic (precompute or table-lookup if needed). Report the ratio at a tile size where row-major's `y`-jumps bite (`t` such that `t` rows exceed L1).
- **Acceptance test:** For the 2-D tiled traversal, Morton is measurably faster than row-major (or you can demonstrate it becomes faster as `n`/`t` grow the per-tile working set past L1), and you can explain it as Z-order clustering a 2-D tile into a contiguous, prefetchable run.

---

### Task 10 — Columnar vs row-store micro-benchmark: filter + aggregate one column (the SIMD win) **[measure + analysis]**

`[hard]` Analytic queries scan *few columns over many rows*. A **row store** keeps each row's columns adjacent (AoS at table scale); a **column store** keeps each column contiguous (SoA at table scale). Run the canonical OLAP kernel — `SELECT SUM(value) WHERE category = c` — over both layouts and measure. The column store wins twice: it streams only the two touched columns (no wasted line bytes on the dozen unread columns), and a contiguous column **vectorizes** — the compiler/SIMD units process `4–8` values per instruction.

#### Go (row store vs column store)

```go
type Row struct {
	ID       int64
	Category int32
	Value    float64
	// imagine a dozen more unread columns padding the row to, say, 128 bytes
	_ [108]byte
}

func sumRowStore(rows []Row, cat int32) float64 {
	s := 0.0
	for i := range rows {
		if rows[i].Category == cat { // drags 128 bytes/row through cache for 12 useful
			s += rows[i].Value
		}
	}
	return s
}

type ColumnStore struct {
	Category []int32   // contiguous: filter column streams, vectorizes
	Value    []float64 // contiguous: aggregate column streams, vectorizes
	// other columns live in their own slices, never touched by this query
}

func sumColumnStore(cs *ColumnStore, cat int32) float64 {
	s := 0.0
	cat32 := cat
	for i, c := range cs.Category {
		if c == cat32 {
			s += cs.Value[i]
		}
	}
	return s
}
```

#### Python / NumPy (the vectorized contrast made explicit)

```python
import numpy as np

def column_store_sum(category, value, c):
    # Fully vectorized: the filter is a SIMD compare, the sum a SIMD reduction.
    return value[category == c].sum()       # streams two contiguous arrays, no Python loop

def row_store_sum(rows, c):
    # Row store as an array of records: strided field access, per-row Python overhead.
    return sum(r.value for r in rows if r.category == c)
```

Benchmark over `N = 20_000_000` rows with, say, `10%` matching the filter. In Go compare `sumRowStore` vs `sumColumnStore`; in Python contrast the NumPy column kernel (vectorized) against a row-by-row loop to expose the SIMD/streaming gap dramatically.

- **Analysis to write:** The row store fetches each row's full footprint (128 bytes here) to read two fields (`Category`, `Value`), so its scan moves `N` wide lines at `~12%` utilization. The column store streams only `Category` (4 B each, `16` per line) and `Value` (8 B each, `8` per line) — `100%` line utilization on both, roughly an order-of-magnitude less memory traffic. On top of that, the contiguous `int32` filter column **auto-vectorizes**: a SIMD compare evaluates `8–16` predicates per instruction and a SIMD reduction sums many values per instruction, which a strided/row layout cannot do because the values aren't adjacent. The NumPy version makes this explicit — `category == c` and `.sum()` run as wide SIMD kernels over contiguous arrays, beating the Python row loop by `100×+`. This is why every analytic engine (column stores, Arrow, vectorized executors) lays facts out columnar.
- **Constraints:** Same rows, same filter predicate, same aggregate, verified-equal results. The row record must carry the unread columns (real bytes) so the row store pays the realistic line waste. Report the ratio; in NumPy, contrast vectorized vs scalar to surface the SIMD component.
- **Acceptance test:** The columnar filter+aggregate is measurably faster than the row store (commonly `5–20×`, more in NumPy vs a Python loop), and you can decompose the win into (a) line utilization / reduced traffic and (b) SIMD vectorization of the contiguous column.

---

### Task 11 — NUMA first-touch: measure (or analyze) the locality penalty of remote memory **[measure + analysis]**

`[hard]` On a multi-socket (NUMA) machine, physical pages are mapped to the memory of the node whose CPU **first touches** them (the *first-touch* policy), and accessing memory on a *remote* node costs noticeably more than local. The classic bug: one thread allocates and initializes a big array (so all pages land on *its* node), then a pool of threads on *other* nodes processes it — every access is remote. The fix is **first-touch by the worker**: have each thread initialize the slice it will later process, so its pages are local. Measure the difference (or, if you lack a NUMA box, analyze it precisely).

#### Go (measurement sketch — needs a real NUMA machine and CPU pinning)

```go
// Measurement requires NUMA hardware and thread/CPU pinning (Linux numactl,
// or runtime.LockOSThread + sched_setaffinity via x/sys/unix). Sketch:
//
//   BAD  (remote): main goroutine touches every page of `data` first
//                  -> all pages on node 0; workers pinned to node 1 read remotely.
//   GOOD (local) : each worker first-touches (initializes) its OWN chunk
//                  -> its pages map to its node; later reads are local.
//
// Run both under `numactl --cpunodebind=1 --membind=0` (force remote) vs the
// first-touch-local variant, and compare ns/op of the processing pass.

func firstTouchLocal(data []float64, p int) {
	chunk := len(data) / p
	var wg sync.WaitGroup
	for t := 0; t < p; t++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			runtime.LockOSThread()          // pin so the touch maps pages to THIS core's node
			lo, hi := id*chunk, (id+1)*chunk
			for i := lo; i < hi; i++ {
				data[i] = 0 // FIRST touch -> page binds to this worker's NUMA node
			}
		}(t)
	}
	wg.Wait()
}
```

**If you have no NUMA hardware — the analysis (model answer).** Let local access latency be `Lₗ` and remote `Lᵣ`, with a typical **NUMA factor** `Lᵣ/Lₗ ≈ 1.5–2.2×` for latency (and remote bandwidth often `~1/2` of local) on a 2-socket server. A memory-bound pass over `data` that is `100%` remote runs at roughly the remote-bandwidth ceiling; the same pass with first-touch-local runs at the local ceiling. So the expected slowdown of the "allocate-on-one-node, process-on-another" anti-pattern is the bandwidth NUMA factor, commonly `1.4–2×` on a memory-bound kernel — *purely* from where the pages physically live, with identical code and data. The remedy costs nothing at runtime: let each worker initialize (first-touch) the region it will own, so the OS maps those pages to the worker's node. (`numactl --hardware` shows the node distances; `numastat` shows local vs remote hits.)

- **Constraints (measurement path):** Pin threads to nodes (`numactl` / affinity); make `data` large enough to exceed all caches so the access is true main-memory traffic. Compare the *remote* layout (single-node first-touch, cross-node workers) against *first-touch-local*. Report local vs remote `ns/op`.
- **Constraints (analysis path):** State the NUMA factor for latency and bandwidth, identify the memory-bound regime where bandwidth dominates, and predict the slowdown of the remote layout. Name first-touch as the mechanism that decides page placement and as the fix.
- **Acceptance test:** Either you measure first-touch-local as measurably faster than the remote layout (by roughly the bandwidth NUMA factor on a memory-bound pass), or you correctly derive that slowdown and explain it as page placement under the first-touch policy — same code, same data, different *physical* memory node.

---

## Synthesis Task

> Tie the layout techniques together: predict which layout the cache hierarchy prefers, measure both, confirm the prediction, and name the mechanism — cache lines, coherence, prefetch, or page placement — for each.

`[capstone]` Carry **cache-aware layout** end to end across the hierarchy: spatial locality (lines + prefetch), AoS↔SoA, tiling, false sharing, an implicit search layout, a space-filling 2-D layout, the columnar/SIMD win, and NUMA placement — each measured against its predicted-faster sibling, each gap explained by a named mechanism.

1. **Spatial locality + prefetch [measure].** Reproduce array-vs-list (Task 1) and row-vs-column (Task 2); attribute both to line utilization + prefetchability.
2. **AoS vs SoA [measure + analysis].** Compute the AoS waste `(d−f)/d` and SoA ceiling `d/f` (Task 4), then measure the one-field scan (Task 3) and confirm the speedup respects the ceiling.
3. **Tiling [measure].** Tune the matmul tile to L1/L2 and find the sweet spot (Task 5); relate it to `Θ(n³/(B√M))`.
4. **False sharing [measure].** Show padded counters scale and unpadded ones collapse (Task 6); name the coherence protocol as the culprit.
5. **Implicit + space-filling layouts [measure].** Beat sorted-array binary search with Eytzinger (Task 8) and row-major with Morton on a 2-D tiled traversal (Task 9).
6. **Columnar + SIMD [measure].** Win the filter+aggregate with a column store and vectorization (Task 10).
7. **NUMA [measure or analysis].** Show (or derive) the first-touch-local vs remote penalty (Task 11).

Reference harness skeleton in **Go** (one benchmark file, all kernels behind a common timer):

```go
package layout

import (
	"fmt"
	"testing"
)

// Each kernel exposes f(layoutChoice) so the harness can pair "predicted slow"
// vs "predicted fast" and print the ratio + the mechanism that explains it.
type Case struct {
	Name      string
	Slow, Fast func() // the two layouts of the SAME computation
	Mechanism string  // "cache line" | "coherence" | "prefetch" | "SIMD" | "NUMA placement"
}

func reportRatio(b *testing.B, c Case) {
	tSlow := time.Duration(testing.Benchmark(func(bb *testing.B) {
		for i := 0; i < bb.N; i++ {
			c.Slow()
		}
	}).NsPerOp())
	tFast := time.Duration(testing.Benchmark(func(bb *testing.B) {
		for i := 0; i < bb.N; i++ {
			c.Fast()
		}
	}).NsPerOp())
	fmt.Printf("%-22s slow=%-10v fast=%-10v ratio=%.2fx  [%s]\n",
		c.Name, tSlow, tFast, float64(tSlow)/float64(tFast), c.Mechanism)
}
```

- **Analysis answer:** Each technique attacks one hardware reality. Array-over-list and row-over-column win on **spatial locality**: a 64-byte line serves `B/sizeof(elem)` sequential accesses but one strided/chased access, and the prefetcher only helps predictable strides. SoA-over-AoS and hot/cold splitting win by **line utilization** — stop dragging unread bytes through cache; the ceiling is `d/f`. Tiling converts capacity misses to hits by sizing the working set to a cache level — the `Θ(n³/(B√M))` bound one level up. Padding kills **false sharing**, a coherence-protocol pathology where logically disjoint writes invalidate a shared *line*. Eytzinger and Morton are **layout-as-algorithm**: a flat BFS array makes search branch-free and prefetchable; a Z-curve makes a 2-D tile contiguous. Columnar storage stops line waste *and* unlocks **SIMD** over contiguous attributes. NUMA first-touch decides which physical node owns a page, and remote access pays the NUMA factor. The through-line: **none of these change Big-O; all of them change the constant by working with — not against — lines, coherence, prefetch, vectorization, and page placement.**
- **Acceptance test:** For every pairing, the predicted-faster layout is measurably faster on data sized past the relevant cache level, and you name the exact mechanism (cache line, coherence, prefetch, SIMD, or NUMA placement) that produced the gap. The synthesis correctly states that these are constant-factor wins (often `5–50×`) that leave asymptotic complexity untouched — which is precisely why **measuring** is the whole discipline.

---

## Where to go next

- Drop one level down the hierarchy — RAM↔disk instead of cache↔RAM — and replay the same `scan`-vs-`stride` and tiling logic against block transfers in the [I/O-model tasks](../01-the-io-model/tasks.md).
- See the **parameter-free** counterpart to hand-tuned tiling: recursive transpose, multiply, and search that hit the optimal block-transfer bound at *every* cache level without ever reading `B` or `M`, in the [cache-oblivious tasks](../02-cache-oblivious-algorithms/tasks.md).
- For the conceptual treatment of cache lines, AoS/SoA, tiling, false sharing, prefetching, Eytzinger/implicit layouts, and columnar/SIMD — with the hardware model behind each — read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
