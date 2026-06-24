# Message-Broker Bake-Off: Kafka vs RabbitMQ vs NATS JetStream

> Run the *same* workload against Kafka, RabbitMQ, and NATS JetStream under
> identical high load, then produce a **defensible selection matrix** — not a
> benchmark beauty contest. The deliverable is a reasoned "use X when…", backed
> by matched-durability throughput, latency tails, ordering proofs, and
> failure-mode evidence for all three.

| | |
|---|---|
| **Tier** | Lab (event-engineering) |
| **Primary domain** | Messaging-technology selection |
| **Skills exercised** | Log vs queue vs stream semantics, delivery guarantees, ordering & redelivery, consumer-group/competing-consumer/durable-consumer models, backpressure, broker-failure recovery, Go (`franz-go`, `amqp091-go`, `nats.go`) |
| **Interview sections** | 11 (messaging & event streaming), 13 (distributed systems), 23 (database/tech selection) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You're the engineer who has to pick the broker for a new platform. Three teams
are already lobbying: one runs Kafka and wants it everywhere; one has a
RabbitMQ cluster doing RPC and "it's fine"; a third just discovered NATS
JetStream and loves that it's a single 15 MB binary. The architecture review is
in two weeks and "I prefer Kafka" will not survive it.

Your job is to **characterize all three under one identical workload** and
return a selection matrix that maps *workload shape* → *recommended broker* with
reasons a staff panel will accept. The hard part is fairness: these systems do
not even agree on what a "topic", a "consumer", or "delivered" *means*. A naive
benchmark that runs Kafka at `acks=all` against RabbitMQ with transient queues
against NATS with no file storage is measuring three different durability
contracts and is worthless. You will normalize the contract first, *then*
measure — and you will produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Drive one **identical traffic profile** (same rate, same payloads, same
  consumer count) into Kafka, RabbitMQ, and NATS JetStream and report, per
  broker: throughput ceiling, end-to-end p50/p99/p999, ordering guarantee,
  delivery semantics, and durability/fsync behavior.
- **Normalize the durability contract** so comparisons are honest: persistent +
  fsync-on-quorum on all three, or document precisely why a broker cannot match.
- Characterize each broker under **adversarial conditions**: slow consumer /
  backpressure, broker failure, and redelivery — and report message loss,
  duplication, and reordering for each.
- Quantify the **operational footprint**: nodes, RAM/CPU at the matched ceiling,
  disk growth, config surface, and failure-recovery time.
- Produce a **selection matrix** (Section 10) that a reviewer could act on.

**Non-goals**
- Crowning a single "fastest" broker. Throughput at mismatched durability is a
  lie; the output is *fit*, not a leaderboard.
- Managed offerings (MSK, CloudAMQP, Synadia Cloud). Run all three yourself so
  you see the durability and replication knobs.
- Exhaustive feature tours (Kafka Streams, RabbitMQ Shovel, NATS KV/Object
  store). Stay on the produce → durable-store → consume path.
