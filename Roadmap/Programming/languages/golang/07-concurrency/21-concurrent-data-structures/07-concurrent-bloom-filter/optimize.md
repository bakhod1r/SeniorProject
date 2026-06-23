# Concurrent Bloom Filter — Optimization Exercises

> Each exercise presents a slow or wasteful implementation. Identify the bottleneck, propose a measurable improvement, implement it. Solutions sketch the answer.

---

## Optimization 1 — Lock contention dominates

### Slow code

```go
type Filter struct {
    mu sync.Mutex
    f  *bloom.BloomFilter
}

func (s *Filter) Add(k []byte) { s.mu.Lock(); defer s.mu.Unlock(); s.f.Add(k) }
func (s *Filter) Test(k []byte) bool { s.mu.Lock(); defer s.mu.Unlock(); return s.f.Test(k) }
```

Under 16 concurrent readers + 1 writer, throughput plateaus at ~1.5M ops/sec.

### Diagnose

- `sync.Mutex` serialises everything. Every Test waits behind every other Test.
- Profile shows 70%+ CPU in `sync.(*Mutex).Lock` and runtime park/unpark.

### Optimize

Switch to `sync.RWMutex`:

```go
type Filter struct {
    mu sync.RWMutex
    f  *bloom.BloomFilter
}

func (s *Filter) Add(k []byte) { s.mu.Lock(); s.f.Add(k); s.mu.Unlock() }
func (s *Filter) Test(k []byte) bool { s.mu.RLock(); defer s.mu.RUnlock(); return s.f.Test(k) }
```

Reads now run in parallel. Throughput scales to ~12M ops/sec for a read-heavy workload.

For a write-heavy workload, move to atomic bitset (next exercise).

---

## Optimization 2 — RWMutex overhead under write load

### Slow code

The RWMutex wrapper from Optimization 1. At 80% writes / 20% reads, the writer lock blocks readers; total throughput is poor.

### Diagnose

Profile shows mutex acquisition costs dominating. The RWMutex's internal counter atomic ops are themselves contended.

### Optimize

Switch to an atomic bitset:

```go
type Filter struct {
    bits []uint64
    m, k uint64
}

func (f *Filter) Add(key []byte) {
    h1, h2 := hashes(key)
    for i := uint64(0); i < f.k; i++ {
        pos := (h1 + i*h2) % f.m
        atomic.OrUint64(&f.bits[pos/64], 1<<(pos%64))
    }
}

func (f *Filter) Test(key []byte) bool {
    h1, h2 := hashes(key)
    for i := uint64(0); i < f.k; i++ {
        pos := (h1 + i*h2) % f.m
        if atomic.LoadUint64(&f.bits[pos/64])&(1<<(pos%64)) == 0 {
            return false
        }
    }
    return true
}
```

No locks. Wait-free for both Add and Test. Throughput 8x or more under write-heavy load.

---

## Optimization 3 — Cache misses on large filter

### Slow code

A 1 GB atomic Bloom filter with k = 10. Test latency is 1+ µs, dominated by cache misses.

### Diagnose

`perf stat` shows cache miss rate ~90%. The 10 hash positions are spread randomly across 1 GB; each hits a different cache line; each is a main-memory access.

### Optimize

Switch to a block Bloom filter. Each Test reads exactly one cache line (64 bytes). Latency drops to ~150 ns.

```go
type BlockBloom struct {
    blocks [][8]uint64
    k      uint64
}

func (b *BlockBloom) Test(key []byte) bool {
    h := xxhash.Sum64(key)
    blockIdx := h % uint64(len(b.blocks))
    block := &b.blocks[blockIdx]
    // k position derivations all within [0, 512)
    ...
}
```

Trade-off: slightly higher FPR (~20% more) at the same memory. For latency-sensitive workloads, well worth it.

---

## Optimization 4 — False sharing of shard mutexes

### Slow code

```go
type Sharded struct {
    shards [32]struct {
        mu sync.RWMutex
        f  *bloom.BloomFilter
    }
}
```

Throughput scales sub-linearly past 4 cores.

### Diagnose

Each shard struct is ~32 bytes. Two adjacent shards live in one 64-byte cache line. A write to shard 0's mutex invalidates the cache line for shard 1.

### Optimize

Pad each shard:

```go
type shardEntry struct {
    _  cpu.CacheLinePad
    mu sync.RWMutex
    f  *bloom.BloomFilter
    _  cpu.CacheLinePad
}

type Sharded struct {
    shards [32]shardEntry
}
```

