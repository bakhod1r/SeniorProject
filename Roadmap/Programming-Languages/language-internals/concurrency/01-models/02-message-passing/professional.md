# Message-Passing Concurrency — Professional Level

> **Topic:** [Message-Passing](README.md)
> **Focus:** library design, distributed actors, persistence, anti-patterns

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

At the professional level, message-passing stops being a coding style and starts being an architecture. You are not asking "should I use a mutex or a channel?" — you are asking "what is the topology of my system, where does state live, who owns each piece of it, what happens when a node dies, and how do I reason about the resulting tangle on Friday at 3am?"

The professional message-passing engineer designs libraries that other engineers use without shooting themselves in the foot. They know why Erlang's transparent location was a brilliant lie, why Akka eventually deprecated it, why Orleans virtualized actors, why Tokio's actors are intentionally bare-bones, and why every actor framework eventually grows a persistence layer that looks suspiciously like Kafka.

This level covers the parts the textbooks skip: the trade-offs between message-passing and shared-memory at scale, the operational reality of distributed actors, the seductive trap of synchronous ask-patterns, and how to migrate a five-million-line thread-pool codebase to an actor model without your CTO firing you.

Refactoring.guru tone: concrete patterns, sharp opinions, no hand-waving.

---

## Prerequisites

Before reading this professional treatment, you should be comfortable with:

- Senior-level message-passing material (supervision trees, backpressure, mailbox semantics).
- At least one mature actor framework: Erlang/OTP, Akka, Orleans, Akka.NET, or Actix.
- Distributed systems fundamentals: CAP theorem, idempotency, exactly-once myths, leader election.
- Event sourcing and CQRS at the conceptual level — you should know what an aggregate root is.
- Production debugging: heap dumps, flame graphs, distributed tracing (OpenTelemetry, Jaeger).
- Kafka or a comparable log-based broker — partitioning, consumer groups, offsets.
- Network protocols: gRPC, HTTP/2, TCP backpressure, TLS handshake cost.

If three or more of those feel shaky, drop back to `senior.md` and revisit.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Actor library** | A package that gives you actor primitives without the full OTP-style runtime. |
| **Actor framework** | A runtime that owns scheduling, lifecycle, supervision, and distribution. |
| **Location transparency** | Sending to an actor without knowing whether it is local or remote. |
| **Virtual actor** | Orleans-style actor that exists logically forever but is activated on demand. |
| **Grain** | Orleans's name for a virtual actor identified by a primary key. |
| **Cluster sharding** | Akka pattern that distributes actors across nodes by stable shard key. |
| **Event sourcing** | Persisting state as an append-only log of events; current state is a fold. |
| **Snapshot** | Periodic compact representation of state to bound replay time. |
| **Saga** | Long-running workflow composed of local transactions and compensations. |
| **Compensation** | Inverse action that semantically undoes a previous step in a saga. |
| **Idempotency key** | Token attached to a message so duplicates are detected. |
| **Mailbox depth** | Current count of pending messages in an actor's inbox. |
| **Ask-pattern** | Request/response over message passing using a temporary reply actor. |
| **Chatty actor** | Actor that exchanges many small messages where a single batch would do. |
| **Pi-calculus** | Process calculus where channel names themselves can be sent as messages. |
| **CSP** | Hoare's Communicating Sequential Processes; channels rather than mailboxes. |
| **RDMA** | Remote Direct Memory Access; networking primitive bypassing the CPU. |
| **NVDIMM** | Non-volatile DIMM; memory-class storage that persists across reboots. |
| **Backpressure protocol** | Explicit two-way flow control between sender and receiver. |

---

## Core Concepts

### Designing a message-passing library

If you write your own actor library — and at some point a professional probably will, even if only internally — you face a sequence of API decisions that compound. Let us walk through them in the order they bite.

**The send primitive.** Is `send` infallible (Erlang-style, queues forever) or fallible (`try_send` returns `Result`)? Erlang chose infallible because programmers cannot be trusted to handle every failure path, but the price is unbounded mailboxes that crash nodes. Akka chose bounded mailboxes with overflow strategies. Tokio's `mpsc` is fallible by default; you opt into unbounded. There is no right answer, but you must pick one and document the consequences loudly.

**Address type.** Do you expose `ActorRef<Message>` (typed) or `ActorRef` (untyped)? Akka migrated from untyped to typed in 2.6 because untyped refs hide protocol violations until production. Typed refs cost compile complexity but pay back at every refactor. Pick typed unless your language fights you.

**Supervision.** Do you build supervision into the library, or leave it to user code? If you leave it out, every team reinvents it badly. If you build it in, you must answer: who owns the strategy (parent, child, system)? Are restarts cheap or expensive? What state survives restart?

**Lifecycle hooks.** `pre_start`, `post_stop`, `pre_restart`, `post_restart`. Each one is a chance for resource leaks. A library that does not nail down lifecycle leaks file descriptors, sockets, and goroutines forever.

**Scheduling.** Cooperative (actors yield at message boundaries) or preemptive (runtime interrupts)? Erlang uses reduction-count preemption. Akka uses cooperative dispatch with optional throughput hints. Tokio is cooperative with explicit `yield_now()`. Preemption is gentler on user error; cooperation is faster.

**Persistence.** Do you build event sourcing in or leave it to a sidecar? Akka built `akka-persistence`. Orleans built `IGrainState`. Most modern frameworks leave it as an optional module because the persistence story is large enough to be a library by itself.

**Distribution.** Transparent or explicit? More on this trade-off below.

### Comparative analysis: Erlang/OTP vs Akka vs Orleans vs Pony vs Tokio actors

