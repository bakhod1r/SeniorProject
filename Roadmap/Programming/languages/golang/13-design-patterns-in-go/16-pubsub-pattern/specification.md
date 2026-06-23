# Pub/Sub Pattern — Specification

## 1. Origins

Publish/Subscribe is not a single pattern but a family of designs that converged from independent traditions: GUI event systems, message-oriented middleware, and distributed log infrastructure. The first canonical framing appears in *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994) under the name **Observer**:

> "Define a one-to-many dependency between objects so that when one object changes state, all its dependents are notified and updated automatically."

GoF Observer is the in-process ancestor; everything labelled "Pub/Sub" since is a generalisation across address spaces.

Historical milestones:

- **Smalltalk-80 Subject/Observer (1980s)** — the `Model`/`View` interaction in MVC was a Pub/Sub bus in disguise: views registered as dependents of a model and were notified on `changed:` broadcasts.
- **JMS — Java Message Service (1998)** — Sun's JSR-914 codified the Pub/Sub vocabulary used by every broker since: `Topic`, `Producer`, `Consumer`, durable subscriptions, message selectors.
- **AMQP — Advanced Message Queuing Protocol (2003)** — JPMorgan's open wire protocol introduced exchanges, bindings, and routing keys; RabbitMQ (2007) was its reference implementation.
- **NATS (2010, Cloud Foundry)** — Derek Collison's lightweight pub/sub designed for cloud control planes; subject-based addressing with wildcards (`orders.*`, `orders.>`); JetStream (2020) added durability.
- **Kafka (2011, LinkedIn)** — Jay Kreps, Neha Narkhede, Jun Rao; reframed Pub/Sub as a **partitioned, replicated, durable log** rather than a queue, enabling replay and stream processing.
- **CloudEvents (2018, CNCF)** — a vendor-neutral envelope schema (`id`, `source`, `type`, `specversion`, `data`) standardising what a pub/sub message *is* across platforms.

Go-specific history:

- **Channels (Go 1.0, 2012)** — Go shipped a native single-producer / single-consumer (or multi/multi) primitive that *is* a pub/sub channel. No library required for the simplest cases.
- **`nats.go` client (2012)** — official NATS Go client, the first major brokered pub/sub library in the Go ecosystem.
- **`Shopify/sarama` → `IBM/sarama` (2013/2023)** — pure-Go Kafka client, predating the official confluent-kafka-go.
- **`segmentio/kafka-go` (2017)** — alternative Kafka client emphasising idiomatic Go APIs over librdkafka bindings.
- **`cloudevents/sdk-go` (2019)** — CNCF reference SDK; integrates with Kafka, NATS, HTTP, AMQP transports.
- **Generic broker libraries (Go 1.18+, 2022)** — `Broker[T]` patterns replaced the `any`/type-switch idiom for typed in-process buses.

Go's distinctive contribution is that **channels are pub/sub primitives in the language**. The same vocabulary — sender, receiver, buffer, close — applies whether you build a fifty-line in-process broker or a thousand-node Kafka cluster.

---

## 2. Go language mechanics

### 2.1 Channels as topics

A buffered channel is a one-topic, broadcast-free pub/sub primitive: many goroutines can `<-ch`, but each message is received by exactly one of them. To get true fan-out, you multiplex: one input channel feeds N output channels, one per subscriber.

```go
type Topic[T any] struct {
    mu   sync.RWMutex
    subs []chan T
}

func (t *Topic[T]) Publish(v T) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    for _, s := range t.subs {
        select {
        case s <- v:
        default: // drop on slow subscriber
        }
    }
}
```

The channel is the topic; the slice (or map) is the routing table. Closing the channel becomes the broadcast "topic terminated" signal — every subscriber's `for v := range ch` loop exits cleanly. This is the same trick `context.Context.Done()` uses to fan out cancellation.

### 2.2 Fan-out with mutex-guarded map

