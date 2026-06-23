# Futures & Promises — Optimization

## 1. How to use this file

Twelve scenarios where Future/Promise code is slower, allocates more, or scales worse than it should. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Future cost is dominated by three things: goroutine creation, channel synchronization, and `iface` boxing. Most wins remove one of those three on the hot path.

Reading order: Exercise 1, 5 (generics), 8 (pooling), then the rest in any order.

---

## 2. Exercise 1 — Goroutine-per-Future for tiny work

The reflex is `f := Go(func() (T, error) { ... })` for every async value. For 200-ns work, the goroutine itself (~2 µs to start, ~8 KB stack, scheduler bookkeeping) costs 50× the work it wraps.

**Before:**

```go
for _, k := range keys {
    f := Go(func() (User, error) { return cache.Get(k) })
    users = append(users, mustAwait(f))
}
```

```
BenchmarkFuturePerLookup-8    150000    9800 ns/op    320 B/op    4 allocs/op
```

<details><summary>After</summary>

Batch the trivially-fast work. Use `sync.Once`-cached futures only when the result is shared.

```go
for _, k := range keys {
    users = append(users, cache.Get(k))
}

// sync.Once-cached future for expensive shared work:
type Cached[T any] struct {
    once sync.Once
    val  T
    err  error
    fn   func() (T, error)
}
func (c *Cached[T]) Get() (T, error) {
    c.once.Do(func() { c.val, c.err = c.fn() })
    return c.val, c.err
}
```

```
BenchmarkLookupSync-8        20000000     58 ns/op    0 B/op    0 allocs/op
BenchmarkCachedOnce-8       100000000     11 ns/op    0 B/op    0 allocs/op
```

~170× faster, zero allocations.

**Why faster:** No goroutine spawn (~2 µs), no channel close (~80 ns), no `iface` box, no GC pressure. `sync.Once.Do` after the first call is a single relaxed atomic load.

**Trade-off:** Synchronous loses overlap. If `cache.Get` ever does I/O, this regresses to serial latency. If each call is ≥ 50 µs and you have other CPU, the goroutine pays for itself.

**When NOT:** Per-item work that does network or disk I/O — goroutine cost is dwarfed by I/O latency.
</details>

---

## 3. Exercise 2 — Channel-of-Result with mutex

A Future that protects `(val, err, done)` with a mutex pays `Lock`/`Unlock` on the resolver and a guarded read on every Await. Post-resolution readers still take the lock to discover the value is ready.

**Before:**

```go
type Future[T any] struct {
    mu sync.Mutex; cond *sync.Cond
    done bool; val T; err error
}
func (f *Future[T]) Await() (T, error) {
    f.mu.Lock(); for !f.done { f.cond.Wait() }
    v, err := f.val, f.err; f.mu.Unlock()
    return v, err
}
```

```
BenchmarkFutureMutex_Await-8       8000000    140 ns/op
BenchmarkFutureMutex_Contended-8    400000   3200 ns/op
```

<details><summary>After</summary>

`atomic.Pointer[result]` for the resolved state, plus a `chan struct{}` for the still-waiting hop. Post-resolution readers take the lock-free path.

```go
type result[T any] struct { val T; err error }

type Future[T any] struct {
    done chan struct{}
    res  atomic.Pointer[result[T]]
    once sync.Once
}

func (f *Future[T]) Resolve(v T) {
    f.once.Do(func() { f.res.Store(&result[T]{val: v}); close(f.done) })
}

func (f *Future[T]) Await(ctx context.Context) (T, error) {
    if r := f.res.Load(); r != nil { return r.val, r.err } // fast path
    select {
    case <-f.done: r := f.res.Load(); return r.val, r.err
    case <-ctx.Done(): var z T; return z, ctx.Err()
    }
}
```

```
BenchmarkFutureAtomic_Await-8     200000000     6 ns/op
BenchmarkFutureAtomic_Contended-8   5000000   240 ns/op
```

~23× faster on the fast path, ~13× contended.

**Why faster:** `atomic.Pointer.Load` is a single MOV on amd64. No futex transitions, no `sync.Cond.Broadcast` walking the waiter list. The contended path pays one channel receive, but only once per goroutine.

