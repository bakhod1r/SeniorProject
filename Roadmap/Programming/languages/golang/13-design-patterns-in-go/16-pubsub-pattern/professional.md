# Pub/Sub — Professional

> Focus: staff/principal-level decisions. Pub/Sub at scale is not a library; it is an architectural commitment about who owns *truth*, who owns *latency*, and who owns *replay*. The Go code is the easy part. The hard parts are idempotency under retries, schema evolution across teams, and the operational shape of a system whose most important property is what happens when a broker partition stops responding for 90 seconds at 03:00. Opinionated where the field agrees, explicit about trade-offs where it does not.

---

## 1. Pub/Sub as a system primitive

Pub/Sub is one member of a family of inter-service primitives. Conflating them is the most common architectural mistake; you cannot retrofit one into another after the call sites are written.

| Primitive | Coupling | Delivery model | Consumer knowledge | Typical use |
|---|---|---|---|---|
| RPC (gRPC, HTTP) | Tight: caller knows callee | Sync request/response | 1 known callee | "Charge this card and tell me the result" |
| Work queue (SQS, Rabbit work) | Loose on identity, tight on contract | Async, exactly-one-consumer | N anonymous workers | "Resize this image" — any free worker |
| Pub/Sub topic (Kafka, NATS) | Loose: publisher does not know subscribers | Async, fan-out, at-least-once | 0..N independent subs | "An order was placed" — accounting, search, fraud, audit all react |
| Event bus (in-process) | Same binary | Async, fan-out, lossy | 0..N handlers | Domain events, internal cache invalidations |
| Event log (Kafka with retention) | Loose, with replay | Append-only, position-addressable | Anyone, at any past offset | Event sourcing, late-joining consumers |

Four distinctions matter operationally:

1. **Who knows whom.** RPC requires the caller to know endpoints; Pub/Sub requires the publisher to know nothing beyond the topic. The instant a publisher learns "subscriber X needs this", the abstraction has leaked.
2. **Delivery cardinality.** Work queues are 1-of-N; topics are 1-to-all-subscribers; consumer groups are 1-of-N *within a group*. Mixing them is how `payment-processed` gets consumed twice by `email-sender`.
3. **Time semantics.** RPC has one deadline. Pub/Sub has *eventual* delivery. A successful `Publish` means the broker accepted the message — not that any consumer saw it.
4. **Truth ownership.** The broker is not the system of record. The producer's database is. Treating a successful publish as proof the side effect occurred is the most common production failure.

A useful rule: **RPC when the caller needs the result inline; work queue when one party needs work done; Pub/Sub when several independent parties need to know something happened.** The third case is the broadest and the most abused — every "let's just emit an event" needs a written list of consumers.

---

## 2. Quantitative cost analysis

Numbers below are Go 1.22, amd64, NATS JetStream 2.10 / Kafka 3.7 on a 10 GbE LAN.

### 2.1 In-process baseline

```
BenchmarkChannelSendRecv      50 ns/op      0 B/op  0 allocs   (buffered chan)
BenchmarkBrokerFanout4       210 ns/op    128 B/op  1 alloc    (in-proc, 4 subs)
BenchmarkBrokerFanout64     2300 ns/op    128 B/op  1 alloc    (in-proc, 64 subs)
```

In-process Pub/Sub is ~50 ns per delivery per subscriber. Negligible against any I/O.

### 2.2 Brokered baseline

```
NATS Core, single subject, sync publish:                  ~80 µs round-trip
NATS JetStream, AckExplicit, durable consumer:           ~600 µs publish + ack
Kafka, acks=all, batch.size=16KB, linger.ms=5:           ~3 ms p50, ~12 ms p99
Kafka, acks=1, batch full of small msgs:                 ~250 µs amortized
Google Pub/Sub, gRPC streaming pull:                       ~5 ms p50, ~40 ms p99
```

The 10 000× gap between in-process and brokered is the load-bearing fact of this chapter. A brokered topic costs as much as a database write — because under durability it *is* a database write.

### 2.3 Serialization and the publish budget

