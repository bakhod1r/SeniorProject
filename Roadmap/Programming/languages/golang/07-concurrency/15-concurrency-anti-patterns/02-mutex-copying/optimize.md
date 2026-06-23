---
layout: default
title: Optimize
parent: Mutex Copying
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/optimize/
---

# Mutex Copying — Optimization Scenarios

9 scenarios where code needs to be optimised to reduce mutex contention without changing semantics. Each scenario presents a starting point, an analysis of the bottleneck, and an optimised solution.

The focus here is on *avoiding* contention; the copy-prevention rules from earlier files apply to every refactored version (and many of these refactors incidentally remove copy hazards by switching to pointer types and lock-free primitives).

---

## Scenario 1: Counter under heavy contention

### Starting point

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func (c *Counter) Load() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

### Bottleneck

Every `Inc` and `Load` acquires the mutex. At high throughput (millions of ops/sec), the mutex's fast path saturates a single CPU. CPU profile shows >50% time in Lock/Unlock instructions.

### Optimisation 1: Use atomic.Int64

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()       { c.n.Add(1) }
func (c *Counter) Load() int64 { return c.n.Load() }
```

Atomic operations cost ~5-10 ns; mutex fast path costs ~20 ns under contention. The atomic is also branchless. Throughput typically 2-3x in micro-benchmarks.

### Optimisation 2: Sharded counter for extreme throughput

For >10M Inc/sec across many cores:

```go
type Counter struct {
    shards [numShards]paddedAtomic
}

type paddedAtomic struct {
    n atomic.Int64
    _ [56]byte // pad to 64-byte cache line
}

const numShards = 64

func (c *Counter) Inc() {
    idx := fastrand() % numShards
    c.shards[idx].n.Add(1)
}

func (c *Counter) Load() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].n.Load()
    }
    return sum
}
```

Cache-line padding eliminates false sharing between shards. Inc distributes across shards; Load sums them.

Trade-off: Load is O(N) where N is shard count. For low-frequency reads, fine.

### Measurement

| Implementation | 1 goroutine | 16 goroutines | 256 goroutines |
|----------------|-------------|---------------|----------------|
| Mutex          | 60M ops/s   | 12M ops/s     | 8M ops/s       |
| Atomic         | 200M ops/s  | 100M ops/s    | 70M ops/s      |
| Sharded atomic | 200M ops/s  | 1.6B ops/s    | 2.5B ops/s     |

(Approximate; depends on hardware. Run your own benchmarks.)

---

## Scenario 2: Read-mostly map

### Starting point

```go
type Lookup struct {
    mu   sync.Mutex
    data map[string]int
}

func (l *Lookup) Get(k string) (int, bool) {
    l.mu.Lock()
    defer l.mu.Unlock()
    v, ok := l.data[k]
    return v, ok
}

func (l *Lookup) Set(k string, v int) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.data[k] = v
}
```

### Bottleneck

99% of operations are `Get`. The mutex serialises reads, throttling read throughput.

### Optimisation: switch to RWMutex

```go
type Lookup struct {
    mu   sync.RWMutex
    data map[string]int
}

func (l *Lookup) Get(k string) (int, bool) {
    l.mu.RLock()
    defer l.mu.RUnlock()
    v, ok := l.data[k]
    return v, ok
}

func (l *Lookup) Set(k string, v int) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.data[k] = v
}
```

Reads can proceed concurrently. Throughput improves significantly when readers were the bottleneck.

### Optimisation 2: COW with atomic.Pointer

For workloads with very rare writes (e.g., minute-scale config updates):

```go
type Lookup struct {
    data atomic.Pointer[map[string]int]
    mu   sync.Mutex // protects writers from racing each other
}

func (l *Lookup) Get(k string) (int, bool) {
    m := *l.data.Load()
    v, ok := m[k]
    return v, ok
}

