# Rate Limiter — Find the Bug

A curated set of buggy snippets. For each: read the code, identify the bug, explain the symptom, propose a fix. Difficulty rises through the file.

---

## Bug 1: The classic `time.Tick` leak

```go
func handleEvent(ev Event) {
    tick := time.Tick(100 * time.Millisecond)
    for range tick {
        log.Println("processing", ev.ID)
        break
    }
}
```

**Symptom:** Memory grows linearly with the number of calls to `handleEvent`. After a few hours of operation, the process uses gigabytes for no apparent reason.

**Bug:** `time.Tick` creates a `*Ticker` that is never stopped and never garbage-collected. The internal goroutine keeps firing every 100 ms forever. Each call to `handleEvent` leaks one ticker.

**Fix:**

```go
func handleEvent(ev Event) {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    <-t.C
    log.Println("processing", ev.ID)
}
```

Or simpler if you only need one delay:

```go
time.Sleep(100 * time.Millisecond)
log.Println("processing", ev.ID)
```

---

## Bug 2: Limiter per request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    lim := rate.NewLimiter(rate.Limit(10), 5)
    if !lim.Allow() {
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return
    }
    doWork(w, r)
}
```

**Symptom:** No rate limiting in practice. The endpoint always succeeds. Yet the code clearly creates a limiter.

**Bug:** A new limiter per request means each request gets its own bucket with `burst=5` tokens. The bucket starts full. `Allow()` always returns `true` for the first call to a fresh limiter.

**Fix:**

```go
var globalLim = rate.NewLimiter(rate.Limit(10), 5)

func handler(w http.ResponseWriter, r *http.Request) {
    if !globalLim.Allow() {
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return
    }
    doWork(w, r)
}
```

Or use middleware to inject the limiter.

---

## Bug 3: Forgotten `Stop`

```go
func startBackgroundJob() {
    go func() {
        t := time.NewTicker(time.Second)
        for range t.C {
            pollDatabase()
        }
    }()
}
```

**Symptom:** The application gracefully shuts down, but `go vet --gcflags="-m"` still shows references; the ticker keeps allocating timer state on every tick even though the program is about to exit. On long-lived programs that restart this goroutine, ticker objects accumulate.

**Bug:** The goroutine has no exit path; if the goroutine ever needs to terminate (e.g., on context cancellation), the ticker is not stopped. Even if the goroutine lives forever, missing `defer t.Stop()` is a smell that propagates.

**Fix:**

```go
func startBackgroundJob(ctx context.Context) {
    go func() {
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            select {
            case <-t.C:
                pollDatabase()
            case <-ctx.Done():
                return
            }
        }
    }()
}
```

---

## Bug 4: Wrapper counter without atomics

```go
type MyLimiter struct {
    lim       *rate.Limiter
    rejected  int
    accepted  int
}

func (m *MyLimiter) Allow() bool {
    if m.lim.Allow() {
        m.accepted++
        return true
    }
    m.rejected++
    return false
}
```

**Symptom:** Under load, `go test -race` reports a data race on `m.accepted` and `m.rejected`. Counters drift from the true count (some increments are lost).

**Bug:** `*rate.Limiter` is concurrency-safe, but the wrapper's int fields are not. Multiple goroutines call `Allow` concurrently and race on the increments.

**Fix:**

```go
type MyLimiter struct {
    lim       *rate.Limiter
    rejected  atomic.Int64
    accepted  atomic.Int64
}

func (m *MyLimiter) Allow() bool {
    if m.lim.Allow() {
        m.accepted.Add(1)
        return true
    }
    m.rejected.Add(1)
    return false
}
```

---

## Bug 5: `Wait` without context

```go
func processQueue(items []Item) error {
    lim := rate.NewLimiter(rate.Limit(10), 1)
    for _, item := range items {
        lim.Wait(context.Background())
        process(item)
    }
    return nil
}
```

**Symptom:** The function cannot be cancelled. If the caller times out, the goroutine still grinds through 100,000 items.

**Bug:** `context.Background()` never fires. The function ignores cancellation. Even if the call to `Wait` were context-aware, the loop has no way to know about the timeout.

**Fix:**

```go
func processQueue(ctx context.Context, items []Item) error {
    lim := rate.NewLimiter(rate.Limit(10), 1)
    for _, item := range items {
        if err := lim.Wait(ctx); err != nil {
            return err
        }
        if err := process(ctx, item); err != nil {
            return err
        }
    }
    return nil
}
```

---

## Bug 6: Channel limiter without pre-fill

```go
func NewBucket(rate, burst int) *Bucket {
    tokens := make(chan struct{}, burst)
    go func() {
        t := time.NewTicker(time.Second / time.Duration(rate))
        defer t.Stop()
        for range t.C {
            select {
            case tokens <- struct{}{}:
            default:
            }
        }
    }()
    return &Bucket{tokens: tokens}
}
```

**Symptom:** The first `burst` calls to `Allow` (or `Wait`) are paced one tick each, defeating the purpose of `burst`.

**Bug:** The bucket starts empty. The ticker fills it slowly. No pre-fill.

**Fix:**

```go
func NewBucket(rate, burst int) *Bucket {
    tokens := make(chan struct{}, burst)
    for i := 0; i < burst; i++ {
        tokens <- struct{}{}
    }
    // ... rest as before
}
```

---

## Bug 7: Map without mutex

```go
var limiters = map[string]*rate.Limiter{}

