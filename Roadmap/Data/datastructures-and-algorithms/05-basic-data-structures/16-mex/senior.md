# MEX -- Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Production Use Cases](#production-use-cases)
   - [Distributed Sprague-Grundy Game Engines](#distributed-sprague-grundy-game-engines)
   - [ID Allocators and Slot Recycling](#id-allocators-and-slot-recycling)
   - [Telemetry Gap Detection](#telemetry-gap-detection)
   - [Range MEX in Analytical Query Engines](#range-mex-in-analytical-query-engines)
3. [Distributed MEX in Sharded Systems](#distributed-mex-in-sharded-systems)
4. [Online MEX with Concurrent Inserts and Deletes](#online-mex-with-concurrent-inserts-and-deletes)
5. [Lock-Free MEX Structures](#lock-free-mex-structures)
6. [Observability](#observability)
7. [Failure Modes](#failure-modes)
8. [Capacity Planning](#capacity-planning)
9. [Comparison with Alternatives](#comparison-with-alternatives)
10. [Summary](#summary)

---

## Introduction

> Focus: "How does MEX scale across cores, shards, and machines, and how do you observe it in production?"

At senior level MEX is no longer the one-liner "scan for the first missing index." It shows up as a load-bearing primitive in:

- ID allocators that recycle slots in long-running systems (file descriptors, session tokens, PID tables)
- Distributed game engines computing Sprague-Grundy values across sharded position tables
- Streaming telemetry gap detection (which sequence number did we never receive?)
- Range-MEX queries inside analytical engines over append-only event logs

In each of these the interesting questions are not "what is the smallest missing value" but rather "how do I compute it correctly when the data lives across N shards, and how do I observe its health when the working set drifts over hours of uptime?"

---

## Production Use Cases

### Distributed Sprague-Grundy Game Engines

Game-theoretic AIs for impartial games (Nim variants, hackenbush, sprouts, large-board subtraction games) compute Grundy numbers offline, store them in a position table, and serve them online to the move-search engine. For board sizes where the state space exceeds single-node memory (10^9+ positions), the position table is sharded by state hash across a fleet of workers.

The MEX-of-reachable computation now becomes a **distributed reduction**: for each position `p`, the worker emits `(p, G(p_next))` for every successor `p_next`; a downstream reducer collects all reachable Grundy values for a given `p` and computes their MEX. The reducer cannot start until all upstream emissions for `p` are complete -- otherwise the MEX may exclude a Grundy value that arrives late.

Implementation strategies:

- **Topological wave**: sort positions by depth; process all positions at depth `d+1` only after depth `d` is fully written. Each wave reads only the previous wave's results -- a clean BSP boundary.
- **Iterative until fixed point**: for games with cycles in the position graph (rare for impartial games, common for partial-information variants), iterate until no Grundy value changes. Convergence is guaranteed but the per-iteration cost is the full position count.

The MEX operation per position is bounded by `|moves|` (the branching factor), so the per-position work is O(b). The total work is O(S * b) where S is the state-space size. For Nim-like games with b = O(polylog S), this is essentially linear in the state space. Production engines parallelize the per-position MEX trivially -- each position's reachable Grundy set is independent.

### ID Allocators and Slot Recycling

Long-running services allocate and free numeric IDs constantly: file descriptors, session tokens, PIDs, slot indices in a thread-local cache, in-memory page numbers in a buffer pool. Two common allocation strategies:

- **Monotonic counter:** never recycle. Simple, but wastes IDs and eventually overflows. Used for log offsets where you never want reuse.
- **MEX-based recycling:** the next allocated ID is the MEX of the currently allocated set. Keeps IDs compact, reuses freed slots in bounded space.

The MEX-based version is what `select()`-style file-descriptor allocation does internally (allocate the smallest unused fd). Postgres uses a similar pattern for buffer pool slot reclamation. Redis uses MEX-like reasoning when assigning slot numbers to lazily-freed objects.

In multi-threaded systems the MEX-allocator must support concurrent insert/delete. A naive implementation locks a TreeSet of free IDs; high-throughput variants shard the free-list per core to avoid contention. Each core's MEX is local; on cross-core allocation the requesting core scans its peers' free lists in priority order. The global MEX is `min(per-core MEX)`; you allocate from whichever core won.

### Telemetry Gap Detection

A monitoring pipeline ingests events tagged with monotonically increasing sequence numbers per source. The question "which sequence numbers did we never receive?" is MEX-shaped: the answer is the smallest sequence number not present in the ingested set.

In practice the input is unbounded (event stream), so the structure must be **windowed**: keep a bitset of "seen sequence numbers within the last 60 seconds" and report the MEX of that window. As sequence numbers fall outside the window they're forgotten; new sequence numbers extend the window's right edge.

The MEX-pointer drift metric (described in the observability section below) tells operators whether the input stream is well-formed (MEX advances at ~the input rate) or stalled (MEX advances slowly, indicating gaps).

### Range MEX in Analytical Query Engines

Some OLAP systems support queries like "find the smallest event type that never occurred in the time range `[t1, t2]`." This is range MEX over an event-type-id array indexed by time. Production implementations build a persistent segment tree at ingestion time, keyed by event-type, storing the last-occurrence timestamp. The MEX query descends the tree looking for the leftmost event type whose last occurrence falls before `t1`.

The complexity is O(log V) per query where V is the cardinality of event types -- typically a few thousand, so each query is microseconds. The persistent tree is rebuilt incrementally as new events arrive, which keeps the ingestion-side overhead bounded at O(log V) per event.

---

## Distributed MEX in Sharded Systems

A common requirement: compute the MEX of a set whose elements live across `k` independent shards.

### Naive: gather and recompute

Every shard ships its full set to a coordinator; the coordinator unions them and computes MEX. Correct but expensive: O(N) network bytes per query. Only acceptable when the set is small or the query rate is low.

### Partial MEX with bound exchange

Each shard `i` computes a **partial MEX** -- the MEX of its local set -- and ships only `(local_mex_i, presence_bitset_below_threshold_T)` to the coordinator. The threshold `T` is chosen so the presence bitset is bounded (e.g., 64 KB = 524288 bits). The coordinator OR-merges the bitsets and computes the global MEX in one pass.

Correctness: if the global MEX `M < T`, the OR-merged bitset's first clear bit is `M` exactly. If `M >= T` (rare in practice), the coordinator falls back to a second round that requests more bits from each shard. Adaptive `T` keeps the common case fast.

### Bloom-style probabilistic MEX

For approximate MEX in extreme-scale settings, each shard maintains a Bloom filter of its set; the coordinator checks the union of filters in order 0, 1, 2, ... and returns the first index that all filters report as absent. False positives bias the answer downward (you may return a value that is actually present); false negatives are impossible. Useful for "give me a small unused ID quickly" workloads where occasional collision is recoverable via a retry.

### Pseudocode -- partial-MEX coordinator

```text
function distributed_mex(shards, T):
    bitsets = []
    for shard in shards in parallel:
        local = shard.compute_local_mex_and_bitset(threshold=T)
        bitsets.append(local.bitset)
    merged = OR_all(bitsets)
    m = merged.first_clear_bit()
    if m == T:
        # threshold was too small; recurse with larger T
        return distributed_mex(shards, T * 2)
    return m
```

### Go: coordinator skeleton

```go
package main

import (
    "context"
    "math/bits"
    "sync"
)

type ShardClient interface {
    LocalBitset(ctx context.Context, threshold int) ([]uint64, error)
}

// DistributedMEX merges per-shard presence bitsets via OR and returns the
// global MEX. The threshold T is the bit-length of each shard's bitset.
// Time: O(T/64 * k) for k shards. Network: O(T/8) bytes per shard.
func DistributedMEX(ctx context.Context, shards []ShardClient, T int) (int, error) {
    words := (T + 63) / 64
    merged := make([]uint64, words)
    var mu sync.Mutex
    var wg sync.WaitGroup

    errCh := make(chan error, len(shards))
    for _, s := range shards {
        wg.Add(1)
        go func(sc ShardClient) {
            defer wg.Done()
            bs, err := sc.LocalBitset(ctx, T)
            if err != nil {
                errCh <- err
                return
            }
            mu.Lock()
            for i := 0; i < len(bs) && i < words; i++ {
                merged[i] |= bs[i]
            }
            mu.Unlock()
        }(s)
    }
    wg.Wait()
    close(errCh)
    if err := <-errCh; err != nil {
        return 0, err
    }
    for i, w := range merged {
        if w != ^uint64(0) {
            return i*64 + bits.TrailingZeros64(^w), nil
        }
    }
    // All bits set; recurse with larger threshold (caller decides retry policy).
    return T, nil
}
```

### Java: parallel partial-MEX merge

```java
import java.util.BitSet;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class DistributedMEX {
    interface ShardClient {
        BitSet localBitset(int threshold);
    }

    public static int compute(List<ShardClient> shards, int threshold) {
        ExecutorService pool = Executors.newFixedThreadPool(shards.size());
        BitSet merged = new BitSet(threshold);
        List<CompletableFuture<BitSet>> futures = shards.stream()
            .map(s -> CompletableFuture.supplyAsync(() -> s.localBitset(threshold), pool))
            .toList();
        for (CompletableFuture<BitSet> f : futures) {
            synchronized (merged) { merged.or(f.join()); }
        }
        pool.shutdown();
        int m = merged.nextClearBit(0);
        return Math.min(m, threshold);  // caller retries on equality
    }
}
```

### Python: asyncio coordinator

```python
import asyncio
from typing import Callable, List

async def distributed_mex(shard_fetchers: List[Callable], threshold: int) -> int:
    """
    shard_fetchers: each is an async callable returning a bytearray bitset.
    Returns global MEX, or threshold if all bits below threshold are set.
    """
    bitsets = await asyncio.gather(*(f(threshold) for f in shard_fetchers))
    merged = bytearray((threshold + 7) // 8)
    for bs in bitsets:
        for i in range(len(merged)):
            merged[i] |= bs[i]
    for i, byte in enumerate(merged):
        if byte != 0xFF:
            for bit in range(8):
                if not (byte >> bit) & 1:
                    return i * 8 + bit
    return threshold
```

---

## Online MEX with Concurrent Inserts and Deletes

For high-throughput single-node MEX services (e.g., a session-ID allocator handling 200k requests per second) the structures from `middle.md` need to be made thread-safe without becoming serialization points.

### Coarse-grained lock

Wrap the TreeSet-of-missing in a single mutex. Simple, correct, scales poorly above ~50k ops/sec on a typical commodity server. Use this as the baseline.

### Striped locks over value buckets

Partition the value range `[0, cap]` into `B` buckets. Each bucket owns its own lock and a small bitset. The MEX is `min(per-bucket MEX)`; insert/delete acquire only the bucket lock. Throughput scales near-linearly with `B` until contention on the global MEX-pointer dominates.

### Lock-free linked list of "free ranges"

Maintain a sorted lock-free linked list of contiguous "free" ranges. Insert(v) removes v from its containing range, possibly splitting it into two; delete(v) inserts v into its successor or predecessor range, possibly merging. MEX is the smallest endpoint of the first range. Implementations use Harris-Michael lock-free linked lists with hazard pointers or epoch-based reclamation.

### Approximate MEX with sloppy counter

For workloads where strict MEX is not required (e.g., "any small unused ID"), each thread maintains a local "best guess" MEX and only synchronizes with the global structure on conflict. Throughput is excellent; correctness is bounded by an O(thread-count) skew.

### Go example: striped MEX allocator

```go
package main

import (
    "math/bits"
    "sync"
)

const stripeBits = 16 // 65536 IDs per stripe

type StripedMEX struct {
    stripes []*stripe
}

type stripe struct {
    mu     sync.Mutex
    bits   []uint64 // 1 = allocated
    minFree int     // cached MEX hint
}

func NewStripedMEX(numStripes int) *StripedMEX {
    s := &StripedMEX{stripes: make([]*stripe, numStripes)}
    for i := range s.stripes {
        s.stripes[i] = &stripe{
            bits: make([]uint64, 1<<stripeBits/64),
        }
    }
    return s
}

func (s *StripedMEX) Allocate() int {
    for sIdx, st := range s.stripes {
        st.mu.Lock()
        // Scan from minFree hint
        for w := st.minFree / 64; w < len(st.bits); w++ {
            if st.bits[w] != ^uint64(0) {
                b := bits.TrailingZeros64(^st.bits[w])
                st.bits[w] |= 1 << b
                st.minFree = w*64 + b + 1
                st.mu.Unlock()
                return sIdx*(1<<stripeBits) + w*64 + b
            }
        }
        st.mu.Unlock()
    }
    return -1 // all stripes full
}

func (s *StripedMEX) Free(id int) {
    sIdx := id >> stripeBits
    local := id & ((1 << stripeBits) - 1)
    st := s.stripes[sIdx]
    st.mu.Lock()
    st.bits[local/64] &^= 1 << (local % 64)
    if local < st.minFree {
        st.minFree = local
    }
    st.mu.Unlock()
}
```

### Java: ConcurrentSkipListSet-based MEX

```java
import java.util.concurrent.ConcurrentSkipListSet;
import java.util.concurrent.atomic.AtomicInteger;

public class ConcurrentMEX {
    // Tracks free IDs explicitly (small set). The MEX is the first element.
    private final ConcurrentSkipListSet<Integer> free = new ConcurrentSkipListSet<>();
    private final AtomicInteger highWater = new AtomicInteger(0);

    public int allocate() {
        Integer fromFree = free.pollFirst();
        if (fromFree != null) return fromFree;
        return highWater.getAndIncrement();
    }

    public void release(int id) {
        if (id == highWater.get() - 1) {
            highWater.decrementAndGet();
        } else {
            free.add(id);
        }
    }

    public int currentMEX() {
        Integer first = free.first();
        return (first != null) ? first : highWater.get();
    }
}
```

### Python: asyncio-friendly MEX with optimistic concurrency

```python
import asyncio
from sortedcontainers import SortedList

class AsyncMEX:
    def __init__(self, cap):
        self._missing = SortedList(range(cap + 1))
        self._lock = asyncio.Lock()

    async def insert(self, v):
        async with self._lock:
            self._missing.discard(v)

    async def delete(self, v):
        async with self._lock:
            self._missing.add(v)

    async def mex(self):
        async with self._lock:
            return self._missing[0]
```

The asyncio variant trades parallelism for simplicity; for true multi-thread parallelism in Python use `multiprocessing` with shared memory or move to a Go/Java implementation behind a service boundary.

---

## Lock-Free MEX Structures

True lock-free MEX with insert/delete/query is hard. The published approaches:

| Approach | Insert/Delete | MEX query | Memory |
|----------|---------------|-----------|--------|
| Harris-Michael free-range list | O(log n) expected | O(1) (read head) | O(free ranges) |
| Lock-free bitmap + CAS | O(1) per bit flip | O(n / 64) | O(n/8) bytes |
| Hazard-pointer skip list of missing | O(log n) | O(1) | O(n) |

The free-range list is the most space-efficient and the simplest to reason about. The bitmap version trades memory for predictability -- every operation is wait-free, but MEX is O(n/64), unacceptable for n > 10^6.

In practice most production systems pick striped locks instead of true lock-free. The throughput gap is small once contention is well-managed, and the engineering effort to get a lock-free version correct is large. Reserve lock-free MEX for truly latency-critical paths (sub-microsecond budgets) where every cache miss matters.

---

## Observability

MEX-based components are quiet until they explode. The metrics that matter:

| Metric | What it tells you | Alert threshold |
|--------|-------------------|-----------------|
| `mex.value` | Current MEX | n/a (sampled) |
| `mex.pointer_drift` | Rate of MEX increase per second | Compare against ingestion rate; large gap = missed inputs |
| `mex.missing_set_size` | Cardinality of currently-tracked missing values | > expected baseline by 3x |
| `mex.query_p99_us` | p99 latency of MEX queries | > 100 us |
| `mex.contention_ratio` | Lock acquisition retries / successful acquisitions | > 0.1 |
| `mex.recompute_count` | Number of full recomputations triggered | > 0 in steady state |
| `mex.shard_skew` | max(per-shard local MEX) - min(per-shard local MEX) | > 10000 (skewed allocation) |
| `mex.threshold_overflow` | Distributed MEX retries because threshold T was too small | > 5% of queries |

### MEX pointer drift

The most diagnostic single metric. For a healthy MEX-based allocator under steady-state allocation pressure, the MEX increases at roughly the allocation rate. If MEX stalls (drift = 0) while allocations continue, you have a leak in the deallocator -- IDs are being allocated and never freed. If MEX retreats faster than allocations occur, you have a double-free.

Track drift as a windowed rate over 60 seconds; alert on stall + nonzero allocation traffic.

### Missing-set size

For TreeSet-of-missing implementations, the missing set grows as the working set's high-water mark grows. A monotonically increasing missing-set size over hours is fine. A sudden jump (e.g., from 10k to 1M in one minute) signals a flood of new allocations or a bug in the bounded-cap logic.

### Go: instrumented MEX with metrics

```go
package main

import (
    "sync/atomic"
    "time"
)

type Metrics interface {
    Histogram(name string, value float64)
    Counter(name string, delta int64)
}

type ObservedMEX struct {
    inner       *StripedMEX
    metrics     Metrics
    lastMEX     atomic.Int64
    lastSampled atomic.Int64 // unix nanos
}

func (o *ObservedMEX) Allocate() int {
    start := time.Now()
    id := o.inner.Allocate()
    o.metrics.Histogram("mex.allocate.latency_us", float64(time.Since(start).Microseconds()))
    if int64(id) > o.lastMEX.Load() {
        prev := o.lastMEX.Swap(int64(id))
        prevTs := o.lastSampled.Swap(time.Now().UnixNano())
        if prevTs > 0 {
            drift := float64(int64(id)-prev) /
                (float64(time.Now().UnixNano()-prevTs) / 1e9)
            o.metrics.Histogram("mex.pointer_drift_per_sec", drift)
        }
    }
    return id
}
```

---

## Failure Modes

| Failure | Symptom | Fix |
|---------|---------|-----|
| ID leak | MEX advances; missing-set never grows | Audit deallocators; add finalizer-based safety net |
| Double-free | MEX retreats; same ID allocated twice | Track allocated-set with bloom filter; assert on insert collision |
| Threshold overflow on distributed MEX | Retry rate > 5% | Adaptive threshold; baseline T on observed MEX history |
| Shard skew | One shard's local MEX much higher | Rebalance allocation traffic; revisit shard key |
| Coordinator OOM on partial bitsets | Memory spike during merge | Stream-merge bitsets; cap T per call |
| Stale Grundy cache | Engine returns wrong Grundy after rule change | Version the cache key; invalidate on rule version bump |
| Lost gap detection in telemetry | MEX-stream window evicts before detection | Lengthen window; alert on window-edge eviction |
| Lock contention | Allocate latency p99 spikes under load | Switch coarse lock to striped; add backoff |
| Hash collision in concurrent map | Throughput collapses on adversarial keys | Use secure hash; or switch to skip-list |
| MEX of empty multiset returns nonzero | Initialization bug | Pre-populate missing set with [0..cap] at construction |

---

## Capacity Planning

For an MEX allocator with at most `N` concurrent live IDs:

| Structure | Memory per ID | Notes |
|-----------|---------------|-------|
| TreeSet of missing | ~50 bytes (Java) | Heavy on GC pressure |
| Segment tree on missing | 8 bytes per node, 2N nodes | Compact, cache-friendly |
| BitSet | 1 bit per slot | Cheapest; O(N/64) per MEX query |
| Sorted free-list | 16 bytes per free range | Best when allocations are clustered |
| Distributed bitset (per shard) | 1 bit per slot per shard | Multiply by replica count |

For `N = 10^7` live IDs:
- TreeSet: ~500 MB -- impractical
- Segment tree: ~160 MB -- workable on a 32 GB box
- BitSet: 1.25 MB -- trivial
- Sorted free-list: depends; for a well-recycled allocator with few free ranges, < 1 MB

Production choice for high-N: BitSet for static workloads, segment tree for high-update workloads. Distributed MEX adds network cost; budget 100 us per coordinator round-trip plus per-shard local-MEX cost (typically < 10 us for a striped allocator).

---

## Comparison with Alternatives

| Approach | Best for | Time/op | Concurrency story |
|----------|---------|---------|-------------------|
| TreeSet of missing | Small-to-medium N, single-node | O(log n) | Coarse lock |
| Segment tree on missing | Medium-to-large N, single-node | O(log n) | Coarse lock or per-leaf lock |
| BitSet + nextClearBit | Static or insert-only, single-node | O(n/64) MEX | Striped CAS |
| Striped lock allocator | High-throughput allocator | O(1) avg | Per-stripe lock |
| Lock-free free-range list | Sub-microsecond latency budget | O(log n) amortized | Hazard pointers / epoch |
| Distributed bitset + coordinator | Multi-shard, large N | O(T/64 + RTT) | Per-shard local + central merge |
| Bloom-based approximate MEX | Allocation hint only | O(1) | Eventually consistent |

Pick the simplest structure that meets your latency SLO. The default for a new service should be a coarse-locked TreeSet; only graduate to striped or lock-free under measured contention.

---

## Summary

At senior level MEX is a primitive embedded in allocators, distributed Sprague-Grundy engines, telemetry pipelines, and analytical query engines. The interesting axes are concurrency (coarse lock vs striped vs lock-free), distribution (partial-MEX-with-bitset coordination), and observability (pointer drift, missing-set size, shard skew). The algorithmic invariant `MEX <= n` from junior.md still holds locally; the production challenge is keeping it correct across shards, across cores, and across hours of uptime.

The structure is small; the failure modes are sneaky. Instrument early, alert on drift, and prefer simple locking until measured contention forces you up the complexity ladder.
