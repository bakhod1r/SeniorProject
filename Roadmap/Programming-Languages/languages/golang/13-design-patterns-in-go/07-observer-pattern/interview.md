# Observer Pattern — Interview Preparation

## 1. What interviewers test for

Observer is the pattern interviewers use to probe your understanding of Go's concurrency primitives. They want to see:

- Do you reach for channels by default, or for explicit struct-based observers?
- Do you understand `close(chan)` as a broadcast mechanism?
- Can you reason about backpressure and slow consumers?
- Do you know when to use `sync.RWMutex` vs `atomic.Pointer` for the subscriber list?
- Can you spot goroutine leaks in observer code?

Signals by level:

| Level | Looking for |
|-------|-------------|
| Junior | Recognize Observer; know channels do it idiomatically; understand subscribe/unsubscribe |
| Middle | Pick concurrency primitives appropriately; handle slow observers; test observers |
| Senior | Design at scale; replace Observer with broker when needed; ordering guarantees |

---

## 2. Junior questions

### Q1. What's the Observer pattern?

**Answer:** A subject keeps a list of observers and notifies them on state change. Each observer reacts independently. The subject doesn't know what each observer does; it just calls them.

In Go, this is usually done with channels (subject sends to a channel; observers receive). Explicit struct-based observers also work.

**Common wrong answer:** "It's pub-sub" — close, but pub-sub usually implies a *broker* with topics. Observer is simpler: one subject, many observers.

---

### Q2. Why are channels often a better fit than explicit Observer in Go?

**Answer:** Channels are part of the language. They handle:
- The subscriber list (implicit — anyone reading from the channel).
- Synchronization (built into channel ops).
- Cancellation (close the channel).
- Backpressure (buffered vs unbuffered).

Explicit Observer requires implementing all four yourself. Channels are smaller, faster, and idiomatic.

---

### Q3. Show me a minimal channel-based Observer.

**Answer:**

```go
type Event struct{ Data string }

type Subject struct {
    mu          sync.Mutex
    subscribers []chan Event
}

func (s *Subject) Subscribe() <-chan Event {
    ch := make(chan Event, 10)
    s.mu.Lock()
    s.subscribers = append(s.subscribers, ch)
    s.mu.Unlock()
    return ch
}

func (s *Subject) Publish(e Event) {
    s.mu.Lock()
    subs := s.subscribers
    s.mu.Unlock()
    for _, ch := range subs {
        select {
        case ch <- e:
        default: // drop if slow
        }
    }
}
```

---

### Q4. How would you unsubscribe?

**Answer:** Two patterns:

1. **Return an unsubscribe function from Subscribe:**

```go
func (s *Subject) Subscribe() (<-chan Event, func()) {
    ch := make(chan Event, 10)
    s.mu.Lock()
    s.subscribers = append(s.subscribers, ch)
    s.mu.Unlock()
    return ch, func() {
        s.mu.Lock()
        for i, c := range s.subscribers {
            if c == ch {
                s.subscribers = append(s.subscribers[:i], s.subscribers[i+1:]...)
                break
            }
        }
        s.mu.Unlock()
        close(ch)
    }
}
```

2. **Caller closes a done channel:**

```go
ch, _ := s.Subscribe()
done := make(chan struct{})
go func() {
    for {
        select {
        case ev := <-ch:
            handle(ev)
        case <-done:
            return
        }
    }
}()
```

Pattern 1 is cleaner; pattern 2 doesn't need cleanup tracking in the subject.

---

### Q5. What's wrong here?

```go
for _, obs := range s.observers {
    obs.Notify(ev)
}
```

**Answer:** No mutex around the read. If `Subscribe` happens concurrently, the slice may be modified during iteration — race condition.

Fix: snapshot under lock:

```go
s.mu.RLock()
snapshot := append([]Observer(nil), s.observers...)
s.mu.RUnlock()
for _, obs := range snapshot {
    obs.Notify(ev)
}
```

