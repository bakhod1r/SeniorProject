---
layout: default
title: Tasks
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/tasks/
---

# Debounce and Throttle — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end. Run every code sample with `go run -race main.go` and add a `goleak`-based test wherever a goroutine spawns.

---

## Easy

### Task 1 — Trailing debounce with `time.AfterFunc`

Build the simplest useful debouncer. Signature:

```go
type Debouncer struct { /* ... */ }

func New(d time.Duration, fn func()) *Debouncer
func (db *Debouncer) Trigger()
func (db *Debouncer) Stop()
```

Each `Trigger()` resets a timer of duration `d`. When `d` passes with no `Trigger()` call, `fn` runs exactly once. `Stop()` cancels any pending firing and releases timer resources.

Verify the following sequence by hand and in a unit test:

- 5 `Trigger()` calls spaced 50 ms apart with `d = 100 ms` should produce exactly one call to `fn`, ~100 ms after the *last* `Trigger`.
- 0 calls should produce 0 calls to `fn`.
- 1 call should produce 1 call to `fn`, ~100 ms later.
- After `Stop()`, further `Trigger()` calls must not fire `fn`.

**Hint.** Inside `Trigger`, call `t.Stop()` on the existing timer (ignore the return value for now) and create a new one with `time.AfterFunc(d, fn)`. Guard the field with a mutex.

**Goal.** Internalise the core debounce idiom: stop, replace, fire on silence.

---

### Task 2 — Leading debounce

Build a debouncer that fires `fn` *immediately* on the first `Trigger()` of a burst, then ignores every subsequent `Trigger()` for `d` duration. After `d` of silence, the next `Trigger()` fires again immediately.

This is what you want for "save" buttons: the user wants instant feedback on the first click and protection against rage-clicking the next ten times.

Verify:

- One isolated `Trigger()` calls `fn` once.
- A burst of 10 `Trigger()` calls in 50 ms with `d = 100 ms` calls `fn` exactly once, on the first one.
- After 200 ms of silence, the next `Trigger()` calls `fn` again.

**Hint.** Track an `unlockAt time.Time` field. If `time.Now()` is past `unlockAt`, fire and set `unlockAt = time.Now().Add(d)`. Otherwise, ignore.

**Goal.** Understand that "leading" is structurally simpler than "trailing" — it needs only a timestamp, no timer.

---

### Task 3 — Both-edge debounce

Combine leading and trailing: fire on the first event of a burst, and fire again on the trailing edge if at least one *additional* event arrived during the burst.

This is the variant `lodash` calls `{leading: true, trailing: true}`. It is the most accurate for "show a tooltip immediately, then refresh it with the final hover position."

Behaviour:

- 1 event in 200 ms → 1 call (leading only).
- Burst of 10 events in 50 ms with `d = 100 ms` → 2 calls (one leading at t=0, one trailing at t≈150 ms).
- Burst of 10 events in 50 ms followed by 200 ms silence then another single event → 3 calls.

**Hint.** Combine the timestamp from Task 2 with the timer from Task 1. Track a `pendingTrailing bool` that flips to true when an event arrives while the leading lock is active.

**Goal.** Compose the two simpler variants into the production version.

---

### Task 4 — Pass arguments through a debouncer

Extend Task 1's debouncer to forward the *last seen* argument to `fn`:

```go
type Debouncer[T any] struct { /* ... */ }

func New[T any](d time.Duration, fn func(T)) *Debouncer[T]
func (db *Debouncer[T]) Trigger(value T)
```

If `Trigger("a")` is called, then `Trigger("b")` 50 ms later, then 100 ms of silence, the call to `fn` must be `fn("b")` — the latest value wins.

**Hint.** Store the value under the same mutex that guards the timer. The closure passed to `time.AfterFunc` reads the latest value at firing time.

**Goal.** Use generics to make a typed, allocation-free debouncer.

---

### Task 5 — Throttle with `time.Ticker`

Build the simplest throttle. Signature:

```go
type Throttle struct { /* ... */ }

func New(rate time.Duration) *Throttle
func (t *Throttle) TryDo(fn func()) bool
func (t *Throttle) Stop()
```

`TryDo` runs `fn` synchronously if at least `rate` has passed since the last successful call; otherwise it returns `false`. `Stop` releases resources.

