---
layout: default
title: Professional
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/professional/
---

# time.AfterFunc — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Production Mindset](#the-production-mindset)
3. [Deadlines and Timeouts](#deadlines-and-timeouts)
4. [Watchdogs](#watchdogs)
5. [Idle Connection Sweepers](#idle-connection-sweepers)
6. [Rate Limiters and Token Buckets](#rate-limiters-and-token-buckets)
7. [Circuit Breakers](#circuit-breakers)
8. [Retry with Backoff](#retry-with-backoff)
9. [Scheduled Jobs](#scheduled-jobs)
10. [Observability: Metrics for Timers](#observability-metrics-for-timers)
11. [Observability: Logging](#observability-logging)
12. [Observability: Tracing](#observability-tracing)
13. [Alerting](#alerting)
14. [Capacity Planning](#capacity-planning)
15. [Postmortem 1: The Million Pending Callbacks](#postmortem-1-the-million-pending-callbacks)
16. [Postmortem 2: The Late Refund](#postmortem-2-the-late-refund)
17. [Postmortem 3: The Watchdog That Stopped Watching](#postmortem-3-the-watchdog-that-stopped-watching)
18. [Postmortem 4: The Memory Leak from Captured Requests](#postmortem-4-the-memory-leak-from-captured-requests)
19. [Postmortem 5: Thundering Herd of Timer Fires](#postmortem-5-thundering-herd-of-timer-fires)
20. [Operational Runbooks](#operational-runbooks)
21. [Migration Stories](#migration-stories)
22. [Hardened Reference Implementations](#hardened-reference-implementations)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment](#self-assessment)
25. [Summary](#summary)
26. [Further Reading](#further-reading)
27. [Diagrams](#diagrams)

---

## Introduction

The senior file teaches what the runtime is doing. The professional file teaches what your *team* does with that knowledge in production: how you instrument the timers, what alerts you set up, how you respond when something breaks, and what you do in the postmortem to ensure it doesn't break again.

This file is organised around concrete production patterns and concrete incidents. Each pattern includes:

- The problem it solves.
- A complete, hardened implementation.
- The metrics you should export.
- The alerts you should set up.
- What to do when it breaks.

After this file you should be able to:

- Build, instrument, and operate timer-driven components in production.
- Diagnose a "callback didn't fire" or "callback fired too late" incident.
- Write a postmortem that produces actionable follow-up work.
- Coach your team on the same.

---

## The Production Mindset

A few principles, before diving in.

### Principle 1: assume something will go wrong

Production timers will:

- Fire late under load.
- Sometimes never fire (process restart, panic in callback).
- Capture more than you intended (memory bloat).
- Accumulate (leak) if not cleaned up.

Design for all of these.

### Principle 2: instrument before you suspect a problem

By the time you suspect a timer issue, you want the data already. Add a "live timer count" metric the day you create the timer.

### Principle 3: prefer simple to clever

A simple per-entry timer is easier to reason about than a custom timing wheel. Reach for cleverness only when profile data tells you to.

### Principle 4: bound everything

- Cap the duration (no "1 year deadline" timers).
- Cap the count (no unbounded growth of timers).
- Cap the rate (throttle timer creation per second).

### Principle 5: panic recovery is non-negotiable

Every callback in a production binary should `defer recover()`. A single unrecovered panic crashes the process.

### Principle 6: test with mocked time

Real-time tests are flaky on CI. Inject a clock interface.

### Principle 7: postmortem actionable

Every incident generates a postmortem; every postmortem generates at least one actionable follow-up. "Be more careful next time" is not actionable.

---

## Deadlines and Timeouts

### What

The most common production use of timers: bound the time something can take.

### Example: HTTP request deadline

```go
type Server struct {
    timeout time.Duration
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), s.timeout)
    defer cancel()

    result := make(chan response, 1)
    go func() {
        defer func() {
            if rec := recover(); rec != nil {
                result <- response{err: fmt.Errorf("panic: %v", rec)}
            }
        }()
        result <- doWork(ctx, r)
    }()

    select {
    case resp := <-result:
        s.metrics.WorkDuration.Observe(time.Since(time.Now()).Seconds())
        s.writeResp(w, resp)
    case <-ctx.Done():
        s.metrics.Timeouts.Inc()
        s.writeTimeout(w)
    }
}
```

Key points:

- The timeout is a `context.WithTimeout`. Under the hood it uses `time.AfterFunc`.
- The work goroutine recovers panics.
- A buffered channel (size 1) avoids leaking the goroutine.
- Both branches of the select have metric counters.

### Example: downstream RPC deadline

```go
func (c *Client) Call(ctx context.Context, req Request) (Response, error) {
    ctx, cancel := context.WithTimeout(ctx, c.timeout)
    defer cancel()

    return c.transport.Do(ctx, req)
}
```

The cleanest pattern. Push deadlines into contexts; let lower layers respect them.

### Anti-pattern: hardcoded long deadline

```go
// BAD
ctx, _ := context.WithTimeout(ctx, 24*time.Hour)
```

Either:

1. You don't really need a deadline (then don't add one).
2. You need a much shorter deadline.

24-hour deadlines accumulate timers in the runtime; if they "never" fire, the closures pin memory.

### Pattern: deadline propagation

```go
deadline, ok := ctx.Deadline()
if ok {
    if time.Until(deadline) < minimumWorkDuration {
        return ErrInsufficientTime
    }
}
```

Before doing expensive work, check the remaining deadline. Fail fast if there isn't enough time.

### Pattern: shaving the deadline

When passing the context to a downstream service, give it slightly less time than you have, so you have buffer to handle the response.

```go
downstreamCtx, cancel := context.WithTimeout(ctx, time.Until(deadline) - 100*time.Millisecond)
defer cancel()
resp, err := downstream.Call(downstreamCtx, req)
```

If the downstream returns close to its deadline, you still have 100 ms to format and send the response.

### Metrics for deadlines

```go
// Counter: timeouts per endpoint.
http_request_timeout_total{endpoint="/foo"}

// Histogram: time taken when not timed out.
http_request_duration_seconds{endpoint="/foo", outcome="ok"}

// Histogram: how close to deadline we got.
http_request_deadline_remaining_seconds{endpoint="/foo", outcome="ok"}
```

### Alerts for deadlines

- "Timeout rate on /foo > 5% for 5 minutes."
- "p99 deadline remaining < 50 ms on /foo for 10 minutes" (suggests the deadline is too tight).
- "p99 deadline remaining = 0 for any endpoint" (timing out near the deadline often).

---

## Watchdogs

### What

A watchdog is a "dead man's switch" timer: it fires if the system fails to perform an expected action within a deadline. Used to detect:

- Hung worker threads.
- Stuck event loops.
- Lost connections.
- Missed heartbeats.

### Implementation

```go
type Watchdog struct {
    mu      sync.Mutex
    timer   *time.Timer
    timeout time.Duration
    onFire  func()
    fired   atomic.Bool
    closed  atomic.Bool
}

func NewWatchdog(timeout time.Duration, onFire func()) *Watchdog {
    w := &Watchdog{timeout: timeout, onFire: onFire}
    w.timer = time.AfterFunc(timeout, w.fire)
    return w
}

func (w *Watchdog) Touch() bool {
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.closed.Load() || w.fired.Load() {
        return false
    }
    return w.timer.Reset(w.timeout)
}

func (w *Watchdog) Stop() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.closed.Store(true)
    w.timer.Stop()
}

func (w *Watchdog) fire() {
    if !w.fired.CompareAndSwap(false, true) {
        return
    }
    defer func() {
        if r := recover(); r != nil {
            log.Printf("watchdog panic: %v", r)
        }
    }()
    w.onFire()
}
```

### Production deployment

A typical service has multiple watchdogs:

- "GC pauses longer than 1 second."
- "No request handled for 30 seconds."
- "Health check responder hasn't run in 10 seconds."

Each one has a `Touch` call somewhere in the path it monitors. If the path goes silent, the watchdog fires.

### What the callback does

Usually one of:

- Log a structured error event with enough context for a human to investigate.
- Increment a counter.
- Trigger a healthcheck failure (causing the orchestrator to restart the pod).
- In extreme cases, `os.Exit(1)` to force a fresh process.

### Don't restart yourself reflexively

A watchdog firing means *something is wrong*. Restarting may hide the underlying issue. Prefer logging and alerting first; restart only if the system is definitely stuck.

### Metrics

```go
watchdog_active{name="request_handling"}
watchdog_fires_total{name="request_handling"}
watchdog_touch_total{name="request_handling"}
```

### Alerts

- "watchdog_fires_total > 0 over 5 minutes" — immediate page.
- "watchdog_touch_total flat for 60 seconds" — the path being watched is silent.

---

## Idle Connection Sweepers

### What

In a service that maintains long-lived connections (TCP, HTTP/2, WebSocket, database), idle connections cost memory and file descriptors. Sweep them.

### Per-connection timer

```go
type Conn struct {
    mu      sync.Mutex
    timer   *time.Timer
    timeout time.Duration
    closed  bool
    raw     io.ReadWriteCloser
}

func New(raw io.ReadWriteCloser, idle time.Duration) *Conn {
    c := &Conn{raw: raw, timeout: idle}
    c.timer = time.AfterFunc(idle, c.idleClose)
    return c
}

func (c *Conn) Touch() {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed {
        return
    }
    c.timer.Reset(c.timeout)
}

func (c *Conn) Close() error {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed {
        return nil
    }
    c.closed = true
    c.timer.Stop()
    return c.raw.Close()
}

func (c *Conn) idleClose() {
    c.mu.Lock()
    if c.closed {
        c.mu.Unlock()
        return
    }
    c.closed = true
    c.mu.Unlock()
    _ = c.raw.Close()
}
```

This is the same as the middle-level idle conn, with explicit handling for the `Touch` after close case.

### Scaling considerations

A server with 100K open connections is 100K timers. Fine.

A server with 10M open connections is 10M timers. Not fine — switch to a sweeper.

### Sweeper pattern

```go
type Pool struct {
    mu     sync.Mutex
    conns  map[*Conn]struct{}
    ticker *time.Ticker
}

func (p *Pool) Run(timeout time.Duration) {
    p.ticker = time.NewTicker(timeout / 10)
    go func() {
        for range p.ticker.C {
            p.sweep(timeout)
        }
    }()
}

func (p *Pool) sweep(timeout time.Duration) {
    now := time.Now()
    var toClose []*Conn
    p.mu.Lock()
    for c := range p.conns {
        if now.Sub(c.lastTouched()) > timeout {
            toClose = append(toClose, c)
            delete(p.conns, c)
        }
    }
    p.mu.Unlock()
    for _, c := range toClose {
        c.Close()
    }
}
```

One ticker, O(N) per tick. The ticker fires at one-tenth the timeout granularity, so worst-case staleness is ~10% of the timeout.

### Trade-offs

- Per-conn timers: O(1) close, exact timing, O(N) memory.
- Sweeper: O(N) per tick, looser timing, O(N) memory (smaller per entry — no timer overhead).

For < 100K conns, per-conn timers are simpler. For > 1M, sweeper. In between, profile.

### Metrics

```go
conn_idle_close_total
conn_idle_sweep_duration_seconds (histogram)
conn_active{purpose="grpc"}
```

---

## Rate Limiters and Token Buckets

### What

A rate limiter throttles operations to a maximum rate. Many implementations use timers.

### Token bucket with refill timer

```go
type Bucket struct {
    mu         sync.Mutex
    tokens     int
    capacity   int
    refillRate time.Duration
}

func NewBucket(capacity int, refillRate time.Duration) *Bucket {
    b := &Bucket{capacity: capacity, tokens: capacity, refillRate: refillRate}
    b.scheduleRefill()
    return b
}

func (b *Bucket) scheduleRefill() {
    time.AfterFunc(b.refillRate, func() {
        b.mu.Lock()
        if b.tokens < b.capacity {
            b.tokens++
        }
        b.mu.Unlock()
        b.scheduleRefill()
    })
}

func (b *Bucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.tokens > 0 {
        b.tokens--
        return true
    }
    return false
}
```

This works but has a long-running self-rescheduling timer. If the bucket is never used, the timer keeps firing.

### Lazy refill pattern

```go
type LazyBucket struct {
    mu         sync.Mutex
    tokens     float64
    capacity   float64
    refillRate float64 // tokens per second
    last       time.Time
}

func (b *LazyBucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(b.last).Seconds()
    b.tokens = math.Min(b.capacity, b.tokens + elapsed*b.refillRate)
    b.last = now
    if b.tokens >= 1 {
        b.tokens--
        return true
    }
    return false
}
```

No timer at all. Tokens are computed on demand. Cleaner for most use cases.

### When to use a timer

Use a timer when:

- You need to *enforce* a refill rate (e.g., for a hardware-bound resource).
- You need an event at refill (e.g., wake up waiting goroutines).

Otherwise, prefer lazy refill.

### Triggered rate limits

A timer can fire when a rate is exceeded:

```go
type Limit struct {
    mu    sync.Mutex
    count int
    timer *time.Timer
}

func (l *Limit) IncrementAndMaybeBlock(threshold int, cooldown time.Duration) bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.count++
    if l.count >= threshold {
        if l.timer == nil {
            l.timer = time.AfterFunc(cooldown, func() {
                l.mu.Lock()
                l.count = 0
                l.timer = nil
                l.mu.Unlock()
            })
        }
        return false
    }
    return true
}
```

Counts up; after `threshold` events, blocks further events for `cooldown`.

### Distributed rate limits

In a distributed system, in-process timers are insufficient — different processes have different views. Use Redis with TTLs, or a dedicated rate-limit service.

---

## Circuit Breakers

### What

A circuit breaker prevents repeated failures from a downstream service from cascading. After enough failures, the breaker "opens" and rejects requests for a cooldown period. After cooldown, it tries "half-open" — a few requests pass through to see if the downstream has recovered.

### Implementation

```go
type Breaker struct {
    mu          sync.Mutex
    state       State // closed, open, half-open
    failures    int
    threshold   int
    resetTimer  *time.Timer
    cooldown    time.Duration
}

type State int

const (
    Closed State = iota
    Open
    HalfOpen
)

func (b *Breaker) Call(op func() error) error {
    b.mu.Lock()
    state := b.state
    b.mu.Unlock()

    switch state {
    case Open:
        return ErrOpen
    case Closed, HalfOpen:
        err := op()
        b.recordResult(err)
        return err
    }
    return nil
}

func (b *Breaker) recordResult(err error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if err == nil {
        if b.state == HalfOpen {
            b.state = Closed
        }
        b.failures = 0
        return
    }
    b.failures++
    if b.failures >= b.threshold {
        b.state = Open
        b.resetTimer = time.AfterFunc(b.cooldown, func() {
            b.mu.Lock()
            defer b.mu.Unlock()
            b.state = HalfOpen
            b.failures = 0
        })
    }
}
```

The `AfterFunc` schedules the open -> half-open transition.

### Production polish

- Add jitter to the cooldown to avoid synchronised half-open probes from many breakers.
- Count successes in half-open before declaring closed.
- Emit metrics on every state change.

### Metrics

```go
breaker_state{name="payments", state="open"}  # gauge
breaker_state_change_total{name="payments", from="closed", to="open"}
breaker_open_duration_seconds (histogram)
```

### Alerts

- "Breaker open for > 5 minutes" — downstream is sustained-broken.
- "Breaker oscillating open/closed > 5 times in 10 minutes" — flapping; consider tuning thresholds.

---

## Retry with Backoff

### What

Retry transient failures with exponentially increasing delays.

### Implementation

```go
type Retrier struct {
    mu      sync.Mutex
    timer   *time.Timer
    attempt int
    base    time.Duration
    max     time.Duration
    cap     int
    op      func(ctx context.Context) error
    onDone  func(error)
    ctx     context.Context
    cancel  context.CancelFunc
}

func NewRetrier(ctx context.Context, op func(context.Context) error, onDone func(error)) *Retrier {
    rctx, cancel := context.WithCancel(ctx)
    return &Retrier{
        base:   100 * time.Millisecond,
        max:    10 * time.Second,
        cap:    5,
        op:     op,
        onDone: onDone,
        ctx:    rctx,
        cancel: cancel,
    }
}

func (r *Retrier) Start() {
    r.run()
}

func (r *Retrier) Cancel() {
    r.cancel()
    r.mu.Lock()
    if r.timer != nil {
        r.timer.Stop()
    }
    r.mu.Unlock()
}

func (r *Retrier) run() {
    if r.ctx.Err() != nil {
        r.onDone(r.ctx.Err())
        return
    }
    err := r.op(r.ctx)
    if err == nil {
        r.onDone(nil)
        return
    }
    r.mu.Lock()
    r.attempt++
    if r.attempt > r.cap {
        r.mu.Unlock()
        r.onDone(fmt.Errorf("retries exhausted: %w", err))
        return
    }
    delay := r.base * time.Duration(1<<(r.attempt-1))
    if delay > r.max {
        delay = r.max
    }
    delay = jitter(delay)
    r.timer = time.AfterFunc(delay, r.run)
    r.mu.Unlock()
}

func jitter(d time.Duration) time.Duration {
    return d/2 + time.Duration(rand.Int63n(int64(d/2)))
}
```

Notes:

- `jitter` randomises the delay by 50% — important for avoiding thundering-herd retries from many clients.
- `r.op(r.ctx)` respects context cancellation, so a cancelled retry doesn't keep trying.
- The `Cancel` method stops both the timer and the context.

### Metrics

```go
retries_total{name="payment_charge", outcome="success"}
retries_total{name="payment_charge", outcome="exhausted"}
retry_attempts_histogram{name="payment_charge"}
```

### Anti-pattern: no cap

```go
func retry(op func() error) {
    if err := op(); err != nil {
        time.AfterFunc(time.Second, func() { retry(op) })
    }
}
```

Infinite retry. If `op` always fails (e.g., the resource is permanently gone), this consumes resources forever. Always cap.

---

## Scheduled Jobs

### What

Jobs that run at a future time, possibly cancelled before then.

### Simple scheduler

```go
type Scheduler struct {
    mu   sync.Mutex
    jobs map[string]*time.Timer
}

func New() *Scheduler {
    return &Scheduler{jobs: map[string]*time.Timer{}}
}

func (s *Scheduler) Schedule(id string, at time.Time, fn func()) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if t, ok := s.jobs[id]; ok {
        t.Stop()
    }
    delay := time.Until(at)
    if delay < 0 {
        delay = 0
    }
    s.jobs[id] = time.AfterFunc(delay, func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("scheduled job %s panicked: %v", id, r)
            }
        }()
        s.mu.Lock()
        delete(s.jobs, id)
        s.mu.Unlock()
        fn()
    })
}

func (s *Scheduler) Cancel(id string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    t, ok := s.jobs[id]
    if !ok {
        return false
    }
    delete(s.jobs, id)
    return t.Stop()
}
```

Supports cancel and re-schedule by ID. Cleans up the map entry on fire.

### Persistence

For jobs that should survive process restart, persist to a database (Postgres, Redis). On startup, reload pending jobs and re-schedule.

```go
type DurableScheduler struct {
    db Database
    *Scheduler
}

func (s *DurableScheduler) Schedule(id string, at time.Time, fn func()) {
    s.db.SaveJob(id, at)
    s.Scheduler.Schedule(id, at, func() {
        s.db.DeleteJob(id)
        fn()
    })
}

func (s *DurableScheduler) Restore() {
    jobs := s.db.LoadPendingJobs()
    for _, j := range jobs {
        s.Schedule(j.ID, j.At, j.Fn)
    }
}
```

The job's effect happens once: the timer fires, the function runs, the DB record is deleted. On crash mid-function, the DB still has the record; on restart, the job is re-scheduled and runs (potentially again — design the function to be idempotent).

### Scale considerations

For 1K scheduled jobs, in-memory plus periodic DB persist is fine.

For 100K, group by deadline buckets, persist in batches.

For 1M+, consider a dedicated job scheduler service (Sidekiq-style with persistence; or Temporal, or a custom solution).

### Cron-like schedules

For recurring schedules ("every Monday at 9 AM"), parse a cron expression, compute the next fire time, schedule with `AfterFunc`, and reschedule from the callback.

```go
type Cron struct {
    expr    string
    nextFn  func() func() // returns the next fire time computer
    fn      func()
    timer   *time.Timer
}

func (c *Cron) Start() {
    next := c.nextFn()()
    c.timer = time.AfterFunc(time.Until(next), c.fire)
}

func (c *Cron) fire() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("cron panic: %v", r)
        }
    }()
    c.fn()
    next := c.nextFn()()
    c.timer = time.AfterFunc(time.Until(next), c.fire)
}
```

Production cron libraries handle DST, leap seconds, and timezone changes — write your own only as a learning exercise.

---

## Observability: Metrics for Timers

### What to measure

For each timer-based component, export:

- **Count:** how many timers are live right now.
- **Rate:** creations per second, stops per second, fires per second.
- **Latency:** time between scheduled fire and actual fire.

### Implementation

Wrap `time.AfterFunc`:

```go
type Metrics struct {
    Live    prometheus.Gauge
    Created prometheus.Counter
    Stopped prometheus.Counter
    Fired   prometheus.Counter
    Latency prometheus.Histogram
}

func Observed(d time.Duration, f func(), m *Metrics) *time.Timer {
    m.Live.Inc()
    m.Created.Inc()
    scheduledFor := time.Now().Add(d)
    var t *time.Timer
    t = time.AfterFunc(d, func() {
        late := time.Since(scheduledFor).Seconds()
        m.Latency.Observe(late)
        m.Fired.Inc()
        m.Live.Dec()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("timer panic: %v", r)
            }
        }()
        f()
    })
    // We need to wrap Stop to update Live.
    return t // Caller must use this wrapper if they want correct Live counts.
}
```

The wrapper approach has limits — `Stop` calls on the bare `*time.Timer` won't decrement `Live`. For full bookkeeping, return a wrapper type:

```go
type ObservedTimer struct {
    t       *time.Timer
    m       *Metrics
    stopped atomic.Bool
}

func (ot *ObservedTimer) Stop() bool {
    if !ot.stopped.CompareAndSwap(false, true) {
        return false
    }
    ok := ot.t.Stop()
    if ok {
        ot.m.Stopped.Inc()
        ot.m.Live.Dec()
    }
    return ok
}
```

### Dashboards

Standard panel set:

- "Live timers over time" — should be stable in steady state.
- "Create rate vs Stop rate vs Fire rate" — should balance.
- "Timer latency histogram" — p50, p99, p999.

If "live timers" climbs without bound, you have a leak. Investigate creates vs stops.

### Labels

Label by purpose:

```go
timer_live{purpose="session_idle"}
timer_live{purpose="request_deadline"}
timer_live{purpose="cleanup"}
```

Different purposes have different baselines.

### Cardinality

Don't label by user ID, request ID, or any high-cardinality field. The label set must be bounded.

---

## Observability: Logging

### What to log

When a timer fires unexpectedly (the typical case for watchdogs and deadlines), log:

- Timestamp.
- Purpose / name of the timer.
- Scheduled duration.
- Actual duration (if measurable).
- Context (request ID, user ID, etc.).

### Format

Structured (JSON) logs are essential. Plain text is unsearchable in production.

```go
log.WithFields(logrus.Fields{
    "purpose": "request_deadline",
    "duration_ms": 5000,
    "request_id": ctx.Value("request_id"),
    "url": r.URL.Path,
}).Warn("request deadline fired")
```

### What not to log

- The full closure contents (PII).
- Stack traces of the caller (callback runs in its own goroutine — the caller's stack is gone).
- High-frequency timers' every fire (rate-limit your logging).

### Log levels

- **Debug:** every fire (for development).
- **Info:** state transitions (breaker open/closed).
- **Warn:** unexpected fires (watchdog triggered, retry exhausted).
- **Error:** panics in callbacks.

---

## Observability: Tracing

### What

Distributed tracing connects a timer's effect to the request that scheduled it.

### Example

```go
func handle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
    ctx, span := tracer.Start(ctx, "handle")
    defer span.End()

    deadline := time.Now().Add(5 * time.Second)
    span.SetAttributes(attribute.String("deadline", deadline.String()))

    ctx, cancel := context.WithDeadline(ctx, deadline)
    defer cancel()

    cleanup := context.AfterFunc(ctx, func() {
        _, cspan := tracer.Start(ctx, "cleanup")
        defer cspan.End()
        // ... cleanup work ...
    })
    defer cleanup()

    // ... main work ...
}
```

The cleanup span is linked to the request span by the shared `ctx`. In your tracing UI, you can see the cleanup nested inside the request.

### Limitations

- Each timer fire creates a new goroutine. The trace context propagates only if the callback captures and uses it.
- High-frequency timers should sample tracing to avoid overhead.

---

## Alerting

### Principles

- Alert on symptoms users observe (slow responses, failed requests), not on internal states.
- Page only for actionable issues.
- Have a runbook for every page-level alert.

### Timer-specific alerts

- **Timer leak:** `live_timers` doubled over baseline. Severity: investigate.
- **Watchdog fire:** `watchdog_fires_total` > 0. Severity: page.
- **Late fires:** p99 timer latency > expected. Severity: investigate.
- **Sudden burst:** timer fires > 10× baseline in 5 minutes. Severity: investigate.

### Alert hygiene

Review alerts quarterly:

- "Does this alert still fire?"
- "Did anyone respond when it fired?"
- "Was the response useful?"

Retire alerts that no longer matter.

---

## Capacity Planning

### Memory budget

Plan for:

- Each timer: ~150 bytes (timer struct + heap entry).
- Each closure: variable; audit for size.

A service with 100K typical live timers using 200-byte closures: ~35 MB.

At 1M live timers with the same closures: 350 MB. Noticeable.

### CPU budget

Heap operations are O(log N). At N = 1M, log N = 20. Each op ~100 ns. So 1M creates + 1M stops + 1M fires per second = 6M ops/sec × 100ns × 20 = 12 sec/sec — i.e., 1200% of one core. Infeasible.

In practice you won't have 1M ops/sec. But at 100K ops/sec, you might use 1.2% of a core for heap operations. At 1M ops/sec, you should not be using `time.AfterFunc`.

### Goroutine budget

Fire rate = goroutine spawn rate. Each spawn is ~300 ns. At 100K fires/sec: 30 ms/sec of CPU = 3% of a core. At 1M fires/sec: 30% of a core.

The bigger issue is the spike pattern. If 100K timers fire in 100 ms, the goroutine count spikes by 100K, stressing the runtime briefly.

### Mitigation

- Reduce timer count via batching.
- Add jitter to deadlines to spread fires.
- Use a worker pool to limit concurrent execution.

---

## Postmortem 1: The Million Pending Callbacks

### Title

"AfterFunc Memory Leak in Order Service"

### Incident summary

- **Date:** redacted
- **Severity:** P2 (degraded service; no customer-facing outage yet)
- **Duration:** 4 hours from detection to mitigation
- **Impact:** Order service container restarted every 30 minutes due to OOM kills; affected 3% of orders (those that hit a restart)

### Timeline

- **T0:** Deployed v1.5.0 with a new "delayed cleanup" feature.
- **T+2h:** PagerDuty fires "Order service OOM kill" alert.
- **T+5h:** On-call engineer ack'd, started investigation.
- **T+6h:** Identified that goroutine count was 5M at OOM time (normal: 1K).
- **T+7h:** Heap profile showed 5M `time.Timer` allocations.
- **T+8h:** Traced to a new `time.AfterFunc(time.Hour, ...)` in the request path. Each request created one; none were stopped.
- **T+9h:** Rolled back to v1.4.9. OOMs stopped.

### Root cause

The new "delayed cleanup" feature was meant to clean up resources 1 hour after a request finished. The implementation:

```go
func handle(r *Request) {
    // ... handle the request ...
    time.AfterFunc(time.Hour, func() {
        cleanupResource(r.ResourceID)
    })
}
```

Two problems:

1. **The closure captured `r`**, the entire request object (large; included the response body, ~50 KB on average).
2. **The timer was never stopped**, even after the resource was cleaned up by other means.

At 1000 req/s with 1-hour timers, ~3.6M timers were live at steady state. Plus the captures: ~180 GB of pinned memory.

### Why the existing tests missed it

- Integration tests used 1-minute timeouts; the 1-hour timer never fired in tests.
- Load tests didn't run for an hour.
- Memory limits in dev/staging were higher than in prod.

### Mitigation

1. **Stop the timer if cleanup happens via other means.**
2. **Capture only `r.ResourceID`, not `r`.**
3. **Lower the duration to 5 minutes** — the intent was "if no other cleanup happens, clean up eventually."

The patched code:

```go
func handle(r *Request) {
    resourceID := r.ResourceID
    timer := time.AfterFunc(5*time.Minute, func() {
        cleanupResource(resourceID)
    })
    r.OnCleanup = func() { timer.Stop() } // hook for normal cleanup
}
```

### Lessons

1. **Audit every `time.AfterFunc` for capture size and lifetime.**
2. **Add a metric: live timers per purpose.** Would have alerted us at 100K.
3. **Lower TTLs are better.** "Eventually clean up" rarely needs an hour.
4. **Test memory under sustained load** — not just functionality.

### Follow-up actions

1. Add `timer_live{purpose="X"}` metrics to all uses of `AfterFunc`.
2. Code review checklist: "What does the closure capture?"
3. Soak test: run 5% prod traffic for 24h on a canary, monitor memory.
4. Lint: warn on `time.AfterFunc` durations > 10 minutes.

---

## Postmortem 2: The Late Refund

### Title

"Payment Service Double-Refund Due to Late Timer"

### Incident summary

- **Date:** redacted
- **Severity:** P1 (financial impact)
- **Duration:** 72 minutes total; 12 incidents over the window
- **Impact:** 12 customers received double refunds totalling $4,800

### Timeline

- **T0:** Deploy v2.3.1 (new payment retry logic).
- **T+2d:** First complaint: customer received a refund and a successful order.
- **T+2d 1h:** Customer support reports 3 more cases.
- **T+2d 3h:** Engineering acknowledged.
- **T+2d 4h:** Traced to a 30-second "auto-refund if no confirmation" timer.
- **T+2d 6h:** Manually refunded inverse for affected customers ($-4,800 reversal applied).
- **T+2d 8h:** Patch deployed; behaviour confirmed fixed.

### Root cause

The payment service charged a card, then started a 30-second timer to refund if the order wasn't confirmed:

```go
func charge(order Order) error {
    if err := paymentGateway.Charge(order.Amount); err != nil {
        return err
    }
    time.AfterFunc(30*time.Second, func() {
        if !orderStore.IsConfirmed(order.ID) {
            paymentGateway.Refund(order.Amount, order.ID)
        }
    })
    return nil
}
```

Two issues:

1. **GC pause caused 31-second delay.** The timer fired late. By then, the order was confirmed. The `IsConfirmed` check returned `true`, but the previous check (visible to the callback's prior reading) had been `false`. Wait — actually, the check ran late; let me re-examine.

After investigation: the actual problem was different. The timer fired at the correct time, but `orderStore.IsConfirmed` had a 100 ms latency (cache + DB). The order was confirmed *during* this read, so the read returned a stale "not confirmed." The refund proceeded.

This is a TOCTOU bug: time-of-check (read) vs. time-of-use (refund).

2. **The refund itself wasn't idempotent.** A second refund could be issued without the gateway noticing.

### Mitigation

1. **Make the read atomic with the refund**, via the gateway's idempotency keys.
2. **Pass an `idempotency_key = "refund-" + order.ID`** to the refund call. The gateway de-duplicates.

The patched code:

```go
time.AfterFunc(30*time.Second, func() {
    paymentGateway.RefundIdempotent(order.Amount, order.ID, "refund-"+order.ID)
})

// inside RefundIdempotent: gateway checks if a refund with this key already happened;
// if so, returns success without doing anything.
```

The "is confirmed?" check became unnecessary — the gateway de-duplicates.

### Lessons

1. **Timers fire on their own goroutine; their checks of shared state can race with mutations.**
2. **Idempotency keys are the right tool** for "do at most one of these" with potentially racing callers.
3. **Don't gate critical actions on stale state.**

### Follow-up actions

1. Add idempotency keys to every payment operation.
2. Review every `time.AfterFunc` in the payment service for TOCTOU bugs.
3. Add a metric: timer fires that resulted in refunds (vs. confirmed orders).
4. Slack alert if "refund after confirmation" happens — should be zero in steady state.

---

## Postmortem 3: The Watchdog That Stopped Watching

### Title

"Health Check Watchdog Never Fired During 4-Hour Database Outage"

### Incident summary

- **Date:** redacted
- **Severity:** P2 (no immediate customer impact, but watchdog was supposed to detect this)
- **Duration:** 4 hours of database outage; the watchdog should have fired within 30 seconds
- **Impact:** No additional customer impact, but we lost confidence in our self-healing.

### Timeline

- **T0:** Database failover failed; primary DB unreachable.
- **T+30s:** Watchdog was *supposed* to fire and trigger a restart. It did not.
- **T+4h:** Manual intervention restored service.
- **T+1d:** Investigation: why didn't the watchdog fire?

### Root cause

The watchdog was implemented as:

```go
type Watchdog struct {
    timer *time.Timer
    timeout time.Duration
}

func (w *Watchdog) Touch() {
    w.timer.Reset(w.timeout)
}
```

The `Touch` was called from inside the request handler, after each successful request. When the DB went down, requests failed quickly, the handler returned an error, but `Touch` was *still* called at the end of the handler (after the error path).

Specifically, the error path was:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    defer w.watchdog.Touch() // BUG: touches regardless of success
    if err := process(r); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    // ...
}
```

The watchdog touched on every request, including the failing ones. As long as requests were being received, the watchdog was happy — even though every single request was failing.

### Mitigation

1. **Touch the watchdog only on successful processing.**
2. **Add a separate watchdog for "successful requests in the last N seconds > 0."**

The patched code:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    if err := process(r); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    w.watchdog.Touch() // only touch on success
}
```

### Lessons

1. **A watchdog measures the wrong thing if you touch it from a wrong place.**
2. **The semantic should be "successful work performed," not "request handled."**
3. **Test the watchdog by deliberately breaking the path it watches.**

### Follow-up actions

1. Add a watchdog test: stub out the DB, verify watchdog fires within `timeout`.
2. Review all watchdogs for "what does Touch actually measure?"
3. Game-day exercise: simulate downstream outage; verify alerts fire.

---

## Postmortem 4: The Memory Leak from Captured Requests

### Title

"Image Service OOM Due to Captured Request Bodies"

### Incident summary

- **Date:** redacted
- **Severity:** P2
- **Duration:** 1 week (slow growth; OOM during peak)
- **Impact:** Pod restarts during peak hours; some image upload failures.

### Timeline

- **T0:** Deploy v3.1.0 (added image-conversion delay feature).
- **T+1w:** First OOM during peak.
- **T+1w 1d:** Investigation.

### Root cause

The image service offered a "delayed conversion" feature: upload an image, conversion happens 5 minutes later. Implementation:

```go
func upload(r *Request) {
    saveImage(r.ImageData) // 5 MB average

    time.AfterFunc(5*time.Minute, func() {
        convertImage(r.ImageData)
    })
}
```

The closure captured `r.ImageData`. Each upload pinned 5 MB of memory for 5 minutes. At 1000 uploads/min for 5 min: 5,000 × 5 MB = 25 GB.

The pod had a 4 GB memory limit.

### Mitigation

1. **Save the image to a path; capture the path, not the bytes.**

```go
func upload(r *Request) {
    path := saveImage(r.ImageData) // returns "/tmp/xxx.jpg"
    r.ImageData = nil               // help GC

    time.AfterFunc(5*time.Minute, func() {
        data := readFile(path)
        convertImage(data)
        deleteFile(path)
    })
}
```

The closure captures `path` (a small string), not `r.ImageData`. The byte slice can be GC'd after `upload` returns.

### Lessons

1. **Closure capture matters for memory.**
2. **For large objects, store on disk (or external storage); capture the reference.**
3. **Set memory limits in tests; verify behaviour under realistic load.**

### Follow-up actions

1. Audit every `time.AfterFunc` for capture sizes > 1 KB.
2. Add a lint rule: warn on `*Request` captured in `AfterFunc` closure.
3. Memory soak test in CI: run 1 hour with prod-like traffic; verify steady state.

---

## Postmortem 5: Thundering Herd of Timer Fires

### Title

"Goroutine Spike Causing GC Storm Every 5 Minutes"

### Incident summary

- **Date:** redacted
- **Severity:** P2
- **Duration:** 3 hours visible; latency degraded throughout
- **Impact:** p99 latency went from 200 ms to 1.8 seconds.

### Timeline

- **T0:** Deploy v4.0.1, a new "cache refresh" feature.
- **T+5m:** First p99 spike.
- **T+10m:** Pattern visible: every 5 minutes.
- **T+30m:** Investigation begins.

### Root cause

The cache had 50K entries, each with a 5-minute TTL. The implementation:

```go
func (c *Cache) Set(k, v string) {
    c.entries[k] = v
    time.AfterFunc(5*time.Minute, func() {
        delete(c.entries, k)
    })
}
```

At startup, 50K entries were loaded in a tight loop. 5 minutes later, all 50K timers fired within ~100 ms. The runtime spawned 50K goroutines simultaneously. The goroutine count went from 1K to 51K; GC pressure went up; subsequent GC cycles took 500-800 ms.

### Mitigation

1. **Switch to a single sweeper timer instead of one timer per entry.**

```go
func (c *Cache) Sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    for k, e := range c.entries {
        if now.After(e.expiry) {
            delete(c.entries, k)
        }
    }
}

func (c *Cache) Run() {
    ticker := time.NewTicker(30 * time.Second)
    go func() {
        for range ticker.C {
            c.Sweep()
        }
    }()
}
```

One goroutine, one ticker. Sweep is O(N) but runs only once every 30 seconds.

2. **Add jitter to per-entry timers**, if per-entry timers are kept.

```go
ttl := 5*time.Minute + time.Duration(rand.Intn(60))*time.Second
time.AfterFunc(ttl, func() { delete(c.entries, k) })
```

Spreads fires across 60 seconds; no spike.

### Lessons

1. **N timers firing simultaneously creates a goroutine spike.**
2. **Per-entry timers don't scale.**
3. **Jitter is essentially free and avoids thundering herds.**

### Follow-up actions

1. Add a metric: goroutine count delta over 1-second windows.
2. Alert if delta > 5K (indicating a fire spike).
3. Refactor every cache to use a sweeper or jitter.
4. Document the per-entry-timer scalability limit in our internal docs.

---

## Operational Runbooks

### Runbook 1: "Timer Leak Suspected"

**Symptoms:**

- `live_timers` gauge climbing without bound.
- OOM kills with goroutine count > 100K.

**Investigation:**

1. Fetch goroutine profile: `/debug/pprof/goroutine`.
2. Identify which `AfterFunc` callsite is dominant.
3. Check git log for recent changes to that path.
4. Heap profile: `/debug/pprof/heap`. Look for `runtimeTimer` allocations.

**Mitigation:**

1. If a recent deploy caused it: roll back.
2. Otherwise: identify the missing `Stop` call, deploy a fix.

**Postmortem:**

- Quantify customer impact.
- Add the relevant metric and alert.
- Update lint rules if applicable.

### Runbook 2: "Callback Didn't Fire"

**Symptoms:**

- A scheduled action did not happen.
- No log entry for the expected fire.

**Investigation:**

1. Was the timer created? Check application logs.
2. Was it stopped? Check application logs.
3. Did the process restart between schedule and fire? Check pod restart logs.
4. Did the callback panic? Check error logs.

**Mitigation:**

- If the process restarted, the timer is gone; nothing to do unless durable.
- If the callback panicked: identify and fix the panic. Add `defer recover()`.
- If the timer was stopped erroneously: identify and fix the Stop call.

### Runbook 3: "Late Fires"

**Symptoms:**

- Timer latency p99 > expected (e.g., > 100 ms when fires are supposed to be sub-millisecond).

**Investigation:**

1. CPU profile: is the runtime busy? Look for high `runtime.systemstack` or `runtime.findRunnable`.
2. Goroutine count: are there many runnable goroutines?
3. GC: are stop-the-world pauses unusually long?
4. Are there many timers? `pprof` heap profile.

**Mitigation:**

- Reduce timer count (batching).
- Increase GOMAXPROCS.
- Tune GC (e.g., `GOGC=200` for less frequent GC).
- Add jitter to spread fires.

### Runbook 4: "Watchdog Fired"

**Symptoms:**

- `watchdog_fires_total{name="X"}` increased.
- Pager going off.

**Investigation:**

1. What does the watchdog measure? Re-read the runbook for that watchdog.
2. Was the watched path actually broken? Check the upstream metrics.
3. Was the watchdog Touched recently? Trace back through logs.

**Mitigation:**

- If the watched path is broken: fix it. The watchdog did its job.
- If the watchdog is false-firing: fix the watchdog (it's measuring the wrong thing).
- Restart the pod if the system is wedged.

---

## Migration Stories

### Story 1: Replacing time.After with reused Timer in a hot loop

A service had:

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        doWork()
    }
}
```

CPU profile showed 12% time in `time.After` allocations. Fixed by:

```go
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        doWork()
        t.Reset(time.Second)
    }
}
```

CPU dropped by 11.5%.

### Story 2: Replacing goroutine+Sleep with AfterFunc

A service had millions of "schedule a thing in N seconds" calls per day, each as:

```go
go func() {
    time.Sleep(d)
    doIt()
}()
```

Goroutine count averaged 50K (the sleeping ones). Replaced with `time.AfterFunc(d, doIt)`. Goroutine count dropped to 5K (the actively-running ones at any moment).

### Story 3: Replacing per-entry cache timers with a sweeper

A 200K-entry cache had per-entry `AfterFunc` timers. Memory: 800 MB just for timers. Switched to a 1-minute sweeper. Memory dropped to 80 MB.

Trade-off: entries now expire ±60 seconds late. Acceptable for the use case.

### Story 4: Replacing goroutine+ctx.Done with context.AfterFunc

A request handler had:

```go
go func() {
    <-ctx.Done()
    cleanup()
}()
```

At 5000 req/s, 5000 parked goroutines per second × ~5 seconds average context lifetime = 25K parked goroutines.

Replaced with:

```go
stop := context.AfterFunc(ctx, cleanup)
defer stop()
```

Goroutine count dropped by ~25K.

---

## Hardened Reference Implementations

### Observable AfterFunc

```go
// Package observed wraps time.AfterFunc with metrics, panic recovery, and tracing.
package observed

import (
    "context"
    "log"
    "runtime/debug"
    "sync/atomic"
    "time"
)

type Metrics interface {
    IncCreated(purpose string)
    IncFired(purpose string)
    IncStopped(purpose string)
    IncPanic(purpose string)
    ObserveLatency(purpose string, late time.Duration)
}

type Timer struct {
    inner    *time.Timer
    purpose  string
    metrics  Metrics
    schedFor time.Time
    stopped  atomic.Bool
}

func AfterFunc(purpose string, d time.Duration, f func(), m Metrics) *Timer {
    schedFor := time.Now().Add(d)
    t := &Timer{purpose: purpose, metrics: m, schedFor: schedFor}
    t.inner = time.AfterFunc(d, func() {
        late := time.Since(schedFor)
        m.ObserveLatency(purpose, late)
        m.IncFired(purpose)
        defer func() {
            if r := recover(); r != nil {
                m.IncPanic(purpose)
                log.Printf("timer panic [%s]: %v\n%s", purpose, r, debug.Stack())
            }
        }()
        f()
    })
    m.IncCreated(purpose)
    return t
}

func (t *Timer) Stop() bool {
    if !t.stopped.CompareAndSwap(false, true) {
        return false
    }
    ok := t.inner.Stop()
    if ok {
        t.metrics.IncStopped(t.purpose)
    }
    return ok
}

func (t *Timer) Reset(d time.Duration) {
    // Note: Reset's boolean is dropped here as it's rarely useful for AfterFunc.
    t.schedFor = time.Now().Add(d)
    t.inner.Reset(d)
}

// AfterFuncContext combines time.AfterFunc with context cancellation.
func AfterFuncContext(ctx context.Context, purpose string, d time.Duration, f func(), m Metrics) *Timer {
    t := AfterFunc(purpose, d, f, m)
    context.AfterFunc(ctx, func() {
        t.Stop()
    })
    return t
}
```

This is what you ship in production. Wrap `time.AfterFunc` with bookkeeping, panic recovery, and tracing.

### Bounded scheduler

```go
package scheduler

import (
    "container/heap"
    "context"
    "errors"
    "sync"
    "time"
)

// Scheduler runs jobs at their scheduled times. Bounded by maxJobs.
type Scheduler struct {
    mu       sync.Mutex
    jobs     map[string]*Job
    pending  jobHeap
    timer    *time.Timer
    maxJobs  int
    workers  chan struct{} // semaphore for concurrent job execution
}

type Job struct {
    ID       string
    Deadline time.Time
    Fn       func()
    index    int
    cancel   context.CancelFunc
}

type jobHeap []*Job

func (h jobHeap) Len() int { return len(h) }
func (h jobHeap) Less(i, j int) bool { return h[i].Deadline.Before(h[j].Deadline) }
func (h jobHeap) Swap(i, j int) {
    h[i], h[j] = h[j], h[i]
    h[i].index = i
    h[j].index = j
}
func (h *jobHeap) Push(x interface{}) {
    j := x.(*Job)
    j.index = len(*h)
    *h = append(*h, j)
}
func (h *jobHeap) Pop() interface{} {
    n := len(*h)
    j := (*h)[n-1]
    j.index = -1
    *h = (*h)[:n-1]
    return j
}

func New(maxJobs, maxConcurrent int) *Scheduler {
    return &Scheduler{
        jobs:    map[string]*Job{},
        maxJobs: maxJobs,
        workers: make(chan struct{}, maxConcurrent),
    }
}

func (s *Scheduler) Schedule(id string, at time.Time, fn func()) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if _, exists := s.jobs[id]; exists {
        return errors.New("duplicate job ID")
    }
    if len(s.jobs) >= s.maxJobs {
        return errors.New("scheduler full")
    }
    j := &Job{ID: id, Deadline: at, Fn: fn}
    s.jobs[id] = j
    heap.Push(&s.pending, j)
    s.armLocked()
    return nil
}

func (s *Scheduler) Cancel(id string) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    j, ok := s.jobs[id]
    if !ok {
        return false
    }
    delete(s.jobs, id)
    if j.index >= 0 {
        heap.Remove(&s.pending, j.index)
    }
    s.armLocked()
    return true
}

func (s *Scheduler) armLocked() {
    if s.pending.Len() == 0 {
        if s.timer != nil {
            s.timer.Stop()
            s.timer = nil
        }
        return
    }
    d := time.Until(s.pending[0].Deadline)
    if d < 0 {
        d = 0
    }
    if s.timer == nil {
        s.timer = time.AfterFunc(d, s.fire)
    } else {
        s.timer.Reset(d)
    }
}

func (s *Scheduler) fire() {
    s.mu.Lock()
    now := time.Now()
    var due []*Job
    for s.pending.Len() > 0 && !s.pending[0].Deadline.After(now) {
        j := heap.Pop(&s.pending).(*Job)
        delete(s.jobs, j.ID)
        due = append(due, j)
    }
    s.armLocked()
    s.mu.Unlock()
    for _, j := range due {
        s.runJob(j)
    }
}

func (s *Scheduler) runJob(j *Job) {
    select {
    case s.workers <- struct{}{}:
        defer func() { <-s.workers }()
        defer func() {
            if r := recover(); r != nil {
                // log and metric
            }
        }()
        j.Fn()
    default:
        // No worker available; drop or queue. For simplicity, drop.
    }
}
```

Properties:

- Bounded job count.
- Bounded concurrent execution.
- One runtime timer (not per-job).
- Panic recovery.

### Self-healing watchdog

```go
package watchdog

import (
    "log"
    "sync"
    "sync/atomic"
    "time"
)

type Watchdog struct {
    mu      sync.Mutex
    timer   *time.Timer
    timeout time.Duration
    onFire  func()
    fired   atomic.Bool
    stopped atomic.Bool
    fires   atomic.Int64
}

func New(timeout time.Duration, onFire func()) *Watchdog {
    w := &Watchdog{timeout: timeout, onFire: onFire}
    w.arm()
    return w
}

func (w *Watchdog) arm() {
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.stopped.Load() {
        return
    }
    w.timer = time.AfterFunc(w.timeout, w.fire)
}

func (w *Watchdog) fire() {
    if w.stopped.Load() {
        return
    }
    w.fires.Add(1)
    defer func() {
        if r := recover(); r != nil {
            log.Printf("watchdog panic: %v", r)
        }
    }()
    w.onFire()
    // Re-arm for further detection.
    w.arm()
}

func (w *Watchdog) Touch() bool {
    if w.stopped.Load() {
        return false
    }
    w.mu.Lock()
    defer w.mu.Unlock()
    return w.timer.Reset(w.timeout)
}

func (w *Watchdog) Stop() {
    w.stopped.Store(true)
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.timer != nil {
        w.timer.Stop()
    }
}

func (w *Watchdog) FiresCount() int64 {
    return w.fires.Load()
}
```

Unlike the simple watchdog, this one re-arms after firing so it can detect repeated stuck conditions. Useful for long-running services where you want a "trip counter" rather than a one-shot.

---

## Cheat Sheet

```go
// Production checklist for every time.AfterFunc:
// 1. defer recover() inside the callback.
// 2. Closure captures only what's needed.
// 3. Stop the timer when the work it represents completes.
// 4. Bound the duration; cap at sensible max.
// 5. Bound the count if rate is unbounded.
// 6. Metric: live_timers, created, stopped, fired, latency.
// 7. Log unexpected fires with context.
// 8. Test with mocked clock.
// 9. Run with -race in CI.
// 10. Document the timer's lifetime in a comment.

// Common production patterns:
// - Request deadline: context.WithTimeout, defer cancel.
// - Idle conn: per-conn timer with Reset on activity.
// - Watchdog: Touch on success path, fire => alert + recovery.
// - Rate limiter: lazy refill (no timer) when possible.
// - Circuit breaker: AfterFunc for open->half-open.
// - Retry: AfterFunc with jitter, capped retries.
// - Scheduled job: bounded scheduler with single shared timer.

// Production alerts:
// - watchdog_fires_total > 0
// - live_timers doubled from baseline
// - timer_latency_p99 > expected
// - goroutine_count > 10x baseline (often a timer spike)
```

---

## Self-Assessment

- [ ] I can build a deadline-driven HTTP handler with proper cleanup.
- [ ] I can build a watchdog that fires only when the watched path is truly broken.
- [ ] I can build an idle-connection sweeper for 100K+ connections.
- [ ] I can build a retry helper with capped attempts and jittered backoff.
- [ ] I can build a scheduled job system with bounded concurrency.
- [ ] I can instrument every timer with metrics for live count, fires, and latency.
- [ ] I can write a runbook for "timer leak suspected."
- [ ] I have, at least mentally, walked through three of the postmortems and would not make those mistakes.
- [ ] I know when `time.AfterFunc` is the wrong tool (use `Ticker`, `Sleep`, or `context.AfterFunc` instead).
- [ ] I would not deploy a `time.AfterFunc` without addressing capture, cancel, and metrics.

---

## Summary

Professional-level `AfterFunc` is about operations:

- Every production timer is instrumented.
- Every callback has panic recovery.
- Every timer's lifetime is bounded and intentional.
- Every component has alerts and runbooks.
- Every postmortem produces actionable follow-ups.

The fundamentals from junior and middle, and the runtime knowledge from senior, are all in service of the production realities here.

`time.AfterFunc` is a small primitive. It is used billions of times per day in Go services. The difference between "it works" and "it works at scale, under load, with on-call sleeping soundly" is the work this file describes.

---

## Further Reading

- Google SRE Book — chapters on alerting, observability, postmortems.
- "Production-Ready Microservices" by Susan Fowler.
- Charity Majors' blog posts on observability.
- The Go team's postmortems (some are public on the Go issue tracker).

---

## Diagrams

### A typical production timer's lifecycle

```
schedule  ----  metric: created++
   |
   v
heap                 metric: live++
   |
   | (cancellation path)             | (fire path)
   v                                  v
stop  -- metric: stopped++         fire -- metric: fired++
   |                                  |       latency observed
   v                                  v
live--                              callback runs
                                    (recovers panics)
                                      |
                                      v
                                    live--
```

### Alert pipeline

```
metric: live_timers exceeds baseline
    |
    v
Prometheus rule fires (after 5 min sustained)
    |
    v
Alertmanager routes to PagerDuty
    |
    v
On-call ack's, opens runbook
    |
    v
Investigation -> mitigation -> postmortem
```

### Runbook flowchart for "timer leak"

```
Symptom: live_timers climbing
    |
    v
Pull goroutine and heap profiles
    |
    v
Dominant AfterFunc callsite?
    |
    +--- Yes --> Recent deploy? --- Yes --> Rollback
    |                              |
    |                              No --> Patch the callsite
    |
    +--- No --> Custom timing structure? --- investigate
```

---

## Appendix A: A larger postmortem template

Use this template for every incident.

```
# Postmortem: <title>

## Summary
One paragraph: what happened, who was affected, how it was fixed.

## Impact
- Customers affected: N
- Duration of impact: X minutes
- Revenue / SLO impact: $X / X% of error budget

## Timeline (UTC)
- TT:MM — event 1
- TT:MM — event 2
- ...

## Root cause
What broke and why. The "5 whys."

## Mitigation
What we did to make the bleeding stop.

## Detection
How did we find out? Could it have been earlier?

## Lessons
- Lesson 1
- Lesson 2

## Action items
- AI 1 (owner, deadline)
- AI 2 (owner, deadline)
- ...

## Glossary
- Term: definition
```

Every page in this file is in service of preventing incidents that require this template.

---

## Appendix B: A starter dashboard layout

For each service that uses timers, build a dashboard with:

- **Top: SLO indicator panel.** Are we within SLO? Red/green at a glance.
- **Middle row: timer counters.** Live, Created/s, Stopped/s, Fired/s.
- **Middle row: timer latency.** Histogram of `actual - scheduled`.
- **Bottom row: GC.** Heap, GC pause time, goroutine count.

A timer issue shows up in some combination of these panels. Practiced operators can identify the pattern within a minute.

---

## Appendix C: A starter alert set

For every service:

```yaml
groups:
- name: timers
  rules:
  - alert: TimerLeakSuspected
    expr: sum(timer_live) by (service) > sum(timer_live offset 1d) by (service) * 2
    for: 30m
    severity: warning

  - alert: WatchdogFired
    expr: increase(watchdog_fires_total[5m]) > 0
    for: 0m
    severity: page

  - alert: TimerLatencyP99High
    expr: histogram_quantile(0.99, rate(timer_latency_seconds_bucket[5m])) > 0.5
    for: 10m
    severity: warning

  - alert: GoroutineSpikeFromTimers
    expr: rate(go_goroutines[1m]) > 5000
    for: 5m
    severity: warning
```

Tune thresholds to your service.

---

## Appendix D: On-call interview questions for new joiners

Test your team's understanding by asking:

1. "If a callback never fires, what could be the cause?"
2. "How would you find a timer leak?"
3. "What does `Stop()` returning `false` mean?"
4. "Can a callback run after `Stop` returned `true`?"
5. "What's the right pattern for cleanup when a context cancels?"
6. "When would you use a sweeper instead of per-entry timers?"
7. "How do you test code that uses `AfterFunc`?"
8. "What's `context.AfterFunc` and when do you use it?"
9. "What metric would tell you about a timer-related memory leak?"
10. "Walk through the steps you'd take if our timer-latency p99 alert fires."

If a joiner can answer most of these, they are ready to be on-call for timer-heavy services.

---

## Appendix E: A "production-grade" code review checklist

Use this checklist when reviewing PRs that introduce or modify `time.AfterFunc`.

- [ ] Duration is sensible (not days, not negative).
- [ ] Closure captures small data (no `*Request`, no large slices).
- [ ] Timer is `Stop`'d in cleanup path.
- [ ] Callback has `defer recover()`.
- [ ] Metrics are instrumented (created, fired, latency, live).
- [ ] Code is testable with a mocked clock.
- [ ] If high-cardinality (per-request timers): is there a count alert?
- [ ] If long-duration (>5 min): is this really the right choice?
- [ ] If self-rescheduling: is there a stop condition?
- [ ] If using `Stop`'s return: do you understand what `false` means?
- [ ] Is `context.AfterFunc` more appropriate?
- [ ] Race tested (`go test -race`)?
- [ ] Documented in a comment near the call site?

A PR that fails 3+ checks needs rework.

---

## Appendix F: An incident drill

Run this drill quarterly:

1. Pick a service.
2. Identify its top 3 timer-driven features.
3. For each:
   - Manually break the path that the timer guards.
   - Observe whether alerts fire.
   - Observe whether the runbook produces correct diagnosis.
4. Update runbooks based on findings.

This is "chaos engineering" for timers. It catches issues before customers do.

---

## Appendix G: A history of "things we used to do that we don't anymore"

The Go community's evolved view on `AfterFunc`:

- **Pre-2018:** "Just use `time.AfterFunc(d, f)`, simple."
- **2018-2020:** "Watch out for the closure capture; use `time.After` with caution in tight loops."
- **2020-2022:** "Use context.WithTimeout for deadline patterns."
- **2022-2024:** "Use context.AfterFunc for context-driven cleanup; reserve `time.AfterFunc` for duration-driven."
- **2024+:** "Use `testing/synctest` for deterministic timer tests."

The wisdom accumulates. Your service should be using the current best practices, not the 2015 versions.

---

## Appendix H: Common review comments

When you review PRs, you'll find yourself writing the same comments. Have macros:

> "This `AfterFunc` captures the entire request. Capture only `r.ID` instead."

> "Add a `defer recover()` here. We had a production incident from this exact pattern last year."

> "This is a duration-driven timer with a 24-hour duration. Are you sure? Most cases want < 5 minutes."

> "If this timer leaks, our metrics won't show it. Wrap with `observed.AfterFunc`."

> "This is a `time.After` in a tight loop. Replace with a reused `*time.Timer` to avoid allocations."

> "Consider `context.AfterFunc` here — your trigger is context cancellation, not a duration."

Make these comments easy to find and copy; consistent feedback improves review velocity.

---

## Appendix I: Notes on hosting platforms

- **Kubernetes:** Pod restarts kill all timers. Plan for it.
- **Lambda:** Functions are stateless; timers don't persist. Use the platform's scheduling (CloudWatch Events).
- **App Engine:** Similar to Lambda; timers within a request only.
- **Bare metal / VM:** Long-lived processes; timers persist.

If your service runs on a platform where the process can be killed at any moment, design timers for "fire-and-forget" with idempotency, not "guaranteed eventual execution."

---

## Appendix J: A "war story" — the timer that fired exactly when we didn't want it to

I once worked on a payments service that had a 24-hour "delayed settlement" timer for some transactions. The timer captured the transaction object. Over a few months, the closure size grew (the transaction object accumulated fields). At peak, with millions of pending transactions, memory grew faster than we'd planned. We started OOMing.

The fix took three days: refactor to capture only the transaction ID, plus a closure on a database query. Closure size dropped from ~5 KB to ~50 bytes. Memory pressure resolved.

The lesson: **monitor the size of objects that timers capture.** It's easy to forget that the closure pins memory. When the closure structure changes, the pinning changes.

We now have a lint rule that warns if a closure passed to `time.AfterFunc` captures any struct field other than primitive types and small strings.

---

## Appendix K: A second war story — the deadline that never fired

A service had a deadline timer that, in some path, was never set. The path was rarely taken, so it went unnoticed for months. Eventually, that path was taken at scale during a campaign launch. Requests piled up because there was no deadline; downstream services were overwhelmed; cascade.

Fix: a default deadline on every request, with the option to extend (not skip). The "no deadline" path was eliminated.

Lesson: **defaults matter.** A missing deadline is a bug; make it loud by enforcing a default everywhere.

---

## Appendix L: A third war story — the test that didn't fail

A test asserted "the timer fires within 100 ms." On a developer's laptop, it always passed. On CI, occasionally it failed (200 ms latency under heavy parallel tests). On production-like load, it failed consistently.

The "fix" was to relax the assertion to "within 1 second." That hid the real issue: under load, the timer was firing 500 ms late, which mattered in production.

The real fix was to:

1. Profile and find the cause (timer fires happen on the P that has the heap; busy P = late timer).
2. Increase GOMAXPROCS to spread timer work.
3. Eliminate a hot-loop in the test that was hogging a P.

Lesson: **don't relax tests; understand why they fail.** Tight bounds catch real problems.

---

## Appendix M: Production tools to know

- `pprof` — heap, CPU, goroutine profiles.
- `go tool trace` — execution trace.
- `expvar` — built-in metrics exporter.
- `prometheus_client_golang` — Prometheus metrics.
- `opentelemetry-go` — tracing.
- `github.com/uber-go/automaxprocs` — set GOMAXPROCS from container limits.
- `github.com/benbjohnson/clock` — mock clock for tests.
- `testing/synctest` (Go 1.24+) — deterministic time in tests.
- `runtime/pprof` — programmatic profile collection.
- `GODEBUG=schedtrace=1000` — scheduler trace.

Have these in your operational toolbox.

---

## Appendix N: A reading list for the production engineer

- "Site Reliability Engineering" — Google.
- "The DevOps Handbook" — Kim et al.
- "Release It!" — Michael Nygard.
- "Designing Data-Intensive Applications" — Martin Kleppmann (chapters on consistency and partial failure).
- "Distributed Systems Observability" — Cindy Sridharan.

These don't focus on timers specifically, but they teach the operational mindset that makes timer-heavy services reliable.

---

## Appendix O: A final thought

Most timer bugs in production fall into a small number of categories:

1. Captured too much in the closure (leak).
2. Forgot to stop the timer (leak).
3. Did not recover panics (process crash).
4. Did not handle the Stop-vs-fire race (correctness).
5. Used the wrong tool (`AfterFunc` for periodic, `After` in a loop).
6. No metrics (invisible failure).
7. No test for the edge case (regression).

Each of these is preventable with the patterns and instrumentation in this file. Apply them, and your timer code will be the boring kind — the kind that just works.

---

## Appendix P: Building a metric-emitting wrapper, end to end

A complete production-ready wrapper.

```go
package timermetrics

import (
    "context"
    "fmt"
    "log/slog"
    "runtime/debug"
    "sync/atomic"
    "time"
)

// Sink is what receives metric data.
type Sink interface {
    Counter(name string, tags map[string]string, delta int64)
    Gauge(name string, tags map[string]string, value int64)
    Histogram(name string, tags map[string]string, value float64)
}

// TimerOpts captures the configuration for a wrapped timer.
type TimerOpts struct {
    Purpose   string
    Sink      Sink
    Tags      map[string]string
    Logger    *slog.Logger
    OnPanic   func(err any) // optional override
}

// Timer is a wrapped time.Timer with metrics.
type Timer struct {
    opts     TimerOpts
    inner    *time.Timer
    schedAt  time.Time
    stopped  atomic.Bool
    fired    atomic.Bool
}

// AfterFunc creates a wrapped time.AfterFunc.
func AfterFunc(d time.Duration, fn func(), opts TimerOpts) *Timer {
    t := &Timer{
        opts:    opts,
        schedAt: time.Now().Add(d),
    }
    opts.Sink.Counter("timer.created", t.allTags(), 1)
    opts.Sink.Counter("timer.live", t.allTags(), 1)
    t.inner = time.AfterFunc(d, func() {
        t.fired.Store(true)
        late := time.Since(t.schedAt)
        opts.Sink.Counter("timer.fired", t.allTags(), 1)
        opts.Sink.Histogram("timer.latency_ms", t.allTags(), float64(late.Milliseconds()))
        opts.Sink.Counter("timer.live", t.allTags(), -1)

        defer func() {
            if r := recover(); r != nil {
                opts.Sink.Counter("timer.panic", t.allTags(), 1)
                if opts.OnPanic != nil {
                    opts.OnPanic(r)
                } else if opts.Logger != nil {
                    opts.Logger.Error("timer callback panic",
                        "purpose", opts.Purpose,
                        "error", fmt.Sprintf("%v", r),
                        "stack", string(debug.Stack()),
                    )
                }
            }
        }()
        fn()
    })
    return t
}

// AfterFuncContext combines time.AfterFunc with context cancellation.
func AfterFuncContext(ctx context.Context, d time.Duration, fn func(), opts TimerOpts) *Timer {
    t := AfterFunc(d, fn, opts)
    context.AfterFunc(ctx, func() {
        t.Stop()
    })
    return t
}

func (t *Timer) Stop() bool {
    if !t.stopped.CompareAndSwap(false, true) {
        return false
    }
    if t.fired.Load() {
        // Already fired before we stopped.
        return false
    }
    ok := t.inner.Stop()
    if ok {
        t.opts.Sink.Counter("timer.stopped", t.allTags(), 1)
        t.opts.Sink.Counter("timer.live", t.allTags(), -1)
    }
    return ok
}

func (t *Timer) Reset(d time.Duration) {
    t.schedAt = time.Now().Add(d)
    t.inner.Reset(d)
    t.opts.Sink.Counter("timer.reset", t.allTags(), 1)
}

func (t *Timer) allTags() map[string]string {
    tags := map[string]string{"purpose": t.opts.Purpose}
    for k, v := range t.opts.Tags {
        tags[k] = v
    }
    return tags
}
```

To use:

```go
opts := timermetrics.TimerOpts{
    Purpose: "request_deadline",
    Sink:    promSink,
    Logger:  slog.Default(),
    Tags:    map[string]string{"endpoint": "/api/v1/orders"},
}
t := timermetrics.AfterFunc(5*time.Second, onDeadline, opts)
defer t.Stop()
```

You now have full observability with one line of setup.

---

## Appendix Q: Real production code — annotated

A snippet from a real (anonymised) service:

```go
// Cleanup is called when the upload completes or the request is cancelled.
// We have at most maxOutstanding cleanups pending; older ones are dropped.
const maxOutstandingCleanups = 10000

type CleanupManager struct {
    mu       sync.Mutex
    pending  map[uuid.UUID]*time.Timer
    metrics  *Metrics
    log      *slog.Logger
}

func (m *CleanupManager) Schedule(uploadID uuid.UUID, after time.Duration, fn func()) {
    m.mu.Lock()
    defer m.mu.Unlock()

    // Drop oldest if at capacity.
    if len(m.pending) >= maxOutstandingCleanups {
        m.dropOldestLocked()
    }

    t := time.AfterFunc(after, func() {
        m.mu.Lock()
        delete(m.pending, uploadID)
        m.mu.Unlock()
        m.metrics.CleanupFires.Inc()

        defer func() {
            if r := recover(); r != nil {
                m.log.Error("cleanup panic",
                    "upload_id", uploadID,
                    "error", fmt.Sprintf("%v", r),
                )
                m.metrics.CleanupPanics.Inc()
            }
        }()

        fn()
    })
    m.pending[uploadID] = t
    m.metrics.CleanupLive.Set(float64(len(m.pending)))
}

func (m *CleanupManager) Cancel(uploadID uuid.UUID) bool {
    m.mu.Lock()
    defer m.mu.Unlock()
    t, ok := m.pending[uploadID]
    if !ok {
        return false
    }
    delete(m.pending, uploadID)
    m.metrics.CleanupLive.Set(float64(len(m.pending)))
    return t.Stop()
}

func (m *CleanupManager) dropOldestLocked() {
    // ... drops the entry with the earliest scheduled time ...
}
```

Notes:

- The cleanup count is bounded (`maxOutstandingCleanups`).
- Metrics for fires, panics, and live count.
- Panic recovery in the callback.
- The closure captures only `uploadID` (a UUID).
- Both fire and cancel paths update the map (and the metric).

This is professional-grade code: simple, bounded, observable.

---

## Appendix R: A horror story from a real incident

The setting: a high-frequency-trading-adjacent service handling millions of orders per day. A new "audit log retention" feature shipped: 7-day TTL on audit records, implemented with per-record `time.AfterFunc(7*24*time.Hour, deleteRecord)`.

Steady-state record count: ~50 million.

Goroutine count at startup: ~10K (normal).

At T+7days (when the first deletes were due): goroutine count spiked to 5 million in 30 seconds. The runtime's scheduler became unresponsive. The pod was OOM-killed within 2 minutes. On restart, the records were re-loaded with their (mostly expired) TTLs; another spike on restart.

The system was wedged in a death spiral: spike, OOM, restart, spike, OOM, ...

The fix took 6 hours:

1. Deploy a stop-gap: refuse to start any new timers; just sleep and let the existing process die or be killed.
2. Migrate the deletion logic to a batch sweeper job (run every 5 minutes; delete records with `expires_at < now`).
3. Remove the per-record `AfterFunc` calls.
4. Add the missing metrics.

The postmortem identified: no metric on live timer count, no test with 50M records, no review comment on the 7-day duration.

Action items:

- Add an upper bound on `time.AfterFunc` duration (lint rule).
- Add `timer_live` metric to every callsite (codemod).
- Soak test with 1× production scale for 7 days before any feature with a long-lived timer.

Lesson: **the cost of 50 million one-week timers compounds.** Per-entry timers don't scale to "every record in the database."

---

## Appendix S: A long-form discussion — when sweepers beat timers

A sweeper is a single periodic timer that scans for entries due. A per-entry timer fires for each entry individually. Both have costs. When is one better?

### The fundamental trade-off

| Property | Per-entry timer | Sweeper |
|---|---|---|
| Memory per entry | ~150 bytes (timer struct + closure) | small (just entry metadata) |
| CPU per fire | O(log N) heap pop + goroutine spawn | O(N) scan per tick |
| Fire latency | Sub-millisecond | Up to one tick interval |
| Spike behaviour | Spikes when many timers expire | Smooth (sweep amortises) |
| Cancellation | O(log N) (Stop) | O(1) (delete from map) |
| Implementation complexity | Low | Medium |

### When per-entry wins

- Small N (< 10K).
- Wide spread of deadlines (no spike).
- Need sub-millisecond accuracy.

### When sweeper wins

- Large N (> 100K).
- Tight clustering of deadlines (otherwise spikes).
- Sub-second accuracy is sufficient.

### Hybrid

You can combine: per-entry timers for "soon" deadlines, sweeper for "later":

```go
type Hybrid struct {
    soonTimers map[ID]*time.Timer // for deadlines < 1 minute
    later      map[ID]time.Time   // for deadlines > 1 minute
    sweepTimer *time.Ticker
}
```

Sweep runs every minute, promoting `later` entries with sub-minute deadlines into `soonTimers`. This bounds the number of pending timers at any time.

### Bucketing

Another hybrid: bucket entries by deadline truncated to a minute boundary. Each bucket has one timer; the timer fires and processes all entries in the bucket.

```go
type Bucket struct {
    deadline time.Time
    entries  []entry
    timer    *time.Timer
}
```

50M entries with 1-minute buckets and 7-day TTL: ~10K buckets, ~5K entries per bucket. Single sweep per bucket: O(5K) per minute. Very manageable.

---

## Appendix T: A timer cost calculator

For a back-of-envelope check, use:

```
memory   = N × (150 + closure_bytes)
cpu      = (R + S + F) × 100ns × log2(N)
goroutines_spike = max simultaneous fires
```

Where:

- N = peak live timer count.
- R = creation rate (per second).
- S = stop rate.
- F = fire rate.
- closure_bytes = average size of captured data.

Plug in numbers and decide whether to redesign.

Example: a session-idle service with 1M sessions, avg session 1 hour:

- N = 1,000,000
- closure ~100 bytes (just the session ID)
- R, S ≈ 280/sec (1M / 3600s)
- F = small (most sessions are explicitly closed)
- spike = small

Memory: 1M × 250 = 250 MB. Manageable.

CPU: 560 × 100 × 20 = ~1 ms/sec = 0.1% of a core. Trivial.

For this load, per-entry timers are fine. Now imagine the session has avg 1 minute:

- N might be 100,000 typical (fewer overlapping sessions)
- R ≈ 1,700/sec
- F similar
- ...

Adjust by your numbers.

---

## Appendix U: The "everything is a timer" anti-pattern

Sometimes engineers, having discovered `AfterFunc`, use it everywhere. Some abuses:

### Abuse 1: Timers as state machine ticks

```go
// State machine implemented via chained AfterFuncs
state := "idle"
var advance func()
advance = func() {
    switch state {
    case "idle":
        state = "running"
        time.AfterFunc(time.Second, advance)
    case "running":
        state = "done"
    }
}
advance()
```

Use a goroutine with `time.Sleep` or explicit state transitions in code.

### Abuse 2: Timers as a job queue

```go
for _, job := range jobs {
    time.AfterFunc(0, job)
}
```

Use a worker pool:

```go
for _, job := range jobs {
    jobChan <- job
}
```

### Abuse 3: Timers as inter-goroutine signal

```go
ready := false
go worker(func() {
    ready = true
})
time.AfterFunc(0, func() {
    for !ready {
        runtime.Gosched()
    }
    proceed()
})
```

Use a channel.

### Abuse 4: Timers as a precise periodic clock

```go
var tick func()
tick = func() {
    process()
    time.AfterFunc(time.Second, tick)
}
tick()
```

Use `time.NewTicker`. Self-rescheduling has drift.

### Rule of thumb

`time.AfterFunc` solves "do X after a duration, in a new goroutine, with cancellability." Anything else is probably the wrong tool.

---

## Appendix V: A look at what production Go services typically use

Surveying open-source projects and production services:

- **HTTP servers (net/http, gRPC):** use `time.AfterFunc` internally for connection idle timeouts, server-shutdown grace periods. Also `time.NewTimer` heavily for read/write deadlines.
- **Database drivers (pq, mysql):** `time.AfterFunc` for connection cleanup; `time.NewTimer` for query timeouts.
- **Cache libraries (groupcache, bigcache):** sweeper patterns; per-entry timers in smaller caches.
- **Rate limiters (golang.org/x/time/rate):** lazy refill (no timers).
- **Job schedulers (gocron, robfig/cron):** `time.AfterFunc` for next-fire computation; reschedule from callback.
- **Background processors (machinery, asynq):** queue-based; timers for delay-until-execute.

The pattern: production code uses `time.AfterFunc` heavily but always with bounded counts, panic recovery, and (in modern code) metrics.

---

## Appendix W: A taxonomy of production timer roles

Pin each timer in your service to one of these categories. Each has its own metric set and review criteria.

1. **Deadline:** "this operation has a fixed maximum duration." Metric: timeout rate.
2. **Watchdog:** "this path is broken if no progress in X seconds." Metric: fire rate (should be ~0).
3. **Idle timeout:** "free this resource after Y seconds of inactivity." Metric: live count.
4. **Cleanup:** "delete this thing eventually if not cleaned up sooner." Metric: live count, fire rate.
5. **Retry:** "try again after backoff." Metric: retry attempts histogram, exhaustion rate.
6. **Scheduled:** "do this at a future time." Metric: live scheduled count, fire latency.
7. **Heartbeat:** "tell someone we're alive every N seconds." Metric: send rate.
8. **Refresh:** "renew this token / lease / resource every N seconds." Metric: success rate.
9. **Debounce:** "act after the input stops changing." Metric: fire rate vs trigger rate.
10. **Rate limit:** "fire when permitted." Metric: throttle rate.

Categorise every `time.AfterFunc` in your codebase. If you can't, the code is unclear.

---

## Appendix X: A multi-step production hardening exercise

Take a simple `AfterFunc` and harden it through five iterations.

### Iteration 1 (naive)

```go
time.AfterFunc(d, cleanup)
```

Issues: no cancel, no panic recovery, no metrics.

### Iteration 2 (cancellable)

```go
t := time.AfterFunc(d, cleanup)
defer t.Stop()
```

Better. But still no panic recovery or metrics.

### Iteration 3 (panic recovery)

```go
t := time.AfterFunc(d, func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("cleanup panic: %v", r)
        }
    }()
    cleanup()
})
defer t.Stop()
```

Better. Panics no longer crash the process.

### Iteration 4 (metrics)

```go
t := timermetrics.AfterFunc(d, cleanup, timermetrics.TimerOpts{
    Purpose: "session_cleanup",
    Sink:    promSink,
})
defer t.Stop()
```

Metrics in place. Observable.

### Iteration 5 (context-aware)

```go
t := timermetrics.AfterFuncContext(ctx, d, cleanup, timermetrics.TimerOpts{
    Purpose: "session_cleanup",
    Sink:    promSink,
})
defer t.Stop()
```

If `ctx` cancels, the timer is stopped automatically. No leak on context cancellation.

This is production-grade.

---

## Appendix Y: Best practices distilled to one page

```
For every time.AfterFunc in a production service:

CORRECTNESS:
  - defer recover() in the callback.
  - Closure captures small data only (no full request objects).
  - Stop the timer on the happy path.
  - Handle Stop's return value if cancellation matters.
  - Don't read t.C (it's nil).

CANCELLATION:
  - Capture *Timer if you may need to Stop.
  - Use context.AfterFunc for context-driven cleanup.
  - Use a guard flag or generation counter for races.

PERFORMANCE:
  - Use Reset, not Stop + AfterFunc.
  - At >100K live timers, switch to sweeper or earliest-deadline.
  - Add jitter to durations to spread fires.
  - Bound timer count.

OBSERVABILITY:
  - Counter: created, fired, stopped.
  - Gauge: live.
  - Histogram: latency (actual - scheduled).
  - Log unexpected fires.

OPERATIONAL:
  - Document the timer's purpose at the call site.
  - Alert on leak (live climbing).
  - Alert on late fires (latency p99 high).
  - Runbook for "timer leak suspected."

TESTING:
  - Inject a clock.
  - Test with -race.
  - Stress test for races.

GO VERSION:
  - Go 1.21+: prefer context.AfterFunc for context cleanup.
  - Go 1.23+: no Reset drain dance for NewTimer.
  - Go 1.24+: testing/synctest.
```

Print this. Pin it to your wall.

---

## Appendix Z: A "production readiness review" sample script

When a feature using timers is being reviewed for production launch, ask:

1. "How many timers can be alive at peak?"
2. "What's the closure size? (Show me the captured variables.)"
3. "What's the metric for live timer count?"
4. "What alert fires on a leak?"
5. "What happens if the callback panics?"
6. "What's the duration? Is there a cap?"
7. "Have you tested with a mocked clock?"
8. "Have you tested under load (production-scale traffic)?"
9. "Have you tested cancellation paths?"
10. "What's the runbook for 'timer-related production issue'?"

Pass: all 10 answered satisfactorily. Anything less, send it back.

---

## Appendix AA: A production checklist for shipping a new feature

For any feature that uses `time.AfterFunc`:

- [ ] Code review complete.
- [ ] Tests pass with `-race`.
- [ ] Mocked-clock tests pass.
- [ ] Live timer metric in place.
- [ ] Alert configured.
- [ ] Runbook updated.
- [ ] Load tested at projected peak.
- [ ] Soak tested for 24+ hours.
- [ ] Memory profile reviewed.
- [ ] Rollout plan: canary first.
- [ ] Rollback plan.
- [ ] On-call notified.

Tick all 12 before launching.

---

## Appendix BB: A worked example — building a deadline-aware request handler

A complete production-grade handler:

```go
package handlers

import (
    "context"
    "encoding/json"
    "errors"
    "log/slog"
    "net/http"
    "time"
)

type Handler struct {
    timeout time.Duration
    db      DB
    log     *slog.Logger
    metrics *Metrics
    clock   Clock
}

type Clock interface {
    Now() time.Time
}

type Metrics struct {
    Requests   Counter
    Errors     Counter
    Timeouts   Counter
    DurationMS Histogram
}

func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
    start := h.clock.Now()
    h.metrics.Requests.Inc()

    ctx := r.Context()
    if h.timeout > 0 {
        var cancel context.CancelFunc
        ctx, cancel = context.WithTimeout(ctx, h.timeout)
        defer cancel()
    }

    // Schedule a cleanup if the request times out.
    cleanup := context.AfterFunc(ctx, func() {
        h.log.Info("request cleanup",
            "url", r.URL.Path,
            "deadline_exceeded", errors.Is(ctx.Err(), context.DeadlineExceeded),
        )
    })
    defer cleanup()

    resp, err := h.doWork(ctx, r)
    duration := h.clock.Now().Sub(start)
    h.metrics.DurationMS.Observe(float64(duration.Milliseconds()))

    if err != nil {
        h.metrics.Errors.Inc()
        if errors.Is(err, context.DeadlineExceeded) {
            h.metrics.Timeouts.Inc()
            http.Error(w, "timeout", http.StatusGatewayTimeout)
            return
        }
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(resp)
}

func (h *Handler) doWork(ctx context.Context, r *http.Request) (interface{}, error) {
    // Recover panics from this goroutine.
    defer func() {
        if rec := recover(); rec != nil {
            h.log.Error("doWork panic", "error", rec)
        }
    }()

    // Use the context for downstream calls.
    return h.db.Query(ctx, "SELECT ...")
}
```

Key features:

- Deadline enforced via `context.WithTimeout`.
- Cleanup registered via `context.AfterFunc`.
- Metrics: requests, errors, timeouts, duration.
- Recovers panics in inner work.
- Distinguishes timeout from generic error in metrics.

A real handler would also:

- Validate inputs.
- Authenticate.
- Apply rate limits.
- Emit tracing spans.

Each adds a small amount of code; none changes the timer-related core.

---

## Appendix CC: Production scenario — "the alert that wasn't"

A service had a `watchdog_fires_total` alert. The metric was registered but never observed during incidents. After a near-miss, we audited.

Finding: the watchdog's `Touch` was called *more* often than expected (every successful request). Over the typical request rate, `Reset` was called thousands of times per second, far exceeding the watchdog's timeout. The watchdog could never fire because the timeout was constantly being reset.

This was actually the correct behaviour from the watchdog. The bug was elsewhere: in our incident detection logic. We expected the watchdog to fire during a downstream outage; but during the outage, requests were still arriving and being attempted, even if they all failed. The `Touch` ran on attempt, not on success.

Fix: distinguish "attempted" from "succeeded." Touch only on success.

We deployed the fix and ran a chaos game-day: cut off the downstream; verified the watchdog fired within 30 seconds.

Lesson: **make watchdogs measure the *right* thing.**

---

## Appendix DD: Production scenario — "the duration that grew"

A timer's duration was originally 1 minute. Over time, engineers extended it to 5, then 30, then 60 minutes, as the system grew and longer waits seemed necessary. Each change was small; no one stepped back to ask "is an hour reasonable?"

Eventually the cumulative effect was: per-request 1-hour timers at high RPS = enormous memory pressure. The service started OOMing.

Audit found: the 1-hour duration was unnecessary; 5 minutes was sufficient. The original choice was right; subsequent extensions were not justified.

Lesson: **review duration choices periodically.** A lint rule helps: warn on durations > 10 minutes, requiring explicit justification in a comment.

---

## Appendix EE: Production scenario — "the timer that survived a deploy"

A service had a `time.AfterFunc(24*time.Hour, sendEmail)` timer. Engineers thought: "deploys happen frequently; if the process restarts, the timer is gone." So they added persistence: save the timer's intent to a database; on startup, restore.

What they missed: restart was infrequent enough that the timer often fired *before* a restart. But then the timer's `sendEmail` ran on every restart that happened within 24 hours of scheduling (because the DB record was still there).

So users got multiple emails for the same event.

Fix: when `sendEmail` runs, delete the DB record. On startup, only restore records that haven't fired.

Lesson: **persistence layers and in-memory timers must be coordinated.** The state must be consistent.

---

## Appendix FF: Production scenario — "the timer that fired twice"

A `Reset` on an expired timer (the callback already fired) schedules a *new* fire. Engineers used this as a feature: "if the user hasn't acted in 5 minutes, ping them; if they still haven't acted in another 5 minutes, ping again."

```go
var pings int
t := time.AfterFunc(5*time.Minute, func() {
    pings++
    if pings < 3 {
        t.Reset(5 * time.Minute)
    }
    sendPing(userID)
})
```

But under high load, the callback occasionally ran twice for one `Reset` (the runtime had spawned a goroutine, then `Reset` was called, scheduling a new fire). The user got two pings in quick succession.

The fix: a guard inside the callback.

```go
var pings int
var mu sync.Mutex
var t *time.Timer
fn := func() {
    mu.Lock()
    cur := pings
    pings++
    mu.Unlock()
    if cur >= 3 {
        return
    }
    sendPing(userID)
    mu.Lock()
    t.Reset(5 * time.Minute)
    mu.Unlock()
}
t = time.AfterFunc(5*time.Minute, fn)
```

The mutex serialises the increment and the reset.

Lesson: **the runtime can spawn callback goroutines concurrently; design for that.**

---

## Appendix GG: A meta-postmortem — what we learned across all these incidents

After ~12 postmortems involving timers over several years, we extracted these meta-lessons:

1. **The most common cause is capture size.** Closures pin memory. We now have a lint rule.
2. **The second most common is missing Stop.** Timers that should be cancelled aren't. We now have a code review checklist.
3. **The third is no metrics.** Issues take hours to diagnose without visibility. We now auto-wrap every `AfterFunc` with metrics.
4. **The fourth is missing panic recovery.** A single panic crashes the process. We now have a lint rule.
5. **The fifth is per-entry timers at scale.** Goroutine spike on fire. We now have a "switch to sweeper at N > 100K" rule of thumb.

Each lesson has a follow-up: a lint rule, a checklist item, a default in the wrapper, a runbook section. The lessons compound; new engineers absorb them by reading the wrapper code and the runbooks.

---

## Appendix HH: A production-grade load test

A timer-heavy feature should be load tested before launch. Here's a template:

```go
package main

import (
    "context"
    "log"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

// LoadTest runs a load test against a timer-heavy function.
type LoadTest struct {
    RPS        int
    Duration   time.Duration
    Fn         func()
}

func (lt *LoadTest) Run(ctx context.Context) Results {
    var wg sync.WaitGroup
    var calls atomic.Int64
    var liveCalls atomic.Int64
    var goroutineMax atomic.Int64
    var memMax atomic.Uint64

    ctx, cancel := context.WithTimeout(ctx, lt.Duration)
    defer cancel()

    // Goroutine count and memory sampler.
    go func() {
        var stats runtime.MemStats
        for {
            select {
            case <-ctx.Done():
                return
            case <-time.After(100 * time.Millisecond):
                if n := int64(runtime.NumGoroutine()); n > goroutineMax.Load() {
                    goroutineMax.Store(n)
                }
                runtime.ReadMemStats(&stats)
                if stats.Alloc > memMax.Load() {
                    memMax.Store(stats.Alloc)
                }
            }
        }
    }()

    ticker := time.NewTicker(time.Second / time.Duration(lt.RPS))
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            wg.Wait()
            return Results{
                Calls:        calls.Load(),
                GoroutineMax: goroutineMax.Load(),
                MemMaxBytes:  memMax.Load(),
            }
        case <-ticker.C:
            wg.Add(1)
            liveCalls.Add(1)
            go func() {
                defer wg.Done()
                defer liveCalls.Add(-1)
                calls.Add(1)
                lt.Fn()
            }()
        }
    }
}

type Results struct {
    Calls        int64
    GoroutineMax int64
    MemMaxBytes  uint64
}

func main() {
    lt := &LoadTest{
        RPS:      1000,
        Duration: 10 * time.Minute,
        Fn: func() {
            // The function we're testing — uses time.AfterFunc internally.
            time.AfterFunc(time.Minute, func() {
                // Simulate cleanup.
            })
        },
    }
    results := lt.Run(context.Background())
    log.Printf("calls: %d, goroutines max: %d, mem max: %d MB",
        results.Calls, results.GoroutineMax, results.MemMaxBytes/1024/1024)
}
```

Run this against your timer-using function for 10 minutes. Watch goroutine count and memory. If they grow without bound, you have a leak.

---

## Appendix II: A field guide to pprof for timers

### Common pprof queries

#### Find the top allocators of `time.Timer`

```
go tool pprof -inuse_objects http://localhost:6060/debug/pprof/heap
(pprof) top10 -cum
(pprof) list time.AfterFunc
```

The `top10 -cum` shows cumulative allocations. `list time.AfterFunc` shows the call sites.

#### Find goroutines stuck waiting on timers

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
(pprof) top10
(pprof) list time.Sleep
(pprof) list time.After
```

If many goroutines are in `time.Sleep`, consider whether they could be replaced with `AfterFunc`.

#### Trace a specific period

```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=30'
go tool trace trace.out
```

In the trace UI, look for:

- "Goroutines" tab — see when goroutines are spawned. Spikes from timer fires show as bursts.
- "Heap" tab — see memory growth.
- "Timers" — direct visualization of timer activity (Go 1.20+).

### A diagnostic protocol

When you suspect a timer issue:

1. **Snapshot.** Grab heap, goroutine, CPU profile.
2. **Diff.** Compare against a known-good snapshot.
3. **Hypothesise.** What changed? New feature? Increased load?
4. **Test.** Reproduce in dev with similar load.
5. **Fix.** Apply the lesson learned.
6. **Verify.** Re-snapshot after fix.

---

## Appendix JJ: A list of "things that look like bugs but aren't"

- **Stop returning false right after the timer is created.** Possible if the timer is `AfterFunc(0, ...)`; it might have already fired.
- **Callback running after `Stop` returned true.** Should not happen for `time.Timer.Stop`. If it does, you have a different bug.
- **Reset on an active timer returning false.** Should not happen; if it does, the timer was likely stopped in between.
- **Two callbacks running concurrently after a single AfterFunc + Reset.** Possible if Reset happens between fire and callback start. Guard with a flag.
- **t.C != nil after AfterFunc.** Should not happen; `C` is always nil for AfterFunc.

If you see any of these, double-check the runtime version and any non-standard timer libraries.

---

## Appendix KK: Long-tail issues we've seen

Beyond the postmortems above, some less-frequent issues:

### Issue: integer overflow in computed duration

```go
hours := userInput // attacker provides huge value
d := time.Duration(hours) * time.Hour
time.AfterFunc(d, fn)
```

If `hours * 3600e9` overflows `int64`, `d` is negative — timer fires immediately. Bound the input.

### Issue: timer's deadline is in the past after a long pause

If the process is paused (debugger, GC stop, system suspend) for a long time, when it resumes, all timers whose `when` has passed fire essentially simultaneously. Goroutine spike.

### Issue: clock skew between scheduling and firing

Wait — timers use monotonic clock, so this shouldn't happen. But if you compute `when` from `time.Now()` (which includes monotonic) and then store as a wall-clock time in a database, you've lost the monotonic component. After restart, the deadline is wall-clock, and DST or NTP can affect it.

Best practice: use `time.Until(deadline)` to compute the duration just before scheduling, so the timer uses monotonic from that point.

### Issue: GOMAXPROCS=1 starves timers

With `GOMAXPROCS=1`, all timers run on one P. A long-running goroutine on that P delays timer firing. Use `runtime.Gosched()` in compute loops, or increase GOMAXPROCS.

### Issue: timer in a profiling-instrumented callback

If your callback is instrumented for tracing/profiling, the instrumentation adds overhead. For short callbacks at high rate, this overhead dominates.

---

## Appendix LL: Migration playbook — from time.After to AfterFunc in legacy code

You inherit a service with `time.After` in dozens of hot loops. To migrate:

1. **Identify each call site.** `grep -rn 'time.After(' .` (be careful — also matches `time.AfterFunc`).
2. **Categorise:** is the After used for cancellation, deadline, periodic, or one-shot?
3. **Rewrite:**
   - Cancellation: replace with `<-ctx.Done()` in select.
   - Deadline: use `context.WithTimeout`.
   - Periodic: use `time.NewTicker`.
   - One-shot: use `time.NewTimer` (reusable) or `time.AfterFunc` (callback-style).
4. **Test:** unit tests with mocked clock; integration tests under load.
5. **Deploy:** one section at a time, monitoring memory and goroutines.

Expect: memory and CPU drop. p99 latency improves.

---

## Appendix MM: Migration playbook — to context.AfterFunc

For Go 1.21+ services, migrating from `go func() { <-ctx.Done(); cleanup() }()` to `context.AfterFunc(ctx, cleanup)`:

1. **Find call sites.** Look for goroutines that only do `<-ctx.Done()` then cleanup.
2. **Rewrite:**
   ```go
   stop := context.AfterFunc(ctx, cleanup)
   defer stop()
   ```
3. **Benefits:**
   - Goroutine count drops by N (where N is the number of parked-on-Done goroutines).
   - Memory drops by N × goroutine stack overhead.
4. **Caveats:**
   - If the goroutine did *more* than cleanup, only the cleanup part moves to `AfterFunc`.
   - `stop()` semantics differ from goroutine cancellation; review carefully.

---

## Appendix NN: A "good code" gallery

Examples of `time.AfterFunc` use that we consider exemplary in our codebase.

### Example 1: A clean idle-connection timer

```go
// Conn tracks idle time. If unused for the timeout, the conn is closed.
type Conn struct {
    raw     io.ReadWriteCloser
    timeout time.Duration
    timer   *time.Timer
    closed  atomic.Bool
}

func NewConn(raw io.ReadWriteCloser, timeout time.Duration) *Conn {
    c := &Conn{raw: raw, timeout: timeout}
    c.timer = time.AfterFunc(timeout, c.idleClose)
    return c
}

func (c *Conn) Touch() {
    if !c.closed.Load() {
        c.timer.Reset(c.timeout)
    }
}

func (c *Conn) Close() error {
    if !c.closed.CompareAndSwap(false, true) {
        return nil
    }
    c.timer.Stop()
    return c.raw.Close()
}

func (c *Conn) idleClose() {
    _ = c.Close()
}
```

Notes:

- Single source of truth: `c.closed`.
- Idempotent Close.
- Small closure (captures `c`, the receiver).
- No mutex needed (atomic + the idempotent Close).

### Example 2: A clean watchdog

```go
// Watchdog fires onFire if Touch isn't called for the timeout.
// Re-arms after firing for repeated detection.
type Watchdog struct {
    timeout time.Duration
    onFire  func()
    timer   *time.Timer
    stopped atomic.Bool
}

func NewWatchdog(timeout time.Duration, onFire func()) *Watchdog {
    w := &Watchdog{timeout: timeout, onFire: onFire}
    w.timer = time.AfterFunc(timeout, w.fire)
    return w
}

func (w *Watchdog) Touch() {
    if !w.stopped.Load() {
        w.timer.Reset(w.timeout)
    }
}

func (w *Watchdog) Stop() {
    w.stopped.Store(true)
    w.timer.Stop()
}

func (w *Watchdog) fire() {
    if w.stopped.Load() {
        return
    }
    defer func() {
        if r := recover(); r != nil {
            log.Printf("watchdog panic: %v", r)
        }
    }()
    w.onFire()
    w.timer.Reset(w.timeout)
}
```

Notes:

- Clean re-arm after fire.
- Stop is final (once stopped, no more fires).
- Panic recovery.

### Example 3: A clean deadline

```go
// WithDeadline runs op subject to a deadline.
// Returns either op's result or context.DeadlineExceeded.
func WithDeadline(d time.Duration, op func() error) error {
    ctx, cancel := context.WithTimeout(context.Background(), d)
    defer cancel()

    result := make(chan error, 1)
    go func() {
        defer func() {
            if r := recover(); r != nil {
                result <- fmt.Errorf("panic: %v", r)
            }
        }()
        result <- op()
    }()

    select {
    case err := <-result:
        return err
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Notes:

- Buffered channel of size 1: loser doesn't block.
- Panic recovery in the work goroutine.
- Standard timeout pattern.

---

## Appendix OO: Closing thoughts

`time.AfterFunc` is a workhorse. Used well, it makes Go services elegant. Used poorly, it produces the most popular flavours of production incident.

The investment in this professional-level material is to ensure that every timer you create in production:

- Has a clear, documented purpose.
- Is bounded in count and duration.
- Is observable via metrics.
- Is recoverable from panics.
- Is testable with mocked time.
- Is reviewed for capture size and lifetime.

These are not arbitrary rules. Each one prevents an incident we've seen.

When you onboard a new team member, point them at this file. The cost of reading is hours; the cost of not reading is days of incident response.

---

## Appendix PP: A complete observability stack — example deployment

Below is a complete example of how a production service deploys timer observability across the toolchain.

### Prometheus metrics

```go
package metrics

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    TimerLive = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "app_timer_live",
        Help: "Currently live (pending or in-flight) timers by purpose.",
    }, []string{"purpose"})

    TimerCreated = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "app_timer_created_total",
        Help: "Total timers created by purpose.",
    }, []string{"purpose"})

    TimerStopped = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "app_timer_stopped_total",
        Help: "Total timers stopped before firing.",
    }, []string{"purpose"})

    TimerFired = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "app_timer_fired_total",
        Help: "Total timer callbacks executed.",
    }, []string{"purpose"})

    TimerPanic = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "app_timer_panic_total",
        Help: "Total panics within timer callbacks.",
    }, []string{"purpose"})

    TimerLatency = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "app_timer_latency_seconds",
        Help:    "Lateness of timer fires: actual - scheduled.",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 15), // 1ms to ~32s
    }, []string{"purpose"})
)
```

### Grafana dashboard JSON (excerpt)

```json
{
  "title": "App Timers",
  "panels": [
    {
      "title": "Live Timers by Purpose",
      "targets": [{"expr": "sum by (purpose) (app_timer_live)"}],
      "type": "graph"
    },
    {
      "title": "Fire Rate",
      "targets": [{"expr": "sum by (purpose) (rate(app_timer_fired_total[5m]))"}],
      "type": "graph"
    },
    {
      "title": "Fire Latency p99",
      "targets": [
        {"expr": "histogram_quantile(0.99, sum by (purpose, le) (rate(app_timer_latency_seconds_bucket[5m])))"}
      ],
      "type": "graph"
    },
    {
      "title": "Panic Rate",
      "targets": [{"expr": "sum by (purpose) (rate(app_timer_panic_total[5m]))"}],
      "type": "graph"
    }
  ]
}
```

### Prometheus alerts

```yaml
groups:
- name: app_timers
  rules:
  - alert: TimerLeakSuspected
    expr: |
      sum by (purpose) (app_timer_live)
      / on(purpose) (sum by (purpose) (app_timer_live offset 1h))
      > 2
    for: 30m
    labels:
      severity: warning
    annotations:
      summary: "Live timers ({{ $labels.purpose }}) doubled in 1h"
      runbook: "https://runbooks/timer-leak"

  - alert: TimerPanic
    expr: increase(app_timer_panic_total[10m]) > 0
    for: 1m
    labels:
      severity: warning
    annotations:
      summary: "Timer callback panic ({{ $labels.purpose }})"

  - alert: TimerLatencyHigh
    expr: |
      histogram_quantile(0.99,
        sum by (purpose, le) (rate(app_timer_latency_seconds_bucket[5m]))
      ) > 0.5
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "Timer fires late ({{ $labels.purpose }}); p99 > 500ms"
```

### Slack notification template

```
[{{ .Status }}] {{ .CommonLabels.alertname }}: {{ .CommonAnnotations.summary }}
Runbook: {{ .CommonAnnotations.runbook }}
Dashboard: https://grafana/dashboard/timers?purpose={{ .CommonLabels.purpose }}
```

### Integration test

```go
func TestTimerObservability(t *testing.T) {
    // Reset metrics for the test.
    metrics.TimerCreated.Reset()
    metrics.TimerLive.Reset()
    metrics.TimerFired.Reset()

    timermetrics.AfterFunc(50*time.Millisecond, func() {
        // ... work ...
    }, timermetrics.TimerOpts{Purpose: "test"})

    time.Sleep(100 * time.Millisecond)

    if got := testutil.CollectAndCount(metrics.TimerCreated); got != 1 {
        t.Errorf("expected 1 created, got %d", got)
    }
    if got := testutil.CollectAndCount(metrics.TimerFired); got != 1 {
        t.Errorf("expected 1 fired, got %d", got)
    }
}
```

This stack — metrics + dashboards + alerts + tests — is what "observable timers" means in practice.

---

## Appendix QQ: Coaching new engineers on timer use

When a new engineer joins, present them with this curriculum:

### Week 1: Junior level

- Read `junior.md` of this subsection.
- Pair-program a simple debouncer.
- Code review: spot the captured-variable bug.

### Week 2: Middle level

- Read `middle.md`.
- Implement a hardened idle-connection timer.
- Write tests with a mocked clock.

### Week 3: Senior level

- Read `senior.md` and trace through `runtime/time.go`.
- Implement an earliest-deadline scheduler.
- Profile a sample workload.

### Week 4: Professional

- Read `professional.md` and skim the postmortems.
- On-call shadow: handle one timer-related alert.
- Update the runbook based on the experience.

After 4 weeks, the engineer is ready to ship `time.AfterFunc` code to production.

---

## Appendix RR: An A/B test plan for a timer change

Suppose you're switching from per-entry timers to a sweeper. How to validate?

### Hypothesis

The sweeper reduces memory pressure and goroutine churn while maintaining latency below the SLO.

### Setup

- Two service variants: A (per-entry) and B (sweeper).
- Equal traffic split.
- Same metric sets.

### Measurements

- p50, p99 memory.
- p50, p99 latency.
- p50, p99 cleanup latency (time from "should be cleaned up" to "actually cleaned up").
- Goroutine count.

### Run duration

At least 24 hours, covering peak and off-peak.

### Decision criteria

Promote B if:

- Memory at peak: B < A by 20%+.
- Latency p99: B ≤ A.
- Cleanup latency p99: B within agreed SLO (e.g., < 1 minute for a 30-second sweep interval).

### Rollout

If criteria met:

1. Deploy B to 5% of traffic.
2. Monitor for 1 hour.
3. Roll forward to 25%, 50%, 100% if metrics stay clean.
4. Decommission A.

If criteria not met:

1. Investigate why.
2. Adjust B's parameters (sweep interval, batch size).
3. Repeat A/B.

---

## Appendix SS: A list of fancy patterns we don't recommend at small scale

These are real techniques used in some high-performance systems, but they're overkill for most services. Listed for awareness.

### Hierarchical timing wheel

A multi-level wheel (seconds, minutes, hours). Allows enormous duration ranges with O(1) ops. The Linux kernel uses this. Reach for it only when standard heap fails.

### Per-thread timer queue

Some database engines have per-thread timer queues to avoid lock contention. Go's runtime already does P-local heaps, so this is built-in.

### Skip lists for timer storage

Some implementations use skip lists instead of heaps. O(log N) but better cache behaviour. Marginal improvement; not worth the complexity.

### Cron-style precomputed schedules

For deterministic schedules (every day at noon), precompute the next N fires and use a single sleep. Simpler than a wheel.

### Sub-microsecond timers via hrtimer

Linux kernel provides nanosecond-precision timers via hrtimer. Accessible from Go only via cgo / syscalls. Don't bother unless you're writing trading software.

---

## Appendix TT: A discussion of "good" vs "perfect"

This file repeatedly says: instrument, recover, bound. Some of you will read this and think: "but my service is just 200 lines and 100 RPS — do I really need all this?"

The honest answer: **no, you don't.** For a simple service, a plain `time.AfterFunc(d, f)` is fine.

The patterns here matter when:

- Your service handles 1K+ RPS sustained.
- You have on-call rotation.
- You're touching a production timer with a 5+ minute duration.
- You have many timers (10K+).
- Memory or goroutine count matters for SLOs.

For small services, apply what makes sense and ignore the rest. The framework is "production at scale"; if you're not at scale, you can pick the relevant pieces.

That said: even small services benefit from panic recovery. That one piece is universally worth it.

---

## Appendix UU: A skeleton "production-grade" service template

A starter template for a new Go service:

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "runtime"
    "syscall"
    "time"

    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    slog.SetDefault(log)

    runtime.GOMAXPROCS(0) // use container limit

    mux := http.NewServeMux()
    mux.Handle("/metrics", promhttp.Handler())
    mux.HandleFunc("/healthz", healthz)
    mux.HandleFunc("/", handle)

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           mux,
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       10 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       120 * time.Second,
    }

    ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    go func() {
        log.Info("listening", "addr", srv.Addr)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Error("server error", "err", err)
        }
    }()

    <-ctx.Done()
    log.Info("shutting down")

    // Graceful shutdown with timeout.
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Error("shutdown error", "err", err)
        os.Exit(1)
    }
}

func healthz(w http.ResponseWriter, r *http.Request) {
    _, _ = w.Write([]byte("ok"))
}

func handle(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()

    defer func() {
        if rec := recover(); rec != nil {
            slog.Error("handler panic", "err", rec)
            http.Error(w, "internal error", 500)
        }
    }()

    _ = ctx
    _, _ = w.Write([]byte("hello"))
}
```

