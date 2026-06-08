# Counting Bloom Filter — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Each task lists constraints, expected behavior, and how you'll be evaluated. Always verify the core invariant after every task: **a "no" must always be correct (no false negatives)** — provided you delete only inserted items and saturate counters on overflow.

---

## Beginner Tasks

### Task 1 — Implement a fixed-size counting Bloom filter from scratch

Implement a CBF with a given `m` (slots) and `k` (hash functions). Provide `add(item)`, `delete(item)`, and `mightContain(item)`. Use double hashing (`g_i = h1 + i·h2 mod m`) for the `k` positions. Use one byte per counter for now (max 15 by convention). **Saturate** at 15 on increment; **clamp** at 0 on decrement and never decrement a saturated counter.

#### Go

```go
package main

type CBF struct {
	// c []uint8; m, k uint64
}

func NewCBF(m, k uint64) *CBF             { /* implement */ return nil }
func (b *CBF) Add(data []byte)            { /* implement: +1, saturate at 15 */ }
func (b *CBF) Delete(data []byte)         { /* implement: -1, clamp at 0, skip saturated */ }
func (b *CBF) MightContain(data []byte) bool { /* implement: all counters > 0 */ return false }

func main() {
	// b := NewCBF(64, 3); b.Add([]byte("hi")); b.Delete([]byte("hi")); print(b.MightContain([]byte("hi")))
}
```

#### Java

```java
public class Task1 {
    static class CBF {
        CBF(int m, int k) { /* implement */ }
        void add(String s) { /* +1, saturate */ }
        void delete(String s) { /* -1, clamp, skip saturated */ }
        boolean mightContain(String s) { /* all > 0 */ return false; }
    }
    public static void main(String[] args) {
        // CBF b = new CBF(64, 3); b.add("hi"); b.delete("hi"); System.out.println(b.mightContain("hi"));
    }
}
```

#### Python

```python
class CBF:
    def __init__(self, m, k):
        ...  # implement
    def add(self, item):
        ...  # +1, saturate at 15
    def delete(self, item):
        ...  # -1, clamp at 0, skip saturated
    def might_contain(self, item):
        ...  # all counters > 0

if __name__ == "__main__":
    pass  # b = CBF(64, 3); b.add("hi"); b.delete("hi"); print(b.might_contain("hi"))
```

- **Constraints:** `O(k)` per op; deterministic hashing; saturate/clamp correctly.
- **Expected:** `add(x)` then `mightContain(x)` is `True`; `add(x); delete(x)` then `mightContain(x)` is `False`.
- **Evaluation:** correctness, double hashing, saturation/clamp logic.

### Task 2 — Add a `from(n, p)` constructor with sizing math

Add a constructor that computes `m = ceil(−n·ln p / (ln 2)²)` and `k = round((m/n)·ln 2)` from a target item count `n` and FPR `p` — **the same formulas as a Bloom filter**. Print the chosen `m`, `k`, and the total memory in bytes (assuming 4-bit counters packed two-per-byte: `ceil(m/2)` bytes).

- **Constraints:** `k ≥ 1`; reject `p ≤ 0` or `p ≥ 1`.
- **Expected:** for `n=1000, p=0.01` → `m≈9586, k≈7`, memory `≈ 4793` bytes (4-bit packed).
- **Evaluation:** formula correctness, input validation, memory reporting.

### Task 3 — Demonstrate safe deletion (the headline property)

Insert `x` and `y` into a CBF. Assert both query "present." Then `delete(x)` and assert `mightContain(x)` is `False` **and** `mightContain(y)` is still `True`. Repeat for many random `x, y` pairs so some share counters, proving deletion of one never breaks the other.

- **Constraints:** use a small `m` so collisions are likely; only delete inserted items.
- **Expected:** every `y` survives the deletion of its `x` (zero false negatives among kept items).
- **Evaluation:** correct demonstration of the CBF's core advantage over a Bloom filter.

### Task 4 — Verify no false negatives through insert/delete churn

Insert `n = 50,000` distinct strings, then delete a random half. Query every **remaining** item and assert all return `True` (zero false negatives). Print the false-negative count (must be `0`).

- **Constraints:** delete only inserted items; assert zero false negatives among the kept set.
- **Expected:** `falseNegatives = 0` on every run.
- **Evaluation:** correct churn handling, invariant verification.

### Task 5 — Compare observed FPR before and after deletes

After inserting `n` items, measure the observed FPR (query `n` never-inserted items). Then delete half the inserted items and measure the FPR again. Show the FPR **drops** after deletion — something a Bloom filter cannot do. Compare both to the analytic `(1 − e^(−k·n_live/m))^k`.

