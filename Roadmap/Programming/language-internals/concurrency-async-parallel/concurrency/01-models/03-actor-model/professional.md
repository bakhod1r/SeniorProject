# Actor Model — Professional Level

> **Topic:** [Actor Model](README.md)
> **Focus:** ecosystem, migrations, capacity planning, future

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

The Actor Model has lived through three eras. The first era — defined by Erlang and the BEAM virtual machine — proved that millions of lightweight, isolated processes could run on a single machine and that hot code reload and supervised failure recovery were not academic curiosities but production tools. The second era — defined by Akka on the JVM — brought the model into the enterprise: distributed clusters, persistence journals, sharding, streams, and an ecosystem rich enough to power high-scale ride sharing, telecom, and finance backends. The third era — the one we are inside right now — is the era of consolidation and competition. Lightbend changed Akka's license, the community forked Apache Pekko, Kotlin shipped coroutines that feel actor-like without being actors, the JVM shipped virtual threads (Project Loom) that erase the original motivation for actors as cheap units of concurrency, and Microsoft Orleans keeps quietly powering Xbox and Halo with virtual actors that the developer never explicitly spawns.

This professional-level document is not about how actors work — by now you know. It is about how to live with them. How to compare ecosystems honestly, how to migrate a fifteen-year-old Akka Classic codebase to Akka Typed without rewriting it, how to plan capacity for a node that hosts a million mailboxes, how to recognise the anti-patterns that make actor systems collapse under their own weight, and how to decide — soberly, without ideology — whether the model still pays for itself when virtual threads can serve a hundred thousand simultaneous HTTP requests with a `Thread.startVirtualThread` call.

If junior-level material answered "what is an actor", and senior-level material answered "how do I supervise, persist, shard, and test one", then professional-level material answers "should we still build this on actors in 2026, and if so, with which ecosystem, on which runtime, with which migration path, and what will it cost us per node at peak". The answers are sometimes yes, sometimes no, and almost always nuanced. This document gives you the vocabulary, the trade-off tables, the migration playbooks, and the capacity arithmetic to answer those questions for your own team.

We will start with a cross-ecosystem comparison — Erlang/OTP, Akka, Pekko, Orleans, Pony, Riak Core, Tokio actor crates, Theron — because every other decision flows from "which platform are we even on". Then we will walk through the Lightbend-to-Pekko fork story because it is the single most important ecosystem event of the last five years for actor users on the JVM. Then we migrate, plan capacity, retire, and finally look ahead at whether actors survive the virtual-thread tsunami.

## Prerequisites

Before reading this document, you should be comfortable with:

- The junior-level Actor Model document (messages, mailboxes, isolation, `become`, `ask` vs `tell`).
- The middle-level document (supervision strategies, location transparency, persistence, clustering, sharding).
- The senior-level document (formal semantics, GC of actors, distributed protocols, back-pressure, testing strategies).
- At least one production actor system you have shipped, debugged, or maintained — this material is hard to internalise without scar tissue.
- Working knowledge of the JVM memory model and garbage collector tuning (G1, ZGC, Shenandoah), because most of the ecosystem comparison hinges on runtime behavior.
- Familiarity with Kotlin coroutines or Go goroutines as a reference point for "what cheap concurrency without actors looks like".
- Comfort reading benchmark methodology and capacity-planning arithmetic.

If any of those feel shaky, go back and shore them up. Professional-level material is a poor place to learn fundamentals.

## Glossary

- **BEAM** — Bogdan/Bjorn's Erlang Abstract Machine. The virtual machine underneath Erlang and Elixir.
- **OTP** — Open Telecom Platform. The standard library of Erlang patterns: `gen_server`, supervisors, applications.
- **Akka Classic** — The original untyped Akka API where messages were `Any` and actors had `receive` methods.
- **Akka Typed** — The post-2.6 API where every actor declares its accepted message protocol via a `Behavior[T]` type parameter.
- **Pekko** — Apache Pekko, the community fork of Akka created when Lightbend changed Akka's license to BSL in 2022.
- **BSL** — Business Source License. A source-available license that converts to Apache 2.0 after a delay.
- **Orleans** — Microsoft's "virtual actor" framework on .NET. Actors are implicitly activated on demand.
- **Pony** — A language with a capability-based type system that statically proves actor message safety.
- **Riak Core** — A distributed systems toolkit extracted from the Riak database; built on consistent hashing and vnodes.
- **Virtual actor** — An actor that is conceptually always alive; the runtime activates and deactivates it transparently.
- **Mailbox flavor** — The specific data structure backing a mailbox: bounded, unbounded, priority, stash, control-aware.
- **Dispatcher** — The thread pool that runs actor message-handling code. In Akka, an `ExecutionContext` plus a strategy.
- **Hot code reload** — Replacing a module's bytecode in a running BEAM node without dropping any messages.
- **Loom** — Project Loom, the JVM virtual-threads project that landed in JDK 21.
- **Reactive Streams** — A back-pressure protocol used by Akka Streams and many actor-adjacent libraries.
- **Actor-per-row** — An anti-pattern: spawning one actor per database row instead of one per logical entity with state.
- **Mailbox depth** — Number of messages queued in front of an actor; a primary saturation metric.
- **Scheduler saturation** — Condition where all dispatcher threads are busy and new messages wait — the actor system's equivalent of CPU pegging.

## Core Concepts

### Ecosystem comparison

Pick the platform first; everything else follows. Here is the honest cross-ecosystem table.

