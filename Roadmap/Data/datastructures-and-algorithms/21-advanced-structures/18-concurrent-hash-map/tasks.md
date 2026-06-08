# Concurrent Hash Map — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Test every solution under real concurrency (Go: run with `-race`; Java: many threads; Python: `threading`, and ideally a free-threaded build).

---

## Beginner Tasks

### Task 1 — Wrap a map with one mutex

Implement `SafeMap` with `Get`, `Put`, `Delete` using a single `Mutex`. Prove it's safe by launching 1000 goroutines/threads that each `Put` a distinct key, then assert size == 1000.

#### Go

```go
package main

import "sync"

type SafeMap struct {
	mu sync.Mutex
	m  map[string]int
}

// TODO: NewSafeMap, Get(key)(int,bool), Put(key,value), Delete(key)

func main() {
	// TODO: 1000 goroutines each Put a unique key; print len
}
```

#### Java

```java
import java.util.HashMap;

public class Task1 {
    // TODO: SafeMap class with synchronized get/put/delete over a HashMap
    public static void main(String[] args) throws Exception {
        // TODO: 1000 threads each put a unique key; print size
    }
}
```

#### Python

```python
import threading

class SafeMap:
    def __init__(self):
        self._lock = threading.Lock()
        self._d = {}
    # TODO: get, put, delete

if __name__ == "__main__":
    pass  # TODO: 1000 threads each put a unique key; print len
```

- **Constraints:** exactly one lock; no data races.
- **Expected Output:** `size = 1000`.
- **Evaluation:** correctness under concurrency, proper unlock on every path.

### Task 2 — Demonstrate the lost-update bug, then fix it

Write a counter map where 8 threads each do `m["hits"] += 1` 10000 times **without** synchronization and observe a total < 80000 (or a Go crash). Then add a lock to the increment and show it equals 80000.

- Provide starter code in all 3 languages.
- **Constraints:** show both the broken and fixed versions side by side.
- **Expected Output:** broken: `< 80000` (or crash); fixed: `80000`.

### Task 3 — Upgrade to `RWMutex` and benchmark reads

Reimplement `SafeMap` using a read-write lock. Run a 90% read / 10% write workload with 16 threads and compare throughput against the `Mutex` version.

- **Constraints:** readers use the shared (read) lock; writers the exclusive lock.
- **Expected Output:** RWMutex version handles more reads/sec under the read-heavy load.

### Task 4 — Use the built-in concurrent map

Rewrite Task 1 using the language's native concurrent map: Go `sync.Map`, Java `ConcurrentHashMap`, Python `dict` + `Lock` (for the compound parts). No custom mutex wrapper for Go/Java.

- **Constraints:** use `LoadOrStore` / `putIfAbsent` for get-or-insert.
- **Expected Output:** `size = 1000`.

### Task 5 — Atomic get-or-compute (memoization cache)

Implement `GetOrCompute(key, computeFn)` that runs `computeFn` **at most once per key** even when many threads request the same missing key simultaneously. Count how many times `computeFn` actually runs.

- **Constraints:** Java must use `computeIfAbsent`; Go/Python hold one lock across check-and-store.
- **Expected Output:** `computeFn` invocation count == number of distinct keys.

---

## Intermediate Tasks

### Task 6 — Sharded (lock-striped) map

Build a `ShardedMap` with `N = 32` shards (`hash(key) & (N-1)`), each a `(lock, map)` pair, with `Get`, `Put`, `Delete`, `Len`. Show two threads writing to different shards never block each other.

- Provide starter code in all 3 languages.
- **Constraints:** N power of two; route with bitmask, not modulo.
- **Expected Output:** correct `Len` after a concurrent insert storm.

### Task 7 — Striped counter (`LongAdder`-style)

Implement a `StripedCounter` with `Inc()` and `Sum()` where increments spread across `K` cells (one per thread region) to avoid contention on a single counter. Compare `Inc` throughput against a single mutex-protected counter under 16 threads.

- **Constraints:** Java may use `java.util.concurrent.atomic.LongAdder` AND a hand-rolled version; Go/Python hand-roll with per-cell locks or atomics.
- **Expected Output:** striped version has higher increment throughput; `Sum()` equals total increments.

### Task 8 — `putIfAbsent` from scratch

Without using the built-in atomic method, implement a correct `PutIfAbsent(key, value) -> (existing, loaded)` on a sharded map. Then stress it: many threads racing to insert the same key must all agree on the single winning value.

- **Constraints:** the check and the insert must be atomic within the shard.
- **Expected Output:** all threads observe the same stored value; exactly one insert "won".

### Task 9 — Copy-on-write read-mostly map

