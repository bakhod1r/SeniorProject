# Concurrent Bloom Filter — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — First Bloom filter

Write a program that constructs a `bloom.NewWithEstimates(1000, 0.01)`, adds 100 strings (`"k0".."k99"`), then verifies every one is reported present.

- Use `github.com/bits-and-blooms/bloom/v3`.
- Print "all present" if every Test returns true, otherwise the first missing key.

**Goal.** Get the library up; understand Add and Test.

---

### Task 2 — Observed FPR

Extend Task 1: probe 10 000 fresh keys (`"probe0".."probe9999"`) and count how many test true. Report the observed FPR.

- Compare against the target 0.01.
- Run with `n = 100`; should be well below 0.01.

**Goal.** See the target FPR with your own eyes.

---

### Task 3 — Hand-rolled Bloom

Implement a Bloom filter from scratch in a single file: `New(m, k)`, `Add([]byte)`, `Test([]byte)`. Use `hash/fnv` or `xxhash`. Verify it produces the same answers as the library for the same inputs (within FPR tolerance).

- About 40 lines.
- Use a `[]uint64` for the bitset.

**Goal.** Build the algorithm with your hands.

---

### Task 4 — Sizing calculator

Write a CLI that takes `n` and `p` as flags and prints `m` and `k` using `bloom.EstimateParameters`. Also print bytes (`m/8`) and bits-per-item (`m/n`).

```
$ bloomsize -n 1000000 -p 0.001
m=14377588 k=10 bytes=1797198 bits/item=14.38
```

**Goal.** Get fluent with the parameter formulas.

---

### Task 5 — Snapshot and restore

Add `MarshalBinary` and `UnmarshalBinary` to your Task 3 implementation. Verify a round-trip: build, marshal, unmarshal, Test for all added keys.

- Use `encoding/binary` for headers.
- Write m, k, then the bitset words.

**Goal.** Understand the wire format.

---

## Medium

### Task 6 — RWMutex wrapper

Write a `SafeFilter` struct that embeds `*bloom.BloomFilter` plus a `sync.RWMutex`. Implement Add and Test under appropriate locks. Run a test with 16 goroutines doing Adds and Tests concurrently; pass `-race`.

**Goal.** First concurrent Bloom filter.

---

### Task 7 — Atomic bitset

Reimplement Task 3 using `atomic.OrUint64` and `atomic.LoadUint64` instead of plain bitset ops. Run 16 goroutines concurrently Adding and Testing distinct keys; verify no false negatives. Run with `-race`.

**Goal.** Wait-free Bloom filter.

---

### Task 8 — Sharded filter

Build a 32-shard wrapper: 32 `*bloom.BloomFilter`, each with its own `sync.RWMutex`. Route keys via `hash(key) % 32`. Benchmark against the single-mutex wrapper for write-heavy workload.

- Pad each shard with `cpu.CacheLinePad` to avoid false sharing.
- Verify scaling at `-cpu=8,16`.

**Goal.** Throughput multiplication.

---

### Task 9 — Sliding-window dedup

Build a `Dedup` type that maintains two filters: cur and prev. Every hour, rotate (prev := cur; cur := fresh). Method `Seen(key)` returns true if cur OR prev says so; otherwise Adds to cur and returns false.

- Use `time.Ticker`.
- Lock for rotation; RLock for reads.
- Double-check after lock upgrade.

**Goal.** Time-bounded deduplication.

---

### Task 10 — Observed FPR sampling

Add to Task 6: track `hits`, `misses`, and `fpHits` with `atomic.Int64`. On 1% of "maybe" responses, confirm against a `map[string]bool` (the truth). If truth says false, increment `fpHits`. Expose an `ObservedFPR()` method.

**Goal.** Measure FPR in production-like code.

---

### Task 11 — Counting Bloom filter

Implement a CBF with 4-bit counters packed two-per-byte. Implement Add, Delete, Test. Verify a workload: Add 1000 keys; Delete 500; Test all; the first 500 should be absent, second 500 present.

- Saturating counters (cap at 15).
- Do not decrement saturated counters.
- Lock or atomic.

