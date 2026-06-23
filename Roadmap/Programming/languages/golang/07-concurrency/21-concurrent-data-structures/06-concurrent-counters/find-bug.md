---
layout: default
title: Find the Bug
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/find-bug/
---

# Concurrent Counters — Find the Bug

Each snippet has at least one bug. Find them. Explain. Fix.

---

## Bug 1: The classic

```go
var count int
for i := 0; i < 1000; i++ {
    go func() {
        count++
    }()
}
time.Sleep(time.Second)
fmt.Println(count)
```

**Bug**: `count++` is non-atomic; concurrent writes lose updates. Also `time.Sleep` is unreliable synchronisation.

**Fix**: Use `atomic.Int64` and `sync.WaitGroup`.

---

## Bug 2: The mutex that doesn't help

```go
var (
    mu    sync.Mutex
    count int64
)

func Inc() {
    mu.Lock()
    atomic.AddInt64(&count, 1)
    mu.Unlock()
}

func Get() int64 {
    return count // direct read
}
```

**Bug**: The mutex around the atomic is redundant. The direct read in `Get` is a race (counter is written atomically; read non-atomically).

**Fix**: Drop the mutex. Use `atomic.LoadInt64(&count)` in Get.

---

## Bug 3: Lost increments on reset

```go
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Reset() int64 {
    v := c.v.Load()
    c.v.Store(0)
    return v
}
```

**Bug**: Between `Load` and `Store`, concurrent increments are lost (they happen, but are overwritten by the Store(0)).

**Fix**: Use `c.v.Swap(0)`.

---

## Bug 4: Copy of atomic

```go
type Stats struct {
    Requests atomic.Int64
}

func makeStats() Stats {
    var s Stats
    return s
}

func use() {
    s := makeStats() // copy on return
    s.Requests.Add(1)
}
```

**Bug**: Returning `Stats` by value copies the atomic. `go vet` flags this. Even though no race happens here (each copy is independent), the design is broken if `Stats` is meant to be shared.

**Fix**: Return `*Stats`. Document with `noCopy` marker if desired.

---

## Bug 5: Gauge without defer

```go
func handler(w http.ResponseWriter, r *http.Request) {
    inflight.Add(1)
    process(r)
    inflight.Add(-1)
}
```

**Bug**: If `process(r)` panics, `inflight` is never decremented. The gauge slowly grows forever.

**Fix**: Use `defer inflight.Add(-1)`.

---

## Bug 6: Alignment on 32-bit ARM

```go
type Stats struct {
    Name    string
    Count   int64 // not 64-bit aligned on 32-bit platforms!
}

func (s *Stats) Inc() {
    atomic.AddInt64(&s.Count, 1) // panic on 32-bit ARM
}
```

**Bug**: `Count` may not be 64-bit aligned; `atomic.AddInt64` panics on 32-bit ARM.

**Fix**: Put `Count` first in the struct (auto-aligned to 8 bytes), or use `atomic.Int64` (handles alignment).

---

## Bug 7: Sloppy counter without flush

```go
type Sloppy struct {
    global atomic.Int64
}

type Local struct {
    n int64
    parent *Sloppy
}

func (l *Local) Inc() {
    l.n++
    if l.n >= 1024 {
        l.parent.global.Add(l.n)
        l.n = 0
    }
}

// Worker
func worker(s *Sloppy) {
    local := &Local{parent: s}
    for j := range jobs {
        local.Inc()
        process(j)
    }
    // Missing flush!
}
```

**Bug**: When the worker exits, any local count below 1024 is lost.

**Fix**: `defer local.Flush()` where `Flush()` adds `l.n` to global and resets to 0.

---

## Bug 8: Sharded counter with false sharing

```go
type Sharded struct {
    cells [64]atomic.Int64
}

func (s *Sharded) Inc() {
    s.cells[rand.IntN(64)].Add(1)
}
```

**Bug**: Cells are packed without padding; 8 cells per 64-byte cache line. Cores writing to "different" cells still contend on the same line.

**Fix**: Pad cells with `cpu.CacheLinePad`.

---

## Bug 9: CAS loop without retry

```go
func (m *Max) Observe(x int64) {
    cur := m.v.Load()
    if x > cur {
        m.v.CompareAndSwap(cur, x) // ignores result
    }
}
```

**Bug**: If the CAS fails (someone else updated), the new max is lost.

**Fix**: Wrap in a `for` loop that retries on CAS failure.

---

## Bug 10: Map of atomics without lock

```go
var counters = make(map[string]*atomic.Int64)

func Inc(key string) {
    if _, ok := counters[key]; !ok {
        counters[key] = &atomic.Int64{}
    }
    counters[key].Add(1)
}
```

**Bug**: Concurrent reads and writes to the map are not safe; can crash with "concurrent map writes" panic.

**Fix**: Use `sync.Map` with `LoadOrStore`, or wrap with `sync.RWMutex`.

---

## Bug 11: `expvar.Int.Set` instead of `Add`

