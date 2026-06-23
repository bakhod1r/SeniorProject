# Channels — Middle Level

> **Topic:** [Channels](README.md)
> **Focus:** select, context cancellation, idioms, MPSC/SPSC

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the junior level, a channel was a typed pipe between two goroutines or two threads. You learned how to send, how to receive, how blocking works, and how an unbuffered channel forces a rendezvous. That model is enough to write a producer-consumer pair, but as soon as a program grows past two participants the picture changes. The producer is one of many. The consumer wants to time out. A second consumer needs the same message. The program needs to shut down without leaking goroutines. The middle-level question is not "how do I move a value across a thread boundary" but "how do I compose channels into a controllable system."

This file is about that composition. The first big tool is the multi-way operation: Go's `select`, Tokio's `select!`, and the polling helpers in Crossbeam. The second big tool is the cancellation channel — historically a hand-rolled `done` channel, today a `context.Context` in Go or a `CancellationToken` in Rust. The third is the family of specialized channel flavors: single-producer single-consumer, multi-producer single-consumer, multi-producer multi-consumer, broadcast, watch, and oneshot. Each flavor exists because a different ownership rule gives a different performance and safety profile, and using the wrong flavor produces subtle bugs.

We will also revisit the classic landmines: sending on a closed channel, closing a channel twice, leaking a goroutine that is forever blocked on send, and reading from a `nil` channel forever. These are not exotic edge cases — they are the most common reason production Go services deadlock or panic. Understanding them is what separates a developer who has "used channels" from one who can design a channel-based architecture that survives load, shutdown, and partial failure.

The treatment leans on Go because Go popularized channels as a language primitive, and on Rust because Rust's library ecosystem makes the flavor distinctions explicit and visible in the type system. The patterns transfer to any language with channel-like APIs.

---

## Prerequisites

Before reading, you should be comfortable with:

- **Junior channels material** — typed pipes, send and receive, blocking semantics, buffered vs unbuffered, the rendezvous model.
- **Goroutines and `go func()`** — how a goroutine starts, how the runtime schedules it, what happens if it never returns.
- **Closures over channel variables** — how an inner function captures `ch` from the enclosing scope.
- **Basic Rust async** — `async fn`, `.await`, how a future is polled.
- **Tokio runtime basics** — `tokio::spawn`, `tokio::main`, why an async block does nothing until polled.
- **`context.Context` in Go** — how `WithCancel`, `WithTimeout`, and `Done()` work.
- **Closures, channels of channels, and higher-order channel use** — passing a channel as a value through another channel.
- **The notion of a deadlock** — both threads waiting on each other forever.

If any of these is shaky, return to the junior file for channels and the junior file for context. The middle level assumes the mechanics are automatic.

---

## Glossary

- **Select / select!** — a multi-way blocking primitive that waits on several channel operations at once and picks one that is ready.
- **Default case** — a branch of `select` taken when no other case is ready; converts a blocking operation into a non-blocking one.
- **Nil channel trick** — assigning `nil` to a channel variable inside a `select` to disable that case until conditions change.
- **Context cancellation** — propagating a "stop now" signal down a tree of goroutines via `ctx.Done()`.
- **Bounded queue** — a buffered channel of fixed capacity used to apply back-pressure on producers.
- **Owner pattern** — the rule that only the goroutine that creates and sends on a channel is allowed to close it.
- **Channel of channel** — a channel whose element type is itself a channel; used for request/response routing and back-pressure.
- **SPSC** — single-producer single-consumer; the simplest and fastest flavor.
- **MPSC** — multi-producer single-consumer; the Go default and Rust's `std::sync::mpsc`.
- **SPMC** — single-producer multi-consumer; rare in standard libraries.
- **MPMC** — multi-producer multi-consumer; what Go and Crossbeam unbounded channels provide.
- **Broadcast channel** — every receiver gets a copy of every message; Tokio's `broadcast`.
- **Watch channel** — single value that changes over time; receivers see only the latest; Tokio's `watch`.
- **Oneshot channel** — single-use channel that delivers exactly one value, then is done; Tokio's `oneshot`.
- **Goroutine leak** — a goroutine that will never return because it is blocked on a channel that will never receive or send again.
- **Done channel** — a channel of zero-size values whose closure signals "stop"; the pre-context idiom.
- **Fan-in** — multiple input channels merged into one.
- **Fan-out** — one input channel split into several worker queues.
- **Pipeline** — a chain of stages connected by channels.
- **Back-pressure** — feedback from a slow consumer that slows down the producer, achieved here by a full bounded buffer.

---

## Core Concepts

### Go `select` — Multi-Way Communication

`select` is the central piece of Go's channel toolkit. Syntactically it looks like a `switch`, but each case is a channel operation rather than a value comparison. The runtime evaluates all the channel expressions, then blocks until at least one case is ready. If several cases are ready, one is chosen at random — not in source order, not the first one declared, but pseudo-randomly. The randomness exists to prevent starvation: in a busy program where two cases are constantly ready, neither case is starved.

```go
select {
case v := <-inA:
    handle(v)
case v := <-inB:
    handle(v)
case out <- nextValue():
    // sent successfully
}
```

