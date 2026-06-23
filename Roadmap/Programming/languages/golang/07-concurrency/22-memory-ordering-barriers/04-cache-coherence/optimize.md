---
layout: default
title: Cache Coherence — Optimize
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/optimize/
---

# Cache Coherence — Optimization Exercises

A set of code snippets that "work" but are sub-optimal. Optimize each for cache coherence and measure the improvement.

---

## Exercise 1: A Slow Counter

**Before:**

```go
var counter atomic.Int64

func bump() { counter.Add(1) }
```

Used from 32 goroutines.

**Task:** Optimize for linear scaling.

**Optimized:**

```go
type Counter struct {
    shards []paddedInt64
    mask   uint64
}

type paddedInt64 struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

func New() *Counter {
    n := nextPow2(runtime.NumCPU())
    return &Counter{shards: make([]paddedInt64, n), mask: uint64(n - 1)}
}

func (c *Counter) Bump(hint uint64) { c.shards[hint&c.mask].v.Add(1) }

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards { s += c.shards[i].v.Load() }
    return s
}
```

**Expected improvement:** ~30× throughput at 32 goroutines.

---

## Exercise 2: Adjacent Counters

**Before:**

```go
type Stats struct {
    Hits   atomic.Int64
    Misses atomic.Int64
}
```

**Task:** Eliminate false sharing.

**Optimized:**

```go
type Stats struct {
    Hits   atomic.Int64
    _      cpu.CacheLinePad
    Misses atomic.Int64
    _      cpu.CacheLinePad
}
```

**Expected improvement:** 2-5× when accessed concurrently from different cores.

---

## Exercise 3: Read-Heavy Config

**Before:**

```go
var mu sync.RWMutex
var config Config

func get() Config {
    mu.RLock()
    defer mu.RUnlock()
    return config
}

func set(c Config) {
    mu.Lock()
    config = c
    mu.Unlock()
}
```

**Task:** Make reads cheaper.

**Optimized:**

```go
var config atomic.Pointer[Config]

func get() *Config { return config.Load() }
func set(c *Config) { config.Store(c) }
```

**Expected improvement:** Reads go from ~200 ns (RWMutex overhead) to ~1 ns (atomic load).

---

## Exercise 4: Mutex Slice

**Before:**

```go
var locks [256]sync.Mutex

func lock(i int) func() {
    locks[i].Lock()
    return locks[i].Unlock
}
```

**Task:** Eliminate false sharing among locks.

**Optimized:**

```go
type lockShard struct {
    mu sync.Mutex
    _  cpu.CacheLinePad
}

var locks [256]lockShard

func lock(i int) func() {
    locks[i].mu.Lock()
    return locks[i].mu.Unlock
}
```

**Expected improvement:** Independent locks act independently; no inter-mutex contention.

---

## Exercise 5: Histogram

**Before:**

```go
type Histogram struct {
    Buckets [16]int64
}

func (h *Histogram) Observe(v float64) {
    idx := bucketIndex(v)
    atomic.AddInt64(&h.Buckets[idx], 1)
}
```

**Task:** Scale to many cores.

**Optimized:** Per-CPU histograms:

```go
type Histogram struct {
    shards []histShard
}

type histShard struct {
    buckets [16]atomic.Int64
    _       cpu.CacheLinePad
}

func New() *Histogram {
    return &Histogram{shards: make([]histShard, runtime.NumCPU())}
}

func (h *Histogram) Observe(hint uint64, v float64) {
    idx := bucketIndex(v)
    h.shards[hint%uint64(len(h.shards))].buckets[idx].Add(1)
}

func (h *Histogram) Snapshot() [16]int64 {
    var total [16]int64
    for i := range h.shards {
        for j := range total {
            total[j] += h.shards[i].buckets[j].Load()
        }
    }
    return total
}
```

**Expected improvement:** 10× throughput at 16 cores.

---

## Exercise 6: Worker Pool with Shared Channel

