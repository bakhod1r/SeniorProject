# External Sorting — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build (or reuse) the **bounded-memory external sort** on a simulated disk `(M, B)`, replay the workload, and **count runs, passes, and block transfers (I/Os)**. The acceptance test is always the same: *the output is sorted **and** the measured passes / I/Os match the bound derived for the tested `(N, M, B)`.*
> **[analysis]** tasks need no code: count passes, derive the `sort(N)` bound, or work the replacement-selection "snowplow" from first principles — model derivations are provided so you can grade yourself.

**External sorting** is the canonical external-memory algorithm: sort `N` records when `N ≫ M`, so the data never fits in internal memory at once. Every record must therefore be read from and written to disk at least once, and the only cost charged is the **block transfer** — moving `B` consecutive records between an internal memory of `M` records and unbounded external memory. The whole design problem is *how few times you must stream the data past memory*. Three parameters fix everything:

- **`N`** — the number of records to sort (`N > M`).
- **`M`** — the number of records that fit in internal memory (`M ≥ B`).
- **`B`** — the **block size**: one I/O transfers exactly `B` consecutive records.

The algorithm has two stages, and the cost of each must become a reflex:

- **Run formation.** Read the input in memory-sized pieces, sort each in RAM, and write it back as a sorted **run**. The simple scheme makes `⌈N/M⌉` runs of length `M`; **replacement selection** makes runs of *average length `2M`*, halving the run count on random input.
- **Multiway merge.** Repeatedly merge groups of `k` runs into longer runs until one remains. The fan-in is `k = ⌊M/B⌋ − 1` — *blocks* that fit, minus one output block — so each pass cuts the run count by a factor `M/B`.

The bounds you will implement, measure, and derive:

| Quantity | Value | Why |
| --- | --- | --- |
| **Initial runs** (simple) | `R₀ = ⌈N/M⌉` | each run holds `M` records |
| **Initial runs** (repl. selection) | `≈ N/(2M)` on random input | snowplow: average run length `2M` |
| **Merge fan-in** | `k = ⌊M/B⌋ − 1 = Θ(M/B)` | one input block per run + one output block ≤ `M/B` |
| **Merge passes** | `P = ⌈log_{M/B}(N/M)⌉` | each pass shrinks run count by `k ≈ M/B` |
| **Total I/Os** | `2(N/B)·(1 + P) = Θ((N/B)·log_{M/B}(N/B))` | run formation + `P` passes, each a full scan in and out |

The recurring discipline for every coding task is the same as for any external-memory bound: **instrument the cost, replay the workload, count the resource, and confirm the measured count respects the derived bound.** A pass count you never replay against a simulator is just a hope; an I/O total you cannot derive is just a number. Tie the two together on every task — *output sorted **and** count matches*.

**Related practice:**
- [The I/O Model tasks](../01-the-io-model/tasks.md) — the `(M, B)` block-cache simulator, `scan(N) = Θ(N/B)`, and the `sort(N)` bound this topic specializes and sharpens.
- [Cache-Oblivious Algorithms tasks](../02-cache-oblivious-algorithms/tasks.md) — funnelsort and the cache-oblivious `sort(N)` bound that matches this one *without knowing `M` or `B`*.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **I/O (block transfer).** One read or write of `B` consecutive records; cost `1`. Computation on resident data is free. The cost of a sort is its total I/O count.
- **Pass.** One full streaming of all `N` records through memory: `N/B` reads plus `N/B` writes `= 2N/B` I/Os. Run formation is one pass; each merge level is one pass.
- **Run.** A maximal sorted sequence written to disk. Run formation produces the initial runs; each merge pass concatenates the inputs of a merge group into one longer run.
- **Fan-in `k = ⌊M/B⌋ − 1`.** The number of runs merged at once. You buffer one **block** per input run (not one record) plus one output block, so `k + 1 ≤ M/B`. This is why the sort logarithm has base `M/B`, not `M` and not `2`.
- **Loser tree (tournament tree).** A complete binary tree over the `k` run heads that finds the minimum in `O(log k)` per output record and updates in `O(log k)`, beating a linear `O(k)` scan when `k` is large.

---

## Beginner Tasks

### Task 1 — Simulate disk; external merge sort that beats the memory limit `M` **[coding]**

`[easy]` Build the core instrument for every later task: an **external sort on a simulated disk**. Records live in chunked "blocks" on disk; internal memory holds at most `M` records (`= M/B` blocks). The sort must work when `N > M`, so you cannot load everything at once.

Stage 1 — **run formation**: repeatedly read `M` records, sort them in memory, write them back as a sorted run. Stage 2 — a simple **2-way (or k-way) merge**: merge runs pairwise (or `k` at a time) until one sorted run remains. Count **runs** and **passes**, and verify the output is sorted.

#### Python

```python
import math

class Disk:
    """Simulated external storage. Records live in a flat list; every read or write
    of B consecutive records is one I/O. Internal memory is never modeled directly —
    the discipline is that you only ever hold <= M records 'in memory' at once."""
    def __init__(self, B):
        self.B = B
        self.store = {}          # run_id -> list of records (a sorted run on disk)
        self.reads = 0           # block reads
        self.writes = 0          # block writes
        self._next = 0

    def write_run(self, records):
        rid = self._next; self._next += 1
        self.store[rid] = list(records)
        self.writes += math.ceil(len(records) / self.B)   # block writes
        return rid

    def read_run(self, rid):
        rec = self.store[rid]
        self.reads += math.ceil(len(rec) / self.B)        # block reads
        return rec

    @property
    def ios(self):
        return self.reads + self.writes

def form_runs(data, M, disk):
    """Stage 1: sort M-sized chunks in memory, write each as a sorted run."""
    runs = []
    for lo in range(0, len(data), M):
        chunk = sorted(data[lo:lo + M])     # <= M records in memory, sorted for free
        runs.append(disk.write_run(chunk))
    return runs

def merge_pass(runs, k, disk):
    """One pass: merge runs in groups of k into longer sorted runs."""
    import heapq
    new_runs = []
    for i in range(0, len(runs), k):
        group = [disk.read_run(r) for r in runs[i:i + k]]
        merged = list(heapq.merge(*group))   # k-way merge
        new_runs.append(disk.write_run(merged))
    return new_runs

def external_sort(data, M, B, k=2):
    disk = Disk(B)
    runs = form_runs(data, M, disk)
    initial_runs = len(runs)                  # R0 = ceil(N/M)
    passes = 1                                # run formation is the first pass
    while len(runs) > 1:
        runs = merge_pass(runs, k, disk)
        passes += 1
    out = disk.read_run(runs[0]) if runs else []
    return out, initial_runs, passes, disk

if __name__ == "__main__":
    import random
    random.seed(0)
    data = [random.randint(0, 999) for _ in range(50)]
    out, R0, passes, disk = external_sort(list(data), M=10, B=2, k=2)
    print(f"N={len(data)} M=10 B=2 k=2  -> passes={passes}  I/Os={disk.ios}")
    assert out == sorted(data), "external sort must produce a sorted array"
    print("sorted OK:", out[:8], "...")
```