```go
var counter = expvar.NewInt("requests")

func handler(...) {
    counter.Set(counter.Value() + 1) // BUG
}
```

**Bug**: `Set` is `atomic.Store`; the `Value() + 1` calculation is not atomic with the Set. Two goroutines can both see Value() = 5, both Set(6), losing one increment.

**Fix**: `counter.Add(1)`.

---

## Bug 12: Snapshot via multiple Loads

```go
type Stats struct {
    Requests atomic.Int64
    Errors   atomic.Int64
}

func (s *Stats) Snapshot() (int64, int64) {
    return s.Requests.Load(), s.Errors.Load() // not atomic together
}
```

**Bug**: Between the two `Load` calls, the values may change. The snapshot is not coherent.

**Fix**: Use `atomic.Pointer[Snapshot]` with a publisher pattern, or accept the slight inconsistency for monitoring.

---

## Bug 13: `Add(-1)` on `atomic.Uint64`

```go
var inflight atomic.Uint64

func release() {
    inflight.Add(^uint64(0)) // intended: decrement by 1
}
```

**Bug**: `Add(^uint64(0))` does subtract 1 via two's complement, but it's cryptic and easy to misread. If the counter is currently 0, it underflows to maxUint64 — a gauge gone wrong.

**Fix**: Use `atomic.Int64` which supports `Add(-1)` directly.

---

## Bug 14: Cardinality bomb

```go
var requests = expvar.NewMap("requests")

func handler(w http.ResponseWriter, r *http.Request) {
    requests.Add(r.URL.Path, 1) // r.URL.Path is unbounded
}
```

**Bug**: Each unique URL path creates a new map entry. Memory grows unboundedly with attacker-controlled or unique URLs.

**Fix**: Bucket the path (e.g., to a known set of routes via a router). Or impose a cardinality limit.

---

## Bug 15: Histogram with too-small range

```go
h := hdrhistogram.New(1, 1_000_000, 3) // up to 1M nanos = 1 ms

func observe(d time.Duration) {
    h.RecordValue(d.Nanoseconds()) // values > 1ms are clamped
}
```

**Bug**: Latencies over 1 ms are clamped to the maximum bucket. Tail latency reporting is wrong.

**Fix**: Increase the upper bound (e.g., `60_000_000_000` for 60 seconds).

---

## Bug 16: Goroutine-per-shard

```go
type Counter struct {
    cells [64]int64
}

func (c *Counter) Inc(shard int) {
    c.cells[shard]++ // raw increment, no atomic
}
```

**Bug**: The fields are not atomic. Even though each goroutine "owns" a shard, the reader summing all shards may see torn values.

**Fix**: Use `[64]atomic.Int64`.

---

## Bug 17: Reading sharded counter wrong

```go
type Sharded struct {
    cells [64]atomic.Int64
}

func (s *Sharded) Get() int64 {
    var total int64
    for i := 0; i < len(s.cells); i++ {
        total += int64(s.cells[i]) // direct cast, not atomic
    }
    return total
}
```

**Bug**: Direct cast of an `atomic.Int64` to `int64` is a compile error (good!) — but if the code uses `unsafe.Pointer` to bypass, it would be a race.

**Fix**: Use `s.cells[i].Load()`.

---

## Bug 18: Snapshot reset race

```go
func (s *Sharded) Reset() int64 {
    total := s.Get()
    for i := range s.cells {
        s.cells[i].Store(0)
    }
    return total
}
```

**Bug**: Between `Get()` and the `Store(0)` loop, concurrent increments may land in shards already counted but about to be zeroed — they are lost.

**Fix**: Use `Swap(0)` per shard:
```go
func (s *Sharded) Reset() int64 {
    var total int64
    for i := range s.cells {
        total += s.cells[i].Swap(0)
    }
    return total
}
```

---

## Bug 19: Per-P counter without `procPin`

```go
type PerP struct {
    cells []atomic.Int64
}

func (p *PerP) Inc() {
    pid := getCurrentP() // somehow
    p.cells[pid].Add(1)
}
```

**Bug**: Between `getCurrentP()` and `cells[pid].Add(1)`, the goroutine may be preempted and rescheduled on a different P. The increment may go to the "wrong" shard.

**Fix**: Use `runtime_procPin`/`runtime_procUnpin` to prevent preemption during the increment.

---

## Bug 20: Histogram observation in parallel goroutines

```go
var h = hdrhistogram.New(1, 60_000_000_000, 3)

func observe(d time.Duration) {
    h.RecordValue(d.Nanoseconds()) // racy if h is not thread-safe
}
```

**Bug**: The `hdrhistogram-go` `RecordValue` is not safe for concurrent use from multiple goroutines.

**Fix**: Wrap with a mutex, or use sharded HDR histograms each with its own mutex.

---

## End

If you fixed all 20, you have solid counter intuition.

Many of these bugs are silent — they do not crash, they just produce wrong numbers. The race detector catches some; profiling reveals others; production reveals the rest.

