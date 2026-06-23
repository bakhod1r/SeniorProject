# Pub/Sub — Senior

## 1. Mental model — Pub/Sub as decoupling primitive vs RPC

At senior level Pub/Sub stops being "channels with multiple readers" and becomes a **topology choice — it inverts the dependency direction between producer and consumer**. RPC says "A knows B and calls B". Pub/Sub says "A emits a fact; whoever cares listens". Transport (channels, NATS, Kafka) is downstream of that choice.

The right question is never "channels or Kafka" — it is "should this be a request or an event?"

| Property | RPC (sync) | Pub/Sub (async) |
|----------|------------|-----------------|
| **Coupling** | Caller knows callee identity, signature, availability | Producer knows only a topic name |
| **Latency** | Round-trip; backpressure visible to caller | Fire-and-forget; backpressure invisible to producer |
| **Failure surface** | Caller sees callee errors immediately | Producer succeeds; consumers may fail silently |
| **Evolution** | Both sides upgrade together | Producer adds fields without telling consumers |
| **Reasoning** | Stack traces span the call | Causality reconstructed from logs/traces |

Pub/Sub where RPC fits gives eventual consistency in places that should be transactional — `OrderPlaced` published but `InventoryReserved` never lands. RPC where Pub/Sub fits gives a service graph where one outage takes down five — `payment-service` calls `audit-service` synchronously, audit goes down, payments stop.

The heuristic: **RPC when the caller needs the result to make a decision; Pub/Sub when the caller is announcing that something happened**. `GetUser(id)` is a question; `UserSignedUp{id, email}` is a fact. Pub/Sub also shifts the unit of evolution from versioned endpoints to schema discipline — breaking the schema breaks every consumer silently, so **Pub/Sub demands schema rigor that RPC does not** (§6).

---

## 2. Channel internals — `hchan` struct, send/receive cost, copy vs share

In-process Pub/Sub rides on channels. `runtime.hchan` is the structure under every `chan T`:

```go
// src/runtime/chan.go (paraphrased)
type hchan struct {
    qcount   uint           // items currently buffered
    dataqsiz uint           // size of the circular buffer
    buf      unsafe.Pointer // array of dataqsiz elements
    elemsize uint16
    closed   uint32
    sendx, recvx uint       // ring indices
    recvq, sendq waitq      // parked goroutines
    lock     mutex
}
```

A channel is a circular buffer plus two waiter queues under a `mutex`. There is **no lock-free path** — every send and receive acquires `hchan.lock`. A broker with 100 subscribers at 10k publishes/s costs 1M mutex ops/s on those channels.

| Operation | Cost | Why |
|-----------|------|-----|
| Unbuffered send with waiter | ~70 ns | Direct goroutine handoff via `recvq` |
| Buffered send, slot free | ~25 ns | Lock + copy into `buf` + unlock |
| Buffered send, slot full | ~150 ns + park | Sleep on `sendq`; scheduler resume |
| `select` with N ready cases | O(N) | Random ordering across branches |

**Direct send.** When an unbuffered send finds a parked receiver in `recvq`, the runtime copies straight from sender stack to receiver stack — no heap, no buffer, one copy. An unbuffered channel with a hot, always-ready subscriber is the cheapest fan-out shape.

**Copy vs share.** `hchan` copies `elemsize` bytes per delivery. A 1 KB struct broadcast to 1000 subscribers is **1 MB of memcpy per publish**. The rule: **send pointers above a few cache lines, document immutability, and never accept pooled pointers in Pub/Sub** — coordinating "when can I `Put` this back" across N independent subscribers is a recipe for use-after-free.

**`select` fairness.** `select` randomizes among ready cases via `runtime.fastrandn` — not fair across publishes. For load balancing across workers use a single shared channel (the queue shape from middle §4), not `select` over per-worker channels.

---

## 3. Real ecosystem

Six clients dominate Go Pub/Sub work. Each has a single sharp characteristic worth knowing.

