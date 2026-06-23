# Rate Limiter — Optimize

A walkthrough of common performance issues in rate limiter code, with profiling tools, benchmark numbers, and rewrites. Every section pairs a slow version with a fast one and explains the gap.

---

## 1. Channel-based limiter vs `rate.Limiter`

### Slow

```go
type ChanLim struct {
    tokens chan struct{}
}

func NewChanLim(r, b int) *ChanLim {
    cl := &ChanLim{tokens: make(chan struct{}, b)}
    for i := 0; i < b; i++ {
        cl.tokens <- struct{}{}
    }
    go func() {
        t := time.NewTicker(time.Second / time.Duration(r))
        defer t.Stop()
        for range t.C {
            select {
            case cl.tokens <- struct{}{}:
            default:
            }
        }
    }()
    return cl
}

func (c *ChanLim) Allow() bool {
    select {
    case <-c.tokens:
        return true
    default:
        return false
    }
}
```

### Fast

```go
lim := rate.NewLimiter(rate.Limit(r), b)
lim.Allow()
```

### Benchmark (Apple M2, Go 1.22, single goroutine)

```
BenchmarkChanLim-8     12000000   105 ns/op   0 B/op   0 allocs/op
BenchmarkRateLimiter-8 38000000    31 ns/op   0 B/op   0 allocs/op
```

### Why

- `ChanLim` allocates a goroutine and a ticker (memory + scheduler overhead).
- Each `Allow` does a select-send on a channel — channel ops cost ~50-100 ns.
- The background ticker fires whether or not anyone is consuming.

`rate.Limiter` uses lazy fill: a mutex acquire and a few float ops. The constant factor is 3× to 4× better, plus no background goroutine.

### When the channel version is right

Only when you actually need the queueing/shaping semantics of a leaky bucket. For pure token-bucket, `rate.Limiter` wins.

---

## 2. Per-key map: mutex contention

### Slow

```go
var (
    mu sync.Mutex
    m  = map[string]*rate.Limiter{}
)

func get(key string) *rate.Limiter {
    mu.Lock()
    defer mu.Unlock()
    l, ok := m[key]
    if !ok {
        l = rate.NewLimiter(100, 50)
        m[key] = l
    }
    return l
}
```

At 50,000 req/s, the mutex is held ~50,000 times/s. Under contention, p99 latency on `get` spikes to milliseconds.

### Fast: sharded map

```go
const shards = 64

type ShardedLimMap struct {
    shards [shards]struct {
        mu sync.Mutex
        m  map[string]*rate.Limiter
    }
}

func New() *ShardedLimMap {
    s := &ShardedLimMap{}
    for i := range s.shards {
        s.shards[i].m = make(map[string]*rate.Limiter)
    }
    return s
}

func (s *ShardedLimMap) Get(key string) *rate.Limiter {
    h := fnv.New32a()
    h.Write([]byte(key))
    sh := &s.shards[h.Sum32()%shards]
    sh.mu.Lock()
    defer sh.mu.Unlock()
    l, ok := sh.m[key]
    if !ok {
        l = rate.NewLimiter(100, 50)
        sh.m[key] = l
    }
    return l
}
```

64 shards = 64× less contention. Even better with `sync.Map` for read-mostly workloads — but `sync.Map` doesn't iterate cleanly for eviction.

### Benchmark (8 goroutines, 1 M keys, lookup-heavy)

```
BenchmarkSingleMap-8    3000000   415 ns/op
BenchmarkShardedMap-8  18000000    62 ns/op
```

---

## 3. Eviction sweep: iteration cost

### Slow

```go
func sweep(m map[string]*entry, cutoff int64) {
    for k, e := range m {
        if e.seen.Load() < cutoff {
            delete(m, k)
        }
    }
}
```

For 10 M entries: ~500 ms holding the mutex. All requests block for half a second.

### Fast: chunked sweep

```go
func sweep(m map[string]*entry, cutoff int64, batchSize int) {
    var batch []string
    for k, e := range m {
        if e.seen.Load() < cutoff {
            batch = append(batch, k)
            if len(batch) >= batchSize {
                break
            }
        }
    }
    for _, k := range batch {
        delete(m, k)
    }
}
```

Run repeatedly with `batchSize = 10,000`. Each pass holds the mutex for ~5 ms. Total work is the same; latency tail is much better.

### Better: LRU with O(1) eviction

`hashicorp/golang-lru/v2` evicts the LRU item on insertion. No scan. O(1) per access.

```go
cache, _ := lru.New[string, *rate.Limiter](100_000)
get := func(k string) *rate.Limiter {
    if l, ok := cache.Get(k); ok {
        return l
    }
    l := rate.NewLimiter(100, 50)
    cache.Add(k, l)
    return l
}
```