func (l *Lookup) Set(k string, v int) {
    l.mu.Lock()
    defer l.mu.Unlock()
    old := *l.data.Load()
    n := make(map[string]int, len(old)+1)
    for kk, vv := range old {
        n[kk] = vv
    }
    n[k] = v
    l.data.Store(&n)
}
```

Reads are entirely lock-free (one atomic load). Writes are O(n) but rare. Excellent for cache/config use cases.

### Trade-off table

| Pattern | Read cost | Write cost | Memory | When to use |
|---------|-----------|------------|--------|-------------|
| Mutex   | Lock      | Lock       | small  | Balanced |
| RWMutex | RLock     | Lock       | small  | Read-dominant |
| atomic.Pointer COW | 1 atomic | O(n) copy | 2x during write | Read-very-dominant, infrequent writes |

---

## Scenario 3: Reducing critical section size

### Starting point

```go
type RequestLog struct {
    mu      sync.Mutex
    entries []Entry
}

func (r *RequestLog) Record(req Request) {
    r.mu.Lock()
    defer r.mu.Unlock()
    entry := Entry{
        Timestamp: time.Now(),
        ID:        req.ID,
        Body:      processBody(req.Body), // slow
    }
    r.entries = append(r.entries, entry)
    persistToDisk(entry) // VERY slow
}
```

### Bottleneck

`Record` holds the mutex through both `processBody` (which is CPU-heavy) and `persistToDisk` (I/O bound, milliseconds). Contention pile-up under any concurrent load.

### Optimisation: move work outside the critical section

```go
func (r *RequestLog) Record(req Request) {
    entry := Entry{
        Timestamp: time.Now(),
        ID:        req.ID,
        Body:      processBody(req.Body), // OUTSIDE lock
    }
    r.mu.Lock()
    r.entries = append(r.entries, entry)
    r.mu.Unlock()
    persistToDisk(entry) // OUTSIDE lock
}
```

Lock-held time drops from milliseconds to nanoseconds. Throughput rises proportionally.

### Caveats

The order of writes to `r.entries` and `persistToDisk` differs between concurrent callers. If you need consistency (entries persisted in the same order they appear in `r.entries`), additional design is needed (a serialised writer goroutine reading from a channel, for example).

For most "log records to disk" cases, order is not critical and the optimised version is correct.

---

## Scenario 4: Batched updates

### Starting point

```go
type MetricCollector struct {
    mu     sync.Mutex
    counts map[string]int64
}

func (m *MetricCollector) Inc(name string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.counts[name]++
}
```

In a hot path that calls `Inc` thousands of times per request, this is a contention disaster.

### Optimisation: batch increments per goroutine

```go
type MetricCollector struct {
    mu     sync.Mutex
    counts map[string]int64
    pool   sync.Pool
}

type batch map[string]int64

func (m *MetricCollector) NewBatch() batch {
    if b := m.pool.Get(); b != nil {
        return b.(batch)
    }
    return make(batch)
}

func (b batch) Inc(name string) {
    b[name]++
}

func (m *MetricCollector) Flush(b batch) {
    m.mu.Lock()
    for k, v := range b {
        m.counts[k] += v
        delete(b, k)
    }
    m.mu.Unlock()
    m.pool.Put(b)
}
```

Usage:

```go
b := collector.NewBatch()
for _, item := range items {
    b.Inc(item.Category)
}
collector.Flush(b)
```

The hot path inside the loop is map-modification only (no locking). Flush acquires the lock once for the entire batch.

Trade-off: counts in `m.counts` are eventually consistent (only visible after Flush). Most metrics workflows tolerate this.

### When batching helps

- Per-goroutine work generates many small updates.
- Reads of the global state are infrequent or accept eventual consistency.
- Goroutines have a natural "batch boundary" (end of request, end of file, etc.).

---

## Scenario 5: Lock-free shutdown signal

### Starting point

```go
type Service struct {
    mu     sync.Mutex
    closed bool
}

func (s *Service) IsClosed() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.closed
}

func (s *Service) Close() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.closed = true
}
```

Every "is the service still running?" check acquires the mutex. In a tight loop, this is wasted.

### Optimisation: atomic.Bool

```go
type Service struct {
    closed atomic.Bool
}