#### Go (run formation core)

```go
func formRuns(data []int, M int, disk *Disk) []int {
	var runs []int
	for lo := 0; lo < len(data); lo += M {
		hi := lo + M
		if hi > len(data) {
			hi = len(data)
		}
		chunk := append([]int(nil), data[lo:hi]...)
		sort.Ints(chunk) // <= M records in memory
		runs = append(runs, disk.WriteRun(chunk))
	}
	return runs
}
```

- **Constraints:** Never hold more than `M` records "in memory" at once — run formation reads exactly `M`-sized chunks; the merge holds one record (the head) per active run. `N > M` so at least two runs form. Count a run write/read as `⌈len/B⌉` block transfers. The output must come out **sorted**.
- **Hint:** Run formation makes `R₀ = ⌈N/M⌉` runs. A `k`-way merge cuts the run count by `k` per pass, so the number of merge passes is `⌈log_k R₀⌉`; total passes `= 1 + ⌈log_k R₀⌉`. With `k = 2` and `R₀ = 5` runs you need `⌈log₂ 5⌉ = 3` merge passes, `4` passes total.
- **Acceptance test:** `out == sorted(data)`, the run count is `⌈N/M⌉`, and `passes == 1 + ⌈log_k(⌈N/M⌉)⌉`. Keep this `Disk` + `external_sort` scaffold — every later coding task drives it.

---

### Task 2 — Trace `N = 12, M = 4, B = 2` by hand; confirm against the code **[analysis + coding]**

`[easy]` Before trusting the machine, sort a tiny instance **on paper** and check the code reproduces your trace exactly. Take `N = 12`, `M = 4`, `B = 2`, and the input

```
[7, 2, 9, 4, 1, 6, 3, 8, 5, 0, 11, 10]
```

with a **2-way merge** (`k = 2`). Walk run formation, then each merge pass, writing down the runs and the I/O count at every step.

> **Do the trace by hand first**, then run Task 1's code with these parameters and confirm.

**Model trace.**

*Run formation.* Read in chunks of `M = 4`, sort each, write back as a run:

```
chunk [7,2,9,4]   -> run R0 = [2,4,7,9]
chunk [1,6,3,8]   -> run R1 = [1,3,6,8]
chunk [5,0,11,10] -> run R2 = [0,5,10,11]
```

`R₀ = ⌈12/4⌉ = 3` runs. Each chunk is `4` records `= 2` blocks (`B = 2`): read `2` + write `2` = `4` I/Os per chunk, `12` I/Os for run formation.

*Merge pass 1* (`k = 2`): merge `(R0, R1)`, then `R2` alone passes through.

```
merge [2,4,7,9] + [1,3,6,8]   -> [1,2,3,4,6,7,8,9]   (8 records = 4 blocks)
carry [0,5,10,11]                                       (4 records = 2 blocks)
```

Two runs remain. I/Os: read `R0`(2) + `R1`(2) + write merged(4) = `8`, plus carrying `R2` (read 2 + write 2 = 4) = `12`.

*Merge pass 2*: merge the two survivors.

```
merge [1,2,3,4,6,7,8,9] + [0,5,10,11] -> [0,1,2,3,4,5,6,7,8,9,10,11]
```

One run remains — done. I/Os: read `4 + 2` + write `6` = `12`.

*Totals.* Passes `= 1 (formation) + 2 (merges) = 3`. Check against the formula: `R₀ = 3`, `⌈log₂ 3⌉ = 2` merge passes, `1 + 2 = 3` ✓. Total I/Os `= 12 + 12 + 12 = 36`. The closed form `2(N/B)·(1 + P) = 2·(12/2)·(1 + 2) = 2·6·3 = 36` ✓ (the carry of `R2` makes the per-pass cost exactly `2N/B` only because every record is read and written each pass).

- **Constraints:** Use exactly `N = 12, M = 4, B = 2, k = 2` and the given input. Write the runs after formation and after each merge pass; count I/Os per pass as `⌈records/B⌉` reads + writes. Confirm `passes = 3` and total I/Os `= 36`.
- **Acceptance test:** Your hand trace matches the code's runs at every stage; the run count is `3`, passes `= 1 + ⌈log₂ 3⌉ = 3`, and the I/O total `36` equals `2(N/B)(1 + P)`. The bound's arithmetic and the machine agree on a case small enough to verify by eye.

---

### Task 3 — Vary `k`: confirm passes drop as `1 + ⌈log_k(N/M)⌉` **[coding]**

`[easy]` The whole leverage of external sorting is the **fan-in `k`**: a bigger `k` means fewer, fatter merges and so fewer passes. Hold `N` and `M` fixed, vary the merge fan-in `k`, and confirm the measured pass count tracks `1 + ⌈log_k(⌈N/M⌉)⌉` — and that going from `k = 2` to a large `k` collapses the passes.

#### Python

```python
import math

def count_passes(N, M, k):
    """Passes for external sort: 1 formation pass + ceil(log_k R0) merge passes."""
    R0 = math.ceil(N / M)
    passes = 1
    runs = R0
    while runs > 1:
        runs = math.ceil(runs / k)
        passes += 1
    return passes, R0

if __name__ == "__main__":
    N, M = 10**6, 10**3            # R0 = 1000 initial runs
    print(f"N={N} M={M}  R0={math.ceil(N/M)} initial runs")
    print(f"{'k':>6} {'merge passes':>13} {'total passes':>13} "
          f"{'1+ceil(log_k R0)':>18}")
    for k in (2, 4, 8, 16, 64, 256):
        passes, R0 = count_passes(N, M, k)
        predicted = 1 + (math.ceil(math.log(R0, k)) if R0 > 1 else 0)
        print(f"{k:>6} {passes-1:>13} {passes:>13} {predicted:>18}")
        assert passes == predicted, "measured passes must equal 1 + ceil(log_k R0)"
    print("\nOK: bigger fan-in k => fewer passes; k=256 sorts 10^6 in 1-2 merge passes")
```

- **Constraints:** Keep `N` and `M` fixed so the only lever is `k`. Count passes by the same `runs ← ⌈runs/k⌉` loop the merge performs. The fan-in `k` here is a free parameter; Task 6 ties it to memory as `k = ⌊M/B⌋ − 1`.
- **Hint:** With `R₀ = 1000` runs, `k = 2` needs `⌈log₂ 1000⌉ = 10` merge passes, while `k = 256` needs `⌈log₂₅₆ 1000⌉ = 2`. Each pass is a full scan of all `N` records, so cutting `10` passes to `2` is a `5×` I/O reduction. Fan-in is the dominant cost lever in external sorting.
- **Acceptance test:** Measured passes equal `1 + ⌈log_k(⌈N/M⌉)⌉` for every `k`, and the merge-pass count falls steeply as `k` grows. The base of the pass logarithm *is* the fan-in.