Notes:

- Standard library only (plus Prometheus).
- Per-request timeout via `context.WithTimeout`.
- Panic recovery.
- Graceful shutdown with deadline.
- Metrics endpoint.
- Health check endpoint.

This is the minimum starting point for a production Go service. Add your business logic; the skeleton is right.

---

## Appendix VV: Closing — the production engineer's mindset

Production is unforgiving. A bug that ships on Friday afternoon hits PagerDuty on Saturday morning. The patterns in this file are not paranoia — they are the residue of those Saturday mornings.

When you write `time.AfterFunc(d, f)`, pause. Ask:

- What does `f` do?
- What does it capture?
- How long is `d`?
- How many of these can be alive?
- What happens if `f` panics?
- What if I never `Stop`?
- What metric tells me this is healthy?

If you can answer each, the code is ready. If not, don't ship it.

Production is a long game. The engineers who play it well are the ones who learn from each incident and codify the lessons. Read this file. Read your team's runbooks. Read your competitors' postmortems. Build the muscle memory.

`time.AfterFunc` is one tiny corner of Go. The principles here apply to every primitive: understand the API; understand the internals; instrument; recover; bound; document. Apply them to channels, mutexes, goroutines, HTTP servers, database clients, message queues, and everything else.

---

## Appendix WW: Quick reference — the production AfterFunc one-liner

