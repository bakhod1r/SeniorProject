# Message-Passing Concurrency — Middle Level

> **Topic:** [Message-Passing Concurrency](README.md)
> **Focus:** bounded queues, select, MPMC, backpressure, routing
---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Clean Code](#clean-code)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Common Mistakes](#common-mistakes)
- [Tricky Points](#tricky-points)
- [Test Yourself](#test-yourself)
- [Tricky Questions](#tricky-questions)
- [Cheat Sheet](#cheat-sheet)
- [Summary](#summary)
- [What You Can Build](#what-you-can-build)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)
- [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the junior level you learned that message passing replaces shared state with
explicit envelopes flowing between independent workers. That model removes the
need for locks but it introduces a brand-new family of design decisions: how
big should the mailbox be, what should happen when it fills, who reads from it,
and what does cancellation look like when there is no shared flag to flip. The
middle level is about acquiring the vocabulary and judgement to answer those
questions on real systems, not on toy demos.

A message-passing system in production is a pipeline of queues. Every queue is
a contract between a producer and a consumer about throughput, latency, and
loss. Pick an unbounded queue and you trade memory safety for "no producer
ever blocks"; pick a bounded queue and you must decide what happens at the
boundary — block, drop, throttle, or shed load through credits. The decision
ripples through the whole architecture, and getting it wrong is the single
most common cause of production outages in actor-style and channel-style
systems. By the end of this page you should be able to draw the queues on a
napkin, label each one with its capacity policy, and predict where the system
will break under load.

We will work through the canonical primitives every middle engineer needs:
`select`, MPMC vs MPSC vs SPSC channels, fan-in and fan-out, backpressure
strategies, delivery guarantees, timeouts, and cancellation via channel
close. We will then implement the same worker-pool — one producer, N
workers, one aggregator, bounded buffer — in Go, Erlang, Rust, Python, and
Java so you can compare the shapes side by side. The goal is not to memorize
APIs but to develop a portable mental model that survives switching
languages.

---

## Prerequisites

- Junior-level message passing: mailbox, send, receive, isolation.
- Comfortable with at least one of: Go channels, Erlang processes, Rust
  `tokio::sync::mpsc`, Java `BlockingQueue`, Python `multiprocessing.Queue`.
- Basic understanding of context switching and OS scheduling.
- Familiarity with the producer-consumer problem.
- Awareness that "unbounded queue" is usually a lie in production.
- Reading-level knowledge of memory ordering (you do not need to write it,
  but you should know `release` precedes `acquire` for sane messages).

---

## Glossary

| Term | Meaning |
|---|---|
| Mailbox | The per-actor or per-channel queue that buffers incoming messages. |
| Channel | A typed conduit with explicit send and receive endpoints. |
| SPSC | Single Producer, Single Consumer — only one sender, only one receiver. |
| MPSC | Multi Producer, Single Consumer — many senders, one receiver. |
| SPMC | Single Producer, Multi Consumer — one sender, many receivers. |
| MPMC | Multi Producer, Multi Consumer — many of both. |
| Select | A primitive that waits on multiple channel operations and proceeds with whichever becomes ready first. |
| Rendezvous | A zero-capacity (unbuffered) channel where send and receive synchronize in lock-step. |
| Backpressure | Feedback from a slow consumer back to a fast producer that slows the producer down. |
| Fan-in | Multiple producers feeding into one consumer (merging streams). |
| Fan-out | One producer feeding into multiple consumers (splitting work). |
| Scatter-gather | Fan out a request to N workers, fan in their replies, combine. |
| Idempotent | Safe to apply the same message twice — duplicates do not change the result. |
| At-least-once | The system guarantees a message is delivered, but may deliver it more than once. |
| At-most-once | The system may drop messages but will never duplicate them. |
| Exactly-once | A combination of de-duplication on top of at-least-once, often application-level. |
| Drop policy | What a bounded queue does on overflow — drop newest, drop oldest, or block. |
| Credit-based flow | Consumer issues "I can accept N more" tokens; producer sends only with credits. |
| Zombie actor | An actor whose mailbox is still being fed but which can no longer drain it. |
| Goroutine leak | A goroutine blocked forever on a send or receive because its peer disappeared. |
| Poison pill | A sentinel message that tells a worker to shut down gracefully. |
| Done channel | A channel closed (not sent on) purely to broadcast cancellation. |
| Inbox queue | Synonym for mailbox in actor frameworks. |
| Outbox | A queue of messages a worker intends to send when the receiver is ready. |

---

## Core Concepts

### Bounded vs unbounded queues

A queue is **unbounded** when its capacity is, in principle, the size of
addressable memory. A queue is **bounded** when sends past capacity either
block, fail, or evict an existing element. The choice is the most consequential
in your whole design.

| Property | Unbounded | Bounded |
|---|---|---|
| Producer behavior on overflow | Always proceeds | Blocks, fails, or drops |
| Memory growth under sustained overload | Unlimited | Capped |
| Backpressure | None | Implicit (block) or explicit (fail) |
| Diagnosability of slow consumers | Difficult — heap just grows | Obvious — producers slow down |
| Risk profile | OOM under burst | Stalls under burst |
| Best for | Bursty work that *must* not block | Throughput-bounded pipelines |

In production code the default should be bounded. Unbounded queues are
acceptable only when (a) the producer is rate-limited upstream of the queue,
or (b) you have measured that the worst-case backlog still fits in memory
with headroom. Saying "we'll just use a list" is how services die at 3 a.m.

### Synchronous (unbuffered) vs asynchronous (buffered) channels

A channel with capacity zero is a **rendezvous** — the sender blocks until a
receiver is present, and vice versa. A channel with capacity N decouples them
up to N messages.

```
Unbuffered (rendezvous):
  Producer: send -----[blocks]------ recv :Consumer
                          \____happens at same point in time

Buffered (capacity 3):
  Producer: send send send send------[blocks]------ recv recv :Consumer
            |    |    |   ^
            |    |    |   buffer full → 4th send blocks
            └────┴────┴── messages sit in buffer
```

A rendezvous gives you the strongest happens-before guarantees: the receiver
sees everything the sender did before the send, and the sender knows the
receiver has started handling the message. Buffered channels weaken this — a
send only proves the message reached the buffer, not that anyone touched it.

### The select statement

`select` is the multiplexer of message passing. It blocks on several channel
operations and proceeds with whichever is first ready. Without `select` you
cannot model timeouts, cancellation, prioritized inputs, or fair merging in a
single goroutine or process.

Go:

```go
select {
case msg := <-jobs:    handle(msg)
case <-ctx.Done():     return
case <-time.After(2*time.Second): handleTimeout()
}
```

Erlang:

```erlang
receive
    {job, Msg} -> handle(Msg);
    stop -> ok
after 2000 ->
    handle_timeout()
end.
```

Rust (tokio):

```rust
tokio::select! {
    Some(msg) = jobs.recv() => handle(msg),
    _ = cancel.cancelled() => return,
    _ = tokio::time::sleep(Duration::from_secs(2)) => handle_timeout(),
}
```

Python asyncio:

```python
done, pending = await asyncio.wait(
    {job_task, cancel_task, timeout_task},
    return_when=asyncio.FIRST_COMPLETED,
)
```

The mental model is the same in every language: "wake me up for whichever of
these events happens first, and let me write a different handler for each."

### MPMC, MPSC, SPSC

The producer/consumer cardinality is part of the channel's type. It exists
because the implementation can be drastically faster when the runtime knows
there is exactly one sender or exactly one receiver.

| Type | Senders | Receivers | Typical use |
|---|---|---|---|
| SPSC | 1 | 1 | Ring buffers between two threads, very high throughput. |
| MPSC | N | 1 | Workers reporting to a single aggregator, log writers. |
| SPMC | 1 | N | Broadcast, work distribution to a worker pool. |
| MPMC | N | N | General-purpose job queue, message bus. |

Picking the loosest type when a tighter type works costs you throughput.
Picking too tight a type and then violating the constraint silently corrupts
the queue. When in doubt, use MPMC and measure.

### Routing strategies

When messages flow through multiple workers you need a policy. The
canonical ones:

| Strategy | Behavior | When to use |
|---|---|---|
| Round-robin | Send each message to the next worker in order. | Equal-cost work, no affinity. |
| Random | Pick a worker uniformly. | Simple, statistically balanced. |
| Sticky/affinity | Hash on a key and send to the worker owning that key. | Per-user ordering, cache locality. |
| Broadcast | Send the same message to every worker. | Configuration updates, cache invalidation. |
| Scatter-gather | Broadcast a question, collect N replies, combine. | Distributed search, quorum reads. |
| Least-loaded | Send to the worker with the shortest queue. | Highly variable per-message cost. |

### Backpressure

When the consumer cannot keep up, the producer must learn about it. The four
canonical responses:

| Strategy | Producer experience | Trade-off |
|---|---|---|
| Block | `send` blocks until space frees. | Simple. Risks deadlock if blocking is unexpected. |
| Drop | Newest (or oldest) message discarded. | Bounded memory. Lossy. |
| Throttle | Producer slows itself down (sleep, token bucket). | Smooth. Needs cooperation from producer. |
| Credit-based | Consumer hands out N credits; producer sends only with credits. | Explicit. Used by gRPC streaming, TCP, RSocket. |

Picking a backpressure strategy is a product decision as much as a technical
one. A metrics pipeline may prefer dropping samples; a financial trade feed
must block.

### Delivery guarantees

Message-passing systems differ in what they promise:

| Guarantee | Meaning | How achieved |
|---|---|---|
| At-most-once | Never delivers a message twice. May lose. | Fire and forget. |
| At-least-once | Never loses. May duplicate. | Retry until ack. Requires idempotent handlers. |
| Exactly-once | Each message handled exactly once. | At-least-once + de-duplication store. |
| Ordered | Messages from sender A to receiver B arrive in send order. | SPSC or per-key serial. |
| Causally ordered | If A causes B, A is seen first. | Vector clocks, happens-before. |

Inside a single process most channel implementations are ordered and
at-most-once on overflow drop or at-least-once if you implement retries.
Across processes or machines, ordering and exactly-once become much harder
and usually require a broker.

### Timeouts and deadlines

A receive without a timeout is a potential deadlock. Wrap receives in
`select` with a timer channel (Go), `receive ... after T` (Erlang), or a
`select!` arm with `sleep` (Rust). The middle-level habit is: every
externally visible receive has a timeout *or* a cancellation channel.

### Cancellation via channel close

Closing a channel is a broadcast: every current and future receive returns
the zero value plus a "closed" signal. This is the idiomatic way to tell N
workers "stop now."

```go
done := make(chan struct{})
// ... later:
close(done) // every <-done unblocks
```

Never close a channel from the receiver side, and never close a channel
twice — both cause panics in Go. The convention is: the producer closes
when there will be no more sends.

### Memory cost of copying

Sending a message copies its bytes into the receiver's frame of reference.
For small messages this is fine; for large blobs it can dominate cost.
Three mitigations:

1. **Send pointers**, accepting that the receiver can mutate shared memory.
2. **Transfer ownership** (Rust `Send`, C++ `unique_ptr`, Pony iso) — the
   sender loses access at the type-system level.
3. **Pool buffers** — pass an index into a shared arena rather than the data.

### Common bugs at middle level

- **Goroutine leak** — a worker blocked on `<-jobs` after the producer
  vanished without closing `jobs`.
- **Zombie actor** — mailbox still being fed by other actors while the
  actor's main loop has crashed or exited.
- **Receive timing-out under load** — your timer fires while a message was
  actually about to arrive; you now have a duplicate request.
- **Select bias** — Go select pseudo-randomizes ready cases, but ad-hoc
  receive loops over multiple channels can starve some inputs.
- **Close of nil channel** — `close(nil)` panics. Defensive code should
  guard.

---

## Real-World Analogies

| Analogy | Mapping |
|---|---|
| Restaurant kitchen with order spike | Bounded ticket rail; cooks block until rail has space; backpressure to host. |
| Postal service with returned mail | Unbounded queue at sorting; eventually trucks overflow → bounded reality. |
| Hospital triage room | Priority-based receive; emergencies preempt routine cases. |
| Call center with hold music | Buffered queue; if all agents busy, callers wait in the queue (block). |
| Highway toll plaza | Lane = worker, booth = mailbox; round-robin or least-loaded routing. |
| Conveyor belt at airport security | Limited belt length = bounded queue; bags pile up at the entrance. |
| Newsroom wire desk | Fan-in: many correspondents → one desk → fan-out to editors. |
| Air traffic control | Credit-based: pilots wait for clearance (credit) before takeoff. |
| Restaurant pager | Closed channel = "your table is ready" broadcast. |

---

## Mental Models

1. **Every channel is a contract.** Capacity, drop policy, who closes, and
   delivery guarantee are part of its type, even if the language type
   system does not express them. Document them.

2. **Producers should fear the buffer being full.** If your code never has
   to handle a full buffer, your buffer is either unbounded or untested.

3. **Receivers should fear the channel being closed.** Every receive site
   must explicitly decide what closed-channel means — usually "exit
   cleanly."

4. **The pipeline shape is the architecture.** Draw the queues, label
   capacities, label producers and consumers. That drawing *is* the
   design.

5. **Bounded queues plus block-on-full is the simplest correct
   backpressure.** Reach for anything fancier only after you have measured
   that "block" is unacceptable.

6. **Cancellation is a separate channel.** Do not piggyback shutdown
   signals on the data channel. A dedicated `done` makes cancellation
   independent of buffering.

7. **Closing is one-shot and one-writer.** Pick the unique closer at
   design time and document it next to the channel.

---

## Code Examples

The scenario: one **producer** generates jobs at a steady rate, N
**workers** process them with variable latency, one **aggregator** sums
results. The job channel is bounded so that when workers fall behind, the
producer experiences backpressure.

### Go

```go
package main

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type Job struct {
	ID    int
	Value int
}

type Result struct {
	JobID  int
	Output int
}

func producer(ctx context.Context, jobs chan<- Job, total int) {
	defer close(jobs)
	for i := 0; i < total; i++ {
		select {
		case jobs <- Job{ID: i, Value: rand.Intn(100)}:
		case <-ctx.Done():
			return
		}
	}
}

func worker(ctx context.Context, id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case j, ok := <-jobs:
			if !ok {
				return
			}
			time.Sleep(time.Duration(rand.Intn(20)) * time.Millisecond)
			out := j.Value * 2
			select {
			case results <- Result{JobID: j.ID, Output: out}:
			case <-ctx.Done():
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func aggregator(results <-chan Result, done chan<- int) {
	sum := 0
	for r := range results {
		sum += r.Output
	}
	done <- sum
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	jobs := make(chan Job, 16) // bounded buffer = backpressure
	results := make(chan Result, 16)
	done := make(chan int)

	const workers = 4
	var wg sync.WaitGroup

	go producer(ctx, jobs, 100)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go worker(ctx, i, jobs, results, &wg)
	}
	go aggregator(results, done)

	wg.Wait()
	close(results)
	fmt.Println("sum =", <-done)
}
```

Key middle-level details: every send and receive sits inside a `select`
guarded by `ctx.Done()` to support cancellation; the producer is the sole
closer of `jobs`; the goroutine that closes `results` waits for *all*
workers via `wg.Wait()`.

### Erlang

```erlang
-module(worker_pool).
-export([start/0, producer/2, worker/2, aggregator/2]).

start() ->
    Agg = spawn(?MODULE, aggregator, [self(), 0]),
    Workers = [spawn(?MODULE, worker, [Agg, N]) || N <- lists:seq(1, 4)],
    spawn(?MODULE, producer, [Workers, 100]),
    receive
        {sum, S} -> io:format("sum = ~p~n", [S])
    after 5000 ->
        io:format("timeout~n")
    end.

producer(_Workers, 0) ->
    ok;
producer(Workers, N) ->
    W = lists:nth((N rem length(Workers)) + 1, Workers),
    W ! {job, N, rand:uniform(100)},
    timer:sleep(5),
    producer(Workers, N - 1).

worker(Agg, _Id) ->
    receive
        {job, Id, V} ->
            timer:sleep(rand:uniform(20)),
            Agg ! {result, Id, V * 2},
            worker(Agg, _Id);
        stop ->
            ok
    after 2000 ->
        Agg ! {result, -1, 0},
        ok
    end.

aggregator(Parent, Sum) ->
    receive
        {result, _, V} ->
            aggregator(Parent, Sum + V)
    after 1000 ->
        Parent ! {sum, Sum}
    end.
```

Erlang mailboxes are unbounded, so backpressure is a discipline. Here we
use `receive ... after` for both per-message timeout (worker) and
end-of-stream detection (aggregator).

### Rust with tokio mpsc

```rust
use rand::Rng;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::sleep;

#[derive(Debug)]
struct Job { id: u32, value: u32 }

#[derive(Debug)]
struct ResultMsg { _id: u32, output: u32 }

#[tokio::main]
async fn main() {
    let (jobs_tx, jobs_rx) = mpsc::channel::<Job>(16);
    let (results_tx, mut results_rx) = mpsc::channel::<ResultMsg>(16);

    // Producer
    tokio::spawn(async move {
        for i in 0..100 {
            let job = Job { id: i, value: rand::thread_rng().gen_range(0..100) };
            if jobs_tx.send(job).await.is_err() { return; }
        }
        // tx dropped here closes jobs channel
    });

    // Workers (MPSC: many workers share the receiver via Arc<Mutex<...>>)
    use std::sync::Arc;
    use tokio::sync::Mutex;
    let jobs_rx = Arc::new(Mutex::new(jobs_rx));
    let mut worker_handles = vec![];
    for _ in 0..4 {
        let rx = jobs_rx.clone();
        let tx = results_tx.clone();
        worker_handles.push(tokio::spawn(async move {
            loop {
                let job = { rx.lock().await.recv().await };
                match job {
                    Some(j) => {
                        let dur = rand::thread_rng().gen_range(0..20);
                        sleep(Duration::from_millis(dur)).await;
                        if tx.send(ResultMsg { _id: j.id, output: j.value * 2 }).await.is_err() {
                            return;
                        }
                    }
                    None => return,
                }
            }
        }));
    }
    drop(results_tx);

    // Aggregator
    let aggregator = tokio::spawn(async move {
        let mut sum = 0u64;
        while let Some(r) = results_rx.recv().await {
            sum += r.output as u64;
        }
        sum
    });

    for h in worker_handles { let _ = h.await; }
    let sum = aggregator.await.unwrap();
    println!("sum = {sum}");
}
```

Notes: `mpsc::channel(16)` is bounded — `send().await` is the backpressure
point. Tokio's mpsc is *single consumer*; sharing among workers needs an
`Arc<Mutex<Receiver>>`. For true MPMC use `async-channel` or
`flume`.

### Python with multiprocessing.Queue

```python
import multiprocessing as mp
import random
import time


def producer(jobs_q: mp.Queue, total: int) -> None:
    for i in range(total):
        jobs_q.put((i, random.randint(0, 100)))  # blocks if queue is full
    for _ in range(4):
        jobs_q.put(None)  # poison pill per worker


def worker(jobs_q: mp.Queue, results_q: mp.Queue) -> None:
    while True:
        item = jobs_q.get()
        if item is None:
            results_q.put(None)
            return
        job_id, value = item
        time.sleep(random.uniform(0, 0.02))
        results_q.put((job_id, value * 2))


def aggregator(results_q: mp.Queue, n_workers: int) -> int:
    total = 0
    sentinels = 0
    while sentinels < n_workers:
        item = results_q.get()
        if item is None:
            sentinels += 1
            continue
        total += item[1]
    return total


def main() -> None:
    jobs_q: mp.Queue = mp.Queue(maxsize=16)   # bounded
    results_q: mp.Queue = mp.Queue(maxsize=16)
    n_workers = 4

    workers = [mp.Process(target=worker, args=(jobs_q, results_q))
               for _ in range(n_workers)]
    for w in workers:
        w.start()

    prod = mp.Process(target=producer, args=(jobs_q, 100))
    prod.start()

    total = aggregator(results_q, n_workers)
    prod.join()
    for w in workers:
        w.join()
    print(f"sum = {total}")


if __name__ == "__main__":
    main()
```

`maxsize=16` is the bounded buffer. `jobs_q.put` blocks when full → that
*is* the backpressure. Poison pills, one per worker, are the
shutdown protocol.

### Java with BlockingQueue

```java
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

public class WorkerPool {
    record Job(int id, int value) {}
    record ResultMsg(int jobId, int output) {}
    private static final ResultMsg POISON_R = new ResultMsg(-1, 0);
    private static final Job POISON_J = new Job(-1, 0);

    public static void main(String[] args) throws Exception {
        BlockingQueue<Job> jobs = new ArrayBlockingQueue<>(16);
        BlockingQueue<ResultMsg> results = new ArrayBlockingQueue<>(16);
        int nWorkers = 4;

        try (var pool = Executors.newFixedThreadPool(nWorkers + 2)) {
            // producer
            pool.submit(() -> {
                try {
                    var rng = new java.util.Random();
                    for (int i = 0; i < 100; i++) {
                        jobs.put(new Job(i, rng.nextInt(100))); // backpressure
                    }
                    for (int i = 0; i < nWorkers; i++) jobs.put(POISON_J);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            // workers
            for (int w = 0; w < nWorkers; w++) {
                pool.submit(() -> {
                    var rng = new java.util.Random();
                    try {
                        while (true) {
                            Job j = jobs.take();
                            if (j == POISON_J) {
                                results.put(POISON_R);
                                return;
                            }
                            Thread.sleep(rng.nextInt(20));
                            results.put(new ResultMsg(j.id(), j.value() * 2));
                        }
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                });
            }

            // aggregator
            var sum = new AtomicLong();
            Future<Long> aggF = pool.submit(() -> {
                long s = 0;
                int sentinels = 0;
                while (sentinels < nWorkers) {
                    ResultMsg r = results.take();
                    if (r == POISON_R) { sentinels++; continue; }
                    s += r.output();
                }
                sum.set(s);
                return s;
            });

            System.out.println("sum = " + aggF.get(5, TimeUnit.SECONDS));
        }
    }
}
```

`ArrayBlockingQueue` is MPMC and bounded; `put` blocks (backpressure),
`offer(timeout)` would drop, `add` would throw. Poison pills work the
same way as in Python.

---

## Pros & Cons

| Aspect | Pro | Con |
|---|---|---|
| Bounded queues | Memory-safe, backpressure-friendly | Can deadlock if cycle forms |
| Unbounded queues | Producers never block | Heap-OOM under sustained overload |
| Select | Elegant timeouts, cancellation, multiplexing | Easy to introduce starvation through ordering |
| MPSC | Fast, easy to reason about | Single point of failure on the consumer |
| MPMC | Maximum flexibility | Hardest to reason about ordering and fairness |
| Synchronous (rendezvous) | Strong happens-before, simple | Throughput limited; both sides must rendezvous |
| Buffered | High throughput, decoupling | Hides latency until buffer drains |
| Poison pills | Simple shutdown protocol | Must be sent once per worker; easy to miscount |
| Done channel close | Broadcast cancellation in one line | Cannot be reused or re-opened |

---

## Use Cases

| Use case | Right tool | Why |
|---|---|---|
| Web request fan-out to backends | MPMC + scatter-gather | Many incoming requests, many backends |
| Log shipping | MPSC bounded with drop-oldest | Many producers, one writer, lossy is acceptable |
| Game server tick loop | SPSC ring buffer | Highest throughput, predictable latency |
| Pub-sub config updates | SPMC + broadcast | One writer, many readers |
| ETL pipeline | Series of bounded MPSC stages | Natural backpressure between stages |
| Distributed search | Scatter-gather | Query one shard each, combine top-K |
| Background jobs | MPMC durable queue (RabbitMQ, SQS) | Survive restarts, ack-based at-least-once |
| Real-time sensor stream | MPSC bounded with drop-newest | Latest sample matters more than completeness |

---

## Coding Patterns

### Pattern: Fan-out / Fan-in

```
Producer ---> [bounded jobs chan] ---> Worker 1 ---\
                                       Worker 2 -----> [results chan] ---> Aggregator
                                       Worker N ---/
```

Use when each input message is independent and CPU- or IO-bound. Bound
the jobs channel so the producer slows down rather than the heap growing.

### Pattern: Pipeline of stages

```
Source -> [chan] -> Parse -> [chan] -> Validate -> [chan] -> Persist -> Sink
```

Each stage runs independently, talks only through bounded channels.
Backpressure ripples upstream automatically. Failure of one stage
quiesces the rest.

### Pattern: Scatter-gather with timeout

```go
func query(ctx context.Context, backends []Backend) []Result {
    out := make(chan Result, len(backends))
    for _, b := range backends {
        go func(b Backend) {
            out <- b.Query(ctx)
        }(b)
    }
    var got []Result
    timer := time.After(200 * time.Millisecond)
    for i := 0; i < len(backends); i++ {
        select {
        case r := <-out:        got = append(got, r)
        case <-timer:           return got // partial result
        case <-ctx.Done():      return got
        }
    }
    return got
}
```

### Pattern: Done channel for cancellation

```go
done := make(chan struct{})
go worker(jobs, done)
// later:
close(done) // broadcast
```

### Pattern: Poison pill shutdown

Send one sentinel per worker on the jobs channel. Each worker exits when
it sees the sentinel. Works in any language where you can mark a message
as "stop."

### Pattern: Credit-based flow control

Receiver sends `Credits(n)` upstream. Producer maintains an int; each
data send decrements; on hitting zero, producer waits for more credits.
This is how gRPC streaming and HTTP/2 push back.

---

## Clean Code

```go
// GOOD: explicit capacities, documented closer.
//
// jobs is owned by producer; producer closes it.
// results is owned by the fan-in goroutine; it closes after wg.Wait.
jobs := make(chan Job, 64)
results := make(chan Result, 64)
```

```go
// BAD: silent unbounded growth, undocumented closer.
jobs := make(chan Job)
go func() {
    for j := range upstream {
        jobs <- j // who closes? when?
    }
}()
```

```go
// GOOD: every receive has a cancellation arm.
select {
case j := <-jobs:    handle(j)
case <-ctx.Done():   return ctx.Err()
}
```

```go
// BAD: silent deadlock waiting to happen.
j := <-jobs
handle(j)
```

```go
// GOOD: send under select, never a bare send.
select {
case out <- result:
case <-ctx.Done():
    return
}
```

```go
// BAD: bare send on a possibly-unreceived channel.
out <- result
```

---

## Best Practices

1. Make every channel bounded unless you can prove memory is not a risk.
2. Document who closes each channel — write it as a comment above the
   `make`.
3. Wrap every external receive in `select` with a timeout or a `done`
   channel.
4. Wrap every external send in `select` with the same cancellation arm.
5. Prefer `context.Context` (Go), `CancellationToken` (Rust),
   `Future.cancel` (Python), `Thread.interrupt` (Java) for cancellation
   propagation.
6. Use `sync.WaitGroup` (Go), `JoinSet` (tokio), `mp.Process.join` (Python),
   or `ExecutorService.awaitTermination` (Java) to know when all workers
   really stopped.
7. Match the channel type to the cardinality (MPSC vs SPSC) when the
   runtime offers a faster variant.
8. Keep messages small. Send pointers or IDs for large payloads.
9. Test under saturation, not just under normal load. The interesting
   behavior happens when the buffer is full.
10. Record metrics: queue depth, time spent in queue, drop count. These
    are the leading indicators of a sick pipeline.

---

## Edge Cases & Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Sending on closed channel | Panic in Go, exception in Java | Ensure single closer; close only after producer is done. |
| Closing a channel twice | Panic | Same as above. |
| Receiving from a closed channel | Zero value silently returned | Check `ok` second return; treat as "end of stream." |
| Goroutine blocked on send forever | Goroutine leak; memory grows | Pair every send with a `ctx.Done()` arm. |
| Buffer of size 1 used as a "flag" | Misuse; lost signals if missed | Use `done` channel + close, not a buffered send. |
| Select with mostly-ready channels | Other channels starved | Restructure with explicit priority. |
| Time.After leak in long loops | Timer goroutines accumulate | Use `time.NewTimer` and `Stop` it. |
| Erlang mailbox flooded | Process consumes all RAM | Apply explicit `mailbox_softlimit` or drop-pattern. |
| Tokio mpsc shared among many tasks | Wrong type — mpsc is single consumer | Use `async-channel` or `flume` for MPMC. |
| Python `Queue.put` deadlock at shutdown | Producer blocked while consumer joined | Use `put(timeout=...)` or shutdown sentinel first. |
| BlockingQueue `put` interrupt swallowed | Worker hangs on shutdown | Restore interrupt: `Thread.currentThread().interrupt()`. |

---

## Common Mistakes

1. Using an unbounded channel and discovering at 3 a.m. that "memory is
   high."
2. Forgetting that closing a channel does not flush in-flight messages —
   the receiver still drains the buffer first.
3. Believing a buffered send is "delivered." It is only buffered.
4. Catching cancellation only on receive, not on send. The producer
   blocks forever if the consumer left.
5. One global `done` channel for unrelated concerns. Use per-purpose
   channels.
6. Treating `select` cases as ordered. They are not — order is randomized
   in Go. Build priority explicitly.
7. Re-using a closed channel. Channels are single-use; allocate a fresh
   one.
8. Sending huge structs by value when a pointer would do.
9. Mixing data messages and control messages on the same channel. Split
   them.
10. Building a queue on top of a queue ("just-in-case buffer") that
    multiplies the lag without anyone noticing.

---

## Tricky Points

- A select with only nil channels and no `default` blocks forever; that
  is sometimes the desired behavior (used as "park this goroutine").
- Setting a channel variable to `nil` inside a select disables that case
  on the next iteration — a common pattern for "stop accepting on this
  channel."
- Closing a `done` channel is observable by any number of receivers, but
  closing a `jobs` channel is observable as "end of stream" plus
  remaining buffered messages.
- In Erlang, sending to a dead process is silent; the runtime does not
  fail. Use links or monitors to learn about peer death.
- In Rust, dropping the last `Sender` of an mpsc closes the receiver
  side. This is the idiomatic shutdown.
- In Java, `LinkedBlockingQueue` is unbounded by default; use the
  capacity constructor.
- In Python multiprocessing, queue ordering across processes is preserved
  only within a single producer/consumer pair.

---

## Test Yourself

1. You have one producer at 1000 msg/s and four workers that each handle
   200 msg/s. What is the steady-state queue depth with an unbounded
   queue? With a bounded queue of 100?
2. Why is `select` randomized in Go? What problem would a deterministic
   order cause?
3. Sketch how you would implement at-least-once delivery on top of an
   at-most-once channel.
4. When would you prefer credit-based flow control to block-on-full?
5. What goes wrong if two goroutines both try to close the same channel?
6. How does a poison pill shutdown differ from closing the channel? When
   do you choose each?
7. Implement a fan-in that merges two channels into one, fairly.
8. A long-running select loop has a `time.After` arm. Why might it leak
   memory? How do you fix it?
9. Why is an unbuffered channel sometimes called a "rendezvous" channel?
   What guarantee does it give that a buffered channel does not?
10. Describe scatter-gather with a 200 ms deadline. What does the caller
    do with partial results?

---

## Tricky Questions

1. **Q:** Can you implement a mutex with a buffered channel of capacity 1?
   **A:** Yes. Send a token to acquire, receive to release. The buffer
   ensures non-blocking acquire when free; capacity 1 ensures mutual
   exclusion. It is slower than a real mutex but instructive.

2. **Q:** If a Go select has both a ready receive and a ready timeout, who
   wins?
   **A:** Pseudo-random choice among ready cases. Both are ready; one of
   them is picked uniformly. This is why prioritized logic must use
   nested selects.

3. **Q:** A worker pool of N workers shares a single jobs channel. Is
   message ordering preserved?
   **A:** Not end-to-end. Each worker processes in arrival order from its
   side, but two workers can re-order any two adjacent messages because
   one may finish faster. For per-key ordering, hash to a per-worker
   channel.

4. **Q:** Why is "exactly-once" considered impossible in distributed
   systems but routine inside a single process?
   **A:** Inside one process, both ends agree on memory and on death.
   Across machines, you cannot distinguish "message lost" from "ack
   lost," so retries are needed, and retries imply duplicates unless you
   add de-duplication.

5. **Q:** A buffered channel of size 16 hits a full state for one minute,
   then drains. What is the cost?
   **A:** During that minute the producer was blocked, so the upstream of
   the producer also experienced backpressure. The "free" buffer hid a
   minute of latency from the consumer's viewpoint — bursts smaller than
   16 messages were absorbed transparently, larger bursts created
   producer-side blocking.

6. **Q:** Why does the Go runtime allow `close(nil)` to panic instead of
   silently doing nothing?
   **A:** Closing nil almost certainly indicates a logic bug — a channel
   that should have been initialized was not, or the closer code was
   reached twice. Crashing surfaces the bug instead of hiding it.

7. **Q:** Your aggregator hangs. How do you diagnose whether it is the
   aggregator, the workers, or the producer?
   **A:** Print queue depths. If `jobs` is full, the producer is fine and
   the workers are slow. If `jobs` is empty and `results` is full, the
   workers are fine and the aggregator is slow. If both are empty, the
   producer is slow or stuck.

8. **Q:** Can closing a channel be used to broadcast a value?
   **A:** No. Closing broadcasts only "the channel is closed." It cannot
   carry a value. To broadcast a value, send it before closing, or use
   `sync.Cond`, `Notify`, or a published atomic.

9. **Q:** Why do many actor frameworks drop messages silently when an
   actor crashes?
   **A:** Because there is no consistent place to store undelivered
   messages without designing a durable mailbox. The pragmatic answer
   pushes durability up to the application — supervision plus retries
   plus idempotent handlers.

10. **Q:** What is the difference between `time.After` and a dedicated
    `time.NewTimer().C` in a long-running select?
    **A:** `time.After` allocates a fresh timer each call; in a hot loop
    these accumulate until they fire. `NewTimer` lets you `Reset` and
    `Stop` the timer, keeping allocation bounded.

---

## Cheat Sheet

```
Decision table
--------------
need backpressure        ? bounded queue, block on full
need bounded memory      ? bounded queue, drop on full
need many writers, 1 reader ? MPSC
need 1 writer, many readers ? SPMC or broadcast channel
need many writers, many readers ? MPMC
need to stop everyone    ? close a done channel
need to drain known count? close the data channel and range
need to time-out         ? select with time.After / receive-after / sleep arm
need to merge streams    ? select reading from N inputs; nil out drained ones
need to broadcast        ? close a signal channel, or pub/sub
need ordering per key    ? hash to per-key worker
need exactly-once        ? at-least-once + dedup table

Sizing rule of thumb
--------------------
buffer >= peak burst length you must absorb without producer blocking
buffer * msg-size      <= memory you can afford if buffer fills

Channel ownership
-----------------
- Producer owns -> producer closes
- One sender, many receivers -> sender owns
- Many senders, one receiver -> agree on a coordinator that closes
- Never close from receiver side
- Never close twice
```

---

## Summary

Middle-level message passing is about turning the junior-level mental
model into production-grade pipelines. The two new ideas are
**boundedness** and **select**. Boundedness gives you backpressure
without heap growth; select gives you timeouts, cancellation, fan-in,
and prioritized inputs. Combine them and you can express almost every
realistic concurrency shape: worker pools, pipelines, scatter-gather,
broadcast, and credit flow.

The recurring discipline is: name every channel's capacity, owner,
closer, and delivery guarantee out loud. The recurring bug is failing to
do so. The recurring tool is `select`. The recurring instinct is "if
this channel fills, what then?" If you can answer that question for
every queue in your design, you have stepped from junior to middle.

---

## What You Can Build

- A bounded worker pool with metrics for queue depth, drop count, and
  per-worker throughput.
- A multi-stage ETL pipeline with backpressure between stages.
- A scatter-gather query layer over N backends with a deadline and
  partial results.
- A pub-sub bus with a broadcast channel and per-subscriber bounded
  mailboxes.
- A rate-limited HTTP proxy using credit-based flow control.
- A distributed task queue client that wraps an at-least-once broker
  with idempotency keys.
- A WebSocket fan-out server pushing updates from one source to N
  clients.
- A telemetry aggregator that drops oldest samples under overload.
- A graceful-shutdown manager built on a single closed `done`
  channel.
- A Kafka-like single-partition append log with one writer and many
  bounded readers.

---

## Further Reading

- Rob Pike, *Concurrency is not parallelism* — the original framing of
  goroutines + channels.
- Sameer Ajmani, *Go concurrency patterns: pipelines and cancellation*.
- Joe Armstrong, *Programming Erlang* — chapters on receive, after,
  links, and monitors.
- Carl Hewitt, *Actor Model of Computation* — for the philosophical
  background.
- *The Tao of Go Channels* (Dave Cheney) — channel closing rules.
- Tokio documentation, *Channels* section — practical bounded mpsc and
  backpressure.
- Doug Lea, *Concurrent Programming in Java* — chapters on
  BlockingQueue.
- Reactive Streams specification — for credit-based flow control done
  rigorously.
- Martin Thompson on LMAX Disruptor — SPSC ring buffer engineering.
- Marc Brooker, *It's about time* — clocks, timeouts, and message
  passing.

---

## Related Topics

- [Junior level](junior.md) — the foundations of mailbox, send, receive.
- [Senior level](senior.md) — distributed message passing, brokers,
  exactly-once semantics.
- [Professional level](professional.md) — formal models, CAP, end-to-end
  arguments.
- [Interview preparation](interview.md) — common message-passing
  questions and patterns.
- [Tasks](tasks.md) — exercises to drill the middle-level patterns.
- [Actor model — middle](../03-actor-model/middle.md)
- [CSP — middle](../04-csp/middle.md)
- [Channels primitive — middle](../../02-primitives/05-channels/middle.md)
- [Fan-in / fan-out pattern — middle](../../03-patterns/03-fan-in-fan-out/middle.md)

---

## Diagrams & Visual Aids

### Bounded buffer with backpressure

```
Producer ----send----> [ . . . . . . . . . . ] ----recv----> Consumer
                       ^ capacity = 10 ^
                       (full -> producer blocks)
```

### Fan-out / fan-in

```
                       +--> Worker 1 --+
                       |               |
Producer --[jobs]----->+--> Worker 2 --+--[results]--> Aggregator
                       |               |
                       +--> Worker N --+
       bounded                          bounded
```

### Scatter-gather with timeout

```
                  +--> Backend A --+
                  |                |
Client --query--->+--> Backend B --+--> select { reply | timeout }
                  |                |
                  +--> Backend C --+

deadline = 200ms ; reply with whatever arrived
```

### Credit-based flow control

```
Consumer --grant(10)----> Producer
Producer --msg---------> Consumer    [credit = 9]
Producer --msg---------> Consumer    [credit = 8]
       ...
Producer --msg---------> Consumer    [credit = 0]  -- producer stops
Consumer --grant(10)----> Producer   [credit = 10] -- producer resumes
```

### Pipeline of bounded stages

```
[Source] --bounded--> [Parse] --bounded--> [Validate] --bounded--> [Sink]

backpressure propagates upstream:
  Sink slows ==> Validate stage blocks on send ==>
    Parse stage blocks ==> Source rate drops
```

### Goroutine leak shape (anti-pattern)

```
Producer (vanished, did not close jobs)
                                          jobs (open, no senders)
                                            \
                                             v
                                          Worker: <- jobs  [blocked forever]
                                          Worker: <- jobs  [blocked forever]
```

### Done channel as broadcast cancellation

```
done (chan struct{})
   |
   close(done)
   |
   +---> Worker 1 sees <-done, returns
   +---> Worker 2 sees <-done, returns
   +---> Worker N sees <-done, returns
```

### Select arms as event multiplexer

```
                +---- jobs    ----> handle(msg)
                |
goroutine --->  +---- ctx.Done() --> return
                |
                +---- timeout   --> handle_timeout()
                |
                +---- control   --> reconfigure()

"wake me for whichever fires first, dispatch to its arm"
```
