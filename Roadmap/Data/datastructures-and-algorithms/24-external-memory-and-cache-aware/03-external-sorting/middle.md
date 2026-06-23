# External Sorting — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Algorithm, Restated for Analysis](#the-algorithm-restated-for-analysis)
3. [Full Analysis of External Merge Sort](#full-analysis-of-external-merge-sort)
   - [Phase 1: Run Formation Costs Θ(N/B)](#phase-1-run-formation-costs-θnb)
   - [Phase 2: The (M/B − 1)-Way Merge and Why the −1](#phase-2-the-mb--1-way-merge-and-why-the-1)
   - [Counting Passes: ⌈log_{M/B−1}(N/M)⌉](#counting-passes-log_mb1nm)
   - [The Total: Θ((N/B) log_{M/B}(N/B))](#the-total-θnb-log_mbnb)
4. [Run Formation: Replacement Selection](#run-formation-replacement-selection)
   - [The Algorithm](#the-algorithm)
   - [The Snowplow Argument: Expected Run Length 2M](#the-snowplow-argument-expected-run-length-2m)
   - [Trade-off vs Load-Sort-Write](#trade-off-vs-load-sort-write)
5. [Merge Engineering](#merge-engineering)
   - [The Loser Tree: O(log k) Per Element](#the-loser-tree-olog-k-per-element)
   - [Double-Buffering and Read-Ahead](#double-buffering-and-read-ahead)
   - [Splitting Memory: Fan-in vs Buffers](#splitting-memory-fan-in-vs-buffers)
6. [Polyphase and Cascade Merge (Historical)](#polyphase-and-cascade-merge-historical)
7. [The Sorting Lower Bound: External Merge Sort Is Optimal](#the-sorting-lower-bound-external-merge-sort-is-optimal)
8. [Code: External Merge Sort with Replacement Selection and a Loser Tree](#code-external-merge-sort-with-replacement-selection-and-a-loser-tree)
   - [Go](#go)
   - [Python](#python)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: turn the two-phase sketch from the [junior level](./junior.md) into a rigorous, engineerable algorithm. By the end you can derive every term of `sort(N) = Θ((N/B) · log_{M/B}(N/B))`, explain why the merge fan-in is `M/B − 1` and not `M/B`, prove that **replacement selection** roughly *halves* the initial run count, build a `k`-way merge on a **loser tree** with `O(log k)` work per element, and overlap I/O with computation via double-buffering.

At the [junior level](./junior.md) you met **external merge sort** as two phases — *form sorted runs*, then *merge them* — and quoted the bound `Θ((N/B) log_{M/B}(N/B))`. From [the I/O model](../01-the-io-model/middle.md) you have the cost measure (`N` items in external memory, `M` items of internal memory `= M/B` blocks, `B` items per block, `1 ≤ B ≤ M ≤ N`, only block transfers counted) and the matching sorting *lower* bound (proved at [I/O-model senior](../01-the-io-model/senior.md)).

This file is the production-engine treatment. It does four things:

- **Derives the full cost** carefully: run formation is `Θ(N/B)` and yields `⌈N/M⌉` runs; each merge pass is `Θ(N/B)` and uses a `(M/B − 1)`-way merge (the `−1` is the reserved **output** buffer); the number of merge passes is `⌈log_{M/B−1}(N/M)⌉`; the product is `Θ((N/B) log_{M/B}(N/B))`.
- **Improves run formation** with **replacement selection** — a min-heap / tournament tree that streams runs of *expected length `2M`* on random input, halving the number of initial runs. The **snowplow argument** explains the factor of `2`.
- **Engineers the merge**: the **loser tree** (a tournament tree) for `O(log k)`-per-element `k`-way merging, and **double-buffering / read-ahead** to overlap the disk transfer of the next block with the CPU work on the current one.
- **Places it against the lower bound**: because the [sorting lower bound](#the-sorting-lower-bound-external-merge-sort-is-optimal) is `Ω((N/B) log_{M/B}(N/B))`, external merge sort is **I/O-optimal** — no algorithm sorts with asymptotically fewer I/Os.

Vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `N` | number of items to sort (external memory) |
| `M` | items that fit in internal memory |
| `B` | items per block (one I/O moves one block) |
| `M/B` | number of **blocks** that fit in internal memory |
| `k` | merge fan-in (number of runs combined in one pass) |
| `run` | a maximal sorted subsequence written to external memory |
| `pass` | one full read-and-write over the `N` items |

We count I/Os, never CPU operations — but in the merge engineering section CPU work matters for a *different* reason: it must not stall the disk, so we keep the per-element work to `O(log k)` and overlap it with I/O.

---

## The Algorithm, Restated for Analysis

To analyze precisely we fix the two phases.

**Phase 1 — Run formation.** Read the `N` input items, produce sorted **runs** in external memory. The baseline is *load-sort-write*: read `M` items (one memory-load, `⌈M/B⌉` I/Os), sort them in internal memory (free), write them back as one sorted run. Repeat until the input is exhausted. This makes `⌈N/M⌉` runs, each of length `M` (the last possibly shorter). [Replacement selection](#run-formation-replacement-selection) is the better variant that produces *longer* runs.

**Phase 2 — Merging.** Repeatedly combine runs. One **merge pass** groups the current runs into batches of `k`, and `k`-way merges each batch into a single run `k` times longer, where `k` is the **fan-in**. A pass reads every item once and writes every item once. After a pass the run count has shrunk by a factor of `k`; passes repeat until a single sorted run remains.

```text
  input  ──Phase 1──▶  ⌈N/M⌉ sorted runs  ──Phase 2 (repeat k-way merge)──▶  1 sorted run
```

Two facts drive the whole analysis, both inherited from [the I/O model](../01-the-io-model/middle.md):

1. **A full pass over the data costs `Θ(N/B)` I/Os** — it is one scan to read plus one scan to write, and `scan(N) = Θ(N/B)`.
2. **The fan-in is capped by memory.** A `k`-way merge keeps one resident block per input run *plus one output block*, so it needs `k + 1` blocks of memory: `k + 1 ≤ M/B`, hence `k ≤ M/B − 1`. This single constraint produces both the `−1` and the logarithm base `M/B`.

---

## Full Analysis of External Merge Sort

### Phase 1: Run Formation Costs Θ(N/B)

Load-sort-write reads each of the `N` items exactly once and writes each exactly once. Reading is one sequential scan; writing is another:

```text
  run-formation I/Os = read N + write N = 2·⌈N/B⌉ = Θ(N/B)
  number of initial runs = ⌈N/M⌉
```

The internal sort of each `M`-item chunk is `Θ(M log M)` *CPU* work — free in the I/O model. So Phase 1 is exactly **one pass**, `Θ(N/B)` I/Os, and its output is `⌈N/M⌉` sorted runs. Hold onto the run count `⌈N/M⌉`: it is the input to the pass-counting logarithm, and it is exactly what replacement selection will cut in half.

### Phase 2: The (M/B − 1)-Way Merge and Why the −1

In a `k`-way merge we maintain `k` input streams (one per run being merged) and one output stream. To advance any stream sequentially without an I/O on every item, we keep its *current block* resident and refill it from external memory only when it drains. That is:

- `k` resident **input blocks**, one per run, refilled as each run is consumed;
- **one** resident **output block**, accumulating merged items and flushed to external memory when it fills.

Total resident blocks: `k + 1`. They must fit in internal memory's `M/B` blocks:

```text
  k + 1 ≤ M/B   ⟹   k ≤ M/B − 1
```

So the **optimal fan-in is `k = M/B − 1`** — use *all* `M/B` blocks of memory, one reserved for output. This is the single most common place to go wrong: people write the fan-in as `M/B`, forgetting the output buffer. The mistake is benign asymptotically (`M/B − 1 = Θ(M/B)`), but it is *wrong*, and in the engineered version below (where memory is split further for read-ahead) the exact count matters.

```text
  ┌─────────────── internal memory: M/B blocks ───────────────┐
  │ [in run 1][in run 2] ... [in run k]   │   [out buffer]     │
  │  ◄────────── k = M/B − 1 input blocks ─────────►   1 block │
  └────────────────────────────────────────────────────────────┘
```

One merge pass reads all `N` items (across all runs) once and writes all `N` merged items once — two scans — so it costs `2·⌈N/B⌉ = Θ(N/B)` I/Os, *independent of `k`* (provided `k ≤ M/B − 1`, i.e. all input blocks are resident). The fan-in does not change the *per-pass* cost; it changes how many passes you need, which is where the win lives.

### Counting Passes: ⌈log_{M/B−1}(N/M)⌉

Phase 2 starts with `R₀ = ⌈N/M⌉` runs. Each pass divides the run count by the fan-in `k = M/B − 1`:

```text
  R₀ = ⌈N/M⌉,   R₁ = ⌈R₀ / k⌉,   R₂ = ⌈R₁ / k⌉,   ...
```

The pass count is the number of times you divide `R₀` by `k` to reach `1`:

```text
  merge passes = ⌈ log_k (R₀) ⌉ = ⌈ log_{M/B − 1} (⌈N/M⌉) ⌉ = ⌈ log_{M/B − 1} (N/M) ⌉
```

Because `M/B − 1 = Θ(M/B)` and `N/M = (N/B)/(M/B)`, this is `Θ(log_{M/B}(N/B))`. (We keep the exact `M/B − 1` base when we want exact pass counts; we relax to `M/B` for the asymptotic statement.) Add the one run-formation pass:

```text
  total passes = 1 + ⌈ log_{M/B − 1} (N/M) ⌉ = Θ( log_{M/B} (N/B) )
```

### The Total: Θ((N/B) log_{M/B}(N/B))

Every pass — the run-formation pass and each merge pass — costs `Θ(N/B)` I/Os. Multiply the per-pass cost by the number of passes:

```text
  sort(N) = Θ(N/B) · ( 1 + ⌈log_{M/B−1}(N/M)⌉ )
          = Θ( (N/B) · log_{M/B}(N/B) ).
```

That is the upper bound, derived term by term. The two memory parameters fight the cost in different ways, exactly as in [the I/O model](../01-the-io-model/middle.md): a larger `B` shrinks the per-pass cost `N/B`; a larger `M/B` **raises the logarithm's base**, shrinking the pass count. With realistic `M/B` in the thousands, `log_{M/B}(N/B)` is `1` or `2` for any single-machine dataset — external sorting is a two-or-three-pass affair.

A worked instance (`N = 10⁹`, `M = 10⁸`, `B = 10⁴`): `M/B = 10⁴`, so `k = M/B − 1 ≈ 10⁴`; `N/M = 10`; run formation makes `10` runs; one merge pass combines all `10` at once (`10 ≤ 10⁴`), so `⌈log_{10⁴}(10)⌉ = 1`. Total `= 2` passes `≈ 4·10⁵` I/Os to sort a billion items.

---

## Run Formation: Replacement Selection

Load-sort-write makes runs of length exactly `M`. **Replacement selection** makes runs of *expected length `2M`* on random input — halving `⌈N/M⌉` to `≈ ⌈N/2M⌉`, which can save an entire merge pass when it tips `log_{M/B−1}(N/M)` across an integer boundary.

### The Algorithm

Keep a **min-heap** (or, better, a loser tree — see below) of `M` items in memory. To form runs, treat the heap as a continuous filter from input to the current run:

1. Fill the heap with the first `M` input items.
2. **Repeat:** pop the heap's minimum and append it to the current run. Read the next input item `x`.
   - If `x ≥` the item just written, `x` can still belong to the *current* run (it is `≥` the last emitted key, so the run stays sorted): push `x` into the heap normally.
   - If `x <` the item just written, `x` is too small for the current run — it must go to the *next* run. Push `x` into the heap but **mark it as belonging to the next run** (give it a higher run-tag so it sorts after every current-run item).
3. When the heap contains only next-run items, the current run is **complete** — close it, promote all items to the current run, and continue.

The heap stays full of `M` items the entire time, continuously absorbing input and emitting a non-decreasing stream. The magic is that items arriving *larger* than the last emission **extend the current run beyond `M` items**.

```text
  input stream ─▶ [ min-heap of M items, run-tagged ] ─▶ current run (non-decreasing)
                       ▲ refill on every pop            items smaller than last emit
                                                         get tagged for the NEXT run
```

### The Snowplow Argument: Expected Run Length 2M

Why `2M`? The classic intuition is a **snowplow** clearing a circular road during a steady snowfall.

Picture the heap as a snowplow moving around a one-lane circular track. Snow (input items) falls uniformly at random over the track. The plow moves forward (emitting items in increasing key order); snow that falls *ahead* of the plow gets swept up and cleared **on this pass** (it joins the current run); snow that falls *behind* the plow has to wait for the **next** lap (the next run). In steady state, the plow always has a full load of `M` items. Over one lap, the plow clears all the snow currently on the track *plus* all the snow that falls ahead of it during the lap.

Quantitatively: in steady state the plow holds `M` items. As it advances one full lap, every new item that lands *in front* of the plow is collected before the plow passes its position; on average **half** the falling snow lands ahead. The result is that a lap (one run) sweeps up the `M` items present at the start **plus** roughly `M` more that arrive ahead during the lap — `2M` items per run for uniformly random input.

```text
  load-sort-write:        run length = M       ⟹  ⌈N/M⌉  runs
  replacement selection:  run length ≈ 2M      ⟹  ≈ ⌈N/2M⌉ runs   (random input)
```

The boundary cases pin the intuition:

- **Already-sorted input:** every new item is `≥` the last emitted item, so it *always* joins the current run. The run never ends — replacement selection produces **one giant run of length `N`**, and the merge phase is skipped entirely.
- **Reverse-sorted input:** every new item is `<` the last emitted, so it is always tagged for the next run. Each run is exactly the heap's worth, `M` — replacement selection degrades to load-sort-write, **no gain**.

So `2M` is the *average* over random order; the realized factor ranges from `1×` (reverse-sorted, adversarial) to unbounded (sorted). This is why replacement selection is a heuristic that helps on random and near-sorted data but offers no worst-case guarantee.

### Trade-off vs Load-Sort-Write

Replacement selection is not free:

- **CPU cost.** Every emitted item does a heap sift, `O(log M)` per item — `Θ(N log M)` CPU total, versus load-sort-write's `Θ(N log M)` as well (each chunk sorted in `M log M`, summed over `N/M` chunks). The asymptotics match; replacement selection's constant is a touch higher per item but it has no batch-sort spikes.
- **I/O streaming, not batching.** Load-sort-write reads `M`, then writes `M`, in big bursts — easy to do sequentially. Replacement selection reads one item and writes one item continuously, which is fine on a block buffer but demands input and output buffering to stay sequential.
- **The payoff.** Halving the run count can eliminate a full `Θ(N/B)` merge pass. When `N/M` is just above a power of `k`, cutting it to `N/2M` drops `⌈log_k(N/M)⌉` by one — a whole pass over the data saved. When `N/M` is already `≤ k` (one merge pass either way), replacement selection buys nothing for I/O and you may prefer the simpler load-sort-write.

Rule of thumb: use replacement selection when `N/M` is large enough that the run-count reduction crosses a `log_{M/B−1}` integer boundary, and when the input is plausibly random or near-sorted (logs, time-series, partially-ordered data). For adversarial or reverse-sorted input, it cannot hurt the run count but cannot help it either.

---

## Merge Engineering

The merge is where a production sort lives or dies. Three concerns: keep the per-element CPU work to `O(log k)` (the **loser tree**), overlap I/O with CPU (**double-buffering / read-ahead**), and split the fixed memory budget sensibly between fan-in and read-ahead.

### The Loser Tree: O(log k) Per Element

A naive `k`-way merge scans all `k` run-heads to find the minimum — `O(k)` per emitted item, `O(Nk)` total CPU, which stalls the disk when `k` is in the thousands. A **min-heap** of the `k` heads fixes this to `O(log k)` per item. The **loser tree** (a.k.a. *tournament tree of losers*, Knuth) does the same `O(log k)` but with **half the comparisons** of a heap and a cache-friendlier, branch-predictable layout — the standard choice for external merge.

A loser tree is a complete binary tournament over the `k` runs. Each internal node stores the **loser** of the comparison played at that node; the overall **winner** (the global minimum) sits in a separate slot above the root. To emit the minimum and advance:

1. Output the winner (the current minimum head). Replace it with the next item from the **same run** the winner came from (or `+∞` if that run is exhausted).
2. Walk from that run's **leaf up to the root**, playing one comparison per level against the loser stored there: the smaller key continues upward as the provisional winner, the larger is stored as the new loser at that node. After `⌈log₂ k⌉` comparisons the new global winner emerges.

```text
                 winner = global min ──▶ emitted, refilled from its run
                    │
              ┌─────┴─────┐          each internal node holds the LOSER
           [loser]     [loser]       of the match played there;
            /   \       /   \        only the path from the changed leaf
         run0  run1  run2  run3      to the root is replayed: O(log k).
```

Because only the path from one leaf to the root is replayed (the rest of the tournament is unchanged), each emitted item costs exactly `⌈log₂ k⌉` comparisons — `O(log k)` — and total merge CPU is `Θ(N log k)` per pass. With `k = M/B − 1`, `log k = Θ(log(M/B))`, matching the information-theoretic minimum work to merge `k` sorted streams. The loser tree is also a fine engine for [replacement selection](#run-formation-replacement-selection) above (replace the min-heap with a loser tree over `M` items).

### Double-Buffering and Read-Ahead

The I/O model charges only transfers, but on real hardware the CPU and the disk run *concurrently*. **Double-buffering** exploits this: for each input run, keep **two** block buffers. While the merge consumes block `A`, the I/O subsystem **reads ahead** the next block `B` of that run in the background. When `A` drains, the merge switches to the already-loaded `B` and the system starts refilling `A`. The output side mirrors this: fill one output block while the previous full one is being written out asynchronously.

```text
  consume:   [ A: being merged ]   ──drains──▶   switch to B (already loaded)
  read-ahead:[ B: prefetched   ]                 now refill A in background
```

The effect is to **hide I/O latency behind CPU work** (and vice versa): wall-clock time becomes `max(total_IO_time, total_CPU_time)` instead of their sum. This does *not* change the I/O *count* — the same blocks are transferred — but it is the difference between a merge that runs at disk bandwidth and one that idles the disk between every block. Double-buffering is why the loser tree's `O(log k)` matters: the per-element CPU must be small enough that the merge never becomes the bottleneck that starves the prefetcher.

### Splitting Memory: Fan-in vs Buffers

Memory is fixed at `M/B` blocks; double-buffering and read-ahead **spend some of it**, which lowers the fan-in. If each of the `k` runs needs `d` resident blocks (e.g. `d = 2` for simple double-buffering) plus the output needs `d_out` blocks:

```text
  k·d + d_out ≤ M/B   ⟹   k ≤ (M/B − d_out) / d
```

With `d = 2`, the fan-in roughly **halves** versus the un-buffered `k = M/B − 1`. This is a genuine trade-off:

- **Maximize fan-in** (`d = 1`, no read-ahead): fewest passes, but the disk stalls on every block boundary — bad on real hardware.
- **Generous read-ahead** (large `d`): the disk streams smoothly, but `k` shrinks, possibly adding a merge pass.

The sweet spot uses *larger blocks with modest read-ahead* rather than tiny blocks with deep prefetch: a bigger `B` reduces both per-pass I/O and the number of block-boundary stalls. In practice external sorts pick `B` to match the storage device's optimal transfer size (often 1–8 MB for spinning disks, larger for sequential SSD throughput), then set `k` as high as the remaining memory allows with `d = 2`. The asymptotic bound is unchanged — `Θ((N/B) log_{M/B}(N/B))` — because halving `k` only changes the logarithm's base by a constant factor; but the realized pass count and wall-clock time depend entirely on this split.

---

## Polyphase and Cascade Merge (Historical)

Before disks, external sorting ran on **magnetic tapes**, where the constraint was not "how much memory" but "how many tape drives." With a fixed number of tapes `T`, you cannot do a clean balanced merge that needs `2k` tapes (`k` in, `k` out) — you have only `T`. The tape era produced clever **merge patterns** that minimize the number of times each record is copied across tapes:

- **Balanced multiway merge** splits `T` tapes into `T/2` input and `T/2` output, doing `(T/2)`-way merges and ping-ponging — simple but wastes half the tapes as idle output at any moment.
- **Polyphase merge** uses `T − 1` tapes as input and `1` as output, but distributes the *initial runs* across tapes in counts proportional to **Fibonacci-like numbers** so that tapes empty at staggered times and can be immediately reused as output. This squeezes far more merging out of `T` tapes — for a given `T` it merges with a higher effective fan-in than balanced merge.
- **Cascade merge** is a related pattern with a different distribution (based on a different number sequence) that, for some `T`, beats polyphase on the number of passes.

These patterns were *the* external-sorting research of the 1960s–70s (Knuth devotes much of TAOCP Vol. 3 to them) and are genuinely beautiful number theory. **They are obsolete for disk.** Modern storage is random-access: a disk or SSD can hold `k` input "tapes" as `k` files (or `k` regions of one file) read concurrently, and there is no scarcity of "output drives" — you just write to another file. So the tape constraint that motivated polyphase/cascade simply does not exist, and modern external sorts use the straightforward **balanced multiway merge** with the maximum fan-in memory allows. Know polyphase exists and why it mattered; do not implement it for a disk-based sort.

```text
  tape era (scarce drives):   polyphase / cascade merge — Fibonacci run distribution
  disk era (random access):   balanced (M/B − 1)-way merge — just open more files
```

---

## The Sorting Lower Bound: External Merge Sort Is Optimal

The upper bound we derived is `O((N/B) log_{M/B}(N/B))`. The matching lower bound makes external merge sort **I/O-optimal**.

> **Theorem (sorting lower bound; Aggarwal–Vitter, 1988).** Any algorithm that sorts `N` items in the comparison I/O model performs `Ω((N/B) · log_{M/B}(N/B))` I/Os.

The argument is information-theoretic. Sorting must distinguish all `N!` possible input orderings, which carries `log₂(N!) = Θ(N log N)` bits of information. Each I/O can resolve only a bounded amount of order information: reading a block of `B` items into memory with `M − B` residents reveals at most their interleaving, contributing `O(B · log(M/B))` bits per I/O. Dividing the total information by the per-I/O information yields

```text
  #I/Os ≥ Ω( (N log N) / (B log(M/B)) ) = Ω( (N/B) · log_{M/B}(N/B) ).
```

The full counting argument is developed at [I/O-model senior](../01-the-io-model/senior.md) and sits among the general [lower-bound and adversary techniques](../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/). The consequence for *this* topic:

> **External merge sort matches the lower bound: it is I/O-optimal.** No comparison-based external sort uses asymptotically fewer block transfers.

Replacement selection, loser trees, and double-buffering do **not** improve the asymptotic bound — they improve *constants*: fewer initial runs (so the realized pass count is smaller and may drop by one), less CPU per element (so the disk stays busy), and overlapped transfers (so wall-clock approaches the I/O bound). The `Θ((N/B) log_{M/B}(N/B))` ceiling is fixed; the engineering is about reaching it on real hardware.

---

## Code: External Merge Sort with Replacement Selection and a Loser Tree

The code below sorts a large on-disk integer dataset under a **bounded memory** budget, instrumented to count **runs, passes, and I/Os**. Phase 1 offers both *load-sort-write* and *replacement selection* so we can confirm replacement selection roughly **halves** the run count on random input. Phase 2 merges with a **loser tree** at fan-in `M/B − 1`.

To keep the example self-contained and runnable, "external memory" is a temp directory of run files, and each block read/write is counted as one I/O (block size `B` items). The instrumentation is the point; swap the file layer for real `O_DIRECT` I/O in production.

### Go

```go
package main

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"math/rand"
	"os"
	"sort"
)

// ---- I/O counting: every block (B items) read or written counts as 1 I/O ----

type Counter struct{ IOs int64 }

const inf = int64(1) << 62

// writeRun streams a sorted slice to a new run file, counting ceil(len/B) write I/Os.
func (c *Counter) writeRun(path string, data []int64, B int) {
	f, _ := os.Create(path)
	w := bufio.NewWriter(f)
	for _, v := range data {
		binary.Write(w, binary.LittleEndian, v)
	}
	w.Flush()
	f.Close()
	c.IOs += int64((len(data) + B - 1) / B) // ceil(len/B) blocks written
}

// readAll reads a run file fully, counting ceil(len/B) read I/Os.
func (c *Counter) readAll(path string, B int) []int64 {
	f, _ := os.Open(path)
	r := bufio.NewReader(f)
	var out []int64
	for {
		var v int64
		if err := binary.Read(r, binary.LittleEndian, &v); err != nil {
			break
		}
		out = append(out, v)
	}
	f.Close()
	c.IOs += int64((len(out) + B - 1) / B)
	return out
}

// ---- Phase 1a: load-sort-write -> ceil(N/M) runs of length M ----

func runsLoadSort(c *Counter, input []int64, M, B int, dir string) []string {
	var runs []string
	for i := 0; i < len(input); i += M {
		j := i + M
		if j > len(input) {
			j = len(input)
		}
		chunk := append([]int64(nil), input[i:j]...)
		c.IOs += int64((len(chunk) + B - 1) / B) // read the chunk
		sort.Slice(chunk, func(a, b int) bool { return chunk[a] < chunk[b] })
		p := fmt.Sprintf("%s/ls_%d.run", dir, len(runs))
		c.writeRun(p, chunk, B)
		runs = append(runs, p)
	}
	return runs
}

// ---- Phase 1b: replacement selection -> expected run length ~2M ----
// A min-heap of (key, runTag); items smaller than the last emit get the next tag.

type rsItem struct {
	key int64
	tag int // run number this item belongs to
}
type rsHeap []rsItem

func (h rsHeap) Len() int { return len(h) }
func (h rsHeap) Less(i, j int) bool {
	if h[i].tag != h[j].tag {
		return h[i].tag < h[j].tag
	}
	return h[i].key < h[j].key
}
func (h rsHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *rsHeap) up(i int) {
	for i > 0 {
		p := (i - 1) / 2
		if !(*h).Less(i, p) {
			break
		}
		(*h).Swap(i, p)
		i = p
	}
}
func (h *rsHeap) down(i int) {
	n := len(*h)
	for {
		l, r, s := 2*i+1, 2*i+2, i
		if l < n && (*h).Less(l, s) {
			s = l
		}
		if r < n && (*h).Less(r, s) {
			s = r
		}
		if s == i {
			return
		}
		(*h).Swap(i, s)
		i = s
	}
}

func runsReplacementSelection(c *Counter, input []int64, M, B int, dir string) []string {
	h := make(rsHeap, 0, M)
	// fill the heap with up to M items (one read pass over the prefix)
	pos := 0
	for pos < len(input) && len(h) < M {
		h = append(h, rsItem{input[pos], 0})
		h.up(len(h) - 1)
		pos++
	}
	c.IOs += int64((pos + B - 1) / B) // reading the initial fill

	var runs []string
	var cur []int64
	curTag := 0
	lastEmit := int64(-inf)

	flush := func() {
		if len(cur) > 0 {
			p := fmt.Sprintf("%s/rs_%d.run", dir, len(runs))
			c.writeRun(p, cur, B)
			runs = append(runs, p)
			cur = nil
		}
	}

	for len(h) > 0 {
		top := h[0]
		if top.tag != curTag { // current run done; promote next-run items
			flush()
			curTag = top.tag
			lastEmit = int64(-inf)
		}
		cur = append(cur, top.key)
		lastEmit = top.key

		if pos < len(input) {
			x := input[pos]
			pos++
			if pos%B == 1 {
				c.IOs++ // a new input block was fetched
			}
			tag := curTag
			if x < lastEmit { // too small for the current run -> next run
				tag = curTag + 1
			}
			h[0] = rsItem{x, tag}
			h.down(0)
		} else {
			// no more input: pop the heap
			last := len(h) - 1
			h.Swap(0, last)
			h = h[:last]
			if len(h) > 0 {
				h.down(0)
			}
		}
	}
	flush()
	return runs
}

// ---- Phase 2: k-way merge with a loser tree, k = M/B - 1 ----

type stream struct {
	data []int64
	idx  int
}

func (s *stream) head() int64 {
	if s.idx < len(s.data) {
		return s.data[s.idx]
	}
	return inf
}

// loserTreeMerge merges all given streams using a tournament tree of losers.
func loserTreeMerge(streams []*stream) []int64 {
	k := len(streams)
	if k == 0 {
		return nil
	}
	// loser[i] holds the index of the losing stream at internal node i; loser[0] = overall winner
	loser := make([]int, k)
	for i := range loser {
		loser[i] = -1
	}
	// adjust replays the path from leaf s up to the root.
	var adjust func(s int)
	adjust = func(s int) {
		t := (s + k) / 2
		for t > 0 {
			if loser[t] == -1 {
				loser[t] = s
				return
			}
			if streams[s].head() > streams[loser[t]].head() {
				s, loser[t] = loser[t], s // s loses here; the resident continues up
			}
			t /= 2
		}
		loser[0] = s // winner
	}
	for s := 0; s < k; s++ {
		adjust(s)
	}
	var out []int64
	for {
		w := loser[0]
		if streams[w].head() == inf {
			break // all streams exhausted
		}
		out = append(out, streams[w].head())
		streams[w].idx++
		adjust(w)
	}
	return out
}

func mergePass(c *Counter, runs []string, M, B int, dir, prefix string) []string {
	k := M/B - 1
	if k < 2 {
		k = 2
	}
	var next []string
	for i := 0; i < len(runs); i += k {
		j := i + k
		if j > len(runs) {
			j = len(runs)
		}
		streams := make([]*stream, 0, j-i)
		for _, p := range runs[i:j] {
			streams = append(streams, &stream{data: c.readAll(p, B)})
		}
		merged := loserTreeMerge(streams)
		p := fmt.Sprintf("%s/%s_%d.run", dir, prefix, len(next))
		c.writeRun(p, merged, B)
		next = append(next, p)
	}
	return next
}

func sortExternal(input []int64, M, B int, useRS bool) (runs0, passes int, ios int64) {
	dir, _ := os.MkdirTemp("", "extsort")
	defer os.RemoveAll(dir)
	c := &Counter{}

	var runs []string
	if useRS {
		runs = runsReplacementSelection(c, input, M, B, dir)
	} else {
		runs = runsLoadSort(c, input, M, B, dir)
	}
	runs0 = len(runs)
	passes = 1 // run-formation pass

	round := 0
	for len(runs) > 1 {
		runs = mergePass(c, runs, M, B, dir, fmt.Sprintf("m%d", round))
		passes++
		round++
	}
	return runs0, passes, c.IOs
}

func main() {
	N, M, B := 200_000, 8_000, 200 // M/B = 40 blocks -> fan-in k = 39
	rng := rand.New(rand.NewSource(7))
	input := make([]int64, N)
	for i := range input {
		input[i] = int64(rng.Intn(1 << 30))
	}

	r1, p1, io1 := sortExternal(input, M, B, false) // load-sort-write
	r2, p2, io2 := sortExternal(input, M, B, true)  // replacement selection

	fmt.Printf("N=%d  M=%d  B=%d  fan-in k=M/B-1=%d\n", N, M, B, M/B-1)
	fmt.Printf("load-sort-write:       runs=%d  passes=%d  IOs=%d\n", r1, p1, io1)
	fmt.Printf("replacement selection: runs=%d  passes=%d  IOs=%d\n", r2, p2, io2)
	fmt.Printf("run-count reduction:   %.2fx  (expected ~2x on random input)\n",
		float64(r1)/float64(r2))
}
```

Expected output (numbers vary slightly with the seed):

```text
N=200000  M=8000  B=200  fan-in k=M/B-1=39
load-sort-write:       runs=25  passes=2  IOs=4000
replacement selection: runs=13  passes=2  IOs=4012
run-count reduction:   1.92x  (expected ~2x on random input)
```

The run-count reduction is `≈ 2×`, confirming the snowplow result: load-sort-write makes `⌈N/M⌉ = 25` runs of length `M`; replacement selection makes `≈ ⌈N/2M⌉ = 13` runs of expected length `2M`. Here both finish in **2 passes** because `25 ≤ k = 39` already merges in one pass — so the halving does not save a pass at this size, but on a dataset where `⌈N/M⌉ > k ≥ ⌈N/2M⌉` it removes an entire `Θ(N/B)` merge pass.

### Python

```python
import heapq
import os
import random
import struct
import tempfile

INF = 1 << 62


class Counter:
    """Counts one I/O per block (B items) read or written."""

    def __init__(self):
        self.ios = 0

    def write_run(self, path, data, B):
        with open(path, "wb") as f:
            f.write(struct.pack(f"<{len(data)}q", *data))
        self.ios += -(-len(data) // B)  # ceil(len/B)

    def read_all(self, path, B):
        with open(path, "rb") as f:
            raw = f.read()
        n = len(raw) // 8
        out = list(struct.unpack(f"<{n}q", raw)) if n else []
        self.ios += -(-len(out) // B)
        return out


# ---- Phase 1a: load-sort-write -> ceil(N/M) runs of length M ----
def runs_load_sort(c, data, M, B, d):
    runs = []
    for i in range(0, len(data), M):
        chunk = sorted(data[i:i + M])
        c.ios += -(-len(chunk) // B)           # read the chunk
        p = os.path.join(d, f"ls_{len(runs)}.run")
        c.write_run(p, chunk, B)
        runs.append(p)
    return runs


# ---- Phase 1b: replacement selection -> expected run length ~2M ----
def runs_replacement_selection(c, data, M, B, d):
    heap = []  # entries: (tag, key)
    pos = 0
    while pos < len(data) and len(heap) < M:
        heapq.heappush(heap, (0, data[pos]))
        pos += 1
    c.ios += -(-pos // B)                       # initial fill

    runs, cur, cur_tag, last_emit = [], [], 0, -INF

    def flush():
        if cur:
            p = os.path.join(d, f"rs_{len(runs)}.run")
            c.write_run(p, cur, B)
            runs.append(p)
            cur.clear()

    while heap:
        tag, key = heap[0]
        if tag != cur_tag:                      # current run done
            flush()
            cur_tag, last_emit = tag, -INF
        cur.append(key)
        last_emit = key

        if pos < len(data):
            x = data[pos]
            pos += 1
            if pos % B == 1:
                c.ios += 1                       # a new input block fetched
            new_tag = cur_tag + 1 if x < last_emit else cur_tag
            heapq.heapreplace(heap, (new_tag, x))
        else:
            heapq.heappop(heap)
    flush()
    return runs


# ---- Phase 2: k-way merge (heapq is a tournament of O(log k) per element) ----
def merge_pass(c, runs, M, B, d, prefix):
    k = max(M // B - 1, 2)
    nxt = []
    for i in range(0, len(runs), k):
        group = runs[i:i + k]
        streams = [c.read_all(p, B) for p in group]
        # k-way merge via a heap of (key, stream_idx, pos): O(log k) per item
        heap = [(s[0], si, 0) for si, s in enumerate(streams) if s]
        heapq.heapify(heap)
        merged = []
        while heap:
            key, si, j = heapq.heappop(heap)
            merged.append(key)
            if j + 1 < len(streams[si]):
                heapq.heappush(heap, (streams[si][j + 1], si, j + 1))
        p = os.path.join(d, f"{prefix}_{len(nxt)}.run")
        c.write_run(p, merged, B)
        nxt.append(p)
    return nxt


def sort_external(data, M, B, use_rs):
    with tempfile.TemporaryDirectory() as d:
        c = Counter()
        runs = (runs_replacement_selection(c, data, M, B, d) if use_rs
                else runs_load_sort(c, data, M, B, d))
        runs0, passes, rnd = len(runs), 1, 0
        while len(runs) > 1:
            runs = merge_pass(c, runs, M, B, d, f"m{rnd}")
            passes += 1
            rnd += 1
        return runs0, passes, c.ios


def main():
    N, M, B = 200_000, 8_000, 200          # M/B = 40 -> fan-in k = 39
    random.seed(7)
    data = [random.randrange(1 << 30) for _ in range(N)]

    r1, p1, io1 = sort_external(data, M, B, False)
    r2, p2, io2 = sort_external(data, M, B, True)

    print(f"N={N}  M={M}  B={B}  fan-in k=M/B-1={M // B - 1}")
    print(f"load-sort-write:       runs={r1}  passes={p1}  IOs={io1}")
    print(f"replacement selection: runs={r2}  passes={p2}  IOs={io2}")
    print(f"run-count reduction:   {r1 / r2:.2f}x  (expected ~2x on random input)")


if __name__ == "__main__":
    main()
```

Both programs confirm the theory: replacement selection cuts the initial run count by `≈ 2×` (the snowplow factor); the merge uses a tournament structure that costs `O(log k)` per emitted element (an explicit loser tree in Go, `heapq` in Python); the I/O count is `Θ(N/B)` per pass with the pass count `= 1 + ⌈log_{M/B−1}(N/M)⌉`. (To *see* a saved pass, shrink `M` so that `⌈N/M⌉ > 39 ≥ ⌈N/2M⌉` — then load-sort-write needs an extra merge pass that replacement selection avoids.)

---

## Pitfalls

- **Forgetting the `−1` output buffer.** The fan-in is `k = M/B − 1`, not `M/B`: a `k`-way merge holds one input block per run **plus one output block** (`k + 1` blocks total ≤ `M/B`). Writing `k = M/B` overcommits memory and, in the engineered version where memory is further split for read-ahead, produces a real bug, not just a constant-factor error. The logarithm base is `M/B` asymptotically, but the exact pass count uses `M/B − 1`.

- **Splitting memory wrong between fan-in and read-ahead.** Double-buffering spends `2` blocks per run, so generous read-ahead can **halve** the fan-in (`k ≈ (M/B)/2`), possibly adding a merge pass. Maximizing fan-in with `d = 1` minimizes passes but stalls the disk on every block boundary. The right split favors *larger blocks with modest read-ahead* (`d = 2`); decide it deliberately, do not let it happen by accident.

- **Expecting replacement selection to always help.** Its `2M` run length is the *average* over random input. On **reverse-sorted** (adversarial) input it degrades to runs of length `M` — no better than load-sort-write — and on already-**sorted** input it makes one giant run (no merge at all). It also adds per-item CPU and streaming complexity. Use it when `N/M` is large and the input is plausibly random or near-sorted, and when halving the run count actually crosses a `log_{M/B−1}` boundary to save a pass.

- **Letting CPU starve the disk.** A naive `O(k)`-per-element merge (scan all `k` heads) makes the CPU the bottleneck when `k` is in the thousands, idling the disk. Use a **loser tree** (or heap) for `O(log k)` per element, and **double-buffer** so the prefetcher always has the next block ready. The I/O model hides this — it charges only transfers — but on real hardware the merge's wall-clock time is `max(I/O, CPU)`, and you want it to be `I/O`.

- **Keeping the merge sequential.** The whole point of external sorting is that each pass is a **sequential** scan — `Θ(N/B)`, not `Θ(N)`. Do not introduce random access into the merge (e.g. seeking around a run file, or sorting via repeated random reads). One stray random-access pattern turns a `Θ(N/B)` pass into a `Θ(N)` one, a factor of `B` slower. Runs are streamed; keep them streamed. (This is the same random-vs-sequential trap from [the I/O model](../01-the-io-model/middle.md).)

- **Implementing polyphase merge for disk.** Polyphase and cascade merge solved a **tape-drive scarcity** problem that random-access storage does not have. On disk or SSD you just open `k` files for input and write to another — the balanced `(M/B − 1)`-way merge is correct and optimal. Polyphase is history, not a disk-sort technique.

- **Quoting the bound for `N ≤ M`.** When the input fits in memory, the whole thing is one load (`Θ(N/B)`), an in-memory sort (free), and one write — no merge phase. The `log_{M/B}` term is `< 1` and rounds away. The interesting analysis is `N > M`; for `N ≤ M` external sorting is just an internal sort wrapped in two scans.

---

## Summary

- **External merge sort, fully analyzed.** Phase 1 (**run formation**) is one pass, `Θ(N/B)` I/Os, producing `⌈N/M⌉` sorted runs. Phase 2 (**merging**) does `(M/B − 1)`-way merges; each pass is `Θ(N/B)` and divides the run count by `k = M/B − 1`, so `⌈log_{M/B−1}(N/M)⌉` merge passes suffice. Total: `Θ((N/B) · log_{M/B}(N/B))`. The **optimal fan-in uses all `M/B` blocks**, one reserved for output — hence the `−1`.

- **Replacement selection halves the run count.** A min-heap / loser tree of `M` items streams runs of **expected length `2M`** on random input (the **snowplow** argument: in steady state a run sweeps up the `M` resident items plus the `≈ M` that arrive ahead during the pass), cutting `⌈N/M⌉` to `≈ ⌈N/2M⌉` and possibly saving a merge pass. It makes one giant run on sorted input and degrades to length `M` on reverse-sorted input — a heuristic, not a guarantee.

- **Merge engineering.** A **loser tree** (tournament of losers) merges `k` streams at `O(log k)` per element with half a heap's comparisons. **Double-buffering / read-ahead** overlaps the next block's transfer with the current block's CPU work, making wall-clock `max(I/O, CPU)` instead of their sum — without changing the I/O count. Memory must be split between fan-in and read-ahead: `k·d + d_out ≤ M/B`.

- **Polyphase / cascade merge** were the tape-era optimal patterns (Fibonacci run distributions to reuse scarce tape drives). Random-access disk has no drive scarcity, so modern sorts use the straightforward **balanced multiway merge** — know polyphase as history, do not implement it.

- **External merge sort is I/O-optimal.** The [sorting lower bound](../01-the-io-model/senior.md) `Ω((N/B) log_{M/B}(N/B))` (an information-theoretic counting argument, in the family of [lower-bound and adversary techniques](../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/)) matches the upper bound, so no comparison-based external sort uses asymptotically fewer I/Os. Replacement selection, loser trees, and double-buffering improve **constants and wall-clock**, not the asymptotic bound.

Continue to the [senior level](./senior.md) for the lower-bound proof in full, distribution sort (the `Θ(sort(N))` alternative to merge sort), parallel/distributed external sort, and variable-length-record handling. Step out to [the I/O model](../01-the-io-model/middle.md) for the cost framework these bounds live in, to [B-tree I/O analysis](../04-b-tree-io-analysis/middle.md) for the search-structure counterpart, or to [cache-oblivious algorithms](../02-cache-oblivious-algorithms/middle.md) to see how the same `sort(N)` bound is reached *without* knowing `M` and `B` (funnelsort). For the two-phase intuition and worked toy example, revisit [junior](./junior.md).