**Trade-off:** `result[T]` is heap-allocated (24-40 B). One pointer indirection on Await. Channel is a second allocation, but composes with `select` and `ctx`.

**When NOT:** When you need to update the value (Promise-with-progress, streaming result). `atomic.Pointer` semantics encode "one-shot resolution".
</details>

---

## 4. Exercise 3 — Unbuffered Future channel

The textbook Future uses `make(chan T)`. The send blocks until *someone* awaits. For a value that resolves before any consumer awaits, the resolver parks indefinitely.

**Before:**

```go
func NewFuture[T any]() *Future[T] { return &Future[T]{ch: make(chan T)} }
func (f *Future[T]) Resolve(v T)   { f.ch <- v }  // blocks until Await
// producer resolves immediately, consumer awaits 10 ms later → producer parks 10 ms
```

```
BenchmarkUnbufferedFuture-8    300000    4800 ns/op
```

<details><summary>After</summary>

Buffer of 1. The value goes into the buffer; the resolver never blocks.

```go
func NewFuture[T any]() *Future[T] { return &Future[T]{ch: make(chan T, 1)} }
func (f *Future[T]) Resolve(v T)   { f.ch <- v }  // never blocks
```

```
BenchmarkBufferedFuture-8     20000000     65 ns/op
```

~70× faster on the resolve-before-await pattern.

**Why faster:** Unbuffered channels do a rendezvous — the send hands the value directly to a waiting receive, parking the sender's G. A buffered channel just memcopies into the buffer. No park, no scheduler hop, no second context switch.

**Trade-off:** 8-24 B per Future for the buffer cell. One-shot semantic: a second send blocks. Pair with `sync.Once` to enforce.

**When NOT:** When you want synchronous handoff as backpressure — almost never desired for Futures.
</details>

---

## 5. Exercise 4 — Per-Future context allocation

Calling `context.WithTimeout` per Future allocates a `*timerCtx`, registers a timer in the runtime heap, and chains parent cancel propagation. For 50 futures with the same logical deadline, that's 50 redundant allocations and 50 timers.

**Before:**

```go
g, gctx := errgroup.WithContext(ctx)
for i, id := range ids {
    i, id := i, id
    g.Go(func() error {
        ctx2, cancel := context.WithTimeout(gctx, 200*time.Millisecond) // per-future
        defer cancel()
        u, err := fetchUser(ctx2, id); out[i] = u; return err
    })
}
```

```
BenchmarkPerFutureCtx-8     200000    7800 ns/op    1680 B/op    52 allocs/op   // 50 ids
```

<details><summary>After</summary>

Derive *one* deadline at the request boundary and reuse it.

```go
ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
defer cancel()
g, gctx := errgroup.WithContext(ctx)
for i, id := range ids {
    i, id := i, id
    g.Go(func() error {
        u, err := fetchUser(gctx, id); out[i] = u; return err
    })
}
```

```
BenchmarkSharedCtx-8     1200000    1200 ns/op    96 B/op    2 allocs/op
```

~6.5× faster, 26× fewer allocations.

**Why faster:** One `*timerCtx` instead of 50. One timer in the runtime heap (O(log n) per insert). `errgroup` already cancels its derived context on error — same propagation without per-future overhead.

**Trade-off:** All futures share the same deadline. If individual sub-requests need their own budget, per-future is correct. In practice the request-level budget is what callers care about.

**When NOT:** When per-future deadlines model the underlying SLA (50 ms per RPC regardless of fan-out). When the futures escape a request boundary.
</details>

---

## 6. Exercise 5 — Boxing via `any`

A pre-generics Future stores `interface{}`. Every Resolve boxes the value into an iface — heap allocation for any value larger than two words. Every Await type-asserts.

**Before:**

```go
type Future struct { done chan struct{}; val any; err error }
func (f *Future) Resolve(v any) { f.val = v; close(f.done) }

f.Resolve(user)   // boxes User (40 B) → heap alloc
u := (<-f).(User) // type assert
```

```
BenchmarkAnyFuture-8     5000000   320 ns/op   64 B/op   2 allocs/op
```

