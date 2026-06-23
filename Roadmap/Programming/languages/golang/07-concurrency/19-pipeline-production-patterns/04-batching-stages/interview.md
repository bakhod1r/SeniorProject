---
layout: default
title: Batching Stages — Interview Questions
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/interview/
---

# Batching Stages — Interview Questions

> Questions from junior to staff level. Each has a model answer, common wrong answers, and a follow-up probe.

---

## Junior

### Q1. What is a batching stage?

**Model answer.** A pipeline component that reads single items from an input channel and emits them in groups (micro-batches) to an output channel or sink. Batching amortises per-call overhead across many items, typically yielding 10–100× throughput improvements for I/O-bound sinks.

**Common wrong answers.**
- "A buffer." (Misses the grouping for downstream processing.)
- "Just a worker pool." (Confuses parallelism with batching.)

**Follow-up.** *Why batch?* — To amortise per-call overhead: database INSERT, HTTP request, disk write. The fixed cost per call dominates at low batch size; batching dilutes it.

---

### Q2. What are the three triggers?

**Model answer.** Size, time, and end-of-stream (or cancel). The size trigger fires when the buffer reaches `maxSize`. The time trigger fires when `maxWait` has elapsed since the buffer became non-empty. The end-of-stream trigger fires when the input channel closes or the context is cancelled — in either case, the partial buffer is flushed.

**Common wrong answers.**
- "Size and time" (forgets EOS/cancel).
- "Whenever the buffer fills" (only size).

**Follow-up.** *Why do you need all three?* — Size bounds memory. Time bounds latency. EOS prevents data loss on shutdown.

---

### Q3. What does this code do wrong?

```go
for x := range in {
    buf = append(buf, x)
    if len(buf) >= 100 {
        out <- buf
        buf = nil
    }
}
```

**Model answer.** Three bugs: (1) no time trigger, so at low load items wait forever for 100 to accumulate; (2) no final flush, so on input close the partial buffer is lost; (3) sends `buf` directly, which the receiver and the next `append` may both touch, causing data corruption.

**Common wrong answers.**
- "Nothing wrong." (Reviewer dismisses; senior recognises three bugs.)
- "It uses a slice." (Misses the actual issues.)

**Follow-up.** *Fix it.* — Add a `select` with a timer case, a final flush after the loop, and a copy before send.

---

### Q4. What is `defer close(out)` for?

**Model answer.** It ensures the output channel is closed exactly once when the accumulator goroutine exits, regardless of which exit path was taken (normal return, panic, etc.). Closing the output channel signals to downstream consumers that no more batches are coming, so they can exit cleanly via `for b := range out`.

**Follow-up.** *What if another goroutine closes it too?* — Panic ("close of closed channel"). The accumulator must be the sole owner; document and enforce.

---

### Q5. Why copy the buffer before sending?

**Model answer.** Because the accumulator reuses its underlying array via `buf = buf[:0]`. If you send `buf` directly, the next `append` may modify the same array; the consumer sees corrupted data. Copying into a fresh `batch` slice gives the consumer an independent view.

**Follow-up.** *Could we avoid the copy?* — Yes, with `sync.Pool` and a strict consumer-returns-to-pool contract. But the copy is cheap and the bug is subtle; default to copy until measurement says otherwise.

---

## Middle

### Q6. How do you test the time trigger reliably?

**Model answer.** Either (1) use a small `maxWait` (10–50 ms) and a generous test deadline (500 ms), accepting occasional flakes; or (2) inject a fake clock that the test advances manually. Option 2 is fully deterministic.

**Follow-up.** *Show a fake clock interface.* — Define `Clock` with `NewTimer(d) Timer` and `Now()`. `Timer` has `C() <-chan time.Time`, `Stop`, `Reset`. The fake stores all timers and fires them on `Advance(d)`.

---

### Q7. Why is `time.After` in a select loop a bug?

**Model answer.** Each `select` iteration re-evaluates `time.After`, allocating a new `*time.Timer` each time. Under load, this leaks timers — they cannot be stopped because `time.After` returns only the channel, not the timer. The runtime collects them via finalisers eventually, but until then they consume scheduler resources.

**Follow-up.** *What to use instead?* — A single `*time.Timer` created at function start; `Reset(d)` when armed.

---

### Q8. How do you handle a slow sink without losing data?