Implement a COW map: reads are lock-free (single atomic load of an immutable map); writes copy the whole map under a writer lock and atomically publish. Verify reads never block and never see a half-updated map.

- **Constraints:** Go `atomic.Value`; Java `AtomicReference<Map>`; Python attribute rebind under a write lock.
- **Expected Output:** consistent reads throughout a write storm; write cost grows with size.

### Task 10 — Concurrent iteration / snapshot

Add a `Snapshot()` to your sharded map that returns a consistent copy of all entries (lock each shard while copying it). Compare against iterating the live map while another thread mutates it.

- **Constraints:** snapshot must not crash and must reflect a valid (if slightly stale) view.
- **Expected Output:** no `ConcurrentModificationException` / no torn read; snapshot is internally consistent per shard.

---

## Advanced Tasks

### Task 11 — Incremental concurrent resize

Implement a sharded map that, when a shard's load factor exceeds 0.75, **resizes that shard's table incrementally** (move K buckets per subsequent op rather than all at once). Verify that `Get`/`Put` remain correct *during* the migration by checking both old and new tables.

- Provide starter code in all 3 languages.
- **Constraints:** no stop-the-world rehash; lookups consult both tables mid-migration.
- **Expected Output:** all keys findable at every instant during resize.

### Task 12 — Simulate `ForwardingNode` redirection

Model Java 8 CHM's resize: when a bucket is transferred, replace its head with a forwarding marker that redirects subsequent ops to the new table. Run concurrent reads during the transfer and assert no key is ever "lost".

- **Constraints:** transferred bucket must redirect; un-transferred bucket served from old table.
- **Expected Output:** 100% of pre-existing keys found throughout the resize.

### Task 13 — Hash-flooding defense (tree-bin)

Construct adversarial keys that all collide into one bucket of your map and measure lookup time degrading to O(n). Then convert a bucket whose chain length exceeds 8 into a balanced tree (red-black or just a sorted structure) and re-measure O(log n).

- **Constraints:** treeify above length 8; untreeify below 6.
- **Expected Output:** worst-case lookup drops from linear to logarithmic on the colliding bucket.

### Task 14 — False-sharing experiment

Take your `StripedCounter` and (a) pack cells adjacently in one array, then (b) pad each cell to a 64-byte cache line. Benchmark `Inc` throughput with 16 threads in both layouts and explain the gap.

- **Constraints:** Java `@jdk.internal.vm.annotation.Contended` (or manual padding); Go padding fields; Python note the GIL limits the effect but still measure.
- **Expected Output:** padded version is measurably faster (often 2–5×) on multi-core.

### Task 15 — Benchmark four designs head-to-head

Benchmark (1) single mutex, (2) sharded `RWMutex`, (3) native concurrent map, (4) COW map across read:write ratios of 50/50, 90/10, and 99/1 with 1/4/16 threads. Produce a table of ops/sec and recommend which design wins each cell.

- **Constraints:** identical key distribution and op count per run.
- **Expected Output:** a results matrix; COW/RCU-style wins at 99/1, sharded wins at 50/50, etc.

---

## Benchmark Task

> Compare a single-mutex map vs a 32-shard map under a write-heavy load across all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	sizes := []int{1, 4, 8, 16} // thread counts
	for _, threads := range sizes {
		// TODO: run N total Puts split across `threads` goroutines on a
		// single-mutex map and on a 32-shard map; print ops/sec for each.
		_ = threads
		start := time.Now()
		var wg sync.WaitGroup
		_ = wg
		fmt.Printf("threads=%2d: %v\n", threads, time.Since(start))
	}
}
```

#### Java

```java
import java.util.concurrent.*;

public class Benchmark {
    public static void main(String[] args) throws Exception {
        int[] threadCounts = {1, 4, 8, 16};
        for (int threads : threadCounts) {
            // TODO: split total Puts across `threads`; time synchronizedMap
            // vs ConcurrentHashMap vs a 32-shard map; print ops/sec.
            long start = System.nanoTime();
            System.out.printf("threads=%2d: %.1f ms%n", threads, (System.nanoTime()-start)/1e6);
        }
    }
}
```

#### Python

```python
import time, threading

def main():
    for threads in (1, 4, 8, 16):
        # TODO: split total puts across `threads`; time single-Lock map
        # vs 32-shard StripedMap; print ops/sec. (Note GIL limits scaling.)
        start = time.perf_counter()
        print(f"threads={threads:>2}: {(time.perf_counter()-start)*1000:.1f} ms")

if __name__ == "__main__":
    main()
```

**Report:** For each design, plot ops/sec vs thread count. Expect the single mutex to flatten immediately, the sharded map to scale until shard skew or false sharing dominates, and (in Python) the GIL to cap CPU-bound scaling regardless of design.
