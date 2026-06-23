---
layout: default
title: Find Bug
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/find-bug/
---

# Debounce and Throttle — Find the Bug

> Each snippet contains a real bug from real codebases — a debouncer that never fires, a throttle that leaks goroutines, a race inside `Reset`, a monotonic-clock confusion, a `time.Ticker` that never gets stopped, a sliding window that drifts. Find it, explain it, fix it. Every snippet compiles. Every fix has been seen on the production side of a postmortem.

---

## Bug 1 — Debouncer that never fires

```go
type Debouncer struct {
    d  time.Duration
    fn func()
    mu sync.Mutex
    t  *time.Timer
}

func New(d time.Duration, fn func()) *Debouncer {
    return &Debouncer{d: d, fn: fn}
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Reset(db.d)
        return
    }
    db.t = time.NewTimer(db.d)
    go func() {
        <-db.t.C
        db.fn()
    }()
}
```

**Bug.** The "first call creates the timer and a watcher goroutine, subsequent calls call `Reset`." This is the textbook race that the `time` package docs explicitly warn about:

> Reset should be invoked only on stopped or expired timers with drained channels.

After the watcher goroutine fires once on `<-db.t.C`, it exits. The next `Trigger` calls `Reset`, the timer fires again on the channel — but nobody is listening. Result: `fn` is called exactly *once*, ever, for the lifetime of the debouncer. Every subsequent `Trigger` "resets" a timer whose channel goes unread.

Worse: on Go 1.22 and earlier, `Reset` on an already-fired timer might leave a stale value in `t.C`, so subsequent reads of `t.C` return immediately with old timestamps. Behaviour depends on Go version.

**Fix.** Use `time.AfterFunc` instead, which spawns its own callback goroutine per fire:

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

`time.AfterFunc` is the right primitive for "fire `fn` after `d` of silence, allow the schedule to be reset." Every call replaces the timer; the runtime handles goroutine lifecycle.

---

## Bug 2 — Throttle that leaks goroutines

```go
type Throttle struct {
    rate time.Duration
}

func (t *Throttle) Do(fn func()) {
    done := make(chan struct{})
    go func() {
        fn()
        close(done)
    }()
    select {
    case <-done:
    case <-time.After(t.rate):
    }
}
```

**Bug.** This is *not* a throttle — it is a "run with timeout" — but more importantly, when `time.After(t.rate)` fires first, the function returns immediately while the goroutine running `fn()` keeps going. The `done` channel is unbuffered and abandoned; the goroutine's `close(done)` is a no-op (it does not block on `close`), but if anything else in `fn` interacts with shared state, you have a leaked computation.

Two real leak vectors:

1. The `time.After` channel is held by the runtime until it fires. Calling `Do` 100 000 times with `t.rate = 1 hour` accumulates 100 000 unfireable `time.After` channels in the runtime's timer heap until each one fires. `pprof goroutine` shows nothing; the runtime heap shows the bloat.
2. The `fn` goroutine outlives the `Do` call. If `fn` was meant to be "the unit of throttled work," you have spawned uncountable shadow goroutines.

**Fix.** Use `time.NewTimer` + `Stop` to release the timer immediately, and make the throttling explicit:

```go
type Throttle struct {
    mu       sync.Mutex
    rate     time.Duration
    lastFire time.Time
}

func (t *Throttle) Do(fn func()) bool {
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
```

Throttling is "did at least `rate` time pass since the last allowed call?" — no goroutine, no `time.After`.

---

## Bug 3 — `Reset` race on a debouncer

```go
type Debouncer struct {
    d  time.Duration
    fn func()
    t  *time.Timer
}

func (db *Debouncer) Trigger() {
    if db.t == nil {
        db.t = time.AfterFunc(db.d, db.fn)
        return
    }
    db.t.Reset(db.d)
}
```

**Bug.** No mutex. The `if db.t == nil` check and the `db.t = ...` assignment are not atomic. Two concurrent `Trigger` calls can both see `nil` and both create a timer; one timer leaks, and `fn` fires twice for one burst. Race detector flags the write to `db.t` against the read.