func get(key string) *rate.Limiter {
    l, ok := limiters[key]
    if !ok {
        l = rate.NewLimiter(rate.Limit(10), 5)
        limiters[key] = l
    }
    return l
}
```

**Symptom:** Random crashes under load with "concurrent map read and map write" or "fatal error: concurrent map writes."

**Bug:** Go's `map` is not safe for concurrent reads and writes. Multiple goroutines hitting `get` race.

**Fix:**

```go
var (
    mu       sync.Mutex
    limiters = map[string]*rate.Limiter{}
)

func get(key string) *rate.Limiter {
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

Or use `sync.Map`, with the trade-off that you can't easily iterate for eviction.

---

## Bug 8: Map grows forever

```go
var (
    mu       sync.Mutex
    limiters = map[string]*rate.Limiter{}
)

func get(key string) *rate.Limiter {
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

**Symptom:** Memory grows unboundedly when traffic comes from many unique IPs (or API tokens, or user IDs). After a week, the process holds gigabytes of stale limiters.

**Bug:** No eviction. Every unique key adds an entry that is never removed.

**Fix:** Add TTL-based eviction (see middle.md), an LRU cap, or use `redis_rate` for an external store with automatic expiry.

---

## Bug 9: `burst = 0` from config

```go
type Config struct {
    Rate  int `env:"RATE_LIMIT"`
    Burst int `env:"RATE_BURST"`
}

func main() {
    var cfg Config
    env.Parse(&cfg) // RATE_BURST is unset, so Burst stays 0
    lim := rate.NewLimiter(rate.Limit(cfg.Rate), cfg.Burst)
    ...
}
```

**Symptom:** Every request is rejected. The service returns `429` for everything, even when there is no load.

**Bug:** `RATE_BURST` is unset in the deployment; the field defaults to 0; `burst=0` means the bucket has zero capacity; nothing is ever admitted.

**Fix:** Validate config at startup.

```go
if cfg.Burst < 1 {
    log.Fatalf("RATE_BURST must be >= 1, got %d", cfg.Burst)
}
```

Or default to a sensible value:

```go
if cfg.Burst <= 0 {
    cfg.Burst = cfg.Rate // burst = rate by default
}
```

---

## Bug 10: Forgotten `r.Cancel()`

```go
func handler(w http.ResponseWriter, r *http.Request) {
    res := lim.Reserve()
    if !res.OK() {
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return
    }
    if res.Delay() > 100*time.Millisecond {
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return // BUG: didn't cancel; token wasted
    }
    time.Sleep(res.Delay())
    doWork(w, r)
}
```

**Symptom:** Effective rate is below the configured rate. Many tokens are consumed for requests that were rejected.

**Bug:** When the handler decides to reject because of delay, it returns without calling `res.Cancel()`. The token has been consumed but the work was not done — wasted budget.

**Fix:**

```go
if res.Delay() > 100*time.Millisecond {
    res.Cancel()
    http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
    return
}
```

---

## Bug 11: Two limiters, same budget

```go
func main() {
    apiLim := rate.NewLimiter(rate.Limit(100), 10)
    workerLim := rate.NewLimiter(rate.Limit(100), 10)

    go apiServer(apiLim)
    go batchWorker(workerLim)
}
```

**Symptom:** The downstream sees 200 req/s, even though both limiters are configured at 100.

**Bug:** Two independent limiters do not share a budget. Each enforces its own rate. The combined rate is the sum.

**Fix:** Share a single limiter.

```go
sharedLim := rate.NewLimiter(rate.Limit(100), 10)
go apiServer(sharedLim)
go batchWorker(sharedLim)
```

Or split the budget explicitly: 70 for API, 30 for worker.

---

## Bug 12: Sliding-window log never shrinks

```go
type SlidingWindow struct {
    mu     sync.Mutex
    times  []time.Time
    limit  int
    window time.Duration
}

func (sw *SlidingWindow) Allow() bool {
    sw.mu.Lock()
    defer sw.mu.Unlock()
    now := time.Now()
    sw.times = append(sw.times, now) // BUG: appends without trimming
    if len(sw.times) > sw.limit {
        return false
    }
    return true
}
```

**Symptom:** Memory grows linearly with traffic. Every allowed *and* every rejected request appends to the slice. The `>limit` check never trims old entries.

**Bug:** Two bugs:
1. The slice is never trimmed of expired entries.
2. The check is done after appending, so rejected requests still grow the slice.

**Fix:**

```go
func (sw *SlidingWindow) Allow() bool {
    sw.mu.Lock()
    defer sw.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-sw.window)
    i := 0
    for ; i < len(sw.times) && sw.times[i].Before(cutoff); i++ {
    }
    sw.times = sw.times[i:]
    if len(sw.times) >= sw.limit {
        return false
    }
    sw.times = append(sw.times, now)
    return true
}
```

---

## Bug 13: Limiter and semaphore mixed up

```go
// "We need to limit to 10 concurrent uploads"
var lim = rate.NewLimiter(rate.Limit(10), 1)