---

### Q6. What does `close(chan)` do for observers?

**Answer:** Broadcasts. All goroutines blocked in `<-chan` wake up simultaneously, each receiving the zero value (and `ok=false` from comma-ok).

Common use: cancellation signal. `context.Context.Done()` is exactly this — a channel closed when the context is cancelled.

```go
done := make(chan struct{})
// 100 goroutines:
go func() { <-done; cleanup() }()
close(done)  // wakes all 100
```

---

### Q7. What's the difference between Observer and Pub/Sub?

**Answer:** Observer is in-process: one subject, observers register directly. Pub/Sub usually involves a *broker* (Kafka, NATS, Redis pub-sub) with topics — publishers don't know who subscribes.

In Go terms:
- Observer: a `Subject` struct.
- Pub/Sub: a broker (in-process or external) with `Publish(topic, msg)` / `Subscribe(topic)`.

The boundary is fuzzy. A topic-based in-memory observer system is "Pub/Sub style".

---

### Q8. How do you handle a slow observer?

**Answer:** Three options:

- **Drop:** `select { case ch <- ev: default: }` — fast but lossy.
- **Block:** plain `ch <- ev` — preserves order, slows everyone down.
- **Buffer + drop:** large buffer, drop only when full.

The right choice depends on the application. For metrics, dropping is fine. For order events, blocking (with a watchdog) might be required.

---

### Q9. What's a goroutine leak in observer code?

**Answer:** When a goroutine is started to consume from a subscription channel but never exits. Common cause: `Unsubscribe` doesn't close the channel, and the goroutine blocks forever on `<-ch`.

Fix: `Unsubscribe` should `close(ch)`. Then the consumer's `for ev := range ch` exits cleanly.

```go
ch, unsub := s.Subscribe()
defer unsub()
for ev := range ch {
    handle(ev)
}
```

---

### Q10. Should `Publish` be synchronous or asynchronous?

**Answer:** Synchronous by default. Each subscriber's channel is buffered; sends are non-blocking until the buffer fills.

Asynchronous (one goroutine per notification) adds significant cost (~3 µs per goroutine creation). Reserve for cases where observers may block on I/O.

---

## 3. Middle questions

### Q1. RWMutex or atomic.Pointer for the subscriber list?

**Answer:** Depends on the read/write ratio.

- **RWMutex:** simpler, fine when writes are not rare. ~10 ns per RLock.
- **atomic.Pointer with copy-on-write:** ~2 ns per Load, but writers copy the entire slice. Worth it when reads outnumber writes 100× or more.

In an Observer system, reads (notifications) typically dominate writes (subscribe/unsubscribe). `atomic.Pointer` is often the right call.

---

### Q2. How would you implement Subscribe-with-filter?

**Answer:**

```go
type Filter func(Event) bool

type filteredSub struct {
    ch     chan Event
    filter Filter
}

func (s *Subject) SubscribeFilter(f Filter) <-chan Event {
    sub := &filteredSub{ch: make(chan Event, 10), filter: f}
    s.mu.Lock()
    s.subs = append(s.subs, sub)
    s.mu.Unlock()
    return sub.ch
}

func (s *Subject) Publish(e Event) {
    s.mu.RLock()
    subs := s.subs
    s.mu.RUnlock()
    for _, sub := range subs {
        if sub.filter == nil || sub.filter(e) {
            select { case sub.ch <- e: default: }
        }
    }
}
```

The filter runs in the publisher's goroutine — keep it cheap.

---

### Q3. How do you test an Observer?

**Answer:**

```go
func TestSubject_Publish(t *testing.T) {
    s := &Subject{}
    ch, unsub := s.Subscribe()
    defer unsub()

    go s.Publish(Event{Data: "hello"})

    select {
    case ev := <-ch:
        if ev.Data != "hello" { t.Errorf("got %v", ev.Data) }
    case <-time.After(time.Second):
        t.Fatal("timeout")
    }
}
```