Verify with a tight loop:

```go
th := New(100 * time.Millisecond)
ok := 0
for i := 0; i < 100; i++ {
    if th.TryDo(func() {}) { ok++ }
}
// expect ok == 1
time.Sleep(550 * time.Millisecond)
for i := 0; i < 100; i++ {
    if th.TryDo(func() {}) { ok++ }
}
// expect ok == 6 (or 7 depending on monotonic alignment)
```

**Hint.** Track `lastFire time.Time`. No goroutine and no `time.Ticker` are required for this minimal version — a timestamp comparison is enough.

**Goal.** Understand that the simplest throttle is a `Mutex` and a `time.Time` field.

---

## Medium

### Task 6 — Trailing debounce that returns a result

Some debouncers feed an asynchronous response back to the caller — for example, "debounce these search queries, then return the result of the final query."

Build a debouncer with signature:

```go
type SearchDebouncer struct { /* ... */ }

func New(d time.Duration, search func(query string) []Hit) *SearchDebouncer
func (s *SearchDebouncer) Query(q string) <-chan []Hit
```

Each call to `Query` returns a channel that receives one `[]Hit` value or is closed without a value. The *winning* query is the last one before `d` of silence; only that channel receives a result; the others are closed empty.

Verify:

- Sending 5 queries 50 ms apart with `d = 100 ms` → 4 channels close empty, the 5th delivers one result then closes.
- After the result, calling `Query` again must work normally.

**Hint.** Keep a `pending []chan []Hit` slice. When the timer fires, run `search` on the latest query, send to the last channel, and close all others.

**Goal.** Connect a debouncer to the request/response shape callers actually want.

---

### Task 7 — Token bucket from scratch

Implement a token bucket without using `golang.org/x/time/rate`:

```go
type Bucket struct { /* ... */ }

func New(rate float64, burst int) *Bucket   // rate = tokens per second
func (b *Bucket) Allow() bool
func (b *Bucket) Wait(ctx context.Context) error
```

Internally:

- Track `tokens float64` and `lastRefill time.Time`.
- On every `Allow` or `Wait`, compute `elapsed = now - lastRefill`, add `elapsed.Seconds() * rate` tokens (cap at `burst`), and set `lastRefill = now`.
- `Allow` returns true and decrements if `tokens >= 1`, otherwise false.
- `Wait` blocks until a token is available or `ctx` is cancelled.

Verify with a benchmark loop: at `rate = 100, burst = 10`, a 1-second tight loop calling `Allow` should permit 110 ± 1 calls (10 burst + 100 refilled).

**Hint.** Compute the *deficit* in `Wait`: `need = (1 - tokens) / rate` seconds, then `time.Sleep` for that duration (or `select` with `ctx.Done()`). On wake, recompute, in case the timer fired late.

**Goal.** Reproduce the math behind `rate.Limiter` and feel where its design comes from.

---

### Task 8 — Leaky bucket

A leaky bucket is the dual of a token bucket: a fixed-rate *drain* and a queue that holds bursts. Build:

```go
type Leaky struct { /* ... */ }

func New(rate time.Duration, capacity int) *Leaky
func (l *Leaky) Submit(j Job) error // returns error if full
func (l *Leaky) Run(ctx context.Context)  // drains at rate, calls j.Run()
```

Internally:

- `Submit` pushes onto a buffered channel of size `capacity`. If full, return `ErrFull`.
- `Run` consumes from the channel on a `time.Ticker(rate)`. Each tick takes one job (or skips if the channel is empty) and runs it synchronously.
- `Run` returns when `ctx` is cancelled, draining no further.

Verify:

- 100 jobs submitted in a burst with `rate = 10 ms, capacity = 100` → all 100 complete in ~1 s.
- 200 jobs in a burst with `capacity = 100` → 100 succeed, 100 return `ErrFull`.

**Goal.** See the trade-off: token buckets allow bursts, leaky buckets smooth them at the cost of queuing delay.

---

### Task 9 — Sliding-window throttle

Build a throttle that allows at most N events in any rolling window of duration `w`:

```go
type Sliding struct { /* ... */ }

func New(n int, w time.Duration) *Sliding
func (s *Sliding) Allow() bool
```

Maintain a deque of timestamps. On `Allow`:

1. Drop all timestamps older than `now - w`.
2. If the deque has fewer than `n` entries, append `now` and return `true`.
3. Otherwise return `false`.

Compare against `rate.NewLimiter(float64(n)/w.Seconds(), n)`: the token bucket allows bursts up to `n` then refills smoothly; the sliding window enforces the count *over the window*, which is stricter for "no more than 100 in any 60-second period."

Verify with a 1000-event burst at `n=100, w=time.Second`: the first 100 are allowed, the next 900 are rejected, and after exactly 1 second the next 100 are allowed.

**Hint.** Use a `container/list.List` or a slice + index pointer to avoid `O(n)` removal on each call.

**Goal.** Understand the difference between a token bucket and a true sliding window — they answer different questions.

---

### Task 10 — Channel-based debouncer

Build a debouncer that is itself a channel, so callers can use it inside `select`:

```go
func Debounce[T any](in <-chan T, d time.Duration) <-chan T
```

Reads from `in`, holds the latest value, and emits it on `out` after `d` of silence. When `in` is closed, emit any pending value then close `out`.

```go
in := make(chan string)
out := Debounce(in, 100*time.Millisecond)

go func() {
    for _, q := range []string{"a", "ab", "abc"} {
        in <- q
        time.Sleep(50 * time.Millisecond)
    }
    close(in)
}()

for v := range out {
    fmt.Println(v) // prints "abc" once, then loop exits
}
```

**Hint.** Use a `time.Timer` whose `C` channel competes with `in` in a `select`. Track `latest T` and a `havePending bool`.

**Goal.** Express the debouncer as a stream transformer; this composes naturally with pipelines.

---

### Task 11 — Per-key debouncer

Real systems often need a debouncer *per user*, *per file*, *per session*. Build:

```go
type KeyedDebouncer[K comparable] struct { /* ... */ }

func New[K comparable](d time.Duration, fn func(K)) *KeyedDebouncer[K]
func (d *KeyedDebouncer[K]) Trigger(key K)
func (d *KeyedDebouncer[K]) Stop()
```

Each unique `key` gets its own debouncer. Triggering key `"a"` does not affect key `"b"`.

Trickier than it sounds: a long-tail of unique keys keeps adding timers forever. Add a cleanup that removes inactive entries after `2*d` of silence.

Verify with `goleak`:

- After triggering 1000 distinct keys and waiting `3*d`, `runtime.NumGoroutine` and the internal map size should both return to baseline.

**Hint.** Map `K → *entry`. Guard with `sync.Mutex`. The cleanup happens inside the timer callback: when the trailing timer fires for a key, delete the key from the map.

**Goal.** Solve the unbounded-cardinality problem that real systems run into.

---

### Task 12 — Throttle with `rate.Limiter` and `context.Context`

Use `golang.org/x/time/rate` to build a `Wait`-style throttle for HTTP outbound requests:

```go
type Client struct {
    http *http.Client
    lim  *rate.Limiter
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error)
```

`Do` must:

1. Call `c.lim.Wait(ctx)` first.
2. Then `c.http.Do(req)` with the same context.
3. Propagate context cancellation correctly (if `ctx` is cancelled during `Wait`, return that error; same during `Do`).

Configure `rate.NewLimiter(rate.Every(100*time.Millisecond), 5)`: 10 req/s steady, 5 burst.

Test with 50 concurrent goroutines making 100 requests total to a local test server. Confirm the server sees a steady 10 req/s with no spikes beyond 5.

**Goal.** Use the standard `rate.Limiter` API in a real shape.

---

### Task 13 — Coalescing event collector

Many real "debouncer" callsites are actually *event collectors*: instead of "fire once with the latest value," they want "fire once with *all* values from the burst, deduplicated."

Build:

```go
type Coalescer[T comparable] struct { /* ... */ }

func New[T comparable](d time.Duration, fn func([]T)) *Coalescer[T]
func (c *Coalescer[T]) Add(v T)
```

Behaviour: after `d` of silence, `fn` is called with the unique values seen during the burst, in insertion order.

Verify:

- `Add("a"), Add("b"), Add("a"), Add("c")` then wait `d` → `fn(["a", "b", "c"])`.
- Empty burst (no `Add`) → no call.