Worse: `time.AfterFunc` spawns a goroutine that calls `fn`. The goroutine reads the timer state to decide whether `Stop` has fired. If `Trigger` is racing with the firing goroutine, `Reset` on a timer whose callback is already running can drop the new schedule.

**Fix.** Mutex around all timer state, including the nil check:

```go
type Debouncer struct {
    d  time.Duration
    fn func()
    mu sync.Mutex
    t  *time.Timer
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t == nil {
        db.t = time.AfterFunc(db.d, db.fn)
        return
    }
    db.t.Stop()
    db.t.Reset(db.d)
}
```

`Stop` + `Reset` together are safer than `Reset` alone when you do not know whether the timer is active. Read `time.Timer.Reset` docs; they describe a 4-step dance for the safe case. `time.AfterFunc` timers can be reset more permissively, but the mutex is still required for `db.t` itself.

---

## Bug 4 — `time.Now` monotonic confusion

```go
type Throttle struct {
    mu       sync.Mutex
    rate     time.Duration
    lastFire time.Time
}

func (t *Throttle) Allow() bool {
    t.mu.Lock()
    defer t.mu.Unlock()
    now := time.Now().UTC() // BUG
    if now.Sub(t.lastFire) < t.rate {
        return false
    }
    t.lastFire = now
    return true
}
```

**Bug.** `time.Now()` in Go returns a `time.Time` that carries both a wall-clock component and a monotonic-clock reading. Calling `.UTC()`, `.Round(0)`, or marshalling-and-unmarshalling *strips the monotonic reading*. Once the monotonic reading is gone, `time.Sub` uses only the wall clock.

The wall clock can jump backward (NTP, daylight-saving, user setting the system clock). When it does:

- `now.Sub(t.lastFire)` returns a negative or very large positive duration.
- A small backward jump makes the throttle let everything through (negative `Sub` is less than any positive `rate`).
- A small forward jump opens a "credit" window where the throttle suddenly stops blocking.

**Fix.** Never strip the monotonic reading on a `time.Time` you plan to use for elapsed-time math:

```go
now := time.Now() // keep monotonic
```

If you need a UTC display, do that conversion only at the moment of formatting, not before arithmetic:

```go
formatted := t.lastFire.UTC().Format(time.RFC3339)
elapsed := time.Now().Sub(t.lastFire) // arithmetic still uses monotonic
```

The Go documentation for `time.Time` describes this rule explicitly. Hammered into developers after one too many "throttle stopped working after the clock-sync ran" incidents.

---

## Bug 5 — `time.Ticker` leaked on early return

```go
func RunLogger(ctx context.Context, ch <-chan LogEntry) error {
    t := time.NewTicker(100 * time.Millisecond)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case e := <-ch:
            if err := flush(e); err != nil {
                return err // BUG: ticker leaked
            }
        case <-t.C:
            heartbeat()
        }
    }
}
```

**Bug.** The `return err` path exits without calling `t.Stop()`. The ticker's internal goroutine continues to fire every 100 ms forever, pushing values onto `t.C` that nobody reads. The ticker holds its own struct in the runtime's timer heap until program exit.

For a one-shot run, the leak is finite. For a long-lived service that calls `RunLogger` thousands of times, the timer heap grows linearly, and so does sysmon's per-tick work.

**Fix.** `defer t.Stop()` immediately after creating the ticker:

```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()
```

This is the universal rule for `time.Ticker`. Same rule for `time.Timer` if you may exit before it fires. `time.AfterFunc` is the only one where `Stop` is optional (the runtime cleans up after fire).

---

## Bug 6 — Throttle that allows initial burst of N+1

```go
type Throttle struct {
    rate     time.Duration
    last     time.Time // zero value at start
}

func (t *Throttle) Allow() bool {
    now := time.Now()
    if now.Sub(t.last) < t.rate {
        return false
    }
    t.last = now
    return true
}
```