func upload(ctx context.Context, file File) error {
    if err := lim.Wait(ctx); err != nil {
        return err
    }
    return slowUpload(file)
}
```

**Symptom:** During a slow downstream, 100 uploads pile up — all "rate-limited" at 10/s but each taking 60 s. Concurrency reaches 60 × 10 = 600 simultaneous uploads.

**Bug:** Rate limit ≠ concurrency limit. A rate limiter caps frequency. A semaphore caps concurrent in-flight. If you want "max 10 in flight," use `semaphore.Weighted` or a buffered channel.

**Fix:**

```go
var sem = semaphore.NewWeighted(10)

func upload(ctx context.Context, file File) error {
    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer sem.Release(1)
    return slowUpload(file)
}
```

---

## Bug 14: Limiter shared by unrelated tenants

```go
var sharedLim = rate.NewLimiter(rate.Limit(100), 50)

func handler(w http.ResponseWriter, r *http.Request) {
    if !sharedLim.Allow() {
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return
    }
    serve(w, r)
}
```

**Symptom:** When one tenant's traffic spikes, every other tenant gets rejected. One bad actor breaks everyone.

**Bug:** A single global limiter does not distinguish callers. One client can consume the entire budget.

**Fix:** Per-tenant limiters with a backstop global.

```go
var (
    mu      sync.Mutex
    perKey  = map[string]*rate.Limiter{}
    global  = rate.NewLimiter(rate.Limit(1000), 500) // backstop
)

func handler(w http.ResponseWriter, r *http.Request) {
    key := r.Header.Get("X-API-Key")
    mu.Lock()
    lim, ok := perKey[key]
    if !ok {
        lim = rate.NewLimiter(rate.Limit(100), 50)
        perKey[key] = lim
    }
    mu.Unlock()

    if !lim.Allow() {
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return
    }
    if !global.Allow() {
        http.Error(w, "Service Busy", http.StatusServiceUnavailable)
        return
    }
    serve(w, r)
}
```

---

## Bug 15: Redis script without atomicity

```go
func Allow(ctx context.Context, rdb *redis.Client, key string, limit int, windowSec int) (bool, error) {
    n, err := rdb.Incr(ctx, key).Result()
    if err != nil {
        return false, err
    }
    if n == 1 {
        rdb.Expire(ctx, key, time.Duration(windowSec)*time.Second)
    }
    return n <= int64(limit), nil
}
```

**Symptom:** Some keys never expire. Memory in Redis grows over time. Spot-check: a key created in burst conditions can exist for hours.

**Bug:** `INCR` and `EXPIRE` are two separate round-trips. If the process crashes (or is killed, or times out) between them, the key is created with no TTL and lives forever.

**Fix:** Use a Lua script for atomicity.

```lua
local current = redis.call("INCR", KEYS[1])
if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return (current <= tonumber(ARGV[1])) and 1 or 0
```

```go
var script = redis.NewScript(`...`)
```

---

## Bug 16: Limiter on `/health`

```go
func main() {
    mux := http.NewServeMux()
    mux.Handle("/health", healthHandler{})
    mux.Handle("/api/", apiHandler{})

    rl := RateLimit(rate.Limit(10), 5)
    http.ListenAndServe(":8080", rl(mux))
}
```

**Symptom:** During a traffic spike, the load balancer's health-check fails because the limiter rejects `/health`. The LB pulls instances out of rotation, exacerbating the spike.

**Bug:** The middleware blanket-applies to everything, including health checks.

**Fix:** Carve out the health-check path.

```go
mux := http.NewServeMux()
mux.Handle("/health", healthHandler{})
mux.Handle("/api/", rl(apiHandler{}))
http.ListenAndServe(":8080", mux)
```

Or use a router (chi, gorilla/mux) that supports per-route middleware.

---

## Bug 17: Adaptive limiter unbounded growth

```go
type Adaptive struct {
    rate atomic.Int64 // in events per second
}