**Goal.** Add Delete support.

---

### Task 12 — Hot reload

Write a `HotFilter` struct with `atomic.Pointer[bloom.BloomFilter]`. Method `Reload(path string)` reads a snapshot and atomically swaps the filter. Method `Test(key)` uses the current filter. Verify under concurrent Tests that the swap is invisible to readers.

**Goal.** Wait-free pointer swap.

---

## Hard

### Task 13 — Scalable Bloom filter

Implement an SBF. Parameters: base capacity `n_0`, growth ratio `r`, tightening ratio `s`, initial FPR `p_0`. Maintain a chain of sub-filters. Adds go to the current; if full, append a fresh one. Tests check all sub-filters.

- Track per-sub-filter count with `atomic.Uint64`.
- Grow under a write lock.
- Verify overall FPR ≤ `p_0 / (1 - s)`.

**Goal.** Unbounded growth.

---

### Task 14 — Cuckoo filter

Implement a Cuckoo filter. Buckets of 4 fingerprints, 16-bit fingerprints. Insert via cuckoo eviction; bound by max kicks (500). Lookup checks two buckets. Delete clears a matching fingerprint.

- Test with 100k keys; verify all present.
- Delete half; verify deleted ones absent, others present.

**Goal.** Native delete with low memory.

---

### Task 15 — Block Bloom

Implement a block Bloom filter: each block is 8 `uint64` words (one cache line). A key's k bits all land within one block. Compare Test latency against your flat atomic Bloom for a 100 MB filter.

- Bench with `RunParallel`.
- Expect 5-10x improvement on Test latency for large filters.

**Goal.** Cache-friendly Bloom.

---

### Task 16 — Distributed merge

Build a service that exposes HTTP `/add` and `/test` endpoints. Periodically (every 30s), gossip the filter to a peer service via HTTP POST and merge received filters. Verify two services converge to the same filter.

- Use `MarshalBinary`/`UnmarshalBinary` for transport.
- `Merge` via `f.Union(other)`.
- Test with two-process setup.

**Goal.** Distributed CRDT semantics.

---

### Task 17 — Bloom-backed cache

Build a `Cache` with three layers: in-memory LRU, atomic Bloom filter, and a slow source of truth (simulated with `time.Sleep`). Implement `Get(key)`: check LRU, then filter, then truth. Benchmark a 30%-miss workload.

- Use `groupcache/lru` or `hashicorp/golang-lru`.
- Bloom acts as "definitely not in source."
- Compare with no-filter baseline.

**Goal.** Multi-layer cache hierarchy.

---

### Task 18 — Online rebuild with double-write

Extend Task 6: add a `Rebuild(newN, newP)` method that:

1. Constructs a fresh filter.
2. Sets a `rebuildIn` pointer for double-writes.
3. Populates the fresh filter by iterating a truth slice.
4. Atomically swaps the current filter.
5. Clears `rebuildIn`.

Verify Adds during the rebuild land in the fresh filter post-swap.

**Goal.** Zero-downtime rebuild.

---

### Task 19 — Adversarial defence

Build a Bloom filter using `hash/maphash` with a per-process secret seed. Verify that an external "attacker" cannot precompute keys that collide on chosen bits, since they don't know the seed.

- Use `maphash.MakeSeed()` once at startup.
- Pass `seed` and `key` to `maphash.Bytes`.

**Goal.** Hash flooding resistance.

---

### Task 20 — Production-grade wrapper

Combine everything: a `ProductionFilter` struct that supports:

- Concurrent Add and Test (atomic or sharded).
- Observed FPR sampling.
- Prometheus metrics export (capacity, fill, FPR, hits).
- Hot reload from a file.
- Online rebuild with double-write.
- Snapshot on shutdown.
- Kill switch via config flag.

Document each method with concurrency semantics.

**Goal.** Ship-ready code.

---

## Bonus Tasks

### Task 21 — Property-based test

Use `rapid` (pgregory.net/rapid) to generate random key sets, build a Bloom filter, and assert no false negatives. Run for 1000 iterations.

**Goal.** Prove no false negatives via property-based testing.

---

