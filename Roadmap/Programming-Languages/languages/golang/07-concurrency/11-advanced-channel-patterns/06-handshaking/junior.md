---
layout: default
title: Handshaking — Junior
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/junior/
---

# Handshaking — Junior

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Error Handling](#error-handling)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Self-Assessment Checklist](#self-assessment-checklist)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: "I started a goroutine — how do I know when it's actually running? I want to tell it to stop and then wait for it. How do I get an answer back from it?"

A **handshake** in Go is a channel-based agreement between two goroutines. Where a normal send delivers data, a handshake delivers *synchronisation*: "I am ready," "you may proceed," "I have finished." Both sides participate; both sides must reach their step before either advances.

The simplest handshake is the **started channel**. Your goroutine needs a moment to initialise — connect to a database, bind a port, build a cache — before the rest of the program can use it. Without a handshake the main function races the goroutine: sometimes the main function wins and crashes because the cache is nil; sometimes the goroutine wins and the test passes. Flaky tests are almost always missing handshakes.

By the end of this page you will be able to:

- Recognise a handshake in code by spotting the paired send-and-receive on a channel used only for signalling.
- Write a `started` channel that lets a parent block until a child has finished setup.
- Write a `stop`/`stopped` pair to shut a goroutine down and wait for it to confirm.
- Use a `reply` channel embedded in a request struct to get an answer back from a worker.
- Use `chan struct{}` correctly and explain why it is preferable to `chan bool` for signals.

What you do not need to know yet: `chan chan T`, supervisor trees, leader election, performance tuning. Those land in middle and senior.

---

## Prerequisites

- **Required:** Comfort with channels — making, sending, receiving, closing.
- **Required:** You can write a goroutine and you understand that `go f()` returns immediately while `f` runs in parallel.
- **Required:** You know what `chan struct{}` is and that `struct{}` has size zero.
- **Helpful:** Some exposure to `context.Context` and `<-ctx.Done()`.
- **Helpful:** You have read or skimmed Effective Go's concurrency section.

If you have ever written `time.Sleep(100 * time.Millisecond)` in a test and called it "wait for the server to start", you are in the right place.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Handshake** | A coordinated channel exchange where each side waits for the other to reach a synchronisation point. |
| **Started channel** | A one-shot channel a child goroutine closes once initialisation is complete. The parent receives from it to wait. |
| **Stop channel** | A one-shot channel the parent closes to ask the child to terminate. The child watches it in a `select`. |
| **Stopped channel** | A one-shot channel the child closes when it has finished cleanup. The parent receives from it to confirm. |
| **Reply channel** | A channel embedded in a request value so the receiver can send a result back to the sender. |
| **One-shot channel** | A channel used only to deliver an event by being closed; usually `chan struct{}`. |
| **Close-as-broadcast** | The property of `close(c)` that unblocks every current and future receiver simultaneously. |
| **Rendezvous** | A synchronous handoff on an unbuffered channel — sender blocks until receiver is ready, and vice versa. |
| **Backpressure** | The pattern where downstream consumers slow producers by withholding their acknowledgement. |
| **`chan struct{}`** | The conventional Go signalling channel: zero-size element, used only for events. |
| **Idempotent close** | A close guarded by `sync.Once` so it is safe to call from multiple sites. |

---

## Core Concepts

### A signal is one-way. A handshake is two-way.

You have probably already written a one-way signal: close a `done` channel, every goroutine watching it exits. That is broadcast, not handshake — the closer keeps going regardless of whether the watchers act.

A handshake adds the **return leg**:

- "I am ready" — child to parent.
- "Please stop" + "I have stopped" — parent to child, then child to parent.
- "Here is a request" + "here is the answer" — caller to worker, then worker to caller.

The pattern is: one channel for the request, one channel for the acknowledgement. The second channel is what makes it a handshake.

### Use `chan struct{}` for signals

```go
done := make(chan struct{})
// to signal:
close(done)
// to wait:
<-done
```

`struct{}` has size zero, so the channel carries no payload — only the event of receiving (or being closed). Some codebases use `chan bool`; this works but signals to a reader that a *value* is being communicated when really only the event is.

### Close is broadcast; send is unicast

```go
// broadcast: every receiver unblocks
close(done)

// unicast: exactly one receiver unblocks
done <- struct{}{}
```

If you want every watcher to wake up, *close* the channel. If you want exactly one consumer to take an event, *send*. Mixing these up is one of the most common handshake bugs.

### Close is one-shot

You can close a channel only once. A second `close` panics. So:

- Either have exactly one goroutine that owns the close.
- Or guard the close with `sync.Once`.

### Receive on a closed channel returns immediately

After `close(c)`:

- `<-c` returns the zero value of the channel's element type, immediately, every time.
- `v, ok := <-c` returns `(zero, false)`.

This is what makes close-as-broadcast work: any number of receivers, now or in the future, will see the close as a non-blocking zero-value receive.

---

## Real-World Analogies

- **The waiter and the kitchen.** You order; the waiter writes it down (request). You wait; the kitchen cooks. The waiter brings the dish (reply). Until the dish lands on your table, you cannot eat. The handshake is "order placed, food delivered."

- **Phone calls.** You dial; the other party picks up. Until both have picked up, no conversation can begin. A rendezvous on an unbuffered channel is exactly this — neither side proceeds until both are connected.

- **Boarding an aeroplane.** The pilot tells the cabin crew "doors to manual"; the crew confirms "doors armed, cross-checked." The captain does not push back from the gate until the crew's reply arrives. Without the acknowledgement, the captain has no proof the door is safe.

- **A factory shift change.** The outgoing shift hands the key to the incoming shift; the incoming shift signs the log. Until that signature lands, the outgoing shift cannot leave. The "stopped" half of the stop/stopped pair is the signature.

---

## Mental Models

### Picture two clocks

Imagine each goroutine as a clock ticking independently. Channels are the only way to compare the two clocks. A handshake is a moment where you stop both clocks at the same hour: the sender blocks until the receiver is ready; the receiver blocks until the sender arrives. After the moment, the clocks resume.

### The promise and the receipt

A handshake is a promise plus a receipt. The promise is "I will deliver" (send). The receipt is "I have received" (acknowledge). One without the other is unfinished business — and unfinished business in concurrent code is a leak or a race.

### Channels as control, not data

Junior Go programmers think of channels as data carriers. Mid-level Go programmers learn that channels are also *control* carriers — they exist to communicate "you may proceed", not just "here is the next integer." Handshakes are the canonical control-channel pattern.

---

## Pros & Cons

### Pros

- **Deterministic startup ordering.** You can write tests that don't depend on `time.Sleep`.
- **Provable shutdown.** When the parent's `<-stopped` returns, the goroutine is verifiably done.
- **Backpressure for free.** A worker that doesn't acknowledge stops the producer naturally.
- **Composable with `select`.** Handshakes integrate with timeouts and cancellation contexts.
- **No mutex.** The synchronisation point is the channel op itself.

### Cons

- **Boilerplate.** A goroutine with started, stopped, and per-request reply channels has more wiring than a simple `go f()`.
- **Easy to deadlock.** Forgetting to close `started` or forgetting to read `stopped` causes hangs.
- **Channel-of-channels is harder to read.** `chan chan T` confuses people who have not seen it.
- **Per-request allocation.** A new reply channel per call is a heap allocation; in hot paths this adds up.

For 95% of code the trade is worth it. The remaining 5% is what later levels of this section cover.

---

## Use Cases

### Wait for a server to bind its port

```go
ready := make(chan string, 1)
go func() {
    ln, _ := net.Listen("tcp", ":0")
    ready <- ln.Addr().String()
    http.Serve(ln, handler)
}()
addr := <-ready
http.Get("http://" + addr + "/ping")
```

The test sends its first request only after the server has provably bound a port.

### Graceful shutdown of a background goroutine

```go
stop := make(chan struct{})
stopped := make(chan struct{})
go func() {
    defer close(stopped)
    for {
        select {
        case <-stop:
            return
        case <-time.After(time.Second):
            doWork()
        }
    }
}()
// later:
close(stop)
<-stopped
```

The parent can flush a final state, knowing the goroutine has returned.

### Request/reply to a state-owning goroutine

```go
type Op struct {
    Key   string
    Reply chan string
}
ops := make(chan Op)
go func() {
    cache := map[string]string{}
    for op := range ops {
        op.Reply <- cache[op.Key]
    }
}()

reply := make(chan string, 1)
ops <- Op{Key: "name", Reply: reply}
fmt.Println(<-reply)
```

One goroutine owns the map; everyone else talks to it through requests with embedded reply channels.

---

## Code Examples

### Example 1: The started channel

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    started := make(chan struct{})
    go func() {
        // Imagine connecting to a DB, warming a cache, etc.
        time.Sleep(50 * time.Millisecond)
        close(started)
        // ... continue running ...
    }()

    fmt.Println("waiting for worker to start...")
    <-started
    fmt.Println("worker ready, proceeding")
}
```

The main goroutine blocks on `<-started` until the child closes it. After that line, you have a happens-before guarantee that everything the child did before `close(started)` is visible to the parent.

### Example 2: Stop and stopped

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    stop := make(chan struct{})
    stopped := make(chan struct{})

    go func() {
        defer close(stopped)
        t := time.NewTicker(100 * time.Millisecond)
        defer t.Stop()
        for {
            select {
            case <-stop:
                fmt.Println("worker stopping...")
                time.Sleep(50 * time.Millisecond) // cleanup
                return
            case <-t.C:
                fmt.Println("tick")
            }
        }
    }()

    time.Sleep(350 * time.Millisecond)
    close(stop)
    <-stopped
    fmt.Println("worker confirmed stopped, exiting")
}
```

