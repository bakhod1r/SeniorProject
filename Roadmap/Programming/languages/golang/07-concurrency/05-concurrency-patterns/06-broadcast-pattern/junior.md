# Broadcast Pattern — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I have one event. Several goroutines need to react to it. How do I deliver the *same* message to *all* of them?"

A Go channel is a one-to-one delivery pipe. Each value sent is received by exactly one receiver. That is the rule. It is a feature, because it forces you to think about ownership and backpressure, but it is also a constraint, because plenty of real problems demand the *opposite* shape:

- "Tell every connected WebSocket client that a new chat message arrived."
- "Tell every background worker to shut down."
- "Tell every cache instance that key `K` was invalidated."
- "Tell every subscriber that the config just changed."

These are **broadcast** problems. One producer, many consumers, every consumer must see every event (or at least *one* event of the right kind). Naive code that writes the same value to a channel `N` times only reaches one receiver per write — fine in a loop, but you must know the receivers in advance, and they must all be waiting. We need patterns that scale, that handle subscribers coming and going, and that do not pin one slow consumer's problem onto everyone else.

This file teaches the two cheapest, most idiomatic broadcast techniques in Go:

1. **Close a channel** to wake every goroutine blocked on it. The classic shutdown idiom.
2. **A hub goroutine** that maintains a list of subscriber channels and forwards every event to each one.

You will also learn the cross-reference: `sync.Cond.Broadcast()`, which wakes all goroutines waiting on a condition variable. That tool belongs to the lock-based world; channels are usually preferred in Go, but `Cond` is irreplaceable for some shapes.

After this file you should be able to:

- Explain why `c <- v` is not a broadcast and what *is*.
- Implement a `done` channel that signals "stop" to many goroutines at once.
- Build a tiny pub/sub hub with subscribe and publish (unsubscribe is the middle level).
- Recognise the slow-subscriber problem and know that mitigation exists.

You do not yet need to handle dynamic unsubscribe under concurrent broadcast, design sharded hubs, or compare against Redis. Those come at the middle and senior levels.

---

## Prerequisites

- **Required:** Go 1.18+ (1.21+ recommended). Generics show up briefly in later sections.
- **Required:** Comfortable starting a goroutine with `go f()` and waiting for it with `sync.WaitGroup`.
- **Required:** Comfortable sending and receiving on unbuffered and buffered channels: `c <- v`, `v := <-c`, `v, ok := <-c`.
- **Required:** Understanding what `close(c)` does and what receiving from a closed channel returns.
- **Helpful:** Awareness of `select { case ... }`. You will see it in every example.
- **Helpful:** Read fan-out and fan-in first. Broadcast is the third common topology.

If you can compile a program that spawns three goroutines and waits for them to finish, you can read this file.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Broadcast** | Delivering the same message (or signal) to every member of a group. The opposite of *unicast* (one to one) and different from *fan-out* (one to one of many workers, where each value is processed once). |
| **Publisher** | The goroutine (or function) that produces events to be broadcast. |
| **Subscriber** | A goroutine that wants to receive every event. |
| **Hub** | A single goroutine (or struct) that owns the list of subscribers and forwards every incoming event to each subscriber's channel. |
| **Topic** | A named broadcast channel inside a hub. A pub/sub library typically supports multiple topics so subscribers only see events they care about. |
| **Subscription** | The result of a `Subscribe()` call — usually a receive-only channel and a handle to call `Unsubscribe()` later. |
| **`close(c)`** | The operation that marks a channel "no more values will be sent." After close, every receive returns the zero value with `ok=false`, *immediately, for every receiver*. This is the cheapest broadcast in Go. |
| **`sync.Cond`** | A condition variable from the `sync` package with `Wait`, `Signal`, and `Broadcast` methods. `Broadcast` wakes all waiters. |
| **Slow subscriber** | A subscriber whose channel is full or whose receive is paused, blocking the hub from delivering to other subscribers. The central problem of broadcast systems. |
| **Drop-on-overflow** | A mitigation: when a subscriber's buffer is full, discard the event for that subscriber instead of blocking the hub. Trades completeness for liveness. |
| **Fan-out (different topology)** | One queue, many workers, each item processed *once* by *one* worker. Not the same as broadcast. |