**Hint.** Use a `map[T]struct{}` for dedup and a `[]T` for order. Reset both on flush.

**Goal.** Understand that "debounce" is one of three closely related patterns (latest-wins, coalesce-set, coalesce-list).

---

## Hard

### Task 14 — Distributed token bucket via Redis stub

Build a token bucket that shares state across processes via a Redis-like key-value store. Provide a minimal interface so you can stub it in tests:

```go
type KVStore interface {
    // Eval runs a script atomically. The script receives (now_ms int64) and the key's previous value (or "").
    // It returns the new value and an allow flag.
    Eval(ctx context.Context, key string, nowMs int64) (newValue string, allow bool, err error)
}

type DistributedBucket struct {
    kv     KVStore
    key    string
    rate   float64
    burst  float64
}

func (b *DistributedBucket) Allow(ctx context.Context) (bool, error)
```

The "script" should:

1. Parse the previous value as `tokens float64, lastRefill int64`.
2. Refill tokens based on `now - lastRefill`.
3. If `tokens >= 1`, decrement and return `allow = true`.
4. Otherwise return `allow = false`.
5. Save the new value back.

In production this is a Redis `EVAL` of a Lua script. In tests, the `KVStore` stub holds a `map[string]string` under a mutex; the test calls `Allow` from many goroutines and asserts the rate is enforced globally.

Verify with 10 goroutines hammering a `rate = 5, burst = 10` bucket: total `allow=true` count in 1 second should be ~15 (10 burst + 5 refilled).

**Goal.** Distinguish process-local rate limits from cluster-wide rate limits. Production rate limiting nearly always lives in Redis.

---

### Task 15 — Hierarchical limiter

Real systems often need *both* a global limit and per-tenant limits, with the *minimum* applied. Build:

```go
type Hierarchical struct {
    global *rate.Limiter
    perKey func(key string) *rate.Limiter
}

func (h *Hierarchical) Wait(ctx context.Context, key string) error
```

`Wait` returns when *both* limiters allow a token. If the global limit is exhausted, even a tenant under its own limit waits.

Important: do not consume a token from one limiter while the other refuses, or you waste tokens. Use `Reserve` instead of `Wait` if you need to compose:

```go
g := h.global.Reserve()
k := h.perKey(key).Reserve()
delay := max(g.Delay(), k.Delay())
if delay > 0 {
    select {
    case <-time.After(delay):
    case <-ctx.Done():
        g.Cancel()
        k.Cancel()
        return ctx.Err()
    }
}
```

**Hint.** `rate.Limiter.Reserve()` returns a `*Reservation`. Calling `Cancel()` on it returns the reserved token to the bucket if you decide not to wait.

**Goal.** Compose multiple limiters correctly without double-consuming tokens.

---

### Task 16 — `Reset` race in a debouncer

Take any debouncer from earlier tasks. Add a `Reset(d time.Duration)` method that changes the debounce window at runtime. Make sure it is safe to call from multiple goroutines while `Trigger` is also being called.

Write a stress test:

```go
db := New(50*time.Millisecond, fn)
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := 0; j < 1000; j++ {
            db.Trigger()
            if j%100 == 0 { db.Reset(time.Duration(j) * time.Millisecond) }
        }
    }()
}
wg.Wait()
```

Run with `go test -race`. Common bugs:

- The timer is replaced without stopping the old one → both fire.
- `t.Stop()` is called but the channel is not drained → goroutine leak.
- The mutex protects field access but not the call to the user's `fn` → reentrancy bug if `fn` calls `Trigger` again.

**Goal.** Survive concurrent mutation of timer state.

---

### Task 17 — Debouncer that flushes on shutdown

Many real debouncers must *flush* their pending value when the program shuts down — otherwise the last edit, last metric, or last log line is lost.

Extend Task 1's debouncer with:

```go
func (db *Debouncer) Flush() // fire fn now if pending, else no-op
func (db *Debouncer) Close() // flush + stop timer + release resources
```

Wire it to `signal.NotifyContext` so a SIGTERM flushes any pending fire before exit:

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
defer stop()

