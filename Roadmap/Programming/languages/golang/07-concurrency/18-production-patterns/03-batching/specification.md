---
layout: default
title: Specification
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/specification/
---

# Batching — Formal Specification

This file gives a formal contract for a production batcher. Copy it into your design docs; refine it for the specific batcher you are shipping.

---

## 1. Definitions

- **Item**: a value of type `T` accepted via `Add`.
- **Buffer**: an internal slice holding items not yet flushed.
- **Batch**: the contents of the buffer at the moment of a flush.
- **Sink**: the downstream destination, implementing `Write(ctx, batch) error`.
- **Flush**: a single call to `sink.Write` with one batch.
- **Trigger**: the condition that initiates a flush.
- **MaxBatchSize**: a positive integer; the maximum batch size.
- **MaxBatchDelay**: a positive duration; the maximum time an item may wait in the buffer.

## 2. Public API

```go
type Batcher[T any] interface {
    Add(ctx context.Context, item T) error
    Shutdown(ctx context.Context) error
    Stats() Stats
}

type Sink[T any] interface {
    Write(ctx context.Context, batch []T) error
}
```

## 3. Triggers

A flush is initiated by exactly one of:

- **Size**: `len(buffer) >= MaxBatchSize` after the most recent `Add`.
- **Time**: at least `MaxBatchDelay` has elapsed since the first item was added to the current batch.
- **Shutdown**: `Shutdown` has been called and the buffer is non-empty.
- **Manual**: `Flush()` has been called (if implemented).

Triggers are mutually exclusive per flush; each flush has exactly one reason.

## 4. Invariants

I1. **Single ownership**: at any moment, the buffer is owned by exactly one goroutine (the run loop). No other goroutine may read or write the buffer.

I2. **No loss before flush**: an item accepted by `Add` (i.e., `Add` returned nil) is in either the input channel, the buffer, or has been passed to `sink.Write`. It is never in two places, never lost.

I3. **Batch immutability**: the slice passed to `sink.Write` is owned by the sink for the duration of the call. The batcher does not modify it. After the call returns, the batcher may reclaim or discard.

I4. **Defensive copy**: the batcher makes a fresh allocation for each batch passed to the sink. Reusing the internal buffer slice is forbidden.

I5. **Trigger discipline**: after a size or time trigger, the buffer is empty (`len(buffer) == 0`).

I6. **Shutdown completeness (with deadline)**: after `Shutdown(ctx)` returns nil, every item that `Add` accepted before `Shutdown` was called has been passed to `sink.Write`.

I7. **Shutdown completeness (timeout)**: after `Shutdown(ctx)` returns `ctx.Err()`, the buffer's remaining items are counted in `Stats.DroppedOnShutdown`.

I8. **Add after Shutdown**: `Add` after `Shutdown` returns `ErrClosed` without enqueueing the item.

## 5. Ordering Guarantees

O1. **Within batch**: items in a batch appear in the order they were `Add`-ed.

O2. **Across batches (single flusher)**: if `Add(i_1)` happens-before `Add(i_2)`, and both are passed to the sink, then `i_1` is passed to a `sink.Write` no later than `i_2`. The two items may be in the same batch (with `i_1` before `i_2` in the slice) or in different batches (with `i_1`'s batch flushing before `i_2`'s).

O3. **Across batches (multi-flusher)**: O2 does not hold. Batches are dispatched in order but may complete out of order. The sink must accept this or the multi-flusher mode must not be used.

O4. **Multi-producer interleaving**: if Add(i_1) and Add(i_2) are called from different goroutines without synchronisation, their relative order is undefined. The sink sees them in some order consistent with the channel's serialisation, but the application cannot predict which.

## 6. Durability Semantics

D1. **No persistent buffer**: the batcher's buffer is in memory. On hard process termination (SIGKILL, OOM, kernel panic), all items in the buffer are lost.

D2. **At-least-once on flush**: a flush that `sink.Write` returned nil for is considered durable. The batcher does not retry such flushes.

