# CSP Model — Junior Level

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
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "What is CSP, where did Go's channels come from, and how should I think when I write `ch <- v`?"

In 1978, Tony Hoare — already famous for inventing Quicksort and contributing to ALGOL — published a paper called *Communicating Sequential Processes* (CSP). The idea was simple, radical, and durable: design concurrent systems as a network of independent sequential processes that interact only by sending messages over channels. Each process is single-threaded inside; the only way it communicates is by writing to a channel another process reads, or by reading a channel another process writes. There is no shared mutable state. Synchronisation is implicit in the channel operations.

Go's concurrency model is a direct descendant of CSP. The `go` keyword spawns a process (here called a goroutine). Channels are first-class values. Sending and receiving on a channel is the way goroutines communicate. The Go authors — Rob Pike, Ken Thompson, Robert Griesemer — explicitly cite CSP, Squeak (Pike's own earlier language), and Newsqueak as influences.

The slogan you will hear repeatedly: **"Do not communicate by sharing memory; share memory by communicating."** Most concurrency in C, C++, Java, and Python pre-2010 is shared-memory with locks: many threads, one piece of shared state, mutexes to prevent simultaneous access. CSP inverts this: many processes, no shared state, communication via messages. Sharing happens by passing ownership over a channel, not by simultaneous access to a shared variable.

After reading this file you will:

- Know what CSP is and where Go's channels descend from.
- Recognise the "share memory by communicating" idiom in code.
- Write basic goroutine + channel programs and understand them as CSP.
- Distinguish CSP from the actor model and from threads-with-locks.
- See why CSP encourages ownership-passing designs.
- Recognise the limits of CSP (it does not solve all concurrency problems).

You do not need to read Hoare's original paper for this level (though it is worth doing later — it is short and lucid). You do not need formal process algebra. You need an intuition for "process = goroutine, channel = mailbox, message = ownership transfer."

---

## Prerequisites

- **Required:** Familiarity with goroutines: how to spawn one with `go`, how `sync.WaitGroup` joins them. See [01-what-is-concurrency](../01-what-is-concurrency/) and [01-goroutines](../../01-goroutines/) if you need a refresher.
- **Required:** Basic Go syntax: declaring channels, sending and receiving.
- **Required:** Comfort with function values and closures.
- **Helpful:** Awareness of shared-memory concurrency from other languages (Java's `synchronized`, C++'s `std::mutex`).
- **Helpful:** Exposure to actor-model languages like Erlang or Akka. The contrast clarifies CSP.

---

## Glossary

| Term | Definition |
|------|-----------|
| **CSP** | Communicating Sequential Processes. The formal model of concurrent computation introduced by Tony Hoare (1978). |
| **Process** (CSP) | An independent sequential execution unit. In Go: a goroutine. |
| **Channel** (CSP) | A typed conduit for passing values between processes. Sending and receiving synchronise the two processes involved. |
| **Synchronous channel** | A channel where send and receive happen at the same instant; the sender blocks until a receiver is ready, and vice versa. |
| **Asynchronous channel** | A channel with a buffer; the sender can deposit a value and continue, the receiver can take it later. Go's buffered channels. |
| **Share memory by communicating** | The CSP doctrine that goroutines should exchange ownership of data via channel messages rather than concurrently accessing a shared variable. |
| **Actor model** | A different concurrency model (Hewitt 1973) in which each actor has an identity and a mailbox; actors send messages to specific other actors. Erlang's model. |
| **Process algebra** | A family of mathematical formalisms for describing and reasoning about concurrent systems. CSP is one; CCS (Milner) and π-calculus (Milner) are others. |
| **Deadlock** | A state where all processes are waiting on each other and none can proceed. CSP is famously deadlock-prone if not designed carefully. |
| **Livelock** | A state where processes keep doing work but make no progress (e.g., yielding to each other forever). |
| **Goroutine** | Go's lightweight process abstraction, started with `go`. The CSP "process" in Go's terminology. |
| **`chan T`** | Go's channel type. Unbuffered by default; buffered with `make(chan T, N)`. |
| **`select`** | Go's mechanism for waiting on multiple channel operations at once. Corresponds to CSP's "external choice" operator. |

---

## Core Concepts

### A CSP process is a sequential program

Each process in CSP is a normal, single-threaded program. It reads inputs, computes, sends outputs. The internal logic is sequential — variables, loops, function calls. The *concurrency* in CSP comes from running multiple such processes in parallel, not from anything fancy inside one process.

