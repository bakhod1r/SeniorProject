# Pipeline — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Case Study: ETL](#production-case-study-etl)
3. [Production Case Study: Log Enrichment](#production-case-study-log-enrichment)
4. [Production Case Study: Image Processing Pipeline](#production-case-study-image-processing-pipeline)
5. [Production Case Study: Streaming Aggregation](#production-case-study-streaming-aggregation)
6. [Pipeline Lifecycle](#pipeline-lifecycle)
7. [Operability](#operability)
8. [Buffer Sizing in Production](#buffer-sizing-in-production)
9. [Per-Stage Restart Policies](#per-stage-restart-policies)
10. [Migration Stories](#migration-stories)
11. [Compared to Other Stream Engines](#compared-to-other-stream-engines)
12. [Cost Modelling](#cost-modelling)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

Production pipelines run for days, scale to millions of items per minute, and must survive partial failures without losing data. This file covers the operational engineering of pipelines through real case studies. The middle-level skeleton is unchanged; the rigour around it is the work.

---

## Production Case Study: ETL

A nightly ETL job extracts 50M rows from a transactional Postgres DB, transforms them (denormalisation, currency conversion, derived fields), and loads them into a ClickHouse warehouse for analytics.

```
[paginator] ──▶ extract (chunk=1000)
              ──▶ transform (n=8 workers, fan-out fan-in)
              ──▶ batch (1000 rows or 5s)
              ──▶ load (n=4 workers, INSERT ... VALUES)
```

Engineering decisions:

- **Stage isolation**: each stage has its own ctx derived from the parent, allowing fine-grained cancellation.
- **Batch stage**: accumulates rows from upstream and emits batches. Two flushes: size (1000) and time (5s).
- **Fail-fast or fail-soft**: parameter at job start. Most nightly jobs use fail-soft (errors logged, stats reported, partial completion accepted). On-demand backfills use fail-fast.
- **Resumability**: a checkpoint table records last-completed page. On restart, paginator skips ahead.

Failure modes:

- ClickHouse paused for maintenance during the job. Load workers backed up; batch buffer filled; transform stage backed up. Memory grew to 2 GB. Job timed out and rolled back. Mitigation: explicit memory budget; circuit breaker on load failures.
- A new schema version produced a column that the transform did not understand. Errors flooded the result struct. Fail-soft mode logged and continued. Operators caught it via metrics.

Result: 50M rows in ~45 minutes, peak memory ~1.2 GB, peak ingest rate 18K rows/sec.

---

## Production Case Study: Log Enrichment

A central logging service ingests 200K events/sec and enriches them with user/account metadata before indexing in Elasticsearch.

```
[Kafka consumers] ──▶ decode (n=4)
                    ──▶ partition by user_id (16 sub-pipelines)
                    ──▶ enrich (n=4 per sub-pipeline, per-user lookups cached)
                    ──▶ merge ──▶ batch ──▶ ES index
```

Engineering decisions:

- **Partitioning**: user-level events go to the same sub-pipeline so a per-user cache is hit-friendly.
- **Caching**: each sub-pipeline has a 10K-entry LRU of user metadata. ~95% hit rate.
- **Backpressure to Kafka**: Kafka client commits offsets only after successful indexing. Slow ES → slow consume → no data loss.
- **Failure budget**: enrichment can return "unknown" if the metadata service is unavailable. Logs still flow.

Failure modes:

- Metadata service rebooted during peak. Cache miss rate spiked to 50%. Enrichment slowed; consumer lag grew to 10 minutes. Mitigation: stale-cache fallback (return last-known data + flag) and degraded-mode alerts.
- One Kafka partition had a 1 KB key with a Unicode bug. Decoder panicked. Worker died, supervisor restarted, partition stuck. Fix: panic recovery + bad-record dead-letter queue.

---

## Production Case Study: Image Processing Pipeline

E-commerce site processes user-uploaded product images: resize to 5 sizes, watermark, encode to WebP and JPEG, upload to CDN.

```
[upload event] ──▶ download from S3
                ──▶ decode (CPU-bound, 4 workers)
                ──▶ split → 5 size variants (fan-out per image)
                ──▶ resize+watermark+encode (16 workers)
                ──▶ upload to CDN (32 workers)
                ──▶ DB record updated
```

Engineering decisions:

- **Per-stage worker counts**: tuned to bottleneck. CPU-bound stages = NumCPU; IO-bound = much higher.
- **`sync.Pool` for image buffers**: huge memory savings (decoded images are 100 MB).
- **Cancel on user delete**: if the user deletes the image during processing, ctx cancels and cleanup runs.
- **Idempotent uploads**: object keys are `(image_id, size, timestamp)`; duplicate uploads are harmless.

Memory budget: 4 decode workers × 100 MB + 16 resize workers × 30 MB = 880 MB. Tight but stable.

---

## Production Case Study: Streaming Aggregation

A real-time analytics service computes per-minute traffic counts per region from a click-stream.

```
[Kafka click events] ──▶ decode (8)
                       ──▶ group by region (per-region channel)
                       ──▶ window aggregator (per-region goroutine)
                       ──▶ emit per-minute snapshot
                       ──▶ Prometheus exposition
```

Engineering decisions:

- **Per-region goroutines**: a fan-out by key, not by worker count.
- **Tumbling windows**: 1-minute boundaries. The aggregator emits a snapshot at each boundary.
- **Late events**: events arriving more than 5 minutes late are counted in a "late" bucket and a metric is emitted.
- **No persistence**: counts are reset on restart. Acceptable per product.

Failure modes:

- Clock skew between producers caused early events to land in the wrong window. Mitigation: server-side timestamping at ingest.
- A region with 1000x traffic of others overwhelmed its goroutine. The per-region channel buffer (1024) filled. Mitigation: rate-limit per region; spill to disk if over budget.

---

## Pipeline Lifecycle

Production pipelines go through phases:

1. **Boot**: each stage starts; ctx is the parent process ctx.
2. **Steady state**: items flow; stage outputs match inputs.
3. **Drain**: input source closes; stages drain and exit in order.
4. **Cancel**: ctx cancelled; stages exit ASAP; in-flight items are dropped or saved.
5. **Crash**: a stage panics; supervisor restarts or process crashes.

Each phase has a runbook. Operators must know how to drain a pipeline gracefully (often: stop the producer, wait for the consumer to drain, exit) and what happens if they `kill -9` (in-flight items lost; data integrity depends on idempotency).

---

## Operability

A production pipeline emits per-stage metrics:

```
pipeline_stage_in_pending{stage="parse"}        25
pipeline_stage_in_pending{stage="enrich"}       1024  ← bottleneck!
pipeline_stage_in_pending{stage="store"}        12
pipeline_stage_processed_total{stage="enrich"}  142098
pipeline_stage_errors_total{stage="enrich"}     17
pipeline_stage_duration_seconds{stage="enrich"} histogram
```

A dashboard with these stacked makes the bottleneck obvious. Without them, "the pipeline is slow" is unactionable.

Logging: structural events only. Stage start, stage stop, stage panic, batch boundaries, error class summaries. Per-item logging is too expensive at scale.

Tracing: each item carries a trace ID through the pipeline. OpenTelemetry spans across stages give per-item timing.

---

## Buffer Sizing in Production

A senior or middle-level rule "default unbuffered" works for most stages, but production pipelines frequently use small per-stage buffers. Why:

- **Smoothing jitter**: slight per-item variability of any stage reduces effective throughput when buffers are zero (adjacent stages stall on each other). A buffer of 8-16 hides jitter.
- **Memory budget**: total in-flight items = sum of buffers + worker count per stage. Budget the whole pipeline.

Rule of thumb: buffer = max(2x P99 / median, 4). Sized once, monitored, retuned when load changes.

---

## Per-Stage Restart Policies

A stage that panics should not crash the whole process if the failure is recoverable. Pattern:

```go
func runStage(ctx context.Context, in <-chan In, out chan<- Out) {
    for {
        err := safeRun(ctx, in, out)
        if err == nil || ctx.Err() != nil {
            return
        }
        log.Errorw("stage panic, restarting", "err", err)
        time.Sleep(restartBackoff())
    }
}

func safeRun(ctx context.Context, in <-chan In, out chan<- Out) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return processStage(ctx, in, out)
}
```

Trade-off: silently masking bugs versus availability. For pipelines with high uptime requirements (logging, metrics), restart wins. For correctness-critical jobs (financial reconciliation), crash-and-investigate wins.

---

## Migration Stories

A common migration: synchronous batch job → streaming pipeline.

1. Identify pipeline stages from the existing job's structure (often sub-functions).
2. Refactor each into `func(ctx, <-chan In) <-chan Out`.
3. Compose them.
4. Run in parallel with the old job, compare outputs.
5. Cut over.

Pitfalls:

- Old code may have implicit ordering assumptions; new pipeline may shuffle items. Check tests.
- Old code may share global state across stages; new pipeline must thread state through values or stage-local maps.
- Old code may handle errors at the top level; new pipeline must surface them per stage.

---

## Compared to Other Stream Engines

For very large or complex stream processing, dedicated engines (Apache Flink, Kafka Streams, Apache Beam) offer:

- Stateful operators with checkpointing.
- Exactly-once semantics.
- Distributed execution.
- Built-in windowing primitives.

Go pipelines are simpler and lower-level. They are appropriate when:

- Throughput fits on one machine (or a small horizontal fleet).
- Operators are stateless or have small in-memory state.
- The team prefers code over DSL.

For multi-machine, exactly-once stream processing, choose Flink. For per-service local pipelines (logs, ETL, batch jobs), Go is excellent.

---

## Cost Modelling

A pipeline's cost:

- Goroutine memory: K stages × N workers × 8 KB ≈ a few MB total typically.
- Channel buffer memory: K stages × buffer size × item size.
- Per-item CPU: K × ~150 ns (channel ops) + sum of per-stage transform cost.

For 1M items/min through 5 stages with no parallelism:
- CPU: 1M × 5 × 150 ns = 750 ms/min = ~1% of one core on plumbing.
- Memory: 5 × 16 buffer × 1 KB item = 80 KB.
- Plumbing is negligible.

For 1M items/sec, plumbing is 75% of one core. At this rate, batching becomes attractive.

---

## Cheat Sheet

| Production decision | Default |
|---------------------|---------|
| Stage signature | `func(ctx, <-chan In) <-chan Out` |
| Error policy | errgroup (fail-fast) or Result struct (fail-soft) |
| Buffer per stage | 8-16 |
| Bottleneck parallelism | fan-out + fan-in |
| Per-stage restart | recover + backoff |
| Metrics per stage | pending, processed, errors, duration |
| Lifecycle | producer closes input → drain → exit |

---

## Summary

Production pipelines run for hours, expose metrics, restart panicked stages, and tune buffers to memory budgets. The middle-level skeleton (ctx + stage signature + two-select sandwich) plus senior-level design choices (parallelism placement, error strategy) plus operational discipline (restart policies, observability, runbooks) is the recipe. Real cases — ETL, log enrichment, image processing, streaming aggregation — show the same pattern with different parameters and trade-offs.