### Task 22 — FPR vs n curve

Write a program that, for n in `[100, 200, 500, 1000, 2000, 5000, 10000]`, builds a Bloom filter sized for `n_design = 1000` and measures observed FPR. Plot or print the curve.

**Goal.** Visualise saturation.

---

### Task 23 — k optimum sweep

For fixed n = 10000 and m = 100000, sweep k from 1 to 20. Measure observed FPR at each k. Find the empirical optimum and compare with `(m/n) ln 2 ≈ 6.93`.

**Goal.** Verify the optimum-k formula empirically.

---

### Task 24 — Bloom filter as a CRDT

Build two filters that diverge under different Adds, then Merge. Verify the merged filter contains all keys from both. Verify Merge is commutative: `A.Union(B) == B.Union(A)`.

**Goal.** Understand the CRDT structure.

---

### Task 25 — Real workload simulation

Pick a real-world dataset (e.g. a Wikipedia title dump). Load 1M titles into a Bloom filter. Query with 1M random strings. Measure observed FPR. Compare with target.

**Goal.** Validate on non-synthetic data.

---

## Solutions or Solution Sketches

### Solution 1

```go
package main

import (
	"fmt"
	"github.com/bits-and-blooms/bloom/v3"
)

func main() {
	f := bloom.NewWithEstimates(1000, 0.01)
	for i := 0; i < 100; i++ {
		f.AddString(fmt.Sprintf("k%d", i))
	}
	for i := 0; i < 100; i++ {
		if !f.TestString(fmt.Sprintf("k%d", i)) {
			fmt.Println("missing:", i)
			return
		}
	}
	fmt.Println("all present")
}
```

### Solution 2

Add to Task 1:

```go
fp := 0
for i := 0; i < 10_000; i++ {
	if f.TestString(fmt.Sprintf("probe%d", i)) {
		fp++
	}
}
fmt.Printf("observed FPR = %.4f\n", float64(fp)/10_000)
```

### Solution 6 sketch

```go
type SafeFilter struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
}

func (s *SafeFilter) Add(k []byte) { s.mu.Lock(); s.f.Add(k); s.mu.Unlock() }
func (s *SafeFilter) Test(k []byte) bool { s.mu.RLock(); defer s.mu.RUnlock(); return s.f.Test(k) }
```

### Solution 7 sketch

See the `Filter` in middle.md or professional.md. Key insight: use `atomic.OrUint64` for Adds and `atomic.LoadUint64` for Tests; wait-free by construction.

### Solution 8 sketch

Use 32 padded shard structs. Route by `hash(key) % 32`. Benchmark with `b.RunParallel` and `-cpu=8`.

### Solution 13 sketch

See the SBF implementation in middle.md or senior.md. Chain of sub-filters; current's `count` tracked with `atomic.Uint64`; grow on count >= cap; Test iterates the chain.

### Solution 14 sketch

Use `github.com/seiflotfy/cuckoofilter` as a reference; or implement from scratch:

```go
type Cuckoo struct {
	buckets [][4]uint16
	numBuckets uint64
}

func (c *Cuckoo) Insert(key []byte) bool {
	fp := uint16(xxhash.Sum64(key) & 0xFFFF)
	if fp == 0 { fp = 1 }
	b1 := xxhash.Sum64(key) % c.numBuckets
	b2 := b1 ^ uint64(fp*0x5bd1e995) % c.numBuckets
	for tries := 0; tries < 500; tries++ {
		if c.insertInto(b1, fp) { return true }
		if c.insertInto(b2, fp) { return true }
		// Evict and try again.
		evicted := c.evictRandom(b1, fp)
		b1, b2 = b2, b1^uint64(evicted*0x5bd1e995)%c.numBuckets
		fp = evicted
	}
	return false
}
```

(Pseudocode; details omitted.)

### Solution 15 sketch

See the block Bloom implementation in professional.md. Key insight: hash to a block index; all k positions within the block; one cache miss per Test.

### Solution 18 sketch

