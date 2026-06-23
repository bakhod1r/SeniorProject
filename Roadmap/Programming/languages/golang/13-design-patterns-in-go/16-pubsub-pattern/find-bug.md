# Pub/Sub — Find the Bug

## 1. How to use this file

Fifteen buggy Pub/Sub snippets. Read each, spot the defect in 30-60 seconds, then expand `<details>` for the answer. Every bug here has shown up in real Go production code — Pub/Sub looks like a `map[string][]chan T` from a blog post, which is exactly why it regresses so quietly.

Pub/Sub bugs rarely crash on the happy path. They drop one event in ten thousand, deadlock when a single subscriber gets slow, leak a goroutine per HTTP request, or replay a million events on restart. The skill is asking: *what does the slow subscriber do to the fast one, what does the next message see, and what happens at shutdown?*

---

## Bug 1 — Locking during delivery

```go
type Broker struct {
    mu   sync.Mutex
    subs map[string][]chan Event
}

func (b *Broker) Publish(topic string, e Event) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, ch := range b.subs[topic] {
        ch <- e                              // blocks while holding the lock
    }
}
```

<details><summary>Answer</summary>

**Bug:** `Publish` holds `b.mu` for the entire delivery loop. One subscriber with a full buffer blocks the send; the mutex stays locked; every other publisher, subscriber and unsubscribe piles up. One slow subscriber freezes the entire broker.

**Why subtle:** Tests pass — the harness drains every channel promptly. In production, a single handler that does a slow HTTP call (or gets GC-paused) is enough to stall every topic, even unrelated ones.

**Spot:** Any `Publish` doing I/O — including channel sends — while holding the broker mutex.

**Fix:** Snapshot under lock, deliver outside the lock:

```go
b.mu.RLock()
cps := append([]chan Event(nil), b.subs[topic]...)
b.mu.RUnlock()
for _, ch := range cps {
    select { case ch <- e: default: }
}
```

**Why common:** "Lock, do the work, unlock" is the safe default for shared maps. For a broker the work *is* the slow part, so the safe default becomes the bottleneck.
</details>

---

## Bug 2 — Blocking publish with no buffer

```go
func (b *Broker) Subscribe(topic string) <-chan Event {
    ch := make(chan Event)                   // UNBUFFERED
    b.mu.Lock()
    b.subs[topic] = append(b.subs[topic], ch)
    b.mu.Unlock()
    return ch
}

func (b *Broker) Publish(topic string, e Event) {
    // snapshot subscribers as cps...
    for _, ch := range cps {
        ch <- e                              // blocks until receiver ready
    }
}
```

<details><summary>Answer</summary>

**Bug:** Unbuffered channel + blocking send. The publisher waits for *every* subscriber to be parked on a receive before it can move on. One subscriber doing any synchronous work between receives — a DB call, a `json.Marshal` — stalls the publisher and every later subscriber on the same call.

**Why subtle:** Single-subscriber tests work. Two prompt readers work. The pathology shows when one handler is briefly busy.

**Spot:** `make(chan Event)` with no buffer in a fan-out path, paired with a plain `ch <- e` send.

**Fix:**

```go
ch := make(chan Event, 16)
// and at the send site:
select {
case ch <- e:
default:
    // drop or count or disconnect — explicit policy
}
```

If "every subscriber gets every message" is mandatory, use a brokered system that handles back-pressure for you.

**Why common:** Unbuffered channels are the Go idiom for handoff synchronization. In a 1-to-1 pipeline they're fine; in a 1-to-N fan-out they're a serialization point.
</details>

---

