# Actor Model & CSP — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Actor Model & CSP
> *Erlang took one idea — isolated processes exchanging messages — and built an entire reliability platform on it: supervision trees, hot code reload, and distribution where a message to a remote node looks like a message to a local one. At scale, the actor model stops being a concurrency trick and becomes a distributed-systems architecture.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Erlang/OTP Model: A Reliability Platform](#the-erlangotp-model-a-reliability-platform)
3. [Supervision Trees in Anger](#supervision-trees-in-anger)
4. [Distribution Transparency & Location Transparency](#distribution-transparency--location-transparency)
5. [Delivery Guarantees Across the Network](#delivery-guarantees-across-the-network)
6. [Hot Code Reload](#hot-code-reload)
7. [Akka & Actors for Distributed Systems at Scale](#akka--actors-for-distributed-systems-at-scale)
8. [CSP at Scale in Go Services](#csp-at-scale-in-go-services)
9. [Testing & Observing Message-Passing Systems](#testing--observing-message-passing-systems)
10. [Relation to Event-Driven & Microservice Messaging](#relation-to-event-driven--microservice-messaging)
11. [Where the Paradigm Ends and the Mechanics Begin](#where-the-paradigm-ends-and-the-mechanics-begin)
12. [Common Mistakes](#common-mistakes)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does this paradigm scale to real distributed systems, and what does mastery look like?**

Most concurrency models stop at the edge of one process. The actor model's claim to fame is that it *doesn't* — the same abstraction (isolated unit, address, mailbox, message) that organizes concurrency inside a node also organizes concurrency *across* nodes, because nothing in the model ever assumed shared memory or a single machine. That continuity is why Erlang has run telecom switches at **nine-nines availability** (≈ 31 ms of downtime per year) and why "actor systems" and "distributed systems" are nearly synonymous in practice.

This level is about the actor model as an **architecture**, not a syntax. The vehicle is **Erlang/OTP** — not because you'll necessarily write Erlang, but because OTP is the most complete, battle-tested embodiment of the ideas, and every later actor system (Akka, Orleans, Elixir/Phoenix, Ractor, Pony) borrows from it. We cover supervision trees as a real fault-tolerance discipline, **location transparency** (the property that makes distribution feel like local messaging), the **delivery guarantees** you actually get over a network, and **hot code reload**. Then we contrast with **CSP at scale in Go**, and place the whole paradigm next to **event-driven systems and microservice messaging**, which are the same idea wearing infrastructure clothes.

One boundary to set up front: this topic is about the **paradigm**. The *mechanics* — how a scheduler multiplexes millions of green processes onto OS threads, how channels are implemented, the memory model — live in [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/). Here we care about *how thinking in isolated message-passing units shapes a system's architecture*.

---

## The Erlang/OTP Model: A Reliability Platform

Erlang's designers at Ericsson started from a requirement, not a language: build phone switches that **never go down**, even while being upgraded, even when code has bugs. The actor model fell out of that requirement, and four properties together make it a *reliability platform* rather than just a concurrency model:

1. **Total process isolation.** Erlang processes share **nothing** — separate heaps, no shared memory, communication only by copying messages. One process crashing cannot corrupt another's memory. (Contrast with OS threads sharing an address space, where one bad write corrupts everyone.)
2. **Cheap processes, millions of them.** A process is a few hundred bytes, scheduled by the BEAM VM, not the OS. You model *every* concurrent thing — every call, connection, session — as its own process, because you can afford to.
3. **Links and monitors.** Processes can **link** (if one dies, the other gets a signal) and **monitor** (get notified of another's death without dying yourself). This is the wiring that makes supervision possible.
4. **Built-in distribution.** Processes on different machines send messages with the *same* `!` operator as local ones. The runtime handles the network. (More below.)

OTP (Open Telecom Platform) is the **framework** that turns these primitives into reusable patterns. The key insight of OTP is that almost every actor is one of a few *behaviors*:

- **`gen_server`** — a generic server: a process that holds state and handles synchronous `call` / asynchronous `cast` requests. 90% of your "actors" are `gen_server`s. You write the state-transition callbacks; OTP writes the mailbox loop, the request/reply plumbing, timeouts, and the supervision hooks.
- **`gen_statem`** — a generic state machine, when the entity has explicit states and transitions.
- **`supervisor`** — a process whose only job is to start, watch, and restart children per a strategy.

```erlang
% A gen_server: you write the callbacks; OTP writes the loop, the
% request/reply, the supervision integration. This is "an actor" in production form.
init(_) -> {ok, #{count => 0}}.

handle_call(get, _From, State) ->                 % synchronous request → reply
    {reply, maps:get(count, State), State};
handle_cast(increment, State) ->                  % async, no reply
    {noreply, maps:update_with(count, fun(N) -> N + 1 end, State)}.
```

The professional point: you rarely hand-roll the `receive` loop. You pick an OTP behavior, fill in the callbacks, and you inherit decades of hardening — correct request/reply, timeout handling, supervision integration, and introspection (you can ask a live `gen_server` for its state in production). **OTP is the actor model productionized.**

---

## Supervision Trees in Anger

The senior level introduced "let it crash." At professional scale it becomes a **structural discipline** for *where in the tree failure is handled and how blast radius is bounded.*

A real system is a **tree of supervisors over workers**. Leaves do work and are allowed to die; inner nodes are supervisors whose entire job is to react to children dying. The design decisions are:

- **Restart strategy** — what happens when a child dies:
  - `one_for_one` — restart only the dead child (children are independent).
  - `one_for_all` — restart *all* children (they share fate; if one dies the others' state is now invalid).
  - `rest_for_one` — restart the dead child and everything started *after* it (later children depend on earlier ones).
- **Restart intensity** — "if more than *N* restarts happen in *T* seconds, give up and let *this supervisor* die." This is how transient bugs get retried but a *persistent* failure **escalates up the tree** instead of restart-looping forever. A crash that the local supervisor can't fix becomes the *parent's* problem — failure bubbles up until someone can handle it (or the whole subsystem restarts clean).
- **Where to put state.** The art is keeping **volatile, recomputable state in workers** (so losing it on a crash is cheap) and **durable state in a separate store** (so a restart re-reads it). A worker that holds the only copy of critical state defeats "let it crash."

```
        root_sup  (one_for_one)
        /        \
   db_sup         api_sup  (one_for_all: conn + pool share fate)
   /   \           /    \
 conn  pool   listener  worker_pool_sup (one_for_one)
                              |  ...  |
                           worker   worker   <- crash here: only this worker restarts
```

The blast radius of a bug is **the subtree under the supervisor that catches it.** Architecting the tree *is* architecting fault tolerance: put independent failures under `one_for_one`, fate-shared resources under `one_for_all`, and dependency chains under `rest_for_one`. This is a design skill with no equivalent in lock-based concurrency — there, a crash is just a crash.

---

## Distribution Transparency & Location Transparency

This is the property that elevates the actor model from concurrency to distributed architecture:

> **Location transparency:** sending a message to an actor looks the *same* whether the actor is in your process, in another process on the same machine, or on a different machine across the network. You hold an *address*; you send; the runtime routes it.

```erlang
% Local send and remote send are syntactically identical:
Pid ! {work, Data}.                       % Pid might be local...
{some_server, 'node@host2'} ! {work, Data}.  % ...or on another machine. Same `!`.
```

Why this is profound: because the actor model **never assumed shared memory or a single address space**, distributing it is mostly a routing problem, not a rewrite. The same code that coordinates entities in one node coordinates them across a cluster. Akka calls this "the network is the model"; Erlang gives you a *cluster of nodes* where processes address each other by name regardless of host.

But location transparency is **not location *invisibility***, and conflating the two is a classic, costly mistake:

- A local message is a memory copy in microseconds and never fails. A remote message crosses a network: it can be **delayed, reordered, lost, or arrive after the node is gone.** The *syntax* is identical; the *failure modes and latency* are not.
- The famous *"Fallacies of Distributed Computing"* (Deutsch/Gosling) apply in full: the network is **not** reliable, latency is **not** zero, bandwidth is **not** infinite. Location transparency lets you *write* distributed code easily; it does **not** make the network behave like local memory.

The professional stance: location transparency is a **deployment flexibility** tool (start everything in one node, split across machines later without rewriting message logic) — but you must **design for remote failure from the start** wherever a message *might* cross a node boundary. Treat every cross-node send as potentially failing, and you get the upside without the trap.

---

## Delivery Guarantees Across the Network

In-node, Erlang message passing is reliable and point-to-point ordered. **Across nodes, the default is at-most-once** — fire-and-forget; if the network drops the message or the link breaks, it's simply gone, and the sender isn't told. This is a *deliberate* choice: at-most-once is cheap and has clean semantics, and Erlang pushes reliability up to *supervision and monitoring* (you detect the dead peer via a monitor and react) rather than into the transport.

When you need stronger guarantees, you build them on top — and the menu is the same one every distributed system faces:

- **At-most-once** (Erlang default): no duplicates, possible loss. Fine for idempotent refreshes, telemetry, cache invalidations you'll re-issue anyway.
- **At-least-once**: sender retries until acked → no loss, possible **duplicates**. Requires the receiver to **deduplicate** or be **idempotent**. This is what Akka Persistence's `AtLeastOnceDelivery`, Kafka consumers, and most durable queues give you.
- **Exactly-once *effect***: at-least-once delivery + idempotent processing (dedupe by message id, or design operations so a replay is a no-op). True exactly-once *delivery* is impossible over an unreliable network (you can't distinguish "ack lost" from "message lost" without a retry that risks a duplicate).

The professional reflex: **decide the guarantee per message type, and make the receiver idempotent for anything stronger than at-most-once.** "We use exactly-once" is, in a well-run system, shorthand for "we deliver at-least-once and dedupe." This is the same reasoning the [System Design → Message Queues](../../../Architecture/system-design/) material applies to Kafka/RabbitMQ/SQS — the actor model just confronts it earlier because *every* inter-actor link is a tiny message channel.

---

## Hot Code Reload

A requirement that fell directly out of "switches must never go down": **upgrade the running code without stopping the system.** Erlang/BEAM supports loading a new version of a module while processes are mid-flight.

The mechanism is tied to the message loop. A process loops by calling its own behavior function; if it makes a **fully-qualified call** (`?MODULE:loop(State)`) on the next iteration, the VM dispatches to the *latest* loaded version of `loop`. So between handling one message and the next, a process can transparently start running new code — and OTP's `code_change` callback lets a `gen_server` *transform its state* to match the new code's expectations.

```erlang
% gen_server hook: when new code is loaded, migrate the old state shape to the new one.
code_change(_OldVsn, State, _Extra) ->
    NewState = add_new_field(State),   % e.g., old state had no `retries` field
    {ok, NewState}.
```

Why the *paradigm* makes this feasible where it's nearly impossible elsewhere: because each process is **isolated and message-driven**, there's a natural safe point (between messages) to swap code, and no shared mutable state straddling the old/new boundary to corrupt. In a shared-memory thread pool, "replace the code while threads are running through it" has no such clean seam.

Caveats keep this honest: hot reload is genuinely hard to get right (state migration bugs, two code versions transiently coexisting), and most modern deployments prefer **rolling restarts / blue-green** for upgrades. But it remains the *defining* demonstration that the actor model's isolation buys operational properties other models can't easily offer.

---

## Akka & Actors for Distributed Systems at Scale

Akka (Scala/Java) brought the actor model to the JVM and pushed it toward large distributed systems. The professional-relevant pieces:

- **Akka Cluster** — actors spread across a cluster of nodes with gossip-based membership and failure detection. **Cluster Sharding** distributes "entity actors" (one actor per user/order/device) across nodes, transparently routing a message for entity *X* to wherever *X* currently lives, and migrating entities when nodes join/leave. This is "one actor per entity" scaled to millions of entities across a fleet.
- **Akka Persistence (event sourcing)** — an actor persists the *events* that changed its state, not the state itself; on restart it **replays** them to rebuild. This marries the actor model to [event sourcing](../../../Architecture/system-design/) and makes "let it crash and restart" durable: the rebuilt actor is exactly where it left off. (Microsoft's **Orleans** "virtual actors / grains" is a parallel lineage with the same persistence-and-placement ideas.)
- **Akka Typed** — addresses a long-standing actor weakness: the classic mailbox accepts `Any`, so "wrong message to wrong actor" is a runtime error. Typed actors put the protocol in the type system, catching mismatches at compile time — the actor-world answer to the "messages are stringly-typed" critique.
- **Backpressure** — Akka Streams implements **Reactive Streams** backpressure over actors, giving the bounded-flow control that raw unbounded mailboxes lack (the senior-level overflow problem, solved at the framework layer). See [Reactive Programming](../05-reactive-programming/).

The pattern across Erlang, Akka, and Orleans is the same: **the actor is the unit of state, concurrency, distribution, and failure all at once** — which is exactly why it scales to systems with millions of independently-living entities.

---

## CSP at Scale in Go Services

Go scaled the *other* model — CSP — to enormous production use (Kubernetes, Docker, most cloud infrastructure). At scale, the professional Go concurrency story is less about raw channels and more about **disciplined patterns** that prevent the failure modes the senior level warned about:

- **`context.Context` everywhere** — cancellation and deadlines flow down the goroutine tree. Every blocking operation selects on `ctx.Done()` so a cancelled request tears down *all* its goroutines, preventing the #1 CSP leak: **goroutines blocked forever on a channel nobody will ever send to.**
- **Bounded everything** — worker pools with a fixed number of goroutines draining a buffered channel, so load is shed or queued deliberately rather than spawning unbounded goroutines. This is CSP's answer to backpressure, applied as a discipline.
- **`errgroup` / structured concurrency** — tie a group of goroutines to one lifetime: the first error cancels the rest, and you wait for all to finish. This recovers some of what actor supervision gives for free — *bounded, jointly-managed concurrency* instead of fire-and-forget goroutines.
- **Channels for coordination, not for shared state at scale.** Mature Go uses channels for *handing off work and signaling*, and is perfectly willing to use a `sync.Mutex` for a small piece of shared state where a channel round trip would be silly — "share memory by communicating" is the *default*, not a religion.

The honest contrast: Go gives you a superb in-process CSP runtime but **no built-in distribution or supervision.** Distributed Go services coordinate through *external* infrastructure — gRPC, message queues, service meshes — not through the language's channels. So Go's CSP is the *intra-service* concurrency model; the *inter-service* layer is event-driven/microservice messaging (next section). Erlang/Akka, by contrast, extend the *same* model across the wire. That difference — does the message-passing model stop at the process boundary or cross it? — is the single biggest architectural distinction between the CSP and actor lineages at scale.

---

## Testing & Observing Message-Passing Systems

Two operational problems are intrinsic to this paradigm and deserve a deliberate strategy, not improvisation.

**Testing.** Message-passing systems are *non-deterministic* by construction — the interleaving of messages from different senders varies run to run — so a test that passes once may fail under a different schedule. Mature approaches:

- **Deterministic schedulers.** Run the actor system under a test runtime that controls message ordering, so you can replay a specific interleaving and assert on it (Akka's `TestKit`/`BehaviorTestKit`, Erlang's `meck`/`common_test` with controlled timing). This turns "flaky concurrency bug" into a reproducible test.
- **Property-based & simulation testing.** Generate many message orderings and assert invariants hold under *all* of them — the lineage that produced FoundationDB's deterministic simulation and Jepsen-style fault injection. This is how you find the ordering-dependent bug that a handful of example tests miss.
- **Test one actor at a time.** Because actors are isolated, you can test an actor in isolation by feeding it messages and asserting on the messages it emits — a clean unit-test seam that shared-memory concurrency rarely offers.

**Observing.** The senior level made correlation IDs mandatory; at production scale the specific signals to instrument are:

- **Mailbox / queue depth** per actor type or per partition — the earliest indicator of overload or a stuck consumer; a monotonically rising queue is a deadlock or a slow handler.
- **Restart counts** per supervisor — a rising restart rate is a bug surfacing through "let it crash"; a flat-then-spiking curve often precedes a crash-loop escalation.
- **Message latency distribution** (enqueue → handled), not just throughput — tail latency reveals a handler that occasionally blocks.
- **Dead-letter volume** — messages that found no recipient or exhausted retries; a nonzero, growing DLQ is a correctness signal, not noise.

The throughline: in a shared-memory system you watch CPU, locks, and memory; in a message-passing system you watch **queues, restarts, and latencies** — the health of the *flow*, because flow is what you build the system out of. See [Observability](../../../Architecture/system-design/).

---

## Relation to Event-Driven & Microservice Messaging

At the architecture level, the actor model and modern **event-driven microservices** converge — they're the same paradigm at different granularities:

- An **actor** is an isolated unit of state reacting to messages. A **microservice** consuming from a queue is an isolated unit of state reacting to messages. The actor's mailbox is the service's **inbound queue** (Kafka topic, SQS, RabbitMQ). "One actor per entity" scales up to "one service per bounded context."
- The guarantees are the same vocabulary at a different layer: **at-least-once + idempotency**, **partition-key ordering** (Kafka guarantees order within a partition the way actors guarantee order point-to-point), **backpressure** (consumer lag is mailbox overflow), **dead-letter queues** (the broker's version of a supervisor catching a poisoned message).
- The trade-offs transfer wholesale: no global consistent view (→ sagas / eventual consistency instead of distributed transactions), async-flow debugging (→ distributed tracing), delivery uncertainty (→ idempotent consumers). A senior who internalized the message-passing trade-offs at the actor level already understands microservice messaging — it's the same paradigm with a broker in the middle.

This is why the actor model is often called "microservices in a single runtime" and microservices "actors over a network with a broker." Recognizing them as the *same idea* — [event-driven architecture](../11-event-driven-programming/) and [message-queue patterns](../../../Architecture/system-design/) — is the professional payoff of understanding this paradigm: you carry one mental model from a single process up to a planet-scale system.

---

## Where the Paradigm Ends and the Mechanics Begin

A clean boundary worth stating explicitly, because it governs where to look for what:

- **This topic (the paradigm)** answers: *how do I structure my system as isolated units exchanging messages?* — supervision trees, actor-per-entity, choosing delivery guarantees, location transparency, when message passing beats shared memory.
- **[Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) (the mechanics)** answers: *how is this implemented?* — green-thread/M:N scheduling (BEAM reductions, Go's GMP), how channels and mailboxes are built, the memory model and happens-before, work-stealing, syscall handling.
- **[System Design](../../../Architecture/system-design/) (the architecture-in-the-large)** answers: *how do independent services exchange messages reliably?* — brokers, partitioning, exactly-once pipelines, sagas, observability.

A complete engineer reads all three: the paradigm to *design*, the mechanics to *understand cost and tune*, the system-design layer to *operate it across services*. Confusing them — debugging a scheduler problem with paradigm-level reasoning, or vice versa — is a common time sink.

---

## Common Mistakes

- **Treating location transparency as location invisibility.** Identical syntax hides *radically* different latency and failure semantics. Design every possibly-remote send for delay, loss, and reorder — the network is not local memory.
- **Assuming distributed message passing is reliable/ordered by default.** Erlang's cross-node default is **at-most-once**; ordering weakens across the wire. Build at-least-once + idempotency where loss is unacceptable.
- **Putting irreplaceable state in a crash-prone worker.** "Let it crash" only works if a restart recovers cleanly — keep durable state in a store (or event-source it), keep workers' state cheap to lose.
- **Designing a flat supervision tree.** No hierarchy means no controlled blast radius and no escalation. Match restart strategies (`one_for_one` / `one_for_all` / `rest_for_one`) to the actual dependencies between children.
- **Leaking goroutines in Go.** A goroutine blocked on a channel with no future sender never dies. Thread `context` through every blocking op; bound pools; use `errgroup` for joint lifetimes.
- **Expecting Go channels to span machines.** CSP channels are in-process. Distribution is external infrastructure (gRPC, queues). Don't reach for channels where you need a broker.
- **Saying "exactly-once" and meaning it literally.** Over a network it's at-least-once + dedupe/idempotency. Engineer the idempotency; don't trust a transport claim.

---

## Summary

At professional scale the actor model stops being a concurrency trick and becomes a **distributed-systems architecture**, and **Erlang/OTP** is its most complete embodiment: total process isolation, millions of cheap processes, links/monitors, and built-in distribution combine into a *reliability platform*, productionized as OTP **behaviors** (`gen_server`, `supervisor`) so you inherit hardened request/reply and fault-handling instead of hand-rolling loops. **Supervision trees** turn "let it crash" into a structural discipline where restart strategies and intensity bound the blast radius and escalate persistent failures up the tree — a fault-tolerance design skill with no lock-based equivalent. **Location transparency** lets the same message-passing code span a cluster because the model never assumed shared memory — but it is *not* location invisibility: every cross-node send inherits the network's delay, loss, and reordering, and the default guarantee is **at-most-once**, with stronger needs met by **at-least-once + idempotency** (true exactly-once delivery being impossible over an unreliable network). **Hot code reload** — swapping code between messages with a `code_change` state migration — is the operational property that isolation uniquely enables. **Akka** (cluster sharding, persistence/event-sourcing, typed actors, Reactive-Streams backpressure) and **Orleans** scale these ideas across fleets, while **Go's CSP** scales the *other* lineage superbly *in-process* (context-driven cancellation, bounded pools, `errgroup`) but stops at the process boundary, pushing distribution to external brokers. That boundary is the key contrast: actors extend the message-passing model across the wire; CSP doesn't. Finally, **event-driven microservices are the same paradigm with a broker in the middle** — mailbox = inbound queue, point-to-point order = partition order, overflow = consumer lag, supervisor = dead-letter handling — so mastering this paradigm hands you one mental model that scales from a single process to a planet-scale system.

---

## Further Reading

- Cesarini & Thompson, *Erlang Programming* and *Designing for Scalability with Erlang/OTP* — OTP behaviors, supervision, and distribution, definitively.
- Joe Armstrong, *Making reliable distributed systems in the presence of software errors* — the thesis that ties isolation, supervision, and "let it crash" together.
- *Akka Documentation* — Cluster Sharding, Persistence (event sourcing), Akka Typed, and Akka Streams backpressure.
- Bernstein, Bykov et al., *Orleans: Distributed Virtual Actors for Programmability and Scalability* — virtual actors / grains and automatic placement.
- Deutsch & Gosling, *The Fallacies of Distributed Computing* — the assumptions location transparency must *not* let you forget.
- *The Go Blog — "Go Concurrency Patterns: Pipelines and cancellation"* and *"Context"* — CSP at scale without goroutine leaks.

---

## Related Topics

- [`senior.md`](senior.md) — the trade-offs (deadlock, overflow, delivery, no global view) and the selection heuristics this level operationalizes.
- [`interview.md`](interview.md) — supervision, location transparency, and delivery guarantees as interview Q&A.
- [05 — Reactive Programming](../05-reactive-programming/) — Reactive Streams backpressure, the framework answer to mailbox overflow.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — pipelines and stream processing, the CSP architecture cousin.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — the same paradigm at microservice granularity.
- [System Design](../../../Architecture/system-design/) — message queues, delivery guarantees, sagas, and observability across services.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the scheduler/runtime mechanics (BEAM, Go GMP) under these abstractions.