| Format | Encode (1 KB) | Decode | Wire size vs JSON | Schema |
|---|---|---|---|---|
| `encoding/json` | ~1.8 µs | ~3.5 µs | 1.0× | Untyped |
| `vmihailenco/msgpack` | ~0.6 µs | ~0.9 µs | 0.7× | Untyped |
| `protoc-gen-go` | ~0.3 µs | ~0.5 µs | 0.5× | `.proto` |
| Avro (`hamba/avro`) | ~0.4 µs | ~0.6 µs | 0.45× | `.avsc` + registry |
| FlatBuffers | ~0.2 µs | 0 µs (in-place) | 0.6× | `.fbs` |

For >100 k msg/s per topic, protobuf or Avro pay for themselves in bytes and CPU. For <1 k/s control events, JSON is fine. Mixing within one topic is a maintenance disaster — one format per topic, versioned. At 50 k events/s the producer budget is ~1 µs/event synchronous (struct + marshal + compression) plus an asynchronous ack pipeline. Beyond that means unbatched publishes or synchronous acks — both fixable.

---

## 3. Backpressure models — pull vs push, prefetch tuning

Backpressure answers "what does a slow consumer do to a fast producer?" Get it wrong and the broker is the unbounded queue.

**Pull (Kafka, JetStream pull).** Consumer requests N messages; backpressure is automatic.

```go
cl, _ := kgo.NewClient(
    kgo.SeedBrokers("kafka-0:9092"),
    kgo.ConsumerGroup("orders-fraud"),
    kgo.ConsumeTopics("orders"),
    kgo.FetchMaxBytes(1<<20),                    // bytes-based prefetch
    kgo.FetchMaxWait(50*time.Millisecond),
)
for {
    fetches := cl.PollFetches(ctx)               // backpressure lives here
    fetches.EachRecord(func(r *kgo.Record) { handle(r) })
}
```

**Push (NATS Core, RabbitMQ basic.consume).** Broker delivers as fast as it can; backpressure is the in-flight cap plus TCP flow control.

```go
sub, _ := js.PullSubscribe("orders.*", "fraud",
    nats.MaxAckPending(256),
    nats.AckWait(30*time.Second),
)
```

**Prefetch tuning — the only formula you need.** Apply Little's Law to the consumer: `prefetch ≈ 2·λ·W`. A 50 ms handler at 200 msg/s needs prefetch ≈ 20. Setting it to 1000 creates a 50-second head-of-line block when one message is slow.

| Pathology | Cause | Fix |
|---|---|---|
| Head-of-line stall | Slow message holds N-1 others | Lower prefetch; separate slow topic |
| Idle consumer with backlog | Prefetch = 1 starves network | Raise to `2λW` |
| Memory blowup | Prefetch holds large messages in RAM | Bytes-based prefetch |
| Uneven partition load | Static assignment | Cooperative-sticky balancer |

**Per-key concurrency.** Process N keys concurrently within a partition while preserving per-key order:

```go
type KeyedWorker struct {
    queues map[string]chan *kgo.Record
    mu     sync.Mutex
}
func (k *KeyedWorker) Dispatch(r *kgo.Record) {
    k.mu.Lock(); defer k.mu.Unlock()
    ch, ok := k.queues[string(r.Key)]
    if !ok {
        ch = make(chan *kgo.Record, 32)
        k.queues[string(r.Key)] = ch
        go k.worker(ch)
    }
    ch <- r
}
```

This preserves the only ordering guarantee that matters (per-key) and exploits the easy parallelism (cross-key).

---

## 4. Idempotency at the subscriber — dedup store, idempotency key

At-least-once is the default for every production broker. *Every consumer must be idempotent.* The publisher cannot fix this for you.

| Duplicate source | Mitigated by |
|---|---|
| Producer retry on transient error | Idempotent producer (Kafka `enable.idempotence=true`) |
| Broker rebalance | Cooperative rebalance; shorter session timeouts |
| Consumer crashed before committing offset | Idempotent handler |
| Network partition double-ack | Idempotent handler |
| Operator-driven replay | Idempotent handler |

Idempotency lives in the consumer. Every event must carry a stable producer-assigned identifier — either a UUID v7 (monotonic, embeds timestamp) or a **deterministic hash of business state** (`sha256(order_id || version)`). The second is stronger: two duplicate publishes of the same logical event collapse to one key even when the producer retried after a timeout that had succeeded.

