# Concurrent Bloom Filter — Find the Bug

> Each snippet contains a real concurrency bug, sizing bug, or operational bug. Find it, explain it, fix it.

---

## Bug 1 — Missing wrapper

```go
var f = bloom.NewWithEstimates(1_000_000, 0.01)

func handler(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    if f.TestString(id) {
        w.Write([]byte("maybe"))
    } else {
        w.Write([]byte("no"))
    }
}

func register(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    f.AddString(id)
    w.Write([]byte("added"))
}
```

**Bug.** The `*bloom.BloomFilter` is shared across HTTP handlers (each handler runs in its own goroutine), but the library is not safe for concurrent use. Concurrent `Add` and `Test` can race on the underlying bitset, producing torn reads and lost bits — and therefore false negatives.

**Fix.** Wrap with `sync.RWMutex`:

```go
var (
    mu sync.RWMutex
    f  = bloom.NewWithEstimates(1_000_000, 0.01)
)

func handler(...) {
    mu.RLock()
    present := f.TestString(id)
    mu.RUnlock()
    ...
}

func register(...) {
    mu.Lock()
    f.AddString(id)
    mu.Unlock()
}
```

---

## Bug 2 — Update filter before truth

```go
func (s *Service) Register(id, email string) error {
    s.filter.AddString(id) // 1. filter first
    return s.db.Insert(id, email) // 2. db second
}
```

**Bug.** Cache-aside ordering is violated. If `db.Insert` fails (DB outage, validation error, conflict), the filter is now polluted with an ID that has no corresponding row. Future Tests for that ID will say "maybe present"; the DB will say "not found"; the user observes "this user does not exist" with a wasted DB round trip.

**Fix.** Update truth first, filter second:

```go
func (s *Service) Register(id, email string) error {
    if err := s.db.Insert(id, email); err != nil {
        return err
    }
    s.filter.AddString(id)
    return nil
}
```

---

## Bug 3 — Undersized filter

```go
filter := bloom.NewWithEstimates(100, 0.01)
for _, id := range allUsers { // allUsers has 100,000 entries
    filter.AddString(id)
}
```

**Bug.** Filter is sized for 100 items; we added 100 000. The bitset is fully saturated. FPR is essentially 1.0 — every Test returns "maybe." The filter is useless.

**Fix.** Size for the actual count plus headroom:

```go
filter := bloom.NewWithEstimates(uint(len(allUsers))*2, 0.01)
```

---

## Bug 4 — Torn read in racy code

```go
type Filter struct {
    bits []uint64
}

func (f *Filter) Set(i uint64) {
    f.bits[i/64] |= 1 << (i%64) // NOT atomic
}

func (f *Filter) Test(i uint64) bool {
    return f.bits[i/64] & (1<<(i%64)) != 0 // NOT atomic
}
```

**Bug.** Both operations are read-modify-write or read-only on a shared word. Two concurrent Sets can lose a bit (the classic lost-update race). A concurrent Test can read a word being written, observing arbitrary intermediate state.

**Fix.** Use atomic operations:

```go
func (f *Filter) Set(i uint64) {
    atomic.OrUint64(&f.bits[i/64], 1<<(i%64))
}

func (f *Filter) Test(i uint64) bool {
    return atomic.LoadUint64(&f.bits[i/64]) & (1<<(i%64)) != 0
}
```

---

## Bug 5 — Snapshot under hot mutex

```go
func (s *Service) Snapshot() ([]byte, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.filter.MarshalBinary()
}
```

**Bug.** The snapshot holds the write lock for the entire Marshal (~200 ms for a 100 MB filter). During that window, all readers and writers are blocked. P99 latency spikes every 30 seconds (or whatever the snapshot interval is).

**Fix.** Hold the read lock instead (snapshot is read-only), or use an atomic-bitset implementation that does not need a lock:

```go
func (s *Service) Snapshot() ([]byte, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.filter.MarshalBinary()
}
```

Or better: a streaming snapshot that uses `atomic.LoadUint64` per word, holding no lock at all.

---

## Bug 6 — Double-checked locking without atomic

```go
type LazyFilter struct {
    f *bloom.BloomFilter
}

func (l *LazyFilter) Test(k []byte) bool {
    if l.f == nil {
        mu.Lock()
        if l.f == nil {
            l.f = bloom.NewWithEstimates(100000, 0.01)
        }
        mu.Unlock()
    }
    return l.f.Test(k)
}
```

**Bug.** The first `if l.f == nil` check is outside the lock. Without atomic semantics, a goroutine may observe a non-nil `l.f` but read partially-initialised filter state. This is the classic broken double-checked locking pattern.