- Protocol micro-optimizations. You're selecting a broker, not writing one
  (that's `staff/07-mini-message-broker`).

## 3. Functional requirements

1. A **producer** (`cmd/producer`) emits a stream of `order` events at a
   configurable open-model rate, payload size, and partition/queue/subject
   fan-out, against a target chosen by flag: `-broker=kafka|rabbit|nats`.
2. A **consumer** (`cmd/consumer`) drains the workload through a broker-specific
   adapter and writes each message into an idempotent store (Postgres), keyed so
   that duplicates are detectable and order can be reconstructed per key.
3. A single **driver/adapter layer** (`internal/broker`) exposes one Go
   interface — `Publish(ctx, key, payload)` / `Subscribe(handler)` — with three
   implementations:
   - **Kafka** via `twmb/franz-go` — topic + partitions, consumer group, manual
     offset commits.
   - **RabbitMQ** via `rabbitmq/amqp091-go` — quorum queue, publisher confirms,
     competing consumers with manual ack.
   - **NATS JetStream** via `nats-io/nats.go` (`jetstream` package) — file-backed
     stream, durable pull consumer, explicit ack.
4. A **harness** (`cmd/bench`) runs a named scenario against one broker, captures
   the full latency histogram + throughput + per-message audit (key, seq,
   recv-order, dup-count), and emits a machine-readable result row.
5. A **chaos hook** (`cmd/chaos`) can: pause a consumer (slow-consumer), kill a
   broker node, and trigger redelivery (NACK/requeue, redeliver-on-no-ack).
6. A **report generator** (`cmd/report`) reads all result rows across the three
   brokers and renders the comparison tables + the selection matrix.

## 4. Load & data profile

- **Identical across all three brokers** — this is the whole point.
- **Target produce rate:** open model. Start at **200k msg/s** sustained; ramp
  in steps (50k → 100k → 200k → push to ceiling) so you can watch lag build.
  Fixed send rate, *not* "as fast as the consumer drains".
- **Message sizes:** test **256 B** (thin order event) and **4 KB** (fat payload
  with embedded line items). Report both separately — the crossover is real.
- **Volume:** ≥ **1 billion messages** total across all runs; each measured
  steady-state run ≥ **20 minutes** at target rate so tails and disk growth show.
- **Key distribution:** `order_id` keyed by **`customer_id`, Zipfian (s≈1.1)**
  over 5M customers, so a few keys are hot. This exposes per-partition skew in
  Kafka and head-of-line blocking in single-queue RabbitMQ.
- **Consumers:** fixed **N = 12** consumer instances per run (matched across
  brokers): a Kafka consumer group of 12 over 24 partitions; 12 competing
  RabbitMQ consumers on one quorum queue; 12 JetStream pull subscribers on one
  durable. State the mapping in every result row.
- **Generator:** `cmd/gen` is deterministic given a seed; the *same* event stream
  (same keys, same seqs) is replayed into each broker so ordering/dup audits are
  comparable.

## 5. Non-functional requirements / SLOs — measured **per broker**

This table is the heart of the lab. Fill one column per broker, at **matched
durability** (persistent, replicated, fsync-on-quorum), 256 B payload, N=12
consumers, steady state below the ceiling.

| Metric (per broker) | What you record | Target / expectation |
|---|---|---|
| **Throughput ceiling** | Max sustained msg/s and MB/s before lag rises monotonically | Find & report it; **name the bound** (fsync? replication round-trip? consumer ack rate? single-queue serialization?) |
| **End-to-end latency** | p50 / p99 / p999 (publish → committed to Postgres) at 80% of ceiling | Report full distribution per broker; no averages |
| **Ordering guarantee** | Observed order vs produced order, per key and global | Classify: per-partition (Kafka), per-queue-FIFO-until-redelivery (Rabbit), per-subject (NATS). Prove with the seq audit |
| **Delivery semantics** | Loss / dup counts after a clean run and after chaos | Classify each as at-most / at-least / effectively-exactly-once **as configured**; show the dedup-store diff |
| **Durability / fsync** | Does an acked message survive `kill -9` of the node that acked it? | Persistent + replicated must lose **zero** acked msgs; document each broker's fsync trigger |
| **Slow-consumer behavior** | What happens when one consumer stalls: lag, memory, or producer block | Classify: lag-on-disk (Kafka/JetStream) vs broker-memory-growth / flow-control (Rabbit) |
| **Broker-failure recovery** | Time to resume + loss/dupe after killing one node mid-load | Report recovery seconds and the loss/dupe delta |
| **Ops footprint** | Nodes, RAM, CPU, disk/min at the matched ceiling; config LOC | Report the *cost* of the throughput, not just the throughput |

> The goal is not a single winning number. It is a **comparable, durability-matched
> profile** for each broker plus the conditions under which each profile is the
> one you want.

## 6. Architecture constraints & guidance

- **One `docker-compose`, three stacks**, all pinned: Kafka **3-broker KRaft**
  cluster (RF=3, `min.insync.replicas=2`, `acks=all`); RabbitMQ **3-node cluster**
  with **quorum queues** + **publisher confirms**; NATS **3-node JetStream**
  cluster with **R=3 file-backed** streams. Anything less than 3 nodes per broker
  cannot be compared on replication/durability.
- **Matched durability is mandatory.** Kafka `acks=all` + ISR=2 ↔ Rabbit quorum
  queue confirm ↔ JetStream R=3 with `AckPolicyExplicit` and `FileStorage`. If a
  broker can't match a property, say so in the matrix — that *is* a finding.
- **One Go interface, three adapters.** No leaking broker types into the harness;
  the harness measures the interface, the adapter owns the semantics. Document
  the irreducible semantic differences the interface can't hide (offset vs ack,
  partition vs subject) in a `SEMANTICS.md`.