<details><summary>After</summary>

Generics. `Future[User]` stores `User` directly.

```go
type Future[T any] struct {
    done chan struct{}
    val  T; err error
    once sync.Once
}

func (f *Future[T]) Resolve(v T) {
    f.once.Do(func() { f.val = v; close(f.done) })
}
```

```
BenchmarkTypedFuture-8    60000000   22 ns/op    0 B/op   0 allocs/op
```

~14× faster, zero allocations.

**Why faster:** Compiler monomorphizes `Future[User]` — `f.val` is a `User` field, not a two-word iface header. No iface materialization, no type-descriptor write, no type-assertion check.

**Trade-off:** One Future type per concrete payload — the right granularity. Generic instantiation grows binary size slightly per `T`, harmless at tens-of-types.

**When NOT:** A genuinely heterogeneous result channel that one consumer dispatches on type. There iface is unavoidable; reach for a tagged-union wrapper.
</details>

---

## 7. Exercise 6 — `errgroup` with high `SetLimit`

A team sets `g.SetLimit(1000)` "for throughput". Each in-flight call uses 8 KB stack and a downstream connection. Downstream rate-limiter at 200 QPS rejects most; context-switching exceeds work.

**Before:**

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(1000)
for _, id := range ids {
    id := id
    g.Go(func() error { return fetchUser(gctx, id) })
}
```

```
BenchmarkErrgroup1000-8     // 8 MB stacks, ~30% in sched, p99 = 4.2s
```

<details><summary>After</summary>

Apply Little's Law: `L = λ × W`. Downstream serves 200 QPS at 50 ms each: `L = 200 × 0.05 = 10`. Limit 10-20 saturates without queueing.

```go
g.SetLimit(16) // ~2× Little's Law estimate
```

```
BenchmarkErrgroup16-8       // 128 KB stacks, ~5% in sched, p99 = 380 ms
```

Same throughput (downstream-bound), ~11× better p99.

**Why faster:** Past saturation, more concurrency just adds queueing latency — Little's Law in reverse. 1000 goroutines for 200 QPS means 5-second queue depth.

**Trade-off:** Under-limit leaves throughput on the floor. Tune by measuring where downstream p99 starts climbing; add 2× headroom and a hard cap.

**When NOT:** CPU-bound work where downstream isn't the constraint — `GOMAXPROCS × 2` is the right limit.
</details>

---

## 8. Exercise 7 — `select` per Future Await

A consumer awaiting N futures does sequential `for { f.Await(ctx) }`. p99 is the sum of wait times, not the max.

**Before:**

```go
for i, f := range fs {
    v, err := f.Await(ctx)
    if err != nil { return err }
    results[i] = v
}
```

```
BenchmarkSequentialAwait-8    1000    1200000 ns/op    // 10 futures × ~120 µs avg
```

<details><summary>After</summary>

Fan-in with a results channel. For dynamic N, `reflect.Select`.

```go
type tagged struct { i int; v Result; err error }
out := make(chan tagged, len(fs))
for i, f := range fs {
    i, f := i, f
    go func() { v, err := f.Await(ctx); out <- tagged{i, v, err} }()
}
for k := 0; k < len(fs); k++ {
    t := <-out
    if t.err != nil { return t.err }
    results[t.i] = t.v
}
```

For runtime-sized case sets, build `[]reflect.SelectCase` from each future's `Done()` channel plus `ctx.Done()`, then `reflect.Select`.

```
BenchmarkFanInAwait-8        50000     24000 ns/op    // ~50× faster (parallel)
BenchmarkReflectSelect-8     30000     42000 ns/op    // ~30× faster; ~1 µs/case
```

**Why faster:** Sequential await sums latencies; fan-in takes the max. For 10 futures at 120 µs ± 40 µs, sequential is ~1200 µs, parallel max ~200 µs. `reflect.Select` is slower per case but supports runtime-sized sets.

**Trade-off:** Fan-in spawns a goroutine per future (~2 µs setup). For 3 futures, goroutine cost exceeds parallelism win — do sequential. `reflect.Select` allocates per case.

**When NOT:** Futures with sharply different priorities — you want first-resolved and may bail. Hand-coded `select` is clearer.
</details>

---

## 9. Exercise 8 — Repeated Future creation in a loop

A streaming pipeline allocates one `*Future[T]` per item. At 100k items/sec that's 8 MB/s of garbage; GC pauses show in p99.

**Before:**

```go
for j := range in {
    f := &Future[Result]{done: make(chan struct{})}
    go func(j Job, f *Future[Result]) {
        r, err := doWork(j)
        if err != nil { f.Reject(err) } else { f.Resolve(r) }
    }(j, f)
    out <- f
}
```

```
BenchmarkLoopFutureAlloc-8    300000    4200 ns/op   160 B/op   2 allocs/op
```

<details><summary>After</summary>

`sync.Pool` of Future structs. `close(done)` is irreversible — switch to a notify channel recreated on Release.

```go
var futurePool = sync.Pool{
    New: func() any { return &Future[Result]{notify: make(chan struct{})} },
}

