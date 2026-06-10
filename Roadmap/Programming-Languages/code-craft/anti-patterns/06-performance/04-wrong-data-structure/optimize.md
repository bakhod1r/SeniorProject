# Wrong Data Structure — Optimization Practice

> **Category:** [Performance Anti-Patterns](../README.md) → **Wrong Data Structure** — *a collection whose cost model fights the access pattern.*

---

Unlike [`find-bug.md`](find-bug.md) (spot it) and [`tasks.md`](tasks.md) (fix it), this file is about the **discipline of optimizing**: take code with a wrong-structure hot path, *profile to confirm it's the bottleneck*, swap in the right structure, and **prove the win with before/after big-O AND benchmark numbers** — including the crossover caveat that keeps you honest.

The loop is always the same:

```text
profile  →  identify the structure/access mismatch  →  pick the right structure
        →  benchmark before & after  →  verify the win is real (and scales)
```

> **The rule that governs this whole chapter:** never optimize a structure you haven't profiled. "A map feels faster" is how cold paths get needlessly complicated. Measure, fix the hot scan the profiler points to, measure again. (Illustrative numbers below are labeled — *generate your own on your data and hardware.*)

---

## Table of Contents

1. [Case Study 1 — The Reconciliation Job (Membership Scan)](#case-study-1--the-reconciliation-job-membership-scan)
2. [Case Study 2 — The Scheduler That Re-Sorts (Repeated Min)](#case-study-2--the-scheduler-that-re-sorts-repeated-min)
3. [Case Study 3 — The Crossover Caveat (When the Map Loses)](#case-study-3--the-crossover-caveat-when-the-map-loses)
4. [The Optimization Checklist](#the-optimization-checklist)
5. [Common Mistakes](#common-mistakes)
6. [Summary](#summary)
7. [Related Topics](#related-topics)

---

## Case Study 1 — The Reconciliation Job (Membership Scan)

A nightly job reconciles incoming transactions against a list of already-settled ids. It "got slow" as volume grew — 40 minutes for a run that used to take seconds.

### The code

```go
// Go — flag transactions that haven't already been settled.
func unreconciled(txns []Txn, settled []string) []Txn {
    var out []Txn
    for _, t := range txns {                 // n transactions
        found := false
        for _, id := range settled {         // × m settled ids — linear scan
            if id == t.ID {
                found = true
                break
            }
        }
        if !found {
            out = append(out, t)
        }
    }
    return out
}
```

### Step 1 — Profile (confirm it's the hotspot)

```text
# go test -cpuprofile, then `go tool pprof -top` (illustrative)
      flat  flat%   cum   cum%
   38.40s  96.1%  38.40s  96.1%  pkg.unreconciled   ← almost all time, inner loop
    0.90s   2.3%   0.90s   2.3%  runtime.mallocgc
```

`unreconciled` is 96% of CPU, and the body is a trivial string comparison — *cheap per comparison, enormous in aggregate*. That's the fingerprint of a membership scan inside a loop. Call counts confirm the inner comparison runs ~n·m times.

### Step 2 — Identify the mismatch

The dominant operation is **membership** (`is t.ID in settled?`), done against a **slice** (O(m) scan). With n ≈ 500k transactions and m ≈ 500k settled ids, that's **O(n·m) ≈ 2.5×10¹¹** comparisons.

### Step 3 — Pick the right structure

Membership → **set** (a `map[string]struct{}` in Go), built once.

```go
func unreconciled(txns []Txn, settled []string) []Txn {
    set := make(map[string]struct{}, len(settled))
    for _, id := range settled {             // build once: O(m)
        set[id] = struct{}{}
    }
    out := make([]Txn, 0, len(txns))         // pre-size: avoid regrowth
    for _, t := range txns {                 // O(n)
        if _, ok := set[t.ID]; !ok {         // O(1) average
            out = append(out, t)
        }
    }
    return out
}
```

### Step 4 — Benchmark before & after

```go
func BenchmarkUnreconciled(b *testing.B) {
    txns, settled := genReconData(500_000, 500_000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink = unreconciled(txns, settled)
    }
}
```

```text
# benchstat old.txt new.txt (illustrative, 500k × 500k)
name           old time/op    new time/op    delta
Unreconciled     41.2s ± 2%     0.082s ± 3%   -99.80%

name           old alloc/op   new alloc/op   delta
Unreconciled     12.0MB ± 0%    28.4MB ± 0%   +136%   (the set's memory — the trade)
```

### Step 5 — Verify it's real and scales

| n = m | old (scan) | new (set) | speedup |
|---|---|---|---|
| 50k | 0.41 s | 9 ms | 45× |
| 500k | 41 s | 82 ms | 500× |
| 5M | ~68 min (extrapolated) | 0.9 s | ~4,500× |

**Big-O: O(n·m) → O(n + m).** The speedup *grows with input* — the signature of fixing a quadratic. The cost is the set's memory (+136% here): we spent ~16 MB to turn 40 minutes into 80 milliseconds. That's the **memory-for-time trade**, and it's overwhelmingly worth it. The 40-minute job now runs in under a second, and it gets *relatively* faster as data grows.

---

## Case Study 2 — The Scheduler That Re-Sorts (Repeated Min)

A task scheduler repeatedly pulls the lowest-priority task. Under load, `nextTask` dominates the profile.

### The code

```python
# Python — pull the cheapest task, re-sorting the list every call.
class Scheduler:
    def __init__(self):
        self.tasks = []

    def add(self, task):
        self.tasks.append(task)               # O(1)

    def next_task(self):
        self.tasks.sort(key=lambda t: t.priority)  # O(n log n) EVERY call
        return self.tasks.pop(0)                    # O(n) shift, too
```

### Step 1 — Profile

```text
# py-spy top (illustrative) — under a workload that adds and pulls continuously
 %Own   %Total  Function
 71.0%   78.0%  next_task   (list.sort dominates)
 14.0%   14.0%  add
```

`next_task` is 71% self-time, and inside it `list.sort` is the cost. Re-sorting on every pull is the mismatch.

### Step 2 — Identify the mismatch

The access pattern is **"repeatedly remove the minimum from a changing collection."** Implemented as a **full re-sort per call**: O(n log n) each, plus `pop(0)`'s O(n) shift. Across q pulls of a queue that grows to n, this is roughly O(q · n log n).

### Step 3 — Pick the right structure

Repeated min extraction → **heap (priority queue)**. `heapq` maintains the min at index 0 in O(log n) per push/pop, with no re-sort.

```python
import heapq, itertools

class Scheduler:
    def __init__(self):
        self._heap = []
        self._counter = itertools.count()    # tiebreaker: keeps push O(log n), stable

    def add(self, task):
        heapq.heappush(self._heap, (task.priority, next(self._counter), task))  # O(log n)

    def next_task(self):
        return heapq.heappop(self._heap)[2]  # O(log n); min at the root
```

(The counter avoids comparing `Task` objects when priorities tie — a correctness detail, not a perf one.)

### Step 4 — Benchmark before & after

```text
# pyperf, workload: build a queue of n, then pull all n (illustrative)
n = 100,000:
  re-sort list:   ~52 s     (O(n log n) per pull → ~O(n² log n) to drain)
  heapq:          ~0.13 s   (O(log n) per pull → O(n log n) to drain)
```

| Operation | Re-sort list | Heap |
|---|---|---|
| `add` | O(1) | O(log n) |
| `next_task` | **O(n log n)** | **O(log n)** |
| Drain all n | O(n² log n) | O(n log n) |

### Step 5 — Verify

**Big-O per pull: O(n log n) → O(log n).** The heap is ~400× faster at n=100k here, and the gap widens with n (quadratic vs linearithmic drain). Note `add` went from O(1) to O(log n) — a tiny regression on the cheap operation to make the *expensive, hot* operation dramatically cheaper. That's the right trade because pulls are the bottleneck; always shift cost *toward* the rare operation and *away* from the hot one.

---

## Case Study 3 — The Crossover Caveat (When the Map Loses)

The reflex after Cases 1–2 is "replace every list lookup with a map." This case shows where that reflex is **wrong** — and why you always benchmark the real n.

### The code

A request router checks whether a method is in a small, fixed set on **every request** (a genuinely hot path — millions of calls/sec).

```go
// Go — called per request; n = 3, fixed at compile time.
var bodyMethods = []string{"POST", "PUT", "PATCH"}

func hasBody(method string) bool {
    for _, m := range bodyMethods {     // linear scan of 3
        if m == method {
            return true
        }
    }
    return false
}
```

A well-meaning reviewer says "membership should be O(1) — use a map":

```go
var bodyMethodSet = map[string]struct{}{"POST": {}, "PUT": {}, "PATCH": {}}

func hasBodyMap(method string) bool {
    _, ok := bodyMethodSet[method]      // "O(1)"
    return ok
}
```

### Benchmark — the map *loses*

```text
# go test -bench (illustrative, hot path, worst-case target = last/absent)
BenchmarkHasBody/slice-3      2.1 ns/op    0 allocs/op
BenchmarkHasBody/map-3        9.8 ns/op    0 allocs/op
```

The slice scan is **~4.5× faster** than the map at n=3. Why?

- The map lookup **hashes the string** and indexes a bucket — a fixed ~10 ns cost dominated by the hash and a likely **cache miss** on the bucket.
- The slice scan compares against three short strings sitting in **contiguous, cache-resident memory** — a handful of cheap comparisons, no hashing, no miss.

At n=3 we're far below the **small-n crossover** (~8–32 for short strings — see [`tasks.md` Exercise 6](tasks.md#exercise-6--find-the-small-n-crossover)). The "better big-O" structure has worse *constants* at this size.

### The honest rule

```text
                slice scan          map lookup
  cost  ≈  0.7 · n  ns (scan)   vs   ~10 ns (fixed)
  crossover: where 0.7·n ≈ 10  →  n ≈ 14   (short strings, this hardware)
```

Below the crossover the slice wins; above it the map wins and never looks back. **The optimization here is to keep the slice** and (if anything) hoist the literal to a package var so it isn't rebuilt — *not* to "fix" it into a map.

> **The caveat that keeps every other case study honest:** O(1) is not free; it's "constant, but with a real constant." For provably small, bounded n on a hot path, measure — the linear scan often wins, and converting it is a wrong-structure choice in the opposite direction. Cases 1 and 2 had n in the hundreds of thousands; Case 3 has n=3. The structure that's right depends on the actual n, which is why **the benchmark, not the cost table, casts the final vote.**

---

## The Optimization Checklist

Run this on any suspected wrong-structure hot path:

1. **Profile first.** Confirm the scan/sort is actually hot (cheap-per-call, huge-cumulative is the tell). Don't optimize cold paths.
2. **Name the dominant operation.** Membership? Lookup-by-key? Repeated min? Queue? Join? That names the target structure.
3. **Check the n.** Big (hundreds+)? Swap to the right structure. Small and bounded (single digits to a couple dozen)? Benchmark — a scan may win (Case 3).
4. **Preprocess once.** Build the set/map/heap a single time, *outside* the loop. Building it per iteration keeps the quadratic.
5. **Pre-size when known.** `make(map, n)` / `make([]T, 0, n)` avoids resize/rehash spikes.
6. **Benchmark before & after, at real sizes.** `benchstat`/JMH/`pyperf`; sweep n to confirm the win *scales* (and to find the crossover).
7. **Account for the trade.** Most fixes spend memory for time — record the alloc delta and confirm the budget allows it.

---

## Common Mistakes

1. **Optimizing without a profile.** Converting lists to maps on cold paths adds memory and complexity for no measured gain — premature optimization.
2. **Building the index inside the loop.** The whole win is hoisting the O(n) build *out* of the loop; rebuilding per query keeps O(n·m).
3. **Forgetting the memory trade.** The set/map costs memory; usually worth it (Case 1: 16 MB for a 30,000× speedup), but record it and check the budget.
4. **Cargo-culting "use a map" at small n.** Below the crossover the slice scan is faster and simpler (Case 3). Benchmark bounded-n hot paths instead of assuming.
5. **Eyeballing a single benchmark run.** Use `benchstat` over multiple runs; defeat dead-code elimination (consume the result); warm up the JIT (JMH).
6. **Regressing the hot operation to "fix" a cold one.** Shift cost toward rare operations and away from hot ones (Case 2: `add` went O(1)→O(log n) to make the hot `next_task` O(n log n)→O(log n)).

---

## Summary

- The optimization loop is **profile → identify the mismatch → pick the right structure → benchmark before/after → verify it scales** — and you never skip the profile.
- **Case 1 (membership scan → set):** O(n·m) → O(n + m); 40 minutes → 80 ms, the speedup growing with input. Paid in a modest memory increase — the memory-for-time trade.
- **Case 2 (re-sort → heap):** O(n log n)/pull → O(log n)/pull; ~400× at n=100k. Shifting a little cost onto the cheap `add` to slash the hot `next_task`.
- **Case 3 (the crossover caveat):** at n=3 the "naive" slice scan *beats* the map by 4.5× — O(1) has a real constant, and below the crossover the linear scan wins. The benchmark, not the cost table, casts the final vote.
- The unifying discipline: **name the operation, choose by big-O to rule out disasters, then let a benchmark on the real n and hardware choose the winner** — and record the memory trade you're making.

---

## Related Topics

- [`find-bug.md`](find-bug.md) — spot the mismatches (and the crossover trap) before fixing them.
- [`tasks.md`](tasks.md) — guided fixes with benchmarks; Exercise 6 measures the crossover behind Case 3.
- [`senior.md`](senior.md) · [`professional.md`](professional.md) — profiling the hot scan, cache locality, and the deep constant-factor trade-offs these cases rest on.
- [Premature Optimization Traps → optimize](../01-premature-optimization-traps/optimize.md) — the "measure first" discipline that opens every case here.
- [N+1 in Code → optimize](../02-n-plus-one-in-code/optimize.md) — the I/O analogue: preprocess/batch once instead of per item.
- The `profiling-techniques`, `big-o-analysis`, and `hash-table-design` skills — the measurement and cost-model toolkit behind every number above.
