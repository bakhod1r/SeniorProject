# Channels — Junior Level

> **Topic:** [Channels](README.md)
> **Focus:** send/recv, buffered/unbuffered, close

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

A channel is a typed pipe between concurrent units of work. One side sends a value into it, the other side receives that value out of it. Nothing more, nothing less. That single idea — a typed pipe with send and receive — is enough to build pipelines, worker pools, cancellation systems, request/response protocols, and most of the patterns you will ever need in a concurrent program.

Channels come from a 1978 paper by Tony Hoare called *Communicating Sequential Processes* (CSP). The core philosophy of CSP is this: instead of sharing memory and protecting it with locks, give each process its own memory and let them communicate by passing messages through anonymous channels. Hoare did not invent the queue — queues existed since the beginning of computing. What he formalized was that the channel itself, not the processes attached to it, should be the addressable thing. You do not send a message *to* a process; you send it *into* a channel, and whoever is listening receives it.

Go is the language that made channels famous. The `chan T` type is a first-class language construct, with `<-` as the send/receive operator and `close` as a built-in. Rust has `std::sync::mpsc` in its standard library and `tokio::sync::mpsc` for async code. Clojure ships `core.async` as a library that adds CSP-style channels with `chan`, `>!`, `<!`, and `go` blocks. Python's closest equivalent is `asyncio.Queue` for async code and `queue.Queue` for threaded code. Java has no native channel type but `LinkedBlockingQueue` and `SynchronousQueue` cover the same use cases.

At junior level you need to internalize four things: how a send pairs with a receive, the difference between buffered and unbuffered channels, what closing means and who is allowed to do it, and the small handful of mistakes that cause 90% of channel bugs. Once those click, you have the foundation for every higher-level pattern.

---

## Prerequisites

Before reading this, you should be comfortable with:

- **Goroutines, threads, or async tasks.** A channel is meaningless without two concurrent units of work using it. You should know how to spawn a goroutine with `go f()`, a thread with `std::thread::spawn`, or an async task with `tokio::spawn` / `asyncio.create_task`.
- **Blocking vs non-blocking calls.** Channels block by default. If you do not understand what blocking means at the OS or runtime level, channel behavior will feel mysterious.
- **Basic generics or type parameters.** A channel is always parameterized by the type of value it carries: `chan int`, `Sender<String>`, `Queue[bytes]`. You should be at ease reading these signatures.
- **Mutexes and shared-memory synchronization.** You do not need mastery, but you should know what a mutex is and why two threads writing to the same variable without one is a bug. Channels are the alternative to that style.
- **The CSP model in broad strokes.** Read [CSP model](../../01-models/04-csp/junior.md) first if the phrase "communicating sequential processes" means nothing to you.

If you can write a "hello from another thread" program in your language of choice, you are ready.

---

## Glossary

- **Channel** — a typed conduit between concurrent units of work. Holds zero or more values in transit. Has two operations: send and receive.
- **Send** — placing a value into a channel. May block if the channel cannot accept the value right now. In Go: `ch <- v`. In Rust: `tx.send(v)`. In Python: `await q.put(v)`.
- **Receive** — taking a value out of a channel. May block if no value is available. In Go: `v := <-ch`. In Rust: `rx.recv()`. In Python: `v = await q.get()`.
- **Buffered channel** — a channel with internal storage of capacity N. Sends succeed without blocking as long as fewer than N values are in flight; receives succeed without blocking as long as at least one value is present.
- **Unbuffered channel** — a channel with capacity zero. Every send must meet a receive before either side proceeds.
- **Rendezvous** — the meeting point at which an unbuffered send and receive complete simultaneously. The defining behavior of CSP channels.
- **Close** — marking a channel as "no more values will ever arrive". A signal, not a deallocation. Closed channels can still be received from until drained.
- **Range** — iterating a channel until it is closed and drained. In Go: `for v := range ch`. In Rust: `for v in rx`. In Python: `async for v in queue_iter`.
- **Select** — choosing among multiple channel operations, executing whichever becomes ready first. In Go: `select { ... }`. In Rust: the `tokio::select!` macro. In Clojure: `alts!`.
- **Direction type** — a restricted channel reference that can only send or only receive. In Go: `chan<- T` is send-only, `<-chan T` is receive-only.
- **Sender / Receiver halves** — in Rust, a channel splits into a `Sender<T>` (clone-able producer side) and a `Receiver<T>` (single-consumer side). The pair together is the channel.
- **MPSC** — multi-producer, single-consumer. The default channel shape in Rust's standard library and in Tokio.
- **Goroutine leak** — a goroutine that is permanently blocked on a channel that will never satisfy it. The garbage collector cannot reclaim it. The canonical channel bug.