---

## Core Concepts

### Channels are unicast

Run this and predict the output:

```go
ch := make(chan int)
go func() { ch <- 1 }()

go func() { fmt.Println("A", <-ch) }()
go func() { fmt.Println("B", <-ch) }()

time.Sleep(time.Second)
```

You will see exactly one of `A 1` or `B 1`. Not both. The single send delivers to a single receiver. The other goroutine blocks forever (a leak). This is by design — a channel synchronises *one* sender with *one* receiver.

If you want *both* goroutines to receive, you need to send twice. If you want to send to N goroutines where N changes at runtime, you need a different structure entirely.

### Closing a channel wakes every receiver

Here is the trick that does the heavy lifting in 80% of broadcast code in Go:

```go
done := make(chan struct{})

go func() { <-done; fmt.Println("A done") }()
go func() { <-done; fmt.Println("B done") }()
go func() { <-done; fmt.Println("C done") }()

time.Sleep(100 * time.Millisecond)
close(done) // wakes all three at once
time.Sleep(100 * time.Millisecond)
```

All three receivers unblock simultaneously. They each see the zero value and `ok=false`. The channel is now permanently in the "closed" state — any future receive on `done` returns immediately. This is **the** Go idiom for "tell everyone to stop." It is cheap, race-free, and re-entrant safe (a receiver may be inside `<-done` already; the close still wakes it).

`chan struct{}` is the conventional type because:

- The value carries no information; only the *event* of closing matters.
- `struct{}` takes zero bytes.
- You cannot accidentally send a value (sending on a closed channel panics, but `struct{}` makes "send" syntactically obvious).

The rule: **`close` is for signals, not for values.** Use it when "every subscriber should know that *something happened*", not when subscribers need different data.

### Broadcasting different *values* needs a hub

The close trick only carries one bit ("did the event happen yet"). For real broadcast, where each event carries a payload, you need a goroutine to do the work:

```go
type Hub struct {
    publish chan string
    subs    []chan string
}

func (h *Hub) Run() {
    for msg := range h.publish {
        for _, s := range h.subs {
            s <- msg
        }
    }
}
```

The hub receives one event and sends it to each subscriber's channel. The list `subs` is owned by the hub goroutine — no one else writes to it — so we do not need a mutex. This is the simplest broadcast hub. We will expand it through this file.

### `sync.Cond.Broadcast` is the lock-world equivalent

Channels are not the only broadcast primitive. The `sync.Cond` type wraps a mutex and offers `Wait`, `Signal`, and `Broadcast`:

```go
var (
    mu   sync.Mutex
    cond = sync.NewCond(&mu)
    ready bool
)

// Many waiters
go func() {
    mu.Lock()
    for !ready { cond.Wait() }
    mu.Unlock()
    fmt.Println("go!")
}()

// One announcer
mu.Lock()
ready = true
cond.Broadcast()
mu.Unlock()
```

`Broadcast()` wakes every goroutine currently inside `cond.Wait()`. The waiters re-check the predicate (`!ready`) and either continue waiting or exit the loop. We list this here for completeness; for most Go code, closing a channel is simpler. Use `Cond` when the predicate is a complex piece of shared state guarded by a mutex you already have.

---

## Real-World Analogies

- **Radio station.** One transmitter, thousands of receivers. Each receiver tuned to the right frequency hears the broadcast. The station does not need to know who is listening.
- **Loudspeaker in a stadium.** Everyone in the stadium hears the announcement. Some may be sleeping (slow subscribers) and miss it; the announcement is not repeated.
- **A teacher saying "everyone, stop writing."** One signal, the whole class reacts. This is the `close(done)` pattern.
- **Email mailing list.** Subscribers join, the publisher sends one email, the server fans it out to N inboxes. The "hub" is the mail server.
- **WebSocket chat room.** Every user in the room receives every chat message. Each user is a subscriber; the room is the hub.

