# Future / Promise Pattern — Optimization

A toolkit for shaving cost out of high-throughput future systems. None of these techniques matter at low rates. Measure first.

---

## Table of Contents
1. [Baseline Cost of a Future](#baseline-cost-of-a-future)
2. [Fast Path: Avoid the Future Entirely](#fast-path-avoid-the-future-entirely)
3. [Pooling Result Structs](#pooling-result-structs)
4. [Pooling Channels](#pooling-channels)
5. [Batching N Futures into One](#batching-n-futures-into-one)
6. [Reducing Goroutine Count](#reducing-goroutine-count)
7. [Memoization with TTL and Eviction](#memoization-with-ttl-and-eviction)
8. [Hedging Cost-Performance Curves](#hedging-cost-performance-curves)
9. [Cache Sympathy](#cache-sympathy)
10. [Profiling Methodology](#profiling-methodology)
11. [Cheat Sheet](#cheat-sheet)

---

## Baseline Cost of a Future

Let's measure. A canonical future:

```go
func compute() <-chan int {
    ch := make(chan int, 1)
    go func() { ch <- 1 }()
    return ch
}
```

Approximate per-call cost on a recent x86 laptop (Go 1.22):

| Item | Bytes | Notes |
|------|-------|-------|
| Channel struct | 96 | `runtime.hchan` + 1 element buffer (8 bytes) |
| Goroutine stack | 2 KB | initial stack |
| Goroutine struct (`g`) | ~400 | reused from runtime's free list |
| Closure (if any) | ~32 | depends on captured variables |

Total: roughly 2.5 KB allocation per future, of which 96 bytes is heap and 2 KB is goroutine stack (reused from a free list after exit).

CPU cost: a few hundred nanoseconds for the channel alloc + goroutine startup. The send and receive are single-digit nanoseconds each.

These are tiny costs. At 10,000 futures/second they total: ~25 MB/s of allocation, a few ms of CPU. At 1,000,000 futures/second they total: 2.5 GB/s of allocation, GC pressure becomes severe.

The threshold where optimisation matters is around **100k futures/second sustained**. Below that, prefer clarity over speed.

---

## Fast Path: Avoid the Future Entirely

The single biggest win is to skip the future when the result is already available. Many caches, registries, and stable lookups can answer synchronously most of the time.

```go
func (c *Client) Get(ctx context.Context, key string) (Value, error) {
    if v, ok := c.cache.Get(key); ok {
        return v, nil  // no future, no goroutine, no channel
    }
    return c.loadAsync(ctx, key).Await(ctx)
}
```

If 95% of calls hit the cache, the future cost is 5% of what it would otherwise be.

Generalisation: anywhere you can detect "no work to do" before allocating, do.

```go
// SLOW
func (c *Client) GetAsync(ctx context.Context, key string) *Future[Value] {
    return future.New(ctx, func(ctx context.Context) (Value, error) {
        if v, ok := c.cache.Get(key); ok {
            return v, nil
        }
        return c.load(ctx, key)
    })
}

// FAST (when most calls hit cache)
func (c *Client) GetAsync(ctx context.Context, key string) *Future[Value] {
    if v, ok := c.cache.Get(key); ok {
        return future.Completed(v)  // pre-resolved future, no goroutine
    }
    return future.New(ctx, func(ctx context.Context) (Value, error) {
        return c.load(ctx, key)
    })
}

func Completed[T any](v T) *Future[T] {
    f := &Future[T]{ch: make(chan Result[T], 1)}
    f.ch <- Result[T]{Val: v}
    return f
}
```

`Completed` allocates a channel and writes a value — no goroutine. The cost is roughly half a normal future.

---

## Pooling Result Structs

If your `Result[T]` contains a large or numerous value type (a 1 KB byte slice, a large struct), `sync.Pool` can amortise its allocation:

```go
var resultPool = sync.Pool{
    New: func() any { return new(Result[[]byte]) },
}

func New(ctx context.Context, fn func(context.Context) ([]byte, error)) *Future[[]byte] {
    f := &Future[[]byte]{ch: make(chan *Result[[]byte], 1)}
    go func() {
        r := resultPool.Get().(*Result[[]byte])
        r.Val, r.Err = fn(ctx)
        f.ch <- r
    }()
    return f
}

func (f *Future[[]byte]) Await(ctx context.Context) ([]byte, error) {
    select {
    case r := <-f.ch:
        defer resultPool.Put(r)
        return r.Val, r.Err
    case <-ctx.Done():
        var zero []byte
        return zero, ctx.Err()
    }
}
```

Caveats:

- `r.Val` must be reset before `Put` if it holds references. Otherwise pooled structs retain old data, possibly causing GC issues or stale leaks.
- The pool only helps if `Get` and `Put` are paired. Abandoned futures don't return their `Result` to the pool.
- Adds complexity. Benchmark first.

For most call sites, returning `Result[T]` by value (not pointer) is faster than pooling pointers, because the value avoids a heap escape.

---

## Pooling Channels

Reusing channels is harder than reusing structs because a channel has internal state — wait queues, send/receive positions. Resetting a `chan T` is not directly supported.

You can pool the *Future wrapper*, not the channel:

```go
type Future[T any] struct {
    ch chan Result[T]
}

var futurePool = sync.Pool{
    New: func() any {
        return &Future[Result[any]]{
            ch: make(chan Result[any], 1),
        }
    },
}
```

But the channel inside, once received from, is still in a clean state (empty, no pending senders or receivers, capacity 1). Reusing it is *possible* if you carefully drain before reuse:

```go
func getFuture[T any]() *Future[T] {
    f := futurePool.Get().(*Future[T])
    // drain any stale value (defensive)
    select {
    case <-f.ch:
    default:
    }
    return f
}

func putFuture[T any](f *Future[T]) {
    futurePool.Put(f)
}
```

This is borderline territory. Channels are not designed for reuse. The implementation is allowed to assert "no pending senders/receivers at allocation". Verify with `go test -race` and high concurrency.

A safer scheme: pool the *struct* but allocate a fresh channel per use:

```go
func getFuture[T any]() *Future[T] {
    f := futurePool.Get().(*Future[T])
    f.ch = make(chan Result[T], 1)  // fresh channel
    return f
}
```

This saves the struct allocation (~16 bytes) but pays the channel allocation (~96 bytes). Usually not worth it.

**Verdict:** don't pool channels. Pool the wrapping struct if you need to. Most workloads don't.

---

## Batching N Futures into One

If you find yourself allocating 100 futures per request, ask whether the underlying work can be batched.

```go
// EXPENSIVE
for _, id := range ids {
    futs = append(futs, loadAsync(ctx, id))
}
for _, fu := range futs {
    user, _ := fu.Await(ctx)
    use(user)
}

// CHEAPER
func loadBatchAsync(ctx context.Context, ids []int) *Future[[]User] {
    return future.New(ctx, func(ctx context.Context) ([]User, error) {
        return db.LoadBatch(ctx, ids)  // single query for all IDs
    })
}
```

One future, one DB round trip. The savings dwarf any micro-optimisation.

This is the most overlooked optimisation. Every batch you can pull together turns N futures into one. The relevant primitives:

- `github.com/graph-gophers/dataloader` and similar libraries.
- A small in-flight buffer that collects ids for ~10ms then issues a batch.
- Application-level batching: design the upstream API to accept N at a time.

---

## Reducing Goroutine Count

Each future spawns a goroutine. 100k futures/second means 100k goroutine starts/exits per second. Goroutine creation is fast, but at extreme rates the scheduler still pays.

Alternative: a worker pool with a bounded number of goroutines processing a job queue.

```go
type Pool[T any] struct {
    jobs chan func() (T, error)
    futs []*chan Result[T]
}

func (p *Pool[T]) Submit(fn func() (T, error)) <-chan Result[T] {
    out := make(chan Result[T], 1)
    p.jobs <- func() (T, error) { return fn() }
    // ... and the worker writes the result into the right channel
}
```

This is more complex and only worth it if profiling shows goroutine startup as a real cost — usually below 10% of total CPU.

Better alternative for batch-style workloads: `errgroup.SetLimit(K)` caps concurrency without rewriting the pattern.

---

## Memoization with TTL and Eviction

A naive memo cache `map[K]*Memo[V]` grows forever. In production you need bounds.

LRU memo cache:

```go
type Cache[K comparable, V any] struct {
    lru *lru.Cache[K, *Memo[V]]
    fn  func(context.Context, K) (V, error)
}

func (c *Cache[K, V]) Get(ctx context.Context, k K) (V, error) {
    if m, ok := c.lru.Get(k); ok {
        return m.Await(ctx)
    }
    m := newMemo(func(ctx context.Context) (V, error) {
        return c.fn(ctx, k)
    })
    c.lru.Add(k, m)
    return m.Await(ctx)
}
```

Caveats:
- Two concurrent misses for the same key can each install a fresh memo. Either lock around the "check then add" or use `singleflight` to dedupe.
- LRU eviction can throw out an in-progress memo. The goroutine is still alive but its result is orphaned. If you care, use `singleflight` instead.

TTL with refresh-ahead:

```go
type TTLCache[K comparable, V any] struct {
    entries map[K]*entry[V]
    mu      sync.Mutex
    ttl     time.Duration
}

type entry[V any] struct {
    memo      *Memo[V]
    expiresAt time.Time
}
```

On each `Get`, if `time.Now()` is past 80% of `ttl`, start an async refresh while serving the stale value. Cuts cache-miss spikes at expiry.

---

## Hedging Cost-Performance Curves

Hedging trades load for latency. The cost grows with the hedge rate; the benefit grows with how much faster the second copy is on average.

Useful model: if `p_hedge` is the probability the hedge fires (~5% for delay = p95), and the work has tail latency `t_tail`, the hedge saves an expected `p_hedge * t_tail / 2` from p99. The cost is `p_hedge * c_work` in load.

Sweet spots:

- `delay = p95` and `t_tail = 10 * p50`: hedge cuts p99 by ~5x, adds 5% load. Almost always worth it.
- `delay = p50` and `t_tail = 2 * p50`: hedge cuts p99 by 2x, adds 50% load. Probably not worth it.

Measure both. Run an A/B with the hedge disabled.

Tuning tip: cap the hedge rate. Even if `p_hedge` is supposed to be 5%, if the downstream is degraded the hedge rate climbs and amplifies the degradation. Wrap with:

```go
if hedgeMetric.Rate() < maxHedgeRate {
    fireHedge()
}
```

---

## Cache Sympathy

If your future result is read-once and discarded, allocating it on the heap is fine. If it lives long, `sync.Pool` helps.

A subtler issue: the future's `Result[T]` is on the heap. If `T` is a large struct (1 KB), copying it through the channel costs memory bandwidth. Two mitigations:

1. **Return a pointer.** `Result[*T]` instead of `Result[T]`. The channel carries a pointer (8 bytes), the body lives wherever it was allocated. Trade-off: a pointer means an indirect read, but most large structs are already pointer-ish.

2. **Return small types.** Refactor `T` to be a small handle (an ID, an offset into a slab) and dereference on the consumer side. Useful when the underlying data is in a shared store.

For 99% of code, just return `Result[T]` by value. The Go compiler is smart enough to optimise small-struct copies; channels move them efficiently.

---

## Profiling Methodology

You optimise futures by *measuring*, not guessing. The toolkit:

### Step 1: Find the hot path

```
go test -run=^$ -bench=. -benchmem -benchtime=10s -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof cpu.out
> top
> list <function>
```

If `runtime.makechan` or `runtime.newproc` are not in the top 10, futures are not your bottleneck.

### Step 2: Confirm with allocations

```
go tool pprof -alloc_objects mem.out
> top
```

If your future-creating function is in the top 5, look at it. Otherwise, look elsewhere.

### Step 3: Check goroutine count

```go
go func() {
    for {
        time.Sleep(time.Second)
        fmt.Println("goroutines:", runtime.NumGoroutine())
    }
}()
```

A steady-state count is healthy. A growing count is a leak. A spiky count is fan-out without bounds.

### Step 4: Use trace

```
go test -trace=trace.out -bench=.
go tool trace trace.out
```

The trace UI shows goroutine creation/exit per goroutine. You can spot fan-outs that explode and bound them.

### Step 5: Test the change

Run the benchmark before and after. If the diff is less than 5%, you didn't optimise — you added complexity for no win. Revert.

```
benchstat before.txt after.txt
```

uses two-sample t-test to tell you whether the difference is statistically significant.

---

## Cheat Sheet

```
FIRST: MEASURE
    pprof cpu + alloc + goroutine
    benchstat for A/B
    runtime.NumGoroutine() over time

CHEAP WINS (no complexity cost)
    completed-future fast path on cache hit
    Result[T] by value, not pointer (small T)
    errgroup.SetLimit to bound fan-outs
    batch N futures into one underlying call

MEDIUM COMPLEXITY
    sync.Pool for Result[T] when T is large
    TTL + refresh-ahead memo cache
    bounded hedge rate

HIGH COMPLEXITY
    pool the Future struct (skeptical)
    custom worker pool with channels instead of go-per-request

REJECT
    pooling channels themselves (fragile, low payoff)
    micro-optimising single futures at < 100k/sec rates

WHEN OPTIMISATION HURTS
    if your future code is no longer readable to a junior engineer,
    you have over-optimised. Most teams should aim for "clean and
    correct" first, "fast" only when measurement demands it.
```

---

## Summary

The future pattern is cheap. At low rates, you should focus on correctness — buffer the channel, propagate ctx, run goleak — not performance.

When you actually have a hot future call site (over 100k/sec sustained), the wins come in this order:

1. **Avoid the future when the result is known.** Pre-resolved futures or synchronous returns from cache.
2. **Batch.** N futures of similar work become one batched future.
3. **Bound.** Cap fan-out with `errgroup.SetLimit` or a worker pool.
4. **Pool large Results.** `sync.Pool` for 1 KB+ structs that go through the channel.
5. **Memoize with bounds.** LRU + TTL keeps cache memory bounded.
6. **Hedge with discipline.** Tune to p95, cap the rate, measure both ways.

Channel pooling and goroutine pool patterns rarely pay. Skip them unless profiling proves otherwise.

The most common over-optimisation: replacing clear futures with a hand-rolled scheduler that nobody can debug. The Go team's advice still holds: write clear code first; measure; optimise the actual bottleneck.
