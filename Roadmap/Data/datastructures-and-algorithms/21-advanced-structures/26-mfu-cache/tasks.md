# MFU Cache — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> The reference designs live in [`junior.md`](./junior.md), [`middle.md`](./middle.md), [`senior.md`](./senior.md), and [`professional.md`](./professional.md). MFU is the structural mirror of [LFU](../21-lfu-cache/tasks.md) — it evicts the **highest**-frequency item instead of the lowest. Read the LFU tasks first; many here are deliberate inversions.

## Beginner Tasks

**Task 1 — Simple MFU from scratch.**
Implement an MFU cache with `get(key)` and `put(key, value)` using a single hash map of `(value, freq, lastUsed)` entries. On a full cache, evict the entry with the **maximum** frequency. New keys start at frequency 1; ties within the max-frequency set break by **least-recently-used**. Eviction may scan for the max (O(n) is fine here).

#### Go

```go
package main

type SimpleMFU struct {
	// capacity, tick, data map[int]*entry
}

func NewSimple(capacity int) *SimpleMFU { /* implement */ return nil }
func (c *SimpleMFU) Get(key int) int    { /* implement */ return -1 }
func (c *SimpleMFU) Put(key, value int) { /* implement */ }

func main() {
	// c := NewSimple(2); c.Put(1,1); c.Put(2,2); ...
}
```

#### Java

```java
public class Task1 {
    static class SimpleMFU {
        SimpleMFU(int capacity) { /* implement */ }
        int get(int key) { /* implement */ return -1; }
        void put(int key, int value) { /* implement */ }
    }
    public static void main(String[] args) {
        // SimpleMFU c = new SimpleMFU(2);
    }
}
```

#### Python

```python
class SimpleMFU:
    def __init__(self, capacity: int):
        ...  # implement

    def get(self, key: int) -> int:
        ...  # implement

    def put(self, key: int, value: int) -> None:
        ...  # implement


if __name__ == "__main__":
    pass
```

- **Constraints:** correct MFU eviction + LRU tie-break within the max bucket; handle `capacity == 0`.
- **Expected:** matches the worked example in `junior.md`.
- **Evaluation:** correctness on hit/miss/evict, recency tie-break, edge cases.

**Task 2 — Track frequencies.**
Extend Task 1 with `frequency(key) int` that returns the current access count of a key (or `0`/`-1` if absent). Verify that both `get` and a `put`-update increment it, and that a freshly inserted key reports frequency 1. Confirm that the very key you just touched is now the prime eviction candidate the moment it tops the frequency table.

**Task 3 — Capacity-zero and capacity-one.**
Write tests proving: a capacity-0 MFU stores nothing (`get` always `-1`); a capacity-1 MFU holds exactly one key and replaces it on any new `put`. Note the MFU subtlety: with capacity 1 the resident key is simultaneously the min- and max-frequency key, so the eviction target is unambiguous. Provide the test harness in all three languages.

**Task 4 — Reconstruct the eviction trace.**
Given a capacity and a sequence of operations (e.g., `put 1 1; put 2 2; get 1; put 3 3`), print after each step the resident keys with their frequencies, and announce each eviction with the victim key and the reason ("max freq" or "max freq + LRU tie-break"). Highlight how, unlike LFU, accessing a key here makes it **more** likely to be evicted, not less.

**Task 5 — MFU vs LRU vs LFU divergence finder.**
Write a function that, given a capacity and an access stream of keys, runs a simple MFU, a simple LRU, and a simple LFU side by side and prints the first operation at which any two of them evict **different** keys (or "never diverge"). Use it to confirm that `A A B C` (capacity 2) makes MFU evict `A` (the hot key) while LFU and LRU keep `A`.

## Intermediate Tasks

**Task 6 — O(1) MFU.**
Implement the full O(1) design: `keyMap` (key→node), `freqMap` (freq→recency-ordered doubly linked list), and a `maxFreq` integer — the exact mirror of LFU's `minFreq`. Both `get` and `put` must be O(1). The eviction victim is the LRU node of the `freqMap[maxFreq]` bucket. Provide starter code in all three languages.

#### Go

```go
package main

type MFUCache struct {
	// capacity, maxFreq, keyMap, freqMap
}

func Constructor(capacity int) MFUCache { /* implement */ return MFUCache{} }
func (c *MFUCache) Get(key int) int     { /* implement */ return -1 }
func (c *MFUCache) Put(key, value int)  { /* implement */ }

func main() {}
```

#### Java

```java
public class Task6 {
    static class MFUCache {
        MFUCache(int capacity) { /* implement */ }
        int get(int key) { /* implement */ return -1; }
        void put(int key, int value) { /* implement */ }
    }
    public static void main(String[] args) {}
}
```

#### Python

```python
class MFUCache:
    def __init__(self, capacity: int): ...
    def get(self, key: int) -> int: ...
    def put(self, key: int, value: int) -> None: ...
```

