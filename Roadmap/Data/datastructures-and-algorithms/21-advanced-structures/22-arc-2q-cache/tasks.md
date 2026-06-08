# ARC and 2Q Adaptive Caches — Practice Tasks

> Solve every task in **Go**, **Java**, and **Python**. Keep all cache operations **O(1)**. Use a hash map + doubly linked lists; do not lean on language-ordered maps once a task says "from scratch".

## Beginner Tasks

**Task 1 — Demonstrate LRU's scan failure.**
Implement a plain LRU cache (capacity 4). Pre-load hot keys `A B C D`, then access a scan `1 2 3 4 5 6`. Print the cache contents after the scan and confirm **all** hot keys were evicted.
- Constraints: O(1) `get`/`put`.
- Expected output: cache holds only scan keys; `get(A)`…`get(D)` all miss.
- Evaluation: correct eviction order; the scan must wipe the hot set (this is the *problem* the rest of the tasks fix).

**Task 2 — Simplified 2Q from scratch.**
Build a 2Q cache: `A1` (FIFO) + `Am` (LRU), each with its own capacity, using a hash map and hand-rolled doubly linked lists (no `OrderedDict`/`LinkedHashMap`).
- Constraints: promotion on **second** access; O(1) ops.
- Expected output: keys accessed twice end up in `Am`; one-time keys age out of `A1`.
- Evaluation: A1 is FIFO (not LRU); promotion moves the key out of A1 into Am.

**Task 3 — Re-run the scan against 2Q.**
Reuse Task 2's cache. Pre-prove hot keys `A B` (access each twice so they sit in `Am`), then run scan `1 2 3 4 5 6`. Show `Am` still holds `A` and `B` afterward.
- Constraints: same as Task 2.
- Expected output: `get(A)` and `get(B)` are hits after the scan; scan keys never entered `Am`.
- Evaluation: prove scan resistance empirically by comparing hit counts to Task 1's LRU.

**Task 4 — Hit/miss counter and hit ratio.**
Extend any cache with `hits`, `misses`, and a `hit_ratio()` method. Feed it a mixed stream (steady reuse of 3 keys interleaved with a 10-key scan) and print the ratio.
- Constraints: counters must not affect O(1).
- Expected output: a single float in `[0,1]`.
- Evaluation: ratio computed as `hits/(hits+misses)`; correct under both hits and misses.

**Task 5 — Visualize 2Q state.**
Add a `dump()` that prints `A1` (newest→oldest) and `Am` (MRU→LRU) on each operation. Trace the worked example from `junior.md` and confirm your output matches step by step.
- Constraints: read-only; must not reorder lists.
- Expected output: two ordered lists per step.
- Evaluation: ordering matches the junior-level trace exactly.

## Intermediate Tasks

**Task 6 — ARC core (T1/T2/B1/B2) from scratch.**
Implement ARC with the four lists, a `loader` callback for misses, and the adaptive `p`. Follow the four cases and the `REPLACE` subroutine from `middle.md`.
- Constraints: ghosts store **keys only**; O(1) ops; enforce invariants `|T1|+|T2| ≤ c` and total `≤ 2c`.
- Expected output: working `get(key, loader)`.
- Evaluation: a re-request promotes a key into `T2`; eviction demotes a key into the matching ghost list.

**Task 7 — Adaptive `p` logging.**
Instrument Task 6 to log `p` and the four list sizes on every operation. Craft a recency-heavy stream, then a frequency-heavy stream, and show `p` rises then falls.
- Constraints: log must not change behavior.
- Expected output: a table of `(op, p, |T1|, |T2|, |B1|, |B2|)`.
- Evaluation: `p` increases on B1 ghost hits and decreases on B2 ghost hits; stays within `[0, c]`.

**Task 8 — Ghost-hit detector.**
Add a `classify(key)` returning one of `HIT_T1, HIT_T2, GHOST_B1, GHOST_B2, MISS` *before* mutating state. Use it to count how many misses were "near-misses" (ghost hits).
- Constraints: pure inspection (no side effects).
- Expected output: per-category counts over a workload.
- Evaluation: ghost hits correctly distinguished from true misses.

**Task 9 — ARC vs LRU vs 2Q bake-off.**
Run all three caches (same capacity) over an identical mixed trace (Zipf-popular keys + periodic scans) and print each one's hit ratio side by side.
- Constraints: identical input stream and capacity for all three.
- Expected output: three hit ratios; ARC ≥ 2Q ≥ LRU on the scan-heavy trace.
- Evaluation: ARC and 2Q resist the scans; LRU's ratio collapses during scans.

**Task 10 — Bound the ghost directory.**
Modify ARC so the ghost lists never exceed a configurable cap `g ≤ c`. Measure the hit-ratio change as `g` shrinks from `c` to `c/4` on the Task 9 trace.
- Constraints: maintain O(1); trimming a ghost is O(1).
- Expected output: hit ratio per `g` value.
- Evaluation: smaller `g` → coarser adaptation → slightly lower hit ratio; trade-off quantified.