`cpu.CacheLinePad` from `golang.org/x/sys/cpu` is platform-aware. Throughput scales linearly to 16 cores.

---

## Optimization 5 — Hashing dominates

### Slow code

```go
func hashes(key []byte) (uint64, uint64) {
    h := fnv.New64a()
    h.Write(key)
    x := h.Sum64()
    return x, x>>32 | x<<32
}
```

Profile shows 40% of CPU in `fnv` operations.

### Diagnose

FNV-1a is slow (~500 MB/s) and has weak distribution. For Bloom filters with short keys, FNV's avalanche is poor.

### Optimize

Switch to `xxhash`:

```go
func hashes(key []byte) (uint64, uint64) {
    x := xxhash.Sum64(key)
    h2 := x>>33 | x<<31
    if h2 == 0 { h2 = 1 }
    return x, h2
}
```

`xxhash` is ~6 GB/s, with strong avalanche. CPU usage in hashing drops 5-10x. Observed FPR usually improves too.

---

## Optimization 6 — Allocations on the hot path

### Slow code

```go
func (s *Service) Lookup(id int) bool {
    return s.filter.TestString(fmt.Sprintf("user-%d", id))
}
```

Profile shows allocations on every call.

### Diagnose

`fmt.Sprintf` allocates a string. `TestString` (on older Go) converts to bytes again.

### Optimize

Pre-allocate a buffer:

```go
func (s *Service) Lookup(id int) bool {
    var buf [32]byte
    key := strconv.AppendInt(append(buf[:0], "user-"...), int64(id), 10)
    return s.filter.Test(key)
}
```

`strconv.AppendInt` writes into the stack buffer; no heap allocation. Throughput 2-3x for short-running services.

---

## Optimization 7 — Stale snapshots holding the lock

### Slow code

```go
func (s *Service) Snapshot() ([]byte, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.filter.MarshalBinary() // 200ms for 100MB filter
}
```

P99 latency spikes every 30 seconds when the snapshot loop runs.

### Diagnose

The RLock blocks writers for 200ms. Writers queue up; their tail latency spikes.

### Optimize

Use an atomic-bitset implementation with a streaming snapshot that loads each word atomically; no lock held.

```go
func (f *AtomicFilter) WriteTo(w io.Writer) (int64, error) {
    // Write header
    ...
    // Stream each word, no lock
    var buf [8]byte
    for i := range f.bits {
        binary.LittleEndian.PutUint64(buf[:], atomic.LoadUint64(&f.bits[i]))
        w.Write(buf[:])
    }
    ...
}
```

Snapshot now takes the same 200ms wall-clock but blocks no one.

---

## Optimization 8 — GC scan time on large filter

### Slow code

A service with a 2 GB Bloom filter. GC mark phase takes 50ms.

### Diagnose

The bitset (2 GB) is on the heap. GC scans it every cycle.

### Optimize

Allocate the bitset outside the heap via mmap:

```go
func mmapBitset(numWords int) []uint64 {
    raw, _ := unix.Mmap(-1, 0, numWords*8,
        unix.PROT_READ|unix.PROT_WRITE,
        unix.MAP_ANON|unix.MAP_PRIVATE)
    return unsafe.Slice((*uint64)(unsafe.Pointer(&raw[0])), numWords)
}
```

The bytes are not registered with the GC. Mark phase drops to a few ms.

Trade-off: manual cleanup via `unix.Munmap`. Use only when profiling shows GC scan as the bottleneck.

---

## Optimization 9 — TLB misses on huge filter

### Slow code

A 4 GB Bloom filter. P99 Test latency is 5 µs, despite a single cache line read per Test.

### Diagnose

The filter spans ~1M memory pages (4 KB each). The TLB caches ~1024 entries. Each Test touches a random page; TLB miss rate is ~99%; each miss costs ~100 ns.

### Optimize

Enable transparent huge pages (THP):

```
echo always | sudo tee /sys/kernel/mm/transparent_hugepage/enabled
```

The kernel automatically backs the 4 GB allocation with 2 MB huge pages. TLB now covers 4 GB with 2048 entries; TLB miss rate near 0%.

In Go, no code change is needed. Verify:

```
cat /proc/<pid>/smaps | grep AnonHugePages
```

---

## Optimization 10 — Page faults at first use

### Slow code

After service startup, the first 100k requests are 10x slower than baseline.

### Diagnose

The newly-allocated bitset's pages are not backed by physical memory. Each first-access triggers a minor page fault (~5 µs).

### Optimize

Pre-fault the bitset at startup:

```go
func prefault(bits []uint64) {
    for i := range bits {
        bits[i] = bits[i] | 0 // forces page allocation
    }
}
```