---

### Task 4 — Count I/Os, not just passes; verify `2(N/B)(1 + P)` **[coding]**

`[easy]` Passes are a proxy; the real cost is **block transfers**. Drive Task 1's `Disk` and confirm the total I/O count equals the closed form `2(N/B)·(1 + P)` — run formation (`2N/B`) plus `P` merge passes (`2N/B` each), where `P = ⌈log_k(⌈N/M⌉)⌉`.

#### Python

```python
import math, random

if __name__ == "__main__":
    random.seed(1)
    print(f"{'N':>6} {'M':>5} {'B':>4} {'k':>4} {'R0':>4} {'P':>3} "
          f"{'measured I/Os':>14} {'2(N/B)(1+P)':>13} {'ratio':>6}")
    for (N, M, B, k) in [(48, 8, 2, 2), (200, 20, 4, 3), (500, 25, 5, 4)]:
        data = [random.randint(0, 10**6) for _ in range(N)]
        out, _, passes, disk = external_sort(list(data), M, B, k)   # from Task 1
        assert out == sorted(data), "sort must be correct before counting I/Os"
        R0 = math.ceil(N / M)
        P = passes - 1
        predicted = 2 * math.ceil(N / B) * (1 + P)
        ratio = disk.ios / predicted
        print(f"{N:>6} {M:>5} {B:>4} {k:>4} {R0:>4} {P:>3} "
              f"{disk.ios:>14} {predicted:>13} {ratio:>6.2f}")
        assert 0.5 <= ratio <= 1.6, "measured I/Os must match 2(N/B)(1+P) within a constant"
    print("\nOK: total I/Os = 2(N/B)(1+P) = Theta((N/B) log_k (N/M))")
```

- **Constraints:** The output must be sorted (correctness gates the I/O claim). Count a run of `L` records as `⌈L/B⌉` reads and `⌈L/B⌉` writes. The small constant slack comes from `⌈·⌉` rounding and the last partial run / carried runs in odd-sized merge groups.
- **Hint:** Every pass reads each record once and writes it once: `2N/B` I/Os. With `1 + P` passes the total is `2(N/B)(1 + P)`. If your ratio drifts well above `~1.5`, you are likely re-reading runs you already merged, or your carry of leftover runs is doing extra block transfers — trace a small case (Task 2) to localize it.
- **Acceptance test:** `out == sorted(data)` and `measured_ios / (2⌈N/B⌉(1+P))` lands in `[0.5, 1.6]` for every `(N, M, B, k)`. The closed form is now measured, not just asserted — `Θ((N/B)·log_k(N/M))` end to end.

---

## Intermediate Tasks

### Task 5 — Replacement selection: average run length `≈ 2M` (the snowplow) **[coding + analysis]**

`[medium]` Simple run formation makes runs of length exactly `M`. **Replacement selection** does better: keep a **min-heap** of `M` records; repeatedly output the smallest record that is `≥` the last one written (extending the current run), and refill the heap from the input. A record smaller than the last output cannot join this run, so it is held back (marked) for the *next* run. On **random** input this produces runs of **average length `2M`** — halving the number of initial runs — and on **already-sorted** input it produces a **single run** of length `N`.

Implement it, and empirically confirm both: average run `≈ 2M` on random data, one run on sorted data.

#### Python

```python
import heapq, random

def replacement_selection(data, M):
    """Min-heap run formation. Returns the list of run lengths produced.
    Heap entries are (key, run_tag): run_tag distinguishes current run (0) from
    held-back records destined for the next run (1)."""
    it = iter(data)
    heap = []
    for _ in range(M):                       # fill memory with M records
        try:
            heap.append((next(it), 0))
        except StopIteration:
            break
    heapq.heapify(heap)

    run_lengths = []
    cur_len = 0
    last_out = None
    while heap:
        # Smallest record in the *current* run (tag 0) sorts before any tag-1 record.
        key, tag = heapq.heappop(heap)
        if tag == 1:                         # current run exhausted; start a new run
            if cur_len:
                run_lengths.append(cur_len)
            cur_len = 0
            last_out = None
            # Re-tag every held-back record as current-run (tag 0).
            heap = [(k, 0) for (k, _) in heap]
            heapq.heapify(heap)
            key, tag = heapq.heappop(heap)
        # Output `key`, extending the current run.
        cur_len += 1
        last_out = key
        try:
            nxt = next(it)
            # Goes to this run if >= last_out, else held back for the next run.
            heapq.heappush(heap, (nxt, 0 if nxt >= last_out else 1))
        except StopIteration:
            pass
    if cur_len:
        run_lengths.append(cur_len)
    return run_lengths

if __name__ == "__main__":
    random.seed(2)
    M = 1000
    # Random input: average run length should be ~2M.
    rnd = [random.randint(0, 10**9) for _ in range(200_000)]
    rl = replacement_selection(rnd, M)
    avg = sum(rl) / len(rl)
    simple_runs = -(-len(rnd) // M)                       # ceil(N/M)
    print(f"random  N={len(rnd)} M={M}: runs={len(rl)} avg_len={avg:.0f} "
          f"(~2M={2*M})  vs simple runs={simple_runs}")
    assert 1.7 * M <= avg <= 2.3 * M, "random average run length should be ~2M"
    assert len(rl) < simple_runs, "replacement selection makes fewer runs"

    # Sorted input: a single run of length N.
    srt = list(range(200_000))
    rl2 = replacement_selection(srt, M)
    print(f"sorted  N={len(srt)} M={M}: runs={len(rl2)} (expect 1), len={rl2[0]}")
    assert len(rl2) == 1 and rl2[0] == len(srt), "sorted input -> one run"
    print("OK: replacement selection -> avg run ~2M (random), 1 run (sorted)")
```

- **Analysis to write (the snowplow argument):** Picture a snowplow on a circular road and snow falling uniformly. The plow (the output pointer) moves around the circle clearing snow (records `≥` last output); meanwhile new snow (new records) falls uniformly across the whole circle. In steady state the plow always faces a "wall" of snow that fell *behind* it — exactly `M` records of memory in front, plus the `M` records that fell *into the region already cleared* during one lap, which join the current run. Over one full lap the plow clears `2M` records: the `M` resident plus the `M` that arrive in time. Hence the **expected run length is `2M`** on random input. On sorted input *every* new record is `≥` the last output, so nothing is ever held back — the run never ends and grows to length `N`.
- **Constraints:** Use a single min-heap of capacity `M` with a tag marking records held for the next run; a held record sorts *after* all current-run records. When the heap holds only next-run records, end the run and promote them. Verify `1.7M ≤ avg ≤ 2.3M` on random input and exactly one run on sorted input.
- **Acceptance test:** Random input yields average run length `≈ 2M` and strictly fewer runs than simple `⌈N/M⌉` formation; sorted input yields a single run of length `N`. Halving the initial run count can shave a merge pass (Task 8) for free.