D3. **On error**: a flush that `sink.Write` returned an error for is retried by the retry layer (external) or surfaced to the application. The batcher itself does not retry.

D4. **At-most-once Add**: each successful `Add` enqueues exactly one item. The batcher does not duplicate.

D5. **Retries may duplicate**: if the retry layer retries a batch that was partially received by the sink, the sink sees the items twice. Idempotency at the sink is required for safety.

## 7. Backpressure Semantics

B1. **Bounded queue**: the input channel has a finite capacity.

B2. **Block on full (default)**: `Add` blocks until space is available, the context is cancelled, or `Shutdown` is called.

B3. **Context cancel during block**: if `ctx.Done()` fires while `Add` is blocked, `Add` returns `ctx.Err()` and does not enqueue the item.

B4. **No silent drop**: the default `Add` does not drop items. A separate `TryAdd` is provided for non-blocking enqueue with explicit drop semantics.

## 8. Shutdown Protocol

S1. **Initiation**: `Shutdown(ctx)` initiates the drain.

S2. **Idempotent**: calling `Shutdown` more than once is safe. Subsequent calls wait for the first call's drain to complete.

S3. **Add blocked**: after `Shutdown` is initiated, new `Add` calls return `ErrClosed`.

S4. **Drain order**: in-flight items in the input channel are drained into the buffer, the buffer is flushed (one final flush), pending flushes complete, and the run loop exits.

S5. **Deadline behavior**: if the drain exceeds `ctx`, `Shutdown` returns `ctx.Err()`. The run loop continues until done (best-effort).

S6. **Return**: `Shutdown` returns nil after a clean drain or `ctx.Err()` on timeout.

S7. **Stats**: `Stats.DroppedOnShutdown` reflects items in the buffer at deadline.

## 9. Failure Semantics

F1. **Sink panic**: a panic during `sink.Write` is recovered by the batcher. The batch is considered failed; items are lost (or, if the retry layer is wrapping, retried).

F2. **Run loop panic**: if the run loop itself panics, the batcher is considered broken. New `Add` calls eventually fail (channel never drained). Recovery is via process restart.

F3. **Sink error**: a non-panic error from `sink.Write` is logged and surfaced to the application via metrics. Whether to retry, DLQ, or drop is a policy of the retry layer, not the batcher.

## 10. Metrics

M1. The batcher exposes the following metrics:

- `batcher_enqueued_total{name}` (counter): items accepted by `Add`.
- `batcher_flushed_ok_total{name}` (counter): items in successful flushes.
- `batcher_flushed_fail_total{name}` (counter): items in failed flushes.
- `batcher_dropped_on_shutdown_total{name}` (counter): items lost on shutdown timeout.
- `batcher_batch_size_items{name}` (histogram): batch sizes.
- `batcher_flush_duration_seconds{name, result}` (histogram): flush durations.
- `batcher_flush_total{name, reason}` (counter): flushes by reason.
- `batcher_queue_depth{name}` (gauge): current input channel depth.

M2. Invariant: `enqueued = flushed_ok + flushed_fail + dropped_on_shutdown + in_flight`. The sum of the right-hand side equals the left at any moment.

## 11. Configuration

```go
type Config[T any] struct {
    Name          string         // for metrics labels
    MaxBatchSize  int            // > 0
    MaxBatchDelay time.Duration  // > 0
    QueueDepth    int            // > 0; default 1024
    FlushTimeout  time.Duration  // > 0; default 5s
    Sink          Sink[T]        // required
    Logger        Logger         // optional
    Clock         Clock          // for tests; default real time
}
```

C1. `MaxBatchSize` must be positive. Zero or negative causes `New` to return an error.

C2. `MaxBatchDelay` must be positive. Zero or negative causes `New` to return an error.

C3. `QueueDepth` defaults to 1024 if zero or negative.

C4. `FlushTimeout` defaults to 5 seconds if zero or negative.

C5. `Sink` is required. Nil causes `New` to return an error.

## 12. Error Types

