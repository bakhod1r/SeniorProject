---
layout: default
title: Tasks
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/tasks/
---

# Batching — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome.

---

## Easy

### Task 1 — Minimal batcher

Implement a `Batcher` struct that accepts `Add(int)` and flushes batches of 10 items to a fake `Sink.Write([]int)`. Use only the size trigger.

- Send 25 items.
- Expect 2 size-triggered flushes + 5 items left in buffer (which you must remember to flush on Close).

**Goal.** Mechanics of size-only batching and the close-trigger.

---

### Task 2 — Add the time trigger

Add a `time.NewTicker(50 * time.Millisecond)` time trigger to Task 1.

- Send 3 items, wait 100 ms.
- Expect 1 time-triggered flush of 3 items.

**Goal.** Two triggers in one `select`.

---

### Task 3 — Reason-tagged flushes

Modify Task 2 so each flush logs its reason: "size", "time", or "shutdown".

- Run a mixed workload; verify the log shows all three reasons over time.

**Goal.** The first step toward observability.

---

### Task 4 — Defensive copy

In your Task 3 code, intentionally remove the defensive copy: `b.sink.Write(buf)` instead of `b.sink.Write(append([]int(nil), buf...))`. Have the sink store received slices and print them later.

- Verify that all stored slices show the *last* batch's contents (because they all alias the same array).
- Fix by re-adding the copy.

**Goal.** Internalise the aliasing bug.

---

### Task 5 — Bounded input channel

Make the input channel buffered with capacity 16. Drive the batcher with a producer that sends 1000 items in a tight loop, while the sink takes 100 ms per call.