go func() {
    <-ctx.Done()
    db.Close()
}()
```

Verify with a test that triggers, then cancels the context before the timer would have fired, and asserts that `fn` was called exactly once.

**Goal.** Make a debouncer that does not lose data on graceful shutdown.

---

### Task 18 — Throttle that decays on errors

Adaptive throttling: when the downstream service returns errors, reduce the rate. When it recovers, increase the rate. AIMD (additive increase, multiplicative decrease) is the classic algorithm:

```go
type Adaptive struct {
    lim     *rate.Limiter
    onError func() // halve the rate, with floor
    onOk    func() // additive bump, with ceiling
}

func (a *Adaptive) Do(ctx context.Context, fn func() error) error
```

Each call:

- `a.lim.Wait(ctx)`.
- `err := fn()`.
- If `err != nil`, call `onError`. Otherwise, call `onOk`.

`onError` sets `a.lim.SetLimit(max(a.floor, a.lim.Limit()/2))`. `onOk` sets `a.lim.SetLimit(min(a.ceil, a.lim.Limit() + a.step))`.

Test with a fake downstream that returns errors when called too fast: the limiter should settle into a stable rate just below the breakage threshold.

**Goal.** Build an adaptive control loop. This is how Netflix's `concurrency-limits` library works.

---

### Task 19 — Replace `time.Ticker` with `time.AfterFunc` for jitter-free scheduling

`time.Ticker` accumulates skew if the consumer is slow: ticks queue up to channel capacity 1, then drop. For some workloads you want the *next* fire to be `d` after the *previous fire's completion*, not `d` after the *previous fire's scheduled time*.

Build a `JitterTicker`:

```go
type JitterTicker struct { C <-chan time.Time }

func New(d time.Duration) *JitterTicker
func (t *JitterTicker) Stop()
```

After a value is read from `C`, the next value is scheduled `d` later. If the reader takes 500 ms between reads, the next value fires 500 ms + `d` later, not `d` later.

**Hint.** Wrap `time.AfterFunc`. Each fire schedules the next.

**Goal.** Understand the two distinct scheduling models — fixed-rate vs fixed-delay — and when each is appropriate.

---

### Task 20 — Combine debounce and throttle in a UI handler

Build a search box backend:

```go
type Search struct {
    deb *Debouncer
    th  *rate.Limiter
}

func (s *Search) Query(ctx context.Context, q string) (<-chan []Hit, error)
```

Behaviour:

- `Query` returns immediately with a channel.
- Internally, debounce queries with `d = 150 ms` so rapid typing collapses into one call.
- When the debounce fires, *throttle* the actual outbound call to the search service at 5 req/s — multiple users debouncing at once must not exceed this.
- If the throttle cannot acquire within 200 ms, return an error on the channel.

Wire it under a fake `http.Server`; load-test with 100 simulated users typing at 60 wpm. Confirm the search service sees at most 5 req/s and the user-perceived latency stays under 400 ms p99.

**Goal.** Compose debounce + throttle correctly in a production shape.

---

## Solution Sketches

### Task 1

```go
package debounce

import (
    "sync"
    "time"
)

type Debouncer struct {
    d      time.Duration
    fn     func()
    mu     sync.Mutex
    timer  *time.Timer
    closed bool
}

func New(d time.Duration, fn func()) *Debouncer {
    return &Debouncer{d: d, fn: fn}
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.closed {
        return
    }
    if db.timer != nil {
        db.timer.Stop()
    }
    db.timer = time.AfterFunc(db.d, db.fn)
}

func (db *Debouncer) Stop() {
    db.mu.Lock()
    defer db.mu.Unlock()
    db.closed = true
    if db.timer != nil {
        db.timer.Stop()
        db.timer = nil
    }
}
```

`time.AfterFunc` runs `fn` in a fresh goroutine spawned by the runtime. `Stop` on a timer that has already fired is a no-op.

---

### Task 2

```go
type Leading struct {
    d         time.Duration
    fn        func()
    mu        sync.Mutex
    unlockAt  time.Time
}

func New(d time.Duration, fn func()) *Leading {
    return &Leading{d: d, fn: fn}
}

func (l *Leading) Trigger() {
    l.mu.Lock()
    now := time.Now()
    if now.Before(l.unlockAt) {
        l.mu.Unlock()
        return
    }
    l.unlockAt = now.Add(l.d)
    l.mu.Unlock()
    l.fn()
}
```

No timer required. The locked window is enforced by a timestamp comparison.

---

### Task 4

```go
type Debouncer[T any] struct {
    d     time.Duration
    fn    func(T)
    mu    sync.Mutex
    timer *time.Timer
    last  T
}