---

### Task 6 — `(M/B − 1)`-way merge with a loser tree: `O(log k)` per record **[coding]**

`[medium]` A `k`-way merge repeatedly emits the smallest of `k` run heads. A linear scan over the heads costs `O(k)` per record; a **loser tree** (a complete binary tournament tree over the `k` heads) finds and replaces the minimum in `O(log k)`. This matters precisely because external sorting *wants* `k` large (`k = ⌊M/B⌋ − 1`, often thousands). Implement the merge with a loser tree, drive it through the `Disk`, and confirm: (a) the output is correct, (b) the fan-in obeys `k = ⌊M/B⌋ − 1`, (c) total I/Os match `2(N/B)(1 + P)`.

#### Python

```python
import math, random

class LoserTree:
    """Tournament tree of k players (run heads). The root holds the overall winner
    (minimum); internal nodes hold the LOSER of each match. Update is O(log k)."""
    def __init__(self, keys):
        self.k = len(keys)
        self.keys = list(keys)                  # current head key per run (None = exhausted)
        self.tree = [-1] * self.k               # internal nodes: index of loser run
        self.winner = -1
        if self.k:
            self._build()

    def _less(self, a, b):                       # run a beats run b?
        if self.keys[a] is None: return False
        if self.keys[b] is None: return True
        return self.keys[a] < self.keys[b]

    def _build(self):
        for s in range(self.k):                  # play each leaf up to the root
            self._adjust(s)
        self.winner = self.tree[0] if self.k > 1 else 0
        if self.k == 1:
            self.winner = 0

    def _adjust(self, s):
        parent = (s + self.k) // 2
        while parent > 0:
            if self.tree[parent] == -1 or self._less(self.tree[parent], s):
                self.tree[parent], s = s, self.tree[parent]   # store loser, carry winner up
            parent //= 2
        self.tree[0] = s
        self.winner = s

    def pop_winner(self):
        return self.winner

    def replace_winner(self, key):
        self.keys[self.winner] = key             # feed next head of the winning run
        self._adjust(self.winner)

def kway_merge_loser_tree(runs):
    """runs: list of sorted lists. Returns the merged sorted list using a loser tree."""
    if not runs:
        return []
    if len(runs) == 1:
        return list(runs[0])
    pos = [0] * len(runs)
    heads = []
    for i, r in enumerate(runs):
        heads.append(r[0] if r else None)
    lt = LoserTree(heads)
    out = []
    remaining = sum(len(r) for r in runs)
    while remaining > 0:
        w = lt.pop_winner()
        if lt.keys[w] is None:
            break
        out.append(lt.keys[w])
        remaining -= 1
        pos[w] += 1
        nxt = runs[w][pos[w]] if pos[w] < len(runs[w]) else None
        lt.replace_winner(nxt)
    return out

def external_sort_loser(data, M, B):
    disk = Disk(B)                               # from Task 1
    k = max(2, M // B - 1)                        # fan-in = floor(M/B) - 1
    runs = form_runs(data, M, disk)              # from Task 1
    passes = 1
    while len(runs) > 1:
        new_runs = []
        for i in range(0, len(runs), k):
            group = [disk.read_run(r) for r in runs[i:i + k]]
            merged = kway_merge_loser_tree(group)
            new_runs.append(disk.write_run(merged))
        runs = new_runs
        passes += 1
    out = disk.read_run(runs[0]) if runs else []
    return out, passes, k, disk

if __name__ == "__main__":
    random.seed(3)
    for (N, M, B) in [(4096, 256, 16), (8192, 512, 32), (16384, 1024, 64)]:
        data = [random.randint(0, 10**9) for _ in range(N)]
        out, passes, k, disk = external_sort_loser(list(data), M, B)
        assert out == sorted(data), "loser-tree external sort must be correct"
        R0 = math.ceil(N / M)
        P = passes - 1
        predicted = 2 * math.ceil(N / B) * (1 + P)
        ratio = disk.ios / predicted
        print(f"N={N:6d} M={M:5d} B={B:3d}  k=M/B-1={k:3d}  R0={R0:3d}  P={P}  "
              f"I/Os={disk.ios:7d}  pred~{predicted:7d}  ratio={ratio:.2f}")
        assert k == M // B - 1
        assert 0.5 <= ratio <= 1.6
    print("OK: (M/B-1)-way loser-tree merge; I/Os = Theta((N/B) log_{M/B}(N/B))")
```

- **Constraints:** The fan-in must be exactly `k = ⌊M/B⌋ − 1` — one block buffer per input run plus one output block, `k + 1 ≤ M/B`. The loser tree must find and replace the minimum in `O(log k)` per record (no `O(k)` linear scan). The output must be sorted, and the I/O total must match `2(N/B)(1 + P)`.
- **Hint:** In a loser tree the *leaves* are the `k` runs; each *internal node* stores the **loser** of the match played beneath it, and the overall **winner** (minimum) sits at the root's sentinel. To advance, feed the next head of the winning run and re-play only the `O(log k)` matches along that leaf-to-root path — every other match result is unchanged. An exhausted run's head is `+∞` (here `None`), so it loses every match.
- **Acceptance test:** Output sorted; fan-in `k == ⌊M/B⌋ − 1`; the merge emits records in `O(log k)` each; total I/Os within `[0.5, 1.6]·2(N/B)(1+P)`. The large-`k` merge is now both correct and cheap per record — the workhorse of every real external sort.

---

### Task 7 — Why the base is `M/B`, not `M`: the fan-in is *blocks*, not records **[coding + analysis]**

`[medium]` The single most common external-sort error is believing the fan-in is `M` (records that fit). It is `Θ(M/B)` — **blocks** that fit — because each input run must keep a full **block** buffered in memory, not a single record, or every record read would cost its own I/O and destroy the bound. Demonstrate that `k = ⌊M/B⌋ − 1` is feasible and `k = ⌊M/B⌋` is **infeasible** (the buffers overflow memory), and that with proper block buffering the merge cost is `2·(total)/B` independent of `k`.

#### Python