**`nats.go` (NATS Core).** At-most-once, no durability, sub-millisecond latency, subject hierarchies (`orders.us.created`, wildcards `*` and `>`). Senior detail: `nc.Drain()` not `nc.Close()` on shutdown — drain processes in-flight messages; close drops them.

**NATS JetStream.** Persistence on top of NATS. At-least-once by default, exactly-once via `Nats-Msg-Id` header (producer dedup), replay by sequence or time. Pull consumers give the app control over rate.

```go
cons, _ := stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
    Durable: "shipping", AckPolicy: jetstream.AckExplicitPolicy,
    AckWait: 30 * time.Second, MaxDeliver: 5,
})
iter, _ := cons.Messages(jetstream.PullMaxMessages(100))
for {
    msg, err := iter.Next()
    if err != nil { break }
    if err := handle(msg.Data()); err != nil { msg.Nak(); continue }
    msg.Ack()
}
```

**`segmentio/kafka-go`.** Idiomatic Go Kafka client — context-aware, explicit `FetchMessage`/`CommitMessages`. The trap: `CommitInterval > 0` enables auto-commit and breaks at-least-once. Keep it at 0 and commit by hand.

```go
r := kafka.NewReader(kafka.ReaderConfig{
    Brokers: []string{"kafka:9092"}, GroupID: "shipping",
    Topic: "orders", CommitInterval: 0,
})
for {
    m, err := r.FetchMessage(ctx)
    if err != nil { return err }
    if err := handle(m); err != nil { continue } // do NOT commit
    r.CommitMessages(ctx, m)
}
```

**`IBM/sarama`.** Older, larger, tracks Kafka features more closely (transactions, idempotent producers, KIP-848). Heavier API — `ConsumerGroupHandler` with `Setup`/`Cleanup`/`ConsumeClaim`. Reach for `sarama` when you need transactions or features `kafka-go` lacks; otherwise `kafka-go`.

**Redis Streams (`redis/go-redis/v9`).** At-least-once, in-memory (AOF/RDB optional), single-server (Cluster shards but no cross-shard order), cheap. `XADD` produces; `XREADGROUP` + `XACK` consume. Fits task queues and light streams in apps already on Redis.

**Google Cloud Pub/Sub.** Managed, at-least-once (exactly-once on opt-in subscriptions), gRPC streaming pull with flow control. `ReceiveSettings.MaxOutstandingMessages` and ack deadline together determine throughput; misconfigure either and you get redeliveries or stalled subscriptions.

| Need | Reach for |
|------|-----------|
| Sub-ms, OK to lose | NATS Core |
| Durable stream, replay, modest scale | JetStream |
| Multi-TB/day, partition ordering | Kafka (kafka-go) |
| Already in Redis, light streaming | Redis Streams |
| Managed cloud, autoscaling | Google Cloud Pub/Sub |

---

## 4. Delivery semantics deep dive

**At-most-once.** Producer publishes, broker may lose, consumer may crash mid-handler. No retries, no acks. Every message can vanish. Fits telemetry, presence, signals where the next message supersedes the last. NATS Core, UDP, in-process `select { default: }`.

**At-least-once.** Consumer acks; unacked redelivers. **Handlers must be idempotent** — the same message arrives twice during retries, rebalances, restarts.

```go
func handle(ctx context.Context, m Message) error {
    inserted, err := db.InsertIfAbsent(ctx, "processed", m.ID)
    if err != nil { return err }
    if !inserted { return nil } // already processed
    return doWork(ctx, m)
}
```

**At-least-once + idempotency = effectively-once for the system.** This is what 95% of production pipelines do, regardless of broker claims. Broker's job: durability. Consumer's job: dedup.

**Exactly-once.** True end-to-end exactly-once requires publish, broker storage, and consumer commit to be one atomic operation.

