# Actor Model — Senior Level

> **Topic:** [Actor Model](README.md)
> **Focus:** distributed actors, persistence, sharding, performance

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

At the junior and middle levels, the actor model lived inside a single process. Mailboxes were in-memory queues. Supervision trees were local. Addresses were tagged pointers. That mental picture is enough to understand the model, but it is not enough to run it at scale. A real production actor system is distributed across dozens of nodes, survives crashes without losing state, rebalances when machines come and go, recovers after network partitions, and emits enough telemetry to debug a problem at three in the morning.

The senior view of the actor model is the view from the operator's chair. You stop asking "how do actors send messages" and start asking the questions that actually matter when the model meets reality:

- How does an actor address survive when the process holding it disappears?
- Where does a stateful actor live in a cluster of N nodes, and what happens when N changes?
- How do you persist actor state without serializing every message?
- How do you trace a request that bounces through twenty actors on five hosts?
- How do you keep mailboxes from becoming unbounded backlog stores during a traffic spike?
- And, critically: when is the actor model the wrong tool, and what should you reach for instead?

This document walks through the patterns that production-grade actor systems use to answer those questions. The reference points are Erlang/OTP, Akka and Pekko on the JVM, and Microsoft Orleans on .NET. They differ in syntax, but the core problems and solutions are universal. We will look at distributed addressing, cluster sharding, persistence and event sourcing, cluster singletons and leader election, split-brain handling with CRDTs, tracing, backpressure with Reactive Streams, throughput tuning, testing strategies, and the anti-patterns that signal you picked the wrong model.

The code examples are deliberately concrete. We model a sharded user-session service, a saga implemented as a persistent actor, and a backpressure-aware ingestion pipeline. Every snippet is meant to compile and run after you wire it into a project skeleton — these are not pseudocode sketches.

---

## Prerequisites

Before you read this document you should be comfortable with:

- The basics of the actor model: mailboxes, message passing, "let it crash", supervision (covered in the [junior](junior.md) and [middle](middle.md) documents).
- One actor library at the programming level — Erlang/OTP `gen_server`, Akka Typed, Pekko, Orleans grains, or Elixir's `GenServer`.
- Concurrency primitives: futures/promises, executors, blocking versus non-blocking operations.
- Distributed systems vocabulary: failure detectors, gossip, CAP, eventual consistency, quorum.
- Serialization: Protobuf, Avro, or a binary format other than JSON. JSON is fine for HTTP, not for inter-actor traffic at scale.
- Event sourcing fundamentals: events as the source of truth, replay, snapshots.
- Reactive Streams or some other backpressure protocol.
- Tracing systems: OpenTelemetry, Jaeger, Zipkin, or vendor equivalents.

If any of those are blurry, pause and shore them up. Distributed actor systems amplify weaknesses in those areas — you do not want to debug a sharding rebalance bug while also Googling what a quorum is.

---

## Glossary

| Term | Meaning |
|------|---------|
| Cluster | A set of nodes (JVMs, BEAM VMs, .NET processes) that recognize each other as one logical actor system. |
| Node | One process in the cluster, identified by host plus port. |
| Shard | A subset of actors grouped under a logical name. The unit of placement and movement. |
| Shard region | An actor on each node that routes messages to local shards and coordinates hand-off. |
| Entity | An individual actor inside a shard, identified by an entity id. |
| Hand-off | The act of moving a shard from one node to another. |
| Rebalance | A coordinator decision that triggers many hand-offs to even out shard distribution. |
| Coordinator | The cluster-wide singleton that decides which node owns which shard. |
| Virtual actor | Orleans terminology — an actor that always exists logically and is materialized on demand. |
| Persistent actor | An actor whose state is recovered by replaying its journal of past events. |
| Journal | The append-only log of events emitted by persistent actors. |
| Snapshot | A periodic dump of an actor's state to shorten future replays. |
| Cluster singleton | An actor that exists on exactly one node at a time across the entire cluster. |
| Split-brain | Network partition that causes two halves of a cluster to each believe the other is dead. |
| ddata (Distributed Data) | Akka's CRDT-backed replicated key-value store. |
| Backpressure | Downstream telling upstream to slow down, signaled by demand. |
| Mailbox | The queue of unprocessed messages held by an actor. |
| Dispatcher | The thread pool that runs actor message-handling. |
| Stash | A temporary holding area for messages an actor cannot handle yet. |
| TestKit | Framework support for testing actors with controllable timing and synthetic probes. |

---

## Core Concepts

### Distributed Actor Systems

A single-node actor system gives you message passing and supervision. A distributed actor system adds two properties that change everything: **location transparency** and **failure as a first-class signal**.

Location transparency means a reference to an actor does not encode where that actor is. Sending a message uses the same API whether the recipient is in your process or on a host across the data center. The runtime is responsible for serialization, network transport, and routing. Erlang has had this since the 1980s — a `Pid` can be local or remote and you do not know the difference at the call site. Akka and Pekko replicate the pattern with `ActorRef`. Orleans goes further: grain references are virtual, pointing to a logical identity that the runtime will materialize wherever it sees fit.

Failure as a signal means processes can monitor each other across the network. When a remote node dies, every actor that was watching an actor on that node receives a `Terminated` (or equivalent) message. Supervision trees still work across the wire — although you usually do not let parent and child sit on different nodes; supervision is local and cluster sharding is the cross-node analogue.

The runtime parts you need to know:

- **Membership and gossip.** Nodes discover each other and exchange heartbeats. Akka uses a gossip protocol derived from Amazon Dynamo. Erlang uses a fully connected mesh by default, which limits cluster size and is now sometimes replaced with `partisan` for large clusters. Orleans uses a membership table backed by Azure storage or an external store.
- **Failure detectors.** A heartbeat alone is not enough — you need to decide *when* a missed heartbeat counts as a failure. Akka uses the Phi Accrual Failure Detector, which produces a continuous suspicion level rather than a binary up/down decision.
- **Serializers.** Inter-node messages must be serialized. JSON works for prototypes; you want Protobuf, Avro, or a custom binary format for production. Allocations per message at scale are the difference between 200k msg/s and 1.5M msg/s.

### Cluster Sharding

Sharding is the technique that lets you store millions of actors across a cluster without manually pinning each one to a node. You define a logical type — `UserSession`, `Order`, `Device` — and the cluster assigns each entity to a shard, and each shard to a node. Sending a message to entity `user-42` goes through a local shard region actor, which knows the location of shard `42 % N` and forwards the message.

Three operations matter:

1. **Placement.** When the first message arrives for entity `user-42`, the coordinator decides which shard it belongs to (typically `hash(id) % shardCount`) and which node owns that shard. The destination node spawns the actor on demand.
2. **Hand-off.** When the coordinator decides to move a shard, it sends a stop signal to the source. The source region tells every entity in the shard to checkpoint, processes any remaining mailbox items, then signals completion. The coordinator then redirects routing to the new node, which lazily re-materializes entities as messages arrive.
3. **Rebalancing.** When a node joins or leaves, the coordinator may decide to redistribute shards to even out load. Rebalances are throttled — moving too many shards at once causes a stampede.

A few principles save pain:

- Pick a shard count once and never change it. It must be much larger than your node count (a 10x rule of thumb) so individual shards stay small but smaller than your entity count by orders of magnitude.
- Make entity ids stable across deployments. The hash of an id determines its shard; changing id format reshuffles everything.
- Treat hand-off as expected, not exceptional. If your entities cannot lose their in-memory caches without massive re-warm cost, sharding is going to hurt.

### Persistent Actors and Event Sourcing

A persistent actor is one whose state is the fold of an event log. On startup or after a crash, the framework reads events from a journal, replays them through a handler, and the actor's state is reconstructed. The actor never writes its current state directly — it emits events.

