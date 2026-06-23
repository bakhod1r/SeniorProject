# Actor Model & CSP — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Actor Model & CSP
> *Two message-passing models that look alike from a distance but make opposite default choices: actors are named, asynchronous, and unbounded; CSP processes are anonymous, synchronous, and rendezvous-based. The mechanics are where the difference lives.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Actor Mechanics: Address, Mailbox, Behavior, Spawning](#actor-mechanics-address-mailbox-behavior-spawning)
4. [CSP Mechanics: Channels, Rendezvous, Select](#csp-mechanics-channels-rendezvous-select)
5. ["Share Memory by Communicating" vs Shared Memory + Locks](#share-memory-by-communicating-vs-shared-memory--locks)
6. [Message Ordering Guarantees](#message-ordering-guarantees)
7. [Mutable State, Hidden Inside a Unit](#mutable-state-hidden-inside-a-unit)
8. [Request/Reply: Building a Round Trip](#requestreply-building-a-round-trip)
9. [Actors vs CSP: The Mechanics Side by Side](#actors-vs-csp-the-mechanics-side-by-side)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work?**

At the junior level you learned the slogan — *don't share memory; communicate by sending messages* — and saw a counter built three ways. Now we get concrete about the **mechanics**, because the two models that share that slogan differ in almost every detail that matters in practice.

The actor model and CSP are easy to blur together ("both pass messages, right?"), and that blur causes real design mistakes: people expect Go channels to behave like Erlang mailboxes, or assume an actor send blocks like a channel send. They don't. The differences cluster around four axes:

- **Identity** — is the unit *named* (you hold its address) or *anonymous* (you only hold a channel)?
- **Synchrony** — does a send *return immediately* (async) or *wait for a receiver* (rendezvous)?
- **Buffering** — is the message buffer *effectively unbounded* (a mailbox grows) or *bounded* (a channel has fixed capacity)?
- **Coupling** — does the carrier belong to *one receiver* (a mailbox) or is it a *shared pipe* any goroutine can read (a channel)?

This page walks the mechanics of each model along those axes, shows how to build a request/reply round trip in both, and nails down the one guarantee people most often get wrong: **message ordering**.

> **The mindset shift:** "message passing" isn't one mechanism. Picking actors vs CSP is picking a *bundle of defaults* — named+async+unbounded vs anonymous+sync+bounded — and those defaults shape your whole design.

---

## Prerequisites

- **Required:** The junior page of this topic — mailboxes, channels, and "data races avoided by construction."
- **Required:** You can read basic **Go** (goroutines, `chan`, `<-`) and follow **Erlang/Elixir** message-passing syntax (`!`, `receive`).
- **Helpful:** You've hit a real concurrency bug (a race, a deadlock, a hang) and remember how it felt to debug.
- **Not required:** Erlang/OTP supervision or Akka clusters — those are the senior/professional levels. The thread/scheduler **mechanics** underneath live in [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/).

---

## Actor Mechanics: Address, Mailbox, Behavior, Spawning

An actor system has a small, sharp vocabulary. Get these four nouns and you can read any actor code:

- **Address (a.k.a. PID / ActorRef)** — an opaque handle to an actor. You *cannot* reach the actor's state through it; you can only **send** messages to it. The address is the actor's only public surface.
- **Mailbox** — a per-actor queue holding messages that have arrived but aren't processed yet. It's effectively **unbounded** by default (it grows), which is both a convenience and a hazard (see the senior level on overflow).
- **Behavior** — the function that decides what to do with the *next* message. Crucially, an actor can **change its behavior** for the next message (a state machine: `idle` behavior → `busy` behavior).
- **Spawning** — actors create other actors. There's a tree: every actor has a parent that spawned it. This tree is what supervision (senior level) is built on.

Here's an Elixir actor that owns a key-value store, showing all four:

```elixir
defmodule KVStore do
  # spawn returns the ADDRESS (a pid)
  def start, do: spawn(fn -> loop(%{}) end)

  # the BEHAVIOR: receive one message, act, recurse with new private state
  defp loop(state) do
    receive do
      {:put, key, value} ->
        loop(Map.put(state, key, value))        # MUTATE by looping with new state

      {:get, key, from} ->
        send(from, {:value, Map.get(state, key)}) # reply by SENDING back
        loop(state)

      {:spawn_child, from} ->
        child = start()                           # actors SPAWN actors
        send(from, {:child, child})
        loop(state)
    end
  end
end

pid = KVStore.start()          # address
send(pid, {:put, :name, "Ada"}) # ASYNC: returns immediately, no wait
send(pid, {:get, :name, self()})
receive do {:value, v} -> v end # => "Ada"
```

The defining actor properties, all visible above:

1. **Send is asynchronous.** `send(pid, msg)` drops the message in the mailbox and returns *instantly*. The sender never blocks waiting for the actor to process it. This is the single biggest difference from classic CSP.
2. **State is private and updated by recursion** (functional actors) or by mutating a field (Akka). Either way, no other code can touch it.
3. **One message at a time.** The `loop` handles exactly one message before recursing, so the state transition is never interrupted.
4. **The address is a value** you can store, pass in other messages, and send to — including over a network (location transparency, professional level).

---

## CSP Mechanics: Channels, Rendezvous, Select

CSP's vocabulary is different because it makes the *channel*, not the process, the named thing. Processes are anonymous; the **channel** is the object you hold and pass around.

- **Channel** — a typed conduit. `make(chan int)` is a channel carrying `int`s. You hold the channel, not a reference to any process.
- **Rendezvous (synchronous send)** — on an **unbuffered** channel, `ch <- v` **blocks** until another goroutine does `<-ch`. The send and receive happen *together*, at the same instant — a hand-off. This is the classic CSP semantics.
- **Buffered channel** — `make(chan int, 8)` adds capacity. Now a send blocks only when the buffer is *full*; a receive blocks only when it's *empty*. A buffered channel is the closest CSP gets to a (bounded) mailbox.
- **Select** — wait on *several* channel operations at once and proceed with whichever is ready first. This is CSP's way to handle multiple message sources, timeouts, and cancellation.

```go
func worker(jobs <-chan Job, results chan<- Result, quit <-chan struct{}) {
    for {
        select {                          // wait on whichever is ready
        case job, ok := <-jobs:
            if !ok { return }             // channel closed → no more jobs
            results <- process(job)       // SYNC send: blocks until a receiver takes it
        case <-time.After(5 * time.Second):
            log.Println("idle, still alive")
        case <-quit:
            return                        // cancellation via a channel
        }
    }
}
```

Notes that distinguish CSP from actors:

1. **The default send is synchronous.** On an unbuffered channel, the sender waits for a receiver. This gives you *backpressure for free*: a fast producer is automatically throttled to the consumer's speed, because it can't send until someone's ready.
2. **Channels aren't owned by one process.** Any goroutine holding `jobs` can receive from it. A worker *pool* is N goroutines all receiving from the *same* channel — the runtime hands each job to one of them. There's no "address" of a specific worker.
3. **`select` is the workhorse.** Timeouts (`time.After`), cancellation (`quit`/`context.Done()`), and fan-in (multiple input channels) are all just cases in a `select`.
4. **Closing a channel** broadcasts "no more values" to all receivers — a clean shutdown signal with no actor analogue.

> **Named vs anonymous, stated precisely.** In actors you address a *recipient*: "send this to *that* actor." In CSP you address a *channel*: "put this on *that* pipe," and whoever is listening receives it. Actors couple sender to a known receiver; channels decouple them through a shared conduit.

---

## "Share Memory by Communicating" vs Shared Memory + Locks

The same job — a shared counter readable and writable by many — written both ways makes the paradigm choice concrete.

```go
// SHARED MEMORY + LOCK. Correct, but the lock discipline is on you,
// and the critical sections can grow and tangle as the type gains methods.
type Counter struct {
    mu sync.Mutex
    n  int
}
func (c *Counter) Inc()  { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Get() int { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

```go
// SHARE MEMORY BY COMMUNICATING. The counter is owned by ONE goroutine;
// callers send messages. No mutex anywhere — serialization comes from the
// single owner processing one message at a time.
func counter(inc <-chan struct{}, get chan<- int) {
    n := 0
    for {
        select {
        case <-inc:      n++
        case get <- n:               // hand out the current value
        }
    }
}
```

Both are correct. The difference is **where correctness comes from**:

- With the **mutex**, every method must remember to lock. Add a third method that forgets, and you have a race. Add a second mutex and you can deadlock by lock-ordering. The compiler can't see any of this.
- With the **owning goroutine**, there *is no* shared field to protect. Serialization is structural: only one goroutine ever touches `n`, and it does so one message at a time. You can't "forget the lock" because there's no lock.

The trade-off is real and goes the other way too:

| Aspect | Shared memory + locks | Message passing |
|---|---|---|
| Read of current value | Direct, cheap | A round trip (send request, await reply) |
| Forgetting the discipline | Easy → silent race | Not possible (no shared state) |
| Deadlock source | Lock ordering | Two units awaiting each other's message |
| Fits | Fine-grained, hot, read-mostly state | State with clear ownership and a request/reply shape |

Message passing is **not always better**. A read-mostly value behind a `RWMutex` can be far cheaper than a channel round trip per read. The paradigm wins when state has a clear *owner* and interactions are naturally *messages*; it loses when you're forcing a message protocol onto something that's really just a shared variable.

---

## Message Ordering Guarantees

This is the guarantee people most often state wrong, so be precise:

> **Between a single sender and a single receiver, messages are delivered in send order. Across multiple senders, there is no global order.**

In both Erlang actors and Go channels:

- If actor **A** sends `m1` then `m2` to actor **B**, **B** receives `m1` before `m2`. Point-to-point FIFO holds.
- If **A** sends `m1` to **B** and **C** sends `m2` to **B**, the order **B** sees `m1` vs `m2` is **undefined** — it depends on timing. There's no global clock.

```erlang
% A sends two messages to B; B is guaranteed to receive them in this order:
B ! first,
B ! second.        % B sees `first` then `second` — always

% But if A and C both send to B concurrently, B might see them in either order.
```

Consequences you must design around:

- **Don't rely on cross-sender ordering.** If three clients send updates to one actor, the actor sees *some* interleaving, not "the order they were issued in the real world." If order matters globally, you need sequence numbers or a single ordering point.
- **A reply isn't ordered relative to other senders' messages.** You send a request and await a reply, but other messages may slip into your mailbox in between. Match replies by a **correlation id** (a tag/ref), not by "it must be the next message."
- **Across a network (distributed actors)**, even point-to-point ordering can be weaker, and messages can be lost — the senior/professional levels cover delivery guarantees (at-most-once vs at-least-once).

---

## Mutable State, Hidden Inside a Unit

A point that surprises people coming from "functional = no mutation": **actor and CSP programs are full of mutable state — it's just hidden inside one unit and never shared.**

```elixir
# This actor's "state" mutates on every message — but it's encapsulated.
# From the outside, the actor is a black box you send messages to.
defp loop(count) do
  receive do
    :inc -> loop(count + 1)   # the "current count" changes over time
  end
end
```

```go
// Same: `n` is mutable and changes constantly — but only this goroutine sees it.
func counter(inc <-chan struct{}) {
    n := 0                    // mutable, local, hidden
    for range inc { n++ }
}
```

The principle: **encapsulated mutable state is fine; *shared* mutable state is the problem.** A lock-based program has shared mutable state and guards it. A message-passing program has the *same* mutable state but makes it *unshareable* by hiding it behind a single owner. This is why people say message passing gives you "the benefits of mutation without the cost of sharing": each unit can be as imperative as it likes internally, because nothing outside can observe a half-finished update.

This also reframes what an actor *is*: it's essentially an **object** whose methods are messages and whose method calls are serialized automatically. "An actor is an object that runs in its own thread and whose method calls are a queue" is a useful — if informal — way to see it.

---

## Request/Reply: Building a Round Trip

Both models default to *one-way* messaging. A real reply is something you **build**, and the two models build it differently.

**Actors** — include your own address (or a unique ref) in the request; the actor sends a reply message back to it:

```elixir
# Caller sends its own pid + a unique tag; actor replies to that pid.
ref = make_ref()
send(pid, {:get, :name, self(), ref})
receive do
  {:value, ^ref, v} -> v          # match on the ref so we get OUR reply
after
  5_000 -> {:error, :timeout}     # always bound the wait
end
```

**CSP** — send a fresh **reply channel** *inside* the message; the server sends the answer back on it:

```go
type GetReq struct{ Key string; Reply chan string }   // reply channel travels IN the request

req := GetReq{Key: "name", Reply: make(chan string)}
requests <- req                    // send the request
select {
case v := <-req.Reply:             // receive the answer
    use(v)
case <-time.After(5 * time.Second):
    // timeout: never wait forever on a reply
}
```

Two lessons that apply to both:

1. **Carry the return path in the message.** Actors carry an address+ref; CSP carries a reply channel. Either way, "how do I answer you?" is data inside the request.
2. **Always bound the wait.** A reply may never come (the peer crashed, the message was lost). Use `after`/`time.After` so a missing reply becomes a timeout, not a hang. This single habit prevents a huge fraction of message-passing deadlocks.

---

## Actors vs CSP: The Mechanics Side by Side

| Mechanic | Actor model (Erlang/Akka) | CSP (Go/occam) |
|---|---|---|
| Unit identity | **Named** — you hold its address (PID/ActorRef) | **Anonymous** — you hold a channel, not a process |
| Carrier | **Mailbox**, one per actor | **Channel**, a shared pipe |
| Default send | **Asynchronous** — returns immediately | **Synchronous rendezvous** (unbuffered) — waits for receiver |
| Buffering | Mailbox is **unbounded** by default | Channel is **bounded** (0 or fixed capacity) |
| Backpressure | Not automatic (mailbox grows) — you add it | **Built in** — sender blocks when buffer full |
| Multiple sources | Selective `receive` / pattern match in mailbox | **`select`** over several channels |
| Spawning topology | Tree of actors (parent/child) | Flat — goroutines + channels, no built-in hierarchy |
| Fault model | Supervision, "let it crash" (senior level) | No built-in supervision; you handle errors explicitly |
| Receiver coupling | One mailbox → one actor | One channel → any goroutine receiving (pools) |

A way to remember the personalities:

- **Actors are about *who*.** You think in terms of *entities* (this user, this order, this device) that own state and react to messages. Naming and addressing are central; asynchrony and unbounded mailboxes make them resilient and decoupled, at the cost of having to add backpressure yourself.
- **CSP is about *flow*.** You think in terms of *stages and pipes* (jobs flow from here to there). Synchronous channels give automatic backpressure and make data flow the star, at the cost of no built-in identity or supervision.

Neither is strictly better; they optimize for different mental models of the same paradigm.

---

## Common Mistakes

- **Expecting an actor send to block.** `send(pid, msg)` is fire-and-forget — it returns before the work happens. If you *need* it done, do a request/reply with a bounded wait. (CSP's unbuffered send *does* block, which is the opposite default — don't carry the intuition across.)
- **Treating a buffered channel as "unlimited."** A buffered channel has a *fixed* capacity; sends block when it's full. That's a feature (backpressure), not a bug — but it surprises people who picture an Erlang-style growing mailbox.
- **Relying on cross-sender ordering.** Two different senders to one receiver have *no* defined order. Building logic on "client A's message arrives before client B's" is a race waiting to happen.
- **Matching replies by position instead of by id.** Assuming "the next message in my mailbox is the reply to my request" breaks the moment another message arrives first. Tag requests and match replies by tag/ref.
- **Passing shared mutable data through the message.** Sending a pointer/reference both sides keep mutating defeats the whole model. Pass **immutable data** (or transfer ownership and stop touching it on the sender side).
- **Never bounding a wait.** A `receive` with no `after`, or a `<-reply` with no `select` timeout, turns one lost message into a permanent hang.

---

## Summary

The actor model and CSP share one slogan and split on the mechanics. **Actors** (Erlang/Akka) are built from **named** units with an **address** and a per-actor **mailbox**; sends are **asynchronous** (drop and go), mailboxes are effectively **unbounded**, and actors **spawn** other actors into a tree. **CSP** (Go/occam) is built from **anonymous** processes that communicate over **channels**; the classic send is a **synchronous rendezvous** that blocks until a receiver appears, which gives **automatic backpressure**, and `select` waits on multiple channels at once. Both encapsulate **mutable state inside a single owner** so it's never shared — that's why neither needs locks internally — and both guarantee **point-to-point FIFO ordering** but **no global order across senders**. Request/reply is something you *build*: actors carry an address+ref, CSP carries a reply channel, and both must **bound the wait** to avoid hangs. The choice between them is a choice of defaults — *named, async, unbounded* (think in entities) versus *anonymous, sync, bounded* (think in flow) — and message passing is the right tool when state has a clear owner and a request/reply shape, not when you're forcing a protocol onto a plain shared variable.

---

## Further Reading

- Rob Pike, *"Concurrency is not Parallelism"* (talk) — the CSP mental model behind goroutines and channels.
- *The Go Memory Model* (go.dev) — the precise ordering/happens-before guarantees channels give you.
- Joe Armstrong, *Making reliable distributed systems in the presence of software errors* (PhD thesis) — actor mechanics and ordering in Erlang.
- *Akka Documentation — Actors* — addresses, mailboxes, behaviors, and `ask` (request/reply) in a typed actor system.
- C. A. R. Hoare, *Communicating Sequential Processes* (book, free PDF) — the formal mechanics of channels and rendezvous.

---

## Related Topics

- [`junior.md`](junior.md) — the intuition: mailboxes, channels, and races avoided by construction.
- [`senior.md`](senior.md) — trade-offs: deadlock, mailbox overflow, supervision, backpressure, and actor-vs-CSP selection.
- [`professional.md`](professional.md) — Erlang/OTP, supervision trees, distribution, and message-passing at system scale.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — pipelines of channels are dataflow; the models overlap.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — handlers reacting to events, the close cousin of message handlers.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the scheduler/thread mechanics under goroutines and actor runtimes.