func (a *Adaptive) OnSuccess() { a.rate.Add(1) }
func (a *Adaptive) OnFailure() {
    cur := a.rate.Load()
    a.rate.Store(cur / 2)
}
```

**Symptom:** In a low-failure environment, `rate` grows to absurd values (1 million events/s). When a real failure happens, the halving doesn't keep up — the system is over capacity for minutes.

**Bug:** No upper bound on `rate`. AIMD without a cap.

**Fix:**

```go
type Adaptive struct {
    rate    atomic.Int64
    minRate int64
    maxRate int64
}

func (a *Adaptive) OnSuccess() {
    for {
        cur := a.rate.Load()
        next := cur + 1
        if next > a.maxRate {
            next = a.maxRate
        }
        if a.rate.CompareAndSwap(cur, next) {
            return
        }
    }
}
```

(Plus a min cap on `OnFailure`.)

---

## Bug 18: Wait with cancellation but no cleanup

```go
func process(ctx context.Context, items []Item) error {
    lim := rate.NewLimiter(rate.Limit(10), 1)
    var wg sync.WaitGroup
    for _, item := range items {
        item := item
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := lim.Wait(ctx); err == nil {
                process(item)
            }
        }()
    }
    wg.Wait()
    return ctx.Err()
}
```

**Symptom:** When `ctx` is cancelled, many goroutines are still parked in `lim.Wait`. They wake up (with `ctx.Err()` returned), but the function returns `ctx.Err()` even if all items completed before cancellation. Also: thousands of goroutines parked in timers.

**Bug:** Fan-out behind a rate limiter creates exactly the contention `Wait` is supposed to absorb. The goroutines all wait, but cancellation orphans them on timers.

**Fix:** Process sequentially, or batch, or use a worker pool with bounded concurrency.

```go
func process(ctx context.Context, items []Item) error {
    lim := rate.NewLimiter(rate.Limit(10), 1)
    for _, item := range items {
        if err := lim.Wait(ctx); err != nil {
            return err
        }
        if err := processItem(ctx, item); err != nil {
            return err
        }
    }
    return nil
}
```

---

## Bug 19: Reading rate from env without validation

```go
rateStr := os.Getenv("RATE")
rate, _ := strconv.ParseFloat(rateStr, 64)
lim := rate.NewLimiter(rate.Limit(rate), 1)
```

**Symptom:** If `RATE` is `"ten"` or unset, `rate` becomes 0. The limiter rejects everything.

**Bug:** Ignored error from `strconv.ParseFloat`. Zero-valued config silently breaks.

**Fix:**

```go
rateStr := os.Getenv("RATE")
if rateStr == "" {
    log.Fatal("RATE environment variable required")
}
rateVal, err := strconv.ParseFloat(rateStr, 64)
if err != nil || rateVal <= 0 {
    log.Fatalf("invalid RATE %q", rateStr)
}
lim := rate.NewLimiter(rate.Limit(rateVal), 1)
```

---

## Bug 20: Distributed limiter clock skew

```lua
-- Lua script: leaky bucket using current time from the client
local now = tonumber(ARGV[3])
local elapsed = (now - tonumber(redis.call("HGET", KEYS[1], "ts"))) / 1000
...
```

**Symptom:** When clients have skewed clocks (or different time zones), the limiter behaviour is inconsistent. Some clients get rejected based on a "future" timestamp.

**Bug:** Trusting `now` from the client. NTP-synced systems differ by milliseconds; misconfigured systems differ by seconds or hours.

**Fix:** Use Redis's clock inside the script.

```lua
local redis_time = redis.call("TIME")
local now = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
```

`TIME` returns `[seconds, microseconds]`. Converting to milliseconds is straightforward.

---

Each of these bugs is from real production code (anonymised). They illustrate the same recurring theme: the algorithm is the easy part; the operational and concurrency contracts are where mistakes hide. Read them, replicate them, fix them yourself. The next time you see one in code review, you will recognise it instantly.