**Before:**

```go
jobs := make(chan Job, 1000)
for i := 0; i < 64; i++ {
    go worker(jobs)
}
```

**Task:** Eliminate channel contention.

**Optimized:**

```go
const shards = 8
chans := make([]chan Job, shards)
for i := range chans { chans[i] = make(chan Job, 1000) }
for i := 0; i < 64; i++ {
    go worker(chans[i%shards])
}

func submit(j Job, hint uint64) {
    chans[hint%shards] <- j
}
```

**Expected improvement:** 5× throughput with 8 shards.

---

## Exercise 7: Hot Field Adjacent to Mutex

**Before:**

```go
type Counter struct {
    mu    sync.Mutex
    value int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.value++
    c.mu.Unlock()
}
```

**Task:** Eliminate the mutex (since the field is small and atomic suffices).

**Optimized:**

```go
type Counter struct {
    value atomic.Int64
}

func (c *Counter) Inc() { c.value.Add(1) }
```

**Expected improvement:** ~10× throughput (no mutex overhead).

---

## Exercise 8: Allocation-Heavy Buffer

**Before:**

```go
func process(data []byte) []byte {
    buf := make([]byte, 4096)
    // ... use buf
    return result
}
```

Called frequently.

**Task:** Reduce allocation pressure.

**Optimized:**

```go
var bufPool = sync.Pool{
    New: func() interface{} { return make([]byte, 4096) },
}

func process(data []byte) []byte {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf[:cap(buf)])
    // ... use buf
    return result
}
```

**Expected improvement:** Major GC pressure reduction; throughput up 20-50% in alloc-heavy workloads.

---

## Exercise 9: Per-Request Logger

**Before:**

```go
var logger = log.New(os.Stdout, "", log.LstdFlags)

func handle() {
    logger.Println("request handled")
}
```

Called at 100k RPS.

**Task:** Reduce mutex contention on stdout.

**Optimized:** Per-goroutine buffered logging:

```go
type Logger struct {
    buffers sync.Pool
    out     io.Writer
}

// per call: borrow buffer, write into it, flush periodically.
```

(Implementation detail varies; the point is to avoid the global lock.)

**Expected improvement:** 5-10× log throughput.

---

## Exercise 10: SPSC Queue with Shared Indices

**Before:**

```go
type Queue struct {
    write uint64
    read  uint64
    buf   [N]Item
}
```

**Task:** Eliminate index false sharing.

**Optimized:**

```go
type Queue struct {
    write atomic.Uint64
    _     cpu.CacheLinePad
    read  atomic.Uint64
    _     cpu.CacheLinePad
    buf   [N]Item
}
```

For maximum throughput, also cache other-side indices:

```go
type Queue struct {
    write       atomic.Uint64
    cachedRead  uint64
    _           cpu.CacheLinePad
    read        atomic.Uint64
    cachedWrite uint64
    _           cpu.CacheLinePad
    buf         [N]Item
}
```

**Expected improvement:** 2-3× throughput.

---

## Exercise 11: Reference Counter

**Before:**

```go
type Resource struct {
    refs int64
    data []byte
}
```

**Task:** Pad refs to avoid invalidating data's header.

**Optimized:**

```go
type Resource struct {
    refs atomic.Int64
    _    cpu.CacheLinePad
    data []byte
}
```

**Expected improvement:** Modest, but real when data is read frequently and refs is incremented.

---

## Exercise 12: A Stat Slice

**Before:**

```go
type Stat struct {
    Count int64
    Name  string
}
stats := make([]Stat, 100)
```

Concurrent updates to Count on different Stats.

**Task:** Pad each Stat.

**Optimized:**

```go
type Stat struct {
    Count int64
    Name  string
    _     [40]byte
}
```

Each Stat is now 64 bytes.

**Expected improvement:** 3-5× throughput.

---

## Exercise 13: Spin Loop

**Before:**