A dedup store records "I have processed key X" with expiry:

| Store | Lookup latency | Best for |
|---|---|---|
| In-memory LRU + bloom | <1 µs | Stateless consumers, window ~minutes |
| Redis `SET key NX EX <ttl>` | ~0.3 ms | Multi-instance consumers, window ~hours |
| DB table with unique constraint on `idempotency_key` | ~1 ms | Already writing to a DB; same tx |

The third is the most powerful — the side effect and the dedup are atomic:

```go
func handleOrderCreated(ctx context.Context, db *pgxpool.Pool, ev Event) error {
    tx, err := db.Begin(ctx)
    if err != nil { return err }
    defer tx.Rollback(ctx)

    _, err = tx.Exec(ctx,
        `INSERT INTO processed_events (idempotency_key, event_type, processed_at)
         VALUES ($1, $2, now()) ON CONFLICT (idempotency_key) DO NOTHING`,
        ev.IdempotencyKey, ev.Type)
    if err != nil { return err }

    if _, err := tx.Exec(ctx,
        `INSERT INTO orders (id, customer_id, total_cents) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO NOTHING`,
        ev.OrderID, ev.CustomerID, ev.TotalCents); err != nil { return err }

    return tx.Commit(ctx)
}
```

If the consumer crashes between ack and DB commit, the next delivery re-runs the transaction and the `ON CONFLICT` makes both steps no-ops. The handler is idempotent **by construction**, not by inspection. This is the only pattern that survives audit. Retention is bounded — typically 7 days; operators replaying older data use a separate consumer group.

---

## 5. Outbox pattern revisited — DB → broker reliable publish

The most common production bug in event-driven services: the database transaction commits and the publish fails (or vice versa). They are not in the same transaction. The outbox pattern makes the broker eventually-consistent with the database; the database is truth.

```go
// WRONG — two systems, no atomicity
func placeOrder(ctx context.Context, db *pgxpool.Pool, broker Publisher, o Order) error {
    if err := db.QueryRow(ctx, "INSERT INTO orders ...").Scan(&o.ID); err != nil { return err }
    return broker.Publish(ctx, "order.created", o) // crash here = silent loss
}
```

The outbox table:

```sql
CREATE TABLE outbox (
    id              BIGSERIAL PRIMARY KEY,
    aggregate_type  TEXT NOT NULL,
    aggregate_id    TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    headers         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ
);
CREATE INDEX outbox_unpublished_idx ON outbox(id) WHERE published_at IS NULL;
```

Producer code is one transaction; a separate publisher reads unpublished rows and marks them published only after broker ack:

```go
func (p *OutboxPublisher) tick(ctx context.Context) error {
    rows, _ := p.db.Query(ctx,
        `SELECT id, event_type, payload, headers FROM outbox
         WHERE published_at IS NULL ORDER BY id LIMIT 200
         FOR UPDATE SKIP LOCKED`)
    defer rows.Close()
    for rows.Next() {
        var id int64; var typ string; var payload, hdr []byte
        rows.Scan(&id, &typ, &payload, &hdr)
        if err := p.broker.Publish(ctx, typ, payload, hdr); err != nil { return err }
        p.db.Exec(ctx, `UPDATE outbox SET published_at = now() WHERE id = $1`, id)
    }
    return nil
}
```

`FOR UPDATE SKIP LOCKED` lets multiple publishers coexist without coordinating. `ORDER BY id` preserves per-aggregate order because aggregate events are written in one transaction.

| Approach | Latency | Operational cost |
|---|---|---|
| Polling outbox publisher | 50–500 ms | Low — a goroutine |
| CDC (Debezium reading WAL) | 10–50 ms | High — Kafka Connect, schema registry, WAL slot management |

Polling is sufficient for most services; CDC is for shops already running Kafka Connect. Prune the table daily (`published_at < now() - interval '7 days'`); partition by day above tens of millions of rows.

---

## 6. CloudEvents spec — header conventions, traceparent

