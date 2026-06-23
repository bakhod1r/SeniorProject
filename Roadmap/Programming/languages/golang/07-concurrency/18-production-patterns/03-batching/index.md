---
layout: default
title: Batching
parent: Production Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/
---

# Batching

[← Back](../)

Batching is the production-grade discipline of accumulating individual operations and flushing them as a single unit. It turns many small, expensive trips into one larger, amortised one — a database INSERT of 500 rows, a Kafka producer flush of 10 000 records, a single log shipment of an hour's worth of lines. The price is latency and the risk is partial loss on shutdown; the reward is throughput that is often one or two orders of magnitude higher than per-item processing.

Almost every high-throughput Go service in production has a batcher hidden somewhere: between the HTTP handler and the database, between the worker pool and the message broker, between the metrics SDK and the remote write endpoint, between the audit-log subsystem and S3. The patterns are similar, but the corner cases — shutdown drain, partial-flush guarantees, observability, retry semantics — are where engineering quality is decided.

This subsection covers:

- **The two triggers**: size-based (flush when the buffer reaches N items) and time-based (flush when the oldest item is older than D), and why almost every production batcher needs both.
- **The micro-batch tradeoff**: latency added per item versus throughput multiplied per call. Why a 5 ms `linger.ms` on Kafka can double throughput, and why a 50 ms one will get you paged.
- **Partial flush on shutdown**: how to drain on `SIGTERM`, what to do with items still in flight, and why a naive `close(ch)` can lose data silently.
- **Observability**: the four metrics every batcher must expose — batch size, flush latency, flush reason (size vs time vs shutdown), and queue depth.
- **Integration**: real wiring against `database/sql` (multi-row INSERT, COPY FROM), `pgx` (CopyFrom), `franz-go` and `confluent-kafka-go` (producer flush semantics), and HTTP bulk endpoints like Elastic's `_bulk`.

After reading this subsection you will be able to look at any per-item I/O call in your service and decide whether batching makes sense, choose the right trigger and size, and implement it without losing data on shutdown.

## What this subsection assumes

You should already be comfortable with goroutines, channels, `context.Context`, `select`, `time.Ticker`, and `sync.WaitGroup`. The earlier subsections of this concurrency track cover all of these. You should also have at least passing familiarity with the production-patterns sibling topics — backpressure, dynamic worker scaling, graceful shutdown, drain pattern — because real batchers compose with all of them.

## What this subsection does not cover

- Stream processing frameworks (Flink, Beam, Kafka Streams) — those are full topics in the distributed-systems track.
- Event sourcing and CQRS write-side batching — those belong to the patterns track.
- Database-internal batching (group commit, write-ahead log batching) — those are infrastructure topics.

This subsection is strictly about the application-level pattern in Go.

## Sub-pages

- [junior.md](junior.md) — What a batcher is, the two triggers (size and time), and a minimal channel-based implementation
- [middle.md](middle.md) — Production-ready batchers: graceful shutdown, partial flush, retries, and integration with `database/sql` and `franz-go`
- [senior.md](senior.md) — Architecture: micro-batch latency budgets, adaptive batch sizing, multi-tenant fairness, and backpressure interplay
- [professional.md](professional.md) — Under the hood: ring buffers, lock-free accumulators, NUMA-aware batching, and the internals of Kafka's linger/batch.size and Postgres COPY
- [specification.md](specification.md) — Formal contract of a batcher: invariants, ordering guarantees, durability semantics, and shutdown protocol
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises building progressively richer batchers
- [find-bug.md](find-bug.md) — Bug-finding exercises: lost flushes, double-flushes, races, deadlocks on close
- [optimize.md](optimize.md) — Optimisation exercises for throughput, latency, and memory under load

## Where this fits

Batching sits inside the broader **production patterns** family:

- **Backpressure** decides when to slow producers down.
- **Dynamic worker scaling** decides how many goroutines should consume in parallel.
- **Batching** decides how many items each consumer call should process at once.
- **Graceful shutdown** decides how all of the above are torn down.
- **Drain pattern** decides what to do with the in-flight queue when the process is going away.

A real service often runs all five simultaneously. A request hits an HTTP handler, the handler enqueues an event onto a bounded channel (backpressure), a pool of N workers (dynamic scaling) reads events and groups them into batches (batching), each batch is flushed to Kafka and Postgres (the batcher's job), and on `SIGTERM` the channel is closed and the remaining items are drained (graceful shutdown + drain). All of those concerns interact, and a bug in any one of them surfaces as data loss or latency spikes.

## A note on terminology

Within this subsection, "batcher" always refers to the application-level pattern: a Go component that buffers and flushes. The word is sometimes used in literature to mean batch jobs (nightly ETL), bulk APIs (multi-row INSERT itself), or batch processing frameworks (Spring Batch). We do not mean any of these.

"Batch" is the noun: a group of items that flushes together.

"Flush" is the verb: hand the buffer to the sink.

"Sink" is the destination: where flushed batches go.

These three words define the working vocabulary. The rest of the subsection assumes they are second-nature.

## Common configurations at a glance

For quick reference, typical configurations for the patterns we cover:

| Workload | MaxBatchSize | MaxBatchDelay | Notes |
|----------|-------------:|--------------:|-------|
| Audit log (Postgres) | 500 | 1 s | Multi-row INSERT or COPY |
| Audit log (Postgres COPY) | 5000 | 1 s | Much faster |
| Metrics (statsd) | 50 | 100 ms | One UDP packet |
| Clickstream (Kafka) | 10000 | 5 ms | Linger via app-level |
| Search indexing (Elastic) | 1000 | 5 s | 10 MB body limit |
| Push notifications | 100 | 5 s | Combiner per recipient |

These are starting points. The right values come from measurement on your workload.

## How to read this subsection

If you are seeing batching for the first time, read `junior.md` first; the rest assumes you have built and run a minimal batcher. If you already have one in production and are looking for production hardening, jump to `middle.md` and `senior.md`. If you want to understand what `librdkafka` and `pgx` are doing for you under the hood, `professional.md` is the deep dive. The `specification.md` file is intended as a contract you can copy into a design document. The exercise files (`tasks.md`, `find-bug.md`, `optimize.md`) are graded — start at "easy" and move down.
