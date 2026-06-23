# Rate Limiter — Interview Questions

A practical bank of questions for screening, coding rounds, and architecture discussions. Each question lists the expected level and a model answer or grading rubric.

---

## Conceptual

### Q1. What is a rate limiter? Name three places one is used.
**Level:** Junior.
**Answer:** A component that caps how often an operation runs over a window of time. Used in HTTP middleware to throttle clients, in outbound API clients to respect published quotas (Stripe, AWS), in background workers to pace batch jobs, in login systems to throttle brute-force attempts, in cost guards on billable APIs.

### Q2. Difference between token bucket and leaky bucket?
**Level:** Junior/middle.
**Answer:** Token bucket allows bursts up to capacity, then enforces an average rate. Leaky bucket smooths input into a constant-rate output via a FIFO queue. Same long-run rate; different short-run shape. Token bucket is bursty-friendly; leaky bucket is strictly paced.

### Q3. Why is `time.Tick` considered unsafe inside a function?
**Level:** Junior.
**Answer:** It returns a channel from an internal `*Ticker` that you cannot reach. The ticker is never stopped and never garbage-collected, holding a runtime goroutine forever. Each call to the function spawns a new zombie ticker. Use `time.NewTicker` with `defer t.Stop()` instead.

### Q4. What does `burst` mean in `rate.NewLimiter(r, b)`?
**Level:** Junior.
**Answer:** The maximum tokens the bucket can hold. After an idle period, the first `b` calls succeed instantly; subsequent calls are paced at rate `r`. Burst is the jitter tolerance, not an "extra" budget.

### Q5. What happens when `burst = 0`?
**Level:** Junior.
**Answer:** The bucket has zero capacity. `Allow()` always returns false; `Wait` blocks forever (or until context fires). A misconfiguration. Always set `burst >= 1`.

### Q6. When would you use `Allow` over `Wait`?
**Level:** Middle.
**Answer:** When immediate rejection is the right answer — HTTP `429`, stream-drop, no fallback. Use `Wait` when the caller can afford to pace politely (background worker, outbound API client). Use `Reserve` when you need to introspect delay or cancel.

### Q7. Why is fixed-window rate limiting "boundary-sloppy"?
**Level:** Middle.
**Answer:** Limits reset at fixed wall-clock instants. A client can send `limit` requests in the last second of one window and `limit` more in the first second of the next, achieving `2 × limit` in 2 seconds. Sliding-window fixes this.

### Q8. How does `rate.Limiter` work internally without a goroutine?
**Level:** Middle/Senior.
**Answer:** Lazy fill. State is `(tokens float64, last time.Time)`. On each call, compute `tokens += (now - last) * rate`, cap at `burst`, consume one. No timer, no goroutine, no GC pressure. Just a mutex and a few floats.

### Q9. Compare `redis_rate` (GCRA) and a Redis `INCR + EXPIRE` fixed-window limiter.
**Level:** Senior.
**Answer:** Both are distributed. Fixed-window is two commands per check (INCR, conditional EXPIRE) but has the boundary problem. GCRA is one Lua call per check, no boundary problem, stores one timestamp. GCRA is the production-grade choice.

### Q10. What is "fail open" vs "fail closed" for a distributed limiter?
**Level:** Senior.
**Answer:** Fail open = allow requests when the limiter backend (Redis) fails; preserves availability at the cost of safety. Fail closed = reject requests; preserves safety at the cost of availability. Common compromise: fall back to a local in-memory limiter on backend failure.

---

## Implementation

### Q11. Implement a token bucket using a buffered channel.
**Level:** Junior.

