---
layout: default
title: Batching Stages — Tasks
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/tasks/
---

# Batching Stages — Hands-on Tasks

> Practical exercises from easy to hard. Each says what to build, what success looks like, and a hint. Solution sketches are at the end.

---

## Easy

### Task 1 — The canonical accumulator

Implement `Batch[T any](ctx context.Context, in <-chan T, out chan<- []T, maxSize int, maxWait time.Duration)` with the triple-trigger select-loop.

- Size trigger inline in receive case.
- Time trigger via `*time.Timer`.
- End-of-stream via `ok == false`.
- Cancellation via `ctx.Done()`.
- Final flush in every exit path.
- `defer close(out)`.

**Success.** A test that sends 9 items with `maxSize=3` receives three batches of three. A test that sends 3 items with `maxSize=10` and closes input receives one batch of three.

**Hint.** Use the pattern from junior.md Example 1. Memorise it.

---

### Task 2 — The final-flush test

Write a `TestBatch_FinalFlushOnClose` test that exposes the missing-final-flush bug.

- Send 3 items.
- Close the input channel.
- Read all batches.
- Assert that you received exactly 3 items in total.
- Assert that the output channel is closed afterwards.

**Success.** With a correct implementation, the test passes. With a buggy one (missing final flush), it fails.

**Hint.** Use `time.After` with a generous timeout to bound the test runtime.

---

### Task 3 — The cancellation test

Write a `TestBatch_FlushOnCancel` test.

- Send 2 items.
- Cancel the context.
- Assert that either you receive the batch of 2, or the output closes (best-effort flush). Both are acceptable.
- Assert that the goroutine exits within bounded time.

**Hint.** The test must tolerate the race between flush-and-send vs cancel-wins.

---

### Task 4 — Add a flush hook

Add a `OnFlush func(reason string, batch []T)` field to your stage. Call it on every flush with the reason ("size", "time", "close", "cancel") and the batch slice.

**Success.** A test asserts that flushing 9 items with `maxSize=3` triggers the hook 3 times with reason "size", and closing the input triggers it once more (or none if buffer was empty).

---

### Task 5 — A simple DB writer

Wrap your batching stage in a function `RunDBWriter(ctx, db, in)` that:

- Spawns the batching stage.
- Reads batches from the output channel.
- Calls `db.BatchInsert(ctx, batch)` for each.
- Logs errors but does not stop the loop.

**Success.** Driving the writer with a fake `db` shows that batches reach the DB; errors are logged.

---

## Medium

### Task 6 — Bounded async flush

Modify your stage to support bounded async flush. Take an `Inflight int` parameter; if `> 0`, spawn `Inflight` worker goroutines reading from a `jobs chan []T` of capacity `Inflight`. The accumulator dispatches via `jobs <- batch`.

**Success.** Under sync flush throughput is capped; under async with `Inflight=4` throughput is ~4× higher.

**Hint.** Use `sync.WaitGroup` to wait for workers on exit.

---

### Task 7 — Per-key batching

Implement `BatchByKey[T any, K comparable]` where each item has a key. Maintain a separate buffer per key with its own timer. Flush per-key on size, time, or shutdown.

**Success.** With keys A and B sending in alternation, each key gets its own batches; cross-key items do not mix.

**Hint.** Use `time.AfterFunc` per key with a shared dispatch channel.

---

### Task 8 — Idle eviction

Extend Task 7 to evict per-key state after `idleTTL` of no items. When idle, flush and remove the key from the state map.

**Success.** A long-running test with sparse traffic per key shows no memory growth.

---

### Task 9 — Retry with backoff

In your bounded-async stage, wrap the worker's `Write` call with retry-with-exponential-backoff. Up to N attempts; final failure goes to a DLQ.

**Success.** Inject a sink that fails 50% of the time. With retries, most batches eventually succeed; a few hit the DLQ.

---

### Task 10 — Metrics

Add Prometheus-style metrics:

- Counter: `batching_flushes_total{reason}`.
- Histogram: `batching_batch_size`.
- Histogram: `batching_flush_wait_seconds`.

**Success.** A test drives the stage and asserts the metrics are populated correctly.

---

## Hard

