---
layout: default
title: Optimize
parent: Premature Optimization
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/optimize/
---

# Premature Concurrency Optimization — Optimize

Ten scenarios where the optimization is to *remove* concurrency, simplify to sequential, or batch instead of parallelise. For each: the original (over-concurrent) code, the diagnosis, the simplified version, and the expected outcome.

---

## Scenario 1: parallel sum, simplified to sequential

### Original

```go
func sumParallel(xs []int) int {
    workers := 8
    chunkSize := (len(xs) + workers - 1) / workers
    partial := make([]int, workers)
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        w := w
        start := w * chunkSize
        end := start + chunkSize
        if end > len(xs) {
            end = len(xs)
        }
        wg.Add(1)
        go func() {
            defer wg.Done()
            for _, x := range xs[start:end] {
                partial[w] += x
            }
        }()
    }
    wg.Wait()
    sum := 0
    for _, p := range partial {
        sum += p
    }
    return sum
}
```

### Diagnosis

For `len(xs) < 1_000_000`, the parallel version is slower than `for _, x := range xs { sum += x }` because the goroutine setup and final merge cost more than the savings.

### Simplified

```go
func sum(xs []int) int {
    s := 0
    for _, x := range xs {
        s += x
    }
    return s
}
```

### Outcome

Benchmark on 8 cores, `len(xs) = 10_000`:
- Parallel: 12 µs.
- Sequential: 2.5 µs.

5× faster. Less code. No bugs to write.

---

## Scenario 2: channel-based aggregator, simplified to indexed slice

### Original

```go
func processItems(items []Item) []Result {
    out := make(chan struct {
        i int
        r Result
    }, len(items))

    for i, item := range items {
        i, item := i, item
        go func() {
            out <- struct {
                i int
                r Result
            }{i, process(item)}
        }()
    }

    results := make([]Result, len(items))
    for range items {
        x := <-out
        results[x.i] = x.r
    }
    return results
}
```

### Diagnosis

The channel-and-aggregator pattern uses a goroutine per item and 2 channel ops per item. For small per-item work, this is expensive overhead.

### Simplified

```go
func processItems(items []Item) []Result {
    results := make([]Result, len(items))
    workers := runtime.GOMAXPROCS(0)
    var idx atomic.Int64
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                i := idx.Add(1) - 1
                if int(i) >= len(items) {
                    return
                }
                results[i] = process(items[i])
            }
        }()
    }
    wg.Wait()
    return results
}
```

### Outcome

Workers pull from an atomic index, write directly to `results[i]`. No channels. 2-5× faster for typical workloads, simpler code.

---

## Scenario 3: per-item goroutine, simplified to batched

### Original

```go
func handleEvents(events []Event) {
    var wg sync.WaitGroup
    for _, ev := range events {
        ev := ev
        wg.Add(1)
        go func() {
            defer wg.Done()
            doWork(ev) // ~500 ns
        }()
    }
    wg.Wait()
}
```

### Diagnosis

Spawn cost (~1 µs) dominates the work (~500 ns). 100,000 events = 100,000 goroutines = 100 ms of spawn cost.

### Simplified

```go
func handleEvents(events []Event) {
    workers := runtime.GOMAXPROCS(0)
    chunkSize := (len(events) + workers - 1) / workers
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        start := w * chunkSize
        end := start + chunkSize
        if end > len(events) {
            end = len(events)
        }
        if start >= end {
            continue
        }
        wg.Add(1)
        go func(chunk []Event) {
            defer wg.Done()
            for _, ev := range chunk {
                doWork(ev)
            }
        }(events[start:end])
    }
    wg.Wait()
}
```

### Outcome

Goroutine count drops from `len(events)` to `workers`. Spawn cost amortised. 10-100× faster for short per-item work.

---

## Scenario 4: lock-free queue, simplified to mutex-protected slice

### Original

```go
// A custom lock-free queue with atomic head/tail pointers,
// hazard pointers, epoch-based reclamation, ~300 lines of code.
type LockFreeQueue struct { /* ... */ }
```

### Diagnosis

For most workloads (< 10M ops/sec), a `sync.Mutex` + slice is faster, simpler, and correct. The lock-free version is harder to verify, harder to maintain, and rarely outperforms.

### Simplified

```go
type Queue struct {
    mu sync.Mutex
    items []Item
}

func (q *Queue) Push(item Item) {
    q.mu.Lock()
    q.items = append(q.items, item)
    q.mu.Unlock()
}

func (q *Queue) Pop() (Item, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) == 0 {
        return Item{}, false
    }
    item := q.items[0]
    q.items = q.items[1:]
    return item, true
}
```

### Outcome

300 lines down to 20. Benchmarks show this is faster than the lock-free version under typical contention, and correct.

---

## Scenario 5: sharded map, simplified to single map

### Original

```go
type ShardedMap[K comparable, V any] struct {
    shards [32]struct {
        mu sync.Mutex
        m  map[K]V
    }
}

func (s *ShardedMap[K, V]) hash(k K) int { /* ... */ }
func (s *ShardedMap[K, V]) Get(k K) (V, bool) { /* ... */ }
func (s *ShardedMap[K, V]) Set(k K, v V) { /* ... */ }
```

### Diagnosis

For maps with low contention (most maps), the hash overhead per access exceeds the savings from reduced mutex contention. Single map with `sync.Mutex` is usually faster.

### Simplified

```go
type Map[K comparable, V any] struct {
    mu sync.Mutex
    m  map[K]V
}

func (m *Map[K, V]) Get(k K) (V, bool) {
    m.mu.Lock()
    defer m.mu.Unlock()
    v, ok := m.m[k]
    return v, ok
}

func (m *Map[K, V]) Set(k K, v V) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.m[k] = v
}
```

### Outcome

