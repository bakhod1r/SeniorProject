# Projects — High-Load & Big-Data Engineering Labs

Hands-on project briefs for **senior** and **staff** Go backend engineers.

These are not CRUD toys. Every project makes you stand up a **real** system
(Kafka, ClickHouse, Postgres, Redis, Elasticsearch…), generate **large**
datasets, drive **high load**, then measure, break, and tune it until you can
*defend the numbers*. The skill being trained is not "can you make it work" —
it's "can you make it work at scale, explain why it behaves the way it does, and
prove it with data."

Each brief is a **TZ** (техническое задание / technical specification): a
realistic problem, hard requirements, explicit SLOs, a load-and-data profile, a
set of experiments to run, and a grading rubric a staff interviewer would
recognize.

---

## How to use a project

1. **Read the whole TZ first.** Note the SLOs and the dataset scale — they drive
   every design decision.
2. **Generate data at the stated scale** before you optimize anything. Tuning
   against 1k rows teaches you nothing; the interesting behavior starts at 10M+.
3. **Build the smallest thing that meets the functional requirements**, then run
   the load harness and watch it fall over.
4. **Run the experiments.** Each TZ lists "break it / tune it" investigations.
   Record before/after numbers (throughput, p50/p99/p999, lag, CPU, allocations).
5. **Write a short findings note** per project: what you changed, what it bought
   you, and why. This is the artifact that proves staff-level depth.

You do *not* need to finish every stretch goal. You *do* need numbers you can
defend. **Depth over breadth** — one project taken to real scale with a written
findings note beats eight half-built repos.

---

## The scale matrix — build every project in 4 stages