```go
func (s *SafeFilter) Rebuild(ctx context.Context, newN uint, newP float64) error {
	fresh := bloom.NewWithEstimates(newN, newP)
	s.mu.Lock()
	s.rebuildIn = fresh
	s.mu.Unlock()

	// Populate from truth.
	for _, k := range s.truth.AllKeys() {
		fresh.AddString(k)
	}

	s.mu.Lock()
	s.f = fresh
	s.rebuildIn = nil
	s.mu.Unlock()
	return nil
}

func (s *SafeFilter) Add(k []byte) {
	s.mu.Lock()
	s.f.Add(k)
	if s.rebuildIn != nil { s.rebuildIn.Add(k) }
	s.mu.Unlock()
}
```

### Solution 19 sketch

```go
import "hash/maphash"

var seed = maphash.MakeSeed()

func hashes(key []byte) (uint64, uint64) {
	h := maphash.Bytes(seed, key)
	h2 := h>>33 | h<<31
	if h2 == 0 { h2 = 1 }
	return h, h2
}
```

The `seed` is generated once at process start and kept secret. An attacker without the seed cannot construct colliding keys.

### Solution 20

See the `ProductionFilter` skeleton in middle.md ("Production-grade wrapper" subsection). Combines `atomic.Pointer` for hot reload, atomic counters for observed FPR, Prometheus gauges, and double-write rebuild.

---

## Tips for Working Through the Tasks

- **Start with task 1.** Even if you know the library, build muscle memory.
- **Run with `-race`.** Every task that touches concurrency. Always.
- **Benchmark your implementations.** `go test -bench=. -benchmem`.
- **Read the library source** alongside each task; the library is short and clean.
- **Stretch with the Bonus tasks.** They build deeper intuition.

When you can do all 25 from memory, you have ground-up mastery of concurrent Bloom filters in Go.

---

## What You Have Built

Working through these tasks, you have constructed:

- A hand-rolled Bloom filter.
- A library-wrapped concurrent Bloom filter (RWMutex).
- An atomic-bitset Bloom filter.
- A sharded Bloom filter.
- A counting Bloom filter with delete.
- A sliding-window deduplicator.
- A scalable Bloom filter.
- A Cuckoo filter.
- A block Bloom filter.
- A hot-reloadable Bloom filter.
- A distributed-merge Bloom filter.
- A production-grade wrapper with metrics.

Each is a small piece of code. Together they cover every concurrent-Bloom scenario you will meet in production.

Save them in a personal `bloom-toolkit` repository. Refer back to them when the next service needs a filter. Years from now, you will be glad you wrote them once.

---

## Stretch Tasks

### Task 26 — Bloom filter with `sync.Pool` for keys

Build a Bloom filter that accepts keys via a pre-allocated buffer pool to eliminate allocations on hot paths. Verify with `b.ReportAllocs()` that Test/Add do not allocate.

**Goal.** Allocation-free hot path.

---

### Task 27 — Filter health-check endpoint

Add a `/health` HTTP endpoint that:

- Adds a sentinel key.
- Tests it.
- Returns 200 if true; 500 if false.

Run periodically as an external health monitor.

**Goal.** Catch corruption via sentinel.

---

### Task 28 — Bloom filter in front of HTTP cache

Wrap a `httputil.ReverseProxy` with a Bloom filter that pre-filters known-404 URLs. Negative answers return 404 without round-tripping the upstream.

- Filter sized for the known-good URL set.
- Periodically rebuild from upstream's sitemap.

**Goal.** Cache acceleration.

---

### Task 29 — Bloom filter for sparse joins

Given two slices of strings (set A, set B), use a Bloom filter to compute their probable intersection in O(|A| + |B|) without sorting.

- Build a Bloom filter from A.
- Iterate B; emit elements whose Test is true.
- Verify the result is a superset of the true intersection (no missing items).

**Goal.** Bloom-accelerated set operations.

---

### Task 30 — Filter with TTL via decay

Implement a Bloom filter that periodically decays: every minute, randomly clear 1% of bits. Old keys gradually disappear; new keys stay fresh.

- Use a goroutine with `time.Ticker`.
- Sample bit positions to clear.
- Discuss: what is the effective TTL?

**Goal.** Approximate TTL semantics.