Key idioms:
- Use `select` with timeout to avoid hanging tests.
- `defer unsub()` to clean up subscriptions.
- Run `Publish` in a goroutine (or arrange for it to be called async).

For concurrent stress tests, use `go test -race`.

---

### Q4. What's the danger of holding the lock during notification?

**Answer:** If `obs.Notify(ev)` is slow or blocks, *all* observers are blocked from receiving, and new subscribers wait. The pattern:

```go
// Bad
s.mu.Lock()
defer s.mu.Unlock()
for _, obs := range s.observers {
    obs.Notify(ev)
}

// Good
s.mu.RLock()
snapshot := append([]Observer(nil), s.observers...)
s.mu.RUnlock()
for _, obs := range snapshot {
    obs.Notify(ev)
}
```

Snapshot the observer list, release the lock, then notify.

---

### Q5. How would you handle re-entrant subscribe (an observer subscribing during its own Notify)?

**Answer:** The snapshot pattern (above) handles this. The current notification uses the snapshot; new subscribers from within `Notify` join the *next* notification round.

If you don't snapshot, re-entrant subscribe deadlocks (trying to acquire the lock that the publisher holds).

---

### Q6. Generic Observer[T] — implement it.

**Answer:**

```go
type Subject[T any] struct {
    mu   sync.RWMutex
    subs []chan T
}

func (s *Subject[T]) Subscribe() <-chan T {
    ch := make(chan T, 10)
    s.mu.Lock()
    s.subs = append(s.subs, ch)
    s.mu.Unlock()
    return ch
}

func (s *Subject[T]) Publish(v T) {
    s.mu.RLock()
    subs := append([]chan T(nil), s.subs...)
    s.mu.RUnlock()
    for _, ch := range subs {
        select { case ch <- v: default: }
    }
}
```

The same pattern but parameterised. Each instantiation (e.g., `Subject[Event]`) gets its own type-checked channels.

---

### Q7. What's a typed-event observer?

**Answer:** Multiple event types, each with its own subscriber list:

```go
type Bus struct {
    mu   sync.RWMutex
    subs map[reflect.Type][]chan any
}

func Subscribe[T any](b *Bus) <-chan T {
    var zero T
    t := reflect.TypeOf(zero)
    ch := make(chan any, 10)
    b.mu.Lock()
    b.subs[t] = append(b.subs[t], ch)
    b.mu.Unlock()
    // wrap to typed channel
    typed := make(chan T, 10)
    go func() {
        defer close(typed)
        for v := range ch { typed <- v.(T) }
    }()
    return typed
}

func Publish[T any](b *Bus, ev T) {
    t := reflect.TypeOf(ev)
    b.mu.RLock()
    subs := b.subs[t]
    b.mu.RUnlock()
    for _, ch := range subs {
        select { case ch <- ev: default: }
    }
}
```

Trade-off: reflection per Publish. For typed events with known types at compile time, define per-type subjects instead.

---

### Q8. How does `signal.Notify` work?

**Answer:** `signal.Notify(ch, signals...)` registers `ch` as an observer of OS signals. The Go runtime catches signals (via `sigaction`), translates them to `os.Signal` values, and sends them to all registered channels (with `default:` drop).

Key idioms:
- Channel must be buffered (cap 1+). Unbuffered + slow handler = lost signal.
- Multiple channels can be registered for the same signal — all receive.

```go
ch := make(chan os.Signal, 1)
signal.Notify(ch, os.Interrupt)
<-ch
shutdown()
```

---

### Q9. What's "fan-out" in observer terms?

**Answer:** One event reaching many observers. The pattern:

```go
for _, ch := range subscribers {
    ch <- event
}
```

Fan-out cost is O(N) per event. For low N (10s), trivial. For high N (1000s), considerable — at which point you might switch to a broker or batched delivery.

---

### Q10. How does ordering work across observers?

**Answer:** Within a single observer's channel, events arrive in publish order (Go channels are FIFO).