Subscribers come and go. A `map[string]map[id]chan T` (topic → subscriber-id → channel) gives O(1) subscribe/unsubscribe and avoids slice-rewrite cost. The map is guarded by an `sync.RWMutex`; writers (subscribe/unsubscribe) take the write lock briefly, readers (publish) take the read lock long enough to snapshot the subscriber list, then release before delivery.

The non-negotiable rule: **deliver outside the lock**. A slow handler called under the lock blocks every other publisher.

### 2.3 Generics typed broker

Pre-Go-1.18, brokers stored `any`/`interface{}` and forced a type assertion in every handler. Generics produce a typed channel end-to-end:

```go
type Broker[T any] struct { /* ... */ }
func (b *Broker[T]) Publish(topic string, msg T) { /* ... */ }
func (b *Broker[T]) Subscribe(ctx context.Context, topic string, buf int) <-chan T { /* ... */ }
```

One concrete `Broker[T]` per message family. For heterogeneous topics, fall back to `any` with a type switch — generics do not multiplex over different `T`s.

### 2.4 `select` for non-blocking publish

`select` with a `default` clause turns a potentially-blocking send into a try-send:

```go
select {
case ch <- msg:    // delivered
default:           // subscriber buffer full; apply drop policy
}
```

For brokered clients, the same pattern wraps acks: `select { case <-ack: case <-time.After(d): case <-ctx.Done(): }`.

### 2.5 `context.Context` for cancellation

Subscriber lifetime ties to a `context.Context`. When the context is cancelled, a watcher goroutine removes the subscriber from the broker's map and closes its channel. This replaces the ad-hoc `Unsubscribe()` call that always gets forgotten on some error path.

```go
go func() {
    <-ctx.Done()
    b.unsubscribe(topic, id)
}()
```

The pattern composes: a parent context cancellation propagates to every child subscription. A request-scoped context cancels its subscriptions when the HTTP handler returns; a service-scoped context cancels everything when the process drains. The broker itself need not know about request boundaries — the context does.

Brokered SDKs accept context in the same idiom: `nats.Subscribe` returns a handle whose `Drain()` is wired to context cancellation; `kafka.Reader.ReadMessage(ctx)` returns `ctx.Err()` when cancelled. The in-process and brokered universes share the same cancellation discipline.

---

## 3. Canonical Go shapes

### 3.1 In-process map-of-channels broker

```go
type Broker[T any] struct {
    mu   sync.RWMutex
    subs map[string]map[uint64]chan T
    next uint64
}
```

The reference shape for an internal event bus. Generic on `T`, topic-keyed by string, subscriber-keyed by monotonic ID for O(1) removal. Fits in ~50 lines.

### 3.2 Work-queue (one channel, many readers)

```go
jobs := make(chan Job, 100)
for i := 0; i < N; i++ {
    go func() { for j := range jobs { handle(j) } }()
}
```

Each message goes to **exactly one** worker — load balancing, not broadcast. The pattern Kafka calls a *consumer group*. The buffer is the back-pressure mechanism.

### 3.3 Fan-out (broadcast)

```go
for _, sub := range subs {
    sub <- msg // every subscriber receives every message
}
```

Plain broadcast. Combined with §3.1 (per-subscriber channels) this is the canonical in-process event bus.

### 3.4 Broker client wrapper

```go
type NATSBus struct {
    nc *nats.Conn
}

func (b *NATSBus) Publish(subject string, payload []byte) error {
    return b.nc.Publish(subject, payload)
}

func (b *NATSBus) Subscribe(subject string, h func([]byte)) (Unsub, error) {
    sub, err := b.nc.Subscribe(subject, func(m *nats.Msg) { h(m.Data) })
    return sub.Unsubscribe, err
}
```

A thin wrapper hides the broker SDK behind a stable in-app interface. The wrapper is the seam where you swap NATS for Kafka without rewriting the domain code.

