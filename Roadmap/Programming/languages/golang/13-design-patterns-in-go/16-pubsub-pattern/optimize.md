# Pub/Sub — Optimization

## 1. How to use this file

Twelve scenarios where Pub/Sub code is slower, allocates more, or delivers fewer messages than it should. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Brokered numbers depend on broker version, network, and disk; treat them as order-of-magnitude.

Pub/Sub spans two universes: in-process channels and over-the-wire brokers. Most in-process wins come from one rule — **never do real work while holding the broker's lock**. Most brokered wins come from another — **size buffers to actual consumer throughput, not vendor defaults**.

Reading order: Exercise 1 (snapshot under lock), 5 and 7 (map index, per-topic shard), 2 and 9 (buffer sizing in-process and prefetch in broker), then the rest in any order.

---

## 2. Exercise 1 — Lock held during delivery

The junior broker locks the subscriber table and sends on every channel under the write lock. One slow subscriber stalls every publisher.

**Before:**

```go
func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, ch := range b.subs[topic] {
        ch <- msg // blocks all publishers if subscriber is slow
    }
}
```

```
BenchmarkPublishUnderLock-8       300000      4800 ns/op   // 8 subs, 1 slow
BenchmarkPublishUnderLock_p99-8                42000 ns/op
```

<details><summary>After</summary>

Snapshot under the lock, release, then send. Slow subscribers stall themselves, not the broker.

```go
func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.RLock()
    cps := make([]chan T, len(b.subs[topic]))
    copy(cps, b.subs[topic])
    b.mu.RUnlock()

    for _, ch := range cps {
        select {
        case ch <- msg:
        default: // drop on slow subscriber
        }
    }
}
```

```
BenchmarkPublishSnapshot-8       5000000       240 ns/op
BenchmarkPublishSnapshot_p99-8                  680 ns/op
```

~20× faster average, ~60× better p99.

**Why faster:** Hot path is RLock (shared) instead of Lock (exclusive). The actual send is outside any lock — a slow subscriber cannot stall the broker. Publishers run concurrently with each other and with unsubscribes.

**Trade-off:** `cps` allocates per Publish — 24 B header + 8 B × N. For very hot brokers, pool the snapshot slice. Snapshot inconsistency: a subscriber that unsubscribed between RUnlock and send still gets the message — fine, the channel is buffered and the cancel goroutine closes it cleanly.

**When NOT:** Single-subscriber topics — no fan-out cost to amortize. `PublishSync` testing brokers that *want* backpressure to surface bugs.
</details>

---

## 3. Exercise 2 — Single-buffered channels for every subscriber

The default `Subscribe(topic, 1)` looks safe — one slot per subscriber. Under spikes the buffer fills instantly and the publisher drops. Buffer size belongs to the consumer's rate, not to a global default.

**Before:**

```go
ch := broker.Subscribe(ctx, "orders", 1)
go func() {
    for m := range ch {
        processOrder(m) // 5ms average
    }
}()
```

```
BenchmarkSub1-8        500000     3200 ns/op   // drop rate 18% at 200 msg/s burst
```

<details><summary>After</summary>

Size buffer = burst length you must absorb without drops. For 50-message bursts at 200 msg/s, buffer ≥ 50.

```go
ch := broker.Subscribe(ctx, "orders", 64)
```

Observe `len(ch)` periodically. Sits at ~buffer-size → back to drops, need faster consumer or work-queue pattern. Sits at ~0 → fine.

```
BenchmarkSub64-8       500000     3200 ns/op   // drop rate 0% at same burst
```

Same CPU cost; drop rate 18% → 0%.

**Why faster (where it counts):** Buffer doesn't change steady-state throughput, but eliminates burst-induced drops. A dropped message often costs ~100× more downstream (extra DB fetch, retry RTT) than its channel footprint.

**Trade-off:** 64 slots × 8 bytes × N subscribers — real memory at scale. A large buffer hides slow consumers; export buffer occupancy as a metric.

**When NOT:** Latency-sensitive topics where stale beats none (presence updates, live cursors). There use buffer=1 with replace-on-publish (keep only newest).
</details>

---

## 4. Exercise 3 — Untyped `any` messages with type switch

A broker holding `any` pays `iface` materialization on every publish and a type switch on every receive — ~5 ns each plus branch mispredictions.

**Before:**

