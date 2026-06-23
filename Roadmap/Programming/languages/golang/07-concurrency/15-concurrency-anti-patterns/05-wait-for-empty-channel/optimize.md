---
layout: default
title: Optimize
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/optimize/
---

# Wait-for-Empty-Channel — Optimization Scenarios

Nine scenarios where polling-based code can be optimized by replacing it with event-driven synchronisation. Each scenario presents the slow version, the fast version, expected performance characteristics, and a brief discussion.

Numbers are indicative of typical results; your workload may vary. Always measure your own.

---

## Scenario 1: Replace Polling Drain with Range

### Before

```go
func drainSlow(ch chan int) {
    for len(ch) > 0 {
        <-ch
        time.Sleep(time.Microsecond) // small delay to avoid pegging CPU
    }
}
```

### After

```go
func drainFast(ch chan int) {
    for range ch {
    }
}
```

### Performance

| Metric                 | Polling         | Range          |
|------------------------|-----------------|----------------|
| Time to drain 1M items | ~1.5s           | ~30ms          |
| CPU usage              | High (busy poll)| Low (block)    |
| Allocation overhead    | Same            | Same           |

### Discussion

The polling version both races (may miss items added concurrently) and wastes CPU. The range version is correct and uses the scheduler to suspend when no items are available. 50x speedup on drain time, near-zero CPU when idle.

The trick: the producer must close the channel for `range` to terminate. If your code does not close, that is the actual bug to fix first.

---

## Scenario 2: Replace Polling-Based Wait with WaitGroup

### Before

```go
func processSlow(items []int) []int {
    out := make(chan int, len(items))
    for _, item := range items {
        go func(item int) {
            out <- compute(item)
        }(item)
    }
    for len(out) < len(items) {
        time.Sleep(time.Millisecond)
    }
    var result []int
    for i := 0; i < len(items); i++ {
        result = append(result, <-out)
    }
    return result
}
```

### After

```go
func processFast(items []int) []int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, item := range items {
        go func(item int) {
            defer wg.Done()
            out <- compute(item)
        }(item)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    var result []int
    for v := range out {
        result = append(result, v)
    }
    return result
}
```

### Performance

| Metric                | Polling         | WaitGroup      |
|-----------------------|-----------------|----------------|
| Latency (P50)         | +5 ms (1 poll)  | <1ms           |
| Latency (P99)         | +25 ms          | <1ms           |
| CPU during wait       | 50% of a core   | <1% of a core  |
| Items lost (race)     | 0-3 per call    | 0              |

### Discussion

The polling version's latency tail is the polling interval (here ~10ms). The WaitGroup version exits as soon as the work is done. Both correctness and performance improve.

---

## Scenario 3: Replace Polling Worker Pool with errgroup

### Before

```go
type SlowPool struct {
    jobs    chan Job
    stopped int32
}

func (p *SlowPool) worker() {
    for atomic.LoadInt32(&p.stopped) == 0 {
        select {
        case j := <-p.jobs:
            process(j)
        default:
            time.Sleep(time.Millisecond)
        }
    }
}

func (p *SlowPool) Stop() {
    atomic.StoreInt32(&p.stopped, 1)
    for len(p.jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
}
```

### After

```go
type FastPool struct {
    jobs chan Job
    g    *errgroup.Group
    ctx  context.Context
}

func NewFastPool(parent context.Context, workers int) *FastPool {
    g, ctx := errgroup.WithContext(parent)
    p := &FastPool{
        jobs: make(chan Job),
        g:    g,
        ctx:  ctx,
    }
    for i := 0; i < workers; i++ {
        g.Go(p.worker)
    }
    return p
}

func (p *FastPool) worker() error {
    for {
        select {
        case <-p.ctx.Done():
            return nil
        case j, ok := <-p.jobs:
            if !ok {
                return nil
            }
            process(j)
        }
    }
}

func (p *FastPool) Stop() error {
    close(p.jobs)
    return p.g.Wait()
}
```

### Performance

| Metric                         | Slow      | Fast      |
|--------------------------------|-----------|-----------|
| Throughput (jobs/sec)          | 12,000    | 28,000    |
| Worker CPU when idle (per pool)| 8% / core | <0.1%     |
| Shutdown time P99              | 3.5s      | 25ms      |
| Lines of code                  | ~50       | ~45       |