**Model answer.** Use bounded async flush with a worker pool of size `Inflight`. The accumulator sends batches to a `jobs` channel of capacity `Inflight`. When in-flight is full, the accumulator blocks on dispatch — back-pressure propagates to the producer. Workers retry transient errors and DLQ permanent ones.

**Follow-up.** *What if `Inflight` is unbounded?* — Memory grows without bound; eventually OOM. Always bound.

---

### Q9. What is "flush reason" and why tag it?

**Model answer.** A label on each flush identifying which trigger caused it: `size`, `time`, `close`, or `cancel`. Tagging enables (1) metrics that reveal the operating regime (mostly-size = throughput-bound; mostly-time = latency-bound); (2) deterministic test assertions (you flushed for the right reason); (3) conditional behavior (different policies per reason).

---

### Q10. How would you do per-key batching for 100 tenants?

**Model answer.** Spawn one accumulator goroutine per tenant. Each has its own input channel, buffer, and timer. A router goroutine reads from a shared input and forwards to the right per-tenant channel by hash or direct lookup. On shutdown, the router closes all per-tenant channels.

**Follow-up.** *And for 100,000 tenants?* — Don't spawn 100K goroutines. Use map-of-state with `time.AfterFunc` per key, or shard into N=16-64 accumulators by `hash(key) % N`.

---

## Senior

### Q11. When would you choose sync flush over async?

**Model answer.** When sync throughput meets the SLO. Sync is simpler, preserves back-pressure for free, preserves ordering, and has trivial correctness proofs. Async adds complexity (bounded workers, ordering questions, partial-failure handling) that should only be paid when measurement shows sync is insufficient.

**Follow-up.** *Throughput cap of sync?* — `batch_size / (maxWait + sink_latency)`. For `batch_size=100`, `maxWait=50ms`, `sink_latency=50ms`: 1000 items/s.

---

### Q12. Explain pipelined ordered flushers.

**Model answer.** A pattern that preserves global order while using parallel workers. The dispatcher gives each batch a sequence number and sends `(batch, done_chan)` pairs in order to both a work queue (drained by workers) and an order queue (drained by a single committer). Workers process in arbitrary order but each signals completion on its `done` channel. The committer drains the order queue strictly in sequence, waiting on each `done` before proceeding. This serialises commits in sequence order while parallelising the actual writes.

**Follow-up.** *Throughput?* — Up to `workers / sink_latency × batch_size`. Order preserved at the commit boundary.

---

### Q13. When does `sync.Pool` help, and what's the contract?

**Model answer.** Helps when per-flush allocation is the dominant cost (typically > 10× of throughput-bound CPU). The contract: anyone who Gets an object from the pool must Put it back, otherwise the pool empties and reverts to standard allocation. For batching, this means the consumer of `out` must return the batch slice to the pool after processing.

**Follow-up.** *Pool dynamics under low load?* — Pool entries are released on GC. Under low traffic, the pool empties between requests; no benefit. Pool is for steady state.

---

### Q14. Write a shutdown-flush correctness proof for the canonical stage.

**Model answer.** Invariant: every item received from `in` is either in `buf`, already sent on `out`, or permanently lost. Claim: under input close, lost items = 0. Proof: on `(_, false) := <-in`, `flush()` is called; `flush` copies `buf` and sends on `out`; defer closes `out`. All items in (1) move to (2); none move to (3). QED. Under cancellation: items in `buf` at cancel time may go to (3) if the inner `out <- batch` selects `ctx.Done()` instead; bounded by `maxSize`.

---

### Q15. How would you bound the worst-case memory of a per-key batching stage with 10K keys?

**Model answer.** Per-key memory = `maxSize × sizeof(item)`. Total worst-case = `10K × maxSize × sizeof`. For `maxSize=100`, `sizeof=256`: 256 MB. Bound: either reduce per-key `maxSize`, evict idle keys after `idleTTL`, or shard keys into a smaller fixed pool of accumulators (e.g. 16) so the bound is `16 × maxSize × sizeof`.

---

## Staff

### Q16. Capacity-plan a pipeline: 100K items/s, 256B each, p99 200ms, DynamoDB BatchWriteItem.

**Model answer.** Sink throughput per pod: 8 connections × 12 calls/s (1/80ms) × 25 items = 2400/s. For 100K: 42 pods plus margin (60). End-to-end latency: maxWait + sink_p99 = 50ms + 80ms = 130 ms. Under SLO. Memory per pod: `8 × 25 × 256B = 51KB` in-flight + buffer. Negligible. Add 10% jitter on `maxWait`. Add DLQ. Document.

