# Message-Passing Concurrency — Junior Level

> **Topic:** [Message-Passing Concurrency Roadmap](README.md)
> **Focus:** The "share by communicating" model: isolated workers, mailboxes, and the trade-offs that distinguish message passing from shared-memory threading.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros and Cons](#pros-and-cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> 🎓 Two threads, one variable, no lock — that is a data race. Two workers, one channel, no shared variable — that is message passing. Pick the second and a whole bug family vanishes.

Message-passing concurrency is the alternative to shared-memory threading. Instead of multiple threads reaching into the same variables (and reaching for the same locks), isolated entities — goroutines, actors, processes — communicate **only** by sending messages through a queue. No shared state means no data races. The price you pay is a different bug class: messages can be lost, reordered, duplicated, or pile up in a mailbox until memory runs out.

The umbrella covers a wide family: Hoare's **CSP** (Go channels), the **actor model** (Erlang, Akka), **MPI** in high-performance computing, and ultimately every distributed system that has ever shipped. They all share one rule: ownership is local, communication is explicit. Rob Pike's slogan compresses the whole idea: *"Don't communicate by sharing memory; share memory by communicating."*

This file teaches you the model at junior level: what a mailbox is, why synchronous and asynchronous sends behave so differently, how a producer talks to a consumer in Go, Python, Java, Erlang, and Rust, and which bugs you actually trade away (data races) for which new bugs you take on (lost messages, backpressure, mailbox overflow). The deeper machinery — scheduling, supervision, formal semantics — comes in [middle.md](middle.md) and beyond.

## Prerequisites

You will move faster if you already know:

- Basic threading or goroutines: how to start a concurrent unit of work
- Shared-memory concurrency at junior level — see [`../01-shared-memory/junior.md`](../01-shared-memory/junior.md) for the contrast
- What a data race is and why it is bad
- Basic queue data structure (FIFO)
- One language well enough to read 20-line snippets in Go, Python, Java, Erlang, or Rust
- Comfort with the words *blocking*, *non-blocking*, *synchronous*, *asynchronous*

If shared memory still feels fuzzy, read that junior file first — message passing is best understood as the answer to its problems.

## Glossary

| Term | Meaning |
| --- | --- |
| Message | An immutable value sent from one entity to another |
| Mailbox | The queue of pending messages belonging to a receiver |
| Channel | A typed conduit between sender and receiver (CSP style) |
| Send (`!`, `<-`, `put`) | Operation that delivers a message to a mailbox |
| Receive (`?`, `<-`, `take`) | Operation that pulls a message out of a mailbox |
| Synchronous send | Sender blocks until the receiver accepts the message (rendezvous) |
| Asynchronous send | Sender continues immediately; message sits in the queue |
| Bounded mailbox | Fixed capacity; sender blocks or fails when full |
| Unbounded mailbox | Grows as needed; can exhaust memory |
| Rendezvous | The moment sender and receiver meet for a synchronous handoff |
| Fire-and-forget | An async send where the sender never waits for an ack |
| Backpressure | Slowing the sender when the receiver cannot keep up |
| Owner | The single entity allowed to read its own mailbox |
| MPSC | Multiple producers, single consumer (common channel shape) |
| SPSC | Single producer, single consumer |
| Actor | An entity defined by mailbox + behavior, with a unique address (PID) |
| CSP | Communicating Sequential Processes — channels-first variant |
| Data race | Two threads racing on the same memory without synchronization |
| Message race | Receiver observes messages in an order the sender did not intend |

## Core Concepts

### 1. Isolated entities + messages

The two ingredients of every message-passing system are **entities** (something with its own state and execution) and **messages** (immutable values moving between them). An entity owns its private state; nobody else can read or write it. The only way to influence another entity is to send a message. This isolation is the whole point — it is what eliminates data races by construction.

Concretely: a goroutine, an Erlang process, an Akka actor, a Python `multiprocessing` worker. They differ in cost (a goroutine is cheap, an OS process is heavy) but the contract is the same: state in, messages across.

### 2. The mailbox / queue mental model

Every receiver has a **queue** of pending messages. Senders push to the back; the receiver pops from the front. In Go this queue is the channel buffer. In Erlang it is the process mailbox. In Akka it is the actor mailbox. In Python it is `multiprocessing.Queue`. The shape varies (FIFO, priority, selective) but the metaphor is constant: a literal inbox.

```
sender ──put──▶ [ msg ][ msg ][ msg ] ──take──▶ receiver
                  back              front
```

### 3. Synchronous vs asynchronous messages

A **synchronous** send blocks the sender until the receiver actually accepts the message. This is called a **rendezvous**: both parties meet at the same instant. Go's unbuffered channels are synchronous. The benefit: the sender knows the message was received. The cost: both sides must be ready at the same time, which can deadlock.

An **asynchronous** send returns immediately. The message lands in the mailbox and the sender keeps going. Erlang's `!` is asynchronous. The benefit: the sender is decoupled. The cost: the sender does not know if (or when) the message was processed, and the mailbox can grow without bound.

| Property | Synchronous | Asynchronous |
| --- | --- | --- |
| Sender blocks? | Until receiver takes it | No |
| Confirms delivery? | Yes, implicitly | No, you need an ack |
| Risk | Deadlock | Mailbox overflow |
| Example | Go unbuffered channel, Ada rendezvous | Erlang `!`, Akka tell |

### 4. The "no shared mutable state" promise

The model rests on one rule: **no two entities mutate the same memory**. If you obey it, locks, atomics, and memory ordering all disappear from your code. Data races become impossible because there is no shared data. This is why the model is loved for concurrent code that would otherwise need a swarm of locks.

Some implementations enforce this physically (separate OS processes share no address space). Others enforce it by convention (Go channels can technically carry pointers, and if you keep using that pointer after sending it, you have re-introduced sharing). Junior rule: once you send a value, treat it as gone.

### 5. What you trade away

Message passing eliminates a famous bug family but introduces a new one:

| Gone | New |
| --- | --- |
| Data races | Lost messages |
| Lock ordering deadlocks | Channel deadlocks (both sides waiting) |
| Atomics / memory model | Message reordering |
| Cache-line false sharing | Mailbox overflow / OOM |
| `volatile` confusion | Backpressure design |

The new bugs are usually easier to reason about because they live at message boundaries, not at every memory access. But they are not zero.

### 6. First-cut examples by language

| Language | Primitive | Style |
| --- | --- | --- |
| Go | `chan T` | CSP, sync or async |
| Python | `multiprocessing.Queue`, `asyncio.Queue` | Async, bounded |
| Java | `BlockingQueue` (e.g. `LinkedBlockingQueue`) | Sync (capacity 0) or async |
| Erlang | `Pid ! Msg`, `receive ... end` | Actor, async, unbounded |
| Rust | `std::sync::mpsc`, `tokio::sync::mpsc` | MPSC channel, sync or async |

### 7. The Rob Pike slogan

> Don't communicate by sharing memory; share memory by communicating.

The point: in shared memory you have one piece of state and many threads stepping over it. In message passing you have one piece of state and you *send* it where it needs to go. The "share" is the message itself, in flight, owned by one party at a time.

### 8. Bounded vs unbounded mailboxes

A **bounded** mailbox has a fixed capacity. When it is full, the sender blocks (or the send fails). This provides natural **backpressure** — slow consumers slow down their producers. A **unbounded** mailbox accepts anything, but if the producer is faster than the consumer, the queue grows until you run out of memory (Erlang process death by mailbox).

Junior advice: **default to bounded**. Pick a number, even if it is wrong; it will surface the problem.

### 9. The "one mailbox owner" rule

A mailbox should have **one reader**. Many writers can push messages in; only one entity reads them out. This keeps message ordering and ownership simple. Multiple readers on one queue is occasionally useful (work-stealing pools) but it is a more advanced pattern and easy to get wrong. CSP and actor systems both default to one reader per queue.

### 10. The "workers at separate desks" mental image

Picture an office. Each worker sits at their own desk with their own notepad. Nobody reaches into anybody else's drawers. To get something done, you write a note and slide it under the colleague's door. They will read it when they get to it. That is the whole model. The work is *isolated*; the communication is *explicit*; the queue is *the under-door slot*.

## Real-World Analogies

| Concept | Analogy |
| --- | --- |
| Entity / actor | Worker at a desk |
| Mailbox | Physical inbox tray on the desk |
| Message | A sticky note slid into the tray |
| Synchronous send | Walking over, handing the note, waiting for "got it" |
| Asynchronous send | Dropping a note in the tray and walking away |
| Bounded mailbox | Tray that only holds 10 notes; the 11th waits in your hand |
| Unbounded mailbox | A bottomless inbox — notes pile up forever |
| Backpressure | "Tray is full, I'll come back later" |
| One-reader rule | Only the desk's owner reads their own tray |
| Lost message | The note falls off the desk and nobody notices |
| Message reordering | Notes get shuffled while being handed off |
| Mailbox overflow | Notes spill onto the floor and you trip on them |

## Mental Models

### Workers and notes

The image above is enough for 90% of message-passing reasoning. Workers are isolated, notes are passed, never read each other's drawers. If you find yourself "reaching into someone's drawer" in your code, you have left the model.

### The factory conveyor belt

A producer drops items onto a conveyor; a consumer picks them off. The belt has a maximum number of items it can hold (the buffer). If the belt fills up, the producer stops (backpressure). If the belt is empty, the consumer waits. The belt is the channel; the items are messages.

### The post office

Asynchronous messages are letters. You drop a letter in a postbox and walk away; the recipient reads it whenever. There is no delivery guarantee unless you pay extra (acknowledgement). Letters can be lost, delayed, or arrive out of order. Synchronous messages are more like a phone call — both parties are on the line at the same time.

## Code Examples

The same problem in every language: a **producer** sends the integers 1 through 100 to a **consumer** that sums them and prints the total. Expected answer: 5050.

### Go — channel

```go
package main

import (
	"fmt"
	"sync"
)

func producer(ch chan<- int) {
	defer close(ch)
	for i := 1; i <= 100; i++ {
		ch <- i // synchronous send on unbuffered channel
	}
}

func consumer(ch <-chan int, done chan<- int) {
	sum := 0
	for v := range ch {
		sum += v
	}
	done <- sum
}

func main() {
	ch := make(chan int)        // unbuffered: rendezvous
	done := make(chan int)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); producer(ch) }()
	go consumer(ch, done)
	wg.Wait()
	fmt.Println("sum =", <-done) // sum = 5050
}
```

The channel `ch` is the mailbox. `close(ch)` signals end-of-stream so the consumer's `range` loop terminates.

### Python — multiprocessing.Queue

```python
import multiprocessing as mp

def producer(q: mp.Queue) -> None:
    for i in range(1, 101):
        q.put(i)
    q.put(None)  # sentinel: end of stream

def consumer(q: mp.Queue, result: mp.Queue) -> None:
    total = 0
    while True:
        v = q.get()
        if v is None:
            break
        total += v
    result.put(total)

if __name__ == "__main__":
    q: mp.Queue = mp.Queue(maxsize=10)   # bounded mailbox
    result: mp.Queue = mp.Queue()
    p = mp.Process(target=producer, args=(q,))
    c = mp.Process(target=consumer, args=(q, result))
    p.start(); c.start()
    p.join(); c.join()
    print("sum =", result.get())          # sum = 5050
```

Each process has its own memory. The `Queue` serialises messages between them. `maxsize=10` gives backpressure.

### Java — LinkedBlockingQueue

```java
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;

public class ProducerConsumer {
    private static final Integer SENTINEL = Integer.MIN_VALUE;

    public static void main(String[] args) throws InterruptedException {
        var queue = new LinkedBlockingQueue<Integer>(10); // bounded mailbox
        var sum = new AtomicInteger();

        Thread producer = new Thread(() -> {
            try {
                for (int i = 1; i <= 100; i++) queue.put(i);
                queue.put(SENTINEL);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        Thread consumer = new Thread(() -> {
            try {
                while (true) {
                    int v = queue.take();
                    if (v == SENTINEL) break;
                    sum.addAndGet(v);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        producer.start(); consumer.start();
        producer.join();  consumer.join();
        System.out.println("sum = " + sum.get()); // sum = 5050
    }
}
```

`AtomicInteger` here is only because two threads share JVM memory; in pure message-passing style the consumer would publish the result through a second queue.

### Erlang — the canonical actor

```erlang
-module(producer_consumer).
-export([start/0, consumer/2]).

start() ->
    Self = self(),
    Consumer = spawn(?MODULE, consumer, [0, Self]),
    [Consumer ! N || N <- lists:seq(1, 100)],
    Consumer ! done,
    receive
        {sum, Total} -> io:format("sum = ~p~n", [Total]) % sum = 5050
    end.

consumer(Sum, Parent) ->
    receive
        done -> Parent ! {sum, Sum};
        N when is_integer(N) -> consumer(Sum + N, Parent)
    end.
```

The `!` operator sends asynchronously; `receive` blocks on the next message that matches a pattern. Mailbox order is sender-order per pair.

### Rust — std::sync::mpsc

```rust
use std::sync::mpsc;
use std::thread;

fn main() {
    let (tx, rx) = mpsc::sync_channel::<i32>(10); // bounded, blocking sender
    let producer = thread::spawn(move || {
        for i in 1..=100 {
            tx.send(i).unwrap();
        }
        // tx dropped here: closes the channel
    });
    let consumer = thread::spawn(move || {
        let mut sum = 0_i32;
        for v in rx {
            sum += v;
        }
        sum
    });
    producer.join().unwrap();
    let sum = consumer.join().unwrap();
    println!("sum = {}", sum); // sum = 5050
}
```

`mpsc::sync_channel(10)` is a bounded blocking channel; `mpsc::channel()` is unbounded. Dropping `tx` closes the channel and the `for v in rx` loop ends.

## Pros and Cons

### Pros

| Benefit | Why it matters |
| --- | --- |
| No data races | The compiler / runtime cannot have one if there is no shared memory |
| Composable | Pipelines (a → b → c → d) fall out naturally |
| Maps to distributed | Same model scales from goroutines to microservices |
| Easier reasoning | State lives in one place; bugs live at message boundaries |
| Backpressure-friendly | Bounded queues naturally regulate fast producers |
| Fault-isolation | One actor crashing does not corrupt another's state |

### Cons

| Cost | Why it hurts |
| --- | --- |
| Copying overhead | Messages are copied or serialised, not just pointed to |
| Latency floor | Even an in-process send has scheduling cost |
| Mailbox overflow | Unbounded queues can OOM the process silently |
| Reordering across pairs | Messages from A and B may interleave unexpectedly |
| Harder request/response | Synchronous call requires reply channel plumbing |
| Debugging tooling | Stepping through message flow is harder than stepping through a stack |

## Use Cases

- **Web servers**: each request is a message; a worker pool drains a job queue.
- **Background job processing**: producers push jobs to Redis/Kafka/SQS; consumers pull.
- **Pipelines**: stage-1 reads files, stage-2 parses, stage-3 writes — channels glue them.
- **Telecom switches**: the original Erlang use case — millions of independent calls.
- **Game servers**: each entity (player, NPC) modelled as an actor with a mailbox.
- **GUI event loops**: the main thread reads events from a queue; workers send results back.
- **Microservices**: services talk over HTTP/gRPC/queues, which is message passing at network scale.
- **HPC with MPI**: nodes exchange messages because they have no shared memory.

## Coding Patterns

### Fan-out / fan-in

```go
// Fan-out: one producer feeds N workers
jobs := make(chan int, 100)
results := make(chan int, 100)

for w := 0; w < 4; w++ {
    go func() {
        for j := range jobs {
            results <- j * j
        }
    }()
}
```

One channel, N readers, M writers, one drain. Workers are interchangeable.

### Pipeline

```go
// stage1 -> stage2 -> stage3, each a goroutine
nums := generate()         // chan int
squares := square(nums)    // chan int
sum := sumAll(squares)     // chan int
fmt.Println(<-sum)
```

Each stage owns its goroutine and reads from the previous stage. Closing the upstream channel propagates termination.

### Worker pool with bounded queue

```python
from queue import Queue
from threading import Thread

q = Queue(maxsize=50)

def worker():
    while True:
        item = q.get()
        if item is None:
            q.task_done()
            return
        handle(item)
        q.task_done()

threads = [Thread(target=worker, daemon=True) for _ in range(4)]
for t in threads: t.start()
for item in source(): q.put(item)
for _ in threads: q.put(None)  # poison pills
for t in threads: t.join()
```

`maxsize=50` provides backpressure; `None` is a poison-pill sentinel that tells each worker to exit.

### Request / response over channels

```go
type req struct {
    payload string
    reply   chan string // every request carries its own reply channel
}

go func() {
    for r := range requests {
        r.reply <- process(r.payload)
    }
}()
```

Bidirectional behaviour from a one-way primitive: the request *contains* the channel for the response.

## Clean Code

- Name channels after what flows in them: `jobs`, `results`, `done`. Not `c`, `ch1`.
- Document each channel's **direction** (send-only, receive-only) at the function boundary.
- Document each channel's **buffer size** decision in a comment.
- One writer per channel, or zero — never "many writers, sometimes also a reader."
- Always have a story for how the channel **closes**.
- Send immutable / read-only values. If you must send a pointer, treat the pointer as moved.
- Reply channels are owned by the requester, not the worker.
- Sentinel values (`None`, `nil`, poison pills) belong at the very end of a stream.

## Best Practices

- **Default to bounded queues.** Pick a capacity even if it is a guess.
- **The sender closes** — receivers never close a channel they read.
- **Use `select` / `selective receive` for timeouts** rather than blocking forever.
- **Don't share pointers** through messages; if you must, document the ownership transfer.
- **Make messages small.** Big payloads belong in shared storage referenced by ID.
- **Have one mailbox owner.** Many writers, one reader.
- **Plan for backpressure** before throughput becomes a problem.
- **Add a metric** for queue depth — you want to see overflow coming.
- **Log message types,** not message contents (PII, size).
- **Pair every async send with a thought** about what happens if the receiver crashes.

## Edge Cases and Pitfalls

- **Closed-channel writes** — sending on a closed Go channel panics. Always know who closes.
- **Receive from nil channel** — blocks forever. Same as `select` on `nil`.
- **Unbounded mailbox + slow consumer** — guaranteed OOM eventually.
- **Two receivers on one channel** — order of delivery is undefined.
- **`select` without `default`** — blocks until *some* case fires; you must guarantee one will.
- **Tiny message + huge buffer** — fine. **Huge message + huge buffer** — quietly burns memory.
- **Self-deadlock** — actor sends synchronously to itself and waits for the reply.
- **Sentinel collision** — using `None` as a poison pill when `None` is a valid payload.
- **Reordering across pairs** — messages from A and B may interleave; only one-pair order is preserved.
- **Forgotten close** — `range ch` never returns; goroutine leaks.

## Common Mistakes

1. Treating channels as a "free synchronisation primitive" and replacing locks 1-for-1 — channels have their own deadlocks.
2. Sending a pointer and then mutating it on the sender side. Now you have shared memory through the back door.
3. Defaulting to unbounded queues "for performance." The first slow consumer brings down the process.
4. Closing a channel from the receiver. In Go this panics on the next send.
5. Multiple goroutines closing the same channel. Also panics.
6. Using a single shared mailbox for everything ("god channel") instead of typed channels per purpose.
7. Spawning more workers when a queue fills up, instead of slowing the producer.
8. Forgetting that `select` cases are picked **randomly** when multiple are ready, not in source order.
9. Designing request/response with a global reply channel instead of per-request reply channels.
10. Assuming async means free. Each send has scheduling and possibly serialisation cost.

## Tricky Points

- **Unbuffered vs buffered Go channels** behave very differently. Unbuffered = rendezvous; buffered = mailbox.
- **Erlang's mailbox is per-process, not per-channel.** Selective receive scans the mailbox in order.
- **`select` is biased**: in Go it is random, in Erlang it follows pattern order, in Rust `select!` requires care.
- **Closing in Rust** happens when the *last sender* is dropped. Forgetting to drop yields a hang.
- **Java's `SynchronousQueue` is the rendezvous queue** — capacity zero. Easy to confuse with `LinkedBlockingQueue`.
- **Order is preserved per sender-receiver pair**, not globally. A then B from sender X arrive in that order; messages from Y interleave arbitrarily.
- **A bounded channel of capacity 1 is not the same as unbuffered.** Capacity-1 lets the sender deposit one message and walk; unbuffered forces a meeting.
- **The "no shared state" property is a convention** in most languages — only OS-process-based systems enforce it physically.

## Test Yourself

1. Rewrite the producer-consumer example using a buffered channel of size 1. What changes about sender behaviour?
2. In the Erlang example, what happens if the producer sends `done` *before* sending some of the integers?
3. Build a Go pipeline of three stages: generate numbers, square them, sum them. Use one goroutine per stage.
4. In Python, write the same producer-consumer using `asyncio.Queue` instead of `multiprocessing.Queue`. How does the model change?
5. What is the difference between Java's `SynchronousQueue`, `ArrayBlockingQueue`, and `LinkedBlockingQueue`? Which is closest to a Go unbuffered channel?
6. Write a worker pool in Rust with 4 workers reading from one `mpsc` channel. Why does this require a `Mutex` on the receiver?
7. Modify the Go example to add a timeout: if the consumer does not finish in 500 ms, exit with an error.
8. Sketch how you would implement request/response with a `reply chan` field, including a timeout per request.

## Tricky Questions

**Q1. Why does message passing eliminate data races?**
Because there is no shared memory to race on. Each entity has its own state; the only way to influence another is to send a message, which the receiver processes one at a time.

**Q2. Does message passing eliminate deadlocks?**
No. Two goroutines can both `<-ch` and wait forever. The flavour changes (channel deadlock instead of lock deadlock) but the family persists.

**Q3. What is the difference between a synchronous and asynchronous send?**
Synchronous blocks the sender until the receiver accepts the message — a rendezvous. Asynchronous returns immediately; the message sits in the mailbox.

**Q4. What is backpressure and how does it relate to mailbox capacity?**
Backpressure is slowing the producer when the consumer cannot keep up. A bounded mailbox provides it automatically — the sender blocks when full. Unbounded mailboxes have no backpressure and risk OOM.

**Q5. What does Rob Pike's slogan actually mean?**
Instead of multiple threads coordinating around one piece of memory, you move the memory itself between owners via messages. The "share" becomes the message in transit.

**Q6. Who should close a Go channel?**
The sender, and only the sender, and only one sender. Closing from a receiver, closing twice, or sending after close all panic.

**Q7. Is the actor model the same as message passing?**
The actor model is one instance of message passing — it adds rules about identity (PIDs), per-actor mailbox, and often supervision. CSP is another instance, channel-first rather than actor-first.

**Q8. Why is a bounded channel of capacity 1 different from an unbuffered channel?**
Unbuffered forces a rendezvous: sender blocks until receiver reads. Capacity 1 lets the sender deposit one message and walk away without a receiver being present.

## Cheat Sheet

```text
┌────────────────────────────────────────────────────────────────────────┐
│                  MESSAGE-PASSING CONCURRENCY                           │
├────────────────────────────────────────────────────────────────────────┤
│ RULE 1: No shared mutable state.                                       │
│ RULE 2: Communicate via messages only.                                 │
│ RULE 3: One reader per mailbox.                                        │
│ RULE 4: The sender closes the channel (when applicable).               │
│ RULE 5: Default to bounded queues.                                     │
├────────────────────────────────────────────────────────────────────────┤
│ Sync send:   sender blocks until receiver takes  (rendezvous)          │
│ Async send:  sender continues immediately        (mailbox)             │
├────────────────────────────────────────────────────────────────────────┤
│ Go:      ch := make(chan T, n)  ;  ch <- v  ;  v := <-ch ; close(ch)   │
│ Python:  q = Queue(maxsize=n)   ;  q.put(v) ;  v = q.get()             │
│ Java:    new LinkedBlockingQueue<T>(n) ; q.put(v) ; v = q.take()       │
│ Erlang:  Pid ! Msg              ;  receive Pattern -> ... end          │
│ Rust:    let (tx, rx) = mpsc::sync_channel(n); tx.send(v); rx.recv()   │
├────────────────────────────────────────────────────────────────────────┤
│ TRADES: data races GONE ; lost / reordered / overflowed messages NEW   │
│ DEFAULT: bounded queue, one reader, one closer, no shared pointers.    │
└────────────────────────────────────────────────────────────────────────┘
```

## Summary

- Message-passing concurrency replaces shared variables with isolated entities exchanging messages.
- The mailbox is the central abstraction: a queue per receiver.
- Synchronous sends rendezvous; asynchronous sends decouple but risk overflow.
- The model eliminates data races by removing shared memory but introduces lost / reordered / overflowed messages and channel deadlocks.
- Bounded queues give you backpressure; unbounded queues hide your scaling problem until OOM.
- Rob Pike's slogan compresses the idea: share by communicating.
- Actor model (Erlang, Akka) and CSP (Go) are two specific instances of this umbrella.
- Junior reflexes: name your channels, bound your queues, one reader per mailbox, sender closes.

## What You Can Build

- A multi-stage data-processing pipeline (read CSV → parse → enrich → write) using channels per stage.
- A web crawler with a bounded URL queue, four worker goroutines, and a result channel.
- A small in-process job queue with retries (failed jobs go back into a delay queue).
- A chat-room server where each connected user is an actor with its own mailbox.
- A reservation system where one actor owns the inventory and clients send `Reserve(id)` messages.
- A simulation of customers in a coffee shop using actors per customer and per barista.
- A toy MapReduce: mapper actors send pairs to reducer actors via a partitioner.

## Further Reading

- Hoare, C.A.R. — *Communicating Sequential Processes* (1978). The foundational paper. [PDF](https://www.cs.cmu.edu/~crary/819-f09/Hoare78.pdf)
- Pike, R. — *Go Concurrency Patterns* talk. [Video](https://www.youtube.com/watch?v=f6kdp27TYZs)
- Armstrong, J. — *Programming Erlang*, chapters on processes and messages.
- Vernon, V. — *Reactive Messaging Patterns with the Actor Model* (Akka).
- *The Go Memory Model* — official Go documentation.
- *Tokio Tutorial* — Rust async channels. [tokio.rs](https://tokio.rs/tokio/tutorial/channels)
- *Concurrency in Python with asyncio* — official Python docs on `asyncio.Queue`.

## Related Topics

- This topic, deeper levels: [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md)
- Interview prep: [`interview.md`](interview.md)
- Practice exercises: [`tasks.md`](tasks.md)
- Sibling models:
  - [`../01-shared-memory/junior.md`](../01-shared-memory/junior.md) — the contrast: shared variables and locks
  - [`../03-actor-model/junior.md`](../03-actor-model/junior.md) — message passing with identity and supervision
  - [`../04-csp/junior.md`](../04-csp/junior.md) — message passing channel-first, Hoare's formalism
- Primitive deep-dive:
  - [`../../02-primitives/05-channels/junior.md`](../../02-primitives/05-channels/junior.md) — channels as a concrete primitive

## Diagrams and Visual Aids

### Shared memory vs message passing

```text
              SHARED MEMORY                          MESSAGE PASSING
                                                                                
   ┌──────┐ ┌──────┐ ┌──────┐                ┌──────┐         ┌──────┐
   │  T1  │ │  T2  │ │  T3  │                │  E1  │         │  E2  │
   │ state│ │ state│ │ state│                │state │         │state │
   └──┬───┘ └──┬───┘ └──┬───┘                └──┬───┘         └──┬───┘
      │        │        │                       │  ──message──▶  │
      ▼        ▼        ▼                       │                │
   ┌────────────────────────┐                   ▼                ▼
   │   SHARED VARIABLE x    │                ┌──────┐         ┌──────┐
   │   (with a mutex lock)  │                │ mbox │         │ mbox │
   └────────────────────────┘                └──────┘         └──────┘
                                                                              
   races, locks, memory model            isolation, queues, sends
```

### A mailbox over time

```text
  t=0   sender ─push──▶ [   ][   ][   ][   ][   ]   receiver
  t=1   sender ─push──▶ [ 1 ][   ][   ][   ][   ]   receiver
  t=2   sender ─push──▶ [ 1 ][ 2 ][   ][   ][   ]   receiver
  t=3                   [ 1 ][ 2 ][ 3 ][   ][   ]   receiver ─pop──▶ 1
  t=4                   [ 2 ][ 3 ][ 4 ][   ][   ]   receiver ─pop──▶ 2

   FIFO order per sender. Bounded capacity ⇒ sender blocks at t=K
   if receiver hasn't drained.
```

### Synchronous vs asynchronous send

```text
  SYNCHRONOUS (rendezvous)              ASYNCHRONOUS (mailbox)

   sender:     send ──┐                  sender:    send ──▶ done
                      │                  
                      │ wait              receiver:        ...take... 
                      ▼
   receiver:        recv ──▶ done
   
   Both parties meet at one instant.    Sender doesn't wait; message
                                        sits in queue until consumed.
```

### Producer / consumer pipeline

```text
                              channel              channel
   ┌──────────┐  jobs       ┌─────────┐ results   ┌──────────┐
   │ producer │ ─────────▶  │  worker │ ────────▶ │ consumer │
   └──────────┘             └─────────┘           └──────────┘
                                 ▲
                            ┌─────────┐
                            │  worker │   (fan-out: N workers
                            └─────────┘    share one input channel)
                                 ▲
                            ┌─────────┐
                            │  worker │
                            └─────────┘
```