### Discussion

The `select`/`default` polling in the worker is the bottleneck. Each iteration spins through a no-op `default` branch, sleeps 1ms, repeats. Even with no work, the pool burns CPU.

The event-driven version uses `select` without `default`, so the goroutine parks until an event arrives. CPU goes to zero when idle.

---

## Scenario 4: Replace Polling Shutdown with Bounded Wait

### Before

```go
func (s *Server) ShutdownSlow() {
    s.stop()
    for s.activeRequests() > 0 {
        time.Sleep(100 * time.Millisecond)
    }
}
```

### After

```go
func (s *Server) ShutdownFast(ctx context.Context) error {
    return s.srv.Shutdown(ctx) // stdlib's implementation uses sync.WaitGroup internally
}
```

### Performance

| Metric                   | Slow        | Fast    |
|--------------------------|-------------|---------|
| Shutdown time P99        | 2.5s        | 50ms    |
| Shutdown time P99.9      | 12s         | 200ms   |
| Times deadline exceeded  | 0.5% of runs| 0       |

### Discussion

The polling version has a granularity of `time.Sleep`. Even when all requests complete, the wait persists until the next poll. The stdlib `Shutdown` returns as soon as the last request finishes.

---

## Scenario 5: Replace Polling Drain with Token-Return Pattern

### Before

```go
type SlowService struct {
    inFlight atomic.Int64
}

func (s *SlowService) Drain() {
    for s.inFlight.Load() > 0 {
        time.Sleep(time.Millisecond)
    }
}
```

### After

```go
type FastService struct {
    tokens chan struct{}
}

func New(max int) *FastService {
    s := &FastService{
        tokens: make(chan struct{}, max),
    }
    for i := 0; i < max; i++ {
        s.tokens <- struct{}{}
    }
    return s
}

func (s *FastService) Do(fn func()) {
    <-s.tokens
    defer func() { s.tokens <- struct{}{} }()
    fn()
}

func (s *FastService) Drain() {
    for i := 0; i < cap(s.tokens); i++ {
        <-s.tokens
    }
}
```

### Performance

| Metric                | Slow         | Fast       |
|-----------------------|--------------|------------|
| Drain time            | Up to poll * N| Bounded   |
| CPU during drain      | 50% of core  | <1%        |
| Correctness           | Racy         | Deterministic |

### Discussion

The polling version is racy: `inFlight.Load() == 0` is checked atomically, but between the check and the next operation, new work can arrive (or in-flight work can re-enter). The token-return pattern receives exactly `max` tokens and is deterministic.

This pattern works for bounded resources (connection pools, rate limiters, semaphore-style limits).

---

## Scenario 6: Replace Polling-Based Backpressure with Channel Backpressure

### Before

```go
func produceSlow(ch chan<- int, source []int) {
    for _, v := range source {
        for len(ch) > 80 {
            time.Sleep(time.Millisecond)
        }
        ch <- v
    }
}
```

### After

```go
func produceFast(ctx context.Context, ch chan<- int, source []int) error {
    for _, v := range source {
        select {
        case ch <- v:
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return nil
}
```

### Performance

| Metric                | Slow            | Fast       |
|-----------------------|-----------------|------------|
| Throughput            | Limited by poll | Native     |
| Latency P99           | +10 ms (1 poll) | <100 μs    |
| CPU during backpressure| Wasted        | None       |

### Discussion

The polling version checks "is there room?" and sleeps if not. The fast version sends and lets the channel block when full. The block is the backpressure. No CPU is wasted on polling; the goroutine is suspended by the scheduler.

For very high throughput pipelines, this single change can yield 2-3x throughput gains.

---

## Scenario 7: Replace Polling-Based Initialization with `sync.Once`

### Before

```go
var (
    initialized int32
    config      *Config
)

func GetConfig() *Config {
    for atomic.LoadInt32(&initialized) == 0 {
        time.Sleep(time.Millisecond)
    }
    return config
}
```

### After

```go
var (
    configOnce sync.Once
    initDone   = make(chan struct{})
    config     *Config
)

func InitConfig() {
    configOnce.Do(func() {
        config = loadConfig()
        close(initDone)
    })
}

func GetConfig() *Config {
    <-initDone
    return config
}
```