**Follow-up.** *What if peak doubles?* — Scale to 120 pods. Verify sink global throughput supports. May need sink sharding.

---

### Q17. When does adaptive batch sizing help?

**Model answer.** When workload varies across regimes — e.g. business hours vs overnight — and a static `maxSize` is suboptimal in one or the other. The controller observes flush latency and adjusts `maxSize` up/down to maintain the SLO. Helps when reduce static-tuning friction outweighs the complexity of operating the controller.

**Follow-up.** *Stability concerns?* — Oscillation if gains too aggressive. Use hysteresis (deadband, EMA smoothing) and conservative bounds.

---

### Q18. How does Little's law apply to a batching stage?

**Model answer.** `L = λW`. Items in the system equals arrival rate × average time in system. For a batching stage: `buffer_items ≤ min(maxSize, λ × maxWait)`. At `λ=1000/s`, `maxWait=100ms`: `L ≤ 100` items. Memory: `100 × sizeof(item)`. Predicts buffer footprint without simulation.

**Follow-up.** *What about in-flight batches?* — `L_inflight = Inflight × maxSize`. Predicts total in-flight memory.

---

### Q19. Diagnose: throughput drops 50% during a deploy.

**Model answer.** Likely cause: data loss on cancellation. The cancel-case flush is best-effort; items in `buf` at cancel may not reach the sink. Across a fleet rolling deploy, this aggregates to ~`maxSize × pods` items lost. Fix: drain-then-flush with deadline, using a separate context for the drain that survives the parent cancel.

**Follow-up.** *Why "50%" specifically?* — Probably not exactly 50%; the question is hypothetical. Realistic loss rates are 0.1-1%. If a deploy causes 50% throughput drop, that's a different issue — maybe the new deploy itself is slower; investigate before blaming batching.

---

### Q20. Argue: should every pipeline use batching?

**Model answer.** No. Batching helps when (1) the sink has meaningful per-call overhead, (2) you can tolerate latency on the order of `maxWait`, and (3) the throughput requires it. For low-volume pipelines or strict per-item-latency requirements, batching adds complexity without benefit. Profile first; batch second.

---

## Distinguishing-Level Probes

For each major question, follow-up probes that distinguish levels:

- **Junior:** "Show me the canonical pattern."
- **Mid:** "How would you test it?"
- **Senior:** "Defend sync vs async with measurement."
- **Staff:** "Capacity-plan for 10× the load."
- **Principal:** "When is batching the wrong abstraction, and what would you use instead?"

---

## Tips for the Interviewee

1. State the triple trigger early and explicitly.
2. Mention the final flush bug; it's the most common.
3. Default to sync flush; justify async with measurement.
4. Bound everything: `maxSize`, `Inflight`, output channel cap.
5. Tag flush reasons for observability.
6. Validate config at startup.
7. Test for the final flush case.
8. Mention `sync.Pool` only when GC is the bottleneck.
9. Use Little's law for memory estimates.
10. Acknowledge what batching cannot solve.

---

## Tips for the Interviewer

1. Start with the canonical pattern — does the candidate have it cold?
2. Probe for the four classic bugs — do they recognise the patterns?
3. Ask for an SLO-driven trade-off — do they reason quantitatively?
4. Pose a scenario at scale — do they think about fleets, regions, and operations?
5. Listen for "I would measure" — that is a senior+ signal.

---

## Closing

Batching is a deceptively simple topic that surfaces a wide swath of Go concurrency, distributed systems, and operations skills. A senior+ interview can productively spend 45 minutes on it. A junior interview can spend 15.

Calibrate by depth, not by topic.

---

## Additional Junior Questions

### Q21. Why is `sync.WaitGroup.Add` outside the goroutine?

**Model answer.** If `Add` is inside the goroutine, the parent's `Wait` may run before any `Add` happens, returning immediately without waiting. Always `Add` in the parent before `go`.

---

### Q22. What's the difference between `time.Ticker` and `time.Timer`?

**Model answer.** Timer fires once at `d`; must be `Reset` to re-arm. Ticker fires every `d` automatically until `Stop()`. For the time trigger in batching, prefer Timer because it does not fire on empty buffers.

---

### Q23. Why use a buffered output channel?

**Model answer.** To overlap accumulate and consume. With unbuffered, the accumulator blocks on every send waiting for the consumer. A small buffer (1–8) lets one batch be in flight while the next is being accumulated.