In Go: each goroutine is a sequential function. The fact that ten goroutines run "at the same time" makes the system concurrent. Inside any one goroutine, the code is plain sequential Go.

### Communication = synchronisation

In pure CSP, channels are *synchronous*. A send on a channel does not return until a receiver picks the value up. The two processes meet at the channel; the message transfer is atomic with the rendezvous.

This is exactly Go's unbuffered channel:

```go
ch := make(chan int)

go func() {
    ch <- 42 // blocks until someone receives
}()

v := <-ch // blocks until someone sends; receives 42
```

Both goroutines pause until the rendezvous. Then both proceed.

Buffered channels relax this: a send into a non-full buffer returns immediately; a receive from a non-empty buffer returns immediately. This is *not* pure CSP — it is closer to an asynchronous message queue — but it is a useful pragmatic addition.

### No shared mutable state

The pure CSP discipline: a process owns its local variables. To share data with another process, it sends a message. After sending, the data conceptually belongs to the receiver. The sender does not touch it again.

In Go this is a *convention*, not a rule the language enforces. You can write code that mutates a shared `*Foo` after sending it on a channel, and the compiler will not stop you. The race detector might catch it. CSP discipline says: don't.

### "Share memory by communicating"

Rob Pike's slogan distils CSP for Go programmers. Instead of:

```go
// Shared-memory style
var counter int
var mu sync.Mutex
go func() {
    mu.Lock()
    counter++
    mu.Unlock()
}()
```

write:

```go
// CSP style
counts := make(chan int)
go func() {
    counts <- 1
}()
total := <-counts
```

The first uses a mutex to guard concurrent access. The second uses a channel to pass the value. In trivial examples the CSP version looks more verbose, but at scale it eliminates entire classes of bugs (race conditions, lock ordering, double-locks). It also makes ownership explicit: "I send X to you; now X is yours."

That said: CSP is not always the right answer. A counter that is incremented from many goroutines is fine with a mutex or atomic; channelling it adds overhead. Use CSP when it clarifies ownership; use mutexes when it does not.

### `select` is CSP's choice operator

CSP has a "choice" operator: a process waits on multiple events and proceeds with whichever fires first. Go's `select` is the direct translation:

```go
select {
case v := <-ch1:
    handle(v)
case ch2 <- result:
    // sent
case <-time.After(time.Second):
    return errors.New("timeout")
}
```

The Go select randomly picks one ready case (or blocks until any is). This corresponds to CSP's "external choice" operator (`P □ Q`), the heart of process composition.

---

## Real-World Analogies

### The kitchen with serving hatches

Imagine a kitchen split into rooms — meat station, salad station, plating station — separated by walls with serving hatches. Each station has its own chef. When the meat chef finishes a steak, they put it through the hatch to the plater. The chef does not walk into the plating room and arrange the plate themselves. Each station is sequential inside; communication happens only through hatches.

That is CSP. Each chef is a process; each hatch is a channel. The dish "belongs" to whichever room it currently sits in. No one reaches across.

### The relay race

In a relay race, each runner is sequential — they run their lane. The baton is the message. The handoff is the synchronisation point: both runners must be at the same place at the same moment. After the handoff, the baton belongs to the new runner; the previous one steps off the track.

That is a synchronous CSP channel: rendezvous at the handoff, ownership transfer, both runners move forward independently.

### Email vs phone call

A phone call is *synchronous*: both parties must be on the line at the same time. CSP's unbuffered channel.

Email is *asynchronous*: the sender deposits a message and continues. The receiver picks it up later. Go's buffered channel (capacity matters: a one-message buffer is like email with strict storage limit; large buffers are like a mailbox).

Both have their place. CSP purists prefer phone calls because they enforce synchronisation. Pragmatic Go programmers often use small buffers (1) to decouple sender and receiver.

### Assembly line

A factory assembly line is CSP par excellence. Each station performs one operation, then passes the partially assembled product to the next station. Stations work in parallel; each is sequential internally. The conveyor belt between stations is the channel. The product moving down the belt is ownership transfer.

---

## Mental Models

### Model 1: "Hand the ball off, do not share the ball"

Every time you have data that more than one goroutine touches, ask: can I instead pass it from one to the other? If so, the data is *owned* by exactly one goroutine at a time. Lock-free, race-free, by construction.