Three things make `select` powerful. First, mixing send and receive cases in the same statement: the goroutine can either wait for incoming work or push outgoing work, whichever happens first. Second, the **default case**, which converts the whole `select` from blocking to non-blocking. Third, the **nil channel trick**: a `case` on a `nil` channel is silently disabled, which lets you turn cases on and off dynamically.

### The Default Case

A `default` branch turns `select` into a poll. If no case is ready immediately, the default runs and the goroutine continues. This is how you implement a "try receive" or "try send":

```go
select {
case v := <-ch:
    process(v)
default:
    // nothing available, do something else
}
```

Used sparingly, default is useful for non-blocking peeks. Used in a tight loop, it becomes a busy-wait that burns CPU. The middle-level rule: a `select` with `default` inside a `for` loop with no other blocking is almost always wrong.

### The Nil Channel Trick

A send on a `nil` channel blocks forever. A receive from a `nil` channel blocks forever. Inside `select`, this becomes a feature: nil out the channel variable to disable that case until the channel is meaningful again.

```go
var in chan int = source  // active
var out chan int = nil    // disabled

for {
    select {
    case v, ok := <-in:
        if !ok {
            in = nil // disable receive permanently
            continue
        }
        buffer = append(buffer, v)
        out = sink // now we have something to send
    case out <- buffer[0]:
        buffer = buffer[1:]
        if len(buffer) == 0 {
            out = nil // nothing left to send, disable
        }
    }
}
```

This pattern lets a single goroutine multiplex between a producer and a consumer without conditional gymnastics. When the input channel is closed, you nil it out. When the buffer is empty, you nil out the send case. When both are nil, the goroutine can return.

### Context Cancellation Inside Select

Modern Go services almost never use bare goroutines. They use `context.Context` to propagate deadlines, timeouts, and explicit cancellation. The standard idiom is to include `ctx.Done()` as one of the `select` cases:

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case job := <-jobs:
        handle(job)
    }
}
```

`ctx.Done()` returns a `<-chan struct{}` that is closed when the context is cancelled. A receive from a closed channel always succeeds immediately with the zero value, so this case becomes "permanently ready" once cancellation fires. The goroutine notices, returns, and the function bubbles up the cancellation error.

This is the single most important Go idiom for clean shutdown. Every long-running goroutine should accept a context and check it in its select.

### Buffered Channels as Bounded Queues

A buffered channel of capacity N is a fixed-size FIFO queue between sender and receiver. The sender does not block until the buffer is full; the receiver does not block until the buffer is empty. This is back-pressure, built in.

Use a buffered channel when you want to:

- Smooth over bursts: producer is bursty, consumer is steady; a buffer of 100 absorbs spikes.
- Decouple latency: producer does not have to wait for the consumer to be ready on every send.
- Apply back-pressure: when the buffer fills, the producer blocks, which is exactly the signal "slow down."

Choosing the buffer size is the hard part. Too small and the producer blocks too often. Too large and you hide problems — a slow consumer might never get noticed because the buffer absorbs minutes of work. The middle-level rule of thumb: pick the smallest buffer that smooths your normal bursts. If you find yourself picking 10,000, you probably want a different design.

### The Owner Pattern

In Go, sending on a closed channel panics. Closing a channel twice panics. These rules force a discipline: **only the sender side ever closes the channel, and only one goroutine is the owner of the close**. The owner is whichever goroutine creates the channel and starts the producer. When the producer is done, the owner closes the channel. Receivers must never close.

If multiple producers send on the same channel, no single producer can close it — the close would race with the other producers' sends. The pattern is to introduce a coordinator: producers signal completion via a `sync.WaitGroup`, the coordinator waits, then closes.

### Channel of Channel for Back-Pressure Routing

A `chan chan T` is a channel whose values are themselves channels. The classic use is request/response routing: a worker receives a request, processes it, and writes the result onto a reply channel that came in with the request.

```go
type Request struct {
    Payload string
    Reply   chan string
}

requests := make(chan Request)

go func() {
    for req := range requests {
        req.Reply <- process(req.Payload)
    }
}()