These analogies share two properties: one source, many sinks, and the source does not block waiting for any individual sink to acknowledge.

---

## Mental Models

### "Channel = one note slipped under one door"

A normal channel send is like slipping a note under one door. Only the person behind that door reads it. To reach N people you must write N notes (or build a different system).

### "Close = pulling the fire alarm"

`close(done)` does not deliver content. It changes the *state* of the building. Everyone inside the building, present and future, knows the alarm is on. Nothing is queued; nothing is retried.

### "Hub = a postman with a route"

The hub is a single thread of control with a list of mailboxes. It walks the route, drops one copy in each mailbox, returns to the start. If one mailbox is full and the postman waits there, the rest of the route is blocked. That is the slow-subscriber problem.

### "Cond = a room where waiters check a chalkboard"

Many goroutines wait inside a room (Cond.Wait). Someone walks in and writes a number on the chalkboard, then says "look up" (`Broadcast`). Each waiter looks up, checks the number, and decides whether to leave or keep waiting.

---

## Pros & Cons

### Pros
- **One source of truth.** The publisher writes once; the hub multiplies.
- **Decoupled.** Publisher does not know how many subscribers exist or who they are.
- **Idiomatic for shutdown.** `close(done)` is the cleanest way to fan-out a stop signal.
- **Composable.** The hub itself is a goroutine; you can layer hubs (e.g., per-topic hubs feeding a global hub).
- **Race-free, by construction.** A single hub goroutine owns the subscriber list.

### Cons
- **N-fan-out cost.** Each event is copied to N subscribers. For high N or large payloads, that is real CPU and memory.
- **Slow subscriber blocks the hub.** Without mitigation, one paused consumer can stall the whole system.
- **No persistence by default.** A subscriber that joins after a broadcast does not see past events.
- **Unbounded subscriber lists** lead to memory growth if `Unsubscribe` is forgotten.
- **Ordering across subscribers** can drift if you use per-subscriber goroutines for delivery.

---

## Use Cases

- **Shutdown coordination.** `close(ctx.Done())` — used by every production Go service.
- **Configuration push.** A central config manager publishes new config; every consumer goroutine receives it.
- **Real-time fan-out.** WebSocket / Server-Sent-Events / gRPC streaming servers broadcast updates to all connected clients.
- **Cache invalidation.** One service tells every replica "key K is now stale."
- **Leader election notifications.** Tell every node "you are no longer leader."
- **Event sourcing read models.** A single write log is broadcast to multiple projector goroutines.
- **Game servers.** State diffs broadcast to every player in a room.

If your problem has the shape "one source, every-sink-must-react", broadcast is the right pattern.

---

## Code Examples

### Example 1 — Close-to-broadcast shutdown

The shortest broadcast in Go.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func worker(id int, done <-chan struct{}, wg *sync.WaitGroup) {
    defer wg.Done()
    ticker := time.NewTicker(100 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-done:
            fmt.Printf("worker %d stopping\n", id)
            return
        case t := <-ticker.C:
            fmt.Printf("worker %d tick %v\n", id, t.Unix())
        }
    }
}

func main() {
    done := make(chan struct{})
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go worker(i, done, &wg)
    }
    time.Sleep(350 * time.Millisecond)
    close(done) // broadcast stop to all three workers
    wg.Wait()
    fmt.Println("all done")
}
```

The `close(done)` reaches all three workers in a single act. Each worker sees `<-done` succeed (returning the zero value), notices via its `select` that it should exit, and returns.

### Example 2 — A minimal broadcast hub

This is the "one channel in, list of channels out" hub. No unsubscribe yet, no buffering — just the shape.

```go
package main