func (f *Future[T]) Release() {
    var z T
    f.val, f.err = z, nil
    f.ready.Store(false)
    f.notify = make(chan struct{}) // fresh channel; old one GC'd
    futurePool.Put(f)
}
```

```
BenchmarkLoopFuturePool-8    2000000    620 ns/op    24 B/op   1 allocs/op
```

~6.8× faster, half the allocations.

**Why faster:** Pool avoids `mallocgc` for the Future struct (40-80 B). GC pressure drops; pauses shrink. Remaining allocation is the notify channel — pool that too if you need to.

**Trade-off:** Release must be called exactly once after the last consumer awaits. Multi-consumer broadcast Futures cannot be pooled this way. `sync.Pool` clears on each GC, so hit-rate is high but not 100%.

**When NOT:** Below ~10k Futures/sec. When Future lifetime escapes the pool's scope.
</details>

---

## 10. Exercise 9 — `time.After` leaks in awaiting loop

A loop that awaits with timeout calls `time.After` inside the select. Each iteration creates a fresh timer; the old one fires later and posts a stale value. Timer heap grows.

**Before:**

```go
for {
    select {
    case v := <-future.Done(): return process(v)
    case <-time.After(100 * time.Millisecond):  // new timer per iter, leaks
        if retryCount++; retryCount > 10 { return errTimeout }
    case <-ctx.Done(): return ctx.Err()
    }
}
```

```
BenchmarkTimeAfterLeak-8    500000     2800 ns/op    192 B/op   3 allocs/op
```

<details><summary>After</summary>

`time.NewTimer` once, reset per iteration.

```go
timer := time.NewTimer(100 * time.Millisecond)
defer timer.Stop()
for {
    select {
    case v := <-future.Done(): return process(v)
    case <-timer.C:
        if retryCount++; retryCount > 10 { return errTimeout }
        timer.Reset(100 * time.Millisecond)
    case <-ctx.Done(): return ctx.Err()
    }
}
```

In Go 1.23, `Timer.Reset` and `Timer.Stop` are safe to call without draining `t.C` — the runtime handles the leftover-fire case.

```
BenchmarkTimerReset-8     5000000    240 ns/op    0 B/op   0 allocs/op
```

~12× faster, zero allocations per iteration.

**Why faster:** `time.After` allocates a `*Timer` and registers it in the runtime timer heap (O(log n)) every call. With Reset, one timer is reused; its heap position is updated, not allocated.

**Trade-off:** Slightly more code. Pre-1.23 Reset semantics required draining `t.C` first — old code has subtle bugs around stop-then-reset. Safe in 1.23.

**When NOT:** One-shot timeouts (single select that runs once). There `time.After` is fine — the leak is at most one timer.
</details>

---

## 11. Exercise 10 — Future tree depth N

A pipeline chains futures: `Map(f0, fn1) → Map(f1, fn2) → ...` N deep. Each `Map` spawns a forwarder goroutine. For N=10 stages, 10 forwarder goroutines per item.

**Before:**

```go
f := initialFetch()
for _, stage := range stages { // 10 stages, each spawns a goroutine
    f = Map(f, stage)
}
result, _ := f.Await(ctx)
```

```
BenchmarkChainedMap-8     10000    180000 ns/op
```

<details><summary>After</summary>

Flatten into a single combinator that runs all stages in one goroutine.

```go
func Chain[T any](initial *Future[T], stages ...func(T) (T, error)) *Future[T] {
    out := NewFuture[T]()
    go func() {
        v, err := initial.Await(context.Background())
        if err != nil { out.Reject(err); return }
        for _, fn := range stages {
            v, err = fn(v)
            if err != nil { out.Reject(err); return }
        }
        out.Resolve(v)
    }()
    return out
}
```

```
BenchmarkBatchedChain-8    100000    18000 ns/op
```

~10× faster.

**Why faster:** 1 goroutine instead of N. 1 future allocation instead of N. Intermediate values stay on one stack — better cache locality, no channel handoff between stages.

**Trade-off:** Stages must have the same type (`T → T`). Heterogeneous chains need a builder DSL with type params per stage. Mid-stage cancellation is coarse: ctx checked at stage boundaries.

**When NOT:** When intermediate futures need to be observable (other consumers attach to stage 3). When stages run on different infrastructure.
</details>

---

## 12. Exercise 11 — `singleflight` on every call

A handler wraps every cache read in `singleflight.Group.Do`. For unique keys (high-cardinality per-user data) dedup never fires — but you still pay the map lookup, mutex, and iface box.

**Before:**

```go
func GetUser(ctx context.Context, id string) (User, error) {
    v, err, _ := g.Do(id, func() (any, error) { return fetchUser(ctx, id) })
    return v.(User), err
}
```

```
BenchmarkSingleflightAlways-8    2000000     780 ns/op    240 B/op    5 allocs/op
```

The fetch is ~200 ns when cache-hit; singleflight adds ~580 ns of mutex+map+box.

<details><summary>After</summary>

Apply singleflight only at cache miss path, not cache hit.

```go
func GetUser(ctx context.Context, id string) (User, error) {
    if u, ok := cache.Get(id); ok { return u, nil }
    v, err, _ := g.Do(id, func() (any, error) {
        if u, ok := cache.Get(id); ok { return u, nil } // double-check
        u, err := fetchUser(ctx, id)
        if err == nil { cache.Set(id, u) }
        return u, err
    })
    return v.(User), err
}
```

```
BenchmarkSingleflightOnMiss-8   50000000      24 ns/op  (cache hit)
                                  500000    1400 ns/op  (miss)