**Bug.** No mutex (would race), but separately: at construction, `t.last` is the zero value `0001-01-01 00:00:00 UTC`. `now.Sub(zero)` is roughly 2000 years. The first `Allow` always returns `true`, regardless of how the user constructed the throttle. Fine if you wanted a leading-edge throttle. Not fine if you wanted a strict "no calls in the first `rate` after construction."

Worse: there is also a race. Two concurrent `Allow` calls both see the same `t.last`, both write `now`, both return `true`. The "throttle" lets through unpredictable bursts under load.

**Fix.** Add the mutex *and* initialise `last` deliberately:

```go
type Throttle struct {
    mu   sync.Mutex
    rate time.Duration
    last time.Time
}

func New(rate time.Duration, deferFirst bool) *Throttle {
    t := &Throttle{rate: rate}
    if deferFirst {
        t.last = time.Now() // first Allow waits one full `rate`
    }
    return t
}

func (t *Throttle) Allow() bool {
    t.mu.Lock()
    defer t.mu.Unlock()
    now := time.Now()
    if now.Sub(t.last) < t.rate {
        return false
    }
    t.last = now
    return true
}
```

Spell out the policy in the constructor. "Allow the first immediately" vs. "make the first wait" are both reasonable; silent disagreement between authors causes outages.

---

## Bug 7 — Debouncer captures pointer that changes

```go
type Debouncer struct {
    d  time.Duration
    mu sync.Mutex
    t  *time.Timer
}

func (db *Debouncer) Send(req *Request) {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, func() {
        deliver(req) // BUG
    })
}
```

```go
// caller
db := &Debouncer{d: 100 * time.Millisecond}
for _, r := range incoming {
    db.Send(r)
}
```

**Bug.** Each `Send` captures `req` in the `AfterFunc` closure. The closure runs *only the most recent timer*, which is fine — the most recent closure holds the most recent `req`. But `incoming` may be a slice of pointers whose underlying values are mutated by the producer after the slice is built. In that case, the closure dereferences `req` at firing time and sees whatever the producer has done to it in the meantime.

Even worse: if the producer is reusing `*Request` buffers (e.g., `sync.Pool`), the `req` pointer may now point to a *completely different* request than the one originally enqueued.

**Fix.** Snapshot the value, not the pointer:

```go
func (db *Debouncer) Send(req *Request) {
    snapshot := *req
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, func() {
        deliver(&snapshot)
    })
}
```

Or, if `Request` is large, take a stable snapshot of the fields you actually need.

---

## Bug 8 — Sliding window that grows without bound

```go
type Sliding struct {
    n  int
    w  time.Duration
    mu sync.Mutex
    ts []time.Time
}

func (s *Sliding) Allow() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    now := time.Now()
    s.ts = append(s.ts, now)
    cutoff := now.Add(-s.w)
    out := 0
    for _, t := range s.ts {
        if t.After(cutoff) {
            out++
        }
    }
    return out <= s.n
}
```

**Bug.** Two issues.

1. `ts` is appended to on every call but never trimmed. After a million calls, `ts` has a million entries, and every subsequent `Allow` is O(n).
2. The decision `out <= s.n` is taken *after* the append. So if `s.ts` already had `n` entries inside the window, the new entry pushes count to `n+1` and the function returns `false` — but the entry is still in the slice, polluting future windows.

**Fix.** Drop expired entries *before* the decision, and only append if allowing:

```go
func (s *Sliding) Allow() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-s.w)
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

For high-traffic services, replace the slice with a ring buffer of size `n`. The slice version is O(1) amortised on the drop, but every drop copies the slice header; a ring buffer avoids that.

---

## Bug 9 — Debouncer with stale closure

```go
type Debouncer struct {
    d   time.Duration
    fn  func()
    mu  sync.Mutex
    t   *time.Timer
}

