---
layout: default
title: Optimize
parent: Acquire Release
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/02-acquire-release/optimize/
---

# Acquire / Release — Optimization Exercises

Optimization problems involving acquire/release semantics. Each presents a working but suboptimal implementation; your task is to make it faster while preserving correctness.

## Optimization 1: Replace mutex with atomic for read-mostly state

**Original:**

```go
type Config struct {
    mu sync.Mutex
    v  *Settings
}

func (c *Config) Get() *Settings {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.v
}

func (c *Config) Set(s *Settings) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.v = s
}
```

Reads contend on the mutex.

**Optimized:**

```go
type Config struct {
    v atomic.Pointer[Settings]
}

func (c *Config) Get() *Settings { return c.v.Load() }
func (c *Config) Set(s *Settings) { c.v.Store(s) }
```

Reads are wait-free. Writes are atomic. ~10x faster for reads under contention.

---

## Optimization 2: Sharded counter

**Original:**

```go
var counter atomic.Int64

func Inc() { counter.Add(1) }
```

At 16 cores: cache-line bouncing dominates.

**Optimized:**

```go
type ShardedCounter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    n atomic.Int64
    _ [56]byte
}

func (c *ShardedCounter) Inc() {
    idx := getProcID() % uint64(len(c.shards))
    c.shards[idx].n.Add(1)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].n.Load()
    }
    return s
}
```

Inc scales linearly with cores. Sum is O(shards), but called rarely.

---

## Optimization 3: Lazy init with double-checked load

**Original:**

```go
var (
    mu       sync.Mutex
    instance *Service
)

func Get() *Service {
    mu.Lock()
    defer mu.Unlock()
    if instance == nil {
        instance = newService()
    }
    return instance
}
```

Every call takes the mutex, even after init.

**Optimized:** use `sync.Once` (which uses DCL internally):

```go
var (
    once     sync.Once
    instance *Service
)

func Get() *Service {
    once.Do(func() { instance = newService() })
    return instance
}
```

After the first call, subsequent calls are wait-free.

Or use `sync.OnceValue` (Go 1.21+):

```go
var Get = sync.OnceValue(newService)
```

---

## Optimization 4: Single-flight de-duplication

**Original:**

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Cache) Get(k string, fetch func() string) string {
    c.mu.Lock()
    if v, ok := c.m[k]; ok {
        c.mu.Unlock()
        return v
    }
    c.mu.Unlock()
    
    v := fetch() // 100 goroutines all fetch concurrently
    
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
    return v
}
```

100 concurrent misses → 100 upstream fetches.

**Optimized:** use `golang.org/x/sync/singleflight`:

```go
var sf singleflight.Group

func (c *Cache) Get(k string, fetch func() string) string {
    if v, ok := c.cached.Load(k); ok {
        return v.(string)
    }
    v, _, _ := sf.Do(k, func() (any, error) {
        return fetch(), nil
    })
    c.cached.Store(k, v)
    return v.(string)
}
```

(Where `cached` is a `sync.Map`.) Now 100 concurrent misses → 1 upstream fetch.

---

## Optimization 5: Replace channel with atomic flag

**Original:**

```go
type Server struct {
    stop chan struct{}
}

func (s *Server) IsStopped() bool {
    select {
    case <-s.stop:
        return true
    default:
        return false
    }
}
```

Each IsStopped does a select; slow for hot-path checks.

**Optimized:** use an atomic bool:

```go
type Server struct {
    stop chan struct{}
    stopped atomic.Bool
}

func (s *Server) Stop() {
    if s.stopped.CompareAndSwap(false, true) {
        close(s.stop)
    }
}

func (s *Server) IsStopped() bool {
    return s.stopped.Load()
}
```

`IsStopped` is now ~1 ns.

---

## Optimization 6: Read-mostly map

**Original:**

```go
var (
    mu sync.RWMutex
    m  = map[string]int{}
)

func Get(k string) (int, bool) {
    mu.RLock()
    defer mu.RUnlock()
    v, ok := m[k]
    return v, ok
}
```

RLock costs ~15-30 ns.

**Optimized:** if reads dominate writes, use `atomic.Pointer[map[string]int]`:

```go
var data atomic.Pointer[map[string]int]

func Get(k string) (int, bool) {
    m := data.Load()
    if m == nil { return 0, false }
    v, ok := (*m)[k]
    return v, ok
}
```

Reads are now ~1 ns. Writes copy + replace.

---

## Optimization 7: Avoid mutex in hot path

**Original:**

```go
type Limiter struct {
    mu     sync.Mutex
    tokens int
}

func (l *Limiter) Take() bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    if l.tokens > 0 {
        l.tokens--
        return true
    }
    return false
}
```

Every Take takes the mutex.

**Optimized:** use atomic:

```go
type Limiter struct {
    tokens atomic.Int64
}

