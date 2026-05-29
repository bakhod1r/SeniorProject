# Communicating Sequential Processes (CSP) — Junior Level

> **Topic:** [CSP](README.md)
> **Focus:** channels, rendezvous, select

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

**Communicating Sequential Processes**, or CSP, is a way of thinking about
concurrent programs that was first written down by Tony Hoare in 1978. Hoare's
core idea was simple, and at the time radical: instead of letting many threads
share variables and protect them with locks, build your program out of small
**sequential processes** that do not share memory at all, and let them
**communicate** by sending values to each other through **channels**.

If you have written Go code, you have already used CSP. Go's `goroutine`
together with `chan` is a direct, modern incarnation of CSP. Other languages
have done the same — `occam` in the 1980s used CSP as its core execution
model, Clojure's `core.async` library brings CSP-style channels to the JVM,
Crystal has `spawn` and `Channel`, and Rust's `std::sync::mpsc` is a close
cousin (with some differences we will look at).

At the junior level, you do not need to read Hoare's paper or learn the formal
algebra. What you need is a working mental picture: a CSP program is a set of
small workers, and each worker spends its life **reading from channels,
computing, and writing to channels**. When two workers want to talk and one is
not ready, the other one waits — this is called a **rendezvous**. That single
idea, applied carefully, removes most of the bugs that locks and shared
variables tend to cause.

This document covers:

- What a process and a channel are in CSP terms.
- The synchronous rendezvous and how it differs from buffered channels.
- How CSP differs from the actor model and from raw message-passing.
- How to compose processes sequentially, in parallel, and via choice (the
  `select` / `alt` construct).
- The most common beginner mistakes: deadlock, forgetting to close, goroutine
  leaks, and sending without a receiver.

When you finish, you should be able to read and write basic Go concurrent code
with channels, recognise when a problem is a CSP problem, and explain the
"share memory by communicating" slogan without hand-waving.

---

## Prerequisites

Before you tackle CSP, you should already be comfortable with:

| Skill | Why it matters |
|---|---|
| Functions and loops in some language | CSP processes are just functions that loop. |
| The idea of a **thread** or **green thread** | A process in CSP runs on something like a thread. |
| Reading and writing to a queue / FIFO | A channel is conceptually a queue, but synchronous. |
| Basic Go syntax (or willingness to learn it) | Most examples here are in Go. |
| The notion of **blocking** vs **non-blocking** calls | Rendezvous is the canonical blocking call. |
| Why shared mutable state is hard | This motivates the whole CSP design. |

You do **not** need to know:

- Process algebra or the formal CSP operators (`->`, `[]`, `|||`).
- The FDR4 model checker.
- Locks, semaphores, or condition variables — CSP is the alternative to those.

If you have written code that uses `Thread`, `synchronized`, `Mutex`, or
`std::lock_guard`, you already know the pain CSP is trying to remove.

---

## Glossary

| Term | Definition |
|---|---|
| **Process** | A sequential thread of control that does not share memory with other processes; it only communicates via channels. In Go, a goroutine. |
| **Channel** | A typed, first-class conduit through which two processes exchange a value. Channels are anonymous: a process talks to "whoever is on the other end". |
| **Rendezvous** | The moment when a sender and a receiver meet at the same channel and the value is handed over atomically. With a synchronous channel, both sides block until the rendezvous happens. |
| **Synchronous channel** | A channel of capacity zero. Send and receive complete together; both sides see the value at the same logical instant. Go's `make(chan T)` produces this. |
| **Buffered channel** | A channel of capacity `n > 0`. Send completes as long as the buffer is not full; receive completes as long as the buffer is not empty. Go's `make(chan T, n)`. |
| **Select / Alt** | A construct that waits on several channel operations at once and proceeds with the first one that becomes ready. In Go it is `select`; in occam it is `ALT`; in Clojure it is `alt!`. |
| **Sequential composition** | `P ; Q` — run `P` to completion, then run `Q`. In Go this is just two statements one after the other. |
| **Parallel composition** | `P || Q` — run `P` and `Q` at the same time. In Go this is `go P()` next to `Q()`, or two `go` statements. |
| **Choice** | Picking one of several possible next actions based on which channel is ready. The CSP version of an `if`. |
| **Deadlock** | A state in which every process is waiting at a channel and no value can ever be exchanged. The classic CSP failure mode. |
| **Goroutine leak** | A Go-specific symptom of CSP misuse: a goroutine is blocked forever on a channel because no one will ever send or receive, so the runtime can never reclaim it. |
| **Close** | The operation that marks a channel as "no more values will ever be sent". Receivers can distinguish this from a normal value. |
| **Range over a channel** | A Go idiom: read every value a channel produces until it is closed. |