func (s *Service) IsClosed() bool { return s.closed.Load() }
func (s *Service) Close()         { s.closed.Store(true) }
```

`Load` is ~1 ns; mutex was ~20 ns. Both correct.

### Optimisation 2: context.Context

For cancellation-style signals, a `context.Context` is even better — it composes with channel-select patterns and is the idiomatic Go approach.

```go
type Service struct {
    ctx    context.Context
    cancel context.CancelFunc
}

func NewService() *Service {
    ctx, cancel := context.WithCancel(context.Background())
    return &Service{ctx: ctx, cancel: cancel}
}

func (s *Service) Close() { s.cancel() }
func (s *Service) Done() <-chan struct{} { return s.ctx.Done() }
```

Goroutines select on `s.Done()` and handle cancellation natively.

---

## Scenario 6: Sharded session store

### Starting point

```go
type Sessions struct {
    mu       sync.RWMutex
    sessions map[string]*Session
}
```

At 100k sessions and high concurrency, even RWMutex contention becomes significant.

### Optimisation: shard by session ID hash

```go
type Sessions struct {
    shards [256]*shard
}

type shard struct {
    mu       sync.RWMutex
    sessions map[string]*Session
}

func NewSessions() *Sessions {
    s := &Sessions{}
    for i := range s.shards {
        s.shards[i] = &shard{sessions: make(map[string]*Session)}
    }
    return s
}

func (s *Sessions) shardFor(id string) *shard {
    h := fnv.New32a()
    h.Write([]byte(id))
    return s.shards[h.Sum32()%256]
}

func (s *Sessions) Get(id string) (*Session, bool) {
    sh := s.shardFor(id)
    sh.mu.RLock()
    defer sh.mu.RUnlock()
    sess, ok := sh.sessions[id]
    return sess, ok
}

func (s *Sessions) Set(id string, sess *Session) {
    sh := s.shardFor(id)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    sh.sessions[id] = sess
}
```

Contention is divided across 256 mutexes. Throughput scales nearly linearly with shard count up to the goroutine count.

### Choosing shard count

- Small (<10) shards: easy reasoning, minimal memory overhead, modest concurrency support.
- Medium (32-128) shards: good for most services.
- Large (256-1024) shards: heavy concurrency, multi-core machines.

Power-of-2 shard counts allow `&` masking instead of `%` (faster).

---

## Scenario 7: Object pool to avoid allocation under lock

### Starting point

```go
type Worker struct {
    mu     sync.Mutex
    buffer []byte
}

func (w *Worker) Process(data []byte) []byte {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.buffer = w.buffer[:0]
    w.buffer = append(w.buffer, data...)
    return process(w.buffer)
}
```

The single `buffer` is shared. All Process calls serialise.

### Optimisation: use sync.Pool

```go
var bufferPool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 4096)
        return &b
    },
}

func Process(data []byte) []byte {
    b := bufferPool.Get().(*[]byte)
    defer bufferPool.Put(b)
    *b = (*b)[:0]
    *b = append(*b, data...)
    return process(*b)
}
```

No mutex needed. Each goroutine pulls a buffer from the pool; the pool internally uses per-P buffers and atomic operations for hot paths.

Trade-off: result needs to be copied (or used before the buffer returns to the pool); the pool's buffers are not stable references.

---

## Scenario 8: Avoiding RWMutex inversion

### Starting point

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]Result
}

func (c *Cache) GetOrCompute(k string, compute func() Result) Result {
    c.mu.RLock()
    if v, ok := c.data[k]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()
    c.mu.Lock()
    defer c.mu.Unlock()
    // re-check under write lock
    if v, ok := c.data[k]; ok {
        return v
    }
    v := compute() // SLOW — held under write lock
    c.data[k] = v
    return v
}
```

Compute holds the write lock; readers wait. If compute is slow, readers stall.

### Optimisation: singleflight pattern