```go
type Broker struct {
    mu   sync.RWMutex
    subs map[string][]chan any
}

for m := range ch {
    switch v := m.(type) {
    case OrderEvent:   handleOrder(v)
    case PaymentEvent: handlePayment(v)
    }
}
```

```
BenchmarkAnyBroker-8     20000000     78 ns/op    16 B/op    1 allocs/op
```

The 16 B/op is the `any` box (heap alloc when value > 2 words).

<details><summary>After</summary>

Generic broker per concrete message type.

```go
type Broker[T any] struct {
    mu   sync.RWMutex
    subs map[string][]chan T
}

orders := New[OrderEvent]()
for m := range ch {
    handleOrder(m) // no switch
}
```

```
BenchmarkTypedBroker-8   60000000     22 ns/op     0 B/op    0 allocs/op
```

~3.5× faster, zero allocations.

**Why faster:** The compiler monomorphizes `Broker[OrderEvent]`. No `iface` materialization, no escape to heap, no type switch. For `T = *Event`, the channel value is a single word.

**Trade-off:** One broker per message type. 30 event types means 30 `Broker[T]` instances. The pre-1.18 ergonomic of one bus for everything is gone. For generic event audit logs, `Broker[*Event]` over a tagged-union root type still works.

**When NOT:** Truly heterogeneous payloads where one loop handles many types. There the type switch is unavoidable.
</details>

---

## 5. Exercise 4 — Per-message allocation for the envelope

A real-world broker wraps each payload in `{ID, Topic, Timestamp, Payload}`. Allocating that envelope on every Publish makes GC the bottleneck on a 100k msg/s topic.

**Before:**

```go
type Envelope[T any] struct {
    ID        uint64
    Topic     string
    Timestamp time.Time
    Payload   T
}

func (b *Broker[T]) Publish(topic string, payload T) {
    env := &Envelope[T]{ID: nextID(), Topic: topic, Timestamp: time.Now(), Payload: payload}
    b.deliver(topic, env)
}
```

```
BenchmarkPublishEnvelope-8   5000000    320 ns/op    64 B/op    1 allocs/op
```

<details><summary>After</summary>

Pool the envelope. Subscriber calls `Release()` after processing.

```go
var envPool = sync.Pool{New: func() any { return &Envelope[OrderEvent]{} }}

func (e *Envelope[T]) Release() {
    var zero T
    e.Payload = zero // help GC drop the payload's references
    envPool.Put(e)
}

func (b *Broker[T]) Publish(topic string, payload T) {
    env := envPool.Get().(*Envelope[T])
    env.ID, env.Topic, env.Timestamp, env.Payload = nextID(), topic, time.Now(), payload
    b.deliver(topic, env)
}
```

```
BenchmarkPublishEnvPooled-8   30000000    52 ns/op    0 B/op    0 allocs/op
```

~6× faster, zero allocations in steady state.

**Why faster:** No `mallocgc` per publish. The envelope's backing memory is recycled. 100k msg/s × 64 B = 6.4 MB/s of garbage avoided.

**Trade-off:** Subscribers must call `Release()`. Missing calls leak one envelope per call until next GC. Broadcast fan-out where N subscribers share the same `*Envelope[T]` cannot release independently — either send by value or reference-count.

**When NOT:** Low-rate brokers (<1k msg/s). Broadcast topics where envelopes are shared — release coordination is harder than the alloc was costly.
</details>

---

## 6. Exercise 5 — Linear subscriber scan on unsubscribe

The junior `subs map[string][]chan T` form makes unsubscribe O(N): scan the slice, then `append` to remove. With hundreds of subscribers churning (web clients connecting/disconnecting), unsubscribe dominates broker CPU.

**Before:**

```go
func (b *Broker[T]) Unsubscribe(topic string, ch chan T) {
    b.mu.Lock()
    defer b.mu.Unlock()
    list := b.subs[topic]
    for i, c := range list {
        if c == ch {
            b.subs[topic] = append(list[:i], list[i+1:]...) // O(N)
            return
        }
    }
}
```

```
BenchmarkUnsubscribeLinear-8   100000    18000 ns/op   // 1000 subs/topic
```

<details><summary>After</summary>

Index subscribers by ID. Unsubscribe becomes `delete(m, id)` — O(1). Publish still iterates O(N), but the churn paths drop to O(1).