- **Clients:** `twmb/franz-go` (Kafka — best batching + transaction control),
  `rabbitmq/amqp091-go` (Rabbit), `nats-io/nats.go` `jetstream` package (NATS).
- **Instrument everything with Prometheus, identically:** publish rate, consume
  rate, e2e p50/p99/p999 histogram, and lag. Lag is broker-specific — Kafka
  consumer-group lag, JetStream `num_pending`, RabbitMQ queue depth (`messages_ready`).
  Normalize them to one "messages behind" panel.

## 7. Data model

```
event (identical stream into all 3 brokers):
  { order_id uint64, customer_id uint64, seq uint64, ts int64, amount int64, pad []byte }
        key = customer_id   (Zipfian hot keys)
        seq = per-key monotonic counter (drives the ordering audit)

idempotent sink (Postgres, shared by all consumers):
  consumed(
    broker      TEXT,            -- 'kafka' | 'rabbit' | 'nats'
    msg_id      TEXT,            -- (order_id) — natural idempotency key
    customer_id BIGINT,
    seq         BIGINT,
    recv_order  BIGINT,          -- global arrival counter at the consumer
    dup_count   INT DEFAULT 1,
    PRIMARY KEY (broker, msg_id)
  )
  -- ON CONFLICT (broker, msg_id) DO UPDATE dup_count = dup_count + 1
  -- → duplicates are counted, not hidden; reordering = where seq < max(seq) per (broker, customer_id)
```

The `consumed` table is simultaneously the **dedup guard** (so each broker can be
run effectively-exactly-once for the loss/dup audit) and the **audit log** (so you
can compute loss = produced − distinct, dups = Σ(dup_count − 1), reorder events
per key per broker from the same data).

## 8. Interface contract

```go
// internal/broker — the only surface the harness sees.
type Broker interface {
    Publish(ctx context.Context, key string, payload []byte) error // returns after durable ack
    Subscribe(handler func(Msg) error) (io.Closer, error)          // at-least-once; handler error → redeliver
}
type Msg struct{ Key string; Payload []byte; Attempt int }
```

- `GET /metrics` → Prometheus exposition (identical metric names across adapters).
- `cmd/bench -broker=<x> -scenario=<s> -rate=<r> -msg-size=<n> -consumers=12 -dur=20m`
  → appends one result row (JSON) with the full histogram + audit summary.
- `cmd/report` → renders Section-5 table per broker + the Section-10 selection
  matrix from the committed result rows.

## 9. Key technical challenges

- **Making it a fair fight.** Log (Kafka) vs queue (Rabbit) vs stream (JetStream)
  have different default durability and different meanings of "consumed". The
  *first* deliverable is a normalized contract; everything downstream is invalid
  without it.