```go
var (
    ErrClosed = errors.New("batcher: closed")
    ErrConfig = errors.New("batcher: invalid configuration")
)
```

E1. `Add` returns `ErrClosed` if called after `Shutdown` is initiated.

E2. `Add` returns `ctx.Err()` (a `context.Canceled` or `context.DeadlineExceeded`) if the context is cancelled before the enqueue completes.

E3. `New` returns an error wrapping `ErrConfig` if the configuration is invalid.

## 13. Test Vectors

The implementation MUST pass:

T1. `TestSizeTrigger`: send `2 * MaxBatchSize` items; expect 2 size-triggered flushes.

T2. `TestTimeTrigger`: send 1 item; wait `2 * MaxBatchDelay`; expect 1 time-triggered flush.

T3. `TestShutdownDrain`: send `MaxBatchSize - 1` items; Shutdown; expect 1 shutdown-triggered flush with all items.

T4. `TestShutdownTimeout`: use a slow sink; Shutdown with short context; expect `context.DeadlineExceeded` and `DroppedOnShutdown > 0`.

T5. `TestIdempotentShutdown`: call Shutdown twice; second call is a no-op (waits for first to complete).

T6. `TestAddAfterShutdown`: call Shutdown, then Add; expect `ErrClosed`.

T7. `TestNoLoss`: send `N` items concurrently from multiple goroutines, Shutdown, expect sink to receive exactly `N` items in total.

T8. `TestContextCancellation`: with full channel, Add with short-context; expect `context.DeadlineExceeded`.

T9. `TestConcurrentAdd`: from `numProducers` goroutines, each Add `N` items; expect `numProducers * N` items in sink after Shutdown.

T10. `TestStatsConservation`: after Shutdown, `enqueued == flushed_ok + flushed_fail + dropped_on_shutdown`.

## 14. Implementation Notes

This specification does not mandate the run-loop architecture. Implementations may use:

- Channel-based single-goroutine run loop (the canonical Go approach).
- Mutex-based with `time.AfterFunc` (acceptable when integrating with callback-driven contexts).
- Lock-free with atomic ops (rare; for ultra-high-throughput).

The specification mandates the *observable behavior*, not the internal mechanism.

## 15. Open Questions

- Should `Add` return a future/promise that resolves when the item is durable? Out of scope for this spec; can be layered above.
- Should `Flush()` be part of the public API? Optional; recommended for end-of-request fence cases.
- Should the sink interface include batch metadata (e.g., reason, attempt number)? Useful but increases coupling; consider for v2 of the spec.

## 16. Versioning

This specification is v1. Breaking changes to public API (method signatures, error types) trigger a major version. Adding methods or fields without breaking is a minor version. Bug fixes are patch versions.

---

## Appendix A: Pseudo-Code Reference Implementation

```
function run(b):
    buf = []
    ticker = NewTicker(b.MaxBatchDelay)
    while true:
        select:
            case item, ok = <-b.in:
                if !ok:
                    flush(buf, "shutdown")
                    DroppedOnShutdown += len(buf in flight)
                    return
                buf = append(buf, item)
                if len(buf) >= b.MaxBatchSize:
                    flush(buf, "size")
                    buf = []
            case <-ticker.C:
                if len(buf) > 0:
                    flush(buf, "time")
                    buf = []
```

## Appendix B: Glossary

See junior.md for the full glossary.

## Appendix C: Related Specifications

- HTTP graceful shutdown (Go `http.Server.Shutdown`): inspires the `Shutdown(ctx) error` shape.
- OpenTelemetry SDK specification: BatchSpanProcessor is the canonical reference for batchers.
- Kafka Producer API: `Produce(record, callback)` is the inspiration for the async-with-error-callback shape.

## Appendix B-bis: Formal Notation

For readers who like more precision, here is the spec in a quasi-formal notation.

### State

```
S = (
    in:    chan T,
    buf:   []T,
    done:  chan {},
    close: chan {},
    stats: Stats,
)
```

### Add Pre/Post

