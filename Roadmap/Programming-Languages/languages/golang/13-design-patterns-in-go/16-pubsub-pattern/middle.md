# Pub/Sub — Middle

## 1. Two universes: in-process and brokered

Junior-level Pub/Sub is one process, channels in memory. Real production Pub/Sub splits into two universes that share vocabulary but solve different problems:

- **In-process** — events stay in one binary. Used for domain events, internal fan-out, audit/log distribution. Fast (~50 ns per delivery), lossy under back-pressure, easy to test.
- **Brokered** — a network service (Kafka, NATS, RabbitMQ, Redis, Pulsar) holds the topic. Used for cross-service event flows, durability, replay. Slower (~1 ms), durable, requires schema discipline.

Middle-level Pub/Sub means knowing which one to reach for, when to mix them (an in-process bus feeding a brokered topic), and the trade-offs each makes.

---

## 2. A production-shaped in-process broker

The junior version uses `map[string][]chan T`. That's fine for a toy. Real code adds:

- per-subscriber identity (so you can unsubscribe without scanning)
- context-driven shutdown
- per-subscriber slow-handling policy (drop or block)
- a "publish synchronously" mode for testing

```go
type Handler[T any] func(ctx context.Context, msg T)

type sub[T any] struct {
    id      uint64
    ch      chan T
    onDrop  func(msg T)
    cancel  func()
}

type Broker[T any] struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]*sub[T]
    nextID uint64
}

func New[T any]() *Broker[T] {
    return &Broker[T]{subs: map[string]map[uint64]*sub[T]{}}
}

func (b *Broker[T]) Subscribe(ctx context.Context, topic string, buf int) <-chan T {
    b.mu.Lock()
    if b.subs[topic] == nil {
        b.subs[topic] = map[uint64]*sub[T]{}
    }
    b.nextID++
    id := b.nextID
    s := &sub[T]{id: id, ch: make(chan T, buf)}
    b.subs[topic][id] = s
    b.mu.Unlock()

    go func() {
        <-ctx.Done()
        b.mu.Lock()
        if cur, ok := b.subs[topic][id]; ok && cur == s {
            delete(b.subs[topic], id)
            close(s.ch)
        }
        b.mu.Unlock()
    }()

    return s.ch
}
```

Subscribers tie their lifetime to a `context.Context`. When the caller cancels the context, the subscription is removed and the channel closed. There's no `Unsubscribe()` call to forget.

---

## 3. Slow-subscriber policies

The publish path:

```go
func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.RLock()
    subs := b.subs[topic]
    cps := make([]*sub[T], 0, len(subs))
    for _, s := range subs {
        cps = append(cps, s)
    }
    b.mu.RUnlock()

    for _, s := range cps {
        select {
        case s.ch <- msg:
        default:
            if s.onDrop != nil {
                s.onDrop(msg)
            }
        }
    }
}
```

Snapshot the subscriber list under the lock, then deliver outside the lock. Otherwise a slow publish blocks the whole broker.

Three slow-subscriber modes you'll choose between:

- **Drop**: `select { case ch <- msg: default: }` — never blocks; loses messages. Metrics, logs.
- **Block**: `ch <- msg` — never loses; can stall the publisher and every other subscriber. Use when the message *must* be delivered.
- **Disconnect**: drop the subscriber after N consecutive drops. The subscriber re-subscribes if it can. Chat, presence systems.

Make this **per-subscriber**, not global. Different consumers of the same topic have different tolerances.

---

## 4. Fan-out shapes

Three shapes show up:

**Broadcast** — every subscriber gets every message. The default above.

**Queue/Work** — each message goes to *exactly one* subscriber (load balancing). Implement with a single channel that all workers read from:

```go
work := make(chan Msg, 100)
for i := 0; i < N; i++ {
    go worker(work)
}
work <- msg  // exactly one worker picks it up
```

**Topic+queue (consumer groups)** — multiple groups, each gets every message; within a group, each message goes to one worker. This is Kafka's consumer-group model.

Knowing which shape you need before writing code saves a lot of pain. Don't try to support all three in one broker; pick the one your use case needs.

---

## 5. Message types: typed vs `any`

In Go 1.18+ you can make the broker generic on the message type:

```go
b := New[OrderEvent]()
```

Pros: type-safe, no `any` boxing, no runtime cast.
Cons: one broker per type — if you really need a topic-multiplexed event bus with heterogeneous messages, you either need one `Broker[OrderEvent]` per type, or you fall back to `any` with a type-switch in the handler.

For audit/log buses (everything is `*Event`), generics pay off. For a wire-format event bus where messages are heterogeneous, `any` plus a switch is often cleaner.

---

## 6. Synchronous vs asynchronous publish