### Model 2: "Goroutine = role, channel = message bus"

Think of your program as a network of roles. The "reader" reads from disk; the "decoder" decodes bytes; the "validator" validates entries; the "writer" writes to DB. Each role is a goroutine. Between them flow messages on channels. The data structure of your program *is* this network.

### Model 3: "Synchronous channels are appointments, buffered are mailboxes"

An appointment requires both parties present. A mailbox lets you drop off and continue. Use appointments when you want lockstep coordination; use mailboxes when you want decoupling.

### Model 4: "Channels are types, not just plumbing"

A `chan int` is a type. A function can take one as a parameter. A struct can contain one. This means channels participate in interfaces, in documentation, in type checking. They are not a side effect; they are part of your program's structure.

```go
type RequestQueue struct {
    Incoming <-chan Request
    Done     chan<- struct{}
}
```

Read-only channel for `Incoming`, write-only for `Done` — encoded in the type. The compiler enforces direction.

---

## Pros & Cons

### Pros

- **Race-free by construction.** If you genuinely pass ownership and never mutate after sending, you cannot have data races.
- **Clear ownership.** Who owns the data? Whoever holds it most recently received from a channel.
- **Composable.** Pipelines, fan-out, fan-in compose naturally. CSP processes are a small algebra.
- **Decouples producers and consumers.** Each only knows the channel, not the other's identity.
- **Easy to reason about locally.** A goroutine's behaviour is determined by what it reads from and writes to. No global state.

### Cons

- **Overhead.** Channel operations are slower than mutex operations or atomic operations. For hot paths, this matters.
- **Deadlock-prone.** CSP-style designs can deadlock if channels are wired incorrectly (sender waits for receiver who waits for sender). No language-level deadlock detection in Go.
- **Channels are not the answer for everything.** Protecting a single shared variable is better with a mutex.
- **Buffer sizing is hard.** Too small = back-pressure stalls; too large = OOM under burst.
- **Closing semantics surprise beginners.** Closing a channel signals end-of-stream; closing twice panics; sending on closed panics.

---

## Use Cases

| Scenario | Why CSP fits |
|---|---|
| Pipeline of independent stages | Each stage is a process; channels carry intermediate results. |
| Fan-out to workers | Producer sends jobs on one channel; many workers read from the same channel. |
| Fan-in from sources | Multiple producers write to one channel; one consumer aggregates. |
| Cancellation and timeouts | `select` on a `done` channel cleanly stops a goroutine. |
| Event distribution | A goroutine waits on incoming events from many sources via `select`. |
| Producer-consumer with backpressure | Unbuffered channel naturally pauses the producer when the consumer is slow. |
| Pipeline with stages running at different rates | Buffered channels absorb burst at fast stages. |

| Scenario | Why CSP might *not* fit |
|---|---|
| Protecting a single shared variable | Mutex or atomic is simpler and faster. |
| Read-mostly cache | RWMutex or `sync.Map` is more efficient. |
| Many writers, one final aggregator | Reducer pattern with `sync.WaitGroup` and a final reduce. |
| In-process pub-sub with N subscribers | Channels do not natively fan out to many subscribers; build a broker. |

---

## Code Examples

### Example 1: First CSP-style program

```go
package main

import "fmt"

func main() {
    ch := make(chan string)

    go func() {
        ch <- "hello from goroutine"
    }()

    msg := <-ch
    fmt.Println(msg)
}
```

Two goroutines (main + spawned). One channel. Send and receive rendezvous. Synchronisation is implicit.

### Example 2: Pipeline

```go
package main

import "fmt"

func generate() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 10; i++ {
            out <- i
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func main() {
    for v := range square(generate()) {
        fmt.Println(v)
    }
}
```

Three goroutines: generator, squarer, main consumer. Two channels. Each is a sequential program inside.

### Example 3: Fan-out

```go
func fanOut(jobs <-chan Job, workers int) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                process(j)
            }
        }()
    }
    wg.Wait()
}
```

One channel, many consumers. Each job goes to exactly one worker. The runtime picks who.

### Example 4: Fan-in

```go
func fanIn(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range a {
            out <- v
        }
    }()
    go func() {
        for v := range b {
            out <- v
        }
    }()
    return out
}
```

Two channels merged into one. (Note: this version leaks if `a` and `b` are not both closed; in production, use `select` and proper cancellation.)