```go
type sub[T any] struct {
    id uint64
    ch chan T
}

type Broker[T any] struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]*sub[T]
    nextID atomic.Uint64
}

func (b *Broker[T]) Unsubscribe(topic string, id uint64) {
    b.mu.Lock()
    if s, ok := b.subs[topic][id]; ok {
        delete(b.subs[topic], id)
        close(s.ch)
    }
    b.mu.Unlock()
}
```

```
BenchmarkUnsubscribeMap-8     20000000    62 ns/op    // any topic size
```

~290× faster on unsubscribe.

**Why faster:** `delete(map, key)` doesn't shift backing memory. The slice form's `append(list[:i], list[i+1:]...)` copies `len(list)-i` elements each call — up to 1000 pointer copies for a busy topic.

**Trade-off:** Map iteration order is randomized — fine for broadcast fan-out, but breaks any "first subscriber wins" logic. Map bucket overhead is ~48 B fixed + ~24 B per subscriber vs. ~24 B per slice element — small fixed overhead, win on churn.

**When NOT:** Stable subscriber sets (configuration-time wiring). For 8 fixed subscribers, the slice form is faster on Publish iteration (better cache locality).
</details>

---

## 7. Exercise 6 — JSON encoding for in-process messages

A team reuses the brokered envelope (JSON `[]byte`) for the in-process bus "for consistency". Every publish marshals; every subscriber unmarshals. Pure waste.

**Before:**

```go
func publish(b *Broker[[]byte], topic string, e Event) {
    data, _ := json.Marshal(e)
    b.Publish(topic, data)
}

for raw := range ch {
    var e Event
    json.Unmarshal(raw, &e)
    handle(e)
}
```

```
BenchmarkInprocJSON-8     1000000    1400 ns/op   320 B/op    8 allocs/op
```

<details><summary>After</summary>

Pass the value directly. Reserve JSON for the network hop — encode once at the boundary if you also feed a brokered topic.

```go
bus := New[Event]()
bus.Publish("orders", e)

for e := range ch {
    handle(e) // no decode
}

// edge bridge: encode once, ship to Kafka
go func() {
    out := bus.Subscribe(ctx, "orders", 256)
    for e := range out {
        data, _ := json.Marshal(e)
        kafka.Produce(ctx, "orders", data)
    }
}()
```

```
BenchmarkInprocTyped-8    50000000    25 ns/op    0 B/op    0 allocs/op
```

~56× faster, zero allocations.

**Why faster:** Marshal + unmarshal of a two-field struct is ~10 reflective field accesses, two scratch buffers, one heap allocation each direction. Passing the value on a channel is a small struct copy; the string's backing bytes are shared.

**Trade-off:** "Consistency with the wire format" was real value for debugging. Mitigate with a logging hook (`bus.OnPublish(func(Event) { log.Print(e) })`). If subscribers might mutate the value, send pointers to immutable structs or document immutability.

**When NOT:** When the in-process subscriber genuinely needs the bytes (writing to a file, forwarding without re-encoding). There JSON in the bus is the right representation.
</details>

---

## 8. Exercise 7 — Single broker mutex across all topics

One `sync.RWMutex` guards the entire `subs` map. A chat-room topic with churn contends with a metrics topic doing high-volume Publish.

**Before:**

```go
type Broker[T any] struct {
    mu   sync.RWMutex
    subs map[string]map[uint64]*sub[T]
}
```

```
BenchmarkSingleMutex-8     2000000    580 ns/op   // 16 goroutines, mixed topics
```

<details><summary>After</summary>

Shard by topic hash. A fixed array of buckets, each with its own lock; two topics in different shards are independent.

```go
const shards = 16

type shard[T any] struct {
    mu   sync.RWMutex
    subs map[string]map[uint64]*sub[T]
}

type Broker[T any] struct{ s [shards]*shard[T] }

func (b *Broker[T]) shardFor(topic string) *shard[T] {
    h := fnv.New32a()
    h.Write([]byte(topic))
    return b.s[h.Sum32()&(shards-1)]
}

func (b *Broker[T]) Publish(topic string, msg T) {
    sh := b.shardFor(topic)
    sh.mu.RLock()
    /* snapshot + send as in Exercise 1 */
    sh.mu.RUnlock()
}
```

```
BenchmarkShardedMutex-8   20000000    62 ns/op
```

~9× faster under 16-way concurrent load across mixed topics.

