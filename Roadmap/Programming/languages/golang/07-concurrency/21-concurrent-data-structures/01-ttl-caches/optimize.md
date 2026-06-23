---
layout: default
title: Optimize
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/optimize/
---

# TTL Caches — Optimization Scenarios

> Ten profiler-driven scenarios. Each one starts with a baseline implementation that "works", presents the measurement that proves it does not scale, then walks through the optimisation that fixes the problem. The point is not to memorise the answer; the point is to recognise the *shape* of each bottleneck so you can spot it in your own caches.

A few ground rules:

- All benchmarks assume Go 1.22+ on a modern multi-core laptop (8 physical cores, 16 hardware threads).
- "Throughput" is reported as operations per second per goroutine, summed across goroutines.
- "p99" is the 99th-percentile per-operation latency.
- Every "before" implementation is plausible code that has shipped to production at least once.

---

## Scenario 1 — Lock contention on a single `RWMutex`

### Before

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]entry
}

func (c *Cache) Get(key string) ([]byte, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[key]
    if !ok || time.Now().After(e.expiresAt) {
        return nil, false
    }
    return e.value, true
}

func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: v, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
}
```

### Measurement

Benchmark with 16 goroutines, 80% Get / 20% Set, 1 M ops total:

```
BenchmarkCache_1Shard-16    1.8M ops    230 ns/op    p99 = 12 µs
```

The CPU profile (`pprof -top`) shows ~40% in `sync.RWMutex.RLock` and ~25% in `sync.RWMutex.Lock`. Lock contention is the bottleneck — every operation waits behind every other operation. The mutex *itself* is not slow; the contention is.

Critically: even `RLock` is contended, because the `Set`s convert the mutex into a write-locked state that excludes all readers. Under 20% writes, the read-friendliness of `RWMutex` is mostly wasted.

### The optimisation: shard

```go
const shardCount = 256 // power of two for fast mask

type Sharded struct {
    shards [shardCount]*Cache
}

func (s *Sharded) shardFor(key string) *Cache {
    h := fnv64a(key)
    return s.shards[h&(shardCount-1)]
}

func (s *Sharded) Get(key string) ([]byte, bool) {
    return s.shardFor(key).Get(key)
}

func (s *Sharded) Set(key string, v []byte, ttl time.Duration) {
    s.shardFor(key).Set(key, v, ttl)
}
```

Each shard has its own `RWMutex`. Two goroutines with different keys hash to different shards and never contend.

### After

```
BenchmarkCache_256Shard-16    35M ops    33 ns/op    p99 = 1.1 µs
```

Roughly 19x throughput, 11x lower p99. The remaining cost is the hash function (~10 ns) plus an uncontended `RLock` (~7 ns) plus the map lookup (~15 ns).

### What to remember

- Sharding is the single most effective scaling technique for any contended map.
- 256 shards is a defensible default; 16 is too few for a 16-thread machine, 4096 is wasted memory.
- Power-of-two count enables a mask (`h & (N-1)`) instead of a modulo (`h % N`); modulo on a 64-bit integer is roughly 5 ns, mask is roughly 0.3 ns.
- Watch for the *false-sharing* trap: if shards are stored contiguously in memory, two CPU cores writing to neighbouring shards may evict each other's cache lines. Pad each shard to a cache line (typically 64 bytes); the `sync.Mutex` already takes ~8 bytes, so add a `[56]byte` padding field if benchmarks show false sharing.

---

## Scenario 2 — The sweep goroutine that is pure overhead

### Before

Every shard runs a sweeper. With 256 shards and a 1 s sweep interval:

- 256 goroutines wake up once per second.
- Each takes the shard lock, scans `len(data)` entries, deletes the expired ones.
- For a cache with very-short TTLs (e.g. 5 s session tokens that mostly get read once and discarded), 90% of entries expire before the next sweep tick *anyway*. The sweeper is doing work that lazy delete would have done for free.

A profile under read-dominated load shows:

```
sweep:    18% of CPU
Get:      45% of CPU
runtime:  37% of CPU
```

18% of all CPU is going to a goroutine that mostly removes entries that nobody was about to read. That is pure waste.

### The optimisation: eliminate active sweep, rely on lazy + probabilistic sweep

Drop the sweeper entirely. Adopt Redis's strategy:

- *Lazy delete* on every `Get` of an expired key.
- *Probabilistic sweep on Set*: on every `Set`, with probability `1/N`, pick K random keys and delete the expired ones among them.

```go
const (
    probeFreq = 100 // 1 in 100 sets triggers a probe
    probeK    = 20  // each probe inspects 20 random keys
)