The discipline: assume your counter is wrong until tested with `-race` and benchmarked across cores.

End.

---

## More Bugs to Find

### Bug 21: Counter wrap

```go
var requests atomic.Int32

func handler(...) {
    requests.Add(1)
    if requests.Load() < 0 {
        log.Fatal("counter overflow")
    }
}
```

**Bug**: After ~2.1B requests, `int32` wraps to negative. The check fires but only after a real overflow.

**Fix**: Use `atomic.Int64`. Practically never overflows.

---

### Bug 22: Per-P with changing GOMAXPROCS

```go
type PerP struct {
    cells []atomic.Int64
}

func New() *PerP {
    return &PerP{cells: make([]atomic.Int64, runtime.GOMAXPROCS(0))}
}

func (p *PerP) Inc() {
    pid := runtime_procPin()
    p.cells[pid].Add(1) // panic if GOMAXPROCS grew
    runtime_procUnpin()
}
```

**Bug**: If `GOMAXPROCS` grows after `New`, `pid` can be >= `len(cells)`, panicking.

**Fix**: Modulo `len(cells)` or resize cells lazily.

---

### Bug 23: Histogram with negative observations

```go
func observe(d time.Duration) {
    h.RecordValue(d.Nanoseconds()) // d may be negative due to clock skew
}
```

**Bug**: HDR drops negative observations silently. The dropped values are not counted at all (not even at the lowest bucket).

**Fix**: Clamp to 0 before recording. Or use `time.Since` carefully — never subtract two arbitrary timestamps.

---

### Bug 24: Counter that uses the wrong sync primitive

```go
type Counter struct {
    once sync.Once
    v    int64
}

func (c *Counter) Inc() {
    c.once.Do(func() {
        c.v++
    })
}
```

**Bug**: `sync.Once` runs the function exactly once. After the first call, all subsequent `Inc()` calls do nothing. The counter never gets past 1.

**Fix**: Remove `sync.Once`. Use `atomic.Int64`.

---

### Bug 25: Double-flush sloppy counter

```go
type Local struct {
    n int64
    parent *Sloppy
}

func (l *Local) Inc() {
    l.n++
    if l.n >= 1024 {
        l.parent.global.Add(l.n)
        // Forgot to reset!
    }
}
```

**Bug**: After flushing, `l.n` is not reset. Every subsequent `Inc` triggers another flush of an ever-growing local.

**Fix**: `l.n = 0` after the global add.

---

### Bug 26: Counter that triggers an alert on every increment

```go
func (c *Counter) Inc() {
    if c.v.Add(1) > c.threshold {
        sendAlert("counter high!") // every call after threshold
    }
}
```

**Bug**: Alerts are sent on every increment past the threshold. Alert spam.

**Fix**: Send the alert only once (use `CompareAndSwap` on a separate `sent` flag), or rate-limit.

---

### Bug 27: Counter in a method value receiver

```go
type Counter struct {
    v atomic.Int64
}

func (c Counter) Inc() { // value receiver!
    c.v.Add(1)
}
```

**Bug**: The receiver is a copy. Each call increments a fresh atomic that is then discarded.

**Fix**: Use pointer receiver `func (c *Counter) Inc()`.

---

### Bug 28: `expvar.NewInt` called in a loop

```go
func handler(...) {
    counter := expvar.NewInt("request_count") // panics on second call
    counter.Add(1)
}
```

**Bug**: `expvar.NewInt` panics if the name is already registered. Second handler invocation panics.

**Fix**: Move `expvar.NewInt` to package init. Use the package-level variable in the handler.

---

### Bug 29: Race between Get and Add

```go
type Counter struct { v atomic.Int64 }

func (c *Counter) Add(n int64) { c.v.Add(n) }

func (c *Counter) Get() int64 { return c.v.Load() }

func snapshot() (int64, int64) {
    a := counterA.Get()
    b := counterB.Get()
    return a, b // a and b may not be from the same instant
}
```

**Bug**: Two separate `Get` calls; counters may change between them. The snapshot is not coherent.

**Fix**: Acceptable for monitoring; use `atomic.Pointer[Snapshot]` for coherent multi-counter reads.

---

### Bug 30: Histogram quantile from a single shard

```go
type ShardedHist struct {
    shards []*hdrhistogram.Histogram
}

func (s *ShardedHist) Quantile(q float64) int64 {
    return s.shards[0].ValueAtQuantile(q * 100) // BUG
}
```

**Bug**: Returns the quantile of one shard, not the merged histogram. Shard 0 may have very different distribution than the whole.

**Fix**: Merge all shards before computing quantile.

---

## Closing Bug Wisdom

Counter bugs are mostly silent. They produce wrong numbers, not crashes. The discipline:

- Run `-race` on every test.
- Benchmark scaling with `-cpu`.
- Verify after every code change.
- Audit periodically.
- Document the contention model.

Wrong counters mislead operators. Misled operators mismanage incidents. Counter quality is operational quality.

End.

