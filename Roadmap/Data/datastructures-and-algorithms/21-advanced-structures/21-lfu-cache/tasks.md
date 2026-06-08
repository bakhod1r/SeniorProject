# LFU Cache — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> The reference designs live in [`junior.md`](./junior.md), [`middle.md`](./middle.md), and [`senior.md`](./senior.md). Compare against [LRU](../01-lru-cache/tasks.md) where noted.

## Beginner Tasks

**Task 1 — Simple LFU from scratch.**
Implement an LFU cache with `get(key)` and `put(key, value)` using a single hash map of `(value, freq, lastUsed)` entries. Eviction may scan for the minimum (O(n) is fine here). New keys start at frequency 1; ties break by least-recently-used.

#### Go

```go
package main

type SimpleLFU struct {
	// capacity, tick, data map[int]*entry
}

func NewSimple(capacity int) *SimpleLFU { /* implement */ return nil }
func (c *SimpleLFU) Get(key int) int    { /* implement */ return -1 }
func (c *SimpleLFU) Put(key, value int) { /* implement */ }

func main() {
	// c := NewSimple(2); c.Put(1,1); c.Put(2,2); ...
}
```

#### Java

```java
public class Task1 {
    static class SimpleLFU {
        SimpleLFU(int capacity) { /* implement */ }
        int get(int key) { /* implement */ return -1; }
        void put(int key, int value) { /* implement */ }
    }
    public static void main(String[] args) {
        // SimpleLFU c = new SimpleLFU(2);
    }
}
```

#### Python

```python
class SimpleLFU:
    def __init__(self, capacity: int):
        ...  # implement

    def get(self, key: int) -> int:
        ...  # implement

    def put(self, key: int, value: int) -> None:
        ...  # implement


if __name__ == "__main__":
    pass
```

- **Constraints:** correct LFU + LRU tie-break behavior; handle `capacity == 0`.
- **Expected:** matches the worked example in `junior.md`.
- **Evaluation:** correctness on hit/miss/evict, recency tie-break, edge cases.

**Task 2 — Track frequencies.**
Extend Task 1 with `frequency(key) int` that returns the current access count of a key (or `0`/`-1` if absent). Verify `get` and `put`-update both increment it, and a new key reports frequency 1 after insertion.

**Task 3 — Capacity-zero and capacity-one.**
Write tests proving: a capacity-0 LFU stores nothing (`get` always `-1`); a capacity-1 LFU holds exactly one key and replaces it on any new `put`. Provide the test harness in all three languages.

**Task 4 — Reconstruct the eviction trace.**
Given a capacity and a sequence of operations (e.g., `put 1 1; put 2 2; get 1; put 3 3`), print after each step the resident keys with their frequencies, and announce each eviction with the victim key and the reason ("min freq" or "min freq + LRU tie-break").

**Task 5 — LFU vs LRU divergence finder.**
Write a function that, given a capacity and an access stream of keys, runs **both** a simple LFU and a simple LRU and prints the first operation at which they evict **different** keys (or "never diverge"). Use it to confirm `A B B A C` (capacity 2) is a divergence case.

## Intermediate Tasks

**Task 6 — O(1) LFU (LeetCode 460).**
Implement the full O(1) design: `keyMap` (key→node), `freqMap` (freq→recency-ordered doubly linked list), and a `minFreq` integer. Both `get` and `put` must be O(1). Provide starter code in all three languages.

#### Go

```go
package main

type LFUCache struct {
	// capacity, minFreq, keyMap, freqMap
}

func Constructor(capacity int) LFUCache { /* implement */ return LFUCache{} }
func (c *LFUCache) Get(key int) int     { /* implement */ return -1 }
func (c *LFUCache) Put(key, value int)  { /* implement */ }

func main() {}
```

#### Java

```java
public class Task6 {
    static class LFUCache {
        LFUCache(int capacity) { /* implement */ }
        int get(int key) { /* implement */ return -1; }
        void put(int key, int value) { /* implement */ }
    }
    public static void main(String[] args) {}
}
```

#### Python

```python
class LFUCache:
    def __init__(self, capacity: int): ...
    def get(self, key: int) -> int: ...
    def put(self, key: int, value: int) -> None: ...
```

- **Constraints:** O(1) `get`/`put`; correct `minFreq` maintenance; recency tie-break via per-bucket DLL order.
- **Evaluation:** passes LeetCode 460 test cases; assert no empty buckets linger in `freqMap`.