```python
import math

def merge_feasible_and_ios(run_len, B, M, k):
    """Merge k runs of length run_len, one block (B records) buffered per run plus
    one output block. Returns (feasible, ios)."""
    blocks_needed = k + 1                        # k input buffers + 1 output buffer
    if blocks_needed > M // B:
        return (False, None)                     # buffers do not fit in memory
    total = k * run_len
    # With block buffering each input record is read once and each output written once.
    ios = math.ceil(total / B) + math.ceil(total / B)
    return (True, ios)

if __name__ == "__main__":
    B, M, run_len = 64, 64 * 8, 4096             # memory holds M//B = 8 blocks
    max_fanin = M // B - 1                        # = 7
    print(f"M={M} B={B}  blocks in memory = {M//B}  max fan-in = M/B - 1 = {max_fanin}")
    for k in (2, 4, 7, 8, 16):
        feasible, ios = merge_feasible_and_ios(run_len, B, M, k)
        if feasible:
            ideal = 2 * math.ceil(k * run_len / B)
            print(f"  k={k:2d}: feasible   I/Os={ios:6d}  ideal={ideal:6d}  "
                  f"match={ios == ideal}")
        else:
            print(f"  k={k:2d}: INFEASIBLE — needs {k+1} blocks > {M//B} in memory")
    assert merge_feasible_and_ios(run_len, B, M, max_fanin + 1)[0] is False
    print(f"OK: fan-in capped at M/B - 1 = {max_fanin}; one BLOCK per run, not one record")
```

- **Analysis to write:** A `k`-way merge advances by repeatedly taking the smallest run head. If you buffered a single *record* per run, fetching the next record from a run would trigger an I/O — so merging `k·L` records would cost `Θ(k·L)` I/Os, a full `B`-factor worse, collapsing the merge back to record-at-a-time and destroying the bound. Buffering a full **block** per run amortizes one read over `B` records, so a run of length `L` costs `L/B` reads regardless of `k`. But `k` input buffers plus one output buffer occupy `k + 1` blocks, which must fit in `M/B` blocks: `k ≤ ⌊M/B⌋ − 1`. Hence the fan-in is `Θ(M/B)`, and the sort logarithm has base `M/B` — *not* `M` (which ignores block buffering) and *not* `2` (which ignores large memory).
- **Constraints:** Each run gets exactly one block-sized buffer; the output gets one more. Show `k = M/B − 1` feasible and `k = M/B` (and beyond) infeasible. With correct buffering the merge cost is `2·(total)/B`, independent of `k`.
- **Acceptance test:** For feasible `k`, I/Os `= 2⌈k·run_len/B⌉`; fan-in `k + 1 > M/B` is rejected. This nails *why* the base of `sort(N)`'s logarithm is `M/B`.

---

### Task 8 — Compute passes by hand for big `(N, M, B)`; confirm with code **[analysis + coding]**

`[medium]` Derive the pass count and I/O total for realistic parameters *by hand*, then confirm the code agrees — and see why external sort takes only **1–3 passes** at any scale because the fan-in `M/B` is enormous.

> **Derive first, then check with the loser-tree sort's pass counter.**

**Model derivation.**

```
Run formation:  R0 = ceil(N/M) initial runs (or ~N/(2M) with replacement selection).
Fan-in:         k  = floor(M/B) - 1 = Theta(M/B).
Merge passes:   P  = ceil(log_k R0) = ceil(log_{M/B}(N/M)).
Total passes:   1 + P.
Total I/Os:     2(N/B)(1 + P) = Theta((N/B) log_{M/B}(N/B)).
```

**Worked example.** `N = 10⁹`, `M = 10⁷`, `B = 10³` (so `M/B = 10⁴`, `N/B = 10⁶`):

```
R0 = N/M = 100 runs.
k  = M/B - 1 ~ 10^4.
P  = ceil(log_{10^4} 100) = ceil(0.5) = 1 merge pass.
Total I/Os = 2 * 10^6 * (1 + 1) = 4 * 10^6.
```

A **billion records sort in two passes** over disk — run formation plus a single merge — because the fan-in `10⁴` collapses `100` runs to one in a single pass. Replacement selection would make `R₀ ≈ 50` runs, still `P = 1`: no pass saved here, but at `N = 10¹²` halving `R₀` can drop `P` from `2` to `1`.

#### Python

```python
import math

def predict(N, M, B, repl_selection=False):
    R0 = math.ceil(N / (2 * M)) if repl_selection else math.ceil(N / M)
    k = max(2, M // B - 1)
    P = math.ceil(math.log(R0, k)) if R0 > 1 else 0
    ios = 2 * math.ceil(N / B) * (1 + P)
    return R0, k, P, ios

if __name__ == "__main__":
    print(f"{'N':>12} {'M':>10} {'B':>6} {'M/B':>7} {'R0':>5} "
          f"{'P':>3} {'1+P':>4} {'total I/Os':>14}")
    for (N, M, B) in [(10**9, 10**7, 10**3), (10**12, 10**7, 10**3),
                      (10**12, 10**8, 10**3), (10**15, 10**9, 4096)]:
        R0, k, P, ios = predict(N, M, B)
        print(f"{N:>12} {M:>10} {B:>6} {M//B:>7} {R0:>5} {P:>3} {1+P:>4} {ios:>14}")
        assert P <= 3, "fan-in M/B keeps the pass count tiny even at petabyte scale"
    print("\nOK: 1-3 passes for any realistic N; the M/B base is the whole point")
```

- **Constraints:** Derive `R₀`, `k = ⌊M/B⌋ − 1`, `P = ⌈log_{M/B}(N/M)⌉`, and total `= 2(N/B)(1 + P)` by hand for at least one `(N, M, B)`, then confirm with the predictor. Explain why `P` stays `1`–`3`.
- **Hint:** With `M/B = 10⁴`, one pass shrinks the run count by `10⁴×`. Even `N = 10¹⁵` over `M = 10⁹` gives `R₀ = 10⁶` runs and `⌈log_{10⁶}(10⁶)⌉ ≈ 1`–`2` passes — versus `⌈log₂ 10⁶⌉ = 20` binary-merge passes. The fan-in is the entire reason external sort is feasible at scale.
- **Acceptance test:** The hand-derived `R₀`, `P`, and I/O total match the predictor for the chosen `(N, M, B)`, and `P` stays `1`–`3` across `N` up to `10¹⁵`. The base-`M/B` logarithm keeps external sort to a handful of passes.

---

## Advanced Tasks

### Task 9 — Distribution (sample) sort: same `sort(N)` bound, top-down **[coding + analysis]**

`[hard]` Merge sort is *bottom-up*: form runs, then merge. **Distribution sort** is the *top-down* dual: pick `√(M/B)` **splitter** keys (by sampling), **partition** the input into `√(M/B) + 1` buckets each smaller than the previous, and **recurse** until a bucket fits in memory. With a fan-out of `√(M/B)`, the recursion has depth `Θ(log_{M/B}(N/M))` and each level is one scan — the **same `Θ((N/B)·log_{M/B}(N/B))` bound** as merge sort, approached from the other side. Implement it on the `Disk`, count I/Os, and compare to the loser-tree merge sort.

#### Python