| Broker | Mechanism | Catch |
|--------|-----------|-------|
| **Kafka** | Idempotent producer + transactional producer + `read_committed` consumer | Only within Kafka; writing to Postgres breaks it unless you 2PC |
| **JetStream** | `Nats-Msg-Id` producer dedup; double-ack | Same boundary problem |
| **GCP Pub/Sub** | Subscription flag; 10-minute dedup window | Past 10 minutes, redelivery possible |

**Exactly-once across the broker boundary is folklore.** The moment a message leaves the broker into your database or downstream API you are back to at-least-once unless you implement the **transactional outbox**:

```text
In one DB transaction:
  1. Mark inbox event as processed (UNIQUE(msg_id))
  2. Apply the business effect
  3. Insert outgoing events into outbox table
A separate worker reads outbox and publishes to broker.
```

| Mode | Loss | Duplication | When |
|------|------|-------------|------|
| **At-most-once** | Yes | No | Telemetry, presence |
| **At-least-once + idempotent consumer** | No | No (deduped) | 95% of production |
| **Kafka transactional read+write** | No | No (in Kafka only) | Stream processing |
| **Outbox + idempotent consumer** | No | No (end-to-end) | Mission-critical pipelines |

---

## 5. Ordering and partitioning

**No production broker gives global order at scale.** Ordering is always scoped — to a partition, stream, queue, or key.

### 5.1 Kafka partitions

A topic is N partitions; each is an append-only log. Within a partition: strict order. Across partitions: no order at all. Partition is `hash(key) % numPartitions`.

```go
w := &kafka.Writer{
    Addr: kafka.TCP("kafka:9092"), Topic: "orders",
    Balancer: &kafka.Hash{},
}
w.WriteMessages(ctx, kafka.Message{Key: []byte(orderID), Value: payload})
```

If `key = order_id`, all messages for one order stay ordered. If `key = nil`, the producer round-robins — `order.created` and `order.shipped` can land on different partitions and arrive out of order.

Three senior consequences:

1. **Pick the partition key from the entity that must stay ordered.** `order_id` for order events, `user_id` for user activity. Never the timestamp.
2. **Adding partitions later changes the hash.** Going from 12 to 24 partitions rehashes everything. Plan partitions for peak load up front.
3. **Hot keys serialize.** If 80% of traffic is one customer, that partition runs at 80% load and the rest sit idle. That is a partitioning failure, not a Kafka problem.

### 5.2 NATS subject hierarchies

Dot-separated tokens: `orders.us.california.42`. Wildcards: `*` (one token), `>` (one or more).

| Subscription | Matches |
|--------------|---------|
| `orders.us.california.*` | One token after `california` |
| `orders.us.>` | One or more tokens after `us` |

**Encode routing in the subject, not the payload.** `orders.us.created` instead of `orders` + a `region` field — consumers filter at the broker. The cost is rigidity: adding a token means coordinating with subscribers that wildcard near that position.

### 5.3 Ordered consumers everywhere

Even when the broker guarantees per-partition order, **the consumer can re-disorder**. The broken pattern: `go handle(msg)` after each `FetchMessage` — concurrent dispatch races and the commit ordering corrupts. Fix: one goroutine per partition, sequential processing.

```go
workers := map[int]chan kafka.Message{}
for {
    m, _ := r.FetchMessage(ctx)
    ch, ok := workers[m.Partition]
    if !ok {
        ch = make(chan kafka.Message, 16)
        workers[m.Partition] = ch
        go func() {
            for msg := range ch {
                handle(msg)
                r.CommitMessages(ctx, msg)
            }
        }()
    }
    ch <- m
}
```

The rule: **parallelism scales by partitions, not by goroutines per partition**.

---

## 6. Schema and versioning

Producers and consumers deploy at different times. The schema lives between them. Without discipline, Pub/Sub becomes a graveyard of "I added a field and nothing reads it" or "I renamed a field and 4 services crashed at 3 AM".

### 6.1 CloudEvents

CloudEvents (CNCF) is a transport-agnostic envelope. The `cloudevents/sdk-go` library:

```go
e := cloudevents.NewEvent()
e.SetID(uuid.NewString())
e.SetSource("orders-service")
e.SetType("com.example.order.created.v1") // version in the type
e.SetSubject(orderID)
e.SetData(cloudevents.ApplicationJSON, payload)
client.Send(ctx, e)
```

The envelope (`id`, `source`, `type`, `time`, `subject`, `datacontenttype`) is identical across HTTP, Kafka, NATS, MQTT. **Encode the version in `type`.** New version = new type = new consumer code path. No silent breakage.

### 6.2 Protobuf forward/backward

| Change | Backward | Forward |
|--------|----------|---------|
| Add `optional` field | Yes | Yes (ignored) |
| Remove field (with `reserved`) | Yes | Risky |
| Change tag number | **No** | **No** |
| Make `optional` into `required` (proto2) | **No** | **No** |

**Never reuse a deleted tag, never change a tag, never tighten a constraint.** `reserved 4, 5;` after a deletion is mandatory:

```protobuf
message OrderCreated {
  string order_id = 1;
  string user_id = 2;
  int64 amount_cents = 3;
  reserved 4; // was 'currency_code' — removed in v2.3
  string currency = 5;
}
```

### 6.3 Schema registry

A registry (Confluent SR, Apicurio, Buf, AWS Glue) sits between producers and consumers. Each message carries a schema ID prefix; consumers fetch by ID and cache. Modes: `Backward` (producer adds optional, removes; consumers read new with old schema), `Forward`, `Full`. Most teams pick `Backward`. The registry rejects incompatible changes at publish time — producer fails to deploy rather than crashing consumers. **Catch breaking changes at CI, not at runtime.**

Three versioning strategies: **version in type/subject** (`orders.v1.created` vs `orders.v2.created`, producer fans out to both during migration — cleanest for breaking changes); **version in schema** (protobuf evolution, fine for additive); **adapter service** (new topic, old topic, adapter translates during migration). Never reuse a type name with a breaking schema change.

---

## 7. Generic typed broker

The middle file's broker is `Broker[T]` with topics. Production adds: per-subscriber policies, disconnect on slow consumers, injectable metrics, graceful shutdown.

