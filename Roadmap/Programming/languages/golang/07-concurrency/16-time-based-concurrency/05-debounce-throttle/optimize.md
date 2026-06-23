---
layout: default
title: Optimize
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/optimize/
---

# Debounce and Throttle — Optimization

> Debouncers and throttles are tiny components, but they sit on hot paths. A debouncer is called on every keystroke; a throttle is called on every API call. The wrong choice between "coalesce on the inside" and "coalesce on the outside" can multiply your CPU bill by 10×. The wrong choice between "one shared limiter" and "per-call limiter" can multiply your error budget by 100×.
>
> Each entry below states the problem, shows a "before" snippet, an "after" snippet, and the realistic gain. Numbers are illustrative — measure in your own code.

---

## Optimization 1 — Coalesce events instead of firing on every one

**Problem.** A debouncer that fires its callback on every event in a burst is misnamed: it is a delayed-execution scheduler, not a debouncer. The whole point of a debouncer is that *N* events produce 1 (or 2, for both-edge) callback.

**Before:**
```go
func (db *Debouncer) Trigger() {
    go func() {
        time.Sleep(db.d)
        db.fn() // fires once per Trigger, just delayed
    }()
}
```
1000 keystrokes → 1000 search requests. Each request hits the database. CPU pinned, network saturated, downstream rate-limited.

**After:**
```go
func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, db.fn)
}
```
1000 keystrokes → 1 search request, fired `d` after the last keystroke.

**Gain.** Three orders of magnitude fewer downstream calls, identical user experience (the user sees only the last result anyway). The CPU savings flow through every downstream service.

The general rule: if a debouncer is firing more than once per burst, it is not debouncing. Verify with a `prometheus.Counter` on `fn` and assert that the counter increments at most "bursts per second" rate, not "events per second" rate.

---

## Optimization 2 — Reduce allocations per `Trigger`

**Problem.** Each `Trigger` of a naive debouncer allocates a new `*time.Timer`. At 100 000 triggers/second across a server, that is 100 000 small allocations/second — easily measurable in `go tool pprof -alloc_objects`.

**Before:**
```go
func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, db.fn) // allocates *runtimeTimer
}
```

`time.AfterFunc` allocates a `*runtimeTimer` and a callback closure (typically 48 + 24 bytes on amd64). At 100 k/s that is ~7 MB/s of allocation. The GC notices.

**After (reuse the timer):**
```go
func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t == nil {
        db.t = time.AfterFunc(db.d, db.fn)
        return
    }
    if !db.t.Stop() {
        // Timer already fired or was stopped. Drain in case AfterFunc semantics
        // differ; for AfterFunc no channel send happens, so no drain needed.
    }
    db.t.Reset(db.d)
}
```

`time.AfterFunc` returns a `*time.Timer`. Calling `Reset` on it re-arms without allocating. The callback closure is captured once at construction time.

**Gain.** Allocation rate drops from `O(triggers)` to `O(1)`. GC pause frequency falls. At 100 k triggers/sec on a typical server, p99 latency typically improves by 10–20 µs because GC steals less time from the request goroutines.

Caveat: `time.Timer.Reset` has documented gotchas for non-`AfterFunc` timers (it must be called on stopped or drained timers). `AfterFunc`-created timers are safer to reset in flight because the callback delivery is via goroutine, not channel.

---

## Optimization 3 — Switch debounce → throttle for non-final updates

**Problem.** A debouncer fires only after silence. If events stream continuously, the debouncer *never fires*. For "live preview" features — a video transcoding progress bar, a typing-indicator broadcast, a partial-result UI update — the user wants to see intermediate progress, not just the final state.

**Before:**
```go
deb := debounce.New(100*time.Millisecond, updateUI)
for chunk := range progress {
    deb.Trigger() // fires only on silence
}
```
A 30-second upload at 100 KB/s streams 300 chunks. The debouncer never fires because chunks arrive every ~10 ms — shorter than `d`. The UI stays frozen until the upload ends.