```

~32× faster on the common path.

**Why faster:** `Do` always takes its mutex and indexes its map. For 99% cache-hit traffic, that mutex is hot for no reason. Reserving singleflight for the miss path runs dedup only when needed.

**Trade-off:** Two cache reads on a miss (the double-check inside `Do`) — cache reads are nanoseconds. If traffic is not cache-hit-dominated, the outer lookup is wasted.

**When NOT:** When the fetch is so expensive that even one duplicate is catastrophic (paid third-party API).
</details>

---

## 13. Exercise 12 — `errgroup.Wait` per request

A handler creates its own `errgroup` and spawns 50 sub-fetches per request. At 1000 QPS that's 50k goroutines/sec of churn, ~400 MB/s of stack memory churning.

**Before:**

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(16)
for i, id := range ids {
    i, id := i, id
    g.Go(func() error { it, err := fetchItem(gctx, id); out[i] = it; return err })
}
return out, g.Wait()
```

```
BenchmarkErrgroupPerRequest-8   20000    62000 ns/op    8200 B/op   62 allocs/op
```

<details><summary>After</summary>

Long-lived worker pool consuming a shared queue. Per-request work is submitting jobs and awaiting per-request futures.

```go
type Job struct { id string; out *Future[Item]; ctx context.Context }
type Pool struct{ jobs chan Job }

func NewPool(workers int) *Pool {
    p := &Pool{jobs: make(chan Job, workers*4)}
    for i := 0; i < workers; i++ {
        go func() {
            for j := range p.jobs {
                if j.ctx.Err() != nil { j.out.Reject(j.ctx.Err()); continue }
                it, err := fetchItem(j.ctx, j.id)
                if err != nil { j.out.Reject(err) } else { j.out.Resolve(it) }
            }
        }()
    }
    return p
}

func (p *Pool) Submit(ctx context.Context, id string) *Future[Item] {
    f := NewFuture[Item]()
    p.jobs <- Job{id, f, ctx}
    return f
}
```