reply := make(chan string, 1)
requests <- Request{Payload: "hello", Reply: reply}
fmt.Println(<-reply)
```

This pattern is the channel-based equivalent of a function call. The reply channel is usually buffered with capacity 1 so the worker never blocks if the caller times out and stops reading.

### SPSC vs MPSC vs MPMC

The producer/consumer cardinality changes what guarantees a channel can give and what it costs:

- **SPSC** — single producer, single consumer. The simplest and fastest. No locks needed; a lock-free ring buffer is enough. Used in audio drivers, hardware interrupt queues, and high-throughput pipelines.
- **MPSC** — multi-producer, single consumer. The senders contend with each other; the receiver does not contend with anyone. This is Rust's `std::sync::mpsc` and Tokio's `mpsc`. Common in actor systems where many tasks send messages to one task.
- **SPMC** — single producer, multi-consumer. Less common. Used for work-stealing queues, where the owner pushes and other threads steal.
- **MPMC** — multi-producer, multi-consumer. The general case. Both ends contend. Go's native channels are MPMC. Crossbeam's unbounded and bounded channels are MPMC.

The pattern: pick the most restrictive flavor that fits, because the more restrictions you accept, the cheaper the implementation. Rust's standard library historically only shipped MPSC because that is the most common case and the implementation is simpler than MPMC. For MPMC in Rust, reach for Crossbeam.

### Rust's Channel Landscape

`std::sync::mpsc::channel` returns an unbounded MPSC channel. `std::sync::mpsc::sync_channel(n)` returns a bounded MPSC channel with capacity n. The Sender side is `Clone` (so you can have many producers); the Receiver side is not (one consumer).

`crossbeam::channel::unbounded()` and `crossbeam::channel::bounded(n)` return MPMC channels. Both the sender and receiver halves are `Clone`. Crossbeam also provides `select!` macro that mirrors Go's `select`.

`tokio::sync::mpsc::channel(n)` returns a bounded async MPSC. `tokio::sync::broadcast::channel(n)` returns a broadcast channel where every receiver gets every message (with backlog n). `tokio::sync::watch::channel(initial)` is a single-value channel where receivers only see the latest. `tokio::sync::oneshot::channel()` returns a one-shot channel that delivers exactly one value and then is consumed.

The flavor map is part of being fluent in Rust async: pick the channel whose semantics match your problem and the type system enforces the discipline for you.

### The Done Channel Pattern

Before `context.Context` existed (Go 1.7), the standard cancellation idiom was a "done channel":

```go
done := make(chan struct{})
go worker(in, done)
// ...
close(done) // signal stop
```

The worker selects on `done` and on its input channel; when `done` closes, the select fires and the worker exits. This pattern still appears in low-level libraries (the standard library uses it internally) and in places where adding a context dependency is overkill. For new application code, prefer `context.Context`.

### WaitGroup + Channel Close as Completion Signal

When the lifetime of a producer goroutine determines when a channel should close, the pattern is:

```go
var wg sync.WaitGroup
ch := make(chan int)

for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        produce(id, ch)
    }(i)
}

go func() {
    wg.Wait()
    close(ch)
}()

for v := range ch {
    consume(v)
}
```

The closer goroutine does nothing but wait. The consumer's `range` terminates exactly when every producer has finished and the wait group goes to zero. This is the canonical fan-in close pattern.

### Range Over Closed Channel

`for v := range ch` reads values until the channel is closed and drained. This is the cleanest way to consume a stream: no explicit loop variable, no ok check, no manual break. The producer's responsibility is to close when done; the consumer's responsibility is to keep ranging.

If the producer panics or returns without closing, the consumer's range blocks forever. This is the most common goroutine leak in Go.

---

## Real-World Analogies

**Select as a person watching multiple kettles.** You have three kettles on three stoves. You sit and watch all of them. Whichever whistles first, you grab. If two whistle at the same instant, you grab one — randomly — and the other waits. The default case is "if none has whistled in this instant, check email instead."

**Nil channel as taping over a door.** Imagine a room with three doors. Each door is a channel. If you tape door B shut from the inside, no one can come or go through it, but doors A and C still work. The select is the room; nil-ing a channel is taping its door.

**Context cancellation as a fire alarm.** Every worker in the building listens for the alarm bell. When it rings, everyone drops what they are doing and leaves through the nearest exit. The alarm wire is shared. Pulling the lever closes the wire's circuit; every speaker rings simultaneously.

**Buffered channel as a mailbox.** The mailbox holds up to ten letters. The mail carrier (producer) drops letters in without ringing the bell. The resident (consumer) checks the mailbox when convenient. If the mailbox fills up, the mail carrier waits — that is back-pressure.

**Owner pattern as the kitchen sink.** Only the cook (sender) decides when the sink is closed for the night. The waiters (receivers) never close it, because if they did, the cook might still be carrying a dish over and crash into a closed valve.

**MPSC as a coffee shop counter.** Many baristas (producers) put orders on a single counter; one runner (consumer) picks them up and delivers. Many in, one out.

**Broadcast as a radio station.** One transmitter, many radios. Each radio receives every song. If a radio is off, it misses the song — broadcast does not buffer indefinitely for absent listeners.

**Watch as a clock on the wall.** It always shows the current time. If you look once an hour, you see whatever it is now; you do not see the intervening ticks.

**Oneshot as a starting pistol.** Fires once, makes one sound, then is done. The runner who hears it begins; the pistol cannot fire again.

---

## Mental Models

**Select is a polling tree, but blocking.** Picture every case in the select as a wire. The runtime examines all wires at once. If any has a value waiting, the runtime picks one and the case runs. If none has a value, the goroutine parks. When any wire becomes ready, the goroutine wakes. This is "wait on N things at once" — the OS calls it `epoll` / `kqueue` / `select`; Go gives you the same primitive at the language level.

**Cancellation is a closed channel propagating up.** `ctx.Done()` is a channel that, once closed, stays closed. Every read from it returns immediately. A `select` case on `<-ctx.Done()` is "permanently ready" once cancelled. Cancellation is not a flag check; it is a wire-level signal that integrates naturally into the select machinery.

**Buffered channel as a leaky pipe with a tank.** Picture a pipe between producer and consumer. Without a buffer, the pipe is rigid: every push immediately becomes a pull. With a buffer, the pipe has a small tank in the middle. The producer pushes into the tank; the consumer pulls from the tank. The tank smooths flow but does not increase capacity in the long run — if the consumer is permanently slower, the tank fills and the producer blocks.

**Ownership as a single-writer contract.** Imagine the channel as a tube with two ends and a single valve at the producer end. The valve is the close operation. Only the goroutine that holds the valve handle may turn it. If two hands try to turn the same valve at the same time, the program panics. The owner pattern is the rule that says: handle the valve to one goroutine and one only.

**Goroutine leak as a permanent receiver.** Every leaked goroutine corresponds to one of two situations: it is blocked on a send to a channel no one will ever read, or it is blocked on a receive from a channel that will never be closed or sent to. The leak is invisible — the program runs fine — until you check `runtime.NumGoroutine()` and watch it grow forever.

**Channel flavors as algebraic shapes.** SPSC is one input wire, one output wire — a hose. MPSC is many input wires merging into one output — a funnel. SPMC is one input branching into many outputs — a sprinkler. MPMC is the full mesh — a switchboard. Broadcast is one input fanning out, but every output gets a copy — a radio tower. Watch is a single shared variable visible to all — a billboard. Oneshot is a single bullet — a starter pistol.

---

## Code Examples

### Example 1: Three-Stage Pipeline with Context Cancellation (Go)

A classic pipeline: a generator produces integers, a transformer squares them, a sink prints them. Every stage respects context cancellation and closes its output when done.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

// Stage 1: generate integers 1, 2, 3, ...
func generate(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

// Stage 2: square each integer
func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case <-ctx.Done():
                return
            case out <- v * v:
            }
        }
    }()
    return out
}

// Stage 3: print up to N values
func sink(ctx context.Context, in <-chan int, n int) {
    count := 0
    for {
        if count >= n {
            return
        }
        select {
        case <-ctx.Done():
            return
        case v, ok := <-in:
            if !ok {
                return
            }
            fmt.Println(v)
            count++
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    nums := generate(ctx)
    squares := square(ctx, nums)
    sink(ctx, squares, 10)
}
```