**Task 7 — Invariant checker.**
Add a debug method `checkInvariants()` to your O(1) LFU that asserts: (I1) every resident key is in exactly the bucket matching its `freq`; (I2) each bucket is recency-ordered; (I3) `minFreq` equals the smallest non-empty frequency. Run it after every operation in a randomized stress test against the simple LFU from Task 1.

**Task 8 — Decaying LFU (aging fix).**
Add periodic decay: after every `N` operations, halve every key's frequency (minimum 1) and rebuild the buckets. Demonstrate, on a stream that makes one key very hot then abandons it, that the stale key eventually becomes evictable (contrast with the non-decaying version, where it never does).

**Task 9 — Hit-ratio simulator.**
Write a simulator that replays an access stream through both an LFU and an LRU cache and reports each one's hit ratio. Generate a **Zipfian** stream (probability ∝ `1/rank^s`) and confirm LFU's hit ratio exceeds LRU's at the same capacity for `s` around 0.8–1.0.

**Task 10 — Scan-resistance demo.**
Build a stream of the form `H H H (scan of unique keys longer than capacity) H` and verify, for capacity `k`, that LFU serves the trailing `H` as a **hit** while LRU serves it as a **miss**. Report the hit/miss outcome for both in all three languages.

## Advanced Tasks

**Task 11 — Approximate LFU with a Morris counter.**
Replace exact frequencies with an 8-bit logarithmic (Morris/Redis-style) counter: increment with probability `1 / (base * factor + 1)`, saturating at 255, new keys starting at 5. Evict by **sampling** K random keys and dropping the lowest counter. Provide starter code in all three languages and compare memory per entry to the exact O(1) LFU.

#### Go

```go
package main

type ApproxLFU struct {
	// capacity, logFactor, sampleSize, data map[int]*item (counter uint8)
}

func New(capacity int) *ApproxLFU       { /* implement */ return nil }
func (c *ApproxLFU) Get(key int) (int, bool) { /* implement */ return -1, false }
func (c *ApproxLFU) Put(key, value int) { /* implement */ }

func main() {}
```

#### Java

```java
public class Task11 {
    static class ApproxLFU {
        ApproxLFU(int capacity) { /* implement */ }
        Integer get(int key) { /* implement */ return null; }
        void put(int key, int value) { /* implement */ }
    }
    public static void main(String[] args) {}
}
```

#### Python

```python
class ApproxLFU:
    def __init__(self, capacity: int): ...
    def get(self, key: int): ...   # returns value or None
    def put(self, key: int, value: int) -> None: ...
```

**Task 12 — TinyLFU admission filter.**
Implement a Count-Min frequency sketch (`d` hash rows, 4-bit saturating counters) with reset-on-N decay. Build a cache that, on a miss into a full cache, admits the new key **only if** its estimated frequency ≥ the victim's estimate; otherwise rejects it. Measure how admission improves hit ratio on a stream dominated by singletons (one-hit wonders).

**Task 13 — W-TinyLFU (window + main region).**
Add a small LRU **admission window** (~1% of capacity) in front of your TinyLFU from Task 12. New keys enter the window; window evictions are gated into the main region by the sketch. Compare hit ratios of LRU vs LFU vs TinyLFU vs W-TinyLFU on a bursty Zipfian trace.

**Task 14 — Generic, thread-safe LFU.**
Make your O(1) LFU generic over key/value types and thread-safe. First with a single lock, then with **sharding** (N independent LFU shards by `hash(key) % N`). Benchmark throughput (ops/sec) of the single-lock vs sharded version under concurrent readers and writers.

**Task 15 — Cost/size-aware LFU (CDN style).**
Extend eviction to weight by object size: instead of evicting the lowest frequency, evict the lowest `frequency / size` (GreedyDual-Size-Frequency intuition). Demonstrate on a workload mixing many small hot objects and one huge cold object that the size-aware policy yields a better **byte hit ratio** than plain LFU.

## Benchmark Task

> Compare `get`/`put` throughput of your O(1) LFU across all three languages. Mix 80% gets / 20% puts over a Zipfian key distribution at several cache sizes.

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
            Task6.LFUCache c = new Task6.LFUCache(cap);
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
    c = LFUCache(cap)
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