## Advanced Tasks

**Task 11 — Thread-safe sharded ARC.**
Wrap your ARC in a sharded cache (N shards, each its own lock and `p`), keyed by a hash of the key. Drive it from multiple workers and verify correctness under concurrency.
- Constraints: no data races (run Go with `-race`, Java with stress threads, Python with threads + a checker).
- Expected output: consistent values; no panics/exceptions; throughput scales with shards.
- Evaluation: per-shard `p` adapts independently; aggregate hit ratio close to the single-lock version.

**Task 12 — Full 2Q with A1out ghost.**
Upgrade simplified 2Q to **full 2Q**: split `A1` into `A1in` (resident FIFO) and `A1out` (ghost FIFO of evicted A1 keys). A hit in `A1out` promotes straight to `Am`.
- Constraints: `A1out` stores keys only; O(1).
- Expected output: keys re-requested shortly after A1 eviction jump straight to `Am`.
- Evaluation: shows `A1out` playing ARC's `B1` role; compare hit ratio to simplified 2Q.

**Task 13 — Phase-change tracking.**
Build a 3-phase workload: (a) OLTP-like recency, (b) a giant scan, (c) frequency-skewed. Plot (or print) `p` over time and the rolling hit ratio. Show ARC re-converging after each phase.
- Constraints: rolling window of fixed size for the ratio.
- Expected output: `p` retracks within ~one working-set of accesses after each phase boundary.
- Evaluation: `p` rises in phase (a)/(b) recency, falls in phase (c); hit ratio recovers after dips.

**Task 14 — W-TinyLFU comparison (stretch).**
Implement a minimal W-TinyLFU: a small LRU admission window in front of an SLRU main region, with admission gated by a Count-Min Sketch frequency estimate (with periodic aging). Compare its hit ratio to ARC on the Task 9 trace.
- Constraints: sketch is fixed-size; admission compares candidate vs victim estimated frequency.
- Expected output: two hit ratios (ARC vs W-TinyLFU).
- Evaluation: W-TinyLFU matches or beats ARC with far smaller metadata; discuss why (see [count-min-sketch](../08-count-min-sketch/senior.md)).

**Task 15 — Trace-driven evaluation harness.**
Write a harness that replays a request trace from a file (one key per line) through LRU, 2Q, ARC, and (optionally) W-TinyLFU at several capacities, emitting a hit-ratio-vs-capacity table.
- Constraints: stream the file (do not load it all into memory); O(1) per request per policy.
- Expected output: a table `capacity × policy → hit_ratio`.
- Evaluation: curves are monotonic in capacity; ARC dominates LRU on scan-prone traces and ties it on pure-locality traces.

## Benchmark Task

> Compare ARC throughput across all 3 languages. Generate a Zipf-skewed key stream (so there is a genuine hot set), interleave a periodic scan, and measure operations/second.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000}
	for _, n := range sizes {
		arc := NewARC(n / 10)                       // cache = 10% of key space
		keys := make([]int, n)
		for i := range keys {
			if i%50 == 0 {
				keys[i] = n + i // scan key (unique, one-time)
			} else {
				keys[i] = rand.Intn(n / 5) // Zipf-ish hot set
			}
		}
		start := time.Now()
		for _, k := range keys {
			arc.Get(k, func(x int) int { return x })
		}
		el := time.Since(start)
		fmt.Printf("n=%7d: %.2f Mops/s\n", n, float64(n)/el.Seconds()/1e6)
	}
}
```

#### Java

```java
import java.util.Random;

public class ArcBench {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000};
        Random r = new Random(42);
        for (int n : sizes) {
            ARCCache arc = new ARCCache(n / 10);
            int[] keys = new int[n];
            for (int i = 0; i < n; i++)
                keys[i] = (i % 50 == 0) ? n + i : r.nextInt(n / 5);
            long start = System.nanoTime();
            for (int k : keys) arc.get(k, x -> x);
            double sec = (System.nanoTime() - start) / 1e9;
            System.out.printf("n=%7d: %.2f Mops/s%n", n, n / sec / 1e6);
        }
    }
}
```

#### Python

```python
import random
import time

for n in (1_000, 10_000, 100_000):
    arc = ARCCache(n // 10)
    keys = [n + i if i % 50 == 0 else random.randint(0, n // 5) for i in range(n)]
    start = time.perf_counter()
    for k in keys:
        arc.get(k, loader=lambda x: x)
    sec = time.perf_counter() - start
    print(f"n={n:>7}: {n / sec / 1e6:.2f} Mops/s")
```

> Report ops/sec per language, the steady-state `p`, and the overall hit ratio. Expect ARC to keep a high hit ratio despite the periodic scan keys — that is the whole point.