---

## Core Concepts

### Processes plus channels plus synchronous rendezvous

A CSP program is a set of independent sequential processes. Each process has
its own local state and runs its own control flow. Processes never read or
write each other's variables. The **only** way two processes affect each
other is by performing matched send and receive operations on a shared
channel.

In Go terms:

```go
ch := make(chan int) // a synchronous channel of ints

go func() {
    ch <- 42 // send: blocks until someone receives
}()

x := <-ch // receive: blocks until someone sends
```

The `<-` operator is the channel operation. The arrow points in the direction
the value flows. `ch <- 42` sends `42` *into* the channel; `<-ch` receives
*from* the channel.

Because the channel has capacity zero, the send statement does not complete
until the receive statement is also ready. The two statements together
constitute a **rendezvous**. Neither process needs to know who the other
process is — they only need to share the channel value.

### Channels as first-class values — address the conversation, not the conversant

This is the property that most clearly distinguishes CSP from the actor model.

In the actor model, you send a message to a **named actor**:
`alice.send(msg)`. Alice is the receiver, and `alice` is the address. You
must know who you are talking to.

In CSP, you send a message to a **channel**: `ch <- msg`. The channel is the
address. **Whoever is reading from `ch`** will receive the message. The
sender does not know — and does not need to know — who that is. This makes
processes easier to swap and reuse, because the relationship between sender
and receiver is mediated entirely by the channel.

Channels in Go (and in most modern CSP languages) are **first-class values**.
You can put a channel in a variable, pass it to a function, store it in a
struct, return it from a constructor, or send a channel **down another
channel**. The last trick is the basis for "reply channels", which we will
meet in the patterns section.

### Synchronous (unbuffered) vs buffered channels in Go terms

Pure CSP, as Hoare defined it, only has synchronous channels: the
rendezvous is the whole point. Most real-world implementations also offer
buffered channels because they are practically useful.

| Channel | Send blocks when… | Receive blocks when… | Rendezvous? |
|---|---|---|---|
| `make(chan T)` | Always, until a receiver shows up. | Always, until a sender shows up. | Yes — sender and receiver synchronise. |
| `make(chan T, n)` | The buffer holds `n` values already. | The buffer is empty. | No — buffer decouples the two sides. |

When you reach for a buffered channel, ask yourself: **why do I want the
sender to keep going without confirmation?** Good answers are "to absorb
short bursts" or "I have measured back-pressure and chosen a bound". Bad
answers are "to avoid a deadlock I do not understand". A buffered channel is
not a deadlock fix; it just postpones the symptom.

### Sequential composition, parallel composition, choice

CSP has three combinators for building bigger programs out of smaller ones.

- **Sequential** (`P ; Q`): run `P`, then run `Q`. In ordinary code this is
  just two statements in a row.
- **Parallel** (`P || Q`): run `P` and `Q` concurrently. They may
  interleave. In Go: `go P(); Q()` or two `go` statements followed by some
  synchronisation that waits for both to finish.
- **Choice** (`P [] Q`, or `select` / `ALT`): wait until either `P` or `Q`
  is ready to communicate, then execute whichever one fires first.

You can build any non-trivial concurrent program by combining these three.
The `select` statement deserves special attention because it lets a process
listen on several channels at once without dedicating one goroutine per
channel — this is the CSP answer to event loops.

### "Share memory by communicating"

The Go team turned this idea into a slogan:

> **Do not communicate by sharing memory; share memory by communicating.**

