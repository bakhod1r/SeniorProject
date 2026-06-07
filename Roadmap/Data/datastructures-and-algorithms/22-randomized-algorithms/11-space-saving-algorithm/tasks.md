# Space-Saving Algorithm — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Space-Saving logic and validate against the evaluation criteria.
> **Always validate against an exact hash-map oracle on small streams: the genuinely frequent items must match, every stored `count` must over-estimate the true frequency (`count ≥ f`), and the counts must sum to `n`.**

---

## Beginner Tasks (5)

### Task 1 — The three-way add rule

**Problem.** Implement `add(item)` for a Space-Saving table with `m` counters that handles the three cases: (1) tracked item → increment; (2) free slot → start at `1`, error `0`; (3) full → evict the min, new count `min + 1`, error `min`.

**Input / Output spec.**
- Read `m`, then a sequence of string items.
- Print each surviving `(item, count, error)` after the stream ends.

**Constraints.** `m ≥ 1`; items are non-empty strings.

**Hint.** Use a hash map `item -> count` and a parallel map `item -> error`. For the min, scan the table (Task 6 makes this `O(1)`).

**Starter — Go.**
```go
package main

import "fmt"

type SpaceSaving struct {
	m     int
	count map[string]int
	err   map[string]int
}

func (s *SpaceSaving) Add(item string) {
	// TODO: three-way rule
}

func main() {
	s := &SpaceSaving{m: 3, count: map[string]int{}, err: map[string]int{}}
	for _, x := range []string{"A", "B", "C", "A", "D"} {
		s.Add(x)
	}
	fmt.Println(s.count, s.err)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static Map<String,Integer> count = new HashMap<>();
    static Map<String,Integer> err = new HashMap<>();
    static int m = 3;

    static void add(String item) {
        // TODO: three-way rule
    }

    public static void main(String[] args) {
        for (String x : List.of("A","B","C","A","D")) add(x);
        System.out.println(count + " " + err);
    }
}
```

**Starter — Python.**
```python
def add(item, count, err, m):
    # TODO: three-way rule
    pass


def main():
    count, err, m = {}, {}, 3
    for x in ["A", "B", "C", "A", "D"]:
        add(x, count, err, m)
    print(count, err)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Tracked items increment; free slots start at `1`; full table evicts the min at `min + 1`.
- Error recorded as `min` on eviction, `0` on free insert.
- For `m=3, A B C A D`: `A:2(0), B:1(0), D:2(1)` (B or C evicted).

---

### Task 2 — Verify the over-estimate property

**Problem.** Run Space-Saving alongside an exact frequency hash map on a stream, and assert that for every monitored item `count(x) ≥ f(x)` and `count(x) - error(x) ≤ f(x) ≤ count(x)`.

**Input / Output spec.**
- Read `m` and a stream. Print `OK` if all brackets hold, else the first violation.

**Constraints.** Small streams (`n ≤ 10^5`) so the exact map fits.

**Hint.** Keep a full `dict` of true counts in parallel. After processing, loop the summary and check each bracket.

**Reference oracle (Python).**
```python
from collections import Counter

def check(stream, m):
    true = Counter(stream)
    ss = SpaceSaving(m)            # from Task 1
    for x in stream:
        ss.add(x)
    for k in ss.count:
        lo = ss.count[k] - ss.err[k]
        assert lo <= true[k] <= ss.count[k], (k, lo, true[k], ss.count[k])
    return "OK"