Every team that emits events invents its own envelope; the result is `data`, `payload`, `body`, `event` across services. **CloudEvents** (CNCF) is the only widely adopted standardization. Adopt it on day one.

```json
{
  "specversion": "1.0",
  "id": "e1b8e7e2-3a4d-4f8a-9b2c-1234567890ab",
  "source": "/orders/api",
  "type": "com.example.order.created.v1",
  "datacontenttype": "application/json",
  "subject": "order/42",
  "time": "2026-05-28T14:23:09Z",
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  "data": { "order_id": 42, "customer_id": 1001, "total_cents": 4999 }
}
```

`specversion`, `id`, `source`, `type` are mandatory. `type` should be `<reverse-dns>.<aggregate>.<verb>.<version>`. The `v1` suffix is not optional — the day you need `v2`, every consumer must be able to filter. Without a version, you are renaming the topic.

`traceparent` carries the W3C trace context. Set it on every publish:

```go
func publishWithTrace(ctx context.Context, broker Publisher, ev *cloudevents.Event) error {
    if sc := trace.SpanFromContext(ctx).SpanContext(); sc.IsValid() {
        ev.SetExtension("traceparent",
            fmt.Sprintf("00-%s-%s-%02x", sc.TraceID(), sc.SpanID(), sc.TraceFlags()))
    }
    return broker.Publish(ctx, ev)
}
```

On the consumer side, *restore* the trace context before invoking the handler:

```go
func consume(ctx context.Context, ev *cloudevents.Event, handler Handler) error {
    if tp, ok := ev.Extensions()["traceparent"].(string); ok {
        if sc, err := parseTraceparent(tp); err == nil {
            ctx = trace.ContextWithRemoteSpanContext(ctx, sc)
        }
    }
    ctx, span := tracer.Start(ctx, "consume."+ev.Type())
    defer span.End()
    return handler(ctx, ev)
}
```

The result is a single trace spanning publisher → broker → all consumers. Headers carry metadata (routing, dedup keys, trace IDs); payload carries the business event. Mixing them — `payload.trace_id` or `headers.customer_email` — couples consumers to fields they should not need.

---

## 7. Schema registry — Confluent, Apicurio, Buf

Without a registry, schemas live in tribal knowledge. The day a producer renames `customer_id` to `customer_uuid`, every consumer breaks silently.

| Registry | Format support | Best for |
|---|---|---|
| Confluent Schema Registry | Avro, JSON Schema, Protobuf | Kafka shops, hosted or self-host |
| Apicurio | Avro, JSON Schema, Protobuf, GraphQL, OpenAPI, AsyncAPI | Self-hosted, broader formats |
| Buf Schema Registry | Protobuf only | Go services with Protobuf; strong CI |

Compatibility modes (Confluent semantics):

| Mode | Producers can | Consumers must |
|---|---|---|
| Backward | Add optional fields; remove required | Read new with old code |
| Forward | Remove optional; add required | Read old with new code |
| Full | Both | Both |
| None | Anything | Cope |

**Backward** is the safe default; **Full** is required for public events outside your control. Confluent's wire format prefixes the payload with a magic byte and 4-byte schema ID:

```
[0x00][schema_id:int32 BE][avro_payload...]
```

The consumer fetches schema `schema_id` (cached locally), decodes, runs. The consumer can read every version ever written with zero coordination. The single most valuable feature is the **CI breaking-change check**:

```yaml
- run: buf breaking --against 'https://github.com/example/protos.git#branch=main'
```

A PR that breaks consumers' decoders is rejected before merge. No registry without this CI gate is worth the operational burden of the registry itself.

---

## 8. Multi-tenancy — topic namespacing, ACLs, rate limits

A multi-tenant Pub/Sub system is one broker cluster shared by N tenants. Without discipline, one tenant's runaway producer drowns the others.

| Strategy | Topic name | Pros | Cons |
|---|---|---|---|
| Per-tenant topic | `tenant-42.orders.created` | Hard isolation, per-tenant ACL | Topic explosion (>10 k tenants) |
| Per-tenant partition | `orders.created`, key=`tenant_id:order_id` | One topic, per-tenant order | Bad tenant slows partition |
| Tenant prefix on header | `orders.created`, header `tenant=42` | Simple, scalable | Easy to forget filter; weak isolation |