---

### Q24. What happens if the consumer panics?

**Model answer.** The consumer goroutine dies. The accumulator's send blocks forever (assuming no `ctx.Done()` cancel). Bug. Fix: `defer recover()` in the consumer and either restart or signal the pipeline to shut down.

---

### Q25. Why is `out <- batch` wrapped in a select?

**Model answer.** To allow cancellation to interrupt the send. Without it, a stuck consumer plus a cancellation leaves the accumulator deadlocked. With the select, the cancel branch wins immediately and the send is skipped.

---

## Additional Middle Questions

### Q26. How does back-pressure propagate through a batching stage?

**Model answer.** Sink slow → consumer reads slowly → `out` buffer fills → accumulator blocks on send → `in` buffer fills (or accumulator can't accept new items) → producer blocks → producer's source slows. The chain self-regulates.

---

### Q27. Difference between sync flush and bounded async flush?

**Model answer.** Sync: accumulator does the I/O itself. Throughput = `1/sink_latency × batch_size`. Bounded async: accumulator dispatches to a worker pool of size N. Throughput = `N × 1/sink_latency × batch_size`. Both preserve back-pressure (sync trivially, bounded via job channel).

---

### Q28. What is a flush hook used for?

**Model answer.** Observability. The hook is called on every flush with the reason and batch. Used for metrics (count flushes by reason), test assertions (expect specific reason sequences), and trace span attribution.

---

### Q29. How do you make a per-key batcher exit when a key goes idle?

**Model answer.** Add an idle timer per key. If no items for `idleTTL`, flush the buffer and exit the per-key goroutine (or remove the key from the map). On next item for that key, lazily restart.

---

### Q30. Why "stop and drain" the timer?

**Model answer.** Because `time.Timer.Stop` returns `false` if the timer has already fired but the value hasn't been received. The pending value sits on `C`. Resetting without draining causes the next `<-C` to immediately fire the stale value. The pattern stops, then drains if needed:

```go
if !t.Stop() {
    select { case <-t.C: default: }
}
```

---

## Additional Senior Questions

### Q31. How would you implement bounded async flush?

**Model answer.** Spawn N worker goroutines reading from a `jobs chan []T` of capacity N. The accumulator dispatches via `jobs <- batch`. When in-flight is full, the send blocks → back-pressure. On exit, `close(jobs)` and `wg.Wait()` for workers.

---

### Q32. How do you preserve ordering with multiple workers?

**Model answer.** Pipelined ordered flushers. Dispatcher gives each batch a sequence number and sends to both the work queue (workers) and an order queue (committer). Workers process in any order; each signals completion via a per-batch `done` channel. Committer drains the order queue in sequence, waiting on each `done`. Order preserved at commit.

---

### Q33. What partial-failure strategies exist?

**Model answer.** (1) Whole-batch retry with backoff for transient errors. (2) Split-on-fail bisection for isolating poison-pill items. (3) Per-item ack from the sink (e.g. DynamoDB). (4) Dead-letter queue for permanently failed items.

---

### Q34. When does `sync.Pool` not help?

**Model answer.** Under low traffic, pool empties between requests (GC releases entries); no benefit. Also when payload is small enough that allocation cost is negligible. Profile before adding.

---

### Q35. Memory math for a 1M items/s pipeline.

**Model answer.** Apply Little's law. Buffer per stage: `λ × maxWait`. For `λ = 1M/s`, `maxWait = 50ms`: 50K items. At 256B each: 12.8 MB. Per pod, after sharding to 50 pods: 256 KB. Manageable.

---

## Additional Staff Questions

### Q36. When is M/D/1 a better model than M/M/1?

**Model answer.** When service times are deterministic (e.g. batched sink calls with predictable latency). M/D/1 has half the queueing delay of M/M/1 at the same utilisation. M/M/1 assumes exponentially distributed service times, which is rarely true for batched I/O.

---

### Q37. Design an SLO-driven autonomous tuner.

**Model answer.** A controller goroutine reads observed latency every `controlPeriod`. If observed > target, shrink `maxSize` by 10%. If observed < 0.8 × target, grow `maxSize` by 10%. Clamp to `[minSize, hardMaxSize]`. Use EMA smoothing on observations to avoid noise-driven oscillation. Document the controller; provide manual override.

---

### Q38. How does jitter prevent thundering herds?

**Model answer.** Without jitter, fleet pods' timers align to wall-clock boundaries (e.g. every second). All pods flush simultaneously; sink CPU spikes. With jitter, each pod's `maxWait` is randomised by ±10%, spreading flushes across `maxWait/10` window. Smooths the load.

---

### Q39. Compare multi-tier batching to single-tier with larger `maxSize`.

**Model answer.** Multi-tier amortises different costs at different scales — e.g. L1 amortises encoding (small batches, fast); L2 amortises network upload (large batches, slow). Single-tier with larger `maxSize` doesn't work because the L2-stage costs would be paid per item at L1 size.

Use multi-tier when costs amortise at distinct scales. Single-tier when one cost dominates.

---

### Q40. Diagnose: heap grows 200 MB/hour with stable input rate.

**Model answer.** Likely a goroutine leak (consumer panicked and was not restarted) or a `sync.Pool` contract violation (objects gotten but not put back). `inuse_space` profile identifies. Goroutine count over time reveals leak.

---

## Additional Principal Questions

### Q41. When is batching the wrong abstraction?

**Model answer.** When (1) latency budget is sub-`maxWait`, (2) sink is already batched, (3) items must be individually acknowledged with sub-ms latency, (4) per-item failure isolation is mandatory (e.g. payment processing), or (5) throughput is so low that batching adds overhead with no gain.

---

### Q42. How would you architect a 10M items/s pipeline?

**Model answer.** Sharded ingest (hash-by-key to N shards). Each shard has its own batching stage + sink connection. Per-shard capacity: 100K-1M/s depending on sink. Shard count: 10-100. Cross-shard concerns: durability via WAL or replicated source; observability via aggregated metrics.

---

### Q43. Cost analysis of batching for a 100M-event-per-day pipeline.

**Model answer.** Per-event sink cost: $0.0001/call × 100M = $10K/day. Batched by 100: $100/day. Saves $9900/day, $3.6M/year. Justifies a week of engineering.

---

### Q44. What is the relationship between batching and exactly-once semantics?

**Model answer.** Batching provides at-least-once with idempotent sinks. Exactly-once requires (1) transactional sinks or (2) two-phase commit. Batching alone does not give exactly-once. Use idempotency keys per item to dedup at the sink.

---

### Q45. How would you migrate a one-at-a-time pipeline to batched?

**Model answer.** (1) Profile baseline. (2) Insert a channel and a `Batch` stage between current code and sink. (3) Sink call becomes `BulkInsert` or equivalent. (4) Add metrics. (5) Roll out behind a feature flag with gradual percentage. (6) Tune `maxSize`/`maxWait`. (7) Decommission the old path.

---

## Tricky Interview Scenarios

### Scenario S1 — "We're losing 0.5% of events on every deploy"

The diagnostic walk: data loss on shutdown → cancel-case flush is best-effort → fix with drain-then-flush + separate deadline context.

### Scenario S2 — "Sink CPU spikes every second across the fleet"

The diagnostic walk: synchronised flushes → no jitter → add jitter.

### Scenario S3 — "DLQ filling at 100 batches/hour"

The diagnostic walk: sample a DLQ batch → identify error → either poison-pill (need split-on-fail) or systemic (need to fix sink or increase retries).

### Scenario S4 — "Memory grows by 200 MB/hour"

The diagnostic walk: pprof inuse_space → top allocator → consumer leak vs Pool contract violation vs per-key map growth → fix.

### Scenario S5 — "p99 latency spike every few minutes"

The diagnostic walk: GC pauses → check `GODEBUG=gctrace=1` → if confirmed, add `sync.Pool` for batch slices.

---

## Brain-Teasers (Quick)

1. Two-line bug that loses 0.5% of data — what is it?
   *Answer:* No final flush.

2. Why never use `time.After` in a loop?
   *Answer:* Allocates a new timer per iteration; leaks.

3. Why never use `time.Tick`?
   *Answer:* Cannot be stopped; leaks forever.

4. What's the typical p99 latency cap from batching alone?
   *Answer:* About `maxWait + sink_p99`.

5. How does bounded async preserve back-pressure?
   *Answer:* Bounded job channel blocks the accumulator when full.

6. What's the empty-buffer guard?
   *Answer:* Early return in `flush` when `len(buf) == 0`.

7. Why copy on send?
   *Answer:* To detach from the buffer's underlying array.

8. What's `defer close(out)` for?
   *Answer:* Single-place close on all exit paths.

9. What does `<-ctx.Done()` after cancel return?
   *Answer:* Immediately ready every time (channel is closed).

10. What is Little's law?
    *Answer:* `L = λW`.

---

## Final Note

The questions above cover ~80% of what production batching interviews ask. The remaining 20% is candidate-specific (their background, the company's stack, the specific role).

Use this as a calibration tool, not a checklist.

---

## Reflection Section — How to Conduct a Batching Interview

For interviewers who use this material.

### Open with a warmup

Ask "what is a batching stage?" — gauge familiarity. Junior answers in vague terms; senior cites size/time triggers.

### Probe correctness

Show buggy code; ask candidate to identify issues. Junior finds one; senior finds three or four; staff explains the consequence of each.

### Move to design

"Design a stage for X." Listen for trade-off articulation. Senior+ should mention sync vs async with reasoning.

### Push to scale

"Now 10× the load." Listen for capacity math, fleet considerations, jitter.

### Test depth

"What's the worst-case memory?" "How does back-pressure flow?" "What ordering do you guarantee?"

### Close with operations

"What metrics?" "What alerts?" "How do you debug at 3 AM?" Staff+ thinks operationally.

### Calibrate

Match candidate's answers to level. Don't penalise a junior for not knowing pipelined ordered flushers; don't pass a senior who doesn't know about jitter.

---

## Anti-Patterns in Interviews

Both interviewees and interviewers make these mistakes. Avoid.

### Interviewee anti-patterns

- Reciting buzzwords without explaining ("we use bounded async with sync.Pool and adaptive sizing").
- Defaulting to async without justification.
- Skipping the final-flush case.
- Ignoring cancellation.
- Not asking clarifying questions.

### Interviewer anti-patterns

- Asking trivia ("what does `runtime.Gosched()` do?").
- Looking for one specific answer rather than reasoning.
- Not probing for trade-offs.
- Not testing operations awareness.
- Not differentiating levels.

---

## A Few Closing Questions

Some final questions for full coverage.

### Q46. What is the relationship between batching and the Go memory model?

**Model answer.** Channel send/receive synchronises-with: when the accumulator copies into `batch` and sends `batch` on `out`, the consumer sees the writes via the receive. This is why "copy on send" is memory-safe; you'd have a data race without the copy or with shared mutable state.

---

### Q47. How do you handle batches that exceed the sink's max size?

**Model answer.** Set your `maxSize` to the sink's max. If you somehow exceed (e.g. due to a config bug), the sink rejects; you must split client-side. Best practice: validate `maxSize <= sink_max` at startup.

---

### Q48. When would you NOT add jitter?

**Model answer.** Single-instance pipelines (no fleet effect). Very long `maxWait` (>1 minute). Pipelines where every flush is critical and predictable timing is required.

---

### Q49. What's the relationship between batching and event-time processing?

**Model answer.** Batching is processing-time. Event-time processing (stream processing) requires watermarks. They can coexist: batch by processing-time within an event-time window; watermark tracks event-time progress.

---

### Q50. How do you decide between in-process batching (this folder) and external batching (Kafka, NATS)?

**Model answer.** In-process is simpler, lower latency, fewer dependencies — good for moderate scale. External (Kafka) gives durability, decoupling, replay, fan-out — good for high scale or multi-team systems. Often used together: in-process batching feeds a Kafka producer; consumer side has its own in-process batching.

---

## Final Brain Teasers

Five more, snappier:

1. *Why is the timer Reset bug subtle?* — Stop returns false on already-fired; the value remains; Reset without drain doubles the fire.

2. *Why does adaptive sizing oscillate?* — Without hysteresis, the controller flips between grow and shrink each cycle.

3. *Why is `time.After` worse than `time.NewTimer`?* — Time.After is one-shot, leaks, cannot be stopped.

4. *Why does the sink prefer a specific batch size?* — Connection setup, parsing, validation, index updates — all amortise differently. Sink's optimum is where the slope of latency-vs-size matches the marginal-benefit curve.

5. *Why does pipelined ordered flushers help?* — Decouples write parallelism from commit ordering. Writes go in parallel; commits serialise.

---

## End of Interview Material

This file should serve as a comprehensive Q&A resource for batching topics at all levels. Combine with the tier files (junior, middle, senior, professional) for full understanding. The patterns themselves are in those files; this file tests retention and application.