| Aspect | Erlang/OTP | Akka (Lightbend) | Apache Pekko | Orleans | Pony | Riak Core | Tokio actor crates | Theron |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime | BEAM VM | JVM | JVM | .NET / CLR | Pony native | Erlang | Rust | C++ |
| License | Apache 2.0 | BSL (paid for prod) | Apache 2.0 | MIT | BSD | Apache 2.0 | MIT/Apache | MIT (dormant) |
| First release | 1986 | 2009 | 2023 | 2015 | 2015 | 2014 | 2018+ (Actix etc.) | 2013 |
| Spawn cost | ~0.3 KB | ~400 B (typed) | ~400 B | implicit (virtual) | ~256 B | n/a (vnode) | ~few KB | ~KB |
| Hot code reload | Yes, first class | No | No | No (deploy units) | No | Yes | No | No |
| Sharding | manually / RA | Cluster Sharding | Cluster Sharding | Built-in via grain placement | manual | Built-in (hash ring) | manual | manual |
| Persistence | Mnesia / external | Akka Persistence | Pekko Persistence | Grain state providers | external | Riak KV | external | external |
| Supervision | OTP supervisors | Behavior trees | Behavior trees | Per-grain isolation | language-enforced | per-vnode | manual | manual |
| Distribution | Built-in (epmd) | Cluster | Cluster | Built-in | n/a (single node) | Built-in | manual | n/a |
| Typed messages | dynamic | `Behavior[T]` | `Behavior[T]` | grain interfaces | capability types | dynamic | enum/trait | virtual methods |
| GC pause profile | per-process (millis) | global JVM (tunable) | global JVM | global CLR | per-actor | per-process | none (Rust) | none (C++) |
| Production users | WhatsApp, Klarna, Ericsson | Tesla, Walmart, PayPal | Apple (post-fork) | Xbox, Halo | small community | Riak users | smaller projects | mostly historical |

The table compresses a thousand-page argument into nine rows, so qualify it: Erlang's "spawn cost" includes per-process heap which grows on use; Orleans grains are not really small because each activation includes a state-loading round trip; Tokio "actor crates" range from Actix (mature, but tied to an older async model) to ractor and xtra (smaller, more idiomatic for modern Tokio). The lesson is not "Erlang is best" — it is "the platform decides 80 percent of your operational reality and 100 percent of your hiring funnel". Pick deliberately.

### The Lightbend → Apache Pekko fork story

In September 2022, Lightbend (the company behind Akka, Play, and Scala commercial support) announced that future Akka versions would ship under the Business Source License (BSL). BSL is not open source: it forbids production use without a commercial agreement, then converts to Apache 2.0 after three years. The intent was reasonable from Lightbend's perspective — large companies extracted enormous value from Akka without contributing back, and Lightbend needed a revenue model. The community reaction was not reasonable from Lightbend's perspective: within weeks, Akka 2.6.20 (the last Apache-licensed release) was forked into a new project called Pekko, donated to the Apache Software Foundation, and aggressively maintained by a coalition including Apple, IBM, Lightbend competitors, and independent contributors.

By 2024, Apache Pekko 1.0 had shipped, and most of the ecosystem libraries (Pekko HTTP, Pekko Streams, Pekko Cluster, Pekko Persistence) were maintained at parity with their Akka counterparts. The fork was clean, the migration path was almost mechanical (a `find/replace s/akka/pekko/` plus a few package updates), and the licensing risk was permanently removed.

The lessons for you, as someone planning actor architecture in 2026 and beyond:

1. **Single-vendor open-source frameworks are an ecosystem risk.** When a single company owns the trademark, the docs, the JIRA, and the release cadence, a license change can strand you. Diversify or pick foundation-governed projects (Apache, CNCF, Eclipse).
2. **The fork dynamic favors the community when the codebase is widely adopted.** Pekko worked because Akka was already used by enough rich, technically competent organizations to fund the fork. Smaller projects do not survive license changes the same way.
3. **Migration cost from Akka to Pekko is low because both are still derivative.** This will not remain true forever — APIs will diverge — so the cost rises over time. Migrate sooner rather than later.
4. **Vendor lock-in via APIs is real but underweighted.** Even if you stay on BSL Akka, you are now coupled to a commercial roadmap. Pekko's roadmap is community-driven, which is slower but more predictable.
5. **The fork did not solve the Akka commercial model's underlying tension.** Other vendors will try license changes — Elastic, Redis, MongoDB, HashiCorp, and Akka are now data points in a pattern. Treat every "permissive-licensed" infrastructure dependency as a potential future fork target.

If you are starting a new project on the JVM today, choose Pekko. If you are on Akka 2.6.x already, plan a migration before your next major version bump.

### Migrating Akka Classic to Akka Typed

Akka 2.6 introduced the Typed API and deprecated Classic. Pekko inherited both. The migration is famously painful because the Classic API was permissive — actors received `Any` and pattern-matched at runtime — and the Typed API forces you to declare a `Behavior[T]` for a specific message type. A migration is therefore not a syntax change; it is a type-system audit of every actor in your codebase.

The standard migration playbook:

1. **Inventory the actors.** Group them by communication pattern: request/response (ask), pub/sub, stash-and-replay, stateful workers, supervisors.
2. **Identify the protocol per actor.** What sealed trait of messages does each actor really accept? If you cannot enumerate them, the actor is already badly designed — fix that first.
3. **Replace Classic actors leaf-first.** Start with actors that have no children (no supervision tree below them). Convert them to Typed. Use Akka's classic-typed interop adapters (`ActorRef[T].toClassic`, `ClassicActorContext.spawn[T]`) to bridge during the rollout.
4. **Move state into the `Behavior` itself.** In Classic, state was a mutable field. In Typed, state is a function parameter that produces the next behavior. This forces immutability and exposes places where state was mutated unsafely.
5. **Replace `sender()` with explicit reply-to in messages.** Typed has no implicit sender. Every request message must carry a `replyTo: ActorRef[Response]` field. This is the most disruptive change because it cascades through your protocols.
6. **Replace `become`/`unbecome` with returning new behaviors.** `context.become(next)` becomes `return next`. Stash semantics map to `Behaviors.withStash`.
7. **Migrate supervision.** Classic supervision was inherited from the parent; Typed supervision is declared at spawn time via `Behaviors.supervise(...)`. Audit every supervisor to make supervision strategies explicit per child.
8. **Migrate tests.** Classic used `TestKit`; Typed uses `ActorTestKit` which is similar but probes are typed.
9. **Migrate persistence.** Classic `PersistentActor` becomes `EventSourcedBehavior`. This is usually the largest single migration step because event-handlers and command-handlers are restructured.
10. **Remove the interop adapters.** Once every actor is typed, remove the classic dependency.

Realistic timeline: a 200k-line Akka Classic codebase with persistence and clustering takes one strong team six to nine months. Budget accordingly.

### Erlang vs Akka in production

Beyond surface comparison, the runtime differences shape what production looks like:

**Concurrency density.** Erlang's BEAM holds millions of processes per node because each process has a tiny initial heap (~300 bytes) that grows on demand and is independently garbage-collected. Akka on the JVM shares one heap across all actors; the JVM happily holds millions of small actor instances, but they all compete for the same GC. Practical Akka clusters run 100k-1M actors per node with careful tuning; Erlang clusters routinely run 5-20M.

**GC behavior.** BEAM does per-process generational GC, so pause times are bounded by the process heap, not the node heap. Akka inherits the JVM's stop-the-world (or concurrent) GC, so a single overloaded actor — one that allocates aggressively — can pause every other actor on the node. Modern ZGC and Shenandoah have made this tolerable (sub-millisecond pauses at multi-terabyte heaps), but tuning is still required.

**Hot code reload.** BEAM lets you replace a module in a running node and have the next message dispatch hit new code, even while old code finishes processing in-flight messages. The pattern is `code_change/3` in a `gen_server`. The JVM has nothing equivalent in production. Akka redeploys via rolling cluster updates: drain a node, restart it on the new code, repeat. The downtime per actor is hundreds of milliseconds at minimum.

**Scheduler.** BEAM ships its own scheduler that runs N OS threads (one per core by default) and round-robins processes across them with reduction counting (each function call decrements a counter, and when it hits zero the process yields). Akka uses an `ExecutionContext` — typically a ForkJoinPool — and depends on the JVM scheduler for actor fairness. This is why a CPU-bound actor in Akka can starve others on the same dispatcher, while in BEAM it cannot.

**Failure model.** Both ecosystems converged on "let it crash". Erlang invented the pattern, OTP encoded it, and Akka adopted it. In practice, Akka's failure semantics are slightly weaker because a JVM thread crash can corrupt the whole node, whereas a BEAM process crash is fully isolated.

Choose Erlang/Elixir when you need millions of concurrent connections per node, when sub-second deploys are critical, and when your team can hire from a small but dedicated talent pool. Choose Akka/Pekko when you are already on the JVM, when you need integration with Java libraries, and when you want a larger hiring pool.

### Designing an actor system from scratch

If you have permission to build the actor framework itself — for an embedded device, a research system, or a language without one — these are the design decisions, in order.

**Naming and addressing.** Decide whether actors have names (path-based addressing like `akka://app/user/orders/42`) or only references (opaque pointers). Names allow location transparency and hierarchical lookup; references allow simpler GC because there is no global registry. Most production systems pick names with optional anonymous spawning.

**Mailbox flavors.** Provide at least:

- **Unbounded FIFO** — simple, the default.
- **Bounded FIFO with overflow policy** — drop oldest, drop newest, block sender, or fail sender. Bounded mailboxes are the only ones that give back-pressure.
- **Priority mailbox** — messages tagged with priority go to the front. Useful for control messages (shutdown, suspend) that must overtake business traffic.
- **Stash** — a side queue where the actor can park messages it cannot handle now and replay them later when state changes.
- **Control-aware mailbox** — internal control messages (terminate, watch failure) bypass the regular queue.

Each flavor is a different data structure (typically a Java `ConcurrentLinkedQueue` or `ArrayBlockingQueue`); document the choice per actor type.

**Dispatcher pool.** Decide how actor message processing maps to OS threads. Three common strategies:

- **One global pool** — N threads serve all actors. Simple, but a slow actor starves others on the same thread.
- **Per-dispatcher pool** — different actor classes get different pools (`io-dispatcher`, `compute-dispatcher`, `db-dispatcher`). Isolates pathological actors.
- **Pinned dispatcher** — one thread per actor. Used for actors that hold native resources (file handles, JNI). Expensive at scale.

The Akka default is the `default-dispatcher` — a ForkJoinPool sized to the number of CPUs. Production systems usually split into 2-4 named dispatchers for isolation.

**Lifecycle and supervision.** Specify pre-start, post-stop, pre-restart, post-restart hooks. Decide whether children are killed on parent stop (Akka default) or kept (rare). Decide supervision granularity: per-child strategies, or one-strategy-fits-all.

**Persistence and event sourcing.** Decide early whether persistence is a first-class concept (Erlang says no, ship Mnesia separately; Akka says yes, integrate via Akka Persistence). Retrofit is painful.

**Cluster boundary.** Decide whether the framework supports remoting and clustering or stops at the local-node boundary. Frameworks that go cluster-native (Akka, Orleans, Erlang) need to define failure detection, gossip, and partition handling. Frameworks that stop at the node (Pony, Theron) leave that to the user — simpler, less powerful.

Document each of these choices in an ADR at the start of the project. They are very hard to reverse.

### Anti-patterns

The five anti-patterns that, in our experience, cause the majority of failed actor projects.

**Actor-per-row.** Spawning one actor per database row — one per order, one per shopping cart item, one per log line. The model encourages this ("everything is an actor"), but actors are not free. Each actor has overhead in mailbox structures, supervision wiring, and GC roots. A million-actor system is feasible; a billion-actor system is not. Use actors for *aggregates* — meaningful units of business state and concurrency — not raw rows.

**Sync ask with no deadlines.** Calling `actor.ask(msg)` and `Await.result(future, Duration.Inf)`. This converts an asynchronous system into a synchronous one, holds threads hostage during slow responses, and propagates back-pressure failures as thread starvation. Always set a deadline; if the deadline expires, treat it as a failure with a proper handler.

**Actor as glorified function.** Wrapping a pure computation in an actor because "the system uses actors". Pure functions should be functions; actors should hold state, supervise children, or own a resource. An actor that processes one message and stops is overhead with extra steps.

**Leaking actor references across protocol boundaries.** Returning an `ActorRef` from a public API. The reference now binds the caller to your internal topology; you cannot refactor without breaking the caller. Expose typed message protocols, gateway actors, or futures — never raw refs.

**Treating actors as services.** Building a microservice where the only API is "send a message to this actor". You lose every benefit of standard service protocols (HTTP, gRPC, observability) and lock external clients into your actor framework. Expose a network protocol; let actors be an internal implementation detail.

### Capacity planning

Capacity planning for actor systems uses three primary metrics: actors per node, mailbox depth, and scheduler saturation.

**Actors per node.** Memory budget per actor varies by framework:

- Pekko/Akka Typed: ~400 bytes for the actor instance plus the mailbox (default unbounded ConcurrentLinkedQueue starts near 100 bytes empty).
- Plus whatever state your actor holds. A typical persistent actor with 5 KB of in-memory state plus mailbox is around 6 KB.

A 32 GB heap therefore holds ~5M actors if your state is small, and ~500k actors if your state is 50 KB each. Plan to leave 30 percent headroom for GC.

**Mailbox depth alerts.** Per-actor mailbox depth is the single most predictive saturation metric. Healthy actors have mailbox depth between 0 and 10. Alert when depth exceeds a threshold (typical: 1000) for more than a short window (typical: 10 seconds). Page when depth exceeds the bounded limit and messages are being dropped or sender-blocked.

**Scheduler saturation.** Measure dispatcher thread utilization. A healthy default-dispatcher runs at 30-60 percent on average. Sustained > 80 percent means the system is one traffic spike away from message latency exploding. Either add more cores, isolate slow actors onto a separate dispatcher, or reduce work.

**A capacity-planning checklist** for a hypothetical 1M-actor cluster:

- Target actors per node: 200k (5 nodes plus 2 for headroom).
- Per-actor memory: 8 KB (instance + mailbox + state).
- Per-node memory: 200k × 8 KB = 1.6 GB just for actors; allocate 8 GB heap for 5x headroom for messages-in-flight and GC.
- Mailbox bound: 100 (drop-oldest with metric alert at depth 50).
- Dispatcher: 16 threads on a 16-core box.
- Cluster gossip frequency: 1 second; adjust if cluster size > 100 nodes (use Akka Distributed Data).
- Persistence storage: estimate events per actor per second × bytes per event × retention; size Cassandra/Postgres accordingly.

Run a load test that hits 80 percent of capacity for 24 hours. The system should hold steady; GC should not increase across the run; mailbox depth distribution should remain skewed left.

### Long-running migration: monolith to actor-based services

The realistic shape of a monolith-to-actors migration over 18 months:

**Months 0-1: Discovery and ADR.** Identify the bounded contexts that will become actor-hosted services. Write an ADR per context explaining why actors are the right model. If you cannot write the ADR honestly, that context should not move.

**Months 1-3: Pilot one bounded context.** Pick the one with the highest concurrency need — usually session management, real-time pricing, or chat. Build it as an actor-based service alongside the monolith. Dual-write to both for safety. Read from the actor system; fall back to the monolith on failure. Measure latency, error rate, and operational toil.

**Months 3-6: Build the platform.** While the pilot runs, build shared infrastructure: cluster bootstrap, persistence, observability dashboards, deployment pipeline, on-call playbooks. The pilot informs the platform; the platform unblocks future migrations.

**Months 6-12: Migrate three to five contexts.** With the platform in place, each new context takes one to two months. Keep dual-writing during migration; cut traffic over a feature flag.

**Months 12-15: Migrate the long tail.** The remaining contexts are the awkward ones — batch jobs, scheduled tasks, admin workflows. Some will not benefit from actors; do not force them.

**Months 15-18: Retire the monolith.** Plan retirement carefully: there are always integrations no one knew about (cron jobs reading from a shared DB, monitoring scripts grepping logs).

The hard parts are not technical. They are the cross-team API contracts during dual-write, the data migrations that span both worlds, and the political work of convincing every team that depended on monolith internals to migrate to the new service APIs.

### Trade-offs vs alternatives

How actors compare to other modern concurrency models:

- **Reactive / Futures pipelines.** Composing CompletableFutures, Reactive Streams (Reactor, RxJava). Lower ceremony, weaker location transparency, no built-in supervision. Choose for in-process pipelines without stateful entities.
- **CSP / Channels.** Go-style goroutines and channels, Kotlin coroutines with `Channel`. Decouples sender and receiver via channels but does not give a location-transparent identity per producer. Choose when you want simple structured concurrency without the actor hierarchy.
- **Raw threading.** `Thread` + `synchronized`. Almost never the right choice for I/O concurrency; sometimes right for tight CPU loops.
- **Virtual threads (Loom).** Cheap threads on the JVM. You can write blocking, imperative code that scales. Choose for request-per-thread server architectures.
- **Async/await.** C#, Rust, Python, modern Kotlin. Composable, no runtime spawning, but no failure isolation primitive. Choose for client-side concurrency and HTTP backends without stateful entities.

The decision matrix is not "actors vs the others" but "which one for which sub-system". A mature backend often has:

- HTTP layer on virtual threads or async (no actors needed).
- Domain entities as actors (per-aggregate, persistent, supervised).
- Background pipelines as Reactive Streams (back-pressured I/O).
- Coordination primitives (locks, leader election) via dedicated libraries.

### Future of the model

Three forces shape the next decade of the actor model.

**Kotlin coroutines and Project Loom erase the original motivation.** Actors were partly invented because OS threads were expensive. Virtual threads on the JVM now cost a few hundred bytes each — comparable to a Pekko actor. You can write `Thread.startVirtualThread { handleRequest() }` and scale to 100k concurrent requests without a framework. This kills the "actors are cheap concurrency" argument. What survives is the *isolation, supervision, and location-transparent identity* argument. Those still require actors (or something actor-like).

**Microsoft Orleans's virtual actor model is winning the mindshare race for stateful entities at scale.** Orleans abstracts away spawn/supervise/persist into "grains" that the runtime activates on demand. A developer writes `await grain.DoStuff()` and the runtime materializes the grain, possibly on another node. This is the future direction of *managed* actor systems. Akka/Pekko Cluster Sharding is similar but more manual.

**Pony, Hewitt's original vision, and capability-based concurrency** remain academically interesting but commercially niche. They will probably influence future mainstream languages (Rust's `Send`/`Sync` and Pony's reference capabilities have a common ancestor) without becoming mainstream themselves.

So: do actors still matter? Yes — for systems with millions of long-lived stateful entities that need supervision, persistence, and distribution. No — for stateless request/response services where virtual threads or coroutines suffice. The model has matured into one tool among many, not the universal answer it once aspired to be. That is healthier.

## Real-World Analogies