### 3.5 Outbox → broker pump

```go
// Transactional outbox table: (id, topic, payload, published_at)
// Background pump:
for rows := range fetch(ctx) {
    for _, r := range rows {
        if err := broker.Publish(r.Topic, r.Payload); err == nil {
            markPublished(r.ID)
        }
    }
}
```

The transactional outbox decouples "write to database" from "publish to broker": both succeed (eventually) or neither. The pump is itself an in-process Pub/Sub consumer of the database changefeed. CDC tools (Debezium, `pg_logical`) generalise the pump by tailing the WAL directly; the application code never explicitly calls `Publish` at all.

---

## 4. Standard library use

### 4.1 `context.Context.Done()` as broadcast

`ctx.Done()` is a one-message, broadcast pub/sub channel: closed exactly once when cancellation fires, every receiver sees the close. It is the most-used pub/sub primitive in the standard library — every `select { case <-ctx.Done(): }` is a subscriber to the cancellation topic.

### 4.2 `sync.Cond.Broadcast`

`sync.Cond` is a pre-channels condition variable; `Broadcast` wakes every goroutine waiting on `Wait`. It implements the same one-publisher-many-subscriber semantics as a closed channel, but with explicit re-arming.

```go
var (
    mu   sync.Mutex
    cond = sync.NewCond(&mu)
    state State
)
// Subscribers:
mu.Lock()
for !ready(state) { cond.Wait() }
mu.Unlock()
// Publisher:
mu.Lock(); state = next; cond.Broadcast(); mu.Unlock()
```

Rarely used in modern Go — channel close is almost always cleaner — but still present in stdlib internals (`net/http/h2_bundle.go`).