### Task 11 — Pipelined ordered flushers

Implement a variant that uses N workers but preserves global order. Use the ack-token pattern: each batch carries a sequence number and a `done` channel; a committer drains in sequence.

**Success.** Under N=4 workers, throughput is 4× single-flusher; downstream observes batches in input order.

**Hint.** Two channels: one for work (any-order), one for ordering (in-order). Workers signal completion on per-batch `done`.

---

### Task 12 — Adaptive batch sizing

Implement a control loop that adjusts `maxSize` based on observed flush latency. If latency > target, shrink `maxSize` by 10%. If latency < 0.8 × target, grow by 10%. Clamp.

**Success.** Under fast sink, `maxSize` grows toward `hardMax`. Under slow sink, shrinks toward `min`. Latency stays near target.

**Hint.** EMA-smooth the latency observations to avoid noise.

---

### Task 13 — Fake clock testing

Define a `Clock` interface; implement `realClock` and `fakeClock`. Inject `Clock` into your batching stage. In tests, advance the fake clock manually to trigger the time trigger deterministically.

**Success.** A test using the fake clock asserts the time trigger fires exactly when expected, with zero `time.Sleep`.

---

### Task 14 — Multi-tier batching

Build a two-stage pipeline:

- L1: collects 100 items in 10 ms; outputs as a slice.
- Compressor: gzips each L1 output.
- L2: collects 10 compressed blobs in 1 s; outputs as a slice of slices.

Drive with a synthetic producer. Verify that all items reach the L2 output through the chain.

**Success.** Producer sends 10,000 items; counter at the final stage equals 10,000.

---

### Task 15 — Production-grade event ingest

Build the event-ingest service from senior.md's appendix:

- HTTP intake with `/events` endpoint.
- Channel-based fan-in to batching stage.
- Bounded async flush to a fake DB with `FailRate` configurable.
- DLQ for permanent failures.
- Graceful shutdown on SIGTERM.

Drive with 100 RPS for 30 seconds. Verify all events reach DB or DLQ; pipeline shuts down cleanly.

**Success.** No goroutine leaks, no data loss (events_in = events_out + DLQ), shutdown completes within 5 seconds.

---

## Bonus

### Task 16 — Jittered timers

Modify your stage to use jittered `maxWait`: each `Reset` uses `maxWait + uniform(-0.1, 0.1) × maxWait`.

**Success.** Across 100 simulated pods, flush times are spread, not synchronised.

---

### Task 17 — Allocation-free hot path

Use `sync.Pool` to remove the per-flush copy allocation. Document the consumer-must-return contract.

**Success.** `pprof -alloc_space` before/after shows the copy allocation eliminated.

---

### Task 18 — Compose with fan-out

Build: producer → batching stage → fan-out to N sink workers.

Producer sends 100K items. Verify all reach a sink (sum across workers equals 100K).

---

### Task 19 — Load-test framework

Write a small load-test harness:

- Generates N items/s for `duration`.
- Measures throughput and latency p50/p99.
- Outputs a summary.

Use it to compare sync vs async flush at different `Inflight` values.

---

### Task 20 — Property-based test

Use `quick.Check` or `gopter` to property-test your stage:

- Property: for any input sequence and any closing schedule, items in = items received downstream.

**Success.** 10,000 random inputs all pass.

---

## Solution Sketches

### Task 1 sketch

See junior.md Example 1. The canonical pattern with `defer close(out)`, triple-trigger select, `flush` closure with stop-and-drain, copy on send, cancellable send.

### Task 6 sketch

```go
jobs := make(chan []T, Inflight)
var wg sync.WaitGroup
for i := 0; i < Inflight; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for b := range jobs { sink.Write(ctx, b) }
    }()
}
// In accumulator's flush:
select {
case jobs <- batch:
case <-ctx.Done():
}
// On exit:
close(jobs); wg.Wait()
```

### Task 7 sketch