```

**Evaluation criteria.**
- All brackets hold on random streams.
- `count ≥ f` for every monitored item (never under-counts).
- Items with `error = 0` have exact counts.

---

### Task 3 — Conservation invariant

**Problem.** After each item, assert that the sum of all stored counts equals the number of items processed so far (`Σ count = n`).

**Input / Output spec.**
- Read `m` and a stream. Print `OK` if the invariant holds at every step, else the step where it breaks.

**Constraints.** `m ≥ 1`, any stream.

**Hint.** The invariant is the root of all the proofs: each arrival must increase `Σ count` by exactly `1`. If it ever breaks, your eviction is starting the newcomer at the wrong value (must be `min + 1`).

**Evaluation criteria.**
- `Σ count == i` after `i` items, for all `i`.
- Holds across hits, free-slot inserts, and evictions.
- Detects the classic bug of starting a newcomer at `1` instead of `min + 1`.

---

### Task 4 — Top-k query

**Problem.** Implement `top_k(k)` returning the `k` items with the largest stored counts (ties broken arbitrarily).

**Input / Output spec.**
- Read `m`, `k`, and a stream. Print the top-`k` items with their counts.

**Constraints.** `1 ≤ k ≤ m`.

**Hint.** Sort the `m` entries by count descending and slice. Sort only at query time, not per item.

**Worked check.** `m=3, k=2, stream = A B C A A B D A B` → `[(A,4), (B,3)]`.

**Evaluation criteria.**
- Matches the worked check.
- For streams with fewer than `m` distinct items, top-k counts are exact.
- Returns at most `min(k, size)` items.

---

### Task 5 — Guaranteed heavy hitters

**Problem.** Implement `guaranteed_heavy(threshold)` returning items whose lower bound `count - error` exceeds `threshold`. These are guaranteed true heavy hitters (no false positives).

**Input / Output spec.**
- Read `m`, `threshold`, a stream. Print the guaranteed heavy hitters.

**Constraints.** Any stream; a natural threshold is `n/m`.

**Hint.** The lower bound `count - error` is the number of times the item has *definitely* appeared. If that exceeds the threshold, the item truly exceeds it.

**Evaluation criteria.**
- Every returned item has true `f > threshold` (verify against an exact map).
- With `threshold = n/m`, no true heavy hitter above `n/m` is missed.
- No item with `count - error ≤ threshold` is returned.

---

## Intermediate Tasks (5)

### Task 6 — Stream-Summary for O(1) updates

**Problem.** Replace the `O(m)` min-scan with the Stream-Summary: buckets of equal-count items in a doubly linked list sorted by count. Support `add` in `O(1)` and `top_k`.

**Constraints.** `m ≥ 1`; benchmark over `≥ 10^6` items.

**Hint.** Keep `item -> bucket` and the head (min) bucket. On increment, move the item to the *adjacent* (`count + 1`) bucket — create it if absent, unlink the old one if empty. On eviction, take any item from the head bucket.

**Reference structure (Python) — see `middle.md` for the full implementation.**
```text
Bucket: { count, items:set, prev, next }
StreamSummary: { head, bucket_of:dict, error:dict, size }
add:  hit -> bump to adjacent bucket;  free -> count-1 bucket;  full -> evict head, insert at min+1
```

**Evaluation criteria.**
- Produces identical results to the Task 1 min-scan version on the same stream.
- `add` does a constant number of pointer/hash operations (no scan).
- Measurable speedup over the min-scan version on a large stream.
- Emptied buckets are unlinked; no count gaps cause errors.

---

### Task 7 — Compare against Misra-Gries

**Problem.** Implement Misra-Gries (decrement *all* counters on a miss when full) and compare its top-k accuracy with Space-Saving on a skewed (Zipfian) stream with the same `m`.

**Constraints.** Generate a Zipf stream (e.g. `weights[i] = 1/(i+1)`); `n ≥ 10^5`.

**Hint.** Misra-Gries under-estimates; Space-Saving over-estimates. On skewed data Misra-Gries bleeds count from heavy hitters on every decrement, so compare the estimated counts of the true top-k against the exact counts.

**Reference (Misra-Gries miss step, Python).**
```python
# on a miss when full:
for k in list(mg.keys()):
    mg[k] -= 1
    if mg[k] == 0:
        del mg[k]
