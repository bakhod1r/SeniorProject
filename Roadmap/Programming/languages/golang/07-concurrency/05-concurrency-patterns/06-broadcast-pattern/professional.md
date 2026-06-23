# Broadcast Pattern — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Choosing the Right Broadcast System](#choosing-the-right-broadcast-system)
3. [In-Process vs Networked Pub/Sub](#in-process-vs-networked-pubsub)
4. [Comparison: Redis Pub/Sub](#comparison-redis-pubsub)
5. [Comparison: NATS](#comparison-nats)
6. [Comparison: ZeroMQ](#comparison-zeromq)
7. [Comparison: Kafka and Streams](#comparison-kafka-and-streams)
8. [Production Broadcast Architecture](#production-broadcast-architecture)
9. [Observability at Scale](#observability-at-scale)
10. [Capacity and Cost Modelling](#capacity-and-cost-modelling)
11. [War Stories and Anti-Architectures](#war-stories-and-anti-architectures)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

At professional level you are choosing *between* broadcast systems, not implementing one. Your code may still contain in-process hubs for ergonomics, but the cross-process distribution is delegated to a battle-tested system. Your job is:

- Pick the right tool for the rate, durability, and ordering requirements.
- Bridge the chosen tool to Go idioms cleanly.
- Run it at scale with the operational discipline of any data system.

This file surveys the production broadcast landscape and gives the rules you need to make a confident architectural choice.

---

## Choosing the Right Broadcast System

The decision tree:

```
Do subscribers need delivery if they were offline at publish time?
├── Yes  → Use a log-based system (Kafka, Redis Streams, NATS JetStream).
└── No   → Are subscribers in the same process?
          ├── Yes → In-process hub (this subsection).
          └── No  → Are subscribers on the same machine?
                   ├── Yes → Unix socket / shared memory / ZeroMQ inproc.
                   └── No  → Networked pub/sub (Redis Pub/Sub, NATS, ZeroMQ tcp).
```

Then layer on:

- **Throughput.** Below 10k msg/sec, any system works. 10k–1M, NATS / ZeroMQ / Redis. >1M, Kafka, custom, or sharded.
- **Latency.** Sub-millisecond? Pick a non-acked / fire-and-forget system. Sub-second is easy for all.
- **Ordering.** Per-partition order is standard. Total order is expensive and rare.
- **Durability.** At-most-once (Pub/Sub) is cheap. At-least-once needs acks. Exactly-once needs idempotence at the consumer.

Most production systems use *multiple* broadcast tools — e.g., Redis Pub/Sub for ephemeral notifications, Kafka for the durable event log, in-process channels for the last hop to handlers.

---

## In-Process vs Networked Pub/Sub

| Aspect | In-process channels | Networked pub/sub |
|--------|---------------------|--------------------|
| Latency | nanoseconds | milliseconds |
| Throughput | 10M+ events/sec | 100k–1M / instance |
| Durability | None (process exit = loss) | Configurable |
| Failure isolation | Subscriber crash = process crash | Subscriber crash isolated |
| Operability | Trivial | Requires monitoring, scaling |
| Reach | Single process | Cluster-wide |

The right *boundary* between in-process and networked is the process. A single process should use channels internally. Cross-process broadcast goes through the network. Mixing them inside one process (e.g., a "pub/sub" that hits Redis even for same-process subscribers) is wasted latency.

A common production layout:

```
[ external producer ]
        |
   network
        |
        v
[ Kafka / NATS topic ]
        |
        v
[ Go service: consumer ] --in-process channel--> [ many goroutine handlers ]
```

The Go service has one consumer that reads from Kafka and broadcasts in-process to handler goroutines. Each handler does its work. The in-process broadcast is built with `Hub[T]` from the middle/senior files.

---

## Comparison: Redis Pub/Sub

Redis Pub/Sub is the simplest networked broadcast in common use.

**Strengths**
- Trivial setup (Redis is everywhere already).
- Sub-millisecond delivery on a healthy cluster.
- Topic-based with pattern subscription (`PSUBSCRIBE chat.*`).
- Excellent Go client (`go-redis`).

**Weaknesses**
- **Fire and forget.** No durability; if a subscriber is offline when a message is published, it never sees it.
- **No backpressure.** Redis disconnects slow subscribers (`client-output-buffer-limit`). You lose every message from disconnect to reconnect.
- **No partition order guarantees** across multiple Redis nodes in cluster mode.
- **Each message goes through one Redis node** (or a few, if sharded by pattern). Throughput cap is Redis throughput.

**Fit:** ephemeral notifications where loss is acceptable — cache invalidations across replicas, "user X is typing" indicators, real-time presence.

**Bad fit:** anything where loss is unacceptable. Use Redis Streams or Kafka instead.

```go
import "github.com/redis/go-redis/v9"

func subscribe(ctx context.Context, rdb *redis.Client, topic string) {
    sub := rdb.Subscribe(ctx, topic)
    defer sub.Close()
    for msg := range sub.Channel() {
        handle(msg.Payload)
    }
}
```

Redis Pub/Sub maps cleanly to a Go `<-chan *Message`. Wrap it in your own `Subscription[T]` adapter to integrate with the rest of your code.

---

## Comparison: NATS

NATS is purpose-built for high-throughput pub/sub.

**Strengths**
- 1M+ messages/sec/instance.
- Subject hierarchies and wildcards (`orders.*.created`).
- Built-in clustering with mesh routing.
- Optional JetStream for durability, replay, and at-least-once delivery.
- Excellent Go client (`nats.go`).
- Request/reply pattern alongside pub/sub.

**Weaknesses**
- Without JetStream: ephemeral, like Redis Pub/Sub but faster.
- Operational complexity rises with JetStream.
- Subject naming is global — naming discipline matters.

**Fit:** microservice mesh communication, real-time game state, IoT telemetry, request/reply with broadcast.

```go
import "github.com/nats-io/nats.go"

nc, _ := nats.Connect("nats://localhost:4222")
defer nc.Close()
sub, _ := nc.Subscribe("orders.*.created", func(m *nats.Msg) {
    handle(m.Data)
})
defer sub.Unsubscribe()
```

NATS callbacks are invoked from internal client goroutines. Idiomatic Go integration: forward to a channel and process in your own goroutine to avoid blocking the NATS client.

---

## Comparison: ZeroMQ

ZeroMQ is a library, not a broker. It implements pub/sub as a socket type with no central node.

**Strengths**
- No broker — direct peer-to-peer or multicast.
- Brokerless multicast (`epgm`, `pgm`) for LAN broadcast.
- Many transport types: tcp, ipc, inproc.
- Brutally fast (no broker hop).

**Weaknesses**
- **No durability whatsoever.** Subscribers must be online.
- **No discovery.** Publishers and subscribers must know each other's endpoints.
- **Subscription filtering happens on the subscriber side** for tcp (publisher sends everything, subscriber filters locally). For multicast, filtering is publisher-side but still requires coordination.
- Go bindings (`pebbe/zmq4`) require CGO, which complicates builds.

**Fit:** specialised low-latency systems where you control the topology — high-frequency trading, sensor networks, embedded clusters.

**Bad fit:** general microservice messaging. Use NATS instead.

---

## Comparison: Kafka and Streams

Kafka is not pub/sub — it is a partitioned log. But it serves the broadcast use case via consumer groups.

**Strengths**
- Durable: events persist for configurable retention.
- Replay: consumers track their offset; can rewind.
- Per-partition order.
- Massive scale (1M+ msg/sec per cluster easily).
- Strong ecosystem (Kafka Streams, Connect, Schema Registry).

**Weaknesses**
- High latency compared to pub/sub (tens of ms typical).
- Heavy operational footprint (ZooKeeper / KRaft, brokers, storage).
- Consumer-group semantics are subtle — only one consumer per group sees each message, so to broadcast you need either *unique groups per consumer* or *fan-out at the consumer side*.

**Fan-out pattern in Kafka:**
- One Kafka topic.
- N consumer groups, each named uniquely.
- Each group sees every message (group-level broadcast).
- Within a group, partitions distribute messages (load balance).

```go
// Using github.com/segmentio/kafka-go
r := kafka.NewReader(kafka.ReaderConfig{
    Brokers: []string{"kafka:9092"},
    Topic:   "orders",
    GroupID: "billing-service",
})
defer r.Close()
for {
    m, err := r.ReadMessage(ctx)
    if err != nil { break }
    handle(m.Value)
}
```

Each new consumer group ID effectively subscribes. Old consumer groups resume from their last committed offset on restart.

**Fit:** anything that needs durability, replay, or audit. Event sourcing, billing, fraud detection.

**Bad fit:** ephemeral signals (use NATS or Redis), strict sub-millisecond latency.

Redis Streams plays in this space too — lighter weight than Kafka, less operational depth, comparable semantics. Worth considering for small-to-mid scale.

---

## Production Broadcast Architecture

A canonical layout for a Go service that needs to broadcast cross-process updates and across many local handlers:

```
                  +----------------+
                  |  Source of     |
                  |  truth (DB,    |
                  |  external API) |
                  +-------+--------+
                          |
                  +-------v--------+
                  |  Publisher Go  |
                  |  service       |
                  +-------+--------+
                          | NATS / Kafka publish
                          v
                +---------+----------+
                |   NATS / Kafka     |
                |   broker / cluster |
                +---------+----------+
                          | subscribe per service
                          v
              +-----------+-----------+
              | Consumer Go service   |
              | (1 NATS subscriber    |
              | per topic)            |
              +-----------+-----------+
                          | in-process broadcast (Hub[T])
                          v
              +-------+---+---+--+----+
              |       |       |       |
              v       v       v       v
            handler  handler  ws-pump websocket
            goroutine            goroutine  goroutines
```

Key observations:

1. **One network subscription per process.** Each Go service has one NATS subscription per topic; the rest is in-process broadcast. Many network subscriptions per process is wasteful — Hub fan-out is 10× cheaper.

2. **WebSocket pump as a hub-of-hubs.** Each connected WebSocket client is a subscriber in the in-process Hub. The pump is also a NATS subscriber. New event from NATS → broadcast in-process → every WebSocket gets it.

3. **Backpressure boundary at NATS.** If the in-process Hub uses `Block`, a slow downstream handler can backpressure all the way to NATS, which will disconnect the consumer. Use `DropNewest` or `DropOldest` to isolate.

4. **Health: one slow handler should not stall the service.** Per-subscriber goroutines + bounded queues + drop policy is the senior-level recipe applied here.

---

## Observability at Scale

A production broadcast pipeline needs metrics at every layer:

### Network layer (NATS/Kafka)
- Publish rate per topic.
- Subscriber lag (offset gap for Kafka; queue depth for NATS).
- Disconnect/reconnect counts.
- Slow-consumer warnings from the broker.

### In-process Hub layer
- Subscriber count per Hub.
- Buffer fill percentage per subscriber (gauge).
- Drop count per subscriber (counter).
- Eject count per Hub (counter).
- Publish latency histogram.

### Handler layer
- Handler latency histogram per event type.
- Handler error rate.
- Goroutine count (proxy for leaks).

### Distributed tracing
Each event should carry a trace context. The Hub propagates `context.Context` from publish to subscriber, so OpenTelemetry spans cover the entire broadcast path. Wrap your event type:

```go
type Event[T any] struct {
    Ctx     context.Context // not for storage; for in-flight only
    Payload T
}
```

This is unusual (contexts in struct fields are normally a code smell) but justified for broadcast where the carrier is short-lived.

### Alerts
- Buffer fill > 80% sustained for > 1 minute: paging.
- Drop rate > 1% of publish rate: paging.
- Subscriber count abnormally low: paging (the WebSocket pump may have crashed).
- Hub goroutine count growing without bound: paging (leak).

---

## Capacity and Cost Modelling

### Throughput model
For an in-process Hub:
- Single-channel send: ~50-150 ns.
- Per-publish cost: `N * single_send_cost` for N subscribers.
- 10k subscribers × 100 ns = 1 ms per publish.
- At 1 ms/publish, one goroutine sustains 1k publishes/sec.

For more, shard the Hub or do per-subscriber goroutines.

### Memory model
For 10k subscribers each with a 64-slot buffer of 256 B events:
- Subscriber channels: `10k × 64 × 256 B = 160 MB`.
- Subscription map entries: `10k × 64 B ≈ 640 KB`.
- Goroutines (if per-subscriber): `10k × 8 KB = 80 MB`.

Total ~240 MB resident for a 10k-subscriber Hub at full buffer. Real-world fill is typically <10%; multiply your peak buffer pressure with a margin.

### Network bandwidth
For a network broadcast, each event traverses the wire once to the broker plus once per subscriber. 100 B events × 10k subscribers × 1000 events/sec = 1 GB/sec. Often forgotten in capacity planning.

### Cost
- NATS: cheap (single binary, low resource use).
- Kafka: expensive (broker fleet, storage, ZooKeeper or KRaft).
- Redis Pub/Sub: cheap-to-medium (Redis cluster).
- ZeroMQ: free except your engineering time.

Cost vs. capability is the usual trade-off. Pick the cheapest tool that meets the durability/throughput requirements.

---

## War Stories and Anti-Architectures

### "We used Kafka for ephemeral notifications"
Symptom: SREs paged every time Kafka had a hiccup; cost spiral as retention grew.
Cause: chose Kafka because it was already in the stack; ephemeral notifications did not need durability.
Fix: move to NATS or Redis Pub/Sub for the ephemeral path; keep Kafka for the durable path.

### "WebSocket clients are NATS subscribers"
Symptom: NATS connections per service grew to 50k+; broker CPU saturated.
Cause: each browser WebSocket connection created a NATS subscription instead of the server having one subscription and fanning out.
Fix: one NATS subscription per Go service per topic; in-process Hub fans out to WebSocket clients.

### "We broadcast all events to all services and let each filter"
Symptom: every service paid CPU to deserialise events it ignored; network saturated.
Cause: lazy subject design — `events.all` with a type field, instead of `orders.created`, `orders.shipped`, etc.
Fix: subject hierarchy with wildcards. Each service subscribes only to its subjects.

### "One slow database query stalled the pub/sub pipeline"
Symptom: a handler that occasionally took 30 s caused the subscriber lag to grow into hours.
Cause: in-process Hub used `Block` policy; the slow handler's queue filled and stalled the publisher.
Fix: `DropNewest` policy plus per-subscriber goroutines; the slow handler now drops events but does not stall others.

### "We hot-reloaded a config but only half the workers got it"
Symptom: production behaviour was inconsistent after config push.
Cause: configuration was pushed via a `chan Config`, which is unicast — only one worker received each push.
Fix: replace with broadcast Hub; every worker subscribes; new config goes to all.

---

## Cheat Sheet

| Requirement | Pick |
|-------------|------|
| In-process broadcast | Go channels + `Hub[T]` |
| Ephemeral cross-process | NATS or Redis Pub/Sub |
| Durable with replay | Kafka or Redis Streams or NATS JetStream |
| Sub-ms cross-process | NATS or ZeroMQ |
| LAN multicast | ZeroMQ pgm/epgm |
| WebSocket fan-out | Network sub → in-process Hub → WebSockets |
| State coalescing | Coalescing Hub (see senior) |

```go
// Canonical hybrid layout:
//   1 network subscription per service + per-topic Hub + many handlers

nc, _ := nats.Connect(natsURL)
hub := broadcast.New[Event](16, broadcast.DropNewest)

go func() {
    sub, _ := nc.Subscribe("events.*", func(m *nats.Msg) {
        hub.Publish(ctx, decode(m.Data))
    })
    defer sub.Unsubscribe()
    <-ctx.Done()
}()

for _, handler := range handlers {
    sub := hub.Subscribe()
    go handler.Run(ctx, sub.C())
}
```

---

## Summary

Professional broadcast is architecture, not code. The patterns are:

- Pick the right tool: NATS for ephemeral high-rate, Kafka for durable replay, Redis Pub/Sub for trivial, ZeroMQ for specialised LAN.
- One network subscription per process. Use an in-process Hub to fan out further. Saves network and broker resources.
- Use bounded buffers and drop-on-overflow at every boundary. Backpressure across the network is fatal.
- Instrument at every layer. Buffer fill is your leading indicator.
- Model throughput and memory before committing to a design. 10k subscribers is much harder than 1k.

The Go-specific value-add at professional level is the bridge: clean, fast, leak-free integration between an external broadcast system and idiomatic in-process channels. Get that right and your service scales linearly with subscriber count.