```python
import math, random, bisect

def distribution_sort(data, M, B, disk, depth=0):
    """Partition by sqrt(M/B) splitters and recurse; base case sorts in memory."""
    N = len(data)
    if N <= M:                                    # fits in memory: sort directly
        disk.reads += math.ceil(N / B)            # read the bucket
        disk.writes += math.ceil(N / B)           # write it sorted
        return sorted(data)

    fanout = max(2, int(math.isqrt(max(1, M // B))))   # ~sqrt(M/B) buckets-1 splitters
    # Sample splitters: oversample, sort, pick evenly spaced separators.
    sample = random.sample(data, min(len(data), fanout * 16))
    sample.sort()
    splitters = [sample[(i + 1) * len(sample) // (fanout + 1)] for i in range(fanout)]

    # One scan to partition (read all, write each bucket).
    disk.reads += math.ceil(N / B)
    buckets = [[] for _ in range(fanout + 1)]
    for x in data:
        buckets[bisect.bisect_right(splitters, x)].append(x)
    for b in buckets:
        disk.writes += math.ceil(len(b) / B)      # write each bucket out

    out = []
    for b in buckets:
        out.extend(distribution_sort(b, M, B, disk, depth + 1) if b else [])
    return out

if __name__ == "__main__":
    random.seed(4)
    print(f"{'N':>7} {'M':>6} {'B':>4} {'dist I/Os':>11} {'merge I/Os':>11} {'ratio':>6}")
    for (N, M, B) in [(8192, 256, 16), (16384, 512, 32), (32768, 1024, 64)]:
        data = [random.randint(0, 10**9) for _ in range(N)]
        disk_d = Disk(B)                           # from Task 1
        out = distribution_sort(list(data), M, B, disk_d)
        assert out == sorted(data), "distribution sort must be correct"
        _, _, _, disk_m = external_sort_loser(list(data), M, B)   # from Task 6
        ratio = disk_d.ios / disk_m.ios
        print(f"{N:>7} {M:>6} {B:>4} {disk_d.ios:>11} {disk_m.ios:>11} {ratio:>6.2f}")
        assert 0.3 <= ratio <= 3.0, "both achieve Theta(sort(N)); within a constant factor"
    print("\nOK: distribution sort matches merge sort's Theta((N/B) log_{M/B}(N/B))")
```

- **Analysis to write:** Distribution sort partitions `N` records into `f + 1` buckets with `f = Θ(√(M/B))` splitters. Why `√(M/B)` and not `M/B`? During partitioning you must hold one output **block** per bucket *plus* the structure to route each record — and to make the recursion analysis clean, the per-level work and the depth must both be controlled: with fanout `f = √(M/B)`, the recursion depth to shrink `N/M` buckets to size `1` is `log_f(N/M) = 2·log_{M/B}(N/M) = Θ(log_{M/B}(N/M))`, and each level scans all `N` records once `= Θ(N/B)` I/Os. Total `= Θ((N/B)·log_{M/B}(N/B))` — identical to merge sort. The two are duals: merge sort does the comparison work on the way *up* (merging), distribution sort on the way *down* (partitioning). The constant differs (partition quality depends on splitter sampling), but the asymptotic bound is the same.
- **Constraints:** Use `f ≈ √(M/B)` splitters chosen by **oversampling** (sample `≫ f` keys, sort, pick evenly spaced separators) so buckets are roughly balanced. Recurse until a bucket fits in `M`; the base case sorts in memory. Count one read + one write of every record per recursion level.
- **Acceptance test:** Output sorted; distribution-sort I/Os within a constant factor (`[0.3, 3.0]`) of the loser-tree merge sort's. Both realize `Θ(sort(N))` — the bound is intrinsic to the problem, not to the merge-vs-distribute choice.

---

### Task 10 — Memory split: fan-in vs read-ahead buffering — find the I/O sweet spot **[coding + analysis]**

`[hard]` Memory `M/B` blocks must be *divided*: more blocks spent on **fan-in** (`k` input runs) mean fewer passes, but spending blocks on **read-ahead / double buffering** per run lets I/O overlap with merging (and smooths device access). The naive choice `k = M/B − 1` maximizes fan-in but leaves *one block* per run — no read-ahead. Model the trade-off: split `M/B` blocks as `k` runs × `d` buffers each (`k·d + 1 ≤ M/B`), and find the allocation minimizing passes while keeping enough read-ahead to overlap I/O.

#### Python

```python
import math

def passes_for_fanin(N, M, B, k):
    R0 = math.ceil(N / M)
    return math.ceil(math.log(R0, max(2, k))) if R0 > 1 else 0

def evaluate_split(N, M, B, d):
    """Allocate d read-ahead blocks per run; fan-in k = floor((M/B - 1) / d)."""
    blocks = M // B
    k = max(2, (blocks - 1) // d)                 # reserve 1 output block, d per run
    P = passes_for_fanin(N, M, B, k)
    total_ios = 2 * math.ceil(N / B) * (1 + P)
    return k, P, total_ios

if __name__ == "__main__":
    N, M, B = 10**9, 1 << 16, 1 << 9              # M/B = 128 blocks
    print(f"N={N} M={M} B={B}  blocks in memory = {M//B}")
    print(f"{'d (buffers/run)':>16} {'fan-in k':>9} {'passes P':>9} "
          f"{'total I/Os':>13} {'read-ahead':>11}")
    for d in (1, 2, 4, 8, 16):
        k, P, ios = evaluate_split(N, M, B, d)
        note = "none" if d == 1 else f"{d}-deep overlap"
        print(f"{d:>16} {k:>9} {P:>9} {ios:>13} {note:>11}")
    print("\nLesson: passes depend on floor(log_{k} R0); doubling d roughly halves k,")
    print("which only adds a pass once k drops below R0^(1/P). Buy read-ahead until it costs a pass.")
```

- **Analysis to write:** Passes depend on fan-in only through the **discrete** `P = ⌈log_k R₀⌉`. Halving `k` (to buy `d = 2` read-ahead) often leaves `P` unchanged — `⌈log_{64} R₀⌉ = ⌈log_{128} R₀⌉` whenever `R₀` is small — so you get overlap *for free*. The allocation only costs a pass once `k` drops below `R₀^{1/P}`. The practical rule: **spend memory on read-ahead/double-buffering up to the point where reducing `k` would force an extra merge pass; past that point, fan-in wins.** Read-ahead matters because a single block per run gives no chance to overlap the next block's transfer with merging the current one, leaving the CPU idle on every block boundary; `d = 2` (double buffering) hides the read latency entirely when compute ≈ I/O time.
- **Constraints:** Honor `k·d + 1 ≤ M/B` (each of `k` runs gets `d` buffers, plus one output block). Sweep `d`, report fan-in, passes, and total I/Os, and identify the largest `d` that does **not** increase `P`.
- **Acceptance test:** The table shows passes flat across small `d` (overlap is free) then rising once `k` falls too far; the chosen split maximizes read-ahead subject to no extra pass. The memory budget is a discrete optimization over the `⌈log_k R₀⌉` step function.

