---
layout: default
title: Professional
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/professional/
---

# time.Ticker — Professional Level (Production Patterns)

## Table of Contents
1. [Introduction](#introduction)
2. [The Production Mental Model](#the-production-mental-model)
3. [Heartbeats: The Most Common Use Case](#heartbeats-the-most-common-use-case)
4. [Telemetry Flush Loops](#telemetry-flush-loops)
5. [Jittered Tick Across Replicas](#jittered-tick-across-replicas)
6. [Backpressure on Slow Consumers](#backpressure-on-slow-consumers)
7. [Observability: Metrics for Skipped Ticks](#observability-metrics-for-skipped-ticks)
8. [Drift Correction and Wall-Clock Alignment](#drift-correction-and-wall-clock-alignment)
9. [Coalescing Many Tickers Into One](#coalescing-many-tickers-into-one)
10. [Per-Connection Tickers at Scale](#per-connection-tickers-at-scale)
11. [Graceful Shutdown of Ticker-Driven Loops](#graceful-shutdown-of-ticker-driven-loops)
12. [Testing Ticker-Driven Code](#testing-ticker-driven-code)
13. [Production Incident #1: The Stampede at 00:00:00 UTC](#production-incident-1-the-stampede-at-000000-utc)
14. [Production Incident #2: The Quiet Heartbeat](#production-incident-2-the-quiet-heartbeat)
15. [Production Incident #3: The Cache Stampede](#production-incident-3-the-cache-stampede)
16. [Production Incident #4: The Drifting Sampler](#production-incident-4-the-drifting-sampler)
17. [Production Incident #5: The Leaking Ticker](#production-incident-5-the-leaking-ticker)
18. [Production Incident #6: The Backpressure Cliff](#production-incident-6-the-backpressure-cliff)
19. [Production Incident #7: The Reset Race](#production-incident-7-the-reset-race)
20. [Patterns for Distributed Schedulers](#patterns-for-distributed-schedulers)
21. [Ticker vs Alternatives in Production](#ticker-vs-alternatives-in-production)
22. [Operational Runbook](#operational-runbook)
23. [Self-Assessment](#self-assessment)
24. [Summary](#summary)

---

## Introduction

A `time.Ticker` looks innocent in a code review. Three lines: open it, drain its channel, defer `Stop`. In production those three lines turn into incidents. A heartbeat ticker on ten thousand pods aligned to the second creates a thundering herd against the control plane. A telemetry flush ticker on a node with a slow uplink quietly drops ticks until the buffer at the receiver overflows and the entire metrics pipeline stalls. A reset call on an active ticker leaves a stale value in `t.C` and the next iteration of the loop fires instantly, double-billing whatever the loop was throttling. A forgotten `Stop` on a long-lived background worker leaks a few hundred timers per request and the timer heap grows until `runtime.adjustTimers` shows up at the top of a CPU profile.

This document is a field manual. It is not about how `time.Ticker` works internally — the senior page covers the four-heap scheduler, the channel buffer change in Go 1.23, the assembly path of `runtime.tickerproc`. This file is about how to *operate* a ticker-driven system: how to shape the load it generates, how to monitor it, how to recover from the kinds of failures that show up at three in the morning when a region is melting and the on-call has been paged for the fifth time in an hour. Every pattern here was paid for by a real outage. Every incident here happened somewhere, sometimes more than once.

We assume you already know the API. `time.NewTicker(d) *Ticker` returns a ticker that delivers the current time on `t.C` every `d`. `t.Stop()` halts further delivery but does not close `t.C` and does not drain pending values. `t.Reset(d)` changes the interval. As of Go 1.23 the ticker is GC-friendly: a ticker whose goroutine is no longer referencing it can be collected without an explicit `Stop` call, although you should still call `Stop` because (a) it makes intent explicit, (b) it works on older Go versions, and (c) it lets the runtime reclaim the timer immediately rather than waiting for the next GC cycle.

The patterns are organised from the most common (heartbeats, telemetry) to the most subtle (drift correction, coalescing). The incidents at the end are presented as postmortems: timeline, root cause, fix, and lessons. Read them. They are how the patterns earned the right to be here.

---

## The Production Mental Model

Before any pattern, internalise four invariants that distinguish a toy ticker from a production ticker.

**Invariant 1: The channel is a buffered slot of size one.** From Go 1.23 onwards `t.C` has capacity 1 (`make(chan Time, 1)`). The runtime delivers a tick by trying a non-blocking send; if the slot is full the tick is dropped. There is no queue of pending ticks. If your handler takes longer than the interval, every overrun tick after the first is silently lost. You will *not* see them as a backlog. You will see them as "the metric is flat".

**Invariant 2: Delivery time is best-effort, not deadline.** The runtime guarantees that the next delivery is *at least* `d` after the previous one. It does not guarantee that it is *exactly* `d`, or even *close to* `d` under scheduler pressure. On a busy machine a 100ms ticker can deliver at 105ms, then 98ms, then 250ms when GC stops the world. Your design must tolerate jitter from below and lateness from above.

**Invariant 3: Wall-clock and monotonic are different.** `time.Now()` returns both a wall reading and a monotonic reading. The ticker fires on monotonic time, which is immune to NTP slew and DST. If you compare the value received on `t.C` to a wall-clock deadline elsewhere, you may compare unlike quantities. Use `time.Since` and `time.Until` rather than subtracting `time.Time` values; they prefer monotonic readings if both sides have one.

**Invariant 4: A ticker holds a goroutine reference until Stop.** Pre-1.23, an unreferenced but un-stopped ticker leaks the goroutine that owns its timer along with one heap entry per ticker. Post-1.23, an unreachable ticker can be GC'd, but the GC may not run for a while. In a 10k-RPS service that creates one ticker per request, "a while" is enough heap pressure to matter. Always `defer t.Stop()`.

We will return to these invariants throughout. They are the bedrock under every pattern.

---

## Heartbeats: The Most Common Use Case

A heartbeat is a periodic message from a worker to a coordinator saying "I am alive and making progress." Examples: a pod posting to a service registry, a consumer renewing a lease against a distributed lock, a long-running task reporting progress to a watcher goroutine.

### Baseline implementation

```go
package heartbeat

import (
    "context"
    "log/slog"
    "time"
)

type Reporter interface {
    Report(ctx context.Context, payload Payload) error
}

type Payload struct {
    NodeID    string
    Sequence  uint64
    Timestamp time.Time
    Healthy   bool
}

// Run sends a heartbeat every interval until ctx is cancelled.
// It blocks; callers should run it in its own goroutine.
func Run(ctx context.Context, r Reporter, nodeID string, interval time.Duration, log *slog.Logger) error {
    t := time.NewTicker(interval)
    defer t.Stop()

    var seq uint64
    // Send one immediately so consumers see liveness without waiting a full interval.
    if err := r.Report(ctx, Payload{NodeID: nodeID, Sequence: seq, Timestamp: time.Now(), Healthy: true}); err != nil {
        log.Warn("initial heartbeat failed", "err", err)
    }
    seq++

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            if err := r.Report(ctx, Payload{NodeID: nodeID, Sequence: seq, Timestamp: now, Healthy: true}); err != nil {
                log.Warn("heartbeat failed", "err", err, "seq", seq)
                // Do not return; transient failures are normal.
            }
            seq++
        }
    }
}
```

Three things in the baseline that matter:

1. **`defer t.Stop()` is on the line after `NewTicker`.** Never separate them by more than one line of code. If a panic happens between `NewTicker` and `defer`, you leak the ticker.
2. **The first heartbeat fires before the loop.** Consumers should not have to wait `interval` seconds to observe liveness for the first time. Sending immediately also lets you detect a misconfigured reporter on startup rather than on the first tick.
3. **A failed report is logged, not returned.** A heartbeat that crashes on a transient HTTP 503 is worse than no heartbeat — the worker would be marked dead while it is still working. The loop continues; the consumer's job is to debounce.

### Why a heartbeat is harder than it looks

A naïve heartbeat loop has at least seven failure modes:

| Failure | Trigger | Consequence |
|---|---|---|
| Coordinator slow | Reporter blocks > interval | Ticks pile up at runtime, only one is delivered, gap looks identical to dead worker |
| Coordinator unreachable | Network partition | All reports fail; should worker assume itself unhealthy? |
| Clock skew | NTP step | If coordinator uses wall-clock, "next heartbeat by" deadline can be wrong |
| GC pause | Worker is in 2 s STW | Heartbeats stop, coordinator marks dead, worker resumes "back from the dead" |
| Stampede | All workers heartbeat at minute boundaries | Coordinator throttles; some workers marked dead |
| Self-healing thrash | Worker fails health check, restarts, immediately heartbeats again | Coordinator's "flap" detector fires |
| Leak on shutdown | Worker stops but ticker goroutine survives | Tickers accumulate across rolling restarts |

Each pattern in this section addresses at least one of these. The baseline above only solves the "leak on shutdown" line, because of the `defer t.Stop()` and the `ctx.Done()` branch.

### Heartbeats with deadline-based delivery

If the consumer cares about "heartbeat received within X seconds of expected time", give the reporter a deadline so it does not block forever on a slow coordinator. The deadline must be shorter than the interval, otherwise reports overlap.

```go
func RunWithDeadline(ctx context.Context, r Reporter, nodeID string, interval time.Duration, log *slog.Logger) error {
    if interval <= 0 {
        return errors.New("heartbeat: interval must be positive")
    }
    // The deadline is half the interval. A late report is no use; abort it.
    reportTimeout := interval / 2
    if reportTimeout < 100*time.Millisecond {
        reportTimeout = 100 * time.Millisecond
    }

    t := time.NewTicker(interval)
    defer t.Stop()

    var seq uint64
    send := func(now time.Time) {
        rctx, cancel := context.WithTimeout(ctx, reportTimeout)
        defer cancel()
        if err := r.Report(rctx, Payload{NodeID: nodeID, Sequence: seq, Timestamp: now, Healthy: true}); err != nil {
            log.Warn("heartbeat failed", "err", err, "seq", seq)
        }
        seq++
    }
    send(time.Now())

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            send(now)
        }
    }
}
```

Two notes:

- `reportTimeout := interval / 2` is a heuristic. The exact ratio depends on the coordinator's SLO. For a 30s interval with a coordinator that occasionally takes 8s, set the timeout to 10s. The rule of thumb: timeout < interval, and (timeout × max-concurrent-retries) < interval.
- We use the tick value `now` (the runtime's view of when the tick fired) rather than calling `time.Now()` inside the loop. This is not just stylistic; on a busy system `time.Now()` may be a few milliseconds after the tick, and propagating that bias every iteration accumulates drift if a downstream system uses the timestamp to compute deltas.

### Heartbeats with an outgoing buffer

If the report path is asynchronous — say, a message queue or an in-memory channel sent to another goroutine that batches — the heartbeat loop should not block on a full buffer. Drop the heartbeat instead.

```go
func RunBuffered(ctx context.Context, out chan<- Payload, nodeID string, interval time.Duration, log *slog.Logger) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    var seq, dropped uint64

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            p := Payload{NodeID: nodeID, Sequence: seq, Timestamp: now, Healthy: true}
            select {
            case out <- p:
                // sent
            default:
                dropped++
                log.Warn("heartbeat buffer full, dropping",
                    "dropped_total", dropped, "seq", seq)
            }
            seq++
        }
    }
}
```

The pattern `select { case out <- p: default: }` is the canonical Go idiom for a non-blocking send. It maps cleanly to the production constraint: a heartbeat is throwaway data; missing one is far less bad than blocking the heartbeat goroutine, which is exactly the situation we are trying to avoid by sending heartbeats in the first place.

The `dropped` counter belongs in a metric. We will return to that in [Observability: Metrics for Skipped Ticks](#observability-metrics-for-skipped-ticks).

### Heartbeats with grace on transient failures

A heartbeat that posts to a coordinator over HTTP is going to fail occasionally. The naïve "log and continue" is fine if the coordinator's debouncing handles a few drops. If the coordinator marks a worker dead after one missed heartbeat, you need retries.

```go
type retryReporter struct {
    inner Reporter
    log   *slog.Logger
}

func (r retryReporter) Report(ctx context.Context, p Payload) error {
    var lastErr error
    for attempt := 0; attempt < 3; attempt++ {
        if err := r.inner.Report(ctx, p); err == nil {
            return nil
        } else {
            lastErr = err
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Duration(100*(1<<attempt)) * time.Millisecond):
        }
    }
    return lastErr
}
```

Two notes on `time.After` here:

1. `time.After` allocates a fresh timer each call. Inside a `select` that loops thousands of times per second this is a problem; inside a heartbeat retry that runs at most three times per interval it is fine.
2. The backoff is `100ms, 200ms, 400ms`. Total worst case is 700ms plus three round-trips. Make sure that is less than `interval/2` if you also have a per-call timeout.

Better is to share a `time.Timer`:

```go
func (r retryReporter) Report(ctx context.Context, p Payload) error {
    timer := time.NewTimer(0)
    defer timer.Stop()
    if !timer.Stop() {
        <-timer.C
    }

    var lastErr error
    for attempt := 0; attempt < 3; attempt++ {
        if err := r.inner.Report(ctx, p); err == nil {
            return nil
        } else {
            lastErr = err
        }
        backoff := time.Duration(100*(1<<attempt)) * time.Millisecond
        timer.Reset(backoff)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
    }
    return lastErr
}
```

This is overkill for three retries per heartbeat. It would matter if you had a thousand retries per second; see [Coalescing Many Tickers Into One](#coalescing-many-tickers-into-one).

### Detecting your own heartbeat is broken

A common bug: the heartbeat loop runs forever, but the worker thread it is meant to monitor has died, so heartbeats report a worker that is no longer doing work. Solve by routing the heartbeat through the worker itself:

```go
type Worker struct {
    work    chan unit
    healthy atomic.Bool
}

func (w *Worker) Process(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-w.work:
            // do something
            w.healthy.Store(true)
        }
    }
}

func (w *Worker) Beat(ctx context.Context, r Reporter, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            healthy := w.healthy.Swap(false) // reset; worker re-sets when it makes progress
            p := Payload{Timestamp: now, Healthy: healthy}
            r.Report(ctx, p)
        }
    }
}
```

Now a heartbeat with `Healthy: false` means the worker has not made progress since the last heartbeat. A consumer that sees three such heartbeats in a row should mark the worker stuck even though it is still posting.

This trick — heartbeat-as-liveness-probe-of-internal-state — is what separates a watchdog from a "this goroutine is still scheduled" signal. The latter is almost never what you want.

---

## Telemetry Flush Loops

The second-most-common ticker pattern is "buffer metrics in memory and flush periodically." Examples: an in-process StatsD client, a Prometheus push-gateway client, an OpenTelemetry batch span processor, a log forwarder that uploads gzipped lines every five seconds.

### Why flush periodically

Sending every event synchronously is expensive: a syscall per event, a round-trip per event, and a serialisation step per event. Batching amortises all three. The tradeoff is staleness: an event recorded at T appears at the receiver at T + flush-interval.

Reasonable flush intervals:

| Data type | Typical interval | Reason |
|---|---|---|
| Counters | 10 s | Granularity finer than this is wasted on most dashboards |
| Histograms | 10 s | Same |
| Logs | 1–5 s | Operators want near-real-time |
| Traces | 1 s | Tracing UIs assume near-real-time |
| Errors | 0 s (synchronous) | Errors must not be lost in a crash |
| Profiles | 60 s | Profiles are large; high cost per send |

### Baseline batch flusher

```go
package metrics

import (
    "context"
    "log/slog"
    "sync"
    "time"
)

type Event struct {
    Name   string
    Value  float64
    Labels map[string]string
    Time   time.Time
}

type Sink interface {
    Send(ctx context.Context, batch []Event) error
}

type Flusher struct {
    sink     Sink
    interval time.Duration
    maxBatch int
    log      *slog.Logger

    mu     sync.Mutex
    buffer []Event

    in chan Event
}

func NewFlusher(sink Sink, interval time.Duration, maxBatch int, log *slog.Logger) *Flusher {
    return &Flusher{
        sink: sink, interval: interval, maxBatch: maxBatch, log: log,
        in: make(chan Event, 1024),
    }
}

// Record is the non-blocking producer side.
func (f *Flusher) Record(e Event) {
    select {
    case f.in <- e:
    default:
        f.log.Warn("telemetry: in-queue full, dropping event", "name", e.Name)
    }
}

// Run is the consumer side; one goroutine.
func (f *Flusher) Run(ctx context.Context) error {
    t := time.NewTicker(f.interval)
    defer t.Stop()

    flush := func() {
        f.mu.Lock()
        batch := f.buffer
        f.buffer = nil
        f.mu.Unlock()
        if len(batch) == 0 {
            return
        }
        sctx, cancel := context.WithTimeout(ctx, f.interval)
        defer cancel()
        if err := f.sink.Send(sctx, batch); err != nil {
            f.log.Warn("flush failed", "err", err, "events", len(batch))
        }
    }

    for {
        select {
        case <-ctx.Done():
            flush() // final flush on shutdown
            return ctx.Err()
        case <-t.C:
            flush()
        case e := <-f.in:
            f.mu.Lock()
            f.buffer = append(f.buffer, e)
            full := len(f.buffer) >= f.maxBatch
            f.mu.Unlock()
            if full {
                flush() // size-based flush even before the timer fires
            }
        }
    }
}
```

Things to notice:

- **Two flush triggers: time and size.** Either can fire first. Without size, a burst of events would balloon the buffer before the next tick.
- **Final flush on `ctx.Done()`.** Shutdown should not discard buffered data. If the shutdown is forced by a SIGKILL there is nothing you can do; for SIGTERM you have a few seconds to finish the upload.
- **Mutex around `buffer`.** The flush path takes the buffer atomically, leaving the producer free to append a new buffer. Holding the mutex during `Send` would block producers for the duration of the upload.
- **Send timeout = interval.** A send that takes longer than one interval means data accumulates faster than it ships. The timeout caps the damage; missing data is preferable to indefinite buffering.

### Decoupling the ticker from the work

A subtle problem in the baseline: while `flush()` is running (which can take up to `interval`), the next tick can fire but is consumed by the `case <-t.C:` immediately when the previous handler returns. From the outside the second tick appears to be on time, but the *actual* flush rhythm is determined by how long each flush takes.

For most telemetry this is fine. For a strict-rhythm flush (e.g., billing rollups that must align to wall-clock minute boundaries), do the work in a separate goroutine and let the ticker stay punctual:

```go
func (f *Flusher) RunRhythmic(ctx context.Context) error {
    t := time.NewTicker(f.interval)
    defer t.Stop()

    sem := make(chan struct{}, 1) // at most one flush in flight
    flush := func() {
        select {
        case sem <- struct{}{}:
        default:
            f.log.Warn("flush skipped, previous still running")
            return
        }
        go func() {
            defer func() { <-sem }()
            f.mu.Lock()
            batch := f.buffer
            f.buffer = nil
            f.mu.Unlock()
            if len(batch) == 0 {
                return
            }
            sctx, cancel := context.WithTimeout(ctx, f.interval)
            defer cancel()
            if err := f.sink.Send(sctx, batch); err != nil {
                f.log.Warn("flush failed", "err", err, "events", len(batch))
            }
        }()
    }

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            flush()
        }
    }
}
```

The `sem` channel of capacity one is a non-blocking lock: at most one flush is in flight. If a flush is already running when a tick fires, the tick is dropped (and logged). This is *deliberate* backpressure: we would rather skip a flush than queue them.

### Streaming the flush

A third pattern, when batches are big and the sink supports it: stream rather than send. The ticker fires a "begin flush" signal; the producer keeps appending into a streaming write that ends when the next tick fires.

```go
type StreamingSink interface {
    Begin(ctx context.Context) (StreamWriter, error)
}

type StreamWriter interface {
    Write(e Event) error
    Close() error
}

func (f *Flusher) RunStreaming(ctx context.Context) error {
    t := time.NewTicker(f.interval)
    defer t.Stop()

    var writer StreamWriter
    closeWriter := func() {
        if writer != nil {
            if err := writer.Close(); err != nil {
                f.log.Warn("close stream", "err", err)
            }
            writer = nil
        }
    }
    defer closeWriter()

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            closeWriter()
            w, err := f.sink.Begin(ctx)
            if err != nil {
                f.log.Warn("begin stream", "err", err)
                continue
            }
            writer = w
        case e := <-f.in:
            if writer == nil {
                // No stream open; drop or buffer.
                continue
            }
            if err := writer.Write(e); err != nil {
                f.log.Warn("stream write", "err", err)
                closeWriter()
            }
        }
    }
}
```

This is the model used by AWS Kinesis Firehose, by Datadog's trace agent during high-cardinality periods, and by some Loki shippers. The advantage: no in-memory buffer growth; backpressure shows up immediately as `Write` errors. The disadvantage: the sink must support framed streaming, which excludes most HTTP-POST receivers.

### What goes wrong with naive flushers

The single most common bug in flusher code is conflating "flush on tick" with "process input." If you write:

```go
for range t.C {
    flush()
}
```

…then the only way new events enter the buffer is for `Record` to be a producer to a shared buffer protected by a lock. That works, but it means `Record` can block if the lock is held by `flush`. If `flush` takes 200ms, every `Record` during that window is stalled. On a hot path that records ten thousand events per second, you have just created a 200ms latency spike for every flush. The pattern above — separate input channel, ticker just signals a flush — avoids this entirely.

The second-most-common bug is forgetting the final flush. A process that exits cleanly via `ctx.Done()` should still upload its last batch. The `defer t.Stop()` does not do this; you need explicit code in the `ctx.Done()` branch.

The third-most-common bug is unbounded buffer growth. If `Send` is failing and you keep appending, you eat memory until OOM. Cap the buffer.

```go
const maxBufferedEvents = 100_000

func (f *Flusher) recordSafe(e Event) {
    f.mu.Lock()
    defer f.mu.Unlock()
    if len(f.buffer) >= maxBufferedEvents {
        f.log.Warn("telemetry: buffer at cap, dropping", "name", e.Name)
        return
    }
    f.buffer = append(f.buffer, e)
}
```

---

## Jittered Tick Across Replicas

A fleet of N replicas of the same service, each running the same ticker at the same interval, will (absent jitter) all fire at almost the same time. The variance comes only from startup time differences. After a few hours, NTP slew and the runtime's monotonic clock keep them within a few hundred microseconds of each other. The result is a coordinated burst against whatever downstream system they all hit.

If the downstream is a control plane, a cache, a database, a queue, or an external API, the burst translates to a periodic latency spike at the tick boundary. The latency spike causes timeouts on the slow replicas, which retry, which makes the spike worse. This pattern is called a *stampede*. It is the second most common cause of cascading failure I have personally seen, after retry-without-backoff.

### Per-replica jitter

The fix is to add a per-replica random offset to the tick. Each replica picks a number uniformly between zero and the interval, sleeps that long once at startup, and then ticks at the interval.

```go
func RunJittered(ctx context.Context, interval time.Duration, do func()) error {
    if interval <= 0 {
        return errors.New("interval must be positive")
    }
    // Uniform jitter in [0, interval).
    offset := time.Duration(rand.Int63n(int64(interval)))
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(offset):
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            do()
        }
    }
}
```

After the initial jitter, every replica still ticks at exactly `interval`. They are now uniformly distributed within a single interval window: the load on the downstream is spread evenly.

Use a per-process `*rand.Rand` seeded from `crypto/rand` if you care that two processes started at the same wall second do not pick the same jitter. With Go 1.20+ and `math/rand/v2`, the default source is already seeded randomly per process, so a plain `rand.Int63n` is fine.

### Per-tick jitter

A subtler variant: jitter every tick, not just the first one. This is used when you suspect the downstream has some other coordinated load — say, a database that runs a checkpoint every minute — and you want to *avoid* aligning with it consistently.

```go
func RunPerTickJittered(ctx context.Context, base, jitter time.Duration, do func()) error {
    if base <= 0 {
        return errors.New("base must be positive")
    }
    timer := time.NewTimer(base)
    defer timer.Stop()
    for {
        // Reset the timer with base + random jitter.
        d := base + time.Duration(rand.Int63n(int64(jitter)))
        timer.Reset(d)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        do()
    }
}
```

Notice this uses `time.Timer` (one-shot, reset every iteration) not `time.Ticker`. A ticker has a fixed interval; if you want jitter per tick you cannot use a ticker. The pattern is "timer-as-ticker."

### Bounded jitter

Pure jitter `[0, interval)` is too aggressive for some use cases. You may want "tick at 60s but smear over a 5s window centred on minute boundaries." The pattern is:

```go
func nextAt(now time.Time, base time.Duration, jitterWindow time.Duration) time.Duration {
    // Find the next multiple of base, then add jitter in [-jitterWindow/2, +jitterWindow/2].
    bucket := now.Truncate(base).Add(base)
    j := time.Duration(rand.Int63n(int64(jitterWindow))) - jitterWindow/2
    next := bucket.Add(j)
    if next.Before(now) {
        next = next.Add(base)
    }
    return next.Sub(now)
}

func RunAligned(ctx context.Context, base, jitter time.Duration, do func()) error {
    timer := time.NewTimer(nextAt(time.Now(), base, jitter))
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        do()
        timer.Reset(nextAt(time.Now(), base, jitter))
    }
}
```

This is what you want for "billing run every hour on the hour, but spread across replicas over a 60-second window." The bucket boundary is the wall-clock hour; the jitter offsets within ±30 seconds of that boundary.

### Deterministic jitter

If you need reproducibility — for example, you want every replica's tick offset to be stable across restarts so a debugging session can predict when it will fire — derive the jitter from the replica's identity rather than a random source.

```go
import "hash/fnv"

func deterministicJitter(replicaID string, interval time.Duration) time.Duration {
    h := fnv.New64a()
    h.Write([]byte(replicaID))
    sum := h.Sum64()
    return time.Duration(sum % uint64(interval))
}
```

If you rename a replica, its jitter changes. If two replicas have the same ID (rolling restart, replica reuses pod name) they get the same jitter, which defeats the purpose. Hash on `hostname + start-time` for safety.

### Anti-pattern: jitter at the consumer

A natural mistake: instead of jittering the producer, jitter the consumer. "We'll have the receiver sleep a random amount before processing." This is *worse*, because the receiver still gets the burst, just delays it. The peak load on the receiver's input queue is the same, just shifted. Jitter belongs at the source.

### Measuring jitter effectiveness

Add a metric that records, for each tick, the wall-clock time at which the work started. After a few hours, plot a histogram. If jitter is working, you see a uniform distribution across the interval. If it is not, you see a tight peak near a boundary.

```go
var tickStartHistogram = prometheus.NewHistogram(prometheus.HistogramOpts{
    Name:    "ticker_start_offset_seconds",
    Help:    "Offset within the tick interval when work started",
    Buckets: prometheus.LinearBuckets(0, 1, 60),
})

func RunWithMetric(ctx context.Context, interval time.Duration, do func()) error {
    offset := time.Duration(rand.Int63n(int64(interval)))
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(offset):
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    start := time.Now()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            elapsed := time.Since(start).Seconds()
            bucketSec := math.Mod(elapsed, interval.Seconds())
            tickStartHistogram.Observe(bucketSec)
            do()
        }
    }
}
```

In production this metric is more useful than you would expect. Once we found a "jittered" cron pool that was synchronizing because every replica seeded `math/rand` with `time.Now().Unix()` and they all started in the same second.

---

## Backpressure on Slow Consumers

A ticker fires; the handler is still finishing the previous tick. What happens? The Go runtime tries a non-blocking send on `t.C`. The slot has capacity one. If it is full, the tick is silently dropped. There is no error, no log, no signal. From the application's perspective the gap looks identical to the ticker being slower.

For some workloads this is exactly the right behaviour. A heartbeat that fires every second but is sometimes processed every two seconds is fine: the consumer skips a beat, you log it, life goes on. For other workloads — billing, GDPR-required state transitions, exactly-once cleanup — dropping a tick is unacceptable.

### Detecting drops

The simplest detection is to check the elapsed time inside the handler:

```go
func RunWithDropDetection(ctx context.Context, interval time.Duration, do func()) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    last := time.Now()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            gap := now.Sub(last)
            if gap > 2*interval {
                slog.Warn("ticker drop detected",
                    "expected", interval, "actual", gap,
                    "dropped", int(gap/interval)-1)
            }
            last = now
            do()
        }
    }
}
```

This counts dropped ticks. Note `now` is the tick time as delivered by the runtime, not `time.Now()`. The tick time is the time the runtime *scheduled* the tick, so the gap directly reflects how many tick periods elapsed between the last delivered tick and this one. If three ticks were dropped, the gap is 4× the interval.

### Strategy 1: shed load

The simplest backpressure response is "do less work per tick." If your handler decides per-tick whether to act, you can shed cheaply:

```go
type LoadShedder struct {
    rate atomic.Uint64 // multiplier per 100; 100 = full load, 50 = half load
}

func (l *LoadShedder) shouldRun() bool {
    r := l.rate.Load()
    if r >= 100 {
        return true
    }
    return rand.Uint64()%100 < r
}

func (l *LoadShedder) Run(ctx context.Context, interval time.Duration, do func()) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    last := time.Now()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            gap := now.Sub(last)
            if gap > 2*interval && l.rate.Load() > 25 {
                old := l.rate.Add(^uint64(9)) // -10
                slog.Warn("shedding load", "rate", old-10)
            }
            last = now
            if l.shouldRun() {
                do()
            }
        }
    }
}
```

`rate` starts at 100. Each detected drop drops it by 10. A separate goroutine raises it back to 100 slowly. This is a primitive form of additive-increase, multiplicative-decrease.

### Strategy 2: drain pending work concurrently

If the work is parallelisable, run multiple workers behind one ticker. The ticker enqueues; workers dequeue.

```go
type Task struct {
    Seq  uint64
    Time time.Time
}

func RunParallel(ctx context.Context, interval time.Duration, workers int, do func(Task)) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    in := make(chan Task, workers*2)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for task := range in {
                do(task)
            }
        }()
    }
    defer func() {
        close(in)
        wg.Wait()
    }()

    var seq uint64
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            task := Task{Seq: seq, Time: now}
            seq++
            select {
            case in <- task:
            default:
                slog.Warn("all workers busy, dropping task", "seq", task.Seq)
            }
        }
    }
}
```

Capacity of `in` is `workers * 2`, so a brief slowdown does not drop immediately. Beyond that, the non-blocking send sheds load. The number of workers is the maximum concurrency you tolerate; for a ticker fed work that takes longer than `interval/workers` to complete, the queue fills and drops resume.

### Strategy 3: dynamic interval

If the work's duration depends on input that varies, adapt the interval. Slow down when handlers are slow.

```go
type AdaptiveTicker struct {
    base    time.Duration
    current time.Duration
    min     time.Duration
    max     time.Duration
}

func (a *AdaptiveTicker) Run(ctx context.Context, do func() time.Duration) error {
    a.current = a.base
    timer := time.NewTimer(a.current)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        dur := do()
        // If work took > half the interval, slow down. If < quarter, speed up.
        switch {
        case dur > a.current/2:
            a.current = min(a.current*2, a.max)
        case dur < a.current/4:
            a.current = max(a.current/2, a.min)
        }
        timer.Reset(a.current)
    }
}
```

This uses `time.Timer`, not `time.Ticker`, because the interval changes per iteration. You can also call `t.Reset(d)` on a ticker, but you have to be careful about the `Reset` race; see [Production Incident #7](#production-incident-7-the-reset-race).

### Strategy 4: bounded delay

Sometimes you cannot drop a tick. The work must run eventually. Then queue it; if the queue overflows, block (deliberate backpressure on the producer, which is the ticker).

```go
func RunNoDrop(ctx context.Context, interval time.Duration, queueCap int, do func(time.Time)) error {
    in := make(chan time.Time, queueCap)
    go func() {
        for now := range in {
            do(now)
        }
    }()
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            close(in)
            return ctx.Err()
        case now := <-t.C:
            // Blocking send; if queue is full, the next tick from the runtime is dropped
            // while we wait. But once we unblock, all future ticks are honored.
            select {
            case in <- now:
            case <-ctx.Done():
                close(in)
                return ctx.Err()
            }
        }
    }
}
```

A subtle property: while the loop is blocked in `in <- now`, the runtime continues to deliver ticks to `t.C`, but only one can fit in `t.C`. Subsequent ticks are dropped at the runtime level. When we unblock, we receive the single most recent tick, send it to the queue, and continue. So this isn't strictly no-drop; it is "no drop within the queue, but the in-flight tick can still be dropped." For true no-drop you need to advance an internal clock and emit *missed* ticks to the queue:

```go
func RunCatchUp(ctx context.Context, interval time.Duration, queueCap int, do func(time.Time)) error {
    in := make(chan time.Time, queueCap)
    go func() {
        for now := range in {
            do(now)
        }
    }()
    t := time.NewTicker(interval)
    defer t.Stop()
    last := time.Now()
    for {
        select {
        case <-ctx.Done():
            close(in)
            return ctx.Err()
        case now := <-t.C:
            // Catch up on any ticks the runtime dropped.
            for last.Add(interval).Before(now) {
                last = last.Add(interval)
                select {
                case in <- last:
                case <-ctx.Done():
                    close(in)
                    return ctx.Err()
                }
            }
            last = now
            select {
            case in <- now:
            case <-ctx.Done():
                close(in)
                return ctx.Err()
            }
        }
    }
}
```

Now the queue receives one entry per interval that should have elapsed, even if the runtime dropped some. This is the only way to get exactly-once tick semantics from `time.Ticker`. For most workloads it is overkill; for billing it is what you need.

---

## Observability: Metrics for Skipped Ticks

You cannot fix what you cannot see. Every production ticker should emit metrics. The minimal set:

| Metric | Type | What it tells you |
|---|---|---|
| `ticker_iterations_total` | counter | rate of work loop iterations |
| `ticker_drops_total` | counter | ticks the runtime dropped due to slow consumer |
| `ticker_duration_seconds` | histogram | wall time spent in handler |
| `ticker_interval_seconds` | gauge | current interval (useful for adaptive tickers) |
| `ticker_last_success_timestamp` | gauge | for alerting on stuck loops |

### Reference instrumentation

```go
package tickerobs

import (
    "context"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    iterations = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "ticker_iterations_total",
        Help: "Number of ticker handler invocations.",
    }, []string{"name"})

    drops = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "ticker_drops_total",
        Help: "Number of ticks dropped by the runtime due to slow consumer.",
    }, []string{"name"})

    duration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "ticker_duration_seconds",
        Help:    "Wall-clock duration of ticker handler.",
        Buckets: prometheus.DefBuckets,
    }, []string{"name"})

    interval = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "ticker_interval_seconds",
        Help: "Current configured ticker interval.",
    }, []string{"name"})

    lastSuccess = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "ticker_last_success_timestamp_seconds",
        Help: "Unix timestamp of last successful tick.",
    }, []string{"name"})

    errors = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "ticker_errors_total",
        Help: "Number of ticker handler errors.",
    }, []string{"name"})
)

type Loop struct {
    Name     string
    Interval time.Duration
    Do       func(context.Context, time.Time) error
}

func (l Loop) Run(ctx context.Context) error {
    interval.WithLabelValues(l.Name).Set(l.Interval.Seconds())
    t := time.NewTicker(l.Interval)
    defer t.Stop()

    last := time.Now()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            gap := now.Sub(last)
            if gap > 2*l.Interval {
                missed := int(gap/l.Interval) - 1
                drops.WithLabelValues(l.Name).Add(float64(missed))
            }
            last = now

            start := time.Now()
            err := l.Do(ctx, now)
            duration.WithLabelValues(l.Name).Observe(time.Since(start).Seconds())
            iterations.WithLabelValues(l.Name).Inc()
            if err != nil {
                errors.WithLabelValues(l.Name).Inc()
            } else {
                lastSuccess.WithLabelValues(l.Name).Set(float64(time.Now().Unix()))
            }
        }
    }
}
```

This is the canonical "instrumented loop" pattern. We use it for every ticker in production code.

### Useful queries

Given the above, Prometheus queries that find broken tickers:

```promql
# Tickers that have not made progress in 5 minutes (despite being expected to)
time() - ticker_last_success_timestamp_seconds > 300

# Tickers dropping more than 10% of their ticks
rate(ticker_drops_total[5m]) / rate(ticker_iterations_total[5m]) > 0.1

# Tickers where p99 handler duration exceeds interval (will start dropping)
histogram_quantile(0.99, rate(ticker_duration_seconds_bucket[5m])) > ticker_interval_seconds

# Tickers where handler error rate > 5%
rate(ticker_errors_total[5m]) / rate(ticker_iterations_total[5m]) > 0.05
```

The last query is the most actionable. If `p99 handler duration > interval` for a sustained period, your ticker is dropping ticks even if it does not look like it.

### Alerting

```yaml
groups:
- name: tickers
  rules:
  - alert: TickerStalled
    expr: time() - ticker_last_success_timestamp_seconds > 300
    for: 1m
    labels:
      severity: page
    annotations:
      summary: "Ticker {{ $labels.name }} has not succeeded in 5 minutes"

  - alert: TickerDroppingTicks
    expr: rate(ticker_drops_total[5m]) / rate(ticker_iterations_total[5m]) > 0.1
    for: 10m
    labels:
      severity: warn
    annotations:
      summary: "Ticker {{ $labels.name }} is dropping >10% of ticks"

  - alert: TickerHandlerSlower
    expr: histogram_quantile(0.99, rate(ticker_duration_seconds_bucket[5m])) > ticker_interval_seconds
    for: 5m
    labels:
      severity: warn
    annotations:
      summary: "Ticker {{ $labels.name }} handler p99 exceeds interval"
```

These three alerts cover 90% of ticker failure modes. The first catches "loop dead." The second catches "loop is slower than it should be." The third predicts the second by a few minutes — by the time you see drops, you have been over-budget on duration for a while.

### Logging

Logs and metrics serve different purposes. Metrics tell you the rate; logs tell you the *what*. For a ticker, log on drop, on error, and on interval change. Do not log on every successful tick — at a high rate this drowns the rest of the log stream.

```go
if missed > 0 {
    slog.WarnContext(ctx, "ticker drop",
        "name", l.Name,
        "missed", missed,
        "gap", gap,
        "interval", l.Interval)
}
if err != nil {
    slog.ErrorContext(ctx, "ticker handler",
        "name", l.Name,
        "err", err,
        "duration", time.Since(start))
}
```

Use `slog.WarnContext` so the log carries the trace ID if one is in context. We have caught more issues by correlating a `WARN drop` log with a trace ID than by reading metrics alone.

---

## Drift Correction and Wall-Clock Alignment

A `time.Ticker` measures intervals on the monotonic clock. The interval `d` between consecutive ticks is guaranteed to be *at least* `d`. If a tick fires late (handler runs long, scheduler is busy), the next tick is *not* delivered early to compensate; the runtime simply schedules the next tick `d` after the previous one. Over time the ticker drifts away from any wall-clock anchor.

For most workloads this is fine. For billing, snapshots, and time-windowed analytics it is wrong.

### What drift looks like

```go
func main() {
    t := time.NewTicker(1 * time.Second)
    defer t.Stop()
    start := time.Now()
    for i := 0; i < 10; i++ {
        <-t.C
        expected := start.Add(time.Duration(i+1) * time.Second)
        actual := time.Now()
        fmt.Printf("tick %d: drift = %v\n", i, actual.Sub(expected))
        time.Sleep(50 * time.Millisecond) // simulate slow handler
    }
}
```

Expected output: drift grows by ~50ms per tick. After 100 ticks the drift is ~5 s. The ticker fires at relative times 1s, 2s, 3s from the previous tick, but each tick's *handling* takes 50ms, so by the time we reach the next `<-t.C` we are 50ms late. The runtime delivers the next tick 1s after the previous *delivery*, not 1s after the previous *expected time*. The drift compounds.

### Strategy: anchor to wall clock with a timer

If you want "fire at top of each second, regardless of handler duration", drop `time.Ticker` and use `time.Timer` with explicit re-arming relative to wall time.

```go
func RunAligned(ctx context.Context, interval time.Duration, do func(time.Time)) error {
    if interval <= 0 {
        return errors.New("interval must be positive")
    }
    // Align first tick to the next interval boundary.
    nextDeadline := time.Now().Truncate(interval).Add(interval)
    timer := time.NewTimer(time.Until(nextDeadline))
    defer timer.Stop()

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        do(nextDeadline)
        nextDeadline = nextDeadline.Add(interval)
        // If we are behind, skip to the next future deadline.
        if time.Now().After(nextDeadline) {
            now := time.Now()
            elapsed := now.Sub(nextDeadline)
            skip := elapsed / interval
            nextDeadline = nextDeadline.Add((skip + 1) * interval)
        }
        timer.Reset(time.Until(nextDeadline))
    }
}
```

This is the alignment pattern. Three things to notice:

1. **Use `Truncate`** to find the previous interval boundary, then add one interval to get the next. For `interval = 1 * time.Minute`, `now.Truncate(time.Minute)` returns the start of the current minute.
2. **Use `time.Until`** to compute the next reset duration. This is robust against the timer being already in the past (small negative durations).
3. **Skip past missed deadlines.** If the handler took 3.5 intervals, advance `nextDeadline` by 4 intervals and run only the next one. Catching up on missed work is usually wrong (the dashboard wants every minute, not four minutes' worth of work crammed into one).

### Aligning to non-multiples of seconds

Go time arithmetic supports nanosecond precision but the wall clock is often only stable to microseconds. For interval boundaries below a millisecond, do not bother — the OS scheduler will jitter you by 50–200µs anyway.

For interval boundaries above a second:

```go
// "Every 5 minutes at :00 mark"
func nextFiveMin(now time.Time) time.Time {
    bucket := now.Truncate(5 * time.Minute)
    next := bucket.Add(5 * time.Minute)
    if next.Equal(now) || next.Before(now) {
        next = next.Add(5 * time.Minute)
    }
    return next
}

// "Every hour at H:00:00 UTC"
func nextHour(now time.Time) time.Time {
    return now.UTC().Truncate(time.Hour).Add(time.Hour)
}

// "Every day at 04:00 UTC"
func nextDailyAt(now time.Time, hour int) time.Time {
    base := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, time.UTC)
    if !base.After(now) {
        base = base.AddDate(0, 0, 1)
    }
    return base
}
```

For "every Sunday at 03:00", "first of the month", or other calendar-aware schedules, drop in-process tickers and use a cron library (`github.com/robfig/cron/v3`) or an external scheduler. Hand-rolled calendar math gets DST wrong; cron libraries get it right (they have eaten the bugs already).

### Drift correction without alignment

Sometimes you do not care about wall-clock alignment but do care that the average rate matches `interval`. The technique is to compute the next sleep duration as `interval - (time-since-tick-started)`:

```go
func RunRateCorrected(ctx context.Context, interval time.Duration, do func()) error {
    timer := time.NewTimer(interval)
    defer timer.Stop()
    next := time.Now().Add(interval)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        do()
        next = next.Add(interval)
        sleep := time.Until(next)
        if sleep < 0 {
            // We are behind; skip ahead.
            skip := (-sleep) / interval
            next = next.Add(skip * interval)
            sleep = time.Until(next)
        }
        timer.Reset(sleep)
    }
}
```

This gives you "average rate matches `interval`" even if individual handlers run long. Use it for sampled metrics where the dashboard divides by number of samples per minute — if the rate drifts, the dashboard reads wrong.

---

## Coalescing Many Tickers Into One

If your service has thousands of long-lived objects each running a periodic task, naive code creates thousands of `time.Ticker`s. Each ticker is a runtime timer entry, one goroutine, and ~5KB of memory. At 10 000 connections you have 10 000 timers, 10 000 goroutines, and the timer heap is doing 10 000 `siftDown` operations every interval. The runtime can handle it — Go's timer scheduler is good — but the cost is real, and the work could be done by one ticker scanning the objects.

### When one ticker is better than many

A useful test: if the objects share an interval and a fairly cheap "what to do per object" operation, coalesce. If each object has a unique interval or expensive per-object work, keep individual tickers.

| Scenario | Coalesce? | Why |
|---|---|---|
| 10 000 websocket connections, all ping every 30 s | Yes | Same interval, cheap per-conn work |
| 100 batch jobs, each runs at its own cron | No | Different intervals; use a min-heap |
| 1000 cache entries, each expires at different time | No | Use `time.AfterFunc` or expiry wheel |
| 50 HTTP idle-connection trackers, all 90 s idle timeout | Yes | Same interval, can scan in one pass |

### Single ticker, many objects

```go
type Connection struct {
    ID       string
    LastSeen time.Time
    OnIdle   func()
}

type ConnPool struct {
    mu    sync.Mutex
    conns map[string]*Connection
}

func (p *ConnPool) SweepIdle(ctx context.Context, idleTimeout, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            p.mu.Lock()
            for id, c := range p.conns {
                if now.Sub(c.LastSeen) > idleTimeout {
                    delete(p.conns, id)
                    go c.OnIdle()
                }
            }
            p.mu.Unlock()
        }
    }
}
```

One ticker, one goroutine, one lock acquisition per interval, scan in O(N). At N=10 000 with interval=30s, the scan takes about 100 µs. That is acceptable; the same N with 10 000 tickers would have ~10 000 µs of timer overhead distributed across the runtime, plus the goroutine memory.

### Timing wheel for many different intervals

If objects expire at varied future times rather than at the same fixed interval, a *timing wheel* is the canonical data structure. Each slot is a bucket of objects expiring in that slot's window; the ticker advances one slot per period.

Go's standard library does not include a timing wheel, but several open-source implementations exist (`github.com/RussellLuo/timingwheel`, `go.uber.org/atomic` lock-free variants). The key trade-off: timing wheels have O(1) expire-now and O(1) schedule but limited time horizon (one wheel cycle). Hierarchical wheels solve the horizon problem at modest extra cost.

A sketch:

```go
type Bucket struct {
    items []func()
}

type Wheel struct {
    interval time.Duration
    slots    []Bucket
    cursor   int
    mu       sync.Mutex
}

func NewWheel(interval time.Duration, slots int) *Wheel {
    return &Wheel{interval: interval, slots: make([]Bucket, slots)}
}

func (w *Wheel) Schedule(delay time.Duration, fn func()) {
    w.mu.Lock()
    defer w.mu.Unlock()
    nSlots := int(delay / w.interval)
    if nSlots >= len(w.slots) {
        nSlots = len(w.slots) - 1
    }
    idx := (w.cursor + nSlots) % len(w.slots)
    w.slots[idx].items = append(w.slots[idx].items, fn)
}

func (w *Wheel) Run(ctx context.Context) error {
    t := time.NewTicker(w.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            w.mu.Lock()
            slot := w.slots[w.cursor]
            w.slots[w.cursor] = Bucket{}
            w.cursor = (w.cursor + 1) % len(w.slots)
            w.mu.Unlock()
            for _, fn := range slot.items {
                go fn()
            }
        }
    }
}
```

This is a single-tick wheel. Hierarchical timing wheels (Kafka uses one, Redis uses one) cascade through multiple wheels with different granularities, achieving years of horizon with constant per-slot work.

### When to stop coalescing

Coalescing is a refactoring. You start with many tickers because they are easier to reason about; you coalesce when measurements say the runtime cost is real. Premature coalescing is its own footgun: you lose per-object cancellation, the lock around the shared structure becomes a hotspot, and a slow function on one object blocks all the others.

Heuristic: do not coalesce until you have > 1000 tickers per process or your timer scheduler shows up in CPU profiles.

---

## Per-Connection Tickers at Scale

A specific high-stakes case: WebSocket or long-lived TCP servers with one ticker per connection (for keep-alive or read-deadline refresh). At 10K connections this is 10K tickers; at 100K it is 100K.

### The problem

```go
func handleConn(conn net.Conn) {
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            if _, err := conn.Write([]byte{0}); err != nil {
                return
            }
        }
    }
}
```

At 100K connections this allocates 100K tickers. The timer heap holds 100K entries, and every 30 seconds the heap performs 100K `runtime.runOneTimer` operations. On a typical box that takes 200–400 ms of CPU per cycle. Not catastrophic, but noticeable; if the keep-alive interval drops to 1 s it becomes catastrophic.

### Solution: shared ticker, bucketed sweeps

Put the connections in N buckets; each bucket has its own ticker offset within the interval. The number of buckets is chosen so each bucket has a manageable number of connections.

```go
type Pinger struct {
    conns   sync.Map // map[*conn]struct{}
    interval time.Duration
    buckets  int
}

func (p *Pinger) Run(ctx context.Context) error {
    sub := p.interval / time.Duration(p.buckets)
    t := time.NewTicker(sub)
    defer t.Stop()
    bucket := 0
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            p.conns.Range(func(k, _ any) bool {
                c := k.(*conn)
                if c.bucket == bucket {
                    if err := c.ping(); err != nil {
                        p.conns.Delete(k)
                    }
                }
                return true
            })
            bucket = (bucket + 1) % p.buckets
        }
    }
}
```

Each connection picks a bucket on creation (`bucket := atomic.AddUint64(&counter, 1) % buckets`). The sweep ticks every `interval/buckets`, processing one bucket per tick. After `buckets` ticks every connection has been pinged once. The work is spread across the interval rather than concentrated at the start.

This is the architecture used by Mosquitto, by NATS for client keep-alive, and by most production WebSocket servers above 50K concurrent connections.

### Buckets vs heap

A counter-argument: the runtime's timer heap already amortises the cost across timers. Why bucket manually? Two reasons.

1. **Heap operations are O(log N)**, not O(1). At 100K connections each `Stop` and `Reset` is ~17 comparisons. With buckets the per-connection cost is O(1).
2. **Locality.** Sweeping connections by bucket touches them in order; the runtime heap touches them in deadline order. For workloads with cache-locality concerns the bucketed sweep wins.

For < 10K connections, the heap is fine. For > 50K, bucketing pays off. The crossover is roughly where the timer heap shows up at > 1% of CPU in a profile.

### Per-connection deadlines without per-connection tickers

Read deadlines deserve special mention. Many TCP servers use `conn.SetReadDeadline(time.Now().Add(timeout))` and renew it on each read. Under the hood, `SetReadDeadline` interacts with the net poller's timer heap, *not* with `time.Ticker`. Each call updates a single timer per connection. This is efficient at 100K+ connections; do not replace it with manual tickers.

The wrong way:

```go
go func() {
    t := time.NewTicker(timeout)
    defer t.Stop()
    select {
    case <-t.C:
        conn.Close()
    case <-doneCh:
    }
}()
```

This creates a goroutine and a ticker per connection just to enforce a deadline that the runtime already enforces natively. Use `conn.SetReadDeadline` and `conn.SetWriteDeadline` instead.

---

## Graceful Shutdown of Ticker-Driven Loops

A ticker-driven loop is a goroutine. It must exit cleanly on shutdown — otherwise the process either leaks goroutines (annoying) or fails to flush state (data loss).

### The canonical pattern

```go
func Run(ctx context.Context) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            doWork()
        }
    }
}
```

Three properties:

1. `defer t.Stop()` runs on every exit path.
2. `ctx.Done()` is the only signal needed; no separate "stop" channel.
3. The function returns an error so the caller knows whether shutdown was clean or aborted.

### Final flush

If the loop maintains buffered state, flush on shutdown.

```go
func Run(ctx context.Context) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    defer flush() // final flush
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            doWork()
        }
    }
}
```

Order matters: `defer t.Stop()` runs after `defer flush()` because defers are LIFO. So the flush sees the ticker still active, which means `doWork()` could still run concurrently if it is in another goroutine — but in this pattern, `doWork` runs from the same loop, so by the time we are in defer-land the loop has exited.

If `doWork` spawns goroutines, you must wait for them:

```go
func Run(ctx context.Context) error {
    var wg sync.WaitGroup
    t := time.NewTicker(interval)
    defer t.Stop()
    defer wg.Wait()
    defer func() {
        // final flush after waiting for all work
        flush()
    }()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            wg.Add(1)
            go func() {
                defer wg.Done()
                doWork()
            }()
        }
    }
}
```

Defer order: `Wait` runs *before* `flush`, ensuring all spawned goroutines have finished before the flush runs. This is the typical pattern for "ticker fires off work asynchronously."

### Shutdown deadlines

`ctx.Err()` returns `context.Canceled` or `context.DeadlineExceeded`. The caller should know which:

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := Run(shutdownCtx); err == context.DeadlineExceeded {
    log.Warn("ticker did not shut down within 30s, forcing exit")
}
```

In the loop, propagate the deadline to per-iteration work:

```go
case <-t.C:
    workCtx, cancel := context.WithTimeout(ctx, interval)
    defer cancel()
    doWork(workCtx)
```

If `ctx` has a shutdown deadline of 30 s and the current time is 28 s in, `workCtx` will have an effective deadline of 30 s (not 28 + interval). The work will be cancelled at shutdown deadline.

### Signal-driven shutdown

Wire SIGTERM and SIGINT to context cancellation:

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()
    if err := Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
        log.Error("run failed", "err", err)
        os.Exit(1)
    }
}
```

`signal.NotifyContext` was added in Go 1.16; it is the canonical way to bind signals to context. Before that you had to write the boilerplate manually.

---

## Testing Ticker-Driven Code

Testing ticker-driven code with real time is slow and flaky. A test that depends on "the ticker fires three times" with a 100ms interval takes 300ms; multiply by hundreds of tests and you have a slow suite. Worse, if your test machine is loaded, the ticker may fire at 110ms, 95ms, 120ms — your assertions need wide tolerances or they will fail intermittently.

The solution is *injectable time*: pass a clock interface into the production code, use the real clock in production, and a fake clock in tests.

### Clock interface

```go
type Clock interface {
    Now() time.Time
    NewTicker(d time.Duration) Ticker
    NewTimer(d time.Duration) Timer
    After(d time.Duration) <-chan time.Time
    Sleep(d time.Duration)
}

type Ticker interface {
    Chan() <-chan time.Time
    Stop()
    Reset(d time.Duration)
}

type Timer interface {
    Chan() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

type realClock struct{}

func (realClock) Now() time.Time                  { return time.Now() }
func (realClock) NewTicker(d time.Duration) Ticker { return realTicker{time.NewTicker(d)} }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }
// etc.
```

Then production code takes a `Clock`:

```go
func Run(ctx context.Context, clk Clock, interval time.Duration, do func()) error {
    t := clk.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.Chan():
            do()
        }
    }
}
```

### Fake clock

The fake clock advances on demand and fires tickers/timers whose deadline has been reached:

```go
type fakeClock struct {
    mu      sync.Mutex
    now     time.Time
    tickers []*fakeTicker
}

type fakeTicker struct {
    clk      *fakeClock
    interval time.Duration
    next     time.Time
    ch       chan time.Time
    stopped  bool
}

func (c *fakeClock) NewTicker(d time.Duration) Ticker {
    c.mu.Lock()
    defer c.mu.Unlock()
    t := &fakeTicker{clk: c, interval: d, next: c.now.Add(d), ch: make(chan time.Time, 1)}
    c.tickers = append(c.tickers, t)
    return t
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    target := c.now
    tickers := append([]*fakeTicker{}, c.tickers...)
    c.mu.Unlock()

    for _, t := range tickers {
        for !t.stopped && !t.next.After(target) {
            select {
            case t.ch <- t.next:
            default: // slot full, drop (matches real ticker)
            }
            t.next = t.next.Add(t.interval)
        }
    }
}
```

In tests:

```go
func TestRun(t *testing.T) {
    clk := newFakeClock(time.Now())
    var calls atomic.Int64
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan error, 1)
    go func() {
        done <- Run(ctx, clk, time.Second, func() { calls.Add(1) })
    }()

    clk.Advance(time.Second)
    clk.Advance(time.Second)
    clk.Advance(time.Second)
    // give the goroutine a chance to process
    time.Sleep(10 * time.Millisecond)
    if got := calls.Load(); got != 3 {
        t.Errorf("got %d calls, want 3", got)
    }
    cancel()
    <-done
}
```

The `time.Sleep(10 * time.Millisecond)` is necessary because `Advance` sends on the channel but the loop goroutine has to schedule to receive. There is no way to wait deterministically without coordinating both sides of the channel.

For a fully deterministic test, use a synchronous "step" model: the test calls `step()`, the production code blocks at a checkpoint, the test asserts state, repeats. That is more invasive and is usually overkill.

### Popular libraries

Three widely used Go libraries:

- `github.com/benbjohnson/clock` — the original fake-clock library; small, focused.
- `github.com/jonboulle/clockwork` — slightly newer, similar API.
- `k8s.io/utils/clock` — used inside Kubernetes; verbose but battle-tested.

The standard library has nothing for this. There is an accepted proposal (`#67434`) to add `testing/synctest` for deterministic concurrency testing, which would make ticker tests trivial. It is experimental in Go 1.24 and 1.25.

### Testing drift correction

A specific test for "loop catches up after slow handler":

```go
func TestRunRateCorrected(t *testing.T) {
    clk := newFakeClock(time.Unix(0, 0))
    var calls []time.Time
    var mu sync.Mutex
    do := func() {
        mu.Lock()
        calls = append(calls, clk.Now())
        mu.Unlock()
    }
    ctx, cancel := context.WithCancel(context.Background())
    go RunRateCorrected(ctx, clk, time.Second, do)

    for i := 0; i < 5; i++ {
        clk.Advance(time.Second)
        time.Sleep(time.Millisecond)
    }
    cancel()
    mu.Lock()
    defer mu.Unlock()
    if len(calls) != 5 {
        t.Fatalf("got %d calls, want 5", len(calls))
    }
    for i := 1; i < len(calls); i++ {
        diff := calls[i].Sub(calls[i-1])
        if diff != time.Second {
            t.Errorf("interval %d: got %v, want 1s", i, diff)
        }
    }
}
```

The test passes if and only if every interval is exactly one second. With a real ticker the assertion would need a tolerance; with a fake clock it is exact.

---

## Production Incident #1: The Stampede at 00:00:00 UTC

### Timeline

A streaming-video platform with 14 000 edge nodes, each running a status-reporter goroutine that ticks every minute and POSTs to a central control plane.

**T-90 days.** Service deployed across the fleet. No jitter. The status-reporter uses `time.NewTicker(time.Minute)` and reports to `https://control.internal/status`.

**T-0.** Every minute at the second boundary, the control plane receives 14 000 POSTs within ~50 ms. The control plane's load balancer handles it; the API servers handle it; the database write-through cache handles it. Everyone is happy.

**T+45 days.** The team adds a new field to the status payload (CPU stats). Mean payload size grows from 1 KB to 3 KB. Per-minute traffic to the control plane goes from 14 MB to 42 MB. Bandwidth is fine. P99 latency creeps from 80 ms to 200 ms.

**T+60 days.** The control plane is moved to a new data center. The new DC has slightly higher disk write latency on the audit log (8 ms vs 2 ms). P99 latency for status reports climbs to 350 ms.

**T+72 days.** During minute boundaries the load balancer's connection pool to one of three API server replicas saturates briefly. Health checks fire; the replica is briefly removed. Traffic shifts to the other two replicas; they saturate. The third replica's health check passes; it is re-added; everyone's load drops; minute ends.

**T+78 days.** Same pattern, but during the saturation, several POSTs time out (10 s client timeout). The retry logic on the edge nodes fires; each node retries with backoff 1s, 2s, 4s. The retries do not align to minute boundaries because they have their own (un-jittered) base time, but they cluster within a few seconds of the original tick. The control plane sees a *second* spike at T+1s, T+2s, T+4s after each minute boundary.

**T+85 days.** The third spike at T+4s overlaps with the next minute's primary spike at T+60s on a slow minute. Effective load doubles for that minute. Two API replicas trip their circuit breakers and shed load. Health checks on the remaining replica fail. The control plane is unreachable. Edge nodes mark themselves "disconnected" and stop serving traffic.

**T+85 days, 02:14 UTC.** Pager goes off.

**T+85 days, 03:30 UTC.** On-call rolls back the new payload field, restoring 1 KB payloads. Control plane recovers in 8 minutes. Edge nodes reconnect.

### Root cause

The platform had 14 000 tickers all firing on the second boundary. The control plane's per-minute capacity was sufficient for the *average* load but not for the *coincident* load. As individual P99 latency grew with payload size, the burst at the second boundary grew too. Eventually the burst exceeded the capacity for a single second and the system failed.

There were three contributing factors:
1. **No jitter.** Every node ticked at the same time.
2. **No load shedding.** The control plane had no per-source rate limit; the burst could not be smoothed.
3. **No backpressure on retries.** Failed POSTs retried at 1s, 2s, 4s, all aligned because each node's base time was equally aligned. Retries amplified the burst.

### Fix

In order of priority:

1. **Add per-node jitter to the ticker start.**
   ```go
   offset := time.Duration(rand.Int63n(int64(time.Minute)))
   time.Sleep(offset)
   t := time.NewTicker(time.Minute)
   ```
   This single change distributed the load uniformly across the minute, reducing peak load by 60×.

2. **Add jitter to retries.**
   ```go
   backoff := time.Duration(rand.Float64() * float64(baseBackoff))
   ```
   No retry spike on top of the primary spike.

3. **Add a rate limit at the control plane.**
   A token bucket per source IP, configured for the average rate × 5 (so brief bursts are fine, sustained bursts are throttled).

4. **Reduce payload size.**
   The new field was 2 KB of CPU stats sampled per status. We changed it to be sent every fifth report, reducing average size back to ~1.4 KB.

### Lessons

- A stampede is invisible until it isn't. Average load looked fine for 70 days.
- The system never failed; the *interaction* between systems failed.
- Jitter is cheap. It should be the default for any periodic operation that crosses a service boundary.
- Retries with backoff but without jitter are nearly as bad as retries without backoff.

### Numbers

| Metric | Before fix | After fix |
|---|---|---|
| Peak QPS at minute boundary | 14 000 | 240 |
| Average QPS | 240 | 240 |
| P99 latency | 350 ms | 90 ms |
| Page rate | 1.4 / week | 0 / quarter |

---

## Production Incident #2: The Quiet Heartbeat

### Timeline

A payments service with a leader-elected job scheduler. The leader runs cleanup tasks; non-leaders heartbeat once per second to the lease store. If the leader does not heartbeat for 5 seconds, a non-leader takes over.

**T-30 days.** Service deployed. Heartbeat loop:
```go
t := time.NewTicker(1 * time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        lease.Renew()
    }
}
```
`lease.Renew()` is an HTTP PUT to the lease store. Typical latency: 5 ms.

**T-25 days.** A new dependency is added: before renewing, the leader checks a global config blob. The check is cached for 10 minutes. On cache miss, the check makes an HTTP call. Typical latency: 50 ms. After cache warms, latency is 1 ms.

**T+0.** Cache invalidation event (a config change). All leaders' caches are flushed simultaneously. First lease renewal after the flush takes 50 ms + 5 ms = 55 ms. Within the second.

**T+0, +1 hour.** During a deploy, the config service is rolling — pods are being replaced. Latency to fetch config spikes to 800 ms intermittently. The lease renew loop spends 800 ms on the config call, then 5 ms on the renew. The next tick has already been delivered, sitting in `t.C`. The loop receives it immediately, takes another 800 ms on the next config call. The loop is now running at 800 ms intervals instead of 1 s, but no heartbeat is dropped.

**T+0, +1 hour 7 minutes.** A particularly slow config fetch takes 5.2 seconds. During this 5.2 seconds, the leader does not renew. The non-leader sees the lease expire and takes over. The original leader finishes its config fetch, sees the lease is gone, panics in `lease.Renew()`, and restarts.

**T+0, +1 hour 9 minutes.** The new leader has the same problem: cache miss, slow config fetch, lease expires. Third leader takes over.

**T+0, +1 hour 12 minutes.** Three leaders later, finally one whose config cache survives the next 5 seconds. The flapping settles. Total downtime: 3 minutes. Cleanup tasks were not run during this time; the next leader catches up.

### Root cause

The heartbeat loop did three things per tick: fetch config (sometimes), check pre-conditions, renew the lease. Under load the first two steps could take longer than the 5-second lease timeout. The loop *did not detect this*. From the loop's perspective each iteration was working. From the lease store's perspective the leader was silent.

Three contributing factors:
1. **Single goroutine for heartbeat and work.** A slow tick in the work blocked the heartbeat.
2. **No deadline on the renew.** A renew that took 4 seconds was indistinguishable from a renew that took 100 ms.
3. **No metric for "time since last successful renew."** Nothing alerted that the leader was within seconds of losing its lease.

### Fix

1. **Decouple heartbeat from work.** Two goroutines: one ticks once per second and renews the lease; one ticks every five seconds and runs the cleanup work. The renew can never wait on the work.

   ```go
   // goroutine 1: heartbeat
   func renewLoop(ctx context.Context) {
       t := time.NewTicker(time.Second)
       defer t.Stop()
       for {
           select {
           case <-ctx.Done():
               return
           case <-t.C:
               rctx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
               err := lease.Renew(rctx)
               cancel()
               if err != nil {
                   leaseFailures.Inc()
               } else {
                   lastRenew.Store(time.Now().UnixNano())
               }
           }
       }
   }

   // goroutine 2: work
   func workLoop(ctx context.Context) {
       t := time.NewTicker(5 * time.Second)
       defer t.Stop()
       for {
           select {
           case <-ctx.Done():
               return
           case <-t.C:
               doCleanup(ctx)
           }
       }
   }
   ```

2. **Renew deadline shorter than tick.** 800 ms timeout on a 1 s interval ensures the renew does not block the next tick.

3. **Alert on time-since-renew.** Prometheus rule: `time() - lease_last_renew_seconds > 3`. Pages at 3 s before the 5 s expiry.

4. **Reduce config cache flush blast radius.** Stagger cache flushes across pods (jitter).

### Numbers

| Metric | Before | After |
|---|---|---|
| Time-to-detect failed lease | 5 s | <1 s |
| Leader churn rate | 1 per week | 0 |
| Failed renew rate | 4% during deploys | <0.1% |

### Lessons

- A heartbeat that depends on something else is not a heartbeat; it is a synchronized vote.
- Always have a hard deadline on the operation that the heartbeat performs.
- Alert before the failure threshold, not after.

---

## Production Incident #3: The Cache Stampede

### Timeline

An ads platform with 800 servers, each running an in-memory cache of "today's eligible campaigns". The cache is refreshed every five minutes from a central API.

**T-180 days.** Service deployed. Refresh loop:
```go
t := time.NewTicker(5 * time.Minute)
defer t.Stop()
for range t.C {
    refresh()
}
```
`refresh()` is a GET to `https://campaigns.internal/eligible`. Latency: 200 ms. Response size: 2 MB.

**T-60 days.** Number of eligible campaigns grows due to a product launch. Response size grows to 18 MB. Refresh latency rises to 1.5 s. Still well under 5 minutes; nobody notices.

**T-30 days.** Campaign count grows further. Response is 45 MB. Latency is 4 s.

**T+0.** Campaign count is now ~150 MB worth of JSON. Per-server refresh takes 9 s. The central API has been serving this load for two months without issue; bandwidth is fine.

**T+0, on the hour.** Every 5 minutes, on the dot, 800 servers fire `refresh()` simultaneously. The central API serves 800 × 150 MB = 120 GB in ~10 seconds. The network link saturates. Half the refreshes time out. Servers retry. The retry succeeds because by the time the retry fires (T+15s), the burst is over.

**T+0, +2 hours.** Some servers, by virtue of GC pauses or scheduling, have drifted such that their tick is at T+30s rather than T+0. They refresh during a quieter moment and succeed. The fleet has split into two groups: aligned and not.

**T+0, +6 hours.** The aligned group's refreshes increasingly fail and retry. Retries push them off-alignment. Over 24 hours the fleet ergodically distributes across the 5-minute window. The problem self-heals.

**T+1 day.** New deploy. All 800 servers restart within a 30-minute window. They all begin refresh loops at roughly the same time. The fleet re-aligns into a stampede. Same incident as T+0.

**T+1 day, +1 hour.** On-call notices a pattern: deploys cause a cache-refresh outage that self-heals.

### Root cause

A periodic refresh with no per-server jitter, where the per-server payload grew to a size that made coincident refreshes saturate the central infrastructure. The system was *not* unstable; it self-healed. But every deploy reset it to the unstable state.

### Fix

Add per-server jitter to the refresh start:

```go
offset := time.Duration(rand.Int63n(int64(5 * time.Minute)))
select {
case <-ctx.Done():
    return
case <-time.After(offset):
}
t := time.NewTicker(5 * time.Minute)
defer t.Stop()
for range t.C {
    refresh()
}
```

This distributes the 800 servers uniformly across the 5-minute window. Peak coincident load is ~13 servers/second instead of 800/instant.

A second fix is needed: the campaign data should be diffed, not refreshed wholesale. The new endpoint `/eligible?since=T` returns only campaigns changed since T. Typical response: 200 KB instead of 150 MB. Per-server latency drops to 80 ms.

### Numbers

| Metric | Before | After jitter | After diff |
|---|---|---|---|
| Coincident refreshes | 800 | 13/sec uniform | 13/sec uniform |
| Bandwidth peak | 120 GB / 10 s | 8 GB / 30 s | 100 MB / 5 min |
| Refresh latency p99 | 9 s | 9 s | 80 ms |
| Refresh success rate | 50% | 100% | 100% |

### Lessons

- A system that self-heals is not a system that is fine.
- Deploys are stampede-generators by default; jitter must be applied to mitigate them.
- Periodic refresh is rarely the right pattern at scale; subscribe + invalidate is better.

---

## Production Incident #4: The Drifting Sampler

### Timeline

A latency-sensitive ML inference service. A profiling subsystem samples CPU usage every 100 ms and writes to a time-series database for capacity planning.

**T-1 year.** Service deployed. Sampler:
```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()
for now := range t.C {
    sample(now)
}
```
`sample()` reads /proc/stat, computes a per-CPU delta, sends to TSDB. Typical duration: 800 µs.

**T-6 months.** Capacity planning notices that average CPU usage shown by the in-process sampler is consistently 3% lower than the value from external monitoring (Node Exporter). The team assumes calibration error and ignores it.

**T-3 months.** A new ML model is rolled out. Inference latency increases from 8 ms p99 to 15 ms p99. The team blames CPU pressure, but the in-process sampler shows CPU at 35%. Plenty of headroom. The team is confused.

**T-30 days.** A correlated incident: traces show that some requests have ~120 ms of unexplained latency. Profiles do not show a hot path. The team adds tracing to the sampler, suspecting it interferes.

**T-30 days, +1 day.** Tracing shows the sampler taking 30 ms occasionally (TSDB tail latency). On those iterations, the sampler does not sleep for 100 ms; it sleeps for 70 ms (because the runtime delivers the next tick "100 ms after the last delivery", but the last delivery was 30 ms ago not 100 ms ago — wait, this is wrong).

Re-reading the Go docs: actually the runtime delivers the next tick "at least 100 ms after the previous tick *was scheduled*", subject to channel send semantics. If the consumer is busy, the next tick is *dropped*. So the sampler should fire less often, not more often.

The actual mechanism: when the sampler takes 30 ms in `sample()`, the next tick from the runtime has already been delivered to `t.C` (the runtime delivers as soon as 100 ms have elapsed, regardless of consumer state). The consumer picks it up immediately on returning to `<-t.C`, with no wait. Effective interval: 70 ms wait + 30 ms work = 100 ms total, but the work was *during* part of what would have been the wait. The sampler's *sample rate* matches the configured 100 ms.

The actual bug: 100 ms is the *runtime* interval. If the runtime is loaded (high goroutine count, GC pressure), tick deliveries can drift later. Over a 24-hour period the sampler's nominal "100 ms" averages 103 ms. This 3% drift means the sampler reports 3% fewer "/proc/stat" reads than wall-clock-actual. Each sample is divided by elapsed *clock* time to get CPU percentage; the division uses `time.Since(lastSample)` rather than the configured interval, so the percentage is correct — but the *count* of samples reported to the TSDB is 3% lower than expected. Dashboards that show "samples per minute" are off.

But more importantly: the sampler's `sample(now)` uses `now` (the runtime tick time) as its timestamp. The runtime tick time drifts by 3% relative to wall clock. Samples reported as "12:34:56.123" are actually closer to "12:34:56.500" in wall clock. When correlated with traces (which use wall clock), the lookup misses the right sample by ~400 ms.

### Root cause

The sampler used `time.Ticker`, whose tick times are on the monotonic clock and drift relative to wall clock. The samples' timestamps did not match wall clock; correlation with externally-clocked data (traces) was off.

### Fix

Replace `time.Ticker` with a wall-clock-aligned timer:

```go
func sampler(ctx context.Context) {
    interval := 100 * time.Millisecond
    next := time.Now().Truncate(interval).Add(interval)
    timer := time.NewTimer(time.Until(next))
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-timer.C:
        }
        sample(next) // use the *deadline*, not time.Now() or runtime tick time
        next = next.Add(interval)
        if time.Now().After(next) {
            skip := time.Now().Sub(next) / interval
            next = next.Add((skip + 1) * interval)
        }
        timer.Reset(time.Until(next))
    }
}
```

Now samples have timestamps that exactly match wall-clock 100-ms boundaries (12:34:56.100, 12:34:56.200, ...), and correlation with traces works.

### Numbers

| Metric | Before | After |
|---|---|---|
| Reported CPU vs Node Exporter | -3% | -0.05% |
| Trace-to-sample correlation hit rate | 65% | 99.5% |
| Sample timestamp jitter | 0 to 5 ms | 0 to 50 µs |

### Lessons

- `time.Ticker` is not a wall-clock periodic; it is a monotonic-clock periodic.
- For anything correlated with external systems, align to wall clock.
- The Go runtime's monotonic clock is not the same as the OS's monotonic clock; they can drift by < 1% under load.

---

## Production Incident #5: The Leaking Ticker

### Timeline

A multi-tenant SaaS where each tenant has a per-request "billing meter" that ticks every second to deduct from a quota.

**T-0.** Service deployed. Per-request handler:
```go
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
    meter := newMeter()
    go meter.Run(r.Context())
    // process request
}

func (m *Meter) Run(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            m.deduct()
        }
    }
}
```

Looks fine. The `defer t.Stop()` runs when `ctx.Done()` fires, which is when the request finishes.

**T+30 days.** Average request duration is 1.8 s. Meters tick once or twice per request. Heap is stable.

**T+45 days.** A new feature adds long-running streaming responses. Some requests last 600 s. Heap grows during long requests; the meter holds references to per-request state.

**T+60 days.** A bug: under certain error paths the request's context is *not* cancelled when the handler returns. The HTTP server's framework times out the underlying connection but does not propagate cancel to the meter's context.

**T+60 days, +1 day.** Meters whose context never cancels run forever. Each leaked meter holds one ticker (runtime timer entry, ~1 KB) and one goroutine (8 KB stack). Per request: ~9 KB.

**T+90 days.** Heap is 12 GB, up from 200 MB baseline. OOMKiller fires on a pod. Pod restarts; heap drops to 200 MB; resumes growth.

**T+91 days.** SRE notices pattern: every pod OOMs every ~30 hours. Heap profile shows 1.4 million `*runtime.timer` entries.

### Root cause

The handler's `r.Context()` is the *request* context, but if the request's framework does not cancel it (because of the streaming + error-path bug), the goroutine waits on a `select` that never fires. The ticker leaks, along with everything it references.

### Fix

Three fixes, applied in order:

1. **Fix the context propagation bug.** Make sure every code path cancels the request context.

2. **Defensively bound the meter goroutine.** Even if context is forgotten, the meter should not live forever.
   ```go
   ctx, cancel := context.WithTimeout(r.Context(), 24*time.Hour)
   defer cancel()
   go meter.Run(ctx)
   ```

3. **Audit all per-request goroutines.** A general policy: any goroutine spawned by a request handler must either (a) be bounded by `r.Context()` AND have its lifetime measured in the same units as the request, or (b) explicitly buffered/managed by a long-lived worker pool.

### Numbers

| Metric | Before | After |
|---|---|---|
| Heap at steady state | 200 MB → 12 GB | 200 MB stable |
| Pod restart frequency | every 30 hours | none unscheduled |
| Active goroutines | grows to 200k | <500 |

### Lessons

- A `defer t.Stop()` is necessary but not sufficient; if the goroutine cannot reach the defer, the timer leaks.
- `r.Context()` is not guaranteed to cancel; frameworks have bugs.
- Per-request goroutines should always have a maximum lifetime, separate from the request's "logical" lifetime.
- Go 1.23's GC-friendly tickers do not save you here; the goroutine is reachable from the runtime's goroutine list, so the ticker is reachable, so it is not collected.

---

## Production Incident #6: The Backpressure Cliff

### Timeline

A logging pipeline. Each app writes to a local Unix socket; a sidecar reads the socket and forwards over the network.

**T-0.** Sidecar started. Two goroutines: a reader (reads from socket, parses, pushes to in-memory queue) and a forwarder (ticks every 100 ms, drains queue, sends batch over network).

```go
// Forwarder
func (f *Forwarder) Run(ctx context.Context) {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            batch := f.queue.drain(maxBatch)
            if len(batch) > 0 {
                f.send(batch)
            }
        }
    }
}
```

Queue capacity: 10 000. `maxBatch`: 500. Send takes ~50 ms.

**T+0, normal load.** App writes 50k logs/sec. Reader fills queue at 50k/sec. Forwarder drains 500/100ms = 5k/sec. Wait, that does not balance.

Actually `maxBatch = 500` but the forwarder can drain *all* queued items up to `maxBatch` per tick. At 50k/sec the queue grows by (50k - 5k)/sec = 45k/sec, hitting capacity in ~220 ms.

The reader does a *blocking* push to the queue (`q.push(item)`, which blocks if full). At capacity, the reader blocks. Backpressure propagates to the socket: the socket buffer fills. App's `write()` blocks. App's request handler blocks. App's overall throughput collapses.

Wait — but the team has been running this for months. So either the load is not actually 50k/sec, or the math is wrong, or there is something I'm missing.

Re-read the code. `maxBatch = 500`. Per tick. 100 ms ticks. So 5000 logs/sec drained. The team measured app log rate at 4000/sec average. Within the drain rate. Bursts up to 8000/sec last < 1 second. Queue absorbs them. System works.

**T+30 days.** A new app feature increases logging rate to 6000/sec sustained. Drain rate (5000/sec) is now less than ingest rate. Queue grows steadily. After ~1.5 seconds it is full.

**T+30 days, +2 minutes.** Reader blocks on push. Socket buffer fills. App's write() blocks. The first request to hit the blocked write times out. Many requests time out.

**T+30 days, +3 minutes.** Apps see write timeouts. Their request handlers fail. Clients retry. The retry rate produces *more* log entries. Log rate jumps to 12 000/sec. The queue stays full forever. Apps are silently degraded.

### Root cause

The forwarder's `maxBatch` of 500 per 100 ms tick = 5000/sec ceiling was below the sustained ingest rate. The queue's "fullness" did not generate an alert because the *forwarder* was not the source of an error. The *apps* failed silently due to the propagated blocked write.

Two contributing factors:
1. **`maxBatch` was a hard limit, not adaptive.** With a slow send, even tighter limits would not have helped; with a faster send, no limit was needed.
2. **No metric on queue depth.** The team only monitored "logs forwarded" (which kept reporting 5000/sec, the maximum) and "send errors" (which stayed at zero).

### Fix

Three changes:

1. **Adaptive batch size.**
   ```go
   if len(batch) > 0 {
       f.send(batch)
       // If we filled the batch, the queue is backed up; drain more aggressively.
       if len(batch) == maxBatch {
           // schedule next drain immediately
           continue
       }
   }
   ```
   Now consecutive ticks chain together if the queue is backed up.

2. **Queue depth metric.**
   ```go
   queueDepth.Set(float64(f.queue.len()))
   ```
   Sampled in the tick loop.

3. **Drop policy at the reader.** If queue is full, drop the *oldest* entry rather than blocking.
   ```go
   if !q.tryPush(item) {
       q.popOldest()
       q.tryPush(item)
       droppedLogs.Inc()
   }
   ```
   We accept that some logs are lost; we do not accept that the app is blocked.

### Numbers

| Metric | Before | After |
|---|---|---|
| Drain rate ceiling | 5000/sec | 50 000/sec adaptive |
| Apps blocked on write | 4–8% during incidents | 0 |
| Logs lost | 0 | 0.3% during bursts |
| Time to detect queue saturation | hours (via secondary effects) | 30 seconds (alert) |

### Lessons

- Hard limits on batch sizes plus a tick interval produce a hard drain-rate ceiling. Make sure the ceiling is above realistic peak ingest.
- Backpressure that propagates from a downstream system to your app is usually worse than dropping data.
- A "successful" pipeline can be silently degraded if the only failure metric is errors.

---

## Production Incident #7: The Reset Race

### Timeline

A scheduler that ran a periodic task. The interval could be changed via an admin API. The scheduler's loop:

```go
type Scheduler struct {
    mu     sync.Mutex
    ticker *time.Ticker
}

func (s *Scheduler) SetInterval(d time.Duration) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.ticker.Reset(d)
}

func (s *Scheduler) Run(ctx context.Context) error {
    s.ticker = time.NewTicker(s.interval)
    defer s.ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-s.ticker.C:
            doWork()
        }
    }
}
```

**T+0, Go 1.14.** Service starts. Admin calls `SetInterval(time.Minute)`. Loop ticks every minute. Works fine for two years.

**T+2 years.** Service upgraded to Go 1.21. Admin sets interval to 5 seconds. Within the first minute, the loop ticks twice in rapid succession: at T+0 and T+0.001s. Admin reports it.

### Root cause

Pre-Go 1.15, `time.Ticker` had no `Reset` method. The change was added in 1.15. Pre-1.23, `Reset` had a documented race:

> Reset stops a ticker and resets its period to the specified duration. The next tick will arrive after the new period elapses. **The behavior of Reset depends on the prior state of the ticker. If the ticker is active, calling Reset adjusts its period; the next tick arrives after the new period. If the ticker has just been stopped, the next tick arrives after the new period; pending ticks may or may not be received.** (Pre-Go 1.23 doc.)

The race: if `Reset(d)` is called while the runtime is in the middle of delivering a tick (in the brief window between the runtime computing "deliver to channel" and the send completing), the tick *already in flight* may still be delivered, then the timer is rescheduled for `now + d`. The loop sees two consecutive ticks.

For Go 1.23+, the runtime fixed this: `Reset` blocks until the timer is fully drained before re-arming, so no in-flight tick is delivered post-reset. Pre-1.23, you had to drain the channel manually:

```go
func (s *Scheduler) SetInterval(d time.Duration) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if !s.ticker.Stop() {
        select {
        case <-s.ticker.C:
        default:
        }
    }
    s.ticker.Reset(d) // not quite right either
}
```

But `time.Ticker.Stop` does not return a value (unlike `time.Timer.Stop`), and `Reset` does not return anything either. The pattern above is the *timer* pattern; for tickers, the documented advice was "live with the double-tick or use a one-shot timer for variable intervals."

The fix is to use a `time.Timer` instead, and reset it explicitly each iteration:

```go
type Scheduler struct {
    mu       sync.Mutex
    interval time.Duration
    timer    *time.Timer
}

func (s *Scheduler) SetInterval(d time.Duration) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.interval = d
    if !s.timer.Stop() {
        select {
        case <-s.timer.C:
        default:
        }
    }
    s.timer.Reset(d)
}

func (s *Scheduler) Run(ctx context.Context) error {
    s.timer = time.NewTimer(s.interval)
    defer s.timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-s.timer.C:
            doWork()
            s.mu.Lock()
            s.timer.Reset(s.interval)
            s.mu.Unlock()
        }
    }
}
```

For Go 1.23+ the ticker-with-reset works correctly; the workaround is unnecessary. But for code that must support older Go versions, use the timer pattern.

### Numbers

Not really an outage; the bug was a customer report. But the customer's scheduler ran a billing job every 5 minutes; two ticks in rapid succession billed twice. Refunds: $12 000.

### Lessons

- Read the docs for the Go version you are running. `Reset` semantics changed between 1.14, 1.15, 1.18, and 1.23.
- If you need to change a ticker's period dynamically, prefer `time.Timer` and re-arm explicitly. The semantics are simpler.
- The Go runtime occasionally has races. Most are minor; this one mattered because it was on a billing path.

---

## Patterns for Distributed Schedulers

When you have a fleet running periodic jobs and you need at most one runner to execute the job at any given time, the local-ticker pattern is not enough. You need distributed coordination.

### Leader-elected ticker

A common pattern: elect a leader (via etcd, consul, ZooKeeper, or a database advisory lock); the leader runs a `time.Ticker` for the job; non-leaders sit idle.

```go
type LeaderJob struct {
    lease  Lease
    interval time.Duration
    do     func(context.Context)
}

func (j *LeaderJob) Run(ctx context.Context) error {
    for {
        if err := j.lease.Acquire(ctx); err != nil {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(time.Second):
                continue
            }
        }
        leaseCtx, cancel := j.lease.Context(ctx)
        j.runAsLeader(leaseCtx)
        cancel()
        // lost lease; loop and try again
    }
}

func (j *LeaderJob) runAsLeader(ctx context.Context) {
    t := time.NewTicker(j.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            j.do(ctx)
        }
    }
}
```

The lease's context is cancelled when the lease is lost (lease renew fails, lease is stolen, lease expires). The leader's ticker stops cleanly. A non-leader takes over; the new leader starts its own ticker; the cycle is unbroken.

### Lease-aware ticker

A variation: the leader runs *only when the lease is held*. If the lease is briefly lost, the ticker pauses; if recovered, resumes.

```go
func (j *LeaderJob) RunPausable(ctx context.Context) error {
    t := time.NewTicker(j.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            if !j.lease.Held() {
                continue
            }
            j.do(ctx)
        }
    }
}
```

The ticker keeps firing; the body only runs when the lease is held. This avoids the cost of restarting the loop on every lease transition, at the cost of a wasted timer entry when the leader is not us.

### Sharded ticker

For "every shard runs its job every 5 minutes, but only one runner per shard":

```go
func (j *LeaderJob) RunSharded(ctx context.Context, shards []string) error {
    for _, shard := range shards {
        shard := shard
        go func() {
            j.RunForShard(ctx, shard)
        }()
    }
    <-ctx.Done()
    return ctx.Err()
}

func (j *LeaderJob) RunForShard(ctx context.Context, shard string) {
    for {
        if err := j.lease.AcquireFor(ctx, shard); err != nil {
            select {
            case <-ctx.Done():
                return
            case <-time.After(time.Second):
                continue
            }
        }
        leaseCtx, cancel := j.lease.Context(ctx)
        j.runShardLoop(leaseCtx, shard)
        cancel()
    }
}

func (j *LeaderJob) runShardLoop(ctx context.Context, shard string) {
    t := time.NewTicker(j.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            j.doForShard(ctx, shard)
        }
    }
}
```

With 100 shards and 50 runners, each runner runs ~2 shards. Failure of one runner causes 2 shards to re-lease elsewhere. Total ticker count: 100 (one per shard, across the fleet).

### Distributed cron

For workloads requiring exactly-once execution per scheduled time across the fleet:

```go
type DistCron struct {
    schedule cron.Schedule
    lockKey  string
    store    KV
    do       func(context.Context)
}

func (c *DistCron) Run(ctx context.Context) error {
    for {
        next := c.schedule.Next(time.Now())
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Until(next)):
        }
        runKey := fmt.Sprintf("%s/%d", c.lockKey, next.Unix())
        if ok, _ := c.store.SetIfNotExists(ctx, runKey, "running", time.Hour); !ok {
            continue // someone else is running this slot
        }
        c.do(ctx)
        c.store.Set(ctx, runKey, "done", 7*24*time.Hour) // retain for audit
    }
}
```

Each scheduled execution time gets a unique key. The runner that wins the `SetIfNotExists` race runs the job; others see the key exists and skip. After execution, the key is updated and retained for 7 days for audit.

This pattern is used by Kubernetes CronJob, by Hashicorp Nomad's periodic dispatcher, and by many in-house schedulers.

---

## Ticker vs Alternatives in Production

When *not* to use `time.Ticker`:

### Use `time.AfterFunc` when…

You need a one-shot callback after some duration. Cheaper than a ticker for one-shot work.

```go
timer := time.AfterFunc(d, func() {
    cleanup()
})
defer timer.Stop()
```

`AfterFunc` runs the callback on its own goroutine. No channel, no select. For "expire this cache entry in 60s" it is the right primitive.

### Use a timing wheel when…

You have thousands of objects with future deadlines, each unique. A timing wheel batches them into slots; one goroutine drains slots on a ticker.

### Use external cron when…

The schedule involves calendar logic: "every Monday at 9 AM", "first business day of month", "every 15 minutes during business hours." Hand-rolled calendar math in Go is fragile. Use a library or an external scheduler.

### Use a system scheduler when…

You need durability across process restart, work to survive crash, OS-level scheduling guarantees, and you do not need per-iteration access to in-memory state. systemd timers, Kubernetes CronJobs, and AWS EventBridge are designed for this.

### Use `context.WithTimeout` when…

You need a deadline for a single operation. Do not use `time.Ticker` to enforce a single deadline.

### Use `for range channel` when…

You are processing a stream of events that happens to be periodic. The events may be triggered by external signals, not by elapsed time. Use a channel that the producer sends to on its own schedule.

### Use a `time.Ticker` when…

You have a long-lived loop, work that runs on a regular interval, and you want backpressure-aware fire-and-forget semantics.

A summary table:

| Use case | Primitive |
|---|---|
| "Every minute, send heartbeat" | `time.Ticker` |
| "After 60s, expire this entry" | `time.AfterFunc` |
| "Every Monday at 9 AM" | external cron |
| "Within 10s, complete this RPC" | `context.WithTimeout` |
| "Process events from this stream" | channel `for range` |
| "Adaptive interval based on load" | `time.Timer` with reset |
| "Wait until N events or 5s" | `time.Timer` with reset |
| "10 000 connections with the same keep-alive interval" | shared `time.Ticker` over a slice |
| "Million cache entries, each expiring" | timing wheel |

---

## Operational Runbook

A condensed runbook for on-call engineers encountering ticker-related issues.

### Symptom: a periodic job stopped running

1. Check `ticker_last_success_timestamp` (or equivalent). When was the last successful tick?
2. Check `ticker_errors_total`. Is the handler erroring?
3. Check `ticker_duration_seconds`. Is the handler slower than the interval?
4. If the process appears alive but the job is silent: take a goroutine dump (`SIGQUIT` or `pprof`); look for the ticker's goroutine. Is it in `select`? Is it blocked in the handler?
5. Check upstream/downstream services. Is something the handler depends on unreachable?

### Symptom: high CPU in the runtime timer code

Stack traces show `runtime.adjustTimers`, `runtime.runOneTimer`, `runtime.siftUpTimer`.

1. Count active tickers via `pprof` heap profile: search for `*time.Ticker`.
2. If count is in the thousands per process, look for per-request or per-connection ticker creation.
3. Coalesce into a shared ticker (see [Coalescing Many Tickers Into One](#coalescing-many-tickers-into-one)).
4. If count is normal but CPU is high: check the timer heap depth. Tens of thousands of `time.AfterFunc` calls without `Stop` accumulate. Check for forgotten `Stop` calls.

### Symptom: heap growing, goroutine count growing

1. Take a goroutine profile.
2. Look for many goroutines blocked at `select`.
3. If the select includes `<-t.C`, you have leaking tickers.
4. Find the parent: who creates the ticker and forgets to `Stop` it?
5. Common offenders: per-request handlers spawning goroutines without bounded context.

### Symptom: bursts at minute/hour boundaries on a downstream service

1. Confirm with a histogram of arrival times mod-60s.
2. If peaked at second boundaries: a fleet of clients is firing un-jittered tickers.
3. Add per-replica jitter on the client side; see [Jittered Tick Across Replicas](#jittered-tick-across-replicas).
4. If you cannot change clients quickly, add server-side smoothing: token bucket per source IP with burst capacity.

### Symptom: occasional double-tick

1. Are you calling `Reset` on a ticker? Pre-1.23 had a race.
2. Switch to `time.Timer` with explicit re-arm.
3. Upgrade to Go 1.23+ if possible.

### Symptom: a job appears to skip ticks

1. Check `ticker_drops_total`. Are drops being recorded?
2. If yes: handler is slower than interval. Either speed it up, parallelize, or accept drops and document.
3. If no: the ticker may be working fine but the symptom is downstream (a destination not receiving updates).

### Symptom: clock-related drift in correlated systems

1. Are you using `time.Ticker` (monotonic) for something correlated with wall-clock-anchored data?
2. Switch to a `time.Timer`-driven loop aligned to wall-clock boundaries; see [Drift Correction and Wall-Clock Alignment](#drift-correction-and-wall-clock-alignment).

---

## Heartbeats at scale: A full implementation

To consolidate, here is a production-quality heartbeat module with jitter, deadlines, backoff, metrics, and graceful shutdown.

```go
// Package heartbeat provides a production-ready heartbeat loop.
package heartbeat

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "math/rand/v2"
    "sync/atomic"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

// Reporter sends a heartbeat. Implementations should be idempotent;
// the loop may retry on transient errors.
type Reporter interface {
    Report(ctx context.Context, payload Payload) error
}

// Payload is the heartbeat content.
type Payload struct {
    NodeID    string
    Sequence  uint64
    Timestamp time.Time
    Healthy   bool
    Stats     map[string]float64
}

// Config tunes the heartbeat loop.
type Config struct {
    NodeID         string
    Interval       time.Duration
    SendTimeout    time.Duration
    JitterFraction float64       // [0,1], fraction of interval randomized at startup
    MaxRetries     int           // per heartbeat
    BackoffBase    time.Duration // first retry waits this long
    BackoffMax     time.Duration // cap on backoff
    HealthCheck    func() bool   // returns true if this node is healthy
    StatsProvider  func() map[string]float64
    Logger         *slog.Logger
}

func (c *Config) defaults() error {
    if c.NodeID == "" {
        return errors.New("heartbeat: NodeID required")
    }
    if c.Interval <= 0 {
        return errors.New("heartbeat: Interval must be positive")
    }
    if c.SendTimeout <= 0 {
        c.SendTimeout = c.Interval / 2
    }
    if c.SendTimeout >= c.Interval {
        return errors.New("heartbeat: SendTimeout must be less than Interval")
    }
    if c.JitterFraction < 0 || c.JitterFraction > 1 {
        return errors.New("heartbeat: JitterFraction must be in [0,1]")
    }
    if c.MaxRetries < 0 {
        return errors.New("heartbeat: MaxRetries must be non-negative")
    }
    if c.BackoffBase <= 0 {
        c.BackoffBase = 50 * time.Millisecond
    }
    if c.BackoffMax <= 0 {
        c.BackoffMax = c.SendTimeout / 2
    }
    if c.HealthCheck == nil {
        c.HealthCheck = func() bool { return true }
    }
    if c.StatsProvider == nil {
        c.StatsProvider = func() map[string]float64 { return nil }
    }
    if c.Logger == nil {
        c.Logger = slog.Default()
    }
    return nil
}

var (
    sentCounter = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "heartbeat_sent_total",
        Help: "Number of successful heartbeats.",
    }, []string{"node"})
    failedCounter = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "heartbeat_failed_total",
        Help: "Number of failed heartbeats after retries.",
    }, []string{"node"})
    droppedCounter = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "heartbeat_dropped_total",
        Help: "Number of ticker drops (handler exceeded interval).",
    }, []string{"node"})
    durationHistogram = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "heartbeat_duration_seconds",
        Help:    "Heartbeat handler duration.",
        Buckets: prometheus.DefBuckets,
    }, []string{"node"})
    lastSuccessGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "heartbeat_last_success_timestamp_seconds",
        Help: "Unix time of last successful heartbeat.",
    }, []string{"node"})
)

// Loop runs the heartbeat loop. It blocks until ctx is cancelled.
type Loop struct {
    cfg      Config
    reporter Reporter
    seq      atomic.Uint64
}

func NewLoop(cfg Config, r Reporter) (*Loop, error) {
    if err := cfg.defaults(); err != nil {
        return nil, err
    }
    return &Loop{cfg: cfg, reporter: r}, nil
}

func (l *Loop) Run(ctx context.Context) error {
    // Initial jitter
    if l.cfg.JitterFraction > 0 {
        maxOffset := time.Duration(float64(l.cfg.Interval) * l.cfg.JitterFraction)
        offset := time.Duration(rand.Int64N(int64(maxOffset)))
        l.cfg.Logger.Debug("heartbeat: initial jitter", "node", l.cfg.NodeID, "offset", offset)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(offset):
        }
    }

    // Send one immediately so consumers see liveness.
    l.sendOne(ctx, time.Now())

    t := time.NewTicker(l.cfg.Interval)
    defer t.Stop()

    last := time.Now()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            gap := now.Sub(last)
            if gap > 2*l.cfg.Interval {
                missed := int(gap/l.cfg.Interval) - 1
                droppedCounter.WithLabelValues(l.cfg.NodeID).Add(float64(missed))
                l.cfg.Logger.Warn("heartbeat: ticks dropped",
                    "node", l.cfg.NodeID,
                    "missed", missed,
                    "gap", gap)
            }
            last = now
            l.sendOne(ctx, now)
        }
    }
}

func (l *Loop) sendOne(ctx context.Context, ts time.Time) {
    start := time.Now()
    defer func() {
        durationHistogram.WithLabelValues(l.cfg.NodeID).Observe(time.Since(start).Seconds())
    }()

    p := Payload{
        NodeID:    l.cfg.NodeID,
        Sequence:  l.seq.Add(1) - 1,
        Timestamp: ts,
        Healthy:   l.cfg.HealthCheck(),
        Stats:     l.cfg.StatsProvider(),
    }

    if err := l.sendWithRetry(ctx, p); err != nil {
        failedCounter.WithLabelValues(l.cfg.NodeID).Inc()
        l.cfg.Logger.Warn("heartbeat: send failed",
            "node", l.cfg.NodeID,
            "seq", p.Sequence,
            "err", err)
        return
    }
    sentCounter.WithLabelValues(l.cfg.NodeID).Inc()
    lastSuccessGauge.WithLabelValues(l.cfg.NodeID).Set(float64(time.Now().Unix()))
}

func (l *Loop) sendWithRetry(ctx context.Context, p Payload) error {
    var lastErr error
    backoff := l.cfg.BackoffBase
    for attempt := 0; attempt <= l.cfg.MaxRetries; attempt++ {
        sendCtx, cancel := context.WithTimeout(ctx, l.cfg.SendTimeout)
        err := l.reporter.Report(sendCtx, p)
        cancel()
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt == l.cfg.MaxRetries {
            break
        }
        jitter := time.Duration(rand.Float64() * float64(backoff))
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff + jitter):
        }
        backoff *= 2
        if backoff > l.cfg.BackoffMax {
            backoff = l.cfg.BackoffMax
        }
    }
    return fmt.Errorf("heartbeat: after %d retries: %w", l.cfg.MaxRetries, lastErr)
}
```

Usage:

```go
loop, err := heartbeat.NewLoop(heartbeat.Config{
    NodeID:         "edge-7a",
    Interval:       30 * time.Second,
    SendTimeout:    5 * time.Second,
    JitterFraction: 1.0, // full interval jitter
    MaxRetries:     3,
    BackoffBase:    100 * time.Millisecond,
    BackoffMax:     2 * time.Second,
    HealthCheck:    func() bool { return server.Healthy() },
    StatsProvider: func() map[string]float64 {
        return map[string]float64{
            "cpu":  cpuUsage(),
            "mem":  memUsage(),
            "rps":  reqsPerSec(),
        }
    },
    Logger: slog.Default(),
}, reporter)
if err != nil {
    log.Fatal(err)
}
if err := loop.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
    log.Error("heartbeat loop ended", "err", err)
}
```

---

## Telemetry flush: A full implementation

```go
// Package telemetry provides a buffered, periodic, observable flush loop.
package telemetry

import (
    "context"
    "errors"
    "log/slog"
    "sync"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

type Event struct {
    Name      string
    Value     float64
    Labels    map[string]string
    Timestamp time.Time
}

type Sink interface {
    Send(ctx context.Context, batch []Event) error
}

type Config struct {
    Interval      time.Duration
    MaxBatchSize  int
    MaxBufferSize int
    SendTimeout   time.Duration
    Logger        *slog.Logger
    Name          string // for metrics
}

func (c *Config) defaults() error {
    if c.Interval <= 0 {
        return errors.New("telemetry: Interval must be positive")
    }
    if c.MaxBatchSize <= 0 {
        c.MaxBatchSize = 500
    }
    if c.MaxBufferSize <= 0 {
        c.MaxBufferSize = 100_000
    }
    if c.SendTimeout <= 0 {
        c.SendTimeout = c.Interval
    }
    if c.Logger == nil {
        c.Logger = slog.Default()
    }
    if c.Name == "" {
        c.Name = "default"
    }
    return nil
}

var (
    recordedCounter = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "telemetry_recorded_total",
        Help: "Events recorded.",
    }, []string{"name"})
    droppedCounter = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "telemetry_dropped_total",
        Help: "Events dropped due to full buffer.",
    }, []string{"name"})
    flushedCounter = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "telemetry_flushed_total",
        Help: "Events flushed to sink.",
    }, []string{"name"})
    flushErrorCounter = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "telemetry_flush_errors_total",
        Help: "Flush errors.",
    }, []string{"name"})
    flushDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "telemetry_flush_duration_seconds",
        Buckets: prometheus.DefBuckets,
    }, []string{"name"})
    bufferGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "telemetry_buffer_size",
        Help: "Current number of events in the buffer.",
    }, []string{"name"})
)

type Flusher struct {
    cfg  Config
    sink Sink

    mu     sync.Mutex
    buffer []Event
    full   chan struct{}
}

func New(cfg Config, sink Sink) (*Flusher, error) {
    if err := cfg.defaults(); err != nil {
        return nil, err
    }
    return &Flusher{
        cfg:    cfg,
        sink:   sink,
        buffer: make([]Event, 0, cfg.MaxBatchSize),
        full:   make(chan struct{}, 1),
    }, nil
}

// Record is the non-blocking producer.
func (f *Flusher) Record(e Event) {
    f.mu.Lock()
    if len(f.buffer) >= f.cfg.MaxBufferSize {
        f.mu.Unlock()
        droppedCounter.WithLabelValues(f.cfg.Name).Inc()
        return
    }
    f.buffer = append(f.buffer, e)
    bufferGauge.WithLabelValues(f.cfg.Name).Set(float64(len(f.buffer)))
    full := len(f.buffer) >= f.cfg.MaxBatchSize
    f.mu.Unlock()
    recordedCounter.WithLabelValues(f.cfg.Name).Inc()
    if full {
        select {
        case f.full <- struct{}{}:
        default:
        }
    }
}

// Run executes the flush loop; blocks until ctx is cancelled.
func (f *Flusher) Run(ctx context.Context) error {
    t := time.NewTicker(f.cfg.Interval)
    defer t.Stop()

    for {
        select {
        case <-ctx.Done():
            // Final flush; use a short deadline.
            fctx, cancel := context.WithTimeout(context.Background(), f.cfg.SendTimeout)
            f.flush(fctx)
            cancel()
            return ctx.Err()
        case <-t.C:
            f.flush(ctx)
        case <-f.full:
            f.flush(ctx)
        }
    }
}

func (f *Flusher) flush(ctx context.Context) {
    f.mu.Lock()
    if len(f.buffer) == 0 {
        f.mu.Unlock()
        return
    }
    // Swap out the buffer; producer continues to append into a new slice.
    batch := f.buffer
    f.buffer = make([]Event, 0, f.cfg.MaxBatchSize)
    bufferGauge.WithLabelValues(f.cfg.Name).Set(0)
    f.mu.Unlock()

    start := time.Now()
    sctx, cancel := context.WithTimeout(ctx, f.cfg.SendTimeout)
    defer cancel()
    err := f.sink.Send(sctx, batch)
    flushDuration.WithLabelValues(f.cfg.Name).Observe(time.Since(start).Seconds())
    if err != nil {
        flushErrorCounter.WithLabelValues(f.cfg.Name).Inc()
        f.cfg.Logger.Warn("telemetry: flush failed",
            "name", f.cfg.Name,
            "events", len(batch),
            "err", err)
        // Drop the batch; do not re-add to buffer (would cause unbounded growth).
        return
    }
    flushedCounter.WithLabelValues(f.cfg.Name).Add(float64(len(batch)))
}
```

Key properties:

- Two flush triggers (size and time) feed into one flush function, which is serialized by the run loop. No concurrent flushes.
- Final flush on shutdown uses `context.Background()` with `SendTimeout` so even after `ctx` is cancelled the buffer is uploaded.
- Failed flush drops the batch. Retrying in-place would grow memory unboundedly under sustained sink failure.

---

## Jittered ticker for a fleet

```go
package fleet

import (
    "context"
    "errors"
    "hash/fnv"
    "math/rand/v2"
    "time"
)

// Jitter returns a stable jitter offset for a given identity within [0, interval).
func Jitter(identity string, interval time.Duration) time.Duration {
    if identity == "" {
        return time.Duration(rand.Int64N(int64(interval)))
    }
    h := fnv.New64a()
    h.Write([]byte(identity))
    return time.Duration(h.Sum64() % uint64(interval))
}

// Run executes do every interval, with an initial offset based on identity.
func Run(ctx context.Context, identity string, interval time.Duration, do func(context.Context, time.Time)) error {
    if interval <= 0 {
        return errors.New("fleet: interval must be positive")
    }
    offset := Jitter(identity, interval)
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(offset):
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            do(ctx, now)
        }
    }
}
```

For a fleet of 1000 instances with `interval = 1 * time.Minute`, the jitter spreads them uniformly across the minute. Hash-based jitter means a given identity always gets the same offset (useful for debugging and predictability), at the cost of two instances with the same identity (which would be a bug) firing together.

If you want pure randomness without identity:

```go
func Jitter(_ string, interval time.Duration) time.Duration {
    return time.Duration(rand.Int64N(int64(interval)))
}
```

---

## Observability: a complete dashboard spec

For each ticker-driven loop, the dashboard should show:

1. **Iteration rate** — `rate(ticker_iterations_total[5m])` — should be approximately `1 / interval`.
2. **Drop rate** — `rate(ticker_drops_total[5m])` — should be near zero.
3. **Drop fraction** — `rate(ticker_drops_total[5m]) / rate(ticker_iterations_total[5m])` — should be < 1%.
4. **Handler duration percentiles** — `histogram_quantile(0.5, rate(ticker_duration_seconds_bucket[5m]))` and p99.
5. **Handler duration vs interval** — both lines on the same chart; if p99 exceeds interval, drops are imminent.
6. **Error rate** — `rate(ticker_errors_total[5m])`.
7. **Time since last success** — `time() - ticker_last_success_timestamp_seconds`.

For a fleet, add:

8. **Per-source distribution of tick start times mod interval** — confirms jitter is working.
9. **Histogram of inter-tick gaps** — confirms the runtime is delivering on time.

A Grafana dashboard with these nine panels covers 99% of ticker-related visibility.

---

## Edge case: clock changes

The system clock can change abruptly due to NTP step, manual operator change, container clock sync, or VM resume. Go's `time.Ticker` uses the monotonic clock, which is *not* affected by wall-clock changes. This is usually what you want.

But the *value* delivered on `t.C` is a `time.Time` with both monotonic and wall readings. The wall reading is the *current* wall clock at delivery, not "the wall clock when the ticker was scheduled." So:

```go
t := time.NewTicker(time.Minute)
tick1 := <-t.C // wall=12:00:00
// NTP steps the clock back by 5 minutes
tick2 := <-t.C // wall=11:56:00, but monotonic-delta from tick1 is still 1m
```

For any logic that uses the wall reading of `tick`, you must tolerate non-monotonic wall progression. For monotonic-only logic, use `time.Since(start)` rather than `tick.Sub(start)` — `time.Since` always uses monotonic deltas.

In production we have seen wall-clock steps from:

- VM live migration (suspended for 200 ms during migration; clock jumps forward 200 ms on resume).
- Daylight saving transitions in containers with mismatched TZ.
- NTP slew vs step under jiggered network conditions.
- Operator running `date -s` on a VM (please do not).

Always assume the wall reading on a ticker value can move both forward and backward in any given iteration.

---

## Edge case: very small intervals

`time.NewTicker(time.Microsecond)` is legal but pathological. The runtime cannot deliver ticks faster than the scheduler quantum (~10 µs on Linux, more under load). Calls to `NewTicker(0)` or `NewTicker(-1)` panic.

For high-frequency periodic work, use a busy-loop with `time.Now()` checks rather than a ticker:

```go
target := time.Now().Add(50 * time.Microsecond)
for time.Now().Before(target) {
    // spin
}
```

Busy-loops are wasteful but precise. Tickers below 100 µs are imprecise and waste timer-heap operations on every tick.

A reasonable lower bound for tickers: 1 ms. Below this, the runtime overhead dominates.

---

## Edge case: very large intervals

`time.NewTicker(24 * time.Hour)` is legal. The runtime timer heap handles it fine. But a single 24-hour ticker has a problem: if the process is paused (debugger, freeze, host suspend) for longer than the interval, you may receive ticks back-to-back when the process resumes.

If you care about wall-clock alignment for very large intervals, use a wall-clock-aligned timer pattern. If you care about durable scheduling that survives process restart, use an external scheduler (cron, Kubernetes CronJob, systemd timer).

A ticker is *in-memory* state. It does not survive a crash. If your business logic requires "this job ran at 03:00 UTC every day", use durable scheduling.

---

## Edge case: ticker in a goroutine spawned from a hot path

```go
func handle(req Request) {
    go func() {
        t := time.NewTicker(time.Second)
        defer t.Stop()
        // ...
    }()
}
```

At 10K RPS, this spawns 10K goroutines per second, each with its own ticker. The runtime can handle it briefly, but if any of these tickers outlive the request, they accumulate.

Avoid creating tickers in hot paths. Either:

1. Use a single shared ticker for all requests.
2. Use `time.AfterFunc` for one-shot deferred work.
3. Use a worker pool with a small pre-allocated number of tickers.

---

## Pattern: scatter-gather with timeout via ticker

For "wait for N responses or T seconds, whichever first":

```go
func ScatterGather(ctx context.Context, n int, timeout time.Duration, send func() <-chan Result) []Result {
    in := send()
    timer := time.NewTimer(timeout)
    defer timer.Stop()
    results := make([]Result, 0, n)
    for len(results) < n {
        select {
        case <-ctx.Done():
            return results
        case <-timer.C:
            return results
        case r, ok := <-in:
            if !ok {
                return results
            }
            results = append(results, r)
        }
    }
    return results
}
```

This is a one-shot timer, not a ticker. The ticker analog would be:

```go
// Wait for N responses, with progress every T seconds.
func ScatterWithProgress(ctx context.Context, n int, progress time.Duration, send func() <-chan Result) []Result {
    in := send()
    t := time.NewTicker(progress)
    defer t.Stop()
    results := make([]Result, 0, n)
    for len(results) < n {
        select {
        case <-ctx.Done():
            return results
        case <-t.C:
            slog.Info("progress", "received", len(results), "expected", n)
        case r, ok := <-in:
            if !ok {
                return results
            }
            results = append(results, r)
        }
    }
    return results
}
```

The ticker drives logging, not the outcome. This is a useful pattern for long-running parallel queries.

---

## Pattern: tickers in fan-out replication

A primary writes events to a log; N replicas consume from the log at their own pace. Each replica's tick drives "read since last cursor":

```go
type Replica struct {
    log    *Log
    cursor uint64
    apply  func(Event)
}

func (r *Replica) Run(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            events, next, err := r.log.ReadSince(ctx, r.cursor, 100)
            if err != nil {
                slog.Warn("replica read", "err", err)
                continue
            }
            for _, e := range events {
                r.apply(e)
            }
            r.cursor = next
        }
    }
}
```

The interval controls maximum staleness. Shorter intervals mean fresher replicas but more reads against the log; for many systems 50 ms to 1 s is a reasonable range.

Adaptive interval: if `ReadSince` returns no events, double the interval (up to a cap); if it returns a full batch (100), halve it. This converges to "tick as fast as the producer is producing."

---

## Pattern: tickers for renewing tokens

OAuth bearer tokens, AWS STS tokens, GCP service-account tokens, Vault leases all expire and must be renewed.

```go
type TokenManager struct {
    fetch  func(context.Context) (Token, time.Duration, error)
    mu     sync.RWMutex
    token  Token
    expiry time.Time
}

func (m *TokenManager) Token() Token {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.token
}

func (m *TokenManager) Run(ctx context.Context) error {
    if err := m.refresh(ctx); err != nil {
        return err
    }
    for {
        // Renew at 70% of remaining TTL, with jitter.
        m.mu.RLock()
        remain := time.Until(m.expiry)
        m.mu.RUnlock()
        wait := remain * 7 / 10
        jitter := time.Duration(rand.Int64N(int64(wait / 10)))
        wait -= jitter
        if wait < 0 {
            wait = 100 * time.Millisecond
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(wait):
        }
        if err := m.refresh(ctx); err != nil {
            slog.Warn("token refresh failed", "err", err)
            // backoff briefly and retry
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(time.Second):
            }
        }
    }
}

func (m *TokenManager) refresh(ctx context.Context) error {
    rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    tok, ttl, err := m.fetch(rctx)
    if err != nil {
        return err
    }
    m.mu.Lock()
    m.token = tok
    m.expiry = time.Now().Add(ttl)
    m.mu.Unlock()
    return nil
}
```

Notice this is *not* a `time.Ticker`. The interval is computed each iteration based on the remaining TTL of the current token. Use `time.After` (cheap, one-shot) or `time.Timer` (reusable).

For pure ticker patterns: use a `time.Ticker` with the renew at 70% of nominal TTL, and refresh fully on failure.

---

## Pattern: tickers vs goroutine-per-task

When you have N items each with its own deadline, two approaches:

**Approach A: one goroutine per item.**

```go
for _, item := range items {
    go func(it Item) {
        select {
        case <-ctx.Done():
        case <-time.After(it.Deadline.Sub(time.Now())):
            process(it)
        }
    }(item)
}
```

Each item: one goroutine, one timer entry. At 100K items: 100K goroutines, 100K timers.

**Approach B: one shared ticker, scan all items.**

```go
go func() {
    t := time.NewTicker(checkInterval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            for _, item := range items {
                if !item.Deadline.After(now) && !item.processed {
                    process(item)
                    item.processed = true
                }
            }
        }
    }
}()
```

One goroutine, one timer, O(N) scan per tick. Granularity is `checkInterval`.

**Approach C: priority queue (min-heap) with one ticker.**

A heap keyed on deadline. The ticker pops items whose deadline has passed.

```go
go func() {
    t := time.NewTicker(checkInterval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            for heap.Len() > 0 && !heap.Peek().Deadline.After(now) {
                item := heap.Pop()
                process(item)
            }
        }
    }
}()
```

O(log N) per pop, O(N) total work per scan if all items expire at once.

Choose A for small N (< 1000). Choose B for moderate N with high check-interval tolerance. Choose C for large N or strict deadline accuracy.

---

## Why the Go 1.23 change matters in production

Pre-1.23, a `*time.Ticker` whose goroutine no longer references it would still keep the underlying runtime timer alive until `Stop` was called. The timer would continue firing, sending values to a channel nobody was reading. The channel buffer was unbounded (a linked list), so memory grew until the program crashed. The runtime had a dedicated goroutine (the timer goroutine) per ticker that called `chansend` non-blocking, but the timer entry itself was a leak.

Go 1.23 changed this:

- The channel `t.C` is now `make(chan Time, 1)` — a buffered channel of size 1. A drop happens at the channel level (non-blocking send fails when the slot is full), not at a runtime queue level. This is observable: programs that relied on pre-1.23 behavior where multiple ticks could accumulate now see them dropped.
- An unreachable `*time.Ticker` can be GC-collected. The runtime no longer needs an explicit `Stop` to release the timer.

What this means for production:

1. **You can drop `defer t.Stop()` calls.** You should not, but if you accidentally do not have one, the leak is gone post-1.23. Older Go versions still leak.
2. **You cannot accumulate ticks anymore.** Code that intentionally relied on "consume ticks faster than once per interval to catch up" no longer works. You can only ever receive the most recent tick.
3. **Buffer-of-one in the channel** means a select that includes `<-t.C` will see a tick if the most recent one has not been consumed yet. If your handler is slow and the runtime tries to deliver a second tick during the handler, that second tick will sit in the channel and be received on the next select iteration. A *third* tick during a slow handler is dropped.

Migrate to Go 1.23+ in production. The improvements are uniformly positive: less memory pressure, simpler reasoning, cleaner shutdown.

---

## Pattern: dynamic interval based on signal

A ticker's interval is fixed at `NewTicker` time. To change it without races, use `Reset` (Go 1.23+) or replace with `time.Timer` and re-arm.

```go
type DynamicLoop struct {
    minInterval, maxInterval time.Duration
    current                  time.Duration
    do                       func(context.Context) (slowDown bool, err error)
    log                      *slog.Logger
}

func (l *DynamicLoop) Run(ctx context.Context) error {
    l.current = l.minInterval
    timer := time.NewTimer(l.current)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        slowDown, err := l.do(ctx)
        switch {
        case err != nil:
            l.current = l.current * 2
            if l.current > l.maxInterval {
                l.current = l.maxInterval
            }
        case slowDown:
            l.current = l.current + l.current/4
            if l.current > l.maxInterval {
                l.current = l.maxInterval
            }
        default:
            l.current = l.current - l.current/8
            if l.current < l.minInterval {
                l.current = l.minInterval
            }
        }
        timer.Reset(l.current)
    }
}
```

This is the AIMD (additive-increase, multiplicative-decrease) pattern, with the addition of error-driven slowdowns. Useful for poll loops where the workload varies (queue depth, message rate, batch size).

---

## Pattern: rate limiter as a ticker

A token bucket can be implemented as a ticker that adds tokens to a buffer:

```go
type TokenBucket struct {
    tokens chan struct{}
}

func NewTokenBucket(ctx context.Context, rate float64, burst int) *TokenBucket {
    tb := &TokenBucket{tokens: make(chan struct{}, burst)}
    for i := 0; i < burst; i++ {
        tb.tokens <- struct{}{}
    }
    interval := time.Duration(float64(time.Second) / rate)
    go func() {
        t := time.NewTicker(interval)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                select {
                case tb.tokens <- struct{}{}:
                default:
                }
            }
        }
    }()
    return tb
}

func (tb *TokenBucket) Acquire(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-tb.tokens:
        return nil
    }
}
```

For high-rate limiters (1000+/sec), this approach has overhead. Use `golang.org/x/time/rate.Limiter`, which is a lock-free token bucket without a ticker.

For rate limiting at the periphery, use the dedicated library. For demonstrating the pattern, the ticker approach is instructive.

---

## Pattern: snapshotting periodic state

If you maintain in-memory counters or buffers and want to snapshot them at intervals for export:

```go
type Snapshotter struct {
    mu       sync.Mutex
    counters map[string]int64
    out      chan map[string]int64
}

func (s *Snapshotter) Inc(name string, delta int64) {
    s.mu.Lock()
    s.counters[name] += delta
    s.mu.Unlock()
}

func (s *Snapshotter) Run(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            s.mu.Lock()
            snapshot := s.counters
            s.counters = make(map[string]int64, len(snapshot))
            s.mu.Unlock()
            select {
            case s.out <- snapshot:
            default:
                slog.Warn("snapshot consumer slow, dropping")
            }
        }
    }
}
```

The snapshot is "reset to zero per interval" — what you usually want for rate metrics. For cumulative counters, copy the map instead of replacing it.

---

## Pattern: ticker-driven cache invalidation

```go
type Cache struct {
    mu    sync.RWMutex
    items map[string]Item
}

func (c *Cache) Sweep(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            c.mu.Lock()
            for k, v := range c.items {
                if v.ExpireAt.Before(now) {
                    delete(c.items, k)
                }
            }
            c.mu.Unlock()
        }
    }
}
```

O(N) sweep per tick. For small caches (< 100K items), interval = 1 s is fine. For larger caches, use a more sophisticated TTL structure (timing wheel, sorted set by expire time).

A common bug: holding the write lock during the entire sweep blocks all reads for the sweep duration. For caches with hot read paths, split into shards or do the sweep in two passes:

```go
func (c *Cache) SweepTwoPass(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            // Pass 1: collect expired keys under read lock.
            c.mu.RLock()
            expired := make([]string, 0, 1024)
            for k, v := range c.items {
                if v.ExpireAt.Before(now) {
                    expired = append(expired, k)
                }
            }
            c.mu.RUnlock()
            if len(expired) == 0 {
                continue
            }
            // Pass 2: delete in batches under write lock.
            for i := 0; i < len(expired); i += 100 {
                end := i + 100
                if end > len(expired) {
                    end = len(expired)
                }
                c.mu.Lock()
                for _, k := range expired[i:end] {
                    if v, ok := c.items[k]; ok && v.ExpireAt.Before(now) {
                        delete(c.items, k)
                    }
                }
                c.mu.Unlock()
            }
        }
    }
}
```

The write lock is held only for batches of 100 deletes. Other goroutines get RW lock windows between batches.

---

## Pattern: hierarchical tickers

A long-period ticker plus a short-period ticker for "do A every 60 s, do B every 1 s":

```go
func RunHierarchical(ctx context.Context, fastDo, slowDo func()) error {
    fast := time.NewTicker(1 * time.Second)
    defer fast.Stop()
    slow := time.NewTicker(60 * time.Second)
    defer slow.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-fast.C:
            fastDo()
        case <-slow.C:
            slowDo()
        }
    }
}
```

If `fastDo` and `slowDo` should never run concurrently (shared state), this is correct: a `select` runs only one case at a time.

If they should run concurrently, spawn each in its own goroutine. But beware: a 60-second ticker firing during a slow `fastDo` is dropped (channel-of-one). For combined coordination, prefer the single-loop pattern.

For more than two intervals, the loop becomes unwieldy. Switch to a scheduler abstraction:

```go
type Job struct {
    Interval time.Duration
    Do       func()
}

func RunMany(ctx context.Context, jobs []Job) error {
    var wg sync.WaitGroup
    for _, j := range jobs {
        j := j
        wg.Add(1)
        go func() {
            defer wg.Done()
            t := time.NewTicker(j.Interval)
            defer t.Stop()
            for {
                select {
                case <-ctx.Done():
                    return
                case <-t.C:
                    j.Do()
                }
            }
        }()
    }
    wg.Wait()
    return ctx.Err()
}
```

One goroutine per job. Each is independent. Stops cleanly on `ctx.Done()`.

---

## Pattern: aggregating across tickers

Multiple tickers feeding into one collector:

```go
type Aggregator struct {
    out chan AggEvent
}

func (a *Aggregator) RunSource(ctx context.Context, source string, interval time.Duration, fetch func() AggEvent) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            ev := fetch()
            ev.Source = source
            select {
            case a.out <- ev:
            case <-ctx.Done():
                return
            }
        }
    }
}

func (a *Aggregator) Run(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case ev := <-a.out:
            a.handle(ev)
        }
    }
}
```

This is the pull model: each source has its own ticker; one consumer drains the merged channel.

---

## Pattern: tickers in tests

A common pattern in tests: "wait until something happens, with a deadline."

```go
func WaitFor(t *testing.T, cond func() bool, timeout time.Duration) {
    t.Helper()
    deadline := time.Now().Add(timeout)
    tick := time.NewTicker(10 * time.Millisecond)
    defer tick.Stop()
    for {
        if cond() {
            return
        }
        if time.Now().After(deadline) {
            t.Fatalf("timeout waiting for condition")
        }
        <-tick.C
    }
}
```

10 ms is a reasonable poll interval for tests. Smaller is wasteful; larger introduces noticeable latency.

For better deterministic tests, use a fake clock and step explicitly. The poll-loop above is a fallback for code that does not accept injected clocks.

---

## Pattern: tickers for gradual rollout

Rolling out a feature flag to 1% of traffic per minute over an hour:

```go
type Rollout struct {
    flag    *FeatureFlag
    target  float64
    current float64
    step    float64
}

func (r *Rollout) Run(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            r.current += r.step
            if r.current > r.target {
                r.current = r.target
            }
            r.flag.SetRatio(r.current)
            if r.current >= r.target {
                return nil
            }
        }
    }
}
```

The ticker drives a smooth ramp. If the rollout is paused (operator intervention), the ticker continues but the ramp is frozen. If aborted, `ctx.Done()` exits cleanly.

---

## Pattern: tickers for periodic GC trigger

In rare cases — services with predictable allocation patterns and tight latency goals — explicitly triggering GC at idle times can help.

```go
func GCSweeper(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            // Trigger GC only if we have grown significantly since last cycle.
            var m runtime.MemStats
            runtime.ReadMemStats(&m)
            if m.HeapInuse > 2*m.HeapTarget {
                runtime.GC()
            }
        }
    }
}
```

Use sparingly. The runtime's adaptive GC is usually better than manual triggers. The exception is "we know the next 500 ms is latency-critical, GC now to start clean."

---

## Pattern: tickers and graceful upgrades

During a rolling deploy, a process should:

1. Receive SIGTERM.
2. Stop accepting new work.
3. Drain in-flight work.
4. Run a final flush of buffered state.
5. Exit.

For ticker-driven loops, step 3 is "let the current iteration finish but do not start another." This is what `ctx.Done()` does.

```go
func Run(ctx context.Context) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            do(ctx) // do() should also respect ctx
        }
    }
}
```

A subtle issue: if `do(ctx)` is mid-execution when `ctx` is cancelled, does it complete? Up to `do`. Best practice is for `do` to check `ctx.Err()` at logical boundaries and bail out cleanly, returning partial work to be retried by the next process.

For work that must complete (writing to durable storage), do not cancel mid-write. Use a separate timeout context for the write call, longer than the shutdown deadline:

```go
case <-t.C:
    workCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    do(workCtx)
    cancel()
```

This decouples the work's deadline from the loop's shutdown signal. The loop exits on `ctx.Done()`, but the in-flight work has 10 seconds to complete.

---

## Production scale: tickers in containerized environments

In Kubernetes, three ticker concerns are amplified:

1. **CPU throttling.** A pod with a CPU limit may be throttled mid-execution. A ticker that fires every 100 ms may not get scheduled until the next quota window (10 ms in Linux CFS), causing apparent drift.

2. **Sidecars and shared timers.** A pod with multiple containers (app + sidecar + service mesh) has multiple tickers competing. Watch for combined timer overhead.

3. **HPA-driven scaling.** When HPA scales up, new replicas all start tickers at roughly the same time, causing aligned bursts. Always jitter.

For 1: avoid setting CPU limits below 1.0 in cores; HPA-driven scaling is preferable to throttling. Document any tickers with sub-100 ms intervals.

For 2: instrument and budget. If app uses 10 ms/sec of timer CPU and sidecar uses 5 ms/sec, that is 1.5% of one core. At scale this is real.

For 3: jitter at startup, always. Combined with HPA, this prevents step-function load on dependencies.

---

## Production scale: tickers in serverless

In Lambda, Cloud Functions, etc., long-lived ticker loops do not exist; the function is invoked per event. Periodic execution is provided by the platform's scheduler (CloudWatch Events, Cloud Scheduler), not by `time.Ticker`.

If your code has both serverless and long-running modes, isolate ticker-driven logic:

```go
// long-running mode
if config.Mode == "daemon" {
    go ticker.Run(ctx)
}

// serverless mode
if config.Mode == "function" {
    handler := func(event Event) { ... }
    runFunctionRuntime(handler)
}
```

Do not run a ticker in a function-as-a-service environment. The runtime kills the process after the response is returned; your ticker is irrelevant. Use the platform's scheduling.

---

## Production scale: tickers in edge environments

In edge networks (CDN nodes, IoT devices, mobile apps), tickers face additional challenges:

- **Variable clock accuracy.** No NTP, or unreliable NTP. Wall-clock alignment is unreliable. Use monotonic.
- **Sleep/wake cycles.** Devices may sleep aggressively. A ticker scheduled to fire in 1 hour may fire 8 hours later if the device slept. Detect long gaps and recover gracefully.
- **Bandwidth constraints.** A ticker that uploads even small payloads matters when bandwidth is precious. Coalesce, compress, batch.

For mobile apps, prefer the OS scheduler (Alarm Manager on Android, Background Tasks on iOS) for any tick longer than a few seconds. They handle sleep/wake correctly.

---

## Production scale: tickers in batch pipelines

Batch jobs (ETL, ingestion, reporting) often have a ticker that emits progress:

```go
func RunBatch(ctx context.Context, input []Item, processItem func(Item)) {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    done := 0
    go func() {
        for now := range t.C {
            slog.Info("progress", "done", done, "total", len(input), "ts", now)
        }
    }()
    for _, item := range input {
        processItem(item)
        done++
    }
}
```

The ticker drives logging, not the work. The goroutine running the ticker is never cancelled in this example — it leaks if `RunBatch` returns before the loop iterates. Fix:

```go
func RunBatch(ctx context.Context, input []Item, processItem func(Item)) {
    progressCtx, cancel := context.WithCancel(ctx)
    defer cancel()
    done := atomic.Int64{}
    go func() {
        t := time.NewTicker(10 * time.Second)
        defer t.Stop()
        for {
            select {
            case <-progressCtx.Done():
                return
            case now := <-t.C:
                slog.Info("progress", "done", done.Load(), "total", len(input), "ts", now)
            }
        }
    }()
    for _, item := range input {
        processItem(item)
        done.Add(1)
    }
}
```

The `cancel()` in defer stops the progress goroutine before `RunBatch` returns. `atomic.Int64` avoids a race on `done`.

---

## Pattern: backpressure with rate-controlled tickers

A producer that should not overwhelm a consumer:

```go
type Pacer struct {
    rate float64
    out  chan Payload
}

func (p *Pacer) Run(ctx context.Context) error {
    interval := time.Duration(float64(time.Second) / p.rate)
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            select {
            case p.out <- nextPayload():
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    }
}
```

The pacer emits one payload per tick. If the consumer is slow (channel full), the pacer waits until either the consumer drains or ctx is cancelled. If the consumer is fast, the pacer is rate-limited.

For an in-process variant, use `golang.org/x/time/rate.Limiter`. For periodic emit with optional bursts, a ticker plus a buffered channel is sufficient.

---

## Pattern: tickers for sliding-window aggregation

```go
type Window struct {
    duration time.Duration
    buckets  int
    counts   []int64
    cursor   int
    mu       sync.Mutex
}

func (w *Window) Inc() {
    w.mu.Lock()
    w.counts[w.cursor]++
    w.mu.Unlock()
}

func (w *Window) Run(ctx context.Context) error {
    bucketSize := w.duration / time.Duration(w.buckets)
    t := time.NewTicker(bucketSize)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            w.mu.Lock()
            w.cursor = (w.cursor + 1) % w.buckets
            w.counts[w.cursor] = 0
            w.mu.Unlock()
        }
    }
}

func (w *Window) Sum() int64 {
    w.mu.Lock()
    defer w.mu.Unlock()
    var total int64
    for _, c := range w.counts {
        total += c
    }
    return total
}
```

A circular buffer of counters; the ticker rotates the cursor and zeroes the new oldest bucket. `Sum` reports the count over the past `duration`.

This is the structure used by many rate limiters (e.g., Stripe's rolling-window approach) and many anomaly detectors.

---

## Pattern: tickers for periodic backups

```go
func RunBackup(ctx context.Context, store Backuper, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            tag := now.UTC().Format("20060102T150405Z")
            if err := store.Backup(ctx, tag); err != nil {
                slog.Error("backup failed", "tag", tag, "err", err)
            }
        }
    }
}
```

Backup is one of those tasks where missing a tick is *not* acceptable. The pattern needs:

1. **Wall-clock alignment** (backups at 03:00 UTC daily, not "every 24 hours since last process start").
2. **Catch-up on missed runs** (if the process was down at 03:00, run on startup).
3. **Lease-based exclusion** (only one replica runs the backup).

A full implementation:

```go
type BackupRunner struct {
    store    Backuper
    lease    Lease
    schedule func(now time.Time) time.Time // returns next scheduled time after now
    log      *slog.Logger
}

func (r *BackupRunner) Run(ctx context.Context) error {
    for {
        // Find the next scheduled time.
        next := r.schedule(time.Now())
        wait := time.Until(next)
        if wait > 0 {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(wait):
            }
        }

        // Acquire lease for this exact slot.
        slotKey := fmt.Sprintf("backup/%d", next.Unix())
        ok, err := r.lease.AcquireSlot(ctx, slotKey, 30*time.Minute)
        if err != nil {
            r.log.Warn("backup lease acquire", "slot", slotKey, "err", err)
            continue
        }
        if !ok {
            r.log.Debug("backup slot taken by another runner", "slot", slotKey)
            continue
        }
        if err := r.store.Backup(ctx, slotKey); err != nil {
            r.log.Error("backup failed", "slot", slotKey, "err", err)
        }
    }
}
```

This is no longer a "time.Ticker" pattern; it is a wall-clock-aligned scheduler with leasing. The ticker shape is gone because the requirements outgrew it. Recognize this transition: when wall-clock alignment + lease + catch-up are all needed, `time.Ticker` is the wrong primitive.

---

## Pattern: tickers for health-check probes

```go
type Probe struct {
    target string
    client *http.Client
}

func (p *Probe) Run(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    consecFails := 0
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            pctx, cancel := context.WithTimeout(ctx, interval/2)
            ok := p.check(pctx)
            cancel()
            if !ok {
                consecFails++
            } else {
                consecFails = 0
            }
            metricProbeStatus.WithLabelValues(p.target).Set(boolFloat(ok))
            metricProbeFails.WithLabelValues(p.target).Set(float64(consecFails))
        }
    }
}

func (p *Probe) check(ctx context.Context) bool {
    req, err := http.NewRequestWithContext(ctx, "GET", p.target, nil)
    if err != nil {
        return false
    }
    resp, err := p.client.Do(req)
    if err != nil {
        return false
    }
    defer resp.Body.Close()
    return resp.StatusCode == http.StatusOK
}
```

`consecFails` is the canonical signal: alert at N consecutive failures, recover at 1 success. Avoid alerting on every transient failure; this generates noise.

---

## Pattern: tickers driving exponential decay

```go
type EMA struct {
    alpha float64
    value atomic.Pointer[float64]
}

func (e *EMA) Observe(x float64) {
    for {
        cur := e.value.Load()
        var next float64
        if cur == nil {
            next = x
        } else {
            next = e.alpha*x + (1-e.alpha)*(*cur)
        }
        if e.value.CompareAndSwap(cur, &next) {
            return
        }
    }
}

func (e *EMA) Decay(ctx context.Context, halfLife time.Duration) error {
    interval := halfLife / 16 // sample 16 times per half-life
    e.alpha = 1 - math.Pow(0.5, float64(interval)/float64(halfLife))
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            e.Observe(0) // decay toward zero if no other observations
        }
    }
}
```

An exponential moving average decayed periodically. Used for "recent activity" scores that fade if no signal arrives.

---

## Pattern: tickers as a watchdog timer

```go
type Watchdog struct {
    last atomic.Int64 // unix nano
    threshold time.Duration
    onTimeout func()
}

func (w *Watchdog) Kick() {
    w.last.Store(time.Now().UnixNano())
}

func (w *Watchdog) Run(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            elapsed := time.Since(time.Unix(0, w.last.Load()))
            if elapsed > w.threshold {
                w.onTimeout()
                return errors.New("watchdog timeout")
            }
        }
    }
}
```

The watched code calls `Kick()` periodically. If `Kick()` is not called within `threshold`, the watchdog fires. Useful for detecting frozen loops.

---

## Pattern: tickers in CLI tools

Long-running CLI tools (e.g., `kubectl logs --follow`, `docker stats`) often have a ticker for output redraw.

```go
func RunStats(ctx context.Context, source <-chan Stat) error {
    t := time.NewTicker(500 * time.Millisecond)
    defer t.Stop()
    var current Stat
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case s := <-source:
            current = s
        case <-t.C:
            redraw(current)
        }
    }
}
```

The redraw is decoupled from the source rate. The screen updates at 500 ms regardless of whether new stats arrive.

---

## Concluding patterns

By now you have seen enough ticker patterns to recognize the structure of a ticker-driven loop and the failure modes that come with it. Five general principles to internalize:

1. **Every ticker is a goroutine + a timer entry.** Account for them.
2. **Every ticker that crosses a service boundary should be jittered.** Stampedes are real.
3. **Every ticker should emit metrics: rate, duration, drops, last-success.** Without these you are flying blind.
4. **Every ticker should have a bounded lifetime.** `defer t.Stop()` and `ctx.Done()`.
5. **When wall-clock alignment matters, do not use `time.Ticker`.** Use a timer-driven loop or an external scheduler.

The most common production mistakes:

- Forgetting `defer t.Stop()` — leaks pre-1.23, still inelegant post-1.23.
- No jitter — stampedes.
- No drop detection — silent partial outages.
- Hand-rolled calendar math — DST bugs.
- Ticker for one-shot work — use `time.AfterFunc` or `time.Timer`.
- Ticker inside per-request goroutine — accumulation under load.

The bigger picture: a ticker is a *commitment* to do something periodically. The commitment is broken by slow handlers, slow downstreams, leaked goroutines, and unaccounted-for clocks. Production-quality ticker code treats the commitment seriously: it measures whether the commitment is being kept, it bounds the cost of keeping it, and it has a defined behaviour when it cannot be kept.

---

## Self-Assessment

- [ ] I can explain how a `time.Ticker` drops ticks when the consumer is slow.
- [ ] I add per-replica jitter to all periodic work that crosses a service boundary.
- [ ] I emit `iterations`, `drops`, `duration`, `errors`, `last_success` metrics for every ticker-driven loop.
- [ ] I know when to use `time.Ticker`, `time.Timer`, `time.AfterFunc`, and an external scheduler.
- [ ] I can implement a wall-clock-aligned periodic loop with `time.Timer`.
- [ ] I bound every per-request goroutine with a `context` deadline independent of the request context.
- [ ] I have read at least one ticker-related postmortem and understand the root cause.
- [ ] I prefer `time.Timer.Reset` over `time.Ticker.Reset` for variable intervals.
- [ ] I avoid `time.After` inside `select` loops; I share a `time.Timer` instead.
- [ ] I test ticker-driven code with an injectable clock, not real time.

---

## Summary

A `time.Ticker` is deceptively simple. In production, three behaviours are inescapable:

1. **Drops are silent.** The channel of one means an overrun handler loses ticks without a signal. Every production ticker must measure drops and either tolerate them (heartbeats), shed work (load shedders), or implement catch-up (billing).

2. **Coordinated tickers create stampedes.** Without jitter, a fleet of N replicas with identical intervals fires identically. Every cross-service ticker must jitter — at startup and ideally per-tick.

3. **Monotonic clocks drift from wall clocks.** A `time.Ticker` measures monotonic intervals. Anything correlated with wall-clock-anchored data (traces, billing, dashboards) must use a wall-clock-aligned loop.

Patterns: heartbeats, telemetry flush, jittered ticks, backpressure handling, observability metrics, drift correction, ticker coalescing, distributed schedulers. Each pattern has earned its place by being the answer to a real outage.

Incidents: the stampede, the quiet heartbeat, the cache stampede, the drifting sampler, the leaking ticker, the backpressure cliff, the reset race. Each describes a real failure mode and the fix.

The ticker is a tool. Used well, it is invisible. Used badly, it is the cause of the page at 3 AM. Master the patterns; learn the incidents; understand the runtime semantics. Then your tickers will be invisible.

---

## Appendix A: Production Incident #8 — The Slow-Loris Heartbeat

### Timeline

A real-time gaming backend. Each game session runs on a single server and posts a heartbeat to a matchmaking coordinator every two seconds. If three consecutive heartbeats are missed, the coordinator marks the session dead and refunds the players' entry fees.

**T-180 days.** Service deployed across 600 game servers. Heartbeat code:
```go
t := time.NewTicker(2 * time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        _, _ = http.Post(coordURL, "application/json", body)
    }
}
```
Note the discarded error from `http.Post`. Also note: no timeout on the HTTP client.

**T-30 days.** A networking change at the cloud provider introduces 100 ms of additional latency between AZs. Heartbeats now take 250 ms typical, 1.5 s p99. Still within the 2 s interval.

**T-0.** A TCP flow between one game server (in AZ-A) and the coordinator (in AZ-C) experiences silent packet loss. The TCP connection's keepalive is 2 hours (default). The `http.Post` call hangs because the TCP stack is patiently retransmitting.

**T+1 hour.** During this hour, the heartbeat goroutine has called `http.Post` once. The post has been hanging the whole time. No new heartbeats have fired because the goroutine is blocked. The ticker has been delivering ticks to a full channel, all silently dropped.

**T+1 hour, +5 seconds.** The coordinator marks this game session dead after 6 s of silence. Refunds processed. Game in progress is terminated. Six players in the match see "Server lost."

**T+1 hour, +6 seconds.** Six angry support tickets.

**T+1 day.** Same pattern: every few hours, one TCP flow goes silent, one game gets killed.

### Root cause

`http.DefaultClient` has no timeout. A hanging socket blocks indefinitely. The heartbeat loop's `<-t.C` never receives because the goroutine is stuck in `http.Post`.

Multiple defects:
1. **No HTTP client timeout.** The blocking syscall is unbounded.
2. **No detection of "we have not posted in N seconds."** The loop did not measure its own progress.
3. **No connection-level keepalive.** TCP would have detected the dead connection within 10 s instead of 2 hours.
4. **Discarded error.** Even if `http.Post` *had* returned, no one would know.

### Fix

Layered changes:

1. **Set HTTP client timeout.**
   ```go
   client := &http.Client{
       Timeout: 1 * time.Second,
       Transport: &http.Transport{
           DialContext: (&net.Dialer{
               Timeout:   500 * time.Millisecond,
               KeepAlive: 5 * time.Second,
           }).DialContext,
           TLSHandshakeTimeout:   500 * time.Millisecond,
           ResponseHeaderTimeout: 500 * time.Millisecond,
       },
   }
   ```
   Now any heartbeat that hangs is aborted after 1 s.

2. **Handle errors.**
   ```go
   resp, err := client.Post(coordURL, "application/json", body)
   if err != nil {
       slog.Warn("heartbeat post", "err", err)
       continue
   }
   resp.Body.Close()
   if resp.StatusCode >= 500 {
       slog.Warn("heartbeat 5xx", "status", resp.StatusCode)
   }
   ```

3. **Self-watchdog.** A separate goroutine that monitors "time since last successful heartbeat."
   ```go
   var lastSuccess atomic.Int64
   go func() {
       wd := time.NewTicker(time.Second)
       defer wd.Stop()
       for {
           select {
           case <-ctx.Done():
               return
           case <-wd.C:
               since := time.Since(time.Unix(0, lastSuccess.Load()))
               if since > 4*time.Second {
                   slog.Error("heartbeat watchdog: stuck", "since", since)
                   panic("heartbeat stuck — fail fast")
               }
           }
       }
   }()
   ```
   `panic` triggers an orderly process restart via the supervisor.

4. **TCP keepalive at 5 s.** Detects dead flows promptly.

### Numbers

| Metric | Before | After |
|---|---|---|
| Heartbeat success rate | 99.8% (but hanging tail) | 99.97% |
| Sessions killed per day | 3-7 | 0 |
| Recovery time from dead TCP | 2 hours | 5 seconds |
| Support tickets | ~25/week | ~2/week |

### Lessons

- A "discarded error" is not a "missing feature"; it is a bug waiting to happen.
- `http.DefaultClient` is fine for one-off scripts. In production, always configure timeouts.
- Watchdog the watchdog: if your heartbeat code can hang, monitor it externally.
- `panic` is a legitimate response to an unrecoverable internal stuck state. It is the only way to ensure the process restarts.

---

## Appendix B: Production Incident #9 — The Aligning Tickers

### Timeline

A multi-region content delivery system. Each region has an independent fleet running periodic cache invalidation against a central origin server. Each fleet was jittered correctly; the problem was inter-fleet.

**T-0.** Three regions: US-EAST, US-WEST, EU. Each runs cache invalidation every 5 minutes with per-replica jitter. Within a region, the load is uniformly distributed across 5 minutes.

**T+90 days.** Engineers notice the origin server has spikes every 5 minutes despite the within-region jitter. The fleet has 200 replicas across all regions, but spikes show ~50 simultaneous requests instead of the expected ~0.67 (200 / 300 seconds).

**T+90 days, +investigation.** All three regions seeded their per-replica jitter from `time.Now().UnixNano() % int64(5*time.Minute)`. The regions deployed at the same exact moment (a coordinated rollout). All replicas across all regions started their jitter calculation from approximately the same nanosecond. The "random" jitter was actually deterministic across regions: every replica with the same modulo-5-minute-component picked the same offset.

Concretely: a replica that started at `t = 14:23:17.412345` picked `jitter = 17.412 seconds modulo 300 = 17.412 seconds`. Another replica in another region that also started at `14:23:17.412345` picked the same.

### Root cause

Using `time.Now().UnixNano()` as a "random" seed produces nearly-identical values on replicas that started in the same nanosecond. The `math/rand` v1 default source is seeded with this; if multiple replicas seed at the same instant, they produce the same sequence.

Go 1.20+ fixed this: the default rand source in `math/rand/v2` is seeded with a process-unique value (uses `runtime` internals). Code that ran on Go 1.19 or earlier with explicit `rand.Seed(time.Now().UnixNano())` was vulnerable.

### Fix

1. **Migrate to `math/rand/v2`.** Default seeding is per-process and uses a strong source.
2. **For deterministic jitter (e.g., hashing on replica ID), hash `hostname + os.Hostname` or some external identity, not the current time.**
   ```go
   import "hash/fnv"
   h := fnv.New64a()
   h.Write([]byte(hostname))
   jitter := time.Duration(h.Sum64() % uint64(interval))
   ```
3. **Verify jitter empirically.** Plot a histogram of "first-tick wall-clock-time mod interval" across the fleet. If you see a peak, the jitter is failing.

### Numbers

After fix: origin server spike at 5-minute boundary went from 50 simultaneous to ~1 simultaneous. Latency p99 at the spike dropped from 800 ms to 90 ms.

### Lessons

- Random is not the same as different. Verify uniformity, do not assume.
- `time.Now().UnixNano()` is a *terrible* random seed at deployment scale.
- For determinism, hash on identity; for randomness, use a strong source.
- Cross-region effects are easy to miss; monitor at the origin, not just within the fleet.

---

## Appendix C: Production Incident #10 — The Phantom Ticker

### Timeline

A large in-memory analytics service. Memory grew slowly over weeks; pods OOMed every 8-12 days; rolling restarts masked the issue.

**T-0.** Heap profile shows 2.4 GB of `*time.Ticker` and friends. The codebase has ~30 places that create a ticker; all have `defer t.Stop()`. Where are these tickers coming from?

**T+1 day investigation.** A grep for `time.NewTicker` shows 31 call sites. One of them is in a generic helper:
```go
func RunPeriodic(d time.Duration, fn func()) func() {
    stop := make(chan struct{})
    t := time.NewTicker(d)
    go func() {
        defer t.Stop()
        for {
            select {
            case <-stop:
                return
            case <-t.C:
                fn()
            }
        }
    }()
    return func() { close(stop) }
}
```
Used as:
```go
stop := RunPeriodic(time.Minute, refreshCache)
// ... stop is supposed to be called on shutdown
```

**T+1 day investigation, continued.** The caller does not store `stop` anywhere. The returned function is discarded.

```go
RunPeriodic(time.Minute, refreshCache) // stop function ignored
```

Every time this is called (on the warm-up code path, which runs per-request for the first 100 requests after a deploy), a new ticker is spawned. There is no way to stop them. They run forever.

Worse: each ticker's `fn` is `refreshCache`, which allocates ~150 KB per call. Over weeks, the heap grows.

### Root cause

A helper API that returns a `stop` closure, used incorrectly. The compiler does not warn about ignoring return values. The author of the helper assumed callers would store and call `stop`; they did not.

### Fix

1. **Audit all `_` and discarded return values for `func()` types that look like stops.**
2. **Change the helper API to require a context.**
   ```go
   func RunPeriodic(ctx context.Context, d time.Duration, fn func()) {
       go func() {
           t := time.NewTicker(d)
           defer t.Stop()
           for {
               select {
               case <-ctx.Done():
                   return
               case <-t.C:
                   fn()
               }
           }
       }()
   }
   ```
   Now there is no "stop" to forget; cancellation flows through context.

3. **Apply a lint rule** for any helper that returns `func()` named like `stop`, `cancel`, `close`. The discard must be explicit.

### Numbers

| Metric | Before | After |
|---|---|---|
| Heap at 7 days uptime | 2.4 GB | 600 MB |
| Active goroutines | 80 000 | 200 |
| Pod OOM frequency | every 8-12 days | none |

### Lessons

- API design matters. A `func()` return that must be called is fragile; pass a `context.Context` instead.
- Discarded return values from "stop" functions are a leak signature. Audit them.
- Helpers that wrap concurrency primitives often hide leaks; review them carefully.

---

## Appendix D: A Comprehensive Ticker Library

For services that use many tickers, factor out a library that enforces the patterns. Here is a sketch.

```go
// Package periodics provides production-quality periodic loops.
package periodics

import (
    "context"
    "errors"
    "fmt"
    "hash/fnv"
    "log/slog"
    "math"
    "math/rand/v2"
    "sync/atomic"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

// Loop is a periodic task driven by a ticker.
type Loop struct {
    // Name identifies this loop in metrics and logs.
    Name string

    // Interval is the base period between iterations.
    Interval time.Duration

    // Jitter is the fraction of Interval [0,1] randomized at startup.
    // Use 1.0 for cross-service tickers; 0.0 for in-process only.
    Jitter float64

    // JitterIdentity, if non-empty, makes jitter deterministic from the identity.
    JitterIdentity string

    // Timeout limits how long Do may run. 0 means no timeout.
    Timeout time.Duration

    // OnDropDetected is called when the runtime drops ticks.
    OnDropDetected func(missed int, gap time.Duration)

    // OnError is called when Do returns an error.
    OnError func(err error)

    // Do is the work performed each iteration.
    Do func(ctx context.Context, now time.Time) error

    // Logger receives structured logs.
    Logger *slog.Logger
}

// Validate checks the loop's configuration.
func (l *Loop) Validate() error {
    if l.Name == "" {
        return errors.New("periodics: Name required")
    }
    if l.Interval <= 0 {
        return errors.New("periodics: Interval must be positive")
    }
    if l.Jitter < 0 || l.Jitter > 1 {
        return errors.New("periodics: Jitter must be in [0,1]")
    }
    if l.Do == nil {
        return errors.New("periodics: Do required")
    }
    return nil
}

var (
    iters = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "periodics_iterations_total",
        Help: "Number of iterations performed.",
    }, []string{"name"})

    drops = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "periodics_drops_total",
        Help: "Number of ticks dropped due to slow handler.",
    }, []string{"name"})

    errs = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "periodics_errors_total",
        Help: "Number of handler errors.",
    }, []string{"name"})

    dur = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "periodics_duration_seconds",
        Help:    "Handler duration.",
        Buckets: prometheus.DefBuckets,
    }, []string{"name"})

    lastOK = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "periodics_last_success_timestamp_seconds",
        Help: "Unix time of last successful iteration.",
    }, []string{"name"})

    intervalGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "periodics_interval_seconds",
        Help: "Configured interval.",
    }, []string{"name"})
)

// computeJitter returns the initial offset for the loop.
func (l *Loop) computeJitter() time.Duration {
    if l.Jitter <= 0 {
        return 0
    }
    maxOffset := time.Duration(float64(l.Interval) * l.Jitter)
    if l.JitterIdentity != "" {
        h := fnv.New64a()
        h.Write([]byte(l.JitterIdentity))
        return time.Duration(h.Sum64() % uint64(maxOffset))
    }
    return time.Duration(rand.Int64N(int64(maxOffset)))
}

// Run executes the loop until ctx is cancelled.
func (l *Loop) Run(ctx context.Context) error {
    if err := l.Validate(); err != nil {
        return err
    }
    if l.Logger == nil {
        l.Logger = slog.Default()
    }
    intervalGauge.WithLabelValues(l.Name).Set(l.Interval.Seconds())

    // Initial jitter
    offset := l.computeJitter()
    if offset > 0 {
        l.Logger.Debug("periodics: initial jitter",
            "name", l.Name, "offset", offset, "interval", l.Interval)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(offset):
        }
    }

    t := time.NewTicker(l.Interval)
    defer t.Stop()

    var last time.Time
    last = time.Now()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            gap := now.Sub(last)
            if gap > 2*l.Interval {
                missed := int(gap/l.Interval) - 1
                drops.WithLabelValues(l.Name).Add(float64(missed))
                if l.OnDropDetected != nil {
                    l.OnDropDetected(missed, gap)
                }
                l.Logger.Warn("periodics: ticks dropped",
                    "name", l.Name, "missed", missed, "gap", gap)
            }
            last = now

            l.runOne(ctx, now)
        }
    }
}

func (l *Loop) runOne(ctx context.Context, now time.Time) {
    workCtx := ctx
    var cancel context.CancelFunc
    if l.Timeout > 0 {
        workCtx, cancel = context.WithTimeout(ctx, l.Timeout)
        defer cancel()
    }
    start := time.Now()
    err := l.Do(workCtx, now)
    dur.WithLabelValues(l.Name).Observe(time.Since(start).Seconds())
    iters.WithLabelValues(l.Name).Inc()
    if err != nil {
        errs.WithLabelValues(l.Name).Inc()
        if l.OnError != nil {
            l.OnError(err)
        } else {
            l.Logger.Warn("periodics: handler error",
                "name", l.Name, "err", err, "duration", time.Since(start))
        }
        return
    }
    lastOK.WithLabelValues(l.Name).Set(float64(time.Now().Unix()))
}

// Group runs multiple loops in parallel and waits for all.
type Group struct {
    Loops []*Loop
}

func (g *Group) Run(ctx context.Context) error {
    if len(g.Loops) == 0 {
        return errors.New("periodics: no loops")
    }
    errCh := make(chan error, len(g.Loops))
    for _, l := range g.Loops {
        l := l
        go func() {
            errCh <- l.Run(ctx)
        }()
    }
    var firstErr error
    for range g.Loops {
        err := <-errCh
        if firstErr == nil && err != nil && !errors.Is(err, context.Canceled) {
            firstErr = err
        }
    }
    return firstErr
}

// Aligned creates a loop that fires at wall-clock boundaries of Interval.
// Returns a wrapper Loop that uses a one-shot timer pattern internally.
type Aligned struct {
    Name     string
    Interval time.Duration
    Timeout  time.Duration
    Do       func(ctx context.Context, scheduled time.Time) error
    Logger   *slog.Logger
}

func (a *Aligned) Run(ctx context.Context) error {
    if a.Logger == nil {
        a.Logger = slog.Default()
    }
    next := time.Now().Truncate(a.Interval).Add(a.Interval)
    timer := time.NewTimer(time.Until(next))
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        workCtx := ctx
        var cancel context.CancelFunc
        if a.Timeout > 0 {
            workCtx, cancel = context.WithTimeout(ctx, a.Timeout)
        }
        err := a.Do(workCtx, next)
        if cancel != nil {
            cancel()
        }
        if err != nil {
            a.Logger.Warn("aligned: handler error",
                "name", a.Name, "scheduled", next, "err", err)
        }
        next = next.Add(a.Interval)
        if now := time.Now(); now.After(next) {
            // Skip past missed ticks.
            skip := now.Sub(next) / a.Interval
            next = next.Add((skip + 1) * a.Interval)
        }
        timer.Reset(time.Until(next))
    }
}

// Adaptive provides AIMD-style interval adjustment.
type Adaptive struct {
    Name    string
    Min     time.Duration
    Max     time.Duration
    Initial time.Duration
    Logger  *slog.Logger
    Do      func(ctx context.Context) (slowDown bool, err error)
}

func (a *Adaptive) Run(ctx context.Context) error {
    if a.Logger == nil {
        a.Logger = slog.Default()
    }
    current := a.Initial
    if current <= 0 {
        current = a.Min
    }
    timer := time.NewTimer(current)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
        }
        slowDown, err := a.Do(ctx)
        switch {
        case err != nil:
            current = time.Duration(math.Min(float64(current)*2, float64(a.Max)))
            a.Logger.Warn("adaptive: backoff on error", "name", a.Name, "interval", current, "err", err)
        case slowDown:
            current = time.Duration(math.Min(float64(current)*5/4, float64(a.Max)))
        default:
            current = time.Duration(math.Max(float64(current)*7/8, float64(a.Min)))
        }
        timer.Reset(current)
    }
}

// PausableLoop is a Loop that can be paused and resumed.
type PausableLoop struct {
    Loop
    paused atomic.Bool
}

func (p *PausableLoop) Pause() {
    p.paused.Store(true)
}

func (p *PausableLoop) Resume() {
    p.paused.Store(false)
}

func (p *PausableLoop) Run(ctx context.Context) error {
    if err := p.Loop.Validate(); err != nil {
        return err
    }
    if p.Loop.Logger == nil {
        p.Loop.Logger = slog.Default()
    }
    t := time.NewTicker(p.Loop.Interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            if p.paused.Load() {
                continue
            }
            p.Loop.runOne(ctx, now)
        }
    }
}
```

Usage:

```go
loops := &periodics.Group{
    Loops: []*periodics.Loop{
        {
            Name:     "heartbeat",
            Interval: 30 * time.Second,
            Jitter:   1.0,
            Timeout:  5 * time.Second,
            Do: func(ctx context.Context, now time.Time) error {
                return reporter.Heartbeat(ctx, now)
            },
        },
        {
            Name:     "cache-sweep",
            Interval: 1 * time.Minute,
            Timeout:  10 * time.Second,
            Do: func(ctx context.Context, now time.Time) error {
                return cache.Sweep(ctx, now)
            },
        },
        {
            Name:     "metrics-flush",
            Interval: 10 * time.Second,
            Timeout:  9 * time.Second,
            Do: func(ctx context.Context, now time.Time) error {
                return flusher.Flush(ctx)
            },
        },
    },
}
if err := loops.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
    log.Error("periodics group failed", "err", err)
}
```

This library encapsulates: jitter, metrics, error handling, timeouts, drop detection. Any new ticker in the codebase uses this; ad-hoc tickers are forbidden by code review.

---

## Appendix E: Performance benchmarks

How expensive is a ticker?

```go
func BenchmarkTickerCreation(b *testing.B) {
    for i := 0; i < b.N; i++ {
        t := time.NewTicker(time.Hour)
        t.Stop()
    }
}

func BenchmarkTickerLifecycle(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            t := time.NewTicker(time.Hour)
            t.Stop()
        }
    })
}

func BenchmarkTickerReceive(b *testing.B) {
    t := time.NewTicker(time.Microsecond)
    defer t.Stop()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        <-t.C
    }
}

func BenchmarkSelectTickerCase(b *testing.B) {
    t := time.NewTicker(time.Hour) // never fires
    defer t.Stop()
    done := make(chan struct{})
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        select {
        case <-t.C:
        case <-done:
        default:
        }
    }
}
```

Typical results on a 2024 server-class machine (Linux 5.x, Go 1.23, 8 cores):

| Benchmark | Result |
|---|---|
| TickerCreation | ~600 ns/op, 200 B/op, 4 allocs/op |
| TickerLifecycle (parallel, 8 cores) | ~80 ns/op |
| TickerReceive (1 µs interval) | ~1100 ns/op (close to interval) |
| SelectTickerCase (no fire) | ~15 ns/op |

Implications:

- Creating a ticker is cheap but not free. Avoid creating in inner loops.
- Receiving a tick has scheduler overhead beyond the interval. Below ~10 µs intervals, ticker scheduling overhead is observable.
- A `select` with a ticker case that does not fire is essentially free.

For services with high ticker churn (creating > 10K tickers/sec), the allocation cost can show in profiles. Pool tickers if you can; better, refactor to not need so many.

---

## Appendix F: Reading a goroutine dump for ticker issues

When investigating a stuck or leaking service, dump goroutines (`SIGQUIT` to a panic-with-stack, or use `pprof.Lookup("goroutine").WriteTo(os.Stderr, 1)`).

Look for these signatures:

**Goroutine blocked on ticker receive:**
```
goroutine 42 [select]:
runtime.gopark(...)
main.runLoop(0xc0000a8000)
    /app/loop.go:25 +0x7e
created by main.start
    /app/main.go:55 +0x108
```
A goroutine in `[select]` state, sitting in your loop's `for { select { ... <-t.C ... } }`. Normal.

**Many similar blocked goroutines:**
If you see hundreds or thousands of goroutines stacked at the same `<-t.C` site, you have a ticker leak. Each one is its own `time.Ticker` instance. Find the spawn site (the "created by" line) and audit the lifetime.

**Goroutine in handler:**
```
goroutine 42 [IO wait, 8 minutes]:
internal/poll.runtime_pollWait(...)
net.(*conn).Read(...)
main.heartbeat(...)
    /app/heartbeat.go:42 +0xb0
created by main.start
    /app/main.go:55 +0x108
```
A goroutine spending 8 minutes in IO. This is the "stuck heartbeat" pattern from Incident #8. The ticker's loop is not blocked at `<-t.C` because the handler is still running.

**Goroutine in runtime timer code:**
```
goroutine 1 [GC worker (idle)]:
runtime.gopark(...)
runtime.gcBgMarkWorker(...)
```
Not a ticker issue. The runtime's GC marker.

```
goroutine 3 [running]:
runtime.runOneTimer(...)
runtime.runtimer(...)
runtime.checkTimers(...)
runtime.findRunnableGCed(...)
```
The runtime is actively running timer code. If this is a persistent state across multiple dumps, the timer heap is large.

Tools like `pprof` (`go tool pprof http://localhost:6060/debug/pprof/goroutine`) make this analysis easier than reading raw dumps. For production debugging, expose pprof unconditionally on a non-public port.

---

## Appendix G: A checklist for code review of ticker-using PRs

When reviewing a PR that adds or modifies a `time.Ticker`:

1. [ ] Is `defer t.Stop()` present on the line after `NewTicker`?
2. [ ] Is the goroutine that runs the ticker bounded by a context?
3. [ ] Does the loop handle `ctx.Done()` in every select?
4. [ ] Is the handler bounded (timeout, cancellation, or self-limit)?
5. [ ] Are tick drops detected/measured/handled?
6. [ ] Is per-replica jitter applied if this ticker crosses a service boundary?
7. [ ] Are metrics emitted (rate, drops, duration, errors, last-success)?
8. [ ] Is there a final-flush or cleanup on shutdown?
9. [ ] If `Reset` is used, is the Go version >= 1.23 or is the Timer pattern used instead?
10. [ ] If the interval is < 100 µs or > 1 hour, is the choice justified?
11. [ ] Is `time.After` *not* used inside a loop's select case?
12. [ ] Are clock semantics (monotonic vs wall) appropriate for the use case?
13. [ ] Is there an integration test that does not depend on real time?

Each "no" answer is a question to ask the author.

---

## Appendix H: Anti-patterns gallery

A collection of common ticker mistakes seen in code reviews.

### Anti-pattern 1: `for range t.C`

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for range t.C {
    work()
}
```
**Problem:** No way to exit the loop cleanly. `ctx.Done()` does not break `for range`.
**Fix:** Use `for { select { case <-ctx.Done(): ...; case <-t.C: ... } }`.

### Anti-pattern 2: `time.After` in loop

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        work()
    }
}
```
**Problem:** Each iteration allocates a new timer; the runtime holds the previous timer until it fires (one second later).
**Fix:** Use `time.NewTicker` once outside the loop.

### Anti-pattern 3: Ticker without Stop in a goroutine

```go
go func() {
    t := time.NewTicker(time.Second)
    for range t.C {
        work()
    }
}()
```
**Problem:** No stop signal. Goroutine and ticker leak.
**Fix:** Pass `ctx`, `defer t.Stop()`, exit on `ctx.Done()`.

### Anti-pattern 4: Blocking inside the select case

```go
for {
    select {
    case <-t.C:
        slowOp() // takes 5 seconds
    }
}
```
**Problem:** During `slowOp`, ticks are dropped. The loop drifts.
**Fix:** Either parallelize, accept drops with monitoring, or use an adaptive interval.

### Anti-pattern 5: Tick to drive single-event work

```go
t := time.NewTicker(deadline)
defer t.Stop()
select {
case <-t.C:
    cleanup()
}
```
**Problem:** Wasteful. A ticker has periodic semantics; a one-shot wait is a timer.
**Fix:** Use `time.AfterFunc` or `time.NewTimer`.

### Anti-pattern 6: Discarded Stop function

```go
RunEvery(time.Second, work) // returns a stop fn that we ignore
```
**Problem:** Ticker leaks; no way to stop.
**Fix:** Capture and call the stop function, or change the API to use `context.Context`.

### Anti-pattern 7: Mutating ticker channel

```go
t := time.NewTicker(time.Second)
close(t.C) // panic at runtime
```
**Problem:** `t.C` is owned by the runtime; closing it panics.
**Fix:** Never close a ticker's channel. Use `t.Stop()` to stop delivery.

### Anti-pattern 8: Receiving from t.C in multiple goroutines

```go
t := time.NewTicker(time.Second)
go consumer(t.C)
go consumer(t.C)
```
**Problem:** Each tick goes to exactly one consumer; you have nondeterministic distribution.
**Fix:** One ticker per consumer, or have one consumer fan-out to others.

### Anti-pattern 9: Ticker for nanosecond precision

```go
t := time.NewTicker(time.Nanosecond)
```
**Problem:** Impossible to deliver. The runtime fires as fast as it can, eating CPU.
**Fix:** Use a busy loop or rethink the requirement.

### Anti-pattern 10: Treating tick value as wall clock

```go
for now := range t.C {
    if now.Hour() == 3 {
        runNightlyJob()
    }
}
```
**Problem:** `now` is the runtime's tick time, which has wall-clock drift over time.
**Fix:** Call `time.Now()` inside the loop for wall-clock decisions, or align to wall clock with `time.Timer`.

---

## Appendix I: Tickers in concurrent data structures

A common pattern in lock-free data structures: a ticker drives periodic cleanup of stale entries.

```go
type ConcurrentMap struct {
    data sync.Map
}

func (m *ConcurrentMap) Sweep(ctx context.Context, ttl time.Duration) error {
    interval := ttl / 4 // sweep four times per TTL window
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            cutoff := now.Add(-ttl)
            m.data.Range(func(k, v any) bool {
                entry := v.(*entry)
                if entry.LastUsed.Load() < cutoff.UnixNano() {
                    m.data.Delete(k)
                }
                return true
            })
        }
    }
}
```

Notes:
- `sync.Map.Range` does not hold a lock; entries can be added/removed during iteration. The sweep tolerates this.
- `entry.LastUsed` is an `atomic.Int64` storing nanoseconds; accessed without locks.
- `interval = ttl/4` is a tradeoff: shorter sweeps catch expirations faster but use more CPU.

For high-throughput maps, the sweep's O(N) cost can dominate. Consider sharded maps where each shard has its own sweep ticker, or use a dedicated expiry-aware structure.

---

## Appendix J: Tickers and OS-level timer pressure

The Go runtime's timer heap is in-process. The OS does not see individual Go timers; it sees one syscall per scheduler quantum to wake the scheduler at the next deadline. So 100 K Go tickers do not directly create 100 K OS timers.

That said, the runtime *does* make a `futex` or `nanosleep` syscall to park threads. Under high timer churn, you can see elevated context-switch rates. Use `perf` or `pidstat` to measure.

On Linux, `CONFIG_HIGH_RES_TIMERS` is enabled by default and provides sub-microsecond precision. On older systems or virtualized environments, the kernel's tick rate (HZ=100, 250, 1000) limits the minimum effective ticker resolution.

Inside containers, the `pids_max` cgroup limit can bite if you spawn thousands of goroutines (one per ticker, say). Each goroutine consumes ~1.6 KB of stack initially. At 100 K goroutines that is 160 MB of stacks. Real but manageable.

---

## Appendix K: Migration guide — from `time.After` to shared timer

Code with `time.After` in loops is one of the most common findings in code reviews:

```go
// Before:
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-inbox:
        handle(msg)
    case <-time.After(idleTimeout):
        keepalive()
    }
}
```

The `time.After` allocates a new timer per iteration. If the loop iterates many times per `idleTimeout`, you accumulate timers awaiting expiry.

Migration:

```go
// After:
timer := time.NewTimer(idleTimeout)
defer timer.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-inbox:
        handle(msg)
        if !timer.Stop() {
            select {
            case <-timer.C:
            default:
            }
        }
        timer.Reset(idleTimeout)
    case <-timer.C:
        keepalive()
        timer.Reset(idleTimeout)
    }
}
```

The pattern: drain the timer's channel if a previous event reset it, then call `Reset`. Skip the drain on Go 1.23+ — the runtime's `Reset` handles it.

For Go 1.23+:

```go
timer := time.NewTimer(idleTimeout)
defer timer.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-inbox:
        handle(msg)
        timer.Reset(idleTimeout) // drains internally
    case <-timer.C:
        keepalive()
        timer.Reset(idleTimeout)
    }
}
```

Cleaner. This is one of the most impactful migrations for hot-loop code. We have seen 10% throughput improvements on services that did `time.After` in tight loops.

---

## Appendix L: Tickers and structured concurrency

Go does not have built-in structured concurrency (where child goroutines are guaranteed to terminate when the parent does). With tickers, this matters: a parent that spawns a ticker-driven goroutine must explicitly coordinate shutdown.

The `errgroup` pattern:

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(parentCtx)
g.Go(func() error {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            if err := work(ctx); err != nil {
                return err
            }
        }
    }
})
g.Go(func() error {
    return otherTask(ctx)
})
return g.Wait()
```

`errgroup.WithContext` cancels the context if any goroutine returns a non-nil error. So if `work` returns an error, the ticker loop returns, cancelling `ctx`, which causes `otherTask` to bail out. Conversely, if `otherTask` fails, the ticker loop exits.

This is the closest pattern to structured concurrency in idiomatic Go. Use `errgroup` for any set of goroutines that should rise and fall together.

---

## Appendix M: Final case study — a 100M event/day pipeline

A real production system: ingests 1200 events/sec from web clients, processes through a chain of stages, writes to durable storage. Multiple tickers throughout:

| Component | Ticker | Interval | Purpose |
|---|---|---|---|
| Ingest | none | — | event-driven |
| Buffer | flush | 100 ms | size-or-time flush |
| Validator | none | — | event-driven |
| Enricher | refresh | 5 min | reload lookup tables |
| Router | rebalance | 30 s | shard reassignment |
| Writer | flush | 1 s | batch writes |
| Writer | rotate | 1 h | log file rotation |
| Health | beat | 5 s | liveness |
| Metrics | flush | 10 s | prometheus push |
| Cleanup | sweep | 5 min | expire stale shard state |

Total: 8 tickers per process. At 6 replicas, 48 tickers. Well within reasonable limits.

What we got right:
- Each ticker has its own metrics.
- Jitter applied to flush (10% of interval, identity-hash-based for stability).
- All loops use the `periodics.Loop` library.
- `defer t.Stop()` and `ctx.Done()` on every loop.
- Wall-clock alignment for the hourly rotation.

What we missed at first:
- The 100 ms buffer flush was not jittered across replicas. At minute boundaries (when downstream Kafka rebalanced), all 6 replicas tried to flush within a few ms. We added 10 ms of jitter.
- The 5 min refresh was synchronized across replicas (deployed at same time, same hash). We added per-replica identity to the hash.
- The metrics flush was synchronized with the Prometheus scrape interval (15 s) by coincidence; sometimes scrapes saw stale data. We changed the flush interval to 7 s (coprime with 15 s).

After: pipeline ran for 18 months without a ticker-related incident. Memory stable; CPU stable; throughput stable.

The lesson: a thoughtful ticker discipline scales. Sloppy ticker code is a recipe for periodic, hard-to-debug failures. The patterns in this document are how we got from "tickers are scary" to "tickers are invisible."

---

## Closing thoughts

`time.Ticker` is a small API and a deep topic. The semantics interact with the Go runtime's scheduler, the OS's timer subsystem, the network's latency distribution, the operating fleet's coordination patterns. Each invariant — channel of one, monotonic clock, runtime delivery — has implications a level or two removed from where you write `time.NewTicker`.

The patterns in this document are not exhaustive. New tickers, new failure modes, new fixes appear regularly. The discipline is to recognize: a ticker is a *commitment*. Commitments must be measured, bounded, and abandoned gracefully. The code that does this looks boring. Boring is what you want at 3 AM.

