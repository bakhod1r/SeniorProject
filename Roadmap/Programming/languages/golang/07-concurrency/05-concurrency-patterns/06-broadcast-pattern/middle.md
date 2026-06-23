# Broadcast Pattern — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Building a Pub/Sub Library](#building-a-pubsub-library)
3. [Dynamic Subscribe and Unsubscribe](#dynamic-subscribe-and-unsubscribe)
4. [The Slow-Subscriber Problem](#the-slow-subscriber-problem)
5. [Buffered Subscriber Channels](#buffered-subscriber-channels)
6. [Drop-on-Overflow](#drop-on-overflow)
7. [Per-Subscriber Goroutine Delivery](#per-subscriber-goroutine-delivery)
8. [Topics and Filtering](#topics-and-filtering)
9. [Context-Aware Hubs](#context-aware-hubs)
10. [Closing Semantics](#closing-semantics)
11. [Testing Broadcast Hubs](#testing-broadcast-hubs)
12. [Anti-Patterns](#anti-patterns)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

Junior level got us to "events reach every subscriber." Middle level makes the hub *usable*:

- Subscribers join and leave at any time, even during broadcast.
- The hub does not hang because one consumer is slow.
- Topics partition the event space.
- Shutdown is clean: no goroutine leaks, no double-close panics.
- Context propagates cancellation everywhere.

We are going to build a small library — call it `broadcast` — and grow it through the file. Each section adds one feature and discusses the trade-offs.

---

## Building a Pub/Sub Library

### Public API

```go
// Package broadcast offers a minimal in-process pub/sub hub.
package broadcast

import (
    "context"
    "errors"
    "sync"
)

type Hub[T any] struct {
    mu          sync.RWMutex
    subs        map[*subscription[T]]struct{}
    bufferSize  int
    overflow    OverflowPolicy
    closed      bool
    closedOnce  sync.Once
    done        chan struct{}
}

type subscription[T any] struct {
    ch     chan T
    dropFn func(T)
}

type OverflowPolicy int

const (
    Block OverflowPolicy = iota
    DropNewest
    DropOldest
)

type Subscription[T any] interface {
    C() <-chan T
    Unsubscribe()
}

func New[T any](bufferSize int, policy OverflowPolicy) *Hub[T] {
    return &Hub[T]{
        subs:       make(map[*subscription[T]]struct{}),
        bufferSize: bufferSize,
        overflow:   policy,
        done:       make(chan struct{}),
    }
}
```

`Hub[T]` is generic over the payload type. The map of subscriptions is keyed by pointer so unsubscribe is O(1). The overflow policy is a deliberate first-class choice — we will explain each option in detail below.

### Subscribe

```go
func (h *Hub[T]) Subscribe() Subscription[T] {
    h.mu.Lock()
    defer h.mu.Unlock()
    if h.closed {
        // Return a subscription already closed.
        ch := make(chan T)
        close(ch)
        return &handle[T]{ch: ch, unsubscribe: func() {}}
    }
    s := &subscription[T]{ch: make(chan T, h.bufferSize)}
    h.subs[s] = struct{}{}
    return &handle[T]{
        ch:          s.ch,
        unsubscribe: func() { h.unsubscribe(s) },
    }
}

type handle[T any] struct {
    ch          chan T
    unsubscribe func()
    once        sync.Once
}

func (h *handle[T]) C() <-chan T   { return h.ch }
func (h *handle[T]) Unsubscribe()  { h.once.Do(h.unsubscribe) }
```

`sync.Once` makes `Unsubscribe()` idempotent — a frequent footgun without it. The handle does not expose the writable channel, only `<-chan T`.

### Publish (basic version, refined later)

```go
var ErrClosed = errors.New("broadcast: hub closed")

func (h *Hub[T]) Publish(v T) error {
    h.mu.RLock()
    defer h.mu.RUnlock()
    if h.closed {
        return ErrClosed
    }
    for s := range h.subs {
        h.deliver(s, v)
    }
    return nil
}
```

A read lock is enough because `Publish` only reads `h.subs`. Subscriptions can register and unregister concurrently behind a write lock; broadcast does not race with them as long as the map itself is not mutated during iteration. `deliver` is where overflow policy lives — coming up next.

### Close

```go
func (h *Hub[T]) Close() {
    h.closedOnce.Do(func() {
        h.mu.Lock()
        h.closed = true
        for s := range h.subs {
            close(s.ch)
        }
        h.subs = nil
        close(h.done)
        h.mu.Unlock()
    })
}

func (h *Hub[T]) Done() <-chan struct{} { return h.done }
```

`closedOnce` guarantees `Close` is safe to call any number of times. Closing each subscriber channel propagates the shutdown signal: subscribers see `ok=false` on their next receive. `h.done` is exposed for external coordination.

Now we have a base. Everything that follows refines this skeleton.

---

## Dynamic Subscribe and Unsubscribe

The map-based design naturally supports dynamic subscribe and unsubscribe. The question is: what happens if a broadcast is *in flight* when someone unsubscribes?

Two cases:

1. **Unsubscribe is called by the subscriber's own goroutine after a receive.** Safe: the subscriber is no longer reading, the hub may already have sent the previous event, the unsubscribe removes the channel from the map *before* the next publish. The closed subscriber channel will be drained naturally.

2. **Unsubscribe is called by a different goroutine while the hub is mid-publish.** Without care, this races: the hub holds an iterator over the map; another goroutine deletes an entry. Go's map iteration is *safe* in the presence of deletions if the deletion is of a different key, but unsafe across goroutines without synchronisation.

Our hub takes a write lock to add/remove and a read lock to publish. Concurrent unsubscribe waits until publish finishes. That serialises the problem away at the cost of pausing unsubscribes for the publish duration. For most workloads that is fine; the senior level shows how to break this constraint with sharding.

```go
func (h *Hub[T]) unsubscribe(s *subscription[T]) {
    h.mu.Lock()
    defer h.mu.Unlock()
    if _, ok := h.subs[s]; !ok {
        return // already gone
    }
    delete(h.subs, s)
    close(s.ch)
}
```

Idempotency is critical. We check `_, ok := h.subs[s]` before deleting. `close(s.ch)` is exactly once because we only call this path when the subscription is in the map. The `handle.Unsubscribe()` wraps everything in `sync.Once` for caller-side safety too.

---

## The Slow-Subscriber Problem

The defining problem of broadcast systems: one consumer cannot keep up, and you have to decide what to do about it.

Concretely, when the hub does this:

```go
for s := range h.subs {
    s.ch <- v // blocks if s.ch is full
}
```

if `s.ch` is full and unbuffered or the buffer is full, the send blocks. The hub goroutine cannot deliver to *any* other subscriber. Even if 99 subscribers are ready, one stuck one halts the broadcast. This is **head-of-line blocking**.

Three families of solutions:

| Strategy | Latency for others | Completeness for slow sub | Memory |
|----------|--------------------|-----------------------------|---------|
| Block (junior default) | Bounded by slowest | Complete | Bounded by buffer |
| Drop on overflow | Unaffected | Lossy | Bounded |
| Per-subscriber goroutine | Unaffected | Complete *but* unbounded queues if forever slow | Unbounded unless capped |

In practice, modern Go broadcast systems mix the second and third: each subscriber has its own goroutine and its own bounded buffer, and overflow drops events. We will build that up.

---

## Buffered Subscriber Channels

The cheapest first step: give each subscriber a small buffer. A buffer of 4-64 lets the hub deposit several events before the subscriber must drain.

```go
s := &subscription[T]{ch: make(chan T, h.bufferSize)}
```

Buffering does not *eliminate* head-of-line blocking; it postpones it. If a subscriber is paused for 10 seconds at 1000 events/sec, a 64-slot buffer fills in 64 ms and we are back to blocking. But for *bursty* subscribers — fast on average, occasionally stalling for tens of milliseconds — a small buffer absorbs the jitter and the hub never notices.

Choosing the buffer size:

- Too small (0, 1, 2): every subscriber pause stalls the hub.
- Too large (10k+): a slow subscriber pins memory equal to `bufferSize * sizeof(event)`.
- Sweet spot: `2 × expected_burst_size`. Default of 16 is fine for many systems.

The buffer is per-subscriber, so it is also per-leak. 1000 subscribers each with a 1024-slot buffer of 1 KB messages is 1 GB of resident memory if everyone falls behind.

---

## Drop-on-Overflow

When the buffer is full and we still cannot wait, we drop. Two flavours:

- **Drop newest** — keep what is already in the buffer, discard the new event.
- **Drop oldest** — make room by removing the oldest queued event, enqueue the new one.

Drop newest is implemented with a non-blocking send:

```go
func (h *Hub[T]) deliver(s *subscription[T], v T) {
    switch h.overflow {
    case Block:
        s.ch <- v
    case DropNewest:
        select {
        case s.ch <- v:
        default:
            // dropped
        }
    case DropOldest:
        for {
            select {
            case s.ch <- v:
                return
            default:
                // make room
                select {
                case <-s.ch:
                default:
                    return // raced with a drain
                }
            }
        }
    }
}
```

Drop newest is trivial. Drop oldest is trickier because it must remove one item and add one, with no atomic primitive for that — the loop handles the (rare) case where another goroutine drains the channel mid-update.

Domain choice:

- **Metric snapshots, sensor readings:** drop oldest. Freshness matters more than completeness.
- **Audit logs, billing events:** never drop. Use `Block` and pay the latency.
- **Chat messages:** drop newest only if absolutely necessary; users notice missing messages.
- **Stock ticks:** drop oldest. Yesterday's price is meaningless.

The choice is per-hub, not per-event. Mixed semantics belong in mixed hubs.

---

## Per-Subscriber Goroutine Delivery

The strongest decoupling: each subscriber has its own goroutine receiving from the hub *and* a personal queue feeding the subscriber. The hub publishes into the personal queue; the subscriber drains it at its own pace; overflow on the personal queue follows the policy without affecting the hub.

```go
type subscription[T any] struct {
    in  chan T // hub writes here, bounded
    out chan T // subscriber reads here
    done chan struct{}
}

func (s *subscription[T]) run(policy OverflowPolicy) {
    defer close(s.out)
    for {
        select {
        case <-s.done:
            return
        case v, ok := <-s.in:
            if !ok {
                return
            }
            switch policy {
            case Block:
                s.out <- v
            case DropNewest:
                select {
                case s.out <- v:
                default:
                }
            case DropOldest:
                for {
                    select {
                    case s.out <- v:
                        goto next
                    default:
                        select {
                        case <-s.out:
                        default:
                        }
                    }
                }
            }
        next:
        }
    }
}
```

The hub publishes only into `in`, which is small (say 4 slots). The personal goroutine forwards to `out` according to policy. Net effect: the hub spends at most 4-slots × subscriber-count of buffering before drop, but per-subscriber speed is independent.

Pros: hub stays fast even with hundreds of slow subscribers. Cons: doubles goroutine count and introduces an extra channel hop per event. For a system with thousands of slow subscribers, this is worth it.

---

## Topics and Filtering

Most pub/sub systems have *topics* so subscribers receive only relevant events.

```go
type TopicHub[T any] struct {
    mu     sync.RWMutex
    topics map[string]*Hub[T]
    bufferSize int
    policy OverflowPolicy
}

func NewTopic[T any](buf int, p OverflowPolicy) *TopicHub[T] {
    return &TopicHub[T]{
        topics:     make(map[string]*Hub[T]),
        bufferSize: buf,
        policy:     p,
    }
}

func (t *TopicHub[T]) Subscribe(topic string) Subscription[T] {
    t.mu.Lock()
    h, ok := t.topics[topic]
    if !ok {
        h = New[T](t.bufferSize, t.policy)
        t.topics[topic] = h
    }
    t.mu.Unlock()
    return h.Subscribe()
}

func (t *TopicHub[T]) Publish(topic string, v T) error {
    t.mu.RLock()
    h, ok := t.topics[topic]
    t.mu.RUnlock()
    if !ok {
        return nil // no subscribers, drop silently
    }
    return h.Publish(v)
}
```

One hub per topic; the top-level structure is just a map. Lookups are O(1). Empty topics could be garbage-collected on unsubscribe but it is rarely worth the bookkeeping. The "publish to a topic with no subscribers" case is a no-op; that is the right semantic for pub/sub — the publisher does not know or care.

A more flexible variant uses predicate-based filtering: each subscriber registers a filter function `func(T) bool`. The hub evaluates the filter and only delivers when it returns true. That removes the need for explicit topics at the cost of CPU per event per subscriber.

---

## Context-Aware Hubs

Every long-lived component in modern Go takes a `context.Context`. Apply it everywhere:

```go
func (h *Hub[T]) Publish(ctx context.Context, v T) error {
    h.mu.RLock()
    defer h.mu.RUnlock()
    if h.closed {
        return ErrClosed
    }
    for s := range h.subs {
        if h.overflow == Block {
            select {
            case s.ch <- v:
            case <-ctx.Done():
                return ctx.Err()
            case <-h.done:
                return ErrClosed
            }
        } else {
            h.deliver(s, v) // non-blocking variants
        }
    }
    return nil
}
```

`Publish` now respects the caller's deadline. If the caller's `ctx` cancels mid-publish (say a request handler returned), `Publish` returns early. Already-delivered subscribers keep their copies; subscribers we never reached do not get this event. That asymmetry is expected — most systems prefer "stop trying" to "block forever."

A subscriber respecting context:

```go
func consume(ctx context.Context, sub Subscription[Event]) {
    defer sub.Unsubscribe()
    for {
        select {
        case <-ctx.Done():
            return
        case e, ok := <-sub.C():
            if !ok {
                return // hub closed
            }
            handle(e)
        }
    }
}
```

The deferred `Unsubscribe` is critical. Without it, the hub keeps a closed channel in its map until `Close()` runs (memory leak) and the unsubscribe-during-broadcast path is exercised more rarely (testing gap).

---

## Closing Semantics

Three close signals to disambiguate:

1. **Publisher stops sending.** Not a close of anything: subscribers should keep their subscriptions until they choose to leave.
2. **A single subscriber leaves.** `Unsubscribe()`. Removes from the map; closes that one channel.
3. **Hub shuts down entirely.** `Close()`. Closes every subscriber channel; future `Subscribe` returns an already-closed channel; future `Publish` returns `ErrClosed`.

Encoding these in the API:

```go
type Hub[T any] interface {
    Subscribe() Subscription[T]
    Publish(ctx context.Context, v T) error
    Close()           // permanent shutdown
    Done() <-chan struct{} // signal-style read of shutdown state
}
```

A common mistake is to confuse "hub close" with "no more events for now." Pub/sub is long-lived; closing it should be rare. If callers want "drain and stop", give them an explicit `Drain()` method that closes the input but lets in-flight events complete:

```go
func (h *Hub[T]) Drain(timeout time.Duration) error {
    h.mu.Lock()
    h.closed = true
    subs := make([]*subscription[T], 0, len(h.subs))
    for s := range h.subs {
        subs = append(subs, s)
    }
    h.mu.Unlock()

    deadline := time.After(timeout)
    for _, s := range subs {
        for {
            if len(s.ch) == 0 {
                break
            }
            select {
            case <-deadline:
                return errors.New("drain timeout")
            case <-time.After(10 * time.Millisecond):
            }
        }
    }
    h.Close()
    return nil
}
```

Drain waits for each subscriber's buffer to empty, with a deadline. Production systems use a variant of this on `SIGTERM`.

---

## Testing Broadcast Hubs

Five distinct test shapes:

1. **Fan-out correctness.** Subscribe N times, publish, assert N received the same value.
2. **Ordering within a subscriber.** Publish three values, one subscriber should see them in the order they were published.
3. **Concurrent subscribe + publish.** Worker goroutines subscribe/unsubscribe at random while a publisher runs; assert no panic and no leak.
4. **Slow subscriber.** One subscriber stalls; others should keep receiving in `DropNewest` / `DropOldest` modes.
5. **Goroutine leak.** Use `goleak.VerifyNone(t)` at the end of every test.

A correctness test:

```go
func TestFanOut(t *testing.T) {
    defer goleak.VerifyNone(t)
    h := New[int](4, Block)
    defer h.Close()

    const N = 10
    subs := make([]Subscription[int], N)
    for i := range subs {
        subs[i] = h.Subscribe()
    }

    if err := h.Publish(context.Background(), 42); err != nil {
        t.Fatal(err)
    }

    for i, s := range subs {
        select {
        case v := <-s.C():
            if v != 42 { t.Fatalf("sub %d got %d", i, v) }
        case <-time.After(time.Second):
            t.Fatalf("sub %d: timeout", i)
        }
        s.Unsubscribe()
    }
}
```

A slow-subscriber test:

```go
func TestSlowSubscriberDoesNotStall(t *testing.T) {
    defer goleak.VerifyNone(t)
    h := New[int](1, DropNewest)
    defer h.Close()

    slow := h.Subscribe()
    fast := h.Subscribe()
    defer slow.Unsubscribe()
    defer fast.Unsubscribe()

    // Slow never reads. Fast must still receive every event.
    var got []int
    for i := 0; i < 5; i++ {
        if err := h.Publish(context.Background(), i); err != nil {
            t.Fatal(err)
        }
        select {
        case v := <-fast.C():
            got = append(got, v)
        case <-time.After(100 * time.Millisecond):
            t.Fatalf("fast subscriber missed event %d", i)
        }
    }
    if len(got) != 5 {
        t.Fatalf("fast got %v", got)
    }
}
```

A concurrent subscribe test:

```go
func TestConcurrentSubscribePublish(t *testing.T) {
    defer goleak.VerifyNone(t)
    h := New[int](4, DropNewest)
    defer h.Close()

    var wg sync.WaitGroup
    for i := 0; i < 32; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            s := h.Subscribe()
            defer s.Unsubscribe()
            for range 10 {
                select {
                case <-s.C():
                case <-time.After(100 * time.Millisecond):
                }
            }
        }()
    }
    for i := 0; i < 100; i++ {
        _ = h.Publish(context.Background(), i)
        time.Sleep(time.Microsecond)
    }
    wg.Wait()
}
```

Run all of these with `-race`. The race detector catches every realistic synchronisation bug at this level.

---

## Anti-Patterns

- **Letting subscribers close their own channels.** The hub also writes; double-close panic ensues.
- **Holding the write lock while sending on a subscriber channel.** A slow subscriber now stalls all subscribes and unsubscribes too. Always send under a *read* lock.
- **Forgetting `sync.Once` around `Unsubscribe`.** Double-unsubscribe deletes nothing the second time but still closes a closed channel → panic.
- **Using `chan T` of large structs without considering copy cost.** A 1 KB struct broadcast to 1000 subscribers is 1 MB copied per publish.
- **Per-event `make(chan T)`.** Allocating a fresh channel per publish defeats the broadcast pattern. Build the channels once at `Subscribe`.
- **Returning the subscription's writable channel.** Subscribers will write to it and crash the hub. Return `<-chan T`.
- **Buffer size 0 with `Block` policy.** Every send synchronises with one reader; the hub is no faster than the slowest subscriber, always.
- **No context support.** Long-running publish has no shut-off; useless in HTTP handler / request scopes.

---

## Cheat Sheet

```go
// Construct
h := broadcast.New[Event](16, broadcast.DropNewest)
defer h.Close()

// Subscribe
sub := h.Subscribe()
defer sub.Unsubscribe()
go func() {
    for e := range sub.C() {
        handle(e)
    }
}()

// Publish
if err := h.Publish(ctx, evt); err != nil {
    log.Printf("hub closed: %v", err)
}
```

| Policy | When to use |
|--------|-------------|
| Block | Cannot afford to lose any event (audit, billing) |
| DropNewest | Backpressure preserves history (chat) |
| DropOldest | Latest is most valuable (metrics, ticks) |

| Need | Mechanism |
|------|-----------|
| Topics | `TopicHub` of `Hub`s |
| Filtering | per-subscriber predicate |
| Slow subscriber tolerance | bounded buffer + drop policy + per-sub goroutine |
| Clean shutdown | `Drain(timeout)` then `Close()` |

---

## Summary

Middle-level broadcast is about building a real, usable pub/sub library. The key moves:

- Use a map of subscriptions with read/write locks (or a single owning goroutine).
- Make `Unsubscribe` idempotent with `sync.Once`.
- Choose an overflow policy explicitly: `Block`, `DropNewest`, or `DropOldest`.
- Give each subscriber its own buffered channel; a personal goroutine if you can afford it.
- Propagate `context.Context` through `Publish`.
- Distinguish `Drain` (finish in-flight) from `Close` (immediate shutdown).
- Test fan-out correctness, ordering, slow subscribers, concurrent subscribe, and goroutine leaks with `goleak`.

With these in place you have a hub that behaves predictably in production. Senior level dives into sharding, lifecycle complexities, and `sync.Cond.Broadcast` for high-throughput scenarios.