When you need a quick-and-correct `AfterFunc` in production code:

```go
timermetrics.AfterFuncContext(ctx, 5*time.Second, doIt, timermetrics.TimerOpts{
    Purpose: "do_it",
    Sink:    metricsSink,
    Logger:  slog.Default(),
})
```

This single line gives you:

- Duration of 5 seconds.
- Cancel on context.
- Metrics for created/fired/stopped/panic/latency/live.
- Panic recovery.
- Logging on panic.

You will write this hundreds of times in a production codebase. Make a snippet. Bind it to a keyboard shortcut.

---

## Appendix XX: An exhaustive list of every metric you might want

For a complete observability picture:

```
app_timer_created_total{purpose}
app_timer_stopped_total{purpose}
app_timer_fired_total{purpose}
app_timer_panic_total{purpose}
app_timer_reset_total{purpose}
app_timer_live{purpose}          # gauge
app_timer_latency_seconds{purpose}  # histogram

app_watchdog_fires_total{name}
app_watchdog_touch_total{name}
app_watchdog_stopped_total{name}

app_deadline_exceeded_total{endpoint}
app_request_duration_seconds{endpoint, outcome}

app_circuit_breaker_state{name, state}
app_circuit_breaker_open_total{name}
app_circuit_breaker_half_open_total{name}
app_circuit_breaker_close_total{name}

app_retry_attempts{name}        # histogram
app_retry_exhausted_total{name}

app_idle_close_total{purpose}
app_idle_close_duration_seconds{purpose}  # histogram

app_scheduler_jobs_live{}
app_scheduler_jobs_late_total{}
```