Rephrased: if two parts of your program need to coordinate, do not give them
a shared variable and a lock — give them a channel, and pass the data on the
channel. The data has a clear owner at every moment (whoever last received
it), and the **transfer of ownership is the synchronisation**. There is no
extra lock to forget.

This does not mean locks are wrong. They are still the right tool for
small, local protections like a counter or a cache. CSP scales especially
well at the **architecture** level — how the pieces of your program meet —
where locks tend to scale badly.

### Deadlock risk if no one is at the other end

The price of synchronous rendezvous is that it requires both sides. If you
send on a channel and nobody is currently or will ever be receiving, you
will block forever. If you receive and nobody will ever send, same thing.
In Go, the runtime can detect the degenerate case where **every** goroutine
is blocked and panics with "fatal error: all goroutines are asleep —
deadlock!", which is a wonderful safety net but only covers the
whole-program case. A single goroutine blocked forever on a channel,
while other goroutines do useful work, is a **leak**, and Go will not
warn you.

### Differences from the actor model

| Aspect | CSP | Actor Model |
|---|---|---|
| Addressing | The channel. | The actor (mailbox identity). |
| Coupling | Sender does not know who receives. | Sender must know whom to send to. |
| Default sync | Synchronous rendezvous. | Asynchronous send to mailbox. |
| Mailbox semantics | None; the channel is shared. | Each actor has its own private mailbox. |
| Common languages | Go, occam, Clojure core.async. | Erlang, Akka, Pony, Elixir. |
| Failure handling | Usually channel close + cancellation. | Supervisor trees, "let it crash". |

Neither model is universally better; they target different problem shapes.
CSP shines for **pipelines and choreography between known stages**; actors
shine for **named, long-lived entities** like user sessions or device
representations.

### Differences from raw message-passing

Raw message-passing (MPI, sockets, IPC queues) is more primitive: you
typically send to an address, and the runtime may copy or queue the bytes.
CSP adds:

- **Anonymous endpoints** — you talk to a channel, not an address.
- **Synchronous default** — you know the receiver got it.
- **First-class channels** — you can pass channels through channels.

If raw message-passing is "I drop a letter into a slot", CSP is "we both
have to show up at the table to exchange the letter".

### First mistakes

Every junior engineer hits the same set of problems. Knowing the names in
advance saves hours.

- **Forgetting to close a channel.** A `for value := range ch` loop never
  terminates if the channel is never closed.
- **Sending without a receiver.** A goroutine that writes to a channel
  with nobody reading will block forever.
- **Deadlock on unbuffered channel.** The classic: `ch <- v` before any
  goroutine starts to receive, all in one goroutine. Always send and
  receive in *different* goroutines, or use a buffered channel for the
  initial step.
- **Goroutine leak on early return.** Your function spawns a worker that
  writes results to a channel, then takes a fast exit path without
  draining the channel. The worker blocks on its send forever.
- **Closing a channel from the receiver side.** In Go, only the sender
  should close. Closing from the receiver, or closing twice, causes a
  panic.

---

## Real-World Analogies

| Analogy | What it captures |
|---|---|
| **Handing off a baton in a relay race.** Runner A cannot let go until Runner B has gripped it. | Synchronous rendezvous: both sides must be present, the value transfers atomically. |
| **Two people meeting at a doorway.** One holds the door, one walks through; if neither shows up, the other waits. | Symmetric blocking — neither side privileged. |
| **A drive-through window.** Cars queue (buffer); the cashier serves one at a time. If the queue fills, new cars must wait. | Buffered channel with bounded capacity. |
| **A whistle in a factory.** The whistle says "shift change!" — anyone listening reacts; the blower does not name them. | Anonymous broadcast via channel close. |
| **A waiter taking orders.** The kitchen does not call the customer; orders flow over the order-rail (the channel). | The channel decouples sender and receiver. |
| **A confession booth.** Whoever sits on the other side of the screen takes the message; the speaker does not see them. | Channel as anonymous endpoint. |
| **A telegraph operator.** The line is the channel; the operator and recipient must both be on the line at the right moment. | Rendezvous, and the cost of missed timing. |

---

## Mental Models