After the `<-stopped` line, the goroutine has provably returned. The cleanup ran. There is no race between the `fmt.Println("worker confirmed stopped, exiting")` and the goroutine's exit.

### Example 3: Reply channel embedded in a request struct

```go
package main

import "fmt"

type Request struct {
    Input int
    Reply chan int
}

func worker(in <-chan Request) {
    for r := range in {
        r.Reply <- r.Input * 2
    }
}

func main() {
    in := make(chan Request)
    go worker(in)

    for i := 1; i <= 3; i++ {
        reply := make(chan int, 1)
        in <- Request{Input: i, Reply: reply}
        fmt.Println(i, "->", <-reply)
    }

    close(in)
}
```

Each request carries its own reply channel. The worker doesn't need to know how many callers there are; each caller reads from the specific channel it owns.

### Example 4: A request with timeout

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Request struct {
    Input int
    Reply chan int
}

func slowWorker(in <-chan Request) {
    for r := range in {
        time.Sleep(200 * time.Millisecond)
        r.Reply <- r.Input * 2
    }
}

func ask(ctx context.Context, in chan<- Request, x int) (int, error) {
    reply := make(chan int, 1) // buffered: worker won't block on abandoned reply
    in <- Request{Input: x, Reply: reply}
    select {
    case v := <-reply:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}

func main() {
    in := make(chan Request)
    go slowWorker(in)

    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()

    v, err := ask(ctx, in, 5)
    fmt.Println(v, err) // 0 context deadline exceeded
}
```

Two important details: the reply channel is **buffered with capacity 1** so the worker's send never blocks even after the client gives up; and the client `select`s on the reply channel and `ctx.Done()` so a timeout is observable.

### Example 5: A simple rendezvous

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    handoff := make(chan string)

    go func() {
        time.Sleep(100 * time.Millisecond)
        fmt.Println("receiver: ready")
        v := <-handoff
        fmt.Println("receiver: got", v)
    }()

    fmt.Println("sender: about to send")
    handoff <- "hello"
    fmt.Println("sender: sent")
}
```

Output is fixed:

```
sender: about to send
receiver: ready
receiver: got hello
sender: sent
```

The sender does *not* print "sent" until the receiver has provably read. On an unbuffered channel, send blocks until receive completes — that is the rendezvous.

---

## Coding Patterns

### Pattern: Allocate channels in the caller, not the worker

```go
// good
started := make(chan struct{})
go worker(started)

// bad: caller cannot receive from a channel that doesn't exist yet
go func() {
    started := make(chan struct{})
    // caller has no way to get this
}()
```

The caller owns the channel because the caller is the one that waits on it.

### Pattern: Defer the close to guarantee it runs

```go
go func() {
    defer close(stopped) // even on panic
    // ...
}()
```

A `defer close(stopped)` at the top of the goroutine guarantees the parent's `<-stopped` unblocks no matter how the goroutine exits — even via panic.

### Pattern: One owner per channel

The owner is whoever calls `close`. Document this:

```go
// stop is closed by Service.Stop(); never close from inside Run.
stop chan struct{}
```

If two goroutines might both want to close, guard with `sync.Once`:

```go
var once sync.Once
func (s *Service) Stop() {
    s.once.Do(func() { close(s.stop) })
}
```

### Pattern: Always pair `stop` with `stopped`

```go
type Worker struct {
    stop, stopped chan struct{}
}

func (w *Worker) Start() {
    go func() {
        defer close(w.stopped)
        for {
            select {
            case <-w.stop:
                return
            // ...
            }
        }
    }()
}

func (w *Worker) Stop() {
    close(w.stop)
    <-w.stopped
}
```

`Stop()` doesn't return until the goroutine has actually returned. This is the difference between a "shutdown request" and a "shutdown completed."

---

## Clean Code

### Name signal channels for the event, not the type

```go
// good
ready, done, stopped, drained, promoted

// bad
ch, signal, sig, flag
```

A reader sees `<-ready` and knows what just happened. `<-ch` tells them nothing.

### Group the channels in a struct

If a service has more than two channels, put them in a struct:

```go
type Service struct {
    in        chan Job
    quit      chan struct{}
    quitDone  chan struct{}
}
```

This makes it impossible to forget one of the pair.

### Document the protocol at the type level

```go
// Service runs background processing.
//
// Lifecycle:
//   1. New() returns a stopped service.
//   2. Start() launches the goroutine and returns once it has signalled ready.
//   3. Submit(j) enqueues a job (blocks if queue is full).
//   4. Stop() asks the goroutine to exit and blocks until it has.
type Service struct { ... }
```

The next reader doesn't have to reverse-engineer the handshake.

---

## Error Handling

### Surface errors through the reply channel

```go
type Result struct {
    Value int
    Err   error
}

type Request struct {
    Input int
    Reply chan Result
}
```

Don't have a separate channel for errors — pair errors with values, because the caller wants to know "did this request fail" right next to "what was the answer."

### Surface startup errors through the started channel

If startup can fail, replace `chan struct{}` with a typed channel:

```go
ready := make(chan error, 1)
go func() {
    if err := initialize(); err != nil {
        ready <- err
        return
    }
    close(ready) // success: ready returns nil
    runMainLoop()
}()
if err := <-ready; err != nil {
    log.Fatal(err)
}
```

The caller can distinguish "started ok" (zero value) from "failed to start" (non-nil error).

### Cleanup on goroutine panic

A panicking goroutine that owns the `stopped` channel must still close it, or the parent hangs:

```go
go func() {
    defer close(stopped)   // even on panic
    defer recover()        // optional: swallow panic
    // ...
}()
```

Without the `defer close`, a panic mid-loop strands the parent forever.

---

## Edge Cases & Pitfalls

### Closing a channel you don't own

If your goroutine receives from a channel but does not allocate it, do not close it. The owner closes; you just read until the close.

### Receive from a nil channel blocks forever

```go
var c chan int // nil
<-c // blocks forever
```

This is occasionally useful (disable a `case` in a `select` by nilling the channel) but more often a bug from forgetting to call `make`.

### Sending on a closed channel panics

If your protocol is "everyone signals me to start", closing the same channel from two goroutines panics. Either funnel through a single owner or use `sync.Once`.

### Buffered reply channels and stale values

If you pool reply channels with `sync.Pool`, drain the channel before returning it:

```go
select {
case <-r.Reply:
default:
}
pool.Put(r.Reply)
```

A stale value in the channel from a previous use will poison the next use.

---

## Common Mistakes

### Mistake 1: `time.Sleep` instead of started channel

```go
go startServer()
time.Sleep(100 * time.Millisecond) // hope the server is up
http.Get(...)
```

CI runs on a busy machine and the sleep isn't long enough. The test fails intermittently. Use a started channel.

### Mistake 2: Forgetting `stopped`

```go
close(stop)
// no <-stopped
fmt.Println("done") // races the goroutine
```

Without `<-stopped`, the print can happen *before* the goroutine has cleaned up.

### Mistake 3: Sending instead of closing for broadcast

```go
done <- struct{}{} // only one receiver wakes
```

Use `close(done)` for broadcast. Sending only wakes the first reader.

### Mistake 4: Unbuffered reply channel + timeout

```go
reply := make(chan int) // unbuffered
in <- Request{Reply: reply}
select {
case v := <-reply:
case <-ctx.Done():
    return ctx.Err() // worker now blocks forever
}
```

The worker's eventual `r.Reply <- ...` finds no receiver and parks. Make `reply` buffered with capacity 1.

### Mistake 5: Closing the reply channel from the worker

```go
go worker() {
    for r := range in {
        r.Reply <- result
        close(r.Reply) // unnecessary and dangerous if pooled
    }
}
```

Don't close reply channels. The client knows to read exactly once; the channel is garbage-collected with the request.

---

## Tricky Points

### Why close instead of send for "ready"?

A close *broadcasts*. If you want every watcher to know the service is up, close is the only choice. A send wakes one — fine if there is exactly one waiter, but easy to break later when a second one appears.

### Why buffer the reply channel with capacity 1?

If the client gives up, the worker still needs to send the result somewhere. With capacity 1, the worker's send always succeeds. The orphaned reply value is garbage-collected with the channel.

### Why allocate a fresh reply channel per request?

So each request gets its own answer. A shared reply channel mixes answers — caller A might read caller B's reply.

### What if I need both startup success and startup time?

Send the time across the started channel:

```go
type Ready struct {
    At  time.Time
    Err error
}
ready := make(chan Ready, 1)
ready <- Ready{At: time.Now(), Err: nil}
```

You haven't broken the pattern — the channel still carries one event — but now you have observability.

---

## Self-Assessment Checklist

You are ready to move to [Middle](middle.md) when you can:

- [ ] Write a started/stopped pair from scratch in under three minutes.
- [ ] Explain why `chan struct{}` is preferable to `chan bool`.
- [ ] Explain why a reply channel should be buffered with capacity 1.
- [ ] Tell the difference between `close(c)` (broadcast) and `c <- v` (unicast).
- [ ] Identify the owner of every channel in a code snippet.
- [ ] Convert a `time.Sleep`-based test to a started-channel-based test.

---

## Summary

A handshake is a paired channel exchange — one channel for the event, one for the acknowledgement. The three canonical forms:

1. **Started channel**: child closes when ready; parent receives to wait.
2. **Stop / stopped pair**: parent closes `stop`; child closes `stopped`; parent receives to confirm.
3. **Reply channel embedded in request**: each call carries its own private channel for the answer.

Use `chan struct{}` for pure signals. Close for broadcast, send for unicast. Always pair `stop` with `stopped`. Buffer reply channels with capacity 1. Document the channel owner.

These patterns will appear in every Go service you read for the rest of your career.

---

## Further Reading

- Pike, R. *Go Concurrency Patterns* (Google I/O 2012): https://talks.golang.org/2012/concurrency.slide
- Pike, R. *Advanced Go Concurrency Patterns* (Google I/O 2013): https://talks.golang.org/2013/advconc.slide
- Effective Go — Concurrency: https://go.dev/doc/effective_go#concurrency
- Go Memory Model: https://go.dev/ref/mem
- [Middle](middle.md) — bidirectional handshakes, `chan chan T`, rendezvous patterns.
- [Senior](senior.md) — N-way barriers, graceful shutdown, supervisor patterns.