### Example 5: `select` for choice

```go
func multiplex(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            select {
            case v, ok := <-a:
                if !ok { a = nil; continue }
                out <- v
            case v, ok := <-b:
                if !ok { b = nil; continue }
                out <- v
            }
            if a == nil && b == nil { return }
        }
    }()
    return out
}
```

Either channel can fire. When one closes, set it to `nil` so `select` ignores it. When both are closed, exit.

### Example 6: Synchronous handoff (ownership transfer)

```go
type Order struct {
    ID    string
    Items []string
}

func main() {
    orders := make(chan *Order) // unbuffered
    go processOrders(orders)
    
    o := &Order{ID: "A1", Items: []string{"apple"}}
    orders <- o
    // After sending, do not touch o anymore — the processor owns it
    
    close(orders)
}

func processOrders(orders <-chan *Order) {
    for o := range orders {
        o.Items = append(o.Items, "banana") // safe — we own o
        fmt.Println(o)
    }
}
```

The unbuffered channel makes ownership transfer explicit: the sender blocks until the receiver takes the value. After the rendezvous, the receiver is responsible for the data.

### Example 7: Timeout via `select`

```go
func fetch(ctx context.Context, url string) (string, error) {
    result := make(chan string, 1)
    go func() {
        result <- httpGet(url)
    }()
    select {
    case r := <-result:
        return r, nil
    case <-ctx.Done():
        return "", ctx.Err()
    }
}
```

Note the buffer of 1: if the timeout fires, the spawned goroutine still tries to send its result. The buffer prevents it from blocking forever.

### Example 8: Done channel

```go
func ticker(done <-chan struct{}) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            fmt.Println("tick")
        case <-done:
            return
        }
    }
}
```

A `chan struct{}` carries no value — only the signal of "now." Closing it broadcasts to all waiting goroutines.

---

## Coding Patterns

### Pattern 1: Pipeline

Multiple stages, each a goroutine connected by channels. The previous file's examples illustrate this. Always close output channels when done; always have a path for cancellation.

### Pattern 2: Worker pool

One job channel, N workers, one result channel. Bound concurrency. See examples in [01-what-is-concurrency](../01-what-is-concurrency/).

### Pattern 3: Generator function

A function that returns a `<-chan T` (read-only channel). The function spawns a goroutine that produces values and closes the channel when done. The caller ranges over the channel.

```go
func count(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            out <- i
        }
    }()
    return out
}
```

The returned channel encapsulates the producer's lifetime: when the channel closes, the producer is done.

### Pattern 4: Done / cancellation channel

Pass a `<-chan struct{}` to every long-running goroutine. The owner closes it to signal stop. Modern Go uses `context.Context` for the same purpose, with extra goodies (deadlines, values).

### Pattern 5: Quit, error, value tuple via select

```go
type result struct {
    val int
    err error
}
out := make(chan result, 1)
go func() {
    v, err := compute()
    out <- result{v, err}
}()
select {
case r := <-out:
    use(r.val, r.err)
case <-ctx.Done():
    cancel()
}
```

---

## Clean Code

- **Document channel ownership.** "The producer closes `out`. Consumers do not close." A simple comment prevents an entire class of panics.
- **Prefer directional channel types in APIs.** `<-chan T` (read-only) and `chan<- T` (write-only) communicate intent.
- **Use small buffer sizes on purpose.** A buffer of 1 says "single-slot decoupling." A buffer of 100 says "burst absorption." A buffer of 1 000 000 says "memory leak waiting to happen."
- **Close once, on the sender side.** Closing a channel signals "no more values." Receivers see the close via `v, ok := <-ch` (ok is false). Senders should not close from outside.
- **Use `range` over channels when possible.** Cleaner than `for { select { ... } }` if you only need to consume until close.

---

## Product Use / Feature

| Feature | CSP implementation |
|---|---|
| Order processing pipeline | Reader → validator → enricher → writer, each a goroutine, connected by channels. |
| Event bus | Subscribers read from per-topic channels; publishers send. |
| Background email sender | Queue channel filled by API handlers; worker goroutines consume. |
| Rate limiter | Token-bucket goroutine produces tokens at fixed rate on a channel; consumers receive a token before proceeding. |
| Streaming response | Goroutine pushes chunks onto a channel; HTTP handler reads and writes to response. |
| Cancellation propagation | `done` or `context.Context` flows through every channel, terminating cascaded work. |

