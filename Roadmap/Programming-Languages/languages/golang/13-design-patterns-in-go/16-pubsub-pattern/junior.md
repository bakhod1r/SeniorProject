# Pub/Sub — Junior

## 1. What is the Pub/Sub pattern?

A function call has one caller and one callee. The caller knows exactly who it's calling.

**Pub/Sub** (publish/subscribe) breaks that pairing. A publisher emits a message to a *topic* without knowing who (if anyone) will receive it. One or more subscribers register interest in a topic and receive every message published to it. Adding a new subscriber doesn't change the publisher.

> Publishers don't know subscribers. Subscribers don't know publishers. The topic is the only thing they share.

This decoupling is the whole point. New consumers can hook into an existing stream without modifying the producer. Old consumers can drop off without notice.

Pub/Sub is the broader sibling of the **Observer** pattern. Observer is one-to-many notifications inside one process. Pub/Sub usually means many-to-many, often across processes via a broker (Kafka, NATS, Redis, RabbitMQ).

In Go, the in-process form is built on channels.

---

## 2. Prerequisites
- Channels (`make(chan T)`, send `<-`, receive).
- Goroutines (`go func() { ... }()`).
- Basic `sync.Mutex` for protecting the subscriber list.
- `context.Context` for cancellation (you'll see it everywhere here).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Publisher** | Code that emits a message |
| **Subscriber** | Code that receives messages on a topic |
| **Topic** | A named stream of messages |
| **Broker** | The component that routes messages from publishers to subscribers |
| **Message** | A single value flowing through |
| **Backpressure** | What happens when a subscriber can't keep up |
| **Fan-out** | One message delivered to many subscribers |

---

## 4. A minimal in-process broker

```go
type Broker[T any] struct {
    mu   sync.Mutex
    subs map[string][]chan T
}

func New[T any]() *Broker[T] {
    return &Broker[T]{subs: map[string][]chan T{}}
}

func (b *Broker[T]) Subscribe(topic string) <-chan T {
    ch := make(chan T, 16) // small buffer
    b.mu.Lock()
    defer b.mu.Unlock()
    b.subs[topic] = append(b.subs[topic], ch)
    return ch
}

func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.Lock()
    chans := b.subs[topic]
    b.mu.Unlock()
    for _, ch := range chans {
        select {
        case ch <- msg:
        default:
            // subscriber too slow — drop. (More on this below.)
        }
    }
}
```

Use it:

```go
b := New[string]()
out := b.Subscribe("events")

go func() {
    for ev := range out {
        fmt.Println("got:", ev)
    }
}()

b.Publish("events", "hello")
b.Publish("events", "world")
```

That's the whole pattern. ~30 lines of Go.

---

## 5. The slow-subscriber problem

What happens if one subscriber stops reading? Without the `default:` in `select`, the `Publish` blocks. A single stuck subscriber stalls every other subscriber and the publisher. That's catastrophic in any real system.

You have three options:

1. **Drop the message** for slow subscribers (what the code above does).
2. **Block until they catch up** (only safe if you can tolerate it).
3. **Disconnect the slow subscriber** and let them re-subscribe to a fresh stream.

There's no universal right answer. A metrics pipeline drops. A billing pipeline blocks. A chat server disconnects. **The decision is yours, and you must make it explicitly.**

---

## 6. Unsubscribing

A subscriber that goes away must remove itself, or the broker leaks goroutine sends:

```go
func (b *Broker[T]) Unsubscribe(topic string, ch <-chan T) {
    b.mu.Lock()
    defer b.mu.Unlock()
    list := b.subs[topic]
    for i, c := range list {
        if c == ch {
            b.subs[topic] = append(list[:i], list[i+1:]...)
            close(c)
            return
        }
    }
}
```

In real code, you return both the channel **and** a cancel function from `Subscribe`:

```go
func (b *Broker[T]) Subscribe(topic string) (<-chan T, func()) {
    ch := make(chan T, 16)
    /* register */
    cancel := func() { b.Unsubscribe(topic, ch) }
    return ch, cancel
}
```

`defer cancel()` is the rule for callers.

---

## 7. Real-world analogy
A radio broadcast. The station transmits on a frequency. Any radio tuned to that frequency hears the broadcast. The station doesn't know how many radios are listening. The radios don't know who else is tuned in. Adding a new listener costs the station nothing.

---

## 8. When you'll see it
- Event buses inside an application (domain events, audit log).
- Real-time updates (WebSocket fan-out).
- Microservices via Kafka/NATS/RabbitMQ topics.
- `chan` plus `for range` in goroutine pipelines.
- Logging frameworks where one log line goes to many sinks.
- `context.Context.Done()` — a broadcast (every reader of `Done()` sees the same close).

---

## 9. Common mistakes
- **No buffer + blocking publish** — one slow subscriber halts everyone.
- **No unsubscribe path** — subscribers leak; the subscriber list grows forever.
- **Closing the broker without closing channels** — receivers block forever on a never-arriving message.
- **Sharing a slice/map message by reference** — subscribers may mutate; later subscribers see the mutation.

---

## 10. Summary

Pub/Sub decouples publishers from subscribers via a named topic. In Go, the in-process form is just `map[topic][]chan T` guarded by a mutex. The two hard parts are: (1) how to handle slow subscribers (drop / block / disconnect) and (2) how to clean up on unsubscribe. Get those right and the pattern stays simple.

---

## Further reading
- Refactoring.Guru — Observer / Publisher-Subscriber
- `nats.go` source — production broker client
- `cloudevents/sdk-go` — event format and routing
- "Go channels in detail" — Go blog