In Akka Persistence (and Pekko's port), a `EventSourcedBehavior` has three pieces:

- **State.** The in-memory representation. Immutable, replaced after every event.
- **Command handler.** Decides what events to emit in response to a command.
- **Event handler.** Updates the state given an event. Pure function.

The lifecycle is: receive command, validate, emit events, persist events, update in-memory state, optionally reply. The reply is only allowed after persistence succeeds — replying earlier means a crash could expose a write that was not durable.

Two performance levers:

- **Snapshots.** Periodically dump current state. On recovery, load the latest snapshot and only replay events that came after. Without snapshots, recovery time grows linearly with history.
- **Journal compaction.** Many journals (Cassandra, JDBC, EventStore) support deleting events older than a snapshot. This trades audit-completeness for recovery speed. Decide explicitly which you need.

A common mistake is treating the journal as a relational database. It is not. You cannot query events across entities efficiently. If you need to project events into a queryable read model, that is a separate component — usually a CQRS read-side built with Akka Projection, ksqlDB, or hand-rolled Kafka consumers.

### Cluster Singleton and Leader Election

Some responsibilities should run on exactly one node at a time. The classic examples are scheduling, batch coordinators, and idempotency gatekeepers. A cluster singleton is an actor that the cluster guarantees exists on exactly one node — usually the oldest member.

The dance is more delicate than it sounds:

- The cluster elects a leader using a deterministic rule (oldest member, lowest hash address, etc.).
- The leader hosts the singleton.
- When the leader leaves, the next leader spawns the singleton.
- During the gap, all messages must be buffered or rejected.

`ClusterSingletonManager` does the hosting and `ClusterSingletonProxy` does the routing on each node. The proxy buffers messages while no singleton exists. Buffer size is bounded — if it overflows, you start dropping messages, which is exactly the failure you want to detect with monitoring.

Leader election is not the same as a consensus algorithm. Akka does not use Raft for singleton election; it uses the gossip view of who is in the cluster. That works in normal operation but breaks during a split-brain — both halves think they are the cluster and each elects its own singleton. The fix is downing strategies, covered next.

### Split-Brain and CRDT-Backed State

A network partition splits the cluster into two or more disconnected halves. Each half sees the others as unreachable. If both halves keep running independently, you get two singletons, duplicate work, and ultimately conflicting writes — split-brain.

The defenses, in increasing order of safety:

- **Auto-downing.** Mark unreachable nodes as down after a timeout. Simple, dangerous — both halves do it, both halves keep running, you get split-brain anyway.
- **Static quorum.** Configure a known quorum size. If a half cannot see a quorum, it shuts itself down. Works only if cluster size is fixed.
- **Keep-majority.** Each half checks if it has the majority of last-known members. The minority shuts down. Safer than static quorum because it adapts.
- **Lease-based.** Acquire a lease from an external store (Kubernetes API, Consul, Etcd). Only the lease holder operates. Strongest guarantee, adds external dependency.

For state that must remain available during partitions, use CRDTs. Akka's Distributed Data (`ddata`) provides replicated counters, sets, maps, and registers that converge automatically after a partition heals. The trade-off: CRDTs guarantee eventual convergence but not linearizability. You cannot use a `GCounter` to enforce "at most 100 active users." You can use it to count "approximate active users with eventual correctness."

### Tracing Across Actors

When a request bounces through ten actors on five hosts, a stack trace tells you nothing. You need correlation.

OpenTelemetry actor instrumentation works on three primitives:

- **Trace context propagation.** Every message carries a trace id and parent span id. The sending actor injects the context; the receiving actor extracts it.
- **Span around message handling.** Wrap the body of the message handler in a span that records the actor path and message type.
- **Async linking.** When an actor sends a message and continues, the new actor's work is linked to the originating span but does not block it.

Practical considerations:

- Tagging spans with mailbox depth and processing duration helps you correlate latency with backlog.
- Sampling decisions must be coherent across the trace. Use parent-based sampling so a sampled trace stays sampled through every actor.
- Pekko has a `pekko-instrumentation` module; Akka has commercial Lightbend Telemetry. Roll your own if those do not fit, but understand the wire format you need to maintain.

### Backpressure with Reactive Streams

Mailboxes have a fatal default: they are unbounded. A slow consumer plus a fast producer plus no backpressure equals out-of-memory.

Reactive Streams is a protocol — implemented by Akka Streams, Pekko Streams, RxJava, and Project Reactor — where consumers signal demand and producers respect it. The contract is:

1. Subscriber subscribes to publisher.
2. Subscriber sends `request(n)` upstream.
3. Publisher emits up to `n` items.
4. Subscriber requests more when ready.
5. Cancellation is explicit.

Akka Streams compiles into actors at the bottom but exposes a typed builder API. You assemble graphs of `Source`, `Flow`, and `Sink`, attach buffers and strategies (drop-head, drop-tail, backpressure), and run them on a materializer. Inside, the streams runtime uses windowed demand to amortize per-element overhead.

When you need actor-level backpressure that is not streamable, implement the **work-pulling pattern**: workers send `Pull` to a master when ready; the master sends one work item per pull. The mailbox never grows beyond worker count.

### Performance

Actor systems advertise impressive numbers — Akka claims fifty million messages per second on a single JVM. Those numbers come with caveats.

The throughput-driving factors are:

- **Allocations per message.** Boxing a primitive, wrapping in `Option`, building a case class — each allocation is GC pressure. Hot paths must avoid them.
- **Dispatcher choice.** The default `ForkJoinPool` is good for mixed workloads but terrible for blocking I/O. Use a dedicated dispatcher with a `ThreadPoolExecutor` for blocking work.
- **Throughput configuration.** The `throughput` setting controls how many messages an actor processes before the dispatcher moves to the next actor. Higher values reduce context-switch overhead but can starve other actors.
- **Mailbox type.** The default unbounded mailbox is a linked list. A bounded array-backed mailbox can be faster but introduces drops or backpressure.
- **Serialization cost.** Inter-node messages pay a serializer hit on every send. JSON is one to two orders of magnitude slower than Protobuf.
- **Network MTU.** Akka Cluster batches messages into network frames. The batch size and TCP buffer sizes interact with throughput.

A practical tuning order: profile first, identify the bottleneck (mailbox depth, CPU, network, GC), change one variable, measure, repeat. Premature dispatcher tuning is responsible for a surprising amount of production damage.

### Testing Actors

Actor code is harder to test than synchronous code because timing matters. Pekko TestKit and Akka TestKit-Typed give you:

- **Test probes.** Actors that record received messages and let you assert on them.
- **Synthetic time.** A test scheduler that advances on command, so timeouts are deterministic.
- **Behavior testing.** You can replace child actor spawning with probes via a behavior factory pattern.
- **Sharding TestKit.** Lets you test sharding logic without a full cluster.
- **Persistence TestKit.** In-memory journal and snapshot store with deterministic recovery.

The discipline: every actor that takes a collaborator should accept it as a constructor parameter, not look it up from the actor system. That lets tests inject a probe. The behavior factory pattern is just dependency injection adapted to typed actors.

### When the Actor Model Is Wrong

The actor model is general but not universal. It is the wrong tool when:

- **CPU-bound numerical work.** Actors add per-message overhead. A dense matrix multiplication wants SIMD and tight loops, not mailboxes.
- **Simple stateless RPC.** If your service is genuinely stateless and you only need horizontal scaling, gRPC + Kubernetes is simpler and operationally cheaper.
- **Latency-critical hard real-time.** Mailbox jitter and GC pauses (on JVM and BEAM) make tail latency uneven. Trading floor matching engines, low-latency proxies, and tick-to-trade paths usually pick lock-free queues and pinned threads.
- **Small monoliths.** A single Postgres and a synchronous web framework will outpace an actor system for a startup with 10k users.
- **Workflow engines.** If your problem is "long-running multi-step workflow with human approval," a dedicated workflow engine (Temporal, Cadence) is purpose-built and easier to operate.

Choosing the actor model when the problem does not need it is one of the most common over-engineering patterns in the industry.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Distributed actor system | A global mail service — you address a person, the system finds them. |
| Cluster sharding | A library where books are grouped by call number ranges; each branch holds some ranges. |
| Hand-off | Moving an entire shelf from one branch to another while keeping the catalog accurate. |
| Persistent actor | A bank ledger — current balance is the sum of all entries; you can rebuild it any time. |
| Snapshot | The balance carry-forward at month-end, so audit does not start from the company's founding date. |
| Cluster singleton | The night-shift security guard — exactly one per building, but the post is always filled. |
| Split-brain | Two department heads, each unaware the other exists, both giving orders. |
| ddata (CRDT) | A shared shopping list that everyone edits offline; on reconnect, the items merge sensibly. |
| Backpressure | A waiter signaling the kitchen to slow down because the dining room is full. |
| Mailbox bottleneck | A clerk's inbox piling up while everyone keeps dropping forms in. |
| Tracing | A package tracking number that follows the parcel through every depot. |
| Work-pulling | Day laborers at a hiring hall — they walk up when ready, no one queues them. |

---

## Mental Models

**The runtime is the operating system.** In a distributed actor system, the actor runtime takes over responsibilities that the OS handles for processes — scheduling, isolation, addressing, lifecycle. You stop thinking in JVM-or-BEAM-or-CLR terms and start thinking "Akka cluster" or "BEAM cluster" as the platform.

**Addressing is logical, placement is physical.** An actor reference says who; the cluster decides where. You should never have to know which node holds an actor for your code to work. If you do, sharding is misconfigured.

**State lives where the events live.** A persistent actor's in-memory representation is a cache of its event log. If you treat it as the source of truth, you will be surprised when a crash erases your unpersisted changes.

**Failure is a message, not an exception.** A remote actor dying is not something you catch — it is something you receive as a `Terminated` signal. You handle it like any other message, in your normal mailbox loop.

**Backpressure is the absence of growth.** When a system is healthy, mailboxes stay shallow. Growth is the symptom of demand exceeding capacity. The fix is to slow upstream, not to widen the queue.

**Tracing is the only debugger.** Stack traces tell you what one actor was doing at one moment. A distributed trace tells you what twenty actors did over a second. You will rely on the latter far more than the former.

---

## Code Examples

The examples use Pekko (the Apache fork of Akka) with the typed API. They are written in Scala because Pekko's typed DSL is most expressive there; the same patterns work in Java with more verbosity.

### Example 1: Sharded User-Session Service

A user-session service stores per-user state — current basket, last-seen page, A/B test bucket. It must scale to millions of concurrent users without pinning all of them to a single node.

```scala
import org.apache.pekko.actor.typed._
import org.apache.pekko.actor.typed.scaladsl._
import org.apache.pekko.cluster.sharding.typed.scaladsl._

object UserSession {

  sealed trait Command
  final case class AddToBasket(itemId: String, replyTo: ActorRef[Reply]) extends Command
  final case class GetBasket(replyTo: ActorRef[Reply]) extends Command
  private case object Passivate extends Command

  sealed trait Reply
  final case class Basket(items: Vector[String]) extends Reply
  case object Done extends Reply

  val TypeKey: EntityTypeKey[Command] = EntityTypeKey[Command]("UserSession")

  def apply(entityId: String): Behavior[Command] =
    Behaviors.setup { ctx =>
      ctx.setReceiveTimeout(scala.concurrent.duration.DurationInt(5).minutes, Passivate)
      session(entityId, Vector.empty)
    }

  private def session(id: String, items: Vector[String]): Behavior[Command] =
    Behaviors.receiveMessage {
      case AddToBasket(itemId, replyTo) =>
        replyTo ! Done
        session(id, items :+ itemId)

      case GetBasket(replyTo) =>
        replyTo ! Basket(items)
        Behaviors.same

      case Passivate =>
        Behaviors.stopped
    }
}

object UserSessionService {
  def init(system: ActorSystem[_]): ActorRef[ShardingEnvelope[UserSession.Command]] = {
    val sharding = ClusterSharding(system)
    sharding.init(
      Entity(UserSession.TypeKey)(ctx => UserSession(ctx.entityId))
        .withStopMessage(UserSession.Passivate)
    )
  }
}
```

A few senior-level points to notice:

- `setReceiveTimeout` triggers passivation after five minutes of inactivity. This is how you keep memory bounded — idle sessions are stopped and their state is forgotten. (Or, if the actor were persistent, the next message would re-hydrate from journal.)
- `withStopMessage(Passivate)` integrates the passivation signal with the sharding hand-off. When the shard region wants to move the entity, it sends `Passivate`, the actor stops cleanly, and the next message recreates it on the new node.
- The entity id is passed as a constructor parameter. The framework computes `shard = hash(id) % shardCount` and routes accordingly.
- Sending a message looks like this:

```scala
val service = UserSessionService.init(system)
service ! ShardingEnvelope("user-42", UserSession.AddToBasket("sku-1", replyProbe.ref))
```

You do not specify a node. The cluster routes.

### Example 2: Saga as a Persistent Actor

A saga coordinates a multi-step distributed transaction with compensations. We model an order placement saga: reserve inventory, charge payment, schedule shipping; compensate on failure.

```scala
import org.apache.pekko.actor.typed._
import org.apache.pekko.persistence.typed.PersistenceId
import org.apache.pekko.persistence.typed.scaladsl._

object OrderSaga {

  sealed trait Command
  final case class Start(orderId: String, items: Vector[String], replyTo: ActorRef[Result]) extends Command
  private final case class InventoryReserved(token: String) extends Command
  private final case class InventoryFailed(reason: String) extends Command
  private final case class PaymentCharged(receipt: String) extends Command
  private final case class PaymentFailed(reason: String) extends Command
  private final case class ShippingScheduled(trackingId: String) extends Command

  sealed trait Event
  final case class Started(orderId: String, items: Vector[String]) extends Event
  final case class InventoryStepDone(token: String) extends Event
  final case class PaymentStepDone(receipt: String) extends Event
  final case class ShippingStepDone(trackingId: String) extends Event
  final case class Failed(reason: String) extends Event
  final case class Compensated(stage: String) extends Event

  sealed trait Result
  final case class Succeeded(trackingId: String) extends Result
  final case class Aborted(reason: String) extends Result

  sealed trait State
  case object Idle extends State
  final case class ReservingInventory(orderId: String, items: Vector[String]) extends State
  final case class ChargingPayment(orderId: String, token: String) extends State
  final case class Scheduling(orderId: String, token: String, receipt: String) extends State
  final case class Done(trackingId: String) extends State
  final case class Aborting(reason: String, stagesToUndo: List[String]) extends State

  def apply(persistenceId: PersistenceId, replyTo: ActorRef[Result]): Behavior[Command] =
    EventSourcedBehavior[Command, Event, State](
      persistenceId = persistenceId,
      emptyState = Idle,
      commandHandler = (state, cmd) => commandHandler(state, cmd, replyTo),
      eventHandler = eventHandler
    ).snapshotWhen((_, ev, _) => ev.isInstanceOf[ShippingStepDone] || ev.isInstanceOf[Failed])
  
  private def commandHandler(state: State, cmd: Command, replyTo: ActorRef[Result]): Effect[Event, State] = {
    (state, cmd) match {
      case (Idle, Start(orderId, items, _)) =>
        Effect.persist(Started(orderId, items))
      case (ReservingInventory(_, _), InventoryReserved(token)) =>
        Effect.persist(InventoryStepDone(token))
      case (ChargingPayment(_, _), PaymentCharged(receipt)) =>
        Effect.persist(PaymentStepDone(receipt))
      case (Scheduling(_, _, _), ShippingScheduled(tracking)) =>
        Effect.persist(ShippingStepDone(tracking))
          .thenReply(replyTo)(_ => Succeeded(tracking))
      case (_, InventoryFailed(reason)) =>
        Effect.persist(Failed(reason)).thenReply(replyTo)(_ => Aborted(reason))
      case (_, PaymentFailed(reason)) =>
        Effect.persist(Failed(reason), Compensated("inventory"))
          .thenReply(replyTo)(_ => Aborted(reason))
      case _ =>
        Effect.unhandled
    }
  }

  private def eventHandler(state: State, event: Event): State =
    (state, event) match {
      case (_, Started(id, items)) => ReservingInventory(id, items)
      case (ReservingInventory(id, _), InventoryStepDone(token)) => ChargingPayment(id, token)
      case (ChargingPayment(id, token), PaymentStepDone(receipt)) => Scheduling(id, token, receipt)
      case (_, ShippingStepDone(tracking)) => Done(tracking)
      case (_, Failed(reason)) => Aborting(reason, Nil)
      case (s, Compensated(_)) => s
      case (s, _) => s
    }
}
```

Key senior observations:

- The saga state machine is encoded as states and transitions. On recovery, every prior event replays and the actor lands in the correct state without any external coordination.
- `snapshotWhen` takes a predicate that picks meaningful events to snapshot at. Snapshotting after every event is wasteful; after terminal events is enough for fast recovery.
- The `Compensated` event records the compensation step. The actor is the single source of truth for what has and has not been undone, which removes the need for external coordination.
- The saga should be hosted under cluster sharding so that the same saga id always routes to the same node and crashes recover from the journal.

### Example 3: Backpressure-Aware Ingestion Pipeline

An ingestion pipeline reads from a fast source (Kafka), enriches each message by calling a slower service, and writes to a database. Without backpressure, a Kafka burst will OOM the JVM.

```scala
import org.apache.pekko.NotUsed
import org.apache.pekko.stream._
import org.apache.pekko.stream.scaladsl._
import org.apache.pekko.actor.typed.ActorSystem
import scala.concurrent.Future
import scala.concurrent.duration._

final case class RawEvent(id: String, payload: String)
final case class Enriched(id: String, payload: String, tags: List[String])

class EnrichmentService {
  def enrich(e: RawEvent): Future[Enriched] = Future.successful(
    Enriched(e.id, e.payload, List("auto"))
  )
}

class EventWriter {
  def write(e: Enriched): Future[Done.type] = Future.successful(Done)
}

object IngestionPipeline {
  def run(system: ActorSystem[_], kafkaSource: Source[RawEvent, NotUsed]): Future[Done] = {
    implicit val sys: ActorSystem[_] = system
    val enrich = new EnrichmentService
    val writer = new EventWriter

    kafkaSource
      .buffer(size = 256, OverflowStrategy.backpressure)
      .mapAsync(parallelism = 16)(enrich.enrich)
      .groupedWithin(100, 200.millis)
      .mapAsync(parallelism = 4)(batch =>
        Future.sequence(batch.map(writer.write)).map(_ => Done)
      )
      .toMat(Sink.ignore)(Keep.right)
      .run()
  }
}
```

Senior-level analysis:

- `buffer(256, OverflowStrategy.backpressure)` makes the buffer bounded *and* propagates pressure upstream when full. The Kafka source then stops requesting messages, which slows the broker rather than crashing the JVM.
- `mapAsync(parallelism = 16)` runs sixteen enrichment calls in parallel but preserves order. If order does not matter, use `mapAsyncUnordered` for higher throughput.
- `groupedWithin(100, 200.millis)` accumulates up to one hundred enriched events or two hundred milliseconds, whichever comes first. The downstream writes batched, which usually outperforms one-at-a-time writes by ten times or more.
- The pipeline gracefully degrades — if enrichment is slow, the buffer fills, Kafka backs off, the consumer lag grows, and your alerts fire. No memory blow-up, no message loss, no message duplication.

For pipelines where Kafka offsets must be committed only after the write succeeds, use the Alpakka Kafka connector's `committableSource` with explicit commit at the end of the flow. Otherwise you risk message loss on restart.

---

## Pros & Cons

**Pros**

- Location transparency lets you scale a logical design horizontally without rewriting business logic.
- Cluster sharding turns "millions of concurrent stateful objects" into a tractable engineering problem.
- Event sourcing through persistent actors provides natural audit, replay, and time-travel debugging.
- Supervision hierarchies plus monitoring make failure a normal control flow signal.
- Reactive Streams composition gives backpressure-correct pipelines with declarative code.
- Mature toolchains exist for Erlang/OTP, Akka/Pekko, and Orleans — operational patterns are well-understood.

**Cons**

- Operational complexity is high. You need to understand serialization, gossip, failure detection, and downing strategies.
- Debugging distributed actor flows requires tracing infrastructure from day one.
- Performance tuning has many knobs (dispatcher, mailbox, throughput, serializer) and bad defaults bite.
- Versioning persistent events is non-trivial — once an event is in the journal, you cannot change it.
- Akka 2.7+ moved to a non-OSS license; Pekko, the Apache fork, is the open-source path forward but still maturing.
- The model amplifies subtle bugs — race conditions in untyped APIs, leaked actor refs, wrong dispatcher choices.

---

## Use Cases

- **IoT device shadows.** Millions of devices, each modeled as a sharded entity holding latest telemetry and desired-vs-reported state. Orleans is the canonical platform here.
- **Multiplayer game backends.** Each match or room is a sharded actor; player connections route to the right entity.
- **Real-time bidding.** Each campaign or advertiser is an actor; sharding keeps state local and fast.
- **Chat and messaging.** Each conversation is a sharded persistent actor with event-sourced history.
- **Workflow orchestration at scale.** Sagas as persistent actors for long-running cross-service flows.
- **Telecom switches and signaling.** Erlang's original domain — soft real-time, hot upgrades, fault tolerance.
- **Financial reconciliation.** Each account or position is a persistent actor; events are the immutable ledger.

---

## Coding Patterns

- **Behavior factory.** Wrap actor creation in a function that takes collaborators as parameters. Enables test injection.
- **Stash-on-init.** Persistent actors stash incoming commands during recovery and unstash when ready.
- **Reply protocol with `replyTo: ActorRef[Reply]`.** Typed request/response without ad-hoc patterns.
- **Sealed trait protocol.** Every command and event sealed under a trait — the compiler enforces exhaustive handling.
- **Idempotent commands.** Every external command carries an id so duplicate delivery is detectable and rejectable.
- **Adapter actors.** Convert protocol of an external system to typed commands for the actor that consumes them.
- **Work-pulling.** Workers signal readiness; coordinator dispatches one job at a time. Built-in backpressure.

---

## Clean Code

Actor code accumulates noise quickly. A few rules keep it readable.

- Keep the protocol (sealed trait) at the top of the actor file. The protocol is the actor's API.
- Separate command-handling from state-transition logic. Persistent actors enforce this; pure actors should follow voluntarily.
- Name behaviors after the state, not the action: `idle`, `loading`, `ready`, `closing`. Reading the message-handler match should feel like reading a state machine, not a switch.
- One actor, one concern. If an actor handles connection management and business logic, split it.
- Use timeouts at the message-protocol level, not as ambient configuration. `ask` patterns must always have explicit timeouts.
- Log with structured fields, not formatted strings. Include actor path, message type, and correlation id on every log line.

---

## Best Practices

- Pin shard counts on day one. Document the value, the rationale, and warn about resharding cost.
- Always passivate idle sharded entities. Unbounded entity counts cause silent memory growth.
- Snapshot persistent actors before journal sizes hit replay-time budgets. A snapshot every thousand events is a common starting point.
- Choose a binary serializer (Protobuf, Avro) for cluster traffic. JSON does not scale.
- Configure a split-brain resolver before going to production. Default auto-down is not safe.
- Treat the cluster singleton's buffer overflow as a hard alert. It means the system is making no progress.
- Use dedicated dispatchers for blocking work. The default fork-join pool starves under blocking I/O.
- Instrument with OpenTelemetry from the start. Adding tracing after a production incident is too late.
- Test recovery on every persistent actor change. A schema change can break replay silently.
- Run sharding-rebalance tests in staging. Real production traffic during a rebalance is not the place to discover bugs.

---

## Edge Cases & Pitfalls

- **Message loss during hand-off.** Sharding hand-off is best-effort; a few in-flight messages can be lost if the source crashes mid-handoff. Treat sharded messaging as at-most-once unless paired with persistent retries.
- **Snapshot serialization drift.** A field added to the state class breaks deserialization of older snapshots. Version your state types and write upgraders.
- **Journal corruption.** A bad event handler that throws on certain events causes infinite recovery loops. Always validate events before persisting.
- **Cluster singleton flapping.** During leader changes, the singleton can flap between nodes. Use a debounce or a lease.
- **Split-brain under partition.** Without a resolver, both halves continue; with auto-down, both halves think the other died. Pick a resolver and test it with a chaos tool.
- **Actor leaks via watch.** Watching an actor that never dies and never gets unwatched keeps a reference alive. Always unwatch when no longer interested.
- **Backpressure breakage from `tell`.** Sending with `tell` does not respect downstream demand. Mixing raw actors with stream stages bypasses backpressure and corrupts the model.
- **Unbounded ask buffers.** `ask` allocates a temporary actor per call; if the target is overloaded, those build up. Use bounded ask via `AskTimeoutException` handling and explicit retry caps.

---

## Common Mistakes

- Treating the in-memory state of a persistent actor as durable. Only events on disk are durable.
- Using sharding for a single-instance global counter. That is a singleton, not a sharded entity.
- Forgetting to register custom serializers, then discovering production uses Java serialization for everything. Disable Java serialization explicitly.
- Pinning shard count to node count. The cluster will eventually scale; shard count should be a multiple, not equal.
- Building a saga with timers and external state instead of a persistent actor. The saga loses progress on every restart.
- Calling blocking I/O from an actor on the default dispatcher. One blocked thread is fine; a hundred blocked threads starves the entire system.
- Spawning a child per request. Spawning is cheap but not free; a request-per-second sustained spawn rate generates GC pressure.
- Catching exceptions inside the actor and continuing. Supervision exists for a reason. Let the actor crash and supervisor decide.

---

## Tricky Points

- **`ask` is sugar over a hidden actor.** Every `ask` creates a temporary actor that waits for the reply. High-frequency asks are a performance trap.
- **Stash size is bounded.** Default stash capacity is 100. A persistent actor with a long recovery and a flood of incoming commands will lose messages when stash overflows.
- **Dispatcher starvation by long messages.** A handler that takes a long time blocks the dispatcher's slot from other actors. The throughput setting controls fairness; long handlers should yield by sending a message to themselves.
- **Recovery from a corrupted snapshot.** If snapshot replay throws, the actor cannot start. The recovery path is to delete the snapshot and replay from journal. Have a runbook for this.
- **CRDT convergence is not consistency.** Two halves of a partition each updating a `GCounter` produce a sum, not a strict ordering. Do not use CRDTs where you need real consensus.
- **Cluster sharding and roles.** Shards can be restricted to nodes with a given role. Forgetting this on a heterogeneous cluster causes hand-off to bounce.
- **Pekko vs Akka API drift.** Pekko froze on Akka 2.6.x's open-source surface. Newer Akka APIs do not exist in Pekko. Mind your imports.

---

## Test Yourself

1. Explain why a persistent actor's reply must happen after `Effect.persist` succeeds, not before.
2. Why is a shard count of 1000 typical even for a 10-node cluster?
3. What happens to messages addressed to a sharded entity during a hand-off?
4. Describe two split-brain resolution strategies and the trade-offs between them.
5. What is the difference between `mapAsync` and `mapAsyncUnordered` in a stream?
6. Why does the cluster singleton proxy buffer messages, and what does buffer overflow mean operationally?
7. How does work-pulling provide backpressure without using Reactive Streams?
8. What is the cost of snapshotting after every event? After never snapshotting?
9. Why is the default Java serializer dangerous in production?
10. Name three workloads where the actor model is the wrong choice and explain why.

---

## Tricky Questions

1. Your sharded entity has a five-minute receive timeout. A burst of one million unique entity ids arrives in ten seconds. What does your heap look like at minute four?
2. A persistent actor's event class gains a new required field. You deploy. Recovery fails for old entities. What do you do?
3. Two nodes lose the network link between them but stay connected to the rest of the cluster. With keep-majority downing, what happens to each?
4. You see `ask` timeouts spike from 1% to 30% under load. The target actor's CPU is at 40%. What is the most likely cause?
5. A cluster singleton is responsible for scheduling jobs. After a deploy, jobs are firing twice. What went wrong?
6. Your enrichment service has a p99 of 2 seconds, p50 of 50 ms. Your `mapAsync(parallelism = 8)` stream has lower throughput than expected. What changes do you try?
7. A persistent actor crashes during recovery because one event in its journal makes the event handler throw. The actor is in production. What is your recovery sequence?
8. You add OpenTelemetry but spans for downstream actors do not appear in the trace. What did you forget to propagate?
9. Your `GCounter` for active sessions reads 12,453 on node A and 12,447 on node B. After convergence it reads 12,460. Why?
10. You picked the actor model for a CPU-bound numerical service and throughput is 10x worse than the previous thread-pool design. How do you explain the result, and what is your migration plan?

---

## Cheat Sheet

```
ADDRESSING
  Local ref         -> in-process pointer
  Remote ref        -> cluster-routed via gossip view
  Sharded entity    -> EntityRef(id) -> shard region -> node

SHARDING
  shardId = hash(entityId) % shardCount
  passivate idle entities to bound memory
  shardCount >> nodeCount, fixed forever

PERSISTENCE
  Command -> validate -> Effect.persist(Event) -> update state -> reply
  Snapshot when (state, event, seqNr) predicate true
  Recovery: load snapshot, replay events after snapNr

CLUSTER SINGLETON
  Manager on every node, one actually hosts
  Proxy buffers messages while no singleton exists
  Use lease for safety across split-brain

SPLIT-BRAIN
  Auto-down            -> dangerous
  Static quorum        -> fixed size
  Keep-majority        -> adapts
  Lease (k8s, consul)  -> strongest

BACKPRESSURE
  Reactive Streams: request(n) downstream -> upstream emits up to n
  Work-pulling: worker -> Pull; master -> one work item per Pull

DISPATCHERS
  Default fork-join    -> mixed CPU
  Dedicated TPE        -> blocking I/O
  Pinned dispatcher    -> one thread per actor (low-latency)

TESTING
  TestProbe.expectMessage / fishForMessage
  ManualScheduler for time control
  PersistenceTestKit for journal/snapshot
  ShardingTestKit for routing tests
```

---

## Summary

The senior view of the actor model is about distribution, durability, and operability. Local actors with mailboxes and supervision are the easy part. The hard part is making millions of stateful entities survive node failures, network partitions, deploys, and traffic spikes without losing data or producing duplicates.

Cluster sharding gives you horizontal placement. Persistent actors give you durability through event sourcing. Cluster singletons give you exactly-once role hosting. CRDTs give you available-during-partition state. Reactive Streams give you backpressure-correct pipelines. Tracing gives you observability across the whole system. Every one of these is a technique with trade-offs, and choosing well requires understanding both the mechanism and the failure modes.

The model is powerful but not universal. CPU-bound numerical work, simple stateless RPC, and hard real-time pipelines should look elsewhere. When the problem genuinely involves many independent stateful entities communicating asynchronously, the actor model gives you a framework that handles concerns most other models leave to the application — at the cost of operational complexity that you must take seriously from day one.

---

## What You Can Build

- **Sharded session service** with passivation, persistence, and OpenTelemetry tracing across a five-node cluster.
- **Saga orchestrator** for cross-service order placement with persistent state, snapshots, and compensations.
- **IoT device shadow service** holding desired-vs-reported state for one million simulated devices with eventual consistency.
- **Real-time chat backend** with per-room sharded persistent actors and a CQRS read-side projection to a search index.
- **Job scheduler** built on a cluster singleton with a backup lease for split-brain safety.
- **Backpressure-aware ingestion pipeline** from Kafka through an enrichment microservice to PostgreSQL with end-to-end commit-on-success semantics.
- **Multiplayer game session service** with sharded match actors, presence tracking via CRDTs, and lobby allocation via leader election.

---

## Further Reading

- *Reactive Messaging Patterns with the Actor Model* by Vaughn Vernon — production patterns with Akka.
- *Designing Data-Intensive Applications* by Martin Kleppmann — distributed systems fundamentals that underpin everything here.
- Akka and Pekko official documentation, especially the cluster, sharding, and persistence sections.
- *Designing for Scalability with Erlang/OTP* by Cesarini and Vinoski.
- *Microsoft Orleans* documentation — virtual actor model and grain placement strategies.
- Roland Kuhn's talks on Reactive Streams design.
- Lightbend's split-brain resolver guide.
- The CRDT papers by Marc Shapiro et al.
- OpenTelemetry documentation for asynchronous propagation.
- Pat Helland's *Life Beyond Distributed Transactions* — the conceptual foundation for sagas.

---

## Related Topics

- [Actor Model — Junior](junior.md)
- [Actor Model — Middle](middle.md)
- [Actor Model — Optimization](optimize.md)
- [Concurrency Models — Overview](../README.md)
- [Event Sourcing and CQRS](../../../../system-design/event-sourcing.md)
- [Saga Pattern](../../../../system-design/saga.md)
- [Distributed Tracing](../../../../observability/distributed-tracing.md)
- [Reactive Streams](../../streams/reactive-streams.md)
- [CRDTs](../../../../distributed-systems/crdts.md)
- [Failure Detectors](../../../../distributed-systems/failure-detectors.md)

---

## Diagrams & Visual Aids

```
Cluster sharding routing

  Client
    |
    | service ! ShardingEnvelope("user-42", msg)
    v
  +---------------------+        +---------------------+
  |     Node A          |        |     Node B          |
  |  ShardRegion --------|------>|  ShardRegion        |
  |     (no shard 7)    |        |    Shard 7          |
  |                     |        |      |              |
  |                     |        |      v              |
  |                     |        |   Entity user-42    |
  +---------------------+        +---------------------+
```

```
Persistent actor recovery

  start
    |
    v
  load snapshot (seqNr = S)
    |
    v
  replay events (S+1 ... latest)
    |
    v
  state ready, unstash deferred commands
    |
    v
  receive new commands
```

```
Cluster singleton over time

  Node A (oldest) hosts singleton
  Node A leaves cluster
        |
        v
  Node B (now oldest) starts singleton
  proxy on every node redirects future messages to Node B
```

```
Split-brain with keep-majority

  Partition: {A, B, C} | {D, E}
  Last-known cluster size: 5
  Half {A,B,C} has 3 of 5 -> majority -> keeps running
  Half {D,E}  has 2 of 5 -> minority -> shuts itself down
```

```
Reactive Streams demand flow

  Sink     <- request(64) --   Flow     <- request(64) --   Source
  Sink     -- onNext(x1) ->    Flow     -- onNext(x1) ->    Source
   ...
  buffer fills -> downstream stops requesting -> upstream stops emitting
```

```
Work-pulling pattern

  Master ---- Job ----> Worker (only after worker sent Pull)
  Worker -- Pull ----> Master
  No queue grows; mailbox depth = number of pending pulls (bounded)
```

```
Saga state machine

  Idle
    | Start
    v
  ReservingInventory --(InventoryReserved)--> ChargingPayment
    | InventoryFailed                          | PaymentFailed
    v                                          v
  Aborting <-(Compensated)---- Aborting (undo inventory)
                                              |
                                              v
                                  Scheduling --(ShippingScheduled)--> Done
```

```
Trace propagation through actors

  HTTP request (trace id T, span S0)
        |
        v
  Actor A: span S1 (parent S0)  --send msg with T,S1-->
                                                       |
                                                       v
                                          Actor B: span S2 (parent S1)
                                                       |
                                                       v
                                          Actor C: span S3 (parent S2)
```

These diagrams together describe the routing, durability, leader, partition, backpressure, control, and observability stories that this document covers. Internalize them and you can read most production actor-system code and reason about it correctly.
