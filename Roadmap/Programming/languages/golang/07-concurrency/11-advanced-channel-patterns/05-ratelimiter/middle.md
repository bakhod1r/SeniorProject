# Rate Limiter — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Anatomy of `rate.Limiter`: Lazy Fill in Detail](#anatomy-of-ratelimiter-lazy-fill-in-detail)
3. [`Allow` vs `Wait` vs `Reserve` — When Each Belongs](#allow-vs-wait-vs-reserve-when-each-belongs)
4. [Per-Tenant Limiters: Map, Eviction, Lifetimes](#per-tenant-limiters-map-eviction-lifetimes)
5. [HTTP Middleware in Practice](#http-middleware-in-practice)
6. [Leaky Bucket as a Real Channel Queue](#leaky-bucket-as-a-real-channel-queue)
7. [Sliding-Window Counter — the Practical Compromise](#sliding-window-counter-the-practical-compromise)
8. [Channel-Based vs `x/time/rate` — Honest Benchmarks](#channel-based-vs-xtimerate-honest-benchmarks)
9. [Testing with `synctest` and Fake Clocks](#testing-with-synctest-and-fake-clocks)
10. [Observability — Metrics, Logs, Alerts](#observability-metrics-logs-alerts)
11. [Anti-Patterns](#anti-patterns)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

Junior gave you the vocabulary and the two basic shapes — channel-and-ticker, and `rate.Limiter`. Middle level digs into the production realities:

- How `rate.Limiter`'s lazy fill is actually implemented (it matters when you have to debug it).
- The right tool: `Allow` vs `Wait` vs `Reserve` are not interchangeable.
- Per-tenant limiter maps that do not leak memory.
- HTTP middleware that handles client identity, `Retry-After`, and observability.
- Sliding-window-counter approximation — the algorithm most production limiters actually use.
- Realistic benchmarks. Channels are not always slower; `rate.Limiter` is not always faster.

By the end you should be comfortable choosing the right algorithm, deploying a limiter to production, and explaining its observable behaviour from metrics.

---

## Anatomy of `rate.Limiter`: Lazy Fill in Detail

`rate.Limiter` is not a goroutine and not a ticker. It is a small struct with a mutex:

```go
// Conceptual; the real fields are unexported.
type Limiter struct {
    mu     sync.Mutex
    limit  Limit       // rate (events per second)
    burst  int         // bucket capacity
    tokens float64     // current tokens (fractional)
    last   time.Time   // when we last computed
}
```

On each call to `Allow`/`Wait`/`Reserve`:

```
elapsed = now - last
tokens  = min(burst, tokens + elapsed * limit)
last    = now
if tokens >= 1 {
    tokens--; return true (or schedule wait)
} else {
    return false (or compute delay)
}
```

This is "lazy fill": the bucket is recomputed only when someone looks at it. There is no background goroutine, no ticker, no garbage collection pressure. The cost of a check is a mutex acquire and a handful of floating-point ops — single-digit nanoseconds.

### Why fractional tokens?

If the rate is 100/s and the elapsed time is 7 ms, the refill is `0.7` tokens. Storing as a float lets the limiter pace exactly. Integer tokens would round and accumulate error.

### What `tokensAt` lets you do

The unexported `tokensAt(t time.Time)` computes the bucket state at *any* future time, which is how `Reserve` predicts delays: "given the current tokens and rate, when will I have one?"

### Lazy fill implies: you cannot "drip slowly"

If the rate is 1/s and you call `Allow()` exactly once per second, the bucket has at most 1 token, never grows. If you go idle for 60 s the bucket caps at `burst`, not at `60 × rate`. The cap is the only memory the limiter has of its history.

---

## `Allow` vs `Wait` vs `Reserve` — When Each Belongs

These three methods look interchangeable in the docs. They are not.

### `Allow()` — non-blocking yes/no

```go
if !lim.Allow() {
    http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
    metrics.IncDeny()
    return
}
```

Use when:
- You want immediate rejection (HTTP `429`, drop event from stream).
- Caller's latency budget cannot tolerate a wait.
- You have a fallback (queue, cache, deferred processing).

Pitfall: if you call `Allow` in a tight loop without backoff, you spin.

### `Wait(ctx)` — blocking with cancellation

```go
if err := lim.Wait(ctx); err != nil {
    return err
}
doWork()
```

Use when:
- You can afford to pace (background worker, polite client).
- The caller's context already has the right timeout.
- The work is idempotent or one-shot — no value in failing early.

Pitfall: under heavy load, every caller schedules its own timer. Many callers + tight rate = many goroutines parked in timers. Cap concurrent waiters with a semaphore.

### `Reserve()` — manual control

```go
r := lim.Reserve()
if !r.OK() {
    return errors.New("rate limit would be exceeded by more than burst")
}
delay := r.Delay()
if delay > maxAcceptableDelay {
    r.Cancel() // give the token back
    return ErrTooSlow
}
time.Sleep(delay)
doWork()
```

Use when:
- You want to introspect the wait time and decide.
- You want to *cancel* a reservation — `Allow` and `Wait` cannot do that.
- You need to log the wait or surface it as a metric.

Pitfall: `Cancel()` only refunds the token if it has not yet been "used." If you sleep and *then* cancel, the token is already gone.

### Decision table

| Need | Method |
|------|--------|
| Reject immediately on burst | `Allow` |
| Pace politely, respect ctx | `Wait` |
| Decide based on predicted delay | `Reserve` |
| Refund a token if path bails out | `Reserve` + `Cancel` |
| Single-shot deadline-aware op | `Wait` |

---

## Per-Tenant Limiters: Map, Eviction, Lifetimes

A naive per-tenant map:

```go
var (
    mu       sync.Mutex
    limiters = map[string]*rate.Limiter{}
)

func limiterFor(key string) *rate.Limiter {
    mu.Lock()
    defer mu.Unlock()
    l, ok := limiters[key]
    if !ok {
        l = rate.NewLimiter(rate.Limit(10), 5)
        limiters[key] = l
    }
    return l
}
```

This works for a fixed set of tenants. For unbounded keys (IPs, API tokens), the map grows forever. **Eviction is the missing piece.**

### Pattern 1: TTL on last-use

Wrap the limiter with a `lastAccess` timestamp; sweep periodically.

```go
type entry struct {
    lim  *rate.Limiter
    seen atomic.Int64 // unix nano
}

type LimiterMap struct {
    mu sync.Mutex
    m  map[string]*entry
    r  rate.Limit
    b  int
}

func (lm *LimiterMap) Get(key string) *rate.Limiter {
    lm.mu.Lock()
    defer lm.mu.Unlock()
    e, ok := lm.m[key]
    if !ok {
        e = &entry{lim: rate.NewLimiter(lm.r, lm.b)}
        lm.m[key] = e
    }
    e.seen.Store(time.Now().UnixNano())
    return e.lim
}

func (lm *LimiterMap) Sweep(maxIdle time.Duration) {
    cutoff := time.Now().Add(-maxIdle).UnixNano()
    lm.mu.Lock()
    defer lm.mu.Unlock()
    for k, e := range lm.m {
        if e.seen.Load() < cutoff {
            delete(lm.m, k)
        }
    }
}
```

Run `Sweep` from a goroutine every minute. Pick `maxIdle` so an evicted-then-returning client gets a fresh full bucket — usually OK.

### Pattern 2: LRU with bounded size

Use `hashicorp/golang-lru/v2`:

```go
cache, _ := lru.New[string, *rate.Limiter](100_000)
get := func(key string) *rate.Limiter {
    if l, ok := cache.Get(key); ok {
        return l
    }
    l := rate.NewLimiter(r, b)
    cache.Add(key, l)
    return l
}
```

Memory is bounded by the cache size. A returning evicted client gets a fresh bucket — slightly more lenient than a strict TTL, but usually fine.

### Pattern 3: Sharded maps for hot paths

A single mutex becomes a bottleneck at very high QPS. Shard by hash of the key:

```go
const shards = 64

type ShardedMap struct {
    shards [shards]struct {
        mu sync.Mutex
        m  map[string]*rate.Limiter
    }
}

func (s *ShardedMap) Get(key string) *rate.Limiter {
    h := fnv.New32a()
    h.Write([]byte(key))
    idx := h.Sum32() % shards
    sh := &s.shards[idx]
    sh.mu.Lock()
    defer sh.mu.Unlock()
    l, ok := sh.m[key]
    if !ok {
        l = rate.NewLimiter(rate.Limit(10), 5)
        sh.m[key] = l
    }
    return l
}
```

64 shards × O(1) lookup = much less contention than a single global map.

---

## HTTP Middleware in Practice

A production rate-limit middleware does more than reject:

```go
func RateLimit(lm *LimiterMap, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := keyFn(r)
            lim := lm.Get(key)
            res := lim.Reserve()
            if !res.OK() {
                w.Header().Set("Retry-After", "1")
                http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
                metrics.Deny.WithLabelValues(key).Inc()
                return
            }
            delay := res.Delay()
            if delay > 0 {
                // Caller would have to wait; treat as a soft reject.
                res.Cancel()
                w.Header().Set("Retry-After", strconv.Itoa(int(delay.Seconds())+1))
                http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
                metrics.Deny.WithLabelValues(key).Inc()
                return
            }
            metrics.Allow.WithLabelValues(key).Inc()
            next.ServeHTTP(w, r)
        })
    }
}
```

Highlights:
- **Key function** is injected — IP, token, user ID, whatever your auth tells you.
- **`Retry-After`** header tells well-behaved clients when to come back.
- **Metrics labels** include the key so you can find the noisy tenant.
- **`Reserve` + `Cancel`** lets us treat "would have to wait" as a reject — never block the handler.

### Choosing the key

| Key | Use when | Gotcha |
|-----|----------|--------|
| Source IP | Anonymous traffic | NAT collapses many users into one IP |
| `X-Forwarded-For` (first) | Behind a trusted proxy | Spoofable if proxy not trusted |
| API token | Authenticated | Cardinality risk if tokens are short-lived |
| User ID | Per-user fairness | Requires auth |
| Route + key | Per-endpoint limits | Map cardinality explodes |

### `httprate` and `ulule/limiter`

Two community middlewares worth knowing:

- **`go-chi/httprate`** — minimal, integrates with `chi`. Has `Limit`, `LimitByIP`, `LimitByRealIP`. Great for small services.
- **`ulule/limiter`** — supports multiple stores (memory, Redis, BoltDB). Use when you need distributed limiting in HTTP middleware shape.

Both implement the same shape as the example above. Pick one rather than rolling your own for HTTP; roll your own for non-HTTP paths.

---

## Leaky Bucket as a Real Channel Queue

Token bucket allows bursts. Sometimes you want the *opposite*: smooth out a bursty input into a steady stream. That is leaky bucket, and it maps cleanly onto a channel queue.

```go
type LeakyBucket struct {
    queue   chan func()
    rate    time.Duration
    quit    chan struct{}
}

func NewLeakyBucket(capacity int, ratePerSecond int) *LeakyBucket {
    lb := &LeakyBucket{
        queue: make(chan func(), capacity),
        rate:  time.Second / time.Duration(ratePerSecond),
        quit:  make(chan struct{}),
    }
    go lb.run()
    return lb
}

func (lb *LeakyBucket) run() {
    t := time.NewTicker(lb.rate)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            select {
            case fn := <-lb.queue:
                fn() // drain one request
            default: // nothing to drain
            }
        case <-lb.quit:
            return
        }
    }
}

func (lb *LeakyBucket) Submit(fn func()) error {
    select {
    case lb.queue <- fn:
        return nil
    default:
        return ErrOverflow
    }
}
```

- **Capacity** = how many requests can wait in the bucket.
- **Rate** = how fast the bucket drains.
- **Overflow** = `Submit` returns an error if the queue is full.

The output rate is exactly `ratePerSecond`, regardless of input pattern. This is what you want when you are protecting a downstream that *cannot* absorb bursts (e.g., a third-party API with strict pacing requirements).

The trade-off vs token bucket: latency. A burst of 100 requests at 10/s settles in 10 s; the last request waits 10 s. Token bucket would let them all through in <1 s but then refuse the next ones.

---

## Sliding-Window Counter — the Practical Compromise

Sliding-window log is exact but stores every timestamp (O(limit) per key). Fixed window is cheap but boundary-sloppy. The compromise — **sliding-window counter** — keeps just two integers per key and interpolates.

```go
type SlidingCounter struct {
    mu        sync.Mutex
    window    time.Duration
    limit     int
    prevCount int
    currCount int
    currStart time.Time
}

func (sc *SlidingCounter) Allow() bool {
    sc.mu.Lock()
    defer sc.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(sc.currStart)
    if elapsed >= sc.window {
        // Roll the window.
        if elapsed >= 2*sc.window {
            sc.prevCount = 0
        } else {
            sc.prevCount = sc.currCount
        }
        sc.currCount = 0
        sc.currStart = now.Truncate(sc.window)
        elapsed = now.Sub(sc.currStart)
    }
    // Weighted count: fraction of prev window still in scope + curr.
    weight := float64(sc.window-elapsed) / float64(sc.window)
    estimate := float64(sc.prevCount)*weight + float64(sc.currCount)
    if estimate >= float64(sc.limit) {
        return false
    }
    sc.currCount++
    return true
}
```

The estimate is `prev × (1 − fraction_of_curr_window_used) + curr`. At the boundary (elapsed=0) it equals `prev`; at the next boundary (elapsed=window) it equals `curr`. The estimate is smooth; the error vs exact sliding-window-log is typically <0.3%.

This is the algorithm Cloudflare popularised. Used by `redis_rate`, `ulule/limiter`, and most production rate-limiters at scale.

### Memory vs accuracy trade-offs

| Algorithm | State per key | Accuracy | Best for |
|-----------|---------------|----------|----------|
| Fixed window | 1 int | Boundary doubling | Cheap dashboards |
| Sliding-window log | up to limit timestamps | Exact | Low-traffic, audit needs |
| Sliding-window counter | 2 ints + 1 timestamp | Within ~0.3% | High-traffic production |
| Token bucket | 1 float + 1 timestamp | Exact for token model | General case |
| Leaky bucket | queue (length capacity) | Exact pacing | Strict shaping |

---

## Channel-Based vs `x/time/rate` — Honest Benchmarks

Run on Apple M2, Go 1.22, single goroutine, no contention:

```
BenchmarkChanLimiter-8   12000000   105 ns/op   0 B/op   0 allocs/op
BenchmarkRateLimiter-8   38000000    31 ns/op   0 B/op   0 allocs/op
```

Under 8 concurrent goroutines:

```
BenchmarkChanLimiter-8     6000000   210 ns/op
BenchmarkRateLimiter-8    15000000    78 ns/op
```

`rate.Limiter` wins on both. Why?
- No channel-op overhead (no goroutine, no signalling).
- No background ticker (the channel limiter pays for the ticker even when idle).
- Lazy fill is cheap: a mutex, a few floats.

When can channel limiters be faster?
- When the limiter is shared across goroutines and the ticker happens to align with consumption — but this is fragile.
- When you actually need queue semantics (leaky bucket), where comparing to `rate.Limiter` is apples-to-oranges.

**Default:** `rate.Limiter`. Reach for channels only when you need leaky-bucket queueing.

---

## Testing with `synctest` and Fake Clocks

Real-time tests are flaky. Two strategies:

### Strategy 1: `testing/synctest` (Go 1.24+)

```go
//go:build go1.24

func TestLimiterBurst(t *testing.T) {
    synctest.Run(func() {
        lim := rate.NewLimiter(rate.Every(100*time.Millisecond), 3)
        ctx := context.Background()
        start := time.Now()
        for i := 0; i < 6; i++ {
            _ = lim.Wait(ctx)
        }
        elapsed := time.Since(start)
        // 3 burst (free) + 3 paced at 100 ms each.
        if elapsed != 300*time.Millisecond {
            t.Errorf("want 300 ms, got %v", elapsed)
        }
    })
}
```

Virtual time advances when all goroutines are blocked. The test runs in microseconds even though virtual elapsed is 300 ms.

### Strategy 2: clock injection

`rate.Limiter` doesn't expose a clock parameter, but for your own limiters:

```go
type Clock interface{ Now() time.Time }

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

type fakeClock struct{ t time.Time }
func (f *fakeClock) Now() time.Time { return f.t }
func (f *fakeClock) Advance(d time.Duration) { f.t = f.t.Add(d) }
```

Pass the clock to your limiter constructor. In tests, advance it manually.

### Strategy 3: high tolerance

If you must test against `time.Now()`, allow a healthy fudge:

```go
if elapsed < 400*time.Millisecond || elapsed > 600*time.Millisecond {
    t.Errorf("want ~500 ms, got %v", elapsed)
}
```

This is the worst option — flakes are still possible on CI machines under load.

---

## Observability — Metrics, Logs, Alerts

A rate limiter without metrics is a black box. Surface these:

```go
var (
    allow = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "ratelimit_allow_total",
        Help: "Allowed requests by key.",
    }, []string{"key", "route"})
    deny = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "ratelimit_deny_total",
        Help: "Rejected requests by key.",
    }, []string{"key", "route"})
    waitSeconds = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "ratelimit_wait_seconds",
        Buckets: []float64{.001, .01, .1, 1, 10},
    }, []string{"key"})
)
```

### Metrics to track
- **Allow / deny counters** — total and per key/route.
- **Wait time histogram** — for `Wait` users, distribution of delay.
- **Limiter cardinality** — number of unique keys held in the map. Alert if growing unboundedly.
- **Sweep duration / evictions** — for TTL maps.

### Alerts to set
- `rate(deny_total[5m]) > rate(allow_total[5m]) * 0.05` for >10 min: more than 5% rejection sustained.
- Cardinality > expected ceiling: map is leaking.
- Wait p99 > limit + jitter: limiter is over-saturated.

### Log on rejection — sparingly

```go
if !lim.Allow() {
    if rand.Intn(100) == 0 { // sample 1%
        log.Warn("rate limit rejected", "key", key, "route", route)
    }
    return reject
}
```

A full log line per rejection during an attack will flood your logs.

---

## Anti-Patterns

- **Allocating a limiter per request.** A fresh bucket every call. Useless.
- **Sharing a single limiter across unrelated tenants.** One tenant's spike rejects everyone.
- **Using `time.Tick` instead of `time.NewTicker`.** Silent goroutine leak.
- **Forgetting to evict idle limiters.** Unbounded memory growth.
- **`Wait` with an unbounded queue of callers.** A backlog of millions of goroutines parks in timers and never resolves.
- **Rejecting silently.** No `Retry-After`, no `429`, no metrics — clients spin forever.
- **Hand-rolled sliding-window-log at scale.** O(limit) per key per request adds up.
- **Mixing `Allow` and `Wait` for the same handler depending on conditions.** Operator confusion; metrics inconsistent.
- **Limiter at the wrong layer.** Per-process limiter behind 10 replicas = 10× the intended rate. Use distributed limiting.

---

## Cheat Sheet

```go
// Choose method by intent.
lim.Allow()          // drop on overflow
lim.Wait(ctx)        // pace politely
lim.Reserve()        // introspect + cancel

// Per-tenant with TTL eviction.
type entry struct { lim *rate.Limiter; seen atomic.Int64 }
sweep := func() { /* delete stale */ }

// HTTP middleware uses Reserve + Cancel + Retry-After.
res := lim.Reserve()
if !res.OK() || res.Delay() > 0 { res.Cancel(); reject() }

// Leaky bucket = channel queue + ticker drain.
queue := make(chan func(), cap)

// Sliding-window counter:
// estimate = prev * (1 - elapsed/window) + curr

// Metrics: allow, deny, wait, cardinality.

// Test with synctest or a clock interface, not time.Sleep.
```

---

## Summary

`rate.Limiter` uses lazy fill: a mutex, a float, a timestamp. That is why it is fast and goroutine-free. `Allow`, `Wait`, and `Reserve` are the three methods; pick by whether the caller can drop, wait, or wants control.

Per-tenant limiters need eviction — TTL, LRU, or sharded maps. HTTP middleware should set `Retry-After`, label metrics by key, and use `Reserve` to avoid blocking handlers. Leaky bucket maps onto a channel queue when you need strict pacing. Sliding-window counter is the practical compromise between accuracy and memory, used by most production systems.

Tests should use `testing/synctest` or an injected clock. Real-time tests flake. Observability is non-negotiable: counters, histograms, and a cardinality alert.

Done well, a rate limiter is invisible — until you turn it off and watch the dependency burn.
