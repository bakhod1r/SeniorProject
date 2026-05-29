# Multiset / Bag — Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Distributed Counting](#distributed-counting)
   - [Redis HINCRBY and Hash Tags](#redis-hincrby-and-hash-tags)
   - [Sharding the Counter Keyspace](#sharding-the-counter-keyspace)
3. [Approximate Frequency: Count-Min Sketch](#approximate-frequency-count-min-sketch)
4. [Heavy Hitters: Misra-Gries](#heavy-hitters-misra-gries)
5. [Streaming Top-K](#streaming-top-k)
6. [Capacity Planning](#capacity-planning)
7. [Concurrent Multisets](#concurrent-multisets)
8. [Observability](#observability)
9. [Failure Modes](#failure-modes)
10. [Architecture Sketch](#architecture-sketch)
11. [Summary](#summary)

---

## Introduction

> Focus: "How do I make a multiset survive Twitter-scale traffic, multi-region deployment, and adversarial inputs without blowing the memory budget?"

At the senior level the multiset stops being a `HashMap<T, int>` on one machine. Production systems care about three new constraints:

1. **Cardinality of the element set is huge** — billions of distinct URLs, IPs, search queries. A naive counter won't fit in RAM.
2. **Updates are concurrent and distributed** — many writers per second across many machines.
3. **Reads have an SLA** — top-k of trending hashtags must return in tens of milliseconds even while ingest is running.

The toolbox shifts from `Counter` to: distributed key-value counters, sketches that trade accuracy for memory, and streaming algorithms that bound state independent of stream length.

---

## Distributed Counting

### Redis HINCRBY and Hash Tags

The most common production multiset is a Redis hash with atomic counter increments:

```text
HINCRBY counters:page:home views 1
HINCRBY counters:page:home unique_visitors 1
HINCRBY counters:product:42 add_to_cart 1
```

Each Redis hash is itself a multiset (`field -> integer`). `HINCRBY` is atomic on the server, so concurrent writers cannot lose updates. Properties:

- **O(1) per increment** on the Redis side; round-trip dominates wall-clock time.
- **Atomic** — no compare-and-set loop needed in the client.
- **Pipelineable** — batch thousands of `HINCRBY` calls in one round trip.
- **Cluster-aware** — keys are sharded by the cluster slot of the *key* (not the field), so `counters:page:home` always lives on one shard.

When you want a group of related counters to live together on the same shard (e.g., to use `HSCAN` over them or to combine in a Lua script), use a **hash tag**: `counters:{page-bucket-17}:home`. Curly braces make Redis hash only the bracketed portion when choosing a slot.

### Sharding the Counter Keyspace

When a single hash exceeds tens of millions of fields, `HGETALL` becomes a multi-megabyte payload and blocks the event loop. Solutions:

- **Field-level sharding**: split into `counters:page:home:shard:0`, `:shard:1`, ... `shard_id = murmur3(field) % N`. Each shard has bounded size.
- **Key-level sharding** for hot keys: `views:page:home:bucket:{worker_id}` — every worker writes to its own bucket; a periodic job sums them. Eliminates the single-key write hotspot.

For monotonic counters there is also **CRDT G-Counter** (grow-only): each node keeps its own count, and the value is the sum. Increments never conflict. For increment+decrement you need a **PN-Counter** (positive minus negative); see professional.md for the formal proof of CRDT correctness.

---

## Approximate Frequency: Count-Min Sketch

When even a sharded exact counter is too much memory, switch to a **probabilistic sketch**. The Count-Min Sketch (CMS) trades a small over-estimation error for sub-linear memory.

```text
Structure:
  d hash functions, w columns
  table C: d x w grid of integers

Insert(x):
  for i in 1..d:
    C[i][h_i(x)] += 1

Query(x):
  return min over i of C[i][h_i(x)]
```

**Properties:**

- Memory: `d * w * sizeof(int)` — independent of the stream length.
- Always **over-estimates** (because of collisions); never underestimates.
- Error bound: with `w = ceil(e / eps)` and `d = ceil(ln(1/delta))`, with probability >= 1 - delta the estimate is within `eps * N` of the true count, where N is the total stream size.

**Worked sizing:** for a billion-event stream, `eps = 0.001`, `delta = 0.0001`:
- `w = e / 0.001 ~= 2719`
- `d = ln(10000) ~= 9.2 -> 10`
- Table: 10 * 2719 = ~27 K cells = ~108 KB at 4 bytes/cell.

That's it. 100 KB to estimate the frequency of any of a billion distinct items within ~1M.

### Sketch in Practice

#### Go

```go
package main

import (
	"hash/fnv"
	"math"
)

type CountMin struct {
	d, w   int
	table  [][]uint64
	seeds  []uint32
}

func NewCountMin(eps, delta float64) *CountMin {
	w := int(math.Ceil(math.E / eps))
	d := int(math.Ceil(math.Log(1 / delta)))
	cms := &CountMin{d: d, w: w, table: make([][]uint64, d), seeds: make([]uint32, d)}
	for i := 0; i < d; i++ {
		cms.table[i] = make([]uint64, w)
		cms.seeds[i] = uint32(i*2654435761) | 1
	}
	return cms
}

func (c *CountMin) hash(i int, x string) int {
	h := fnv.New32a()
	h.Write([]byte(x))
	v := h.Sum32() ^ c.seeds[i]
	return int(v) % c.w
}

func (c *CountMin) Add(x string) {
	for i := 0; i < c.d; i++ {
		c.table[i][c.hash(i, x)]++
	}
}

func (c *CountMin) Estimate(x string) uint64 {
	min := uint64(math.MaxUint64)
	for i := 0; i < c.d; i++ {
		v := c.table[i][c.hash(i, x)]
		if v < min {
			min = v
		}
	}
	return min
}
```

#### Java

```java
import java.util.zip.CRC32;

public class CountMin {
    private final int d, w;
    private final long[][] table;
    private final int[] seeds;

    public CountMin(double eps, double delta) {
        this.w = (int) Math.ceil(Math.E / eps);
        this.d = (int) Math.ceil(Math.log(1.0 / delta));
        this.table = new long[d][w];
        this.seeds = new int[d];
        for (int i = 0; i < d; i++) seeds[i] = (i * 0x9E3779B1) | 1;
    }

    private int hash(int i, String x) {
        CRC32 crc = new CRC32();
        crc.update(x.getBytes());
        long h = crc.getValue() ^ seeds[i];
        return (int) (Math.abs(h) % w);
    }

    public void add(String x) {
        for (int i = 0; i < d; i++) table[i][hash(i, x)]++;
    }

    public long estimate(String x) {
        long min = Long.MAX_VALUE;
        for (int i = 0; i < d; i++) min = Math.min(min, table[i][hash(i, x)]);
        return min;
    }
}
```

#### Python

```python
import math
import mmh3  # pip install mmh3

class CountMin:
    def __init__(self, eps: float, delta: float):
        self.w = math.ceil(math.e / eps)
        self.d = math.ceil(math.log(1 / delta))
        self.table = [[0] * self.w for _ in range(self.d)]
        self.seeds = [i * 0x9E3779B1 | 1 for i in range(self.d)]

    def _hash(self, i: int, x: str) -> int:
        return mmh3.hash(x, self.seeds[i]) % self.w

    def add(self, x: str) -> None:
        for i in range(self.d):
            self.table[i][self._hash(i, x)] += 1

    def estimate(self, x: str) -> int:
        return min(self.table[i][self._hash(i, x)] for i in range(self.d))
```

**Cross-link:** sketches sit in the broader family of probabilistic structures — see [21-advanced-structures](../../21-advanced-structures/) for HyperLogLog, t-digest, and the count-min-log variant.

---

## Heavy Hitters: Misra-Gries

Question: "Find every element appearing more than N/k times in a stream, using O(k) memory."

The **Misra-Gries** algorithm (1982) does exactly this with a tiny multiset of bounded size:

```text
Maintain a multiset M with at most k-1 entries.
For each incoming element x:
  if x in M:                     M[x] += 1
  elif |M| < k - 1:              M[x] = 1
  else:                          for each y in M: M[y] -= 1; delete keys reaching 0

After the stream, every element with true count > N/k is guaranteed to be in M.
M may contain false positives — confirm with a second pass.
```

**Guarantee:** After processing N items, `true_count(x) - N/k <= M[x] <= true_count(x)` for every x in M, and any x not in M has `true_count(x) <= N/k`. The under-count is at most N/k.

**Memory:** O(k) — independent of stream length and alphabet size. For "top-1% of URLs in 100B events" you need ~100 counter slots, regardless of the URL universe.

#### Go

```go
package main

func MisraGries(stream []string, k int) map[string]int {
	M := map[string]int{}
	for _, x := range stream {
		if _, ok := M[x]; ok {
			M[x]++
		} else if len(M) < k-1 {
			M[x] = 1
		} else {
			for y := range M {
				M[y]--
				if M[y] == 0 {
					delete(M, y)
				}
			}
		}
	}
	return M
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

public class MisraGries {
    public static Map<String, Integer> compute(Iterable<String> stream, int k) {
        Map<String, Integer> M = new HashMap<>();
        for (String x : stream) {
            if (M.containsKey(x)) {
                M.merge(x, 1, Integer::sum);
            } else if (M.size() < k - 1) {
                M.put(x, 1);
            } else {
                Iterator<Map.Entry<String, Integer>> it = M.entrySet().iterator();
                while (it.hasNext()) {
                    var e = it.next();
                    if (e.getValue() == 1) it.remove();
                    else e.setValue(e.getValue() - 1);
                }
            }
        }
        return M;
    }
}
```

#### Python

```python
def misra_gries(stream, k: int) -> dict[str, int]:
    M: dict[str, int] = {}
    for x in stream:
        if x in M:
            M[x] += 1
        elif len(M) < k - 1:
            M[x] = 1
        else:
            for y in list(M):
                M[y] -= 1
                if M[y] == 0:
                    del M[y]
    return M
```

A second pass is usually combined with this sketch to confirm exact counts for the candidates returned.

---

## Streaming Top-K

For a "top-K trending search queries" service:

- **Exact counter + min-heap** if the distinct cardinality fits in RAM (say < 100M strings). One node, periodically snapshot heap of size k.
- **Space-Saving algorithm (Metwally et al., 2005)** — refinement of Misra-Gries that gives O(k) memory and bounded error, optimized for top-k specifically. Used by Twitter Heron, ksqlDB.
- **CMS + min-heap** — track candidate set in heap, approximate true counts via CMS for new elements.
- **Sharded exact**: partition the stream by `hash(query)` to N workers, each keeps its local exact counts; merge top-K candidates at the coordinator. The "approximate top-k via union of local top-k" is a known false-negative trap — see [merge problem]; in practice you collect top `c*K` per shard for some `c >= log N` to bound the miss rate.

---

## Capacity Planning

| Workload | Backend | Memory | Caveat |
|----------|---------|--------|--------|
| Per-user feature counters (10M users x 100 counters) | Redis hash per user, `HINCRBY` | ~30 GB | Cluster across 6-10 nodes |
| URL view counts (1B distinct URLs) | Sharded RocksDB / Cassandra, or CMS | CMS: ~10-100 MB. Exact: TB-scale | CMS only if over-estimation tolerable |
| Real-time top hashtags (firehose) | Misra-Gries + periodic exact reconciliation | < 1 MB | Cold-cache shift after reconciliation |
| Daily unique visitors | HyperLogLog (cardinality, not multiset) | ~12 KB per metric | Different problem — HLL ignores per-element counts |
| Ad impression dedup count | Bloom filter (set) + counter | Bloom: ~1 GB for 1B at 1% FPR | Trades a small overcount for memory |

The recurring senior question is **exact vs. approximate**. Exact counts scale linearly with cardinality; approximate counts scale with desired accuracy, not with input size.

---

## Concurrent Multisets

### Go — sync.Map plus atomic

```go
import (
	"sync"
	"sync/atomic"
)

type ConcurrentMultiset struct {
	counts sync.Map // map[string]*int64
	total  int64
}

func (m *ConcurrentMultiset) Add(x string) {
	for {
		v, _ := m.counts.LoadOrStore(x, new(int64))
		p := v.(*int64)
		atomic.AddInt64(p, 1)
		atomic.AddInt64(&m.total, 1)
		return
	}
}
```

`sync.Map` plus pointer-to-`int64` plus `atomic.AddInt64` gives lock-free increments at the cost of one extra heap allocation per distinct key. For known-stable key sets this beats a `sync.RWMutex` around a plain map.

### Java — ConcurrentHashMap with merge

```java
ConcurrentHashMap<String, Long> counts = new ConcurrentHashMap<>();
counts.merge("apple", 1L, Long::sum);
```

`ConcurrentHashMap.merge` is atomic at the bucket level. Throughput scales near-linearly with cores. For very hot keys (single key receiving > 100 K writes/sec on one node), use a `LongAdder` per key — it stripes the counter across cells to avoid CAS contention:

```java
ConcurrentHashMap<String, LongAdder> counts = new ConcurrentHashMap<>();
counts.computeIfAbsent("apple", k -> new LongAdder()).increment();
long apples = counts.get("apple").sum();
```

### Python — process-wide GIL plus dict atomicity

CPython's GIL makes `d[k] = d.get(k, 0) + 1` actually NOT atomic (it does a read, an add, then a write). Two threads can both read 5 and both write 6. Always wrap with a `Lock` or use `collections.defaultdict(int)` + explicit lock. For real concurrency, scale via `multiprocessing` or push to Redis.

---

## Observability

| Metric | Why It Matters | Alert Threshold |
|--------|----------------|-----------------|
| `counter_distinct_keys` | Memory upper bound | 80% of configured budget |
| `counter_total_increments_per_sec` | Write throughput | > 90% of provisioned IOPS |
| `redis_hincrby_p99_ms` | Read+write SLA | > 5 ms |
| `cms_estimated_error_ratio` | Sketch accuracy drift | > 2x designed eps |
| `top_k_churn_rate` | Hot key dynamics | spikes indicate event/attack |
| `zero_count_lingering_keys` | Memory leak signal | > 1% of distinct keys |

The most overlooked metric is the last: a multiset that does not prune zero-count keys will show normal counts but ever-growing memory. Track key count separately from `size()`.

---

## Failure Modes

- **Hot key:** a single counter receives all the writes. Use per-worker buckets + periodic sum, or `LongAdder`.
- **Memory blowup from zero-count lingering keys:** enforce pruning at the wrapper level; periodically scan and delete.
- **Sketch saturation:** CMS counts saturate at `2^32 - 1` if you use `uint32`. Use `uint64` for any production stream.
- **Misra-Gries false positives:** confirm candidates with a second pass over a sample.
- **Cluster resharding:** moving a hash that holds counters can drop in-flight increments if the client is not idempotent. Use Redis `MIGRATE` carefully or shadow-write to both shards during transition.
- **Cross-shard top-k union bug:** taking the local top-K per shard and merging misses elements that are #K+1 in every shard but #1 globally. Mitigate by raising the per-shard pull to `c * K` with `c >= log N`.
- **Cardinality estimation drift:** if you also expose `distinct()`, use HyperLogLog rather than `map.size()` to avoid keeping the full map for that metric alone.

---

## Architecture Sketch

```text
[ Producers (web/app servers) ]
              |
              v
        Kafka topic: events
              |
   +----------+----------+
   |                     |
   v                     v
[ Aggregator ]      [ Aggregator ]      ... sharded by hash(key)
   - local Counter       - local Counter
   - flushes every 1s    - flushes every 1s
              |
              v
   [ Redis Cluster: HINCRBY counters:* fields ]
              |
              v
   [ Read API: GET counts, top-k via cached SortedSet ]
              |
              v
   [ Periodic batch: write to OLAP for historical ]
```

The pattern is universal: **counters live close to the producer** (locally aggregate to avoid hammering the central store), **flush in batches** (one HINCRBY per second per key per worker, not per event), and **separate the read path** (precomputed top-k cached, not derived from the live counter on each request).

---

## Summary

At senior level the multiset becomes a **system-design question**: cardinality budget, exact vs. approximate, single-node vs. distributed, hot-key contention, observability. The four foundational tools are:

1. **Redis `HINCRBY`** for distributed exact counting, sharded per business key.
2. **Count-Min Sketch** for sub-linear approximate frequency.
3. **Misra-Gries / Space-Saving** for streaming heavy hitters in O(k) memory.
4. **Sharded local aggregation + central merge** for hot-key resilience.

Combine these and you can count anything from per-user feature flags to the global top-100 trending phrases on a billion-event stream. The mathematics underneath — the multiplicity invariant from junior.md — has not changed. The infrastructure around it absolutely has.
