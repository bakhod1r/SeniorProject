# Pub/Sub — Interview

## 1. How to use this file

This is 25 questions in interview order — junior to staff — plus three live-coding prompts, a concept-check list, and the signals interviewers actually grade on. Each question has a **short answer** (the length you'd give in the room — two to five sentences), and where it matters, a **follow-up to expect** so you're not surprised when the interviewer pushes one layer deeper.

Read top to bottom on first pass. On revision, skim the short answers and re-read only the ones you stumbled on. The live-coding section is for muscle memory — type the solutions out at least once, don't just read them. Pub/Sub is the rare pattern where the vocabulary spans two universes — in-process channels and brokered networks. If you only know one half, an interviewer will catch it inside three questions. Spend equal time on both before showing up.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is the Pub/Sub pattern?

**Short answer:** Publish/Subscribe is a messaging pattern where senders (publishers) emit messages to a named channel (a topic) without knowing who, if anyone, will receive them; receivers (subscribers) declare interest in topics and get any messages emitted there. The publisher and subscriber don't hold direct references to each other — a broker (in-memory or networked) sits in the middle. This decoupling is the whole point: you can add, remove, or restart subscribers without touching publisher code, and vice versa.

**Follow-up to expect:** Is Pub/Sub the same as the GoF Observer pattern? Answer: closely related, not identical. Observer is a one-to-many notification mechanism inside a single process where the subject holds a list of observers. Pub/Sub introduces a third party (the broker/topic) so subject and observer don't know about each other. Pub/Sub also generalizes naturally across processes; Observer doesn't.

---

### Q2. Why decouple publisher from subscriber? What does it buy you?

**Short answer:** Three things. (1) **Independent lifecycles** — subscribers can start, stop, restart, deploy without touching the publisher. (2) **Fan-out for free** — adding a new consumer of an event (audit log, metrics, downstream service) is one subscribe call, not a publisher change. (3) **Failure isolation** — if a subscriber crashes or runs slow, the publisher doesn't notice; the broker absorbs the difference. The cost is that you can no longer reason about "did anyone process this event?" from the publisher's side — that's what acks and observability are for.

**Follow-up to expect:** What's the trade-off vs direct function calls? Answer: direct calls give you synchronous error propagation, stack traces that span the producer and consumer, and one place to set a breakpoint. Pub/Sub trades those for decoupling. For internal logic where both sides ship together, direct calls or Observer is usually cleaner. For cross-service boundaries or audit-style fan-out, the decoupling is worth the debuggability cost.

---

### Q3. Show a minimal in-process Pub/Sub broker in Go.

**Short answer:**

```go
type Broker struct {
    mu   sync.RWMutex
    subs map[string][]chan string
}

func New() *Broker { return &Broker{subs: map[string][]chan string{}} }

func (b *Broker) Subscribe(topic string) <-chan string {
    ch := make(chan string, 16)
    b.mu.Lock()
    b.subs[topic] = append(b.subs[topic], ch)
    b.mu.Unlock()
    return ch
}

func (b *Broker) Publish(topic, msg string) {
    b.mu.RLock()
    defer b.mu.RUnlock()
    for _, ch := range b.subs[topic] {
        select {
        case ch <- msg:
        default: // drop if subscriber is slow
        }
    }
}
```

Three pieces: a topic-keyed map of channels, a `Subscribe` that appends, and a `Publish` that iterates and sends with a `default` arm so a slow subscriber doesn't block the publisher. Real brokers add unsubscribe, context lifetime, and per-subscriber drop policy — but the shape is this.

**Follow-up to expect:** Why the buffered channel? Answer: a zero-buffer channel makes `Publish` synchronously wait for every subscriber to receive. Under fan-out that's catastrophic — one slow handler stalls all publishers. A small buffer (16, 64) absorbs short bursts; the `default` arm drops on overflow so you stay non-blocking in the worst case. The buffer size is a tunable knob, not a magic number.

---

### Q4. Pub/Sub vs Observer — same thing or different?

**Short answer:** Same family, different structure. **Observer** is the GoF pattern: a subject keeps a list of observers and calls `notify()` on each. Subject and observers know about each other through the interface. **Pub/Sub** inserts a broker between them — publishers emit to a topic name (a string), subscribers ask the broker for that topic. Neither side knows the other exists. Pub/Sub generalizes across processes; Observer is in-process. In Go, a `chan T` is essentially Observer; `map[string][]chan T` is essentially Pub/Sub.

**Follow-up to expect:** When do you pick which? Answer: Observer when both sides ship together and you want compile-time safety on the event interface — e.g., a UI widget notifying its parent. Pub/Sub when (a) subscribers are dynamic, (b) you want fan-out by name, (c) the topic might cross a process boundary later. The rule of thumb: if the publisher imports the subscriber's package, you're doing Observer; if it only knows a topic string, you're doing Pub/Sub.

---

### Q5. What is a "topic"?

**Short answer:** A topic is a named channel inside the broker — a string label that publishers attach to messages and subscribers use to declare interest. Topics partition the broker's traffic: a subscriber to `"orders.created"` doesn't see messages on `"users.login"`. Topic naming is its own discipline — flat strings (`"order_created"`), dotted hierarchies (`"orders.created"`, `"orders.shipped"`), or wildcarded (`"orders.*"`, `"orders.>"`) depending on the broker. The topic is the contract between publisher and subscriber; treat it with the same care as a function signature.

**Follow-up to expect:** What's the difference between a topic and a queue? Answer: in most brokers, "topic" implies broadcast (every subscriber gets every message) while "queue" implies work distribution (each message goes to exactly one consumer). Kafka calls both "topics" but distinguishes via consumer groups. NATS Core has subjects (topics); JetStream adds streams and consumers. RabbitMQ has exchanges (topic-like) bound to queues (work-distribution). Vocabulary varies; ask which semantic the interviewer means.

---

### Q6. Where does Pub/Sub appear in the Go standard library?

**Short answer:** Not as a named package — Go's stdlib leaves application-level messaging to userland. But the primitives are everywhere: `chan T` is a one-publisher-to-one-subscriber channel; `context.Context` cancellation propagates as a fan-out signal (every goroutine that selects on `ctx.Done()` is effectively subscribed to a "cancellation" topic); `sync.Cond.Broadcast` notifies all waiters. The `os/signal` package's `Notify(ch, sig)` is also Pub/Sub-shaped — the runtime publishes signals, your goroutine subscribes by channel. Anywhere you see "register a channel, get notified" in the stdlib, it's the Pub/Sub shape one layer down.

**Follow-up to expect:** Any third-party libraries that ship in-process Pub/Sub for Go? Answer: yes — `cskr/pubsub`, `nats-io/nats.go` (in-process mode), and `go.uber.org/fx` event bus. None has overtaken hand-rolling because the pattern is so small (~50 lines for a typed broker). Most teams write their own and only pull in a library when they need brokered features.

---

### Q7. What fan-out shapes exist? Name them.

**Short answer:** Three. **Broadcast** — every subscriber gets every message; classic Pub/Sub. **Queue/work distribution** — each message goes to exactly one of N subscribers; load balancing across workers. **Topic + queue groups (consumer groups)** — multiple groups, each group receives every message, within a group one worker processes it; Kafka's model. Knowing which shape you need *before* writing the broker saves a lot of pain. Don't try to support all three in one broker; pick the one your use case needs and name it.

**Follow-up to expect:** How do you implement queue distribution with Go channels? Answer: a single channel with N goroutines reading from it. Because Go channels are MPMC (multi-producer, multi-consumer) and a send delivers to exactly one receiver, the channel itself does the load balancing — no extra logic. `work := make(chan Msg, 100); for i := 0; i < N; i++ { go worker(work) }; work <- msg` is the whole pattern. The hard part is in brokered systems (Kafka partitions, NATS queue groups) where the same shape needs explicit configuration.

---

## 3. Middle questions (Q8–Q15)

### Q8. A subscriber is slow. What do you do?

**Short answer:** Three policies, pick per-subscriber, not globally. **Drop** — `select { case ch <- msg: default: }` — never blocks, loses messages. Right for metrics, logs, presence updates. **Block** — `ch <- msg` — never loses, can stall the publisher and every other subscriber. Right when the message must be delivered (audit, billing). **Disconnect** — drop the subscriber after N consecutive drops; subscriber re-subscribes if it can recover. Right for chat, real-time feeds where stale data is worse than no data. The wrong move is a single global policy ("we always block" or "we always drop") — different consumers of the same topic have different tolerances.

**Follow-up to expect:** What about a fourth option — increase the buffer? Answer: bigger buffers hide the problem until they don't. A 10,000-element buffer absorbs bursts; under sustained slow consumption, it still fills and you face the same choice. Buffers are smoothing, not a policy. A real policy explicitly says what happens at overflow; buffer size only changes when overflow happens.

---

### Q9. How do you handle unsubscribe correctly?

**Short answer:** Tie subscription lifetime to a `context.Context`, not a manual `Unsubscribe()` call. When the context cancels, a goroutine internal to the broker removes the subscriber from the map and closes the channel. Manual `Unsubscribe()` calls *always* get forgotten on some error path — a panic, an early return, a defer-ordering bug — and forgotten subscriptions leak goroutines and channels forever.

```go
func (b *Broker[T]) Subscribe(ctx context.Context, topic string) <-chan T {
    ch := make(chan T, 16)
    b.add(topic, ch)
    go func() {
        <-ctx.Done()
        b.remove(topic, ch)
        close(ch)
    }()
    return ch
}
```

The caller cancels the context to unsubscribe; everything else happens automatically. Idiomatic Go.

**Follow-up to expect:** Why close the channel? Answer: receivers that read with `for msg := range ch` need the close signal to exit cleanly. Without close, they block forever after the last message. The close also doubles as a "subscription ended" signal — receivers can distinguish "no message yet" (block) from "no more messages ever" (channel closed, zero value returned). Always close on the sender side; never on the receiver.

---

### Q10. What buffer size do you pick for subscriber channels?

**Short answer:** The honest answer is "measure". A buffer of 0 forces synchronous delivery — one slow handler stalls fan-out. A buffer of infinity (unbounded queue) postpones backpressure until OOM. Reasonable defaults: 16–64 for low-rate event streams, 256–1024 for high-throughput pipelines. Pick based on **peak arrival rate × tolerable delivery delay**: if you publish 1000 msg/s and tolerate 100 ms of buffering, you need a 100-element buffer. Bigger buffers absorb bursts but hide slow consumers; smaller buffers surface backpressure faster.

**Follow-up to expect:** What's the cost of an oversized buffer? Answer: three. (1) Memory — N elements × per-element size, per subscriber. (2) Latency — messages sit in the buffer longer when the consumer is slow, so freshness degrades. (3) Hidden failures — a chronically-slow consumer with a 10K buffer looks healthy until it doesn't; you only notice when the buffer fills. The right buffer is the smallest size that absorbs *normal* bursts; sustained slowness should hit the drop/block policy, not the buffer.

---

### Q11. Why is locking the broker during delivery a bug?

**Short answer:** If `Publish` holds the broker's lock while iterating subscribers and sending to each channel, a slow channel blocks the lock. New `Subscribe` calls block. New `Publish` calls block. The broker freezes. The fix is to snapshot the subscriber list under the lock, then release the lock before delivering:

```go
func (b *Broker) Publish(topic string, msg T) {
    b.mu.RLock()
    subs := append([]*sub{}, b.subs[topic]...) // snapshot
    b.mu.RUnlock()
    for _, s := range subs { // deliver outside the lock
        select { case s.ch <- msg: default: }
    }
}
```

A subscriber that arrives mid-publish either gets the message (if it subscribed before the snapshot) or doesn't (if after) — both are acceptable. What's *not* acceptable is the broker locking up because one consumer is slow.

**Follow-up to expect:** What if `Unsubscribe` runs during the snapshot iteration? Answer: the snapshot is a copy of the pointer slice, so the subscriber's struct is still reachable even after `Unsubscribe` removes it from the broker's map. You send to a channel that may already be closed — and `send to closed channel` panics. The fix is to mark the sub as cancelled (atomic flag) and check before send, or to make the channel send recover. Most production brokers use a sentinel: cancelled subs have a nil channel, and `select { case nil <- msg: default: }` is always default.

---

### Q12. When do you use in-process Pub/Sub vs a network broker?

**Short answer:** In-process when (a) all subscribers live in the same binary, (b) you don't need durability across restarts, (c) latency budgets are sub-millisecond. Network broker (Kafka, NATS, RabbitMQ, Redis Streams) when (a) subscribers are different services, (b) messages must survive process death, (c) you need replay/audit, (d) you have hard QPS requirements that exceed one process's CPU. Many systems mix: an in-process bus for cross-package events inside one service, plus a brokered topic for cross-service events. The bridge between them is a goroutine that subscribes to the in-process bus and publishes to the broker.

**Follow-up to expect:** Common mistake mixing the two? Answer: treating the in-process bus as a publication path for cross-service events. Service A emits to its in-process bus, intends for service B to "subscribe somehow" — but they're different processes. A bus only fan-outs within its own process. The mental model that prevents this: an in-process bus is a function call; a brokered topic is an RPC. They're not interchangeable.

---

### Q13. Typed broker vs `any`-message broker — which do you build?

**Short answer:** Typed (generic) when the topic carries one message type — most domain-event buses (`Broker[OrderEvent]`). Compile-time safety, no allocations from `any` boxing, no runtime type switch. `any`-typed when the same broker carries heterogeneous messages — usually a wire-format bus where you've serialized to bytes anyway. The default in Go 1.18+ is generics; reach for `any` only when the message zoo really is heterogeneous.

```go
// Typed broker — one type per broker.
type Broker[T any] struct { /* ... */ }

// any-typed — one broker, many types, handler does type-switch.
type Broker struct { /* subs hold chan any */ }
```

**Follow-up to expect:** What if you need one broker but multiple types? Answer: two options. (1) Make the message a sum type — interface with a sealed set of implementations — and the broker carries that interface. Type-switch in the handler. (2) Run one `Broker[T]` per type; bind topic names by convention. The second is cleaner when types are unrelated; the first is cleaner when they share fan-out semantics. Generics don't compose to "one broker, N types" — that's still `any`.

---

### Q14. Ordering — what guarantees can you make in Go?

**Short answer:** Per-channel, send order is preserved. So a single-publisher, single-subscriber channel sees messages in publish order. With multiple publishers, the channel interleaves them in arrival order at the send statement — not strict, but consistent under happens-before rules. Cross-topic ordering is never guaranteed by Go primitives; you don't know whether `Publish("a", 1)` or `Publish("b", 2)` happened first from a subscriber's point of view unless you coordinate explicitly. In brokered systems, ordering is per-partition (Kafka), per-stream (NATS JetStream), or per-queue (RabbitMQ) — not global.

**Follow-up to expect:** How do you preserve order across multiple consumers? Answer: route by key. Hash the message's key (user ID, order ID) and always send messages with that key to the same channel/partition/worker. Each worker then sees its slice of the stream in order. In Kafka this is the partition key; in NATS JetStream it's subject hashing; in your in-process broker, it's `subs[hash(key) % N] <- msg`. Cross-key ordering is sacrificed; that's the price.

---

### Q15. Durability — what happens when the process crashes?

**Short answer:** In-process Pub/Sub: all in-flight messages are lost. Any message that was buffered in a channel but not yet consumed is gone. Subscribers that were about to be notified will never be. This is fine for transient events (presence, metrics) and catastrophic for important ones (orders, payments). For durability, you need either a brokered system that persists to disk (Kafka, NATS JetStream, RabbitMQ with `durable: true`) or the **outbox pattern**: write the event to your database in the same transaction as the business change, then a separate process reads the outbox and publishes to the broker. The outbox guarantees that the event exists as long as the business change exists.

**Follow-up to expect:** Why not just publish synchronously to the broker inside the transaction? Answer: dual-write problem. If the database commit succeeds and the broker publish fails, your domain says "order placed" but no one downstream knows. If the broker publish succeeds and the database rolls back, you've notified downstream of a fictional order. The outbox sidesteps this by making the database the source of truth and the broker publication eventually-consistent — both can be retried, neither can lie.

---

## 4. Senior questions (Q16–Q22)

### Q16. NATS vs Kafka — when do you pick which?

**Short answer:** Both are pub/sub but optimize for different things. **NATS Core** is ephemeral, fire-and-forget, sub-millisecond — picked for control-plane signaling, request-reply, ephemeral fan-out. **NATS JetStream** adds durability and replay on top, with smaller scale than Kafka but easier ops. **Kafka** is a durable, partitioned log — picked for high-throughput event streams (10K–1M+ msg/s sustained), long retention (days/weeks/forever), and consumer-group semantics with replay-from-offset. Rule of thumb: if you need to **replay weeks of history** or process **>50K msg/s sustained**, Kafka. If you need **<1 ms latency** or want to ship a Pub/Sub layer in a 20 MB binary, NATS. If you're not sure, NATS is easier to back out of.

**Follow-up to expect:** What about RabbitMQ in that comparison? Answer: RabbitMQ is a different shape — a queue broker with routing exchanges, not a log. Best for **work distribution** with rich routing (topic, fanout, direct, headers exchanges), per-message TTL, dead-letter queues. Less optimal as an event log (you can do it, but Kafka does it better). Pick RabbitMQ when you need work queues with sophisticated routing; pick Kafka when you need an immutable event log; pick NATS when you need lightweight pub/sub or modern JetStream streams.

---

### Q17. Exactly-once delivery — is it real?

**Short answer:** Not in the way most people mean. **At-most-once** (deliver, may lose) and **at-least-once** (deliver, may duplicate) are well-defined. **Exactly-once** in the strict sense — every message delivered exactly one time — is impossible over an unreliable network because the sender can't distinguish "you received it, ack lost" from "you didn't receive it". What systems call "exactly-once" is **at-least-once delivery + idempotent processing**: the broker may deliver twice; the consumer deduplicates by message ID. Kafka's "exactly-once semantics" (EOS) does this at the transaction level — produce + commit-offset are atomic within Kafka — but consumers calling external services still need idempotency.

**Follow-up to expect:** How do you make a consumer idempotent? Answer: dedupe by message ID at the boundary where side effects happen. Maintain a `processed_ids` table (Postgres, Redis); on receive, check-and-insert in a transaction; if the ID is already there, ack and skip. Tradeoff: the dedupe table grows; TTL it by retention period. For mathematical idempotency (set the user's email to X), no dedupe needed — re-running is a no-op. For side-effecting work (send the welcome email), dedupe is mandatory.

---

### Q18. Consumer groups — what are they and what problem do they solve?

**Short answer:** A consumer group is a set of consumers that share a topic's load: each partition (Kafka) or each message (NATS queue group) is processed by exactly one member of the group, but different groups all see every message. This solves two things at once: (1) **horizontal scaling** — add consumers to the group, work distributes; (2) **independent subscriber families** — the audit group, the metrics group, and the search-index group each consume the same topic without affecting each other. Without consumer groups you'd have to choose between fan-out and load-balancing; consumer groups give you both, composed.

**Follow-up to expect:** What happens when a consumer in a group dies? Answer: rebalance. The broker reassigns that consumer's partitions to other group members. Kafka does this with the group coordinator protocol; NATS JetStream does it via consumer subscriptions and ack tracking. Rebalances are not free — in-flight messages may be redelivered, processing pauses briefly. Tune `session_timeout_ms` and `heartbeat_interval_ms` (Kafka) so transient hiccups don't trigger rebalances; you want rebalances only when a consumer is genuinely dead.

---

### Q19. Partition keys — what do they buy you and what trap do they set?

**Short answer:** A partition key is a value hashed to pick which partition (Kafka) or subject shard (NATS) a message lands in. The benefit: **all messages with the same key go to the same partition, processed by the same consumer, in order**. So orders for one user stay ordered relative to each other, even though orders across users may interleave. The trap: **hot keys**. If 5% of users generate 80% of traffic and you key by user ID, those keys hash to a handful of partitions and one consumer drowns while the others idle. Mitigations: composite keys (`user_id + bucket_within_user`), key salting for outlier users, or moving to a worker-per-message model for the hot path.

**Follow-up to expect:** What's the cost of changing partition keys? Answer: high. Existing messages keep their old partition assignment until consumed; new messages flow to new partitions. During the transition, ordering guarantees are broken for the same logical entity. Strategies: (1) drain the topic before switching; (2) add a key version and have consumers handle both; (3) live with reordering for a defined window. The lesson: choose your partition key during design; changing it later is migration-level work.

---

### Q20. Design a replay system for an event topic.

**Short answer:** Five pieces. (1) **Durable log** — Kafka, NATS JetStream, or Postgres-as-log; messages retained by time or size, not deleted on consumption. (2) **Offsets, not deletion** — consumers track position; replay resets offset to a past value. (3) **Idempotent consumers** — replay re-delivers; without idempotency, data corrupts. (4) **Replay isolation** — run replays in a separate consumer group so they don't disrupt production. (5) **Rate limiting** — full-speed replay can pummel downstream services that originally handled the load over hours.

```go
// Pseudo-code for a Kafka-backed replay job.
consumer.SeekToOffset(topic, partition, oldOffset)
for { msg := consumer.Poll(timeout); if msg.Offset >= targetOffset { break }; process(msg) }
```

**Follow-up to expect:** What if the schema changed since the old messages were written? Answer: schema evolution discipline. Use a schema registry with backward/forward compatibility rules; replay consumers handle both versions, or you up-convert at the replay boundary. Worst case: a one-off migration consumer transforms old-schema messages into a new topic. Replay debt compounds; the discipline pays back tenfold.

---

### Q21. Observability for Pub/Sub — what must you instrument?

**Short answer:** Without metrics, Pub/Sub fails silently — a subscriber that "just stopped working" is the worst kind of bug. Required signals: (1) **`events_published_total{topic}`** counter — proves the producer is alive. (2) **`events_delivered_total{topic,subscriber}`** counter — proves each subscriber is consuming. (3) **`events_dropped_total{topic,subscriber}`** (in-process) or **`consumer_lag{topic,partition,group}`** (brokered) — surfaces back-pressure. (4) **`handler_duration_seconds{topic,subscriber}`** histogram — finds the slow consumer. (5) **Correlation/trace ID on every message** — propagate via headers; otherwise distributed tracing breaks at every broker hop. Wire these in *before* shipping the bus, not after the first incident.

**Follow-up to expect:** What's the most useful single metric? Answer: consumer lag for brokered systems, drop rate for in-process. Lag tells you "how far behind real-time is each consumer"; growing lag is the canary that something's off. For in-process, the buffer is invisible — drop rate is the only signal that overflows are happening. SLO both: "consumer lag p99 < 30 s", "drop rate < 0.1%". Alert when broken.

---

### Q22. Reconnect storms — what causes them and how do you avoid them?

**Short answer:** When the broker goes down and comes back, every disconnected client tries to reconnect simultaneously. Hundreds of clients hit the broker in the same second, overwhelm it, the broker thrashes or rejects connections, clients retry harder, the broker stays down. The cause is **synchronized retries**. The fix is **jittered exponential backoff**: each client picks a random backoff in `[0, base * 2^attempt]` for some `base` like 100 ms, capped at maybe 30 s. Now reconnects spread across a window; the broker recovers gracefully. Also: a max-retry ceiling so dead clients eventually give up rather than retrying forever.

```go
backoff := time.Duration(rand.Int63n(int64(base) << min(attempt, maxShift)))
time.Sleep(backoff)
```

**Follow-up to expect:** What about the publisher side during a broker outage? Answer: publishers need backpressure too. (1) Don't buffer in memory unbounded — you'll OOM during a long outage. (2) Apply the outbox pattern: write to local storage, drain when broker recovers. (3) Or fail loudly upstream — the API call that triggered the publish returns 503, the upstream client retries with their own backoff. Choose based on tolerance: payment systems use outbox; metrics use bounded buffer + drop. Never use unbounded in-memory queues for cross-process publishes; they're a memory leak waiting for a network hiccup.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Design an event bus from scratch for a Go-based platform.

**Short answer:** Seven decisions, each grounded in a real constraint. (1) **In-process or brokered?** If subscribers might ever be different services, brokered. Otherwise in-process. Mixing is fine, but the bridge needs to be deliberate. (2) **Topic naming** — flat, dotted hierarchy, or wildcarded? Dotted is the modern default (`orders.created`, `*` one segment, `>` rest). Establish before the first producer ships. (3) **Schema discipline** — Protobuf for stability, JSON for debuggability, Avro for Kafka, CloudEvents for interop. Version it; run a schema registry. (4) **Delivery semantics** — at-most-once for telemetry, at-least-once + idempotent consumers for everything else. Document per topic. (5) **Ordering** — strict ordering is rarely worth the cost; per-key is the sweet spot. Document the partition key on every topic. (6) **Retention and replay** — default 7 days, allow replay only by ops, handle PII (right-to-be-forgotten kills replay). (7) **Observability and circuit breaking** — metrics, traces, lag alerts, kill switch for runaway publishers. A staff candidate names the **schema as the contract**, not the code; treat schema changes with API-level rigor.

**Follow-up to expect:** What's the cost of getting topic names wrong? Answer: migration. Once a topic name is in production, all producers and consumers depend on it. Renaming requires dual-writing to old and new topics, migrating consumers one by one, then retiring the old topic. Weeks of work. The lesson: spend an hour on naming before shipping the first producer; you'll spend a week on it later.

---

### Q24. Mixed in-process + brokered Pub/Sub — how do you bridge them?

**Short answer:** A **bridge goroutine** that subscribes to the in-process bus and publishes to the broker. Conceptually simple, several real concerns.

```go
func Bridge(ctx context.Context, bus *Broker[Event], producer KafkaProducer, topic string) {
    sub := bus.Subscribe(ctx, "domain.events")
    for {
        select {
        case <-ctx.Done():
            return
        case ev, ok := <-sub:
            if !ok { return }
            // The danger: publish failure here loses the event.
            // Solution: write to outbox table first.
            if err := producer.Publish(topic, ev); err != nil {
                outbox.Store(ev) // durable fallback
            }
        }
    }
}
```

(1) **Failure handling** — broker publish failure loses the in-process event unless you outbox first. In-process subscribers write to a database table; a separate process drains it. Crash-safe. (2) **Backpressure** — slow broker makes the bridge fall behind, in-process drop policy kicks in. Outbox neutralizes this: write to disk, bridge slowness no longer affects publishers. (3) **Schema translation** — Go structs to bytes (JSON/Protobuf). Validate against schema registry at the bridge; fail fast on mismatch. (4) **Trace propagation** — serialize trace context into broker headers; otherwise traces break at every hop. (5) **Bridge fan-out** — one in-process topic → multiple broker topics; run one bridge per destination, each with its own outbox lane. A staff candidate notes: the bridge is **the most failure-prone component**. Test it under broker outage (back off? OOM?), under in-process overload (drop the right things?), under restart (outbox drains without duplicates?).

**Follow-up to expect:** What if the broker is the source of truth and you want to bridge *into* the in-process bus? Answer: same shape, opposite direction. A goroutine subscribes to the broker, deserializes, publishes to the in-process bus. The failure mode is "what if no in-process subscriber is listening?" — usually fine (in-process bus drops with metric increment), occasionally not (if an in-process subscriber is the only consumer of a critical event, broker-side ack semantics need to wait for in-process delivery). Be explicit about which direction is authoritative.

---

### Q25. Multi-region Pub/Sub replication — what's the design?

**Short answer:** Three architectural choices. (1) **Active-active with mirror** — Kafka MirrorMaker 2, NATS JetStream source/mirror, RabbitMQ federation. Each region has its own cluster; a mirror copies topics across. Pros: regional outage tolerance, local reads. Cons: cross-region lag (50–200 ms), no global ordering, divergence risk on shared keys. (2) **Active-passive with failover** — primary accepts writes, replicates to secondary; on outage, promote secondary. Pros: simpler consistency, per-partition ordering preserved. Cons: secondary is idle until disaster, failover is rare and prone to bugs because nobody practices it. (3) **Geo-partitioned** — each region owns a slice of the keyspace; writes go to the owning region. Pros: no cross-region writes steady-state. Cons: edge routing logic, partition boundaries shift with load. The **right choice depends on the cost of inconsistency**. Payments: active-passive, accept downtime for correctness. Social feed: active-active with last-write-wins. IoT telemetry: geo-partitioned. A staff candidate also names the **replication-lag observability gap**: most teams monitor broker health but not replication lag, so "the secondary is fine!" right up until failover discovers it's 4 hours behind. SLO replication lag (p99 < 30 s); practice failover quarterly.

**Follow-up to expect:** How do you handle topic-level configuration drift across regions? Answer: declarative configuration with GitOps. Topic specs (partition count, retention, ACLs) live in a Git repo; a controller (Strimzi for Kafka, NATS account JWTs for NATS) applies them to every cluster. Drift detection runs continuously — if region A has 12 partitions on a topic and region B has 24, mirroring breaks subtly. The controller catches this and either reconciles or alerts. Manual `kafka-topics --alter` on one cluster is the start of an outage three weeks later.

---

## 6. Live-coding prompts

### Prompt 1: Tiny in-process broker with context-based unsubscribe

**Problem.** Implement `Broker[T any]` with `Subscribe(ctx, topic) <-chan T` and `Publish(topic, msg T)`. Unsubscribe happens automatically when the context cancels — the channel is removed and closed. `Publish` must not block on slow subscribers; drop instead.

**Answer.**

```go
package pubsub

import (
    "context"
    "sync"
)

// One Broker per message type — generics avoid any-boxing.
type Broker[T any] struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]chan T
    nextID uint64
}

func New[T any]() *Broker[T] {
    return &Broker[T]{subs: map[string]map[uint64]chan T{}}
}

// Subscription lifetime tied to ctx — no manual Unsubscribe call,
// because manual unsubscribes always get forgotten on some error path.
func (b *Broker[T]) Subscribe(ctx context.Context, topic string) <-chan T {
    ch := make(chan T, 16) // small buffer absorbs short bursts

    b.mu.Lock()
    if b.subs[topic] == nil {
        b.subs[topic] = map[uint64]chan T{}
    }
    b.nextID++
    id := b.nextID
    b.subs[topic][id] = ch
    b.mu.Unlock()

    // On ctx cancel: remove from broker, close channel so `for msg := range ch` exits.
    go func() {
        <-ctx.Done()
        b.mu.Lock()
        delete(b.subs[topic], id)
        if len(b.subs[topic]) == 0 {
            delete(b.subs, topic)
        }
        b.mu.Unlock()
        close(ch)
    }()

    return ch
}

// Snapshot subs under the lock, deliver outside. Delivery under the lock
// would freeze the broker on any slow subscriber — most common Pub/Sub bug.
func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.RLock()
    subs := make([]chan T, 0, len(b.subs[topic]))
    for _, ch := range b.subs[topic] {
        subs = append(subs, ch)
    }
    b.mu.RUnlock()

    for _, ch := range subs {
        select {
        case ch <- msg:
        default: // drop; real broker increments per-sub drop counter
        }
    }
}

// Caller:
//   b := pubsub.New[string]()
//   ctx, cancel := context.WithCancel(context.Background()); defer cancel()
//   sub := b.Subscribe(ctx, "events")
//   go func() { for msg := range sub { log.Println(msg) } }()
//   b.Publish("events", "hello")
```

Senior moves: (a) `Subscribe` returns a receive-only channel — callers can't accidentally `close()` it; (b) snapshot-then-deliver is the headline correctness move; (c) cleanup goroutine handles removal and close, so receivers exit `for ... range` naturally; (d) per-topic map cleaned when the last sub leaves; (e) generics avoid `any` boxing.

---

### Prompt 2: Wildcard topic matching (NATS-style "orders.*.created")

**Problem.** Extend the broker so subscribers can use wildcards: `*` matches exactly one segment, `>` matches one or more segments to the end. So `"orders.*.created"` matches `"orders.123.created"` but not `"orders.123.shipped"` or `"orders.created"`. `"orders.>"` matches `"orders.123"`, `"orders.123.created"`, etc. Show the matcher.

**Answer.**

```go
package pubsub

import "strings"

// matches reports whether a published topic matches a subscriber's
// pattern. Both are dotted strings; pattern may contain "*" (one
// segment wildcard) and ">" (multi-segment wildcard, must be last).
//
// Examples:
//   matches("orders.created",        "orders.created")        = true
//   matches("orders.created",        "orders.*")              = true
//   matches("orders.123.created",    "orders.*.created")      = true
//   matches("orders.123.created",    "orders.>")              = true
//   matches("orders",                "orders.>")              = false  ("orders.>" requires at least one more segment)
//   matches("orders.123",            "orders.*.created")      = false
func matches(topic, pattern string) bool {
    t := strings.Split(topic, ".")
    p := strings.Split(pattern, ".")

    for i, seg := range p {
        if seg == ">" {
            // ">" must be the last segment; it matches one or more
            // remaining topic segments. Validation could enforce this
            // at subscribe time; here we just check at match time.
            return i < len(t) && i == len(p)-1
        }
        if i >= len(t) {
            // Pattern has more segments than topic — no match.
            return false
        }
        if seg == "*" {
            // Single-segment wildcard matches any one segment.
            continue
        }
        if seg != t[i] {
            return false
        }
    }
    // All pattern segments matched. Topic must have no extras.
    return len(t) == len(p)
}

// PublishWildcard fans out a message to every subscriber whose pattern
// matches the topic. The broker stores subs keyed by pattern; we walk
// all patterns and test each against the published topic.
//
// Trade-off: O(num_patterns) per publish. For thousands of patterns,
// build a trie keyed by segment. NATS uses a trie; for in-process
// brokers with <100 patterns, linear scan is fine.
func (b *Broker[T]) PublishWildcard(topic string, msg T) {
    b.mu.RLock()
    var targets []chan T
    for pattern, subs := range b.subs {
        if !matches(topic, pattern) {
            continue
        }
        for _, ch := range subs {
            targets = append(targets, ch)
        }
    }
    b.mu.RUnlock()

    for _, ch := range targets {
        select {
        case ch <- msg:
        default:
        }
    }
}
```

Senior moves: (a) explicit semantics for `*` (one segment) vs `>` (rest); (b) the linear-scan trade-off named — fine for hundreds of patterns, build a trie at thousands; (c) the snapshot-then-deliver pattern carries over from Prompt 1; (d) `">"` placement validation is acknowledged as a subscribe-time concern, not a match-time one; (e) test cases in the comment let an interviewer immediately verify edge cases without rerunning code.

---

### Prompt 3: Outbox-pump from Postgres to Kafka

**Problem.** Implement an outbox pump that reads unprocessed rows from a Postgres `outbox` table, publishes each to Kafka, and marks the row processed. Must be safe under multiple pump instances (no duplicate publishes), survive crashes mid-publish, and process rows in insertion order per aggregate (key). Show the SQL and Go.

**Answer.**

```sql
-- aggregate_id is the partition key; processed_at NULL means pending.
CREATE TABLE outbox (
    id              BIGSERIAL PRIMARY KEY,
    aggregate_id    TEXT NOT NULL,
    topic           TEXT NOT NULL,
    payload         BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ
);
CREATE INDEX outbox_pending ON outbox (id) WHERE processed_at IS NULL;
```

```go
package outbox

import (
    "context"
    "database/sql"
    "time"
)

type KafkaProducer interface {
    Publish(ctx context.Context, topic, key string, payload []byte) error
}

type Pump struct {
    db       *sql.DB
    producer KafkaProducer
    batch    int
    interval time.Duration
}

func New(db *sql.DB, producer KafkaProducer) *Pump {
    return &Pump{db: db, producer: producer, batch: 100, interval: time.Second}
}

// Run polls on a ticker. Each cycle reads unprocessed rows, publishes,
// marks processed. Crash-safe: mark-processed happens after publish;
// on restart, unprocessed rows replay. At-least-once — consumers must
// dedupe by outbox.id.
func (p *Pump) Run(ctx context.Context) error {
    t := time.NewTicker(p.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            _ = p.tick(ctx) // transient errors recover next tick; real code adds backoff
        }
    }
}

func (p *Pump) tick(ctx context.Context) error {
    // FOR UPDATE SKIP LOCKED is the key — multiple pump instances can
    // run safely; each grabs a different batch, others skip locked rows.
    rows, err := p.db.QueryContext(ctx, `
        SELECT id, aggregate_id, topic, payload
        FROM outbox WHERE processed_at IS NULL
        ORDER BY id LIMIT $1
        FOR UPDATE SKIP LOCKED`, p.batch)
    if err != nil { return err }
    defer rows.Close()

    type job struct{ id int64; aggregateID, topic string; payload []byte }
    var jobs []job
    for rows.Next() {
        var j job
        if err := rows.Scan(&j.id, &j.aggregateID, &j.topic, &j.payload); err != nil {
            return err
        }
        jobs = append(jobs, j)
    }

    // aggregate_id as partition key preserves per-aggregate ordering.
    // Synchronous publishes — async would risk marking processed before
    // the broker acked.
    for _, j := range jobs {
        if err := p.producer.Publish(ctx, j.topic, j.aggregateID, j.payload); err != nil {
            return err // next tick retries; idempotent consumers handle dupes
        }
        if _, err := p.db.ExecContext(ctx,
            `UPDATE outbox SET processed_at = now() WHERE id = $1`, j.id); err != nil {
            // Publish succeeded but mark failed; republish next tick.
            return err
        }
    }
    return nil
}
```

Senior moves: (a) `FOR UPDATE SKIP LOCKED` is the headline correctness move — multiple pump instances coordinate without explicit locking; (b) `aggregate_id` as Kafka partition key preserves per-aggregate ordering; (c) mark-after-publish ordering is named — a crash between the two causes duplicates, which is why consumers must be idempotent; (d) batch size and tick interval are constructor parameters; (e) the comments name what's missing in production — backoff on error, metrics, dead-letter for poison messages.

---

## 7. Concept checks

If you can't answer any of these in one breath, study more before the interview.

- What's the difference between Pub/Sub and Observer? (Pub/Sub has a broker in the middle; publisher and subscriber don't know each other. Observer is direct: subject holds a list of observers.)
- Why decouple publisher from subscriber? (Independent lifecycles, free fan-out, failure isolation. Cost: harder to reason about end-to-end success.)
- What's a topic? (Named channel inside the broker; partitions traffic by name. The contract between publisher and subscriber.)
- Name the three fan-out shapes. (Broadcast, queue/work distribution, topic + consumer groups.)
- What's the slow-subscriber problem and the three policies? (Subscriber can't keep up. Drop, block, or disconnect — per-subscriber, not global.)
- Why is locking the broker during delivery a bug? (One slow subscriber blocks the lock, freezing the whole broker. Snapshot under lock, deliver outside.)
- How do you unsubscribe correctly? (Tie subscription lifetime to a context. Manual Unsubscribe calls get forgotten.)
- When do you use in-process vs brokered Pub/Sub? (In-process for same-binary fan-out, sub-ms latency, no durability. Brokered for cross-service, durability, replay.)
- What's the dual-write problem and what fixes it? (Database commit + broker publish can't be atomic without 2PC. Outbox pattern: write to DB outbox in the same transaction, drain separately.)
- What's the difference between at-most-once and at-least-once? (At-most-once may lose messages; at-least-once may duplicate. Exactly-once requires idempotent consumers.)
- What's a consumer group? (Set of consumers sharing a topic's load — each message goes to one group member, but different groups all see every message.)
- What's a partition key and what trap does it set? (Routes messages to partitions for ordering. Hot keys send all traffic to one partition and one consumer drowns.)
- Why do reconnect storms happen and how do you prevent them? (Synchronized retries overwhelm the broker. Jittered exponential backoff spreads them.)
- What three metrics are mandatory for any Pub/Sub system? (Published count, delivered/dropped count, handler duration. Plus correlation IDs on messages.)
- NATS vs Kafka in one sentence each? (NATS: ephemeral, low-latency, lightweight. Kafka: durable, high-throughput, replay-from-offset.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Locking the broker during delivery.** Candidate holds the mutex while iterating and sending; doesn't see how one slow subscriber freezes everything.
- **Manual Unsubscribe instead of context.** "We have an Unsubscribe method" — fine, but no recognition that callers forget to call it on error paths and leak goroutines forever.
- **Zero-buffer subscriber channels.** Treats every publish as synchronous fan-out; under any subscriber slowness the publisher blocks indefinitely.
- **`Publish` blocks on full channels.** No drop/block/disconnect policy named; default is "send into channel, hope for the best".
- **In-process bus for cross-service events.** Tries to use a Go in-process broker to communicate between services. Doesn't grasp the process boundary.
- **No mention of durability.** When asked about important events surviving restarts, candidate has no answer beyond "use a database somehow".
- **Confuses topics and queues.** Treats them as the same thing; doesn't distinguish broadcast from work distribution.
- **"Kafka guarantees exactly-once."** Repeats marketing without naming the at-least-once + idempotent-consumer reality.
- **No observability story.** Doesn't mention lag, drops, or correlation IDs. The pattern fails silently and the candidate doesn't see it.
- **One global slow-subscriber policy.** "We always drop" or "we always block" — no per-subscriber tuning, no understanding that different consumers have different needs.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Snapshot under lock, deliver outside.** Names this pattern unprompted as the headline correctness move for in-process brokers. Has been bitten by the alternative.
- **Context-based unsubscribe.** Reaches for `ctx.Done()` instead of an `Unsubscribe()` method without prompting. Knows the manual-cleanup foot-gun.
- **Per-subscriber drop policy.** When asked about slow subscribers, distinguishes drop vs block vs disconnect and ties each to a use case (metrics drop, billing blocks, chat disconnects).
- **Names the dual-write problem.** When asked about durable events, brings up the database-broker dual-write problem and the outbox pattern as the fix. Has implemented one.
- **Idempotent consumers as a discipline.** Treats at-least-once + idempotency as the practical "exactly-once" and explains how to dedupe at the consumer side.
- **Partition keys for ordering.** When asked about ordering, brings out partition keys and the hot-key trap. Has seen one consumer drown in production.
- **Outbox pattern in their toolkit.** Mentions outbox-pump unprompted when discussing crash safety. Knows the Postgres `FOR UPDATE SKIP LOCKED` trick.
- **Jittered exponential backoff.** Names jitter as the cure for reconnect storms, not just "exponential backoff".
- **Observability before deployment.** Wires lag, drops, and trace IDs into the design from day one. Has been on call for a silent Pub/Sub outage and learned the lesson.
- **Knows when not to use Pub/Sub.** Mentions that direct function calls or HTTP RPC is right when you need synchronous error propagation. Doesn't reach for Pub/Sub as a default.

---

## 10. Further reading

- **NATS by Example**: <https://natsbyexample.com/> — best practical Go pub/sub tutorial in the ecosystem; covers core, JetStream, queue groups, and request-reply with runnable Go code.
- **Confluent's Kafka Definitive Guide (free PDF)**: <https://www.confluent.io/resources/kafka-the-definitive-guide-v2/> — chapters on consumer groups, offset semantics, and exactly-once are required reading for anyone using Kafka at scale.
- **CloudEvents specification**: <https://cloudevents.io/> — vendor-neutral event envelope format; reading the spec teaches schema discipline whether or not you adopt it.
- **Sam Newman, *Building Microservices, 2nd ed.***: chapter on event-driven communication and the choreography-vs-orchestration debate. Essential framing for when to reach for Pub/Sub at the service boundary.
- **Pat Helland, *Life beyond Distributed Transactions***: <https://www.ics.uci.edu/~cs223/papers/cidr07p15.pdf> — the canonical paper on why dual-writes break and how to design around them. The outbox pattern is a direct descendant.