**Model 1: A factory floor.** Each process is a worker at a station. Between
stations there are conveyor belts (channels). A worker takes an item off
the incoming belt, transforms it, puts it on the outgoing belt. If the
outgoing belt is full (buffered), the worker pauses. If the incoming belt
is empty, the worker waits. The factory layout — who feeds whom — is your
program architecture.

**Model 2: Phone lines without phone numbers.** A channel is a phone line;
its endpoints are not named. Anyone holding a reference to the line can pick
up either end. Two parties can talk only when both are on the line at the
same time.

**Model 3: A whiteboard with a one-slot tray.** Two people share a tray that
holds zero or one note. To send, you must wait until the tray is empty and
the receiver is reaching for it. The receiver waits until the sender places
the note. The interaction is atomic — the note is never half-transferred.

**Model 4: Ownership transfer.** A value lives in one goroutine at a time.
The send-and-receive is the moment ownership moves. Nobody else can read
or write the value during the transfer, because nobody else has a
reference to it. This is why "share memory by communicating" works: the
channel is the synchronisation.

---

## Code Examples

### Example 1 — Go producer/consumer over an unbuffered channel

A producer emits numbers; a consumer prints them. They synchronise via an
unbuffered channel. The producer **closes** the channel when it is done so
the consumer's `for ... range` terminates.

```go
package main

import (
    "fmt"
    "sync"
)

func producer(out chan<- int) {
    defer close(out) // signal end-of-stream
    for i := 1; i <= 5; i++ {
        out <- i // blocks until consumer receives
    }
}

func consumer(in <-chan int, done chan<- struct{}) {
    defer close(done)
    for v := range in { // exits when in is closed
        fmt.Println("got", v)
    }
}

func main() {
    ch := make(chan int)
    done := make(chan struct{})

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        producer(ch)
    }()

    go consumer(ch, done)

    <-done // wait for consumer to drain
    wg.Wait()
    fmt.Println("done")
}
```

Notice three idioms that are worth committing to memory:

- `chan<- int` is a **send-only** channel; `<-chan int` is **receive-only**.
  Using directional channel types in function signatures documents intent
  and lets the compiler catch direction mistakes.
- The producer is the **owner** of the channel and is responsible for
  closing it. Never close from the consumer side.
- The consumer uses `for v := range in` so it does not have to write its own
  termination check.

### Example 2 — Go select over three channels

`select` waits on multiple channel operations and proceeds with whichever
becomes ready first. This is how a single goroutine can serve many sources.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    fast := make(chan string)
    slow := make(chan string)
    quit := make(chan struct{})

    go func() {
        time.Sleep(50 * time.Millisecond)
        fast <- "fast result"
    }()

    go func() {
        time.Sleep(500 * time.Millisecond)
        slow <- "slow result"
    }()

    go func() {
        time.Sleep(1 * time.Second)
        close(quit)
    }()

    for i := 0; i < 3; i++ {
        select {
        case msg := <-fast:
            fmt.Println("fast:", msg)
        case msg := <-slow:
            fmt.Println("slow:", msg)
        case <-quit:
            fmt.Println("quit signal")
            return
        case <-time.After(200 * time.Millisecond):
            fmt.Println("nothing in 200ms; tick")
        }
    }
}
```

Key things to notice:

- The `time.After` case is a built-in timeout. It returns a channel that
  fires after the given duration; if that case fires, none of the others
  did.
- A `select` with no ready cases blocks; with a `default:` case, it does
  not block — it just runs the default branch immediately.
- The order of cases does not imply priority. If multiple cases are ready,
  Go picks one **uniformly at random**.

### Example 3 — occam PAR construct

`occam` was the language for the Transputer chip in the 1980s. It is
historically important because it took CSP literally: parallel composition
is a keyword (`PAR`), and channels are the only way to communicate.

```occam
PROC producer (CHAN OF INT out)
  SEQ i = 1 FOR 5
    out ! i        -- "!" sends on a channel
:

PROC consumer (CHAN OF INT in)
  SEQ
    INT v:
    SEQ i = 1 FOR 5
      SEQ
        in ? v     -- "?" receives from a channel
        ...        -- use v
:

PROC main ()
  CHAN OF INT ch:
  PAR
    producer (ch)
    consumer (ch)