```go
for !atomic.CompareAndSwapUint32(&lock, 0, 1) {
    // spin
}
```

**Task:** Reduce coherence pressure during spin.

**Optimized:** Test-then-CAS:

```go
for {
    if atomic.CompareAndSwapUint32(&lock, 0, 1) {
        return
    }
    for atomic.LoadUint32(&lock) != 0 {
        runtime.Gosched()
    }
}
```

The inner loop reads (no invalidation); only CAS when there's a chance.

**Expected improvement:** Under contention, dramatically reduces wasted coherence.

---

## Exercise 14: Per-Goroutine Random

**Before:**

```go
func random() int { return rand.Intn(100) }
```

Called from many goroutines. `math/rand`'s default source has a mutex.

**Task:** Use per-goroutine random:

```go
type localRand struct {
    rng *rand.Rand
}

var localRandPool = sync.Pool{
    New: func() interface{} {
        return &localRand{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
    },
}

func random() int {
    lr := localRandPool.Get().(*localRand)
    defer localRandPool.Put(lr)
    return lr.rng.Intn(100)
}
```

**Expected improvement:** Eliminates rand's global mutex.

---

## Exercise 15: Hot Field in Cold Struct

**Before:**

```go
type Service struct {
    Name      string
    Address   string
    Requests  atomic.Int64
    Errors    atomic.Int64
    Config    *Config
    StartTime time.Time
}
```

Requests and Errors are hot; the rest is cold.

**Task:** Hot/cold split.

**Optimized:**

```go
type Service struct {
    Requests atomic.Int64
    _        cpu.CacheLinePad
    Errors   atomic.Int64
    _        cpu.CacheLinePad

    Name      string
    Address   string
    Config    *Config
    StartTime time.Time
}
```

**Expected improvement:** Major win if Requests/Errors are heavily contended.

---

## Exercise 16: Sharded Counter without Padding

**Before:**

```go
shards := make([]atomic.Int64, runtime.NumCPU())
```

**Task:** Add padding to each shard.

**Optimized:**

```go
type slot struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}
shards := make([]slot, runtime.NumCPU())
```

**Expected improvement:** Eliminates inter-shard false sharing.

---

## Exercise 17: A Single Atomic Read in a Loop

**Before:**

```go
for !done.Load() {
    process()
}
```

**Task:** Reduce coherence reads.

**Optimized:** Read locally:

```go
for {
    if done.Load() { break }
    // process many items
    for i := 0; i < batchSize; i++ {
        process()
    }
}
```

The done flag is read once per batch instead of once per item. Coherence reads drop by `batchSize`.

**Expected improvement:** Significant for short `process()` calls.

---

## Exercise 18: An RWMutex Hotspot

**Before:**

```go
var mu sync.RWMutex
var data Data

func read() Data {
    mu.RLock()
    defer mu.RUnlock()
    return data
}
```

64 concurrent readers, rare writers.

**Task:** Replace with snapshot pointer:

```go
var data atomic.Pointer[Data]

func read() *Data { return data.Load() }
func write(d *Data) { data.Store(d) }
```

**Expected improvement:** ~50× reads/sec.

---

## Exercise 19: A Slice of Structs with Atomic Fields

**Before:**

```go
type Item struct {
    Counter int64
}
items := make([]Item, 100)
```

**Task:** Pad each Item to a cache line.

**Optimized:**

```go
type Item struct {
    Counter atomic.Int64
    _       cpu.CacheLinePad
}
items := make([]Item, 100)
```

---

## Exercise 20: A Reference Implementation

Combine many of the above into a single optimized library and benchmark it against a naïve version. Compute the cost savings.

---

## Summary

Twenty optimization exercises. Each demonstrates a specific cache-coherence improvement with measurable impact. Apply them to your own codebase, one by one.

The pattern: identify the contended structure, apply the right pattern (pad, shard, snapshot), measure, document.

End of optimize.md.