## Bug 3 — Forgotten unsubscribe

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ch := broker.Subscribe("notifications")
    for ev := range ch {
        fmt.Fprintf(w, "data: %s\n\n", ev.JSON)
        if f, ok := w.(http.Flusher); ok { f.Flush() }
    }
}
```

<details><summary>Answer</summary>

**Bug:** No matching `Unsubscribe`. When the client disconnects and the handler returns, the channel is still in `b.subs[topic]`. The broker keeps sending on it forever. The buffer fills; further sends block or drop silently. Every reconnect adds another phantom subscriber. After an hour of an SSE endpoint with occasional drops, the broker has 50,000 ghost subscribers each holding a buffer.

**Why subtle:** Memory grows slowly. Channels are tiny. Goroutine count stays flat — it's *channels* leaking. The symptom is a publisher that gets slower over weeks until somebody restarts the service.

**Spot:** Any `Subscribe` without a paired `Unsubscribe` or context-bound cleanup.

**Fix:** Tie subscription lifetime to a `context.Context`:

```go
func (b *Broker) Subscribe(ctx context.Context, topic string) <-chan Event {
    ch := make(chan Event, 32)
    b.mu.Lock(); b.subs[topic] = append(b.subs[topic], ch); b.mu.Unlock()
    go func() {
        <-ctx.Done()
        b.mu.Lock()
        b.subs[topic] = removeChan(b.subs[topic], ch)
        close(ch)
        b.mu.Unlock()
    }()
    return ch
}
// caller: ch := broker.Subscribe(r.Context(), "notifications")
```

**Why common:** The happy-path "subscribe and loop" reads cleanly. Cleanup only matters on the unhappy path — disconnects, panics, cancellations — which no test exercises.
</details>

---

## Bug 4 — Closing broker without closing subscriber channels

```go
func (b *Broker) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.closed = true
    b.subs = nil                             // drop refs; channels never closed
}

// subscriber elsewhere: for ev := range ch { process(ev) }
```

<details><summary>Answer</summary>

**Bug:** `Close` clears the map but doesn't `close()` the channels. Every subscriber goroutine is blocked on `for ev := range ch` waiting for a value that will never arrive. Shutdown deadlocks any `wg.Wait()` on those subscribers; if nobody waits, the goroutines leak until the process exits.

**Why subtle:** `b.subs = nil` *looks* like cleanup. The map is gone, the broker can be GC'd. But Go puts the close responsibility on the *sender* — the broker stops sending, but the channel is never marked done.

**Spot:** Any broker `Close` / shutdown that doesn't iterate every subscriber channel and call `close(ch)`.

**Fix:**

```go
func (b *Broker) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed { return }
    b.closed = true
    for _, list := range b.subs {
        for _, ch := range list { close(ch) }
    }
    b.subs = nil
}
```

Pair this with the rule that **only the broker sends** — otherwise close is a panic source.

**Why common:** Channel close semantics aren't symmetric with "close a file". Developers reach for `Close` as teardown without remembering it's also a synchronization signal for receivers.
</details>

---

## Bug 5 — Publishing pointer to mutable struct

```go
func placeOrder(o *Order) {
    ev := &OrderEvent{OrderID: o.ID, Status: "placed", Items: o.Items}
    broker.Publish("orders", ev)

    if o.NeedsFraudCheck() {
        ev.Status = "pending_review"         // mutate after publish
    }
}
// audit subscriber:   log.Printf("order %s status=%s", ev.OrderID, ev.Status)
// webhook subscriber: sendWebhook(ev)
```

<details><summary>Answer</summary>

**Bug:** `Publish` hands the broker `*OrderEvent` — a pointer to a struct the publisher still owns. After `Publish` returns, the publisher mutates `ev.Status`. The audit and webhook subscribers are reading the same struct concurrently with the writer. The audit log shows `placed` or `pending_review` depending on timing; the webhook payload includes whichever status was current when the subscriber serialized. `Items` is a slice — later appends are visible to both subscribers too.

`go test -race` catches it. Production catches it as "the audit log doesn't match the webhook".

**Why subtle:** The publisher's intent was *two* events. The fact that the second is a mutation rather than another `Publish` is the bug. The compiler can't tell.

**Spot:** `Publish(topic, ptr)` followed by any mutation of `*ptr` or its slice/map fields.

**Fix:** Send by value, treat messages as immutable, or copy at the broker boundary:

```go
broker.Publish("orders", OrderEvent{
    OrderID: o.ID, Status: "placed",
    Items: append([]Item(nil), o.Items...),  // copy slice
})
```

Brokered systems do this for free — serializing copies. In-process brokers don't.

**Why common:** Pointers are cheap and the publisher *just built* the struct, so reusing it feels efficient. The boundary between "my struct" and "the broker's struct" is invisible to the compiler.
</details>

---

## Bug 6 — Race on subscriber list

```go
type Broker struct {
    subs map[string][]chan Event              // no mutex
}