---

### Task 11 — Top-`N` via a bounded heap vs full external sort: I/O comparison **[coding + analysis]**

`[hard]` Many "sort" requests only want the **top `N` (largest/smallest)** records, not a full ordering — `ORDER BY x LIMIT n`. A full external sort costs `Θ((N/B)·log_{M/B}(N/B))`; a **bounded heap** of size `n` makes a *single scan*, keeping only the best `n` seen so far, at `Θ(N/B)` reads and `Θ(n/B)` writes — **one pass**, no merge, when `n ≤ M`. Implement both, count I/Os, and quantify when the bounded heap wins (almost always, for small `n`).

#### Python

```python
import heapq, math, random

def top_n_bounded_heap(data, n, M, B, disk):
    """Single scan keeping the n largest in an n-size min-heap (n <= M)."""
    assert n <= M, "the result set must fit in memory"
    disk.reads += math.ceil(len(data) / B)        # one streaming read of the input
    heap = []
    for x in data:
        if len(heap) < n:
            heapq.heappush(heap, x)
        elif x > heap[0]:
            heapq.heapreplace(heap, x)            # evict the current smallest of the top-n
    result = sorted(heap, reverse=True)
    disk.writes += math.ceil(n / B)               # write the small result set
    return result

if __name__ == "__main__":
    random.seed(5)
    print(f"{'N':>8} {'n':>5} {'M':>6} {'B':>4} "
          f"{'heap I/Os':>10} {'sort I/Os':>10} {'speedup':>8}")
    for (N, n, M, B) in [(10**6, 10, 10**4, 100), (10**6, 100, 10**4, 100),
                         (10**8, 10, 10**5, 1000), (10**8, 1000, 10**5, 1000)]:
        # Heap cost is structural; simulate for the small N, extrapolate the rest.
        if N <= 10**6:
            data = [random.randint(0, 10**9) for _ in range(N)]
            disk = Disk(B)
            res = top_n_bounded_heap(data, n, M, B, disk)
            assert res == sorted(data, reverse=True)[:n], "top-n must be correct"
            heap_ios = disk.ios
        else:
            heap_ios = math.ceil(N / B) + math.ceil(n / B)   # one read + tiny write
        R0 = math.ceil(N / M)
        k = max(2, M // B - 1)
        P = math.ceil(math.log(R0, k)) if R0 > 1 else 0
        sort_ios = 2 * math.ceil(N / B) * (1 + P)
        print(f"{N:>8} {n:>5} {M:>6} {B:>4} {heap_ios:>10} {sort_ios:>10} "
              f"{sort_ios / heap_ios:>7.1f}x")
    print("\nOK: bounded heap = 1 read pass (Theta(N/B)); full sort pays the merge passes too")
```

- **Analysis to write:** The bounded heap reads the input **once** (`N/B` I/Os) and writes only the `n`-record result (`n/B` I/Os) — total `Θ(N/B)` when `n ≤ M`, a single pass with **no run formation and no merge**. A full external sort pays `2(N/B)(1 + P)` I/Os to produce a *total* order you then discard all but `n` of. The speedup is therefore `≈ 2(1 + P)` — at least `4×` (when `P = 1`) and growing with `P`. The heap wins because *partial* order is cheaper than *total* order: you never compare, move, or write the `N − n` records you don't want. The only catch is `n > M`: then the result set itself doesn't fit, and you fall back to sort-and-truncate (or a multi-pass selection).
- **Constraints:** The bounded heap keeps the `n` largest in a size-`n` min-heap (replace the root when a bigger element arrives), requiring `n ≤ M`. Count one streaming read of the input plus one small write of the result. Compare against the Task 8 full-sort I/O cost.
- **Acceptance test:** The bounded-heap result equals `sorted(data, reverse=True)[:n]`; its I/O cost is `Θ(N/B)` (one read + tiny write) versus the full sort's `2(N/B)(1 + P)`; the speedup is `≈ 2(1 + P)`. Asking for less order costs strictly fewer I/Os.

---

### Task 12 — External sort of (key, pointer) pairs; verify stability **[coding + analysis]**

`[hard]` Real sorts move **(key, pointer)** pairs (or (key, record-id)), not whole fat records — you sort small keys with a pointer back to the heavy payload, slashing the bytes moved per pass. And callers often need **stability**: equal keys must keep their original input order. Implement an external sort over (key, pointer) pairs that is **stable**, and verify both properties: the pointers come out in key order, and equal keys preserve input order.

#### Python

```python
import math, random

def external_sort_pairs(records, M, B):
    """Sort (key, original_index) pairs stably. The 'pointer' is the original index;
    stability is enforced by sorting on (key, original_index)."""
    disk = Disk(B)                                # from Task 1
    pairs = [(r, i) for i, r in enumerate(records)]   # (key, pointer)
    k = max(2, M // B - 1)

    # Run formation: stable sort on (key, index) keeps ties in input order.
    runs = []
    for lo in range(0, len(pairs), M):
        chunk = sorted(pairs[lo:lo + M], key=lambda p: (p[0], p[1]))
        runs.append(disk.write_run(chunk))

    # Merge passes: a stable k-way merge breaks ties by original index.
    passes = 1
    while len(runs) > 1:
        new_runs = []
        for i in range(0, len(runs), k):
            group = [disk.read_run(r) for r in runs[i:i + k]]
            import heapq
            merged = list(heapq.merge(*group, key=lambda p: (p[0], p[1])))
            new_runs.append(disk.write_run(merged))
        runs = new_runs
        passes += 1
    out = disk.read_run(runs[0]) if runs else []
    return out, passes, disk

if __name__ == "__main__":
    random.seed(6)
    # Many duplicate keys so stability is testable; small key space forces ties.
    N, M, B = 4096, 256, 16
    records = [random.randint(0, 20) for _ in range(N)]
    out, passes, disk = external_sort_pairs(records, M, B)
    keys = [k for (k, ptr) in out]
    assert keys == sorted(records), "keys must come out in sorted order"
    # Stability: among equal keys, original indices must be ascending.
    from itertools import groupby
    for key, grp in groupby(out, key=lambda p: p[0]):
        ptrs = [ptr for (_, ptr) in grp]
        assert ptrs == sorted(ptrs), f"stability violated for key {key}"
    # The pointers reconstruct the original records faithfully.
    assert [records[ptr] for (k, ptr) in out] == [k for (k, ptr) in out]
    print(f"N={N} M={M} B={B}  passes={passes}  I/Os={disk.ios}")
    print("OK: (key,pointer) sort is stable; equal keys keep input order")
```