**After (throttle):**
```go
th := newThrottle(100*time.Millisecond)
for chunk := range progress {
    th.TryDo(updateUI)
}
```
The UI updates every 100 ms regardless of how dense the stream is. The user sees a smoothly progressing bar.

**Gain.** UX feels responsive on long uploads. Throttle is the right choice when you want "at least one fire per window," not "exactly one fire after the burst." Mistaking one for the other is the most common high-level bug in event-handling code.

If you want both — "throttle while streaming, fire-final on stop" — combine them:

```go
th := newThrottle(100*time.Millisecond)
deb := debounce.New(150*time.Millisecond, updateUI)
for chunk := range progress {
    th.TryDo(updateUI) // periodic during stream
    deb.Trigger()      // final after stream stops
}
```

---

## Optimization 4 — Share one `rate.Limiter` across goroutines

**Problem.** Every call to `rate.NewLimiter` creates fresh state. If you create one per request, the rate limit applies *per request* — which is to say, not at all.

**Before:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    lim := rate.NewLimiter(10, 5)
    if err := lim.Wait(r.Context()); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    serve(w, r)
}
```
At 1000 req/s, the server creates 1000 limiters per second. Each begins with `burst = 5` tokens; each immediately grants the call. The "limit" is decorative.

**After:**
```go
var sharedLim = rate.NewLimiter(10, 5)

func handler(w http.ResponseWriter, r *http.Request) {
    if err := sharedLim.Wait(r.Context()); err != nil { ... }
    serve(w, r)
}
```

**Gain.** Actual rate limiting. Zero allocation per request for the limiter itself. The limiter struct is ~64 bytes; sharing is free.

For per-tenant limits, share one limiter *per tenant*, not per request:

```go
type Limited struct {
    mu sync.Mutex
    m  map[string]*rate.Limiter
}

func (l *Limited) for_(tenant string) *rate.Limiter {
    l.mu.Lock()
    defer l.mu.Unlock()
    if lim, ok := l.m[tenant]; ok {
        return lim
    }
    lim := rate.NewLimiter(10, 5)
    l.m[tenant] = lim
    return lim
}
```

Add TTL-based eviction (see `find-bug.md` Bug 13) so the map does not grow forever.

---

## Optimization 5 — Amortise `time.Now` with a clock cache

**Problem.** `time.Now()` is fast (~25 ns on Linux/amd64 via `clock_gettime(CLOCK_MONOTONIC)`), but at 10 M calls/sec it shows up in profiles. The vdso reduces it to ~5 ns on modern hardware, but on virtualised environments without vdso, syscall overhead dominates.

**Before:**
```go
func (b *Bucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := time.Now()
    b.refill(now)
    if b.tokens >= 1 { b.tokens--; return true }
    return false
}
```
Every call hits `time.Now`.

**After (clock cache):**
```go
type Clock struct {
    now atomic.Int64 // nanoseconds since epoch
}

func NewClock() *Clock {
    c := &Clock{}
    c.now.Store(time.Now().UnixNano())
    go func() {
        t := time.NewTicker(time.Millisecond)
        defer t.Stop()
        for now := range t.C {
            c.now.Store(now.UnixNano())
        }
    }()
    return c
}