```go
import "golang.org/x/sync/singleflight"

type Cache struct {
    mu   sync.RWMutex
    data map[string]Result
    sf   singleflight.Group
}

func (c *Cache) GetOrCompute(k string, compute func() Result) Result {
    c.mu.RLock()
    if v, ok := c.data[k]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()

    v, _, _ := c.sf.Do(k, func() (any, error) {
        result := compute()
        c.mu.Lock()
        c.data[k] = result
        c.mu.Unlock()
        return result, nil
    })
    return v.(Result)
}
```

`singleflight.Group` ensures only one goroutine computes per key; others wait for the result. Crucially, the write lock is held only briefly to insert the result, not during compute.

Readers proceed concurrently while compute is in flight (they get RLock).

---

## Scenario 9: Avoiding lock-on-read for immutable data

### Starting point

```go
type Config struct {
    mu sync.RWMutex
    // ... many fields ...
}

func (c *Config) GetTimeout() time.Duration {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.timeout
}
```

If `c.timeout` is set once at startup and never changes, the RLock is wasted.

### Optimisation: separate immutable from mutable

```go
type Config struct {
    // Set once during startup. No lock required.
    timeout time.Duration
    addr    string

    // Mutable; protected by mu.
    mu      sync.RWMutex
    refresh time.Time
    stats   Stats
}

func (c *Config) GetTimeout() time.Duration { return c.timeout } // no lock
```

Document the invariant: fields above the `mu` line are immutable after construction; fields below require the lock. Build the contract in the type definition.

### Strict alternative: split the type

```go
type ImmutableConfig struct {
    Timeout time.Duration
    Addr    string
}

type MutableState struct {
    mu      sync.RWMutex
    refresh time.Time
    stats   Stats
}

type Service struct {
    Config *ImmutableConfig
    State  *MutableState
}
```

The split makes the immutability mechanical: `Config` has no mutex; you cannot accidentally read it under a lock that doesn't exist.

---

## General optimisation principles

1. **Measure first.** Profile mutex contention before optimising. Don't optimise locks that don't appear in the profile.

2. **Reduce hold time.** Move work outside the critical section. This is almost always the highest-impact change.

3. **Reduce lock frequency.** Batch operations. Use thread-local accumulators flushed periodically.

4. **Increase concurrency.** Shard the data. Use RWMutex if reads dominate.

5. **Eliminate the mutex.** Use atomics, COW, or actor model.

6. **Avoid premature pessimisation.** Don't shard a lock that isn't contended. Don't switch to atomic.Pointer for a balanced workload. Measure.

7. **Preserve correctness.** Every optimisation must preserve the program's correctness contract. Many copy-related bugs in the wild were introduced during attempts to optimise.

8. **Document the change.** Future maintainers should know why the code uses sharding/COW/atomics. Without the context, they may "simplify" back to the slow version.

9. **Watch out for copy bugs.** Many of these optimisations involve switching to pointer types or lock-free structures. The same vet-driven discipline applies — `noCopy` markers, pointer receivers, vet in CI.

10. **Avoid distributed locks.** Use in-process locking when in-process suffices. Distributed locking introduces a separate class of failure modes.

---

## Summary

Optimisation table:

| Original | Optimised | Trigger |
|----------|-----------|---------|
| Mutex-protected counter | atomic.Int64 | Profile shows mutex hot |
| Mutex map | RWMutex map | Read-heavy workload |
| RWMutex map | atomic.Pointer COW | Very read-heavy, rare writes |
| Single mutex | Sharded mutexes | Contention at high concurrency |
| Wide critical section | Narrow critical section + outside-lock work | Slow operations under lock |
| Per-operation lock | Per-batch lock | High-frequency updates |
| Lock-protected flag | atomic.Bool or context.Context | Lock-on-read in hot path |
| Lock-protected pool | sync.Pool | Object allocation under lock |
| Cache-miss-recomputes-under-lock | singleflight | Slow compute under lock |
| Lock for immutable fields | No lock (split types or document) | Fields never change |

Apply these in order of profile-driven evidence. Always benchmark before and after. Always verify with vet and -race.
