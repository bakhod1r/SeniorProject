# The Actor Model — Junior Level

> **Topic:** [Actor Model](README.md)
> **Focus:** the three axioms, mailboxes, "let it crash"

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

The **Actor Model** is a model of concurrent computation invented by Carl Hewitt in 1973. Its goal was philosophical as much as practical: Hewitt wanted a way to describe computation in which there was no shared memory, no global clock, and no implicit synchronization — only independent entities exchanging messages. He called these entities **actors**. An actor is the universal primitive: it owns some private state, it has a mailbox, and it reacts to one message at a time. There are no locks, no semaphores, no shared variables. If two actors need to coordinate, they send messages.

The model stayed mostly academic for a decade until Joe Armstrong and his colleagues at Ericsson, in the mid-1980s, built **Erlang** — a programming language designed for telecom switches that had to stay up for years and serve millions of connections. Erlang took Hewitt's ideas and made them industrial. Each phone call was an actor (called a **process** in Erlang). When one crashed, a **supervisor** restarted it. The Erlang VM (the **BEAM**) scheduled millions of these processes on a handful of OS threads. The slogan that emerged — *"let it crash"* — captured a radical idea: instead of defending every line with try/catch, isolate failure and recover cleanly from outside.

From Erlang the model spread. **Akka** brought it to the JVM in 2009. **Akka.NET** and Microsoft's **Orleans** brought it to .NET. **Pony** built a whole language around it with capability-typed message passing. In Rust, **Tokio** and crates like `actix` and `ractor` provide actor-style APIs on top of channels. As a junior, you only need to internalize three ideas: actors own state, actors talk by messages, and actors are allowed to die so a parent can restart them. The rest of this document walks through those ideas with runnable code in Erlang, Scala (Akka), C# (Orleans), and Rust (Tokio).

---

## Prerequisites

Before diving in you should be comfortable with:

- **Basic concurrency vocabulary** — what a thread is, what "concurrent" vs "parallel" means, why shared mutable state is dangerous.
- **A queue data structure** — actors are essentially "process this queue one item at a time", so you must already see why FIFO ordering matters.
- **One mainstream language well enough to read it** — Java/Scala/Kotlin, C#, Erlang/Elixir, or Rust. The examples are short and explained, so cross-language reading is fine.
- **Functions as values** — actors are often expressed as a function `(state, message) -> new_state`. If lambdas and closures are unfamiliar, review them first.
- **Async/await intuition** — actors are not the same as async, but knowing that a single thread can interleave many tasks helps.
- **Prior reading recommended:** [`../01-shared-memory/junior.md`](../01-shared-memory/junior.md) (so you appreciate what we are escaping from) and [`../02-message-passing/junior.md`](../02-message-passing/junior.md) (actors are a structured form of message passing).

You do **not** need to know category theory, the lambda calculus, or formal semantics. The Actor Model is engineering-shaped: simple parts, surprising consequences.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Actor** | The unit of concurrency. Owns private state, has a mailbox, processes one message at a time. |
| **Mailbox** | A FIFO queue of incoming messages belonging to a single actor. Only the actor reads from it. |
| **Message** | An immutable value sent to an actor's mailbox. Triggers exactly one message-handler invocation. |
| **Behavior** | The current function that decides how the actor reacts to the next message. Can change after each message. |
| **Become** | Operation an actor uses to swap its current behavior for a new one (state transition). |
| **Spawn** | Create a new actor. Returns a reference (`PID`, `ActorRef`, `GrainReference`, etc.) usable to send messages. |
| **PID** | "Process identifier" in Erlang. Opaque handle for sending messages to a specific actor. |
| **ActorRef** | Akka's typed handle to an actor. Carries the message type the actor accepts. |
| **Grain** | Orleans' name for a virtual actor that may be activated or deactivated automatically. |
| **Tell** | Fire-and-forget message send. Common, cheap, asynchronous. The default. |
| **Ask** | Send and wait for a reply (often a `Future`/`Task`). Convenient but easy to misuse. |
| **Supervisor** | An actor whose job is to watch child actors and restart, stop, or escalate on failure. |
| **Supervision Strategy** | Rule a supervisor follows: `OneForOne`, `OneForAll`, `RestForOne`, `Escalate`. |
| **OTP** | "Open Telecom Platform" — Erlang's standard library of supervisor/gen_server/application abstractions. |
| **gen_server** | OTP behavior implementing a generic server with `init/handle_call/handle_cast`. |
| **BEAM** | The Erlang virtual machine. Schedules millions of lightweight processes preemptively. |
| **Akka** | JVM actor framework (Scala and Java APIs). Now maintained as **Pekko** under Apache. |
| **Akka.NET** | Port of Akka to .NET. |
| **Orleans** | Microsoft's virtual actor framework for .NET. |
| **Pony** | A language whose type system proves messages are race-free (reference capabilities). |
| **Mailbox overflow** | Mailbox grows faster than actor processes it; classic source of OOM. |
| **Let it crash** | Idiom: instead of defensive try/catch, let the actor die and let a supervisor restart it clean. |
| **Hot code reload** | Erlang ability to upgrade running actors' code without stopping the system. |