A complete list. Pick the subset that matters for your service. Don't over-instrument.

---

## Appendix YY: A final five postmortems, briefly

### Postmortem 6 (brief): "Watchdog Cleared on Wrong Path"

A watchdog measured "session is alive." `Touch` was called on every incoming request to the session — including failed authentication requests. An attacker could keep the watchdog happy by spamming auth attempts. Fix: only touch on authenticated requests.

### Postmortem 7 (brief): "Retry Stacked Up"

A retry function called itself recursively via `AfterFunc`. On a particular error type, both the original call and the retry threw, and both scheduled retries. Over a long downtime, retries multiplied exponentially. Fix: use a state machine, not raw recursion.

### Postmortem 8 (brief): "Timer Closure Captured Connection"

A timer closure captured `*net.Conn`. The connection's read buffer was 8 KB. With 100K live timers, that was 800 MB pinned. Fix: capture only the connection's remote address, look up the connection in a registry when the timer fires.

### Postmortem 9 (brief): "Test Sleep Replaced With Mock — But Not Everywhere"

A test stubbed out `time.AfterFunc` but missed one indirect call. The test sometimes passed, sometimes failed, depending on the order. Took two days to diagnose. Fix: all timer calls go through a single injected interface; tests inject the mock at one place.

### Postmortem 10 (brief): "Context Cancellation Didn't Propagate"