**Fix.** Use `sync.Once`:

```go
type LazyFilter struct {
    once sync.Once
    f    *bloom.BloomFilter
}

func (l *LazyFilter) Test(k []byte) bool {
    l.once.Do(func() {
        l.f = bloom.NewWithEstimates(100000, 0.01)
    })
    return l.f.Test(k)
}
```

`sync.Once` provides the happens-before guarantee.

---

## Bug 7 — Per-shard mutex with false sharing

```go
type Sharded struct {
    shards [32]struct {
        mu sync.RWMutex
        f  *bloom.BloomFilter
    }
}
```

**Bug.** Each shard struct is about 32 bytes (24 for RWMutex + 8 for pointer). Two adjacent shards occupy the same 64-byte cache line. A write to shard 0's mutex invalidates the cache line for shard 1 across all cores — false sharing. Throughput suffers.

**Fix.** Pad to one cache line per shard:

```go
type Sharded struct {
    shards [32]struct {
        _  cpu.CacheLinePad
        mu sync.RWMutex
        f  *bloom.BloomFilter
        _  cpu.CacheLinePad
    }
}
```

`cpu.CacheLinePad` from `golang.org/x/sys/cpu` is platform-aware.

---

## Bug 8 — Stale filter pointer

```go
var globalFilter atomic.Pointer[bloom.BloomFilter]

func init() {
    globalFilter.Store(bloom.NewWithEstimates(1000000, 0.01))
}

func handler(w http.ResponseWriter, r *http.Request) {
    f := globalFilter.Load()
    // ... process many keys against f ...
    for _, k := range manyKeys {
        f.Test(k) // continues using `f` even if globalFilter was swapped
    }
}
```

**Bug.** Loading the filter pointer once and using it for an extended operation means you may continue to use a stale filter after a hot-reload. If the swap happened during the operation, you are working off the old version.

This is sometimes desired (read snapshot semantics) and sometimes a bug (you wanted the new filter for new keys). Document and decide explicitly.

**Fix.** If "always use the latest" is the intent, re-load on each Test:

```go
for _, k := range manyKeys {
    globalFilter.Load().Test(k)
}
```

---

## Bug 9 — `TestAndAdd` assumed atomic

```go
func (s *Service) FirstAdd(id string) bool {
    if !s.filter.TestAndAddString(id) {
        // first time we've seen this ID
        s.processNew(id)
        return true
    }
    return false
}
```

**Bug.** The library's `TestAndAdd` is not atomic across goroutines. Two goroutines calling `FirstAdd("alice")` concurrently can both observe "false" (the bits were not yet set when each read them) and both call `processNew("alice")`. The function is supposed to ensure exactly-once processing; it does not.

**Fix.** Either accept the rare double-process (idempotent processing) or wrap with a mutex to serialise the test-and-add:

```go
func (s *Service) FirstAdd(id string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.filter.TestAndAddString(id) {
        return false
    }
    s.processNew(id)
    return true
}
```

---

## Bug 10 — Rebuild during writes loses keys

```go
func (s *Service) Rebuild() {
    fresh := bloom.NewWithEstimates(2_000_000, 0.001)
    for _, id := range s.db.AllUserIDs() {
        fresh.AddString(id)
    }
    s.mu.Lock()
    s.filter = fresh
    s.mu.Unlock()
}
```

**Bug.** During the rebuild, Adds continue to land on the *old* filter. After the swap, those Adds are missing from the *new* filter, until the next rebuild. The filter has false negatives for keys added during the rebuild window.

**Fix.** Double-write during rebuild:

```go
func (s *Service) Rebuild() {
    fresh := bloom.NewWithEstimates(2_000_000, 0.001)
    s.mu.Lock()
    s.rebuildIn = fresh
    s.mu.Unlock()

    for _, id := range s.db.AllUserIDs() {
        fresh.AddString(id)
    }

    s.mu.Lock()
    s.filter = fresh
    s.rebuildIn = nil
    s.mu.Unlock()
}

func (s *Service) Register(id string) error {
    if err := s.db.Insert(id); err != nil { return err }
    s.mu.Lock()
    s.filter.AddString(id)
    if s.rebuildIn != nil {
        s.rebuildIn.AddString(id)
    }
    s.mu.Unlock()
    return nil
}
```

---

## Bug 11 — Hash mismatch across processes

```go
// Process A:
import "github.com/cespare/xxhash/v2"
import "hash/maphash"

var seedA = maphash.MakeSeed()

func hashA(k []byte) uint64 {
    return maphash.Bytes(seedA, k)
}

// Process B:
var seedB = maphash.MakeSeed()

func hashB(k []byte) uint64 {
    return maphash.Bytes(seedB, k)
}
```

