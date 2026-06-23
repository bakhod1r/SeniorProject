---
layout: default
title: Interview
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/interview/
---

# Batching — Interview Questions

> Questions ranging from junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is a batcher?

**Model answer.** A batcher is a piece of code that collects individual operations and flushes them as a single unit to a downstream sink. It amortises the fixed per-call cost (network round-trip, query parse) across many items. Two triggers: size (flush when N items have accumulated) and time (flush when D has elapsed).

**Common wrong answers.**
- "A goroutine that processes items in parallel." (No — that is a worker pool.)
- "A channel with a large buffer." (No — that is just a queue; a batcher groups items into calls.)
- "Something Kafka does for you." (Kafka's producer does batch, but application-level batching is also a thing.)

**Follow-up.** *What is the per-call cost?* Connection lookup, parse, planning, round-trip. The thing that is independent of payload size.

---

### Q2. Why do you need both size and time triggers?

**Model answer.** Size only: low-traffic items wait forever. Time only: high-traffic produces unbounded batches. Both ensure bounded latency and bounded batch size.

**Common wrong answers.**
- "Time is for low load, size is for high load." (Half right; the full answer is that *each* fails in *one* regime.)
- "Just to be safe." (Be specific.)

**Follow-up.** *What happens with size only at 1 item per minute?* The item waits indefinitely for 99 more.

---

### Q3. Write a batcher with size and time triggers.

**Model answer.**

```go
type Batcher struct {
    in       chan Item
    sink     Sink
    maxSize  int
    maxDelay time.Duration
    done     chan struct{}
}

func (b *Batcher) Add(item Item) { b.in <- item }

func (b *Batcher) run() {
    defer close(b.done)
    buf := make([]Item, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    flush := func() {
        if len(buf) == 0 {
            return
        }
        batch := make([]Item, len(buf))
        copy(batch, buf)
        b.sink.Write(batch)
        buf = buf[:0]
    }
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                flush()
                return
            }
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                flush()
            }
        case <-ticker.C:
            flush()
        }
    }
}

func (b *Batcher) Close() {
    close(b.in)
    <-b.done
}
```

**Follow-up.** *Why the defensive copy?* So the sink can hold the slice past our next reset.

---

### Q4. What happens if `Close` is called twice?

**Model answer.** `close(b.in)` panics on the second call ("close of closed channel"). Fix: wrap in `sync.Once`.

**Follow-up.** *What if a producer calls `b.in <- item` after close?* Panic: "send on closed channel". Fix: have `Add` check a separate `closeCh` first.

---

### Q5. Why does the batcher need a `done` channel?

**Model answer.** `close(b.in)` returns immediately. The orchestrator wants to wait until the run loop has *actually* flushed the remaining items and exited. The `done` channel, closed by the run loop on exit, signals "I am done; safe to proceed".

---

## Middle

### Q6. How do you handle a slow sink?

**Model answer.** Per-flush timeout via `context.WithTimeout`. If repeatedly slow, retry with backoff (separate decorator). For sustained slowness, circuit breaker. For permanent failures, dead-letter queue.

**Common wrong answers.**
- "Wait longer." (Hides the problem, not a fix.)
- "Drop the batch." (Loss; need to think about whether acceptable.)

**Follow-up.** *What if the sink hangs?* Per-flush timeout fires; flush returns error; retry layer kicks in.

---

### Q7. How do you observe a batcher?

**Model answer.** Four metrics: batch_size histogram, flush_duration histogram, flush_reason counter (labels: size, time, shutdown), queue_depth gauge. Plus tally counters (enqueued, flushed_ok, flushed_fail, dropped_on_shutdown) for sanity.

**Follow-up.** *What does p99 batch_size near MaxBatchSize tell you?* The size trigger is firing; throughput-bound.

*What about p99 batch_size near 1?* The time trigger is firing; low traffic.

---

### Q8. What is the difference between `time.Ticker` and `time.Timer` for the time trigger?

**Model answer.** Ticker fires on a fixed wall-clock schedule, drifting from "X ms after first item". Timer fires exactly X ms after start. Ticker is simpler; Timer gives tighter per-batch latency bounds. Most production batchers use Timer for that reason.

**Follow-up.** *What is the Reset gotcha for Timer?* Need to drain channel before Reset (pre-Go 1.23).

---

### Q9. Walk through an `Add` call.

**Model answer.**

1. Check `closeCh` — if closed, return `ErrClosed`.
2. `select` over send-on-input-channel, ctx-done, closeCh.
3. If channel has space: enqueue, increment counter, return nil.
4. If ctx cancels: return `ctx.Err()`.
5. If closeCh closes: return `ErrClosed`.

The double-check on closeCh prevents the race where close happens between check and send.

---

### Q10. Implement retries with backoff.

**Model answer.**

```go
type RetryingSink struct {
    inner    Sink
    maxTries int
    base     time.Duration
}

func (r *RetryingSink) Write(ctx context.Context, batch []Item) error {
    var err error
    delay := r.base
    for try := 0; try < r.maxTries; try++ {
        err = r.inner.Write(ctx, batch)
        if err == nil {
            return nil
        }
        if !isTransient(err) {
            return err
        }
        sleep := delay + time.Duration(rand.Int63n(int64(delay)))
        select {
        case <-time.After(sleep):
        case <-ctx.Done():
            return ctx.Err()
        }
        delay *= 2
    }
    return err
}
```

**Follow-up.** *Why the jitter?* Avoid synchronised retry storms after a downstream outage.

---

### Q11. Integrating with Postgres: INSERT vs COPY?

**Model answer.** INSERT for small batches (< 500) and when ON CONFLICT is needed. COPY for large batches (> 500) for 5-10x speedup. For idempotent bulk insert: COPY into a temp table, then INSERT SELECT ... ON CONFLICT.

**Follow-up.** *What is the parameter limit?* Postgres allows 65535 parameters per query. With 3-column rows that is ~21K rows in a multi-row INSERT.

---

### Q12. How do you test a batcher's time trigger without making tests slow?

**Model answer.** Inject a fake clock (clockwork, benbjohnson/clock). Tests `Advance(50 * time.Millisecond)` and assert flush. Test runs in microseconds.

**Common wrong answer.** "Set MaxBatchDelay short and time.Sleep." (Flaky; sleeps cause CI failures.)

---

## Senior

### Q13. Design an audit-log ingestion service. 50K events/s peak. p99 100 ms. 99.99% durability on clean shutdown.

**Model answer.** See senior.md "Detailed Design Document: Audit Log Batcher". Key points:

- Shared batcher, MaxBatchSize=500, MaxBatchDelay=100 ms, QueueDepth=8192.
- Sink: pgx CopyFrom.
- 4 flush workers (pipeline architecture).
- Retry layer: 3 transient retries, exponential backoff.
- Circuit breaker.
- DLQ to Kafka.
- 30 second drain deadline.
- Four metrics with alerts.
- Feature-flag rollout.

**Follow-up.** *What if the latency budget is 10 ms instead of 100?* Tighter MaxBatchDelay (5-8 ms). Smaller batches. Higher overhead. May need to scale Postgres or rethink the design.

---

### Q14. The downstream is rate-limited at 100 calls/s. Your traffic peaks at 50K items/s. Configure the batcher.

**Model answer.** Need at least 500 items/batch to stay within 100 calls/s (50K/500=100). For headroom, aim 70 calls/s, so batches of 715. Round up to MaxBatchSize=1000. MaxBatchDelay so that batches usually fill: 1000/50000 = 20 ms.

If you cannot rely on 50K being steady-state, add a token-bucket throttle.

---

### Q15. Multi-tenant: tenant A sends 10K/s, tenants B-Z send 1/s each. Design the batcher.

**Model answer.** Per-tenant sub-batchers, or a single shared batcher with per-tenant flush triggers. Either works; the key is preventing A's failures from affecting B-Z.

Shared batcher: keep `map[tenant][]Item` in the run loop. Flush per-tenant on size, time, or shutdown. Per-tenant timer.

Caps: per-tenant max items in buffer (e.g., 1000); reject when exceeded.

**Follow-up.** *Memory?* numTenants * maxItemsPerTenant. Bound by aggregate cap.

---

### Q16. The batcher's flush latency p99 is 5 seconds. What is happening?

**Model answer.** Multiple possibilities:

1. Sink overloaded (DB CPU, network saturated).
2. Sink intermittently slow (occasional locks, GC pauses).
3. Retries adding to the latency (each retry adds ~1 s).
4. Connection pool starvation (waiting for a slot).
5. Lock contention in the sink (Postgres row locks held).

Read traces, check pool depth, check downstream metrics. Usually 1 or 4.

---

### Q17. How do you scale a batcher from 10K to 1M items/s?

**Model answer.**

- Shard input: hash producer to one of N shards. Each shard is one batcher.
- Per-shard sink connections.
- Horizontal scaling of the service.
- Multi-region if cross-DC bandwidth matters.
- Consider streaming platform (Kafka, Pulsar) if app-level batching cannot keep up.

**Follow-up.** *What if items have an order dependency?* Single shard for the ordered subset; multi-shard for independent items.

---

### Q18. The DLQ is filling at 100 items/s. What do you do?

**Model answer.**

1. Read DLQ items. What is the error? Is it the same error?
2. If same error: root cause (schema mismatch, auth issue, payload bug). Fix and drain.
3. If varied: classify. If many transient that should not be DLQ'd, fix the classifier.
4. If sustained: the DLQ is now your real queue. Set up alerting; investigate at the source.

---

### Q19. How do you ensure no items are lost when the process is SIGTERM'd?

**Model answer.**

1. Wire SIGTERM to `Shutdown(ctx)`.
2. Use a deadline (`context.WithTimeout(ctx, 30s)`).
3. The batcher drains the input channel, flushes the buffer, waits for in-flight flushes.
4. If deadline exceeded, items lost; log the count.

True zero-loss requires upstream replay (Kafka, idempotent retries) since the batcher's in-memory state is at risk on hard kill.

---

### Q20. Compare batcher + retry + DLQ versus an outbox pattern.

**Model answer.**

- Batcher: in-memory, lossy on crash, low complexity.
- Outbox: write to outbox table inside business transaction; separate process drains. Durable, complex.

Use batcher when: items are stateless or upstream is replayable. Use outbox when: items are tied to a business transaction.

---

## Staff

### Q21. The downstream Postgres throughput is 50K rows/s but our batcher only achieves 10K. Why?

**Model answer.** Many possible reasons:

1. Per-flush call is dominated by round-trip (small batches; not amortising).
2. Connection pool too small (fewer concurrent flushes than the DB can handle).
3. Flush latency > MaxBatchDelay (batches incomplete on time-trigger).
4. Lock contention on the target table.
5. WAL fsync bottleneck (DB-side).
6. Network limits.
7. Serialisation overhead in the batcher itself.

Profile both ends. Typical finding: pool size too small. Or: serialisation hot loop.

**Follow-up.** *How would you confirm pool starvation?* `pg_stat_activity` for queued waits; check `db.Stats().WaitCount`.

---

### Q22. Design a batcher that supports both at-least-once and at-most-once semantics for different items.

**Model answer.** Per-item flag on enqueue: `important bool`. Important items go to a separate "durable" path with `AddWithAck` (caller blocks until durable). Non-important go to the fast path (fire-and-forget).

Internally, two queues + one flush loop, or two completely separate batchers. Two batchers is simpler.

---

### Q23. How would you build a persistent buffer for a batcher?

**Model answer.** Use an embedded LSM-tree (BadgerDB, Pebble) as the buffer. Items are committed to the LSM on Add (with WAL fsync for durability). The batcher reads from the LSM in batches and flushes to the sink. On successful flush, items are deleted from the LSM.

Trade-offs: disk I/O on every Add (10K-50K Add/s ceiling, not 1M+). For high-volume + high-durability, use Kafka upstream instead of a persistent buffer.

---

### Q24. Lock-free batcher: when, how, why?

**Model answer.** When channels are the profiling bottleneck (>10% time in `runtime.chansend`). Usually only at > 10M ops/s.

How: replace `chan T` with an MPMC ring buffer (Vyukov). The run loop dequeues via CAS; producers enqueue via CAS. No mutex, no parking.

Why: avoid scheduler involvement on every op; squeeze nanoseconds.

Cost: complex; lose backpressure semantics (must spin or sleep on empty/full).

---

### Q25. NUMA awareness: when does it matter for a batcher?

**Model answer.** When the batcher runs on a multi-socket box and items are produced on one node, consumed on another. Memory access latency 2-3x higher across NUMA.

Mitigation: pin batcher goroutines to one NUMA node (LockOSThread + sched_setaffinity). Or run per-node batchers.

For most cloud VMs (single socket), NUMA is moot. For high-end servers (32+ cores across 2 sockets), NUMA tuning can give 20-30% throughput.

---

### Q26. How would you implement an adaptive batch size with control theory?

**Model answer.** PID controller. Setpoint: 80% utilisation of MaxBatchSize. Measured: rolling average actual batch size. Output: change to MaxBatchSize.

Kp dominates: aggressive response to deviation. Ki for steady-state error. Kd to damp oscillation.

Tune via Ziegler-Nichols or manual. Watch for oscillation; if persistent, lower gains.

Simple proportional is usually enough.

---

### Q27. Compare Kafka's producer batching with your application-level batcher.

**Model answer.**

- Kafka's: per-partition buffers, linger.ms time trigger, batch.size byte trigger, internal compression, callback-style.
- App-level: per-process buffer, count and time triggers, application-specific items, slice-based.

Kafka's is good for the Kafka use case. App-level is good for non-Kafka sinks or for combining/transforming items before Kafka.

Layering both is rarely needed; choose one based on requirements.

---

### Q28. Walk through what happens between `pgx.CopyFrom` call and the row appearing in the database.

**Model answer.**

1. Application calls `conn.CopyFrom(ctx, table, cols, rows)`.
2. pgx sends `COPY table (cols) FROM STDIN BINARY` to Postgres.
3. Postgres responds with `CopyInResponse`.
4. pgx encodes each row in binary format, streams it in chunks (~65KB).
5. Postgres receives, parses each row, inserts into heap, updates indexes, writes WAL.
6. pgx sends `CopyDone`.
7. Postgres acks; CopyFrom returns.

The whole thing is one transaction (default). WAL fsync at commit.

Throughput: 100K-500K rows/s per connection, depending on schema.

---

### Q29. The team wants to add a "real-time" guarantee to the batcher (items durable within 10 ms). Approach?

**Model answer.** Reduce MaxBatchDelay to 5 ms. Increase flush workers to absorb burst. Possibly remove the batcher and write synchronously (small batches are OK; 10 ms is very tight).

Verify: SLO measurements. Is the sink fast enough at 5 ms? If yes, OK. If no, the SLO is unachievable; renegotiate with the requester.

---

### Q30. How do you debug a "missing items" incident?

**Model answer.**

1. Tally check: enqueued == flushed_ok + flushed_fail + dropped_on_shutdown + in_flight. If not, batcher bug.
2. Check shutdown logs: did Shutdown return error? Were items lost on timeout?
3. Check DLQ: are the missing items there?
4. Check sink: did some items succeed, others not? (Per-item bulk results.)
5. Check upstream: did the items actually arrive? (Could be a producer-side bug.)

90% of "missing items" are shutdown bugs. 9% are upstream bugs (items never arrived). 1% are batcher bugs.

---

## Behavioral / Architecture

### Q31. Describe a batcher you have shipped. What was the tricky part?

(Open-ended; tailor to your experience.)

Good answers reference: choice of size/delay (with measurements), shutdown design, observability gaps you closed, an incident and what it taught you.

---

### Q32. When would you choose NOT to batch?

**Model answer.** Synchronous per-request semantics, very low volume, idempotency cost too high, downstream already batches internally with no app-level value-add.

---

### Q33. Walk through a code review of a batcher PR. What would you flag?

**Model answer.** Use the senior.md "Design Review Checklist". Key points:

- Both triggers present?
- Shutdown with deadline?
- Defensive copy?
- Bounded queue?
- Metrics emitted?
- Tests for each trigger?

---

### Q34. The batcher is a black box to the rest of the team. How do you fix that?

**Model answer.** Documentation: runbook, architecture diagram, latency budget. Metrics: emit and dashboard. Alerts: route to on-call. Pair-program with junior engineers on a batcher-related bug.

The senior engineer makes the batcher legible. The team learns by reading and operating.

---

## Tricky Numerical

### Q35. Batcher with MaxBatchSize=1000, MaxBatchDelay=100 ms. Arrival rate 1000/s steady. Estimate p99 per-item latency.

**Model answer.** At 1000/s and MaxBatchDelay 100 ms, batches fill at exactly the time trigger. Worst-case per-item latency: ~100 ms (waited the full window).

p99 of per-item latency ≈ MaxBatchDelay = 100 ms.

---

### Q36. Same batcher. Arrival 10000/s.

**Model answer.** Batches fill in 100 ms / 10 batches = 10 ms. p99 ≈ 10 ms (queue plus wait).

---

### Q37. Same batcher. Arrival 100/s.

**Model answer.** Batches fill in 1 second of arrival; but time trigger fires at 100 ms with ~10 items. p99 ≈ 100 ms.

The size trigger doesn't engage at this rate; the time trigger drives everything.

---

### Q38. Compute the throughput improvement from batching a sink with C_call = 5 ms, C_item = 50 µs, batch size 100.

**Model answer.**

Unbatched: 5.05 ms per item -> 200 items/s.
Batched 100: 5 ms + 5 ms = 10 ms per batch -> 10000 items/s.

Improvement: 50x.

---

These questions span from "can you implement a batcher" to "can you reason about distributed systems". Working through them all is a self-test for staff readiness.

## Bonus Round: Open-Ended Discussion Questions

These have no single right answer. They are conversation starters.

### Q39. Where would you draw the line between application-level and infrastructure-level batching?

Discussion points:
- Application: when items need transformation, combining, or app-specific routing.
- Infrastructure (sidecar, library, service mesh): when batching is uniform across services.
- Hybrid: app batches semantically; infrastructure batches at the transport.

### Q40. How would you migrate a synchronous-write service to batched writes without an outage?

Discussion points:
- Feature flag for the new code path.
- Dual-write during migration.
- Compare end-to-end metrics.
- Switch primary path; remove old.

### Q41. The team wants strict ordering across all batches. How do you achieve it?

Discussion points:
- Single flusher, single goroutine.
- No retry-and-skip; on failure, halt or DLQ in order.
- Per-key ordering via per-key batchers.
- True total ordering requires distributed consensus.

### Q42. The sink's contract changes (new required field). How do you migrate?

Discussion points:
- Versioned items.
- Old code reads old items; new code reads both.
- Drain-and-restart strategy.
- Forward and backward compatibility.

### Q43. You inherit a batcher with no tests. What is your first move?

Discussion points:
- Write the three canonical tests (size, time, close-drain).
- Add a -race test under load.
- Verify no obvious bugs.
- Add observability before refactoring.

### Q44. The batcher's `MaxBatchDelay` is set to 1 hour. Is that always wrong?

Discussion points:
- Almost always wrong because of crash loss.
- Acceptable for: ETL with persistent buffer, sinks where 1 hr loss is tolerated.
- Almost never for online services.

### Q45. What is the difference between batching and pipelining?

Discussion points:
- Batching: collect N, send as one.
- Pipelining: send N requests without waiting for individual responses (HTTP pipelining, Redis pipelining).
- Both amortise per-call cost; different mechanisms.

### Q46. How would you design a batcher for a stream of events with timestamps that must be processed in order?

Discussion points:
- Per-key ordering (single-flusher per key).
- Sequence numbers as fall-back.
- Watermark handling for late events.
- Window-based batching (events within a time window).

### Q47. The downstream is at 100% CPU. What does the batcher show?

Discussion points:
- Flush duration p99 spikes.
- Queue depth grows.
- Possibly: 503 from sink, retry storm, circuit breaker opens.

### Q48. The team disagrees on batch size. Half say 100, half say 1000. How do you settle it?

Discussion points:
- Measure on real workload.
- Decide based on observed throughput vs latency.
- Document the choice in a Decision Record.

### Q49. How do you handle a batcher that is in a deploy loop (crashes and restarts repeatedly)?

Discussion points:
- Each restart drops the buffer.
- Upstream replay covers if available.
- Otherwise: loss.
- Fix the crash; don't keep deploying.

### Q50. What is the most important metric on a batcher's dashboard?

Discussion points:
- Subjective. Top contenders: flush_duration p99, queue_depth, drop rate, DLQ rate.
- Mine: flush_duration p99. It is the canary for everything.

Discuss these in a team setting. Disagree productively.

## Coding Challenges

These are short coding tasks. Solve in 15-30 minutes each.

### CC1. Add a `Flush()` method

Add a synchronous Flush method that returns after the current buffer is fully drained.

### CC2. Implement per-item ack

Implement `AddWithAck` that returns a channel; the channel receives the flush result.

### CC3. Bound the retry queue

Add a retry layer with a bounded retry queue. On overflow, send to DLQ.

### CC4. Adaptive sizing

Implement adaptive sizing based on observed fill rate.

### CC5. Multi-tenant fair share

Implement per-tenant fair share: each tenant's batches are flushed in round-robin.

These exercises are scoped for a 60-90 minute interview slot. Pair with discussion.