---

## Error Handling

CSP-style code passes errors as messages, like any other value. Common idioms:

### Pass an `error` along with the value

```go
type Result struct {
    Value Output
    Err   error
}
out := make(chan Result, 1)
go func() {
    v, err := op()
    out <- Result{v, err}
}()
r := <-out
if r.Err != nil { return r.Err }
```

### Dedicated error channel

```go
errCh := make(chan error, 1)
go func() {
    if err := op(); err != nil {
        errCh <- err
        return
    }
}()
```

### `select` over both

```go
select {
case v := <-out:
    use(v)
case err := <-errCh:
    handle(err)
}
```

For pipelines, every stage should be able to emit errors. `errgroup` (covered in middle sections) is the structured tool.

---

## Security Considerations

- **Unbounded buffers can OOM.** A `make(chan T, 1_000_000)` is a million-message memory commitment. Bound buffers to expected burst.
- **Closing channels from untrusted code is dangerous.** Closing a channel twice panics; closing one being read by a third party causes errors. Restrict closing to the channel's owner.
- **Channels carry pointers.** Sending a `*Foo` transfers a reference. If the sender mutates `*Foo` after sending, the receiver sees a moving target — a subtle race.
- **Goroutine leaks via channels** are common security holes: a request handler that spawns a goroutine waiting on a never-closed channel holds memory and possibly sensitive data for the program's lifetime.

---

## Performance Tips

- **Unbuffered channels are slower than buffered (1) channels for one-shot transfer.** Each direction has to find the other; the runtime parks/unparks goroutines.
- **For many concurrent senders, buffered channels absorb burst.** Size the buffer to expected burst, not to infinity.
- **Channel operations are a few hundred nanoseconds each.** Faster than a mutex on contended state, slower than an atomic on uncontended state.
- **For hot paths with millions of items per second, prefer atomics or sharded state.** Channels do not scale to that rate.
- **Closed channels make `<-ch` return immediately with zero value.** Useful for fast cancellation broadcasts.

---

## Best Practices

1. Design as a network of goroutines and channels; draw it on paper.
2. Document who owns each channel and who closes it.
3. Prefer directional channel types in function signatures.
4. Use `select` with `ctx.Done()` for cancellation in every long-running goroutine.
5. Use buffered channels with care; size them to the expected concurrency, not "just in case."
6. Run `go test -race` to catch shared-state mistakes that betray the CSP discipline.
7. Use `errgroup` for structured concurrency with error propagation.
8. Treat goroutines as expensive resources you can lose track of — handle their lifetimes deliberately.
9. Stop passing values through channels when a function call would do.
10. Stop using channels to protect single shared variables — use a mutex.

---

## Edge Cases & Pitfalls

### Sending on a closed channel panics

```go
close(ch)
ch <- 1 // PANIC: send on closed channel
```

Always close from the sender side, and ensure no further sends.

### Closing a closed channel panics

```go
close(ch)
close(ch) // PANIC
```

Use `sync.Once` if you have multiple potential closers, or restructure so only one closes.

### Reading from a closed channel returns zero value forever

```go
close(ch)
v := <-ch // v is zero value, no block
v, ok := <-ch // ok is false
```

Useful for broadcast: closing signals all receivers that no more values are coming.

### Sending to a nil channel blocks forever

```go
var ch chan int
ch <- 1 // blocks forever
<-ch // blocks forever
```

Used intentionally in `select` to "disable" a case.

### Select on all nil channels blocks forever

```go
select {} // forever
```

Used as a way to make a goroutine wait indefinitely. Better to use `<-ctx.Done()` for cancellation.

### Unbuffered channel + same goroutine deadlocks

```go
ch := make(chan int)
ch <- 1   // deadlock: no receiver
v := <-ch
```