:
```

- `!` is send, `?` is receive — exactly Hoare's original syntax.
- `PAR` declares parallel composition: producer and consumer run together.
- `SEQ` declares sequential composition: statements run one after another.

The occam syntax makes CSP's three combinators explicit. Reading it once
is the fastest way to internalise them.

### Example 4 — Clojure core.async

Clojure's `core.async` library brings CSP-style channels and a `go` macro
to the JVM and ClojureScript.

```clojure
(require '[clojure.core.async :as a
           :refer [go chan >! <! alt! timeout close!]])

(defn producer [out]
  (go
    (doseq [i (range 1 6)]
      (>! out i))      ; ">!" is "park-send"
    (close! out)))

(defn consumer [in]
  (go-loop []
    (when-let [v (<! in)] ; nil means closed
      (println "got" v)
      (recur))))

(let [ch (chan)]
  (producer ch)
  (consumer ch))

;; choice with timeout
(let [a (chan) b (chan)]
  (go (>! a :hello))
  (go
    (alt!
      a   ([v] (println "a:" v))
      b   ([v] (println "b:" v))
      (timeout 100) (println "nothing in 100ms"))))
```

- `>!` and `<!` are the "parking" send and receive — they look blocking but
  cooperate with Clojure's lightweight `go` blocks rather than tying up a
  thread.
- `alt!` is the CSP choice operator.
- `(close! ch)` is the equivalent of Go's `close(ch)`; subsequent `<!` returns
  `nil`.

---

## Pros & Cons

### Pros

- **No shared mutable state by construction.** Most data races vanish.
- **Easier reasoning.** Each process is a sequential function; the
  interactions are explicit at the channel.
- **First-class channels** let you build reusable pipelines and fan-in /
  fan-out structures.
- **Composable.** `select` lets you combine many channel operations into
  one waiting point without nested callbacks.
- **Built-in back-pressure.** A slow consumer naturally throttles a fast
  producer, because send blocks.

### Cons

- **Deadlock potential is real.** The price of synchronous coordination is
  that a missing receiver freezes the sender.
- **Goroutine leaks** are silent — they pass tests and only surface under
  load.
- **Performance overhead** vs raw shared memory: a rendezvous involves
  scheduling, parking, and waking goroutines.
- **Not free of races.** You can still create a race on shared variables
  if you ignore the discipline (Go's race detector helps).
- **Discoverability problems.** Channels are anonymous, which is
  liberating but makes it hard to ask "who reads this channel?" in a big
  codebase. Good naming and structure matter.
- **Limited expressiveness for graphs.** CSP is great for pipelines and
  trees; arbitrary mesh-shaped interactions can become hard to follow.

---

## Use Cases

| Use case | Why CSP fits |
|---|---|
| Stream processing pipeline (parse → enrich → write). | Each stage is a goroutine; channels are the conveyor belt. |
| Fan-out worker pool processing tasks. | One channel of work, N workers `range` over it. |
| Fan-in aggregation of multiple sources. | One goroutine `select`s over many input channels. |
| Cancellation and timeouts. | `select` over the work channel and a `ctx.Done()` channel. |
| Background producers feeding an HTTP handler. | Decouples request lifetime from background work. |
| Rate-limited / throttled requests. | A "ticker" channel paces work; consumers `select` on it. |
| Building event loops without callbacks. | `select` replaces an explicit dispatcher loop. |

CSP fits *less* well when the problem is "thousands of long-lived named
entities with mailboxes" (use actors), or "share a small data structure
across CPUs as fast as possible" (use locks or atomics).

---

## Coding Patterns

These are the half-dozen patterns you will see again and again in idiomatic
Go.

**1. Generator.** A function that returns a channel it owns.

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

**2. Pipeline stage.** A function that takes an input channel, returns an
output channel, and forwards transformed values.

```go
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

**3. Fan-out.** Several worker goroutines `range` over one input channel.

```go
for w := 0; w < workers; w++ {
    go func() {
        for job := range jobs {
            process(job)
        }
    }()
}
```

**4. Fan-in.** One goroutine receives from several input channels and merges
into one output channel, using `select` (or a `sync.WaitGroup` plus N copy
goroutines).