```go
type Policy int
const (
    PolicyDrop       Policy = iota // drop on full
    PolicyBlock                    // block sender (with timeout)
    PolicyDisconnect               // drop sub after N consecutive drops
)

type SubOpts struct {
    Buffer        int
    Policy        Policy
    DropThreshold int           // PolicyDisconnect
    BlockTimeout  time.Duration // PolicyBlock
}

type Subscription[T any] struct {
    id     uint64
    topic  string
    opts   SubOpts
    ch     chan T
    drops  atomic.Int64
    closed atomic.Bool
}

type Metrics interface {
    Published(topic string)
    Delivered(topic string, sub uint64)
    Dropped(topic string, sub uint64)
    Disconnected(topic string, sub uint64)
}

type Broker[T any] struct {
    mu      sync.RWMutex
    subs    map[string]map[uint64]*Subscription[T]
    nextID  atomic.Uint64
    metrics Metrics
    closed  atomic.Bool
    wg      sync.WaitGroup
}

var ErrBrokerClosed = errors.New("pubsub: broker closed")

func (b *Broker[T]) Subscribe(ctx context.Context, topic string, opts SubOpts) (*Subscription[T], error) {
    if b.closed.Load() {
        return nil, ErrBrokerClosed
    }
    if opts.Buffer <= 0 { opts.Buffer = 16 }
    id := b.nextID.Add(1)
    s := &Subscription[T]{id: id, topic: topic, opts: opts, ch: make(chan T, opts.Buffer)}

    b.mu.Lock()
    if b.subs[topic] == nil {
        b.subs[topic] = make(map[uint64]*Subscription[T])
    }
    b.subs[topic][id] = s
    b.mu.Unlock()

    b.wg.Add(1)
    go func() {
        defer b.wg.Done()
        <-ctx.Done()
        b.removeSub(topic, id)
    }()
    return s, nil
}

func (b *Broker[T]) removeSub(topic string, id uint64) {
    b.mu.Lock()
    s, ok := b.subs[topic][id]
    if ok {
        delete(b.subs[topic], id)
        if len(b.subs[topic]) == 0 { delete(b.subs, topic) }
    }
    b.mu.Unlock()
    if ok && s.closed.CompareAndSwap(false, true) {
        close(s.ch) // exactly once
    }
}

func (b *Broker[T]) Publish(ctx context.Context, topic string, msg T) error {
    if b.closed.Load() { return ErrBrokerClosed }
    b.metrics.Published(topic)

    // Snapshot under read lock; deliver outside the lock.
    b.mu.RLock()
    targets := make([]*Subscription[T], 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        targets = append(targets, s)
    }
    b.mu.RUnlock()

    for _, s := range targets { b.deliver(ctx, s, msg) }
    return nil
}

func (b *Broker[T]) deliver(ctx context.Context, s *Subscription[T], msg T) {
    switch s.opts.Policy {
    case PolicyDrop:
        select {
        case s.ch <- msg: b.metrics.Delivered(s.topic, s.id)
        default:          s.drops.Add(1); b.metrics.Dropped(s.topic, s.id)
        }
    case PolicyBlock:
        ctx2, cancel := context.WithTimeout(ctx, s.opts.BlockTimeout)
        defer cancel()
        select {
        case s.ch <- msg:  b.metrics.Delivered(s.topic, s.id)
        case <-ctx2.Done(): s.drops.Add(1); b.metrics.Dropped(s.topic, s.id)
        }
    case PolicyDisconnect:
        select {
        case s.ch <- msg:
            b.metrics.Delivered(s.topic, s.id)
            s.drops.Store(0) // only consecutive drops count
        default:
            if n := s.drops.Add(1); int(n) >= s.opts.DropThreshold {
                b.metrics.Disconnected(s.topic, s.id)
                b.removeSub(s.topic, s.id)
            } else {
                b.metrics.Dropped(s.topic, s.id)
            }
        }
    }
}

func (b *Broker[T]) Shutdown(ctx context.Context) error {
    if !b.closed.CompareAndSwap(false, true) { return nil }
    b.mu.Lock()
    for topic, m := range b.subs {
        for _, s := range m {
            if s.closed.CompareAndSwap(false, true) { close(s.ch) }
        }
        delete(b.subs, topic)
    }
    b.mu.Unlock()

    done := make(chan struct{})
    go func() { b.wg.Wait(); close(done) }()
    select {
    case <-done:    return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
```

Key senior additions over middle: injectable `Metrics` interface; three policies first-class; `Shutdown` with timeout that waits on `wg`; atomic counters off the mutex hot path; **`CompareAndSwap` on `closed`** guarantees `close(ch)` runs exactly once even when context-cancel and shutdown race. Closing a closed channel panics; closing twice (once per path) is the most common in-process broker bug.

---

## 8. Observability — OpenTelemetry, Prometheus, structured logs

Pub/Sub fails by going silent — no error, no log, just stopped working. Three layers cover the gap.

**Trace propagation.** Every published message carries W3C Trace Context as headers (`traceparent`, `tracestate`). The consumer extracts it and starts a child span. The trace then spans the broker.

```go
// Producer
ctx, span := tracer.Start(ctx, "publish orders.created")
defer span.End()
headers := map[string]string{}
otel.GetTextMapPropagator().Inject(ctx, propagation.MapCarrier(headers))
writer.WriteMessages(ctx, kafka.Message{Key: key, Value: payload, Headers: toKafka(headers)})

// Consumer
ctx = otel.GetTextMapPropagator().Extract(ctx, propagation.MapCarrier(fromKafka(msg.Headers)))
ctx, span := tracer.Start(ctx, "consume orders.created")
defer span.End()
handle(ctx, msg)
```