import (
    "fmt"
    "time"
)

type Hub struct {
    publish chan string
    subs    []chan string
}

func NewHub() *Hub {
    return &Hub{publish: make(chan string)}
}

// Subscribe must be called before Run starts (junior-level constraint).
// Middle level will fix the race.
func (h *Hub) Subscribe() <-chan string {
    s := make(chan string, 4) // small buffer, see slow-subscriber section
    h.subs = append(h.subs, s)
    return s
}

func (h *Hub) Run() {
    for msg := range h.publish {
        for _, s := range h.subs {
            s <- msg
        }
    }
    // publisher closed; close every subscriber so they can exit
    for _, s := range h.subs {
        close(s)
    }
}

func (h *Hub) Publish(msg string) { h.publish <- msg }
func (h *Hub) Close()             { close(h.publish) }

func main() {
    h := NewHub()
    a := h.Subscribe()
    b := h.Subscribe()

    go func() {
        for msg := range a {
            fmt.Println("A got", msg)
        }
    }()
    go func() {
        for msg := range b {
            fmt.Println("B got", msg)
        }
    }()

    go h.Run()
    h.Publish("hello")
    h.Publish("world")

    time.Sleep(100 * time.Millisecond)
    h.Close()
    time.Sleep(100 * time.Millisecond)
}
```

Both `A` and `B` see both messages, in order. The hub goroutine owns the `subs` slice; no other goroutine touches it, so no mutex is needed. The middle-level material will add dynamic subscribe/unsubscribe — and the synchronisation that requires.

### Example 3 — Multiple `done` channels

Sometimes you need composite signals. A worker should exit either on a global shutdown *or* on a per-task cancellation. Multiple closes can be combined in one `select`:

```go
func worker(globalDone, taskDone <-chan struct{}) {
    for {
        select {
        case <-globalDone:
            return
        case <-taskDone:
            return
        case <-time.After(time.Second):
            // do work
        }
    }
}
```

Closing either channel wakes the worker. This composes cleanly because each `<-channel` in a `select` is independent.

### Example 4 — Broadcasting with `sync.Cond`

For comparison, the same "wake everyone" idea using a condition variable:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Gate struct {
    mu   sync.Mutex
    cond *sync.Cond
    open bool
}

func NewGate() *Gate {
    g := &Gate{}
    g.cond = sync.NewCond(&g.mu)
    return g
}

func (g *Gate) Wait() {
    g.mu.Lock()
    defer g.mu.Unlock()
    for !g.open {
        g.cond.Wait()
    }
}

func (g *Gate) Open() {
    g.mu.Lock()
    g.open = true
    g.mu.Unlock()
    g.cond.Broadcast()
}

func main() {
    g := NewGate()
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            g.Wait()
            fmt.Println("worker", id, "started")
        }(i)
    }
    time.Sleep(100 * time.Millisecond)
    g.Open()
    wg.Wait()
}
```

`g.Open()` calls `Broadcast()`, waking all waiters at once. The waiters re-check `!g.open` before deciding to proceed. The channel version (`close(open)`) is shorter, but `Cond` is the right tool when the predicate is a piece of shared state that other code already locks.

---

## Coding Patterns

### Pattern: `done` channel by convention

A canonical pattern:

```go
type Service struct {
    done chan struct{}
}

func NewService() *Service { return &Service{done: make(chan struct{})} }

func (s *Service) Stop() { close(s.done) }

func (s *Service) Run() {
    for {
        select {
        case <-s.done:
            return
        case <-time.After(time.Second):
            // periodic work
        }
    }
}
```

`Stop()` is idempotent on the *intent* — but **not on the call**. Calling `close(s.done)` twice panics. Defensive code uses `sync.Once`:

```go
var stopOnce sync.Once

func (s *Service) Stop() {
    stopOnce.Do(func() { close(s.done) })
}
```