Across observers, ordering depends on goroutine scheduling. If you need cross-observer ordering (e.g., A must see event 1 before B sees event 2), you need a single dispatcher serializing events.

In practice, most Observer use cases don't need cross-observer ordering.

---

## 4. Senior questions

### Q1. When should Observer become Pub/Sub broker?

**Answer:** When:
- Cross-process delivery is needed (microservices).
- Persistence is required (replay missed events).
- Many publishers, many subscribers (fan-in + fan-out).
- Subscribers come and go independently of publisher lifetime.

In-process Observer is fine for ~100s of subscribers, single-process applications. For larger scope, use Kafka/NATS/Redis-pubsub.

---

### Q2. Design an observer system that guarantees delivery.

**Answer:** "Guaranteed delivery" in-process means:
- Buffered channels with large-enough buffer.
- Watchdog detects slow observers and either kills the process or warns.
- Persistent log alongside the in-memory channels (so restarts replay).

For real guarantees, use a broker with persistence (Kafka). In-memory observers are *best-effort* unless you accept the cost of persistence + acks.

---

### Q3. How would you scale an observer to 10,000 subscribers?

**Answer:** Several techniques:

- **Sharded subscriber lists** — partition by ID or topic; each shard has its own mutex.
- **Batched delivery** — accumulate events for a window (1ms), publish to all in one pass.
- **Lock-free with `atomic.Pointer`** — readers never block.
- **Dedicated dispatcher goroutines** — one per shard, draining a work queue.

At 10k subscribers, single-mutex Observer becomes a bottleneck. Architectural changes start to matter more than micro-optimizations.

---

### Q4. Critique this observer code.

```go
type Subject struct {
    observers []func(Event)
}

func (s *Subject) Subscribe(f func(Event)) {
    s.observers = append(s.observers, f)
}

func (s *Subject) Notify(e Event) {
    for _, o := range s.observers {
        go o(e)
    }
}
```

**Answer:** Multiple issues:

1. **No synchronization.** `append` from concurrent Subscribe + read in Notify → race.
2. **No unsubscribe.** Closures can't be compared; can't remove them.
3. **Goroutine per notification.** ~3 µs overhead per observer per event.
4. **Slow observer kills the process.** No backpressure; if observers can't keep up, goroutines accumulate.
5. **No cancellation.** Goroutines can't be stopped.

Refactor: use ID-based unsubscribe, snapshot under RLock, synchronous notification with `select-default` drop.

---

### Q5. Where does Observer fit in event-sourcing systems?

**Answer:** Event sourcing stores every state change as an event. Observers replay the events to derive current state.

- **Write side:** publish event → store in log → notify observers.
- **Read side:** observers project events into queries.
- **Replay:** new observers consume from the start of the log to catch up.

The Observer pattern is the *interface*; the event log is the *persistence*. Tools like EventStore, Kafka, or homegrown Postgres-based event stores provide both.

---

### Q6. What's the biggest performance pitfall in observer systems?

**Answer:** Notifying under lock. The whole point of the snapshot pattern is to release the lock before iteration. Without it, slow observers serialize all notifications and subscribes.

Profile with `-blockprofile`; mutex contention shows up immediately.

---

### Q7. Cross-language: Observer in Java vs Go.

**Answer:**

- **Java:** explicit `Observable` class with `addObserver()`, `notifyObservers()`. Single-threaded by default; concurrent versions exist. RxJava brings reactive streams.
- **Go:** channels are the default. `select` enables multiple observer streams.

Java code is more verbose; Go code is shorter and integrates with native concurrency. Both express the same pattern.

---

### Q8. Postmortem: a Kafka consumer falling behind crashed the producer. Diagnose.

**Answer:** Likely cause: blocking sends without timeout. The producer's `ch <- ev` blocked when the Kafka consumer's buffer filled. As more events arrived, producer goroutines accumulated, exhausting memory.