| Aspect | Erlang/OTP | Akka | Orleans | Pony | Tokio actors |
|--------|------------|------|---------|------|--------------|
| Origin | Ericsson, 1986 | Lightbend, 2009 | Microsoft Research, 2010 | CMU, 2014 | Async Rust ecosystem |
| Language | Erlang/Elixir | Scala/Java | C# | Pony | Rust |
| Identity | PID | ActorRef | Grain key | Tag | Channel handle |
| Mailbox | Unbounded by default | Configurable | Implicit | Causal | mpsc / broadcast |
| Supervision | OTP supervisors | Akka supervision | Silo-managed | None built-in | DIY |
| Persistence | Mnesia + custom | akka-persistence | Grain state | DIY | DIY |
| Distribution | Built-in, transparent | Cluster + sharding | Built-in virtual | Single node | Out of scope |
| Hot code reload | First class | Limited | No | No | No |
| Type safety | Dynamic | Typed (since 2.6) | Strong .NET | Capability-typed | Strong Rust |
| Sweet spot | Telecom, IoT, real-time | JVM enterprise | Cloud-scale gaming/IoT | Research, safety-critical | Network services |
| Killer feature | Soft real-time + transparent distribution | Cluster sharding | Virtual actors | Data-race-free by type | Zero-cost async |
| Biggest weakness | Dynamic typing | Steep learning curve | Vendor-tied to .NET | Tiny ecosystem | No batteries |

The right framing: each framework reflects the constraints of its origin domain. Erlang exists because Ericsson telecom switches must achieve nine nines of uptime with hot upgrades. Akka exists because JVM shops needed Erlang-style guarantees with Java/Scala interop. Orleans exists because Microsoft Halo backend needed actors that survived server churn without manual placement. Pony exists because researchers wanted to prove data-race freedom in the type system. Tokio's actor flavor exists because Rust gives you primitives, not opinions.

Choose accordingly. A Halo-style game backend on Akka is harder than necessary; an enterprise CRUD service in Pony is academic.

### Distributed message passing

The dream of distributed actors is location transparency: send to a PID, do not care which node it lives on. Erlang shipped this in 1986. It was beautiful and it was a lie.

The lie is that local sends and remote sends have wildly different failure modes. Local send is non-failing and microsecond-fast. Remote send may fail, may arrive out of order with other senders, may take seconds during a network partition. Pretending they are the same generates code that is correct in tests and catastrophic in production.

Modern frameworks address this in three ways:

**Path 1: Transparent with caveats (Erlang, Akka).** The API looks identical for local and remote, but documentation screams that you must handle network failures. Reality: most teams ignore the documentation until they get burned.

**Path 2: Explicit remote (gRPC, NATS).** You write `client.send(...)` and the call obviously goes over the wire. Failure modes are in your face. Trade-off: no longer feels like actors, more like RPC.

**Path 3: Virtual actors (Orleans).** The framework owns placement. Your code says `GetGrain<IPlayer>(playerId).MoveAsync(...)`; the runtime activates the grain somewhere, routes the call, and migrates it under load. You never see PIDs. Failure modes still exist but the framework absorbs many of them.

For Kafka and NATS-based message passing, the actor analogy stretches. Kafka topics are unbounded persistent logs; consumers are not actors but stateless workers replaying partitions. This is closer to event sourcing than actor model, but the message-passing discipline still applies: senders never share memory with consumers; coordination is through messages alone.

| Transport | Latency | Ordering | Delivery | Backpressure | Use when |
|-----------|---------|----------|----------|--------------|----------|
| Erlang distribution | ~50 us LAN | Per sender-receiver pair | At most once | TCP-level | OTP cluster |
| Akka remoting (Artery) | ~100 us LAN | Per sender-receiver pair | At most once | Flow control | Akka cluster |
| gRPC unary | ~1 ms LAN | None | Exactly one attempt | None | RPC bridges |
| gRPC streaming | ~1 ms LAN | Per stream | Per attempt | HTTP/2 flow | Long-lived flows |
| NATS Core | ~100 us LAN | None | At most once | None | Fire and forget |
| NATS JetStream | ~1 ms LAN | Per stream | At least once | Pull-based | Persistent streams |
| Kafka | ~5 ms LAN | Per partition | At least once | Consumer-driven | Event sourcing, durable log |

### Persistence and event sourcing

A persistent actor stores its state as an append-only log of events. Current state is the fold of all past events. Crash recovery is replay.

```
Event log for actor User#42:
1. CreatedUser{name: "Alice"}
2. ChangedEmail{email: "alice@a.com"}
3. ChangedEmail{email: "alice@b.com"}

Current state = fold(events, initial) = User{name: "Alice", email: "alice@b.com"}
```

Three patterns dominate:

**Pure event sourcing.** Actor processes a command, validates against current state, emits an event, persists it, then applies the event to mutate state. On restart, replay all events from the beginning.

**Event sourcing with snapshots.** Same as above, but every N events the actor writes a snapshot. On restart, load latest snapshot then replay tail events only. Bounded recovery time at the cost of snapshot complexity.

**CQRS — Command Query Responsibility Segregation.** Writes go to event-sourced actors; reads are served from denormalized projections built by separate consumers. Reads are eventually consistent; writes are strongly consistent within the aggregate boundary.

The pitfalls of event sourcing are real:

- **Schema evolution.** Events are immutable; you cannot change `UserCreated` after it ships. You version events and write upcasters.
- **Replay performance.** A ten-year-old actor with a million events takes minutes to recover unless you snapshot.
- **Event design.** Events are part of your public contract. Naming them after CRUD verbs (`UserUpdated`) leaks implementation; naming them after business intent (`EmailCorrected`, `EmailChangedAfterMarriage`) preserves history.
- **Storage costs.** Append-only logs grow forever. You need retention policies, tiered storage, or compaction.

### Migrations — from shared-memory threading to actor model

You inherit a 500k-line monolith with a thread pool, ten locks, and weekly deadlock outages. Management says "let us migrate to actors." Here is the realistic path.

**Step 1: Map the state.** List every piece of mutable state and its current synchronization. You will find that "thread-safe" usually means "we hope so."

**Step 2: Identify natural actors.** State that is accessed together belongs to one actor. State that is rarely correlated belongs to separate actors. Drawing this map is 80 percent of the migration.

**Step 3: Build the strangler.** Introduce an actor system alongside the existing code. Route new features through actors. Keep the old thread pool running.

**Step 4: Migrate one bounded context at a time.** Start with the noisiest, most outage-prone subsystem. Migrate to actors. Measure latency, throughput, error rate. If the numbers are worse, you migrated wrong — actors should improve a contended subsystem.

**Step 5: Delete the locks.** Only after a subsystem is fully on actors. Removing locks while shared-memory code still calls in is how you ship races.

Be honest about the trade-offs:

- Actors increase per-message latency (queue + dispatch + processing) versus an inline lock-free read.
- Actors complicate debugging — stack traces are split across mailboxes.
- Actors blow up the number of moving parts; observability bills go up.

Wins to expect: fewer deadlocks, easier fault isolation, clearer state boundaries, smoother horizontal scale.

### Sagas — long-running flows

A saga is a sequence of local transactions where each step has a compensating action. If step 4 fails, you run the compensations for steps 3, 2, 1 in reverse.

Classic example: book a trip = reserve flight + reserve hotel + reserve car. If car reservation fails, cancel hotel, cancel flight.

Two implementations:

**Orchestration saga.** A coordinator actor knows the sequence and calls each step in turn. Failures route back to the coordinator, which dispatches compensations.

**Choreography saga.** No coordinator. Each step listens for upstream events and emits its own. Compensations are triggered by failure events.

Orchestration is easier to reason about, harder to scale. Choreography is the opposite. Mixed designs are common: choreography within a bounded context, orchestration across contexts.

Idempotency is mandatory. Every compensation must be safe to run twice, because at-least-once delivery means it will be.

### Observability

A production actor system is opaque without instrumentation. You need:

- **Per-actor mailbox depth.** Spikes indicate slow handlers or upstream surges.
- **Message latency histograms.** P50, P95, P99 from enqueue to handler completion, per message type.
- **Restart counters.** Frequent restarts mean unstable supervision or a broken invariant.
- **Cluster membership events.** Joins, leaves, unreachables.
- **Distributed traces.** Span per message, propagated via headers. OpenTelemetry has actor-aware exporters.
- **Dead letters.** Every undelivered message is a bug or a race condition; surface them in dashboards.

The classic mistake is logging every message. Log the message *type* and a correlation ID, not the payload. Logs are a tracing tool, not a journal.

### Anti-patterns

**Chatty actors.** Actor A pings actor B for one field, then again for another, then again. Each message is cheap but cumulative latency kills throughput. Fix: batch reads, expose larger query messages, or denormalize.

**Sync RPC over async actors.** Wrapping `ask` in `await` everywhere converts async actors into synchronous RPC with extra steps. You lose the throughput benefit and gain queue overhead. Fix: design protocols that flow forward — A tells B, B tells C, C tells D — rather than A asking B asking C asking D.

**Ask-pattern misuse.** `ask` (request/response) creates a temporary reply actor per call. At ten thousand requests per second, you allocate ten thousand throwaway actors per second. Fix: use `tell` and route replies through a stable reply address; reserve `ask` for low-frequency administrative calls.

**Ever-growing mailboxes.** Unbounded mailboxes silently absorb backpressure until the heap explodes. Fix: bounded mailboxes with explicit overflow policies (drop oldest, drop newest, fail sender).

**Actor-per-row.** Spawning one actor per database row gives you billions of actors. Most go idle. Memory explodes. Fix: aggregate roots own collections; use virtual actors (Orleans) if you really need per-entity isolation.

**God actor.** One actor handles all of accounts, billing, and notifications. Bottleneck and single point of failure. Fix: split by bounded context.

**Hidden shared state.** Two actors hold references to the same mutable object passed in a message. Race conditions return. Fix: send immutable value types; if the language permits, use linear or move semantics.

**Naked `this` in messages.** Sending an actor reference to `self` to others, then receiving messages that close over the reference. Garbage collection is now confused; the actor cannot stop. Fix: send a typed envelope, not raw references.

### Theoretical foundations

Three theoretical lineages converge in modern message-passing:

**Carl Hewitt's Actor Model (1973).** Hewitt argued that the natural unit of computation is an actor: an entity that processes messages one at a time, can create new actors, and can change its behavior for the next message. There is no shared memory. The model is inherently concurrent. Erlang is the most faithful incarnation.

**Robin Milner's Pi-calculus (1980s).** A process calculus where channel names themselves can be passed as messages, enabling dynamic topology. Pi-calculus is the theoretical foundation for mobile processes and Go-style channel passing.

**Tony Hoare's CSP (1978).** Communicating Sequential Processes — synchronous channels between named processes. Go channels are the most popular CSP descendant, although Go relaxes synchrony with buffered channels.

The Actor Model and CSP differ in two important ways:

| Property | Actor model | CSP |
|----------|-------------|-----|
| Identity | Actor has identity (address) | Channel has identity, not process |
| Synchrony | Asynchronous send | Synchronous rendezvous (classical CSP) |
| Topology | Dynamic via address passing | Static channel graph |
| Buffering | Mailbox per actor | Often no buffer (rendezvous) |

In practice, Go's buffered channels and Erlang's reduction-bounded scheduling have converged toward a similar middle ground. The theoretical purity matters less than how the abstraction holds up under failure.

### Hardware trends — RDMA, NVDIMM, message-passing in 10 years

Two hardware trends will reshape message-passing this decade.

**RDMA (Remote Direct Memory Access).** Networks like InfiniBand and modern Ethernet with RoCEv2 let one machine read or write another machine's memory without involving the remote CPU. Latencies drop into the single-microsecond range. This pushes "remote" closer to "local" than ever, weakening the cost argument for keeping actors on the same node.

Implication: actor frameworks will increasingly assume cheap remote operations, allowing finer-grained sharding and more dynamic placement. Akka Artery already uses RDMA-style techniques. Future Orleans-style runtimes may treat the cluster as a single shared memory.

**NVDIMM and persistent memory.** Memory-class storage that survives power loss. Writing an event to persistent memory takes nanoseconds instead of milliseconds. Event sourcing becomes cheaper than in-memory state because the durability cost approaches zero.

Implication: every actor becomes persistent by default. Snapshots become unnecessary because every state mutation is already durable. The boundary between in-memory and on-disk dissolves.

**Long term: actor model as the OS abstraction.** The combination of RDMA, persistent memory, and many-core CPUs makes the actor model a natural OS abstraction. Future research operating systems (Barrelfish, seL4 derivatives) already think this way. Your application code in 2035 may run inside an actor-shaped kernel where threading, IPC, and storage all collapse into one primitive.

### Picking the right model

A pragmatic decision matrix:

| Constraint | Pick |
|------------|------|
| Sub-millisecond local latency, single node | Channels (Go, Tokio mpsc) |
| Need supervision and hot upgrade | Erlang/OTP |
| JVM shop, need clustering | Akka |
| .NET shop, need cluster-scale | Orleans |
| Audit log is the source of truth | Kafka + event-sourced consumers |
| Many small autonomous services | NATS or gRPC streaming |
| Research, want type-safe data-race freedom | Pony |
| Embedded systems, hard real-time | Custom CSP-style scheduler |

Avoid choosing the framework you read about last. Choose the framework whose failure modes you are willing to live with.

### Team and code-review heuristics

When reviewing actor code, ask:

1. **Where is the state?** Every mutable field should live inside exactly one actor.
2. **Are messages immutable?** Hidden shared references defeat the whole model.
3. **Is the protocol typed?** Untyped `Any` messages are deferred bugs.
4. **What happens on restart?** Replay path, state reset, in-flight messages.
5. **Are there ask-patterns in hot paths?** Almost always wrong.
6. **Is the mailbox bounded?** Unbounded is acceptable only at the edge.
7. **Are messages traced?** Without correlation IDs you will not debug production.
8. **What is the supervision strategy?** Default `restart-on-failure` is rarely correct.
9. **Is there a saga?** If a flow crosses three actors, it is a saga whether you wrote one or not.
10. **What does the failure runbook say?** If your team cannot answer this, you do not have an actor system; you have a maze.

---

## Real-World Analogies

| Analogy | What it illustrates |
|---------|--------------------|
| Postal service network | Distributed actors; mail routes through hubs you do not control |
| Air traffic control with multiple towers | Cluster of supervisors, handoff between regions |
| Banking branch network with central settlement | Sharded write actors + central event log |
| Hospital with departments, transfers, and discharge summaries | Sagas with compensations between bounded contexts |
| Restaurant chain franchise | Virtual actors — the brand exists logically; the physical kitchen activates on demand |
| Ship's log | Event sourcing — every action recorded, current state is the integral |
| Diplomatic cable traffic | Location-transparent messaging; sender does not know which embassy will receive |
| Manufacturing assembly line | Pipeline of actors; backpressure when downstream is slow |
| Call center with escalation tree | Supervision hierarchy; supervisor handles what the agent cannot |

---

## Mental Models

**The actor as a microservice with a mailbox.** At sufficient scale, an actor *is* a microservice: own state, own lifecycle, own deployment unit (logically). Treat protocol design with the same care.

**Event log as time machine.** Event sourcing makes the past replayable. Every bug becomes reproducible by replaying events. Every audit becomes a query against history.

**The mailbox is the queue between two systems.** Treat every actor-to-actor edge as a system boundary with its own SLO. P99 latency, error rate, message rate.

**Distribution is failure injection in slow motion.** Every remote send is a distributed systems problem with all the canonical failures: latency, partial failure, network partition, duplicate delivery. The local-remote symmetry of transparent actors hides this until production. Embrace it; do not deny it.

**Supervision is a state machine.** Crash, decision, restart, observe. Every restart is a transition. Track them.

---

## Code Examples

### Example 1 — Chat server with actors (Akka-style, pseudocode)