**5. Reply channel.** The sender includes a channel inside the message and
the receiver writes the result back to it. This is how you do
"request/response" over CSP.

```go
type query struct {
    key   string
    reply chan string
}
```

**6. Done channel.** A `chan struct{}` that is `close()`d to signal "stop".
Combined with `select`, this is the canonical cancellation idiom.

---

## Clean Code

- Name channels for the thing they carry: `jobs`, `results`, `errCh`,
  `done`. Avoid generic names like `ch` once you have more than one.
- Use directional channel types (`chan<- T`, `<-chan T`) in function
  signatures.
- Make ownership visible: in a comment or doc string, say which function
  is responsible for closing each channel.
- Keep goroutines small; one logical job per goroutine.
- Wrap channel-returning constructors in a function so the goroutine
  lifecycle is in one place.
- Do not use `interface{}` to make a channel "generic" if you can avoid
  it. Define the message type as a struct.
- Prefer `for v := range ch` to `for { v, ok := <-ch; if !ok { ... } }`.

---

## Best Practices

- **Sender closes.** The goroutine that owns a channel closes it. Never
  close from a receiver.
- **One closer.** If multiple goroutines send, designate a single closer
  or use a `sync.Once`.
- **Always provide a way out.** Every long-running goroutine should
  `select` on either a work channel or a cancellation channel.
- **Bound your buffers.** If you reach for a buffered channel, give it a
  size you can justify. Avoid `make(chan T, 1_000_000)`.
- **Send and receive in different goroutines.** Otherwise the program
  deadlocks on the very first operation.
- **Run with `-race`** during development to catch the accidental
  shared-memory bugs that creep in.
- **Use `context.Context`** for cancellation across boundaries; it ships
  with a `Done()` channel exactly for this purpose.

---

## Edge Cases & Pitfalls

- **Receive from a closed channel** returns the zero value with `ok = false`.
  This is normal and is how `range` terminates. Do not treat the zero value
  as a real message; use the two-value form `v, ok := <-ch` when in doubt.
- **Send on a closed channel** panics. Make sure the sender knows when the
  channel is closed.
- **Closing twice** panics. Centralise the close.
- **A `nil` channel blocks forever** in both directions. This is sometimes
  used deliberately: setting a channel variable to `nil` inside a `select`
  disables that case.
- **`select` with `default`** is non-blocking — it tries each case once
  and falls through. Use it for "do something only if data is available"
  but not for "wait for data".
- **`time.After` in a hot loop** allocates a new timer each iteration; for
  high-rate loops use `time.NewTimer` and `Reset`.
- **A buffered channel does not eliminate back-pressure** — it only delays
  it. When the buffer fills, the next send blocks.

---

## Common Mistakes

| Mistake | What goes wrong | Fix |
|---|---|---|
| Sending and receiving in the same goroutine on an unbuffered channel | Immediate deadlock. | Spawn a goroutine for one side. |
| Never closing a channel that someone is ranging over | Receiver loops forever. | Close from the sender. |
| Closing from the receiver | Panic. | Reverse responsibility. |
| Multiple senders, one closes | Other senders panic on next send. | Use a "done" channel or `sync.Once`. |
| Using a buffered channel "to fix the deadlock" | Deadlock returns under load. | Find the missing receiver. |
| Goroutine reads from `ch`, function returns early without draining | Goroutine blocks on `ch <-` forever — leak. | Add a `done` / `ctx.Done()` case. |
| Sharing a slice or map through a channel and continuing to mutate it on the sender side | Data race. | Send a copy or hand over ownership. |
| Using `select` with all cases pointing at the same channel | Deceptively non-deterministic behaviour. | Restructure; there is no need for multiple cases. |

---

## Tricky Points

- **Receive order is not global.** With two senders racing into the same
  channel, the receiver sees their messages interleaved in an order
  decided by the scheduler. Do not rely on it.
- **`select` choice is random.** When several cases are ready at the same
  time, Go picks one uniformly. Do not write code that assumes priorities;
  if you need priority, restructure the channels or do a two-stage select.