After this, all pages are present. Subsequent requests pay no fault cost.

For a 1 GB filter, pre-fault takes ~500 ms (one-time cost). Production-grade constructors include it.

---

## Optimization 11 — Marshal allocation

### Slow code

```go
func (f *AtomicFilter) MarshalBinary() ([]byte, error) {
    buf := make([]byte, 16+len(f.bits)*8) // allocates 100MB+ for big filter
    ...
}
```

`MarshalBinary` allocates a 100 MB byte slice every snapshot.

### Diagnose

GC churn during snapshots.

### Optimize

Use `WriteTo(io.Writer)` to stream instead:

```go
func (f *AtomicFilter) WriteTo(w io.Writer) (int64, error) {
    var buf [8]byte // tiny, on stack
    ...
    for i := range f.bits {
        binary.LittleEndian.PutUint64(buf[:], atomic.LoadUint64(&f.bits[i]))
        w.Write(buf[:])
    }
    ...
}
```

Allocations drop to constant. Callers can stream directly to a file or HTTP response.

---

## Optimization 12 — `BitSet.Count` on hot path

### Slow code

```go
func (s *Service) StatsLoop() {
    t := time.NewTicker(time.Second)
    for range t.C {
        fill := float64(s.filter.BitSet().Count()) / float64(s.filter.Cap())
        publishMetric("fill", fill)
    }
}
```

The stats loop runs every second; `BitSet.Count` walks all m bits.

### Diagnose

For a 1 GB filter, Count takes ~5ms. 5ms of CPU spent every second is 0.5% just for stats.

### Optimize

Less frequent stats (every 30s instead of 1s), or maintain an `atomic.Int64` counter that's incremented on every Add (with the understanding that re-Adds may double-count; cap by a sentinel or accept small inaccuracy):

```go
atomic.AddInt64(&s.bitsSet, 1) // approximate
```

For accurate fill, periodic full Count is fine if called every 30-60 seconds.

---

## Optimization 13 — Sharded filter with hot shard

### Slow code

A 32-shard filter; profiling shows shard 7 receiving 10x the writes of any other shard.

### Diagnose

The shard-routing hash has a bias for certain key patterns. Shard 7 is contended; others are idle.

### Optimize

Switch to a stronger hash for routing:

```go
func shardFor(key []byte) int {
    h := xxhash.Sum64(key)
    return int(h % numShards)
}
```

xxhash distributes uniformly even on adversarial inputs. Confirm with a uniform-distribution test: hash 1M keys, count per-shard; standard deviation should be <5% of the mean.

---

## Optimization 14 — Hot reload swap latency

### Slow code

```go
func (s *Service) Reload() {
    fresh := s.buildFromTruth()
    s.mu.Lock()
    s.filter = fresh
    s.mu.Unlock()
}
```

During the brief swap, all readers and writers block on the mutex. With a 100k req/sec service, hundreds of requests queue.

### Diagnose

The mutex acquisition serialises the swap with all in-flight operations.

### Optimize

Use `atomic.Pointer`:

```go
type Service struct {
    filter atomic.Pointer[bloom.BloomFilter]
}

func (s *Service) Reload() {
    fresh := s.buildFromTruth()
    s.filter.Store(fresh)
}

func (s *Service) Lookup(k []byte) bool {
    return s.filter.Load().Test(k)
}
```

The swap is a single atomic Store; no readers block.

---

## Optimization 15 — Snapshot-then-restore inefficiency

### Slow code

```go
func (s *Service) Backup(path string) error {
    data, err := s.filter.MarshalBinary()
    if err != nil { return err }
    return os.WriteFile(path, data, 0o600)
}
```

Snapshot to memory then to disk doubles peak memory.

### Diagnose

For a 100 MB filter, peak memory is 200 MB during the snapshot.

### Optimize

Stream directly to disk:

```go
func (s *Service) Backup(path string) error {
    tmp := path + ".tmp"
    f, err := os.Create(tmp)
    if err != nil { return err }
    if _, err := s.filter.WriteTo(f); err != nil {
        f.Close()
        os.Remove(tmp)
        return err
    }
    if err := f.Close(); err != nil { return err }
    return os.Rename(tmp, path)
}
```

Constant memory; atomic rename for crash safety.

---

## Optimization 16 — Multiple Tests per request

### Slow code

```go
func (s *Service) BulkLookup(ids []string) []bool {
    result := make([]bool, len(ids))
    for i, id := range ids {
        result[i] = s.filter.TestString(id)
    }
    return result
}
```