```
Add(ctx, item):
    pre:  ctx is not nil
    post:
        either (ret = nil and item is in in) 
        or     (ret = ctx.Err() and item is not in in)
        or     (ret = ErrClosed and item is not in in)
```

### Shutdown Pre/Post

```
Shutdown(ctx):
    pre:  ctx is not nil
    post:
        close was triggered
        either (ret = nil and buf is empty and done is closed)
        or     (ret = ctx.Err() and stats.DroppedOnShutdown reflects buf at deadline)
```

### Run Loop Invariant

```
At every step of the run loop:
    buf is owned by this goroutine
    len(buf) <= MaxBatchSize
    For any item in buf:
        Add(item) happened-before this iteration
```

This notation is mostly for design-doc reading. It maps to the prose above.

## Appendix C-bis: Worked Examples of Spec Violations

These are anti-examples — implementations that look correct but violate the spec.

### Violation V1: Buffer Shared With Sink

```go
func (b *Batcher) flush() {
    b.sink.Write(b.buf) // hands the internal buffer directly
    b.buf = b.buf[:0]
}
```

Violates I3 and I4. If the sink stores the slice, it later sees overwritten data.

### Violation V2: Shutdown With No Drain

```go
func (b *Batcher) Shutdown(ctx context.Context) error {
    close(b.in)
    return nil
}
```

Violates I6: items in the buffer are silently lost.

### Violation V3: Multi-Trigger in One Flush

```go
case <-ticker.C:
    flush(buf, "time")
    if len(buf) > maxSize { // never true, but conceptually
        flush(buf, "size")
    }
```

Violates the trigger discipline that each flush has exactly one reason.

### Violation V4: Add After Close Panics

```go
func (b *Batcher) Add(ctx context.Context, item T) error {
    b.in <- item
    return nil
}
```

Violates I8: after `Shutdown`, the channel is closed, and `b.in <- item` panics. The spec requires `ErrClosed` instead.

### Violation V5: Unbounded Queue

```go
in: make(chan T, math.MaxInt32)
```

Violates B1: backpressure is invisible to producers; memory grows.

### Violation V6: Silent Drop in Add

```go
func (b *Batcher) Add(ctx context.Context, item T) error {
    select {
    case b.in <- item:
    default:
    }
    return nil
}
```

Violates B4: items can be silently dropped without the caller knowing. Acceptable for `TryAdd`, not for `Add`.

### Violation V7: Sink Called with Empty Batch

```go
case <-ticker.C:
    flush(buf, "time") // even if len(buf) == 0
```

Wastes a flush call. Implementation choice; spec recommends but does not strictly forbid.

### Violation V8: No Defensive Copy

```go
func (b *Batcher) flush() {
    batch := b.buf // alias, not copy
    b.sink.Write(batch)
    b.buf = b.buf[:0]
}
```

Same as V1. Silent corruption.

## Appendix C-ter: Worked Spec-Compliant Implementation

The full implementation from middle.md is spec-compliant. Key compliance points:

- Buffer owned by run loop only: I1.
- Items go to channel then buffer then sink: I2.
- Defensive copy in flush: I3, I4.
- buf = buf[:0] after each flush: I5.
- Shutdown drains buffer: I6.
- DroppedOnShutdown counter: I7.
- closeCh checked in Add: I8.
- Channel preserves arrival order: O1, O2.
- Single-flusher mode preserves order across batches: O2.
- In-memory only: D1.
- No internal retries: D3.
- At-most-once Add: D4.
- Bounded channel: B1.
- Block-on-full default: B2.
- ctx.Done in Add: B3.
- No silent drop in Add: B4.
- Idempotent Shutdown via sync.Once: S2.
- Add returns ErrClosed: S3.
- Drain before exit: S4.
- Deadline behavior: S5, S6.
- Stats reflects loss: S7.
- Panic recovery in run loop: F1.
- All four metrics: M1.
- Tally invariant: M2.
- Validation in New: C1-C5.

## Appendix D: Optional Extensions