func (db *Debouncer) SetFn(fn func()) {
    db.mu.Lock()
    db.fn = fn
    db.mu.Unlock()
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    fn := db.fn // captured here
    db.t = time.AfterFunc(db.d, fn)
}
```

**Bug.** The `AfterFunc` callback captures `fn`, not `db.fn`. If the caller updates `db.fn` via `SetFn` *after* `Trigger` scheduled the timer, the in-flight timer still fires the *old* `fn`.

This is sometimes what you want — "schedule what I had when I triggered" — but it is rarely what callers expect when they "update the callback." Compare with the pointer-capture bug in Bug 7: there the pointer changes were unintended. Here the field changes are intended, but the capture is by value.

**Fix.** Capture `db` itself and re-read the field in the callback:

```go
db.t = time.AfterFunc(db.d, func() {
    db.mu.Lock()
    fn := db.fn
    db.mu.Unlock()
    if fn != nil {
        fn()
    }
})
```

Now `SetFn` is observed by the next firing.

---

## Bug 10 — Throttle accidentally becoming a debouncer under load

```go
type Throttle struct {
    rate     time.Duration
    in       chan struct{}
}

func New(rate time.Duration) *Throttle {
    t := &Throttle{rate: rate, in: make(chan struct{})}
    go t.loop()
    return t
}

func (t *Throttle) Try() bool {
    select {
    case t.in <- struct{}{}:
        return true
    default:
        return false
    }
}

func (t *Throttle) loop() {
    for range t.in {
        time.Sleep(t.rate)
    }
}
```

**Bug.** Under heavy load, `loop` is stuck in `time.Sleep` and `t.in` is unbuffered. `Try` cannot send into `t.in`, so it falls through to `default` and returns `false`. So far so good.

But when load is *low*, the user calls `Try`, `loop` sleeps `rate`, then loops back and reads another `t.in`. If no caller is sending in that moment, `loop` blocks on the read; the next `Try` succeeds, sends, and `loop` sleeps again.

The catch: between `loop` waking up and reaching the `for range t.in` read, there is a window where `Try` calls fail with `default`. With erratic call patterns this looks like a debouncer (only one of every burst gets through) rather than a throttle (steady rate). Worst case, under variable load the user sees throughput swing between "all" and "nothing" with no middle ground.

**Fix.** Use the timestamp-based version (Bug 6's fix). The channel-and-sleep pattern is fragile precisely because the receiver's wake-up timing matters. A timestamp-based throttle has no such window.

---

## Bug 11 — `rate.Limiter` with shared `*rate.Limiter` per request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    lim := rate.NewLimiter(rate.Every(100*time.Millisecond), 1)
    if !lim.Allow() {
        http.Error(w, "slow down", http.StatusTooManyRequests)
        return
    }
    serveTheThing(w, r)
}
```

**Bug.** A fresh `*rate.Limiter` per request. Each one starts with `burst = 1` tokens. Every request gets the leading token. The throttle does nothing.

This bug pattern looks correct because the author thinks of `rate.Limiter` as "the configured rate." In fact, the rate is configured *on a specific limiter*, and the limiter's state is per-instance. Sharing a limiter across requests is the whole point.

**Fix.** Hoist the limiter to package or struct scope:

```go
var globalLim = rate.NewLimiter(rate.Every(100*time.Millisecond), 1)

func handler(w http.ResponseWriter, r *http.Request) {
    if !globalLim.Allow() {
        http.Error(w, "slow down", http.StatusTooManyRequests)
        return
    }
    serveTheThing(w, r)
}
```

For per-tenant throttling, key a map of `*rate.Limiter`:

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
    lim := rate.NewLimiter(rate.Every(100*time.Millisecond), 5)
    l.m[tenant] = lim
    return lim
}
```

Same lesson as Bug 8: state in a "rate limiter" must outlive the call that uses it.

---

## Bug 12 — Wait that never returns under cancellation

```go
type Bucket struct {
    mu     sync.Mutex
    tokens float64
    rate   float64
}