- **Constraints:** O(1) `get`/`put`; correct `maxFreq` maintenance; recency tie-break via per-bucket DLL order.
- **The hard part:** when a key is promoted from `maxFreq` to `maxFreq + 1`, `maxFreq` simply increases. But when the top bucket **empties** (its last key was just promoted, or it was the eviction victim), `maxFreq` must be **recomputed downward** to the next non-empty frequency. Promotion makes this O(1) (`maxFreq++`); eviction of the sole top-bucket key after a promotion needs the recompute. Explain in a comment why the LFU mirror (`minFreq`) only ever needs the cheap `+1`/`reset-to-1` updates, whereas naïve MFU can force a scan — and show how to avoid the scan by tracking bucket population.
- **Evaluation:** asserts no empty buckets linger in `freqMap`; `maxFreq` always equals the largest non-empty frequency.

**Task 7 — Invariant checker.**
Add a debug method `checkInvariants()` to your O(1) MFU that asserts: (I1) every resident key is in exactly the bucket matching its `freq`; (I2) each bucket is recency-ordered (head = MRU, tail = LRU); (I3) `maxFreq` equals the **largest** non-empty frequency; (I4) the eviction victim selected by the cache is always the tail of `freqMap[maxFreq]`. Run it after every operation in a randomized stress test against the simple MFU from Task 1.

**Task 8 — maxFreq-recompute torture test.**
Construct a deterministic operation sequence that forces the top bucket to empty repeatedly, so `maxFreq` must walk downward many times (e.g., raise one key to frequency `F`, evict it, and assert `maxFreq` collapses to the next populated level). Verify your recompute is correct and that you never leave a stale `maxFreq` pointing at an empty bucket. Report the worst-case number of downward steps per eviction your design incurs and whether per-bucket population counts make it O(1) amortized.

**Task 9 — Aging / decay MFU.**
The pathology of MFU is that hot keys are evicted while a *stuck* high-frequency key that is never touched again still blocks lower-frequency churn. Add periodic decay: after every `N` operations, halve every key's frequency (minimum 1) and rebuild the buckets, then recompute `maxFreq`. Demonstrate on a stream that makes one key reach a huge frequency and then abandons it: show the decayed cache stops treating it as the perpetual eviction target sooner than the non-decaying version.

**Task 10 — Windowed-frequency MFU.**
Replace the lifetime counter with a frequency measured over a sliding window of the last `W` accesses (e.g., a ring buffer of recent keys, or per-key timestamps with a cutoff). Eviction still targets the **highest windowed frequency**. Show that windowing makes MFU adapt: a key that was hot long ago but cold inside the window is no longer the eviction target. Compare the eviction decisions of lifetime-MFU vs windowed-MFU on a phase-shifting trace (`A`-heavy phase, then `B`-heavy phase).

## Advanced Tasks

**Task 11 — Trace-replay hit-ratio harness (looping, sequential, Zipfian).**
Build a replay harness that runs an access stream through MFU, LRU, and LFU and reports each one's hit ratio. Generate three traces and report a table of results for several capacities:

1. **Sequential scan** — `0,1,2,…,M-1` repeated. Each key is touched once per pass.
2. **Looping working set** — a small cycle `0..L-1` repeated many times with `L` slightly larger than capacity (the classic LRU pathology).
3. **Zipfian** — probability ∝ `1/rank^s`, `s≈0.9`.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

func zipf(n int, s float64, rnd *rand.Rand) func() int {
	z := rand.NewZipf(rnd, s, 1.0, uint64(n-1))
	return func() int { return int(z.Uint64()) }
}

func main() {
	// for each trace, for each cap: run MFU/LRU/LFU, print hit ratios
	fmt.Println("trace,policy,cap,hit_ratio")
}
```

#### Java

```java
public class Task11 {
    public static void main(String[] args) {
        // generate sequential / looping / zipfian traces
        // replay through MFU, LRU, LFU; print "trace,policy,cap,hit_ratio"
    }
}
```

#### Python

```python
import random

def looping_trace(loop_len: int, n_ops: int):
    return [i % loop_len for i in range(n_ops)]

# replay each trace through MFU, LRU, LFU; print a CSV table of hit ratios
```

- **Expected findings:** On the **looping working set just larger than capacity**, MFU can *beat* LRU (LRU evicts the soon-to-be-needed key every cycle; MFU keeps the low-frequency newcomers and dumps the saturated repeat-offender). On Zipfian and scan traces, MFU is typically the **worst** of the three — that contrast is the point of the exercise. Write two sentences explaining *why* the looping case flips the ranking.

**Task 12 — MFU vs MRU comparison harness.**
MFU (most-frequently-used) and MRU (most-recently-used) both evict "the popular thing", but along different axes. Implement an O(1) MRU cache (evict the most-recently-used key) and compare it head-to-head with your MFU on the looping and sequential traces from Task 11. Produce a per-operation log of where the two policies pick the same victim vs different victims, and summarize which workloads make them coincide and which separate them.

**Task 13 — MFU-with-TTL.**
Attach a per-entry time-to-live. A `get` on an expired entry is a **miss** and lazily removes the entry (decrementing its bucket and recomputing `maxFreq` if it was the top bucket's last member). On a `put` into a full cache, prefer evicting an already-expired entry over the max-frequency live one. Provide starter signatures in all three languages and a test that interleaves clock advances with accesses.

#### Go

```go
package main