Fix: use `select { case ch <- ev: default: }` to drop or `select { case ch <- ev: case <-ctx.Done(): }` to bail on cancellation. Add metrics on dropped events to alert when the consumer falls behind.

---

### Q9. How do you decide buffer size for observer channels?

**Answer:** Considerations:

- **Burst tolerance:** how many events arrive while the observer is briefly slow?
- **Latency budget:** larger buffers mean stale events under load.
- **Memory:** N subscribers × buffer size × event size = memory cost.

Default: 10-100 for moderate-rate events; 1 for signal-style "one-shot" notifications (signal.Notify uses cap 1). Tune based on profiling.

---

### Q10. When should you NOT use Observer?

**Answer:**

- When there's only one subscriber. Direct calls are simpler.
- When ordering across subscribers matters. Use a serial dispatcher or message queue.
- When you need synchronous responses. Observer is fire-and-forget; for request/reply, use direct calls or RPC.
- When subscribers come from outside the process. Use a broker.

Observer is the *in-process broadcast* pattern. Different scopes need different tools.

---

## 5. Live coding challenges

### Challenge 1: Event bus

Build an event bus with topics, where subscribers register for a topic and publishers push events to a topic.

**Solution:**

```go
type Bus struct {
    mu     sync.RWMutex
    topics map[string][]chan Event
}

func (b *Bus) Subscribe(topic string) <-chan Event {
    ch := make(chan Event, 16)
    b.mu.Lock()
    if b.topics == nil { b.topics = map[string][]chan Event{} }
    b.topics[topic] = append(b.topics[topic], ch)
    b.mu.Unlock()
    return ch
}

func (b *Bus) Publish(topic string, e Event) {
    b.mu.RLock()
    subs := b.topics[topic]
    b.mu.RUnlock()
    for _, ch := range subs {
        select { case ch <- e: default: }
    }
}
```

---

### Challenge 2: Slow observer dropping

Modify so slow observers are detected and removed after N consecutive drops.

**Solution sketch:**

Track drop count per subscriber. When the count exceeds a threshold, remove from the list and close the channel.

---

### Challenge 3: Generic Observer[T]

Implement with type parameters (Go 1.18+).

**Solution:** see middle Q6 above.

---

## 6. System design starters

- **Notification system** — millions of users, push notifications via mobile/web/email. Observer at the per-process level, broker (Kafka) for cross-process fan-out.
- **Real-time updates** — Slack-style live updates. WebSocket per client, in-process Observer pushing events to each.
- **Watching config changes** — etcd or Consul watchers. Channel-based, blocks on `Next()`.
- **Prometheus collectors** — `prometheus.Collector.Collect(ch chan<- Metric)` is observer-like; metrics push into a channel during scrape.
- **Event sourcing** — append events to log; subscribers project into views.

---

## 7. Traps

- **No mutex** on subscriber list → race.
- **No buffered channel** → producer blocks on slow consumer.
- **Goroutine leak** when unsubscribe doesn't close the channel.
- **Lock held during notification** → cascading slowdowns.
- **Closure comparison** for unsubscribe → can't compare functions.
- **Re-entrant subscribe** during Notify → deadlock without snapshot.

---

## 8. Questions to ASK

- "How do you handle slow observers in your event system?"
- "What's your buffer-size convention for subscription channels?"
- "Do you have observability on dropped events?"
- "When did you last replace in-process Observer with a broker, and why?"

---

## 9. Cross-references

- **`../03-strategy-pattern/`** — Strategy is "one of these implementations"; Observer is "all of these notified".
- **`../04-decorator-pattern/`** — Observers often decorate (logging observer, metrics observer).
- **`../16-pubsub-pattern/`** — Observer's distributed sibling.
- **`../12-chain-of-responsibility-pattern/`** — Linear pipeline; Observer is fan-out.

Observer in Go is *built into the language* via channels. Mastery is recognizing when channels suffice, when explicit subject/observer pays off, and when to escalate to a broker.