The practical compromise: **per-tenant topic for high-value tenants (>1% of traffic), shared with header filter for the long tail.** Kafka degrades around 200 k partitions per cluster.

ACLs enforce that **a producer can write only its own tenant's topics; a consumer can read only its own.** The broker enforces this, not the application:

```bash
kafka-acls --add --allow-principal User:tenant-42 \
    --operation Write --topic 'tenant-42.*' --resource-pattern-type prefixed
```

Quotas throttle a noisy tenant at the broker, not the consumer. Kafka has per-client-ID byte rates; NATS has account-level limits; Google Pub/Sub has per-topic quotas. Set per-tenant quotas at contracted throughput plus 2× burst. The 100th-percentile tenant should not consume >5% of cluster bandwidth. The schema registry must also be tenant-aware — Confluent RBAC and Apicurio group scoping handle this.

---

## 9. Observability deep dive — consumer lag, redelivery rate, p99 end-to-end

| Metric | Type | Why it matters |
|---|---|---|
| `publish_latency_seconds` | Histogram | Producer-side health; spikes precede consumer spikes |
| `consumer_lag_messages` / `consumer_lag_seconds` | Gauge | The single most important metric — backlog growth |
| `consumer_redelivery_rate` | Counter ratio | Idempotency / poison-pill health |
| `end_to_end_latency_seconds` | Histogram | `consumer_received_time - event_time` — what users feel |

```go
var (
    publishLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name: "pubsub_publish_seconds",
        Buckets: prometheus.ExponentialBuckets(0.0001, 4, 12),
    }, []string{"topic"})
    consumerLag = prometheus.NewGaugeVec(prometheus.GaugeOpts{
        Name: "pubsub_consumer_lag"}, []string{"topic", "group", "partition"})
    e2eLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name: "pubsub_end_to_end_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 4, 14),
    }, []string{"topic", "group"})
)
```

**Lag in messages vs seconds.** Brokers report messages-behind natively. Users feel seconds. If the producer slows down, messages shrink while seconds grow. **Alert on seconds, plot both.**

```promql
# Backlog growing
deriv(kafka_consumergroup_lag{group="orders-fraud"}[10m]) > 0
  and kafka_consumergroup_lag{group="orders-fraud"} > 1000

# End-to-end p99 SLA
histogram_quantile(0.99,
  sum(rate(pubsub_end_to_end_seconds_bucket[5m])) by (le, topic, group)) > 5.0

# Redelivery storm — poison-pill or bad handler
rate(pubsub_redeliveries_total[5m]) > 10
```

`traceparent` headers (§6) give per-event traces across publisher and all consumers. Add span attributes for broker offset and consumer group; investigators find every consumer's view of one event in one query.

---

## 10. Failure modes — split-brain, broker partition, replay storms

**Broker partition / split-brain.** A Kafka controller failover or NATS JetStream quorum loss produces a window where producers and consumers see inconsistent metadata. Producers get `NotLeaderForPartition` and retry; consumers may receive duplicates across rebalance; committed offsets in the window may not survive. Defense is operational: idempotent producers, idempotent consumers (§4), and operators monitoring `under_replicated_partitions` and `controller_health`.

**Replay storms.** An operator runs `kafka-consumer-groups --reset-offsets --to-earliest` to debug a one-message bug; the group re-processes 30 days; the database is overwhelmed; downstream services slow. Has happened at every Kafka-using company. Defenses:

1. **Rate-limited replay.** Consumer-side throttle per partition.
2. **Separate consumer group for replays.** Never reset the live group.
3. **Replay-aware handlers.** Some side effects (sending email) must not be replayed:

```go
const replayCutoff = "2026-05-25T00:00:00Z"
func (h *EmailHandler) Handle(ctx context.Context, ev *Event) error {
    cutoff, _ := time.Parse(time.RFC3339, replayCutoff)
    if ev.Time.Before(cutoff) { return nil } // replay; skip side effect
    return h.send(ctx, ev)
}
```

**Poison pill.** A malformed event makes the handler throw, redeliver, re-throw forever. The partition stops. Bounded redelivery → dead-letter topic:

```go
func (c *Consumer) handle(ctx context.Context, ev *Event) error {
    if ev.DeliveryCount > 5 {
        return c.dlq.Publish(ctx, "orders.created.dlq", ev,
            map[string]string{"reason": "max_redeliveries"})
    }
    return c.handler(ctx, ev)
}
```

A DLQ nobody reads is a leak; assign owners and SLAs.

**Zombie consumers.** A consumer loses network past the session timeout; the broker rebalances; network recovers; the zombie tries to commit offsets it no longer owns. With cooperative rebalance and idempotent commits, this is a no-op; with eager rebalance and naive code, you get phantom commits and redeliveries. Use `kgo.CooperativeStickyBalancer()` or `partition.assignment.strategy=cooperative-sticky`.

**Slow-fast skew.** One instance in a group is on a slow VM; its partitions back up while others run fine. Monitor per-partition lag, not just per-group. Alert when one partition's lag is >5× the median.

---

## 11. Security — encryption at rest, TLS, mTLS, signed events

Every broker supports TLS. The defaults in Kafka, NATS, Rabbit, and Redis are plaintext; the burden is on you to flip the switch. mTLS authenticates the client to the broker with a cert — preferable to passwords because rotation is automated by cert-manager.

```go
tlsCfg := &tls.Config{
    Certificates: []tls.Certificate{cert},
    RootCAs:      caPool,
    MinVersion:   tls.VersionTLS13,
}
cl, _ := kgo.NewClient(
    kgo.SeedBrokers("kafka-0:9093"),
    kgo.DialTLSConfig(tlsCfg),
    kgo.SASL(scram.Auth{User: "...", Pass: "..."}.AsSha512Mechanism()),
)
```

**Encryption at rest.** Filesystem-level (LUKS, dm-crypt) protects against disk theft, not a compromised broker. **Application-level** encryption is the strongest answer for PII — encrypt the payload before publish; only consumers with the key can read. Use envelope encryption: a per-event data key encrypts the payload; the data key is KMS-wrapped and carried in headers.

```go
type EncryptedPayload struct {
    EncryptedKey []byte `json:"k"` // KMS-wrapped DEK
    Nonce        []byte `json:"n"`
    Ciphertext   []byte `json:"c"` // AES-GCM
}
```

**Signed events.** For events crossing trust boundaries (B2B, partner integrations), payloads should be signed by the producer's key; consumers verify before processing. Signature lives in headers (`signature: <base64>`, `signature-key-id: <kid>`); the public key is fetched from a JWKS endpoint. An unsigned event from a "trusted" partner is one DNS hijack away from compromise.

**PII / right-to-be-forgotten.** GDPR/CCPA require deletion on request; long-retention topics conflict. Two answers: **crypto-shredding** (encrypt PII with a per-subject key; deletion = throwing away the key; ciphertext remains in the log but is irrecoverable), or **short retention + dedicated PII topics**. Crypto-shredding is the only approach handling 7-year audit retention for non-PII fields with month-scale PII retention in the same stream.

---

## 12. Anti-patterns at scale + closing

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Publish-success = side-effect-success | Consumers never react; producer DB has the row | Outbox pattern (§5) |
| No consumer idempotency | Duplicate emails, double charges | Idempotency key + dedup store (§4) |
| Schemas in tribal knowledge | Renaming a field silently breaks consumers | Registry with CI breaking-change gate (§7) |
| One topic per "thing that happened" | Topic count in tens of thousands | Aggregate-typed topics; subject filtering |
| Prefetch "as high as possible" | Head-of-line blocking | Tune to `2λW` (§3) |
| No DLQ | Poison pill stalls a partition forever | Bounded redelivery → DLQ → operator review |
| Sync publish on every request | Producer p99 mirrors broker p99 | Batched async; outbox for durability |
| Cross-service ordering assumptions | "But A's event arrived before B's" — no | Order is per-partition; design for eventual consistency |
| Commit before handler success | Lost messages on crash | Commit after side effect commits |
| No `traceparent` propagation | Debugging takes hours | Propagate W3C trace context (§6) |
| Plaintext broker traffic | Sniffable PII; broker pwn = company pwn | TLS mandatory; mTLS preferred (§11) |
| Long-retention PII topics | GDPR deletion needs log rewrite | Crypto-shredding or short retention |
| Replay against the live group | Replay flood overwhelms downstream | Separate replay group; rate-limit; time-cutoff handlers (§10) |
| No per-tenant quotas in shared cluster | One tenant's bug drowns every other tenant | Broker-level quotas (§8) |
| Broker as system of record | Lost a topic = lost the business | DB is truth; broker is transport |
| Headers bleeding into payload | Consumers coupled to producer routing concerns | Headers for routing/metadata; payload for the event |
| Synchronous chained Pub/Sub | `A → B → C → D`, each blocking | Use RPC for sync; Pub/Sub is for fan-out |

