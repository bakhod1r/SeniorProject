# Fan-In — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Case Study: Log Aggregator](#production-case-study-log-aggregator)
3. [Production Case Study: Multi-Region Health Check](#production-case-study-multi-region-health-check)
4. [Production Case Study: Search Aggregator](#production-case-study-search-aggregator)
5. [Designing for Operability](#designing-for-operability)
6. [Stable Merge Variants](#stable-merge-variants)
7. [Hot-Reload Producers](#hot-reload-producers)
8. [Multi-Tenant Fan-In](#multi-tenant-fan-in)
9. [Backpressure Strategies under Outage](#backpressure-strategies-under-outage)
10. [Testing in CI and Staging](#testing-in-ci-and-staging)
11. [Cost Modelling](#cost-modelling)
12. [Migration Story](#migration-story)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the professional level, fan-in is part of a system. You operate it, scale it, debug it in production, and pay its costs. The merge function itself is unchanged from the senior level; what differs is the operational rigour around it. This file is a series of production case studies and the design decisions inside each.

---

## Production Case Study: Log Aggregator

A central log shipper runs on each machine. It tails N log sources (stdout, stderr, journald, file tailers, an HTTP receiver) and ships every line to a remote collector.

Architecture:

```
[stdout tailer]   ─┐
[stderr tailer]   ─┤
[journald reader] ─┼──▶ Merge ──▶ batcher ──▶ HTTP shipper ──▶ collector
[file tailer 1]   ─┤
[file tailer 2]   ─┤
[HTTP listener]   ─┘
```

Each producer goroutine emits parsed log records on its own channel. A merge fans them into one. A batcher accumulates 100 records or 200ms and POSTs them.

Engineering decisions:

- **Buffer per producer**: 1024 records. Lets short consumer hiccups not block log emission.
- **Drop-on-full**: high-volume sources (file tailers) use `select { case ch <- rec: default: counters.Drops.Inc() }`. Operators can see drops in metrics.
- **Hot-add producers**: a control plane can add a new file tailer without restart. The merge is the supervisor pattern from senior.md.
- **Order**: cross-source order is irrelevant. Within a single source, order is preserved by the producer (one goroutine per source).
- **Telemetry**: each source tagged with a label. Per-label counters expose imbalance.

Failure modes seen in production:

- A misconfigured file tailer hits a 1 MB log line and stalls. The merge keeps running because other sources continue. The tailer is restarted by the supervisor.
- The HTTP collector goes down. The batcher retries with backoff. Producer buffers fill. Drops start. Operator alerts. Recovery: collector returns; buffers drain; drop counter stops climbing.
- A new producer is added but never closes its channel on shutdown. The merge stays alive past process exit signal. Fix: every producer registers a Close hook with the supervisor.

---

## Production Case Study: Multi-Region Health Check

A health-checking service probes endpoints across regions. Each region has 50-200 probes, run by goroutines that emit results on a per-region channel. Merges produce a per-region stream and a global stream.

Architecture:

```
region eu-west: [200 probes] ─▶ Merge ─▶ regional alerter
region us-east: [180 probes] ─▶ Merge ─▶ regional alerter
region ap-south:[150 probes] ─▶ Merge ─▶ regional alerter

regional streams ──▶ Merge ──▶ global dashboard
```

Engineering decisions:

- **Layered merging**: per-region first, then a global merge. This keeps the regional fan-out manageable (≤200) and lets each region drain independently.
- **Stable region boundaries**: producers are static (one per probe). No hot-add at the region level.
- **Cancel-fast**: when the dashboard disconnects, a ctx cascades back. Probes themselves run on independent ctx because they continue emitting to the alerter even when the dashboard is down.

This case shows how layered fan-in matches the system's natural hierarchy.

---

## Production Case Study: Search Aggregator

A search query is dispatched to N backends in parallel. Each backend emits hits on its own channel. A merge feeds the UI's "live results" component.

Architecture:

```
query ──▶ dispatcher ──▶ ┌─ backend 1 ─▶ ch1 ─┐
                          ├─ backend 2 ─▶ ch2 ─┼──▶ Merge (with deadline) ──▶ UI
                          └─ backend N ─▶ chN ─┘
```

Engineering decisions:

- **Per-query merge**: created on each request, destroyed when the request completes.
- **Deadline ctx**: 200ms total. Slow backends are preempted; their results are silently dropped.
- **Order by relevance**: each hit carries a score. The merge does *not* re-sort; the UI sorts a sliding window of hits.
- **Goroutine accounting**: each merge spawns N+1 goroutines for the duration of the request. At 1000 QPS with N=8, that is 9000 goroutines steady-state — fine.

Failure modes:

- A backend becomes slow (P99 = 5s instead of 50ms). Queries time out. The slow-backend's forwarder is cancelled when ctx fires, but the *backend itself* keeps computing the response, eventually emitting a result that is discarded. Fix: pass ctx into the backend RPC so it cancels server-side.
- Per-query goroutine spawn cost: each merge does `make(chan T)` × (N+1) channels and N+1 goroutines. At 10K QPS this is 110K channel allocations/sec. Profiler confirms it is small (~0.3% of CPU); acceptable.

---

## Designing for Operability

Production fan-in must expose:

- **`pending` per input**: backlog size if the input is buffered.
- **`emitted_total` per input**: counter, label = input id.
- **`dropped_total` per input**: counter, label = input id (drop-on-full).
- **`merge_latency` histogram**: time from input send to merged emit.
- **`active_inputs` gauge**: dynamic merges only.

Without these, you cannot diagnose imbalance, slow producers, or drop storms.

Logging: log only structural events (input added, input closed). Do *not* log every value — at production rates that is a megabyte per second of log noise.

---

## Stable Merge Variants

Production code occasionally needs *partial* ordering:

- **Per-key ordering**: events for one user must be in order, but cross-user order is irrelevant. Partition by key into separate sub-pipelines, merge their outputs at the end.
- **Time-window ordering**: emit values in 1-second buckets, sorted within each bucket. Buffer 1s, sort, emit.
- **Watermark-based**: each input emits "watermark" tokens advertising its current time; the merge holds back values until all inputs have advanced past their timestamp. This is the Apache Beam / Flink approach.

Build these with care; they have non-trivial bug surfaces. For most teams, an unordered merge plus a downstream sort is good enough.

---

## Hot-Reload Producers

Production fan-ins sometimes need to add/remove producers at runtime: a new shard is provisioned, a file is rotated, a connection is replaced.

Pattern: a *manager* goroutine owns the merge and listens on a control channel.

```go
type Manager[T any] struct {
    out  chan T
    ctrl chan ctrlMsg[T]
    ctx  context.Context
}

type ctrlMsg[T any] struct {
    op  ctrlOp
    id  string
    src <-chan T
}

const (
    opAdd ctrlOp = iota
    opRemove
)
```

The manager spawns/teardowns forwarders in response to ctrl messages. Each forwarder has its own ctx that the manager cancels on remove.

This is essentially a runtime-flexible supervisor. It is non-trivial but unavoidable for long-lived merges.

---

## Multi-Tenant Fan-In

A SaaS service may run one merge per tenant, scaled to thousands of merges. Issues:

- **Goroutine count**: 1000 tenants × 10 inputs × 2 (forwarder + closer) = 20K goroutines. Manageable but watch heap.
- **Per-tenant resource limits**: cap producers per tenant to prevent one bad tenant from starving others.
- **Separation**: each tenant's merge has its own metrics labels. Aggregate with `sum by (tenant_id)`.
- **Quotas**: drop or rate-limit producers when tenant exceeds plan.

Design for the 99th-percentile tenant; the median is fine.

---

## Backpressure Strategies under Outage

When the consumer dies or slows by 10x, three options:

1. **Block (default)**: producers slow to consumer rate. Memory bounded. Latency rises.
2. **Drop oldest**: producer keeps current value, discards older buffered ones. Implement with a ring buffer per input.
3. **Drop newest**: producer skips the new value. Implement with `select { default }`.
4. **Spill to disk**: large buffers; persistent queue (e.g., go-disk-queue). Drains to memory when consumer recovers.

Choice depends on data semantics:
- Logs: drop oldest (recent lines matter more).
- Metrics: drop newest (we already saw most of the data).
- Audit events: never drop; spill to disk.

Document the choice. Operators must know what your service does under load.

---

## Testing in CI and Staging

Production-grade tests:

- **Functional CI tests**: unit tests with `-race`.
- **Load tests in staging**: 10x production rate to stress the merge.
- **Chaos tests**: kill a producer mid-stream, expect graceful continuation.
- **Goroutine leak tests**: `goleak.VerifyNone` after every test.
- **Memory tests**: `runtime.ReadMemStats` before/after a 1M-message run, assert no leak.

Failed tests should produce a complete report: stack of every live goroutine, channel capacities, last 100 emitted values.

---

## Cost Modelling

A merge has three costs:

1. **Per-value CPU**: ~150 ns/value on a single core.
2. **Per-value latency**: ~1-10 µs depending on scheduler.
3. **Per-input goroutine memory**: ~8 KB stack per forwarder, plus channel buffers.

For a service emitting 1M values/sec across 100 inputs:

- CPU: 1M × 150 ns = 150 ms CPU/sec, i.e. 15% of one core. Fine.
- Latency: P50 1µs, P99 10µs. Fine for most use cases.
- Memory: 100 forwarders × 8 KB = 800 KB stacks; 100 channels × 1 KB buffer = 100 KB. Total ~1 MB. Fine.

If you scale to 10,000 inputs at 100M values/sec, costs scale linearly. The dominant cost becomes the single output channel, which caps at ~10-20M sends/sec on one CPU. Layer the merge into a tree at this scale.

---

## Migration Story

A team migrating from a synchronous loop to a merge-based design follows this rough order:

1. Identify N producers — usually loops over a slice of resources.
2. Wrap each producer in a goroutine that emits on a channel.
3. Replace the synchronous `for _, r := range resources` loop with `merge(ctx, channels...)`.
4. Add `errgroup` if any producer can fail.
5. Add metrics on every input.
6. Add `goleak` test.
7. Roll out to canary; watch goroutine count and latency.

A common pitfall: forgetting to close channels on producer error. The fix is `defer close(out)` in every producer goroutine, regardless of how it exits.

---

## Cheat Sheet

| Production decision | Default |
|---------------------|---------|
| Merge buffer | unbuffered output, per-input buffer of 256 |
| Drop policy | drop newest for telemetry; block for everything else |
| Hot-add producers | supervisor pattern |
| Layering | tree at >1000 inputs |
| Per-input metrics | always |
| Goroutine leak test | always |

---

## Summary

Professional fan-in is operational. The merge function is small; the system around it — supervisors, metrics, drop policy, layered topology, multi-tenant safety — is large. Real production case studies show the same pattern applied with different operability rigour: log shippers, health checkers, search aggregators. Every decision (buffer size, drop policy, error semantics) is documented and observable.
