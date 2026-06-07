# Reservoir Sampling — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code or hints in all three languages. Implement the reservoir-sampling logic and validate against the evaluation criteria.
> **Always validate uniformity empirically: run your sampler many thousands of times and confirm each item's inclusion frequency is close to `k/n` (or the weighted target). A systematic skew — not random jitter — means a bug, usually a wrong draw range or a fixed acceptance probability instead of `k/i`.**

---

## Beginner Tasks (5)

### Task 1 — Single-item reservoir (`k = 1`)

**Problem.** Implement `sampleOne(stream)` that returns one uniformly random item from a stream, using `O(1)` memory and a single pass. Replace the current choice with the `i`-th item with probability `1/i`.

**Input / Output spec.**
- Input: a list of integers (stands in for a stream).
- Output: one integer; over many runs each input element should appear `1/n` of the time.

**Constraints.** `O(1)` extra space; one pass; do not use the length to pick a random index.

**Hint.** For the `i`-th item (1-based), replace `chosen` if `randInt(1, i) == 1`.

**Starter — Go.**
```go
package main

import "fmt"

func sampleOne(stream []int) int {
	// TODO: replace chosen with stream[i] with probability 1/(i+1)
	return 0
}

func main() { fmt.Println(sampleOne([]int{1, 2, 3, 4})) }
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int sampleOne(int[] stream) {
        // TODO: replace chosen with stream[i] with probability 1/(i+1)
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(sampleOne(new int[]{1, 2, 3, 4}));
    }
}
```

**Starter — Python.**
```python
import random


def sample_one(stream):
    # TODO: replace chosen with the i-th item with probability 1/i
    return None


if __name__ == "__main__":
    print(sample_one([1, 2, 3, 4]))
```

**Evaluation criteria.**
- Uses `O(1)` memory and exactly one pass.
- Over 100k runs, each of the `n` items appears within ~1% of `1/n`.
- Handles a single-element stream (returns that element) and an empty stream (returns a sentinel/None).

---

### Task 2 — Algorithm R for general `k`

**Problem.** Implement `reservoirSample(stream, k)` returning a uniform `k`-subset using Algorithm R: fill `k`, then keep the `i`-th item with probability `k/i`, evicting a uniformly random slot.

**Input / Output spec.**
- Input: a list of integers and an integer `k`.
- Output: a list of `k` integers (or all items if `n < k`).

**Constraints.** `O(k)` extra space; one pass.

**Hint.** 0-based: `j = randInt(0, i)`; if `j < k`, set `R[j] = item`.

**Starter — Go.**
```go
func reservoirSample(stream []int, k int) []int {
	// TODO
	return nil
}
```

**Starter — Java.**
```java
static int[] reservoirSample(int[] stream, int k) {
    // TODO
    return new int[0];
}
```

**Starter — Python.**
```python
def reservoir_sample(stream, k):
    # TODO
    return []
```

**Evaluation criteria.**
- Returns exactly `k` items when `n ≥ k`, all items when `n < k`.
- Over many runs, each item's inclusion frequency ≈ `k/n`.
- Uses `O(k)` memory regardless of `n`.

---

### Task 3 — Uniformity histogram

**Problem.** Write `checkUniformity(n, k, trials)` that runs your `reservoirSample(range(n), k)` `trials` times, counts how often each item `0..n-1` appears, and prints a count per item. Each count should be near `trials·k/n`.

**Input / Output spec.**
- Input: `n`, `k`, `trials`.
- Output: print `n` lines `item: count`.

**Constraints.** Reuse Task 2's sampler.

**Hint.** Expected per item = `trials·k/n`. Eyeball that all counts are within a few percent.

**Starter — Python.**
```python
from collections import Counter


def check_uniformity(n, k, trials=100_000):
    counts = Counter()
    for _ in range(trials):
        for item in reservoir_sample(range(n), k):
            counts[item] += 1
    expected = trials * k / n
    print(f"expected per item ≈ {expected:.0f}")
    for item in range(n):
        print(f"{item}: {counts[item]}")
```

(Implement the Go and Java equivalents with an int array of counts.)

**Evaluation criteria.**
- All counts within ~2% of `trials·k/n` for `n = 6, k = 2, trials = 100k`.
- Detects a deliberately broken sampler (e.g. one drawing `j` from `[0, k)`).
- Works in all three languages.

---

### Task 4 — Stream from an iterator (no materialization)

**Problem.** Implement the sampler so it consumes a true iterator/generator and never builds a list of all items. Prove (by construction) that memory stays `O(k)`.

**Input / Output spec.**
- Input: an iterator yielding items and `k`.
- Output: a list of `k` sampled items.

**Constraints.** Must not call `list(stream)` or otherwise store all items.

**Hint.** Keep a running index `i` as you iterate; the logic is identical to Task 2 but driven by `next()` / `range`.

**Starter — Python.**
```python
def reservoir_from_iter(it, k):
    reservoir = []
    for i, item in enumerate(it):
        # TODO: fill phase then replace phase, O(k) memory
        pass
    return reservoir
```