```scala
// Three actor types: ChatRoom, User, PresenceTracker
sealed trait RoomCommand
case class Join(user: ActorRef[UserCommand]) extends RoomCommand
case class Leave(user: ActorRef[UserCommand]) extends RoomCommand
case class PostMessage(from: String, text: String) extends RoomCommand

sealed trait UserCommand
case class Deliver(from: String, text: String) extends UserCommand
case object Disconnect extends UserCommand

sealed trait PresenceCommand
case class Online(userId: String) extends PresenceCommand
case class Offline(userId: String) extends PresenceCommand

object ChatRoom {
  def apply(roomId: String, presence: ActorRef[PresenceCommand]): Behavior[RoomCommand] =
    Behaviors.setup { ctx =>
      var members = Set.empty[ActorRef[UserCommand]]

      Behaviors.receiveMessage {
        case Join(user) =>
          members += user
          presence ! Online(user.path.name)
          ctx.watchWith(user, Leave(user))  // auto-cleanup on user death
          Behaviors.same

        case Leave(user) =>
          members -= user
          presence ! Offline(user.path.name)
          Behaviors.same

        case PostMessage(from, text) =>
          members.foreach(_ ! Deliver(from, text))
          Behaviors.same
      }
    }
}

object User {
  def apply(userId: String, socket: WebSocket): Behavior[UserCommand] =
    Behaviors.receiveMessage {
      case Deliver(from, text) =>
        socket.send(s"$from: $text")
        Behaviors.same
      case Disconnect =>
        socket.close()
        Behaviors.stopped
    }
}
```

The room uses `ctx.watchWith` so it learns when a user actor stops — no manual cleanup. PresenceTracker is a separate actor so presence broadcasts do not block room messaging.

### Example 2 — Migrating a thread pool to actors

Before — a contended counter behind a lock:

```java
public class HotCounter {
    private final ReentrantLock lock = new ReentrantLock();
    private long count;

    public void increment() {
        lock.lock();
        try { count++; } finally { lock.unlock(); }
    }

    public long get() {
        lock.lock();
        try { return count; } finally { lock.unlock(); }
    }
}
```

At a thousand threads incrementing simultaneously, this serializes everything on `lock`. CPU profile shows 60 percent of time in lock acquisition.

After — actor with batched updates:

```scala
sealed trait CounterCommand
case object Tick extends CounterCommand
case class Get(replyTo: ActorRef[Long]) extends CounterCommand
case object Flush extends CounterCommand

object CounterActor {
  def apply(): Behavior[CounterCommand] = Behaviors.setup { ctx =>
    var count = 0L
    var batch = 0L
    ctx.scheduleOnce(50.millis, ctx.self, Flush)

    Behaviors.receiveMessage {
      case Tick =>
        batch += 1
        if (batch >= 1000) { count += batch; batch = 0 }
        Behaviors.same
      case Flush =>
        count += batch; batch = 0
        ctx.scheduleOnce(50.millis, ctx.self, Flush)
        Behaviors.same
      case Get(replyTo) =>
        replyTo ! (count + batch)
        Behaviors.same
    }
  }
}
```

Measurable wins: P99 latency of `increment` drops from 8ms (lock contention) to 50us (channel send). Total throughput rises 4x because the actor batches updates instead of contending on a single cache line.

Measurable losses: `Get` is now eventually consistent — it sees `count + batch`, but if a Tick is in flight the value lags. Memory overhead per actor is ~500 bytes plus the mailbox; at one actor it is negligible, at a million actors plan accordingly.

### Example 3 — Ask-pattern anti-pattern

The seductively wrong code:

```scala
// In OrderService
def placeOrder(order: Order): Future[Result] = {
  for {
    stock <- (inventory ? CheckStock(order.sku)).mapTo[StockReply]
    price <- (pricing ? GetPrice(order.sku)).mapTo[PriceReply]
    user <- (users ? GetUser(order.userId)).mapTo[UserReply]
    confirmation <- (payments ? Charge(user.card, price.total)).mapTo[ChargeReply]
  } yield Result(confirmation.id)
}
```

What is wrong:

- Four sequential ask-calls. Each spawns a temporary reply actor and a future. At 10k orders/sec that is 40k throwaway actors/sec.
- Failure of any step propagates as a `Future.failed`; the caller has no idea what to do.
- Total latency is the sum of four network round-trips because the asks are sequential, not parallel.
- The OrderService now blocks waiting for replies; it has become a synchronous orchestrator with extra steps.

The corrected design uses a saga actor and tell-flow:

```scala
sealed trait OrderEvent
case class OrderStarted(orderId: String) extends OrderEvent
case class StockChecked(orderId: String, available: Boolean) extends OrderEvent
case class PriceQuoted(orderId: String, total: Money) extends OrderEvent
case class PaymentCharged(orderId: String, txId: String) extends OrderEvent
case class OrderCompleted(orderId: String) extends OrderEvent
case class OrderFailed(orderId: String, reason: String) extends OrderEvent

object OrderSaga {
  def apply(order: Order, eventBus: ActorRef[OrderEvent]): Behavior[Any] =
    Behaviors.setup { ctx =>
      // tell all three concurrently, await joins
      inventory ! CheckStock(order.sku, ctx.self)
      pricing ! GetPrice(order.sku, ctx.self)
      users ! GetUser(order.userId, ctx.self)
      collecting(order, ctx, eventBus, None, None, None)
    }

  def collecting(order: Order, ctx: ActorContext[Any], bus: ActorRef[OrderEvent],
                 stock: Option[Boolean], price: Option[Money], user: Option[User]): Behavior[Any] =
    // pattern match incoming, transition when all three arrived, then charge
    ???
}
```

Now you have:

- One actor per order (cheap; goes away on completion).
- Concurrent fan-out instead of serial asks.
- Explicit state machine that supervisors can restart.
- Domain events on an event bus for observability and downstream consumers.

### Example 4 — Kafka-backed event-sourced actor