func (c *Clock) Now() time.Time {
    return time.Unix(0, c.now.Load())
}
```

A single goroutine updates a shared `atomic.Int64` every millisecond. All readers do an atomic load — a few ns each, no contention.

**Gain.** At 10 M Allow/sec, the syscall savings can be 50 µs/sec of CPU — small but measurable on hot paths.

**Caveat.** Resolution drops to 1 ms. For a rate limiter operating at 1000 req/s or higher, this matters: you may misclassify events at the 1 ms boundary. Use this trick only for limiters running at <1 kHz and tolerant of millisecond rounding.

This is exactly what `Cloudflare` and `Discord` use in their rate-limit layers. The Go runtime itself does *not* cache the clock — `time.Now` is uncached and reads `clock_gettime` every call, by design.

---

## Optimization 6 — Avoid `time.After` in hot loops

**Problem.** `time.After(d)` creates a new `*time.Timer` and a new channel on every call. The timer is held by the runtime until it fires. In a `select` loop running thousands of times per second, this is the second-largest allocation source after request handlers.

**Before:**
```go
for {
    select {
    case ev := <-events:
        handle(ev)
    case <-time.After(time.Second): // allocates per loop iteration
        heartbeat()
    case <-ctx.Done():
        return
    }
}
```
A select that takes the `events` case fast (sub-second) allocates a `*time.Timer` per iteration, holds it for 1 second, then drops it. At 10 000 events/sec, that is 10 000 timers held simultaneously.

**After (reuse a timer):**
```go
timer := time.NewTimer(time.Second)
defer timer.Stop()
for {
    if !timer.Stop() {
        select { case <-timer.C: default: }
    }
    timer.Reset(time.Second)
    select {
    case ev := <-events:
        handle(ev)
    case <-timer.C:
        heartbeat()
    case <-ctx.Done():
        return
    }
}
```

Or, even simpler, use a `time.Ticker` if the heartbeat cadence is steady:

```go
hb := time.NewTicker(time.Second)
defer hb.Stop()
for {
    select {
    case ev := <-events:
        handle(ev)
    case <-hb.C:
        heartbeat()
    case <-ctx.Done():
        return
    }
}
```

**Gain.** At high event rates, allocation rate drops from `O(events)` to `O(1)`. Real measurement: in a typical streaming server, switching from `time.After` to a reused `time.Timer` reduces GC pause time by ~5%.

`go vet` does not catch the `time.After`-in-hot-loop pattern. Add a custom linter rule or grep your codebase: `time.After(` inside `for {` is almost always a bug.

---

## Optimization 7 — Use `golang.org/x/time/rate` instead of a hand-rolled bucket

**Problem.** Many codebases roll their own token bucket. The math is short, but the edge cases (negative tokens, monotonic time, Reserve/Cancel semantics, integration with `context.Context`) accumulate into a 200-line correctness nightmare.

**Before (hand-rolled):**
```go
type Bucket struct {
    mu       sync.Mutex
    tokens   float64
    rate     float64
    lastFill time.Time
}

func (b *Bucket) Wait(ctx context.Context) error {
    for {
        b.mu.Lock()
        elapsed := time.Since(b.lastFill).Seconds()
        b.tokens += elapsed * b.rate
        if b.tokens > 10 { b.tokens = 10 }
        b.lastFill = time.Now()
        if b.tokens >= 1 {
            b.tokens--
            b.mu.Unlock()
            return nil
        }
        b.mu.Unlock()
        select {
        case <-time.After(10 * time.Millisecond):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

This works for the happy path. It is also missing: `Reserve`/`Cancel` for composability, correct math around fractional tokens, the optimisation to compute exact wait duration, and the ability to atomically check-and-burn N tokens.

**After:**
```go
lim := rate.NewLimiter(rate.Limit(10), 10) // 10/sec, burst 10
if err := lim.Wait(ctx); err != nil { return err }
```

**Gain.** Zero correctness risk on edge cases. The `rate` package has been used by millions of services and is regularly audited. Allocation cost is identical (one `*Limiter` per lifetime).

The exception: hand-roll when you need behaviour `rate.Limiter` does not support — *sliding-window* throttling (not token-bucket), *distributed* state via Redis, or *bursts measured in bytes* rather than count. For everything else, use the library.

---

## Optimization 8 — Pre-aggregate events before the debouncer

**Problem.** A debouncer with a single-value semantics ("fire with the last event") forces the *caller* to discard intermediate state. Sometimes the right answer is to *coalesce* the intermediate state on the caller side and pass the coalesced result through the debouncer.

**Before:**
```go
deb := debounce.New(200*time.Millisecond, func() {
    sendUpdate(model.Snapshot())
})

func onEdit(field string, value any) {
    model.Set(field, value)
    deb.Trigger() // debouncer fires once with model.Snapshot()
}
```
At fire time, `model.Snapshot()` may include *every* field the user edited during the burst. Fine if `sendUpdate` can handle a snapshot. Not fine if the network protocol expects deltas.

**After (coalesce on caller side):**
```go
type EditCollector struct {
    mu      sync.Mutex
    pending map[string]any
}

func (c *EditCollector) Add(field string, value any) {
    c.mu.Lock()
    c.pending[field] = value
    c.mu.Unlock()
}

func (c *EditCollector) Drain() map[string]any {
    c.mu.Lock()
    defer c.mu.Unlock()
    out := c.pending
    c.pending = make(map[string]any)
    return out
}

ec := &EditCollector{pending: make(map[string]any)}
deb := debounce.New(200*time.Millisecond, func() {
    sendDelta(ec.Drain())
})
```

`ec.Drain` returns the merged set of edits since the last drain. Each field is included exactly once with its latest value. The debouncer only triggers the flush; the *aggregation* lives in `ec`.

**Gain.** Network payload size is bounded by the number of distinct fields, not by the number of keystrokes. For a form with 5 fields and 100 keystrokes per field, the payload drops from 500 deltas to 5.

This pattern generalises: a debouncer is a *flush trigger*, not a *data store*. Keep the data on a separate aggregator that knows how to coalesce.

---

## Optimization 9 — Replace a debouncer with a fixed-window batch

**Problem.** Debouncers are responsive to silence: they fire when events stop. But many backend pipelines do not care about responsiveness — they care about *throughput*. A batch-based aggregator can be simpler and more predictable.

**Before:**
```go
deb := debounce.New(100*time.Millisecond, flush)
for ev := range events {
    buffer.Add(ev)
    deb.Trigger()
}
```
Flushes whenever events pause. If events stream constantly, the buffer grows unboundedly until the stream stops.

**After (batch by size or time):**
```go
const batchSize = 1000
const batchInterval = 500 * time.Millisecond

ticker := time.NewTicker(batchInterval)
defer ticker.Stop()

for {
    select {
    case ev, ok := <-events:
        if !ok {
            flush(buffer)
            return
        }
        buffer = append(buffer, ev)
        if len(buffer) >= batchSize {
            flush(buffer)
            buffer = buffer[:0]
        }
    case <-ticker.C:
        if len(buffer) > 0 {
            flush(buffer)
            buffer = buffer[:0]
        }
    }
}
```

Flushes whichever comes first: 1000 events or 500 ms. The buffer never exceeds 1000 entries.

**Gain.** Bounded memory under sustained load. Predictable end-to-end latency: at most 500 ms or 1000 events. Easier to reason about than "fire after silence."

Many "debouncers" in real codebases are actually misnamed batchers. If you find one whose `d` is greater than 1 second, it is almost certainly a batcher.

---

## Optimization 10 — Use `Reserve` for non-blocking rate limiting

**Problem.** `lim.Wait(ctx)` blocks. In a request handler, blocking is bad: connections accumulate, queue depth grows, latency spikes. You usually want to *fail fast* and return 429, not wait.

**Before:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := lim.Wait(r.Context()); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    serve(w, r)
}
```
Under sustained overload, every request takes up to `1/rate` seconds. Goroutines stack up.

**After (fail fast):**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    if !lim.Allow() {
        w.Header().Set("Retry-After", "1")
        http.Error(w, "rate limited", http.StatusTooManyRequests)
        return
    }
    serve(w, r)
}
```

**Gain.** Bounded latency. Bounded goroutine count. Clients can implement their own retry with backoff (often better-informed than the server about whether the request is still worth retrying).

If you need "wait up to N ms, then fail":

```go
r := lim.Reserve()
if !r.OK() {
    return errors.New("limit exhausted, cannot wait")
}
d := r.Delay()
if d > 50*time.Millisecond {
    r.Cancel()
    http.Error(w, "rate limited", http.StatusTooManyRequests)
    return
}
time.Sleep(d)
serve(w, r)
```

`Reserve` + bounded wait + `Cancel` gives precise control over how long to wait.

---

## Optimization 11 — Sharded limiters for high-cardinality keys

**Problem.** A single `map[string]*rate.Limiter` with one mutex serialises every rate-limit check. At 1 M req/s, the mutex itself is the bottleneck.

**Before:**
```go
type Limited struct {
    mu sync.Mutex
    m  map[string]*rate.Limiter
}
```
Mutex contention dominates the profile.

**After (sharded):**
```go
const shards = 64

type shardEntry struct {
    mu sync.Mutex
    m  map[string]*rate.Limiter
}

type Limited struct {
    shards [shards]shardEntry
}

func (l *Limited) for_(key string) *rate.Limiter {
    h := fnv.New64a()
    h.Write([]byte(key))
    s := &l.shards[h.Sum64()%shards]
    s.mu.Lock()
    defer s.mu.Unlock()
    if lim, ok := s.m[key]; ok {
        return lim
    }
    if s.m == nil {
        s.m = make(map[string]*rate.Limiter)
    }
    lim := rate.NewLimiter(10, 5)
    s.m[key] = lim
    return lim
}
```

**Gain.** Mutex contention drops by ~`shards` for uniformly distributed keys. Throughput scales with cores again.

`sync.Map` is sometimes a substitute, but its design favours read-mostly with disjoint key sets per goroutine. Sharded `map[K]V + sync.Mutex` is typically faster for "create-on-first-use, read-and-update-after."

---

## Optimization 12 — Use a single goroutine for many timers

**Problem.** A debouncer per key (Task 11 in `tasks.md`) creates one `*time.Timer` per key. The Go runtime is good at managing many timers, but at 1 M keys you are paying for 1 M heap entries in the timer heap. Insertion is O(log n); the heap operations dominate.

**Before.** A naive per-key debouncer where each `Trigger` calls `time.AfterFunc`.

**After (centralised wheel):** Maintain a sorted structure of pending fires (a heap, a time-wheel, or a sorted skip list). A single goroutine sleeps until the next fire and dispatches in order.

```go
type fire struct {
    key    string
    fireAt time.Time
}

type Centralised struct {
    mu      sync.Mutex
    keys    map[string]*fire
    heap    fireHeap
    wake    chan struct{}
    fn      func(string)
}

func (c *Centralised) Trigger(key string, d time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()
    fireAt := time.Now().Add(d)
    if existing, ok := c.keys[key]; ok {
        existing.fireAt = fireAt
        heap.Fix(&c.heap, existing.idx)
    } else {
        f := &fire{key: key, fireAt: fireAt}
        c.keys[key] = f
        heap.Push(&c.heap, f)
    }
    select {
    case c.wake <- struct{}{}:
    default:
    }
}
```

The dispatch goroutine reads `c.heap[0]`, sleeps until `fireAt`, dispatches, and repeats. `wake` is a non-blocking signal that the next fire-time may have changed.

**Gain.** From 1 M timer heap entries to a 1 M entry custom heap with O(log n) ops we control. The runtime's timer heap stays small (one timer per dispatch goroutine). At very high cardinality (~10 M keys), this drops scheduling cost from "10% of CPU" to "0.1% of CPU."

This is what real systems do: NSQ, RabbitMQ, BadgerDB ttl, all use a centralised timer wheel or heap rather than per-entry `time.Timer`.

---

## Optimization 13 — Precompute `rate.Every` once

**Problem.** `rate.Limiter` is configured with a `rate.Limit` (events per second) and a burst. Calling `rate.Every(d)` on every limiter creation re-computes `1.0/d.Seconds()`. Insignificant per call, but if you re-initialise limiters often (per request, per tenant rotation), it adds up.

**Before:**
```go
func newLim() *rate.Limiter {
    return rate.NewLimiter(rate.Every(50*time.Millisecond), 5)
}
```

**After:**
```go
var limRate = rate.Every(50 * time.Millisecond)

func newLim() *rate.Limiter {
    return rate.NewLimiter(limRate, 5)
}
```

**Gain.** Tiny — a single division and a constant fold. But on a hot creation path (e.g., per-connection limiters), the savings add up. More importantly, this makes the *configured rate* a named constant, easier to find and change.

The same pattern applies to `time.Duration` constants:

```go
const debounceWindow = 200 * time.Millisecond
```

Not an optimisation per se, but it prevents accidentally writing `200 * time.Millisecond` in twelve places, then changing one and forgetting the rest.

---

## Optimization 14 — Drop, do not queue, when overloaded

**Problem.** A debouncer with an internal queue grows under sustained pressure. A throttle with a wait list grows the same way. In both cases, the right behaviour under overload is usually to *drop* the surplus, not queue it.

**Before:**
```go
type Throttle struct {
    in chan Job
}

func New(rate time.Duration) *Throttle {
    t := &Throttle{in: make(chan Job, 10_000)}
    go t.loop(rate)
    return t
}

func (t *Throttle) Submit(j Job) error {
    t.in <- j // blocks if full; latency spikes if buffer fills
    return nil
}
```
At burst load, the buffer fills, sends block, callers' goroutines pile up. The server falls over slowly.

**After:**
```go
func (t *Throttle) Submit(j Job) error {
    select {
    case t.in <- j:
        return nil
    default:
        return ErrOverloaded
    }
}
```

The caller now sees `ErrOverloaded` immediately and can decide: retry later, return an error to the user, or drop the work silently.

**Gain.** Bounded memory and latency under overload. The system *degrades gracefully* instead of *failing slowly*.

Pair this with a metric:
```go
var dropped = expvar.NewInt("throttle_dropped_total")
// in Submit's default branch:
dropped.Add(1)
```
Now you can alert on "drops > 1% of submits" without instrumenting every call site.

---

## Optimization 15 — Combine many small limiters with `errgroup.SetLimit`

**Problem.** A pipeline with three sequential rate-limited stages (parse → enrich → write) requires three limiters and three `Wait` calls. The throughput is bounded by the slowest, but the *latency* is the sum of all three waits.

**Before:**
```go
func process(ctx context.Context, item Item) error {
    if err := parseLim.Wait(ctx); err != nil { return err }
    p := parse(item)
    if err := enrichLim.Wait(ctx); err != nil { return err }
    e := enrich(p)
    if err := writeLim.Wait(ctx); err != nil { return err }
    return write(e)
}
```
The total wait latency is the sum across stages.

**After (one parallelism budget):**
```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(50) // bound concurrency, not rate
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

`SetLimit` bounds in-flight calls. Within each call, no per-stage waiting. Throughput is `(parallelism / per-item-duration)`. The downstream services see the load distributed across in-flight requests, and *their* limiters do the actual rate limiting.

**Gain.** Per-stage limiters are a substitute for end-to-end backpressure when the downstream services do not have their own limiters. If they do, you double-throttle for no benefit. Use `SetLimit` for *concurrency* (bounded resources) and rely on downstream limiters for *rate* (bounded throughput).

---

## Optimization 16 — Avoid the global lock by using `atomic` for simple throttles

**Problem.** A throttle with a `time.Time` and a `sync.Mutex` is fine for a few thousand calls per second. At a million per second, the mutex itself shows up in profiles.

**Before:**
```go
type Throttle struct {
    mu       sync.Mutex
    rate     time.Duration
    lastFire time.Time
}

func (t *Throttle) Allow() bool {
    t.mu.Lock()
    defer t.mu.Unlock()
    now := time.Now()
    if now.Sub(t.lastFire) < t.rate {
        return false
    }
    t.lastFire = now
    return true
}
```

**After (atomic CAS):**
```go
type Throttle struct {
    rate       int64 // nanoseconds
    lastFireNs atomic.Int64
}

func (t *Throttle) Allow() bool {
    now := time.Now().UnixNano()
    for {
        last := t.lastFireNs.Load()
        if now-last < t.rate {
            return false
        }
        if t.lastFireNs.CompareAndSwap(last, now) {
            return true
        }
        // CAS failed; another goroutine just allowed. Retry.
    }
}
```

A compare-and-swap loop. On uncontended calls, this is ~10 ns. On contended calls, the loser retries; in the worst case the loser sees a new `last` close to `now` and returns `false`. Either way, no mutex.

**Gain.** 3–5× faster than mutex on heavily contended throttles. Especially noticeable on many-core machines where mutex cache-line bouncing dominates.

**Caveat.** The CAS loop can starve under heavy contention. For the simple "allow at most one per `rate`" semantics this is fine because losers correctly report "not allowed." For token-bucket semantics (with fractional tokens, refill math), the CAS is harder to get right — stick with mutex there.

---

## Optimization 17 — Coalesce identical events at the source

**Problem.** A debouncer is the wrong layer for "do not send duplicate events." Two consecutive identical events should not even reach the debouncer.

**Before:**
```go
deb := debounce.New(100*time.Millisecond, sendUpdate)
for ev := range stream {
    deb.Trigger() // fires regardless of duplicate
}
```
If `stream` sends 1000 events all with the same payload, the debouncer fires `sendUpdate` once — but it sends the same payload that was just sent on the previous fire.

**After (skip duplicates at the source):**
```go
deb := debounce.New(100*time.Millisecond, sendUpdate)
var last Event
for ev := range stream {
    if ev == last { continue }
    last = ev
    deb.Trigger()
}
```

**Gain.** If 60% of events are duplicates of the previous, `Trigger` is called 40% as often. The debouncer's own work drops; the downstream services see fewer redundant requests. The user experience is unchanged because debouncing already collapsed the duplicates — but the system is doing strictly less work.

Combine with content-hashing for non-comparable payloads:
```go
hash := sha256.Sum256(payload)
if hash == lastHash { continue }
lastHash = hash
```

---

## Optimization 18 — Pre-warm the limiter at startup

**Problem.** A `rate.Limiter` constructed at boot starts with `burst` tokens available. The first `burst` calls go through immediately, then the limit kicks in. This causes a "thundering herd" right after deployment: every replica fires its first `burst` requests simultaneously.

**Before:**
```go
var lim = rate.NewLimiter(10, 100)
// at deployment, every replica has 100 tokens ready
```
A 10-replica deployment fires up to 1000 simultaneous requests in the first second.

**After (drain initial burst):**
```go
var lim = rate.NewLimiter(10, 100)

func init() {
    // Drain the initial burst so the rate kicks in immediately.
    _ = lim.AllowN(time.Now(), 100)
}
```

Or, more flexibly, vary the initial state per replica:
```go
func init() {
    // Random delay 0..1s before the first allowance.
    lim.SetBurstAt(time.Now().Add(time.Duration(rand.Int63n(int64(time.Second)))), 100)
}
```

**Gain.** Avoids deployment-correlated load spikes on downstream services. Especially important when the rate limiter protects an external API with its own usage quota.

---

## Final note

Most "optimization" of debounce and throttle is really *fitness*: matching the algorithm to the workload. A debouncer with too short a window debounces nothing. A throttle with too many limiters limits nothing. A per-request limiter is not a limiter. A per-key map without TTL is a memory leak. A `time.After` in a hot loop is a slow GC.

The optimisations above fall into three categories. *Algorithm-level*: pick the right tool (Bug 3, Bug 9). *Shape-level*: share state correctly (Bug 4, Bug 11). *Implementation-level*: reduce allocations and lock contention (Bug 2, Bug 6, Bug 12, Bug 16). Almost every real performance problem with these primitives is in the first or second category — the wrong algorithm or the wrong scope of state. Profile-driven tuning of the third category is rarely the win you hope for; rewrite the design first.

Measure with `pprof -alloc_objects` and `runtime/trace`. Confirm with a load test. Then ship.
