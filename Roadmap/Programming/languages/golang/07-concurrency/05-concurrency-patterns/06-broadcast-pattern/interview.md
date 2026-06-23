# Broadcast Pattern — Interview Q&A

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff Questions](#staff-questions)

---

## Junior Questions

### Q1. What is a broadcast in Go?

Sending the same message to many receivers. Go channels are point-to-point by default (one send, one receive), so broadcasting requires extra work: either close a channel (to wake everyone with a one-time signal) or have a hub goroutine that forwards each event to a list of subscriber channels.

### Q2. What happens when you close a channel?

Every current and future receive on that channel returns immediately with the zero value and `ok=false`. The channel state is permanently "closed." Sending on a closed channel panics. Closing a closed channel panics.

### Q3. Why is `chan struct{}` the conventional type for "done" channels?

The signal is the *event* of closing, not the value sent. `struct{}` takes zero bytes, so the channel and any values carried cost almost nothing. It also makes accidental sends syntactically obvious — you can spot `done <- struct{}{}` in review.

### Q4. Why is `close(done)` called "broadcast"?

Because every goroutine blocked on `<-done` wakes up simultaneously. One operation, many wake-ups. That is the defining shape of broadcast.

### Q5. Can `close()` be called more than once on the same channel?

No — it panics. Protect with `sync.Once`:

```go
var once sync.Once
stop := func() { once.Do(func() { close(done) }) }
```

### Q6. What does `sync.Cond.Broadcast()` do?

Wakes every goroutine currently blocked in `cond.Wait()` on the same `Cond`. Each waiter, on wake, re-acquires the associated mutex and re-checks its predicate. If the predicate is still false, it goes back to waiting; if true, it proceeds.

### Q7. What is the slow-subscriber problem?

When one subscriber's receive is slow (or paused), the hub goroutine blocks on `s.ch <- v` for that subscriber, which prevents delivery to all other subscribers. Head-of-line blocking.

### Q8. Why can't I write `c <- v` in a loop to broadcast to N goroutines?

Because each send delivers to exactly one receiver. After N sends, you have reached N receivers, but you need to know who they are in advance, they must all be waiting at the same time, and any new subscriber later is missed. You need a hub for dynamic subscription.

### Q9. What goroutine should close a subscriber's channel?

The hub. Subscribers should never close their own channel. Letting subscribers close means the hub might send on a closed channel (panic).

### Q10. What is the difference between fan-out and broadcast?

Fan-out splits *different* values across N workers — each value is handled by one worker. Broadcast sends the *same* value to N subscribers — each subscriber sees every value.

---

## Middle Questions

### Q11. Sketch a thread-safe pub/sub hub in Go.

```go
type Hub[T any] struct {
    mu   sync.RWMutex
    subs map[*sub[T]]struct{}
}
type sub[T any] struct{ ch chan T }

func (h *Hub[T]) Subscribe() *sub[T] {
    h.mu.Lock(); defer h.mu.Unlock()
    s := &sub[T]{ch: make(chan T, 16)}
    h.subs[s] = struct{}{}
    return s
}

func (h *Hub[T]) Unsubscribe(s *sub[T]) {
    h.mu.Lock(); defer h.mu.Unlock()
    if _, ok := h.subs[s]; ok {
        delete(h.subs, s)
        close(s.ch)
    }
}

func (h *Hub[T]) Publish(v T) {
    h.mu.RLock(); defer h.mu.RUnlock()
    for s := range h.subs {
        select {
        case s.ch <- v:
        default: // drop on overflow
        }
    }
}
```

### Q12. Why use `RWMutex` instead of `Mutex`?

Publish only reads the subscription map; many publishes can run concurrently under `RLock`. Subscribe/Unsubscribe mutate the map and take `Lock`. For workloads with many more publishes than subscribes, this scales much better.

### Q13. Walk me through the three overflow policies.

- **Block:** publisher waits until the subscriber's channel has room. Latency for everyone tracks the slowest. Use when no event may be lost.
- **DropNewest:** if buffer is full, discard the new event for that subscriber. The buffer keeps older events. Use for backpressured streams where recent events do not matter much.
- **DropOldest:** make room by removing an oldest event, then enqueue the new one. Use for "latest is most valuable" streams (metrics, ticks, snapshots).

### Q14. How do you implement DropOldest?

```go
for {
    select {
    case s.ch <- v: return
    default:
        select {
        case <-s.ch: // drop one
        default: return // raced
        }
    }
}
```

Try to send. If full, try to receive (drop oldest). Retry the send. Inner default handles a concurrent drain.

### Q15. What's wrong with this code?

```go
func (h *Hub) Publish(v T) {
    h.mu.Lock()
    defer h.mu.Unlock()
    for _, s := range h.subs {
        s.ch <- v
    }
}
```

Two problems. First, holding the write lock while sending means subscribe/unsubscribe blocks until publish completes (severe contention). Second, if `Block` policy and a slow subscriber, the entire hub freezes — and during that freeze, no one can subscribe or unsubscribe either. Use `RLock` and a drop policy.

### Q16. How do you make `Unsubscribe` idempotent?

Wrap in `sync.Once`:

```go
type handle struct {
    once sync.Once
    fn   func()
}
func (h *handle) Unsubscribe() { h.once.Do(h.fn) }
```

The inner `fn` checks the map before deleting and closing. Both layers protect against the double-close panic.

### Q17. What is the buffer-size trade-off?

Too small → slow subscribers stall the hub (in Block) or drop everything (in Drop). Too large → memory grows; a slow subscriber pins MBs–GBs. Default 16–64 for most workloads.

### Q18. How do you cleanly shut down a Hub?

```go
hub.Close()
// Close should:
//   1. Set closed=true under lock
//   2. Close every subscriber channel
//   3. Clear the subscription map
//   4. Close hub.done
// Use sync.Once around the whole sequence.
```

Subscribers see `ok=false` on their next receive and exit naturally.

### Q19. Why do we accept `context.Context` in `Publish`?

So a publisher can give up if the caller's deadline expires (e.g., HTTP request cancelled). Without ctx, a publish blocked on a stuck subscriber could leak the calling goroutine permanently.

### Q20. How do you test broadcast correctness?

Subscribe N times, publish K values, assert every subscriber received exactly those K values in order. For slow-subscriber tests, have one subscriber that never reads and assert the others still receive. Always run with `-race` and `goleak.VerifyNone(t)`.

---

## Senior Questions

### Q21. How would you redesign to avoid lock contention at very high publish rate?

Copy-on-write subscriber list:

```go
type hub struct {
    subs atomic.Value // []*sub
    mu   sync.Mutex   // only for mutators
}
```

Publish loads the slice atomically — no lock. Subscribe copies the slice, appends, stores. Subscribe is O(N); Publish is lock-free. Wins when publish rate ≫ subscribe rate.

### Q22. Walk me through subscribe-during-broadcast semantics.

If you use `RWMutex` (Publish takes RLock, Subscribe takes Lock), Subscribe waits for in-flight publishes to complete, then adds to the map. The new subscription sees only events published after Subscribe returns. This is a linearisable behaviour — easy to reason about.

If you want a new subscriber to see the current event, you need a snapshot mechanism: a bounded history buffer and `SubscribeWithReplay(n)` returning both the channel and the last `n` events.

### Q23. How does unsubscribe-during-broadcast interact with the hub?

Under `RWMutex`, Unsubscribe waits for in-flight publish to release `RLock`. The publish either delivers to this subscriber (and unsubscribe removes them after) or has already moved past them (unsubscribe is clean). The hub never sends on the closed channel because deletion and close happen atomically under `Lock` after publish exits.

### Q24. Design a broadcast hub that eject slow subscribers.

```go
func (h *hub) deliver(s *sub, v T) {
    select {
    case s.ch <- v:
    default:
        h.evict(s) // removes from map and closes channel
    }
}
```

`evict` takes the write lock to delete safely. The subscriber sees `ok=false` and knows they were dropped. This is the same pattern as Redis' `client-output-buffer-limit`.

### Q25. When would you prefer `sync.Cond.Broadcast` over channel-based broadcast?

When the predicate is complex shared state already guarded by a mutex you have, and waiters need to re-check it after waking. Example: a work queue with multiple priority levels — waiters wake on `Push` and check whether any item matches their priority.

Channels are still preferred in most Go code because they integrate with `select` and `ctx.Done()`. `Cond.Wait` does neither natively.

### Q26. How do you make a `sync.Cond` cancellable?

Run a watchdog goroutine that calls `cond.Broadcast()` when `ctx.Done()` fires. Waiters re-check both the predicate and `ctx.Err()`:

```go
go func() {
    <-ctx.Done()
    cond.Broadcast()
}()

for !pred && ctx.Err() == nil {
    cond.Wait()
}
if ctx.Err() != nil { return ctx.Err() }
```

Fragile, but the standard workaround.

### Q27. Explain the memory-model guarantees for a Hub.

A publisher's writes before `Publish(v)` are visible to every subscriber's goroutine after their receive of `v`. Each channel send synchronises with each channel receive. The mutex guarding the subscription map also provides visibility for the map itself. Subscribers do not need additional synchronisation to read `v` — but they should not mutate it concurrently with the publisher.

### Q28. How would you instrument a Hub for production?

- Counter: `publish_total{topic=}`
- Counter: `publish_dropped_total{topic=,sub_id=}`
- Gauge: `subscribers{topic=}`
- Gauge: `subscriber_buffer_fill_pct{sub_id=}` (sampled)
- Histogram: `publish_latency_ms{topic=}`
- Counter: `subscriber_ejected_total{topic=}`

Alert on sustained buffer fill > 80% and on ejection rate > 0.

### Q29. How do you design replay (subscriber sees past events)?

For bounded replay: hub maintains last K events under the same lock as subscriptions. `SubscribeWithReplay()` takes a snapshot of recent events, then registers the subscription. Caller processes snapshot first, then ranges over the live channel.

For unbounded replay: do not use channels. Use a log (file-backed ring buffer, Kafka, Redis Streams). Subscribers track offsets; the hub serves from a given offset.

### Q30. What's the difference between a hub and a topic?

A *hub* is one broadcast pipeline. A *topic* is a named channel within a multi-topic system. A multi-topic system typically maps topic names to hubs (`map[string]*Hub`). Subscribing to a topic returns a subscription to that hub. Publish to a topic finds the hub and delegates.

---

## Staff Questions

### Q31. Compare Redis Pub/Sub, NATS, ZeroMQ, and Kafka for broadcast.

- **Redis Pub/Sub:** simplest, sub-ms, fire-and-forget. No durability, no backpressure. Good for cache invalidation.
- **NATS:** purpose-built, 1M+/sec, subject hierarchies. JetStream adds durability. Replaces Pub/Sub at the next scale tier.
- **ZeroMQ:** brokerless library, raw speed. No durability, no discovery. Specialised use cases.
- **Kafka:** log-based, durable, replay-able, slowest of the bunch. Use when you need replay or audit.

Most production systems mix two: NATS for ephemeral, Kafka for durable, with in-process channels for the last hop inside each service.

### Q32. Architecturally, how would you broadcast a config change to 10,000 servers?

One config service publishes to a Kafka topic with retention long enough for slow consumers to catch up. Each server subscribes with a unique consumer group ID. New version → publish once → every server receives. Servers commit offset only after applying the config, so a crash mid-apply replays the same version on restart.

Optional layer: a fast-path NATS topic broadcasts a "wake up and fetch from Kafka" signal, so servers do not need to poll Kafka aggressively.

### Q33. Your Go service is a WebSocket fan-out for 50,000 concurrent clients. Describe the architecture.

- One NATS subscription per topic (not 50k — that would melt NATS).
- An in-process `Hub[Event]` with `DropNewest` policy and small buffers.
- Each WebSocket connection is a subscriber to the hub; its goroutine reads from `sub.C()` and writes to the WebSocket.
- A slow client drops events; a sustained-slow client is disconnected.

Capacity: 50k subscribers × 64-slot buffer × 256 B = 800 MB worst case. CPU per publish: 50k × 100 ns = 5 ms. At 100 events/sec that's 500 ms/sec of CPU; fits one core. Above 200 events/sec, shard the hub.

### Q34. Walk me through a debugging scenario: subscribers are missing events under load. Where do you look?

1. Check the policy: if `DropNewest` or `DropOldest`, missing events are expected. Look at the drop counter.
2. Check buffer fill: if at 100%, subscribers are not keeping up. Look at subscriber handler latency.
3. Check publish latency: if rising, the hub is the bottleneck. Profile to find the contended lock.
4. Check subscriber count: did someone unsubscribe unexpectedly? Look for handler panics or context cancellations.
5. Check goroutine count: leaks or starvation?

The answer is almost always step 1 or 2 — the policy is doing its job and the system is undersized.

### Q35. How would you implement exactly-once broadcast?

You can't, with at-most-once primitives. The pattern is:

- Idempotent consumers: each event has a unique ID; consumers de-duplicate by ID.
- At-least-once delivery from the broadcaster: retry until ack.
- Consumer-side dedup window: keep ID set for retention period.

This is how production event-driven systems get exactly-once semantics at the *application* layer despite at-least-once *delivery*. Build on Kafka-like systems that support consumer-side offset tracking.

### Q36. Suppose you need broadcast across a 50-node cluster, low latency, high rate. Pick a system and justify.

NATS with leaf nodes. Justification:
- Sub-ms latency cross-node.
- Mesh routing: each node sees every event once, regardless of cluster topology.
- 1M+ msg/sec/node.
- No durability needed → no operational cost of Kafka.
- Mature Go client.

If durability is required, layer NATS JetStream on top. If retention beyond hours is needed, use Kafka instead.

### Q37. A subscriber's `Unsubscribe` panics in production. Why?

Most likely the subscriber closed its own channel manually before calling `Unsubscribe`, and now the hub's `close(s.ch)` panics. Fix by enforcing in code review and by making `Unsubscribe` idempotent at the hub level too — use a `sync.Once` on the close itself, not just on the unregister.

Other possibilities: the subscription handle was reused across hubs; the hub itself was already closed (which would have closed all channels). Trace the goroutines.

### Q38. Design a "guaranteed in-order" broadcast across multiple subscribers.

Per-subscriber, our hub already gives in-order delivery (one channel, one sender). The hard case is *across* subscribers — all see the same order. Strategies:

- **Single sender, sequential delivery.** The hub delivers to subscriber A, then B, then C, then publishes the next event. Slow because cross-subscriber latency stacks up.
- **Sequence numbers + reorder buffer.** Each event has a global sequence. Subscribers buffer and reassemble in order. Adds latency = max network jitter.
- **External total-order broker.** Use a single-partition Kafka topic or Raft log. Every subscriber consumes from the same log in the same order. Definitive but expensive.

Most "total order" requirements are actually "per-key order" — much easier with partitioned logs.

### Q39. How would you measure whether your broadcast Hub is the bottleneck?

Run `pprof` under load. The Hub is the bottleneck if:
- A significant chunk of CPU time is in `hub.Publish` (especially in the loop and the channel send).
- Goroutines pile up blocked on `sub.ch <- v` (visible in `pprof -goroutine`).
- Lock contention is high (`pprof -mutex`).

If the bottleneck is elsewhere (handlers, network), Hub optimisations are wasted work. Measure first.

### Q40. Critique this senior-engineer claim: "We should always use Cond.Broadcast instead of close because it's faster."

False in practice. Channels with `close` give you:
- `select` integration.
- `context.Context` cancellation.
- `pprof` visibility into who is blocked where.
- Type safety on the carried value.

`Cond.Broadcast` is faster in narrow microbenchmarks but you give up all of the above. The right test: does your hottest broadcast actually appear in a profile? In production code, the answer is almost always no. Choose channels; choose `Cond` only when the predicate is complex shared state.

---

## Summary

Interview questions on broadcast fan from "what does `close` do?" at the junior level to "design a globally ordered cluster-wide broadcast" at staff. The progression matches the file sequence: junior idiomatic Go, middle library design, senior production hardening, staff architectural choice. Mastery means being able to pick the right tool for the rate, durability, and latency requirements — and to recognise when a "broadcast" problem is actually a pipeline or fan-out problem in disguise.