### 4.3 `os/signal.Notify`

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
```

The OS is the publisher; the runtime delivers signals to every channel registered via `Notify`. The standard library's only explicitly multi-subscriber broadcast API.

### 4.4 `reflect.Select` for dynamic fan-in

When the set of channels is known only at runtime, `reflect.Select` accepts a `[]reflect.SelectCase` of arbitrary size, returning the index of the case that fired:

```go
cases := make([]reflect.SelectCase, len(channels))
for i, ch := range channels {
    cases[i] = reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ch)}
}
idx, val, ok := reflect.Select(cases)
```

It implements dynamic fan-in (many publishers, one subscriber) at the cost of one reflection call per select. Used by `k8s.io/apimachinery/pkg/util/wait` and similar machinery.

### 4.5 `io.MultiWriter` (degenerate fan-out)

```go
w := io.MultiWriter(os.Stdout, logFile, networkSink)
fmt.Fprintln(w, "event happened")
```

The dual of `io.MultiReader`: every `Write` is delivered to every underlying writer. It is Pub/Sub flattened into the `io.Writer` interface — synchronous, in-order, lossy on first error.

---

## 5. Real library use

### 5.1 `nats-io/nats.go`

The reference Go client for NATS. Subject-based addressing with wildcards (`*` single token, `>` multi-token). Async callbacks for subscribers; queue groups for load balancing; JetStream API for durable streams.

```go
nc, _ := nats.Connect(nats.DefaultURL)
nc.Subscribe("orders.*", func(m *nats.Msg) { handle(m.Data) })
nc.Publish("orders.new", payload)
```

Reconnection, queue subscriptions, and request-reply are first-class:

```go
nc.QueueSubscribe("orders.new", "billing-workers", h) // load-balanced
reply, _ := nc.Request("rpc.echo", []byte("ping"), time.Second)
```

### 5.2 `segmentio/kafka-go`

Idiomatic Go Kafka client, no librdkafka dependency. `Reader` and `Writer` map to consumer and producer; consumer groups are first-class; `kafka.Message` carries headers for tracing.

```go
r := kafka.NewReader(kafka.ReaderConfig{
    Brokers: brokers, GroupID: "billing", Topic: "orders",
})
for {
    m, _ := r.ReadMessage(ctx)
    process(m)
}
```

### 5.3 `IBM/sarama`

The longest-lived pure-Go Kafka client, originally `Shopify/sarama`. Lower-level than `kafka-go` — explicit `AsyncProducer`/`SyncProducer`, manual partition assignment, hand-rolled consumer groups via `ConsumerGroup` interface. Still widely deployed in older codebases.

### 5.4 `redis/go-redis` Pub/Sub

Redis Pub/Sub (channel-based, fire-and-forget) and Streams (durable, consumer groups) are both exposed:

```go
pubsub := rdb.Subscribe(ctx, "events")
ch := pubsub.Channel()
for msg := range ch { handle(msg.Payload) }
```

Channels are at-most-once and non-durable; Streams (`XADD`, `XREAD`, `XGROUP`) provide ack semantics and replay.

### 5.5 `cloudevents/sdk-go`

CNCF reference SDK. Wraps any transport (HTTP, Kafka, NATS, AMQP) in the CloudEvents envelope:

```go
e := cloudevents.NewEvent()
e.SetType("com.example.order.created")
e.SetSource("billing-svc")
e.SetData(cloudevents.ApplicationJSON, order)
client.Send(ctx, e)
```

Adoption removes the per-team bikeshed about message envelope shape. The envelope is transport-agnostic: the same event flows through HTTP webhooks in development and Kafka in production without payload rewriting. Knative Eventing and ArgoEvents both consume CloudEvents natively.

---

## 6. Formal specification

A Go Pub/Sub system consists of:

| Element | Description |
|---------|-------------|
| **Publisher** | Source of messages; calls `Publish(topic, msg)` without knowing or caring who subscribes. |
| **Subscriber** | Sink that registers interest in a topic and receives matching messages via a channel or callback. |
| **Topic** | Named routing key; identifies a stream of messages. May support wildcards (NATS `orders.*`) or be opaque (Kafka topic name). |
| **Broker** | Component holding the routing table; in-process map or network service. Decouples publishers from subscribers. |
| **Message** | Discrete unit of data; immutable from the publisher's perspective once published. Carries payload, headers, and optionally a key for partitioning. |
| **Delivery semantics** | At-most-once (lossy), at-least-once (duplicates possible), exactly-once (rare, expensive). |
| **Backpressure** | Mechanism by which a slow subscriber signals it cannot keep up: channel buffer fill, prefetch limit, unacked-message ceiling. |

**Invariants:**

1. A publisher never blocks on a subscriber it does not know exists. The broker absorbs the indirection; subscriber slowness must not propagate to publishers unless the publisher explicitly opts into synchronous delivery.
2. A subscriber added after a message was published does not receive that message in non-durable systems. Durable systems (Kafka, JetStream) may replay from an offset, but the default is *messages-from-now*.
3. Unsubscription is observable: after `Unsubscribe` returns (or the context-bound subscription is cancelled), no further messages are delivered to that subscriber.
4. Message ordering is guaranteed only within a topic/partition/subject for a single producer. Cross-topic, cross-partition, and multi-producer orderings are unspecified unless the broker explicitly guarantees them.
5. Acknowledgment in at-least-once systems is the subscriber's responsibility. An unacked message will be redelivered after the broker's visibility timeout; handlers must be idempotent.

---

## 7. Anti-patterns

### 7.1 Locking the broker during delivery

```go
b.mu.Lock()
for _, s := range b.subs[topic] {
    s.ch <- msg // blocks under the lock
}
b.mu.Unlock()
```

A single slow subscriber freezes every publisher on every topic. **Fix:** snapshot the subscriber list under the lock, release the lock, then deliver.

### 7.2 No unsubscribe path

```go
b.Subscribe("orders", ch) // no way to remove ch later
```

Subscribers accumulate forever; goroutines leak; the broker's map grows without bound. **Fix:** tie subscription lifetime to a `context.Context`, or return an `Unsubscribe()` closure from `Subscribe`.

### 7.3 Publishing pointers to mutable structs

```go
b.Publish("user.updated", user) // user is *User; subscriber 2 mutates it
```

Subscriber 2's mutations are visible to subscriber 1. Race detector flags it; production sometimes does not. **Fix:** send by value, or treat published payloads as immutable by convention and (preferably) by type.

### 7.4 Treating in-process Pub/Sub as durable

A panic, a `os.Exit`, or a `SIGKILL` discards every message in flight. Treating an in-process bus as if it were Kafka leads to silent loss in production. **Fix:** if durability matters, write to a broker (or to an outbox table) before the in-process broadcast.

### 7.5 One global broker for everything

```go
var Bus = pubsub.New[any]() // every topic, every type, one mutex
```

All topics now share a single `sync.RWMutex`. A high-volume topic starves a low-volume one. **Fix:** one broker per bounded context (or one per `T`), not one per process.

### 7.6 No metrics

Pub/Sub failure mode is **silence**: a subscriber stops processing and nothing crashes. Without `events_dropped_total`, `subscriber_lag`, and per-handler latency, the bug surfaces as "the email never arrived". **Fix:** instrument publish, delivery, drop, and handler-duration on every topic from day one. Alert on lag growth, not on raw counts — a consumer that drops to zero throughput while the publisher keeps writing is the failure shape you need to catch.

### 7.7 Fire-and-forget where acknowledgment is needed

```go
broker.Publish("payment.charged", evt) // no ack, no retry
```

NATS Core, in-process buses, and Redis Pub/Sub channels are at-most-once. Using them for payment events, order confirmations, or any business-critical workflow loses messages on broker restart or network blip. **Fix:** use at-least-once transports (Kafka, JetStream, RabbitMQ) and ack only after successful processing. The corollary: design every at-least-once handler to be idempotent, because the retry will eventually fire twice.

---

## 8. Variants and dialects

| Variant | Description |
|---------|-------------|
| **In-process broker** | `map[topic]chan` with `sync.RWMutex`; ~50 lines; nanosecond delivery; non-durable. |
| **Work queue** | One channel, N consumers; exactly-once-among-workers delivery; load balancing. |
| **Broadcast** | Every subscriber receives every message; the default fan-out shape. |
| **Consumer groups** | Multiple groups subscribe to the same topic; each group is load-balanced internally. Kafka's signature model. |
| **Persistent stream** | Durable, ordered, replayable log; Kafka, JetStream, Pulsar, Redis Streams. |
| **Request-reply over Pub/Sub** | Publisher includes a reply-to topic; subscriber answers on that topic. NATS request/reply, RabbitMQ RPC. Synchronous semantics on async transport. |

---

## 9. Naming conventions

- **Operations:** `Subscribe` / `Unsubscribe` / `Publish` are universal. `Send`/`Receive` is reserved for transports; `Emit`/`Listen` appears in browser-influenced libraries and is discouraged in idiomatic Go.
- **Topic vocabulary:** NATS uses `Subject` (with wildcards `*` and `>`); Redis Pub/Sub uses `Channel`; Kafka uses `Topic` (plus `Partition`); AMQP uses `Exchange` + `RoutingKey`. Pick the term your broker uses; do not retranslate inside the codebase.
- **Handler shape:** `func(ctx context.Context, msg T)` for typed in-process buses; `func(*nats.Msg)` and `func(*kafka.Message)` for SDK-native handlers. Wrap broker handlers in a thin adapter that injects context.
- **Acks:** `Ack()`, `Nack()`, `Term()` (terminate, no redelivery) from JetStream/SQS. Use the broker's exact verb in the wrapping interface.
- **Lifecycle:** `Close()` for brokers owning resources; `Drain()` (NATS) for graceful shutdown that delivers pending messages before closing.
- **Identifiers:** `MessageID` is the broker-assigned unique; `CorrelationID` is the application-assigned trace key. Both should appear in headers, not the payload.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Observer (GoF)** | In-process, synchronous, typed; the ancestor. Pub/Sub generalises across processes and adds asynchrony. |
| **Mediator (GoF)** | One central object coordinates many colleagues; Pub/Sub removes the central object's knowledge of its colleagues — the mediator becomes a topic, not a class. |
| **Command (GoF)** | Encapsulates a request as an object; a published message is often a serialised Command. The two compose: a Pub/Sub event carries a Command payload. |
| **Chain of Responsibility (GoF)** | Sequential per-handler processing; Pub/Sub is parallel multi-handler. A chain stops at the first handler that accepts; Pub/Sub delivers to all. |
| **Outbox** | Transactional database + background pump; the most common pattern for *publishing reliably* into a Pub/Sub system. |
| **Saga** | Long-running distributed transactions choreographed via Pub/Sub events; each step publishes "completed" or "compensate". Pub/Sub is the transport; Saga is the protocol over it. |

---

## 11. Further reading

- **GoF (1994)** — Observer chapter; the in-process root of the pattern.
- **Hohpe and Woolf, *Enterprise Integration Patterns* (2003)** — the canonical catalogue of messaging patterns: Publish-Subscribe Channel, Message Router, Message Translator, Dead Letter Channel.
- **Narkhede, Shapira, Palino, *Kafka: The Definitive Guide* (2nd ed., 2021)** — chapters on consumer groups, exactly-once semantics, and stream processing.
- **NATS documentation (`docs.nats.io`)** — subject hierarchies, JetStream consumers, queue groups; the most approachable broker docs in the ecosystem.
- **CloudEvents specification (`cloudevents.io`)** — the envelope schema and its bindings to HTTP, Kafka, AMQP, NATS.
- **Sam Newman, *Building Microservices* (2nd ed., 2021)** — chapter on event-driven communication; orchestration vs choreography trade-off.
- **`nats-io/nats.go`, `segmentio/kafka-go`, `IBM/sarama` source** — three production-grade reference clients; read their reconnect and consumer-group code to understand failure modes.
- **Vyukov, *Single-Producer/Single-Consumer Queues*** — lock-free queue designs underpinning the highest-throughput in-process buses.

Pub/Sub in Go starts as channels-with-a-mutex and ends as a brokered service with schemas and ack semantics. Senior skill is knowing which universe a topic belongs in.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Topic** | Named routing key identifying a stream of messages; the unit of subscription. |
| **Publisher** | Producer of messages; calls `Publish(topic, msg)` and does not know who subscribes. |
| **Subscriber** | Consumer registered against a topic; receives messages via channel or callback. |
| **Broker** | Component holding the subscriber routing table; in-process struct or network service. |
| **Fan-out** | Delivery pattern in which one message reaches every subscriber of a topic. |
| **Consumer group** | Set of subscribers cooperating to consume a topic, with each message delivered to one member of the group; Kafka's load-balancing primitive. |
| **Partition** | Subdivision of a topic providing parallelism and per-partition ordering; Kafka and Pulsar use partitions, NATS uses subjects, RabbitMQ uses queues. |
| **Offset** | Position of a consumer within a partitioned log; committing an offset records progress and enables replay. |
| **Ack / Nack** | Subscriber's acknowledgment (success) or negative-ack (failure, please redeliver) for a message in at-least-once systems. |
| **Prefetch** | Maximum number of unacked messages the broker delivers to a consumer before pausing; the brokered analogue of channel buffer size. |
| **Dead-letter** | Side channel receiving messages that failed processing after N retries; the operator inspects them rather than letting the queue head-of-line block. |
| **Replay** | Re-delivery of messages from a past offset, available in durable streams (Kafka, JetStream); enables new consumers to catch up and recovery from handler bugs. |