Memory is bounded. Eviction cost is amortised over inserts.

---

## 4. Redis hot key contention

### Slow

```go
res, _ := limiter.Allow(ctx, "global", redis_rate.PerSecond(1000))
```

Every request hits the same Redis key. The Redis shard handling that key tops out at ~100 K ops/s (one Redis instance). Beyond that, Redis becomes the bottleneck.

### Fast: sharded keys

```go
shardIdx := rand.Intn(10)
key := fmt.Sprintf("global:shard%d", shardIdx)
res, _ := limiter.Allow(ctx, key, redis_rate.PerSecond(100)) // 100/s × 10 shards = 1000/s
```

Each shard handles 1/N of the budget. Throughput scales with shard count. Loose enforcement: any single shard can be over-budget temporarily, but the average is correct.

### Caveat

Sharding the limiter loosens correctness. A bursty client can pick a "fresh" shard repeatedly. For strict global limits, use a single key on a dedicated Redis cluster; for soft limits, sharding is fine.

---

## 5. Lua script overhead

### Slow

```go
script := `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[2])
    end
    if current > tonumber(ARGV[1]) then
        return 0
    end
    return 1
`
rdb.Eval(ctx, script, []string{key}, limit, window)
```

`Eval` ships the script every time. Network bytes + Redis parsing on every call.

### Fast: `EvalSha` with cached script

```go
var script = redis.NewScript(`...same...`)

// First call: SCRIPT LOAD, then EVALSHA.
// Subsequent: EVALSHA only.
script.Run(ctx, rdb, []string{key}, limit, window)
```

`go-redis`'s `NewScript` handles `EVALSHA` with fallback to `EVAL` if `NOSCRIPT`. Saves ~100 bytes per call.

For high QPS, this matters; for moderate QPS, it doesn't.

---

## 6. Pipelining Redis calls

### Slow

```go
for _, key := range keys {
    res, _ := limiter.Allow(ctx, key, lim)
    handle(key, res)
}
```

N requests = N round-trips. At 1 ms RTT and 100 keys, 100 ms total.

### Fast: pipeline

```go
pipe := rdb.Pipeline()
results := make([]*redis.Cmd, len(keys))
for i, key := range keys {
    results[i] = pipe.Eval(ctx, script, []string{key}, lim, window)
}
_, err := pipe.Exec(ctx)
```

One round-trip for all 100 calls. 1 ms total.

Limitation: not all rate-limit libraries support pipelining out of the box. `redis_rate` v10 has `AllowAtMost` for batch-style calls; for custom Lua, you must pipeline manually.

---

## 7. `Wait` vs `Allow` on hot paths

### Slow

```go
func process(ctx context.Context, items []Item) {
    var wg sync.WaitGroup
    for _, item := range items {
        item := item
        wg.Add(1)
        go func() {
            defer wg.Done()
            lim.Wait(ctx)
            do(item)
        }()
    }
    wg.Wait()
}
```

10,000 items × `Wait` each = 10,000 goroutines parked in timers. At rate 100/s, the tail goroutine waits 100 s.

### Fast: sequential with `Wait`

```go
func process(ctx context.Context, items []Item) {
    for _, item := range items {
        if err := lim.Wait(ctx); err != nil {
            return
        }
        do(item)
    }
}
```

One goroutine. Memory linear in nothing. Same total elapsed time.

### Faster: bounded concurrency

```go
sem := make(chan struct{}, 10) // 10 in flight
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        lim.Wait(ctx)
        do(item)
    }(item)
}
```

Combines rate limit (overall pacing) with concurrency cap (max 10 in flight). Best of both.

---

## 8. `Reserve` instead of `Allow` for "would have to wait" rejection

### Slow (with extra delay)

```go
if !lim.Allow() {
    reject()
    return
}
do() // proceed
```

If the bucket has 0.9 tokens and the request needs 1, `Allow` says no. But if the caller could wait 50 ms cheaply, that would be better.

### Fast: introspect with `Reserve`

```go
r := lim.Reserve()
if !r.OK() {
    reject()
    return
}
d := r.Delay()
if d > 100*time.Millisecond {
    r.Cancel()
    reject()
    return
}
time.Sleep(d)
do()
```

Lets you accept short waits, reject long ones. More throughput, predictable tail.

Cost: more code, more thinking. Use only when the latency target justifies it.

---

## 9. Removing the per-call mutex

`rate.Limiter` takes a mutex on every call. At 10 M ops/s aggregate, that mutex shows up in profiles.