- **A goroutine is not the same as an OS thread.** Goroutines are cheap
  (a few KB), so it is fine to spawn many. But spawning *unbounded*
  numbers from a request handler is a denial-of-service vector.
- **Closing is broadcast, sending is point-to-point.** All current and
  future receivers see a close; only one receiver gets each sent value.
  This is why `close` is the idiom for "stop everyone".
- **`for-select` with `nil` channel cases** is a powerful idiom for
  enabling/disabling cases dynamically: a `nil` channel is never ready.

---

## Test Yourself

1. Write a Go program that spawns 3 worker goroutines and feeds them 10
   integers via a channel. Each worker prints `worker N got X`. Make sure
   the program terminates cleanly.
2. Change the program so the main goroutine collects results back from the
   workers via a second channel. Print the sum of squares.
3. Add a deadline of 100 ms using `context.WithTimeout`. The program must
   stop early if the deadline expires.
4. Rewrite the producer/consumer example with a buffered channel of size
   2 and observe what changes. Add `fmt.Println` to show that the producer
   gets ahead of the consumer.
5. Cause a goroutine leak on purpose by writing a function that returns
   before draining its inner channel. Then fix it using a `done` channel.
6. Write a `select` that listens on three sources: a job channel, a
   `time.Tick`, and `ctx.Done()`. Explain what happens when two of them
   are ready at the same instant.

---

## Tricky Questions

1. **Why is closing a channel from the receiver side a bad idea?**
   Because subsequent sends will panic. Only the sender knows when to
   stop sending; only the sender can safely close.
2. **What is the difference between a buffered channel and a queue?**
   A queue is just a data structure; a buffered channel is a
   queue **plus** synchronisation: bounded capacity, blocking on full /
   empty, close semantics, and integration with `select`.
3. **If a `select` has both a ready receive and a ready send, which fires?**
   Either, chosen uniformly at random. There is no priority.
4. **Why might a worker pool not benefit from CSP?**
   If the worker tasks themselves are CPU-bound and stateless and you want
   raw throughput, a `sync.Pool` plus straight function calls can be
   faster — channel ops carry scheduling overhead.
5. **How do you implement a "broadcast to many" with one channel?**
   You cannot — each value goes to exactly one receiver. Either close the
   channel (which all receivers see) or fan-out by giving each subscriber
   its own channel.
6. **Why is `<-ctx.Done()` a channel and not a function?**
   So you can use it in `select`, exactly like any other channel. This is
   the cleanest CSP integration in the standard library.

---

## Cheat Sheet

```text
make(chan T)         // synchronous (unbuffered)
make(chan T, n)      // buffered, capacity n
ch <- v              // send
v := <-ch            // receive
v, ok := <-ch        // receive; ok = false if closed
close(ch)            // mark channel closed (sender only)
for v := range ch    // read until closed
chan<- T             // send-only channel type
<-chan T             // receive-only channel type

select {
case v := <-in:      // receive
case out <- v:       // send
case <-time.After(d):// timeout
case <-ctx.Done():   // cancellation
default:             // non-blocking
}
```

Rules of thumb:

- Sender closes. One closer.
- Send and receive in different goroutines.
- Bound your buffers and justify the size.
- Every long-lived goroutine must have a way out.
- Use directional channel types in signatures.
- Use the race detector in CI.

---

## Summary

CSP is a discipline that builds concurrent programs out of small sequential
processes that communicate through anonymous, first-class channels.
Synchronous rendezvous makes the act of communicating into the act of
synchronising: there are no locks, because the channel **is** the lock.
Go is the most popular practical realisation of CSP today, but the ideas
predate Go by decades — occam in the 1980s, Clojure's core.async in the
2010s, and Hoare's original paper in 1978 all show the same shape.

At the junior level, you should leave this document able to:

- Identify processes, channels, and the rendezvous in a concurrent
  program.
- Write the producer/consumer, fan-out, and fan-in patterns in Go.
- Use `select` to handle multiple channels, timeouts, and cancellation.
- Spot the most common mistakes — deadlock, missing close, goroutine
  leak, send on closed channel — before they bite you.

Practice the patterns, then move on to the middle level, where we look at
how channels are implemented inside the Go runtime and how CSP scales to
non-trivial system architectures.