func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: v, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
    c.maybeProbeSweep()
}

func (c *Cache) maybeProbeSweep() {
    if rand.IntN(probeFreq) != 0 {
        return
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    n := 0
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
        n++
        if n >= probeK {
            return
        }
    }
}
```

### After

Sweep CPU drops to ~0%. Total throughput rises by ~22%. Memory stabilises after the first few seconds of inserts — the probabilistic sweep finds and reaps expired entries at roughly the same rate they accumulate, because *every* Set has a chance to clean up.

### What to remember

- Active sweepers are only worth their cost when the cache has long-TTL entries that would otherwise leak between rare accesses.
- For short-TTL or write-heavy workloads, lazy + probabilistic sweep is almost always faster.
- The Redis approach scales because the probability `1/N` and the budget `K` are *constants* — total sweep work is bounded regardless of cache size.

---

## Scenario 3 — The min-heap that re-allocates forever

### Before

```go
type item struct {
    key       string
    expiresAt time.Time
}

func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: v, expiresAt: time.Now().Add(ttl)}
    heap.Push(&c.h, &item{key: key, expiresAt: time.Now().Add(ttl)})
    c.mu.Unlock()
}
```

A pprof allocation profile shows that `Set` allocates ~96 bytes per call: 48 bytes for the `item` (heap-allocated because of the `*item`), 24 bytes for the string header (copied), and overhead.

At 1 M Sets/sec, that is 96 MB/sec of garbage feeding the GC. GC pauses become measurable.

### The optimisation: value-typed heap items + pre-sized backing slice

```go
type item struct {
    key       string
    expiresAt int64 // unix nanos, no monotonic
    gen       uint64
}

type pq []item // value-typed, contiguous

func (p pq) Len() int           { return len(p) }
func (p pq) Less(i, j int) bool { return p[i].expiresAt < p[j].expiresAt }
func (p pq) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)        { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
    old := *p
    n := len(old)
    it := old[n-1]
    *p = old[:n-1]
    return it
}

func NewCache(capHint int) *Cache {
    c := &Cache{
        data: make(map[string]entry, capHint),
        h:    make(pq, 0, capHint),
    }
    return c
}
```

Three changes:

1. **Value-typed `item`** instead of `*item`. The heap's backing array is now a contiguous `[]item`; each `Push` is an append into a slice, not a separate allocation.
2. **`int64` instead of `time.Time`** for `expiresAt`. `time.Time` is 24 bytes and has comparison overhead from monotonic-clock handling; `int64` is 8 bytes and compares with one instruction.
3. **Pre-size the backing slice** in `New` to avoid the early `growslice` calls.

### After

`Set` allocates 0 bytes per call once the backing slice is sized. Set throughput rises by ~30%. GC pause p99 drops from 1.2 ms to 0.18 ms.

### What to remember

- Container types that hold pointers force heap allocation. Value types in slices stay on one big heap allocation.
- `time.Time` is convenient but expensive. For internal comparisons, store `int64` and convert at the API boundary.
- Pre-sizing slices and maps removes the early-growth tax.
- The `heap.Interface` design tolerates a value-typed implementation: `Push` takes `any`, you type-assert and `append`; no boxing of pointers required.

---

## Scenario 4 — Switching to `ristretto`

### Before

A custom sharded cache with min-heap, ~30 M Get/sec at p99 = 1 µs. Memory grows to ~3 GB before the 100 000-entry cap is enforced, because the cap counts entries but each entry stores 30 KB blobs.

The product team also wants:

- Hit ratio above 95% on a Zipfian access pattern, *without* manually tuning eviction.
- Cost-based admission (each entry has a size; bigger entries cost more to evict).
- A "background refresh" capability — entries that are close to expiry get re-loaded asynchronously before they go cold.

You could build these. Or you could adopt [`github.com/dgraph-io/ristretto`](https://github.com/dgraph-io/ristretto).

### The optimisation: replace with `ristretto`

```go
cache, _ := ristretto.NewCache(&ristretto.Config{
    NumCounters: 1e7,       // 10x estimated keys, for the TinyLFU sketch
    MaxCost:     1 << 30,   // 1 GB
    BufferItems: 64,        // batch Get bookkeeping
})