func (b *Broker) Subscribe(topic string) <-chan Event {
    ch := make(chan Event, 32)
    b.subs[topic] = append(b.subs[topic], ch)
    return ch
}

func (b *Broker) Publish(topic string, e Event) {
    for _, ch := range b.subs[topic] {
        select { case ch <- e: default: }
    }
}
```

<details><summary>Answer</summary>

**Bug:** `b.subs` is a plain Go map. `Subscribe` writes; `Publish` reads; both run from arbitrary goroutines with no mutex. That's a concurrent map access — undefined behavior. The runtime usually catches it with `fatal error: concurrent map writes` (a crash that bypasses `recover`), but it may also silently corrupt the slice and dispatch to a freed channel.

**Why subtle:** Maps and slices feel "lightweight" and the broker reads sequentially. Without explicit concurrent calls in tests, you never see the crash. The first sign is a 2 AM panic with a `runtime.mapaccess1_faststr` frame.

**Spot:** Any shared map or slice used by methods documented as "safe from multiple goroutines" with no mutex anywhere.

**Fix:** Wrap with a `sync.RWMutex`; snapshot under read-lock, deliver outside (see Bug 1). `sync.Map` is *not* the right answer — its API doesn't fit "append to a slice value".

**Why common:** A broker that "just works" in single-threaded tests passes review. Concurrency only enters the picture at deployment, by which time the missing mutex is no longer load-bearing in the reviewer's memory.
</details>

---

## Bug 7 — Subscriber range never returning

```go
func (b *Broker) Unsubscribe(topic string, target <-chan Event) {
    b.mu.Lock()
    defer b.mu.Unlock()
    list := b.subs[topic]
    for i, ch := range list {
        if ch == target {
            b.subs[topic] = append(list[:i], list[i+1:]...)
            return                           // never closes the channel
        }
    }
}

// worker: for ev := range ch { process(ev) }   // never exits
```

<details><summary>Answer</summary>

**Bug:** `Unsubscribe` removes the channel from the broker but never `close()`s it. The worker is still blocked on `for ev := range ch` waiting for a value that will never come. The goroutine leaks; the channel and its buffer leak with it. This is the dual of Bug 4 — Bug 4 closed the broker but not the channels; here, one channel is unhooked but left open.

**Why subtle:** `Unsubscribe` *looks* complete — the broker stops sending, so isn't the subscriber done? But the worker has no other signal: the channel is its only input, `range` is its only loop control.

**Spot:** Any `Unsubscribe` / `Remove` / `Deregister` that mutates the data structure but never calls `close(ch)`. Also any subscriber loop with no select-on-context branch.

**Fix:**

```go
b.subs[topic] = append(list[:i], list[i+1:]...)
close(ch)                                    // wake the receiver
return
```

Or make the subscriber resilient with a context branch:

```go
for {
    select {
    case ev, ok := <-ch:
        if !ok { return }
        process(ev)
    case <-ctx.Done():
        return
    }
}
```

**Why common:** "Remove from map" and "close channel" are two unrelated operations. The author of `Unsubscribe` was thinking about the data structure, not the receiver loop.
</details>

---

## Bug 8 — Wildcard match returning ALL topics

```go
// "orders.*" matches "orders.placed"; "*" matches everything
func match(pattern, topic string) bool {
    if pattern == "*" { return true }
    if strings.HasSuffix(pattern, ".*") {
        prefix := pattern[:len(pattern)-2]   // strips ".*"
        return strings.HasPrefix(topic, prefix)
    }
    return pattern == topic
}
```

<details><summary>Answer</summary>

**Bug:** `match("orders.*", "orders_admin")` returns `true`. The author meant the prefix to be `"orders."` but `pattern[:len(pattern)-2]` strips both the `.` and the `*`, leaving `"orders"`. Anything starting with `orders` — `orders`, `orders_admin`, `orders42` — matches. A subscriber to `orders.*` receives events from unrelated topics. Worse, audit/security consumers that subscribed narrowly silently see data they shouldn't.

**Why subtle:** The author thought of `.*` as a unit; they actually need to keep the `.` as part of the prefix.

**Spot:** Any matching/glob logic written by hand, with no table-driven test that includes adversarial cases (`"orders_admin"`, `"orders"`, `"order.s"`).

**Fix:**

```go
prefix := pattern[:len(pattern)-1]           // keep the trailing dot
return strings.HasPrefix(topic, prefix)
```

Better: use a real matcher (NATS `>` and `*`, or MQTT `#`/`+`) with an off-the-shelf library and property-based tests.

