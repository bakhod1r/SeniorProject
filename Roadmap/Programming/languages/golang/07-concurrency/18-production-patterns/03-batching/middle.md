---
layout: default
title: Middle
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/middle/
---

# Batching — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap and What This File Adds](#recap-and-what-this-file-adds)
3. [The Production Shutdown Contract](#the-production-shutdown-contract)
4. [Partial Flush Semantics](#partial-flush-semantics)
5. [Retries with Exponential Backoff](#retries-with-exponential-backoff)
6. [Observability: The Four Metrics](#observability-the-four-metrics)
7. [Concurrency: Double-Buffer Pattern](#concurrency-double-buffer-pattern)
8. [Integrating with `database/sql`](#integrating-with-databasesql)
9. [Integrating with `pgx` and `CopyFrom`](#integrating-with-pgx-and-copyfrom)
10. [Integrating with Kafka Producers](#integrating-with-kafka-producers)
11. [Integrating with HTTP Bulk Endpoints](#integrating-with-http-bulk-endpoints)
12. [Per-Tenant Sub-Batchers](#per-tenant-sub-batchers)
13. [Backpressure Composition](#backpressure-composition)
14. [Testing in CI](#testing-in-ci)
15. [Operational Runbook](#operational-runbook)
16. [Common Pitfalls](#common-pitfalls)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

The junior file gave you a working batcher: one goroutine, two triggers, a `Close()` that drains. This file takes that batcher and makes it production-grade. The differences are not about the core algorithm — that is the same nine lines of `select`. The differences are about everything *around* the core: shutdown contracts, error handling, retries, observability, integration with real sinks, composition with backpressure, testing in CI, runbooks.

After this file you will be able to:

- Write a graceful-shutdown contract that bounds drain time and never silently loses data.
- Choose between log-and-drop, retry, dead-letter, and crash policies for failed flushes — and implement each.
- Wire a batcher into `database/sql` multi-row INSERT, `pgx.CopyFrom`, and a Kafka producer with confidence.
- Emit the four metrics every batcher needs and read their values to detect saturation, slowdown, and loss.
- Run flushes concurrently with accumulation using the double-buffer pattern.
- Shard a batcher across tenants and bound per-tenant memory.
- Write deterministic CI tests for shutdown, retry, and partial flush.

You should already have read `junior.md`. If "size trigger", "time trigger", "defensive copy", and "reason-tagged flush" do not ring bells, go back.

---

## Recap and What This File Adds

The junior batcher's shape:

```go
for {
    select {
    case item, ok := <-b.in:
        if !ok { flush("shutdown"); return }
        buf = append(buf, item)
        if len(buf) >= b.maxSize { flush("size") }
    case <-ticker.C:
        flush("time")
    }
}
```

What is missing for production:

1. **Bounded shutdown**: `Close()` can hang forever if the sink is slow. We need a deadline.
2. **Retry policy**: `_ = sink.Write(...)` silently drops errors. We need retries and dead-letters.
3. **Observability**: no metrics. We cannot tell whether the batcher is healthy.
4. **Concurrent flush**: a slow flush stalls accumulation. We can double-buffer.
5. **Real sinks**: the in-memory `Sink` is fine for examples; production batchers integrate with `database/sql`, `pgx`, Kafka, HTTP.
6. **Multi-tenancy**: one batch failing one tenant's row fails the whole batch. We can shard.
7. **Backpressure integration**: producers blocking is one option, but you may need to propagate the signal upstream.
8. **Testing**: timing-based tests are flaky. We need deterministic patterns.
9. **Runbooks**: when something goes wrong, what do you check?

This file works through each.

---

## The Production Shutdown Contract

A junior `Close()` looks like:

```go
func (b *Batcher) Close() {
    close(b.in)
    <-b.done
}
```

It is correct for normal shutdown, but it has no time bound. If the sink hangs, `Close()` hangs. If the orchestrator does not call it, the buffer is lost.

A production `Close()` needs:

- A **deadline** so it cannot hang forever.
- A **bounded flush queue** so the drain itself is bounded.
- An **error return** so the orchestrator knows whether the drain succeeded.
- An **idempotent contract** so calling it twice is safe.

### Shutdown With Deadline

```go
func (b *Batcher) Shutdown(ctx context.Context) error {
    b.closeOnce.Do(func() { close(b.in) })
    select {
    case <-b.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The caller passes a context with a deadline. If the drain takes longer than the deadline, `Shutdown` returns `context.DeadlineExceeded` and the items left in the buffer are *not durable*. The caller has to decide: log and exit (data lost), wait longer, or kill the process.

A typical orchestrator looks like:

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := batcher.Shutdown(ctx); err != nil {
    log.Printf("shutdown timed out: %v (buffer not durable)", err)
}
```

### Telling the Run Loop About the Deadline

The Shutdown context can also propagate into the run loop, so the loop knows to flush *immediately* rather than waiting for the next tick:

```go
type Batcher struct {
    // ...
    shutdownReq chan struct{}
}

func (b *Batcher) Shutdown(ctx context.Context) error {
    b.closeOnce.Do(func() {
        close(b.shutdownReq)
        close(b.in)
    })
    select {
    case <-b.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

In the run loop:

```go
select {
case item, ok := <-b.in:
    // ...
case <-ticker.C:
    flush("time")
case <-b.shutdownReq:
    flush("shutdown_request")
    // continue draining b.in until it is closed
}
```

Now an immediate flush happens when shutdown is requested, even if the timer has not fired. The remaining items continue to drain through the `<-b.in` case.

### What "Drain" Means Precisely

There are three reasonable definitions of "drain":

1. **All buffered items are flushed**: the buffer is empty when `Shutdown` returns.
2. **All in-flight `Add` calls have completed**: producers' calls have returned, and their items are in the buffer or flushed.
3. **All items that *will ever* be added have been flushed**: practically impossible without a fence from upstream.

Production batchers implement #1 (with the deadline cap) and rely on the orchestrator to enforce #2 by stopping upstreams before calling `Shutdown`. The HTTP server `Shutdown(ctx)` does this: it stops accepting new connections and waits for in-flight ones to finish. Then you call the batcher's `Shutdown`.

The dance:

```go
// 1. Stop accepting new work.
srv.Shutdown(ctx)

// 2. Wait for in-flight producers (often done by Shutdown's wait-for-handlers).

// 3. Drain the batcher.
batcher.Shutdown(ctx)

// 4. Exit.
```

If you reverse 1 and 3, the batcher's Shutdown returns but new items arrive after, and the channel is closed, and producers panic. Don't do that.

---

## Partial Flush Semantics

A real production case: the deadline strikes during a flush. What is the state?

- Items already accepted by the sink: durable.
- Items in the batcher's *in-flight batch*: in unknown state. The sink call might have started, might have partially landed, might not have started.
- Items still in the channel: lost (the channel is closed, the loop exited).
- Items still in the buffer slice but not yet handed to the sink: lost.

What you want to log: a tally per state. "On shutdown timeout: 1234 items in unknown state, 56 items lost." That number is what your post-mortem references.

To produce this tally, the batcher must track:

- `enqueued` (total items received from `Add`).
- `flushed_ok` (items the sink accepted with no error).
- `flushed_fail` (items the sink rejected).
- `dropped_on_shutdown` (items in the buffer when the deadline struck).

The difference `enqueued - flushed_ok - flushed_fail - dropped_on_shutdown` should be zero. If it is not, you have a bug somewhere.

### A Partial-Flush-Aware Batcher

```go
type Batcher struct {
    // ...
    metrics struct {
        enqueued           atomic.Int64
        flushedOK          atomic.Int64
        flushedFail        atomic.Int64
        droppedOnShutdown  atomic.Int64
    }
}

func (b *Batcher) Add(item Item) error {
    select {
    case b.in <- item:
        b.metrics.enqueued.Add(1)
        return nil
    case <-b.closeCh:
        return ErrClosed
    }
}

func (b *Batcher) flush(batch []Item, reason string) {
    err := b.sink.Write(context.Background(), batch)
    if err == nil {
        b.metrics.flushedOK.Add(int64(len(batch)))
    } else {
        b.metrics.flushedFail.Add(int64(len(batch)))
        log.Printf("batcher: flush failed reason=%s items=%d err=%v", reason, len(batch), err)
    }
}

func (b *Batcher) run() {
    defer close(b.done)
    buf := make([]Item, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    flushBuf := func(reason string) {
        if len(buf) == 0 {
            return
        }
        batch := make([]Item, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        b.flush(batch, reason)
    }
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                flushBuf("shutdown")
                b.metrics.droppedOnShutdown.Add(int64(len(buf)))
                return
            }
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                flushBuf("size")
            }
        case <-ticker.C:
            flushBuf("time")
        }
    }
}
```

This batcher always returns a clean tally. The post-mortem can answer "where did the missing items go?" precisely.

---

## Retries with Exponential Backoff

The sink returns an error. Now what?

### Decision Tree

1. **Permanent error** (bad payload, schema mismatch, auth failure): retrying does not help. Send to dead-letter or log-and-drop.
2. **Transient error** (network, timeout, downstream restart): retry with backoff.
3. **Throttle response** (downstream says "slow down"): retry with longer backoff; also feed back into upstream rate limiter.
4. **Partial success** (some items accepted, some rejected): retry only the rejected ones, if the sink tells you which.

You can usually tell which by inspecting the error type or HTTP status:

- 5xx, network error, timeout: transient.
- 429: throttle.
- 4xx (other than 429): permanent.
- 200 with per-item rejections: partial.

### The Retry Wrapper

A common pattern is to wrap the sink with a retry layer:

```go
type RetryingSink struct {
    inner     Sink
    maxTries  int
    baseDelay time.Duration
    classify  func(error) Retryability
}

type Retryability int

const (
    Permanent Retryability = iota
    Transient
    Throttle
)

func (r *RetryingSink) Write(ctx context.Context, batch []Item) error {
    var lastErr error
    delay := r.baseDelay
    for try := 0; try < r.maxTries; try++ {
        err := r.inner.Write(ctx, batch)
        if err == nil {
            return nil
        }
        lastErr = err
        kind := r.classify(err)
        if kind == Permanent {
            return err
        }
        // Add jitter to avoid synchronised retry storms.
        sleepFor := delay + time.Duration(rand.Int63n(int64(delay)))
        select {
        case <-time.After(sleepFor):
        case <-ctx.Done():
            return ctx.Err()
        }
        delay *= 2
        if kind == Throttle {
            // Be extra conservative.
            delay *= 2
        }
    }
    return lastErr
}
```

The retry layer is a sink wrapping a sink. The batcher does not know about retries; it just sees a sink that takes longer to return. This is the decorator pattern, and it composes cleanly with rate limiting, circuit breakers, and metrics.

### When to Move Retries Out of the Hot Path

If retries can take seconds, you do not want them blocking the run loop. Move the retry to a separate goroutine:

```go
type Batcher struct {
    // ...
    retryQueue chan []Item
}

// In run:
flushBuf := func(reason string) {
    if len(buf) == 0 {
        return
    }
    batch := make([]Item, len(buf))
    copy(batch, buf)
    buf = buf[:0]
    select {
    case b.retryQueue <- batch:
    default:
        // Retry queue full; drop or block depending on policy.
    }
}

// Separate goroutine:
func (b *Batcher) retryWorker() {
    for batch := range b.retryQueue {
        for try := 0; try < maxTries; try++ {
            if err := b.sink.Write(ctx, batch); err == nil {
                break
            }
            // backoff...
        }
    }
}
```

Now the run loop is decoupled from sink latency. Trade-off: a slow sink causes the retry queue to fill, and you must decide what happens when it fills (the same "block, drop, or grow" question as the input channel).

### Dead-Letter Queue

For permanent errors, you usually want a dead-letter queue (DLQ): a separate sink (often a Kafka topic, S3 bucket, or local disk file) where failed batches go for human or automated review.

```go
type DLQSink struct {
    primary Sink
    dlq     Sink
}

func (d *DLQSink) Write(ctx context.Context, batch []Item) error {
    err := d.primary.Write(ctx, batch)
    if err == nil {
        return nil
    }
    if !isTransient(err) {
        _ = d.dlq.Write(ctx, batch)
        return nil // we are not blocking the upstream; we have stored
    }
    return err
}
```

The DLQ is a critical part of the production design. Without it, permanent errors either get retried forever (clogging the retry queue) or are silently dropped.

---

## Observability: The Four Metrics

Every batcher must emit at least these four metrics. Without them you have a black box.

### 1. Batch Size (Histogram)

`batcher_batch_size_items{name="audit"}`

A histogram of how many items were in each flushed batch. Buckets like `1, 5, 10, 50, 100, 500, 1000, 5000, +Inf`.

What it tells you:

- p99 near `MaxBatchSize`: size trigger is the main driver; downstream is keeping up.
- p99 well below `MaxBatchSize`: time trigger dominates; traffic is low or `MaxBatchSize` is too high.
- p50 unstable: traffic is bursty; consider adaptive sizing.

### 2. Flush Latency (Histogram)

`batcher_flush_duration_seconds{name="audit"}`

A histogram of how long each `sink.Write` call took. Buckets in seconds: `0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, +Inf`.

What it tells you:

- p50 stable, p99 spiky: occasional slow downstream calls; investigate the long tail.
- p50 rising: downstream is getting slower over time; consider scaling downstream.
- p99 > `maxDelay`: the time trigger may fire while a flush is in progress; expect backpressure on producers.

### 3. Flush Reason (Counter)

`batcher_flush_total{name="audit", reason="size"}`
`batcher_flush_total{name="audit", reason="time"}`
`batcher_flush_total{name="audit", reason="shutdown"}`

A counter for each flush, labelled by reason. Increment on every flush.

What it tells you:

- All `size`: high traffic; throughput-saturated.
- All `time`: low traffic; latency-dominant.
- Mix: healthy operating zone.
- Many `shutdown`: lots of restarts; investigate process churn.

### 4. Queue Depth (Gauge)

`batcher_queue_depth{name="audit"}`

The current number of items in the input channel (`len(b.in)`).

What it tells you:

- Near zero: consumer keeps up.
- Near cap: backpressure on producers.
- At cap: producers blocked.

### How to Wire Them Up With Prometheus

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    batchSize = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name: "batcher_batch_size_items",
        Help: "Number of items in each flushed batch.",
        Buckets: []float64{1, 5, 10, 50, 100, 500, 1000, 5000, 10000},
    }, []string{"name"})

    flushDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name: "batcher_flush_duration_seconds",
        Help: "Duration of each flush call.",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
    }, []string{"name", "result"})

    flushTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "batcher_flush_total",
        Help: "Total flushes, labelled by reason.",
    }, []string{"name", "reason"})

    queueDepth = prometheus.NewGaugeVec(prometheus.GaugeOpts{
        Name: "batcher_queue_depth",
        Help: "Current input channel depth.",
    }, []string{"name"})
)

func init() {
    prometheus.MustRegister(batchSize, flushDuration, flushTotal, queueDepth)
}
```

In the flush:

```go
flushBuf := func(reason string) {
    if len(buf) == 0 {
        return
    }
    batch := make([]Item, len(buf))
    copy(batch, buf)
    buf = buf[:0]
    flushTotal.WithLabelValues(b.name, reason).Inc()
    batchSize.WithLabelValues(b.name).Observe(float64(len(batch)))
    start := time.Now()
    err := b.sink.Write(context.Background(), batch)
    result := "ok"
    if err != nil {
        result = "error"
    }
    flushDuration.WithLabelValues(b.name, result).Observe(time.Since(start).Seconds())
}
```

And update queue depth periodically (from the run loop on every iteration, or from a separate goroutine):

```go
queueDepth.WithLabelValues(b.name).Set(float64(len(b.in)))
```

Optional fifth metric: `batcher_dropped_total{name, reason}` if your batcher drops on overflow. Always emit if you drop.

### Reading the Metrics

A healthy batcher has:

- `batch_size_items{name}` p50 between 0.1x and 0.5x of `MaxBatchSize`.
- `flush_duration_seconds{name}` p99 below `maxDelay`.
- `flush_total{name, reason}` showing both `size` and `time`, neither at 100%.
- `queue_depth{name}` p99 below 50% of channel capacity.

Any one of these going out of range is worth an alert.

---

## Concurrency: Double-Buffer Pattern

In the junior batcher, the flush is synchronous. While the run loop is in `sink.Write`, new items pile up in the input channel. If the sink is slow and traffic is high, producers block.

The double-buffer pattern allows the run loop to start a new batch while the previous one is being flushed:

```go
type Batcher struct {
    in       chan Item
    sink     Sink
    maxSize  int
    maxDelay time.Duration
    flushReq chan []Item // batches handed off to the flush worker
    done     chan struct{}
}

func (b *Batcher) flushWorker() {
    for batch := range b.flushReq {
        _ = b.sink.Write(context.Background(), batch)
    }
}

func (b *Batcher) run() {
    defer close(b.done)
    buf := make([]Item, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    handoff := func(reason string) {
        if len(buf) == 0 {
            return
        }
        batch := make([]Item, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        b.flushReq <- batch
    }
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                handoff("shutdown")
                close(b.flushReq)
                return
            }
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                handoff("size")
            }
        case <-ticker.C:
            handoff("time")
        }
    }
}
```

The flush worker (or a small pool of them) drains `flushReq` independently. The run loop hands off the batch and immediately starts a new one.

Trade-offs:

- **Pro**: higher throughput when the sink is slow.
- **Pro**: latency is bounded by `maxDelay + handoff_latency`, regardless of sink latency.
- **Con**: the `flushReq` channel can fill, applying backpressure differently. Decide on its cap and policy.
- **Con**: ordering is less obvious; multiple batches may be in flight.
- **Con**: more memory; two batches' worth of items can be in transit.

### Sizing the Flush Queue

If your sink has tail latency of 1 s and your size-trigger rate is 100 per second, you need `flushReq` cap of at least 100 to avoid blocking the run loop during a 1 s tail event. Pick a number, observe `len(flushReq)`, tune.

### Multiple Flush Workers

If your sink is partitioned (multiple Postgres replicas, multiple Kafka brokers), you can have multiple flush workers:

```go
for i := 0; i < numWorkers; i++ {
    go b.flushWorker()
}
```

All workers drain the same `flushReq` channel. Each takes the next available batch. Now you can saturate a multi-broker downstream.

Caveat: ordering across workers is undefined. If your sink requires per-key ordering (Kafka with a key), use one worker per key or partition.

---

## Integrating with `database/sql`

### Multi-Row INSERT

The classic Postgres batch insert:

```sql
INSERT INTO events (user_id, action, ts) VALUES
  ($1, $2, $3),
  ($4, $5, $6),
  ($7, $8, $9),
  ...
```

In Go:

```go
type SQLSink struct {
    db *sql.DB
}

func (s *SQLSink) Write(ctx context.Context, batch []Event) error {
    if len(batch) == 0 {
        return nil
    }
    args := make([]any, 0, len(batch)*3)
    placeholders := make([]string, 0, len(batch))
    for i, e := range batch {
        base := i * 3
        placeholders = append(placeholders,
            fmt.Sprintf("($%d, $%d, $%d)", base+1, base+2, base+3))
        args = append(args, e.UserID, e.Action, e.Timestamp)
    }
    query := "INSERT INTO events (user_id, action, ts) VALUES " +
        strings.Join(placeholders, ",")
    _, err := s.db.ExecContext(ctx, query, args...)
    return err
}
```

### Pitfalls

- **Parameter limit**: PostgreSQL has a 65535 parameter limit per query. If `batch_size * cols_per_row > 65535`, the query is rejected. For 3-column rows, that is 21845 rows max. Stay well below — 1000 is typical.
- **Query plan cache thrash**: if `len(batch)` varies wildly, every batch is a "new" query as far as the plan cache is concerned. Either prepared statements per size bucket, or always pad to a fixed size.
- **Transaction overhead**: by default, each `ExecContext` is its own transaction. Group into one transaction only if you need atomicity across batches.
- **MySQL has a different `max_allowed_packet` limit**: 64 MB by default. Big batches can hit it.

### Prepared Statements

For repeated batches of the same size:

```go
type SQLSink struct {
    db   *sql.DB
    stmt *sql.Stmt // prepared for a specific batch size
    size int
}

func NewSQLSink(db *sql.DB, batchSize int) (*SQLSink, error) {
    placeholders := make([]string, batchSize)
    for i := 0; i < batchSize; i++ {
        base := i * 3
        placeholders[i] = fmt.Sprintf("($%d, $%d, $%d)", base+1, base+2, base+3)
    }
    query := "INSERT INTO events (user_id, action, ts) VALUES " +
        strings.Join(placeholders, ",")
    stmt, err := db.Prepare(query)
    if err != nil {
        return nil, err
    }
    return &SQLSink{db: db, stmt: stmt, size: batchSize}, nil
}

func (s *SQLSink) Write(ctx context.Context, batch []Event) error {
    if len(batch) != s.size {
        // Fall back to a non-prepared query for partial batches.
        return s.writeUnprepared(ctx, batch)
    }
    args := make([]any, 0, len(batch)*3)
    for _, e := range batch {
        args = append(args, e.UserID, e.Action, e.Timestamp)
    }
    _, err := s.stmt.ExecContext(ctx, args...)
    return err
}
```

The prepared path is faster (no parse), the unprepared path handles partial batches (time-triggered or close-triggered).

### Idempotency: ON CONFLICT

If retries can fan out, add ON CONFLICT:

```sql
INSERT INTO events (id, user_id, action, ts) VALUES ...
ON CONFLICT (id) DO NOTHING
```

This requires items to have a unique ID, which is good practice anyway. With it, you can retry the same batch and get the same result.

---

## Integrating with `pgx` and `CopyFrom`

For Postgres, the fastest bulk-insert path is `COPY FROM`, not INSERT. `pgx.CopyFrom` exposes this:

```go
import "github.com/jackc/pgx/v5"

type PGXCopySink struct {
    conn *pgx.Conn
}

func (p *PGXCopySink) Write(ctx context.Context, batch []Event) error {
    if len(batch) == 0 {
        return nil
    }
    rows := make([][]any, len(batch))
    for i, e := range batch {
        rows[i] = []any{e.UserID, e.Action, e.Timestamp}
    }
    _, err := p.conn.CopyFrom(ctx,
        pgx.Identifier{"events"},
        []string{"user_id", "action", "ts"},
        pgx.CopyFromRows(rows))
    return err
}
```

`COPY FROM` is dramatically faster than multi-row INSERT for batches of 1000+. It uses Postgres' streaming binary protocol, bypassing parser overhead and reducing per-row cost.

### When to use INSERT vs COPY

- **INSERT VALUES (..), (..), ...**: small batches (10–500). Better for ON CONFLICT and RETURNING.
- **COPY FROM**: large batches (500+). Faster but limited — no ON CONFLICT (without a temp table dance).
- **Temp table + INSERT ... SELECT**: best of both — copy into a temp table, then INSERT SELECT with ON CONFLICT. Use for large idempotent batches.

### Pool Awareness

`*pgx.Conn` is single-connection. For a batcher, use `*pgxpool.Pool` and call `Acquire(ctx)` before `CopyFrom`:

```go
func (p *PGXCopySink) Write(ctx context.Context, batch []Event) error {
    conn, err := p.pool.Acquire(ctx)
    if err != nil {
        return err
    }
    defer conn.Release()
    _, err = conn.CopyFrom(ctx, ...)
    return err
}
```

The pool handles concurrent flushes (one per connection). Set pool size to at least the number of concurrent flush workers.

---

## Integrating with Kafka Producers

Kafka producers (`franz-go`, `confluent-kafka-go`, IBM `sarama`) all internally batch. So you have a choice: rely on the producer's internal batching, or layer your own on top.

### Just Use the Producer's Batcher

If you use `franz-go`, you can `Produce(ctx, record, callback)` per item and let franz-go batch internally. Set `ProducerLinger(d)` and `ProducerBatchMaxBytes(n)`:

```go
client, err := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    kgo.DefaultProduceTopic("events"),
    kgo.ProducerLinger(5*time.Millisecond),
    kgo.ProducerBatchMaxBytes(1024*1024), // 1 MB
)

for _, e := range events {
    rec := &kgo.Record{Value: serialise(e)}
    client.Produce(ctx, rec, func(rec *kgo.Record, err error) {
        if err != nil {
            log.Printf("kafka produce failed: %v", err)
        }
    })
}
```

This is clean — no application-level batcher needed.

### When to Add an App-Level Batcher

Add your own batcher when:

- You need to combine items before producing (e.g., dedupe, aggregate).
- You want per-tenant ordering or partitioning that the producer does not handle.
- You need a shared latency budget across multiple sinks (one batcher feeding Kafka, Postgres, and S3 with the same window).
- You want stronger observability than the producer client provides.

### Sink Adapter for Kafka

```go
type KafkaSink struct {
    client *kgo.Client
    topic  string
}

func (k *KafkaSink) Write(ctx context.Context, batch []Event) error {
    records := make([]*kgo.Record, len(batch))
    for i, e := range batch {
        records[i] = &kgo.Record{
            Topic: k.topic,
            Key:   []byte(e.Key),
            Value: serialise(e),
        }
    }
    results := k.client.ProduceSync(ctx, records...)
    return results.FirstErr()
}
```

`ProduceSync` blocks until all records have been acked. This integrates cleanly with the batcher: one call per batch, one error per batch.

### Per-Key Ordering

If items must arrive in order *per key*, you have a problem: Kafka delivers in order per partition, and the partition is determined by the key hash. If your batcher hands records to the producer in some order, they will end up in different partitions (different orders).

Solutions:

- One batcher per partition key (high overhead).
- Send all records in one batch with a single `ProduceSync`; per-partition records within a batch are sent in batch order.
- Use `MaxBufferedRecords(1)` (no in-flight) for strictly ordered producers — but this destroys throughput.

For most use cases, "ordered within batch, batches in submission order" is what you get and is enough.

---

## Integrating with HTTP Bulk Endpoints

Elastic `_bulk`, BigQuery `insertAll`, Datadog `/api/v1/series` — all HTTP endpoints that accept many records per call.

```go
type HTTPSink struct {
    client *http.Client
    url    string
    auth   string
}

func (h *HTTPSink) Write(ctx context.Context, batch []Event) error {
    body, err := encodeNDJSON(batch)
    if err != nil {
        return err
    }
    req, err := http.NewRequestWithContext(ctx, "POST", h.url, bytes.NewReader(body))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/x-ndjson")
    req.Header.Set("Authorization", h.auth)
    resp, err := h.client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        b, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("http %d: %s", resp.StatusCode, string(b))
    }
    return parseBulkResponse(resp.Body)
}
```

### Considerations

- **Body size**: bulk APIs usually have a hard limit (5–15 MB). Track body size in addition to count.
- **gzip**: most bulk APIs accept gzip. Compress before sending; saves bandwidth.
- **Per-item errors**: bulk APIs often return per-item status (`_bulk` returns an array). Parse it and route per-item failures to retry or dead-letter.
- **Idempotency keys**: include a per-record `_id` for idempotent retries.

### Per-Item Result Parsing

```go
type BulkItemResult struct {
    Index struct {
        Status int    `json:"status"`
        Error  string `json:"error"`
    } `json:"index"`
}

type BulkResponse struct {
    Items []BulkItemResult `json:"items"`
}

func parseBulkResponse(body io.Reader) error {
    var r BulkResponse
    if err := json.NewDecoder(body).Decode(&r); err != nil {
        return err
    }
    for i, item := range r.Items {
        if item.Index.Status >= 400 {
            log.Printf("item %d failed: %s", i, item.Index.Error)
        }
    }
    return nil
}
```

For each failed item, decide: retry (if transient), dead-letter (if permanent), or log (if best-effort).

---

## Per-Tenant Sub-Batchers

A single shared batcher mixes items from many tenants. A failure caused by one tenant's bad payload fails the whole batch. The fix is to keep one buffer per tenant:

```go
type TenantBatcher struct {
    in       chan Item
    maxSize  int
    maxDelay time.Duration
    sink     Sink
    done     chan struct{}
}

func (t *TenantBatcher) run() {
    defer close(t.done)
    bufs := make(map[string][]Item)
    timers := make(map[string]*time.Timer)
    flush := func(tenant string, reason string) {
        b := bufs[tenant]
        if len(b) == 0 {
            return
        }
        batch := make([]Item, len(b))
        copy(batch, b)
        bufs[tenant] = b[:0]
        if tm, ok := timers[tenant]; ok {
            tm.Stop()
            delete(timers, tenant)
        }
        _ = t.sink.Write(context.Background(), batch)
    }
    flushAll := func() {
        for tenant := range bufs {
            flush(tenant, "shutdown")
        }
    }
    for {
        select {
        case item, ok := <-t.in:
            if !ok {
                flushAll()
                return
            }
            bufs[item.Tenant] = append(bufs[item.Tenant], item)
            if len(bufs[item.Tenant]) == 1 {
                tt := item.Tenant
                timers[tt] = time.AfterFunc(t.maxDelay, func() {
                    // BUG: cannot directly call flush from another goroutine
                })
            }
            if len(bufs[item.Tenant]) >= t.maxSize {
                flush(item.Tenant, "size")
            }
        }
    }
}
```

The buggy version above shows the trap: `time.AfterFunc` runs the callback in a *different* goroutine, but our `bufs` map is owned by the run loop. We cannot safely call `flush` from the callback.

The fix is to *signal* the run loop:

```go
case tenant := <-t.timeTrigger:
    flush(tenant, "time")
```

And the timer callback sends to `t.timeTrigger`:

```go
timers[tt] = time.AfterFunc(t.maxDelay, func() {
    t.timeTrigger <- tt
})
```

Now all map operations happen in the run loop, one goroutine, no race.

### Memory Bounds

Per-tenant batching multiplies the worst-case memory: `numTenants * maxSize`. For 1000 tenants and a 1000-row batch, that is 1 million items in RAM. Decide a global cap and either:

- Reject new items when total > cap.
- Force-flush the oldest tenant when total > cap.
- Cap per tenant at a smaller value.

This is the area of "fairness in multi-tenant systems", covered more in senior.md.

---

## Backpressure Composition

A batcher's input channel is the first backpressure boundary. When it fills, producers block. But that may not be the right behaviour for your service.

### Producer-side: choose your policy

```go
// Block.
b.Add(item)

// Drop.
select {
case b.in <- item:
default:
    drops.Inc()
}

// Drop oldest.
select {
case b.in <- item:
default:
    select {
    case <-b.in: // discard one
    default:
    }
    b.in <- item
    dropsOldest.Inc()
}

// Block with deadline.
ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
defer cancel()
select {
case b.in <- item:
case <-ctx.Done():
    return ctx.Err()
}
```

Each policy is correct for some workload, wrong for others. Document which you chose.

### Upstream signalling

If you cannot block producers (an HTTP handler must respond within an SLA), return an HTTP 503 when the batcher is saturated:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    item := parse(r)
    select {
    case batcher.in <- item:
        w.WriteHeader(202)
    case <-time.After(50 * time.Millisecond):
        w.WriteHeader(503)
        w.Header().Set("Retry-After", "5")
    }
}
```

This lets the client retry, often with exponential backoff, instead of the request piling up server-side. See `01-backpressure` for the full pattern.

---

## Testing in CI

Time-based tests are flaky. Here are deterministic patterns.

### Inject a Fake Clock

```go
type Clock interface {
    Now() time.Time
    After(d time.Duration) <-chan time.Time
    NewTicker(d time.Duration) *time.Ticker // or a Ticker interface
}

type RealClock struct{}
func (RealClock) Now() time.Time { return time.Now() }
// ...

type FakeClock struct {
    mu   sync.Mutex
    now  time.Time
    chs  []chan time.Time
}
// ...

func (b *Batcher) run() {
    ticker := b.clock.NewTicker(b.maxDelay)
    // ...
}
```

In tests, advance the fake clock and assert flushes:

```go
func TestTimeTriggerDeterministic(t *testing.T) {
    clock := NewFakeClock(time.Now())
    sink := NewFakeSink()
    b := NewBatcher(sink, 100, 50*time.Millisecond, clock)

    b.Add(Item{})
    b.Add(Item{})
    if sink.Count() != 0 {
        t.Fatalf("expected 0 flushes before tick")
    }
    clock.Advance(50 * time.Millisecond)
    waitFor(t, func() bool { return sink.Count() == 1 })
}
```

`waitFor` is a polling helper with a generous timeout (1 s) and a short interval (1 ms). It is the bridge between "test wants determinism" and "fake clock advances out of band of the run loop".

Libraries: `clockwork`, `github.com/benbjohnson/clock`. Either works.

### Test the Shutdown Contract

```go
func TestShutdownFlushes(t *testing.T) {
    sink := NewFakeSink()
    b := NewBatcher(sink, 100, time.Hour, clock)
    for i := 0; i < 5; i++ {
        b.Add(Item{ID: i})
    }
    if err := b.Shutdown(context.Background()); err != nil {
        t.Fatal(err)
    }
    if sink.Total() != 5 {
        t.Fatalf("expected 5 items, got %d", sink.Total())
    }
}
```

### Test Shutdown Timeout

```go
func TestShutdownTimeout(t *testing.T) {
    slowSink := &SlowSink{delay: 1 * time.Second}
    b := NewBatcher(slowSink, 100, time.Hour, clock)
    for i := 0; i < 100; i++ {
        b.Add(Item{ID: i})
    }
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    err := b.Shutdown(ctx)
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Fatalf("expected deadline exceeded, got %v", err)
    }
}
```

### Test Retry on Transient

```go
func TestRetryOnTransient(t *testing.T) {
    flaky := &FlakySink{failures: 2}
    retry := &RetryingSink{inner: flaky, maxTries: 5, baseDelay: time.Millisecond}
    b := NewBatcher(retry, 5, time.Hour, clock)
    for i := 0; i < 5; i++ {
        b.Add(Item{ID: i})
    }
    b.Shutdown(context.Background())
    if flaky.successes != 1 {
        t.Fatalf("expected 1 successful write after retries")
    }
    if flaky.attempts != 3 {
        t.Fatalf("expected 3 attempts (2 fail + 1 success), got %d", flaky.attempts)
    }
}
```

### Run with `-race`

Every batcher test must run with `-race`. The race detector catches the subtle bugs that timing tests miss.

---

## Operational Runbook

When a batcher misbehaves in production, the first place to look is the four metrics.

### "Throughput is low"

1. Check `flush_total{reason}`. All `time`? Increase `MaxBatchSize` or accept low throughput.
2. Check `batch_size_items`. p50 near `MaxBatchSize`? Sink is the bottleneck; scale sink.
3. Check `flush_duration`. p99 high? Sink is slow; investigate sink-side.

### "Latency is high"

1. Check `flush_duration` p99. Above `MaxBatchDelay`? Sink is slow; reduce `MaxBatchSize` to flush smaller batches faster.
2. Check `queue_depth`. Near cap? Backpressure; producers blocked.

### "Items are missing after deploy"

1. Was `Shutdown(ctx)` called? Check shutdown handler.
2. Did `Shutdown` return an error? Check logs for "deadline exceeded".
3. Were there in-flight retries? Check retry queue depth at SIGTERM.

### "Memory is rising"

1. Check `queue_depth`. Bounded by channel cap; if rising, channel cap is the issue.
2. Check per-tenant memory (if sharded). One tenant dominating?
3. Check retry queue. If retries can grow unboundedly, that is the leak.

### "Sink is returning errors"

1. Check error classification. Are transient errors being treated as permanent?
2. Check retry budget. Are retries exhausting too quickly?
3. Check dead-letter queue. Is it accumulating? Drain it.

The runbook is the connective tissue between metrics and action. Without it, "the dashboard is on fire" produces panic; with it, you have a checklist.

---

## More on Multi-Sink Batchers

Sometimes the same batch must be written to multiple sinks: a primary (Postgres) and a stream (Kafka) so consumers can subscribe to changes. Options:

### Option 1: Sequential Multi-Sink

```go
type MultiSink struct {
    sinks []Sink
}

func (m *MultiSink) Write(ctx context.Context, batch []Event) error {
    for _, s := range m.sinks {
        if err := s.Write(ctx, batch); err != nil {
            return err
        }
    }
    return nil
}
```

Simple, but each sink waits for the previous. Latency adds up.

### Option 2: Parallel Multi-Sink with errgroup

```go
func (m *MultiSink) Write(ctx context.Context, batch []Event) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, s := range m.sinks {
        s := s
        g.Go(func() error {
            return s.Write(gctx, batch)
        })
    }
    return g.Wait()
}
```

Concurrent flushes; the slowest sink dominates latency. errgroup cancels remaining if any fails.

### Option 3: Best-Effort Fan-Out

```go
func (m *MultiSink) Write(ctx context.Context, batch []Event) error {
    var firstErr error
    var mu sync.Mutex
    var wg sync.WaitGroup
    for _, s := range m.sinks {
        wg.Add(1)
        go func(s Sink) {
            defer wg.Done()
            if err := s.Write(ctx, batch); err != nil {
                mu.Lock()
                if firstErr == nil {
                    firstErr = err
                }
                mu.Unlock()
            }
        }(s)
    }
    wg.Wait()
    return firstErr
}
```

All sinks attempted regardless of others' failures. Trade-off: a slow sink does not abort the others, but you may lose data on a failing sink without knowing which.

### Two-Phase Commit?

Tempting to think about transactional fan-out. In practice, distributed transactions across heterogeneous sinks (Postgres + Kafka + S3) are impractical. The standard pattern is outbox: write to Postgres in one transaction with a marker; a separate CDC pipeline streams to Kafka. The batcher just writes to Postgres; the propagation is decoupled.

## More on the Pipeline Architecture

Refining the pipeline:

```go
type Batcher struct {
    in        chan Item
    flushReq  chan []Item
    sink      Sink
    maxSize   int
    maxDelay  time.Duration
    flushers  int
    done      chan struct{}
    wg        sync.WaitGroup
}

func New(cfg Config) *Batcher {
    b := &Batcher{
        in:       make(chan Item, cfg.QueueDepth),
        flushReq: make(chan []Item, cfg.FlushQueueDepth),
        sink:     cfg.Sink,
        maxSize:  cfg.MaxBatchSize,
        maxDelay: cfg.MaxBatchDelay,
        flushers: cfg.Flushers,
        done:     make(chan struct{}),
    }
    for i := 0; i < cfg.Flushers; i++ {
        b.wg.Add(1)
        go b.flushWorker()
    }
    go b.run()
    return b
}

func (b *Batcher) flushWorker() {
    defer b.wg.Done()
    for batch := range b.flushReq {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        _ = b.sink.Write(ctx, batch)
        cancel()
    }
}

func (b *Batcher) run() {
    defer func() {
        close(b.flushReq)
        b.wg.Wait()
        close(b.done)
    }()
    buf := make([]Item, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    handoff := func(reason string) {
        if len(buf) == 0 {
            return
        }
        batch := make([]Item, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        b.flushReq <- batch
    }
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                handoff("shutdown")
                return
            }
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                handoff("size")
            }
        case <-ticker.C:
            handoff("time")
        }
    }
}
```

Notes:

- `flushers` workers drain `flushReq` in parallel. For ordered sinks, use 1; for unordered, use as many as the sink's parallelism warrants.
- On shutdown: `close(b.flushReq)` after the run loop exits, then `wg.Wait()` for all flushers to finish, then `close(b.done)`.
- `flushReq` cap is its own backpressure boundary. If the run loop hands off faster than flushers drain, the run loop blocks. That stalls accumulation; producers see backpressure.

### Tuning the Pipeline

- `flushers = 1`: ordered, single-flusher pipeline.
- `flushers = N`: parallel flushers; sink must accept concurrent writes.
- `cap(flushReq) = 1`: at most one batch queued for flush; run loop blocks if flusher is slow.
- `cap(flushReq) = 16`: up to 16 batches queued; absorbs a slow flush burst.

## Testing: Fake Clock Helpers

A complete fake clock implementation suitable for batcher tests:

```go
package faketime

import (
    "sort"
    "sync"
    "time"
)

type Clock struct {
    mu    sync.Mutex
    now   time.Time
    waits []*wait
}

type wait struct {
    deadline time.Time
    ch       chan time.Time
}

func New(t time.Time) *Clock { return &Clock{now: t} }

func (c *Clock) Now() time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.now
}

func (c *Clock) After(d time.Duration) <-chan time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    w := &wait{deadline: c.now.Add(d), ch: make(chan time.Time, 1)}
    c.waits = append(c.waits, w)
    return w.ch
}

func (c *Clock) NewTicker(d time.Duration) *Ticker {
    return &Ticker{clock: c, period: d, c: make(chan time.Time, 1)}
}

type Ticker struct {
    clock  *Clock
    period time.Duration
    c      chan time.Time
}

func (t *Ticker) C() <-chan time.Time { return t.c }

func (c *Clock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    fired := c.waits[:0]
    pending := []*wait{}
    for _, w := range c.waits {
        if !c.now.Before(w.deadline) {
            w.ch <- c.now
            fired = append(fired, w)
        } else {
            pending = append(pending, w)
        }
    }
    _ = fired
    c.waits = pending
    c.mu.Unlock()
}
```

In production batcher code, accept `clock.Clock` as a parameter and use it instead of `time.Now` / `time.NewTicker`. In tests, pass the fake.

Libraries like `clockwork` (`github.com/jonboulle/clockwork`) provide this out of the box.

## Testing: Race-Free Patterns

Three patterns that show up in every batcher test suite.

### Pattern 1: Drain-then-Assert

```go
b := NewBatcher(sink, ...)
for _, item := range items {
    b.Add(ctx, item)
}
b.Shutdown(ctx)
assertSinkReceived(t, sink, items)
```

Simple. Works as long as items are all known up front.

### Pattern 2: Synchronisation via Flush

```go
b := NewBatcher(sink, ...)
b.Add(ctx, item1)
b.Add(ctx, item2)
b.Flush() // explicit fence
assertSinkReceived(t, sink, []Item{item1, item2})
```

Works for streaming tests.

### Pattern 3: Wait for Sink

```go
sink := NewBlockingFakeSink()
b := NewBatcher(sink, ...)
b.Add(ctx, item1)
sink.WaitForCall(t, 1*time.Second)
assertSinkCalled(t, sink, []Item{item1})
```

`WaitForCall` is a helper on the fake sink that blocks until `Write` has been called N times or the timeout fires. Useful for testing time-triggered flushes without a fake clock.

## Per-Item Tracing Through The Batcher

How to follow one item from `Add` to durability with OpenTelemetry:

```go
func (b *Batcher) Add(ctx context.Context, item Event) error {
    ctx, span := tracer.Start(ctx, "batcher.Add")
    defer span.End()
    item.spanContext = span.SpanContext()
    return b.in <- item // simplified
}

func (b *Batcher) flush(batch []Event, reason string) {
    ctx, span := tracer.Start(context.Background(), "batcher.flush")
    defer span.End()
    span.SetAttributes(
        attribute.Int("batch.size", len(batch)),
        attribute.String("batch.reason", reason),
    )
    links := make([]trace.Link, len(batch))
    for i, e := range batch {
        links[i] = trace.Link{SpanContext: e.spanContext}
    }
    // Annotate span with links to all item spans.
    // (API depends on otel version.)
    _ = b.sink.Write(ctx, batch)
}
```

In Jaeger or Tempo, the resulting trace shows: each `Add` span links to the `flush` span; the `flush` span is a child of nothing (root) but cross-referenced from many requests. Traces visualise the fan-in.

For high-cardinality workloads, tail sampling at the collector keeps storage manageable.

## Choosing Between `chan T` and Lock-Free Queues

For 99% of cases, `chan T` is the right answer. The runtime's channel implementation is well-optimised, race-free by design, and idiomatic Go.

When might you reach for a lock-free queue?

- Item rate > 10 million/s, where channel overhead (~50 ns/op) becomes a significant fraction of work.
- Hard-real-time guarantees where the scheduler's involvement is unacceptable.
- Cross-language interop (channels are Go-only).

In those rare cases, `golang.org/x/sync/lockfreequeue` or third-party libraries like `MPMC ring buffer` apply. But "rare" cannot be overstated. A junior batcher using `chan T` saturates all realistic workloads.

## Choosing Between Sharing and Replication

If you have N producer goroutines, do they all share one batcher or do you create N batchers?

**One shared batcher**:

- Pro: tighter batches (more items in less time), maximum amortisation.
- Pro: simpler shutdown.
- Con: contention on the input channel (negligible at <1M items/s).

**N batchers, one per producer**:

- Pro: zero contention on input.
- Con: each batcher's batches are smaller; less amortisation.
- Con: N times the shutdown complexity.

In practice, share one batcher per sink. The contention is rarely an issue. The exception: if your producers and consumers are on different NUMA nodes, NUMA-aware batchers (covered in professional.md) may help.

## Reference: Common Batcher Configurations By Workload

A table of starting points for tuning. Always measure on your real workload before committing.

| Workload | MaxBatchSize | MaxBatchDelay | QueueDepth | Notes |
|----------|-------------:|--------------:|-----------:|-------|
| Audit logs (Postgres) | 500 | 1 s | 2048 | ON CONFLICT for idempotency |
| Audit logs (Postgres COPY) | 5000 | 1 s | 8192 | COPY FROM, much faster |
| Metrics (statsd UDP) | 50 | 100 ms | 256 | Packet size matters more than count |
| Clickstream (Kafka) | 10000 | 5 ms | 32768 | Linger via app-level batching |
| Webhooks (HTTP POST) | 100 | 200 ms | 1024 | Per-target rate limiting layered |
| Push notifications | 100 | 1 s | 1024 | Combiner per recipient |
| Search indexing (Elastic) | 1000 | 5 s | 4096 | Body size limit 10 MB |
| OpenTelemetry spans (OTLP) | 512 | 5 s | 2048 | Match SDK defaults |
| Email digest | 1000 | 1 h | 65536 | Long delay, heavy combiner |
| CDC sink (Postgres → Kafka) | 5000 | 100 ms | 16384 | Order-preserving, single flusher |

Use these as starting points, not endpoints. Profile and tune.

## When NOT to Use a Batcher

For symmetry, the cases that look like they need a batcher but should use something else:

- **Per-request synchronous commit**: a login endpoint. The user is waiting for confirmation; batching adds latency without benefit.
- **Reads (mostly)**: read batching is "DataLoader" pattern, not the write-side batching this file is about. Different shape.
- **Already-batched APIs**: if the underlying client already batches with linger (`librdkafka`, the AWS SDK with `AwsBatchSize`), adding an app-level batcher is double batching and usually loses.
- **Cross-process queues**: if you have Kafka or SQS between producer and consumer, batching happens at the consumer side. Producers usually do not need their own batcher.
- **Low-volume background jobs**: a cron job that runs once per hour with 10 items does not need a batcher; just process them in a loop.

## Migrating From "Unbatched" to "Batched"

Adding a batcher to existing code: a migration pattern.

1. **Identify the sink**: the slow per-item call you want to batch.
2. **Define `Sink`**: `Write(ctx, batch []T) error`.
3. **Implement `Sink` with the slow call**: in a loop initially (just to validate).
4. **Add the batcher**: in front of the sink.
5. **Switch the call site**: from `slowCall(item)` to `batcher.Add(ctx, item)`.
6. **Wire shutdown**: drain the batcher before exiting.
7. **Replace the loop-based `Write` with the actual batch operation**: multi-row INSERT, COPY, _bulk, etc.
8. **Add metrics**: the four basics.
9. **Add retries and DLQ**: wrap the sink.
10. **Add tests**: fake clock, deterministic.

This sequence is safe: between steps 5 and 7, the system still works (just no faster); between steps 7 and 10, the system is faster but lacks safety nets; after step 10, it is production-ready.

A common mistake is to do step 7 first (write the multi-row INSERT) and forget step 1-6. Without the batcher, the multi-row INSERT only fires if the caller groups items — which they probably won't.

## Walking Through a Production Incident

Anatomy of a real-feeling incident.

### Setup

A service ingests audit events. Batcher: `MaxBatchSize = 500`, `MaxBatchDelay = 200 ms`. Sink: Postgres via pgx CopyFrom. Pool size: 10.

### The Incident

11:42 — Prometheus alert: `batcher_flush_duration_seconds{p99}` > 5 s.

11:43 — On-call opens dashboard. Sees:

- `flush_duration_seconds` p99: 12 s.
- `flush_duration_seconds` p50: 50 ms.
- `flush_total{reason="size"}` rate: dropping.
- `flush_total{reason="time"}` rate: rising.
- `queue_depth`: at cap (2048).
- Postgres `pg_stat_activity`: 50 active queries with same INSERT statement.

### Diagnosis

The PG queries are queueing for connection slots. There are 10 pool slots but 50 wanting them. Why? Some queries are *taking 12 seconds* — likely waiting on a lock.

Connection slots in pool: 10. Concurrent flush goroutines: 10 (because we run a flush worker pool of 10). They all blocked on lock acquisition.

`pg_locks` shows: 10 transactions waiting on a single row lock. Root cause: a long-running OLTP transaction holding a lock on a row in the `events` table (some unrelated job locked a row for reporting).

### Mitigation

Operator kills the offending job. Within seconds, the 10 batchers' connections clear. Backlog drains. Queue depth drops. p99 returns to 50 ms.

### Post-Mortem Items

1. The batcher's flush timeout was set to 5 seconds, but `Shutdown` ctx was 30 seconds. The flush timeout was wrong: when individual flushes hit 5 s, retries piled up. Reduce `FlushTimeout` to 1 s. Faster failure, faster recovery.
2. The 503 backpressure on the HTTP handler was missing. Clients with `Retry-After` would have spread the load; instead the channel filled and producers blocked, queue depth rising forever.
3. Postgres needs a separate connection pool for reporting jobs. The audit batcher pool should not be shared.
4. Add a `flush_in_flight` gauge to detect connection starvation earlier.

This kind of post-mortem is the *output* of operating batchers. Each one teaches you a new config knob.

## A Mental Model: The Bathtub

A batcher is a bathtub. Water flows in from the tap (producers). It drains through the plug (the sink). The drain rate is per-call cost amortised across batch size. The tub size is the input channel capacity. The water level is queue depth.

- Tap > drain: water rises. Eventually overflows (queue full, producers blocked).
- Tap < drain: water falls. The tub stays mostly empty.
- Tap = drain: water level is the steady-state queue depth.

When water is high, you can either widen the drain (faster sink, bigger batches) or close the tap (backpressure to producers). Both have costs.

The bathtub analogy is what you draw on the whiteboard when explaining batchers to a non-Go engineer. It works for everyone.

## Common Mistakes at the Middle Level

Mistakes that look "fine" at the junior level and bite at the middle.

### 1. Retry without classifying

Retrying *every* error retries the unfixable ones too. Permanent errors (4xx, unique violation) waste budget and hide bugs. Always classify.

### 2. Retrying inside the run loop

Blocks accumulation while retrying. Move retries to a separate goroutine or external sink wrapper.

### 3. No DLQ

Permanent errors get retried forever, or worse, dropped silently. Always have a DLQ for non-transient failures.

### 4. No cap on retry queue

The retry queue is its own backpressure boundary. Unbounded means memory growth.

### 5. Metrics with high cardinality

`flush_total{tenant="...", reason="..."}` with 10000 tenants explodes Prometheus. Aggregate or sample.

### 6. Flush context inherits forever

`b.sink.Write(context.Background(), batch)` never times out. Use `WithTimeout` per flush.

### 7. Shutdown calls Close on sink before draining batcher

```go
db.Close()
batcher.Shutdown(ctx) // batcher's flushes now fail
```

Reverse the order:

```go
batcher.Shutdown(ctx) // drains via sink
db.Close()
```

### 8. Forgetting to close per-tenant timers

In the per-tenant pattern, each tenant has its own timer. On shutdown, stop them all.

### 9. Mixing `MaxBatchDelay` units

`MaxBatchDelay: 100` is unsafe in Go: time.Duration is in nanoseconds. Always use `100 * time.Millisecond`.

### 10. Not testing under load

A batcher tested only at 1 request/second behaves differently at 1000/s. Run a sustained load test before deploying.

## A Closer Look at the Shutdown Race

Imagine the following sequence:

1. SIGTERM arrives. The signal handler calls `b.Shutdown(ctx)`.
2. `Shutdown` calls `closeOnce.Do(close(b.in))`.
3. Meanwhile, a producer's `Add` is in the middle of `select { case b.in <- item: ... }`.
4. The send happens *before* the close, the close happens, the run loop sees the channel close, drains.

This works. The send is atomic with respect to close; either it happens before close (item enqueued, drained) or after (panic on send).

But: what if the producer's `Add` is in `select { case <-b.closeCh: return ErrClosed; default: }` *before* the close?

```go
func (b *Batcher) Add(ctx context.Context, item T) error {
    select {
    case <-b.closeCh:
        return ErrClosed
    default:
    }
    select {
    case b.in <- item:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    case <-b.closeCh:
        return ErrClosed
    }
}
```

The first `select` checked `closeCh` before close. We fall through to the second `select`. Now close happens. The second select picks `<-b.closeCh` and returns `ErrClosed`. Safe.

The key is the *second* select. Without it, we would still hit `b.in <- item` after the close — panic.

This is a subtle bit of channel discipline. Test it.

## A Closer Look at Backpressure: HTTP Edition

In an HTTP service, you cannot block a handler indefinitely. The user is waiting. If the batcher is saturated, return 503 quickly:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    event := parse(r)
    ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
    defer cancel()
    if err := batcher.Add(ctx, event); err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            w.Header().Set("Retry-After", "5")
            http.Error(w, "service overloaded", http.StatusServiceUnavailable)
            return
        }
        if errors.Is(err, batcher.ErrClosed) {
            http.Error(w, "shutting down", http.StatusServiceUnavailable)
            return
        }
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusAccepted)
}
```

This is the integration point between local backpressure (channel full) and remote backpressure (503). The client retries with backoff; the cycle continues until either the backlog clears or the client gives up.

## A Closer Look at Backpressure: gRPC Edition

gRPC streams have their own flow control (HTTP/2 window). For unary RPCs, the same pattern as HTTP applies. For streaming RPCs (typical for high-throughput ingestion), you can let the gRPC library handle queue depth via `ReadMessage` and your handler decides whether to enqueue.

```go
func (s *Server) IngestEvents(stream pb.Service_IngestEventsServer) error {
    for {
        e, err := stream.Recv()
        if err == io.EOF {
            return stream.SendAndClose(&pb.Ack{Count: int32(s.count)})
        }
        if err != nil {
            return err
        }
        ctx, cancel := context.WithTimeout(stream.Context(), 100*time.Millisecond)
        if err := s.batcher.Add(ctx, eventFromProto(e)); err != nil {
            cancel()
            return status.Error(codes.ResourceExhausted, err.Error())
        }
        cancel()
        s.count++
    }
}
```

`ResourceExhausted` is the gRPC-canonical "service overloaded" code, the analog of HTTP 503.

## Idempotency in Practice

For retries to be safe, the sink must be idempotent. Three patterns:

### Pattern 1: Natural Idempotency via Unique IDs

Items have a unique ID. The sink uses INSERT ... ON CONFLICT (id) DO NOTHING:

```sql
INSERT INTO events (id, user_id, action, ts) VALUES ...
ON CONFLICT (id) DO NOTHING
```

Re-running the same batch is a no-op for items already inserted. Cost: a unique index lookup per item.

### Pattern 2: Idempotency Keys via UPSERT

```sql
INSERT INTO state (key, value, version) VALUES ($1, $2, $3)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version
WHERE state.version < EXCLUDED.version
```

The version column avoids overwriting newer data with older retries.

### Pattern 3: Outbox Pattern

The sink writes to a local outbox table inside the same transaction as the business write. A separate process drains the outbox to the downstream. Retries hit the outbox, which is idempotent via primary keys.

This is heavier-weight but gives transactional guarantees. Used in event-sourced systems.

## Observability: Tracing Across Batches

A common ask: "trace a single user request end-to-end, including the batched DB write." Hard because the DB write is decoupled from the request.

Solutions:

1. **Span links**: each item carries a span context. The batch span links to all item spans. Jaeger/Tempo render this as a fan-in.
2. **Sampled tracing**: only trace a fraction of items; the batch span carries one of them as the parent. Lossy but cheap.
3. **Exemplar metrics**: the batch flush metric has an exemplar pointing to a representative trace ID.

OpenTelemetry's batch span processor uses pattern 1 internally. For custom batchers, pattern 2 is the most common in practice.

## Manual Flush: When and Why

The `Flush()` method lets callers force a flush. Use cases:

- **End-of-request fence**: an HTTP handler wants its log line durable before returning.
- **Checkpoint boundary**: a stream processor wants the batcher flushed at checkpoint commits.
- **Operator command**: an admin endpoint to "drain now" for incident response.
- **Test determinism**: tests can `Flush()` instead of `Sleep`.

Cost: each `Flush()` is a full sink call. Overuse defeats batching. Reserve for rare boundaries.

## Memory Accounting

A batcher can hold:

- `cap(b.in)` items in the input channel.
- `MaxBatchSize` items in the buffer.
- `cap(b.flushReq) * MaxBatchSize` items in the flush queue (pipeline architecture).
- `numConcurrentFlushes * MaxBatchSize` items in flight to the sink.

Memory worst case ≈ `(QueueDepth + MaxBatchSize * (1 + flushQueueCap + concurrentFlushes)) * sizeof(Item)`.

For 8-byte items and typical config: `(1024 + 100 * 1) * 8 = ~9 KB`. Negligible.

For 4 KB items (typical log lines): `(1024 + 100 * 3) * 4096 = ~5 MB`. Still small per batcher, but multiplied by hundreds of batchers in a service can matter.

For 1 MB items (large analytics events): `(1024 + 100 * 3) * 1 MB = ~1.3 GB`. Now you have to think.

## Comparing Approaches: Pure Synchronous, Pipeline, and Double-Buffer

There are three common architectures. Let us see them side by side.

### Synchronous Flush (Junior Default)

```
run loop:
  append item
  if full or tick: flush(buf) synchronously
```

- Pros: simplest, easy to reason about, ordering guaranteed.
- Cons: slow sink stalls accumulation; throughput limited by sink latency.

### Pipeline (Handoff)

```
run loop:
  append item
  if full or tick: handoff(batch) -> flushReq channel
flushWorker:
  receive batch
  flush(batch)
```

- Pros: accumulation does not block on sink; higher throughput.
- Cons: more state (flush queue, drop policy), ordering preserved only if single flushWorker.

### Double-Buffer

```
run loop:
  fill bufA
  on trigger: swap bufA <-> bufB, dispatch bufB to flush goroutine, continue with bufA
flushWorker:
  receive bufB
  flush(bufB)
  signal "done with bufB"
```

- Pros: zero-allocation buffer reuse, very high throughput.
- Cons: complex; only one batch in flight at a time (no further parallelism).

In practice, the pipeline architecture is the middle-ground choice: more parallel than synchronous, less complex than full double-buffer.

## A Closer Look at Ordering Guarantees

Order is a slippery contract. Let us be precise.

### Single-Producer, Single-Flusher

All items flushed in arrival order, across batches. The strongest guarantee.

### Multi-Producer, Single-Flusher

Items from a single producer arrive in *that producer's order* within a batch and across batches, but interleaved with other producers. There is no total order across producers — `select`'s randomisation on channel receives mixes them.

If your sink expects per-producer ordering, that is preserved. If it expects total ordering, it is not.

### Single-Producer, Multi-Flusher

Batches are formed in order but can complete out of order. The sink sees:

- Batch 1 (items 0-99) and Batch 2 (items 100-199) both dispatched in order.
- Batch 2 completes first because Batch 1 took longer.
- The sink may see Batch 2's data appear before Batch 1's.

If the sink is "append to a log", this is a bug. If the sink is "store by key" and items have unique keys, it does not matter.

### Multi-Producer, Multi-Flusher

No ordering guarantees at all. Some sinks (Kafka with per-key partitioning) can still provide per-key ordering, but it requires the sink to handle it.

### Implications

If your application requires ordering, use single-flusher and bound the number of producers, OR shard such that order is preserved within each shard.

## Sizing the Configuration

A worksheet for choosing `(MaxBatchSize, MaxBatchDelay, QueueDepth)`:

1. Measure baseline sink latency at batch sizes 1, 10, 100, 1000.
2. Plot throughput vs batch size. Find the knee.
3. Set `MaxBatchSize` to the batch size at the knee, plus 20% safety margin downward.
4. Compute the steady-state arrival rate. Set `MaxBatchDelay` to `MaxBatchSize / arrival_rate`. This ensures the size trigger fires before the time trigger in steady state.
5. If `MaxBatchDelay` is shorter than your latency SLO contribution budget, you have headroom. Set it to the budget.
6. Set `QueueDepth` to absorb 1-5 seconds of arrivals at peak rate.

Example: sink knee at 500 items, peak rate 1000/s, SLO contribution 50 ms.

- `MaxBatchSize = 400` (knee minus margin).
- `MaxBatchDelay = 400 / 1000 = 400 ms`... but SLO is 50 ms. Use 50 ms.
- `QueueDepth = 1000/s * 2 s = 2000`.

Now monitor `flush_reason`. If it is almost all `time`, batches are smaller than `MaxBatchSize` and we are paying full latency without filling batches. Reduce `MaxBatchDelay` further or accept the throughput hit.

## Real-World Sink: A Kafka Sink With franz-go

A complete franz-go-based Kafka sink:

```go
package kafkasink

import (
    "context"
    "encoding/json"
    "fmt"

    "github.com/twmb/franz-go/pkg/kgo"
    "github.com/twmb/franz-go/pkg/kerr"
)

type Sink struct {
    client *kgo.Client
    topic  string
}

func New(brokers []string, topic string) (*Sink, error) {
    client, err := kgo.NewClient(
        kgo.SeedBrokers(brokers...),
        kgo.DefaultProduceTopic(topic),
        kgo.RequiredAcks(kgo.AllISRAcks()),
        kgo.ProducerLinger(0), // we batch ourselves
        kgo.RequestRetries(0), // we retry ourselves
    )
    if err != nil {
        return nil, err
    }
    return &Sink{client: client, topic: topic}, nil
}

func (s *Sink) Write(ctx context.Context, batch []map[string]any) error {
    records := make([]*kgo.Record, len(batch))
    for i, m := range batch {
        body, err := json.Marshal(m)
        if err != nil {
            return fmt.Errorf("marshal record %d: %w", i, err)
        }
        key, _ := m["key"].(string)
        records[i] = &kgo.Record{
            Topic: s.topic,
            Key:   []byte(key),
            Value: body,
        }
    }
    results := s.client.ProduceSync(ctx, records...)
    for _, r := range results {
        if r.Err != nil {
            var kErr *kerr.Error
            if errors.As(r.Err, &kErr) && !kErr.Retriable {
                return fmt.Errorf("permanent kafka error: %w", r.Err)
            }
            return r.Err // transient; outer retry layer handles
        }
    }
    return nil
}

func (s *Sink) Close() { s.client.Close() }
```

Notes:

- We disable franz-go's internal batching (`ProducerLinger(0)`) because we batch in the application layer.
- We disable internal retries (`RequestRetries(0)`) because we retry in the application layer.
- We use `ProduceSync` for synchronous semantics aligned with the batcher's interface.
- We surface the first error; the batcher's retry layer decides what to do.

If you want to leverage franz-go's batching, omit the application-level batcher entirely. You can still use a retry layer between the application code and franz-go, but the linger/batch logic lives in franz-go.

## Real-World Sink: Postgres Multi-Row INSERT

```go
package pgsink

import (
    "context"
    "fmt"
    "strings"

    "github.com/jackc/pgx/v5/pgxpool"
)

type Event struct {
    UserID string
    Action string
    TS     time.Time
}

type Sink struct {
    pool       *pgxpool.Pool
    batchSize  int
    stmtName   string
    stmtCached bool
}

func New(pool *pgxpool.Pool, batchSize int) *Sink {
    return &Sink{pool: pool, batchSize: batchSize, stmtName: "ins_events"}
}

func (s *Sink) Write(ctx context.Context, batch []Event) error {
    if len(batch) == 0 {
        return nil
    }
    if len(batch) == s.batchSize {
        return s.writeFull(ctx, batch)
    }
    return s.writePartial(ctx, batch)
}

func (s *Sink) writeFull(ctx context.Context, batch []Event) error {
    conn, err := s.pool.Acquire(ctx)
    if err != nil {
        return err
    }
    defer conn.Release()
    if !s.stmtCached {
        placeholders := make([]string, s.batchSize)
        for i := range placeholders {
            base := i*3 + 1
            placeholders[i] = fmt.Sprintf("($%d, $%d, $%d)", base, base+1, base+2)
        }
        query := "INSERT INTO events (user_id, action, ts) VALUES " + strings.Join(placeholders, ",")
        if _, err := conn.Conn().Prepare(ctx, s.stmtName, query); err != nil {
            return err
        }
        s.stmtCached = true
    }
    args := make([]any, 0, s.batchSize*3)
    for _, e := range batch {
        args = append(args, e.UserID, e.Action, e.TS)
    }
    _, err = conn.Conn().Exec(ctx, s.stmtName, args...)
    return err
}

func (s *Sink) writePartial(ctx context.Context, batch []Event) error {
    placeholders := make([]string, len(batch))
    args := make([]any, 0, len(batch)*3)
    for i, e := range batch {
        base := i*3 + 1
        placeholders[i] = fmt.Sprintf("($%d, $%d, $%d)", base, base+1, base+2)
        args = append(args, e.UserID, e.Action, e.TS)
    }
    query := "INSERT INTO events (user_id, action, ts) VALUES " + strings.Join(placeholders, ",")
    _, err := s.pool.Exec(ctx, query, args...)
    return err
}
```

Notes:

- The full-batch path uses a prepared statement, cached on the connection.
- The partial-batch path (from time/close triggers) builds the query each time, which is slower but rare.
- The prepared statement is per-connection, so the pool must not eject the connection — but in practice we re-prepare on each fresh connection acquisition. Production code uses a per-conn cache map.

For batches larger than ~500 rows, switch to `CopyFrom`:

```go
func (s *Sink) WriteCopy(ctx context.Context, batch []Event) error {
    if len(batch) == 0 {
        return nil
    }
    rows := make([][]any, len(batch))
    for i, e := range batch {
        rows[i] = []any{e.UserID, e.Action, e.TS}
    }
    _, err := s.pool.CopyFrom(ctx, pgx.Identifier{"events"},
        []string{"user_id", "action", "ts"}, pgx.CopyFromRows(rows))
    return err
}
```

`CopyFrom` is 5-10x faster than multi-row INSERT for large batches. Use it when batch sizes routinely exceed 500.

## Error Classification: A Closer Look

The retry layer needs to classify errors. Let us look at what that means in practice for each sink type.

### Postgres / database/sql

```go
func classifyPGError(err error) Retryability {
    if err == nil {
        return Permanent // not really meaningful
    }
    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) {
        switch pgErr.Code {
        case "23505": // unique_violation
            return Permanent
        case "23503": // foreign_key_violation
            return Permanent
        case "57P03": // cannot_connect_now
            return Transient
        case "40001": // serialization_failure
            return Transient
        case "40P01": // deadlock_detected
            return Transient
        case "53300": // too_many_connections
            return Throttle
        }
    }
    if errors.Is(err, context.DeadlineExceeded) {
        return Transient
    }
    if errors.Is(err, io.EOF) {
        return Transient // connection closed
    }
    var netErr net.Error
    if errors.As(err, &netErr) {
        return Transient
    }
    return Permanent // unknown -> conservative
}
```

The "conservative" default is debatable. Some teams default to Transient (retry on unknown), accepting more retries but fewer permanent drops. Others go Permanent (DLQ on unknown), preferring caution. Either is defensible; pick one and document it.

### HTTP / REST

```go
func classifyHTTPError(err error, status int) Retryability {
    if err != nil {
        var netErr net.Error
        if errors.As(err, &netErr) && netErr.Timeout() {
            return Transient
        }
        if errors.Is(err, context.DeadlineExceeded) {
            return Transient
        }
        return Transient // network-level errors are usually retryable
    }
    switch {
    case status == 429:
        return Throttle
    case status >= 500:
        return Transient
    case status == 408: // request timeout
        return Transient
    case status >= 400 && status < 500:
        return Permanent // 4xx (other than 408/429): bad request
    }
    return Permanent
}
```

The 5xx-as-transient convention works for most HTTP services. Some idempotent endpoints can also retry 4xx (a 403 might be a brief auth expiry); domain knowledge required.

### Kafka

Kafka producer errors come with retriability flags built in:

```go
import "github.com/twmb/franz-go/pkg/kerr"

func classifyKafkaError(err error) Retryability {
    if err == nil {
        return Permanent
    }
    var kerrErr *kerr.Error
    if errors.As(err, &kerrErr) {
        if kerrErr.Retriable {
            return Transient
        }
        return Permanent
    }
    return Transient // most non-protocol errors are network and retryable
}
```

The producer client typically handles retries internally for `Retriable` errors; you may or may not need an outer retry layer depending on configuration.

### Generic / Unknown

For unknown sinks, treat all errors as transient with a small retry budget (3-5 attempts) and a permanent classification on the last attempt. This is the safe default.

## Backoff Strategies

Exponential backoff with jitter is the standard. Here is the math:

- `delay_0 = base_delay` (e.g., 100 ms)
- `delay_i = min(max_delay, delay_0 * 2^i)` (capped)
- `actual_delay_i = delay_i * (0.5 + rand())` (full jitter)

```go
func backoff(attempt int, base, max time.Duration) time.Duration {
    d := base * (1 << attempt)
    if d > max {
        d = max
    }
    jitter := time.Duration(rand.Float64() * float64(d))
    return d/2 + jitter
}
```

Why jitter? Without it, all retriers retry at the same time. After a downstream failure, the retry storm hits the recovering downstream all at once and knocks it back down. Jitter spreads retries out.

Three jitter strategies:

- **Full jitter**: `random(0, delay)`. Maximum spread.
- **Equal jitter**: `delay/2 + random(0, delay/2)`. Bounded below by `delay/2`.
- **Decorrelated jitter**: `min(max, random(base, prev_delay * 3))`. AWS's recommendation.

Full jitter is simplest and works well. Decorrelated has slightly better recovery characteristics but more code. For most batchers, full jitter is fine.

## Composition: Wrapping Sinks

The decorator pattern lets you stack sink wrappers:

```go
sink := NewPGSink(pool)
sink = NewRetryingSink(sink, retryCfg)
sink = NewCircuitSink(sink, breakerCfg)
sink = NewMetricsSink(sink, "events")
sink = NewDLQSink(sink, dlq)
```

Each layer wraps the inner one and adds a concern: retries, circuit breaking, metrics, dead-letter. The batcher does not know about any of them; it just calls `sink.Write(ctx, batch)`.

This composition makes the design testable. Each layer is a small piece. You write unit tests for each, integration tests for the stack.

## Worked Example: A Production-Grade Batcher Library

Putting all the middle-level features into one package:

```go
// Package batcher provides a production-ready batching primitive.
package batcher

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "sync"
    "sync/atomic"
    "time"

    "github.com/prometheus/client_golang/prometheus"
)

// ErrClosed is returned by Add after Shutdown has been called.
var ErrClosed = errors.New("batcher: closed")

// Sink is the downstream destination.
type Sink[T any] interface {
    Write(ctx context.Context, batch []T) error
}

// Config configures a Batcher.
type Config[T any] struct {
    Name          string
    MaxBatchSize  int
    MaxBatchDelay time.Duration
    QueueDepth    int
    FlushTimeout  time.Duration
    Sink          Sink[T]
    Logger        *slog.Logger
}

func (c *Config[T]) validate() error {
    if c.Sink == nil {
        return errors.New("batcher: Sink is required")
    }
    if c.MaxBatchSize <= 0 {
        return errors.New("batcher: MaxBatchSize must be positive")
    }
    if c.MaxBatchDelay <= 0 {
        return errors.New("batcher: MaxBatchDelay must be positive")
    }
    if c.QueueDepth <= 0 {
        c.QueueDepth = 1024
    }
    if c.FlushTimeout <= 0 {
        c.FlushTimeout = 5 * time.Second
    }
    if c.Logger == nil {
        c.Logger = slog.Default()
    }
    return nil
}

// Batcher is the production batcher.
type Batcher[T any] struct {
    cfg       Config[T]
    in        chan T
    done      chan struct{}
    closeOnce sync.Once
    closeCh   chan struct{}

    metrics struct {
        enqueued          atomic.Int64
        flushedOK         atomic.Int64
        flushedFail       atomic.Int64
        droppedOnShutdown atomic.Int64
    }
}

// New constructs and starts a Batcher.
func New[T any](cfg Config[T]) (*Batcher[T], error) {
    if err := cfg.validate(); err != nil {
        return nil, err
    }
    b := &Batcher[T]{
        cfg:     cfg,
        in:      make(chan T, cfg.QueueDepth),
        done:    make(chan struct{}),
        closeCh: make(chan struct{}),
    }
    go b.run()
    return b, nil
}

// Add enqueues an item. Returns ErrClosed if the batcher has been shut down.
// Blocks if the queue is full; can be cancelled via ctx.
func (b *Batcher[T]) Add(ctx context.Context, item T) error {
    select {
    case <-b.closeCh:
        return ErrClosed
    default:
    }
    select {
    case b.in <- item:
        b.metrics.enqueued.Add(1)
        return nil
    case <-ctx.Done():
        return ctx.Err()
    case <-b.closeCh:
        return ErrClosed
    }
}

// TryAdd enqueues an item without blocking. Returns false if the queue is full.
func (b *Batcher[T]) TryAdd(item T) bool {
    select {
    case <-b.closeCh:
        return false
    default:
    }
    select {
    case b.in <- item:
        b.metrics.enqueued.Add(1)
        return true
    default:
        return false
    }
}

func (b *Batcher[T]) run() {
    defer close(b.done)
    defer func() {
        if r := recover(); r != nil {
            b.cfg.Logger.Error("batcher run loop panic", "panic", r)
        }
    }()
    buf := make([]T, 0, b.cfg.MaxBatchSize)
    ticker := time.NewTicker(b.cfg.MaxBatchDelay)
    defer ticker.Stop()
    flush := func(reason string) {
        if len(buf) == 0 {
            return
        }
        batch := make([]T, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        ctx, cancel := context.WithTimeout(context.Background(), b.cfg.FlushTimeout)
        defer cancel()
        start := time.Now()
        err := b.cfg.Sink.Write(ctx, batch)
        elapsed := time.Since(start)
        flushTotal.WithLabelValues(b.cfg.Name, reason).Inc()
        batchSizeHist.WithLabelValues(b.cfg.Name).Observe(float64(len(batch)))
        if err != nil {
            flushFailTotal.WithLabelValues(b.cfg.Name).Inc()
            flushDurationHist.WithLabelValues(b.cfg.Name, "error").Observe(elapsed.Seconds())
            b.metrics.flushedFail.Add(int64(len(batch)))
            b.cfg.Logger.Error("batcher flush failed",
                "name", b.cfg.Name, "reason", reason, "items", len(batch), "err", err)
        } else {
            flushDurationHist.WithLabelValues(b.cfg.Name, "ok").Observe(elapsed.Seconds())
            b.metrics.flushedOK.Add(int64(len(batch)))
        }
    }
    for {
        queueDepthGauge.WithLabelValues(b.cfg.Name).Set(float64(len(b.in)))
        select {
        case item, ok := <-b.in:
            if !ok {
                flush("shutdown")
                b.metrics.droppedOnShutdown.Add(int64(len(buf)))
                return
            }
            buf = append(buf, item)
            if len(buf) >= b.cfg.MaxBatchSize {
                flush("size")
            }
        case <-ticker.C:
            flush("time")
        }
    }
}

// Shutdown drains the buffer and stops the run loop. Returns ctx.Err() if the
// drain exceeds the context deadline. Safe to call multiple times.
func (b *Batcher[T]) Shutdown(ctx context.Context) error {
    b.closeOnce.Do(func() {
        close(b.closeCh)
        close(b.in)
    })
    select {
    case <-b.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

// Stats returns a snapshot of the batcher's counters.
type Stats struct {
    Enqueued          int64
    FlushedOK         int64
    FlushedFail       int64
    DroppedOnShutdown int64
    QueueDepth        int
}

func (b *Batcher[T]) Stats() Stats {
    return Stats{
        Enqueued:          b.metrics.enqueued.Load(),
        FlushedOK:         b.metrics.flushedOK.Load(),
        FlushedFail:       b.metrics.flushedFail.Load(),
        DroppedOnShutdown: b.metrics.droppedOnShutdown.Load(),
        QueueDepth:        len(b.in),
    }
}

var (
    flushTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "batcher_flush_total",
        Help: "Total flushes labelled by reason.",
    }, []string{"name", "reason"})

    flushFailTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: "batcher_flush_fail_total",
        Help: "Total flush failures.",
    }, []string{"name"})

    batchSizeHist = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "batcher_batch_size_items",
        Buckets: []float64{1, 5, 10, 50, 100, 500, 1000, 5000, 10000},
    }, []string{"name"})

    flushDurationHist = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "batcher_flush_duration_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
    }, []string{"name", "result"})

    queueDepthGauge = prometheus.NewGaugeVec(prometheus.GaugeOpts{
        Name: "batcher_queue_depth",
    }, []string{"name"})
)

func init() {
    prometheus.MustRegister(flushTotal, flushFailTotal, batchSizeHist, flushDurationHist, queueDepthGauge)
}

// String for debugging.
func (b *Batcher[T]) String() string {
    s := b.Stats()
    return fmt.Sprintf("batcher{name=%s queue=%d enq=%d ok=%d fail=%d drop=%d}",
        b.cfg.Name, s.QueueDepth, s.Enqueued, s.FlushedOK, s.FlushedFail, s.DroppedOnShutdown)
}
```

This is approximately 250 lines and is what a middle engineer would commit. It has:

- Generic type parameter `[T any]` for items.
- Configurable name, size, delay, queue depth, flush timeout.
- Bounded shutdown.
- The four metrics.
- Atomic counters for sanity tally.
- Idempotent Add-after-Close.
- Idempotent Shutdown.
- Panic recovery in the run loop.
- Per-flush timeout via context.

It is missing (deferred to senior.md):

- Double-buffer pattern.
- Adaptive sizing.
- Per-tenant fairness.
- Manual flush.
- Retry layer (we externalise it via a `RetryingSink`).

## Worked Example: Wiring the Batcher Into a Service

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"

    "myservice/batcher"
)

type Event struct {
    UserID string
    Action string
    TS     time.Time
}

type PGSink struct {
    pool *pgxpool.Pool
}

func (p *PGSink) Write(ctx context.Context, batch []Event) error {
    conn, err := p.pool.Acquire(ctx)
    if err != nil {
        return err
    }
    defer conn.Release()
    rows := make([][]any, len(batch))
    for i, e := range batch {
        rows[i] = []any{e.UserID, e.Action, e.TS}
    }
    _, err = conn.CopyFrom(ctx, pgx.Identifier{"events"},
        []string{"user_id", "action", "ts"}, pgx.CopyFromRows(rows))
    return err
}

func main() {
    ctx := context.Background()
    pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
    if err != nil {
        slog.Error("pool", "err", err); os.Exit(1)
    }
    defer pool.Close()

    sink := &PGSink{pool: pool}
    b, err := batcher.New(batcher.Config[Event]{
        Name:          "audit",
        MaxBatchSize:  500,
        MaxBatchDelay: 200 * time.Millisecond,
        QueueDepth:    2048,
        FlushTimeout:  5 * time.Second,
        Sink:          sink,
    })
    if err != nil {
        slog.Error("batcher", "err", err); os.Exit(1)
    }

    var wg sync.WaitGroup
    mux := http.NewServeMux()
    mux.HandleFunc("/event", func(w http.ResponseWriter, r *http.Request) {
        e := parseEvent(r)
        ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
        defer cancel()
        if err := b.Add(ctx, e); err != nil {
            http.Error(w, err.Error(), http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusAccepted)
    })
    mux.Handle("/metrics", promhttp.Handler())

    srv := &http.Server{Addr: ":8080", Handler: mux}
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            slog.Error("server", "err", err)
        }
    }()

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
    <-sigs

    slog.Info("shutting down")
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    _ = srv.Shutdown(ctx)
    if err := b.Shutdown(ctx); err != nil {
        slog.Error("batcher shutdown", "err", err)
    }
    wg.Wait()
    slog.Info("stats", "stats", b.Stats())
}

func parseEvent(r *http.Request) Event { /* ... */ return Event{} }
```

A complete service: HTTP listener, batcher, Postgres sink via pgx CopyFrom, Prometheus `/metrics`, graceful shutdown with deadline, final stats log on exit.

This is the shape of every audit-log/ingest service you will ship. The interesting parts are not the lines of code; they are the *contracts*: the ordering of `srv.Shutdown` then `b.Shutdown`, the 100 ms timeout on `Add` so a saturated batcher returns 503 quickly, the final stats line so post-mortem can verify the tally.

## How to Add a Flush() Method

Sometimes you want to flush on demand — at the end of a request, before a checkpoint, on a manual command. Add a flush request channel:

```go
type Batcher[T any] struct {
    // ...
    flushReq chan chan struct{}
}

func (b *Batcher[T]) Flush() {
    ack := make(chan struct{})
    select {
    case b.flushReq <- ack:
        <-ack
    case <-b.closeCh:
    }
}

// In run:
case ack := <-b.flushReq:
    flush("manual")
    close(ack)
```

Caller calls `b.Flush()`, the request lands in the channel, the run loop processes it on the next iteration (synchronously with the other cases), flushes, and acks. The caller blocks until the flush completes.

Use cases:

- End-of-request flush so an audit log is durable before the response goes back.
- Checkpoint boundary in a pipeline.
- Manual operator command via an admin endpoint.

Note: `Flush()` cannot be used to *replace* the time trigger; it is for explicit flush points on top.

## How to Add Adaptive Sizing

Static `MaxBatchSize` is fine when traffic is steady. But if your traffic varies 10x between night and day, a static value can leave throughput on the table at peak or add latency in the trough.

Adaptive sizing adjusts `MaxBatchSize` based on observed sink performance. A simple rule: if recent flushes are <50% full and fired by time, decrease `MaxBatchSize`; if they are full and the sink keeps up, increase.

```go
func (b *Batcher[T]) adaptSize(recentFlushes []flushRecord) {
    if len(recentFlushes) < 10 {
        return
    }
    var avgSize float64
    var anyError bool
    var totalDur time.Duration
    for _, r := range recentFlushes {
        avgSize += float64(r.size) / float64(len(recentFlushes))
        if r.err != nil {
            anyError = true
        }
        totalDur += r.duration
    }
    avgDur := totalDur / time.Duration(len(recentFlushes))
    if anyError {
        b.maxSize = max(b.minSize, b.maxSize/2)
        return
    }
    if avgSize > float64(b.maxSize)*0.9 && avgDur < b.cfg.FlushTimeout/2 {
        b.maxSize = min(b.absMaxSize, b.maxSize+b.maxSize/4)
    } else if avgSize < float64(b.maxSize)*0.3 {
        b.maxSize = max(b.minSize, b.maxSize-b.maxSize/4)
    }
}
```

This is a junior-level adaptive sizer; senior.md goes into the control theory.

## How to Add a Circuit Breaker

When the sink is unhealthy, retry storms make things worse. Wrap the sink in a circuit breaker:

```go
type CircuitSink[T any] struct {
    inner    Sink[T]
    breaker  *gobreaker.CircuitBreaker
}

func (c *CircuitSink[T]) Write(ctx context.Context, batch []T) error {
    _, err := c.breaker.Execute(func() (any, error) {
        return nil, c.inner.Write(ctx, batch)
    })
    return err
}
```

When the breaker is open, `Write` returns immediately with an error, and the batcher's retry layer (or DLQ) handles it. After a cool-down, the breaker tries again. See the `circuit-breaker-pattern` skill for the full pattern.

## Closing Out the Middle Level

You have now learned to build a production batcher with:
- Both triggers, graceful shutdown.
- Retries and DLQ.
- The four core metrics.
- Real sink integrations.
- Multi-tenant patterns.
- Deterministic tests.
- A runbook for operations.

This is the skill level expected of a middle Go engineer working on data pipelines. Most production batchers in production are at this quality level.

The next levels go further: senior covers architecture, professional covers internals. But the middle is where the bulk of production work happens.

Practice the patterns. Build batchers for your real workloads. Read the source of OpenTelemetry, Vector, Prometheus. You will see the patterns again and again.

## A Note on Composing Patterns

Production batchers often combine with several patterns from this concurrency track:

- **Worker pool**: multiple workers, each a batcher (sharded).
- **Fan-out**: items dispatched to multiple batchers (per-destination).
- **Pipeline**: stages of batchers (rare; mostly anti-pattern).
- **Context cancellation**: shut down in response to signals.
- **Errgroup**: coordinate multiple batcher goroutines on errors.

Knowing these patterns and how they compose with batchers is the middle-level toolkit.

## A Worked Operational Drill

A scenario for the operator on call.

### Day -1

Service deployed with audit log batcher. MaxBatchSize=500, MaxBatchDelay=200ms. Everything green.

### Day 0: 02:00

Alert: `batcher_queue_depth{name="audit"} > 80%` for 5 minutes.

On-call wakes up. Pulls up dashboard.

- Queue depth: 90% of cap.
- Flush duration p99: 2 seconds (up from 100ms).
- Flush failure rate: 0%.

Diagnosis: sink is slow.

Action: check downstream (Postgres). `pg_stat_activity` shows 20 concurrent transactions, all waiting on a single lock.

Root cause: a poorly-tuned analytical query holding a lock.

Mitigation: kill the analytical query. Locks release. Postgres recovers. Batcher catches up.

### Day 0: 02:15

Alerts clear. Service stable. On-call goes back to sleep.

### Day 0: 09:00

Post-mortem:
- Add CI test for "no analytical queries on the OLTP DB during business hours".
- Add an explicit alert on Postgres lock wait.
- Document the batcher's degradation behavior in the runbook.

This is what good operations look like. Calm; methodical; learn-from.

## More on Testing Edge Cases

A middle-level engineer thinks through test cases methodically.

### Shutdown During Flush

```go
func TestShutdownDuringFlush(t *testing.T) {
    block := make(chan struct{})
    sink := &BlockingSink{block: block}
    b, _ := batcher.New(...)
    
    for i := 0; i < 5; i++ {
        b.Add(ctx, i)
    }
    
    // Trigger flush by waiting; sink will block.
    go func() { close(block) }() // unblock after 100ms
    
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    err := b.Shutdown(ctx)
    if err != nil {
        t.Fatal(err)
    }
}
```

### Shutdown With Large Backlog

```go
func TestShutdownLargeBacklog(t *testing.T) {
    sink := &SlowSink{delay: 100 * time.Millisecond}
    b, _ := batcher.New(... MaxBatchSize=100 ...)
    
    for i := 0; i < 10000; i++ {
        b.Add(ctx, i)
    }
    
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    err := b.Shutdown(ctx)
    if err != nil {
        t.Logf("shutdown timed out, expected: %v", err)
    }
    
    stats := b.Stats()
    t.Logf("flushed: %d, dropped: %d", stats.FlushedOK, stats.DroppedOnShutdown)
}
```

### Concurrent Add and Shutdown

```go
func TestConcurrentAddAndShutdown(t *testing.T) {
    sink := &FakeSink{}
    b, _ := batcher.New(...)
    
    go func() {
        time.Sleep(10 * time.Millisecond)
        b.Shutdown(context.Background())
    }()
    
    for i := 0; i < 1000; i++ {
        err := b.Add(context.Background(), i)
        if errors.Is(err, batcher.ErrClosed) {
            break // expected after Shutdown
        }
    }
    
    // No panic; some items may be lost. Verify.
}
```

### Multiple Shutdown Calls

```go
func TestMultipleShutdowns(t *testing.T) {
    sink := &FakeSink{}
    b, _ := batcher.New(...)
    
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            b.Shutdown(context.Background())
        }()
    }
    wg.Wait()
    // No panic.
}
```

These are the tests a middle-level engineer writes. Cover the race conditions and edge cases that production will encounter.

## Common Pitfalls

- **No shutdown deadline**: `Close()` hangs if the sink does. Always `Shutdown(ctx)`.
- **No retry policy**: errors silently lost. Always classify and retry transients.
- **No dead-letter**: permanent errors keep retrying. Always DLQ.
- **No metrics**: black box. Always emit the four.
- **Synchronous flush blocks accumulation**: under high load, double-buffer or accept the backpressure.
- **Per-tenant unbounded**: one tenant can OOM the process. Always cap.
- **Mixing producer-side close and consumer-side close**: pick one (consumer-side via `closeCh`).
- **Tests that sleep**: flaky in CI. Use fake clocks.

## Self-Assessment

- [ ] I can write a `Shutdown(ctx)` that respects a deadline.
- [ ] I can classify errors as permanent, transient, throttle, and partial.
- [ ] I can wire a `RetryingSink` decorator.
- [ ] I can list the four metrics every batcher emits and explain what each one tells me.
- [ ] I can convert a synchronous-flush batcher to a double-buffer batcher and explain the trade-off.
- [ ] I can integrate a batcher with `database/sql` multi-row INSERT, including parameter-limit awareness.
- [ ] I can integrate a batcher with `pgx.CopyFrom`.
- [ ] I can integrate a batcher with a Kafka producer and discuss per-key ordering.
- [ ] I can write a fake-clock test for the time trigger.
- [ ] I can write a runbook entry for "throughput is low".

## Summary

Junior: a batcher is one goroutine, two triggers, a synchronous flush.

Middle: a batcher is one goroutine, four triggers (size, time, close, manual), a flush pipeline with retries and dead-letters, four metrics emitted, integrated with concrete sinks, tested with fake clocks, and operated from a runbook.

The core algorithm did not change. Everything around it grew up. The next file, `senior.md`, takes a step further: architectural concerns — adaptive batch sizing, multi-tenant fairness, latency budgeting, backpressure composition at the system level.
