# Actor Model & CSP — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Actor Model & CSP
> *Stop sharing memory and fighting over locks. Give each worker its own private state and let them talk by sending messages — like people passing notes instead of all scribbling on one whiteboard.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Shared Memory Is the Problem](#core-concept-1--shared-memory-is-the-problem)
5. [Core Concept 2 — The Actor Model: Mailboxes & Messages](#core-concept-2--the-actor-model-mailboxes--messages)
6. [Core Concept 3 — CSP: Channels & Goroutines](#core-concept-3--csp-channels--goroutines)
7. [Why This Avoids Data Races by Construction](#why-this-avoids-data-races-by-construction)
8. [The Same Counter, Three Ways](#the-same-counter-three-ways)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

You've probably heard that "concurrency is hard." Here's *why* it's usually hard: most concurrent programs let several threads touch the **same memory at the same time**, and then bolt on **locks** to stop them from corrupting it. Locks are easy to forget, easy to acquire in the wrong order (deadlock), and the bugs they cause appear only sometimes, only under load, only on the production server at 3 a.m.

This topic is about a completely different way to structure concurrency — one that makes a whole class of those bugs *impossible by design*:

> **Don't share memory. Build your program out of independent units that each own their private state, and let them coordinate only by sending each other messages.**

If no two units ever touch the same data, there's nothing to corrupt, so there are no data races and no locks to forget. That single idea has two famous flavors. The **Actor model** (Erlang, Akka) gives each unit a named address and a **mailbox** it reads messages from. **CSP** — Communicating Sequential Processes (Go, occam) — gives anonymous units typed **channels** to hand messages through. They differ in the details, but they share the core slogan, made famous by Go:

> **"Do not communicate by sharing memory; instead, share memory by communicating."**

By the end of this page you'll understand the mailbox-and-message intuition, see why one actor processing one message at a time means you never need a lock *inside* it, and be able to read a basic Go channel example and an Erlang actor.

> **The mindset shift:** stop picturing threads reaching into shared variables. Start picturing isolated workers passing messages — and notice that "isolated + messages" is what removes the locks.

---

## Prerequisites

- **Required:** You know what a thread or a "background task" is — code that runs at the same time as other code.
- **Required:** You've seen, or at least heard of, a **race condition** — two things touching the same variable and producing a wrong/random result.
- **Helpful:** You've used a **queue** (a list you add to one end and read from the other). A mailbox is exactly a queue.
- **Not required:** Knowing Erlang or Go. We introduce just enough of each to read the examples. The *mechanics* of threads, locks, and async live in [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/); this page is about the **way of thinking**, not the plumbing.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Shared memory** | Two or more concurrent units reading/writing the *same* variables in memory. The thing this paradigm avoids. |
| **Data race** | Two units touch the same memory at the same time, at least one writing — producing corrupted or unpredictable results. |
| **Lock / mutex** | A "talking stick": only the holder may touch the shared data. The traditional fix for data races — and a frequent source of deadlocks. |
| **Message passing** | Coordinating by *sending data* between units instead of letting them share a variable. The core idea here. |
| **Actor** | An independent unit with private state, an **address**, and a **mailbox**; it reacts to messages one at a time. (Hewitt, 1973.) |
| **Mailbox** | The queue where an actor's incoming messages wait until it's ready to process the next one. |
| **CSP** | *Communicating Sequential Processes* (Hoare, 1978): anonymous processes that communicate over **channels**. |
| **Channel** | A typed pipe you send values into and receive values out of — the CSP way to pass a message. |
| **Goroutine** | Go's lightweight concurrent unit (a "process" in CSP terms). You can run millions of them. |
| **Send (async)** | Drop a message in a mailbox and keep going — you don't wait for a reply (classic actor send). |
| **Rendezvous (sync)** | Sender and receiver meet: the send completes only when someone receives (classic CSP channel). |

> Two words to lock in: **mailbox** (the actor's inbox queue) and **channel** (the CSP pipe). Both carry messages; the difference is *who they're addressed to* and *whether the sender waits*.

---

## Core Concept 1 — Shared Memory Is the Problem

Here is the bug at the heart of nearly every concurrency horror story. Two threads both run `count = count + 1`:

```python
# Shared variable, two threads, no lock.
count = 0

def worker():
    global count
    for _ in range(100_000):
        count += 1     # read count, add 1, write count — THREE steps, not one

# Start two of these in parallel...
# Expected: 200000.  Actual: some smaller, random number, e.g. 137422.
```

`count += 1` is **not atomic**. It reads the value, adds one, and writes it back. If both threads read `41` before either writes, both write `42`, and one increment is **lost**. This is a **data race**: the answer depends on the exact timing of two threads, which you can't control. The traditional fix is a **lock**:

```python
lock = threading.Lock()
def worker():
    global count
    for _ in range(100_000):
        with lock:          # only one thread inside at a time
            count += 1
```

This works — but locks bring their own problems. Forget one lock anywhere and the race returns. Acquire two locks in different orders in two threads and you get **deadlock** (each waits forever for the other). And every lock you add makes the code harder to reason about, because now correctness depends on a discipline the compiler doesn't enforce.

> **The key realization:** the race only exists *because two threads share `count`*. Remove the sharing and the race vanishes — no lock required. That's the move this whole paradigm makes.

---

## Core Concept 2 — The Actor Model: Mailboxes & Messages

An **actor** is a tiny independent worker with three things:

1. **Private state** that nobody else can touch directly (e.g., its own `count`).
2. An **address** — a handle others use to send it messages.
3. A **mailbox** — a queue where incoming messages wait.

The crucial rule: an actor processes **one message at a time**, start to finish, before touching the next. Nothing else runs inside the actor concurrently. So when the actor updates its private `count`, *no other code is running in that actor* — there is literally no one to race with. No lock needed.

Here's a counter actor in **Erlang** (the language built around this idea). Read it for the shape, not the syntax:

```erlang
% A counter actor: loops forever, processing one message at a time.
counter(Count) ->
    receive                              % wait for the next message in the mailbox
        increment ->
            counter(Count + 1);          % update private state, loop with new value
        {get, From} ->
            From ! {count, Count},        % reply by SENDING a message back
            counter(Count);
        stop ->
            ok                            % end the loop
    end.

% Usage:
Pid = spawn(fun() -> counter(0) end).    % create the actor, get its address (Pid)
Pid ! increment.                         % "!" means "send to mailbox" — async, no wait
Pid ! increment.
Pid ! {get, self()}.                     % ask for the value; reply comes to OUR mailbox
```

Three things to notice:

- **`Pid ! increment`** drops a message in the mailbox and returns *immediately*. The sender does **not** wait for the increment to happen — that's an **asynchronous send**, the actor signature move.
- The actor's `Count` lives *only* inside the actor. The only way to read it is to **ask** (`{get, From}`) and get a message back. You can't reach in.
- Two threads sending `increment` at the same time can't race: their messages land in the mailbox and are processed **one after another**, so the two `Count + 1` updates never overlap.

That's the actor model: **isolated state + a mailbox + one-message-at-a-time + send-and-forget**.

---

## Core Concept 3 — CSP: Channels & Goroutines

**CSP** reaches the same goal — no shared memory — from a slightly different angle. Instead of named actors with mailboxes, CSP has **anonymous processes** that pass values through **channels**. This is the model **Go** is built on.

A **channel** is a typed pipe: you `send` values in one end and `receive` them out the other. A **goroutine** is a lightweight process (start one with `go`). Here's the same counter, CSP-style — the count lives inside *one* goroutine, and everyone else talks to it through channels:

```go
// The count lives ONLY inside this goroutine. No shared variable, no lock.
func counterServer(increments <-chan int, get <-chan chan int) {
    count := 0
    for {
        select {                       // wait on whichever channel is ready
        case <-increments:
            count++                    // safe: only THIS goroutine touches count
        case reply := <-get:
            reply <- count             // someone asked; send the value back
        }
    }
}

func main() {
    increments := make(chan int)
    get := make(chan chan int)
    go counterServer(increments, get)  // run the server concurrently

    increments <- 1                    // send an "increment" message
    increments <- 1

    reply := make(chan int)
    get <- reply                       // ask for the value...
    fmt.Println(<-reply)               // ...and receive the answer: 2
}
```

The differences from the actor version are worth seeing side by side:

| | Actor (Erlang) | CSP (Go) |
|---|---|---|
| Unit | Actor with a **name/address** (`Pid`) | **Anonymous** goroutine |
| Carrier | **Mailbox** (one inbox per actor) | **Channel** (a pipe; not tied to one process) |
| Default send | **Asynchronous** — don't wait | **Synchronous rendezvous** — sender waits for a receiver |
| You target | A *specific actor* (you have its address) | A *channel* (whoever's listening receives) |

Both achieve the same thing: the mutable `count` is **owned by exactly one unit**, and everyone else interacts with it by sending/receiving messages. No shared memory, no lock.

> **One slogan, two shapes.** Actors: *send a message to a named mailbox, don't wait.* CSP: *hand a value through a channel, meet the receiver.* Same paradigm — concurrency as isolated units exchanging messages.

---

## Why This Avoids Data Races by Construction

A data race needs **three ingredients** at once: (1) shared memory, (2) two concurrent accesses, (3) at least one of them a write. Remove any one and the race is gone. Message passing removes **#1**:

- The mutable state lives inside **one** unit (one actor, one goroutine).
- That unit handles messages **one at a time**, so inside it there's only ever *one* thing running — no second accessor.
- Everyone else can only *send a message*; they never touch the state.

So you don't *prevent* the race with a lock — you arrange things so the race **cannot exist**. That's what "by construction" means: the bug isn't fixed, it's made impossible to express. This is the same kind of win as the type system stopping you from adding a number to a string before the program even runs.

The trade-off (which you'll meet at the senior level) is that you swap one set of problems for another: instead of data races and deadlocked locks, you now worry about **mailboxes filling up**, **messages arriving in surprising orders**, and **two units waiting on each other's messages** (a different kind of deadlock). Message passing isn't free — it's a different, often better, set of trade-offs.

---

## The Same Counter, Three Ways

> Task: **a counter that many concurrent callers can increment safely.**

```python
# 1. SHARED MEMORY + LOCK (the traditional way).
#    Correct, but you must remember the lock everywhere, forever.
count = 0
lock = threading.Lock()
def increment():
    global count
    with lock:
        count += 1
```

```erlang
% 2. ACTOR MODEL. The count is private to the actor; callers SEND a message.
%    No lock — the actor handles messages one at a time.
counter(Count) ->
    receive
        increment      -> counter(Count + 1);
        {get, From}    -> From ! {count, Count}, counter(Count)
    end.
% Pid ! increment.   % async send; you never see "count" directly
```

```go
// 3. CSP. The count is private to one goroutine; callers send on a channel.
//    No lock — only the owning goroutine touches count.
func counter(inc <-chan int, get chan<- int) {
    count := 0
    for {
        select {
        case <-inc:        count++
        case get <- count: // hand out the current value
        }
    }
}
// inc <- 1   // send an increment; you never touch "count" directly
```

Look at what changes:

- **Shared + lock**: the variable is out in the open; *every* writer must coordinate via the lock. One forgetful caller and you have a race.
- **Actor / CSP**: there *is* no shared variable to coordinate over. The state hides inside one unit, and the only verb available to the outside is "send a message." Correctness comes from the **structure**, not from a discipline everyone must remember.

All three give a correct count. The message-passing versions get there with **no locks** because they removed the sharing — and that's the whole point of the paradigm.

---

## Real-World Examples

| Thing you've used | Where actors/CSP show up |
|---|---|
| **WhatsApp / Discord** chat backends | Erlang/Elixir actors — each connection/user is a cheap actor with a mailbox. |
| **A Go web server** | Each request runs in its own goroutine; they coordinate through channels, not shared globals. |
| **Telecom switches** | Erlang was *invented* at Ericsson to run phone switches with millions of concurrent calls. |
| **Akka services (Scala/Java)** | Actor systems modeling orders, sessions, or devices — one actor per entity. |
| **A worker pool / job queue** | Jobs are *messages* dropped on a channel; workers receive and process them. |
| **Game servers** | Often one actor (or goroutine) per player or per game room, isolating each one's state. |

The pattern repeats: whenever you have **lots of independent things happening at once** — connections, users, devices, jobs — modeling each as an isolated unit with its own mailbox is natural and lock-free.

---

## Mental Models

- **People passing notes vs. one shared whiteboard.** Shared memory is everyone scribbling on one whiteboard, fighting for the marker (the lock). Message passing is each person at their own desk, passing notes. Nobody fights over the marker because there's no shared board.
- **The mailbox is a real mailbox.** Anyone can drop a letter in your box (send). Only *you* open it, one letter at a time, and decide what to do. You never read someone else's mail, and they never read yours.
- **A channel is a hand-off, not a box.** In strict CSP, sending on a channel is like handing someone a baton in a relay: you hold it out and *wait* until they take it. The hand-off is the synchronization.
- **One waiter per table.** An actor processing one message at a time is like a single waiter serving one table's order before the next — no two orders get mixed up, because only one is in progress at a time.

---

## Common Mistakes

- **Thinking "actor model" and "CSP" are the same thing.** They share the slogan (no shared memory, communicate by messages) but differ: actors have **named mailboxes** and send **asynchronously**; CSP has **anonymous channels** and (classically) **synchronous** hand-offs. Know which you're using.
- **Sneaking shared memory back in.** Passing a *pointer* to a mutable object through a channel, then having both sides mutate it, re-creates the data race you were avoiding. Message passing only helps if you pass **data**, not shared handles.
- **Assuming messages can't be lost or delayed.** In-process they're reliable and ordered between two units; across a network (distributed actors) messages can be delayed, reordered, or dropped. Don't assume "send" means "arrived."
- **Expecting a reply from a fire-and-forget send.** `Pid ! increment` returns immediately and gives you *nothing back*. If you need a result, you must send your own address and wait for a reply message — it's a round trip you build yourself.
- **Believing message passing has no concurrency bugs.** It removes data races, but you can still **deadlock** (two units each waiting for the other's message) and **overflow a mailbox** (sender faster than receiver). Different bugs, not zero bugs.

---

## Test Yourself

1. What are the **three ingredients** a data race needs, and which one does message passing remove?
2. In the actor model, why doesn't an actor need a lock to update its private state safely?
3. Name **two** differences between an actor (Erlang) and a CSP process (Go).
4. What does `Pid ! increment` do, and what does the sender get back?
5. A channel send in classic CSP is *synchronous*. What does the sender wait for?
6. Your coworker passes a pointer to a shared map through a Go channel and both goroutines write to it. Why is this not really message passing?

> Try each before reading on. If #1 or #2 is fuzzy, re-read [Shared Memory Is the Problem](#core-concept-1--shared-memory-is-the-problem) and [Why This Avoids Data Races](#why-this-avoids-data-races-by-construction).

---

## Cheat Sheet

```
THE BIG IDEA
  Don't share memory + locks. Build the program from isolated units
  that own their state and coordinate ONLY by sending messages.
  "Share memory by communicating" — not "communicate by sharing memory."

WHY IT'S SAFE (no locks needed)
  Data race needs:  shared memory + 2 accesses + ≥1 write
  Message passing removes "shared memory" → race is IMPOSSIBLE, not just fixed.
  State lives in ONE unit; it handles ONE message at a time → no overlap.

TWO FLAVORS
  ACTOR (Hewitt; Erlang, Akka)
    actor = private state + ADDRESS + MAILBOX
    send is ASYNC: drop in mailbox, don't wait ("Pid ! msg")
    you target a NAMED actor; can spawn more actors
  CSP (Hoare; Go, occam)
    anonymous PROCESSES talk over CHANNELS
    classic send is SYNCHRONOUS rendezvous: wait for a receiver
    "select" waits on whichever channel is ready

GO SLOGAN:  goroutine + channel = CSP
  go f()            start a concurrent process
  ch <- v           send v
  v := <-ch         receive

STILL POSSIBLE:  deadlock, full mailbox, lost/delayed msgs (across a network)
GONE:            data races, forgotten locks, lock-ordering deadlocks
```

---

## Summary

Traditional concurrency lets threads **share memory** and uses **locks** to keep them from corrupting it — a discipline that's easy to get wrong (races, deadlocks, heisenbugs). This paradigm makes the opposite move: build your program from **isolated units that own their state and coordinate only by passing messages**, so there's no shared memory to corrupt and no lock to forget. It comes in two related flavors. The **Actor model** (Erlang, Akka) gives each unit an **address** and a **mailbox**, processes one message at a time, and sends **asynchronously** ("drop it and go"). **CSP** (Go, occam) uses anonymous **processes** that hand values through **channels**, classically with a **synchronous** rendezvous. Both remove data races *by construction* — the race can't be expressed when nothing is shared — which is why neither needs locks inside a unit. The catch, explored at higher levels, is that you trade lock-based bugs for message-based ones (deadlock, full mailboxes, delivery uncertainty), so message passing is a different — and often better — set of trade-offs, not a free lunch.

---

## Further Reading

- Carl Hewitt et al., *A Universal Modular ACTOR Formalism* (1973) — the paper that introduced actors.
- C. A. R. Hoare, *Communicating Sequential Processes* (1978; later a book) — the foundation of CSP and Go's channels.
- Rob Pike, *"Share memory by communicating"* (the Go blog) — the slogan and its rationale, with goroutine/channel examples.
- Joe Armstrong, *Programming Erlang* — actors, processes, and "let it crash," from a co-creator of Erlang.
- *A Tour of Go* (tour.golang.org), the Concurrency section — goroutines, channels, and `select`, hands-on.

---

## Related Topics

- [`middle.md`](middle.md) — actor mechanics vs CSP mechanics in depth: addresses, `select`, message ordering, hidden mutable state.
- [`senior.md`](senior.md) — the trade-offs: deadlock, backpressure, supervision, and when message passing beats shared memory.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where this paradigm sits among all the others.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — the closely related "computation as a graph of data flowing between stages."
- [11 — Event-Driven Programming](../11-event-driven-programming/) — control flow driven by events and handlers; messages are a kind of event.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the *mechanics* of threads, locks, and async that this paradigm sits on top of.