### Performance

| Metric                | Polling     | Once+Channel |
|-----------------------|-------------|--------------|
| First call latency    | +0.5 ms     | <1 μs        |
| Subsequent call latency| +0.5 ms    | <50 ns       |
| CPU per call          | Wasted poll | None         |

### Discussion

The polling version blocks for up to one poll interval per call. The Once-based version returns immediately once initialization completes.

If init failure should be retried, use `singleflight` instead of `Once`.

---

## Scenario 8: Replace Polling Queue Depth Check with Metrics Gauge

### Before

```go
func reportDepth(ch chan int) {
    for {
        if len(ch) > 0 {
            metrics.Counter("non-zero").Inc()
        }
        time.Sleep(time.Millisecond)
    }
}
```

### After

```go
func reportDepth(ctx context.Context, ch chan int) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            metrics.Gauge("queue.depth").Set(float64(len(ch)))
        }
    }
}
```

### Performance

| Metric                | Polling 1ms | Ticker 1s    |
|-----------------------|-------------|--------------|
| Reads per second      | 1000        | 1            |
| CPU cost              | 5% of core  | Negligible   |
| Metric usefulness     | Same        | Same (sampled)|

### Discussion

The polling version reads `len` 1000 times per second to detect non-zero. The ticker version reads once per second and emits a gauge that downstream metrics infra can aggregate. The 1000x reduction in `len` calls is a meaningful CPU saving.

Even more important: the polling version was wrong (it was control flow, not observability); the ticker version is right (it is observability).

---

## Scenario 9: Replace Polling Inter-Service Health Check with Server-Sent Events

### Before

```go
func waitForReadiness(addr string) {
    for {
        resp, err := http.Get(addr + "/health")
        if err == nil && resp.StatusCode == 200 {
            return
        }
        time.Sleep(time.Second)
    }
}
```

### After

If the service supports it, use Server-Sent Events or a long-poll endpoint:

```go
func waitForReadiness(ctx context.Context, addr string) error {
    req, _ := http.NewRequestWithContext(ctx, "GET", addr+"/wait-for-ready", nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    return nil // server returns 200 when ready
}
```

Server-side:

```go
http.HandleFunc("/wait-for-ready", func(w http.ResponseWriter, r *http.Request) {
    select {
    case <-readiness:
        w.WriteHeader(200)
    case <-r.Context().Done():
        // client cancelled
    case <-time.After(60 * time.Second):
        w.WriteHeader(504) // long-poll timeout
    }
})
```

### Performance

| Metric                     | Polling 1s | Long-poll |
|----------------------------|------------|-----------|
| Latency to detect ready    | 0-1000ms   | <50ms     |
| Requests per minute        | 60         | 0-1       |
| Server CPU                 | 60 req/min | 1 req     |

### Discussion

The polling version sends a request every second. The long-poll version holds one open request that completes when the event happens. Lower latency and dramatically less load on both sides.

Server-Sent Events are similar but for continuous streams; long-poll is right for one-shot "is it ready?" semantics.

---

## Closing Summary

Across nine scenarios:

| Scenario                | Throughput change | Latency change | CPU change |
|-------------------------|-------------------|----------------|------------|
| 1. Polling drain → range | 50x              | -1.5s          | -99%       |
| 2. Polling wait → WG    | n/a               | -25ms P99      | -98%       |
| 3. Polling pool → errgroup| 2.3x            | -3.5s P99 shutdown| -98%    |
| 4. Polling shutdown → Shutdown| n/a         | -2.5s P99      | -95%       |
| 5. Polling drain → token| n/a               | Bounded        | -95%       |
| 6. Polling backpressure → block| 2-3x       | -10ms P99      | -100%      |
| 7. Polling init → Once  | n/a               | -0.5ms         | -100%      |
| 8. Polling depth → gauge| n/a               | n/a (informational) | -99%  |
| 9. Polling health → long-poll| n/a          | -500ms P99     | -98%       |

The pattern is consistent: replacing polling with event-driven primitives yields 50-100% CPU savings, large latency improvements (especially at the tail), and often throughput gains. The cost: a few lines of code change per instance.

This is the optimization payoff. Multiplied across an entire codebase, it is measurable in cloud bills, customer experience, and incident frequency.
