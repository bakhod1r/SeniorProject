# Broadcast Pattern — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Slow-Subscriber Mitigation Strategies](#slow-subscriber-mitigation-strategies)
3. [Sharded Hubs for High Throughput](#sharded-hubs-for-high-throughput)
4. [Lifecycle: Subscribe During Broadcast](#lifecycle-subscribe-during-broadcast)
5. [Lifecycle: Unsubscribe During Broadcast](#lifecycle-unsubscribe-during-broadcast)
6. [`sync.Cond.Broadcast` in Depth](#synccondbroadcast-in-depth)
7. [Memory Model and Visibility](#memory-model-and-visibility)
8. [Broadcast with Backpressure Telemetry](#broadcast-with-backpressure-telemetry)
9. [Replay and Late Subscribers](#replay-and-late-subscribers)
10. [Library Design](#library-design)
11. [Production Failure Modes](#production-failure-modes)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

At senior level the broadcast pattern is no longer a library — it is a *design problem*. You are deciding:

- How to keep the hub fast when subscribers are slow.
- How to scale beyond one goroutine when N grows or rate grows.
- How to maintain correct lifecycle behaviour across concurrent subscribe / unsubscribe / publish.
- When `sync.Cond.Broadcast` outperforms channels, and when channels outperform `Cond`.
- How to instrument for production with metrics that point at the real problem.

This file assumes the middle-level material is internalised: pub/sub library skeleton, drop policies, context propagation, idempotent unsubscribe.

---

## Slow-Subscriber Mitigation Strategies

A taxonomy of every reasonable response to "one consumer cannot keep up":

| Strategy | Latency for others | Loss | Memory | Implementation cost |
|----------|--------------------|------|--------|----------------------|
| Block forever | Bound to slowest | None | Bounded | Trivial |
| Bounded blocking with timeout | Bound to timeout | Partial | Bounded | Easy |
| Drop newest | Unaffected | New events lost | Bounded | Easy |
| Drop oldest | Unaffected | Old events lost | Bounded | Medium |
| Per-subscriber goroutine + bounded queue | Unaffected | Per-policy | Bounded × N | Medium |
| Per-subscriber goroutine + unbounded queue | Unaffected | None | Unbounded | Medium + risk |
| Disconnect subscriber on overflow | Unaffected | Subscriber loses everything | Bounded | Medium |
| Coalescing (replace queued events) | Unaffected | Partial (compressed) | Bounded | Hard |

**Coalescing** deserves attention. For state-update broadcasts ("here is the latest config / cache / state"), you do not need every intermediate value — only the latest. If subscriber falls behind by 5 events, replacing them with the final one preserves correctness while bounding the queue:

```go
type latestOnly[T any] struct {
    mu      sync.Mutex
    pending T
    has     bool
    ready   chan struct{}
}

func (l *latestOnly[T]) Set(v T) {
    l.mu.Lock()
    l.pending = v
    if !l.has {
        l.has = true
        select { case l.ready <- struct{}{}: default: }
    }
    l.mu.Unlock()
}

func (l *latestOnly[T]) Take() (T, bool) {
    l.mu.Lock()
    defer l.mu.Unlock()
    if !l.has {
        var zero T
        return zero, false
    }
    v := l.pending
    l.has = false
    return v, true
}
```

The hub calls `Set(v)` on each subscriber; the subscriber calls `Take()`. If many `Set`s happen between two `Take`s, only the last value survives. Perfect for "latest config snapshot" semantics.

**Disconnect on overflow** is the strongest signal. If a subscriber falls more than K events behind, the hub closes their channel. The subscriber wakes with `ok=false`, sees they were dropped, and re-subscribes with a re-sync. This is how Kafka consumer groups behave when offsets fall too far behind log retention.

```go
func (h *Hub[T]) deliverOrEject(s *subscription[T], v T) {
    select {
    case s.ch <- v:
        return
    default:
    }
    // Buffer full. Either eject or wait.
    if h.policy == Eject {
        h.evict(s)
        return
    }
    // ...
}

func (h *Hub[T]) evict(s *subscription[T]) {
    h.mu.Lock()
    if _, ok := h.subs[s]; ok {
        delete(h.subs, s)
        close(s.ch)
    }
    h.mu.Unlock()
}
```

Eviction must close the channel so the subscriber notices.

---

## Sharded Hubs for High Throughput

A single hub goroutine (or a single map under a lock) becomes the bottleneck at high publish rates with many subscribers. The fix is **sharding**: partition subscribers across K hubs, route each publish to the relevant shards.

Three sharding axes:

### By topic
The simplest case. If your domain has natural topics ("orders", "shipments", "metrics"), each topic gets its own hub. No coordination between topics.

```go
type ShardedHub[T any] struct {
    shards map[string]*Hub[T]
    mu     sync.RWMutex
}

func (s *ShardedHub[T]) Publish(ctx context.Context, topic string, v T) {
    s.mu.RLock()
    h := s.shards[topic]
    s.mu.RUnlock()
    if h != nil { h.Publish(ctx, v) }
}
```

### By subscriber ID
For *global* broadcast (every subscriber sees every event), hash subscribers into K shards. Each publish goes to all K shards in parallel.

```go
type ParallelHub[T any] struct {
    shards [16]*Hub[T]
}

func (p *ParallelHub[T]) Publish(ctx context.Context, v T) {
    var wg sync.WaitGroup
    for _, h := range p.shards {
        wg.Add(1)
        go func(h *Hub[T]) {
            defer wg.Done()
            _ = h.Publish(ctx, v)
        }(h)
    }
    wg.Wait()
}

func (p *ParallelHub[T]) Subscribe(id uint64) Subscription[T] {
    return p.shards[id%uint64(len(p.shards))].Subscribe()
}
```

Subscribers are evenly distributed; broadcasts run in K parallel goroutines. Total CPU goes up; wall-clock latency drops. The trade-off is K extra goroutines per publish.

### By tree fan-out
For very large subscriber counts (>10k), a flat fan-out from one goroutine to N subscriber channels saturates the goroutine. A tree of hubs distributes the work:

```
            root hub
           /   |    \
      hub L1  hub L1  hub L1
     /  |  \   ...
   sub sub sub ...
```

Each intermediate hub re-broadcasts to its children. With branching factor B and depth D, the system supports `B^D` subscribers with `B*D` per-event sends. For B=10, D=4 you get 10k subscribers with 40 per-event sends instead of 10k.

This is the design Kafka uses internally for high-fan-out topics, NATS uses for cluster mesh routing, and what you would build for an in-process broadcast at scale.

---

## Lifecycle: Subscribe During Broadcast

A subscriber that calls `Subscribe()` while `Publish` is mid-loop: do they receive the current event?

Two valid semantics:

- **Eventual.** New subscribers receive *future* events only; they may miss the in-flight one. Most pub/sub libraries do this.
- **Atomic.** New subscribers either see the in-flight event or none of it; never partial.

Our middle-level hub does eventual semantics because `Publish` holds a read lock and `Subscribe` waits for a write lock. The in-flight publish completes, then the new subscriber joins. No partial visibility. This is implicit consistency: the lock ordering provides linearisability of subscribe/publish at the cost of subscribe latency.

For **atomic with current event**, you would need:

```go
func (h *Hub[T]) SubscribeWithReplay(last int) Subscription[T] {
    h.mu.Lock()
    defer h.mu.Unlock()
    sub := h.newSub()
    // pre-load the buffer with the last `last` events
    for _, e := range h.recent(last) {
        sub.ch <- e
    }
    return &handle[T]{...}
}
```

This requires the hub to retain history — and now you are 80% of the way to a log-based broadcaster (Kafka, Redis Streams). Senior judgement: if you need replay, do not build it on top of channels. Use a log.

---

## Lifecycle: Unsubscribe During Broadcast

`Unsubscribe` while another goroutine is in `Publish`:

```go
// Goroutine A
h.Publish(ctx, event)  // holds h.mu.RLock(), iterating h.subs

// Goroutine B
sub.Unsubscribe()      // wants h.mu.Lock() to delete from h.subs
```

`RWMutex` resolves this: B waits for A's iteration to finish. While A is iterating, B's unsubscribe is pending. A delivers to the subscriber that B is about to remove; the subscriber receives the event, then is unsubscribed.

If the subscriber is *also* concurrently reading their channel, the delivery they receive is the last one before unsubscribe. The unsubscribe-induced close arrives some time after.

This is fine — but two corner cases need attention:

1. **Subscriber unsubscribes from inside its own consumer loop.** They were about to receive an in-flight event. The event arrives, they handle it, then call `Unsubscribe`. Clean.

2. **Subscriber's channel is closed by `Unsubscribe` *while* the publisher is mid-send.** This is the classic "send on closed channel" panic. Prevented because publish holds RLock and unsubscribe needs full Lock. They cannot interleave.

Without the lock, you would need a different design — e.g., the hub broadcasts via a per-subscriber `select` that checks a `done` channel:

```go
select {
case s.ch <- v:
case <-s.done:
}
```

`Unsubscribe` would `close(s.done)` instead of closing `s.ch`. The hub still drains `s.ch` once (no panic on send because `s.ch` is not closed). This pattern is more concurrent but harder to clean up.

---

## `sync.Cond.Broadcast` in Depth

`sync.Cond` is the lock-based broadcast primitive. It is rare in idiomatic Go but irreplaceable in some scenarios.

### Mechanics

`Cond.Wait()` does three things atomically:

1. Release the locked mutex.
2. Park the goroutine on Cond's wait queue.
3. On wake (from `Signal` or `Broadcast`), re-acquire the mutex.

`Cond.Broadcast()` removes all goroutines from the wait queue and marks them ready. They each compete for the mutex on wake.

### Use case: queue with multiple consumers

Several consumers wait for new items. When items arrive in a batch, you want to wake all of them so they can race for items, not just one (which is what `Signal` does):

```go
type Queue[T any] struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items []T
    closed bool
}

func New[T any]() *Queue[T] {
    q := &Queue[T]{}
    q.cond = sync.NewCond(&q.mu)
    return q
}

func (q *Queue[T]) Push(items ...T) {
    q.mu.Lock()
    q.items = append(q.items, items...)
    q.mu.Unlock()
    q.cond.Broadcast()
}

func (q *Queue[T]) Pop(ctx context.Context) (T, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 && !q.closed {
        // ctx cancellation: see below
        q.cond.Wait()
    }
    if q.closed && len(q.items) == 0 {
        var zero T
        return zero, false
    }
    v := q.items[0]
    q.items = q.items[1:]
    return v, true
}

func (q *Queue[T]) Close() {
    q.mu.Lock()
    q.closed = true
    q.mu.Unlock()
    q.cond.Broadcast()
}
```

`Push(items...)` adds many; `Broadcast` wakes every consumer. Each consumer wakes, re-checks the predicate (`len == 0 && !closed`), grabs an item if available, or returns to wait.

### `Cond` does not integrate with `select` or `ctx`

This is the big drawback. You cannot do:

```go
select {
case <-ctx.Done():
    // ...
case <-q.cond.Wait(): // does not exist
}
```

To make `Cond` cancellable, you need a workaround — typically a watchdog that calls `Broadcast` on ctx cancellation:

```go
go func() {
    <-ctx.Done()
    q.cond.Broadcast() // wake everyone so they can check ctx
}()
```

After waking, each waiter checks `ctx.Err()` and exits if cancelled. This works but is fragile.

### When to choose `Cond` over channels

- The predicate involves complex shared state already guarded by a mutex (e.g., "queue has ≥3 items AND backlog is below threshold").
- Throughput exceeds channel capacity (`Cond` is faster for the wake-all case in microbenchmarks).
- You need to wake all waiters with no buffer concerns.

When **not** to choose `Cond`:

- Anywhere context cancellation matters (most of modern Go).
- When the predicate is "did event X happen yet" — channels are clearer.
- When you want stack traces showing which goroutine is blocked on what — channels show up cleanly in `pprof`, `Cond` is more opaque.

---

## Memory Model and Visibility

For a broadcast hub, the relevant memory-model facts:

- A send on a channel *synchronises* with the corresponding receive. Writes the publisher made before send are visible to the subscriber after receive.
- `close(c)` synchronises with the receive that observes the close. Writes the closer made before `close` are visible to the receiver that sees `ok=false`.
- A `sync.Cond.Wait` returning synchronises with the corresponding `Signal` or `Broadcast`.
- All mutex operations synchronise — Lock paired with Unlock provide visibility.

Implication for broadcast: if the publisher mutates a field of a struct before sending a pointer to it, every subscriber sees the mutated state. If the publisher mutates after sending, behaviour is undefined (a torn read on the subscriber side, depending on memory ordering).

**Rule:** Once you send, the receiver owns the value. Do not mutate the sent object from the publisher side. For broadcast, where N receivers share the same pointer, this is even more important — concurrent mutation by either side is a race for the others.

Best practice: send values, not pointers. If pointers are needed for size, the pointed-to struct must be frozen at send time.

---

## Broadcast with Backpressure Telemetry

A production hub deserves:

- **Subscriber count** — total active subscriptions.
- **Per-subscriber buffer fill** — `len(s.ch)` over `cap(s.ch)`.
- **Drop counter** — events dropped per policy, per subscriber.
- **Eject counter** — subscribers disconnected for overflow.
- **Publish latency** — wall time of `Publish` call.
- **Goroutine count** — should be predictable; sudden growth = leak.

Implement via a metrics interface:

```go
type Metrics interface {
    IncDropped(subID string)
    IncEjected(subID string)
    ObservePublishLatency(d time.Duration)
    GaugeSubscribers(n int)
    GaugeBufferFill(subID string, pct float64)
}
```

Wrap the hub's `deliver` to count drops, and add a periodic sampler for buffer fill:

```go
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-h.done: return
        case <-t.C:
            h.mu.RLock()
            for s := range h.subs {
                h.metrics.GaugeBufferFill(s.id, float64(len(s.ch))/float64(cap(s.ch)))
            }
            h.metrics.GaugeSubscribers(len(h.subs))
            h.mu.RUnlock()
        }
    }
}()
```

Buffer fill is the leading indicator of slow subscribers. Set an alert at 80% sustained. Drops and ejects are lagging indicators — by the time they fire, the system is already lossy.

---

## Replay and Late Subscribers

Channel-based broadcast does not replay. A subscriber that joins at time `T` sees only events published after `T`. For some domains this is fine (real-time chat: you do not need to see ten-minute-old messages). For others it is unacceptable (event sourcing: every consumer must process every event).

If you need replay, build it explicitly. Two designs:

### Bounded history buffer

The hub retains the last K events. New subscribers receive them in order before subscribing to live events.

```go
type ReplayHub[T any] struct {
    *Hub[T]
    historyMu sync.Mutex
    history   []T
    cap       int
}

func (r *ReplayHub[T]) Publish(ctx context.Context, v T) error {
    r.historyMu.Lock()
    if len(r.history) >= r.cap {
        r.history = r.history[1:]
    }
    r.history = append(r.history, v)
    r.historyMu.Unlock()
    return r.Hub.Publish(ctx, v)
}

func (r *ReplayHub[T]) SubscribeWithReplay() (Subscription[T], []T) {
    r.historyMu.Lock()
    snap := append([]T(nil), r.history...)
    sub := r.Subscribe()
    r.historyMu.Unlock()
    return sub, snap
}
```

The subscriber processes `snap` first, then ranges over `sub.C()`. Race window: events published between `Subscribe()` returning and the caller starting to read could be lost, but if `Subscribe` is called under the same lock that protects history, the snapshot and the subscription are consistent.

### Log-based fan-out

For unbounded replay, channels are wrong. Use a log (an append-only file, an in-memory ring buffer with offsets, or an external system like Kafka). Subscribers track their offset; the hub serves them events from their offset forward. This is a real database engineering problem; do not improvise.

---

## Library Design

A senior-level API for a broadcast library:

```go
package broadcast

// Hub is the central pub/sub primitive. It is safe for concurrent use.
type Hub[T any] interface {
    // Subscribe returns a new subscription. The subscription is independent
    // of other subscriptions: it has its own buffer and overflow policy.
    // Subscribers see only events published after Subscribe returns.
    Subscribe(opts ...SubOption) Subscription[T]

    // Publish delivers v to every active subscriber according to each
    // subscription's overflow policy. Returns ErrClosed if the hub has
    // been closed.
    Publish(ctx context.Context, v T) error

    // Close shuts down the hub. All active subscriptions receive a closed
    // channel; future Subscribe calls return an already-closed subscription;
    // future Publish calls return ErrClosed. Idempotent.
    Close()

    // Done returns a channel closed when the hub is closed.
    Done() <-chan struct{}

    // Stats returns runtime statistics (subscriber count, drop counts).
    Stats() Stats
}

type Subscription[T any] interface {
    // C returns the receive channel. The channel is closed when the
    // subscription is unsubscribed or the hub is closed.
    C() <-chan T

    // Unsubscribe removes the subscription. Idempotent.
    Unsubscribe()
}

type SubOption func(*subOptions)

func WithBuffer(n int) SubOption           { /* ... */ }
func WithPolicy(p OverflowPolicy) SubOption { /* ... */ }
func WithID(id string) SubOption           { /* for metrics */ }
```

Documented contracts:

- **Concurrency.** All methods safe under concurrent use.
- **Subscribe semantics.** Atomic with respect to in-flight publishes.
- **Unsubscribe semantics.** Idempotent; subscription's channel is closed after.
- **Close semantics.** Idempotent; subscribers see closed channels.
- **Overflow.** Per-subscription policy; documented in `OverflowPolicy`.

Without these contracts, every user will invent their own and most will be wrong.

---

## Production Failure Modes

### Subscriber goroutine never returns
A subscriber whose handler blocks on a DB call indefinitely will eventually fill its buffer. With `Block`, the hub stalls. With `DropNewest`, events are lost. With `Eject`, the subscriber loses everything. Diagnose via buffer-fill metric.

### Hub goroutine leaks
If you forget to call `Close()`, the goroutines inside the hub stay alive. Use `goleak` in tests; in production, observe goroutine count for steady-state behaviour.

### Subscribers leak
If callers forget to call `Unsubscribe`, the map grows forever. Heap profiling shows the subscription map growing. Mitigation: `Subscribe` could return a `context`-bound subscription that auto-unsubscribes when ctx is done.

### Publish blocked forever
With `Block` policy and a stuck subscriber, `Publish` blocks. If the publisher has no ctx, you have a deadlock. Always pass ctx; the senior fix is also a periodic ejection of subscribers whose buffer fills for more than N seconds.

### Lock contention under high publish rate
With one global RWMutex, every publish takes RLock. Subscribe needs full Lock. Heavy publishing starves subscribers from joining/leaving. Mitigation: sharded hubs (see above), or copy-on-write subscriber list:

```go
type cowHub[T any] struct {
    subs atomic.Value // []*subscription[T]
    mu   sync.Mutex   // only for Subscribe/Unsubscribe
}

func (h *cowHub[T]) Publish(ctx context.Context, v T) error {
    subs, _ := h.subs.Load().([]*subscription[T])
    for _, s := range subs {
        h.deliver(s, v)
    }
    return nil
}

func (h *cowHub[T]) Subscribe() Subscription[T] {
    h.mu.Lock()
    defer h.mu.Unlock()
    old, _ := h.subs.Load().([]*subscription[T])
    s := &subscription[T]{ch: make(chan T, 16)}
    next := append([]*subscription[T](nil), old...)
    next = append(next, s)
    h.subs.Store(next)
    return &handle[T]{ /* ... */ }
}
```

Publish never takes a lock — it loads a slice atomically. Subscribe pays O(N) to copy. For workloads with high publish rate and rare subscribe (typical for chat / metrics), COW wins.

### Race between Close and Subscribe
A caller subscribes just as the hub is closing. Without coordination, the subscription is added after `Close` zeroed the map → goroutine leak. The fix is to test `h.closed` under the same lock that mutates the map; both our middle-level and senior-level designs do this.

---

## Cheat Sheet

| Problem | Senior tool |
|---------|-------------|
| Slow subscriber | Per-sub goroutine + DropNewest |
| Catastrophic slow subscriber | Eject |
| State-only broadcast | Coalesce / latestOnly |
| Throughput bottleneck | Sharded hubs (parallel) |
| Subscribe latency | COW subscriber list |
| Late subscriber needs history | Bounded replay buffer or log |
| Complex predicate broadcast | `sync.Cond.Broadcast` with re-check loop |
| ctx-aware Cond | Watchdog that Broadcast on ctx.Done |
| Telemetry | Buffer-fill gauge, drop counter, latency histogram |

```go
// Pattern: COW subscriber list
type cowHub[T any] struct {
    subs atomic.Value // []*subscription[T]
    mu   sync.Mutex
}

// Pattern: Eject on overflow
func (h *Hub[T]) deliverOrEject(s *subscription[T], v T) {
    select {
    case s.ch <- v:
    default:
        h.evict(s)
    }
}
```

---

## Summary

Senior broadcast is design judgement:

- Pick a slow-subscriber strategy *intentionally*. Block, drop, eject, or coalesce — each has a domain fit.
- Shard for throughput before you optimise a single hub. One goroutine handling 10k subscribers is the wrong picture.
- Be precise about subscribe-during-broadcast semantics. RWMutex gives you linearisability for free.
- Reach for `sync.Cond.Broadcast` only when the predicate is complex and shared; otherwise channels read cleaner.
- Instrument the hub. Buffer fill is the leading indicator.
- Build replay only when you actually need it; otherwise be honest about "live only."

With these tools, broadcast becomes a reliable building block of any concurrent system, not a footgun.