```go
type TokenBucket struct {
    tokens chan struct{}
    quit   chan struct{}
}

func NewTokenBucket(rate, burst int) *TokenBucket {
    tb := &TokenBucket{
        tokens: make(chan struct{}, burst),
        quit:   make(chan struct{}),
    }
    for i := 0; i < burst; i++ {
        tb.tokens <- struct{}{}
    }
    interval := time.Second / time.Duration(rate)
    go func() {
        t := time.NewTicker(interval)
        defer t.Stop()
        for {
            select {
            case <-t.C:
                select {
                case tb.tokens <- struct{}{}:
                default:
                }
            case <-tb.quit:
                return
            }
        }
    }()
    return tb
}

func (tb *TokenBucket) Allow() bool {
    select {
    case <-tb.tokens:
        return true
    default:
        return false
    }
}

func (tb *TokenBucket) Close() { close(tb.quit) }
```

**Grading:** Pre-fill (don't forget). `defer t.Stop()`. Buffered channel of size `burst`. Quit channel.

### Q12. Build an HTTP middleware that limits each IP to 10 req/s.
**Level:** Middle.

```go
func RateLimit(r rate.Limit, b int) func(http.Handler) http.Handler {
    var mu sync.Mutex
    limiters := map[string]*rate.Limiter{}
    get := func(key string) *rate.Limiter {
        mu.Lock()
        defer mu.Unlock()
        l, ok := limiters[key]
        if !ok {
            l = rate.NewLimiter(r, b)
            limiters[key] = l
        }
        return l
    }
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
            ip, _, _ := net.SplitHostPort(req.RemoteAddr)
            if !get(ip).Allow() {
                w.Header().Set("Retry-After", "1")
                http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, req)
        })
    }
}
```

**Grading:** Map for per-key limiters. Mutex around map. `Retry-After` header. `429` status. Bonus: TTL eviction, `X-Forwarded-For` handling, metrics.

### Q13. Add TTL-based eviction to the per-IP map.
**Level:** Middle.

```go
type entry struct {
    lim  *rate.Limiter
    seen atomic.Int64
}

func sweep(m map[string]*entry, maxIdle time.Duration) {
    cutoff := time.Now().Add(-maxIdle).UnixNano()
    for k, e := range m {
        if e.seen.Load() < cutoff {
            delete(m, k)
        }
    }
}

// Run periodically in a goroutine, holding the map mutex during sweep.
```

**Grading:** Use atomic for the timestamp. Periodic sweep goroutine. Bonus: LRU instead of TTL; sharded map.

### Q14. Write a Redis Lua script for a fixed-window counter limiter.
**Level:** Senior.

```lua
local current = redis.call("INCR", KEYS[1])
if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
    return 0
end
return 1
```

**Grading:** Atomic INCR + conditional EXPIRE. Single key. Returns 1/0. Bonus: GCRA implementation, boundary-problem discussion.

### Q15. Write a leaky-bucket queue with overflow on a buffered channel.
**Level:** Middle.

```go
type Leaky struct {
    queue chan func()
    quit  chan struct{}
}

func New(cap, ratePerSec int) *Leaky {
    lb := &Leaky{
        queue: make(chan func(), cap),
        quit:  make(chan struct{}),
    }
    go func() {
        t := time.NewTicker(time.Second / time.Duration(ratePerSec))
        defer t.Stop()
        for {
            select {
            case <-t.C:
                select {
                case fn := <-lb.queue:
                    fn()
                default:
                }
            case <-lb.quit:
                return
            }
        }
    }()
    return lb
}

func (lb *Leaky) Submit(fn func()) error {
    select {
    case lb.queue <- fn:
        return nil
    default:
        return errors.New("overflow")
    }
}
```

**Grading:** Buffered channel. Ticker-driven drain. Non-blocking submit with overflow.

---

## Debugging

### Q16. A service uses `rate.Limiter` and the memory keeps climbing. Where do you look?
**Level:** Middle.
**Answer:** Likely a per-key limiter map without eviction. Check if there's a `map[string]*rate.Limiter` keyed by something high-cardinality (API token, request ID). If so, add TTL or LRU eviction. Verify with `go tool pprof -alloc_space`.

### Q17. A test is flaky around the rate limiter. The expected timing is "5 calls take 400 ms" but it sometimes takes 600 ms. How do you fix it?
**Level:** Middle.
**Answer:** Don't assert on real time. Use `testing/synctest` (Go 1.24+) or inject a `Clock` interface. Real-time tests are inherently flaky on CI runners.

### Q18. After deployment, every request is rejected. The limiter config reads `rate=100, burst=0`. What happened?
**Level:** Middle.
**Answer:** Burst of 0 means the bucket has zero capacity — never admits anything. The config is broken. Validate at startup that `burst >= 1`. Likely an environment-variable parse error (e.g., empty string parsed to 0).

### Q19. Two services share a Redis-backed limiter, and one of them is over-consuming the budget. Why?
**Level:** Senior.
**Answer:** Possible causes: clock skew between services and Redis (use `redis.call("TIME")` in Lua); version mismatch in algorithm (one service still using fixed-window, other using GCRA); different rate config per service; one service has a local-only fallback that doesn't respect Redis state.

### Q20. The limiter blocks all goroutines and the service hangs. What went wrong?
**Level:** Middle.
**Answer:** A few possibilities: someone called `Wait` with no context timeout and the rate is set to 0; the limiter is shared by code that has a circular dependency; the per-key map's mutex is held while making a slow call. Investigate with goroutine dump (`SIGQUIT` or `/debug/pprof/goroutine`).

---

## System Design

### Q21. Design a rate limiter for a multi-tenant API serving 50,000 req/s.
**Level:** Senior.
**Outline:**
- Hierarchical limiters: per-IP (local) → per-user (local) → per-tenant (Redis) → global (Redis).
- Cheap layers first.
- `redis_rate` (GCRA) for the Redis layer.
- Per-tenant tier configuration (free/standard/enterprise) with different rate/burst.
- Failure mode: fall back to local generous limit on Redis failure.
- Metrics: allow/deny counters by tier, Redis failure counter, cardinality gauge.
- Response: `429`, `Retry-After`, `X-RateLimit-*` headers.

### Q22. Your downstream database can handle 5,000 q/s. What rate do you set on the API?
**Level:** Senior.
**Answer:** 70-80% of downstream capacity = ~3,500 q/s. Headroom absorbs jitter, retries, and partial degradation. Split among tiers by expected usage, not equally. Set burst at 1-5× rate based on observed arrival variance.

### Q23. How would you implement adaptive rate limiting?
**Level:** Senior/Professional.
**Outline:**
- AIMD: success += 1, failure ×= 0.5 (or some other multiplicative factor).
- Gradient-based: sample latency over windows, adjust limit based on the sign of the gradient.
- Always cap min/max rate (don't let it drop to 0 or climb to infinity).
- Compare with concurrency limits (`semaphore.Weighted`) — sometimes that's the right tool.

### Q24. A single tenant is hammering the limiter with rejected calls (they ignore `Retry-After`). What can you do?
**Level:** Senior.
**Answer:** Multiple options: increase the cost of a rejection (add a 1 s sleep on reject); push the limit to the load balancer (cheaper rejection at the edge); add a temporary per-tenant ban list; alert and contact the customer. Consider Cloudflare/edge-level rate limiting for repeat offenders.

### Q25. Compare a rate limiter, a semaphore, and a circuit breaker.
**Level:** Senior/Professional.
**Answer:**
- **Rate limiter:** caps event frequency. Allows or rejects based on token bucket / GCRA.
- **Semaphore:** caps concurrent in-flight. Allows or blocks based on slot availability.
- **Circuit breaker:** stops calls entirely after repeated downstream failures. Open/half-open/closed states.
They are complementary: rate limit absorbs steady-state load, semaphore caps fan-out, breaker prevents cascade on downstream failure. Use all three on a critical dependency.

---

## Tricky / Curveball

### Q26. Calling `rate.Limiter` with `Allow()` 10,000 times immediately — what's the long-run admission rate?
**Level:** Middle.
**Answer:** The first `burst` succeed instantly. Subsequent calls in the same instant fail (no tokens). Over long time, admission converges to `rate` events/second. Total admissions in `T` seconds ≈ `burst + rate × T`.

### Q27. `lim := rate.NewLimiter(rate.Inf, 1)` — does it limit anything?
**Level:** Middle.
**Answer:** No. `rate.Inf` means infinite refill rate. The bucket is always full. `Allow()` always returns true. Useful as a "limiter disabled" sentinel.

### Q28. Two goroutines call `Wait` on the same limiter simultaneously. Who goes first?
**Level:** Middle/Senior.
**Answer:** First-come-first-served, but determined by the order in which they acquire the internal mutex. With contention, this is essentially scheduler-dependent. Not deterministic in the strict sense. For fairness, use per-client limiters or a FIFO queue.

### Q29. Can you build a rate limiter without `sync.Mutex`?
**Level:** Senior.
**Answer:** Yes — with atomic CAS on the timestamp. Spin loop: read TAT, compute new TAT, CAS. Faster on hot paths than mutex, but harder to reason about and bounded by CAS retry cost under contention. `rate.Limiter` chose mutex; some custom GCRA implementations choose atomics.

### Q30. Your service receives a `429` from a downstream. The response has `Retry-After: 30`. What do you do?
**Level:** Senior.
**Answer:** Pause that downstream caller for 30 seconds. Use `time.Sleep` if it's a one-off, or a circuit-breaker/queue if there are many in-flight. Do NOT immediately retry — that's what `Retry-After` is preventing. Bonus: surface the limiter state to your own callers so they pause too.

---

## Coding Round: Sliding-Window-Counter

**Prompt:** Implement a thread-safe sliding-window-counter rate limiter. Constructor takes `(limit int, window time.Duration)`. Provide `Allow() bool`.

**Reference solution:**

```go
type SlidingCounter struct {
    mu        sync.Mutex
    window    time.Duration
    limit     int
    prev      int
    curr      int
    currStart time.Time
}

func NewSlidingCounter(limit int, window time.Duration) *SlidingCounter {
    return &SlidingCounter{
        limit:     limit,
        window:    window,
        currStart: time.Now().Truncate(window),
    }
}

func (sc *SlidingCounter) Allow() bool {
    sc.mu.Lock()
    defer sc.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(sc.currStart)
    if elapsed >= sc.window {
        if elapsed >= 2*sc.window {
            sc.prev = 0
        } else {
            sc.prev = sc.curr
        }
        sc.curr = 0
        sc.currStart = now.Truncate(sc.window)
        elapsed = now.Sub(sc.currStart)
    }
    weight := float64(sc.window-elapsed) / float64(sc.window)
    estimate := float64(sc.prev)*weight + float64(sc.curr)
    if estimate >= float64(sc.limit) {
        return false
    }
    sc.curr++
    return true
}
```

**Grading rubric:**
- Correct estimate formula: prev × weight + curr.
- Roll window correctly when crossing boundary.
- Handle long idle (elapsed > 2×window): drop both prev and curr.
- Mutex protects all state.
- Bonus: avoid float arithmetic by scaling to integers; expose `Reset()` / `Snapshot()`.

---

## Quickfire (yes/no/short)

- Q: Is `*rate.Limiter` concurrency-safe? **A:** Yes.
- Q: Does `time.Tick` leak inside a function? **A:** Yes.
- Q: Can you change rate at runtime? **A:** Yes — `lim.SetLimit(newRate)`.
- Q: Is `rate.Inf` allowed? **A:** Yes — disables limiting.
- Q: Is `burst=0` allowed? **A:** Yes — but rejects everything.
- Q: Default fallback when Redis fails? **A:** Depends on policy; commonly "fall back to local".
- Q: Best algorithm for distributed limiting? **A:** GCRA (`redis_rate`).
- Q: What header tells the client when to retry? **A:** `Retry-After`.
- Q: What HTTP status for rate limit? **A:** `429 Too Many Requests`.
- Q: Does `Wait(ctx)` honour context cancellation? **A:** Yes.
