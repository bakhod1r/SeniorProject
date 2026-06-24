# Kafka Throughput & Exactly-Once Lab

> Push a single Kafka cluster to its throughput ceiling, then make it *correct*
> under that load. Find the point where partitions, acks, batching, and
> rebalancing stop being free — and pay for exactly-once with measured latency.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Event streaming / distributed systems |
| **Skills exercised** | Kafka internals, partitioning, consumer groups, idempotent & transactional producers, EOS, backpressure, Go (`franz-go` / `segmentio/kafka-go`) |
| **Interview sections** | 11 (messaging), 13 (distributed systems), 17 (performance) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You're the engineer who owns the "events" pipeline at a company doing ~2B events
per day. Product wants a new consumer that updates a billing counter — and
finance is clear: **no event may be counted twice, and none may be lost.** The
existing pipeline runs at-least-once and nobody can tell you its real throughput
ceiling or what happens during a deploy (consumer rebalance).

Your job in this lab is to *characterize* a Kafka cluster under high load and
then *deliver exactly-once* counting without quietly destroying throughput. You
will produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Find the sustained throughput ceiling (events/s and MB/s) of a 3-broker cluster
  for a defined message size, and explain what bounds it.
- Quantify the cost of durability knobs: `acks`, `linger.ms`, `batch.size`,
  compression, partition count.
- Implement an **exactly-once** consumer (count events into a store) that holds
  its invariant across consumer restarts, rebalances, and broker failure.
- Measure and explain consumer-group rebalance behavior under load.