**Why common:** Wildcard matchers are written in five minutes. The off-by-one in the slice is exactly the kind of bug a unit test "passes" on the cases the author thought of.
</details>

---

## Bug 9 — Acking message before processing

```go
func consume(sub *nats.Subscription) {
    for {
        msg, err := sub.NextMsg(time.Second)
        if err != nil { continue }

        if err := msg.Ack(); err != nil {
            log.Print(err); continue
        }
        if err := process(msg.Data); err != nil {
            log.Printf("process: %v", err)
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** `msg.Ack()` is called *before* `process`. If `process` fails — panic, network error, DB deadlock, OOM kill — the message is already acknowledged. The broker considers it delivered. No retry, no replay, no dead-letter. The event is lost.

The same shape appears in Kafka (`MarkMessage` / commit) and RabbitMQ (`Ack` with `autoAck=false`). Every at-least-once broker has this footgun: ack means "I'm done", not "I received it".

**Why subtle:** Acking immediately makes the consumer faster — no holding the message slot open during processing — and feels safer ("at least the broker knows we got it"). In stress tests with no errors, it's strictly better. The failure mode only appears when processing fails *and* you'd hoped for redelivery.

**Spot:** Any `Ack` / commit / `MarkMessage` that runs before the result of `process(msg)` is committed to durable state.

**Fix:**

```go
if err := process(msg.Data); err != nil {
    log.Printf("process: %v", err)
    _ = msg.Nak()                            // back to the queue, with backoff
    continue
}
if err := msg.Ack(); err != nil { log.Print(err) }
```

If `process` is non-idempotent, you also need an idempotency key in your own store — at-least-once + non-idempotent processing is a duplicate-event bug factory.

**Why common:** "Ack early to free the slot" is folklore from fragile-consumer days. Modern brokers expect you to hold the message until you're truly done; their flow control assumes it.
</details>

---

## Bug 10 — Loop variable in goroutine (pre-Go-1.22)

```go
// go.mod: go 1.21
for _, s := range cps {
    go func() {
        select {
        case s.ch <- e:                      // s captured by reference
        case <-time.After(s.deadline):
        }
    }()
}
```

<details><summary>Answer</summary>

**Bug:** Pre-Go-1.22, the loop variable `s` is **one** variable reused across iterations. Each goroutine captures the same address. By the time the goroutines run, `s` points at the last subscriber. Every spawned goroutine delivers to that last subscriber; every other subscriber gets nothing — and multiple goroutines race on `s.ch` while the publisher is still looping.

Go 1.22+ changed the spec so loop variables are per-iteration, fixing this. Legacy modules still target older versions, and cross-version refactors have to deal with both worlds.

**Why subtle:** The loop "works" if subscribers are identical (the bug becomes "we delivered N copies to subscriber N-1, which is the same shape as N copies to N subscribers"). With heterogeneous deadlines or channels, it fails silently.

**Spot:** Pre-1.22 code with `for _, x := range xs { go func() { use(x) } }`. `go vet -loopclosure` catches it.

**Fix:**

```go
for _, s := range cps {
    s := s                                   // per-iteration copy
    go func() { /* uses s safely */ }()
}
// or: go func(s *sub) { ... }(s)
```

**Why common:** It was *the* Go gotcha for a decade. Even 1.22+ codebases inherit it through vendored code, older `go` directives, and copy-paste from old Stack Overflow answers.
</details>

---

## Bug 11 — Reconnect handler holding mutex during dial

```go
func (c *NATSClient) onDisconnect() {
    c.mu.Lock()
    defer c.mu.Unlock()
    for {
        conn, err := nats.Connect(c.url, nats.Timeout(30*time.Second))
        if err == nil { c.conn = conn; return }
        time.Sleep(time.Second)
    }
}