### Pattern: hub with `select`-based publish

A safer publish that exits on shutdown:

```go
func (h *Hub) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case msg := <-h.publish:
            for _, s := range h.subs {
                select {
                case s <- msg:
                case <-ctx.Done():
                    return
                }
            }
        }
    }
}
```

The inner `select` ensures the hub does not block forever on a stuck subscriber once the context is cancelled. We will refine the slow-subscriber handling at the middle level.

### Pattern: subscriber loop with `done`

A subscriber that respects both a personal shutdown and the hub-closing-the-channel signal:

```go
func subscriber(events <-chan Event, done <-chan struct{}) {
    for {
        select {
        case <-done:
            return
        case e, ok := <-events:
            if !ok {
                return // hub closed our channel
            }
            handle(e)
        }
    }
}
```

Two ways to exit: own done, or hub-closed channel. Both are normal.

---

## Clean Code

- Name `done` channels `done` or `stop`, not `quit2`. Type them `chan struct{}`.
- Keep the broadcast plumbing (channels, goroutines) inside a struct; expose `Subscribe`, `Publish`, `Close` methods. Do not let callers manipulate channels directly.
- Document who closes which channel. The default rule: **only the hub closes subscriber channels, never the subscriber.** This avoids "send on closed channel" panics.
- Use receive-only channels in API signatures (`<-chan T`) so subscribers cannot accidentally send.
- Use one struct per hub. Resist the temptation to share a global hub; it tangles ownership.

---

## Product Use / Feature

Concrete features you might build:

- **Live notifications.** When user X posts a comment, broadcast `comment-created` to every connected client viewing that thread.
- **Real-time dashboard.** A metrics service publishes per-second snapshots; every dashboard tab is a subscriber.
- **Multi-tab session sync.** A user logs out in one tab; broadcast `logout` to every other tab connected to the same session.
- **Hot-reload config.** A controller watches a config file. On change, it pushes the new config to every service goroutine.
- **Game lobby announcements.** "Game starting in 10 seconds" broadcast to every player.

The broadcast pattern is the backbone of any feature that has the words "everyone" or "all connected".

---

## Error Handling

Broadcast operations themselves rarely fail — the channels never return errors. Errors live at the edges:

- **The publisher** may need to react when the hub is full (mitigated by buffering or drop-on-overflow).
- **A subscriber's handler** may panic; wrap in `defer recover()` per subscriber so one broken consumer does not bring down the hub.
- **The hub's run loop** should accept a context; on context cancel it returns and closes all subscriber channels.

A useful idiom: the hub returns *no* error from `Publish` if it is reliable; a *bool* if it can drop:

```go
// PublishOrDrop returns false if the hub is at capacity and the message
// was discarded.
func (h *Hub) PublishOrDrop(msg string) bool {
    select {
    case h.publish <- msg:
        return true
    default:
        return false
    }
}
```

That makes the dropping behaviour explicit at the call site.

---

## Security Considerations

- **Subscriber isolation.** Do not broadcast secret data to subscribers that should not see it. Use per-topic hubs and authenticate before subscribing.
- **Subscriber starvation.** A malicious subscriber that never reads can starve the hub if you do not have drop-on-overflow. In an untrusted environment, never let a third party hold a subscriber channel without an enforced rate.
- **Resource exhaustion.** If `Subscribe` is exposed over a network (e.g., WebSocket clients each become subscribers), bound the number of subscribers. Otherwise an attacker can open thousands and exhaust memory.
- **Message-size cap.** Broadcasting a 10 MB payload to 10,000 subscribers is 100 GB of work. Bound payload size at the API.
- **Information leakage on close.** When the hub closes, every subscriber sees `ok=false`. That itself is a signal an attacker may correlate with other events; for sensitive systems, do not couple close-events to user-visible behaviour.

---

## Performance Tips