**Why faster:** Each shard's RWMutex is contended by ~`N/shards` goroutines. Cache lines for one shard stay on one core's L1 instead of bouncing. FNV hash is ~6 ns for short topic names.

**Trade-off:** Listing all topics walks all shards. Cross-topic invariants need a higher-level lock — defeating the shard win. Sharding cost outweighs benefit below ~4 goroutines.

**When NOT:** Few topics (≤8) where every topic is hot — you've just traded one mutex for many with the same total contention.
</details>

---

## 9. Exercise 8 — Synchronous Publish in the request hot path

An HTTP handler publishes an audit event before returning. The Publish path waits for every subscriber, adding ~200 µs of subscriber processing to every request.

**Before:**

```go
func handleOrder(w http.ResponseWriter, r *http.Request) {
    save(order)
    bus.PublishSync(ctx, "audit", order) // blocks until every subscriber acks
    w.WriteHeader(200)
}
```

```
BenchmarkHandlerSync-8     5000     280000 ns/op
```

<details><summary>After</summary>

A small bounded buffer decouples the handler from subscriber latency.

```go
type AuditBus struct{ in chan AuditEvent }

func NewAuditBus(buf int) *AuditBus {
    a := &AuditBus{in: make(chan AuditEvent, buf)}
    go func() {
        for ev := range a.in {
            bus.Publish("audit", ev)
        }
    }()
    return a
}

func (a *AuditBus) Submit(ev AuditEvent) {
    select {
    case a.in <- ev:
    default:
        metrics.AuditDropped.Inc() // visibility
    }
}
```

```
BenchmarkHandlerAsync-8    5000000     280 ns/op
```

~1000× faster on the request path.

**Why faster:** The handler does one channel send (<100 ns with room in the buffer) instead of waiting on `len(subs)` sends. Subscriber latency is off the critical path.

**Trade-off:** Events can drop if the buffer fills — a real semantics change, visible in `audit_dropped`. For must-not-drop, replace `default:` with a deadlined send, or persist to a durable queue. Process crash between Submit and consume loses in-flight events.

**When NOT:** Publish that is part of the request's contract — a webhook the caller relies on before the 2xx response. There synchronous is correct; optimize the subscriber instead.
</details>

---

## 10. Exercise 9 — Kafka prefetch tuned to "max"

A team sets `MaxPartitionFetchBytes = 10 MB`, `MaxPollRecords = 1000` because "more is faster". Each consumer holds 1000 in-flight messages for ~1 minute of work; rebalances drop them all back.

**Before:**

```go
opts := []kgo.Opt{
    kgo.FetchMaxBytes(10 << 20),
    kgo.FetchMaxPartitionBytes(10 << 20),
}
records := client.PollFetches(ctx).Records() // ~1000 records
for _, r := range records {
    process(r) // ~60 ms each
}
client.MarkCommitRecords(records...)
```

```
Sustained:    16k msg/s per consumer
Rebalance:    ~10s pause, 1000 records redelivered → 10% duplication
p99 latency:  60s (last record waits behind first 999)
```

<details><summary>After</summary>

Tune prefetch to ~2× the consumer's per-second processing rate. Enough to hide network latency, not enough to stall on rebalance.

```go
opts := []kgo.Opt{
    kgo.FetchMaxBytes(256 << 10),       // 256 KB
    kgo.FetchMaxPartitionBytes(64 << 10),
    kgo.FetchMaxWait(50 * time.Millisecond),
}
for {
    fetches := client.PollRecords(ctx, 32) // ~32 records max
    for _, r := range fetches.Records() {
        process(r)
        client.MarkCommitRecords(r)
    }
}
```

```
Sustained:    16k msg/s per consumer (same — processing is the bottleneck)
Rebalance:    ~10s pause, 32 records redelivered → 0.3% duplication
p99 latency:  2s (each record waits behind at most 31)
```

Same throughput, 30× better p99, 30× less duplication on rebalance.

**Why better:** Kafka fetch is async-pipelined; a small prefetch hides one network RTT per batch without holding hundreds of messages hostage. Rebalances re-deliver only the uncommitted in-flight batch.

**Trade-off:** More frequent commits load the broker's `__consumer_offsets` topic — tune batch size up to where commit overhead is ~5% of consumer CPU (usually 10–32). `FetchMaxWait` adds latency when traffic is sparse.

**When NOT:** Bulk batch jobs where you genuinely want 10k records at once (analytics, replays). There use a dedicated reader with manual offsets, not consumer groups.
</details>