Notes on this code:

- Every stage owns the channel it produces and closes it on exit.
- Every send is wrapped in a `select` with `ctx.Done()` so the goroutine never gets stuck.
- When the context fires (after 100ms or 10 prints), every stage returns. The `defer close(out)` cascades the close down the pipeline. No leaks.
- If you remove `select` from the `square` stage and just write `out <- v*v` directly, then a cancelled context cannot unblock the send if the sink already returned. Goroutine leak.

### Example 2: Tokio Broadcast for Fan-Out (Rust)

A single producer publishes events; many subscribers each receive every event. Useful for pub/sub inside a service.

```rust
use tokio::sync::broadcast;
use tokio::time::{sleep, Duration};

#[tokio::main]
async fn main() {
    // Capacity 16 — receivers can lag up to 16 messages before losing the oldest.
    let (tx, _) = broadcast::channel::<String>(16);

    // Spawn three subscribers
    for id in 0..3 {
        let mut rx = tx.subscribe();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(msg) => println!("subscriber {id}: {msg}"),
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("subscriber {id} lagged, lost {n} messages");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // Producer
    for i in 0..5 {
        let _ = tx.send(format!("event {i}"));
        sleep(Duration::from_millis(50)).await;
    }
    drop(tx); // close: every subscriber sees RecvError::Closed
    sleep(Duration::from_millis(100)).await;
}
```

Notes:

- Every `subscribe()` returns an independent receiver with its own cursor.
- If a subscriber falls behind by more than the capacity, it gets `Lagged(n)` — broadcast trades memory for lossiness.
- Dropping the last sender closes the channel; receivers see `Closed`.

### Example 3: Crossbeam MPMC Channel (Rust)

Five worker threads each pull jobs from the same channel, several producers push jobs. Bounded capacity provides back-pressure.

```rust
use crossbeam::channel::{bounded, Receiver, Sender};
use std::thread;
use std::time::Duration;

fn worker(id: usize, jobs: Receiver<u64>) {
    while let Ok(n) = jobs.recv() {
        let result = (1..=n).sum::<u64>();
        println!("worker {id} computed sum 1..={n} = {result}");
        thread::sleep(Duration::from_millis(10));
    }
    println!("worker {id} exiting");
}

fn producer(id: usize, jobs: Sender<u64>, start: u64, count: u64) {
    for i in 0..count {
        let job = start + i;
        if jobs.send(job).is_err() {
            return;
        }
        println!("producer {id} sent job {job}");
    }
}

fn main() {
    let (tx, rx) = bounded::<u64>(4);

    let workers: Vec<_> = (0..3)
        .map(|id| {
            let rx = rx.clone();
            thread::spawn(move || worker(id, rx))
        })
        .collect();

    let producers: Vec<_> = (0..2)
        .map(|id| {
            let tx = tx.clone();
            thread::spawn(move || producer(id, tx, (id as u64) * 100, 5))
        })
        .collect();

    // Drop our local sender so the channel will close when producers finish.
    drop(tx);
    drop(rx);

    for p in producers { p.join().unwrap(); }
    for w in workers { w.join().unwrap(); }
}
```

Notes:

- `bounded(4)` provides back-pressure. When the four-slot buffer fills, `send` blocks until a worker pulls.
- Both `Sender` and `Receiver` are `Clone`. Each worker thread holds its own clone of the receiver. The channel stays open as long as at least one sender is alive.
- Dropping the local `tx` and `rx` after spawning is essential — otherwise the channel never closes and workers loop forever.

### Example 4: Oneshot Request/Response (Rust)

The caller wants exactly one answer to one question. Oneshot is the right tool: it cannot be sent twice, cannot be reused, and the type system makes the contract obvious.

```rust
use tokio::sync::{mpsc, oneshot};

#[derive(Debug)]
struct Query {
    sql: String,
    reply: oneshot::Sender<Result<Vec<String>, String>>,
}

async fn database_actor(mut rx: mpsc::Receiver<Query>) {
    while let Some(q) = rx.recv().await {
        // Pretend to run the query
        let result = if q.sql.starts_with("SELECT") {
            Ok(vec![format!("row for {}", q.sql)])
        } else {
            Err("only SELECT supported".to_string())
        };
        let _ = q.reply.send(result); // ignore if caller dropped
    }
}

#[tokio::main]
async fn main() {
    let (tx, rx) = mpsc::channel::<Query>(8);
    tokio::spawn(database_actor(rx));

    let (reply_tx, reply_rx) = oneshot::channel();
    tx.send(Query {
        sql: "SELECT 1".to_string(),
        reply: reply_tx,
    }).await.unwrap();

    match reply_rx.await {
        Ok(Ok(rows)) => println!("rows: {rows:?}"),
        Ok(Err(e))   => println!("query error: {e}"),
        Err(_)       => println!("actor dropped the reply channel"),
    }
}
```

Notes:

- The reply channel travels with the request. The actor does not need to know who asked.
- `oneshot::Sender` is consumed by `send`; after that it cannot be used again. The Rust type system enforces this.
- If the actor drops the sender without sending, the caller's `await` resolves with `Err`. No deadlock.

---

## Pros & Cons

**Pros of advanced channel usage:**

- Composition: `select` lets you wait on many sources, integrating cancellation, timeouts, input, and output in one statement.
- Built-in back-pressure: bounded channels automatically slow producers when consumers fall behind.
- Type safety in Rust: flavor distinctions are encoded in the type system, preventing misuse.
- Clean shutdown: with the owner pattern and context cancellation, every goroutine has a clear exit path.
- Decoupling: producers do not know consumers and vice versa; pipelines can be reconfigured.

**Cons:**

- Easy to leak: a blocked send or receive on an orphaned channel is invisible until you measure goroutine count.
- Easy to panic in Go: close discipline is by convention, not enforced. A wrong close crashes the program.
- Performance overhead: a channel is heavier than a mutex-protected slice for very fine-grained coordination.
- Debugging is hard: a deadlock involving select on five channels is much harder to reason about than a deadlock on two mutexes.
- Flavor proliferation in Rust: choosing between mpsc, broadcast, watch, oneshot, std mpsc, crossbeam, flume, async-channel can paralyze a newcomer.

---

## Use Cases

- **Pipelines** — chained stages with bounded channels between them; classic for stream processing.
- **Fan-out worker pools** — one job channel feeds N workers; bounded capacity throttles input.
- **Fan-in aggregation** — N producers merged into one channel for a single consumer.
- **Request/response actors** — a single goroutine owns shared state; callers send requests with embedded reply channels.
- **Pub/sub inside a process** — broadcast channels for event distribution to multiple subscribers.
- **Configuration hot reload** — watch channels for "current config" visible to many consumers.
- **Cancellation propagation** — ctx.Done() in every long-running goroutine.
- **Rate limiting via tickers** — `time.Tick` returns a channel; consuming from it paces work.
- **Graceful shutdown** — close inputs, wait for pipelines to drain, then exit.

---

## Coding Patterns

### Pattern 1: Generator Function

A function returns a receive-only channel. It launches a goroutine that writes to the channel and closes it on exit. Caller ranges over the channel.

```go
func generate(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}
```

Returning `<-chan int` (receive-only) signals to the caller: "you cannot send into this, you cannot close this; just read."

### Pattern 2: Fan-In Merge

Multiple input channels merged into one. Each input gets its own goroutine that forwards to a shared output. A WaitGroup decides when to close the output.