- **Constraints:** disjoint insert/test sets; report 4 decimals; only delete inserted items.
- **Expected:** observed FPR falls after deletes and tracks the analytic value at the live count.
- **Evaluation:** measurement correctness, demonstration that FPR follows live `n` down.

---

## Intermediate Tasks

### Task 6 — Pack two 4-bit counters per byte

Re-implement the counter storage to pack **two 4-bit counters per byte** (`ceil(m/2)` bytes) instead of one byte each, halving memory. Provide `get(i)`/`set(i, v)` nibble accessors. Verify behavior is identical to Task 1 and report the memory saving.

- **Constraints:** correct low/high nibble addressing; max value 15 per counter.
- **Expected:** same membership results as Task 1; ~2× less memory.
- **Evaluation:** correct nibble packing, memory measurement.

### Task 7 — Counter overflow and saturation

Force a counter to overflow: with a tiny `m`, insert enough distinct items that some counter reaches 15. Confirm further increments leave it at 15 (no wrap to 0) and that a `delete` does **not** decrement a saturated counter. Verify no false negative is introduced by the saturation.

- **Constraints:** detect and report a saturated counter; never wrap; never decrement saturated.
- **Expected:** saturated counters stay at 15; membership stays correct (only extra false positives possible).
- **Evaluation:** correct saturation handling, false-negative safety.

### Task 8 — Reproduce the underflow false-negative bug, then guard against it

Deliberately `delete` items that were **never inserted** on a small, collision-prone filter and show it can flip a real member to "absent" (a false negative). Then add a guard (e.g. consult an exact key set before deleting) and show the bug disappears.

- **Constraints:** small `m`/`k`; demonstrate both the bug and the fix.
- **Expected:** underflow creates a false negative; the guard prevents it.
- **Evaluation:** understanding of the underflow failure mode and its mitigation.

### Task 9 — Counting Bloom vs Bloom: memory and delete behavior

Build a Bloom filter and a CBF for the same `n`, `p`. Insert `n` items into both, then "remove" `n/2` items. Show the Bloom filter **cannot** reflect removals (deleted items still query "present", FPR unchanged) while the CBF **can** (deleted items query "absent", FPR drops). Report the memory of each (CBF ≈ 4× Bloom).

- **Constraints:** same `m`/`k` for both; measure memory; only delete inserted items in the CBF.
- **Expected:** CBF uses ~4× memory but tracks removals; Bloom uses 1× but can't delete.
- **Evaluation:** fair comparison, correct demonstration of the trade-off.

### Task 10 — Counter-wise merge of two CBFs

Implement `merge(a, b)` returning a new CBF whose counters are `min(a[i] + b[i], 15)` (saturating addition) for two filters with identical `m`, `k`, seeds. Verify the merge answers "present" for every item inserted into either source, and that you can `delete` a merged item correctly. Bonus: implement `subtract(merged, b)` to remove `b`'s contribution and confirm it recovers `a`'s membership.

- **Constraints:** reject mismatched `m`/`k`; saturate on add; clamp on subtract.
- **Expected:** merge = multiset union (no false negatives); subtract removes a node's contribution.
- **Evaluation:** correct counter-wise add/subtract, parameter check. (Cross-ref: `senior.md`, distributed CBFs.)

---

## Advanced Tasks

### Task 11 — Spectral Bloom filter (frequency queries)

Extend the CBF to store actual insertion counts (wider counters, e.g. 8 or 16 bits) and add `estimate(item)` returning `min` of the item's `k` counters as a frequency estimate. Insert items with known multiplicities, then verify `estimate` is always `≥` the true count (one-sided overestimate) and usually close. Support `delete` to decrement counts.

- **Constraints:** wider counters; `estimate = min` of the `k` counters; deletes decrement.
- **Expected:** estimates never underestimate; close to true counts at low load.
- **Evaluation:** correct min-estimator, one-sided error, delete support. (Cross-ref: `senior.md`, spectral BF; Count-Min sketch.)

### Task 12 — Network flow-table simulation

Simulate a flow table: generate a stream of flow events — `OPEN(flow_id)` and `CLOSE(flow_id)`. On `OPEN`, `add` the flow; on `CLOSE`, `delete` it. After processing, the CBF should answer "present" for currently-open flows and (mostly) "absent" for closed ones. Track peak concurrent flows and confirm the FPR stays near target throughout (not climbing), unlike a Bloom filter.