---

## What You Can Build

- A **log-line processor** that reads from stdin, parses each line in a
  worker pool, and writes JSON to stdout in order.
- A **tiny URL fetcher** that fans out N concurrent HTTP requests and
  fans in their results, with a global timeout.
- A **rate-limited crawler** where a ticker channel paces work and a
  `done` channel allows early cancellation.
- A **chat fan-out** where one goroutine reads from a network connection
  and broadcasts to subscribers by closing per-subscriber channels.
- A **simple job queue** with bounded buffered intake, N workers, and a
  results channel for follow-up work.
- A **timeout wrapper** that runs a function in a goroutine and returns
  either its result or an error if it does not finish in time.

These tiny tools will give you the muscle memory you need before tackling
the middle-level material, where channels become a vocabulary you use to
design systems rather than a feature you reach for occasionally.

---

## Further Reading

- C. A. R. Hoare, **Communicating Sequential Processes**, *Communications
  of the ACM*, August 1978. The original paper. Short and very readable;
  read it once even if you do not finish.
- C. A. R. Hoare, **Communicating Sequential Processes** (book), 1985.
  The fuller treatment, freely available online from Oxford.
- Rob Pike, **Concurrency is not Parallelism**, talk at Heroku's Waza
  conference, 2012. The clearest popular explanation of the Go take on
  CSP.
- The Go blog, **Share Memory By Communicating**.
- The Go blog, **Go Concurrency Patterns: Pipelines and Cancellation**.
- The **FDR4** manual (Oxford) for the formal CSPm language and model
  checker, if you ever want to verify a concurrent protocol.
- INMOS, **occam Programming Manual**, 1984. Historical, but a fast way
  to see CSP combinators (`SEQ`, `PAR`, `ALT`) as first-class language
  constructs.
- Tim Bray, **Concurrent.Next**, blog posts surveying CSP, actors, and
  other models.

---

## Related Topics

- [CSP — Middle Level](middle.md)
- [CSP — Senior Level](senior.md)
- [CSP — Professional Level](professional.md)
- [CSP — Interview Questions](interview.md)
- [CSP — Tasks](tasks.md)
- [Actor Model — Junior Level](../03-actor-model/junior.md)
- [Message Passing — Junior Level](../02-message-passing/junior.md)
- [Channels — Junior Level](../../02-primitives/05-channels/junior.md)

---

## Diagrams & Visual Aids

**Synchronous rendezvous on an unbuffered channel.**

```text
Producer                       Consumer
   |                              |
   | ch <- v   (parked)           |
   |----------------------------->|  <-ch    (parked)
   |                              |
   |   <-- value handed over -->  |
   |                              |
   v                              v
 (resumes)                     (resumes)
```

**Buffered channel with capacity 2.**

```text
Producer            Channel buffer            Consumer
  ch <- 1   --->   [ 1 ]                       (idle)
  ch <- 2   --->   [ 1 | 2 ]                   (idle)
  ch <- 3   --->   [ 1 | 2 ]  (blocked)        (idle)
                                           <-ch  ===> 1
                   [ 2 | 3 ]   <-- 3 enters     (idle)
```

**Fan-out / fan-in topology.**

```text
                 +---> [worker1] ---+
                 |                  |
   [producer] ---+---> [worker2] ---+---> [collector]
                 |                  |
                 +---> [worker3] ---+
```

**Cancellation via `done` channel.**

```text
  +-------------+      jobs       +----------+
  | dispatcher  | --------------> | worker N |
  +-------------+                 +----------+
        |                              |
        |        ctx.Done() (close)    |
        +----------------------------->|
                                       |
                              (select picks Done;
                               worker exits)
```

**Choice with `select`.**

```text
              +-----------+
              |  select   |
              +-----+-----+
                    |
        +-----------+-----------+
        |           |           |
     <-jobs    <-time.After  <-ctx.Done()
        |           |           |
     "work"     "timeout"   "cancel"
```

These five pictures cover roughly 90% of what you will draw on a whiteboard
when explaining a CSP design to a colleague. Practise sketching them; once
the topology is clear, the code almost writes itself.