**Bug.** `maphash.MakeSeed()` returns a random per-process seed. Process A and B compute different hashes for the same key. A filter built by A and marshalled to B will have all queries fail (false negatives across processes).

**Fix.** Use a deterministic hash or share the seed:

```go
// Shared config:
const fixedSeed = 0xCAFEBABE

func hash(k []byte) uint64 {
    return xxhash.Sum64WithSeed(k, fixedSeed)
}
```

`xxhash` allows an explicit seed; `hash/maphash` does too via `maphash.Seed{...}` construction but the seed is opaque.

---

## Bug 12 — Snapshot during writes captures inconsistent state

```go
func (s *Service) snapshotLoop() {
    t := time.NewTicker(30 * time.Second)
    for range t.C {
        data, _ := s.filter.MarshalBinary() // racy: filter being written
        os.WriteFile("snapshot.bin", data, 0o600)
    }
}
```

**Bug.** `MarshalBinary` walks the bitset *without* atomic loads (the library does not use atomics). A concurrent `Add` can produce torn reads; the snapshot may contain garbage in some words.

**Fix.** Hold a read lock during Marshal:

```go
s.mu.RLock()
data, _ := s.filter.MarshalBinary()
s.mu.RUnlock()
```

Or use an atomic-bitset implementation with a snapshot method that loads each word atomically.

---

## Bug 13 — Two filters with mismatched parameters

```go
f1 := bloom.NewWithEstimates(1_000_000, 0.01)
f2 := bloom.NewWithEstimates(1_000_000, 0.001) // different p
unionFilter, err := f1.Union(f2)
```

**Bug.** Union requires `f1.Cap() == f2.Cap()` and `f1.K() == f2.K()`. Different FPR targets yield different m and k. The Union call returns an error.

**Fix.** Construct both filters with identical parameters; or rebuild one to match.

---

## Bug 14 — Concurrent `ClearAll` and Test

```go
func (s *Service) Reset() {
    s.filter.ClearAll() // wipes the filter
}

// elsewhere:
func (s *Service) Lookup(k []byte) bool {
    return s.filter.Test(k)
}
```

**Bug.** A concurrent Test during ClearAll may observe an inconsistent state: some bits cleared, others not. The Test may return either true or false depending on which word it samples.

**Fix.** Either hold a write lock during ClearAll (blocking readers), or use an atomic-bitset variant that clears with `atomic.StoreUint64` and allows readers to observe a consistent (if non-deterministic) state.

```go
func (s *Service) Reset() {
    s.mu.Lock()
    s.filter.ClearAll()
    s.mu.Unlock()
}
```

---

## Bug 15 — Filter never rebuilt

```go
var filter = bloom.NewWithEstimates(1_000_000, 0.01)

func init() {
    // populated from DB at startup
    for _, id := range loadAllUsers() {
        filter.AddString(id)
    }
}
```

**Bug.** The filter is loaded once at startup and never rebuilt. As users grow (registrations, deletions, etc.), the filter drifts from truth. False negatives appear for users added after startup; saturation grows over time.

**Fix.** Add a rebuild loop that periodically refreshes the filter from the source of truth.

```go
func startRebuildLoop() {
    go func() {
        t := time.NewTicker(time.Hour)
        for range t.C {
            fresh := bloom.NewWithEstimates(uint(estimatedUserCount()*2), 0.01)
            for _, id := range loadAllUsers() {
                fresh.AddString(id)
            }
            globalFilter.Store(fresh) // assuming atomic.Pointer
        }
    }()
}
```

---

## Bug 16 — k = 0

```go
m, k := bloom.EstimateParameters(1_000_000, 0.99) // very loose p
f := bloom.New(m, k)
// k is 0 here
```

**Bug.** `EstimateParameters` for very loose `p` can compute `k = 0` (rounded from a sub-1.0 value). The library guards against this with a minimum of 1, but a custom implementation might not. With k = 0, Test loops zero times and returns true vacuously — every key looks present.

**Fix.** Always clamp `k >= 1`:

```go
if k < 1 { k = 1 }
```

---

## Bug 17 — m = 0

```go
filter := bloom.New(0, 7) // m = 0
filter.Add([]byte("key")) // panics or silently fails
```

**Bug.** A zero-sized filter is meaningless. The library panics; a custom implementation may divide by zero.

**Fix.** Validate at construction:

```go
func New(m, k uint64) (*Filter, error) {
    if m == 0 { return nil, errors.New("m must be positive") }
    if k == 0 { return nil, errors.New("k must be positive") }
    return &Filter{...}, nil
}
```