A bank with a hundred branches. Each branch (actor) has a manager (its private state), a queue of customers (its mailbox), and a phone line to other branches (message passing). When a branch is robbed (failure), the regional supervisor (parent actor) decides whether to reopen with the same staff (restart), shut it down (stop), or escalate to head office (escalate). When a branch is overloaded, customers wait in line and may be redirected (back-pressure). When the bank goes from 10 branches to 1000 (capacity scaling), the head office must redesign the phone system, the supervision structure, and the customer routing logic — that is your monolith-to-actors migration.

The shift from Akka to Pekko is the equivalent of a national bank consortium that ran the inter-bank settlement system suddenly demanding a per-transaction royalty. Within months a non-profit foundation (Apache) takes over the settlement system, the source code, and the operational responsibility, and the original consortium retreats to selling premium services on top.

Virtual threads are the analogue of suddenly being able to hire one teller per customer at the cost of zero. You no longer need branches if each customer brings their own teller. But you still need *managers* — entities with identity, state, and supervisory responsibility. So actors survive at the management layer, not at the teller layer.

## Mental Models

- **Actors are units of identity and state, not units of work.** If your actor processes a message and disappears, you wanted a thread, not an actor.
- **The framework is a market: it has vendors, forks, deprecations, and consolidation cycles.** Plan dependencies the way you plan vendor contracts.
- **Migrations are protocol audits in disguise.** Akka Classic to Typed forces every actor to declare its message protocol; Akka to Pekko forces every dependency to be re-resolved. Both reveal hidden coupling.
- **Capacity planning is per-actor arithmetic times population times overhead.** Not vibes.
- **The future of the model is "actors for entities, virtual threads for requests, streams for pipelines".** Embrace the polyglot.

## Code Examples

The examples below use Pekko (`org.apache.pekko`). They run on Java 21 / Scala 2.13 with Pekko 1.0.x. To run any one, save it to a file, add a `build.sbt` with `libraryDependencies += "org.apache.pekko" %% "pekko-actor-typed" % "1.0.2"`, and `sbt run`. The first example is the longest because it builds a small payment gateway from scratch.

### Example 1: An actor-first payment gateway

```scala
package payments

import org.apache.pekko.actor.typed._
import org.apache.pekko.actor.typed.scaladsl._
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object PaymentGateway {

  // Protocol — the entire surface of the gateway, typed.
  sealed trait Command
  final case class AuthorizePayment(
    paymentId: String,
    amount: Long,
    currency: String,
    cardToken: String,
    replyTo: ActorRef[AuthorizeResult]
  ) extends Command
  final case class CapturePayment(
    paymentId: String,
    replyTo: ActorRef[CaptureResult]
  ) extends Command
  final case class RefundPayment(
    paymentId: String,
    amount: Long,
    replyTo: ActorRef[RefundResult]
  ) extends Command
  private final case class AuthCallback(
    paymentId: String,
    result: AuthorizeResult
  ) extends Command

  sealed trait AuthorizeResult
  final case class Authorized(paymentId: String, authCode: String) extends AuthorizeResult
  final case class AuthorizationDeclined(paymentId: String, reason: String) extends AuthorizeResult
  final case class AuthorizationFailed(paymentId: String, error: String) extends AuthorizeResult

  sealed trait CaptureResult
  final case class Captured(paymentId: String) extends CaptureResult
  final case class CaptureFailed(paymentId: String, reason: String) extends CaptureResult

  sealed trait RefundResult
  final case class Refunded(paymentId: String, amount: Long) extends RefundResult
  final case class RefundFailed(paymentId: String, reason: String) extends RefundResult

  // The gateway delegates to a per-payment actor for state isolation.
  def apply(processor: ProcessorClient): Behavior[Command] =
    Behaviors.setup { ctx =>
      ctx.log.info("PaymentGateway started")
      router(processor, Map.empty)
    }

  private def router(
    processor: ProcessorClient,
    payments: Map[String, ActorRef[PaymentEntity.Command]]
  ): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case auth: AuthorizePayment =>
          val entity = payments.getOrElse(
            auth.paymentId,
            ctx.spawn(PaymentEntity(auth.paymentId, processor), s"payment-${auth.paymentId}")
          )
          entity ! PaymentEntity.Authorize(auth.amount, auth.currency, auth.cardToken, auth.replyTo)
          router(processor, payments + (auth.paymentId -> entity))

        case cap: CapturePayment =>
          payments.get(cap.paymentId) match {
            case Some(entity) =>
              entity ! PaymentEntity.Capture(cap.replyTo)
              Behaviors.same
            case None =>
              cap.replyTo ! CaptureFailed(cap.paymentId, "unknown payment")
              Behaviors.same
          }

        case ref: RefundPayment =>
          payments.get(ref.paymentId) match {
            case Some(entity) =>
              entity ! PaymentEntity.Refund(ref.amount, ref.replyTo)
              Behaviors.same
            case None =>
              ref.replyTo ! RefundFailed(ref.paymentId, "unknown payment")
              Behaviors.same
          }

        case _: AuthCallback => Behaviors.same
      }
    }
}

object PaymentEntity {
  import PaymentGateway._

  sealed trait Command
  final case class Authorize(amount: Long, currency: String, cardToken: String, replyTo: ActorRef[AuthorizeResult]) extends Command
  final case class Capture(replyTo: ActorRef[CaptureResult]) extends Command
  final case class Refund(amount: Long, replyTo: ActorRef[RefundResult]) extends Command

  def apply(paymentId: String, processor: ProcessorClient): Behavior[Command] =
    idle(paymentId, processor)

  private def idle(paymentId: String, processor: ProcessorClient): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case Authorize(amount, currency, token, replyTo) =>
          ctx.pipeToSelf(processor.authorize(paymentId, amount, currency, token)) {
            case Success(authCode) => InternalAuthOk(authCode, amount, replyTo)
            case Failure(t)        => InternalAuthErr(t.getMessage, replyTo)
          }
          authorizing(paymentId, processor)
        case other =>
          ctx.log.warn(s"Ignored $other in idle state")
          Behaviors.same
      }
    }

  private final case class InternalAuthOk(authCode: String, amount: Long, replyTo: ActorRef[AuthorizeResult]) extends Command
  private final case class InternalAuthErr(reason: String, replyTo: ActorRef[AuthorizeResult]) extends Command

  private def authorizing(paymentId: String, processor: ProcessorClient): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case InternalAuthOk(code, amount, replyTo) =>
          replyTo ! Authorized(paymentId, code)
          authorized(paymentId, processor, code, amount)
        case InternalAuthErr(reason, replyTo) =>
          replyTo ! AuthorizationFailed(paymentId, reason)
          idle(paymentId, processor)
        case other =>
          ctx.log.warn(s"Ignored $other while authorizing")
          Behaviors.same
      }
    }

  private def authorized(paymentId: String, processor: ProcessorClient, authCode: String, amount: Long): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case Capture(replyTo) =>
          replyTo ! Captured(paymentId)
          captured(paymentId, processor, amount)
        case Refund(refundAmount, replyTo) =>
          replyTo ! RefundFailed(paymentId, "cannot refund before capture")
          Behaviors.same
        case _ => Behaviors.same
      }
    }

  private def captured(paymentId: String, processor: ProcessorClient, capturedAmount: Long): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case Refund(amount, replyTo) if amount <= capturedAmount =>
          replyTo ! Refunded(paymentId, amount)
          Behaviors.same
        case Refund(_, replyTo) =>
          replyTo ! RefundFailed(paymentId, "refund exceeds captured amount")
          Behaviors.same
        case _ => Behaviors.same
      }
    }
}
```