```scala
// Account aggregate, events persisted to Kafka topic "accounts.events"
sealed trait AccountCommand
case class Deposit(amount: Money, replyTo: ActorRef[Ack]) extends AccountCommand
case class Withdraw(amount: Money, replyTo: ActorRef[Ack]) extends AccountCommand

sealed trait AccountEvent
case class Deposited(amount: Money, ts: Instant) extends AccountEvent
case class Withdrew(amount: Money, ts: Instant) extends AccountEvent

case class AccountState(balance: Money, version: Long) {
  def apply(e: AccountEvent): AccountState = e match {
    case Deposited(amt, _) => copy(balance = balance + amt, version = version + 1)
    case Withdrew(amt, _)  => copy(balance = balance - amt, version = version + 1)
  }
}

object AccountActor {
  def apply(accountId: String, journal: Journal): Behavior[AccountCommand] =
    Behaviors.setup { ctx =>
      val initial = journal.replay(accountId).foldLeft(AccountState(Money.zero, 0))(_ apply _)
      var state = initial

      Behaviors.receiveMessage {
        case Deposit(amt, replyTo) =>
          val event = Deposited(amt, Instant.now)
          journal.append(accountId, event).foreach { _ =>
            state = state.apply(event)
            replyTo ! Ack(state.version)
          }
          Behaviors.same

        case Withdraw(amt, replyTo) if state.balance >= amt =>
          val event = Withdrew(amt, Instant.now)
          journal.append(accountId, event).foreach { _ =>
            state = state.apply(event)
            replyTo ! Ack(state.version)
          }
          Behaviors.same

        case Withdraw(_, replyTo) =>
          replyTo ! Nack("insufficient funds")
          Behaviors.same
      }
    }
}
```

The journal is Kafka with key = `accountId` so all events for one account land on one partition (and therefore in order). On actor startup, replay reads all events for that account; on each command, append before acknowledging. Crash recovery is identical to cold startup — replay from beginning, or from latest snapshot if you added one.

For production scale you add: snapshots every N events, idempotency keys on commands, exactly-once semantics via Kafka transactions, and a read-side projection consumer that builds a materialized view for queries.

---

## Pros & Cons

### Pros at the professional level

- Bounded contexts are physically enforced — each actor owns its state, period.
- Fault isolation up to the supervision boundary; a misbehaving actor does not corrupt neighbors.
- Persistence and event sourcing fit naturally; the actor's behavior is "fold the log."
- Distributed deployment is incremental — most code is unchanged when an actor moves to another node.
- Auditing, replay, and compliance are first-class.
- Horizontal scale by sharding actors across nodes.

### Cons at the professional level

- Operational surface is large — tracing, mailbox metrics, dead letters, cluster events.
- Schema evolution of events is forever; you carry every old event format.
- Distributed actors expose every CAP-theorem reality the abstraction promised to hide.
- Hot paths suffer from per-message overhead; CPU caches do not love mailbox indirection.
- Debugging is non-linear — stack traces do not span actor boundaries; you need correlation IDs and traces.
- Talent pool is narrower than for "Java + Spring."

---

## Use Cases

- Telecom switches, signaling networks, and 5G control planes.
- Massively multiplayer game servers (Halo, EVE Online, World of Tanks).
- IoT device shadows — one virtual actor per device.
- Financial trading systems with per-account aggregates and event-sourced ledgers.
- Real-time collaboration backends (Figma, Notion-style multi-user editing).
- Stream-processing pipelines built on Akka Streams, Flink, or Kafka Streams.
- Distributed workflow engines (Cadence, Temporal — which are actors-with-different-marketing).
- Robotic and autonomous vehicle control planes where soft real-time matters.

---

## Coding Patterns

**Typed protocols.** Every actor exposes a sealed trait of commands; every reply is a sealed trait of responses. Untyped `Any` is forbidden.

**Reply-to addresses.** Commands carry `replyTo: ActorRef[Response]` rather than relying on `sender()`. Easier to test, easier to forward.

**Behavior as state machine.** Use the framework's "become" mechanic (`Behaviors.receive` returning a new behavior) to model state transitions explicitly.

**Persistence boundary.** Persist events before acknowledging commands. Never trust in-memory state after a crash.

**Snapshots on a schedule.** Combine event count and elapsed time. Snapshot every 1000 events or every hour, whichever comes first.

**Backpressure as protocol.** Senders ask for permission tokens before sending. Akka Streams calls this demand signaling.

**Sharded routing.** A router actor hashes message keys to child actors; consistent hashing minimizes resharding on scale events.

**Saga supervisor.** Each saga has its own supervisor; saga failures escalate to compensations, not silent retries.

**Dead-letter monitor.** A dedicated actor consumes dead letters and emits metrics or alerts. Dead letters are bugs in disguise.

---

## Clean Code

- Name actor types after the role they play, not the technology. `OrderService`, not `OrderActor` or `OrderHandler`.
- Name messages after intent and outcome: `PaymentAuthorized`, not `PaymentResponse`.
- Keep commands and events in separate sealed hierarchies; conflating them obscures the model.
- Move pure business logic into plain functions; the actor is just the message dispatcher.
- One message handler should not exceed twenty lines; split with `become`.
- Avoid sprinkling `???` and `TODO` — partial actors crash production.
- Log message *types* with correlation IDs; never log full payloads in hot paths.

---

## Best Practices

- Treat your message protocol as a versioned public API.
- Make every command idempotent or carry an idempotency key.
- Bound every mailbox unless you can prove it is at the edge of the system.
- Snapshot persistent actors aggressively; replay cost is your recovery SLO.
- Run periodic chaos drills: kill random actors, partition the cluster, slow the disk.
- Trace every message with OpenTelemetry; sample at 1 percent in steady state.
- Document supervision strategies — every team member should know what restart does.
- Capacity-plan based on mailbox depth, not request rate. Depth is the leading indicator.