type TTLMFU struct {
	// capacity, maxFreq, keyMap, freqMap, now func() int64
}

func New(capacity int, now func() int64) *TTLMFU      { /* implement */ return nil }
func (c *TTLMFU) Get(key int) (int, bool)             { /* implement */ return -1, false }
func (c *TTLMFU) Put(key, value int, ttlSeconds int64) { /* implement */ }

func main() {}
```

#### Java

```java
public class Task13 {
    static class TTLMFU {
        TTLMFU(int capacity, java.util.function.LongSupplier now) { /* implement */ }
        Integer get(int key) { /* implement */ return null; }
        void put(int key, int value, long ttlSeconds) { /* implement */ }
    }
    public static void main(String[] args) {}
}
```

#### Python

```python
from typing import Callable, Optional

class TTLMFU:
    def __init__(self, capacity: int, now: Callable[[], float]): ...
    def get(self, key: int) -> Optional[int]: ...
    def put(self, key: int, value: int, ttl_seconds: float) -> None: ...
```

**Task 14 — Sharded, thread-safe MFU.**
Make your O(1) MFU generic over key/value types and thread-safe. First with a single lock, then with **sharding** (N independent MFU shards by `hash(key) % N`). Note the semantic caveat: a sharded MFU evicts the max-frequency key *within each shard*, not globally — so it only approximates true MFU. Benchmark throughput (ops/sec) of the single-lock vs sharded version under concurrent readers and writers, and quantify how far the sharded eviction decisions drift from the single-lock ground truth on a shared trace.

**Task 15 — Property-based invariant test.**
Using a property-based framework (Go: `testing/quick` or `gopter`; Java: jqwik; Python: Hypothesis), generate random operation sequences and assert the **defining MFU invariant** after every step:

> **No non-max-frequency key is ever evicted while a max-frequency key exists.**

Concretely: capture the resident set before each `put`-triggered eviction, compute `maxFreq` over that set, and assert the victim's frequency equals `maxFreq` and that the victim is the LRU member of that frequency class. Add a second property cross-checking the O(1) cache's outputs against the O(n) simple MFU from Task 1 over identical random traces (same hits, same misses, same eviction victims). Shrink any failing case to a minimal counterexample and explain it.

## Benchmark Task

> Compare `get`/`put` throughput of your O(1) MFU across all three languages. Mix 80% gets / 20% puts over a Zipfian key distribution at several cache sizes. Because Zipfian access concentrates frequency on a few keys, watch how often the top bucket churns and how much the `maxFreq`-recompute path costs versus the LFU `minFreq` path.

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
	for _, cap := range sizes {
		c := Constructor(cap)
		// warm up
		for i := 0; i < cap; i++ {
			c.Put(i, i)
		}
		ops := 1_000_000
		start := time.Now()
		for i := 0; i < ops; i++ {
			k := int(rand.ExpFloat64() * float64(cap)) // skewed keys
			if i%5 == 0 {
				c.Put(k, k)
			} else {
				c.Get(k)
			}
		}
		elapsed := time.Since(start)
		fmt.Printf("cap=%7d: %.1f ns/op\n", cap, float64(elapsed.Nanoseconds())/float64(ops))
	}
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000};
        Random rnd = new Random(42);
        for (int cap : sizes) {
            Task6.MFUCache c = new Task6.MFUCache(cap);
            for (int i = 0; i < cap; i++) c.put(i, i);
            int ops = 1_000_000;
            long start = System.nanoTime();
            for (int i = 0; i < ops; i++) {
                int k = (int) (Math.abs(rnd.nextGaussian()) * cap) % Math.max(1, cap);
                if (i % 5 == 0) c.put(k, k); else c.get(k);
            }
            long elapsed = System.nanoTime() - start;
            System.out.printf("cap=%7d: %.1f ns/op%n", cap, (double) elapsed / ops);
        }
    }
}
```

#### Python

```python
import random
import time

sizes = [1_000, 10_000, 100_000]
for cap in sizes:
    c = MFUCache(cap)
    for i in range(cap):
        c.put(i, i)
    ops = 200_000
    start = time.perf_counter()
    for i in range(ops):
        k = int(random.expovariate(1.0) * cap) % cap
        if i % 5 == 0:
            c.put(k, k)
        else:
            c.get(k)
    elapsed = time.perf_counter() - start
    print(f"cap={cap:>7}: {elapsed / ops * 1e9:.1f} ns/op")
```