---

## Core Concepts

### 1. The Three Axioms (Hewitt 1973)

An actor, on receiving a message, can do three things — and only three:

1. **Create more actors.**
2. **Send messages to other actors** (or to itself).
3. **Designate the behavior to be used for the next message it receives** — i.e. change its state.

Everything else (printing, computing, calling APIs) is "side effects" that happen *during* one of these three actions. The minimalism is intentional: it gives a clean theoretical core, but it also gives a clean implementation core. When you build an actor framework, you only need to support these three operations.

### 2. Isolated State, One Message at a Time

Each actor's state is private. No other actor can read or write it. The only way to influence it is to send a message. Inside the actor, message handling is **sequential** — exactly one message is processed at a time. This is the magic that eliminates locks. You can write `counter = counter + 1` without atomicity worries, because no other code can run in parallel with this actor's handler.

After processing a message, the actor decides what behavior to use for the **next** message. In Akka Typed this is literally a function returning `Behavior[T]`. In Erlang you express it by tail-recursing into a new loop function with new state. In Orleans it is field mutation between calls. The key idea: state evolution is event-driven, message-by-message.

### 3. Messages as the Only Communication

Messages are **immutable**, **asynchronous**, and (by convention) **value-typed**. You do not pass an object reference; you pass a copy of data. This is what makes actors safely distributable: the same code works whether the recipient is in the same process or on a different continent, because the wire format is just bytes.

This also means you cannot "ask an actor for its internal field". You must define a message like `GetCount(replyTo)` and the actor replies by sending another message. That feels verbose at first, then becomes liberating.

### 4. Spawning Child Actors

Actors form a **tree**. A parent spawns children. Children are owned by their parent. In Erlang you call `spawn/1`. In Akka you call `context.spawn(...)`. The parent receives a reference and uses it to send messages.

The tree structure is not aesthetic — it is operational. When something goes wrong inside a child, the parent (acting as a supervisor) decides what to do. The tree is how failure is contained.

### 5. "Let It Crash" + Supervisor Pattern

Most languages teach: *check every error, catch every exception, never let the program die.* Erlang teaches the opposite: **let it crash**. If your actor encounters an unexpected condition — a malformed message, a divide-by-zero, a network glitch — the safest thing is to die cleanly and let a supervisor restart you with fresh state. Defensive coding turns into 80% boilerplate and still misses the corner that bites you in production. Supervisors turn that into 5 lines of declarative restart policy.

A supervisor strategy answers: when a child crashes, do I (a) restart just that child, (b) restart all my children, (c) restart the crashed child and all children started after it, or (d) give up and escalate the failure to *my* supervisor? The four answers correspond to `OneForOne`, `OneForAll`, `RestForOne`, `Escalate`.

### 6. Where It Came From: Erlang and Telecom

Joe Armstrong at Ericsson in the late 1980s was solving a real problem: build a software telephone switch that handles 100,000+ concurrent calls, never goes down, can be upgraded live, and survives partial hardware failure. A call is short-lived, mostly waiting, mostly independent. The actor model was a perfect fit. Erlang gave each call its own process. The BEAM scheduler preemptively multiplexed millions of these onto a handful of OS threads. Crashes were per-call, not per-server. Hot code reload meant you could deploy a fix without dropping calls. The AXD301 ATM switch built on Erlang famously reached **nine 9s** of availability (about 30 ms downtime per year). That is the lineage you are inheriting.

### 7. Framework Tour

| Framework | Language | Notable trait |
| --- | --- | --- |
| **Erlang/OTP** | Erlang | The original. Process per actor; preemptive scheduling; supervisor trees; hot reload. |
| **Elixir** | Elixir | Modern syntax on the BEAM; same actor semantics as Erlang. |
| **Akka / Pekko** | Scala / Java | Typed `Behavior[T]`; clustering; persistence (event sourcing); now Apache Pekko. |
| **Akka.NET** | C# | Port of Akka to .NET; same model. |
| **Orleans** | C# | "Virtual actors" called grains; framework activates/deactivates automatically; cloud-first. |
| **Pony** | Pony | Capability-typed actors; compiler proves data-race freedom. |
| **CAF** | C++ | "C++ Actor Framework"; native-code actors with type-safe messages. |
| **Actix / Ractor** | Rust | Lightweight actor patterns on top of Tokio's mpsc channels. |