**Evaluation criteria.**
- Works on an infinite generator truncated by the caller (e.g. `itertools.islice`).
- Memory does not grow with the number of items consumed.
- Same uniformity as Task 2.

---

### Task 5 — Handle edge cases

**Problem.** Harden `reservoirSample(stream, k)` to correctly handle `k = 0` (return empty), `n = 0` (return empty), `n < k` (return all), and `n = k` (return all, no replace step). Add assertions/tests for each.

**Input / Output spec.**
- Input: various `(stream, k)` including the degenerate cases.
- Output: the correct sample for each case.

**Constraints.** No crashes, no index-out-of-bounds, no division by zero.

**Hint.** Guard `k <= 0` and an empty stream before the loop; the fill phase naturally handles `n ≤ k`.

**Evaluation criteria.**
- `k = 0` → `[]`; `n = 0` → `[]`; `n < k` → all items; `n = k` → all items.
- No exceptions on any degenerate input.
- Implemented and tested in all three languages.

---

## Intermediate Tasks (5)

### Task 6 — Algorithm L (skip-based)

**Problem.** Implement `reservoirSampleL(stream, k)` using Vitter's Algorithm L. It must produce the same uniform distribution as Algorithm R but use `O(k(1+log(n/k)))` RNG calls.

**Input / Output spec.**
- Input: a list (or iterator) and `k`.
- Output: a uniform `k`-subset.

**Constraints.** Same distribution as Algorithm R; far fewer RNG calls.

**Hint.**
```text
W = exp(log(random()) / k)
loop:
    skip = floor(log(random()) / log(1 - W))
    advance i by skip + 1; if past end, stop
    reservoir[randInt(0, k-1)] = item_i
    W *= exp(log(random()) / k)
```

**Starter — Python.**
```python
import math, random


def reservoir_sample_l(items, k):
    items = list(items)
    n = len(items)
    if n <= k:
        return items[:]
    reservoir = items[:k]
    # TODO: implement the skip loop
    return reservoir
```