Send and receive on an unbuffered channel must be from different goroutines.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Closing from the receiver side | Only the sender (or the channel's designated owner) closes. |
| Closing a channel multiple times | Use `sync.Once` or a single-owner pattern. |
| Sending on a closed channel | Coordinate with the sender to avoid sends after close. |
| Buffer size set to "infinity" | Bound the buffer; understand the failure mode. |
| Channels for trivial shared state | Use a mutex or atomic for simple shared variables. |
| Forgetting `select` with cancellation | Every long-running goroutine must respect cancellation. |

---

## Common Misconceptions

> *"CSP requires synchronous channels."* — Hoare's original CSP did. Go's channels include both synchronous (unbuffered) and asynchronous (buffered). Both are CSP-ish; the spirit is "communicate, do not share."

> *"CSP is the only right way."* — No. Mutexes and atomics are also legitimate in Go. CSP is one model; pick the right tool for each problem.

> *"Channels are faster than mutexes."* — Usually slower. Channels carry more semantics (synchronisation, ownership transfer, possible scheduling); the cost reflects that.

> *"All Go concurrency is CSP."* — The `sync` package is shared-memory concurrency. The `crypto/rand` package uses thread-locals. Go is multi-paradigm.

> *"Pure CSP forbids buffered channels."* — Hoare's CSP did. Go pragmatically added buffers. Most production Go uses them.

> *"Channels prevent deadlock."* — They prevent certain races. They are highly prone to deadlock (sender waiting for receiver waiting for sender). Design carefully.

---

## Tricky Points

### Receive from a closed channel does not panic

```go
close(ch)
v, ok := <-ch // v = zero value, ok = false
```

This is the *intended* behaviour — used as broadcast.

### `range` over a channel exits on close

```go
for v := range ch {
    use(v)
}
// loop ends when ch is closed
```

If `ch` is never closed, the loop runs forever.

### A `nil` channel in `select` is silent

```go
var done chan struct{}
select {
case <-done:    // never fires because done is nil
case <-other:
    handle()
}
```

This is sometimes useful: set `done = nil` to "disable" a case dynamically.

### Send on a buffered channel is sometimes synchronous

If the buffer is full, the send blocks until a receive drains a slot. So `make(chan int, 1)` is synchronous after the first send, until consumed.

---

## Test

```go
package csp_test

import (
    "testing"
)

func TestPipeline(t *testing.T) {
    out := generate()
    out2 := square(out)
    var sum int
    for v := range out2 {
        sum += v
    }
    expected := 0
    for i := 1; i <= 10; i++ {
        expected += i * i
    }
    if sum != expected {
        t.Fatalf("expected %d, got %d", expected, sum)
    }
}

func generate() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 10; i++ {
            out <- i
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}
```

---

## Tricky Questions

**Q.** What is the difference between CSP and the actor model?

**A.** CSP has anonymous channels; processes do not have identities, they just read and write channels. The actor model has named actors with mailboxes; senders address messages to specific actors. CSP is "send through the channel, anyone listening picks up"; actors are "send to actor X, only X picks up." Erlang is actors; Go is CSP.

---

**Q.** Why does Go include buffered channels if Hoare's CSP did not?

**A.** Practicality. Synchronous-only channels make many patterns awkward (single-slot decoupling, burst absorption). Go's authors chose to support both and to leave the discipline to the programmer.

---

**Q.** What's wrong with this code?

```go
ch := make(chan int, 1)
ch <- 1
ch <- 2 // deadlock?
```

**A.** Yes, deadlock. The buffer holds 1; the second send blocks until a receive. There is no receiver, so the program is stuck. Go's runtime detects this and panics "all goroutines are asleep — deadlock."

---

**Q.** Why do we say a closed channel "broadcasts"?

**A.** Because *every* receive on a closed channel returns immediately with the zero value. If many goroutines are blocked on `<-done`, closing `done` releases all of them simultaneously. No other primitive achieves this fan-out so easily.

---

**Q.** Is the following code CSP-style?

```go
go func() {
    counter.Add(1)
}()
```

**A.** Not really. It uses shared mutable state (`counter`). It happens to be safe if `counter.Add` is atomic, but the design is shared-memory, not CSP. A CSP-style version would send the increment as a message to a counter-owning goroutine.

---

## Cheat Sheet

```go
// Unbuffered channel: synchronous rendezvous
ch := make(chan int)

// Buffered channel: asynchronous with bounded buffer
ch := make(chan int, 16)

// Send
ch <- v

// Receive
v := <-ch
v, ok := <-ch // ok = false if closed

// Close (sender side)
close(ch)

// Range until close
for v := range ch { ... }

// Multi-channel wait
select {
case v := <-a:    handle(v)
case b <- x:      // sent
case <-time.After(t): // timeout
default:          // non-blocking
}

// Directional types
func produce() <-chan T
func consume(<-chan T)
func push(chan<- T)

// Nil channel disables a select case
var ch chan int // nil
```

---

## Self-Assessment Checklist

- [ ] I can explain CSP in one sentence to a non-Go programmer.
- [ ] I understand the slogan "share memory by communicating."
- [ ] I know the difference between unbuffered and buffered channels.
- [ ] I can write a three-stage pipeline using goroutines and channels.
- [ ] I know when to use a channel and when to use a mutex.
- [ ] I have used `select` with at least three cases including a timeout or cancellation.
- [ ] I can describe ownership transfer via channel send.
- [ ] I know the difference between CSP and the actor model.
- [ ] I know what happens when you send on a closed channel.
- [ ] I have read Hoare's CSP abstract or summary.

---

## Summary

CSP is the theoretical model behind Go's channels. Independent sequential processes communicate by passing messages through channels, with no shared mutable state. Synchronisation is implicit in the channel operations.

Go's pragmatic version adds buffered channels and does not enforce ownership transfer at the type level. The discipline — "share memory by communicating" — is convention, not constraint. Used well, it produces concurrent code that is race-free by construction and clearly structured around data flow.

CSP is not the only model in Go. The `sync` package and `sync/atomic` give you shared-memory primitives. Pick CSP where ownership and dataflow are central; pick shared-memory where you need to protect a simple shared variable. The mature Go programmer uses both.

The next pages (middle, senior) deepen this — how CSP's algebra translates to real Go patterns, how to design with CSP discipline, and where the formal CSP literature can sharpen your thinking.

---

## What You Can Build

- A three-stage data processing pipeline (read / transform / write) using only channels.
- A bounded worker pool with `chan struct{}` semaphore.
- A pub/sub event bus where subscribers read from per-topic channels.
- A rate limiter as a goroutine producing tokens onto a channel.
- A cancellation-aware HTTP handler that fans out to multiple backends.
- A simple CSP-style state machine where state transitions are channel messages.

---

## Further Reading

- C. A. R. Hoare, *Communicating Sequential Processes*, CACM 21(8), 1978. The original paper. <https://www.cs.cmu.edu/~crary/819-f09/Hoare78.pdf>
- C. A. R. Hoare, *Communicating Sequential Processes*, Prentice-Hall, 1985. The book version.
- Rob Pike, *Concurrency is not Parallelism*: <https://go.dev/blog/waza-talk>
- Rob Pike, *Share Memory By Communicating*: <https://go.dev/blog/codelab-share>
- Sameer Ajmani, *Go Concurrency Patterns: Pipelines and cancellation*: <https://go.dev/blog/pipelines>
- *Effective Go* — Concurrency: <https://go.dev/doc/effective_go#concurrency>

---

## Related Topics

- [01-what-is-concurrency](../01-what-is-concurrency/) — the broader concurrency framing.
- [03-go-runtime-gmp](../03-go-runtime-gmp/) — what runs the goroutines under the hood.
- [04-memory-model](../04-memory-model/) — happens-before via channel operations.
- Channels and `select` (later sections of this Roadmap).

---

## Diagrams & Visual Aids

### CSP processes and channels

```
+--------+      ch1     +-----------+      ch2     +----------+
| Reader | -----------> | Processor | -----------> |  Writer  |
+--------+              +-----------+              +----------+
   (G1)                     (G2)                       (G3)
```

Three goroutines, two channels, three independent sequential programs.

### Synchronous handoff

```
Goroutine A:  ... ch <- v          [block until B is ready] ... continue ...
                              \   /
                               meet
                              /   \
Goroutine B:  ... v := <-ch        [block until A sends]    ... continue ...
```

### Buffered channel

```
Producer  --> [|x|x|x| ] --> Consumer
             buffer (cap=4)

Producer fills the buffer; blocks only when full.
Consumer drains; blocks only when empty.
```

### Select as choice

```
select {
case <-a:        ----+
case <-b:        ----+--> whichever is ready first
case <-timeout:  ----+
}
```

### CSP vs Actor

```
CSP (Go):                       Actor (Erlang):
  G1 -> ch -> G2                 A ! msg, B               // A sends msg to B
  channel is anonymous           actors have identities
  G1 does not address G2         A explicitly addresses B
```

### Ownership via channel

```
Goroutine A         Goroutine B
+--+                +--+
|d |  -- send -->   |  |
|a |                |d |
|t |                |a |
|a |                |t |
+--+                |a |
                    +--+
A owned d before send; B owns d after receive.
```