### 8. Actors vs CSP

CSP (Hoare 1978; Go's goroutines + channels) and actors look alike but emphasize different things:

- **CSP** — the channel is the named thing. Anybody can read or write a channel. Goroutines are anonymous.
- **Actors** — the actor is the named thing. The mailbox is *part of* the actor; you cannot read someone else's mailbox.

Practical consequence: in CSP you compose pipelines around channels (think `chan int`). In actors you compose hierarchies around actor identities. CSP excels at streaming workflows; actors excel at long-lived stateful entities with identity (a user, a session, a device).

### 9. Actors vs Raw Message Passing

Plain message passing (pipes, sockets, `mpsc` channels) gives you a queue. The actor model gives you a queue **plus** an identity, a lifecycle, and a supervision relationship. The mailbox always belongs to *somebody*. That ownership unlocks supervisor trees, location transparency (same code local or remote), and addressing by logical name.

### 10. First Mistakes Beginners Make

- **Synchronous `ask` misuse** — turning every `tell` into `await ask(...)`. This serializes the whole system and reintroduces deadlocks.
- **Actor-per-row anti-pattern** — spawning one actor per row in a database. Works, but the mailbox pressure and memory footprint blow up.
- **Blocking inside an actor** — calling a blocking JDBC driver inside an Akka actor pins a dispatcher thread. The whole actor system grinds.
- **Mutable messages** — passing a Java `ArrayList` between actors and editing it on the sender side after sending. Boom: shared mutable state behind your back.
- **Asking an actor for its state instead of subscribing to its events** — couples lifetimes.

---

## Real-World Analogies

| Analogy | Mapping |
| --- | --- |
| **Post office boxes** | Each actor owns a P.O. box. People drop letters in. The owner reads them one at a time. Nobody else can reach into the box. |
| **Office employee with an inbox** | Each employee processes emails sequentially. They can email other employees. Their manager (supervisor) can fire and re-hire them. |
| **Customer service ticket queue** | One agent owns one queue. Tickets are immutable when filed. The agent works through them in order. |
| **Restaurant kitchen stations** | A line cook is an actor. Orders (messages) arrive at their station. They cannot reach into another station's pan; they shout "fire on table 6!" (a message). |
| **Phone call routing** | The original use case. Each call is an actor. The switch is a supervisor. A dropped call dies; the switch keeps running. |
| **Erlang's own bumper sticker** | "Concurrency-oriented programming — like object-oriented, but objects have inboxes." |

---

## Mental Models

**Model 1: Actor = (private state) + (mailbox) + (handler function).** Picture a box with a queue glued to its front and a closed lid on top. Messages slide into the queue. A single elf inside grabs the next message, mutates the state inside the box, optionally drops new messages into other boxes' queues, then waits for the next one.

**Model 2: A tree of supervisors.** Don't think of actors as a flat soup. Think of them as a tree: root supervisor at the top, sub-supervisors, leaf workers. When a leaf dies, its parent decides what to do. Failure flows upward; messages flow horizontally between leaves.

**Model 3: A function `(state, msg) -> (newState, outgoingMsgs)`.** This is the functional view. Each actor is a pure function from current state and incoming message to the next state and a set of side-effecting message sends. This is how Akka Typed and Pony think.

**Model 4: A virtual entity.** In Orleans you address an actor by *name* — `GrainFactory.GetGrain<IUser>("alice")` — and the runtime activates it on some server, possibly migrating it later. You don't manage lifecycle; you think in terms of identity.

**Model 5: A SIM card for state.** Each actor is a tiny sealed device that holds a slice of state. The CPU is shared; the data is owned. To talk to the data, you call the device.

---

## Code Examples

We will implement the same toy: a **counter** actor that supports `Inc`, `Dec`, and `Get`. Where natural, we also show a tiny ping/pong.

### Erlang `gen_server` Counter

```erlang
%% file: counter.erl
-module(counter).
-behaviour(gen_server).

%% public API
-export([start_link/0, inc/1, dec/1, get/1]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2]).

start_link() ->
    gen_server:start_link(?MODULE, 0, []).

inc(Pid) -> gen_server:cast(Pid, inc).
dec(Pid) -> gen_server:cast(Pid, dec).
get(Pid) -> gen_server:call(Pid, get).

init(InitialCount) ->
    {ok, InitialCount}.

handle_cast(inc, State) -> {noreply, State + 1};
handle_cast(dec, State) -> {noreply, State - 1}.

handle_call(get, _From, State) ->
    {reply, State, State}.
```

Usage in the shell:

```erlang
1> {ok, C} = counter:start_link().
2> counter:inc(C), counter:inc(C), counter:inc(C).
3> counter:get(C).
3
```

`cast` is "tell" (no reply). `call` is "ask" (synchronous reply). The state `0 -> 1 -> 2 -> 3` evolves message by message, *without any locks*. The gen_server library serializes calls into the actor automatically.

### Akka Typed (Scala) Counter

```scala
// build.sbt: libraryDependencies += "com.typesafe.akka" %% "akka-actor-typed" % "2.8.0"
import akka.actor.typed.{ActorRef, ActorSystem, Behavior}
import akka.actor.typed.scaladsl.Behaviors

object Counter {
  sealed trait Cmd
  case object Inc                              extends Cmd
  case object Dec                              extends Cmd
  case class  Get(replyTo: ActorRef[Int])      extends Cmd

  def apply(): Behavior[Cmd] = counting(0)

  private def counting(n: Int): Behavior[Cmd] =
    Behaviors.receiveMessage {
      case Inc          => counting(n + 1)
      case Dec          => counting(n - 1)
      case Get(replyTo) => replyTo ! n; Behaviors.same
    }
}

object Main extends App {
  val system = ActorSystem(Counter(), "counters")
  system ! Counter.Inc
  system ! Counter.Inc
  // an ad-hoc replyTo actor in real code; omitted here for brevity
}
```

Note the **becoming**: `counting(n + 1)` returns a brand new `Behavior` for the next message. State is captured in the closure, not in a mutable field.

### Orleans (C#) Grain Counter

```csharp
// Interfaces
public interface ICounterGrain : IGrainWithStringKey {
    Task Inc();
    Task Dec();
    Task<int> Get();
}

// Grain implementation
public class CounterGrain : Grain, ICounterGrain {
    private int _value;

    public Task Inc() { _value++; return Task.CompletedTask; }
    public Task Dec() { _value--; return Task.CompletedTask; }
    public Task<int> Get() => Task.FromResult(_value);
}

// Client
var grain = client.GetGrain<ICounterGrain>("user/alice/counter");
await grain.Inc();
await grain.Inc();
int v = await grain.Get(); // 2
```

In Orleans you do not call `Spawn`. You call `GetGrain` with a logical key. The framework activates a grain instance on some silo when first addressed and may deactivate it later. The state lives inside `_value` only while the grain is activated; for durability you would wire up persistent state (Orleans supports this with one attribute).

### Tokio (Rust) Mini-Actor via `mpsc`

Rust has no built-in actor library, but Tokio's `mpsc` channel and `tokio::spawn` give you the building blocks.

```rust
use tokio::sync::{mpsc, oneshot};

enum Msg {
    Inc,
    Dec,
    Get(oneshot::Sender<i64>),
}

#[derive(Clone)]
struct CounterHandle {
    tx: mpsc::Sender<Msg>,
}

impl CounterHandle {
    pub fn new() -> Self {
        let (tx, mut rx) = mpsc::channel(64);
        tokio::spawn(async move {
            let mut state: i64 = 0;            // private to this task
            while let Some(msg) = rx.recv().await {
                match msg {
                    Msg::Inc        => state += 1,
                    Msg::Dec        => state -= 1,
                    Msg::Get(reply) => { let _ = reply.send(state); }
                }
            }
        });
        Self { tx }
    }

    pub async fn inc(&self) { let _ = self.tx.send(Msg::Inc).await; }
    pub async fn dec(&self) { let _ = self.tx.send(Msg::Dec).await; }
    pub async fn get(&self) -> i64 {
        let (tx, rx) = oneshot::channel();
        let _ = self.tx.send(Msg::Get(tx)).await;
        rx.await.unwrap_or(0)
    }
}

#[tokio::main]
async fn main() {
    let c = CounterHandle::new();
    c.inc().await; c.inc().await; c.inc().await;
    println!("{}", c.get().await); // 3
}
```

This is the actor pattern in 30 lines: a `tokio::spawn`ed loop owns the state, the `mpsc::Sender` is the mailbox handle, `oneshot` is the reply channel. The `state` variable is never touched by anyone outside the loop. The compiler enforces it via Rust's ownership rules.

### A Tiny Ping/Pong (Erlang)

```erlang
-module(ping_pong).
-export([start/0, ping/2, pong/0]).

start() ->
    Pong = spawn(?MODULE, pong, []),
    spawn(?MODULE, ping, [3, Pong]).

ping(0, Pong) ->
    Pong ! finished,
    io:format("ping finished~n");
ping(N, Pong) ->
    Pong ! {ping, self()},
    receive
        pong -> io:format("ping ~p~n", [N])
    end,
    ping(N - 1, Pong).

pong() ->
    receive
        finished -> io:format("pong finished~n");
        {ping, From} ->
            From ! pong,
            pong()
    end.
```

Two processes, no locks, no shared memory. The recursion-with-state pattern (`ping(N - 1, Pong)`) is how Erlang expresses "become" — the next call is the new behavior with the new state.

---

## Pros & Cons

**Pros**

- **No locks.** Inside an actor, code is single-threaded — race-free by construction.
- **High concurrency.** Lightweight actors (Erlang processes are ~ 300 bytes each) let you spawn millions.
- **Fault isolation.** A crash dies inside one actor without corrupting others.
- **Supervisor-driven recovery.** Restart policies are declarative and centralized.
- **Location transparency.** The same code works locally or distributed across a cluster.
- **Natural fit for entities.** Modeling sessions, devices, users, games is intuitive.
- **Backpressure surfaces early.** A slow actor's mailbox grows; you see it in metrics.

**Cons**

- **Mailbox = unbounded queue by default.** OOM risk if production isn't capped or backpressured.
- **Debugging is harder.** Stack traces show one message handler; the *cause* may be three messages ago.
- **Ordering only within an actor.** Cross-actor ordering is a design problem (use sequencing actors).
- **Synchronous-looking `ask` is a footgun.** Easy to deadlock or pile up futures.
- **Steeper learning curve.** "Where do I put this?" requires modeling identity, not classes.
- **Distributed actors are still distributed systems.** No magic — partitions, retries, idempotency apply.

---

## Use Cases

- **Telecom** — the original. Calls, sessions, signaling.
- **Online games** — one actor per player, one per match, one per zone.
- **IoT** — one actor per device, mailbox handles bursty telemetry.
- **Chat & messaging** — one actor per room, one per user session.
- **Trading / order books** — one actor per instrument serializes order matching.
- **Financial ledgers** — one actor per account; ordering and idempotency live there.
- **Event-sourced services** — Akka Persistence stores the actor's incoming events to disk.
- **Edge compute** — Orleans grains migrate; ideal for stateful microservices.

---

## Coding Patterns

### Pattern 1: Behavior Switching ("Become")

```scala
def door(): Behavior[Cmd] = closed()
def closed(): Behavior[Cmd] = Behaviors.receiveMessage {
  case Open  => open()
  case Knock => Behaviors.same
}
def open(): Behavior[Cmd] = Behaviors.receiveMessage {
  case Close => closed()
  case Knock => Behaviors.same
}
```

State machines map cleanly: each state is a function returning a `Behavior`.

### Pattern 2: Request-Reply With Correlation

```erlang
gen_server:call(Server, {get_balance, AccountId}).
```

Use the framework's `call`/`ask`. Behind the scenes it tags the message with a unique ID and matches the reply.

### Pattern 3: Child Per Workflow

When an incoming request kicks off a long workflow, spawn a child actor for it. The parent stays responsive; the child dies on completion or failure.

### Pattern 4: Router Actor

A "router" actor in front of N worker actors fans out messages. Strategies: round-robin, smallest-mailbox, broadcast. Built-in in Akka.

### Pattern 5: Sharding by Entity Key

`shard(user_id) -> actor_on_node`. Akka Cluster Sharding and Orleans both do this. Each user has exactly one live actor in the cluster.

---

## Clean Code

- **One message type per actor.** Define a `sealed trait Cmd` (Scala) / `enum Msg` (Rust) — the compiler enforces exhaustiveness.
- **Messages are dumb records.** No methods, no behavior. Just data.
- **Public API around the actor.** Wrap the actor in a `CounterHandle` (Rust) or `Counter` companion object (Scala). Callers shouldn't see the mailbox.
- **No `Any`/`Object` in messages.** Untyped messages are the road to runtime ClassCastException.
- **Stateless helper functions outside the actor.** Pure logic goes in module-level functions; the actor just orchestrates.
- **Idempotent handlers when possible.** Receiving the same message twice should not double-charge anybody.

---

## Best Practices

1. **Always bound the mailbox in production.** Unbounded mailboxes turn slow consumers into OOM.
2. **Never block inside an actor handler.** Offload blocking IO to a dedicated dispatcher or use async drivers.
3. **Prefer `tell` over `ask`.** `ask` is fine for occasional queries; never for hot paths.
4. **Make messages immutable values.** If using Java collections, pass `List.of(...)` or copies.
5. **Use supervision strategies deliberately.** Don't restart on a `MalformedInputException` — those will just crash again.
6. **Don't share an actor reference across deserialization boundaries casually.** Use entity IDs as the identity, look up the actor.
7. **Trace by correlation ID, not by stack.** Inject a request ID into every message; aggregate logs by it.
8. **Test actors by sending messages and asserting on replies / probes.** Don't reach into private state.

---

## Edge Cases & Pitfalls

- **Mailbox starvation.** A flood of low-priority messages can prevent high-priority ones from being processed. Solution: priority mailboxes (Akka supports this).
- **Self-deadlock with `ask`.** Actor A asks actor B which asks actor A. A is busy waiting for B; B is waiting for A. Deadlock.
- **State leaks via supervisor restart.** Default restart re-runs `init`; if you cached state in a static field, it survives the restart and you replay stale data.
- **At-most-once delivery.** Most actor frameworks promise at-most-once message delivery. Critical messages need idempotency or persistence.
- **Hot actor.** A single popular entity (e.g. *the* admin user) sees 100x traffic. One mailbox, one core — bottleneck. Solution: shard, replicate, or split.
- **Garbage `tell` to a dead actor.** Sent to dead letters; silently dropped. Easy to miss in tests.
- **Mailbox + serialization mismatch.** Pekko remoting fails if a message isn't serializable. Add tests that serialize-roundtrip every message type.

---

## Common Mistakes

- Treating actors as objects with public methods. They aren't — every "method call" is actually a message.
- Using `ask` everywhere because it returns a `Future`. You've just made the system synchronous behind a Future wrapper.
- Mutating message contents after sending. The recipient may still be reading them.
- Spawning a fresh actor per HTTP request, never stopping it. Slow leak.
- Storing references to children in a Map and forgetting to remove them on death. Memory leak.
- Catching every exception inside the handler. You just defeated supervision.
- Sharing a logger or counter across actors by mutating a static field. You smuggled shared state back in.
- Confusing "actor" with "thread". You typically have orders of magnitude more actors than threads.

---

## Tricky Points

- **Become without recursion.** Junior Erlang devs often write `handle_cast` and forget to tail-call the loop function — the actor exits silently.
- **One mailbox per actor, but many actors per thread.** A thread runs many actors cooperatively. If one handler is slow, others queued on the same dispatcher wait.
- **Sender identity.** Erlang gives you `self()`; Akka Typed forces you to pass `ActorRef[Reply]` explicitly. The classic API used implicit `sender()` and that hid bugs.
- **Stash.** When an actor is initializing or unavailable, you may want to "park" incoming messages and replay them later — Akka's `stash` does this.
- **Watch and DeathWatch.** A parent can `watch` a child and receive a `Terminated` message when it dies — used to drive supervision decisions.
- **Backpressure crosses actor boundaries via the mailbox.** Unlike CSP channels with explicit "send blocks when full", actor mailboxes are usually unbounded — so you must add explicit credit-based or ack-based flow control.

---

## Test Yourself

1. State Hewitt's three axioms in your own words. Why is "designate the next behavior" listed separately from "send a message"?
2. Explain how an actor avoids needing locks despite running concurrently with thousands of others.
3. What is a mailbox and who can read from it?
4. Sketch a `Counter` actor in your language of choice. Add a `Reset` command.
5. Why is Erlang's slogan "let it crash" not reckless?
6. Compare `tell` and `ask`. Give one situation where each is the right choice.
7. Name two anti-patterns when using actors and how to avoid them.
8. How does a supervisor decide what to do when a child crashes? Name the four common strategies.
9. What is the difference between an Akka `ActorRef` and an Orleans `IGrain` reference?
10. Sketch a request flow where two actors exchange messages to settle a bank transfer. How do you avoid double-debit if a message is redelivered?

---

## Tricky Questions

1. **If actors are sequential inside, how can you saturate a 64-core machine?** *(Spawn many actors; the runtime spreads them across cores. The sequentialism is per-actor, not global.)*
2. **An actor receives `Inc` 1000 times then `Get`. Could `Get` ever see a value < 1000?** *(No — FIFO per mailbox. Yes, only if `Get` comes from a different sender via a separate route that arrived first.)*
3. **Why is "actor-per-row" usually a bad idea?** *(Mailbox per actor + GC pressure + activation cost. Better: one actor per *interesting* entity.)*
4. **Two actors `ask` each other simultaneously. What happens?** *(Self-deadlock — both block waiting for the other's reply.)*
5. **You restart an actor. Does its mailbox survive?** *(Depends on the framework. Akka: by default mailbox is preserved; Erlang: a new process gets a new mailbox.)*
6. **Is "tell" delivery guaranteed?** *(At-most-once. Build idempotency or use a persistence layer for stronger guarantees.)*
7. **Why is Orleans called a "virtual" actor framework?** *(Grains are addressable by logical key whether activated or not. The runtime handles activation lazily.)*
8. **Can a parent's restart strategy contradict the child's exception?** *(Yes — restarting on `MalformedInputException` just loops; "let it crash" assumes the supervisor's restart actually clears the bad state.)*

---

## Cheat Sheet

```
+----------------------------------------------------------+
|                    ACTOR MODEL CHEAT SHEET               |
+----------------------------------------------------------+
| Axioms (Hewitt 1973)                                     |
|   1. spawn   - create more actors                        |
|   2. send    - message another (or self)                 |
|   3. become  - decide behavior for next message          |
+----------------------------------------------------------+
| Building blocks                                          |
|   Actor    = state + mailbox + handler                   |
|   Mailbox  = FIFO queue, one consumer (the actor)        |
|   Message  = immutable value                             |
+----------------------------------------------------------+
| Communication primitives                                 |
|   tell  : fire-and-forget       (cheap, async)           |
|   ask   : send + await reply    (use sparingly)          |
|   watch : be notified on death                           |
+----------------------------------------------------------+
| Supervision strategies                                   |
|   OneForOne   - restart just the crashed child           |
|   OneForAll   - restart all children                     |
|   RestForOne  - crashed child + those started after      |
|   Escalate    - tell my supervisor; I cannot handle      |
+----------------------------------------------------------+
| Frameworks                                               |
|   Erlang/OTP  Elixir   Akka/Pekko   Akka.NET             |
|   Orleans     Pony     CAF (C++)    Actix/Ractor (Rust)  |
+----------------------------------------------------------+
| Golden rules                                             |
|   - Never block inside a handler.                        |
|   - Prefer tell over ask.                                |
|   - Messages immutable, ideally serializable.            |
|   - Bound your mailboxes in production.                  |
|   - Let it crash. Let the supervisor decide.             |
+----------------------------------------------------------+
```

---

## Summary

The Actor Model is concurrency without shared memory. You replace locks and shared variables with isolated entities that own state and only interact through immutable messages dropped into private mailboxes. Hewitt's three axioms — spawn, send, become — are the entire formal model. Erlang made it industrial in the 1980s for telecom systems requiring extreme uptime; Akka, Orleans, Pony, and many others carry it into modern stacks.

Two ideas matter most at the junior level. First, **isolation**: because each actor processes one message at a time over private state, you write race-free code without thinking about locks. Second, **supervision and "let it crash"**: instead of defending every line, you isolate failure inside an actor and let a parent supervisor restart it with clean state. Combined, these two ideas explain how systems like the AXD301 telephone switch hit nine 9s of availability with thousands of programmers contributing.

As you move forward, treat actors as model-level entities (a user, a session, a device, an order) rather than fine-grained primitives. Use `tell` by default. Bound mailboxes. Test by message exchange. Once those habits are second nature, you can move on to the middle-level topics — typed protocols, persistence, sharding, and clustering.

---

## What You Can Build

- **A chat server** where each room is an actor and each user session is an actor.
- **A multiplayer game backend** with one actor per player and one per match.
- **An IoT telemetry pipeline** with one actor per device that buffers and aggregates readings.
- **A small URL shortener with rate limits** where each client is a small actor tracking its token bucket.
- **A toy trading engine** where each ticker symbol is an actor owning the order book — naturally serialized matching.
- **A bank ledger demo** with one actor per account, processing transfers as messages.
- **A workflow orchestrator** where each long-running workflow is a child actor of a coordinator.

---

## Further Reading

- Joe Armstrong — *Making Reliable Distributed Systems in the Presence of Software Errors* (PhD thesis, 2003). The definitive justification of "let it crash" and supervisor trees.
- Joe Armstrong — *Programming Erlang: Software for a Concurrent World*, Pragmatic Bookshelf. The friendly entry point.
- Carl Hewitt, Peter Bishop, Richard Steiger — *A Universal Modular Actor Formalism for Artificial Intelligence* (1973). The original paper.
- Akka / Apache Pekko documentation — `https://pekko.apache.org/` for the modern open-source successor of Akka.
- Microsoft Orleans documentation — `https://learn.microsoft.com/dotnet/orleans/` for the virtual actor model in .NET.
- Sebastian Blessing — *A String of Ponies* (master's thesis introducing Pony's actor model).
- Vaughn Vernon — *Reactive Messaging Patterns with the Actor Model*, Addison-Wesley.
- "Designing for Scalability with Erlang/OTP" — Cesarini and Vinoski, O'Reilly.
- Akka official guide *"Actor model — the world isn't shared memory"* — short, motivating intro.

---

## Related Topics

- [Middle Level](middle.md) — typed protocols, ask patterns, stash, cluster sharding, persistence.
- [Senior Level](senior.md) — supervision design, backpressure across actor boundaries, distributed actors, location transparency tradeoffs.
- [Professional Level](professional.md) — large-scale operational topics: rolling upgrades, hot reload, cross-cluster sharding, multi-DC topologies.
- [Interview Questions](interview.md) — actor-model questions you'll see in Erlang/Scala/.NET interviews.
- [Tasks](tasks.md) — exercises ranging from a Counter to a tiny chat server.
- [Shared Memory Model](../01-shared-memory/junior.md) — what actors deliberately avoid.
- [Message Passing](../02-message-passing/junior.md) — the underlying primitive.
- [CSP Model](../04-csp/junior.md) — the close cousin (Go's goroutines + channels).

---

## Diagrams & Visual Aids

### A single actor with its mailbox

```
   incoming messages
   -------->-------->--------+
                             v
                  +---------------------+
                  |       MAILBOX       |   FIFO queue
                  |  [m3][m2][m1] <-----|---  (head -> handler)
                  +----------+----------+
                             |
                             v
                  +---------------------+
                  |        ACTOR        |
                  |  - private state    |
                  |  - handler(msg)     |
                  |    -> new state     |
                  |    -> outgoing      |
                  +----------+----------+
                             |
                             v
                  outgoing messages (tells)
```

### A supervisor tree

```
                        +----------------+
                        | RootSupervisor |
                        +-------+--------+
                                |
              +-----------------+-----------------+
              |                                   |
      +-------+-------+                   +-------+-------+
      | UsersSuperv.  |                   | OrdersSuperv. |
      +-------+-------+                   +-------+-------+
              |                                   |
        +-----+-----+                       +-----+-----+
        |     |     |                       |     |     |
    +---+-+ +-+--+ +-+--+               +---+-+ +-+--+ +-+--+
    | U1  | | U2 | | U3 |               | O1  | | O2 | | O3 |
    +-----+ +----+ +----+               +-----+ +----+ +----+

    Failure flow:
       U2 crashes  -->  UsersSuperv applies OneForOne
                        --> just U2 is restarted
       UsersSuperv crashes --> RootSupervisor decides
                               (restart subtree / escalate)
```

### Message flow between two actors

```
   Caller                    Counter actor
     |                              |
     |---- Inc -------------------->|  (mailbox: [Inc])
     |---- Inc -------------------->|  (mailbox: [Inc, Inc])
     |---- Get(replyTo=Caller) ---->|  (mailbox: [Inc, Inc, Get])
     |                              |
     |                       handler processes one at a time:
     |                          state 0 -> 1 -> 2
     |                          on Get: send back current value
     |<----------- 2 ---------------|
     |                              |
```

### Erlang process vs OS thread (scale)

```
   OS threads (kernel):     [T1] [T2] [T3] [T4]    (a handful)
                              |    |    |    |
                              v    v    v    v
   BEAM scheduler runs:     [A1][A2][A3][A4][A5]...[Aₙ]
                            |   |   |   |   |       |
                            v   v   v   v   v       v
                          ~ millions of actors, preemptively scheduled

   Each actor ~= 300 bytes + its mailbox.
   No 1:1 mapping. Many actors per thread. Thread count is irrelevant
   for actor count.
```

### Tell vs Ask

```
   tell  (one-way, fast)                  ask  (request/reply)
   ----------------------                 -------------------------
   A -- msg --> B                         A -- {msg, replyTo} --> B
                                                                |
                                                                v
                                          A <----- reply -------/
                                          (A awaits a Future/Task)
```

Use `tell` by default. Reach for `ask` only when you actually need the answer to continue.

---

*End of Junior Level — proceed to [`middle.md`](middle.md) for typed protocols, the stash, request/response correlation, and supervisor strategies in depth.*