# (do NOT insert the new item)
```

**Evaluation criteria.**
- Both keep roughly the same *set* of top items.
- Space-Saving's estimated counts for the true heavy hitters are closer to exact.
- Report the mean absolute count error of the top-k for both; Space-Saving should be lower on skewed data.

---

### Task 8 — Merge two summaries

**Problem.** Implement `merge(A, B, m)` combining two summaries into one with at most `m` counters: add counts and errors on shared items, union the rest, truncate to the top `m`, and charge the truncation floor (`(m+1)`-th largest count) into survivors' error.

**Constraints.** Both inputs have `≤ m` counters.

**Hint.** After folding, sort by count descending; the count at rank `m` (0-indexed) is the floor; add it to every survivor's error to keep the bracket sound.

**Worked check.** Split a stream into two halves, build a summary on each, merge them, and compare the global top-k to a summary built on the whole stream.

**Evaluation criteria.**
- Merged brackets are sound over the combined stream (`count - error ≤ f ≤ count`).
- Global top-k from the merge matches (or closely approximates) a single-pass summary.
- Merge is order-independent (merging A then B equals B then A on the top-k).

---

### Task 9 — Sliding-window "trending"

**Problem.** Implement a trending top-k using tumbling sub-summaries: maintain the last `W` window summaries; `roll()` advances the window; `top_k()` merges the live windows.

**Constraints.** `W ≥ 1`; demonstrate that old items fall off as windows roll.

**Hint.** Use a fixed-size deque of summaries (`maxlen=W`). Add to the current (last) sub; on `roll()`, append a fresh empty sub. Merge the live subs for queries (reuse Task 8).

**Evaluation criteria.**
- An item frequent only in old (expired) windows drops out of the trending list.
- An item frequent in the recent window appears.
- Memory stays `O(W · m)`.

---

### Task 10 — Choose `m` for an accuracy target

**Problem.** Given a target fraction `φ` (catch every item above `φ·n`), compute the required `m`, run Space-Saving, and verify empirically that all true `φ`-frequent items are recovered.

**Constraints.** `0 < φ < 1`; generate a stream with known heavy hitters at known frequencies.

**Hint.** The guarantee needs `m ≥ 1/φ`; for accurate counts over-provision (`m ≈ 6/φ`). Plant a few items above `φ·n` and confirm all survive.

**Evaluation criteria.**
- With `m = ⌈1/φ⌉`, every planted `φ`-frequent item is in the final table.
- With a larger `m`, the count errors of the heavy hitters shrink.
- Report the recall of true heavy hitters as a function of `m`.

---

## Advanced Tasks (5)

### Task 11 — Distributed top-k via map-reduce merge

**Problem.** Simulate a sharded pipeline: partition a stream across `P` shards, build a Space-Saving summary per shard in parallel, then hierarchically `merge` (Task 8) into a global top-k. Verify against a single-pass summary.

**Constraints.** `P ≥ 2`; use real concurrency (goroutines / threads / multiprocessing) for the shard build.

**Hint.** Shards are independent — no shared state during the build. Merge in a tree (pairwise) to exploit associativity. Each summary is `O(m)`; only summaries cross between stages.

**Evaluation criteria.**
- Global top-k closely matches the single-pass top-k.
- Different merge tree shapes give the same top-k (associativity).
- Brackets remain sound after multi-level merging.

---

### Task 12 — Exponential decay for recency

**Problem.** Add exponential decay: every `T` items (or on a timer), multiply all counts and errors by a factor `λ ∈ (0,1)`. Show that recent items dominate the top-k over time.

**Constraints.** Keep counts as floats (or scaled integers); preserve the over-estimate property after decay.

**Hint.** Decay both `count` and `error` by the same factor so the bracket stays valid. After decay, the eviction floor shrinks, letting fresh items enter more easily.

**Evaluation criteria.**
- An item that was hot long ago decays out of the top-k.
- The over-estimate property (`count ≥ f` for the decayed frequency) is preserved.
- A burst of a new item promotes it into the top-k within a window.

---

### Task 13 — Hot-key detector with hysteresis

**Problem.** Build a hot-key detector: run Space-Saving on a key access stream; emit a "promote" event when a key's lower bound `count - error` crosses a high threshold, and a "demote" event when it falls below a lower threshold (hysteresis to avoid flapping).

**Constraints.** Two thresholds `hi > lo`; demonstrate no rapid promote/demote oscillation.

**Hint.** Track a per-key state (cold/hot). Transition cold→hot at `hi`, hot→cold at `lo`. Use the *lower bound* `count - error` so you never promote a false positive.

**Evaluation criteria.**
- Genuinely hot keys are promoted; cold keys are not.
- No oscillation when a key hovers between `lo` and `hi`.
- Promotion uses the guaranteed lower bound (no false positives).

---

### Task 14 — Accuracy vs `m` study on Zipfian data

**Problem.** Empirically chart top-k accuracy as a function of `m` on Zipfian streams of varying skew `z`. Measure recall of the true top-k and mean count error.

**Constraints.** Vary `z ∈ {0.5, 1.0, 1.5}` and `m ∈ {1/φ, 2/φ, 4/φ, 8/φ}`.

**Hint.** Higher skew → smaller `m` suffices (heavy hitters climb out of the eviction zone faster). Compare the realized eviction floor (head-bucket count) to the worst-case `n/m`.

**Evaluation criteria.**
- Recall increases with `m` and with skew `z`.
- The realized error is far below `n/m` on skewed data.
- A short writeup explains why skew makes small `m` accurate.

---

### Task 15 — Decide which heavy-hitter tool fits a scenario

**Problem.** Implement `classify(scenario)` (or write a short analysis) that, given `(need_named_items, need_point_query_any, need_exact_merge, recency_matters, randomization_ok)`, returns one of `SPACE_SAVING`, `MISRA_GRIES`, `COUNT_MIN`, `LOSSY_COUNTING`, or `SPACE_SAVING_WINDOWED`. Justify each.

**Constraints / cases to handle.**
- Named top-k on skewed data → `SPACE_SAVING`.
- Point query for arbitrary items, exact merge → `COUNT_MIN`.
- Recency matters (trending) → `SPACE_SAVING_WINDOWED`.
- Simplest counter scheme, under-estimate acceptable → `MISRA_GRIES`.
- Threshold frequent items with deterministic guarantee → `LOSSY_COUNTING`.

**Hint.** Encode the decision rules from `senior.md` and `professional.md`. The trap: Count-Min cannot *name* the frequent items by itself.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The point-query branch picks Count-Min and notes it needs a heap to name items.
- Justification cites the right guarantee (`over` vs `under`, `O(1)` time, `n/m` bound, mergeability).

---

## Benchmark Task

### Task B — Exact hash map vs Space-Saving: memory and speed crossover

**Problem.** Compare an exact `{item -> count}` hash map against Space-Saving on streams of increasing distinct-item cardinality. Measure memory and per-item time.

- **(a) Exact map:** stores every distinct item — memory grows with cardinality.
- **(b) Space-Saving (min-scan):** `O(m)` memory, `O(m)` per miss.
- **(c) Space-Saving (Stream-Summary):** `O(m)` memory, `O(1)` per item.

Run on streams with `distinct ∈ {10^3, 10^4, 10^5, 10^6}` distinct items, fixed `m`, and report memory and time. Verify the top-k of (b)/(c) matches the exact top-k from (a) on skewed data.

**Starter — Python.**
```python
import random, time, sys