**Evaluation criteria.**
- Uniformity matches Algorithm R (validate with Task 3's histogram).
- Counts RNG calls and shows the `O(k log(n/k))` scaling vs Algorithm R's `O(n)`.
- Short-circuits `n ≤ k`.

---

### Task 7 — Weighted reservoir sampling (A-Res)

**Problem.** Implement `weightedSample(items, weights, k)` using keys `u^(1/w)` and a size-`k` min-heap, returning a weighted `k`-subset without replacement.

**Input / Output spec.**
- Input: `items`, `weights` (all `> 0`), `k`.
- Output: `k` items, heavier items appearing more often.

**Constraints.** `O(k)` memory; one pass; `O(log k)` per item.

**Hint.** Use log-space keys `log(u)/w` to avoid underflow; keep the largest keys in a min-heap.

**Starter — Python.**
```python
import heapq, math, random


def weighted_sample(items, weights, k):
    heap = []
    for it, w in zip(items, weights):
        # TODO: key = log(random())/w ; maintain top-k min-heap
        pass
    return [item for _, item in heap]
```

**Evaluation criteria.**
- For `k = 1` and weights `[1, 1, 4]`, item 3 is chosen ≈ `4/6` of the time.
- Rejects/handles `w <= 0`.
- Uses log-space keys (no underflow for large weights).

---

### Task 8 — Verify weighted correctness empirically

**Problem.** For `k = 1`, run `weightedSample` many times and confirm each item's selection frequency matches `w_i / Σw`. Print observed vs expected per item.

**Input / Output spec.**
- Input: `items`, `weights`, `trials`.
- Output: a table `item | expected w_i/Σw | observed frequency`.

**Constraints.** Reuse Task 7.

**Hint.** Expected for item `i` is `weights[i] / sum(weights)`.

**Evaluation criteria.**
- Observed frequencies within ~1% of `w_i/Σw` over 200k trials.
- Works for skewed weights (e.g. `[1, 1, 1, 50]`).
- Implemented in all three languages.

---

### Task 9 — Count-weighted merge of two reservoirs

**Problem.** Implement `merge(R_A, c_A, R_B, c_B, k)` that combines two per-shard reservoirs (with their counts) into a uniform `k`-sample of the combined population. Pick each output slot from a shard with probability proportional to its count.

**Input / Output spec.**
- Input: two reservoirs and their counts `c_A`, `c_B`, and `k`.
- Output: a uniform `k`-sample and the combined count `c_A + c_B`.

**Constraints.** Must weight by counts; output exactly `k`.

**Hint.** Shuffle each side, then for each slot take from A with probability `c_A/(c_A+c_B)`, sampling without replacement within each side.

**Evaluation criteria.**
- A shard with 100× the count contributes ~100× as many items (verify empirically).
- Output is exactly `k` (when `|R_A|+|R_B| ≥ k`).
- A plain concatenation/uniform-pick is shown to bias toward the small shard (counter-example test).

---

### Task 10 — Sampling without buffering, with a value field

**Problem.** Sample `k` records uniformly and use them to estimate the mean of a numeric field, returning both the sample and the estimate `μ̂ = (1/k)Σ value`. Confirm `E[μ̂]` ≈ population mean.

**Input / Output spec.**
- Input: a stream of `(id, value)` records and `k`.
- Output: a `k`-sample and `μ̂`.

**Constraints.** `O(k)` memory; one pass.

**Hint.** Reuse Task 2's reservoir over records; average the `value` of sampled records.

**Evaluation criteria.**
- `μ̂` is unbiased: averaged over many runs it converges to the true mean.
- Variance shrinks as `k` grows (demonstrate with two `k` values).
- Works in all three languages.

---

## Advanced Tasks (5)

### Task 11 — Forward-decay (recency-biased) sampling

**Problem.** Implement time-biased reservoir sampling where an item arriving at time `t` gets weight `e^(λ·t)`, so recent items dominate. Use weighted reservoir sampling (A-Res) with log-space keys, and rebase the time origin periodically to avoid overflow.

**Input / Output spec.**
- Input: a stream of `(item, timestamp)`, decay rate `λ`, and `k`.
- Output: a `k`-sample biased toward recent items.

**Constraints.** `O(k)` memory; handle the unbounded growth of `e^(λt)` via landmark rebasing.

**Hint.** In log-space the key is `log(u)/e^(λt)` — but better, work with `log(u)·e^(-λt)` or track a moving landmark `t0` and use `e^(λ(t - t0))`. Periodically advance `t0` and rescale stored keys.

**Evaluation criteria.**
- Recent items are over-represented in proportion to `e^(λt)`.
- No floating-point overflow over a long stream (landmark rebasing works).
- Reduces to uniform sampling as `λ → 0`.

---

### Task 12 — Distributed reservoir over shards (hierarchical merge)

**Problem.** Simulate `m` shards, each running Algorithm R with its own count over a partitioned stream, then fold them with the count-weighted merge of Task 9 in a binary tree (associative). Compare the global sample's uniformity to a single centralized reservoir.

**Input / Output spec.**
- Input: a stream, a partition function into `m` shards, and `k`.
- Output: a global `k`-sample and the total count.

**Constraints.** Merge must be associative (test multiple folding orders give the same distribution).

**Hint.** Fold pairwise: `merge(merge(s1,s2), merge(s3,s4)), …`. Each shard ships `(reservoir, count)`.

**Evaluation criteria.**
- Global sample uniformity matches a single reservoir over the whole stream (histogram test).
- Different folding orders yield statistically identical results.
- Demonstrates the bias of merging without counts as a negative control.

---

### Task 13 — Algorithm L vs R RNG-call benchmark

**Problem.** Benchmark Algorithm R against Algorithm L across `n ∈ {10^3, 10^4, 10^5, 10^6, 10^7}` with fixed `k = 100`, counting RNG calls and wall-clock time. Plot or tabulate the divergence.

**Input / Output spec.**
- Output: a table `n | R rng calls | L rng calls | R time | L time`.

**Constraints.** Instrument the RNG (wrap it to count calls).

**Hint.** R makes ~`n` calls; L makes ~`k(1+ln(n/k))`. The ratio should grow with `n`.

**Evaluation criteria.**
- R's RNG calls grow linearly; L's grow like `k log(n/k)`.
- Both produce the same uniformity (cross-check with the histogram).
- Results reported in all three languages.

---

### Task 14 — Sliding-window sampling (tumbling reset + checkpoint)

**Problem.** Implement windowed reservoir sampling: maintain a reservoir per tumbling time window, emit `(reservoir, count, window_bounds)` at each boundary, reset, and support checkpoint/restore of `(reservoir, count, offset)` so a restart mid-window does not corrupt the result.

**Input / Output spec.**
- Input: a stream of `(item, event_time)`, a window size, and `k`.
- Output: per-window `(k-sample, count, window)` artifacts.

**Constraints.** Use event-time (not wall-clock) windows; checkpoint atomically.

**Hint.** Bucket items by `floor(event_time / window)`; on boundary crossing, flush and reset. Persist count with the reservoir.

**Evaluation criteria.**
- Each window's sample is uniform within that window.
- A simulated crash + restore from checkpoint loses at most one partial window, not the whole stream.
- Out-of-order events within a window are handled (event-time bucketing).

---

### Task 15 — Canary-based uniformity monitor

**Problem.** Build a monitor that injects synthetic canary items at a known rate into a running sampler and continuously asserts (via a chi-square or KS test over a rolling window) that their observed inclusion frequency matches the expected `k/n`. Alert on statistically significant drift.

**Input / Output spec.**
- Input: a live sampler, a canary injection rate, a window and a p-value threshold.
- Output: a stream of OK / ALERT verdicts with the test statistic.

**Constraints.** The test must catch a deliberately biased sampler (wrong eviction or wrong range) before a naive histogram would.

**Hint.** Track observed vs expected canary inclusions per rolling window; run `scipy.stats.chisquare` (Python) or an equivalent, and alert when `p < threshold`.

**Evaluation criteria.**
- Correctly passes a correct sampler (no false alerts under normal jitter).
- Fires an ALERT on an injected bias (e.g. eviction always evicts slot 0).
- Implemented with the statistical test in all three languages (Go/Java may hand-roll the chi-square statistic).