func New[T any](d time.Duration, fn func(T)) *Debouncer[T] {
    return &Debouncer[T]{d: d, fn: fn}
}

func (db *Debouncer[T]) Trigger(v T) {
    db.mu.Lock()
    db.last = v
    if db.timer != nil {
        db.timer.Stop()
    }
    db.timer = time.AfterFunc(db.d, func() {
        db.mu.Lock()
        v := db.last
        db.mu.Unlock()
        db.fn(v)
    })
    db.mu.Unlock()
}
```

The closure reads `db.last` under the lock at firing time, so the latest value wins even if the timer was reset between scheduling and firing.

---

### Task 5

```go
type Throttle struct {
    rate     time.Duration
    mu       sync.Mutex
    lastFire time.Time
}

func New(rate time.Duration) *Throttle { return &Throttle{rate: rate} }

func (t *Throttle) TryDo(fn func()) bool {
    t.mu.Lock()
    now := time.Now()
    if now.Sub(t.lastFire) < t.rate {
        t.mu.Unlock()
        return false
    }
    t.lastFire = now
    t.mu.Unlock()
    fn()
    return true
}

func (t *Throttle) Stop() {} // nothing to release
```

No goroutine, no channel, no timer. Many real throttles are this simple.

---

### Task 7

```go
type Bucket struct {
    mu         sync.Mutex
    rate       float64
    burst      float64
    tokens     float64
    lastRefill time.Time
}

func New(rate float64, burst int) *Bucket {
    return &Bucket{
        rate: rate, burst: float64(burst),
        tokens: float64(burst), lastRefill: time.Now(),
    }
}

func (b *Bucket) refillLocked(now time.Time) {
    elapsed := now.Sub(b.lastRefill).Seconds()
    b.tokens += elapsed * b.rate
    if b.tokens > b.burst {
        b.tokens = b.burst
    }
    b.lastRefill = now
}

func (b *Bucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.refillLocked(time.Now())
    if b.tokens >= 1 {
        b.tokens--
        return true
    }
    return false
}

func (b *Bucket) Wait(ctx context.Context) error {
    for {
        b.mu.Lock()
        now := time.Now()
        b.refillLocked(now)
        if b.tokens >= 1 {
            b.tokens--
            b.mu.Unlock()
            return nil
        }
        needSec := (1 - b.tokens) / b.rate
        b.mu.Unlock()
        timer := time.NewTimer(time.Duration(needSec * float64(time.Second)))
        select {
        case <-timer.C:
        case <-ctx.Done():
            timer.Stop()
            return ctx.Err()
        }
    }
}
```

The loop in `Wait` handles spurious wakeups and refills that crossed a fractional token boundary.

---

### Task 9

```go
type Sliding struct {
    n  int
    w  time.Duration
    mu sync.Mutex
    ts []time.Time
}

func New(n int, w time.Duration) *Sliding {
    return &Sliding{n: n, w: w, ts: make([]time.Time, 0, n)}
}

func (s *Sliding) Allow() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-s.w)
    // drop entries older than cutoff
    i := 0
    for i < len(s.ts) && s.ts[i].Before(cutoff) {
        i++
    }
    s.ts = s.ts[i:]
    if len(s.ts) >= s.n {
        return false
    }
    s.ts = append(s.ts, now)
    return true
}
```

The slice shifts on each call. For high call rates use `container/list` or a ring buffer.

---

### Task 10

```go
func Debounce[T any](in <-chan T, d time.Duration) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        var (
            latest      T
            havePending bool
            timer       *time.Timer
            timerC      <-chan time.Time
        )
        for {
            select {
            case v, ok := <-in:
                if !ok {
                    if havePending {
                        out <- latest
                    }
                    if timer != nil {
                        timer.Stop()
                    }
                    return
                }
                latest = v
                havePending = true
                if timer != nil {
                    timer.Stop()
                }
                timer = time.NewTimer(d)
                timerC = timer.C
            case <-timerC:
                out <- latest
                havePending = false
                timerC = nil
            }
        }
    }()
    return out
}
```

When the input closes with a pending value, we emit it before returning. Setting `timerC = nil` disables the case until the next input.

---

### Task 11

```go
type entry struct {
    timer *time.Timer
}