- **Use small buffered subscriber channels** (4-64 slots). Unbuffered subscribers cause the hub to wait synchronously on each one.
- **Use `chan struct{}` for pure signals.** Zero bytes per send.
- **Avoid copying large structs.** Send pointers if the payload is large, but freeze the pointed-to data (no mutations after send).
- **Cache the subscriber list** in the hub goroutine. Do not re-scan a map on every publish if a slice will do.
- **Avoid `Cond` for high-throughput broadcast.** Channels are usually faster and let you use `select`.
- **Profile.** If broadcast is your bottleneck, the senior file covers sharded hubs and lock-free designs.

---

## Best Practices

1. **Document the close policy.** Who closes what? Always the hub for subscriber channels.
2. **Always offer an unsubscribe.** Even at junior level, plan for it — leaked subscribers are a memory leak.
3. **Use `chan struct{}` for signals.**
4. **Wrap the hub in a struct** with `Run(ctx)`, `Subscribe`, `Publish`, `Close`.
5. **Test with `goleak`** to catch leaked subscriber goroutines.
6. **Treat `close` as one-shot.** Use `sync.Once` if a method may be called multiple times.
7. **Bound the subscriber count.** Reject new subscribers above a cap.
8. **Bound the per-subscriber buffer.** Otherwise a slow subscriber can pin GB of memory.

---

## Edge Cases & Pitfalls

- **Subscribing after a broadcast.** The new subscriber misses everything sent before subscription. There is no replay unless you build it.
- **Concurrent subscribe and publish.** Without locks or a single owning goroutine, this races. The junior-level hub avoids the issue by requiring all subscriptions before `Run()`; middle level adds proper synchronisation.
- **Double-close on the same `done` channel.** Panics. Guard with `sync.Once`.
- **Sending on a closed subscriber channel.** Panics. Only the hub should close subscriber channels.
- **Reading after close.** Always returns the zero value with `ok=false`. This is normal — code for it.
- **Slow subscriber.** Blocks the hub for everyone else. The middle level fixes this.
- **Hub goroutine itself leaks.** If `publish` is never closed and `Run()` has no context, it runs forever.
- **N too high.** Broadcasting to 100k subscribers from one goroutine takes time proportional to N per event.

---

## Common Mistakes

- **Trying to "broadcast" by sending in a loop on one channel.** That delivers each value to a different receiver — it is fan-out, not broadcast.
- **Calling `close` twice.** Panic.
- **Letting subscribers close the shared channel they receive on.** Panic when anyone else sends.
- **Forgetting to drain a subscriber after cancellation.** The hub blocks on `s <- msg`, the subscriber returned, deadlock.
- **Using a `map[chan T]bool` as the subscriber list without a mutex.** Map writes race; use a single owning goroutine instead.
- **Buffer of 0 on subscriber channels** combined with "fire and forget" hub. Any pause in a subscriber stalls everyone.
- **Reusing a `done` channel after closing.** You cannot reopen a closed channel. Build a new one.

---

## Common Misconceptions

- **"`chan T` can be multi-receiver if I just have many receivers."** Yes, you can have many receivers, but each *value* goes to exactly one of them. That is fan-out, not broadcast.
- **"`close` sends a special value."** No. `close` changes the channel's state. Receives now return the zero value immediately, indefinitely.
- **"I can close from any goroutine."** True syntactically, but unsafe in general. The convention is the sender closes. For `done` channels, define an owner.
- **"Buffered channels are always faster."** Not for broadcast hubs. A bigger buffer hides backpressure, not eliminates it. The right buffer is small.
- **"`sync.Cond` is faster than channels."** Sometimes, but rarely worth the complexity. Default to channels.

---

## Tricky Points