---

### Task 31 — Bloom filter for password breach checks

Download a small subset of the HaveIBeenPwned database (or simulate with 100 000 known passwords). Build a Bloom filter; expose a Test method via HTTP. Verify a known breached password returns true.

- Use SHA-1 prefixes (HIBP convention) for hashing.
- 1% FPR is fine; users see "your password may be breached, please change."

**Goal.** A real privacy-preserving negative-cache use case.

---

### Task 32 — Bloom filter with bitset compression on snapshot

Marshal the filter, gzip-compress the bytes, store on disk. Unmarshal: decompress, parse. Compare disk size with uncompressed.

- For a half-full filter, compression buys little.
- For a sparsely-populated filter, compression buys a lot.

**Goal.** Storage optimisation.

---

### Task 33 — Bloom filter benchmarking harness

Build a CLI that, given parameters, runs a comprehensive benchmark: throughput at GOMAXPROCS 1, 2, 4, 8, 16; mean and p99 latency; allocation count; CPU vs mutex profile.

Output: a table per variant (Mutex, RWMutex, Atomic, Sharded).

**Goal.** Reproducible measurement.

---

### Task 34 — Bloom filter for log-shipping dedup

Read a log file line-by-line; assign each line an ID (hash of content); dedup using a Bloom filter; output unique lines only.

- Run on a real log file.
- Compare with `sort -u` for correctness.

**Goal.** Real-world streaming dedup.

---

### Task 35 — Bloom-filter-based throttling

Build a throttle that allows a user to call an API at most once per hour. Use a Bloom filter sized for users; rotate hourly. Test returns "throttled" if the user's ID is in the filter.

- 1% FPR means 1% of legitimate calls are wrongly throttled.
- Acceptable for non-critical use; not for 2FA.

**Goal.** Approximate rate limiting.

---

## Solutions Continued

### Solution 26 sketch

```go
var keyPool = sync.Pool{
    New: func() any { return make([]byte, 0, 64) },
}

func (s *Service) processKey(id int) {
    buf := keyPool.Get().([]byte)[:0]
    defer keyPool.Put(buf)
    buf = strconv.AppendInt(buf, int64(id), 10)
    s.filter.Test(buf)
}
```

### Solution 27 sketch

```go
func (s *Service) Health(w http.ResponseWriter, r *http.Request) {
    sentinel := []byte("__sentinel__")
    s.filter.Add(sentinel)
    if !s.filter.Test(sentinel) {
        w.WriteHeader(500)
        w.Write([]byte("filter corrupt"))
        return
    }
    w.WriteHeader(200)
    w.Write([]byte("ok"))
}
```

(In real use, you would Add the sentinel once at startup, not on every health check.)

### Solution 29 sketch

```go
func ProbableIntersection(a, b []string, fpr float64) []string {
    f := bloom.NewWithEstimates(uint(len(a)), fpr)
    for _, k := range a {
        f.AddString(k)
    }
    var result []string
    for _, k := range b {
        if f.TestString(k) {
            result = append(result, k)
        }
    }
    return result
}
```

For a 0.01 FPR, the result contains the true intersection plus about 1% of |b| as false positives. Confirm-against-A is required for exactness.

---

## Combined Mega-Task

### Task 36 — Build a small open-source Go library

Create a public repository implementing:

- An atomic-bitset Bloom filter.
- A sharded variant.
- A counting Bloom filter.
- A sliding-window dedup type.
- Hot reload via `atomic.Pointer`.
- Prometheus metrics integration.
- Comprehensive tests with `-race`.
- Benchmarks vs `bits-and-blooms/bloom/v3`.
- Documentation (godoc + README).

Publish to GitHub; share on r/golang.

**Goal.** Contribute to the ecosystem.

---

## Wrapping Up

After completing the easy and medium tasks you have shipped real concurrent Bloom filter code. After the hard tasks you have built variants from the literature. After the bonus tasks you have explored the design space.

The most valuable outcome is *muscle memory*: the next time you face a Bloom filter problem, you reach reflexively for the right pattern, the right variant, the right wrapper, with the right metrics. That's what the practice buys.
