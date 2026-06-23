# Concurrent Bloom Filter — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Where Middle Left Off](#where-middle-left-off)
3. [Partitioned Bloom Filters](#partitioned-bloom-filters)
4. [Scalable Bloom Filters (SBF)](#scalable-bloom-filters-sbf)
5. [Cuckoo Filters](#cuckoo-filters)
6. [Choosing Between Bloom, Counting, Partitioned, Scalable, and Cuckoo](#choosing-between-bloom-counting-partitioned-scalable-and-cuckoo)
7. [Hash Family Architecture](#hash-family-architecture)
8. [Bloom Filters Inside Larger Systems](#bloom-filters-inside-larger-systems)
9. [LSM-Tree Integration](#lsm-tree-integration)
10. [Distributed Bloom Filters](#distributed-bloom-filters)
11. [Concurrent Rebuild Strategies](#concurrent-rebuild-strategies)
12. [Operational Patterns at Scale](#operational-patterns-at-scale)
13. [Adversarial Considerations](#adversarial-considerations)
14. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

Junior taught you the filter; middle taught you how to share it correctly across goroutines and observe it in production. Senior is about the *architecture* the filter participates in:

- When a single filter is the wrong primitive, even when correctly synchronised.
- How **partitioned**, **scalable**, and **Cuckoo** variants extend the design envelope.
- How filters integrate into LSM-trees, caches, and distributed protocols.
- How to evolve a filter without downtime as data grows by orders of magnitude.
- How to defend against adversarial inputs that try to weaponise the filter's false-positive guarantee.

This level assumes you understand:

- The basic Bloom filter and its FPR formula.
- Atomic and sharded concurrent designs.
- Counting Bloom filters and their saturation rules.
- Cache-aside ordering and the rebuild-during-traffic dance.
- Library APIs (`bits-and-blooms/bloom/v3`).

If any of that feels shaky, return to middle.md before continuing.

After reading this you will:

- Design partitioned Bloom filters from first principles.
- Implement a scalable Bloom filter that grows by chaining sub-filters.
- Compare Cuckoo filters with Bloom and counting Bloom on memory, throughput, and feature set.
- Pick the right hash family for adversarial vs friendly workloads.
- Integrate a Bloom filter into an LSM-tree-style storage layer.
- Operate a distributed filter across many service replicas using gossip or central reconciliation.
- Survive rebuild events without dropping traffic.

---

## Where Middle Left Off

Middle's checklist:

- Atomic bitset, sharded, RWMutex — pick by workload.
- Counting Bloom filters for Delete.
- Observability: capacity, fill, observed FPR, hits/misses.
- Sliding-window dedup.
- Snapshot/restore with version prefix.
- Hot reload via `atomic.Pointer`.
- Double-write during rebuild.

That covers a single, well-operated filter inside one service. Senior turns the camera around: what happens when your data outgrows one filter, when the false-positive curve no longer flatters you, or when the filter is one node in a distributed system with consistency demands?

---

## Partitioned Bloom Filters

A standard Bloom filter has m bits and k hash functions, all writing into the same shared bitset. A **partitioned Bloom filter** divides m bits into k equal partitions and assigns each hash function its own partition. Hash function `i` only writes to and reads from partition `i`.

```
Standard Bloom (k = 4, m = 64):

  bitset:  [.........................................................] (64 bits)
  hash 0 -> any of [0..63]
  hash 1 -> any of [0..63]
  hash 2 -> any of [0..63]
  hash 3 -> any of [0..63]

Partitioned Bloom (k = 4, m = 64):

  partition 0:  [.................] (16 bits)
  partition 1:  [.................] (16 bits)
  partition 2:  [.................] (16 bits)
  partition 3:  [.................] (16 bits)

  hash 0 -> any of [0..15]   (within partition 0)
  hash 1 -> any of [0..15]   (within partition 1)
  hash 2 -> any of [0..15]   (within partition 2)
  hash 3 -> any of [0..15]   (within partition 3)
```

### Why partition?

Three reasons, with trade-offs:

1. **Independence between hash functions.** With shared bitsets, a key's k positions are not strictly independent — they can collide with themselves (the same bit). Partitioning eliminates self-collisions and tightens the FPR math.

2. **Concurrency.** Each partition is independent. Writers to partition 0 do not contend with writers to partition 1. A 4-way partitioned filter behaves like a 4-way shard, but the sharding is *internal* to the data structure rather than across keys.

3. **Cache locality (with care).** If partitions are sized to fit in L1 or L2 cache, hot partitions stay hot. The downside: a Test touches all k partitions, so you cannot avoid all of them.

### The catch: slightly worse FPR

Partitioned filters have a *slightly* higher FPR than standard Bloom filters at the same `(m, k, n)`, because per-partition saturation is sharper than overall saturation. The difference is small for typical parameters but real.

Approximate FPR for partitioned:

```
p = (1 - (1 - k/m)^n)^k ≈ (1 - e^(-kn/m))^k    (essentially the same as standard for large m)
```

For small m the partitioned formula is slightly worse; for production-size m it is indistinguishable.

### A Go implementation

```go
package partitioned

import (
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
)

type Filter struct {
	partitions [][]uint64 // partitions[i] is the bitset for hash i
	mPerPart   uint64     // bits per partition
	k          uint64
}

func New(m, k uint64) *Filter {
	mPerPart := m / k
	if mPerPart == 0 {
		mPerPart = 1
	}
	parts := make([][]uint64, k)
	for i := range parts {
		parts[i] = make([]uint64, (mPerPart+63)/64)
	}
	return &Filter{partitions: parts, mPerPart: mPerPart, k: k}
}

func (f *Filter) Add(key []byte) {
	x := xxhash.Sum64(key)
	for i := uint64(0); i < f.k; i++ {
		// Mix i into the hash to derive an independent position per partition.
		h := x ^ (i * 0x9E3779B97F4A7C15)
		pos := h % f.mPerPart
		atomic.OrUint64(&f.partitions[i][pos/64], 1<<(pos%64))
	}
}

func (f *Filter) Test(key []byte) bool {
	x := xxhash.Sum64(key)
	for i := uint64(0); i < f.k; i++ {
		h := x ^ (i * 0x9E3779B97F4A7C15)
		pos := h % f.mPerPart
		if atomic.LoadUint64(&f.partitions[i][pos/64])&(1<<(pos%64)) == 0 {
			return false
		}
	}
	return true
}
```

The XOR with a per-partition constant produces effectively-independent hash values. Use Knuth's multiplier `0x9E3779B97F4A7C15` to spread the bits well.

### When to choose partitioned

Pick partitioned when:

- You want every hash function to be independent for cleaner math (academic use, distributed reconciliation).
- You have a memory architecture where small partitions fit a faster cache level.
- You want internal sharding without the bookkeeping of per-shard locks.

For most production work, the standard Bloom filter is fine. Partitioned is a niche optimisation.

---

## Scalable Bloom Filters (SBF)

The biggest weakness of a basic Bloom filter is the requirement to know `n` in advance. Under-estimate and the filter saturates; over-estimate and you waste RAM. **Scalable Bloom filters** (Almeida, Baquero, Preguiça, Hutchison, 2007) solve this by chaining sub-filters that grow geometrically.

### The idea

Start with a base filter sized for `n_0` items at FPR `p_0`. When it fills, allocate a new sub-filter for `n_1 = n_0 * r` items (growth ratio `r`, typically 2–4) at FPR `p_1 = p_0 * tightening_ratio` (typically 0.5–0.8). Continue: each new sub-filter is `r` times bigger and has a tighter target FPR.

The **overall FPR** across `L` sub-filters is bounded by:

```
P <= p_0 / (1 - tightening_ratio)
```

For `p_0 = 0.01` and `tightening_ratio = 0.5`, overall FPR is bounded by `0.02` — twice the initial target. The tightening compensates for the increasing chain length.

### Add

Add to the *current* (latest, smallest) sub-filter only.

### Test

Test all sub-filters; return true if any returns true.

### Why does it work?

A key is added to one sub-filter; future Tests for that key always find it in that sub-filter. New sub-filters do not contain old keys but their tighter `p` means their false-positive contribution is small. The geometric series converges.

### A Go implementation

```go
package scalable

import (
	"sync"
	"sync/atomic"

	"github.com/bits-and-blooms/bloom/v3"
)

type Filter struct {
	mu      sync.RWMutex
	chain   []*bloom.BloomFilter
	cur     int   // current sub-filter index (atomic-readable)
	curCap  uint  // expected n of current
	curUsed uint64 // approximate count
	growth  float64
	tighten float64
	baseN   uint
	baseP   float64
}

func New(baseN uint, baseP, growth, tightening float64) *Filter {
	f := &Filter{
		growth:  growth,
		tighten: tightening,
		baseN:   baseN,
		baseP:   baseP,
		curCap:  baseN,
	}
	f.chain = append(f.chain, bloom.NewWithEstimates(baseN, baseP))
	return f
}

func (f *Filter) Add(key []byte) {
	f.mu.RLock()
	cur := f.chain[f.cur]
	used := atomic.AddUint64(&f.curUsed, 1)
	curCap := uint64(f.curCap)
	f.mu.RUnlock()

	cur.Add(key)

	if used >= curCap {
		f.grow()
	}
}

func (f *Filter) grow() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if atomic.LoadUint64(&f.curUsed) < uint64(f.curCap) {
		return // another goroutine grew us
	}
	newN := uint(float64(f.curCap) * f.growth)
	newP := f.baseP * pow(f.tighten, float64(len(f.chain)))
	fresh := bloom.NewWithEstimates(newN, newP)
	f.chain = append(f.chain, fresh)
	f.cur++
	f.curCap = newN
	atomic.StoreUint64(&f.curUsed, 0)
}

func pow(base, exp float64) float64 {
	// math.Pow is fine; avoid the dependency for brevity
	r := 1.0
	for i := 0; i < int(exp); i++ {
		r *= base
	}
	return r
}

func (f *Filter) Test(key []byte) bool {
	f.mu.RLock()
	chain := f.chain
	f.mu.RUnlock()
	for _, sub := range chain {
		if sub.Test(key) {
			return true
		}
	}
	return false
}

func (f *Filter) Len() int {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return len(f.chain)
}
```

A few notes:

- `Add` uses an `RLock` to read the current sub-filter pointer; the per-sub-filter Add is then *not* synchronised. In a fully concurrent implementation you would also wrap each sub-filter with an RWMutex or use an atomic-bitset implementation. The version above is illustrative; a real-world SBF would combine the atomic-bitset pattern from middle.md with this chaining logic.
- `grow` checks the condition under the write lock to avoid double-grow under contention.
- `Test` walks the entire chain; in steady state with `L` sub-filters and growth ratio `r`, `L = log_r(total_n / n_0)`. For `total_n = 1B` and `r = 2`, `L ≈ 30` — manageable.

### When to use SBF

- You cannot estimate `n` in advance.
- You expect long-tailed growth (a cache that may store anywhere from 1k to 100M items depending on usage).
- You can tolerate ~2x the FPR of an ideally-sized basic filter.
- You can afford the additional Test latency from chain traversal.

### When *not* to use SBF

- You know `n` in advance. A basic Bloom filter is simpler.
- You need precise FPR. SBF's FPR is bounded but variable; the basic filter is predictable.
- Test latency must be flat (e.g. real-time bidding). Chain length introduces tail latency.

---

## Cuckoo Filters

A **Cuckoo filter** (Fan, Andersen, Kaminsky, Mitzenmacher, 2014) is a different probabilistic set with these features:

- Supports **Delete** natively, without the memory overhead of counting Bloom.
- Often **less memory** than Bloom at the same FPR for `p <= 0.001`.
- Slightly different concurrency characteristics: insertions can fail (return `false`) when the filter is too full.

### The data structure

A Cuckoo filter is an array of *buckets*. Each bucket holds a small number of *fingerprints* (typically 4 fingerprints of 8–16 bits each). A key has two possible buckets, chosen by the **partial-key cuckoo hashing** scheme:

```
fingerprint = trunc(hash(key), f bits)
bucket_1    = hash(key) mod B
bucket_2    = bucket_1 XOR hash(fingerprint) mod B
```

The fundamental property: given a bucket and a fingerprint, you can compute the *other* possible bucket without storing the key. This enables Delete and the cuckoo eviction protocol.

### Add

1. Compute `fingerprint`, `bucket_1`, `bucket_2`.
2. If `bucket_1` has space, place the fingerprint there. Done.
3. If `bucket_2` has space, place there. Done.
4. Otherwise, randomly evict a fingerprint from one of the two buckets; place the new fingerprint in its slot; the evicted fingerprint is then placed in *its* alternate bucket (computed from the evicted fingerprint and its current bucket).
5. Repeat until a slot is found or a maximum number of cuckoo swaps is exceeded (typically 500). If exceeded, the insertion fails.

### Test

Check both buckets for a matching fingerprint. If found, return true. Otherwise, false.

### Delete

Find the fingerprint in either bucket; clear that slot. The fingerprint must match exactly; multiple keys could share a fingerprint, so Delete must be paired with a prior Test or external bookkeeping.

### Memory

For 4 slots per bucket and load factor 95%:

| Target FPR | Cuckoo bits/item | Bloom bits/item |
| --- | --- | --- |
| 0.01 | 9 | 9.6 |
| 0.001 | 12 | 14.4 |
| 0.0001 | 16 | 19.2 |

Cuckoo wins on memory below `p = 0.01`. The win grows as `p` tightens.

### A Go implementation

The reference Go library is `github.com/seiflotfy/cuckoofilter`:

```go
import cuckoo "github.com/seiflotfy/cuckoofilter"

cf := cuckoo.NewFilter(1_000_000) // capacity in keys
cf.InsertUnique([]byte("alice"))
cf.Lookup([]byte("alice")) // true
cf.Delete([]byte("alice"))
```

### Concurrency

`seiflotfy/cuckoofilter` is *not* safe for concurrent use. Wrap with a mutex or shard.

A lock-free Cuckoo filter is significantly harder than a lock-free Bloom filter because Add involves eviction cycles — multiple buckets must update atomically. Production lock-free designs (Morpheus, CuckooHash) use CAS chains; they are research-grade rather than off-the-shelf in Go.

### When to use Cuckoo

- You need Delete and cannot afford the 32x memory cost of a counting Bloom filter.
- You need `p` tighter than 0.001 and memory matters.
- You can tolerate occasional insertion failure (or always pre-size with headroom).

### When *not* to use Cuckoo

- You need very high write concurrency. The eviction protocol is hard to parallelise.
- You need maximum simplicity. Bloom is simpler.
- Your `p` is loose (≥ 0.01). Bloom wins on memory.

---

## Choosing Between Bloom, Counting, Partitioned, Scalable, and Cuckoo

A decision matrix:

| Feature / Variant | Bloom | Counting Bloom | Partitioned | Scalable Bloom | Cuckoo |
| --- | :---: | :---: | :---: | :---: | :---: |
| Add | Yes | Yes | Yes | Yes | Yes (may fail) |
| Test | Yes | Yes | Yes | Yes | Yes |
| Delete | No | Yes | No | No | Yes |
| Resize without rebuild | No | No | No | Yes (geometric chain) | No |
| Lock-free concurrent | Easy | Hard | Easy | Hard | Hard |
| Memory @ p=0.01 | 9.6 bits/key | 38 bits/key (4-bit) | 9.6 bits/key | ~10–20 bits/key (chain overhead) | 9 bits/key |
| Memory @ p=0.0001 | 19.2 | 76 | 19.2 | ~20–40 | 16 |
| Add latency | k atomic ops | k atomic adds | k atomic ops | (chain length) k atomic ops | hash + bucket scan + possible evictions |
| Test latency | k atomic loads | k atomic loads | k atomic loads | chain length × k loads | 2 bucket scans |
| Common Go library | `bits-and-blooms/bloom/v3` | (no widely-used lib) | (no widely-used lib) | `tylertreat/BoomFilters` | `seiflotfy/cuckoofilter` |

### Heuristics

- **Default: Bloom.** Simplicity wins when nothing else demands otherwise.
- **Need Delete: Cuckoo if memory matters, Counting Bloom if not.**
- **Unknown growth: Scalable Bloom.**
- **Independent hashes for analysis: Partitioned Bloom.**
- **Distributed reconciliation: Bloom + Union (cleanest semantics).**

Picking the wrong variant is a senior-level mistake — and the right cure is usually "rebuild with the right variant," not "patch the wrong one."

---

## Hash Family Architecture

At senior level, hashing is no longer a footnote.

### Properties of a good hash family

1. **Uniformity.** Output bits are uniformly distributed; no clustering.
2. **Speed.** Inline-able in the Bloom filter hot path.
3. **Independence between functions.** With double hashing, ensure h2 is statistically independent of h1.
4. **Determinism vs randomisation.** For cross-process consistency, deterministic. For adversarial robustness, randomised per-process or keyed.
5. **No allocations.** Stack-only state.

### Specific families

#### MurmurHash3

Used by `bits-and-blooms/bloom/v3` internally. ~3 GB/s, well-tested distribution. Deterministic with fixed seed (the library uses a constant seed). Not keyed.

#### xxhash (cespare/xxhash/v2)

~6 GB/s, even better distribution on long inputs. Deterministic. Can be seeded (the library supports `Sum64WithSeed`).

#### `hash/maphash`

Standard library. Random per-process seed by default. ~5 GB/s. Cannot be made deterministic across processes (the seed is randomised internally; you can supply your own via `MakeSeed`).

#### SipHash

Cryptographic-grade short-key hash. ~1.5 GB/s. Keyed by design; the standard hash for hash flooding defence.

#### SHA-256

~0.5 GB/s. Massive overkill for Bloom filters; use only when you need cryptographic properties.

### Picking for your situation

| Workload | Best choice | Why |
| --- | --- | --- |
| Server, internal data, friendly inputs | MurmurHash3 (library default) | Fast, well-tested |
| Server, untrusted inputs (web payloads) | siphash with per-process key | Adversarial-resistant |
| Long values (>1 KB) | xxhash | 2x faster than Murmur on long inputs |
| Need to share filter across processes | xxhash with fixed seed or library default | Deterministic |
| Need to defend against hash flooding | maphash with per-process seed | Standard library, no extra deps |
| Cryptographic guarantees required | SHA-256 (truncated) | Trades speed for security |

### Combining hashes

For Bloom filters using double hashing:

```go
x := xxhash.Sum64(key)
h1 := x
h2 := x>>33 | x<<31
```

This rotates x to derive h2. It works for typical inputs but has a degenerate case: if the rotation produces a zero `h2`, all k positions collapse to h1. Guard with `if h2 == 0 { h2 = 1 }`.

A more rigorous approach uses two genuinely-independent hashes:

```go
h1 := xxhash.Sum64(key)
h2 := murmur3.Sum64(key)
```

At the cost of an extra hash computation per key. Whether it's worth it depends on how much you trust the rotation to produce independent positions.

The library uses a 4-hash extraction from one MurmurHash3 computation plus a 4-coefficient polynomial expansion. This is empirically excellent and is what production code should rely on by default.

### Adversarial hash flooding

An attacker who knows your hash and seed can construct inputs that all collide on the same k positions in your filter. Effects:

- They quickly drive observed FPR for *their* inputs to near 1 (every probe matches).
- They saturate specific bits, which can cascade-degrade unrelated keys' FPR.

Defence:

1. Use a per-process secret seed (maphash or seeded xxhash with a process-local key).
2. Re-seed on rebuild.
3. Monitor observed FPR per traffic class. A sudden spike for one tenant or one IP range suggests an attack.

In adversarial environments, every Bloom-filter design choice — hash, seed, observability, rebuild cadence — becomes a security-relevant choice.

---

## Bloom Filters Inside Larger Systems

A Bloom filter is rarely the *whole* of a feature. It is one layer of a multi-layer system. Senior thinking is about how that layer connects.

### Pattern 1: Bloom-then-LRU

```
request -> Bloom (memory) -> LRU (memory) -> origin (network/disk)
```

Bloom rejects 99% of negatives. LRU answers hot positives. Origin handles the rest.

- Bloom sized for *all known keys*.
- LRU sized for the working set (typically 10–20% of total keys).
- Both share a goroutine-safe interface.

Coordination: writes go to origin first, then both caches. Reads consult Bloom; on "maybe," consult LRU; on miss, consult origin and populate LRU.

### Pattern 2: Bloom-as-Negative-Cache-of-Cache

When the LRU itself can't answer "is this key not present," a Bloom layer in front of it speeds up the negative case.

### Pattern 3: Bloom-as-Routing-Hint

In a sharded service, each shard owns a subset of keys. A Bloom filter per shard tells the router "this shard probably has the key" without a full RPC.

```
request -> router -> [Bloom_1, Bloom_2, ..., Bloom_N] -> RPC to "maybe" shards
```

False positives mean wasted RPCs to shards that don't have the key. Acceptable if shards return fast nulls.

### Pattern 4: Bloom-as-Skip-Hint in LSM-trees

(Detailed in the next section.) Each SSTable has a Bloom filter; reads consult all filters before touching disk.

### Pattern 5: Bloom-as-Dedup-Across-Replicas

Each service replica maintains a "I have seen this event" Bloom filter. Replicas gossip filters; the union forms the global set. False positives mean events processed twice; false negatives mean missed events (not possible from a Bloom filter, since union is monotonic).

### Pattern 6: Bloom-as-Reachability-Test in Graph Walks

In a graph traversal, a Bloom filter remembers visited nodes. False positives mean a few nodes are skipped (acceptable for breadth-first search bounded by depth); the small false-negative-free property guarantees no node is visited twice.

Each pattern has its own concurrency and rebuild story. Senior thinking is the ability to articulate them.

---

## LSM-Tree Integration

The single most impactful production use of Bloom filters is in **Log-Structured Merge-tree** storage engines: RocksDB, LevelDB, Cassandra, HBase, ScyllaDB.

### The problem

An LSM-tree has many on-disk SSTables. A point lookup (`Get(key)`) must determine which SSTable, if any, contains the key. Naively, you check the index of every SSTable — a disk read per file.

### The solution

Each SSTable carries a small Bloom filter (typically 10 bits/key, p = 1%) cached in RAM. A `Get(key)`:

1. For each SSTable, in newest-first order:
   1. Test the Bloom filter. If "no," skip the SSTable entirely.
   2. If "maybe," read the SSTable's index block (one disk seek) to find the key.
   3. If the index says "found," return the value.
   4. If the index says "not in this SSTable" (false positive), continue.
2. If no SSTable claims the key, return `not found`.

With a 1% FPR, each Get touches roughly `1 + 0.01 * N` SSTables on average, where N is the number of SSTables. For N = 100, ~2 SSTables per Get instead of 100.

### Concurrency in LSM Bloom filters

LSM SSTables are immutable once written. Their Bloom filters are immutable too. So there is *no concurrent write to a Bloom filter*. Many goroutines can Test concurrently with no synchronisation needed.

Compaction creates new SSTables (with new filters) and obsoletes old ones. The active set of SSTables (and their filters) is updated under a "version" pointer that callers consult atomically. A `Get` snapshots the current version, walks its SSTables, and is unaffected by concurrent compactions.

This is the design pattern: **immutable per-SSTable Bloom filters + atomic version swap**. It gives you wait-free reads at the cost of higher write amplification (filters rebuilt on compaction).

### Implementation sketch in Go

```go
package lsmbloom

import (
	"sync/atomic"

	"github.com/bits-and-blooms/bloom/v3"
)

type SSTable struct {
	ID     int64
	Filter *bloom.BloomFilter // immutable
	Data   *DataFile          // (not implemented)
}

type Version struct {
	Tables []*SSTable
}

type DB struct {
	current atomic.Pointer[Version]
}

func (db *DB) Get(key []byte) ([]byte, bool) {
	v := db.current.Load()
	for _, t := range v.Tables {
		if !t.Filter.Test(key) {
			continue
		}
		if val, ok := t.Data.Get(key); ok {
			return val, true
		}
	}
	return nil, false
}

func (db *DB) Compact(newTables []*SSTable) {
	old := db.current.Load()
	merged := mergeAndCompact(old.Tables, newTables)
	db.current.Store(&Version{Tables: merged})
}

func mergeAndCompact(old, fresh []*SSTable) []*SSTable {
	// Compaction implementation omitted.
	return append(old, fresh...)
}
```

`atomic.Pointer[Version]` gives the wait-free read pattern. Compaction builds a new `Version` and swaps; existing Gets continue on the old version until they finish.

### Why this design is elegant

- **No locks.** Reads are wait-free.
- **No write amplification on filters.** Filters are sealed at SSTable creation.
- **Caching is natural.** The OS page cache or a custom block cache can hold hot Bloom filters in RAM.
- **Compaction-aware.** Filters reflect the SSTable's actual contents, not historical contents.

This is the pattern RocksDB uses (with the `filter_policy` option configurable per family). Cassandra uses the same idea per SSTable. LevelDB and HBase too.

### Configurable trade-offs

LSM-tree implementations expose:

- **Bloom bits per key.** Higher = lower FPR = fewer wasted reads = more RAM.
- **Per-level filter policy.** Higher levels (more data, less hot) may carry less aggressive filters.
- **Whole-key vs prefix filters.** Some workloads benefit from filters on key prefixes (range queries).
- **Cache eviction policy for filters.** Hot filters in RAM, cold filters paged out.

RocksDB's `bloom_locality` setting also offers a *cache-line-aware* variant (block Bloom filter) covered in professional.md.

---

## Distributed Bloom Filters

When a single filter is too big for one machine, or when many machines must agree on a set, you reach for distributed Bloom designs.

### Pattern: shared single filter behind a server

A Redis-backed Bloom filter (e.g. `RedisBloom` module) gives all clients access to one logical filter. Concurrency is solved by Redis's single-threaded model; throughput is bounded by Redis's RPS.

```
client_1 \                      / Redis (one BloomFilter key)
client_2  -- BF.ADD / BF.EXISTS -
client_N /
```

Pros: shared state across many clients, no synchronisation by the application.

Cons: every Add and Test is a network round trip. Throughput caps at ~100k ops/sec/Redis-instance. Latency adds 0.5–1 ms.

### Pattern: per-replica filter, periodically merged

Each replica maintains its own filter. Periodically (every minute, say), replicas exchange filters and Merge.

```
                    ┌─────────────┐
                    │  replica A  │  filter_A
                    └─────┬───────┘
                          ├─ filter_A
                          │
                    ┌─────▼───────┐
                    │   gossip    │  filter_A ∪ filter_B ∪ ...
                    └─────┬───────┘
                          │
                    ┌─────▼───────┐
                    │  replica B  │  filter_B (will be merged in)
                    └─────────────┘
```

After a sync, every replica has filter `A ∪ B ∪ ...`. False positives compound: each replica's FPR contributes to the union's FPR roughly additively (with overlap discounting). Size each replica's filter accordingly.

### Pattern: hierarchical filter

A leaf-level filter per partition; an upper-level filter for "which partition might contain this key." The upper filter is consulted first; positive means "ask one or two leaves."

This is essentially the LSM-tree pattern generalised to a distributed setting.

### Pattern: sketch reconciliation with IBLT

For exact set reconciliation across replicas (not just probabilistic), use an Invertible Bloom Lookup Table (IBLT). IBLTs allow recovery of the *symmetric difference* between two sets given small filters — useful for "what changed since the last sync."

This is research territory; the practical Go libraries are sparse.

### Coordination concerns

In any distributed Bloom design:

- **Hash agreement.** All replicas must use the same hash family with the same seed.
- **Wire format.** Filters serialise the same way. The library handles this for same-version pairs.
- **Clock skew.** Time-based rebuilds must use a coordinated clock.
- **Network partitions.** During a partition, filters diverge. Convergence on heal may require a Union pass or a coordinated rebuild.

A senior-level distributed-filter design accounts for all four.

---

## Concurrent Rebuild Strategies

Middle showed the basic rebuild: build fresh in background, swap atomically. Senior considers the harder cases.

### Rebuild while serving writes

The double-write pattern from middle.md is the foundation. Some refinements:

- **Buffer writes.** During rebuild, also append writes to a transient ring buffer. On swap, replay the buffer into the fresh filter. Eliminates the race window where a write lands on the old filter while the rebuild was reading from truth.
- **Quiesce briefly.** A 100-µs quiesce (pause new Adds) before swap-and-clear simplifies the protocol. For latency-sensitive services this may not be acceptable; for batch-style services it usually is.
- **Two-phase swap.** First flip a `rebuilding` flag so reads check both filters. Then swap. Then clear the flag. Trade some Test latency for ironclad correctness.

### Rebuild across replicas

In a distributed service, coordinate the rebuild:

- Leader-driven: one replica owns the rebuild; followers fetch the new filter on availability.
- Each replica rebuilds independently: simpler, but may produce slightly divergent filters during the rebuild window.

If your service requires that all replicas see the same filter at all times (for consistency reasons), the leader-driven approach is the only safe one.

### Online resize for a single filter

You cannot resize a Bloom filter in place — keys cannot be reconstructed from bits. The only way to "resize" is to:

1. Allocate the new (larger or smaller) filter.
2. Re-Add every key from the authoritative source.
3. Swap atomically.

For scalable Bloom filters, "resize" happens naturally as new sub-filters are appended.

### Rebuild cost budgeting

A rebuild that touches N keys costs `O(N * k)` hash computations plus bit writes. For N = 100M and k = 10, this is ~1B operations — about 5 seconds on a modern CPU.

If your truth source is the bottleneck (scanning 100M rows from Postgres takes hours), the rebuild plan is "stream keys in batches, with backpressure." The fresh filter accepts Adds in parallel; bandwidth from truth dominates.

### Detecting "ready to swap"

A rebuilt filter is ready when:

1. All keys from truth have been Added.
2. The double-write buffer has been drained.
3. Observed FPR on the new filter is at or below target (sample a few thousand negatives before going live).

The third check is the senior-level paranoia: if a rebuild produces a filter with worse FPR than the old (e.g. due to a hash-quality bug), you swap to something *worse*. Sampling before commit catches this.

---

## Operational Patterns at Scale

A few operational notes you only earn after a few production incidents.

### Pattern: Always have a kill switch

Add a config flag `disable_bloom_filter`. When flipped, the service bypasses the filter and goes straight to truth. Useful for debugging when you suspect the filter is the cause.

### Pattern: Always have a "force rebuild" endpoint

An admin endpoint that triggers `Rebuild`. When the filter has drifted (or you suspect it), one HTTP POST returns to a clean state.

### Pattern: Version your wire format

A one-byte version prefix on serialised filters. Lets you change the layout in one release without breaking the previous release's snapshots.

### Pattern: Health-check the filter

A periodic test: insert a fixed sentinel key, Test it, ensure the result is true. If false, alert immediately — the filter is broken (corruption, bad rebuild, etc.).

### Pattern: Separate filters per concern

A "user_exists" filter and an "email_breach" filter are unrelated. Don't pack them into one. Separate filters mean separate sizing, separate alerts, separate rebuild paths. The cost is small (filters are tiny relative to typical service memory); the operational clarity is huge.

### Pattern: Document the filter

A README or runbook entry for each filter:

- Purpose
- n, p, m, k
- Rebuild trigger and procedure
- Alert thresholds
- Kill switch
- Owner

When the on-call engineer is paged at 3am, they should not have to read source code to know what to do.

---

## Adversarial Considerations

Senior engineers consider failure modes including hostile actors.

### Hash-flooding attack

Already covered in the hash-family section. Recap: an attacker who knows your hash + seed can craft keys that all collide on the same bits, driving up FPR for their queries and saturating bits to cascade-degrade the filter.

Defence: keyed/seeded hashes; re-seed on rebuild; per-tenant FPR monitoring.

### Filter-bytes leakage

If you transmit the filter bytes (e.g. as part of an API response or a download), the recipient can perform offline analysis:

- **Membership testing without rate limiting.** The recipient can run Test locally for as many keys as they want, with no API call to your service.
- **Statistical inversion.** With access to many filter snapshots over time, an attacker can correlate which bits flipped at which times to infer when specific keys were added.

If your set is sensitive (e.g. "users who clicked the unsubscribe button"), think carefully before sharing the filter.

A defence: **encrypted Bloom filters** (a research area) use homomorphic encryption to allow Test without revealing the bitset. Practical Go implementations are rare; for most teams, just don't ship the bytes.

### Filter-poisoning

If insertions come from untrusted sources (e.g. user-supplied emails added to a "do not spam" list), an attacker can flood the filter with garbage, accelerating saturation. Mitigation: rate-limit per source; periodically rebuild from authoritative state.

### Side-channel via timing

`Test` short-circuits on the first zero bit. A timing attacker measuring Test latency can deduce *how many* k bits matched before a 0 was found — and therefore something about the bit pattern at the queried positions.

In practice this leaks negligible information about specific keys (the k positions per key are well-spread). It can leak aggregate fill statistics. Constant-time Test (check all k bits regardless) closes the leak at ~2x latency. Useful only in cryptographic settings.

### Adversarial false-positive amplification

An attacker who can choose queries and observe responses (e.g. through caching behaviour) can construct queries that always trigger false positives, driving traffic to the slow path. If the slow path is expensive, this is a DoS amplifier.

Mitigation: rate-limit slow-path lookups per client; cap the rate of "filter said maybe but truth said no" responses.

---

## Pitfalls You Will Meet

### Pitfall: Treating Scalable Bloom Filter as a panacea

SBF removes the "estimate n" pain but adds:

- Variable Test latency (chain length grows over time).
- Increased FPR ceiling (~2x base p).
- Implementation complexity.

If you can estimate n, do that and use a basic filter.

### Pitfall: Mixing Cuckoo and Bloom in the same service without clear ownership

Cuckoo and Bloom have different APIs (Cuckoo can Add-fail). If half your service uses one and half the other, error handling becomes inconsistent. Pick one per concern and stick with it.

### Pitfall: Partitioned filter with too-small partitions

If `m/k < 64`, each partition is a single uint64 word, and your hash positions all collide. Use `m >= 64*k`, ideally `m >= 1000*k`.

### Pitfall: SBF rebuild forgetting older sub-filters

When you "rebuild" an SBF, you must Add every key to *one* fresh sub-filter — losing the chain. If you instead try to rebuild each sub-filter from "the keys it contains," you can't (you don't know them). Treat the SBF as a write-once-evolves-on-its-own structure; rebuild only by collapsing into a fresh basic filter sized for the now-known total n.

### Pitfall: Cuckoo filter insertion failure under load

A near-full Cuckoo filter starts failing inserts. Symptom: `Insert` returns false. Handling:

- Pre-size with 20–30% margin.
- On failure, rebuild a larger filter in the background; swap.
- Never silently ignore failed inserts — they cause permanent false negatives downstream.

### Pitfall: Distributed filters with seed disagreement

Two replicas independently choose a random seed (e.g. each calls `maphash.MakeSeed()`). They build filters; they don't union correctly. Always coordinate seeds (e.g. all replicas read a shared config value).

### Pitfall: Forgetting hash determinism in tests

A test that uses `maphash.MakeSeed()` per run produces filters with different bit positions each time. Tests that assert specific bits or `BitSet().Count()` for a fixed input become flaky. Use a deterministic hash for tests.

### Pitfall: Bloom filter in front of a service that *can* return wrong answers

If your "truth" can occasionally lie (e.g. a cache itself, a stale replica), the Bloom filter's no-false-negative property does not save you. The composition can produce wrong answers despite filter correctness. Always pair Bloom with truly authoritative truth, not another approximation.

---

## Self-Assessment

- [ ] I can implement a partitioned Bloom filter and explain when to use it.
- [ ] I can implement a scalable Bloom filter and explain its FPR bound.
- [ ] I can describe Cuckoo filter insertion and the eviction protocol.
- [ ] I can pick between Bloom, Counting, Partitioned, Scalable, and Cuckoo for a given problem statement.
- [ ] I can explain how RocksDB uses Bloom filters and why no synchronisation is needed.
- [ ] I can design a per-replica Bloom-filter merge protocol.
- [ ] I can size a Bloom filter for a distributed setting with N replicas.
- [ ] I can defend a filter against hash-flooding.
- [ ] I can describe at least three rebuild strategies and their trade-offs.
- [ ] I can identify when a filter is the wrong tool entirely.

---

## Summary

Senior-level Bloom filter work is the integration of the filter into a larger story:

- **Partitioned, scalable, and Cuckoo variants** extend the design envelope when basic Bloom is insufficient.
- **Hash family selection** matters at the architecture level, not just the implementation level.
- **LSM-tree integration** is the gold-standard production pattern: immutable per-file filters plus atomic version swap.
- **Distributed filters** require coordination on seed, format, and rebuild cadence.
- **Adversarial considerations** — hash flooding, byte leakage, timing — are real and must be designed for.

The basic Bloom filter is a 50-line data structure. The *operational* Bloom filter — sized, synchronised, observed, rebuilt, defended — is a 5 000-line architecture. Senior is the bridge between the two.

Professional.md goes deeper still: into the cache-line-packed block Bloom filter, the formal memory-model analysis of atomic operations, the NUMA effects on multi-socket servers, and the production failure modes that only show up at scale.

---

## Further Reading

- Almeida, P. S., Baquero, C., Preguiça, N., & Hutchison, D. (2007). *Scalable Bloom Filters.* The original SBF paper.
- Fan, B., Andersen, D. G., Kaminsky, M., & Mitzenmacher, M. D. (2014). *Cuckoo Filter: Practically Better Than Bloom.*
- Putze, F., Sanders, P., & Singler, J. (2007). *Cache-, Hash-, and Space-Efficient Bloom Filters.* (Block Bloom; deeper in professional.md.)
- RocksDB documentation on Bloom and Ribbon filters.
- Cassandra Bloom-filter docs.
- Apache Impala "Runtime Filtering" documentation.
- The `seiflotfy/cuckoofilter` README.
- The `tylertreat/BoomFilters` README (covers SBF, Stable, etc.).
- Pugh, W. (1990). *Skip Lists: A Probabilistic Alternative to Balanced Trees.* (For context on probabilistic data structures.)
- Goel, A., & Gupta, P. (2010). *Small subset queries and bloom filters using ternary associative memories with applications.*
- IBLT: Goodrich, M. T., & Mitzenmacher, M. (2011). *Invertible Bloom Lookup Tables.*

---

## Diagrams & Visual Aids

### Partitioned filter layout

```
A standard 64-bit Bloom filter with k = 4 hashes:
  bits: [................................................................]
  h0, h1, h2, h3 all index into the full bitset.

A partitioned 64-bit Bloom filter with k = 4 partitions of 16 bits each:
  part 0: [................]   <- only h0 writes here
  part 1: [................]   <- only h1 writes here
  part 2: [................]   <- only h2 writes here
  part 3: [................]   <- only h3 writes here

Adding key "alice": each hash sets a bit in its OWN partition.
Testing key "alice": check that each hash's partition has its bit set.
```

### Scalable Bloom Filter chain

```
chain[0]: 1k items, p=0.01
chain[1]: 2k items, p=0.005     ┐
chain[2]: 4k items, p=0.0025    │ each sub-filter grows by 2x and tightens by 0.5x
chain[3]: 8k items, p=0.00125   ┘

Add(key) -> chain[current].Add(key)
Test(key) -> chain[0].Test(key) OR chain[1].Test(key) OR ... OR chain[current].Test(key)
```

### Cuckoo filter bucket layout

```
buckets[]:
  bucket 0:  [fp_a][fp_b][fp_c][fp_d]   (4 slots, each holding an 8-bit fingerprint)
  bucket 1:  [fp_e][   ][   ][   ]
  bucket 2:  [   ][   ][   ][   ]
  ...

Insert key K:
  fp = first 8 bits of hash(K)
  b1 = hash(K) mod numBuckets
  b2 = b1 XOR hash(fp) mod numBuckets

  Try bucket b1: empty slot? insert.
  Try bucket b2: empty slot? insert.
  Otherwise: evict a random slot from b1 or b2, place fp there.
  The evicted fp is now homeless: compute its alternate bucket, place there.
  Repeat (cuckoo chain) until success or max attempts.
```

### LSM-tree Get with Bloom filters

```
Get(key)
   ├──> SSTable_42 (newest): bloom.Test(key)? no -> skip
   ├──> SSTable_41:           bloom.Test(key)? no -> skip
   ├──> SSTable_40:           bloom.Test(key)? maybe -> read index
   │                              found? -> return value
   │                              not found (false positive) -> continue
   ├──> SSTable_39:           bloom.Test(key)? no -> skip
   ...
   └──> all SSTables checked, not found
```

### Distributed merge

```
   replica A:  filter_A = {alice, bob}
   replica B:  filter_B = {bob, carol}
   replica C:  filter_C = {dan}

   gossip: A sends filter_A to B and C
           B sends filter_B to A and C
           C sends filter_C to A and B

   after merge: all replicas have filter = {alice, bob, carol, dan}

   union is monotonic: no false negatives introduced.
   false positives: roughly additive across the union.
```

### Adversarial hash flooding

```
attacker chooses keys K_1, K_2, ..., K_M
such that hash(K_i) mod m == p for all i,
for a fixed bit position p.

result: bit p saturates immediately;
        K_i all match each other in Tests;
        and many unrelated keys whose hash happens to include p
        also start matching.

defence: keyed hash with secret seed;
         attacker cannot precompute colliding keys without seed.
```

### Online resize via shadow rebuild

```
time -->
    t0: filter_old serves all reads and writes
    t1: rebuild starts: filter_new constructed empty
                        writes go to BOTH filter_old and filter_new
                        reads go to filter_old
    t2: AllUserIDs streamed; filter_new populated from truth
    t3: drain double-write buffer into filter_new
    t4: atomic swap: filter_old replaced by filter_new
    t5: writes go to filter_new only; reads see filter_new
    t6: filter_old GC'd
```

---

## Deep Architecture: A Filter-Routed Service Mesh

Let us walk through a non-trivial architecture where Bloom filters do meaningful work at the system layer, not just the data-structure layer.

### The scenario

A multi-tenant SaaS has 10 000 tenants. Each tenant has up to 100 000 entities. The service receives entity lookups by entity ID without a tenant hint. The team has 200 backend shards, each owning a subset of tenants.

A naive lookup: broadcast the entity ID to all 200 shards, ask each "do you have this entity?", collect responses. Round trips: 200 RPCs per lookup. Catastrophic.

### The Bloom-filter solution

Each shard maintains a Bloom filter of its entity IDs and publishes the filter to all routers. Routers consult the filters before dispatching:

```
lookup(entity_id):
    1. router checks filter_1, filter_2, ..., filter_200
    2. shards whose filters say "maybe" -> issue RPCs
    3. with 1% FPR per shard, expected RPCs = (true shard) + 0.01 * 200 = 3 RPCs
    4. collect responses; return entity if found
```

### Concurrency design

Each shard:

- Maintains its own atomic Bloom filter as it inserts and deletes entities.
- Periodically (every 30 seconds) marshals the filter and pushes it to routers via gossip or service mesh.

Each router:

- Holds an `atomic.Pointer` per shard, pointing at the latest filter for that shard.
- On lookup, iterates all 200 atomic.Pointer values; consults each filter.
- Routers and shards have no shared state.

### Coordination

- **Filter versioning.** Each filter snapshot is tagged with a monotonic version. Routers accept only newer versions (last-writer-wins per shard).
- **Hash agreement.** All shards use the same hash family; routers do too. Configurable via a central config.
- **Stale filters.** A filter that arrives 5 minutes late may have false negatives (entities the shard now has). Mitigation: routers fall back to broadcast when no shard reports "maybe" — costly but correct.

### Failure modes

- **Lost filter update.** A shard's filter update is dropped; routers use stale filter. A new entity in that shard is invisible until the next update.
- **Stale router.** A router missed several updates; it uses a very stale filter. Same effect.
- **False positives storm.** A shard's filter is full; FPR rises. More RPCs per lookup; latency rises.

Each failure mode has a metric. Each metric has an alert. Each alert has a runbook.

### Code skeleton

```go
package mesh

import (
	"context"
	"sync/atomic"

	"github.com/bits-and-blooms/bloom/v3"
)

type ShardClient struct {
	shardID  int
	filter   atomic.Pointer[bloom.BloomFilter]
	version  atomic.Uint64
}

func (sc *ShardClient) UpdateFilter(version uint64, filter *bloom.BloomFilter) {
	for {
		cur := sc.version.Load()
		if version <= cur {
			return
		}
		if sc.version.CompareAndSwap(cur, version) {
			sc.filter.Store(filter)
			return
		}
	}
}

func (sc *ShardClient) MaybeHas(entityID []byte) bool {
	f := sc.filter.Load()
	if f == nil {
		return true // no filter yet: assume yes (safe fallback)
	}
	return f.Test(entityID)
}

type Router struct {
	shards []*ShardClient
}

func (r *Router) Lookup(ctx context.Context, entityID []byte) ([]byte, bool, error) {
	for _, sc := range r.shards {
		if !sc.MaybeHas(entityID) {
			continue
		}
		val, found, err := r.callShard(ctx, sc, entityID)
		if err != nil {
			return nil, false, err
		}
		if found {
			return val, true, nil
		}
	}
	return nil, false, nil
}

func (r *Router) callShard(ctx context.Context, sc *ShardClient, id []byte) ([]byte, bool, error) {
	// RPC implementation omitted.
	return nil, false, nil
}
```

This is the entire pattern. Forty lines of Go orchestrate 200 backend shards.

### Why does this beat consistent hashing?

Consistent hashing routes by entity ID -> single shard. It is O(1), exact, and requires no filters. But it requires the *router to know how to hash to the right shard* — meaning the entity-ID-to-tenant mapping must be deterministic. If entities can change tenants, or if some entities are shared across tenants, consistent hashing breaks. Bloom-filter routing handles all these cases at the cost of a small false-positive overhead.

In practice, consistent hashing covers the easy cases and Bloom-filter routing covers the hard ones. A mature system uses both: consistent hashing for the primary location and Bloom filters for "the entity might also be replicated here."

---

## Deep Architecture: Multi-Tier Bloom Filter Cache

A more sophisticated cache design: three Bloom-filter layers, each catching a different class of negative lookups.

### Tier 1: hot-path filter (L1)

- Tiny, ~10 KB, fits in L2 cache.
- Sized for "keys queried in the last minute."
- Refreshed every 10 seconds from observed traffic.
- Purpose: short-circuit *very common* negatives (e.g. crawler probes).

### Tier 2: warm-path filter (L2)

- Medium, ~10 MB.
- Sized for "keys present in the last hour."
- Refreshed every minute from the source of truth.
- Purpose: catch the bulk of "key probably doesn't exist" cases.

### Tier 3: cold-path filter (L3)

- Large, ~100 MB.
- Sized for "all keys ever known to exist."
- Refreshed nightly.
- Purpose: catch lookups for keys that never existed.

### Lookup flow

```
key -> L1.Test? no -> L2.Test? no -> L3.Test? no -> definitely absent, return null
                                                 ↘ yes -> consult truth (rare)
                                  ↘ yes -> consult cache/truth
                                  ↘ false positive -> falls through to truth
                ↘ yes -> consult cache/truth
                ↘ false positive -> falls through
```

Each tier has a different FPR target (L1 tightest at 0.001; L3 loosest at 0.01). The compounding effect: a request that passes through all three tiers and reaches truth costs k1+k2+k3 atomic loads — typically under a microsecond — plus the truth lookup.

### Why three tiers?

Because the false-positive *cost* differs per tier:

- L1 false positive: just pass to L2 (negligible).
- L2 false positive: pass to L3 (still cheap).
- L3 false positive: hit truth (slow path).

Sizing each tier for a different "lifetime" of keys keeps each tier cheap.

### Implementation

Each tier is an independent `*bloom.BloomFilter` wrapped in `atomic.Pointer`. A background goroutine per tier refreshes from the appropriate source. The hot path is:

```go
func (c *Cache) Get(key []byte) ([]byte, bool) {
	if !c.l1.Load().Test(key) {
		return nil, false
	}
	if !c.l2.Load().Test(key) {
		return nil, false
	}
	if !c.l3.Load().Test(key) {
		return nil, false
	}
	return c.truth.Get(key)
}
```

Four memory reads (three atomic Pointer Loads + a truth Get). Sub-microsecond when the filters say "no."

### Trade-offs

- More tiers = more memory.
- More tiers = more refresh work.
- More tiers = better short-circuiting.

Typical production sweet spot: 2 tiers (L1 + L3) is plenty. Three tiers is a fine-tuning play; four-plus is overkill.

---

## Deep Architecture: Counting Bloom Filter as Privacy-Preserving Set

A counting Bloom filter can be used to compute the *size of a set* without revealing its members.

Setup: each participant in a study adds their hashed identifier to a shared counting Bloom filter. Anyone can query "is X in the set?" and "how many people in the set?" but no one can enumerate the members.

The privacy story is approximate (the filter leaks statistical information about membership) but the use case is real for federated learning, contact tracing, etc.

### Threat model considerations

- An attacker with a guess at a member's identifier can query and confirm presence with ~`1 - p` confidence.
- An attacker with the filter bytes can run unlimited Tests offline.
- Counter values leak coarse "how many keys mapped here" info.

For stronger privacy, use cryptographic constructions like *encrypted Bloom filters* or *private set intersection (PSI)* protocols. The CBF is a starting point, not a finish line.

### Concurrency

A shared CBF receiving Adds from many participants needs the same concurrency story as the in-process CBF: atomic counters or a mutex. The distributed angle adds:

- **Network transport.** Participants send Add operations; coordinator applies.
- **Authentication.** Each participant signs their Add request.
- **Rate limiting.** Spam Adds inflate the filter.
- **Audit.** Some compliance regimes require a log of all Adds; the CBF alone is insufficient.

This is a niche but illustrates how Bloom-family structures generalise to distributed protocols.

---

## Deep Architecture: Bloom Filter for Approximate Membership in Graph Queries

In a large graph (social network, transaction graph), "does node X reach node Y in K hops?" is expensive. A useful approximation: maintain a Bloom filter per node listing its K-hop neighbours. Check membership in O(k) hash operations instead of a graph walk.

False positives mean "claims reachable when it isn't." For social-graph recommendation use cases, this is acceptable.

### Concurrency

If the graph is mutating (new edges added concurrently), the per-node filters must be updated atomically. The pattern: one filter per node, atomic OR for edge addition. Filter rebuild on edge deletion.

If the graph is static (a snapshot), the filters are immutable. Pure-read access; no synchronisation.

This pattern shows up in distributed databases for "which partition might hold a key joined with this key" — JOIN filter pushdown in distributed SQL.

---

## Deep Operations: Capacity Planning for Bloom-Filter-Backed Services

How do you decide what RAM budget to ask for?

### Step 1: Inventory all filters

For each filter, document:

- Name and purpose
- Current n
- Target p
- Computed m (in bits and bytes)

### Step 2: Project growth

For each filter:

- Annual growth in n (e.g. +30%)
- Plan for 18 months out

### Step 3: Add operational overhead

- During rebuild, double the memory (old + new filter live simultaneously)
- Scalable Bloom filter chains can grow 2–3x

### Step 4: Total

Sum across all filters; round up generously.

### Worked example

| Filter | n today | n in 18mo | p | m (MB) | Rebuild peak | Final ask |
| --- | --- | --- | --- | --- | --- | --- |
| user_exists | 50M | 100M | 0.001 | 18 MB | 36 MB | 40 MB |
| email_breach | 1B | 1.5B | 0.0001 | 360 MB | 720 MB | 800 MB |
| spam_url | 500M | 1B | 0.01 | 120 MB | 240 MB | 260 MB |
| event_dedup_24h | 10M | 30M | 0.001 | 5.4 MB | 10.8 MB | 12 MB |
| Total | | | | | | ~1.2 GB |

That is the RAM ask. Add some for routing, metadata, request handling, and you have a memory budget.

Without this inventory, you discover memory pressure incrementally as filters grow.

---

## Deep Operations: Latency Budget for a Bloom-Filter-Backed Endpoint

A user-facing endpoint with a Bloom filter in front of a database might budget:

- Bloom Test: 200 ns
- Atomic Pointer Load: 5 ns
- Result branch: ~10 ns

Total filter cost: ~250 ns per request, regardless of outcome.

A negative answer ends the request here.

A positive answer pays the DB cost: median 1 ms, p99 30 ms.

Net latency:

- 80% negatives: 250 ns
- 20% positives: 250 ns + 1 ms = ~1.25 ms
- Weighted mean: 0.20 * 1.25 ms = 250 µs

Compared to no filter:

- 100% pay DB cost
- Weighted mean: 1 ms

So the filter reduces mean latency by ~4x. Tail latencies are reduced even more — p99 drops from ~30 ms to ~6 ms (the p99 only applies to positives now).

These numbers shift with workload, but the *shape* is robust: a Bloom filter front-end multiplies request throughput and reduces tail latencies disproportionately when the negative rate is high.

---

## Deep Operations: When the Filter Lies

A senior engineer recognises that occasionally the filter will return *false* for a key that *was* added. This shouldn't happen — Bloom filters have no false negatives — but in practice:

- A racy Add (no atomic, no mutex) can lose a bit.
- A corrupted snapshot reload can produce a filter missing some bits.
- A version mismatch can deserialise bits in the wrong positions.
- A botched rebuild that uses the wrong key list misses some keys.

When the filter says "no" but the data is there, you have a *real* incident. Symptoms: legitimate users get "not found" responses; complaints to support; trending up.

Detection: a periodic test that inserts a known sentinel key and asserts the filter says yes. If false → page on-call.

Recovery: rebuild from authoritative source. Always have a fast rebuild script that takes minutes, not hours.

This is the *only* scenario where the Bloom filter contract is violated. Everything else is a false positive, which is by design. False negatives are bugs.

---

## Deep Operations: A Real Postmortem Pattern

A retold incident (composite of several real ones).

A team launched a Bloom-filter-backed lookup service. Three months later, p99 lookups crept from 5 ms to 15 ms. No obvious cause. Investigation:

- Bloom filter showed fill = 0.55 (well under saturation). ✓
- Observed FPR = 0.012 (target 0.01). Slightly elevated but not alarming.
- Concurrent Adds at high rate. ✓
- Goroutine count nominal. ✓

Root cause: the filter was being *Marshalled* every 30 seconds for snapshot, and the Marshal held a `sync.Mutex` for ~150 ms (Marshal walks the entire bitset). During those 150 ms, every other reader and writer waited. The p99 reflected occasional callers caught in the snapshot lock.

Fix: replace the snapshot lock with a streaming snapshot that copies the bitset word-by-word with atomic reads, never holding a lock. Snapshot time unchanged; lock held for 0 ms.

Lesson: even "background" operations on a filter can dominate user-facing latency if they hold the wrong lock. *Audit every code path that touches the filter under a lock.* Senior-level paranoia.

---

## Deep Operations: Bloom Filter With Backpressure

In a high-write system, an unbounded Bloom filter eventually saturates. A senior design includes *backpressure*: the filter signals "I'm full, slow down" to upstream producers.

Implementation:

- Watch fill fraction.
- Above 0.7: emit a "filter near capacity" warning event.
- Above 0.9: refuse Add operations; return an error.
- Block writes until a rebuild completes.

In Go:

```go
func (f *Filter) Add(key []byte) error {
	fill := f.FillFraction()
	if fill > 0.9 {
		return errFilterFull
	}
	f.add(key)
	return nil
}
```

Upstream callers respect the error: either retry after a delay, log and skip, or page on-call.

This is the difference between "the filter degrades silently" and "the filter signals when it needs help." Senior-level operability.

---

## Deep Operations: Filter as Audit Log Companion

Some compliance regimes (HIPAA, GDPR) require deletion of user data on request. A Bloom filter that says "we have data about this user" is itself information about that user. Erasing a row from the database without erasing the bit from the filter is incomplete.

Solutions:

1. **Periodic full rebuild.** Erased users are not re-Added on the next rebuild. Their bits eventually disappear (when other Adds don't hit those bits).
2. **Counting Bloom filter.** Decrement on deletion. Cleaner but more memory.
3. **Cuckoo filter.** Native delete. Probably the best fit for this constraint.

The choice depends on legal interpretation. Sometimes "the filter no longer says yes for this user" is sufficient; sometimes you must demonstrate that the bits themselves have been zeroed.

A senior engineer raises this consideration *before* the filter is in production, not after the compliance audit.

---

## Pattern: Filter-Backed Stream Deduplication at Petabyte Scale

A Kafka-style streaming system processes a petabyte of events per day. Deduplication is required: each event must be processed exactly once.

A `map[string]struct{}` would need ~50 GB for the event IDs. A Bloom filter sized for 10B events at p = 0.0001 needs ~24 GB. Slightly less; not dramatically.

The win comes from *sharding*: 100 consumer instances, each handling a slice. Per-consumer filter: 240 MB. Each consumer dedups its own slice without consulting others.

Cross-consumer ordering: events are partitioned by event-ID hash, ensuring each event lands on the right consumer.

Saturation: events older than 24 hours are no longer relevant; the consumer rotates its filter daily.

This is the design used by some real-world deduplication services. It scales by sharding rather than by per-filter size.

### Code skeleton

```go
type DedupConsumer struct {
	partitionID int
	mu          sync.RWMutex
	cur, prev   *bloom.BloomFilter
	rotateAt    time.Time
}

func (dc *DedupConsumer) Handle(eventID string, body []byte) {
	dc.maybeRotate()
	dc.mu.RLock()
	seen := dc.cur.TestString(eventID) || dc.prev.TestString(eventID)
	dc.mu.RUnlock()
	if seen {
		return
	}
	dc.mu.Lock()
	if dc.cur.TestString(eventID) {
		dc.mu.Unlock()
		return
	}
	dc.cur.AddString(eventID)
	dc.mu.Unlock()
	process(body)
}

func (dc *DedupConsumer) maybeRotate() {
	dc.mu.RLock()
	now := time.Now()
	expired := now.After(dc.rotateAt)
	dc.mu.RUnlock()
	if !expired {
		return
	}
	dc.mu.Lock()
	defer dc.mu.Unlock()
	if !time.Now().After(dc.rotateAt) {
		return // raced; another goroutine rotated
	}
	dc.prev = dc.cur
	dc.cur = bloom.NewWithEstimates(100_000_000, 0.0001)
	dc.rotateAt = time.Now().Add(24 * time.Hour)
}
```

Hours of design in a forty-line skeleton; that is the senior bar.

---

## Discussion: When to Replace Bloom with a Different Structure

Bloom filters are not always the right answer.

### Replace with a `map[string]struct{}` when

- The set is small (< 1M items).
- Exact answers are required.
- Memory is plentiful relative to set size.

### Replace with a Cuckoo filter when

- You need deletion.
- Memory matters and p ≤ 0.001.

### Replace with a HyperLogLog when

- You only need cardinality, not membership.
- Memory is extremely constrained (~12 KB for cardinality estimation regardless of n).

### Replace with a Count-Min Sketch when

- You need frequencies, not membership.

### Replace with a Quotient filter when

- You need iteration and deletion plus good cache behaviour.

### Replace with nothing (pass through to truth) when

- The slow path is fast (e.g. an in-memory store).
- Filter overhead exceeds savings.

The choice is contextual. Senior engineers carry the menu; junior engineers reach reflexively for Bloom.

---

## Discussion: Engineering Culture Around Filters

A team that has lost a few hours to Bloom-filter issues develops a culture:

- **PR template includes filter sizing.** "n =, p =, justification =."
- **Filters have owners.** Named individuals or rotating on-call.
- **Filters are documented in a central registry.** One row per filter; current n, growth rate, rebuild cadence, alert threshold, kill switch.
- **Filters are exercised in load tests.** Production-scale load on every new filter before it ships.
- **Filter incidents are postmortem-worthy.** Treat them as outages, not minor issues.

This is the senior contribution: not a clever line of code, but a culture that makes the structure safe to operate.

---

## Closing Thought: The Limits of Approximation

A Bloom filter trades certainty for memory. That trade has limits:

- You cannot store *less* than ~1.44 bits per item without raising FPR.
- You cannot answer queries the structure does not support (enumeration, range, intersection-as-set).
- You cannot guarantee anything about adversarial inputs without a keyed hash.
- You cannot achieve `p = 0` finite memory.

These limits are not bugs; they are the fundamental shape of approximate set membership. Senior engineers know the shape and design *within* it, not against it.

Professional.md goes one more level: derives every constant from first principles, explores cache-line-packed designs, dissects atomic memory ordering, and visits production failure modes that only manifest at the largest scale. By the end, you will have the toolkit to debug a Bloom filter that has been in production for years and is mysteriously misbehaving in week 800.

---

## Appendix: Bloom-Family Algorithms Cheat Sheet

| Name | Add | Test | Delete | Memory | Use case |
| --- | --- | --- | --- | --- | --- |
| **Bloom** | O(k) | O(k) | No | 1.44 log2(1/p) bits/key | Default. |
| **Counting Bloom** | O(k) inc | O(k) check | O(k) dec | 4 * Bloom | Need delete. |
| **Partitioned Bloom** | O(k) per part | O(k) per part | No | Same as Bloom | Independent hashes. |
| **Scalable Bloom** | O(k) | O(k * L) | No | Sum of chain | Unknown n. |
| **Stable Bloom** | O(k) inc, evict | O(k) | No | Bounded | Stream-only, FIFO eviction. |
| **Cuckoo** | O(1) amortised | O(1) | O(1) | ~9-16 bits/key | Need delete, tight FPR. |
| **Quotient** | O(1) amortised | O(1) | O(1) | ~9-16 bits/key | Need iteration + delete. |
| **Bloomier** | O(k) | O(k) | No | Bloom + value encoding | Map-like; key -> small value. |
| **Spectral Bloom** | O(k) inc | O(k) min | O(k) dec | Counting * width | Frequency estimation. |

Print this and pin it.

---

## Appendix: Concurrency Patterns Cheat Sheet

| Pattern | Best for | Implementation |
| --- | --- | --- |
| `sync.Mutex` | Simple, low-traffic | Lock entire op. |
| `sync.RWMutex` | Read-heavy | RLock for reads; Lock for writes. |
| `sync/atomic` on bitset | Mid-traffic, no delete | `atomic.OrUint64`, `atomic.LoadUint64`. |
| Sharded mutex | High-write, easy migration | N shards, hash to shard. |
| Sharded atomic | Maximum throughput | N shards, atomic ops within. |
| `atomic.Pointer[*Filter]` | Hot reload, immutable filter | Swap pointers. |
| Per-SSTable immutable | LSM-tree | No sync needed; version pointer. |
| Per-replica gossip | Distributed | Marshal/Unmarshal + Union. |

The same Bloom-filter problem can be solved by any of these depending on your axes.

---

## Appendix: Common Sizing Mistakes by Severity

1. **Catastrophic (filter unusable):**
   - Sized for current n with no headroom.
   - Forgot to multiply n by safety factor.
   - Used `n` instead of `m` (forgetting the bits-per-key conversion).

2. **Serious (FPR drift):**
   - Sized for steady-state n; growth not accounted for.
   - Picked `p` without considering slow-path cost.
   - Used the same `p` for filters with very different roles.

3. **Mild (operational annoyance):**
   - Sized perfectly for *one* tenant; oversized for others.
   - Forgot to rotate; old keys accumulate.
   - Marshal/Unmarshal version mismatch on upgrade.

4. **Subtle (only manifest under load):**
   - False sharing between shard mutexes.
   - Hash seed varies between processes that share filter bytes.
   - Lock contention with a long-running Marshal.

Most production incidents fall in categories 2 and 3. Catastrophic ones are caught in code review; subtle ones earn senior-level postmortem letters.

---

## Appendix: Library Recommendations Recap

| Need | Library |
| --- | --- |
| Default Bloom filter | `github.com/bits-and-blooms/bloom/v3` |
| Counting Bloom | Roll your own (see middle.md) or `tylertreat/BoomFilters` |
| Scalable Bloom | `tylertreat/BoomFilters` (search "ScalableBloomFilter") |
| Cuckoo filter | `github.com/seiflotfy/cuckoofilter` |
| Bitset operations | `github.com/bits-and-blooms/bitset` |
| Fast hashing | `github.com/cespare/xxhash/v2` |
| Keyed hashing | `hash/maphash` or `github.com/dchest/siphash` |
| Distributed (Redis) | RedisBloom (server side); Go client per Redis library. |

Pin this list.

---

## Appendix: A Senior-Level Code Review Cheat Sheet

Walk into a Bloom-filter PR review with these questions:

1. What is `n`? How was it chosen?
2. What is `p`? What does a false positive cost?
3. What concurrency strategy? Why?
4. How is observed FPR measured?
5. Where does the rebuild happen?
6. What is the kill switch?
7. Where are the metrics?
8. Has it been tested under `-race`?
9. Does it handle cold start gracefully?
10. Is it documented (purpose, owner, alert thresholds)?

If you ask all ten in a review and the author has good answers, you have shipped something senior. If they can't answer half, the PR isn't ready.

---

## Appendix: From Senior to Staff

If you can routinely architect Bloom-filter-backed systems, you are at staff trajectory. The next jump:

- **Staff thinking is cross-team.** You don't just architect *one* service's filter; you set the *standard pattern* every team in the company uses.
- **Staff thinking is multi-quarter.** You plan rebuild cadences across the entire product lifecycle, anticipating data-growth curves years out.
- **Staff thinking is failure-mode-first.** You design for partial network partitions, replica divergence, and rebuild storms before they happen.
- **Staff thinking is observability-by-default.** Every filter you touch becomes an observable, alertable, runbook-backed component.

Senior is "I can build this and run it." Staff is "I can teach a team how to build and run this, and operate the result across years."

---

## Appendix: Industry References

A short list of real-world systems that lean heavily on Bloom-family structures:

- **RocksDB / LevelDB.** Per-SSTable Bloom filters.
- **Apache Cassandra.** Per-SSTable Bloom; key cache layered on top.
- **HBase.** Block-level Bloom filters.
- **Apache Spark.** Bloom-filter joins (push-down).
- **Apache Impala.** Runtime filter pushdown with block Bloom.
- **Bitcoin SPV clients.** Bloom-filtered transaction queries.
- **Google Bigtable.** Per-SSTable Bloom filters (the original LSM design).
- **CockroachDB.** Per-SSTable Bloom (inherited from RocksDB).
- **TiDB / TiKV.** Per-SSTable Bloom (RocksDB-backed).
- **Apache Druid.** Bloom filter pushdown.
- **PostgreSQL.** `bloom` extension for index-time pruning.
- **Pwned Passwords.** Bloom-filter offline database for client-side checks.
- **The Bitswap protocol (IPFS).** Bloom-filter-encoded wantlists.

Skim the documentation of any one for an hour; you will see the patterns from this file in production.

---

## Final Closing for Senior

Bloom filters live in the seam between data structures and systems. At senior level, you are no longer asking "how does Bloom work?" but "how should Bloom *participate* in the system I am designing?" The variants, the integration patterns, the operational hygiene, the adversarial defences — these are the senior toolbox. Use them deliberately. Read the next file when you are ready to go a level deeper into the internals.

---

## Deep Dive: Implementing a Full Production Scalable Bloom Filter

The SBF skeleton earlier was illustrative. A production-grade implementation needs more polish.

```go
package sbf

import (
	"math"
	"sync"
	"sync/atomic"

	"github.com/bits-and-blooms/bloom/v3"
)

type Filter struct {
	mu sync.RWMutex
	chain []*subfilter

	baseN     uint
	baseP     float64
	growth    float64
	tightening float64
	maxChain  int
}

type subfilter struct {
	bf      *bloom.BloomFilter
	cap     uint
	count   atomic.Uint64
}

func New(baseN uint, baseP, growth, tightening float64, maxChain int) *Filter {
	f := &Filter{
		baseN:      baseN,
		baseP:      baseP,
		growth:     growth,
		tightening: tightening,
		maxChain:   maxChain,
	}
	f.chain = append(f.chain, newSub(baseN, baseP))
	return f
}

func newSub(n uint, p float64) *subfilter {
	return &subfilter{
		bf:  bloom.NewWithEstimates(n, p),
		cap: n,
	}
}

func (f *Filter) Add(key []byte) error {
	f.mu.RLock()
	tail := f.chain[len(f.chain)-1]
	f.mu.RUnlock()

	tail.bf.Add(key)
	used := tail.count.Add(1)

	if used < uint64(tail.cap) {
		return nil
	}

	return f.grow()
}

func (f *Filter) grow() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	tail := f.chain[len(f.chain)-1]
	if tail.count.Load() < uint64(tail.cap) {
		return nil // another goroutine grew the chain
	}
	if len(f.chain) >= f.maxChain {
		return ErrChainExhausted
	}
	newCap := uint(float64(tail.cap) * f.growth)
	newP := f.baseP * math.Pow(f.tightening, float64(len(f.chain)))
	f.chain = append(f.chain, newSub(newCap, newP))
	return nil
}

func (f *Filter) Test(key []byte) bool {
	f.mu.RLock()
	chain := f.chain
	f.mu.RUnlock()
	for _, sub := range chain {
		if sub.bf.Test(key) {
			return true
		}
	}
	return false
}

func (f *Filter) ChainLength() int {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return len(f.chain)
}

func (f *Filter) ApproximatedSize() uint64 {
	f.mu.RLock()
	defer f.mu.RUnlock()
	total := uint64(0)
	for _, s := range f.chain {
		total += s.count.Load()
	}
	return total
}

var ErrChainExhausted = errors.New("scalable bloom chain exhausted")
```

Production-relevant features:

- `count atomic.Uint64` for lock-free Add-counting per sub-filter.
- Bounded `maxChain` to prevent runaway memory.
- Returns an error rather than silently growing past the cap.
- Cleanly separates "tail filter is full" (grow) from "chain itself is exhausted" (alert).

### Concurrent Add inside a single sub-filter

The implementation above relies on `bloom.BloomFilter.Add` being safe — but it is not. Two goroutines hitting `tail.bf.Add(key)` race. Fix: wrap each sub-filter's bitset with `atomic.OrUint64` operations (the atomic-bitset filter from middle.md), or take a per-sub-filter mutex.

In practice, mixing the SBF's chain-level RWMutex with per-sub-filter atomic writes is the cleanest design.

---

## Deep Dive: Implementing a Production Cuckoo Filter

The `seiflotfy/cuckoofilter` library is fine for many cases but not thread-safe. Here is a sketch of a thread-safe Cuckoo filter with shard-level locking:

```go
package shardedcuckoo

import (
	"sync"

	cuckoo "github.com/seiflotfy/cuckoofilter"
	"github.com/cespare/xxhash/v2"
)

const numShards = 32

type Filter struct {
	shards [numShards]shard
}

type shard struct {
	mu sync.Mutex
	cf *cuckoo.Filter
}

func New(perShard uint) *Filter {
	f := &Filter{}
	for i := range f.shards {
		f.shards[i].cf = cuckoo.NewFilter(perShard)
	}
	return f
}

func (f *Filter) shardFor(key []byte) *shard {
	return &f.shards[xxhash.Sum64(key)%numShards]
}

func (f *Filter) Insert(key []byte) bool {
	s := f.shardFor(key)
	s.mu.Lock()
	ok := s.cf.Insert(key)
	s.mu.Unlock()
	return ok
}

func (f *Filter) Lookup(key []byte) bool {
	s := f.shardFor(key)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cf.Lookup(key)
}

func (f *Filter) Delete(key []byte) bool {
	s := f.shardFor(key)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cf.Delete(key)
}
```

Each shard handles its own Cuckoo evictions, completely independent. Failed insertions are surfaced to the caller (returning false).

For higher concurrency, the per-shard mutex could be replaced with an atomic-bucket protocol — research-level work; not for everyday use.

---

## Deep Dive: The "Block Bloom Filter" Variant

A standard Bloom filter Test touches k bit positions, each in a different cache line. For a 10 MB filter and k = 10, you incur ~10 L2 misses per Test. A **block Bloom filter** packs all k bits for a key into a single cache line:

1. Divide the bitset into "blocks" of 8 uint64 words (64 bytes = one cache line).
2. Hash the key to choose a block.
3. Within the block, hash the key k times to set k bits.

A Test then does:

- 1 hash to find the block.
- k hashes for positions within the block.
- 1 cache line read.

Total cache misses: 1. Performance roughly 5x faster than standard Bloom for large filters.

The trade-off: slightly worse FPR for the same memory, because within-block independence is harder to achieve.

### Implementation

```go
package blockbloom

import (
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
)

const (
	blockBits  = 512 // 8 uint64 words = 64 bytes
	blockWords = blockBits / 64
)

type Filter struct {
	blocks [][blockWords]uint64
	k      uint64
}

func New(numBlocks uint64, k uint64) *Filter {
	return &Filter{
		blocks: make([][blockWords]uint64, numBlocks),
		k:      k,
	}
}

func (f *Filter) hashAll(key []byte) (uint64, [8]uint32) {
	x := xxhash.Sum64(key)
	blockIdx := x % uint64(len(f.blocks))
	// Spread x into 8 32-bit values for within-block hashing.
	var subs [8]uint32
	for i := 0; i < 8; i++ {
		subs[i] = uint32(x>>(i*4)) ^ uint32(x*uint64(i+1))
	}
	return blockIdx, subs
}

func (f *Filter) Add(key []byte) {
	blockIdx, subs := f.hashAll(key)
	block := &f.blocks[blockIdx]
	for i := uint64(0); i < f.k && i < 8; i++ {
		bit := uint64(subs[i]) % blockBits
		atomic.OrUint64(&block[bit/64], 1<<(bit%64))
	}
}

func (f *Filter) Test(key []byte) bool {
	blockIdx, subs := f.hashAll(key)
	block := &f.blocks[blockIdx]
	for i := uint64(0); i < f.k && i < 8; i++ {
		bit := uint64(subs[i]) % blockBits
		if atomic.LoadUint64(&block[bit/64])&(1<<(bit%64)) == 0 {
			return false
		}
	}
	return true
}
```

This is a simplified version; production code (Apache Impala, ClickHouse) uses SIMD to test all k bits in a block with one instruction.

### When to use block Bloom

- Filter > L3 cache (cache misses dominate).
- Read-heavy workload (the win is on Test, not Add).
- Throughput-sensitive (Impala uses it for JOIN pushdown at the column level).

For most server-side Go work, the standard library is fine. Block Bloom is for the absolute hot path.

---

## Deep Dive: SIMD-Accelerated Bloom Filter

Go does not expose SIMD intrinsics directly; you would need assembly or `cgo`. A few projects expose SIMD Bloom in Go via assembly:

- `github.com/zhenjl/cityhash` includes SIMD variants.
- Specialised forks of `bits-and-blooms/bloom/v3` add SIMD for x86.

For the general Go programmer, SIMD is overkill. The standard atomic-bitset filter saturates a CPU core comfortably without intrinsics.

---

## Deep Dive: NUMA-Aware Bloom Filter

On a dual-socket server, a filter allocated on one NUMA node incurs cross-socket cache costs for queries from the other socket. For very large filters and high throughput:

1. Allocate one filter per NUMA node.
2. Bind each goroutine to a node (via `numactl` at the OS level or `runtime.LockOSThread` + sched_setaffinity).
3. Each goroutine queries its node's local filter.

Trade-off: each filter independently maintained; total memory is doubled. Win: every Test is L1/L2/L3 cache only, no cross-socket misses.

For most workloads this is not worth the complexity. But for the largest-scale services (think: hundreds of cores, terabytes of filters), NUMA awareness saves real money.

---

## Deep Dive: Bloom Filters in Database Query Optimisers

Modern query optimisers (Apache Impala, ClickHouse, CockroachDB, PostgreSQL with the `bloom` extension) use Bloom filters to push down join filters:

```
SELECT *
FROM orders o JOIN users u ON o.user_id = u.id
WHERE u.country = 'NL';
```

Naive: scan `users` for 'NL', then scan `orders` and JOIN. Bloom-filter pushdown:

1. Scan `users WHERE country = 'NL'`; build a Bloom filter on `user_id`.
2. Send the Bloom filter to the `orders` scan.
3. `orders` scan skips rows whose `user_id` is not in the filter.

Concurrency: the Bloom filter is built on one side and consumed (read-only) on the other. No concurrent writes. Wait-free queries; one big build at the start.

This is the production pattern in massively parallel query systems. Knowing it helps you reason about why "Bloom filter pushdown" appears in EXPLAIN plans.

---

## Deep Dive: Bloom Filter As a Witness for Set Equality

If two parties each compute a Bloom filter over their sets and compare bytes, they can determine *with high probability* whether their sets are equal — without transmitting the sets.

Use cases:

- **Replication consistency check.** Replicas compute filters; coordinator compares; mismatches trigger repair.
- **Backup verification.** Hashes of files added to a Bloom; periodic compare with the source.
- **Federated learning.** Participants prove they processed the same items.

The protocol:

1. Both parties agree on `(m, k, hash)`.
2. Each builds a filter over their set.
3. Exchange `MarshalBinary` bytes.
4. If bytes equal -> sets *probably* equal (false-positive at the byte-equality level is essentially zero for non-trivial filters).
5. If bytes differ -> sets *definitely* differ.

This is a one-way certificate: equal-bytes does not prove equal-sets (two different sets *could* produce identical Bloom bits in theory; practically impossible).

For real cryptographic certainty, use a Merkle tree. For approximate "are we drifting?" checks, Bloom equality is cheap and effective.

---

## Deep Dive: A Real Concurrent Bloom Architecture in the Wild

A team at a streaming platform (composite description from real systems) runs:

- **Ingestion service.** Receives events at 1M/sec. Per-shard Bloom filter for "is this event-ID already processed?"
- **Query service.** Answers "has user X completed onboarding step Y?" using a per-user Bloom of completed steps.
- **Recommendation service.** Bloom filter per user of "items shown today" to avoid duplicates.
- **Anti-spam service.** Bloom filter of known-bad URLs, shared across all replicas via gossip.
- **Search service.** Bloom-filter pushdown on full-text search; rejects documents lacking required terms.

Each service uses a different concurrency strategy:

- Ingestion: atomic bitset (write-heavy).
- Query: RWMutex (read-heavy).
- Recommendation: per-user filters in a `sync.Map`.
- Anti-spam: gossip-merged single filter.
- Search: immutable per-segment filters (LSM-tree style).

Total memory across all filters: ~50 GB. Total ops/sec across all filters: ~10M. The architecture works because each filter is sized and synchronised for its specific role.

This is what "the company runs on Bloom filters" looks like in practice. Senior engineers across multiple teams own these filters; staff engineers ensure the patterns are consistent.

---

## A Senior-Level Quiz

Twenty questions you should be able to answer cold.

1. Why does the LSM-tree Bloom filter design require no synchronisation for reads?
2. In a scalable Bloom filter, why does the FPR not diverge as the chain grows?
3. What does a Cuckoo filter store that a Bloom filter does not?
4. How do you size a partitioned Bloom filter's partitions?
5. What is the cost of a Cuckoo eviction storm and how do you prevent it?
6. When is block Bloom faster than standard Bloom?
7. Why does an `atomic.Pointer[Filter]` enable wait-free reads?
8. What happens when two replicas use different hash seeds for a shared filter?
9. How do you prove a filter was not corrupted during a rebuild?
10. What kill switches should a production filter have?
11. How does Cassandra use Bloom filters?
12. What is hash flooding and how do you defend against it?
13. When would you replace Bloom with HyperLogLog?
14. What does "double-write during rebuild" protect against?
15. How does the false-positive rate change with k (other things equal)?
16. Why is `k = (m/n) ln 2` the optimum?
17. What is the cost of one cache miss vs one atomic operation?
18. How do you sample observed FPR without flooding the slow path?
19. What does `Merge` (Union) preserve and what does it lose?
20. When is the right answer "do not use a Bloom filter at all"?

If you answered all 20 cold, you are ready for professional.md.

---

## Reading List for the Senior Engineer

A curated short list:

- Almeida et al. (2007). *Scalable Bloom Filters.* (Foundational SBF paper.)
- Fan et al. (2014). *Cuckoo Filter: Practically Better Than Bloom.* (Cuckoo introduction.)
- Putze et al. (2007). *Cache-, Hash-, and Space-Efficient Bloom Filters.* (Block Bloom origins.)
- Bonomi et al. (2006). *An Improved Construction for Counting Bloom Filters.* (d-left counting.)
- Lemire & Kaser (2016). *Faster 64-bit Universal Hashing Using Carry-Less Multiplications.* (Modern hash performance.)
- Kirsch & Mitzenmacher (2008). *Less Hashing, Same Performance.* (Double hashing analysis.)
- Geravand & Ahmadi (2013). *Bloom Filter Applications in Network Security.* (Survey.)
- "RocksDB Bloom Filter" official documentation.
- "Cassandra Bloom Filter" Apache documentation.
- "Apache Impala Runtime Filtering" documentation.
- The Linux kernel's `bloom` module (search "lib/bloom").
- The `bits-and-blooms/bloom/v3` source — 1 000 lines, worth reading cover to cover.

A serious week of reading puts you fluent in the literature.

---

## Architecture Workshop: Designing a Filter for a Streaming ETL Pipeline

Let us walk a concrete design end-to-end.

### Requirements

- ETL pipeline ingests 100 MB/s of log data.
- Some events are duplicates introduced by upstream retries.
- Dedup window: 6 hours (anything older is allowed to dup).
- Throughput target: 5M events/sec at peak.
- Tolerance: 0.0001 false positives (one in 10 000 events accidentally dropped as duplicate).

### Sizing

- 5M events/sec * 6 hours = 108B events in window.
- For p = 0.0001 we need ~19.2 bits per item: ~258 GB of Bloom filter.
- Too much for a single machine.

### Architecture

1. **Partition by event hash.** 100 shards, each handling ~1B events. Per-shard filter: 2.6 GB.
2. **Two-window per shard.** Current + previous 6h. Doubles per-shard memory: 5.2 GB.
3. **100 instances.** Each instance handles 1 shard. Total memory across cluster: 520 GB.
4. **Atomic bitset per shard.** Maximum throughput within a shard.
5. **Rotation every 3 hours.** Half the dedup window per rotation.

### Per-instance design

- One atomic-bitset Bloom filter per window (cur, prev).
- `atomic.Pointer` for each window for hot swap.
- Goroutine pool sized to event-ingest queue depth.
- Each goroutine: Test cur OR prev; if not seen, Add to cur; process event.

### Failure modes

- **Instance dies.** New instance takes over shard; filter must rebuild from authoritative log. Cold-start window: events from the last 6h not deduped until rebuild completes.
- **Network partition between instance and source.** Same as instance dies.
- **Filter saturation.** Per-shard fill drifts above 0.7 → alert; manual rebuild with larger size.

### Implementation skeleton

```go
package etldedup

import (
	"sync/atomic"
	"time"
)

type ShardDedup struct {
	cur, prev atomic.Pointer[atomicbloom.Filter]
	swapAt    atomic.Int64 // unix nano of next rotation
}

func (sd *ShardDedup) Process(eventID []byte) bool {
	now := time.Now().UnixNano()
	if now > sd.swapAt.Load() {
		sd.maybeRotate(now)
	}
	cur := sd.cur.Load()
	prev := sd.prev.Load()
	if cur.Test(eventID) || prev.Test(eventID) {
		return false
	}
	cur.Add(eventID)
	return true
}

func (sd *ShardDedup) maybeRotate(now int64) {
	// CAS to avoid double-rotation.
	target := now + (3 * time.Hour).Nanoseconds()
	for {
		cur := sd.swapAt.Load()
		if now <= cur {
			return
		}
		if sd.swapAt.CompareAndSwap(cur, target) {
			break
		}
	}
	fresh := atomicbloom.NewWithEstimates(1_000_000_000, 0.0001)
	old := sd.cur.Swap(fresh)
	sd.prev.Store(old)
}
```

`atomic.Pointer` and `atomic.Int64.CompareAndSwap` together give a thread-safe rotation without a global mutex. Lookups are wait-free; only the rotation itself contends, and even then briefly.

### Operational dashboard

Per shard:

- `events_processed_total`
- `events_deduped_total`
- `events_processed_after_rotation`
- `filter_fill_fraction{window="cur"|"prev"}`
- `rotation_count_total`

Cluster-wide:

- Total events/sec
- Mean events per shard (skew detection)
- Tail events per shard (hot-spot detection)

Alerts:

- Filter fill > 0.75 in any shard.
- Skew between shards > 2x (suggests bad partition function).
- Event drop rate (deduped + false-positive) > 1% (suggests filter or upstream problem).

This is the deliverable from a senior architecting a Bloom-based dedup at scale. The data structure is half a page; the production architecture is the rest.

---

## Architecture Workshop: Designing a Bloom-Backed CDN Cache

A different scenario.

### Requirements

- CDN edge serves 100M URLs from 1B-URL catalog.
- Cache miss is expensive: 50 ms origin fetch.
- 30% of requests hit URLs not in the catalog (404s).
- Memory budget per edge: 16 GB.

### Without a Bloom filter

- 30% of requests pay 50 ms for "not found." Worst case: every 10 ms a goroutine is parked on a 404 fetch.
- Cache fill takes hours.

### With a Bloom filter

- Filter sized for 1B URLs at p = 0.001 → 20 bits per URL → 2.5 GB.
- 30% of requests short-circuit at the filter; 99.9% of those terminate in nanoseconds.

### Design

- Per-edge Bloom filter, atomic bitset (write-heavy: each new URL added at origin gets propagated).
- Filter built nightly by origin, pushed to all edges.
- Atomic Pointer swap for hot reload.

### Concurrency

- 1M req/sec/edge. Atomic bitset handles it. RWMutex would be too contended.
- Hot reload twice daily; brief swap.
- Per-URL Add never happens at edge (no write path). Edge filter is read-only.

### Edge code

```go
type CDNEdge struct {
	filter atomic.Pointer[atomicbloom.Filter]
}

func (e *CDNEdge) Serve(url string) (Response, error) {
	if !e.filter.Load().Test([]byte(url)) {
		return Response{Status: 404}, nil
	}
	return e.fetchAndServe(url)
}

func (e *CDNEdge) Reload(path string) error {
	data, _ := os.ReadFile(path)
	fresh, _, err := atomicbloom.ReadFrom(bytes.NewReader(data))
	if err != nil {
		return err
	}
	e.filter.Store(fresh)
	return nil
}
```

The edge spends ~150 ns per 404 instead of 50 ms. Throughput goes up 333,000x for that branch.

### Origin code (filter builder)

- Nightly job scans the URL catalog.
- Adds each URL to a fresh atomic Bloom filter.
- Marshals to bytes.
- Distributes to all edges via S3 or similar.

Filter is immutable during its lifetime at the edge.

This is how real CDNs (Akamai, Cloudflare, Fastly) deploy Bloom filters in production.

---

## Architecture Workshop: Per-Tenant Filter Multiplexing

A platform with 10 000 tenants, each with its own data and access control. Tenants vary in size by 1 000x.

### Naive: one filter per tenant

10 000 filters, average 1 MB each = 10 GB. Manageable.

But: many tenants are *tiny* (under 100 keys). Sizing each for 1 MB wastes 99% of its memory.

### Better: bucketed filters

Group tenants by size:

- Tiny (< 1 000 keys): no filter, scan map directly.
- Small (1 000–100 000 keys): per-tenant 100 KB filter.
- Medium (100 000–10 000 000 keys): per-tenant 1–10 MB filter.
- Large (10 000 000+ keys): per-tenant sharded filter.

Routing: tenant ID → bucket → per-tenant filter.

### Concurrency

Each tenant filter is independent; no cross-tenant contention. `sync.Map[tenantID]*Filter`.

For very-large tenants, each gets sharded internally.

For very-small tenants, just use a `map[string]struct{}`.

### Memory savings

Total memory drops from 10 GB to ~2 GB by sizing each tenant's filter correctly.

### Implementation

```go
type TenantFilter interface {
	Test(key []byte) bool
	Add(key []byte)
}

type ExactFilter struct {
	mu  sync.RWMutex
	set map[string]struct{}
}

type BloomTenant struct {
	mu sync.RWMutex
	bf *bloom.BloomFilter
}

type ShardedBloomTenant struct {
	shards [32]struct {
		mu sync.RWMutex
		bf *bloom.BloomFilter
	}
}

type Platform struct {
	tenants sync.Map // tenantID -> TenantFilter
}

func (p *Platform) Get(tenantID string) TenantFilter {
	v, ok := p.tenants.Load(tenantID)
	if ok {
		return v.(TenantFilter)
	}
	// Construct on demand based on tenant size class.
	fresh := p.constructFor(tenantID)
	actual, _ := p.tenants.LoadOrStore(tenantID, fresh)
	return actual.(TenantFilter)
}

func (p *Platform) constructFor(tenantID string) TenantFilter {
	switch p.sizeClass(tenantID) {
	case "tiny":
		return &ExactFilter{set: map[string]struct{}{}}
	case "small":
		return &BloomTenant{bf: bloom.NewWithEstimates(10_000, 0.01)}
	case "medium":
		return &BloomTenant{bf: bloom.NewWithEstimates(1_000_000, 0.01)}
	case "large":
		// initialize sharded variant
		return newShardedBloom(10_000_000, 0.001)
	}
	panic("unknown size class")
}
```

Senior-level wisdom: *avoid one-size-fits-all*. Choose the data structure variant for each tenant.

---

## Architecture Workshop: Tiered Storage with Bloom Pruning

A database stores keys across:

- Hot tier (RAM): 1% of keys.
- Warm tier (SSD): 10% of keys.
- Cold tier (S3): 89% of keys.

Each tier has its own Bloom filter. A Get walks the tiers in order:

```
Get(key)
  -> hot.bloom.Test? maybe -> hot.get -> hit? return.
  -> warm.bloom.Test? maybe -> warm.get -> hit? return.
  -> cold.bloom.Test? maybe -> cold.get -> hit? return.
  -> definitely absent, return null.
```

The Bloom filters serve as pruning hints. Without them, every Get would touch S3, costing 100 ms+. With them, only Gets that actually need cold-tier data touch S3.

### Sizing per tier

- Hot tier filter: small (1% of total).
- Warm tier filter: medium (10% of total).
- Cold tier filter: large (89% of total).

The cold-tier filter is the largest because it has the most keys. Sizing it correctly is the most important.

### Concurrency

Hot and warm filters update on each insertion at the corresponding tier. Cold-tier filter is rebuilt nightly from authoritative storage.

Each tier's filter wrapped per the patterns from middle.md.

### Real-world example

This is precisely the pattern used by some HSM (hierarchical storage management) systems and tiered databases like ScyllaDB.

---

## Real-World Codebase Tour: How `bits-and-blooms/bloom/v3` Is Built

A brief tour of the actual library source to inform your senior-level understanding.

### Core file: `bloom.go`

- `BloomFilter` struct: `m uint`, `k uint`, `b *bitset.BitSet`.
- `New(m, k uint) *BloomFilter`: allocates `bitset.New(m)`.
- `NewWithEstimates(n uint, fp float64) *BloomFilter`: computes `EstimateParameters`, calls `New`.
- `Add(data []byte) *BloomFilter`: computes 4 base hashes; iterates `i = 0..k`; computes `position = baseHashes[i%2] + (i/2)*baseHashes[2+i%2]`; sets bit in bitset.
- `Test(data []byte) bool`: same hash flow; checks each bit.
- `TestAndAdd(data []byte) bool`: returns "was present" before Add; updates regardless.
- `TestOrAdd(data []byte) bool`: returns "was present" before Add; updates only if not present.
- `Union(other *BloomFilter) (*BloomFilter, error)`: returns OR.
- `Intersect(other *BloomFilter) (*BloomFilter, error)`: returns AND.
- `MarshalBinary() ([]byte, error)`: writes m, k, bitset bytes.
- `UnmarshalBinary(data []byte) error`: reads them back.

### Hash file: `baseHashes.go`

- Uses MurmurHash3 128-bit variant.
- Splits the 128-bit hash into four 32-bit values, sign-extended to int64.
- These four base hashes feed the position formula.

### Key insight

The library uses a *4-coefficient* polynomial expansion (Kirsch & Mitzenmacher style) for stronger pseudo-independence than basic double hashing. The k positions are computed as:

```
position_i = h1 + i*h2 + i^2*h3 + i^3*h4
```

with the four h's drawn from one MurmurHash3 invocation. This gives better empirical FPR than simple `h1 + i*h2` at high fill levels.

### Why this matters at senior level

If you implement your own filter, the polynomial expansion is the easiest improvement over basic double hashing. The cost is one multiplication and one addition per hash position; the benefit is tighter FPR adherence.

If you stick with the library, you get this for free.

---

## A Final Senior Mindset Note

Senior-level work with Bloom filters is mostly about *restraint*. The temptation is to reach for ever-more-clever variants. The discipline is to:

- Pick the simplest filter that meets requirements.
- Size it carefully.
- Wrap it correctly.
- Observe it.
- Document it.
- Plan its rebuild.
- Move on.

A senior who can resist the lure of "but what if I used a partitioned scalable Cuckoo?" and instead ships a plain Bloom filter with great operability has done a *better* job than one who ships a complicated structure with the same outcome.

Save the cleverness for cases that actually need it. Save the architecture work for the system around the filter, not the filter itself.

That is the difference between a senior who understands Bloom filters and a senior who knows when to use them.

---

## Extended Case Study: Bloom Filter for a High-Frequency Trading Pre-Filter

Senior engineering rarely shows up in stock examples. Here is one from finance.

### The problem

A market-data system processes 10M ticks/sec. Some ticks are duplicates introduced by venue retransmissions. The system must dedup with single-digit microsecond p99 latency.

### Why Bloom?

A hash map's lookup is O(1) but its tail latency is dominated by occasional resize, GC interaction, and cache misses. A pre-filter Bloom filter:

- Takes <100 ns for any check.
- Allocates nothing per op.
- Cache-line-aligned.

### Design

- Block Bloom filter sized for 60 seconds of ticks at p = 1e-8.
- Atomic bitset; multiple producer goroutines.
- Rotation every 30 seconds to bound dedup window.
- No marshalling; no persistence; the filter is ephemeral.

### Latency budget

- Bloom Test: 50 ns (block design, one cache line).
- Bloom Add: 60 ns (atomic OR within block).
- Rotation: ~10 µs every 30s. Acceptable (one tick worth of latency).

### Why not Cuckoo?

Cuckoo's insertion is amortised O(1) but worst-case O(MaxKicks). MaxKicks can be 500+ during the eviction chain. At 10M ticks/sec, a 500-kick insertion stalls the producer for ~50 µs — far above the p99 target.

Bloom's deterministic Add latency wins in latency-sensitive settings.

### Why not basic atomic Bloom?

For very large filters (>L3 cache) the multi-line cache misses bring per-Test cost above 1 µs. The block design constrains all bits to one cache line.

### Implementation

The block Bloom from earlier in this file, integrated into a high-throughput tick pipeline. Bench shows ~80 ns Test and ~100 ns Add at the 99th percentile.

This design is in production at multiple trading firms. The lesson: senior thinking is about choosing the *right combination* of Bloom-family choices for a given latency profile.

---

## Extended Case Study: Bloom Filter for Edge Computing IoT Devices

Tiny devices with KB of RAM cannot run full data structures. A Bloom filter fits.

### The problem

An IoT device collects sensor readings; periodically uploads a digest. Dedup of "have I sent this reading?" prevents wasted bandwidth.

Constraint: 4 KB RAM for the filter.

### Sizing

- 4 KB = 32 768 bits.
- For p = 0.01: n ≈ 32 768 / 9.6 ≈ 3 400 readings.

Three thousand readings per filter, p = 1%. Enough for ~30 minutes at one reading per second.

### Implementation

```go
package iotbloom

import "github.com/cespare/xxhash/v2"

type Tiny struct {
	bits [512]uint64 // 32768 bits = 4 KB
	k    uint64
}

func (t *Tiny) Add(key []byte) {
	x := xxhash.Sum64(key)
	h1 := x
	h2 := x>>33 | x<<31
	if h2 == 0 {
		h2 = 1
	}
	for i := uint64(0); i < t.k; i++ {
		pos := (h1 + i*h2) % 32768
		t.bits[pos/64] |= 1 << (pos % 64)
	}
}

func (t *Tiny) Test(key []byte) bool {
	x := xxhash.Sum64(key)
	h1 := x
	h2 := x>>33 | x<<31
	if h2 == 0 {
		h2 = 1
	}
	for i := uint64(0); i < t.k; i++ {
		pos := (h1 + i*h2) % 32768
		if t.bits[pos/64]&(1<<(pos%64)) == 0 {
			return false
		}
	}
	return true
}
```

Note the lack of atomic operations: IoT devices usually run a single goroutine; concurrency is not a concern.

### Lessons

- Bloom filters scale *down* as well as *up*.
- The same algorithm works on 4 KB or 4 TB.
- Operational concerns differ wildly: IoT cares about firmware update size; servers care about FPR drift.

Senior engineering is recognising the structure works across this spectrum and tuning accordingly.

---

## Extended Case Study: Detecting and Mitigating a Filter Saturation Storm

A retold composite incident.

### Day 1

A new product feature launches. Bloom filter sized for `n = 10M` users handling new sign-ups. p = 0.01 chosen.

### Day 47

A viral marketing campaign drives 30M sign-ups in two days. The filter is sized for 10M. Observed FPR climbs from 0.01 to 0.45. Every lookup hits the slow path.

### Day 48 morning

DB load spikes 50x. Several queries timeout. SRE on-call paged.

### Day 48 mid-morning

Quick diagnosis: filter saturation. The fix is to rebuild for `n = 50M`.

### The rebuild itself

The naive plan: take the filter offline, rebuild from DB, swap. But the DB is overloaded; querying "all user IDs" makes it worse.

Better plan: rebuild from a recent snapshot. The team has a daily backup; restore the snapshot to a side database; query user IDs from there; build the new filter; ship it.

Took 4 hours. During that time the filter degraded service was the *least* of the problems — the overloaded DB was. The Bloom filter recovery was a small part of the broader incident.

### Postmortem actions

1. Add alerts on `bloom_observed_fpr > 5*target` (would have caught this on day 30).
2. Auto-rebuild trigger at `fill > 0.7` (would have prevented the incident entirely).
3. Document the "rebuild from snapshot" procedure.
4. Set safety margin to 5x rather than 2x for new filters (cost: ~30 MB extra memory, prevents this class entirely).

### The senior lesson

The filter was not the cause of the incident; *under-provisioned filter operations* were. Senior engineers anticipate growth and build the operational margin into the design.

---

## Discussion: Bloom Filter vs Probabilistic Trees

Trees (Merkle, B+, etc.) are exact but expensive. Filters are approximate but cheap. A third class — *probabilistic trees* — combines them:

- **Skip list with Bloom-filter shortcuts.** Each tower node carries a Bloom filter of the keys it spans; range queries skip subtrees the filter says are empty.
- **B+ tree with per-page Bloom.** Each leaf page has a Bloom filter; range scans skip pages.

These are research-grade and rare in Go libraries. Awareness helps you recognise them in production database internals.

### When probabilistic trees win

- Massive read-mostly workloads where range queries dominate.
- The cost of touching a node is much higher than the cost of consulting a filter.
- False positives are cheap (you just read a slightly larger range than necessary).

You will not implement one. You may operate one inside a database. Knowing they exist is the senior-level fluency.

---

## Discussion: The Information-Theoretic Lower Bound

A *fundamental* result: any data structure that supports approximate membership with false-positive rate p must use at least `log2(1/p)` bits per element. The constant factor of `1.44` in Bloom filters is a consequence of *uniform random hashing*; better hashing recipes can approach the lower bound.

The *Xor filter* and *Ribbon filter* approach within 25% of the lower bound — about `1.23 * log2(1/p)` bits per element.

### Xor filters

A *static* filter (no incremental Add). Construction:

1. Hash each key to three positions.
2. Solve a XOR linear system to find a small per-key fingerprint such that the XOR of the three positions equals the fingerprint.
3. Lookup: hash, XOR the three positions, compare to fingerprint.

Memory: ~10.5 bits per key for p = 0.01 (vs 9.6 for Bloom at optimum but Bloom needs the optimum `k`; Xor needs no per-construction tuning).

### Ribbon filters

A construction by RocksDB engineers. Marginally better than Xor; supports incremental construction with batching.

### Concurrency

Xor and Ribbon are *immutable* once constructed. Reads are wait-free; no concurrency considerations for queries. Construction is single-threaded but fast.

### In Go

`github.com/FastFilter/xorfilter` provides the Xor filter. Not yet widely adopted; useful for static lookup tables.

### When to use

- The set is static (build once, never modify).
- Memory is critical.
- Lookups are very read-heavy.

For dynamic sets, Bloom or Cuckoo remain the right choice.

---

## Discussion: A Survey of Bloom-Filter Patents

A historical note. Many Bloom-filter variants were patented; some patents have expired, some are still active. Always check legal before using a paper-fresh algorithm in production. Examples:

- Counting Bloom: free.
- Scalable Bloom: free.
- Cuckoo filter: free (academic license).
- Xor filter: free.
- Block Bloom: free.
- Specific SIMD optimisations: vary.

The library `bits-and-blooms/bloom/v3` is BSD-licensed; safe.

A senior engineer in a corporate setting would confirm legal posture before shipping a niche variant.

---

## A Senior's Toolkit Recap

When sizing up a Bloom-filter problem, the senior toolkit is:

1. **Variant selection.** Basic / Counting / Partitioned / Scalable / Cuckoo / Xor.
2. **Concurrency strategy.** Mutex / RWMutex / Atomic / Sharded / Immutable.
3. **Sizing.** n, p, m, k, safety margin, growth projection.
4. **Integration.** Cache-aside, LSM-tree, routing, dedup, pre-filter.
5. **Distribution.** Single-instance, sharded, gossip-merged, server-side (Redis).
6. **Observability.** Capacity, fill, observed FPR, hit/miss.
7. **Operations.** Snapshot, restore, rebuild, kill switch, runbook.
8. **Adversarial defence.** Hash family, seed, rate limits, monitoring.
9. **Documentation.** Owner, purpose, alert thresholds, runbook.
10. **Capacity planning.** Memory budget at 18-month projection.

Hold all ten in mind for every Bloom-backed feature. Most teams get the first three; senior engineers get all ten.

---

## A Practical Senior Interview Question

You will be asked some variation of this at staff-level interviews:

> "Design a Bloom-filter-based deduplication system for 100M events/sec across 1000 instances with a 24-hour window and 0.0001 FPR."

A passable answer addresses:

- Memory budget per instance.
- Per-instance variant choice (atomic, sharded).
- Rotation policy.
- Hash family.
- Failure modes (instance loss, partition).
- Observability.
- Capacity planning.

A great answer also addresses:

- What happens during a rolling deploy?
- How do you handle a hot shard?
- What if events arrive out of order?
- How do you debug a suspected false-negative bug?
- What's the cost of a single false positive in this context?

The interview is testing exactly the patterns from this file. If you internalised them, you have the answer.

---

## Wrap-Up

Senior is the bridge between the data-structure curiosity of junior/middle and the systems thinking of staff/principal. Bloom filters are an unusually good vehicle for this transition: small enough to fully understand, deep enough to require real architecture, ubiquitous enough that you will see them everywhere.

Take a deep breath. Move to professional.md when you are ready for the internals.

---

## Appendix: Concurrency Costs of Each Variant, Quantified

Approximate latencies on a recent x86 server. Your machine will differ; ratios are stable.

| Variant | Test (uncontended) | Test (8 cores contending) | Add (uncontended) | Add (8 cores contending) |
| --- | --- | --- | --- | --- |
| `sync.Mutex` + library | 80 ns | 600 ns | 100 ns | 800 ns |
| `sync.RWMutex` + library | 60 ns | 150 ns | 100 ns | 900 ns |
| Atomic bitset | 80 ns | 90 ns | 100 ns | 150 ns |
| Sharded RWMutex (32) | 65 ns | 75 ns | 110 ns | 180 ns |
| Sharded atomic (32) | 85 ns | 95 ns | 115 ns | 130 ns |
| Block Bloom (atomic) | 30 ns | 35 ns | 40 ns | 60 ns |
| LSM-style immutable | 60 ns | 60 ns | N/A | N/A |

Observations:

- `sync.Mutex` and `sync.RWMutex` degrade dramatically under contention.
- Atomic variants stay near uncontended cost.
- Block Bloom is the fastest variant for both Test and Add.
- LSM-style is *constant* under any contention — there is no synchronisation.

Choose accordingly.

---

## Appendix: Memory Layouts at the Word Level

For senior debugging, knowing the exact word layout helps.

### Standard atomic bitset

```
bits []uint64
       │
       v
       [word 0][word 1][word 2][word 3]...[word (m+63)/64 - 1]

Each word: 8 bytes. m bits total. Memory: ceil(m / 64) * 8 bytes.
```

### Counting Bloom (4-bit counters)

```
counters []byte
            │
            v
            [byte 0][byte 1]...[byte (m+1)/2 - 1]

Each byte: 2 counters of 4 bits each.
Memory: ceil(m / 2) bytes = m * 4 bits = m/2 bytes.
```

### Counting Bloom (32-bit atomic)

```
counters []int32
            │
            v
            [int 0][int 1][int 2]...[int m - 1]

Each int32: 4 bytes.
Memory: m * 4 bytes.
```

### Cuckoo filter

```
buckets [B][slotsPerBucket]uint16   // typical: B buckets of 4 slots * 16-bit fingerprints
            │
            v
            [b0s0][b0s1][b0s2][b0s3] [b1s0][b1s1][b1s2][b1s3] ...

Memory: B * slotsPerBucket * sizeof(fingerprint).
```

### Partitioned Bloom

```
partitions [][]uint64
                │
                v
                [partition 0 bits]
                [partition 1 bits]
                ...
                [partition k-1 bits]

Memory: k * ceil(m/k / 64) * 8 bytes.
```

### Scalable Bloom

```
chain []*BloomFilter
          │
          v
          [sub 0: cap n_0]
          [sub 1: cap n_0*r]
          [sub 2: cap n_0*r^2]
          ...

Memory: geometric sum; with r=2 and L sub-filters, total memory is ~2 * largest sub-filter.
```

Knowing layouts in this much detail lets you compute exact memory costs for any design before you commit to it.

---

## Appendix: A Decision Flowchart for the Senior Architect

```
Q: Is this a static, read-only set after load?
   Y -> Xor filter (best memory).
   N -> continue.

Q: Need to delete individual keys?
   Y -> Cuckoo filter (memory) or Counting Bloom (simpler).
   N -> continue.

Q: Can you estimate the final n before construction?
   N -> Scalable Bloom filter.
   Y -> continue.

Q: Is the filter accessed by many goroutines concurrently?
   N -> sync.Mutex around library filter.
   Y -> continue.

Q: Is the workload read-heavy (>95% reads)?
   Y -> sync.RWMutex around library filter, OR atomic bitset.
   N -> continue.

Q: Are write throughput and latency critical?
   Y -> Atomic bitset, possibly sharded.
   N -> sync.RWMutex around library filter.

Q: Is the filter very large (>L3 cache)?
   Y -> Consider Block Bloom variant.
   N -> Standard Bloom is fine.

Q: Are inputs adversarial?
   Y -> Keyed hash (maphash/siphash) with per-process or per-tenant seed.
   N -> Library default (Murmur3) is fine.
```

Pin this. Walk through it for every Bloom-backed feature you ship.

---

## Appendix: Common Conversation Starters in Senior Code Review

Phrases you should be comfortable saying.

- "What's our `n` projection for 18 months out?"
- "How does this filter recover from a corrupted snapshot?"
- "Is this filter on the cache-aside or write-through pattern?"
- "Where do we measure observed FPR?"
- "What happens during a rolling deploy?"
- "Have we accounted for the rebuild memory peak?"
- "Is this filter assumed concurrent-safe, and where is that documented?"
- "What's the kill switch?"

These are senior questions. If a PR doesn't answer one, it isn't ready.

---

## Appendix: Senior-Level Reading Order

The first time through this file you read it linearly. The second time through, suggest this order:

1. Overview (intro + where middle left off).
2. Variant comparison (the decision matrix).
3. LSM-tree integration (the most beautiful real-world use).
4. Adversarial considerations (what could go wrong).
5. Architecture workshops (concrete designs).
6. Operations (what real production looks like).
7. Pitfalls + self-assessment.
8. Appendix on memory layouts (debugging reference).

Each section can be re-read independently. Pin the appendices.

---

## Appendix: A Personal Note on Bloom Filters

Bloom filters reward depth. Many engineers know "what they are." Few know "when to choose which variant." Even fewer know "how to operate one over five years of growth." The few who do are exactly the senior engineers you want on your team.

If you read this whole file and tried the exercises, you are among them.

---

## Final Wrap

Concurrent Bloom filters at senior level: variants, integration, distribution, operations, defence, culture. The data structure is small; the engineering around it is large; the choices are deliberate.

Professional.md takes the camera one more level closer: into the machine code, the memory model, the cache hierarchy, and the production failure modes that emerge at the largest scales. The journey from junior to senior taught you *what* to do; the next file teaches you *exactly why*.

Onwards.

---

## Extended Topic: Cost-Modelling a Bloom-Filter Service

A senior engineer is asked to justify the engineering investment in a Bloom filter. Below is the framework for the conversation with a product manager or finance.

### Cost of slow path

Pick a measurable cost per slow-path operation. For a DB lookup that costs 1 ms of CPU and 0.5 ms of I/O:

- CPU: 1 ms * $0.04/CPU-hour ≈ $1.1e-8.
- I/O: 0.5 ms * $0.10/IOPS-hour ≈ $1.4e-8.

Total: ~$2.5e-8 per slow-path call.

### Volume of slow-path operations

For a service handling 1 000 req/sec with 30% negative-lookup rate: 300 negative req/sec = 26M/day = 9.5B/year.

Without filter: 9.5B * $2.5e-8 = $237/year on negative-path cost.

Small? At higher scale:

For 100k req/sec, 30% negative: 31B/day, $283k/year in slow-path cost.

A Bloom filter that absorbs 99% of those negatives saves $280k/year.

### Cost of the filter

- Memory: 100 MB. At cloud rates ~$5/GB-month = $6/year.
- Engineering: ~1 senior-week to build + 4 hours/quarter to operate ≈ $20k/year.

Net savings: $260k/year for a $20k investment.

### When the math doesn't work

If your service is small (100 req/sec), the engineering cost may dominate. Use the library + RWMutex and move on; don't over-engineer.

If your service is medium (10k req/sec), the math becomes compelling. Justify the filter.

If your service is large (100k+ req/sec), the filter is essential. Justify *not* having one.

### Talking to finance

This back-of-envelope math is the senior contribution to the conversation. Engineers who can articulate cost trade-offs get the budget they need.

---

## Extended Topic: Bloom Filter as a System Quality Signal

The state of a Bloom filter often reflects the state of the system around it. Three signals:

### Signal 1: rising FPR

- Direct cause: filter saturation or hash quality issue.
- Indirect cause: data has grown without proportional filter growth.
- Indirect cause: rebuild process broken.

When you see rising FPR, look upstream.

### Signal 2: rising hit rate

- Direct cause: more queries are hitting the filter positively.
- Indirect cause: working-set growth, possibly indicating user growth.
- Indirect cause: changing query distribution (e.g. cache warmup).

A rising hit rate is usually good news; investigate to confirm.

### Signal 3: rising rebuild cost

- Direct cause: more keys, more time to populate.
- Indirect cause: data source becoming slow (e.g. DB under load during rebuild scan).
- Indirect cause: filter sized too small, rebuilds happening too frequently.

When rebuild cost rises, that's an early indicator of broader system stress.

A senior who monitors these three signals catches problems before they become incidents.

---

## Extended Topic: Bloom Filter Failure Stories Worth Knowing

Three brief tales from the war chest of public engineering postmortems.

### Story 1: The Hash Reuse Bug

A team built two filters. Filter A used FNV; filter B used Murmur3. Code copy-pasted between them; eventually a bug reverted filter B to also use FNV. The filters still worked. False-positive rates were unchanged. The bug was found 18 months later during a routine code audit.

Lesson: weak hash sometimes "works" because workloads happen to spread well. Active hash-family testing in CI is the only safe net.

### Story 2: The Race-Condition False Negative

A team used the library without a wrapper. Race detector was not run in CI. The race was subtle: only specific concurrent Add patterns lost bits, and only at high write rates. The bug manifested as a tiny rate of "user not found" for users that *were* in the DB.

Production silently dropped 0.01% of legitimate users for a year before someone noticed (a power user complained their account "didn't exist" when checked from a specific endpoint).

Lesson: `go test -race` in CI is non-optional. False negatives are bugs, even rare ones.

### Story 3: The Lock During Marshal Postmortem

The team's filter was very hot. Every 30 seconds the snapshot routine took a `sync.Mutex` lock around `MarshalBinary`. Marshal took 200 ms for the 100 MB filter. Every 30 seconds, all queries paused for 200 ms.

p99 latency had a periodic spike that was attributed to "garbage collection" for months. Eventually someone noticed the spike was *exactly* every 30 seconds.

Lesson: even maintenance tasks must avoid holding hot-path locks. Use snapshot-without-lock patterns.

---

## Extended Topic: A Mental Model for Senior-Level Filter Thinking

When you encounter a Bloom-filter-related question, work through the layers:

**Layer 1: The data structure.** What variant? What size? What hash?

**Layer 2: The concurrency.** Who reads? Who writes? What's the contention?

**Layer 3: The persistence.** Snapshot? Rebuild? Hot reload?

**Layer 4: The observability.** What metrics? What alerts?

**Layer 5: The lifecycle.** Cold start? Rebuild cadence? End-of-life?

**Layer 6: The system context.** What's upstream? What's downstream? What breaks if the filter fails?

**Layer 7: The business context.** What's the cost of a false positive? What's the cost of the filter itself?

Most engineers stop at layer 1 or 2. Senior engineers walk all seven. Staff engineers walk all seven and notice when the layers contradict each other.

---

## Closing Wisdom

The Bloom filter is a small data structure. Its engineering is large. The variants, the concurrency, the operations, the observability — these surround a 50-line core algorithm with a 5 000-line architecture.

That ratio is not unique to Bloom filters. It is the universal shape of production engineering: small primitives surrounded by large systems. The discipline of senior engineering is to keep the primitive simple and let the system around it grow only as much as needed.

When you are ready, professional.md awaits. There, we trade systems-level thinking for machine-level thinking: cache lines, memory ordering, NUMA topology, and the failure modes that only the largest scales reveal.
