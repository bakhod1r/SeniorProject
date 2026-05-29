# Set (Set ADT) — Senior Level

## Table of Contents

1. [Sets at System Scale](#sets-at-system-scale)
2. [Architecture: Distributed Set Service](#architecture-distributed-set-service)
3. [Redis SET Commands in Production](#redis-set-commands-in-production)
4. [Sharded Set Operations](#sharded-set-operations)
5. [Approximate Sets — Bloom Filters and HyperLogLog](#approximate-sets--bloom-filters-and-hyperloglog)
6. [CRDT Sets — Eventual Consistency](#crdt-sets--eventual-consistency)
7. [Concurrent and Lock-Free Sets](#concurrent-and-lock-free-sets)
8. [Capacity Planning](#capacity-planning)
9. [Observability](#observability)
10. [Failure Modes](#failure-modes)
11. [Summary](#summary)

---

## Sets at System Scale

A single-process `HashSet` peaks at maybe 10⁸ entries before GC pressure or page-fault rate becomes the bottleneck. At system scale you move from "data structure" to "data service": multiple processes, machines, datacenters, all sharing membership decisions. The Set ADT survives intact, but every operation grows hidden costs: network latency, partial failures, consistency guarantees, and memory budgets measured in gigabytes.

This page walks the senior-level decision space: which approximate set, which sharding strategy, which consistency mode, what to measure, and what breaks first.

---

## Architecture: Distributed Set Service

A representative production setup for "is this user-id allowed?" at billions of operations per day:

```text
                +----------------+
client ----- >  | API Gateway    |
                +-------+--------+
                        |
              hash(uid) routes to one of N shards
                        v
   +------------------------------------------------+
   |  Sharded membership service (N replicas each)   |
   |                                                 |
   |  +-----------+    +-----------+    +---------+ |
   |  | Shard 0   |    | Shard 1   |... | Shard N | |
   |  |           |    |           |    |         | |
   |  | Bloom     |    | Bloom     |    | Bloom   | |
   |  |   |       |    |   |       |    |   |     | |
   |  | Redis SET |    | Redis SET |    | Redis   | |
   |  |   |       |    |   |       |    |   |     | |
   |  | Postgres  |    | Postgres  |    | Postgres| |
   |  +-----------+    +-----------+    +---------+ |
   +------------------------------------------------+
```

Three tiers stacked from cheapest to most authoritative:

1. **Bloom filter** in-process — fastest, allows a small false-positive rate, eliminates ~99% of negative lookups.
2. **Redis SET** — hot membership cache, sub-millisecond, eventually consistent with the database.
3. **PostgreSQL table** — source of truth, durable, the only writer.

Reads cascade top-down; writes go to PostgreSQL, then invalidate Redis, then update the Bloom filter (often via rebuild from a periodic scan, since Bloom filters cannot remove).

Latency budget for `contains(x)`:
- Bloom hit "definitely no": ~50 ns local memory.
- Redis hit: ~250 μs (one round trip).
- Postgres hit: ~2 ms (one indexed query).

That stacking buys 4–5 orders of magnitude of latency reduction on negative cases — and a banned-list is mostly negative cases.

---

## Redis SET Commands in Production

Redis is the workhorse for distributed sets. Its `SET` type is a HashSet of strings (or intset-encoded if all integers fit in 64 bits), and its commands map directly to set algebra.

| Command | Operation | Complexity |
|---|---|---|
| `SADD key member [member ...]` | add elements | O(N) added |
| `SREM key member [member ...]` | remove elements | O(N) removed |
| `SISMEMBER key member` | contains | O(1) |
| `SMISMEMBER key m1 m2 ...` | batch contains | O(N) |
| `SCARD key` | size | O(1) |
| `SMEMBERS key` | iterate all | O(N), blocking |
| `SSCAN key cursor` | iterate streaming | O(1) per call |
| `SUNION k1 k2 ...` | A ∪ B ∪ ... | O(total elements) |
| `SINTER k1 k2 ...` | A ∩ B ∩ ... | O(min(...) * K) |
| `SDIFF k1 k2 ...` | A \ B \ ... | O(total elements) |
| `SUNIONSTORE dst k1 k2` | union into key | O(total) + persist |
| `SINTERCARD k1 k2 LIMIT n` | count of intersection, capped | O(min(...) * K) |

Two production lessons:

1. **`SMEMBERS` on a million-element set blocks Redis** for tens of milliseconds. Use `SSCAN` for any set you cannot bound. Redis is single-threaded; one slow command stalls every client.
2. **`SINTERSTORE`/`SUNIONSTORE` write large keys** that may cross your `maxmemory` policy. Wrap with `SINTERCARD` when you only need the count.

```text
# Track unique daily visitors with HyperLogLog (next section) when the actual
# member identities are not needed:
PFADD visitors:2026-05-29  user:123 user:456 user:789
PFCOUNT visitors:2026-05-29
PFMERGE visitors:week-22 visitors:2026-05-23 ... visitors:2026-05-29
```

---

## Sharded Set Operations

When a set grows beyond a single Redis node (~hundreds of millions of members), you must shard. The hard part is preserving set-algebra semantics across shards.

### Sharding by Hash of Element

`shard = hash(member) mod N`. Now `SADD`, `SREM`, `SISMEMBER` are one-shard operations.

**Union across shards**:
```text
SUNION(A, B) = ∪ over shards s of SUNION(A_s, B_s)
```
Each shard locally computes its piece, the coordinator concatenates streams. Total cost: O(|A| + |B|) network bytes.

**Intersection across shards**:
```text
SINTER(A, B) = ∪ over shards s of SINTER(A_s, B_s)
```
Same routing — because both A and B are sharded by the same hash function, an element in both must land in the same shard. Each shard intersects locally; coordinator unions. Total cost: O(|min(A, B)|) network bytes — far less than the union.

This is exactly how MPP databases (Snowflake, BigQuery) execute set operators on hash-distributed tables.

### Sharding by Set Key

When you store many small-to-medium sets, shard by set key (`shard = hash(setKey) mod N`). Each set lives entirely on one shard; one-set operations are fully local.

**Cross-set operations** now require either:
- Co-located keys (Redis Cluster: hash-tag braces force same shard, e.g. `{user:42}:friends` and `{user:42}:blocked`), or
- A multi-shard fan-out with stream merge.

### Resharding

When you grow from N to 2N shards, naive `hash mod N` resharding remaps every member. Use **consistent hashing** (see topic `05-hash-tables`) to keep only ~1/N of members in motion. During migration, both old and new shards must be consulted for reads, and writes go to the new shard with a fallback.

---

## Approximate Sets — Bloom Filters and HyperLogLog

When exact membership is overkill, two approximate sets dominate.

### Bloom Filter

- Bit array `m` plus `k` hash functions.
- `add(x)`: set `k` bits computed from `hash_i(x)`.
- `contains(x)`: return true iff all `k` bits are set.
- **No false negatives**, tunable false-positive rate `p`.
- Cannot delete (use **Counting Bloom Filter** or **Cuckoo Filter** if deletes are needed).
- Optimal size: `m = -(n · ln p) / (ln 2)²`, hash count: `k = (m/n) · ln 2`.

For 1 million elements at p = 1%: m ≈ 9.6 Mbit ≈ 1.2 MB. Compare to ~100 MB for a real HashSet.

### HyperLogLog

- Probabilistic cardinality estimator. Answers "how many distinct elements?" not "is x present?".
- Uses ~12 KB to estimate sets up to 2⁶⁴ distinct elements with ~0.81% standard error.
- Mergeable: `HLL(A ∪ B) = merge(HLL(A), HLL(B))` — counts of unions can be combined from sketches without re-seeing data.

Use cases: unique-visitor counts, distinct IP counts per day, click-stream cardinality. Redis exposes it as `PFADD` / `PFCOUNT` / `PFMERGE`.

### Comparison

| Question | Best tool |
|---|---|
| "Is x in S?" with no false negatives | HashSet (exact) |
| "Is x in S?" tolerating ~1% false positives | Bloom filter |
| "How many distinct in S?" | HyperLogLog |
| "What elements are in S?" | HashSet (Bloom cannot enumerate) |
| "Add and delete repeatedly" | Counting Bloom filter or Cuckoo filter |

See topic `21-advanced-structures` for full coverage of these probabilistic structures.

---

## CRDT Sets — Eventual Consistency

When replicas of a set live in different datacenters and updates happen offline (mobile apps, multi-region writes), **Conflict-free Replicated Data Types** let each replica converge to the same set without coordination.

### G-Set (Grow-only Set)

- `add` is allowed; `remove` is not.
- Merge: union of replicas.
- Trivially convergent.
- Use case: append-only event logs, immutable ID registry.

### 2P-Set (Two-Phase Set)

- Two G-Sets: `added` and `removed` (tombstones).
- `contains(x) = x ∈ added ∧ x ∉ removed`.
- An element, once removed, cannot be re-added.
- Merge: union both component G-Sets.

### OR-Set (Observed-Remove Set)

- Each `add(x)` tags x with a unique ID (replica ID + counter).
- `remove(x)` removes only the IDs observed at the time of remove.
- Concurrent add-then-remove leaves the element present (add wins concurrent conflicts).
- Used by Riak, Redis Enterprise, Akka Distributed Data.

### LWW-Element-Set

- Each add/remove timestamped. Latest operation wins.
- Simple but relies on synchronized clocks (or HLC — hybrid logical clocks).

| CRDT | Re-add after remove? | Storage growth | Use case |
|---|---|---|---|
| G-Set | n/a (no remove) | linear with adds | append-only |
| 2P-Set | no | linear with all ops | one-way removal |
| OR-Set | yes | bounded with GC | general purpose |
| LWW | yes (timestamp wins) | bounded | clock-synced systems |

The cost of CRDTs is metadata — IDs, timestamps, or tombstones live forever (or until garbage collection). At 1 KB of metadata per element this adds up, so GC strategy matters in production.

---

## Concurrent and Lock-Free Sets

Single-machine sets at high concurrency face a different problem: locks.

### Coarse-Grained Locking

One mutex around the entire set. Simple, correct, **does not scale**. Throughput is bounded by lock contention; 8 cores rarely give more than 1.5x over a single core.

### Lock Striping

The hash table is partitioned into `S` stripes; each stripe has its own lock. A write to bucket `b` locks `lock[b mod S]`. Reads concurrent on different stripes proceed in parallel. Java's pre-Java 8 `ConcurrentHashMap` used this. Throughput scales nearly linearly until contention on a single hot stripe dominates.

### Lock-Free (CAS-based) Sets

Lock-free hash sets use atomic compare-and-swap on each bucket head. Java 8+ `ConcurrentHashMap` uses this for read paths; writes use synchronized blocks per bucket. Go's `sync.Map` uses two-map approach (read-only snapshot + dirty map) for similar effect.

A lock-free `add`:
```text
1. Compute bucket b = hash(x) mod cap
2. Read head = atomic_load(bucket[b])
3. If x already in chain starting at head, return false
4. Create new entry with next = head
5. If atomic_cas(bucket[b], head, new_entry) succeeds, return true
6. Otherwise retry from step 2 (someone else changed head)
```

The retry loop is bounded by contention, not waiting on locks. Under burst load it scales to thousands of writes per millisecond per core.

### RCU-Protected Sets

Linux kernel-style **Read-Copy-Update**: readers run lock-free; writers copy-modify-publish a new version, then wait for outstanding readers to drain before reclaiming the old. Reads scale perfectly; writes pay the cost of memory copy and quiescent-state detection.

Used in: Linux kernel data structures, userspace `liburcu`, some database write-path optimizations.

| Strategy | Read scalability | Write scalability | Memory overhead |
|---|---|---|---|
| Coarse lock | poor | poor | none |
| Lock striping | good | good | per-stripe lock |
| Lock-free (CAS) | excellent | good (retries under contention) | minor |
| RCU | perfect | poor (copy + grace period) | high during update |

---

## Capacity Planning

Real numbers for budgeting set storage:

| Implementation | Bytes per element (typical) | Notes |
|---|---|---|
| Go `map[int64]struct{}` | ~64 | 8 hash + 8 key + bucket overhead |
| Java `HashSet<Long>` | ~80–120 | boxing + Entry + 64-bit ref |
| Python `set` of int | ~100 | PyObject header + slot overhead |
| Redis SET (intset) | ~8 | when all members fit in int64 |
| Redis SET (hashtable) | ~85 | sds + dictEntry |
| BitSet (dense int) | 1 bit | when universe is contiguous |
| Bloom filter at p=1% | ~9.6 bits | independent of element size |
| HyperLogLog | 12 KB total | independent of element count |

A practical example: tracking 100 million banned user IDs.

- Java HashSet: ~10 GB — requires careful JVM tuning.
- Redis SET sharded across 4 nodes: ~2.1 GB per node.
- BitSet over uint32 IDs: 512 MB — fits in one machine's L3-cache-warm RAM trivially.
- Bloom filter at p=1%: 120 MB — fits in L3 cache on many CPUs, sub-100 ns lookups.

The right choice depends on read-write ratio, false-positive tolerance, deletion frequency, and how the IDs are distributed in their space.

---

## Observability

The metrics that matter for a set service:

| Metric | What it tells you | Alert threshold |
|---|---|---|
| `set_size_total` | growth rate; capacity exhaustion warning | size > 80% of memory budget |
| `set_op_latency_p99` | hot keys, GC pauses, network slowness | > 10 ms |
| `set_contains_hit_rate` | cache effectiveness | < 0.7 unexpected for known workload |
| `set_bloom_false_positive_rate` | filter tuning | drift > 50% from target |
| `set_resize_count_total` | hash table rebuilds | sudden spike |
| `set_hash_collision_max_chain` | poor hash or adversarial input | > 16 |
| `set_lock_contention_seconds` | lock-striping working? | > 5% of CPU time |
| `set_redis_memory_fragmentation_ratio` | jemalloc behavior | > 1.5 |
| `set_replication_lag_seconds` | CRDT/replica freshness | > target SLA |

For Redis specifically: `INFO memory` gives you `used_memory_dataset`, `mem_fragmentation_ratio`, and `maxmemory_policy`. `LATENCY DOCTOR` flags blocking commands. Always alarm on `slowlog` growth.

---

## Failure Modes

### Hash-Flooding DoS

Attacker submits keys engineered to collide in a known hash function, degrading O(1) to O(n) and stalling the service. Mitigation: use a **keyed hash** (SipHash, FNV with random seed). Java, Python, Go, Redis all randomize hash seeds per process start for this reason.

### Bloom-Filter Saturation

A Bloom filter grows monotonically. After enough adds, the false-positive rate exceeds tolerance and the filter is useless. Mitigation: rebuild periodically from the source of truth, or rotate two filters (active + warming) on a schedule.

### Cardinality-Estimation Drift

HyperLogLog merge of many small sketches accumulates error. Mitigation: rebuild HLLs from raw data on a periodic schedule; do not merge HLLs more than a few generations deep.

### CRDT Tombstone Explosion

OR-Sets and 2P-Sets accumulate tombstones for every removal. Without garbage collection, set metadata grows unbounded. Mitigation: implement causal-stability-based GC; checkpoint after all replicas have observed a given vector clock.

### Hot Key on Sharded Set

One set key receives 90% of traffic. Sharding by set key cannot help. Mitigation: shard by element within that key (sub-sharding); replicate hot key to read replicas; cache the contains-result in the client.

### Memory Exhaustion from Unbounded Growth

A set used as a "visited" cache for an infinite stream grows forever. Mitigation: TTL on entries (Redis `EXPIRE` does not work on individual SET members — use a sorted set with timestamp as score and trim periodically, or use a `LRU` eviction policy at the cache layer).

### Inconsistent contains() Across Replicas

In an eventually-consistent setup, two reads to two replicas can return different membership answers for the same element. Mitigation: read from primary for membership-critical paths (auth, billing); use quorum reads when serializability matters; accept eventual consistency and design idempotent operations.

---

## Case Study: Two-Tier Membership Cache

To make the architecture concrete, consider a real auth system that must answer "is this session token valid?" for 500k QPS with p99 ≤ 2 ms.

**Constraints**:
- 200 million active tokens, each ~64 bytes.
- 99.9% of incoming probes are for valid tokens (low negative rate).
- Token issuance happens at ~5k QPS; revocation at ~50 QPS.

**Design**:

```text
[App pod] --(L1)--> in-process LRU set, 100k entries, ~5 ns hit
              \--(L2)--> Redis SET via consistent hash, 32 shards, ~250 us hit
                           \--(L3)--> Postgres `sessions` table, ~2 ms hit
```

- L1 absorbs ~80% of traffic at near-zero CPU.
- L2 absorbs the rest at sub-millisecond latency.
- L3 is consulted only on L2 miss.

**Invalidation**:
- Revocation publishes to a Redis pub/sub channel.
- Every app pod subscribes and removes the token from its L1.
- L2 is updated synchronously by the revocation handler.

**Numbers that justified the design**:
- Without L1: 500k QPS × 250 µs = 125 CPU-seconds of network wait every wall second. Need 125+ pods just to soak the latency.
- With L1 at 80% hit: only 100k QPS reach Redis. ~25 CPU-seconds of wait. 25 pods cover the load.
- L1 memory: 100k entries × 80 bytes ≈ 8 MB per pod — negligible.

The Bloom-filter tier is *not* used here because the negative rate is so low (0.1%); the cost of maintaining and consulting the Bloom filter exceeds its savings. Bloom filters earn their keep when the negative rate is high — for example, in an anti-spam blocklist where 99% of incoming emails are *not* on the list.

---

## Anti-Patterns to Avoid

### Using SMEMBERS in a Tight Loop

```text
# Bad — fetches the entire set on every call:
for each request:
    members = SMEMBERS(blocklist)
    if user in members: deny()
```

`SMEMBERS` is O(N) and ships the entire set over the wire. Use `SISMEMBER` for individual checks; it is O(1) and ships only a boolean.

### Storing User-Provided Strings Unhashed in a HashSet

A malicious user submits 10,000 strings engineered to collide under your hash function. Insert performance collapses from O(1) to O(n) per insert and the service stalls. Always use a keyed/randomized hash for any set whose elements come from untrusted input.

### Naive Resharding with `hash mod N`

When you grow from 4 shards to 8, naive sharding remaps roughly 7/8 of all keys. The migration phase doubles every read for hours. Use consistent hashing or virtual-node sharding to bound the disruption to ~1/N of keys per resharding step.

### Cross-Region Synchronous Set Replication

Synchronously replicating every `SADD` across regions for "consistency" adds 100+ ms of round-trip latency to every write. For most set workloads (analytics, recommendations, throttling), eventual consistency via CRDT or async replication is the right answer. Reserve synchronous replication for security-critical invariants like authorization revocation.

### Treating the Set as a Queue

Sets do not preserve order, do not support `pop()` semantics, and cannot answer "what was added first?". If you need that, you want a Queue (topic `03-queues`) or a sorted set (Redis ZSET) with timestamp-as-score. Repeatedly using `SPOP` to drain a set in random order is a smell.

---

## Summary

At senior level, the set is no longer a data structure — it is a service contract. The Set ADT survives the move from process to cluster, but every operation grows new dimensions: network latency, sharding strategy, consistency model, memory budget. Master the layering (Bloom → Redis → Postgres), the sharding choice (by element vs by set), the approximate alternatives (Bloom, HLL, CRDT), and the observability surface. The hardest bugs at scale come not from the set itself but from how it interacts with everything else.