`Publish` above is asynchronous from the *publisher's* viewpoint — the message lands in a buffer, the subscriber processes it later. That's usually right for fan-out.

Sometimes you want `Publish(msg)` to *complete* only after every subscriber has processed it (testing, transactional event sourcing):

```go
func (b *Broker[T]) PublishSync(ctx context.Context, topic string, msg T) error {
    /* snapshot subs as before */
    for _, s := range cps {
        select {
        case s.ch <- msg:
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return nil
}
```

A subscriber that doesn't drain its channel will stall `PublishSync`. That's the trade-off — you've turned a "lossy fan-out" into "delivers everywhere or fails".

---

## 7. Brokered Pub/Sub (the network universe)

When the topic crosses processes, you reach for a broker. Common Go choices:

| Broker | Delivery | Ordering | Durability | Typical use |
|--------|----------|----------|------------|-------------|
| **NATS Core** | At-most-once | Per-topic, best-effort | None | Fire-and-forget signalling |
| **NATS JetStream** | At-least-once / exactly-once | Per-stream | Disk | Event streams with replay |
| **Kafka** | At-least-once | Per-partition | Disk | High-throughput log |
| **RabbitMQ** | At-least-once | Per-queue | Disk/optional | Work queues + routing |
| **Redis Streams** | At-least-once | Per-stream | Memory/disk | Lightweight streaming |
| **Google Pub/Sub** | At-least-once | Per-topic | Managed | Cloud-native fan-out |

The Go client for each is roughly: dial → subscribe with a handler → block until ctx.Done(). The shape is identical to the in-process broker, but failure modes are real: reconnect storms, message duplication, ordering gaps, schema drift.

---

## 8. Backpressure in the network case

In-process: the channel buffer is your back-pressure mechanism.

Brokered: the broker has its own queues. You pull *batches* from the broker, process them, and either ack (success) or nack (back to the queue). Read-ahead is configurable. Default behaviors:

- Kafka: pull-based, you control the lag.
- NATS JetStream: push or pull. Push respects an in-flight limit.
- RabbitMQ: pull (basic.get) or push (basic.consume) with prefetch.

Common bug: setting prefetch=1000 because "fastest", then a slow consumer holds 1000 messages and nothing else processes them. Tune prefetch to ~2× the per-consumer throughput.

---

## 9. Replay, durability, and ordering

In-process Pub/Sub forgets a message the instant it's delivered. Brokered Pub/Sub usually doesn't:

- **Replay**: re-consume from a past offset. Useful for new consumers joining or recovering from a handler bug.
- **Durability**: messages survive broker restart.
- **Ordering**: per-partition / per-stream / per-key. Cross-partition ordering is generally not guaranteed.

These aren't free. Durable streams cost disk, ordering costs throughput, replay costs storage. Decide what you actually need *before* the broker choice.

---

## 10. Observability essentials

In-process and brokered both deserve:

- `events_published_total{topic}` counter.
- `events_delivered_total{topic, subscriber}` counter.
- `events_dropped_total{topic, subscriber}` (in-process) or `lag` (brokered).
- A histogram of per-message handler duration.
- A correlation/trace ID on every message — propagate it with the payload.

Without metrics on dropped/lagged messages, the failure mode of Pub/Sub is **silence**. A subscriber that "just stopped working" is the worst kind of bug.

---

## 11. Common middle-level mistakes

- **Locking the broker during delivery.** Snapshot subscribers under the lock, deliver outside.
- **Treating in-process Pub/Sub as durable.** A panic kills the messages in flight. Use a broker if you need durability.
- **One global broker for everything.** Topics that should be in separate brokers end up coupled by a single mutex.
- **Forgetting to close subscriber channels on shutdown.** Receivers hang on `for msg := range ch`.
- **Publishing references to mutable structs.** Subscriber 2 sees subscriber 1's mutations. Either send by value or treat messages as immutable.
- **Not tying subscriber lifetime to a context.** Hand-rolled `Unsubscribe()` calls always get forgotten on some error path.

---

## 12. Summary

Middle-level Pub/Sub is two things: (1) building an in-process broker that handles slow subscribers, unsubscribe, and shutdown correctly; (2) knowing when to escalate to a brokered system and picking the right one based on durability, ordering, and replay needs. The Go primitives (channels, mutexes, contexts) make the in-process case ~50 lines. The brokered case is mostly about discipline — schemas, ack semantics, prefetch, observability.

---

## Further reading
- NATS by example (https://natsbyexample.com/) — best Go pub/sub tutorial
- `cloudevents/sdk-go` — schema for events
- Kafka the definitive guide — chapters on consumer groups and offsets
- Sam Newman, *Building Microservices* — chapter on event-driven communication
- `nhooyr.io/websocket` patterns — WebSocket fan-out
- `go.uber.org/fx` event bus — internal-bus example