func (l *Limiter) Take() bool {
    for {
        cur := l.tokens.Load()
        if cur <= 0 {
            return false
        }
        if l.tokens.CompareAndSwap(cur, cur-1) {
            return true
        }
    }
}
```

Wait-free fast path; lock-free retry on contention.

---

## Optimization 8: Batch atomic increments

**Original:**

```go
for i := 0; i < 1000; i++ {
    counter.Add(1)
}
```

1000 atomic operations.

**Optimized:**

```go
counter.Add(1000)
```

One atomic operation. Each Add costs ~5 ns; saving 4995 ns per batch.

---

## Optimization 9: Pre-allocate to reduce GC

**Original:**

```go
func process(items []Item) {
    var results []Result
    for _, item := range items {
        results = append(results, handle(item))
    }
    publish(results)
}
```

Each append may cause re-allocation.

**Optimized:**

```go
results := make([]Result, 0, len(items))
for _, item := range items {
    results = append(results, handle(item))
}
```

Pre-allocated capacity avoids reallocations.

---

## Optimization 10: Reduce false sharing

**Original:**

```go
type Counters struct {
    a atomic.Int64
    b atomic.Int64
    c atomic.Int64
    d atomic.Int64
}
```

All four counters likely share a cache line. Concurrent writes to a and b contend.

**Optimized:**

```go
type Counters struct {
    a atomic.Int64
    _ [56]byte
    b atomic.Int64
    _ [56]byte
    c atomic.Int64
    _ [56]byte
    d atomic.Int64
    _ [56]byte
}
```

Each counter in its own cache line. Writes don't invalidate each other's caches.

---

## Optimization 11: Replace channel with semaphore for bounding

**Original:**

```go
sem := make(chan struct{}, 10)

func work() {
    sem <- struct{}{}
    defer func() { <-sem }()
    doWork()
}
```

Channel operations cost ~100-300 ns each.

**Optimized:** use `golang.org/x/sync/semaphore.Weighted`:

```go
var sem = semaphore.NewWeighted(10)

func work(ctx context.Context) error {
    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer sem.Release(1)
    doWork()
    return nil
}
```

Semaphore is typically faster than channel-as-semaphore due to optimized internals.

---

## Optimization 12: Avoid `sync.Pool` for simple values

**Original:**

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func process(data []byte) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.Write(data)
    return buf.Bytes()
}
```

For tiny operations, the Pool overhead may exceed allocation cost.

**Optimized:** measure. If allocation isn't the bottleneck, just allocate:

```go
func process(data []byte) []byte {
    var buf bytes.Buffer
    buf.Write(data)
    return buf.Bytes()
}
```

`sync.Pool` is for *large* objects or *frequent* allocations. Profile before adopting.

---

## Optimization 13: Use `atomic.Pointer[T]` over `atomic.Value`

**Original:**

```go
var v atomic.Value

func Set(c *Config) { v.Store(c) }
func Get() *Config { return v.Load().(*Config) }
```

Interface boxing + type assertion on every Get.

**Optimized:**

```go
var v atomic.Pointer[Config]

func Set(c *Config) { v.Store(c) }
func Get() *Config  { return v.Load() }
```

Type-safe; no boxing; ~5-10x faster Load.

---

## Optimization 14: Inline hot atomic in struct

**Original:**

```go
type Counter struct {
    n *atomic.Int64
}

func New() *Counter {
    return &Counter{n: &atomic.Int64{}}
}

func (c *Counter) Inc() { c.n.Add(1) }
```

Indirection through `*atomic.Int64`.

**Optimized:**

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() { c.n.Add(1) }
```

No indirection. Slightly faster, especially in tight loops.

---

## Optimization 15: Use `errgroup` instead of manual coordination

**Original:**

```go
var wg sync.WaitGroup
var mu sync.Mutex
var firstErr error

for _, url := range urls {
    url := url
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := fetch(url); err != nil {
            mu.Lock()
            if firstErr == nil {
                firstErr = err
            }
            mu.Unlock()
        }
    }()
}
wg.Wait()
if firstErr != nil {
    return firstErr
}
```

Verbose; doesn't propagate cancellation.

**Optimized:**

```go
g, ctx := errgroup.WithContext(parent)
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

Cleaner; propagates cancellation; idiomatic.

---

## Measurement and Benchmarking

For each optimization, write a benchmark:

```go
func BenchmarkOriginal(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            // exercise the original
        }
    })
}

func BenchmarkOptimized(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            // exercise the optimized
        }
    })
}
```

Run with `go test -bench=. -benchmem -cpu=1,4,8,16`.

Compare:
- ns/op: lower is better.
- B/op: zero is best.
- allocs/op: zero is best.
- Scaling: should improve with more cores.

---

## Closing

Optimization is measurement-driven. Apply these patterns when profiling shows their original forms as bottlenecks. Don't optimize blindly.

End of optimize.md.