```go
func merge(ctx context.Context, cs ...<-chan int) <-chan int {
    var wg sync.WaitGroup
    out := make(chan int)

    forward := func(c <-chan int) {
        defer wg.Done()
        for v := range c {
            select {
            case <-ctx.Done():
                return
            case out <- v:
            }
        }
    }

    wg.Add(len(cs))
    for _, c := range cs {
        go forward(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

### Pattern 3: Fan-Out Worker Pool

One job channel, N workers, one result channel. Workers loop until the job channel is closed.

```go
func runPool(ctx context.Context, jobs <-chan Job, n int) <-chan Result {
    results := make(chan Result)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for job := range jobs {
                select {
                case <-ctx.Done():
                    return
                case results <- process(job):
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(results)
    }()
    return results
}
```

### Pattern 4: Timeout Wrapper

Use `select` with `time.After` to bound the wait.

```go
select {
case v := <-ch:
    return v, nil
case <-time.After(2 * time.Second):
    return zero, errTimeout
}
```

For repeated use, prefer `context.WithTimeout` so the timeout is shared with downstream work.

### Pattern 5: Request/Reply

Embed a reply channel in the request.

```go
type Req struct {
    Input  string
    Reply  chan string
}

func ask(reqs chan<- Req, input string) string {
    reply := make(chan string, 1)
    reqs <- Req{Input: input, Reply: reply}
    return <-reply
}
```

The reply channel has capacity 1 so the worker never blocks if the caller times out and abandons the reply.

---

## Clean Code

- **Name channels by what they carry, not what they are.** `jobs`, `results`, `events`, `errors` — not `ch`, `c`, `inputChannel`.
- **Return directional channels** — `<-chan` or `chan<-` — from public APIs. Hide the bidirectional handle inside the package.
- **Document who closes the channel** in a comment on the function that returns it.
- **One responsibility per goroutine.** A goroutine should produce, consume, transform, or coordinate — not three of those.
- **Encapsulate the channel inside a struct** when the lifecycle is complex. The struct exposes `Send`, `Recv`, and `Close` methods; callers do not manipulate the channel directly.
- **Prefer `for range` over `for { select { case v, ok := <-ch: ... } }`** when there is no context to check. Less ceremony, same effect.

---

## Best Practices

- **Always include `ctx.Done()` in long-running selects.** Every loop that blocks on a channel must also respect cancellation, or it cannot be stopped.
- **The owner closes; the receiver does not.** If multiple goroutines send, introduce a coordinator that waits and closes after all senders finish.
- **Buffer when you need to decouple latency or smooth bursts; otherwise unbuffered.** Default to unbuffered.
- **Use directional channel types in function signatures.** `func consume(in <-chan T)` prevents the function from accidentally sending or closing.
- **Avoid `default` in `select` unless you have a real non-blocking use.** A `default` inside `for` is almost always a busy-loop bug.
- **Use the most specific channel flavor available.** In Rust, prefer `oneshot` for one-shot delivery, `watch` for latest-value semantics, `broadcast` for fan-out.
- **Document buffer sizes with a reason.** "Capacity 1 so the worker never blocks if the caller abandons" is much better than "100" with no comment.
- **Avoid sending pointers through channels if the sender continues to mutate.** Either send a copy or transfer ownership conceptually and stop using the pointer in the sender.
- **Drain channels on shutdown if the sender is still running.** Otherwise the sender deadlocks.

---

## Edge Cases & Pitfalls

- **Send on a closed channel panics.** No exception, no error return — runtime panic. If multiple senders share a channel, no single one can safely close it.
- **Closing a closed channel panics.** Defending with `recover` is possible but ugly. Better to design so the close happens exactly once.
- **Receive from a closed channel returns the zero value with `ok=false`.** This is by design and the foundation of `for range` and the "done channel" idiom.
- **Receive from a `nil` channel blocks forever.** Useful in the nil channel trick, dangerous if accidental.
- **Send on a `nil` channel blocks forever.** Same as above.
- **A `select` with no cases blocks forever.** Compile error in Go, actually — but `select { default: }` is legal and just runs default once.
- **`select` over a `nil` channel** is a disabled case, not an error. This is the basis of the nil channel trick.
- **A buffered channel with capacity N can hide N units of delay** before back-pressure kicks in. If the consumer dies, you may not notice until the buffer fills.
- **`time.After` allocates a new timer every iteration.** Inside a hot loop, use `time.NewTimer` and reset it, or use `time.Ticker`.
- **Tokio broadcast lagged receiver loses messages.** This is documented behavior, not a bug; if you need lossless, use a different channel.
- **Tokio watch channel always has a current value.** A new subscriber immediately receives the current value, not "no value yet."
- **`oneshot::Sender::send` is `&mut self` and consumes the sender.** You cannot send twice; the type system prevents it.
- **Crossbeam channels are not async.** They block the OS thread. Inside Tokio, use `tokio::sync` channels instead, or use `spawn_blocking`.

---

## Common Mistakes

- **Closing from the consumer side.** Consumers must never close; close discipline lives on the sender side.
- **Forgetting to close the channel** at the end of the producer. Range-based consumers block forever.
- **Double close.** Two goroutines both try to close — panic. Coordinate via WaitGroup.
- **Send-on-closed panic during shutdown.** A producer is mid-send when the channel gets closed by a racing goroutine. Solution: close from a goroutine that joins the producers first.
- **Using `default` to "poll" inside a tight loop.** Busy wait, 100% CPU. Use `select` without default and let it block.
- **Holding a select case open on a channel that will never be ready.** The select becomes a sub-deadlock. Use the nil channel trick to disable the case.
- **Reading the loop variable inside a goroutine without copying.** Classic `for i := range` plus `go func() { use(i) }` — fixed in Go 1.22, but old habits remain.
- **Sending pointers through channels then mutating from the sender.** The receiver may see torn or stale data. Transfer ownership, do not share.
- **Ignoring `ok` from `<-ch`.** If the channel is closed, you get a zero value and might think it was a real send.
- **Calling `close(ctx.Done())`.** The channel is owned by the context, not you. Use `cancel()`.

---

## Tricky Points

- **Select pseudo-randomness.** When multiple cases are ready, Go picks at random. This means the order of cases does not give priority. To prioritize one channel over another, use a nested select: first try a non-blocking receive on the high-priority channel; if nothing is there, fall through to a select that waits on both.
- **A `select` with only a `default` case** is just an if-else that always runs default. It is legal but pointless.
- **`for v := range ch` does not respond to `ctx.Done()`** on its own. If you need both, switch to an explicit `for { select { ... } }`.
- **Tokio `select!` requires futures to be cancel-safe.** A future that panics if cancelled mid-execution will misbehave. Most channel `.recv()` futures are cancel-safe; many other futures are not.
- **Sending into a buffered channel does not synchronize the sender with the receiver.** Unlike an unbuffered channel, the sender returns as soon as the value is in the buffer. The receiver may not have run yet. Do not assume causality.
- **A `chan struct{}` carries no data but still allocates a slot in a buffered version.** A `chan struct{}, 1000` is a thousand zero-byte slots, useful as a counting semaphore.
- **Closing a channel of `chan T` does not close the inner channels.** They are separate values. You may close the outer and still have unclosed inners floating in goroutines.
- **`<-ch` and `ch <- v` are not atomic in the linearizability sense across the program.** They synchronize the two participants of the send-receive pair, but other goroutines see no guaranteed order.
- **A nil channel inside a struct field is silently disabled if you select on it.** Sometimes useful, sometimes a subtle bug: you forgot to initialize the field.

---

## Test Yourself

1. What is the difference between `select` with a `default` case and `select` without one?
2. Why does Go pick a random case when multiple are ready, instead of the first listed?
3. What happens when you send on a `nil` channel? Why is that useful inside `select`?
4. Write a function `merge(a, b <-chan int) <-chan int` that interleaves values from `a` and `b` and closes the result when both inputs are closed.
5. Why does the owner pattern require that consumers never close?
6. What is the difference between Tokio's `mpsc`, `broadcast`, `watch`, and `oneshot`?
7. How would you implement a priority select where channel A is checked before channel B?
8. Why is `for range ch` insufficient when the goroutine also needs to respond to cancellation?
9. What is the difference between `crossbeam::channel::bounded(0)` and `crossbeam::channel::bounded(1)`?
10. When a Tokio broadcast receiver lags, what happens to its missed messages?

---

## Tricky Questions

1. You have two goroutines that both send on the same channel. How do you safely close it?
2. A `select` has three cases — receive from A, receive from B, and `ctx.Done()`. A and B are both ready. The context fires at the same instant. Which case runs?
3. You write `select { case <-ch: case <-ch: }`. Is this legal? What does it do?
4. Why does a buffered channel of capacity 1 sometimes behave differently from a mutex-protected variable?
5. What happens if you `close(ch)` while another goroutine is in the middle of `<-ch`?
6. In Rust, can you `send` on a `tokio::sync::mpsc::Sender` from inside a sync function? Why or why not?
7. A pipeline has three stages. The third stage panics. What happens to the goroutines in stages one and two?
8. You want a "current value" channel where new subscribers immediately see the latest, but only the latest. Which channel do you reach for?
9. Tokio's `select!` cancels the losing futures. What happens to data they had buffered?
10. Crossbeam's bounded channel with capacity 0 — what does it do?

---

## Cheat Sheet

```text
Go select:
    select {
    case v := <-ch:        receive
    case ch <- x:          send
    case <-time.After(d):  timeout
    case <-ctx.Done():     cancellation
    default:               non-blocking
    }

Nil channel trick:
    set ch = nil to disable that case in select

Owner closes:
    only the sender side closes; receivers never close

Range over closed channel:
    for v := range ch { ... }  — ends when ch is closed and drained

Done pattern:
    done := make(chan struct{}); close(done) to signal stop

Channel flavors (Rust):
    std::sync::mpsc            multi-producer single-consumer, sync
    crossbeam::channel         MPMC, sync, with select!
    tokio::sync::mpsc          MPSC, async, bounded
    tokio::sync::broadcast     fan-out, every receiver gets every msg
    tokio::sync::watch         single shared current value
    tokio::sync::oneshot       single-use, one value

Common panics (Go):
    send on closed channel    panic
    close already-closed      panic
    close(nil chan)            panic
    receive on closed         ok=false, zero value (no panic)

Buffered semantics:
    cap N: sender blocks when N values pending
    bounded queue: back-pressure on producers
    cap 0 = unbuffered = rendezvous
```

---

## Summary

The middle level of channels is the transition from "two-goroutine pipe" to "system-level concurrency primitive." The key tool is `select`, which lets a goroutine wait on multiple channel operations at once and integrates cancellation, timeouts, and back-pressure into a single statement. The key discipline is the owner pattern: the sender side is responsible for closing, and consumers never close. The key idiom is `ctx.Done()` in every long-running select, which gives every goroutine a clean exit path.

Buffered channels are bounded queues that provide back-pressure automatically. The nil channel trick — assigning `nil` to a channel variable inside a `select` — lets you turn cases on and off dynamically, which is essential for state-machine goroutines. The channel-of-channel pattern carries reply addresses for request/response interactions.

Rust's standard library and ecosystem make the channel flavor distinctions explicit: `std::sync::mpsc` for sync MPSC, `crossbeam` for MPMC, `tokio::sync::mpsc` for async MPSC, `broadcast` for fan-out, `watch` for current-value semantics, `oneshot` for single-use delivery. The type system enforces each contract, which catches many bugs at compile time.

The common bugs at this level are goroutine leaks (blocked sends or receives on orphaned channels), send-on-closed panics (multiple senders racing with a close), and busy loops (select with default in a tight loop). Each has a known prevention: include `ctx.Done()` everywhere, coordinate close via WaitGroup, and avoid `default` unless you have a non-blocking semantic to express.

Master these patterns and you can design pipelines, worker pools, and actor systems that shut down cleanly, apply back-pressure, and survive partial failures. That is the real point of channels: not "passing values," but "structuring a concurrent program."

---

## What You Can Build

- **A graceful shutdown framework** for an HTTP server with worker pools, background jobs, and pub/sub event bus, where Ctrl-C drains every pipeline cleanly within a deadline.
- **A pipeline DSL** that takes a series of stage functions and wires them together with bounded channels, cancellation, and merge points automatically.
- **A pub/sub bus** for internal events, built on Tokio broadcast or a Go fan-out channel, with subscriber registration and back-pressure.
- **A request multiplexer** that accepts requests, dispatches them to a worker pool via MPSC, and routes replies back via oneshot channels.
- **A rate-limited consumer** that uses `time.Tick` and `select` to process at most N requests per second from an unbounded queue.
- **A config hot-reloader** built on Tokio's watch channel, where every component sees the latest config without polling.
- **A graceful drain controller** that closes input channels, waits for in-flight work to finish, and reports drain completion.

---

## Further Reading

- *The Go Programming Language* by Donovan & Kernighan — chapters 8 and 9 on goroutines and channels.
- *Concurrency in Go* by Katherine Cox-Buday — definitive coverage of channel idioms and patterns.
- *Programming Rust* by Blandy, Orendorff & Tindall — chapter on async and channels in Rust.
- The Go blog: "Go Concurrency Patterns: Pipelines and cancellation."
- The Go blog: "Share Memory By Communicating."
- Tokio documentation on `tokio::sync` channel flavors.
- Crossbeam documentation on bounded/unbounded channels and `select!`.
- Russ Cox: "Bell Labs and CSP Threads" — the historical roots of channels.

---

## Related Topics

- [Channels — Junior Level](junior.md) — typed pipes, send/recv, unbuffered vs buffered.
- [Channels — Senior Level](senior.md) — implementation, runqueue interaction, performance tuning.
- [Mutex and atomic primitives](../03-mutex-and-atomic-primitives/README.md) — when shared memory beats channels.
- [Goroutines and threads](../02-goroutines-and-threads/README.md) — the underlying execution unit.
- [Context cancellation](../../03-cancellation/README.md) — the partner abstraction.
- [Concurrency models](../../01-models/README.md) — CSP vs actors vs shared memory.

---

## Diagrams & Visual Aids

```
Select with three cases:

    +-----------------+
    |  select         |
    |    case <-in:   <----- value waiting? --+
    |    case out<-:  <----- buffer space?  --+
    |    case <-done: <----- closed?         --+
    |                 |
    | randomly pick one ready case
    +-----------------+


Three-stage pipeline:

    generate ----> square ----> sink
       |             |            |
    (writes        (reads in,    (reads in,
     to out,        writes out)   prints)
     closes)

    All three respect ctx.Done() in select.


Fan-in merge:

    in1 ---\
    in2 ----+----> out
    in3 ---/

    Each input forwarded by its own goroutine.
    WaitGroup waits for all forwarders, then close(out).


Fan-out worker pool:

                +--> worker 1 -->\
    jobs ------+--> worker 2 ----+--> results
                +--> worker 3 -->/

    Bounded jobs channel applies back-pressure.


Channel flavors:

    SPSC:    P ----> C       (one to one)
    MPSC:    P1 \
             P2 -+--> C      (many to one)
             P3 /
    SPMC:    P --+--> C1     (one to many, each gets one)
                 +--> C2
                 +--> C3
    MPMC:    P1 \      / C1
             P2 -+----+-- C2 (many to many)
             P3 /      \ C3
    Broadcast: P -+--> C1    (every C gets every msg)
                  +--> C2
                  +--> C3
    Watch:   P --[v]-- C1, C2, C3  (current value, latest only)
    Oneshot: P --(one)--> C        (single use)


Nil channel trick:

    Before: select { case a: ...; case b: ... }   both active
    Nil a:  select { case a(nil)/disabled; case b: ... }
            only b can fire
    Useful when input is exhausted but output still drains.


Owner pattern:

           +---------+      +----------+
           | Owner   | -----> consumer |
           | (sender)|      |          |
           +---------+      +----------+
              ^
              | close() — only owner
              |


Goroutine leak:

    +---------+        (no one reads)
    | sender  | ---ch--->  X
    | blocked |
    +---------+

    sender blocked on send forever. Goroutine alive but stuck.


Context cancellation cascade:

    ctx (parent) ------> ctx (child) ------> ctx (grandchild)
        |                    |                     |
     cancel()           Done() fires          Done() fires
                       in worker select       in deeper select

    One cancel call unwinds the whole tree.
```