### Manual Flush

```go
type FlushableBatcher[T any] interface {
    Batcher[T]
    Flush(ctx context.Context) error
}
```

`Flush(ctx)` synchronously drains the current buffer, returning when the flush completes or `ctx` cancels. Use cases: end-of-request fence, checkpoint boundary, operator command.

Semantics:
- F1. `Flush` blocks until the in-flight batch (if any) and the current buffer have been passed to `sink.Write`.
- F2. `Flush` does not stop the batcher. After return, `Add` continues to work.
- F3. Concurrent `Flush` calls are serialised; each returns when its triggered flush completes.

### TryAdd

```go
type DroppingBatcher[T any] interface {
    Batcher[T]
    TryAdd(item T) bool
}
```

`TryAdd` enqueues without blocking. Returns `true` on success, `false` if the queue is full.

Semantics:
- TA1. `TryAdd` never blocks.
- TA2. `TryAdd` returns false if the queue is full or the batcher is closed.
- TA3. `TryAdd` increments a counter on drop so the application can observe rate of drops.

### AddBatch

```go
type BulkBatcher[T any] interface {
    Batcher[T]
    AddBatch(ctx context.Context, items []T) error
}
```

`AddBatch` enqueues multiple items atomically. Either all items are enqueued or none are (atomic against shutdown). Useful when the producer already has a slice and wants to avoid one-at-a-time enqueue overhead.

Semantics:
- AB1. If the queue has space for at least `len(items)` items at the moment of the call, all are enqueued.
- AB2. If not enough space and ctx not cancelled, blocks until space is available, then enqueues all atomically.
- AB3. If ctx cancels before enqueue, none of the items are enqueued; returns ctx.Err().

### AddWithAck

```go
type AckableBatcher[T any] interface {
    Batcher[T]
    AddWithAck(ctx context.Context, item T) (<-chan error, error)
}
```

Returns a channel that will receive the flush result for the batch containing this item.

Semantics:
- AA1. The returned channel is buffered (cap 1) so the batcher need not block on it.
- AA2. The channel receives `nil` if the flush succeeded, or the flush error otherwise.
- AA3. The channel is closed after the result is sent.
- AA4. If the item is in a batch that never flushes (e.g., dropped on shutdown), the channel receives an error.

This is the synchronous-confirmation pattern for items that need durability acknowledgement.

## Appendix E: Compatibility Notes

### Go Version Requirements

This specification assumes Go 1.18+ for generics. Earlier versions can implement the spec with `interface{}` items and a type-asserted Write callback, but the API surface differs.

### Library Dependencies

The reference implementation depends on:

- `context` (stdlib).
- `sync` and `sync/atomic` (stdlib).
- `time` (stdlib).
- A metrics library (Prometheus, OpenMetrics) for the metrics interface.

No third-party batcher libraries are required.

### Interoperability

A batcher implementing this spec can be used with any sink implementing the `Sink[T]` interface. Common sinks:

- `database/sql` wrapped sinks.
- `pgx.CopyFrom` wrapped sinks.
- Kafka producer (franz-go, confluent-kafka-go, sarama) wrapped sinks.
- HTTP bulk endpoints (Elastic, Splunk, Datadog, BigQuery) wrapped sinks.
- File sinks (audit logs, append-only files).

Sink wrappers (retry, circuit breaker, rate limiter) compose with any spec-compliant batcher and any spec-compliant sink.

## Appendix F: Glossary of Spec Terms

- **Invariant**: a property that holds at every observable state.
- **Pre-condition**: a condition that must be true for an operation to be valid.
- **Post-condition**: a condition that is guaranteed true after an operation completes.
- **Happens-before**: a partial order on operations; if `A` happens-before `B`, then `A`'s effects are visible to `B`.
- **At-most-once**: a delivery guarantee that says items may be lost but never duplicated.
- **At-least-once**: a delivery guarantee that says items may be duplicated but never lost.
- **Exactly-once**: a delivery guarantee that says items are delivered exactly one time. Hard to achieve in distributed systems.