cache.SetWithTTL("user:42", payload, int64(len(payload)), 5*time.Minute)

v, ok := cache.Get("user:42")
```

What you get:

- **TinyLFU admission policy**: incoming entries are admitted only if their estimated frequency exceeds the current victim's. Hit ratio on Zipfian workloads is dramatically higher than LRU.
- **Cost-aware eviction**: the cache tracks total cost (you supply the per-entry cost). At capacity, victims are chosen by cost-weighted frequency.
- **Sharded internally** (256 shards by default). No external sharding wrapper needed.
- **Bounded memory**: a hard cap on cost, not on entry count.
- **Lock-free reads** through `sync.Pool`-backed ring buffers that batch Get bookkeeping. The actual read path takes ~30 ns per call under contention.

### After

Get throughput: ~60 M/sec under contention. Hit ratio on a 100 000-key Zipfian workload: 96.8% vs 78% for a same-sized LRU. Memory: bounded to MaxCost.

### What to remember

- `ristretto` is the standard answer for read-heavy in-process caches in Go where you want production-grade hit ratio without hand-tuning.
- It does *not* support range queries, transactions, or atomic read-modify-write. If you need those, you do not need a cache.
- The "right" admission policy is hard; reading the [TinyLFU paper](https://arxiv.org/abs/1512.00727) once is a high-leverage hour.

---

## Scenario 5 — Switching to `bigcache`

### Before

You have a 100 M-entry cache holding `[]byte` blobs. GC pause times are 200 ms. Every GC cycle scans every entry's pointer in your map. The cache itself is fast; the GC is killing you.

```
gc 47 @120.83s 4%: 0.064+205+0.052 ms clock
gc 48 @123.34s 4%: 0.071+211+0.048 ms clock
```

p99 latency on every endpoint that touches the cache is ~220 ms during GC. Customer-facing.

### The optimisation: replace with `bigcache` (or build the same idea)

`bigcache` stores everything in pre-allocated `[]byte` arenas. The map is keyed on a hash of the user key; the value is a triple `(arenaIdx, offset, length)`. Critically, the GC sees only a handful of pointers — the arena slices themselves — and never walks the 100 M entries.

```go
cfg := bigcache.DefaultConfig(10 * time.Minute)
cfg.Shards = 1024
cfg.MaxEntriesInWindow = 100 * 1000 * 1000
cfg.MaxEntrySize = 4 * 1024 // bytes
cfg.HardMaxCacheSize = 1024 // MB
cache, _ := bigcache.New(context.Background(), cfg)

cache.Set("user:42", payload)
v, err := cache.Get("user:42")
```

### After

GC pause: drops from 200 ms to ~5 ms. Total CPU spent in GC: from 4% to 0.2%. Cache throughput is roughly the same — `bigcache` adds a `memcpy` per Set/Get (the value is copied into and out of the arena), so individual ops are *slightly* slower (~50 ns vs ~30 ns), but the p99 of the *whole system* improves enormously.

### What to remember

- The Go GC is excellent up to ~10 M heap objects. Beyond that, scanning costs dominate.
- Byte-arena caches (`bigcache`, `freecache`, `fastcache`) trade per-op latency for GC-friendliness. They are the right call when the cache dwarfs the rest of the heap.
- `bigcache` does *not* support per-entry TTLs — only a single global TTL set at construction. If you need per-entry TTLs, `fastcache` and `freecache` are alternatives, or build the arena layer yourself.

---

## Scenario 6 — Reducing allocations on the hot path

### Before

```go
func (c *Cache) Get(key string) ([]byte, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[key]
    if !ok {
        return nil, false
    }
    if time.Now().After(e.expiresAt) {
        return nil, false
    }
    out := make([]byte, len(e.value))
    copy(out, e.value)
    return out, true
}
```

The defensive copy is there to prevent the caller from mutating the cached entry. It allocates on *every* `Get`.

A 1 M-Get/sec workload allocates ~30 GB/sec into the heap (if entries are 30 KB). GC churns; CPU is spent on `runtime.makeslice`.

### The optimisation: return immutable bytes, document the contract

If callers respect "do not mutate", the defensive copy is pure cost. Document the contract and return the slice directly:

```go
// Get returns the value for key, or (nil, false) if missing or expired.
// The returned slice MUST NOT be mutated by the caller; the cache owns
// the backing memory. Copy it if you need to modify.
func (c *Cache) Get(key string) ([]byte, bool) { ... }
```

Allocation per `Get` drops to zero. The trade-off is API discipline: a caller that mutates corrupts the cache.

For higher safety with low cost, return a wrapper that prevents mutation at compile time:

```go
type View struct {
    b []byte
}

