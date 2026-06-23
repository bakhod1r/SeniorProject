# Concurrent Bloom Filter — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Where Junior Left Off](#where-junior-left-off)
3. [The Concurrency Spectrum](#the-concurrency-spectrum)
4. [Atomic Bitsets](#atomic-bitsets)
5. [A Lock-Free Bloom Filter](#a-lock-free-bloom-filter)
6. [Sharded Bloom Filters](#sharded-bloom-filters)
7. [Read-Heavy vs Write-Heavy Tuning](#read-heavy-vs-write-heavy-tuning)
8. [Counting Bloom Filters: Adding Delete](#counting-bloom-filters-adding-delete)
9. [Observability in Production](#observability-in-production)
10. [Sliding-Window Filters](#sliding-window-filters)
11. [Snapshot, Restore, and Hot Reload](#snapshot-restore-and-hot-reload)
12. [Hash Choice for Concurrent Workloads](#hash-choice-for-concurrent-workloads)
13. [Memory Layout and False Sharing](#memory-layout-and-false-sharing)
14. [Library Internals That Matter at Middle Level](#library-internals-that-matter-at-middle-level)
15. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
16. [Production Checklist](#production-checklist)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Junior taught you what a Bloom filter is, how to build one, how to size it, and how to wrap a single library instance with `sync.RWMutex` so multiple goroutines can share it safely. That works — but it serialises every Add through one writer lock and tops out long before you have used the cores on a modern server.

Middle is about all the things you do *after* "the RWMutex wrapper is my bottleneck." There are three orthogonal axes to explore:

1. **Replacing the lock with atomics.** A bitset can be updated word-at-a-time with `atomic.OrUint64` or CAS, eliminating the writer lock entirely. Tests become wait-free.
2. **Sharding the filter.** Split the bitset into N independent shards, each with its own lock or atomic word. Contention drops by 1/N at the cost of slightly trickier math for set operations.
3. **Counting variants.** Replace bits with small counters (typically 4 bits each) so you can decrement on Delete. Counting Bloom filters trade memory for the ability to forget.

Around all three you need **observability**: a Bloom filter without metrics is a black box, and the only way to know it is failing is to feel the latency rise.

After reading this you will:

- Be able to write a lock-free Bloom filter using `sync/atomic`.
- Pick between mutex, RWMutex, atomic, and sharded designs based on workload shape.
- Build a counting Bloom filter that supports Add, Test, and Delete.
- Expose Prometheus-style metrics: capacity, fill fraction, observed FPR, rebuild count.
- Run a sliding-window dedup filter with safe rotation.
- Avoid false sharing and other middle-level performance traps.
- Use library internals (`BitSet`, `BaseHashes`) for advanced patterns.

You do not need to know yet about partitioned Bloom filters, scalable Bloom filters, Cuckoo filters, or block-Bloom cache packing — those are senior and professional topics. Stay focused: Bloom + concurrency + observability is the middle level.

---

## Where Junior Left Off

The junior solution looks like this:

```go
type SafeFilter struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
}
```

It serialises every Add. Under a write-heavy workload — say 100k Add/sec from 16 goroutines — the writer lock becomes a single core's worth of throughput, no matter how many cores you have. A profile shows `runtime.semawakeup` and `sync.(*Mutex).Lock` in the top five.

The three solutions, in order of complexity:

| Solution | Add scales? | Test scales? | Lock-free? | Notes |
| --- | --- | --- | --- | --- |
| `sync.Mutex` | No | No | No | Simplest, only correct option below ~10k ops/sec total. |
| `sync.RWMutex` | No | Yes | No | Default. Tests are parallel; Adds serialise. |
| Sharded (N shards) | Up to N | Up to N | Per shard | Each shard's mutex is independent. |
| Atomic bitset | Yes | Yes | Yes | True wait-free reads; CAS-loop writes. |
| Sharded + atomic | Yes | Yes | Yes | Belt and braces. Senior level explores this. |

In what follows we build each, measure each, and discuss when each is right.

---

## The Concurrency Spectrum

Bloom filter concurrency divides cleanly along the *update granularity* axis:

- **One global lock.** Whole filter is the unit of mutual exclusion.
- **One lock per shard.** Each independent slice of the filter is its own unit.
- **One atomic word.** Each `uint64` word in the bitset is its own unit. Atomic OR makes Adds wait-free; no lock at all.
- **One bit.** Theoretically the finest granularity; practically expressed as bit-level CAS, but each Add still touches a whole word so this reduces to atomic-word in practice.

The right granularity depends on:

- **Workload mix.** Read-heavy (>99% Test) suits RWMutex or atomic well; write-heavy suits shards or atomic.
- **Filter size.** A large filter spreads writes naturally across many words; contention is low without effort.
- **Number of cores.** More cores means more pressure to reduce contention.
- **Latency sensitivity.** A writer lock under contention has p99 spikes; atomic CAS retries have predictable per-operation cost.

Concrete rule of thumb:

- < 4 cores, < 10k ops/sec, < 1 MB filter: `sync.RWMutex` is fine.
- < 16 cores, 100k ops/sec, > 10 MB filter: atomic bitset.
- > 16 cores, > 1M ops/sec, > 100 MB filter: sharded atomic.

Use the rule as a starting point; measure before believing it.

---

## Atomic Bitsets

Go 1.19 added typed atomic operations: `atomic.Uint64.Or`, `atomic.Uint64.And`, `atomic.Uint64.Add`, etc. Prior to 1.19 you used `atomic.CompareAndSwapUint64` in a loop. Go 1.23 added `atomic.OrUint64(addr *uint64, mask uint64)` as a package-level function. All do the same thing: an atomic read-modify-write that cannot lose bits.

### Writing one bit, atomically

```go
import "sync/atomic"

// Set bit i in bits[i/64].
func setBit(bits []uint64, i uint64) {
	wordIdx := i / 64
	mask := uint64(1) << (i % 64)
	atomic.OrUint64(&bits[wordIdx], mask)
}
```

The atomic OR fetches the current word value, ORs the mask in, and stores the result — *all without an intervening read or write from any other goroutine*. Two goroutines setting two different bits in the same word both succeed; neither bit is lost. This is exactly the fix for the lost-bit race we saw in junior.md.

### Reading one bit, atomically

```go
func testBit(bits []uint64, i uint64) bool {
	wordIdx := i / 64
	mask := uint64(1) << (i % 64)
	return atomic.LoadUint64(&bits[wordIdx])&mask != 0
}
```

An atomic Load reads a coherent snapshot of the word. The bit is either set or not at the time of the read; you cannot see a half-updated word.

### Cost model

- **`atomic.OrUint64`** is implemented as a hardware LOCK OR on x86 and an LL/SC loop on ARM. Cost: ~15–30 ns under no contention; rises sharply with contention as cache lines bounce between cores.
- **`atomic.LoadUint64`** is a regular load with appropriate fences. Cost: 1–2 ns on x86; effectively free if the cache line is hot.

The whole reason atomics work for Bloom filters is that *contention is rare in well-sized filters*: the bitset is mostly half-full, so most Adds touch a different word from most other Adds. Tests are pure reads and never block.

---

## A Lock-Free Bloom Filter

Let us build one from scratch. About 80 lines, no external dependencies.

```go
package atomicbloom

import (
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
)

type Filter struct {
	bits []uint64
	m    uint64
	k    uint64
}

func New(m, k uint64) *Filter {
	words := (m + 63) / 64
	return &Filter{
		bits: make([]uint64, words),
		m:    m,
		k:    k,
	}
}

func (f *Filter) hashes(key []byte) (uint64, uint64) {
	x := xxhash.Sum64(key)
	h1 := x
	h2 := x>>33 | x<<31 // rotate; ensure non-zero typically
	if h2 == 0 {
		h2 = 1
	}
	return h1, h2
}

func (f *Filter) Add(key []byte) {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		pos := (h1 + i*h2) % f.m
		wordIdx := pos / 64
		mask := uint64(1) << (pos % 64)
		atomic.OrUint64(&f.bits[wordIdx], mask)
	}
}

func (f *Filter) Test(key []byte) bool {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		pos := (h1 + i*h2) % f.m
		wordIdx := pos / 64
		mask := uint64(1) << (pos % 64)
		if atomic.LoadUint64(&f.bits[wordIdx])&mask == 0 {
			return false
		}
	}
	return true
}

func (f *Filter) Cap() uint64 { return f.m }
func (f *Filter) K() uint64   { return f.k }
```

This filter is:

- **Safe to share across any number of goroutines.** All bitset mutations are atomic.
- **Wait-free for Tests.** A Test never blocks.
- **Almost wait-free for Adds.** `atomic.OrUint64` is a single hardware operation; it does not loop or retry, so Adds are also wait-free in the literal sense.
- **Linearisable in a useful sense.** If Add A completes-before Test B (per the Go memory model), B observes the bits A set.

### Things this filter cannot do (yet)

- **Marshal.** No serialisation method.
- **Estimate fill.** `ApproximatedSize` would require summing `bits.OnesCount64` across words — easy to add but allocating no temporary makes it tricky to do correctly under live writes (you would get a non-snapshotted count, which is fine for monitoring but not for equality).
- **Delete.** Bits cannot be unset without losing other keys' bits.
- **Resize.** Atomic operations on the slice header are out of scope; resizing requires a swap of the whole struct under a mutex.

For most middle-level needs, these omissions are acceptable. If you need marshal, you can `atomic.Load` each word in a loop and serialise the snapshot; concurrent updates during marshalling produce a *valid* filter (no torn words) that may include or exclude in-flight Adds — which is fine for a Bloom filter's semantics.

### A benchmark

```go
package atomicbloom

import (
	"fmt"
	"sync"
	"testing"
)

func BenchmarkConcurrentAdd(b *testing.B) {
	f := New(8_000_000, 7)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			f.Add([]byte(fmt.Sprintf("k%d", i)))
			i++
		}
	})
}

func BenchmarkRWMutexAdd(b *testing.B) {
	var mu sync.RWMutex
	f := New(8_000_000, 7)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			mu.Lock()
			f.Add([]byte(fmt.Sprintf("k%d", i)))
			mu.Unlock()
			i++
		}
	})
}
```

On an 8-core machine the atomic filter typically clocks 6–8x the throughput of the RWMutex-wrapped version under write-heavy load. Run it on your hardware; the ratio depends on core count and contention.

---

## Sharded Bloom Filters

The other classic trick is sharding: keep N independent filters and route each key to one by `hash(key) % N`. Each shard has its own lock (or its own atomic bitset).

```go
package sharded

import (
	"hash/fnv"
	"sync"

	"github.com/bits-and-blooms/bloom/v3"
)

const numShards = 32

type Filter struct {
	shards [numShards]shard
}

type shard struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
	_  [40]byte // pad to push next shard onto its own cache line
}

func New(n uint, p float64) *Filter {
	perShardN := n / numShards
	if perShardN < 1 {
		perShardN = 1
	}
	f := &Filter{}
	for i := range f.shards {
		f.shards[i].f = bloom.NewWithEstimates(perShardN, p)
	}
	return f
}

func (f *Filter) shardFor(key []byte) *shard {
	h := fnv.New32a()
	h.Write(key)
	return &f.shards[h.Sum32()%numShards]
}

func (f *Filter) Add(key []byte) {
	s := f.shardFor(key)
	s.mu.Lock()
	s.f.Add(key)
	s.mu.Unlock()
}

func (f *Filter) Test(key []byte) bool {
	s := f.shardFor(key)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.f.Test(key)
}
```

### Why 32 shards?

A good default for modern servers (16–64 cores). With too few shards you still contend; with too many you waste memory on per-shard overhead and lose cache locality. 32 is a popular choice in Cassandra, Caffeine, and other reference codebases.

### The padding trick

`_ [40]byte` pads each `shard` to fill a 64-byte cache line (plus some). Without padding, two adjacent shards land in the same cache line, and Adds to either invalidate the other's cache copy — *false sharing*, the cardinal sin of multi-core data structures. With padding, each shard owns its cache line exclusively.

The padding size depends on the size of `mu sync.RWMutex` (24 bytes on amd64) and `f *bloom.BloomFilter` (8 bytes pointer). 24 + 8 = 32 bytes; pad to 64 with another 32 bytes — but I used 40 above to also include alignment margin. Profile on your platform: `go test -bench` with and without padding will show the cost of false sharing directly.

### Sharded math

The combined behaviour of N shards each sized for `n/N` items at FPR `p` is — for the same Test — exactly `p` (the key lands in exactly one shard). So sizing is straightforward: per-shard `n` and per-shard `p` are what you choose.

The combined *memory* is N times the per-shard memory. So per-shard sizing for `n/N` items keeps total memory close to the un-sharded equivalent — there is a small constant overhead from N filter headers.

### `Union` and `Intersect` are hard

Sharded filters complicate set operations. You cannot Union two sharded filters by Unioning each shard pair — different keys might route to different shard indices in the two filters if their hash families differ. If you need Union semantics, either:

- Make the two filters share the same shard-routing hash (pin a seed), or
- Skip sharding and use a single atomic filter.

In production this rarely bites because Union is mostly used for analytics merges, where you can afford a serialised pass.

---

## Read-Heavy vs Write-Heavy Tuning

Three workloads, three best choices:

### 99% reads, 1% writes (typical negative cache)

- `sync.RWMutex` wrapper.
- Tests run in parallel; the occasional Add takes the write lock briefly.
- The RWMutex overhead per call is ~30 ns; for 99% reads this is negligible.

### 50/50 mix (event deduper)

- Atomic bitset. Both paths are wait-free.
- If memory pressure tolerates it, double the filter size to reduce contention probability per word.

### Write-dominant (crawler URL frontier)

- Sharded + atomic per shard. Maximum throughput.
- Consider partitioning the *work* (each goroutine owns a shard's worth of work) so Adds rarely cross shards.

A heuristic: if you can express "this goroutine only writes to this slice of keys," you can shard along that boundary and have *zero* cross-shard contention.

### Workload diagnosis with pprof

```
go test -cpuprofile=cpu.out -bench=.
go tool pprof -http=:8080 cpu.out
```

Look for `runtime.sync.(*Mutex).Lock`, `runtime.sync.(*RWMutex).Lock`, `runtime.lock2`, `runtime.gopark`. If those add up to more than 10% of CPU, your locks are the bottleneck — move to atomic or sharded.

```
go test -mutexprofile=mu.out -bench=.
go tool pprof -http=:8081 mu.out
```

The mutex profile shows *contention time*, not just CPU. A 5%-CPU mutex can be a 50%-wallclock mutex if many goroutines wait on it.

---

## Counting Bloom Filters: Adding Delete

The basic Bloom filter cannot delete. The counting Bloom filter (CBF) can. The trick is to replace each *bit* with a small *counter* (typically 4 bits). Adding increments the k counters; Deleting decrements them; Testing checks they are all positive.

### Why 4 bits?

A counter overflows when more than `2^bits - 1` keys hash to that position. For optimum k and a half-full filter, the expected number of Adds hitting any one counter is `k * n / m ≈ ln 2 ≈ 0.693`. The chance of a counter reaching 16 (i.e. overflowing 4 bits) is astronomically small — about `10^-12` for typical parameters. Most CBF implementations use 4 bits.

### Implementation

```go
package counting

import (
	"sync"

	"github.com/cespare/xxhash/v2"
)

// CountingFilter stores 4-bit counters packed two-per-byte.
type CountingFilter struct {
	mu       sync.Mutex
	counters []byte // each byte holds counters i*2 and i*2+1
	m        uint64
	k        uint64
}

func New(m, k uint64) *CountingFilter {
	return &CountingFilter{
		counters: make([]byte, (m+1)/2),
		m:        m,
		k:        k,
	}
}

func (c *CountingFilter) hashes(key []byte) (uint64, uint64) {
	x := xxhash.Sum64(key)
	h2 := x>>33 | x<<31
	if h2 == 0 {
		h2 = 1
	}
	return x, h2
}

func (c *CountingFilter) get(i uint64) uint8 {
	b := c.counters[i/2]
	if i%2 == 0 {
		return b & 0x0F
	}
	return b >> 4
}

func (c *CountingFilter) set(i uint64, v uint8) {
	v &= 0x0F
	b := &c.counters[i/2]
	if i%2 == 0 {
		*b = (*b & 0xF0) | v
	} else {
		*b = (*b & 0x0F) | (v << 4)
	}
}

func (c *CountingFilter) Add(key []byte) {
	h1, h2 := c.hashes(key)
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := uint64(0); i < c.k; i++ {
		pos := (h1 + i*h2) % c.m
		v := c.get(pos)
		if v < 15 { // saturating counter
			c.set(pos, v+1)
		}
	}
}

func (c *CountingFilter) Delete(key []byte) {
	h1, h2 := c.hashes(key)
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := uint64(0); i < c.k; i++ {
		pos := (h1 + i*h2) % c.m
		v := c.get(pos)
		if v > 0 && v < 15 { // do not decrement saturated counters
			c.set(pos, v-1)
		}
	}
}

func (c *CountingFilter) Test(key []byte) bool {
	h1, h2 := c.hashes(key)
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := uint64(0); i < c.k; i++ {
		pos := (h1 + i*h2) % c.m
		if c.get(pos) == 0 {
			return false
		}
	}
	return true
}
```

### The saturation rule

A counter that reaches 15 (the max for 4 bits) is *saturated*. We never increment past 15 and we never decrement *from* 15. Why? Because a saturated counter has lost track of the true number of Adds that hit it. Decrementing it would risk under-counting — a future Delete might bring it to 0 even though one of the original keys is still "present," producing a false negative.

The cost: a tiny fraction of bits become permanently 1. Empirically this barely affects FPR for reasonable parameters.

### Concurrent counting

Notice that the example uses a `sync.Mutex`. CBFs are harder to make lock-free because counters are sub-byte (4 bits) and `sync/atomic` operates on whole bytes or larger. Options:

1. **One mutex for the whole filter.** Simplest; serialises everything. Fine for low rates.
2. **One mutex per shard.** Sharded CBF; same trade-offs as a sharded basic filter.
3. **`atomic.AddInt32` on a `[]int32` of counters.** 4 bytes per counter (8x the memory) but lock-free.
4. **CAS on whole bytes (two counters at a time).** Pack two 4-bit counters in a byte; CAS the byte. Tricky — saturation logic in a CAS loop is fiddly.

Most production CBFs choose option 1 or 2.

### Library support

`bits-and-blooms/bloom/v3` does *not* include a counting Bloom filter. For Go, see `github.com/seiflotfy/cuckoofilter` for the closely related Cuckoo filter (next level), or roll your own as above. The willf/bloom organisation maintains a separate `willf/cbloom` repository that is less actively updated.

---

## Observability in Production

A Bloom filter without metrics is a fire hazard. The four numbers you must always expose:

1. **`bloom_capacity_bits`** — `m`. Constant after construction; one gauge per filter.
2. **`bloom_fill_fraction`** — fraction of bits set, sampled periodically. Crosses 0.5 around the design n.
3. **`bloom_observed_fpr`** — rolling 1-minute observed false-positive rate, computed from Test calls that returned true and were subsequently disconfirmed by the slow path.
4. **`bloom_approximated_size`** — `ApproximatedSize()`. Useful for "are we full?"

In Go with `prometheus/client_golang`:

```go
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	BloomCapacity = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "bloom_capacity_bits",
		Help: "Bitset size m of the Bloom filter.",
	}, []string{"name"})

	BloomFill = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "bloom_fill_fraction",
		Help: "Fraction of bits set in the filter (0..1).",
	}, []string{"name"})

	BloomFPR = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "bloom_observed_fpr",
		Help: "Observed false-positive rate (rolling window).",
	}, []string{"name"})

	BloomApprox = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "bloom_approximated_size",
		Help: "Swamidass-Baldi item count estimate.",
	}, []string{"name"})

	BloomTests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "bloom_tests_total",
		Help: "Test calls. label result=hit|miss.",
	}, []string{"name", "result"})
)
```

A periodic updater:

```go
import "time"

func StartGauges(name string, f *bloom.BloomFilter, hits, fpHits func() int64) {
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		BloomCapacity.WithLabelValues(name).Set(float64(f.Cap()))
		for range t.C {
			fill := float64(f.BitSet().Count()) / float64(f.Cap())
			BloomFill.WithLabelValues(name).Set(fill)
			BloomApprox.WithLabelValues(name).Set(float64(f.ApproximatedSize()))
			h := hits()
			fp := fpHits()
			if h > 0 {
				BloomFPR.WithLabelValues(name).Set(float64(fp) / float64(h))
			}
		}
	}()
}
```

### Alerts

The three alerts that catch 95% of incidents:

- `bloom_fill_fraction > 0.7` for 10 min → "filter approaching design capacity, rebuild required."
- `bloom_observed_fpr > 5 * target` for 5 min → "FPR drifting; investigate."
- `rate(bloom_tests_total{result="hit"}[5m]) / rate(bloom_tests_total[5m]) > 0.5` → "filter is no longer eliminating most lookups; cost-benefit broken."

A team running with these three alerts will not be surprised by their Bloom filter.

### Sampling observed FPR

You cannot afford to confirm *every* Test against the slow path — that defeats the filter. Sample 1% of "maybe" answers:

```go
import "math/rand/v2"

func (s *Service) Lookup(id string) (bool, error) {
	maybe := s.f.TestString(id)
	if !maybe {
		atomic.AddInt64(&s.misses, 1)
		return false, nil
	}
	// 1% sample: always confirm regardless of cache outcome, for FPR tracking.
	if rand.IntN(100) == 0 {
		exists, _ := s.db.Exists(id)
		atomic.AddInt64(&s.confirmedSamples, 1)
		if !exists {
			atomic.AddInt64(&s.falsePositiveSamples, 1)
		}
	}
	// Real path:
	exists, err := s.db.Exists(id)
	return exists, err
}
```

`falsePositiveSamples / confirmedSamples` is your observed FPR estimate. With a 1% sample at 10k queries/sec, you get 100 samples/sec — plenty of statistical power to detect drift within minutes.

---

## Sliding-Window Filters

For dedup-with-finite-memory the two-window pattern from junior generalises to N-window:

```go
package window

import (
	"sync"
	"time"

	"github.com/bits-and-blooms/bloom/v3"
)

type WindowFilter struct {
	mu       sync.RWMutex
	windows  []*bloom.BloomFilter
	interval time.Duration
	n        uint
	p        float64
}

func New(n uint, p float64, windows int, interval time.Duration) *WindowFilter {
	wf := &WindowFilter{
		windows:  make([]*bloom.BloomFilter, windows),
		interval: interval,
		n:        n,
		p:        p,
	}
	for i := range wf.windows {
		wf.windows[i] = bloom.NewWithEstimates(n, p)
	}
	go wf.rotateLoop()
	return wf
}

func (wf *WindowFilter) rotateLoop() {
	t := time.NewTicker(wf.interval)
	defer t.Stop()
	for range t.C {
		fresh := bloom.NewWithEstimates(wf.n, wf.p)
		wf.mu.Lock()
		// Shift: drop oldest, insert fresh at index 0.
		copy(wf.windows[1:], wf.windows[:len(wf.windows)-1])
		wf.windows[0] = fresh
		wf.mu.Unlock()
	}
}

func (wf *WindowFilter) Seen(key []byte) bool {
	wf.mu.RLock()
	for _, w := range wf.windows {
		if w.Test(key) {
			wf.mu.RUnlock()
			return true
		}
	}
	wf.mu.RUnlock()
	wf.mu.Lock()
	defer wf.mu.Unlock()
	// Double-check current window after lock upgrade.
	if wf.windows[0].Test(key) {
		return true
	}
	wf.windows[0].Add(key)
	return false
}
```

With `windows = 24` and `interval = time.Hour`, you remember the last 24 hours of keys with hourly granularity. Memory is `24 * sizeof(one filter)`.

### The rotation race

The rotation goroutine takes the write lock briefly. During that window, callers wait. For a 24-window setup that means one ~microsecond hiccup per hour — utterly invisible.

### Why not one filter that you `ClearAll`?

A `ClearAll` at the rotation boundary creates a discontinuity: a key Added at 12:59:59 is forgotten at 13:00:00 sharp. The sliding-window pattern smooths that edge by keeping the previous window(s) available.

---

## Snapshot, Restore, and Hot Reload

A Bloom filter's serialised form is small (just `m` bits plus headers). Persist it to keep the negative cache warm across restarts.

### Snapshot

```go
func snapshot(f *bloom.BloomFilter, path string) error {
	data, err := f.MarshalBinary()
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
```

The `.tmp` + rename pattern guarantees atomicity: a crash mid-write leaves the previous snapshot intact.

### Restore

```go
func restore(path string) (*bloom.BloomFilter, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	f := &bloom.BloomFilter{}
	if err := f.UnmarshalBinary(data); err != nil {
		return nil, err
	}
	return f, nil
}
```

If the file is corrupt, `UnmarshalBinary` returns an error; fall back to a freshly constructed filter and accept the cold-start cost.

### Hot reload

Suppose another process rebuilds the filter (e.g. a nightly batch job) and you want to swap it in without restarting your service.

```go
type HotFilter struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
}

func (hf *HotFilter) Reload(path string) error {
	fresh, err := restore(path)
	if err != nil {
		return err
	}
	hf.mu.Lock()
	hf.f = fresh
	hf.mu.Unlock()
	return nil
}

func (hf *HotFilter) Test(k []byte) bool {
	hf.mu.RLock()
	defer hf.mu.RUnlock()
	return hf.f.Test(k)
}
```

The swap is atomic from a reader's perspective — once the pointer changes, all new RLocks see the new filter; in-flight RLocks finish on the old one.

### Versioning the file format

Prefix your serialised form with a one-byte version tag:

```go
const fileVersion = 2

func snapshotV2(f *bloom.BloomFilter, path string) error {
	data, err := f.MarshalBinary()
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	out := append([]byte{fileVersion}, data...)
	if err := os.WriteFile(tmp, out, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func restoreV2(path string) (*bloom.BloomFilter, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(raw) < 1 {
		return nil, errors.New("empty snapshot")
	}
	switch raw[0] {
	case fileVersion:
		f := &bloom.BloomFilter{}
		err := f.UnmarshalBinary(raw[1:])
		return f, err
	default:
		return nil, fmt.Errorf("unknown snapshot version %d", raw[0])
	}
}
```

Future-you adding a new format will not break old snapshots, and old code reading new snapshots fails loudly rather than silently.

---

## Hash Choice for Concurrent Workloads

The library uses MurmurHash3. Three reasons to consider alternatives:

1. **Speed.** `xxhash` (cespare/xxhash/v2) is ~2x faster on long inputs.
2. **Determinism across processes.** Library Murmur uses a fixed seed, so two processes hash the same. `hash/maphash` uses a per-process random seed — *not* compatible across processes.
3. **Adversarial inputs.** If attackers can choose inputs to collide on bits, you need a *keyed* hash with a private seed: `hash/maphash` (per-process seed) or `siphash` (keyed, designed against hash flooding).

| Hash | Speed (long input) | Deterministic across processes | Keyed/seeded |
| --- | --- | --- | --- |
| MurmurHash3 (library) | ~3 GB/s | Yes (fixed seed) | No |
| xxhash | ~6 GB/s | Yes | Optional |
| `hash/maphash` | ~5 GB/s | No (random per process) | Yes |
| siphash | ~1.5 GB/s | Yes (with chosen key) | Yes |
| SHA-256 | ~0.5 GB/s | Yes | No |

For concurrent use the hash itself is irrelevant to safety — hashes are pure functions and pure functions are always safe. The choice matters for cross-process compatibility and adversarial robustness.

### A keyed-hash custom filter

For an adversarial setting, a roll-your-own based on `maphash` with a private seed:

```go
package keyedbloom

import (
	"hash/maphash"
	"sync/atomic"
)

type Filter struct {
	bits []uint64
	m    uint64
	k    uint64
	seed maphash.Seed
}

func New(m, k uint64, seed maphash.Seed) *Filter {
	return &Filter{
		bits: make([]uint64, (m+63)/64),
		m:    m,
		k:    k,
		seed: seed,
	}
}

func (f *Filter) hashes(key []byte) (uint64, uint64) {
	h := maphash.Bytes(f.seed, key)
	h2 := h>>33 | h<<31
	if h2 == 0 {
		h2 = 1
	}
	return h, h2
}

func (f *Filter) Add(key []byte) {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		pos := (h1 + i*h2) % f.m
		atomic.OrUint64(&f.bits[pos/64], 1<<(pos%64))
	}
}

func (f *Filter) Test(key []byte) bool {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		pos := (h1 + i*h2) % f.m
		if atomic.LoadUint64(&f.bits[pos/64])&(1<<(pos%64)) == 0 {
			return false
		}
	}
	return true
}
```

Each process generates its seed at startup (`maphash.MakeSeed()`), keeping it secret. An attacker cannot precompute colliding keys without knowing the seed.

### When to roll your own at all

The library covers 95% of needs. Roll your own when:

- You need atomic Adds without a mutex (the library is not internally atomic).
- You need a keyed hash for adversarial robustness.
- You need an embeddable filter without external dependencies.
- You need to teach the algorithm.

Otherwise, use the library.

---

## Memory Layout and False Sharing

Two pieces of data placed in the same 64-byte cache line invalidate each other when either is written. For a Bloom filter this matters in two places:

### Place 1: Two filters in one struct

```go
type Service struct {
	usersFilter   *bloom.BloomFilter
	productsFilter *bloom.BloomFilter
}
```

Both pointers fit in 16 bytes; the struct fits in one cache line. *The pointers are not the problem* — the bitsets they point to are far away in memory. The pointers themselves are read-mostly. This layout is fine.

### Place 2: Per-shard mutex

Recall:

```go
type shard struct {
	mu sync.RWMutex
	f  *bloom.BloomFilter
	_  [40]byte
}
```

Without the padding, `f.shards[0].mu` and `f.shards[1].mu` share a cache line. A writer locking shard 0 invalidates the cache copy of shard 1's mutex for every other goroutine — even goroutines that are only *reading* shard 1's mutex must reload it. This shows up as `runtime.lock2` taking ~3x its expected time.

The padding moves each shard's mutex onto its own line. The 40-byte choice was sloppy; a robust formulation:

```go
import "golang.org/x/sys/cpu"

type shard struct {
	_  cpu.CacheLinePad
	mu sync.RWMutex
	f  *bloom.BloomFilter
	_  cpu.CacheLinePad
}
```

`cpu.CacheLinePad` is a platform-aware padding type. Two pads bracket each shard's fields, guaranteeing no neighbour can share the line.

### Place 3: Atomic-bitset adjacent fields

If you embed your atomic bitset in a struct alongside other frequently-written fields, false sharing returns:

```go
type Filter struct {
	count uint64  // <- written on every Add
	bits  []uint64
}
```

`count` and `bits` are next to each other; on each Add you increment `count` AND OR a bit in some `bits[i]`. If `bits[0]` happens to share a cache line with `count`, every Add invalidates `count` across cores. Pad them apart, or move `count` out of the hot struct.

---

## Library Internals That Matter at Middle Level

A few `bits-and-blooms/bloom/v3` internals you should understand.

### `BaseHashes`

The library computes four 64-bit hashes per key (`baseHashes`), then derives the k positions as `(h[0] + i*h[1] + i^2 * h[2] + i^3 * h[3]) mod m`. The quadratic and cubic terms beyond simple double hashing give better independence between positions, particularly for small m where double hashing's correlation becomes visible.

### `BitSet.Count`

Uses `math/bits.OnesCount64` per word. Cost: O(m / 64). For a 100 MB filter, ~100k word reads — a millisecond. Fine for periodic gauges, expensive for per-call use.

### `MarshalBinary`

Serialises `m`, `k`, and the bitset words in little-endian. No version byte; the format has been stable since v3.0.

### `Union`

`f.Union(g)` requires `f.Cap() == g.Cap() && f.K() == g.K()`. Returns a new filter whose bitset is the bitwise OR. Adds in either input become Adds in the output.

### `Intersect`

`f.Intersect(g)` returns the bitwise AND. The resulting filter answers "yes" only when *both* inputs would. Intersection of Bloom filters does *not* give a clean intersection of the underlying sets — there are extra false positives unless both inputs were constructed from the same hash family. Use with care.

### `Add` and `Test` are not lock-protected

The library makes no attempt at concurrency safety. The README explicitly says so. Any concurrent use requires an external wrapper.

---

## Pitfalls You Will Meet

### Pitfall: forgetting `atomic.LoadUint64` on the read side

If you use `atomic.OrUint64` on writes but plain `bits[i] & mask` on reads, the read can return a stale value. Go's memory model guarantees nothing about non-atomic reads of words that other goroutines write atomically. Always pair: atomic write, atomic read.

### Pitfall: sharding by `len(key)` rather than `hash(key)`

```go
return &f.shards[len(key)%numShards] // WRONG
```

This distributes keys by length, not by content. All 16-byte UUIDs land in the same shard. Use a hash.

### Pitfall: `ApproximatedSize()` under heavy live writes

`Count()` reads each word without atomics; concurrent writes can produce a slightly inaccurate count. For a *gauge*, that is fine. For a *condition* (e.g. "rebuild when n >= threshold"), use a separately maintained `atomic.Int64` counter incremented on each Add.

### Pitfall: forgetting to handle `nil` filter during reload

```go
if hf.f == nil {
	return false
}
return hf.f.Test(k)
```

A nil filter (e.g. after a failed restore) must produce a sane answer — "false" is conventional. Better: never let `hf.f` be nil; assign a fresh empty filter on construction.

### Pitfall: per-shard sizing for total `n`

Each shard should be sized for `n / numShards`, not for the full `n`. Sizing each shard for the full `n` wastes 16x memory in a 16-shard setup.

### Pitfall: rebuilding under load

A naive "drain all Tests, rebuild" forces a pause. Always:

1. Build the new filter in the background.
2. Atomically swap the pointer.
3. Garbage-collect the old filter.

Never lock-and-rebuild in place.

### Pitfall: trusting `ApproximatedSize` at high fill

At >70% fill, the estimator's variance balloons. Use fill fraction (`Count() / Cap()`) instead for "should I rebuild" decisions.

### Pitfall: counter under-decrement in CBF

If your code calls `Delete(key)` for a key that was never Added, you decrement counters that other keys are relying on. Result: false negatives. Always pair Delete with a prior Test or maintain authoritative bookkeeping outside the filter.

---

## Production Checklist

- [ ] Workload classified: read-heavy / write-heavy / mixed.
- [ ] Wrapper chosen: Mutex, RWMutex, atomic, or sharded — based on classification.
- [ ] `go test -race` runs on a representative concurrent test.
- [ ] Padding applied to shard structs (`cpu.CacheLinePad`).
- [ ] Prometheus metrics for capacity, fill, observed FPR, hits/misses.
- [ ] Alerts on fill > 0.7 and FPR > 5x target.
- [ ] Sampled-confirmation path implemented for observed-FPR measurement.
- [ ] Snapshot/restore tested with corruption injection.
- [ ] Hot reload swap is atomic from readers' perspective.
- [ ] Rebuild path documented and tested.
- [ ] Cache-aside ordering enforced (truth before filter on writes).
- [ ] Filter never written before the source of truth on registration.
- [ ] CBF (if used) handles saturation with the no-decrement rule.

A team running this checklist will not have Bloom-filter incidents above the noise floor.

---

## Self-Assessment

- [ ] I can implement a lock-free Bloom filter using `sync/atomic`.
- [ ] I can explain why `atomic.OrUint64` eliminates the lost-bit race.
- [ ] I can write a sharded Bloom filter with proper cache-line padding.
- [ ] I can implement a 4-bit counting Bloom filter with saturation handling.
- [ ] I can expose a Bloom filter as four useful Prometheus metrics.
- [ ] I can implement a sliding-window filter with atomic rotation.
- [ ] I can snapshot and restore a filter with versioned serialisation.
- [ ] I can pick between MurmurHash3, xxhash, and `hash/maphash` for a given use case.
- [ ] I can identify and fix false sharing in a sharded filter benchmark.
- [ ] I can recite the cache-aside ordering rule from memory.

---

## Summary

The basic library plus a `sync.RWMutex` ships your first concurrent Bloom filter. From there, the middle-level toolkit gives you four upgrades:

- **Atomic bitsets** for lock-free Add/Test.
- **Sharded filters** for write-heavy contention reduction.
- **Counting variants** when you need Delete.
- **Observability** so you know when the filter is failing you.

Each tool is independent of the others; you mix as needed. Workload shape (read/write ratio, ops/sec, core count, latency sensitivity) drives the choice. Production hygiene — alerts, snapshots, hot reload, rebuild paths — is non-negotiable.

Senior.md takes the next architectural step: partitioned Bloom filters, scalable Bloom filters, Cuckoo filters, and integrating filters with the larger storage stack. Once you have shipped one middle-level filter into production, you are ready.

---

## Further Reading

- Fan, L., Cao, P., Almeida, J., & Broder, A. (2000). *Summary Cache: A Scalable Wide-Area Web Cache Sharing Protocol.* The original Counting Bloom Filter paper.
- Mitzenmacher, M., & Upfal, E. *Probability and Computing*, sections on Bloom filters and Cuckoo hashing.
- Bonomi, F., Mitzenmacher, M., Panigrahy, R., Singh, S., & Varghese, G. (2006). *An Improved Construction for Counting Bloom Filters.* d-left counting filters.
- `bits-and-blooms/bloom/v3` source.
- `cespare/xxhash/v2` README and benchmarks.
- Go memory model: `https://go.dev/ref/mem`.
- `sync/atomic` package documentation.
- Brendan Gregg's blog on false sharing.
- *Designing Data-Intensive Applications*, chapter 3.

---

## Diagrams & Visual Aids

### A single atomic OR on a contended word

```
Two goroutines want to set bit 3 and bit 5 of word0.

Time | A                            | B                            | word0
-----|------------------------------|------------------------------|-----------
 t1  | atomic.OrUint64(&w, 1<<3)    |                              | 0x00 -> 0x08
 t2  |                              | atomic.OrUint64(&w, 1<<5)    | 0x08 -> 0x28

Final word0 = 0x28. Both bits set. No race.
```

Each `OrUint64` is one indivisible hardware operation. The cache line bounces between cores, but neither bit is lost.

### Sharded filter routing

```
key "alice" -- hash --> 0xA9F3 -- mod 32 --> shard 19
                                              |
                                              v
                                         ┌─────────┐
                                         │ shard19 │ -- own mutex, own bitset
                                         └─────────┘

key "bob"   -- hash --> 0xB6C2 -- mod 32 --> shard 2
                                              |
                                              v
                                         ┌─────────┐
                                         │ shard02 │ -- own mutex, own bitset
                                         └─────────┘
```

Different keys typically route to different shards; concurrent Adds rarely contend.

### Counting Bloom filter cell layout

```
counters[]:  byte 0      byte 1      byte 2      byte 3
             ┌──┬──┐    ┌──┬──┐    ┌──┬──┐    ┌──┬──┐
             │c0│c1│    │c2│c3│    │c4│c5│    │c6│c7│
             └──┴──┘    └──┴──┘    └──┴──┘    └──┴──┘
              4b 4b      4b 4b      4b 4b      4b 4b

8 counters in 4 bytes. Total memory: m/2 bytes (vs m/8 for a basic filter — 4x).
```

### Sliding-window filter rotation

```
Time  | windows[0] | windows[1] | windows[2] | windows[3] |
------|------------|------------|------------|------------|
 t=0  | fresh      | fresh      | fresh      | fresh      |
 t=1h | fresh      | hour0      | fresh      | fresh      |
 t=2h | fresh      | hour1      | hour0      | fresh      |
 t=3h | fresh      | hour2      | hour1      | hour0      |
 t=4h | fresh      | hour3      | hour2      | hour1      |  hour0 dropped
```

Each tick: shift down, drop oldest, install fresh at index 0. The Seen check ORs over all windows.

### Mutex profile of an under-contended RWMutex

```
60%  bloom.(*BloomFilter).Add
20%  sync.(*RWMutex).Lock
10%  sync.(*RWMutex).Unlock
 5%  runtime.gopark
 5%  other
```

The 30% in Lock+Unlock means you are losing throughput to lock acquisition. Move to atomic or sharded.

### Cache-line layout: padded shards

```
cache line 0:  [pad ][ shard0 (mu, f) ][pad ]
cache line 1:  [pad ][ shard1 (mu, f) ][pad ]
cache line 2:  [pad ][ shard2 (mu, f) ][pad ]
...
```

Each shard occupies its own cache line. Writes to shard 0's mutex do not invalidate shard 1.

### Observed-FPR sampling flow

```
Test(k) -- mayExist? --no-->  return false
                       -yes-> 
                              99%  --> use cache decision (no DB sample)
                               1%  --> sample: confirm via DB
                                       confirmed real? -> increment hits
                                       confirmed not?  -> increment hits AND fpHits
```

`observedFPR = fpHits / hits` over the sampled subset, refreshed every 15s.

---

## Deep Dive: Building a Production-Ready Atomic Bloom Filter

The 80-line atomic Bloom filter earlier in this file is correct but minimal. A production-quality one adds:

- Marshal and Unmarshal.
- An Add that returns "was already maybe present" (atomic TestAndAdd analogue).
- A safe ApproximatedSize that does not require quiescence.
- A ClearAll that is atomic.
- An optional Hasher injection so callers can swap MurmurHash3 for xxhash, maphash, or siphash.

```go
package atomicbloom

import (
	"encoding/binary"
	"errors"
	"io"
	"math"
	"math/bits"
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
)

type Hasher func(key []byte) (uint64, uint64)

func defaultHasher(key []byte) (uint64, uint64) {
	x := xxhash.Sum64(key)
	h2 := x>>33 | x<<31
	if h2 == 0 {
		h2 = 1
	}
	return x, h2
}

type Filter struct {
	bits   []uint64
	m      uint64
	k      uint64
	hasher Hasher
}

func New(m, k uint64) *Filter {
	return NewWithHasher(m, k, defaultHasher)
}

func NewWithHasher(m, k uint64, h Hasher) *Filter {
	if m == 0 || k == 0 {
		panic("m and k must be positive")
	}
	return &Filter{
		bits:   make([]uint64, (m+63)/64),
		m:      m,
		k:      k,
		hasher: h,
	}
}

func NewWithEstimates(n uint64, p float64) *Filter {
	m, k := EstimateParameters(n, p)
	return New(m, k)
}

func EstimateParameters(n uint64, p float64) (m, k uint64) {
	m = uint64(math.Ceil(-float64(n) * math.Log(p) / (math.Ln2 * math.Ln2)))
	k = uint64(math.Round(float64(m) / float64(n) * math.Ln2))
	if k < 1 {
		k = 1
	}
	return
}

func (f *Filter) positions(h1, h2 uint64) func(int) uint64 {
	return func(i int) uint64 {
		return (h1 + uint64(i)*h2) % f.m
	}
}

func (f *Filter) Add(key []byte) {
	h1, h2 := f.hasher(key)
	pos := f.positions(h1, h2)
	for i := uint64(0); i < f.k; i++ {
		p := pos(int(i))
		atomic.OrUint64(&f.bits[p/64], 1<<(p%64))
	}
}

func (f *Filter) Test(key []byte) bool {
	h1, h2 := f.hasher(key)
	pos := f.positions(h1, h2)
	for i := uint64(0); i < f.k; i++ {
		p := pos(int(i))
		if atomic.LoadUint64(&f.bits[p/64])&(1<<(p%64)) == 0 {
			return false
		}
	}
	return true
}

// TestAndAdd reports whether the key was already (probably) present and then
// unconditionally adds it. Per-bit atomic, but the *combined* test+set is not
// linearisable; callers must reason about the relaxed semantics.
func (f *Filter) TestAndAdd(key []byte) bool {
	h1, h2 := f.hasher(key)
	pos := f.positions(h1, h2)
	allSet := true
	for i := uint64(0); i < f.k; i++ {
		p := pos(int(i))
		mask := uint64(1) << (p % 64)
		old := atomic.LoadUint64(&f.bits[p/64])
		if old&mask == 0 {
			allSet = false
		}
		atomic.OrUint64(&f.bits[p/64], mask)
	}
	return allSet
}

func (f *Filter) ClearAll() {
	for i := range f.bits {
		atomic.StoreUint64(&f.bits[i], 0)
	}
}

// ApproximatedSize uses the Swamidass-Baldi estimator. Safe to call concurrently;
// returns an estimate based on the current snapshot of bits.
func (f *Filter) ApproximatedSize() uint64 {
	set := uint64(0)
	for i := range f.bits {
		set += uint64(bits.OnesCount64(atomic.LoadUint64(&f.bits[i])))
	}
	if set == 0 {
		return 0
	}
	if set == f.m {
		return math.MaxUint64
	}
	return uint64(-float64(f.m) / float64(f.k) * math.Log(1.0-float64(set)/float64(f.m)))
}

func (f *Filter) FillFraction() float64 {
	set := uint64(0)
	for i := range f.bits {
		set += uint64(bits.OnesCount64(atomic.LoadUint64(&f.bits[i])))
	}
	return float64(set) / float64(f.m)
}

// WriteTo serialises a snapshot of the filter. Safe under concurrent writes;
// the snapshot is consistent at the word level (no torn words) but may include
// or exclude in-flight Adds.
func (f *Filter) WriteTo(w io.Writer) (int64, error) {
	var header [16]byte
	binary.LittleEndian.PutUint64(header[0:8], f.m)
	binary.LittleEndian.PutUint64(header[8:16], f.k)
	n, err := w.Write(header[:])
	written := int64(n)
	if err != nil {
		return written, err
	}
	buf := make([]byte, 8)
	for i := range f.bits {
		binary.LittleEndian.PutUint64(buf, atomic.LoadUint64(&f.bits[i]))
		n, err = w.Write(buf)
		written += int64(n)
		if err != nil {
			return written, err
		}
	}
	return written, nil
}

func ReadFrom(r io.Reader) (*Filter, int64, error) {
	var header [16]byte
	n, err := io.ReadFull(r, header[:])
	read := int64(n)
	if err != nil {
		return nil, read, err
	}
	m := binary.LittleEndian.Uint64(header[0:8])
	k := binary.LittleEndian.Uint64(header[8:16])
	if m == 0 || k == 0 {
		return nil, read, errors.New("invalid filter header")
	}
	f := New(m, k)
	buf := make([]byte, 8)
	for i := range f.bits {
		n, err = io.ReadFull(r, buf)
		read += int64(n)
		if err != nil {
			return nil, read, err
		}
		f.bits[i] = binary.LittleEndian.Uint64(buf)
	}
	return f, read, nil
}
```

This filter is suitable for shipping. A few notes:

- **`TestAndAdd` is "best effort."** It reads then ORs each word non-atomically as a pair. Two goroutines calling `TestAndAdd` on the same new key may both observe `false` and both believe they were the inserter. For Bloom-filter semantics this is fine (idempotent Adds), but if you need true "first to insert wins," wrap in a Mutex or use a `sync.Map` keyed by hash for the deduplication of inserters.
- **`ApproximatedSize` allocates nothing per call** and is safe under concurrent writes. The accuracy degrades at high fill, but the *call itself* is safe.
- **`WriteTo` produces a coherent snapshot at word granularity.** A reader of the resulting bytes gets a filter that contains at least the writes that "happened-before" the call and at most the writes "happens-before" the call's last word read.

---

## Deep Dive: Sharded Atomic — Belt and Braces

Combine sharding with atomic bitsets for maximum throughput:

```go
package shardedatomic

import (
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
	"golang.org/x/sys/cpu"
)

const numShards = 32

type shard struct {
	_    cpu.CacheLinePad
	bits []uint64
	_    cpu.CacheLinePad
}

type Filter struct {
	shards [numShards]shard
	m      uint64 // m per shard
	k      uint64
}

func New(totalM, k uint64) *Filter {
	mPerShard := totalM / numShards
	if mPerShard == 0 {
		mPerShard = 1
	}
	f := &Filter{m: mPerShard, k: k}
	for i := range f.shards {
		f.shards[i].bits = make([]uint64, (mPerShard+63)/64)
	}
	return f
}

func (f *Filter) shardAndHash(key []byte) (int, uint64, uint64) {
	x := xxhash.Sum64(key)
	shardIdx := int(x % numShards)
	h1 := x >> 5
	h2 := h1>>33 | h1<<31
	if h2 == 0 {
		h2 = 1
	}
	return shardIdx, h1, h2
}

func (f *Filter) Add(key []byte) {
	si, h1, h2 := f.shardAndHash(key)
	s := &f.shards[si]
	for i := uint64(0); i < f.k; i++ {
		p := (h1 + i*h2) % f.m
		atomic.OrUint64(&s.bits[p/64], 1<<(p%64))
	}
}

func (f *Filter) Test(key []byte) bool {
	si, h1, h2 := f.shardAndHash(key)
	s := &f.shards[si]
	for i := uint64(0); i < f.k; i++ {
		p := (h1 + i*h2) % f.m
		if atomic.LoadUint64(&s.bits[p/64])&(1<<(p%64)) == 0 {
			return false
		}
	}
	return true
}
```

Each shard is independent: its bitset, its writes, its cache lines. There is no global mutex, no shared lock-free counter. Two goroutines adding two different keys *almost always* land in different shards, so they never even touch the same cache lines.

The shard index comes from the top bits of the hash; the remaining bits drive the within-shard positions. Using *different* bits for the two purposes preserves independence between shard selection and position selection — otherwise keys that share a shard would also tend to cluster on the same positions.

### Throughput comparison

A rough benchmark on an 8-core machine, 8M-bit total filter, k = 7, 8 concurrent goroutines doing Adds:

| Variant | Ops/sec |
| --- | --- |
| `sync.Mutex`-wrapped library | 1.2M |
| `sync.RWMutex`-wrapped library | 1.4M |
| Atomic flat filter | 7.5M |
| Sharded (32) with RWMutex | 9.0M |
| Sharded (32) atomic | 14.0M |

Your numbers will differ. The shape is what matters: atomic and sharded each give a multiplicative speedup; combined they give close to a linear-in-cores speedup.

---

## Deep Dive: A Counting Bloom Filter With Concurrent Counters

The 4-bit CBF earlier serialised on a Mutex. Here is a 32-bit counter version using `atomic.Int32`:

```go
package countingatomic

import (
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
)

type Filter struct {
	counters []int32
	m        uint64
	k        uint64
}

func New(m, k uint64) *Filter {
	return &Filter{
		counters: make([]int32, m),
		m:        m,
		k:        k,
	}
}

func (f *Filter) hashes(key []byte) (uint64, uint64) {
	x := xxhash.Sum64(key)
	h2 := x>>33 | x<<31
	if h2 == 0 {
		h2 = 1
	}
	return x, h2
}

func (f *Filter) Add(key []byte) {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		p := (h1 + i*h2) % f.m
		atomic.AddInt32(&f.counters[p], 1)
	}
}

func (f *Filter) Delete(key []byte) {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		p := (h1 + i*h2) % f.m
		// CAS loop to avoid going negative.
		for {
			cur := atomic.LoadInt32(&f.counters[p])
			if cur <= 0 {
				break
			}
			if atomic.CompareAndSwapInt32(&f.counters[p], cur, cur-1) {
				break
			}
		}
	}
}

func (f *Filter) Test(key []byte) bool {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		p := (h1 + i*h2) % f.m
		if atomic.LoadInt32(&f.counters[p]) <= 0 {
			return false
		}
	}
	return true
}
```

Trade-offs:

- **Memory: 4 bytes per counter vs 1 bit per counter.** 32x the memory of the basic Bloom filter. For a filter sized for 1M items at 1% FPR (10M bits), that is 40 MB for the counting variant vs 1.25 MB for the basic. Counting Bloom filters are not memory-cheap.
- **Throughput: high.** All operations are `atomic.AddInt32` or `CompareAndSwapInt32`, no locks.
- **Saturation: not implemented in this version.** A pathological adversary could overflow `int32` (~2 billion increments). For real workloads this is impossible.

For most production CBF use cases, this is the right design: trade memory for concurrency.

### A 4-bit packed atomic CBF

If memory matters, you can still do 4-bit counters with atomic operations, but the bookkeeping is delicate:

```go
func (f *PackedCBF) inc(idx uint64) {
	wordIdx := idx / 16 // 16 4-bit counters per uint64
	shift := uint((idx % 16) * 4)
	mask := uint64(0xF) << shift
	for {
		cur := atomic.LoadUint64(&f.words[wordIdx])
		val := (cur & mask) >> shift
		if val == 15 {
			return // saturated, no-op
		}
		next := (cur &^ mask) | ((val + 1) << shift)
		if atomic.CompareAndSwapUint64(&f.words[wordIdx], cur, next) {
			return
		}
	}
}
```

Compare-and-swap on the whole 64-bit word; 16 counters per word, 4 bits each. Increment retries on contention. Under heavy contention this can spin; in practice, contention on individual counters is rare for properly-sized filters.

This is the design used inside some database-internal CBFs. Worth knowing exists; not worth implementing unless you have a strong reason.

---

## Deep Dive: Observability Beyond Metrics

Metrics are necessary but not sufficient. Three more practices distinguish a middle-level operator from a junior one.

### Structured logging at the filter boundary

```go
func (s *Service) Lookup(ctx context.Context, id string) (User, bool, error) {
	mayExist := s.filter.TestString(id)
	logger := log.With("op", "lookup", "user_id", id, "filter", mayExist)
	if !mayExist {
		logger.Debug("filter_miss")
		return User{}, false, nil
	}
	u, err := s.db.GetUser(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		logger.Info("filter_false_positive")
		return User{}, false, nil
	}
	if err != nil {
		logger.Error("db_error", "err", err)
		return User{}, false, err
	}
	logger.Debug("filter_true_positive")
	return u, true, nil
}
```

Three log lines per code path; you can recover the rolling FPR from logs alone if metrics fail. Disable `Debug` in production but keep `Info` for false-positive samples (with sampling if volume is high).

### Distributed tracing

Span attributes:

```go
ctx, span := tracer.Start(ctx, "Lookup")
defer span.End()
span.SetAttributes(
	attribute.String("user_id", id),
	attribute.Bool("filter.may_exist", mayExist),
	attribute.Int("filter.capacity", int(s.filter.Cap())),
)
```

When you trace through the call stack, you see exactly which Lookups went through the filter and which were short-circuited. Correlating with latency histograms tells you the actual cost saved by the filter.

### Periodic fill-vs-FPR ratio check

A drift check that runs every 5 minutes and logs a warning if the observed FPR is more than 2x the theoretical expectation at the current fill:

```go
func driftCheck(f *bloom.BloomFilter, observed float64) {
	bitCount := f.BitSet().Count()
	fill := float64(bitCount) / float64(f.Cap())
	expected := math.Pow(fill, float64(f.K()))
	if observed > 2*expected && observed > 0.005 {
		log.Warn("filter_fpr_drift",
			"observed", observed,
			"expected", expected,
			"fill", fill,
		)
	}
}
```

Drift can indicate hash-quality problems, adversarial inputs, or a misconfigured hash family. The check costs nothing and catches a class of subtle bugs.

---

## Deep Dive: Hot Reload Under Live Traffic

A real-world hot-reload routine:

```go
package hotreload

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"time"

	"github.com/bits-and-blooms/bloom/v3"
)

type HotFilter struct {
	current atomic.Pointer[bloom.BloomFilter]
}

func New(initial *bloom.BloomFilter) *HotFilter {
	hf := &HotFilter{}
	hf.current.Store(initial)
	return hf
}

func (hf *HotFilter) Test(k []byte) bool {
	return hf.current.Load().Test(k)
}

func (hf *HotFilter) Add(k []byte) {
	// Caller is responsible for serialising writes to the active filter.
	hf.current.Load().Add(k)
}

func (hf *HotFilter) Reload(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	fresh := &bloom.BloomFilter{}
	if err := fresh.UnmarshalBinary(data); err != nil {
		return err
	}
	hf.current.Store(fresh)
	return nil
}

func (hf *HotFilter) StartWatch(ctx context.Context, path string, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		var lastMod time.Time
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				st, err := os.Stat(path)
				if err != nil {
					continue
				}
				if !st.ModTime().After(lastMod) {
					continue
				}
				if err := hf.Reload(path); err == nil {
					lastMod = st.ModTime()
				}
			}
		}
	}()
}
```

`atomic.Pointer[bloom.BloomFilter]` (Go 1.19+) gives a lock-free pointer swap. Tests do a single atomic Load; reload does a single atomic Store. No locks, no readers blocked.

Note that *Adds* now need their own synchronisation if you want them concurrent — the underlying `BloomFilter` is not safe. If you only use HotFilter as a read-mostly negative cache that is reloaded externally (e.g. via batch job), no internal write lock is needed.

### File-system watching

For sub-second reload, replace `time.Ticker` polling with `fsnotify` watches. The cost is one extra dependency; the benefit is reload-on-write.

---

## Deep Dive: Choosing N for a Sharded Filter

How many shards is right?

Too few → contention. Too many → memory overhead and cache thrashing.

Empirical guide:

| Cores | numShards | Why |
| --- | --- | --- |
| 1–4 | 16 | Even on small machines, 16 shards keeps the math clean and gives headroom. |
| 4–16 | 32 | Standard middle-of-road choice; widely used. |
| 16–64 | 64 | One shard per core; near-optimal under fully concurrent load. |
| > 64 | 128 | Diminishing returns; consider per-NUMA-node shards instead. |

The shards count should usually be a power of two so `hash % numShards` becomes a cheap bitmask. Confirm with `numShards & (numShards-1) == 0`.

### Auto-scaling shard count?

Don't. Resharding a Bloom filter is expensive — you must rehash every key, and you do not have the keys. Pick a shard count at startup based on `runtime.NumCPU()` and live with it.

---

## Deep Dive: When Lockless Goes Wrong

Lock-free designs are not always faster. Two failure modes:

### Mode 1: heavy contention on hot bits

Imagine a Bloom filter that all goroutines hit with the same key over and over (e.g. a hot key in a load test). The same words get atomic-OR'd repeatedly. On x86 the cache line bounces between cores; on ARM the LL/SC pair retries. In extreme cases this is slower than a single global mutex.

Mitigation: detect the hot key earlier in the call chain (e.g. an in-memory cache on the *result*, before the filter), so the filter sees a more diverse workload.

### Mode 2: stale reads under high churn

A goroutine calls `atomic.LoadUint64` and reads a stale-but-not-old value because the cache line was just invalidated. The atomic guarantees the read is *coherent* (no half-updated word) but not *fresh* (the load may execute before another core's write). For Bloom filters this is fine: a Test that misses a freshly added bit will be re-asserted as a false negative *only if* the visibility gap exceeds the Test latency, which is exceedingly rare. But under pathological load, p99 false-negative observation can spike.

In practice this never matters. We mention it because it confuses people: "Doesn't atomic mean instantaneous?" No — atomic means indivisible. Visibility is governed by the memory model, not by the atomicity of the operation.

---

## Deep Dive: When *Not* to Reach for Atomic

The atomic Bloom filter is great but has a cost: every Test does k atomic loads, each emitting a memory fence on weakly-ordered architectures (ARM, RISC-V). On x86 the fence is implicit, but the compiler still cannot reorder code around it.

Under read-heavy workloads with low contention, an RWMutex wrapper around the library's standard `BloomFilter` can outperform the atomic variant because:

- The RWMutex's RLock is a single atomic increment.
- Inside the RLock, the library's `Test` does plain (non-atomic) reads on the bitset, which compile to cheap MOVs.
- The total cost is one mutex op + k plain reads, vs k atomic reads.

For high read-to-write ratios, benchmark both. Pick the winner.

---

## Real-World Patterns Recap

### Pattern: Two-Level Cache With Atomic Bloom

```
Request -> in-memory LRU (1 mutex) -> atomic Bloom -> Redis (network) -> Postgres (disk)
```

LRU handles hot keys. Atomic Bloom handles "definitely not in Postgres." Redis catches the warm-but-not-hot. Postgres handles the rest.

### Pattern: Per-Tenant Filter With Lazy Construction

```go
type MultiTenant struct {
	filters sync.Map // tenantID -> *bloom.BloomFilter
}

func (mt *MultiTenant) For(tenant string) *bloom.BloomFilter {
	if v, ok := mt.filters.Load(tenant); ok {
		return v.(*bloom.BloomFilter)
	}
	fresh := bloom.NewWithEstimates(100_000, 0.01)
	actual, _ := mt.filters.LoadOrStore(tenant, fresh)
	return actual.(*bloom.BloomFilter)
}
```

`sync.Map.LoadOrStore` deduplicates the creation race: two concurrent callers both ask for tenant "X"; only one filter is kept; the other is GC'd. Then each tenant filter is wrapped in its own synchronisation (omitted) for actual Add/Test.

### Pattern: Eventually-Consistent Filter Across Replicas

If you operate multiple replicas of a service, each can maintain its own filter. To converge, periodically Union-merge filters across replicas:

```go
func (svc *Service) MergeFromPeer(peerFilter *bloom.BloomFilter) error {
	return svc.filter.Merge(peerFilter)
}
```

Send the filter bytes over RPC; receive and `UnmarshalBinary`; call `Merge`. The Union is the union of the sets each replica thinks it has, with no false negatives (since neither side had any).

This is exactly what some BitTorrent and gossip protocols do to deduplicate seen messages across peers.

---

## A Note on Memory Allocation Pressure

The library's `BloomFilter` allocates a `[]uint64` on construction. After that, all operations are allocation-free *if* you Add/Test `[]byte` and skip the `*String` variants. The `*String` variants do `[]byte(s)` internally on Go versions prior to 1.20 (which avoids a copy via compiler optimisation). Either way, do not allocate in your call sites:

```go
// Good:
f.Test(keyBytes)

// Slightly worse (allocation on old Go):
f.TestString(keyString)

// Bad (always allocates):
f.Test([]byte(fmt.Sprintf("user-%d", id)))
```

For high-throughput call sites, pre-allocate the key buffer once and reuse:

```go
var buf [32]byte
key := strconv.AppendInt(buf[:0], int64(id), 10)
f.Test(key)
```

`strconv.AppendInt` writes into the provided buffer; no heap allocation. Profile your hot path with `b.ReportAllocs()` to spot accidental allocations.

---

## A Note on GC Interaction

A 100 MB Bloom filter is a 100 MB live byte slice. The Go GC scans live memory; a large filter increases GC scan time.

Two mitigations:

### Mitigation 1: Pin the filter outside the heap

Use `mmap` with `MAP_ANONYMOUS` to allocate the bitset in untracked memory:

```go
import "golang.org/x/sys/unix"

func mmapBytes(n int) ([]byte, error) {
	return unix.Mmap(-1, 0, n, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_ANON|unix.MAP_PRIVATE)
}
```

Wrap the bytes in a slice header without registering it with the GC. The GC no longer scans the bitset; allocations elsewhere are not penalised.

This is overkill for most services. Use only if pprof identifies the Bloom filter's bitset as a GC scan-time bottleneck.

### Mitigation 2: Set `GOGC` appropriately

A large heap with low allocation rate runs into the GC less often if `GOGC` is high. For a service that is mostly filter and a little request handling, `GOGC=200` or `GOGC=400` reduces GC frequency at the cost of slightly higher memory ceiling.

Measure first.

---

## A Word on `sync.Pool`

You may be tempted to pool intermediate buffers in hot Bloom-filter paths. Don't. The hot path inside `Add`/`Test` does not allocate, and `sync.Pool` introduces its own concurrent overhead. Pool only when the profile says you must.

The one place pooling helps is your *call site*: if you do `fmt.Sprintf("k%d", id)` to build keys, pooling the `bytes.Buffer` removes the allocation. But there is a simpler fix — `strconv.AppendInt` as above — that has no overhead at all.

---

## Quick Decision Tree

```
Q: do you need delete?
   yes -> use a Counting Bloom Filter (CBF). Pick atomic Int32 counters
          unless memory is tight, in which case use packed 4-bit with CAS.
   no  -> continue.

Q: is throughput dominated by writes (>10% writes)?
   yes -> use atomic bitset, optionally sharded.
   no  -> continue.

Q: how many concurrent readers?
   < 4  -> RWMutex-wrapped library filter is fine.
   4-64 -> RWMutex-wrapped library filter is fine; benchmark atomic for comparison.
   > 64 -> atomic bitset (no mutex) wins.

Q: do you need to grow without re-sizing?
   yes -> use a Scalable Bloom Filter (senior.md).
   no  -> continue.

Q: do you need adversarial robustness?
   yes -> use a keyed hash (maphash, siphash) with a private seed.
   no  -> use library default (Murmur3) or xxhash.
```

Most middle-level services land at "atomic flat filter with library hashing." That choice is correct surprisingly often.

---

## Worked Example: Rebuilding a Saturated Filter Without Downtime

Suppose your filter is sized for 10M and you have 25M live items. The FPR is up. You need to rebuild for 50M (current 25M + 100% headroom) without taking a downtime window.

```go
func (s *Service) RebuildFilter(ctx context.Context, newN uint, newP float64) error {
	fresh := bloom.NewWithEstimates(newN, newP)
	// Stream IDs from the source of truth.
	ids, err := s.store.AllUserIDs(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		fresh.AddString(id)
	}
	s.mu.Lock()
	s.filter = fresh
	s.mu.Unlock()
	return nil
}
```

While the rebuild runs:

- Reads still use the old filter; queries continue to work (with elevated FPR).
- New `Register` calls update the *old* filter; those entries are missing from `fresh` when it loads.

To catch the gap, switch to a "double-write" mode during rebuild:

```go
func (s *Service) Register(ctx context.Context, u User) error {
	if err := s.store.Insert(ctx, u); err != nil {
		return err
	}
	s.mu.Lock()
	s.filter.AddString(u.ID)
	if s.rebuildInProgress != nil {
		s.rebuildInProgress.AddString(u.ID)
	}
	s.mu.Unlock()
	return nil
}
```

Set `s.rebuildInProgress = fresh` before starting the background rebuild; clear after the swap. Every Register touches both filters during the rebuild window. No keys are lost.

This is the canonical "shadow write" pattern from any cache rebuild; Bloom filters are no exception.

---

## Worked Example: Reading the Mutex Profile

Run a synthetic test under contention:

```
go test -mutexprofile=mu.out -bench=BenchmarkRWMutexAdd -benchtime=10s
go tool pprof -top mu.out
```

Output like:

```
Showing nodes accounting for 8.5s, 95.2% of 8.9s total
      flat  flat%   sum%        cum   cum%
     5.2s   58.4%  58.4%      5.2s  58.4%  sync.(*RWMutex).Lock
     2.1s   23.6%  82.0%      2.1s  23.6%  sync.(*RWMutex).Unlock
     1.2s   13.5%  95.5%      1.2s  13.5%  runtime.gopark
```

82% of mutex time in Lock/Unlock means the RWMutex is your bottleneck. Switch to atomic; rerun:

```
Showing nodes accounting for 0.05s, 90% of 0.06s total
      flat  flat%   sum%        cum   cum%
     0.03s  50.0%  50.0%      0.03s  50.0%  runtime.gopark
     0.02s  33.3%  83.3%      0.02s  33.3%  runtime.casgstatus
```

Mutex time near zero. Throughput per CPU should rise correspondingly.

---

## Final Thought for the Middle Level

Bloom filters at middle level are about the *system around* the filter as much as the filter itself. The library is small. The decisions are not: sync strategy, sharding, counting variants, observability, snapshot, rotation, rebuild. Each decision changes the operational profile in production.

A senior or staff engineer is one who can sit in a code review and ask, in the right order:

- Why this synchronisation strategy?
- Why this sharding decision?
- How does this rebuild?
- How is FPR measured?
- What is the alert threshold?

If your PR answers those five questions in advance, you are at middle level. If you are asking them of others' PRs, you are nearly senior. Senior.md picks up where this leaves off: the *architecture* of filters across systems, not just within one service.

---

## Appendix: Race Detector Recipes

The race detector is your single most powerful tool when working with concurrent Bloom filters. A few recipes.

### Recipe 1: race-on-Add detection

```go
func TestAddRace(t *testing.T) {
	f := bloom.NewWithEstimates(100_000, 0.01) // intentionally NOT wrapped
	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				f.AddString(fmt.Sprintf("g%d-i%d", g, i))
			}
		}(g)
	}
	wg.Wait()
}
```

Run with `go test -race`. The detector should report a data race on the bitset.

### Recipe 2: race-on-rebuild detection

```go
func TestRebuildRace(t *testing.T) {
	var f atomic.Pointer[bloom.BloomFilter]
	f.Store(bloom.NewWithEstimates(10_000, 0.01))
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			f.Load().TestString(fmt.Sprintf("k%d", i))
		}
	}()
	for i := 0; i < 10; i++ {
		fresh := bloom.NewWithEstimates(10_000, 0.01)
		f.Store(fresh)
		time.Sleep(time.Millisecond)
	}
	wg.Wait()
}
```

This should *not* race: `atomic.Pointer` provides the safe swap. If the detector complains, your atomic was wrong.

### Recipe 3: integration test with race in CI

In `Makefile` or CI script:

```
test: ## run all tests with race detector
	go test -race -timeout 60s ./...
```

Add `-race` to your CI pipeline permanently. The runtime cost is significant (~5–10x), but only for tests, not production.

### Recipe 4: long-soak race detection

For subtle races that need many iterations to manifest:

```
go test -race -count=100 -timeout=30m -run TestConcurrentFilter
```

The `-count=100` runs the test 100 times in one process; races accumulate evidence. Useful when a flake "only happens in CI."

---

## Appendix: A Cheat Sheet for Mutex Choice

Memorise these.

| Goal | Recipe |
| --- | --- |
| Simplest concurrent filter | `sync.RWMutex` + `*bloom.BloomFilter`. |
| Higher Add throughput | Atomic bitset. |
| Highest Add throughput | Sharded atomic. |
| Need Delete | Counting Bloom filter (atomic Int32 counters). |
| Read-mostly with hot reload | `atomic.Pointer[bloom.BloomFilter]`. |
| Across services | Marshal/Unmarshal with `bits-and-blooms/bloom/v3` and Union. |

---

## Appendix: Concurrent Bloom Filter Libraries in Go

Survey of what is available beyond `bits-and-blooms/bloom/v3`.

### `github.com/devopsfaith/bloomfilter`

Designed for distributed use, includes Redis-backed variants. Slower per-op than in-memory but enables cross-node sharing. Good for short TTL filters in front of shared infrastructure.

### `github.com/holdno/bloom`

Atomic-bitset implementation. Lock-free by construction. Smaller surface area than bits-and-blooms; production-tested.

### `github.com/tylertreat/BoomFilters`

A *family* of filters: standard, counting, stable, scalable, partitioned, deletable. Older API but feature-rich. Concurrency safety varies per type — read the source.

### `github.com/AndreasBriese/bbloom`

Originally part of the Badger key-value store. Optimised for speed; uses Murmur3. Includes a JSON-friendly serialisation.

### `github.com/seiflotfy/cuckoofilter`

Cuckoo filter (senior.md). Native delete, often less memory than Bloom at p ≥ 0.001. Worth considering as an alternative when you need delete and high throughput.

### Choosing

For most middle-level work, `bits-and-blooms/bloom/v3` wrapped per the patterns above is the right answer. Reach for the alternatives only when you need a specific feature (delete, atomic by construction, cuckoo semantics, Redis backing).

---

## Appendix: A Note on Determinism Across Versions

`bits-and-blooms/bloom/v3` is binary-stable: a filter marshalled by v3.0.0 unmarshals correctly with v3.7.0 and vice versa. The library guards this with a stable wire format and tests.

Across major versions (v2 -> v3), the wire format changed. Migrating: write a one-time conversion tool, run during deployment, never look back.

If you must support both wire formats during a migration, version-prefix your snapshots as shown in the Snapshot section.

---

## Appendix: A Mistake to Avoid With Sharded Filters

A common mistake: using the same hash for shard selection *and* within-shard positions.

```go
// WRONG
x := xxhash.Sum64(key)
shard := x % numShards
h1 := x // same hash used for positions
h2 := h1>>33 | h1<<31
```

This means every key in shard 7 lands in the same low-bit pattern of positions, biasing the bit distribution within that shard. The result is higher FPR in some shards and lower in others — the overall FPR is worse than predicted.

Fix:

```go
// RIGHT
x := xxhash.Sum64(key)
shard := x % numShards
h1 := x >> 8  // different bits for positions
h2 := h1>>33 | h1<<31
```

Or use two independent hashes (xxhash and Murmur3) for the two purposes. The latter is cleaner but costs an extra hash op per key.

---

## Appendix: Estimating Counter Width

We claimed 4 bits is enough for counting Bloom filters. Justification:

For optimal k (`k_opt = (m/n) ln 2`), the expected count per cell is `k*n/m = ln 2 ≈ 0.693`. By the Poisson approximation, the probability of any cell reaching count c is roughly `e^(-0.693) * 0.693^c / c!`. For c = 16 (overflow of 4 bits):

```
P(count >= 16) ≈ 0.693^16 / 16! ≈ 0.0023 / 2e13 ≈ 1e-16
```

For a filter with 1e8 cells, the expected number of overflowed cells is `1e8 * 1e-16 = 1e-8` — i.e. essentially zero.

Bumping to 8-bit counters gives more safety at 2x the memory. Probably not worth it for typical workloads.

For adversarial workloads where an attacker can intentionally cluster keys on cells, all bets are off — they can saturate any counter width. Use a keyed hash.

---

## Appendix: Bloom Filter as a Building Block for Bigger Structures

Several larger structures contain Bloom filters as components.

### LSM-tree SSTables (RocksDB, Cassandra, LevelDB)

Each SSTable on disk has a small Bloom filter held in RAM that says "is key X possibly in this SSTable?" A Get that misses the filter avoids touching the SSTable's data block — saving a disk read on a miss. With many SSTables and 1% FPR per filter, the cumulative miss rate is still small.

### Quotient filter

A different structure that supports Add, Test, Delete, and *enumeration* with good cache behaviour. Some implementations use a Bloom filter on top for quick "definitely not present" checks before doing the more expensive quotient filter lookup.

### Hyperloglog with Bloom prefilter

A HyperLogLog estimates cardinality. Prepending a Bloom filter lets you skip the HLL update for items you have certainly already seen, reducing the HLL's noise.

### IBLT (Invertible Bloom Lookup Tables)

A generalisation of counting Bloom filters that can *invert* — given the structure, recover the keys with high probability if the number of keys is small. Used in network protocols for set reconciliation.

### Spectral Bloom filter

Counters that record *number of times* a key was added, not just presence. Used for stream frequency counting; closely related to Count-Min Sketch.

You will not implement any of these at middle level, but knowing they exist helps you pick the right tool when "Bloom filter" alone is not quite what you need.

---

## Appendix: A Production-Grade Service Skeleton

Putting it all together. A real `userdir` service:

```go
package userdir

import (
	"context"
	"database/sql"
	"errors"
	"math/rand/v2"
	"sync/atomic"
	"time"

	"github.com/bits-and-blooms/bloom/v3"
)

type UserDir struct {
	store      Store
	filter     atomic.Pointer[bloom.BloomFilter]
	rebuildIn  atomic.Pointer[bloom.BloomFilter] // double-write target during rebuild
	rebuildSem chan struct{}

	hits, misses, fpHits, samples, fpSamples int64
}

type Store interface {
	GetUser(ctx context.Context, id string) (User, error)
	AllUserIDs(ctx context.Context) ([]string, error)
	InsertUser(ctx context.Context, u User) error
}

type User struct {
	ID    string
	Email string
}

func New(ctx context.Context, store Store, expectedUsers uint) (*UserDir, error) {
	f := bloom.NewWithEstimates(expectedUsers, 0.001)
	ids, err := store.AllUserIDs(ctx)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		f.AddString(id)
	}
	d := &UserDir{
		store:      store,
		rebuildSem: make(chan struct{}, 1),
	}
	d.filter.Store(f)
	return d, nil
}

func (d *UserDir) Lookup(ctx context.Context, id string) (User, bool, error) {
	if !d.filter.Load().TestString(id) {
		atomic.AddInt64(&d.misses, 1)
		return User{}, false, nil
	}
	atomic.AddInt64(&d.hits, 1)

	// 1% sample: always confirm against DB to track FPR.
	if rand.IntN(100) == 0 {
		atomic.AddInt64(&d.samples, 1)
	}

	u, err := d.store.GetUser(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		atomic.AddInt64(&d.fpHits, 1)
		if rand.IntN(100) == 0 {
			atomic.AddInt64(&d.fpSamples, 1)
		}
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, err
	}
	return u, true, nil
}

func (d *UserDir) Register(ctx context.Context, u User) error {
	if err := d.store.InsertUser(ctx, u); err != nil {
		return err
	}
	d.filter.Load().AddString(u.ID) // racy if other goroutine Adds; cover with mutex if you must
	if r := d.rebuildIn.Load(); r != nil {
		r.AddString(u.ID)
	}
	return nil
}

func (d *UserDir) Rebuild(ctx context.Context, expectedUsers uint, p float64) error {
	select {
	case d.rebuildSem <- struct{}{}:
	default:
		return errors.New("rebuild already in progress")
	}
	defer func() { <-d.rebuildSem }()

	fresh := bloom.NewWithEstimates(expectedUsers, p)
	d.rebuildIn.Store(fresh) // start double-writes

	ids, err := d.store.AllUserIDs(ctx)
	if err != nil {
		d.rebuildIn.Store(nil)
		return err
	}
	for _, id := range ids {
		fresh.AddString(id)
	}

	d.filter.Store(fresh)
	d.rebuildIn.Store(nil)
	return nil
}

func (d *UserDir) Stats() (hits, misses, fp int64, observedFPR float64) {
	hits = atomic.LoadInt64(&d.hits)
	misses = atomic.LoadInt64(&d.misses)
	fp = atomic.LoadInt64(&d.fpHits)
	samples := atomic.LoadInt64(&d.samples)
	fpSamples := atomic.LoadInt64(&d.fpSamples)
	if samples > 0 {
		observedFPR = float64(fpSamples) / float64(samples)
	}
	return
}

func (d *UserDir) StartObserver(ctx context.Context, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				hits, misses, fp, obsFPR := d.Stats()
				_ = hits
				_ = misses
				_ = fp
				_ = obsFPR
				// Publish to your metrics system here.
			}
		}
	}()
}
```

Read this skeleton carefully — it captures the patterns from this entire file:

- `atomic.Pointer` for lock-free filter swap.
- Double-write during rebuild.
- 1% sampling for observed FPR.
- Background observer goroutine.
- Cache-aside ordering on register.

A few intentional simplifications:

- `Register`'s `AddString` is racy under the assumption that you accept Bloom-filter-level idempotence. If your service writes are truly concurrent and you need linearisability around the filter, wrap with a `sync.Mutex` (or move to the atomic-bitset implementation).
- The `rebuildSem` is a 1-slot channel acting as a tryLock; only one rebuild at a time. A persistent leader (e.g. Kubernetes Lease) is the better design for multi-replica services.
- Error paths from `Rebuild` clear the `rebuildIn` pointer to stop double-writes. In a real implementation you would also log and bump a metric.

Skim this skeleton tomorrow morning before sitting down to write your own — most of the design decisions are already baked in.

---

## Appendix: How to Benchmark a Concurrent Bloom Filter

A reproducible benchmarking checklist.

### Step 1: pick representative parameters

- `n = 1_000_000`
- `p = 0.01`
- `m, k := bloom.EstimateParameters(n, p)`

### Step 2: pre-populate

```go
f := bloom.New(m, k)
for i := uint(0); i < n; i++ {
	f.Add([]byte(fmt.Sprintf("k%d", i)))
}
```

Without pre-population the filter is empty and Tests short-circuit on the first 0-bit. You measure something useless.

### Step 3: pick a key distribution

For Add benchmarks: synthetic monotonically-increasing keys.

For Test benchmarks: pre-built slice of bytes; random index per iteration to avoid CPU caching the key.

```go
probes := make([][]byte, 1024)
for i := range probes {
	probes[i] = []byte(fmt.Sprintf("k%d", rand.IntN(int(n))))
}
```

### Step 4: write the benchmark

```go
func BenchmarkTest(b *testing.B) {
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			f.Test(probes[i&1023])
			i++
		}
	})
}
```

`RunParallel` distributes iterations across `GOMAXPROCS` goroutines automatically.

### Step 5: run with relevant flags

```
go test -bench=BenchmarkTest -benchmem -benchtime=10s -cpu=1,2,4,8,16
```

`-cpu=` reruns the benchmark at each level. Look for sub-linear scaling: 16-core should be near 16x the 1-core throughput; if it is only 4x, you have contention.

### Step 6: profile

```
go test -bench=BenchmarkTest -cpuprofile=cpu.out -mutexprofile=mu.out
go tool pprof -http=:8080 cpu.out
go tool pprof -http=:8081 mu.out
```

Look at the flame graph. The Bloom-filter functions should dominate (Add, Test, hashing). Anything else is overhead to investigate.

### Step 7: vary parameters and re-measure

Change `numShards`, swap to atomic, swap hash function. Re-run. Build a table of `(variant, GOMAXPROCS) -> ops/sec`. Pick the winner for your workload shape.

This is the disciplined way to choose a concurrent Bloom filter design. Without it you are picking on vibes.

---

## Appendix: A Glossary of Performance Symptoms

You will hear (or write) these in postmortems.

| Symptom | Likely cause | Quick check |
| --- | --- | --- |
| "p99 spikes during writes" | RWMutex writer lock starves readers | `sync.RWMutex` in profile; consider atomic |
| "Throughput scales to 4 cores then plateaus" | Per-cache-line contention; false sharing | Padding test; mutex profile |
| "Filter says no for a key we just added" | Race: missing wrapper, or atomic not applied | Race detector |
| "FPR drifted up over the weekend" | Saturation: n exceeded design | Check `Count()/Cap()`; rebuild |
| "Service runs out of memory after a week" | Unbounded filter chain (SBF or window) | Cap windows; rotate |
| "GC pauses correlated with filter size" | Bitset on heap, scanned each GC cycle | Mmap allocation; raise `GOGC` |
| "Negative cache miss latency rises" | Source-of-truth slowing; not filter's fault | Look at db_latency, not filter |
| "Filter empty after restart" | No snapshot on shutdown | Add `SIGTERM` handler |

Pattern-recognition table; pin it above your monitor.

---

## Appendix: Concurrent Bloom Filter Anti-Patterns

A short list of design choices that look reasonable and bite later.

### Anti-pattern 1: One mutex per bit

```go
type Filter struct {
	bitMu []sync.Mutex // m mutexes!
	bits  []uint64
}
```

Wasteful: a `sync.Mutex` is 8 bytes; m mutexes for m bits is 64x the bitset memory. Atomic OR achieves the same effect for free.

### Anti-pattern 2: Channel-based update queue

```go
type Filter struct {
	updates chan []byte
}

func (f *Filter) Add(k []byte) { f.updates <- k }
```

Forces a goroutine on the receiving side; serialises Adds even worse than a mutex; adds latency from channel send. Don't.

### Anti-pattern 3: Lock around Marshal during high write load

```go
mu.Lock()
data, _ := f.MarshalBinary()
mu.Unlock()
```

Holds the mutex for the entire `MarshalBinary` (which copies the whole bitset). Latency spike for all readers. Use a Reader-side snapshot (clone via Union with an empty filter) instead.

### Anti-pattern 4: Rebuild on every miss

```go
if !f.Test(k) {
	rebuildFromTruth()
	if !f.Test(k) {
		return false
	}
}
return true
```

A spurious miss should not trigger a rebuild — *misses are the point of the filter*. Rebuild only when fill or observed FPR cross a threshold.

### Anti-pattern 5: Filter as primary store

```go
func RegisterUser(id string) {
	filter.Add([]byte(id))
}
func IsRegistered(id string) bool {
	return filter.Test([]byte(id))
}
```

No database. False positives mean "user is registered" for users who never registered. Catastrophic for billing, auth, KYC. Always pair with authoritative storage.

### Anti-pattern 6: Sharing one filter across services without serialisation contract

Two services build "the same" filter from "the same" keys but use different hash families. Their bitsets do not agree on positions. Test answers differ. Always marshal/unmarshal; never trust "rebuild from the same input" to produce equal filters across implementations.

---

## Appendix: A Bigger Picture

Concurrent Bloom filters are a specific instance of a broader principle: **decouple the cheap-approximation path from the expensive-truth path, and synchronise them with eventual consistency.**

You will see this pattern everywhere:

- LRU caches (cheap memory) + database (slow truth).
- Bloom filter (cheap negative) + database (slow positive).
- Heuristic firewalls (cheap reject) + deep inspection (slow accept).
- Stale read replicas (cheap reads) + master (correct writes).

The Bloom filter is the smallest, sharpest example. Master it and you have the toolkit for all of the above.

---

## Appendix: A Code Review You Should Be Able To Conduct

Walk through this PR diff and identify the issues.

```go
+ var globalFilter = bloom.NewWithEstimates(1000, 0.1)
+
+ func RegisterUser(id string) {
+     globalFilter.AddString(id)
+     db.Insert(id)
+ }
+
+ func IsRegistered(id string) bool {
+     return globalFilter.TestString(id)
+ }
```

What is wrong?

1. `bloom.NewWithEstimates(1000, 0.1)` — sized for 1 000 items at 10% FPR. Almost certainly wrong scale and wrong target rate. Should pick from production estimates.
2. `globalFilter` is a package-level variable, shared across goroutines. No mutex; not safe.
3. `RegisterUser` updates the filter *before* the database. If `db.Insert` fails, the filter is polluted with a key the DB never accepted. Cache-aside ordering violated.
4. `IsRegistered` returns the filter result directly. No slow-path confirmation. Every false positive returns "user is registered" — likely wrong for any business logic that depends on registration.
5. No tests, no metrics, no rebuild path, no snapshot.

Five flaws in six lines of code. Catching all of them in code review is the middle-level bar.

---

## Final Self-Test

If you can answer these without re-reading, you are middle-level.

1. Why does `atomic.OrUint64` not lose bits when two goroutines write to the same word?
2. When is sharded + atomic better than just atomic?
3. Why is `numShards` typically a power of 2?
4. How many bits per counter in a counting Bloom filter, and why?
5. What does `atomic.Pointer[bloom.BloomFilter]` enable that `sync.Mutex` does not?
6. Why is the cache-aside ordering rule (truth before cache) load-bearing?
7. What does the 1% sampling trick measure?
8. Why do we double-write during a rebuild?
9. How would you detect false sharing between shard mutexes?
10. When would you reach for a Cuckoo filter instead?

If you stumbled on any of these, jump back to that section. When all ten flow easily, turn to senior.md.
