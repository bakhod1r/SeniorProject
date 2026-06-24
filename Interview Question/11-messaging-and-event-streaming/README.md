# Messaging & Event Streaming — Kafka / RabbitMQ / NATS

> Senior Go backend interview questions on event-driven systems with Kafka, RabbitMQ, and NATS — covering partitioning, delivery semantics, idempotency, the transactional outbox, and operating consumers against PostgreSQL-backed services.

**23 questions** across **14 topics** · Level: senior

## Topics

- [Kafka Fundamentals](#kafka-fundamentals) (2)
- [Partitioning & Ordering](#partitioning-ordering) (2)
- [Consumer Groups & Rebalancing](#consumer-groups-rebalancing) (2)
- [Replication & Durability](#replication-durability) (2)
- [Delivery Semantics](#delivery-semantics) (2)
- [Idempotent Consumers](#idempotent-consumers) (1)
- [Offset Management](#offset-management) (2)
- [Dead Letter Queues & Retry](#dead-letter-queues-retry) (1)
- [Consumer Lag](#consumer-lag) (2)
- [Log Compaction](#log-compaction) (1)
- [Transactional Outbox & CDC](#transactional-outbox-cdc) (2)
- [Kafka vs RabbitMQ vs NATS](#kafka-vs-rabbitmq-vs-nats) (2)
- [Schema Management](#schema-management) (1)
- [Backpressure & Throughput Tuning](#backpressure-throughput-tuning) (1)

---

## Kafka Fundamentals

#### 1. Walk me through the core Kafka vocabulary — broker, topic, partition, offset, producer, consumer, consumer group — and how they relate.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `kafka`, `fundamentals`

A **broker** is a single Kafka server; a cluster is several brokers. A **topic** is a named logical stream, split into one or more **partitions** — and the partition is the actual unit of storage, ordering, and parallelism. Each partition is an append-only commit log; every record gets a monotonically increasing **offset** that uniquely identifies it within that partition. A **producer** appends records to partitions (choosing one by key hash or round-robin). A **consumer** reads records sequentially and tracks the offset it has processed. A **consumer group** is a set of consumers that cooperatively divide a topic's partitions among themselves so each partition is consumed by exactly one member of the group — that is how you scale horizontally. The mental model that matters: Kafka is a distributed, partitioned, replicated commit log, not a queue. Records are not deleted on read; they persist by retention policy and can be re-read.

**Key points**
- Partition is the unit of ordering, storage, and parallelism — not the topic
- Offset is per-partition and monotonically increasing
- Each partition is consumed by exactly one consumer within a group
- Records persist by retention, not deleted on read (replayable log, not a queue)

**Follow-ups**
- Why is the partition, not the topic, the unit of parallelism?
- What happens if you have more consumers in a group than partitions?

---

#### 2. What is the leader/follower model for a partition, and what role does each play in reads and writes?

*Difficulty:* 🟡 medium  ·  *Tags:* `kafka`, `replication`, `fundamentals`

Every partition has one **leader** replica and zero or more **follower** replicas, spread across brokers. All produce and (by default) all consume traffic for that partition goes through the leader — followers do not serve clients, they only replicate the leader's log by continuously fetching from it. This keeps ordering authoritative: there is a single writer per partition. Followers that have caught up to the leader within `replica.lag.time.max.ms` are in the **ISR** (in-sync replica set). If the leader broker fails, the controller elects a new leader from the ISR, which is why durability guarantees are tied to ISR membership, not raw replication factor. The trade-off: routing everything through one broker per partition concentrates load, which is exactly why partition count and key distribution matter — a hot key makes one leader a bottleneck. (Newer Kafka supports follower fetching for locality, but the leader still owns writes.)

**Key points**
- One leader per partition handles all writes and (by default) reads
- Followers replicate by fetching from the leader; they don't serve clients
- ISR = replicas caught up within replica.lag.time.max.ms
- New leader is elected from ISR on failure — durability depends on ISR, not RF alone

**Follow-ups**
- What happens to availability if all ISR members for a partition are down?
- How does a hot partition key affect the leader broker?

---

## Partitioning & Ordering

#### 3. Kafka only guarantees ordering within a partition. Given an order-processing system, how do you guarantee that all events for a single order are processed in order?

*Difficulty:* 🟡 medium  ·  *Tags:* `kafka`, `partitioning`, `ordering`

You make the **order ID the partition key**. The producer hashes the key (`murmur2(key) % numPartitions` by default) and routes every event for that order to the same partition, where offsets are strictly ordered and a single consumer processes them sequentially. That gives per-order (per-entity) ordering while still parallelizing across orders. Critical caveats: (1) ordering is preserved only if you don't repartition — increasing partition count changes the hash mapping, so existing keys may move and in-flight ordering can break. (2) With async producers, `max.in.flight.requests.per.connection > 1` plus retries can reorder a batch on retry; set `enable.idempotence=true` (which pins safe in-flight limits) to preserve order under retry. (3) On the consumer side, ordering holds only if you process records from a partition sequentially — the moment you fan a partition out to a worker pool, you've thrown ordering away unless you re-shard by key inside the consumer.

**Key points**
- Use the entity ID (order ID) as the partition key for per-entity ordering
- Default partitioner: murmur2(key) % partitions
- Repartitioning breaks key→partition stability — ordering can break across the change
- enable.idempotence preserves order under retries with in-flight > 1
- Fanning a partition out to a worker pool destroys ordering unless you re-key internally


```go
// confluent-kafka-go: key by entity ID so all events for an order share a partition
msg := &kafka.Message{
    TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: kafka.PartitionAny},
    Key:            []byte(order.ID), // hashed to a stable partition
    Value:          payload,
}
_ = producer.Produce(msg, deliveryChan)
```

**Follow-ups**
- How does enable.idempotence interact with max.in.flight.requests?
- You must add partitions to a live topic — how do you avoid breaking per-order ordering?

---

#### 4. How do you choose the number of partitions for a topic, and why is changing it later painful?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `partitioning`, `capacity`

Partition count is the ceiling on consumer parallelism within a group (you can never have more useful consumers than partitions), so you size it from peak throughput: target partitions ≈ max(target_throughput / per_partition_throughput, peak_consumers). Rules of thumb push you to over-provision modestly (e.g., 12–30 for a busy topic) because adding partitions later is disruptive. It's painful for two reasons: (1) **Hash remapping** — the default partitioner is `hash(key) % N`, so changing N reshuffles which partition a key lands in, breaking per-key ordering guarantees across the boundary and scattering related records. (2) **Compacted/stateful topics** — for log-compacted topics or anything where consumers hold per-key state, a moving key means state is now split across partitions. You also can't *reduce* partitions at all. The cost of over-partitioning is more open file handles, more leader elections on failover, and higher end-to-end latency, so it's a balance — but you decide deliberately up front rather than reactively.

**Key points**
- Partitions cap consumer parallelism per group
- Size from peak throughput and peak consumer count; over-provision modestly
- Adding partitions remaps hash(key) % N → breaks ordering and key-state locality
- You cannot decrease partition count
- Over-partitioning costs file handles, failover time, and latency

**Follow-ups**
- When would you intentionally use a custom partitioner instead of key hashing?
- How does partition count interact with the size of __consumer_offsets traffic?

---

## Consumer Groups & Rebalancing

#### 5. What triggers a consumer-group rebalance, and why are rebalances disruptive?

*Difficulty:* 🟡 medium  ·  *Tags:* `kafka`, `consumer-groups`, `rebalancing`

A rebalance redistributes partitions among group members. It's triggered by: a member joining (deploy/scale-up), a member leaving gracefully, a member being evicted (missed `session.timeout.ms` heartbeats or exceeded `max.poll.interval.ms` between polls), partition count changing, or a subscription change. With the classic **eager** protocol it's a stop-the-world event: every consumer revokes *all* its partitions, the group leader recomputes assignments, then everyone resumes. During that window no records are consumed, so lag spikes. It's especially painful when processing is slow: if a single `poll()` takes longer than `max.poll.interval.ms`, the coordinator assumes the consumer is dead and rebalances, which can cause a feedback loop of rebalances under load. It's also where duplicates come from — if you rebalance after processing but before committing, the new owner re-processes. The fixes are static membership and cooperative rebalancing.

**Key points**
- Triggers: member join/leave/eviction, partition count change, subscription change
- Eager protocol is stop-the-world: all partitions revoked, no consumption during rebalance
- Slow processing exceeding max.poll.interval.ms causes eviction → rebalance loops
- Rebalances are a major source of duplicate processing

**Follow-ups**
- How do you tune max.poll.records and max.poll.interval.ms for slow consumers?
- What's the difference between session.timeout and max.poll.interval?

---

#### 6. Compare static membership and cooperative (incremental) rebalancing. When does each help?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `consumer-groups`, `rebalancing`

**Static membership** (`group.instance.id`) gives each consumer a stable identity that survives short disconnects. During a rolling restart or a brief network blip, the coordinator waits out `session.timeout.ms` and lets the same instance reclaim its old partitions instead of triggering a full rebalance — ideal for stateful consumers and rolling deploys where you'd otherwise pay a rebalance per pod. **Cooperative/incremental rebalancing** (the `CooperativeStickyAssignor`) changes the *protocol*: instead of revoking all partitions, members keep the partitions they'll retain and only revoke the specific ones being moved, in two phases. That eliminates the stop-the-world gap — most consumers keep working while only the reassigned partitions pause. They're complementary: static membership reduces *how often* you rebalance; cooperative rebalancing reduces *how much it hurts* when you do. The cost of static membership: if an instance truly dies, you wait the full session timeout before its partitions are reassigned, so you trade faster recovery for fewer spurious rebalances.

**Key points**
- Static membership: stable group.instance.id avoids rebalance on short disconnects/rolling restarts
- Cooperative rebalancing: revoke only moved partitions, not all — no stop-the-world
- Static reduces rebalance frequency; cooperative reduces rebalance cost — use both
- Trade-off: static membership delays reassignment after a real crash (waits session timeout)

**Follow-ups**
- Why is static membership especially valuable for stateful stream processors?
- What can go wrong if two instances accidentally share the same group.instance.id?

---

## Replication & Durability

#### 7. Explain acks=0, acks=1, and acks=all, and how each interacts with min.insync.replicas.

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `durability`, `replication`

`acks` controls when the producer considers a write durable. **acks=0**: fire-and-forget — the producer doesn't wait for any ack; highest throughput, but a dropped network packet or a leader crash silently loses the record. **acks=1**: the leader acknowledges after writing to its own log, before followers replicate; you lose data if the leader crashes before any follower copies that record and a new leader is elected. **acks=all** (a.k.a. -1): the leader waits until all *in-sync* replicas have the record. By itself that's not enough — if the ISR has shrunk to just the leader, "all" means "one," so you pair it with `min.insync.replicas`. With `min.insync.replicas=2` and `acks=all`, a produce is rejected (`NotEnoughReplicas`) unless at least two replicas are in-sync, guaranteeing the record survives a single broker loss. The canonical durable config is replication.factor=3, min.insync.replicas=2, acks=all — it tolerates one broker failure with no loss while still accepting writes. The trade-off is latency and availability: if too many replicas fall out of the ISR, producers start failing rather than risking loss.

**Key points**
- acks=0 fire-and-forget; acks=1 leader-only; acks=all waits for full ISR
- acks=all alone is insufficient if ISR shrinks to 1 — pair with min.insync.replicas
- Durable baseline: RF=3, min.insync.replicas=2, acks=all (survives 1 broker loss)
- Trade-off: stronger durability sacrifices write availability when ISR shrinks

**Follow-ups**
- With RF=3 and min.insync=2, what happens to producers when 2 of 3 brokers are down?
- Why is acks=all without min.insync.replicas a false sense of security?

---

#### 8. What is unclean leader election, and how can it cause data loss even with acks=all?

*Difficulty:* 🔴 staff  ·  *Tags:* `kafka`, `durability`, `data-loss`, `failure-modes`

Normally a new leader is elected only from the ISR, so it has every acknowledged record. **Unclean leader election** (`unclean.leader.election.enable=true`) allows a leader to be elected from an *out-of-sync* replica when no ISR member is available — for example, all in-sync replicas are down and only a lagging follower survives. That replica is missing the most recent records, so electing it as leader **truncates the log** to its position and permanently drops the already-acknowledged records after it — silent data loss, even though producers saw acks=all. The trade-off is availability vs. durability: with unclean election disabled (the modern default), the partition simply goes offline and rejects writes until an ISR member returns — you keep your data but lose availability. With it enabled, the partition stays writable but can lose committed data. For anything financial or event-sourced (where the log *is* the source of truth), you keep it disabled and accept the availability hit; you only enable it for low-value, high-availability telemetry-style streams.

**Key points**
- Unclean election promotes an out-of-sync replica when no ISR member is available
- It truncates the log → drops acknowledged records → silent loss despite acks=all
- Disabled (default): partition goes offline, preserving data but sacrificing availability
- Keep disabled for event-sourced/financial data; only enable for low-value HA streams

**Follow-ups**
- How does unclean leader election interact with consumers reading at the high watermark?
- Would you ever enable it? For what kind of topic?

---

## Delivery Semantics

#### 9. Define at-most-once, at-least-once, and exactly-once delivery. Which is Kafka's default, and why is at-least-once the practical norm?

*Difficulty:* 🟡 medium  ·  *Tags:* `kafka`, `delivery-semantics`

**At-most-once**: every message is delivered zero or one time — you may lose messages but never duplicate. You get this by committing offsets *before* processing: if you crash mid-process, the offset is already advanced and the record is skipped. **At-least-once**: every message is delivered one or more times — you never lose, but may duplicate. You get this by committing *after* successful processing: a crash before commit means the record is re-read. **Exactly-once**: each message affects state once and only once — the strongest and most expensive. Out of the box, a typical consumer that commits after processing gives **at-least-once**, and that is the practical default most systems run because the failure mode (a duplicate) is recoverable by making consumers idempotent, whereas the at-most-once failure mode (silent loss) usually isn't acceptable. The senior takeaway: don't chase exactly-once; assume at-least-once and design idempotent consumers, because retries, rebalances, and reprocessing are normal operational events.

**Key points**
- At-most-once = commit before processing → possible loss, no duplicates
- At-least-once = commit after processing → no loss, possible duplicates
- Exactly-once = each message affects state once; strongest and costliest
- At-least-once is the practical norm; design idempotent consumers rather than chase EOS

**Follow-ups**
- Why do rebalances reintroduce duplicates even with careful offset commits?
- When is at-most-once actually the right choice?

---

#### 10. How does Kafka achieve exactly-once semantics (EOS), and what does it actually cost?

*Difficulty:* 🔴 staff  ·  *Tags:* `kafka`, `delivery-semantics`, `exactly-once`, `transactions`

Kafka EOS combines two mechanisms. (1) The **idempotent producer** (`enable.idempotence=true`) assigns each producer a PID and a per-partition sequence number; the broker deduplicates on (PID, sequence), so a retried produce doesn't create a duplicate record in the log — this gives exactly-once *writes within a partition*. (2) **Transactions** (`transactional.id`) let a producer atomically write to multiple partitions *and* commit consumer offsets in the same transaction, with a two-phase commit coordinated by the transaction coordinator. Consumers reading with `isolation.level=read_committed` skip aborted/uncommitted records. Together this gives the read-process-write loop exactly-once *within Kafka*. The costs are real: extra latency from transaction begin/commit and from buffering until commit; throughput drops because of coordination and the read_committed visibility delay; operational complexity around transactional.id assignment and zombie fencing; and — crucially — it's exactly-once only *within Kafka*. The moment your consumer writes to PostgreSQL or calls an external API, EOS no longer covers you, and you're back to needing idempotent writes. That's why most teams use idempotent producers for safe retries but implement idempotency at the consumer's sink rather than full Kafka transactions.

**Key points**
- Idempotent producer: (PID, sequence) dedup → exactly-once writes within a partition
- Transactions: atomic multi-partition writes + offset commit, two-phase via coordinator
- Consumers must use isolation.level=read_committed to skip aborted records
- Costs: latency, lower throughput, operational complexity, zombie fencing
- EOS is only within Kafka — external sinks (Postgres, APIs) still need idempotency

**Follow-ups**
- Why does EOS not extend to a Postgres write inside your consumer?
- What is zombie fencing and why does transactional.id matter for it?

---

## Idempotent Consumers

#### 11. Since at-least-once means duplicates are inevitable, how do you build an idempotent consumer against PostgreSQL?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `idempotency`, `postgres`, `consumers`

The principle: make processing the same message twice produce the same end state as processing it once. Three common techniques, often combined. (1) **Natural idempotency via upserts** — if the operation is "set balance to X" or "mark order shipped," an `INSERT ... ON CONFLICT DO UPDATE` is naturally idempotent because reapplying it changes nothing. (2) **Dedup table** — for non-idempotent effects ("add $10"), record a unique business/event ID in a `processed_events` table inside the *same transaction* as the side effect; a duplicate hits the unique constraint and is safely skipped. (3) **Idempotency keys from the producer** — propagate a stable message ID (or use Kafka's (topic, partition, offset) as the key) so the consumer can detect replays deterministically. The key correctness detail is atomicity: the business write and the dedup-key insert must commit in one PostgreSQL transaction, otherwise a crash between them reopens the duplicate window. Offset commit happens *after* that DB transaction succeeds. This is what lets you safely run at-least-once delivery.

**Key points**
- Goal: processing twice == processing once (same final state)
- Upserts (INSERT ... ON CONFLICT) for naturally idempotent operations
- Dedup table keyed by event/business ID for non-idempotent effects
- Business write + dedup-key insert must be ONE Postgres transaction
- Commit Kafka offset only after the DB transaction succeeds


```go
// Idempotent consume: dedup insert + side effect in one tx, then commit offset.
func handle(ctx context.Context, db *sql.DB, ev Event) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer tx.Rollback()

    // Reject replays atomically with the side effect.
    res, err := tx.ExecContext(ctx,
        `INSERT INTO processed_events (event_id) VALUES ($1)
         ON CONFLICT (event_id) DO NOTHING`, ev.ID)
    if err != nil { return err }
    if n, _ := res.RowsAffected(); n == 0 {
        return tx.Commit() // already processed -> no-op, safe to advance offset
    }

    if _, err := tx.ExecContext(ctx,
        `UPDATE accounts SET balance = balance + $1 WHERE id = $2`,
        ev.Amount, ev.AccountID); err != nil {
        return err
    }
    return tx.Commit() // commit Kafka offset AFTER this returns nil
}
```

**Follow-ups**
- Why must offset commit happen after the DB transaction, not before?
- How do you keep the processed_events table from growing unbounded?
- When are (topic, partition, offset) a worse dedup key than a business ID?

---

## Offset Management

#### 12. Compare auto-commit and manual offset commit. Why does the order of commit vs. processing determine whether you get duplicates or loss?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `offsets`, `delivery-semantics`

With **auto-commit** (`enable.auto.commit=true`), the client commits the offsets of *fetched* records on a timer (`auto.commit.interval.ms`) — independent of whether you've finished processing them. That's convenient but dangerous: if records are committed but your processing crashes before completing, those records are lost (at-most-once leaning), and the exact failure window is non-deterministic. **Manual commit** gives you control over the ordering, and the ordering *is* the delivery semantic. **Commit-before-process**: you advance the offset, then process; a crash mid-process skips the record → at-most-once → possible **loss**. **Commit-after-process**: you process, then commit; a crash after processing but before commit re-reads the record → at-least-once → possible **duplicates**. Since loss is usually unacceptable and duplicates are recoverable with idempotency, the standard pattern is manual commit *after* successful processing (and after your DB transaction), accepting duplicates and deduping at the sink. The subtlety: auto-commit doesn't truly give you either guarantee cleanly because its timer doesn't align with your processing boundaries.

**Key points**
- Auto-commit fires on a timer, decoupled from processing — non-deterministic loss window
- Commit-before-process → at-most-once → loss
- Commit-after-process → at-least-once → duplicates
- Standard: manual commit after processing + DB tx, dedupe at the sink
- Auto-commit gives neither guarantee cleanly because its timing isn't processing-aligned


```go
// Disable auto-commit; commit only after the record (and its DB tx) is done.
c, _ := kafka.NewConsumer(&kafka.ConfigMap{
    "group.id":           "orders-svc",
    "enable.auto.commit": false,
    "auto.offset.reset":  "earliest",
})
for {
    msg, err := c.ReadMessage(-1)
    if err != nil { continue }
    if err := process(msg); err != nil { continue } // do NOT commit on failure
    _, _ = c.CommitMessage(msg) // commits offset of msg+1 after success
}
```

**Follow-ups**
- What does __consumer_offsets store and why is it a compacted topic?
- How does committing in batches change your duplicate exposure on crash?

---

#### 13. Where does Kafka store consumer offsets, and why is __consumer_offsets log-compacted?

*Difficulty:* 🟡 medium  ·  *Tags:* `kafka`, `offsets`, `compaction`

Committed offsets live in an internal Kafka topic, **__consumer_offsets**, keyed by (group, topic, partition) with the value being the latest committed offset (plus metadata). Storing offsets in Kafka itself — rather than ZooKeeper, as very old versions did — means offset commits are just appends to a partitioned, replicated log, so they scale and survive broker failures the same way data does. It's **log-compacted** because consumers only ever need the *latest* offset for each (group, topic, partition) key; every new commit makes the previous one obsolete. Compaction retains the most recent value per key and garbage-collects the superseded records, so the topic stays bounded even though a busy group commits constantly. This is also the canonical example of compaction's use case: a changelog where you care about the current state per key, not the full history. The operational implication: if a consumer group's offsets are deleted or expire (`offsets.retention.minutes`), the group restarts from `auto.offset.reset` (earliest/latest), which can cause a flood of reprocessing or silent skips.

**Key points**
- __consumer_offsets stores latest committed offset per (group, topic, partition)
- Offsets in Kafka (not ZooKeeper) → replicated, partitioned, broker-failure tolerant
- Log-compacted: only the latest offset per key matters; old commits GC'd
- Offset expiry → group falls back to auto.offset.reset (mass replay or skip)

**Follow-ups**
- What happens to a stopped consumer group after offsets.retention.minutes elapses?
- How is __consumer_offsets a microcosm of log compaction's purpose?

---

## Dead Letter Queues & Retry

#### 14. Design a retry and dead-letter strategy for a Kafka consumer. How do you handle poison messages without blocking the partition?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `dlq`, `retry`, `poison-messages`

The core problem: in Kafka a partition is strictly ordered, so a single un-processable **poison message** at the head will block every record behind it forever if you keep retrying in place. You don't want unbounded in-line retries. A common pattern is **tiered retry topics with backoff plus a DLQ**: the main consumer tries the record; on a retryable failure it republishes to a `orders.retry.5s` topic (with an attempt count and a not-before timestamp in headers) and *commits the main offset*, unblocking the partition. A separate retry consumer waits out the backoff, reprocesses, and on continued failure escalates to `orders.retry.1m`, then `orders.retry.5m`. After `max attempts` (or for clearly non-retryable errors like a schema violation), the record goes to a **dead-letter topic** with the original payload, error, and headers for human triage or a fix-and-replay tool. Key decisions: distinguish *transient* failures (DB blip → retry) from *poison* (malformed → straight to DLQ, don't waste retries); cap attempts; preserve headers/lineage; and emit metrics/alerts on DLQ arrivals because a filling DLQ is an incident, not a feature. (RabbitMQ does this more natively with per-queue DLX and TTL.)

**Key points**
- Strict partition ordering means a poison message blocks the partition under in-line retry
- Tiered retry topics with increasing backoff; commit main offset to unblock the partition
- Distinguish transient (retry) vs non-retryable/poison (straight to DLQ)
- Cap attempts, preserve payload + error + lineage headers in the DLQ
- Alert on DLQ arrivals; build a fix-and-replay path

**Follow-ups**
- How does moving a record to a retry topic affect ordering guarantees for that key?
- How would RabbitMQ's dead-letter exchange + TTL implement the same thing more natively?
- How do you replay a DLQ safely without reintroducing the original failure?

---

## Consumer Lag

#### 15. What is consumer lag, how do you monitor it, and what does growing lag tell you?

*Difficulty:* 🟡 medium  ·  *Tags:* `kafka`, `lag`, `monitoring`, `operations`

**Consumer lag** for a partition is the difference between the partition's log-end offset (latest produced) and the consumer group's committed offset — i.e., how many records behind real-time the group is. You monitor it per partition (not just aggregate) because one hot/stuck partition can hide behind a healthy average; tools include `kafka-consumer-groups --describe`, Burrow, or exporting lag to Prometheus/Grafana with alerts. **Steady, non-zero lag** is fine — it means you have buffer. **Growing lag** means consumers can't keep up with the production rate: either the producers spiked, processing got slower (a slow downstream DB, GC pauses, an external call), a consumer died and its partitions are now overloaded onto fewer members, or you're stuck retrying a poison record. The senior nuance: look at lag *velocity* and *per-partition skew*, not just absolute value. Flat-but-large lag after a backfill will drain; steadily climbing lag won't and signals you must scale consumers, speed up processing, or shed load. Also watch for lag that's pinned to one partition — that's usually a hot key or a stuck consumer, which adding consumers won't fix.

**Key points**
- Lag = log-end offset − committed offset, per partition
- Monitor per-partition (skew hides in aggregates); export to Prometheus/Burrow
- Steady lag = buffer (fine); growing lag = can't keep up
- Causes: producer spike, slow processing, dead consumer, poison-message stall
- Watch velocity and per-partition skew, not just absolute value

**Follow-ups**
- Lag is high on exactly one partition — what's your hypothesis?
- What's the difference between lag in records and lag in time?

---

#### 16. Lag is growing and you want to scale out consumers. What's the hard limit, and what are your real options?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `lag`, `scaling`, `partitioning`

The hard limit is **partition count**: within a consumer group, each partition is owned by exactly one consumer, so adding consumers beyond the partition count just gives you idle members — they sit there with no assignment. So if a topic has 12 partitions, 12 is your max useful parallelism for that group. Your real options when you hit the wall: (1) **Increase partitions** — but this is disruptive (rehashes keys, breaks per-key ordering across the change, can't be undone) and you should have provisioned headroom up front. (2) **Speed up per-message processing** — batch DB writes, remove a synchronous external call, use a connection pool, profile the consumer; often the cheapest win. (3) **Decouple consume from process** — read fast, hand work to an internal worker pool, but only if you can re-shard by key to preserve ordering and you handle offset commits carefully (commit only what's fully processed). (4) **Shed or sample** for low-value streams. The interview red flag is someone who reflexively says "add more consumers" without acknowledging the partition ceiling and the cost of repartitioning — which is exactly why partition sizing is an up-front design decision.

**Key points**
- Max useful consumers per group = partition count; extras sit idle
- Increasing partitions is disruptive: rehash, ordering break, irreversible
- Often better: speed up processing (batching, pooling, drop sync calls)
- Internal worker pool decouples consume/process but complicates ordering + commits
- Right answer requires acknowledging the partition ceiling, not just 'add consumers'

**Follow-ups**
- If you decouple consume from process with a worker pool, how do you commit offsets safely?
- Why is provisioning partition headroom up front cheaper than repartitioning later?

---

## Log Compaction

#### 17. Explain log compaction versus time/size retention, and give a concrete use case.

*Difficulty:* 🟡 medium  ·  *Tags:* `kafka`, `compaction`, `cdc`, `changelog`

Standard retention deletes records older than `retention.ms` or beyond `retention.bytes` — it's history-oriented and eventually drops everything. **Log compaction** (`cleanup.policy=compact`) instead guarantees that Kafka retains *at least the last value for each key*, garbage-collecting only superseded records for the same key. The result is a topic that converges to a snapshot of the latest state per key while still being an append log you can replay. The canonical use case is a **changelog / CDC stream**: a topic keyed by entity ID where each record is the entity's current state, so a new consumer can bootstrap full current state by reading the compacted topic from the beginning, then switch to tailing live updates — without you keeping infinite history. Kafka's own `__consumer_offsets` and Kafka Streams' state-store changelogs work exactly this way. Important subtleties: a record with a non-null key and a **null value is a tombstone** that marks the key as deleted and is itself retained for `delete.retention.ms` so consumers can observe the deletion; compaction operates on keys, so unkeyed records don't compact meaningfully; and compaction is background work, so you'll still see some duplicate keys in the tail before cleaning catches up.

**Key points**
- Retention deletes by age/size; compaction keeps the latest value per key
- Produces a replayable snapshot-of-current-state log
- Use case: changelog/CDC keyed by entity ID — bootstrap state then tail live
- Null value = tombstone (delete marker), retained for delete.retention.ms
- Requires keys; cleaning is background so the tail may still hold duplicate keys

**Follow-ups**
- What is a tombstone and why must it linger before being removed?
- Why do __consumer_offsets and Streams state stores use compaction?

---

## Transactional Outbox & CDC

#### 18. What is the dual-write problem, and why does it make 'save to Postgres then publish to Kafka' unsafe?

*Difficulty:* 🟠 hard  ·  *Tags:* `outbox`, `dual-write`, `postgres`, `consistency`

The **dual-write problem** arises whenever a single logical operation must update two independent systems — here, commit a row in PostgreSQL and publish an event to Kafka — with no shared transaction across them. There is no atomicity, so a crash between the two leaves them inconsistent. Two failure modes: (1) the DB commit succeeds but the Kafka publish fails or the process dies before it → the state change happened but no event was emitted, so downstream services never learn about it (silent inconsistency). (2) you publish to Kafka first and then the DB commit fails/rolls back → you emitted an event for a state change that never happened, causing phantom downstream effects. You cannot fix this by reordering, and you cannot fix it with retries alone (a retry after a crash doesn't know how far you got). Distributed transactions / 2PC across Postgres and Kafka are impractical and operationally toxic. The clean solution is to make the event part of the *same database transaction* as the state change — that's the **transactional outbox** — and propagate it to Kafka asynchronously.

**Key points**
- Dual-write = updating two systems with no shared transaction → no atomicity
- Crash between writes → either missing event or phantom event
- Reordering doesn't fix it; retries can't know how far you got
- 2PC across Postgres+Kafka is impractical/toxic
- Fix: make the event part of the same DB transaction (outbox)

**Follow-ups**
- Why can't you solve dual-write with retries on the Kafka publish?
- Why is 2PC across a DB and a broker a poor real-world choice?

---

#### 19. Walk me through the Transactional Outbox pattern end to end, including how the event reaches Kafka.

*Difficulty:* 🔴 staff  ·  *Tags:* `outbox`, `cdc`, `debezium`, `postgres`, `idempotency`

The outbox makes event emission atomic with the business write by putting both in one PostgreSQL transaction. (1) In the *same transaction* that mutates your domain tables, you `INSERT` a row into an `outbox` table containing the event (aggregate ID, type, payload, a unique event ID). Because it's one transaction, either both the state change and the outbox row commit, or neither does — the dual-write problem is gone. (2) A separate **relay** moves outbox rows to Kafka asynchronously, two flavors: a **polling publisher** (a worker `SELECT ... FOR UPDATE SKIP LOCKED` the unsent rows, publishes to Kafka, marks them sent/deletes them) — simple but adds DB load and latency; or **CDC via Debezium**, which tails the PostgreSQL WAL/logical replication slot and streams committed outbox inserts straight to Kafka with no polling and minimal added latency. Critical properties: delivery is **at-least-once** (the relay can crash after publishing but before marking sent → republish), so the unique event ID lets *consumers* dedupe — outbox guarantees you don't lose events, idempotent consumers handle the duplicates. Ordering is preserved per aggregate if you key the Kafka record by aggregate ID. With CDC you usually `DELETE` the outbox row right after insert (the WAL already captured it) to keep the table small; with polling you mark `sent_at`. This pairing — outbox for atomic capture, CDC for propagation, idempotent consumers for dedupe — is the standard production recipe.

**Key points**
- Business write + outbox INSERT in ONE Postgres transaction → atomic capture
- Relay options: polling publisher (SELECT FOR UPDATE SKIP LOCKED) or CDC/Debezium tailing the WAL
- Delivery is at-least-once → consumers dedupe on the unique event ID
- Key Kafka record by aggregate ID to preserve per-aggregate ordering
- CDC adds least latency/load; polling is simpler but heavier on the DB
- Recipe: outbox (atomicity) + CDC (propagation) + idempotent consumer (dedupe)


```sql
-- 1) Atomic capture: domain change + outbox row in one transaction.
BEGIN;
  UPDATE orders SET status = 'PAID' WHERE id = $1;
  INSERT INTO outbox (id, aggregate_id, type, payload, created_at)
  VALUES (gen_random_uuid(), $1, 'OrderPaid', $2::jsonb, now());
COMMIT;

-- 2a) Polling relay: claim unsent rows without contention, then publish to Kafka.
-- SELECT id, aggregate_id, type, payload FROM outbox
--   WHERE sent_at IS NULL
--   ORDER BY created_at
--   FOR UPDATE SKIP LOCKED
--   LIMIT 100;
-- (publish each to Kafka keyed by aggregate_id, then UPDATE outbox SET sent_at = now())

-- 2b) Or skip polling entirely: Debezium tails the WAL and streams outbox inserts to Kafka.
```

**Follow-ups**
- Why is the outbox still only at-least-once, and where does dedup live?
- Polling publisher vs Debezium CDC — when would you pick each?
- How do you preserve per-aggregate ordering through the relay to Kafka?
- How do you keep the outbox table from bloating?

---

## Kafka vs RabbitMQ vs NATS

#### 20. Compare Kafka, RabbitMQ, and NATS. Given an event-driven backend, when would you reach for each?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `rabbitmq`, `nats`, `comparison`, `architecture`

They're different shapes of tool. **Kafka** is a distributed, replicated **commit log** — a 'dumb broker, smart consumer' design. Messages persist by retention and are *replayable*; consumers track their own offsets; it excels at high-throughput event streaming, event sourcing, CDC, log compaction, and fan-out where many independent consumer groups each read the full stream at their own pace. The cost is operational weight and the partition-as-parallelism model. **RabbitMQ** is a traditional **smart broker** built around AMQP: producers publish to **exchanges** that route to **queues** by binding rules (direct/topic/fanout/headers); consumers ack/nack individual messages, redelivery and per-message TTL and dead-letter exchanges are first-class, and **prefetch** controls in-flight count per consumer for fair dispatch and backpressure. It shines for complex routing, per-message acknowledgement, task/work queues, RPC, and request/response — the broker does the work. Messages are typically consumed-and-gone (not a replayable log). **NATS (core)** is a lightweight, blazing-fast **pub/sub** fabric for ephemeral, fire-and-forget messaging and request/reply with minimal ops; **JetStream** adds persistence, at-least-once delivery, and streams when you need durability without Kafka's heft. Rule of thumb: choose Kafka when the *stream is the source of truth* and you need replay/throughput/multiple independent consumers; RabbitMQ when you need *smart routing and per-message workflow control* (work queues, retries, DLX); NATS when you want *lightweight, low-latency pub/sub or service messaging* (JetStream if you also need durability).

**Key points**
- Kafka = replayable commit log, dumb broker/smart consumer; streaming, event sourcing, CDC, fan-out
- RabbitMQ = smart broker (exchanges→queues), ack/nack, prefetch, DLX/TTL; routing + work queues + RPC
- NATS core = ultra-light ephemeral pub/sub + request/reply; JetStream adds durability
- Kafka when the stream is the source of truth and you need replay/throughput
- RabbitMQ when you need routing and per-message workflow control
- NATS when you want lightweight low-latency service messaging

**Follow-ups**
- How do RabbitMQ exchanges and bindings differ from Kafka topics/partitions?
- What does prefetch do in RabbitMQ and why is it your backpressure knob?
- When does Kafka's replayability actually matter to a consumer?

---

#### 21. In RabbitMQ, explain exchanges, queues, ack/nack, and prefetch — and how they give you backpressure and reliability that differ from Kafka.

*Difficulty:* 🟡 medium  ·  *Tags:* `rabbitmq`, `backpressure`, `reliability`, `comparison`

In RabbitMQ a producer never writes to a queue directly — it publishes to an **exchange**, which routes copies to bound **queues** based on type: *direct* (exact routing key), *topic* (wildcard patterns like `order.*.eu`), *fanout* (every bound queue), or *headers*. This decouples routing logic from producers. Consumers pull from queues and explicitly **ack** a message when processed (the broker then deletes it) or **nack/reject** it, optionally with `requeue` or routing to a **dead-letter exchange**. Unacked messages are redelivered if the consumer dies — that's RabbitMQ's at-least-once. **Prefetch** (`basic.qos`) caps how many unacknowledged messages the broker will push to one consumer at a time; setting it low gives fair dispatch and natural backpressure (a slow consumer simply isn't handed more work), while a high/unbounded prefetch lets one consumer hog the queue and blow up memory. The contrast with Kafka: RabbitMQ tracks state *per message* in the broker (acks, redelivery, TTL, DLX) and messages are gone once acked — great for work queues and routing; Kafka tracks a single *offset* per partition in the consumer, keeps the log for replay, and scales by partitions. RabbitMQ gives finer per-message control; Kafka gives a replayable, higher-throughput stream.

**Key points**
- Producers publish to exchanges; exchanges route to queues (direct/topic/fanout/headers)
- Consumers ack (delete) or nack/reject (requeue or DLX); unacked → redelivered
- Prefetch (basic.qos) caps unacked messages per consumer → fair dispatch + backpressure
- RabbitMQ = per-message broker state, consumed-and-gone; Kafka = offset + replayable log

**Follow-ups**
- What happens with prefetch set too high on a slow consumer?
- How would you implement retry-with-backoff using DLX and message TTL?

---

## Schema Management

#### 22. Why do you need a schema registry for Kafka, and how do compatibility modes prevent breaking consumers?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `schema-registry`, `avro`, `protobuf`, `compatibility`

Kafka itself is schema-agnostic — values are just bytes — so without governance, a producer changing its event shape silently breaks every consumer downstream, and you find out in production. A **schema registry** (Confluent, Apicurio) stores versioned schemas (typically **Avro** or **Protobuf**, sometimes JSON Schema) and assigns each a global ID; producers serialize with a schema and prepend its ID, consumers fetch the matching schema by ID to deserialize. This decouples producer and consumer deploys and makes the contract explicit. The registry *enforces* **compatibility** on schema evolution: **BACKWARD** (the default) means new consumers can read data written with the previous schema — so you can add optional fields with defaults or remove fields, and you upgrade consumers first; **FORWARD** means old consumers can read data from the new schema — upgrade producers first; **FULL** is both; **NONE** disables checks. Registering an incompatible schema is *rejected at publish time*, turning a runtime outage into a deploy-time error. Avro vs Protobuf trade-offs: Avro needs the writer schema to decode (hence the ID), is compact, and is strong on schema evolution; Protobuf has wide language/gRPC support and field-number-based evolution. The senior point: pick a compatibility mode that matches your deploy order and treat the schema as a versioned API contract.

**Key points**
- Kafka is byte-agnostic; without a registry, schema drift breaks consumers in production
- Registry stores versioned Avro/Protobuf schemas by ID; producer prepends ID, consumer fetches
- BACKWARD (default): new consumers read old data → upgrade consumers first
- FORWARD: old consumers read new data → upgrade producers first; FULL = both
- Incompatible schema rejected at publish → deploy-time error, not runtime outage

**Follow-ups**
- You need to remove a required field — which compatibility mode and deploy order?
- Why does Avro require the writer schema to deserialize, and how does the registry solve that?
- Avro vs Protobuf for an event-streaming platform — how do you choose?

---

## Backpressure & Throughput Tuning

#### 23. A Kafka producer isn't hitting target throughput. Which knobs do you tune, and what are the trade-offs (batch.size, linger.ms, compression, acks)?

*Difficulty:* 🟠 hard  ·  *Tags:* `kafka`, `throughput`, `backpressure`, `tuning`, `performance`

Kafka producers batch records per partition; throughput comes from sending fewer, larger requests. (1) **batch.size** caps a batch's bytes; raising it lets more records pack into one request — bigger throughput, more memory. (2) **linger.ms** tells the producer to wait briefly to accumulate a fuller batch before sending; the default 0 sends immediately (low latency, small batches), while linger.ms=5–20 trades a little latency for much better batching and throughput — usually the single biggest win. (3) **compression.type** (lz4/zstd/snappy/gzip) compresses the *batch*, cutting network and disk; it pairs with larger batches because more records compress better, and lz4/zstd give a strong ratio/CPU balance — the cost is producer CPU. (4) **acks** is the durability/throughput dial: acks=all is safest but adds replication latency; you keep it for important data and lean on batching/compression to recover throughput rather than weakening acks. (5) **buffer.memory / max.in.flight** govern how much the producer can have outstanding (keep idempotence on so high in-flight stays safe). The senior framing: don't sacrifice acks=all for speed by default — first exploit linger.ms + batch.size + compression, which buy throughput almost for free, and only revisit durability if the workload genuinely tolerates loss. And remember the consumer side: real backpressure comes from the slowest stage, so profile end-to-end (often the consumer's DB writes), not just the producer.

**Key points**
- Throughput = bigger batches: raise batch.size and linger.ms (5–20ms) for fuller batches
- linger.ms is usually the biggest single win (trades small latency for batching)
- compression.type (lz4/zstd) cuts network/disk, pairs with larger batches, costs CPU
- Keep acks=all for durability; recover throughput via batching/compression, not weaker acks
- Profile end-to-end — backpressure comes from the slowest stage (often the consumer DB)


```go
// confluent-kafka-go: batching + compression for throughput, durability kept.
p, _ := kafka.NewProducer(&kafka.ConfigMap{
    "linger.ms":          10,        // wait to build fuller batches
    "batch.size":         1 << 18,   // 256 KiB batches
    "compression.type":   "lz4",     // compress the batch
    "acks":               "all",     // durability kept; tune throughput elsewhere
    "enable.idempotence": true,      // safe retries + ordering with in-flight > 1
})
```

**Follow-ups**
- Why does compression interact with batch.size and linger.ms?
- Where does real backpressure usually originate in an event-driven Go service?
- How do you tune the consumer side (max.poll.records, fetch.min.bytes) for throughput?

---