func (v View) At(i int) byte   { return v.b[i] }
func (v View) Len() int        { return len(v.b) }
func (v View) WriteTo(w io.Writer) (int64, error) {
    n, err := w.Write(v.b)
    return int64(n), err
}

func (c *Cache) Get(key string) (View, bool) { ... }
```

`View` exposes read-only operations. The caller cannot accidentally mutate, but writes (`io.Writer.Write`) can still consume the bytes zero-copy.

### After

Allocation drops by ~30 GB/sec. Get throughput rises by ~70%. GC cost falls from 12% to <1% of CPU.

### What to remember

- "Just copy on Get" is the default defensive style, and it has a real cost.
- For large or hot caches, design the API so the caller takes responsibility for not mutating. Most callers do not mutate; the few who do can copy explicitly.
- A typed `View` is a low-cost middle ground when you want compile-time protection.

---

## Scenario 7 — Replacing `time.Now()` with `runtime.nanotime`

### Before

Every `Get` calls `time.Now()`. On Linux, this is one `vDSO` call (~25 ns). At 100 M Get/sec across all cores, that is ~2.5 seconds of CPU per real second spent reading the clock.

```
time.Now    -- 18% of CPU samples
```

### The optimisation: cache the wall clock at coarse intervals

You do not need nanosecond-fresh time for TTL expiry. You need "approximately now, plus or minus a millisecond". A single background goroutine updates a shared `atomic.Int64` once per millisecond:

```go
var nowNanos atomic.Int64

func init() {
    nowNanos.Store(time.Now().UnixNano())
    go func() {
        t := time.NewTicker(time.Millisecond)
        for range t.C {
            nowNanos.Store(time.Now().UnixNano())
        }
    }()
}

func cheapNow() int64 { return nowNanos.Load() }
```

Reads are now a single atomic load (~3 ns) instead of a `vDSO` call (~25 ns).

### After

`Get` p99 drops by ~12 ns. At 100 M ops/sec, that is 1.2 seconds of CPU per second recovered.

### Caveats

- The cache's notion of "now" is up to 1 ms stale. For TTLs measured in seconds or minutes, this is invisible. For TTLs measured in microseconds, do not do this.
- The background goroutine itself must be stoppable for tests; otherwise `goleak` complains. Wrap it in a `Clock` interface so tests inject `FakeClock`.
- This pattern is used internally by Go's runtime in some cases (the `runtime.nanotime` function is a monotonic clock that does not require a syscall on most platforms, but it is unexported).

### What to remember

- The clock is the most-called function in many TTL cache workloads. Treating it as free is wrong at 100 M ops/sec.
- A coarse cached clock is a 5-line change with measurable wins. The trade-off is well-understood.

---

## Scenario 8 — Inlining the hash function

### Before

```go
import "hash/fnv"