func (c *NATSClient) Publish(topic string, data []byte) error {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.conn.Publish(topic, data)
}
```

<details><summary>Answer</summary>

**Bug:** `onDisconnect` takes `c.mu` and then *dials in a loop, possibly for minutes*. Every `Publish` goes through the same mutex, so every publisher is blocked for the entire reconnect. The application thinks it's "still publishing"; the queue of publishes grows on goroutine stacks; memory climbs; HTTP handlers time out.

This pattern surfaces in any pub/sub client wrapper that needs to swap a connection: NATS, Kafka, gRPC, AMQP.

**Why subtle:** It works *during* normal operation — the mutex is held briefly per publish. The pathology only appears on the reconnect path, which you don't load-test.

**Spot:** Any mutex-protected method that performs network I/O while holding the lock. Split "decide what to do" (under lock) from "do it" (lock released).

**Fix:**

```go
func (c *NATSClient) onDisconnect() {
    var conn *nats.Conn
    for {
        var err error
        conn, err = nats.Connect(c.url, nats.Timeout(30*time.Second))
        if err == nil { break }
        time.Sleep(time.Second)
    }
    c.mu.Lock(); old := c.conn; c.conn = conn; c.mu.Unlock()
    if old != nil { old.Close() }
}

func (c *NATSClient) Publish(topic string, data []byte) error {
    c.mu.Lock(); conn := c.conn; c.mu.Unlock()
    if conn == nil { return errors.New("not connected") }
    return conn.Publish(topic, data)
}
```

For high-frequency callers, replace the mutex with `atomic.Pointer[nats.Conn]`.

**Why common:** "Hold the lock so the connection doesn't change underfoot" is the path of least thought. It works perfectly until the operation under the lock blocks.
</details>

---

## Bug 12 — Prefetch too high, slow consumer holds messages

```go
return kafka.NewReader(kafka.ReaderConfig{
    Brokers:       brokers,
    GroupID:       group,
    Topic:         topic,
    QueueCapacity: 1000,                     // prefetch a lot
    MinBytes:      10 << 10,
    MaxBytes:      10 << 20,
})