func (b *Bucket) Wait(ctx context.Context) error {
    for {
        b.mu.Lock()
        if b.tokens >= 1 {
            b.tokens--
            b.mu.Unlock()
            return nil
        }
        b.mu.Unlock()
        time.Sleep(10 * time.Millisecond)
    }
}
```

**Bug.** `Wait` ignores `ctx`. If `ctx` is cancelled while the loop is in `time.Sleep`, the function does not return until the 10 ms sleep finishes (best case) or until a token becomes available (worst case — could be forever if `rate = 0`).

In a typical HTTP server, ignoring `ctx` means a client disconnection does not free server resources. Connections pile up; eventually the server hits its file descriptor limit.

**Fix.** Replace `time.Sleep` with `select`:

```go
func (b *Bucket) Wait(ctx context.Context) error {
    for {
        b.mu.Lock()
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

Even better, compute the *exact* wait time from the deficit (`(1 - tokens) / rate * time.Second`) rather than a fixed 10 ms poll. The standard `rate.Limiter` does this.

`time.After` itself leaks until it fires — but at 10 ms duration the leak is bounded. For variable-length waits, use `time.NewTimer` + `Stop`:

```go
timer := time.NewTimer(wait)
select {
case <-timer.C:
case <-ctx.Done():
    timer.Stop()
    return ctx.Err()
}
```

---

## Bug 13 — Per-key map that grows forever

```go
type Limited struct {
    mu sync.Mutex
    m  map[string]*rate.Limiter
}

func (l *Limited) Allow(key string) bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    lim, ok := l.m[key]
    if !ok {
        lim = rate.NewLimiter(rate.Every(100*time.Millisecond), 5)
        l.m[key] = lim
    }
    return lim.Allow()
}
```

**Bug.** Keys are added but never removed. If keys are user IDs from an authenticated service, the map size tracks unique users. If keys are IP addresses from public traffic, the map grows by attacker request: 100 000 spoofed IPs → 100 000 limiter structs. Memory does not bound itself.

**Fix.** Use a TTL cache. Either a third-party LRU (`hashicorp/golang-lru/v2`), or a periodic sweep:

```go
type entry struct {
    lim   *rate.Limiter
    seenAt time.Time
}

type Limited struct {
    mu sync.Mutex
    m  map[string]*entry
}

func (l *Limited) Allow(key string) bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    e, ok := l.m[key]
    if !ok {
        e = &entry{lim: rate.NewLimiter(rate.Every(100*time.Millisecond), 5)}
        l.m[key] = e
    }
    e.seenAt = time.Now()
    return e.lim.Allow()
}

func (l *Limited) sweep(now time.Time, ttl time.Duration) {
    l.mu.Lock()
    defer l.mu.Unlock()
    for k, e := range l.m {
        if now.Sub(e.seenAt) > ttl {
            delete(l.m, k)
        }
    }
}
```

Run `sweep` from a background goroutine every minute. Drop keys idle for longer than 10 minutes (or whatever your retention policy is).

---

## Bug 14 — Debouncer's `Stop` does not stop the in-flight fire

```go
type Debouncer struct {
    d   time.Duration
    fn  func()
    mu  sync.Mutex
    t   *time.Timer
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, db.fn)
}

func (db *Debouncer) Stop() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
        db.t = nil
    }
}
```

**Bug.** `time.Timer.Stop()` returns `false` if the timer's callback has already started. If `Stop` is called *after* the timer fired but *before* `fn` finished, `db.t.Stop()` returns `false` and the in-flight call to `fn` continues. The caller of `Stop` may have set up shutdown invariants that `fn` violates.

Also, `Stop` does not wait. After `Stop` returns, `fn` may still be executing. If `fn` writes to a closed channel or mutates a freed buffer, you crash *after* the supposed shutdown.

**Fix.** Track in-flight callbacks with a `sync.WaitGroup` and have `Stop` wait on it:

```go
type Debouncer struct {
    d   time.Duration
    fn  func()
    mu  sync.Mutex
    t   *time.Timer
    wg  sync.WaitGroup
    closed bool
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.closed {
        return
    }
    if db.t != nil {
        db.t.Stop()
    }
    db.wg.Add(1)
    db.t = time.AfterFunc(db.d, func() {
        defer db.wg.Done()
        db.fn()
    })
}

func (db *Debouncer) Stop() {
    db.mu.Lock()
    db.closed = true
    if db.t != nil {
        db.t.Stop()
    }
    db.mu.Unlock()
    db.wg.Wait()
}
```

There is a subtle counting issue: `Trigger` adds 1, but `Stop` on a non-fired timer does not decrement (the callback never runs). To make this airtight, `wg.Add(1)` must move *inside* the `AfterFunc` callback, with a guard for the closed state. The cleanest approach uses `sync.Once`-guarded "run-or-skip" inside the callback. Production code typically pulls this into a `goleak`-tested helper rather than reinventing it.

---

## Bug 15 — Goroutine spawning per debounce call

```go
type Debouncer struct {
    d   time.Duration
    fn  func()
}

func (db *Debouncer) Trigger() {
    go func() {
        time.Sleep(db.d)
        db.fn()
    }()
}
```

**Bug.** Every `Trigger` spawns a goroutine that sleeps for `d` and then unconditionally calls `fn`. There is no debounce at all — `fn` is called once per `Trigger`, just delayed by `d`. Calling `Trigger` 1000 times spawns 1000 goroutines and produces 1000 calls to `fn` spaced over the next `d`.

If `d = 1 hour` and `Trigger` is called 100 times per second, the runtime accumulates 360 000 sleeping goroutines.

**Fix.** A real debouncer is a *single* timer, replaced on every `Trigger`. See Bug 1's fix. The naive `go func() { sleep; fn() }()` pattern is one of the most common anti-patterns in JavaScript-to-Go translations, because in JavaScript `setTimeout` returns a handle you can `clearTimeout`; engineers reach for `time.Sleep` and forget about the handle.

---

## Bug 16 — `time.Tick` instead of `time.NewTicker`

```go
func RunMetrics(ctx context.Context) {
    for range time.Tick(10 * time.Second) {
        if ctx.Err() != nil {
            return
        }
        publishMetrics()
    }
}
```

**Bug.** `time.Tick` returns a channel but no handle. There is no way to stop it. When `RunMetrics` returns on context cancel, the underlying ticker continues to fire forever, leaking its goroutine and timer.

The `time` package docs are explicit:

> The ticker will leak if the program ever loses the only reference to the returned Ticker. Use NewTicker instead.

But `time.Tick` returns `<-chan time.Time`, not `*Ticker`, so the warning is easy to miss.

**Fix.** Use `time.NewTicker` + `defer Stop`:

```go
func RunMetrics(ctx context.Context) {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            publishMetrics()
        }
    }
}
```

The `select` integrates cancellation cleanly, and `defer t.Stop()` releases the ticker.

---

## Bug 17 — Time reservation that is not cancelled on early return

```go
func sendWithLimit(ctx context.Context, lim *rate.Limiter, msg Msg) error {
    r := lim.Reserve()
    if !r.OK() {
        return errors.New("limit exhausted")
    }
    delay := r.Delay()
    select {
    case <-time.After(delay):
    case <-ctx.Done():
        return ctx.Err() // BUG
    }
    return send(msg)
}
```

**Bug.** When `ctx.Done()` fires, the reservation `r` is *not* cancelled. The reserved tokens stay consumed for the duration they were reserved. Future callers see a more aggressive limit than configured because cancelled reservations are not returned to the bucket.

`rate.Reservation` has a `Cancel()` method specifically for this case. The docs are explicit:

> Cancel indicates that the reservation holder will not perform the reserved action and reverses the effects of this Reservation on the rate limit as much as possible, considering that other reservations may have already been made.

**Fix.**

```go
select {
case <-time.After(delay):
case <-ctx.Done():
    r.Cancel()
    return ctx.Err()
}
```

Same applies if `send(msg)` itself fails: if the work was not performed, return the token. This is the only correct way to compose multiple `rate.Limiter`s (the hierarchical-limiter pattern from `tasks.md` Task 15).

---

## Bug 18 — Two debouncers on the same field

```go
type Service struct {
    saveDeb *Debouncer
    syncDeb *Debouncer
}

func (s *Service) onEdit() {
    s.saveDeb.Trigger() // fires save() after 1s of silence
    s.syncDeb.Trigger() // fires sync() after 5s of silence
}
```

Where `save` calls `sync`:

```go
func save() {
    persist()
    sync() // sync is also debounced
}
```

**Bug.** When `save` runs, it calls `sync` directly. But `sync` is *also* being debounced. The direct call to `sync` from `save` does not go through `syncDeb`, so it runs even if the user is mid-burst. The result: `sync` may run twice — once from `save`, once from `syncDeb` 4 seconds later.

This is not strictly the debouncer's fault — it is a layering bug. But it shows up in code review as "why do my sync operations sometimes run twice?"

**Fix.** Decide what `save` should do about syncing:

- If `save` must always sync, remove the `syncDeb` (or have `save` reset it):

```go
func save() {
    persist()
    sync()
    s.syncDeb.Reset() // suppress the pending fire
}
```

- If the user wants sync to be debounced *across save and edit events*, route `save` through `syncDeb`:

```go
func save() {
    persist()
    s.syncDeb.Trigger() // route through the debouncer
}
```

Document which one is intended. Debouncer pairings are subtle enough that the rule must be written down.

---

## Bug 19 — Sliding-window drift across NTP correction

```go
type Sliding struct {
    n   int
    w   time.Duration
    mu  sync.Mutex
    ts  []time.Time
}

func (s *Sliding) Allow() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-s.w)
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

**Bug.** Works fine *if* `time.Now()` always increases. It does, monotonically — but the timestamps stored in `ts` are `time.Time` values that include both wall and monotonic clocks. If those values are serialised and deserialised (e.g., persisted to disk for restart resilience), the monotonic reading is stripped. After restart, `now.Sub(t.ts[i])` mixes a monotonic `now` with a wall-only stored value — and the result, while it usually approximates the intended elapsed time, drifts with each NTP adjustment.

In purely in-memory use this snippet is fine. The bug appears when somebody adds a "persist state across restart" feature without realising what monotonic stripping does.

**Fix.** Store an `int64` of nanoseconds since startup, or `time.Since(start)` durations, rather than `time.Time`:

```go
type Sliding struct {
    n     int
    w     time.Duration
    start time.Time
    mu    sync.Mutex
    ts    []time.Duration // since start
}

func (s *Sliding) Allow() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    now := time.Since(s.start)
    cutoff := now - s.w
    i := 0
    for i < len(s.ts) && s.ts[i] < cutoff {
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

Now there is no wall clock anywhere in the rate-limit math. NTP, daylight-saving, manual clock changes — all irrelevant.

---

## Bug 20 — Unbounded ticker fan-out

```go
type Broadcaster struct {
    mu       sync.Mutex
    subs     []chan time.Time
}

func (b *Broadcaster) Subscribe() <-chan time.Time {
    ch := make(chan time.Time)
    b.mu.Lock()
    b.subs = append(b.subs, ch)
    b.mu.Unlock()
    return ch
}

func (b *Broadcaster) Run() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for now := range t.C {
        b.mu.Lock()
        subs := b.subs
        b.mu.Unlock()
        for _, ch := range subs {
            ch <- now // BUG
        }
    }
}
```

**Bug.** Each subscriber channel is unbuffered. If one subscriber stops reading (e.g., its goroutine exited without unsubscribing), the broadcast goroutine blocks on `ch <- now`. The broadcast stops for *every other* subscriber. One slow consumer freezes the whole broadcaster.

Also, `Subscribe` returns a channel that the caller might forget to drain. With ticks at 1 Hz, the goroutine making `b.Run` hangs on the second send.

**Fix.** Use a non-blocking send, drop ticks on the floor for slow subscribers:

```go
for _, ch := range subs {
    select {
    case ch <- now:
    default:
        // subscriber too slow; drop this tick
    }
}
```

Or give each subscriber a buffered channel and tolerate lossy delivery. Or push the per-subscriber send into its own goroutine bounded by `errgroup.SetLimit`. The general rule: never let one slow consumer hold up the rest of a fan-out.

---

## Bug 21 — `Reset` called from inside the timer's own callback

```go
type Periodic struct {
    d   time.Duration
    fn  func()
    t   *time.Timer
}

func New(d time.Duration, fn func()) *Periodic {
    p := &Periodic{d: d, fn: fn}
    p.t = time.AfterFunc(d, func() {
        p.fn()
        p.t.Reset(p.d) // BUG: re-arm from inside callback
    })
    return p
}
```

**Bug.** The intent is "fire `fn` every `d`, like a self-rescheduling `setInterval` from JavaScript." But there is no mutex protecting `p.t`. If the caller wants to add a `Stop` method later, or change `d` at runtime, the `Reset` inside the callback races with the external mutation.

Also, more subtle: if `p.fn()` panics, the deferred `Reset` does not run, and the "periodic" stops silently with no error reported.

**Fix.** Add a mutex around `p.t`, and add `defer recover()` to keep the loop alive:

```go
type Periodic struct {
    d  time.Duration
    fn func()
    mu sync.Mutex
    t  *time.Timer
    stopped bool
}

func New(d time.Duration, fn func()) *Periodic {
    p := &Periodic{d: d, fn: fn}
    p.arm()
    return p
}

func (p *Periodic) arm() {
    p.mu.Lock()
    if p.stopped {
        p.mu.Unlock()
        return
    }
    p.t = time.AfterFunc(p.d, func() {
        defer p.arm() // re-arm after callback, even on panic
        defer func() {
            if r := recover(); r != nil {
                log.Printf("periodic panic: %v", r)
            }
        }()
        p.fn()
    })
    p.mu.Unlock()
}

func (p *Periodic) Stop() {
    p.mu.Lock()
    p.stopped = true
    if p.t != nil {
        p.t.Stop()
    }
    p.mu.Unlock()
}
```

The `defer p.arm()` re-arms even if `fn` panics, so a single bad callback does not silently kill the loop.

---

## Bug 22 — Throttle whose rate change does not take effect

```go
type Throttle struct {
    mu       sync.Mutex
    rate     time.Duration
    last     time.Time
    ticker   *time.Ticker
}

func New(rate time.Duration) *Throttle {
    t := &Throttle{rate: rate, ticker: time.NewTicker(rate)}
    return t
}

func (t *Throttle) SetRate(d time.Duration) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.rate = d // BUG: ticker still ticks at the old rate
}

func (t *Throttle) Wait() {
    <-t.ticker.C
}
```

**Bug.** `SetRate` updates the field but never resets the ticker. The ticker keeps firing at the original rate. The caller thinks the rate changed; the system disagrees.

`time.Ticker.Reset(d)` exists (added in Go 1.15) precisely for this. Forgetting it is a frequent stale-config bug.

**Fix.**

```go
func (t *Throttle) SetRate(d time.Duration) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.rate = d
    t.ticker.Reset(d)
}
```

If you do not have Go 1.15, stop the old ticker and create a new one — but make sure nobody is in `<-t.ticker.C` from the old one. Easier to upgrade Go.

---

## Final note

Of these 22 bugs, the top six — `Reset` on a fired timer, ticker leak on early return, monotonic stripping, unbounded per-key map, reservation not cancelled on context error, and "rate-limiter-per-request" — appear in real codebases roughly weekly. Two themes thread through almost every one of them: time-based primitives need explicit teardown (`Stop`, `Cancel`), and rate-limiter state must live longer than the call that uses it. Internalise those two rules and most of these bugs become hard to write.