---

## Edge Cases & Pitfalls

- **Persistent actor restarts mid-write.** If you persist event then crash before acknowledging the sender, retry will write again. Idempotency keys are not optional.
- **Cluster split-brain.** Two partitions both elect leaders. With CRDTs you survive; with quorum-based decisions you do not. Choose your consistency model before you ship.
- **Hot grain on a virtual actor.** One celebrity user's grain receives all the traffic. Even with placement, the silo running that grain melts. Solution: shard by user + bucket, or rate-limit upstream.
- **Replay storms after restart.** A node comes back, replays a million events, locks up its disk, then the next node restarts. Stagger startup; snapshot.
- **Saga with non-idempotent compensation.** Cancelling a payment twice generates two refunds. Compensations must be exactly as idempotent as steps.
- **Event-sourced actor with mutable events.** Someone changes the `Event` class fields. Replay breaks for every old event. Events are immutable forever — version them.

---

## Common Mistakes

- Letting "ask" become the default pattern, recreating synchronous RPC.
- Sharing data structures (lists, maps) between actors via messages — concurrent mutation returns.
- Logging full message payloads in production hot paths.
- Mixing business logic into receive handlers instead of factoring it into pure functions.
- Forgetting `ctx.watch` so child deaths go unnoticed.
- Building distributed actor APIs that pretend network calls cannot fail.
- Skipping snapshots because "we are not at scale yet" — future you will be at scale and angry.

---

## Tricky Points

- **Location transparency is not failure transparency.** Remote sends fail differently. Your protocol must encode timeouts.
- **At-least-once is not exactly-once.** Kafka transactions move the boundary; they do not eliminate the duplicate problem.
- **Mailbox order is per sender, not global.** Two senders to one receiver have no guaranteed inter-leaving.
- **Stopping an actor is asynchronous.** `stop` schedules termination; in-flight messages still process.
- **Watch is not subscribe.** It fires once, on terminate. You cannot use it for liveness checks.
- **Persistence latency is the actor's latency.** Synchronous persistence pins your throughput to disk speed.

---

## Test Yourself

1. Compare Erlang's transparent distribution to Orleans's virtual actors. Where does each abstraction break, and what does the user pay for the convenience?
2. Design a saga for "place order, charge card, allocate inventory, schedule shipping." Identify each step's compensation and what makes it idempotent.
3. You have a persistent actor with one million events. How do you bound recovery time to under five seconds?
4. Explain why ask-pattern in a hot path is an anti-pattern. What does the corrected design look like?
5. A node leaves the cluster ungracefully. Walk through what happens to its actors, its mailboxes, and its persistent state under (a) Akka with cluster sharding, (b) Orleans, (c) Erlang OTP.
6. Sketch an observability dashboard for a 100-actor system. Which metrics deserve top placement? Why?
7. You are migrating from a thread pool to actors. Pick the first subsystem to migrate and justify your choice.
8. Schema-evolution scenario: you must rename a field in an event that has been in production for two years. What is the migration path?

---

## Tricky Questions

1. "If actors are isolated, why do we still see race conditions in actor systems?" — Because shared external resources (DB rows, files, REST endpoints) reintroduce the race outside the actor boundary. Idempotency keys and aggregate roots solve this, not the actor model alone.
2. "Why does Akka recommend bounded mailboxes if Erlang ships unbounded?" — Erlang inherits the discipline of teams who lived with unbounded mailboxes for decades and know how to size systems. Akka teams come from JVM backgrounds where unbounded queues are how OOMs happen.
3. "Can virtual actors leak memory?" — Yes, when grain deactivation is mis-tuned. If activation cost is high and idle timeout is long, you keep millions of dormant grains. Tune both.
4. "Should I model my whole system as actors?" — No. Actors are an architecture for stateful concurrency. Stateless transformations belong in pipelines, queries belong in CQRS read models, batch jobs belong in batch frameworks.
5. "How does Kafka relate to actor model?" — Loosely. Kafka is a durable log; consumers are usually stateless workers. But event-sourced actors persist *to* Kafka, treating it as their journal. Kafka complements actors; it does not replace them.
6. "Why does the actor model not eliminate the need for distributed transactions?" — Because business operations often span multiple aggregates with different consistency boundaries. Sagas replace 2PC with eventually-consistent compensation, not with atomicity.
7. "Is ask always wrong?" — No. Use it for low-frequency admin operations where synchronous semantics aid clarity. Avoid it in high-throughput data paths.
8. "What is the operational cost of running an actor cluster in production?" — Significant. You need an SRE team that understands JVM GC (or BEAM scheduler), cluster membership, persistence backend, and event-sourcing schema management. Plan for it.

---

## Cheat Sheet

| Decision | Quick guidance |
|----------|----------------|
| Local actors | Tokio, Akka Typed, Erlang lite |
| Cluster | Akka Cluster, OTP distributed, Orleans |
| Virtual actors | Orleans, Dapr Actors |
| Event sourcing | akka-persistence, EventStoreDB, Kafka journal |
| Sagas | Temporal, Cadence, hand-rolled orchestration actor |
| Distributed mailbox | NATS JetStream, Kafka, RabbitMQ Streams |
| Mailbox policy | Bounded with explicit overflow strategy |
| Default supervision | Restart child up to N times in T seconds; otherwise escalate |
| Reply semantics | Tell with explicit replyTo; ask only for admin paths |
| Tracing | OpenTelemetry spans per message, correlation ID in envelope |
| Failure budget | Defined per actor type, alerted on breach |