---

## Core Concepts

### 1. A channel is a typed pipe with send and receive

This is the entire definition. Picture a pipe with a value-shaped hole at each end. One end accepts values of a specific type. The other end emits them in the same order they were sent. Everything else is detail.

```go
ch := make(chan int) // a pipe that carries ints
ch <- 7              // send 7 into the pipe
v := <-ch            // receive a value out of the pipe (v == 7)
```

The type matters: `chan int` and `chan string` are different types and cannot be mixed. This is the single biggest improvement over hand-rolled queues: the compiler enforces what flows through the pipe.

### 2. Unbuffered channels are a rendezvous

When you write `make(chan int)` with no second argument, you get an unbuffered channel. Its capacity is zero. There is no storage inside it. A send cannot complete until a receive is waiting on the other side, and vice versa.

```go
ch := make(chan int)
go func() {
    ch <- 7 // blocks here until somebody receives
}()
v := <-ch // unblocks the sender and binds v == 7
```

This is called a rendezvous because both sides have to show up at the same time. It is the purest form of CSP. The channel is not a buffer; it is a synchronization point that happens to carry a value.

Why does this matter? Because rendezvous gives you a guarantee that no other primitive does: when the receive returns, you know the sender has reached the line *after* `ch <- 7`. The two goroutines are momentarily in lockstep. That is a powerful synchronization tool.

### 3. Buffered channels are bounded queues

When you write `make(chan int, 5)`, you get a channel that holds up to five integers internally. Sends do not block until the buffer is full. Receives do not block until the buffer is empty.

```go
ch := make(chan int, 2)
ch <- 1 // does not block — buffer now [1]
ch <- 2 // does not block — buffer now [1,2]
ch <- 3 // blocks — buffer is full
```

A buffered channel is a thread-safe queue with one extra feature: it blocks instead of returning an error when the queue is full or empty. That blocking is the whole point. It is what makes a channel a coordination tool instead of a data structure.

Pick the buffer size deliberately. Capacity 1 is a "one-slot mailbox". Capacity N is a "rate-smoothing buffer" — it lets a fast producer get N values ahead of a slow consumer before being forced to wait. Unbounded capacity does not exist in Go; if you need it, you are no longer in channel territory.

### 4. Close is a broadcast

Closing a channel is a one-way action: after `close(ch)`, no more values can ever be sent on it. Any receive that runs after the buffer is drained returns the zero value of the channel's type along with a `false` flag indicating the channel is closed.

```go
ch := make(chan int, 2)
ch <- 10
ch <- 20
close(ch)

v, ok := <-ch // v == 10, ok == true
v, ok = <-ch  // v == 20, ok == true
v, ok = <-ch  // v == 0,  ok == false
```

This makes `close` a broadcast signal: every goroutine receiving from the channel observes the closure, no matter how many of them there are. That is why `for v := range ch` is the idiomatic way to consume a channel — the loop terminates automatically the first time `ok` is false.

### 5. Send to a closed channel panics

Closing is final. After `close(ch)`, any send on `ch` crashes the program with `send on closed channel`. There is no way to undo a close. There is no way to check at the call site whether the channel is already closed without racing with whoever might close it next.

This leads to the most important rule in Go channel design: **the sender closes the channel, not the receiver**. If two goroutines could possibly send on the same channel, then *neither* of them can safely close it — you need a coordinator above them both. Ignore this rule and you will write `panic: send on closed channel` bugs forever.

### 6. Direction types restrict misuse

Go lets you constrain a channel reference at function boundaries:

```go
func producer(out chan<- int) { /* can only send */ }
func consumer(in <-chan int)  { /* can only receive */ }
```

This is not just documentation. The compiler enforces it. A `chan<- int` cannot be received from; a `<-chan int` cannot be sent on or closed. Use these in every function signature that takes a channel. They are free correctness.

### 7. The classic first mistakes

Almost every junior makes the same five mistakes. Memorize them now:

- **Forgot to close.** A consumer using `for v := range ch` waits forever because the producer never calls `close`. Goroutine leaked.
- **Double close.** Two goroutines decide they own the channel and both call `close`. The second call panics.
- **Send on closed.** The producer keeps sending after the consumer has signaled "stop" by closing the channel. Panic.
- **Receive on nil channel.** `var ch chan int` (no `make`) blocks forever on both send and receive. The runtime gives no error.
- **Leak from blocked send.** Producer sends, consumer disappears, send blocks forever, goroutine never exits.

Every channel bug you will ever debug is one of these five. When something goes wrong, run through the list.

### 8. The first patterns

You can build a great deal with three patterns:

- **Producer/consumer** — one goroutine sends, another receives. The simplest possible channel use.
- **Pipeline** — chain multiple stages, each reading from the previous channel and writing to the next.
- **Fan-in** — many producers, one channel, one consumer. The consumer multiplexes work from several sources.