```go
states := map[K]*state{}
fired := make(chan K, 64)

arm := func(k K) {
    states[k].timer = time.AfterFunc(maxWait, func() {
        select { case fired <- k: default: }
    })
}

case x, ok := <-in:
    if !ok { flushAll(); return }
    k := keyOf(x)
    if _, has := states[k]; !has { states[k] = newState(); }
    if len(states[k].buf) == 0 { arm(k) }
    states[k].buf = append(states[k].buf, x)
    if len(states[k].buf) >= maxSize { flush(k) }
case k := <-fired:
    flush(k)
```

### Task 11 sketch

```go
type seqBatch[T any] struct {
    seq  uint64
    data []T
    done chan error
}

work := make(chan seqBatch[T], workers)
ordered := make(chan seqBatch[T], workers)

go dispatcher(batches, work, ordered)
for i := 0; i < workers; i++ { go worker(work) }

for ob := range ordered {
    if err := <-ob.done; err != nil { handleErr(err, ob.seq) }
}
```

### Task 12 sketch

```go
ticker := time.NewTicker(controlPeriod)
for range ticker.C {
    if latencyEMA > target {
        maxSize = max(minSize, maxSize * 9 / 10)
    } else if latencyEMA < target * 8 / 10 {
        maxSize = min(hardMax, maxSize * 11 / 10)
    }
}
```

### Task 17 sketch

```go
var pool = sync.Pool{
    New: func() any { s := make([]T, 0, maxSize); return &s },
}

flush := func() {
    if len(buf) == 0 { return }
    pp := pool.Get().(*[]T)
    *pp = append((*pp)[:0], buf...)
    buf = buf[:0]
    select {
    case out <- *pp:
    case <-ctx.Done():
        pool.Put(pp)
    }
}

// Consumer:
for b := range out {
    sink.Write(b)
    s := b[:0]
    pool.Put(&s)
}
```

---

## Suggested Practice Order

Work through tasks in the order they appear. Don't skip ahead — each builds on the previous. By Task 15 you should be able to design a production-grade batching service in an hour.

After completing all tasks, attempt the staff-level design problem in interview.md Q42.

---

## Tips for Efficient Practice

1. **Write before reading.** Try the task before looking at the solution sketch.
2. **Time yourself.** Tasks 1-5 should take < 15 min each by your tenth attempt.
3. **Test as you go.** Don't write 100 lines and then test; test after every behavioral change.
4. **Profile after correctness.** Once it works, run `pprof` and see where time is spent.
5. **Read peer solutions.** GitHub has hundreds of similar implementations. Compare.

---

## Final Note

The exercises here are intentionally cumulative. Task 1's pattern reappears in every later task. Task 7's per-key approach appears in Task 15's tenant routing. The repetition is the point: the canonical patterns must be in your fingers.

After 20 tasks, the patterns are yours.

---

## Additional Tasks for Deepened Practice

### Task 21 — Heartbeat batching

Modify the stage to emit a heartbeat (empty batch) every `heartbeatInterval` even when buffer is empty. Useful for downstream watermark advance.

**Success.** A test with idle input observes regular heartbeats while still flushing real items normally.

### Task 22 — Per-item deadline

Each item carries a `Deadline time.Time`. The accumulator flushes if `time.Until(buf[0].Deadline) < flushBuffer`. Otherwise normal triggers apply.

**Success.** An item with a tight deadline is flushed quickly; items with loose deadlines collect normally.

### Task 23 — Drop-on-full

Provide a `DropOnFull bool` option. When true, the accumulator drops items (incrementing a counter) instead of blocking when downstream is full.

**Success.** A test with a stuck consumer shows items dropped, not accumulator blocked.

### Task 24 — Configurable trigger pair via env

Load `MaxSize` and `MaxWait` from environment variables with sane defaults. Validate at startup.

**Success.** Setting env vars influences runtime behavior; invalid values cause clear startup errors.

### Task 25 — Coalescing accumulator

Modify the per-key stage so that within a key, only the *latest* item is retained. This is the "last-write-wins" pattern.

**Success.** Sending three updates for key `A` and one for key `B` results in one batch with two items (the latest A and the only B).

### Task 26 — Backoff on consecutive failures

If the sink returns errors for N consecutive calls, pause flushing for `cooldown` duration (circuit-breaker pattern). Resume after the cooldown.

**Success.** Injecting persistent failures pauses the pipeline; injecting success resumes it.