Key design lessons in this example: the public gateway delegates to per-payment entities so that no two payments share state; state transitions are encoded by *returning new behaviors* rather than mutating fields; external calls are asynchronous via `pipeToSelf`; every protocol message carries its own `replyTo` so the actor never relies on an implicit sender.

### Example 2: Chat platform migration from threads to actors

```scala
// BEFORE: thread-per-connection chat server (simplified).
//
// class ChatServer {
//   private val rooms = new ConcurrentHashMap[String, Room]()
//   def handleClient(socket: Socket): Unit = {
//     val thread = new Thread(() => {
//       val in = new BufferedReader(...)
//       var line: String = null
//       while ({ line = in.readLine(); line != null }) {
//         val Array(cmd, room, body @ _*) = line.split(" ", 3)
//         cmd match {
//           case "JOIN" => rooms.computeIfAbsent(room, _ => new Room()).join(socket)
//           case "SAY"  => rooms.get(room).broadcast(body.headOption.getOrElse(""))
//         }
//       }
//     })
//     thread.start()
//   }
// }
//
// Problems: one OS thread per connection, ConcurrentHashMap contention,
// no failure isolation per room, broadcast holds the writer thread.
//
// AFTER: actor-per-room with typed protocol.

import org.apache.pekko.actor.typed._
import org.apache.pekko.actor.typed.scaladsl._

object ChatRoom {
  sealed trait Command
  final case class Join(user: String, ref: ActorRef[Event]) extends Command
  final case class Leave(user: String) extends Command
  final case class Say(from: String, text: String) extends Command

  sealed trait Event
  final case class Message(from: String, text: String) extends Event
  final case class Joined(user: String) extends Event
  final case class Left(user: String) extends Event

  def apply(): Behavior[Command] = empty

  private def empty: Behavior[Command] = withMembers(Map.empty)

  private def withMembers(members: Map[String, ActorRef[Event]]): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case Join(user, ref) =>
          members.values.foreach(_ ! Joined(user))
          withMembers(members + (user -> ref))
        case Leave(user) =>
          val next = members - user
          next.values.foreach(_ ! Left(user))
          withMembers(next)
        case Say(from, text) =>
          members.values.foreach(_ ! Message(from, text))
          Behaviors.same
      }
    }
}

object ChatServer {
  sealed trait Command
  final case class RouteJoin(room: String, user: String, ref: ActorRef[ChatRoom.Event]) extends Command
  final case class RouteSay(room: String, user: String, text: String) extends Command

  def apply(): Behavior[Command] = withRooms(Map.empty)

  private def withRooms(rooms: Map[String, ActorRef[ChatRoom.Command]]): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case RouteJoin(room, user, ref) =>
          val r = rooms.getOrElse(room, ctx.spawn(ChatRoom(), s"room-$room"))
          r ! ChatRoom.Join(user, ref)
          withRooms(rooms + (room -> r))
        case RouteSay(room, user, text) =>
          rooms.get(room).foreach(_ ! ChatRoom.Say(user, text))
          Behaviors.same
      }
    }
}
```

Migration trade-offs you actually face: the thread-per-connection model is easier to debug (a stack trace tells the whole story) but does not scale past 50-100k connections per node; the actor model trades stack traces for asynchronous traces and scales past a million rooms per node. Choose based on connection count and the cost of debugging async flows.

### Example 3: "We built actors and regretted it" retrospective

A real anti-example: a startup built an internal CRUD admin tool using Akka and Akka HTTP because the founding engineer was an Akka enthusiast.

```scala
// Anti-pattern: an actor wrapping a simple service.
object UserService {
  sealed trait Command
  case class CreateUser(name: String, replyTo: ActorRef[String]) extends Command
  case class GetUser(id: String, replyTo: ActorRef[Option[User]]) extends Command
  case class DeleteUser(id: String, replyTo: ActorRef[Boolean]) extends Command

  def apply(repo: UserRepo): Behavior[Command] = Behaviors.receive { (ctx, msg) =>
    msg match {
      case CreateUser(name, replyTo) =>
        val id = repo.insert(name) // BLOCKING JDBC call from within an actor.
        replyTo ! id
        Behaviors.same
      case GetUser(id, replyTo) =>
        replyTo ! repo.findById(id) // Another blocking call.
        Behaviors.same
      case DeleteUser(id, replyTo) =>
        replyTo ! repo.delete(id)
        Behaviors.same
    }
  }
}
```

Why this was wrong:

1. The actor holds no state — it is a function wrapper.
2. Every call is blocking JDBC; the dispatcher thread is held during the database round trip, so a slow database starves the entire system.
3. The HTTP layer asks this actor with no timeout, so a slow DB query manifests as accumulated mailbox depth and eventually OOM.
4. There is no supervision benefit: a JDBC exception is logged and swallowed; there is no parent to restart anything.
5. The team had to learn Akka idioms (Behaviors, ActorRefs, dispatchers, ask timeouts) for no benefit.