---

## 11. Exercise 10 — One goroutine per topic per subscriber

A subscriber listens to 50 topics. The naive design spawns 50 goroutines, each blocked on its own channel, each calling the same handler.

**Before:**

```go
for _, t := range topics { // 50 topics
    ch := bus.Subscribe(ctx, t, 16)
    go func(topic string, ch <-chan Event) {
        for ev := range ch {
            handle(topic, ev) // handler bounces between 50 stacks
        }
    }(t, ch)
}
```

```
BenchmarkPerTopicGoroutines-8    100000    18000 ns/op
// memory: 50 goroutines × 8 KB stacks = 400 KB
```

<details><summary>After</summary>

Fan-in: every topic feeds one merged channel. Cheap forwarder goroutines park most of the time; one handler goroutine does the work with hot caches.

```go
type Tagged struct {
    Topic string
    Event Event
}

merged := make(chan Tagged, 256)
for _, t := range topics {
    ch := bus.Subscribe(ctx, t, 16)
    go func(topic string, ch <-chan Event) {
        for ev := range ch {
            select {
            case merged <- Tagged{topic, ev}:
            case <-ctx.Done(): return
            }
        }
    }(t, ch)
}
go func() {
    for m := range merged {
        handle(m.Topic, m.Event)
    }
}()
```

`reflect.Select` over 50 channels is conceptually cleaner but costs ~1 µs per case. Cheap forwarders + one handler is the production shape.

```
BenchmarkFanIn-8                500000     3200 ns/op
```

~5.6× faster on per-message processing.

**Why faster:** The handler's working set (caches, locks, downstream connections) stays on one goroutine instead of cold-starting across 50.

**Trade-off:** Handler is single-threaded. If it's CPU-bound, you've serialized work — fix with N workers reading from `merged`. Cross-topic ordering is now scheduler-defined; document it.

**When NOT:** When each topic has heavyweight per-topic state (per-topic stats accumulator with locks). There the per-topic goroutine *is* the locality.
</details>

---

## 12. Exercise 11 — Acking every message individually

A Kafka/RabbitMQ consumer calls `Commit()` after each record. Each commit is a network round-trip. Throughput drops ~10× because the consumer spends most of its time waiting on RTT.

**Before:**

```go
for _, r := range fetches.Records() {
    process(r)
    client.CommitRecords(ctx, r) // sync commit per record
}
```

```
BenchmarkAckPerMsg-8     2000     590000 ns/op   // ~1700 msg/s
```

<details><summary>After</summary>

Batch acks. Process N records, commit the latest offset. On crash, you re-process at most N — that's the at-least-once contract you already had.

```go
const batchAck = 64
records := fetches.Records()
for _, r := range records {
    process(r)
}
client.MarkCommitRecords(records...)
if shouldFlush(records) {
    client.CommitMarkedOffsets(ctx)
}
```

RabbitMQ: use `Ack(deliveryTag, multiple=true)` every 64 deliveries.

```
BenchmarkAckBatched-8    50000    24000 ns/op   // ~42k msg/s
```

~25× faster throughput.

**Why faster:** Each commit is ~0.5–2 ms intra-DC. Batching amortizes to one RTT per 64 messages. The broker also writes offsets more efficiently when batched.

**Trade-off:** On crash, re-process up to `batchAck` records — side effects must be idempotent (usually by message ID dedup). A long-idle consumer might never flush its last partial batch; add a periodic flush.

**When NOT:** When per-message ack is the contract (some financial systems). There focus on reducing commit RTT — move broker closer, use a streaming-ack protocol.
</details>

---

## 13. Exercise 12 — Reconnect with no backoff

A consumer loses its broker connection. The loop calls `Dial` immediately on every error. During a 30s outage the consumer makes 200k connection attempts and gets rate-limited.

**Before:**

```go
for {
    conn, err := nats.Connect(brokerURL)
    if err != nil {
        log.Println("connect failed:", err)
        continue // tight loop
    }
    serve(conn)
}
```

```
BenchmarkTightReconnect-8     // ~30 KQPS of failed dials, broker logs flooded
```

<details><summary>After</summary>

Exponential backoff with jitter. Start ~100 ms, double to a ~30 s cap, ±25% jitter to break herd synchronization.