## Appendix G: Standard Conformance Test Suite

The following tests are recommended for any implementation claiming spec compliance:

```go
func TestSpecCompliance(t *testing.T, newBatcher func(Sink[int]) Batcher[int]) {
    t.Run("size trigger", testSizeTrigger(newBatcher))
    t.Run("time trigger", testTimeTrigger(newBatcher))
    t.Run("shutdown drain", testShutdownDrain(newBatcher))
    t.Run("shutdown timeout", testShutdownTimeout(newBatcher))
    t.Run("idempotent shutdown", testIdempotentShutdown(newBatcher))
    t.Run("add after shutdown", testAddAfterShutdown(newBatcher))
    t.Run("no loss", testNoLoss(newBatcher))
    t.Run("context cancellation", testContextCancellation(newBatcher))
    t.Run("concurrent add", testConcurrentAdd(newBatcher))
    t.Run("stats conservation", testStatsConservation(newBatcher))
}
```

A passing run of `TestSpecCompliance` is the bar for spec-compliant.

## Appendix I: Change Log

- v1.0 (initial): full spec as above.

---

This specification is a contract. A batcher implementation that violates it is broken regardless of its tests. Use this document as the source of truth.

## Appendix J: Migration From v0 to v1

If your batcher was implemented before this spec, you may need migration. Common changes:

### From Close to Shutdown

```go
// v0
func (b *Batcher) Close()

// v1
func (b *Batcher) Shutdown(ctx context.Context) error
```

The new Shutdown takes a context for deadline; returns error for failure.

### From No-Stats to Stats

Add atomic counters:
- enqueued
- flushedOK
- flushedFail
- droppedOnShutdown

Expose via `Stats() Stats` method.

### From Forever-Block Add to ContextAdd

```go
// v0
func (b *Batcher) Add(item T)

// v1
func (b *Batcher) Add(ctx context.Context, item T) error
```

New signature respects context cancellation.

### From Channel Public to Channel Private

If v0 exposed `b.In` as a public channel, hide it. Use `Add` method exclusively. Prevents producer-side close mistakes.

### Migration Path

1. Add new methods alongside old.
2. Mark old as deprecated.
3. Migrate callers over several releases.
4. Remove old methods.

## Appendix K: Future Extensions

Reserved for future spec versions:

- **v1.1**: Manual `Flush(ctx)` method (currently optional).
- **v1.2**: Per-flush metadata (priority, deadline).
- **v2.0**: Pluggable trigger system (size, time, byte size, custom).

These will be added in backward-compatible ways or with major version bumps as appropriate.

## Appendix L: Interoperability With Other Patterns

The Batcher composes with other patterns. Standard interfaces:

### With Retry

```go
type RetryableSink[T any] interface {
    Sink[T]
    IsRetryable(error) bool
}
```

A retry layer wraps a Sink; the inner Sink may implement IsRetryable for fine-grained decisions.

### With Circuit Breaker

```go
type BreakerSink[T any] struct {
    inner Sink[T]
    breaker *gobreaker.CircuitBreaker
}
```

Standard pattern. No special spec needed.

### With Metrics

```go
type MetricsSink[T any] struct {
    inner Sink[T]
    name string
}
```

Wraps any Sink with metrics emission.

## Appendix M: A Note on Style

Spec documents err on the side of formality. The trade-off is readability.

For internal team documents, a less-formal version is fine:

- Drop the I1-I8 numbering.
- Use prose paragraphs.
- Skip the formal notation.

The content should be the same. The form serves the readers.

## Appendix N: References

- Go memory model: go.dev/ref/mem.
- OpenTelemetry Specification: github.com/open-telemetry/opentelemetry-specification.
- Kafka Producer Protocol: kafka.apache.org/protocol.html.
- Postgres COPY: postgresql.org/docs/current/sql-copy.html.
- LMAX Disruptor: lmax-exchange.github.io/disruptor.

These are the upstream specifications and implementations that inform this batcher spec.