The deepest anti-pattern: **using Pub/Sub as glue between services that should not be coupled at all.** A "let's just emit an event" without a written subscriber list is technical debt that accrues silently — three months later, deleting the event breaks something nobody remembers. Every event type needs a documented contract, set of consumers, and deprecation policy. The pattern is not the discipline.

### Closing principles

A Pub/Sub system is a contract: producers promise events that mean what they say; consumers promise idempotent reaction; the broker promises at-least-once delivery and best-effort order. Honor all three.

1. **The producer's database is truth; the broker is transport.** If the broker loses messages, replay from the database. If the database loses rows, no broker can save you. Outbox is not optional — it is what makes the producer-side honest.
2. **Idempotency is the consumer's only correctness invariant.** At-least-once is the only guarantee that scales; every consumer must be designed for it. Idempotency key (§4.2) and dedup store (§4.3) are not nice-to-have observability — they are the only thing between you and duplicate charges.
3. **Schemas are contracts; CI is enforcement.** A schema registry without a breaking-change CI gate is a wiki page nobody reads. With it, an entire class of incident becomes a PR comment.
4. **Observe lag in seconds, not just messages.** Users feel latency; messages-behind lies during throughput dips. End-to-end histograms tell you what the customer sees.
5. **Replay is a first-class operation.** Design topics with replay in mind: idempotent handlers, time-cutoffs on side effects, separate consumer groups for replays. The day you need to debug a week-old bug, you won't have time to add these.
6. **Security is the default, not the upgrade.** Plaintext broker traffic, unsigned cross-trust events, and infinite-retention PII topics are open issues with a clock.
7. **Multi-tenancy requires broker-enforced isolation.** ACLs, quotas, per-tenant topics or partitions are the only defense against the noisy-neighbor incident that takes down every customer at once.

Get these right and Pub/Sub becomes invisible: producers publish, consumers react, traces light up across the system, the dashboard says lag is 12 seconds and stable. Get them wrong and the broker is the on-call incident — every consumer at lag 800 000, the producer still emitting because the database is fine, and the only fix is to drain the topic with a parallel consumer group while you figure out which deploy introduced the poison pill that has been replaying for two hours.

---

## Further reading

- Martin Kleppmann, *Designing Data-Intensive Applications*, chapters 9 and 11
- Jay Kreps, *The Log: What every software engineer should know about real-time data's unifying abstraction*
- CloudEvents 1.0 — https://github.com/cloudevents/spec
- W3C Trace Context — https://www.w3.org/TR/trace-context/
- Confluent Schema Registry — https://docs.confluent.io/platform/current/schema-registry/
- Buf Schema Registry — https://buf.build/docs/bsr/introduction
- Debezium — https://debezium.io
- `twmb/franz-go` — https://github.com/twmb/franz-go
- NATS JetStream — https://docs.nats.io/nats-concepts/jetstream
- `cloudevents/sdk-go` — https://github.com/cloudevents/sdk-go
- Chris Richardson, *Microservices Patterns* — outbox and saga chapters
- Gwen Shapira et al., *Kafka: The Definitive Guide* (2nd ed.)
- Sam Newman, *Building Microservices* (2nd ed.), chapter 4
- Tyler Treat, *You Cannot Have Exactly-Once Delivery* — https://bravenewgeek.com/you-cannot-have-exactly-once-delivery/