- **The `select` over multiple `done` channels** lets you compose cancellations. Combine `ctx.Done()` with a per-task `done` for fine-grained control.
- **A closed channel always wins in a `select`.** If `<-done` is a case and `done` is closed, that case is always ready. Mix it with other cases at your peril if you want fairness.
- **Closing a `nil` channel panics.** Closing a non-nil but uninitialised channel does not exist — uninitialised is `nil`.
- **Receiving on a `nil` channel blocks forever.** A trick: setting a channel to `nil` inside a `select` *disables* that case. Useful in middle-level patterns.
- **`Cond.Wait()` must be called with the lock held.** It atomically releases and re-acquires. Forgetting to lock is a panic.
- **`Cond.Wait()` may return spuriously.** Always wrap it in `for !predicate`. Single `if` is wrong.

---

## Test

A junior-level test for close-to-broadcast:

```go
func TestCloseBroadcastsToAll(t *testing.T) {
    done := make(chan struct{})
    var got int32
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            <-done
            atomic.AddInt32(&got, 1)
        }()
    }
    time.Sleep(10 * time.Millisecond)
    close(done)
    wg.Wait()
    if atomic.LoadInt32(&got) != 5 {
        t.Fatalf("expected 5, got %d", got)
    }
}
```

For the hub:

```go
func TestHubDeliversToAllSubscribers(t *testing.T) {
    h := NewHub()
    a := h.Subscribe()
    b := h.Subscribe()
    go h.Run()

    h.Publish("x")
    if v := <-a; v != "x" {
        t.Fatalf("A: %q", v)
    }
    if v := <-b; v != "x" {
        t.Fatalf("B: %q", v)
    }
}
```

Add `goleak` checks to make sure no goroutine outlives the test.

---

## Tricky Questions

**Q1.** What happens if you `close` a channel and then read from it three times?
> The three reads each return immediately, each returning the zero value of the channel's element type with `ok = false`. Close is "sticky": the channel stays closed forever.

**Q2.** Why do we use `chan struct{}` for `done`?
> Because the signal carries no information; the *event* of closing is the entire content. `struct{}` is zero bytes, so the channel and its values cost almost nothing.

**Q3.** Can a publisher send the same message to two channels by writing it twice?
> Yes, that delivers the same value to two specific receivers. It is *unicast twice*, not broadcast. The publisher must know the channels in advance, must not block on a slow receiver, and must update the loop whenever subscribers change.

**Q4.** Why does the junior-level hub require all subscriptions before `Run()`?
> Because `Subscribe` mutates `h.subs` (the slice) and `Run` reads from it. Without a mutex or a serialising goroutine, concurrent `Subscribe` and broadcast would race. Middle level adds proper synchronisation.

**Q5.** What is the cheapest "wake up everyone" primitive in Go?
> `close(c)` for a `chan struct{}`. No allocation, single atomic state change, every receiver wakes in O(1) wall time (amortised).

**Q6.** When should you reach for `sync.Cond.Broadcast` instead of `close`?
> When the predicate is a piece of shared state guarded by a mutex (e.g., "queue is non-empty"), and waiters need to re-check it after waking. Channels alone cannot express "wake and re-check shared mutable state" cleanly.

---

## Cheat Sheet

```go
// Close-to-broadcast (one-shot signal)
done := make(chan struct{})
// ...
close(done) // every <-done wakes immediately

// One-shot guard
var once sync.Once
stop := func() { once.Do(func() { close(done) }) }

// Minimal broadcast hub
type Hub struct {
    publish chan string
    subs    []chan string
}
func (h *Hub) Run() {
    for msg := range h.publish {
        for _, s := range h.subs { s <- msg }
    }
    for _, s := range h.subs { close(s) }
}

// sync.Cond broadcast
mu.Lock()
ready = true
mu.Unlock()
cond.Broadcast()
```

| Need | Tool |
|------|------|
| One-shot stop signal | `close(done)` |
| Many copies of one event | hub goroutine |
| Wake all on a predicate | `sync.Cond.Broadcast` |
| Don't repeat-close | `sync.Once` |

---

## Self-Assessment Checklist