A `time.AfterFunc` was supposed to be cancelled when the request context cancelled. The cancellation went through; but the timer was created on a *different* context than the request's. The timer fired anyway. Fix: always tie timers to the request context, not background.

---

## Appendix ZZ: A reminder to read this file every six months

Production engineering patterns drift. New Go versions add primitives. Your team learns lessons. The right defaults change.

Set a calendar reminder to re-read this file every six months. Update your team's notes. Bring back the latest practices.

Treat this file as a living document; if you read something out of date, fix it (or send a note to the author).

---

## Appendix AAA: A deep-dive into a debouncer at production scale

A debouncer that takes input events and fires only after a quiet period. We've seen the basic version. Here is a production-grade version with everything: metrics, panics, context, generation counters, and a few edge cases handled.

```go
package debouncer

import (
    "context"
    "log/slog"
    "sync"
    "sync/atomic"
    "time"
)

// Debouncer fires fn after delay of quiet — the last Trigger has been
// at least `delay` ago. New Triggers reset the quiet window. The
// generation counter prevents stale callbacks from firing if Stop+Reset
// raced.
type Debouncer struct {
    delay  time.Duration
    fn     func()
    log    *slog.Logger
    onPanic func(any)

    mu     sync.Mutex
    gen    uint64
    timer  *time.Timer
    closed atomic.Bool

    triggers atomic.Int64
    fires    atomic.Int64
}

func New(delay time.Duration, fn func()) *Debouncer {
    return &Debouncer{delay: delay, fn: fn, log: slog.Default()}
}

func (db *Debouncer) Trigger(ctx context.Context) {
    if db.closed.Load() {
        return
    }
    db.triggers.Add(1)
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.closed.Load() {
        return
    }
    db.gen++
    g := db.gen
    if db.timer != nil {
        db.timer.Stop()
    }
    db.timer = time.AfterFunc(db.delay, func() {
        db.fire(g)
    })
}

func (db *Debouncer) fire(g uint64) {
    db.mu.Lock()
    if db.closed.Load() || db.gen != g {
        db.mu.Unlock()
        return
    }
    db.mu.Unlock()

    db.fires.Add(1)

    defer func() {
        if r := recover(); r != nil {
            db.log.Error("debounce panic", "err", r)
            if db.onPanic != nil {
                db.onPanic(r)
            }
        }
    }()

    db.fn()
}

func (db *Debouncer) Close() {
    db.closed.Store(true)
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.timer != nil {
        db.timer.Stop()
    }
}

func (db *Debouncer) Stats() (triggers, fires int64) {
    return db.triggers.Load(), db.fires.Load()
}
```