```
BenchmarkSharedPool-8   200000    7800 ns/op    1600 B/op   12 allocs/op
```

~8× faster, 5× fewer allocations.

**Why faster:** No goroutine spawn per request — workers run forever, paying their 8 KB stack once. Per-request alloc is just Job and Future (poolable per Ex. 8). Scheduler doesn't see 50 new goroutines per millisecond.

**Trade-off:** Workers are global — size for peak QPS × per-job latency. One request submitting 1000 jobs monopolizes the pool; add per-tenant rate limits at Submit. A cancelled job sitting in queue still runs unless workers check ctx first.

**When NOT:** Bursty workloads with very different per-request sizes — ad-hoc errgroup gives better isolation. Short-lived processes where pool startup dominates.
</details>

---

## 14. When NOT to optimize

Future patterns dominate when many small async values are flying around. If your code creates 10 futures per minute, optimizing them is pointless — your time is in the work the futures wrap.

- Background sync that runs once per hour — keep the simplest channel-based Future.
- Test fixtures that fake async — no goroutine, just an already-resolved Future struct.
- Code where each "future" already wraps a 10 ms network call — goroutine overhead is < 0.1% of total cost.

**Profile first.** Look for time in `runtime.chansend`, `runtime.gopark`, `runtime.mallocgc`, and `sync.(*Mutex).Lock` — the four signatures of Future overhead.

**Common premature optimizations:**

- Pooling Future structs (Ex. 8) below 10k Futures/sec.
- `atomic.Pointer` (Ex. 2) when there's only one waiter — `sync.Mutex` matches it with simpler semantics.
- Fan-in await (Ex. 7) for ≤3 futures — sequential is shorter and faster.
- Flattening chains (Ex. 10) when stages are observably independent.
- Worker pool (Ex. 12) when per-request load is uneven.

**Correctness gaps disguised as optimizations:**

- Removing `sync.Once` from Resolve "because it's only called once" — until a retry path calls it twice and panics on closed channel.
- Buffered channel without one-shot guard — multi-resolution silently overwrites.
- Pool reuse with active consumers still awaiting — Future mutated under their feet.
- Singleflight across security domains — one tenant's result returned to another's call.

---

## 15. Summary

**Always-ship wins** (apply by default in any new Future code):

- Buffered Future channel cap 1, never unbuffered (Ex. 3).
- Typed generic `Future[T]`, never `Future[any]` (Ex. 5).
- One context deadline at the request boundary (Ex. 4).
- `time.NewTimer` + `Reset` in any awaiting loop (Ex. 9).
- `sync.Once` around Resolve/Reject — non-negotiable correctness.

**Wins behind a profile** (when measurements justify them):

- `atomic.Pointer[Result]` for lock-free fast path (Ex. 2) — when read-after-resolution is hot.
- `errgroup.SetLimit` via Little's Law (Ex. 6) — when downstream is the constraint.
- Fan-in await for ≥8 futures (Ex. 7).
- Pool the Future struct (Ex. 8) — at ≥10k Futures/sec.
- Flatten chain combinators (Ex. 10).
- Singleflight only at miss path (Ex. 11).
- Shared worker pool (Ex. 12) — when goroutine spawn dominates per-request CPU.

**Specialty** (only when the design calls for it):

- `sync.Once`-cached Future for shared expensive results (Ex. 1).
- `reflect.Select` over dynamic Future sets (Ex. 7).
- Reference-counted Future for broadcast.
- Lazy Futures with `sync.Once` for fallback chains.

Future cost is goroutines, channels, and iface boxes. Strip those three by inlining cheap work, buffering one-shot channels, and using generics; then size concurrency to the real downstream. The shape is ~100 lines of Go; the discipline is what makes it production-grade. The Future is rarely where the time goes — but when it is, these are the levers.