- **Constraints:** size `m`/`k` for **peak concurrent** flows; only delete opened flows.
- **Expected:** FPR stays bounded across the stream; open flows query present, closed flows mostly absent.
- **Evaluation:** correct churn handling, peak sizing, steady-state FPR. (Cross-ref: `senior.md`, flow tables.)

### Task 13 — Concurrent (atomic) counting Bloom filter

Make `add` and `delete` thread-safe using atomic increment/decrement (CAS loops) per counter — saturating increment, clamped decrement — without a global lock. Run many goroutines/threads doing concurrent inserts and deletes, then verify from a single thread that all *currently-inserted* items return `True` (no lost updates).

- **Constraints:** atomic read-modify-write; no data races (run with `-race` / thread sanitizer).
- **Expected:** zero false negatives for the net-inserted set under contention.
- **Evaluation:** correctness under contention, race-freedom, saturation/clamp under concurrency. (Cross-ref: `senior.md`.)

### Task 14 — Measure the counter distribution and validate 4 bits

Insert `n` items at the optimal `k`, then build a histogram of counter values across all `m` slots. Confirm the distribution matches `Poisson(λ = kn/m = ln 2 ≈ 0.69)` (mean ≈ 0.69, almost no counters ≥ 4), empirically justifying that 4-bit counters never overflow. Then **overfill** (insert `4n`) and show counters creep up, motivating wider counters or a resize.

- **Constraints:** efficient histogram; compare to the Poisson PMF.
- **Expected:** at optimal load, mean ≈ 0.69 and `Pr[counter ≥ 16] ≈ 0`; overfill shifts the distribution up.
- **Evaluation:** correct empirical distribution, match to theory, overfill demonstration. (Cross-ref: `professional.md`.)

### Task 15 — Sliding-window deduplication

Build a windowed dedup component: events have an `id` and a timestamp. Suppress an event if its `id` is already in the CBF; otherwise emit it, `add` it, and schedule a `delete` when it leaves the time window. Feed a stream with repeats and expirations; measure (a) duplicate suppression within the window, (b) unique events wrongly suppressed (false positives), and (c) that the live counter count tracks the window's ID count (doesn't grow unbounded).

- **Constraints:** stream processing; delete on window expiry; only delete inserted IDs.
- **Expected:** near-complete in-window dedup; bounded false positives; live count tracks the window.
- **Evaluation:** correct windowing via deletes, FPR control, bounded growth. (Cross-ref: `senior.md`, sliding-window dedup.)

---

## Benchmark Task

> Compare insert, delete, and query throughput, plus observed FPR, across all 3 languages for a CBF sized at `n = 1,000,000`, `p = 0.01`, then a churn pass (delete half).

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	n := 1000000
	// b := New(n, 0.01)   // your sized constructor
	start := time.Now()
	for i := 0; i < n; i++ {
		// b.Add(fmt.Sprintf("k-%d", i))
		_ = i
	}
	addDur := time.Since(start)
	start = time.Now()
	for i := 0; i < n/2; i++ {
		// b.Delete(fmt.Sprintf("k-%d", i))
		_ = i
	}
	fmt.Printf("inserts of %d in %v; deletes of %d in %v\n", n, addDur, n/2, time.Since(start))
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int n = 1_000_000;
        // CBF b = new CBF(n, 0.01);
        long start = System.nanoTime();
        for (int i = 0; i < n; i++) {
            // b.add("k-" + i);
        }
        long addMs = (System.nanoTime() - start) / 1_000_000;
        start = System.nanoTime();
        for (int i = 0; i < n / 2; i++) {
            // b.delete("k-" + i);
        }
        System.out.printf("inserts of %d in %d ms; deletes of %d in %d ms%n",
            n, addMs, n / 2, (System.nanoTime() - start) / 1_000_000);
    }
}
```

#### Python

```python
import time

n = 1_000_000
# b = CBF(n, 0.01)
start = time.perf_counter()
for i in range(n):
    # b.add(f"k-{i}")
    pass
add_dur = time.perf_counter() - start
start = time.perf_counter()
for i in range(n // 2):
    # b.delete(f"k-{i}")
    pass
print(f"inserts of {n} in {add_dur:.3f}s; deletes of {n // 2} in {time.perf_counter() - start:.3f}s")
```

Report a table of `language → insert ms → delete ms → query ms → observed FPR (after churn)`. Note where each language's hashing and the read-modify-write counter updates dominate (CBF updates touch memory twice — read then write — vs a Bloom filter's single set-bit), and whether the observed FPR after deleting half matches the analytic value at the reduced live count.