**Non-goals**
- Running a managed Kafka (MSK/Confluent). Run it yourself so you see the knobs.
- Cross-datacenter replication / MirrorMaker (that's the multi-region staff lab).
- Schema registry / Avro ergonomics — use a fixed binary payload.

## 3. Functional requirements

1. A **producer** (`cmd/producer`) emits events to topic `events` with a
   configurable rate, message size, partition count, and durability profile.
2. A **counter consumer** (`cmd/counter`) consumes `events` and maintains, per
   `account_id`, an exact running total in a store (Postgres or Redis), then
   exposes the total via a read API.
3. The system supports two correctness modes, switchable by flag:
   - `at-least-once` (baseline) — manual offset commits after processing.
   - `exactly-once` — either Kafka transactions (consume-process-produce) **or**
     idempotent application writes keyed by `(partition, offset)`. State which
     you chose and why.
4. A **chaos hook** (`cmd/chaos`) can kill a broker, kill a consumer, and trigger
   a rolling consumer restart mid-load.

## 4. Load & data profile

- **Volume:** generate and replay **≥ 1 billion events** total across runs;
  single sustained run ≥ 30 minutes at target rate.
- **Message size:** test at least two — 256 B (counter events) and 4 KB (fat
  payload). Report both.
- **Key distribution:** `account_id` is **Zipfian** (s≈1.1) over 10M accounts, so
  some partitions get hot keys. This is deliberate — it exposes partition skew.
- **Generator:** `cmd/gen` (or a producer flag) is deterministic given a seed.
- **Traffic model:** open-model producer (fixed send rate, not "as fast as the
  consumer drains") so you can observe lag building.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained producer throughput (256 B, acks=all, 3 brokers) | Find & report the ceiling; justify it (CPU? network? fsync? partitions?) |
| Counter consumer end-to-end p99 (produce→counted) | < 2 s at 80% of throughput ceiling |
| Consumer lag at steady state (rate below ceiling) | Bounded and flat (not monotonically rising) |
| Exactly-once invariant | **Exact** count after chaos: `counted == produced`, zero double-counts |
| Rebalance stop-the-world during rolling restart | Measured; report consumer pause duration |

> The point of the lab is not to hit a magic number — it's to **find** your
> cluster's number and **explain** it.

## 6. Architecture constraints & guidance

- 3 Kafka brokers + required coordinator via `docker-compose` (KRaft mode, no
  ZooKeeper). Pin the version.
- Go client: `twmb/franz-go` recommended (exposes transactions and good batching
  control); `segmentio/kafka-go` acceptable.
- Keep producer and consumer as separate binaries so you can scale and kill them
  independently.
- Instrument everything with Prometheus: produce rate, consume rate, lag (from
  `kafka_consumergroup_lag`), p50/p99/p999 end-to-end, in-flight batches.

## 7. Data model

```
event:   { account_id uint64, amount int64, ts int64, seq uint64, pad []byte }
counter store (exactly-once via dedup):
  counts(account_id PK, total BIGINT)
  processed(partition INT, "offset" BIGINT, PRIMARY KEY(partition, offset))   -- idempotency ledger
```
For the Kafka-transactions variant, the offset commit and the count update join
the same transaction; for the application-idempotency variant, the
`processed` table is the dedup guard inside one DB transaction.

## 8. Interface contract

- `GET /count/{account_id}` → `{ "account_id": N, "total": M, "as_of_offset": ... }`
- `GET /metrics` → Prometheus exposition.
- Producer/consumer configured via flags/env: `-rate`, `-msg-size`,
  `-partitions`, `-acks`, `-linger`, `-batch`, `-compression`, `-mode`.

## 9. Key technical challenges

- **Finding the real ceiling.** Throughput is bounded by different things at
  different settings — page cache + fsync at `acks=all`, NIC at large batches,
  partition count for parallelism. You must isolate which.
- **Partition skew from hot keys.** Zipfian `account_id` means one partition's
  consumer becomes the straggler. Do you accept it, re-key, or add partitions?
- **Exactly-once without killing throughput.** Transactions add coordinator
  round-trips and reduce batching efficiency. Quantify the tax.
- **Rebalance storms.** Naive `range`/`round-robin` assignors stop *all*
  consumers on every membership change. Cooperative-sticky rebalancing changes
  the picture — measure it.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **acks sweep:** `acks=0,1,all` × `linger.ms=0,5,50`. Plot throughput vs p99.
   Where's the knee?
2. **Partition sweep:** 1 → 6 → 24 → 96 partitions at fixed rate. Find where
   adding partitions stops helping (and where it starts hurting).
3. **Compression:** none vs lz4 vs zstd on the 4 KB payload. Throughput, CPU, and
   broker disk.
4. **Hot-key skew:** measure per-partition lag with Zipfian keys; then re-key by
   hashing `account_id` differently and re-measure.
5. **EOS tax:** at-least-once vs exactly-once at the same input rate — Δ
   throughput and Δ p99.
6. **Chaos / correctness:** during a 30-min run, kill a broker and do a rolling
   consumer restart. Prove `counted == produced` afterward. Report consumer
   pause time during rebalance, and lag recovery time.
7. **Rebalance strategy:** `range` vs `cooperative-sticky`. Measure stop-the-world
   duration of a single consumer restart under load.

## 11. Milestones

1. Compose cluster up; producer + at-least-once counter; Prometheus + a Grafana
   board for rate/lag/latency.
2. `cmd/gen` Zipfian data; first throughput-ceiling run; write down the bound.
3. Durability sweeps (experiments 1–3); knee curves.
4. Exactly-once consumer; chaos run proving the invariant (experiments 5–6).
5. Rebalance + skew investigation (experiments 4, 7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 30-min run at a stated rate with **flat** lag, dashboard
      screenshot attached.
- [ ] Throughput-ceiling number reported **with the bottleneck named and proven**
      (e.g. pprof/`iostat`/NIC saturation evidence).
- [ ] acks × linger and partition-count curves plotted.
- [ ] Exactly-once: after killing a broker **and** a rolling consumer restart
      mid-load, `counted == produced` exactly (show the SQL/diff).
- [ ] Findings note quantifying the EOS throughput/latency tax.
- [ ] Every number is reproducible from a committed command + config.

## 13. Stretch goals

- Tiered storage / log compaction experiment on a compacted topic.
- Consumer-side **batched** DB writes and measure the idempotency-ledger cost.
- Replace the dedup table with a Bloom filter + periodic compaction; measure
  memory vs correctness window.
- Multi-consumer-group fan-out: add a second independent consumer and show
  zero impact on the counter group.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Throughput analysis | Reports a ceiling number | Names and **proves** the bottleneck; knows the next one |
| Durability trade-offs | Shows acks/linger affects latency | Quantifies the knee; recommends a setting for a given SLO |
| Exactly-once | Invariant holds in the happy path | Invariant holds through broker loss + rebalance; explains *why* the design is correct |
| Skew handling | Notices partition skew | Mitigates it and measures the result |
| Rebalancing | Knows rebalances pause consumers | Measures it; chooses cooperative-sticky with evidence |
| Communication | Clear findings note | Could defend every curve to a staff panel |

## 15. References

- Kafka docs: producer/consumer configs, transactions, KRaft.
- *Designing Data-Intensive Applications* — Ch. 11 (stream processing).
- `twmb/franz-go` transactions example.
- Confluent: "Exactly Once Semantics" and "Incremental Cooperative Rebalancing".
- See also: `Interview Question/11-messaging-and-event-streaming/`.