func (s *Sharded) shardFor(key string) *Cache {
    h := fnv.New64a()
    h.Write([]byte(key))
    return s.shards[h.Sum64()&(shardCount-1)]
}
```

A pprof CPU profile shows `fnv.(*sum64a).Write` at 8% of samples. The escape analysis report shows `[]byte(key)` allocates: the string-to-byte-slice conversion is not optimised when the bytes flow into an interface (`hash.Hash.Write` takes `[]byte`).

### The optimisation: inline FNV manually, operate on the string

```go
func fnv64a(s string) uint64 {
    const (
        offset64 uint64 = 14695981039346656037
        prime64  uint64 = 1099511628211
    )
    h := offset64
    for i := 0; i < len(s); i++ {
        h ^= uint64(s[i])
        h *= prime64
    }
    return h
}
```

Three changes:

1. The hash function is inlined; the Go compiler can fully inline this short function into the caller.
2. No interface allocation — the function takes a `string`, not an `io.Writer`.
3. No `[]byte(key)` conversion — indexing the string byte-by-byte avoids the allocation.

For longer keys, consider `xxhash` ([cespare/xxhash/v2](https://github.com/cespare/xxhash)), which uses SIMD on amd64 and is roughly 4x faster than FNV at the cost of a slightly larger code footprint.

### After

`shardFor` drops to ~0.4% of samples. Zero allocations per call.

### What to remember

- Standard-library `hash/fnv` and `hash/crc32` have allocator-heavy APIs. For hot paths, inline or use a string-typed library.
- `xxhash` is the de facto fast hash for caches. Use it when keys are long or hashing dominates.
- Run `go build -gcflags '-m'` to see what escapes and what does not. Strings that flow into interfaces almost always escape.

---

## Scenario 9 — `sync.Pool` for value buffers

### Before

The cache stores `[]byte` payloads constructed by callers via `json.Marshal`:

```go
func (s *Service) Cache(user string, v *User) {
    b, _ := json.Marshal(v)
    s.cache.Set(user, b, 5*time.Minute)
}
```

Each `json.Marshal` allocates: usually ~3-5 allocations per call, totalling ~1 KB of garbage per Cache call. At 100 K writes/sec, that is 100 MB/sec of garbage feeding GC.

### The optimisation: pool the encoding buffer

```go
var encoderPool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 1024)
        return &b
    },
}

func (s *Service) Cache(user string, v *User) {
    bp := encoderPool.Get().(*[]byte)
    buf := (*bp)[:0]

    enc := json.NewEncoder(&byteWriter{buf: &buf})
    _ = enc.Encode(v)

    // store a copy, since we are about to return the pooled buffer
    final := make([]byte, len(buf))
    copy(final, buf)
    s.cache.Set(user, final, 5*time.Minute)

    *bp = buf[:0]
    encoderPool.Put(bp)
}

type byteWriter struct{ buf *[]byte }

func (w *byteWriter) Write(p []byte) (int, error) {
    *w.buf = append(*w.buf, p...)
    return len(p), nil
}
```

The pool amortises the encoder's working memory across calls. The *one* allocation that remains is the final `[]byte` stored in the cache — that one cannot be pooled because the cache outlives the call.

### After

Allocations per Cache call drop from ~4 to 1. Garbage rate from 100 MB/sec to ~25 MB/sec. GC frequency falls by 4x.

### Caveats

- `sync.Pool` items are dropped at GC time. The pool is not a fixed-size cache; under low concurrency, items disappear and are re-allocated.
- Pool's correctness depends on never letting a goroutine retain a pointer into the pooled buffer after `Put`. The "copy then put" discipline above is essential.
- For very small allocations (<64 bytes), `sync.Pool` overhead may exceed savings. Profile before adopting.

### What to remember

- `sync.Pool` is the standard tool for transient buffers in hot paths.
- The pattern works best when each pooled object is reused many times before GC.
- Always run benchmarks with `-benchmem` to confirm pool-based code actually allocates less.

---

## Scenario 10 — Inlining the cache into a `RoundTripper`

### Before

The HTTP layer fetches from the cache, then makes a request. The cache is one struct field, the HTTP client is another, and a wrapper function ties them together:

```go
func (s *Service) Fetch(ctx context.Context, url string) ([]byte, error) {
    if v, ok := s.cache.Get(url); ok {
        return v, nil
    }
    resp, err := s.http.Get(url)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    ttl := parseMaxAge(resp.Header.Get("Cache-Control"))
    if ttl > 0 {
        s.cache.Set(url, body, ttl)
    }
    return body, nil
}
```

This works but mixes two concerns: the *transport* and the *application*. Every caller of `s.http.Get(url)` outside `Fetch` bypasses the cache. There is no `singleflight`, so concurrent fetches of the same URL trigger N origin calls.

### The optimisation: a caching `http.RoundTripper`

```go
type cachingRT struct {
    base  http.RoundTripper
    cache *Sharded
    sf    singleflight.Group
}