- **Analysis to write:** Sorting (key, pointer) pairs instead of whole records cuts the **bytes per I/O**: if a record is `R` bytes and a (key, pointer) pair is `p ≪ R` bytes, then more pairs fit per block (effective `B' = B·R/p` records per block), so the sort moves `R/p×` less data — and the final pass can gather the real records via the pointers in one extra scan. **Stability** is *not* automatic in a multiway merge: when two runs present equal keys, the merge must emit the one with the smaller original index first. Carrying the original index as a tiebreaker (`sort on (key, index)`) makes every stage — run formation *and* each merge — a stable operation, so input order among equals survives end to end. Without the index tiebreaker, an arbitrary heap order among equal keys would scramble duplicates.
- **Constraints:** Sort (key, pointer) pairs where the pointer is the original index. Enforce stability by ordering on `(key, original_index)` in **both** run formation and the merge. Use a small key space so duplicates are common and stability is actually exercised. Verify keys are sorted **and** equal keys keep ascending original indices.
- **Acceptance test:** Output keys equal `sorted(records)`; within every equal-key group the original indices are ascending (stable); the pointers faithfully reconstruct the records. Sorting light pairs with a tiebreaker gives a stable, bandwidth-frugal external sort.

---

## Synthesis Task

> Tie the pieces together: simulate disk, form runs (simple and replacement-selection), merge with a loser tree at fan-in `M/B − 1`, count runs / passes / I/Os, and confirm every measured count matches its derived bound — then place external sorting on the external-memory map.

`[capstone]` Carry **external sorting** end to end: run formation (simple and `≈ 2M` replacement selection), the `(M/B − 1)`-way loser-tree merge, the distribution-sort dual, and the `top-N` / stability refinements — each measured against the `sort(N)` bound.

1. **Simulator + simple sort [coding].** Build the `Disk(M, B)` scaffold and external merge sort (Task 1); trace `N = 12, M = 4, B = 2` by hand and confirm `passes = 3`, I/Os `= 36` (Task 2).

2. **Run formation [coding + analysis].** Show simple formation makes `⌈N/M⌉` runs, replacement selection makes average `≈ 2M` runs on random input and one run on sorted input (Task 5) — the snowplow argument.

3. **Merge [coding + analysis].** Implement the `(M/B − 1)`-way loser-tree merge at `O(log k)` per record (Task 6); prove the fan-in is `M/B`, not `M` (Task 7); confirm passes `= ⌈log_{M/B}(N/M)⌉` and I/Os `= 2(N/B)(1 + P)` (Tasks 4, 8).

4. **Distribution dual [coding + analysis].** Show sample/distribution sort hits the **same** `Θ(sort(N))` bound top-down (Task 9), and split memory between fan-in and read-ahead to the I/O sweet spot (Task 10).

5. **Refinements [coding + analysis].** Top-`N` via a bounded heap beats full sort by `≈ 2(1 + P)` (Task 11); a (key, pointer) sort is stable and bandwidth-frugal (Task 12).

Reference harness in **Python** (combines the pieces):

```python
import math, random

def report(N, M, B, repl=False):
    R0 = math.ceil(N / (2 * M)) if repl else math.ceil(N / M)
    k = max(2, M // B - 1)
    P = math.ceil(math.log(R0, k)) if R0 > 1 else 0
    ios = 2 * math.ceil(N / B) * (1 + P)
    return R0, k, P, ios

if __name__ == "__main__":
    print(f"{'N':>12} {'M':>9} {'B':>6} {'M/B':>7} {'R0':>6} {'k':>6} "
          f"{'P':>3} {'total I/Os':>13}")
    for (N, M, B) in [(10**6, 10**4, 100), (10**9, 10**7, 1000),
                      (10**12, 10**8, 1000), (10**15, 10**9, 4096)]:
        R0, k, P, ios = report(N, M, B)
        print(f"{N:>12} {M:>9} {B:>6} {M//B:>7} {R0:>6} {k:>6} {P:>3} {ios:>13}")
        assert k == M // B - 1
        assert ios >= 2 * math.ceil(N / B)         # at least one pass (formation)
        assert P <= 3                              # the M/B base keeps passes tiny
    # Replacement selection halves R0 -> sometimes one fewer pass.
    for (N, M, B) in [(10**12, 10**7, 1000)]:
        _, _, Ps, _ = report(N, M, B, repl=False)
        _, _, Pr, _ = report(N, M, B, repl=True)
        print(f"\nN={N}: simple P={Ps}, replacement-selection P={Pr} "
              f"({'one fewer pass' if Pr < Ps else 'same passes'})")
    print("\nrun formation R0=ceil(N/M) (or ~N/2M); fan-in k=M/B-1; "
          "passes 1+ceil(log_{M/B}(N/M)); total 2(N/B)(1+P) = Theta((N/B) log_{M/B}(N/B))")
```

- **Analysis answer:** Run formation makes `R₀ = ⌈N/M⌉` runs (or `≈ N/(2M)` with replacement selection — the snowplow clears `2M` per lap). The merge fan-in is `k = ⌊M/B⌋ − 1 = Θ(M/B)` because each run buffers a full **block**, not a record; the loser tree emits each output record in `O(log k)`. The pass count is `1 + ⌈log_{M/B}(N/M)⌉`, each pass a full scan in and out (`2N/B`), for total `2(N/B)(1 + P) = Θ((N/B)·log_{M/B}(N/B))` — the canonical `sort(N)` bound, matched top-down by distribution sort. Refinements: read-ahead spends fan-in for overlap up to the pass boundary; top-`N` needs only `Θ(N/B)`; (key, pointer) sorting is stable via an index tiebreaker and moves far fewer bytes.
- **Acceptance test:** Every measured count matches its bound: run formation makes `⌈N/M⌉` runs (`≈ 2M`-average with replacement selection); the merge fan-in is exactly `⌊M/B⌋ − 1` with `O(log k)`-per-record loser-tree output; passes `= 1 + ⌈log_{M/B}(N/M)⌉`; total I/Os within a constant of `2(N/B)(1 + P)`; distribution sort matches the same bound; top-`N` costs `Θ(N/B)`; the pair sort is stable. The write-up places external sorting on the external-memory map — **run formation + multiway merge realizing `sort(N) = Θ((N/B)·log_{M/B}(N/B))`, the fan-in `M/B` keeping it to 1–3 passes at any scale** — mirroring the whole discipline: *form runs, merge with the largest affordable fan-in, count the passes and transfers, derive the bound, and confirm the measured count matches.*

---

## Where to go next

- Revisit the `(M, B)` block-cache simulator, `scan(N) = Θ(N/B)`, and the general `sort(N)` bound that this topic specializes in the [I/O-model tasks](../01-the-io-model/tasks.md).
- See funnelsort achieve the **same** `sort(N)` bound *without knowing `M` or `B`* in the [cache-oblivious-algorithms tasks](../02-cache-oblivious-algorithms/tasks.md).
- For the conceptual treatment of run formation, replacement selection, multiway merge with loser trees, distribution sort, and the `Θ((N/B)·log_{M/B}(N/B))` bound, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