- Measure how often `Add` blocks (compute by timing the producer's loop).
- Verify the input channel never exceeds capacity (use `len(b.in)` in the run loop).

**Goal.** Backpressure under load.

---

## Medium

### Task 6 — Idempotent close

Wrap `Close` in `sync.Once` so it is safe to call multiple times.

- Write a test that calls `Close()` from 10 goroutines concurrently.
- Verify no panic, all calls return cleanly.

**Goal.** Real-world close discipline.

---

### Task 7 — Shutdown with deadline

Replace `Close()` with `Shutdown(ctx context.Context) error`. The shutdown drains the buffer if the context allows; on deadline exceeded, returns `ctx.Err()`.

- Test: slow sink (1s per flush), 100 items in buffer, Shutdown with 200 ms ctx. Expect `context.DeadlineExceeded`.
- Test: fast sink, Shutdown with 5s ctx. Expect nil.

**Goal.** Production shutdown contract.

---

### Task 8 — Statistics counters

Add atomic counters for `enqueued`, `flushed_ok`, `flushed_fail`, `dropped_on_shutdown`. Expose via `Stats() Stats`.

- After Shutdown, verify the tally: `enqueued == flushed_ok + flushed_fail + dropped_on_shutdown`.

**Goal.** Tracking items through the batcher.

---

### Task 9 — Retry layer

Implement a `RetryingSink` decorator. The inner sink fails the first 2 attempts then succeeds.

- Configure: maxTries=5, baseDelay=10 ms.
- Verify the batch eventually succeeds after retries.
- Verify retries respect ctx.

**Goal.** Decorator pattern for sinks.

---

### Task 10 — Fake clock

Inject a fake clock into the batcher. Replace `time.NewTicker` with a `Clock.NewTicker`.

- Use `github.com/jonboulle/clockwork` or write your own.
- Write a deterministic test for the time trigger: advance the clock, assert flush.

**Goal.** Deterministic time-based tests.

---

### Task 11 — Per-tenant sub-batchers

Modify the batcher to support a "tenant" key. Maintain one buffer per tenant. Flush each tenant's buffer independently on size, time, or shutdown.

- Send 100 items for tenant A and 100 items for tenant B.
- Verify each tenant gets its own batches (no mixing).

**Goal.** Multi-tenant isolation.

---

### Task 12 — Pipeline architecture

Convert the synchronous-flush batcher to a pipeline. Add a `flushReq` channel and 2 flush worker goroutines.

- Verify under a slow sink (100 ms/call), the run loop never blocks waiting for a flush.
- Verify ordering is preserved (since you have only one consumer of flushReq).

**Goal.** Concurrent flush with backpressure.

---

### Task 13 — Prometheus metrics

Wire up Prometheus counters and histograms for the four metrics: batch_size, flush_duration, flush_reason, queue_depth.

- Expose `/metrics` HTTP endpoint.
- Run the batcher, drive load, look at the metrics page.

**Goal.** Production observability.

---

## Hard

### Task 14 — Postgres COPY sink

Implement a `Sink` that uses `pgx.CopyFrom` to bulk-insert into a Postgres table. Use a `pgxpool.Pool` for connection management.

- Create a `events(user_id, action, ts)` table.
- Drive 10K events into the batcher with `MaxBatchSize=500`.
- Verify all 10K rows are in the database.
- Measure throughput.

**Goal.** Real-world database batching.

---

### Task 15 — Kafka sink

Implement a `Sink` that uses `franz-go` to produce records to a Kafka topic.

- Drive 10K records.
- Verify all 10K are in the topic.
- Compare throughput with and without app-level batching.

**Goal.** Producer integration.

---

### Task 16 — HTTP bulk sink

Implement a `Sink` that POSTs an NDJSON body to an HTTP endpoint. Track both count and byte-size triggers.

- Endpoint accepts up to 10 MB body.
- Drive items of varying sizes; verify the byte-size trigger fires correctly.

**Goal.** Multi-trigger batching for HTTP.

---

### Task 17 — Circuit breaker

Wrap the sink in a circuit breaker (`sony/gobreaker` or similar). After 5 consecutive failures, the circuit opens for 30 seconds.

- Simulate sink failure for 1 minute.
- Verify the circuit opens after 5 failures.
- After 30 s, the circuit tries a probe; if successful, it closes.

**Goal.** Resilience pattern.

---

### Task 18 — DLQ to file

Add a dead-letter sink that writes failed batches to a local file.

- Use the retry decorator above; after retries exhausted, route to DLQ.
- Verify the DLQ file contains the failed batches.

**Goal.** Permanent-failure handling.

---

### Task 19 — Adaptive sizing

Implement an adaptive sizer that observes recent flush stats and adjusts MaxBatchSize.

- Start at 100; range 10 to 10000.
- If avg batch size > 90% MaxBatchSize and avg flush duration < FlushTimeout/2, grow by 25%.
- If avg < 50% or any errors recently, shrink by 12.5%.
- Bench with steady traffic; observe convergence.

**Goal.** Self-tuning batcher.

---

### Task 20 — Full integration test

Build an HTTP service that ingests audit events:

- `POST /event` handler that enqueues into the batcher.
- Batcher with size=500, delay=200 ms, queue=2048.
- Sink: Postgres COPY (use a local test instance or testcontainers).
- Graceful shutdown on SIGTERM with 30s deadline.

- Drive 50K events via a concurrent load generator.
- Verify all 50K land in the database.
- Measure p99 API latency, p99 batch latency, throughput.

**Goal.** Production-grade end-to-end.

---

### Task 21 — Chaos test

For the Task 20 service, add chaos:

- Random SIGTERM during sustained load. Verify drain SLA.
- Network partition (block egress to Postgres) for 30 s. Verify recovery.
- Kill the Postgres instance briefly; restart. Verify retries and recovery.

**Goal.** Validate failure modes.

---

### Task 22 — Lock-free batcher

Replace the channel with a Vyukov-style MPMC ring buffer. Benchmark against the channel version under 1M items/s load.

- Implementation: ~50 lines for the ring; ~50 for the batcher around it.
- Expected: 2-3x throughput improvement; latency slightly higher (spinning).

**Goal.** Lock-free practice.

---

### Task 23 — Read OpenTelemetry's batcher

Read the source of `sdktrace/batch_span_processor.go` in the otel-go repo.

- Identify size trigger, time trigger, shutdown, retry, drop policy.
- Find one thing you would do differently in your code; explain why.

**Goal.** Real-world code reading.

---

## Stretch / Staff-Level

### Task 24 — Persistent buffer

Add an on-disk WAL to the batcher: every Add writes to a log file (fsync); flushes drain the log.

- On crash, restart reads the log and re-flushes.
- Throughput will drop; measure.

**Goal.** Durable batcher.

---

### Task 25 — Multi-region

Build a service with two regions; each has a batcher writing to its local Postgres. Cross-region replication is the database's job (logical or physical replication).

- Verify writes in region A appear in region B after replication delay.
- Test failover.

**Goal.** Distributed systems batching.

---

### Task 26 — Adaptive backpressure

Combine batching with adaptive backpressure: when queue depth > 80%, the HTTP handler starts returning 429 with Retry-After. Below 60%, normal 200/202.

- Verify clients with backoff handle this gracefully.
- Measure the impact on overall throughput.

**Goal.** Composing flow-control mechanisms.

---

### Task 27 — Distributed tracing

Add OpenTelemetry tracing: each item's `Add` span links to the batch's `flush` span. End-to-end traces show fan-in.

- View traces in Jaeger or Tempo.
- Verify a request's trace shows the batched flush.

**Goal.** Tracing across async boundaries.

---

### Task 28 — Custom serialisation

Replace JSON serialisation with Protocol Buffers (or FlatBuffers, MessagePack).

- Measure the throughput delta.
- Compare CPU profile before and after.

**Goal.** Hot-path optimisation.

---

### Task 29 — Coalescer pattern

Implement a coalescing batcher: many "increment counter X" become one row "counter X += N". Use the map-based combiner pattern.

- Drive 1M increments across 100 unique keys.
- Verify the sink sees ~100 rows total (one per key, possibly across multiple flushes).

**Goal.** Combiner-style batching.

---

### Task 30 — Production deployment

Take any of the tasks above, deploy to a real environment (Kubernetes, ECS, whatever you have), and operate it for a week:

- Set up dashboards.
- Configure alerts.
- Write a runbook.
- Conduct a chaos drill.

**Goal.** Operating, not just building.

---

## Solution Sketches

For Task 1-13, the code follows the patterns in junior.md and middle.md directly. Each is a 30-100 line exercise.

For Task 14 (Postgres COPY): see middle.md "Real-World Sink: Postgres Multi-Row INSERT" and the pgx CopyFrom variant.

For Task 15 (Kafka): see middle.md "Real-World Sink: A Kafka Sink With franz-go".

For Task 16 (HTTP bulk): see junior.md "Worked Example: An HTTP Bulk Endpoint Client".

For Task 17 (circuit breaker): use `github.com/sony/gobreaker`. Wrap the sink.

For Task 18 (DLQ): a sink that writes to a file using `os.OpenFile` with `O_APPEND`.

For Task 19 (adaptive sizing): see senior.md "Adaptive Batch Sizing".

For Task 20 (full integration): combine all of the above.

For Task 21 (chaos): use `chaos-mesh` if on Kubernetes, or `pumba` for Docker.

For Task 22 (lock-free): see professional.md "Building a Lock-Free Batcher" and "Ring Buffers and Lock-Free Accumulators".

For Tasks 24-30: open-ended; reference the senior and professional files for guidance.

---

## How to Use These Tasks

Pick three from each section. Build them. Then move on. The repetition is the learning, not the count.

A senior engineer can complete tasks 1-20 in a week or two with focus. Tasks 21-30 are a month-plus project each; treat them as portfolio work.

Each task should leave you with code in a repo that you can show in an interview or refer to in code reviews. The goal is not just to "have done the exercise" but to have a working artefact.

## Bonus Tasks

### Bonus 1 — Build a batcher library

Package everything in a reusable library. Add documentation, examples, and tests. Publish on GitHub.

### Bonus 2 — Open-source contribution

Find an open-source project that uses a batcher. Read the code. Find a small improvement. Submit a PR.

### Bonus 3 — Blog post

Write up your experience building one of these batchers. What did you learn? What surprised you?

### Bonus 4 — Performance comparison

Benchmark the same workload across:
- A naive synchronous version.
- A junior-level batcher.
- A middle-level batcher with retry.
- A senior-level batcher with adaptive sizing.

Plot throughput and latency.

### Bonus 5 — Hot path optimisation

Take the senior-level batcher; optimise the hot path until you cannot squeeze any more performance. Document each change with its measured impact.

### Bonus 6 — Production hardening

Take any task above; harden it for production:
- Add structured logging.
- Add Prometheus metrics with histograms.
- Add OpenTelemetry tracing.
- Write a runbook.
- Add chaos tests.

### Bonus 7 — Compare with library

Compare your hand-rolled batcher with OpenTelemetry's batch span processor. What does theirs do that yours does not? What is in yours but not theirs?

### Bonus 8 — Design a new sink

Pick a sink not covered in the materials (S3 multipart upload, DynamoDB BatchWriteItem, GCS object writer). Implement a Sink wrapper for it. Test under load.

### Bonus 9 — Multi-region batcher

Design and implement a batcher that ships items from one region to a downstream in another region. Account for cross-DC latency (50-200 ms RTT) and bandwidth costs.

### Bonus 10 — Persistent buffer

Implement a batcher with a disk-backed buffer (BadgerDB or your own log file). Verify crash safety with an actual crash test.

## Course Progression Suggestion

If you are working through the entire batching subsection, here is a suggested order:

### Week 1: Mechanics
- Read junior.md.
- Tasks 1-5.
- Verify all tests pass with `-race`.

### Week 2: Production
- Read middle.md.
- Tasks 6-13.
- Build a small audit log service end-to-end.

### Week 3: Architecture
- Read senior.md.
- Tasks 14-20.
- Operate the service for a week; observe metrics.

### Week 4: Depth
- Read professional.md.
- Tasks 21-30 (pick 3-5 that interest you).
- Read OpenTelemetry's BatchSpanProcessor source.

## Reflection Questions

After each set of tasks, ask yourself:

### After Easy Tasks
- Could I rebuild the batcher from memory?
- Do I understand why both triggers are needed?
- Could I explain the close-trigger to a colleague?

### After Medium Tasks
- Could I diagnose a "items missing on deploy" bug?
- Could I design a runbook for "batcher slow"?
- Could I integrate with a new sink in <1 day?

### After Hard Tasks
- Could I size a batcher for a new workload?
- Could I conduct a design review?
- Could I argue for or against an architectural choice?

### After Bonus Tasks
- Could I write a blog post about batching that engineers would learn from?
- Could I contribute to OpenTelemetry SDK?

Each reflection raises the bar. Push through.

## How to Run Multi-Person Pairing on These Tasks

If you have a team:

1. Pair on Task 1-5. Drive and navigate. Switch every 25 minutes.
2. After Task 6, review each other's code. Spot bugs.
3. For Tasks 14-20, divide and conquer. Each person owns one; review at end.
4. For bonus tasks, debate the design. Senior should mentor junior; reverse-shadow as well.

Pair programming on batchers is a great way to build team intuition. The patterns are foundational.

### Beyond
- Bonus tasks as side projects.
- Apply patterns to your day job.
- Write the topic up in a blog post or talk.

This is a 4-week course, roughly 6-8 hours per week. At the end you will be capable of designing, building, operating, and optimising batchers in production.