### Tests

```go
func TestDebouncer(t *testing.T) {
    var ran atomic.Int64
    db := New(50*time.Millisecond, func() { ran.Add(1) })
    defer db.Close()

    for i := 0; i < 10; i++ {
        db.Trigger(context.Background())
        time.Sleep(10 * time.Millisecond)
    }

    time.Sleep(200 * time.Millisecond)
    if got := ran.Load(); got != 1 {
        t.Fatalf("expected 1 fire, got %d", got)
    }

    triggers, fires := db.Stats()
    if triggers != 10 || fires != 1 {
        t.Fatalf("expected 10/1, got %d/%d", triggers, fires)
    }
}

func TestDebouncerRace(t *testing.T) {
    var ran atomic.Int64
    db := New(10*time.Millisecond, func() { ran.Add(1) })
    defer db.Close()

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            db.Trigger(context.Background())
        }()
    }
    wg.Wait()
    time.Sleep(50 * time.Millisecond)

    if got := ran.Load(); got != 1 {
        t.Fatalf("expected 1 fire, got %d", got)
    }
}
```

Run with `-race`. The detector verifies our internal synchronisation.

### Common pitfalls in the simple version

The naive debouncer:

```go
func (db *Debouncer) Trigger() {
    db.mu.Lock()
    if db.timer != nil {
        db.timer.Stop()
    }
    db.timer = time.AfterFunc(db.delay, db.fn)
    db.mu.Unlock()
}
```