```go
func connectLoop(ctx context.Context, url string) {
    base, cap := 100*time.Millisecond, 30*time.Second
    delay := base
    for {
        conn, err := nats.Connect(url)
        if err == nil {
            delay = base
            serve(conn)
            continue
        }
        jitter := time.Duration(rand.Int63n(int64(delay)/2)) - delay/4
        select {
        case <-time.After(delay + jitter):
        case <-ctx.Done():
            return
        }
        if delay *= 2; delay > cap {
            delay = cap
        }
    }
}
```

```
BenchmarkBackoffReconnect-8    // ~30 attempts over 30s, broker happy
```

10000× fewer connection attempts during outage; no synchronized herd on recovery.

**Why better:** The broker's TCP accept queue, TLS handshake CPU, and connection-tracking memory stop being a bottleneck. Jitter prevents N consumers from all retrying at the same instant — which would cause a second outage by overloading the just-recovered broker.

**Trade-off:** Higher reconnect latency on recovery — the consumer might sleep up to 30 s before noticing. For latency-sensitive paths, cap lower (5 s). Classify errors — backoff masks non-retryable failures (bad auth, bad URL). Many client libraries (`franz-go`, `nats.go`) include backoff built-in.

**When NOT:** Local development where you want fast feedback. Non-transient failures where retry hides the real problem.
</details>

---

## 14. When NOT to optimize

Most Pub/Sub systems are limited by subscriber work, not by the broker. A handler doing 5 ms of database work cannot benefit from a 50 ns broker optimization.

- Audit topic at 100 events/sec — no hot path, don't pool envelopes.
- Config-change topic with 8 fixed subscribers — no churn, don't index by ID.
- Integration test broker — simplest code wins; `map[string][]chan T` is fine.

**Profile first.** In-process: `go test -bench=. -benchmem -cpuprofile=cpu.out`. Brokered: broker metrics (`records-lag-max`, `slow_consumers`) are more informative than client profiles.

**Common premature optimizations:**

- Sharding the broker map (Ex. 7) with one hot topic.
- Pooling envelopes (Ex. 4) below 1k msg/s.
- Async publish (Ex. 8) when the publisher isn't on a request path.
- Fan-in (Ex. 10) when each topic has heavyweight per-topic state.
- Batching acks (Ex. 11) when the bottleneck is processing, not commit.

**Correctness gaps disguised as optimizations:**

- Dropping silently to "improve throughput" — always count drops.
- Removing the delivery lock without snapshotting (Ex. 1) — races on unsubscribe.
- Removing acks to go faster — at-most-once is a contract, not a choice.

The broker is rarely the bottleneck. Handler latency, downstream queries, and encoding are where the time goes.

---

## 15. Summary

**Always-ship wins** (apply by default in any new Pub/Sub code):

- Snapshot subscribers under the lock, deliver outside (Ex. 1).
- Typed generic `Broker[T]` instead of `Broker[any]` (Ex. 3).
- Index subscribers by ID, not by linear scan (Ex. 5).
- Pass values directly in-process; JSON only at the network boundary (Ex. 6).
- Reconnect with exponential backoff + jitter (Ex. 12) — every brokered client.

**Wins behind a profile** (when measurements justify them):

- Size subscriber buffers from observed bursts (Ex. 2) — when drops show up.
- Pool message envelopes (Ex. 4) — at ≥10k msg/s on one broker.
- Shard the broker mutex by topic (Ex. 7) — many topics with mixed access.
- Move publish off the request path (Ex. 8) — when publish latency shows up in handler traces.
- Tune broker prefetch to ~2× consumer throughput (Ex. 9) — when rebalance redelivery or p99 is high.
- Batch acks (Ex. 11) — when commit RTT shows up in consumer CPU.

**Specialty** (only when the design calls for it):

- Fan-in many topics to one handler (Ex. 10) — one service consuming dozens of topics with shared state.
- Per-subscriber slow-handling policies (drop / block / disconnect) — heterogeneous tolerance.
- Reference-counted envelope pooling — broadcast topics with heavy envelopes.

Pub/Sub performance comes down to three things: don't hold locks during delivery, size buffers to the workload (not defaults), and decide explicitly what happens when consumers fall behind. The Go primitives — channels, mutexes, contexts, generics — make the right shape ~150 lines. The brokered side adds discipline: prefetch, commits, backoff, observability. Measure, profile, then optimize. The broker is rarely where the time goes.
