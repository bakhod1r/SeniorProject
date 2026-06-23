---
layout: default
title: Batching Stages — Middle
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/middle/
---

# Batching Stages — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Designing the Trigger Loop Beyond Junior](#designing-the-trigger-loop-beyond-junior)
5. [Timers vs Tickers in Practice](#timers-vs-tickers-in-practice)
6. [The Flush-Reason Tag](#the-flush-reason-tag)
7. [Flush on Cancellation, Done Right](#flush-on-cancellation-done-right)
8. [End-of-Stream Flush Variants](#end-of-stream-flush-variants)
9. [Buffer Reuse and the `s = s[:0]` Idiom](#buffer-reuse-and-the-s--s0-idiom)
10. [Per-Key Batching](#per-key-batching)
11. [When to Split into a Separate Flusher Goroutine](#when-to-split-into-a-separate-flusher-goroutine)
12. [Composing Batching Into a Real Pipeline](#composing-batching-into-a-real-pipeline)
13. [Testing With Time](#testing-with-time)
14. [Metrics, Logging, and Tracing](#metrics-logging-and-tracing)
15. [Tuning `maxSize` and `maxWait`](#tuning-maxsize-and-maxwait)
16. [Common Production Bugs at This Tier](#common-production-bugs-at-this-tier)
17. [Worked Example — Kafka-Style Producer](#worked-example--kafka-style-producer)
18. [Worked Example — Per-Tenant Batched Writes](#worked-example--per-tenant-batched-writes)
19. [Worked Example — Two-Stage Batching with Compression](#worked-example--two-stage-batching-with-compression)
20. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
21. [Self-Assessment Checklist](#self-assessment-checklist)
22. [Summary](#summary)
23. [Further Reading](#further-reading)

---

## Introduction

> Focus: "I know the triple-trigger select-loop. What are the real production-tier refinements?"

At the junior level we wrote one shape of batching stage: a single goroutine with a triple-trigger select-loop, a sync flush, and a `defer close(out)`. That covers ninety percent of production needs. The remaining ten percent — and most of the engineering interest — lives at this tier.

This file teaches the refinements that turn a "correct but vanilla" batching stage into a production-grade component: timer-vs-ticker decisions, per-key batching, when to split into a flusher goroutine, how to bound and tag batches with a flush reason for observability, how to test the time trigger without flakiness, how to choose `maxSize` and `maxWait` against an SLO, and how to compose batching into a real multi-stage pipeline.

After reading this file you will:

- Decide between `*time.Timer` and `*time.Ticker` with confidence.
- Tag every batch with the reason it flushed (`size`, `time`, `close`, `cancel`) and use that tag in metrics and tests.
- Write a per-key batching stage that flushes each key independently.
- Decide when to split into a separate flusher goroutine — and when *not* to.
- Test the time trigger deterministically with a fake clock.
- Tune `maxSize` and `maxWait` against a latency SLO using a back-of-envelope calculation.
- Compose batching with fan-out and fan-in patterns from the surrounding folders.

You do not need to know about adaptive sizing, allocation-free buffer pools, or queue-theoretic capacity planning yet. Those come at senior and professional levels.

---

## Prerequisites

- All of junior.md. You should be able to write the canonical triple-trigger accumulator from memory.
- Familiarity with `context.Context`, `select`, `time.Timer`, `time.Ticker`, and `sync.WaitGroup`.
- A first reading of the cancellation propagation page (folder 02 in this track). Batching's cancellation semantics build on those.
- Comfort with table-driven tests in `testing.T`.

You should be able to write, in 10 minutes, a `TestBatch_FlushesPartialOnInputClose` test and have it pass. If you cannot, return to junior.md.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Flush reason** | A tag associated with each flush (`size`, `time`, `close`, `cancel`) used in metrics and tests. |
| **Per-key batching** | A pattern where the accumulator maintains a separate buffer per logical key (tenant, shard, partition). |
| **Flusher goroutine** | A second goroutine downstream of the accumulator whose job is to *do* the flush (e.g. call the DB). The accumulator dispatches; the flusher executes. |
| **Bounded in-flight** | A constraint that no more than N batches are concurrently being flushed. |
| **Fake clock** | A test double for `time.Now`, `time.Sleep`, and `time.NewTimer` that the test advances manually for determinism. |
| **Drain on cancel** | The shutdown variant where the accumulator continues reading `in` after `ctx.Done()` until `in` closes, instead of returning immediately. |
| **SLO** | Service Level Objective, e.g. "p99 latency < 100 ms." Tuning `maxWait` is bounded by the SLO. |
| **Coalesce** | Merge consecutive items with the same key into one (relevant for some per-key designs). |

---

## Designing the Trigger Loop Beyond Junior

The junior loop did exactly what was needed and no more. At middle tier we add a few touches.

### Touch 1 — Tag the flush reason

A `flush()` that takes no arguments cannot report *why* it flushed. Instrumentation needs the reason. Refactor:

```go
type flushReason int

const (
    reasonSize flushReason = iota
    reasonTime
    reasonClose
    reasonCancel
)

func (r flushReason) String() string {
    switch r {
    case reasonSize: return "size"
    case reasonTime: return "time"
    case reasonClose: return "close"
    case reasonCancel: return "cancel"
    }
    return "unknown"
}
```

Then change `flush` to take a reason:

```go
flush := func(r flushReason) {
    if len(buf) == 0 { return }
    batch := snapshot(buf)
    buf = buf[:0]
    disarmTimer()
    metricFlushes.WithLabelValues(r.String()).Inc()
    metricBatchSize.Observe(float64(len(batch)))
    select {
    case out <- batch:
    case <-ctx.Done():
    }
}
```

Now every flush is tagged. You can build a Grafana panel showing flush reason distribution; it tells you whether your pipeline is operating in size-bound or time-bound regime.

### Touch 2 — Add a configurable empty-flush policy

By default we early-return when the buffer is empty. Sometimes the downstream stage *wants* a heartbeat — an empty batch arriving every `maxWait` confirms the accumulator is alive. Make this configurable:

```go
type Config struct {
    MaxSize       int
    MaxWait       time.Duration
    EmptyOnTime   bool // if true, time trigger fires even when buffer is empty
}
```

Default `false`. Document the case where you'd flip it (downstream is a heartbeat-aware consumer).

### Touch 3 — Add an output-channel cap parameter

In production you want to choose the output buffer size based on the throughput-latency trade-off, not hard-code it.

```go
type Config struct {
    MaxSize       int
    MaxWait       time.Duration
    OutputCap     int  // capacity of out channel
}
```

### Touch 4 — Make `in` and `out` interfaces optional

Most code wants `chan T` parameters. Some advanced uses want a `Source[T]` interface (so the source can be replaced with a memory-mapped queue or a streaming iterator). At middle tier, stay with channels; mention the interface alternative in the docs.

---

## Timers vs Tickers in Practice

The junior file made a decisive recommendation: use `*time.Timer`, not `*time.Ticker`. Here we explain why with care, and identify the cases where a `*time.Ticker` is actually fine.

### Why Timer is the default

A `*time.Timer` armed only when the buffer is non-empty:

- Does not fire during idle periods. Zero wakeups when nothing is happening.
- Provides "max wait since first item," which is the latency semantics you want.
- Requires the stop-and-drain ritual on every flush, which is slightly fiddly.

### When Ticker is fine

A `*time.Ticker` firing every `maxWait` *regardless* of buffer state:

- Wakes the goroutine every `maxWait`. At `maxWait = 1s` this is one wakeup per second per stage — trivial.
- Provides "max wait between flushes," which is a *different* semantic.
- Does not require stop-and-drain on flush; you just call `flush` and continue.

The Ticker pattern is acceptable when:

- `maxWait` is large enough that wakeups are negligible (a second or more).
- The "max wait between flushes" semantic is acceptable. If items arrive in a steady stream, the practical latency is similar.
- The empty-flush guard inside `flush` is in place.

```go
t := time.NewTicker(maxWait)
defer t.Stop()
for {
    select {
    case x, ok := <-in:
        if !ok { flush(reasonClose); return }
        buf = append(buf, x)
        if len(buf) >= maxSize { flush(reasonSize) }
    case <-t.C:
        flush(reasonTime)  // no-op if buffer empty
    case <-ctx.Done():
        flush(reasonCancel); return
    }
}
```

Simpler code, slightly worse semantics. Both shapes are defensible.

### A pitfall with Ticker — fast-tick after pause

If your accumulator is busy in another case (e.g. flushing a big batch synchronously) and several ticker fires queue up, the Ticker collapses them (channel has capacity 1 by spec) so only one fire is delivered. This is fine in practice but worth knowing.

### Reset semantics across Go versions

In Go 1.23+ the safe `Timer.Reset` pattern changed. The fully-safe stop-and-drain works on all versions and is what we teach; the simplified form (`t.Reset(d)` without prior `Stop` and drain) only works on 1.23+ and only on timers that haven't fired. If your code must build on 1.20 or earlier, stick with stop-and-drain.

---

## The Flush-Reason Tag

We introduced the tag above. Here are its three concrete uses.

### Use 1 — Metrics

```go
flushes := prometheus.NewCounterVec(
    prometheus.CounterOpts{Name: "batching_flushes_total"},
    []string{"reason"},
)
batchSize := prometheus.NewHistogram(
    prometheus.HistogramOpts{Name: "batching_batch_size", Buckets: prometheus.ExponentialBuckets(1, 2, 12)},
)
```

A panel showing flushes by reason tells you the operating regime:

- Mostly `size`: throughput-bound, `maxWait` is irrelevant.
- Mostly `time`: latency-bound, `maxSize` is too large or traffic is low.
- Mostly `close` or `cancel`: lots of restarts or short lifecycle — investigate.

### Use 2 — Test assertions

```go
type observedFlush struct {
    reason flushReason
    items  []int
}

var observed []observedFlush

// inject a hook into flush:
flush := func(r flushReason) {
    if len(buf) == 0 { return }
    observed = append(observed, observedFlush{r, append([]int{}, buf...)})
    buf = buf[:0]
}
```

Now tests can assert "this scenario produces a `reasonSize` flush followed by a `reasonTime` flush" without depending on wall-clock timing.

### Use 3 — Conditional behavior

Some downstreams care:

```go
if reason == reasonCancel {
    // best-effort write with very short timeout
} else {
    // full retry budget
}
```

For example, an audit log might allow a longer write timeout on `reasonClose` than on `reasonCancel`.

---

## Flush on Cancellation, Done Right

We have already seen that on `ctx.Done()` we should `flush()` and return. The subtleties are about what "flush" means under cancellation.

### Sub-case 1 — Cancellation propagates to the sink

If your downstream `out` consumer also reads `ctx.Done()`, it may exit before the accumulator's cancel-case flush completes. The cancellable inner `select` makes the flush a no-op in that case. Items in `buf` are lost. **This is correct.** A `cancel` means "stop, do not block on side effects."

### Sub-case 2 — Cancellation should drain remaining input

If you want "best effort flush of everything currently in the input channel," add a drain phase:

```go
case <-ctx.Done():
    // Switch to drain mode: keep reading from in until close, but with a deadline.
    deadline := time.NewTimer(2 * time.Second)
    defer deadline.Stop()
drainLoop:
    for {
        select {
        case x, ok := <-in:
            if !ok { break drainLoop }
            buf = append(buf, x)
            if len(buf) >= maxSize { flush(reasonSize) }
        case <-deadline.C:
            break drainLoop
        }
    }
    flush(reasonCancel)
    return
```

This is the "graceful shutdown with bounded drain" pattern. It is the right choice when each item carries cost (analytics events, audit records) and dropping them on cancel is unacceptable.

### Sub-case 3 — Different cancellation contexts

Sometimes the accumulator's context is *different* from the sink's. For example, the accumulator runs forever (lifetime = process), and each batch send has its own short context. The selectable send inside `flush` then uses the per-batch context:

```go
sendCtx, sendCancel := context.WithTimeout(ctx, 500*time.Millisecond)
select {
case out <- batch:
case <-sendCtx.Done():
}
sendCancel()
```

This bounds how long the accumulator will block waiting on a slow downstream.

---

## End-of-Stream Flush Variants

End-of-stream is signaled by `in` closing. Variants:

### Variant A — Single final flush (junior default)

```go
case x, ok := <-in:
    if !ok { flush(reasonClose); return }
    ...
```

Flush the buffer once at close. Simple, correct, default.

### Variant B — Flush in chunks of `maxSize`

If the producer closes after dumping a large burst into `in`, the accumulator may have many items queued. A single huge flush could exceed downstream limits. Drain in maxSize-sized chunks:

```go
case x, ok := <-in:
    if !ok {
        for len(buf) >= maxSize {
            flush(reasonSize)
        }
        flush(reasonClose)
        return
    }
    ...
```

Note: in the canonical loop, the size trigger fires as items arrive, so `buf` cannot exceed `maxSize` at close. This variant matters only if you accept that the buffer can grow past `maxSize` between selects.

### Variant C — Drain `in` *after* close

If `in` had a buffered channel, items may still be queued at the moment `ok == false` is seen. Actually no: by Go semantics, the `<-in` returns `ok == false` only after all buffered items have been received. So this is a non-issue with stock channels.

### Variant D — End-of-stream marker via a typed value

Some pipelines use a sentinel item (e.g. `Item{EOS: true}`). Avoid. Close the channel instead — it is what channels are for.

---

## Buffer Reuse and the `s = s[:0]` Idiom

We already use `buf = buf[:0]` to reset length while keeping capacity. Here is the deeper picture.

### What it does

`buf[:0]` returns a slice header with the same underlying array, same capacity, length zero. Subsequent `append` writes into the same backing memory until the array fills. Then `append` reallocates.

### Why it matters

For high-throughput stages, per-flush allocation is a measurable cost. `make([]T, 0, maxSize)` once at function start + `buf = buf[:0]` after each flush = zero allocations on the steady-state hot path (except for the copy into `batch`).

### When `s = s[:0]` is wrong

If you have already sent `buf` itself on `out` and continue appending, the consumer's slice is corrupted (see junior.md walkthrough B3). Fix: send a copy.

### The `sync.Pool` upgrade

The copy in `flush()` is itself an allocation. To eliminate it, use a `sync.Pool` of pre-allocated batch slices:

```go
var pool = sync.Pool{
    New: func() any { s := make([]T, 0, maxSize); return &s },
}

flush := func(r flushReason) {
    if len(buf) == 0 { return }
    p := pool.Get().(*[]T)
    *p = append((*p)[:0], buf...)
    buf = buf[:0]
    // ... send *p downstream; downstream returns it to pool when done
}
```

This is a senior-level optimisation, included here because the question always comes up. At middle tier the simple copy is fine.

---

## Per-Key Batching

A common production need: batch *per logical key* (tenant, shard, partition) so that one slow tenant does not block another tenant's flushes.

### Design A — Map of buffers, single accumulator

```go
type item struct { Key, Body string }

type keyState[T any] struct {
    buf   []T
    timer *time.Timer
}

func BatchByKey(
    ctx context.Context,
    in <-chan item,
    out chan<- []item,
    maxSize int,
    maxWait time.Duration,
) {
    defer close(out)
    states := map[string]*keyState[item]{}

    flush := func(key string, r flushReason) {
        st, ok := states[key]
        if !ok || len(st.buf) == 0 { return }
        batch := append([]item(nil), st.buf...)
        st.buf = st.buf[:0]
        if st.timer != nil {
            if !st.timer.Stop() { select { case <-st.timer.C: default: } }
        }
        select {
        case out <- batch:
        case <-ctx.Done():
        }
    }

    flushAll := func(r flushReason) {
        for k := range states { flush(k, r) }
    }

    // We need a single select case for "any timer fired." Multiplex via a
    // shared channel.
    timerFired := make(chan string, 64)
    armTimer := func(key string) {
        st := states[key]
        if st.timer == nil {
            t := time.AfterFunc(maxWait, func() {
                select { case timerFired <- key: default: }
            })
            st.timer = t
        }
    }

    for {
        select {
        case x, ok := <-in:
            if !ok { flushAll(reasonClose); return }
            st, found := states[x.Key]
            if !found {
                st = &keyState[item]{buf: make([]item, 0, maxSize)}
                states[x.Key] = st
            }
            if len(st.buf) == 0 { armTimer(x.Key) }
            st.buf = append(st.buf, x)
            if len(st.buf) >= maxSize { flush(x.Key, reasonSize) }
        case k := <-timerFired:
            flush(k, reasonTime)
        case <-ctx.Done():
            flushAll(reasonCancel); return
        }
    }
}
```

Notes:

- We use `time.AfterFunc` because each key needs its own timer, and there is no clean way to `select` on a dynamic number of channels. The callback writes the key to a shared `timerFired` channel.
- The `timerFired` channel has a small buffer (64) and a non-blocking send so the callback never blocks.
- The map cleanup is omitted for brevity; in production, evict keys with empty buffers after a few `maxWait` cycles to avoid unbounded map growth.

### Design B — One accumulator per key

If the keys are few (e.g. <100 tenants) and stable, spawn one accumulator per key:

```go
perKeyIn := map[string]chan item{}
perKeyOut := map[string]chan []item{}
for _, k := range knownKeys {
    perKeyIn[k] = make(chan item, 64)
    perKeyOut[k] = make(chan []item, 4)
    go Batch(ctx, perKeyIn[k], perKeyOut[k], maxSize, maxWait)
}

// Router
go func() {
    for x := range in {
        select {
        case perKeyIn[x.Key] <- x:
        case <-ctx.Done():
            return
        }
    }
    for _, ch := range perKeyIn { close(ch) }
}()
```

This is simpler than Design A (no map-of-state, no AfterFunc) at the cost of more goroutines. For < few hundred keys, it is the cleaner choice.

### Design C — Hybrid

Pre-shard into a fixed number of accumulators (e.g. 16) by `hash(key) % 16`. Within each, items mix freely; across shards, no cross-talk. This bounds the goroutine count and simplifies routing.

---

## When to Split into a Separate Flusher Goroutine

The junior pattern was: accumulator does both accumulation and (synchronously) sends the batch downstream. The flush is one of the goroutine's responsibilities.

In some designs you want a separate goroutine to *do* the send. This is the "flusher" or "writer" goroutine.

### Pattern

```go
batches := make(chan []T, 1)

// Accumulator
go func() {
    defer close(batches)
    // ... triple-trigger loop ...
    flush := func() {
        if len(buf) == 0 { return }
        b := snapshot(buf)
        buf = buf[:0]
        select {
        case batches <- b:
        case <-ctx.Done():
        }
    }
    // ...
}()

// Flusher
go func() {
    for b := range batches {
        if err := sink.Write(ctx, b); err != nil { ... }
    }
}()
```

The two are decoupled by `batches`, a channel of capacity 1.

### When to split

- When the sink call has a meaningful failure mode (retries, partial failure) that you do not want to model inside the accumulator.
- When you might want multiple flushers (parallel sink calls).
- When the sink is significantly slower than the accumulator and you want to keep the accumulator's `select` responsive.

### When NOT to split

- When the accumulator and the sink are tightly coupled (sink errors should cause accumulator to drop the batch). Splitting forces an error-channel design.
- When you want strict in-order delivery to a single sink. A single flusher preserves order; multiple parallel flushers do not.
- When the overhead of an extra goroutine matters (rare, but real in embedded contexts).

The split is a tool, not a default.

---

## Composing Batching Into a Real Pipeline

A typical production pipeline:

```
HTTP handler --> events chan ----> Batch ----> batches chan ----> Writer pool ----> Sink
                                                                       |
                                                                       v
                                                                error chan
```

Each `-->` is a channel. Each component is one or more goroutines.

The batching stage is *just one stage*. Its inputs and outputs are channels owned by neighbors. Its only responsibility is to convert one stream into the other.

### Channel ownership rules

- Each channel has exactly one closer.
- The closer is documented in the godoc of the producing stage.
- The output channel of stage N is the input channel of stage N+1.
- Stage N closes its output channel when its goroutine exits.
- Stage N+1 detects the close via `for ... range` or `ok == false` and exits.

The batching stage's role: own `out`, close it on exit. The Writer pool's role: range over `out`, exit when it closes.

### Error propagation

Errors flow back via a *separate* error channel, not the batch channel. The Writer pool sends errors on `errors chan error`; the orchestrator reads them and decides (retry, drop, panic, propagate to caller).

```go
errs := make(chan error, 1)

go func() {
    for b := range batches {
        if err := sink.Write(ctx, b); err != nil {
            select { case errs <- err: default: } // first-error-wins
            cancel() // propagate
            return
        }
    }
    close(errs)
}()
```

The `errs` channel has capacity 1 and the send is non-blocking, so the writer never blocks reporting an error.

---

## Testing With Time

The time trigger is the hardest part to test deterministically. Three approaches:

### Approach 1 — Use a tight `maxWait`

In tests, configure `maxWait = 10 * time.Millisecond`. Send items, then `time.Sleep(20 * time.Millisecond)`, then assert. Works for most tests; flaky on overloaded CI.

### Approach 2 — Use an injected clock

Define a `Clock` interface; in production use a real-time implementation; in tests use a fake that advances on `Advance(d)`:

```go
type Clock interface {
    NewTimer(d time.Duration) Timer
    Now() time.Time
}
type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}
```

Inject `Clock` into `Batch` (a `clock Clock` parameter). In tests:

```go
c := &fakeClock{}
go Batch(ctx, in, out, 10, 100*time.Millisecond, c)
in <- 1; in <- 2
c.Advance(100 * time.Millisecond) // triggers timer
b := <-out
```

The benbjohnson/clock or quartz library does exactly this.

### Approach 3 — Don't test the time trigger

Test size + close + cancel. Skip time. If your time trigger logic is the same as the canonical pattern, code review verifies correctness; you do not need a unit test for every line.

### A note on `time.Sleep` in tests

`time.Sleep(maxWait * 2)` works but causes 5–10× test-suite slowdown if `maxWait` is large. Always use small `maxWait` values in tests (1–10 ms), and accept that on a heavily contended CI machine the time trigger may fire late, causing a flake. Add a generous deadline:

```go
select {
case <-out:
case <-time.After(500 * time.Millisecond):
    t.Fatal("time trigger did not fire")
}
```

The 500 ms is 50× the configured `maxWait`. Generous, but eliminates flakes.

---

## Metrics, Logging, and Tracing

What to instrument:

### Counters

- `batching_items_received_total{stage}`
- `batching_flushes_total{stage, reason}`
- `batching_items_flushed_total{stage}` (sum of batch sizes)

### Histograms

- `batching_batch_size{stage}` — distribution of batch sizes. Useful for tuning `maxSize`.
- `batching_flush_wait_seconds{stage}` — time from buffer-non-empty to flush. Useful for `maxWait` tuning.
- `batching_send_seconds{stage}` — time spent in the cancellable send to `out`. Slow downstream shows up here.

### Logs

- Log at warning level when a `reasonCancel` flush dropped items (incomplete send).
- Log at error level when a `reasonClose` flush fails to send.
- Do *not* log per batch. That is a few hundred log lines per second per stage. Use metrics.

### Traces

- Start a span at flush time covering the downstream call.
- Attach `reason` and `batch_size` as span attributes.

```go
ctx, span := tracer.Start(ctx, "batch.flush")
span.SetAttributes(
    attribute.String("reason", r.String()),
    attribute.Int("batch_size", len(batch)),
)
err := sink.Write(ctx, batch)
if err != nil { span.RecordError(err) }
span.End()
```

This is one span per flush, not per item, so trace volume stays manageable.

---

## Tuning `maxSize` and `maxWait`

A back-of-envelope procedure.

### Step 1 — Determine the latency SLO

If your p99 latency budget is `L_slo`, then `maxWait` must be < `L_slo`. A common choice is `maxWait = L_slo / 4` to leave room for downstream latency.

E.g. `L_slo = 200 ms`, `maxWait = 50 ms`.

### Step 2 — Determine the steady-state item rate

Estimate `lambda` items per second. From metrics or load test.

E.g. `lambda = 1000 items/s`.

### Step 3 — Compute the "naturally formed" batch size at the time trigger

At steady state, a flush forms `lambda * maxWait` items per `maxWait` interval.

E.g. `1000 * 0.05 = 50 items`.

### Step 4 — Set `maxSize` to a comfortable multiple

If the naturally formed batch is 50, set `maxSize = 200` or `500`. Why bigger? Because:

- Spikes happen. A 3× spike on a `maxSize = 50` stage produces 3 separate batches; on a `maxSize = 200` stage it produces 1. Less downstream overhead.
- The sink usually has a sweet spot well above 50. Test 100, 200, 500, 1000 and pick the throughput knee.

E.g. `maxSize = 500`.

### Step 5 — Verify under load

Run a load test at 1×, 2×, 5× the expected rate. Observe:

- Flush-reason distribution. At 1×, mostly `time`. At 5×, mostly `size`.
- p99 of `flush_wait_seconds`. Must be < SLO.
- Batch size distribution. Should peak somewhere in [50, 500].

### Step 6 — Re-tune periodically

Item rate changes over months. Re-tune yearly or on major traffic-pattern shifts.

---

## Common Production Bugs at This Tier

### Bug 1 — Output channel cap too small

`out := make(chan []T)` (unbuffered). Accumulator blocks on every send waiting for the consumer. Throughput crashes. Fix: `out := make(chan []T, 4)`.

### Bug 2 — Output channel cap too large

`out := make(chan []T, 1024)`. Memory balloons when downstream is slow. Back-pressure is hidden. Fix: keep cap small (1–8).

### Bug 3 — Per-key map grows unboundedly

In per-key batching, keys are added on first item and never removed. Over time the map grows. Fix: evict empty keys after a few `maxWait` periods.

### Bug 4 — Flusher goroutine outlives accumulator

In split-flusher design, the flusher reads from `batches`. Accumulator exits, `batches` closes, flusher exits. Bug: if the flusher does not `for ... range` but instead `for { select { case b := <-batches: ... } }` without a close check, it loops forever on a closed channel reading zero values. Fix: always use `for b := range batches`.

### Bug 5 — `AfterFunc` callbacks racing

In per-key Design A, multiple `AfterFunc` callbacks fire concurrently and try to deliver to `timerFired`. The send is non-blocking, so some are dropped. Lost time triggers. Fix: ensure the buffer is large enough (16-64 is fine), or accept that occasional time-trigger fires are coalesced.

### Bug 6 — Slot leak under cancellation

The accumulator returns on cancel before reading all `timerFired` deliveries. The callbacks have already been queued and now park forever. Fix: drain `timerFired` on cancel, or accept that the channel will be GC'd.

### Bug 7 — Reset-after-close race

Calling `timer.Reset` after `timer.Stop` in a goroutine where another goroutine is reading `timer.C`. Race. In the canonical accumulator we only access the timer from one goroutine (the accumulator), so this cannot happen. Make sure splits do not violate this.

---

## Worked Example — Kafka-Style Producer

A Kafka producer batches messages by topic-partition. We will build a simplified version.

```go
package kafkalike

import (
    "context"
    "time"
)

type Message struct {
    Topic     string
    Partition int32
    Key, Body []byte
}

type partitionKey struct {
    Topic     string
    Partition int32
}

type Producer struct {
    in       <-chan Message
    batchCap int
    waitDur  time.Duration
    send     func(ctx context.Context, key partitionKey, msgs []Message) error
}

func NewProducer(in <-chan Message, batchCap int, waitDur time.Duration,
    send func(context.Context, partitionKey, []Message) error,
) *Producer {
    return &Producer{in: in, batchCap: batchCap, waitDur: waitDur, send: send}
}

func (p *Producer) Run(ctx context.Context) {
    type state struct {
        buf   []Message
        timer *time.Timer
    }
    partitions := map[partitionKey]*state{}
    fired := make(chan partitionKey, 64)

    flush := func(k partitionKey, r flushReason) error {
        s, ok := partitions[k]
        if !ok || len(s.buf) == 0 { return nil }
        batch := append([]Message(nil), s.buf...)
        s.buf = s.buf[:0]
        if s.timer != nil {
            if !s.timer.Stop() { select { case <-s.timer.C: default: } }
        }
        return p.send(ctx, k, batch)
    }

    flushAll := func(r flushReason) {
        for k := range partitions { _ = flush(k, r) }
    }

    arm := func(k partitionKey) {
        s := partitions[k]
        s.timer = time.AfterFunc(p.waitDur, func() {
            select { case fired <- k: default: }
        })
    }

    for {
        select {
        case m, ok := <-p.in:
            if !ok { flushAll(reasonClose); return }
            k := partitionKey{m.Topic, m.Partition}
            s, found := partitions[k]
            if !found {
                s = &state{buf: make([]Message, 0, p.batchCap)}
                partitions[k] = s
            }
            if len(s.buf) == 0 { arm(k) }
            s.buf = append(s.buf, m)
            if len(s.buf) >= p.batchCap { _ = flush(k, reasonSize) }
        case k := <-fired:
            _ = flush(k, reasonTime)
        case <-ctx.Done():
            flushAll(reasonCancel); return
        }
    }
}
```

Notes:

- Each topic-partition has its own batch and timer.
- The `send` function is injected so tests can use a fake.
- Error handling is intentionally minimal here; production code adds retry, error channels, and partition pinning.

---

## Worked Example — Per-Tenant Batched Writes

Imagine a multi-tenant analytics service that writes events to per-tenant tables. We want one batching stage per tenant; tenants come and go.

```go
package tenantbatch

import (
    "context"
    "sync"
    "time"
)

type Event struct {
    TenantID string
    Data     []byte
}

type Writer struct {
    Write func(ctx context.Context, tenantID string, batch []Event) error
}

type Service struct {
    in       <-chan Event
    w        Writer
    maxSize  int
    maxWait  time.Duration
    idleTTL  time.Duration

    mu   sync.Mutex
    subs map[string]chan Event
}

func (s *Service) Run(ctx context.Context) error {
    s.subs = map[string]chan Event{}
    var wg sync.WaitGroup

    routeTo := func(tenant string) chan<- Event {
        s.mu.Lock()
        defer s.mu.Unlock()
        ch, ok := s.subs[tenant]
        if !ok {
            ch = make(chan Event, s.maxSize)
            s.subs[tenant] = ch
            wg.Add(1)
            go func() {
                defer wg.Done()
                s.runTenant(ctx, tenant, ch)
            }()
        }
        return ch
    }

    for {
        select {
        case ev, ok := <-s.in:
            if !ok {
                s.mu.Lock()
                for _, ch := range s.subs { close(ch) }
                s.mu.Unlock()
                wg.Wait()
                return nil
            }
            select {
            case routeTo(ev.TenantID) <- ev:
            case <-ctx.Done():
            }
        case <-ctx.Done():
            wg.Wait()
            return ctx.Err()
        }
    }
}

func (s *Service) runTenant(ctx context.Context, tenant string, in <-chan Event) {
    buf := make([]Event, 0, s.maxSize)
    timer := time.NewTimer(s.maxWait)
    if !timer.Stop() { <-timer.C }
    idleTimer := time.NewTimer(s.idleTTL)
    defer idleTimer.Stop()

    flush := func() {
        if len(buf) == 0 { return }
        batch := append([]Event(nil), buf...)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        _ = s.w.Write(ctx, tenant, batch)
    }

    for {
        select {
        case ev, ok := <-in:
            if !ok { flush(); return }
            idleTimer.Reset(s.idleTTL)
            if len(buf) == 0 { timer.Reset(s.maxWait) }
            buf = append(buf, ev)
            if len(buf) >= s.maxSize { flush() }
        case <-timer.C:
            flush()
        case <-idleTimer.C:
            // No traffic for idleTTL; tenant goroutine exits to save resources.
            flush()
            return
        case <-ctx.Done():
            flush()
            return
        }
    }
}
```

Notes:

- Each tenant gets its own accumulator goroutine and channel.
- After `idleTTL` of no traffic, the per-tenant goroutine exits. The next event for that tenant restarts a new one.
- `routeTo` lazily creates the per-tenant channel on first event.
- On full shutdown, the parent closes all per-tenant channels and waits.

This is a production-realistic shape. Per-tenant lifecycle, idle eviction, lazy creation, graceful shutdown.

---

## Worked Example — Two-Stage Batching with Compression

Sometimes you batch twice: first to amortise a per-record cost (encoding), second to amortise a per-call cost (network). Example: log shipping to S3.

```
records ---> Batch1 ---> compressed blobs ---> Batch2 ---> S3 uploads
              (N rec)        (1 blob)            (M blobs)    (1 PUT)
```

- Batch1 takes `maxSize1 = 1000` records, runs gzip on them, produces a single compressed blob.
- Batch2 takes `maxSize2 = 10` blobs, uploads them in a multipart PUT.

```go
records := make(chan Record)
blobs := make(chan []byte, 2)
uploads := make(chan [][]byte, 1)

go Batch(ctx, records, batches, 1000, 50*time.Millisecond) // batches chan []Record

go func() {
    defer close(blobs)
    for batch := range batches {
        blob, err := gzip(batch)
        if err != nil { continue }
        blobs <- blob
    }
}()

go Batch(ctx, blobs, uploads, 10, 500*time.Millisecond)

for upload := range uploads {
    _ = s3.PutMultipart(ctx, upload)
}
```

Why two stages? Different costs amortise differently:

- gzip has per-record overhead; batching to 1000 records gives the best compression ratio.
- S3 PUT has per-call overhead; batching to 10 blobs gives the best throughput.

If you tried to do both in one stage, you would have to compromise.

---

## Anti-Patterns to Avoid

### AP1 — One goroutine per batch for the send

```go
case <-timer.C:
    go sink.Write(ctx, batch)  // ANTI: unbounded
```

Unbounded goroutine spawn. Under load, thousands of in-flight flushes. Memory explodes. Sink is overwhelmed.

Fix: bounded worker pool (next folder).

### AP2 — `time.After` in the loop

```go
for {
    select {
    case x := <-in:
        ...
    case <-time.After(maxWait):  // ANTI
        flush()
    }
}
```

Allocates a new timer every iteration. Leaks timers under load.

Fix: single `*time.Timer` with `Reset`.

### AP3 — Mutex-shared buffer

```go
var mu sync.Mutex
var buf []T
go reader(in, &buf, &mu)
go flusher(out, &buf, &mu)
```

Two goroutines sharing state. Hard to reason about. Use one goroutine + a channel.

### AP4 — Skipping the godoc

If your `Batch` function has no doc comment stating "closes out on exit, flushes partial on close and cancel," reviewers will not catch contract violations and downstream code may double-close or miss the close.

### AP5 — Logging every batch

```go
log.Printf("flushed %d items", len(batch))
```

At 1000 batches/s that is 1000 log lines/s. Use metrics.

### AP6 — Empty-batch send

If `flush()` does not early-return on `len(buf) == 0`, the ticker pattern sends empty batches downstream. Downstream may misbehave on empties.

### AP7 — Closing `out` from somewhere other than `Batch`

If the consumer closes `out` to "tell the accumulator to stop," chaos ensues (send on closed channel panic). The accumulator owns `out`. Only the accumulator closes it.

---

## Self-Assessment Checklist

- [ ] I can tag every flush with a reason (`size`, `time`, `close`, `cancel`).
- [ ] I can write a per-key batching stage using either map-of-buffers or per-key-goroutine.
- [ ] I can decide when to split into a separate flusher goroutine.
- [ ] I can test the time trigger deterministically (fake clock or tight `maxWait`).
- [ ] I instrument my stage with `flushes_total{reason}` and `batch_size` histograms.
- [ ] I can tune `maxSize` and `maxWait` against an SLO in five minutes.
- [ ] I avoid the seven anti-patterns above.
- [ ] I have a `TestBatch_FlushReasons` test that asserts the right reason for each scenario.

---

## Summary

Middle-tier batching keeps the same canonical select-loop and adds: flush-reason tagging for observability and tests; per-key buffers via map-of-state or per-key goroutines; optional split into a flusher goroutine; bounded async only where it pays; SLO-driven tuning of `maxSize` and `maxWait`; fake-clock testing for the time trigger. The shape stays simple; the rigor goes up.

---

## Further Reading

- The folder 01 (error propagation) page for how sink-side errors travel back upstream.
- The folder 02 (cancellation propagation) page for the cancellation contract.
- The folder 05 (fan-in / fan-out within pipeline) page for composing batching with parallelism.
- Senior.md (next page) for async-flush trade-offs and `sync.Pool` reuse.

---

## Deep-Dive 1 — A Stage Wrapped in a Struct with Builder Methods

Junior-tier code passed everything by parameter. Production-tier code tends to wrap the stage in a struct with builder methods. This buys configurability without telescoping parameter lists.

```go
package batching

import (
    "context"
    "errors"
    "time"
)

type Stage[T any] struct {
    in        <-chan T
    out       chan<- []T
    maxSize   int
    maxWait   time.Duration
    onFlush   func(reason string, batch []T)
    onClose   func()
    clock     Clock
    name      string
}

func New[T any](in <-chan T, out chan<- []T) *Stage[T] {
    return &Stage[T]{
        in:       in,
        out:      out,
        maxSize:  100,
        maxWait:  100 * time.Millisecond,
        clock:    realClock{},
        name:     "stage",
    }
}

func (s *Stage[T]) WithSize(n int) *Stage[T]          { s.maxSize = n; return s }
func (s *Stage[T]) WithWait(d time.Duration) *Stage[T] { s.maxWait = d; return s }
func (s *Stage[T]) WithName(n string) *Stage[T]        { s.name = n; return s }
func (s *Stage[T]) WithFlushHook(f func(string, []T)) *Stage[T] { s.onFlush = f; return s }
func (s *Stage[T]) WithCloseHook(f func()) *Stage[T]   { s.onClose = f; return s }
func (s *Stage[T]) WithClock(c Clock) *Stage[T]        { s.clock = c; return s }

func (s *Stage[T]) Validate() error {
    if s.in == nil { return errors.New("nil input channel") }
    if s.maxSize <= 0 { return errors.New("maxSize must be > 0") }
    if s.maxWait <= 0 { return errors.New("maxWait must be > 0") }
    return nil
}

func (s *Stage[T]) Run(ctx context.Context) error {
    if err := s.Validate(); err != nil { return err }
    defer close(s.out.(chan []T))
    if s.onClose != nil { defer s.onClose() }

    buf := make([]T, 0, s.maxSize)
    timer := s.clock.NewTimer(s.maxWait)
    if !timer.Stop() { <-timer.C() }

    flush := func(reason string) {
        if len(buf) == 0 { return }
        batch := append([]T(nil), buf...)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C(): default: } }
        if s.onFlush != nil { s.onFlush(reason, batch) }
        select {
        case s.out <- batch:
        case <-ctx.Done():
        }
    }

    for {
        select {
        case x, ok := <-s.in:
            if !ok { flush("close"); return nil }
            if len(buf) == 0 { timer.Reset(s.maxWait) }
            buf = append(buf, x)
            if len(buf) >= s.maxSize { flush("size") }
        case <-timer.C():
            flush("time")
        case <-ctx.Done():
            flush("cancel")
            return ctx.Err()
        }
    }
}
```

The builder methods give you a fluent API:

```go
err := New(in, out).WithSize(500).WithWait(50 * time.Millisecond).WithName("metrics").Run(ctx)
```

For projects that already use a `functional-options` pattern, the equivalent is:

```go
type Option[T any] func(*Stage[T])

func WithSize[T any](n int) Option[T] { return func(s *Stage[T]) { s.maxSize = n } }
// ...

func NewWithOpts[T any](in <-chan T, out chan<- []T, opts ...Option[T]) *Stage[T] {
    s := New(in, out)
    for _, opt := range opts { opt(s) }
    return s
}
```

Either pattern works. Pick one and use it consistently.

---

## Deep-Dive 2 — The Clock Interface in Full

We sketched `Clock` and `Timer` above. Here is a production-realistic version with both the real implementation and a fake for tests.

```go
package batching

import (
    "sync"
    "time"
)

type Clock interface {
    NewTimer(d time.Duration) Timer
    Now() time.Time
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

// Real clock backed by time package.

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }
func (realClock) NewTimer(d time.Duration) Timer { return &realTimer{t: time.NewTimer(d)} }

type realTimer struct{ t *time.Timer }
func (r *realTimer) C() <-chan time.Time { return r.t.C }
func (r *realTimer) Stop() bool { return r.t.Stop() }
func (r *realTimer) Reset(d time.Duration) bool { return r.t.Reset(d) }

// Fake clock for tests.

type FakeClock struct {
    mu      sync.Mutex
    now     time.Time
    timers  []*fakeTimer
}

func NewFakeClock(start time.Time) *FakeClock { return &FakeClock{now: start} }

func (f *FakeClock) Now() time.Time {
    f.mu.Lock(); defer f.mu.Unlock()
    return f.now
}

func (f *FakeClock) NewTimer(d time.Duration) Timer {
    f.mu.Lock(); defer f.mu.Unlock()
    ch := make(chan time.Time, 1)
    t := &fakeTimer{
        c:      ch,
        fireAt: f.now.Add(d),
        active: true,
        clock:  f,
    }
    f.timers = append(f.timers, t)
    return t
}

func (f *FakeClock) Advance(d time.Duration) {
    f.mu.Lock()
    f.now = f.now.Add(d)
    var toFire []*fakeTimer
    for _, t := range f.timers {
        if t.active && !t.fireAt.After(f.now) {
            t.active = false
            toFire = append(toFire, t)
        }
    }
    f.mu.Unlock()
    for _, t := range toFire {
        select { case t.c <- f.Now(): default: }
    }
}

type fakeTimer struct {
    c      chan time.Time
    fireAt time.Time
    active bool
    clock  *FakeClock
}

func (t *fakeTimer) C() <-chan time.Time { return t.c }
func (t *fakeTimer) Stop() bool {
    t.clock.mu.Lock(); defer t.clock.mu.Unlock()
    if !t.active { return false }
    t.active = false
    return true
}
func (t *fakeTimer) Reset(d time.Duration) bool {
    t.clock.mu.Lock(); defer t.clock.mu.Unlock()
    was := t.active
    t.fireAt = t.clock.now.Add(d)
    t.active = true
    return was
}
```

Now in tests:

```go
func TestBatch_TimeTriggerWithFakeClock(t *testing.T) {
    clk := NewFakeClock(time.Unix(0, 0))
    in := make(chan int)
    out := make(chan []int, 4)
    go New(in, out).WithSize(100).WithWait(100 * time.Millisecond).WithClock(clk).Run(context.Background())

    in <- 1; in <- 2

    // Nothing should be flushed yet.
    select {
    case b := <-out:
        t.Fatalf("unexpected flush: %v", b)
    case <-time.After(20 * time.Millisecond):
    }

    clk.Advance(100 * time.Millisecond)

    select {
    case b := <-out:
        if len(b) != 2 { t.Fatalf("want 2, got %d", len(b)) }
    case <-time.After(time.Second):
        t.Fatal("no flush after clock advance")
    }
}
```

The test is deterministic: no `time.Sleep`-based timing dependency.

---

## Deep-Dive 3 — Coalescing in Per-Key Batching

A specialised version of per-key batching: *coalesce* successive items with the same key into one. Useful for "latest wins" semantics — for example, cache invalidations, presence updates, position updates.

```go
package coalesce

import (
    "context"
    "time"
)

type Update struct {
    Key   string
    Value any
    Seq   uint64 // monotonic per-key
}

func Coalesce(
    ctx context.Context,
    in <-chan Update,
    out chan<- []Update,
    maxKeys int,
    maxWait time.Duration,
) {
    defer close(out)
    latest := map[string]Update{} // key -> latest seen
    timer := time.NewTimer(maxWait)
    if !timer.Stop() { <-timer.C }

    flush := func() {
        if len(latest) == 0 { return }
        batch := make([]Update, 0, len(latest))
        for _, u := range latest { batch = append(batch, u) }
        latest = map[string]Update{}
        if !timer.Stop() { select { case <-timer.C: default: } }
        select {
        case out <- batch:
        case <-ctx.Done():
        }
    }

    for {
        select {
        case u, ok := <-in:
            if !ok { flush(); return }
            if cur, has := latest[u.Key]; has && cur.Seq >= u.Seq {
                // out-of-order update; discard
                continue
            }
            if len(latest) == 0 { timer.Reset(maxWait) }
            latest[u.Key] = u
            if len(latest) >= maxKeys { flush() }
        case <-timer.C:
            flush()
        case <-ctx.Done():
            flush(); return
        }
    }
}
```

Notice:

- We do not buffer all updates; only the latest per key.
- Sequence numbers prevent out-of-order updates from clobbering newer ones.
- The "size" trigger is on *distinct keys*, not total items.

This is the right pattern for any "last-write-wins" stream. Saves bandwidth and avoids redundant downstream work.

---

## Deep-Dive 4 — Bounded Concurrent Flushing

If your accumulator runs into a slow sink, you may want to overlap flushes — but boundedly. Here is a small worker pool.

```go
package boundedflush

import (
    "context"
    "sync"
    "time"
)

type Flusher[T any] struct {
    write    func(ctx context.Context, batch []T) error
    workers  int
    jobs     chan []T
    wg       sync.WaitGroup
}

func NewFlusher[T any](workers int, jobs int,
    write func(context.Context, []T) error,
) *Flusher[T] {
    return &Flusher[T]{
        write:   write,
        workers: workers,
        jobs:    make(chan []T, jobs),
    }
}

func (f *Flusher[T]) Start(ctx context.Context) {
    for i := 0; i < f.workers; i++ {
        f.wg.Add(1)
        go func() {
            defer f.wg.Done()
            for b := range f.jobs {
                _ = f.write(ctx, b)
            }
        }()
    }
}

func (f *Flusher[T]) Send(ctx context.Context, b []T) error {
    select {
    case f.jobs <- b:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (f *Flusher[T]) Stop() {
    close(f.jobs)
    f.wg.Wait()
}

// Used from inside the accumulator's flush:
func Run[T any](
    ctx context.Context,
    in <-chan T,
    flusher *Flusher[T],
    maxSize int,
    maxWait time.Duration,
) {
    flusher.Start(ctx)
    defer flusher.Stop()

    buf := make([]T, 0, maxSize)
    timer := time.NewTimer(maxWait)
    if !timer.Stop() { <-timer.C }

    flush := func() {
        if len(buf) == 0 { return }
        batch := append([]T(nil), buf...)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        _ = flusher.Send(ctx, batch)
    }

    for {
        select {
        case x, ok := <-in:
            if !ok { flush(); return }
            if len(buf) == 0 { timer.Reset(maxWait) }
            buf = append(buf, x)
            if len(buf) >= maxSize { flush() }
        case <-timer.C:
            flush()
        case <-ctx.Done():
            flush(); return
        }
    }
}
```

Key properties:

- At most `workers` concurrent calls to `write`.
- `Send` blocks the accumulator if the jobs channel is full — back-pressure preserved.
- On shutdown, `flusher.Stop()` waits for all in-flight writes to finish.

Compared to spawning `go write(batch)` for every batch (the AP1 anti-pattern), this is correct.

---

## Deep-Dive 5 — Handling Partial-Batch Failure

When `sink.Write(batch)` fails, what do you do? Options:

### Option A — Retry whole batch

Simplest. With exponential backoff:

```go
for attempt := 0; attempt < 5; attempt++ {
    if err := sink.Write(ctx, batch); err == nil { break }
    select {
    case <-time.After(backoff(attempt)):
    case <-ctx.Done(): return ctx.Err()
    }
}
```

Drawback: if 99 out of 100 items in the batch are fine and 1 is bad, you keep retrying forever.

### Option B — Split-on-fail

Try the whole batch. If it fails, split in half, retry each half. Recursively. Eventually isolate the bad item.

```go
func writeOrSplit(ctx context.Context, b []Item) error {
    err := sink.Write(ctx, b)
    if err == nil { return nil }
    if len(b) == 1 {
        return fmt.Errorf("single-item failure: %w", err) // log and drop, or DLQ
    }
    mid := len(b) / 2
    e1 := writeOrSplit(ctx, b[:mid])
    e2 := writeOrSplit(ctx, b[mid:])
    return errors.Join(e1, e2)
}
```

Drawback: many extra round trips on failure.

### Option C — Per-item ack from sink

If the sink reports which items failed (e.g. DynamoDB's `UnprocessedItems`), retry only those:

```go
unprocessed := batch
for attempt := 0; attempt < 5 && len(unprocessed) > 0; attempt++ {
    result, err := sink.BatchWrite(ctx, unprocessed)
    if err != nil { return err }
    unprocessed = result.UnprocessedItems
    if len(unprocessed) > 0 {
        time.Sleep(backoff(attempt))
    }
}
```

Drawback: requires sink support.

### Option D — Dead-letter queue

On failure, move the batch (or the failed items) to a DLQ for offline inspection.

```go
if err := sink.Write(ctx, batch); err != nil {
    _ = dlq.Write(ctx, batch, err)
}
```

This is what production systems use for non-retryable errors.

### Picking a strategy

- Transient errors (network blips): Option A.
- Mixed transient + per-item errors: Option C if supported, else Option B.
- Poison-pill items: Option D in addition to A/B/C.

---

## Deep-Dive 6 — Ordering Under Concurrent Flushers

If you have multiple flusher workers, batches may flush *out of order*. Whether this matters depends on the sink:

- **Idempotent inserts** (with primary key from item): order does not matter; reapplying old data is fine.
- **Event stream consumer**: order may matter per key, not globally. Use per-key batching + single flusher per key.
- **Append-only log**: order matters. Use one flusher.

If you need *strict global order* but want concurrency for throughput, the standard pattern is "pipelined ordered flushers": flusher i picks up batch i, flusher j picks up batch j, but they wait for ack tokens that arrive in order.

```go
type ackedBatch struct {
    batch []T
    ack   chan struct{}
}

// Accumulator dispatches with a token.
batches := make(chan ackedBatch, numWorkers)
acks := make(chan chan struct{}, numWorkers)

// Workers
for w := 0; w < numWorkers; w++ {
    go func() {
        for ab := range batches {
            _ = sink.Write(ctx, ab.batch)
            close(ab.ack)
        }
    }()
}

// Ordering goroutine drains acks in order.
go func() {
    for a := range acks {
        <-a // wait for this batch to ack
        // ... now safe to commit the next checkpoint
    }
}()

// On flush:
ack := make(chan struct{})
batches <- ackedBatch{batch, ack}
acks <- ack
```

The `acks` channel preserves global order even though `batches` does not.

This is one of the more intricate patterns. Most production code does not need it; ordering-sensitive sinks usually use a single flusher and live with the throughput cap.

---

## Deep-Dive 7 — Restartability

What happens if your batching service restarts mid-batch? Any items in the in-flight `buf` slice are lost (they were not in any durable store). For most pipelines this is acceptable — the source can replay.

But sometimes you need at-least-once delivery across restart. Two patterns:

### Pattern A — Source replays

The upstream source (Kafka consumer, message queue) tracks offsets. The accumulator commits the offset *after* the flush succeeds. If the accumulator crashes mid-flush, on restart the source replays from the last committed offset. Duplicates may occur (you flushed but did not commit yet); idempotent sinks handle this.

```go
type committed struct {
    offset int64
    batch  []Item
}

// Accumulator emits committed batches.
case <-timer.C:
    flush := append([]Item(nil), buf...)
    lastOff := buf[len(buf)-1].Offset
    buf = buf[:0]
    if err := sink.Write(ctx, flush); err == nil {
        _ = source.CommitOffset(lastOff)
    }
```

### Pattern B — WAL before flush

Write the in-flight batch to a write-ahead log on disk before sending. On restart, replay the WAL.

```go
case <-timer.C:
    _ = wal.Append(ctx, buf)
    _ = sink.Write(ctx, buf)
    _ = wal.Truncate(ctx)
    buf = buf[:0]
```

Most batching stages do not need restartability. Add it only when at-least-once is a hard requirement.

---

## Deep-Dive 8 — Multi-Stage Pipelines

A real pipeline may have several batching stages, plus fan-out / fan-in stages.

```
HTTP --> decode --> validate --> Batch1 --> dedupe --> Batch2 --> compress --> Batch3 --> Sink
```

- `Batch1` is small (10 items, 10 ms) — coalesces same-key updates downstream.
- `Batch2` is medium (100 items, 50 ms) — amortises compression cost.
- `Batch3` is large (10 blobs, 500 ms) — amortises network cost.

Each batching stage is independent. Each tunes its own `maxSize` and `maxWait` against its local goals.

The crucial composition rule: **latency adds up**. If each stage adds at most `maxWait`, the total worst-case latency is the sum. Three batching stages with `maxWait = 100 ms` each means worst-case 300 ms of accumulated latency. Watch this against your SLO.

---

## Deep-Dive 9 — Memory Estimation Detailed

At middle tier you should be able to estimate memory precisely.

Per batching stage:

- The buffer: `maxSize * sizeof(T)` bytes.
- The output channel: `outCap * (sizeof(slice header) + per-batch payload)`. Slice header is 24 bytes; payload is up to `maxSize * sizeof(T)`.
- The goroutine itself: ~2 KB stack.
- Closures: a few hundred bytes.

Example: `T = Event{}` 256 B, `maxSize = 1000`, `outCap = 4`.

- Buffer: 256 KB.
- Output channel: 4 × (24 + 256 KB) ≈ 1 MB.
- Goroutine: 2 KB.
- Total: ~1.25 MB per stage.

Per-key batching: multiply by number of active keys. 1000 keys × 1.25 MB = 1.25 GB. If you have 1000 keys, you may want a smaller `maxSize` per key, or per-key idle eviction.

---

## Deep-Dive 10 — A Production Code Review Checklist

When reviewing batching-stage code, ask:

1. Does it have the triple trigger? Size, time, end-of-stream.
2. Does it flush on cancellation?
3. Does it close the output channel from exactly one place?
4. Is the timer correctly stopped-and-drained on creation and after each flush?
5. Does the flush copy the buffer before sending?
6. Is the send cancellable on `ctx.Done()`?
7. Is the size trigger inline in the receive case, not a separate `select` case?
8. Does the empty-buffer guard exist inside flush?
9. Is `maxSize > 0` and `maxWait > 0` validated?
10. Is the output channel cap small (1–8)?
11. Are flush reasons tagged for metrics and tests?
12. Are there at least three tests: size trigger, time trigger, final flush on close?
13. Is the goroutine count bounded under load?
14. Does the godoc state who closes `out`?
15. Are anti-patterns (time.After in loop, time.Tick, unbounded async flush) absent?

If all fifteen are yes, the stage is production-ready.

---

## Deep-Dive 11 — Comparing Three Real Implementations

Three Go libraries with batching primitives. We compare their shapes.

### Sarama's `AsyncProducer`

Internally batches by topic-partition. Uses a per-partition goroutine + timer. Closes channels on shutdown. Errors flow back via a separate `Errors()` channel. Configuration via `sarama.Config{Producer: ProducerConfig{...}}`.

Lessons:

- One goroutine per partition is a sane default.
- Separate error channel is the right error-propagation pattern.
- Configuration via structs is verbose but explicit.

### `franz-go` (`github.com/twmb/franz-go`)

Similar shape but with explicit linger semantics. The linger is the `maxWait` equivalent. Supports per-record callbacks (which Sarama discourages).

Lessons:

- Linger is a more user-friendly name than `maxWait`. Consider using it.
- Per-record callbacks are sometimes useful for very specific use cases (acks).

### Cloud SDK clients (AWS, GCP)

Most cloud client libraries do not batch internally; they expose a `Bulk` or `BatchWrite` method and leave batching to you. Your code is the batching stage; theirs is the sink.

Lessons:

- Do not assume the SDK batches.
- Read the docs; if `BatchWrite` exists, you usually want to call it from a batching stage.

---

## Deep-Dive 12 — Future Directions

Beyond middle tier, the topics in senior.md and professional.md:

- **Async flush with bounded in-flight.** We sketched it above; senior.md formalises it.
- **`sync.Pool` for batch slices.** Removes the copy allocation.
- **Adaptive sizing.** `maxSize` grows or shrinks based on downstream latency feedback.
- **Jittered timers.** Per-instance jitter avoids herd flushes across a fleet.
- **Queue-theoretic capacity planning.** Little's law gives you bounds without simulation.
- **SLO-driven autonomous tuning.** Trigger parameters change at runtime to meet an SLO.

These are the levers that take a stage from "production-correct" to "production-optimised."

---

## Mini-Quizzes

### Quiz Q1
*What is the difference between `*time.Timer` and `*time.Ticker` for the time trigger?*

Timer fires once after `Reset(d)`, must be re-armed. Ticker fires every `d` automatically. Timer wastes zero wakeups when idle; Ticker wastes one per `d` when idle.

### Quiz Q2
*When should you use `time.AfterFunc`?*

For per-key timers in per-key batching, where you have many timers and want a callback rather than a channel. The callback delivers the key to a shared dispatcher channel.

### Quiz Q3
*How do you bound async flush?*

Use a worker pool. The accumulator sends batches on a bounded channel; workers read from it and call the sink. The channel capacity bounds in-flight.

### Quiz Q4
*Why do you tag flushes with a reason?*

For metrics (operating regime), tests (deterministic assertions), and conditional behavior (different policies per reason).

### Quiz Q5
*When does ordering matter in async flush?*

When the sink is order-sensitive (event log, append-only sink). Use a single flusher or per-key flushers to preserve order within each key.

### Quiz Q6
*What happens if you use `time.After` inside a `select` in a long-running loop?*

You allocate a new timer every iteration. Under load, you leak thousands per second.

### Quiz Q7
*What is the typical SLO-derived `maxWait` formula?*

`maxWait = L_slo / 4` to leave room for downstream latency.

### Quiz Q8
*How do you test the time trigger deterministically?*

Inject a `Clock` interface; use a fake clock in tests; advance the clock manually.

### Quiz Q9
*Why do you copy the buffer on send even with `sync.Pool`?*

Because the buffer slice references the accumulator's underlying array. The pooled object should be a *separate* slice the accumulator copies into.

### Quiz Q10
*What is the right cap for the output channel?*

Typically 1–8. Small enough to preserve back-pressure; large enough to overlap accumulate and consume.

---

## Final Summary

Middle-tier batching is the canonical select-loop plus:

- Tagged flush reasons.
- Per-key buffers (map-of-state or per-key goroutine).
- Optional split into a flusher (bounded worker pool).
- SLO-driven `maxSize` / `maxWait` tuning.
- Fake-clock testing.
- Builder-pattern or option-pattern configuration.
- Metrics and traces tied to flush reasons.
- Coalescing for last-write-wins streams.
- Partial-failure handling (whole-retry, split-on-fail, per-item ack, DLQ).

---

## Deep-Dive 13 — Handling Hot Keys

In per-key batching, one key may receive 100× the traffic of others. If `maxSize` is the same for all keys, the hot key fills the buffer constantly and dominates the flusher's attention. Cool keys starve.

### Symptom

Metrics show: tenant `A` has p50 batch size 1000 and p50 flush wait 1 ms; tenant `B` has p50 batch size 2 and p50 flush wait 100 ms. Hot tenant gets fast flushes; cold tenants get slow flushes — because they wait for the time trigger, while the flusher is busy with hot batches.

### Fix 1 — Per-key flusher

If each tenant has its own flusher goroutine (Design B from earlier), there is no global flusher contention. Each tenant proceeds independently.

### Fix 2 — Fair scheduling

If you use Design A (single accumulator, map of buffers, single flusher), implement round-robin over keys instead of FIFO. Track last-flushed time per key; prefer the oldest.

### Fix 3 — Adaptive sizing per key

Hot keys flush more often anyway (size trigger fires fast); shrinking `maxSize` for hot keys does not help. Growing `maxSize` for cold keys is bad (their time trigger still fires). Adaptive sizing is mainly useful when the *aggregate* rate changes; per-key adaptive is usually overkill.

### Fix 4 — Sharded accumulators

Hash keys to N accumulators. Each shard handles its share of keys. Hot keys are isolated to one shard; cool keys to others. Simpler than per-key, fairer than single-accumulator.

```go
const numShards = 16

shards := make([]chan Event, numShards)
for i := range shards {
    shards[i] = make(chan Event, 64)
    go Batch(ctx, shards[i], shardOuts[i], maxSize, maxWait)
}

for ev := range in {
    h := hash(ev.Key) % numShards
    shards[h] <- ev
}
```

Sharding by hash is the production-realistic compromise.

---

## Deep-Dive 14 — Back-Pressure Across the Boundary

A batching stage between two channels naturally propagates back-pressure: if the downstream consumer is slow, the accumulator blocks on `out`, then on `in`. The producer slows down.

But there is a subtle wrinkle: the accumulator does not block on `out` *during accumulation*, only during flush. So the back-pressure has a "burst capacity" equal to `maxSize`.

### Example

Suppose `maxSize = 1000`, `maxWait = 100 ms`, and the downstream consumer momentarily stalls.

- Items 1–1000 arrive: the size trigger fires; accumulator tries `out <- batch` but the consumer is stalled. Accumulator blocks.
- Items 1001+ arrive on `in`: producer fills `in`'s buffer; if `in` is unbuffered, producer blocks immediately.
- Back-pressure has propagated.

The latency contribution is `maxSize / rate` plus the consumer's stall duration. In our example, 1000 / 1000 ips = 1 second before back-pressure visible.

### Tuning

If you want tighter back-pressure (faster response to downstream slowness), reduce `maxSize` and the output channel cap. If you want more burst tolerance, increase them.

---

## Deep-Dive 15 — A Pattern for Mid-Pipeline Drops

Sometimes you want to drop items rather than wait. Example: real-time telemetry where stale data is worthless.

```go
case x, ok := <-in:
    ...
    if len(buf) >= maxSize {
        // Drop the *oldest* in-flight items rather than blocking.
        if !tryFlush(timeout) {
            buf = buf[len(buf)/2:] // drop half
            metricDropped.Add(float64(maxSize / 2))
        }
    }
```

This is the "load shedding" pattern. The accumulator drops items when the sink cannot keep up, rather than back-pressuring the producer.

Be careful: load shedding breaks the at-least-once contract. Use it only when stale data is genuinely worthless.

---

## Deep-Dive 16 — Watermarks and Late-Arriving Data

In streaming systems (event-time, not processing-time), items have timestamps that may be older than wall-clock. A late item arrives at time `T` but is timestamped `T - 5 minutes`. The batching stage may have already flushed batches covering that window.

Two policies:

1. **Reject late.** If item is older than the current watermark, drop it. Acceptable if rare.
2. **Side stream.** Send late items to a separate output channel for special handling.

The batching stage itself does not need watermark logic — that lives in the downstream consumer. But the stage *may* need to attach the watermark to each batch.

```go
type batchOut struct {
    items     []Item
    watermark time.Time
}
```

This is event-time streaming territory and quickly exceeds middle tier. Mentioned for completeness.

---

## Deep-Dive 17 — Migrating From a Non-Batched Implementation

Often you start with a one-at-a-time pipeline and decide later to batch. The migration is mechanical:

### Step 1 — Identify the sink

Find the place where each item becomes an external call. Example:

```go
for ev := range events {
    _ = db.Insert(ctx, ev)
}
```

### Step 2 — Insert a batching stage

```go
events := make(chan Event)
batches := make(chan []Event, 4)
go Batch(ctx, events, batches, 200, 50*time.Millisecond)

for b := range batches {
    _ = db.InsertMany(ctx, b)
}
```

### Step 3 — Update the sink call

Change `db.Insert` to `db.InsertMany` (or to a loop over the batch if no batched API exists; even then, you save the connection acquisition and per-call overhead).

### Step 4 — Add metrics

`flushes_total{reason}`, `batch_size`, `flush_wait_seconds`.

### Step 5 — Tune

Measure throughput before and after. Tune `maxSize` and `maxWait`. Expect 10x–100x throughput gain.

### Step 6 — Add the final-flush test

The single most important regression test.

This migration is bread-and-butter middle-tier work. Practise it on a small toy pipeline.

---

## Deep-Dive 18 — Working With Generic Types

Generic batching is the rule. Most production codebases use one `Batch[T]` and parameterise.

But sometimes generic does not work cleanly:

- **Heterogeneous batches.** Items of different types in one batch (e.g. unioned record types). Use an interface: `Batch[Record]` where `Record` is an interface.
- **Items with associated context.** Each item carries an ack callback. Batch the items; on flush, call all acks. Type would be `BatchWithAck[T]`.
- **Variadic sinks.** Different sinks for different item types. Build one `Batch[T]` per sink.

```go
// Heterogeneous via interface
type Record interface { Type() string }

func Batch[T Record](...) { ... }

// With acks
type Acked[T any] struct {
    Item T
    Ack  chan<- error
}

func BatchAcked[T any](in <-chan Acked[T], ...) {
    // ...
    flush := func() {
        items := make([]T, 0, len(buf))
        for _, a := range buf { items = append(items, a.Item) }
        err := sink.Write(ctx, items)
        for _, a := range buf {
            select { case a.Ack <- err: default: }
        }
        buf = buf[:0]
    }
}
```

The `BatchAcked` shape is common in message-queue consumers: each message has an ack callback that must fire after successful processing.

---

## Deep-Dive 19 — Diagnostic Logging

When something goes wrong, what should the stage log?

### On startup

`log.Infof("batching stage started: name=%s maxSize=%d maxWait=%v", name, maxSize, maxWait)`

One line. Enough to confirm config.

### On flush

Nothing routine. The metrics replace per-flush logs.

### On flush failure

`log.Errorf("flush failed: reason=%s size=%d err=%v", reason, len(batch), err)`

Include reason, size, error. Do not include the batch contents.

### On cancellation

`log.Infof("batching stage cancelled: drained %d items", drained)`

One line on shutdown.

### On panic

`log.Errorf("batching stage panicked: %v\n%s", r, debug.Stack())`

If you use `recover()` to keep the stage alive, log the panic with stack.

### What NOT to log

- Per-item details. Volume too high.
- Buffer contents. PII risk.
- "Received item" or "appended to buffer." Too noisy.

A batching stage in a healthy production run logs nothing — just metrics. Logs are for problems.

---

## Deep-Dive 20 — Reading the Go Memory Model for This Pattern

A subtle question: in the canonical pattern, when can the consumer goroutine *safely* read the batch slice it receives?

Channel receive synchronises-with the corresponding send (Go Memory Model). So the consumer's view of `batch[i]` is at least as recent as the accumulator's write to `batch[i]` *before the send*.

In our `flush()`:

```go
batch := make([]T, len(buf))
copy(batch, buf)         // writes to batch
buf = buf[:0]
// ...
out <- batch             // send
```

The `copy` happens-before the `out <- batch`. The receive `b := <-out` happens-after the send. Therefore the consumer's reads of `b[i]` see the values copied. Safe.

If we had sent `buf` directly (the bug):

```go
out <- buf
buf = buf[:0]
// later: buf = append(buf, x)
```

The send happens-before the receive, so the consumer's initial read sees the buffer at send time. But the subsequent `append` *may* write into the same array. That write is not synchronised with anything the consumer does. Data race.

This is why "copy on send" is not optional; it is required by the memory model.

---

## Deep-Dive 21 — How Batching Interacts With Connection Pooling

If the sink is a database with a connection pool, batching changes the math:

- Per-item insert: each insert acquires a connection, holds for ~1 ms, releases. 1000 items = 1000 connection acquires.
- Per-batch insert: one connection acquire for 100 items. 10x fewer acquires.

For a pool of 10 connections, the per-item pattern uses each connection 100 times per second (saturating). The batched pattern uses each connection 1 time per second (10% utilisation). You can shrink the pool from 10 to 2.

Reasoning chain: bigger batches → fewer connections needed. Fewer connections needed → less memory in the database server → larger query cache → faster queries. Cascading benefits.

---

## Deep-Dive 22 — When to Add a Second Time Trigger

Sometimes you want two time triggers: one short for cold paths, one long for steady state. Example: a metrics flusher that flushes every 100 ms during business hours and every 10 s at 3 AM.

You do not actually need two timers. Just adjust `maxWait` based on traffic. Or, simpler: have *one* short `maxWait`, and let the size trigger dominate during business hours.

If you genuinely want two time triggers, run two batching stages in series:

```
in --> Batch(maxWait=100ms) --> Batch(maxWait=10s) --> sink
```

The outer stage adds latency to slow-traffic paths but does not affect fast-traffic paths (the size trigger fires before the time trigger).

This is rarely needed. Mentioned for completeness.

---

## Deep-Dive 23 — Reading Open-Source Implementations

Three Go projects with batching primitives worth reading:

### `github.com/uber-go/automaxprocs`

Not batching per se, but uses the GMP scheduler patterns that make Go's batching efficient. Worth skimming to understand the runtime.

### `github.com/segmentio/kafka-go`

The producer's `Writer` batches by topic-partition. Look at `internal/writer.go` for the per-partition state machine. See how they handle:

- The `linger.ms` (their name for `maxWait`).
- `batch.size` (their `maxSize`).
- Async writes with completion callbacks.

### `github.com/influxdata/telegraf`

Their output plugins batch points before sending to InfluxDB. The base `output.Output` interface includes `BatchWrite([]telegraf.Metric)`. See `plugins/outputs/influxdb_v2/influxdb.go` for a realistic batch + retry + DLQ flow.

Reading these gives you a sense of production conventions: builder patterns, configuration shapes, metric names, error handling.

---

## Deep-Dive 24 — A Tabletop Exercise

You are tech lead on a project. A teammate proposes a batching stage with `maxSize = 10000` and `maxWait = 1 minute`. What do you say?

### Step 1 — Ask about the SLO

"What is the latency budget?" If they say "60 seconds is fine," the `maxWait` is acceptable. If they say "100 ms," reject.

### Step 2 — Ask about traffic

"What is the steady-state rate?" If 10 items/s, the size trigger never fires; batches form by time trigger; 10 items per minute per batch = 10. Way under `maxSize`. The `maxSize = 10000` is irrelevant.

### Step 3 — Ask about memory

"What is `sizeof(item)`?" If 1 KB, `maxSize × 1 KB = 10 MB` per stage. Fine. If 1 MB, 10 GB. Reject.

### Step 4 — Ask about the sink

"What is the sink's preferred batch size?" If 100, the `maxSize = 10000` is way too big — you waste sink CPU on huge batches that take longer to process.

### Step 5 — Recommend

"Set `maxSize = 200` (close to sink optimum), `maxWait = 1 second` (well under SLO). Re-evaluate after a week of production data."

This is the conversation. Numbers matter; arbitrary defaults do not.

---

## Deep-Dive 25 — Reproducing the "Flush Storm" Bug

A real production incident: a fleet of 100 batching stages, all configured with `maxWait = 1 minute`. On deploy, they all restarted at roughly the same wall-clock time. Their first-batch timers fire at roughly the same time (1 minute after startup). 100 flushes hit the sink simultaneously. Sink falls over.

The fix: jitter. Each stage's `maxWait` is randomised by ±10%, so the timer fires staggered across the fleet.

```go
jittered := maxWait + time.Duration(rand.Int63n(int64(maxWait/5))) - maxWait/10
timer := time.NewTimer(jittered)
```

Or: stagger startup. Each pod sleeps `rand.Intn(maxWait)` before starting the accumulator.

This is a "flock of birds" / "thundering herd" / "herd flush" issue. Senior.md covers it in more depth. Mentioned here so you recognise the symptom: synchronised flushes across a fleet.

---

## Worked Sequence — Six Tests You Should Have

For any middle-tier batching stage, this is the test set you ship.

### Test 1 — Size trigger

Configure `maxSize = 3`. Send 9 items. Expect 3 batches of 3 each.

### Test 2 — Time trigger

Configure `maxSize = 100`, `maxWait = 50 ms`. Send 2 items, sleep 100 ms. Expect 1 batch of 2.

### Test 3 — Final flush on input close

Configure `maxSize = 100`, `maxWait = 1 s`. Send 3 items, close input. Expect 1 batch of 3 and `out` closed.

### Test 4 — Flush on cancel

Configure as above. Send 3 items. Cancel context. Expect 1 batch of 3 (best-effort) and `out` closed.

### Test 5 — No empty batches

Configure `maxWait = 10 ms`. Wait 50 ms with no input. Expect no batches sent. Then send 1 item, wait 20 ms, expect 1 batch of 1.

### Test 6 — Flush reason tags

Configure with a flush hook. Send 4 items at `maxSize = 3` (one full batch + 1 partial). Close. Expect hook called with `reasonSize` once and `reasonClose` once.

If all six pass, the stage is solid.

---

## Concluding Thought

A batching stage is small in code but large in production impact. The middle tier is about turning a working stage into a well-instrumented, well-tuned, well-tested production component. The senior tier — async flush, allocation-free reuse, jittered timers — and the professional tier — adaptive sizing, queue theory — are refinements on this foundation. None of them work if the middle tier is shaky.

Spend the time. Get the canonical pattern in your fingers. Tag your flushes. Test your time trigger deterministically. Estimate your memory. Read at least one open-source implementation. Then move on to senior.md.

---

## Appendix A — Cross-Reference of Trigger Sources by Pattern

| Pattern | Size trigger | Time trigger | EOS trigger | Cancel trigger |
|---------|--------------|--------------|-------------|----------------|
| Canonical (junior) | inline `if len(buf) >= maxSize` | `case <-timer.C` | `ok == false` in receive | `case <-ctx.Done()` |
| Ticker variant | inline | `case <-ticker.C` (with empty guard) | `ok == false` in receive | `case <-ctx.Done()` |
| Per-key (Design A) | inline per key | `case k := <-fired` from `AfterFunc` | `ok == false` triggers `flushAll` | `case <-ctx.Done()` triggers `flushAll` |
| Per-key (Design B) | inline (each accumulator) | `case <-timer.C` (each accumulator) | per-key channel close | per-accumulator ctx |
| Bounded async flush | inline | `case <-timer.C` | `ok == false` | `case <-ctx.Done()`; pool drains via close |
| Coalesce | size = distinct keys | as canonical | as canonical | as canonical |

Memorise the row that matches your design; consult the others as needed.

---

## Appendix B — Tunable Knob Sheet

Knobs you will be asked to set on a real stage:

| Knob | Typical range | Pick by |
|------|---------------|---------|
| `maxSize` | 10 – 10000 | sink's optimal batch size (measure throughput knee) |
| `maxWait` | 1 ms – 10 s | latency SLO / 4 |
| `outCap` | 0 – 8 | overlap vs back-pressure trade-off |
| `inCap` (channel) | 0 – maxSize | producer burst tolerance |
| `flushers` | 1 – CPU count | sink concurrency limit |
| `idleTTL` (per-key) | 1 min – 1 hour | tenant churn rate |
| `numShards` | 4 – 64 | hot-key contention vs goroutine count |
| `jitter` | 0 – 20% of maxWait | fleet size; high jitter for large fleets |

Defaults that work for "I don't know yet": `maxSize=100`, `maxWait=50ms`, `outCap=4`, `flushers=1`. Measure, then tune.

---

## Appendix C — Step-by-Step Recipe for Adding Batching to an Existing System

You have a service that does one-at-a-time writes. You want to add batching. Recipe:

1. **Profile the baseline.** Run a load test. Record throughput and latency.
2. **Identify the sink.** Find the line `sink.Write(item)` in the hot path.
3. **Confirm the sink has a batch API.** `BatchWrite`, `InsertMany`, `BulkSend`, etc. If none, you can still batch by looping; gains are smaller (saves connection acquires, not network round trips).
4. **Introduce a channel.** Replace direct `sink.Write` with `events <- item`.
5. **Add `Batch`.** `go Batch(ctx, events, batches, 200, 50*time.Millisecond)`.
6. **Add the writer loop.** `for b := range batches { sink.BatchWrite(ctx, b) }`.
7. **Wire context cancellation.** When the service shuts down, cancel `ctx`. The batching stage flushes and closes `batches`; the writer loop exits.
8. **Add metrics.** `flushes_total{reason}`, `batch_size`.
9. **Add the final-flush test.** Send 3 items, close `events`, expect 3 items at the sink.
10. **Profile under load.** Compare to baseline. Tune `maxSize` and `maxWait`.
11. **Roll out behind a feature flag.** A bad `maxSize` can take down the sink; gradual rollout protects you.

This recipe converts most one-at-a-time pipelines into batched ones in a day's work.

---

## Appendix D — A Realistic Test Suite

For one production stage, the full test file might look like:

```go
package metricsink

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "testing"
    "time"
)

func newStage(t *testing.T, size int, wait time.Duration) (chan<- Point, <-chan []Point, context.CancelFunc) {
    t.Helper()
    ctx, cancel := context.WithCancel(context.Background())
    in := make(chan Point)
    out := make(chan []Point, 4)
    s := New(in, out).WithSize(size).WithWait(wait)
    go func() { _ = s.Run(ctx) }()
    return in, out, cancel
}

func mustReceive(t *testing.T, ch <-chan []Point, n int) []Point {
    t.Helper()
    select {
    case b := <-ch:
        if len(b) != n { t.Fatalf("want %d, got %d", n, len(b)) }
        return b
    case <-time.After(2 * time.Second):
        t.Fatal("timeout waiting for batch")
    }
    return nil
}

func TestSize(t *testing.T) {
    in, out, cancel := newStage(t, 3, time.Hour)
    defer cancel()
    for i := 0; i < 9; i++ { in <- Point{ID: i} }
    for i := 0; i < 3; i++ { mustReceive(t, out, 3) }
}

func TestTime(t *testing.T) {
    in, out, cancel := newStage(t, 100, 30*time.Millisecond)
    defer cancel()
    in <- Point{ID: 1}
    in <- Point{ID: 2}
    mustReceive(t, out, 2)
}

func TestFinalFlush(t *testing.T) {
    in, out, cancel := newStage(t, 100, time.Hour)
    defer cancel()
    in <- Point{ID: 1}
    in <- Point{ID: 2}
    in <- Point{ID: 3}
    close(in)
    mustReceive(t, out, 3)
    if _, ok := <-out; ok { t.Fatal("expected out closed") }
}

func TestCancel(t *testing.T) {
    in, out, cancel := newStage(t, 100, time.Hour)
    in <- Point{ID: 1}
    in <- Point{ID: 2}
    cancel()
    // either we get the batch, or out is closed; both acceptable
    select {
    case b, ok := <-out:
        if ok && len(b) != 2 { t.Fatalf("unexpected batch: %v", b) }
    case <-time.After(2 * time.Second):
        t.Fatal("no resolution after cancel")
    }
}

func TestNoEmpty(t *testing.T) {
    _, out, cancel := newStage(t, 100, 10*time.Millisecond)
    defer cancel()
    time.Sleep(50 * time.Millisecond)
    select {
    case b := <-out:
        t.Fatalf("unexpected empty batch: %v", b)
    case <-time.After(20 * time.Millisecond):
    }
}

func TestConcurrent(t *testing.T) {
    in, out, cancel := newStage(t, 50, 20*time.Millisecond)
    defer cancel()
    var wg sync.WaitGroup
    for w := 0; w < 4; w++ {
        wg.Add(1)
        go func(w int) {
            defer wg.Done()
            for i := 0; i < 250; i++ {
                in <- Point{ID: w*1000 + i}
            }
        }(w)
    }
    go func() { wg.Wait(); close(in) }()

    total := 0
    for b := range out { total += len(b) }
    if total != 1000 { t.Fatalf("want 1000, got %d", total) }
}

type Point struct { ID int }

func TestErrorPath(t *testing.T) {
    // Stage with injected write that fails sometimes.
    in := make(chan Point)
    out := make(chan []Point, 4)
    errs := make(chan error, 1)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    go func() {
        _ = New(in, out).WithSize(3).WithWait(time.Hour).Run(ctx)
    }()

    go func() {
        for b := range out {
            if len(b) > 0 && b[0].ID == 42 {
                errs <- errors.New("simulated")
                continue
            }
        }
        close(errs)
    }()

    for i := 0; i < 6; i++ { in <- Point{ID: i} }
    in <- Point{ID: 42}; in <- Point{ID: 43}; in <- Point{ID: 44}
    close(in)

    select {
    case err := <-errs:
        if err == nil || err.Error() != "simulated" {
            t.Fatalf("want simulated, got %v", err)
        }
    case <-time.After(2 * time.Second):
        t.Fatal("no error reported")
    }
}

func ExampleStage() {
    in := make(chan Point)
    out := make(chan []Point, 4)
    ctx := context.Background()
    go func() { _ = New(in, out).WithSize(3).WithWait(time.Hour).Run(ctx) }()
    go func() {
        for i := 0; i < 3; i++ { in <- Point{ID: i} }
        close(in)
    }()
    b := <-out
    fmt.Println("batch:", b)
    // Output: batch: [{0} {1} {2}]
}
```

Test methodology:

- Helper `newStage` and `mustReceive` cut boilerplate.
- One test per trigger, plus a concurrent-producer test.
- An error-path test that simulates a downstream failure.
- A doc-test (`ExampleStage`) that doubles as documentation.

Adapt to your stage; ship this set with every batching component.

---

## Appendix E — Question to Ask in a Design Review

When a colleague proposes a batching design, ask these in order. The first one without a good answer flags a problem.

1. What is the latency SLO and where does `maxWait` sit relative to it?
2. What is the sink's preferred batch size and how did you measure?
3. How many in-flight batches can there be? Is the bound enforced?
4. How does ordering matter? If yes, single flusher or per-key flusher?
5. What happens to the partial batch on input close?
6. What happens to the partial batch on context cancel?
7. Who owns the close of `out`?
8. How is the time trigger tested? Sleep or fake clock?
9. What metrics are emitted? Flush reason histogram?
10. What is the memory footprint? `maxSize * sizeof(item) * expected_keys`.
11. What happens if the sink fails on a batch? Retry, split, DLQ, drop?
12. Is there any anti-pattern in the code (time.After in loop, unbounded async flush, etc.)?

A solid design answers all 12 quickly.

---

## Appendix F — A Final Walkthrough — The Stage You Will Ship

Here is the complete stage we have built, in one file, ready to ship:

```go
// Package batching provides a generic micro-batching pipeline stage.
//
// A Stage reads items from an input channel, accumulates them into batches of
// at most MaxSize items or MaxWait wall-clock duration, and emits each batch
// on an output channel. The stage flushes the current partial batch and exits
// on either input-channel close or context cancellation. It closes its output
// channel exactly once, on exit.
package batching

import (
    "context"
    "errors"
    "time"
)

type Reason string

const (
    ReasonSize   Reason = "size"
    ReasonTime   Reason = "time"
    ReasonClose  Reason = "close"
    ReasonCancel Reason = "cancel"
)

type Stage[T any] struct {
    in       <-chan T
    out      chan<- []T
    MaxSize  int
    MaxWait  time.Duration
    OutCap   int
    OnFlush  func(Reason, []T)
    Name     string
}

func New[T any](in <-chan T, out chan<- []T) *Stage[T] {
    return &Stage[T]{
        in:      in,
        out:     out,
        MaxSize: 100,
        MaxWait: 50 * time.Millisecond,
    }
}

func (s *Stage[T]) Validate() error {
    if s.in == nil { return errors.New("nil input channel") }
    if s.MaxSize <= 0 { return errors.New("MaxSize must be > 0") }
    if s.MaxWait <= 0 { return errors.New("MaxWait must be > 0") }
    return nil
}

func (s *Stage[T]) Run(ctx context.Context) error {
    if err := s.Validate(); err != nil { return err }
    out := s.out.(chan []T)
    defer close(out)

    buf := make([]T, 0, s.MaxSize)
    timer := time.NewTimer(s.MaxWait)
    if !timer.Stop() { <-timer.C }

    flush := func(r Reason) {
        if len(buf) == 0 { return }
        batch := make([]T, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() {
            select { case <-timer.C: default: }
        }
        if s.OnFlush != nil { s.OnFlush(r, batch) }
        select {
        case out <- batch:
        case <-ctx.Done():
        }
    }

    for {
        select {
        case x, ok := <-s.in:
            if !ok { flush(ReasonClose); return nil }
            if len(buf) == 0 { timer.Reset(s.MaxWait) }
            buf = append(buf, x)
            if len(buf) >= s.MaxSize { flush(ReasonSize) }
        case <-timer.C:
            flush(ReasonTime)
        case <-ctx.Done():
            flush(ReasonCancel)
            return ctx.Err()
        }
    }
}
```

That is the shipping form. Generic, tagged, configured, validated, cancellable, closed-on-exit. Use it as your starting point in any project.

---

## Final Words

You have spent a lot of pages on a tiny topic — one goroutine that batches items. The depth is justified because:

1. **Batching shows up in every non-trivial pipeline.** You will write or review one in nearly every job.
2. **The bugs are silent.** Forgotten flush, leaked timer, captured slice header — none of them throw exceptions. They cause subtle correctness or performance bugs that get blamed on something else.
3. **The trade-offs are real.** `maxSize` and `maxWait` are not aesthetic choices; they directly affect cost and latency. Tune them well and the system pays for itself.
4. **The patterns transfer.** Once you know the triple-trigger select-loop, you can recognise it in dozens of other Go patterns: timeouts, retries, leases, watchers.

Master this and you can build any production batching stage with confidence. Senior.md is next.