Pitfalls:

1. `Stop` may return false (callback in flight). The replacement `AfterFunc` schedules a new callback, but the in-flight one still runs. Two fires.
2. No panic recovery.
3. No close path.

The production version above handles all of these.

---

## Appendix BBB: How to recognise a failing timer in a stack trace

When the on-call gets paged with a goroutine dump, what does a timer issue look like?

### Pattern: lots of goroutines in `time.Sleep`

```
goroutine 12345 [sleep]:
time.Sleep(0xdfd6a000)
        /usr/local/go/src/runtime/time.go:194 +0x18b
main.worker(...)
        /app/worker.go:42 +0x42
```

If you see thousands of these, someone is using `go func() { time.Sleep(d); f() }()` at scale. Replace with `AfterFunc`.

### Pattern: lots of goroutines in `time.After`

```
goroutine 12345 [select]:
main.handle(...)
        /app/handler.go:50 +0x10a
```

with `time.After` somewhere in the select. If memory is climbing, look at this.

### Pattern: many goroutines started by `time.goFunc`

```
created by time.goFunc in goroutine 1
        /usr/local/go/src/time/sleep.go:215 +0x2d
```

That is the AfterFunc wrapper. If you see thousands, a burst is happening.

### Pattern: goroutine stuck in user closure

```
goroutine 12345 [chan send]:
main.handle.func1(...)
        /app/handler.go:99
created by time.goFunc in goroutine 1
        /usr/local/go/src/time/sleep.go:215 +0x2d
```

A timer callback is blocked. Investigate why the channel send isn't progressing.

### Pattern: `runtime.checkTimers` dominant in CPU profile

The runtime is spending too much time managing timers. Either reduce timer count or tune.

---

## Appendix CCC: Three more (briefer) postmortems

### Postmortem 11: "The Cancel That Wasn't"

A request handler called `defer cancel()` on a context. Inside the handler, a `context.AfterFunc(ctx, cleanup)` was registered. The cleanup correctly ran when the context cancelled.

Bug: a separate goroutine spawned by the handler was started via `go func() { ... }()`, not `go func(ctx context.Context) { ... }(ctx)`. The goroutine continued running after the handler returned. The cleanup also ran. The two raced; the cleanup ran first and freed a resource; the goroutine used the freed resource.

Fix: pass `ctx` to every spawned goroutine.

Lesson: cleanup runs on context cancel; ensure nothing else accesses the resource after cancel.

### Postmortem 12: "The Timer That Was Stopped Too Early"

A `defer t.Stop()` was placed inside a loop:

```go
for _, item := range items {
    t := time.AfterFunc(time.Second, func() { cleanup(item) })
    defer t.Stop()
    process(item)
}
```

The `defer` accumulated; all `Stop`s ran at function exit, after the loop ended. By then, all timers had fired. The cleanup ran multiple times.

Fix: don't put `defer` in a loop. Use an explicit cleanup or `t.Stop()` at end of loop iteration.

### Postmortem 13: "The Recursive Reset"

A timer callback called `Reset` on its own timer to reschedule. But the callback was slow; multiple resets queued. Two callbacks ran concurrently, mutating shared state.

Fix: serialise with a mutex around the work; or use a reentry guard:

```go
var running atomic.Bool
var t *time.Timer
fn := func() {
    if !running.CompareAndSwap(false, true) {
        return
    }
    defer running.Store(false)
    // do work
    t.Reset(d)
}
t = time.AfterFunc(d, fn)
```

---

## Appendix DDD: A library catalog

If you don't want to roll your own timer wrappers, here are libraries:

- **standard library:** `time.AfterFunc`, `context.AfterFunc`.
- **github.com/benbjohnson/clock:** mock clock interface; classic, widely used.
- **github.com/jonboulle/clockwork:** similar, alternative API.
- **github.com/uber-go/automaxprocs:** sets GOMAXPROCS from container limits.
- **github.com/cenkalti/backoff:** retry with backoff strategies.
- **github.com/sethvargo/go-retry:** another retry library.
- **github.com/uber-go/ratelimit:** rate limiter (token bucket variants).
- **golang.org/x/time/rate:** standard rate limiter.
- **github.com/sony/gobreaker:** circuit breaker.
- **testing/synctest** (Go 1.24+): synthetic time for tests.

Pick what fits. Roll your own only when the libraries don't fit.

---

## Appendix EEE: The "production engineer's hippocratic oath"

Before shipping any code with `time.AfterFunc`:

1. I will document the timer's purpose in a comment.
2. I will not capture more than the timer needs in the closure.
3. I will `Stop` the timer when its work is done.
4. I will `defer recover()` inside the callback.
5. I will instrument the timer with metrics for live count and latency.
6. I will alert on suspicious patterns.
7. I will test with a mocked clock.
8. I will review code from teammates with the same standard.
9. I will read the runbook for timer-related alerts before being on-call.
10. I will update the runbook when I learn something new.

Have your team sign this metaphorically. The discipline is what separates services that wake you at 3 AM from services that don't.

---

## Appendix FFF: A retrospective on this file

This file is long. Hopefully not too long. The intent: collect all the production wisdom about `time.AfterFunc` in one place, so an engineer ramping up doesn't have to suffer through the same incidents you did.

If parts feel obvious — good, you've learned them. If parts feel paranoid — pay attention; the paranoia comes from real incidents.

The investment in writing this is paid back the first time it prevents a midnight page.

---

## Appendix GGG: A glossary of production terms

| Term | Meaning |
|---|---|
| **SLO** | Service Level Objective — a target for reliability (e.g., 99.9% uptime). |
| **SLI** | Service Level Indicator — a measurement of a service property (latency, errors). |
| **Error budget** | How much SLI breach is acceptable in a period; SLO - actual. |
| **MTTR** | Mean Time To Recovery — how long incidents last. |
| **MTBF** | Mean Time Between Failures. |
| **Postmortem** | A written analysis of an incident. |
| **Runbook** | Documented procedure for responding to an alert. |
| **Game day** | A practiced exercise of incident response. |
| **Chaos engineering** | Deliberately breaking things to test resilience. |
| **PagerDuty** | Alerting / paging service. |
| **On-call** | The engineer responsible for incident response at a given time. |
| **Tier** | Severity classification (P0, P1, P2). |
| **Canary deploy** | Rolling out to a small fraction first. |
| **Blue-green deploy** | Switching traffic between two parallel deployments. |
| **Feature flag** | A switch to enable/disable a feature at runtime. |
| **Rollback** | Reverting to a previous version after a bad deploy. |
| **Soak test** | Running a service under load for an extended period. |
| **Smoke test** | A quick sanity check after deployment. |
| **Load test** | Testing under expected production load. |
| **Stress test** | Testing beyond expected load to find the breaking point. |
| **A/B test** | Comparing two implementations on live traffic. |
| **Observability** | The capacity to ask new questions about a running system. |
| **Telemetry** | Metrics + logs + traces. |
| **APM** | Application Performance Monitoring. |
| **RED** | Rate, Errors, Duration — three core service metrics. |
| **USE** | Utilization, Saturation, Errors — three core resource metrics. |
| **TOCTOU** | Time-of-check-to-time-of-use — a race between checking and acting. |

These terms come up constantly in production discussions. Be fluent.

---

## Appendix HHH: A list of "if you only remember one thing"

If a coworker reads only one part of this file, point them at this:

> **Every `time.AfterFunc` in production code must have: panic recovery, a bounded duration, a path to cleanup, and a metric for live count.**

If they implement those four things, they will avoid the vast majority of production timer incidents. Everything else is refinement.

---

## Appendix III: A final exam — production scenarios

Predict the right action for each scenario.

### Scenario 1

A new service launched yesterday. Today, the alert fires: "live timers doubled overnight."

Action: Pull goroutine and heap profiles. Identify the dominant `AfterFunc` callsite. Check recent diffs. Likely a missing `Stop`.

### Scenario 2

p99 latency on `/api/v1/foo` is 800 ms; the deadline is 500 ms. Timeout rate is 0.5%.

Action: Investigate downstream latency. Is the deadline too tight? Could the work be parallelised? Check if a recent dep change made the downstream slower.

### Scenario 3

The watchdog for `request_handling` fired during a perfectly normal afternoon.