"High load" isn't one thing. It has **two independent axes** — *data volume* and
*request rate* — and they fail in completely different ways. So every project is a
4-rung ladder. Build Stage 0 correct first (it's your control); then push each
axis on its own; then push both together. **Don't tune what isn't yet correct.**

| Stage | Data | Request rate | What it stresses |
|-------|------|--------------|------------------|
| **0 · Simple** | small | low | correctness only — the **baseline** you measure everything else against |
| **1 · Big data** | **huge** | low | storage layout, indexing, memory, compaction, query plans |
| **2 · High RPS** | small | **very high** | connection pools, locking/contention, tail latency, backpressure |
| **3 · Big data + High RPS** | **huge** | **very high** | the **interaction**: hot keys in a huge set under concurrency, cache working-set misses, tail amplification — full SLOs |

The two axes are independent: a system can ace Stage 1 and fall over at Stage 2
(or vice versa). Stage 3 is the production boss fight where they compound. A
project is only **"senior/staff done" at Stage 3** — measured and defended.

Each project instantiates the axes in its own terms (a rate limiter's "big data" =
millions of keys; a columnar store's "high RPS" = many concurrent queries). The
stages map onto the TZ sections: Functional reqs → 0; Load & data profile → 1;
load harness + SLOs → 2; Experiments + full SLOs → 3.

---

## Tiers

- **`labs/`** — Data-systems load labs. The core of this library: push a single
  technology (Kafka, ClickHouse, Postgres indexes, Redis, ES) to its limits with
  big data and learn its failure modes.
- **`senior/`** — Own one service end-to-end, with high load baked into the
  requirements. You design the data model, the API, and the scaling story.
- **`staff/`** — Cross-cutting, ambiguous, multi-system problems at scale:
  consensus, sharding, multi-region, migrations, exactly-once pipelines.

---

## Catalog

### `labs/` — Data-Systems Load Labs
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [Kafka throughput & exactly-once](labs/01-kafka-throughput-and-exactly-once/) | Partitioning, consumer lag, rebalancing, EOS | 11, 13, 17 |
| 02 | [ClickHouse OLAP at scale](labs/02-clickhouse-olap-at-scale/) | MergeTree, materialized views, projections, billions of rows | 23, 17, 14 |
| 03 | [Postgres indexing & partitioning](labs/03-postgres-indexing-and-partitioning/) | B-tree/GIN/BRIN/partial/covering, bloat, partitioning, EXPLAIN | 5, 17, 23 |
| 04 | [Redis at scale](labs/04-redis-at-scale/) | Cluster, pipelining, hot keys, eviction, persistence | 7, 22, 17 |
| 05 | [Elasticsearch at scale](labs/05-elasticsearch-at-scale/) | Sharding, bulk indexing, relevance, query latency | 8, 17, 22 |
| 06 | [Database bake-off: analytics under load](labs/06-database-bake-off-analytics/) | Postgres vs ClickHouse vs Mongo, selection | 23, 5, 6 |
| 07 | [Connection-pool & DB saturation](labs/07-connection-pool-and-saturation/) | Pool sizing, PgBouncer, N+1, lock contention | 5, 17, 22 |
| 08 | [Streaming backpressure](labs/08-streaming-backpressure/) | Lag, rebalancing storms, exactly-once delivery | 11, 13, 2 |
| 09 | [Cache stampede & invalidation](labs/09-cache-stampede-and-invalidation/) | Thundering herd, TTL jitter, single-flight, write strategies | 7, 17, 22 |

### `events/` — Event-Engineering Labs
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [CDC pipeline (Debezium)](events/01-cdc-pipeline-debezium/) | Postgres WAL → Kafka, snapshot + stream, outbox-vs-CDC | 5, 11, 13 |
| 02 | [Stateful windowing processor](events/02-stateful-windowing-processor/) | Tumbling/sliding/session windows, watermarks, late data, local state | 11, 13, 17 |
| 03 | [Event replay & reprojection](events/03-event-replay-and-reprojection/) | Rebuild read models from 1B-event log, time-travel, zero-downtime | 11, 12, 13 |
| 04 | [Schema registry & evolution](events/04-schema-registry-and-evolution/) | Avro/Protobuf compat, breaking-change detection, rolling upgrades | 10, 11, 12 |
| 05 | [DLQ & retry topology](events/05-dlq-and-retry-topology/) | Poison messages, retry topics, backoff, parking-lot, replay | 11, 13, 17 |
| 06 | [Broker bake-off](events/06-broker-bake-off/) | Kafka vs RabbitMQ vs NATS JetStream under load; selection | 11, 13, 23 |
| 07 | [Idempotent inbox/outbox (cross-service)](events/07-idempotent-inbox-outbox/) | Exactly-once over HTTP/gRPC, idempotency keys, dedup | 10, 11, 13 |
| 08 | [Consumer autoscaling on lag](events/08-consumer-autoscaling-on-lag/) | KEDA-style scaling, 10x spikes, drain time, rebalance cost | 11, 19, 22 |

### `resilience/` — Rate-Limiting & Resilience Labs
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [Rate-limit algorithm bake-off](resilience/01-rate-limit-algorithm-bake-off/) | Token/leaky bucket, sliding window log/counter, GCRA; accuracy vs memory vs burst | 7, 17, 22 |
| 02 | [Adaptive concurrency & load shedding](resilience/02-adaptive-concurrency-and-load-shedding/) | AIMD, Little's Law, concurrency-limits, shed before collapse | 13, 17, 22 |
| 03 | [Circuit breaker / bulkhead / timeout](resilience/03-circuit-breaker-bulkhead-timeout/) | Cascading-failure isolation, timeout budgets, half-open probing | 13, 22, 9 |
| 04 | [Hierarchical multi-tenant quotas](resilience/04-hierarchical-multitenant-quotas/) | Per-tenant/endpoint/global fairness, quota borrowing, noisy-neighbor isolation | 7, 22, 12 |

### `load-testing/` — How to Test High Load (the meta-skill)
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [Distributed load generator](load-testing/01-distributed-load-generator/) | Open vs closed model, coordinated omission, HdrHistogram, distributed agents | 17, 22, 9 |
| 02 | [Chaos & fault injection](load-testing/02-chaos-and-fault-injection/) | Latency/error/kill injection, steady-state hypothesis, blast radius | 13, 22, 18 |
| 03 | [Soak & leak hunting](load-testing/03-soak-and-leak-hunting/) | 24h endurance, goroutine/memory/fd leaks, pprof over time | 1, 17, 18 |
| 04 | [Capacity & breakpoint testing](load-testing/04-capacity-and-breakpoint-testing/) | Stress to breaking point, USE method, Little's Law, the knee | 17, 22, 14 |
| 05 | [Go memory & zero-allocation](load-testing/05-go-memory-and-zero-allocation/) | Escape analysis, sync.Pool, GOGC/GOMEMLIMIT, arenas/mmap, alloc reduction | 1, 17, 2 |
| 06 | [Microbenchmarking & benchstat](load-testing/06-microbenchmarking-and-benchstat/) | testing.B pitfalls, benchstat A/B significance, CI perf-regression gates | 1, 17, 15 |
| 07 | [Profiling-guided optimization](load-testing/07-profiling-guided-optimization/) | pprof CPU/heap/block/mutex, flame graphs, runtime/trace, optimize a hot path | 17, 1, 18 |

### `observability/` — Logging & Monitoring at scale
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [Centralized logging pipeline](observability/01-centralized-logging-pipeline/) | High-volume structured logging: ship→buffer→index→query, sampling, cardinality, backpressure | 18, 17, 22 |
| 02 | [Metrics, monitoring & alerting](observability/02-metrics-monitoring-and-alerting/) | Prometheus instrumentation, scrape, alerting rules, SLO/error-budget burn, alert fatigue | 18, 22, 17 |

### `distributed-patterns/` — Coordination & Distributed-Transaction Patterns
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [Leader election](distributed-patterns/01-leader-election/) | Lease-based / Raft-lease election, split-brain avoidance, fencing | 13, 2, 22 |
| 02 | [Distributed lock with fencing](distributed-patterns/02-distributed-lock-with-fencing/) | Redis/etcd locks, fencing tokens, the Redlock debate, liveness vs safety | 13, 7, 2 |
| 03 | [Scatter-gather aggregator](distributed-patterns/03-scatter-gather-aggregator/) | Fan a request to N shards/services, aggregate, straggler/timeout handling | 13, 22, 9 |
| 04 | [Claim-check](distributed-patterns/04-claim-check/) | Large payloads via a store + reference through the queue; broker-size limits | 11, 13, 20 |
| 05 | [Fan-out / fan-in pipeline](distributed-patterns/05-fan-out-fan-in-pipeline/) | Parallel fan-out then join, bounded concurrency, partial-failure handling | 2, 13, 17 |
| 06 | [2PC / 3PC coordinator](distributed-patterns/06-2pc-3pc-coordinator/) | Two/three-phase commit, coordinator-failure blocking, recovery log, why it doesn't scale | 13, 5, 15 |
| 07 | [Saga: orchestration vs choreography](distributed-patterns/07-saga-orchestration-vs-choreography/) | Build both; compare coupling, failure handling, observability, compensation | 11, 12, 13 |
| 08 | [TCC (Try-Confirm-Cancel)](distributed-patterns/08-tcc-try-confirm-cancel/) | Reservation/confirm/cancel, idempotency, timeout-driven cancellation; payment txns | 13, 11, 16 |

### `senior/` — Service builds (high-load baked in)
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [Idempotent double-entry ledger](senior/01-idempotent-ledger-service/) | Postgres txns, idempotency, exactly-once, 10k+ TPS | 5, 10, 15, 16 |
| 02 | [Distributed rate limiter](senior/02-distributed-rate-limiter/) | Redis + Lua, token bucket/sliding window, 1M+ req/s | 7, 22, 9 |
| 03 | [Durable job queue / scheduler](senior/03-durable-job-queue/) | Go concurrency, retries/backoff, DLQ | 2, 11, 15 |
| 04 | [Realtime chat & presence](senior/04-realtime-chat-presence/) | WebSockets, pub/sub, 100k+ connections, backpressure | 2, 7, 9 |
| 05 | [Content-addressed storage (S3-like)](senior/05-content-addressed-storage/) | Chunking, dedup, multipart, throughput | 5, 20, 16 |
| 06 | [Observability backend](senior/06-observability-backend/) | High-cardinality OTLP ingest, Go perf | 18, 17 |
| 07 | [Event-driven order/payment service](senior/07-event-driven-order-payment-service/) ⭐ **flagship** | Go · Postgres · Kafka · Outbox · DDD, end-to-end | 01, 05, 11, 12, 13, 15, 18 |

### `staff/` — Systems at scale
| # | Project | Trains | Interview sections |
|---|---------|--------|--------------------|
| 01 | [Sharded multi-tenant platform](staff/01-sharded-multitenant-platform/) | Sharding, routing, live resharding, isolation | 5, 13, 22, 23 |
| 02 | [Event-sourced CQRS + Saga + Outbox](staff/02-event-sourced-cqrs-saga/) | Event sourcing, projections, distributed txns | 11, 12, 13 |
| 03 | [Raft-backed metadata KV store](staff/03-raft-metadata-kv-store/) | Consensus, log replication, leader election | 13, 2 |
| 04 | [Multi-region active-active](staff/04-multi-region-active-active/) | CRDT/LWW, geo-routing, replication | 13, 22, 20 |
| 05 | [Exactly-once streaming pipeline](staff/05-exactly-once-streaming-pipeline/) | Kafka → ClickHouse, windowing, stateful processing | 11, 13, 17 |
| 06 | [Monolith → services migration](staff/06-monolith-to-services-migration/) | Strangler, dual-write, backfill, zero-downtime | 12, 13, 5 |
| 07 | [Mini message broker (Kafka-lite)](staff/07-mini-message-broker/) | Segmented append-only log, partitions, consumer groups, replication | 11, 13, 17 |
| 08 | [LSM-tree storage engine](staff/08-lsm-tree-storage-engine/) | Memtable, SSTables, compaction, WAL, Bloom filters, read/write amplification | 5, 17, 23 |

Each project tags 3–5 interview sections; the catalog collectively covers all 23.

---

## Shared tooling conventions

Every TZ assumes these, so they aren't repeated in each brief:

- **Local infra:** `docker-compose` (or `kind` for k8s labs) brings up the
  dependency. Pin versions; record them in your findings.
- **Dataset generator:** a Go program (`cmd/gen`) that produces data at the
  target scale with realistic distributions (Zipfian for hot keys, skewed
  cardinality where it matters). Deterministic via a seed so runs are
  reproducible.
- **Load harness:** [k6](https://k6.io/), [vegeta](https://github.com/tsenart/vegeta),
  or a custom Go driver. Drive a *defined* traffic profile (open vs closed model;
  state the model). Capture a full latency histogram, not just an average.
- **Measurement:** p50 / p95 / p99 / p999 latency, throughput, error rate, and
  the resource cost (CPU, memory, allocations via `pprof`, disk/network I/O).
  An average with no tail is not an answer.
- **Reproducibility:** every number in your findings note must come with the
  command and config that produced it.

## Global evaluation rubric

Each TZ has a project-specific rubric; all of them inherit this spine:

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| **Correctness under load** | Meets functional reqs at target scale | Holds invariants through failure & rebalancing |
| **Measurement rigor** | Reports p99 + throughput honestly | Explains the tail, isolates the bottleneck, proves cause |
| **Design judgment** | Reasonable architecture for the SLO | Defends trade-offs; knows when *not* to use the fancy option |
| **Failure handling** | Graceful degradation, retries, backpressure | Designs for partial failure, poison data, and recovery |
| **Tuning** | Improves a metric with evidence | Pareto-aware; quantifies cost of each gain |
| **Communication** | Clear findings note + ADRs | Could present the numbers to a staff panel and survive |

> A project is "done" when you can put its findings note in front of a staff
> engineer and defend every number on it.

See the parent [`Interview Question/`](../Interview%20Question/README.md) bank for
the matching theory.