Single map: ~30 ns/op.
Sharded map: ~50 ns/op (hash + mutex).

The sharded version was 60% slower, despite intent. Remove the sharding.

---

## Scenario 6: sync.Pool for tiny objects, simplified to allocation

### Original

```go
var pool = sync.Pool{
    New: func() interface{} { return &SmallObj{} },
}

func process(x int) *SmallObj {
    o := pool.Get().(*SmallObj)
    o.value = x
    return o
}

func release(o *SmallObj) {
    *o = SmallObj{} // reset
    pool.Put(o)
}
```

### Diagnosis

`SmallObj` is 16 bytes. Allocation is ~30 ns; pool overhead is ~30 ns. No win. And the Put/Get protocol requires the caller to remember to release — easy to forget.

### Simplified

```go
func process(x int) *SmallObj {
    return &SmallObj{value: x}
}
```

### Outcome

Same performance. Half the code. No risk of forgetting to release.

---

## Scenario 7: actor pattern for simple state, simplified to mutex

### Original

```go
type Counter struct {
    incCh chan struct{}
    getCh chan chan int
}

func NewCounter() *Counter {
    c := &Counter{
        incCh: make(chan struct{}),
        getCh: make(chan chan int),
    }
    go c.run()
    return c
}

func (c *Counter) run() {
    n := 0
    for {
        select {
        case <-c.incCh:
            n++
        case out := <-c.getCh:
            out <- n
        }
    }
}

func (c *Counter) Inc() { c.incCh <- struct{}{} }
func (c *Counter) Get() int {
    out := make(chan int)
    c.getCh <- out
    return <-out
}
```

### Diagnosis

Each operation is 2 channel ops = ~500 ns. A mutex would be ~10 ns. The actor pattern is 50× slower for trivial state.

### Simplified

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func (c *Counter) Get() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

### Outcome

50× faster. Less code. No background goroutine to manage. (For a *counter*, even better: use `atomic.Int64` — 1 ns per op.)

---

## Scenario 8: batched events sent one at a time

### Original

```go
func send(events <-chan Event, ch chan<- Batch) {
    for ev := range events {
        ch <- Batch{Events: []Event{ev}} // batch of one!
    }
}
```

### Diagnosis

A "batch" of one defeats batching. Each event goes through a channel with full overhead.

### Simplified

```go
func send(events <-chan Event, ch chan<- Batch) {
    batch := Batch{Events: make([]Event, 0, 100)}
    flush := func() {
        if len(batch.Events) > 0 {
            ch <- batch
            batch = Batch{Events: make([]Event, 0, 100)}
        }
    }

    timer := time.NewTimer(50 * time.Millisecond)
    defer timer.Stop()

    for {
        select {
        case ev, ok := <-events:
            if !ok {
                flush()
                return
            }
            batch.Events = append(batch.Events, ev)
            if len(batch.Events) >= 100 {
                flush()
                timer.Reset(50 * time.Millisecond)
            }
        case <-timer.C:
            flush()
            timer.Reset(50 * time.Millisecond)
        }
    }
}
```

### Outcome

100× fewer channel sends. Bounded latency (≤50 ms wait for partial batches).

---

## Scenario 9: hedged on a contended backend, simplified to no hedge

### Original

```go
// A hedger sends a backup request after 50 ms.
// Used for a heavily-loaded internal service.
```

### Diagnosis

Hedging adds load (~5-10% extra requests) to the backend. If the backend is already at capacity, hedging makes things worse — increasing load increases tail latency, which triggers more hedging.

### Simplified

Remove the hedger. Address the actual problem: backend capacity. Add instances or fix the slow endpoint.

### Outcome

Backend load drops. Tail latency improves. The hedger was a workaround for the real problem.

---

## Scenario 10: 4-level cache hierarchy, simplified to one cache

### Original

```go
type Cache struct {
    L1 *sync.Map     // ultra-fast hot path
    L2 *bigcache.BigCache  // larger, slower
    L3 *redis.Client  // remote, slowest
}

func (c *Cache) Get(key string) Value {
    if v, ok := c.L1.Load(key); ok {
        return v.(Value)
    }
    if v, err := c.L2.Get(key); err == nil {
        // promote to L1
        c.L1.Store(key, parseValue(v))
        return parseValue(v)
    }
    v, _ := c.L3.Get(key)
    parsed := parseValue(v)
    c.L2.Set(key, encodeValue(parsed))
    c.L1.Store(key, parsed)
    return parsed
}
```

### Diagnosis

Three levels of cache add complexity, allocation, and possible inconsistencies. If L1's hit rate is high and the dataset fits in L1, you don't need L2. If L2's hit rate is high, you don't need L3.

Measure: hit rates are L1: 5%, L2: 3%, L3: 1%. Total cache effectiveness: 9%. Without caches, the underlying source is fast enough.

### Simplified

```go
func Get(key string) Value {
    return parseValue(source.Get(key))
}
```

(Optionally: a single LRU cache if the underlying source is expensive enough to warrant it.)

### Outcome

Vastly simpler code. Latency unchanged. Memory savings. Operational simplicity.

---

## Summary

Ten patterns of "remove the concurrency":

1. Parallel sum → sequential.
2. Channel aggregator → indexed slice.
3. Per-item spawn → batched/chunked.
4. Lock-free → mutex.
5. Sharded map → single map.
6. sync.Pool tiny → just allocate.
7. Actor for state → mutex.
8. Single-event batches → real batches.
9. Hedger on saturated → remove.
10. Multi-level cache → single or none.

In each, the simpler code is faster, more reliable, easier to reason about. The "optimization" was a tax with no return.

The senior engineer's gift to the team is recognising these patterns and shipping the simplification. Every removed line of premature concurrency is a future bug avoided.

End of optimize.