---

## Bug 18 — Filter as primary store

```go
func IsRegistered(id string) bool {
    return globalFilter.TestString(id)
}
```

**Bug.** Treating Test=true as "definitely registered" is wrong. False positives mean unregistered users would appear registered. For business logic that depends on registration status, this is catastrophic.

**Fix.** Always follow Test=true with an authoritative check:

```go
func IsRegistered(id string) bool {
    if !globalFilter.TestString(id) {
        return false
    }
    return db.UserExists(id)
}
```

---

## Bug 19 — Counter Bloom decrement without prior Add

```go
func (c *CBF) Delete(key []byte) {
    h1, h2 := hashes(key)
    for i := uint64(0); i < c.k; i++ {
        pos := (h1 + i*h2) % c.m
        v := c.get(pos)
        if v > 0 {
            c.set(pos, v-1)
        }
    }
}
```

**Bug.** If a key is Deleted that was never Added, the counters for *other* keys at those positions are decremented incorrectly. This can cause false negatives for those other keys.

**Fix.** Always pair Delete with a prior Test. Or maintain external bookkeeping (a `sync.Map[key]presence`) to know which keys are legitimately in the filter.

---

## Bug 20 — Race in Test followed by Add

```go
func (s *Service) FirstSee(k string) bool {
    if !s.filter.TestString(k) {
        s.filter.AddString(k)
        return true
    }
    return false
}
```

**Bug.** Test and Add are not atomic together (even with the wrapper's mutex per call). Two concurrent goroutines can both observe `Test == false` and both Add. Both return true; both `processNew` paths execute.

**Fix.** Lock around the whole Test-and-Add:

```go
func (s *Service) FirstSee(k string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.filter.TestString(k) {
        return false
    }
    s.filter.AddString(k)
    return true
}
```

Or use a higher-level dedup primitive (e.g. `sync.Once` keyed by the key, or a single-flight pattern).

---

## Bonus Bugs

### Bug 21 — Filter not sized for distribution

```go
filter := bloom.NewWithEstimates(1_000_000, 0.01)
for _, url := range urlsFromCrawler { // 5M URLs
    filter.AddString(url)
}
```

**Bug.** 5x oversized. Filter saturates; FPR ≈ 1.0.

**Fix.** Size for expected peak, with margin.

### Bug 22 — Marshal under heavy load without backpressure

```go
func snapshot() {
    data, _ := filter.MarshalBinary() // 200ms during which the mutex is held
    sendOverHTTP(data)
}
```

**Bug.** Snapshot blocks all queries. Latency spikes.

**Fix.** Use a snapshot mechanism that doesn't hold the lock; or quiesce during snapshots; or run snapshots out-of-band.

### Bug 23 — Hot reload of incompatible filter

```go
func reload(path string) error {
    data, _ := os.ReadFile(path)
    fresh := &bloom.BloomFilter{}
    if err := fresh.UnmarshalBinary(data); err != nil { return err }
    globalFilter.Store(fresh) // m and k of fresh may differ from old
    return nil
}
```

**Bug.** The reloaded filter may have different m or k. If callers cache parameters (e.g. for sizing other structures), they break.

**Fix.** Validate that the reloaded filter has expected m and k.

### Bug 24 — Filter cleared instead of rebuilt

```go
filter.ClearAll() // remove all entries
```

**Bug.** `ClearAll` zeros bits, but the filter's m and k are unchanged. If you intended to resize, this doesn't help.

**Fix.** Construct a new filter with the desired size:

```go
filter = bloom.NewWithEstimates(newN, newP)
```

### Bug 25 — `nil` filter check missing

```go
type HotFilter struct {
    f atomic.Pointer[bloom.BloomFilter]
}

func (h *HotFilter) Test(k []byte) bool {
    return h.f.Load().Test(k) // panics if Load returns nil
}
```

**Bug.** If the filter has never been Store'd, Load returns nil, and Test panics on a nil pointer.

**Fix.** Initialise with a non-nil filter at construction or guard the call:

```go
func (h *HotFilter) Test(k []byte) bool {
    f := h.f.Load()
    if f == nil { return false }
    return f.Test(k)
}
```

---

## How to Use This File

Cover each bug snippet with your hand; predict the bug; reveal; check. After each fix, ask: have I shipped this bug? If yes, immediately audit production for it.

The most common bugs in this list (in the author's experience):

1. Missing wrapper (Bug 1).
2. Update filter before truth (Bug 2).
3. Undersized filter (Bug 3).
4. Snapshot under hot mutex (Bug 5).
5. Rebuild during writes (Bug 10).

If your codebase has any of these, fix it first.