---

## Summary

At the professional level, message-passing is a system architecture, not a coding pattern. You design libraries instead of using them. You pick from Erlang, Akka, Orleans, Pony, and Tokio not by hype but by which failure modes you can run in production. You build event-sourced persistent actors so recovery is a fold and history is a log. You sketch sagas with compensations because two-phase commit does not scale. You watch out for ask-patterns, chatty actors, unbounded mailboxes, and god actors — the anti-patterns that turn elegant designs into Friday-night pages.

Theoretical foundations from Hewitt, Milner, and Hoare still inform the trade-offs. Hardware changes — RDMA, persistent memory — are reshaping what "local" and "remote" mean and will push more of the world toward actor-shaped runtimes over the next decade. The professional engineer holds both views: the principled model and the operational reality.

Use the model where it fits. Be honest about where it does not. And document your supervision strategies — your future on-call self will thank you.

---

## What You Can Build

- A persistent actor library with snapshots, replay, and Kafka journaling.
- A virtual-actor framework with location-transparent activation and silo failover.
- A saga orchestration engine with compensation and idempotency baked in.
- A distributed chat backend handling millions of concurrent users with per-room actors.
- A trading engine with per-account aggregates, ledger event sourcing, and CQRS read models.
- A real-time multiplayer game backend with sharded zone actors and zone handoff.
- An IoT device shadow service with one virtual actor per device and reconciliation logic.
- An observability platform for actor clusters: mailbox depth, restart rate, message tracing.
- A migration toolkit that helps teams move thread-pool services to actor models incrementally.

---

## Further Reading

- Carl Hewitt, "Actor Model of Computation: Scalable Robust Information Systems"
- Joe Armstrong, "Making Reliable Distributed Systems in the Presence of Software Errors"
- Tony Hoare, "Communicating Sequential Processes"
- Robin Milner, "Communicating and Mobile Systems: the Pi-Calculus"
- Akka documentation — Typed, Cluster, Persistence, Streams
- Orleans documentation — virtual actors, grain placement, streams
- Vaughn Vernon, "Reactive Messaging Patterns with the Actor Model"
- Martin Fowler, "Event Sourcing" and "CQRS" essays
- Hellerstein and Carbone, "Anna: A KVS for Any Scale"
- Pat Helland, "Life beyond Distributed Transactions: an Apostate's Opinion"

---

## Related Topics

- [Message-Passing — Senior Level](senior.md) — supervision, backpressure, mailbox semantics.
- [Shared-Memory Concurrency](../01-shared-memory/professional.md) — the alternative model and when to mix.
- [Concurrency Models Overview](../README.md) — comparative landscape.
- Event sourcing and CQRS modules (in `system-design` track).
- Distributed systems modules — CAP, consensus, sagas.
- Observability modules — tracing, metrics, structured logging.

---

## Diagrams & Visual Aids

```
Distributed actor topology (cluster sharding):

    +-----------+      +-----------+      +-----------+
    |  Node A   |      |  Node B   |      |  Node C   |
    |           |      |           |      |           |
    |  Shard 0  |      |  Shard 1  |      |  Shard 2  |
    |  Shard 3  |      |  Shard 4  |      |  Shard 5  |
    +-----+-----+      +-----+-----+      +-----+-----+
          \                  |                  /
           \                 |                 /
            \      +---------+---------+      /
             +----+   Shard Coordinator  +---+
                  +---------------------+
                          |
                  routes message by entityId -> shardId -> node
```

```
Event-sourced actor on restart:

  Crash!
    |
    v
  +-----------+
  |  Restart  |
  +-----+-----+
        |
        v
  Load latest snapshot ----+
        |                  |
        v                  v
  Replay events since snapshot
        |
        v
  Apply each event to state
        |
        v
  Ready to accept new commands
```

```
Saga lifecycle:

  Step1 OK -> Step2 OK -> Step3 OK -> Step4 FAIL
                                          |
                                          v
                              Compensate3 -> Compensate2 -> Compensate1
                                          |
                                          v
                                    Saga Failed (with audit trail)
```

```
Ask-pattern (anti-pattern in hot path):

  Caller --ask--> A --ask--> B --ask--> C --ask--> D
        <-reply-   <-reply-   <-reply-   <-reply-

  Each "ask" allocates a temporary reply actor. Latency = sum of legs.

Tell-flow (preferred):

  Caller --tell--> A --tell--> B
                    \         /
                     +-tell-+
                            |
                            v
                            C --tell--> Caller's reply address

  No temporary actors. Pipeline parallel. Reply routed back via stable address.
```

```
Migration from thread pool to actors (strangler):

  Legacy monolith (thread pool + locks)
        |
        |  new feature requests
        v
  +-------------------+
  |   Adapter layer   |
  +---+-----------+---+
      |           |
      v           v
  legacy code   actor system (new bounded contexts)
                    |
                    v
                event journal + projections

  Migrate one bounded context per quarter. Delete locks only when context is fully actor-based.
```

```
Observability dashboard layout:

  +----------------------------------------------------------+
  | Cluster health   | Mailbox depth top-10 | Restart counters|
  |  - nodes         | actor    | depth     |  per actor type |
  |  - unreachables  | OrderSvc | 1820      |                 |
  +----------------------------------------------------------+
  | Message latency P50/P95/P99 | Dead letters per second     |
  | per message type            | with sample payloads        |
  +----------------------------------------------------------+
  | Cluster events log (joins, leaves, partitions)            |
  +----------------------------------------------------------+
```