// handler averages 200ms; occasionally 5s under load
```

<details><summary>Answer</summary>

**Bug:** `QueueCapacity: 1000` tells the client to prefetch up to 1,000 messages into an in-memory buffer. When one consumer is slow (5-second downstream call), it sits on 1,000 messages that *belong to its partition assignment*. Other consumers in the group can't help — those messages are assigned. Partition lag grows: 1,000 messages × 5 seconds = 83 minutes of backlog in one consumer's buffer.

Worse, on session timeout the broker rebalances; those 1,000 messages get reassigned and *redelivered*. Throughput drops; duplicates rise. "Tune prefetch up for speed" makes everything worse.

**Why subtle:** Higher prefetch *does* speed up the steady-state case where every consumer is healthy. The failure is asymmetric — one slow consumer dominates.

**Spot:** Any consumer config with prefetch / queue capacity / in-flight limit set "high" without a per-consumer SLO that supports it. Rule of thumb: prefetch ≈ 2× one consumer's per-second throughput.

**Fix:** `QueueCapacity: 10` (or whatever 2× steady-state throughput is). For RabbitMQ / NATS the equivalent is `prefetch_count` / `MaxAckPending`. Tune from a metric (`messages_in_flight`), not from intuition.

**Why common:** Prefetch is a "throughput knob" in every tutorial. The trade-off ("buffer is per-consumer; slow consumer hoards") is in the docs but not in the headline.
</details>

---

## Bug 13 — Manual offset commit forgotten

```go
func (c *Consumer) Run(ctx context.Context) error {
    for {
        msg, err := c.reader.FetchMessage(ctx)   // manual commit mode
        if err != nil { return err }

        if err := c.processInTx(msg); err != nil {
            log.Printf("process: %v", err); continue
        }
        // BUG: c.reader.CommitMessages(ctx, msg) never called
    }
}
```

<details><summary>Answer</summary>

**Bug:** The author switched to manual commits (`FetchMessage` vs `ReadMessage`) but never called `CommitMessages`. The broker still has the *last* committed offset from before the change — possibly from days ago. On every restart, the consumer re-reads everything since that offset. Each restart triggers a replay storm. `processInTx` inserts duplicates (or, with a unique constraint, the log fills with violations).

**Why subtle:** In steady state the consumer works. The bug shows only at restart, which the team carefully avoids in production. Then there's a deploy — and the new pod replays a week of events.

**Spot:** Switching `ReadMessage` → `FetchMessage` (Kafka), or `autoAck=true` → `autoAck=false` (RabbitMQ), or `Subscribe` → `PullSubscribe` (NATS) requires an explicit ack/commit. Grep for the matched call.

**Fix:**

```go
if err := c.processInTx(msg); err != nil {
    continue                                 // do NOT commit
}
if err := c.reader.CommitMessages(ctx, msg); err != nil {
    log.Printf("commit: %v", err)
}
```

For at-least-once + idempotent processing, this is enough. For exactly-once you need transactional outbox or a single Kafka transaction wrapping read-process-write.

**Why common:** "Manual commit" sounds like "now I control commits", not "now I'm responsible for every commit". Tutorials show the fetch loop; the commit line is on the next page.
</details>

---

## Bug 14 — Subscriber panic kills the broker goroutine

```go
func (b *Broker) Publish(topic string, e Event) {
    // snapshot subscribers as cps...
    for _, fn := range cps {
        fn(e)                                // synchronous, in the publisher's goroutine
    }
}

func startBus() {
    go func() {
        for e := range incoming { broker.Publish(e.Topic, e) }
    }()
}
```

<details><summary>Answer</summary>

**Bug:** Subscribers run synchronously inside the publisher's goroutine. If one subscriber panics (nil deref, index out of range, division by zero), the panic propagates through `Publish` and `for e := range incoming`. The bus goroutine dies. No more events get delivered to *any* topic, by *any* subscriber. The app looks healthy — HTTP serves, metrics scrape — but its event flow is silently dead.

**Why subtle:** One bad subscriber takes everyone down. The crashed goroutine vanishes; whoever started it isn't watching for respawn. Logs may not even show a clean stack trace if `panic` happens deep.

**Spot:** Any broker that invokes subscriber callbacks synchronously without a per-call `defer recover()`.

**Fix:**

```go
for _, fn := range cps {
    func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("subscriber panic on %s: %v\n%s", topic, r, debug.Stack())
                metrics.SubPanics.WithLabelValues(topic).Inc()
            }
        }()
        fn(e)
    }()
}
```

Better: run each handler in its own goroutine with the same wrapper, so a slow handler can't stall the others either. Alert on the panic counter — a healthy bus has zero subscriber panics.

**Why common:** Synchronous fan-out is the simplest implementation; the recover wrapper is "we'll add that when we need it". The first production panic is when you need it.
</details>

---

## Bug 15 — CloudEvents header injection

```go
type CloudEvent struct {
    ID, Source, Type string
    Data             map[string]any
}

func publishUserAction(action, userID string, payload map[string]any) error {
    ev := CloudEvent{
        ID:     uuid.NewString(),
        Source: "/users",
        Type:   "com.acme.user." + action,   // action from HTTP query
        Data:   payload,
    }
    return nats.Publish("audit", ev)
}