- **Three ordering models.** Kafka guarantees order **per partition** (so hot keys
  collapse onto one partition's consumer). RabbitMQ is FIFO **per queue until a
  redelivery reorders it**. JetStream is ordered **per subject** within a stream.
  Same workload, three different answers to "is it ordered?" — and you must prove
  each with the seq audit, not assert it.
- **Slow consumers diverge sharply.** Kafka and JetStream buffer lag **on disk**
  (the log doesn't care if you're slow). Classic RabbitMQ buffers in **broker
  memory** until flow control kicks in and *back-pressures the producer*. This is
  the single biggest operational difference and it must be measured, not quoted.
- **Redelivery breaks ordering and creates dups.** A NACK/requeue in Rabbit or a
  redeliver-on-no-ack in JetStream can deliver `seq=7` after `seq=8`. Quantify the
  reorder rate and dup rate under induced redelivery per broker.
- **Footprint is part of the answer.** JetStream's single binary at modest scale
  vs a 3-node Kafka + KRaft quorum is a real selection input. Measure RAM/CPU/disk
  at the matched ceiling so "cheaper to operate" is a number, not a vibe.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each, **per broker, at matched durability**, and
roll the conclusions into the selection matrix at the end.

1. **Throughput ceiling at matched durability.** Ramp rate until lag rises
   monotonically. *Measure:* sustained msg/s + MB/s ceiling per broker at 256 B
   and 4 KB; **name the bound** for each (Kafka: replication/fsync batch; Rabbit:
   quorum-queue Raft + single-queue serialization; JetStream: R=3 file fsync).
2. **Latency tails under load.** At 50% and 80% of each broker's ceiling, capture
   p50/p99/p999. *Measure:* the tail shape — does p999 stay flat or blow up? Where
   does each broker's tail come from (GC pause, fsync, requeue)?
3. **Ordering under redelivery.** Induce handler failures on ~1% of messages
   (forces NACK/requeue / redeliver). *Measure:* reorder events per key (`seq <
   max seen`) and dup_count per broker. Show that Kafka per-partition order
   survives, Rabbit FIFO does not, JetStream depends on `MaxAckPending`.
4. **Slow-consumer / backpressure.** Pause 3 of 12 consumers for 5 min mid-run.
   *Measure:* where the backlog goes — Kafka/JetStream disk lag (flat producer)
   vs RabbitMQ broker memory + producer flow-control (producer blocks). Plot
   broker RSS and producer send-rate for all three.
5. **Broker-failure recovery + loss/dupe.** `kill -9` one node mid-load on each
   cluster. *Measure:* seconds to resume publishing, seconds to drain the
   backlog, and the **loss/dupe delta** from the `consumed` audit (`produced` vs
   `distinct` vs `Σdups`). At matched durability, acked-message loss must be zero.
6. **Ops cost & footprint.** At each broker's matched ceiling: RAM, CPU, disk
   bytes/min, node count, and config-LOC. *Measure:* msg/s per core and msg/s per
   GB RAM — the efficiency, not just the throughput.
7. **Selection matrix (required output).** From experiments 1–6, build the
   workload → broker matrix below. Every cell needs a one-line reason grounded in
   a measured number from this lab:

   | Workload shape | Recommended | Why (cite a measured result) |
   |---|---|---|
   | High-throughput event log, replay needed, per-key order | … | … |
   | Per-message work queue / task fan-out, competing consumers | … | … |
   | Request/RPC, flexible routing, low ops footprint, modest scale | … | … |
   | Edge / single-binary / few-ops-people deployment | … | … |
   | Strict exactly-once into a store, high volume | … | … |
   | Bursty producers with frequently-slow consumers | … | … |

   The matrix must include at least one row that says **"do NOT use Kafka here"**
   with the reason.

## 11. Milestones

1. Compose all three 3-node clusters up; the one `Broker` interface + three
   adapters; deterministic `cmd/gen`; shared Postgres sink; Prometheus + a single
   normalized Grafana board (rate/lag/latency for all three).
2. Durability normalization: prove acked-message survival of `kill -9` on each
   broker; write `SEMANTICS.md`.
3. Ceiling + latency runs (experiments 1–2) at both payload sizes; bounds named.
4. Ordering, slow-consumer, and failure runs (experiments 3–5); audit-table diffs.
5. Footprint (experiment 6) + the selection matrix (experiment 7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] All three brokers run the **same** generated stream (same seed) with the
      **same** N=12 consumer topology; mapping documented per result row.
- [ ] Durability is matched and **proven**: a table showing zero acked-message
      loss on `kill -9` for each broker (or an explicit, justified exception).
- [ ] Section-5 SLO table filled for all three at 256 B **and** 4 KB, with the
      throughput bottleneck **named and evidenced** per broker (pprof/`iostat`/
      fsync trace, not a guess).
- [ ] Ordering, dup, and loss numbers come from the `consumed` audit table and are
      shown as SQL/diffs — including the redelivery reorder result.
- [ ] Slow-consumer experiment shows the divergence (disk-lag vs memory/flow-control)
      with a producer-rate + broker-RSS plot.
- [ ] A **selection matrix** with ≥ 6 workload rows, each justified by a measured
      number, including at least one "**don't use Kafka here**" row.
- [ ] Every number is reproducible from a committed `cmd/bench` command + config.

## 13. Stretch goals

- Add a **fourth contender** — Redis Streams or Pulsar — and slot it into the
  matrix without changing the harness (validates your interface).
- **Tiered / retention** comparison: Kafka log retention + compaction vs JetStream
  `MaxAge`/`MaxBytes` discard policy vs Rabbit TTL+DLX — replay cost and disk.
- **Exactly-once paths:** Kafka transactional consume-process-produce vs
  JetStream `double-ack` vs Rabbit confirm+dedup-table — quantify each tax.
- **Multi-consumer-group fan-out:** add a second independent reader on each broker
  and show the cost of a second subscriber (Kafka: free-ish; Rabbit: extra queue
  binding; JetStream: extra consumer cursor).
- **Geo / mirroring** sketch: MirrorMaker2 vs JetStream source/mirror vs Rabbit
  federation — qualitative, with the data path drawn.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|---|---|---|
| Fair comparison | Runs the same workload on all three | **Normalizes the durability contract** and proves it; rejects mismatched-durability numbers as meaningless |
| Throughput analysis | Reports a ceiling per broker | Names and **proves** each bottleneck; explains *why* the three differ |
| Semantics | Knows log vs queue vs stream differ | Maps offset/ack/redelivery models precisely; predicts ordering & dup behavior before measuring, then confirms |
| Failure behavior | Shows loss/dupe after a node kill | Holds zero acked-loss at matched durability; explains each broker's recovery path and timing |
| Backpressure | Notices slow consumers cause lag | Distinguishes disk-lag vs memory/flow-control and shows the producer-side consequence |
| Selection judgment | Produces a matrix | Defends every cell with a number; **knows when NOT to use Kafka** (e.g. per-message task queue, complex routing, tiny-ops edge deploy) and says so |
| Communication | Clear findings note | Could put the matrix in front of an architecture review and defend every cell |

## 15. References

- Kafka docs: replication, ISR/`acks`, KRaft, consumer groups & offsets.
- RabbitMQ docs: quorum queues, publisher confirms, consumer acknowledgements,
  flow control & credit-based back-pressure.
- NATS JetStream docs: streams, durable consumers, ack policies, R=3 file storage,
  `MaxAckPending`, double-ack.
- *Designing Data-Intensive Applications* — Ch. 11 (messaging systems: logs vs
  message brokers).
- Go clients: `twmb/franz-go`, `rabbitmq/amqp091-go`, `nats-io/nats.go` (`jetstream`).
- Sibling methodology: `labs/06-database-bake-off-analytics/` (matched-workload
  bake-off → selection matrix).
- See also: `Interview Question/11-messaging-and-event-streaming/` and
  `Interview Question/23-database-types-and-selection/`.