Span attributes follow OTel messaging conventions: `messaging.system`, `messaging.destination.name`, `messaging.kafka.partition`, `messaging.message.id`. Jaeger/Tempo/Honeycomb show one trace crossing producer + broker + consumer.

**Prometheus metrics.**

| Metric | Type | Labels |
|--------|------|--------|
| `pubsub_published_total` | counter | topic |
| `pubsub_delivered_total` | counter | topic, subscriber |
| `pubsub_dropped_total` | counter | topic, subscriber, reason |
| `pubsub_consume_duration_seconds` | histogram | topic, subscriber |
| `pubsub_subscriber_lag` | gauge | topic, subscriber |
| `pubsub_handler_errors_total` | counter | topic, error_type |

The two metrics that catch silent failure: **lag** (broker queue depth or commit offset lag) and **handler duration p99**. Lag rising linearly means a consumer cannot keep up. p99 jumping from 50 ms to 5 s means the handler started doing synchronous I/O that used to be cached. Alert on lag above threshold for 5 min, p99 above SLO for 5 min, any drop rate, redeliveries above 5% of deliveries.

**Structured logs.** Every consumer log line carries `trace_id`, `topic`, `partition`/stream, `offset`/msg_id, `consumer_group`. Without these, debugging "this message caused a panic" means correlating timestamps across machines. `slog` (Go 1.21+) is the senior default — structured by construction, integrates with OTel via `slog.Handler` adapters.

**Poison message.** A message that crashes the handler every time. Without observability: consumer redelivers, lag climbs, throughput goes to zero. With observability: `handler_errors_total` rises and the same `offset` appears in every error log. The pattern: a **dead-letter topic** — after N failed redeliveries, publish to `<topic>.dlq` and ack the original. JetStream consumers set `MaxDeliver`; GCP has `DeadLetterPolicy`; Kafka you build yourself.

---

## 9. Failure modes

**Slow subscriber catastrophe.** A subscriber processing at 90% of publish rate slowly accumulates lag. After hours, the broker's disk fills, memory grows, or the in-process channel overflows. Then everything fails at once.

| Broker | Symptom |
|--------|---------|
| Kafka | Disk full; retention drops oldest; consumer skips ahead |
| JetStream | Stream hits `MaxBytes`; oldest dropped or producer rejected |
| Redis Streams | Memory full; OOM kill |
| In-process | Channel full; `PolicyDrop` silently loses, `PolicyBlock` stalls producer |

Defenses: bound everything (retention, stream size, channel buffer, in-flight); alert on **lag growth rate**, not lag value; **disconnect chronic slow subscribers** (`PolicyDisconnect`) — slow consumers should recover, not drag the broker down.

**Broker disconnect.** Network partition; TCP socket goes silent (no FIN, no RST). OS default keepalive waits ~2 hours before erroring. Defenses: TCP keepalive at 30 s idle / 5 s probe / 3 probes; client-level ping (NATS, Kafka `connections.max.idle.ms`); `context.WithTimeout` on every broker call; a separate health-check ping that takes the consumer out of rotation when it fails.

**Reconnect storm.** Broker restarts; 10,000 consumers reconnect at the same millisecond, overwhelm, fail, retry. Defense: **jittered exponential backoff**.

```go
func reconnectDelay(attempt int) time.Duration {
    base, max := time.Second, 30*time.Second
    d := base * (1 << attempt)
    if d > max { d = max }
    return d/2 + time.Duration(rand.Int63n(int64(d)/2))
}
```

The jitter is not optional — without it the storm just shifts in time. NATS, Kafka clients, and GCP do this internally; the failure mode shows up in hand-rolled consumers.

**Consumer rebalance storm.** Kafka rebalances on member join/leave; during rebalance, no consumer in the group makes progress. Perpetual rebalance happens when consumers heartbeat irregularly — usually because the handler blocks past `max.poll.interval.ms`. Defenses: decouple heartbeat from processing (kafka-go and modern sarama do this); bound handler duration; use cooperative-sticky rebalancing (KIP-848, Kafka 3.7+ default).