- [ ] I can explain why `c <- v` on a single channel reaches only one receiver.
- [ ] I can write a `done` channel, close it from another goroutine, and have multiple workers exit cleanly.
- [ ] I know to use `sync.Once` around `close(done)` if `Stop` may be called twice.
- [ ] I have built a hub goroutine that forwards a message to a list of subscriber channels.
- [ ] I know what happens when a subscriber's channel is full and the hub tries to send (blocks).
- [ ] I know what `sync.Cond.Broadcast` does and when I would use it.
- [ ] I can read a closed channel and recognise the `(zero, false)` return.
- [ ] I can write a test that confirms a `close` wakes all expected receivers.

---

## Summary

Broadcast in Go is unusual because the language's primary tool (channels) is point-to-point. You have three idioms:

1. **`close(c)`** — the cheapest, most idiomatic signal. Use for shutdown, ready, "go time."
2. **Hub goroutine** — for delivering different payloads to all subscribers. Owns the subscriber list; no mutex needed in the simple case.
3. **`sync.Cond.Broadcast`** — wakes all waiters on a condition variable. Use when you already have a mutex-guarded predicate.

The slow-subscriber problem (one stuck consumer blocking everyone) is the central design issue once you move beyond toy examples. Buffered subscriber channels and drop-on-overflow are the two main mitigations, and you will meet them in detail at the middle and senior levels.

---

## What You Can Build

- A simple chat server with one room (every connected user is a subscriber).
- A graceful-shutdown wrapper around any goroutine pool, using `close(ctx.Done())` semantics.
- A configuration reloader that pushes new config to every component.
- A tiny key-value cache that broadcasts invalidations to all replicas in-process.
- A "wake all goroutines" gate that releases workers when initialisation finishes.
- A minimal pub/sub library to learn from (then read middle.md to harden it).

---

## Further Reading

- The Go Memory Model — chapter on channel synchronisation (`go.dev/ref/mem`).
- `sync` package documentation, especially `sync.Cond` and `sync.Once`.
- Effective Go — section on channels and `select`.
- Rob Pike's talk "Go Concurrency Patterns" (2012) — covers fan-out, fan-in, and broadcast.
- `golang.org/x/sync/errgroup` source — uses close-to-broadcast internally.
- `nats.go` — Go client for NATS, a production pub/sub system.

---

## Related Topics

- **`sync.Cond`** — condition variables, the lock-world cousin of channel broadcast.
- **`context`** — `ctx.Done()` is a close-to-broadcast channel exposed by every modern Go API.
- **Fan-out** — different topology; each item goes to one worker.
- **Fan-in** — opposite of fan-out; many producers, one consumer.
- **Pipeline** — stages chained sequentially; broadcast may sit between stages.
- **Observer pattern** — broadcast is the concurrent version of GoF's Observer.

---

## Diagrams & Visual Aids

### Close-to-broadcast

```
                         close(done)
                              |
       +----------------------+----------------------+
       v                      v                      v
   worker A               worker B               worker C
   <-done unblocks       <-done unblocks       <-done unblocks
   return                return                return
```

### Hub fan-out

```
   publisher --publish--> [ hub goroutine ] --+-- sub A
                                              +-- sub B
                                              +-- sub C
                                              +-- sub D
```

### Slow-subscriber stall

```
   publisher --> [hub] --+-- sub A (reading)
                         +-- sub B (reading)
                         +-- sub C (PAUSED) <-- hub blocks here,
                                                  A, B starve
                         +-- sub D (waiting)
```

### sync.Cond.Broadcast

```
   waiters in cond.Wait():     +-- W1 (waiting)
                               +-- W2 (waiting)
                               +-- W3 (waiting)

   producer:                   cond.Broadcast()

   waiters re-check predicate: +-- W1 (re-checks, proceeds)
                               +-- W2 (re-checks, proceeds)
                               +-- W3 (re-checks, proceeds)
```

These four pictures cover the whole junior mental model.