def exact_topk(stream, k):
    from collections import Counter
    return Counter(stream).most_common(k)


def ss_topk(stream, m, k):
    ss = SpaceSaving(m)        # Stream-Summary version from Task 6
    for x in stream:
        ss.add(x)
    return ss.top_k(k)


def make_zipf(n, distinct):
    keys = [f"k{i}" for i in range(distinct)]
    weights = [1.0 / (i + 1) for i in range(distinct)]
    return random.choices(keys, weights, k=n)


def main():
    n, m, k = 1_000_000, 1000, 10
    for distinct in [10**3, 10**4, 10**5, 10**6]:
        stream = make_zipf(n, distinct)
        t0 = time.perf_counter()
        ss_topk(stream, m, k)
        t_ss = time.perf_counter() - t0
        t0 = time.perf_counter()
        exact_topk(stream, k)
        t_exact = time.perf_counter() - t0
        print(f"distinct={distinct:>8}  ss={t_ss*1000:.1f}ms  exact={t_exact*1000:.1f}ms")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same stream across Go, Java, and Python.
- Space-Saving memory stays flat (`O(m)`) as distinct cardinality grows; the exact map grows linearly.
- The Stream-Summary version (c) is `O(1)` per item; the min-scan version (b) slows as `m` grows.
- On skewed data, Space-Saving's top-k matches the exact top-k.
- Report the mean across at least 3 runs and exclude stream-generation time.
- Writeup: note where Space-Saving wins (high cardinality, bounded memory) and where the exact map is fine (low cardinality that fits).

---

## General Guidance for All Tasks

- **Always validate against an exact hash-map oracle on small streams first.** The frequent items must match, `count ≥ f` for every monitored item, and `Σ count = n`.
- **Get the eviction right:** the newcomer starts at `min + 1` (not `1`) and records `error = min`. This preserves conservation and the guarantees.
- **Report brackets, not raw counts:** the truth lies in `[count - error, count]`; an item with `error = 0` is exact.
- **Use the Stream-Summary** for anything processing a real stream — the min-scan is `O(m)` per miss.
- **Size `m` to the threshold:** `m ≥ 1/φ` to keep all items above fraction `φ`; over-provision for accurate counts.
- **Filter false positives** by `count - error > threshold` to get guaranteed heavy hitters.
- **Remember it is deterministic** — same stream, same result; ideal for reproducible tests.

Each task must be implemented and tested in **Go, Java, and Python**, with identical top-k results across all three on the same inputs.