Action: Check `watchdog_touch_total` rate just before the fire. If it dropped to zero, the path went silent — investigate what was running. If it stayed high, the watchdog is touching from the wrong place (the touch isn't actually proof of liveness).

### Scenario 4

Memory growth is 50 MB/hour. Crash every 18 hours.

Action: Heap profile. Look for `runtimeTimer` allocations. Check if a recent feature added long-duration timers without `Stop`.

### Scenario 5

Goroutine count is 50K and stable, but 90% are in `time.Sleep`.

Action: Audit `go func() { time.Sleep(d); ... }()` patterns. Replace with `time.AfterFunc`.

### Scenario 6

A new feature uses `context.AfterFunc(ctx, cleanup)`. After deploying, memory grew steadily.

Action: Check whether `stop()` is being called. If not, every request leaves a registration on the context, which only fires at context cancel. Add `defer stop()`.

### Scenario 7

A test occasionally fails with "expected 1 call, got 0." On retry it passes.

Action: The test relies on a real-time sleep. Race between the assertion and the timer fire. Switch to a mocked clock with explicit advance.

### Scenario 8

CPU is at 80%, dominated by `runtime.siftdownTimer`. Service has 500K live timers.

Action: At this scale, switch from per-entry timers to a sweeper or earliest-deadline scheduler.

### Scenario 9

Engineer X added a feature: "delay 24 hours, then send reminder email." Now we have OOMs.

Action: 24-hour duration × N users = many timers + closures. Refactor: persist intent in a database; run a periodic job (`time.Ticker`) that scans for due reminders.

### Scenario 10

A timer's callback throws a `panic: runtime error: invalid memory address`. Production crashes.

Action: Add `defer recover()` to the callback. Also: find the nil deref and fix it. Add panic counter metric.

### Scenario 11

Latency p99 spikes every minute at the second boundary. Coincides with a `time.NewTicker(time.Minute)` for a periodic flush.

Action: Add jitter to the flush interval. Spread the flush work over a few hundred ms instead of one instant.

### Scenario 12

Watchdog fires occasionally during normal operation; nothing's actually wrong.

Action: Either the watchdog timeout is too tight, or the watched path has natural pauses. Increase the timeout or move `Touch` to a more reliable callsite.

If you can answer each of these in a paragraph, you're production-ready.

---

## Appendix JJJ: A condensed "two-page" version

For an engineer who only has 10 minutes:

### Page 1: API

```go
t := time.AfterFunc(d, f) // schedule f in a new goroutine after d
t.Stop()                   // cancel (returns true iff prevented)
t.Reset(d)                 // reschedule

// Modern context-driven:
stop := context.AfterFunc(ctx, f)
stop()                     // unregister (returns true iff prevented)
```

### Page 1: Rules

1. Callback runs in a NEW goroutine.
2. Stop returning false does NOT mean callback finished.
3. Callback closure pins memory until callback exits.
4. Panics in callback CRASH the program. defer recover().
5. t.C is nil for AfterFunc.

### Page 2: Production

1. Instrument live count, fires, latency.
2. Bound duration (cap at 10 min unless justified).
3. Bound count (cap timers per service).
4. defer t.Stop() if cancellation matters.
5. Use context.AfterFunc for context-driven cleanup.
6. Test with mocked clock.
7. Alert on leak and on late fires.
8. Runbook for "timer leak suspected."

### Page 2: Common mistakes

- Captured large request body.
- Forgot to Stop.
- No panic recovery.
- One-timer-per-entry at scale (use sweeper).
- Polling instead of using Stop's return.
- time.After in tight loops.

If you remember just these two pages, you'll write decent timer code.

---

## Appendix KKK: A list of "blunders that cost more than $10K each"

These are real production blunders from incidents we've seen or read about:

1. **24-hour timers in a request handler:** 5000 RPS, $50K of cloud bills over 3 days before noticed.
2. **Per-record timers in a 50M-record database:** OOMs every 30 min, ~$100K in revenue impact during the incident window.
3. **Timer that called a paid API:** loop misconfiguration created millions of timers; API bills hit $40K before throttling caught it.
4. **Double-refund bug:** $4,800 in incorrect refunds; significantly more in customer-trust damage.
5. **Heart-attack pager:** alert firing every 5 minutes for a week; one engineer quit due to burnout.

Each could have been prevented with the patterns in this file.

---

## Appendix LLL: A final word

`time.AfterFunc` is *just* a function. Tiny API. Two methods on the returned type. Maybe 50 lines of standard library code total.

And yet — the cumulative attention you must pay to it, the patterns you must apply, the postmortems you must read, the metrics you must wire up: that's many pages of guidance.

That's the nature of production. The simple primitives are deceptive. The complexity lives in scale, races, lifecycle, and operations.

If you have read this whole file: thank you. You're now better prepared than most. Go forth and ship safe timer code.

If you have not — bookmark it. Come back when you need it. It will be here.

---

## Appendix MMM: A coda — the philosophy of timers

Why is so much complexity in such a simple-looking primitive?

Because time is hard.

Real time is continuous; computers are discrete. Real time is wall-clock; safe time is monotonic. Real time can pause (suspended laptops, debugger stops); program time should not. Real time is deterministic in retrospect; future time is uncertain.

The Go runtime hides as much of this complexity as possible. You write `time.AfterFunc(d, f)` and a goroutine runs `f` somewhere around `d` from now. That is a miracle of engineering.

But the miracle is leaky. Sometimes the goroutine spawns late. Sometimes it spawns simultaneously with many others, causing a burst. Sometimes the callback panics. Sometimes the callback captures more than you intended. Sometimes you forget to Stop.

The patterns in this file are not about distrust of the runtime. The runtime is correct. The patterns are about the abstractions you must add *on top* of the runtime to make production-safe code.

`time.AfterFunc` is one example. Goroutines, channels, contexts, HTTP servers, database clients — each has its own pile of operational wisdom. You learn each by reading, by practicing, and by surviving incidents.

Welcome to production engineering. The work is endless and important.

---

## Appendix NNN: An expanded production scenarios catalog

Some additional scenarios you may face. Each lists symptoms, investigation steps, and resolution.

### Scenario A: "We have 30K goroutines on average and it keeps growing slowly"

**Symptoms:** Goroutine gauge climbs by ~500 per hour. Memory grows in proportion. No OOM yet but trending.

**Investigation:**

1. Take a goroutine profile.
2. `top10` shows where they accumulate.
3. Likely culprits:
   - `time.Sleep` in handlers that don't exit.
   - `<-ctx.Done()` waits in goroutines that never get cancelled.
   - `<-time.After(d)` in goroutines that should have terminated.

**Resolution:**

- Find the leaking pattern.
- Add cancellation paths.
- Replace `<-ctx.Done()` parks with `context.AfterFunc`.

### Scenario B: "Latency jumped from 200ms to 1200ms after a deploy"

**Symptoms:** p99 latency tripled. No clear error pattern.

**Investigation:**

1. Compare CPU profile to last week.
2. Look for new hotspots in `runtime.checkTimers`, `runtime.schedule`.
3. Look at goroutine count delta.

**Resolution:**

- Often a new feature created many short-lived timers, stressing the scheduler.
- Refactor to batch or reuse.

### Scenario C: "PagerDuty woke me; we crashed at 3 AM"

**Symptoms:** Pod restarts with stack trace showing nil pointer or "send on closed channel."

**Investigation:**

1. Read the crash log.
2. Identify the panicking goroutine.
3. Trace back: who created it?

**Resolution:**

- If the panic is in a timer callback: add `defer recover()`.
- If the panic indicates a bug: fix the bug too.
- Recovery alone is not enough; logs should fire metrics; metrics should alert.

### Scenario D: "A customer reports duplicate notifications"

**Symptoms:** Customer received the same notification twice within 30 seconds.

**Investigation:**

1. Check notification service logs.
2. Are two fires recorded for the same trigger? When?
3. Likely a `Reset`-on-fire race or a missing idempotency key.

**Resolution:**

- Use idempotency keys for the notification API.
- Add guards in the timer callback to prevent double-fire.
- Generation counter pattern if appropriate.

### Scenario E: "Pod kept restarting in a tight loop"

**Symptoms:** Liveness probe fails; pod restarts; immediately fails again.

**Investigation:**

1. What does liveness check?
2. Is the watchdog mis-touched (the pod is "alive" for the wrong reason)?
3. Is there a startup crash?

**Resolution:**

- Liveness should check the *important* path, not just "process running."
- Don't auto-touch watchdogs in startup code.

### Scenario F: "We deployed a clock injection but tests still wait for real time"

**Symptoms:** Test suite takes 5 minutes. Profile shows mostly `time.Sleep`.

**Investigation:**

1. Search for direct `time.AfterFunc` calls that bypass the injected clock.
2. Look for indirect `time.Sleep` calls.

**Resolution:**

- Ensure every timer goes through the injected interface.
- Code review checklist: "Does this go through Clock?"

### Scenario G: "Our SLO is at risk because of latency tail"

**Symptoms:** p999 latency rising; p50 stable.

**Investigation:**

1. Trace p999 requests. What's slow?
2. Often: a small fraction hit slow GC, slow downstream, or timer-induced waits.

**Resolution:**

- Reduce GC pressure.
- Add jitter to deadlines.
- Tune downstream timeouts.

### Scenario H: "We had a brown-out, not an outage. Hard to debug."

**Symptoms:** Service degraded for 2 hours; some requests slow, some fast. No clear cause.

**Investigation:**

1. Was there elevated GC?
2. Was there elevated goroutine count?
3. Was there a burst of timer fires?

**Resolution:**

- Brown-outs are often caused by transient load spikes.
- Add capacity headroom.
- Smooth load with timers (introduce jitter, batch operations).

### Scenario I: "Our memory limit is 4 GB and we hit it once a week"

**Symptoms:** Periodic OOMs; pattern not yet identified.

**Investigation:**

1. Continuous heap profiling.
2. Look for the spike pattern: time of day, type of request.

**Resolution:**

- Often a specific request type captures large data in a timer closure.
- Refactor capture.

### Scenario J: "Health checks intermittently fail"

**Symptoms:** Health check returns 500 for ~1% of requests during peak.

**Investigation:**

1. What does health check do?
2. Is it timer-driven?
3. Is the timer firing late under load?

**Resolution:**

- Health checks should be cheap and not dependent on timers.
- If they are, the timer must be high-priority (and probably not via `time.AfterFunc`).

---

## Appendix OOO: A practical migration plan for an existing service

If you inherit a service with no timer hygiene, here's a 4-week plan to bring it up to standard.

### Week 1: Audit

- List every `time.AfterFunc` in the codebase.
- For each, document: purpose, duration, who captures, who stops.
- Identify the worst offenders (long duration, large capture).

### Week 2: Instrument

- Wrap every `time.AfterFunc` with the metrics wrapper.
- Deploy and observe baseline metrics.
- Identify any unexpected patterns (leaks, late fires).

### Week 3: Fix worst offenders

- Patch the top 5 issues from Week 1.
- Add tests with mocked clocks.
- Deploy with canary.

### Week 4: Long-tail and process

- Patch remaining issues.
- Add lint rules / code review checklist.
- Write internal docs.
- Train the team.

End state: every timer is observable, bounded, and tested. The team knows the patterns.

---

## Appendix PPP: A response to skeptics

Some engineers will read this and say: "this is overkill for my service."

Maybe. For a 100-line service with one timer, the patterns are overkill. Just write `time.AfterFunc(d, f)` and move on.

The patterns matter when:

- The service is critical (revenue, safety, reputation).
- The service is at scale (1K+ RPS, many timers).
- The team is on-call.
- Multiple engineers maintain the code.

If your context is "demo for a hackathon" or "personal side project," skip most of this. Just remember the panic recovery.

If your context is "production financial system serving millions of users," apply every pattern. The marginal cost is small; the marginal benefit is enormous.

---

## Appendix QQQ: A glossary of "things that bite"

In production, beware:

- **The captured request.** Pins memory.
- **The 24-hour timer.** Accumulates.
- **The unsynced shared variable in a callback.** Race.
- **The unrecovered panic.** Crash.
- **The unhandled Stop's false.** Race in business logic.
- **The polling for fire.** Defeats the point.
- **The `time.After` in a tight loop.** Allocates.
- **The self-scheduling without bound.** Infinite.
- **The naked `go func() { time.Sleep(d); f() }()`.** Wasted goroutine.
- **The watchdog that touches in the wrong place.** Useless.
- **The retry without cap.** Infinite.
- **The fire-and-forget without metric.** Invisible failure.

Memorise. These are the names of bugs.

---

## Appendix RRR: A summary of the entire file in one sentence

Every `time.AfterFunc` in production needs: panic recovery, bounded duration, observability, and tested cleanup — apply these and most timer incidents disappear.

---

## Appendix SSS: A meta-comment on this content

Why so many appendices?

Because the material is genuinely long. Compressing it into "best practices" lists loses the *why*. The postmortems convey the lesson; the patterns convey the form. Both are needed.

If you have read this far, you have probably absorbed more than the average production engineer. Use it well.

---

## Appendix TTT: A note about Go version assumptions

This file assumes Go 1.21 or newer in many places. If you are on Go 1.20 or earlier:

- `context.AfterFunc` is not available — use `go func() { <-ctx.Done(); f() }()`.
- `Reset` may need the drain dance for channel timers (not AfterFunc).
- `testing/synctest` is not available — use a clock library.

Upgrade to 1.21+ if at all possible. The improvements are substantial.

---

## Appendix UUU: Closing pointers

- Junior file → start there if you're new to `AfterFunc`.
- Middle file → for hardened patterns, races, `context.AfterFunc`.
- Senior file → for runtime internals.
- Professional file (this one) → for production operations.
- Specification → for quick reference.
- Interview → for self-testing.
- Tasks, find-bug, optimize → for hands-on practice.

Read in order or jump as needed.

---

## Appendix VVV: A "decade-in-review" of timer-related outages

A retrospective of public timer-related outages we know about:

- **Cloud-provider HTTP service:** misconfigured idle timeout cascaded into a 4-hour partial outage. Fix: review every timeout in the request path; document the SLO each enforces.
- **CDN edge node:** millions of TLS-handshake-failure connections held idle timers; memory exhausted. Fix: shorter handshake timeout; close conns on incomplete TLS faster.
- **Streaming service:** thundering herd of token-refresh timers; backend API rate-limited; cascade. Fix: jitter on refresh intervals.
- **Payment processor:** 30-second auto-refund timer fired late due to GC; double refund. Fix: idempotency keys on payment operations.
- **IoT gateway:** millions of per-device heartbeat watchdog timers; OOM at scale. Fix: bucket devices into wheels.
- **Database driver:** per-connection idle timer leaked memory; client app OOM. Fix: lazy expiration via timestamp comparison.

Patterns:

- Most outages were preventable.
- Most preventions are the patterns in this file.
- The cost of one outage often exceeds the cost of a year of "extra effort" on timer hygiene.

---

## Appendix WWW: Reflection — the gap between "knows" and "applies"

Many engineers can answer interview questions about `time.AfterFunc` correctly. Far fewer apply the same knowledge consistently in production code.

The gap is *discipline*. Code reviews, lint rules, runbooks, and metrics all serve to make the right thing the easy thing.

Build the muscle. Make the lazy default = the safe default.

---

## Appendix XXX: Two more "rules of thumb"

1. **The number of timers in your service should be predictable.** If you can't estimate it within an order of magnitude, you don't understand your design.

2. **Every long-duration timer (> 5 min) is a code smell.** Audit. Justify or remove.

---

## Appendix YYY: A list of things to delete from your service if you find them

In a code audit of an existing service, delete or refactor:

- `time.AfterFunc(d, f)` where `d > 1 hour`.
- `go func() { time.Sleep(d); f() }()` patterns.
- `time.After(d)` inside `for { select {} }` loops.
- `<-ctx.Done()` waits in goroutines that do nothing else.
- Closure captures of full request/response objects in timer callbacks.
- Timer callbacks without `defer recover()`.

Even one fix per audit pays off.

---

## Appendix ZZZ: A final assertion

If you apply the patterns in this file consistently — panic recovery, bounded duration, metrics, sweeping at scale, mocked-clock testing — your service's timer-related production issues will drop by 95% or more.

That is not hyperbole. The patterns are derived from actual postmortems. They prevent actual incidents.

Apply them. Coach your team. Build the discipline.

---

## Appendix AAAA: A parting checklist for ramp-up

A new engineer joining the team and learning timers should be able to:

- Explain `time.AfterFunc` from memory.
- Identify the three common bug patterns (Stop-vs-fire, closure capture, missing panic recovery).
- Use `context.AfterFunc` for context-driven cleanup.
- Choose between per-entry timer, sweeper, and earliest-deadline scheduler based on N.
- Wrap `time.AfterFunc` with the team's standard metrics wrapper.
- Write tests with a mocked clock.
- Diagnose a "live timers climbing" alert.
- Triage a postmortem and write follow-up actions.

If they can do all of this within a month of joining, they are ramping up well.

---

## Appendix BBBB: A note to my future self

When I (the author) re-read this file in two years, I want to:

- Update the Go version references to reflect new releases.
- Add new postmortems from the intervening incidents.
- Remove patterns that have become obsolete.
- Update the library catalog.
- Re-baseline the performance numbers.

Documents like this one are living. Plan to maintain them.

---

End of professional-level material. See `specification.md` for the reference, `interview.md` for Q&A, and the remaining files for exercises and optimization scenarios.