We will show all three in the [Code Examples](#code-examples) section.

---

## Real-World Analogies

### The conveyor belt

A factory has a conveyor belt running between two stations. Worker A drops finished parts onto the belt. Worker B picks them up at the other end. The belt itself has a fixed length — that is the channel's buffer capacity. If A produces too fast, the belt fills up and A has to wait for B to clear space. If B is faster than A, B stands idle staring at an empty belt until the next part rolls in.

When the shift ends, A flips a switch that says "no more parts coming". B keeps picking up whatever is still on the belt until it is empty, then goes home. That switch is `close`. Notice that only A can flip it — B has no business declaring the shift over.

### The mail slot

A door has a mail slot. Slip a letter through, somebody on the other side picks it up. If the slot has a basket behind it (buffered), letters accumulate. If it is a pass-through with a person standing right there (unbuffered), you cannot drop a letter unless someone is on the other side to take it. You stand there holding the envelope until they show up.

### The kitchen pass

In a restaurant, the kitchen pass is the counter where chefs put completed dishes for servers to collect. The pass has limited space — maybe six plates. A chef calls "hot food" and slides a plate forward. A server picks it up and runs it to a table. If six plates pile up and no server comes, the chef stops cooking — there is no place to put the next dish. If servers stand at the pass with no food coming, they wait.

At the end of service, the head chef calls "close the pass". No more dishes will be sent. The servers clear whatever remains and the kitchen shuts down. A chef trying to send out another dish after the pass is closed gets yelled at — that is the panic.

---

## Mental Models

**Model 1: A channel is a synchronization tool that happens to carry a value.** Stop thinking of it as a queue. Think of it as a handshake. The value is incidental — you could carry empty `struct{}{}` and the channel would still be useful for "wait until I'm done". The value-carrying is a bonus.

**Model 2: Unbuffered means "we meet now". Buffered means "leave it here, I'll get to it".** This single distinction predicts all blocking behavior. Unbuffered = appointment. Buffered = mailbox.

**Model 3: Close is a tombstone, not a delete.** Closing does not free the channel. It does not empty the buffer. It marks the channel as "no future sends". Receivers can keep draining it until empty.

**Model 4: Ownership of close belongs to whoever owns the writes.** A receiver never closes a channel. Two senders cannot both close. There is always exactly one entity that "owns the closing" and that entity must be the unique sender or a coordinator above all senders.

**Model 5: Every channel needs a clear path to "no more work".** If you cannot answer the question "when and how does the goroutine reading from this channel exit?", you have a leak waiting to happen. The answer is almost always "when the channel is closed and drained".

---

## Code Examples

### Example 1: Go — producer/consumer with an unbuffered channel

```go
package main

import (
    "fmt"
    "time"
)

func producer(out chan<- int) {
    defer close(out) // producer owns the close
    for i := 1; i <= 5; i++ {
        fmt.Println("producing", i)
        out <- i
        time.Sleep(100 * time.Millisecond)
    }
}

func consumer(in <-chan int, done chan<- struct{}) {
    for v := range in {
        fmt.Println("consumed", v)
    }
    done <- struct{}{}
}

func main() {
    ch := make(chan int)
    done := make(chan struct{})

    go producer(ch)
    go consumer(ch, done)

    <-done
    fmt.Println("all work done")
}
```

Note three things. First, the producer holds the only send-side reference and uses `defer close(out)` to guarantee close runs even on panic. Second, the consumer's `for v := range in` loop exits cleanly when the channel closes — no boolean flag, no sentinel value, no extra check. Third, `done` is a separate channel used only as a "I have finished" signal; the value sent on it is meaningless (`struct{}{}` has zero size).

### Example 2: Go — a three-stage pipeline

```go
package main

import "fmt"

func generate(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            out <- n * n
        }
    }()
    return out
}

func sum(in <-chan int) int {
    total := 0
    for n := range in {
        total += n
    }
    return total
}

func main() {
    result := sum(square(generate(1, 2, 3, 4, 5)))
    fmt.Println("sum of squares:", result) // 55
}
```

Each stage launches a goroutine, owns its output channel, and closes it on exit. The pipeline's beauty is that you read the data flow left-to-right in the call expression and the close cascade flows the same direction. When `generate` finishes and closes its output, `square` exits its range loop and closes its output, and `sum` finishes and returns.

### Example 3: Go — buffered channel as a worker pool

```go
package main

import (
    "fmt"
    "sync"
)

func worker(id int, jobs <-chan int, results chan<- int, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        results <- j * 10
        fmt.Printf("worker %d handled %d\n", id, j)
    }
}

func main() {
    jobs := make(chan int, 5)
    results := make(chan int, 5)

    var wg sync.WaitGroup
    for w := 1; w <= 3; w++ {
        wg.Add(1)
        go worker(w, jobs, results, &wg)
    }

    for j := 1; j <= 5; j++ {
        jobs <- j
    }
    close(jobs)

    go func() {
        wg.Wait()
        close(results)
    }()

    for r := range results {
        fmt.Println("result:", r)
    }
}
```

The pattern here is non-obvious until you see it once: there are multiple senders on `results`, so no single worker can close it. Instead a coordinator goroutine waits for all workers to finish via `WaitGroup`, then closes `results` exactly once. The main goroutine ranges over `results` and exits naturally when the close cascade reaches it.

### Example 4: Rust — `std::sync::mpsc` between two threads

```rust
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn main() {
    let (tx, rx) = mpsc::channel::<i32>();

    let producer = thread::spawn(move || {
        for i in 1..=5 {
            println!("sending {i}");
            tx.send(i).unwrap();
            thread::sleep(Duration::from_millis(100));
        }
        // tx dropped here — receiver sees end-of-stream
    });

    for v in rx {
        println!("received {v}");
    }

    producer.join().unwrap();
}
```

Rust does not have an explicit `close` call. Instead, dropping the last `Sender` closes the channel. The `for v in rx` loop terminates when the producer thread exits and `tx` is dropped. This is a different ergonomic from Go but the underlying semantics are the same: a one-way signal that no more values are coming.

### Example 5: Tokio — async mpsc channel

```rust
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::channel::<String>(4);

    let producer = tokio::spawn(async move {
        for i in 0..5 {
            let msg = format!("event-{i}");
            tx.send(msg).await.unwrap();
        }
        // tx dropped at end of task
    });

    while let Some(msg) = rx.recv().await {
        println!("got {msg}");
    }

    producer.await.unwrap();
}
```

The shape is identical: bounded buffer (capacity 4), single receiver, send/recv operations that suspend instead of block the OS thread. The `while let Some(msg) = rx.recv().await` idiom replaces Go's `for v := range ch` and Rust's `for v in rx`.

### Example 6: Clojure — `core.async` channel

```clojure
(require '[clojure.core.async :as async :refer [chan go >! <! close!]])

(let [ch (chan 4)]
  (go
    (dotimes [i 5]
      (>! ch (str "item-" i)))
    (close! ch))
  (go
    (loop []
      (when-let [v (<! ch)]
        (println "received" v)
        (recur)))))
```

`chan` creates the channel, `>!` sends from within a `go` block, `<!` receives, `close!` closes. The `when-let` binds nil when the channel closes — that is Clojure's equivalent of `ok == false` in Go.

### Example 7: Python — `asyncio.Queue`

```python
import asyncio

async def producer(q: asyncio.Queue):
    for i in range(5):
        await q.put(i)
        print(f"produced {i}")
    await q.put(None)  # sentinel — Python's queue has no close

async def consumer(q: asyncio.Queue):
    while True:
        v = await q.get()
        if v is None:
            return
        print(f"consumed {v}")

async def main():
    q = asyncio.Queue(maxsize=4)
    await asyncio.gather(producer(q), consumer(q))

asyncio.run(main())
```

Python's `asyncio.Queue` is buffered, supports `put`/`get` with `await`, but does not have `close`. The idiom is to push a sentinel value (commonly `None`) and have the consumer treat it as end-of-stream. This sentinel approach is a footgun if your queue legitimately carries `None` values — in that case use a unique sentinel object.

---

## Pros & Cons

**Pros**

- **Type-safe.** The compiler knows the value type. You cannot send a string into a `chan int`.
- **No explicit locks.** Concurrent code reads like sequential code with messages instead of shared state.
- **Composable.** Channels compose with `select` / `tokio::select!` / `alts!` to wait on multiple sources at once.
- **Built-in backpressure.** A full buffered channel forces the producer to wait. A slow consumer cannot be drowned.
- **Cancellation is natural.** Close the channel and every consumer learns about it simultaneously.

**Cons**

- **Hidden blocking.** Every send and receive may block. If you forget that, you write deadlocks.
- **Easy to leak goroutines.** A goroutine blocked on a channel nobody will satisfy is invisible until your process runs out of memory.
- **Close ownership is fragile.** The "only the sender closes" rule is simple in theory and fiddly in practice when there are many senders.
- **Slower than a mutex for tiny critical sections.** A channel send/receive is several hundred nanoseconds; an atomic load is a handful.
- **No native broadcast.** A value sent on a channel is received by exactly one receiver. To broadcast you close, or use a different primitive.

---

## Use Cases

- **Producer/consumer.** One goroutine produces work items, others consume them. The textbook channel use case.
- **Pipelines.** Chain transformations through stages connected by channels. Each stage owns its output channel.
- **Worker pools.** A bounded set of workers reads jobs from one channel and writes results to another.
- **Fan-in.** Merging many input streams into a single output stream.
- **Fan-out.** Distributing work from a single source to many parallel handlers.
- **Cancellation propagation.** Closing a `done` channel signals every goroutine watching it to stop.
- **Rate limiting.** A channel of capacity N can act as a token bucket — acquire a token by sending, release by receiving.
- **Request/response.** Send a request that includes a reply channel; the server sends the response back on that reply channel.

---

## Coding Patterns

### Pattern 1: Producer owns the close

```go
func produce(out chan<- Item) {
    defer close(out)
    for _, item := range loadItems() {
        out <- item
    }
}
```

Every send-only function should close its output before returning. `defer close(out)` makes this bulletproof.

### Pattern 2: Range to drain

```go
for item := range ch {
    handle(item)
}
```

This is the only consumer loop you need 90% of the time. It exits when the channel is closed and drained.

### Pattern 3: Done channel for cancellation

```go
done := make(chan struct{})
go worker(done)
// ... later ...
close(done) // every goroutine watching `done` exits
```

A `chan struct{}` carries no data — it exists solely so close can broadcast.

### Pattern 4: Reply channel inside the request

```go
type Request struct {
    Input  int
    Reply  chan int
}

func server(reqs <-chan Request) {
    for r := range reqs {
        r.Reply <- compute(r.Input)
    }
}
```

The client allocates `Reply` per request, sends the request, then reads its reply. This pattern gives you correlated request/response over a single shared inbox.

### Pattern 5: Coordinator closes the shared output

```go
go func() {
    wg.Wait()
    close(results)
}()
```

When multiple goroutines write to one channel, none of them can close it. Spawn a separate goroutine whose only job is to wait for all writers and then call `close` exactly once.

---

## Clean Code

- **Name channels for what flows through them, not for the type.** `jobs`, `results`, `tickets`, `done`. Not `ch1`, `intChan`, `myChannel`.
- **Use direction types in every function signature.** `chan<- T` for senders, `<-chan T` for consumers. Free documentation, free compiler check.
- **Keep channel allocation close to its closure.** If you `make(chan T)` in function `F`, ideally `F` is also where you `close` it. When that is impossible, make the close ownership obvious in the function name (`runPipeline`, `startWorkers`).
- **Prefer `for v := range ch` over manual `<-ch` loops.** The range loop is shorter, exits cleanly, and is impossible to write incorrectly.
- **Use `chan struct{}` for signal-only channels.** It documents intent and uses zero bytes per value.
- **Wrap channel sends in helpers when the protocol is complex.** Do not let the rest of the codebase touch `ch <- ...` directly when the semantics are subtle.

---

## Best Practices

- **Decide channel ownership before you write the first line.** Sketch the producer-consumer graph on paper. Mark who closes each channel. If you cannot answer "who closes this?", redesign before coding.
- **Default to unbuffered.** Reach for a buffer only when you have a measured reason: rate smoothing, decoupling timing, avoiding a known starvation pattern. An unjustified buffer hides synchronization bugs by making them probabilistic.
- **Treat goroutine leaks as bugs of the same severity as memory leaks.** Both grow without bound and both crash the process. Add a way to shut down every long-running goroutine.
- **Wrap blocking operations with a timeout or cancellation case.** A bare `ch <- v` or `<-ch` should be rare in production. Use `select` with a `ctx.Done()` case.
- **Close channels eagerly when work is done.** Holding a producer reference longer than necessary delays consumer shutdown.
- **Document close ownership at the channel definition.** A one-line comment saying `// closed by producer goroutine` prevents future maintainers from breaking it.

---

## Edge Cases & Pitfalls

- **Receive from a nil channel blocks forever.** `var ch chan int; <-ch` deadlocks. Use this deliberately to disable a `select` case, never accidentally.
- **Send on a nil channel blocks forever.** Same story. Same use case (intentional `select` disabling).
- **Close on a nil channel panics.** Always check before calling `close` if there is any chance the variable is nil.
- **Double close panics.** Close is non-idempotent. Wrap in `sync.Once` if the same goroutine path can run twice.
- **A buffered channel can deadlock with itself.** If one goroutine writes to and reads from the same channel and the buffer fills up while no other goroutine is helping, it deadlocks.
- **`select` with no ready case and no default blocks forever.** This may be what you want; just be aware.
- **Closing a channel does not cancel sends already in progress.** A goroutine that has begun `ch <- v` and is blocked waiting for a receiver does not unblock when somebody else closes the channel. It panics.
- **Channels do not survive program exit.** All goroutines blocked on channels at `main` return are silently killed. Use `WaitGroup` or explicit done signaling to ensure clean shutdown.

---

## Common Mistakes

1. **Forgetting to close** when consumers use `for v := range ch`. Symptom: consumer hangs forever after producer finishes.
2. **Closing in the consumer** because it "felt natural". Symptom: panic when the producer next tries to send.
3. **Two senders, no coordinator**. Both goroutines try to close. One succeeds, the other panics. Or neither does and consumers hang.
4. **Sending on a channel after closing it**. Often happens in cleanup paths where `close` is followed by one last `ch <- value`.
5. **Receiving forever from a channel that someone else might be reading.** Two consumers on one channel each get *part* of the stream, not the whole stream. If you expected both to see everything, you need a different pattern (broadcast or fan-out).
6. **Using a channel where a mutex is simpler.** Wrapping every read of a counter in a `select` to get atomicity is theatre. Use `sync/atomic`.
7. **Buffered channel as an unbounded queue.** Picking capacity 10000 because "that should be enough" is exactly the bug a bounded channel was meant to prevent.
8. **Blocking the main goroutine on a channel that needs the main goroutine to run.** Classic deadlock: `main` sends on an unbuffered channel before spawning the consumer.

---

## Tricky Points

- **`close` on a channel makes future receives return the zero value, not the last value.** New juniors expect the channel to "remember" the last sent value forever. It does not. Drain it fully or you miss data.
- **`v, ok := <-ch` is how you tell an empty receive from a closed-channel receive.** `v` alone gives you the zero value either way. The `ok` boolean is the only reliable signal.
- **A `select` with an enabled default never blocks.** It immediately runs the default branch if no channel is ready. This makes it a poll, not a wait.
- **Receiving from a closed channel is non-blocking and always succeeds (with `ok == false`).** This is what makes a closed `done` channel a broadcast: every reader returns immediately.
- **`make(chan T, 0)` is the same as `make(chan T)`** — both unbuffered. There is no difference between "zero buffer" and "no buffer".
- **Capacity is fixed at creation.** You cannot grow or shrink a channel's buffer after `make`.
- **Channels have a sense of direction at runtime but no identity-based equality semantics.** `ch1 == ch2` is true only if they refer to the same underlying channel.

---

## Test Yourself

1. What is the difference between a buffered channel of capacity 1 and an unbuffered channel? Are there cases where they behave identically?
2. Who should close a channel: the sender or the receiver? Why?
3. What does `v, ok := <-ch` mean? When is `ok` false?
4. What happens when you send to a closed channel? Receive from a closed channel? Close a nil channel?
5. Write a function `merge(a, b <-chan int) <-chan int` that interleaves two input channels into one output channel. Make sure the output closes when both inputs have closed.
6. Why does `for v := range ch` not need an `ok` check?
7. What is a goroutine leak? Sketch a tiny program that leaks one.
8. When would you prefer a `sync.Mutex` over a channel for protecting shared state?

---

## Tricky Questions

- **If two goroutines both have references to a channel and both can send, which one should close it?** Neither. Without a coordinator above them, closing from either creates a race. Add a coordinator goroutine that uses `WaitGroup` to wait for both senders, then closes.
- **Can a channel be safely closed twice?** No. The second `close` panics. Use `sync.Once` if your control flow might call `close` more than once.
- **A goroutine blocked on `ch <- v` is then signaled that the work is no longer needed. How do you unblock it?** You cannot, with a bare send. You need a `select` around the send that watches a cancellation channel: `select { case ch <- v: case <-done: return }`.
- **What is the smallest amount of memory a `chan struct{}` send takes?** Effectively nothing. `struct{}` has zero size, and the channel itself does not copy a value through any buffer when the type is empty.
- **Why is `len(ch)` rarely useful?** Because the value is stale the moment you read it. Another goroutine may send or receive between your `len` call and your decision.
- **Range over a channel never returns the closed-channel sentinel value — what protects you from reading it?** The runtime stops the range loop before producing the zero-value-plus-`ok==false` pair. Range is sugar that handles the boundary for you.

---

## Cheat Sheet

```
SEND        ch <- v           may block if buffer full or no receiver
RECEIVE     v := <-ch         may block if buffer empty or no sender
TEST RECV   v, ok := <-ch     ok == false when ch is closed and drained
CLOSE       close(ch)         only the sender; never twice; never on nil
RANGE       for v := range ch terminates when ch is closed and drained
DIRECTION   chan<- T  send-only       <-chan T  receive-only

CAPACITY 0  rendezvous: every send pairs with a receive in lockstep
CAPACITY N  bounded queue: blocks only when full (send) or empty (recv)
NIL    CHAN forever-block on send and recv; panic on close
CLOSED CHAN recv returns zero value immediately; send panics

RULES
  - sender closes, never receiver
  - one closer per channel
  - default to unbuffered
  - prefer `for v := range ch` over `<-ch` loops
  - use chan struct{} for pure signals
  - watch every blocking op in a select with cancellation
```

---

## Summary

A channel is a typed pipe with two operations: send a value in, receive a value out. Unbuffered channels make every send wait for a matching receive — a rendezvous. Buffered channels add bounded internal storage that absorbs short bursts. Closing a channel signals that no more values will ever arrive, broadcasting that fact to every receiver. The rules are small but unforgiving: only the sender closes, never close twice, never send on closed, never block forever on a goroutine nobody will satisfy. Get those four right and channels become the easiest concurrency tool you will ever use. Get them wrong and you ship goroutine leaks and panics. The patterns built from channels — producer/consumer, pipeline, fan-in, worker pool, done-signal — are the bones of every concurrent program. Master the primitive and the patterns fall out for free.

---

## What You Can Build

- A **CSV ingester** with a producer reading rows, a pool of workers parsing them, and a consumer writing results.
- A **rate-limited HTTP client** using a channel of capacity N as a permit pool.
- A **fan-in log collector** that merges output from multiple goroutines into a single output stream.
- A **graceful shutdown system** using a `done` channel that every goroutine watches via `select`.
- A **request/response server** where each client request includes its own reply channel.
- A **three-stage pipeline** (read, transform, write) where each stage is a goroutine connected by channels.
- A **simple actor** built from a single goroutine and an input channel of command messages.

---

## Further Reading

- Tony Hoare, *Communicating Sequential Processes*, 1978 — the founding paper.
- Rob Pike, *Go Concurrency Patterns* (Google I/O 2012 talk) — the canonical introduction.
- Sameer Ajmani, *Advanced Go Concurrency Patterns* (Google I/O 2013) — `select`, cancellation, multiplexing.
- *The Go Programming Language* by Donovan and Kernighan, chapter 8 — book-quality treatment of channels.
- Rust documentation for `std::sync::mpsc` and `tokio::sync::mpsc`.
- *Clojure core.async* documentation and Rich Hickey's "Clojure core.async" talk.
- Python documentation for `asyncio.Queue` and the `queue` module.

---

## Related Topics

- [Channels — Middle Level](middle.md)
- [Channels — Senior Level](senior.md)
- [Channels — Professional Level](professional.md)
- [Channels — Interview](interview.md)
- [Channels — Tasks](tasks.md)
- [Mutex — Junior Level](../01-mutex/junior.md)
- [CSP Model — Junior Level](../../01-models/04-csp/junior.md)
- [Pipeline Pattern — Junior Level](../../03-patterns/05-pipeline/junior.md)

---

## Diagrams & Visual Aids

**Unbuffered channel — rendezvous**

```
goroutine A                   channel                   goroutine B
-----------                   -------                   -----------
ch <- 7   ----waiting---->    [empty]    <----waiting----  v := <-ch
              \                                       /
               \------ rendezvous: handoff -----------/
ch <- 7   done                                       v == 7
```

**Buffered channel — capacity 3**

```
producer                                            consumer
--------     +-----+-----+-----+                    --------
send 1 ----> |  1  |     |     |                    (idle)
send 2 ----> |  1  |  2  |     |
send 3 ----> |  1  |  2  |  3  |
send 4 -X    |  1  |  2  |  3  |   <-- buffer full, send blocks
                                    recv ----> 1
             |  2  |  3  |     |   <-- one slot freed, send 4 proceeds
send 4 ----> |  2  |  3  |  4  |
```

**Close as broadcast**

```
producer:  ... send last value ... close(ch)
                                       |
                +----------------------+----------------------+
                v                      v                      v
          consumer 1             consumer 2             consumer 3
          range exits            range exits            range exits
```

**Pipeline**

```
generate ---> [ch1] ---> square ---> [ch2] ---> sum ---> result
   close          close          close
   ch1            ch2            (returns)
```

**Worker pool**

```
                       +--> worker 1 ---+
producer --> [jobs] ---+--> worker 2 ---+--> [results] --> consumer
                       +--> worker 3 ---+
                                            ^
                       wg.Wait() then close-+
```

**Done-channel cancellation**

```
                  +-----------> goroutine A (watching done)
                  |
main --- close(done) -----+-----> goroutine B (watching done)
                  |
                  +-----------> goroutine C (watching done)

         one close --> N receivers all unblock
```