**Ack/commit semantic confusion.** The classic at-least-once bug: commit before processing.

```go
// WRONG: commit, then handler panic loses the message
m, _ := r.FetchMessage(ctx)
r.CommitMessages(ctx, m)
handle(m)

// RIGHT: ack last, always
m, _ := r.FetchMessage(ctx)
if err := handle(m); err != nil { return err }
r.CommitMessages(ctx, m)
```

The dual trap (process, crash before ack) means at-least-once redelivers and the handler runs twice — which is what idempotency is for. Both traps are why **at-least-once + idempotency** is the safe default: it survives crashes in either order.

---

## 10. When NOT to Pub/Sub + closing principles

### 10.1 When not

- **Request/response.** `GET /user/42` is RPC. Doing it over a topic with a correlation ID is "I read about event-driven so everything is events".
- **Strong consistency.** Transferring $100 from A to B must be atomic. Splitting into `BalanceDebited{A}` + `BalanceCredited{B}` introduces an inconsistent intermediate state. Use a transaction or an explicit saga.
- **Tight latency budget end-to-end.** A 5 ms RPC becomes a 50 ms event flow with a 500 ms p99 tail. For auth, payment authorization, autocomplete — keep RPC.
- **Low-fan-out, stable topology.** One producer, one consumer, no replay. A queue is fine. Pub/Sub adds operational weight (broker, schemas, observability) that pays off only with fan-out or evolution.
- **Fits in one process.** A binary with three goroutines does not need a broker.
- **Consumer must trust producer.** "This message must reach exactly this consumer or fail" is RPC; modeling it as a topic with one subscriber is RPC with extra steps.

### 10.2 Closing principles

**The topology is the design.** Pub/Sub is not a transport; it is a commitment to inverted dependencies, eventual consistency, and out-of-band evolution. Code that pretends otherwise (events used as RPC, "exactly-once" claims, schema-by-convention) eventually breaks.

**Pick the broker by failure mode.** Throughput numbers are easy to find; what matters is "when this breaks, how does it break?" NATS Core loses on partition. JetStream survives but redelivers. Kafka holds the log but rebalances stall. Redis Streams forgets on OOM. Match failure mode to tolerance.

**Order is per-key.** Build on that assumption. Partition keys are a senior decision; everything with that key stays ordered, everything else is concurrent. Cross-key invariants are a separate problem (sagas, outbox).

**Schemas are contracts.** Treat them like API contracts — versioned, reviewed, compatibility-checked at CI. CloudEvents envelope + protobuf payload + schema registry is the strong default. Hand-rolled JSON with "I will add a field" is technical debt accruing per-message.

**At-least-once + idempotent consumer.** Stop chasing exactly-once. Make handlers idempotent and let the broker do at-least-once. Mission-critical pipelines wrap this in the outbox pattern.

**Observability before the broker is live.** Trace propagation, lag metrics, handler histograms, DLQ — install before the first message flows. Pub/Sub fails by silence, and silence does not show up in incident timelines.

**Reach for it for the right reason.** Pub/Sub pays off with many producers, many consumers, evolving schemas, replay needs, or cross-team boundaries. It is overhead when you have one of each and a stable contract. The senior skill is recognizing which world you are in before writing code — and rewriting an RPC-shaped system as Pub/Sub when the team is ready, not because the architecture diagram looked nicer with arrows pointing only one way.

---

## Further reading

- `src/runtime/chan.go` — the `hchan` implementation
- Kleppmann, *Designing Data-Intensive Applications* — logs, streams, exactly-once
- Confluent's "Exactly-once semantics" engineering posts
- `nats-io/nats.go` and `nats-io/jetstream` docs — pull consumers and ack modes
- `cloudevents/sdk-go` — envelope spec and transport bindings
- OpenTelemetry messaging semantic conventions
- Tyler Treat, "You cannot have exactly-once delivery"