type KeyedDebouncer[K comparable] struct {
    d       time.Duration
    fn      func(K)
    mu      sync.Mutex
    entries map[K]*entry
}

func New[K comparable](d time.Duration, fn func(K)) *KeyedDebouncer[K] {
    return &KeyedDebouncer[K]{d: d, fn: fn, entries: make(map[K]*entry)}
}

func (kd *KeyedDebouncer[K]) Trigger(k K) {
    kd.mu.Lock()
    defer kd.mu.Unlock()
    e, ok := kd.entries[k]
    if !ok {
        e = &entry{}
        kd.entries[k] = e
    } else if e.timer != nil {
        e.timer.Stop()
    }
    e.timer = time.AfterFunc(kd.d, func() {
        kd.mu.Lock()
        delete(kd.entries, k)
        kd.mu.Unlock()
        kd.fn(k)
    })
}

func (kd *KeyedDebouncer[K]) Stop() {
    kd.mu.Lock()
    defer kd.mu.Unlock()
    for _, e := range kd.entries {
        if e.timer != nil {
            e.timer.Stop()
        }
    }
    kd.entries = map[K]*entry{}
}
```

The key is removed from the map when its timer fires, so the map size tracks "active" keys, not "all-time-seen" keys.

---

### Task 14

```go
type DistributedBucket struct {
    kv    KVStore
    key   string
    rate  float64
    burst float64
}

func (b *DistributedBucket) Allow(ctx context.Context) (bool, error) {
    now := time.Now().UnixMilli()
    _, ok, err := b.kv.Eval(ctx, b.key, now)
    return ok, err
}

// Stub for tests:
type memKV struct {
    mu sync.Mutex
    m  map[string]string
    f  func(prev string, nowMs int64) (string, bool)
}

func (k *memKV) Eval(_ context.Context, key string, nowMs int64) (string, bool, error) {
    k.mu.Lock()
    defer k.mu.Unlock()
    newVal, ok := k.f(k.m[key], nowMs)
    k.m[key] = newVal
    return newVal, ok, nil
}
```

The script `f` is the equivalent of the Lua script in Redis. The mutex makes the stub atomic; in Redis, `EVAL` is single-threaded.

---

### Task 19

```go
type JitterTicker struct {
    C    <-chan time.Time
    out  chan time.Time
    stop chan struct{}
}

func New(d time.Duration) *JitterTicker {
    out := make(chan time.Time, 1)
    stop := make(chan struct{})
    t := &JitterTicker{C: out, out: out, stop: stop}
    var fire func()
    fire = func() {
        select {
        case <-stop:
            return
        case t.out <- time.Now():
        }
        time.AfterFunc(d, fire)
    }
    time.AfterFunc(d, fire)
    return t
}

func (t *JitterTicker) Stop() { close(t.stop) }
```

Each fire schedules the next, so the period is "between consecutive fires," not "since first start."

---

### Task 20

```go
type Search struct {
    deb *Debouncer
    th  *rate.Limiter
    src func(ctx context.Context, q string) ([]Hit, error)
}

func (s *Search) Query(ctx context.Context, q string) <-chan []Hit {
    out := make(chan []Hit, 1)
    s.deb.TriggerWith(q, func(latest string) {
        ctxT, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
        defer cancel()
        if err := s.th.Wait(ctxT); err != nil {
            close(out)
            return
        }
        hits, err := s.src(ctx, latest)
        if err != nil {
            close(out)
            return
        }
        out <- hits
        close(out)
    })
    return out
}
```

The debouncer collapses keystrokes; the rate limiter caps cross-user volume. The 200 ms `WithTimeout` on `Wait` gives back-pressure rather than queueing forever.

---

## Final note

Debounce and throttle are deceptively simple. The math is short, the moving parts are a timer, a channel, and a `select`, and the API surface is two methods. What makes them production-grade is everything you build *around* them — flush-on-shutdown, per-key cardinality control, adaptive rates, distributed coordination, and the discipline to choose the right variant for the workload. Solve every task above and you will have written every common variant by hand, which is the only way to know which one to reach for in real code.