The replacement was a plain `class UserService(repo: UserRepo)` with synchronous methods served by Akka HTTP routes — three weeks of cleanup. Lesson: actors are not the default model. If the system has no concurrency need, no failure-isolation need, and no stateful entities, do not use actors. Use the simplest abstraction that fits.

## Pros & Cons

**Pros at professional scale.**

- Per-entity isolation scales to millions of entities and survives partial failure cleanly.
- Hot-code reload (BEAM) or rolling cluster restarts (Akka/Pekko) keep production live during deploys.
- Location transparency lets you scale horizontally without rewriting protocol code.
- Mature observability tooling: per-actor metrics, mailbox depth, persistence event logs.
- Predictable back-pressure with bounded mailboxes.

**Cons at professional scale.**

- Ecosystem risk (Lightbend license change; vendor consolidation).
- Migration cost between major versions (Classic to Typed; Akka to Pekko).
- Talent funnel is narrower than mainstream backend stacks.
- Async-first style makes debugging harder than virtual-threaded request-per-thread.
- Capacity planning requires per-actor arithmetic that few teams do correctly.
- When a node is overloaded, mailbox depth grows silently before metrics catch it.

## Use Cases

Where actors still win in 2026:

- **Game servers** holding millions of player sessions (Orleans powers Halo).
- **IoT and telecom** with millions of long-lived stateful sessions (BEAM's traditional home).
- **Financial systems** where per-account isolation, supervision, and event sourcing all line up.
- **Real-time collaboration backends** with rooms or documents as entities.
- **Workflow orchestration** with persistent, supervised state machines per workflow instance.

Where they no longer win:

- Stateless HTTP APIs (use virtual threads or async).
- Batch ETL pipelines (use streams or task graphs).
- Pure compute (use thread pools or GPU).
- Simple CRUD apps (use whatever framework your team already uses).

## Coding Patterns

- **Aggregate-per-actor**, never row-per-actor.
- **Typed protocols** with sealed traits enumerating every accepted message.
- **Explicit reply-to** in every request message.
- **Bounded mailboxes with overflow policies** for any actor under client-facing load.
- **Per-dispatcher isolation** for I/O-bound vs CPU-bound actors.
- **Persistence via event sourcing**, never via direct database mutation.
- **Cluster sharding** for distributing entity actors; never spawn manually across nodes.
- **Health checks** that probe sample actors, not just the JVM.

## Clean Code

- One protocol trait per actor; do not share traits across actors.
- One file per actor unless three actors form one tight coordination unit.
- Behaviors should be small functions; if a behavior is longer than 40 lines, split it into states.
- Never `Await.result` outside of test code.
- Name actors after their entity (`session-42`), not after their behavior (`session-actor`).
- Document supervision strategy at every spawn site; resist global defaults that hide policy.

## Best Practices

- Choose Pekko over Akka for new projects on the JVM.
- Migrate Classic to Typed before any major business feature work; the cost only grows.
- Define dispatcher pools per workload class.
- Bound every mailbox.
- Instrument mailbox depth, dispatcher saturation, and persistence lag.
- Plan capacity per node with actual arithmetic, not vibes.
- Run a 24-hour soak test at 80 percent of target load before each release.
- Treat the actor framework as a vendor relationship; track upstream releases and license changes.

## Edge Cases & Pitfalls

- **License auditing.** If your dependency tree pulls in BSL Akka transitively, you may be in violation without knowing it. Audit annually.
- **Hot code reload only works on BEAM.** Do not promise it on Akka unless you mean rolling restarts.
- **Sharded entity rebalance** during cluster topology change drops in-flight messages; design retries.
- **Distributed Data conflict resolution** in eventually consistent clusters: the merge function runs in actor context but must be commutative; bugs are silent.
- **Cluster bootstrap** must use a stable seed mechanism (Kubernetes APIs, DNS, Consul); manual seed lists drift and rot.
- **Stash overflow** when an actor stays in a state too long; stash has a bound.
- **`ask` timeouts under retries** can cause duplicate side effects; design idempotent commands.

## Common Mistakes

- Using actors as glorified functions.
- Spawning an actor per database row.
- Returning `ActorRef`s across public API boundaries.
- Calling blocking JDBC from actor message handlers without a dedicated dispatcher.
- Forgetting to set ask timeouts.
- Using Akka 2.7+ in production without a commercial license.
- Migrating Classic to Typed without first auditing protocols.
- Sizing dispatchers by guessing instead of measuring.

## Tricky Points

- The Pekko fork is a community success but does not eliminate vendor risk; one community member could quietly stop maintaining a critical module.
- Akka Typed enforces protocol types at compile time but not across cluster boundaries; serialization compatibility is still a manual concern.
- Orleans grains hide activation entirely; this is liberating until you need to control placement for data locality.
- BEAM's per-process GC is excellent but has no equivalent on JVM; do not promise BEAM-like memory profiles on Akka.
- Loom virtual threads compete with actors at the cheap-concurrency layer but not at the supervision-and-identity layer.

## Test Yourself

1. Why did Lightbend change Akka's license, and what license did they choose?
2. Name three concrete code-level differences between Akka Classic and Akka Typed.
3. What is the spawn cost in bytes of an Erlang process vs a Pekko Typed actor?
4. How would you size a dispatcher for an actor system with 200k entities and 5k messages per second per node?
5. List three anti-patterns and the symptom each produces in production.
6. When does Loom kill the case for actors and when does it not?
7. What is a virtual actor and what is the trade-off vs explicit spawning?
8. What metric is the earliest predictor of actor system overload?
9. How would you migrate a stateful actor's persistence schema without downtime?
10. Why is `Await.result` an actor anti-pattern even when it is convenient?

## Tricky Questions

1. Your team is split between staying on Akka 2.6 BSL and migrating to Pekko. How do you frame the decision for leadership?
2. A bounded mailbox is full. Drop-oldest discards in-flight financial messages. Drop-newest discards customer-visible writes. Block-sender freezes the request thread. Pick one for a payment flow and justify.
3. An Orleans grain is hot — millions of calls per minute land on one virtual actor. The runtime does not partition by default. What is your mitigation?
4. You inherit a codebase with 80k actor instances per node and the JVM heap is 64 GB. GC pauses are 300 ms. What three things do you check first?
5. A junior engineer says "let's use Loom virtual threads instead of actors for the new service". The service holds 50k stateful user sessions. What is your answer?
6. Pekko 1.0 just shipped. Your Akka 2.6 dependency still works fine. Why migrate now vs in two years?
7. Your actor system loses messages during a rolling restart at one in ten thousand requests. Trace the design choices that allowed this.
8. Capacity planning says you need 7 nodes. CFO says budget covers 3. Which actor-system levers can you pull to fit?

## Cheat Sheet

| Decision | Default | Override when |
| --- | --- | --- |
| JVM framework | Pekko | Legacy Akka with commercial license |
| API style | Typed | Cannot afford migration yet |
| Mailbox | Bounded FIFO | Internal control flow |
| Dispatcher | default per workload | Blocking I/O — dedicated pool |
| Persistence | Event sourcing | Pure ephemeral state |
| Distribution | Cluster Sharding | Single node sufficient |
| Failure | "Let it crash" + supervise | Cannot recover via restart |
| `ask` | With deadline | Never indefinite |
| Capacity sizing | Per-actor arithmetic | Always |

Spawn-cost rule of thumb:

- BEAM process: 300 B base.
- Pekko Typed actor: 400 B base.
- Add mailbox: ~100 B empty, grows with depth.
- Add state: whatever your aggregate holds.

Capacity rule of thumb per node:

- Memory: `actors × (400 + state_bytes + avg_mailbox_depth × msg_bytes)` plus 3x headroom.
- Threads: `max(cores, peak_concurrent_blocking_calls)`.
- Mailbox alert: depth > 1000 for 10 s.
- Dispatcher saturation alert: > 80 percent for 60 s.

## Summary

Professional-level actor mastery is no longer about understanding the model. It is about understanding the ecosystem — which framework, which license, which migration path, which capacity arithmetic, and which alternative wins in 2026. Pick Pekko if you are on the JVM. Migrate Classic to Typed sooner rather than later. Plan capacity per actor with real numbers. Bound mailboxes. Isolate dispatchers. Treat the framework as a vendor relationship with ecosystem risk and migration cost. Recognise the anti-patterns: actor-per-row, sync ask without deadlines, actor as glorified function, leaking refs, actor as service. Acknowledge that virtual threads erase the cheap-concurrency case for actors but not the supervision-and-identity case. Use actors where they earn their cost — stateful entities at scale — and use simpler tools everywhere else.

## What You Can Build

With this level of mastery you can:

- Lead an Akka-to-Pekko migration for a 200k-line codebase end to end.
- Lead a Classic-to-Typed migration on the same codebase with a realistic 6-9 month plan.
- Design an actor system from scratch for a constrained runtime (embedded, custom language).
- Build a horizontally scaled, sharded, event-sourced payment platform.
- Plan capacity for a 1M-entity cluster with defensible per-node arithmetic.
- Conduct an ecosystem review and recommend actors vs virtual threads vs streams per subsystem.
- Author ADRs explaining concurrency-model choices to non-actor teams.
- Run incident response on overloaded mailboxes, cluster partitions, and persistence lag.

## Further Reading

- *Designing Data-Intensive Applications* — Martin Kleppmann (capacity, partitioning, replication).
- *Reactive Design Patterns* — Roland Kuhn, Brian Hanafee, Jamie Allen (Akka co-author).
- *Programming Erlang* — Joe Armstrong (BEAM and OTP fundamentals).
- *Designing for Scalability with Erlang/OTP* — Cesarini and Vinoski.
- Microsoft Orleans documentation, especially "Virtual Actors" and "Grain Placement".
- Pony language reference and "Deny capabilities for safe, fast actors" paper.
- Apache Pekko migration guide and release notes.
- Project Loom documentation: JEP 425, 436, 444.
- "The State of Actors in 2024" — Klang and Kuhn keynote.
- Lightbend license change announcement and Pekko fork retrospectives.

## Related Topics

- [Concurrency Models — Overview](../README.md)
- [CSP and Channels](../02-csp-channels/README.md)
- [Coroutines and Async/Await](../04-coroutines-and-async-await/README.md)
- [Virtual Threads and Project Loom](../../05-runtimes/loom/README.md)
- [Event Sourcing and CQRS](../../../patterns/event-sourcing/README.md)
- [Cluster Sharding](../../../patterns/cluster-sharding/README.md)
- [Supervision Trees](../../../patterns/supervision-trees/README.md)
- [Reactive Streams Back-Pressure](../../../patterns/reactive-streams/README.md)

## Diagrams & Visual Aids

```
Ecosystem decision tree (2026)

  Need stateful entities at scale?
    yes -> Need .NET? -> Orleans
        -> Need BEAM (hot reload, density)? -> Erlang/Elixir
        -> Need JVM? -> Pekko (Typed)
    no -> Need cheap concurrency only?
        -> JVM -> Virtual threads
        -> Kotlin/Go -> coroutines / goroutines
        -> Rust -> Tokio (async/await, not actors)
        -> Pipelines? -> Reactive Streams
```

```
Mailbox saturation timeline

  t0  depth = 0     healthy
  t1  depth = 50    early warning
  t2  depth = 500   degraded latency
  t3  depth = 1000  alert fires
  t4  depth = bound overflow policy engages
  t5  depth > bound senders blocked / messages dropped / OOM risk
```

```
Migration playbook (Classic -> Typed)

  inventory -> protocols -> leaf actors -> stateful actors
            -> supervisors -> persistence -> tests -> remove adapters
```

```
Capacity arithmetic skeleton

  per_actor_bytes = 400 + state_size + avg_depth * msg_size
  per_node_actors = heap_budget / per_actor_bytes / 3
  cluster_size    = total_entities / per_node_actors + redundancy
```

```
Future-of-the-model map

  Cheap concurrency  -> Loom / coroutines / goroutines  (actors lose here)
  Stateful identity  -> Actors / virtual actors         (actors win here)
  Distributed state  -> Cluster sharding / Orleans       (actors win here)
  Pipelines          -> Reactive Streams / async         (actors lose here)
  Pure compute       -> Thread pools / GPU               (actors lose here)
```