func handleAction(w http.ResponseWriter, r *http.Request) {
    action := r.URL.Query().Get("action")    // attacker-controlled
    publishUserAction(action, userID, body)
}
```

<details><summary>Answer</summary>

**Bug:** The CloudEvents `type` field is built from `action`, straight from the URL query. An attacker hits `/api/act?action=admin.deleted` and the broker fan-out delivers an event whose type *looks identical* to a legitimate `com.acme.user.admin.deleted` event. Downstream subscribers that filter on `type == "com.acme.user.admin.deleted"` to trigger compensating actions (revoke sessions, alert security) now fire on attacker-chosen input. An audit pipeline that uses `type` as a primary key sees a forged event indistinguishable from the real one.

The same shape appears with Kafka headers, NATS subject suffixes, AMQP routing keys — anywhere the *envelope* is built from untrusted input.

**Why subtle:** The `payload` field is treated as untrusted (the handler validates it). The `type` field looks like a constant prefix plus a string — the reviewer doesn't see "this string is attacker-controlled". Schema validators check that `type` is a string, not that the value is in a known set.

**Spot:** Any envelope field (subject, routing key, partition key, type, source) built by `prefix + userInput` or `fmt.Sprintf(template, userInput)`. Envelope fields must come from a closed set; payload is where untrusted data goes.

**Fix:**

```go
var allowedActions = map[string]string{
    "login":  "com.acme.user.login",
    "logout": "com.acme.user.logout",
    "update": "com.acme.user.update",
}

eventType, ok := allowedActions[action]
if !ok { return fmt.Errorf("unknown action %q", action) }
ev := CloudEvent{Type: eventType, /* ... */ }
```

Subscribers should *also* validate they only handle types they own — not because the publisher is trusted, but because envelopes cross trust boundaries.

**Why common:** Threat modeling for pub/sub focuses on payload validation and message integrity. The envelope feels like infrastructure, immune to attacker influence — until somebody builds it from a URL parameter.
</details>

---

## Summary

These bugs cluster into five families.

**Broker concurrency hygiene (1, 2, 6, 11, 14):** locking during delivery, unbuffered fan-out, unprotected subscriber map, mutex held across network I/O, no panic isolation. The broker is a concurrency point; every shared-state and slow-operation path deserves the same scrutiny as a critical section.

**Lifecycle and cleanup (3, 4, 7):** forgotten unsubscribe, broker close without channel close, unsubscribe without channel close. Subscriptions are resources. Tie them to a `context.Context` and close every channel on the path that hands ownership back.

**Message ownership and routing (5, 8, 15):** mutating a published struct, broken wildcard matcher, attacker-controlled envelope fields. Once an event leaves the publisher, the publisher does not own it any more — and any field a subscriber filters on must be drawn from a closed set.

**Brokered ack/commit discipline (9, 13):** acking before processing, manual commit forgotten. Brokered pub/sub trades latency for durability; the contract is "ack means I'm done", and any shortcut breaks at-least-once delivery.

**Tuning that backfires (10, 12):** loop-variable capture, prefetch too high. Defaults are usually right; deliberate tuning is usually wrong without a measurement to back it.

Review checklist for any Pub/Sub PR:

- [ ] Is the broker mutex *never* held during channel sends, network I/O, or subscriber callbacks?
- [ ] Are subscriber channels buffered, and is the slow-subscriber policy (drop / block / disconnect) explicit and per-subscriber?
- [ ] Does every `Subscribe` have a matching cleanup — ideally tied to a `context.Context` rather than a manual `Unsubscribe`?
- [ ] On broker shutdown (and on `Unsubscribe`), is every subscriber channel explicitly `close()`d so receivers exit their `range`?
- [ ] Are published messages either value types, deep-copied, or treated as immutable by convention enforced in code review?
- [ ] Is every subscriber callback wrapped in `defer recover()` with a metric and a log, so one bad handler can't kill the broker?
- [ ] For wildcard topics, is the matcher backed by a property-based test that includes adversarial near-matches?
- [ ] For at-least-once brokers, does `ack` / `commit` run *after* the side effects are durably committed — never before?
- [ ] Is consumer prefetch / queue capacity tuned to ~2× steady-state throughput, not "as high as possible"?
- [ ] Are envelope fields (topic, subject, routing key, type) drawn from a closed allowlist, never built by concatenating untrusted input?