For 100 lookups, this is 100 separate Test calls.

### Diagnose

Each call pays the same fixed overhead. For batch workloads, batching the Tests with prefetching can help.

### Optimize

Compute all hashes first, then issue all bitset reads (allowing the CPU to prefetch):

```go
func (s *Service) BulkLookup(ids []string) []bool {
    n := len(ids)
    hashes := make([][2]uint64, n)
    for i, id := range ids {
        hashes[i][0], hashes[i][1] = computeHashes([]byte(id))
    }
    result := make([]bool, n)
    for i := range hashes {
        result[i] = s.filter.testHashes(hashes[i][0], hashes[i][1])
    }
    return result
}
```

Modest improvement for small batches; significant for batches of 1000+.

For genuine batching, use a block Bloom filter and SIMD intrinsics — but that requires assembly.

---

## Optimization 17 — Frequent ApproximatedSize calls

### Slow code

```go
func (s *Service) shouldRebuild() bool {
    return s.filter.ApproximatedSize() > rebuildThreshold
}
```

Called on every Add to decide whether to rebuild.

### Diagnose

`ApproximatedSize` walks the entire bitset (~5 ms for a 1 GB filter). Calling it on every Add is catastrophic.

### Optimize

Maintain a separate `atomic.Int64` counter:

```go
func (s *Service) Add(k []byte) {
    s.filter.Add(k)
    if atomic.AddInt64(&s.addCount, 1) > rebuildThreshold {
        triggerRebuild()
    }
}
```

The counter overestimates n (re-Adds count again), but for the rebuild trigger that is fine — false positives just trigger a rebuild slightly earlier.

---

## Optimization 18 — Wasteful rebuild on minor changes

### Slow code

```go
// Triggered on any user registration.
func userRegistered(...) {
    triggerFullRebuild()
}
```

Full rebuild on every event is enormously wasteful.

### Diagnose

Rebuild costs O(n); doing it after each Add costs O(n) per Add. For 1M users this is impractical.

### Optimize

Add directly to the filter; rebuild only on saturation:

```go
func userRegistered(id string) {
    s.filter.AddString(id)
    if s.filter.FillFraction() > 0.7 {
        go s.rebuildAsync()
    }
}
```

Rebuilds amortise across many Adds.

---

## Optimization 19 — Single Bloom filter for multiple concerns

### Slow code

```go
var globalFilter = bloom.NewWithEstimates(10_000_000, 0.001)

// used for: user existence, email breach, URL spam, ...
```

One filter holds many concerns. False positives for "email breach" affect "user existence" checks.

### Diagnose

Concerns are coupled. A filter sized appropriately for one concern is wrong for the others.

### Optimize

Split into per-concern filters:

```go
var (
    userFilter  = bloom.NewWithEstimates(5_000_000, 0.001)
    emailFilter = bloom.NewWithEstimates(1_000_000_000, 0.0001)
    urlFilter   = bloom.NewWithEstimates(500_000_000, 0.01)
)
```

Each concern has its own sizing, FPR target, and rebuild cadence. Operational clarity is huge.

---

## Optimization 20 — Bloom filter unnecessary at this scale

### Slow code

A service with 1 000 known users uses a Bloom filter for "user exists?" checks.

### Diagnose

For 1 000 users, a `map[string]struct{}` is faster, simpler, and exact.

### Optimize

```go
var userSet = make(map[string]struct{}, 1000)

func init() {
    for _, id := range allUsers {
        userSet[id] = struct{}{}
    }
}

func exists(id string) bool {
    _, ok := userSet[id]
    return ok
}
```

No filter overhead. Exact answers. Use Bloom only when the memory savings justify the FPR trade-off (typically n > 100 000 or memory pressure is real).

---

## Final Thoughts

Most Bloom-filter optimisations fall into a few categories:

1. **Reduce contention.** RWMutex > Mutex > atomic > sharded atomic.
2. **Reduce cache misses.** Block Bloom > standard Bloom for large filters.
3. **Reduce allocations.** Pre-allocate buffers; stream serialisation.
4. **Reduce GC scan.** mmap for very large filters.
5. **Reduce hash cost.** xxhash > Murmur3 > FNV.
6. **Avoid expensive ops in hot path.** ApproximatedSize, MarshalBinary, ClearAll.
7. **Don't use a Bloom filter when a map works.** Simplicity is an optimisation.

Profile first. Measure improvements. Document trade-offs. Most "optimisations" without profiling are guesses; some make things worse.

The boring rule: **measure, optimise, measure again**. The Bloom filter is small; the engineering around it rewards rigour.