func (c *cachingRT) RoundTrip(req *http.Request) (*http.Response, error) {
    if req.Method != http.MethodGet {
        return c.base.RoundTrip(req)
    }
    key := req.URL.String()
    if body, ok := c.cache.Get(key); ok {
        return cachedResponse(body, true), nil
    }
    v, err, _ := c.sf.Do(key, func() (any, error) {
        if body, ok := c.cache.Get(key); ok {
            return body, nil
        }
        resp, err := c.base.RoundTrip(req)
        if err != nil {
            return nil, err
        }
        defer resp.Body.Close()
        body, err := io.ReadAll(resp.Body)
        if err != nil {
            return nil, err
        }
        if ttl := parseMaxAge(resp.Header.Get("Cache-Control")); ttl > 0 {
            c.cache.Set(key, body, ttl)
        }
        return body, nil
    })
    if err != nil {
        return nil, err
    }
    return cachedResponse(v.([]byte), false), nil
}

func cachedResponse(body []byte, hit bool) *http.Response {
    h := http.Header{}
    if hit {
        h.Set("X-Cache", "HIT")
    } else {
        h.Set("X-Cache", "MISS")
    }
    return &http.Response{
        StatusCode: 200,
        Body:       io.NopCloser(bytes.NewReader(body)),
        Header:     h,
    }
}

client := &http.Client{
    Transport: &cachingRT{
        base:  http.DefaultTransport,
        cache: NewSharded(),
    },
}
```

Three structural wins:

1. **Universal coverage** — every `http.Client` call routes through the cache, including third-party libraries and `net/http` internal redirects.
2. **`singleflight` baked in** — 1000 concurrent identical GETs trigger one origin call.
3. **Separation of concerns** — application code reads `client.Get(url)`; the caching layer is invisible.

### After

Per-call latency on cache hit: drops from ~150 ms (parse-Host + DNS + connect + roundtrip) to ~200 ns (cache load). Origin call count under burst load: drops by a factor of N where N is the herd size.

### What to remember

- The right layer for a cache is not always "next to the call site". For HTTP, the right layer is the `RoundTripper`.
- Combining `singleflight` with the cache makes the herd-protection invisible to callers.
- Custom `RoundTripper`s compose: you can stack a caching RT on top of a retry RT on top of a metrics RT on top of `http.DefaultTransport`.

---

## Wrap-up: a profiling checklist

When optimising a TTL cache, run this list top-to-bottom:

1. **Is the lock contended?** `pprof -top` will show `sync.Mutex.Lock` near the top. Shard.
2. **Is the sweeper expensive?** `pprof -top` shows `(*Cache).sweep`. Bound the budget, or drop to probabilistic.
3. **Is allocation high?** `go test -bench . -benchmem`. Value types, pre-sized slices, `sync.Pool`.
4. **Is `time.Now()` dominant?** Atomic cached clock.
5. **Is GC dominant?** `gctrace=1 ./your-bin`. If `gc` is >5% of CPU, consider byte arenas.
6. **Is the hash function hot?** Inline FNV, or switch to `xxhash`.
7. **Are origin calls amplified?** `singleflight`, then check.
8. **Is the API the wrong shape?** Push the cache into a `RoundTripper`, a middleware, or a decorator — wherever covers every call site.

When in doubt: measure, optimise the largest item, measure again. The above list is ordered by frequency of impact, not by ease.

---

## Where to read next

- [tasks.md](tasks.md) — the exercise version of all of the above.
- [find-bug.md](find-bug.md) — the failure-mode version of all of the above.
- [senior.md](senior.md) — extended treatment of admission policies, sharding, and graceful shutdown.
- [professional.md](professional.md) — GC-free large caches, off-heap arenas, multi-tier patterns.

The cache is one of the few data structures where a small implementation can be a giant performance win — and where a small bug can be a giant outage. Optimise it carefully, profile it always, and treat the simple `map + Mutex` baseline as a known-bad starting point.