### Task 27 — Soft and hard timeout on flush

The flush has a soft timeout (warn) and a hard timeout (cancel + DLQ). Both logged.

**Success.** Slow flushes are warned; very slow flushes are aborted and DLQ'd.

### Task 28 — Cross-batch deduplication

Within an in-flight batch, drop items whose ID has already been seen.

**Success.** Sending 10 items with 5 duplicates results in a batch of 5 unique.

### Task 29 — Sorting at flush

Before sending a batch, sort by item timestamp.

**Success.** Out-of-order arrivals emerge sorted in batches.

### Task 30 — Per-shard batching

Hash items by key into N=4 shards. Each shard has its own accumulator. Verify per-shard isolation.

**Success.** Hot key in shard 1 doesn't affect cold key in shard 2.

---

## Even More Tasks

### Task 31 — Lazy startup

Per-key accumulators start lazily on first item for that key. Test memory: with 1 key, memory ~= 1 accumulator's worth.

### Task 32 — Custom serialization at flush

Add a `Marshal func(batch []T) ([]byte, error)` hook. Default is JSON; custom can be protobuf, msgpack, etc.

**Success.** Switching serialization changes byte size of output but not item count.

### Task 33 — Compression at flush

Add a gzip wrapper around the marshalled batch. Verify byte size reduction.

### Task 34 — Backoff with full jitter

Implement decorrelated jitter backoff (AWS algorithm) for retries.

### Task 35 — Per-shard goroutine pool

Each shard has its own bounded flusher pool. Total goroutines bounded.

### Task 36 — Health endpoint

Expose `/healthz` that reports "healthy" if the stage has flushed in the last 5 seconds.

### Task 37 — Last-flush timestamp metric

Export `batching_last_flush_seconds_ago` as a gauge.

### Task 38 — Per-batch trace span

Wrap each flush in an OpenTelemetry span with `batch_size` and `reason` attributes.

### Task 39 — Slow-consumer alarm

If the output channel stays full for > `slowConsumerThreshold`, emit a warning metric.

### Task 40 — Fuzz test

Use `go test -fuzz` to fuzz the accumulator with random input sequences. Verify no panics, no leaks.

---

## Capstone Project

### Build a production-ready batching library

Create a Go module that exports a batching stage suitable for use in any pipeline. Include:

- Generic `Batch[T any]` with all triggers.
- Bounded async flush option.
- Per-key option.
- Flush hooks.
- Metrics integration (Prometheus or OpenTelemetry).
- Builder-pattern configuration.
- Comprehensive test suite (all six standard tests plus failure modes).
- Documentation with examples.
- Performance benchmarks.

**Success.** A coworker can use your library without reading the source — only the README and godoc.

Time budget: one work week if you've done all 40 tasks above.

---

## Reading List Tasks

### Task R1 — Read Sarama's AsyncProducer source

Map components to concepts: where is the size trigger? Time trigger? Partial-failure handling?

### Task R2 — Read franz-go's RecordBatch

Same exercise, on a more modern Kafka client.

### Task R3 — Read VictoriaMetrics ingest code

Same exercise, on a time-series DB.

### Task R4 — Read the Go memory model spec

The full 30-page spec. Annotate the channel section as it relates to batching.

### Task R5 — Read DDIA ch. 11

Designing Data-Intensive Applications, Stream Processing. Annotate.

---

## Tips for Building Real Pipelines

Once you've done these tasks, you'll be building real pipelines. Some practical tips:

1. **Start small.** First version with simple sync flush. Iterate.
2. **Profile.** Don't optimise blind.
3. **Document.** Future-you reads the godoc.
4. **Test.** Six standard tests minimum.
5. **Measure.** Throughput, latency, memory, GC.
6. **Tune.** `maxSize`, `maxWait`, `Inflight` against load.
7. **Deploy gradually.** Feature flags.
8. **Operate.** Runbooks, metrics, alerts.

---

## Final Practice Note

The tasks here are the path from "knows the canonical pattern" to "ships production batching systems." Forty exercises plus a capstone, with reading.

Estimated time: 80-120 hours. Worth every one.

After completing the capstone, you can claim mastery of batching patterns in Go. The rest is iteration in production.