### Faster: lock-free GCRA with atomic CAS

```go
type FastGCRA struct {
    tat    atomic.Int64 // nanoseconds since epoch
    rate   int64        // ns per token (T)
    burst  int64        // tau in ns
}

func (g *FastGCRA) Allow() bool {
    for {
        now := time.Now().UnixNano()
        tat := g.tat.Load()
        if tat < now {
            tat = now
        }
        if tat-now > g.burst {
            return false
        }
        newTat := tat + g.rate
        if g.tat.CompareAndSwap(g.tat.Load(), newTat) {
            return true
        }
        // CAS failed: retry.
    }
}
```

No mutex. Under low contention, faster than `rate.Limiter`. Under high contention, CAS retries can spin — sometimes worse than a mutex.

**Profile both** before choosing. The constant-factor savings is small (10-20 ns) compared to typical request processing time. Only worth it on extreme hot paths.

---

## 10. Reduce allocations in error paths

### Slow

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if !lim.Allow() {
        log.Printf("rate limited: ip=%s path=%s", r.RemoteAddr, r.URL.Path)
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return
    }
    do()
}
```

Under attack, `log.Printf` allocates a buffer per call. Logs flood. CPU is wasted on logging instead of legitimate traffic.

### Fast: sample logging

```go
var counter atomic.Int64
func handler(w http.ResponseWriter, r *http.Request) {
    if !lim.Allow() {
        if counter.Add(1)%1000 == 0 {
            log.Printf("rate limited: ip=%s path=%s (sampled 1/1000)", r.RemoteAddr, r.URL.Path)
        }
        http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
        return
    }
    do()
}
```

Reduces logging cost to 1/1000. Adjust the sampling rate by observed attack volume.

### Even faster: precomputed response

```go
var tooManyRequestsBody = []byte("Too Many Requests\n")

w.Header().Set("Content-Type", "text/plain")
w.Header().Set("Retry-After", "1")
w.WriteHeader(http.StatusTooManyRequests)
w.Write(tooManyRequestsBody)
```

`http.Error` formats a string and writes headers — small per-call cost, but it adds up at attack scale. A precomputed response is the cheapest possible reject path.

---

## 11. Profile-guided choices

Run a load test. Capture profiles:

```bash
go test -bench BenchmarkHandler -cpuprofile cpu.prof
go tool pprof cpu.prof
```

Look for:
- Time in `runtime.timerproc` → too many `Wait` waiters → switch to `Allow` or cap concurrency.
- Time in `runtime.lock` → mutex contention → shard the limiter map.
- Time in `redis.(*Client).Do` → Redis is the bottleneck → pipeline or shard keys.
- Time in `log.Printf` or `json.Marshal` on the reject path → cache and pre-format.

Allocations:

```bash
go test -bench BenchmarkHandler -memprofile mem.prof -benchmem
go tool pprof -alloc_space mem.prof
```

A clean rate-limit check should be 0 allocs/op (after a warmup). If you see allocations, find the cause: a `fmt.Sprintf` for a key, a `time.Duration` formatting, a header write.

---

## 12. Benchmark suite to keep

Maintain a benchmark file for the limiter you deploy. Run on every change:

```go
func BenchmarkAllow(b *testing.B) {
    lim := rate.NewLimiter(rate.Limit(1_000_000), 1000)
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            lim.Allow()
        }
    })
}

func BenchmarkPerKey(b *testing.B) {
    m := NewShardedLimMap()
    keys := []string{"a", "b", "c", "d"} // hot keys
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            m.Get(keys[i%len(keys)]).Allow()
            i++
        }
    })
}
```

Compare across commits. Regressions become visible.

---

## Cheat Sheet

```
Pick rate.Limiter over channel-based unless you need leaky-bucket queueing.
Shard per-key maps once you exceed ~10K keys.
Use LRU eviction (hashicorp/golang-lru/v2) over manual TTL sweep.
Pipeline Redis calls for batch operations.
Reserve+Cancel for "short wait OK, long wait reject" semantics.
Sample logs on the reject path.
Precompute the reject response body.
Profile before optimising. Allocate budget by data, not intuition.
```

---

## Summary

The default `rate.Limiter` is fast — 31 ns/op, 0 allocations. Most rate-limit code can stay at this level. Optimization shows up at high QPS with cardinality (per-key maps), at scale across the fleet (Redis), or in pathological reject conditions (attacks).

The right answer is almost always: profile first. A measured 0.5 ms in `runtime.timerproc` is a real signal; a hand-tuned lock-free GCRA on a non-hot path is premature. Trust `rate.Limiter` and `redis_rate` until your traces say otherwise.
